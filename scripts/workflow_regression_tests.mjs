#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  assert.deepEqual(approved.map((button) => button.label), ["批准方案 A", "批准方案 B", "批准方案 C"]);
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
  const body = mode === "success"
    ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"runtime bridge final output"}]}}));\n`
    : `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"error",summary:"fake runtime failure"}));\n`;
  await fs.writeFile(file, body, "utf8");
  await fs.chmod(file, 0o755);
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
}

try {
  requireSqliteCli();
  const tests = [
    ["human_gate language/resume", testHumanGateLanguageAndResume],
    ["human_gate pending cleanup/retry", testHumanGatePendingCleanupAndRetryRedaction],
    ["schedule resume semantics", testScheduleResumeSemantics],
    ["message_flow runtime bridge", testMessageFlowRuntimeBridge]
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`ok - ${name}`);
  }
} finally {
  await Promise.all(createdRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
}
