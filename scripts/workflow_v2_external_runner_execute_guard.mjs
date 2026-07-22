#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected=${expected || "<empty>"} actual=${actual || "<empty>"}`);
  }
}

function assertTruthy(value, message) {
  if (!value) throw new Error(message);
}

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function parseJsonObject(value = "") {
  const text = String(value || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { __parseError: "authorization_json_object_required" };
    }
    return parsed;
  } catch {
    return { __parseError: "authorization_json_invalid" };
  }
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function intValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function parseArgs(argv = []) {
  const flags = new Set();
  const positionals = [];
  for (const item of argv) {
    if (String(item || "").startsWith("--")) {
      flags.add(String(item).slice(2).trim().toLowerCase().replace(/_/g, "-"));
    } else {
      positionals.push(item);
    }
  }
  return { flags, positionals };
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "workflow-v2-runner";
}

function plannedRuntimeEntrypoint(runtimeBackend) {
  if (runtimeBackend === "claude_code_docker_worker") {
    return {
      wrapper: "claude_code_worker_wrapper",
      command: ["node", "/opt/trading-agents-workflow/worker-runners/claude-code-runner.mjs", "/workspace/runner-request.json", "/workspace/runner-output.json"]
    };
  }
  return {
    wrapper: "hermers_worker_wrapper",
    command: ["node", "/opt/trading-agents-workflow/worker-runners/hermers-runner.mjs", "/workspace/runner-request.json", "/workspace/runner-output.json"]
  };
}

function buildPlannedInvocation({ request, manifest, adapterJob, runtimeBackend, requestFile, outputFile, workerRunId, adapterJobId }) {
  const artifactDir = path.dirname(outputFile);
  const planSegment = safeSegment(adapterJobId || workerRunId || runtimeBackend);
  const planDir = path.join(artifactDir, `${planSegment}.execute-guard`);
  const workspaceDir = path.join(planDir, "workspace");
  const logsDir = path.join(planDir, "logs");
  const runnerOutputDir = path.join(planDir, "runner-output");
  const containerName = `workflow-v2-${safeSegment(runtimeBackend)}-${safeSegment(workerRunId).slice(0, 32)}`;
  const entrypoint = plannedRuntimeEntrypoint(runtimeBackend);
  const image = firstText(manifest.backend?.image);
  const dockerCommand = [
    "docker",
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "-e",
    "WORKFLOW_V2_ADAPTER_RUNNER_REQUEST_FILE=/workspace/runner-request.json",
    "-e",
    "WORKFLOW_V2_ADAPTER_RUNNER_OUTPUT_FILE=/workspace/runner-output.json",
    "-e",
    `WORKFLOW_V2_RUNTIME_BACKEND=${runtimeBackend}`,
    "-v",
    `${artifactDir}:/workflow-artifacts:rw`,
    "-v",
    `${workspaceDir}:/workspace:rw`,
    image,
    ...entrypoint.command
  ];
  return {
    schemaVersion: "workflow_v2_external_runner_execute_guard_plan.v1",
    mode: "execute_guard",
    executable: false,
    requiresSeparateAuthorization: true,
    directDatabaseWritesAllowed: false,
    runtimeBackend,
    runnerKind: firstText(manifest.backend?.runnerKind),
    adapterJobId,
    workerRunId,
    hostAlias: firstText(manifest.backend?.hostAlias),
    image,
    containerName,
    paths: {
      artifactDir,
      planDir,
      workspaceDir,
      logsDir,
      runnerOutputDir,
      requestFile,
      outputFile,
      manifestFile: firstText(request.manifestFile),
      stdoutLog: path.join(logsDir, "runner.stdout.log"),
      stderrLog: path.join(logsDir, "runner.stderr.log"),
      resultArtifact: path.join(runnerOutputDir, "result.json"),
      receiptArtifact: path.join(runnerOutputDir, "receipt.json")
    },
    commands: [
      {
        name: "prepare_runner_directories",
        command: ["mkdir", "-p", workspaceDir, logsDir, runnerOutputDir],
        executesInThisRun: false
      },
      {
        name: entrypoint.wrapper,
        command: dockerCommand,
        executesInThisRun: false
      }
    ],
    constraints: {
      startContainerNow: false,
      runContainerNow: false,
      callModelNow: false,
      exposeNetworkPorts: false,
      mountSecrets: false,
      writeCentralDatabase: false,
      requireGovernedSubmitPath: true,
      outputMustReturnThrough: firstText(manifest.output?.submitAction)
    },
    authorization: {
      requiredBeforeExecution: true,
      requiredGateKeys: [
        "--execute",
        "TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE=1",
        "TRADING_AGENTS_WORKFLOW_V2_REAL_RUNNER_EXECUTE_AUTH_JSON"
      ],
      executionImplemented: false
    },
    source: {
      requestSchemaVersion: request.schemaVersion,
      manifestSchemaVersion: manifest.schemaVersion,
      manifestHash: firstText(adapterJob.manifestHash, adapterJob.manifest_hash)
    }
  };
}

