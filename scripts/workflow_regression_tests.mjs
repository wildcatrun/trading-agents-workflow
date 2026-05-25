#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAction } from "../src/core.js";

const createdRoots = [];

async function tempRoot(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `taw-regression-${name}-`));
  createdRoots.push(root);
  return root;
}

function sqliteJson(dbFile, sql) {
  const output = execFileSync("sqlite3", ["-json", dbFile, sql], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteExec(dbFile, sql) {
  execFileSync("sqlite3", [dbFile, sql], { encoding: "utf8" });
}

function sqliteCount(dbFile, table, where = "1=1") {
  return Number(sqliteJson(dbFile, `SELECT COUNT(*) AS count FROM ${table} WHERE ${where};`)[0]?.count || 0);
}

function requireSqliteCli() {
  try {
    execFileSync("sqlite3", ["--version"], { encoding: "utf8" });
  } catch (error) {
    throw new Error(`sqlite3 CLI is required for workflow regression tests: ${error?.message || error}`);
  }
}

function sha256Text(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function workflowCliJson(args) {
  const output = execFileSync("node", [path.resolve("bin/cat-meeting-governance.mjs"), ...args], { encoding: "utf8" }).trim();
  return output ? JSON.parse(output) : {};
}

async function assertRejectsMessage(fn, expected) {
  try {
    await fn();
  } catch (error) {
    assert.match(String(error?.message || error), expected);
    return;
  }
  assert.fail(`expected rejection matching ${expected}`);
}

function planButtons() {
  return [
    {
      label: "方案 A：定点修复",
      summary: "继续用定点补丁修复 Human Gate 方案展示问题。",
      prompt: "只修改 workflow 代码中的 Human Gate 生成和审计逻辑。",
      rollback: "如果检查失败，停止本批补丁并保留当前本地 diff。"
    },
    {
      label: "方案 B：先补证据",
      summary: "暂停代码修改，先收集更多 Human Gate 样本和日志证据。",
      prompt: "在实施前继续做只读检查，确认英文穿透路径。",
      rollback: "证据完整后回到方案 A 继续修复。"
    },
    {
      label: "方案 C：冻结本项",
      summary: "冻结 Human Gate 改动，先处理 runtime bridge 的稳定性问题。",
      prompt: "不要继续修改 Human Gate，优先排查 runtime dispatch。",
      rollback: "如果 runtime bridge 已稳定，再恢复 Human Gate 修复。"
    }
  ];
}

function englishPlanButtons() {
  return [
    {
      label: "Plan A",
      summary: "Continue debugging with targeted fixes",
      prompt: "Proceed with the next repair batch inside workflow code only",
      rollback: "Stop the batch and keep current local diff if checks fail"
    },
    {
      label: "Plan B",
      summary: "Pause code edits and collect more evidence",
      prompt: "Run additional read-only inspections before implementation",
      rollback: "Return to Plan A after evidence is complete"
    },
    {
      label: "Plan C",
      summary: "Freeze Human Gate changes and focus on runtime bridge",
      prompt: "Leave Human Gate untouched and debug runtime dispatch first",
      rollback: "Resume Human Gate repair if runtime bridge is already stable"
    }
  ];
}

async function requestHumanGate(root, overrides = {}) {
  return runAction(root, {
    action: "human_gate.request",
    meetingId: "meeting-regression",
    workflowId: "workflow-regression",
    text: "猫爪正式汇报：请选择 A/B/C。",
    buttons: planButtons(),
    ...overrides
  });
}

function approvedButtons(request) {
  return request.buttons.filter((button) => button.decisionStatus === "approved");
}

function planRollback(button) {
  return button.payload?.rollback || button.payload?.payload?.localized?.rollback || "";
}

function assertCompletePlanButtons(request) {
  const approved = approvedButtons(request);
  assert.equal(approved.length, 3);
  assert.deepEqual(approved.map((button) => button.label), ["批准方案 A：定点修复", "批准方案 B：先补证据", "批准方案 C：冻结本项"]);
  for (const button of approved) {
    assert.ok(button.summary, `${button.label} summary is required`);
    assert.ok(button.prompt, `${button.label} prompt is required`);
    assert.ok(planRollback(button), `${button.label} rollback is required`);
  }
  assert.equal(new Set(approved.map((button) => button.summary)).size, 3);
  assert.equal(new Set(approved.map((button) => button.prompt)).size, 3);
  assert.equal(new Set(approved.map(planRollback)).size, 3);
}

function assertNoTokenLeak(value, token, pathLabel = "payload") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    assert.equal(value.includes(token), false, `${pathLabel} leaked callback token`);
    assert.equal(value.includes("tawhg:"), false, `${pathLabel} leaked tawhg token`);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoTokenLeak(item, token, `${pathLabel}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${pathLabel}.${key}`;
    if (/token|callback[_-]?data|callback[_-]?token|secret|credential/i.test(key)) {
      assert.notEqual(item, token, `${nextPath} contains raw callback token`);
    }
    assertNoTokenLeak(item, token, nextPath);
  }
}

async function testHumanGateLanguageAndResume() {
  const englishRoot = await tempRoot("language-en");
  await assertRejectsMessage(
    () => requestHumanGate(englishRoot, { text: "Choose A/B/C for next workflow step." }),
    /human_gate_requires_chinese_primary_report/
  );
  const shortRoot = await tempRoot("language-short");
  await assertRejectsMessage(
    () => requestHumanGate(shortRoot, { text: "中文" }),
    /human_gate_requires_chinese_primary_report/
  );
  const incompleteRoot = await tempRoot("hgate-incomplete");
  const incompleteButtons = planButtons();
  delete incompleteButtons[2].rollback;
  await assertRejectsMessage(
    () => requestHumanGate(incompleteRoot, { buttons: incompleteButtons }),
    /human_gate_requires_complete_plan_details/
  );
  const englishPlansRoot = await tempRoot("hgate-english-plans");
  await assertRejectsMessage(
    () => requestHumanGate(englishPlansRoot, { buttons: englishPlanButtons() }),
    /human_gate_requires_chinese_plan_details/
  );

  const root = await tempRoot("hgate-resume");
  const request = await requestHumanGate(root);
  assert.equal(request.status, "pending");
  assertCompletePlanButtons(request);

  const selected = request.buttons[0];
  const resumed = await runAction(root, {
    action: "human_gate.resume",
    token: selected.callbackToken,
    text: "闪电猫原话：批准 A，继续 debug。"
  });
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.buttonId, selected.buttonId);
  assert.equal(resumed.humanGateId, request.humanGateId);

  const second = await runAction(root, {
    action: "human_gate.button_callback",
    callbackData: `tawhg:${request.buttons[1].callbackToken}`,
    feedbackText: "second should not win"
  });
  assert.equal(second.status, "superseded");

  const dbFile = path.join(root, "tracking.db");
  const retryJobsBefore = sqliteCount(dbFile, "control_loop_jobs", "job_type='meeting_dispatch_retry'");
  const idempotent = await runAction(root, {
    action: "human_gate.resume",
    token: selected.callbackToken,
    text: "闪电猫原话：重复提交，不应新增副作用。"
  });
  assert.equal(idempotent.status, "selected");
  assert.equal(sqliteCount(dbFile, "control_loop_jobs", "job_type='meeting_dispatch_retry'"), retryJobsBefore);

  const counts = sqliteJson(path.join(root, "tracking.db"), `
SELECT status, COUNT(*) AS count
FROM human_gate_buttons
GROUP BY status
ORDER BY status;`);
  assert.deepEqual(counts, [
    { status: "selected", count: 1 },
    { status: "superseded", count: 5 }
  ]);
}

async function testHumanGatePendingCleanupAndRetryRedaction() {
  const root = await tempRoot("hgate-pending-retry");
  const request = await requestHumanGate(root);
  const dbFile = path.join(root, "tracking.db");
  const stale = request.buttons[1];
  sqliteExec(dbFile, `UPDATE human_gate_buttons SET status='feedback_pending' WHERE button_id='${stale.buttonId}';`);

  const selected = request.buttons[0];
  const result = await runAction(root, {
    action: "human_gate.button_callback",
    token: selected.callbackToken,
    feedbackText: "闪电猫原话：批准 A。"
  });
  assert.equal(result.status, "approved");
  assert.equal(result.dispatch.status, "retry_scheduled");
  assert.equal(selected.buttonId.includes(selected.callbackToken), false);

  const retryPayload = sqliteJson(dbFile, `
SELECT payload_json
FROM control_loop_jobs
WHERE job_type='meeting_dispatch_retry'
ORDER BY created_at
LIMIT 1;`)[0]?.payload_json || "";
  assert.equal(retryPayload.includes(selected.callbackToken), false);
  assert.equal(retryPayload.includes("tawhg:"), false);
  assertNoTokenLeak(JSON.parse(retryPayload), selected.callbackToken);

  const counts = sqliteJson(dbFile, `
SELECT status, COUNT(*) AS count
FROM human_gate_buttons
GROUP BY status
ORDER BY status;`);
  assert.deepEqual(counts, [
    { status: "selected", count: 1 },
    { status: "superseded", count: 5 }
  ]);

  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  const tick = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    timeoutSeconds: 5,
    deliverOutbox: false,
    createHumanGateInbox: false
  });
  assert.equal(tick.jobResults?.[0]?.jobType, "meeting_dispatch_retry");
  assert.equal(tick.jobResults?.[0]?.status, "done");

  const dispatch = sqliteJson(dbFile, `
SELECT status, agent_id, runtime
FROM mixed_meeting_dispatches
ORDER BY created_at
LIMIT 1;`)[0];
  assert.deepEqual(dispatch, { status: "queued", agent_id: "main", runtime: "openclaw" });
}

