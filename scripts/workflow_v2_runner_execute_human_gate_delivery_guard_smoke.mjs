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
    .slice(0, 96) || "workflow-v2-runner-execute-hgate-delivery-guard";
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

async function sideEffectSnapshot(dbFile) {
  return {
    runtimeRuns: await optionalSqliteCount(dbFile, "runtime_runs"),
    dispatches: await optionalSqliteCount(dbFile, "mixed_meeting_dispatches"),
    sideEffects: await optionalSqliteCount(dbFile, "side_effects"),
    deliveryExecutionEvents: await optionalSqliteCount(dbFile, "workflow_events", "event_type='telegram.outbox.delivery.executed'"),
    policyBlockedEvents: await optionalSqliteCount(dbFile, "workflow_events", "event_type='permission.policy_blocked'")
  };
}

async function outboxStatus(dbFile, outboxId) {
  const row = await sqliteOne(dbFile, `SELECT status, target_ref AS targetRef, payload_json AS payloadJson FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`);
  return row;
}

async function updateOutbox(dbFile, outboxId, patch = {}) {
  const assignments = [];
  if (patch.status !== undefined) assignments.push(`status=${sqlValue(patch.status)}`);
  if (patch.targetRef !== undefined) assignments.push(`target_ref=${sqlValue(patch.targetRef)}`);
  if (patch.payload !== undefined) assignments.push(`payload_json=${sqlValue(JSON.stringify(patch.payload))}`);
  assignments.push(`updated_at=${sqlValue(patch.updatedAt || new Date().toISOString())}`);
  await sqlite(dbFile, `UPDATE telegram_outbox SET ${assignments.join(", ")} WHERE outbox_id=${sqlValue(outboxId)};`);
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
      if (!["callbackTokenPresent"].includes(key) && /callbackToken|callback_token|callbackData|callback_data|botToken|bot_token|apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|privateKey|private_key|brokerKey|broker_key/i.test(key)) {
        badPaths.push([...pathParts, key].join("."));
      }
      visit(child, [...pathParts, key]);
    }
  };
  visit(value);
  assert.deepEqual(badPaths, [], `${label} leaked sensitive material`);
}

async function expectDeliveryBlocked(root, input, expectedCodes = []) {
  try {
    await runAction(root, { action: "telegram.outbox.delivery", ...input });
  } catch (error) {
    const message = String(error?.message || error);
    for (const code of expectedCodes) {
      assert.equal(message.includes(code), true, `expected delivery block to include ${code}: ${message}`);
    }
    return {
      blocked: true,
      message,
      matchedCodes: expectedCodes
    };
  }
  throw new Error(`expected telegram.outbox.delivery to block for ${expectedCodes.join(",") || "unknown reason"}`);
}

const runId = safeSegment(firstText(argValue("--run-id"), utcCompact()));
const root = firstText(argValue("--root"), await fs.mkdtemp(path.join(os.tmpdir(), "workflow-v2-runner-execute-hgate-delivery-guard-")));
const workflowId = firstText(argValue("--workflow-id"), `wf-v2-runner-execute-hgate-delivery-guard-${runId}`);
const outDir = path.resolve(firstText(argValue("--out"), path.join(root, "artifacts", "workflow-v2", "runner-execute-human-gate-delivery-guard", runId)));
const humanGateId = `${workflowId}.human-gate`;
const outboxId = `hgate-${humanGateId}`;
const protocolAuditId = `${workflowId}.protocol-audit`;
const createdAt = "2026-07-13T00:00:00.000Z";
const targetRef = "8390724843";
const basePayload = {
  humanGateId,
  workflowId,
  gateType: "workflow_v2_task_delivery",
  account: "cat_claw",
  requester: "cat_claw",
  targetKind: "private",
  targetRef,
  buttons: fixtureButtons(),
  presentation: { kind: "human_gate_request", buttonCount: 5 },
  textPolicyVersion: "smoke"
};

await runAction(root, { action: "workflow.init" });
const dbFile = path.join(root, "workflow_control_plane.db");

