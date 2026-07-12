import fs from "node:fs/promises";
import path from "node:path";
import {
  boolOption,
  firstText,
  jsonHash,
  safeId,
  textHash
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount,
  tableColumns
} from "../workflow/sqlite.js";
import {
  WORKFLOW_V2_ADAPTER_JOB_BACKENDS,
  WORKFLOW_V2_ADAPTER_JOB_IMAGES,
  WORKFLOW_V2_ADAPTER_JOB_STATUSES,
  WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS
} from "./constants.js";
import {
  workflowV2AdapterJobLeaseMs,
  workflowV2AdapterJobRetryDelayMs,
  workflowV2AdapterJobSummary,
  workflowV2CapacityInt,
  workflowV2DefaultProviderConcurrency,
  workflowV2ErrorMessage,
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2NormalizeBackend,
  workflowV2NormalizeEnum,
  workflowV2ValidationError,
  workflowV2WorkerRunSummary
} from "./helpers.js";
import {
  workflowV2LeaseCheckAt,
  workflowV2LeaseErrors,
  workflowV2LoadWorkerRunForResult
} from "./worker-state.js";
import {
  workflowV2AdapterJobById
} from "./adapter-job-state.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 adapter runner action dependency missing: ${name}`);
  return value;
}

export function createWorkflowV2AdapterRunnerActionHandlers(context = {}) {
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const execFileAsync = requireContextFunction(context, "execFileAsync");
  const nowIso = requireContextFunction(context, "nowIso");
  const pathExists = requireContextFunction(context, "pathExists");
  const sessionRunFromRow = requireContextFunction(context, "sessionRunFromRow");
  const workflowV2CleanupInfoStackItem = requireContextFunction(context, "workflowV2CleanupInfoStackItem");
  const workflowV2InfoStackExistingItem = requireContextFunction(context, "workflowV2InfoStackExistingItem");
  const workflowV2InfoStackPreview = requireContextFunction(context, "workflowV2InfoStackPreview");
  const workflowV2InfoStackRecord = requireContextFunction(context, "workflowV2InfoStackRecord");
  const workflowV2WorkerResultFail = requireContextFunction(context, "workflowV2WorkerResultFail");
  const workflowV2WorkerResultSubmit = requireContextFunction(context, "workflowV2WorkerResultSubmit");
  const writeJsonAtomic = requireContextFunction(context, "writeJsonAtomic");

function workflowV2AdapterJobArtifact(rootDir, row = {}, input = {}) {
  const artifactId = firstText(input.artifactId, input.artifact_id) || `${cleanFileSegment(row.worker_run_id || "worker")}.adapter-job.${Number(row.attempt || 0)}.json`;
  const safeArtifactId = cleanFileSegment(artifactId.replace(/\.json$/i, ""));
  const workflowSegment = cleanFileSegment(row.workflow_id || "workflow");
  const fileName = `${safeArtifactId}.json`;
  const artifactFile = path.join(rootDir, "artifacts", "workflow-v2", workflowSegment, "worker-runs", fileName);
  const artifactRef = `artifact://workflow-v2/${workflowSegment}/worker-runs/${fileName}`;
  return { artifactId: fileName, artifactFile, artifactRef };
}

function workflowV2AdapterBackendProfile(runtimeBackend = "", input = {}) {
  const backend = workflowV2NormalizeBackend(runtimeBackend, runtimeBackend || "hermers_docker_worker");
  const runnerKind = backend === "claude_code_docker_worker" ? "claude_code" : "hermers";
  const image = firstText(input.runnerImage, input.runner_image, input.image, WORKFLOW_V2_ADAPTER_JOB_IMAGES[backend]);
  return {
    hostAlias: firstText(input.hostAlias, input.host_alias, "wsl-agents"),
    runtimeBackend: backend,
    runnerKind,
    image,
    executionMode: "pull_runner_manifest",
    docker: {
      image,
      containerNameHint: firstText(input.containerName, input.container_name),
      startContainer: false,
      runContainer: false,
      directPortExposure: false
    },
    returnPath: {
      submitAction: "workflow.v2.worker_result.submit",
      failAction: "workflow.v2.worker_result.fail",
      directDatabaseWritesAllowed: false
    }
  };
}

async function workflowV2AdapterRunnerCapacity(paths, input = {}, generatedAt = nowIso(), runtimeBackend = "") {
  const profile = workflowV2JsonObject(input.capacityProfile ?? input.capacity_profile ?? input.backendCapacity ?? input.backend_capacity, {});
  const requestedLimit = workflowV2CapacityInt([
    input.limit,
    input.jobLimit,
    input.job_limit,
    profile.requestedLimit,
    profile.requested_limit
  ], 1, 0, 200);
  const maxLogicalWorkers = workflowV2CapacityInt([
    input.maxLogicalWorkers,
    input.max_logical_workers,
    profile.maxLogicalWorkers,
    profile.max_logical_workers
  ], 200, 1, 10_000);
  const backendMaxActiveJobs = workflowV2CapacityInt([
    input.backendMaxActiveJobs,
    input.backend_max_active_jobs,
    input.maxActiveJobs,
    input.max_active_jobs,
    profile.backendMaxActiveJobs,
    profile.backend_max_active_jobs,
    profile.maxActiveJobs,
    profile.max_active_jobs
  ], 200, 0, maxLogicalWorkers);
  const providerModel = firstText(
    input.providerModel,
    input.provider_model,
    input.model,
    profile.providerModel,
    profile.provider_model,
    profile.model,
    profile.modelId,
    profile.model_id
  );
  const providerMaxConcurrentCalls = workflowV2CapacityInt([
    input.providerMaxConcurrentCalls,
    input.provider_max_concurrent_calls,
    input.modelMaxConcurrentCalls,
    input.model_max_concurrent_calls,
    profile.providerMaxConcurrentCalls,
    profile.provider_max_concurrent_calls,
    profile.modelMaxConcurrentCalls,
    profile.model_max_concurrent_calls
  ], workflowV2DefaultProviderConcurrency(providerModel, backendMaxActiveJobs), 0, maxLogicalWorkers);
  const backendClause = runtimeBackend ? `AND j.runtime_backend=${sqlValue(runtimeBackend)}` : "";
  const activeRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_adapter_jobs j
WHERE j.status='running'
  AND j.lease_until > ${sqlValue(generatedAt)}
  ${backendClause};`, { json: true });
  const dueRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_adapter_jobs j
JOIN workflow_v2_worker_runs w ON w.worker_run_id=j.worker_run_id
WHERE j.status IN ('queued','retry_scheduled')
  AND (j.next_retry_at='' OR j.next_retry_at <= ${sqlValue(generatedAt)})
  ${backendClause}
  AND w.status='running'
  AND w.lease_until > ${sqlValue(generatedAt)}
  AND w.attempt=j.worker_attempt;`, { json: true });
  const activeBackendJobs = Number(activeRows[0]?.count || 0);
  const dueCount = Number(dueRows[0]?.count || 0);
  const availableBackendSlots = Math.max(0, backendMaxActiveJobs - activeBackendJobs);
  const activeProviderCalls = activeBackendJobs;
  const availableProviderSlots = Math.max(0, providerMaxConcurrentCalls - activeProviderCalls);
  const availableSlots = Math.max(0, Math.min(availableBackendSlots, availableProviderSlots, maxLogicalWorkers));
  const effectiveLimit = Math.max(0, Math.min(requestedLimit, availableSlots, dueCount));
  return {
    requestedLimit,
    effectiveLimit,
    dueCount,
    maxLogicalWorkers,
    runtimeBackend,
    providerModel,
    backendMaxActiveJobs,
    providerMaxConcurrentCalls,
    activeBackendJobs,
    activeProviderCalls,
    availableBackendSlots,
    availableProviderSlots,
    availableSlots,
    providerScopedByBackend: true,
    throttled: effectiveLimit < requestedLimit,
    source: Object.keys(profile).length ? "input_capacity_profile" : "defaults"
  };
}

function workflowV2ArtifactRefToFile(paths, artifactRef = "") {
  const text = String(artifactRef || "").trim();
  const prefix = "artifact://workflow-v2/";
  if (!text.startsWith(prefix)) {
    throw new Error(`workflow v2 artifact ref is not readable by local runner: ${text || "missing"}`);
  }
  const suffix = text.slice(prefix.length);
  if (!suffix || suffix.split("/").some((part) => part === "..")) {
    throw new Error(`workflow v2 artifact ref has unsafe path: ${text}`);
  }
  const base = path.resolve(paths.artifactsDir, "workflow-v2");
  const filePath = path.resolve(base, suffix);
  if (filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) {
    throw new Error(`workflow v2 artifact ref escapes artifact root: ${text}`);
  }
  return filePath;
}