async function testHumanGateStageDedupAndSupersede() {
  const root = await tempRoot("hgate-stage-hardening");
  const first = await requestHumanGate(root, {
    workflowId: "workflow-stage-hardening",
    meetingId: "meeting-stage-hardening",
    stageKey: "phase-alpha"
  });
  const duplicate = await requestHumanGate(root, {
    workflowId: "workflow-stage-hardening",
    meetingId: "meeting-stage-hardening",
    stageKey: "phase-alpha",
    text: "猫爪正式汇报：重复提交同一阶段，应复用原 Human Gate。"
  });
  assert.equal(duplicate.humanGateId, first.humanGateId);
  assert.equal(duplicate.reusedStageGate, true);
  assert.equal(duplicate.telegramOutbox.outboxId, first.telegramOutbox.outboxId);

  const beta = await requestHumanGate(root, {
    workflowId: "workflow-stage-hardening",
    meetingId: "meeting-stage-hardening",
    stageKey: "phase-beta"
  });
  assert.notEqual(beta.humanGateId, first.humanGateId);

  const replacement = await requestHumanGate(root, {
    workflowId: "workflow-stage-hardening",
    meetingId: "meeting-stage-hardening",
    stageKey: "phase-alpha",
    supersedeExisting: true,
    text: "猫爪正式汇报：同一阶段提交新证据包，明确 supersede 旧 Human Gate。"
  });
  assert.notEqual(replacement.humanGateId, first.humanGateId);
  assert.equal(replacement.supersededGate.humanGateId, first.humanGateId);

  const dbFile = path.join(root, "tracking.db");
  const decoyCreatedAt = new Date(Date.now() + 60_000).toISOString();
  for (let index = 0; index < 220; index += 1) {
    sqliteExec(dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('hgate-decoy-${index}', 'human_gate_record', 'pending', 'test', 'cat_claw', 'workflow-decoy-${index}', '', '{"objectId":"hgate-decoy-${index}","objectType":"human_gate_record","status":"pending","payload":{"workflowId":"workflow-decoy-${index}","gateType":"workflow_continuation","humanGateStageKey":"phase-alpha"}}', 'hash-${index}', '${decoyCreatedAt}', '${decoyCreatedAt}');`);
  }
  const duplicateAfterDecoys = await requestHumanGate(root, {
    workflowId: "workflow-stage-hardening",
    meetingId: "meeting-stage-hardening",
    stageKey: "phase-alpha",
    text: "猫爪正式汇报：高水位 pending gate 下仍应复用原 Human Gate。"
  });
  assert.equal(duplicateAfterDecoys.humanGateId, replacement.humanGateId);

  const gateRows = sqliteJson(dbFile, `
SELECT object_id AS objectId, status, path, payload_json AS payloadJson
FROM protocol_objects
WHERE object_type='human_gate_record' AND parent_object_id='workflow-stage-hardening'
ORDER BY created_at;`);
  assert.equal(gateRows.length, 3);
  const firstRow = gateRows.find((row) => row.objectId === first.humanGateId);
  const replacementRow = gateRows.find((row) => row.objectId === replacement.humanGateId);
  assert.equal(firstRow.status, "superseded");
  assert.equal(JSON.parse(firstRow.payloadJson).status, "superseded");
  const firstArtifact = JSON.parse(await fs.readFile(path.join(root, firstRow.path), "utf8"));
  assert.equal(firstArtifact.status, "superseded");
  assert.equal(replacementRow.status, "pending");
  assert.equal(JSON.parse(replacementRow.payloadJson).payload.humanGateStageKey, "phase-alpha");
  const activeAlpha = gateRows.filter((row) => {
    const payload = JSON.parse(row.payloadJson).payload || {};
    return row.status === "pending"
      && payload.workflowId === "workflow-stage-hardening"
      && payload.gateType === "workflow_continuation"
      && payload.humanGateStageKey === "phase-alpha";
  });
  assert.equal(activeAlpha.length, 1);

  const oldButtons = sqliteJson(dbFile, `
SELECT status, COUNT(*) AS count
FROM human_gate_buttons
WHERE human_gate_id='${first.humanGateId}'
GROUP BY status
ORDER BY status;`);
  assert.deepEqual(oldButtons, [{ status: "superseded", count: 6 }]);
  const oldOutbox = sqliteJson(dbFile, `
SELECT status
FROM telegram_outbox
WHERE outbox_id='${first.telegramOutbox.outboxId}'
LIMIT 1;`)[0];
  assert.equal(oldOutbox.status, "cancelled");
  const supersedeEvent = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, human_gate_id AS humanGateId
FROM workflow_events
WHERE event_type='human_gate.superseded'
LIMIT 1;`)[0];
  assert.equal(supersedeEvent.eventType, "human_gate.superseded");
  assert.equal(supersedeEvent.status, "superseded");
  assert.equal(supersedeEvent.humanGateId, first.humanGateId);
}

async function testScheduleResumeSemantics() {
  const root = await tempRoot("schedule");
  const nextRunAt = "2099-01-01T00:00:00.000Z";
  await runAction(root, {
    action: "workflow.schedule.upsert",
    scheduleId: "schedule-regression",
    runtime: "openclaw",
    agentId: "main",
    prompt: "schedule regression",
    scheduleKind: "interval",
    intervalSeconds: 3600,
    nextRunAt
  });
  await runAction(root, { action: "workflow.scheduler.pause", scheduleId: "schedule-regression" });
  const resumed = await runAction(root, { action: "workflow.scheduler.resume", scheduleId: "schedule-regression" });
  assert.equal(resumed.schedule.status, "active");
  assert.equal(resumed.schedule.nextRunAt, nextRunAt);

  const reset = await runAction(root, {
    action: "workflow.scheduler.resume",
    scheduleId: "schedule-regression",
    resetNextRun: true
  });
  assert.equal(reset.schedule.status, "active");
  assert.notEqual(reset.schedule.nextRunAt, nextRunAt);
}

async function makeFakeOpenClaw(root, name, mode) {
  const file = path.join(root, name);
  const body = mode === "health-degraded"
    ? `#!/usr/bin/env node\nif (process.argv.includes("health")) { console.log("Gateway event loop: degraded reasons=event_loop_delay max=1374ms p99=32ms util=0.241 cpu=0.313"); process.exit(0); }\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"runtime bridge final output"}]}}));\n`
    : mode === "success"
    ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"runtime bridge final output"}]}}));\n`
    : `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"error",summary:"fake runtime failure"}));\n`;
  await fs.writeFile(file, body, "utf8");
  await fs.chmod(file, 0o755);
  return file;
}

async function writeHermersProfileModes(root, profiles) {
  const file = path.join(root, "hermers-profile-modes.json");
  await fs.writeFile(file, `${JSON.stringify({ updatedAt: new Date().toISOString(), profiles }, null, 2)}\n`, "utf8");
  return file;
}

async function testMessageFlowRuntimeBridge() {
  const root = await tempRoot("message-flow");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  const sent = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "message_flow regression body",
    workflowId: "workflow-message-flow",
    meetingId: "meeting-message-flow",
    returnPolicy: "silent"
  });
  assert.equal(sent.targetCount, 1);
  const dispatchId = sent.dispatches[0].dispatchId;
  const successBin = await makeFakeOpenClaw(root, "fake-openclaw-success.mjs", "success");
  const drained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    limit: 1,
    openclawBin: successBin,
    reportDelivery: false
  });
  assert.equal(drained.results?.[0]?.status, "acked");

  const dbFile = path.join(root, "tracking.db");
  const flow = sqliteJson(dbFile, `
SELECT status, final_output_present AS finalOutputPresent, dispatch_id AS dispatchId
FROM message_flows
ORDER BY created_at
LIMIT 1;`)[0];
  assert.deepEqual(flow, {
    status: "runtime_completed",
    finalOutputPresent: 1,
    dispatchId
  });
  sqliteExec(dbFile, `
UPDATE message_flows
SET runtime_completed_at='${new Date(Date.now() - 10 * 60_000).toISOString()}'
WHERE dispatch_id='${dispatchId}';`);
  const silentReconcile = await runAction(root, {
    action: "message_flow.reconcile",
    messageFlowStuckAfterMs: 60_000
  });
  assert.equal(silentReconcile.count, 0);
  assert.equal(sqliteCount(dbFile, "incident_states", "incident_id LIKE 'message-flow-stuck-%'"), 0);
  const silentTick = await runAction(root, {
    action: "workflow.control_loop.tick",
    messageFlowStuckAfterMs: 60_000,
    drainQueued: false,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false
  });
  assert.equal(Boolean(silentTick.seededJobs?.some((job) => job.jobType === "message_flow_reconcile")), false);

  sqliteExec(dbFile, `UPDATE mixed_meeting_dispatches SET status='queued' WHERE dispatch_id='${dispatchId}';`);
  const failBin = await makeFakeOpenClaw(root, "fake-openclaw-fail.mjs", "fail");
  const failedDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    limit: 1,
    openclawBin: failBin,
    reportDelivery: false
  });
  assert.equal(failedDrain.results?.[0]?.status, "failed");

  const after = sqliteJson(dbFile, `
