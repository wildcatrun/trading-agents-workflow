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

async function createFakeOpenclawBin(rootDir) {
  const binDir = path.join(rootDir, "bin");
  const logFile = path.join(rootDir, "fake-openclaw-message-send-log.jsonl");
  const binFile = path.join(binDir, "openclaw");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(binFile, `#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : "";
};
const target = valueAfter("--target");
const message = valueAfter("--message");
const safe = {
  at: new Date().toISOString(),
  commandPrefix: args.slice(0, 4),
  channel: valueAfter("--channel"),
  account: valueAfter("--account"),
  targetHash: target ? "sha256:" + crypto.createHash("sha256").update(target).digest("hex") : "",
  messageLength: message.length,
  hasPresentation: args.includes("--presentation"),
  argsLength: args.length
};
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(safe) + "\\n");
console.log(JSON.stringify({ ok: true, payload: { ok: true, mode: "fake_openclaw_message_send", argsLength: args.length } }));
`, "utf8");
  await fs.chmod(binFile, 0o700);
  return { binFile, logFile };
}

async function readJsonl(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
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
    messageFlows: await optionalSqliteCount(dbFile, "message_flows"),
    messageFlowEvents: await optionalSqliteCount(dbFile, "message_flow_events"),
    runtimeRuns: await optionalSqliteCount(dbFile, "runtime_runs"),
    dispatches: await optionalSqliteCount(dbFile, "mixed_meeting_dispatches"),
    sideEffects: await optionalSqliteCount(dbFile, "side_effects")
  };
}

async function outboxRow(dbFile, outboxId) {
  return sqliteOne(dbFile, `SELECT outbox_id AS outboxId, status, target_kind AS targetKind, target_ref AS targetRef, message_type AS messageType, payload_json AS payloadJson FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`);
}

async function outboxPayload(dbFile, outboxId) {
  const row = await outboxRow(dbFile, outboxId);
  return row.payloadJson ? JSON.parse(row.payloadJson) : {};
}

async function messageFlowDigest(dbFile, flowId) {
  const row = await sqliteOne(dbFile, `
SELECT flow_id AS flowId, status, outbox_id AS outboxId, delivery_receipt_present AS deliveryReceiptPresent,
       telegram_sent_at AS telegramSentAt, telegram_failed_at AS telegramFailedAt,
       last_error AS lastError, payload_json AS payloadJson, updated_at AS updatedAt
FROM message_flows
WHERE flow_id=${sqlValue(flowId)}
LIMIT 1;`);
  const eventCount = Number((await sqliteOne(dbFile, `SELECT COUNT(*) AS count FROM message_flow_events WHERE flow_id=${sqlValue(flowId)};`)).count || 0);
  return {
    flowId: row.flowId || "",
    status: row.status || "",
    outboxId: row.outboxId || "",
    deliveryReceiptPresent: Number(row.deliveryReceiptPresent || 0),
    telegramSentAt: row.telegramSentAt || "",
    telegramFailedAt: row.telegramFailedAt || "",
    lastError: row.lastError || "",
    payloadJson: row.payloadJson || "",
    updatedAt: row.updatedAt || "",
    eventCount
  };
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
const fakeOpenclawRequested = boolFlag("--fake-openclaw");
const deliveryGateEnabled = process.env.TRADING_AGENTS_WORKFLOW_ALLOW_OPENCLAW_GATEWAY_DELIVERY_SMOKE === "1";
const executeDelivery = deliverRequested && deliveryGateEnabled;
const workflowId = firstText(argValue("--workflow-id"), `wf-v2-runner-execute-hgate-gateway-delivery-${runId}`);
const humanGateId = `${workflowId}.human-gate`;
const outboxId = `hgate-${humanGateId}`;
const poisonFlowId = `${workflowId}.poison-flow`;
const poisonOutboxId = `hgate-${humanGateId}.poison-message-flow`;
const protocolAuditId = `${workflowId}.protocol-audit`;
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
  telegramReplyMarkup: {
    inline_keyboard: fixtureButtons().map((button) => [{
      text: button.label,
      url: "https://example.invalid/workflow-v2-human-gate-gateway-delivery-smoke"
    }])
  },
  presentation: { kind: "human_gate_request", buttonCount: 5 },
  textPolicyVersion: "gateway-delivery-smoke"
};
const poisonPayload = {
  ...payload,
  humanGateId: `${humanGateId}.poison`,
  messageFlowId: poisonFlowId,
  message_flow_id: poisonFlowId
};
const fakeOpenclaw = fakeOpenclawRequested ? await createFakeOpenclawBin(root) : null;