async function workflowV2AdapterJobManifest(paths, job = {}) {
  const artifactFile = workflowV2ArtifactRefToFile(paths, job.artifactRef || job.artifact_ref || "");
  const manifest = JSON.parse(await fs.readFile(artifactFile, "utf8"));
  const expectedHash = job.manifestHash || job.manifest_hash || "";
  const actualHash = `sha256:${jsonHash(manifest)}`;
  if (!expectedHash) {
    throw new Error(`workflow v2 adapter job manifest hash missing: ${job.adapterJobId || job.adapter_job_id || ""}`);
  }
  if (expectedHash !== actualHash) {
    throw new Error(`workflow v2 adapter job manifest hash mismatch: ${job.adapterJobId || job.adapter_job_id || ""}`);
  }
  return { manifest, artifactFile, manifestHash: actualHash };
}

function workflowV2AdapterRunnerMode(input = {}) {
  const raw = firstText(input.mode, input.runnerMode, input.runner_mode, "mock");
  const normalized = String(raw || "mock").trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "mock") return "mock";
  if (["external", "external_command", "real", "docker", "docker_command", "hermers", "claude_code", "hermers_docker_worker", "claude_code_docker_worker"].includes(normalized)) {
    return "external_command";
  }
  throw new Error(`workflow v2 adapter runner mode is not implemented: ${raw}`);
}

function workflowV2CommandArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    const parsed = workflowV2JsonArray(text, []);
    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (/\s/.test(text)) {
    throw new Error("workflow v2 external runner command strings with spaces must be provided as a JSON array");
  }
  return [text];
}

function workflowV2InputRunnerCommandProvided(input = {}) {
  return input.runnerCommand !== undefined
    || input.runner_command !== undefined
    || input.externalRunnerCommand !== undefined
    || input.external_runner_command !== undefined;
}

function workflowV2ExternalRunnerCommandConfig(input = {}, runtimeBackend = "") {
  const backendKey = String(runtimeBackend || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const backendEnvKey = backendKey ? `TRADING_AGENTS_WORKFLOW_V2_${backendKey}_RUNNER_CMD` : "";
  const config = {
    required: true,
    configured: false,
    source: "",
    executable: "",
    argc: 0,
    inputCommandRejected: workflowV2InputRunnerCommandProvided(input),
    backendEnvKey,
    genericEnvKey: "TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD",
    errors: []
  };
  if (workflowV2InputRunnerCommandProvided(input)) {
    config.errors.push(workflowV2ValidationError("external_runner_command_input_disallowed", "workflow v2 external adapter runner command must be configured by environment, not action input"));
    return config;
  }
  const candidates = [
    { source: backendEnvKey, value: backendEnvKey ? process.env[backendEnvKey] : "" },
    { source: "TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD", value: process.env.TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD }
  ];
  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null || candidate.value === "") continue;
    try {
      const command = workflowV2CommandArray(candidate.value);
      if (command.length) {
        return {
          ...config,
          configured: true,
          source: candidate.source,
          executable: command[0],
          argc: command.length,
          command
        };
      }
    } catch (error) {
      config.errors.push(workflowV2ValidationError("external_runner_command_invalid", String(error?.message || error), { source: candidate.source }));
      return config;
    }
  }
  config.errors.push(workflowV2ValidationError("external_runner_command_missing", `workflow v2 external adapter runner requires ${backendEnvKey || "TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD"}`, {
    backendEnvKey,
    genericEnvKey: "TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD"
  }));
  return config;
}

function workflowV2ExternalRunnerCommand(input = {}, runtimeBackend = "") {
  const config = workflowV2ExternalRunnerCommandConfig(input, runtimeBackend);
  if (config.errors.length) {
    throw new Error(config.errors.map((error) => error.message || error.code).join("; "));
  }
  return { command: config.command, source: config.source };
}

function workflowV2ExternalRunnerTimeoutMs(input = {}) {
  const requested = Number(input.runnerTimeoutMs ?? input.runner_timeout_ms ?? input.timeoutMs ?? input.timeout_ms ?? 10 * 60_000);
  if (!Number.isFinite(requested)) return 10 * 60_000;
  return Math.max(1_000, Math.min(60 * 60_000, Math.floor(requested)));
}

async function workflowV2AdapterRunnerExternalFiles(paths, job = {}, generatedAt = nowIso()) {
  const workflowId = job.workflowId || job.workflow_id || "workflow";
  const adapterJobId = job.adapterJobId || job.adapter_job_id || safeId("adapter-job");
  const runnerAttempt = workflowV2NonNegativeInt(job.runnerAttempt ?? job.runner_attempt, 0);
  const artifactDir = path.join(paths.artifactsDir, "workflow-v2", cleanFileSegment(workflowId), "adapter-runner");
  const filePrefix = `${cleanFileSegment(adapterJobId)}.${runnerAttempt}.${textHash(generatedAt).slice(0, 10)}`;
  await fs.mkdir(artifactDir, { recursive: true });
  return {
    artifactDir,
    requestFile: path.join(artifactDir, `${filePrefix}.runner-request.json`),
    outputFile: path.join(artifactDir, `${filePrefix}.runner-output.json`),
    artifactFile: path.join(artifactDir, `${filePrefix}.external-output.json`),
    artifactRef: `artifact://workflow-v2/${cleanFileSegment(workflowId)}/adapter-runner/${filePrefix}.external-output.json`
  };
}

function workflowV2ExternalRunnerStatus(output = {}) {
  const raw = firstText(output.status, output.outcome, output.resultStatus, output.result_status);
  if (!raw) throw new Error("workflow v2 external adapter runner output requires explicit status");
  const normalized = String(raw).trim().toLowerCase().replace(/-/g, "_");
  if (["success", "succeeded", "complete", "completed", "submit", "submitted"].includes(normalized)) return "success";
  if (["fail", "failed", "failure", "terminal_fail", "terminal_failure"].includes(normalized)) return "fail";
  if (["release", "retry", "retry_scheduled"].includes(normalized)) return "release";
  throw new Error(`unsupported workflow v2 external adapter runner status: ${raw}`);
}

async function workflowV2ExternalRunnerOutput(files = {}, result = {}) {
  if (await pathExists(files.outputFile)) {
    const outputText = await fs.readFile(files.outputFile, "utf8");
    const output = JSON.parse(outputText);
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      throw new Error("workflow v2 external adapter runner output file must contain a JSON object");
    }
    return output;
  }
  const stdout = String(result.stdout || "").trim();
  if (!stdout) {
    throw new Error("workflow v2 external adapter runner did not write output JSON file or stdout JSON");
  }
  const output = JSON.parse(stdout);
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("workflow v2 external adapter runner stdout must contain a JSON object");
  }
  return output;
}

