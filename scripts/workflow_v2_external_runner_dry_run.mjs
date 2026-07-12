#!/usr/bin/env node
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

function buildPlanOnlyInvocation({ request, manifest, adapterJob, runtimeBackend, requestFile, outputFile, workerRunId, adapterJobId }) {
  const artifactDir = path.dirname(outputFile);
  const planSegment = safeSegment(adapterJobId || workerRunId || runtimeBackend);
  const planDir = path.join(artifactDir, `${planSegment}.plan-only`);
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
    schemaVersion: "workflow_v2_external_runner_plan_only.v1",
    mode: "plan_only",
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
        executesInThisSmoke: false
      },
      {
        name: entrypoint.wrapper,
        command: dockerCommand,
        executesInThisSmoke: false
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
    source: {
      requestSchemaVersion: request.schemaVersion,
      manifestSchemaVersion: manifest.schemaVersion,
      manifestHash: firstText(adapterJob.manifestHash, adapterJob.manifest_hash)
    }
  };
}

const parsedArgs = parseArgs(process.argv.slice(2));
const planOnly = parsedArgs.flags.has("plan-only");
const requestFile = firstText(parsedArgs.positionals[0], process.env.WORKFLOW_V2_ADAPTER_RUNNER_REQUEST_FILE);
const outputFile = firstText(parsedArgs.positionals[1], process.env.WORKFLOW_V2_ADAPTER_RUNNER_OUTPUT_FILE);

if (!requestFile || !outputFile) {
  console.error("usage: workflow_v2_external_runner_dry_run.mjs REQUEST_FILE OUTPUT_FILE");
  process.exit(2);
}

const request = JSON.parse(await fs.readFile(requestFile, "utf8"));
assertEqual(request.schemaVersion, "workflow_v2_external_adapter_runner_request.v1", "unsupported request schema");
assertEqual(request.returnContract?.directDatabaseWritesAllowed, false, "dry-run runner requires directDatabaseWritesAllowed=false");

const manifest = request.manifest || {};
const adapterJob = request.adapterJob || {};
const runtimeBackend = firstText(request.runtimeBackend, manifest.runtimeBackend, manifest.backend?.runtimeBackend, adapterJob.runtimeBackend, adapterJob.runtime_backend);
const supportedBackends = new Set(["hermers_docker_worker", "claude_code_docker_worker"]);
if (!supportedBackends.has(runtimeBackend)) {
  throw new Error(`unsupported dry-run runtime backend: ${runtimeBackend || "missing"}`);
}

const workerRunId = firstText(adapterJob.workerRunId, adapterJob.worker_run_id, manifest.workerRunId);
const adapterJobId = firstText(adapterJob.adapterJobId, adapterJob.adapter_job_id, manifest.adapterJobId);
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
assertEqual(manifest.backend?.docker?.startContainer, false, "dry-run runner must not start containers");
assertEqual(manifest.backend?.docker?.runContainer, false, "dry-run runner must not run containers");
assertEqual(manifest.backend?.docker?.directPortExposure, false, "dry-run runner must not expose direct ports");

const plannedInvocation = {
  dryRun: true,
  planOnly,
  runtimeBackend,
  runnerKind: firstText(manifest.backend?.runnerKind),
  hostAlias: firstText(manifest.backend?.hostAlias),
  image: firstText(manifest.backend?.image),
  executionMode: firstText(manifest.backend?.executionMode),
  startContainer: false,
  runContainer: false,
  directPortExposure: false,
  manifestFile: firstText(request.manifestFile),
  requestFile,
  outputFile
};
const planOnlyInvocation = planOnly
  ? buildPlanOnlyInvocation({ request, manifest, adapterJob, runtimeBackend, requestFile, outputFile, workerRunId, adapterJobId })
  : null;

const output = {
  status: "success",
  summary: planOnly
    ? `Plan-only external runner validated ${runtimeBackend} adapter job ${adapterJobId}`
    : `Dry-run external runner validated ${runtimeBackend} adapter job ${adapterJobId}`,
  plannedInvocation,
  ...(planOnlyInvocation ? { planOnlyInvocation } : {}),
  receipt: {
    runner: "workflow_v2_external_runner_dry_run",
    dryRun: true,
    planOnly,
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
      ...(planOnly ? ["plan_only_command_rendered", "plan_only_paths_rendered"] : [])
    ]
  }
};

await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
