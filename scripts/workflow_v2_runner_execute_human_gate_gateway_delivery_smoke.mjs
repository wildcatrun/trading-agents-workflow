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

function boolFlag(name) {
  return process.argv.includes(name);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function redactedTargetRef(value) {
  const text = String(value || "");
  if (!text) return "";
  return `${text.slice(0, 2)}...${text.slice(-2)}`;
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "workflow-v2-runner-execute-hgate-gateway-delivery";
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

async function deliverySnapshot(dbFile) {
  return {
    outboxSent: await optionalSqliteCount(dbFile, "telegram_outbox", "status='sent'"),
    outboxFailed: await optionalSqliteCount(dbFile, "telegram_outbox", "status='failed'"),
    deliveryExecutionEvents: await optionalSqliteCount(dbFile, "workflow_events", "event_type='telegram.outbox.delivery.executed'"),
    runtimeRuns: await optionalSqliteCount(dbFile, "runtime_runs"),
    dispatches: await optionalSqliteCount(dbFile, "mixed_meeting_dispatches"),
    sideEffects: await optionalSqliteCount(dbFile, "side_effects")
  };
}

async function outboxRow(dbFile, outboxId) {
  return sqliteOne(dbFile, `SELECT outbox_id AS outboxId, status, target_kind AS targetKind, target_ref AS targetRef, message_type AS messageType, payload_json AS payloadJson FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`);
}

function fixtureButtons() {
  return [
    { buttonId: "btn-a", label: "批准方案 A：批准一次单 worker synthetic execute smoke", decisionStatus: "approved", role: "approve_option", optionId: "approve_single_synthetic_execute_smoke" },
    { buttonId: "btn-b", label: "批准方案 B：保持 execute 禁用，继续补证", decisionStatus: "approved", role: "approve_option", optionId: "keep_execute_disabled_collect_evidence" },
    { buttonId: "btn-reject", label: "退回补证/修改", decisionStatus: "rejected", role: "reject" },
    { buttonId: "btn-pause", label: "暂停工作流", decisionStatus: "paused", role: "pause" },
    { buttonId: "btn-terminate", label: "终止工作流", decisionStatus: "terminated", role: "terminate" }
  ];
}

function assertNoSensitiveLeak(label, value) {
  const text = JSON.stringify(value);
  assert.equal(/callbackToken(?!Present)|callback_token|callbackData|callback_data|tawhg:|toolAction|feedbackToolAction|cliCommand|feedbackCliCommand|botToken|bot_token|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|privateKey|private_key|brokerKey|broker_key/i.test(text), false, `${label} leaked sensitive material`);
}

const runId = safeSegment(firstText(argValue("--run-id"), utcCompact()));
const root = firstText(argValue("--root"), await fs.mkdtemp(path.join(os.tmpdir(), "workflow-v2-runner-execute-hgate-gateway-delivery-")));
const outDir = path.resolve(firstText(argValue("--out"), path.join(root, "artifacts", "workflow-v2", "runner-execute-human-gate-gateway-delivery", runId)));
const targetRef = firstText(argValue("--target"), argValue("--target-ref"), "8390724843");
const deliverRequested = boolFlag("--deliver");
const deliveryGateEnabled = process.env.TRADING_AGENTS_WORKFLOW_ALLOW_OPENCLAW_GATEWAY_DELIVERY_SMOKE === "1";
const executeDelivery = deliverRequested && deliveryGateEnabled;
const workflowId = firstText(argValue("--workflow-id"), `wf-v2-runner-execute-hgate-gateway-delivery-${runId}`);
const humanGateId = `${workflowId}.human-gate`;
const outboxId = `hgate-${humanGateId}`;
const catClawAuditId = `${workflowId}.cat-claw-audit`;
const idempotencyKey = `${workflowId}:openclaw-gateway-delivery-smoke`;
const createdAt = "2026-07-13T00:00:00.000Z";
const text = [
  "猫爪正式汇报：workflow v2 OpenClaw Gateway delivery smoke。",
  `runId=${runId}`,
  "这是受控小流量 Gateway 投递验证消息，不包含交易指令，不触发 worker execute，不触达 trading_core。",
  executeDelivery ? "当前环境门已开启，本次将尝试通过 OpenClaw Gateway 投递。" : "当前为计划/预演模式，本次不会通过 Gateway 发送。"
].join("\n");
const payload = {
  humanGateId,
  workflowId,
  gateType: "workflow_v2_task_delivery",
  account: "cat_claw",
  requester: "cat_claw",
  targetKind: "private",
  targetRef,
  buttons: fixtureButtons(),
  presentation: { kind: "human_gate_request", buttonCount: 5 },
  textPolicyVersion: "gateway-delivery-smoke"
};

await runAction(root, { action: "workflow.init" });
const dbFile = path.join(root, "workflow_control_plane.db");
await sqlite(dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES (${sqlValue(outboxId)}, ${sqlValue(workflowId)}, 'private', ${sqlValue(targetRef)}, 'human_gate_request', 'queued', ${sqlValue(text)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);

const before = await deliverySnapshot(dbFile);
const preview = await runAction(root, {
  action: "telegram.outbox.delivery.preview",
  outboxId,
  deliveryOperatorReason: "Controlled workflow v2 OpenClaw Gateway delivery smoke.",
  catClawAuditId
});
assert.equal(preview.readOnly, true);
assert.equal(preview.eligible, true);
assert.equal(preview.executionPolicy.governanceReady, true);
assert.equal(preview.messageType, "human_gate_request");
assert.equal(preview.targetKind, "private");
assert.equal(preview.targetRef, targetRef);
assert.equal(preview.account, "cat_claw");
assert.equal(preview.buttonSummary.buttonCount, 5);
assert.equal(preview.deliveryPath.directBotApiWebAppCandidate, false);
assert.deepEqual(preview.deliveryPath.modeOrder, ["openclaw_message_send"]);
assert.equal(preview.wouldReadBotToken, "no");
assert.equal((await outboxRow(dbFile, outboxId)).status, "queued");

let delivery = null;
if (executeDelivery) {
  delivery = await runAction(root, {
    action: "telegram.outbox.delivery",
    outboxId,
    idempotencyKey,
    deliveryOperatorReason: "Controlled workflow v2 OpenClaw Gateway delivery smoke.",
    catClawAuditId,
    actor: "local_codex",
    sourceAgent: "local_codex",
    workflowId
  });
  assert.equal(delivery.didTouchTradingState, false);
  assert.equal(delivery.didUpdateMessageFlow, false);
  assert.equal(["sent", "failed"].includes(delivery.deliveryStatus), true);
} else {
  assert.equal(deliverRequested && !deliveryGateEnabled, deliverRequested ? true : false);
}

const after = await deliverySnapshot(dbFile);
const finalOutbox = await outboxRow(dbFile, outboxId);
if (executeDelivery) {
  assert.equal(after.runtimeRuns, before.runtimeRuns);
  assert.equal(after.dispatches, before.dispatches);
  assert.equal(after.sideEffects, before.sideEffects);
  assert.equal(after.deliveryExecutionEvents - before.deliveryExecutionEvents, 1);
  assert.equal(finalOutbox.status, delivery.deliveryStatus);
} else {
  assert.deepEqual(after, before);
  assert.equal(finalOutbox.status, "queued");
}

const summary = {
  ok: true,
  schemaVersion: "workflow_v2_runner_execute_human_gate_gateway_delivery_smoke.v1",
  runId,
  root,
  dbFile,
  workflowId,
  outboxId,
  humanGateId,
  target: { kind: "private", refRedacted: redactedTargetRef(targetRef), refHash: `sha256:${sha256(targetRef)}` },
  gatewayBoundary: {
    hub: "openclaw_gateway",
    transportCandidate: "openclaw_message_send",
    directBotApiCandidate: false,
    credentialRead: "no",
    scope: "cat_claw_human_gate_outward_notification_only",
    messageFlowRole: "not_replaced"
  },
  gates: {
    deliverRequested,
    environmentGate: deliveryGateEnabled,
    executeDelivery
  },
  preview: {
    readOnly: preview.readOnly,
    eligible: preview.eligible,
    governanceReady: preview.executionPolicy.governanceReady,
    wouldUseGatewaySend: preview.wouldSendTelegram,
    deliveryPath: preview.deliveryPath,
    buttonCount: preview.buttonSummary.buttonCount
  },
  delivery: delivery ? {
    deliveryStatus: delivery.deliveryStatus,
    didUseGatewaySend: delivery.didSendTelegram,
    didUpdateOutbox: delivery.didUpdateOutbox,
    didUpdateMessageFlow: delivery.didUpdateMessageFlow,
    didTouchTradingState: delivery.didTouchTradingState,
    receiptCount: delivery.receiptCount
  } : {
    deliveryStatus: "not_executed",
    didUseGatewaySend: false,
    reason: deliverRequested ? "environment_gate_missing" : "deliver_flag_missing"
  },
  snapshots: { before, after },
  finalOutboxStatus: finalOutbox.status
};
assertNoSensitiveLeak("summary", summary);
assert.equal(JSON.stringify(summary).includes(targetRef), false, "summary leaked raw target ref");

const indexFile = path.join(outDir, "index.json");
await writeJson(indexFile, summary);
console.log(JSON.stringify({ ...summary, indexFile }, null, 2));