async function workflowV2AdapterRunnerExternalCommand(paths, job = {}, manifest = {}, manifestFile = "", input = {}, generatedAt = nowIso()) {
  const runtimeBackend = workflowV2NormalizeBackend(job.runtimeBackend || job.runtime_backend || manifest.runtimeBackend || manifest.runtime_backend, "");
  const runnerId = firstText(input.runnerId, input.runner_id, input.leaseOwner, input.lease_owner);
  const commandConfig = workflowV2ExternalRunnerCommand(input, runtimeBackend);
  const files = await workflowV2AdapterRunnerExternalFiles(paths, job, generatedAt);
  const request = {
    schemaVersion: "workflow_v2_external_adapter_runner_request.v1",
    generatedAt,
    runnerId,
    adapterJob: job,
    manifest,
    manifestFile,
    outputFile: files.outputFile,
    runtimeBackend,
    returnContract: {
      outputJsonFile: files.outputFile,
      outputStatusValues: ["success", "fail", "release"],
      successRequiresSummary: true,
      directDatabaseWritesAllowed: false
    }
  };
  await writeJsonAtomic(files.requestFile, request);
  const appendRequestOutputArgs = boolOption(input.appendRunnerIoArgs ?? input.append_runner_io_args, true);
  const args = [
    ...commandConfig.command.slice(1),
    ...(appendRequestOutputArgs ? [files.requestFile, files.outputFile] : [])
  ];
  const env = {
    ...process.env,
    WORKFLOW_V2_ADAPTER_RUNNER_REQUEST_FILE: files.requestFile,
    WORKFLOW_V2_ADAPTER_RUNNER_OUTPUT_FILE: files.outputFile,
    WORKFLOW_V2_ADAPTER_JOB_ID: job.adapterJobId || job.adapter_job_id || "",
    WORKFLOW_V2_WORKER_RUN_ID: job.workerRunId || job.worker_run_id || "",
    WORKFLOW_V2_RUNTIME_BACKEND: runtimeBackend,
    WORKFLOW_V2_RUNNER_ID: runnerId
  };
  const cwd = firstText(input.runnerCwd, input.runner_cwd, paths.root);
  const timeout = workflowV2ExternalRunnerTimeoutMs(input);
  const maxBuffer = Math.max(64 * 1024, Math.min(16 * 1024 * 1024, Number(input.runnerMaxBuffer ?? input.runner_max_buffer ?? 1024 * 1024) || 1024 * 1024));
  const result = await execFileAsync(commandConfig.command[0], args, { cwd, env, timeout, maxBuffer });
  const output = await workflowV2ExternalRunnerOutput(files, result);
  const status = workflowV2ExternalRunnerStatus(output);
  const summary = firstText(output.summary, output.outputSummary, output.output_summary, `External adapter runner output for ${job.workerRunId || job.worker_run_id || ""}`);
  const captureCommandOutput = boolOption(input.captureCommandOutput ?? input.capture_command_output, false);
  const artifactPayload = {
    schemaVersion: "workflow_v2_adapter_runner_external_output.v1",
    generatedAt,
    runnerMode: "external_command",
    runnerId,
    adapterJobId: job.adapterJobId || job.adapter_job_id || "",
    workerRunId: job.workerRunId || job.worker_run_id || "",
    workflowId: job.workflowId || job.workflow_id || manifest.workflowId || "",
    planId: job.planId || job.plan_id || manifest.planId || "",
    nodeId: job.nodeId || job.node_id || manifest.nodeId || "",
    runtimeBackend,
    status,
    summary,
    command: {
      source: commandConfig.source,
      executable: commandConfig.command[0],
      argsAppended: appendRequestOutputArgs,
      timeoutMs: timeout
    },
    files: {
      requestFile: files.requestFile,
      outputFile: files.outputFile
    },
    output,
    stdoutBytes: Buffer.byteLength(result.stdout || "", "utf8"),
    stderrBytes: Buffer.byteLength(result.stderr || "", "utf8"),
    ...(captureCommandOutput ? {
      stdout: String(result.stdout || "").slice(0, 8000),
      stderr: String(result.stderr || "").slice(0, 8000)
    } : {})
  };
  await writeJsonAtomic(files.artifactFile, artifactPayload);
  return {
    status,
    summary,
    retryAllowed: boolOption(output.retryAllowed ?? output.retry_allowed, false),
    artifactFile: files.artifactFile,
    artifactRef: firstText(output.artifactRef, output.artifact_ref, files.artifactRef),
    outputInfoId: firstText(output.outputInfoId, output.output_info_id, manifest.output?.expectedOutputInfoId, `${job.workerRunId || job.worker_run_id}.output`),
    receipt: {
      adapterRunner: "external_command",
      runnerId,
      adapterJobId: job.adapterJobId || job.adapter_job_id || "",
      workerRunId: job.workerRunId || job.worker_run_id || "",
      manifestFile,
      requestFile: files.requestFile,
      outputFile: files.outputFile,
      outputArtifactRef: firstText(output.artifactRef, output.artifact_ref, files.artifactRef),
      outputStatus: status,
      runnerReceipt: workflowV2JsonObject(output.receipt ?? output.runnerReceipt ?? output.runner_receipt, {}),
      generatedAt
    },
    rawOutput: output
  };
}

function workflowV2AdapterRunnerOutcome(input = {}, job = {}, index = 0) {
  const outcomeMap = workflowV2JsonObject(input.jobOutcomes ?? input.job_outcomes ?? input.outcomes, {});
  const mapped = outcomeMap[job.adapterJobId] ?? outcomeMap[job.adapter_job_id] ?? outcomeMap[job.workerRunId] ?? outcomeMap[job.worker_run_id];
  const raw = firstText(mapped, input.mockOutcome, input.mock_outcome, input.outcome, input.resultStatus, input.result_status, "success");
  const normalized = String(raw || "success").trim().toLowerCase().replace(/-/g, "_");
  if (["success", "succeeded", "complete", "completed", "submit", "submitted"].includes(normalized)) return "success";
  if (["fail", "failed", "failure", "terminal_fail", "terminal_failure"].includes(normalized)) return "fail";
  if (["release", "retry", "retry_scheduled"].includes(normalized)) return "release";
  throw new Error(`unsupported workflow v2 adapter runner mock outcome at index ${index}: ${raw}`);
}

async function workflowV2AdapterRunnerMockOutput(paths, job = {}, manifest = {}, input = {}, generatedAt = nowIso()) {
  const workflowId = job.workflowId || manifest.workflowId || "workflow";
  const adapterJobId = job.adapterJobId || manifest.adapterJobId || safeId("adapter-job");
  const runnerAttempt = workflowV2NonNegativeInt(job.runnerAttempt ?? job.runner_attempt, 0);
  const artifactDir = path.join(paths.artifactsDir, "workflow-v2", cleanFileSegment(workflowId), "adapter-runner");
  const artifactFile = path.join(artifactDir, `${cleanFileSegment(adapterJobId)}.${runnerAttempt}.mock-output.json`);
  const artifactRef = `artifact://workflow-v2/${cleanFileSegment(workflowId)}/adapter-runner/${path.basename(artifactFile)}`;
  const output = {
    schemaVersion: "workflow_v2_adapter_runner_mock_output.v1",
    generatedAt,
    runnerMode: "mock",
    runnerId: firstText(input.runnerId, input.runner_id, input.leaseOwner, input.lease_owner),
    adapterJobId,
    workerRunId: job.workerRunId || manifest.workerRunId || "",
    workflowId,
    planId: job.planId || manifest.planId || "",
    nodeId: job.nodeId || manifest.nodeId || "",
    runtimeBackend: job.runtimeBackend || manifest.runtimeBackend || "",
    workerAttempt: workflowV2NonNegativeInt(job.workerAttempt ?? manifest.lease?.attempt, 0),
    runnerAttempt,
    summary: firstText(input.summary, input.outputSummary, input.output_summary, `Mock adapter runner output for ${job.workerRunId || manifest.workerRunId || adapterJobId}`),
    manifestHash: job.manifestHash || "",
    taskInputInfoId: manifest.taskInput?.infoId || ""
  };
  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(artifactFile, output);
  return { artifactFile, artifactRef, output };
}

async function workflowV2AdapterJobExistingForWorkerAttempt(dbFile, workerRunId = "", workerAttempt = 0) {
  if (!workerRunId) return null;
  const columns = await tableColumns(dbFile, "workflow_v2_worker_adapter_jobs");
  if (!columns.size) return null;
  const rows = await sqlite(dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
WHERE worker_run_id=${sqlValue(workerRunId)}
  AND worker_attempt=${sqlValue(Number(workerAttempt || 0))}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowV2ExpireAdapterJobLeases(paths, input = {}, generatedAt = nowIso()) {
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
WHERE status='running'
  AND lease_until!=''
  AND lease_until <= ${sqlValue(generatedAt)}
ORDER BY lease_until ASC
LIMIT 200;`, { json: true });
  const expired = [];
  for (const row of rows) {
    const runnerAttempt = Number(row.runner_attempt || 0);
    const maxRunnerAttempts = Math.max(1, Number(row.max_runner_attempts || 3));
    const retry = runnerAttempt < maxRunnerAttempts;
    const nextStatus = retry ? "retry_scheduled" : "failed";
    const nextRetryAt = retry ? new Date(new Date(generatedAt).getTime() + workflowV2AdapterJobRetryDelayMs(input, runnerAttempt)).toISOString() : "";
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status=${sqlValue(nextStatus)},
    lease_owner='',
    lease_until='',
    next_retry_at=${sqlValue(nextRetryAt)},
    last_error=${sqlValue(firstText(row.last_error, `adapter job lease expired at ${generatedAt}`))},
    completed_at=${sqlValue(retry ? "" : generatedAt)},
    updated_at=${sqlValue(generatedAt)}
WHERE adapter_job_id=${sqlValue(row.adapter_job_id)}
  AND status='running'
  AND lease_until=${sqlValue(row.lease_until || "")};`);
    if (changed === 1) {
      expired.push({
        adapterJobId: row.adapter_job_id,
        previousStatus: "running",
        status: nextStatus,
        retry,
        nextRetryAt
      });
    }
  }
  return expired;
}