SELECT status
FROM message_flows
ORDER BY created_at
LIMIT 1;`)[0];
  assert.equal(after.status, "runtime_completed");
  const blocked = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM message_flow_events
WHERE event_type='state_regression_blocked';`)[0];
  assert.ok(blocked.count >= 1);

  const failedNotice = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "message_flow failure notice regression body",
    workflowId: "workflow-message-flow-failed-notice",
    meetingId: "meeting-message-flow-failed-notice",
    returnPolicy: "report_to_flashcat"
  });
  const failedNoticeDispatchId = failedNotice.dispatches[0].dispatchId;
  const failedNoticeDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: failedNoticeDispatchId,
    openclawBin: failBin,
    reportDelivery: false,
    deliverMessageFlowOutbox: false
  });
  assert.equal(failedNoticeDrain.results?.[0]?.status, "failed");
  const failedNoticeFlow = sqliteJson(dbFile, `
SELECT status, final_output_present AS finalOutputPresent, delivery_receipt_present AS deliveryReceiptPresent, outbox_id AS outboxId
FROM message_flows
WHERE dispatch_id='${failedNoticeDispatchId}'
LIMIT 1;`)[0];
  assert.equal(failedNoticeFlow.status, "runtime_failed");
  assert.equal(failedNoticeFlow.finalOutputPresent, 0);
  assert.equal(failedNoticeFlow.deliveryReceiptPresent, 0);
  assert.ok(failedNoticeFlow.outboxId);

  await runAction(root, {
    action: "telegram.outbox",
    operation: "mark",
    outboxId: failedNoticeFlow.outboxId,
    status: "sent"
  });
  const failedNoticeAfterDelivery = sqliteJson(dbFile, `
SELECT status, final_output_present AS finalOutputPresent, delivery_receipt_present AS deliveryReceiptPresent
FROM message_flows
WHERE dispatch_id='${failedNoticeDispatchId}'
LIMIT 1;`)[0];
  assert.deepEqual(failedNoticeAfterDelivery, {
    status: "runtime_failed",
    finalOutputPresent: 0,
    deliveryReceiptPresent: 0
  });
  const readiness = await runAction(root, { action: "workflow.status" });
  const findingKeys = readiness.readiness.findings.map((finding) => finding.key);
  assert.equal(findingKeys.includes("message_flow_failed_output_marked_sent"), false);

  const outboxPayload = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM telegram_outbox
WHERE outbox_id='${failedNoticeFlow.outboxId}'
LIMIT 1;`)[0].payloadJson;
  const reconciledPayload = {
    ...JSON.parse(outboxPayload),
    delivery: {
      status: "sent",
      receipts: [{ provider: "telegram", messageId: "verified-message-id" }]
    }
  };
  sqliteExec(dbFile, `
UPDATE telegram_outbox
SET status='sent',
    payload_json='${JSON.stringify(reconciledPayload).replaceAll("'", "''")}',
    updated_at='${new Date(Date.now() - 10 * 60_000).toISOString()}'
WHERE outbox_id='${failedNoticeFlow.outboxId}';`);
  sqliteExec(dbFile, `
UPDATE message_flows
SET runtime_failed_at='${new Date(Date.now() - 10 * 60_000).toISOString()}'
WHERE dispatch_id='${failedNoticeDispatchId}';`);
  const reconciled = await runAction(root, {
    action: "message_flow.reconcile",
    messageFlowStuckAfterMs: 60_000
  });
  assert.equal(reconciled.count >= 1, true);
  const reconciledFlow = sqliteJson(dbFile, `
SELECT status, delivery_receipt_present AS deliveryReceiptPresent
FROM message_flows
WHERE dispatch_id='${failedNoticeDispatchId}'
LIMIT 1;`)[0];
  assert.deepEqual(reconciledFlow, {
    status: "runtime_failed",
    deliveryReceiptPresent: 1
  });

  const failedDelivery = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "message_flow failed delivery regression body",
    workflowId: "workflow-message-flow-failed-delivery",
    meetingId: "meeting-message-flow-failed-delivery",
    returnPolicy: "report_to_flashcat"
  });
  const failedDeliveryDispatchId = failedDelivery.dispatches[0].dispatchId;
  await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: failedDeliveryDispatchId,
    openclawBin: failBin,
    reportDelivery: false,
    deliverMessageFlowOutbox: false
  });
  const failedDeliveryFlow = sqliteJson(dbFile, `
SELECT outbox_id AS outboxId
FROM message_flows
WHERE dispatch_id='${failedDeliveryDispatchId}'
LIMIT 1;`)[0];
  sqliteExec(dbFile, `
UPDATE telegram_outbox
SET status='failed',
    updated_at='${new Date(Date.now() - 10 * 60_000).toISOString()}'
WHERE outbox_id='${failedDeliveryFlow.outboxId}';
UPDATE message_flows
SET runtime_failed_at='${new Date(Date.now() - 10 * 60_000).toISOString()}'
WHERE dispatch_id='${failedDeliveryDispatchId}';`);
  await runAction(root, {
    action: "message_flow.reconcile",
    messageFlowStuckAfterMs: 60_000
  });
  const failedDeliveryReconciled = sqliteJson(dbFile, `
SELECT status, delivery_receipt_present AS deliveryReceiptPresent
FROM message_flows
WHERE dispatch_id='${failedDeliveryDispatchId}'
LIMIT 1;`)[0];
  assert.deepEqual(failedDeliveryReconciled, {
    status: "telegram_failed",
    deliveryReceiptPresent: 0
  });
}

async function testControlLoopDrainsMessageFlowRuntimes() {
  const root = await tempRoot("message-flow-control-loop");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  const sent = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "message_flow control-loop openclaw drain body",
    workflowId: "workflow-message-flow-openclaw-drain",
    meetingId: "meeting-message-flow-openclaw-drain",
    returnPolicy: "silent"
  });
  const dispatchId = sent.dispatches[0].dispatchId;
  const successBin = await makeFakeOpenClaw(root, "fake-openclaw-control-loop-success.mjs", "success");
  const tick = await runAction(root, {
    action: "workflow.control_loop.tick",
    runtimes: "hermers",
    jobLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    openclawBin: successBin
  });
  assert.equal(tick.claimedJobs?.[0]?.jobType, "runtime_drain");
  assert.equal(tick.jobResults?.[0]?.result?.results?.[0]?.dispatchId, dispatchId);
  const row = sqliteJson(path.join(root, "tracking.db"), `
SELECT d.status AS dispatchStatus, mf.status AS flowStatus, mf.final_output_present AS finalOutputPresent
FROM mixed_meeting_dispatches d
JOIN message_flows mf ON mf.dispatch_id=d.dispatch_id
WHERE d.dispatch_id='${dispatchId}'
LIMIT 1;`)[0];
  assert.deepEqual(row, {
    dispatchStatus: "acked",
    flowStatus: "runtime_completed",
    finalOutputPresent: 1
  });

  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "local_codex",
    runtime: "local_codex",
    agentId: "codex",
    displayName: "Local Codex",
    canReceiveDispatch: true,
    workflowIngressAdapter: "local_codex_inbox"
  });
  const local = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "cat_body",
    fromRuntime: "hermers",
    targets: ["local_codex:codex"],
    body: "message_flow control-loop local codex inbox body",
    workflowId: "workflow-message-flow-local-codex",
    meetingId: "meeting-message-flow-local-codex",
    returnPolicy: "report_to_flashcat"
  });
  const localDispatchId = local.dispatches[0].dispatchId;
  const localTick = await runAction(root, {
    action: "workflow.control_loop.tick",
    runtimes: "hermers",
    jobLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false
  });
  assert.equal(localTick.claimedJobs?.[0]?.jobType, "runtime_drain");
  assert.equal(localTick.jobResults?.[0]?.result?.results?.[0]?.adapter, "local_codex_inbox");
  const localRow = sqliteJson(path.join(root, "tracking.db"), `
SELECT d.status AS dispatchStatus, mf.status AS flowStatus, mf.final_output_present AS finalOutputPresent, mf.outbox_id AS outboxId
FROM mixed_meeting_dispatches d
JOIN message_flows mf ON mf.dispatch_id=d.dispatch_id
WHERE d.dispatch_id='${localDispatchId}'
LIMIT 1;`)[0];
  assert.deepEqual(localRow, {
    dispatchStatus: "acked",
    flowStatus: "runtime_completed",
    finalOutputPresent: 0,
    outboxId: ""
  });
  assert.equal(sqliteCount(path.join(root, "tracking.db"), "telegram_outbox", "message_type='message_flow_reply'"), 0);

  const starvationRoot = await tempRoot("message-flow-precise-runtime-window");
  await runAction(starvationRoot, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  await runAction(starvationRoot, {
    action: "runtime.agent.upsert",
    platform: "local_codex",
    runtime: "local_codex",
    agentId: "codex",
    displayName: "Local Codex",
    canReceiveDispatch: true,
    workflowIngressAdapter: "local_codex_inbox"
  });
  await runAction(starvationRoot, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "configured runtime should not occupy precise message_flow scan window",
    workflowId: "workflow-message-flow-precise-window",
    meetingId: "meeting-message-flow-precise-window",
    returnPolicy: "silent"
  });
  const unconfigured = await runAction(starvationRoot, {
    action: "workflow.message_flow.send",
    fromAgent: "cat_body",
    fromRuntime: "hermers",
    targets: ["local_codex:codex"],
    body: "unconfigured local_codex should still be discovered with runtimeLimit=1",
    workflowId: "workflow-message-flow-precise-window",
    meetingId: "meeting-message-flow-precise-window",
    returnPolicy: "silent"
  });
  const unconfiguredDispatchId = unconfigured.dispatches[0].dispatchId;
  const starvationBin = await makeFakeOpenClaw(starvationRoot, "fake-openclaw-precise-window-success.mjs", "success");
  const starvationTick = await runAction(starvationRoot, {
    action: "workflow.control_loop.tick",
    runtimes: "openclaw",
    runtimeLimit: 1,
    jobLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    openclawBin: starvationBin
  });
  assert.equal(Boolean(starvationTick.seededJobs?.some((job) => job.dedupeKey === `runtime_drain:local_codex:${unconfiguredDispatchId}`)), true);
}

async function testControlLoopSeedsStaleDeliveringOutbox() {
  const root = await tempRoot("stale-delivering-outbox");
  const request = await requestHumanGate(root, { workflowId: "workflow-stale-delivering", meetingId: "meeting-stale-delivering" });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
UPDATE telegram_outbox
SET status='delivering',
    updated_at='${new Date(Date.now() - 10 * 60_000).toISOString()}'
WHERE outbox_id='${request.telegramOutbox.outboxId}';`);
  const tick = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    deliverOutbox: true,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    drainQueued: false,
    autoDispatch: false
  });
  assert.equal(tick.claimedJobs?.[0]?.jobType, "telegram_outbox_deliver");
}