await sqlite(dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES (${sqlValue(outboxId)}, ${sqlValue(workflowId)}, 'private', ${sqlValue(targetRef)}, 'human_gate_request', 'queued', ${sqlValue("猫爪正式汇报：workflow v2 runner execute Human Gate delivery guard smoke。")}, ${sqlValue(JSON.stringify(basePayload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
const sideEffectsBefore = await sideEffectSnapshot(dbFile);

const previewReady = await runAction(root, {
  action: "telegram.outbox.delivery.preview",
  outboxId,
  deliveryOperatorReason: "Smoke guard preview only.",
  protocolAuditId
});
assert.equal(previewReady.readOnly, true);
assert.equal(previewReady.eligible, true);
assert.equal(previewReady.executionPolicy.governanceReady, true);
assert.equal(previewReady.wouldSendTelegram, true);
assert.equal(previewReady.buttonSummary.buttonCount, 5);
assert.equal((await outboxStatus(dbFile, outboxId)).status, "queued");

const missingIdempotency = await expectDeliveryBlocked(root, {
  outboxId,
  deliveryOperatorReason: "Smoke guard must block before delivery.",
  protocolAuditId
}, ["idempotencyKey is required"]);
assert.equal((await outboxStatus(dbFile, outboxId)).status, "queued");

const missingOperatorReason = await expectDeliveryBlocked(root, {
  outboxId,
  idempotencyKey: `${workflowId}:missing-operator-reason`,
  protocolAuditId
}, ["delivery_operator_reason_required"]);
assert.equal((await outboxStatus(dbFile, outboxId)).status, "queued");

const missingProtocolAudit = await expectDeliveryBlocked(root, {
  outboxId,
  idempotencyKey: `${workflowId}:missing-protocol-audit`,
  deliveryOperatorReason: "Smoke guard must require Protocol audit evidence."
}, ["requires_protocol_audit"]);
assert.equal((await outboxStatus(dbFile, outboxId)).status, "queued");

await updateOutbox(dbFile, outboxId, { targetRef: "", payload: { ...basePayload, targetRef: "" } });
const missingTarget = await expectDeliveryBlocked(root, {
  outboxId,
  idempotencyKey: `${workflowId}:missing-target`,
  deliveryOperatorReason: "Smoke guard must require bound Telegram target.",
  protocolAuditId
}, ["target_missing", "governed_target_required"]);
const missingTargetRow = await outboxStatus(dbFile, outboxId);
assert.equal(missingTargetRow.status, "queued");
assert.equal(missingTargetRow.targetRef, "");

await updateOutbox(dbFile, outboxId, { targetRef, payload: { ...basePayload, buttons: [basePayload.buttons[0], ...basePayload.buttons.slice(2)] } });
const incompleteButtons = await expectDeliveryBlocked(root, {
  outboxId,
  idempotencyKey: `${workflowId}:incomplete-buttons`,
  deliveryOperatorReason: "Smoke guard must require two approve options plus controls.",
  protocolAuditId
}, ["human_gate_buttons_incomplete"]);
assert.equal((await outboxStatus(dbFile, outboxId)).status, "queued");

await updateOutbox(dbFile, outboxId, {
  status: "sent",
  targetRef,
  payload: {
    ...basePayload,
    delivery: {
      channel: "telegram",
      account: "cat_claw",
      target: targetRef,
      deliveredAt: "2026-07-13T00:01:00.000Z",
      receipts: [{ message_id: 1, chat: { id: 8390724843 }, date: 1783900860 }]
    }
  }
});
const sentReplay = await runAction(root, {
  action: "telegram.outbox.delivery",
  outboxId,
  idempotencyKey: `${workflowId}:sent-replay`,
  deliveryOperatorReason: "Smoke guard sent replay must not resend Telegram.",
  protocolAuditId
});
assert.equal(sentReplay.idempotentReplay, true);
assert.equal(sentReplay.didSendTelegram, false);
assert.equal(sentReplay.didUpdateOutbox, false);
assert.equal(sentReplay.deliveryStatus, "sent");
assert.equal((await outboxStatus(dbFile, outboxId)).status, "sent");
const sideEffectsAfter = await sideEffectSnapshot(dbFile);
assert.equal(sideEffectsAfter.runtimeRuns, sideEffectsBefore.runtimeRuns);
assert.equal(sideEffectsAfter.dispatches, sideEffectsBefore.dispatches);
assert.equal(sideEffectsAfter.sideEffects, sideEffectsBefore.sideEffects);
assert.equal(sideEffectsAfter.deliveryExecutionEvents, sideEffectsBefore.deliveryExecutionEvents);
assert.equal(sideEffectsAfter.policyBlockedEvents - sideEffectsBefore.policyBlockedEvents, 1);

const summary = {
  ok: true,
  schemaVersion: "workflow_v2_runner_execute_human_gate_delivery_guard_smoke.v1",
  runId,
  root,
  dbFile,
  workflowId,
  outboxId,
  humanGateId,
  previewReady: {
    readOnly: previewReady.readOnly,
    eligible: previewReady.eligible,
    governanceReady: previewReady.executionPolicy.governanceReady,
    wouldSendTelegram: previewReady.wouldSendTelegram,
    buttonCount: previewReady.buttonSummary.buttonCount
  },
  blockedCases: {
    missingIdempotency,
    missingOperatorReason,
    missingProtocolAudit,
    missingTarget,
    incompleteButtons
  },
  sentReplay: {
    deliveryStatus: sentReplay.deliveryStatus,
    idempotentReplay: sentReplay.idempotentReplay,
    didSendTelegram: sentReplay.didSendTelegram,
    didUpdateOutbox: sentReplay.didUpdateOutbox,
    receiptCount: sentReplay.receiptCount
  },
  sideEffectSnapshot: {
    before: sideEffectsBefore,
    after: sideEffectsAfter,
    deliverySideEffectsUnchanged: true,
    policyBlockedAuditEventsCreated: sideEffectsAfter.policyBlockedEvents - sideEffectsBefore.policyBlockedEvents
  },
  didExecuteQueuedDelivery: sideEffectsAfter.deliveryExecutionEvents !== sideEffectsBefore.deliveryExecutionEvents,
  didSendTelegram: Boolean(sentReplay.didSendTelegram),
  didDispatchRuntime: sideEffectsAfter.runtimeRuns !== sideEffectsBefore.runtimeRuns || sideEffectsAfter.dispatches !== sideEffectsBefore.dispatches,
  didTouchTradingState: sideEffectsAfter.sideEffects !== sideEffectsBefore.sideEffects
};
assert.equal(summary.didExecuteQueuedDelivery, false);
assert.equal(summary.didSendTelegram, false);
assert.equal(summary.didDispatchRuntime, false);
assert.equal(summary.didTouchTradingState, false);
assertNoSensitiveLeak("summary", summary);

const indexFile = path.join(outDir, "index.json");
await writeJson(indexFile, summary);
console.log(JSON.stringify({ ...summary, indexFile }, null, 2));