async function workflowV2WorkerAdapterJobPreview(rootDir, input = {}) {
  const { paths, row, errors } = await workflowV2LoadWorkerRunForResult(rootDir, input);
  if (row) errors.push(...workflowV2LeaseErrors(row, input));
  const leaseCheckAt = workflowV2LeaseCheckAt(input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const adapterJobId = firstText(input.adapterJobId, input.adapter_job_id, input.jobId, input.job_id) || `${row?.worker_run_id || "worker"}.adapter-job.${Number(row?.attempt || 0)}`;
  const adapterJobInfoId = firstText(input.adapterJobInfoId, input.adapter_job_info_id, input.infoId, input.info_id) || `${row?.worker_run_id || "worker"}.adapter-job.info`;
  const artifact = row ? workflowV2AdapterJobArtifact(paths.root, row, input) : { artifactId: "", artifactFile: "", artifactRef: "" };
  const runtimeBackend = row ? workflowV2NormalizeBackend(row.runtime_backend, row.runtime_backend) : "";
  if (row && row.runtime_backend === "local_deterministic") {
    errors.push(workflowV2ValidationError("adapter_job_local_backend_disallowed", "local_deterministic worker runs execute inside the local control loop and do not use adapter job manifests"));
  } else if (row && !WORKFLOW_V2_ADAPTER_JOB_BACKENDS.has(runtimeBackend)) {
    errors.push(workflowV2ValidationError("adapter_job_backend_unsupported", `worker adapter jobs currently support Hermers and Claude Code Docker worker backends, got ${runtimeBackend || "unknown"}`, { runtimeBackend }));
  }

  let sessionRun = null;
  if (row) {
    const sessionRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_session_runs
WHERE run_id=${sqlValue(row.session_run_id || "")}
LIMIT 1;`, { json: true });
    sessionRun = sessionRunFromRow(sessionRows[0]);
    if (!sessionRun) {
      errors.push(workflowV2ValidationError("session_run_not_found", "adapter job requires the worker's prepared session run"));
    } else {
      if (sessionRun.workflowId && sessionRun.workflowId !== row.workflow_id) {
        errors.push(workflowV2ValidationError("session_run_workflow_mismatch", "session run workflowId does not match worker run"));
      }
      if (sessionRun.taskId && sessionRun.taskId !== row.node_id) {
        errors.push(workflowV2ValidationError("session_run_node_mismatch", "session run taskId does not match worker nodeId"));
      }
      if (sessionRun.workerId && sessionRun.workerId !== row.worker_agent_id) {
        errors.push(workflowV2ValidationError("session_run_worker_mismatch", "session run workerId does not match workerAgentId"));
      }
      if (sessionRun.status !== "running") {
        errors.push(workflowV2ValidationError("session_run_not_running", `adapter job requires running session run status, got ${sessionRun.status || "missing"}`));
      }
    }
  }

  let preflight = null;
  if (row) {
    if (!row.preflight_id) {
      errors.push(workflowV2ValidationError("backend_preflight_id_required", "adapter job requires a worker backend preflight id"));
    } else {
      const preflightRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_backend_preflights
WHERE preflight_id=${sqlValue(row.preflight_id)}
LIMIT 1;`, { json: true });
      const preflightRow = preflightRows[0];
      if (!preflightRow) {
        errors.push(workflowV2ValidationError("backend_preflight_not_found", "adapter job requires recorded backend preflight evidence"));
      } else {
        preflight = {
          preflightId: preflightRow.preflight_id || "",
          workflowId: preflightRow.workflow_id || "",
          backendId: preflightRow.backend_id || "",
          status: preflightRow.status || "",
          findings: workflowV2JsonArray(preflightRow.findings_json, []),
          payload: workflowV2JsonObject(preflightRow.payload_json, {}),
          createdBy: preflightRow.created_by || "",
          createdAt: preflightRow.created_at || ""
        };
        if (preflight.workflowId && preflight.workflowId !== row.workflow_id) {
          errors.push(workflowV2ValidationError("backend_preflight_workflow_mismatch", "backend preflight workflowId does not match worker run"));
        }
        if (preflight.backendId && preflight.backendId !== row.runtime_backend) {
          errors.push(workflowV2ValidationError("backend_preflight_backend_mismatch", "backend preflight backendId does not match worker runtimeBackend"));
        }
        if (preflight.status === "fail") {
          errors.push(workflowV2ValidationError("backend_preflight_failed", "failed backend preflight cannot produce an adapter job"));
        }
      }
    }
  }

  const adapterJobInfoExisting = row ? await workflowV2InfoStackExistingItem(paths.dbFile, adapterJobInfoId) : null;
  const adapterJobExisting = row ? await workflowV2AdapterJobExistingForWorkerAttempt(paths.dbFile, row.worker_run_id, Number(row.attempt || 0)) : null;
  const workerPayload = row ? workflowV2JsonObject(row.payload_json, {}) : {};
  const existingAdapterJob = row ? workflowV2JsonObject(workerPayload.adapterJob ?? workerPayload.adapter_job, {}) : {};
  const existingAdapterJobAttempt = Number(existingAdapterJob.attempt ?? existingAdapterJob.leaseAttempt ?? NaN);
  const existingAdapterJobSameAttempt = row && Object.keys(existingAdapterJob).length > 0 && (
    Number.isFinite(existingAdapterJobAttempt)
      ? existingAdapterJobAttempt === Number(row.attempt || 0)
      : (
        (!existingAdapterJob.leaseUntil || existingAdapterJob.leaseUntil === row.lease_until)
        && (!existingAdapterJob.leaseOwner || existingAdapterJob.leaseOwner === row.lease_owner)
      )
  );
  if (row && existingAdapterJobSameAttempt) {
    errors.push(workflowV2ValidationError("adapter_job_already_recorded", "worker run already has an adapter job manifest recorded", {
      adapterJobInfoId: existingAdapterJob.adapterJobInfoId || existingAdapterJob.adapter_job_info_id || "",
      artifactRef: existingAdapterJob.artifactRef || existingAdapterJob.artifact_ref || ""
    }));
  }
  if (row && adapterJobExisting) {
    errors.push(workflowV2ValidationError("adapter_job_already_recorded", "worker run already has an adapter job row for the current attempt", {
      adapterJobId: adapterJobExisting.adapter_job_id || "",
      adapterJobInfoId: adapterJobExisting.info_id || "",
      artifactRef: adapterJobExisting.artifact_ref || ""
    }));
  }
  if (row && adapterJobInfoExisting && (
    adapterJobInfoExisting.workflow_id !== row.workflow_id
    || adapterJobInfoExisting.worker_run_id !== row.worker_run_id
  )) {
    errors.push(workflowV2ValidationError("adapter_job_info_id_conflict", "adapter job infoId already exists outside the current worker run", {
      adapterJobInfoId,
      existingWorkflowId: adapterJobInfoExisting.workflow_id || "",
      existingWorkerRunId: adapterJobInfoExisting.worker_run_id || ""
    }));
  }

  const backendProfile = row ? workflowV2AdapterBackendProfile(runtimeBackend, input) : workflowV2AdapterBackendProfile("hermers_docker_worker", input);
  const contextBudgetTokens = Math.min(
    WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
    Math.max(1, workflowV2NonNegativeInt(row?.context_budget_tokens, WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS) || WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS)
  );
  const manifest = row ? {
    schemaVersion: "workflow_v2_worker_adapter_job.v1",
    generatedAt,
    adapterJobId,
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    nodeId: row.node_id || "",
    workerRunId: row.worker_run_id || "",
    sessionRunId: row.session_run_id || "",
    sessionId: row.session_id || "",
    managerAgent: row.manager_agent || "",
    workerAgentId: row.worker_agent_id || "",
    runtimeBackend,
    backend: backendProfile,
    lease: {
      owner: row.lease_owner || "",
      until: row.lease_until || "",
      attempt: Number(row.attempt || 0),
      checkAt: leaseCheckAt
    },
    context: {
      limitTokens: contextBudgetTokens,
      hardLimitTokens: WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
      usedTokens: Number(row.context_used_tokens || 0),
      compactionCount: Number(row.compaction_count || 0),
      sourceContextRefs: workflowV2JsonArray(row.source_context_refs_json, [])
    },
    taskInput: {
      infoId: row.task_input_info_id || "",
      readAction: "workflow.v2.info_stack.read"
    },
    sessionInput: sessionRun?.workerInput || {},
    output: {
      expectedOutputInfoId: firstText(row.output_info_id, `${row.worker_run_id}.output`),
      submitAction: "workflow.v2.worker_result.submit",
      failAction: "workflow.v2.worker_result.fail",
      receiptRequired: true,
      managerReviewRequired: true
    },
    preflight: preflight ? {
      preflightId: preflight.preflightId,
      backendId: preflight.backendId,
      status: preflight.status,
      findings: preflight.findings,
      createdAt: preflight.createdAt
    } : null,
    constraints: {
      noDirectDatabaseWrites: true,
      noRuntimeMembership: true,
      noOpenClawWorkerBackend: true,
      noProductionSecrets: true,
      noHeavyMonolithicTasks: true
    }
  } : null;
  const manifestHash = manifest ? `sha256:${jsonHash(manifest)}` : "";
  let infoPreview = null;
  if (row) {
    infoPreview = await workflowV2InfoStackPreview(paths.root, {
      ...input,
      workflowId: row.workflow_id,
      planId: row.plan_id,
      nodeId: row.node_id,
      workerRunId: row.worker_run_id,
      infoId: adapterJobInfoId,
      recipientKind: "worker_runner",
      recipientId: runtimeBackend,
      classification: "internal",
      contentStorage: "artifact_ref",
      artifactRef: artifact.artifactRef,
      channel: "workflow_inbox",
      summary: firstText(input.summary, `Adapter job manifest for ${row.worker_run_id}`),
      payload: {
        adapterJobId,
        runtimeBackend,
        artifactRef: artifact.artifactRef,
        manifestHash,
        leaseOwner: row.lease_owner || "",
        leaseUntil: row.lease_until || ""
      }
    });
    errors.push(...infoPreview.errors);
  }
  return {
    operation: "workflow.v2.worker_adapter_job.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    workerRun: row ? workflowV2WorkerRunSummary(row) : null,
    sessionRun,
    preflight,
    adapterJobId,
    adapterJobInfoId,
    adapterJobInfoExisting,
    adapterJobExisting: adapterJobExisting ? workflowV2AdapterJobSummary(adapterJobExisting) : null,
    leaseCheckAt,
    manifest,
    manifestHash,
    artifact,
    infoPreview,
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2WorkerAdapterJobRecord(rootDir, input = {}) {
  const preview = await workflowV2WorkerAdapterJobPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 worker adapter job is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const row = preview.workerRun;
  const rawRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(row.workerRunId)} LIMIT 1;`, { json: true });
  const rawRow = rawRows[0] || {};
  const previousPayload = workflowV2JsonObject(rawRow.payload_json, {});
  await writeJsonAtomic(preview.artifact.artifactFile, preview.manifest);
  let adapterJobInfo = null;
  let createdAdapterJob = false;
  try {
    adapterJobInfo = await workflowV2InfoStackRecord(paths.root, {
      ...input,
      workflowId: row.workflowId,
      planId: row.planId,
      nodeId: row.nodeId,
      workerRunId: row.workerRunId,
      infoId: preview.adapterJobInfoId,
      recipientKind: "worker_runner",
      recipientId: row.runtimeBackend,
      classification: "internal",
      contentStorage: "artifact_ref",
      artifactRef: preview.artifact.artifactRef,
      channel: "workflow_inbox",
      summary: firstText(input.summary, `Adapter job manifest for ${row.workerRunId}`),
      payload: {
        adapterJobId: preview.adapterJobId,
        runtimeBackend: row.runtimeBackend,
        artifactRef: preview.artifact.artifactRef,
        artifactId: preview.artifact.artifactId,
        manifestHash: preview.manifestHash,
        attempt: row.attempt,
        leaseOwner: row.leaseOwner || "",
        leaseUntil: row.leaseUntil || "",
        recordedAt: now
      }
    });
    await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_worker_adapter_jobs(adapter_job_id, workflow_id, plan_id, node_id, worker_run_id, session_run_id, runtime_backend, worker_attempt, runner_attempt, max_runner_attempts, status, lease_owner, lease_until, next_retry_at, runner_id, artifact_ref, artifact_id, info_id, manifest_hash, runner_receipt_ref, last_error, payload_json, created_by, created_at, updated_at, completed_at)
VALUES (${sqlValue(preview.adapterJobId)}, ${sqlValue(row.workflowId)}, ${sqlValue(row.planId)}, ${sqlValue(row.nodeId)}, ${sqlValue(row.workerRunId)}, ${sqlValue(row.sessionRunId)}, ${sqlValue(row.runtimeBackend)}, ${sqlValue(row.attempt)}, 0, ${sqlValue(Math.max(1, Math.min(20, Number(input.maxRunnerAttempts || input.max_runner_attempts || 3))))}, 'queued', '', '', '', '', ${sqlValue(preview.artifact.artifactRef)}, ${sqlValue(preview.artifact.artifactId)}, ${sqlValue(preview.adapterJobInfoId)}, ${sqlValue(preview.manifestHash)}, '', '', ${sqlValue(JSON.stringify({
      backend: preview.manifest?.backend || {},
      workerLease: preview.manifest?.lease || {},
      context: preview.manifest?.context || {},
      output: preview.manifest?.output || {}
    }))}, ${sqlValue(firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "workflow_v2"))}, ${sqlValue(now)}, ${sqlValue(now)}, '');`);
    createdAdapterJob = true;
    const nextPayload = {
      ...previousPayload,
      adapterJob: {
        adapterJobId: preview.adapterJobId,
        adapterJobInfoId: preview.adapterJobInfoId,
        artifactRef: preview.artifact.artifactRef,
        artifactFile: preview.artifact.artifactFile,
        manifestHash: preview.manifestHash,
        runtimeBackend: row.runtimeBackend,
        attempt: row.attempt,
        leaseOwner: row.leaseOwner || "",
        leaseUntil: row.leaseUntil || "",
        recordedAt: now
      }
    };
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET payload_json=${sqlValue(JSON.stringify(nextPayload))},
    updated_at=${sqlValue(now)}