async function testTradeIntentFailClosed() {
  const root = await tempRoot("trade-intent");
  const intent = await runAction(root, {
    action: "trade.intent",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0",
    orderType: "limit",
    actor: "flashcat",
    assurance: "mtls",
    clientCertFingerprint: "test-cert"
  });
  assert.equal(intent.status, "rejected");
  assert.ok(intent.rejectionReasons.includes("missing_idempotency_key"));
  assert.ok(intent.rejectionReasons.includes("invalid_trade_quantity"));
  assert.ok(intent.rejectionReasons.includes("missing_workflow_id"));
  assert.ok(intent.rejectionReasons.includes("missing_trace_id"));
  assert.ok(intent.rejectionReasons.includes("missing_or_expired_intent_expiry"));
  assert.ok(intent.rejectionReasons.includes("missing_positive_reference_price"));
  assert.ok(intent.rejectionReasons.includes("missing_numeric_risk_guardrail"));
}

async function createApprovedHumanGate(root, input = {}) {
  const request = await requestHumanGate(root, input);
  const approved = approvedButtons(request)[0];
  await runAction(root, {
    action: "human_gate.resume",
    token: approved.callbackToken,
    text: "闪电猫原话：批准 A，用于交易链路回归测试。"
  });
  return request.humanGateId;
}

async function testTradeIntentChainAndReceiptGuardrails() {
  const root = await tempRoot("trade-chain");
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const proposalA = await runAction(root, {
    action: "trade.proposal",
    proposalId: "proposal-A",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "1",
    orderType: "limit",
    payload: { apiKey: "should-not-persist" }
  });
  await runAction(root, {
    action: "trade.proposal",
    proposalId: "proposal-B",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "1",
    orderType: "limit"
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "risk.decision",
      riskDecisionId: "risk-missing",
      proposalId: "proposal-missing",
      status: "approved"
    }),
    /approved risk\.decision requires an existing trade_proposal parent/
  );
  await runAction(root, {
    action: "risk.decision",
    riskDecisionId: "risk-A",
    proposalId: "proposal-A",
    assetType: "crypto",
    symbol: "BTC/USDT",
    status: "approved"
  });
  const humanGateId = await createApprovedHumanGate(root, {
    workflowId: "risk-A",
    meetingId: "risk-A",
    parentObjectId: "risk-A",
    expiresAt,
    payload: { riskDecisionId: "risk-A", proposalId: "proposal-A" }
  });
  const ready = await runAction(root, {
    action: "trade.intent",
    intentId: "intent-ready",
    workflowId: "workflow-trade-chain",
    traceId: "trace-trade-chain-ready",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-A",
    riskDecisionId: "risk-A",
    humanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-ready",
    expiresAt,
    executionMode: "paper",
    marketType: "spot",
    exchange: "paper_exchange",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    clientOrderId: "idem-ready",
    timeInForce: "gtc",
    priceConstraints: { referencePrice: 68000, limitPrice: 69000, maxSlippageBps: 20 },
    riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 },
    payload: { privateKey: "should-not-persist" }
  });
  assert.equal(ready.status, "ready_for_trading_core");
  const readyArtifact = JSON.parse(await fs.readFile(ready.path, "utf8"));
  assert.equal(readyArtifact.schemaVersion, 1);
  assert.equal(readyArtifact.objectType, "executable_trade_intent");
  assert.equal(readyArtifact.workflowId, "workflow-trade-chain");
  assert.equal(readyArtifact.traceId, "trace-trade-chain-ready");
  assert.equal(readyArtifact.executionMode, "paper");
  assert.equal(readyArtifact.marketType, "spot");
  assert.equal(readyArtifact.exchange, "paper_exchange");
  assert.equal(readyArtifact.baseAsset, "BTC");
  assert.equal(readyArtifact.quoteAsset, "USDT");
  assert.equal(readyArtifact.timeInForce, "gtc");
  assert.equal(readyArtifact.priceConstraints.referencePrice, 68000);
  assert.equal(readyArtifact.riskLimits.maxNotionalUsd, 20000);
  assert.equal(readyArtifact.clientOrderId, "idem-ready");
  assert.ok(readyArtifact.intentHash);
  assert.equal(readyArtifact.rejectionReasons.length, 0);

  const replay = await runAction(root, {
    action: "trade.intent",
    intentId: "intent-ready",
    workflowId: "workflow-trade-chain",
    traceId: "trace-trade-chain-ready",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-A",
    riskDecisionId: "risk-A",
    humanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-ready",
    expiresAt,
    executionMode: "paper",
    marketType: "spot",
    exchange: "paper_exchange",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    clientOrderId: "idem-ready",
    timeInForce: "gtc",
    priceConstraints: { referencePrice: 68000, limitPrice: 69000, maxSlippageBps: 20 },
    riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 },
    payload: { privateKey: "should-not-persist" }
  });
  assert.equal(replay.idempotentReplay, true);
  const aliasReplay = await runAction(root, {
    action: "trade.intent",
    intentId: "intent-ready",
    workflowId: "workflow-trade-chain",
    traceId: "trace-trade-chain-ready",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-A",
    riskDecisionId: "risk-A",
    humanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-ready",
    expiresAt,
    executionMode: "paper",
    marketType: "spot",
    exchange: "paper_exchange",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    clientOrderId: "idem-ready",
    timeInForce: "gtc",
    priceConstraints: { reference_price: 68000, limit_price: 69000, max_slippage_bps: 20 },
    riskLimits: { max_notional: 20000, max_loss: 500 },
    payload: { privateKey: "should-not-persist" }
  });
  assert.equal(aliasReplay.idempotentReplay, true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trade.intent",
      intentId: "intent-ready",
      workflowId: "workflow-trade-chain",
      traceId: "trace-trade-chain-ready",
      assetType: "crypto",
      symbol: "BTC/USDT",
      side: "buy",
      quantity: "0.2",
      orderType: "limit",
      proposalId: "proposal-A",
      riskDecisionId: "risk-A",
      humanGateId,
      actor: "flashcat",
      assurance: "mtls",
      sourceSystem: "codex_mtls",
      clientCertFingerprint: "test-cert",
      idempotencyKey: "idem-ready",
      expiresAt,
      executionMode: "simulation",
      marketType: "spot",
      exchange: "paper_exchange",
      baseAsset: "BTC",
      quoteAsset: "USDT",
      clientOrderId: "idem-ready",
      timeInForce: "gtc",
      priceConstraints: { referencePrice: 68000, limitPrice: 69000, maxSlippageBps: 20 },
      riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 },
      payload: { privateKey: "should-not-persist" }
    }),
    /idempotency_key_conflict/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trade.intent",
      workflowId: "workflow-trade-chain",
      traceId: "trace-trade-chain-conflict",
      assetType: "crypto",
      symbol: "BTC/USDT",
      side: "sell",
      quantity: "0.2",
      orderType: "limit",
      proposalId: "proposal-A",
      riskDecisionId: "risk-A",
      humanGateId,
      actor: "flashcat",
      assurance: "mtls",
      sourceSystem: "codex_mtls",
      clientCertFingerprint: "test-cert",
      idempotencyKey: "idem-ready",
      expiresAt,
      priceConstraints: { referencePrice: 68000, limitPrice: 69000 },
      riskLimits: { maxNotionalUsd: 20000 }
    }),
    /idempotency_key_conflict/
  );

  const missingCryptoField = await runAction(root, {
    action: "trade.intent",
    intentId: "intent-missing-crypto-field",
    workflowId: "workflow-trade-chain",
    traceId: "trace-trade-chain-missing-crypto-field",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-A",
    riskDecisionId: "risk-A",
    humanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-missing-crypto-field",
    expiresAt,
    executionMode: "paper",
    marketType: "spot",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    clientOrderId: "idem-missing-crypto-field",
    timeInForce: "gtc",
    priceConstraints: { referencePrice: 68000, limitPrice: 69000 },
    riskLimits: { maxNotionalUsd: 20000 }
  });
  assert.equal(missingCryptoField.status, "rejected");
  assert.ok(missingCryptoField.rejectionReasons.includes("crypto_exchange_required"));

  const liveIntent = await runAction(root, {
    action: "trade.intent",
    intentId: "intent-live-disabled",
    workflowId: "workflow-trade-chain",
    traceId: "trace-trade-chain-live-disabled",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-A",
    riskDecisionId: "risk-A",
    humanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-live-disabled",
    expiresAt,
    executionMode: "live",
    marketType: "spot",
    exchange: "paper_exchange",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    clientOrderId: "idem-live-disabled",
    timeInForce: "gtc",
    priceConstraints: { referencePrice: 68000, limitPrice: 69000 },
    riskLimits: { maxNotionalUsd: 20000 }
  });
  assert.equal(liveIntent.status, "rejected");
  assert.ok(liveIntent.rejectionReasons.includes("invalid_execution_mode"));

  const fallbackHumanGateId = await createApprovedHumanGate(root, {
    workflowId: "workflow-trade-fallback",
    meetingId: "workflow-trade-fallback",
    traceId: "trace-hgate-fallback",
    parentObjectId: "risk-A",
    expiresAt,
    payload: { riskDecisionId: "risk-A", proposalId: "proposal-A" }
  });
  const fallbackReady = await runAction(root, {
    action: "trade.intent",
    intentId: "intent-fallback",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-A",
    riskDecisionId: "risk-A",
    humanGateId: fallbackHumanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-fallback",
    expiresAt,
    executionMode: "paper",
    marketType: "spot",
    exchange: "paper_exchange",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    clientOrderId: "idem-fallback",
    timeInForce: "gtc",
    priceConstraints: { referencePrice: 68000, limitPrice: 69000 },
    riskLimits: { maxNotionalUsd: 20000 }
  });
  assert.equal(fallbackReady.status, "ready_for_trading_core");
  const fallbackArtifact = JSON.parse(await fs.readFile(fallbackReady.path, "utf8"));
  assert.equal(fallbackArtifact.workflowId, "workflow-trade-fallback");
  assert.equal(fallbackArtifact.traceId, "trace-hgate-fallback");

  const badChain = await runAction(root, {
    action: "trade.intent",
    workflowId: "workflow-trade-chain",
    traceId: "trace-trade-chain-bad",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-B",
    riskDecisionId: "risk-A",
    humanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-bad-chain",
    expiresAt,
    priceConstraints: { referencePrice: 68000, limitPrice: 69000 },
    riskLimits: { maxNotionalUsd: 20000 }
  });
  assert.equal(badChain.status, "rejected");
  assert.ok(badChain.rejectionReasons.includes("risk_decision_not_bound_to_trade_proposal"));

  const receipt = await runAction(root, {
    action: "trading_core.receipt",
    intentId: "intent-ready",
    status: "accepted",
    tradingCoreRef: "paper-order-1",
    payload: { apiSecret: "should-not-persist" }
  });
  assert.equal(receipt.status, "accepted");
  const filledReceipt = await runAction(root, {
    action: "trading_core.receipt",
    intentId: "intent-ready",
    status: "filled"
  });
  assert.equal(filledReceipt.status, "filled");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trading_core.receipt",
      intentId: "intent-ready",
      status: "mystery"
    }),
    /unknown trading_core receipt status/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trading_core.receipt",
      intentId: "intent-ready",
      status: "submitted"
    }),
    /invalid trading_core receipt transition/
  );

  const rejectedIntent = await runAction(root, {
    action: "trade.intent",
    intentId: "intent-rejected",
    workflowId: "workflow-trade-chain",
    traceId: "trace-trade-chain-rejected",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0",
    orderType: "limit",
    proposalId: "proposal-A",
    riskDecisionId: "risk-A",
    humanGateId,
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-rejected",
    expiresAt,
    priceConstraints: { referencePrice: 68000, limitPrice: 69000 },
    riskLimits: { maxNotionalUsd: 20000 }
  });
  assert.equal(rejectedIntent.status, "rejected");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trading_core.receipt",
      intentId: "intent-rejected",
      status: "filled"
    }),
    /invalid trading_core receipt transition/
  );

  const dbFile = path.join(root, "tracking.db");
  const certRow = sqliteJson(dbFile, `
SELECT client_cert_fingerprint AS certFingerprint
FROM executable_trade_intents
WHERE intent_id='intent-ready'
LIMIT 1;`)[0];
  assert.equal(certRow.certFingerprint, sha256Text("test-cert"));
  const intentStored = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM executable_trade_intents
