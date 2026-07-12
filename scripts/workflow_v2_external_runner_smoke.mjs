#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAction } from "../src/core.js";
import { workflowPaths } from "../src/workflow/paths.js";
import { sqlValue, sqlite } from "../src/workflow/sqlite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function sqliteJson(dbFile, sql) {
  return sqlite(dbFile, sql, { json: true });
}

async function sqliteCount(dbFile, tableName, where = "1=1") {
  const rows = await sqliteJson(dbFile, `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where};`);
  return Number(rows[0]?.count || 0);
}

const root = firstText(argValue("--root"), await fs.mkdtemp(path.join(os.tmpdir(), "workflow-v2-external-runner-smoke-")));
const runId = firstText(argValue("--run-id"), new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"));
const paths = workflowPaths(root, { workflowRootDir: root });
const dbFile = paths.dbFile;

const workflowId = `wf-v2-external-runner-smoke-${runId}`;
const planId = `${workflowId}.plan`;
const nodeId = `${planId}.spawn`;
const sessionId = `${workflowId}.session`;
const workerRunId = `${workflowId}.worker`;
const taskInputInfoId = `${workflowId}.task-input`;
const runnerId = `${workflowId}.dummy-runner`;
const dummyRunner = path.join(__dirname, "workflow_v2_external_runner_dummy.mjs");
const envKey = "TRADING_AGENTS_WORKFLOW_V2_CLAUDE_CODE_DOCKER_WORKER_RUNNER_CMD";
const previousEnv = process.env[envKey];
const genericOrchestrationEnvKey = "TRADING_AGENTS_WORKFLOW_ENABLE_GENERIC_ORCHESTRATION";
const previousGenericOrchestrationEnv = process.env[genericOrchestrationEnvKey];

try {
  process.env[genericOrchestrationEnvKey] = "1";
  await runAction(root, { action: "workflow.init" });
  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId,
    status: "active",
    ownerAgent: "cat_body",
    taskType: "external_runner_smoke",
    runtimeTarget: "claude_code_docker_worker",
    purpose: "Workflow v2 external-command dummy runner smoke",
    systemBrief: "Use the prepared workflow session input and return results through workflow.v2.worker_result.* only.",
    resourceBudget: { contextLimitTokens: 64000 }
  });
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId,
    nodeId,
    infoId: taskInputInfoId,
    classification: "internal",
    contentStorage: "inline",
    allowInlineContent: true,
    inlineReason: "small deterministic smoke fixture",
    bodyText: "Dummy external runner smoke input.",
    recipientAgent: "cat_body",
    summary: "External runner smoke task input"
  });
  const worker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId,
    nodeId,
    managerAgent: "cat_body",
    sessionId,
    workerRunId,
    taskInputInfoId,
    runtimeBackend: "claude_code_docker_worker",
    workerObjective: "Complete the dummy external runner smoke using only the provided input reference.",
    outputFormat: "structured artifact summary with receipt reference",
    toolBoundary: "Do not write directly to workflow state.",
    acceptanceCriteria: ["dummy output summary is produced", "receipt evidence is available"],
    stopCondition: "Stop after producing dummy output.",
    contextBudgetTokens: 64000,
    maxAttempts: 2,
    providerModel: "openai-codex/dummy-external-runner",
    receipt: { provider: "openai-codex", model: "dummy-external-runner", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  assert.equal(worker.workerRun.workerRunId, workerRunId);

  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: `${runnerId}.worker-lease`,
    workerLimit: 1,
    workerLeaseMs: 60_000
  });
  const workerLease = (await sqliteJson(dbFile, `
SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(workerRunId)}
LIMIT 1;`))[0];
  assert.ok(workerLease?.leaseOwner, "worker lease owner is required before adapter job record");
  assert.ok(workerLease?.leaseUntil, "worker lease until is required before adapter job record");

  const adapterRecord = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId,
    leaseOwner: workerLease.leaseOwner,
    leaseUntil: workerLease.leaseUntil
  });
  assert.equal(adapterRecord.adapterJob.workerRunId, workerRunId);

  process.env[envKey] = JSON.stringify([process.execPath, dummyRunner]);
  const preview = await runAction(root, {
    action: "workflow.v2.adapter_runner.preview",
    mode: "external_command",
    runtimeBackend: "claude_code_docker_worker",
    limit: 1
  });
  assert.equal(preview.mode, "external_command");
  assert.equal(preview.runnerCommandConfigured, true);
  assert.equal(preview.count, 1);

  const drain = await runAction(root, {
    action: "workflow.v2.adapter_runner.drain",
    mode: "external_command",
    runtimeBackend: "claude_code_docker_worker",
    runnerId,
    limit: 1,
    leaseMs: 30_000
  });
  assert.equal(drain.mode, "external_command");
  assert.equal(drain.submittedCount, 1);
  assert.equal(drain.results[0].status, "submitted");
  assert.equal(drain.results[0].externalOutput.status, "success");
  assert.equal(drain.results[0].submit.adapterJobUpdate.job.status, "completed");
  assert.equal(await pathExists(drain.results[0].externalOutput.artifactFile), true);
  assert.equal(await sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id=${sqlValue(workerRunId)} AND status='submitted_for_review' AND lease_owner='' AND lease_until=''`), 1);
  assert.equal(await sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", `worker_run_id=${sqlValue(workerRunId)} AND status='completed'`), 1);
  assert.equal(await sqliteCount(dbFile, "workflow_session_runs", `run_id=${sqlValue(worker.workerRun.sessionRunId)} AND status='completed'`), 1);

  console.log(JSON.stringify({
    ok: true,
    root,
    dbFile,
    workflowId,
    planId,
    nodeId,
    sessionId,
    workerRunId,
    adapterJobId: adapterRecord.adapterJob.adapterJobId,
    runnerId,
    outputArtifact: drain.results[0].externalOutput.artifactRef,
    status: "submitted_for_review"
  }, null, 2));
} finally {
  if (previousEnv === undefined) delete process.env[envKey];
  else process.env[envKey] = previousEnv;
  if (previousGenericOrchestrationEnv === undefined) delete process.env[genericOrchestrationEnvKey];
  else process.env[genericOrchestrationEnvKey] = previousGenericOrchestrationEnv;
}
