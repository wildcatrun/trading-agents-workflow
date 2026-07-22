#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { runAction } from "../src/core.js";
import { workflowPaths } from "../src/workflow/paths.js";
import { sqlValue, sqlite } from "../src/workflow/sqlite.js";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const args = [...argv];
  const options = {};
  while (args.length) {
    const item = args.shift();
    if (!item.startsWith("--")) throw new Error(`unexpected positional argument: ${item}`);
    const key = item.slice(2);
    const next = args[0];
    options[key] = next && !next.startsWith("--") ? args.shift() : "true";
  }
  return options;
}

function boolOption(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function utcCompact() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function tableExists(dbFile, tableName) {
  const rows = await sqlite(dbFile, `SELECT name FROM sqlite_master WHERE type='table' AND name=${sqlValue(tableName)} LIMIT 1;`, { json: true });
  return rows.length > 0;
}

async function tableColumns(dbFile, tableName) {
  if (!await tableExists(dbFile, tableName)) return new Set();
  const rows = await sqlite(dbFile, `PRAGMA table_info(${tableName});`, { json: true });
  return new Set(rows.map((row) => row.name));
}

async function scalarCount(dbFile, sql) {
  const rows = await sqlite(dbFile, sql, { json: true });
  return Number(rows[0]?.count || 0);
}

async function maybeBackupDatabase(dbFile, backupDir, runId) {
  if (!backupDir) return null;
  await fs.mkdir(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `workflow_control_plane.before-v2-canary.${safeSegment(runId)}.db`);
  await execFileAsync("sqlite3", [dbFile, `.backup ${backupFile}`], { maxBuffer: 10 * 1024 * 1024 });
  const stat = await fs.stat(backupFile);
  return { path: backupFile, bytes: stat.size };
}

function canaryTemplateSpec({ runId, templateId }) {
  return {
    schemaVersion: "workflow_template_spec.v1",
    templateId,
    version: 1,
    status: "candidate",
    title: `Workflow v2 fixed-template canary ${runId}`,
    description: "Low-risk canary for workflow v2 fixed-template orchestration state chain.",
    ownerAgent: "main",
    tags: ["canary", "workflow-v2", "fixed-template"],
    triggers: {
      shouldUse: ["operator-requested workflow v2 canary"],
      shouldNotUse: ["order execution", "credential handling", "external notification"]
    },
    variables: [
      { name: "workflowId", type: "string", required: true },
      { name: "planId", type: "string", required: true },
      { name: "objective", type: "string", required: true }
    ],
    riskPolicy: { riskTier: "low" },
    permissionPolicy: { allowedCapabilities: ["workflow.write", "workflow.verify"] },
    planSpecSkeleton: {
      workflowId: "{{workflowId}}",
      planId: "{{planId}}",
      objective: "{{objective}}",
      taskOwnerAgent: "cat_heart",
      plannerAgent: "main",
      participantManagers: ["cat_body"],
      humanGateRequired: false,
      orchestrationPattern: "manager_worker",
      orchestrationRationale: "Canary verifies bounded manager-worker plan materialization without runtime dispatch.",
      workerBudget: { maxWorkers: 1, concurrencyLimit: 1, maxWorkerContextTokens: 16000 },
      acceptanceCriteria: [
        "template registry entry is active and hash-bound",
        "plan and nodes are materialized with stable IDs",
        "no external notification is triggered"
      ],
      constraints: {
        noExternalNotification: true,
        noTradeIntent: true,
        noRuntimeDispatch: true
      },
      nodes: [
        {
          nodeId: "{{planId}}.spawn",
          nodeType: "manager_worker_spawn",
          ownerAgent: "cat_body",
          runtimeBackend: "hermers_docker_worker",
          payload: {
            canary: true,
            domainOwnership: "canary_orchestration_validation",
            expectedArtifacts: ["artifact://{{planId}}/canary-output.json"],
            reviewPolicy: "manager review required before owner acceptance"
          }
        },
        {
          nodeId: "{{planId}}.review",
          nodeType: "manager_review",
          ownerAgent: "cat_body",
          runtimeBackend: "hermers_docker_worker",
          dependsOn: ["{{planId}}.spawn"],
          payload: { canary: true }
        }
      ],
      payload: {
        canary: true,
        externalNotification: false
      }
    },
    evalPolicy: { requiredComparableArms: ["baseline", "previous_version", "candidate_version"] },
    promotionPolicy: { minEvalCount: 1, autoPromote: false },
    rollbackPolicy: { restorePreviousDefault: true },
    audit: {
      createdBy: "local_codex",
      canary: true
    }
  };
}

function canarySteps({ runId, templateId, workflowId, planId, objective, retireAfter }) {
  const spec = canaryTemplateSpec({ runId, templateId });
  const variables = { workflowId, planId, objective };
  const evidenceRefs = [
    `workflow-v2-canary:${runId}`,
    `template://${templateId}/v1`
  ];
  const steps = [
    ["workflow-init", { action: "workflow.init" }],
    ["template-preview", { action: "workflow.template.preview", templateSpec: spec, variables }],
    ["template-record-candidate", {
      action: "workflow.template.record_candidate",
      templateSpec: spec,
      variables,
      createdBy: "local_codex",
      evidenceRefs
    }],
    ["template-eval-record", {
      action: "workflow.template.eval",
      templateId,
      version: 1,
      createdBy: "local_codex",
      evidenceRefs,
      fixtureSnapshot: {
        runId,
        workflowId,
        planId,
        assertion: "Canary fixture covers fixed-template render and plan materialization only.",
        noExternalNotification: true,
        arms: [
          { kind: "baseline", name: "manual-check" },
          { kind: "previous_version", name: "none" },
          { kind: "candidate_version", name: templateId }
        ]
      },
      arms: [
        { kind: "baseline", name: "manual-check" },
        { kind: "previous_version", name: "none" },
        { kind: "candidate_version", name: templateId }
      ],
      metrics: {
        planGatePassRate: 1,
        executionSuccessRate: 1,
        receiptCompletenessRate: 1,
        evaluatorAcceptRate: 1,
        toolFeedbackCompleteness: 1,
        rollbackReadinessRate: 1,
        ownerRevisionRate: 0,
        humanGateReturnRate: 0,
        sideEffectUncertainRate: 0,
        freshnessViolationRate: 0,
        duplicateWorkRate: 0
      }
    }],
    ["template-promote-active", {
      action: "workflow.template.promote",
      templateId,
      version: 1,
      targetStatus: "active",
      createdBy: "local_codex",
      governanceAuditId: `canary-governance-audit-${runId}`,
      protocolAuditId: `canary-protocol-audit-${runId}`,
      evidenceRefs
    }],
    ["template-instantiate-preview", {
      action: "workflow.template.instantiate.preview",
      templateId,
      version: 1,
      variables
    }],
    ["template-instantiate-record", {
      action: "workflow.template.instantiate",
      templateId,
      version: 1,
      variables,
      planOverrides: {
        status: "planned",
        workflowState: "planned",
        createdBy: "local_codex",
        payload: {
          canary: true,
          noExternalNotification: true,
          evidenceRefs
        }
      }
    }],
    ["workflow-v2-validate", { action: "workflow.v2.validate", workflowId, planId }],
    ["template-get", { action: "workflow.template.get", templateId, includeSpec: false }],
    ["workflow-status", { action: "workflow.status" }]
  ];
  if (retireAfter) {
    steps.push(["template-retire", {
      action: "workflow.template.promote",
      templateId,
      version: 1,
      targetStatus: "retired",
      createdBy: "local_codex",
      evidenceRefs: [...evidenceRefs, "retire-after-canary"]
    }]);
  }
  return steps;
}

async function runSteps(root, outDir, steps) {
  const results = [];
  for (const [name, input] of steps) {
    const startedAt = new Date().toISOString();
    try {
      const result = await runAction(root, input);
      const endedAt = new Date().toISOString();
      const output = `${name}.json`;
      await fs.writeFile(path.join(outDir, output), JSON.stringify(result, null, 2) + "\n");
      results.push({ name, status: "ok", startedAt, endedAt, output, operation: result.operation || "" });
      console.log(`${name}: ok`);
    } catch (error) {
      const endedAt = new Date().toISOString();
      const output = `${name}.error.json`;
      const payload = { name, input, message: String(error?.message || error), stack: error?.stack || "", startedAt, endedAt };
      await fs.writeFile(path.join(outDir, output), JSON.stringify(payload, null, 2) + "\n");
      results.push({ name, status: "failed", startedAt, endedAt, output, error: payload.message });
      console.error(`${name}: failed: ${payload.message}`);
      return { ok: false, results };
    }
  }
  return { ok: true, results };
}

async function readDbEvidence(dbFile, { templateId, workflowId, planId }) {
  const templateRows = await sqlite(dbFile, `
SELECT template_id AS templateId, family_status AS familyStatus, default_version AS defaultVersion, active_version AS activeVersion
FROM workflow_v2_template_specs
WHERE template_id=${sqlValue(templateId)};`, { json: true });
  const versionRows = await sqlite(dbFile, `
SELECT template_id AS templateId, version, status
FROM workflow_v2_template_versions
WHERE template_id=${sqlValue(templateId)}
ORDER BY version;`, { json: true });
  const planRows = await sqlite(dbFile, `
SELECT plan_id AS planId, workflow_id AS workflowId, status, workflow_state AS workflowState, task_owner_agent AS taskOwnerAgent, planner_agent AS plannerAgent, plan_spec_artifact_ref AS planSpecArtifactRef
FROM workflow_v2_plans
WHERE plan_id=${sqlValue(planId)};`, { json: true });
  const nodeRows = await sqlite(dbFile, `
SELECT node_id AS nodeId, status, owner_agent AS ownerAgent, runtime_backend AS runtimeBackend
FROM workflow_v2_plan_nodes
WHERE plan_id=${sqlValue(planId)}
ORDER BY node_id;`, { json: true });
  const artifactCount = await scalarCount(dbFile, `
SELECT COUNT(*) AS count FROM artifact_index WHERE workflow_id=${sqlValue(workflowId)};`);
  return { templateRows, versionRows, planRows, nodeRows, artifactCount };
}

async function sideEffectCounts(dbFile, workflowId) {
  const counts = {};
  if (await tableExists(dbFile, "runtime_runs")) {
    counts.runtimeRuns = await scalarCount(dbFile, `SELECT COUNT(*) AS count FROM runtime_runs WHERE workflow_id=${sqlValue(workflowId)};`);
  }
  if (await tableExists(dbFile, "message_flows")) {
    counts.messageFlows = await scalarCount(dbFile, `SELECT COUNT(*) AS count FROM message_flows WHERE workflow_id=${sqlValue(workflowId)};`);
  }
  if (await tableExists(dbFile, "telegram_outbox")) {
    counts.telegramOutbox = await scalarCount(dbFile, `
SELECT COUNT(*) AS count FROM telegram_outbox
WHERE instr(payload_json, ${sqlValue(workflowId)}) > 0 OR instr(text, ${sqlValue(workflowId)}) > 0;`);
  }
  if (await tableExists(dbFile, "side_effect_ledger")) {
    counts.sideEffectLedger = await scalarCount(dbFile, `SELECT COUNT(*) AS count FROM side_effect_ledger WHERE workflow_id=${sqlValue(workflowId)};`);
  }
  if (await tableExists(dbFile, "executable_trade_intents")) {
    const columns = await tableColumns(dbFile, "executable_trade_intents");
    const where = columns.has("workflow_id")
      ? `workflow_id=${sqlValue(workflowId)}`
      : `instr(payload_json, ${sqlValue(workflowId)}) > 0 OR instr(idempotency_key, ${sqlValue(workflowId)}) > 0`;
    counts.executableTradeIntents = await scalarCount(dbFile, `SELECT COUNT(*) AS count FROM executable_trade_intents WHERE ${where};`);
  }
  return counts;
}

function allZero(counts) {
  return Object.values(counts).every((value) => Number(value || 0) === 0);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const explicitRoot = Boolean(options.root);
  const root = explicitRoot
    ? path.resolve(String(options.root))
    : await fs.mkdtemp(path.join(os.tmpdir(), "workflow-v2-fixed-template-canary-"));
  const tempRoot = root.startsWith(path.resolve(os.tmpdir()) + path.sep);
  const persistentRoot = explicitRoot && !tempRoot;
  if (persistentRoot && !boolOption(options["allow-persistent-root"], false)) {
    throw new Error("refusing to write a non-temp workflow root without --allow-persistent-root");
  }

  const runId = safeSegment(options["run-id"] || utcCompact());
  const outDir = path.resolve(String(options.out || path.join(root, "canary-results", runId)));
  const retireAfter = boolOption(options["retire-after"], persistentRoot);
  await fs.mkdir(outDir, { recursive: true });

  const templateId = `template.workflow.v2.canary.${runId}`;
  const workflowId = `wf-v2-canary-${runId}`;
  const planId = `${workflowId}.plan`;
  const objective = `Run low-risk fixed-template workflow v2 canary ${runId}; verify template registry, plan materialization, nodes, artifacts, and receipts without external notification.`;
  const paths = workflowPaths(root, { workflowRootDir: root });
  const backup = await maybeBackupDatabase(paths.dbFile, options["backup-dir"] ? path.resolve(String(options["backup-dir"])) : "", runId);
  const steps = canarySteps({ runId, templateId, workflowId, planId, objective, retireAfter });
  const stepResult = await runSteps(root, outDir, steps);
  const dbEvidence = await readDbEvidence(paths.dbFile, { templateId, workflowId, planId });
  const sideEffects = await sideEffectCounts(paths.dbFile, workflowId);
  const planArtifact = dbEvidence.planRows[0]?.planSpecArtifactRef
    ? path.join(root, dbEvidence.planRows[0].planSpecArtifactRef)
    : "";
  const planArtifactExists = planArtifact ? await pathExists(planArtifact) : false;

  const summary = {
    ok: stepResult.ok && allZero(sideEffects) && dbEvidence.planRows.length === 1 && dbEvidence.nodeRows.length === 2 && planArtifactExists,
    root,
    dbFile: paths.dbFile,
    persistentRoot,
    runId,
    templateId,
    workflowId,
    planId,
    objective,
    outDir,
    backup,
    retireAfter,
    results: stepResult.results,
    dbEvidence,
    sideEffects,
    planArtifact,
    planArtifactExists
  };
  await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

  assert.equal(stepResult.ok, true, "canary action sequence failed");
  assert.equal(dbEvidence.planRows.length, 1, "canary plan row missing");
  assert.equal(dbEvidence.nodeRows.length, 2, "canary plan nodes missing");
  assert.equal(planArtifactExists, true, "canary plan artifact missing");
  assert.equal(allZero(sideEffects), true, `canary created external side effects: ${JSON.stringify(sideEffects)}`);

  console.log(JSON.stringify({
    ok: true,
    root,
    outDir,
    runId,
    templateId,
    workflowId,
    planId,
    retireAfter,
    sideEffects,
    planArtifact
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