WHERE worker_run_id=${sqlValue(row.workerRunId)}
  AND status='running'
  AND lease_owner=${sqlValue(row.leaseOwner)}
  AND lease_until=${sqlValue(row.leaseUntil)}
  AND payload_json=${sqlValue(rawRow.payload_json || "{}")}
  AND lease_until > ${sqlValue(preview.leaseCheckAt)};`);
    if (changed !== 1) throw new Error("workflow v2 worker adapter job lost lease or worker row changed before update");
  } catch (error) {
    if (createdAdapterJob) await sqlite(paths.dbFile, `DELETE FROM workflow_v2_worker_adapter_jobs WHERE adapter_job_id=${sqlValue(preview.adapterJobId)};`);
    if (!preview.adapterJobInfoExisting) await workflowV2CleanupInfoStackItem(paths.dbFile, preview.adapterJobInfoId);
    await fs.rm(preview.artifact.artifactFile, { force: true });
    throw error;
  }
  const adapterJobRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
WHERE adapter_job_id=${sqlValue(preview.adapterJobId)}
LIMIT 1;`, { json: true });
  return {
    ...preview,
    operation: "workflow.v2.worker_adapter_job.record",
    dryRun: false,
    previewOnly: false,
    adapterJobInfo: adapterJobInfo?.infoItem || null,
    adapterJob: workflowV2AdapterJobSummary(adapterJobRows[0]),
    dbFile: paths.dbFile
  };
}