WHERE intent_id='intent-ready'
LIMIT 1;`)[0].payloadJson;
  assert.equal(intentStored.includes("\"clientCertFingerprint\":\"test-cert\""), false);
  assert.equal(intentStored.includes(sha256Text("test-cert")), true);
  const protocolIntentStored = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM protocol_objects
WHERE object_id='intent-ready'
LIMIT 1;`)[0].payloadJson;
  assert.equal(protocolIntentStored.includes("\"clientCertFingerprint\":\"test-cert\""), false);
  assert.equal(protocolIntentStored.includes(sha256Text("test-cert")), true);
  const stored = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM protocol_objects
WHERE object_id='${proposalA.objectId}'
LIMIT 1;`)[0].payloadJson;
  assert.equal(stored.includes("should-not-persist"), false);
  assert.equal(stored.includes("[redacted]"), true);
}

async function testWorkflowSessionStore() {
  const root = await tempRoot("session-store");
  const firstPack = await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-pack-contract-smoke",
    ownerAgent: "cat_body",
    taskType: "trading_core_contract_smoke",
    runtimeTarget: "worker:local_codex",
    purpose: "Run the trading_core contract smoke with a minimal prepared context.",
    systemBrief: "Validate schema-bound paper execution contracts only. Never submit a live order.",
    workingContext: {
      workflowId: "workflow-session-store",
      currentPhase: "contract_smoke",
      longTermHistory: "do-not-copy-full-history"
    },
    toolPolicy: {
      allowedActions: ["validate_intent", "bridge_submit"],
      forbiddenActions: ["live_order", "gateway_restart"]
    },
    inputSchema: { type: "object", required: ["intentPath"] },
    outputSchema: { type: "object", required: ["status"] },
    evidenceRefs: ["artifact://workflow/contracts/trading-core"],
    checkpointRefs: ["checkpoint://workflow-session-store/latest"],
    resourceBudget: { maxTokens: 4000, maxWallSeconds: 120 },
    metadata: { apiKey: "should-not-persist" },
    createdBy: "local_codex"
  });
  assert.equal(firstPack.version, 1);
  assert.ok(firstPack.packHash);
  assert.equal(firstPack.metadata.apiKey, "[redacted]");

  const secondPack = await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-pack-contract-smoke",
    ownerAgent: "cat_body",
    taskType: "trading_core_contract_smoke",
    runtimeTarget: "worker:local_codex",
    purpose: "Run the trading_core contract smoke with updated output expectations.",
    metadata: { refreshToken: "also-should-not-persist" }
  });
  assert.equal(secondPack.version, 2);
  assert.notEqual(secondPack.packHash, firstPack.packHash);
  assert.equal(secondPack.metadata.refreshToken, "[redacted]");

  const retryPack = await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-pack-contract-smoke",
    ownerAgent: "cat_body",
    taskType: "trading_core_contract_smoke",
    runtimeTarget: "worker:local_codex",
    purpose: "Run the trading_core contract smoke with updated output expectations.",
    metadata: { refreshToken: "also-should-not-persist" }
  });
  assert.equal(retryPack.deduped, true);
  assert.equal(retryPack.version, 2);
  assert.equal(retryPack.packHash, secondPack.packHash);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.session_pack.upsert",
      sessionId: "session-pack-contract-smoke",
      purpose: "Invalid status should not silently become active.",
      status: "disbaled"
    }),
    /unknown workflow session pack status/
  );

  const pack = await runAction(root, {
    action: "workflow.session_pack.get",
    sessionId: "session-pack-contract-smoke"
  });
  assert.equal(pack.sessionId, "session-pack-contract-smoke");
  assert.equal(pack.workerInputTemplate.sessionVersion, 2);
  assert.equal(pack.workerInputTemplate.instructions.loadOnlyReferencedArtifacts, true);
  assert.deepEqual(pack.workerInputTemplate.evidenceRefs, ["artifact://workflow/contracts/trading-core"]);
  assert.equal(JSON.stringify(pack.workerInputTemplate).includes("should-not-persist"), false);

  const started = await runAction(root, {
    action: "workflow.session_run.start",
    runId: "session-run-contract-smoke",
    sessionId: "session-pack-contract-smoke",
    workflowId: "workflow-session-store",
    taskId: "task-contract-smoke",
    traceId: "trace-session-store",
    dispatchId: "dispatch-session-store",
    workerId: "worker-1",
    input: { intentPath: "/tmp/intent.json", apiSecret: "run-secret" }
  });
  assert.equal(started.status, "running");
  assert.equal(started.workerInput.sessionId, "session-pack-contract-smoke");
  assert.equal(started.workerInput.input.intentPath, "/tmp/intent.json");
  assert.equal(started.workerInput.input.apiSecret, "[redacted]");
  assert.ok(started.workerInput.toolPolicy.forbiddenActions.includes("live_order"));
  assert.equal(JSON.stringify(started.workerInput).includes("run-secret"), false);

  const duplicateStart = await runAction(root, {
    action: "workflow.session_run.start",
    runId: "session-run-contract-smoke",
    sessionId: "session-pack-contract-smoke"
  });
  assert.equal(duplicateStart.deduped, true);
  assert.equal(duplicateStart.runId, "session-run-contract-smoke");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.session_run.start",
      runId: "session-run-contract-smoke",
      sessionId: "session-pack-contract-smoke",
      input: { intentPath: "/tmp/other.json" }
    }),
    /workflow session run id conflict/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.session_run.start",
      sessionId: "session-pack-contract-smoke",
      status: "runnning"
    }),
    /unknown workflow session run status/
  );

  const completed = await runAction(root, {
    action: "workflow.session_run.complete",
    runId: "session-run-contract-smoke",
    output: { status: "contract_valid", accessKey: "output-secret" },
    receiptRef: "artifact://receipts/session-run-contract-smoke"
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.output.status, "contract_valid");
  assert.equal(completed.output.accessKey, "[redacted]");
  assert.equal(completed.receiptRef, "artifact://receipts/session-run-contract-smoke");

  const duplicateComplete = await runAction(root, {
    action: "workflow.session_run.complete",
    runId: "session-run-contract-smoke"
  });
  assert.equal(duplicateComplete.deduped, true);
  assert.deepEqual(duplicateComplete.output, completed.output);
  assert.equal(duplicateComplete.receiptRef, completed.receiptRef);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.session_run.complete",
      runId: "session-run-contract-smoke",
      output: { status: "different" }
    }),
    /workflow session run terminal conflict/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.session_run.complete",
      runId: "session-run-contract-smoke",
      status: "faild"
    }),
    /unknown workflow session run status/
  );

  const status = await runAction(root, { action: "workflow.status" });
  assert.equal(status.counts.workflow_session_packs, 1);
  assert.equal(status.counts.workflow_session_runs, 1);

  const dbFile = path.join(root, "tracking.db");
  const storedRun = sqliteJson(dbFile, `
