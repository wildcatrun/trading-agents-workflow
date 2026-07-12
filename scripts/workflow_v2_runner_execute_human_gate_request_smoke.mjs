#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAction } from "../src/core.js";
import { sqlValue, sqlite } from "../src/workflow/sqlite.js";

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

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "workflow-v2-runner-execute-hgate-request";
}

function utcCompact() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function sqliteOne(dbFile, query) {
  const rows = await sqlite(dbFile, query, { json: true });
  return rows[0] || {};
}

async function optionalSqliteCount(dbFile, tableName, where = "1=1") {
  try {
    const row = await sqliteOne(dbFile, `SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where};`);
    return Number(row.count || 0);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || error))) return 0;
    throw error;
  }
}

function authorizationOptions({ workflowId, planId }) {
  return [
    {
      optionId: "approve_single_synthetic_execute_smoke",
      title: "方案 A：批准一次单 worker synthetic execute smoke",
      summary: "仅允许对一个 synthetic worker adapter job 执行真实 wrapper；maxActiveJobs=1；不挂载 secrets；network=none；不触达交易流程。",
      body: [
        "批准后，执行范围仅限 workflow v2 external runner 的单 worker synthetic smoke。",
        "执行命令必须同时具备 --execute 和 TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE=1。",
        "Docker host 限定为受控 wsl-agents 测试面；不得在 OpenClaw Gateway、生产服务器或猫成员常驻 runtime 上执行。",
        "容器不得挂载真实 OAuth/API/broker/private key；不得开放端口；不得调用真实交易链路。"
      ].join("\n"),
      prompt: "如选择本方案，请确认：仅一次、单 worker、synthetic-only、无 secrets、network=none、maxActiveJobs=1，并要求执行后回传日志、artifact 和 receipt。",
      rollback: "如执行失败、超时或副作用不确定，立即停止 runner，保留 stdout/stderr/request/output/receipt artifact，将 adapter job 标记 failed 或 retry_scheduled，禁止重试真实副作用，重新提交 Human Gate。",
      approvalPayload: {
        decision: "approve_single_synthetic_execute_smoke",
        workflowId,
        planId,
        maxActiveJobs: 1,
        syntheticOnly: true,
        allowSecrets: false,
        networkMode: "none",
        allowTrading: false,
        requireExecuteFlag: true,
        requireEnvironmentGate: "TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE=1"
      }
    },
    {
      optionId: "keep_execute_disabled_collect_evidence",
      title: "方案 B：保持 execute 禁用，继续补证",
      summary: "不批准真实执行；继续使用 execute-guard、plan-only、dry-run 和 release/retry_scheduled 证据补齐运行边界。",
      body: [
        "保持 workflow_v2_external_runner_execute_guard 的默认拒绝执行状态。",
        "继续生成 plan-only artifact、命令计划、日志路径和回滚检查表。",
        "待猫爪复核 Docker host、镜像 digest、secret policy、网络和日志路径后，再重新提交 Human Gate。"
      ].join("\n"),
      prompt: "如选择本方案，请要求继续补齐 Docker/image/secret/network/log/rollback 证据，不进行任何真实 runtime 执行。",
      rollback: "无真实执行副作用；保留当前 execute-guard 默认拒绝状态，继续让 adapter job release/retry_scheduled，不进入 worker_result.submit。",
      approvalPayload: {
        decision: "keep_execute_disabled_collect_evidence",
        workflowId,
        planId,
        executeAllowed: false,
        continueDryRunOnly: true
      }
    }
  ];
}

function publicButtonSummary(buttons = []) {
  return buttons.map((button) => ({
    buttonId: button.buttonId || button.button_id || "",
    label: button.label || "",
    decisionStatus: button.decisionStatus || button.decision_status || "",
    role: button.role || button.button_role || "",
    optionId: button.payload?.optionId || button.payload?.option_id || "",
    callbackTokenPresent: Boolean(button.callbackToken || button.callback_token || button.callbackData || button.callback_data)
  }));
}

function assertNoTokenLeak(label, value) {
  const text = JSON.stringify(value);
  assert.equal(/callbackToken(?!Present)|callback_token|callbackData|callback_data|tawhg:|toolAction|feedbackToolAction|cliCommand|feedbackCliCommand/.test(text), false, `${label} leaked callback token material`);
}