async function workflowV2WorkerAdapterJobList(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const clauses = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id);
  const runtimeBackend = input.runtimeBackend || input.runtime_backend
    ? workflowV2NormalizeBackend(input.runtimeBackend || input.runtime_backend, "")
    : "";
  const explicitStatuses = workflowV2JsonArray(input.statuses ?? input.status_list ?? input.statusList, null);
  const statuses = explicitStatuses
    ? explicitStatuses.map((status) => workflowV2NormalizeEnum(status, WORKFLOW_V2_ADAPTER_JOB_STATUSES, "")).filter(Boolean)
    : (input.status ? [workflowV2NormalizeEnum(input.status, WORKFLOW_V2_ADAPTER_JOB_STATUSES, "")].filter(Boolean) : []);
  if (workflowId) clauses.push(`workflow_id=${sqlValue(workflowId)}`);
  if (workerRunId) clauses.push(`worker_run_id=${sqlValue(workerRunId)}`);
  if (runtimeBackend) clauses.push(`runtime_backend=${sqlValue(runtimeBackend)}`);
  if (statuses.length) clauses.push(`status IN (${statuses.map(sqlValue).join(",")})`);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(500, Number(input.limit || 100) || 100));
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
${where}
ORDER BY updated_at DESC, created_at DESC
LIMIT ${limit};`, { json: true });
  return {
    operation: "workflow.v2.worker_adapter_job.list",
    readOnly: true,
    count: rows.length,
    jobs: rows.map(workflowV2AdapterJobSummary),
    dbFile: paths.dbFile
  };
}

async function workflowV2WorkerAdapterJobClaim(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const runnerId = firstText(input.runnerId, input.runner_id, input.leaseOwner, input.lease_owner, input.claimOwner, input.claim_owner);
  if (!runnerId) throw new Error("workflow v2 worker adapter job claim requires runnerId/leaseOwner");
  const runtimeBackend = input.runtimeBackend || input.runtime_backend
    ? workflowV2NormalizeBackend(input.runtimeBackend || input.runtime_backend, "")
    : "";
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  const nodeId = firstText(input.nodeId, input.node_id);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id);
  const adapterJobId = firstText(input.adapterJobId, input.adapter_job_id, input.jobId, input.job_id);
  const leaseUntil = new Date(new Date(generatedAt).getTime() + workflowV2AdapterJobLeaseMs(input)).toISOString();
  const expiredLeases = await workflowV2ExpireAdapterJobLeases(paths, input, generatedAt);
  const capacity = await workflowV2AdapterRunnerCapacity(paths, input, generatedAt, runtimeBackend);
  const limit = capacity.effectiveLimit;
  const backendClause = runtimeBackend ? `AND j.runtime_backend=${sqlValue(runtimeBackend)}` : "";
  const activeBackendClause = runtimeBackend ? `AND active.runtime_backend=${sqlValue(runtimeBackend)}` : "";
  const scopeClauses = [];
  if (workflowId) scopeClauses.push(`j.workflow_id=${sqlValue(workflowId)}`);
  if (planId) scopeClauses.push(`j.plan_id=${sqlValue(planId)}`);
  if (nodeId) scopeClauses.push(`j.node_id=${sqlValue(nodeId)}`);
  if (workerRunId) scopeClauses.push(`j.worker_run_id=${sqlValue(workerRunId)}`);
  if (adapterJobId) scopeClauses.push(`j.adapter_job_id=${sqlValue(adapterJobId)}`);
  const scopeClause = scopeClauses.length ? `AND ${scopeClauses.join(" AND ")}` : "";
  if (limit <= 0) {
    return {
      operation: "workflow.v2.worker_adapter_job.claim",
      dryRun: false,
      previewOnly: false,
      generatedAt,
      runnerId,
      leaseUntil: "",
      expiredLeases,
      capacity,
      claimed: [],
      count: 0,
      dbFile: paths.dbFile
    };
  }
  const rows = await sqlite(paths.dbFile, `
SELECT j.*
FROM workflow_v2_worker_adapter_jobs j
JOIN workflow_v2_worker_runs w ON w.worker_run_id=j.worker_run_id
WHERE j.status IN ('queued','retry_scheduled')
  AND (j.next_retry_at='' OR j.next_retry_at <= ${sqlValue(generatedAt)})
  ${backendClause}
  ${scopeClause}
  AND w.status='running'
  AND w.lease_until > ${sqlValue(generatedAt)}
  AND w.attempt=j.worker_attempt
ORDER BY
  CASE j.status WHEN 'retry_scheduled' THEN 0 ELSE 1 END,
  j.created_at ASC
LIMIT ${limit};`, { json: true });
  const claimed = [];
  for (const row of rows) {
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status='running',
    runner_attempt=runner_attempt + 1,
    lease_owner=${sqlValue(runnerId)},
    runner_id=${sqlValue(runnerId)},
    lease_until=${sqlValue(leaseUntil)},
    next_retry_at='',
    updated_at=${sqlValue(generatedAt)}
WHERE adapter_job_id=${sqlValue(row.adapter_job_id)}
  AND status=${sqlValue(row.status || "")}
  AND runner_attempt=${sqlValue(Number(row.runner_attempt || 0))}
  AND (next_retry_at='' OR next_retry_at <= ${sqlValue(generatedAt)})
  AND EXISTS (
    SELECT 1
    FROM workflow_v2_worker_runs w
    WHERE w.worker_run_id=workflow_v2_worker_adapter_jobs.worker_run_id
      AND w.status='running'
      AND w.lease_until > ${sqlValue(generatedAt)}
      AND w.attempt=workflow_v2_worker_adapter_jobs.worker_attempt
  )
  AND (
    SELECT COUNT(*)
    FROM workflow_v2_worker_adapter_jobs active
    WHERE active.status='running'
      AND active.lease_until > ${sqlValue(generatedAt)}
      ${activeBackendClause}
  ) < ${sqlValue(capacity.backendMaxActiveJobs)}
  AND (
    SELECT COUNT(*)
    FROM workflow_v2_worker_adapter_jobs active
    WHERE active.status='running'
      AND active.lease_until > ${sqlValue(generatedAt)}
      ${activeBackendClause}
  ) < ${sqlValue(capacity.providerMaxConcurrentCalls)};`);
    if (changed === 1) {
      const claimedRow = await workflowV2AdapterJobById(paths.dbFile, row.adapter_job_id);
      claimed.push(workflowV2AdapterJobSummary(claimedRow));
    }
  }
  return {
    operation: "workflow.v2.worker_adapter_job.claim",
    dryRun: false,
    previewOnly: false,
    generatedAt,
    runnerId,
    leaseUntil,
    expiredLeases,
    capacity,
    claimed,
    count: claimed.length,
    dbFile: paths.dbFile
  };
}

async function workflowV2AdapterJobLeaseGuard(paths, input = {}, actionLabel = "adapter job action") {
  const adapterJobId = firstText(input.adapterJobId, input.adapter_job_id, input.jobId, input.job_id);
  if (!adapterJobId) throw new Error(`${actionLabel} requires adapterJobId`);
  const leaseOwner = firstText(input.leaseOwner, input.lease_owner, input.runnerId, input.runner_id);
  const leaseUntil = firstText(input.leaseUntil, input.lease_until);
  if (!leaseOwner) throw new Error(`${actionLabel} requires leaseOwner/runnerId`);
  if (!leaseUntil) throw new Error(`${actionLabel} requires leaseUntil`);
  const leaseCheckAt = workflowV2LeaseCheckAt(input);
  const rows = await sqlite(paths.dbFile, `
SELECT j.*, w.status AS worker_status, w.lease_owner AS worker_lease_owner, w.lease_until AS worker_lease_until, w.attempt AS current_worker_attempt
FROM workflow_v2_worker_adapter_jobs j
LEFT JOIN workflow_v2_worker_runs w ON w.worker_run_id=j.worker_run_id
WHERE j.adapter_job_id=${sqlValue(adapterJobId)}
LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) throw new Error(`${actionLabel} adapter job not found`);
  const errors = [];
  if (row.status !== "running") errors.push(`adapter_job_not_running:${row.status || ""}`);
  if (row.lease_owner !== leaseOwner) errors.push("adapter_job_lease_owner_mismatch");
  if (row.lease_until !== leaseUntil) errors.push("adapter_job_lease_until_mismatch");
  const adapterLeaseMs = Date.parse(row.lease_until || "");
  const workerLeaseMs = Date.parse(row.worker_lease_until || "");
  const leaseCheckMs = Date.parse(leaseCheckAt || "");
  if (!Number.isFinite(adapterLeaseMs) || !Number.isFinite(leaseCheckMs) || adapterLeaseMs <= leaseCheckMs) errors.push("adapter_job_lease_expired");
  if (row.worker_status !== "running") errors.push(`worker_not_running:${row.worker_status || ""}`);
  if (Number(row.current_worker_attempt || 0) !== Number(row.worker_attempt || 0)) errors.push("worker_attempt_mismatch");
  if (!Number.isFinite(workerLeaseMs) || !Number.isFinite(leaseCheckMs) || workerLeaseMs <= leaseCheckMs) errors.push("worker_lease_expired");
  if (errors.length) throw new Error(`${actionLabel} blocked: ${errors.join(",")}`);
  return { row, leaseOwner, leaseUntil, leaseCheckAt };
}

async function workflowV2WorkerAdapterJobHeartbeat(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const guard = await workflowV2AdapterJobLeaseGuard(paths, { ...input, generatedAt }, "workflow v2 worker adapter job heartbeat");
  const newLeaseUntil = new Date(new Date(generatedAt).getTime() + workflowV2AdapterJobLeaseMs(input)).toISOString();
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET lease_until=${sqlValue(newLeaseUntil)},
    updated_at=${sqlValue(generatedAt)}
WHERE adapter_job_id=${sqlValue(guard.row.adapter_job_id)}
  AND status='running'
  AND lease_owner=${sqlValue(guard.leaseOwner)}
  AND lease_until=${sqlValue(guard.leaseUntil)}
  AND EXISTS (
    SELECT 1
    FROM workflow_v2_worker_runs w
    WHERE w.worker_run_id=workflow_v2_worker_adapter_jobs.worker_run_id
      AND w.status='running'
      AND w.lease_until > ${sqlValue(generatedAt)}
      AND w.attempt=workflow_v2_worker_adapter_jobs.worker_attempt
  );`);
  if (changed !== 1) throw new Error("workflow v2 worker adapter job heartbeat lost lease before update");
  const row = await workflowV2AdapterJobById(paths.dbFile, guard.row.adapter_job_id);
  return {
    operation: "workflow.v2.worker_adapter_job.heartbeat",
    dryRun: false,
    previewOnly: false,
    generatedAt,
    leaseUntil: newLeaseUntil,
    job: workflowV2AdapterJobSummary(row),
    dbFile: paths.dbFile
  };
}