SELECT input_json AS inputJson, worker_input_json AS workerInputJson, output_json AS outputJson
FROM workflow_session_runs
WHERE run_id='session-run-contract-smoke'
LIMIT 1;`)[0];
  assert.equal(storedRun.inputJson.includes("run-secret"), false);
  assert.equal(storedRun.workerInputJson.includes("run-secret"), false);
  assert.equal(storedRun.outputJson.includes("output-secret"), false);
  assert.equal(storedRun.inputJson.includes("[redacted]"), true);
  assert.equal(storedRun.outputJson.includes("[redacted]"), true);
}

async function testWorkflowEventStore() {
  const root = await tempRoot("workflow-events");
  const first = await runAction(root, {
    action: "workflow.event.append",
    eventId: "event-workflow-created",
    eventType: "workflow.created",
    workflowId: "workflow-events",
    traceId: "trace-events",
    actor: "local_codex",
    sourceRuntime: "local_codex",
    previousState: "",
    nextState: "active",
    idempotencyKey: "workflow-events-created",
    payload: {
      summary: "event store regression",
      callbackToken: "must-not-persist",
      command: "/hgate tawhg:secret-token approve"
    }
  });
  assert.equal(first.eventId, "event-workflow-created");
  assert.equal(first.eventType, "workflow.created");
  assert.equal(first.payload.callbackToken, "[redacted]");
  assert.equal(first.payload.command.includes("tawhg:<redacted>"), true);
  assert.equal(first.payloadHash, sha256Text(JSON.stringify(first.payload)));

  const retry = await runAction(root, {
    action: "workflow.event.append",
    eventId: "event-workflow-created",
    eventType: "workflow.created",
    workflowId: "workflow-events",
    traceId: "trace-events",
    actor: "local_codex",
    sourceRuntime: "local_codex",
    previousState: "",
    nextState: "active",
    idempotencyKey: "workflow-events-created",
    payload: {
      summary: "event store regression",
      callbackToken: "must-not-persist",
      command: "/hgate tawhg:secret-token approve"
    }
  });
  assert.equal(retry.deduped, true);
  assert.equal(retry.eventId, first.eventId);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.event.append",
      eventId: "event-workflow-created",
      eventType: "workflow.created",
      workflowId: "workflow-events",
      traceId: "trace-events",
      actor: "local_codex",
      sourceRuntime: "local_codex",
      previousState: "",
      nextState: "paused",
      idempotencyKey: "workflow-events-created",
      payload: {
        summary: "event store regression",
        callbackToken: "must-not-persist",
        command: "/hgate tawhg:secret-token approve"
      }
    }),
    /workflow event idempotency conflict.*field=nextState/
  );

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.event.append",
      eventId: "event-workflow-created-conflict",
      eventType: "workflow.created",
      workflowId: "workflow-events",
      traceId: "trace-events",
      idempotencyKey: "workflow-events-created",
      payload: { summary: "different payload should conflict" }
    }),
    /workflow event idempotency conflict/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.event.append",
      eventId: "event-hash-spoof",
      eventType: "workflow.created",
      workflowId: "workflow-events",
      traceId: "trace-events",
      idempotencyKey: "workflow-events-hash-spoof",
      payloadHash: first.payloadHash,
      payload: { summary: "different payload must not reuse a supplied hash" }
    }),
    /payloadHash must match canonical redacted payload hash/
  );

  await runAction(root, {
    action: "workflow.event.append",
    eventId: "event-dispatch-created",
    eventType: "dispatch.created",
    workflowId: "workflow-events",
    traceId: "trace-events",
    dispatchId: "dispatch-events",
    nextState: "queued",
    createdAt: "2099-01-01T00:00:01.000Z",
    payload: { dispatchId: "dispatch-events" }
  });
  await runAction(root, {
    action: "workflow.event.append",
    eventId: "event-runtime-receipt",
    eventType: "runtime.receipt",
    workflowId: "workflow-events",
    traceId: "trace-events",
    runtimeRunId: "runtime-run-events",
    idempotencyKey: "workflow-events-runtime-receipt",
    createdAt: "2099-01-01T00:00:02.000Z",
    payload: { status: "acked" }
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.event.append",
      eventId: "event-dispatch-created",
      eventType: "dispatch.created",
      workflowId: "workflow-events",
      traceId: "trace-events",
      idempotencyKey: "workflow-events-runtime-receipt",
      payload: { dispatchId: "dispatch-events" }
    }),
    /point to different events/
  );

  const list = await runAction(root, {
    action: "workflow.event.list",
    workflowId: "workflow-events",
    limit: 10
  });
  assert.equal(list.count, 3);
  assert.deepEqual(list.events.map((event) => event.eventType), ["runtime.receipt", "dispatch.created", "workflow.created"]);

  const timeline = await runAction(root, {
    action: "workflow.event.timeline",
    traceId: "trace-events",
    limit: 10
  });
  assert.equal(timeline.count, 3);
  assert.deepEqual(timeline.events.map((event) => event.eventType), ["workflow.created", "dispatch.created", "runtime.receipt"]);

  const dbFile = path.join(root, "tracking.db");
  assert.equal(sqliteCount(dbFile, "workflow_events"), 3);
  const stored = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM workflow_events
WHERE event_id='event-workflow-created'
LIMIT 1;`)[0].payloadJson;
  assert.equal(stored.includes("must-not-persist"), false);
  assert.equal(stored.includes("tawhg:secret-token"), false);
  assert.equal(stored.includes("[redacted]"), true);
  assert.equal(stored.includes("tawhg:<redacted>"), true);
}

async function testAutomaticWorkflowEvents() {
  const root = await tempRoot("workflow-events-auto");
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId: "workflow-auto-events",
    workflowType: "governance",
    objective: "Verify automatic event emission."
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  const flowDispatch = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "automatic event dispatch regression",
    meetingId: "meeting-auto-events",
    workflowId: "workflow-auto-events",
    traceId: "trace-auto-events",
    returnPolicy: "silent"
  });
  const dispatch = flowDispatch.dispatches[0];
  const successBin = await makeFakeOpenClaw(root, "fake-openclaw-auto-events.mjs", "success");
  await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: dispatch.dispatchId,
    openclawBin: successBin,
    reportDelivery: false
  });
  const request = await requestHumanGate(root, {
    workflowId: "workflow-auto-events",
    meetingId: "meeting-auto-events"
  });
  await runAction(root, {
    action: "human_gate.resume",
    token: approvedButtons(request)[0].callbackToken,
    text: "闪电猫原话：批准自动事件测试。"
  });
  await runAction(root, {
    action: "side_effect.record",
    sideEffectId: "side-effect-auto-events",
    workflowId: "workflow-auto-events",
    traceId: "trace-auto-events",
    status: "confirmed",
    sideEffectType: "test_side_effect",
    payload: { apiSecret: "must-not-persist" }
  });
  await runAction(root, {
    action: "incident.state",
    incidentId: "incident-auto-events",
    workflowId: "workflow-auto-events",
    traceId: "trace-auto-events",
    status: "active",
    summary: "automatic event incident regression"
  });

  const timeline = await runAction(root, {
    action: "workflow.event.timeline",
    workflowId: "workflow-auto-events",
    limit: 100
  });
  const eventTypes = timeline.events.map((event) => event.eventType);
  for (const expected of [
    "workflow.created",
    "dispatch.created",
    "runtime.receipt",
    "human_gate.requested",
    "human_gate.submitted",
    "side_effect.recorded",
    "incident.created"
  ]) {
    assert.equal(eventTypes.includes(expected), true, `${expected} should be present`);
  }
  const sideEffectEvent = timeline.events.find((event) => event.eventType === "side_effect.recorded");
  assert.equal(JSON.stringify(sideEffectEvent.payload).includes("must-not-persist"), false);
  assert.equal(JSON.stringify(sideEffectEvent.payload).includes("[redacted]"), false);
  const dbFile = path.join(root, "tracking.db");
  const runtimeReceiptJoin = sqliteJson(dbFile, `
SELECT e.runtime_run_id AS runtimeRunId,
       rr.runtime_run_id AS joinedRuntimeRunId,
       e.message_flow_id AS messageFlowId,
       mf.flow_id AS joinedMessageFlowId
FROM workflow_events e
LEFT JOIN runtime_runs rr ON rr.runtime_run_id=e.runtime_run_id
LEFT JOIN message_flows mf ON mf.flow_id=e.message_flow_id
WHERE e.event_type='runtime.receipt' AND e.dispatch_id='${dispatch.dispatchId}'
LIMIT 1;`)[0];
  assert.ok(runtimeReceiptJoin.runtimeRunId);
  assert.equal(runtimeReceiptJoin.joinedRuntimeRunId, runtimeReceiptJoin.runtimeRunId);
  assert.ok(runtimeReceiptJoin.messageFlowId);
  assert.equal(runtimeReceiptJoin.joinedMessageFlowId, runtimeReceiptJoin.messageFlowId);
  const submittedEvent = timeline.events.find((event) => event.eventType === "human_gate.submitted");
  assert.equal(submittedEvent.humanGateId, request.humanGateId);
  assert.equal(submittedEvent.payload.flashcatOriginalWords, "闪电猫原话：批准自动事件测试。");
}

async function testWorkflowPermissionGate() {
  const root = await tempRoot("workflow-permission-gate");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_body",
    displayName: "猫之体",
    workflowIngressAdapter: "acp",
    endpointRef: "hermers-profile:catbody",
    capabilities: { mode: "message_only" }
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "cat_claw",
    displayName: "猫爪",
    capabilities: {}
  });

  const allowedMessage = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.message_flow.send",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(allowedMessage.allowed, true);
  assert.equal(allowedMessage.requiredCapability, "message_flow.send");

  const deniedRuntime = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.bridge.drain",
    callerAgent: "cat_body",
    callerRuntime: "hermers",
    toolMode: "full"
  });
  assert.equal(deniedRuntime.allowed, false);
  assert.equal(deniedRuntime.reason, "missing_capability:runtime.dispatch");

  const unregisteredSpoof = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.bridge.drain",
    callerAgent: "main",
    callerRuntime: "hermers",
    toolMode: "full"
  });
  assert.equal(unregisteredSpoof.allowed, false);
  assert.equal(unregisteredSpoof.reason, "caller_not_registered");

  const auditDenied = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "cat_claw.audit",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(auditDenied.allowed, false);
  assert.equal(auditDenied.reason, "missing_capability:cat_claw.audit");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "runtime.bridge.drain",
      runtime: "hermers",
      callerAgent: "cat_body",
      callerRuntime: "hermers"
    }),
    /workflow permission denied: action=runtime\.bridge\.drain/
  );

  const dbFile = path.join(root, "tracking.db");
  const deniedEvent = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, source_agent AS sourceAgent, payload_json AS payloadJson
