#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { workflowChildPayload } from "../src/console/server.js";
import { WorkflowActionGateway } from "../src/console/action-gateway.js";
import { WorkflowReadModel } from "../src/console/read-model.js";
import {
  DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS,
  controlLoopWorkerKillAfterMs
} from "../src/control-loop-budget.js";
import { runAction as runActionRaw } from "../src/core.js";

const createdRoots = [];
const LOCAL_CODEX_REGISTRY_WRITE_ENV = "TRADING_AGENTS_WORKFLOW_LOCAL_CODEX_REGISTRY_WRITE";
const TEST_SEMANTIC_CONTINUATION_FAILURE_ENV = "TRADING_AGENTS_WORKFLOW_TEST_SEMANTIC_CONTINUATION_FAILURE";

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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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

function isRegistryWriteSetup(input = {}) {
  return ["runtime.agent", "runtime.agent.upsert"].includes(String(input.action || ""));
}

function hasCallerIdentity(input = {}) {
  return [
    "callerAgent",
    "caller_agent",
    "principalAgent",
    "principal_agent",
    "fromAgent",
    "from_agent",
    "sourceAgent",
    "source_agent",
    "createdBy",
    "created_by",
    "updatedBy",
    "updated_by",
    "requester",
    "actor",
    "callerRuntime",
    "caller_runtime",
    "principalRuntime",
    "principal_runtime",
    "fromRuntime",
    "from_runtime",
    "sourceRuntime",
    "source_runtime"
  ].some((key) => input[key] !== undefined && input[key] !== null && input[key] !== "");
}

async function runAction(root, input = {}) {
  if (isRegistryWriteSetup(input) && !hasCallerIdentity(input)) {
    const previous = process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV];
    process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV] = "1";
    try {
      return await runActionRaw(root, {
        callerAgent: "local_codex",
        callerRuntime: "local_codex",
        sourceSystem: "local_codex",
        ...input
      });
    } finally {
      if (previous === undefined) {
        delete process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV];
      } else {
        process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV] = previous;
      }
    }
  }
  return runActionRaw(root, input);
}

async function withLocalCodexRegistryWrite(fn) {
  const previous = process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV];
  process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV] = "1";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV];
    } else {
      process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV] = previous;
    }
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

function draftPhaseOwners(draft) {
  return new Set((draft.spec?.phases || []).flatMap((phase) => [phase.ownerAgent, ...(phase.ownerAgents || [])].filter(Boolean)));
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

  const feedbackPendingRoot = await tempRoot("hgate-feedback-pending-replay");
  const feedbackPendingRequest = await requestHumanGate(feedbackPendingRoot);
  const feedbackPendingDbFile = path.join(feedbackPendingRoot, "tracking.db");
  const feedbackPendingButton = feedbackPendingRequest.buttons[0];
  const pendingSelection = await runAction(feedbackPendingRoot, {
    action: "human_gate.button_callback",
    callbackData: `tawhg:${feedbackPendingButton.callbackToken}`
  });
  assert.equal(pendingSelection.status, "feedback_pending");
  const feedbackPendingReplay = await requestHumanGate(feedbackPendingRoot);
  assert.equal(feedbackPendingReplay.humanGateId, feedbackPendingRequest.humanGateId);
  assert.equal(feedbackPendingReplay.status, "feedback_pending");
  assert.equal(feedbackPendingReplay.deliveryRequired, false);
  assert.equal(sqliteCount(feedbackPendingDbFile, "human_gate_buttons", `human_gate_id='${feedbackPendingRequest.humanGateId}' AND status='active'`), 0);
  const feedbackPendingOutboxBefore = sqliteJson(feedbackPendingDbFile, `
SELECT payload_json AS payloadJson
FROM telegram_outbox
WHERE outbox_id='${feedbackPendingRequest.telegramOutbox.outboxId}'
LIMIT 1;`)[0];
  assert.equal(JSON.parse(feedbackPendingOutboxBefore.payloadJson).buttons.length, 6);
  await runAction(feedbackPendingRoot, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    deliverOutbox: false,
    createHumanGateInbox: false
  });
  const feedbackPendingOutboxAfter = sqliteJson(feedbackPendingDbFile, `
SELECT payload_json AS payloadJson
FROM telegram_outbox
WHERE outbox_id='${feedbackPendingRequest.telegramOutbox.outboxId}'
LIMIT 1;`)[0];
  assert.equal(JSON.parse(feedbackPendingOutboxAfter.payloadJson).buttons.length, 6);

  const root = await tempRoot("hgate-resume");
  const request = await requestHumanGate(root);
  assert.equal(request.status, "pending");
  assertCompletePlanButtons(request);
  const dbFile = path.join(root, "tracking.db");
  const ensured = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    deliverOutbox: false,
    createHumanGateInbox: false
  });
  assert.equal(ensured.jobResults?.[0]?.jobType, "human_gate_request_ensure");
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${request.humanGateId}' AND status='active'`), 6);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${request.humanGateId}' AND status='superseded'`), 0);

  const selected = request.buttons[0];
  const resumed = await runAction(root, {
    action: "human_gate.resume",
    token: selected.callbackToken,
    text: "闪电猫原话：批准 A，继续 debug。"
  });
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.buttonId, selected.buttonId);
  assert.equal(resumed.humanGateId, request.humanGateId);
  const approvedRecord = sqliteJson(dbFile, `
SELECT status, payload_json AS payloadJson, hash, path
FROM protocol_objects
WHERE object_id='${request.humanGateId}' AND object_type='human_gate_record'
LIMIT 1;`)[0];
  assert.equal(approvedRecord.status, "approved");
  assert.ok(approvedRecord.hash);
  assert.ok(approvedRecord.path.endsWith(`${request.humanGateId}.json`));
  assert.equal(JSON.parse(approvedRecord.payloadJson).payload.humanGateFeedback.flashcatOriginalWords, "闪电猫原话：批准 A，继续 debug。");

  const second = await runAction(root, {
    action: "human_gate.button_callback",
    callbackData: `tawhg:${request.buttons[1].callbackToken}`,
    feedbackText: "second should not win"
  });
  assert.equal(second.status, "superseded");
  const retryJobsBefore = sqliteCount(dbFile, "control_loop_jobs", "job_type='meeting_dispatch_retry'");
  const idempotent = await runAction(root, {
    action: "human_gate.resume",
    token: selected.callbackToken,
    text: "闪电猫原话：重复提交，不应新增副作用。"
  });
  assert.equal(idempotent.status, "selected");
  assert.equal(sqliteCount(dbFile, "control_loop_jobs", "job_type='meeting_dispatch_retry'"), retryJobsBefore);

  const replay = await requestHumanGate(root);
  assert.equal(replay.humanGateId, request.humanGateId);
  assert.equal(replay.status, "approved");
  assert.equal(replay.alreadySubmitted, true);
  assert.equal(replay.deliveryRequired, false);

  const counts = sqliteJson(path.join(root, "tracking.db"), `
SELECT status, COUNT(*) AS count
FROM human_gate_buttons
GROUP BY status
ORDER BY status;`);
  assert.deepEqual(counts, [
    { status: "selected", count: 1 },
    { status: "superseded", count: 5 }
  ]);

  const outboxBeforeDriftEnsure = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM telegram_outbox
WHERE outbox_id='${request.telegramOutbox.outboxId}'
LIMIT 1;`)[0];
  assert.equal(JSON.parse(outboxBeforeDriftEnsure.payloadJson).buttons.length, 6);
  sqliteExec(dbFile, `
UPDATE protocol_objects
SET status='pending'
WHERE object_id='${request.humanGateId}' AND object_type='human_gate_record';`);
  await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    deliverOutbox: false,
    createHumanGateInbox: false
  });
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${request.humanGateId}' AND status='active'`), 0);
  const outboxAfterDriftEnsure = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM telegram_outbox
WHERE outbox_id='${request.telegramOutbox.outboxId}'
LIMIT 1;`)[0];
  assert.equal(JSON.parse(outboxAfterDriftEnsure.payloadJson).buttons.length, 6);
}

async function testHumanGateIncidentCloseoutApprovalResolvesIncidents() {
  const negativeRoot = await tempRoot("hgate-incident-closeout-negative");
  await runAction(negativeRoot, { action: "workflow.init" });
  const negativeDbFile = path.join(negativeRoot, "tracking.db");
  sqliteExec(negativeDbFile, `
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-closeout-negative', 'active', 'degraded', '["workflow"]', 'negative', 'main', 'must stay open', 'not an incident closeout gate', 'none', 'none', 'not covered', '[]', '{"workflowId":"workflow-closeout-negative"}', '2026-06-12T00:00:00.000Z', '', '', '2026-06-12T00:00:01.000Z');
`);
  const negativeArtifactRel = "bridge/incident-closeout/incident-closeout-negative.json";
  await fs.mkdir(path.join(negativeRoot, "bridge/incident-closeout"), { recursive: true });
  await fs.writeFile(path.join(negativeRoot, negativeArtifactRel), JSON.stringify({
    schemaVersion: "workflow_incident_closeout_artifact.v1",
    workflowId: "workflow-closeout-negative",
    incidentId: "incident-closeout-negative",
    packageKind: "human_gate_package",
    closeout: { incidents: [{ incidentId: "incident-closeout-negative" }] }
  }, null, 2));
  const negativeRequest = await requestHumanGate(negativeRoot, {
    workflowId: "workflow-closeout-negative",
    meetingId: "workflow-closeout-negative",
    gateType: "workflow_continuation",
    stageKey: "not-incident-closeout",
    text: "猫爪正式汇报：普通 workflow continuation 回归测试，不应关闭 incident。",
    buttons: [{
      optionId: "A",
      optionKey: "A",
      title: "批准普通继续",
      summary: "这是普通继续方案，即使带 artifact 也不能关闭 incident。",
      prompt: "继续普通 workflow，不执行 incident closeout。",
      rollback: "保持 incident active。",
      artifactRef: negativeArtifactRel,
      payload: { optionId: "A", optionKey: "A", artifactRef: negativeArtifactRel }
    }, ...planButtons().slice(1)]
  });
  const negativeApproved = negativeRequest.buttons.find((button) => button.payload?.optionId === "A" || button.payload?.payload?.optionId === "A") || negativeRequest.buttons[0];
  const negativeResumed = await runAction(negativeRoot, {
    action: "human_gate.resume",
    token: negativeApproved.callbackToken,
    text: "闪电猫原话：批准普通继续。"
  });
  assert.equal(negativeResumed.workflowDecision.closeoutResolution, null);
  assert.equal(sqliteJson(negativeDbFile, "SELECT status FROM incident_states WHERE incident_id='incident-closeout-negative';")[0].status, "active");

  const root = await tempRoot("hgate-incident-closeout-approval");
  await runAction(root, { action: "workflow.init" });
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "workflow-incident-closeout-approval";
  sqliteExec(dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES ('${workflowId}', 'regression', 'waiting_human', 'main', 'incident closeout approval regression', 'Human Gate option A resolves scoped closeout incidents', 'artifact-scoped incidents are resolved only after approval', 'manual stop', 'human_gate', 'submit_human_gate', '{}', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:01.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES
  ('incident-closeout-a', 'active', 'degraded', '["workflow"]', 'closeout A', 'main', 'covered by closeout artifact', 'ready to close', 'none', 'reopen if recurrence', 'Human Gate approves closeout', '["opened A"]', '{"workflowId":"${workflowId}","closeoutEvidence":{"workflowId":"${workflowId}","incidentId":"incident-closeout-a"}}', '2026-06-12T00:00:00.000Z', '', '', '2026-06-12T00:00:01.000Z'),
  ('incident-closeout-b', 'monitoring', 'degraded', '["runtime"]', 'closeout B', 'main', 'covered by closeout artifact', 'ready to close', 'none', 'reopen if recurrence', 'Human Gate approves closeout', '["opened B"]', '{"workflowId":"${workflowId}","closeoutEvidence":{"workflowId":"${workflowId}","incidentId":"incident-closeout-b"}}', '2026-06-12T00:00:00.000Z', '', '', '2026-06-12T00:00:02.000Z'),
  ('incident-closeout-decoy', 'active', 'degraded', '["workflow"]', 'decoy', 'main', 'not in artifact', 'must stay open', 'none', 'none', 'not covered', '[]', '{"workflowId":"${workflowId}"}', '2026-06-12T00:00:00.000Z', '', '', '2026-06-12T00:00:03.000Z');
`);
  const artifactRel = "bridge/incident-closeout/incident-closeout-approval-regression.json";
  await fs.mkdir(path.join(root, "bridge/incident-closeout"), { recursive: true });
  await fs.writeFile(path.join(root, artifactRel), JSON.stringify({
    schemaVersion: "workflow_incident_closeout_artifact.v1",
    artifactId: "incident-closeout-approval-regression",
    workflowId,
    incidentId: "incident-closeout-a",
    packageKind: "human_gate_package",
    writeBoundary: "closeout_artifact_only",
    closeout: {
      counts: { incidents: 2 },
      selectedIncident: { incidentId: "incident-closeout-a", status: "active" },
      incidents: [
        { incidentId: "incident-closeout-a", status: "active", mode: "degraded" },
        { incidentId: "incident-closeout-b", status: "monitoring", mode: "degraded" }
      ]
    },
    reportDraft: {
      summaryZh: "猫爪正式汇报：incident closeout 回归测试。请选择 A/B/C。",
      humanGateOptions: []
    }
  }, null, 2));
  const closeoutButtons = [
    {
      optionId: "A",
      optionKey: "A",
      title: "批准收口并归档",
      summary: "确认 artifact 中列出的 incident 已满足收口条件，批准归档。",
      prompt: "批准方案 A 后，仅关闭 closeout artifact 范围内的 incident。",
      rollback: "如果证据无效，重新打开 incident 并恢复 active 状态。",
      artifactRef: artifactRel,
      payload: { optionId: "A", optionKey: "A", artifactRef: artifactRel }
    },
    {
      optionId: "B",
      optionKey: "B",
      title: "退回补证后再提交",
      summary: "暂不关闭 incident，要求补齐证据后重新提交。",
      prompt: "保持 incident open，由猫之脑补证。",
      rollback: "补证失败时继续保持 active。",
      artifactRef: artifactRel,
      payload: { optionId: "B", optionKey: "B", artifactRef: artifactRel }
    },
    {
      optionId: "C",
      optionKey: "C",
      title: "继续监控不关闭",
      summary: "保持 incident monitoring，不进行 resolved 写入。",
      prompt: "继续观察下一轮 readiness 和 runtime 证据。",
      rollback: "如果出现复发，升级 incident。",
      artifactRef: artifactRel,
      payload: { optionId: "C", optionKey: "C", artifactRef: artifactRel }
    }
  ];
  const request = await requestHumanGate(root, {
    workflowId,
    meetingId: workflowId,
    gateType: "incident_closeout",
    stageKey: "incident-closeout:incident-closeout-a",
    text: "猫爪正式汇报：incident closeout 回归测试。请选择 A/B/C 方案并填写闪电猫原话。",
    buttons: closeoutButtons,
    payload: {
      closeoutArtifactRef: artifactRel,
      closeoutPackageKind: "human_gate_package",
      closeoutIncidentId: "incident-closeout-a"
    }
  });
  const approved = request.buttons.find((button) => button.payload?.optionId === "A" || button.payload?.payload?.optionId === "A") || request.buttons[0];
  const resumed = await runAction(root, {
    action: "human_gate.resume",
    token: approved.callbackToken,
    text: "闪电猫原话：同意收口。"
  });
  assert.equal(resumed.status, "approved");
  assert.equal(resumed.workflowDecision.closeoutResolution.applied, true);
  assert.equal(resumed.workflowDecision.closeoutResolution.resolvedIncidentCount, 2);

  const incidents = sqliteJson(dbFile, `
SELECT incident_id AS incidentId, status, mode, payload_json AS payloadJson
FROM incident_states
ORDER BY incident_id;`);
  assert.deepEqual(incidents.map((row) => [row.incidentId, row.status, row.mode]), [
    ["incident-closeout-a", "resolved", "normal"],
    ["incident-closeout-b", "resolved", "normal"],
    ["incident-closeout-decoy", "active", "degraded"]
  ]);
  const resolution = JSON.parse(incidents[0].payloadJson).closeoutResolution;
  assert.equal(resolution.humanGateId, request.humanGateId);
  assert.equal(resolution.buttonId, approved.buttonId);
  assert.equal(resolution.flashcatOriginalWords, "闪电猫原话：同意收口。");
  assert.equal(sqliteCount(dbFile, "workflow_events", "event_type='incident.closeout_approved'"), 1);
  const closeoutEvent = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM workflow_events
WHERE event_type='incident.closeout_approved'
LIMIT 1;`)[0];
  const closeoutEventPayload = JSON.parse(closeoutEvent.payloadJson);
  assert.equal(closeoutEventPayload.flashcatOriginalWords, "闪电猫原话：同意收口。");
  assert.ok(closeoutEventPayload.feedbackReceivedAt);
}

async function testHumanGateReadinessChecklist() {
  const root = await tempRoot("hgate-readiness");
  const request = await requestHumanGate(root);
  assert.equal(request.status, "pending");
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT OR REPLACE INTO workflow_runs(workflow_id, workflow_type, status, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES ('workflow-regression', 'regression', 'waiting_human', 'main', 'Human Gate readiness regression', '验证 Human Gate readiness checklist。', 'A/B/C、暂停、终止、证据和回执完整。', '人工停止', 'review', 'submit_human_gate', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
UPDATE protocol_objects
SET source_agent='cat_claw'
WHERE object_type='human_gate_record' AND json_extract(payload_json, '$.workflowId')='workflow-regression';
UPDATE human_gate_buttons
SET created_by='cat_claw'
WHERE workflow_id='workflow-regression';
UPDATE human_gate_buttons
SET summary=summary || ' tawhg:summary-secret-token token=summary-secret',
    prompt=prompt || ' tawhg:prompt-secret-token token=prompt-secret'
WHERE workflow_id='workflow-regression';
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES ('checkpoint-hgate-readiness', 'workflow-regression', 'ready', 'review', 'submit_human_gate', '猫爪提交 Human Gate 前 checkpoint。', '{}', '[]', '[]', '["artifact-hgate-readiness"]', '["提交猫爪复核"]', '{}', 'artifact://checkpoint-hgate-readiness', 'main', '2026-05-31T00:00:02.000Z');
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES ('artifact-hgate-readiness', 'workflow-regression', 'human_gate_evidence', 'artifact://hgate-readiness', 'Human Gate 证据包。', 'main', '2026-05-31T00:00:03.000Z');
INSERT INTO workflow_agent_runs(agent_run_id, workflow_id, phase_key, task_id, dispatch_id, runtime, agent_id, status, output_hash, receipt_ref, payload_json, created_at, updated_at)
VALUES ('agent-hgate-readiness', 'workflow-regression', 'review', 'task-hgate-readiness', 'dispatch-hgate-readiness', 'openclaw', 'cat_claw', 'completed', 'hash-hgate-readiness', 'artifact://receipt-hgate-readiness', '{}', '2026-05-31T00:00:04.000Z', '2026-05-31T00:00:05.000Z');
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES ('outbox-hgate-readiness', 'workflow-regression', 'telegram', '8390724843', 'human_gate_request', 'sent', '猫爪正式汇报：请选择 A/B/C。 /hgate tawhg:readiness-secret', '{}', '2026-05-31T00:00:06.000Z', '2026-05-31T00:00:07.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('noise-hgate-readiness', 'human_gate_record', 'pending', NULL, 'regression', 'cat_claw', '', 'artifact://noise', '{"workflowId":"workflow-regression-extra"}', 'hash-noise', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('legacy-workflow-id-hgate', 'human_gate_record', 'pending', NULL, 'regression', 'cat_claw', '', 'artifact://legacy-workflow-id', '{"workflow":{"id":"workflow-json-id"}}', 'hash-workflow-id', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('legacy-workflow-id-receipt', 'evidence_pack', 'ready', NULL, 'regression', 'cat_claw', '', 'artifact://legacy-workflow-id-receipt', '{"workflow":{"id":"workflow-json-id"}}', 'hash-workflow-id-receipt', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('legacy-workflow-id-noise', 'evidence_pack', 'ready', NULL, 'regression', 'cat_claw', '', 'artifact://legacy-workflow-id-noise', '{"workflow":{"id":"workflow-json-id-extra"}}', 'hash-workflow-id-noise', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO human_gate_buttons(button_id, human_gate_id, callback_token, workflow_id, meeting_id, label, decision_status, button_role, artifact_ref, summary, prompt, payload_json, status, created_by, created_at, updated_at)
VALUES
  ('classifier-plan-a', 'classifier-hgate', 'classifier-token-a', 'workflow-classifier', 'workflow-classifier', 'Plan A', 'approved', 'option', '', '中文方案 A。', '执行 Plan A。', '{}', 'pending', 'cat_claw', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z'),
  ('classifier-alternative-b', 'classifier-hgate', 'classifier-token-b', 'workflow-classifier', 'workflow-classifier', 'Alternative B', 'approved', 'option', '', '中文方案 B。', '执行 Alternative B。', '{}', 'pending', 'cat_claw', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z'),
  ('classifier-cn-one', 'classifier-hgate', 'classifier-token-c', 'workflow-classifier', 'workflow-classifier', '方案一', 'approved', 'option', '', '中文方案一。', '执行方案一。', '{}', 'pending', 'cat_claw', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z'),
  ('classifier-pause', 'classifier-hgate', 'classifier-token-p', 'workflow-classifier', 'workflow-classifier', '暂停工作流', 'paused', 'pause', '', '暂停。', '暂停。', '{}', 'pending', 'cat_claw', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z'),
  ('classifier-terminate', 'classifier-hgate', 'classifier-token-t', 'workflow-classifier', 'workflow-classifier', '终止工作流', 'terminated', 'terminate', '', '终止。', '终止。', '{}', 'pending', 'cat_claw', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');`);

  const readiness = await new WorkflowReadModel({ dbFile }).humanGateReadiness("workflow-regression");
  assert.equal(readiness.schemaVersion, "human_gate_readiness.v1");
  assert.equal(readiness.readyForCatClawAudit, true);
  assert.equal(readiness.readyForHumanGateSubmission, true);
  assert.equal(readiness.summary.approveOptionCount, 3);
  assert.equal(readiness.summary.recordCount, 1);
  assert.equal(readiness.refs.sentOutboxIds.includes("outbox-hgate-readiness"), true);
  assert.equal(readiness.checklist.find((item) => item.key === "three_approve_options")?.status, "pass");
  assert.equal(readiness.checklist.find((item) => item.key === "pause_control")?.status, "pass");
  assert.equal(readiness.checklist.find((item) => item.key === "terminate_control")?.status, "pass");
  assert.equal(readiness.checklist.find((item) => item.key === "checkpoint_available")?.status, "pass");
  assert.equal(readiness.checklist.find((item) => item.key === "evidence_artifacts")?.status, "pass");
  assert.equal(JSON.stringify(readiness).includes("readiness-secret"), false);
  assert.equal(JSON.stringify(readiness).includes("summary-secret"), false);
  assert.equal(JSON.stringify(readiness).includes("prompt-secret"), false);

  const routeReadiness = await workflowChildPayload(new WorkflowReadModel({ dbFile }), "workflow-regression", "human-gate-readiness");
  assert.equal(routeReadiness.schemaVersion, "human_gate_readiness.v1");
  assert.equal(routeReadiness.summary.recordCount, 1);
  const legacyJsonGate = await new WorkflowReadModel({ dbFile }).humanGates("workflow-json-id");
  assert.equal(legacyJsonGate.records.length, 1);
  const legacyJsonReceipts = await new WorkflowReadModel({ dbFile }).receipts("workflow-json-id");
  assert.equal(Boolean(legacyJsonReceipts.receipts.some((receipt) => receipt.receiptId === "legacy-workflow-id-receipt")), true);
  assert.equal(Boolean(legacyJsonReceipts.receipts.some((receipt) => receipt.receiptId === "legacy-workflow-id-noise")), false);
  const legacyJsonPack = await new WorkflowReadModel({ dbFile }).evidencePack("workflow-json-id", { limit: 50 });
  assert.equal(Boolean(legacyJsonPack.receipts.receipts.some((receipt) => receipt.receiptId === "legacy-workflow-id-receipt")), true);
  assert.equal(Boolean(legacyJsonPack.receipts.receipts.some((receipt) => receipt.receiptId === "legacy-workflow-id-noise")), false);
  const classifierReadiness = await new WorkflowReadModel({ dbFile }).humanGateReadiness("workflow-classifier");
  assert.equal(classifierReadiness.summary.approveOptionCount, 3);
  assert.equal(classifierReadiness.checklist.find((item) => item.key === "pause_control")?.status, "pass");
  assert.equal(classifierReadiness.checklist.find((item) => item.key === "terminate_control")?.status, "pass");
  const evidencePack = await new WorkflowReadModel({ dbFile }).evidencePack("workflow-regression", { limit: 50 });
  assert.equal(JSON.stringify(evidencePack).includes("summary-secret"), false);
  assert.equal(JSON.stringify(evidencePack).includes("prompt-secret"), false);
}

async function testHumanGateReadinessLegacySchemaFallback() {
  const root = await tempRoot("hgate-readiness-legacy");
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
CREATE TABLE legacy_marker (
  id TEXT PRIMARY KEY
);
INSERT INTO legacy_marker(id) VALUES ('legacy-only');`);

  const readiness = await new WorkflowReadModel({ dbFile }).humanGateReadiness("workflow-legacy-readiness");
  assert.equal(readiness.schemaVersion, "human_gate_readiness.v1");
  assert.equal(readiness.status, "not_ready");
  assert.equal(readiness.readyForCatClawAudit, false);
  assert.equal(readiness.summary.recordCount, 0);
  assert.equal(readiness.summary.buttonCount, 0);
  assert.equal(readiness.summary.checkpointCount, 0);
  assert.equal(readiness.summary.artifactCount, 0);
  assert.equal(readiness.summary.receiptPresentCount, 0);
  assert.equal(readiness.checklist.find((item) => item.key === "human_gate_record")?.status, "fail");
  assert.equal(readiness.checklist.find((item) => item.key === "telegram_delivery_observed")?.status, "warn");

  const routeReadiness = await workflowChildPayload(new WorkflowReadModel({ dbFile }), "workflow-legacy-readiness", "human-gate-readiness");
  assert.equal(routeReadiness.schemaVersion, "human_gate_readiness.v1");
  assert.equal(routeReadiness.status, "not_ready");

  const evidencePack = await new WorkflowReadModel({ dbFile }).evidencePack("workflow-legacy-readiness", { limit: 20 });
  assert.equal(evidencePack.schemaVersion, "workflow_evidence_pack.v1");
  assert.equal(evidencePack.found, false);
  assert.equal(evidencePack.manifest.taskCount, 0);
  assert.equal(evidencePack.manifest.humanGateRecordCount, 0);
}

async function testWorkflowOperationsConsoleAudit() {
  const root = await tempRoot("workflow-operations");
  const dbFile = path.join(root, "tracking.db");
  const bridgeDir = path.join(root, "bridge");
  const workflowId = "wf-console-operations";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    summary: "Console operation audit regression"
  });
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId: "wf-console-operations-other",
    status: "active",
    summary: "Other workflow operation audit regression"
  });

  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { readOnly: true });
  const preview = await gateway.handle({
    action: "workflow.supervise.preview",
    actor: "flashcat",
    reason: "检查 workflow.supervise.preview token=reason-secret token reasonSpaceSecret token zzz Bearer bearer.secret.token tawhg:reason-secret-token",
    payload: {
      workflowId,
      idempotencyKey: "op-idempotency-key",
      humanGateId: "hgate-console-op",
      note: "payload token payloadSpaceSecret callback qqq Bearer payload.bearer.secret"
    }
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.dryRun, true);
  const other = await gateway.handle({
    action: "workflow.supervise.preview",
    actor: "flashcat",
    reason: "other workflow",
    payload: { workflowId: "wf-console-operations-other" }
  });
  assert.equal(other.ok, true);

  const rejected = await gateway.handle({
    action: "workflow.pause",
    actor: "flashcat",
    reason: "should be rejected token=rejected-secret",
    payload: { workflowId }
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errorCode, "action_not_allowed");

  const rows = sqliteJson(dbFile, `
SELECT operation_id AS operationId, action, scope_type AS scopeType, scope_id AS scopeId,
  workflow_id AS workflowId, requested_by AS requestedBy, reason, risk_tier AS riskTier,
  status, dry_run AS dryRun, idempotency_key AS idempotencyKey, human_gate_id AS humanGateId,
  preview_result_json AS previewResultJson, result_json AS resultJson, error
FROM workflow_operations
ORDER BY created_at ASC;`);
  assert.equal(rows.length, 3);
  const previewRow = rows.find((row) => row.operationId === preview.operationId);
  assert.ok(previewRow);
  assert.equal(previewRow.action, "workflow.supervise.preview");
  assert.equal(previewRow.scopeType, "workflow");
  assert.equal(previewRow.scopeId, workflowId);
  assert.equal(previewRow.workflowId, workflowId);
  assert.equal(previewRow.requestedBy, "flashcat");
  assert.equal(previewRow.status, "completed");
  assert.equal(previewRow.dryRun, 1);
  assert.equal(previewRow.idempotencyKey, "op-idempotency-key");
  assert.equal(previewRow.humanGateId, "hgate-console-op");
  assert.equal(previewRow.reason.includes("reason-secret"), false);
  assert.equal(previewRow.reason.includes("reasonSpaceSecret"), false);
  assert.equal(previewRow.reason.includes("zzz"), false);
  assert.equal(previewRow.reason.includes("bearer.secret.token"), false);
  assert.notEqual(previewRow.previewResultJson, "{}");
  assert.equal(previewRow.previewResultJson.includes("payloadSpaceSecret"), false);
  assert.equal(previewRow.previewResultJson.includes("qqq"), false);
  assert.equal(previewRow.previewResultJson.includes("payload.bearer.secret"), false);
  assert.equal(previewRow.resultJson, "{}");
  const rejectedRow = rows.find((row) => row.operationId === rejected.operationId);
  assert.ok(rejectedRow);
  assert.equal(rejectedRow.action, "workflow.pause");
  assert.equal(rejectedRow.status, "rejected");
  assert.equal(rejectedRow.reason.includes("rejected-secret"), false);
  assert.match(rejectedRow.error, /not allowed/);

  sqliteExec(dbFile, `
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at)
VALUES
  ('job-dead-failed', 'runtime_drain', 'runtime_drain:hermes:dispatch-dead', 'high', 'failed', '${workflowId}', 'hermes', '{"dispatchId":"dispatch-dead"}', '{}', 3, 3, '2026-05-31T00:00:00.000Z', '', '', 'token job-secret', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', ''),
  ('job-dead-expired-lease', 'message_flow_reconcile', 'message_flow_reconcile', 'normal', 'running', '${workflowId}', '', '{}', '{}', 1, 20, '2026-05-31T00:00:00.000Z', 'worker-1', '2000-01-01T00:00:00.000Z', 'lease token lease-secret', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:02.000Z', ''),
  ('job-related-exact-dispatch', 'runtime_drain', 'runtime_drain:hermes:unrelated', 'normal', 'completed', '${workflowId}', 'hermes', '{"dispatchId":"dispatch-max-attempts"}', '{}', 1, 3, '', '', '', '', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:03.000Z', '2026-05-31T00:00:04.000Z'),
  ('job-related-fuzzy-dedupe', 'runtime_drain', 'runtime_drain:hermes:dispatch-max-attempts-extra', 'normal', 'completed', '${workflowId}', 'hermes', '{}', '{}', 1, 3, '', '', '', '', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:04.000Z', '2026-05-31T00:00:05.000Z');
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES
  ('dispatch-max-attempts', '${workflowId}', '${workflowId}', 'trace-max-attempts', 'idem-max-attempts', 'hermes', 'cat_body', 'hermes:cat_body', 'workflow_task', 'sent', 'normal', 3, 3, '', 'timeout', 'dispatch token dispatch-secret', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2026-05-31T00:00:03.000Z'),
  ('dispatch-failed-not-max', '${workflowId}', '${workflowId}', 'trace-failed-not-max', 'idem-failed-not-max', 'hermes', 'cat_body', 'hermes:cat_body', 'workflow_task', 'failed', 'normal', 1, 3, '', 'permission_unavailable', 'failed dispatch before max token dispatch-secret', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '', '', '', '2026-05-31T00:00:07.000Z'),
  ('dispatch-max-attempts-failed', '${workflowId}', '${workflowId}', 'trace-max-attempts-failed', 'idem-max-attempts-failed', 'hermes', 'cat_body', 'hermes:cat_body', 'workflow_task', 'failed', 'normal', 3, 3, '', 'timeout', 'terminal failed dispatch token dispatch-secret', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '', '', '', '2026-05-31T00:00:08.000Z'),
  ('dispatch-max-attempts-dead-letter', '${workflowId}', '${workflowId}', 'trace-max-attempts-dead-letter', 'idem-max-attempts-dead-letter', 'hermes', 'cat_body', 'hermes:cat_body', 'workflow_task', 'dead_letter', 'normal', 3, 3, '', 'timeout', 'terminal dead-letter dispatch token dispatch-secret', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '', '', '', '2026-05-31T00:00:09.000Z');
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES ('runtime-dead-letter-evidence', 'dispatch-max-attempts', '${workflowId}', '${workflowId}', 'trace-runtime-evidence', 'hermes', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'timeout', 3, '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:02.000Z', 1000, '', '', '', 'runtime token runtime-secret', '{}');
INSERT INTO human_gate_buttons(button_id, human_gate_id, callback_token, workflow_id, meeting_id, label, decision_status, button_role, artifact_ref, summary, prompt, payload_json, status, created_by, created_at, updated_at)
VALUES ('button-stuck-feedback', 'hgate-stuck-feedback', 'callback-stuck-feedback', '${workflowId}', '${workflowId}', '方案 A', 'approved', 'option', '', 'summary', 'prompt', '{}', 'feedback_pending', 'cat_claw', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
INSERT INTO side_effect_ledger(side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, input_hash, output_hash, artifact_ref, payload_json, created_at, updated_at)
VALUES ('side-effect-uncertain-op', 'trace-side-effect', '${workflowId}', 'dispatch-max-attempts', 'idem-side-effect', 'cat_body', 'telegram_delivery', 'uncertain', '', '', 'artifact://token side-secret', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:04.000Z');
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, outbox_id, target_runtime, target_agent_id, return_policy, status, runtime_completed_at, runtime_failed_at, final_output_present, delivery_receipt_present, last_error, created_at, updated_at)
VALUES
  ('flow-dead-delivery-completed', 'trace-flow-dead-completed', 'idem-flow-dead-completed', '${workflowId}', '${workflowId}', 'dispatch-max-attempts', 'outbox-flow-dead-completed', 'openclaw', 'cat_claw', 'report_to_flashcat', 'runtime_completed', '2000-01-01T00:00:00.000Z', '', 1, 0, 'message_flow token flow-secret-completed', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:01.000Z'),
  ('flow-dead-delivery-runtime-failed', 'trace-flow-dead-failed', 'idem-flow-dead-failed', '${workflowId}', '${workflowId}', 'dispatch-max-attempts', 'outbox-flow-dead-failed', 'openclaw', 'cat_claw', 'report_to_flashcat', 'runtime_failed', '', '2000-01-01T00:00:00.000Z', 0, 0, 'message_flow token flow-secret-failed', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:02.000Z'),
  ('flow-dead-delivery-telegram-failed', 'trace-flow-telegram-failed', 'idem-flow-telegram-failed', '${workflowId}', '${workflowId}', 'dispatch-max-attempts', 'outbox-flow-telegram-failed', 'openclaw', 'cat_claw', 'report_to_flashcat', 'telegram_failed', '', '', 1, 0, 'message_flow token flow-secret-telegram', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:03.000Z'),
  ('flow-silent-delivery', 'trace-flow-silent', 'idem-flow-silent', '${workflowId}', '${workflowId}', 'dispatch-max-attempts', 'outbox-flow-silent', 'openclaw', 'cat_claw', 'silent', 'runtime_completed', '2000-01-01T00:00:00.000Z', '', 1, 0, 'message_flow token flow-secret-silent', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:04.000Z'),
  ('flow-local-codex-delivery', 'trace-flow-local', 'idem-flow-local', '${workflowId}', '${workflowId}', 'dispatch-max-attempts', 'outbox-flow-local', 'local_codex', 'codex', 'report_to_flashcat', 'runtime_completed', '2000-01-01T00:00:00.000Z', '', 1, 0, 'message_flow token flow-secret-local', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:05.000Z'),
  ('flow-receipt-present', 'trace-flow-receipt', 'idem-flow-receipt', '${workflowId}', '${workflowId}', 'dispatch-max-attempts', 'outbox-flow-receipt', 'openclaw', 'cat_claw', 'report_to_flashcat', 'telegram_sent', '2000-01-01T00:00:00.000Z', '', 1, 1, 'message_flow token flow-secret-receipt', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:06.000Z'),
  ('flow-recent-delivery', 'trace-flow-recent', 'idem-flow-recent', '${workflowId}', '${workflowId}', 'dispatch-max-attempts', 'outbox-flow-recent', 'openclaw', 'cat_claw', 'report_to_flashcat', 'runtime_completed', '2999-01-01T00:00:00.000Z', '', 1, 0, 'message_flow token flow-secret-recent', '2026-05-31T00:00:00.000Z', '2999-01-01T00:00:00.000Z'),
  ('flow-other-workflow-dead', 'trace-flow-other', 'idem-flow-other', 'wf-console-operations-other', 'wf-console-operations-other', 'dispatch-max-attempts', 'outbox-flow-other', 'openclaw', 'cat_claw', 'report_to_flashcat', 'runtime_completed', '2000-01-01T00:00:00.000Z', '', 1, 0, 'message_flow token flow-secret-other', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:07.000Z');
INSERT INTO message_flow_events(event_id, flow_id, status, event_type, payload_json, created_at)
VALUES ('event-flow-dead-delivery', 'flow-dead-delivery-completed', 'runtime_completed', 'runtime_output', '{"token":"event-secret"}', '2026-05-31T00:00:03.000Z');
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES ('outbox-flow-dead-completed', '${workflowId}', 'telegram', '8390724843', 'message_flow_reply', 'queued', 'outbox token outbox-secret tawhg:outbox-secret-token', '{}', '2026-05-31T00:00:04.000Z', '2026-05-31T00:00:05.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('malformed-json-human-gate', 'human_gate_record', 'pending', NULL, 'regression', 'cat_claw', '', 'artifact://malformed-json-human-gate', '{not-json', 'hash-malformed-json-human-gate', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at)
VALUES ('job-other-workflow-failed', 'runtime_drain', 'runtime_drain:other', 'high', 'failed', 'wf-console-operations-other', 'hermes', '{}', '{}', 3, 3, '', '', '', 'other', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '');`);

  const jsonl = await fs.readFile(path.join(bridgeDir, "console-operations.jsonl"), "utf8");
  assert.equal(jsonl.includes("reason-secret"), false);
  assert.equal(jsonl.includes("reasonSpaceSecret"), false);
  assert.equal(jsonl.includes("zzz"), false);
  assert.equal(jsonl.includes("bearer.secret.token"), false);
  assert.equal(jsonl.includes("payloadSpaceSecret"), false);
  assert.equal(jsonl.includes("qqq"), false);
  assert.equal(jsonl.includes("payload.bearer.secret"), false);
  assert.equal(jsonl.includes("rejected-secret"), false);
  assert.equal(jsonl.includes("tawhg:reason-secret-token"), false);
  const operations = await new WorkflowReadModel({ dbFile }).operationsSummary({ workflowId });
  assert.equal(Boolean(operations.workflowOperations.some((row) => row.operationId === preview.operationId && row.status === "completed")), true);
  assert.equal(Boolean(operations.workflowOperations.some((row) => row.operationId === rejected.operationId && row.status === "rejected")), true);
  assert.equal(Boolean(operations.workflowOperations.some((row) => row.operationId === other.operationId)), false);
  assert.equal(Boolean(operations.workflowOperationSummary.some((row) => row.action === "workflow.supervise.preview" && row.dryRun && row.count === 1)), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "control_loop_job" && row.refId === "job-dead-failed")), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "expired_lease" && row.refId === "job-dead-expired-lease")), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "failed_dispatch" && row.refId === "dispatch-failed-not-max")), true);
  assert.equal(operations.deadLetters.find((row) => row.refId === "dispatch-failed-not-max")?.severity, "warning");
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "max_attempt_dispatch" && row.refId === "dispatch-max-attempts")), true);
  assert.equal(operations.deadLetters.find((row) => row.refId === "dispatch-max-attempts")?.severity, "critical");
  assert.equal(operations.deadLetters.find((row) => row.refId === "dispatch-max-attempts-failed")?.severity, "warning");
  assert.equal(operations.deadLetters.find((row) => row.refId === "dispatch-max-attempts-dead-letter")?.severity, "warning");
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "human_gate_feedback" && row.refId === "button-stuck-feedback")), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "side_effect_uncertain" && row.refId === "side-effect-uncertain-op")), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "message_flow_delivery_missing" && row.refId === "flow-dead-delivery-completed")), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "message_flow_delivery_missing" && row.refId === "flow-dead-delivery-runtime-failed")), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.kind === "message_flow_delivery_missing" && row.refId === "flow-dead-delivery-telegram-failed")), true);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.refId === "flow-silent-delivery")), false);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.refId === "flow-local-codex-delivery")), false);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.refId === "flow-receipt-present")), false);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.refId === "flow-recent-delivery")), false);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.refId === "flow-other-workflow-dead")), false);
  assert.equal(Boolean(operations.deadLetters.some((row) => row.refId === "job-other-workflow-failed")), false);
  assert.equal(operations.humanGate.reduce((total, row) => total + Number(row.count || 0), 0), 0);
  assert.equal(JSON.stringify(operations.deadLetters).includes("job-secret"), false);
  assert.equal(JSON.stringify(operations.deadLetters).includes("dispatch-secret"), false);
  assert.equal(JSON.stringify(operations.deadLetters).includes("side-secret"), false);
  assert.equal(JSON.stringify(operations.deadLetters).includes("flow-secret"), false);
  const readOnlyEvidenceCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states")
  };
  const deadLetterEvidence = await new WorkflowReadModel({ dbFile }).deadLetterEvidence({
    workflowId,
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed"
  });
  assert.equal(deadLetterEvidence.schemaVersion, "workflow_dead_letter_evidence.v1");
  assert.equal(deadLetterEvidence.writeMode, "read_only_derived_export");
  assert.equal(deadLetterEvidence.found, true);
  assert.equal(deadLetterEvidence.primary.messageFlows[0].flow_id, "flow-dead-delivery-completed");
  assert.equal(deadLetterEvidence.manifest.relatedDispatchCount, 1);
  assert.equal(deadLetterEvidence.manifest.relatedRuntimeRunCount, 1);
  assert.equal(deadLetterEvidence.manifest.relatedMessageFlowEventCount, 1);
  assert.equal(deadLetterEvidence.manifest.relatedOutboxCount, 1);
  assert.equal(deadLetterEvidence.manifest.relatedControlLoopJobCount, 1);
  assert.equal(deadLetterEvidence.related.controlLoopJobs[0].job_id, "job-related-exact-dispatch");
  assert.equal(deadLetterEvidence.incidentCandidate.schemaVersion, "workflow_incident_candidate.v1");
  assert.equal(deadLetterEvidence.incidentCandidate.writeMode, "read_only_preview");
  assert.equal(deadLetterEvidence.incidentCandidate.workflowId, workflowId);
  assert.equal(deadLetterEvidence.incidentCandidate.kind, "message_flow_delivery_missing");
  assert.equal(deadLetterEvidence.incidentCandidate.refId, "flow-dead-delivery-completed");
  assert.equal(deadLetterEvidence.incidentCandidate.recommended, true);
  assert.equal(deadLetterEvidence.incidentCandidate.suggestedMode, "monitoring");
  assert.equal(deadLetterEvidence.incidentCandidate.affectedPlanes.includes("message_flow"), true);
  assert.equal(deadLetterEvidence.incidentCandidate.affectedPlanes.includes("delivery"), true);
  assert.equal(Boolean(deadLetterEvidence.incidentCandidate.evidenceRefs.some((row) => row.id === "flow-dead-delivery-completed")), true);
  assert.equal(Boolean(deadLetterEvidence.incidentCandidate.evidenceRefs.some((row) => row.id === "dispatch-max-attempts")), true);
  assert.equal(Boolean(deadLetterEvidence.incidentCandidate.evidenceRefs.some((row) => row.id === "outbox-flow-dead-completed")), true);
  assert.equal(JSON.stringify(deadLetterEvidence).includes("flow-secret"), false);
  assert.equal(JSON.stringify(deadLetterEvidence).includes("event-secret"), false);
  assert.equal(JSON.stringify(deadLetterEvidence).includes("outbox-secret"), false);
  assert.equal(JSON.stringify(deadLetterEvidence).includes("runtime-secret"), false);
  assert.equal(JSON.stringify(deadLetterEvidence).includes("job-related-fuzzy-dedupe"), false);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states")
  }, readOnlyEvidenceCountsBefore);
  const wrongScopeEvidence = await new WorkflowReadModel({ dbFile }).deadLetterEvidence({
    workflowId: "wf-console-operations-other",
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed"
  });
  assert.equal(wrongScopeEvidence.found, false);
  const notDeadLetterEvidence = await new WorkflowReadModel({ dbFile }).deadLetterEvidence({
    workflowId,
    kind: "message_flow_delivery_missing",
    refId: "flow-receipt-present"
  });
  assert.equal(notDeadLetterEvidence.found, false);
  assert.equal(notDeadLetterEvidence.status, "not_found");
  assert.equal(notDeadLetterEvidence.incidentCandidate, null);
  const invalidDeadLetterEvidence = await new WorkflowReadModel({ dbFile }).deadLetterEvidence({});
  assert.equal(invalidDeadLetterEvidence.status, "invalid_request");
  const failedDispatchEvidence = await new WorkflowReadModel({ dbFile }).deadLetterEvidence({
    workflowId,
    kind: "failed_dispatch",
    refId: "dispatch-failed-not-max"
  });
  assert.equal(failedDispatchEvidence.found, true);
  assert.equal(failedDispatchEvidence.incidentCandidate.severity, "warning");
  assert.equal(failedDispatchEvidence.incidentCandidate.suggestedMode, "monitoring");
  const failedDispatchWrongKindEvidence = await new WorkflowReadModel({ dbFile }).deadLetterEvidence({
    workflowId,
    kind: "failed_dispatch",
    refId: "dispatch-max-attempts-failed"
  });
  assert.equal(failedDispatchWrongKindEvidence.found, false);
  const terminalDispatchEvidence = await new WorkflowReadModel({ dbFile }).deadLetterEvidence({
    workflowId,
    kind: "max_attempt_dispatch",
    refId: "dispatch-max-attempts-failed"
  });
  assert.equal(terminalDispatchEvidence.found, true);
  assert.equal(terminalDispatchEvidence.incidentCandidate.severity, "warning");
  assert.equal(terminalDispatchEvidence.incidentCandidate.suggestedMode, "monitoring");
  sqliteExec(dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('hg-dead-letter-link', 'human_gate_record', 'approved', NULL, 'regression', 'cat_claw', '', 'artifact://hg-dead-letter-link', '{"workflowId":"${workflowId}","summary":"Human Gate evidence for flow-dead-delivery-completed token=hg-option-secret"}', 'hash-hg-dead-letter-link', '2026-05-31T00:00:06.000Z', '2026-05-31T00:00:07.000Z');
INSERT INTO workflow_verification_results(verification_id, workflow_id, phase_id, phase_key, task_id, agent_run_id, dispatch_id, runtime_run_id, result_type, decision, verifier_agent, refuter_agent, source_runtime, source_agent, confidence, risk_band, summary, findings_json, recommendations_json, evidence_refs_json, artifact_refs_json, receipt_refs_json, payload_hash, payload_json, created_by, created_at)
VALUES ('audit-dead-letter-link', '${workflowId}', '', 'secretary_audit', '', '', 'dispatch-max-attempts', '', 'secretary_audit', 'pass', '', '', 'openclaw', 'cat_claw', 'high', 'P2', 'Cat Claw audit evidence token=audit-option-secret', '[]', '[]', '[]', '[]', '[]', 'hash-audit-dead-letter-link', '{}', 'cat_claw', '2026-05-31T00:00:08.000Z');`);
  const evidenceOptions = await new WorkflowReadModel({ dbFile }).incidentEvidenceOptions(workflowId, {
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed"
  });
  assert.equal(evidenceOptions.schemaVersion, "workflow_incident_evidence_options.v1");
  assert.equal(evidenceOptions.writeMode, "read_only_derived_options");
  assert.equal(Boolean(evidenceOptions.humanGateOptions.some((row) => row.id === "hg-dead-letter-link" && row.recommended)), true);
  assert.equal(Boolean(evidenceOptions.catClawAuditOptions.some((row) => row.id === "audit-dead-letter-link" && row.recommended)), true);
  const linkedHumanGateOption = evidenceOptions.humanGateOptions.find((row) => row.id === "hg-dead-letter-link");
  const linkedCatClawOption = evidenceOptions.catClawAuditOptions.find((row) => row.id === "audit-dead-letter-link");
  assert.ok(linkedHumanGateOption);
  assert.ok(linkedCatClawOption);
  assert.equal(Boolean(linkedHumanGateOption.recommendationReasons.some((row) => row.code === "same_workflow")), true);
  assert.equal(Boolean(linkedHumanGateOption.recommendationReasons.some((row) => row.code === "cat_claw_source")), true);
  assert.equal(Boolean(linkedHumanGateOption.recommendationReasons.some((row) => row.code === "positive_status")), true);
  assert.equal(Boolean(linkedHumanGateOption.recommendationReasons.some((row) => row.code === "references_dead_letter")), true);
  assert.equal(Boolean(linkedCatClawOption.recommendationReasons.some((row) => row.code === "secretary_audit")), true);
  assert.equal(Boolean(linkedCatClawOption.recommendationReasons.some((row) => row.code === "cat_claw_source")), true);
  assert.equal(Boolean(linkedCatClawOption.recommendationReasons.some((row) => row.code === "positive_decision")), true);
  assert.equal(Boolean(linkedCatClawOption.recommendationReasons.some((row) => row.code === "references_dead_letter")), true);
  assert.match(linkedHumanGateOption.recommendationSummary, /same workflow/);
  assert.match(linkedCatClawOption.recommendationSummary, /secretary audit result/);
  assert.equal(JSON.stringify(evidenceOptions).includes("hg-option-secret"), false);
  assert.equal(JSON.stringify(evidenceOptions).includes("audit-option-secret"), false);
  const routedEvidenceOptions = await workflowChildPayload(new WorkflowReadModel({ dbFile }), workflowId, "incident-evidence-options", {
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed"
  });
  assert.equal(routedEvidenceOptions.counts.humanGateOptions, evidenceOptions.counts.humanGateOptions);
  const wrongWorkflowEvidenceOptions = await new WorkflowReadModel({ dbFile }).incidentEvidenceOptions("wf-console-operations-other", {
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed"
  });
  assert.equal(wrongWorkflowEvidenceOptions.counts.humanGateOptions, 0);
  assert.equal(wrongWorkflowEvidenceOptions.counts.catClawAuditOptions, 0);
  const emptyWorkflowEvidenceOptions = await new WorkflowReadModel({ dbFile }).incidentEvidenceOptions("", {
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed"
  });
  assert.equal(emptyWorkflowEvidenceOptions.counts.humanGateOptions, 0);
  assert.equal(emptyWorkflowEvidenceOptions.counts.catClawAuditOptions, 0);
  const incidentPreview = await runAction(root, {
    action: "workflow.incident.from_dead_letter.preview",
    workflowId,
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed"
  });
  assert.equal(incidentPreview.schemaVersion, "workflow_dead_letter_incident_preview.v1");
  assert.equal(incidentPreview.readOnly, true);
  assert.equal(incidentPreview.eligible, true);
  assert.equal(incidentPreview.wouldWriteIncident.incidentId.startsWith("incident.dead_letter."), true);
  assert.equal(incidentPreview.wouldRetryOrRepair, false);
  assert.equal(incidentPreview.wouldMutate.workflowRuns, 0);
  assert.equal(sqliteCount(dbFile, "incident_states"), 0);
  const missingEvidenceBefore = sqliteCount(dbFile, "incident_states");
  await assert.rejects(
    () => runAction(root, {
      action: "workflow.incident.from_dead_letter",
      workflowId,
      kind: "message_flow_delivery_missing",
      refId: "flow-dead-delivery-completed",
      operatorReason: "try without gate"
    }),
    /workflow policy blocked: action=workflow\.incident\.from_dead_letter/
  );
  assert.equal(sqliteCount(dbFile, "incident_states"), missingEvidenceBefore);
  const incidentWriteCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states")
  };
  const incidentLinked = await runAction(root, {
    action: "workflow.incident.from_dead_letter",
    workflowId,
    kind: "message_flow_delivery_missing",
    refId: "flow-dead-delivery-completed",
    humanGateId: "hg-dead-letter-link",
    catClawAuditId: "audit-dead-letter-link",
    operatorReason: "猫爪复核通过，建立 incident 跟踪。 token=incident-secret"
  });
  assert.equal(incidentLinked.schemaVersion, "workflow_dead_letter_incident_link_result.v1");
  assert.equal(incidentLinked.writeBoundary, "incident_state_only");
  assert.equal(incidentLinked.didRetryOrRepair, false);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states")
  }, {
    ...incidentWriteCountsBefore,
    incidents: incidentWriteCountsBefore.incidents + 1
  });
  const incidentRows = sqliteJson(dbFile, `SELECT * FROM incident_states WHERE incident_id='${incidentLinked.incidentId}' LIMIT 1;`);
  assert.equal(incidentRows.length, 1);
  assert.equal(incidentRows[0].status, "monitoring");
  assert.equal(incidentRows[0].mode, "degraded");
  assert.equal(JSON.stringify(incidentRows[0]).includes("incident-secret"), false);
  assert.equal(JSON.stringify(incidentRows[0]).includes("workflow_dead_letter_incident_link.v1"), true);
  const incidentCloseout = await new WorkflowReadModel({ dbFile }).incidentCloseout(workflowId);
  assert.equal(incidentCloseout.schemaVersion, "workflow_incident_closeout.v1");
  assert.equal(incidentCloseout.writeMode, "read_only_derived_closeout");
  assert.equal(incidentCloseout.incidentId, incidentLinked.incidentId);
  assert.equal(incidentCloseout.selectedIncident.status, "monitoring");
  const incidentWorkflowDetail = await new WorkflowReadModel({ dbFile }).workflowDetail(workflowId);
  assert.equal(Number(incidentWorkflowDetail.counts.openIncidents) >= 1, true);
  const incidentWorkflowTimeline = await new WorkflowReadModel({ dbFile }).timeline(workflowId);
  assert.equal(Boolean(incidentWorkflowTimeline.events.some((row) => row.refId === incidentLinked.incidentId)), true);
  assert.equal(Boolean(incidentCloseout.checklist.some((row) => row.key === "incident_state" && row.status === "pass")), true);
  assert.equal(Boolean(incidentCloseout.checklist.some((row) => row.key === "dead_letter_evidence_current" && row.status === "pass")), true);
  assert.equal(Boolean(incidentCloseout.checklist.some((row) => row.key === "human_gate_evidence" && row.status === "pass")), true);
  assert.equal(Boolean(incidentCloseout.checklist.some((row) => row.key === "cat_claw_audit" && row.status === "pass")), true);
  assert.equal(Boolean(incidentCloseout.checklist.some((row) => row.key === "operator_reason" && row.status === "pass")), true);
  assert.equal(Boolean(incidentCloseout.checklist.some((row) => row.key === "rollback_boundary" && row.status === "pass")), true);
  assert.equal(Boolean(incidentCloseout.checklist.some((row) => row.key === "side_effect_boundary" && row.status === "pass")), true);
  assert.equal(Boolean(incidentCloseout.timeline.some((row) => row.kind === "incident.created")), true);
  assert.equal(JSON.stringify(incidentCloseout).includes("incident-secret"), false);
  assert.equal(JSON.stringify(incidentCloseout).includes("hg-option-secret"), false);
  assert.equal(JSON.stringify(incidentCloseout).includes("audit-option-secret"), false);
  const routedIncidentCloseout = await workflowChildPayload(new WorkflowReadModel({ dbFile }), workflowId, "incident-closeout", {
    incidentId: incidentLinked.incidentId
  });
  assert.equal(routedIncidentCloseout.incidentId, incidentLinked.incidentId);
  sqliteExec(dbFile, `
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-legacy-closeout', 'active', 'degraded', '["workflow"]', 'Legacy closeout regression', 'main', 'Legacy incident has no workflow/dead-letter payload link.', 'Legacy incident should still be visible by incidentId.', 'Prepare governed closeout package.', 'Rollback boundary recorded.', 'Closeout evidence recorded.', '[]', '{"jsonRelPath":"bridge/incidents/incident-legacy-closeout.json"}', '2026-05-31T00:00:09.000Z', '', '', '2026-05-31T00:00:10.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-legacy-ready-with-warning', 'active', 'degraded', '["workflow"]', 'Legacy closeout warning-only regression', 'main', 'Legacy incident has all required closeout evidence but only warning-level gaps.', 'Warnings should not send the worklist back to Cat Claw report preview forever.', 'Prepare Human Gate closeout package.', 'Rollback boundary recorded.', 'Closeout evidence recorded.', '[]', '{"operatorReason":"Required evidence is complete; warning-only gaps remain.","humanGateId":"N/A operational closeout","catClawAuditId":"flow.ready-warning-audit","incidentCandidate":{"rollbackBoundary":"No runtime, delivery, side-effect, or incident status mutation in preview."}}', '2026-05-31T00:00:10.500Z', '', '', '2026-05-31T00:00:10.500Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-nested-other-workflow', 'active', 'degraded', '["workflow"]', 'Nested workflow closeout regression', 'main', 'Nested workflow link belongs to another workflow.', 'Should not be readable through legacy fallback.', 'none', 'rollback boundary recorded', 'closeout evidence recorded', '[]', '{"payload":{"workflowId":"wf-console-operations-other"},"jsonRelPath":"bridge/incidents/incident-nested-other-workflow.json"}', '2026-05-31T00:00:11.000Z', '', '', '2026-05-31T00:00:12.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-deadletter-other-workflow', 'active', 'degraded', '["workflow"]', 'Dead-letter workflow closeout regression', 'main', 'Dead-letter workflow link belongs to another workflow.', 'Should not be readable through legacy fallback.', 'none', 'rollback boundary recorded', 'closeout evidence recorded', '[]', '{"deadLetter":{"workflowId":"wf-console-operations-other","kind":"failed_dispatch","refId":"dispatch-other"}}', '2026-05-31T00:00:13.000Z', '', '', '2026-05-31T00:00:14.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-closeout-evidence-other-workflow', 'active', 'degraded', '["workflow"]', 'Closeout evidence workflow regression', 'main', 'Closeout evidence workflow link belongs to another workflow.', 'Should not be readable through legacy fallback.', 'none', 'rollback boundary recorded', 'closeout evidence recorded', '[]', '{"closeoutEvidence":{"workflowId":"wf-console-operations-other","incidentId":"incident-closeout-evidence-other-workflow"}}', '2026-05-31T00:00:15.000Z', '', '', '2026-05-31T00:00:16.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-malformed-legacy', 'active', 'degraded', '["workflow"]', 'Malformed legacy closeout regression', 'main', 'Malformed legacy payload should not break closeout preview.', 'Treat as legacy incident selected by exact incident id.', 'Prepare governed closeout package.', 'Rollback boundary recorded.', 'Closeout evidence recorded.', '[]', '{"jsonRelPath":', '2026-05-31T00:00:15.000Z', '', '', '2026-05-31T00:00:16.000Z');
`);
  const legacyIncidentCloseout = await new WorkflowReadModel({ dbFile }).incidentCloseout(workflowId, {
    incidentId: "incident-legacy-closeout"
  });
  assert.equal(legacyIncidentCloseout.incidentId, "incident-legacy-closeout");
  assert.equal(legacyIncidentCloseout.selectedIncident.status, "active");
  assert.equal(legacyIncidentCloseout.checklist.find((row) => row.key === "dead_letter_evidence_current")?.status, "pass");
  assert.equal(legacyIncidentCloseout.checklist.find((row) => row.key === "dead_letter_evidence_current")?.severity, "warning");
  assert.equal(legacyIncidentCloseout.checklist.find((row) => row.key === "side_effect_boundary")?.status, "pass");
  assert.equal(legacyIncidentCloseout.checklist.find((row) => row.key === "side_effect_boundary")?.severity, "warning");
  const nestedOtherWorkflowCloseout = await new WorkflowReadModel({ dbFile }).incidentCloseout(workflowId, {
    incidentId: "incident-nested-other-workflow"
  });
  assert.equal(nestedOtherWorkflowCloseout.status, "not_found");
  const deadLetterOtherWorkflowCloseout = await new WorkflowReadModel({ dbFile }).incidentCloseout(workflowId, {
    incidentId: "incident-deadletter-other-workflow"
  });
  assert.equal(deadLetterOtherWorkflowCloseout.status, "not_found");
  const closeoutEvidenceOtherWorkflowCloseout = await new WorkflowReadModel({ dbFile }).incidentCloseout(workflowId, {
    incidentId: "incident-closeout-evidence-other-workflow"
  });
  assert.equal(closeoutEvidenceOtherWorkflowCloseout.status, "not_found");
  const malformedLegacyCloseout = await new WorkflowReadModel({ dbFile }).incidentCloseout(workflowId, {
    incidentId: "incident-malformed-legacy"
  });
  assert.equal(malformedLegacyCloseout.incidentId, "incident-malformed-legacy");
  assert.equal(malformedLegacyCloseout.checklist.find((row) => row.key === "dead_letter_evidence_current")?.severity, "warning");
  const closeoutWorklistPreview = await runAction(root, {
    action: "workflow.incident.closeout.worklist.preview",
    workflowId,
    limit: 10
  });
  assert.equal(closeoutWorklistPreview.schemaVersion, "workflow_incident_closeout_worklist_preview.v1");
  assert.equal(closeoutWorklistPreview.readOnly, true);
  assert.equal(closeoutWorklistPreview.writeMode, "read_only_closeout_worklist_preview");
  assert.equal(closeoutWorklistPreview.counts.openIncidentsScanned >= 3, true);
  assert.equal(closeoutWorklistPreview.counts.rejectedByScope >= 2, true);
  assert.equal(closeoutWorklistPreview.items.some((item) => item.incidentId === "incident-nested-other-workflow"), false);
  assert.equal(closeoutWorklistPreview.items.some((item) => item.incidentId === "incident-deadletter-other-workflow"), false);
  assert.equal(closeoutWorklistPreview.items.some((item) => item.incidentId === "incident-closeout-evidence-other-workflow"), false);
  const legacyWorklistItem = closeoutWorklistPreview.items.find((item) => item.incidentId === "incident-legacy-closeout");
  assert.equal(legacyWorklistItem?.closeoutStatus, "needs_evidence");
  assert.equal(legacyWorklistItem?.recommendation, "workflow.incident.closeout.evidence.preview");
  assert.equal(Boolean(legacyWorklistItem?.missingRequired.some((row) => row.key === "operator_reason")), true);
  const warningOnlyWorklistItem = closeoutWorklistPreview.items.find((item) => item.incidentId === "incident-legacy-ready-with-warning");
  assert.equal(warningOnlyWorklistItem?.closeoutStatus, "needs_closeout");
  assert.deepEqual(warningOnlyWorklistItem?.missingRequired || [], []);
  assert.equal(Boolean(warningOnlyWorklistItem?.warningKeys?.length), true);
  assert.equal(warningOnlyWorklistItem?.recommendation, "workflow.incident.closeout.human_gate_package.preview");
  const warningOnlyHumanGatePreview = await runAction(root, {
    action: "workflow.incident.closeout.human_gate_package.preview",
    workflowId,
    incidentId: "incident-legacy-ready-with-warning"
  });
  assert.equal(warningOnlyHumanGatePreview.eligible, true);
  assert.equal(warningOnlyHumanGatePreview.readOnly, true);
  assert.equal(warningOnlyHumanGatePreview.wouldCreate.humanGateRequests, 0);
  assert.equal(Boolean(warningOnlyHumanGatePreview.warnings?.length), true);
  assert.equal(warningOnlyHumanGatePreview.closeoutStatus, "needs_closeout");
  assert.equal(closeoutWorklistPreview.nextActions[0], "workflow.incident.closeout.worklist.artifact.preview");
  const closeoutWorklistArtifactPreviewCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  };
  const closeoutWorklistArtifactMissingReason = await runAction(root, {
    action: "workflow.incident.closeout.worklist.artifact.preview",
    workflowId,
    artifactId: "artifact-closeout-worklist-regression"
  });
  assert.equal(closeoutWorklistArtifactMissingReason.schemaVersion, "workflow_incident_closeout_worklist_artifact_preview.v1");
  assert.equal(closeoutWorklistArtifactMissingReason.readOnly, true);
  assert.equal(closeoutWorklistArtifactMissingReason.writeReady, false);
  assert.equal(Boolean(closeoutWorklistArtifactMissingReason.violations.some((row) => row.code === "operator_reason_required")), true);
  assert.equal(closeoutWorklistArtifactMissingReason.wouldCreate.humanGateRequests, 0);
  assert.equal(closeoutWorklistArtifactMissingReason.wouldCreate.telegramOutbox, 0);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  }, closeoutWorklistArtifactPreviewCountsBefore);
  const closeoutWorklistArtifactReadyPreview = await runAction(root, {
    action: "workflow.incident.closeout.worklist.artifact.preview",
    workflowId,
    artifactId: "artifact-closeout-worklist-regression",
    operatorReason: "把 open incident worklist 固化为猫爪审计入口。 token=worklist-preview-secret"
  });
  assert.equal(closeoutWorklistArtifactReadyPreview.writeReady, true);
  assert.equal(closeoutWorklistArtifactReadyPreview.worklistCounts.selected, closeoutWorklistPreview.counts.selected);
  assert.equal(JSON.stringify(closeoutWorklistArtifactReadyPreview).includes("worklist-preview-secret"), false);
  const closeoutWorklistArtifactCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  };
  const closeoutWorklistArtifact = await runAction(root, {
    action: "workflow.incident.closeout.worklist.artifact",
    workflowId,
    artifactId: "artifact-closeout-worklist-regression",
    operatorReason: "把 open incident worklist 固化为猫爪审计入口。 token=worklist-artifact-secret"
  });
  assert.equal(closeoutWorklistArtifact.schemaVersion, "workflow_incident_closeout_worklist_artifact_result.v1");
  assert.equal(closeoutWorklistArtifact.writeBoundary, "closeout_worklist_artifact_only");
  assert.equal(closeoutWorklistArtifact.didCloseIncident, false);
  assert.equal(closeoutWorklistArtifact.didRecordCloseoutEvidence, false);
  assert.equal(closeoutWorklistArtifact.didCreateHumanGate, false);
  assert.equal(closeoutWorklistArtifact.didSendTelegram, false);
  assert.equal(closeoutWorklistArtifact.didDispatchRuntime, false);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  }, {
    ...closeoutWorklistArtifactCountsBefore,
    artifacts: closeoutWorklistArtifactCountsBefore.artifacts + 2,
    events: closeoutWorklistArtifactCountsBefore.events + 1
  });
  const closeoutWorklistArtifactRows = sqliteJson(dbFile, `
SELECT artifact_id AS artifactId, kind, path, summary
FROM artifact_index
WHERE artifact_id IN ('artifact-closeout-worklist-regression.json','artifact-closeout-worklist-regression.md')
ORDER BY artifact_id;`);
  assert.equal(closeoutWorklistArtifactRows.length, 2);
  assert.equal(Boolean(closeoutWorklistArtifactRows.some((row) => row.kind === "incident_closeout_worklist_json")), true);
  assert.equal(Boolean(closeoutWorklistArtifactRows.some((row) => row.kind === "incident_closeout_worklist_markdown")), true);
  const closeoutWorklistMarkdown = await fs.readFile(path.join(root, closeoutWorklistArtifact.markdownRelativePath), "utf8");
  assert.match(closeoutWorklistMarkdown, /Incident Closeout Worklist/);
  assert.equal(closeoutWorklistMarkdown.includes("worklist-artifact-secret"), false);
  const closeoutWorklistRecord = JSON.parse(await fs.readFile(path.join(root, closeoutWorklistArtifact.jsonRelativePath), "utf8"));
  assert.equal(closeoutWorklistRecord.writeBoundary, "closeout_worklist_artifact_only");
  assert.equal(closeoutWorklistRecord.worklist.counts.selected, closeoutWorklistPreview.counts.selected);
  assert.equal(JSON.stringify(closeoutWorklistRecord).includes("worklist-artifact-secret"), false);
  const closeoutWorklistArtifactEventRows = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, workflow_id AS workflowId, payload_json AS payloadJson
FROM workflow_events
WHERE event_type='incident.closeout_worklist_artifact.persisted'
ORDER BY created_at DESC
LIMIT 1;`);
  assert.equal(closeoutWorklistArtifactEventRows[0].eventType, "incident.closeout_worklist_artifact.persisted");
  assert.equal(closeoutWorklistArtifactEventRows[0].status, "persisted");
  assert.equal(closeoutWorklistArtifactEventRows[0].workflowId, workflowId);
  assert.equal(JSON.parse(closeoutWorklistArtifactEventRows[0].payloadJson).writeBoundary, "closeout_worklist_artifact_only");
  const evidencePreviewMissing = await runAction(root, {
    action: "workflow.incident.closeout.evidence.preview",
    workflowId,
    incidentId: "incident-legacy-closeout",
    catClawAuditId: "audit-legacy-closeout"
  });
  assert.equal(evidencePreviewMissing.schemaVersion, "workflow_incident_closeout_evidence_preview.v1");
  assert.equal(evidencePreviewMissing.readOnly, true);
  assert.equal(evidencePreviewMissing.writeReady, false);
  assert.equal(Boolean(evidencePreviewMissing.violations.some((row) => row.code === "operator_reason_required")), true);
  const closeoutEvidenceCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  };
  const closeoutEvidence = await runAction(root, {
    action: "workflow.incident.closeout.evidence",
    workflowId,
    incidentId: "incident-legacy-closeout",
    humanGateEvidence: "hg-legacy-closeout-evidence",
    catClawAuditId: "audit-legacy-closeout",
    operatorReason: "猫爪复核 legacy incident，可进入 closeout 证据包准备。",
    rollbackBoundary: "补证动作只更新 incident evidence，不关闭 incident、不创建 Human Gate、不发 Telegram。"
  });
  assert.equal(closeoutEvidence.schemaVersion, "workflow_incident_closeout_evidence_result.v1");
  assert.equal(closeoutEvidence.writeBoundary, "incident_closeout_evidence_only");
  assert.equal(closeoutEvidence.didCloseIncident, false);
  assert.equal(closeoutEvidence.didCreateHumanGate, false);
  assert.equal(closeoutEvidence.didSendTelegram, false);
  assert.equal(closeoutEvidence.didDispatchRuntime, false);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  }, {
    ...closeoutEvidenceCountsBefore,
    events: closeoutEvidenceCountsBefore.events + 1
  });
  const legacyIncidentCloseoutAfterEvidence = await new WorkflowReadModel({ dbFile }).incidentCloseout(workflowId, {
    incidentId: "incident-legacy-closeout"
  });
  assert.equal(legacyIncidentCloseoutAfterEvidence.status, "needs_closeout");
  assert.equal(legacyIncidentCloseoutAfterEvidence.checklist.find((row) => row.key === "human_gate_evidence")?.status, "pass");
  assert.equal(legacyIncidentCloseoutAfterEvidence.checklist.find((row) => row.key === "cat_claw_audit")?.status, "pass");
  assert.equal(legacyIncidentCloseoutAfterEvidence.checklist.find((row) => row.key === "operator_reason")?.status, "pass");
  assert.equal(legacyIncidentCloseoutAfterEvidence.checklist.find((row) => row.key === "rollback_boundary")?.status, "pass");
  const closeoutEvidenceIncidentRows = sqliteJson(dbFile, "SELECT status, resolved_at AS resolvedAt, rollback_options AS rollbackOptions, timeline_json AS timelineJson, payload_json AS payloadJson FROM incident_states WHERE incident_id='incident-legacy-closeout';");
  assert.equal(closeoutEvidenceIncidentRows[0].status, "active");
  assert.equal(closeoutEvidenceIncidentRows[0].resolvedAt, "");
  assert.match(closeoutEvidenceIncidentRows[0].rollbackOptions, /不关闭 incident/);
  const closeoutEvidenceTimeline = JSON.parse(closeoutEvidenceIncidentRows[0].timelineJson);
  assert.equal(closeoutEvidenceTimeline.some((item) => String(item).includes("boundary=incident_closeout_evidence_only")), true);
  const closeoutEvidencePayload = JSON.parse(closeoutEvidenceIncidentRows[0].payloadJson);
  assert.equal(closeoutEvidencePayload.workflowId, workflowId);
  assert.equal(closeoutEvidencePayload.closeoutEvidence.workflowId, workflowId);
  assert.equal(closeoutEvidencePayload.closeoutEvidence.incidentId, "incident-legacy-closeout");
  assert.equal(closeoutEvidencePayload.closeoutEvidence.writeBoundary, "incident_closeout_evidence_only");
  assert.equal(closeoutEvidencePayload.closeoutEvidence.catClawAuditId, "audit-legacy-closeout");
  const closeoutEvidenceEventRows = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, workflow_id AS workflowId, incident_id AS incidentId, payload_json AS payloadJson
FROM workflow_events
WHERE incident_id='incident-legacy-closeout'
ORDER BY created_at DESC
LIMIT 1;`);
  assert.equal(closeoutEvidenceEventRows[0].eventType, "incident.closeout_evidence.recorded");
  assert.equal(closeoutEvidenceEventRows[0].status, "recorded");
  assert.equal(closeoutEvidenceEventRows[0].workflowId, workflowId);
  assert.equal(closeoutEvidenceEventRows[0].incidentId, "incident-legacy-closeout");
  assert.equal(JSON.parse(closeoutEvidenceEventRows[0].payloadJson).writeBoundary, "incident_closeout_evidence_only");
  const closeoutCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  };
  const catClawCloseoutPreview = await runAction(root, {
    action: "workflow.incident.closeout.cat_claw_report.preview",
    workflowId,
    incidentId: incidentLinked.incidentId
  });
  assert.equal(catClawCloseoutPreview.schemaVersion, "workflow_incident_closeout_preview.v1");
  assert.equal(catClawCloseoutPreview.readOnly, true);
  assert.equal(catClawCloseoutPreview.writeMode, "read_only_closeout_package_preview");
  assert.equal(catClawCloseoutPreview.packageKind, "cat_claw_report");
  assert.equal(catClawCloseoutPreview.eligible, true);
  assert.equal(catClawCloseoutPreview.wouldCreate.artifacts, 0);
  assert.equal(catClawCloseoutPreview.wouldCreate.humanGateRequests, 0);
  assert.equal(catClawCloseoutPreview.wouldCreate.telegramOutbox, 0);
  assert.equal(catClawCloseoutPreview.reportDraft.audience, "cat_claw");
  assert.equal(JSON.stringify(catClawCloseoutPreview).includes("incident-secret"), false);
  assert.equal(JSON.stringify(catClawCloseoutPreview).includes("hg-option-secret"), false);
  assert.equal(JSON.stringify(catClawCloseoutPreview).includes("audit-option-secret"), false);
  const humanGateCloseoutPreview = await runAction(root, {
    action: "workflow.incident.closeout.human_gate_package.preview",
    workflowId,
    incidentId: incidentLinked.incidentId
  });
  assert.equal(humanGateCloseoutPreview.schemaVersion, "workflow_incident_closeout_preview.v1");
  assert.equal(humanGateCloseoutPreview.packageKind, "human_gate_package");
  assert.equal(humanGateCloseoutPreview.eligible, true);
  assert.equal(humanGateCloseoutPreview.reportDraft.audience, "flashcat_human_gate");
  assert.equal(humanGateCloseoutPreview.reportDraft.humanGateOptions.length >= 5, true);
  assert.equal(Boolean(humanGateCloseoutPreview.reportDraft.humanGateOptions.some((row) => row.optionId === "terminate" && row.style === "danger")), true);
  assert.equal(humanGateCloseoutPreview.wouldCreate.humanGateButtons, 0);
  assert.equal(humanGateCloseoutPreview.wouldCreate.runtimeDispatches, 0);
  assert.equal(JSON.stringify(humanGateCloseoutPreview).includes("incident-secret"), false);
  const closeoutArtifactPreview = await runAction(root, {
    action: "workflow.incident.closeout.artifact.preview",
    workflowId,
    incidentId: incidentLinked.incidentId,
    packageKind: "human_gate_package",
    artifactId: "artifact-closeout-regression"
  });
  assert.equal(closeoutArtifactPreview.schemaVersion, "workflow_incident_closeout_artifact_preview.v1");
  assert.equal(closeoutArtifactPreview.readOnly, true);
  assert.equal(closeoutArtifactPreview.packageKind, "human_gate_package");
  assert.equal(closeoutArtifactPreview.eligible, true);
  assert.equal(closeoutArtifactPreview.writeReady, false);
  assert.equal(closeoutArtifactPreview.wouldCreate.artifactIndexRows, 2);
  assert.equal(closeoutArtifactPreview.wouldCreate.humanGateRequests, 0);
  assert.equal(Boolean(closeoutArtifactPreview.violations.some((row) => row.code === "operator_reason_required")), true);
  assert.equal(JSON.stringify(closeoutArtifactPreview).includes("incident-secret"), false);
  const closeoutArtifactReadyPreview = await runAction(root, {
    action: "workflow.incident.closeout.artifact.preview",
    workflowId,
    incidentId: incidentLinked.incidentId,
    packageKind: "human_gate_package",
    artifactId: "artifact-closeout-regression-ready-preview",
    flashcatOriginalWords: "闪电猫原话：允许持久化 closeout artifact。",
    secretaryAuditId: "audit-dead-letter-link",
    operatorReason: "ready preview with alternative evidence"
  });
  assert.equal(closeoutArtifactReadyPreview.writeReady, true);
  assert.equal(closeoutArtifactReadyPreview.violations.length, 0);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  }, closeoutCountsBefore);
  const blockedCloseoutArtifactEventsBefore = sqliteCount(dbFile, "workflow_events");
  await assert.rejects(
    () => runAction(root, {
      action: "workflow.incident.closeout.artifact",
      workflowId,
      incidentId: incidentLinked.incidentId,
      packageKind: "human_gate_package",
      artifactId: "artifact-closeout-regression-blocked",
      operatorReason: "try without governed evidence"
    }),
    /workflow policy blocked: action=workflow\.incident\.closeout\.artifact/
  );
  assert.equal(sqliteCount(dbFile, "artifact_index"), closeoutCountsBefore.artifacts);
  assert.equal(sqliteCount(dbFile, "workflow_events"), blockedCloseoutArtifactEventsBefore + 1);
  const closeoutArtifactWriteCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  };
  const closeoutArtifact = await runAction(root, {
    action: "workflow.incident.closeout.artifact",
    workflowId,
    incidentId: incidentLinked.incidentId,
    packageKind: "human_gate_package",
    artifactId: "artifact-closeout-regression",
    humanGateId: "hg-dead-letter-link",
    catClawAuditId: "audit-dead-letter-link",
    operatorReason: "猫爪复核通过，持久化收口证据包。 token=closeout-artifact-secret"
  });
  assert.equal(closeoutArtifact.schemaVersion, "workflow_incident_closeout_artifact_result.v1");
  assert.equal(closeoutArtifact.writeBoundary, "closeout_artifact_only");
  assert.equal(closeoutArtifact.didCloseIncident, false);
  assert.equal(closeoutArtifact.didCreateHumanGate, false);
  assert.equal(closeoutArtifact.didSendTelegram, false);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  }, {
    ...closeoutArtifactWriteCountsBefore,
    artifacts: closeoutArtifactWriteCountsBefore.artifacts + 2,
    events: closeoutArtifactWriteCountsBefore.events + 1
  });
  const closeoutArtifactRows = sqliteJson(dbFile, `
SELECT artifact_id AS artifactId, kind, path, summary
FROM artifact_index
WHERE artifact_id IN ('artifact-closeout-regression.json','artifact-closeout-regression.md')
ORDER BY artifact_id;`);
  assert.equal(closeoutArtifactRows.length, 2);
  assert.equal(Boolean(closeoutArtifactRows.some((row) => row.kind === "incident_closeout_human_gate_package_json")), true);
  assert.equal(Boolean(closeoutArtifactRows.some((row) => row.kind === "incident_closeout_human_gate_package_markdown")), true);
  const closeoutMarkdown = await fs.readFile(path.join(root, closeoutArtifact.markdownRelativePath), "utf8");
  assert.match(closeoutMarkdown, /Human Gate 收口证据包预览/);
  assert.equal(closeoutMarkdown.includes("closeout-artifact-secret"), false);
  const closeoutArtifactJsonPath = path.join(root, closeoutArtifact.jsonRelativePath);
  const closeoutArtifactRecord = JSON.parse(await fs.readFile(closeoutArtifactJsonPath, "utf8"));
  closeoutArtifactRecord.reportDraft = {
    ...(closeoutArtifactRecord.reportDraft || {}),
    summaryZh: `${closeoutArtifactRecord.reportDraft?.summaryZh || "请闪电猫审核收口方案。"} token=human-gate-preview-secret`,
    evidenceRefs: [
      ...((closeoutArtifactRecord.reportDraft?.evidenceRefs || []).filter(Boolean)),
      "secret=human-gate-preview-secret"
    ]
  };
  await fs.writeFile(closeoutArtifactJsonPath, JSON.stringify(closeoutArtifactRecord, null, 2));
  const humanGateRequestPreviewCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  };
  const humanGateRequestPreview = await runAction(root, {
    action: "workflow.incident.closeout.human_gate_request.preview",
    workflowId,
    incidentId: incidentLinked.incidentId,
    closeoutArtifactId: "artifact-closeout-regression"
  });
  assert.equal(humanGateRequestPreview.schemaVersion, "workflow_incident_closeout_human_gate_request_preview.v1");
  assert.equal(humanGateRequestPreview.readOnly, true);
  assert.equal(humanGateRequestPreview.eligible, true);
  assert.equal(humanGateRequestPreview.requestReady, true);
  assert.equal(humanGateRequestPreview.buttonSummary.planCount >= 3, true);
  assert.equal(humanGateRequestPreview.buttonSummary.hasA, true);
  assert.equal(humanGateRequestPreview.buttonSummary.hasB, true);
  assert.equal(humanGateRequestPreview.buttonSummary.hasC, true);
  assert.equal(humanGateRequestPreview.buttonSummary.hasPause, true);
  assert.equal(humanGateRequestPreview.buttonSummary.hasTerminate, true);
  assert.equal(humanGateRequestPreview.wouldCreate.humanGateRecords, 1);
  assert.equal(humanGateRequestPreview.wouldCreate.humanGateButtons >= 5, true);
  assert.equal(humanGateRequestPreview.wouldCreate.telegramOutbox, 1);
  assert.equal(humanGateRequestPreview.wouldCreate.runtimeDispatches, 0);
  assert.equal(JSON.stringify(humanGateRequestPreview).includes("closeout-artifact-secret"), false);
  assert.equal(JSON.stringify(humanGateRequestPreview).includes("human-gate-preview-secret"), false);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  }, humanGateRequestPreviewCountsBefore);
  const missingHumanGateRequestPreview = await runAction(root, {
    action: "workflow.incident.closeout.human_gate_request.preview",
    workflowId,
    incidentId: incidentLinked.incidentId,
    closeoutArtifactId: "artifact-closeout-missing"
  });
  assert.equal(missingHumanGateRequestPreview.schemaVersion, "workflow_incident_closeout_human_gate_request_preview.v1");
  assert.equal(missingHumanGateRequestPreview.eligible, false);
  assert.equal(missingHumanGateRequestPreview.wouldCreate.humanGateRecords, 0);
  assert.equal(Boolean(missingHumanGateRequestPreview.violations.some((row) => row.code === "closeout_artifact_not_found")), true);
  const blockedCloseoutHumanGateEventsBefore = sqliteCount(dbFile, "workflow_events");
  await assert.rejects(
    () => runAction(root, {
      action: "workflow.incident.closeout.human_gate_request",
      workflowId,
      incidentId: incidentLinked.incidentId,
      closeoutArtifactId: "artifact-closeout-regression",
      operatorReason: "try without governed evidence"
    }),
    /workflow policy blocked: action=workflow\.incident\.closeout\.human_gate_request/
  );
  assert.equal(sqliteCount(dbFile, "telegram_outbox"), humanGateRequestPreviewCountsBefore.outbox);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons"), humanGateRequestPreviewCountsBefore.humanGateButtons);
  assert.equal(sqliteCount(dbFile, "workflow_events"), blockedCloseoutHumanGateEventsBefore + 1);
  const gatewayIncidentPreview = await gateway.handle({
    action: "workflow.incident.from_dead_letter.preview",
    actor: "flashcat",
    reason: "console incident preview",
    payload: {
      workflowId,
      kind: "message_flow_delivery_missing",
      refId: "flow-dead-delivery-completed"
    }
  });
  assert.equal(gatewayIncidentPreview.ok, true);
  assert.equal(gatewayIncidentPreview.dryRun, true);
  const gatewayCloseoutPreview = await gateway.handle({
    action: "workflow.incident.closeout.human_gate_package.preview",
    actor: "flashcat",
    reason: "console closeout package preview",
    payload: {
      workflowId,
      incidentId: incidentLinked.incidentId
    }
  });
  assert.equal(gatewayCloseoutPreview.ok, true);
  assert.equal(gatewayCloseoutPreview.dryRun, true);
  assert.equal(gatewayCloseoutPreview.result.packageKind, "human_gate_package");
  assert.equal(gatewayCloseoutPreview.result.wouldCreate.humanGateRequests, 0);
  const gatewayCloseoutArtifactPreview = await gateway.handle({
    action: "workflow.incident.closeout.artifact.preview",
    actor: "flashcat",
    reason: "console closeout artifact preview",
    payload: {
      workflowId,
      incidentId: incidentLinked.incidentId,
      packageKind: "human_gate_package"
    }
  });
  assert.equal(gatewayCloseoutArtifactPreview.ok, true);
  assert.equal(gatewayCloseoutArtifactPreview.dryRun, true);
  assert.equal(gatewayCloseoutArtifactPreview.result.wouldCreate.humanGateRequests, 0);
  const gatewayCloseoutWorklistArtifactPreview = await gateway.handle({
    action: "workflow.incident.closeout.worklist.artifact.preview",
    actor: "flashcat",
    reason: "console closeout worklist artifact preview",
    payload: {
      workflowId,
      artifactId: "artifact-console-closeout-worklist-preview",
      operatorReason: "console preview should remain read-only"
    }
  });
  assert.equal(gatewayCloseoutWorklistArtifactPreview.ok, true);
  assert.equal(gatewayCloseoutWorklistArtifactPreview.dryRun, true);
  assert.equal(gatewayCloseoutWorklistArtifactPreview.result.wouldCreate.humanGateRequests, 0);
  assert.equal(gatewayCloseoutWorklistArtifactPreview.result.wouldCreate.telegramOutbox, 0);
  const gatewayCloseoutWorklistArtifactRejected = await gateway.handle({
    action: "workflow.incident.closeout.worklist.artifact",
    actor: "flashcat",
    reason: "console closeout worklist artifact write disabled",
    payload: {
      workflowId,
      artifactId: "artifact-console-closeout-worklist-rejected",
      operatorReason: "should not persist"
    }
  });
  assert.equal(gatewayCloseoutWorklistArtifactRejected.ok, false);
  assert.equal(gatewayCloseoutWorklistArtifactRejected.errorCode, "action_not_allowed");
  const gatewayHumanGateRequestPreview = await gateway.handle({
    action: "workflow.incident.closeout.human_gate_request.preview",
    actor: "flashcat",
    reason: "console closeout Human Gate request preview",
    payload: {
      workflowId,
      incidentId: incidentLinked.incidentId,
      closeoutArtifactId: "artifact-closeout-regression"
    }
  });
  assert.equal(gatewayHumanGateRequestPreview.ok, true);
  assert.equal(gatewayHumanGateRequestPreview.dryRun, true);
  assert.equal(gatewayHumanGateRequestPreview.result.wouldCreate.humanGateRecords, 1);
  assert.equal(gatewayHumanGateRequestPreview.result.wouldCreate.telegramOutbox, 1);
  assert.equal(gatewayHumanGateRequestPreview.result.wouldCreate.runtimeDispatches, 0);
  const gatewayCloseoutHumanGateRejected = await gateway.handle({
    action: "workflow.incident.closeout.human_gate_request",
    actor: "flashcat",
    reason: "console closeout Human Gate write disabled",
    payload: {
      workflowId,
      incidentId: incidentLinked.incidentId,
      closeoutArtifactId: "artifact-closeout-regression",
      humanGateEvidence: "hg-console-dead-letter-link",
      catClawAuditId: "audit-console-dead-letter-link",
      operatorReason: "should not create Human Gate"
    }
  });
  assert.equal(gatewayCloseoutHumanGateRejected.ok, false);
  assert.equal(gatewayCloseoutHumanGateRejected.errorCode, "action_not_allowed");
  const gatewayCloseoutArtifactRejected = await gateway.handle({
    action: "workflow.incident.closeout.artifact",
    actor: "flashcat",
    reason: "console closeout artifact write disabled",
    payload: {
      workflowId,
      incidentId: incidentLinked.incidentId,
      packageKind: "human_gate_package",
      humanGateId: "hg-console-dead-letter-link",
      catClawAuditId: "audit-console-dead-letter-link",
      operatorReason: "should not persist"
    }
  });
  assert.equal(gatewayCloseoutArtifactRejected.ok, false);
  assert.equal(gatewayCloseoutArtifactRejected.errorCode, "action_not_allowed");
  const gatewayIncidentRejected = await gateway.handle({
    action: "workflow.incident.from_dead_letter",
    actor: "flashcat",
    reason: "console write disabled",
    payload: {
      workflowId,
      kind: "message_flow_delivery_missing",
      refId: "flow-dead-delivery-completed",
      humanGateId: "hg-console-dead-letter-link",
      catClawAuditId: "audit-console-dead-letter-link",
      operatorReason: "should not run"
    }
  });
  assert.equal(gatewayIncidentRejected.ok, false);
  assert.equal(gatewayIncidentRejected.errorCode, "action_not_allowed");
  const writeGateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { allowWrites: true });
  const closeoutWorklistGatewayWriteCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  };
  const gatewayCloseoutWorklistArtifactWrite = await writeGateway.handle({
    action: "workflow.incident.closeout.worklist.artifact",
    actor: "flashcat",
    reason: "console governed closeout worklist artifact token=worklist-gateway-secret",
    payload: {
      workflowId,
      artifactId: "artifact-console-closeout-worklist",
      operatorReason: "console governed closeout worklist artifact token=worklist-gateway-secret"
    }
  });
  assert.equal(gatewayCloseoutWorklistArtifactWrite.ok, true);
  assert.equal(gatewayCloseoutWorklistArtifactWrite.result.schemaVersion, "workflow_incident_closeout_worklist_artifact_result.v1");
  assert.equal(gatewayCloseoutWorklistArtifactWrite.result.writeBoundary, "closeout_worklist_artifact_only");
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events")
  }, {
    ...closeoutWorklistGatewayWriteCountsBefore,
    artifacts: closeoutWorklistGatewayWriteCountsBefore.artifacts + 2,
    events: closeoutWorklistGatewayWriteCountsBefore.events + 1
  });
  assert.equal(JSON.stringify(gatewayCloseoutWorklistArtifactWrite).includes("worklist-gateway-secret"), false);
  const closeoutHumanGateWriteCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events"),
    protocolObjects: sqliteCount(dbFile, "protocol_objects"),
    meetingControlEvents: sqliteCount(dbFile, "meeting_control_events")
  };
  const gatewayCloseoutHumanGateWrite = await writeGateway.handle({
    action: "workflow.incident.closeout.human_gate_request",
    actor: "flashcat",
    reason: "console governed closeout Human Gate request token=closeout-hgate-secret",
    payload: {
      workflowId,
      incidentId: incidentLinked.incidentId,
      closeoutArtifactId: "artifact-closeout-regression",
      humanGateEvidence: "hg-console-dead-letter-link",
      catClawAuditId: "audit-console-dead-letter-link",
      operatorReason: "console governed closeout Human Gate request token=closeout-hgate-secret"
    }
  });
  assert.equal(gatewayCloseoutHumanGateWrite.ok, true);
  assert.equal(gatewayCloseoutHumanGateWrite.result.schemaVersion, "workflow_incident_closeout_human_gate_request_result.v1");
  assert.equal(gatewayCloseoutHumanGateWrite.result.writeBoundary, "human_gate_request_only");
  assert.equal(gatewayCloseoutHumanGateWrite.result.didEnsureHumanGate, true);
  assert.equal(gatewayCloseoutHumanGateWrite.result.didCreateHumanGate, true);
  assert.equal(gatewayCloseoutHumanGateWrite.result.didEnsureTelegramOutbox, true);
  assert.equal(gatewayCloseoutHumanGateWrite.result.didCreateTelegramOutbox, true);
  assert.equal(gatewayCloseoutHumanGateWrite.result.telegramOutboxDeduped, false);
  assert.equal(gatewayCloseoutHumanGateWrite.result.didSendTelegram, false);
  assert.equal(gatewayCloseoutHumanGateWrite.result.didDispatchRuntime, false);
  assert.equal(gatewayCloseoutHumanGateWrite.result.didCloseIncident, false);
  assert.ok(gatewayCloseoutHumanGateWrite.result.telegramOutboxId);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events"),
    protocolObjects: sqliteCount(dbFile, "protocol_objects"),
    meetingControlEvents: sqliteCount(dbFile, "meeting_control_events")
  }, {
    ...closeoutHumanGateWriteCountsBefore,
    outbox: closeoutHumanGateWriteCountsBefore.outbox + 1,
    humanGateButtons: closeoutHumanGateWriteCountsBefore.humanGateButtons + gatewayCloseoutHumanGateWrite.result.humanGateButtonCount,
    events: closeoutHumanGateWriteCountsBefore.events + 1,
    protocolObjects: closeoutHumanGateWriteCountsBefore.protocolObjects + 1,
    meetingControlEvents: closeoutHumanGateWriteCountsBefore.meetingControlEvents + 1
  });
  const closeoutHumanGateOperationRows = sqliteJson(dbFile, `
SELECT reason, result_json AS resultJson
FROM workflow_operations
WHERE operation_id='${gatewayCloseoutHumanGateWrite.operationId}'
LIMIT 1;`);
  assert.equal(closeoutHumanGateOperationRows.length, 1);
  assert.equal(JSON.stringify(closeoutHumanGateOperationRows[0]).includes("closeout-hgate-secret"), false);
  const telegramDeliveryPreviewCountsBefore = {
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events"),
    protocolObjects: sqliteCount(dbFile, "protocol_objects"),
    meetingControlEvents: sqliteCount(dbFile, "meeting_control_events")
  };
  const gatewayTelegramDeliveryPreview = await gateway.handle({
    action: "telegram.outbox.delivery.preview",
    actor: "flashcat",
    reason: "console telegram delivery preview",
    payload: {
      outboxId: gatewayCloseoutHumanGateWrite.result.telegramOutboxId
    }
  });
  assert.equal(gatewayTelegramDeliveryPreview.ok, true);
  assert.equal(gatewayTelegramDeliveryPreview.dryRun, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.schemaVersion, "telegram_outbox_delivery_preview.v1");
  assert.equal(gatewayTelegramDeliveryPreview.result.readOnly, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.writeBoundary, "preview_only");
  assert.equal(gatewayTelegramDeliveryPreview.result.eligible, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.claimEligible, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.wouldSendTelegram, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.wouldUpdate.telegramOutboxStatus, "delivering_then_sent_or_failed");
  assert.equal(gatewayTelegramDeliveryPreview.result.buttonSummary.buttonCount >= 5, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.executionPolicy.previewOnly, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.executionPolicy.governanceReady, false);
  assert.equal(gatewayTelegramDeliveryPreview.result.executionPolicy.evidencePresence.deliveryOperatorReason, false);
  assert.equal(gatewayTelegramDeliveryPreview.result.executionPolicy.evidencePresence.catClawAudit, false);
  assert.equal(Boolean(gatewayTelegramDeliveryPreview.result.governanceViolations.some((row) => row.code === "delivery_operator_reason_required")), true);
  assert.equal(Boolean(gatewayTelegramDeliveryPreview.result.governanceViolations.some((row) => row.code === "cat_claw_audit_required")), true);
  assert.equal(gatewayTelegramDeliveryPreview.result.receiptPolicy.deliveryReceiptRequired, true);
  assert.equal(gatewayTelegramDeliveryPreview.result.receiptPolicy.humanGateDeliveryEvidence, "telegram_outbox_payload_delivery_required_before_closeout");
  assert.equal(JSON.stringify(gatewayTelegramDeliveryPreview).includes("closeout-hgate-secret"), false);
  assert.equal(JSON.stringify(gatewayTelegramDeliveryPreview).includes("human-gate-preview-secret"), false);
  assert.deepEqual({
    workflows: sqliteCount(dbFile, "workflow_runs", `workflow_id='${workflowId}'`),
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger"),
    incidents: sqliteCount(dbFile, "incident_states"),
    artifacts: sqliteCount(dbFile, "artifact_index"),
    events: sqliteCount(dbFile, "workflow_events"),
    protocolObjects: sqliteCount(dbFile, "protocol_objects"),
    meetingControlEvents: sqliteCount(dbFile, "meeting_control_events")
  }, telegramDeliveryPreviewCountsBefore);
  const deliveryPreviewMissingTargetAt = new Date().toISOString();
  sqliteExec(dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES ('outbox-delivery-preview-missing-target', '${workflowId}', 'private', '', 'human_gate_request', 'queued', 'delivery preview missing target', '{}', '${deliveryPreviewMissingTargetAt}', '${deliveryPreviewMissingTargetAt}');`);
  const gatewayTelegramDeliveryMissingTarget = await gateway.handle({
    action: "telegram.outbox.delivery.preview",
    actor: "flashcat",
    reason: "console telegram missing target preview",
    payload: {
      outboxId: "outbox-delivery-preview-missing-target"
    }
  });
  assert.equal(gatewayTelegramDeliveryMissingTarget.ok, true);
  assert.equal(gatewayTelegramDeliveryMissingTarget.result.eligible, false);
  assert.equal(gatewayTelegramDeliveryMissingTarget.result.wouldSendTelegram, false);
  assert.equal(Boolean(gatewayTelegramDeliveryMissingTarget.result.violations.some((row) => row.code === "target_missing")), true);
  const requeuePreviewCreatedAt = new Date().toISOString();
  sqliteExec(dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES
  ('outbox-requeue-preview-failed', '${workflowId}', 'private', '8390724843', 'human_gate_request', 'failed', 'failed delivery requeue preview', '{"account":"cat_claw","humanGateId":"hgate-requeue-preview","buttons":[{"optionId":"A"},{"optionId":"B"},{"optionId":"C"},{"control":"pause"},{"control":"terminate"}],"delivery":{"channel":"telegram","account":"cat_claw","target":"8390724843","failedAt":"2026-05-31T00:00:00.000Z","error":"network timeout token=requeue-secret"}}', '${requeuePreviewCreatedAt}', '${requeuePreviewCreatedAt}'),
  ('outbox-requeue-preview-stale', '${workflowId}', 'private', '8390724843', 'human_gate_request', 'delivering', 'stale delivery requeue preview', '{"account":"cat_claw","humanGateId":"hgate-requeue-preview","buttons":[{"optionId":"A"},{"optionId":"B"},{"optionId":"C"},{"control":"pause"},{"control":"terminate"}],"deliveryClaim":{"claimId":"claim-stale","claimedAt":"2000-01-01T00:00:00.000Z","owner":"worker-stale","previousStatus":"queued"}}', '${requeuePreviewCreatedAt}', '2000-01-01T00:00:00.000Z'),
  ('outbox-requeue-preview-fresh', '${workflowId}', 'private', '8390724843', 'human_gate_request', 'delivering', 'fresh delivery requeue preview', '{"account":"cat_claw","humanGateId":"hgate-requeue-preview","buttons":[{"optionId":"A"},{"optionId":"B"},{"optionId":"C"},{"control":"pause"},{"control":"terminate"}]}', '${requeuePreviewCreatedAt}', '${requeuePreviewCreatedAt}'),
  ('outbox-requeue-preview-sent', '${workflowId}', 'private', '8390724843', 'human_gate_request', 'sent', 'sent delivery requeue preview', '{"account":"cat_claw","humanGateId":"hgate-requeue-preview","buttons":[{"optionId":"A"},{"optionId":"B"},{"optionId":"C"},{"control":"pause"},{"control":"terminate"}],"delivery":{"channel":"telegram","account":"cat_claw","target":"8390724843","deliveredAt":"2026-05-31T00:00:00.000Z","receipts":[{"ok":true}]}}', '${requeuePreviewCreatedAt}', '${requeuePreviewCreatedAt}');`);
  const requeuePreviewCountsBefore = {
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    events: sqliteCount(dbFile, "workflow_events"),
    protocolObjects: sqliteCount(dbFile, "protocol_objects"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger")
  };
  const failedRequeuePreview = await gateway.handle({
    action: "telegram.outbox.requeue.preview",
    actor: "flashcat",
    reason: "console failed requeue preview",
    payload: {
      outboxId: "outbox-requeue-preview-failed"
    }
  });
  assert.equal(failedRequeuePreview.ok, true);
  assert.equal(failedRequeuePreview.result.schemaVersion, "telegram_outbox_requeue_preview.v1");
  assert.equal(failedRequeuePreview.result.readOnly, true);
  assert.equal(failedRequeuePreview.result.writeBoundary, "preview_only");
  assert.equal(failedRequeuePreview.result.requeueEligible, true);
  assert.equal(failedRequeuePreview.result.strategy, "retry_failed_delivery");
  assert.equal(failedRequeuePreview.result.governanceReady, false);
  assert.equal(failedRequeuePreview.result.requeuePolicy.preserveOutboxId, true);
  assert.equal(failedRequeuePreview.result.requeuePolicy.createNewHumanGateRequest, false);
  assert.equal(failedRequeuePreview.result.requeuePolicy.createNewTelegramOutbox, false);
  assert.equal(Boolean(failedRequeuePreview.result.governanceViolations.some((row) => row.code === "requeue_operator_reason_required")), true);
  assert.equal(JSON.stringify(failedRequeuePreview).includes("requeue-secret"), false);
  const governedFailedRequeuePreview = await gateway.handle({
    action: "telegram.outbox.requeue.preview",
    actor: "flashcat",
    reason: "console governed failed requeue preview",
    payload: {
      outboxId: "outbox-requeue-preview-failed",
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryApprovalId: "delivery-approval-preview-only",
      requeueOperatorReason: "explicit requeue reason"
    }
  });
  assert.equal(governedFailedRequeuePreview.ok, true);
  assert.equal(governedFailedRequeuePreview.result.governanceReady, true);
  assert.equal(governedFailedRequeuePreview.result.recommendedNextAction, "telegram.outbox.delivery");
  assert.equal(governedFailedRequeuePreview.result.wouldUpdate.telegramOutboxStatus, "delivering_then_sent_or_failed");
  assert.equal(governedFailedRequeuePreview.result.executionPolicy.evidencePresence.requeueOperatorReason, true);
  assert.equal(governedFailedRequeuePreview.result.executionPolicy.evidencePresence.catClawAudit, true);
  assert.equal(governedFailedRequeuePreview.result.deliveryPreview.executionPolicy.evidencePresence.deliveryOperatorReason, true);
  const requeuePackagePreview = await gateway.handle({
    action: "telegram.outbox.requeue.execution_package.preview",
    actor: "flashcat",
    reason: "console failed requeue package preview",
    payload: {
      outboxId: "outbox-requeue-preview-failed",
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryApprovalId: "delivery-approval-preview-only",
      requeueOperatorReason: "explicit requeue package reason"
    }
  });
  assert.equal(requeuePackagePreview.ok, true);
  assert.equal(requeuePackagePreview.dryRun, true);
  assert.equal(requeuePackagePreview.result.schemaVersion, "telegram_outbox_requeue_execution_package_preview.v1");
  assert.equal(requeuePackagePreview.result.readOnly, true);
  assert.equal(requeuePackagePreview.result.writeBoundary, "preview_only");
  assert.equal(requeuePackagePreview.result.futureExecutionAction, "telegram.outbox.delivery");
  assert.equal(requeuePackagePreview.result.didWrite, false);
  assert.equal(requeuePackagePreview.result.didSendTelegram, false);
  assert.equal(requeuePackagePreview.result.didCreateHumanGate, false);
  assert.equal(requeuePackagePreview.result.didCreateOutbox, false);
  assert.equal(requeuePackagePreview.result.didTouchTradingState, false);
  assert.equal(requeuePackagePreview.result.readyForCatClawReview, true);
  assert.equal(requeuePackagePreview.result.readyForExecutionRequest, true);
  assert.equal(requeuePackagePreview.result.package.options.length, 3);
  assert.deepEqual(requeuePackagePreview.result.package.options.map((row) => row.optionId), ["A", "B", "C"]);
  assert.equal(Boolean(requeuePackagePreview.result.package.controls.some((row) => row.controlId === "pause_workflow" && row.buttonStyle === "primary")), true);
  assert.equal(Boolean(requeuePackagePreview.result.package.controls.some((row) => row.controlId === "terminate_workflow" && row.buttonStyle === "danger")), true);
  assert.equal(requeuePackagePreview.result.auditBoundary.noParallelHumanGate, true);
  assert.equal(requeuePackagePreview.result.auditBoundary.noParallelOutbox, true);
  assert.equal(requeuePackagePreview.result.package.packageTextZh.includes("Telegram outbox 重投递执行前确认包"), true);
  assert.equal(requeuePackagePreview.result.package.packageTextZh.includes("猫爪"), true);
  assert.equal(JSON.stringify(requeuePackagePreview).includes("requeue-secret"), false);
  const directRequeuePackagePreview = await runAction(root, {
    action: "telegram.outbox.requeue.execution_package.preview",
    outboxId: "outbox-requeue-preview-failed",
    catClawAuditId: "audit-console-dead-letter-link",
    deliveryApprovalId: "delivery-approval-preview-only",
    requeueOperatorReason: "explicit direct requeue package reason"
  });
  assert.equal(directRequeuePackagePreview.schemaVersion, "telegram_outbox_requeue_execution_package_preview.v1");
  assert.equal(directRequeuePackagePreview.readOnly, true);
  assert.equal(directRequeuePackagePreview.readyForExecutionRequest, true);
  const aliasRequeuePackagePreview = await gateway.handle({
    action: "workflow.telegram.outbox.requeue.package.preview",
    actor: "flashcat",
    reason: "console alias requeue package preview",
    payload: {
      outboxId: "outbox-requeue-preview-failed",
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryApprovalId: "delivery-approval-preview-only",
      requeueOperatorReason: "explicit alias requeue package reason"
    }
  });
  assert.equal(aliasRequeuePackagePreview.ok, true);
  assert.equal(aliasRequeuePackagePreview.errorCode, undefined);
  assert.equal(aliasRequeuePackagePreview.action, "telegram.outbox.requeue.execution_package.preview");
  assert.equal(aliasRequeuePackagePreview.result.schemaVersion, "telegram_outbox_requeue_execution_package_preview.v1");
  assert.equal(aliasRequeuePackagePreview.result.readyForExecutionRequest, true);
  const staleRequeuePreview = await gateway.handle({
    action: "telegram.outbox.requeue.preview",
    actor: "flashcat",
    reason: "console stale requeue preview",
    payload: {
      outboxId: "outbox-requeue-preview-stale",
      catClawAuditId: "audit-console-dead-letter-link",
      requeueOperatorReason: "explicit stale requeue reason"
    }
  });
  assert.equal(staleRequeuePreview.ok, true);
  assert.equal(staleRequeuePreview.result.requeueEligible, true);
  assert.equal(staleRequeuePreview.result.strategy, "reclaim_stale_delivery_lease");
  assert.equal(staleRequeuePreview.result.governanceReady, true);
  assert.equal(Boolean(staleRequeuePreview.result.warnings.some((row) => row.code === "stale_delivery_lease")), true);
  const freshRequeuePreview = await gateway.handle({
    action: "telegram.outbox.requeue.preview",
    actor: "flashcat",
    reason: "console fresh delivery requeue preview",
    payload: {
      outboxId: "outbox-requeue-preview-fresh",
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryOperatorReason: "explicit fresh delivery reason"
    }
  });
  assert.equal(freshRequeuePreview.ok, true);
  assert.equal(freshRequeuePreview.result.requeueEligible, false);
  assert.equal(freshRequeuePreview.result.strategy, "wait_for_active_delivery_lease");
  assert.equal(Boolean(freshRequeuePreview.result.violations.some((row) => row.code === "delivery_lease_active")), true);
  const sentRequeuePreview = await gateway.handle({
    action: "telegram.outbox.requeue.preview",
    actor: "flashcat",
    reason: "console sent requeue preview",
    payload: {
      outboxId: "outbox-requeue-preview-sent",
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryOperatorReason: "explicit sent delivery reason"
    }
  });
  assert.equal(sentRequeuePreview.ok, true);
  assert.equal(sentRequeuePreview.result.requeueEligible, false);
  assert.equal(sentRequeuePreview.result.strategy, "terminal_sent_idempotent_replay_only");
  assert.equal(sentRequeuePreview.result.wouldResendTelegram, false);
  assert.deepEqual({
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    events: sqliteCount(dbFile, "workflow_events"),
    protocolObjects: sqliteCount(dbFile, "protocol_objects"),
    humanGateButtons: sqliteCount(dbFile, "human_gate_buttons"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger")
  }, requeuePreviewCountsBefore);
  const requeueStatusRows = sqliteJson(dbFile, `
SELECT outbox_id AS outboxId, status
FROM telegram_outbox
WHERE outbox_id LIKE 'outbox-requeue-preview-%'
ORDER BY outbox_id;`);
  assert.deepEqual(requeueStatusRows.map((row) => row.status), ["failed", "delivering", "sent", "delivering"]);
  const gatewayTelegramDeliveryGovernedReady = await gateway.handle({
    action: "telegram.outbox.delivery.preview",
    actor: "flashcat",
    reason: "console telegram governed delivery preview",
    payload: {
      outboxId: gatewayCloseoutHumanGateWrite.result.telegramOutboxId,
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryApprovalId: "delivery-approval-preview-only",
      deliveryOperatorReason: "explicit delivery execution reason"
    }
  });
  assert.equal(gatewayTelegramDeliveryGovernedReady.ok, true);
  assert.equal(gatewayTelegramDeliveryGovernedReady.result.executionPolicy.governanceReady, true);
  assert.equal(gatewayTelegramDeliveryGovernedReady.result.executionPolicy.evidencePresence.deliveryOperatorReason, true);
  assert.equal(gatewayTelegramDeliveryGovernedReady.result.executionPolicy.evidencePresence.catClawAudit, true);
  assert.equal(gatewayTelegramDeliveryGovernedReady.result.didSendTelegram, undefined);
  assert.equal(sqliteJson(dbFile, `
SELECT status, payload_json LIKE '%deliveryClaim%' AS hasClaim
FROM telegram_outbox
WHERE outbox_id='${gatewayCloseoutHumanGateWrite.result.telegramOutboxId}'
LIMIT 1;`)[0].status, "queued");
  const fakeTelegramBin = path.join(root, "fake-openclaw-telegram.mjs");
  await fs.writeFile(fakeTelegramBin, [
    "#!/usr/bin/env node",
    "console.log(JSON.stringify({ ok: true, payload: { ok: true, provider: 'fake-openclaw', message_id: 'fake-message-id' } }));",
    ""
  ].join("\n"), "utf8");
  await fs.chmod(fakeTelegramBin, 0o755);
  const deliveryExecutionWorkflowId = `${workflowId}-delivery-exec-clean`;
  const deliveryExecutionOutboxId = "outbox-delivery-exec-clean";
  const deliveryExecutionCreatedAt = new Date().toISOString();
  sqliteExec(dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES ('${deliveryExecutionWorkflowId}', 'regression', 'running', 'main', 'Telegram delivery execution regression', 'Verify governed Telegram delivery execution.', 'Delivery writes terminal outbox receipt only.', 'manual stop', 'delivery', '', '{}', '${deliveryExecutionCreatedAt}', '${deliveryExecutionCreatedAt}');
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES ('${deliveryExecutionOutboxId}', '${deliveryExecutionWorkflowId}', 'private', '8390724843', 'human_gate_request', 'queued', 'delivery execution regression text', '{"account":"cat_claw","buttons":[{"optionId":"A"},{"optionId":"B"},{"optionId":"C"},{"control":"pause"},{"control":"terminate"}]}', '${deliveryExecutionCreatedAt}', '${deliveryExecutionCreatedAt}');`);
  const deliveryExecutionBlockedEventsBefore = sqliteCount(dbFile, "workflow_events");
  const gatewayTelegramDeliveryBlocked = await writeGateway.handle({
    action: "telegram.outbox.delivery",
    actor: "flashcat",
    reason: "console delivery execution without explicit delivery reason",
    payload: {
      workflowId: deliveryExecutionWorkflowId,
      outboxId: deliveryExecutionOutboxId,
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryApprovalId: "delivery-approval-preview-only",
      openclawBin: fakeTelegramBin
    }
  });
  assert.equal(gatewayTelegramDeliveryBlocked.ok, false);
  assert.equal(gatewayTelegramDeliveryBlocked.errorCode, "action_failed");
  assert.match(gatewayTelegramDeliveryBlocked.message, /delivery_operator_reason_required/);
  assert.equal(sqliteCount(dbFile, "workflow_events"), deliveryExecutionBlockedEventsBefore);
  const deliveryExecutionEventsBefore = sqliteCount(dbFile, "workflow_events");
  const gatewayTelegramDeliveryExecuted = await writeGateway.handle({
    action: "telegram.outbox.delivery",
    actor: "flashcat",
    reason: "console governed telegram delivery execution",
    payload: {
      workflowId: deliveryExecutionWorkflowId,
      outboxId: deliveryExecutionOutboxId,
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryApprovalId: "delivery-approval-preview-only",
      deliveryOperatorReason: "explicit delivery execution reason",
      openclawBin: fakeTelegramBin
    }
  });
  assert.equal(gatewayTelegramDeliveryExecuted.ok, true);
  assert.equal(gatewayTelegramDeliveryExecuted.dryRun, false);
  assert.equal(gatewayTelegramDeliveryExecuted.result.schemaVersion, "telegram_outbox_delivery_result.v1");
  assert.equal(gatewayTelegramDeliveryExecuted.result.writeBoundary, "telegram_delivery_only");
  assert.equal(gatewayTelegramDeliveryExecuted.result.didSendTelegram, true);
  assert.equal(gatewayTelegramDeliveryExecuted.result.didTouchTradingState, false);
  assert.equal(gatewayTelegramDeliveryExecuted.result.deliveryStatus, "sent");
  assert.equal(gatewayTelegramDeliveryExecuted.result.executionPolicy.previewOnly, false);
  assert.equal(gatewayTelegramDeliveryExecuted.result.receiptPolicy.deliveryReceiptRequired, true);
  const deliveredOutboxRow = sqliteJson(dbFile, `
SELECT status, payload_json AS payloadJson
FROM telegram_outbox
WHERE outbox_id='${deliveryExecutionOutboxId}'
LIMIT 1;`)[0];
  assert.equal(deliveredOutboxRow.status, "sent");
  assert.equal(JSON.parse(deliveredOutboxRow.payloadJson).delivery.channel, "telegram");
  assert.equal(sqliteCount(dbFile, "workflow_events"), deliveryExecutionEventsBefore + 1);
  const deliveryReplayEventsBefore = sqliteCount(dbFile, "workflow_events");
  const gatewayTelegramDeliveryReplay = await writeGateway.handle({
    action: "telegram.outbox.delivery",
    actor: "flashcat",
    reason: "console governed telegram delivery replay",
    payload: {
      workflowId: deliveryExecutionWorkflowId,
      outboxId: deliveryExecutionOutboxId,
      catClawAuditId: "audit-console-dead-letter-link",
      deliveryApprovalId: "delivery-approval-preview-only",
      deliveryOperatorReason: "explicit delivery execution reason",
      openclawBin: fakeTelegramBin
    }
  });
  assert.equal(gatewayTelegramDeliveryReplay.ok, true);
  assert.equal(gatewayTelegramDeliveryReplay.result.idempotentReplay, true);
  assert.equal(gatewayTelegramDeliveryReplay.result.didSendTelegram, false);
  assert.equal(sqliteCount(dbFile, "workflow_events"), deliveryReplayEventsBefore);
  const deliveryReadModel = new WorkflowReadModel({ dbFile });
  const deliveryOutboxView = await deliveryReadModel.outbox(deliveryExecutionWorkflowId);
  const deliveryOutboxReadRow = deliveryOutboxView.outbox.find((row) => row.outboxId === deliveryExecutionOutboxId);
  assert.ok(deliveryOutboxReadRow);
  assert.equal(deliveryOutboxReadRow.deliveryReceipt.receiptComplete, true);
  assert.equal(deliveryOutboxReadRow.deliveryReceipt.receiptState, "complete");
  assert.equal(deliveryOutboxReadRow.deliveryReceipt.receiptCount, 1);
  const deliveryReceiptsView = await deliveryReadModel.receipts(deliveryExecutionWorkflowId);
  const deliveryReceiptRow = deliveryReceiptsView.receipts.find((row) => row.kind === "telegram_outbox" && row.outboxId === deliveryExecutionOutboxId);
  assert.ok(deliveryReceiptRow);
  assert.equal(deliveryReceiptRow.present, true);
  assert.equal(deliveryReceiptRow.deliveryReceipt.receiptComplete, true);
  const deliveryReadiness = await deliveryReadModel.humanGateReadiness(deliveryExecutionWorkflowId);
  assert.equal(deliveryReadiness.summary.sentOutboxCompleteReceiptCount, 1);
  assert.equal(deliveryReadiness.delivery.sentCompleteReceipt, 1);
  const deliveryOperations = await deliveryReadModel.operationsSummary({ workflowId: deliveryExecutionWorkflowId });
  assert.equal(deliveryOperations.deliveryExecutions.length >= 2, true);
  assert.equal(Boolean(deliveryOperations.deliveryExecutions.some((row) => row.outboxId === deliveryExecutionOutboxId && row.deliveryStatus === "sent" && row.didSendTelegram)), true);
  assert.equal(Boolean(deliveryOperations.deliveryExecutions.some((row) => row.outboxId === deliveryExecutionOutboxId && row.idempotentReplay)), true);
  const deliveryPack = await deliveryReadModel.evidencePack(deliveryExecutionWorkflowId, { limit: 80 });
  assert.equal(deliveryPack.manifest.deliveryExecutionCount >= 2, true);
  assert.equal(Boolean(deliveryPack.operations.deliveryExecutions.some((row) => row.outboxId === deliveryExecutionOutboxId)), true);
  sqliteExec(dbFile, `
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-delivery-closeout', 'monitoring', 'delivery', '["telegram"]', 'Delivery closeout regression', 'main', 'Telegram delivery receipt audit', 'Delivery completed and should be visible for closeout.', '', 'rollback boundary recorded', 'terminal delivery receipt complete', '[]', '{"workflowId":"${deliveryExecutionWorkflowId}","createdByAction":"workflow.incident.from_dead_letter","operatorReason":"delivery closeout regression","catClawAuditId":"audit-console-dead-letter-link","incidentCandidate":{"rollbackBoundary":"rollback boundary recorded"}}', '${deliveryExecutionCreatedAt}', '', '', '${deliveryExecutionCreatedAt}');`);
  const deliveryCloseout = await deliveryReadModel.incidentCloseout(deliveryExecutionWorkflowId, { incidentId: "incident-delivery-closeout" });
  const deliveryCloseoutCheck = deliveryCloseout.checklist.find((row) => row.key === "telegram_delivery_receipt");
  assert.ok(deliveryCloseoutCheck);
  assert.equal(deliveryCloseoutCheck.status, "pass");
  const gatewayIncidentLinked = await writeGateway.handle({
    action: "workflow.incident.from_dead_letter",
    actor: "flashcat",
    reason: "console governed write token=gateway-incident-secret",
    payload: {
      workflowId,
      kind: "message_flow_delivery_missing",
      refId: "flow-dead-delivery-completed",
      humanGateId: "hg-console-dead-letter-link",
      catClawAuditId: "audit-console-dead-letter-link",
      operatorReason: "console governed write token=gateway-incident-secret"
    }
  });
  assert.equal(gatewayIncidentLinked.ok, true);
  assert.equal(gatewayIncidentLinked.result.writeBoundary, "incident_state_only");
  assert.equal(gatewayIncidentLinked.result.didRetryOrRepair, false);
  const gatewayIncidentRows = sqliteJson(dbFile, `
SELECT reason, result_json AS resultJson
FROM workflow_operations
WHERE operation_id='${gatewayIncidentLinked.operationId}'
LIMIT 1;`);
  assert.equal(gatewayIncidentRows.length, 1);
  assert.equal(JSON.stringify(gatewayIncidentRows[0]).includes("gateway-incident-secret"), false);
  const operationsWithBadQuery = await new WorkflowReadModel({ dbFile }).operationsSummary({
    workflowId,
    staleDispatchMinutes: "not-a-number",
    humanGateFeedbackHours: "also-bad",
    messageFlowStuckMinutes: "bad-message-flow-window"
  });
  assert.equal(operationsWithBadQuery.deadLetters.length >= 8, true);
  const messageFlowOnlyOperations = await new WorkflowReadModel({ dbFile }).operationsSummary({
    workflowId,
    deadLetterKind: "message_flow_delivery_missing"
  });
  assert.equal(messageFlowOnlyOperations.deadLetterFilter.totalBeforeFilter >= 8, true);
  assert.equal(messageFlowOnlyOperations.deadLetterFilter.totalAfterFilter, 3);
  assert.equal(messageFlowOnlyOperations.deadLetters.every((row) => row.kind === "message_flow_delivery_missing"), true);
  const failedStatusOperations = await new WorkflowReadModel({ dbFile }).operationsSummary({
    workflowId,
    deadLetterStatus: "failed"
  });
  assert.equal(failedStatusOperations.deadLetterFilter.totalAfterFilter, 3);
  assert.equal(failedStatusOperations.deadLetters.every((row) => row.status === "failed"), true);
  assert.equal(Boolean(failedStatusOperations.deadLetters.some((row) => row.kind === "control_loop_job")), true);
  assert.equal(Boolean(failedStatusOperations.deadLetters.some((row) => row.kind === "failed_dispatch")), true);
  assert.equal(Boolean(failedStatusOperations.deadLetters.some((row) => row.kind === "max_attempt_dispatch")), true);
  assert.equal(Boolean(failedStatusOperations.deadLetterAvailableStatuses.some((row) => row.status === "failed")), true);
  const genericLimitOperations = await new WorkflowReadModel({ dbFile }).operationsSummary({
    workflowId,
    limit: 1
  });
  assert.equal(genericLimitOperations.deadLetterFilter.limit, 200);
  assert.equal(genericLimitOperations.deadLetters.length >= 8, true);
  const warningOperations = await new WorkflowReadModel({ dbFile }).operationsSummary({
    workflowId,
    deadLetterSeverity: "warning",
    deadLetterLimit: 1
  });
  assert.equal(warningOperations.deadLetterFilter.totalAfterFilter >= 2, true);
  assert.equal(warningOperations.deadLetterFilter.returned, 1);
  assert.equal(warningOperations.deadLetters.length, 1);
  assert.equal(warningOperations.deadLetters[0].severity, "warning");
  assert.equal(
    warningOperations.deadLetterSummary.reduce((total, row) => total + Number(row.count || 0), 0),
    warningOperations.deadLetterFilter.totalAfterFilter
  );
  const legacyRoot = await tempRoot("workflow-operations-legacy");
  const legacyDbFile = path.join(legacyRoot, "tracking.db");
  sqliteExec(legacyDbFile, "CREATE TABLE legacy_marker(id TEXT PRIMARY KEY);");
  const legacyOperations = await new WorkflowReadModel({ dbFile: legacyDbFile }).operationsSummary({ workflowId: "missing" });
  assert.equal(legacyOperations.source, "workflow_scoped");
  assert.deepEqual(legacyOperations.controlLoopJobs, []);
  assert.deepEqual(legacyOperations.workflowOperations, []);
  assert.deepEqual(legacyOperations.deadLetters, []);
  assert.deepEqual(legacyOperations.telegramOutbox, []);
  const partialRoot = await tempRoot("workflow-operations-partial");
  const partialDbFile = path.join(partialRoot, "tracking.db");
  sqliteExec(partialDbFile, `
CREATE TABLE workflow_operations(operation_id TEXT, action TEXT, status TEXT);
INSERT INTO workflow_operations(operation_id, action, status)
VALUES ('legacy-op-1', 'workflow.supervise.preview', 'completed');`);
  const partialScoped = await new WorkflowReadModel({ dbFile: partialDbFile }).operationsSummary({ workflowId });
  assert.deepEqual(partialScoped.workflowOperations, []);
  const partialGlobal = await new WorkflowReadModel({ dbFile: partialDbFile }).operationsSummary();
  assert.equal(partialGlobal.workflowOperations[0].operationId, "legacy-op-1");
  assert.equal(partialGlobal.workflowOperations[0].workflowId, "");
  await runAction(partialRoot, {
    action: "workflow.run.upsert",
    workflowId: "wf-console-operations-partial",
    status: "active",
    summary: "Partial workflow operations migration"
  });
  const partialGateway = new WorkflowActionGateway({ root: partialRoot, dbFile: partialDbFile, bridgeDir: path.join(partialRoot, "bridge") }, { readOnly: true });
  const partialPreview = await partialGateway.handle({
    action: "workflow.supervise.preview",
    actor: "flashcat",
    reason: "partial schema token abc",
    payload: { workflowId: "wf-console-operations-partial" }
  });
  assert.equal(partialPreview.ok, true);
  const partialRows = sqliteJson(partialDbFile, `SELECT workflow_id AS workflowId, reason FROM workflow_operations WHERE operation_id = '${partialPreview.operationId}';`);
  assert.equal(partialRows[0].workflowId, "wf-console-operations-partial");
  assert.equal(partialRows[0].reason.includes("abc"), false);
}

async function testWorkflowInterventionPreviews() {
  const root = await tempRoot("workflow-intervention-preview");
  const dbFile = path.join(root, "tracking.db");
  const bridgeDir = path.join(root, "bridge");
  const workflowId = "wf-intervention-preview";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    phase: "research",
    summary: "Controlled intervention preview regression"
  });
  sqliteExec(dbFile, `
INSERT INTO workflow_phases(phase_id, workflow_id, phase_key, ordinal, status, owner_agent, owner_agents_json, depends_on_json, acceptance_criteria_json, verifier_agent, human_gate_required, plan_node_refs_json, payload_json, created_at, started_at, completed_at, updated_at)
VALUES ('phase-intervention-research', '${workflowId}', 'research', 1, 'in_progress', 'cat_body', '["cat_body"]', '[]', '["evidence present"]', 'cat_claw', 0, '[]', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '2026-05-31T00:00:02.000Z');
INSERT INTO workflow_tasks(task_id, workflow_id, parent_task_id, phase, owner_agent, runtime, agent_id, task_type, status, priority, depends_on_json, expected_artifact, actual_artifact_ref, receipt_required, human_gate_required, summary, prompt, payload_json, blocked_reason, created_by, created_at, due_at, started_at, completed_at, updated_at)
VALUES ('task-intervention-research', '${workflowId}', '', 'research', 'cat_body', 'hermes', 'cat_body', 'research', 'in_progress', 'normal', '[]', 'artifact://expected', '', 1, 0, 'Research task', 'Do research', '{}', '', 'main', '2026-05-31T00:00:00.000Z', '', '2026-05-31T00:00:01.000Z', '', '2026-05-31T00:00:02.000Z');
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES ('dispatch-intervention-agent', '${workflowId}', '${workflowId}', 'trace-intervention', 'idem-intervention', 'hermes', 'cat_body', 'hermes:cat_body', 'workflow_task', 'sent', 'normal', 1, 3, '', '', '', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2026-05-31T00:00:02.000Z');
INSERT INTO workflow_agent_runs(agent_run_id, workflow_id, phase_id, phase_key, task_id, dispatch_id, runtime_run_id, session_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref, error, payload_json, started_at, completed_at, created_at, updated_at)
VALUES ('agent-run-intervention', '${workflowId}', 'phase-intervention-research', 'research', 'task-intervention-research', 'dispatch-intervention-agent', 'runtime-run-intervention', '', 'hermes', 'cat_body', 'completed', 1, 'hash-in', 'hash-out', 'artifact://receipt-intervention', '', '{}', '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:03.000Z', '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:03.000Z');
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES ('checkpoint-intervention', '${workflowId}', 'active', 'research', 'dispatch_ready', 'Checkpoint before intervention preview', '{}', '[]', '[]', '[]', '[]', '{}', 'artifact://checkpoint-intervention', 'main', '2026-05-31T00:00:04.000Z');`);

  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { readOnly: true });
  const pause = await gateway.handle({
    action: "workflow.pause.preview",
    actor: "flashcat",
    reason: "preview pause token abc",
    payload: { workflowId }
  });
  assert.equal(pause.ok, true);
  assert.equal(pause.dryRun, true);
  assert.equal(pause.result.kind, "pause_workflow");
  assert.equal(pause.result.eligible, true);
  assert.equal(pause.result.wouldUpdateWorkflow.status, "paused");
  assert.equal(pause.result.humanGateRequired, true);
  assert.equal(pause.result.wouldAffect.activeDispatches, 1);

  const resume = await gateway.handle({
    action: "workflow.resume.preview",
    actor: "flashcat",
    reason: "preview resume",
    payload: { workflowId }
  });
  assert.equal(resume.ok, true);
  assert.equal(resume.result.kind, "resume_workflow");
  assert.equal(resume.result.eligible, false);
  assert.equal(Boolean(resume.result.violations.some((item) => item.code === "resume_invalid_status")), true);

  const rerunPhase = await gateway.handle({
    action: "workflow.rerun.phase.preview",
    actor: "flashcat",
    reason: "preview rerun phase",
    payload: { workflowId, phaseKey: "research" }
  });
  assert.equal(rerunPhase.ok, true);
  assert.equal(rerunPhase.result.kind, "rerun_phase");
  assert.equal(rerunPhase.result.eligible, true);
  assert.equal(rerunPhase.result.wouldAffect.targetPhases, 1);

  const rerunAgent = await gateway.handle({
    action: "workflow.rerun.agent.preview",
    actor: "flashcat",
    reason: "preview rerun agent",
    payload: { workflowId, agentId: "cat_body" }
  });
  assert.equal(rerunAgent.ok, true);
  assert.equal(rerunAgent.result.kind, "rerun_agent");
  assert.equal(rerunAgent.result.eligible, true);
  assert.equal(rerunAgent.result.wouldAffect.targetAgentRuns, 1);

  const rejectedWrite = await gateway.handle({
    action: "workflow.stop",
    actor: "flashcat",
    reason: "real stop remains disabled",
    payload: { workflowId }
  });
  assert.equal(rejectedWrite.ok, false);
  assert.equal(rejectedWrite.errorCode, "action_not_allowed");
  const rows = sqliteJson(dbFile, `
SELECT action, status, dry_run AS dryRun, preview_result_json AS previewResultJson, reason
FROM workflow_operations
WHERE workflow_id='${workflowId}'
ORDER BY created_at ASC;`);
  assert.equal(rows.filter((row) => row.action.endsWith(".preview") && row.status === "completed" && row.dryRun === 1).length, 4);
  assert.equal(Boolean(rows.some((row) => row.action === "workflow.stop" && row.status === "rejected")), true);
  assert.equal(rows.some((row) => row.reason.includes("abc")), false);
  const workflowRows = sqliteJson(dbFile, `SELECT status FROM workflow_runs WHERE workflow_id='${workflowId}';`);
  assert.equal(workflowRows[0].status, "active");
}

async function testWorkflowInterventionExecution() {
  const root = await tempRoot("workflow-intervention-execution");
  const bridgeDir = path.join(root, "bridge");
  const workflowId = "workflow-intervention-execute";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    ownerAgent: "main",
    summary: "Intervention execution regression",
    objective: "Verify governed pause/resume/stop execution."
  });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES ('checkpoint-intervention-execute', '${workflowId}', 'active', 'research', 'dispatch_ready', 'Checkpoint before real intervention', '{}', '[]', '[]', '[]', '[]', '{}', 'artifact://checkpoint-intervention-execute', 'main', '2026-05-31T00:00:04.000Z');
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES ('dispatch-intervention-execute', '${workflowId}', '${workflowId}', 'trace-intervention-execute', 'idem-intervention-execute-dispatch', 'hermes', 'cat_body', 'hermes:cat_body', 'workflow_task', 'sent', 'normal', 1, 3, '', '', '', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2026-05-31T00:00:02.000Z');`);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.pause",
      workflowId,
      operatorReason: "missing policy evidence",
      rollbackBoundary: "artifact://checkpoint-intervention-execute"
    }),
    /workflow policy blocked: action=workflow\.pause policyOutcome=requires_human_gate/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.resume",
      workflowId,
      humanGateId: "hg-intervention-execute",
      catClawAuditId: "audit-intervention-execute",
      operatorReason: "resume from invalid status",
      rollbackBoundary: "artifact://checkpoint-intervention-execute"
    }),
    /workflow intervention not eligible: action=workflow\.resume violations=resume_invalid_status/
  );

  const pause = await runAction(root, {
    action: "workflow.pause",
    workflowId,
    traceId: "trace-intervention-pause",
    humanGateId: "hg-intervention-execute",
    catClawAuditId: "audit-intervention-execute",
    actor: "flashcat",
    operatorReason: "pause token abc before review",
    rollbackBoundary: "artifact://checkpoint-intervention-execute",
    idempotencyKey: "idem-intervention-pause"
  });
  assert.equal(pause.status, "executed");
  assert.equal(pause.previousStatus, "active");
  assert.equal(pause.nextStatus, "paused");
  assert.equal(pause.affected.dispatches, 0);
  let workflowRow = sqliteJson(dbFile, `SELECT status, current_decision AS currentDecision FROM workflow_runs WHERE workflow_id='${workflowId}' LIMIT 1;`)[0];
  assert.equal(workflowRow.status, "paused");
  assert.equal(workflowRow.currentDecision, "pause_workflow_executed");

  const resume = await runAction(root, {
    action: "workflow.resume",
    workflowId,
    traceId: "trace-intervention-resume",
    humanGateId: "hg-intervention-execute",
    catClawAuditId: "audit-intervention-execute",
    actor: "flashcat",
    operatorReason: "resume after review",
    rollbackBoundary: "artifact://checkpoint-intervention-execute",
    idempotencyKey: "idem-intervention-resume"
  });
  assert.equal(resume.status, "executed");
  assert.equal(resume.previousStatus, "paused");
  assert.equal(resume.nextStatus, "active");

  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { readOnly: false, allowWrites: true });
  const stop = await gateway.handle({
    action: "workflow.stop",
    actor: "flashcat",
    reason: "stop token abc after final review",
    payload: {
      workflowId,
      traceId: "trace-intervention-stop",
      humanGateId: "hg-intervention-execute",
      catClawAuditId: "audit-intervention-execute",
      rollbackBoundary: "artifact://checkpoint-intervention-execute"
    }
  });
  assert.equal(stop.ok, true);
  assert.equal(stop.dryRun, false);
  assert.equal(stop.result.nextStatus, "stopped");
  workflowRow = sqliteJson(dbFile, `SELECT status, current_decision AS currentDecision FROM workflow_runs WHERE workflow_id='${workflowId}' LIMIT 1;`)[0];
  assert.equal(workflowRow.status, "stopped");
  assert.equal(workflowRow.currentDecision, "stop_workflow_executed");

  const dispatchRow = sqliteJson(dbFile, `SELECT status FROM mixed_meeting_dispatches WHERE dispatch_id='dispatch-intervention-execute' LIMIT 1;`)[0];
  assert.equal(dispatchRow.status, "sent");
  const eventRows = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, payload_json AS payloadJson
FROM workflow_events
WHERE workflow_id='${workflowId}'
  AND event_type='workflow.intervention.executed'
ORDER BY created_at ASC;`);
  assert.equal(eventRows.length, 3);
  assert.equal(eventRows.some((row) => row.payloadJson.includes("abc")), false);
  const operationRow = sqliteJson(dbFile, `
SELECT action, status, dry_run AS dryRun, preview_result_json AS previewResultJson, result_json AS resultJson, reason
FROM workflow_operations
WHERE workflow_id='${workflowId}' AND action='workflow.stop'
LIMIT 1;`)[0];
  assert.equal(operationRow.status, "completed");
  assert.equal(operationRow.dryRun, 0);
  assert.equal(operationRow.previewResultJson, "{}");
  assert.equal(operationRow.resultJson.includes("\"nextStatus\":\"stopped\""), true);
  assert.equal(operationRow.reason.includes("abc"), false);

  const readOnlyGateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { readOnly: true, allowWrites: true });
  const readOnlyStop = await readOnlyGateway.handle({
    action: "workflow.stop",
    actor: "flashcat",
    reason: "read-only stop blocked",
    payload: { workflowId, humanGateId: "hg", catClawAuditId: "audit", rollbackBoundary: "artifact://checkpoint" }
  });
  assert.equal(readOnlyStop.ok, false);
  assert.equal(readOnlyStop.errorCode, "console_readonly");

  const terminateWorkflowId = "workflow-intervention-terminate-alias";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId: terminateWorkflowId,
    status: "active",
    ownerAgent: "main",
    summary: "Terminate alias regression"
  });
  const terminateAlias = await runAction(root, {
    action: "workflow.terminate",
    workflowId: terminateWorkflowId,
    humanGateId: "hg-intervention-terminate",
    catClawAuditId: "audit-intervention-terminate",
    operatorReason: "terminate alias with evidence",
    rollbackBoundary: "artifact://checkpoint-intervention-terminate",
    idempotencyKey: "idem-intervention-terminate"
  });
  assert.equal(terminateAlias.kind, "stop_workflow");
  assert.equal(terminateAlias.nextStatus, "stopped");
  const terminateRow = sqliteJson(dbFile, `SELECT status, current_decision AS currentDecision FROM workflow_runs WHERE workflow_id='${terminateWorkflowId}' LIMIT 1;`)[0];
  assert.equal(terminateRow.status, "stopped");
  assert.equal(terminateRow.currentDecision, "stop_workflow_executed");
}

async function testWorkflowVerificationResults() {
  const root = await tempRoot("workflow-verification");
  const workflowId = "workflow-verification-regression";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    phase: "verify",
    acceptanceCriteria: "Verifier/refuter evidence is recorded without mutating workflow state.",
    summary: "Workflow verification regression"
  });
  const verifier = await runAction(root, {
    action: "workflow.verification.record",
    verificationId: "verification-pass-regression",
    workflowId,
    phaseKey: "verify",
    taskId: "task-verify",
    agentRunId: "agent-run-verify",
    resultType: "verifier",
    decision: "pass",
    callerAgent: "local_codex",
    verifierAgent: "cat_claw",
    sourceRuntime: "openclaw",
    sourceAgent: "cat_claw",
    confidence: "high",
    riskBand: "low",
    summary: "验收通过，token abc 不应泄漏。",
    findings: ["证据完整", "callback token should redact"],
    recommendations: ["允许进入猫爪复核"],
    evidenceRefs: ["artifact://evidence-verification", "artifact://token abc"],
    artifactRefs: ["artifact://artifact-verification"],
    receiptRefs: ["artifact://receipt-verification"],
    payload: {
      callbackToken: "secret-callback-token",
      command: "/hgate tawhg:verification-secret approve",
      nested: { apiKey: "secret-api-key" }
    },
    createdBy: "cat_claw"
  });
  assert.equal(verifier.verificationId, "verification-pass-regression");
  assert.equal(verifier.decision, "pass");
  assert.equal(verifier.resultType, "verifier");

  const refuter = await runAction(root, {
    action: "workflow.verifier_refuter.record",
    verificationId: "verification-refuter-regression",
    workflowId,
    phaseKey: "verify",
    resultType: "refuter",
    decision: "uncertain",
    callerAgent: "local_codex",
    refuterAgent: "cat_heart",
    summary: "反证未发现阻断项。",
    findings: ["未发现反证"],
    createdBy: "cat_heart"
  });
  assert.equal(refuter.resultType, "refuter");
  assert.equal(refuter.decision, "uncertain");

  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "verifier_bot",
    displayName: "Verifier Bot",
    capabilities: { permissions: ["workflow.verify"] }
  });
  await runAction(root, {
    action: "workflow.verification.record",
    verificationId: "verification-spoof-regression",
    workflowId,
    phaseKey: "verify",
    resultType: "verifier",
    decision: "pass",
    callerAgent: "verifier_bot",
    callerRuntime: "hermers",
    verifierAgent: "cat_claw",
    sourceAgent: "cat_claw",
    createdBy: "cat_claw",
    summary: "Registered verifier must not spoof cat_claw attribution."
  });

  const dbFile = path.join(root, "tracking.db");
  const rows = sqliteJson(dbFile, `
SELECT verification_id AS verificationId, result_type AS resultType, decision, verifier_agent AS verifierAgent, source_agent AS sourceAgent, created_by AS createdBy, summary, evidence_refs_json AS evidenceRefsJson, payload_json AS payloadJson
FROM workflow_verification_results
WHERE workflow_id='${workflowId}'
ORDER BY created_at ASC;`);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].verificationId, "verification-pass-regression");
  assert.equal(rows[0].payloadJson.includes("secret-callback-token"), false);
  assert.equal(rows[0].payloadJson.includes("verification-secret"), false);
  assert.equal(rows[0].payloadJson.includes("secret-api-key"), false);
  assert.equal(rows[0].summary.includes("abc"), false);
  assert.equal(rows[0].evidenceRefsJson.includes("abc"), false);
  const spoofRow = rows.find((row) => row.verificationId === "verification-spoof-regression");
  assert.equal(spoofRow.verifierAgent, "verifier_bot");
  assert.equal(spoofRow.sourceAgent, "verifier_bot");
  assert.equal(spoofRow.createdBy, "verifier_bot");
  assert.equal(sqliteJson(dbFile, `SELECT status FROM workflow_runs WHERE workflow_id='${workflowId}';`)[0].status, "active");

  const view = await new WorkflowReadModel({ dbFile }).verification(workflowId);
  assert.equal(view.source, "workflow_verification_results");
  assert.equal(view.count, 3);
  assert.equal(view.summary.byDecision.pass, 2);
  assert.equal(view.summary.byDecision.uncertain, 1);
  assert.equal(JSON.stringify(view).includes("abc"), false);
  assert.equal(JSON.stringify(view).includes("secret-callback-token"), false);
  assert.equal(JSON.stringify(view).includes("verification-secret"), false);
  const routeView = await workflowChildPayload(new WorkflowReadModel({ dbFile }), workflowId, "verification");
  assert.equal(routeView.count, 3);
  const verificationListAlias = await runAction(root, {
    action: "workflow.verifications",
    workflowId,
    limit: 10
  });
  assert.equal(verificationListAlias.count, 3);
  assert.equal(Boolean(verificationListAlias.results.some((row) => row.verification_id === "verification-pass-regression")), true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.verification.record",
      verificationId: "verification-pass-regression",
      workflowId,
      callerAgent: "local_codex",
      resultType: "verifier",
      decision: "pass"
    }),
    /already exists/
  );
  sqliteExec(dbFile, "DROP TABLE workflow_verification_results;");
  sqliteExec(dbFile, "CREATE TABLE workflow_verification_results (verification_id TEXT PRIMARY KEY, workflow_id TEXT);");
  sqliteExec(dbFile, `INSERT INTO workflow_verification_results(verification_id, workflow_id) VALUES ('partial-verification', '${workflowId}');`);
  const partialView = await new WorkflowReadModel({ dbFile }).verification(workflowId);
  assert.equal(partialView.source, "workflow_verification_results");
  assert.equal(partialView.count, 1);
  assert.equal(partialView.results[0].verificationId, "partial-verification");
}

async function testControlLoopJobRequeue() {
  const root = await tempRoot("control-loop-job-requeue");
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId: "wf-job-requeue",
    status: "active",
    summary: "Control loop job requeue regression"
  });
  const dbFile = path.join(root, "tracking.db");
  const bridgeDir = path.join(root, "bridge");
  sqliteExec(dbFile, `
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at)
VALUES
  ('job-requeue-failed', 'runtime_drain', 'runtime_drain:hermers:job-requeue-failed', 'high', 'failed', 'wf-job-requeue', 'hermers', '{"dispatchId":"dispatch-requeue-failed","token":"payload-secret"}', '{"error":"result token result-secret"}', 3, 5, '2026-05-31T00:00:00.000Z', '', '', 'failed token job-secret', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:02.000Z'),
  ('job-requeue-expired', 'message_flow_reconcile', 'message_flow_reconcile:expired', 'normal', 'running', 'wf-job-requeue', '', '{}', '{}', 2, 5, '2026-05-31T00:00:00.000Z', 'worker-expired', '2000-01-01T00:00:00.000Z', 'lease token lease-secret', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', ''),
  ('job-requeue-fresh', 'message_flow_reconcile', 'message_flow_reconcile:fresh', 'normal', 'running', 'wf-job-requeue', '', '{}', '{}', 1, 5, '2026-05-31T00:00:00.000Z', 'worker-fresh', '2999-01-01T00:00:00.000Z', 'fresh lease', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', ''),
  ('job-requeue-conflict-failed', 'runtime_drain', 'runtime_drain:conflict', 'high', 'failed', 'wf-job-requeue', 'hermers', '{}', '{}', 3, 5, '2026-05-31T00:00:00.000Z', '', '', 'conflict failed', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', ''),
  ('job-requeue-conflict-active', 'runtime_drain', 'runtime_drain:conflict', 'high', 'queued', 'wf-job-requeue', 'hermers', '{}', '{}', 0, 5, '2026-05-31T00:00:00.000Z', '', '', '', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '');
`);

  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir });
  const gatewayPreview = await gateway.handle({
    action: "workflow.control_loop.job.requeue.preview",
    actor: "flashcat",
    reason: "preview control loop job requeue token=preview-secret",
    payload: {
      workflowId: "wf-job-requeue",
      jobId: "job-requeue-failed",
      requeueOperatorReason: "operator reason"
    }
  });
  assert.equal(gatewayPreview.ok, true);
  assert.equal(gatewayPreview.dryRun, true);
  assert.equal(gatewayPreview.result.schemaVersion, "workflow_control_loop_job_requeue_preview.v1");
  assert.equal(gatewayPreview.result.eligible, true);
  assert.equal(JSON.stringify(gatewayPreview).includes("preview-secret"), false);
  assert.equal(JSON.stringify(gatewayPreview).includes("job-secret"), false);

  const notAllowed = await gateway.handle({
    action: "workflow.control_loop.job.requeue",
    actor: "flashcat",
    reason: "console write should require allowWrites",
    payload: { workflowId: "wf-job-requeue", jobId: "job-requeue-failed", operatorReason: "manual requeue" }
  });
  assert.equal(notAllowed.ok, false);
  assert.equal(notAllowed.errorCode, "action_not_allowed");

  const noReasonPreview = await runAction(root, {
    action: "workflow.control_loop.job.requeue.preview",
    workflowId: "wf-job-requeue",
    jobId: "job-requeue-failed"
  });
  assert.equal(noReasonPreview.eligible, true);
  assert.equal(noReasonPreview.governanceReady, false);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.control_loop.job.requeue",
      workflowId: "wf-job-requeue",
      jobId: "job-requeue-failed"
    }),
    /operatorReason is required/
  );

  await runAction(root, {
    action: "workflow.event.append",
    workflowId: "wf-job-requeue",
    eventType: "test.idempotency_conflict_seed",
    status: "recorded",
    idempotencyKey: "user-conflict",
    payload: { note: "existing event should not block job requeue" }
  });
  const requeued = await runAction(root, {
    action: "workflow.control_loop.job.requeue",
    workflowId: "wf-job-requeue",
    jobId: "job-requeue-failed",
    idempotencyKey: "user-conflict",
    operatorReason: "retry after transient worker failure token=operator-secret",
    callerAgent: "local_codex",
    callerRuntime: "local_codex"
  });
  assert.equal(requeued.schemaVersion, "workflow_control_loop_job_requeue_result.v1");
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.didRunJob, false);
  assert.equal(requeued.didDispatchAgent, false);
  const failedRow = sqliteJson(dbFile, `
SELECT status, attempt, next_run_at AS nextRunAt, lease_owner AS leaseOwner, lease_until AS leaseUntil,
  last_error AS lastError, completed_at AS completedAt, result_json AS resultJson, payload_json AS payloadJson
FROM control_loop_jobs
WHERE job_id='job-requeue-failed'
LIMIT 1;`)[0];
  assert.equal(failedRow.status, "queued");
  assert.equal(failedRow.attempt, 0);
  assert.equal(failedRow.leaseOwner, "");
  assert.equal(failedRow.leaseUntil, "");
  assert.equal(failedRow.lastError, "");
  assert.equal(failedRow.completedAt, "");
  assert.equal(failedRow.resultJson, "{}");
  assert.equal(failedRow.payloadJson.includes("job-secret"), false);
  assert.equal(failedRow.payloadJson.includes("result-secret"), false);
  assert.equal(failedRow.payloadJson.includes("operator-secret"), false);
  assert.equal(failedRow.payloadJson.includes("payload-secret"), false);
  const failedPayload = JSON.parse(failedRow.payloadJson);
  assert.equal(Array.isArray(failedPayload.requeueHistory), true);
  assert.equal(failedPayload.requeueHistory.length, 1);
  assert.equal(failedPayload.requeueHistory[0].previous.status, "failed");
  assert.equal(failedPayload.requeue.reason.includes("[redacted]"), true);

  const expiredRequeued = await runAction(root, {
    action: "workflow.control-loop.job.requeue",
    workflowId: "wf-job-requeue",
    jobId: "job-requeue-expired",
    resetAttempt: 1,
    operatorReason: "expired lease reclaim"
  });
  assert.equal(expiredRequeued.previousStatus, "running");
  const expiredRow = sqliteJson(dbFile, `
SELECT status, attempt, lease_owner AS leaseOwner, lease_until AS leaseUntil, last_error AS lastError
FROM control_loop_jobs
WHERE job_id='job-requeue-expired'
LIMIT 1;`)[0];
  assert.deepEqual(expiredRow, {
    status: "queued",
    attempt: 1,
    leaseOwner: "",
    leaseUntil: "",
    lastError: ""
  });

  const freshPreview = await runAction(root, {
    action: "control_loop.job.requeue.preview",
    workflowId: "wf-job-requeue",
    jobId: "job-requeue-fresh",
    operatorReason: "fresh lease should not be stolen"
  });
  assert.equal(freshPreview.eligible, false);
  assert.equal(Boolean(freshPreview.violations.some((row) => row.code === "status_not_requeueable")), true);

  const conflictPreview = await runAction(root, {
    action: "workflow.job.requeue.preview",
    workflowId: "wf-job-requeue",
    jobId: "job-requeue-conflict-failed",
    operatorReason: "conflict should block"
  });
  assert.equal(conflictPreview.eligible, false);
  assert.equal(Boolean(conflictPreview.violations.some((row) => row.code === "active_dedupe_conflict")), true);

  const events = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, workflow_id AS workflowId, payload_json AS payloadJson
FROM workflow_events
WHERE event_type='control_loop.job.requeued'
ORDER BY created_at;`);
  assert.equal(events.length, 2);
  assert.equal(events.every((row) => row.status === "queued"), true);
  assert.equal(events.every((row) => row.workflowId === "wf-job-requeue"), true);
  assert.equal(JSON.stringify(events).includes("operator-secret"), false);
}

async function testWorkflowEvaluatorEvidence() {
  const root = await tempRoot("workflow-evaluator");
  const workflowId = "workflow-evaluator-regression";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    acceptanceCriteria: "All tasks are done, evidence exists, and verifier passes.",
    summary: "Workflow evaluator regression",
    payload: { planSpecV2: { objective: { acceptanceCriteria: ["done", "verified"] } } }
  });
  await runAction(root, {
    action: "workflow.task.create",
    workflowId,
    taskId: "task-evaluator-done",
    phase: "verify",
    status: "done",
    ownerAgent: "main",
    createdBy: "local_codex",
    summary: "Evaluator task done"
  });
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    acceptanceCriteria: "All tasks are done, evidence exists, and verifier passes.",
    payload: { planSpecV2: { objective: { acceptanceCriteria: ["done", "verified"] } } }
  });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES ('artifact-evaluator', '${workflowId}', 'evidence', 'artifact://evaluator', 'Evaluator evidence', 'local_codex', '2026-05-31T00:00:00.000Z');`);
  await runAction(root, {
    action: "workflow.verification.record",
    verificationId: "verification-evaluator-input",
    workflowId,
    phaseKey: "verify",
    resultType: "verifier",
    decision: "pass",
    callerAgent: "local_codex",
    sourceAgent: "cat_claw",
    summary: "Verifier pass."
  });
  const beforeEvaluatorCounts = {
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger")
  };
  const first = await runAction(root, {
    action: "workflow.evaluate",
    verificationId: "evaluation-met-regression",
    workflowId,
    phaseKey: "verify",
    callerAgent: "local_codex",
    evaluatorAgent: "main"
  });
  assert.equal(first.resultType, "evaluator");
  assert.equal(first.decision, "met");
  assert.equal(sqliteJson(dbFile, `SELECT status FROM workflow_runs WHERE workflow_id='${workflowId}';`)[0].status, "active");
  assert.equal(sqliteJson(dbFile, `SELECT status FROM workflow_tasks WHERE task_id='task-evaluator-done';`)[0].status, "done");
  assert.equal(sqliteCount(dbFile, "human_gate_buttons"), 0);
  assert.deepEqual({
    dispatches: sqliteCount(dbFile, "mixed_meeting_dispatches"),
    runtimeRuns: sqliteCount(dbFile, "runtime_runs"),
    outbox: sqliteCount(dbFile, "telegram_outbox"),
    sideEffects: sqliteCount(dbFile, "side_effect_ledger")
  }, beforeEvaluatorCounts);

  sqliteExec(dbFile, `
INSERT INTO side_effect_ledger(side_effect_id, workflow_id, side_effect_type, status, payload_json, created_at, updated_at)
VALUES ('side-effect-evaluator-uncertain', '${workflowId}', 'test', 'uncertain', '{}', '2026-05-31T00:01:00.000Z', '2026-05-31T00:01:00.000Z');`);
  const sideEffectsBeforeSecondEvaluation = sqliteCount(dbFile, "side_effect_ledger");
  const second = await runAction(root, {
    action: "workflow.evaluator.run",
    verificationId: "evaluation-side-effect-regression",
    workflowId,
    callerAgent: "local_codex",
    evaluatorAgent: "main"
  });
  assert.equal(second.resultType, "evaluator");
  assert.equal(second.decision, "side_effect_uncertain");
  assert.equal(sqliteCount(dbFile, "side_effect_ledger"), sideEffectsBeforeSecondEvaluation);
  assert.equal(sqliteCount(dbFile, "mixed_meeting_dispatches"), beforeEvaluatorCounts.dispatches);
  assert.equal(sqliteCount(dbFile, "runtime_runs"), beforeEvaluatorCounts.runtimeRuns);
  assert.equal(sqliteCount(dbFile, "telegram_outbox"), beforeEvaluatorCounts.outbox);

  const view = await new WorkflowReadModel({ dbFile }).verification(workflowId);
  assert.equal(view.summary.byType.evaluator, 2);
  assert.equal(view.summary.byDecision.met, 1);
  assert.equal(view.summary.byDecision.side_effect_uncertain, 1);
  const evaluatorPayload = view.results.find((row) => row.verificationId === "evaluation-met-regression")?.payload || {};
  assert.equal(evaluatorPayload.evaluator, "workflow_evaluator_v1");
  assert.equal(evaluatorPayload.snapshot.planSpecPresent, true);
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
  const tickStartedAt = Date.now();
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

async function testHumanGateEnsureSupersedesInvalidExistingButtons() {
  const root = await tempRoot("hgate-ensure-invalid-buttons");
  const request = await requestHumanGate(root);
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
UPDATE human_gate_buttons
SET payload_json='{"optionId":"A","title":"Invalid","summary":"Missing required Chinese details"}'
WHERE human_gate_id='${request.humanGateId}' AND decision_status='approved' AND button_role='approve_option'
ORDER BY created_at
LIMIT 1;`);

  const ensured = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    deliverOutbox: false,
    createHumanGateInbox: false
  });
  assert.equal(ensured.jobResults?.[0]?.jobType, "human_gate_request_ensure");
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${request.humanGateId}' AND status='active'`), 0);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${request.humanGateId}' AND status='superseded'`), 6);
  assert.equal(sqliteJson(dbFile, `SELECT status FROM telegram_outbox WHERE outbox_id='${request.telegramOutbox.outboxId}' LIMIT 1;`)[0]?.status, "cancelled");

  const recreated = await requestHumanGate(root);
  assert.equal(recreated.humanGateId, request.humanGateId);
  assert.equal(recreated.reusedStageGate, true);
  assertCompletePlanButtons(recreated);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${request.humanGateId}' AND status='active'`), 6);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${request.humanGateId}' AND status='superseded'`), 0);
  assert.equal(sqliteJson(dbFile, `SELECT status FROM telegram_outbox WHERE outbox_id='${request.telegramOutbox.outboxId}' LIMIT 1;`)[0]?.status, "queued");
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
    : mode === "inspect-ack"
    ? `#!/usr/bin/env node\nimport fs from "node:fs";\nimport path from "node:path";\nconst argv = process.argv.slice(2);\nconst valueAfter = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] || "" : ""; };\nfs.writeFileSync(path.join(process.cwd(), "ack-inspect.json"), JSON.stringify({ timeout: valueAfter("--timeout"), message: valueAfter("--message") }, null, 2));\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"ACK_RECEIVED\\nTimestamp: 2099-01-01T00:00:00.000Z\\nScope: complete dispatch received"}]}}));\n`
    : mode === "inspect-semantic"
    ? `#!/usr/bin/env node\nimport fs from "node:fs";\nimport path from "node:path";\nconst argv = process.argv.slice(2);\nconst valueAfter = (flag) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] || "" : ""; };\nfs.writeFileSync(path.join(process.cwd(), "semantic-inspect.json"), JSON.stringify({ timeout: valueAfter("--timeout"), message: valueAfter("--message") }, null, 2));\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"runtime bridge final output"}]}}));\n`
    : mode === "llm-failed"
    ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"LLM request failed."}]}}));\n`
    : mode === "llm-failed-leading-valid"
    ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"LLM request failed.\\nThis is a quoted upstream status, followed by valid semantic task output."}]}}));\n`
    : mode === "bad-ack"
    ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"runtime bridge final output without ack prefix"}]}}));\n`
    : mode === "embedded-ack"
    ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"I saw ACK_RECEIVED in the instructions, but this is not a first-line ACK."}]}}));\n`
    : mode === "empty-ack"
    ? `#!/usr/bin/env node\nconsole.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:""}]}}));\n`
    : mode === "slow-timeout"
    ? `#!/usr/bin/env node\nsetTimeout(() => console.log(JSON.stringify({status:"ok",runId:"fake-run",result:{payloads:[{text:"ACK_RECEIVED"}]}})), 20000);\n`
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

async function testMessageFlowImmediateAckContract() {
  const root = await tempRoot("message-flow-ack");
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
    body: "requires ack regression body",
    workflowId: "workflow-message-flow-ack",
    meetingId: "meeting-message-flow-ack",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const dispatchId = sent.dispatches[0].dispatchId;
  const dbFile = path.join(root, "tracking.db");
  const queued = sqliteJson(dbFile, `
SELECT max_attempts AS maxAttempts, payload_json AS payloadJson
FROM mixed_meeting_dispatches
WHERE dispatch_id='${dispatchId}'
LIMIT 1;`)[0];
  assert.equal(queued.maxAttempts, 3);
  const payload = JSON.parse(queued.payloadJson);
  assert.equal(payload.payload.ackContract.required, true);
  assert.equal(payload.payload.ackContract.timeoutSeconds, 90);
  assert.equal(payload.payload.ackContract.retryDelaySeconds, 30);

  const inspectBin = await makeFakeOpenClaw(root, "fake-openclaw-inspect-ack.mjs", "inspect-ack");
  const drained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId,
    openclawBin: inspectBin,
    reportDelivery: false
  });
  assert.equal(drained.results?.[0]?.status, "acked");
  const semanticDispatchId = drained.results?.[0]?.semanticContinuation?.dispatchId;
  assert.ok(semanticDispatchId);
  const inspect = JSON.parse(await fs.readFile(path.join(root, "ack-inspect.json"), "utf8"));
  assert.equal(inspect.timeout, "90");
  assert.match(inspect.message, new RegExp(`Message Flow ID: ${sent.dispatches[0].messageFlowId}`));
  assert.match(inspect.message, /First-turn ACK contract/);
  assert.match(inspect.message, /ACK_RECEIVED/);
  assert.match(inspect.message, /not the semantic task result/);
  const flow = sqliteJson(dbFile, `
SELECT status, final_output_present AS finalOutputPresent, delivery_receipt_present AS deliveryReceiptPresent
FROM message_flows
WHERE dispatch_id='${dispatchId}'
LIMIT 1;`)[0];
  assert.deepEqual(flow, {
    status: "runtime_acknowledged",
    finalOutputPresent: 0,
    deliveryReceiptPresent: 0
  });
  const ackOnlyRuntimeEvents = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, stage
FROM runtime_semantic_events
WHERE dispatch_id='${dispatchId}'
ORDER BY event_sequence;`);
  assert.deepEqual(ackOnlyRuntimeEvents, [
    { eventType: "dispatch_bound", status: "dispatched", stage: "dispatch_bound" },
    { eventType: "mechanical_ack", status: "acked", stage: "ack_received" }
  ]);
  const ackOnlyCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status, semantic_ack_at AS semanticAckAt, latest_receipt_ref AS latestReceiptRef
FROM runtime_current_state
WHERE runtime='openclaw' AND agent_id='main'
LIMIT 1;`)[0];
  assert.equal(ackOnlyCurrentState.activeDispatchId, dispatchId);
  assert.equal(ackOnlyCurrentState.currentStage, "ack_received");
  assert.equal(ackOnlyCurrentState.status, "acked");
  assert.equal(ackOnlyCurrentState.semanticAckAt, "");
  assert.ok(ackOnlyCurrentState.latestReceiptRef);
  const semanticDispatch = sqliteJson(dbFile, `
SELECT status, dispatch_type AS dispatchType, payload_json AS payloadJson
FROM mixed_meeting_dispatches
WHERE dispatch_id='${semanticDispatchId}'
LIMIT 1;`)[0];
  assert.equal(semanticDispatch.status, "queued");
  assert.equal(semanticDispatch.dispatchType, "message_flow_semantic");
  const semanticPayload = JSON.parse(semanticDispatch.payloadJson);
  assert.equal(semanticPayload.payload.semanticContinuation, true);
  assert.equal(semanticPayload.payload.ackContract.required, false);
  assert.equal(semanticPayload.payload.timeoutSeconds, 300);
  assert.equal(semanticPayload.payload.semanticTimeoutSeconds, 300);

  const successBin = await makeFakeOpenClaw(root, "fake-openclaw-semantic-success.mjs", "inspect-semantic");
  const semanticDrained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: semanticDispatchId,
    openclawBin: successBin,
    reportDelivery: false
  });
  assert.equal(semanticDrained.results?.[0]?.status, "acked");
  const semanticInspect = JSON.parse(await fs.readFile(path.join(root, "semantic-inspect.json"), "utf8"));
  assert.equal(semanticInspect.message.includes("Immediate ACK required"), false);
  assert.equal(semanticInspect.message.includes("First-turn ACK contract"), false);
  assert.equal(semanticInspect.message.includes("ACK_RECEIVED"), false);
  assert.match(semanticInspect.message, new RegExp(`Message Flow ID: ${sent.dispatches[0].messageFlowId}`));
  assert.equal(semanticInspect.message.includes("requires ack regression body"), true);
  assert.equal(semanticInspect.timeout, "300");
  const completedFlow = sqliteJson(dbFile, `
SELECT status, final_output_present AS finalOutputPresent, delivery_receipt_present AS deliveryReceiptPresent, dispatch_id AS dispatchId
FROM message_flows
WHERE flow_id='${sent.dispatches[0].messageFlowId}'
LIMIT 1;`)[0];
  assert.deepEqual(completedFlow, {
    status: "runtime_completed",
    finalOutputPresent: 1,
    deliveryReceiptPresent: 0,
    dispatchId: semanticDispatchId
  });
  const semanticRuntimeEvents = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, stage
FROM runtime_semantic_events
WHERE dispatch_id='${semanticDispatchId}'
ORDER BY event_sequence;`);
  assert.deepEqual(semanticRuntimeEvents, [
    { eventType: "dispatch_bound", status: "dispatched", stage: "dispatch_bound" },
    { eventType: "semantic_ack", status: "working", stage: "semantic_continuation_received" },
    { eventType: "turn_completed", status: "completed", stage: "semantic_continuation_completed" }
  ]);
  const semanticCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status, semantic_ack_at AS semanticAckAt, latest_receipt_ref AS latestReceiptRef
FROM runtime_current_state
WHERE runtime='openclaw' AND agent_id='main'
LIMIT 1;`)[0];
  assert.equal(semanticCurrentState.activeDispatchId, semanticDispatchId);
  assert.equal(semanticCurrentState.currentStage, "semantic_continuation_completed");
  assert.equal(semanticCurrentState.status, "completed");
  assert.ok(semanticCurrentState.semanticAckAt);
  assert.ok(semanticCurrentState.latestReceiptRef);

  const llmFailureAck = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "requires ack semantic continuation llm failure body",
    workflowId: "workflow-message-flow-ack-llm-failure",
    meetingId: "meeting-message-flow-ack-llm-failure",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const llmFailureAckDispatchId = llmFailureAck.dispatches[0].dispatchId;
  const llmFailureAckBin = await makeFakeOpenClaw(root, "fake-openclaw-llm-failure-ack.mjs", "inspect-ack");
  const llmFailureAckDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: llmFailureAckDispatchId,
    openclawBin: llmFailureAckBin,
    reportDelivery: false
  });
  const llmFailureSemanticDispatchId = llmFailureAckDrain.results?.[0]?.semanticContinuation?.dispatchId;
  assert.ok(llmFailureSemanticDispatchId);
  const llmFailureBin = await makeFakeOpenClaw(root, "fake-openclaw-llm-failed.mjs", "llm-failed");
  const llmFailureSemanticDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: llmFailureSemanticDispatchId,
    openclawBin: llmFailureBin,
    reportDelivery: false
  });
  assert.equal(llmFailureSemanticDrain.results?.[0]?.status, "failed");
  assert.equal(llmFailureSemanticDrain.results?.[0]?.failureType, "incomplete_output");
  const llmFailureFlow = sqliteJson(dbFile, `
SELECT status, final_output_present AS finalOutputPresent, failure_type AS failureType, substr(last_error,1,80) AS lastError
FROM message_flows
WHERE flow_id='${llmFailureAck.dispatches[0].messageFlowId}'
LIMIT 1;`)[0];
  assert.deepEqual(llmFailureFlow, {
    status: "runtime_failed",
    finalOutputPresent: 0,
    failureType: "incomplete_output",
    lastError: "OpenClaw returned incomplete output: LLM request failed."
  });
  const llmFailureRuntimeEvents = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, stage, error_class AS errorClass
FROM runtime_semantic_events
WHERE dispatch_id='${llmFailureSemanticDispatchId}'
ORDER BY event_sequence;`);
  assert.deepEqual(llmFailureRuntimeEvents, [
    { eventType: "dispatch_bound", status: "dispatched", stage: "dispatch_bound", errorClass: "" },
    { eventType: "turn_failed", status: "failed", stage: "turn_failed", errorClass: "incomplete_output" }
  ]);
  const llmFailureCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status
FROM runtime_current_state
WHERE runtime='openclaw' AND agent_id='main'
LIMIT 1;`)[0];
  assert.equal(llmFailureCurrentState.activeDispatchId, llmFailureSemanticDispatchId);
  assert.equal(llmFailureCurrentState.currentStage, "turn_failed");
  assert.equal(llmFailureCurrentState.status, "failed");

  const leadingFailureText = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "valid semantic output may mention an upstream placeholder on the first line",
    workflowId: "workflow-message-flow-leading-placeholder-valid",
    meetingId: "meeting-message-flow-leading-placeholder-valid",
    returnPolicy: "silent"
  });
  const leadingFailureBin = await makeFakeOpenClaw(root, "fake-openclaw-leading-placeholder-valid.mjs", "llm-failed-leading-valid");
  const leadingFailureDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: leadingFailureText.dispatches[0].dispatchId,
    openclawBin: leadingFailureBin,
    reportDelivery: false
  });
  assert.equal(leadingFailureDrain.results?.[0]?.status, "acked");
  const leadingFailureFlow = sqliteJson(dbFile, `
SELECT status, final_output_present AS finalOutputPresent, failure_type AS failureType, substr(last_error,1,80) AS lastError
FROM message_flows
WHERE flow_id='${leadingFailureText.dispatches[0].messageFlowId}'
LIMIT 1;`)[0];
  assert.deepEqual(leadingFailureFlow, {
    status: "runtime_completed",
    finalOutputPresent: 1,
    failureType: "",
    lastError: ""
  });

  const listedByAckDispatch = await runAction(root, {
    action: "message_flow.list",
    dispatchId,
    limit: 5
  });
  assert.equal(listedByAckDispatch.count, 1);
  assert.equal(listedByAckDispatch.rows[0].flow_id, sent.dispatches[0].messageFlowId);

  const recoveryAck = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "requires ack semantic continuation recovery body",
    workflowId: "workflow-message-flow-ack-recovery",
    meetingId: "meeting-message-flow-ack-recovery",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const recoveryAckDispatchId = recoveryAck.dispatches[0].dispatchId;
  const recoveryAckBin = await makeFakeOpenClaw(root, "fake-openclaw-recovery-ack.mjs", "inspect-ack");
  const recoveryAckDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: recoveryAckDispatchId,
    openclawBin: recoveryAckBin,
    reportDelivery: false
  });
  const deletedSemanticDispatchId = recoveryAckDrain.results?.[0]?.semanticContinuation?.dispatchId;
  assert.ok(deletedSemanticDispatchId);
  sqliteExec(dbFile, `DELETE FROM mixed_meeting_dispatches WHERE dispatch_id='${deletedSemanticDispatchId}';`);
  sqliteExec(dbFile, `UPDATE message_flows SET updated_at='2000-01-01T00:00:00.000Z' WHERE flow_id='${recoveryAck.dispatches[0].messageFlowId}';`);
  const recovery = await runAction(root, {
    action: "message_flow.reconcile",
    messageFlowStuckAfterMs: 60000,
    limit: 5
  });
  assert.equal(recovery.recoveredSemanticContinuations?.[0]?.status, "queued");
  const recoveredSemanticCount = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE dispatch_type='message_flow_semantic'
  AND idempotency_key='message-flow-semantic:${recoveryAck.dispatches[0].messageFlowId}:${recoveryAckDispatchId}';`)[0];
  assert.equal(recoveredSemanticCount.count, 1);
  const recoveredSemanticDispatchId = recovery.recoveredSemanticContinuations?.[0]?.semanticDispatchId;
  const recoverySemanticBin = await makeFakeOpenClaw(root, "fake-openclaw-recovery-semantic.mjs", "success");
  const recoveredSemanticDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: recoveredSemanticDispatchId,
    openclawBin: recoverySemanticBin,
    reportDelivery: false
  });
  assert.equal(recoveredSemanticDrain.results?.[0]?.status, "acked");

  const loopAck = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "requires ack semantic continuation control loop body",
    workflowId: "workflow-message-flow-ack-loop",
    meetingId: "meeting-message-flow-ack-loop",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const loopAckDispatchId = loopAck.dispatches[0].dispatchId;
  const loopAckBin = await makeFakeOpenClaw(root, "fake-openclaw-loop-ack.mjs", "inspect-ack");
  const loopAckDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: loopAckDispatchId,
    openclawBin: loopAckBin,
    reportDelivery: false
  });
  const loopSemanticDispatchId = loopAckDrain.results?.[0]?.semanticContinuation?.dispatchId;
  assert.ok(loopSemanticDispatchId);
  const loopSemanticBin = await makeFakeOpenClaw(root, "fake-openclaw-loop-semantic.mjs", "success");
  const semanticTick = await runAction(root, {
    action: "workflow.control_loop.tick",
    runtimes: "hermers",
    jobLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    openclawBin: loopSemanticBin
  });
  assert.equal(semanticTick.claimedJobs?.[0]?.jobType, "runtime_drain");
  assert.equal(semanticTick.jobResults?.[0]?.result?.results?.[0]?.dispatchId, loopSemanticDispatchId);

  const continuationFailureAck = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "requires ack semantic enqueue failure regression body",
    workflowId: "workflow-message-flow-semantic-enqueue-failure",
    meetingId: "meeting-message-flow-semantic-enqueue-failure",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const continuationFailureDispatchId = continuationFailureAck.dispatches[0].dispatchId;
  const forcedFailureAckBin = await makeFakeOpenClaw(root, "fake-openclaw-forced-semantic-failure-ack.mjs", "inspect-ack");
  const previousForcedFailure = process.env[TEST_SEMANTIC_CONTINUATION_FAILURE_ENV];
  process.env[TEST_SEMANTIC_CONTINUATION_FAILURE_ENV] = "1";
  let continuationFailureDrain;
  try {
    continuationFailureDrain = await runAction(root, {
      action: "runtime.bridge.drain",
      runtime: "openclaw",
      dispatchId: continuationFailureDispatchId,
      openclawBin: forcedFailureAckBin,
      reportDelivery: false,
      forceSemanticContinuationFailure: true
    });
  } finally {
    if (previousForcedFailure === undefined) {
      delete process.env[TEST_SEMANTIC_CONTINUATION_FAILURE_ENV];
    } else {
      process.env[TEST_SEMANTIC_CONTINUATION_FAILURE_ENV] = previousForcedFailure;
    }
  }
  assert.equal(continuationFailureDrain.results?.[0]?.status, "acked");
  assert.equal(continuationFailureDrain.results?.[0]?.semanticContinuation?.status, "failed");
  const continuationFailureRows = sqliteJson(dbFile, `
SELECT d.status AS dispatchStatus, mf.status AS flowStatus, mf.final_output_present AS finalOutputPresent
FROM mixed_meeting_dispatches d
JOIN message_flows mf ON mf.dispatch_id=d.dispatch_id
WHERE d.dispatch_id='${continuationFailureDispatchId}'
LIMIT 1;`)[0];
  assert.deepEqual(continuationFailureRows, {
    dispatchStatus: "acked",
    flowStatus: "runtime_acknowledged",
    finalOutputPresent: 0
  });
  const continuationFailureEvents = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM message_flow_events
WHERE flow_id='${continuationFailureAck.dispatches[0].messageFlowId}'
  AND event_type='semantic_continuation_failed';`)[0];
  assert.equal(continuationFailureEvents.count, 1);
  const continuationFailureRuntimeEvents = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, stage
FROM runtime_semantic_events
WHERE dispatch_id='${continuationFailureDispatchId}'
ORDER BY event_sequence;`);
  assert.deepEqual(continuationFailureRuntimeEvents, [
    { eventType: "dispatch_bound", status: "dispatched", stage: "dispatch_bound" },
    { eventType: "mechanical_ack", status: "acked", stage: "ack_received" },
    { eventType: "blocked", status: "blocked", stage: "semantic_continuation_failed" }
  ]);
  const continuationFailureCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status, stale_kind AS staleKind
FROM runtime_current_state
WHERE runtime='openclaw' AND agent_id='main'
LIMIT 1;`)[0];
  assert.equal(continuationFailureCurrentState.activeDispatchId, continuationFailureDispatchId);
  assert.equal(continuationFailureCurrentState.currentStage, "semantic_continuation_failed");
  assert.equal(continuationFailureCurrentState.status, "blocked");
  assert.equal(continuationFailureCurrentState.staleKind, "semantic_continuation_failed");
}

async function testMessageFlowAckTimeoutClamping() {
  const root = await tempRoot("message-flow-ack-timeout-clamp");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  const dbFile = path.join(root, "tracking.db");

  async function assertMessageFlowAckTimeout(inputTimeout, expectedTimeout) {
    const suffix = String(inputTimeout).replace(/[^a-zA-Z0-9_-]/g, "-");
    const sent = await runAction(root, {
      action: "workflow.message_flow.send",
      fromAgent: "tester",
      fromRuntime: "local_codex",
      targets: ["openclaw:main"],
      body: `requires ack timeout ${inputTimeout} body`,
      workflowId: `workflow-message-flow-ack-timeout-${suffix}`,
      meetingId: `meeting-message-flow-ack-timeout-${suffix}`,
      requiresAck: true,
      ackTimeoutSeconds: inputTimeout,
      returnPolicy: "silent"
    });
    const dispatchId = sent.dispatches[0].dispatchId;
    const queued = sqliteJson(dbFile, `
SELECT prompt, payload_json AS payloadJson
FROM mixed_meeting_dispatches
WHERE dispatch_id='${dispatchId}'
LIMIT 1;`)[0];
    const payload = JSON.parse(queued.payloadJson);
    assert.equal(payload.payload.ackContract.timeoutSeconds, expectedTimeout);
    assert.match(queued.prompt, new RegExp(`within ${expectedTimeout}s after receiving the complete message`));
  }

  await assertMessageFlowAckTimeout(300, 300);
  await assertMessageFlowAckTimeout(900, 300);
  await assertMessageFlowAckTimeout(1, 5);
}

async function testMessageFlowImmediateAckRetryDelay() {
  const root = await tempRoot("message-flow-ack-retry");
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
    body: "requires ack retry regression body",
    workflowId: "workflow-message-flow-ack-retry",
    meetingId: "meeting-message-flow-ack-retry",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const dispatchId = sent.dispatches[0].dispatchId;
  const failBin = await makeFakeOpenClaw(root, "fake-openclaw-bad-ack.mjs", "bad-ack");
  const drained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId,
    openclawBin: failBin,
    reportDelivery: false
  });
  assert.equal(drained.results?.[0]?.status, "queued");
  assert.equal(drained.results?.[0]?.retryScheduled, true);
  assert.equal(drained.results?.[0]?.failureType, "ack_contract_violation");
  assert.equal(Boolean(drained.results?.[0]?.semanticContinuation?.dispatchId), false);

  const dbFile = path.join(root, "tracking.db");
  const dispatch = sqliteJson(dbFile, `
SELECT status, attempt, next_retry_at AS nextRetryAt, failure_type AS failureType
FROM mixed_meeting_dispatches
WHERE dispatch_id='${dispatchId}'
LIMIT 1;`)[0];
  assert.equal(dispatch.status, "queued");
  assert.equal(dispatch.attempt, 1);
  assert.equal(dispatch.failureType, "ack_contract_violation");
  assert.notEqual(dispatch.nextRetryAt || "", "");
  const run = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM runtime_runs
WHERE dispatch_id='${dispatchId}'
  AND status='retry_scheduled'
  AND failure_type='ack_contract_violation';`)[0];
  assert.equal(run.count, 1);
  const indexedAgentRun = sqliteJson(dbFile, `
SELECT agent_run_id AS agentRunId, workflow_id AS workflowId, dispatch_id AS dispatchId,
  runtime_run_id AS runtimeRunId, runtime, agent_id AS agentId, status, attempt, error
FROM workflow_agent_runs
WHERE dispatch_id='${dispatchId}'
  AND status='retry_scheduled'
LIMIT 1;`)[0];
  assert.ok(indexedAgentRun.agentRunId.startsWith("runtime."));
  assert.equal(indexedAgentRun.workflowId, "workflow-message-flow-ack-retry");
  assert.equal(indexedAgentRun.dispatchId, dispatchId);
  assert.ok(indexedAgentRun.runtimeRunId);
  assert.equal(indexedAgentRun.runtime, "openclaw");
  assert.equal(indexedAgentRun.agentId, "main");
  assert.equal(indexedAgentRun.attempt, 1);
  assert.match(indexedAgentRun.error, /ACK contract violation/);
  const badAckSemanticCount = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE dispatch_type='message_flow_semantic'
  AND meeting_id='meeting-message-flow-ack-retry';`)[0];
  assert.equal(badAckSemanticCount.count, 0);

  const embeddedAck = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "requires ack embedded token retry regression body",
    workflowId: "workflow-message-flow-embedded-ack-retry",
    meetingId: "meeting-message-flow-embedded-ack-retry",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const embeddedAckDispatchId = embeddedAck.dispatches[0].dispatchId;
  const embeddedAckBin = await makeFakeOpenClaw(root, "fake-openclaw-embedded-ack.mjs", "embedded-ack");
  const embeddedAckDrained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: embeddedAckDispatchId,
    openclawBin: embeddedAckBin,
    reportDelivery: false
  });
  assert.equal(embeddedAckDrained.results?.[0]?.status, "queued");
  assert.equal(embeddedAckDrained.results?.[0]?.retryScheduled, true);
  assert.equal(embeddedAckDrained.results?.[0]?.failureType, "ack_contract_violation");
  const embeddedAckSemanticCount = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE dispatch_type='message_flow_semantic'
  AND meeting_id='meeting-message-flow-embedded-ack-retry';`)[0];
  assert.equal(embeddedAckSemanticCount.count, 0);

  const emptyAck = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "requires ack empty output retry regression body",
    workflowId: "workflow-message-flow-empty-ack-retry",
    meetingId: "meeting-message-flow-empty-ack-retry",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const emptyAckDispatchId = emptyAck.dispatches[0].dispatchId;
  const emptyAckBin = await makeFakeOpenClaw(root, "fake-openclaw-empty-ack.mjs", "empty-ack");
  const emptyAckDrained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: emptyAckDispatchId,
    openclawBin: emptyAckBin,
    reportDelivery: false
  });
  assert.equal(emptyAckDrained.results?.[0]?.status, "queued");
  assert.equal(emptyAckDrained.results?.[0]?.retryScheduled, true);
  assert.equal(emptyAckDrained.results?.[0]?.failureType, "empty_output");
  const semanticCount = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE dispatch_type='message_flow_semantic'
  AND meeting_id IN ('meeting-message-flow-ack-retry', 'meeting-message-flow-embedded-ack-retry', 'meeting-message-flow-empty-ack-retry');`)[0];
  assert.equal(semanticCount.count, 0);

  const timeoutAck = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "requires ack timeout classification regression body",
    workflowId: "workflow-message-flow-timeout-ack-retry",
    meetingId: "meeting-message-flow-timeout-ack-retry",
    requiresAck: true,
    returnPolicy: "silent"
  });
  const timeoutAckDispatchId = timeoutAck.dispatches[0].dispatchId;
  sqliteExec(dbFile, `
UPDATE mixed_meeting_dispatches
SET payload_json=json_set(payload_json, '$.payload.ackContract.timeoutSeconds', 5)
WHERE dispatch_id='${timeoutAckDispatchId}';`);
  const timeoutAckBin = await makeFakeOpenClaw(root, "fake-openclaw-timeout-ack.mjs", "slow-timeout");
  const timeoutAckDrained = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: timeoutAckDispatchId,
    openclawBin: timeoutAckBin,
    reportDelivery: false
  });
  assert.equal(timeoutAckDrained.results?.[0]?.status, "queued");
  assert.equal(timeoutAckDrained.results?.[0]?.retryScheduled, true);
  assert.equal(timeoutAckDrained.results?.[0]?.failureType, "runtime_timeout");

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
  const tickStartedAt = Date.now();
  const tick = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    timeoutSeconds: 30,
    openclawBin: successBin
  });
  assert.equal(tick.claimedJobs?.[0]?.jobType, "runtime_drain");
  assert.equal(tick.jobResults?.[0]?.result?.results?.[0]?.dispatchId, dispatchId);
  const preciseDrainJob = sqliteJson(path.join(root, "tracking.db"), `
SELECT payload_json AS payloadJson
FROM control_loop_jobs
WHERE dedupe_key='runtime_drain:openclaw:${dispatchId}'
LIMIT 1;`)[0];
  assert.equal(JSON.parse(preciseDrainJob.payloadJson).timeoutSeconds, 300);
  assert.equal(Date.parse(tick.claimedJobs?.[0]?.leaseUntil || "") - tickStartedAt >= 300_000, true);
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

  const generic = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "message_flow generic control-loop openclaw drain body",
    workflowId: "workflow-message-flow-openclaw-generic-drain",
    meetingId: "meeting-message-flow-openclaw-generic-drain",
    returnPolicy: "silent"
  });
  const genericDispatchId = generic.dispatches[0].dispatchId;
  const normalDispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-message-flow-openclaw-generic-drain",
    workflowId: "workflow-message-flow-openclaw-generic-drain",
    runtime: "openclaw",
    agentId: "main",
    dispatchType: "workflow_task",
    prompt: "normal openclaw workflow task should keep short generic drain timeout",
    priority: "high",
    maxAttempts: 1
  });
  const normalDispatchId = normalDispatch.dispatchId;
  const genericSuccessBin = await makeFakeOpenClaw(root, "fake-openclaw-control-loop-generic-success.mjs", "success");
  const genericTick = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    timeoutSeconds: 30,
    openclawBin: genericSuccessBin
  });
  assert.equal(genericTick.claimedJobs?.[0]?.jobType, "runtime_drain");
  assert.equal(genericTick.jobResults?.[0]?.result?.results?.[0]?.dispatchId, normalDispatchId);
  const genericDrainJob = sqliteJson(path.join(root, "tracking.db"), `
SELECT payload_json AS payloadJson
FROM control_loop_jobs
WHERE dedupe_key='runtime_drain:openclaw'
LIMIT 1;`)[0];
  const genericPayload = JSON.parse(genericDrainJob.payloadJson);
  assert.equal(genericPayload.timeoutSeconds, 30);
  assert.deepEqual(genericPayload.excludeDispatchTypes, ["message_flow_send", "message_flow_semantic"]);
  const genericMessageFlowRow = sqliteJson(path.join(root, "tracking.db"), `
SELECT status
FROM mixed_meeting_dispatches
WHERE dispatch_id='${genericDispatchId}'
LIMIT 1;`)[0];
  assert.equal(genericMessageFlowRow.status, "queued");
  const preciseGenericTickStartedAt = Date.now();
  const preciseGenericTick = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    tickBudgetMs: "invalid",
    timeoutSeconds: "invalid",
    jobLeaseMs: "invalid",
    openclawBin: genericSuccessBin
  });
  assert.equal(preciseGenericTick.claimedJobs?.[0]?.jobType, "runtime_drain");
  assert.equal(preciseGenericTick.jobResults?.[0]?.result?.results?.[0]?.dispatchId, genericDispatchId);
  const preciseGenericDrainJob = sqliteJson(path.join(root, "tracking.db"), `
SELECT payload_json AS payloadJson
FROM control_loop_jobs
WHERE dedupe_key='runtime_drain:openclaw:${genericDispatchId}'
LIMIT 1;`)[0];
  assert.equal(JSON.parse(preciseGenericDrainJob.payloadJson).timeoutSeconds, 300);
  assert.equal(Number.isFinite(Date.parse(preciseGenericTick.claimedJobs?.[0]?.leaseUntil || "")), true);
  assert.equal(Date.parse(preciseGenericTick.claimedJobs?.[0]?.leaseUntil || "") - preciseGenericTickStartedAt >= 300_000, true);

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
  const configured = await runAction(starvationRoot, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "configured runtime should not occupy precise message_flow scan window",
    workflowId: "workflow-message-flow-precise-window",
    meetingId: "meeting-message-flow-precise-window",
    returnPolicy: "silent"
  });
  const configuredDispatchId = configured.dispatches[0].dispatchId;
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
  assert.equal(Boolean(starvationTick.seededJobs?.some((job) => job.dedupeKey === `runtime_drain:openclaw:${configuredDispatchId}`)), true);
  assert.equal(starvationTick.jobResults?.[0]?.result?.results?.[0]?.dispatchId, configuredDispatchId);
  const followupTick = await runAction(starvationRoot, {
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
  assert.equal(Boolean(followupTick.seededJobs?.some((job) => job.dedupeKey === `runtime_drain:local_codex:${unconfiguredDispatchId}`)), true);
}

function testControlLoopProcessWorkerBudgetCoversOpenClawSemanticDrain() {
  const devConfig = {
    tickBudgetMs: 60_000,
    timeoutSeconds: 30,
    jobLeaseMs: 90_000,
    drainQueued: true
  };
  assert.equal(
    controlLoopWorkerKillAfterMs(devConfig) >= (DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS + 45) * 1000,
    true
  );
  assert.equal(controlLoopWorkerKillAfterMs(devConfig) > (devConfig.timeoutSeconds + 15) * 1000, true);
  assert.equal(
    controlLoopWorkerKillAfterMs({ ...devConfig, drainQueued: false }),
    (DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS + 45) * 1000
  );
  assert.equal(
    Number.isFinite(controlLoopWorkerKillAfterMs({
      tickBudgetMs: "invalid",
      timeoutSeconds: "invalid",
      jobLeaseMs: "invalid",
      drainQueued: false
    })),
    true
  );
  assert.equal(
    controlLoopWorkerKillAfterMs({
      tickBudgetMs: "invalid",
      timeoutSeconds: "invalid",
      jobLeaseMs: "invalid",
      drainQueued: false
    }),
    (DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS + 45) * 1000
  );
}

async function testControlLoopAutoDiscoversQueuedDispatchRuntimes() {
  const root = await tempRoot("control-loop-auto-runtime-discovery");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  const dispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-auto-runtime",
    workflowId: "workflow-auto-runtime",
    runtime: "openclaw",
    agentId: "main",
    prompt: "generic openclaw dispatch should be discovered without explicit runtimes",
    dispatchType: "workflow_task",
    returnPolicy: "silent"
  });
  const successBin = await makeFakeOpenClaw(root, "fake-openclaw-auto-runtime-success.mjs", "success");
  const tick = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    runtimeLimit: 1,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    openclawBin: successBin
  });
  assert.equal(Boolean(tick.seededJobs?.some((job) => job.dedupeKey === "runtime_drain:openclaw")), true);
  assert.equal(tick.jobResults?.[0]?.result?.results?.[0]?.dispatchId, dispatch.dispatchId);

  const localRoot = await tempRoot("control-loop-runtime-limit");
  await runAction(localRoot, {
    action: "runtime.agent.upsert",
    platform: "local_codex",
    runtime: "local_codex",
    agentId: "codex",
    displayName: "Local Codex",
    canReceiveDispatch: true,
    workflowIngressAdapter: "local_codex_inbox"
  });
  await runAction(localRoot, {
    action: "workflow.message_flow.send",
    fromAgent: "cat_body",
    fromRuntime: "hermers",
    targets: ["local_codex:codex"],
    body: "first local dispatch for runtimeLimit regression",
    workflowId: "workflow-runtime-limit",
    meetingId: "workflow-runtime-limit",
    returnPolicy: "silent"
  });
  await runAction(localRoot, {
    action: "workflow.message_flow.send",
    fromAgent: "cat_body",
    fromRuntime: "hermers",
    targets: ["local_codex:codex"],
    body: "second local dispatch for runtimeLimit regression",
    workflowId: "workflow-runtime-limit",
    meetingId: "workflow-runtime-limit",
    returnPolicy: "silent"
  });
  const localTick = await runAction(localRoot, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    runtimeLimit: 2,
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false
  });
  assert.equal(Boolean(localTick.seededJobs?.some((job) => job.dedupeKey === "runtime_drain:local_codex")), true);
  assert.equal(localTick.jobResults?.[0]?.result?.results?.length, 2);

  const invalidRoot = await tempRoot("control-loop-invalid-explicit-runtime");
  await runAction(invalidRoot, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  await runAction(invalidRoot, {
    action: "meeting.dispatch",
    meetingId: "meeting-invalid-runtime",
    workflowId: "workflow-invalid-runtime",
    runtime: "openclaw",
    agentId: "main",
    prompt: "invalid explicit runtime must not expand to auto-discovery",
    dispatchType: "workflow_task",
    returnPolicy: "silent"
  });
  const invalidTick = await runAction(invalidRoot, {
    action: "workflow.control_loop.tick",
    runtimes: "opencalw",
    drainQueued: true,
    autoDispatch: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false
  });
  assert.equal(invalidTick.status, "failed");
  assert.match(invalidTick.error, /invalid runtime for control_loop drain/);
  assert.equal(sqliteCount(path.join(invalidRoot, "tracking.db"), "control_loop_jobs", "job_type='runtime_drain'"), 0);
}

async function testControlLoopWorkflowSuperviseEnqueuesTargetedDrain() {
  const root = await tempRoot("control-loop-supervise-targeted-drain");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "local_codex",
    runtime: "local_codex",
    agentId: "codex",
    displayName: "Local Codex",
    canReceiveDispatch: true,
    workflowIngressAdapter: "local_codex_inbox"
  });
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId: "workflow-supervise-targeted-drain",
    status: "active",
    summary: "supervisor should enqueue a targeted drain for newly dispatched tasks"
  });
  await runAction(root, {
    action: "workflow.task.create",
    workflowId: "workflow-supervise-targeted-drain",
    taskId: "task-supervise-targeted-drain",
    runtime: "local_codex",
    agentId: "codex",
    status: "pending",
    priority: "steer",
    prompt: "produce a bounded local codex receipt"
  });
  const tick = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    drainQueued: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    autoDispatch: true,
    timeoutSeconds: 30
  });
  const dispatchId = tick.jobResults?.[0]?.result?.enqueuedDrains?.[0]?.dedupeKey?.split(":").pop();
  assert.equal(tick.claimedJobs?.[0]?.jobType, "workflow_supervise");
  assert.equal(Boolean(dispatchId), true);
  assert.equal(tick.jobResults?.[0]?.result?.enqueuedDrains?.[0]?.dedupeKey, `runtime_drain:local_codex:${dispatchId}`);
  assert.equal(tick.jobResults?.[0]?.result?.enqueuedDrains?.[0]?.status, "queued");
  const dbFile = path.join(root, "tracking.db");
  const jobs = sqliteJson(dbFile, `SELECT dedupe_key, priority, runtime, payload_json FROM control_loop_jobs WHERE job_type='runtime_drain';`);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].dedupe_key, `runtime_drain:local_codex:${dispatchId}`);
  assert.equal(jobs[0].priority, "steer");
  assert.equal(jobs[0].runtime, "local_codex");
  assert.equal(JSON.parse(jobs[0].payload_json).limit, 1);
  assert.equal(JSON.parse(jobs[0].payload_json).timeoutSeconds, 30);

  const openclawRoot = await tempRoot("control-loop-supervise-openclaw-message-flow-targeted-drain");
  await runAction(openclawRoot, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  await runAction(openclawRoot, {
    action: "workflow.run.upsert",
    workflowId: "workflow-supervise-openclaw-message-flow-targeted-drain",
    status: "active",
    summary: "supervisor should keep OpenClaw message_flow targeted drains at semantic timeout"
  });
  await runAction(openclawRoot, {
    action: "workflow.task.create",
    workflowId: "workflow-supervise-openclaw-message-flow-targeted-drain",
    taskId: "task-supervise-openclaw-message-flow-targeted-drain",
    runtime: "openclaw",
    agentId: "main",
    taskType: "message_flow_send",
    status: "pending",
    priority: "high",
    prompt: "OpenClaw message_flow targeted drain should use semantic timeout"
  });
  const openclawTick = await runAction(openclawRoot, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    drainQueued: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    autoDispatch: true,
    timeoutSeconds: 30
  });
  const openclawDispatchId = openclawTick.jobResults?.[0]?.result?.enqueuedDrains?.[0]?.dedupeKey?.split(":").pop();
  assert.equal(openclawTick.claimedJobs?.[0]?.jobType, "workflow_supervise");
  assert.equal(Boolean(openclawDispatchId), true);
  const openclawJobs = sqliteJson(path.join(openclawRoot, "tracking.db"), `SELECT dedupe_key, runtime, payload_json FROM control_loop_jobs WHERE job_type='runtime_drain';`);
  assert.equal(openclawJobs.length, 1);
  assert.equal(openclawJobs[0].dedupe_key, `runtime_drain:openclaw:${openclawDispatchId}`);
  assert.equal(openclawJobs[0].runtime, "openclaw");
  assert.equal(JSON.parse(openclawJobs[0].payload_json).timeoutSeconds, 300);
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

async function testControlLoopBacksOffBlockedWorkflowSupervise() {
  const root = await tempRoot("control-loop-supervise-cooldown");
  const workflowId = "workflow-blocked-cooldown";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "blocked",
    summary: "blocked workflow should not be supervised every tick"
  });

  const first = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    autoDispatch: false,
    drainQueued: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    idleWorkflowSuperviseCooldownMs: 300_000
  });
  assert.equal(first.claimedJobs?.[0]?.jobType, "workflow_supervise");
  assert.equal(first.jobResults?.[0]?.status, "done");

  const second = await runAction(root, {
    action: "workflow.control_loop.tick",
    jobLimit: 1,
    autoDispatch: false,
    drainQueued: false,
    deliverOutbox: false,
    ensureHumanGateRequests: false,
    createHumanGateInbox: false,
    idleWorkflowSuperviseCooldownMs: 300_000
  });
  assert.equal(second.claimedJobs?.length || 0, 0);
  assert.equal(second.seededJobs?.[0]?.reason, "cooldown");
  const dbFile = path.join(root, "tracking.db");
  assert.equal(sqliteCount(dbFile, "control_loop_jobs", `job_type='workflow_supervise' AND workflow_id='${workflowId}'`), 1);
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
    clientCertFingerprint: "test-cert",
    humanGateId: "hg-fail-closed-policy-evidence",
    catClawAuditId: "audit-fail-closed-policy-evidence",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
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
  const riskDecisionPolicyEvidence = {
    catClawAuditId: "audit-risk-decision-policy",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  };
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
  await runAction(root, {
    action: "runtime.agent.upsert",
    runtime: "openclaw",
    platform: "openclaw",
    agentId: "cat_tail",
    displayName: "猫之尾",
    role: "pre_order_risk_audit_and_final_trading_risk_control",
    executionAdapter: "native",
    imIngressOwner: "openclaw_gateway",
    imIngressAdapter: "openclaw_native",
    workflowIngressAdapter: "openclaw_native",
    endpointRef: "openclaw-agent:cat_tail"
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "risk.decision",
      riskDecisionId: "risk-missing",
      proposalId: "proposal-missing",
      status: "approved",
      ...riskDecisionPolicyEvidence
    }),
    /approved risk\.decision requires an existing trade_proposal parent/
  );
  await createApprovedHumanGate(root, {
    workflowId: "workflow-trade-target-only",
    meetingId: "workflow-trade-target-only",
    parentObjectId: "proposal-A",
    expiresAt,
    payload: {
      proposalId: "proposal-A",
      nextAgent: "cat_tail",
      preOrderRiskAuditId: "pora-target-only"
    }
  });
  assert.equal(sqliteCount(path.join(root, "tracking.db"), "mixed_meeting_dispatches", "workflow_id='workflow-trade-target-only' AND agent_id='cat_tail'"), 0);
  await createApprovedHumanGate(root, {
    workflowId: "workflow-trade-dispatch-only",
    meetingId: "workflow-trade-dispatch-only",
    parentObjectId: "proposal-A",
    expiresAt,
    payload: {
      proposalId: "proposal-A",
      dispatchType: "pre_order_risk_audit",
      preOrderRiskAuditId: "pora-dispatch-only"
    }
  });
  assert.equal(sqliteCount(path.join(root, "tracking.db"), "mixed_meeting_dispatches", "workflow_id='workflow-trade-dispatch-only' AND agent_id='cat_tail'"), 0);
  const humanGateId = await createApprovedHumanGate(root, {
    workflowId: "workflow-trade-chain",
    meetingId: "workflow-trade-chain",
    parentObjectId: "proposal-A",
    expiresAt,
    payload: {
      proposalId: "proposal-A",
      dispatchType: "pre_order_risk_audit",
      nextAgent: "cat_tail",
      preOrderRiskAuditId: "pora-A"
    }
  });
  const catTailDispatch = sqliteJson(path.join(root, "tracking.db"), `
SELECT runtime, agent_id, dispatch_type, status
FROM mixed_meeting_dispatches
WHERE workflow_id='workflow-trade-chain' AND agent_id='cat_tail' AND dispatch_type='pre_order_risk_audit'
LIMIT 1;`);
  assert.equal(catTailDispatch[0]?.runtime, "openclaw");
  assert.equal(catTailDispatch[0]?.status, "queued");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "risk.decision",
      riskDecisionId: "risk-empty",
      proposalId: "proposal-A",
      humanGateId,
      preOrderRiskAuditId: "pora-empty",
      status: "approved",
      reviewerAgent: "cat_tail",
      dispatchType: "pre_order_risk_audit",
      ...riskDecisionPolicyEvidence
    }),
    /approved risk\.decision requires numeric riskLimits/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "risk.decision",
      riskDecisionId: "risk-rejected-missing-evidence",
      proposalId: "proposal-A",
      humanGateId,
      preOrderRiskAuditId: "pora-A",
      status: "rejected",
      decision: "rejected",
      reviewerAgent: "cat_tail",
      dispatchType: "pre_order_risk_audit",
      riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 },
      ...riskDecisionPolicyEvidence
    }),
    /rejected risk\.decision requires evidenceRefs/
  );
  await runAction(root, {
    action: "risk.decision",
    riskDecisionId: "risk-A",
    proposalId: "proposal-A",
    humanGateId,
    preOrderRiskAuditId: "pora-A",
    assetType: "crypto",
    symbol: "BTC/USDT",
    status: "approved",
    reviewerAgent: "cat_tail",
    dispatchType: "pre_order_risk_audit",
    riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 },
    evidenceRefs: ["artifact://trade-chain/evidence"],
    paperRef: "artifact://trade-chain/cat_tail-risk-paper",
    ...riskDecisionPolicyEvidence
  });
  const tradeIntentPolicyEvidence = {
    catClawAuditId: "audit-trade-chain",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  };
  const receiptPolicyEvidence = {
    humanGateId,
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  };
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
    preOrderRiskAuditId: "pora-A",
    humanGateId,
    ...tradeIntentPolicyEvidence,
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
  assert.equal(readyArtifact.preOrderRiskAuditId, "pora-A");
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
    preOrderRiskAuditId: "pora-A",
    humanGateId,
    ...tradeIntentPolicyEvidence,
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
    preOrderRiskAuditId: "pora-A",
    humanGateId,
    ...tradeIntentPolicyEvidence,
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
      preOrderRiskAuditId: "pora-A",
      humanGateId,
      ...tradeIntentPolicyEvidence,
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
      preOrderRiskAuditId: "pora-A",
      humanGateId,
      ...tradeIntentPolicyEvidence,
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
    preOrderRiskAuditId: "pora-A",
    humanGateId,
    ...tradeIntentPolicyEvidence,
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
    riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 }
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
    preOrderRiskAuditId: "pora-A",
    humanGateId,
    ...tradeIntentPolicyEvidence,
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
    riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 }
  });
  assert.equal(liveIntent.status, "rejected");
  assert.ok(liveIntent.rejectionReasons.includes("invalid_execution_mode"));

  const fallbackHumanGateId = await createApprovedHumanGate(root, {
    workflowId: "workflow-trade-fallback",
    meetingId: "workflow-trade-fallback",
    traceId: "trace-hgate-fallback",
    parentObjectId: "proposal-A",
    expiresAt,
    payload: { proposalId: "proposal-A" }
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "risk.decision",
      riskDecisionId: "risk-fallback",
      proposalId: "proposal-A",
      humanGateId: fallbackHumanGateId,
      preOrderRiskAuditId: "pora-fallback",
      assetType: "crypto",
      symbol: "BTC/USDT",
      status: "approved",
      reviewerAgent: "cat_tail",
      dispatchType: "pre_order_risk_audit",
      riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 },
      evidenceRefs: ["artifact://trade-chain/fallback-evidence"],
      paperRef: "artifact://trade-chain/fallback-risk-paper",
      ...riskDecisionPolicyEvidence
    }),
    /approved risk\.decision requires matching cat_tail pre_order_risk_audit dispatch/
  );

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
    preOrderRiskAuditId: "pora-A",
    humanGateId,
    ...tradeIntentPolicyEvidence,
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
    ...receiptPolicyEvidence,
    payload: { apiSecret: "should-not-persist" }
  });
  assert.equal(receipt.status, "accepted");
  const filledReceipt = await runAction(root, {
    action: "trading_core.receipt",
    intentId: "intent-ready",
    status: "filled",
    ...receiptPolicyEvidence
  });
  assert.equal(filledReceipt.status, "filled");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trading_core.receipt",
      intentId: "intent-ready",
      status: "mystery",
      ...receiptPolicyEvidence
    }),
    /unknown trading_core receipt status/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trading_core.receipt",
      intentId: "intent-ready",
      status: "submitted",
      ...receiptPolicyEvidence
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
    preOrderRiskAuditId: "pora-A",
    humanGateId,
    ...tradeIntentPolicyEvidence,
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
      status: "filled",
      ...receiptPolicyEvidence
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

  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, "DELETE FROM workflow_agent_runs WHERE agent_run_id='session.session-run-contract-smoke';");
  const duplicateStart = await runAction(root, {
    action: "workflow.session_run.start",
    runId: "session-run-contract-smoke",
    sessionId: "session-pack-contract-smoke",
    dispatchId: "dispatch-session-store"
  });
  assert.equal(duplicateStart.deduped, true);
  assert.equal(duplicateStart.runId, "session-run-contract-smoke");
  assert.equal(duplicateStart.dispatchId, "dispatch-session-store");
  assert.equal(sqliteCount(dbFile, "workflow_agent_runs", "agent_run_id='session.session-run-contract-smoke' AND dispatch_id='dispatch-session-store'"), 1);

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
  assert.equal(status.counts.workflow_agent_runs, 1);

  const storedRun = sqliteJson(dbFile, `
SELECT dispatch_id AS dispatchId, input_json AS inputJson, worker_input_json AS workerInputJson, output_json AS outputJson
FROM workflow_session_runs
WHERE run_id='session-run-contract-smoke'
LIMIT 1;`)[0];
  assert.equal(storedRun.dispatchId, "dispatch-session-store");
  assert.equal(storedRun.inputJson.includes("run-secret"), false);
  assert.equal(storedRun.workerInputJson.includes("run-secret"), false);
  assert.equal(storedRun.outputJson.includes("output-secret"), false);
  assert.equal(storedRun.inputJson.includes("[redacted]"), true);
  assert.equal(storedRun.outputJson.includes("[redacted]"), true);
  const agentRun = sqliteJson(dbFile, `
SELECT agent_run_id AS agentRunId, workflow_id AS workflowId, task_id AS taskId, dispatch_id AS dispatchId,
  session_run_id AS sessionRunId, runtime, agent_id AS agentId, status, receipt_ref AS receiptRef, output_hash AS outputHash
FROM workflow_agent_runs
WHERE agent_run_id='session.session-run-contract-smoke'
LIMIT 1;`)[0];
  assert.equal(agentRun.workflowId, "workflow-session-store");
  assert.equal(agentRun.taskId, "task-contract-smoke");
  assert.equal(agentRun.dispatchId, "dispatch-session-store");
  assert.equal(agentRun.sessionRunId, "session-run-contract-smoke");
  assert.equal(agentRun.runtime, "worker:local_codex");
  assert.equal(agentRun.agentId, "worker-1");
  assert.equal(agentRun.status, "completed");
  assert.equal(agentRun.receiptRef, "artifact://receipts/session-run-contract-smoke");
  assert.ok(agentRun.outputHash);
  const agentRunView = await new WorkflowReadModel({ dbFile }).agentRuns("workflow-session-store");
  assert.equal(agentRunView.source, "workflow_agent_runs");
  assert.equal(agentRunView.count, 1);
  assert.equal(agentRunView.phaseSummary[0].phaseKey, "unphased");
  assert.equal(agentRunView.phaseSummary[0].withReceipt, 1);
  assert.equal(agentRunView.agentRuns[0].agent_run_id, "session.session-run-contract-smoke");
  sqliteExec(dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES ('outbox-receipts-secret', 'workflow-session-store', 'telegram', 'flashcat', 'human_gate_request', 'sent', '/hgate tawhg:secret-token-123 token=abc123', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('protocol-receipts-exact', 'evidence_pack', 'ready', NULL, 'regression', 'tester', '', 'artifact://exact', '{"workflowId":"workflow-session-store"}', 'hash-exact', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('protocol-receipts-substring-noise', 'evidence_pack', 'ready', NULL, 'regression', 'tester', '', 'artifact://noise', '{"workflowId":"workflow-session-store-extra"}', 'hash-noise', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');`);
  const receiptsView = await new WorkflowReadModel({ dbFile }).receipts("workflow-session-store");
  assert.equal(receiptsView.source, "derived_from_existing_ledgers");
  assert.equal(receiptsView.summaryScope, "shown");
  assert.equal(receiptsView.summary.scope, "shown");
  assert.equal(receiptsView.summary.present >= 1, true);
  assert.equal(Boolean(receiptsView.receipts.some((receipt) => receipt.kind === "agent_run" && receipt.agentRunId === "session.session-run-contract-smoke" && receipt.dispatchId === "dispatch-session-store")), true);
  assert.equal(Boolean(receiptsView.receipts.some((receipt) => receipt.receiptId === "protocol-receipts-exact")), true);
  assert.equal(Boolean(receiptsView.receipts.some((receipt) => receipt.receiptId === "protocol-receipts-substring-noise")), false);
  const outboxReceipt = receiptsView.receipts.find((receipt) => receipt.receiptId === "outbox-receipts-secret");
  assert.ok(outboxReceipt);
  assert.equal(outboxReceipt.summary.includes("secret-token-123"), false);
  assert.equal(outboxReceipt.summary.includes("tawhg:<redacted>"), true);
  const limitedReceiptsView = await new WorkflowReadModel({ dbFile }).receipts("workflow-session-store", { limit: 1 });
  assert.equal(limitedReceiptsView.summary.total, 1);
  assert.equal(limitedReceiptsView.count, 1);
  assert.equal(limitedReceiptsView.candidateCount >= limitedReceiptsView.count, true);
  const evidencePack = await new WorkflowReadModel({ dbFile }).evidencePack("workflow-session-store", { limit: 20 });
  assert.equal(evidencePack.schemaVersion, "workflow_evidence_pack.v1");
  assert.equal(evidencePack.writeMode, "read_only_derived_export");
  assert.equal(evidencePack.manifest.receiptCount >= receiptsView.count, true);
  for (const section of ["workflow", "phases", "tasks", "dispatches", "runtimeRuns", "agentRuns", "messageFlows", "humanGates", "outbox", "checkpoints", "evidence", "receipts", "timeline"]) {
    assert.equal(Object.hasOwn(evidencePack, section), true, `missing evidence pack section: ${section}`);
  }
  assert.equal(Boolean(evidencePack.receipts.receipts.some((receipt) => receipt.agentRunId === "session.session-run-contract-smoke")), true);
  const evidencePackText = JSON.stringify(evidencePack);
  assert.equal(evidencePackText.includes("secret-token-123"), false);
  assert.equal(evidencePack.outbox.outbox.some((row) => row.textPreview.includes("tawhg:<redacted>")), true);
  assert.equal(evidencePack.timeline.events.some((event) => event.kind === "outbox" && event.subtitle.includes("tawhg:<redacted>")), true);
  const routePack = await workflowChildPayload(new WorkflowReadModel({ dbFile }), "workflow-session-store", "evidence-pack", { limit: 20 });
  assert.equal(routePack.schemaVersion, "workflow_evidence_pack.v1");
  assert.equal(routePack.workflowId, "workflow-session-store");
  assert.equal(routePack.manifest.receiptCount, evidencePack.manifest.receiptCount);
  assert.equal(JSON.stringify(routePack).includes("secret-token-123"), false);
}

async function testWorkflowSessionRunsLegacySchemaMigration() {
  const root = await tempRoot("session-runs-legacy-schema");
  await fs.mkdir(root, { recursive: true });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
CREATE TABLE workflow_session_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  pack_version INTEGER NOT NULL,
  workflow_id TEXT,
  task_id TEXT,
  worker_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  worker_input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  receipt_ref TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`);

  const status = await runAction(root, { action: "workflow.status" });
  assert.ok(status.counts);
  const columns = sqliteJson(dbFile, "PRAGMA table_info(workflow_session_runs);").map((row) => row.name);
  assert.ok(columns.includes("dispatch_id"));
  const indexes = sqliteJson(dbFile, "PRAGMA index_list(workflow_session_runs);").map((row) => row.name);
  assert.ok(indexes.includes("idx_session_runs_dispatch"));
}

async function testWorkflowTaskDraftPurePreview() {
  const root = await tempRoot("task-draft");
  const dbFile = path.join(root, "tracking.db");
  const draft = await runAction(root, {
    action: "workflow.task.draft",
    workflowId: "wf-stock-boundary",
    subject: "股票长期追踪制度职责边界澄清",
    objective: "让猫之眼、猫之耳、猫之鼻检查各自执行职责边界，猫之心提供消费需求，猫之脑主持，猫爪记录并提交 Human Gate。",
    participants: ["cat_eyes", "cat_ears", "cat_nose", "cat_heart"],
    template: "stock_longterm_tracking"
  });
  assert.equal(draft.dryRun, true);
  assert.equal(draft.mutated, false);
  assert.equal(await pathExists(dbFile), false);
  assert.equal(draft.spec.governance.chairAgent, "main");
  assert.equal(draft.spec.governance.secretaryAgent, "cat_claw");
  assert.equal(draft.spec.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(draft.spec.planSpecV2.meta.workflowId, draft.spec.workflowId);
  assert.equal(draft.spec.planSpecV2.meta.traceId, draft.spec.traceId);
  assert.equal(draft.spec.planSpecV2.meta.idempotencyKey, draft.spec.idempotencyKey);
  assert.equal(draft.spec.planSpecV2.meta.timezone, "Asia/Shanghai");
  assert.equal(draft.spec.planSpecV2.phaseGraph.length, draft.spec.phases.length);
  assert.ok(draft.spec.planSpecV2.nodes.length >= draft.spec.phases.length);
  assert.ok(draft.spec.planSpecV2.nodes.every((node) => Array.isArray(node.acceptanceCriteria) && node.acceptanceCriteria.length > 0));
  assert.ok(draft.spec.planSpecV2.nodes.every((node) => node.nodeType && Array.isArray(node.inputRefs) && node.prompt && Array.isArray(node.allowedCapabilities) && node.maxAttempts >= 1 && node.policyGate && node.verifier && node.failureRoute && node.idempotencyKey));
  assert.ok(Array.isArray(draft.spec.planSpecV2.acceptance.workflowSuccess));
  assert.ok(Array.isArray(draft.spec.planSpecV2.acceptance.requiredReceipts));
  assert.equal(draft.spec.planSpecV2.verification.mode, "human_gate");
  assert.equal(draft.spec.planSpecV2.permissionPolicy.defaultOutcome, "allow");
  assert.ok(Array.isArray(draft.spec.planSpecV2.evidencePolicy.artifactRefs));
  assert.equal(draft.spec.planSpecV2.resumePolicy.checkpointBeforeSideEffect, true);
  assert.ok(draft.spec.planSpecV2.failureRoutes.every((route) => route.routeId && route.match && route.action && route.ownerAgent));
  assert.ok(draft.spec.planSpecV2.artifacts);
  assert.equal(draft.spec.planSpecV2.audit.generatedBy, "workflow.task.draft");
  assert.equal(draft.spec.planSpecV2.humanGatePolicy.required, true);
  assert.equal(draft.spec.planSpecV2.humanGatePolicy.requiresOriginalWords, true);
  assert.equal(draft.spec.planSpecV2.humanGatePolicy.submitterAgent, "cat_claw");
  assert.equal(draft.spec.planSpecV2.evidencePolicy.rawLogsInPlan, false);
  assert.ok(draft.spec.participants.some((participant) => participant.agentId === "main"));
  assert.ok(draft.spec.participants.some((participant) => participant.agentId === "cat_claw"));
  assert.ok(draft.spec.participants.some((participant) => participant.agentId === "cat_heart"));
  assert.equal(draft.spec.appendix.template, "stock_longterm_tracking");
  assert.equal(draft.spec.humanGateDraft.options.length, 3);
  assert.ok(draft.spec.humanGateDraft.controls.some((control) => control.id === "pause_workflow"));
  assert.ok(draft.spec.humanGateDraft.controls.some((control) => control.id === "terminate_workflow"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "cat_claw_secretary_present" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "three_options_required" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "pause_terminate_controls_required" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "cat_claw_audit_before_human_gate" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "plan_spec_v2_required_ids" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "plan_spec_v2_contract_shape" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "node_acceptance_required" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "human_gate_original_words_required" && gate.status === "pass"));
  const participants = new Set(draft.spec.participants.map((participant) => participant.agentId));
  for (const owner of draftPhaseOwners(draft)) assert.equal(participants.has(owner), true, `${owner} phase owner must be a participant`);
}

async function testWorkflowTaskDraftCliPurePreview() {
  const root = await tempRoot("task-draft-cli");
  const dbFile = path.join(root, "tracking.db");
  const draft = workflowCliJson([
    "workflow-task-draft",
    "--root", root,
    "--workflow", "wf-cli-draft",
    "--objective", "澄清跨 agent workflow task 默认主持、秘书、审计和 Human Gate 边界。",
    "--participant", "cat_eyes",
    "--participant", "cat_ears"
  ]);
  assert.equal(draft.dryRun, true);
  assert.equal(draft.mutated, false);
  assert.equal(await pathExists(dbFile), false);
  assert.equal(draft.spec.governance.chairAgent, "main");
  assert.equal(draft.spec.governance.secretaryAgent, "cat_claw");
}

async function testWorkflowTaskDraftNoHumanGateAndSingleTaskCompatibility() {
  const noGateRoot = await tempRoot("task-draft-no-hgate");
  const noGate = workflowCliJson([
    "workflow-task-draft",
    "--root", noGateRoot,
    "--workflow", "wf-no-hgate",
    "--human-gate", "false",
    "--objective", "澄清跨 agent workflow task 的非 Human Gate 草案路径。",
    "--participant", "cat_eyes",
    "--participant", "cat_ears"
  ]);
  assert.equal(noGate.dryRun, true);
  assert.equal(noGate.spec.governance.humanGateRequired, false);
  assert.equal(noGate.spec.planSpecV2.humanGatePolicy.required, false);
  assert.equal(noGate.spec.planSpecV2.humanGatePolicy.requiresOriginalWords, false);
  assert.equal(noGate.spec.planSpecV2.nodes.some((node) => node.humanGateRequired), false);
  assert.equal(noGate.spec.phases.some((phase) => phase.id === "human_gate_package"), false);
  assert.equal(noGate.spec.qualityGates.some((gate) => gate.status === "error"), false);

  const singleRoot = await tempRoot("task-draft-single");
  const single = workflowCliJson([
    "workflow-task",
    "--dry-run", "true",
    "--root", singleRoot,
    "--workflow", "wf-single",
    "--owner", "cat_eyes",
    "--summary", "单 agent 普通任务预览"
  ]);
  assert.equal(single.dryRun, true);
  assert.equal(single.spec.taskType, "task");
  assert.equal(single.spec.governance.crossAgent, false);
  assert.deepEqual(single.spec.participants.map((participant) => participant.agentId), ["cat_eyes"]);
  assert.equal(single.spec.phases.some((phase) => phase.ownerAgent === "cat_claw"), false);
}

async function testWorkflowTaskLaunchPrepareAndApprove() {
  const root = await tempRoot("task-launch");
  const dbFile = path.join(root, "tracking.db");
  const prepared = await runAction(root, {
    action: "workflow.task.launch.prepare",
    workflowId: "wf-task-launch",
    subject: "股票长期追踪制度职责边界澄清",
    objective: "猫爪通过多轮会话确认闪电猫意图后起草任务，猫之脑复核，闪电猫批准后启动。",
    participants: ["cat_eyes", "cat_ears", "cat_nose", "cat_heart"],
    template: "stock_longterm_tracking",
    intentSummary: "闪电猫要求 task 起草先形成 canonical JSON，而不是口头 message_flow prompt。",
    flashcatIntent: "猫爪负责意图澄清和起草，猫之脑复核，闪电猫决定是否 launch。",
    draftId: "tlp-test-launch"
  });
  assert.equal(prepared.mutated, true);
  assert.equal(prepared.status, "pending_cat_brain_review");
  assert.equal(prepared.package.roles.drafterAgent, "cat_claw");
  assert.equal(prepared.package.roles.reviewerAgent, "main");
  assert.equal(prepared.package.roles.finalApprover, "flashcat");
  assert.equal(prepared.package.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(prepared.package.planSpecV2.meta.workflowId, "wf-task-launch");
  assert.equal(prepared.package.planSpecV2.nodes.some((node) => node.phaseId === "human_gate_package" && node.humanGateRequired), true);
  assert.equal(await pathExists(path.join(root, prepared.artifacts.canonicalJson)), true);
  assert.equal(await pathExists(path.join(root, prepared.artifacts.markdown)), true);
  const canonical = JSON.parse(await fs.readFile(path.join(root, prepared.artifacts.canonicalJson), "utf8"));
  assert.equal(canonical.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(sqliteCount(dbFile, "protocol_objects", "object_type='workflow_task_launch_package'"), 1);
  assert.equal(sqliteCount(dbFile, "review_gates", "gate_type='task_launch_cat_brain_review' AND status='pending'"), 1);
  assert.equal(sqliteCount(dbFile, "artifact_index", "kind LIKE 'workflow_task_launch_package%'"), 2);
  assert.equal(sqliteCount(dbFile, "workflow_phases"), 0);
  assert.equal(sqliteCount(dbFile, "workflow_tasks"), 0);
  assert.equal(sqliteCount(dbFile, "mixed_meeting_dispatches"), 0);
  const preparedStored = sqliteJson(dbFile, "SELECT payload_json FROM protocol_objects WHERE object_id='tlp-test-launch';")[0];
  assert.equal(preparedStored.payload_json.includes("\"schemaVersion\":\"workflow_plan_spec.v2\""), true);

  const listed = await runAction(root, {
    action: "workflow.task.launch.list",
    workflowId: "wf-task-launch"
  });
  assert.equal(listed.count, 1);
  assert.equal(listed.taskLaunches[0].draftId, "tlp-test-launch");

  await assertRejectsMessage(
    () => runAction(root, { action: "workflow.task.launch.approve", draftId: "tlp-test-launch" }),
    /original words|feedbackText/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.task.launch.approve",
      draftId: "tlp-test-launch",
      feedbackText: "闪电猫原话：先试图绕过猫之脑复核。"
    }),
    /Cat Brain review/
  );

  const reviewed = await runAction(root, {
    action: "workflow.task.launch.review",
    draftId: "tlp-test-launch",
    status: "approved",
    reviewerAgent: "main",
    reviewOpinion: "猫之脑复核通过：任务包具备职责、阶段、审计和 Human Gate 启动边界。"
  });
  assert.equal(reviewed.status, "pending_flashcat_launch");
  assert.equal(sqliteCount(dbFile, "review_gates", "gate_type='task_launch_cat_brain_review' AND status='approved'"), 1);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.task.launch.prepare",
      workflowId: "wf-task-launch",
      draftId: "tlp-test-launch",
      objective: "不得覆盖已通过猫之脑复核的 package。",
      participants: ["cat_eyes", "cat_ears"]
    }),
    /cannot be overwritten/
  );

  const approved = await runAction(root, {
    action: "workflow.task.launch.approve",
    draftId: "tlp-test-launch",
    feedbackText: "闪电猫原话：批准启动，但先保持任务边界清楚，不要绕过猫爪记录。",
    approvedBy: "flashcat"
  });
  assert.equal(approved.status, "launched");
  assert.ok(approved.materializedTasks.length >= 5);
  assert.equal(approved.materializedPhases.length, prepared.package.planSpecV2.phaseGraph.length);
  assert.equal(sqliteCount(dbFile, "workflow_phases", "workflow_id='wf-task-launch'"), prepared.package.planSpecV2.phaseGraph.length);
  assert.equal(sqliteCount(dbFile, "workflow_tasks", "workflow_id='wf-task-launch'"), approved.materializedTasks.length);
  assert.equal(sqliteCount(dbFile, "mixed_meeting_dispatches"), 0);
  const phaseRows = sqliteJson(dbFile, "SELECT phase_id, phase_key, ordinal, status, owner_agents_json, plan_node_refs_json FROM workflow_phases WHERE workflow_id='wf-task-launch' ORDER BY ordinal;");
  assert.equal(phaseRows[0].phase_key, "scope");
  assert.equal(phaseRows.some((row) => row.phase_key === "human_gate_package"), true);
  assert.equal(JSON.parse(phaseRows[0].owner_agents_json).includes("main"), true);
  assert.ok(JSON.parse(phaseRows[0].plan_node_refs_json).length >= 1);
  sqliteExec(dbFile, `
INSERT INTO workflow_agent_runs(agent_run_id, workflow_id, phase_id, phase_key, task_id, dispatch_id, runtime_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref, error, payload_json, started_at, completed_at, created_at, updated_at)
VALUES ('runtime.scope-phase-id-only', 'wf-task-launch', '${phaseRows[0].phase_id}', '', '', 'dispatch-scope-phase-id-only', 'runtime-scope-phase-id-only', 'openclaw', 'main', 'acked', 1, 'input-hash', 'output-hash', 'message://scope-phase-id-only', '', '{"source":"regression"}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:02.000Z', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:02.000Z');`);
  const phaseView = await new WorkflowReadModel({ dbFile }).phases("wf-task-launch");
  assert.equal(phaseView.inferred, false);
  assert.equal(phaseView.source, "workflow_phases+workflow_tasks");
  assert.equal(phaseView.phaseCount, prepared.package.planSpecV2.phaseGraph.length);
  assert.equal(phaseView.phases[0].phaseKey, "scope");
  assert.equal(phaseView.phases[0].source, "workflow_phases");
  assert.equal(phaseView.phases[0].counts.agentRuns, 1);
  assert.equal(phaseView.phases[0].agentRuns[0].receiptRef, "message://scope-phase-id-only");
  const agentRunPhaseView = await new WorkflowReadModel({ dbFile }).agentRuns("wf-task-launch");
  assert.equal(agentRunPhaseView.phaseSummary[0].phaseKey, "scope");
  assert.equal(agentRunPhaseView.agentRuns[0].phase_key, "scope");
  const stored = sqliteJson(dbFile, "SELECT status, payload_json FROM protocol_objects WHERE object_id='tlp-test-launch';")[0];
  assert.equal(stored.status, "launched");
  assert.equal(stored.payload_json.includes("闪电猫原话：批准启动"), true);
  assert.equal(stored.payload_json.includes("\"materializedPhases\""), true);
}

async function testWorkflowPhaseReadModelFallbackWithEmptyPhaseTable() {
  const root = await tempRoot("phase-readmodel-fallback");
  const dbFile = path.join(root, "tracking.db");
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId: "wf-legacy-phase",
    workflowType: "initiative",
    status: "active",
    ownerAgent: "main",
    objective: "legacy phase fallback"
  });
  await runAction(root, {
    action: "workflow.task.create",
    workflowId: "wf-legacy-phase",
    taskId: "legacy-task",
    ownerAgent: "main",
    runtime: "openclaw",
    agentId: "main",
    phase: "legacy_phase",
    summary: "legacy task"
  });
  sqliteExec(dbFile, `
INSERT INTO workflow_agent_runs(agent_run_id, workflow_id, phase_key, task_id, dispatch_id, runtime_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref, error, payload_json, started_at, completed_at, created_at, updated_at)
VALUES ('runtime.legacy-phase-proof', 'wf-legacy-phase', 'legacy_phase', 'legacy-task', 'dispatch-legacy-phase-proof', 'runtime-legacy-phase-proof', 'openclaw', 'main', 'acked', 1, 'input-hash', 'output-hash', 'message://legacy-phase-proof', '', '{"source":"regression"}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:02.000Z', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:02.000Z');`);
  sqliteExec(dbFile, "DROP TABLE runtime_runs;");
  assert.equal(sqliteCount(dbFile, "workflow_phases", "workflow_id='wf-legacy-phase'"), 0);
  const phaseView = await new WorkflowReadModel({ dbFile }).phases("wf-legacy-phase");
  assert.equal(phaseView.inferred, true);
  assert.equal(phaseView.source, "workflow_tasks.phase");
  assert.equal(phaseView.evidenceSources.runtimeRuns, "missing_table");
  assert.equal(phaseView.phaseCount, 1);
  assert.equal(phaseView.phases[0].phaseKey, "legacy_phase");
  assert.equal(phaseView.phases[0].source, "workflow_tasks.phase");
  assert.equal(phaseView.totals.agentRuns, 1);
  assert.equal(phaseView.totals.agentWithReceipt, 1);
  assert.equal(phaseView.phases[0].counts.agentRuns, 1);
  assert.equal(phaseView.phases[0].counts.agentCompleted, 1);
  assert.equal(phaseView.phases[0].agentRuns[0].dispatchId, "dispatch-legacy-phase-proof");
  assert.equal(phaseView.phases[0].agentRuns[0].receiptRef, "message://legacy-phase-proof");
}

async function testWorkflowTaskLaunchReviewPermissions() {
  const root = await tempRoot("task-launch-permissions");
  const prepared = await runAction(root, {
    action: "workflow.task.launch.prepare",
    workflowId: "wf-task-launch-perms",
    draftId: "tlp-test-launch-perms",
    objective: "验证猫爪不能伪装猫之脑完成 task launch review。",
    participants: ["cat_eyes", "cat_ears"]
  });
  assert.equal(prepared.status, "pending_cat_brain_review");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.task.launch.review",
      draftId: "tlp-test-launch-perms",
      status: "approved",
      reviewerAgent: "main",
      callerAgent: "cat_claw",
      actor: "cat_claw",
      reviewOpinion: "伪装猫之脑复核。"
    }),
    /caller_not_registered|missing_capability|cannot impersonate/
  );
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
  const dbFile = path.join(root, "tracking.db");

  const unknownRegistryWrite = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert"
  });
  assert.equal(unknownRegistryWrite.allowed, false);
  assert.equal(unknownRegistryWrite.reason, "registry_write_local_codex_only");
  assert.equal(unknownRegistryWrite.policyOutcome, "deny");

  const hermersRegistryWrite = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert",
    callerAgent: "cat_body",
    callerRuntime: "hermers",
    sourceSystem: "hermers_mcp"
  });
  assert.equal(hermersRegistryWrite.allowed, false);
  assert.equal(hermersRegistryWrite.reason, "registry_write_local_codex_only");
  assert.equal(hermersRegistryWrite.policyOutcome, "deny");

  const localCodexRegistryWriteWithoutEnv = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert",
    callerAgent: "local_codex",
    callerRuntime: "local_codex",
    sourceSystem: "local_codex"
  });
  assert.equal(localCodexRegistryWriteWithoutEnv.allowed, false);
  assert.equal(localCodexRegistryWriteWithoutEnv.reason, "registry_write_local_codex_only");

  const localCodexRegistryWrite = await withLocalCodexRegistryWrite(() => runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert",
    callerAgent: "local_codex",
    callerRuntime: "local_codex",
    sourceSystem: "local_codex"
  }));
  assert.equal(localCodexRegistryWrite.allowed, true);
  assert.equal(localCodexRegistryWrite.reason, "trusted_operator");

  const localCodexRegistryWriteMissingRuntime = await withLocalCodexRegistryWrite(() => runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert",
    callerAgent: "local_codex",
    sourceSystem: "local_codex"
  }));
  assert.equal(localCodexRegistryWriteMissingRuntime.allowed, false);
  assert.equal(localCodexRegistryWriteMissingRuntime.reason, "registry_write_local_codex_only");

  const localCodexRegistryWriteMissingSource = await withLocalCodexRegistryWrite(() => runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert",
    callerAgent: "local_codex",
    callerRuntime: "local_codex"
  }));
  assert.equal(localCodexRegistryWriteMissingSource.allowed, false);
  assert.equal(localCodexRegistryWriteMissingSource.reason, "registry_write_local_codex_only");

  const spoofedLocalCodexFromHermers = await withLocalCodexRegistryWrite(() => runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert",
    callerAgent: "local_codex",
    callerRuntime: "local_codex",
    sourceSystem: "hermers_mcp"
  }));
  assert.equal(spoofedLocalCodexFromHermers.allowed, false);
  assert.equal(spoofedLocalCodexFromHermers.reason, "registry_write_local_codex_only");

  const meetingParticipantDenied = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.participant",
    callerAgent: "cat_body",
    callerRuntime: "hermers",
    sourceSystem: "hermers_mcp"
  });
  assert.equal(meetingParticipantDenied.allowed, false);
  assert.equal(meetingParticipantDenied.action, "meeting.runtime_participant");
  assert.equal(meetingParticipantDenied.reason, "missing_capability:dispatch.write");

  const meetingParticipantAllowed = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.participant",
    callerAgent: "local_codex",
    callerRuntime: "local_codex",
    sourceSystem: "local_codex"
  });
  assert.equal(meetingParticipantAllowed.allowed, true);
  assert.equal(meetingParticipantAllowed.action, "meeting.runtime_participant");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "runtime.agent.upsert",
      platform: "hermers",
      runtime: "hermers",
      agentId: "cat_body",
      callerAgent: "cat_body",
      callerRuntime: "hermers",
      sourceSystem: "hermers_mcp"
    }),
    /workflow permission denied: action=runtime\.agent\.upsert.*reason=registry_write_local_codex_only/
  );

  await assertRejectsMessage(
    () => runActionRaw(root, {
      action: "runtime.agent.upsert",
      platform: "hermers",
      runtime: "hermers",
      agentId: "cat_body"
    }),
    /workflow permission denied: action=runtime\.agent\.upsert.*reason=registry_write_local_codex_only/
  );

  const runtimeAgentCountBeforeParticipant = sqliteCount(dbFile, "runtime_agents");
  await runAction(root, {
    action: "runtime.participant",
    meetingId: "meeting-permission-gate",
    runtime: "hermers",
    agentId: "cat_body",
    participantRole: "participant",
    callerAgent: "local_codex",
    callerRuntime: "local_codex",
    sourceSystem: "local_codex"
  });
  assert.equal(sqliteCount(dbFile, "runtime_agents"), runtimeAgentCountBeforeParticipant);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "runtime.participant",
      meetingId: "meeting-permission-gate",
      runtime: "hermers",
      agentId: "cat_nose",
      participantRole: "participant",
      callerAgent: "local_codex",
      callerRuntime: "local_codex",
      sourceSystem: "local_codex"
    }),
    /meeting runtime participant requires pre-registered active runtime agent: hermers:cat_nose/
  );
  assert.equal(sqliteCount(dbFile, "runtime_agents"), runtimeAgentCountBeforeParticipant);

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
  assert.equal(deniedRuntime.policyOutcome, "deny");
  assert.equal(deniedRuntime.actionable, false);

  const unregisteredSpoof = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.bridge.drain",
    callerAgent: "main",
    callerRuntime: "hermers",
    toolMode: "full"
  });
  assert.equal(unregisteredSpoof.allowed, false);
  assert.equal(unregisteredSpoof.reason, "caller_not_registered");
  assert.equal(unregisteredSpoof.policyOutcome, "deny");
  assert.equal(unregisteredSpoof.actionable, false);

  const auditDenied = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "cat_claw.audit",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(auditDenied.allowed, false);
  assert.equal(auditDenied.reason, "missing_capability:cat_claw.audit");
  assert.equal(auditDenied.policyOutcome, "deny");
  assert.equal(auditDenied.actionable, false);

  const verifySpoofDenied = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.verification.record",
    callerAgent: "cat_body",
    callerRuntime: "hermers",
    toolMode: "governance"
  });
  assert.equal(verifySpoofDenied.allowed, false);
  assert.equal(verifySpoofDenied.reason, "missing_capability:workflow.verify");
  assert.equal(verifySpoofDenied.policyOutcome, "deny");
  assert.equal(verifySpoofDenied.actionable, false);

  const evaluateSpoofDenied = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.evaluate",
    callerAgent: "cat_body",
    callerRuntime: "hermers",
    toolMode: "governance"
  });
  assert.equal(evaluateSpoofDenied.allowed, false);
  assert.equal(evaluateSpoofDenied.reason, "missing_capability:workflow.verify");
  assert.equal(evaluateSpoofDenied.policyOutcome, "deny");
  assert.equal(evaluateSpoofDenied.actionable, false);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.verification.record",
      workflowId: "workflow-permission-gate",
      callerAgent: "cat_body",
      callerRuntime: "hermers",
      toolMode: "governance",
      sourceAgent: "cat_claw",
      resultType: "verifier",
      decision: "pass"
    }),
    /workflow permission denied: action=workflow\.verification\.record/
  );

  await assertRejectsMessage(
    () => runAction(root, {
      action: "runtime.bridge.drain",
      runtime: "hermers",
      callerAgent: "cat_body",
      callerRuntime: "hermers"
    }),
    /workflow permission denied: action=runtime\.bridge\.drain/
  );

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
  assert.equal(catClawGate.policyOutcome, "requires_cat_claw_audit");
  assert.equal(catClawGate.actionable, false);
  assert.equal(catClawGate.requirements.some((item) => item.type === "cat_claw_audit"), true);

  const catClawGateWithAudit = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "human_gate.request",
    callerAgent: "cat_claw",
    callerRuntime: "openclaw",
    catClawAuditId: "audit-permission-regression"
  });
  assert.equal(catClawGateWithAudit.allowed, true);
  assert.equal(catClawGateWithAudit.policyOutcome, "allow");
  assert.equal(catClawGateWithAudit.actionable, true);

  const tradeIntentPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trade.intent",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate"
  });
  assert.equal(tradeIntentPolicy.allowed, true);
  assert.equal(tradeIntentPolicy.policyOutcome, "requires_human_gate");
  assert.equal(tradeIntentPolicy.requirements.some((item) => item.type === "human_gate"), true);
  assert.equal(tradeIntentPolicy.requirements.some((item) => item.type === "cat_claw_audit"), true);
  assert.equal(tradeIntentPolicy.requirements.some((item) => item.type === "freshness_check"), true);

  const riskDecisionPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "risk.decision",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate"
  });
  assert.equal(riskDecisionPolicy.allowed, true);
  assert.equal(riskDecisionPolicy.policyOutcome, "requires_cat_claw_audit");
  assert.equal(riskDecisionPolicy.requirements.some((item) => item.type === "cat_claw_audit"), true);
  assert.equal(riskDecisionPolicy.requirements.some((item) => item.type === "freshness_check"), true);

  const riskDecisionFreshnessPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "risk.decision",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    catClawAuditId: "audit-permission-risk-decision"
  });
  assert.equal(riskDecisionFreshnessPolicy.allowed, true);
  assert.equal(riskDecisionFreshnessPolicy.policyOutcome, "requires_freshness_check");

  const riskDecisionAllowedPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "risk.decision",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    catClawAuditId: "audit-permission-risk-decision",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  });
  assert.equal(riskDecisionAllowedPolicy.allowed, true);
  assert.equal(riskDecisionAllowedPolicy.policyOutcome, "allow");
  assert.equal(riskDecisionAllowedPolicy.actionable, true);

  const tradeIntentFreshnessPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trade.intent",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    humanGateId: "hg-permission-regression",
    catClawAuditId: "audit-permission-regression"
  });
  assert.equal(tradeIntentFreshnessPolicy.allowed, true);
  assert.equal(tradeIntentFreshnessPolicy.policyOutcome, "requires_freshness_check");

  const tradeIntentAllowedPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trade.intent",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    humanGateId: "hg-permission-regression",
    catClawAuditId: "audit-permission-regression",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  });
  assert.equal(tradeIntentAllowedPolicy.allowed, true);
  assert.equal(tradeIntentAllowedPolicy.policyOutcome, "allow");
  assert.equal(tradeIntentAllowedPolicy.actionable, true);

  const receiptPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trading_core.receipt",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate"
  });
  assert.equal(receiptPolicy.allowed, true);
  assert.equal(receiptPolicy.policyOutcome, "requires_human_gate");
  assert.equal(receiptPolicy.requirements.some((item) => item.type === "human_gate"), true);
  assert.equal(receiptPolicy.requirements.some((item) => item.type === "freshness_check"), true);
  assert.equal(receiptPolicy.requirements.some((item) => item.type === "cat_claw_audit"), false);

  const receiptAllowedPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trading_core.receipt",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    humanGateId: "hg-permission-regression",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  });
  assert.equal(receiptAllowedPolicy.allowed, true);
  assert.equal(receiptAllowedPolicy.policyOutcome, "allow");
  assert.equal(receiptAllowedPolicy.actionable, true);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "risk.decision",
      workflowId: "workflow-permission-hard-risk-decision",
      traceId: "trace-permission-hard-risk-decision",
      callerAgent: "local_codex",
      riskDecisionId: "risk-permission-hard",
      proposalId: "proposal-permission-hard",
      status: "approved"
    }),
    /workflow policy blocked: action=risk\.decision policyOutcome=requires_cat_claw_audit/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "risk.decision",
      workflowId: "workflow-permission-hard-risk-draft",
      traceId: "trace-permission-hard-risk-draft",
      callerAgent: "local_codex",
      riskDecisionId: "risk-permission-draft",
      proposalId: "proposal-permission-draft",
      status: "pending"
    }),
    /workflow policy blocked: action=risk\.decision policyOutcome=requires_cat_claw_audit/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trade.intent",
      workflowId: "workflow-permission-hard-gate",
      traceId: "trace-permission-hard-gate",
      callerAgent: "local_codex"
    }),
    /workflow policy blocked: action=trade\.intent policyOutcome=requires_human_gate/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trading_core.receipt",
      workflowId: "workflow-permission-hard-receipt",
      traceId: "trace-permission-hard-receipt",
      callerAgent: "local_codex",
      intentId: "intent-missing",
      status: "accepted"
    }),
    /workflow policy blocked: action=trading_core\.receipt policyOutcome=requires_human_gate/
  );
  const hardBlockedEvents = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM workflow_events
WHERE event_type='permission.policy_blocked';`)[0];
  assert.equal(hardBlockedEvents.count, 4);

  sqliteExec(dbFile, `
INSERT INTO side_effect_ledger(side_effect_id, workflow_id, side_effect_type, status, payload_json, created_at, updated_at)
VALUES ('side-effect-other-workflow-uncertain', 'workflow-permission-gate-other', 'test', 'uncertain', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z');`);
  const otherWorkflowSideEffectIgnored = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trade.intent",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    humanGateId: "hg-permission-regression",
    catClawAuditId: "audit-permission-regression",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  });
  assert.equal(otherWorkflowSideEffectIgnored.policyOutcome, "allow");

  sqliteExec(dbFile, `
INSERT INTO side_effect_ledger(side_effect_id, workflow_id, side_effect_type, status, payload_json, created_at, updated_at)
VALUES ('side-effect-permission-uncertain', 'workflow-permission-gate', 'test', 'uncertain', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z');`);
  const sideEffectBlockedPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trade.intent",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    humanGateId: "hg-permission-regression",
    catClawAuditId: "audit-permission-regression",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  });
  assert.equal(sideEffectBlockedPolicy.policyOutcome, "side_effect_uncertain");
  assert.equal(sideEffectBlockedPolicy.requirements.some((item) => item.type === "side_effect_uncertain"), true);

  const sideEffectReceiptPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "trading_core.receipt",
    callerAgent: "local_codex",
    workflowId: "workflow-permission-gate",
    humanGateId: "hg-permission-regression",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  });
  assert.equal(sideEffectReceiptPolicy.policyOutcome, "side_effect_uncertain");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trade.intent",
      workflowId: "workflow-permission-gate",
      traceId: "trace-permission-side-effect-intent",
      callerAgent: "local_codex",
      humanGateId: "hg-permission-regression",
      catClawAuditId: "audit-permission-regression",
      freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
    }),
    /workflow policy blocked: action=trade\.intent policyOutcome=side_effect_uncertain/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "trading_core.receipt",
      workflowId: "workflow-permission-gate",
      traceId: "trace-permission-side-effect-receipt",
      callerAgent: "local_codex",
      intentId: "intent-missing",
      status: "accepted",
      humanGateId: "hg-permission-regression",
      freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
    }),
    /workflow policy blocked: action=trading_core\.receipt policyOutcome=side_effect_uncertain/
  );

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

async function testWorkflowHealthDashboard() {
  const root = await tempRoot("workflow-health-dashboard");
  await runAction(root, { action: "workflow.init" });
  const dbFile = path.join(root, "tracking.db");
  assert.equal(sqliteCount(dbFile, "readiness_snapshots"), 0);
  sqliteExec(dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES ('wf-health', 'regression', 'active', 'main', 'health regression', 'detect stuck lanes', 'dashboard reports blockers', 'manual stop', 'run', 'observe', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, routing_policy_json, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
VALUES ('hermers:cat_body', 'hermers', 'cat_body', '猫之体', '', 'active', 'hermers', 'acp', 'none', 'none', 'acp', 'none', 'hermers_acp', 'silent', 0, 1, 0, '{}', 'hermes-profile:catbody', '{}', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES
  ('dispatch-health-stale', 'wf-health', 'wf-health', 'trace-health-stale', 'idem-health-stale', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'normal', 1, 3, '', '', '', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2000-01-01T00:00:00.000Z'),
  ('dispatch-health-failed', 'wf-health', 'wf-health', 'trace-health-failed', 'idem-health-failed', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'failed', 'high', 3, 3, '', 'timeout', 'failed dispatch', 'prompt', '{}', 'main', '2026-05-31T00:00:00.000Z', '', '', '', '2026-05-31T00:00:02.000Z');
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at)
VALUES
  ('job-health-failed', 'runtime_drain', 'runtime_drain:hermers:dispatch-health-failed', 'high', 'failed', 'wf-health', 'hermers', '{}', '{}', 3, 3, '', '', '', 'failed job', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', ''),
  ('job-health-expired', 'message_flow_reconcile', 'message_flow_reconcile', 'normal', 'running', 'wf-health', '', '{}', '{}', 1, 20, '', 'worker-health', '2000-01-01T00:00:00.000Z', 'expired lease', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:02.000Z', '');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('hgate-health-no-buttons', 'human_gate_record', 'pending', NULL, 'regression', 'cat_claw', '', 'artifact://hgate-health-no-buttons', '{"workflowId":"wf-health"}', 'hash-hgate-health', '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:01.000Z');
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, outbox_id, target_runtime, target_agent_id, return_policy, status, runtime_completed_at, runtime_failed_at, final_output_present, delivery_receipt_present, last_error, created_at, updated_at)
VALUES
  ('flow-health-missing-delivery', 'trace-flow-health', 'idem-flow-health', 'wf-health', 'wf-health', 'dispatch-health-stale', '', 'hermers', 'cat_body', 'report_to_flashcat', 'runtime_completed', '2000-01-01T00:00:00.000Z', '', 1, 0, '', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:01.000Z'),
  ('flow-health-silent-completed', 'trace-flow-silent', 'idem-flow-silent', 'wf-health', 'wf-health', '', '', 'hermers', 'cat_body', 'silent', 'runtime_completed', '2000-01-01T00:00:00.000Z', '', 1, 0, '', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:01.000Z'),
  ('flow-health-local-codex-receipt', 'trace-flow-local', 'idem-flow-local', 'wf-health', 'wf-health', '', '', 'local_codex', 'codex', 'report_to_flashcat', 'runtime_completed', '2000-01-01T00:00:00.000Z', '', 1, 0, '', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:01.000Z'),
  ('flow-health-local-codex-failed', 'trace-flow-local-failed', 'idem-flow-local-failed', 'wf-health', 'wf-health', '', 'outbox-local-failed', 'local_codex', 'codex', 'report_to_flashcat', 'runtime_failed', '', '2000-01-01T00:00:00.000Z', 0, 0, 'local codex inbox failure should not require telegram reconcile', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:01.000Z');
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES
  ('runtime-health-orphan-started', 'dispatch-health-orphan', 'wf-health', 'wf-health', 'trace-runtime-orphan', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'started', '', 1, '2000-01-01T00:00:00.000Z', '', NULL, '', '', '', '', '{}'),
  ('runtime-health-paired-started', 'dispatch-health-failed', 'wf-health', 'wf-health', 'trace-runtime-paired', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'started', '', 1, '2000-01-01T00:00:00.000Z', '', NULL, '', '', '', '', '{}'),
  ('runtime-health-paired-terminal', 'dispatch-health-failed', 'wf-health', 'wf-health', 'trace-runtime-paired', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 1, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:01.000Z', 1000, '', '', '', 'terminal failure', '{}'),
  ('runtime-health-mismatch-started', 'dispatch-health-mismatch', 'wf-health', 'wf-health', 'trace-runtime-mismatch', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'started', '', 1, '2000-01-01T00:00:00.000Z', '', NULL, '', '', '', '', '{}'),
  ('runtime-health-mismatch-terminal', 'dispatch-health-mismatch', 'wf-health', 'wf-health', 'trace-runtime-mismatch', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'acked', '', 2, '2000-01-01T00:00:02.000Z', '2000-01-01T00:00:03.000Z', 1000, '', '', '', '', '{}'),
  ('runtime-health-reconcile-started', 'dispatch-health-reconcile', 'wf-health', 'wf-health', 'trace-runtime-reconcile', 'openclaw', 'main', 'openclaw', '', '', '', 'started', '', 1, '2000-01-01T00:00:00.000Z', '', NULL, '', '', '', '', '{}'),
  ('runtime-health-reconcile-terminal', 'dispatch-health-reconcile', 'wf-health', 'wf-health', 'trace-runtime-reconcile', 'openclaw', 'main', 'stale_dispatch_reconcile', '', '', '', 'failed', 'runtime_stale', 2, '2000-01-01T00:00:00.000Z', '2000-01-01T00:05:00.000Z', 300000, '', '', '', 'stale sent dispatch exceeded 300s without terminal runtime receipt', '{}');
`);
  const health = await runAction(root, {
    action: "workflow.health",
    staleDispatchAfterMs: 60_000,
    messageFlowStuckAfterMs: 60_000,
    staleHumanGateAfterMs: 60_000
  });
  assert.equal(health.schemaVersion, "workflow_health.v1");
  assert.equal(health.status, "blocked");
  assert.equal(health.readiness.snapshotId, "");
  assert.equal(sqliteCount(dbFile, "readiness_snapshots"), 0);
  assert.equal(health.lanes.dispatch.staleSent, 1);
  assert.equal(health.lanes.dispatch.failed, 1);
  assert.equal(health.lanes.controlLoop.failed, 1);
  assert.equal(health.lanes.controlLoop.expiredLeases, 1);
  assert.equal(health.lanes.runtime.failedRuns, 2);
  assert.equal(health.lanes.runtime.staleStartedRuns, 2);
  assert.equal(health.readiness.findings.find((finding) => finding.key === "stale_started_runtime_runs")?.count, 2);
  assert.equal(health.lanes.messageFlow.missingDelivery, 1);
  assert.equal(health.lanes.messageFlow.stuckAfterRuntime, 1);
  assert.equal(health.lanes.humanGate.withoutButtons, 1);
  assert.equal(health.lanes.registry.dispatchDisabled, 1);
  const blockerKeys = health.topBlockers.map((item) => item.key);
  assert.equal(blockerKeys.includes("stale_sent_dispatches"), true);
  assert.equal(blockerKeys.includes("failed_control_loop_jobs"), true);
  assert.equal(blockerKeys.includes("message_flow_delivery_missing"), true);
  assert.equal(health.nextActions.includes("workflow.dispatch.reconcile"), true);
  assert.equal(health.nextActions.includes("workflow.incident.from_dead_letter.preview"), true);

  const healthWithBadInput = await runAction(root, {
    action: "workflow.health",
    limit: "not-a-number",
    staleDispatchAfterMs: "not-a-number",
    messageFlowStuckAfterMs: "not-a-number",
    staleHumanGateAfterMs: "not-a-number"
  });
  assert.equal(healthWithBadInput.schemaVersion, "workflow_health.v1");
  assert.equal(healthWithBadInput.topBlockers.length > 0, true);
  assert.equal(sqliteCount(dbFile, "readiness_snapshots"), 0);

  const reconciled = await runAction(root, {
    action: "message_flow.reconcile",
    messageFlowStuckAfterMs: 60_000,
    limit: 10
  });
  assert.equal(reconciled.count, 1);
  assert.equal(reconciled.incidents.length, 1);
  assert.equal(reconciled.incidents[0].flowId, "flow-health-missing-delivery");

  const dashboard = await runAction(root, { action: "workflow.dashboard" });
  assert.equal(dashboard.schemaVersion, "workflow_health.v1");
  const permission = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.health",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(permission.allowed, true);
  assert.equal(permission.readOnly, true);
}

async function testWorkflowConsoleAgenticSurfaces() {
  const root = await tempRoot("workflow-console-agentic-surfaces");
  await runAction(root, { action: "workflow.init" });
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-console-agentic";
  sqliteExec(dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES ('wf-console-agentic', 'regression', 'active', 'main', 'console agentic surface regression', 'render command center and kanban state', 'all console surfaces expose stable read models', 'manual stop', 'execute', 'observe', '{}', '2026-06-13T00:00:00.000Z', '2026-06-13T00:00:10.000Z');
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, routing_policy_json, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
VALUES
  ('hermers:cat_body', 'hermers', 'cat_body', '猫之体', 'developer', 'active', 'hermers', 'acp', 'hermers', 'telegram', 'acp', 'catbody', 'hermers_acp', 'silent', 1, 1, 0, '{}', 'hermes-profile:catbody', '{}', '{}', '2026-06-13T00:00:00.000Z', '2026-06-13T00:00:01.000Z'),
  ('openclaw:cat_claw', 'openclaw', 'cat_claw', '猫爪', 'secretary', 'active', 'openclaw', 'openclaw', 'openclaw', 'telegram', 'openclaw_im', 'cat_claw', 'openclaw_agent', 'report_to_flashcat', 1, 0, 0, '{}', 'openclaw-agent:cat_claw', '{}', '{}', '2026-06-13T00:00:00.000Z', '2026-06-13T00:00:01.000Z');
INSERT INTO readiness_snapshots(snapshot_id, status, checked_at, planes_json, findings_json, payload_json)
VALUES ('readiness-console-agentic', 'degraded', '2026-06-13T00:00:15.000Z',
  '{"runtime":{"hermersProfileModes":{"profiles":{"catbody":{"observedMode":"warm","source":"fixture"},"catclaw":{"observedMode":"warm","source":"must_not_match"},"cat_claw":{"observedMode":"warm","source":"must_not_match"}}}}}',
  '[{"key":"fixture_warning","severity":"warning"}]',
  '{}');
INSERT INTO workflow_tasks(task_id, workflow_id, parent_task_id, phase, owner_agent, runtime, agent_id, task_type, status, priority, depends_on_json, expected_artifact, actual_artifact_ref, receipt_required, human_gate_required, summary, prompt, payload_json, blocked_reason, created_by, created_at, due_at, started_at, completed_at, updated_at)
VALUES
  ('task-inbox', 'wf-console-agentic', '', 'plan', 'main', 'openclaw', 'cat_claw', 'review', 'created', 'normal', '[]', '', '', 1, 0, 'Cat Claw review draft', '', '{}', '', 'main', '2026-06-13T00:00:01.000Z', '', '', '', '2026-06-13T00:00:01.000Z'),
  ('task-working', 'wf-console-agentic', '', 'execute', 'cat_body', 'hermers', 'cat_body', 'implementation', 'in_progress', 'high', '[]', 'artifact://console-work', '', 1, 0, 'Cat Body implements console surface', '', '{}', '', 'main', '2026-06-13T00:00:02.000Z', '', '2026-06-13T00:00:03.000Z', '', '2026-06-13T00:00:12.000Z'),
  ('task-waiting-human', 'wf-console-agentic', '', 'gate', 'cat_claw', 'openclaw', 'cat_claw', 'human_gate', 'in_progress', 'high', '[]', '', '', 1, 1, 'Human Gate waiting for Flashcat', '', '{}', '', 'main', '2026-06-13T00:00:03.000Z', '', '2026-06-13T00:00:04.000Z', '', '2026-06-13T00:00:13.000Z'),
  ('task-done', 'wf-console-agentic', '', 'verify', 'cat_body', 'hermers', 'cat_body', 'verification', 'done', 'normal', '[]', 'artifact://console-verification', 'artifact://console-verification', 1, 0, 'Verification complete', '', '{}', '', 'main', '2026-06-13T00:00:04.000Z', '', '2026-06-13T00:00:05.000Z', '2026-06-13T00:00:08.000Z', '2026-06-13T00:00:14.000Z'),
  ('task-blocked', 'wf-console-agentic', '', 'repair', 'cat_body', 'hermers', 'cat_body', 'repair', 'blocked', 'high', '[]', '', '', 1, 0, 'Blocked task', '', '{}', 'fixture blocker', 'main', '2026-06-13T00:00:05.000Z', '', '', '', '2026-06-13T00:00:15.000Z');
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES
  ('dispatch-queued', 'wf-console-agentic', 'wf-console-agentic', 'trace-dispatch-queued', 'idem-dispatch-queued', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'queued', 'normal', 0, 3, '', '', '', 'queued prompt', '{}', 'main', '2026-06-13T00:00:01.000Z', '', '', '', '2026-06-13T00:00:01.000Z'),
  ('dispatch-sent', 'wf-console-agentic', 'wf-console-agentic', 'trace-dispatch-sent', 'idem-dispatch-sent', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'high', 1, 3, '', '', '', 'sent prompt', '{}', 'main', '2026-06-13T00:00:02.000Z', '2026-06-13T00:00:03.000Z', '', '', '2026-06-13T00:00:03.000Z'),
  ('dispatch-failed', 'wf-console-agentic', 'wf-console-agentic', 'trace-dispatch-failed', 'idem-dispatch-failed', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'failed', 'high', 3, 3, '', 'timeout', 'fixture dispatch failure', 'failed prompt', '{}', 'main', '2026-06-13T00:00:04.000Z', '', '', '', '2026-06-13T00:00:16.000Z');
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES
  ('runtime-working', 'dispatch-sent', 'wf-console-agentic', 'wf-console-agentic', 'trace-runtime-working', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'started', '', 1, '2026-06-13T00:00:20.000Z', '', NULL, '', '', '', '', '{}'),
  ('runtime-failed', 'dispatch-failed', 'wf-console-agentic', 'wf-console-agentic', 'trace-runtime-failed', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'timeout', 3, '2026-06-13T00:00:04.000Z', '2026-06-13T00:00:16.000Z', 12000, '', '', '', 'fixture runtime failure', '{}'),
  ('runtime-old-completed', 'dispatch-sent', 'wf-console-agentic', 'wf-console-agentic', 'trace-runtime-old', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'completed', '', 1, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:01.000Z', 1000, '', '', '', '', '{}');
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, runtime_run_id, message_id, outbox_id, source_channel, source_system, source_runtime, source_account_id, source_chat_id, sender_id, source_message_id, route_agent_id, route_runtime, target_runtime, target_agent_id, target_platform, workflow_ingress_adapter, im_identity, execution_identity, return_policy, status, inbound_received_at, route_registered_at, runtime_dispatched_at, runtime_completed_at, runtime_failed_at, outbound_queued_at, telegram_sent_at, telegram_failed_at, completed_at, failure_type, last_error, final_output_present, delivery_receipt_present, payload_json, created_at, updated_at)
VALUES
  ('flow-waiting-receipt', 'trace-flow-waiting', 'idem-flow-waiting', 'wf-console-agentic', 'wf-console-agentic', 'dispatch-sent', '', '', '', 'telegram', 'workflow', 'openclaw', '', '', 'main', '', 'cat_body', 'hermers', 'hermers', 'cat_body', 'hermers', 'acp', 'catbody', 'hermers_acp', 'report_to_flashcat', 'runtime_completed', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:02.000Z', '2026-06-13T00:00:03.000Z', '2026-06-13T00:00:10.000Z', '', '', '', '', '', '', '', 1, 0, '{}', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:10.000Z'),
  ('flow-done', 'trace-flow-done', 'idem-flow-done', 'wf-console-agentic', 'wf-console-agentic', 'dispatch-sent', '', '', '', 'telegram', 'workflow', 'openclaw', '', '', 'main', '', 'cat_body', 'hermers', 'hermers', 'cat_body', 'hermers', 'acp', 'catbody', 'hermers_acp', 'silent', 'runtime_completed', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:02.000Z', '2026-06-13T00:00:03.000Z', '2026-06-13T00:00:11.000Z', '', '', '', '', '', '', '', 1, 0, '{}', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:11.000Z'),
  ('flow-failed', 'trace-flow-failed', 'idem-flow-failed', 'wf-console-agentic', 'wf-console-agentic', 'dispatch-failed', '', '', '', 'telegram', 'workflow', 'openclaw', '', '', 'main', '', 'cat_body', 'hermers', 'hermers', 'cat_body', 'hermers', 'acp', 'catbody', 'hermers_acp', 'report_to_flashcat', 'runtime_failed', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:02.000Z', '2026-06-13T00:00:03.000Z', '', '2026-06-13T00:00:16.000Z', '', '', '', '', 'timeout', 'fixture flow failure', 0, 0, '{}', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:16.000Z');
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES
  ('outbox-queued', 'wf-console-agentic', 'private_chat', 'flashcat', 'human_gate', 'queued', 'pending human gate', '{}', '2026-06-13T00:00:06.000Z', '2026-06-13T00:00:06.000Z'),
  ('outbox-sent', 'wf-console-agentic', 'private_chat', 'flashcat', 'status', 'sent', 'delivered status', '{}', '2026-06-13T00:00:07.000Z', '2026-06-13T00:00:07.000Z'),
  ('outbox-failed', 'wf-console-agentic', 'private_chat', 'flashcat', 'human_gate', 'failed', 'failed human gate', '{}', '2026-06-13T00:00:08.000Z', '2026-06-13T00:00:08.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('hgate-console', 'human_gate_record', 'pending', NULL, 'regression', 'cat_claw', '', 'artifact://hgate-console', '{"workflowId":"wf-console-agentic","summary":"Fixture Human Gate"}', 'hash-hgate-console', '2026-06-13T00:00:09.000Z', '2026-06-13T00:00:09.000Z');
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('hgate-other-agent', 'human_gate_record', 'pending', NULL, 'regression', 'cat_ears', '', 'artifact://hgate-other-agent', '{"workflowId":"wf-console-agentic","summary":"Other agent Human Gate"}', 'hash-hgate-other-agent', '2026-06-13T00:00:09.500Z', '2026-06-13T00:00:09.500Z');
INSERT INTO human_gate_buttons(button_id, callback_token, human_gate_id, workflow_id, meeting_id, label, decision_status, button_role, artifact_ref, summary, prompt, payload_json, status, created_by, created_at, updated_at, selected_by, selected_at, callback_chat_id, callback_message_id, feedback_status, feedback_text, feedback_received_at, feedback_payload_json)
VALUES ('button-console-a', 'token-console-a', 'hgate-console', 'wf-console-agentic', 'wf-console-agentic', '方案 A', 'approved', 'approve', 'artifact://hgate-console', 'approve fixture', 'prompt', '{}', 'active', 'cat_claw', '2026-06-13T00:00:09.000Z', '2026-06-13T00:00:09.000Z', '', '', '', '', '', '', '', '{}');
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES ('checkpoint-console', 'wf-console-agentic', 'active', 'execute', 'continue', 'Console checkpoint', '{}', '[]', '["task-blocked"]', '["artifact://console-verification"]', '["continue"]', '{}', 'artifact://checkpoint-console', 'main', '2026-06-13T00:00:10.000Z');
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES ('artifact-console', NULL, 'wf-console-agentic', 'report', 'artifact://console-verification', 'Console verification artifact', 'cat_body', '2026-06-13T00:00:11.000Z');
INSERT INTO workflow_verification_results(verification_id, workflow_id, phase_id, phase_key, task_id, agent_run_id, dispatch_id, runtime_run_id, result_type, decision, verifier_agent, refuter_agent, source_runtime, source_agent, confidence, risk_band, summary, findings_json, recommendations_json, evidence_refs_json, artifact_refs_json, receipt_refs_json, payload_hash, payload_json, created_by, created_at)
VALUES ('verification-console', 'wf-console-agentic', '', 'verify', 'task-done', '', 'dispatch-sent', 'runtime-working', 'regression', 'pass', 'cat_claw', '', 'openclaw', 'cat_claw', 'high', 'low', 'Console verification passed', '[]', '[]', '[]', '["artifact://console-verification"]', '["flow-done"]', 'hash-verification-console', '{}', 'cat_claw', '2026-06-13T00:00:12.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-console', 'investigating', 'workflow', '["workflow"]', 'Console fixture incident', 'main', 'low', 'fixture', 'observe', 'rollback fixture', 'close fixture', '[]', '{"workflowId":"wf-console-agentic"}', '2026-06-13T00:00:13.000Z', '2026-06-13T00:30:13.000Z', '', '2026-06-13T00:00:13.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-other-agent', 'investigating', 'workflow', '["workflow"]', 'Other agent fixture incident', 'cat_ears', 'low', 'fixture', 'observe', 'rollback fixture', 'close fixture', '[]', '{"workflowId":"wf-console-agentic","agentId":"cat_ears"}', '2026-06-13T00:00:14.000Z', '2026-06-13T00:30:14.000Z', '', '2026-06-13T00:00:14.000Z');
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at)
VALUES ('job-console-queued', 'runtime_drain', 'runtime_drain:hermers:dispatch-queued', 'normal', 'queued', 'wf-console-agentic', 'hermers', '{"agentId":"cat_body"}', '{}', 0, 20, '2026-06-13T00:01:00.000Z', '', '', '', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:01.000Z', '');
`);

  const semanticAck = await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "semantic_ack",
    eventTime: "2026-06-13T00:00:21.000Z",
    workflowId,
    taskId: "task-working",
    dispatchId: "dispatch-sent",
    traceId: "trace-runtime-current-state",
    runtime: "hermers",
    agentId: "cat_body",
    runtimeRunId: "runtime-working",
    stage: "implement_console_state_projection",
    idempotencyKey: "runtime-current-state-semantic-ack",
    payload: { note: "semantic ack visible to console", token: "must-redact" }
  });
  assert.equal(semanticAck.schemaVersion, "workflow_runtime_semantic_event.v1");
  assert.equal(semanticAck.currentState.status, "working");
  assert.equal(semanticAck.currentState.semanticAckAt, "2026-06-13T00:00:21.000Z");
  const duplicateSemanticAck = await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "semantic_ack",
    eventTime: "2026-06-13T00:00:21.000Z",
    workflowId,
    taskId: "task-working",
    dispatchId: "dispatch-sent",
    traceId: "trace-runtime-current-state",
    runtime: "hermers",
    agentId: "cat_body",
    runtimeRunId: "runtime-working",
    stage: "implement_console_state_projection",
    idempotencyKey: "runtime-current-state-semantic-ack",
    payload: { note: "semantic ack visible to console", token: "must-redact" }
  });
  assert.equal(duplicateSemanticAck.event.deduped, true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.runtime_event.record",
      eventType: "semantic_ack",
      eventTime: "2026-06-13T00:00:21.000Z",
      workflowId,
      taskId: "task-working",
      dispatchId: "dispatch-sent",
      traceId: "trace-runtime-current-state",
      runtime: "hermers",
      agentId: "cat_body",
      runtimeRunId: "runtime-working",
      stage: "implement_console_state_projection",
      artifactUri: "artifact://conflicting-runtime-state",
      latestReceiptRef: "receipt://conflicting-runtime-state",
      staleKind: "ack_only",
      idempotencyKey: "runtime-current-state-semantic-ack",
      payload: { note: "semantic ack visible to console", token: "must-redact" }
    }),
    /runtime semantic event idempotency conflict/
  );
  await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "artifact_created",
    eventTime: "2026-06-13T00:00:22.000Z",
    workflowId,
    taskId: "task-working",
    dispatchId: "dispatch-sent",
    traceId: "trace-runtime-current-state",
    runtime: "hermers",
    agentId: "cat_body",
    runtimeRunId: "runtime-working",
    stage: "publish_console_artifact",
    artifactUri: "artifact://console-runtime-state",
    latestReceiptRef: "receipt://console-runtime-state",
    idempotencyKey: "runtime-current-state-artifact"
  });
  const olderBackfill = await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "blocked",
    eventTime: "2026-06-13T00:00:20.000Z",
    workflowId,
    taskId: "task-working",
    dispatchId: "dispatch-sent",
    traceId: "trace-runtime-current-state",
    runtime: "hermers",
    agentId: "cat_body",
    stage: "older_backfill_should_not_regress_current_state",
    blockedReason: "older backfill",
    idempotencyKey: "runtime-current-state-older-backfill"
  });
  assert.equal(olderBackfill.currentState.currentStage, "publish_console_artifact");
  assert.equal(olderBackfill.currentState.status, "working");
  const sameTimestampLowerSequence = await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "blocked",
    eventTime: "2026-06-13T00:00:22.000Z",
    eventSequence: 1,
    workflowId,
    taskId: "task-working",
    dispatchId: "dispatch-sent",
    traceId: "trace-runtime-current-state",
    runtime: "hermers",
    agentId: "cat_body",
    stage: "same_timestamp_lower_sequence_should_not_regress",
    blockedReason: "same timestamp lower sequence",
    idempotencyKey: "runtime-current-state-same-timestamp-lower-sequence"
  });
  assert.equal(sameTimestampLowerSequence.currentState.currentStage, "publish_console_artifact");
  assert.equal(sameTimestampLowerSequence.currentState.status, "working");
  const staleState = await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "blocked",
    eventTime: "2026-06-13T00:00:23.000Z",
    workflowId,
    taskId: "task-working",
    dispatchId: "dispatch-sent",
    traceId: "trace-runtime-current-state",
    runtime: "hermers",
    agentId: "cat_body",
    stage: "waiting_for_receipt",
    blockedReason: "receipt missing",
    staleKind: "receipt_missing",
    idempotencyKey: "runtime-current-state-stale"
  });
  assert.equal(staleState.currentState.status, "blocked");
  assert.equal(staleState.currentState.latestArtifactRef, "artifact://console-runtime-state");
  assert.equal(staleState.currentState.staleKind, "receipt_missing");
  const newDispatchState = await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "semantic_ack",
    eventTime: "2026-06-13T00:00:24.000Z",
    workflowId,
    taskId: "task-new-dispatch",
    dispatchId: "dispatch-new",
    traceId: "trace-runtime-current-state-new",
    runtime: "hermers",
    agentId: "cat_body",
    runtimeRunId: "runtime-new",
    stage: "new_dispatch_working",
    idempotencyKey: "runtime-current-state-new-dispatch"
  });
  assert.equal(newDispatchState.currentState.currentStage, "new_dispatch_working");
  assert.equal(newDispatchState.currentState.activeDispatchId, "dispatch-new");
  assert.equal(newDispatchState.currentState.semanticAckAt, "2026-06-13T00:00:24.000Z");
  assert.equal(newDispatchState.currentState.latestArtifactRef, "");
  assert.equal(newDispatchState.currentState.latestReceiptRef, "");
  assert.equal(newDispatchState.currentState.staleKind, "");
  assert.equal(newDispatchState.currentState.blockedReason, "");
  const runtimeEvents = await runAction(root, {
    action: "workflow.runtime_event.list",
    workflowId,
    runtime: "hermers",
    agentId: "cat_body",
    order: "asc"
  });
  assert.equal(runtimeEvents.count, 6);
  assert.equal(JSON.stringify(runtimeEvents.events).includes("must-redact"), false);
  const runtimeCurrentState = await runAction(root, {
    action: "workflow.runtime_current_state",
    workflowId,
    runtime: "hermers",
    agentId: "cat_body"
  });
  assert.equal(runtimeCurrentState.count, 1);
  assert.equal(runtimeCurrentState.states[0].activeDispatchId, "dispatch-new");
  assert.equal(runtimeCurrentState.states[0].latestArtifactRef, "");
  assert.equal(runtimeCurrentState.states[0].semanticAckAt, "2026-06-13T00:00:24.000Z");

  const readModel = new WorkflowReadModel({ dbFile });
  const currentStateApi = await readModel.runtimeCurrentState({ workflowId, agentId: "cat_body" });
  assert.equal(currentStateApi.schemaVersion, "workflow_runtime_current_state.v1");
  assert.equal(currentStateApi.states[0].currentStage, "new_dispatch_working");
  const command = await readModel.commandCenter();
  assert.equal(command.schemaVersion, "workflow_console_command_center.v1");
  assert.equal(command.workflowSummary.total >= 1, true);
  assert.equal(command.runtimeSummary.total, 2);
  assert.equal(command.runtimeSummary.dispatchable, 2);
  assert.equal(command.attention.critical.includes("failed_dispatches"), true);
  assert.equal(command.communication.messageFlow.runtime_completed >= 2, true);

  const agentBoard = await readModel.agentBoard();
  assert.equal(agentBoard.schemaVersion, "workflow_console_agent_board.v1");
  const catBody = agentBoard.agents.find((agent) => agent.agentId === "cat_body");
  const catClaw = agentBoard.agents.find((agent) => agent.agentId === "cat_claw");
  assert.equal(catBody?.profileMode?.observedMode, "warm");
  assert.equal(catBody?.currentState?.currentStage, "new_dispatch_working");
  assert.equal(catBody?.currentState?.latestArtifactRef, "");
  assert.equal(catBody?.counts.currentStates, 1);
  assert.equal(catClaw?.platform, "openclaw");
  assert.equal(catClaw?.runtime, "openclaw");
  assert.equal(catClaw?.endpointRef, "openclaw-agent:cat_claw");
  assert.equal(catClaw?.profileMode, null);
  const limitedAgentBoard = await readModel.agentBoard({ limit: 1 });
  const limitedCatBody = limitedAgentBoard.agents.find((agent) => agent.agentId === "cat_body");
  assert.equal(limitedCatBody?.counts.working > 0, true);

  const kanban = await readModel.kanban({ workflowId });
  assert.equal(kanban.schemaVersion, "workflow_console_kanban.v1");
  for (const columnId of ["inbox", "queued", "dispatched", "working", "waiting_receipt", "waiting_human", "blocked", "done", "failed"]) {
    assert.equal(Object.hasOwn(kanban.summary.byColumn, columnId), true);
  }
  assert.equal(kanban.summary.byColumn.queued > 0, true);
  assert.equal(kanban.summary.byColumn.working > 0, true);
  assert.equal(kanban.summary.byColumn.waiting_receipt > 0, true);
  assert.equal(kanban.summary.byColumn.waiting_human > 0, true);
  assert.equal(kanban.summary.byColumn.done > 0, true);
  assert.equal(kanban.summary.byColumn.failed > 0, true);
  assert.equal(kanban.columns.find((column) => column.id === "waiting_receipt")?.cards.some((card) => card.source === "message_flows" && card.sourceId === "flow-waiting-receipt"), true);
  assert.equal(kanban.columns.find((column) => column.id === "working")?.cards.some((card) => card.source === "runtime_current_state" && card.sourceId === "hermers:cat_body"), true);
  const globalKanban = await readModel.kanban({});
  const globalIncidentCard = globalKanban.columns.flatMap((column) => column.cards).find((card) => card.source === "incident_states" && card.sourceId === "incident-console");
  assert.equal(globalIncidentCard?.workflowId, workflowId);
  const agentKanban = await readModel.kanban({ agentId: "cat_body" });
  const agentScopedCards = agentKanban.columns.flatMap((column) => column.cards);
  assert.equal(agentScopedCards.length > 0, true);
  assert.equal(agentScopedCards.some((card) => ["cat_claw", "cat_ears", "main"].includes(card.agentId)), false);

  const evidenceDesk = await readModel.evidenceDesk(workflowId);
  assert.equal(evidenceDesk.schemaVersion, "workflow_console_evidence_desk.v1");
  assert.equal(evidenceDesk.workflowId, workflowId);
  assert.equal(["ready", "needs_attention"].includes(evidenceDesk.status), true);
  assert.equal(evidenceDesk.summary.evidenceArtifacts, 1);
  assert.equal(evidenceDesk.summary.checkpoints, 1);
  assert.equal(evidenceDesk.summary.messageFlows >= 3, true);
  assert.equal(evidenceDesk.summary.outbox, 3);
  assert.equal(evidenceDesk.summary.missingEvidence.includes("message_flow_closure"), true);

  const routedEvidenceDesk = await workflowChildPayload(readModel, workflowId, "evidence-desk");
  assert.equal(routedEvidenceDesk.schemaVersion, "workflow_console_evidence_desk.v1");
  assert.equal(routedEvidenceDesk.workflowId, workflowId);
}

async function testWorkflowHealthTerminalFailedDispatchIsDegraded() {
  const root = await tempRoot("workflow-health-terminal-failed-dispatch");
  await runAction(root, { action: "workflow.init" });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES ('wf-terminal-failed-dispatch', 'regression', 'active', 'main', 'terminal failed dispatch health regression', 'distinguish dead letter evidence from live blockers', 'terminal failed dispatches degrade health only', 'manual stop', 'run', 'observe', '{}', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:01.000Z');
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, routing_policy_json, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
VALUES ('hermers:cat_body', 'hermers', 'cat_body', '猫之体', '', 'active', 'hermers', 'acp', 'none', 'none', 'acp', 'none', 'hermers_acp', 'silent', 1, 1, 0, '{}', 'hermes-profile:catbody', '{}', '{}', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:01.000Z');
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES ('dispatch-terminal-failed-only', 'wf-terminal-failed-dispatch', 'wf-terminal-failed-dispatch', 'trace-terminal-failed-only', 'idem-terminal-failed-only', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'failed', 'normal', 3, 3, '', 'timeout', 'terminal failed dispatch', 'prompt', '{}', 'main', '2026-06-12T00:00:00.000Z', '', '', '', '2026-06-12T00:00:02.000Z');
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, outbox_id, target_runtime, target_agent_id, return_policy, status, runtime_completed_at, runtime_failed_at, final_output_present, delivery_receipt_present, last_error, payload_json, created_at, updated_at)
VALUES ('flow-terminal-failed-only', 'trace-terminal-failed-only', 'idem-flow-terminal-failed-only', 'wf-terminal-failed-dispatch', 'wf-terminal-failed-dispatch', 'dispatch-terminal-failed-only', '', 'hermers', 'cat_body', 'silent', 'runtime_failed', '', '2026-06-12T00:00:02.000Z', 0, 0, 'terminal failed flow', '{}', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:02.000Z');
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES ('runtime-terminal-failed-only', 'dispatch-terminal-failed-only', 'wf-terminal-failed-dispatch', 'wf-terminal-failed-dispatch', 'trace-terminal-failed-only', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'timeout', 3, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:02.000Z', 2000, '', '', '', 'terminal failed runtime', '{}');
`);

  const health = await runAction(root, { action: "workflow.health" });
  assert.equal(health.schemaVersion, "workflow_health.v1");
  assert.equal(health.status, "degraded");
  assert.equal(health.lanes.dispatch.failed, 1);
  const failedDispatchBlocker = health.topBlockers.find((item) => item.key === "failed_dispatches");
  assert.equal(failedDispatchBlocker?.severity, "warning");
  assert.equal(failedDispatchBlocker?.evidence?.terminal, true);
  assert.equal(health.nextActions.includes("workflow.incident.from_dead_letter.preview"), true);

  sqliteExec(dbFile, `
UPDATE mixed_meeting_dispatches
SET payload_json='{"healthArchive":{"status":"archived","reason":"missing resolved incident closeout evidence","archivedAt":"2026-06-12T00:00:03.000Z","dispatchId":"dispatch-terminal-failed-only","incidentId":"incident-terminal-failed-closeout","humanGateId":"hgate-terminal-failed-closeout","artifactRef":"bridge/incident-closeout/terminal-failed-closeout.json"}}'
WHERE dispatch_id='dispatch-terminal-failed-only';
`);
  const unsupportedArchiveHealth = await runAction(root, { action: "workflow.health" });
  assert.equal(unsupportedArchiveHealth.status, "degraded");
  assert.equal(unsupportedArchiveHealth.lanes.dispatch.failed, 1);
  assert.equal(unsupportedArchiveHealth.lanes.dispatch.archivedFailed, 0);
  assert.equal(unsupportedArchiveHealth.topBlockers.some((item) => item.key === "failed_dispatches"), true);

  sqliteExec(dbFile, `
UPDATE message_flows
SET payload_json='{malformed'
WHERE flow_id='flow-terminal-failed-only';
`);
  const malformedPayloadHealth = await runAction(root, { action: "workflow.health" });
  assert.equal(malformedPayloadHealth.schemaVersion, "workflow_health.v1");
  assert.equal(malformedPayloadHealth.lanes.messageFlow.failed, 1);
  assert.equal(malformedPayloadHealth.lanes.messageFlow.archivedFailed, 0);

  const recentRuntimeAt = new Date().toISOString();
  sqliteExec(dbFile, `
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-terminal-failed-closeout', 'resolved', 'normal', '["dispatch","message_flow","runtime"]', 'terminal failed archive closeout', 'workflow', 'terminal failures are covered by approved closeout', 'covered by resolved closeout evidence', 'archive health blocker only', 'remove archive marker if evidence is invalid', 'Human Gate approved closeout', '[]', '{"workflowId":"wf-terminal-failed-dispatch","closeoutResolution":{"schemaVersion":"workflow_incident_closeout_resolution.v1","humanGateId":"hgate-terminal-failed-closeout","artifactRef":"bridge/incident-closeout/terminal-failed-closeout.json","buttonId":"hgatebtn-terminal-failed-closeout","optionId":"A"}}', '2026-06-12T00:00:00.000Z', '', '2026-06-12T00:00:03.000Z', '2026-06-12T00:00:03.000Z');
UPDATE message_flows
SET payload_json='{"healthArchive":{"status":"archived","reason":"covered by resolved incident closeout","archivedAt":"2026-06-12T00:00:03.000Z","flowId":"flow-terminal-failed-only","incidentId":"incident-terminal-failed-closeout","humanGateId":"hgate-terminal-failed-closeout","artifactRef":"bridge/incident-closeout/terminal-failed-closeout.json"}}'
WHERE flow_id='flow-terminal-failed-only';
UPDATE runtime_runs
SET started_at='${recentRuntimeAt}',
    completed_at='${recentRuntimeAt}',
    payload_json='{"healthArchive":{"status":"archived","reason":"covered by resolved incident closeout","archivedAt":"2026-06-12T00:00:03.000Z","runtimeRunId":"runtime-terminal-failed-only","incidentId":"incident-terminal-failed-closeout","humanGateId":"hgate-terminal-failed-closeout","artifactRef":"bridge/incident-closeout/terminal-failed-closeout.json"}}'
WHERE runtime_run_id='runtime-terminal-failed-only';
`);
  const archivedHealth = await runAction(root, { action: "workflow.health" });
  assert.equal(archivedHealth.schemaVersion, "workflow_health.v1");
  assert.equal(archivedHealth.status, "ready");
  assert.equal(archivedHealth.readiness.findings.some((item) => item.key === "recent_runtime_failures"), false);
  assert.equal(archivedHealth.lanes.dispatch.failed, 0);
  assert.equal(archivedHealth.lanes.dispatch.archivedFailed, 1);
  assert.equal(archivedHealth.lanes.messageFlow.failed, 0);
  assert.equal(archivedHealth.lanes.messageFlow.archivedFailed, 1);
  assert.equal(archivedHealth.lanes.runtime.failedRuns, 0);
  assert.equal(archivedHealth.lanes.runtime.archivedFailedRuns, 1);
  assert.equal(archivedHealth.topBlockers.some((item) => item.key === "failed_dispatches"), false);
}

async function testWorkflowHealthOpenIncidentsAreVisible() {
  const root = await tempRoot("workflow-health-open-incidents");
  await runAction(root, { action: "workflow.init" });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES ('wf-open-incident-health', 'regression', 'active', 'main', 'open incident health regression', 'surface incident backlog in health', 'open incidents are visible', 'manual stop', 'run', 'observe', '{}', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:01.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES
  ('incident-health-open', 'active', 'degraded', '["workflow"]', 'open incident health regression', 'main', 'open incident should be visible', 'incident is still open', 'prepare closeout package', 'rollback boundary recorded', 'closeout evidence recorded', '[]', '{"workflowId":"wf-open-incident-health"}', '2026-06-10T00:00:00.000Z', '', '', '2026-06-10T00:00:01.000Z'),
  ('incident-health-resolved', 'resolved', 'normal', '["workflow"]', 'resolved incident health regression', 'main', 'resolved incident should not block', 'incident is resolved', 'none', 'rollback boundary recorded', 'resolved evidence recorded', '[]', '{"workflowId":"wf-open-incident-health"}', '2026-06-10T00:00:00.000Z', '', '2026-06-10T00:00:02.000Z', '2026-06-10T00:00:02.000Z'),
  ('incident-health-cancelled', 'cancelled', 'normal', '["workflow"]', 'cancelled incident health regression', 'main', 'cancelled incident should not block', 'incident is cancelled', 'none', 'rollback boundary recorded', 'cancelled evidence recorded', '[]', '{"workflowId":"wf-open-incident-health"}', '2026-06-10T00:00:00.000Z', '', '', '2026-06-10T00:00:03.000Z');
`);

  const health = await runAction(root, {
    action: "workflow.health",
    staleIncidentAfterMs: 60 * 60_000
  });
  assert.equal(health.schemaVersion, "workflow_health.v1");
  assert.equal(health.status, "degraded");
  assert.equal(health.lanes.incidents.open, 1);
  assert.equal(health.lanes.incidents.staleOpen, 1);
  assert.equal(health.lanes.incidents.resolved, 1);
  assert.equal(health.lanes.incidents.cancelled, 1);
  assert.equal(health.topBlockers.some((item) => item.key === "open_incidents" && item.severity === "warning"), true);
  assert.equal(health.topBlockers.some((item) => item.key === "stale_open_incidents" && item.severity === "warning"), true);
  assert.equal(health.nextActions.includes("workflow.incident.closeout.worklist.preview"), true);
  assert.equal(health.nextActions.includes("workflow.incident.closeout.evidence.preview"), true);
  assert.equal(health.nextActions.includes("workflow.incident.closeout.cat_claw_report.preview"), true);
  assert.equal(
    health.nextActions.indexOf("workflow.incident.closeout.worklist.preview") < health.nextActions.indexOf("workflow.incident.closeout.evidence.preview"),
    true
  );
  assert.equal(
    health.nextActions.indexOf("workflow.incident.closeout.evidence.preview") < health.nextActions.indexOf("workflow.incident.closeout.cat_claw_report.preview"),
    true
  );
}

async function testWorkflowReadinessRecoveredRuntimeFailures() {
  const root = await tempRoot("workflow-readiness-recovered-runtime-failures");
  await runAction(root, { action: "workflow.init" });
  const dbFile = path.join(root, "tracking.db");
  const ts = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
  const recoveredFailedAt = ts(-5 * 60_000);
  const recoveredAckedAt = ts(-4 * 60_000);
  const activeFailedAt = ts(-3 * 60_000);
  const earlyAckedAt = ts(-2 * 60_000);
  const earlyFailedAt = ts(-90_000);
  const lowerAttemptFailedAt = ts(-60_000);
  const lowerAttemptAckedAt = ts(-30_000);
  const diagnosticFailedAt = ts(-20_000);
  const smokeFailedAt = ts(-10_000);
  const malformedFailedAt = ts(-5_000);
  sqliteExec(dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES
  ('dispatch-diagnostic-explicit', 'workflow-local-diagnostic-explicit', 'workflow-local-diagnostic-explicit', 'trace-diagnostic-explicit', 'idem-diagnostic-explicit', 'hermers', 'cat_eyes', 'hermers:cat_eyes', 'message_flow_send', 'failed', 'normal', 1, 1, '', 'runtime_timeout', 'expected diagnostic failure', 'Subject: readiness diagnostic', '{"payload":{"readiness":{"ignore":true},"messageType":"internal_notice","subject":"readiness diagnostic","source":{"senderId":"local_codex","sourceSystem":"workflow.message_flow.send"}}}', 'local_codex:local_codex', '${ts(-30_000)}', '${ts(-25_000)}', '', '', '${smokeFailedAt}'),
  ('dispatch-smoke-not-explicit', 'workflow-local-smoke-negative', 'workflow-local-smoke-negative', 'trace-smoke-negative', 'idem-smoke-negative', 'hermers', 'cat_eyes', 'hermers:cat_eyes', 'message_flow_send', 'failed', 'normal', 1, 1, '', 'runtime_timeout', 'real failure with smoke text', 'Subject: readiness smoke\\n\\n用于验证真实失败仍然计数', '{"payload":{"messageType":"internal_notice","subject":"readiness smoke","source":{"senderId":"local_codex","sourceSystem":"workflow.message_flow.send"}}}', 'local_codex:local_codex', '${ts(-30_000)}', '${ts(-25_000)}', '', '', '${smokeFailedAt}');
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES
  ('runtime-recovered-failed', 'dispatch-runtime-recovered', '', '', 'trace-runtime-recovered', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'acp_unavailable', 1, '${ts(-6 * 60_000)}', '${recoveredFailedAt}', 1000, '', '', '', 'failed before retry', '{}'),
  ('runtime-recovered-acked', 'dispatch-runtime-recovered', '', '', 'trace-runtime-recovered', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'acked', '', 2, '${recoveredFailedAt}', '${recoveredAckedAt}', 1000, '', '', '', '', '{}'),
  ('runtime-active-failed', 'dispatch-runtime-active-failed', '', '', 'trace-runtime-active-failed', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 1, '${ts(-4 * 60_000)}', '${activeFailedAt}', 1000, '', '', '', 'still failed', '{}'),
  ('runtime-early-acked', 'dispatch-runtime-early-ack', '', '', 'trace-runtime-early-ack', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'acked', '', 1, '${ts(-3 * 60_000)}', '${earlyAckedAt}', 1000, '', '', '', '', '{}'),
  ('runtime-early-failed', 'dispatch-runtime-early-ack', '', '', 'trace-runtime-early-ack', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 1, '${earlyAckedAt}', '${earlyFailedAt}', 1000, '', '', '', 'ack completed before failure', '{}'),
  ('runtime-lower-attempt-failed', 'dispatch-runtime-lower-attempt', '', '', 'trace-runtime-lower-attempt', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 2, '${ts(-2 * 60_000)}', '${lowerAttemptFailedAt}', 1000, '', '', '', 'higher attempt failed', '{}'),
  ('runtime-lower-attempt-acked', 'dispatch-runtime-lower-attempt', '', '', 'trace-runtime-lower-attempt', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'acked', '', 1, '${lowerAttemptFailedAt}', '${lowerAttemptAckedAt}', 1000, '', '', '', '', '{}'),
  ('runtime-diagnostic-payload-failed', 'dispatch-diagnostic-payload', '', '', 'trace-diagnostic-payload', 'hermers', 'cat_eyes', 'hermes_acp', '', '', '', 'failed', 'ack_contract_violation', 1, '${ts(-25_000)}', '${diagnosticFailedAt}', 1000, '', '', '', 'expected diagnostic failure', '{"readiness":{"ignore":true,"reason":"expected fail-closed smoke"}}'),
  ('runtime-diagnostic-explicit-failed', 'dispatch-diagnostic-explicit', 'workflow-local-diagnostic-explicit', 'workflow-local-diagnostic-explicit', 'trace-diagnostic-explicit', 'hermers', 'cat_eyes', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 1, '${ts(-15_000)}', '${smokeFailedAt}', 1000, '', '', '', 'expected explicit diagnostic failure', '{}'),
  ('runtime-smoke-not-explicit-failed', 'dispatch-smoke-not-explicit', 'workflow-local-smoke-negative', 'workflow-local-smoke-negative', 'trace-smoke-negative', 'hermers', 'cat_eyes', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 1, '${ts(-15_000)}', '${smokeFailedAt}', 1000, '', '', '', 'real failure with smoke text', '{}'),
  ('runtime-malformed-payload-failed', 'dispatch-malformed-payload', '', '', 'trace-malformed-payload', 'hermers', 'cat_eyes', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 1, '${ts(-10_000)}', '${malformedFailedAt}', 1000, '', '', '', 'malformed payload should not break readiness', 'not-json');
`);

  const readiness = await runAction(root, {
    action: "workflow.readiness",
    persistReadinessSnapshot: false
  });
  const recentFailure = readiness.findings.find((finding) => finding.key === "recent_runtime_failures");
  assert.equal(recentFailure?.count, 5);
  assert.equal(readiness.planes.runtime.recentRuntime.diagnostic_ignored, 2);
}

async function testStaleDispatchReconcileSyncsMessageFlows() {
  const root = await tempRoot("stale-dispatch-flow-sync");
  await runAction(root, { action: "workflow.init" });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES
  ('dispatch-reconcile-acked', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-acked', 'idem-reconcile-acked', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'normal', 1, 3, '', '', '', 'final output prompt', '{"payload":{"messageFlowId":"flow-reconcile-acked"}}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2000-01-01T00:00:00.000Z'),
  ('dispatch-reconcile-ack-contract', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-ack-contract', 'idem-reconcile-ack-contract', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'normal', 1, 3, '', '', '', 'ack prompt', '{"payload":{"messageFlowId":"flow-reconcile-ack-contract","ackContract":{"required":true,"semanticContinuation":true}}}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2000-01-01T00:00:01.000Z'),
  ('dispatch-reconcile-failed', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-failed', 'idem-reconcile-failed', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'normal', 1, 1, '', '', '', 'failed prompt', '{"payload":{"messageFlowId":"flow-reconcile-failed"}}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2000-01-01T00:00:02.000Z'),
  ('dispatch-reconcile-missing-output', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-missing-output', 'idem-reconcile-missing-output', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'normal', 1, 3, '', '', '', 'missing output prompt', '{"payload":{"messageFlowId":"flow-reconcile-missing-output"}}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z', '', '', '2000-01-01T00:00:03.000Z');
INSERT INTO mixed_meeting_messages(message_id, meeting_id, runtime, agent_id, agent_key, message_type, phase, text, payload_json, telegram_live_status, created_at)
VALUES
  ('msg-reconcile-acked', 'wf-reconcile-flow', 'hermers', 'cat_body', 'hermers:cat_body', 'agent_message', '', 'final reconciled output', '{}', 'pending', '2026-05-31T00:00:02.000Z'),
  ('msg-reconcile-ack-contract', 'wf-reconcile-flow', 'hermers', 'cat_body', 'hermers:cat_body', 'agent_message', '', 'ACK_RECEIVED\\nTimestamp: 2026-05-31T00:00:02.000Z', '{}', 'pending', '2026-05-31T00:00:02.000Z');
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES
  ('runtime-reconcile-acked', 'dispatch-reconcile-acked', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-acked', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'acked', '', 1, '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:02.000Z', 1000, 'msg-reconcile-acked', '', '', '', '{}'),
  ('runtime-reconcile-ack-contract', 'dispatch-reconcile-ack-contract', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-ack-contract', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'acked', '', 1, '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:02.000Z', 1000, 'msg-reconcile-ack-contract', '', '', '', '{}'),
  ('runtime-reconcile-failed', 'dispatch-reconcile-failed', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-failed', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'failed', 'runtime_timeout', 1, '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:02.000Z', 1000, '', '', '', 'timeout while executing', '{}'),
  ('runtime-reconcile-missing-output', 'dispatch-reconcile-missing-output', 'wf-reconcile-flow', 'wf-reconcile-flow', 'trace-reconcile-missing-output', 'hermers', 'cat_body', 'hermes_acp', '', '', '', 'acked', '', 1, '2026-05-31T00:00:01.000Z', '2026-05-31T00:00:02.000Z', 1000, '', '', '', '', '{}');
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, outbox_id, target_runtime, target_agent_id, return_policy, status, runtime_completed_at, runtime_failed_at, final_output_present, delivery_receipt_present, last_error, created_at, updated_at)
VALUES
  ('flow-reconcile-acked', 'trace-flow-reconcile-acked', 'idem-flow-reconcile-acked', 'wf-reconcile-flow', 'wf-reconcile-flow', 'dispatch-reconcile-acked', '', 'hermers', 'cat_body', 'report_to_flashcat', 'runtime_dispatched', '', '', 0, 0, '', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:00.000Z'),
  ('flow-reconcile-ack-contract', 'trace-flow-reconcile-ack-contract', 'idem-flow-reconcile-ack-contract', 'wf-reconcile-flow', 'wf-reconcile-flow', 'dispatch-reconcile-ack-contract', '', 'hermers', 'cat_body', 'silent', 'runtime_dispatched', '', '', 0, 0, '', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:01.000Z'),
  ('flow-reconcile-failed', 'trace-flow-reconcile-failed', 'idem-flow-reconcile-failed', 'wf-reconcile-flow', 'wf-reconcile-flow', 'dispatch-reconcile-failed', '', 'hermers', 'cat_body', 'silent', 'runtime_dispatched', '', '', 0, 0, '', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:02.000Z'),
  ('flow-reconcile-missing-output', 'trace-flow-reconcile-missing-output', 'idem-flow-reconcile-missing-output', 'wf-reconcile-flow', 'wf-reconcile-flow', 'dispatch-reconcile-missing-output', '', 'hermers', 'cat_body', 'silent', 'runtime_dispatched', '', '', 0, 0, '', '2026-05-31T00:00:00.000Z', '2000-01-01T00:00:03.000Z');
`);

  const reconciled = await runAction(root, {
    action: "workflow.dispatch.reconcile",
    staleDispatchAfterMs: 60_000,
    deliverMessageFlowOutbox: false,
    limit: 10
  });
  assert.equal(reconciled.count, 4);
  const dispatches = sqliteJson(dbFile, `
SELECT dispatch_id AS dispatchId, status, failure_type AS failureType
FROM mixed_meeting_dispatches
WHERE dispatch_id LIKE 'dispatch-reconcile-%'
ORDER BY dispatch_id;`);
  assert.deepEqual(dispatches, [
    { dispatchId: "dispatch-reconcile-ack-contract", status: "acked", failureType: null },
    { dispatchId: "dispatch-reconcile-acked", status: "acked", failureType: null },
    { dispatchId: "dispatch-reconcile-failed", status: "failed", failureType: "runtime_timeout" },
    { dispatchId: "dispatch-reconcile-missing-output", status: "acked", failureType: null }
  ]);
  const flows = sqliteJson(dbFile, `
SELECT flow_id AS flowId, status, runtime_run_id AS runtimeRunId, COALESCE(outbox_id, '') AS outboxId,
  COALESCE(message_id, '') AS messageId, final_output_present AS finalOutputPresent,
  failure_type AS failureType, last_error AS lastError
FROM message_flows
WHERE flow_id LIKE 'flow-reconcile-%'
ORDER BY flow_id;`);
  assert.deepEqual(flows, [
    {
      flowId: "flow-reconcile-ack-contract",
      status: "runtime_acknowledged",
      runtimeRunId: "runtime-reconcile-ack-contract",
      outboxId: "",
      messageId: "msg-reconcile-ack-contract",
      finalOutputPresent: 0,
      failureType: null,
      lastError: ""
    },
    {
      flowId: "flow-reconcile-acked",
      status: "outbound_queued",
      runtimeRunId: "runtime-reconcile-acked",
      outboxId: "flow-flow-reconcile-acked",
      messageId: "msg-reconcile-acked",
      finalOutputPresent: 1,
      failureType: null,
      lastError: ""
    },
    {
      flowId: "flow-reconcile-failed",
      status: "runtime_failed",
      runtimeRunId: "runtime-reconcile-failed",
      outboxId: "",
      messageId: "",
      finalOutputPresent: 0,
      failureType: "runtime_timeout",
      lastError: "timeout while executing"
    },
    {
      flowId: "flow-reconcile-missing-output",
      status: "runtime_failed",
      runtimeRunId: "runtime-reconcile-missing-output",
      outboxId: "",
      messageId: "",
      finalOutputPresent: 0,
      failureType: "runtime_output_missing",
      lastError: "terminal acked runtime receipt did not reference recoverable message text"
    }
  ]);
  const reconciledRuntimeEvents = sqliteJson(dbFile, `
SELECT dispatch_id AS dispatchId, event_type AS eventType, status, stage, error_class AS errorClass
FROM runtime_semantic_events
WHERE dispatch_id LIKE 'dispatch-reconcile-%'
ORDER BY dispatch_id, event_sequence;`);
  assert.deepEqual(reconciledRuntimeEvents, [
    { dispatchId: "dispatch-reconcile-ack-contract", eventType: "mechanical_ack", status: "acked", stage: "stale_terminal_ack_synced", errorClass: "" },
    { dispatchId: "dispatch-reconcile-acked", eventType: "semantic_ack", status: "working", stage: "stale_terminal_semantic_synced", errorClass: "" },
    { dispatchId: "dispatch-reconcile-acked", eventType: "turn_completed", status: "completed", stage: "stale_terminal_turn_completed", errorClass: "" },
    { dispatchId: "dispatch-reconcile-failed", eventType: "turn_failed", status: "failed", stage: "turn_failed", errorClass: "runtime_timeout" },
    { dispatchId: "dispatch-reconcile-missing-output", eventType: "turn_failed", status: "failed", stage: "turn_failed", errorClass: "runtime_output_missing" }
  ]);
  const reconciledCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status
FROM runtime_current_state
WHERE runtime='hermers' AND agent_id='cat_body'
LIMIT 1;`)[0];
  assert.equal(reconciledCurrentState.activeDispatchId, "dispatch-reconcile-missing-output");
  assert.equal(reconciledCurrentState.currentStage, "turn_failed");
  assert.equal(reconciledCurrentState.status, "failed");
  const syncedEvents = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM message_flow_events
WHERE event_type='stale_dispatch_terminal_receipt_synced';`)[0];
  assert.equal(syncedEvents.count, 1);
  const queuedOutbox = sqliteJson(dbFile, `
SELECT outbox_id AS outboxId, message_type AS messageType, status, target_kind AS targetKind, target_ref AS targetRef, text
FROM telegram_outbox
WHERE outbox_id='flow-flow-reconcile-acked'
LIMIT 1;`)[0];
  assert.deepEqual(queuedOutbox, {
    outboxId: "flow-flow-reconcile-acked",
    messageType: "message_flow_reply",
    status: "queued",
    targetKind: "private",
    targetRef: "8390724843",
    text: "final reconciled output"
  });
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
  const registryFailureCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status
FROM runtime_current_state
WHERE runtime='hermers' AND agent_id='cat_ears'
LIMIT 1;`)[0];
  assert.equal(registryFailureCurrentState.activeDispatchId, overrideMismatch.dispatchId);
  assert.equal(registryFailureCurrentState.currentStage, "runtime_bridge_error");
  assert.equal(registryFailureCurrentState.status, "failed");
  const registryFailureEvents = sqliteJson(dbFile, `
SELECT COUNT(*) AS count
FROM runtime_semantic_events
WHERE runtime='hermers'
  AND agent_id='cat_ears'
  AND event_type='turn_failed'
  AND status='failed';`)[0];
  assert.equal(registryFailureEvents.count >= 1, true);
}

async function testHermersAcpBackendFallbackToCli() {
  const root = await tempRoot("hermers-acp-fallback");
  const fakeHermes = path.join(root, "fake-hermes.sh");
  await fs.writeFile(fakeHermes, [
    "#!/bin/sh",
    "printf '%s\\n' 'FINAL_OK 2026-05-31T00:00:00.000Z'",
    "printf '%s\\n' 'Hermes CLI fallback completed.'"
  ].join("\n"), "utf8");
  await fs.chmod(fakeHermes, 0o755);
  const fakeOpenClaw = path.join(root, "fake-openclaw-health.sh");
  await fs.writeFile(fakeOpenClaw, [
    "#!/bin/sh",
    "printf '%s\\n' 'Gateway event loop: ok max=1ms p99=1ms util=0.001 cpu=0.001'"
  ].join("\n"), "utf8");
  await fs.chmod(fakeOpenClaw, 0o755);
  const modesPath = await writeHermersProfileModes(root, {
    catbody: {
      observedMode: "warm",
      managed: true,
      protected: false,
      activeWork: false
    }
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_body",
    displayName: "猫之体",
    canReceiveDispatch: true,
    workflowIngressAdapter: "acp",
    endpointRef: "hermes-profile:catbody"
  });
  const dispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-hermers-acp-fallback",
    workflowId: "workflow-hermers-acp-fallback",
    runtime: "hermers",
    agentId: "cat_body",
    prompt: "Fallback from missing ACP backend to Hermes CLI.",
    dispatchType: "message_flow_send"
  });
  const drain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: dispatch.dispatchId,
    acpBackend: "missing_backend_for_regression",
    acpBackendFallback: true,
    hermesBin: fakeHermes,
    timeoutSeconds: 5
  });
  assert.equal(drain.results[0].status, "acked");
  assert.equal(drain.results[0].adapter, "cli");
  const dbFile = path.join(root, "tracking.db");
  assert.equal(sqliteJson(dbFile, `SELECT status FROM mixed_meeting_dispatches WHERE dispatch_id='${dispatch.dispatchId}';`)[0].status, "acked");
  assert.equal(sqliteCount(dbFile, "runtime_runs", `dispatch_id='${dispatch.dispatchId}' AND adapter='acp'`), 0);
  assert.equal(sqliteCount(dbFile, "runtime_runs", `dispatch_id='${dispatch.dispatchId}' AND adapter='cli' AND status='acked'`), 1);
  assert.equal(sqliteCount(dbFile, "runtime_runs", `dispatch_id='${dispatch.dispatchId}' AND status='started'`), 0);
  const hermersFallbackRuntimeEvents = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, stage
FROM runtime_semantic_events
WHERE dispatch_id='${dispatch.dispatchId}'
ORDER BY event_sequence;`);
  assert.deepEqual(hermersFallbackRuntimeEvents, [
    { eventType: "dispatch_bound", status: "dispatched", stage: "dispatch_bound" },
    { eventType: "semantic_ack", status: "working", stage: "semantic_response_received" },
    { eventType: "turn_completed", status: "completed", stage: "turn_completed" }
  ]);
  const hermersFallbackCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status, semantic_ack_at AS semanticAckAt
FROM runtime_current_state
WHERE runtime='hermers' AND agent_id='cat_body'
LIMIT 1;`)[0];
  assert.equal(hermersFallbackCurrentState.activeDispatchId, dispatch.dispatchId);
  assert.equal(hermersFallbackCurrentState.currentStage, "turn_completed");
  assert.equal(hermersFallbackCurrentState.status, "completed");
  assert.ok(hermersFallbackCurrentState.semanticAckAt);
  const fallbackReadiness = await runAction(root, {
    action: "workflow.readiness",
    activeChecks: true,
    persistReadinessSnapshot: false,
    openclawBin: fakeOpenClaw,
    hermesBin: fakeHermes,
    hermesCwd: root,
    stabilityProfileModesPath: modesPath,
    acpBackend: "missing_backend_for_regression",
    acpBackendFallback: true
  });
  assert.equal(fallbackReadiness.planes.runtime.acpBackend.fallbackAvailable, true);
  assert.equal(fallbackReadiness.planes.runtime.acpBackend.fallbackProbe, "hermes_profile_acp_check");
  assert.equal(fallbackReadiness.findings.some((finding) => finding.key === "acp_backend_unavailable"), false);
  assert.equal(fallbackReadiness.findings.some((finding) => finding.key === "acp_backend_fallback_active" && finding.severity === "info" && finding.fallbackProbe === "hermes_profile_acp_check"), true);

  const noFallbackReadiness = await runAction(root, {
    action: "workflow.readiness",
    activeChecks: true,
    persistReadinessSnapshot: false,
    openclawBin: fakeOpenClaw,
    hermesBin: fakeHermes,
    hermesCwd: { invalid: "non-string should fall back" },
    stabilityProfileModesPath: modesPath,
    acpBackend: "missing_backend_for_regression",
    acpBackendFallback: false
  });
  assert.equal(noFallbackReadiness.planes.runtime.acpBackend.fallbackAvailable, false);
  assert.equal(noFallbackReadiness.findings.some((finding) => finding.key === "acp_backend_unavailable" && finding.severity === "warning"), true);

  const fakeAcpxSdkProject = path.join(root, "openclaw-projects-sdk", "openclaw-acpx-sdk", "node_modules");
  await fs.mkdir(path.join(fakeAcpxSdkProject, "@openclaw", "acpx"), { recursive: true });
  await fs.mkdir(path.join(fakeAcpxSdkProject, "openclaw", "plugin-sdk"), { recursive: true });
  await fs.writeFile(path.join(fakeAcpxSdkProject, "@openclaw", "acpx", "package.json"), JSON.stringify({ name: "@openclaw/acpx", version: "0.0.0-regression" }), "utf8");
  await fs.writeFile(path.join(fakeAcpxSdkProject, "openclaw", "package.json"), JSON.stringify({ name: "openclaw", type: "module", version: "0.0.0-regression" }), "utf8");
  await fs.writeFile(path.join(fakeAcpxSdkProject, "openclaw", "plugin-sdk", "acp-runtime-backend.js"), [
    "export function getAcpRuntimeBackend(id) {",
    "  return id === 'acpx' ? { runtime: { regression: 'project-layout-sdk' } } : null;",
    "}"
  ].join("\n"), "utf8");
  const projectLayoutSdkReadiness = await runAction(root, {
    action: "workflow.readiness",
    activeChecks: true,
    persistReadinessSnapshot: false,
    openclawBin: fakeOpenClaw,
    hermesBin: fakeHermes,
    hermesCwd: root,
    stabilityProfileModesPath: modesPath,
    acpBackend: "acpx",
    acpBackendFallback: false,
    openclawNpmProjectsDir: path.join(root, "openclaw-projects-sdk")
  });
  assert.equal(projectLayoutSdkReadiness.planes.runtime.acpBackend.ok, true);
  assert.match(projectLayoutSdkReadiness.planes.runtime.acpBackend.source, /require-base:.*openclaw-acpx-sdk.*@openclaw\/acpx\/package\.json/);

  const fakeAcpxRegisterProject = path.join(root, "openclaw-projects-register", "openclaw-acpx-test", "node_modules");
  const fakeAcpxProject = path.join(fakeAcpxRegisterProject, "@openclaw", "acpx", "dist");
  await fs.mkdir(fakeAcpxProject, { recursive: true });
  await fs.mkdir(path.join(fakeAcpxRegisterProject, "openclaw", "plugin-sdk"), { recursive: true });
  await fs.writeFile(path.join(fakeAcpxProject, "..", "package.json"), JSON.stringify({ name: "@openclaw/acpx", version: "0.0.0-regression" }), "utf8");
  await fs.writeFile(path.join(fakeAcpxRegisterProject, "openclaw", "package.json"), JSON.stringify({ name: "openclaw", type: "module", version: "0.0.0-regression" }), "utf8");
  await fs.writeFile(path.join(fakeAcpxRegisterProject, "openclaw", "plugin-sdk", "acp-runtime-backend.js"), [
    "export function getAcpRuntimeBackend() {",
    "  return null;",
    "}"
  ].join("\n"), "utf8");
  await fs.writeFile(path.join(fakeAcpxProject, "register.runtime.js"), [
    "export const marker = 'project-layout-acpx';"
  ].join("\n"), "utf8");
  const projectLayoutReadiness = await runAction(root, {
    action: "workflow.readiness",
    activeChecks: true,
    persistReadinessSnapshot: false,
    openclawBin: fakeOpenClaw,
    hermesBin: fakeHermes,
    hermesCwd: root,
    stabilityProfileModesPath: modesPath,
    acpBackend: "acpx",
    acpBackendFallback: true,
    openclawNpmProjectsDir: path.join(root, "openclaw-projects-register")
  });
  assert.match(projectLayoutReadiness.planes.runtime.acpBackend.error, /openclaw-acpx-test/);
  assert.match(projectLayoutReadiness.planes.runtime.acpBackend.error, /createAcpxRuntimeService/);
  assert.doesNotMatch(projectLayoutReadiness.planes.runtime.acpBackend.error, /no @openclaw\/acpx package found/);

  const fakeHermesFail = path.join(root, "fake-hermes-fail.sh");
  await fs.writeFile(fakeHermesFail, [
    "#!/bin/sh",
    "printf '%s\\n' 'Hermes profile check failed' >&2",
    "exit 17"
  ].join("\n"), "utf8");
  await fs.chmod(fakeHermesFail, 0o755);
  const profileFailureReadiness = await runAction(root, {
    action: "workflow.readiness",
    activeChecks: true,
    persistReadinessSnapshot: false,
    openclawBin: fakeOpenClaw,
    hermesBin: fakeHermesFail,
    hermesCwd: root,
    stabilityProfileModesPath: modesPath,
    acpBackend: "missing_backend_for_regression",
    acpBackendFallback: true
  });
  assert.equal(profileFailureReadiness.planes.runtime.acpBackend.fallbackAvailable, false);
  assert.equal(profileFailureReadiness.findings.some((finding) => finding.key === "hermers_acp_check_failed" && finding.severity === "warning"), true);
  assert.equal(profileFailureReadiness.findings.some((finding) => finding.key === "acp_backend_unavailable" && finding.severity === "warning"), true);

  const envDispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-hermers-env-fallback",
    workflowId: "workflow-hermers-acp-fallback",
    runtime: "hermers",
    agentId: "cat_body",
    prompt: "Environment backend fallback to Hermes CLI.",
    dispatchType: "message_flow_send"
  });
  const previousBackend = process.env.TRADING_AGENTS_ACP_BACKEND;
  process.env.TRADING_AGENTS_ACP_BACKEND = "missing_env_backend_for_regression";
  try {
    const envDrain = await runAction(root, {
      action: "runtime.bridge.drain",
      runtime: "hermers",
      dispatchId: envDispatch.dispatchId,
      hermesBin: fakeHermes,
      timeoutSeconds: 5
    });
    assert.equal(envDrain.results[0].status, "acked");
    assert.equal(envDrain.results[0].adapter, "cli");
  } finally {
    if (previousBackend === undefined) {
      delete process.env.TRADING_AGENTS_ACP_BACKEND;
    } else {
      process.env.TRADING_AGENTS_ACP_BACKEND = previousBackend;
    }
  }

  const explicitDispatch = await runAction(root, {
    action: "meeting.dispatch",
    meetingId: "meeting-hermers-explicit-no-fallback",
    workflowId: "workflow-hermers-acp-fallback",
    runtime: "hermers",
    agentId: "cat_body",
    prompt: "Explicit missing backend should fail closed.",
    dispatchType: "message_flow_send"
  });
  const explicitDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "hermers",
    dispatchId: explicitDispatch.dispatchId,
    acpBackend: "missing_explicit_backend_for_regression",
    hermesBin: fakeHermes,
    timeoutSeconds: 5
  });
  assert.equal(explicitDrain.results[0].status, "failed");
  assert.equal(explicitDrain.results[0].adapter, "acp");
  assert.equal(explicitDrain.results[0].failureType, "acp_unavailable");
  const hermersAcpFailureRuntimeEvents = sqliteJson(dbFile, `
SELECT event_type AS eventType, status, stage, error_class AS errorClass
FROM runtime_semantic_events
WHERE dispatch_id='${explicitDispatch.dispatchId}'
ORDER BY event_sequence;`);
  assert.deepEqual(hermersAcpFailureRuntimeEvents, [
    { eventType: "turn_failed", status: "failed", stage: "turn_failed", errorClass: "acp_unavailable" }
  ]);
  const hermersAcpFailureCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status
FROM runtime_current_state
WHERE runtime='hermers' AND agent_id='cat_body'
LIMIT 1;`)[0];
  assert.equal(hermersAcpFailureCurrentState.activeDispatchId, explicitDispatch.dispatchId);
  assert.equal(hermersAcpFailureCurrentState.currentStage, "turn_failed");
  assert.equal(hermersAcpFailureCurrentState.status, "failed");
}

async function testRuntimeDrainRejectsEmptyPrompt() {
  const root = await tempRoot("runtime-empty-prompt");
  const fakeOpenClaw = path.join(root, "fake-openclaw.sh");
  await fs.writeFile(fakeOpenClaw, [
    "#!/bin/sh",
    "case \"$*\" in",
    "  *'nested task body for runtime bridge'*) printf '%s\\n' '{\"status\":\"ok\",\"summary\":\"FINAL_OK 2026-05-31T00:00:00.000Z\",\"result\":{\"payloads\":[{\"text\":\"FINAL_OK 2026-05-31T00:00:00.000Z nested task accepted\"}]}}' ;;",
    "  *) exit 12 ;;",
    "esac"
  ].join("\n"), "utf8");
  await fs.chmod(fakeOpenClaw, 0o755);
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "猫之脑",
    canReceiveDispatch: true,
    workflowIngressAdapter: "openclaw_native",
    endpointRef: "openclaw-agent:main"
  });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES ('dispatch-empty-prompt', 'meeting-empty-prompt', 'workflow-empty-prompt', 'trace-empty-prompt', 'idem-empty-prompt', 'openclaw', 'main', 'openclaw:main', 'governance_repair', 'queued', 'normal', 0, 1, '', '{}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z');`);
  const dryRun = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: "dispatch-empty-prompt",
    dryRun: true
  });
  assert.equal(dryRun.dispatches[0].taskValidation.ok, false);
  assert.equal(dryRun.dispatches[0].taskValidation.failureType, "invalid_dispatch_prompt");
  const drain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: "dispatch-empty-prompt",
    openclawBin: "/definitely/not/openclaw"
  });
  assert.equal(drain.results[0].status, "failed");
  assert.equal(drain.results[0].failureType, "invalid_dispatch_prompt");
  assert.equal(sqliteJson(dbFile, "SELECT status, failure_type FROM mixed_meeting_dispatches WHERE dispatch_id='dispatch-empty-prompt';")[0].status, "failed");
  assert.equal(sqliteCount(dbFile, "runtime_runs", "dispatch_id='dispatch-empty-prompt' AND adapter='openclaw'"), 0);
  assert.equal(sqliteCount(dbFile, "runtime_runs", "dispatch_id='dispatch-empty-prompt' AND adapter='runtime_bridge_validation' AND status='failed'"), 1);
  assert.equal(sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status
FROM runtime_current_state
WHERE runtime='openclaw' AND agent_id='main'
LIMIT 1;`)[0].currentStage, "dispatch_validation_failed");

  sqliteExec(dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES ('dispatch-openclaw-fail', 'meeting-openclaw-fail', 'workflow-openclaw-fail', 'trace-openclaw-fail', 'idem-openclaw-fail', 'openclaw', 'main', 'openclaw:main', 'governance_repair', 'queued', 'normal', 0, 1, 'valid prompt that fake openclaw rejects', '{}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z');`);
  const failedDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: "dispatch-openclaw-fail",
    openclawBin: fakeOpenClaw
  });
  assert.equal(failedDrain.results[0].status, "failed");
  assert.equal(sqliteCount(dbFile, "runtime_runs", "dispatch_id='dispatch-openclaw-fail' AND adapter='openclaw' AND status='failed'"), 1);
  assert.equal(sqliteCount(dbFile, "runtime_runs", "dispatch_id='dispatch-openclaw-fail' AND status='started'"), 0);
  const failedRuntimeCurrentState = sqliteJson(dbFile, `
SELECT active_dispatch_id AS activeDispatchId, current_stage AS currentStage, status
FROM runtime_current_state
WHERE runtime='openclaw' AND agent_id='main'
LIMIT 1;`)[0];
  assert.equal(failedRuntimeCurrentState.activeDispatchId, "dispatch-openclaw-fail");
  assert.equal(failedRuntimeCurrentState.currentStage, "turn_failed");
  assert.equal(failedRuntimeCurrentState.status, "failed");

  sqliteExec(dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES ('dispatch-nested-prompt', 'meeting-nested-prompt', 'workflow-nested-prompt', 'trace-nested-prompt', 'idem-nested-prompt', 'openclaw', 'main', 'openclaw:main', 'governance_repair', 'queued', 'normal', 0, 1, '', '{"payload":{"body":"nested task body for runtime bridge"}}', 'main', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z');`);
  const nestedDryRun = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: "dispatch-nested-prompt",
    dryRun: true
  });
  assert.equal(nestedDryRun.dispatches[0].taskValidation.ok, true);
  const nestedDrain = await runAction(root, {
    action: "runtime.bridge.drain",
    runtime: "openclaw",
    dispatchId: "dispatch-nested-prompt",
    openclawBin: fakeOpenClaw
  });
  assert.equal(nestedDrain.results[0].status, "acked");
  assert.equal(sqliteCount(dbFile, "runtime_runs", "dispatch_id='dispatch-nested-prompt' AND adapter='openclaw' AND status='acked'"), 1);
  assert.equal(sqliteCount(dbFile, "runtime_runs", "dispatch_id='dispatch-nested-prompt' AND status='started'"), 0);
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
    ["human_gate incident closeout approval resolves incidents", testHumanGateIncidentCloseoutApprovalResolvesIncidents],
    ["human_gate readiness checklist", testHumanGateReadinessChecklist],
    ["human_gate readiness legacy schema fallback", testHumanGateReadinessLegacySchemaFallback],
    ["workflow operations console audit", testWorkflowOperationsConsoleAudit],
    ["workflow intervention previews", testWorkflowInterventionPreviews],
    ["workflow intervention execution", testWorkflowInterventionExecution],
    ["workflow verification results", testWorkflowVerificationResults],
    ["control_loop job requeue", testControlLoopJobRequeue],
    ["workflow evaluator evidence", testWorkflowEvaluatorEvidence],
    ["human_gate pending cleanup/retry", testHumanGatePendingCleanupAndRetryRedaction],
    ["human_gate ensure invalid buttons superseded", testHumanGateEnsureSupersedesInvalidExistingButtons],
    ["human_gate stage dedup/supersede", testHumanGateStageDedupAndSupersede],
    ["schedule resume semantics", testScheduleResumeSemantics],
    ["message_flow runtime bridge", testMessageFlowRuntimeBridge],
    ["message_flow immediate ack contract", testMessageFlowImmediateAckContract],
    ["message_flow ack timeout clamping", testMessageFlowAckTimeoutClamping],
    ["message_flow immediate ack retry delay", testMessageFlowImmediateAckRetryDelay],
    ["control_loop process worker budget covers openclaw semantic drain", testControlLoopProcessWorkerBudgetCoversOpenClawSemanticDrain],
    ["message_flow control-loop runtime drains", testControlLoopDrainsMessageFlowRuntimes],
    ["control_loop auto runtime discovery", testControlLoopAutoDiscoversQueuedDispatchRuntimes],
    ["control_loop workflow supervise targeted drain", testControlLoopWorkflowSuperviseEnqueuesTargetedDrain],
    ["control_loop stale delivering outbox", testControlLoopSeedsStaleDeliveringOutbox],
    ["control_loop blocked workflow supervise cooldown", testControlLoopBacksOffBlockedWorkflowSupervise],
    ["trade_intent fail-closed", testTradeIntentFailClosed],
    ["trade chain and receipt guardrails", testTradeIntentChainAndReceiptGuardrails],
    ["workflow event store", testWorkflowEventStore],
    ["automatic workflow events", testAutomaticWorkflowEvents],
    ["workflow permission gate", testWorkflowPermissionGate],
    ["workflow session store", testWorkflowSessionStore],
    ["workflow session runs legacy schema migration", testWorkflowSessionRunsLegacySchemaMigration],
    ["workflow task draft pure preview", testWorkflowTaskDraftPurePreview],
    ["workflow task draft cli pure preview", testWorkflowTaskDraftCliPurePreview],
    ["workflow task draft no human gate and single task compatibility", testWorkflowTaskDraftNoHumanGateAndSingleTaskCompatibility],
    ["workflow task launch prepare and approve", testWorkflowTaskLaunchPrepareAndApprove],
    ["workflow phase read-model fallback with empty phase table", testWorkflowPhaseReadModelFallbackWithEmptyPhaseTable],
    ["workflow task launch review permissions", testWorkflowTaskLaunchReviewPermissions],
    ["workflow session store cli", testWorkflowSessionStoreCli],
    ["expired human_gate blocked", testExpiredHumanGateBlocked],
    ["human_gate wrong telegram user blocked", testHumanGateRejectsWrongTelegramUser],
    ["human_gate missing telegram sender blocked", testHumanGateRejectsMissingTelegramSender],
    ["workflow health dashboard", testWorkflowHealthDashboard],
    ["workflow console agentic surfaces", testWorkflowConsoleAgenticSurfaces],
    ["workflow health terminal failed dispatch degraded", testWorkflowHealthTerminalFailedDispatchIsDegraded],
    ["workflow health open incidents visible", testWorkflowHealthOpenIncidentsAreVisible],
    ["workflow readiness recovered runtime failures", testWorkflowReadinessRecoveredRuntimeFailures],
    ["stale dispatch reconciles message_flows", testStaleDispatchReconcileSyncsMessageFlows],
    ["readiness gateway degraded", testReadinessGatewayDegraded],
    ["hermers profile mode readiness/registry", testHermersProfileModeReadinessAndRegistry],
    ["hermers profile mode does not defer drain admission", testHermersProfileModeDoesNotDeferDrainAdmission],
    ["hermers runtime drain fails closed on registry gaps", testHermersRuntimeDrainFailsClosedOnRegistryGaps],
    ["hermers acp backend fallback to cli", testHermersAcpBackendFallbackToCli],
    ["runtime drain rejects empty prompt", testRuntimeDrainRejectsEmptyPrompt],
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