function executeAuthorizationSummary(auth = {}, context = {}) {
  const errors = [];
  if (auth.__parseError) errors.push(auth.__parseError);
  const humanGateId = firstText(auth.humanGateId, auth.human_gate_id, auth.humanGate?.id);
  const protocolAuditId = firstText(auth.protocolAuditId, auth.protocol_audit_id, auth.secretaryAuditId, auth.secretary_audit_id);
  const packageId = firstText(auth.packageId, auth.package_id, auth.humanGatePackageId, auth.human_gate_package_id);
  const decision = firstText(auth.decision, auth.selectedOption, auth.selected_option, auth.optionId, auth.option_id);
  const flashcatOriginalWords = firstText(auth.flashcatOriginalWords, auth.flashcat_original_words, auth.operatorOriginalWords, auth.operator_original_words);
  const networkMode = firstText(auth.networkMode, auth.network_mode);
  const maxActiveJobs = intValue(auth.maxActiveJobs ?? auth.max_active_jobs, 0);
  const expiresAt = firstText(auth.expiresAt, auth.expires_at);
  const workflowId = firstText(auth.workflowId, auth.workflow_id);
  const planId = firstText(auth.planId, auth.plan_id);
  const adapterJobId = firstText(auth.adapterJobId, auth.adapter_job_id);
  const workerRunId = firstText(auth.workerRunId, auth.worker_run_id);
  if (!humanGateId) errors.push("human_gate_id_required");
  if (!protocolAuditId) errors.push("protocol_audit_id_required");
  if (!packageId) errors.push("human_gate_package_id_required");
  if (decision !== "approve_single_synthetic_execute_smoke") errors.push("approved_synthetic_execute_option_required");
  if (!flashcatOriginalWords) errors.push("flashcat_original_words_required");
  if (!boolValue(auth.syntheticOnly ?? auth.synthetic_only, false)) errors.push("synthetic_only_required");
  if (boolValue(auth.allowSecrets ?? auth.allow_secrets, false)) errors.push("secrets_must_be_disallowed");
  if (boolValue(auth.allowTrading ?? auth.allow_trading, false)) errors.push("trading_must_be_disallowed");
  if (networkMode !== "none") errors.push("network_mode_none_required");
  if (maxActiveJobs !== 1) errors.push("max_active_jobs_must_be_1");
  if (!workflowId) errors.push("workflow_id_required");
  else if (workflowId !== context.workflowId) errors.push("workflow_id_mismatch");
  if (!planId) errors.push("plan_id_required");
  else if (planId !== context.planId) errors.push("plan_id_mismatch");
  if (!adapterJobId) errors.push("adapter_job_id_required");
  else if (adapterJobId !== context.adapterJobId) errors.push("adapter_job_id_mismatch");
  if (!workerRunId) errors.push("worker_run_id_required");
  else if (workerRunId !== context.workerRunId) errors.push("worker_run_id_mismatch");
  if (expiresAt) {
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) errors.push("authorization_expired_or_invalid");
  } else {
    errors.push("authorization_expiry_required");
  }
  return {
    configured: Object.keys(auth).length > 0,
    ready: errors.length === 0,
    issueCodes: errors,
    parseError: auth.__parseError || "",
    evidence: {
      humanGateId,
      protocolAuditId,
      packageId,
      decision,
      flashcatOriginalWordsPresent: Boolean(flashcatOriginalWords),
      flashcatOriginalWordsHash: flashcatOriginalWords ? `sha256:${sha256(flashcatOriginalWords)}` : "",
      syntheticOnly: boolValue(auth.syntheticOnly ?? auth.synthetic_only, false),
      allowSecrets: boolValue(auth.allowSecrets ?? auth.allow_secrets, false),
      allowTrading: boolValue(auth.allowTrading ?? auth.allow_trading, false),
      networkMode,
      maxActiveJobs,
      expiresAt,
      workflowId,
      planId,
      adapterJobId,
      workerRunId
    }
  };
}

const parsedArgs = parseArgs(process.argv.slice(2));
const executeRequested = parsedArgs.flags.has("execute");
const executeEnvAllowed = process.env.TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE === "1";
const executeAuthEnv = process.env.TRADING_AGENTS_WORKFLOW_V2_REAL_RUNNER_EXECUTE_AUTH_JSON || "";
const requestFile = firstText(parsedArgs.positionals[0], process.env.WORKFLOW_V2_ADAPTER_RUNNER_REQUEST_FILE);
const outputFile = firstText(parsedArgs.positionals[1], process.env.WORKFLOW_V2_ADAPTER_RUNNER_OUTPUT_FILE);

if (!requestFile || !outputFile) {
  console.error("usage: workflow_v2_external_runner_execute_guard.mjs [--execute] REQUEST_FILE OUTPUT_FILE");
  process.exit(2);
}