FROM workflow_events
WHERE event_type='permission.denied'
ORDER BY created_at DESC
LIMIT 1;`)[0];
  assert.equal(deniedEvent.eventType, "permission.denied");
  assert.equal(deniedEvent.status, "denied");
  assert.equal(deniedEvent.sourceAgent, "cat_body");
  assert.equal(deniedEvent.payloadJson.includes("runtime.dispatch"), true);

  const catClawGate = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "human_gate.request",
    callerAgent: "cat_claw",
    callerRuntime: "openclaw"
  });
  assert.equal(catClawGate.allowed, true);
  assert.equal(catClawGate.reason, "capability_allowed");

  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_body",
    capabilities: {
      permissions: ["runtime.dispatch"],
      forbiddenActions: ["runtime.bridge.drain"]
    }
  });
  const forbidden = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.bridge.drain",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(forbidden.allowed, false);
  assert.equal(forbidden.reason, "action_forbidden_by_policy");

  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_body",
    capabilities: {
      permissions: ["message_flow.send"],
      forbiddenActions: ["workflow.message_flow.send"]
    }
  });
  const canonicalForbidden = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "message_flow.send",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(canonicalForbidden.allowed, false);
  assert.equal(canonicalForbidden.reason, "action_forbidden_by_policy");
}

async function testWorkflowSessionStoreCli() {
  const root = await tempRoot("session-store-cli");
  const pack = workflowCliJson([
    "workflow-session-pack-upsert",
    "--root", root,
    "--session", "cli-session",
    "--owner-agent", "cat_body",
    "--task-type", "contract_smoke",
    "--purpose", "CLI session pack smoke",
    "--runtime-target", "worker:local_codex",
    "--working-context", "{\"workflowId\":\"wf-cli\"}",
    "--tool-policy", "{\"forbiddenActions\":[\"live_order\"]}",
    "--metadata", "{\"apiKey\":\"secret\"}"
  ]);
  assert.equal(pack.version, 1);
  assert.equal(pack.metadata.apiKey, "[redacted]");

  const retryPack = workflowCliJson([
    "workflow-session-pack-upsert",
    "--root", root,
    "--session", "cli-session",
    "--owner-agent", "cat_body",
    "--task-type", "contract_smoke",
    "--purpose", "CLI session pack smoke",
    "--runtime-target", "worker:local_codex",
    "--working-context", "{\"workflowId\":\"wf-cli\"}",
    "--tool-policy", "{\"forbiddenActions\":[\"live_order\"]}",
    "--metadata", "{\"apiKey\":\"secret\"}"
  ]);
  assert.equal(retryPack.deduped, true);
  assert.equal(retryPack.version, 1);

  const started = workflowCliJson([
    "workflow-session-run-start",
    "--root", root,
    "--session", "cli-session",
    "--run", "cli-run",
    "--workflow", "wf-cli",
    "--task", "task-cli",
    "--input", "{\"intentPath\":\"/tmp/intent.json\",\"apiSecret\":\"secret\"}"
  ]);
  assert.equal(started.status, "running");
  assert.equal(started.workerInput.input.apiSecret, "[redacted]");

  const completed = workflowCliJson([
    "workflow-session-run-complete",
    "--root", root,
    "--run", "cli-run",
    "--output", "{\"status\":\"contract_valid\",\"accessKey\":\"secret\"}",
    "--receipt", "artifact://cli-run"
  ]);
  assert.equal(completed.output.accessKey, "[redacted]");
  assert.equal(completed.receiptRef, "artifact://cli-run");

  const duplicateComplete = workflowCliJson([
    "workflow-session-run-complete",
    "--root", root,
    "--run", "cli-run"
  ]);
  assert.equal(duplicateComplete.deduped, true);
  assert.deepEqual(duplicateComplete.output, completed.output);
  assert.equal(duplicateComplete.receiptRef, completed.receiptRef);

  await assertRejectsMessage(
    () => {
      try {
        execFileSync("node", [
          path.resolve("bin/cat-meeting-governance.mjs"),
          "workflow-session-run-complete",
          "--root", root,
          "--run", "cli-run",
          "--status", "faild"
        ], { encoding: "utf8", stdio: "pipe" });
      } catch (error) {
        throw new Error(error.stderr || error.message);
      }
    },
    /unknown workflow session run status/
  );
}

async function testExpiredHumanGateBlocked() {
  const root = await tempRoot("expired-hgate");
  const request = await requestHumanGate(root, {
    workflowId: "workflow-expired",
    meetingId: "meeting-expired",
    expiresAt: "2000-01-01T00:00:00.000Z"
  });
  const result = await runAction(root, {
    action: "human_gate.resume",
    token: approvedButtons(request)[0].callbackToken,
    text: "闪电猫原话：这条过期选择不应生效。"
  });
  assert.equal(result.status, "expired");
}

async function testHumanGateRejectsWrongTelegramUser() {
  const root = await tempRoot("hgate-wrong-user");
  const request = await requestHumanGate(root);
  const result = await runAction(root, {
    action: "human_gate.button_callback",
    token: approvedButtons(request)[0].callbackToken,
    senderId: "123456",
    feedbackText: "非闪电猫用户不应完成 Human Gate。"
  });
  assert.equal(result.status, "telegram_user_not_allowed");
}

async function testHumanGateRejectsMissingTelegramSender() {
  const root = await tempRoot("hgate-missing-sender");
  const request = await requestHumanGate(root);
  const result = await runAction(root, {
    action: "human_gate.button_callback",
    token: approvedButtons(request)[0].callbackToken,
    sourceSystem: "telegram_callback_query",
    feedbackText: "缺少 senderId 的 Telegram 回调不应完成 Human Gate。"
  });
  assert.equal(result.status, "telegram_sender_id_required");
}

async function testReadinessGatewayDegraded() {
  const root = await tempRoot("readiness-gateway");
  const degradedBin = await makeFakeOpenClaw(root, "fake-openclaw-health-degraded.mjs", "health-degraded");
  const status = await runAction(root, {
    action: "workflow.readiness",
    activeChecks: true,
    openclawBin: degradedBin
  });
  assert.equal(status.status, "degraded");
  assert.ok(status.findings.some((finding) => finding.key === "openclaw_gateway_event_loop_degraded"));
}

async function testHermersProfileModeReadinessAndRegistry() {
  const root = await tempRoot("profile-mode-readiness");
  const modesPath = await writeHermersProfileModes(root, {
    catears: {
      observedMode: "cold",
      activeWork: false,
      reason: "idle profile held cold for regression"
    }
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_ears",
    displayName: "猫之耳",
    canReceiveDispatch: true,
    workflowIngressAdapter: "acp",
    endpointRef: "hermers-profile:catears"
  });
  await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-profile-readiness",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "profile mode readiness regression",
    dispatchType: "cron_heartbeat",
    priority: "normal"
  });
  const registry = await runAction(root, {
    action: "workflow.runtime_agents",
    stabilityProfileModesPath: modesPath
  });
  const catEars = registry.runtimeRegistry.hermers.find((agent) => agent.agentId === "cat_ears");
  assert.equal(catEars.profile, "catears");
  assert.equal(catEars.profileMode, "cold");
  assert.ok(registry.snapshotFile.endsWith(path.join("registry", "runtime-agents.snapshot.json")));
  const registrySnapshot = JSON.parse(await fs.readFile(registry.snapshotFile, "utf8"));
  assert.equal(registrySnapshot.source.authority, "trading-agents-workflow.runtime_agents");
  assert.equal(Boolean(registrySnapshot.records.some((agent) => agent.agentId === "cat_ears" && agent.runtime === "hermers")), true);
  assert.equal(Boolean(registrySnapshot.derivedScopes.activeOpenClawAgentIds.includes("cat_ears")), false);

  const readiness = await runAction(root, {
    action: "workflow.readiness",
    stabilityProfileModesPath: modesPath
  });
  assert.equal(readiness.planes.runtime.hermersProfileModes.profiles.catears.observedMode, "cold");
  assert.equal(readiness.findings.some((finding) => finding.key === "runtime_profile_mode_deferred_dispatches"), false);
}

async function testHermersProfileModeDoesNotDeferDrainAdmission() {
  const root = await tempRoot("profile-mode-drain");
  const modesPath = await writeHermersProfileModes(root, {
    catears: {
      observedMode: "hibernate",
      activeWork: false,
      reason: "idle profile hibernated for regression"
    }
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_ears",
    displayName: "猫之耳",
    canReceiveDispatch: true,
    workflowIngressAdapter: "acp",
    endpointRef: "hermers-profile:catears"
  });
  const dispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-profile-drain",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "profile mode drain regression",
    dispatchType: "cron_heartbeat",
    priority: "normal"
  });
  const drained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    limit: 1,
    stabilityProfileModesPath: modesPath,
    dryRun: true
  });
  assert.equal(drained.dispatches[0].admission.allowed, true);
  assert.equal(drained.dispatches[0].admission.action, "observe");

  const dbFile = path.join(root, "tracking.db");
  const row = sqliteJson(dbFile, `