async function workflowV2WorkerAdapterJobRelease(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const guard = await workflowV2AdapterJobLeaseGuard(paths, { ...input, generatedAt }, "workflow v2 worker adapter job release");
  const retryDelayMs = workflowV2AdapterJobRetryDelayMs(input, Number(guard.row.runner_attempt || 0));
  const nextRetryAt = firstText(input.nextRetryAt, input.next_retry_at) || (retryDelayMs > 0 ? new Date(new Date(generatedAt).getTime() + retryDelayMs).toISOString() : generatedAt);
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status='retry_scheduled',
    lease_owner='',
    lease_until='',
    runner_id='',
    next_retry_at=${sqlValue(nextRetryAt)},
    last_error=${sqlValue(firstText(input.reason, input.error, input.errorMessage, input.error_message, "adapter job released by runner"))},
    updated_at=${sqlValue(generatedAt)}
WHERE adapter_job_id=${sqlValue(guard.row.adapter_job_id)}
  AND status='running'
  AND lease_owner=${sqlValue(guard.leaseOwner)}
  AND lease_until=${sqlValue(guard.leaseUntil)}
  AND EXISTS (
    SELECT 1
    FROM workflow_v2_worker_runs w
    WHERE w.worker_run_id=workflow_v2_worker_adapter_jobs.worker_run_id
      AND w.status='running'
      AND w.lease_until > ${sqlValue(generatedAt)}
      AND w.attempt=workflow_v2_worker_adapter_jobs.worker_attempt
  );`);
  if (changed !== 1) throw new Error("workflow v2 worker adapter job release lost lease before update");
  const row = await workflowV2AdapterJobById(paths.dbFile, guard.row.adapter_job_id);
  return {
    operation: "workflow.v2.worker_adapter_job.release",
    dryRun: false,
    previewOnly: false,
    generatedAt,
    job: workflowV2AdapterJobSummary(row),
    dbFile: paths.dbFile
  };
}

async function workflowV2WorkerAdapterJobFail(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const guard = await workflowV2AdapterJobLeaseGuard(paths, { ...input, generatedAt }, "workflow v2 worker adapter job fail");
  const errorMessage = firstText(input.error, input.errorMessage, input.error_message, input.reason);
  if (!errorMessage) throw new Error("workflow v2 worker adapter job fail requires error/errorMessage");
  const retryAllowed = boolOption(input.retryAllowed ?? input.retry_allowed, true);
  const runnerAttempt = Number(guard.row.runner_attempt || 0);
  const maxRunnerAttempts = Math.max(1, Number(guard.row.max_runner_attempts || 3));
  const retry = retryAllowed && runnerAttempt < maxRunnerAttempts;
  const nextStatus = retry ? "retry_scheduled" : "failed";
  const nextRetryAt = retry ? new Date(new Date(generatedAt).getTime() + workflowV2AdapterJobRetryDelayMs(input, runnerAttempt)).toISOString() : "";
  const runnerReceiptRef = firstText(input.runnerReceiptRef, input.runner_receipt_ref, input.receiptRef, input.receipt_ref);
  if (!retry) {
    const workerResult = await workflowV2WorkerResultFail(paths.root, {
      ...input,
      workerRunId: guard.row.worker_run_id,
      leaseOwner: guard.row.worker_lease_owner,
      leaseUntil: guard.row.worker_lease_until,
      adapterJobId: guard.row.adapter_job_id,
      adapterJobLeaseOwner: guard.leaseOwner,
      adapterJobLeaseUntil: guard.leaseUntil,
      failureType: "adapter_job_failed",
      retryAllowed: false,
      error: errorMessage,
      runnerReceiptRef,
      generatedAt
    });
    const row = await workflowV2AdapterJobById(paths.dbFile, guard.row.adapter_job_id);
    return {
      operation: "workflow.v2.worker_adapter_job.fail",
      dryRun: false,
      previewOnly: false,
      generatedAt,
      retry,
      nextStatus,
      job: workflowV2AdapterJobSummary(row),
      workerResult,
      dbFile: paths.dbFile
    };
  }
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status=${sqlValue(nextStatus)},
    lease_owner='',
    lease_until='',
    runner_id='',
    next_retry_at=${sqlValue(nextRetryAt)},
    runner_receipt_ref=${sqlValue(runnerReceiptRef)},
    last_error=${sqlValue(errorMessage)},
    completed_at=${sqlValue(retry ? "" : generatedAt)},
    updated_at=${sqlValue(generatedAt)}
WHERE adapter_job_id=${sqlValue(guard.row.adapter_job_id)}
  AND status='running'
  AND lease_owner=${sqlValue(guard.leaseOwner)}
  AND lease_until=${sqlValue(guard.leaseUntil)}
  AND EXISTS (
    SELECT 1
    FROM workflow_v2_worker_runs w
    WHERE w.worker_run_id=workflow_v2_worker_adapter_jobs.worker_run_id
      AND w.status='running'
      AND w.lease_until > ${sqlValue(generatedAt)}
      AND w.attempt=workflow_v2_worker_adapter_jobs.worker_attempt
  );`);
  if (changed !== 1) throw new Error("workflow v2 worker adapter job fail lost lease before update");
  const row = await workflowV2AdapterJobById(paths.dbFile, guard.row.adapter_job_id);
  return {
    operation: "workflow.v2.worker_adapter_job.fail",
    dryRun: false,
    previewOnly: false,
    generatedAt,
    retry,
    nextStatus,
    job: workflowV2AdapterJobSummary(row),
    dbFile: paths.dbFile
  };
}

async function workflowV2AdapterRunnerPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const runtimeBackend = input.runtimeBackend || input.runtime_backend
    ? workflowV2NormalizeBackend(input.runtimeBackend || input.runtime_backend, "")
    : "";
  const mode = workflowV2AdapterRunnerMode(input);
  const runnerCommandConfig = mode === "external_command"
    ? workflowV2ExternalRunnerCommandConfig(input, runtimeBackend)
    : { required: false, configured: false, source: "", executable: "", argc: 0, inputCommandRejected: false, errors: [] };
  const capacity = await workflowV2AdapterRunnerCapacity(paths, input, generatedAt, runtimeBackend);
  const backendClause = runtimeBackend ? `AND j.runtime_backend=${sqlValue(runtimeBackend)}` : "";
  const rows = await sqlite(paths.dbFile, `
SELECT j.*
FROM workflow_v2_worker_adapter_jobs j
JOIN workflow_v2_worker_runs w ON w.worker_run_id=j.worker_run_id
WHERE j.status IN ('queued','retry_scheduled')
  AND (j.next_retry_at='' OR j.next_retry_at <= ${sqlValue(generatedAt)})
  ${backendClause}
  AND w.status='running'
  AND w.lease_until > ${sqlValue(generatedAt)}
  AND w.attempt=j.worker_attempt
ORDER BY
  CASE j.status WHEN 'retry_scheduled' THEN 0 ELSE 1 END,
  j.created_at ASC
LIMIT ${capacity.effectiveLimit};`, { json: true });
  return {
    operation: "workflow.v2.adapter_runner.preview",
    dryRun: true,
    previewOnly: true,
    generatedAt,
    runtimeBackend,
    mode,
    runnerCommandRequired: mode === "external_command",
    runnerCommandConfigured: runnerCommandConfig.configured,
    runnerCommandConfig: {
      required: runnerCommandConfig.required,
      configured: runnerCommandConfig.configured,
      source: runnerCommandConfig.source,
      executable: runnerCommandConfig.executable,
      argc: runnerCommandConfig.argc,
      inputCommandRejected: runnerCommandConfig.inputCommandRejected,
      backendEnvKey: runnerCommandConfig.backendEnvKey || "",
      genericEnvKey: runnerCommandConfig.genericEnvKey || "",
      errors: runnerCommandConfig.errors
    },
    count: rows.length,
    dueCount: capacity.dueCount,
    capacity,
    jobs: rows.map(workflowV2AdapterJobSummary),
    dbFile: paths.dbFile
  };
}