const request = JSON.parse(await fs.readFile(requestFile, "utf8"));
assertEqual(request.schemaVersion, "workflow_v2_external_adapter_runner_request.v1", "unsupported request schema");
assertEqual(request.returnContract?.directDatabaseWritesAllowed, false, "execute guard requires directDatabaseWritesAllowed=false");

const manifest = request.manifest || {};
const adapterJob = request.adapterJob || {};
const runtimeBackend = firstText(request.runtimeBackend, manifest.runtimeBackend, manifest.backend?.runtimeBackend, adapterJob.runtimeBackend, adapterJob.runtime_backend);
const supportedBackends = new Set(["hermers_docker_worker", "claude_code_docker_worker"]);
if (!supportedBackends.has(runtimeBackend)) {
  throw new Error(`unsupported execute guard runtime backend: ${runtimeBackend || "missing"}`);
}

const workerRunId = firstText(adapterJob.workerRunId, adapterJob.worker_run_id, manifest.workerRunId);
const adapterJobId = firstText(adapterJob.adapterJobId, adapterJob.adapter_job_id, manifest.adapterJobId);
const workflowId = firstText(adapterJob.workflowId, adapterJob.workflow_id, manifest.workflowId);
const planId = firstText(adapterJob.planId, adapterJob.plan_id, manifest.planId);
const sessionInputWorkerRunId = firstText(manifest.sessionInput?.input?.workerRunId, manifest.session_input?.input?.workerRunId);
const manifestRuntimeBackend = firstText(manifest.runtimeBackend, manifest.backend?.runtimeBackend);
const manifestWorkerRunId = firstText(manifest.workerRunId);
const hardLimitTokens = Number(manifest.context?.hardLimitTokens || 0);

assertEqual(manifest.schemaVersion, "workflow_v2_worker_adapter_job.v1", "unsupported adapter manifest schema");
assertEqual(manifestRuntimeBackend, runtimeBackend, "manifest runtime backend mismatch");
assertEqual(manifestWorkerRunId, workerRunId, "manifest workerRunId mismatch");
assertEqual(sessionInputWorkerRunId, workerRunId, "session input workerRunId mismatch");
assertEqual(manifest.backend?.returnPath?.directDatabaseWritesAllowed, false, "manifest return path must disallow direct DB writes");
assertEqual(manifest.output?.submitAction, "workflow.v2.worker_result.submit", "manifest submit action mismatch");
assertEqual(manifest.output?.failAction, "workflow.v2.worker_result.fail", "manifest fail action mismatch");
assertTruthy(hardLimitTokens > 0 && hardLimitTokens <= 64000, "context hard limit must be present and <=64000");
assertTruthy(firstText(manifest.backend?.image), "backend image is required");
assertTruthy(firstText(manifest.backend?.hostAlias), "backend host alias is required");
assertEqual(manifest.backend?.docker?.startContainer, false, "execute guard manifest must not request container start");
assertEqual(manifest.backend?.docker?.runContainer, false, "execute guard manifest must not request container run");
assertEqual(manifest.backend?.docker?.directPortExposure, false, "execute guard manifest must not expose direct ports");

const plannedInvocation = buildPlannedInvocation({ request, manifest, adapterJob, runtimeBackend, requestFile, outputFile, workerRunId, adapterJobId });
const executeAuthorization = executeAuthorizationSummary(parseJsonObject(executeAuthEnv), { workflowId, planId, adapterJobId, workerRunId });
let refusedReason = "execute_flag_required";
if (executeRequested && !executeEnvAllowed) {
  refusedReason = "execute_requested_without_environment_gate";
} else if (executeRequested && executeEnvAllowed && !executeAuthorization.ready) {
  refusedReason = "human_gate_authorization_required";
} else if (executeRequested && executeEnvAllowed && executeAuthorization.ready) {
  refusedReason = "executor_not_implemented_after_authorization_gate";
}
const output = {
  status: "release",
  retryAllowed: false,
  summary: `Execution refused for ${runtimeBackend} adapter job ${adapterJobId}: ${refusedReason}`,
  plannedInvocation,
  receipt: {
    runner: "workflow_v2_external_runner_execute_guard",
    executeRequested,
    executeEnvAllowed,
    executeAuthorization,
    refused: true,
    refusedReason,
    runtimeBackend,
    adapterJobId,
    workerRunId,
    requestSchemaVersion: request.schemaVersion,
    manifestSchemaVersion: manifest.schemaVersion,
    checks: [
      "request_schema",
      "return_contract_no_direct_db",
      "manifest_schema",
      "runtime_backend_match",
      "worker_run_match",
      "session_input_match",
      "submit_fail_return_path",
      "context_budget",
      "docker_side_effects_disabled",
      ...(executeAuthorization.ready ? ["human_gate_authorization_ready"] : []),
      "execute_guard_refused"
    ]
  }
};

await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