const runId = safeSegment(firstText(argValue("--run-id"), utcCompact()));
const root = firstText(argValue("--root"), await fs.mkdtemp(path.join(os.tmpdir(), "workflow-v2-runner-execute-hgate-request-")));
const workflowId = firstText(argValue("--workflow-id"), `wf-v2-runner-execute-hgate-request-${runId}`);
const planId = firstText(argValue("--plan-id"), `${workflowId}.plan`);
const outDir = path.resolve(firstText(argValue("--out"), path.join(root, "artifacts", "workflow-v2", "runner-execute-human-gate-request", runId)));
const packageId = firstText(argValue("--package-id"), `${workflowId}.hgate.execute`);
const catBrainAuditId = `${workflowId}.cat-brain-audit`;
const previousRegistryWriteGate = process.env.TRADING_AGENTS_WORKFLOW_LOCAL_CODEX_REGISTRY_WRITE;

await runAction(root, { action: "workflow.init" });
process.env.TRADING_AGENTS_WORKFLOW_LOCAL_CODEX_REGISTRY_WRITE = "1";
for (const agent of [
  { agentId: "main", runtime: "openclaw", platform: "openclaw", permissions: ["workflow.write", "workflow.verify"] },
  { agentId: "cat_claw", runtime: "openclaw", platform: "openclaw", permissions: ["cat_claw.audit", "human_gate.write"] },
  { agentId: "cat_heart", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] },
  { agentId: "cat_body", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] }
]) {
  await runAction(root, {
    action: "runtime.agent.upsert",
    callerAgent: "local_codex",
    callerRuntime: "local_codex",
    sourceSystem: "local_codex",
    agentId: agent.agentId,
    runtime: agent.runtime,
    platform: agent.platform,
    capabilities: { permissions: agent.permissions }
  });
}
if (previousRegistryWriteGate === undefined) {
  delete process.env.TRADING_AGENTS_WORKFLOW_LOCAL_CODEX_REGISTRY_WRITE;
} else {
  process.env.TRADING_AGENTS_WORKFLOW_LOCAL_CODEX_REGISTRY_WRITE = previousRegistryWriteGate;
}
const plan = await runAction(root, {
  action: "workflow.v2.plan.create",
  workflowId,
  planId,
  taskOwnerAgent: "cat_heart",
  plannerAgent: "main",
  objective: "Prepare a governed Human Gate request for a future workflow v2 runner execute authorization.",
  humanGateRequired: true,
  participantManagers: ["cat_body"],
  acceptanceCriteria: [
    "Human Gate package has two Chinese decision options.",
    "Formal request is submitted by cat_claw only.",
    "No worker wrapper execute is performed during request creation."
  ],
  nodes: [
    {
      nodeId: `${planId}.cat-claw-package`,
      nodeType: "cat_claw_audit",
      ownerAgent: "cat_claw",
      runtimeBackend: "local_deterministic"
    }
  ],
  createdBy: "main"
});
const dbFile = plan.dbFile;