async function workflowV2AdapterRunnerDrain(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const runnerId = firstText(input.runnerId, input.runner_id, input.leaseOwner, input.lease_owner, input.claimOwner, input.claim_owner, `mock-adapter-runner:${process.pid}`);
  const mode = workflowV2AdapterRunnerMode(input);
  const stopOnError = boolOption(input.stopOnError ?? input.stop_on_error, false);
  const runtimeBackend = input.runtimeBackend || input.runtime_backend
    ? workflowV2NormalizeBackend(input.runtimeBackend || input.runtime_backend, "")
    : "";
  if (mode === "external_command") {
    workflowV2ExternalRunnerCommand(input, runtimeBackend);
  }
  const claim = await workflowV2WorkerAdapterJobClaim(paths.root, {
    ...input,
    runnerId,
    generatedAt
  });
  const capacity = claim.capacity || await workflowV2AdapterRunnerCapacity(paths, input, generatedAt, runtimeBackend);
  const results = [];
  for (let index = 0; index < claim.claimed.length; index += 1) {
    const job = claim.claimed[index];
    const outcome = mode === "mock" ? workflowV2AdapterRunnerOutcome(input, job, index) : "external_command";
    try {
      if (mode === "mock" && outcome === "release") {
        const release = await workflowV2WorkerAdapterJobRelease(paths.root, {
          ...input,
          adapterJobId: job.adapterJobId,
          runnerId,
          leaseUntil: job.leaseUntil,
          generatedAt,
          reason: firstText(input.reason, "mock adapter runner requested release")
        });
        results.push({ adapterJobId: job.adapterJobId, workerRunId: job.workerRunId, outcome, status: "released", release });
        continue;
      }
      if (mode === "mock" && outcome === "fail") {
        const failure = await workflowV2WorkerAdapterJobFail(paths.root, {
          ...input,
          adapterJobId: job.adapterJobId,
          runnerId,
          leaseUntil: job.leaseUntil,
          retryAllowed: boolOption(input.mockFailureRetryAllowed ?? input.mock_failure_retry_allowed ?? false, false),
          error: firstText(input.error, input.errorMessage, input.error_message, `mock adapter runner failed ${job.adapterJobId}`),
          generatedAt
        });
        results.push({ adapterJobId: job.adapterJobId, workerRunId: job.workerRunId, outcome, status: failure.job?.status || "failed", failure });
        continue;
      }
      const { manifest, artifactFile: manifestFile } = await workflowV2AdapterJobManifest(paths, job);
      const workerRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(job.workerRunId)}
LIMIT 1;`, { json: true });
      const workerRow = workerRows[0];
      if (!workerRow) throw new Error(`adapter runner worker row not found: ${job.workerRunId}`);
      if (workerRow.status !== "running") throw new Error(`adapter runner worker is not running: ${job.workerRunId} status=${workerRow.status || ""}`);
      if (Number(workerRow.attempt || 0) !== Number(job.workerAttempt || 0)) throw new Error(`adapter runner worker attempt mismatch: ${job.workerRunId}`);
      if (mode === "external_command") {
        const externalOutput = await workflowV2AdapterRunnerExternalCommand(paths, job, manifest, manifestFile, { ...input, runnerId }, generatedAt);
        if (externalOutput.status === "release") {
          const release = await workflowV2WorkerAdapterJobRelease(paths.root, {
            ...input,
            adapterJobId: job.adapterJobId,
            runnerId,
            leaseUntil: job.leaseUntil,
            generatedAt,
            reason: externalOutput.summary
          });
          results.push({ adapterJobId: job.adapterJobId, workerRunId: job.workerRunId, outcome: "release", status: "released", externalOutput, release });
          continue;
        }
        if (externalOutput.status === "fail") {
          const failure = await workflowV2WorkerAdapterJobFail(paths.root, {
            ...input,
            adapterJobId: job.adapterJobId,
            runnerId,
            leaseUntil: job.leaseUntil,
            retryAllowed: externalOutput.retryAllowed,
            error: externalOutput.summary,
            generatedAt
          });
          results.push({ adapterJobId: job.adapterJobId, workerRunId: job.workerRunId, outcome: "fail", status: failure.job?.status || "failed", externalOutput, failure });
          continue;
        }
        const submit = await workflowV2WorkerResultSubmit(paths.root, {
          ...input,
          workerRunId: job.workerRunId,
          leaseOwner: workerRow.lease_owner || "",
          leaseUntil: workerRow.lease_until || "",
          adapterJobId: job.adapterJobId,
          adapterJobLeaseOwner: runnerId,
          adapterJobLeaseUntil: job.leaseUntil,
          generatedAt,
          outputInfoId: externalOutput.outputInfoId,
          contentStorage: "artifact_ref",
          artifactRef: externalOutput.artifactRef,
          receipt: externalOutput.receipt,
          summary: externalOutput.summary
        });
        results.push({
          adapterJobId: job.adapterJobId,
          workerRunId: job.workerRunId,
          outcome: "success",
          status: "submitted",
          externalOutput,
          submit
        });
        continue;
      }
      const outputArtifact = await workflowV2AdapterRunnerMockOutput(paths, job, manifest, { ...input, runnerId }, generatedAt);
      try {
        const receipt = {
          adapterRunner: "mock",
          runnerId,
          adapterJobId: job.adapterJobId,
          workerRunId: job.workerRunId,
          manifestFile,
          outputArtifactRef: outputArtifact.artifactRef,
          generatedAt
        };
        const submit = await workflowV2WorkerResultSubmit(paths.root, {
          ...input,
          workerRunId: job.workerRunId,
          leaseOwner: workerRow.lease_owner || "",
          leaseUntil: workerRow.lease_until || "",
          adapterJobId: job.adapterJobId,
          adapterJobLeaseOwner: runnerId,
          adapterJobLeaseUntil: job.leaseUntil,
          generatedAt,
          outputInfoId: manifest.output?.expectedOutputInfoId || `${job.workerRunId}.output`,
          contentStorage: "artifact_ref",
          artifactRef: outputArtifact.artifactRef,
          receipt,
          summary: outputArtifact.output.summary
        });
        results.push({
          adapterJobId: job.adapterJobId,
          workerRunId: job.workerRunId,
          outcome,
          status: "submitted",
          outputArtifact,
          submit
        });
      } catch (error) {
        await fs.rm(outputArtifact.artifactFile, { force: true });
        throw error;
      }
    } catch (error) {
      const errorMessage = workflowV2ErrorMessage(error);
      let failure = null;
      try {
        failure = await workflowV2WorkerAdapterJobFail(paths.root, {
          adapterJobId: job.adapterJobId,
          runnerId,
          leaseUntil: job.leaseUntil,
          retryAllowed: boolOption(input.internalErrorRetryAllowed ?? input.internal_error_retry_allowed, false),
          error: `adapter runner drain error: ${errorMessage}`,
          generatedAt
        });
      } catch (failureError) {
        failure = { error: workflowV2ErrorMessage(failureError) };
      }
      const result = { adapterJobId: job.adapterJobId, workerRunId: job.workerRunId, outcome, status: "error", error: errorMessage, failure };
      results.push(result);
      if (stopOnError) throw error;
    }
  }
  return {
    operation: "workflow.v2.adapter_runner.drain",
    dryRun: false,
    previewOnly: false,
    generatedAt,
    mode,
    runnerId,
    runtimeBackend,
    capacity,
    claimed: claim.claimed,
    expiredLeases: claim.expiredLeases,
    results,
    count: results.length,
    submittedCount: results.filter((item) => item.status === "submitted").length,
    failedCount: results.filter((item) => item.status === "failed" || item.status === "error").length,
    releasedCount: results.filter((item) => item.status === "released").length,
    dbFile: paths.dbFile
  };
}

  return {
    workflowV2WorkerAdapterJobPreview,
    workflowV2WorkerAdapterJobRecord,
    workflowV2WorkerAdapterJobList,
    workflowV2WorkerAdapterJobClaim,
    workflowV2WorkerAdapterJobHeartbeat,
    workflowV2WorkerAdapterJobRelease,
    workflowV2WorkerAdapterJobFail,
    workflowV2AdapterRunnerPreview,
    workflowV2AdapterRunnerDrain
  };
}