await runAction(root, { action: "workflow.init" });
const dbFile = path.join(root, "workflow_control_plane.db");
await sqlite(dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES (${sqlValue(outboxId)}, ${sqlValue(workflowId)}, 'private', ${sqlValue(targetRef)}, 'human_gate_request', 'queued', ${sqlValue(text)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
await sqlite(dbFile, `
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, outbox_id, target_runtime, target_agent_id, return_policy, status, final_output_present, delivery_receipt_present, payload_json, created_at, updated_at)
VALUES (${sqlValue(poisonFlowId)}, ${sqlValue(`${workflowId}:trace`)}, ${sqlValue(`${workflowId}:poison`)}, ${sqlValue(workflowId)}, ${sqlValue(workflowId)}, 'dispatch-poison', ${sqlValue(poisonOutboxId)}, 'hermers', 'cat_body', 'telegram', 'runtime_completed', 1, 0, ${sqlValue(JSON.stringify({ seededFor: "human_gate_request_message_flow_guard" }))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});
INSERT INTO message_flow_events(event_id, flow_id, status, event_type, payload_json, created_at)
VALUES (${sqlValue(`${poisonFlowId}.event.seed`)}, ${sqlValue(poisonFlowId)}, 'runtime_completed', 'seeded_negative_control', ${sqlValue(JSON.stringify({ outboxId: poisonOutboxId }))}, ${sqlValue(createdAt)});
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES (${sqlValue(poisonOutboxId)}, ${sqlValue(workflowId)}, 'private', ${sqlValue(targetRef)}, 'human_gate_request', 'queued', ${sqlValue("poison human_gate_request must not close message_flow")}, ${sqlValue(JSON.stringify(poisonPayload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
const poisonFlowBefore = await messageFlowDigest(dbFile, poisonFlowId);
const poisonMark = await runAction(root, {
  action: "telegram.outbox",
  operation: "mark",
  outboxId: poisonOutboxId,
  status: "sent"
});
assert.equal(poisonMark.status, "sent");
assert.equal(poisonMark.messageFlowSync, null);
const poisonFlowAfter = await messageFlowDigest(dbFile, poisonFlowId);
assert.deepEqual(poisonFlowAfter, poisonFlowBefore);

const before = await deliverySnapshot(dbFile);
const preview = await runAction(root, {
  action: "telegram.outbox.delivery.preview",
  outboxId,
  deliveryOperatorReason: "Controlled workflow v2 OpenClaw Gateway delivery smoke.",
  protocolAuditId
});
assert.equal(preview.readOnly, true);
assert.equal(preview.eligible, true);
assert.equal(preview.executionPolicy.governanceReady, true);
assert.equal(preview.messageType, "human_gate_request");
assert.equal(preview.targetKind, "private");
assert.equal(preview.targetRef, targetRef);
assert.equal(preview.account, "cat_claw");
assert.equal(preview.buttonSummary.buttonCount, 5);
assert.equal(preview.buttonSummary.hasInlineKeyboard, true);
assert.equal(preview.deliveryPath.directBotApiWebAppCandidate, false);
assert.deepEqual(preview.deliveryPath.modeOrder, ["openclaw_message_send"]);
assert.equal(preview.wouldReadBotToken, "no");
assert.equal(preview.receiptPolicy.messageFlowSync, "not_required_for_message_type");
assert.equal(preview.wouldUpdate.messageFlowDelivery, "unchanged");
assert.equal((await outboxRow(dbFile, outboxId)).status, "queued");

let delivery = null;
if (executeDelivery) {
  delivery = await runAction(root, {
    action: "telegram.outbox.delivery",
    outboxId,
    idempotencyKey,
    deliveryOperatorReason: "Controlled workflow v2 OpenClaw Gateway delivery smoke.",
    protocolAuditId,
    actor: "local_codex",
    sourceAgent: "local_codex",
    workflowId,
    ...(fakeOpenclaw ? {
      openclawBin: fakeOpenclaw.binFile,
      telegramBotToken: "fake-token-that-must-not-be-used-for-human-gate-request"
    } : {})
  });
  assert.equal(delivery.didTouchTradingState, false);
  assert.equal(delivery.didUpdateMessageFlow, false);
  assert.equal(["sent", "failed"].includes(delivery.deliveryStatus), true);
  if (fakeOpenclaw) {
    const fakeCalls = await readJsonl(fakeOpenclaw.logFile);
    assert.equal(fakeCalls.length, 1);
    assert.deepEqual(fakeCalls[0].commandPrefix, ["message", "send", "--channel", "telegram"]);
    assert.equal(fakeCalls[0].hasPresentation, true);
    assert.equal(fakeCalls[0].targetHash, `sha256:${sha256(targetRef)}`);
    assert.equal(Object.prototype.hasOwnProperty.call(fakeCalls[0], "message"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(fakeCalls[0], "target"), false);
    const deliveredPayload = await outboxPayload(dbFile, outboxId);
    assert.equal(Boolean(deliveredPayload.webAppDirectDeliveryFallback), false);
    assert.notEqual(deliveredPayload.delivery?.mode, "direct_bot_api_web_app");
    assert.equal(delivery.deliveryStatus, "sent");
  }
} else {
  assert.equal(deliverRequested && !deliveryGateEnabled, deliverRequested ? true : false);
}

const after = await deliverySnapshot(dbFile);
const finalOutbox = await outboxRow(dbFile, outboxId);
if (executeDelivery) {
  assert.equal(after.runtimeRuns, before.runtimeRuns);
  assert.equal(after.dispatches, before.dispatches);
  assert.equal(after.sideEffects, before.sideEffects);
  assert.equal(after.messageFlows, before.messageFlows);
  assert.equal(after.messageFlowEvents, before.messageFlowEvents);
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
    messageFlowRole: "not_replaced",
    messageFlowRowCountsUnchanged: after.messageFlows === before.messageFlows && after.messageFlowEvents === before.messageFlowEvents,
    poisonedHumanGateMessageFlowUnchanged: JSON.stringify(poisonFlowAfter) === JSON.stringify(poisonFlowBefore)
  },
  gates: {
    deliverRequested,
    environmentGate: deliveryGateEnabled,
    executeDelivery,
    fakeOpenclaw: Boolean(fakeOpenclaw)
  },
  preview: {
    readOnly: preview.readOnly,
    eligible: preview.eligible,
    governanceReady: preview.executionPolicy.governanceReady,
    wouldUseGatewaySend: preview.wouldSendTelegram,
    deliveryPath: preview.deliveryPath,
    receiptPolicy: {
      messageFlowSync: preview.receiptPolicy.messageFlowSync,
      humanGateDeliveryEvidence: preview.receiptPolicy.humanGateDeliveryEvidence
    },
    buttonCount: preview.buttonSummary.buttonCount,
    hasInlineKeyboard: preview.buttonSummary.hasInlineKeyboard,
    messageFlowDeliveryUpdate: preview.wouldUpdate.messageFlowDelivery
  },
  delivery: delivery ? {
    deliveryStatus: delivery.deliveryStatus,
    didUseGatewaySend: delivery.didSendTelegram,
    didUpdateOutbox: delivery.didUpdateOutbox,
    didUpdateMessageFlow: delivery.didUpdateMessageFlow,
    didTouchTradingState: delivery.didTouchTradingState,
    receiptCount: delivery.receiptCount,
    fakeOpenclawCallCount: fakeOpenclaw ? (await readJsonl(fakeOpenclaw.logFile)).length : 0
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