await sqlite(dbFile, `
INSERT INTO workflow_v2_cat_brain_audits(audit_id, workflow_id, plan_id, task_group_package_id, cat_brain_agent, decision, scope, summary, findings_json, evidence_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(catBrainAuditId)}, ${sqlValue(workflowId)}, ${sqlValue(planId)}, '', 'main', 'needs_human_gate', 'governance_semantic', 'Cat Brain audit confirms runner execute must stop at Human Gate authorization before any real wrapper execution.', '[]', ${sqlValue(JSON.stringify(["artifact://workflow-v2/runner-execute-guard", "artifact://workflow-v2/runner-execute-human-gate-package"]))}, ${sqlValue(JSON.stringify({ sourceKind: "runner_execute_authorization", nextWorkflowState: "waiting_cat_claw_audit" }))}, 'main', '2026-07-13T00:00:00.000Z', '2026-07-13T00:00:00.000Z')
ON CONFLICT(audit_id) DO UPDATE SET
  decision=excluded.decision,
  summary=excluded.summary,
  evidence_refs_json=excluded.evidence_refs_json,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);

const catClawAudit = await runAction(root, {
  action: "workflow.v2.cat_claw_audit.record",
  workflowId,
  planId,
  catBrainAuditId,
  callerAgent: "cat_claw",
  decision: "protocol_ready",
  summary: "猫爪复核通过：真实 worker wrapper execute 只能通过正式 Human Gate 授权，当前请求只创建 pending Human Gate，不执行 runtime。",
  checks: [
    "two_chinese_options_present",
    "pause_and_terminate_controls_required",
    "no_execute_in_request_creation",
    "token_bound_button_flow_required"
  ],
  evidenceRefs: [
    "script://scripts/workflow_v2_external_runner_execute_guard.mjs",
    "script://scripts/workflow_v2_runner_execute_human_gate_package.mjs",
    "doc://docs/workflow-v2-worker-runtime-backends.md"
  ]
});
assert.equal(catClawAudit.catClawAudit.decision, "protocol_ready");

const hgatePackage = await runAction(root, {
  action: "workflow.v2.human_gate_package.record",
  workflowId,
  planId,
  packageId,
  sourceCatClawAuditId: catClawAudit.catClawAudit.auditId,
  status: "cat_claw_audited",
  createdBy: "cat_claw",
  options: authorizationOptions({ workflowId, planId }),
  evidenceRefs: [
    "script://scripts/workflow_v2_external_runner_execute_guard.mjs",
    "script://scripts/workflow_v2_runner_execute_human_gate_package.mjs",
    "doc://docs/workflow-v2-worker-runtime-backends.md"
  ],
  payload: {
    submissionKind: "release_gate",
    interactionType: "release_gate",
    responseSchema: {
      required: ["buttonSelection", "flashcatOriginalWords"],
      flashcatOriginalWordsRequired: true
    },
    resumeContract: {
      approved: "resume_or_continue_from_selected_release_gate_option",
      rejected: "return_to_cat_claw_or_task_owner",
      paused: "pause_workflow",
      terminated: "closeout_and_archive"
    },
    authorizationScope: "workflow_v2_runner_execute",
    executesInThisPackage: false
  }
});
assert.equal(hgatePackage.valid, true);
assert.equal(hgatePackage.humanGatePackage.status, "cat_claw_audited");
assert.equal(hgatePackage.humanGatePackage.options.length, 2);

const previewCountsBefore = {
  protocolObjects: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM protocol_objects;")).count || 0),
  buttons: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM human_gate_buttons;")).count || 0),
  outbox: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM telegram_outbox;")).count || 0)
};
const requestPreview = await runAction(root, {
  action: "workflow.v2.human_gate_request.preview",
  packageId,
  workflowId,
  planId,
  callerAgent: "cat_claw"
});
assert.equal(requestPreview.eligible, true);
assert.equal(requestPreview.writeReady, true);
assert.equal(requestPreview.buttonSummary.planCount, 2);
assert.equal(requestPreview.buttonSummary.hasPause, true);
assert.equal(requestPreview.buttonSummary.hasTerminate, true);
assert.equal(requestPreview.wouldCreate.humanGateRecords, 1);
assert.equal(requestPreview.wouldCreate.telegramOutbox, 1);
assert.equal(requestPreview.wouldCreate.runtimeDispatches, 0);
assertNoTokenLeak("human_gate_request.preview.requestDraft", requestPreview.requestDraft);
const previewCountsAfter = {
  protocolObjects: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM protocol_objects;")).count || 0),
  buttons: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM human_gate_buttons;")).count || 0),
  outbox: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM telegram_outbox;")).count || 0)
};
assert.deepEqual(previewCountsAfter, previewCountsBefore);

const requestResult = await runAction(root, {
  action: "workflow.v2.human_gate_request",
  packageId,
  workflowId,
  planId,
  callerAgent: "cat_claw"
});
assert.equal(requestResult.didCreateHumanGate, true);
assert.equal(requestResult.didCreateHumanGateButtons, true);
assert.equal(requestResult.didCreateTelegramOutbox, true);
assert.equal(requestResult.didSendTelegram, false);
assert.equal(requestResult.didDispatchRuntime, false);
assert.equal(requestResult.deliveryRequired, true);
assert.equal(requestResult.humanGateButtonCount, 5);

const pendingRecord = await sqliteOne(dbFile, `
SELECT status, payload_json AS payloadJson
FROM protocol_objects
WHERE object_id=${sqlValue(requestResult.humanGateId)}
  AND object_type='human_gate_record'
LIMIT 1;`);
assert.equal(pendingRecord.status, "pending");
const activeButtonRows = await sqlite(dbFile, `
SELECT button_id, label, decision_status, button_role, payload_json, callback_token
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(requestResult.humanGateId)}
  AND status='active'