SELECT status, sent_at AS sentAt, failure_type AS failureType, next_retry_at AS nextRetryAt
FROM mixed_meeting_dispatches
WHERE dispatch_id='${dispatch.dispatchId}';`)[0];
  assert.equal(row.status, "queued");
  assert.equal(row.sentAt, null);
  assert.equal(row.failureType, null);
  assert.equal(row.nextRetryAt, null);
  assert.equal(sqliteCount(dbFile, "runtime_runs", `dispatch_id='${dispatch.dispatchId}'`), 0);
}

async function testHermersRuntimeDrainFailsClosedOnRegistryGaps() {
  const root = await tempRoot("hermers-registry-fail-closed");
  const dbFile = path.join(root, "tracking.db");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_ears",
    displayName: "猫之耳",
    canReceiveDispatch: true,
    workflowIngressAdapter: "acp",
    endpointRef: "hermers-profile:catears"
  });
  const missing = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-registry-missing",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "missing registry row",
    dispatchType: "cron_heartbeat"
  });
  sqliteExec(dbFile, "DELETE FROM runtime_agents WHERE agent_id='cat_ears';");
  const missingDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: missing.dispatchId
  });
  assert.equal(missingDrain.results[0].failureType, "runtime_registry_missing");

  sqliteExec(dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, runtime, agent_id, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES ('dispatch-null-agent-key', 'meeting-null-agent-key', 'hermers', 'cat_ears', 'cron_heartbeat', 'queued', 'normal', 0, 1, 'null agent key', '{}', 'test', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`);
  const nullKeyDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: "dispatch-null-agent-key"
  });
  assert.equal(nullKeyDrain.results[0].failureType, "runtime_registry_missing");

  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_ears",
    displayName: "猫之耳",
    canReceiveDispatch: true,
    workflowIngressAdapter: "acp",
    endpointRef: "hermers-profile:catears"
  });
  const inactive = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-registry-inactive",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "inactive registry",
    dispatchType: "cron_heartbeat"
  });
  sqliteExec(dbFile, "UPDATE runtime_agents SET status='inactive' WHERE agent_id='cat_ears';");
  const inactiveDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: inactive.dispatchId
  });
  assert.equal(inactiveDrain.results[0].failureType, "runtime_registry_inactive");

  sqliteExec(dbFile, "UPDATE runtime_agents SET status='active', platform='hermers', workflow_ingress_adapter='acp', endpoint_ref='hermers-profile:catears' WHERE agent_id='cat_ears';");
  const platformMismatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-registry-platform",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "platform mismatch",
    dispatchType: "cron_heartbeat"
  });
  sqliteExec(dbFile, "UPDATE runtime_agents SET platform='openclaw' WHERE agent_id='cat_ears';");
  const platformDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: platformMismatch.dispatchId
  });
  assert.equal(platformDrain.results[0].failureType, "runtime_registry_platform_mismatch");

  sqliteExec(dbFile, "UPDATE runtime_agents SET platform='hermers', workflow_ingress_adapter='acp', endpoint_ref='hermers-profile:catears' WHERE agent_id='cat_ears';");
  const adapterUnavailable = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-registry-adapter",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "adapter unavailable",
    dispatchType: "cron_heartbeat"
  });
  sqliteExec(dbFile, "UPDATE runtime_agents SET workflow_ingress_adapter='none' WHERE agent_id='cat_ears';");
  const adapterDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: adapterUnavailable.dispatchId
  });
  assert.equal(adapterDrain.results[0].failureType, "runtime_registry_adapter_unavailable");

  sqliteExec(dbFile, "UPDATE runtime_agents SET workflow_ingress_adapter='acp' WHERE agent_id='cat_ears';");
  const disabled = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-registry-disabled",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "dispatch disabled",
    dispatchType: "cron_heartbeat"
  });
  sqliteExec(dbFile, "UPDATE runtime_agents SET can_receive_dispatch=0 WHERE agent_id='cat_ears';");
  const disabledDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: disabled.dispatchId
  });
  assert.equal(disabledDrain.results[0].failureType, "runtime_registry_dispatch_disabled");

  sqliteExec(dbFile, "UPDATE runtime_agents SET can_receive_dispatch=1, endpoint_ref='' WHERE agent_id='cat_ears';");
  const noEndpoint = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-registry-endpoint",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "endpoint missing",
    dispatchType: "cron_heartbeat"
  });
  const endpointDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: noEndpoint.dispatchId
  });
  assert.equal(endpointDrain.results[0].failureType, "runtime_registry_endpoint_missing");

  sqliteExec(dbFile, "UPDATE runtime_agents SET endpoint_ref='hermers-profile:catears' WHERE agent_id='cat_ears';");
  const overrideMismatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-acp-override",
    runtime: "hermers",
    agentId: "cat_ears",
    prompt: "acp override mismatch",
    dispatchType: "cron_heartbeat"
  });
  const overrideDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: overrideMismatch.dispatchId,
    acpAgent: "/tmp/not-registry-owned"
  });
  assert.equal(overrideDrain.results[0].failureType, "runtime_bridge_error");
  assert.match(overrideDrain.results[0].error, /override is not registry-owned/);
}

async function testRegistryRoutingRankAndDisperseResolution() {
  const root = await tempRoot("registry-routing-rank");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_nose",
    displayName: "猫之鼻",
    canReceiveDispatch: true,
    workflowIngressAdapter: "acp",
    endpointRef: "hermers-profile:catnose",
    routingPolicy: { routingRank: 20 }
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "cat_nose",
    displayName: "猫之鼻",
    canReceiveDispatch: true,
    workflowIngressAdapter: "openclaw_native",
    endpointRef: "openclaw-agent:cat_nose",
    routingPolicy: { routingRank: 5 }
  });
  const dispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-routing-rank",
    agentId: "cat_nose",
    prompt: "routing rank should select openclaw"
  });
  assert.equal(dispatch.runtime, "openclaw");

  const disperse = await runAction(root, {
    action: "meeting.disperse",
    meetingId: "meeting-disperse-rank",
    targets: ["cat_nose"],
    summary: "unqualified disperse target should use registry resolution"
  });
  assert.equal(disperse.dispatches[0].runtime, "openclaw");
}

async function testHermersProfileModeMalformedFileReadiness() {
  const root = await tempRoot("profile-mode-malformed");
  const modesPath = path.join(root, "bad-profile-modes.json");
  await fs.writeFile(modesPath, "{not-json", "utf8");
  const readiness = await runAction(root, {
    action: "workflow.readiness",
    stabilityProfileModesPath: modesPath
  });
  assert.equal(readiness.planes.runtime.hermersProfileModes.ok, false);
  assert.equal(readiness.planes.runtime.hermersProfileModes.unavailable, false);
  assert.ok(readiness.findings.some((finding) => finding.key === "hermers_profile_modes_unreadable"));
}

async function testCatClawOpenClawOnlyRegistryGuard() {
  const root = await tempRoot("cat-claw-registry");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "runtime.agent.upsert",
      platform: "hermers",
      runtime: "hermers",
      agentId: "cat_claw",
      workflowIngressAdapter: "acp"
    }),
    /cat_claw is an OpenClaw-only secretary agent/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "runtime.agent.upsert",
      platform: "openclaw",
      runtime: "openclaw",
      agentId: "cat_claw",
      executionAdapter: "acp",
      workflowIngressAdapter: "acp"
    }),
    /openclaw_native adapters/
  );
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "cat_claw",
    displayName: "猫爪",
    workflowIngressAdapter: "openclaw_native",
    endpointRef: "openclaw-agent:cat_claw"
  });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, routing_policy_json, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
VALUES ('hermers:cat_claw', 'hermers', 'cat_claw', 'cat_claw', '', 'retired', 'hermers', 'acp', 'openclaw_gateway', 'openclaw_route_shell', 'acp', 'openclaw_route_shell', 'hermers_acp', 'reply_to_source_chat', 0, 0, 0, '{}', '', '{}', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');`);
  const registry = await runAction(root, { action: "workflow.runtime_agents" });
  assert.equal(Boolean(registry.runtimeRegistry.hermers?.some((agent) => agent.agentId === "cat_claw")), false);
  assert.equal(Boolean(registry.runtimeRegistry.openclaw?.some((agent) => agent.agentId === "cat_claw")), true);

  sqliteExec(dbFile, `
UPDATE runtime_agents
SET status='active', can_receive_dispatch=1, can_start_workflow=1
WHERE agent_key='hermers:cat_claw';`);
  const dispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-cat-claw-default",
    agentId: "cat_claw",
    prompt: "cat_claw should resolve to openclaw despite active legacy row"
  });
  assert.equal(dispatch.runtime, "openclaw");
  assert.equal(dispatch.workflowIngressAdapter, "openclaw_native");
}

try {
  requireSqliteCli();
  const tests = [
    ["human_gate language/resume", testHumanGateLanguageAndResume],
    ["human_gate pending cleanup/retry", testHumanGatePendingCleanupAndRetryRedaction],
    ["human_gate stage dedup/supersede", testHumanGateStageDedupAndSupersede],
    ["schedule resume semantics", testScheduleResumeSemantics],
    ["message_flow runtime bridge", testMessageFlowRuntimeBridge],
    ["message_flow control-loop runtime drains", testControlLoopDrainsMessageFlowRuntimes],
    ["control_loop stale delivering outbox", testControlLoopSeedsStaleDeliveringOutbox],
    ["trade_intent fail-closed", testTradeIntentFailClosed],
    ["trade chain and receipt guardrails", testTradeIntentChainAndReceiptGuardrails],
    ["workflow event store", testWorkflowEventStore],
    ["automatic workflow events", testAutomaticWorkflowEvents],
    ["workflow permission gate", testWorkflowPermissionGate],
    ["workflow session store", testWorkflowSessionStore],
    ["workflow session store cli", testWorkflowSessionStoreCli],
    ["expired human_gate blocked", testExpiredHumanGateBlocked],
    ["human_gate wrong telegram user blocked", testHumanGateRejectsWrongTelegramUser],
    ["human_gate missing telegram sender blocked", testHumanGateRejectsMissingTelegramSender],
    ["readiness gateway degraded", testReadinessGatewayDegraded],
    ["hermers profile mode readiness/registry", testHermersProfileModeReadinessAndRegistry],
    ["hermers profile mode does not defer drain admission", testHermersProfileModeDoesNotDeferDrainAdmission],
    ["hermers runtime drain fails closed on registry gaps", testHermersRuntimeDrainFailsClosedOnRegistryGaps],
    ["registry routing rank and disperse resolution", testRegistryRoutingRankAndDisperseResolution],
    ["hermers profile mode malformed file readiness", testHermersProfileModeMalformedFileReadiness],
    ["cat_claw openclaw-only registry guard", testCatClawOpenClawOnlyRegistryGuard]
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`ok - ${name}`);
  }
} finally {
  await Promise.all(createdRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
}
