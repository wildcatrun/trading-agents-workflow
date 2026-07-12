#!/usr/bin/env node
import fs from "node:fs/promises";

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

const requestFile = firstText(process.argv[2], process.env.WORKFLOW_V2_ADAPTER_RUNNER_REQUEST_FILE);
const outputFile = firstText(process.argv[3], process.env.WORKFLOW_V2_ADAPTER_RUNNER_OUTPUT_FILE);

if (!requestFile || !outputFile) {
  console.error("usage: workflow_v2_external_runner_dummy.mjs REQUEST_FILE OUTPUT_FILE");
  process.exit(2);
}

const request = JSON.parse(await fs.readFile(requestFile, "utf8"));
if (request.schemaVersion !== "workflow_v2_external_adapter_runner_request.v1") {
  throw new Error(`unsupported request schema: ${request.schemaVersion || "missing"}`);
}
if (request.returnContract?.directDatabaseWritesAllowed !== false) {
  throw new Error("dummy runner requires directDatabaseWritesAllowed=false");
}

const workerRunId = firstText(request.adapterJob?.workerRunId, request.adapterJob?.worker_run_id, request.manifest?.workerRunId);
const adapterJobId = firstText(request.adapterJob?.adapterJobId, request.adapterJob?.adapter_job_id, request.manifest?.adapterJobId);
const runtimeBackend = firstText(request.runtimeBackend, request.manifest?.runtimeBackend);

const output = {
  status: "success",
  summary: `Dummy external runner completed ${workerRunId}`,
  receipt: {
    runner: "workflow_v2_external_runner_dummy",
    runtimeBackend,
    adapterJobId,
    workerRunId,
    requestSchemaVersion: request.schemaVersion
  }
};

await fs.writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
