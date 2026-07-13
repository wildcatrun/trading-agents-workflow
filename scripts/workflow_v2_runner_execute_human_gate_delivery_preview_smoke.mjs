#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
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

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function publicTarget(kind, ref) {
  const text = String(ref || "");
  return {
    kind: kind || "",
    refRedacted: text ? `${text.slice(0, 2)}...${text.slice(-2)}` : "",
    refHash: text ? `sha256:${sha256(text)}` : ""
  };
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "workflow-v2-runner-execute-hgate-delivery-preview";
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

function publicDeliveryPreviewSummary(preview = {}) {
  return {
    action: preview.action || "",
    readOnly: Boolean(preview.readOnly),
    writeBoundary: preview.writeBoundary || "",
    outboxId: preview.outboxId || "",
    status: preview.status || "",
    messageType: preview.messageType || "",
    target: publicTarget(preview.targetKind, preview.targetRef),
    targetRequired: Boolean(preview.targetRequired),
    account: preview.account || "",
    eligible: Boolean(preview.eligible),
    claimEligible: Boolean(preview.claimEligible),
    claimReason: preview.claimReason || "",
    chunkCount: preview.chunkCount || 0,
    pendingChunkCount: preview.pendingChunkCount || 0,
    buttonSummary: preview.buttonSummary || {},
    deliveryPath: preview.deliveryPath || {},
    executionPolicy: {
      futureAction: preview.executionPolicy?.futureAction || "",
      governanceReady: Boolean(preview.executionPolicy?.governanceReady),
      evidencePresence: preview.executionPolicy?.evidencePresence || {},
      hardStopCodes: (preview.executionPolicy?.hardStops || []).map((item) => item.code || "").filter(Boolean),
      warningCodes: (preview.executionPolicy?.warnings || []).map((item) => item.code || "").filter(Boolean)
    },
    receiptPolicy: preview.receiptPolicy || {},
    wouldSendTelegram: Boolean(preview.wouldSendTelegram),
    wouldInvokeOpenClawCli: Boolean(preview.wouldInvokeOpenClawCli),
    wouldReadTelegramCredential: preview.wouldReadBotToken || "",
    wouldUpdate: preview.wouldUpdate || {}
  };
}

function publicRequeuePreviewSummary(preview = {}) {
  return {
    action: preview.action || "",
    readOnly: Boolean(preview.readOnly),
    writeBoundary: preview.writeBoundary || "",
    outboxId: preview.outboxId || "",
    status: preview.status || "",
    messageType: preview.messageType || "",
    target: publicTarget(preview.targetKind, preview.targetRef),
    account: preview.account || "",
    eligible: Boolean(preview.eligible),
    requeueEligible: Boolean(preview.requeueEligible),
    deliveryExecutionEligible: Boolean(preview.deliveryExecutionEligible),
    governanceReady: Boolean(preview.governanceReady),
    strategy: preview.strategy || "",
    recommendedNextAction: preview.recommendedNextAction || "",
    wouldRequeue: Boolean(preview.wouldRequeue),
    wouldResendTelegram: Boolean(preview.wouldResendTelegram),
    wouldInvokeOpenClawCli: Boolean(preview.wouldInvokeOpenClawCli),
    requeuePolicy: preview.requeuePolicy || {},
    executionPolicy: {
      futureAction: preview.executionPolicy?.futureAction || "",
      governanceReady: Boolean(preview.executionPolicy?.governanceReady),
      evidencePresence: preview.executionPolicy?.evidencePresence || {},
      hardStopCodes: (preview.executionPolicy?.hardStops || []).map((item) => item.code || "").filter(Boolean),
      warningCodes: (preview.executionPolicy?.warnings || []).map((item) => item.code || "").filter(Boolean)
    },
    wouldUpdate: preview.wouldUpdate || {}
  };
}

function assertNoTokenLeak(label, value) {
  const badPaths = [];
  const visit = (node, pathParts = []) => {
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && /tawhg:|toolAction|feedbackToolAction|cliCommand|feedbackCliCommand/i.test(node)) {
        badPaths.push(pathParts.join(".") || "<value>");
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, [...pathParts, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      const allowedPresenceFlag = key === "callbackTokenPresent";
      if (!allowedPresenceFlag && /callbackToken|callback_token|callbackData|callback_data|botToken|bot_token|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|privateKey|private_key|brokerKey|broker_key/i.test(key)) {
        badPaths.push([...pathParts, key].join("."));
      }
      visit(child, [...pathParts, key]);
    }
  };
  visit(value);
  assert.deepEqual(badPaths, [], `${label} leaked sensitive token material`);
}

async function outboxRow(dbFile, outboxId) {
  return sqliteOne(dbFile, `
SELECT outbox_id AS outboxId, meeting_id AS meetingId, target_kind AS targetKind, target_ref AS targetRef,
       message_type AS messageType, status, text, payload_json AS payloadJson, created_at AS createdAt, updated_at AS updatedAt
FROM telegram_outbox
WHERE outbox_id=${sqlValue(outboxId)}
LIMIT 1;`);
}

async function updateOutboxStatus(dbFile, outboxId, { status, updatedAt, payload }) {
  const assignments = [
    `status=${sqlValue(status)}`,
    `updated_at=${sqlValue(updatedAt)}`
  ];
  if (payload) assignments.push(`payload_json=${sqlValue(JSON.stringify(payload))}`);
  await sqlite(dbFile, `
UPDATE telegram_outbox
SET ${assignments.join(", ")}
WHERE outbox_id=${sqlValue(outboxId)};`);
}

const runId = safeSegment(firstText(argValue("--run-id"), utcCompact()));
const root = firstText(argValue("--root"), await fs.mkdtemp(path.join(os.tmpdir(), "workflow-v2-runner-execute-hgate-delivery-preview-")));
const workflowId = firstText(argValue("--workflow-id"), `wf-v2-runner-execute-hgate-delivery-preview-${runId}`);
const planId = firstText(argValue("--plan-id"), `${workflowId}.plan`);
const outDir = path.resolve(firstText(argValue("--out"), path.join(root, "artifacts", "workflow-v2", "runner-execute-human-gate-delivery-preview", runId)));
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
assert.ok(requestResult.telegramOutboxId);

const outboxId = requestResult.telegramOutboxId;
const queuedOutbox = await outboxRow(dbFile, outboxId);
assert.equal(queuedOutbox.outboxId, outboxId);
assert.equal(queuedOutbox.meetingId, workflowId);
assert.equal(queuedOutbox.targetKind, "private");
assert.equal(queuedOutbox.targetRef, "8390724843");
assert.equal(queuedOutbox.messageType, "human_gate_request");
assert.equal(queuedOutbox.status, "queued");
assert.equal(queuedOutbox.text.includes("猫爪正式汇报"), true);
const queuedPayload = JSON.parse(queuedOutbox.payloadJson);
assert.equal(queuedPayload.humanGateId, requestResult.humanGateId);
assert.equal(queuedPayload.workflowId, workflowId);
assert.equal(queuedPayload.account, "cat_claw");
assert.equal(queuedPayload.targetKind, "private");
assert.equal(queuedPayload.targetRef, "8390724843");
assert.equal(Array.isArray(queuedPayload.buttons), true);
assert.equal(queuedPayload.buttons.length, 5);

const deliveryPreviewCountsBefore = {
  outbox: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM telegram_outbox;")).count || 0),
  protocolObjects: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM protocol_objects;")).count || 0),
  buttons: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM human_gate_buttons;")).count || 0),
  runtimeRuns: await optionalSqliteCount(dbFile, "runtime_runs", `workflow_id=${sqlValue(workflowId)}`)
};
const queuedDeliveryPreview = await runAction(root, {
  action: "telegram.outbox.delivery.preview",
  outboxId,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  deliveryOperatorReason: "Smoke preview only: verify Cat Claw Human Gate delivery governance before any Telegram send."
});
assert.equal(queuedDeliveryPreview.readOnly, true);
assert.equal(queuedDeliveryPreview.writeBoundary, "preview_only");
assert.equal(queuedDeliveryPreview.status, "queued");
assert.equal(queuedDeliveryPreview.messageType, "human_gate_request");
assert.equal(queuedDeliveryPreview.targetKind, "private");
assert.equal(queuedDeliveryPreview.targetRef, "8390724843");
assert.equal(queuedDeliveryPreview.account, "cat_claw");
assert.equal(queuedDeliveryPreview.eligible, true);
assert.equal(queuedDeliveryPreview.claimEligible, true);
assert.equal(queuedDeliveryPreview.executionPolicy.governanceReady, true);
assert.equal(queuedDeliveryPreview.buttonSummary.buttonCount, 5);
assert.equal(queuedDeliveryPreview.buttonSummary.payloadButtonCount, 5);
assert.equal(queuedDeliveryPreview.deliveryPath.directBotApiWebAppCandidate, false);
assert.deepEqual(queuedDeliveryPreview.deliveryPath.modeOrder, ["openclaw_message_send"]);
assert.equal(queuedDeliveryPreview.wouldReadBotToken, "no");
assert.equal(queuedDeliveryPreview.wouldSendTelegram, true);
assert.equal(queuedDeliveryPreview.wouldInvokeOpenClawCli, true);
assert.equal(queuedDeliveryPreview.wouldUpdate.telegramOutboxStatus, "delivering_then_sent_or_failed");
assert.equal(queuedDeliveryPreview.wouldUpdate.messageFlowDelivery, "unchanged");
const deliveryPreviewCountsAfter = {
  outbox: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM telegram_outbox;")).count || 0),
  protocolObjects: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM protocol_objects;")).count || 0),
  buttons: Number((await sqliteOne(dbFile, "SELECT COUNT(*) AS count FROM human_gate_buttons;")).count || 0),
  runtimeRuns: await optionalSqliteCount(dbFile, "runtime_runs", `workflow_id=${sqlValue(workflowId)}`)
};
assert.deepEqual(deliveryPreviewCountsAfter, deliveryPreviewCountsBefore);
assert.equal((await outboxRow(dbFile, outboxId)).status, "queued");

const queuedRequeuePreview = await runAction(root, {
  action: "telegram.outbox.requeue.preview",
  outboxId,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  requeueOperatorReason: "Smoke preview only: queued outbox should not be requeued."
});
assert.equal(queuedRequeuePreview.readOnly, true);
assert.equal(queuedRequeuePreview.requeueEligible, false);
assert.equal(queuedRequeuePreview.strategy, "already_queued");
assert.equal(queuedRequeuePreview.wouldResendTelegram, false);
assert.equal(queuedRequeuePreview.wouldUpdate.telegramOutboxStatus, "unchanged");

await updateOutboxStatus(dbFile, outboxId, {
  status: "failed",
  updatedAt: "2026-07-13T00:01:00.000Z",
  payload: {
    ...queuedPayload,
    delivery: {
      channel: "telegram",
      account: "cat_claw",
      target: "8390724843",
      failedAt: "2026-07-13T00:01:00.000Z",
      error: "synthetic failed delivery for preview-only smoke",
      receipts: []
    }
  }
});
const failedRequeuePreview = await runAction(root, {
  action: "telegram.outbox.requeue.preview",
  outboxId,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  requeueOperatorReason: "Smoke preview only: failed Human Gate notification may be retried under governance."
});
assert.equal(failedRequeuePreview.readOnly, true);
assert.equal(failedRequeuePreview.requeueEligible, true);
assert.equal(failedRequeuePreview.deliveryExecutionEligible, true);
assert.equal(failedRequeuePreview.governanceReady, true);
assert.equal(failedRequeuePreview.strategy, "retry_failed_delivery");
assert.equal(failedRequeuePreview.requeuePolicy.preserveOutboxId, true);
assert.equal(failedRequeuePreview.requeuePolicy.preserveHumanGateId, true);
assert.equal(failedRequeuePreview.requeuePolicy.preserveButtonIds, true);
assert.equal(failedRequeuePreview.requeuePolicy.createNewHumanGateRequest, false);
assert.equal(failedRequeuePreview.requeuePolicy.createNewTelegramOutbox, false);
assert.equal(failedRequeuePreview.wouldResendTelegram, true);
assert.equal((await outboxRow(dbFile, outboxId)).status, "failed");

const requeueExecutionPackagePreview = await runAction(root, {
  action: "telegram.outbox.requeue.execution_package.preview",
  outboxId,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  requeueOperatorReason: "Smoke preview only: package failed Human Gate notification redelivery for Cat Claw review."
});
assert.equal(requeueExecutionPackagePreview.readOnly, true);
assert.equal(requeueExecutionPackagePreview.readyForCatClawReview, true);
assert.equal(requeueExecutionPackagePreview.readyForExecutionRequest, true);
assert.equal(requeueExecutionPackagePreview.didSendTelegram, false);
assert.equal(requeueExecutionPackagePreview.didCreateHumanGate, false);
assert.equal(requeueExecutionPackagePreview.didCreateOutbox, false);
assert.equal(requeueExecutionPackagePreview.auditBoundary.noParallelHumanGate, true);
assert.equal(requeueExecutionPackagePreview.auditBoundary.noParallelOutbox, true);

await updateOutboxStatus(dbFile, outboxId, {
  status: "delivering",
  updatedAt: "2000-01-01T00:00:00.000Z",
  payload: {
    ...queuedPayload,
    deliveryClaim: {
      claimId: "synthetic-stale-claim",
      claimedAt: "2000-01-01T00:00:00.000Z",
      owner: "smoke",
      previousStatus: "queued"
    }
  }
});
const staleRequeuePreview = await runAction(root, {
  action: "telegram.outbox.requeue.preview",
  outboxId,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  requeueOperatorReason: "Smoke preview only: stale delivering lease may be reclaimed under governance."
});
assert.equal(staleRequeuePreview.readOnly, true);
assert.equal(staleRequeuePreview.writeBoundary, "preview_only");
assert.equal(staleRequeuePreview.requeueEligible, true);
assert.equal(staleRequeuePreview.governanceReady, true);
assert.equal(staleRequeuePreview.strategy, "reclaim_stale_delivery_lease");
assert.equal(staleRequeuePreview.wouldResendTelegram, true);
assert.equal((await outboxRow(dbFile, outboxId)).status, "delivering");

await updateOutboxStatus(dbFile, outboxId, {
  status: "sent",
  updatedAt: "2026-07-13T00:02:00.000Z",
  payload: {
    ...queuedPayload,
    delivery: {
      channel: "telegram",
      account: "cat_claw",
      target: "8390724843",
      deliveredAt: "2026-07-13T00:02:00.000Z",
      receipts: [{ message_id: 1, chat: { id: 8390724843 }, date: 1783900920 }]
    }
  }
});
const sentDeliveryReplay = await runAction(root, {
  action: "telegram.outbox.delivery",
  outboxId,
  idempotencyKey: `${workflowId}:delivery-replay`,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  deliveryOperatorReason: "Smoke preview only: sent outbox must be idempotent replay without Telegram send."
});
assert.equal(sentDeliveryReplay.idempotentReplay, true);
assert.equal(sentDeliveryReplay.didSendTelegram, false);
assert.equal(sentDeliveryReplay.didUpdateOutbox, false);
assert.equal(sentDeliveryReplay.deliveryStatus, "sent");
const sentRequeuePreview = await runAction(root, {
  action: "telegram.outbox.requeue.preview",
  outboxId,
  catClawAuditId: catClawAudit.catClawAudit.auditId,
  requeueOperatorReason: "Smoke preview only: sent outbox must not be requeued."
});
assert.equal(sentRequeuePreview.readOnly, true);
assert.equal(sentRequeuePreview.writeBoundary, "preview_only");
assert.equal(sentRequeuePreview.requeueEligible, false);
assert.equal(sentRequeuePreview.strategy, "terminal_sent_idempotent_replay_only");
assert.equal(sentRequeuePreview.wouldResendTelegram, false);
assert.equal((await outboxRow(dbFile, outboxId)).status, "sent");

await updateOutboxStatus(dbFile, outboxId, {
  status: "queued",
  updatedAt: queuedOutbox.updatedAt,
  payload: queuedPayload
});
assert.equal((await outboxRow(dbFile, outboxId)).status, "queued");

const deliveryGovernance = {
  outbox: {
    outboxId,
    meetingId: queuedOutbox.meetingId,
    target: publicTarget(queuedOutbox.targetKind, queuedOutbox.targetRef),
    messageType: queuedOutbox.messageType,
    status: "queued",
    textLength: queuedOutbox.text.length,
    humanGateId: queuedPayload.humanGateId,
    account: queuedPayload.account,
    buttonCount: queuedPayload.buttons.length
  },
  queuedDeliveryPreview: publicDeliveryPreviewSummary(queuedDeliveryPreview),
  queuedRequeuePreview: publicRequeuePreviewSummary(queuedRequeuePreview),
  failedRequeuePreview: publicRequeuePreviewSummary(failedRequeuePreview),
  requeueExecutionPackagePreview: {
    action: requeueExecutionPackagePreview.action,
    readOnly: requeueExecutionPackagePreview.readOnly,
    writeBoundary: requeueExecutionPackagePreview.writeBoundary,
    outboxId: requeueExecutionPackagePreview.outboxId,
    humanGateId: requeueExecutionPackagePreview.humanGateId,
    status: requeueExecutionPackagePreview.status,
    strategy: requeueExecutionPackagePreview.strategy,
    requeueEligible: requeueExecutionPackagePreview.requeueEligible,
    governanceReady: requeueExecutionPackagePreview.governanceReady,
    readyForCatClawReview: requeueExecutionPackagePreview.readyForCatClawReview,
    readyForExecutionRequest: requeueExecutionPackagePreview.readyForExecutionRequest,
    didSendTelegram: requeueExecutionPackagePreview.didSendTelegram,
    didCreateHumanGate: requeueExecutionPackagePreview.didCreateHumanGate,
    didCreateOutbox: requeueExecutionPackagePreview.didCreateOutbox,
    auditBoundary: requeueExecutionPackagePreview.auditBoundary,
    optionCount: requeueExecutionPackagePreview.package?.options?.length || 0,
    controlCount: requeueExecutionPackagePreview.package?.controls?.length || 0
  },
  staleRequeuePreview: publicRequeuePreviewSummary(staleRequeuePreview),
  sentDeliveryReplay: {
    action: sentDeliveryReplay.action,
    outboxId: sentDeliveryReplay.outboxId,
    deliveryStatus: sentDeliveryReplay.deliveryStatus,
    idempotentReplay: Boolean(sentDeliveryReplay.idempotentReplay),
    didSendTelegram: Boolean(sentDeliveryReplay.didSendTelegram),
    didUpdateOutbox: Boolean(sentDeliveryReplay.didUpdateOutbox),
    didUpdateMessageFlow: Boolean(sentDeliveryReplay.didUpdateMessageFlow),
    receiptCount: sentDeliveryReplay.receiptCount || 0
  },
  sentRequeuePreview: publicRequeuePreviewSummary(sentRequeuePreview)
};
assertNoTokenLeak("deliveryGovernance", deliveryGovernance);

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
  telegramOutboxId: requestResult.telegramOutboxId,
  target: publicTarget(requestResult.targetKind, requestResult.targetRef),
  buttons: publicButtonSummary(requestResult.buttons)
};
assertNoTokenLeak("sanitizedRequest", sanitizedRequest);

const summary = {
  ok: true,
  schemaVersion: "workflow_v2_runner_execute_human_gate_delivery_preview_smoke.v1",
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
  deliveryGovernance,
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
assert.equal(JSON.stringify(summary).includes("8390724843"), false, "summary leaked raw target ref");

const indexFile = path.join(outDir, "index.json");
await writeJson(indexFile, summary);
console.log(JSON.stringify({ ...summary, indexFile }, null, 2));