ORDER BY created_at ASC;`, { json: true });
assert.equal(activeButtonRows.length, 5);
assert.equal(activeButtonRows.filter((row) => row.decision_status === "approved").length, 2);
assert.equal(activeButtonRows.filter((row) => row.button_role === "reject").length, 1);
assert.equal(activeButtonRows.filter((row) => row.button_role === "pause").length, 1);
assert.equal(activeButtonRows.filter((row) => row.button_role === "terminate").length, 1);

const optionB = requestResult.buttons.find((button) => button.payload?.optionId === "keep_execute_disabled_collect_evidence");
assert.ok(optionB?.callbackToken);
const closeResult = await runAction(root, {
  action: "human_gate.resume",
  token: optionB.callbackToken,
  text: "闪电猫原话：选择方案 B，保持 execute 禁用，继续补齐 Docker/image/secret/network/log/rollback 证据。"
});
assert.equal(closeResult.status, "approved");
assert.equal(closeResult.humanGateId, requestResult.humanGateId);
const closedRecord = await sqliteOne(dbFile, `
SELECT status, payload_json AS payloadJson
FROM protocol_objects
WHERE object_id=${sqlValue(requestResult.humanGateId)}
  AND object_type='human_gate_record'
LIMIT 1;`);
assert.equal(closedRecord.status, "approved");
assert.equal(JSON.parse(closedRecord.payloadJson).payload.humanGateFeedback.flashcatOriginalWords.includes("保持 execute 禁用"), true);
assert.equal(await optionalSqliteCount(dbFile, "workflow_v2_adapter_jobs"), 0);
assert.equal(await optionalSqliteCount(dbFile, "runtime_runs", `workflow_id=${sqlValue(workflowId)}`), 0);

const planState = await sqliteOne(dbFile, `
SELECT workflow_state AS workflowState
FROM workflow_v2_plans
WHERE plan_id=${sqlValue(planId)}
LIMIT 1;`);
assert.equal(planState.workflowState, "waiting_human");

const sanitizedRequest = {
  humanGateId: requestResult.humanGateId,
  packageId: requestResult.packageId,
  sourceCatClawAuditId: requestResult.sourceCatClawAuditId,
  submissionKind: requestResult.submissionKind,
  interactionType: requestResult.interactionType,
  stageKey: requestResult.stageKey,
  didCreateHumanGate: requestResult.didCreateHumanGate,
  didCreateHumanGateButtons: requestResult.didCreateHumanGateButtons,
  didCreateTelegramOutbox: requestResult.didCreateTelegramOutbox,
  didSendTelegram: requestResult.didSendTelegram,
  didDispatchRuntime: requestResult.didDispatchRuntime,
  deliveryRequired: requestResult.deliveryRequired,
  buttons: publicButtonSummary(requestResult.buttons)
};
assertNoTokenLeak("sanitizedRequest", sanitizedRequest);

const summary = {
  ok: true,
  schemaVersion: "workflow_v2_runner_execute_human_gate_request_smoke.v1",
  runId,
  root,
  dbFile,
  workflowId,
  planId,
  packageId,
  catBrainAuditId,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  requestPreview: {
    eligible: requestPreview.eligible,
    writeReady: requestPreview.writeReady,
    buttonSummary: requestPreview.buttonSummary,
    wouldCreate: requestPreview.wouldCreate,
    previewReadOnly: true
  },
  request: sanitizedRequest,
  optionBCloseout: {
    status: closeResult.status,
    humanGateId: closeResult.humanGateId,
    buttonId: closeResult.buttonId,
    callbackTokenPresent: Boolean(optionB.callbackToken),
    adapterJobsCreated: 0,
    runtimeRunsCreated: 0
  },
  planStateAfterCloseout: planState.workflowState
};

const indexFile = path.join(outDir, "index.json");
await writeJson(indexFile, summary);
console.log(JSON.stringify({ ...summary, indexFile }, null, 2));
