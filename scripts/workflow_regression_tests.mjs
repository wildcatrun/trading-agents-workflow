#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildConsoleConfig, createConsoleServer, operatorActionSignatureOk, workflowChildPayload } from "../src/console/server.js";
import { WorkflowActionGateway } from "../src/console/action-gateway.js";
import { WorkflowReadModel } from "../src/console/read-model.js";
import { kanbanPreviewActionModel } from "../static/console/preview-actions.js";
import {
  DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS,
  controlLoopWorkerKillAfterMs
} from "../src/control-loop-budget.js";
import { runAction as runActionRaw } from "../src/core.js";
import {
  CAT_CLAW_ACTION_REGISTRY,
  CHECKPOINT_ACTION_REGISTRY,
  CONTROL_LOOP_JOB_ACTION_REGISTRY,
  EVENT_ACTION_REGISTRY,
  HUMAN_GATE_ACTION_REGISTRY,
  INCIDENT_ACTION_REGISTRY,
  INTERVENTION_ACTION_REGISTRY,
  MEETING_INGEST_ACTION_REGISTRY,
  MEETING_PARTICIPANT_ACTION_REGISTRY,
  MESSAGE_FLOW_ACTION_REGISTRY,
  PERMISSION_ACTION_REGISTRY,
  PROTOCOL_ACTION_REGISTRY,
  RESEARCH_ACTION_REGISTRY,
  RUNTIME_AGENT_ACTION_REGISTRY,
  RUNTIME_EVENT_ACTION_REGISTRY,
  SCHEDULE_ACTION_REGISTRY,
  SESSION_ACTION_REGISTRY,
  SIDE_EFFECT_ACTION_REGISTRY,
  STATUS_ACTION_REGISTRY,
  TELEGRAM_LIVE_ACTION_REGISTRY,
  TELEGRAM_OUTBOX_ACTION_REGISTRY,
  TOPOLOGY_ACTION_REGISTRY,
  TRADE_ACTION_REGISTRY,
  VERIFICATION_ACTION_REGISTRY,
  WORKFLOW_RUN_ACTION_REGISTRY,
  cat_clawAudit,
  humanGateInbox,
  incidentState,
  messageFlowList,
  messageFlowReconcile,
  protocolRecord,
  gateReview,
  instrumentUpsert,
  messageFlowSend,
  radarUpdate,
  researchEvidence,
  researchMemo,
  sideEffectRecord,
  telegramLiveConfigure,
  telegramOutbox,
  telegramOutboxDelivery,
  telegramOutboxDeliveryPreview,
  telegramOutboxRequeueExecutionPackagePreview,
  telegramOutboxRequeuePreview,
  thesisUpdate,
  workflowEventAppend,
  workflowEventList,
  workflowEventTimeline,
  workflowHealth,
  workflowCheckpoint,
  workflowControlLoopJobRequeue,
  workflowControlLoopJobRequeuePreview,
  workflowInit,
  workflowInterventionExecute,
  workflowInterventionPreview,
  meetingIngest,
  meetingRuntimeParticipant,
  workflowPermissionCheck,
  workflowReadiness,
  runtimeAgentUpsert,
  workflowRuntimeAgents,
  workflowRuntimeCurrentState,
  workflowRuntimeEventList,
  workflowRuntimeEventRecord,
  workflowScheduleDisable,
  workflowScheduleList,
  workflowSchedulePause,
  workflowScheduleResume,
  workflowScheduleUpsert,
  workflowSessionPackGet,
  workflowSessionPackList,
  workflowSessionPackUpsert,
  workflowSessionRunComplete,
  workflowSessionRunStart,
  workflowStatus,
  workflowTopology,
  workflowEvaluate,
  workflowRunUpsert,
  workflowVerificationList,
  workflowVerificationRecord,
  tradeProposal
} from "../src/workflow.js";
import {
  CAT_CLAW_ACTION_HANDLER_NAMES,
  createCatClawActionRegistry
} from "../src/cat-claw-actions.js";
import {
  CHECKPOINT_ACTION_HANDLER_NAMES,
  createCheckpointActionRegistry
} from "../src/checkpoint-actions.js";
import {
  CONTROL_LOOP_JOB_ACTION_HANDLER_NAMES,
  createControlLoopJobActionRegistry
} from "../src/control-loop-job-actions.js";
import {
  EVENT_ACTION_HANDLER_NAMES,
  createEventActionRegistry
} from "../src/event-actions.js";
import {
  HUMAN_GATE_ACTION_HANDLER_NAMES,
  createHumanGateActionRegistry
} from "../src/human-gate-actions.js";
import {
  INCIDENT_ACTION_HANDLER_NAMES,
  createIncidentActionRegistry
} from "../src/incident-actions.js";
import {
  INTERVENTION_ACTION_HANDLER_NAMES,
  createInterventionActionRegistry
} from "../src/intervention-actions.js";
import {
  MEETING_INGEST_ACTION_HANDLER_NAMES,
  createMeetingIngestActionRegistry
} from "../src/meeting-ingest-actions.js";
import {
  MEETING_PARTICIPANT_ACTION_HANDLER_NAMES,
  createMeetingParticipantActionRegistry
} from "../src/meeting-participant-actions.js";
import {
  PERMISSION_ACTION_HANDLER_NAMES,
  createPermissionActionRegistry
} from "../src/permission-actions.js";
import {
  PROTOCOL_ACTION_HANDLER_NAMES,
  createProtocolActionRegistry
} from "../src/protocol-actions.js";
import {
  RESEARCH_ACTION_HANDLER_NAMES,
  createResearchActionRegistry
} from "../src/research-actions.js";
import {
  RUNTIME_AGENT_ACTION_HANDLER_NAMES,
  createRuntimeAgentActionRegistry
} from "../src/runtime-agent-actions.js";
import {
  RUNTIME_EVENT_ACTION_HANDLER_NAMES,
  createRuntimeEventActionRegistry
} from "../src/runtime-event-actions.js";
import {
  SCHEDULE_ACTION_HANDLER_NAMES,
  createScheduleActionRegistry
} from "../src/schedule-actions.js";
import {
  SESSION_ACTION_HANDLER_NAMES,
  createSessionActionRegistry
} from "../src/session-actions.js";
import {
  SIDE_EFFECT_ACTION_HANDLER_NAMES,
  createSideEffectActionRegistry
} from "../src/side-effect-actions.js";
import {
  STATUS_ACTION_HANDLER_NAMES,
  createStatusActionRegistry
} from "../src/status-actions.js";
import {
  TELEGRAM_LIVE_ACTION_HANDLER_NAMES,
  createTelegramLiveActionRegistry
} from "../src/telegram-live-actions.js";
import {
  TOPOLOGY_ACTION_HANDLER_NAMES,
  createTopologyActionRegistry
} from "../src/topology-actions.js";
import {
  TRADE_ACTION_HANDLER_NAMES,
  createTradeActionRegistry
} from "../src/trade-actions.js";
import {
  VERIFICATION_ACTION_HANDLER_NAMES,
  createVerificationActionRegistry
} from "../src/verification-actions.js";
import {
  WORKFLOW_RUN_ACTION_HANDLER_NAMES,
  createWorkflowRunActionRegistry
} from "../src/workflow-run-actions.js";

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

function extractFunctionSource(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} source should exist`);
  let parenDepth = 0;
  let braceStart = -1;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "{" && parenDepth === 0) {
      braceStart = index;
      break;
    }
  }
  assert.notEqual(braceStart, -1, `${name} body should start`);
  let depth = 0;
  for (let index = braceStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body did not close`);
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

function v2PlanContract(overrides = {}) {
  return {
    orchestrationPattern: "manager_worker",
    orchestrationRationale: "Fixture uses manager-worker orchestration so worker output is delegated, reviewed, and synthesized through durable artifacts.",
    workerBudget: {
      maxWorkers: 6,
      concurrencyLimit: 2,
      maxWorkerContextTokens: 64000
    },
    acceptanceCriteria: ["bounded delegation contract is present", "worker output is reviewed before acceptance"],
    ...overrides
  };
}

function v2WorkerDelegation(overrides = {}) {
  return {
    workerObjective: "Complete the bounded fixture task using only the provided workflow input reference.",
    outputFormat: "structured artifact summary with receipt reference",
    toolBoundary: "Use only the configured worker runtime tools and do not write directly to workflow state.",
    acceptanceCriteria: ["artifact or output summary is produced", "receipt evidence is available for manager review"],
    stopCondition: "Stop after producing the requested artifact or reporting a bounded failure.",
    contextBudgetTokens: 64000,
    ...overrides
  };
}

function workflowTemplateSpec(overrides = {}) {
  const templateId = overrides.templateId || "template.workflow.v2.regression.engineering";
  const version = overrides.version || 1;
  const riskTier = overrides.riskTier || "medium";
  const planSpecSkeleton = overrides.planSpecSkeleton || {
    workflowId: "{{workflowId}}",
    planId: "{{planId}}",
    objective: "{{objective}}",
    taskOwnerAgent: "cat_heart",
    plannerAgent: "main",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      orchestrationPattern: "manager_worker",
      orchestrationRationale: "Template fixture uses manager-worker orchestration and still delegates plan admission to workflow.v2.plan.create.",
      workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 },
      acceptanceCriteria: ["template variables are filled", "worker output is reviewed before acceptance"]
    }),
    nodes: [
      {
        nodeId: "{{planId}}.spawn",
        nodeType: "manager_worker_spawn",
        ownerAgent: "cat_body",
        payload: {
          domainOwnership: "implementation",
          expectedArtifacts: ["artifact://{{planId}}/implementation"],
          reviewPolicy: "manager review required before owner acceptance"
        }
      },
      {
        nodeId: "{{planId}}.review",
        nodeType: "manager_review",
        ownerAgent: "cat_body",
        dependsOn: ["{{planId}}.spawn"]
      }
    ]
  };
  return {
    schemaVersion: "workflow_template_spec.v1",
    templateId,
    version,
    status: overrides.status || "candidate",
    title: overrides.title || "Regression manager-worker workflow template",
    description: overrides.description || "Reusable regression template; token=template-secret must be redacted on read surfaces.",
    ownerAgent: "main",
    tags: overrides.tags || ["regression", "workflow-v2"],
    triggers: { shouldUse: ["medium-risk engineering workflow"], shouldNotUse: ["live trading"] },
    variables: overrides.variables || [
      { name: "workflowId", type: "string", required: true },
      { name: "planId", type: "string", required: true },
      { name: "objective", type: "string", required: true }
    ],
    riskPolicy: { riskTier },
    permissionPolicy: { allowedCapabilities: ["workflow.write", "workflow.verify"] },
    planSpecSkeleton,
    evalPolicy: { requiredComparableArms: ["baseline", "previous_version", "candidate_version"] },
    promotionPolicy: { minEvalCount: 1, autoPromote: false },
    rollbackPolicy: { restorePreviousDefault: true },
    audit: { createdBy: "local_codex", ...overrides.audit }
  };
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
    text: "猫爪正式汇报：请选择本轮可批准方案。",
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
    () => requestHumanGate(englishRoot, { text: "Choose one option for next workflow step." }),
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
  const twoOptionRoot = await tempRoot("hgate-two-options");
  const twoOptionRequest = await requestHumanGate(twoOptionRoot, {
    text: "猫爪正式汇报：请选择本轮两套方案之一，并填写闪电猫原话。",
    buttons: planButtons().slice(0, 2)
  });
  assert.equal(approvedButtons(twoOptionRequest).length, 2);
  const sixOptionRoot = await tempRoot("hgate-six-options");
  const sixButtons = [
    ...planButtons(),
    {
      label: "方案 D：补充审计",
      summary: "增加一次猫之脑流程审计，保留现有 artifacts。",
      prompt: "由猫之脑复核流程证据后再提交。",
      rollback: "如审计不通过，退回 task owner。"
    },
    {
      label: "方案 E：降级执行",
      summary: "降低本轮任务范围，只保留必要产出。",
      prompt: "按最小可交付范围推进。",
      rollback: "范围不足时恢复原计划。"
    },
    {
      label: "方案 F：延后处理",
      summary: "延后本轮执行，等待更多输入。",
      prompt: "暂停本项并记录 resume 条件。",
      rollback: "收到新输入后恢复。"
    }
  ];
  await assertRejectsMessage(
    () => requestHumanGate(sixOptionRoot, { buttons: sixButtons }),
    /human_gate_allows_at_most_five_alternatives/
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
      summaryZh: "猫爪正式汇报：incident closeout 回归测试。请选择可批准方案。",
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
    text: "猫爪正式汇报：incident closeout 回归测试。请选择方案并填写闪电猫原话。",
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
VALUES ('workflow-regression', 'regression', 'waiting_human', 'main', 'Human Gate readiness regression', '验证 Human Gate readiness checklist。', '方案、暂停、终止、证据和回执完整。', '人工停止', 'review', 'submit_human_gate', '{}', '2026-05-31T00:00:00.000Z', '2026-05-31T00:00:01.000Z');
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
VALUES ('outbox-hgate-readiness', 'workflow-regression', 'telegram', '8390724843', 'human_gate_request', 'sent', '猫爪正式汇报：请选择方案。 /hgate tawhg:readiness-secret', '{}', '2026-05-31T00:00:06.000Z', '2026-05-31T00:00:07.000Z');
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
  assert.equal(readiness.checklist.find((item) => item.key === "approve_options_count")?.status, "pass");
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
  assert.equal(operations.actionAuditSummary.total, 2);
  assert.equal(operations.actionAuditSummary.previewRows, 1);
  assert.equal(operations.actionAuditSummary.executableRows, 1);
  assert.equal(operations.actionAuditSummary.rejectedRows, 1);
  assert.equal(operations.actionAuditSummary.failedRows, 0);
  assert.equal(operations.actionAuditSummary.failureEvidenceRows, 1);
  assert.equal(Boolean(operations.actionAuditSummary.statusCounts.some((row) => row.status === "completed" && row.count === 1)), true);
  assert.equal(Boolean(operations.actionAuditSummary.statusCounts.some((row) => row.status === "rejected" && row.count === 1)), true);
  assert.equal(Boolean(operations.actionAuditSummary.actorCounts.some((row) => row.actor === "flashcat" && row.count === 2)), true);
  assert.equal(operations.actionAuditSummary.latestFailures[0].operationId, rejected.operationId);
  assert.equal(operations.actionAuditSummary.latestFailures[0].sourceRefs[0].source, "workflow_operations");
  assert.equal(operations.actionAuditSummary.latestFailures[0].riskTier, "P2");
  assert.equal(operations.actionAuditSummary.latestFailures[0].dryRun, false);
  assert.equal(operations.actionAuditSummary.latestFailures[0].inputHash.startsWith("sha256:"), true);
  assert.deepEqual(operations.actionAuditSummary.latestFailures[0].previewResult, {});
  assert.deepEqual(operations.actionAuditSummary.latestFailures[0].result, {});
  assert.equal(JSON.stringify(operations.actionAuditSummary).includes("rejected-secret"), false);
  sqliteExec(dbFile, `
INSERT INTO workflow_operations(operation_id, action, scope_type, scope_id, workflow_id, requested_by, reason, risk_tier, status, dry_run, idempotency_key, human_gate_id, input_hash, preview_result_json, result_json, error, created_at, updated_at, completed_at)
VALUES
  ('op-denied-audit', 'workflow.denied.preview', 'workflow', '${workflowId}', '${workflowId}', 'cat_claw', 'denied reason token=denied-secret', 'high', 'denied', 1, 'idem-denied', 'hg-denied', 'sha256:denied', '{"token":"preview-secret","safe":"preview"}', '{"secret":"result-secret","safe":"result"}', '', '2026-05-31T00:00:20.000Z', '2026-05-31T00:00:20.000Z', ''),
  ('op-failed-audit', 'workflow.failed.preview', 'workflow', '${workflowId}', '${workflowId}', 'cat_claw', 'failed reason', 'medium', 'failed', 1, 'idem-failed', '', '', '{}', '{}', '', '2026-05-31T00:00:21.000Z', '2026-05-31T00:00:21.000Z', ''),
  ('op-error-only-audit', 'workflow.error_only.preview', 'workflow', '${workflowId}', '${workflowId}', 'cat_heart', 'error only reason', 'medium', 'completed', 1, 'idem-error-only', '', '', '{}', '{}', 'error token error-secret', '2026-05-31T00:00:22.000Z', '2026-05-31T00:00:22.000Z', ''),
  ('op-rejected-error-audit', 'workflow.rejected_with_error.preview', 'workflow', '${workflowId}', '${workflowId}', 'cat_heart', 'rejected error reason', 'low', 'rejected', 1, 'idem-rejected-error', '', '', '{}', '{}', 'rejected error detail', '2026-05-31T00:00:23.000Z', '2026-05-31T00:00:23.000Z', ''),
  ('op-runtime-failed-audit', 'workflow.runtime_failed.preview', 'workflow', '${workflowId}', '${workflowId}', 'cat_body', 'runtime failed reason', 'medium', 'runtime_failed', 1, 'idem-runtime-failed', '', 'sha256:runtime', '{}', '{}', '', '2026-05-31T00:00:24.000Z', '2026-05-31T00:00:24.000Z', ''),
  ('op-telegram-failed-audit', 'workflow.telegram_failed.preview', 'workflow', '${workflowId}', '${workflowId}', 'cat_claw', 'telegram failed reason', 'medium', 'telegram_failed', 1, 'idem-telegram-failed', '', 'sha256:telegram', '{}', '{}', '', '2026-05-31T00:00:25.000Z', '2026-05-31T00:00:25.000Z', '');`);
  const expandedOperations = await new WorkflowReadModel({ dbFile }).operationsSummary({ workflowId });
  assert.equal(expandedOperations.actionAuditSummary.total, 8);
  assert.equal(expandedOperations.actionAuditSummary.rejectedRows, 2);
  assert.equal(expandedOperations.actionAuditSummary.failedRows, 5);
  assert.equal(expandedOperations.actionAuditSummary.failureEvidenceRows, 7);
  assert.equal(Boolean(expandedOperations.actionAuditSummary.statusCounts.some((row) => row.status === "denied" && row.count === 1)), true);
  assert.equal(Boolean(expandedOperations.actionAuditSummary.statusCounts.some((row) => row.status === "failed" && row.count === 1)), true);
  assert.equal(Boolean(expandedOperations.actionAuditSummary.statusCounts.some((row) => row.status === "runtime_failed" && row.count === 1)), true);
  assert.equal(Boolean(expandedOperations.actionAuditSummary.statusCounts.some((row) => row.status === "telegram_failed" && row.count === 1)), true);
  assert.equal(Boolean(expandedOperations.actionAuditSummary.latestFailures.some((row) => row.operationId === "op-denied-audit" && row.sourceRefs[0].id === "op-denied-audit")), true);
  assert.equal(Boolean(expandedOperations.actionAuditSummary.latestFailures.some((row) => row.operationId === "op-runtime-failed-audit" && row.status === "runtime_failed")), true);
  assert.equal(Boolean(expandedOperations.actionAuditSummary.latestFailures.some((row) => row.operationId === "op-telegram-failed-audit" && row.status === "telegram_failed")), true);
  const deniedFailure = expandedOperations.actionAuditSummary.latestFailures.find((row) => row.operationId === "op-denied-audit");
  assert.ok(deniedFailure);
  assert.equal(deniedFailure.humanGateId, "hg-denied");
  assert.equal(deniedFailure.inputHash, "sha256:denied");
  assert.equal(deniedFailure.previewResult.safe, "preview");
  assert.equal(deniedFailure.result.safe, "result");
  assert.equal(JSON.stringify(deniedFailure).includes("preview-secret"), false);
  assert.equal(JSON.stringify(deniedFailure).includes("result-secret"), false);
  assert.equal(JSON.stringify(expandedOperations.actionAuditSummary).includes("denied-secret"), false);
  assert.equal(JSON.stringify(expandedOperations.actionAuditSummary).includes("error-secret"), false);
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
  assert.equal(JSON.stringify(operations.controlLoopJobDetails).includes("job-secret"), false);
  assert.equal(JSON.stringify(operations.controlLoopJobDetails).includes("lease-secret"), false);
  assert.equal(JSON.stringify(operations.staleDispatches).includes("dispatch-secret"), false);
  assert.equal(JSON.stringify(operations.messageFlowAttention).includes("flow-secret"), false);
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
	  assert.equal(humanGateRequestPreview.buttonSummary.planCountWithinPolicy, true);
	  assert.equal(humanGateRequestPreview.buttonSummary.planCount >= 2, true);
	  assert.equal(humanGateRequestPreview.buttonSummary.planCount <= 5, true);
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

async function testWorkflowRunExtractedActionContracts() {
  const expected = {
    "workflow.run.upsert": "workflowRunUpsert",
    "workflow.initiative.upsert": "workflowRunUpsert"
  };
  for (const [action, handlerName] of Object.entries(expected)) {
    assert.equal(WORKFLOW_RUN_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted workflow run registry`);
    assert.equal(WORKFLOW_RUN_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to ${handlerName}`);
  }
  assert.equal(typeof workflowRunUpsert, "function");
  const directRegistry = createWorkflowRunActionRegistry({ workflowRunUpsert });
  assert.equal(directRegistry.get("workflow.run.upsert"), workflowRunUpsert);
  assert.equal(directRegistry.get("workflow.initiative.upsert"), workflowRunUpsert);

  const root = await tempRoot("workflow-run-extracted-contracts");
  const workflowId = "wf-run-contract";
  const direct = await workflowRunUpsert(root, {
    workflowId,
    workflowType: "initiative",
    status: "not-a-real-status",
    ownerAgent: "main",
    summary: "Initial workflow run contract",
    objective: "Keep run upsert extracted behavior stable.",
    flashLane: true,
    payload: { note: "initial" }
  });
  assert.equal(direct.workflowId, workflowId);
  assert.equal(direct.status, "active");
  assert.equal(direct.workflowType, "initiative");

  const aliasUpdate = await runAction(root, {
    action: "workflow.initiative.upsert",
    workflowId,
    status: "blocked",
    ownerAgent: "cat_claw",
    summary: "Updated workflow run contract",
    currentPhase: "blocked_review",
    tradingExecution: true,
    payload: { note: "updated" }
  });
  assert.equal(aliasUpdate.status, "blocked");
  const dbFile = path.join(root, "tracking.db");
  const row = sqliteJson(dbFile, `
SELECT workflow_type AS workflowType, status, owner_agent AS ownerAgent, summary, current_phase AS currentPhase, payload_json AS payloadJson
FROM workflow_runs
WHERE workflow_id='${workflowId}'
LIMIT 1;`)[0];
  assert.equal(row.workflowType, "initiative");
  assert.equal(row.status, "blocked");
  assert.equal(row.ownerAgent, "cat_claw");
  assert.equal(row.summary, "Updated workflow run contract");
  assert.equal(row.currentPhase, "blocked_review");
  assert.equal(JSON.parse(row.payloadJson).tradingExecution, true);

  const events = sqliteJson(dbFile, `
SELECT event_type AS eventType, previous_state AS previousState, next_state AS nextState
FROM workflow_events
WHERE workflow_id='${workflowId}'
ORDER BY created_at ASC;`);
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, "workflow.created");
  assert.equal(events[0].previousState, "");
  assert.equal(events[0].nextState, "active");
  assert.equal(events[1].eventType, "workflow.updated");
  assert.equal(events[1].previousState, "active");
  assert.equal(events[1].nextState, "blocked");
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

async function testInterventionExtractedActionContracts() {
  const expected = {
    "workflow.pause": "workflowInterventionExecute",
    "workflow.resume": "workflowInterventionExecute",
    "workflow.stop": "workflowInterventionExecute",
    "workflow.terminate": "workflowInterventionExecute",
    "workflow.pause.preview": "workflowInterventionPreview",
    "workflow.preview.pause": "workflowInterventionPreview",
    "workflow.resume.preview": "workflowInterventionPreview",
    "workflow.preview.resume": "workflowInterventionPreview",
    "workflow.stop.preview": "workflowInterventionPreview",
    "workflow.preview.stop": "workflowInterventionPreview",
    "workflow.terminate.preview": "workflowInterventionPreview",
    "workflow.preview.terminate": "workflowInterventionPreview",
    "workflow.rerun.agent.preview": "workflowInterventionPreview",
    "workflow.rerun_agent.preview": "workflowInterventionPreview",
    "workflow.preview.rerun_agent": "workflowInterventionPreview",
    "workflow.rerun.phase.preview": "workflowInterventionPreview",
    "workflow.rerun_phase.preview": "workflowInterventionPreview",
    "workflow.preview.rerun_phase": "workflowInterventionPreview"
  };
  for (const [action, handlerName] of Object.entries(expected)) {
    assert.equal(INTERVENTION_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted intervention registry`);
    assert.equal(INTERVENTION_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to ${handlerName}`);
  }
  assert.equal(typeof workflowInterventionPreview, "function");
  assert.equal(typeof workflowInterventionExecute, "function");
  const directRegistry = createInterventionActionRegistry({
    workflowInterventionPreview,
    workflowInterventionExecute
  });
  assert.equal(directRegistry.get("workflow.pause.preview"), workflowInterventionPreview);
  assert.equal(directRegistry.get("workflow.preview.rerun_agent"), workflowInterventionPreview);
  assert.equal(directRegistry.get("workflow.pause"), workflowInterventionExecute);
  assert.equal(directRegistry.get("workflow.terminate"), workflowInterventionExecute);

  const root = await tempRoot("intervention-extracted-contracts");
  const workflowId = "wf-intervention-contract";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    phase: "contract",
    summary: "Intervention extracted contract"
  });
  const directPreview = await workflowInterventionPreview(root, {
    action: "workflow.preview.pause",
    workflowId
  });
  assert.equal(directPreview.kind, "pause_workflow");
  assert.equal(directPreview.action, "workflow.pause.preview");
  assert.equal(directPreview.eligible, true);
  assert.equal(directPreview.wouldUpdateWorkflow.status, "paused");

  const executed = await workflowInterventionExecute(root, {
    action: "workflow.pause",
    workflowId,
    operatorReason: "contract pause",
    rollbackBoundary: "artifact://intervention-contract-rollback",
    idempotencyKey: "idem-intervention-contract"
  }, { caller: { agentId: "flashcat", runtime: "local_codex" }, policyOutcome: "allowed" });
  assert.equal(executed.kind, "pause_workflow");
  assert.equal(executed.previousStatus, "active");
  assert.equal(executed.nextStatus, "paused");

  const stopPreview = await runAction(root, {
    action: "workflow.terminate.preview",
    workflowId
  });
  assert.equal(stopPreview.kind, "stop_workflow");
  assert.equal(stopPreview.action, "workflow.stop.preview");
  assert.equal(stopPreview.eligible, true);
  assert.equal(sqliteCount(path.join(root, "tracking.db"), "workflow_events", "event_type='workflow.intervention.executed' AND workflow_id='wf-intervention-contract'"), 1);
}

async function testWorkflowV2AdapterJobManifest() {
  const root = await tempRoot("workflow-v2-adapter-job");
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-adapter-job";
  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-v2-adapter-worker",
    status: "active",
    ownerAgent: "cat_body",
    taskType: "coding",
    runtimeTarget: "hermers",
    purpose: "Adapter job manifest smoke worker",
    systemBrief: "Use the prepared workflow session input and return results through workflow.v2.worker_result.* only.",
    resourceBudget: { contextLimitTokens: 64000 }
  });
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-adapter-job",
    nodeId: "node-v2-adapter-job",
    infoId: "info-v2-adapter-task-input",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/wf-v2-adapter-job/input.json",
    recipientAgent: "cat_body",
    summary: "Adapter job task input pointer"
  });
  const worker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-adapter-job",
    nodeId: "node-v2-adapter-job",
    managerAgent: "cat_body",
    sessionId: "session-v2-adapter-worker",
    workerRunId: "worker-v2-adapter-job",
    taskInputInfoId: "info-v2-adapter-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  const claim = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-adapter-job",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-04T00:00:00.000Z"
  });
  assert.equal(claim.workerResults[0].status, "leased_waiting_adapter");
  const lease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${worker.workerRun.workerRunId}';`)[0];
  const wrongLeasePreview = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.preview",
    workerRunId: worker.workerRun.workerRunId,
    leaseOwner: "wrong-owner",
    leaseUntil: lease.leaseUntil,
    generatedAt: "2026-07-04T00:00:01.000Z"
  });
  assert.equal(wrongLeasePreview.valid, false);
  assert.equal(Boolean(wrongLeasePreview.errors.some((item) => item.code === "lease_owner_mismatch")), true);
  const preview = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.preview",
    workerRunId: worker.workerRun.workerRunId,
    leaseOwner: lease.leaseOwner,
    leaseUntil: lease.leaseUntil,
    generatedAt: "2026-07-04T00:00:01.000Z"
  });
  assert.equal(preview.valid, true);
  assert.equal(preview.manifest.backend.hostAlias, "wsl-agents");
  assert.equal(preview.manifest.backend.image, "flashcat/hermes-worker:20260704");
  assert.equal(preview.manifest.context.limitTokens, 64000);
  assert.equal(preview.manifest.sessionInput.input.workerRunId, worker.workerRun.workerRunId);
  assert.equal(preview.manifest.output.submitAction, "workflow.v2.worker_result.submit");
  assert.equal(preview.manifest.constraints.noDirectDatabaseWrites, true);
  const record = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: worker.workerRun.workerRunId,
    leaseOwner: lease.leaseOwner,
    leaseUntil: lease.leaseUntil,
    generatedAt: "2026-07-04T00:00:01.000Z"
  });
  assert.equal(record.valid, true);
  assert.equal(record.adapterJob.status, "queued");
  assert.equal(record.adapterJob.workerAttempt, 1);
  assert.equal(Boolean(await pathExists(record.artifact.artifactFile)), true);
  const manifest = JSON.parse(await fs.readFile(record.artifact.artifactFile, "utf8"));
  assert.equal(manifest.workerRunId, worker.workerRun.workerRunId);
  assert.equal(manifest.backend.returnPath.directDatabaseWritesAllowed, false);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", `info_id='${record.adapterJobInfo.infoId}' AND worker_run_id='${worker.workerRun.workerRunId}'`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", `adapter_job_id='${record.adapterJob.adapterJobId}' AND status='queued'`), 1);
  const jobList = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.list",
    workflowId,
    status: "queued"
  });
  assert.equal(jobList.count, 1);
  assert.equal(jobList.jobs[0].adapterJobId, record.adapterJob.adapterJobId);
  const row = sqliteJson(dbFile, `SELECT status, output_info_id AS outputInfoId, payload_json AS payloadJson FROM workflow_v2_worker_runs WHERE worker_run_id='${worker.workerRun.workerRunId}';`)[0];
  assert.equal(row.status, "running");
  assert.equal(row.outputInfoId, "");
  const payload = JSON.parse(row.payloadJson || "{}");
  assert.equal(payload.adapterJob.adapterJobInfoId, record.adapterJobInfo.infoId);
  assert.equal(payload.adapterJob.artifactRef, record.artifact.artifactRef);
  assert.equal(payload.adapterJob.attempt, 1);
  const duplicatePreview = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.preview",
    workerRunId: worker.workerRun.workerRunId,
    leaseOwner: lease.leaseOwner,
    leaseUntil: lease.leaseUntil,
    adapterJobInfoId: "info-v2-adapter-job-duplicate",
    artifactId: "duplicate-adapter-job",
    generatedAt: "2026-07-04T00:00:02.000Z"
  });
  assert.equal(duplicatePreview.valid, false);
  assert.equal(Boolean(duplicatePreview.errors.some((item) => item.code === "adapter_job_already_recorded")), true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_adapter_job.record",
      workerRunId: worker.workerRun.workerRunId,
      leaseOwner: lease.leaseOwner,
      leaseUntil: lease.leaseUntil,
      adapterJobInfoId: "info-v2-adapter-job-duplicate",
      artifactId: "duplicate-adapter-job",
      generatedAt: "2026-07-04T00:00:02.000Z"
    }),
    /adapter_job_already_recorded/
  );
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET attempt=2,
    lease_owner='test-v2-adapter-job-retry',
    lease_until='2026-07-04T00:02:00.000Z',
    updated_at='2026-07-04T00:01:00.000Z'
WHERE worker_run_id='${worker.workerRun.workerRunId}';`);
  const retryAttemptPreview = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.preview",
    workerRunId: worker.workerRun.workerRunId,
    leaseOwner: "test-v2-adapter-job-retry",
    leaseUntil: "2026-07-04T00:02:00.000Z",
    generatedAt: "2026-07-04T00:01:01.000Z"
  });
  assert.equal(retryAttemptPreview.valid, true);
  assert.equal(retryAttemptPreview.manifest.lease.attempt, 2);
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET attempt=1,
    lease_owner='${lease.leaseOwner}',
    lease_until='${lease.leaseUntil}',
    updated_at='2026-07-04T00:01:05.000Z'
WHERE worker_run_id='${worker.workerRun.workerRunId}';`);
  const claimJob = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.claim",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "runner-hermes-1",
    limit: 1,
    leaseMs: 30_000,
    generatedAt: "2026-07-04T00:00:10.000Z"
  });
  assert.equal(claimJob.count, 1);
  assert.equal(claimJob.claimed[0].adapterJobId, record.adapterJob.adapterJobId);
  assert.equal(claimJob.claimed[0].status, "running");
  assert.equal(claimJob.claimed[0].runnerAttempt, 1);
  const heartbeat = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.heartbeat",
    adapterJobId: record.adapterJob.adapterJobId,
    runnerId: "runner-hermes-1",
    leaseUntil: claimJob.claimed[0].leaseUntil,
    leaseMs: 45_000,
    generatedAt: "2026-07-04T00:00:15.000Z"
  });
  assert.equal(heartbeat.job.status, "running");
  assert.notEqual(heartbeat.job.leaseUntil, claimJob.claimed[0].leaseUntil);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_result.submit",
      workerRunId: worker.workerRun.workerRunId,
      leaseOwner: lease.leaseOwner,
      leaseUntil: lease.leaseUntil,
      adapterJobId: record.adapterJob.adapterJobId,
      generatedAt: "2026-07-04T00:00:18.000Z",
      artifactRef: "artifact://workflow-v2/wf-v2-adapter-job/output-stale.json",
      receipt: { adapter: "hermers", status: "completed" },
      summary: "Adapter job output without runner lease."
    }),
    /adapter_job_lease_until_required/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${worker.workerRun.workerRunId}' AND status='running' AND lease_owner='${lease.leaseOwner}' AND lease_until='${lease.leaseUntil}'`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", `run_id='${worker.workerRun.sessionRunId}' AND status='running'`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", `adapter_job_id='${record.adapterJob.adapterJobId}' AND status='running' AND lease_owner='runner-hermes-1' AND lease_until='${heartbeat.job.leaseUntil}'`), 1);
  const submitResult = await runAction(root, {
    action: "workflow.v2.worker_result.submit",
    workerRunId: worker.workerRun.workerRunId,
    leaseOwner: lease.leaseOwner,
    leaseUntil: lease.leaseUntil,
    adapterJobId: record.adapterJob.adapterJobId,
    adapterJobLeaseOwner: "runner-hermes-1",
    adapterJobLeaseUntil: heartbeat.job.leaseUntil,
    generatedAt: "2026-07-04T00:00:20.000Z",
    artifactRef: "artifact://workflow-v2/wf-v2-adapter-job/output.json",
    receipt: { adapter: "hermers", status: "completed" },
    summary: "Adapter job output."
  });
  assert.equal(submitResult.valid, true);
  assert.equal(submitResult.adapterJobUpdate.job.status, "completed");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", `adapter_job_id='${record.adapterJob.adapterJobId}' AND status='completed'`), 1);

  const releaseWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-adapter-job",
    nodeId: "node-v2-adapter-job",
    managerAgent: "cat_body",
    sessionId: "session-v2-adapter-worker",
    workerRunId: "worker-v2-adapter-release",
    taskInputInfoId: "info-v2-adapter-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-adapter-release-worker",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-04T00:10:00.000Z"
  });
  const releaseWorkerLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${releaseWorker.workerRun.workerRunId}';`)[0];
  const releaseRecord = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: releaseWorker.workerRun.workerRunId,
    leaseOwner: releaseWorkerLease.leaseOwner,
    leaseUntil: releaseWorkerLease.leaseUntil,
    generatedAt: "2026-07-04T00:10:01.000Z"
  });
  const releaseClaim = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.claim",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "runner-hermes-release",
    limit: 1,
    leaseMs: 30_000,
    generatedAt: "2026-07-04T00:10:10.000Z"
  });
  assert.equal(releaseClaim.claimed[0].adapterJobId, releaseRecord.adapterJob.adapterJobId);
  const releaseResult = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.release",
    adapterJobId: releaseRecord.adapterJob.adapterJobId,
    runnerId: "runner-hermes-release",
    leaseUntil: releaseClaim.claimed[0].leaseUntil,
    retryDelayMs: 0,
    generatedAt: "2026-07-04T00:10:15.000Z",
    reason: "runner voluntary release"
  });
  assert.equal(releaseResult.job.status, "retry_scheduled");
  assert.equal(releaseResult.job.leaseOwner, "");
  const releasedJobRows = sqliteJson(dbFile, `SELECT status, next_retry_at AS nextRetryAt, runner_attempt AS runnerAttempt FROM workflow_v2_worker_adapter_jobs WHERE adapter_job_id='${releaseRecord.adapterJob.adapterJobId}';`);
  const releaseWorkerRows = sqliteJson(dbFile, `SELECT status, attempt, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${releaseWorker.workerRun.workerRunId}';`);
  const failClaim = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.claim",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "runner-hermes-release",
    limit: 1,
    leaseMs: 30_000,
    generatedAt: "2026-07-04T00:10:16.000Z"
  });
  assert.equal(failClaim.count, 1, JSON.stringify({ failClaim, releasedJobRows, releaseWorkerRows }));
  assert.equal(failClaim.claimed[0].adapterJobId, releaseRecord.adapterJob.adapterJobId);
  const failResult = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.fail",
    adapterJobId: releaseRecord.adapterJob.adapterJobId,
    runnerId: "runner-hermes-release",
    leaseUntil: failClaim.claimed[0].leaseUntil,
    retryAllowed: false,
    error: "runner failed after release",
    generatedAt: "2026-07-04T00:10:20.000Z"
  });
  assert.equal(failResult.job.status, "failed");
  assert.equal(failResult.job.lastError, "runner failed after release");
  assert.equal(failResult.workerResult.nextStatus, "failed");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${releaseWorker.workerRun.workerRunId}' AND status='failed' AND lease_owner='' AND lease_until=''`), 1);
  const validate = await runAction(root, {
    action: "workflow.v2.validate"
  });
  const adapterJobCheck = validate.checks.find((item) => item.checkId === "adapter_jobs_match_worker_runs");
  assert.equal(adapterJobCheck?.status, "pass", JSON.stringify(validate.failedChecks));
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status='running',
    lease_owner='stale-runner',
    lease_until='2026-07-04T00:30:00.000Z',
    completed_at='',
    updated_at='2026-07-04T00:20:00.000Z'
WHERE adapter_job_id='${releaseRecord.adapterJob.adapterJobId}';`);
  const staleValidate = await runAction(root, {
    action: "workflow.v2.validate"
  });
  const staleAdapterJobCheck = staleValidate.checks.find((item) => item.checkId === "adapter_jobs_match_worker_runs");
  assert.equal(staleAdapterJobCheck?.status, "fail");
}

async function testWorkflowV2AdapterRunnerDrain() {
  const root = await tempRoot("workflow-v2-adapter-runner");
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-adapter-runner";
  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-v2-runner-worker",
    status: "active",
    ownerAgent: "cat_body",
    taskType: "coding",
    runtimeTarget: "hermers",
    purpose: "Adapter runner drain smoke worker",
    systemBrief: "Use the prepared workflow session input and return results through workflow.v2.worker_result.* only.",
    resourceBudget: { contextLimitTokens: 64000 }
  });
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-runner",
    nodeId: "node-v2-runner",
    infoId: "info-v2-runner-task-input",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/wf-v2-adapter-runner/input.json",
    recipientAgent: "cat_body",
    summary: "Adapter runner task input pointer"
  });
  const successWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-runner",
    nodeId: "node-v2-runner",
    managerAgent: "cat_body",
    sessionId: "session-v2-runner-worker",
    workerRunId: "worker-v2-runner-success",
    taskInputInfoId: "info-v2-runner-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-runner-success-worker",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-04T01:00:00.000Z"
  });
  const successLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${successWorker.workerRun.workerRunId}';`)[0];
  await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: successWorker.workerRun.workerRunId,
    leaseOwner: successLease.leaseOwner,
    leaseUntil: successLease.leaseUntil,
    generatedAt: "2026-07-04T01:00:01.000Z"
  });
  const runnerPreview = await runAction(root, {
    action: "workflow.v2.adapter_runner.preview",
    runtimeBackend: "hermers_docker_worker",
    limit: 1,
    generatedAt: "2026-07-04T01:00:02.000Z"
  });
  assert.equal(runnerPreview.count, 1);
  assert.equal(runnerPreview.jobs[0].workerRunId, successWorker.workerRun.workerRunId);
  const successDrain = await runAction(root, {
    action: "workflow.v2.adapter_runner.drain",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "mock-runner-success",
    limit: 1,
    leaseMs: 30_000,
    generatedAt: "2026-07-04T01:00:03.000Z"
  });
  assert.equal(successDrain.submittedCount, 1);
  assert.equal(successDrain.results[0].status, "submitted");
  assert.equal(successDrain.results[0].submit.adapterJobUpdate.job.status, "completed");
  assert.equal(Boolean(await pathExists(successDrain.results[0].outputArtifact.artifactFile)), true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${successWorker.workerRun.workerRunId}' AND status='submitted_for_review' AND lease_owner='' AND lease_until=''`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", `run_id='${successWorker.workerRun.sessionRunId}' AND status='completed'`), 1);

  const externalRunnerScript = path.join(root, "external-runner.mjs");
  await fs.writeFile(externalRunnerScript, `
import fs from "node:fs/promises";

const [requestFile, outputFile] = process.argv.slice(2);
const request = JSON.parse(await fs.readFile(requestFile, "utf8"));
await fs.writeFile(outputFile, JSON.stringify({
  status: "success",
  summary: "External command worker completed " + request.adapterJob.workerRunId,
  receipt: {
    backend: request.runtimeBackend,
    adapterJobId: request.adapterJob.adapterJobId,
    workerRunId: request.adapterJob.workerRunId
  }
}, null, 2) + "\\n", "utf8");
`, "utf8");
  const externalWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-runner",
    nodeId: "node-v2-runner",
    managerAgent: "cat_body",
    sessionId: "session-v2-runner-worker",
    workerRunId: "worker-v2-runner-external",
    taskInputInfoId: "info-v2-runner-task-input",
    runtimeBackend: "claude_code_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-runner-external-worker",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-04T01:05:00.000Z"
  });
  const externalLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${externalWorker.workerRun.workerRunId}';`)[0];
  await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: externalWorker.workerRun.workerRunId,
    leaseOwner: externalLease.leaseOwner,
    leaseUntil: externalLease.leaseUntil,
    generatedAt: "2026-07-04T01:05:01.000Z"
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.adapter_runner.drain",
      mode: "external_command",
      runtimeBackend: "claude_code_docker_worker",
      runnerCommand: [process.execPath, externalRunnerScript],
      runnerId: "external-runner-input-command-rejected",
      limit: 1,
      leaseMs: 30_000,
      generatedAt: "2026-07-04T01:05:02.000Z"
    }),
    /command must be configured by environment/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.adapter_runner.drain",
      mode: "external_command",
      runtimeBackend: "claude_code_docker_worker",
      runnerId: "external-runner-missing-command",
      limit: 1,
      leaseMs: 30_000,
      generatedAt: "2026-07-04T01:05:02.000Z"
    }),
    /requires TRADING_AGENTS_WORKFLOW_V2_CLAUDE_CODE_DOCKER_WORKER_RUNNER_CMD/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", `worker_run_id='${externalWorker.workerRun.workerRunId}' AND status='queued'`), 1);
  const externalRunnerEnvKey = "TRADING_AGENTS_WORKFLOW_V2_CLAUDE_CODE_DOCKER_WORKER_RUNNER_CMD";
  const previousExternalRunnerCommand = process.env[externalRunnerEnvKey];
  process.env[externalRunnerEnvKey] = JSON.stringify([process.execPath, externalRunnerScript]);
  const externalPreview = await runAction(root, {
    action: "workflow.v2.adapter_runner.preview",
    mode: "external_command",
    runtimeBackend: "claude_code_docker_worker",
    limit: 1,
    generatedAt: "2026-07-04T01:05:02.000Z"
  });
  assert.equal(externalPreview.mode, "external_command");
  assert.equal(externalPreview.runnerCommandRequired, true);
  assert.equal(externalPreview.runnerCommandConfigured, true);
  assert.equal(externalPreview.count, 1);
  const externalDrain = await runAction(root, {
    action: "workflow.v2.adapter_runner.drain",
    mode: "external_command",
    runtimeBackend: "claude_code_docker_worker",
    runnerId: "external-runner-success",
    limit: 1,
    leaseMs: 30_000,
    generatedAt: "2026-07-04T01:05:03.000Z"
  });
  assert.equal(externalDrain.mode, "external_command");
  assert.equal(externalDrain.submittedCount, 1);
  assert.equal(externalDrain.results[0].status, "submitted");
  assert.equal(externalDrain.results[0].externalOutput.status, "success");
  assert.equal(externalDrain.results[0].externalOutput.receipt.adapterRunner, "external_command");
  assert.equal(externalDrain.results[0].submit.adapterJobUpdate.job.status, "completed");
  assert.equal(Boolean(await pathExists(externalDrain.results[0].externalOutput.artifactFile)), true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${externalWorker.workerRun.workerRunId}' AND status='submitted_for_review' AND lease_owner='' AND lease_until=''`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", `run_id='${externalWorker.workerRun.sessionRunId}' AND status='completed'`), 1);
  if (previousExternalRunnerCommand === undefined) {
    delete process.env[externalRunnerEnvKey];
  } else {
    process.env[externalRunnerEnvKey] = previousExternalRunnerCommand;
  }

  const badExternalRunnerScript = path.join(root, "external-runner-bad-output.mjs");
  await fs.writeFile(badExternalRunnerScript, `
process.stdout.write("not-json");
`, "utf8");
  const badExternalWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-runner",
    nodeId: "node-v2-runner",
    managerAgent: "cat_body",
    sessionId: "session-v2-runner-worker",
    workerRunId: "worker-v2-runner-external-bad-output",
    taskInputInfoId: "info-v2-runner-task-input",
    runtimeBackend: "claude_code_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-runner-external-bad-worker",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-04T01:06:00.000Z"
  });
  const badExternalLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${badExternalWorker.workerRun.workerRunId}';`)[0];
  await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: badExternalWorker.workerRun.workerRunId,
    leaseOwner: badExternalLease.leaseOwner,
    leaseUntil: badExternalLease.leaseUntil,
    generatedAt: "2026-07-04T01:06:01.000Z"
  });
  const previousBadExternalRunnerCommand = process.env[externalRunnerEnvKey];
  process.env[externalRunnerEnvKey] = JSON.stringify([process.execPath, badExternalRunnerScript]);
  const badExternalDrain = await runAction(root, {
    action: "workflow.v2.adapter_runner.drain",
    mode: "external_command",
    runtimeBackend: "claude_code_docker_worker",
    runnerId: "external-runner-bad-output",
    limit: 1,
    leaseMs: 30_000,
    generatedAt: "2026-07-04T01:06:03.000Z"
  });
  assert.equal(badExternalDrain.submittedCount, 0);
  assert.equal(badExternalDrain.failedCount, 1);
  assert.equal(badExternalDrain.results[0].status, "error");
  assert.match(badExternalDrain.results[0].error, /JSON|output/i);
  assert.equal(badExternalDrain.results[0].failure.job.status, "failed");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${badExternalWorker.workerRun.workerRunId}' AND status='failed' AND lease_owner='' AND lease_until=''`), 1);
  if (previousBadExternalRunnerCommand === undefined) {
    delete process.env[externalRunnerEnvKey];
  } else {
    process.env[externalRunnerEnvKey] = previousBadExternalRunnerCommand;
  }

  const failWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-runner",
    nodeId: "node-v2-runner",
    managerAgent: "cat_body",
    sessionId: "session-v2-runner-worker",
    workerRunId: "worker-v2-runner-fail",
    taskInputInfoId: "info-v2-runner-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-runner-fail-worker",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-04T01:10:00.000Z"
  });
  const failLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${failWorker.workerRun.workerRunId}';`)[0];
  await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: failWorker.workerRun.workerRunId,
    leaseOwner: failLease.leaseOwner,
    leaseUntil: failLease.leaseUntil,
    generatedAt: "2026-07-04T01:10:01.000Z"
  });
  const failDrain = await runAction(root, {
    action: "workflow.v2.adapter_runner.drain",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "mock-runner-fail",
    limit: 1,
    leaseMs: 30_000,
    mockOutcome: "fail",
    generatedAt: "2026-07-04T01:10:03.000Z"
  });
  assert.equal(failDrain.failedCount, 1);
  assert.equal(failDrain.results[0].failure.job.status, "failed");
  assert.equal(failDrain.results[0].failure.workerResult.nextStatus, "failed");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${failWorker.workerRun.workerRunId}' AND status='failed' AND lease_owner='' AND lease_until=''`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", `run_id='${failWorker.workerRun.sessionRunId}' AND status='failed'`), 1);
  const cleanValidate = await runAction(root, {
    action: "workflow.v2.validate"
  });
  const cleanAdapterJobCheck = cleanValidate.checks.find((item) => item.checkId === "adapter_jobs_match_worker_runs");
  assert.equal(cleanAdapterJobCheck?.status, "pass", JSON.stringify(cleanValidate.failedChecks));

  const badManifestWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-runner",
    nodeId: "node-v2-runner",
    managerAgent: "cat_body",
    sessionId: "session-v2-runner-worker",
    workerRunId: "worker-v2-runner-bad-manifest",
    taskInputInfoId: "info-v2-runner-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-runner-bad-worker",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-04T01:20:00.000Z"
  });
  const badManifestLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${badManifestWorker.workerRun.workerRunId}';`)[0];
  const badManifestRecord = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: badManifestWorker.workerRun.workerRunId,
    leaseOwner: badManifestLease.leaseOwner,
    leaseUntil: badManifestLease.leaseUntil,
    generatedAt: "2026-07-04T01:20:01.000Z"
  });
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET manifest_hash=''
WHERE adapter_job_id='${badManifestRecord.adapterJob.adapterJobId}';`);
  const badManifestDrain = await runAction(root, {
    action: "workflow.v2.adapter_runner.drain",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "mock-runner-bad-manifest",
    limit: 1,
    leaseMs: 30_000,
    generatedAt: "2026-07-04T01:20:03.000Z"
  });
  assert.equal(badManifestDrain.failedCount, 1);
  assert.equal(badManifestDrain.results[0].status, "error");
  assert.match(badManifestDrain.results[0].error, /manifest hash missing/);
  assert.equal(badManifestDrain.results[0].failure.job.status, "failed");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${badManifestWorker.workerRun.workerRunId}' AND status='failed' AND lease_owner='' AND lease_until=''`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", `run_id='${badManifestWorker.workerRun.sessionRunId}' AND status='failed'`), 1);

  const corruptValidate = await runAction(root, {
    action: "workflow.v2.validate"
  });
  const corruptAdapterJobCheck = corruptValidate.checks.find((item) => item.checkId === "adapter_jobs_match_worker_runs");
  assert.equal(corruptAdapterJobCheck?.status, "fail", JSON.stringify(corruptValidate.failedChecks));
}

async function testWorkflowV2AdapterRunnerConcurrencyRecovery() {
  const root = await tempRoot("workflow-v2-adapter-runner-concurrency");
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-adapter-runner-concurrency";
  const planId = "plan-v2-runner-concurrency";
  const nodeId = "node-v2-runner-concurrency";
  const sessionId = "session-v2-runner-concurrency";
  const infoId = "info-v2-runner-concurrency-input";
  const workerCount = 6;
  const releaseCount = 1;
  const failCount = 1;
  const baseMs = Date.parse("2026-07-04T02:00:00.000Z");
  const iso = (offsetMs) => new Date(baseMs + offsetMs).toISOString();
  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId,
    status: "active",
    ownerAgent: "cat_body",
    taskType: "coding",
    runtimeTarget: "hermers",
    purpose: "Adapter runner bounded concurrency and recovery regression",
    systemBrief: "Use the prepared workflow session input and return results through workflow.v2.worker_result.* only.",
    resourceBudget: { contextLimitTokens: 64000 }
  });
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId,
    nodeId,
    infoId,
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/wf-v2-adapter-runner-concurrency/input.json",
    recipientAgent: "cat_body",
    summary: "Adapter runner concurrency task input pointer"
  });

  const workers = [];
  for (let index = 0; index < workerCount; index += 1) {
    const workerRunId = `worker-v2-runner-concurrency-${String(index).padStart(2, "0")}`;
    const worker = await runAction(root, {
      action: "workflow.v2.worker_spawn.create",
      workflowId,
      planId,
      nodeId,
      managerAgent: "cat_body",
      sessionId,
      workerRunId,
      taskInputInfoId: infoId,
      runtimeBackend: "hermers_docker_worker",
      ...v2WorkerDelegation(),
      maxAttempts: 2,
      providerModel: "iflytek/fallback",
      receipt: { provider: "iflytek", model: "fallback", fallbackAttempts: 0, errorCode: "" },
      oauth: { expiryOk: true, refreshOk: true },
      network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false },
      generatedAt: iso(index)
    });
    workers.push(worker.workerRun);
  }

  const leaseClaim = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-runner-concurrency-worker-lease",
    workerLimit: workerCount,
    workerLeaseMs: 10 * 60_000,
    generatedAt: iso(60_000)
  });
  assert.equal(leaseClaim.workerResults.length, workerCount);
  assert.equal(leaseClaim.workerResults.every((item) => item.status === "leased_waiting_adapter"), true);

  const adapterJobIdsByWorker = {};
  for (let index = 0; index < workers.length; index += 1) {
    const worker = workers[index];
    const lease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${worker.workerRunId}';`)[0];
    const record = await runAction(root, {
      action: "workflow.v2.worker_adapter_job.record",
      workerRunId: worker.workerRunId,
      leaseOwner: lease.leaseOwner,
      leaseUntil: lease.leaseUntil,
      maxRunnerAttempts: 4,
      generatedAt: iso(61_000 + index)
    });
    adapterJobIdsByWorker[worker.workerRunId] = record.adapterJob.adapterJobId;
  }

  const releaseWorkerIds = workers.slice(0, releaseCount).map((item) => item.workerRunId);
  const failWorkerIds = workers.slice(releaseCount, releaseCount + failCount).map((item) => item.workerRunId);
  const firstPassOutcomes = Object.fromEntries([
    ...releaseWorkerIds.map((workerRunId) => [workerRunId, "release"]),
    ...failWorkerIds.map((workerRunId) => [workerRunId, "fail"])
  ]);
  const beforePreview = await runAction(root, {
    action: "workflow.v2.adapter_runner.preview",
    runtimeBackend: "hermers_docker_worker",
    limit: 200,
    generatedAt: iso(120_000)
  });
  assert.equal(beforePreview.count, workerCount);
  assert.equal(beforePreview.dueCount, workerCount);

  const zeroLimitClaim = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.claim",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "mock-runner-zero-limit",
    limit: 0,
    generatedAt: iso(120_000)
  });
  assert.equal(zeroLimitClaim.capacity.requestedLimit, 0);
  assert.equal(zeroLimitClaim.capacity.effectiveLimit, 0);
  assert.equal(zeroLimitClaim.count, 0);
  assert.equal(zeroLimitClaim.claimed.length, 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='queued'"), workerCount);

  const pausedDrain = await runAction(root, {
    action: "workflow.v2.adapter_runner.drain",
    runtimeBackend: "hermers_docker_worker",
    runnerId: "mock-runner-paused-capacity",
    limit: 10,
    capacityProfile: {
      maxLogicalWorkers: 200,
      maxActiveJobs: 0,
      modelMaxConcurrentCalls: 0,
      providerModel: "iflytek/fallback"
    },
    generatedAt: iso(120_000)
  });
  assert.equal(pausedDrain.capacity.requestedLimit, 10);
  assert.equal(pausedDrain.capacity.effectiveLimit, 0);
  assert.equal(pausedDrain.count, 0);
  assert.equal(pausedDrain.claimed.length, 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='queued'"), workerCount);

  const capacityPreview = await runAction(root, {
    action: "workflow.v2.adapter_runner.preview",
    runtimeBackend: "hermers_docker_worker",
    limit: 10,
    capacityProfile: {
      maxLogicalWorkers: 200,
      maxActiveJobs: 3,
      providerModel: "iflytek/fallback"
    },
    generatedAt: iso(120_000)
  });
  assert.equal(capacityPreview.count, 3);
  assert.equal(capacityPreview.dueCount, workerCount);
  assert.equal(capacityPreview.capacity.requestedLimit, 10);
  assert.equal(capacityPreview.capacity.effectiveLimit, 3);
  assert.equal(capacityPreview.capacity.maxLogicalWorkers, 200);
  assert.equal(capacityPreview.capacity.backendMaxActiveJobs, 3);
  assert.equal(capacityPreview.capacity.providerMaxConcurrentCalls, 3);
  assert.equal(capacityPreview.capacity.throttled, true);

  const firstPass = [];
  for (const runnerId of ["mock-runner-contention-a", "mock-runner-contention-b", "mock-runner-contention-c"]) {
    firstPass.push(await runAction(root, {
      action: "workflow.v2.adapter_runner.drain",
      runtimeBackend: "hermers_docker_worker",
      runnerId,
      limit: 10,
      capacityProfile: {
        maxLogicalWorkers: 200,
        maxActiveJobs: 3,
        providerModel: "iflytek/fallback"
      },
      leaseMs: 30_000,
      retryDelayMs: 10_000,
      jobOutcomes: firstPassOutcomes,
      generatedAt: iso(120_000)
    }));
  }
  const firstPassResults = firstPass.flatMap((item) => item.results);
  assert.equal(firstPass.every((item) => item.capacity.requestedLimit === 10), true);
  assert.equal(firstPass.every((item) => item.capacity.effectiveLimit <= 3), true);
  assert.equal(firstPass.every((item) => item.count <= 3), true);
  assert.equal(firstPass.filter((item) => item.count > 0).length >= 2, true);
  assert.equal(firstPassResults.length, workerCount);
  assert.equal(new Set(firstPassResults.map((item) => item.adapterJobId)).size, firstPassResults.length);
  assert.equal(firstPass.reduce((total, item) => total + item.releasedCount, 0), releaseCount);
  assert.equal(firstPass.reduce((total, item) => total + item.failedCount, 0), failCount);
  assert.equal(firstPass.reduce((total, item) => total + item.submittedCount, 0), workerCount - releaseCount - failCount);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='running'"), 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='retry_scheduled'"), releaseCount);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='failed'"), failCount);
  for (const workerRunId of failWorkerIds) {
    assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", `worker_run_id='${workerRunId}' AND status='failed' AND lease_owner='' AND lease_until=''`), 1);
  }

  const recoveryOutcomes = Object.fromEntries(failWorkerIds.map((workerRunId) => [workerRunId, "fail"]));
  const allRecoveryResults = [];
  for (let round = 0; round < 8; round += 1) {
    const generatedAt = iso(140_000 + round * 1_000);
    const preview = await runAction(root, {
      action: "workflow.v2.adapter_runner.preview",
      runtimeBackend: "hermers_docker_worker",
      limit: 200,
      generatedAt
    });
    if (preview.count === 0) break;
    const drain = await runAction(root, {
      action: "workflow.v2.adapter_runner.drain",
      runtimeBackend: "hermers_docker_worker",
      runnerId: `mock-runner-recovery-${round}`,
      limit: 11,
      leaseMs: 30_000,
      retryDelayMs: 0,
      jobOutcomes: recoveryOutcomes,
      generatedAt
    });
    allRecoveryResults.push(...drain.results);
  }
  assert.equal(allRecoveryResults.length, releaseCount);
  assert.equal(allRecoveryResults.every((item) => item.status === "submitted"), true);
  assert.equal(new Set(allRecoveryResults.map((item) => item.adapterJobId)).size, releaseCount);

  const finalPreview = await runAction(root, {
    action: "workflow.v2.adapter_runner.preview",
    runtimeBackend: "hermers_docker_worker",
    limit: 200,
    generatedAt: iso(160_000)
  });
  assert.equal(finalPreview.count, 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='queued'"), 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='retry_scheduled'"), 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='running'"), 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='failed'"), failCount);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_adapter_jobs", "status='completed'"), workerCount - failCount);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "status='submitted_for_review'"), workerCount - failCount);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "status='failed'"), failCount);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", "status='completed'"), workerCount - failCount);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", "status='failed'"), failCount);
  const allResults = [...firstPassResults, ...allRecoveryResults];
  const completedJobIds = sqliteJson(dbFile, `
SELECT adapter_job_id AS adapterJobId
FROM workflow_v2_worker_adapter_jobs
WHERE status='completed'
ORDER BY adapter_job_id;`).map((row) => row.adapterJobId);
  assert.equal(completedJobIds.length, workerCount - failCount);
  for (const workerRunId of releaseWorkerIds) {
    const adapterJobId = adapterJobIdsByWorker[workerRunId];
    assert.equal(completedJobIds.includes(adapterJobId), true);
    assert.equal(allResults.filter((item) => item.adapterJobId === adapterJobId && item.status === "released").length, 1);
    assert.equal(allResults.filter((item) => item.adapterJobId === adapterJobId && item.status === "submitted").length, 1);
  }
  const validate = await runAction(root, {
    action: "workflow.v2.validate"
  });
  const adapterJobCheck = validate.checks.find((item) => item.checkId === "adapter_jobs_match_worker_runs");
  assert.equal(adapterJobCheck?.status, "pass", JSON.stringify(validate.failedChecks));
}

function v2KernelReceipt(overrides = {}) {
  return { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "", ...overrides };
}

function v2KernelOAuth(overrides = {}) {
  return { expiryOk: true, refreshOk: true, ...overrides };
}

function v2KernelNetwork(overrides = {}) {
  return { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false, ...overrides };
}

function v2KernelManagerWorkerNode(plan) {
  return plan.nodes.find((node) => node.nodeType === "manager_worker_spawn");
}

function v2KernelManagerPlanningNode(plan) {
  return plan.nodes.find((node) => node.nodeType === "manager_planning");
}

async function setupWorkflowV2KernelPlanFixture(name = "workflow-v2-kernel-fixture") {
  const root = await tempRoot(name);
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-kernel";
  const plan = await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId: "plan-v2-kernel",
    objective: "Persist v2 orchestration plan.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose"],
    ...v2PlanContract()
  });
  return { root, dbFile, workflowId, plan };
}

async function setupWorkflowV2KernelExecutionFixture(name = "workflow-v2-kernel-execution") {
  const fixture = await setupWorkflowV2KernelPlanFixture(name);
  const { root, workflowId, plan } = fixture;
  for (const agent of [
    { agentId: "cat_heart", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] },
    { agentId: "cat_nose", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] },
    { agentId: "cat_body", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify", "workflow.worker.lifecycle", "cat_claw.audit"] },
    { agentId: "main", runtime: "openclaw", platform: "openclaw", permissions: ["workflow.verify"] },
    { agentId: "cat_claw", runtime: "openclaw", platform: "openclaw", permissions: ["cat_claw.audit", "human_gate.write"] }
  ]) {
    await runAction(root, {
      action: "runtime.agent.upsert",
      agentId: agent.agentId,
      runtime: agent.runtime,
      platform: agent.platform,
      capabilities: { permissions: agent.permissions }
    });
  }
  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-cat-body-worker",
    ownerAgent: "cat_body",
    runtimeTarget: "hermers",
    taskType: "development_worker",
    purpose: "Preloaded worker context for cat_body manager spawned coding work.",
    systemBrief: "Use only referenced artifacts and return structured output."
  });
  const info = await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: v2KernelManagerPlanningNode(plan).nodeId,
    infoId: "info-v2-task-input",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/task-input.json",
    recipientAgent: "cat_body",
    summary: "Task input pointer for cat_body manager."
  });
  return { ...fixture, info };
}

function workflowV2KernelWorkerInput(fixture, overrides = {}) {
  const runtimeBackend = overrides.runtimeBackend || "local_deterministic";
  return {
    action: "workflow.v2.worker_spawn.create",
    workflowId: fixture.workflowId,
    planId: "plan-v2-kernel",
    nodeId: v2KernelManagerWorkerNode(fixture.plan).nodeId,
    managerAgent: "cat_body",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend,
    maxAttempts: 2,
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: v2KernelReceipt(),
    oauth: v2KernelOAuth(),
    network: v2KernelNetwork(),
    ...overrides
  };
}

async function testWorkflowV2ExtractedActionContracts() {
  const fixture = await setupWorkflowV2KernelExecutionFixture("workflow-v2-extracted-action-contracts");
  const { root, dbFile, workflowId } = fixture;
  const workflowModule = await import("../src/workflow.js");
  for (const exportName of ["workflowV2ControlLoopPreview", "workflowV2ControlLoopTick", "workflowV2Validate"]) {
    assert.equal(typeof workflowModule[exportName], "function", `${exportName} should remain a public workflow.js export`);
  }
  for (const action of ["workflow.v2.control_loop.preview", "workflow.v2.control_loop.tick", "workflow.v2.validate"]) {
    assert.equal(workflowModule.WORKFLOW_V2_ACTION_REGISTRY.has(action), true, `${action} should remain registered`);
  }

  const worker = await runAction(root, workflowV2KernelWorkerInput(fixture, {
    workerRunId: "worker-v2-extracted-contract",
    contextBudgetTokens: 1000,
    payload: { outputSummary: "Deterministic extracted-action contract output." }
  }));
  assert.equal(worker.valid, true);
  const generatedAt = "2026-07-05T00:00:00.000Z";
  const preview = await runAction(root, {
    action: "workflow.v2.control_loop.preview",
    workflowId,
    generatedAt,
    limit: 5
  });
  assert.deepEqual(Object.keys(preview).sort(), [
    "counts",
    "dbFile",
    "dryRun",
    "generatedAt",
    "ok",
    "operation",
    "previewOnly",
    "runnableWorkers",
    "status"
  ].sort());
  assert.equal(preview.operation, "workflow.v2.control_loop.preview");
  assert.equal(preview.dryRun, true);
  assert.equal(preview.previewOnly, true);
  assert.equal(preview.status, "ok");
  assert.equal(preview.ok, true);
  assert.equal(preview.generatedAt, generatedAt);
  assert.deepEqual(Object.keys(preview.counts).sort(), [
    "due",
    "expired_leases",
    "invalid_preflight",
    "queued",
    "retry_scheduled",
    "running",
    "submitted_for_review",
    "terminal",
    "total"
  ].sort());
  assert.equal(Number(preview.counts.due), 1);
  assert.equal(preview.runnableWorkers.length, 1);
  assert.deepEqual(Object.keys(preview.runnableWorkers[0]).sort(), [
    "attempt",
    "completedAt",
    "compactionCount",
    "contextBudgetTokens",
    "contextUsedTokens",
    "createdAt",
    "handoffInfoId",
    "lastError",
    "leaseOwner",
    "leaseUntil",
    "managerAgent",
    "maxAttempts",
    "nextRetryAt",
    "nodeId",
    "outputInfoId",
    "parentWorkerRunId",
    "planId",
    "preflightId",
    "receiptRef",
    "runtimeBackend",
    "sessionId",
    "sessionRunId",
    "sourceContextRefs",
    "startedAt",
    "status",
    "successorWorkerRunId",
    "supersedesWorkerRunId",
    "taskInputInfoId",
    "updatedAt",
    "workerAgentId",
    "workerGeneration",
    "workerRunId",
    "workflowId"
  ].sort());
  assert.equal(preview.runnableWorkers[0].workerRunId, worker.workerRun.workerRunId);
  assert.equal(preview.runnableWorkers[0].runtimeBackend, "local_deterministic");

  const dryRunTick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    generatedAt,
    dryRun: true
  });
  assert.equal(dryRunTick.operation, "workflow.v2.control_loop.preview");
  assert.equal(dryRunTick.previewOnly, true);
  assert.equal(Number(dryRunTick.counts.due), 1);

  const tick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-extracted-contract",
    workerLeaseMs: 60_000,
    generatedAt
  });
  assert.deepEqual(Object.keys(tick).sort(), [
    "claimedWorkers",
    "counts",
    "dbFile",
    "dryRun",
    "expiredLeases",
    "generatedAt",
    "ok",
    "operation",
    "previewOnly",
    "status",
    "workerResults"
  ].sort());
  assert.equal(tick.operation, "workflow.v2.control_loop.tick");
  assert.equal(tick.status, "ok");
  assert.equal(tick.ok, true);
  assert.equal(tick.dryRun, false);
  assert.equal(tick.previewOnly, false);
  assert.equal(tick.generatedAt, generatedAt);
  assert.deepEqual(tick.expiredLeases, []);
  assert.equal(tick.claimedWorkers.length, 1);
  assert.equal(tick.claimedWorkers[0].workerRunId, worker.workerRun.workerRunId);
  assert.equal(tick.claimedWorkers[0].status, "running");
  assert.equal(tick.claimedWorkers[0].leaseOwner, "test-v2-extracted-contract");
  assert.equal(tick.workerResults.length, 1);
  assert.deepEqual(Object.keys(tick.workerResults[0]).sort(), [
    "artifactFile",
    "artifactRef",
    "autonomousLoop",
    "outputInfoId",
    "receiptRef",
    "status",
    "workerRunId"
  ].sort());
  assert.equal(tick.workerResults[0].workerRunId, worker.workerRun.workerRunId);
  assert.equal(tick.workerResults[0].status, "submitted_for_review");
  assert.equal(tick.workerResults[0].autonomousLoop, null);
  assert.equal(await pathExists(tick.workerResults[0].artifactFile), true);
  assert.equal(Number(tick.counts.due), 0);
  const workerRow = sqliteJson(dbFile, `
SELECT status, attempt, output_info_id AS outputInfoId, receipt_ref AS receiptRef, lease_owner AS leaseOwner, lease_until AS leaseUntil, completed_at AS completedAt
FROM workflow_v2_worker_runs
WHERE worker_run_id='${worker.workerRun.workerRunId}'
LIMIT 1;`)[0];
  assert.equal(workerRow.status, "submitted_for_review");
  assert.equal(workerRow.attempt, 1);
  assert.equal(workerRow.outputInfoId, tick.workerResults[0].outputInfoId);
  assert.equal(workerRow.receiptRef, tick.workerResults[0].receiptRef);
  assert.equal(workerRow.leaseOwner, "");
  assert.equal(workerRow.leaseUntil, "");
  assert.equal(workerRow.completedAt, generatedAt);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", `info_id='${tick.workerResults[0].outputInfoId}' AND worker_run_id='${worker.workerRun.workerRunId}'`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", `run_id='${worker.workerRun.sessionRunId}' AND status='completed' AND receipt_ref='${tick.workerResults[0].receiptRef}'`), 1);

  const validate = await runAction(root, {
    action: "workflow.v2.validate",
    workflowId
  });
  assert.deepEqual(Object.keys(validate).sort(), [
    "advisoryChecks",
    "advisoryCount",
    "advisoryFindings",
    "checks",
    "dbFile",
    "dryRun",
    "failedChecks",
    "missingSchema",
    "ok",
    "operation",
    "previewOnly",
    "schema",
    "status"
  ].sort());
  assert.equal(validate.operation, "workflow.v2.validate");
  assert.equal(validate.dryRun, true);
  assert.equal(validate.previewOnly, true);
  assert.equal(validate.status, "pass");
  assert.equal(validate.ok, true);
  assert.deepEqual(validate.failedChecks, []);
  assert.deepEqual(validate.missingSchema, []);
  assert.equal(validate.schema.workflow_v2_worker_runs.exists, true);
  assert.equal(validate.schema.workflow_v2_worker_runs.requiredColumnsPresent, true);
  for (const checkId of [
    "worker_runs_require_valid_preflight",
    "worker_runs_session_runs_match",
    "worker_run_control_lifecycle_fields",
    "worker_run_output_info_exists"
  ]) {
    assert.equal(validate.checks.find((item) => item.checkId === checkId)?.status, "pass", `${checkId} should pass`);
  }
}

async function setupWorkflowV2SubmittedWorkerFixture(name = "workflow-v2-submitted-worker", overrides = {}) {
  const fixture = await setupWorkflowV2KernelExecutionFixture(name);
  const worker = await runAction(fixture.root, workflowV2KernelWorkerInput(fixture, {
    workerRunId: "worker-v2-submitted",
    ...overrides
  }));
  const tick = await runAction(fixture.root, {
    action: "workflow.v2.control_loop.tick",
    workflowId: fixture.workflowId,
    claimOwner: "test-v2-focused-control-loop",
    workerLeaseMs: 60_000
  });
  const completedWorker = sqliteJson(fixture.dbFile, `
SELECT status, attempt, output_info_id AS outputInfoId, receipt_ref AS receiptRef, lease_owner AS leaseOwner, lease_until AS leaseUntil, completed_at AS completedAt
FROM workflow_v2_worker_runs
WHERE worker_run_id='${worker.workerRun.workerRunId}';`)[0];
  return { ...fixture, worker, tick, completedWorker };
}

async function setupWorkflowV2AcceptedWorkerFixture(name = "workflow-v2-accepted-worker") {
  const fixture = await setupWorkflowV2SubmittedWorkerFixture(name);
  const review = await runAction(fixture.root, {
    action: "workflow.v2.manager_review.record",
    workflowId: fixture.workflowId,
    planId: "plan-v2-kernel",
    workerRunId: fixture.worker.workerRun.workerRunId,
    reviewerAgent: "cat_body",
    decision: "accepted",
    summary: "Worker output accepted by manager."
  });
  return { ...fixture, review };
}

async function setupWorkflowV2GovernanceFixture(name = "workflow-v2-governance") {
  const fixture = await setupWorkflowV2AcceptedWorkerFixture(name);
  const ownerReview = await runAction(fixture.root, {
    action: "workflow.v2.owner_review.record",
    workflowId: fixture.workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_heart",
    managerReviewIds: [fixture.review.review.reviewId],
    decision: "accepted",
    taskGroupRequired: true,
    summary: "Task owner accepted manager artifact and requires compact task group review.",
    artifactRefs: ["artifact://workflow-v2/owner-package.json"],
    receiptRefs: ["receipt://workflow-v2/manager-review"]
  });
  const taskGroupPackage = await runAction(fixture.root, {
    action: "workflow.v2.task_group_package.record",
    workflowId: fixture.workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_heart",
    ownerReviewId: ownerReview.ownerReview.reviewId,
    taskGroupAgents: ["cat_heart", "cat_body"],
    status: "ready",
    summary: "Owner plus Cat Body task group package is ready for Cat Brain governance audit.",
    evidenceRefs: ["artifact://workflow-v2/owner-package.json", "receipt://workflow-v2/manager-review"]
  });
  const catBrainAudit = await runAction(fixture.root, {
    action: "workflow.v2.cat_brain_audit.record",
    workflowId: fixture.workflowId,
    planId: "plan-v2-kernel",
    taskGroupPackageId: taskGroupPackage.taskGroupPackage.packageId,
    callerAgent: "main",
    decision: "approved",
    summary: "Cat Brain governance audit approved the evidence chain.",
    evidenceRefs: ["artifact://workflow-v2/owner-package.json", "receipt://workflow-v2/manager-review"]
  });
  const catClawAudit = await runAction(fixture.root, {
    action: "workflow.v2.cat_claw_audit.record",
    workflowId: fixture.workflowId,
    planId: "plan-v2-kernel",
    catBrainAuditId: catBrainAudit.catBrainAudit.auditId,
    callerAgent: "cat_claw",
    decision: "protocol_ready",
    summary: "Cat Claw protocol audit passed; Human Gate package can be prepared.",
    checks: ["options_present", "evidence_refs_present", "rollback_boundary_present"],
    evidenceRefs: ["artifact://workflow-v2/owner-package.json", "receipt://workflow-v2/manager-review"]
  });
  return { ...fixture, ownerReview, taskGroupPackage, catBrainAudit, catClawAudit };
}

function workflowV2KernelHumanGateOptions() {
  return [
    {
      optionId: "continue_current_package",
      title: "方案 1：接受当前产出",
      body: "接受 task owner、task group、猫之脑和猫爪已经复核过的当前产出包。",
      summary: "按当前证据包接受本轮产出。",
      prompt: "闪电猫批准后，workflow 进入收口归档，保留 artifact、receipt 和回滚边界。",
      rollback: "如后续发现证据缺口，退回 task owner 重新汇总并恢复到上一 checkpoint。"
    },
    {
      optionId: "return_to_manager_review",
      title: "方案 2：退回经理补证",
      body: "不接受当前产出，退回 manager 层补充 worker 证据、测试或回滚说明。",
      summary: "退回 manager 层补齐证据后再提交。",
      prompt: "task owner 将缺口退回相关 manager，manager 复核 worker 产出后重新提交。",
      rollback: "补证仍不完整时，保持 workflow 在 review 状态并记录 blocker。"
    }
  ];
}

async function testWorkflowV2PlanAdvisoryAndCanonicalArtifact() {
  const root = await tempRoot("workflow-v2-plan-focused");
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-kernel";
  const missingPatternPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "This plan intentionally omits orchestrationPattern.",
    taskOwnerAgent: "cat_heart",
    acceptanceCriteria: ["explicit acceptance exists"]
  });
  assert.equal(missingPatternPreview.valid, true);
  assert.equal(Boolean(missingPatternPreview.advisoryChecks.some((item) => item.code === "orchestration_pattern_recommended")), true);
  assert.equal(missingPatternPreview.recommendations.preferredPattern, "manager_worker");

  const directOwnerPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Direct owner plan should not auto-inject manager nodes.",
    taskOwnerAgent: "cat_heart",
    ...v2PlanContract({
      orchestrationPattern: "direct_owner_execution",
      orchestrationRationale: "This direct owner preview intentionally omits participantManagers and must stay owner-only.",
      workerBudget: { maxWorkers: 0, concurrencyLimit: 0, maxWorkerContextTokens: 64000 }
    })
  });
  assert.equal(directOwnerPreview.valid, true);
  assert.deepEqual(directOwnerPreview.plan.participantManagers, []);
  assert.equal(Boolean(directOwnerPreview.nodes.some((node) => node.nodeType === "manager_worker_spawn")), false);
  assert.equal(Boolean(directOwnerPreview.nodes.some((node) => node.nodeType === "manager_review")), false);

  const planPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "猫之心负责组织猫成员经理，分解任务并调度 worker 产出 artifacts。",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose", "cat_eyes"],
    ...v2PlanContract({
      acceptanceCriteria: ["session repository is used", "worker output is reviewed"],
      workerBudget: { maxWorkers: 12, concurrencyLimit: 4, maxWorkerContextTokens: 64000 }
    })
  });
  assert.equal(planPreview.valid, true);
  assert.equal(planPreview.dryRun, true);
  assert.equal(planPreview.plan.workflowState, "draft");
  assert.equal(planPreview.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(planPreview.planSpecV2.orchestration.pattern, "manager_worker");
  assert.equal(planPreview.planSpecV2.acceptance.ownerReviewsManagerArtifacts, true);
  assert.equal(Boolean(planPreview.advisoryChecks.some((item) => item.code === "manager_worker_domain_ownership_recommended")), false);
  assert.equal(Boolean(planPreview.nodes.find((node) => node.nodeType === "manager_worker_spawn")?.payload?.domainOwnership), true);
  assert.equal(Boolean(await pathExists(dbFile)), false);

  const nodeStructurePreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Explicit manager-worker nodes should expose manager ownership, expected artifacts, and review policy.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-structure-spawn", nodeType: "manager_worker_spawn", ownerAgent: "cat_body", payload: {} },
      { nodeId: "node-structure-review", nodeType: "manager_review", ownerAgent: "cat_body", dependsOn: ["node-structure-spawn"] }
    ]
  });
  assert.equal(nodeStructurePreview.valid, true);
  assert.equal(Boolean(nodeStructurePreview.advisoryChecks.some((item) => item.code === "manager_worker_domain_ownership_recommended")), true);
  assert.equal(Boolean(nodeStructurePreview.advisoryChecks.some((item) => item.code === "manager_worker_expected_artifacts_recommended")), true);
  assert.equal(Boolean(nodeStructurePreview.advisoryChecks.some((item) => item.code === "manager_worker_review_policy_recommended")), true);

  const missingSpawnPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Manager-worker plans should not jump straight to manager review without a spawn node.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-missing-spawn-review", nodeType: "manager_review", ownerAgent: "cat_body" }
    ]
  });
  assert.equal(missingSpawnPreview.valid, true);
  assert.equal(Boolean(missingSpawnPreview.advisoryChecks.some((item) => item.code === "manager_worker_spawn_node_recommended")), true);

  const cleanExplicitPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "A complete explicit manager-worker node set should avoid manager-worker structure advisories.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-clean-spawn", nodeType: "manager_worker_spawn", ownerAgent: "cat_body", payload: { domainOwnership: "implementation", expectedArtifacts: ["artifact:implementation"], reviewPolicy: "manager review" } },
      { nodeId: "node-clean-review", nodeType: "manager_review", ownerAgent: "cat_body", dependsOn: ["node-clean-spawn"] }
    ]
  });
  assert.equal(Boolean(cleanExplicitPreview.advisoryChecks.some((item) => String(item.code || "").startsWith("manager_worker_"))), false);

  const parallelSectionPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Parallel manager sections should keep section ownership distinct.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose"],
    ...v2PlanContract({
      orchestrationPattern: "parallel_manager_sections",
      workerBudget: { maxWorkers: 4, concurrencyLimit: 2, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-parallel-a", nodeType: "manager_worker_spawn", ownerAgent: "cat_body", payload: { domainOwnership: "data", expectedArtifacts: ["artifact:data"], reviewPolicy: "manager review" } },
      { nodeId: "node-parallel-b", nodeType: "manager_worker_spawn", ownerAgent: "cat_nose", payload: { domainOwnership: "data", expectedArtifacts: ["artifact:signals"], reviewPolicy: "manager review" } },
      { nodeId: "node-parallel-review", nodeType: "manager_review", ownerAgent: "cat_heart", dependsOn: ["node-parallel-a", "node-parallel-b"] }
    ]
  });
  assert.equal(Boolean(parallelSectionPreview.advisoryChecks.some((item) => item.code === "parallel_sections_should_be_distinct")), true);

  const evaluatorPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Evaluator optimizer plans should expose a separate review path.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      orchestrationPattern: "evaluator_optimizer",
      workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-evaluator-producer", nodeType: "producer", ownerAgent: "cat_body", payload: { expectedArtifacts: ["artifact:producer"] } },
      { nodeId: "node-evaluator-review", nodeType: "evaluator", ownerAgent: "cat_body", dependsOn: ["node-evaluator-producer"] }
    ]
  });
  assert.equal(Boolean(evaluatorPreview.advisoryChecks.some((item) => item.code === "evaluator_optimizer_distinct_reviewer_recommended")), true);
  assert.equal(Boolean(evaluatorPreview.advisoryChecks.some((item) => item.code === "evaluator_optimizer_evaluator_contract_recommended")), true);

  const evaluatorContractPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Evaluator optimizer plans should expose a structured evaluator contract.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose"],
    ...v2PlanContract({
      orchestrationPattern: "evaluator_optimizer",
      workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-evaluator-contract-producer", nodeType: "producer", ownerAgent: "cat_body", payload: { outputSchema: "producer-output.v1", expectedArtifacts: ["artifact:producer-output"] } },
      {
        nodeId: "node-evaluator-contract-review",
        nodeType: "evaluator",
        ownerAgent: "cat_nose",
        dependsOn: ["node-evaluator-contract-producer"],
        payload: {
          producerNodeId: "node-evaluator-contract-producer",
          evaluatorInput: "producer output info item",
          rubric: "Evaluate producer output against acceptance criteria and evidence completeness.",
          reviewArtifact: "artifact://workflow-v2/evaluator-review.json",
          decisionStates: ["accepted", "rejected", "needs_revision"]
        }
      }
    ]
  });
  assert.equal(evaluatorContractPreview.valid, true);
  assert.equal(Boolean(evaluatorContractPreview.advisoryChecks.some((item) => String(item.code || "").startsWith("evaluator_optimizer_"))), false);

  const autonomousLoopPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Autonomous agent loops should expose iteration caps, feedback checkpoints, and stop conditions.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      orchestrationPattern: "autonomous_agent_loop",
      workerBudget: { maxWorkers: 1, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-autonomous-loop", nodeType: "autonomous_loop", ownerAgent: "cat_body", payload: {} }
    ]
  });
  assert.equal(Boolean(autonomousLoopPreview.advisoryChecks.some((item) => item.code === "autonomous_loop_iteration_cap_recommended")), true);
  assert.equal(Boolean(autonomousLoopPreview.advisoryChecks.some((item) => item.code === "autonomous_loop_tool_feedback_recommended")), true);
  assert.equal(Boolean(autonomousLoopPreview.advisoryChecks.some((item) => item.code === "autonomous_loop_stop_condition_recommended")), true);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.plan.create",
      workflowId,
      planId: "plan-v2-hard-missing-spawn",
      objective: "Executable manager-worker plans must include a spawn node.",
      taskOwnerAgent: "cat_heart",
      participantManagers: ["cat_body"],
      ...v2PlanContract({
        workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
      }),
      nodes: [
        { nodeId: "node-hard-missing-spawn-review", nodeType: "manager_review", ownerAgent: "cat_body" }
      ]
    }),
    /manager_worker_spawn_node_required/
  );

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.plan.create",
      workflowId,
      planId: "plan-v2-hard-evaluator",
      objective: "Executable evaluator optimizer plans must separate producer and evaluator.",
      taskOwnerAgent: "cat_heart",
      participantManagers: ["cat_body"],
      ...v2PlanContract({
        orchestrationPattern: "evaluator_optimizer",
        workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
      }),
      nodes: [
        { nodeId: "node-hard-evaluator-producer", nodeType: "producer", ownerAgent: "cat_body", payload: { expectedArtifacts: ["artifact:producer"] } },
        { nodeId: "node-hard-evaluator-review", nodeType: "evaluator", ownerAgent: "cat_body", dependsOn: ["node-hard-evaluator-producer"] }
      ]
    }),
    /evaluator_optimizer_distinct_reviewer_required/
  );

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.plan.create",
      workflowId,
      planId: "plan-v2-hard-evaluator-contract",
      objective: "Executable evaluator optimizer plans must declare evaluator contract.",
      taskOwnerAgent: "cat_heart",
      participantManagers: ["cat_body", "cat_nose"],
      ...v2PlanContract({
        orchestrationPattern: "evaluator_optimizer",
        workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
      }),
      nodes: [
        { nodeId: "node-hard-evaluator-contract-producer", nodeType: "producer", ownerAgent: "cat_body", payload: { outputSchema: "producer-output.v1", expectedArtifacts: ["artifact:producer"] } },
        { nodeId: "node-hard-evaluator-contract-review", nodeType: "evaluator", ownerAgent: "cat_nose", dependsOn: ["node-hard-evaluator-contract-producer"], payload: {} }
      ]
    }),
    /evaluator_optimizer_evaluator_contract_required/
  );

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.plan.create",
      workflowId,
      planId: "plan-v2-hard-autonomous",
      objective: "Executable autonomous loops must be bounded before admission.",
      taskOwnerAgent: "cat_heart",
      participantManagers: ["cat_body"],
      ...v2PlanContract({
        orchestrationPattern: "autonomous_agent_loop",
        workerBudget: { maxWorkers: 1, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
      }),
      nodes: [
        { nodeId: "node-hard-autonomous-loop", nodeType: "autonomous_loop", ownerAgent: "cat_body", payload: {} }
      ]
    }),
    /autonomous_loop_iteration_cap_required/
  );

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.plan.create",
      workflowId,
      planId: "plan-v2-hard-mixed-state-a",
      status: "planned",
      workflowState: "draft",
      objective: "Mixed state with planned lifecycle still requires executable gates.",
      taskOwnerAgent: "cat_heart",
      participantManagers: ["cat_body"],
      ...v2PlanContract({
        orchestrationPattern: "autonomous_agent_loop",
        workerBudget: { maxWorkers: 1, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
      }),
      nodes: [
        { nodeId: "node-hard-mixed-a", nodeType: "autonomous_loop", ownerAgent: "cat_body", payload: {} }
      ]
    }),
    /autonomous_loop_iteration_cap_required/
  );

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.plan.create",
      workflowId,
      planId: "plan-v2-hard-mixed-state-b",
      status: "draft",
      workflowState: "planned",
      objective: "Mixed state with planned workflow state still requires executable gates.",
      taskOwnerAgent: "cat_heart",
      participantManagers: ["cat_body"],
      ...v2PlanContract({
        orchestrationPattern: "autonomous_agent_loop",
        workerBudget: { maxWorkers: 1, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
      }),
      nodes: [
        { nodeId: "node-hard-mixed-b", nodeType: "autonomous_loop", ownerAgent: "cat_body", payload: {} }
      ]
    }),
    /autonomous_loop_iteration_cap_required/
  );

  const draftLoopRoot = await tempRoot("workflow-v2-draft-hard-gate");
  const draftLoopPlan = await runAction(draftLoopRoot, {
    action: "workflow.v2.plan.create",
    workflowId: "wf-v2-draft-loop",
    planId: "plan-v2-draft-loop",
    status: "draft",
    workflowState: "draft",
    objective: "Draft autonomous loop can be persisted before executable gate is satisfied.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      orchestrationPattern: "autonomous_agent_loop",
      workerBudget: { maxWorkers: 1, concurrencyLimit: 1, maxWorkerContextTokens: 64000 }
    }),
    nodes: [
      { nodeId: "node-v2-draft-loop", nodeType: "autonomous_loop", ownerAgent: "cat_body", payload: {} }
    ]
  });
  assert.equal(draftLoopPlan.plan.status, "draft");
  assert.equal(draftLoopPlan.plan.workflowState, "draft");
  const draftLoopSpawnPreview = await runAction(draftLoopRoot, {
    action: "workflow.v2.worker_spawn.preview",
    workflowId: "wf-v2-draft-loop",
    planId: "plan-v2-draft-loop",
    nodeId: "node-v2-draft-loop",
    managerAgent: "cat_body",
    sessionId: "session-draft-loop-worker",
    workerRunId: "worker-v2-draft-loop",
    taskInputInfoId: "info-v2-draft-loop",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  assert.equal(draftLoopSpawnPreview.valid, false);
  assert.equal(Boolean(draftLoopSpawnPreview.errors.some((item) => item.code === "autonomous_loop_iteration_cap_required")), true);

  const fixture = await setupWorkflowV2KernelPlanFixture("workflow-v2-plan-canonical");
  const plan = fixture.plan;
  assert.equal(plan.plan.planId, "plan-v2-kernel");
  assert.equal(plan.plan.workflowState, "planned");
  assert.equal(plan.planSpecV2.artifacts.canonicalPlan.sourceOfTruth, true);
  assert.equal(await pathExists(path.join(fixture.root, plan.artifacts.canonicalJson)), true);
  const canonicalPlanSpecText = await fs.readFile(path.join(fixture.root, plan.artifacts.canonicalJson), "utf8");
  const canonicalPlanSpec = JSON.parse(canonicalPlanSpecText);
  assert.equal(canonicalPlanSpec.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(canonicalPlanSpec.orchestration.pattern, "manager_worker");
  assert.equal(Boolean(canonicalPlanSpec.nodes.find((node) => node.nodeType === "manager_worker_spawn")?.expectedArtifacts?.length), true);
  const storedPlanRow = sqliteJson(fixture.dbFile, "SELECT plan_revision AS planRevision, plan_spec_artifact_ref AS planSpecArtifactRef, plan_spec_artifact_hash AS planSpecArtifactHash, payload_json AS payloadJson FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(storedPlanRow.planSpecArtifactRef, plan.artifacts.canonicalJson);
  assert.equal(Boolean(storedPlanRow.planSpecArtifactHash), true);
  const storedPlanPayload = JSON.parse(storedPlanRow.payloadJson);
  assert.equal(storedPlanPayload.planSpecV2ArtifactRef, plan.artifacts.canonicalJson);
  assert.equal(Boolean(storedPlanPayload.planSpecV2Hash), true);

  const legacyPlanRoot = await tempRoot("workflow-v2-plan-legacy-schema-focused");
  const legacyPlanDbFile = path.join(legacyPlanRoot, "tracking.db");
  sqliteExec(legacyPlanDbFile, "CREATE TABLE workflow_v2_plans(plan_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL);");
  const legacyPlan = await runAction(legacyPlanRoot, {
    action: "workflow.v2.plan.create",
    workflowId: "wf-v2-legacy-plan",
    planId: "plan-v2-legacy-plan",
    objective: "Migrate legacy v2 plan table before writing canonical JSON plan.",
    taskOwnerAgent: "cat_heart",
    ...v2PlanContract()
  });
  assert.equal(await pathExists(path.join(legacyPlanRoot, legacyPlan.artifacts.canonicalJson)), true);
  const legacyPlanColumns = sqliteJson(legacyPlanDbFile, "PRAGMA table_info(workflow_v2_plans);").map((row) => row.name);
  assert.equal(Boolean(legacyPlanColumns.includes("plan_revision")), true);
  assert.equal(Boolean(legacyPlanColumns.includes("plan_spec_artifact_ref")), true);

  const advisoryPlanRoot = await tempRoot("workflow-v2-plan-advisory-focused");
  await runAction(advisoryPlanRoot, {
    action: "workflow.v2.plan.create",
    workflowId: "wf-v2-advisory-plan",
    planId: "plan-v2-advisory",
    objective: "Persist a lightweight plan before the orchestration pattern is fully known.",
    taskOwnerAgent: "cat_heart",
    acceptanceCriteria: ["owner can continue refining the plan"]
  });
  const advisoryPlanValidation = await runAction(advisoryPlanRoot, { action: "workflow.v2.validate" });
  assert.equal(advisoryPlanValidation.ok, true, JSON.stringify(advisoryPlanValidation.failedChecks));
  assert.equal(advisoryPlanValidation.failedChecks.includes("plans_anthropic_orchestration_contract"), false);
  assert.equal(Boolean(advisoryPlanValidation.advisoryChecks.some((item) => item.checkId === "plans_anthropic_orchestration_contract" && item.status === "advisory")), true);
}

async function testWorkflowTemplateSelfEvolution() {
  const root = await tempRoot("workflow-template-self-evolution");
  const dbFile = path.join(root, "tracking.db");
  const templateId = "template.workflow.v2.regression.engineering";

  const malformedPreview = await runAction(root, {
    action: "workflow.template.preview",
    templateSpec: {
      schemaVersion: "workflow_template_spec.v1",
      templateId: "template.workflow.v2.bad",
      version: 1,
      status: "candidate",
      ownerAgent: "main",
      variables: [{ name: "api_key", type: "string", required: true }],
      planSpecSkeleton: {}
    }
  });
  assert.equal(malformedPreview.valid, false);
  assert.equal(Boolean(malformedPreview.errors.some((item) => item.code === "title_required")), true);
  assert.equal(Boolean(malformedPreview.errors.some((item) => item.code === "sensitive_variable_disallowed")), true);
  assert.equal(await pathExists(dbFile), false);

  const validPreview = await runAction(root, {
    action: "workflow.template.preview",
    templateSpec: workflowTemplateSpec(),
    variables: {
      workflowId: "wf-template-preview",
      planId: "plan-template-preview",
      objective: "Preview a reusable template without writing workflow state."
    }
  });
  assert.equal(validPreview.valid, true);
  assert.equal(validPreview.planPreview.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(validPreview.planPreviewInput.workflowId, "wf-template-preview");
  assert.equal(await pathExists(dbFile), false);

  const candidate = await runAction(root, {
    action: "workflow.template.record_candidate",
    templateSpec: { ...workflowTemplateSpec(), status: "active" },
    sourceWorkflowId: "wf-template-source",
    sourcePlanId: "plan-template-source"
  });
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.templateId, templateId);
  assert.equal(candidate.version, 1);
  assert.equal(await pathExists(path.join(root, candidate.artifact.artifactRef)), true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_template_specs", `template_id='${templateId}'`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_template_versions", `template_id='${templateId}' AND version=1 AND status='candidate'`), 1);
  assert.equal(sqliteCount(dbFile, "artifact_index", `artifact_id='${candidate.artifact.artifactId}' AND kind='workflow_template_spec_json'`), 1);
  sqliteExec(dbFile, `UPDATE workflow_v2_template_versions SET artifact_ref='${root}-outside/v1.json' WHERE template_id='${templateId}' AND version=1;`);
  await assertRejectsMessage(
    () => runAction(root, { action: "workflow.template.get", templateId }),
    /template artifact_ref must be relative/
  );
  sqliteExec(dbFile, `UPDATE workflow_v2_template_versions SET artifact_ref='${candidate.artifact.artifactRef}' WHERE template_id='${templateId}' AND version=1;`);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.template.record_candidate",
      templateSpec: { ...workflowTemplateSpec(), description: "same version with a different hash" }
    }),
    /append-only/
  );

  const instantiated = await runAction(root, {
    action: "workflow.template.instantiate.record",
    templateId,
    version: 1,
    variables: {
      workflowId: "wf-template-instantiated",
      planId: "plan-template-instantiated",
      objective: "Instantiate through workflow.v2.plan.create and preserve hard gates."
    }
  });
  assert.equal(instantiated.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(instantiated.plan.planId, "plan-template-instantiated");
  assert.equal(sqliteCount(dbFile, "workflow_v2_plans", "plan_id='plan-template-instantiated'"), 1);
  assert.equal(JSON.stringify(instantiated.plan.payload).includes("template.workflow.v2.regression.engineering"), true);

  const badTemplateId = "template.workflow.v2.regression.bad-hardgate";
  await runAction(root, {
    action: "workflow.template.record_candidate",
    templateSpec: workflowTemplateSpec({
      templateId: badTemplateId,
      title: "Bad hard gate template",
      planSpecSkeleton: {
        workflowId: "{{workflowId}}",
        planId: "{{planId}}",
        objective: "{{objective}}",
        taskOwnerAgent: "cat_heart",
        participantManagers: ["cat_body"],
        ...v2PlanContract({ orchestrationPattern: "manager_worker" }),
        nodes: [
          { nodeId: "{{planId}}.spawn", nodeType: "manager_worker_spawn", ownerAgent: "cat_body", payload: {} },
          { nodeId: "{{planId}}.review", nodeType: "manager_review", ownerAgent: "cat_body", dependsOn: ["{{planId}}.spawn"] }
        ]
      }
    })
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.template.instantiate.record",
      templateId: badTemplateId,
      version: 1,
      variables: {
        workflowId: "wf-template-hardgate",
        planId: "plan-template-hardgate",
        objective: "This should fail existing v2 executable node hard gates."
      }
    }),
    /workflow v2 executable plan hard gate failed/
  );

  const invalidEvalPreview = await runAction(root, {
    action: "workflow.template.eval.preview",
    templateId,
    version: 1,
    fixtureSnapshot: { caseId: "duplicate-roots" },
    arms: [
      { kind: "baseline", isolatedRoot: "/tmp/same" },
      { kind: "previous_version", isolatedRoot: "/tmp/same" },
      { kind: "candidate_version", isolatedRoot: "/tmp/candidate" }
    ],
    metrics: {}
  });
  assert.equal(invalidEvalPreview.valid, false);
  assert.equal(Boolean(invalidEvalPreview.errors.some((item) => item.code === "isolated_roots_must_be_distinct")), true);

  const evalResult = await runAction(root, {
    action: "workflow.template.eval.record",
    templateId,
    version: 1,
    fixtureSnapshot: { caseId: "template-regression", immutable: true, token: "eval-secret" },
    arms: [
      { kind: "baseline", isolatedRoot: "/tmp/template-baseline" },
      { kind: "previous_version", isolatedRoot: "/tmp/template-previous" },
      { kind: "candidate_version", isolatedRoot: "/tmp/template-candidate" }
    ],
    metrics: {
      planGatePassRate: 1,
      executionSuccessRate: 1,
      receiptCompletenessRate: 1,
      evaluatorAcceptRate: 1,
      ownerRevisionRate: 0,
      humanGateReturnRate: 0,
      duplicateWorkRate: 0,
      toolFeedbackCompleteness: 1,
      sideEffectUncertainRate: 0,
      freshnessViolationRate: 0,
      rollbackReadinessRate: 1
    },
    evidenceRefs: ["artifact://template/eval"]
  });
  assert.equal(evalResult.scoreCannotPromote, true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_template_evals", `template_id='${templateId}' AND version=1`), 1);
  assert.equal(sqliteJson(dbFile, `SELECT active_version AS activeVersion FROM workflow_v2_template_specs WHERE template_id='${templateId}' LIMIT 1;`)[0].activeVersion, 0);
  assert.equal(await pathExists(path.join(root, evalResult.fixture.artifactRef)), true);
  assert.equal((await fs.readFile(path.join(root, evalResult.fixture.artifactRef), "utf8")).includes("eval-secret"), false);

  await runAction(root, {
    action: "workflow.template.promote.record",
    templateId,
    version: 1,
    targetStatus: "default",
    catBrainAuditId: "brain-template-v1",
    catClawAuditId: "claw-template-v1",
    evidenceRefs: ["artifact://template/eval"]
  });
  assert.equal(sqliteJson(dbFile, `SELECT default_version AS defaultVersion FROM workflow_v2_template_specs WHERE template_id='${templateId}' LIMIT 1;`)[0].defaultVersion, 1);

  await runAction(root, {
    action: "workflow.template.record_candidate",
    templateSpec: workflowTemplateSpec({ version: 2, riskTier: "P0", title: "High risk default candidate" })
  });
  await assert.rejects(
    runAction(root, {
      action: "workflow.template.promote.record",
      templateId,
      version: 2,
      targetStatus: "active",
      catBrainAuditId: "brain-template-v2-no-eval",
      catClawAuditId: "claw-template-v2-no-eval"
    }),
    /workflow template promotion blocked: eval_evidence/
  );
  await runAction(root, {
    action: "workflow.template.eval.record",
    templateId,
    version: 2,
    fixtureSnapshot: { caseId: "template-regression-v2", immutable: true },
    arms: [
      { kind: "baseline", isolatedRoot: "/tmp/template-baseline-v2" },
      { kind: "previous_version", isolatedRoot: "/tmp/template-previous-v2" },
      { kind: "candidate_version", isolatedRoot: "/tmp/template-candidate-v2" }
    ],
    metrics: {
      planGatePassRate: 1,
      executionSuccessRate: 1,
      receiptCompletenessRate: 1,
      evaluatorAcceptRate: 1,
      ownerRevisionRate: 0,
      humanGateReturnRate: 0,
      duplicateWorkRate: 0,
      toolFeedbackCompleteness: 1,
      sideEffectUncertainRate: 0,
      freshnessViolationRate: 0,
      rollbackReadinessRate: 1
    }
  });
  const highRiskPromotionPreview = await runAction(root, {
    action: "workflow.template.promote.preview",
    templateId,
    version: 2,
    targetStatus: "default",
    catBrainAuditId: "brain-template-v2",
    catClawAuditId: "claw-template-v2"
  });
  assert.equal(highRiskPromotionPreview.valid, false);
  assert.equal(Boolean(highRiskPromotionPreview.requirements.some((item) => item.type === "human_gate")), true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.template.promote.record",
      templateId,
      version: 2,
      targetStatus: "default",
      catBrainAuditId: "brain-template-v2",
      catClawAuditId: "claw-template-v2"
    }),
    /workflow template promotion blocked: human_gate/
  );
  const promotedV2 = await runAction(root, {
    action: "workflow.template.promote.record",
    templateId,
    version: 2,
    targetStatus: "default",
    catBrainAuditId: "brain-template-v2",
    catClawAuditId: "claw-template-v2",
    humanGateId: "hg-template-v2"
  });
  assert.equal(promotedV2.previousVersion, 1);
  assert.equal(sqliteJson(dbFile, `SELECT default_version AS defaultVersion FROM workflow_v2_template_specs WHERE template_id='${templateId}' LIMIT 1;`)[0].defaultVersion, 2);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.template.rollback.record",
      templateId,
      rollbackToVersion: 1
    }),
    /workflow template rollback blocked: rollback_reason,cat_brain_review,cat_claw_audit,human_gate/
  );
  const rollback = await runAction(root, {
    action: "workflow.template.rollback.record",
    templateId,
    rollbackToVersion: 1,
    rollbackReason: "restore previous approved template after high-risk candidate validation",
    catBrainAuditId: "brain-template-rollback",
    catClawAuditId: "claw-template-rollback",
    humanGateId: "hg-template-rollback"
  });
  assert.equal(rollback.rollbackVersion, 1);
  assert.equal(rollback.artifactsDeleted, false);
  assert.equal(sqliteJson(dbFile, `SELECT default_version AS defaultVersion FROM workflow_v2_template_specs WHERE template_id='${templateId}' LIMIT 1;`)[0].defaultVersion, 1);
  assert.equal(await pathExists(path.join(root, "artifacts/workflow-v2/templates/template.workflow.v2.regression.engineering/v2.json")), true);

  const sourcePlan = await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId: "wf-template-extract-source",
    planId: "plan-template-extract-source",
    objective: "Source workflow for extraction.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract()
  });
  sqliteExec(dbFile, `
INSERT INTO workflow_v2_owner_reviews(review_id, workflow_id, plan_id, owner_agent, decision, summary, manager_review_refs_json, artifact_refs_json, receipt_refs_json, findings_json, payload_json, created_by, created_at, updated_at)
VALUES ('owner-review-template-extract', 'wf-template-extract-source', 'plan-template-extract-source', 'cat_heart', 'accepted', 'owner accepted extraction source', '[]', '[]', '[]', '[]', '{}', 'main', '2026-07-05T00:00:00.000Z', '2026-07-05T00:00:00.000Z');
INSERT INTO side_effect_ledger(side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, input_hash, output_hash, artifact_ref, payload_json, created_at, updated_at)
VALUES ('side-effect-template-uncertain', '', 'wf-template-extract-source', '', 'side-effect-template-uncertain', 'main', 'file_write', 'uncertain', '', '', '', '{}', '2026-07-05T00:00:00.000Z', '2026-07-05T00:00:00.000Z');
`);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.template.extract.preview",
      workflowId: "wf-template-extract-source",
      templateId: "template.workflow.v2.extracted.regression"
    }),
    /unresolved side-effect uncertainty/
  );
  sqliteExec(dbFile, "UPDATE side_effect_ledger SET status='resolved' WHERE side_effect_id='side-effect-template-uncertain';");
  const extracted = await runAction(root, {
    action: "workflow.template.extract.record",
    workflowId: "wf-template-extract-source",
    templateId: "template.workflow.v2.extracted.regression",
    title: "Extracted regression template"
  });
  assert.equal(extracted.extractedStatus, "candidate");
  assert.equal(sqliteCount(dbFile, "workflow_v2_template_versions", "template_id='template.workflow.v2.extracted.regression' AND status='candidate'"), 1);
  assert.equal(sourcePlan.plan.planId, "plan-template-extract-source");

  const readModel = new WorkflowReadModel({ dbFile });
  const templateList = await readModel.templateList({ q: "regression" });
  assert.equal(templateList.schemaVersion, "workflow_template_console_list.v1");
  assert.equal(templateList.templates.some((item) => item.templateId === templateId && item.defaultVersion === 1), true);
  const templateDetail = await readModel.templateDetail(templateId);
  assert.equal(templateDetail.schemaVersion, "workflow_template_console_detail.v1");
  assert.equal(templateDetail.versions.length >= 2, true);
  assert.equal(templateDetail.evals.length >= 2, true);
  assert.equal(JSON.stringify(templateDetail).includes("template-secret"), false);
  assert.equal(JSON.stringify(templateDetail).includes("eval-secret"), false);
  const templateStats = await readModel.templateStats({ templateId });
  assert.equal(templateStats.schemaVersion, "workflow_template_console_stats.v1");
  assert.equal(templateStats.stats[0].rollbackTargetVersion >= 1, true);

  const mcpRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "workflow_template_get",
      arguments: { source: "local", template_id: templateId }
    }
  };
  const mcpOutput = execFileSync("python3", [path.resolve("scripts/trading_agents_workflow_mcp.py")], {
    cwd: process.cwd(),
    input: `${JSON.stringify(mcpRequest)}\n`,
    encoding: "utf8",
    env: { ...process.env, TRADING_AGENTS_WORKFLOW_ROOT: root }
  }).trim();
  const mcpResponse = JSON.parse(mcpOutput.split("\n").at(-1));
  assert.equal(mcpResponse.result.structuredContent.found, true);
  assert.equal(JSON.stringify(mcpResponse).includes("template-secret"), false);
  assert.equal(JSON.stringify(mcpResponse).includes("eval-secret"), false);
}

async function testWorkflowV2InfoStackAndSessionBinding() {
  const fixture = await setupWorkflowV2KernelExecutionFixture("workflow-v2-info-focused");
  const { root, dbFile, workflowId, info } = fixture;
  assert.equal(info.infoItem.infoId, "info-v2-task-input");
  assert.equal(info.notification.payloadMode, "pointer_only");
  assert.equal(Boolean(info.notification.payload.readAction), true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", "info_id='info-v2-task-input'"), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_notifications", "info_id='info-v2-task-input'"), 1);
  const readInfo = await runAction(root, {
    action: "workflow.v2.info_stack.read",
    inboxItemId: info.inboxItem.inboxItemId,
    principalKind: "agent",
    principalId: "cat_body"
  });
  assert.equal(readInfo.item.infoId, "info-v2-task-input");
  assert.equal(readInfo.item.contentStorage, "artifact_ref");
  assert.equal(readInfo.receiptRecordAction, "workflow.v2.read_receipt.record");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.info_stack.read",
      infoId: "info-v2-task-input",
      principalKind: "agent",
      principalId: "cat_body"
    }),
    /requires inboxItemId or grantId/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.read_receipt.record",
      workflowId,
      infoId: readInfo.item.infoId,
      readerKind: "agent",
      readerId: "cat_body"
    }),
    /requires inboxItemId or grantId/
  );
  await runAction(root, {
    action: "workflow.v2.read_receipt.record",
    workflowId,
    infoId: readInfo.item.infoId,
    inboxItemId: readInfo.access.inboxItemId,
    grantId: readInfo.access.grantId,
    readerKind: "agent",
    readerId: "cat_body"
  });
  assert.equal(sqliteCount(dbFile, "workflow_v2_read_receipts", "info_id='info-v2-task-input'"), 1);

  const sensitiveInline = await runAction(root, {
    action: "workflow.v2.info_stack.preview",
    workflowId,
    classification: "sensitive",
    contentStorage: "inline",
    bodyText: "do not store this inline",
    recipientAgent: "cat_body"
  });
  assert.equal(sensitiveInline.valid, false);
  assert.equal(Boolean(sensitiveInline.errors.some((item) => item.code === "sensitive_inline_body_disallowed")), true);
  const implicitInline = await runAction(root, {
    action: "workflow.v2.info_stack.preview",
    workflowId,
    classification: "internal",
    bodyText: "non-sensitive body still needs an artifact pointer"
  });
  assert.equal(implicitInline.valid, false);
  assert.equal(Boolean(implicitInline.errors.some((item) => item.code === "content_ref_required")), true);
  const pointerNotification = await runAction(root, {
    action: "workflow.v2.notification.preview",
    workflowId,
    infoId: "info-v2-task-input",
    payloadMode: "pointer_only",
    notificationBody: "full body must not be embedded"
  });
  assert.equal(pointerNotification.valid, false);
  assert.equal(Boolean(pointerNotification.errors.some((item) => item.code === "pointer_notification_body_disallowed")), true);
}

async function testWorkflowV2WorkerSpawnAndLifecycleGates() {
  const fixture = await setupWorkflowV2KernelExecutionFixture("workflow-v2-worker-focused");
  const { root, dbFile, workflowId, plan } = fixture;
  const openclawWorker = await runAction(root, {
    action: "workflow.v2.worker_backend.preflight",
    workflowId,
    backendId: "openclaw"
  });
  assert.equal(openclawWorker.valid, false);
  assert.equal(Boolean(openclawWorker.errors.some((item) => item.code === "openclaw_worker_backend_disallowed")), true);
  const emptyEvidence = await runAction(root, {
    action: "workflow.v2.worker_backend.preflight",
    workflowId,
    backendId: "hermers_docker_worker",
    receipt: {},
    oauth: {},
    network: {}
  });
  assert.equal(emptyEvidence.valid, false);
  assert.equal(Boolean(emptyEvidence.errors.some((item) => item.code === "model_receipt_missing_required_fields")), true);
  assert.equal(Boolean(emptyEvidence.errors.some((item) => item.code === "oauth_status_required")), true);
  assert.equal(Boolean(emptyEvidence.errors.some((item) => item.code === "network_policy_required")), true);

  await assertRejectsMessage(
    () => runAction(root, workflowV2KernelWorkerInput(fixture, {
      workerRunId: "worker-v2-missing-session",
      sessionId: "missing-session-pack",
      preflightId: "preflight-v2-missing-session"
    })),
    /workflow session pack not found/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "worker_run_id='worker-v2-missing-session'"), 0);
  await assertRejectsMessage(
    () => runAction(root, workflowV2KernelWorkerInput(fixture, {
      workerRunId: "worker-v2-invalid-start-status",
      status: "running"
    })),
    /worker_spawn_status_must_be_queued/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_spawn.create",
      workflowId,
      planId: "plan-v2-kernel",
      nodeId: v2KernelManagerWorkerNode(plan).nodeId,
      managerAgent: "cat_body",
      sessionId: "session-cat-body-worker",
      workerRunId: "worker-v2-missing-delegation",
      taskInputInfoId: "info-v2-task-input",
      runtimeBackend: "local_deterministic",
      providerModel: "openai-codex/gpt-5.5",
      receipt: v2KernelReceipt(),
      oauth: v2KernelOAuth(),
      network: v2KernelNetwork()
    }),
    /worker_objective_required/
  );
  await assertRejectsMessage(
    () => runAction(root, workflowV2KernelWorkerInput(fixture, {
      workerRunId: "worker-v2-missing-context-budget",
      contextBudgetTokens: undefined
    })),
    /worker_context_budget_required/
  );
  await assertRejectsMessage(
    () => runAction(root, workflowV2KernelWorkerInput(fixture, {
      workerRunId: "worker-v2-too-large-context",
      contextBudgetTokens: 64001
    })),
    /worker_context_budget_too_high/
  );

  const worker = await runAction(root, workflowV2KernelWorkerInput(fixture, {
    workerRunId: "worker-v2-local-lifecycle",
    contextBudgetTokens: 1000,
    contextUsedTokens: 920,
    compactionCount: 2,
    sourceContextRefs: ["info-v2-task-input"],
    payload: { outputSummary: "Deterministic worker output prepared for manager review." }
  }));
  assert.equal(worker.valid, true);
  assert.equal(worker.sessionRun.status, "queued");
  assert.equal(worker.workerRun.contextBudgetTokens, 1000);
  assert.equal(worker.workerRun.contextUsedTokens, 920);
  assert.equal(worker.workerRun.compactionCount, 2);
  const lifecycleHighPressure = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: worker.workerRun.workerRunId,
    contextPressureThreshold: 0.8,
    maxCompactions: 2
  });
  assert.equal(lifecycleHighPressure.valid, true);
  assert.equal(lifecycleHighPressure.telemetry.contextPressureThreshold, 0.81);
  assert.equal(lifecycleHighPressure.telemetry.maxCompactions, 1);
  assert.equal(lifecycleHighPressure.recommendation.action, "handoff_required");
  assert.equal(Boolean(lifecycleHighPressure.signals.some((signal) => signal.code === "context_pressure_high")), true);
  assert.equal(Boolean(lifecycleHighPressure.signals.some((signal) => signal.code === "compaction_limit_reached")), true);
  const queuePreview = await runAction(root, {
    action: "workflow.v2.control_loop.preview",
    workflowId
  });
  assert.equal(queuePreview.status, "ok");
  assert.equal(Number(queuePreview.counts.due), 1);
  const queueTick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-focused-control-loop",
    workerLeaseMs: 60_000
  });
  assert.equal(queueTick.status, "ok");
  assert.equal(queueTick.workerResults[0].status, "submitted_for_review");
  assert.equal(await pathExists(queueTick.workerResults[0].artifactFile), true);

  const defaultPressureWorker = await runAction(root, workflowV2KernelWorkerInput(fixture, {
    workerRunId: "worker-v2-default-context-threshold",
    contextBudgetTokens: 1000,
    contextUsedTokens: 810,
    compactionCount: 0,
    sourceContextRefs: ["info-v2-task-input"]
  }));
  const defaultPressureLifecycle = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: defaultPressureWorker.workerRun.workerRunId
  });
  assert.equal(defaultPressureLifecycle.telemetry.contextPressureThreshold, 0.81);
  assert.equal(defaultPressureLifecycle.recommendation.action, "handoff_required");
  assert.equal(Boolean(defaultPressureLifecycle.signals.some((signal) => signal.code === "context_pressure_high")), true);

  const defaultCompactionWorker = await runAction(root, workflowV2KernelWorkerInput(fixture, {
    workerRunId: "worker-v2-default-compact-threshold",
    contextBudgetTokens: 1000,
    contextUsedTokens: 100,
    compactionCount: 1,
    sourceContextRefs: ["info-v2-task-input"]
  }));
  const defaultCompactionLifecycle = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: defaultCompactionWorker.workerRun.workerRunId
  });
  assert.equal(defaultCompactionLifecycle.telemetry.maxCompactions, 1);
  assert.equal(defaultCompactionLifecycle.recommendation.action, "handoff_required");
  assert.equal(Boolean(defaultCompactionLifecycle.signals.some((signal) => signal.code === "compaction_limit_reached")), true);
}

async function testWorkflowV2AutonomousLoopRuntimeEnforcement() {
  const root = await tempRoot("workflow-v2-autonomous-loop-runtime");
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-autonomous-loop-runtime";
  await runAction(root, {
    action: "runtime.agent.upsert",
    agentId: "cat_body",
    runtime: "hermers",
    platform: "hermers",
    capabilities: { permissions: ["workflow.verify", "workflow.worker.lifecycle"] }
  });
  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-v2-autonomous-worker",
    ownerAgent: "cat_body",
    runtimeTarget: "hermers",
    taskType: "autonomous_loop_worker",
    purpose: "Autonomous loop runtime cap regression worker.",
    systemBrief: "Use workflow input references and return bounded tool/environment feedback evidence."
  });
  const createLoopPlan = async ({ planId, nodeId, maxIterations }) => runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId,
    objective: `Bounded autonomous loop ${planId}.`,
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body"],
    ...v2PlanContract({
      orchestrationPattern: "autonomous_agent_loop",
      orchestrationRationale: "Autonomous loop regression plan must be bounded by runtime gates.",
      workerBudget: { maxWorkers: 1, concurrencyLimit: 1, maxWorkerContextTokens: 64000 },
      acceptanceCriteria: ["iteration cap is enforced", "tool feedback is recorded before repeated iterations"]
    }),
    nodes: [
      {
        nodeId,
        nodeType: "autonomous_loop",
        ownerAgent: "cat_body",
        runtimeBackend: "local_deterministic",
        payload: {
          maxIterations,
          toolFeedbackCheckpoints: ["tool_observation_or_environment_feedback"],
          stopCondition: "Stop when the loop has explicit stopConditionSatisfied evidence."
        }
      }
    ]
  });
  const recordLoopInput = async ({ planId, nodeId, infoId }) => runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId,
    nodeId,
    infoId,
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: `artifact://workflow-v2/${workflowId}/${infoId}.json`,
    recipientAgent: "cat_body",
    summary: `Autonomous loop input ${infoId}.`
  });
  const spawnLoopWorker = async ({ planId, nodeId, workerRunId, taskInputInfoId, payload = {}, feedbackInfoIds = [] }) => runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId,
    nodeId,
    managerAgent: "cat_body",
    sessionId: "session-v2-autonomous-worker",
    workerRunId,
    taskInputInfoId,
    runtimeBackend: "local_deterministic",
    maxAttempts: 1,
    ...v2WorkerDelegation({
      workerObjective: "Run one bounded autonomous loop iteration and write a receipt-backed output.",
      outputFormat: "structured autonomous loop iteration output",
      toolBoundary: "Only consume referenced workflow info items and produce explicit feedback/output artifacts.",
      acceptanceCriteria: ["iteration output exists", "receipt evidence exists"],
      stopCondition: "Stop after this iteration or when stopConditionSatisfied is true.",
      contextBudgetTokens: 1000
    }),
    feedbackInfoIds,
    providerModel: "openai-codex/gpt-5.5",
    receipt: v2KernelReceipt(),
    oauth: v2KernelOAuth(),
    network: v2KernelNetwork(),
    payload
  });

  await createLoopPlan({ planId: "plan-v2-loop-cap", nodeId: "node-v2-loop-cap", maxIterations: 3 });
  await recordLoopInput({ planId: "plan-v2-loop-cap", nodeId: "node-v2-loop-cap", infoId: "info-v2-loop-cap-input" });
  const first = await spawnLoopWorker({
    planId: "plan-v2-loop-cap",
    nodeId: "node-v2-loop-cap",
    workerRunId: "worker-v2-loop-cap-1",
    taskInputInfoId: "info-v2-loop-cap-input"
  });
  assert.equal(first.valid, true);
  assert.equal(first.workerRun.payload.autonomousLoop.iterationCount, 0);
  assert.equal(first.workerRun.payload.autonomousLoop.nextIteration, 1);
  assert.equal(first.workerRun.payload.autonomousLoop.maxIterations, 3);
  const firstTick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-autonomous-loop-cap-1",
    workerLeaseMs: 60_000
  });
  assert.equal(firstTick.workerResults.find((item) => item.workerRunId === "worker-v2-loop-cap-1")?.status, "submitted_for_review");
  await assertRejectsMessage(
    () => spawnLoopWorker({
      planId: "plan-v2-loop-cap",
      nodeId: "node-v2-loop-cap",
      workerRunId: "worker-v2-loop-cap-2-missing-feedback",
      taskInputInfoId: "info-v2-loop-cap-input"
    }),
    /autonomous_loop_feedback_required/
  );
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-loop-cap",
    nodeId: "node-v2-loop-cap",
    infoId: "info-v2-loop-cap-feedback-1",
    workerRunId: "worker-v2-loop-cap-1",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: `artifact://workflow-v2/${workflowId}/loop-cap-feedback-1.json`,
    recipientAgent: "cat_body",
    summary: "Tool/environment feedback for autonomous loop iteration 1.",
    payload: {
      autonomousLoopFeedback: true,
      feedbackKind: "tool_observation_or_environment_feedback",
      checkpoint: "tool_observation_or_environment_feedback",
      iteration: 1,
      sourceWorkerRunId: "worker-v2-loop-cap-1"
    }
  });
  const second = await spawnLoopWorker({
    planId: "plan-v2-loop-cap",
    nodeId: "node-v2-loop-cap",
    workerRunId: "worker-v2-loop-cap-2",
    taskInputInfoId: "info-v2-loop-cap-input",
    feedbackInfoIds: ["info-v2-loop-cap-feedback-1"]
  });
  assert.equal(second.workerRun.payload.autonomousLoop.iterationCount, 1);
  assert.equal(second.workerRun.payload.autonomousLoop.nextIteration, 2);
  assert.equal(second.workerRun.payload.autonomousLoop.feedbackEvidence[0].infoId, "info-v2-loop-cap-feedback-1");
  await assertRejectsMessage(
    () => spawnLoopWorker({
      planId: "plan-v2-loop-cap",
      nodeId: "node-v2-loop-cap",
      workerRunId: "worker-v2-loop-cap-3-before-second-completes",
      taskInputInfoId: "info-v2-loop-cap-input",
      feedbackInfoIds: ["info-v2-loop-cap-feedback-1"]
    }),
    /autonomous_loop_previous_iteration_open/
  );
  const secondTick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-autonomous-loop-cap-2",
    workerLeaseMs: 60_000
  });
  assert.equal(secondTick.workerResults.find((item) => item.workerRunId === "worker-v2-loop-cap-2")?.status, "submitted_for_review");
  await assertRejectsMessage(
    () => spawnLoopWorker({
      planId: "plan-v2-loop-cap",
      nodeId: "node-v2-loop-cap",
      workerRunId: "worker-v2-loop-cap-3-stale-feedback",
      taskInputInfoId: "info-v2-loop-cap-input",
      feedbackInfoIds: ["info-v2-loop-cap-feedback-1"]
    }),
    /autonomous_loop_feedback_required/
  );
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-loop-cap",
    nodeId: "node-v2-loop-cap",
    infoId: "info-v2-loop-cap-feedback-2",
    workerRunId: "worker-v2-loop-cap-2",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: `artifact://workflow-v2/${workflowId}/loop-cap-feedback-2.json`,
    recipientAgent: "cat_body",
    summary: "Tool/environment feedback for autonomous loop iteration 2.",
    payload: {
      autonomousLoopFeedback: true,
      feedbackKind: "tool_observation_or_environment_feedback",
      checkpoint: "tool_observation_or_environment_feedback",
      iteration: 2,
      sourceWorkerRunId: "worker-v2-loop-cap-2"
    }
  });
  const third = await spawnLoopWorker({
    planId: "plan-v2-loop-cap",
    nodeId: "node-v2-loop-cap",
    workerRunId: "worker-v2-loop-cap-3",
    taskInputInfoId: "info-v2-loop-cap-input",
    feedbackInfoIds: ["info-v2-loop-cap-feedback-2"]
  });
  assert.equal(third.workerRun.payload.autonomousLoop.iterationCount, 2);
  assert.equal(third.workerRun.payload.autonomousLoop.nextIteration, 3);
  assert.equal(third.workerRun.payload.autonomousLoop.feedbackEvidence[0].infoId, "info-v2-loop-cap-feedback-2");
  await assertRejectsMessage(
    () => spawnLoopWorker({
      planId: "plan-v2-loop-cap",
      nodeId: "node-v2-loop-cap",
      workerRunId: "worker-v2-loop-cap-4",
      taskInputInfoId: "info-v2-loop-cap-input",
      feedbackInfoIds: ["info-v2-loop-cap-feedback-2"]
    }),
    /autonomous_loop_iteration_cap_reached/
  );

  await createLoopPlan({ planId: "plan-v2-loop-stop", nodeId: "node-v2-loop-stop", maxIterations: 3 });
  await recordLoopInput({ planId: "plan-v2-loop-stop", nodeId: "node-v2-loop-stop", infoId: "info-v2-loop-stop-input" });
  await spawnLoopWorker({
    planId: "plan-v2-loop-stop",
    nodeId: "node-v2-loop-stop",
    workerRunId: "worker-v2-loop-stop-1",
    taskInputInfoId: "info-v2-loop-stop-input",
    payload: {
      autonomousLoop: {
        stopConditionSatisfied: true
      },
      outputSummary: "Deterministic worker reached the autonomous loop stop condition."
    }
  });
  const stopTick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-autonomous-loop-stop",
    workerLeaseMs: 60_000
  });
  const stopResult = stopTick.workerResults.find((item) => item.workerRunId === "worker-v2-loop-stop-1");
  assert.equal(stopResult?.status, "submitted_for_review");
  assert.equal(stopResult?.autonomousLoop?.terminalized, true);
  const stopNode = sqliteJson(dbFile, "SELECT status, output_info_id AS outputInfoId, payload_json AS payloadJson FROM workflow_v2_plan_nodes WHERE node_id='node-v2-loop-stop' LIMIT 1;")[0];
  assert.equal(stopNode.status, "completed");
  assert.equal(stopNode.outputInfoId, "worker-v2-loop-stop-1.output");
  assert.equal(JSON.parse(stopNode.payloadJson).autonomousLoopRuntime.stopConditionSatisfied, true);
  await assertRejectsMessage(
    () => spawnLoopWorker({
      planId: "plan-v2-loop-stop",
      nodeId: "node-v2-loop-stop",
      workerRunId: "worker-v2-loop-stop-2",
      taskInputInfoId: "info-v2-loop-stop-input"
    }),
    /autonomous_loop_terminal/
  );
  const validate = await runAction(root, { action: "workflow.v2.validate" });
  assert.equal(validate.checks.find((item) => item.checkId === "autonomous_loop_iteration_caps")?.status, "pass");
}

async function testWorkflowV2EvaluatorOptimizerContractFocused() {
  const root = await tempRoot("workflow-v2-evaluator-contract");
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-evaluator-contract";
  for (const agent of [
    { agentId: "cat_heart", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] },
    { agentId: "cat_body", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] },
    { agentId: "cat_nose", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] }
  ]) {
    await runAction(root, {
      action: "runtime.agent.upsert",
      agentId: agent.agentId,
      runtime: agent.runtime,
      platform: agent.platform,
      capabilities: { permissions: agent.permissions }
    });
  }
  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-v2-evaluator-producer",
    ownerAgent: "cat_body",
    runtimeTarget: "hermers",
    taskType: "evaluator_optimizer_producer",
    purpose: "Producer worker for evaluator optimizer contract regression.",
    systemBrief: "Produce a structured artifact; evaluator receipt is recorded through manager review."
  });
  await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId: "plan-v2-evaluator-contract",
    objective: "Evaluate optimizer output through a distinct evaluator receipt.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose"],
    ...v2PlanContract({
      orchestrationPattern: "evaluator_optimizer",
      orchestrationRationale: "Producer output must be reviewed by a distinct evaluator contract before owner acceptance.",
      workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 },
      acceptanceCriteria: ["producer output exists", "accepted evaluator receipt gates owner acceptance"]
    }),
    nodes: [
      {
        nodeId: "node-v2-evaluator-producer",
        nodeType: "producer",
        ownerAgent: "cat_body",
        runtimeBackend: "local_deterministic",
        payload: {
          outputSchema: "workflow_v2_evaluator_producer_output.v1",
          expectedArtifacts: ["artifact://workflow-v2/evaluator-producer-output.json"]
        }
      },
      {
        nodeId: "node-v2-evaluator-review",
        nodeType: "evaluator",
        ownerAgent: "cat_nose",
        dependsOn: ["node-v2-evaluator-producer"],
        payload: {
          producerNodeId: "node-v2-evaluator-producer",
          evaluatorInput: "producer output info item",
          rubric: "Check producer output against acceptance criteria and evidence completeness.",
          reviewArtifact: "artifact://workflow-v2/evaluator-review.json",
          decisionStates: ["accepted", "rejected", "needs_revision"]
        }
      }
    ]
  });
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-evaluator-contract",
    nodeId: "node-v2-evaluator-producer",
    infoId: "info-v2-evaluator-input",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/evaluator-input.json",
    recipientAgent: "cat_body",
    summary: "Evaluator optimizer producer input pointer."
  });
  const producer = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-evaluator-contract",
    nodeId: "node-v2-evaluator-producer",
    managerAgent: "cat_nose",
    sessionId: "session-v2-evaluator-producer",
    workerRunId: "worker-v2-evaluator-producer",
    taskInputInfoId: "info-v2-evaluator-input",
    runtimeBackend: "local_deterministic",
    maxAttempts: 1,
    ...v2WorkerDelegation({
      workerObjective: "Produce the optimizer candidate artifact for evaluator review.",
      outputFormat: "producer output artifact pointer",
      toolBoundary: "Only use referenced workflow info and return output through workflow result.",
      acceptanceCriteria: ["producer output info item exists", "runtime receipt exists"],
      stopCondition: "Stop after producer output is submitted.",
      contextBudgetTokens: 1000
    }),
    providerModel: "openai-codex/gpt-5.5",
    receipt: v2KernelReceipt(),
    oauth: v2KernelOAuth(),
    network: v2KernelNetwork(),
    payload: { outputSummary: "Producer output ready for evaluator review." }
  });
  assert.equal(producer.valid, true);
  const tick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-evaluator-contract",
    workerLeaseMs: 60_000
  });
  assert.equal(tick.workerResults.find((item) => item.workerRunId === "worker-v2-evaluator-producer")?.status, "submitted_for_review");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-evaluator-contract",
      workerRunId: "worker-v2-evaluator-producer",
      reviewerAgent: "cat_nose",
      decision: "accepted",
      summary: "Evaluator review without evaluator input/rubric must fail.",
      artifactRefs: ["artifact://workflow-v2/evaluator-review-missing-contract.json"],
      receiptRefs: ["receipt://workflow-v2/evaluator-review-missing-contract"]
    }),
    /evaluator_input_required/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-evaluator-contract",
      workerRunId: "worker-v2-evaluator-producer",
      reviewerAgent: "cat_nose",
      decision: "accepted",
      summary: "Evaluator receipt must bind to the reviewed producer worker.",
      artifactRefs: ["artifact://workflow-v2/evaluator-review-wrong-worker.json"],
      receiptRefs: ["receipt://workflow-v2/evaluator-review-wrong-worker"],
      payload: {
        evaluatorReceipt: {
          schemaVersion: "workflow_v2_evaluator_receipt.v1",
          producerNodeId: "node-v2-evaluator-producer",
          producerWorkerRunId: "worker-v2-evaluator-other",
          producerOutputInfoId: "worker-v2-evaluator-producer.output",
          evaluatorInputInfoId: "worker-v2-evaluator-producer.output",
          rubric: "Check producer output against acceptance criteria and evidence completeness.",
          reviewArtifactRef: "artifact://workflow-v2/evaluator-review-wrong-worker.json",
          reviewReceiptRef: "receipt://workflow-v2/evaluator-review-wrong-worker",
          decisionState: "accepted",
          decisionStates: ["accepted", "rejected", "needs_revision"]
        }
      }
    }),
    /evaluator_producer_worker_mismatch/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.owner_review.record",
      workflowId,
      planId: "plan-v2-evaluator-contract",
      callerAgent: "cat_heart",
      allowNoManagerReviews: true,
      artifactRefs: ["artifact://workflow-v2/direct-owner-bypass.json"],
      receiptRefs: ["receipt://workflow-v2/direct-owner-bypass"],
      decision: "accepted",
      summary: "Evaluator optimizer must not allow owner-direct accepted bypass."
    }),
    /evaluator_review_required/
  );
  const review = await runAction(root, {
    action: "workflow.v2.manager_review.record",
    workflowId,
    planId: "plan-v2-evaluator-contract",
    reviewId: "review-v2-evaluator-accepted",
    workerRunId: "worker-v2-evaluator-producer",
    reviewerAgent: "cat_nose",
    decision: "accepted",
    summary: "Evaluator accepted producer output through structured rubric.",
    artifactRefs: ["artifact://workflow-v2/evaluator-review.json"],
    receiptRefs: ["receipt://workflow-v2/evaluator-review"],
    payload: {
      evaluatorReceipt: {
        schemaVersion: "workflow_v2_evaluator_receipt.v1",
        producerNodeId: "node-v2-evaluator-producer",
        producerWorkerRunId: "worker-v2-evaluator-producer",
        producerOutputInfoId: "worker-v2-evaluator-producer.output",
        evaluatorInputInfoId: "worker-v2-evaluator-producer.output",
        rubric: "Check producer output against acceptance criteria and evidence completeness.",
        reviewArtifactRef: "artifact://workflow-v2/evaluator-review.json",
        reviewReceiptRef: "receipt://workflow-v2/evaluator-review",
        decisionState: "accepted",
        decisionStates: ["accepted", "rejected", "needs_revision"]
      }
    }
  });
  assert.equal(review.review.payload.evaluatorReceipt.schemaVersion, "workflow_v2_evaluator_receipt.v1");
  sqliteExec(dbFile, `
INSERT INTO workflow_v2_manager_reviews(review_id, workflow_id, plan_id, node_id, worker_run_id, reviewer_agent, decision, summary, findings_json, artifact_refs_json, receipt_refs_json, blocker_json, payload_json, created_at)
VALUES ('review-v2-evaluator-loose', '${workflowId}', 'plan-v2-evaluator-contract', 'node-v2-evaluator-producer', 'worker-v2-evaluator-producer', 'cat_nose', 'accepted', 'Loose accepted review must not feed owner acceptance.', '[]', '["artifact://workflow-v2/loose-review.json"]', '["receipt://workflow-v2/loose-review"]', '{}', '{}', '2026-07-05T00:00:00.000Z');`);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.owner_review.record",
      workflowId,
      planId: "plan-v2-evaluator-contract",
      callerAgent: "cat_heart",
      managerReviewIds: ["review-v2-evaluator-loose"],
      decision: "accepted",
      summary: "Owner acceptance must not consume a loose review."
    }),
    /evaluator_review_receipt_required/
  );
  sqliteExec(dbFile, "DELETE FROM workflow_v2_manager_reviews WHERE review_id='review-v2-evaluator-loose';");
  const ownerReview = await runAction(root, {
    action: "workflow.v2.owner_review.record",
    workflowId,
    planId: "plan-v2-evaluator-contract",
    callerAgent: "cat_heart",
    managerReviewIds: [review.review.reviewId],
    decision: "accepted",
    summary: "Owner accepted producer output through accepted evaluator receipt."
  });
  assert.equal(ownerReview.ownerReview.decision, "accepted");
  const validate = await runAction(root, { action: "workflow.v2.validate" });
  assert.equal(validate.ok, true, JSON.stringify(validate.failedChecks));
}

async function testWorkflowV2ReviewChainFocused() {
  const fixture = await setupWorkflowV2SubmittedWorkerFixture("workflow-v2-review-focused");
  const { root, dbFile, workflowId, worker } = fixture;
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      workerRunId: worker.workerRun.workerRunId,
      reviewerAgent: "cat_heart",
      decision: "accepted",
      summary: "Task owner must not accept a manager-owned worker through manager review."
    }),
    /reviewer_agent_not_worker_manager/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      reviewerAgent: "cat_body",
      decision: "accepted",
      summary: "Manager review must be bound to a concrete worker run."
    }),
    /requires workerRunId/
  );
  const review = await runAction(root, {
    action: "workflow.v2.manager_review.record",
    workflowId,
    planId: "plan-v2-kernel",
    workerRunId: worker.workerRun.workerRunId,
    reviewerAgent: "cat_body",
    decision: "accepted",
    summary: "Worker output accepted by manager."
  });
  assert.equal(review.review.decision, "accepted");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.owner_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      callerAgent: "cat_nose",
      managerReviewIds: [review.review.reviewId],
      decision: "accepted",
      summary: "Unauthorized owner review."
    }),
    /caller_agent_not_authorized/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.owner_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      callerAgent: "cat_heart",
      managerReviewIds: [review.review.reviewId],
      decision: "blocked",
      summary: "Owner review must not use blocked as a review decision."
    }),
    /blocked_decision_not_allowed/
  );
  const ownerReview = await runAction(root, {
    action: "workflow.v2.owner_review.record",
    workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_heart",
    managerReviewIds: [review.review.reviewId],
    decision: "accepted",
    taskGroupRequired: true,
    summary: "Task owner accepted manager artifact and requires compact task group review.",
    artifactRefs: ["artifact://workflow-v2/owner-package.json"],
    receiptRefs: ["receipt://workflow-v2/manager-review"]
  });
  assert.equal(ownerReview.ownerReview.nextWorkflowState, "waiting_group_discussion");
  let planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_group_discussion");
  const taskGroupPackage = await runAction(root, {
    action: "workflow.v2.task_group_package.record",
    workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_heart",
    ownerReviewId: ownerReview.ownerReview.reviewId,
    taskGroupAgents: ["cat_heart", "cat_body"],
    status: "ready",
    summary: "Owner plus Cat Body task group package is ready for Cat Brain governance audit.",
    evidenceRefs: ["artifact://workflow-v2/owner-package.json", "receipt://workflow-v2/manager-review"]
  });
  assert.equal(taskGroupPackage.taskGroupPackage.status, "ready");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.cat_brain_audit.record",
      workflowId,
      planId: "plan-v2-kernel",
      taskGroupPackageId: taskGroupPackage.taskGroupPackage.packageId,
      callerAgent: "cat_body",
      decision: "approved",
      summary: "Unauthorized Cat Brain audit."
    }),
    /caller_agent_not_authorized/
  );
  const catBrainAudit = await runAction(root, {
    action: "workflow.v2.cat_brain_audit.record",
    workflowId,
    planId: "plan-v2-kernel",
    taskGroupPackageId: taskGroupPackage.taskGroupPackage.packageId,
    callerAgent: "main",
    decision: "approved",
    summary: "Cat Brain governance audit approved the evidence chain."
  });
  assert.equal(catBrainAudit.catBrainAudit.decision, "approved");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.cat_claw_audit.record",
      workflowId,
      planId: "plan-v2-kernel",
      catBrainAuditId: catBrainAudit.catBrainAudit.auditId,
      callerAgent: "catclaw",
      decision: "protocol_ready",
      summary: "Retired catclaw id must be rejected.",
      evidenceRefs: ["artifact://workflow-v2/owner-package.json"]
    }),
    /retired agent id catclaw is invalid/
  );
  const catClawAudit = await runAction(root, {
    action: "workflow.v2.cat_claw_audit.record",
    workflowId,
    planId: "plan-v2-kernel",
    catBrainAuditId: catBrainAudit.catBrainAudit.auditId,
    callerAgent: "cat_claw",
    decision: "protocol_ready",
    summary: "Cat Claw protocol audit passed; Human Gate package can be prepared.",
    evidenceRefs: ["artifact://workflow-v2/owner-package.json"]
  });
  assert.equal(catClawAudit.catClawAudit.decision, "protocol_ready");
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "human_gate_request_due");
}

async function testWorkflowV2GovernanceHumanGateBridgeFocused() {
  const fixture = await setupWorkflowV2GovernanceFixture("workflow-v2-hgate-focused");
  const { root, dbFile, workflowId, catClawAudit } = fixture;
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.human_gate_package.record",
      workflowId,
      sourceCatClawAuditId: catClawAudit.catClawAudit.auditId,
      status: "submitted",
      createdBy: "cat_claw"
    }),
    /human_gate_package_status_invalid/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.human_gate_package.record",
      workflowId,
      sourceCatClawAuditId: catClawAudit.catClawAudit.auditId,
      createdBy: "cat_claw"
    }),
    /human_gate_options_required/
  );
  const humanGatePackage = await runAction(root, {
    action: "workflow.v2.human_gate_package.record",
    workflowId,
    sourceCatClawAuditId: catClawAudit.catClawAudit.auditId,
    createdBy: "cat_claw",
    options: workflowV2KernelHumanGateOptions()
  });
  assert.equal(humanGatePackage.valid, true);
  assert.equal(humanGatePackage.humanGatePackage.status, "cat_claw_audited");
  assert.equal(humanGatePackage.humanGatePackage.options.length, 2);
  const interactionInput = {
    packageId: humanGatePackage.humanGatePackage.packageId,
    callerAgent: "cat_claw",
    submissionKind: "final_artifact",
    interactionType: "artifact_acceptance",
    responseSchema: {
      required: ["buttonSelection", "flashcatOriginalWords"],
      flashcatOriginalWordsRequired: true
    },
    resumeContract: {
      approved: "archive_final_artifact",
      rejected: "return_to_task_owner_revision"
    }
  };
  const invalidHumanGateInteractionPreview = await runAction(root, {
    action: "workflow.v2.human_gate_request.preview",
    packageId: humanGatePackage.humanGatePackage.packageId,
    callerAgent: "cat_claw",
    interactionType: "freeform_unbound_chat"
  });
  assert.equal(invalidHumanGateInteractionPreview.eligible, false);
  assert.equal(Boolean(invalidHumanGateInteractionPreview.violations.some((item) => item.code === "interaction_type_invalid")), true);
  const fuzzyHumanGateSelectorPreview = await runAction(root, {
    action: "workflow.v2.human_gate_request.preview",
    workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_claw"
  });
  assert.equal(fuzzyHumanGateSelectorPreview.eligible, false);
  assert.equal(Boolean(fuzzyHumanGateSelectorPreview.violations.some((item) => item.code === "human_gate_package_selector_required")), true);
  const humanGateRequestPreview = await runAction(root, {
    action: "workflow.v2.human_gate_request.preview",
    ...interactionInput
  });
  assert.equal(humanGateRequestPreview.eligible, true);
  assert.equal(humanGateRequestPreview.writeReady, true);
  assert.equal(humanGateRequestPreview.buttonSummary.planCount, 2);
  assert.equal(humanGateRequestPreview.buttonSummary.hasPause, true);
  assert.equal(humanGateRequestPreview.buttonSummary.hasTerminate, true);
  const humanGateRequest = await runAction(root, {
    action: "workflow.v2.human_gate_request",
    ...interactionInput
  });
  assert.equal(humanGateRequest.didCreateHumanGate, true);
  assert.equal(humanGateRequest.didCreateHumanGateButtons, true);
  assert.equal(humanGateRequest.didCreateTelegramOutbox, true);
  assert.equal(humanGateRequest.didSendTelegram, false);
  assert.equal(sqliteCount(dbFile, "protocol_objects", `object_id='${humanGateRequest.humanGateId}' AND object_type='human_gate_record' AND status='pending'`), 1);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${humanGateRequest.humanGateId}' AND decision_status='approved' AND status='active'`), 2);
  let planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_human");
  const replayedHumanGateRequest = await runAction(root, {
    action: "workflow.v2.human_gate_request",
    ...interactionInput
  });
  assert.equal(replayedHumanGateRequest.reusedStageGate, true);
  assert.equal(replayedHumanGateRequest.didCreateHumanGate, false);
  assert.equal(replayedHumanGateRequest.telegramOutboxDeduped, true);
  assert.equal(replayedHumanGateRequest.humanGateId, humanGateRequest.humanGateId);
  assert.equal(replayedHumanGateRequest.telegramOutboxId, humanGateRequest.telegramOutboxId);
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_human");
}

async function testWorkflowV2LifecycleRenewalAndValidatorFocused() {
  const fixture = await setupWorkflowV2KernelExecutionFixture("workflow-v2-renewal-focused");
  const { root, dbFile, workflowId } = fixture;
  const blockedLifecycleWorker = await runAction(root, workflowV2KernelWorkerInput(fixture, {
    workerRunId: "worker-v2-blocked-lifecycle"
  }));
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='blocked', last_error='blocked by missing upstream artifact', lease_owner='', lease_until='', updated_at='2026-07-03T00:00:03.000Z'
WHERE worker_run_id='${blockedLifecycleWorker.workerRun.workerRunId}';
UPDATE workflow_session_runs
SET status='failed', error='blocked by missing upstream artifact', updated_at='2026-07-03T00:00:03.000Z'
WHERE run_id='${blockedLifecycleWorker.workerRun.sessionRunId}';`);
  const lifecycleBlocked = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: blockedLifecycleWorker.workerRun.workerRunId
  });
  assert.equal(lifecycleBlocked.recommendation.action, "escalate_to_owner");
  assert.equal(Boolean(lifecycleBlocked.signals.some((signal) => signal.code === "blocked_condition")), true);

  const renewalWorker = await runAction(root, workflowV2KernelWorkerInput(fixture, {
    workerRunId: "worker-v2-renewal-source",
    contextBudgetTokens: 1200,
    contextUsedTokens: 1180,
    compactionCount: 3,
    sourceContextRefs: ["info-v2-task-input"],
    payload: { outputSummary: "Renewal source worker near context budget." }
  }));
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_nose",
    capabilities: { permissions: ["workflow.worker.lifecycle"] }
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_handoff.record",
      workflowId,
      workerRunId: renewalWorker.workerRun.workerRunId,
      callerAgent: "cat_nose",
      status: "accepted",
      summary: "Unauthorized handoff attempt.",
      artifactRef: "artifact://workflow-v2/unauthorized-handoff.json"
    }),
    /caller_agent_not_authorized/
  );
  const handoffPreview = await runAction(root, {
    action: "workflow.v2.worker_handoff.preview",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    handoffInfoId: "info-v2-renewal-handoff",
    status: "accepted",
    summary: "Accepted handoff package for same-class successor.",
    reason: "context pressure reached renewal threshold",
    artifactRef: "artifact://workflow-v2/renewal-handoff.json",
    sourceContextRefs: ["info-v2-task-input"],
    artifactRefs: ["artifact://workflow-v2/renewal-output.json"],
    receiptRefs: ["receipt://workflow-v2/renewal-source"]
  });
  assert.equal(handoffPreview.valid, true);
  const handoffRecord = await runAction(root, {
    action: "workflow.v2.worker_handoff.record",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    handoffInfoId: "info-v2-renewal-handoff",
    status: "accepted",
    summary: "Accepted handoff package for same-class successor.",
    reason: "context pressure reached renewal threshold",
    artifactRef: "artifact://workflow-v2/renewal-handoff.json",
    sourceContextRefs: ["info-v2-task-input"],
    artifactRefs: ["artifact://workflow-v2/renewal-output.json"],
    receiptRefs: ["receipt://workflow-v2/renewal-source"]
  });
  assert.equal(handoffRecord.handoff.status, "accepted");
  const lifecycleAfterHandoff = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId
  });
  assert.equal(lifecycleAfterHandoff.recommendation.action, "spawn_successor");
  assert.equal(lifecycleAfterHandoff.recommendation.successorAllowed, true);
  const retireRecord = await runAction(root, {
    action: "workflow.v2.worker_retire.record",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    reason: "retire source after accepted handoff before successor spawn"
  });
  assert.equal(retireRecord.nextStatus, "retired");
  const successorCreate = await runAction(root, {
    action: "workflow.v2.worker_successor.create",
    workflowId,
    sourceWorkerRunId: renewalWorker.workerRun.workerRunId,
    successorWorkerRunId: "worker-v2-renewal-successor",
    callerAgent: "cat_body",
    nextRetryAt: "2999-01-01T00:00:00.000Z",
    providerModel: "openai-codex/gpt-5.5",
    receipt: v2KernelReceipt(),
    oauth: v2KernelOAuth(),
    network: v2KernelNetwork()
  });
  assert.equal(successorCreate.spawnResult.workerRun.status, "queued");
  const renewalSourceRow = sqliteJson(dbFile, `
SELECT status, successor_worker_run_id AS successorWorkerRunId
FROM workflow_v2_worker_runs
WHERE worker_run_id='${renewalWorker.workerRun.workerRunId}';`)[0];
  assert.equal(renewalSourceRow.status, "successor_spawned");
  assert.equal(renewalSourceRow.successorWorkerRunId, "worker-v2-renewal-successor");
  const validation = await runAction(root, {
    action: "workflow.v2.validate",
    workflowId
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.status, "pass");

  sqliteExec(dbFile, `
INSERT INTO workflow_v2_manager_reviews(review_id, workflow_id, plan_id, node_id, worker_run_id, reviewer_agent, decision, summary, findings_json, artifact_refs_json, receipt_refs_json, blocker_json, payload_json, created_at)
VALUES ('review-v2-orphan-manager', '${workflowId}', 'plan-v2-kernel', '${v2KernelManagerWorkerNode(fixture.plan).nodeId}', '', 'cat_body', 'accepted', 'Validator should reject unbound manager reviews.', '[]', '[]', '[]', '{}', '{}', '2026-07-03T00:11:30.000Z');`);
  const invalidOrphanManagerReview = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidOrphanManagerReview.ok, false);
  assert.equal(Boolean(invalidOrphanManagerReview.failedChecks.includes("manager_reviews_match_worker_runs")), true);
  sqliteExec(dbFile, `DELETE FROM workflow_v2_manager_reviews WHERE review_id='review-v2-orphan-manager';`);

  sqliteExec(dbFile, `
INSERT INTO workflow_session_runs(run_id, session_id, pack_version, workflow_id, task_id, dispatch_id, worker_id, status, input_json, worker_input_json, output_json, receipt_ref, error, started_at, completed_at, created_at, updated_at)
VALUES ('session-v2-bad-json-input', 'session-cat-body-worker', 1, '${workflowId}', 'bad-json-node', '', 'bad-json-worker', 'queued', '{bad-json', '{}', '{}', '', '', '', '', '2026-07-03T00:11:35.000Z', '2026-07-03T00:11:35.000Z');`);
  const invalidBadSessionJson = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidBadSessionJson.ok, false);
  assert.equal(Boolean(invalidBadSessionJson.failedChecks.includes("v2_session_runs_have_worker_runs")), true);
}

// Legacy monolithic v2 integration scenario kept temporarily as a reference while
// focused V2.1 tests replace it in the active regression list.
async function legacyWorkflowV2OrchestrationKernelIntegration() {
  const root = await tempRoot("workflow-v2-kernel");
  const dbFile = path.join(root, "tracking.db");
  const workflowId = "wf-v2-kernel";
  const missingPatternPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "This plan intentionally omits orchestrationPattern.",
    taskOwnerAgent: "cat_heart",
    acceptanceCriteria: ["explicit acceptance exists"]
  });
  assert.equal(missingPatternPreview.valid, true);
  assert.equal(Boolean(missingPatternPreview.advisoryChecks.some((item) => item.code === "orchestration_pattern_recommended")), true);
  assert.equal(missingPatternPreview.recommendations.preferredPattern, "manager_worker");

  const directOwnerPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "Direct owner plan should not auto-inject manager nodes.",
    taskOwnerAgent: "cat_heart",
    ...v2PlanContract({
      orchestrationPattern: "direct_owner_execution",
      orchestrationRationale: "This direct owner preview intentionally omits participantManagers and must stay owner-only.",
      workerBudget: { maxWorkers: 0, concurrencyLimit: 0, maxWorkerContextTokens: 64000 }
    })
  });
  assert.equal(directOwnerPreview.valid, true);
  assert.deepEqual(directOwnerPreview.plan.participantManagers, []);
  assert.equal(Boolean(directOwnerPreview.nodes.some((node) => node.nodeType === "manager_worker_spawn")), false);
  assert.equal(Boolean(directOwnerPreview.nodes.some((node) => node.nodeType === "manager_review")), false);

  const planPreview = await runAction(root, {
    action: "workflow.v2.plan.preview",
    workflowId,
    objective: "猫之心负责组织猫成员经理，分解任务并调度 worker 产出 artifacts。",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose", "cat_eyes"],
    ...v2PlanContract({
      acceptanceCriteria: ["session repository is used", "worker output is reviewed"],
      workerBudget: { maxWorkers: 12, concurrencyLimit: 4, maxWorkerContextTokens: 64000 }
    })
  });
  assert.equal(planPreview.valid, true);
  assert.equal(planPreview.dryRun, true);
  assert.equal(planPreview.plan.taskOwnerAgent, "cat_heart");
  assert.equal(planPreview.plan.planRevision, 1);
  assert.equal(planPreview.plan.workflowState, "draft");
  assert.equal(planPreview.plan.humanGatePolicy.minApproveOptions, 2);
  assert.equal(planPreview.plan.humanGatePolicy.maxApproveOptions, 5);
  assert.equal(planPreview.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(planPreview.planSpecV2.meta.workflowId, workflowId);
  assert.equal(planPreview.planSpecV2.orchestration.pattern, "manager_worker");
  assert.equal(planPreview.planSpecV2.orchestration.workerBudget.concurrencyLimit, 4);
  assert.equal(planPreview.planSpecV2.acceptance.ownerReviewsManagerArtifacts, true);
  assert.equal(planPreview.planSpecV2.acceptance.maxWorkerContextTokens, 64000);
  assert.equal(planPreview.planSpecV2.verification.ownerReviewRequired, true);
  assert.equal(Boolean(planPreview.nodes.some((node) => node.nodeType === "manager_worker_spawn")), true);
  assert.equal(Boolean(await pathExists(dbFile)), false);

  const plan = await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId: "plan-v2-kernel",
    objective: "Persist v2 orchestration plan.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose"],
    ...v2PlanContract()
  });
  assert.equal(plan.plan.planId, "plan-v2-kernel");
  assert.equal(plan.plan.planRevision, 1);
  assert.equal(plan.plan.workflowState, "planned");
  assert.equal(plan.planSpecV2.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(plan.planSpecV2.artifacts.canonicalPlan.sourceOfTruth, true);
  assert.equal(await pathExists(path.join(root, plan.artifacts.canonicalJson)), true);
  const canonicalPlanSpecText = await fs.readFile(path.join(root, plan.artifacts.canonicalJson), "utf8");
  const canonicalPlanSpec = JSON.parse(canonicalPlanSpecText);
  assert.equal(canonicalPlanSpec.schemaVersion, "workflow_plan_spec.v2");
  assert.equal(canonicalPlanSpec.meta.planId, "plan-v2-kernel");
  assert.equal(canonicalPlanSpec.meta.planRevision, 1);
  assert.equal(canonicalPlanSpec.acceptance.ownerReviewsManagerArtifacts, true);
  assert.equal(canonicalPlanSpec.orchestration.pattern, "manager_worker");
  assert.equal(canonicalPlanSpec.verification.managerReviewRequiredForManagerWorkerPaths, true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_plans", "plan_id='plan-v2-kernel'"), 1);
  assert.equal(sqliteCount(dbFile, "artifact_index", `artifact_id='${plan.artifacts.artifactId}' AND kind='workflow_v2_plan_spec_json'`), 1);
  const storedPlanRow = sqliteJson(dbFile, "SELECT plan_revision AS planRevision, plan_spec_artifact_ref AS planSpecArtifactRef, plan_spec_artifact_hash AS planSpecArtifactHash, payload_json AS payloadJson FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(storedPlanRow.planRevision, 1);
  assert.equal(storedPlanRow.planSpecArtifactRef, plan.artifacts.canonicalJson);
  assert.equal(Boolean(storedPlanRow.planSpecArtifactHash), true);
  const storedPlanPayload = JSON.parse(storedPlanRow.payloadJson);
  assert.equal(storedPlanPayload.planSpecV2ArtifactRef, plan.artifacts.canonicalJson);
  assert.equal(storedPlanPayload.planSpecV2ArtifactId, plan.artifacts.artifactId);
  assert.equal(Boolean(storedPlanPayload.planSpecV2Hash), true);
  const artifactIndexRow = sqliteJson(dbFile, `SELECT workflow_id AS workflowId FROM artifact_index WHERE artifact_id='${plan.artifacts.artifactId}' LIMIT 1;`)[0];
  assert.equal(artifactIndexRow.workflowId, workflowId);

  const retryPlan = await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId: "plan-v2-kernel",
    objective: "Persist v2 orchestration plan.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose"],
    ...v2PlanContract()
  });
  assert.equal(retryPlan.artifacts.canonicalJson, plan.artifacts.canonicalJson);
  assert.equal(await fs.readFile(path.join(root, retryPlan.artifacts.canonicalJson), "utf8"), canonicalPlanSpecText);
  const retryStoredPlanRow = sqliteJson(dbFile, "SELECT plan_revision AS planRevision, plan_spec_artifact_ref AS planSpecArtifactRef, plan_spec_artifact_hash AS planSpecArtifactHash FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(retryStoredPlanRow.planRevision, 1);
  assert.equal(retryStoredPlanRow.planSpecArtifactRef, storedPlanRow.planSpecArtifactRef);
  assert.equal(retryStoredPlanRow.planSpecArtifactHash, storedPlanRow.planSpecArtifactHash);
  sqliteExec(dbFile, `UPDATE artifact_index SET workflow_id='wrong-workflow' WHERE artifact_id='${plan.artifacts.artifactId}';`);
  const conflictRetryPlan = await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId: "plan-v2-kernel",
    objective: "Persist v2 orchestration plan.",
    taskOwnerAgent: "cat_heart",
    participantManagers: ["cat_body", "cat_nose"],
    ...v2PlanContract()
  });
  assert.equal(await fs.readFile(path.join(root, conflictRetryPlan.artifacts.canonicalJson), "utf8"), canonicalPlanSpecText);
  const conflictArtifactIndexRow = sqliteJson(dbFile, `SELECT workflow_id AS workflowId FROM artifact_index WHERE artifact_id='${plan.artifacts.artifactId}' LIMIT 1;`)[0];
  assert.equal(conflictArtifactIndexRow.workflowId, workflowId);

  const legacyPlanRoot = await tempRoot("workflow-v2-plan-legacy-schema");
  const legacyPlanDbFile = path.join(legacyPlanRoot, "tracking.db");
  sqliteExec(legacyPlanDbFile, "CREATE TABLE workflow_v2_plans(plan_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL);");
  const legacyPlan = await runAction(legacyPlanRoot, {
    action: "workflow.v2.plan.create",
    workflowId: "wf-v2-legacy-plan",
    planId: "plan-v2-legacy-plan",
    objective: "Migrate legacy v2 plan table before writing canonical JSON plan.",
    taskOwnerAgent: "cat_heart",
    ...v2PlanContract()
  });
  assert.equal(await pathExists(path.join(legacyPlanRoot, legacyPlan.artifacts.canonicalJson)), true);
  const legacyPlanColumns = sqliteJson(legacyPlanDbFile, "PRAGMA table_info(workflow_v2_plans);").map((row) => row.name);
  assert.equal(Boolean(legacyPlanColumns.includes("plan_revision")), true);
  assert.equal(Boolean(legacyPlanColumns.includes("plan_spec_artifact_ref")), true);
  assert.equal(Boolean(legacyPlanColumns.includes("plan_spec_artifact_hash")), true);
  const legacyPlanRow = sqliteJson(legacyPlanDbFile, "SELECT plan_revision AS planRevision, plan_spec_artifact_ref AS planSpecArtifactRef, plan_spec_artifact_hash AS planSpecArtifactHash FROM workflow_v2_plans WHERE plan_id='plan-v2-legacy-plan' LIMIT 1;")[0];
  assert.equal(legacyPlanRow.planRevision, 1);
  assert.equal(legacyPlanRow.planSpecArtifactRef, legacyPlan.artifacts.canonicalJson);
  assert.equal(Boolean(legacyPlanRow.planSpecArtifactHash), true);

  const advisoryPlanRoot = await tempRoot("workflow-v2-plan-advisory");
  await runAction(advisoryPlanRoot, {
    action: "workflow.v2.plan.create",
    workflowId: "wf-v2-advisory-plan",
    planId: "plan-v2-advisory",
    objective: "Persist a lightweight plan before the orchestration pattern is fully known.",
    taskOwnerAgent: "cat_heart",
    acceptanceCriteria: ["owner can continue refining the plan"]
  });
  const advisoryPlanValidation = await runAction(advisoryPlanRoot, {
    action: "workflow.v2.validate"
  });
  assert.equal(advisoryPlanValidation.ok, true, JSON.stringify(advisoryPlanValidation.failedChecks));
  assert.equal(advisoryPlanValidation.failedChecks.includes("plans_anthropic_orchestration_contract"), false);
  assert.equal(Boolean(advisoryPlanValidation.advisoryChecks.some((item) => item.checkId === "plans_anthropic_orchestration_contract" && item.status === "advisory")), true);

  for (const agent of [
    { agentId: "cat_heart", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] },
    { agentId: "cat_nose", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify"] },
    { agentId: "cat_body", runtime: "hermers", platform: "hermers", permissions: ["workflow.verify", "workflow.worker.lifecycle", "cat_claw.audit"] },
    { agentId: "main", runtime: "openclaw", platform: "openclaw", permissions: ["workflow.verify"] },
    { agentId: "cat_claw", runtime: "openclaw", platform: "openclaw", permissions: ["cat_claw.audit", "human_gate.write"] }
  ]) {
    await runAction(root, {
      action: "runtime.agent.upsert",
      agentId: agent.agentId,
      runtime: agent.runtime,
      platform: agent.platform,
      capabilities: { permissions: agent.permissions }
    });
  }

  await runAction(root, {
    action: "workflow.session_pack.upsert",
    sessionId: "session-cat-body-worker",
    ownerAgent: "cat_body",
    runtimeTarget: "hermers",
    taskType: "development_worker",
    purpose: "Preloaded worker context for cat_body manager spawned coding work.",
    systemBrief: "Use only referenced artifacts and return structured output."
  });

  const info = await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_planning").nodeId,
    infoId: "info-v2-task-input",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/task-input.json",
    recipientAgent: "cat_body",
    summary: "Task input pointer for cat_body manager."
  });
  assert.equal(info.infoItem.infoId, "info-v2-task-input");
  assert.equal(info.notification.payloadMode, "pointer_only");
  assert.equal(Boolean(info.notification.payload.readAction), true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", "info_id='info-v2-task-input'"), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_notifications", "info_id='info-v2-task-input'"), 1);
  const readInfo = await runAction(root, {
    action: "workflow.v2.info_stack.read",
    inboxItemId: info.inboxItem.inboxItemId,
    principalKind: "agent",
    principalId: "cat_body"
  });
  assert.equal(readInfo.item.infoId, "info-v2-task-input");
  assert.equal(readInfo.item.contentStorage, "artifact_ref");
  assert.equal(readInfo.receiptRecordAction, "workflow.v2.read_receipt.record");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.info_stack.read",
      infoId: "info-v2-task-input",
      principalKind: "agent",
      principalId: "cat_body"
    }),
    /requires inboxItemId or grantId/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.read_receipt.record",
      workflowId,
      infoId: readInfo.item.infoId,
      readerKind: "agent",
      readerId: "cat_body"
    }),
    /requires inboxItemId or grantId/
  );
  await runAction(root, {
    action: "workflow.v2.read_receipt.record",
    workflowId,
    infoId: readInfo.item.infoId,
    inboxItemId: readInfo.access.inboxItemId,
    grantId: readInfo.access.grantId,
    readerKind: "agent",
    readerId: "cat_body"
  });
  assert.equal(sqliteCount(dbFile, "workflow_v2_read_receipts", "info_id='info-v2-task-input'"), 1);

  const sensitiveInline = await runAction(root, {
    action: "workflow.v2.info_stack.preview",
    workflowId,
    classification: "sensitive",
    contentStorage: "inline",
    bodyText: "do not store this inline",
    recipientAgent: "cat_body"
  });
  assert.equal(sensitiveInline.valid, false);
  assert.equal(Boolean(sensitiveInline.errors.some((item) => item.code === "sensitive_inline_body_disallowed")), true);
  const implicitInline = await runAction(root, {
    action: "workflow.v2.info_stack.preview",
    workflowId,
    classification: "internal",
    bodyText: "non-sensitive body still needs an artifact pointer"
  });
  assert.equal(implicitInline.valid, false);
  assert.equal(Boolean(implicitInline.errors.some((item) => item.code === "content_ref_required")), true);

  const pointerNotification = await runAction(root, {
    action: "workflow.v2.notification.preview",
    workflowId,
    infoId: "info-v2-task-input",
    payloadMode: "pointer_only",
    notificationBody: "full body must not be embedded"
  });
  assert.equal(pointerNotification.valid, false);
  assert.equal(Boolean(pointerNotification.errors.some((item) => item.code === "pointer_notification_body_disallowed")), true);

  const openclawWorker = await runAction(root, {
    action: "workflow.v2.worker_backend.preflight",
    workflowId,
    backendId: "openclaw"
  });
  assert.equal(openclawWorker.valid, false);
  assert.equal(Boolean(openclawWorker.errors.some((item) => item.code === "openclaw_worker_backend_disallowed")), true);
  const emptyEvidence = await runAction(root, {
    action: "workflow.v2.worker_backend.preflight",
    workflowId,
    backendId: "hermers_docker_worker",
    receipt: {},
    oauth: {},
    network: {}
  });
  assert.equal(emptyEvidence.valid, false);
  assert.equal(Boolean(emptyEvidence.errors.some((item) => item.code === "model_receipt_missing_required_fields")), true);
  assert.equal(Boolean(emptyEvidence.errors.some((item) => item.code === "oauth_status_required")), true);
  assert.equal(Boolean(emptyEvidence.errors.some((item) => item.code === "network_policy_required")), true);

  const fallbackMismatch = await runAction(root, {
    action: "workflow.v2.worker_backend.preflight",
    workflowId,
    backendId: "hermers_docker_worker",
    providerModel: "openai-codex/gpt-5.5",
    fallbackAllowed: false,
    receipt: { provider: "minimax", model: "MiniMax-M3", fallbackAttempts: 1, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  assert.equal(fallbackMismatch.valid, false);
  assert.equal(Boolean(fallbackMismatch.errors.some((item) => item.code === "model_route_mismatch")), true);
  assert.equal(Boolean(fallbackMismatch.errors.some((item) => item.code === "model_fallback_disallowed")), true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_spawn.create",
      workflowId,
      planId: "plan-v2-kernel",
      nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
      managerAgent: "cat_body",
      sessionId: "missing-session-pack",
      workerRunId: "worker-v2-missing-session",
      preflightId: "preflight-v2-missing-session",
      taskInputInfoId: "info-v2-task-input",
      runtimeBackend: "local_deterministic",
      ...v2WorkerDelegation(),
      providerModel: "openai-codex/gpt-5.5",
      receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
      oauth: { expiryOk: true, refreshOk: true },
      network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
    }),
    /workflow session pack not found/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "worker_run_id='worker-v2-missing-session'"), 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_backend_preflights", "preflight_id='preflight-v2-missing-session'"), 0);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_spawn.create",
      workflowId,
      planId: "plan-v2-kernel",
      nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
      managerAgent: "cat_body",
      sessionId: "session-cat-body-worker",
      workerRunId: "worker-v2-invalid-start-status",
      taskInputInfoId: "info-v2-task-input",
      runtimeBackend: "local_deterministic",
      status: "running",
      ...v2WorkerDelegation(),
      providerModel: "openai-codex/gpt-5.5",
      receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
      oauth: { expiryOk: true, refreshOk: true },
      network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
    }),
    /worker_spawn_status_must_be_queued/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "worker_run_id='worker-v2-invalid-start-status'"), 0);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_spawn.create",
      workflowId,
      planId: "plan-v2-kernel",
      nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
      managerAgent: "cat_body",
      sessionId: "session-cat-body-worker",
      workerRunId: "worker-v2-missing-delegation",
      taskInputInfoId: "info-v2-task-input",
      runtimeBackend: "local_deterministic",
      providerModel: "openai-codex/gpt-5.5",
      receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
      oauth: { expiryOk: true, refreshOk: true },
      network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
    }),
    /worker_objective_required/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "worker_run_id='worker-v2-missing-delegation'"), 0);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_spawn.create",
      workflowId,
      planId: "plan-v2-kernel",
      nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
      managerAgent: "cat_body",
      sessionId: "session-cat-body-worker",
      workerRunId: "worker-v2-missing-context-budget",
      taskInputInfoId: "info-v2-task-input",
      runtimeBackend: "local_deterministic",
      ...v2WorkerDelegation({ contextBudgetTokens: undefined }),
      providerModel: "openai-codex/gpt-5.5",
      receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
      oauth: { expiryOk: true, refreshOk: true },
      network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
    }),
    /worker_context_budget_required/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "worker_run_id='worker-v2-missing-context-budget'"), 0);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_spawn.create",
      workflowId,
      planId: "plan-v2-kernel",
      nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
      managerAgent: "cat_body",
      sessionId: "session-cat-body-worker",
      workerRunId: "worker-v2-too-large-context",
      taskInputInfoId: "info-v2-task-input",
      runtimeBackend: "local_deterministic",
      ...v2WorkerDelegation({ contextBudgetTokens: 64001 }),
      providerModel: "openai-codex/gpt-5.5",
      receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
      oauth: { expiryOk: true, refreshOk: true },
      network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
    }),
    /worker_context_budget_too_high/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "worker_run_id='worker-v2-too-large-context'"), 0);

  const worker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    maxAttempts: 2,
    ...v2WorkerDelegation({ contextBudgetTokens: 1000 }),
    contextUsedTokens: 920,
    compactionCount: 2,
    sourceContextRefs: ["info-v2-task-input"],
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false },
    payload: { outputSummary: "Deterministic worker output prepared for manager review." }
  });
  assert.equal(worker.valid, true);
  assert.ok(worker.workerRun.sessionRunId);
  assert.equal(worker.sessionRun.runId, worker.workerRun.sessionRunId);
  assert.equal(worker.sessionRun.status, "queued");
  assert.equal(worker.sessionRun.workerInput.input.workerRunId, worker.workerRun.workerRunId);
  assert.equal(worker.sessionRun.workerInput.input.taskInputInfoId, "info-v2-task-input");
  assert.equal(worker.sessionRun.workerInput.context.workflowId, workflowId);
  assert.equal(worker.workerRun.contextBudgetTokens, 1000);
  assert.equal(worker.workerRun.contextUsedTokens, 920);
  assert.equal(worker.workerRun.compactionCount, 2);
  assert.deepEqual(worker.workerRun.sourceContextRefs, ["info-v2-task-input"]);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "manager_agent='cat_body'"), 1);
  assert.equal(sqliteCount(dbFile, "workflow_session_runs", `run_id='${worker.workerRun.sessionRunId}' AND session_id='session-cat-body-worker' AND workflow_id='${workflowId}'`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_backend_preflights", "status IN ('pass','warn')"), 1);
  const workerPreflightRow = sqliteJson(dbFile, `SELECT preflight_id AS preflightId FROM workflow_v2_worker_runs WHERE worker_run_id='${worker.workerRun.workerRunId}' LIMIT 1;`)[0];
  assert.ok(workerPreflightRow.preflightId);
  const workerSessionRow = sqliteJson(dbFile, `
SELECT session_run_id AS sessionRunId, payload_json AS payloadJson
FROM workflow_v2_worker_runs
WHERE worker_run_id='${worker.workerRun.workerRunId}'
LIMIT 1;`)[0];
  assert.equal(workerSessionRow.sessionRunId, worker.workerRun.sessionRunId);
  assert.equal(workerSessionRow.payloadJson.includes("workflow_session_runs"), true);

  const lifecycleHighPressure = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: worker.workerRun.workerRunId,
    contextPressureThreshold: 0.8,
    maxCompactions: 2
  });
  assert.equal(lifecycleHighPressure.valid, true);
  assert.equal(lifecycleHighPressure.recommendation.action, "handoff_required");
  assert.equal(lifecycleHighPressure.recommendation.requiredAuthority.managerAgent, "cat_body");
  assert.equal(lifecycleHighPressure.telemetry.contextPressureRatio, 0.92);
  assert.equal(Boolean(lifecycleHighPressure.signals.some((signal) => signal.code === "context_pressure_high")), true);
  assert.equal(Boolean(lifecycleHighPressure.signals.some((signal) => signal.code === "compaction_limit_reached")), true);
  assert.equal(lifecycleHighPressure.handoffPackagePreview.handoffInfoId, `${worker.workerRun.workerRunId}.handoff.info`);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_handoffs"), 0);

  const queuePreview = await runAction(root, {
    action: "workflow.v2.control_loop.preview",
    workflowId
  });
  assert.equal(queuePreview.status, "ok");
  assert.equal(Number(queuePreview.counts.due), 1);
  assert.equal(queuePreview.runnableWorkers[0].runtimeBackend, "local_deterministic");

  const queueTick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-control-loop",
    workerLeaseMs: 60_000
  });
  assert.equal(queueTick.status, "ok");
  assert.equal(queueTick.claimedWorkers.length, 1);
  assert.equal(queueTick.workerResults[0].status, "submitted_for_review");
  assert.ok(queueTick.workerResults[0].artifactFile);
  assert.equal(await pathExists(queueTick.workerResults[0].artifactFile), true);
  const completedWorker = sqliteJson(dbFile, `
SELECT status, attempt, output_info_id AS outputInfoId, receipt_ref AS receiptRef, lease_owner AS leaseOwner, lease_until AS leaseUntil, completed_at AS completedAt
FROM workflow_v2_worker_runs
WHERE worker_run_id='${worker.workerRun.workerRunId}';`)[0];
  assert.equal(completedWorker.status, "submitted_for_review");
  assert.equal(completedWorker.attempt, 1);
  assert.ok(completedWorker.outputInfoId);
  assert.ok(completedWorker.receiptRef);
  assert.equal(completedWorker.leaseOwner, "");
  assert.equal(completedWorker.leaseUntil, "");
  assert.ok(completedWorker.completedAt);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", `worker_run_id='${worker.workerRun.workerRunId}' AND info_id='${completedWorker.outputInfoId}'`), 1);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      workerRunId: worker.workerRun.workerRunId,
      reviewerAgent: "cat_heart",
      decision: "accepted",
      summary: "Task owner must not accept a manager-owned worker through manager review."
    }),
    /reviewer_agent_not_worker_manager/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_manager_reviews", `worker_run_id='${worker.workerRun.workerRunId}' AND reviewer_agent='cat_heart'`), 0);

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      reviewerAgent: "cat_body",
      decision: "accepted",
      summary: "Manager review must be bound to a concrete worker run."
    }),
    /requires workerRunId/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_manager_reviews", "worker_run_id='' AND decision='accepted'"), 0);

  const review = await runAction(root, {
    action: "workflow.v2.manager_review.record",
    workflowId,
    planId: "plan-v2-kernel",
    workerRunId: worker.workerRun.workerRunId,
    reviewerAgent: "cat_body",
    decision: "accepted",
    summary: "Worker output accepted by manager."
  });
  assert.equal(review.review.decision, "accepted");

  const lifecycleAccepted = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: worker.workerRun.workerRunId,
    contextPressureThreshold: 0.8,
    maxCompactions: 2
  });
  assert.equal(lifecycleAccepted.valid, true);
  assert.equal(lifecycleAccepted.recommendation.action, "no_action");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.owner_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      callerAgent: "cat_nose",
      managerReviewIds: [review.review.reviewId],
      decision: "accepted",
      summary: "Unauthorized owner review."
    }),
    /caller_agent_not_authorized/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.owner_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      callerAgent: "cat_heart",
      managerReviewIds: [review.review.reviewId],
      decision: "blocked",
      summary: "Owner review must not use blocked as a review decision."
    }),
    /blocked_decision_not_allowed/
  );
  const ownerReview = await runAction(root, {
    action: "workflow.v2.owner_review.record",
    workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_heart",
    managerReviewIds: [review.review.reviewId],
    decision: "accepted",
    taskGroupRequired: true,
    summary: "Task owner accepted manager artifact and requires compact task group review.",
    artifactRefs: ["artifact://workflow-v2/owner-package.json"],
    receiptRefs: ["receipt://workflow-v2/manager-review"]
  });
  assert.equal(ownerReview.valid, true);
  assert.equal(ownerReview.ownerReview.decision, "accepted");
  assert.equal(ownerReview.ownerReview.nextWorkflowState, "waiting_group_discussion");
  assert.equal(sqliteCount(dbFile, "workflow_v2_owner_reviews", `review_id='${ownerReview.ownerReview.reviewId}' AND owner_agent='cat_heart'`), 1);
  let planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_group_discussion");

  const taskGroupPackage = await runAction(root, {
    action: "workflow.v2.task_group_package.record",
    workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_heart",
    ownerReviewId: ownerReview.ownerReview.reviewId,
    taskGroupAgents: ["cat_heart", "cat_body"],
    status: "ready",
    summary: "Owner plus Cat Body task group package is ready for Cat Brain governance audit.",
    evidenceRefs: ["artifact://workflow-v2/owner-package.json", "receipt://workflow-v2/manager-review"]
  });
  assert.equal(taskGroupPackage.valid, true);
  assert.equal(taskGroupPackage.taskGroupPackage.status, "ready");
  assert.deepEqual(taskGroupPackage.taskGroupPackage.taskGroupAgents, ["cat_heart", "cat_body"]);
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_cat_brain_check");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.cat_brain_audit.record",
      workflowId,
      planId: "plan-v2-kernel",
      taskGroupPackageId: taskGroupPackage.taskGroupPackage.packageId,
      callerAgent: "cat_body",
      decision: "approved",
      summary: "Unauthorized Cat Brain audit."
    }),
    /caller_agent_not_authorized/
  );
  const catBrainAudit = await runAction(root, {
    action: "workflow.v2.cat_brain_audit.record",
    workflowId,
    planId: "plan-v2-kernel",
    taskGroupPackageId: taskGroupPackage.taskGroupPackage.packageId,
    callerAgent: "main",
    decision: "approved",
    summary: "Cat Brain governance audit approved the evidence chain.",
    evidenceRefs: ["artifact://workflow-v2/owner-package.json", "receipt://workflow-v2/manager-review"]
  });
  assert.equal(catBrainAudit.valid, true);
  assert.equal(catBrainAudit.catBrainAudit.decision, "approved");
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_cat_claw_audit");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.cat_claw_audit.record",
      workflowId,
      planId: "plan-v2-kernel",
      catBrainAuditId: catBrainAudit.catBrainAudit.auditId,
      callerAgent: "cat_body",
      decision: "protocol_ready",
      summary: "Unauthorized Cat Claw audit.",
      evidenceRefs: ["artifact://workflow-v2/owner-package.json"]
    }),
    /caller_agent_not_authorized/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.cat_claw_audit.record",
      workflowId,
      planId: "plan-v2-kernel",
      catBrainAuditId: catBrainAudit.catBrainAudit.auditId,
      callerAgent: "catclaw",
      decision: "protocol_ready",
      summary: "Retired catclaw id must be rejected.",
      evidenceRefs: ["artifact://workflow-v2/owner-package.json"]
    }),
    /retired agent id catclaw is invalid/
  );
  const catClawAudit = await runAction(root, {
    action: "workflow.v2.cat_claw_audit.record",
    workflowId,
    planId: "plan-v2-kernel",
    catBrainAuditId: catBrainAudit.catBrainAudit.auditId,
    callerAgent: "cat_claw",
    decision: "protocol_ready",
    summary: "Cat Claw protocol audit passed; Human Gate package can be prepared.",
    checks: ["options_present", "evidence_refs_present", "rollback_boundary_present"],
    evidenceRefs: ["artifact://workflow-v2/owner-package.json", "receipt://workflow-v2/manager-review"]
  });
  assert.equal(catClawAudit.valid, true);
  assert.equal(catClawAudit.catClawAudit.decision, "protocol_ready");
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "human_gate_request_due");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.human_gate_package.record",
      workflowId,
      sourceCatClawAuditId: catClawAudit.catClawAudit.auditId,
      status: "submitted",
      createdBy: "cat_claw"
    }),
    /human_gate_package_status_invalid/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.human_gate_package.record",
      workflowId,
      planId: "plan-v2-kernel",
      status: "cat_claw_audited",
      createdBy: "cat_claw"
    }),
    /source_cat_claw_audit_required/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.human_gate_package.record",
      workflowId,
      sourceCatClawAuditId: catClawAudit.catClawAudit.auditId,
      createdBy: "cat_claw"
    }),
    /human_gate_options_required/
  );

  await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId: "plan-v2-cross-plan",
    objective: "Cross-plan provenance guard fixture.",
    taskOwnerAgent: "cat_heart",
    participantManagers: [],
    ...v2PlanContract({
      orchestrationPattern: "direct_owner_execution",
      orchestrationRationale: "Owner-direct fixture has no workers and only tests provenance guards.",
      workerBudget: { maxWorkers: 0, concurrencyLimit: 0, maxWorkerContextTokens: 64000 }
    })
  });
  const crossOwnerReview = await runAction(root, {
    action: "workflow.v2.owner_review.record",
    workflowId,
    planId: "plan-v2-cross-plan",
    callerAgent: "cat_heart",
    decision: "accepted",
    allowNoManagerReviews: true,
    taskGroupRequired: false,
    summary: "Owner-direct cross-plan package evidence.",
    artifactRefs: ["artifact://workflow-v2/cross-plan-owner.json"]
  });
  const crossTaskGroupPackage = await runAction(root, {
    action: "workflow.v2.task_group_package.record",
    workflowId,
    planId: "plan-v2-cross-plan",
    callerAgent: "cat_heart",
    ownerReviewId: crossOwnerReview.ownerReview.reviewId,
    taskGroupAgents: ["cat_heart", "cat_body"],
    status: "ready",
    summary: "Cross-plan task group package ready.",
    evidenceRefs: ["artifact://workflow-v2/cross-plan-owner.json"]
  });
  const crossCatBrainAudit = await runAction(root, {
    action: "workflow.v2.cat_brain_audit.record",
    workflowId,
    planId: "plan-v2-cross-plan",
    taskGroupPackageId: crossTaskGroupPackage.taskGroupPackage.packageId,
    callerAgent: "main",
    decision: "approved",
    summary: "Cross-plan Cat Brain audit.",
    evidenceRefs: ["artifact://workflow-v2/cross-plan-owner.json"]
  });
  const crossCatClawAudit = await runAction(root, {
    action: "workflow.v2.cat_claw_audit.record",
    workflowId,
    planId: "plan-v2-cross-plan",
    catBrainAuditId: crossCatBrainAudit.catBrainAudit.auditId,
    callerAgent: "cat_claw",
    decision: "protocol_ready",
    summary: "Cross-plan Cat Claw audit must not bless another plan.",
    evidenceRefs: ["artifact://workflow-v2/cross-plan-owner.json"]
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.human_gate_package.record",
      workflowId,
      planId: "plan-v2-kernel",
      sourceCatClawAuditId: crossCatClawAudit.catClawAudit.auditId,
      createdBy: "cat_claw"
    }),
    /cat_claw_audit_plan_mismatch/
  );

  await runAction(root, {
    action: "workflow.v2.plan.create",
    workflowId,
    planId: "plan-v2-owner-direct",
    objective: "Owner-direct Cat Brain audit fixture.",
    taskOwnerAgent: "cat_heart",
    participantManagers: [],
    ...v2PlanContract({
      orchestrationPattern: "direct_owner_execution",
      orchestrationRationale: "Owner-direct fixture intentionally bypasses manager workers and records owner review evidence.",
      workerBudget: { maxWorkers: 0, concurrencyLimit: 0, maxWorkerContextTokens: 64000 }
    })
  });
  const directOwnerReview = await runAction(root, {
    action: "workflow.v2.owner_review.record",
    workflowId,
    planId: "plan-v2-owner-direct",
    callerAgent: "cat_heart",
    decision: "accepted",
    allowNoManagerReviews: true,
    taskGroupRequired: false,
    summary: "Owner-direct artifact accepted without task group.",
    artifactRefs: ["artifact://workflow-v2/owner-direct.json"],
    receiptRefs: ["receipt://workflow-v2/owner-direct"]
  });
  assert.equal(directOwnerReview.ownerReview.nextWorkflowState, "waiting_cat_brain_check");
  const directCatBrainAudit = await runAction(root, {
    action: "workflow.v2.cat_brain_audit.record",
    workflowId,
    planId: "plan-v2-owner-direct",
    ownerReviewId: directOwnerReview.ownerReview.reviewId,
    callerAgent: "main",
    decision: "approved",
    summary: "Cat Brain approved owner-direct evidence without a task group package."
  });
  assert.equal(directCatBrainAudit.valid, true);
  assert.equal(directCatBrainAudit.taskGroupPackage, null);
  assert.equal(directCatBrainAudit.ownerReview.reviewId, directOwnerReview.ownerReview.reviewId);
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-owner-direct' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_cat_claw_audit");

  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: worker.workerRun.nodeId,
    workerRunId: worker.workerRun.workerRunId,
    infoId: "info-v2-handoff",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/handoff.json",
    recipientAgent: "cat_body",
    summary: "Curated handoff package for lifecycle validator."
  });
  sqliteExec(dbFile, `
INSERT INTO workflow_v2_worker_handoffs(handoff_id, workflow_id, plan_id, node_id, worker_run_id, manager_agent, successor_worker_run_id, handoff_info_id, status, reason, summary, source_context_refs_json, artifact_refs_json, receipt_refs_json, payload_json, created_by, created_at, updated_at)
VALUES ('handoff-v2-valid', '${workflowId}', 'plan-v2-kernel', '${worker.workerRun.nodeId}', '${worker.workerRun.workerRunId}', 'cat_body', '', 'info-v2-handoff', 'recommended', 'context pressure handoff preview', 'Valid handoff package validator fixture.', '["info-v2-task-input"]', '["${completedWorker.outputInfoId}"]', '["${completedWorker.receiptRef}"]', '{}', 'cat_body', '2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z');`);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_handoffs", "handoff_id='handoff-v2-valid'"), 1);
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='handoff_required', handoff_info_id='info-v2-handoff', updated_at='2026-07-03T00:00:01.000Z'
WHERE worker_run_id='${worker.workerRun.workerRunId}';`);
  const lifecycleRecommendedHandoff = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: worker.workerRun.workerRunId
  });
  assert.equal(lifecycleRecommendedHandoff.valid, true);
  assert.equal(lifecycleRecommendedHandoff.recommendation.action, "handoff_required");
  assert.equal(lifecycleRecommendedHandoff.recommendation.successorAllowed, false);
  assert.equal(Boolean(lifecycleRecommendedHandoff.signals.some((signal) => signal.code === "handoff_not_accepted")), true);
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='accepted', handoff_info_id='', updated_at='2026-07-03T00:00:02.000Z'
WHERE worker_run_id='${worker.workerRun.workerRunId}';`);

  const humanGateOptions = [
    {
      optionId: "continue_current_package",
      title: "方案 1：接受当前产出",
      body: "接受 task owner、task group、猫之脑和猫爪已经复核过的当前产出包。",
      summary: "按当前证据包接受本轮产出。",
      prompt: "闪电猫批准后，workflow 进入收口归档，保留 artifact、receipt 和回滚边界。",
      rollback: "如后续发现证据缺口，退回 task owner 重新汇总并恢复到上一 checkpoint。"
    },
    {
      optionId: "return_to_manager_review",
      title: "方案 2：退回经理补证",
      body: "不接受当前产出，退回 manager 层补充 worker 证据、测试或回滚说明。",
      summary: "退回 manager 层补齐证据后再提交。",
      prompt: "task owner 将缺口退回相关 manager，manager 复核 worker 产出后重新提交。",
      rollback: "补证仍不完整时，保持 workflow 在 review 状态并记录 blocker。"
    }
  ];
  const humanGatePackage = await runAction(root, {
    action: "workflow.v2.human_gate_package.record",
    workflowId,
    sourceCatClawAuditId: catClawAudit.catClawAudit.auditId,
    createdBy: "cat_claw",
    options: humanGateOptions
  });
  assert.equal(humanGatePackage.valid, true);
  assert.equal(humanGatePackage.humanGatePackage.sourceCatClawAuditId, catClawAudit.catClawAudit.auditId);
  assert.equal(humanGatePackage.humanGatePackage.status, "cat_claw_audited");
  assert.equal(humanGatePackage.humanGatePackage.options.length >= 2, true);
  assert.equal(humanGatePackage.humanGatePackage.options.length <= 5, true);
  assert.equal(humanGatePackage.humanGatePackage.options.every((option) => option.optionId && option.title && option.body && option.summary && option.prompt && option.rollback), true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_human_gate_packages"), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_human_gate_packages", `plan_id='plan-v2-kernel' AND source_cat_claw_audit_id='${catClawAudit.catClawAudit.auditId}' AND status='cat_claw_audited'`), 1);
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "human_gate_request_due");

  const humanGateRequestCountsBefore = {
    records: sqliteCount(dbFile, "protocol_objects", "object_type='human_gate_record'"),
    buttons: sqliteCount(dbFile, "human_gate_buttons"),
    outbox: sqliteCount(dbFile, "telegram_outbox", "message_type='human_gate_request'"),
    events: sqliteCount(dbFile, "workflow_events", "event_type='human_gate.requested'")
  };
  const humanGateRequestInteractionInput = {
    packageId: humanGatePackage.humanGatePackage.packageId,
    callerAgent: "cat_claw",
    submissionKind: "final_artifact",
    interactionType: "artifact_acceptance",
    responseSchema: {
      required: ["buttonSelection", "flashcatOriginalWords"],
      flashcatOriginalWordsRequired: true
    },
    resumeContract: {
      approved: "archive_final_artifact",
      rejected: "return_to_task_owner_revision"
    }
  };
  const invalidHumanGateInteractionPreview = await runAction(root, {
    action: "workflow.v2.human_gate_request.preview",
    packageId: humanGatePackage.humanGatePackage.packageId,
    callerAgent: "cat_claw",
    interactionType: "freeform_unbound_chat"
  });
  assert.equal(invalidHumanGateInteractionPreview.eligible, false);
  assert.equal(Boolean(invalidHumanGateInteractionPreview.violations.some((item) => item.code === "interaction_type_invalid")), true);
  const fuzzyHumanGateSelectorPreview = await runAction(root, {
    action: "workflow.v2.human_gate_request.preview",
    workflowId,
    planId: "plan-v2-kernel",
    callerAgent: "cat_claw"
  });
  assert.equal(fuzzyHumanGateSelectorPreview.eligible, false);
  assert.equal(Boolean(fuzzyHumanGateSelectorPreview.violations.some((item) => item.code === "human_gate_package_selector_required")), true);
  const humanGateRequestPreview = await runAction(root, {
    action: "workflow.v2.human_gate_request.preview",
    ...humanGateRequestInteractionInput
  });
  assert.equal(humanGateRequestPreview.schemaVersion, "workflow_v2_human_gate_request_preview.v1");
  assert.equal(humanGateRequestPreview.eligible, true);
  assert.equal(humanGateRequestPreview.writeReady, true);
  assert.equal(humanGateRequestPreview.submissionKind, "final_artifact");
  assert.equal(humanGateRequestPreview.interactionType, "artifact_acceptance");
  assert.equal(humanGateRequestPreview.responseSchema.flashcatOriginalWordsRequired, true);
  assert.equal(humanGateRequestPreview.resumeContract.approved, "archive_final_artifact");
  assert.equal(humanGateRequestPreview.resumeContract.sourcePackageId, humanGatePackage.humanGatePackage.packageId);
  assert.equal(humanGateRequestPreview.requestDraft.submissionKind, "final_artifact");
  assert.equal(humanGateRequestPreview.requestDraft.interactionType, "artifact_acceptance");
  assert.equal(humanGateRequestPreview.wouldCreate.humanGateRecords, 1);
  assert.equal(humanGateRequestPreview.wouldCreate.telegramOutbox, 1);
  assert.equal(humanGateRequestPreview.wouldCreate.runtimeDispatches, 0);
  assert.equal(humanGateRequestPreview.wouldCreate.workflowStatusUpdates, 1);
  assert.equal(humanGateRequestPreview.buttonSummary.planCount, 2);
  assert.equal(humanGateRequestPreview.buttonSummary.hasPause, true);
  assert.equal(humanGateRequestPreview.buttonSummary.hasTerminate, true);
  assert.equal(sqliteCount(dbFile, "protocol_objects", "object_type='human_gate_record'"), humanGateRequestCountsBefore.records);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons"), humanGateRequestCountsBefore.buttons);
  assert.equal(sqliteCount(dbFile, "telegram_outbox", "message_type='human_gate_request'"), humanGateRequestCountsBefore.outbox);

  const humanGateRequest = await runAction(root, {
    action: "workflow.v2.human_gate_request",
    ...humanGateRequestInteractionInput
  });
  assert.equal(humanGateRequest.schemaVersion, "workflow_v2_human_gate_request_result.v1");
  assert.equal(humanGateRequest.writeBoundary, "human_gate_request_only");
  assert.equal(humanGateRequest.submissionKind, "final_artifact");
  assert.equal(humanGateRequest.interactionType, "artifact_acceptance");
  assert.equal(humanGateRequest.resumeContract.approved, "archive_final_artifact");
  assert.equal(humanGateRequest.didEnsureHumanGate, true);
  assert.equal(humanGateRequest.didCreateHumanGate, true);
  assert.equal(humanGateRequest.didCreateHumanGateButtons, true);
  assert.equal(humanGateRequest.didEnsureTelegramOutbox, true);
  assert.equal(humanGateRequest.didCreateTelegramOutbox, true);
  assert.equal(humanGateRequest.didSendTelegram, false);
  assert.equal(humanGateRequest.didDispatchRuntime, false);
  assert.equal(humanGateRequest.didUpdateWorkflowStatus, true);
  assert.equal(humanGateRequest.didLinkPackage, true);
  assert.equal(humanGateRequest.didWritePackageLink, true);
  assert.equal(humanGateRequest.packageLinkReused, false);
  assert.ok(humanGateRequest.humanGateId);
  assert.ok(humanGateRequest.telegramOutboxId);
  assert.equal(sqliteCount(dbFile, "protocol_objects", `object_id='${humanGateRequest.humanGateId}' AND object_type='human_gate_record' AND status='pending'`), 1);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${humanGateRequest.humanGateId}' AND status='active'`), humanGateRequest.humanGateButtonCount);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${humanGateRequest.humanGateId}' AND decision_status='approved' AND status='active'`), 2);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${humanGateRequest.humanGateId}' AND button_role='pause' AND status='active'`), 1);
  assert.equal(sqliteCount(dbFile, "human_gate_buttons", `human_gate_id='${humanGateRequest.humanGateId}' AND button_role='terminate' AND status='active'`), 1);
  assert.equal(sqliteCount(dbFile, "telegram_outbox", `outbox_id='${humanGateRequest.telegramOutboxId}' AND message_type='human_gate_request' AND status='queued'`), 1);
  assert.equal(sqliteCount(dbFile, "workflow_events", `event_type='human_gate.requested' AND human_gate_id='${humanGateRequest.humanGateId}'`), 1);
  const linkedPackage = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM workflow_v2_human_gate_packages
  WHERE package_id='${humanGatePackage.humanGatePackage.packageId}'
LIMIT 1;`)[0];
  const linkedPackagePayloadJson = linkedPackage.payloadJson;
  const linkedPackagePayload = JSON.parse(linkedPackage.payloadJson);
  assert.equal(linkedPackagePayload.humanGateRequest.humanGateId, humanGateRequest.humanGateId);
  assert.equal(linkedPackagePayload.humanGateRequest.telegramOutboxId, humanGateRequest.telegramOutboxId);
  assert.equal(linkedPackagePayload.humanGateRequest.submissionKind, "final_artifact");
  assert.equal(linkedPackagePayload.humanGateRequest.interactionType, "artifact_acceptance");
  assert.equal(linkedPackagePayload.humanGateRequest.resumeContract.approved, "archive_final_artifact");
  planState = sqliteJson(dbFile, "SELECT workflow_state AS workflowState FROM workflow_v2_plans WHERE plan_id='plan-v2-kernel' LIMIT 1;")[0];
  assert.equal(planState.workflowState, "waiting_human");

  const replayedHumanGateRequest = await runAction(root, {
    action: "workflow.v2.human_gate_request",
    ...humanGateRequestInteractionInput
  });
  assert.equal(replayedHumanGateRequest.reusedStageGate, true);
  assert.equal(replayedHumanGateRequest.didCreateHumanGate, false);
  assert.equal(replayedHumanGateRequest.telegramOutboxDeduped, true);
  assert.equal(replayedHumanGateRequest.didWritePackageLink, false);
  assert.equal(replayedHumanGateRequest.packageLinkReused, true);
  assert.equal(replayedHumanGateRequest.humanGateId, humanGateRequest.humanGateId);
  assert.equal(replayedHumanGateRequest.telegramOutboxId, humanGateRequest.telegramOutboxId);
  assert.equal(sqliteCount(dbFile, "protocol_objects", `object_id='${humanGateRequest.humanGateId}' AND object_type='human_gate_record'`), 1);
  assert.equal(sqliteCount(dbFile, "telegram_outbox", `outbox_id='${humanGateRequest.telegramOutboxId}'`), 1);
  const replayedLinkedPackage = sqliteJson(dbFile, `
SELECT payload_json AS payloadJson
FROM workflow_v2_human_gate_packages
WHERE package_id='${humanGatePackage.humanGatePackage.packageId}'
LIMIT 1;`)[0];
  assert.equal(replayedLinkedPackage.payloadJson, linkedPackagePayloadJson);

  const blockedLifecycleWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    workerRunId: "worker-v2-blocked-lifecycle",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='blocked', last_error='blocked by missing upstream artifact', lease_owner='', lease_until='', updated_at='2026-07-03T00:00:03.000Z'
WHERE worker_run_id='${blockedLifecycleWorker.workerRun.workerRunId}';
UPDATE workflow_session_runs
SET status='failed', error='blocked by missing upstream artifact', updated_at='2026-07-03T00:00:03.000Z'
WHERE run_id='${blockedLifecycleWorker.workerRun.sessionRunId}';`);
  const lifecycleBlocked = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: blockedLifecycleWorker.workerRun.workerRunId
  });
  assert.equal(lifecycleBlocked.valid, true);
  assert.equal(lifecycleBlocked.recommendation.action, "escalate_to_owner");
  assert.equal(Boolean(lifecycleBlocked.signals.some((signal) => signal.code === "blocked_condition")), true);

  const humanGateLifecycleWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    workerRunId: "worker-v2-needs-human-gate-lifecycle",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false },
    payload: { outputSummary: "Worker output requires Human Gate review." }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-human-gate-lifecycle",
    workerLimit: 1,
    workerLeaseMs: 60_000
  });
  await runAction(root, {
    action: "workflow.v2.manager_review.record",
    workflowId,
    planId: "plan-v2-kernel",
    workerRunId: humanGateLifecycleWorker.workerRun.workerRunId,
    reviewerAgent: "cat_body",
    decision: "needs_human_gate",
    summary: "Worker output needs Flashcat Human Gate decision."
  });
  const lifecycleNeedsHumanGate = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: humanGateLifecycleWorker.workerRun.workerRunId
  });
  assert.equal(lifecycleNeedsHumanGate.valid, true);
  assert.equal(lifecycleNeedsHumanGate.recommendation.action, "human_gate_due");
  assert.equal(Boolean(lifecycleNeedsHumanGate.signals.some((signal) => signal.code === "human_gate_required")), true);

  const renewalWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    workerRunId: "worker-v2-renewal-source",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation({ contextBudgetTokens: 1200 }),
    contextUsedTokens: 1180,
    compactionCount: 3,
    sourceContextRefs: ["info-v2-task-input"],
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false },
    payload: { outputSummary: "Renewal source worker near context budget." }
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_body",
    capabilities: { permissions: ["workflow.worker.lifecycle"] }
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_nose",
    capabilities: { permissions: ["workflow.worker.lifecycle"] }
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_handoff.record",
      workflowId,
      workerRunId: renewalWorker.workerRun.workerRunId,
      callerAgent: "cat_nose",
      status: "accepted",
      summary: "Unauthorized handoff attempt.",
      artifactRef: "artifact://workflow-v2/unauthorized-handoff.json"
    }),
    /caller_agent_not_authorized/
  );
  const handoffPreview = await runAction(root, {
    action: "workflow.v2.worker_handoff.preview",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    handoffInfoId: "info-v2-renewal-handoff",
    status: "accepted",
    summary: "Accepted handoff package for same-class successor.",
    reason: "context pressure reached renewal threshold",
    artifactRef: "artifact://workflow-v2/renewal-handoff.json",
    sourceContextRefs: ["info-v2-task-input"],
    artifactRefs: ["artifact://workflow-v2/renewal-output.json"],
    receiptRefs: ["receipt://workflow-v2/renewal-source"]
  });
  assert.equal(handoffPreview.valid, true);
  assert.equal(handoffPreview.handoffPackage.status, "accepted");
  assert.equal(handoffPreview.infoAction, "create_info_stack_item");
  const handoffRecord = await runAction(root, {
    action: "workflow.v2.worker_handoff.record",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    handoffInfoId: "info-v2-renewal-handoff",
    status: "accepted",
    summary: "Accepted handoff package for same-class successor.",
    reason: "context pressure reached renewal threshold",
    artifactRef: "artifact://workflow-v2/renewal-handoff.json",
    sourceContextRefs: ["info-v2-task-input"],
    artifactRefs: ["artifact://workflow-v2/renewal-output.json"],
    receiptRefs: ["receipt://workflow-v2/renewal-source"]
  });
  assert.equal(handoffRecord.handoff.status, "accepted");
  let renewalSourceRow = sqliteJson(dbFile, `
SELECT status, handoff_info_id AS handoffInfoId, lease_owner AS leaseOwner, lease_until AS leaseUntil
FROM workflow_v2_worker_runs
WHERE worker_run_id='${renewalWorker.workerRun.workerRunId}';`)[0];
  assert.equal(renewalSourceRow.status, "handoff_required");
  assert.equal(renewalSourceRow.handoffInfoId, "info-v2-renewal-handoff");
  assert.equal(renewalSourceRow.leaseOwner, "");
  assert.equal(renewalSourceRow.leaseUntil, "");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_handoffs", "handoff_id='handoff-v2-renewal' AND status='accepted'"), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", "info_id='info-v2-renewal-handoff' AND worker_run_id='worker-v2-renewal-source'"), 1);
  const lifecycleAfterHandoff = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId
  });
  assert.equal(lifecycleAfterHandoff.recommendation.action, "spawn_successor");
  assert.equal(lifecycleAfterHandoff.recommendation.successorAllowed, true);

  const foreignHandoffWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    workerRunId: "worker-v2-foreign-handoff-source",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: foreignHandoffWorker.workerRun.nodeId,
    workerRunId: foreignHandoffWorker.workerRun.workerRunId,
    infoId: "info-v2-foreign-handoff-placeholder",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/foreign-handoff-placeholder.json",
    recipientAgent: "cat_body",
    summary: "Foreign handoff placeholder for validator-safe fixture."
  });
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='handoff_required', handoff_info_id='info-v2-foreign-handoff-placeholder', completed_at='2026-07-03T00:00:10.000Z', updated_at='2026-07-03T00:00:10.000Z'
WHERE worker_run_id='${foreignHandoffWorker.workerRun.workerRunId}';
UPDATE workflow_session_runs
SET status='completed', completed_at='2026-07-03T00:00:10.000Z', updated_at='2026-07-03T00:00:10.000Z'
WHERE run_id='${foreignHandoffWorker.workerRun.sessionRunId}';`);
  const foreignHandoffPreview = await runAction(root, {
    action: "workflow.v2.worker_handoff.preview",
    workflowId,
    workerRunId: foreignHandoffWorker.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    handoffInfoId: "info-v2-foreign-handoff-attempt",
    status: "accepted",
    summary: "Preview must reject another worker handoff id.",
    reason: "foreign handoff preview guard",
    artifactRef: "artifact://workflow-v2/foreign-handoff-attempt.json"
  });
  assert.equal(foreignHandoffPreview.valid, false);
  assert.equal(Boolean(foreignHandoffPreview.errors.some((item) => item.code === "handoff_id_conflict")), true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_retire.record",
      workflowId,
      workerRunId: foreignHandoffWorker.workerRun.workerRunId,
      callerAgent: "cat_body",
      handoffId: "handoff-v2-renewal",
      reason: "must not retire with another worker handoff"
    }),
    /handoff_not_found_for_worker/
  );
  const foreignSuccessorPreview = await runAction(root, {
    action: "workflow.v2.worker_successor.preview",
    workflowId,
    sourceWorkerRunId: foreignHandoffWorker.workerRun.workerRunId,
    successorWorkerRunId: "worker-v2-foreign-handoff-successor",
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  assert.equal(foreignSuccessorPreview.valid, false);
  assert.equal(Boolean(foreignSuccessorPreview.errors.some((item) => item.code === "handoff_not_found_for_worker")), true);

  const staleHandoffWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    workerRunId: "worker-v2-stale-handoff-cas",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  sqliteExec(dbFile, `
CREATE TRIGGER trigger_v2_stale_handoff_cas
AFTER INSERT ON workflow_v2_worker_handoffs
WHEN NEW.handoff_id='handoff-v2-stale-cas'
BEGIN
  UPDATE workflow_v2_worker_runs
  SET status='cancelled', updated_at='2026-07-03T00:00:11.000Z'
  WHERE worker_run_id=NEW.worker_run_id;
END;`);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_handoff.record",
      workflowId,
      workerRunId: staleHandoffWorker.workerRun.workerRunId,
      callerAgent: "cat_body",
      handoffId: "handoff-v2-stale-cas",
      handoffInfoId: "info-v2-stale-cas-handoff",
      status: "accepted",
      summary: "This handoff should hit commit-time CAS.",
      reason: "simulate concurrent state drift",
      artifactRef: "artifact://workflow-v2/stale-cas-handoff.json"
    }),
    /lost worker row before update/
  );
  sqliteExec(dbFile, `DROP TRIGGER trigger_v2_stale_handoff_cas;`);
  const staleHandoffRow = sqliteJson(dbFile, `
SELECT status, handoff_info_id AS handoffInfoId
FROM workflow_v2_worker_runs
WHERE worker_run_id='${staleHandoffWorker.workerRun.workerRunId}';`)[0];
  assert.equal(staleHandoffRow.status, "queued");
  assert.equal(staleHandoffRow.handoffInfoId, "");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_handoffs", "handoff_id='handoff-v2-stale-cas'"), 0);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", "info_id='info-v2-stale-cas-handoff'"), 0);
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='cancelled', completed_at='2026-07-03T00:00:11.500Z', updated_at='2026-07-03T00:00:11.500Z'
WHERE worker_run_id='${staleHandoffWorker.workerRun.workerRunId}';
UPDATE workflow_session_runs
SET status='cancelled', completed_at='2026-07-03T00:00:11.500Z', updated_at='2026-07-03T00:00:11.500Z'
WHERE run_id='${staleHandoffWorker.workerRun.sessionRunId}';`);

  const retireRecord = await runAction(root, {
    action: "workflow.v2.worker_retire.record",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-renewal",
    reason: "retire source after accepted handoff before successor spawn"
  });
  assert.equal(retireRecord.nextStatus, "retired");
  renewalSourceRow = sqliteJson(dbFile, `
SELECT status, handoff_info_id AS handoffInfoId, lease_owner AS leaseOwner, lease_until AS leaseUntil
FROM workflow_v2_worker_runs
WHERE worker_run_id='${renewalWorker.workerRun.workerRunId}';`)[0];
  assert.equal(renewalSourceRow.status, "retired");
  assert.equal(renewalSourceRow.handoffInfoId, "info-v2-renewal-handoff");
  assert.equal(renewalSourceRow.leaseOwner, "");
  assert.equal(renewalSourceRow.leaseUntil, "");
  const lifecycleAfterRetire = await runAction(root, {
    action: "workflow.v2.worker_lifecycle.preview",
    workflowId,
    workerRunId: renewalWorker.workerRun.workerRunId
  });
  assert.equal(lifecycleAfterRetire.recommendation.action, "spawn_successor");

  const successorPreview = await runAction(root, {
    action: "workflow.v2.worker_successor.preview",
    workflowId,
    sourceWorkerRunId: renewalWorker.workerRun.workerRunId,
    successorWorkerRunId: "worker-v2-renewal-successor",
    callerAgent: "cat_body",
    nextRetryAt: "2999-01-01T00:00:00.000Z",
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  assert.equal(successorPreview.valid, true);
  assert.equal(successorPreview.successorWorkerRun.workerRunId, "worker-v2-renewal-successor");
  assert.equal(successorPreview.successorWorkerRun.parentWorkerRunId, renewalWorker.workerRun.workerRunId);
  assert.equal(successorPreview.successorWorkerRun.supersedesWorkerRunId, renewalWorker.workerRun.workerRunId);
  assert.equal(successorPreview.successorWorkerRun.taskInputInfoId, "info-v2-renewal-handoff");
  assert.equal(successorPreview.successorWorkerRun.workerGeneration, renewalWorker.workerRun.workerGeneration + 1);
  const successorCreate = await runAction(root, {
    action: "workflow.v2.worker_successor.create",
    workflowId,
    sourceWorkerRunId: renewalWorker.workerRun.workerRunId,
    successorWorkerRunId: "worker-v2-renewal-successor",
    callerAgent: "cat_body",
    nextRetryAt: "2999-01-01T00:00:00.000Z",
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  assert.equal(successorCreate.spawnResult.workerRun.status, "queued");
  renewalSourceRow = sqliteJson(dbFile, `
SELECT status, successor_worker_run_id AS successorWorkerRunId
FROM workflow_v2_worker_runs
WHERE worker_run_id='${renewalWorker.workerRun.workerRunId}';`)[0];
  assert.equal(renewalSourceRow.status, "successor_spawned");
  assert.equal(renewalSourceRow.successorWorkerRunId, "worker-v2-renewal-successor");
  const renewalSuccessorRow = sqliteJson(dbFile, `
SELECT status, parent_worker_run_id AS parentWorkerRunId, supersedes_worker_run_id AS supersedesWorkerRunId, worker_generation AS workerGeneration, task_input_info_id AS taskInputInfoId, next_retry_at AS nextRetryAt, source_context_refs_json AS sourceContextRefsJson
FROM workflow_v2_worker_runs
WHERE worker_run_id='worker-v2-renewal-successor';`)[0];
  assert.equal(renewalSuccessorRow.status, "queued");
  assert.equal(renewalSuccessorRow.parentWorkerRunId, renewalWorker.workerRun.workerRunId);
  assert.equal(renewalSuccessorRow.supersedesWorkerRunId, renewalWorker.workerRun.workerRunId);
  assert.equal(Number(renewalSuccessorRow.workerGeneration), renewalWorker.workerRun.workerGeneration + 1);
  assert.equal(renewalSuccessorRow.taskInputInfoId, "info-v2-renewal-handoff");
  assert.equal(renewalSuccessorRow.nextRetryAt, "2999-01-01T00:00:00.000Z");
  assert.equal(JSON.parse(renewalSuccessorRow.sourceContextRefsJson).includes("info-v2-renewal-handoff"), true);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_handoffs", "handoff_id='handoff-v2-renewal' AND status='superseded' AND successor_worker_run_id='worker-v2-renewal-successor'"), 1);
  const renewalSourceSession = sqliteJson(dbFile, `
SELECT status
FROM workflow_session_runs
WHERE run_id='${renewalWorker.workerRun.sessionRunId}';`)[0];
  assert.equal(renewalSourceSession.status, "completed");

  const staleSuccessorSource = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    workerRunId: "worker-v2-stale-successor-source",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.worker_handoff.record",
    workflowId,
    workerRunId: staleSuccessorSource.workerRun.workerRunId,
    callerAgent: "cat_body",
    handoffId: "handoff-v2-stale-successor",
    handoffInfoId: "info-v2-stale-successor-handoff",
    status: "accepted",
    summary: "Accepted handoff for stale successor CAS.",
    reason: "prepare successor CAS fixture",
    artifactRef: "artifact://workflow-v2/stale-successor-handoff.json"
  });
  sqliteExec(dbFile, `
CREATE TRIGGER trigger_v2_stale_successor_cas
AFTER INSERT ON workflow_v2_worker_runs
WHEN NEW.worker_run_id='worker-v2-stale-successor-candidate'
BEGIN
  UPDATE workflow_v2_worker_runs
  SET status='cancelled', updated_at='2026-07-03T00:00:12.000Z'
  WHERE worker_run_id='${staleSuccessorSource.workerRun.workerRunId}';
END;`);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_successor.create",
      workflowId,
      sourceWorkerRunId: staleSuccessorSource.workerRun.workerRunId,
      successorWorkerRunId: "worker-v2-stale-successor-candidate",
      callerAgent: "cat_body",
      providerModel: "openai-codex/gpt-5.5",
      receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
      oauth: { expiryOk: true, refreshOk: true },
      network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
    }),
    /lost source worker before update/
  );
  sqliteExec(dbFile, `DROP TRIGGER trigger_v2_stale_successor_cas;`);
  const staleSuccessorSourceRow = sqliteJson(dbFile, `
SELECT status, successor_worker_run_id AS successorWorkerRunId
FROM workflow_v2_worker_runs
WHERE worker_run_id='${staleSuccessorSource.workerRun.workerRunId}';`)[0];
  assert.equal(staleSuccessorSourceRow.status, "handoff_required");
  assert.equal(staleSuccessorSourceRow.successorWorkerRunId, "");
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_handoffs", "handoff_id='handoff-v2-stale-successor' AND status='accepted' AND successor_worker_run_id=''"), 1);
  assert.equal(sqliteCount(dbFile, "workflow_v2_worker_runs", "worker_run_id='worker-v2-stale-successor-candidate'"), 0);

  const validation = await runAction(root, {
    action: "workflow.v2.validate",
    workflowId
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.status, "pass");
  assert.equal(Boolean(validation.checks.some((check) => check.checkId === "worker_handoffs_match_worker_runs" && check.status === "pass")), true);

  const badSessionWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    sessionId: "session-cat-body-worker",
    workerRunId: "worker-v2-bad-session-claim",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false },
    payload: { outputSummary: "This worker should not block the next worker when its session is missing." }
  });
  const healthyAfterBadWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    workerRunId: "worker-v2-after-bad-session",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false },
    payload: { outputSummary: "Healthy worker after a bad session sync." }
  });
  sqliteExec(dbFile, `
DELETE FROM workflow_agent_runs WHERE session_run_id='${badSessionWorker.workerRun.sessionRunId}';
DELETE FROM workflow_session_runs WHERE run_id='${badSessionWorker.workerRun.sessionRunId}';`);
  const badSessionTick = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-bad-session-isolation",
    workerLimit: 2,
    workerLeaseMs: 60_000
  });
  assert.equal(Boolean(badSessionTick.workerResults.some((item) => item.workerRunId === badSessionWorker.workerRun.workerRunId && item.status === "session_sync_failed")), true);
  assert.equal(Boolean(badSessionTick.workerResults.some((item) => item.workerRunId === healthyAfterBadWorker.workerRun.workerRunId && item.status === "submitted_for_review")), true);
  const badSessionRow = sqliteJson(dbFile, `SELECT status, attempt, lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${badSessionWorker.workerRun.workerRunId}';`)[0];
  assert.equal(badSessionRow.status, "queued");
  assert.equal(badSessionRow.attempt, 0);
  assert.equal(badSessionRow.leaseOwner, "");
  assert.equal(badSessionRow.leaseUntil, "");
  sqliteExec(dbFile, `DELETE FROM workflow_v2_worker_runs WHERE worker_run_id='${badSessionWorker.workerRun.workerRunId}';`);

  const submitSyncFailWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_nose",
    workerRunId: "worker-v2-submit-session-sync-fail",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-submit-sync-fail",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-03T00:00:00.000Z"
  });
  const submitSyncFailLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${submitSyncFailWorker.workerRun.workerRunId}';`)[0];
  sqliteExec(dbFile, `
DELETE FROM workflow_agent_runs WHERE session_run_id='${submitSyncFailWorker.workerRun.sessionRunId}';
DELETE FROM workflow_session_runs WHERE run_id='${submitSyncFailWorker.workerRun.sessionRunId}';`);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_result.submit",
      workerRunId: submitSyncFailWorker.workerRun.workerRunId,
      leaseOwner: submitSyncFailLease.leaseOwner,
      leaseUntil: submitSyncFailLease.leaseUntil,
      generatedAt: "2026-07-03T00:00:30.000Z",
      outputInfoId: "info-v2-submit-sync-fail-output",
      artifactRef: "artifact://workflow-v2/submit-sync-fail-output.json",
      receipt: { adapter: "hermers", status: "completed" },
      summary: "This output must be cleaned up when session patch fails."
    }),
    /session run patch failed/
  );
  const restoredSubmitSyncFail = sqliteJson(dbFile, `SELECT status, output_info_id AS outputInfoId, receipt_ref AS receiptRef, lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${submitSyncFailWorker.workerRun.workerRunId}';`)[0];
  assert.equal(restoredSubmitSyncFail.status, "running");
  assert.equal(restoredSubmitSyncFail.outputInfoId, "");
  assert.equal(restoredSubmitSyncFail.receiptRef, "");
  assert.equal(restoredSubmitSyncFail.leaseOwner, submitSyncFailLease.leaseOwner);
  assert.equal(restoredSubmitSyncFail.leaseUntil, submitSyncFailLease.leaseUntil);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", "info_id='info-v2-submit-sync-fail-output'"), 0);
  sqliteExec(dbFile, `DELETE FROM workflow_v2_worker_runs WHERE worker_run_id='${submitSyncFailWorker.workerRun.workerRunId}';`);

  const adapterWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_nose",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  const adapterClaim = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-adapter",
    workerLimit: 1,
    workerLeaseMs: 1_000,
    generatedAt: "2026-07-03T00:00:00.000Z"
  });
  assert.equal(adapterClaim.workerResults[0].status, "leased_waiting_adapter");
  let adapterRow = sqliteJson(dbFile, `SELECT status, attempt, lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${adapterWorker.workerRun.workerRunId}';`)[0];
  assert.equal(adapterRow.status, "running");
  assert.equal(adapterRow.attempt, 1);
  assert.equal(adapterRow.leaseOwner, "test-v2-adapter");
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_adapter_job.record",
      workerRunId: adapterWorker.workerRun.workerRunId,
      leaseOwner: "wrong-owner",
      leaseUntil: adapterRow.leaseUntil,
      generatedAt: "2026-07-03T00:00:00.500Z"
    }),
    /lease_owner_mismatch/
  );
  const adapterJobPreview = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.preview",
    workerRunId: adapterWorker.workerRun.workerRunId,
    leaseOwner: adapterRow.leaseOwner,
    leaseUntil: adapterRow.leaseUntil,
    generatedAt: "2026-07-03T00:00:00.500Z"
  });
  assert.equal(adapterJobPreview.valid, true);
  assert.equal(adapterJobPreview.manifest.schemaVersion, "workflow_v2_worker_adapter_job.v1");
  assert.equal(adapterJobPreview.manifest.backend.hostAlias, "wsl-agents");
  assert.equal(adapterJobPreview.manifest.backend.image, "flashcat/hermes-worker:20260704");
  assert.equal(adapterJobPreview.manifest.backend.returnPath.directDatabaseWritesAllowed, false);
  assert.equal(adapterJobPreview.manifest.context.hardLimitTokens, 64000);
  assert.equal(adapterJobPreview.manifest.output.submitAction, "workflow.v2.worker_result.submit");
  assert.equal(adapterJobPreview.manifest.output.failAction, "workflow.v2.worker_result.fail");
  assert.equal(adapterJobPreview.manifest.sessionInput.input.workerRunId, adapterWorker.workerRun.workerRunId);
  const adapterJobRecord = await runAction(root, {
    action: "workflow.v2.worker_adapter_job.record",
    workerRunId: adapterWorker.workerRun.workerRunId,
    leaseOwner: adapterRow.leaseOwner,
    leaseUntil: adapterRow.leaseUntil,
    generatedAt: "2026-07-03T00:00:00.500Z"
  });
  assert.equal(adapterJobRecord.valid, true);
  assert.equal(adapterJobRecord.operation, "workflow.v2.worker_adapter_job.record");
  const adapterJobManifest = JSON.parse(await fs.readFile(adapterJobRecord.artifact.artifactFile, "utf8"));
  assert.equal(adapterJobManifest.adapterJobId, adapterJobRecord.adapterJobId);
  assert.equal(adapterJobManifest.workerRunId, adapterWorker.workerRun.workerRunId);
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", `info_id='${adapterJobRecord.adapterJobInfo.infoId}' AND worker_run_id='${adapterWorker.workerRun.workerRunId}'`), 1);
  adapterRow = sqliteJson(dbFile, `SELECT status, lease_owner AS leaseOwner, lease_until AS leaseUntil, payload_json AS payloadJson FROM workflow_v2_worker_runs WHERE worker_run_id='${adapterWorker.workerRun.workerRunId}';`)[0];
  assert.equal(adapterRow.status, "running");
  assert.equal(adapterRow.leaseOwner, "test-v2-adapter");
  assert.equal(adapterRow.leaseUntil, adapterJobRecord.workerRun.leaseUntil);
  const adapterPayload = JSON.parse(adapterRow.payloadJson || "{}");
  assert.equal(adapterPayload.adapterJob.adapterJobInfoId, adapterJobRecord.adapterJobInfo.infoId);
  assert.equal(adapterPayload.adapterJob.artifactRef, adapterJobRecord.artifact.artifactRef);

  const adapterRetry = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-adapter",
    retryDelayMs: 60_000,
    generatedAt: "2026-07-03T00:00:02.000Z"
  });
  assert.equal(adapterRetry.expiredLeases[0].status, "retry_scheduled");
  adapterRow = sqliteJson(dbFile, `SELECT status, attempt, next_retry_at AS nextRetryAt, lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${adapterWorker.workerRun.workerRunId}';`)[0];
  assert.equal(adapterRow.status, "retry_scheduled");
  assert.equal(adapterRow.attempt, 1);
  assert.equal(adapterRow.leaseOwner, "");
  assert.equal(adapterRow.leaseUntil, "");
  assert.ok(adapterRow.nextRetryAt);

  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-adapter-second",
    workerLimit: 1,
    workerLeaseMs: 1_000,
    generatedAt: "2026-07-03T00:01:03.000Z"
  });
  const adapterTimeout = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-adapter-second",
    generatedAt: "2026-07-03T00:01:05.000Z"
  });
  assert.equal(adapterTimeout.expiredLeases[0].status, "timed_out");
  adapterRow = sqliteJson(dbFile, `SELECT status, attempt, completed_at AS completedAt, last_error AS lastError FROM workflow_v2_worker_runs WHERE worker_run_id='${adapterWorker.workerRun.workerRunId}';`)[0];
  assert.equal(adapterRow.status, "timed_out");
  assert.equal(adapterRow.attempt, 2);
  assert.ok(adapterRow.completedAt);
  assert.match(adapterRow.lastError, /lease expired/);

  const submitWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_nose",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  const submitClaim = await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-submit",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-03T00:02:00.000Z"
  });
  assert.equal(submitClaim.workerResults[0].status, "leased_waiting_adapter");
  const submitLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${submitWorker.workerRun.workerRunId}';`)[0];
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_result.submit",
      workerRunId: submitWorker.workerRun.workerRunId,
      leaseOwner: "wrong-owner",
      leaseUntil: submitLease.leaseUntil,
      generatedAt: "2026-07-03T00:02:30.000Z",
      artifactRef: "artifact://workflow-v2/submit-output.json",
      receipt: { adapter: "hermers", status: "completed" },
      summary: "Adapter output."
    }),
    /lease_owner_mismatch/
  );
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    infoId: "info-v2-foreign-output",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/foreign-output.json",
    recipientAgent: "cat_nose",
    summary: "Foreign worker output that must not be overwritten."
  });
  const submitConflictPreview = await runAction(root, {
    action: "workflow.v2.worker_result.submit.preview",
    workerRunId: submitWorker.workerRun.workerRunId,
    leaseOwner: submitLease.leaseOwner,
    leaseUntil: submitLease.leaseUntil,
    generatedAt: "2026-07-03T00:02:30.000Z",
    outputInfoId: "info-v2-foreign-output",
    artifactRef: "artifact://workflow-v2/submit-output.json",
    receipt: { adapter: "hermers", status: "completed" },
    summary: "Adapter output."
  });
  assert.equal(submitConflictPreview.valid, false);
  assert.equal(Boolean(submitConflictPreview.errors.some((item) => item.code === "output_info_id_conflict")), true);
  await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId,
    infoId: "info-v2-same-worker-stale-output",
    workerRunId: submitWorker.workerRun.workerRunId,
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/same-worker-stale-output.json",
    recipientAgent: "cat_nose",
    summary: "Same worker stale output pointer that must not be overwritten before row binding."
  });
  const submitSameRunConflictPreview = await runAction(root, {
    action: "workflow.v2.worker_result.submit.preview",
    workerRunId: submitWorker.workerRun.workerRunId,
    leaseOwner: submitLease.leaseOwner,
    leaseUntil: submitLease.leaseUntil,
    generatedAt: "2026-07-03T00:02:30.000Z",
    outputInfoId: "info-v2-same-worker-stale-output",
    artifactRef: "artifact://workflow-v2/submit-output.json",
    receipt: { adapter: "hermers", status: "completed" },
    summary: "Adapter output."
  });
  assert.equal(submitSameRunConflictPreview.valid, false);
  assert.equal(Boolean(submitSameRunConflictPreview.errors.some((item) => item.code === "output_info_id_conflict")), true);
  const submitPreview = await runAction(root, {
    action: "workflow.v2.worker_result.submit.preview",
    workerRunId: submitWorker.workerRun.workerRunId,
    leaseOwner: submitLease.leaseOwner,
    leaseUntil: submitLease.leaseUntil,
    generatedAt: "2026-07-03T00:02:30.000Z",
    artifactRef: "artifact://workflow-v2/submit-output.json",
    receipt: { adapter: "hermers", status: "completed" },
    summary: "Adapter output."
  });
  assert.equal(submitPreview.valid, true);
  const submitResult = await runAction(root, {
    action: "workflow.v2.worker_result.submit",
    workerRunId: submitWorker.workerRun.workerRunId,
    leaseOwner: submitLease.leaseOwner,
    leaseUntil: submitLease.leaseUntil,
    generatedAt: "2026-07-03T00:02:30.000Z",
    artifactRef: "artifact://workflow-v2/submit-output.json",
    receipt: { adapter: "hermers", status: "completed" },
    summary: "Adapter output."
  });
  assert.equal(submitResult.valid, true);
  let submitRow = sqliteJson(dbFile, `SELECT status, output_info_id AS outputInfoId, receipt_ref AS receiptRef, lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${submitWorker.workerRun.workerRunId}';`)[0];
  assert.equal(submitRow.status, "submitted_for_review");
  assert.ok(submitRow.outputInfoId);
  assert.ok(submitRow.receiptRef);
  assert.equal(submitRow.leaseOwner, "");
  assert.equal(submitRow.leaseUntil, "");
  assert.equal(sqliteCount(dbFile, "workflow_v2_info_items", `info_id='${submitRow.outputInfoId}' AND worker_run_id='${submitWorker.workerRun.workerRunId}'`), 1);

  const failWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_nose",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 2,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-fail",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-03T00:03:00.000Z"
  });
  let failLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${failWorker.workerRun.workerRunId}';`)[0];
  const failPreview = await runAction(root, {
    action: "workflow.v2.worker_result.fail.preview",
    workerRunId: failWorker.workerRun.workerRunId,
    leaseOwner: failLease.leaseOwner,
    leaseUntil: failLease.leaseUntil,
    error: "temporary adapter failure",
    retryDelayMs: 60_000,
    generatedAt: "2026-07-03T00:03:05.000Z"
  });
  assert.equal(failPreview.valid, true);
  assert.equal(failPreview.retry, true);
  assert.equal(failPreview.nextStatus, "retry_scheduled");
  await runAction(root, {
    action: "workflow.v2.worker_result.fail",
    workerRunId: failWorker.workerRun.workerRunId,
    leaseOwner: failLease.leaseOwner,
    leaseUntil: failLease.leaseUntil,
    error: "temporary adapter failure",
    retryDelayMs: 60_000,
    generatedAt: "2026-07-03T00:03:05.000Z"
  });
  let failRow = sqliteJson(dbFile, `SELECT status, attempt, next_retry_at AS nextRetryAt, lease_owner AS leaseOwner, lease_until AS leaseUntil, completed_at AS completedAt, last_error AS lastError FROM workflow_v2_worker_runs WHERE worker_run_id='${failWorker.workerRun.workerRunId}';`)[0];
  assert.equal(failRow.status, "retry_scheduled");
  assert.equal(failRow.attempt, 1);
  assert.ok(failRow.nextRetryAt);
  assert.equal(failRow.leaseOwner, "");
  assert.equal(failRow.leaseUntil, "");
  assert.equal(failRow.completedAt, "");
  assert.match(failRow.lastError, /temporary adapter failure/);

  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-fail-second",
    workerLimit: 1,
    workerLeaseMs: 60_000,
    generatedAt: "2026-07-03T00:04:06.000Z"
  });
  failLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${failWorker.workerRun.workerRunId}';`)[0];
  const failClaimedRow = sqliteJson(dbFile, `SELECT last_error AS lastError FROM workflow_v2_worker_runs WHERE worker_run_id='${failWorker.workerRun.workerRunId}';`)[0];
  assert.match(failClaimedRow.lastError, /temporary adapter failure/);
  await runAction(root, {
    action: "workflow.v2.worker_result.fail",
    workerRunId: failWorker.workerRun.workerRunId,
    leaseOwner: failLease.leaseOwner,
    leaseUntil: failLease.leaseUntil,
    error: "permanent adapter failure",
    retryDelayMs: 60_000,
    generatedAt: "2026-07-03T00:04:10.000Z"
  });
  failRow = sqliteJson(dbFile, `SELECT status, attempt, next_retry_at AS nextRetryAt, completed_at AS completedAt, last_error AS lastError FROM workflow_v2_worker_runs WHERE worker_run_id='${failWorker.workerRun.workerRunId}';`)[0];
  assert.equal(failRow.status, "failed");
  assert.equal(failRow.attempt, 2);
  assert.equal(failRow.nextRetryAt, "");
  assert.ok(failRow.completedAt);
  assert.match(failRow.lastError, /permanent adapter failure/);

  const noOutputWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      workerRunId: noOutputWorker.workerRun.workerRunId,
      reviewerAgent: "cat_body",
      decision: "accepted",
      summary: "This should not accept because no worker output exists."
    }),
    /requires worker status submitted_for_review/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_manager_reviews", `worker_run_id='${noOutputWorker.workerRun.workerRunId}' AND decision='accepted'`), 0);
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='cancelled', updated_at='2026-07-03T00:00:00.000Z'
WHERE worker_run_id='${noOutputWorker.workerRun.workerRunId}';`);
  sqliteExec(dbFile, `
UPDATE workflow_session_runs
SET status='cancelled', updated_at='2026-07-03T00:00:00.000Z', completed_at='2026-07-03T00:00:00.000Z'
WHERE run_id='${noOutputWorker.workerRun.sessionRunId}';`);

  const blockedWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      workerRunId: blockedWorker.workerRun.workerRunId,
      reviewerAgent: "cat_body",
      decision: "blocked",
      summary: "Manager blocks this worker before runtime dispatch."
    }),
    /manager review decision blocked is not allowed/
  );
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.manager_review.record",
      workflowId,
      planId: "plan-v2-kernel",
      workerRunId: blockedWorker.workerRun.workerRunId,
      reviewerAgent: "cat_body",
      decision: "BLOCKED",
      summary: "Case-variant blocked decision must also be rejected."
    }),
    /manager review decision blocked is not allowed/
  );
  assert.equal(sqliteCount(dbFile, "workflow_v2_manager_reviews", `worker_run_id='${blockedWorker.workerRun.workerRunId}' AND decision='blocked'`), 0);
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='blocked', last_error='worker lifecycle blocker', updated_at='2026-07-03T00:10:00.000Z'
WHERE worker_run_id='${blockedWorker.workerRun.workerRunId}';`);
  sqliteExec(dbFile, `
UPDATE workflow_session_runs
SET status='failed', error='worker lifecycle blocker', completed_at='2026-07-03T00:10:01.000Z', updated_at='2026-07-03T00:10:01.000Z'
WHERE run_id='${blockedWorker.workerRun.sessionRunId}';`);

  const reviseWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_body",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "local_deterministic",
    ...v2WorkerDelegation(),
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false },
    payload: { outputSummary: "Worker output intentionally needs revision." }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-revise",
    workerLimit: 1
  });
  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET lease_owner='stale-review-lease', lease_until='2026-07-03T00:00:00.000Z'
WHERE worker_run_id='${reviseWorker.workerRun.workerRunId}';`);
  await runAction(root, {
    action: "workflow.v2.manager_review.record",
    workflowId,
    planId: "plan-v2-kernel",
    workerRunId: reviseWorker.workerRun.workerRunId,
    reviewerAgent: "cat_body",
    decision: "revise_required",
    summary: "Manager requires revision."
  });
  const reviseRow = sqliteJson(dbFile, `SELECT status, lease_owner AS leaseOwner, lease_until AS leaseUntil, last_error AS lastError FROM workflow_v2_worker_runs WHERE worker_run_id='${reviseWorker.workerRun.workerRunId}';`)[0];
  assert.equal(reviseRow.status, "revise_required");
  assert.equal(reviseRow.leaseOwner, "");
  assert.equal(reviseRow.leaseUntil, "");
  assert.match(reviseRow.lastError, /requires revision/);

  const expiredSubmitWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_nose",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 1,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-expired-submit",
    workerLimit: 1,
    workerLeaseMs: 1000,
    generatedAt: "2026-07-03T00:10:00.000Z"
  });
  const expiredSubmitLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${expiredSubmitWorker.workerRun.workerRunId}';`)[0];
  const expiredSubmitPreview = await runAction(root, {
    action: "workflow.v2.worker_result.submit.preview",
    workerRunId: expiredSubmitWorker.workerRun.workerRunId,
    leaseOwner: expiredSubmitLease.leaseOwner,
    leaseUntil: expiredSubmitLease.leaseUntil,
    generatedAt: "2026-07-03T00:10:02.000Z",
    artifactRef: "artifact://workflow-v2/expired-submit-output.json",
    receipt: { adapter: "hermers", status: "completed_after_expiry" },
    summary: "Expired submit must be rejected."
  });
  assert.equal(expiredSubmitPreview.valid, false);
  assert.equal(Boolean(expiredSubmitPreview.errors.some((item) => item.code === "lease_expired")), true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_result.submit",
      workerRunId: expiredSubmitWorker.workerRun.workerRunId,
      leaseOwner: expiredSubmitLease.leaseOwner,
      leaseUntil: expiredSubmitLease.leaseUntil,
      generatedAt: "2026-07-03T00:10:02.000Z",
      artifactRef: "artifact://workflow-v2/expired-submit-output.json",
      receipt: { adapter: "hermers", status: "completed_after_expiry" },
      summary: "Expired submit must be rejected."
    }),
    /lease_expired/
  );

  const expiredFailWorker = await runAction(root, {
    action: "workflow.v2.worker_spawn.create",
    workflowId,
    planId: "plan-v2-kernel",
    nodeId: plan.nodes.find((node) => node.nodeType === "manager_worker_spawn").nodeId,
    managerAgent: "cat_nose",
    sessionId: "session-cat-body-worker",
    taskInputInfoId: "info-v2-task-input",
    runtimeBackend: "hermers_docker_worker",
    ...v2WorkerDelegation(),
    maxAttempts: 1,
    providerModel: "openai-codex/gpt-5.5",
    receipt: { provider: "openai-codex", model: "gpt-5.5", fallbackAttempts: 0, errorCode: "" },
    oauth: { expiryOk: true, refreshOk: true },
    network: { hostOnlyTailscale: true, wslTailscaledActive: false, directContainerPortExposed: false }
  });
  await runAction(root, {
    action: "workflow.v2.control_loop.tick",
    workflowId,
    claimOwner: "test-v2-expired-fail",
    workerLimit: 1,
    workerLeaseMs: 1000,
    generatedAt: "2026-07-03T00:11:00.000Z"
  });
  const expiredFailLease = sqliteJson(dbFile, `SELECT lease_owner AS leaseOwner, lease_until AS leaseUntil FROM workflow_v2_worker_runs WHERE worker_run_id='${expiredFailWorker.workerRun.workerRunId}';`)[0];
  const expiredFailPreview = await runAction(root, {
    action: "workflow.v2.worker_result.fail.preview",
    workerRunId: expiredFailWorker.workerRun.workerRunId,
    leaseOwner: expiredFailLease.leaseOwner,
    leaseUntil: expiredFailLease.leaseUntil,
    generatedAt: "2026-07-03T00:11:02.000Z",
    error: "expired failure report"
  });
  assert.equal(expiredFailPreview.valid, false);
  assert.equal(Boolean(expiredFailPreview.errors.some((item) => item.code === "lease_expired")), true);
  await assertRejectsMessage(
    () => runAction(root, {
      action: "workflow.v2.worker_result.fail",
      workerRunId: expiredFailWorker.workerRun.workerRunId,
      leaseOwner: expiredFailLease.leaseOwner,
      leaseUntil: expiredFailLease.leaseUntil,
      generatedAt: "2026-07-03T00:11:02.000Z",
      error: "expired failure report"
    }),
    /lease_expired/
  );

  const finalValid = await runAction(root, {
    action: "workflow.v2.validate",
    workflowId
  });
  assert.equal(finalValid.ok, true);
  assert.equal(finalValid.status, "pass");

  sqliteExec(dbFile, `
INSERT INTO workflow_v2_manager_reviews(review_id, workflow_id, plan_id, node_id, worker_run_id, reviewer_agent, decision, summary, findings_json, artifact_refs_json, receipt_refs_json, blocker_json, payload_json, created_at)
VALUES ('review-v2-orphan-manager', '${workflowId}', 'plan-v2-kernel', '${worker.workerRun.nodeId}', '', 'cat_body', 'accepted', 'Validator should reject unbound manager reviews.', '[]', '[]', '[]', '{}', '{}', '2026-07-03T00:11:30.000Z');`);
  const invalidOrphanManagerReview = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidOrphanManagerReview.ok, false);
  assert.equal(Boolean(invalidOrphanManagerReview.failedChecks.includes("manager_reviews_match_worker_runs")), true);
  sqliteExec(dbFile, `DELETE FROM workflow_v2_manager_reviews WHERE review_id='review-v2-orphan-manager';`);

  sqliteExec(dbFile, `
INSERT INTO workflow_session_runs(run_id, session_id, pack_version, workflow_id, task_id, dispatch_id, worker_id, status, input_json, worker_input_json, output_json, receipt_ref, error, started_at, completed_at, created_at, updated_at)
VALUES ('session-v2-bad-json-input', 'session-cat-body-worker', 1, '${workflowId}', 'bad-json-node', '', 'bad-json-worker', 'queued', '{bad-json', '{}', '{}', '', '', '', '', '2026-07-03T00:11:35.000Z', '2026-07-03T00:11:35.000Z');`);
  const invalidBadSessionJson = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidBadSessionJson.ok, false);
  assert.equal(Boolean(invalidBadSessionJson.failedChecks.includes("v2_session_runs_have_worker_runs")), true);
  sqliteExec(dbFile, `DELETE FROM workflow_session_runs WHERE run_id='session-v2-bad-json-input';`);

  sqliteExec(dbFile, `
UPDATE workflow_v2_worker_runs
SET status='blocked', last_error='worker lifecycle blocker', updated_at='2026-07-03T00:11:59.000Z'
WHERE worker_run_id='${blockedWorker.workerRun.workerRunId}';`);
  sqliteExec(dbFile, `
UPDATE workflow_session_runs
SET status='queued', error='', completed_at='', updated_at='2026-07-03T00:12:00.000Z'
WHERE run_id='${blockedWorker.workerRun.sessionRunId}';`);
  const invalidBlockedDrift = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidBlockedDrift.ok, false);
  assert.equal(Boolean(invalidBlockedDrift.failedChecks.includes("worker_runs_session_runs_match")), true);
  sqliteExec(dbFile, `
UPDATE workflow_session_runs
SET status='failed', error='worker lifecycle blocker', completed_at='2026-07-03T00:12:01.000Z', updated_at='2026-07-03T00:12:01.000Z'
WHERE run_id='${blockedWorker.workerRun.sessionRunId}';`);

  sqliteExec(dbFile, `
  INSERT INTO workflow_v2_worker_runs(worker_run_id, workflow_id, plan_id, node_id, manager_agent, worker_agent_id, session_id, session_run_id, runtime_backend, status, task_input_info_id, output_info_id, receipt_ref, payload_json, created_at, updated_at)
  VALUES ('worker-v2-mismatch', 'wf-v2-wrong', 'plan-v2-kernel', 'missing-node', 'cat_body', 'worker-x', 'session-cat-body-worker', '', 'hermers_docker_worker', 'queued', 'info-v2-task-input', '', '', '{}', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');`);
  const invalid = await runAction(root, { action: "workflow.v2.validate" });
  assert.equal(invalid.ok, false);
  assert.equal(Boolean(invalid.failedChecks.includes("worker_runs_match_plan_node")), true);
  assert.equal(Boolean(invalid.failedChecks.includes("worker_runs_require_valid_preflight")), true);
  assert.equal(Boolean(invalid.failedChecks.includes("worker_runs_session_runs_match")), true);
  sqliteExec(dbFile, `DELETE FROM workflow_v2_worker_runs WHERE worker_run_id='worker-v2-mismatch';`);
  sqliteExec(dbFile, `
UPDATE workflow_session_runs
SET task_id='wrong-node-for-validator'
WHERE run_id='${worker.workerRun.sessionRunId}';`);
  const invalidSessionTask = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidSessionTask.ok, false);
  assert.equal(Boolean(invalidSessionTask.failedChecks.includes("worker_runs_session_runs_match")), true);
  sqliteExec(dbFile, `
UPDATE workflow_session_runs
SET task_id='${worker.workerRun.nodeId}', worker_id='wrong-worker-for-validator'
WHERE run_id='${worker.workerRun.sessionRunId}';`);
  const invalidSessionWorker = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidSessionWorker.ok, false);
  assert.equal(Boolean(invalidSessionWorker.failedChecks.includes("worker_runs_session_runs_match")), true);
  sqliteExec(dbFile, `
UPDATE workflow_session_runs
SET worker_id='${worker.workerRun.workerAgentId}'
WHERE run_id='${worker.workerRun.sessionRunId}';`);
  sqliteExec(dbFile, `
INSERT INTO workflow_session_runs(run_id, session_id, pack_version, workflow_id, task_id, dispatch_id, worker_id, status, input_json, worker_input_json, output_json, receipt_ref, error, started_at, completed_at, created_at, updated_at)
VALUES ('session-v2-orphan', 'session-cat-body-worker', 1, '${workflowId}', 'node-orphan', '', 'worker-orphan', 'queued', '{"schemaVersion":"workflow_v2_worker_session_input.v1"}', '{}', '{}', '', '', '', '', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');`);
  const invalidOrphanSession = await runAction(root, { action: "workflow.v2.validate", workflowId });
  assert.equal(invalidOrphanSession.ok, false);
  assert.equal(Boolean(invalidOrphanSession.failedChecks.includes("v2_session_runs_have_worker_runs")), true);
  sqliteExec(dbFile, `DELETE FROM workflow_session_runs WHERE run_id='session-v2-orphan';`);
  sqliteExec(dbFile, `
INSERT INTO workflow_v2_read_receipts(receipt_id, workflow_id, info_id, inbox_item_id, grant_id, reader_kind, reader_id, status, payload_json, created_at)
VALUES ('read-v2-unlinked', '${workflowId}', 'info-v2-task-input', '', '', 'agent', 'cat_body', 'read', '{}', '2026-07-01T00:00:00.000Z');`);
  const invalidReceipt = await runAction(root, { action: "workflow.v2.validate" });
  assert.equal(Boolean(invalidReceipt.failedChecks.includes("read_receipts_match_info_inbox_grant")), true);

  const partialRoot = await tempRoot("workflow-v2-partial-schema");
  const partialDbFile = path.join(partialRoot, "tracking.db");
  sqliteExec(partialDbFile, `
CREATE TABLE workflow_v2_plans(plan_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL);`);
  const partialValidation = await runAction(partialRoot, { action: "workflow.v2.validate" });
  assert.equal(partialValidation.ok, false);
  assert.equal(partialValidation.status, "fail");
  assert.equal(Boolean(partialValidation.missingSchema.some((item) => item.table === "workflow_v2_plans" && item.missingColumns.includes("workflow_state"))), true);
  assert.equal(Boolean(partialValidation.checks.some((item) => item.status === "schema_gap")), true);
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

async function testVerificationExtractedActionContracts() {
  const expected = {
    "workflow.verification.record": "workflowVerificationRecord",
    "workflow.verifier_refuter.record": "workflowVerificationRecord",
    "workflow.verifier-refuter.record": "workflowVerificationRecord",
    "verifier_refuter.record": "workflowVerificationRecord",
    "verifier.refuter.record": "workflowVerificationRecord",
    "workflow.verification": "workflowVerificationRecord",
    "workflow.evaluator.record": "workflowVerificationRecord",
    "workflow.evaluation.record": "workflowVerificationRecord",
    "workflow.verification.list": "workflowVerificationList",
    "workflow.verifications": "workflowVerificationList",
    "workflow.evaluate": "workflowEvaluate",
    "workflow.evaluator.run": "workflowEvaluate",
    "workflow.evaluation.run": "workflowEvaluate",
    "workflow.goal.evaluate": "workflowEvaluate"
  };
  for (const [action, handlerName] of Object.entries(expected)) {
    assert.equal(VERIFICATION_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted verification registry`);
    assert.equal(VERIFICATION_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to ${handlerName}`);
  }
  assert.equal(typeof workflowVerificationRecord, "function");
  assert.equal(typeof workflowVerificationList, "function");
  assert.equal(typeof workflowEvaluate, "function");
  const directRegistry = createVerificationActionRegistry({
    workflowVerificationRecord,
    workflowVerificationList,
    workflowEvaluate
  });
  assert.equal(directRegistry.get("workflow.verification.record"), workflowVerificationRecord);
  assert.equal(directRegistry.get("workflow.evaluator.record"), workflowVerificationRecord);
  assert.equal(directRegistry.get("workflow.verification.list"), workflowVerificationList);
  assert.equal(directRegistry.get("workflow.goal.evaluate"), workflowEvaluate);

  const root = await tempRoot("verification-extracted-contracts");
  const workflowId = "wf-verification-contract";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    phase: "verify",
    acceptanceCriteria: "Verification extracted action contract remains stable.",
    summary: "Verification extracted contract"
  });
  const directRecord = await workflowVerificationRecord(root, {
    verificationId: "verification-contract-direct",
    workflowId,
    phaseKey: "verify",
    resultType: "verifier",
    decision: "pass",
    callerAgent: "local_codex",
    sourceAgent: "cat_claw",
    summary: "Direct extracted verifier record."
  });
  assert.equal(directRecord.resultType, "verifier");
  assert.equal(directRecord.decision, "pass");

  const aliasRecord = await runAction(root, {
    action: "workflow.evaluation.record",
    verificationId: "verification-contract-alias",
    workflowId,
    phaseKey: "verify",
    resultType: "refuter",
    decision: "pass",
    callerAgent: "local_codex",
    sourceAgent: "cat_heart",
    summary: "Alias extracted refuter record."
  });
  assert.equal(aliasRecord.resultType, "refuter");
  assert.equal(aliasRecord.decision, "pass");

  await workflowVerificationRecord(root, {
    verificationId: "verification-contract-permission-caller",
    workflowId,
    phaseKey: "verify",
    resultType: "verifier",
    decision: "pass",
    verifierAgent: "cat_claw",
    sourceAgent: "cat_claw",
    createdBy: "cat_claw",
    summary: "PermissionDecision caller should own attribution."
  }, { caller: { agentId: "verifier_bot", runtime: "hermers" } });
  const permissionCallerRow = sqliteJson(path.join(root, "tracking.db"), `
SELECT verifier_agent AS verifierAgent, source_agent AS sourceAgent, created_by AS createdBy
FROM workflow_verification_results
WHERE verification_id='verification-contract-permission-caller'
LIMIT 1;`)[0];
  assert.deepEqual(permissionCallerRow, {
    verifierAgent: "verifier_bot",
    sourceAgent: "verifier_bot",
    createdBy: "verifier_bot"
  });

  const directList = await workflowVerificationList(root, { workflowId, limit: 10 });
  assert.equal(directList.count, 3);
  assert.equal(Boolean(directList.results.some((row) => row.verification_id === "verification-contract-direct")), true);

  const evaluation = await runAction(root, {
    action: "workflow.goal.evaluate",
    verificationId: "evaluation-contract-alias",
    workflowId,
    phaseKey: "verify",
    callerAgent: "local_codex",
    evaluatorAgent: "main"
  });
  assert.equal(evaluation.resultType, "evaluator");
  assert.equal(evaluation.decision, "met");

  const aliasList = await runAction(root, {
    action: "workflow.verifications",
    workflowId,
    limit: 10
  });
  assert.equal(aliasList.count, 4);
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

async function testControlLoopJobExtractedActionContracts() {
  const expected = {
    "workflow.control_loop.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
    "workflow.control_loop.job.retry.preview": "workflowControlLoopJobRequeuePreview",
    "workflow.control-loop.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
    "workflow.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
    "control_loop.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
    "workflow.control_loop.job.requeue": "workflowControlLoopJobRequeue",
    "workflow.control_loop.job.retry": "workflowControlLoopJobRequeue",
    "workflow.control-loop.job.requeue": "workflowControlLoopJobRequeue",
    "workflow.job.requeue": "workflowControlLoopJobRequeue",
    "control_loop.job.requeue": "workflowControlLoopJobRequeue"
  };
  for (const [action, handlerName] of Object.entries(expected)) {
    assert.equal(CONTROL_LOOP_JOB_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted control-loop job registry`);
    assert.equal(CONTROL_LOOP_JOB_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to ${handlerName}`);
  }
  assert.equal(typeof workflowControlLoopJobRequeuePreview, "function");
  assert.equal(typeof workflowControlLoopJobRequeue, "function");
  const directRegistry = createControlLoopJobActionRegistry({
    workflowControlLoopJobRequeuePreview,
    workflowControlLoopJobRequeue
  });
  assert.equal(directRegistry.get("workflow.control_loop.job.requeue.preview"), workflowControlLoopJobRequeuePreview);
  assert.equal(directRegistry.get("workflow.control_loop.job.requeue"), workflowControlLoopJobRequeue);

  const root = await tempRoot("control-loop-job-extracted-contracts");
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId: "wf-control-loop-job-contract",
    status: "active",
    summary: "Control loop job extracted contract"
  });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at)
VALUES ('job-control-loop-extracted', 'runtime_drain', 'runtime_drain:contract', 'high', 'failed', 'wf-control-loop-job-contract', 'hermers', '{"dispatchId":"dispatch-contract"}', '{"error":"failed"}', 2, 5, '2026-06-01T00:00:00.000Z', '', '', 'failed contract', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:01.000Z', '2026-06-01T00:00:02.000Z');`);

  const preview = await workflowControlLoopJobRequeuePreview(root, {
    jobId: "job-control-loop-extracted",
    operatorReason: "contract preview"
  });
  assert.equal(preview.schemaVersion, "workflow_control_loop_job_requeue_preview.v1");
  assert.equal(preview.action, "workflow.control_loop.job.requeue.preview");
  assert.equal(preview.eligible, true);
  assert.equal(preview.governanceReady, true);
  assert.equal(preview.currentJob.jobId, "job-control-loop-extracted");

  const requeued = await runAction(root, {
    action: "workflow.control_loop.job.retry",
    jobId: "job-control-loop-extracted",
    operatorReason: "contract retry alias",
    callerAgent: "local_codex",
    callerRuntime: "local_codex"
  });
  assert.equal(requeued.schemaVersion, "workflow_control_loop_job_requeue_result.v1");
  assert.equal(requeued.action, "workflow.control_loop.job.requeue");
  assert.equal(requeued.jobId, "job-control-loop-extracted");
  assert.equal(requeued.status, "queued");
  assert.equal(requeued.currentJob.status, "queued");
  assert.equal(requeued.didRunJob, false);
  assert.equal(requeued.didDispatchAgent, false);
  assert.equal(sqliteCount(dbFile, "control_loop_jobs", "job_id='job-control-loop-extracted' AND status='queued' AND attempt=0 AND lease_owner='' AND lease_until=''"), 1);
  assert.equal(sqliteCount(dbFile, "workflow_events", "event_type='control_loop.job.requeued' AND workflow_id='wf-control-loop-job-contract'"), 1);
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

async function testMessageFlowExtractedActionContracts() {
  for (const action of [
    "message_flow.send",
    "workflow.message_flow.send",
    "message_flow.list",
    "message_flow.status",
    "workflow.message_flow.list",
    "workflow.message_flow.status",
    "message_flow.reconcile",
    "workflow.message_flow.reconcile"
  ]) {
    assert.equal(MESSAGE_FLOW_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted message_flow registry`);
  }
  assert.equal(typeof messageFlowSend, "function");
  assert.equal(typeof messageFlowList, "function");
  assert.equal(typeof messageFlowReconcile, "function");

  const root = await tempRoot("message-flow-extracted-contracts");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "cat brain",
    canReceiveDispatch: true,
    executionAdapter: "openclaw"
  });
  const sent = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["openclaw:main"],
    body: "message_flow extracted contract body",
    workflowId: "workflow-message-flow-contract",
    meetingId: "meeting-message-flow-contract",
    returnPolicy: "silent"
  });
  assert.equal(sent.operation, "workflow.message_flow.send");
  assert.equal(sent.targetCount, 1);
  assert.equal(sent.dispatches.length, 1);
  assert.equal(sent.dispatches[0].runtime, "openclaw");
  assert.equal(sent.dispatches[0].agentId, "main");
  assert.equal(sent.dispatches[0].messageFlowStatus, "route_registered");
  assert.equal(typeof sent.dispatches[0].messageFlowId, "string");
  assert.ok(sent.dispatches[0].messageFlowId.startsWith("flow."));

  const listed = await runAction(root, {
    action: "workflow.message_flow.status",
    flowId: sent.dispatches[0].messageFlowId
  });
  assert.equal(listed.count, 1);
  assert.equal(listed.rows[0].flow_id, sent.dispatches[0].messageFlowId);
  assert.equal(listed.rows[0].status, "route_registered");
  assert.equal(typeof listed.rows[0].payload, "object");

  const reconciled = await runAction(root, {
    action: "workflow.message_flow.reconcile",
    messageFlowStuckAfterMs: 60_000
  });
  assert.equal(reconciled.operation, "message_flow.reconcile");
  assert.equal(reconciled.count, 0);
  assert.equal(Array.isArray(reconciled.recoveredSemanticContinuations), true);
  assert.equal(Array.isArray(reconciled.incidents), true);
}

async function testTelegramLiveExtractedActionContracts() {
  for (const action of [
    "telegram.live",
    "telegram.live.configure"
  ]) {
    assert.equal(TELEGRAM_LIVE_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted telegram.live registry`);
    assert.equal(TELEGRAM_LIVE_ACTION_HANDLER_NAMES[action], "telegramLiveConfigure", `${action} should map to the extracted telegramLiveConfigure handler`);
  }
  assert.equal(typeof telegramLiveConfigure, "function");
  const directRegistry = createTelegramLiveActionRegistry({ telegramLiveConfigure });
  assert.equal(directRegistry.get("telegram.live"), telegramLiveConfigure);
  assert.equal(directRegistry.get("telegram.live.configure"), telegramLiveConfigure);

  const root = await tempRoot("telegram-live-extracted-contracts");
  const init = await runAction(root, { action: "workflow.init" });
  const dbFile = init.dbFile;
  const bridgeDir = path.join(root, "bridge");
  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { allowWrites: true });

  const direct = await telegramLiveConfigure(root, {
    meetingId: "meeting-live-direct",
    chatId: "8390724843",
    humanGateChannelId: "8390724843",
    mode: "transparent",
    status: "active"
  });
  assert.equal(direct.meetingId, "meeting-live-direct");
  assert.equal(direct.chatId, "8390724843");
  assert.equal(direct.humanGateChannelId, "8390724843");
  assert.equal(direct.targetSource, "input");
  assert.equal(sqliteCount(dbFile, "telegram_live_links", "meeting_id='meeting-live-direct' AND chat_id='8390724843' AND status='active'"), 1);

  const alias = await runAction(root, {
    action: "telegram.live.configure",
    meetingId: "meeting-live-alias",
    chatId: "8390724843",
    humanGateChannelId: "8390724843",
    mode: "silent",
    status: "active",
    catClawAuditId: "audit-telegram-live-extracted-contract"
  });
  assert.equal(alias.meetingId, "meeting-live-alias");
  assert.equal(alias.chatId, "8390724843");
  assert.equal(alias.mode, "silent");
  assert.equal(sqliteCount(dbFile, "telegram_live_links", "meeting_id='meeting-live-alias' AND chat_id='8390724843' AND mode='silent'"), 1);

  const overwritten = await runAction(root, {
    action: "telegram.live",
    meetingId: "meeting-live-alias",
    channelId: "-100999",
    humanGateChannelId: "-100888",
    mode: "transparent",
    status: "inactive",
    catClawAuditId: "audit-telegram-live-extracted-contract"
  });
  assert.equal(overwritten.meetingId, "meeting-live-alias");
  assert.equal(overwritten.channelId, "-100999");
  assert.equal(overwritten.humanGateChannelId, "-100888");
  assert.equal(overwritten.status, "inactive");
  assert.equal(sqliteCount(dbFile, "telegram_live_links", "meeting_id='meeting-live-alias'"), 1);
  assert.equal(sqliteCount(dbFile, "telegram_live_links", "meeting_id='meeting-live-alias' AND channel_id='-100999' AND human_gate_channel_id='-100888' AND status='inactive'"), 1);

  const gatewayResult = await gateway.handle({
    action: "telegram.live.configure",
    actor: "flashcat",
    reason: "registry contract telegram live remains console-blocked",
    payload: {
      meetingId: "meeting-live-gateway",
      channelId: "-100123",
      humanGateChannelId: "-100456",
      mode: "transparent",
      status: "active",
      catClawAuditId: "audit-telegram-live-extracted-contract"
    }
  });
  assert.equal(gatewayResult.ok, false);
  assert.equal(gatewayResult.action, "telegram.live");
  assert.equal(gatewayResult.errorCode, "action_not_allowed");
  assert.equal(sqliteCount(dbFile, "telegram_live_links", "meeting_id='meeting-live-gateway'"), 0);
}

async function testTelegramOutboxExtractedActionContracts() {
  for (const action of [
    "telegram.outbox.delivery.preview",
    "telegram.outbox.preview_delivery",
    "telegram.outbox.delivery-preview",
    "workflow.telegram.outbox.delivery.preview",
    "telegram.outbox.requeue.preview",
    "telegram.outbox.preview_requeue",
    "telegram.outbox.requeue-preview",
    "telegram.outbox.resend.preview",
    "telegram.outbox.redelivery.preview",
    "workflow.telegram.outbox.requeue.preview",
    "telegram.outbox.requeue.execution_package.preview",
    "telegram.outbox.requeue.package.preview",
    "telegram.outbox.requeue.execution-package.preview",
    "telegram.outbox.resend.package.preview",
    "telegram.outbox.redelivery.package.preview",
    "workflow.telegram.outbox.requeue.package.preview",
    "telegram.outbox.delivery",
    "telegram.outbox.deliver",
    "telegram.outbox.delivery.execute",
    "workflow.telegram.outbox.delivery",
    "telegram.outbox"
  ]) {
    assert.equal(TELEGRAM_OUTBOX_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted telegram.outbox registry`);
  }
  assert.equal(typeof telegramOutboxDeliveryPreview, "function");
  assert.equal(typeof telegramOutboxRequeuePreview, "function");
  assert.equal(typeof telegramOutboxRequeueExecutionPackagePreview, "function");
  assert.equal(typeof telegramOutboxDelivery, "function");
  assert.equal(typeof telegramOutbox, "function");

  const root = await tempRoot("telegram-outbox-extracted-contracts");
  const init = await runAction(root, { action: "workflow.init" });
  const dbFile = init.dbFile;
  const bridgeDir = path.join(root, "bridge");
  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { readOnly: true });
  const writeGateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { allowWrites: true });
  const createdAt = "2026-06-01T00:00:00.000Z";
  sqliteExec(dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES
  ('outbox-extracted-contract-queued', 'workflow-outbox-contract', 'private', '8390724843', 'internal_notice', 'queued', 'telegram outbox extracted contract body', '{"account":"cat_claw"}', '${createdAt}', '${createdAt}'),
  ('outbox-extracted-contract-sent', 'workflow-outbox-contract', 'private', '8390724843', 'internal_notice', 'sent', 'telegram outbox extracted sent body', '{"account":"cat_claw","delivery":{"channel":"telegram","account":"cat_claw","target":"8390724843","deliveredAt":"${createdAt}","receipts":[{"ok":true,"message_id":"sent-contract"}]}}', '${createdAt}', '${createdAt}');`);

  const preview = await runAction(root, {
    action: "workflow.telegram.outbox.delivery.preview",
    outboxId: "outbox-extracted-contract-queued",
    deliveryOperatorReason: "registry contract preview"
  });
  assert.equal(preview.schemaVersion, "telegram_outbox_delivery_preview.v1");
  assert.equal(preview.action, "telegram.outbox.delivery.preview");
  assert.equal(preview.readOnly, true);
  assert.equal(preview.writeBoundary, "preview_only");
  assert.equal(preview.outboxId, "outbox-extracted-contract-queued");
  assert.equal(preview.eligible, true);
  assert.equal(preview.claimEligible, true);
  assert.equal(preview.executionPolicy.governanceReady, true);
  assert.equal(preview.wouldUpdate.telegramOutboxStatus, "delivering_then_sent_or_failed");

  const gatewayPreviewAlias = await gateway.handle({
    action: "telegram.outbox.preview_delivery",
    actor: "flashcat",
    reason: "registry contract gateway preview alias",
    payload: {
      outboxId: "outbox-extracted-contract-queued",
      deliveryOperatorReason: "registry contract gateway preview"
    }
  });
  assert.equal(gatewayPreviewAlias.ok, true);
  assert.equal(gatewayPreviewAlias.action, "telegram.outbox.delivery.preview");
  assert.equal(gatewayPreviewAlias.dryRun, true);
  assert.equal(gatewayPreviewAlias.result.schemaVersion, "telegram_outbox_delivery_preview.v1");
  assert.equal(gatewayPreviewAlias.result.outboxId, "outbox-extracted-contract-queued");

  const packagePreview = await runAction(root, {
    action: "workflow.telegram.outbox.requeue.package.preview",
    outboxId: "outbox-extracted-contract-queued",
    requeueOperatorReason: "registry contract package preview"
  });
  assert.equal(packagePreview.schemaVersion, "telegram_outbox_requeue_execution_package_preview.v1");
  assert.equal(packagePreview.action, "telegram.outbox.requeue.execution_package.preview");
  assert.equal(packagePreview.readOnly, true);
  assert.equal(packagePreview.writeBoundary, "preview_only");
  assert.equal(packagePreview.futureExecutionAction, "telegram.outbox.delivery");
  assert.equal(packagePreview.didSendTelegram, false);
  assert.equal(packagePreview.didCreateHumanGate, false);
  assert.equal(packagePreview.didTouchTradingState, false);

  const listed = await runAction(root, {
    action: "telegram.outbox",
    status: "queued"
  });
  assert.equal(listed.status, "queued");
  assert.equal(listed.count, 1);
  assert.equal(listed.rows[0].outbox_id, "outbox-extracted-contract-queued");

  const replay = await runAction(root, {
    action: "telegram.outbox.deliver",
    outboxId: "outbox-extracted-contract-sent",
    idempotencyKey: "outbox-extracted-contract-replay",
    deliveryOperatorReason: "registry contract idempotent replay",
    catClawAuditId: "audit-outbox-extracted-contract"
  });
  assert.equal(replay.schemaVersion, "telegram_outbox_delivery_result.v1");
  assert.equal(replay.action, "telegram.outbox.delivery");
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.didSendTelegram, false);
  assert.equal(replay.didUpdateOutbox, false);
  assert.equal(replay.receiptCount, 1);

  const gatewayWriteAliasReplay = await writeGateway.handle({
    action: "telegram.outbox.delivery.execute",
    actor: "flashcat",
    reason: "registry contract gateway write alias",
    payload: {
      outboxId: "outbox-extracted-contract-sent",
      idempotencyKey: "outbox-extracted-contract-gateway-replay",
      deliveryOperatorReason: "registry contract gateway idempotent replay",
      catClawAuditId: "audit-outbox-extracted-contract"
    }
  });
  assert.equal(gatewayWriteAliasReplay.ok, true);
  assert.equal(gatewayWriteAliasReplay.action, "telegram.outbox.delivery");
  assert.equal(gatewayWriteAliasReplay.result.schemaVersion, "telegram_outbox_delivery_result.v1");
  assert.equal(gatewayWriteAliasReplay.result.idempotentReplay, true);
  assert.equal(gatewayWriteAliasReplay.result.didSendTelegram, false);
}

async function testHumanGateInboxExtractedActionContracts() {
  for (const action of [
    "human_gate.inbox",
    "human_gate.console",
    "human_gate.batch_inbox"
  ]) {
    assert.equal(HUMAN_GATE_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted human_gate registry`);
    assert.equal(HUMAN_GATE_ACTION_HANDLER_NAMES[action], "humanGateInbox", `${action} should map to the extracted humanGateInbox handler`);
  }
  assert.equal(typeof humanGateInbox, "function");
  const directRegistry = createHumanGateActionRegistry({ humanGateInbox });
  assert.equal(directRegistry.get("human_gate.inbox"), humanGateInbox);

  const root = await tempRoot("human-gate-inbox-extracted-contracts");
  const init = await runAction(root, { action: "workflow.init" });
  const dbFile = init.dbFile;
  const bridgeDir = path.join(root, "bridge");
  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { allowWrites: true });
  const readOnlyGateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { readOnly: true, allowWrites: true });
  const createdAt = "2026-06-02T00:00:00.000Z";
  sqliteExec(dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES ('hgate-inbox-contract', 'human_gate_record', 'pending', NULL, 'regression', 'cat_claw', 'wf-hgate-inbox-contract', 'artifact://hgate-inbox-contract', '{"workflowId":"wf-hgate-inbox-contract","summary":"Human Gate inbox contract summary","payload":{"workflowId":"wf-hgate-inbox-contract","gateType":"workflow_continuation","summary":"Human Gate inbox contract body"}}', 'hash-hgate-inbox-contract', '${createdAt}', '${createdAt}');
INSERT INTO human_gate_buttons(button_id, callback_token, human_gate_id, workflow_id, meeting_id, label, decision_status, button_role, artifact_ref, summary, prompt, payload_json, status, created_by, created_at, updated_at)
VALUES ('button-hgate-inbox-contract-a', 'token-hgate-inbox-contract-a', 'hgate-inbox-contract', 'wf-hgate-inbox-contract', 'wf-hgate-inbox-contract', '批准方案 A：继续', 'approved', 'approve_option', 'artifact://hgate-inbox-contract', '批准继续推进', '继续推进 workflow。', '{"optionKey":"A"}', 'active', 'cat_claw', '${createdAt}', '${createdAt}');`);

  const inbox = await runAction(root, {
    action: "human_gate.console",
    batchId: "batch-hgate-inbox-contract",
    workflowId: "wf-hgate-inbox-contract",
    target: "8390724843"
  });
  assert.equal(inbox.batchId, "batch-hgate-inbox-contract");
  assert.equal(inbox.status, "open");
  assert.equal(inbox.targetRef, "8390724843");
  assert.equal(inbox.count, 1);
  assert.equal(inbox.riskSummary.total, 1);
  assert.equal(inbox.riskSummary.buttonChoices, 1);
  assert.equal(inbox.items[0].sourceType, "human_gate_record");
  assert.equal(inbox.items[0].sourceId, "hgate-inbox-contract");
  assert.equal(inbox.items[0].buttons.length, 1);
  assert.equal(inbox.items[0].actionHint, "select one recorded button; do not infer intent from natural language");
  assert.equal(sqliteCount(dbFile, "human_gate_batches", "batch_id='batch-hgate-inbox-contract'"), 1);
  assert.equal(sqliteCount(dbFile, "human_gate_batch_items", "batch_id='batch-hgate-inbox-contract'"), 1);
  assert.equal(sqliteCount(dbFile, "artifact_index", "artifact_id='batch-hgate-inbox-contract' AND kind='human_gate_inbox'"), 1);
  assert.equal(await pathExists(path.join(root, inbox.htmlPath)), true);
  assert.equal(await pathExists(path.join(root, inbox.jsonPath)), true);

  const readOnlyInbox = await readOnlyGateway.handle({
    action: "human_gate.console",
    actor: "flashcat",
    reason: "read-only human gate inbox blocked",
    payload: {
      batchId: "batch-hgate-inbox-contract-readonly",
      workflowId: "wf-hgate-inbox-contract",
      target: "8390724843"
    }
  });
  assert.equal(readOnlyInbox.ok, false);
  assert.equal(readOnlyInbox.action, "human_gate.inbox");
  assert.equal(readOnlyInbox.errorCode, "console_readonly");
  assert.equal(sqliteCount(dbFile, "human_gate_batches", "batch_id='batch-hgate-inbox-contract-readonly'"), 0);

  const gatewayInbox = await gateway.handle({
    action: "human_gate.batch_inbox",
    actor: "flashcat",
    reason: "registry contract human gate inbox gateway alias",
    payload: {
      batchId: "batch-hgate-inbox-contract-gateway",
      workflowId: "wf-hgate-inbox-contract",
      target: "8390724843"
    }
  });
  assert.equal(gatewayInbox.ok, true);
  assert.equal(gatewayInbox.action, "human_gate.inbox");
  assert.equal(gatewayInbox.dryRun, false);
  assert.equal(gatewayInbox.result.batchId, "batch-hgate-inbox-contract-gateway");
  assert.equal(gatewayInbox.result.status, "open");
  assert.equal(gatewayInbox.result.count, 1);
  assert.equal(gatewayInbox.result.items[0].sourceId, "hgate-inbox-contract");
}

async function testProtocolRecordExtractedActionContracts() {
  for (const action of [
    "protocol.record",
    "protocol.object"
  ]) {
    assert.equal(PROTOCOL_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted protocol registry`);
    assert.equal(PROTOCOL_ACTION_HANDLER_NAMES[action], "protocolRecord", `${action} should map to the extracted protocolRecord handler`);
  }
  assert.equal(typeof protocolRecord, "function");
  const directRegistry = createProtocolActionRegistry({ protocolRecord });
  assert.equal(directRegistry.get("protocol.record"), protocolRecord);
  assert.equal(directRegistry.get("protocol.object"), protocolRecord);

  const root = await tempRoot("protocol-record-extracted-contracts");
  const record = await runAction(root, {
    action: "protocol.object",
    objectId: "evidence-pack-extracted-contract",
    objectType: "evidence_pack",
    status: "recorded",
    sourceSystem: "regression",
    parentObjectId: "wf-protocol-extracted-contract",
    summary: "Protocol record extracted action contract.",
    payload: {
      apiKey: "should-not-persist",
      nested: {
        token: "nested-secret",
        note: "safe"
      }
    },
    createdAt: "2026-06-03T00:00:00.000Z"
  });

  assert.equal(record.objectId, "evidence-pack-extracted-contract");
  assert.equal(record.objectType, "evidence_pack");
  assert.equal(record.status, "recorded");
  assert.equal(record.instrumentId, null);
  assert.equal(await pathExists(record.path), true);

  const rows = sqliteJson(record.dbFile, `
SELECT object_id, object_type, status, source_system, source_agent, parent_object_id, payload_json
FROM protocol_objects
WHERE object_id='evidence-pack-extracted-contract'
LIMIT 1;`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].object_type, "evidence_pack");
  assert.equal(rows[0].source_system, "regression");
  assert.equal(rows[0].source_agent, "cat_claw");
  assert.equal(rows[0].parent_object_id, "wf-protocol-extracted-contract");
  const payload = JSON.parse(rows[0].payload_json);
  assert.equal(payload.summary, "Protocol record extracted action contract.");
  assert.equal(payload.createdAt, "2026-06-03T00:00:00.000Z");
  assert.equal(payload.payload.apiKey, "[redacted]");
  assert.equal(payload.payload.nested.token, "[redacted]");
  assert.equal(payload.payload.nested.note, "safe");

  await assertRejectsMessage(
    () => runAction(root, {
      action: "protocol.record",
      objectId: "blocked-human-gate-record",
      objectType: "human_gate_record",
      payload: { summary: "should be blocked" }
    }),
    /human_gate_record writes are button-first only/
  );
  assert.equal(sqliteCount(record.dbFile, "protocol_objects", "object_id='blocked-human-gate-record'"), 0);
}

async function testTradeProposalExtractedActionContracts() {
  assert.equal(TRADE_ACTION_REGISTRY.has("trade.proposal"), true);
  assert.equal(TRADE_ACTION_HANDLER_NAMES["trade.proposal"], "tradeProposal");
  assert.equal(typeof tradeProposal, "function");
  const directRegistry = createTradeActionRegistry({ tradeProposal });
  assert.equal(directRegistry.get("trade.proposal"), tradeProposal);

  const root = await tempRoot("trade-proposal-extracted-contracts");
  const proposal = await runAction(root, {
    action: "trade.proposal",
    proposalId: "proposal-extracted-contract",
    assetType: "crypto",
    symbol: "ETH/USDT",
    side: "sell",
    quantity: "2",
    orderType: "limit",
    priceConstraints: { minPrice: 2500 },
    riskLimits: { maxNotional: 5000 },
    rationale: "Trade proposal extracted action contract.",
    payload: { apiKey: "should-not-persist", note: "regression" }
  });

  assert.equal(proposal.objectId, "proposal-extracted-contract");
  assert.equal(proposal.objectType, "trade_proposal");
  assert.equal(proposal.status, "proposed");
  assert.equal(proposal.instrumentId, "crypto:ETH/USDT");
  assert.equal(await pathExists(proposal.path), true);

  const rows = sqliteJson(proposal.dbFile, `
SELECT object_id, object_type, status, source_system, source_agent, payload_json
FROM protocol_objects
WHERE object_id='proposal-extracted-contract'
LIMIT 1;`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].object_type, "trade_proposal");
  assert.equal(rows[0].status, "proposed");
  assert.equal(rows[0].source_system, "openclaw_hermers");
  assert.equal(rows[0].source_agent, "cat_heart");
  const payload = JSON.parse(rows[0].payload_json);
  assert.equal(payload.payload.side, "sell");
  assert.equal(payload.payload.quantity, "2");
  assert.equal(payload.payload.orderType, "limit");
  assert.deepEqual(payload.payload.priceConstraints, { minPrice: 2500 });
  assert.deepEqual(payload.payload.riskLimits, { maxNotional: 5000 });
  assert.equal(payload.payload.raw.apiKey, "[redacted]");
  assert.equal(payload.payload.raw.note, "regression");
}

async function testSideEffectExtractedActionContracts() {
  for (const action of [
    "side_effect.record",
    "side_effect.ledger"
  ]) {
    assert.equal(SIDE_EFFECT_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted side_effect registry`);
    assert.equal(SIDE_EFFECT_ACTION_HANDLER_NAMES[action], "sideEffectRecord", `${action} should map to the extracted sideEffectRecord handler`);
  }
  assert.equal(typeof sideEffectRecord, "function");
  const directRegistry = createSideEffectActionRegistry({ sideEffectRecord });
  assert.equal(directRegistry.get("side_effect.record"), sideEffectRecord);
  assert.equal(directRegistry.get("side_effect.ledger"), sideEffectRecord);

  const root = await tempRoot("side-effect-extracted-contracts");
  const result = await runAction(root, {
    action: "side_effect.ledger",
    sideEffectId: "side-effect-extracted-contract",
    workflowId: "wf-side-effect-extracted",
    traceId: "trace-side-effect-extracted",
    dispatchId: "dispatch-side-effect-extracted",
    idempotencyKey: "idem-side-effect-extracted",
    ownerAgent: "cat_claw",
    sideEffectType: "external_notification",
    status: "confirmed",
    artifactRef: "artifact://side-effect-extracted",
    outputHash: "sha256:known-output",
    payload: {
      apiSecret: "should-not-persist",
      nested: {
        token: "nested-secret",
        note: "safe"
      }
    }
  });

  assert.equal(result.sideEffectId, "side-effect-extracted-contract");
  assert.equal(result.sideEffectType, "external_notification");
  assert.equal(result.status, "confirmed");

  const ledgerRows = sqliteJson(result.dbFile, `
SELECT side_effect_id, workflow_id, trace_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, artifact_ref, output_hash, payload_json
FROM side_effect_ledger
WHERE side_effect_id='side-effect-extracted-contract'
LIMIT 1;`);
  assert.equal(ledgerRows.length, 1);
  assert.equal(ledgerRows[0].workflow_id, "wf-side-effect-extracted");
  assert.equal(ledgerRows[0].trace_id, "trace-side-effect-extracted");
  assert.equal(ledgerRows[0].dispatch_id, "dispatch-side-effect-extracted");
  assert.equal(ledgerRows[0].idempotency_key, "idem-side-effect-extracted");
  assert.equal(ledgerRows[0].owner_agent, "cat_claw");
  assert.equal(ledgerRows[0].side_effect_type, "external_notification");
  assert.equal(ledgerRows[0].status, "confirmed");
  assert.equal(ledgerRows[0].artifact_ref, "artifact://side-effect-extracted");
  assert.equal(ledgerRows[0].output_hash, "sha256:known-output");
  const payload = JSON.parse(ledgerRows[0].payload_json);
  assert.equal(payload.apiSecret, "[redacted]");
  assert.equal(payload.nested.token, "[redacted]");
  assert.equal(payload.nested.note, "safe");

  const eventRows = sqliteJson(result.dbFile, `
SELECT event_type, workflow_id, trace_id, dispatch_id, actor, source_agent, next_state, artifact_ref, payload_json
FROM workflow_events
WHERE event_type='side_effect.recorded' AND side_effect_id='side-effect-extracted-contract'
LIMIT 1;`);
  assert.equal(eventRows.length, 1);
  assert.equal(eventRows[0].workflow_id, "wf-side-effect-extracted");
  assert.equal(eventRows[0].trace_id, "trace-side-effect-extracted");
  assert.equal(eventRows[0].dispatch_id, "dispatch-side-effect-extracted");
  assert.equal(eventRows[0].actor, "cat_claw");
  assert.equal(eventRows[0].source_agent, "cat_claw");
  assert.equal(eventRows[0].next_state, "confirmed");
  assert.equal(eventRows[0].artifact_ref, "artifact://side-effect-extracted");
  const eventPayload = JSON.parse(eventRows[0].payload_json);
  assert.equal(eventPayload.sideEffectType, "external_notification");
  assert.equal(eventPayload.outputHash, "sha256:known-output");
  assert.equal(JSON.stringify(eventPayload).includes("should-not-persist"), false);
  assert.equal(JSON.stringify(eventPayload).includes("nested-secret"), false);

  const retryResult = await runAction(root, {
    action: "side_effect.record",
    sideEffectId: "side-effect-extracted-contract",
    workflowId: "wf-side-effect-extracted",
    traceId: "trace-side-effect-extracted",
    dispatchId: "dispatch-side-effect-extracted",
    ownerAgent: "cat_claw",
    sideEffectType: "external_notification",
    status: "resolved",
    payload: {
      apiSecret: "retry-secret",
      nested: {
        token: "retry-token"
      }
    }
  });
  assert.equal(retryResult.status, "resolved");
  assert.equal(sqliteCount(result.dbFile, "side_effect_ledger", "side_effect_id='side-effect-extracted-contract'"), 1);
  const retryRows = sqliteJson(result.dbFile, `
SELECT status, artifact_ref, output_hash, payload_json
FROM side_effect_ledger
WHERE side_effect_id='side-effect-extracted-contract'
LIMIT 1;`);
  assert.equal(retryRows[0].status, "resolved");
  assert.equal(retryRows[0].artifact_ref, "artifact://side-effect-extracted");
  assert.equal(retryRows[0].output_hash, "sha256:known-output");
  const retryPayload = JSON.parse(retryRows[0].payload_json);
  assert.equal(retryPayload.apiSecret, "[redacted]");
  assert.equal(retryPayload.nested.token, "[redacted]");
  assert.equal(sqliteCount(result.dbFile, "workflow_events", "event_type='side_effect.recorded' AND side_effect_id='side-effect-extracted-contract'"), 2);
}

async function testIncidentStateExtractedActionContracts() {
  for (const action of [
    "incident.state",
    "workflow.incident"
  ]) {
    assert.equal(INCIDENT_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted incident registry`);
    assert.equal(INCIDENT_ACTION_HANDLER_NAMES[action], "incidentState", `${action} should map to the extracted incidentState handler`);
  }
  assert.equal(typeof incidentState, "function");
  const directRegistry = createIncidentActionRegistry({ incidentState });
  assert.equal(directRegistry.get("incident.state"), incidentState);
  assert.equal(directRegistry.get("workflow.incident"), incidentState);

  const root = await tempRoot("incident-state-extracted-contracts");
  const created = await runAction(root, {
    action: "workflow.incident",
    incidentId: "incident-extracted-contract",
    workflowId: "wf-incident-extracted",
    traceId: "trace-incident-extracted",
    status: "active",
    mode: "degraded",
    affectedPlanes: ["workflow", "runtime"],
    summary: "Incident extracted action contract.",
    commander: "main",
    impact: "low",
    currentHypothesis: "contract extraction check",
    mitigation: "observe",
    rollbackOptions: "revert commit",
    exitCriteria: "tests pass",
    timeline: ["2026-06-04T00:00:00.000Z declared"],
    payload: { workflowId: "wf-incident-extracted", note: "safe" },
    declaredAt: "2026-06-04T00:00:00.000Z",
    nextUpdateAt: "2026-06-04T00:30:00.000Z"
  });

  assert.equal(created.incidentId, "incident-extracted-contract");
  assert.equal(created.status, "active");
  assert.equal(created.mode, "degraded");
  assert.equal(await pathExists(path.join(root, created.markdownRelativePath)), true);
  assert.equal(await pathExists(path.join(root, created.jsonRelativePath)), true);

  const createdRows = sqliteJson(created.dbFile, `
SELECT incident_id, status, mode, summary, commander, affected_planes_json, payload_json, declared_at, next_update_at, resolved_at
FROM incident_states
WHERE incident_id='incident-extracted-contract'
LIMIT 1;`);
  assert.equal(createdRows.length, 1);
  assert.equal(createdRows[0].status, "active");
  assert.equal(createdRows[0].mode, "degraded");
  assert.equal(createdRows[0].summary, "Incident extracted action contract.");
  assert.equal(createdRows[0].commander, "main");
  assert.deepEqual(JSON.parse(createdRows[0].affected_planes_json), ["workflow", "runtime"]);
  assert.equal(createdRows[0].declared_at, "2026-06-04T00:00:00.000Z");
  assert.equal(createdRows[0].next_update_at, "2026-06-04T00:30:00.000Z");
  assert.equal(createdRows[0].resolved_at, "");
  const createdPayload = JSON.parse(createdRows[0].payload_json);
  assert.equal(createdPayload.workflowId, "wf-incident-extracted");
  assert.equal(createdPayload.note, "safe");
  assert.equal(createdPayload.jsonRelPath, created.jsonRelativePath);
  assert.equal(createdPayload.markdownRelPath, created.markdownRelativePath);

  const createdEvent = sqliteJson(created.dbFile, `
SELECT event_type, status, workflow_id, trace_id, incident_id, actor, source_agent, previous_state, next_state, artifact_ref, payload_json
FROM workflow_events
WHERE event_type='incident.created' AND incident_id='incident-extracted-contract'
LIMIT 1;`)[0];
  assert.ok(createdEvent);
  assert.equal(createdEvent.workflow_id, "wf-incident-extracted");
  assert.equal(createdEvent.trace_id, "trace-incident-extracted");
  assert.equal(createdEvent.actor, "main");
  assert.equal(createdEvent.source_agent, "main");
  assert.equal(createdEvent.previous_state, "");
  assert.equal(createdEvent.next_state, "active");
  assert.equal(createdEvent.artifact_ref, created.markdownRelativePath);

  const updated = await runAction(root, {
    action: "incident.state",
    incidentId: "incident-extracted-contract",
    workflowId: "wf-incident-extracted",
    traceId: "trace-incident-extracted",
    status: "monitoring",
    mode: "degraded",
    commander: "main",
    summary: "Incident extracted action monitoring update.",
    timeline: ["2026-06-04T00:05:00.000Z monitoring"],
    payload: { workflowId: "wf-incident-extracted", monitor: "continue" }
  });
  assert.equal(updated.status, "monitoring");
  const updatedEvent = sqliteJson(created.dbFile, `
SELECT event_type, previous_state, next_state, artifact_ref
FROM workflow_events
WHERE event_type='incident.updated' AND incident_id='incident-extracted-contract'
LIMIT 1;`)[0];
  assert.ok(updatedEvent);
  assert.equal(updatedEvent.previous_state, "active");
  assert.equal(updatedEvent.next_state, "monitoring");
  assert.equal(updatedEvent.artifact_ref, updated.markdownRelativePath);

  const resolved = await runAction(root, {
    action: "incident.state",
    incidentId: "incident-extracted-contract",
    workflowId: "wf-incident-extracted",
    traceId: "trace-incident-extracted",
    status: "resolved",
    commander: "main",
    summary: "Incident extracted action resolved.",
    timeline: ["2026-06-04T00:10:00.000Z resolved"],
    payload: { workflowId: "wf-incident-extracted", closeout: "complete" }
  });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.mode, "normal");
  assert.equal(sqliteCount(created.dbFile, "incident_states", "incident_id='incident-extracted-contract'"), 1);
  const resolvedRows = sqliteJson(created.dbFile, `
SELECT status, mode, summary, resolved_at, payload_json
FROM incident_states
WHERE incident_id='incident-extracted-contract'
LIMIT 1;`);
  assert.equal(resolvedRows[0].status, "resolved");
  assert.equal(resolvedRows[0].mode, "normal");
  assert.equal(resolvedRows[0].summary, "Incident extracted action resolved.");
  assert.notEqual(resolvedRows[0].resolved_at, "");
  assert.equal(JSON.parse(resolvedRows[0].payload_json).closeout, "complete");
  const resolvedEvent = sqliteJson(created.dbFile, `
SELECT event_type, previous_state, next_state, artifact_ref
FROM workflow_events
WHERE event_type='incident.resolved' AND incident_id='incident-extracted-contract'
LIMIT 1;`)[0];
  assert.ok(resolvedEvent);
  assert.equal(resolvedEvent.previous_state, "monitoring");
  assert.equal(resolvedEvent.next_state, "resolved");
  assert.equal(resolvedEvent.artifact_ref, resolved.markdownRelativePath);
}

async function testResearchExtractedActionContracts() {
  const expectedHandlers = {
    "instrument.upsert": "instrumentUpsert",
    "tracking.instrument": "instrumentUpsert",
    "radar.update": "radarUpdate",
    "thesis.update": "thesisUpdate",
    "thesis.create": "thesisUpdate",
    "research.evidence": "researchEvidence",
    "research.memo": "researchMemo",
    "gate.review": "gateReview",
    "human_gate.review": "gateReview"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(RESEARCH_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted research registry`);
    assert.equal(RESEARCH_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof instrumentUpsert, "function");
  assert.equal(typeof radarUpdate, "function");
  assert.equal(typeof thesisUpdate, "function");
  assert.equal(typeof researchEvidence, "function");
  assert.equal(typeof researchMemo, "function");
  assert.equal(typeof gateReview, "function");
  const directRegistry = createResearchActionRegistry({
    gateReview,
    instrumentUpsert,
    radarUpdate,
    researchEvidence,
    researchMemo,
    thesisUpdate
  });
  assert.equal(directRegistry.get("tracking.instrument"), instrumentUpsert);
  assert.equal(directRegistry.get("thesis.create"), thesisUpdate);
  assert.equal(directRegistry.get("human_gate.review"), gateReview);

  const root = await tempRoot("research-extracted-contracts");
  const instrument = await runAction(root, {
    action: "tracking.instrument",
    assetType: "stock",
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    tags: ["large_cap", "regression"]
  });
  assert.equal(instrument.instrumentId, "stock:AAPL");
  assert.equal(sqliteCount(instrument.dbFile, "instruments", "instrument_id='stock:AAPL'"), 1);
  const canonicalInstrument = await runAction(root, {
    action: "instrument.upsert",
    assetType: "stock",
    symbol: "MSFT",
    name: "Microsoft Corp."
  });
  assert.equal(canonicalInstrument.instrumentId, "stock:MSFT");

  const radar = await runAction(root, {
    action: "radar.update",
    assetType: "stock",
    symbol: "AAPL",
    scoreId: "radar-extracted-contract",
    asOf: "2026-06-05",
    radarZone: "bright",
    retailHeatScore: 61,
    newsCatalystScore: 72,
    fundamentalScore: 83,
    sentimentStage: "improving",
    sourceReliability: "high",
    catalystWindow: "7d",
    fundamentalTrend: "up",
    valuationState: "fair",
    confidence: "medium",
    summary: "Radar extracted action contract.",
    evidencePaths: ["evidence/a.md"],
    researchState: "active"
  });
  assert.equal(radar.scoreId, "radar-extracted-contract");
  assert.equal(radar.instrumentId, "stock:AAPL");
  assert.equal(radar.radarZone, "bright");
  const radarRows = sqliteJson(radar.dbFile, `
SELECT radar_zone, retail_heat_score, news_catalyst_score, fundamental_score, evidence_paths_json
FROM radar_scores
WHERE score_id='radar-extracted-contract'
LIMIT 1;`);
  assert.equal(radarRows.length, 1);
  assert.equal(radarRows[0].radar_zone, "bright");
  assert.ok(Math.abs(Number(radarRows[0].retail_heat_score) - 61) < 0.000001);
  assert.deepEqual(JSON.parse(radarRows[0].evidence_paths_json), ["evidence/a.md"]);

  const thesis = await runAction(root, {
    action: "thesis.create",
    assetType: "stock",
    symbol: "AAPL",
    thesisId: "thesis-extracted-contract",
    title: "AAPL extracted thesis",
    status: "watch",
    ownerAgent: "cat_ears",
    summary: "Thesis extracted action contract.",
    falsificationTriggers: "Break thesis.",
    reviewDueAt: "2026-06-30T00:00:00.000Z",
    content: "# AAPL extracted thesis\n\nContract body.\n"
  });
  assert.equal(thesis.thesisId, "thesis-extracted-contract");
  assert.equal(thesis.status, "watch");
  assert.equal(await pathExists(thesis.path), true);
  assert.equal(sqliteCount(thesis.dbFile, "thesis_index", "thesis_id='thesis-extracted-contract' AND status='watch'"), 1);
  const canonicalThesis = await runAction(root, {
    action: "thesis.update",
    assetType: "stock",
    symbol: "MSFT",
    thesisId: "thesis-extracted-contract-update",
    status: "active",
    content: "# MSFT extracted thesis update\n"
  });
  assert.equal(canonicalThesis.thesisId, "thesis-extracted-contract-update");
  assert.equal(canonicalThesis.status, "active");

  const evidence = await runAction(root, {
    action: "research.evidence",
    assetType: "stock",
    symbol: "AAPL",
    evidenceId: "evidence-extracted-contract",
    kind: "filing",
    source: "regression",
    reliability: "high",
    capturedAt: "2026-06-05T00:00:00.000Z",
    summary: "Evidence extracted action contract.",
    supports: "Supports thesis.",
    conflicts: "No conflict.",
    content: "# Evidence extracted\n"
  });
  assert.equal(evidence.evidenceId, "evidence-extracted-contract");
  assert.equal(evidence.instrumentId, "stock:AAPL");
  assert.equal(await pathExists(evidence.path), true);
  assert.equal(sqliteCount(evidence.dbFile, "evidence_items", "evidence_id='evidence-extracted-contract' AND kind='filing'"), 1);

  const memo = await runAction(root, {
    action: "research.memo",
    assetType: "stock",
    symbol: "AAPL",
    memoId: "memo-extracted-contract",
    memoType: "research_memo",
    title: "Memo extracted",
    workflowId: "wf-research-extracted",
    summary: "Memo extracted action contract.",
    conclusion: "Continue tracking.",
    content: "# Memo extracted\n"
  });
  assert.equal(memo.memoId, "memo-extracted-contract");
  assert.equal(memo.instrumentId, "stock:AAPL");
  assert.equal(await pathExists(memo.path), true);
  assert.equal(sqliteCount(memo.dbFile, "research_memos", "memo_id='memo-extracted-contract'"), 1);
  assert.equal(sqliteCount(memo.dbFile, "artifact_index", "artifact_id='memo-extracted-contract' AND kind='research_memo'"), 1);

  const gate = await runAction(root, {
    action: "human_gate.review",
    assetType: "stock",
    symbol: "AAPL",
    gateId: "gate-extracted-contract",
    workflowId: "wf-research-extracted",
    gateType: "research_review",
    status: "approved",
    summary: "Gate review extracted action contract.",
    reviewerAgent: "cat_claw",
    humanGateRequired: true,
    resumePointer: "dispatch-gate-extracted",
    expiresAt: "2026-06-06T00:00:00.000Z",
    approver: "flashcat",
    evidencePaths: [evidence.relativePath, memo.relativePath]
  });
  assert.equal(gate.gateId, "gate-extracted-contract");
  assert.equal(gate.status, "approved");
  assert.equal(gate.instrumentId, "stock:AAPL");
  const gateRows = sqliteJson(gate.dbFile, `
SELECT gate_type, status, reviewer_agent, human_gate_required, resume_pointer, decision_at, approver, evidence_paths_json
FROM review_gates
WHERE gate_id='gate-extracted-contract'
LIMIT 1;`);
  assert.equal(gateRows.length, 1);
  assert.equal(gateRows[0].gate_type, "research_review");
  assert.equal(gateRows[0].status, "approved");
  assert.equal(gateRows[0].reviewer_agent, "cat_claw");
  assert.equal(Number(gateRows[0].human_gate_required), 1);
  assert.equal(gateRows[0].resume_pointer, "dispatch-gate-extracted");
  assert.notEqual(gateRows[0].decision_at, "");
  assert.equal(gateRows[0].approver, "flashcat");
  assert.deepEqual(JSON.parse(gateRows[0].evidence_paths_json), [evidence.relativePath, memo.relativePath]);
  const canonicalGate = await runAction(root, {
    action: "gate.review",
    assetType: "stock",
    symbol: "AAPL",
    gateId: "gate-extracted-contract-canonical",
    status: "pending",
    summary: "Gate review canonical action contract."
  });
  assert.equal(canonicalGate.gateId, "gate-extracted-contract-canonical");
  assert.equal(canonicalGate.status, "pending");

  const tracking = sqliteJson(gate.dbFile, `
SELECT research_state, radar_zone, thesis_status, last_evidence_at, last_memo_at, last_review_at
FROM tracking_states
WHERE instrument_id='stock:AAPL'
LIMIT 1;`)[0];
  assert.equal(tracking.research_state, "active");
  assert.equal(tracking.radar_zone, "bright");
  assert.equal(tracking.thesis_status, "watch");
  assert.equal(tracking.last_evidence_at, "2026-06-05T00:00:00.000Z");
  assert.ok(tracking.last_memo_at);
  assert.equal(tracking.last_review_at, "2026-06-05");
}

async function testCatClawExtractedActionContracts() {
  assert.equal(CAT_CLAW_ACTION_REGISTRY.has("cat_claw.audit"), true);
  assert.equal(CAT_CLAW_ACTION_HANDLER_NAMES["cat_claw.audit"], "cat_clawAudit");
  assert.equal(typeof cat_clawAudit, "function");
  const directRegistry = createCatClawActionRegistry({ cat_clawAudit });
  assert.equal(directRegistry.get("cat_claw.audit"), cat_clawAudit);

  const root = await tempRoot("cat-claw-extracted-contracts");
  await runAction(root, {
    action: "instrument.upsert",
    assetType: "stock",
    symbol: "AAPL",
    name: "Apple Inc."
  });
  await runAction(root, {
    action: "radar.update",
    assetType: "stock",
    symbol: "AAPL",
    scoreId: "radar-cat-claw-extracted-contract",
    radarZone: "bright",
    retailHeatScore: 82,
    newsCatalystScore: 74,
    summary: "Cat Claw audit missing three-face contract.",
    researchState: "active"
  });
  await runAction(root, {
    action: "gate.review",
    assetType: "stock",
    symbol: "AAPL",
    gateId: "gate-cat-claw-extracted-contract",
    gateType: "research_review",
    status: "pending",
    summary: "Cat Claw audit pending gate contract.",
    humanGateRequired: true
  });

  const audit = await runAction(root, {
    action: "cat_claw.audit",
    staleDays: 30
  });
  assert.equal(audit.staleThesisCount, 1);
  assert.equal(audit.missingThreeFaceCount, 1);
  assert.equal(audit.pendingGateCount, 1);
  assert.equal(await pathExists(audit.auditFile), true);
  const content = await fs.readFile(audit.auditFile, "utf8");
  assert.equal(content.includes("# Cat Claw Workflow Audit"), true);
  assert.equal(content.includes("stock:AAPL"), true);
  assert.equal(content.includes("gate-cat-claw-extracted-contract"), true);
  assert.equal(content.includes("fundamental=null"), true);
}

async function testRuntimeAgentExtractedActionContracts() {
  const expectedHandlers = {
    "runtime.agent": "runtimeAgentUpsert",
    "runtime.agent.upsert": "runtimeAgentUpsert"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(RUNTIME_AGENT_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted runtime agent registry`);
    assert.equal(RUNTIME_AGENT_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof runtimeAgentUpsert, "function");
  const directRegistry = createRuntimeAgentActionRegistry({ runtimeAgentUpsert });
  assert.equal(directRegistry.get("runtime.agent"), runtimeAgentUpsert);
  assert.equal(directRegistry.get("runtime.agent.upsert"), runtimeAgentUpsert);

  const root = await tempRoot("runtime-agent-extracted-contracts");
  const direct = await runtimeAgentUpsert(root, {
    runtime: "hermes_acp",
    agentId: "cat_body",
    displayName: "Cat Body",
    role: "developer",
    endpointRef: "hermers-profile:catbody",
    metadata: { contract: "direct_export" }
  });
  assert.equal(direct.runtime, "hermers");
  assert.equal(direct.agentKey, "hermers:cat_body");
  assert.equal(direct.workflowIngressAdapter, "acp");
  assert.equal(await pathExists(direct.snapshotFile), true);

  const alias = await runAction(root, {
    action: "runtime.agent",
    runtime: "openclaw",
    agentId: "main",
    displayName: "Cat Brain",
    role: "governance",
    workflowIngressAdapter: "openclaw_native",
    endpointRef: "openclaw-agent:main"
  });
  assert.equal(alias.agentKey, "openclaw:main");
  assert.equal(alias.platform, "openclaw");

  await assert.rejects(
    () => runAction(root, {
      action: "runtime.agent.upsert",
      runtime: "hermers",
      agentId: "cat_claw",
      endpointRef: "hermers-profile:catclaw"
    }),
    /cat_claw is an OpenClaw-only secretary agent/
  );

  const catClaw = await runAction(root, {
    action: "runtime.agent.upsert",
    runtime: "openclaw",
    agentId: "cat_claw",
    platform: "openclaw",
    executionAdapter: "native",
    workflowIngressAdapter: "openclaw_native",
    imIngressOwner: "openclaw_gateway",
    imIngressAdapter: "openclaw_native",
    imIdentity: "openclaw_native",
    executionIdentity: "openclaw_native",
    displayName: "Cat Claw",
    role: "secretary",
    endpointRef: "openclaw-agent:cat_claw"
  });
  assert.equal(catClaw.agentKey, "openclaw:cat_claw");
  assert.equal(catClaw.executionIdentity, "openclaw_native");
  assert.equal(sqliteCount(catClaw.dbFile, "runtime_agents", "agent_key IN ('hermers:cat_body','openclaw:main','openclaw:cat_claw')"), 3);
}

async function testMeetingParticipantExtractedActionContracts() {
  const expectedHandlers = {
    "meeting.runtime_participant": "meetingRuntimeParticipant",
    "runtime.participant": "meetingRuntimeParticipant"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(MEETING_PARTICIPANT_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted meeting participant registry`);
    assert.equal(MEETING_PARTICIPANT_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof meetingRuntimeParticipant, "function");
  const directRegistry = createMeetingParticipantActionRegistry({ meetingRuntimeParticipant });
  assert.equal(directRegistry.get("meeting.runtime_participant"), meetingRuntimeParticipant);
  assert.equal(directRegistry.get("runtime.participant"), meetingRuntimeParticipant);

  const root = await tempRoot("meeting-participant-extracted-contracts");
  await runtimeAgentUpsert(root, {
    runtime: "hermers",
    agentId: "cat_body",
    displayName: "Cat Body",
    role: "developer",
    endpointRef: "hermers-profile:catbody"
  });
  const direct = await meetingRuntimeParticipant(root, {
    meetingId: "meeting-participant-contract",
    runtime: "hermers",
    agentId: "cat_body",
    participantRole: "developer",
    chair: true,
    metadata: { source: "direct_export" }
  });
  assert.equal(direct.meetingId, "meeting-participant-contract");
  assert.equal(direct.agentKey, "hermers:cat_body");
  assert.equal(direct.participantRole, "developer");
  assert.equal(await pathExists(path.join(root, "bridge", "participants.jsonl")), true);

  const dbFile = direct.dbFile;
  const runtimeAgentCountBeforeAlias = sqliteCount(dbFile, "runtime_agents");
  const alias = await runAction(root, {
    action: "runtime.participant",
    meetingId: "meeting-participant-contract",
    runtime: "hermers",
    agentId: "cat_body",
    participantRole: "reviewer",
    liveMode: "transparent",
    callerAgent: "local_codex",
    callerRuntime: "local_codex",
    sourceSystem: "local_codex"
  });
  assert.equal(alias.participantRole, "reviewer");
  assert.equal(sqliteCount(dbFile, "runtime_agents"), runtimeAgentCountBeforeAlias);
  const participantEvents = (await fs.readFile(path.join(root, "bridge", "participants.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    participantEvents.map((event) => event.participantRole),
    ["developer", "reviewer"]
  );
  assert.equal(participantEvents[1].agentKey, "hermers:cat_body");
  const participantRow = sqliteJson(dbFile, `
SELECT participant_role AS participantRole, chair, live_mode AS liveMode, status
FROM mixed_meeting_participants
WHERE meeting_id='meeting-participant-contract' AND agent_key='hermers:cat_body'
LIMIT 1;`)[0];
  assert.deepEqual(participantRow, { participantRole: "reviewer", chair: 0, liveMode: "transparent", status: "active" });

  await assert.rejects(
    () => meetingRuntimeParticipant(root, {
      meetingId: "meeting-participant-contract",
      runtime: "hermers",
      agentId: "cat_nose"
    }),
    /meeting runtime participant requires pre-registered active runtime agent: hermers:cat_nose/
  );
}

async function testMeetingIngestExtractedActionContracts() {
  assert.equal(MEETING_INGEST_ACTION_REGISTRY.has("meeting.ingest"), true, "meeting.ingest should be registered in the extracted meeting ingest registry");
  assert.equal(MEETING_INGEST_ACTION_HANDLER_NAMES["meeting.ingest"], "meetingIngest");
  assert.equal(typeof meetingIngest, "function");
  const directRegistry = createMeetingIngestActionRegistry({ meetingIngest });
  assert.equal(directRegistry.get("meeting.ingest"), meetingIngest);

  const root = await tempRoot("meeting-ingest-extracted-contracts");
  await runtimeAgentUpsert(root, {
    runtime: "hermers",
    agentId: "cat_body",
    displayName: "Cat Body",
    role: "developer",
    endpointRef: "hermers-profile:catbody"
  });
  const direct = await meetingIngest(root, {
    meetingId: "meeting-ingest-contract",
    runtime: "hermers",
    agentId: "cat_body",
    messageId: "msg-ingest-direct",
    messageType: "agent_message",
    phase: "prepare",
    text: "Direct meeting ingest contract message.",
    payload: { source: "direct_export" }
  });
  assert.equal(direct.meetingId, "meeting-ingest-contract");
  assert.equal(direct.messageId, "msg-ingest-direct");
  assert.equal(direct.runtime, "hermers");
  assert.equal(direct.agentId, "cat_body");
  assert.equal(direct.telegramOutbox, null);
  assert.equal(direct.reportOutbox, null);
  const transcriptFile = path.join(root, direct.transcriptPath);
  assert.equal(await pathExists(transcriptFile), true);

  const dbFile = direct.dbFile;
  const messageEvents = (await fs.readFile(path.join(root, "bridge", "messages", "meeting-ingest-contract.messages.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(messageEvents[0].messageId, "msg-ingest-direct");
  assert.equal(messageEvents[0].payload.source, "direct_export");
  const transcript = await fs.readFile(transcriptFile, "utf8");
  assert.equal(transcript.includes("[hermers:cat_body] Direct meeting ingest contract message."), true);
  const directRow = sqliteJson(dbFile, `
SELECT message_type AS messageType, telegram_live_status AS telegramLiveStatus, text
FROM mixed_meeting_messages
WHERE message_id='msg-ingest-direct'
LIMIT 1;`)[0];
  assert.deepEqual(directRow, {
    messageType: "agent_message",
    telegramLiveStatus: "pending",
    text: "Direct meeting ingest contract message."
  });

  await runAction(root, {
    action: "telegram.live.configure",
    meetingId: "meeting-ingest-contract",
    chatId: "-100123456",
    mode: "transparent",
    status: "active"
  });
  const live = await runAction(root, {
    action: "meeting.ingest",
    meetingId: "meeting-ingest-contract",
    runtime: "hermers",
    agentId: "cat_body",
    messageId: "msg-ingest-live",
    messageType: "agent_message",
    text: "Live meeting ingest contract message."
  });
  assert.equal(typeof live.telegramOutbox.outboxId, "string");
  assert.equal(live.telegramOutbox.outboxId.length > 0, true);
  assert.equal(live.reportOutbox, null);
  assert.equal(sqliteCount(dbFile, "telegram_outbox", "message_type='meeting_live' AND target_ref='-100123456' AND text='[hermers:cat_body] Live meeting ingest contract message.'"), 1);
  assert.equal(sqliteCount(dbFile, "mixed_meeting_messages", "message_id='msg-ingest-live' AND telegram_live_status='queued'"), 1);

  const report = await runAction(root, {
    action: "meeting.ingest",
    meetingId: "meeting-ingest-contract",
    runtime: "hermers",
    agentId: "cat_body",
    messageId: "msg-ingest-report",
    messageType: "workflow_secretary_report",
    text: "Report meeting ingest contract message.",
    payload: {
      workflowId: "wf-meeting-ingest-contract",
      dispatchId: "dispatch-meeting-ingest-contract"
    }
  });
  assert.equal(report.reportOutbox.outboxId, "report-dispatch-meeting-ingest-contract");
  assert.equal(sqliteCount(dbFile, "telegram_outbox", "outbox_id='report-dispatch-meeting-ingest-contract' AND target_ref='8390724843' AND message_type='workflow_secretary_report'"), 1);

  const flow = await runAction(root, {
    action: "workflow.message_flow.send",
    fromAgent: "tester",
    fromRuntime: "local_codex",
    targets: ["hermers:cat_body"],
    meetingId: "meeting-ingest-flow-contract",
    workflowId: "workflow-ingest-flow-contract",
    sourceMessageId: "msg-flow-ingress-contract",
    body: "recordIngress meeting ingest contract body",
    recordIngress: true,
    returnPolicy: "silent"
  });
  assert.equal(flow.targetCount, 1);
  assert.equal(sqliteCount(dbFile, "mixed_meeting_messages", "message_id='msg-flow-ingress-contract' AND meeting_id='meeting-ingest-flow-contract' AND message_type='internal_notice'"), 1);

  await assert.rejects(
    () => meetingIngest(root, {
      meetingId: "meeting-ingest-contract",
      runtime: "hermers",
      agentId: "cat_body",
      text: ""
    }),
    /text is required/
  );
}

async function testTopologyExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.topology": "workflowTopology",
    "trading_workflow.topology": "workflowTopology",
    "workflow.runtime_agents": "workflowRuntimeAgents",
    "workflow.runtime-agents": "workflowRuntimeAgents",
    "workflow.runtime.registry": "workflowRuntimeAgents"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(TOPOLOGY_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted topology registry`);
    assert.equal(TOPOLOGY_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowTopology, "function");
  assert.equal(typeof workflowRuntimeAgents, "function");
  const directRegistry = createTopologyActionRegistry({ workflowRuntimeAgents, workflowTopology });
  assert.equal(directRegistry.get("trading_workflow.topology"), workflowTopology);
  assert.equal(directRegistry.get("workflow.runtime.registry"), workflowRuntimeAgents);

  const root = await tempRoot("topology-extracted-contracts");
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "openclaw",
    runtime: "openclaw",
    agentId: "main",
    displayName: "Cat Brain",
    role: "governance",
    status: "active",
    canReceiveDispatch: true,
    workflowIngressAdapter: "openclaw_native",
    endpointRef: "openclaw-agent:main"
  });
  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_ears",
    displayName: "Cat Ears",
    role: "research",
    status: "active",
    canReceiveDispatch: true,
    workflowIngressAdapter: "acp",
    endpointRef: "hermers-profile:catears"
  });

  const topology = await runAction(root, { action: "trading_workflow.topology" });
  assert.equal(topology.workflowSchemaVersion, topology.schemaVersion);
  assert.equal(topology.topology.serverB.agents.includes("main"), true);
  assert.equal(topology.topology.serverB.agents.includes("cat_ears"), true);
  assert.equal(topology.runtimeRegistry.openclaw.some((agent) => agent.agentId === "main"), true);
  assert.equal(topology.runtimeRegistry.hermers.some((agent) => agent.agentId === "cat_ears"), true);
  assert.equal(topology.blockedPath, "Telegram/IM/plaintext commands cannot create ready_for_trading_core intents.");

  const registry = await runAction(root, { action: "workflow.runtime.registry" });
  assert.equal(registry.count >= 2, true);
  assert.equal(registry.derivedScopes.activeOpenClawAgentIds.includes("main"), true);
  assert.equal(registry.derivedScopes.activeOpenClawAgentIds.includes("cat_ears"), false);
  const hyphenAliasRegistry = await runAction(root, { action: "workflow.runtime-agents" });
  assert.equal(hyphenAliasRegistry.derivedScopes.activeOpenClawAgentIds.includes("main"), true);
  assert.equal(await pathExists(registry.snapshotFile), true);
  const snapshot = JSON.parse(await fs.readFile(registry.snapshotFile, "utf8"));
  assert.equal(snapshot.source.authority, "trading-agents-workflow.runtime_agents");
  assert.equal(snapshot.records.some((agent) => agent.agentId === "main" && agent.platform === "openclaw"), true);
  assert.equal(snapshot.records.some((agent) => agent.agentId === "cat_ears" && agent.platform === "hermers"), true);
  assert.equal(typeof snapshot.checksum, "string");
  assert.ok(snapshot.checksum.length > 0);
}

async function testStatusExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.init": "workflowInit",
    "trading_workflow.init": "workflowInit",
    "workflow.status": "workflowStatus",
    "trading_workflow.status": "workflowStatus",
    "workflow.health": "workflowHealth",
    "workflow.dashboard": "workflowHealth",
    "workflow.health.dashboard": "workflowHealth",
    "trading_workflow.health": "workflowHealth",
    "workflow.readiness": "workflowReadiness",
    "trading_workflow.readiness": "workflowReadiness"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(STATUS_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted status registry`);
    assert.equal(STATUS_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowHealth, "function");
  assert.equal(typeof workflowInit, "function");
  assert.equal(typeof workflowReadiness, "function");
  assert.equal(typeof workflowStatus, "function");
  const directRegistry = createStatusActionRegistry({
    workflowHealth,
    workflowInit,
    workflowReadiness,
    workflowStatus
  });
  assert.equal(directRegistry.get("trading_workflow.init"), workflowInit);
  assert.equal(directRegistry.get("trading_workflow.status"), workflowStatus);
  assert.equal(directRegistry.get("workflow.dashboard"), workflowHealth);
  assert.equal(directRegistry.get("workflow.health.dashboard"), workflowHealth);
  assert.equal(directRegistry.get("trading_workflow.health"), workflowHealth);
  assert.equal(directRegistry.get("trading_workflow.readiness"), workflowReadiness);

  const root = await tempRoot("status-extracted-contracts");
  const init = await runAction(root, { action: "trading_workflow.init" });
  assert.equal(init.workflowSchemaVersion, init.schemaVersion);
  assert.equal(init.root, root);
  assert.equal(await pathExists(init.dbFile), true);
  assert.equal(await pathExists(init.thesisDir), true);
  assert.equal(await pathExists(init.bridgeDir), true);

  await runAction(root, {
    action: "instrument.upsert",
    assetType: "stock",
    symbol: "AAPL",
    name: "Apple Inc."
  });
  const status = await runAction(root, {
    action: "trading_workflow.status",
    assetType: "stock",
    symbol: "AAPL"
  });
  assert.equal(status.workflowSchemaVersion, status.schemaVersion);
  assert.equal(status.root, root);
  assert.equal(status.dbFile, init.dbFile);
  assert.equal(Number(status.counts.instruments) >= 1, true);
  assert.equal(typeof status.readiness.status, "string");
  assert.equal(status.instrument.instrument_id, "stock:AAPL");
  assert.equal(status.instrument.symbol, "AAPL");

  const readiness = await runAction(root, { action: "trading_workflow.readiness" });
  assert.equal(typeof readiness.status, "string");
  assert.equal(typeof readiness.checkedAt, "string");
  assert.ok(readiness.planes);
  assert.ok(readiness.findings);

  const health = await runAction(root, { action: "workflow.dashboard" });
  assert.equal(health.schemaVersion, "workflow_health.v1");
  assert.equal(health.dbFile, init.dbFile);
  assert.ok(health.lanes);
  assert.ok(health.recommendations);
  const healthAlias = await runAction(root, { action: "workflow.health.dashboard" });
  assert.equal(healthAlias.schemaVersion, "workflow_health.v1");
  assert.equal(healthAlias.dbFile, init.dbFile);
}

async function testPermissionExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.permission.check": "workflowPermissionCheck",
    "workflow.permission.explain": "workflowPermissionCheck"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(PERMISSION_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted permission registry`);
    assert.equal(PERMISSION_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowPermissionCheck, "function");
  const directRegistry = createPermissionActionRegistry({ workflowPermissionCheck });
  assert.equal(directRegistry.get("workflow.permission.check"), workflowPermissionCheck);
  assert.equal(directRegistry.get("workflow.permission.explain"), workflowPermissionCheck);

  const root = await tempRoot("permission-extracted-contracts");
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

  const check = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "runtime.agent.upsert",
    callerAgent: "cat_body",
    callerRuntime: "hermers",
    sourceSystem: "hermers_mcp"
  });
  assert.equal(check.allowed, false);
  assert.equal(check.action, "runtime.agent.upsert");
  assert.equal(check.reason, "registry_write_local_codex_only");
  assert.equal(check.policyOutcome, "deny");
  assert.equal(await pathExists(check.dbFile), true);

  const explain = await runAction(root, {
    action: "workflow.permission.explain",
    targetAction: "workflow.status",
    callerAgent: "cat_body",
    callerRuntime: "hermers",
    sourceSystem: "hermers_mcp"
  });
  assert.equal(explain.allowed, true);
  assert.equal(explain.action, "workflow.status");
  assert.equal(explain.requiredCapability, "read");
  assert.equal(explain.caller.agentId, "cat_body");
  assert.equal(explain.dbFile, check.dbFile);
}

async function testScheduleExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.schedule.upsert": "workflowScheduleUpsert",
    "workflow.scheduler.upsert": "workflowScheduleUpsert",
    "workflow.schedule.list": "workflowScheduleList",
    "workflow.schedules": "workflowScheduleList",
    "workflow.scheduler.list": "workflowScheduleList",
    "workflow.schedule.pause": "workflowSchedulePause",
    "workflow.scheduler.pause": "workflowSchedulePause",
    "workflow.schedule.resume": "workflowScheduleResume",
    "workflow.scheduler.resume": "workflowScheduleResume",
    "workflow.schedule.disable": "workflowScheduleDisable",
    "workflow.scheduler.disable": "workflowScheduleDisable"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(SCHEDULE_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted schedule registry`);
    assert.equal(SCHEDULE_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowScheduleUpsert, "function");
  assert.equal(typeof workflowScheduleList, "function");
  assert.equal(typeof workflowSchedulePause, "function");
  assert.equal(typeof workflowScheduleResume, "function");
  assert.equal(typeof workflowScheduleDisable, "function");
  const directRegistry = createScheduleActionRegistry({
    workflowScheduleDisable,
    workflowScheduleList,
    workflowSchedulePause,
    workflowScheduleResume,
    workflowScheduleUpsert
  });
  assert.equal(directRegistry.get("workflow.scheduler.upsert"), workflowScheduleUpsert);
  assert.equal(directRegistry.get("workflow.schedules"), workflowScheduleList);
  assert.equal(directRegistry.get("workflow.scheduler.pause"), workflowSchedulePause);
  assert.equal(directRegistry.get("workflow.scheduler.resume"), workflowScheduleResume);
  assert.equal(directRegistry.get("workflow.scheduler.disable"), workflowScheduleDisable);

  const root = await tempRoot("schedule-extracted-contracts");
  const nextRunAt = "2099-01-01T00:00:00.000Z";
  const upserted = await runAction(root, {
    action: "workflow.scheduler.upsert",
    scheduleId: "schedule-extracted-contract",
    runtime: "openclaw",
    agentId: "main",
    prompt: "schedule extracted action contract",
    scheduleKind: "interval",
    intervalSeconds: 3600,
    nextRunAt,
    payload: { contract: true }
  });
  assert.equal(upserted.schedule.scheduleId, "schedule-extracted-contract");
  assert.equal(upserted.schedule.status, "active");
  assert.equal(upserted.schedule.nextRunAt, nextRunAt);
  assert.deepEqual(upserted.schedule.payload, { contract: true });

  const listed = await runAction(root, {
    action: "workflow.schedules",
    scheduleId: "schedule-extracted-contract"
  });
  assert.equal(listed.count, 1);
  assert.equal(listed.schedules[0].scheduleId, "schedule-extracted-contract");
  assert.equal(listed.dbFile, upserted.dbFile);

  const paused = await runAction(root, {
    action: "workflow.scheduler.pause",
    scheduleId: "schedule-extracted-contract"
  });
  assert.equal(paused.schedule.status, "paused");
  const resumed = await runAction(root, {
    action: "workflow.schedule.resume",
    scheduleId: "schedule-extracted-contract"
  });
  assert.equal(resumed.schedule.status, "active");
  assert.equal(resumed.schedule.nextRunAt, nextRunAt);
  const disabled = await runAction(root, {
    action: "workflow.scheduler.disable",
    scheduleId: "schedule-extracted-contract"
  });
  assert.equal(disabled.schedule.status, "disabled");
  assert.equal(sqliteCount(upserted.dbFile, "workflow_schedules", "schedule_id='schedule-extracted-contract' AND status='disabled'"), 1);
}

async function testEventExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.event.append": "workflowEventAppend",
    "workflow.events.append": "workflowEventAppend",
    "workflow.event.list": "workflowEventList",
    "workflow.events": "workflowEventList",
    "workflow.events.list": "workflowEventList",
    "workflow.event.timeline": "workflowEventTimeline",
    "workflow.timeline": "workflowEventTimeline",
    "workflow.events.timeline": "workflowEventTimeline"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(EVENT_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted event registry`);
    assert.equal(EVENT_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowEventAppend, "function");
  assert.equal(typeof workflowEventList, "function");
  assert.equal(typeof workflowEventTimeline, "function");
  const directRegistry = createEventActionRegistry({
    workflowEventAppend,
    workflowEventList,
    workflowEventTimeline
  });
  assert.equal(directRegistry.get("workflow.events.append"), workflowEventAppend);
  assert.equal(directRegistry.get("workflow.events"), workflowEventList);
  assert.equal(directRegistry.get("workflow.timeline"), workflowEventTimeline);

  const root = await tempRoot("event-extracted-contracts");
  const first = await runAction(root, {
    action: "workflow.events.append",
    eventId: "event-extracted-created",
    eventType: "workflow.created",
    workflowId: "event-extracted",
    traceId: "trace-event-extracted",
    actor: "local_codex",
    sourceRuntime: "local_codex",
    nextState: "active",
    idempotencyKey: "event-extracted-created",
    createdAt: "2099-01-01T00:00:01.000Z",
    payload: {
      summary: "event extracted action contract",
      callbackToken: "must-not-persist"
    }
  });
  assert.equal(first.eventId, "event-extracted-created");
  assert.equal(first.eventType, "workflow.created");
  assert.equal(first.payload.callbackToken, "[redacted]");

  const second = await runAction(root, {
    action: "workflow.event.append",
    eventId: "event-extracted-dispatch",
    eventType: "dispatch.created",
    workflowId: "event-extracted",
    traceId: "trace-event-extracted",
    dispatchId: "dispatch-event-extracted",
    nextState: "queued",
    createdAt: "2099-01-01T00:00:02.000Z",
    payload: { dispatchId: "dispatch-event-extracted" }
  });
  assert.equal(second.dispatchId, "dispatch-event-extracted");
  const duplicate = await runAction(root, {
    action: "workflow.event.append",
    eventId: "event-extracted-created",
    eventType: "workflow.created",
    workflowId: "event-extracted",
    traceId: "trace-event-extracted",
    actor: "local_codex",
    sourceRuntime: "local_codex",
    nextState: "active",
    idempotencyKey: "event-extracted-created",
    createdAt: "2099-01-01T00:00:01.000Z",
    payload: {
      summary: "event extracted action contract",
      callbackToken: "must-not-persist"
    }
  });
  assert.equal(duplicate.deduped, true);

  const list = await runAction(root, {
    action: "workflow.events.list",
    workflowId: "event-extracted",
    limit: 10
  });
  assert.deepEqual(list.events.map((event) => event.eventType), ["dispatch.created", "workflow.created"]);
  const timeline = await runAction(root, {
    action: "workflow.events.timeline",
    traceId: "trace-event-extracted",
    limit: 10
  });
  assert.deepEqual(timeline.events.map((event) => event.eventType), ["workflow.created", "dispatch.created"]);
  assert.equal(sqliteCount(first.dbFile, "workflow_events", "workflow_id='event-extracted'"), 2);
}

async function testRuntimeEventExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.runtime_event.record": "workflowRuntimeEventRecord",
    "workflow.runtime.event.record": "workflowRuntimeEventRecord",
    "workflow.runtime-event.record": "workflowRuntimeEventRecord",
    "runtime.semantic.event": "workflowRuntimeEventRecord",
    "runtime.semantic.record": "workflowRuntimeEventRecord",
    "workflow.runtime_event.list": "workflowRuntimeEventList",
    "workflow.runtime.event.list": "workflowRuntimeEventList",
    "workflow.runtime-events": "workflowRuntimeEventList",
    "workflow.runtime.events": "workflowRuntimeEventList",
    "workflow.runtime_current_state": "workflowRuntimeCurrentState",
    "workflow.runtime_event.current": "workflowRuntimeCurrentState",
    "workflow.runtime.current": "workflowRuntimeCurrentState",
    "workflow.runtime_current": "workflowRuntimeCurrentState",
    "runtime.current_state": "workflowRuntimeCurrentState"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(RUNTIME_EVENT_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted runtime event registry`);
    assert.equal(RUNTIME_EVENT_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowRuntimeEventRecord, "function");
  assert.equal(typeof workflowRuntimeEventList, "function");
  assert.equal(typeof workflowRuntimeCurrentState, "function");
  const directRegistry = createRuntimeEventActionRegistry({
    workflowRuntimeCurrentState,
    workflowRuntimeEventList,
    workflowRuntimeEventRecord
  });
  assert.equal(directRegistry.get("workflow.runtime.event.record"), workflowRuntimeEventRecord);
  assert.equal(directRegistry.get("workflow.runtime.event.list"), workflowRuntimeEventList);
  assert.equal(directRegistry.get("workflow.runtime.current"), workflowRuntimeCurrentState);
  assert.equal(directRegistry.get("runtime.semantic.event"), workflowRuntimeEventRecord);
  assert.equal(directRegistry.get("workflow.runtime-events"), workflowRuntimeEventList);
  assert.equal(directRegistry.get("runtime.current_state"), workflowRuntimeCurrentState);

  const root = await tempRoot("runtime-event-extracted-contracts");
  const workflowId = "runtime-event-extracted";
  const recorded = await runAction(root, {
    action: "workflow.runtime.event.record",
    eventType: "semantic_ack",
    eventTime: "2099-01-01T00:00:01.000Z",
    workflowId,
    taskId: "task-runtime-event-extracted",
    dispatchId: "dispatch-runtime-event-extracted",
    traceId: "trace-runtime-event-extracted",
    runtime: "hermers",
    agentId: "cat_body",
    runtimeRunId: "runtime-run-event-extracted",
    stage: "runtime_event_extracted_contract",
    idempotencyKey: "runtime-event-extracted-semantic-ack",
    payload: {
      summary: "runtime event extracted action contract",
      callbackToken: "must-not-persist"
    }
  });
  assert.equal(recorded.schemaVersion, "workflow_runtime_semantic_event.v1");
  assert.equal(recorded.event.eventType, "semantic_ack");
  assert.equal(recorded.event.runtime, "hermers");
  assert.equal(recorded.event.agentId, "cat_body");
  assert.equal(recorded.event.payload.callbackToken, "[redacted]");
  assert.equal(recorded.currentState.status, "working");
  assert.equal(recorded.currentState.activeDispatchId, "dispatch-runtime-event-extracted");

  const duplicate = await runAction(root, {
    action: "workflow.runtime_event.record",
    eventType: "semantic_ack",
    eventTime: "2099-01-01T00:00:01.000Z",
    workflowId,
    taskId: "task-runtime-event-extracted",
    dispatchId: "dispatch-runtime-event-extracted",
    traceId: "trace-runtime-event-extracted",
    runtime: "hermers",
    agentId: "cat_body",
    runtimeRunId: "runtime-run-event-extracted",
    stage: "runtime_event_extracted_contract",
    idempotencyKey: "runtime-event-extracted-semantic-ack",
    payload: {
      summary: "runtime event extracted action contract",
      callbackToken: "must-not-persist"
    }
  });
  assert.equal(duplicate.event.deduped, true);

  const listed = await runAction(root, {
    action: "workflow.runtime.event.list",
    workflowId,
    runtime: "hermers",
    agentId: "cat_body",
    order: "asc"
  });
  assert.equal(listed.schemaVersion, "workflow_runtime_semantic_events.v1");
  assert.equal(listed.count, 1);
  assert.equal(listed.events[0].eventType, "semantic_ack");
  assert.equal(JSON.stringify(listed.events).includes("must-not-persist"), false);

  const current = await runAction(root, {
    action: "workflow.runtime.current",
    workflowId,
    runtime: "hermers",
    agentId: "cat_body"
  });
  assert.equal(current.schemaVersion, "workflow_runtime_current_state.v1");
  assert.equal(current.count, 1);
  assert.equal(current.states[0].activeDispatchId, "dispatch-runtime-event-extracted");
  assert.equal(current.states[0].semanticAckAt, "2099-01-01T00:00:01.000Z");
  assert.equal(sqliteCount(recorded.dbFile, "runtime_semantic_events", "workflow_id='runtime-event-extracted'"), 1);
}

async function testSessionExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.session_pack.upsert": "workflowSessionPackUpsert",
    "workflow.session.pack.upsert": "workflowSessionPackUpsert",
    "session_pack.upsert": "workflowSessionPackUpsert",
    "workflow.session_pack.get": "workflowSessionPackGet",
    "workflow.session.pack.get": "workflowSessionPackGet",
    "session_pack.get": "workflowSessionPackGet",
    "workflow.session_pack.list": "workflowSessionPackList",
    "workflow.session.pack.list": "workflowSessionPackList",
    "session_pack.list": "workflowSessionPackList",
    "workflow.session_run.start": "workflowSessionRunStart",
    "workflow.session.run.start": "workflowSessionRunStart",
    "session_run.start": "workflowSessionRunStart",
    "workflow.session_run.complete": "workflowSessionRunComplete",
    "workflow.session.run.complete": "workflowSessionRunComplete",
    "session_run.complete": "workflowSessionRunComplete"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(SESSION_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted session registry`);
    assert.equal(SESSION_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowSessionPackUpsert, "function");
  assert.equal(typeof workflowSessionPackGet, "function");
  assert.equal(typeof workflowSessionPackList, "function");
  assert.equal(typeof workflowSessionRunStart, "function");
  assert.equal(typeof workflowSessionRunComplete, "function");
  const directRegistry = createSessionActionRegistry({
    workflowSessionPackGet,
    workflowSessionPackList,
    workflowSessionPackUpsert,
    workflowSessionRunComplete,
    workflowSessionRunStart
  });
  assert.equal(directRegistry.get("workflow.session.pack.upsert"), workflowSessionPackUpsert);
  assert.equal(directRegistry.get("session_pack.get"), workflowSessionPackGet);
  assert.equal(directRegistry.get("session_pack.list"), workflowSessionPackList);
  assert.equal(directRegistry.get("workflow.session.run.start"), workflowSessionRunStart);
  assert.equal(directRegistry.get("session_run.complete"), workflowSessionRunComplete);

  const root = await tempRoot("session-extracted-contracts");
  const pack = await runAction(root, {
    action: "workflow.session.pack.upsert",
    sessionId: "session-extracted-pack",
    ownerAgent: "cat_body",
    taskType: "extracted_session_contract",
    runtimeTarget: "worker:local_codex",
    purpose: "Exercise extracted session action registry.",
    metadata: { apiKey: "must-not-persist" }
  });
  assert.equal(pack.sessionId, "session-extracted-pack");
  assert.equal(pack.version, 1);
  assert.equal(pack.metadata.apiKey, "[redacted]");

  const listed = await runAction(root, {
    action: "workflow.session.pack.list",
    ownerAgent: "cat_body",
    taskType: "extracted_session_contract"
  });
  assert.equal(listed.count, 1);
  assert.equal(listed.packs[0].sessionId, "session-extracted-pack");
  const got = await runAction(root, {
    action: "workflow.session.pack.get",
    sessionId: "session-extracted-pack"
  });
  assert.equal(got.workerInputTemplate.sessionId, "session-extracted-pack");
  assert.equal(JSON.stringify(got).includes("must-not-persist"), false);

  const started = await runAction(root, {
    action: "workflow.session.run.start",
    runId: "session-extracted-run",
    sessionId: "session-extracted-pack",
    workflowId: "workflow-session-extracted",
    taskId: "task-session-extracted",
    dispatchId: "dispatch-session-extracted",
    workerId: "worker-session-extracted",
    input: { symbol: "BTCUSDT", apiSecret: "run-secret" }
  });
  assert.equal(started.status, "running");
  assert.equal(started.workerInput.input.apiSecret, "[redacted]");
  assert.equal(JSON.stringify(started.workerInput).includes("run-secret"), false);

  const completed = await runAction(root, {
    action: "workflow.session.run.complete",
    runId: "session-extracted-run",
    output: { status: "ok", refreshToken: "output-secret" },
    receiptRef: "artifact://session-extracted-receipt"
  });
  assert.equal(completed.status, "completed");
  assert.equal(completed.output.refreshToken, "[redacted]");
  assert.equal(completed.receiptRef, "artifact://session-extracted-receipt");
  assert.equal(sqliteCount(pack.dbFile, "workflow_session_packs", "session_id='session-extracted-pack'"), 1);
  assert.equal(sqliteCount(pack.dbFile, "workflow_session_runs", "run_id='session-extracted-run' AND status='completed'"), 1);
  assert.equal(sqliteCount(pack.dbFile, "workflow_agent_runs", "agent_run_id='session.session-extracted-run' AND dispatch_id='dispatch-session-extracted' AND status='completed'"), 1);
}

async function testCheckpointExtractedActionContracts() {
  const expectedHandlers = {
    "workflow.checkpoint": "workflowCheckpoint",
    "workflow.context_checkpoint": "workflowCheckpoint",
    "context.checkpoint": "workflowCheckpoint"
  };
  for (const [action, handlerName] of Object.entries(expectedHandlers)) {
    assert.equal(CHECKPOINT_ACTION_REGISTRY.has(action), true, `${action} should be registered in the extracted checkpoint registry`);
    assert.equal(CHECKPOINT_ACTION_HANDLER_NAMES[action], handlerName, `${action} should map to the extracted ${handlerName} handler`);
  }
  assert.equal(typeof workflowCheckpoint, "function");
  const directRegistry = createCheckpointActionRegistry({ workflowCheckpoint });
  assert.equal(directRegistry.get("workflow.context_checkpoint"), workflowCheckpoint);
  assert.equal(directRegistry.get("context.checkpoint"), workflowCheckpoint);

  const root = await tempRoot("checkpoint-extracted-contracts");
  const workflowId = "workflow-checkpoint-extracted";
  await runAction(root, {
    action: "workflow.run.upsert",
    workflowId,
    status: "active",
    summary: "Checkpoint extracted action contract.",
    objective: "Exercise extracted checkpoint action registry.",
    acceptanceCriteria: "Checkpoint contains active tasks, blocked tasks, artifacts, and resume payload."
  });
  await runAction(root, {
    action: "workflow.task.create",
    workflowId,
    taskId: "task-checkpoint-active",
    phase: "execute",
    status: "in_progress",
    ownerAgent: "cat_body",
    runtime: "hermers",
    agentId: "cat_body",
    actualArtifactRef: "artifact://task-checkpoint-active",
    summary: "Active checkpoint task"
  });
  await runAction(root, {
    action: "workflow.task.create",
    workflowId,
    taskId: "task-checkpoint-blocked",
    phase: "execute",
    status: "blocked",
    ownerAgent: "cat_ears",
    runtime: "hermers",
    agentId: "cat_ears",
    summary: "Blocked checkpoint task"
  });
  const dbFile = path.join(root, "tracking.db");
  sqliteExec(dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES ('artifact-checkpoint-evidence', '${workflowId}', 'evidence', 'artifact://checkpoint-evidence', 'Checkpoint evidence', 'local_codex', '2099-01-01T00:00:01.000Z');`);

  const checkpoint = await runAction(root, {
    action: "workflow.context_checkpoint",
    workflowId,
    checkpointId: "checkpoint-extracted",
    summary: "Extracted checkpoint action contract.",
    nextActions: ["continue_active_task", "resolve_blocked_task"],
    tokenBudget: 2048,
    compactAtPercent: 65,
    restorePolicy: "load_checkpoint_only",
    createdBy: "local_codex"
  });
  assert.equal(checkpoint.checkpointId, "checkpoint-extracted");
  assert.equal(checkpoint.workflowId, workflowId);
  assert.equal(checkpoint.status, "active");
  assert.equal(checkpoint.resumePayload.counts.activeTasks, 1);
  assert.equal(checkpoint.resumePayload.counts.blockedTasks, 1);
  assert.equal(checkpoint.resumePayload.activeTaskIds.includes("task-checkpoint-active"), true);
  assert.equal(checkpoint.resumePayload.blockedTaskIds.includes("task-checkpoint-blocked"), true);
  assert.equal(checkpoint.resumePayload.artifactRefs.includes("artifact://checkpoint-evidence"), true);
  assert.equal(checkpoint.resumePayload.artifactRefs.includes("artifact://task-checkpoint-active"), true);
  assert.equal(checkpoint.relativePath.includes("checkpoint-extracted"), true);
  assert.equal(checkpoint.jsonRelativePath.includes("checkpoint-extracted"), true);

  const row = sqliteJson(dbFile, `
SELECT active_tasks_json AS activeTasksJson, blocked_tasks_json AS blockedTasksJson,
  artifact_refs_json AS artifactRefsJson, next_actions_json AS nextActionsJson,
  context_budget_json AS contextBudgetJson, path, created_by AS createdBy
FROM workflow_checkpoints
WHERE checkpoint_id='checkpoint-extracted'
LIMIT 1;`)[0];
  assert.equal(Boolean(row), true);
  assert.equal(row.createdBy, "local_codex");
  assert.equal(row.path, checkpoint.relativePath);
  assert.equal(JSON.parse(row.activeTasksJson).some((task) => task.task_id === "task-checkpoint-active"), true);
  assert.equal(JSON.parse(row.blockedTasksJson).some((task) => task.task_id === "task-checkpoint-blocked"), true);
  assert.equal(JSON.parse(row.artifactRefsJson).some((artifact) => artifact.path === "artifact://checkpoint-evidence"), true);
  assert.deepEqual(JSON.parse(row.nextActionsJson), ["continue_active_task", "resolve_blocked_task"]);
  assert.equal(JSON.parse(row.contextBudgetJson).tokenBudget, 2048);
  assert.equal(JSON.parse(row.contextBudgetJson).compactAtPercent, 65);
  assert.equal(JSON.parse(row.contextBudgetJson).restorePolicy, "load_checkpoint_only");
  assert.equal(sqliteCount(dbFile, "artifact_index", "artifact_id='checkpoint-extracted' AND kind='workflow_checkpoint'"), 1);

  const markdown = await fs.readFile(path.join(root, checkpoint.relativePath), "utf8");
  const json = JSON.parse(await fs.readFile(path.join(root, checkpoint.jsonRelativePath), "utf8"));
  assert.equal(markdown.includes("Extracted checkpoint action contract."), true);
  assert.equal(json.activeTasks.some((task) => task.task_id === "task-checkpoint-active"), true);
  assert.equal(json.blockedTasks.some((task) => task.task_id === "task-checkpoint-blocked"), true);

  const coreAliasCheckpoint = await runAction(root, {
    action: "context.checkpoint",
    workflowId,
    checkpointId: "checkpoint-extracted-core-alias",
    summary: "Core alias checkpoint contract.",
    nextActions: ["core_alias_checkpoint"],
    createdBy: "local_codex"
  });
  assert.equal(coreAliasCheckpoint.checkpointId, "checkpoint-extracted-core-alias");
  assert.equal(coreAliasCheckpoint.workflowId, workflowId);

  const directExportCheckpoint = await workflowCheckpoint(root, {
    workflowId,
    checkpointId: "checkpoint-extracted-direct-export",
    summary: "Direct export checkpoint contract.",
    nextActions: ["direct_export_checkpoint"],
    createdBy: "local_codex"
  });
  assert.equal(directExportCheckpoint.checkpointId, "checkpoint-extracted-direct-export");
  assert.equal(directExportCheckpoint.workflowId, workflowId);

  const supervised = await runAction(root, {
    action: "workflow.supervise",
    workflowId,
    autoDispatch: false,
    autoReport: false,
    drain: false,
    checkpoint: true,
    summary: "Supervisor direct caller checkpoint contract.",
    nextActions: ["supervisor_checkpoint"]
  });
  assert.equal(supervised.checkpoint.workflowId, workflowId);
  assert.equal(supervised.checkpoint.resumePayload.nextActions.includes("supervisor_checkpoint"), true);
  assert.equal(sqliteCount(dbFile, "workflow_checkpoints", "checkpoint_id IN ('checkpoint-extracted', 'checkpoint-extracted-core-alias', 'checkpoint-extracted-direct-export')"), 3);
  assert.equal(sqliteCount(dbFile, "workflow_checkpoints", "summary='Supervisor direct caller checkpoint contract.'"), 1);

  const archiveRequest = await requestHumanGate(root, {
    workflowId,
    meetingId: workflowId,
    text: "猫爪正式汇报：checkpoint archive direct caller 回归测试，请选择方案或终止收口控制。",
    buttons: planButtons()
  });
  const terminateButton = archiveRequest.buttons.find((button) => button.decisionStatus === "terminated" || button.buttonRole === "terminate");
  assert.equal(Boolean(terminateButton?.callbackToken), true);
  const archived = await runAction(root, {
    action: "human_gate.resume",
    token: terminateButton.callbackToken,
    text: "闪电猫原话：确认该 checkpoint 抽取测试归档收口。"
  });
  assert.equal(archived.workflowDecision.archived, true);
  assert.equal(archived.archiveCheckpoint.workflowId, workflowId);
  assert.equal(archived.archiveCheckpoint.resumePayload.nextActions.includes("cat_brain main closes workflow state, confirms no pending unsafe side effects remain, and records resume boundary."), true);
  assert.equal(sqliteCount(dbFile, "workflow_checkpoints", "summary LIKE 'Flashcat selected Human Gate closeout button:%'"), 1);
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
	  assert.equal(draft.spec.planSpecV2.humanGatePolicy.optionsMinimum, 2);
	  assert.equal(draft.spec.planSpecV2.humanGatePolicy.optionsMaximum, 5);
	  assert.equal(draft.spec.planSpecV2.humanGatePolicy.requiresOriginalWords, true);
  assert.equal(draft.spec.planSpecV2.humanGatePolicy.submitterAgent, "cat_claw");
  assert.equal(draft.spec.planSpecV2.evidencePolicy.rawLogsInPlan, false);
  assert.ok(draft.spec.participants.some((participant) => participant.agentId === "main"));
  assert.ok(draft.spec.participants.some((participant) => participant.agentId === "cat_claw"));
	  assert.ok(draft.spec.participants.some((participant) => participant.agentId === "cat_heart"));
	  assert.equal(draft.spec.appendix.template, "stock_longterm_tracking");
	  assert.equal(draft.spec.humanGateDraft.options.length >= 2, true);
	  assert.equal(draft.spec.humanGateDraft.options.length <= 5, true);
	  assert.ok(draft.spec.humanGateDraft.controls.some((control) => control.id === "pause_workflow"));
  assert.ok(draft.spec.humanGateDraft.controls.some((control) => control.id === "terminate_workflow"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "cat_claw_secretary_present" && gate.status === "pass"));
  assert.ok(draft.spec.qualityGates.some((gate) => gate.name === "approve_options_count_required" && gate.status === "pass"));
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

async function testWorkflowV2PermissionAndConsoleGate() {
  const root = await tempRoot("workflow-v2-permission-console");
  const dbFile = path.join(root, "tracking.db");
  const bridgeDir = path.join(root, "bridge");

  const previewPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.plan.preview"
  });
  assert.equal(previewPolicy.allowed, true);
  assert.equal(previewPolicy.readOnly, true);
  assert.equal(previewPolicy.requiredCapability, "read");
  const readPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.info_stack.read"
  });
  assert.equal(readPolicy.allowed, true);
  assert.equal(readPolicy.readOnly, true);
  const controlPreviewPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.control_loop.preview"
  });
  assert.equal(controlPreviewPolicy.allowed, true);
  assert.equal(controlPreviewPolicy.readOnly, true);
  const lifecyclePreviewPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_lifecycle.preview"
  });
  assert.equal(lifecyclePreviewPolicy.allowed, true);
  assert.equal(lifecyclePreviewPolicy.readOnly, true);
  const handoffPreviewPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_handoff.preview"
  });
  assert.equal(handoffPreviewPolicy.allowed, true);
  assert.equal(handoffPreviewPolicy.readOnly, true);
  const successorPreviewPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_successor.preview"
  });
  assert.equal(successorPreviewPolicy.allowed, true);
  assert.equal(successorPreviewPolicy.readOnly, true);
  const adapterRunnerPreviewPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.adapter_runner.preview"
  });
  assert.equal(adapterRunnerPreviewPolicy.allowed, true);
  assert.equal(adapterRunnerPreviewPolicy.readOnly, true);

  const writePolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_spawn.create",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(writePolicy.allowed, false);
  assert.equal(writePolicy.reason, "caller_not_registered");
  assert.equal(writePolicy.requiredCapability, "workflow.worker.spawn");
  const lifecycleWritePolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_handoff.record",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(lifecycleWritePolicy.allowed, false);
  assert.equal(lifecycleWritePolicy.requiredCapability, "workflow.worker.lifecycle");

  await runAction(root, {
    action: "runtime.agent.upsert",
    platform: "hermers",
    runtime: "hermers",
    agentId: "cat_body",
    capabilities: { permissions: ["workflow.worker.spawn"] }
  });
  const allowedWritePolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_spawn.create",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(allowedWritePolicy.allowed, true);
  assert.equal(allowedWritePolicy.requiredCapability, "workflow.worker.spawn");
  const tickPolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.control_loop.tick",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(tickPolicy.allowed, false);
  assert.equal(tickPolicy.requiredCapability, "workflow.worker.control_loop");
  const resultWritePolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_result.submit",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(resultWritePolicy.allowed, false);
  assert.equal(resultWritePolicy.requiredCapability, "workflow.worker.result");
  const adapterRunnerWritePolicy = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.adapter_runner.drain",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(adapterRunnerWritePolicy.allowed, false);
  assert.equal(adapterRunnerWritePolicy.requiredCapability, "workflow.worker.adapter_runner");
  const lifecycleWritePolicyMissingCapability = await runAction(root, {
    action: "workflow.permission.check",
    targetAction: "workflow.v2.worker_successor.create",
    callerAgent: "cat_body",
    callerRuntime: "hermers"
  });
  assert.equal(lifecycleWritePolicyMissingCapability.allowed, false);
  assert.equal(lifecycleWritePolicyMissingCapability.requiredCapability, "workflow.worker.lifecycle");

  const consoleInfo = await runAction(root, {
    action: "workflow.v2.info_stack.record",
    workflowId: "wf-v2-console",
    infoId: "info-v2-console-read",
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef: "artifact://workflow-v2/console-read.json",
    recipientAgent: "cat_body",
    summary: "Console read-only info item."
  });
  const gateway = new WorkflowActionGateway({ root, dbFile, bridgeDir }, { readOnly: true });
  const gatewayPreview = await gateway.handle({
    action: "workflow.v2.plan.preview",
    actor: "flashcat",
    reason: "v2 plan preview token abc",
    payload: {
      workflowId: "wf-v2-console",
      objective: "Preview via console gateway.",
      ...v2PlanContract({ workerBudget: { maxWorkers: 2, concurrencyLimit: 1, maxWorkerContextTokens: 64000 } })
    }
  });
  assert.equal(gatewayPreview.ok, true);
  assert.equal(gatewayPreview.dryRun, true);
  assert.equal(gatewayPreview.result.valid, true);
  const gatewayControlPreview = await gateway.handle({
    action: "workflow.v2.control_loop.preview",
    actor: "flashcat",
    reason: "v2 control loop preview",
    payload: {
      workflowId: "wf-v2-console"
    }
  });
  assert.equal(gatewayControlPreview.ok, true);
  assert.equal(gatewayControlPreview.result.status, "ok");
  assert.equal(Number(gatewayControlPreview.result.counts.total || 0), 0);
  const gatewayLifecyclePreview = await gateway.handle({
    action: "workflow.v2.worker_lifecycle.preview",
    actor: "flashcat",
    reason: "v2 worker lifecycle preview",
    payload: {
      workerRunId: "missing-worker"
    }
  });
  assert.equal(gatewayLifecyclePreview.ok, true);
  assert.equal(gatewayLifecyclePreview.result.valid, false);
  assert.equal(Boolean(gatewayLifecyclePreview.result.errors.some((item) => item.code === "worker_run_not_found")), true);
  const gatewayHandoffPreview = await gateway.handle({
    action: "workflow.v2.worker_handoff.preview",
    actor: "flashcat",
    reason: "v2 worker handoff preview",
    payload: {
      workerRunId: "missing-worker",
      callerAgent: "cat_body",
      summary: "Preview missing worker handoff.",
      artifactRef: "artifact://workflow-v2/missing-handoff.json"
    }
  });
  assert.equal(gatewayHandoffPreview.ok, true);
  assert.equal(gatewayHandoffPreview.result.valid, false);
  assert.equal(Boolean(gatewayHandoffPreview.result.errors.some((item) => item.code === "worker_run_not_found")), true);
  const gatewayResultPreview = await gateway.handle({
    action: "workflow.v2.worker_result.submit.preview",
    actor: "flashcat",
    reason: "v2 worker result preview",
    payload: {
      workerRunId: "missing-worker",
      leaseOwner: "nobody",
      leaseUntil: "2026-07-03T00:00:00.000Z",
      artifactRef: "artifact://workflow-v2/missing-output.json",
      receiptRef: "receipt://workflow-v2/missing"
    }
  });
  assert.equal(gatewayResultPreview.ok, true);
  assert.equal(gatewayResultPreview.result.valid, false);
  assert.equal(Boolean(gatewayResultPreview.result.errors.some((item) => item.code === "worker_run_not_found")), true);
  const gatewayAdapterRunnerPreview = await gateway.handle({
    action: "workflow.v2.adapter_runner.preview",
    actor: "flashcat",
    reason: "v2 adapter runner preview",
    payload: {
      workflowId: "wf-v2-console"
    }
  });
  assert.equal(gatewayAdapterRunnerPreview.ok, true);
  assert.equal(gatewayAdapterRunnerPreview.result.count, 0);
  const gatewayInfoRead = await gateway.handle({
    action: "workflow.v2.info_stack.read",
    actor: "flashcat",
    reason: "v2 info stack read",
    payload: {
      infoId: "info-v2-console-read",
      inboxItemId: consoleInfo.inboxItem.inboxItemId,
      principalKind: "agent",
      principalId: "cat_body"
    }
  });
  assert.equal(gatewayInfoRead.ok, true);
  assert.equal(gatewayInfoRead.result.item.infoId, "info-v2-console-read");
  const gatewayValidate = await gateway.handle({
    action: "workflow.v2.validate",
    actor: "flashcat",
    reason: "v2 validate read-only",
    payload: {
      workflowId: "wf-v2-console"
    }
  });
  assert.equal(gatewayValidate.ok, true);
  assert.equal(gatewayValidate.result.ok, true);

  const rejectedWrite = await gateway.handle({
    action: "workflow.v2.plan.create",
    actor: "flashcat",
    reason: "write remains opt-in",
    payload: {
      workflowId: "wf-v2-console",
      objective: "This write should be rejected by default console gateway."
    }
  });
  assert.equal(rejectedWrite.ok, false);
  assert.equal(rejectedWrite.errorCode, "action_not_allowed");
  const rejectedTick = await gateway.handle({
    action: "workflow.v2.control_loop.tick",
    actor: "flashcat",
    reason: "tick remains opt-in",
    payload: {
      workflowId: "wf-v2-console"
    }
  });
  assert.equal(rejectedTick.ok, false);
  assert.equal(rejectedTick.errorCode, "action_not_allowed");
  const rejectedResultSubmit = await gateway.handle({
    action: "workflow.v2.worker_result.submit",
    actor: "flashcat",
    reason: "worker result remains opt-in",
    payload: {
      workerRunId: "missing-worker"
    }
  });
  assert.equal(rejectedResultSubmit.ok, false);
  assert.equal(rejectedResultSubmit.errorCode, "action_not_allowed");
  const rejectedHandoffRecord = await gateway.handle({
    action: "workflow.v2.worker_handoff.record",
    actor: "flashcat",
    reason: "worker handoff write remains opt-in",
    payload: {
      workerRunId: "missing-worker",
      callerAgent: "cat_body",
      summary: "This write should be rejected by console gateway.",
      artifactRef: "artifact://workflow-v2/rejected-handoff.json"
    }
  });
  assert.equal(rejectedHandoffRecord.ok, false);
  assert.equal(rejectedHandoffRecord.errorCode, "action_not_allowed");
  const rejectedRetireRecord = await gateway.handle({
    action: "workflow.v2.worker_retire.record",
    actor: "flashcat",
    reason: "worker retire write remains opt-in",
    payload: {
      workerRunId: "missing-worker",
      callerAgent: "cat_body",
      reason: "This write should be rejected by console gateway."
    }
  });
  assert.equal(rejectedRetireRecord.ok, false);
  assert.equal(rejectedRetireRecord.errorCode, "action_not_allowed");
  const rejectedSuccessorCreate = await gateway.handle({
    action: "workflow.v2.worker_successor.create",
    actor: "flashcat",
    reason: "worker successor write remains opt-in",
    payload: {
      sourceWorkerRunId: "missing-worker",
      callerAgent: "cat_body"
    }
  });
  assert.equal(rejectedSuccessorCreate.ok, false);
  assert.equal(rejectedSuccessorCreate.errorCode, "action_not_allowed");
  const rejectedAdapterRunnerDrain = await gateway.handle({
    action: "workflow.v2.adapter_runner.drain",
    actor: "flashcat",
    reason: "adapter runner drain remains opt-in",
    payload: {
      runnerId: "mock-console-runner"
    }
  });
  assert.equal(rejectedAdapterRunnerDrain.ok, false);
  assert.equal(rejectedAdapterRunnerDrain.errorCode, "action_not_allowed");

  const rows = sqliteJson(dbFile, `
SELECT action, status, dry_run AS dryRun, reason
FROM workflow_operations
WHERE action LIKE 'workflow.v2.%'
ORDER BY created_at ASC;`);
  assert.equal(rows.some((row) => row.action === "workflow.v2.plan.preview" && row.status === "completed" && row.dryRun === 1), true);
  assert.equal(rows.some((row) => row.action === "workflow.v2.plan.create" && row.status === "rejected"), true);
  assert.equal(rows.some((row) => row.action === "workflow.v2.control_loop.tick" && row.status === "rejected"), true);
  assert.equal(rows.some((row) => row.action === "workflow.v2.worker_result.submit" && row.status === "rejected"), true);
  assert.equal(rows.some((row) => row.action === "workflow.v2.worker_handoff.record" && row.status === "rejected"), true);
  assert.equal(rows.some((row) => row.action === "workflow.v2.worker_retire.record" && row.status === "rejected"), true);
  assert.equal(rows.some((row) => row.action === "workflow.v2.worker_successor.create" && row.status === "rejected"), true);
  assert.equal(rows.some((row) => row.action === "workflow.v2.adapter_runner.drain" && row.status === "rejected"), true);
  assert.equal(rows.some((row) => String(row.reason || "").includes("abc")), false);
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
  ('outbox-failed', 'wf-console-agentic', 'private_chat', 'flashcat', 'human_gate', 'failed', 'failed human gate', '{}', '2026-06-13T00:00:08.000Z', '2026-06-13T00:00:08.000Z'),
  ('outbox-agent-payload', 'wf-console-agentic', 'private_chat', 'flashcat', 'status', 'queued', 'agent payload delivery', '{"agentId":"cat_body"}', '2026-06-13T00:00:08.500Z', '2026-06-13T00:00:08.500Z');
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
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES ('artifact-redaction-console', NULL, 'wf-console-agentic', 'report', 'artifact://redaction/tawhg:secret-search-token', 'Sensitive redaction artifact', 'cat_body', '2026-06-13T00:00:11.500Z');
INSERT INTO workflow_verification_results(verification_id, workflow_id, phase_id, phase_key, task_id, agent_run_id, dispatch_id, runtime_run_id, result_type, decision, verifier_agent, refuter_agent, source_runtime, source_agent, confidence, risk_band, summary, findings_json, recommendations_json, evidence_refs_json, artifact_refs_json, receipt_refs_json, payload_hash, payload_json, created_by, created_at)
VALUES ('verification-console', 'wf-console-agentic', '', 'verify', 'task-done', '', 'dispatch-sent', 'runtime-working', 'regression', 'pass', 'cat_claw', '', 'openclaw', 'cat_claw', 'high', 'low', 'Console verification passed', '[]', '[]', '[]', '["artifact://console-verification"]', '["flow-done"]', 'hash-verification-console', '{}', 'cat_claw', '2026-06-13T00:00:12.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-console', 'investigating', 'workflow', '["workflow"]', 'Console fixture incident', 'main', 'low', 'fixture', 'observe', 'rollback fixture', 'close fixture', '[]', '{"workflowId":"wf-console-agentic"}', '2026-06-13T00:00:13.000Z', '2026-06-13T00:30:13.000Z', '', '2026-06-13T00:00:13.000Z');
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES ('incident-other-agent', 'investigating', 'workflow', '["workflow"]', 'Other agent fixture incident', 'cat_ears', 'low', 'fixture', 'observe', 'rollback fixture', 'close fixture', '[]', '{"workflowId":"wf-console-agentic","agentId":"cat_ears"}', '2026-06-13T00:00:14.000Z', '2026-06-13T00:30:14.000Z', '', '2026-06-13T00:00:14.000Z');
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at)
VALUES
  ('job-console-queued', 'runtime_drain', 'runtime_drain:hermers:dispatch-queued', 'normal', 'queued', 'wf-console-agentic', 'hermers', '{"agentId":"cat_body"}', '{}', 0, 20, '2026-06-13T00:01:00.000Z', '', '', '', '2026-06-13T00:00:01.000Z', '2026-06-13T00:00:01.000Z', ''),
  ('job-console-failed', 'runtime_drain', 'runtime_drain:hermers:dispatch-failed', 'high', 'failed', 'wf-console-agentic', 'hermers', '{"agentId":"cat_body"}', '{}', 3, 3, '', '', '', 'failed control loop job', '2026-06-13T00:00:02.000Z', '2026-06-13T00:00:17.000Z', ''),
  ('job-console-maxed-queued', 'runtime_drain', 'runtime_drain:hermers:dispatch-maxed', 'high', 'queued', 'wf-console-agentic', 'hermers', '{"agentId":"cat_body"}', '{}', 3, 3, '', '', '', 'maxed queued control loop job', '2026-06-13T00:00:02.000Z', '2026-06-13T00:00:19.000Z', '');
INSERT INTO side_effect_ledger(side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, input_hash, output_hash, artifact_ref, payload_json, created_at, updated_at)
VALUES ('side-effect-console-uncertain', 'trace-side-effect-console', 'wf-console-agentic', 'dispatch-failed', 'idem-side-effect-console', 'cat_body', 'telegram_delivery', 'uncertain', '', '', 'artifact://console-side-effect', '{}', '2026-06-13T00:00:02.000Z', '2026-06-13T00:00:18.000Z');
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
  const dispatchSearch = await readModel.globalSearch({ q: "dispatch-failed", limit: 20 });
  assert.equal(dispatchSearch.schemaVersion, "workflow_console_search.v1");
  const dispatchSearchResult = dispatchSearch.results.find((item) => item.kind === "dispatch" && item.id === "dispatch-failed");
  assert.equal(dispatchSearchResult?.workflowId, workflowId);
  assert.equal(dispatchSearchResult?.target?.tab, "dispatches");
  assert.equal(dispatchSearchResult?.sourceRefs.some((ref) => ref.field === "dispatch_id" && ref.id === "dispatch-failed"), true);
  const agentSearch = await readModel.globalSearch({ q: "cat_body", limit: 20 });
  assert.equal(agentSearch.results.some((item) => item.kind === "agent" && item.id === "cat_body" && item.target.consoleView === "agent-board" && item.target.agentId === "cat_body"), true);
  assert.equal(agentSearch.results.some((item) => item.kind === "runtime_state" && item.workflowId === workflowId), true);
  const artifactSearch = await readModel.globalSearch({ q: "artifact://console-verification", limit: 20 });
  const artifactSearchResult = artifactSearch.results.find((item) => item.kind === "artifact" && item.id === "artifact-console");
  assert.equal(artifactSearchResult?.target?.tab, "evidence");
  assert.equal(artifactSearchResult?.sourceRefs.some((ref) => ref.field === "path" && ref.id === "artifact://console-verification"), true);
  const artifactRedactionSearch = await readModel.globalSearch({ q: "Sensitive redaction artifact", limit: 20 });
  const artifactRedactionResult = artifactRedactionSearch.results.find((item) => item.kind === "artifact" && item.id === "artifact-redaction-console");
  assert.equal(JSON.stringify(artifactRedactionResult).includes("secret-search-token"), false);
  assert.equal(artifactRedactionResult?.sourceRefs.some((ref) => ref.field === "path" && ref.id.includes("tawhg:<redacted>")), true);
  const humanGateSearch = await readModel.globalSearch({ q: "hgate-console", limit: 20 });
  assert.equal(humanGateSearch.results.some((item) => item.kind === "human_gate" && item.id === "hgate-console" && item.target.tab === "human-gates"), true);
  assert.equal(humanGateSearch.results.some((item) => item.kind === "human_gate_button" && item.id === "button-console-a" && item.sourceRefs.some((ref) => ref.field === "human_gate_id")), true);
  const incidentSearch = await readModel.globalSearch({ q: "incident-console", limit: 20 });
  assert.equal(incidentSearch.results.some((item) => item.kind === "incident" && item.id === "incident-console" && item.target.tab === "incident-closeout"), true);
  const emptySearch = await readModel.globalSearch({ q: "" });
  assert.equal(emptySearch.summary.status, "empty_query");
  assert.equal(emptySearch.results.length, 0);
  const callbackTokenSearch = await readModel.globalSearch({ q: "token-console-a", limit: 20 });
  assert.equal(callbackTokenSearch.summary.status, "rejected_sensitive_query");
  assert.equal(callbackTokenSearch.results.length, 0);
  assert.equal(JSON.stringify(callbackTokenSearch).includes("token-console-a"), false);
  const partialSearchRoot = await tempRoot("workflow-console-search-partial-schema");
  const partialDbFile = path.join(partialSearchRoot, "tracking.db");
  sqliteExec(partialDbFile, `
CREATE TABLE runtime_agents (
  agent_key TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  display_name TEXT,
  role TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, created_at, updated_at)
VALUES ('legacy:cat_body', 'legacy', 'cat_body', 'Legacy Cat Body', 'developer', 'active', '2026-06-13T00:00:00.000Z', '2026-06-13T00:00:01.000Z');
`);
  const partialSearch = await new WorkflowReadModel({ dbFile: partialDbFile }).globalSearch({ q: "cat_body", limit: 20 });
  assert.equal(partialSearch.schemaVersion, "workflow_console_search.v1");
  assert.equal(partialSearch.summary.status, "ok");
  assert.equal(partialSearch.summary.missingSources.includes("runtime_agents:query_error"), true);
  sqliteExec(dbFile, Array.from({ length: 515 }, (_, index) => `
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, outbox_id, target_runtime, target_agent_id, return_policy, status, runtime_completed_at, runtime_failed_at, final_output_present, delivery_receipt_present, last_error, created_at, updated_at)
VALUES ('flow-triage-old-warning-${index}', 'trace-triage-old-${index}', 'idem-triage-old-${index}', '${workflowId}', '${workflowId}', 'dispatch-new', 'outbox-triage-old-${index}', 'openclaw', 'cat_claw', 'report_to_flashcat', 'runtime_completed', '1999-01-01T00:00:${String(index).padStart(2, "0")}.000Z', '', 1, 0, 'old warning token triage-warning-${index}', '1999-01-01T00:00:${String(index).padStart(2, "0")}.000Z', '1999-01-01T00:00:${String(index).padStart(2, "0")}.000Z');`).join("\n"));
  sqliteExec(dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES ('dispatch-triage-late-critical', '${workflowId}', '${workflowId}', 'trace-triage-critical', 'idem-triage-critical', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'high', 3, 3, '', 'timeout', 'late critical token triage-critical-secret', 'prompt', '{}', 'main', '2999-01-01T00:00:00.000Z', '2999-01-01T00:00:01.000Z', '', '', '2999-01-01T00:00:02.000Z');
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, next_retry_at, failure_type, last_error, prompt, payload_json, created_by, created_at, sent_at, acked_at, completed_at, updated_at)
VALUES ('dispatch-token-leakabc', '${workflowId}', '${workflowId}-api-key-leakabc', 'trace-token-leakabc', 'idem-token-leakabc', 'hermers', 'cat_body', 'hermers:cat_body', 'workflow_task', 'sent', 'high', 3, 3, '', 'timeout', 'embedded token-leakabc must redact', 'prompt', '{}', 'main', '2999-01-01T00:00:03.000Z', '2999-01-01T00:00:04.000Z', '', '', '2999-01-01T00:00:05.000Z');
`);
  assert.equal(sqliteCount(dbFile, "mixed_meeting_dispatches", "dispatch_id='dispatch-triage-late-critical'"), 1);
  const triageOperations = await readModel.operationsSummary({ deadLetterLimit: 500, deadLetterScanLimit: 1000 });
  assert.equal(Boolean(triageOperations.deadLetters.some((row) => row.kind === "max_attempt_dispatch" && row.refId === "dispatch-triage-late-critical" && row.severity === "critical")), false);
  assert.equal(Boolean(triageOperations.deadLetterTriageCandidates.some((row) => row.kind === "max_attempt_dispatch" && row.refId === "dispatch-triage-late-critical" && row.severity === "critical")), true);
  const command = await readModel.commandCenter();
  assert.equal(command.schemaVersion, "workflow_console_command_center.v1");
  assert.equal(command.workflowSummary.total >= 1, true);
  assert.equal(command.runtimeSummary.total, 2);
  assert.equal(command.runtimeSummary.dispatchable, 2);
  assert.equal(command.attention.critical.includes("failed_dispatches"), true);
  assert.equal(command.communication.messageFlow.runtime_completed >= 2, true);
  assert.equal(["blocked", "degraded", "incident"].includes(command.triage.overallState), true);
  assert.equal(command.triage.blockerCount > 0, true);
  assert.equal(command.triage.topBlockers.length > 0, true);
  assert.equal(Boolean(command.triage.topBlockers.some((blocker) => blocker.target?.consoleView === "operations" && blocker.sourceRefs?.length > 0)), true);
  assert.equal(Boolean(command.triage.blockers.some((blocker) => blocker.target?.consoleView === "workflows" && blocker.workflowId === workflowId)), true);
  assert.equal(Boolean(command.triage.blockers.some((blocker) => blocker.id === "max_attempt_dispatch:dispatch-triage-late-critical" && blocker.severity === "critical")), true);
  const triageDispatchBlocker = command.triage.blockers.find((blocker) => blocker.id === "max_attempt_dispatch:dispatch-triage-late-critical");
  assert.equal(triageDispatchBlocker?.relatedTargets.some((target) => target.consoleView === "agent-board" && target.agentId === "cat_body"), true);
  assert.equal(triageDispatchBlocker?.relatedTargets.some((target) => target.consoleView === "kanban" && target.workflowId === workflowId && target.agentId === "cat_body" && target.cardId === "dispatch-triage-late-critical"), true);
  assert.equal(triageDispatchBlocker?.relatedTargets.some((target) => target.consoleView === "evidence-workspace" && target.workflowId === workflowId), true);
  const controlLoopBlocker = command.triage.blockers.find((blocker) => blocker.id === "control_loop_job:job-console-failed");
  assert.equal(controlLoopBlocker?.relatedTargets.some((target) => target.consoleView === "kanban" && !target.cardId), true);
  const pendingHumanGateBlocker = command.triage.blockers.find((blocker) => blocker.id === "pending_human_gate:wf-console-agentic");
  assert.equal(pendingHumanGateBlocker?.target?.tab, "human-gate-readiness");
  assert.equal(pendingHumanGateBlocker?.relatedTargets.some((target) => target.consoleView === "kanban" && !target.cardId), true);
  assert.equal(JSON.stringify(command.triage).includes("triage-critical-secret"), false);
  assert.equal(JSON.stringify(command.triage).includes("leakabc"), false);
  assert.equal(Boolean(command.triage.blockers.some((blocker) => blocker.id === "max_attempt_dispatch:dispatch-token-[redacted]" && blocker.target?.workflowId === `${workflowId}-api-key-[redacted]`)), true);
  const activity = await readModel.activityFeed();
  assert.equal(activity.schemaVersion, "workflow_console_activity_feed.v1");
  assert.equal(activity.items.some((item) => item.group.startsWith("blocker:") && item.target?.consoleView), true);
  assert.equal(activity.items.some((item) => item.group === "dead_letter" && item.target?.consoleView === "operations"), true);
  assert.equal(activity.items.some((item) => item.group === "message_flow" && item.target?.consoleView === "kanban"), true);
  assert.equal(activity.items.some((item) => item.group === "control_loop" && item.sourceRefs.some((ref) => ref.source === "control_loop_jobs")), true);
  assert.equal(JSON.stringify(activity).includes("triage-critical-secret"), false);
  assert.equal(JSON.stringify(activity).includes("leakabc"), false);
  const scopedActivity = await readModel.activityFeed({ workflowId });
  assert.equal(scopedActivity.workflowId, workflowId);
  assert.equal(scopedActivity.items.every((item) => !item.workflowId || item.workflowId === workflowId), true);
  const scopedActivityByUrlAlias = await readModel.activityFeed({ workflow: workflowId });
  assert.equal(scopedActivityByUrlAlias.workflowId, workflowId);
  const palette = await readModel.commandPalette();
  assert.equal(palette.schemaVersion, "workflow_console_command_palette.v1");
  assert.equal(palette.commands.some((commandItem) => commandItem.id === "nav.command" && commandItem.target.consoleView === "command-center"), true);
  assert.equal(palette.commands.some((commandItem) => commandItem.id === "nav.activity" && commandItem.target.consoleView === "activity"), true);
  assert.equal(palette.commands.some((commandItem) => commandItem.id === `workflow.open:${workflowId}` && commandItem.target.workflowId === workflowId && commandItem.target.tab === "overview"), true);
  assert.equal(palette.commands.some((commandItem) => commandItem.id === `workflow.evidence:${workflowId}` && commandItem.target.consoleView === "evidence-workspace"), true);
  assert.equal(palette.commands.some((commandItem) => commandItem.id === "agent.open:cat_body" && commandItem.target.consoleView === "agent-board" && commandItem.target.agentId === "cat_body"), true);
  assert.equal(JSON.stringify(palette).includes("leakabc"), false);

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
  assert.equal(kanban.summary.syntheticCards > 0, true);
  assert.equal(kanban.summary.evidenceGaps, kanban.summary.syntheticCards);
  assert.equal(kanban.summary.cards, kanban.summary.baseCards + kanban.summary.syntheticCards);
  const waitingReceiptCard = kanban.columns.find((column) => column.id === "waiting_receipt")?.cards.find((card) => card.source === "message_flows" && card.sourceId === "flow-waiting-receipt");
  assert.equal(Boolean(waitingReceiptCard), true);
  assert.equal(waitingReceiptCard?.firstSeenAt, "2026-06-13T00:00:01.000Z");
  assert.equal(waitingReceiptCard?.lastEventAt, "2026-06-13T00:00:10.000Z");
  assert.equal(kanban.columns.find((column) => column.id === "working")?.cards.some((card) => card.source === "runtime_current_state" && card.sourceId === "hermers:cat_body"), true);
  assert.equal(kanban.columns.find((column) => column.id === "queued")?.cards.some((card) => card.source === "control_loop_jobs" && card.sourceId === "job-console-queued"), true);
  assert.equal(kanban.columns.find((column) => column.id === "failed")?.cards.some((card) => card.source === "control_loop_jobs" && card.sourceId === "job-console-failed"), true);
  assert.equal(kanban.columns.find((column) => column.id === "failed")?.cards.some((card) => card.source === "control_loop_jobs" && card.sourceId === "job-console-maxed-queued"), true);
  assert.equal(kanban.columns.find((column) => column.id === "blocked")?.cards.some((card) => card.source === "side_effect_ledger" && card.sourceId === "side-effect-console-uncertain"), true);
  const controlLoopJobCard = kanban.columns.flatMap((column) => column.cards).find((card) => card.source === "control_loop_jobs" && card.sourceId === "job-console-failed");
  assert.equal(controlLoopJobCard?.jobId, "job-console-failed");
  assert.equal(controlLoopJobCard?.deadLetterKind, "control_loop_job");
  assert.equal(controlLoopJobCard?.previewActions.includes("workflow.control_loop.job.requeue.preview"), true);
  assert.equal(controlLoopJobCard?.previewActions.includes("workflow.incident.from_dead_letter.preview"), true);
  const sideEffectCard = kanban.columns.flatMap((column) => column.cards).find((card) => card.source === "side_effect_ledger" && card.sourceId === "side-effect-console-uncertain");
  assert.equal(sideEffectCard?.sideEffectId, "side-effect-console-uncertain");
  assert.equal(sideEffectCard?.deadLetterKind, "side_effect_uncertain");
  assert.equal(sideEffectCard?.missingEvidence.includes("side_effect_resolution_evidence"), true);
  assert.equal(sideEffectCard?.previewActions.includes("workflow.incident.from_dead_letter.preview"), true);
  const evidenceGapCards = kanban.columns.flatMap((column) => column.cards).filter((card) => card.source === "evidence_gaps");
  assert.equal(evidenceGapCards.length > 0, true);
  const messageFlowEvidenceGap = evidenceGapCards.find((card) => card.originSource === "message_flows" && card.originSourceId === "flow-waiting-receipt");
  assert.equal(messageFlowEvidenceGap?.column, "blocked");
  assert.equal(messageFlowEvidenceGap?.status, "blocked");
  assert.equal(messageFlowEvidenceGap?.firstSeenAt, "2026-06-13T00:00:01.000Z");
  assert.equal(messageFlowEvidenceGap?.lastEventAt, "2026-06-13T00:00:10.000Z");
  assert.equal(messageFlowEvidenceGap?.missingEvidence.includes("delivery_receipt"), true);
  assert.equal(messageFlowEvidenceGap?.previewActions.includes("workflow.supervise.preview"), true);
  const evidenceGapSuperviseAction = kanbanPreviewActionModel(messageFlowEvidenceGap, "workflow.supervise.preview");
  assert.equal(evidenceGapSuperviseAction.enabled, true);
  assert.equal(evidenceGapSuperviseAction.payload.workflowId, workflowId);
  const requeueJobAction = kanbanPreviewActionModel(controlLoopJobCard, "workflow.control_loop.job.requeue.preview");
  assert.equal(requeueJobAction.enabled, true);
  assert.equal(requeueJobAction.payload.jobId, "job-console-failed");
  const controlLoopIncidentAction = kanbanPreviewActionModel(controlLoopJobCard, "workflow.incident.from_dead_letter.preview");
  assert.equal(controlLoopIncidentAction.enabled, true);
  assert.equal(controlLoopIncidentAction.payload.kind, "control_loop_job");
  assert.equal(controlLoopIncidentAction.payload.refId, "job-console-failed");
  const missingDeadLetterKindAction = kanbanPreviewActionModel({ ...controlLoopJobCard, deadLetterKind: "" }, "workflow.incident.from_dead_letter.preview");
  assert.equal(missingDeadLetterKindAction.enabled, false);
  assert.equal(missingDeadLetterKindAction.reason, "deadLetterKind is required");
  const mismatchedDeadLetterKindAction = kanbanPreviewActionModel({ ...controlLoopJobCard, deadLetterKind: "side_effect_uncertain" }, "workflow.incident.from_dead_letter.preview");
  assert.equal(mismatchedDeadLetterKindAction.enabled, false);
  assert.equal(mismatchedDeadLetterKindAction.reason, "deadLetterKind does not match card source");
  const sideEffectIncidentAction = kanbanPreviewActionModel(sideEffectCard, "workflow.incident.from_dead_letter.preview");
  assert.equal(sideEffectIncidentAction.enabled, true);
  assert.equal(sideEffectIncidentAction.payload.kind, "side_effect_uncertain");
  assert.equal(sideEffectIncidentAction.payload.refId, "side-effect-console-uncertain");
  assert.equal(kanbanPreviewActionModel({ ...controlLoopJobCard, jobId: "", sourceId: "" }, "workflow.control_loop.job.requeue.preview").reason, "jobId is required");
  const dispatchPreviewCard = kanban.columns.flatMap((column) => column.cards).find((card) => card.source === "mixed_meeting_dispatches" && card.dispatchId);
  assert.equal(dispatchPreviewCard?.previewActions.includes("workflow.rerun.agent.preview"), true);
  assert.equal(dispatchPreviewCard?.previewActions.includes("workflow.rerun.dispatch.preview"), false);
  const dispatchPreviewAction = kanbanPreviewActionModel(dispatchPreviewCard, "workflow.rerun.dispatch.preview");
  assert.equal(dispatchPreviewAction.action, "workflow.rerun.agent.preview");
  assert.equal(dispatchPreviewAction.enabled, true);
  assert.equal(dispatchPreviewAction.workflowId, workflowId);
  assert.equal(dispatchPreviewAction.payload.dispatchId, dispatchPreviewCard.dispatchId);
  const taskPreviewCard = kanban.columns.flatMap((column) => column.cards).find((card) => card.source === "workflow_tasks" && card.phaseKey);
  const phasePreviewAction = kanbanPreviewActionModel(taskPreviewCard, "workflow.rerun.phase.preview");
  assert.equal(phasePreviewAction.enabled, true);
  assert.equal(phasePreviewAction.payload.phaseKey, taskPreviewCard.phaseKey);
  const missingPhaseWorkflowAction = kanbanPreviewActionModel({ ...taskPreviewCard, workflowId: "" }, "workflow.rerun.phase.preview");
  assert.equal(missingPhaseWorkflowAction.enabled, false);
  assert.equal(missingPhaseWorkflowAction.reason, "workflowId is required");
  const missingPhaseKeyAction = kanbanPreviewActionModel({ ...taskPreviewCard, phaseKey: "" }, "workflow.rerun.phase.preview");
  assert.equal(missingPhaseKeyAction.enabled, false);
  assert.equal(missingPhaseKeyAction.reason, "phaseKey is required");
  const messageFlowPreviewCard = kanban.columns.flatMap((column) => column.cards).find((card) => card.source === "message_flows" && card.dispatchId);
  assert.equal(messageFlowPreviewCard?.previewActions.includes("workflow.rerun.agent.preview"), true);
  const messageFlowRerunAction = kanbanPreviewActionModel(messageFlowPreviewCard, "workflow.rerun.agent.preview");
  assert.equal(messageFlowRerunAction.enabled, true);
  assert.equal(messageFlowRerunAction.payload.dispatchId, messageFlowPreviewCard.dispatchId);
  const missingWorkflowPreviewAction = kanbanPreviewActionModel({ ...dispatchPreviewCard, workflowId: "" }, "workflow.rerun.agent.preview");
  assert.equal(missingWorkflowPreviewAction.enabled, false);
  assert.equal(missingWorkflowPreviewAction.reason, "workflowId is required");
  const missingOutboxPreviewAction = kanbanPreviewActionModel({ source: "telegram_outbox", sourceId: "" }, "telegram.outbox.delivery.preview");
  assert.equal(missingOutboxPreviewAction.enabled, false);
  assert.equal(missingOutboxPreviewAction.reason, "outboxId is required");
  const globalKanban = await readModel.kanban({});
  const globalIncidentCard = globalKanban.columns.flatMap((column) => column.cards).find((card) => card.source === "incident_states" && card.sourceId === "incident-console");
  assert.equal(globalIncidentCard?.workflowId, workflowId);
  assert.equal(globalIncidentCard?.previewActions.includes("workflow.incident.closeout.cat_claw_report.preview"), true);
  const incidentPreviewAction = kanbanPreviewActionModel(globalIncidentCard, "workflow.incident.closeout.human_gate_package.preview");
  assert.equal(incidentPreviewAction.enabled, true);
  assert.equal(incidentPreviewAction.payload.incidentId, "incident-console");
  const missingIncidentAction = kanbanPreviewActionModel({ ...globalIncidentCard, incidentId: "", source: "incident_states", sourceId: "" }, "workflow.incident.closeout.cat_claw_report.preview");
  assert.equal(missingIncidentAction.enabled, false);
  assert.equal(missingIncidentAction.reason, "incidentId is required");
  const outboxPreviewCard = kanban.columns.flatMap((column) => column.cards).find((card) => card.source === "telegram_outbox" && card.outboxId);
  const requeuePackageAction = kanbanPreviewActionModel(outboxPreviewCard, "telegram.outbox.requeue.execution_package.preview");
  assert.equal(requeuePackageAction.enabled, true);
  assert.equal(requeuePackageAction.outboxId, outboxPreviewCard.outboxId);
  const missingRequeuePackageAction = kanbanPreviewActionModel({ source: "telegram_outbox", sourceId: "" }, "telegram.outbox.requeue.execution_package.preview");
  assert.equal(missingRequeuePackageAction.enabled, false);
  assert.equal(missingRequeuePackageAction.reason, "outboxId is required");
  const humanGatePreviewCard = kanban.columns.flatMap((column) => column.cards).find((card) => card.source === "protocol_objects" && card.humanGateId);
  const pausePreviewAction = kanbanPreviewActionModel(humanGatePreviewCard, "workflow.pause.preview");
  assert.equal(pausePreviewAction.enabled, true);
  assert.equal(pausePreviewAction.workflowId, workflowId);
  const agentKanban = await readModel.kanban({ agentId: "cat_body" });
  const agentScopedCards = agentKanban.columns.flatMap((column) => column.cards);
  assert.equal(agentScopedCards.length > 0, true);
  assert.equal(agentScopedCards.some((card) => card.source === "telegram_outbox" && card.sourceId === "outbox-agent-payload"), true);
  assert.equal(agentScopedCards.some((card) => ["cat_claw", "cat_ears", "main"].includes(card.agentId)), false);

  const evidenceDesk = await readModel.evidenceDesk(workflowId);
  assert.equal(evidenceDesk.schemaVersion, "workflow_console_evidence_desk.v1");
  assert.equal(evidenceDesk.workflowId, workflowId);
  assert.equal(["ready", "needs_attention"].includes(evidenceDesk.status), true);
  assert.equal(evidenceDesk.summary.evidenceArtifacts, 2);
  assert.equal(evidenceDesk.summary.checkpoints, 1);
  assert.equal(evidenceDesk.summary.messageFlows >= 3, true);
  assert.equal(evidenceDesk.summary.outbox, 4);
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

async function testWorkflowConsoleStaticLiveRefreshContract() {
  const [html, app] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "static/console/index.html"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/app.js"), "utf8")
  ]);
  assert.equal(html.includes('id="liveToggleButton"'), true);
  assert.equal(html.includes('id="liveIntervalSelect"'), true);
  assert.equal(html.includes('id="liveStatus"'), true);
  assert.equal(app.includes("async function refreshConsole"), true);
  assert.equal(app.includes('$("#refreshButton").addEventListener("click"'), true);
  assert.equal(app.includes("await refreshConsole();"), true);
  assert.equal(app.includes('!["activity", "operations"].includes(state.consoleView)'), true);
  assert.equal(app.includes('params.get("scope") === "workflow"'), true);
  assert.equal(app.includes('state.consoleView === "activity" && !state.scopedActivity'), true);
  assert.equal(app.includes('params.set("scope", "workflow")'), true);
  assert.equal(app.includes("setLiveRefreshEnabled(!state.liveRefreshEnabled)"), true);
  assert.equal(app.includes("scheduleLiveRefresh();"), true);
}

async function testWorkflowConsoleStaticSystemStatusContract() {
  const [html, app, server, readModel] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "static/console/index.html"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/app.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/console/server.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/console/read-model.js"), "utf8")
  ]);
  assert.equal(html.includes('data-console-view="system"'), true);
  assert.equal(app.includes('"system", "workflows", "search"'), true);
  assert.equal(app.includes("function renderSystemStatus"), true);
  assert.equal(app.includes("function renderReadinessFindings"), true);
  assert.equal(app.includes("function inspectReadinessFinding"), true);
  assert.equal(app.includes("function redactClientValue"), true);
  assert.equal(app.includes("function scrollToConsoleSection"), true);
  assert.equal(app.includes("Readiness Finding Inspector"), true);
  assert.equal(app.includes("Copy Evidence"), true);
  assert.equal(app.includes("readiness_snapshots"), true);
  assert.equal(app.includes('data-section": "readiness"'), true);
  assert.equal(app.includes('source.includes("runtime_runs")'), true);
  assert.equal(app.includes("It does not run health checks, restart services, mutate workflow state, dispatch agents, or bypass Human Gate."), true);
  assert.equal(app.includes("workflow_console_system_status.v1"), true);
  assert.equal(app.includes('safeApi("/health")'), true);
  assert.equal(app.includes('safeApi("/api/readiness/latest")'), true);
  assert.equal(app.includes("partialFailures"), true);
  assert.equal(app.includes("config.allowedConsoleViews"), true);
  assert.equal(app.includes("Release Quality Gates"), true);
  assert.equal(app.includes("function renderReleaseQualityRecords"), true);
  assert.equal(app.includes("Quality Evidence"), true);
  assert.equal(app.includes("config.releaseQualityEvidence"), true);
  assert.equal(app.includes("qualityEvidence.reason"), true);
  assert.equal(app.includes("row.evidenceRefs"), true);
  assert.equal(server.includes("securityBoundaries"), true);
  assert.equal(server.includes("releaseQualityEvidence"), true);
  assert.equal(server.includes("WORKFLOW_CONSOLE_RELEASE_QUALITY_EVIDENCE"), true);
  assert.equal(server.includes("releaseQualityGates"), true);
  assert.equal(server.includes("allowedWorkflowQueues"), true);
  assert.equal(server.includes("allowedConsoleViews"), true);
  assert.equal(server.includes('"active", "waiting_human", "blocked", "paused", "updated_24h"'), true);
  assert.equal(server.includes("preview_first_actions"), true);
  assert.equal(server.includes("no_query_token"), true);
  assert.equal(server.includes("browser_enforced"), true);
  assert.equal(server.includes("spark_code_review"), true);
  assert.equal(server.includes("browser_smoke"), true);
  assert.equal(readModel.includes('["nav.system", "views", "System Status"'), true);

  const renderReleaseQualityRecords = new Function("renderTable", "h", "chip", `${extractFunctionSource(app, "renderReleaseQualityRecords")}; return renderReleaseQualityRecords;`)(
    (columns, rows) => columns.map((column) => rows.map((row) => (column.render ? column.render(row) : row[column.key]))),
    (tag, attrs = {}, children = []) => ({ tag, attrs, children }),
    (value, tone = "neutral") => ({ value, tone })
  );
  const qualityCells = renderReleaseQualityRecords([
    { key: "spark_code_review", status: "recorded", detail: "Spark reviewed.", evidenceRefs: ["review/spark-smoke.md"] }
  ]);
  assert.equal(JSON.stringify(qualityCells).includes("review/spark-smoke.md"), true);

  const readinessHelpers = new Function("sourceRefDrilldownTargets", "sourceRefTargetKey", "toneFor", `${extractFunctionSource(app, "redactClientText")}
${extractFunctionSource(app, "redactClientValue")}
${extractFunctionSource(app, "readinessFindingKey")}
${extractFunctionSource(app, "readinessFindingSeverity")}
${extractFunctionSource(app, "readinessFindingTone")}
${extractFunctionSource(app, "readinessFindingSourceRefs")}
${extractFunctionSource(app, "readinessFindingContext")}
${extractFunctionSource(app, "readinessFindingTargets")}
${extractFunctionSource(app, "readinessFindingEvidenceText")}
return { readinessFindingKey, readinessFindingSeverity, readinessFindingTone, readinessFindingSourceRefs, readinessFindingContext, readinessFindingTargets, readinessFindingEvidenceText };`)(
    (ref, context) => ref.source === "runtime_agents" ? [{ label: "Agent", consoleView: "agent-board", agentId: context.agentId || "cat_heart" }] : [],
    (target) => JSON.stringify(target),
    (value) => value || "neutral"
  );
  const readiness = { snapshotId: "rs-a", status: "degraded", checkedAt: "2026-06-14T00:00:00.000Z" };
  const finding = { key: "hermers_acp_check_failed", severity: "warning", plane: "runtime", agentId: "cat_heart", profile: "catheart", runtimeRunId: "rr-a", error: "timeout token=raw-secret", apiKey: "raw-api-key" };
  assert.equal(readinessHelpers.readinessFindingTone(finding), "warning");
  assert.equal(readinessHelpers.readinessFindingTone({ severity: "critical" }), "critical");
  const refs = readinessHelpers.readinessFindingSourceRefs(finding, readiness, 0);
  assert.equal(refs.some((ref) => ref.source === "readiness_snapshots" && ref.field === "snapshot_id" && ref.id === "rs-a"), true);
  assert.equal(refs.some((ref) => ref.source === "runtime_agents" && ref.id === "cat_heart"), true);
  assert.equal(refs.some((ref) => ref.source === "runtime_runs" && ref.id === "rr-a"), true);
  assert.equal(readinessHelpers.readinessFindingContext(finding).includes("agent=cat_heart"), true);
  assert.equal(readinessHelpers.readinessFindingTargets(finding, readiness, 0).some((target) => target.consoleView === "agent-board"), true);
  const evidenceText = readinessHelpers.readinessFindingEvidenceText(finding, readiness, 0);
  assert.equal(evidenceText.includes("hermers_acp_check_failed"), true);
  assert.equal(evidenceText.includes("raw-secret"), false);
  assert.equal(evidenceText.includes("raw-api-key"), false);
  assert.equal(evidenceText.includes("[redacted]"), true);
}

async function testWorkflowConsoleStaticActionGateContract() {
  const [app, css, server] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "static/console/app.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/style.css"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/console/server.js"), "utf8")
  ]);
  assert.equal(server.includes("operatorPolicy"), true);
  assert.equal(server.includes("local_console_operator_unverified"), true);
  assert.equal(server.includes("hidden_read_only"), true);
  assert.equal(server.includes("hidden_without_allow_writes"), true);
  assert.equal(server.includes("redacted_browser_download"), true);
  assert.equal(app.includes("function actionGatePanel"), true);
  assert.equal(app.includes("Workflow Intervention Gate"), true);
  assert.equal(app.includes("Evidence Export Gate"), true);
  assert.equal(app.includes("Action Audit Ledger"), true);
  assert.equal(app.includes("function renderActionAuditLedger"), true);
  assert.equal(app.includes("Recent Action Results"), true);
  assert.equal(app.includes("function renderActionResultInspector"), true);
  assert.equal(app.includes("function renderRecentActionResults"), true);
  assert.equal(app.includes("function workflowOperationToActionResponse"), true);
  assert.equal(app.includes("function inspectWorkflowOperation"), true);
  assert.equal(app.includes("Workflow Operation Inspector"), true);
  assert.equal(app.includes("Operation Audit Row"), true);
  assert.equal(app.includes("Preview Result"), true);
  assert.equal(app.includes("function recordActionResult"), true);
  assert.equal(app.includes("function actionRequestFailure"), true);
  assert.equal(app.includes("Action Result Inspector"), true);
  assert.equal(app.includes("Copy Result Evidence"), true);
  assert.equal(app.includes("Open Operations Audit"), true);
  assert.equal(app.includes("WorkflowActionGateway -> workflow_operations"), true);
  assert.equal(app.includes("function collapsibleSection"), true);
  assert.equal(app.includes("function copyableEvidenceId"), true);
  assert.equal(app.includes("function copyableEvidenceList"), true);
  assert.equal(app.includes("function catClawSecretaryHandoffModel"), true);
  assert.equal(app.includes("function renderCatClawSecretaryHandoff"), true);
  assert.equal(app.includes("Cat Claw Secretary Handoff"), true);
  assert.equal(app.includes("cat-claw-secretary-handoff"), true);
  assert.equal(app.includes("Copy Handoff"), true);
  assert.equal(app.includes("Read-only secretary shortcut. It does not dispatch Cat Claw, submit Human Gate, send Telegram, mutate evidence, or approve workflow continuation."), true);
  assert.equal(app.includes("collapsibleSection(\"Evidence Desk\""), true);
  assert.equal(app.includes("collapsibleSection(\"Receipt Chain\""), true);
  assert.equal(app.includes("collapsibleSection(\"Verification\""), true);
  assert.equal(app.includes("collapsibleSection(\"Cat Claw Secretary Handoff\""), true);
  assert.equal(app.includes('section("Cat Claw Secretary Handoff"'), true);
  assert.equal(app.includes("copyableEvidenceId(row.receiptId"), true);
  assert.equal(app.includes("copyableEvidenceId(row.verificationId"), true);
  assert.equal(app.includes("copyableEvidenceList(row.refs"), true);
  assert.equal(app.includes("readinessCheckByKey(readiness, \"cat_claw_secretary_path\")"), true);
  assert.equal(app.includes("openWorkflowTab(workflowId, \"human-gate-readiness\")"), true);
  assert.equal(app.includes("catClawSecretaryHandoffEvidenceText(model)"), true);
  assert.equal(app.includes("target.open = true"), true);
  assert.equal(app.includes("parentDetails.open = true"), true);
  assert.equal(app.includes("copyable-evidence-more"), true);
  assert.equal(app.includes("Copy All"), true);
  assert.equal(app.includes("evidence-desk-receipts"), true);
  assert.equal(app.includes("evidence-desk-verification"), true);
  assert.equal(app.includes("should stay 0 in read-only mode"), true);
  assert.equal(app.includes("Rejected / Failed+Denied"), true);
  assert.equal(app.includes("current result window"), true);
  assert.equal(app.includes("Source Ref"), true);
  assert.equal(app.includes("No rejected, failed, denied, or error-bearing workflow operations."), true);
  assert.equal(app.includes("Preview actions append console operation audit rows."), true);
  assert.equal(app.includes("Browser download of the redacted read model"), true);
  assert.equal(css.includes(".action-gate-panel"), true);
  assert.equal(css.includes(".collapsible-section"), true);
  assert.equal(css.includes(".copyable-evidence-id"), true);
  assert.equal(css.includes(".copyable-evidence-list"), true);
  assert.equal(css.includes(".copyable-evidence-more"), true);
  assert.equal(css.includes(".secretary-handoff"), true);
  assert.equal(css.includes(".secretary-handoff-actions"), true);

  const handoffHelpers = new Function("state", `${extractFunctionSource(app, "redactClientText")}
${extractFunctionSource(app, "readinessCheckByKey")}
${extractFunctionSource(app, "readinessCheckPassed")}
${extractFunctionSource(app, "catClawSecretaryHandoffModel")}
${extractFunctionSource(app, "catClawSecretaryHandoffEvidenceText")}
return { catClawSecretaryHandoffModel, catClawSecretaryHandoffEvidenceText };`)({ selectedWorkflowId: "wf-fallback" });
  const handoff = handoffHelpers.catClawSecretaryHandoffModel({
    workflowId: "wf-handoff",
    summary: {
      humanGateReadyForCatClawAudit: true,
      humanGateReadyForSubmission: false,
      receiptPresent: 2,
      receiptMissing: 1,
      evidenceArtifacts: 3,
      missingEvidence: ["human_gate_submission_readiness"]
    },
    readiness: {
      summary: { checkpointCount: 1, artifactCount: 3, sentOutboxCount: 0 },
      checklist: [
        { key: "cat_claw_secretary_path", status: "pass", detail: "Sources: cat_claw", refs: ["cat_claw"] },
        { key: "checkpoint_available", status: "pass", refs: ["checkpoint-a"] },
        { key: "pause_control", status: "pass", refs: ["button-pause"] },
        { key: "terminate_control", status: "pass", refs: ["button-stop"] },
        { key: "telegram_delivery_observed", status: "warn", detail: "queued 1", refs: ["outbox-a-token-raw-secret"] },
        { key: "receipt_coverage", status: "warn", refs: ["receipt-a"] }
      ]
    }
  }, { workflowId: "wf-handoff", selectedIncident: { incidentId: "incident-a" } });
  assert.equal(handoff.status, "not_ready");
  assert.equal(handoff.rows.find((row) => row.key === "secretary_path")?.status, "pass");
  assert.equal(handoff.rows.find((row) => row.key === "human_gate_submission")?.status, "fail");
  assert.equal(handoff.rows.find((row) => row.key === "delivery_evidence")?.status, "warn");
  assert.equal(handoff.rows.find((row) => row.key === "incident_package")?.status, "pass");
  const handoffEvidenceText = handoffHelpers.catClawSecretaryHandoffEvidenceText(handoff);
  assert.equal(handoffEvidenceText.includes("workflow=wf-handoff"), true);
  assert.equal(handoffEvidenceText.includes("secretary_path:pass:cat_claw"), true);
  assert.equal(handoffEvidenceText.includes("raw-secret"), false);
  assert.equal(handoffEvidenceText.includes("[redacted]"), true);

  const calls = [];
  const stateStub = { selectedWorkflowId: "wf-state", recentActionResults: [] };
  const runtime = new Function("state", "section", "h", "renderKeyValues", "sourceRefList", "emptyState", "copyText", "openCommandTarget", "renderTable", "chip", "present", "formatDate", "short", "toneFor", "showDrawer", "jsonBlock", "yesNoUnknown", `${extractFunctionSource(app, "actionResultWorkflowId")}
${extractFunctionSource(app, "actionResultStatus")}
${extractFunctionSource(app, "actionResultFailureText")}
${extractFunctionSource(app, "actionResultEvidenceText")}
${extractFunctionSource(app, "recordActionResult")}
${extractFunctionSource(app, "actionRequestFailure")}
${extractFunctionSource(app, "hasPayload")}
${extractFunctionSource(app, "operationTerminalFailureStatus")}
${extractFunctionSource(app, "operationRiskTone")}
${extractFunctionSource(app, "workflowOperationToActionResponse")}
${extractFunctionSource(app, "renderActionResultInspector")}
${extractFunctionSource(app, "inspectWorkflowOperation")}
${extractFunctionSource(app, "renderRecentActionResults")}
return { actionResultWorkflowId, actionResultStatus, recordActionResult, actionRequestFailure, operationTerminalFailureStatus, operationRiskTone, workflowOperationToActionResponse, renderActionResultInspector, inspectWorkflowOperation, renderRecentActionResults, actionResultEvidenceText };`)(
    stateStub,
    (title, body) => ({ tag: "section", title, body }),
    (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] }),
    (rows) => ({ tag: "kv", rows }),
    (refs, context) => ({ tag: "refs", refs, context }),
    (message) => ({ tag: "empty", message }),
    (value, label) => calls.push(`copy:${label}:${String(value).slice(0, 24)}`),
    (target) => calls.push(`open:${target.consoleView}:${target.workflowId || ""}`),
    (columns, rows) => ({ tag: "table", rows: rows.map((row) => columns.map((column) => ({ label: column.label, node: column.render ? column.render(row) : row[column.key] }))) }),
    (value, tone) => ({ tag: "chip", value, tone }),
    (value) => value || "-",
    (value) => value || "-",
    (value, limit = 120) => String(value || "").slice(0, limit),
    (value) => value || "neutral",
    (payload) => calls.push(`drawer:${payload.title}:${payload.tone || ""}`),
    (value) => ({ tag: "json", value }),
    (value) => value === true ? "yes" : value === false ? "no" : "unknown"
  );
  const result = {
    ok: false,
    action: "workflow.pause.preview",
    operationId: "console_op.action_gate",
    workflowId: "wf-a",
    dryRun: true,
    riskTier: "P2-preview",
    inputHash: "sha256:abc",
    message: "preview denied"
  };
  const record = runtime.recordActionResult(result, { workflowId: "wf-a", label: "Pause Preview" });
  assert.equal(record.operationId, "console_op.action_gate");
  assert.equal(stateStub.recentActionResults.length, 1);
  const inspector = runtime.renderActionResultInspector(result, { workflowId: "wf-a" });
  assert.equal(inspector.title, "Action Result Inspector");
  assert.equal(JSON.stringify(inspector).includes("workflow_operations"), true);
  assert.equal(runtime.actionResultEvidenceText(result, { workflowId: "wf-a" }).includes("failure=preview denied"), true);
  const recent = runtime.renderRecentActionResults();
  assert.equal(recent.rows.length, 1);
  const inspectButton = recent.rows[0].find((cell) => cell.label === "Evidence").node;
  inspectButton.attrs.onClick();
  assert.equal(calls.includes("drawer:Action Result Inspector:critical"), true);
  const failure = runtime.actionRequestFailure(new Error("network down"), { action: "workflow.supervise.preview", workflowId: "wf-a" });
  assert.equal(failure.errorCode, "request_failed");
  assert.equal(stateStub.recentActionResults.length, 2);
  const noWorkflowResult = {
    ok: true,
    action: "telegram.outbox.delivery.preview",
    operationId: "console_op.telegram",
    dryRun: true
  };
  assert.equal(runtime.actionResultWorkflowId(noWorkflowResult, {}), "");
  assert.equal(runtime.actionResultEvidenceText(noWorkflowResult, {}).includes("workflow=-"), true);
  const noWorkflowInspector = runtime.renderActionResultInspector(noWorkflowResult, {});
  const noWorkflowText = JSON.stringify(noWorkflowInspector);
  assert.equal(noWorkflowText.includes("wf-state"), false);
  const operationRow = {
    operationId: "console_op.persisted",
    action: "workflow.pause.preview",
    status: "rejected",
    workflowId: "wf-a",
    scopeType: "workflow",
    scopeId: "wf-a",
    requestedBy: "flashcat",
    reason: "policy denied",
    riskTier: "P2-preview",
    dryRun: true,
    idempotencyKey: "idem-a",
    humanGateId: "hg-a",
    inputHash: "sha256:def",
    previewResult: { safe: "preview" },
    result: { safe: "result" },
    error: "denied by policy",
    createdAt: "2026-06-14T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:01.000Z",
    completedAt: "2026-06-14T00:00:02.000Z"
  };
  assert.equal(runtime.actionResultStatus(runtime.workflowOperationToActionResponse(operationRow)), "rejected");
  assert.equal(runtime.operationTerminalFailureStatus("runtime_failed"), true);
  assert.equal(runtime.operationTerminalFailureStatus("telegram_failed"), true);
  assert.equal(runtime.operationRiskTone({ status: "runtime_failed", riskTier: "P2-preview", dryRun: true }), "critical");
  assert.equal(runtime.operationRiskTone({ status: "completed", riskTier: "P2-high", dryRun: true }), "critical");
  assert.equal(runtime.operationRiskTone({ status: "completed", riskTier: "P2-preview", dryRun: true }), "neutral");
  runtime.inspectWorkflowOperation(operationRow);
  assert.equal(calls.includes("drawer:Workflow Operation Inspector:neutral"), true);
  runtime.inspectWorkflowOperation({ ...operationRow, operationId: "console_op.runtime_failed", status: "runtime_failed" });
  assert.equal(calls.includes("drawer:Workflow Operation Inspector:critical"), true);
}

async function testWorkflowConsoleConfigOperatorPolicyModes() {
  const paths = { root: "/tmp/workflow-console-config-policy-test" };
  const readOnlyConfig = buildConsoleConfig(paths, { readOnly: true, allowWrites: true, serverTime: "2026-01-01T00:00:00.000Z" });
  assert.equal(readOnlyConfig.actionMode, "preview-only");
  assert.equal(readOnlyConfig.operatorPolicy.writeActions, "hidden_read_only");
  assert.equal(readOnlyConfig.releaseQualityGates.some((row) => row.key === "spark_code_review" && row.status === "required"), true);
  assert.equal(readOnlyConfig.releaseQualityGates.some((row) => row.key === "deployment_trace"), true);
  assert.equal(readOnlyConfig.releaseQualityEvidence.status, "missing");
  assert.equal(readOnlyConfig.releaseQualityEvidence.path, "artifacts/console-release-quality/latest.json");

  const noAllowWritesConfig = buildConsoleConfig(paths, { readOnly: false, allowWrites: false, serverTime: "2026-01-01T00:00:00.000Z" });
  assert.equal(noAllowWritesConfig.actionMode, "preview-only");
  assert.equal(noAllowWritesConfig.operatorPolicy.writeActions, "hidden_without_allow_writes");
  assert.equal(noAllowWritesConfig.operatorPolicy.role, "local_console_operator_unverified");
  assert.equal(noAllowWritesConfig.operatorPolicy.roleEvidence, "static_local_console_role");

  const allowWritesConfig = buildConsoleConfig(paths, { readOnly: false, allowWrites: true, serverTime: "2026-01-01T00:00:00.000Z" });
  assert.equal(allowWritesConfig.actionMode, "allowlisted");
  assert.equal(allowWritesConfig.operatorPolicy.writeActions, "allowlisted_by_gateway_with_signed_operator_action");
  assert.equal(allowWritesConfig.operatorPolicy.signedOperatorAction, "required_for_api_actions");
  assert.equal(allowWritesConfig.securityBoundaries.some((row) => row.key === "token_required_for_non_loopback_or_writes"), true);
  assert.equal(allowWritesConfig.securityBoundaries.some((row) => row.key === "signed_operator_action" && row.status === "enforced"), true);
  assert.equal(allowWritesConfig.allowedViews.includes("active"), true);
  assert.equal(allowWritesConfig.allowedConsoleViews.includes("operations"), true);

  const securityRoot = await tempRoot("console-security-fail-closed");
  assert.throws(
    () => createConsoleServer({ rootDir: securityRoot, host: "0.0.0.0", readOnly: true, allowWrites: false }),
    /WORKFLOW_CONSOLE_TOKEN is required/
  );
  assert.throws(
    () => createConsoleServer({ rootDir: securityRoot, host: "127.0.0.1", readOnly: false, allowWrites: true }),
    /WORKFLOW_CONSOLE_TOKEN is required/
  );
  assert.throws(
    () => createConsoleServer({ rootDir: securityRoot, host: "127.0.0.1", readOnly: false, allowWrites: true, token: "test-token" }),
    /WORKFLOW_CONSOLE_OPERATOR_SIGNING_SECRET is required/
  );
  const securedServer = createConsoleServer({
    rootDir: securityRoot,
    host: "127.0.0.1",
    readOnly: false,
    allowWrites: true,
    token: "test-token",
    operatorSigningSecret: "test-signing-secret"
  });
  assert.equal(securedServer.options.token, "test-token");
  assert.equal(securedServer.options.operatorSigningSecret, "test-signing-secret");
  const body = JSON.stringify({ action: "workflow.v2.validate", payload: {} });
  assert.equal(operatorActionSignatureOk({ headers: {} }, securedServer.options, body).error, "operator_signature_required");
  const timestamp = new Date().toISOString();
  const signature = createHmac("sha256", "test-signing-secret").update(`${timestamp}.${body}`).digest("hex");
  assert.equal(operatorActionSignatureOk({
    headers: {
      "x-workflow-operator-timestamp": timestamp,
      "x-workflow-operator-signature": `sha256=${signature}`
    }
  }, securedServer.options, body).ok, true);
  assert.equal(operatorActionSignatureOk({
    headers: {
      "x-workflow-operator-timestamp": timestamp,
      "x-workflow-operator-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000"
    }
  }, securedServer.options, body).error, "operator_signature_mismatch");

  const evidenceRoot = await tempRoot("console-release-quality-evidence");
  const evidenceDir = path.join(evidenceRoot, "artifacts", "console-release-quality");
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, "latest.json"), JSON.stringify({
    schemaVersion: "workflow_console_release_quality_evidence.v1",
    releaseId: "slice-q-smoke",
    commit: "abc123",
    generatedAt: "2026-06-14T00:00:00.000Z",
    gates: {
      spark_code_review: { status: "recorded", detail: "Spark reviewed.", evidenceRefs: ["review/spark.md"] },
      regression_suite: { status: "pass", detail: "Regression passed.", command: "node scripts/workflow_regression_tests.mjs" },
      browser_smoke: { status: "recorded", detail: "Desktop and mobile smoke passed." },
      deployment_trace: { status: "recorded", detail: "Dev checkout fast-forwarded." }
    }
  }, null, 2));
  const evidenceConfig = buildConsoleConfig({ root: evidenceRoot }, { readOnly: true, serverTime: "2026-01-01T00:00:00.000Z" });
  assert.equal(evidenceConfig.releaseQualityEvidence.status, "loaded");
  assert.equal(evidenceConfig.releaseQualityEvidence.path, "artifacts/console-release-quality/latest.json");
  assert.equal(evidenceConfig.releaseQualityEvidence.releaseId, "slice-q-smoke");
  assert.equal(evidenceConfig.releaseQualityEvidence.commit, "abc123");
  assert.equal(evidenceConfig.releaseQualityGates.find((row) => row.key === "spark_code_review")?.status, "recorded");
  assert.equal(evidenceConfig.releaseQualityGates.find((row) => row.key === "regression_suite")?.status, "pass");
  assert.deepEqual(evidenceConfig.releaseQualityGates.find((row) => row.key === "spark_code_review")?.evidenceRefs, ["review/spark.md"]);

  await fs.writeFile(path.join(evidenceDir, "latest.json"), JSON.stringify({
    schemaVersion: "workflow_console_release_quality_evidence.v1",
    releaseId: "slice-q-missing-gate",
    gates: {
      spark_code_review: { status: "recorded", detail: "Spark reviewed." },
      regression_suite: { status: "pass", detail: "Regression passed." },
      browser_smoke: { status: "recorded", detail: "Browser smoke passed." }
    }
  }, null, 2));
  const missingGateConfig = buildConsoleConfig({ root: evidenceRoot }, { readOnly: true });
  assert.equal(missingGateConfig.releaseQualityEvidence.status, "loaded");
  assert.equal(missingGateConfig.releaseQualityGates.find((row) => row.key === "deployment_trace")?.status, "required");

  await fs.writeFile(path.join(evidenceDir, "latest.json"), JSON.stringify({
    schemaVersion: "wrong_schema.v1",
    gates: {
      spark_code_review: { status: "recorded", detail: "This must fail closed." }
    }
  }, null, 2));
  const invalidSchemaConfig = buildConsoleConfig({ root: evidenceRoot }, { readOnly: true });
  assert.equal(invalidSchemaConfig.releaseQualityEvidence.status, "missing");
  assert.equal(invalidSchemaConfig.releaseQualityEvidence.reason, "invalid_schema");
  assert.equal(invalidSchemaConfig.releaseQualityGates.find((row) => row.key === "spark_code_review")?.status, "required");

  const outsideConfig = buildConsoleConfig({ root: evidenceRoot }, {
    readOnly: true,
    releaseQualityEvidencePath: "/tmp/workflow-console-quality-outside.json"
  });
  assert.equal(outsideConfig.releaseQualityEvidence.status, "ignored");
  assert.equal(outsideConfig.releaseQualityEvidence.reason, "outside_root");
  assert.equal(outsideConfig.releaseQualityGates.some((row) => row.key === "spark_code_review" && row.status === "required"), true);

  const outsideRoot = await tempRoot("console-release-quality-outside");
  const outsideEvidence = path.join(outsideRoot, "latest.json");
  await fs.writeFile(outsideEvidence, JSON.stringify({
    schemaVersion: "workflow_console_release_quality_evidence.v1",
    gates: {
      spark_code_review: { status: "recorded", detail: "Symlinked outside root." },
      regression_suite: { status: "recorded", detail: "Symlinked outside root." },
      browser_smoke: { status: "recorded", detail: "Symlinked outside root." },
      deployment_trace: { status: "recorded", detail: "Symlinked outside root." }
    }
  }, null, 2));
  await fs.rm(path.join(evidenceDir, "latest.json"));
  await fs.symlink(outsideEvidence, path.join(evidenceDir, "latest.json"));
  const symlinkConfig = buildConsoleConfig({ root: evidenceRoot }, { readOnly: true });
  assert.equal(symlinkConfig.releaseQualityEvidence.status, "ignored");
  assert.equal(symlinkConfig.releaseQualityEvidence.reason, "outside_root_realpath");
  assert.equal(symlinkConfig.releaseQualityGates.find((row) => row.key === "spark_code_review")?.status, "required");
}

async function testWorkflowConsoleStaticContextTrailContract() {
  const [html, app, css, previewActions] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "static/console/index.html"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/app.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/style.css"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/preview-actions.js"), "utf8")
  ]);
  assert.equal(html.includes('id="contextTrail"'), true);
  assert.equal(html.includes('aria-label="Operator context"'), true);
  assert.equal(app.includes("function updateContextTrail"), true);
  assert.equal(app.includes("CONSOLE_VIEW_LABELS"), true);
  assert.equal(app.includes('const urlWorkflowViews = ["workflows", "evidence-workspace", "operations", "kanban"]'), true);
  assert.equal(app.includes("const canShowWorkflowContext"), true);
  assert.equal(app.includes("let shouldReplaceWorkflowUrl = false"), true);
  assert.equal(app.includes("if (shouldReplaceWorkflowUrl) writeUrlState({ replace: true })"), true);
  assert.equal(app.includes('state.consoleView === "search" && state.searchQuery'), true);
  assert.equal(app.includes('kanbanScope: "global"'), true);
  assert.equal(app.includes("const KANBAN_SCOPES"), true);
  assert.equal(app.includes('state.kanbanScope = state.consoleView === "kanban"'), true);
  assert.equal(app.includes('? normalizeChoice(params.get("scope"), KANBAN_SCOPES.map((item) => item.value), state.selectedWorkflowId ? "workflow" : "global")'), true);
  assert.equal(app.includes('state.consoleView === "kanban" && state.kanbanScope === "workflow" && !state.selectedWorkflowId'), true);
  assert.equal(app.includes('state.consoleView === "kanban" && state.kanbanScope === "global"'), true);
  assert.equal(app.includes('params.set("scope", scope)'), true);
  assert.equal(app.includes('const scope = state.kanbanScope === "workflow" && state.selectedWorkflowId ? "workflow" : "global"'), true);
  assert.equal(app.includes('!(state.consoleView === "kanban" && state.kanbanScope === "global")'), true);
  assert.equal(app.includes('agentRuntimeFilter: "all"'), true);
  assert.equal(app.includes("const AGENT_RUNTIME_FILTERS"), true);
  assert.equal(app.includes('params.get("agentRuntime")'), true);
  assert.equal(app.includes('params.set("agentRuntime", state.agentRuntimeFilter)'), true);
  assert.equal(app.includes("function clearAgentBoardFilters"), true);
  assert.equal(app.includes("function matchesAgentBoardFilters"), true);
  assert.equal(app.includes("function agentBoardFilterControls"), true);
  assert.equal(app.includes("Profile-local memory/RAG status remains in the runtime platform surface unless it is recorded as workflow readiness evidence."), true);
  assert.equal(app.includes("function evidenceExportProvenanceModel"), true);
  assert.equal(app.includes("function evidenceExportProvenancePayload"), true);
  assert.equal(app.includes("function renderEvidenceExportProvenance"), true);
  assert.equal(app.includes("workflow_console_export_provenance.v1"), true);
  assert.equal(app.includes("console_only_browser_download"), true);
  assert.equal(app.includes("deferred_to_governed_write_action"), true);
  assert.equal(app.includes("Copy Manifest"), true);
  assert.equal(app.includes("Download Manifest"), true);
  assert.equal(app.includes("Resolved v1.0 boundary: evidence export is console-only by default."), true);
  assert.equal(app.includes('section("Export Provenance", renderEvidenceExportProvenance'), true);
  const exportRendererSource = extractFunctionSource(app, "renderEvidenceExportProvenance");
  assert.equal(exportRendererSource.includes("fetch("), false);
  assert.equal(exportRendererSource.includes("/api/actions"), false);
  assert.equal(exportRendererSource.includes("evidenceExportProvenancePayload(model)"), true);
  assert.equal(app.includes("const PREVIEW_ACTION_PRIORITY"), true);
  assert.equal(app.includes("function previewActionPriorityModel"), true);
  assert.equal(app.includes("function renderPreviewActionPriorityPanel"), true);
  assert.equal(app.includes('section("Preview Action Priority", renderPreviewActionPriorityPanel'), true);
  assert.equal(app.includes("uncataloged observed actions stay visible as warnings"), true);
  const previewPriorityRendererSource = extractFunctionSource(app, "renderPreviewActionPriorityPanel");
  assert.equal(previewPriorityRendererSource.includes("fetch("), false);
  assert.equal(previewPriorityRendererSource.includes("/api/actions"), false);
  assert.equal(previewPriorityRendererSource.includes("previewIntervention"), false);
  assert.equal(previewPriorityRendererSource.includes("previewSupervise"), false);
  assert.equal(previewPriorityRendererSource.includes("previewTelegram"), false);
  assert.equal(app.includes("function renderKanbanScopeControls"), true);
  assert.equal(app.includes("function setKanbanScope"), true);
  assert.equal(app.includes("Board Scope"), true);
  assert.equal(app.includes("Read-only scope switch. It changes the board query and URL only; it does not move cards, mutate workflow state, dispatch agents, or retry work."), true);
  assert.equal(app.includes('filtered to agent ${state.focusAgentId}'), true);
  assert.equal(app.includes('["agent-board", "kanban"].includes(state.consoleView) && state.focusAgentId'), true);
  assert.equal(app.includes('state.consoleView === "kanban" && state.focusCardId'), true);
  assert.equal(app.includes('state.consoleView === "operations" || (state.consoleView === "workflows" && state.tab === "operations")'), true);
  assert.equal(app.includes("Copy Link"), true);
  assert.equal(app.includes('copyText(currentUrl, "Console link")'), true);
  assert.equal(app.includes("state.config?.actionMode"), true);
  assert.equal(css.includes(".context-trail"), true);
  assert.equal(css.includes(".context-crumb"), true);
  assert.equal(css.includes(".kanban-scope-panel"), true);
  assert.equal(css.includes(".kanban-scope-actions"), true);
  assert.equal(css.includes(".agent-board-scope-panel"), true);
  assert.equal(css.includes(".agent-board-filter-grid"), true);
  assert.equal(css.includes(".export-provenance-panel"), true);
  assert.equal(css.includes(".export-provenance-actions"), true);
  assert.equal(css.includes(".preview-action-priority-panel"), true);
  assert.equal(css.includes(".preview-action-priority-panel .table-wrap"), true);
  assert.equal(css.includes("min-width: 980px"), true);
  assert.equal(css.includes("flex-wrap: wrap"), true);
  assert.equal(css.includes("flex: 1 1 260px"), true);

  const queryRuntime = new Function("state", `${extractFunctionSource(app, "kanbanQueryParams")}
return { kanbanQueryParams };`);
  const globalParams = queryRuntime({ kanbanScope: "global", selectedWorkflowId: "wf-hidden", focusAgentId: "" }).kanbanQueryParams();
  assert.equal(globalParams.get("scope"), "global");
  assert.equal(globalParams.has("workflowId"), false);
  const workflowParams = queryRuntime({ kanbanScope: "workflow", selectedWorkflowId: "wf-a", focusAgentId: "cat_body" }).kanbanQueryParams();
  assert.equal(workflowParams.get("scope"), "workflow");
  assert.equal(workflowParams.get("workflowId"), "wf-a");
  assert.equal(workflowParams.get("agentId"), "cat_body");
  const missingWorkflowParams = queryRuntime({ kanbanScope: "workflow", selectedWorkflowId: "", focusAgentId: "" }).kanbanQueryParams();
  assert.equal(missingWorkflowParams.get("scope"), "global");
  assert.equal(missingWorkflowParams.has("workflowId"), false);

  const agentFilterRuntime = new Function("state", `${extractFunctionSource(app, "matchesAgentBoardFilters")}
return { matchesAgentBoardFilters };`);
  assert.equal(agentFilterRuntime({ consoleView: "agent-board", agentRuntimeFilter: "hermers", agentDispatchFilter: "all", agentAttentionFilter: "all" }).matchesAgentBoardFilters({ runtime: "hermers", platform: "hermers", canReceiveDispatch: true, attentionLevel: "ok", attentionFlags: [] }), true);
  assert.equal(agentFilterRuntime({ consoleView: "agent-board", agentRuntimeFilter: "openclaw", agentDispatchFilter: "all", agentAttentionFilter: "all" }).matchesAgentBoardFilters({ runtime: "hermers", platform: "hermers", canReceiveDispatch: true, attentionLevel: "ok", attentionFlags: [] }), false);
  assert.equal(agentFilterRuntime({ consoleView: "agent-board", agentRuntimeFilter: "all", agentDispatchFilter: "disabled", agentAttentionFilter: "all" }).matchesAgentBoardFilters({ runtime: "openclaw", platform: "openclaw", canReceiveDispatch: false, attentionLevel: "warning", attentionFlags: [{ severity: "warning" }] }), true);
  assert.equal(agentFilterRuntime({ consoleView: "agent-board", agentRuntimeFilter: "all", agentDispatchFilter: "enabled", agentAttentionFilter: "critical" }).matchesAgentBoardFilters({ runtime: "openclaw", platform: "openclaw", canReceiveDispatch: true, attentionLevel: "critical", attentionFlags: [] }), true);
  assert.equal(agentFilterRuntime({ consoleView: "agent-board", agentRuntimeFilter: "all", agentDispatchFilter: "enabled", agentAttentionFilter: "critical" }).matchesAgentBoardFilters({ runtime: "openclaw", platform: "openclaw", canReceiveDispatch: true, attentionLevel: "Critical", attentionFlags: [] }), true);
  assert.equal(agentFilterRuntime({ consoleView: "agent-board", agentRuntimeFilter: "all", agentDispatchFilter: "enabled", agentAttentionFilter: "ok" }).matchesAgentBoardFilters({ runtime: "openclaw", platform: "openclaw", canReceiveDispatch: true, attentionLevel: "critical", attentionFlags: [] }), false);

  const exportProvenanceRuntime = new Function("state", "present", `${extractFunctionSource(app, "evidenceExportProvenanceModel")}
return { evidenceExportProvenanceModel };`);
  const exportProvenance = exportProvenanceRuntime({ selectedWorkflowId: "wf-export" }, (value, fallback = "-") => value || fallback).evidenceExportProvenanceModel({
    workflowId: "wf-export",
    schemaVersion: "workflow_evidence_pack.v1",
    generatedAt: "2026-06-14T00:00:00.000Z",
    redactionPolicyVersion: "workflow_console_redaction_v1",
    writeMode: "read_only_derived_export",
    manifest: {
      artifactCount: 2,
      operationCount: 3,
      receiptCount: 4
    }
  }, {
    surface: "evidence-pack",
    filename: "wf-export-evidence-pack.json"
  });
  assert.equal(exportProvenance.schemaVersion, "workflow_console_export_provenance.v1");
  assert.equal(exportProvenance.exportMode, "console_only_browser_download");
  assert.equal(exportProvenance.serverArtifactStatus, "not_written");
  assert.equal(exportProvenance.workflowArtifactPolicy, "deferred_to_governed_write_action");
  assert.equal(exportProvenance.manifest.artifactCount, 2);
  assert.equal(exportProvenance.manifest.operationCount, 3);
  assert.equal(exportProvenance.manifest.receiptCount, 4);
  const exportPayloadRuntime = new Function("redactClientValue", `${extractFunctionSource(app, "evidenceExportProvenancePayload")}
return { evidenceExportProvenancePayload };`);
  const exportPayload = exportPayloadRuntime((value) => {
    const result = {};
    for (const [key, item] of Object.entries(value || {})) result[key] = /secret|token/i.test(key) ? "[redacted]" : item;
    return result;
  }).evidenceExportProvenancePayload({ ...exportProvenance, secretToken: "must-not-export" });
  assert.equal(exportPayload.secretToken, undefined);
  assert.equal(exportPayload.exportMode, "console_only_browser_download");
  assert.equal(exportPayload.workflowArtifactPolicy, "deferred_to_governed_write_action");

  const previewActionModelRuntime = new Function(`${extractFunctionSource(previewActions, "kanbanPreviewActionModel")}
${extractFunctionSource(previewActions, "shortLabel")}
return { kanbanPreviewActionModel };`)();
  const previewPriorityRuntime = new Function("kanbanPreviewActionSpec", `${app.match(/const PREVIEW_ACTION_PRIORITY = \[[\s\S]*?\];/)[0]}
${extractFunctionSource(app, "previewActionPriorityModel")}
return { PREVIEW_ACTION_PRIORITY, previewActionPriorityModel };`);
  const priorityRuntime = previewPriorityRuntime((card, action) => previewActionModelRuntime.kanbanPreviewActionModel(card, action));
  const expectedPriorityActions = [
    "workflow.supervise.preview",
    "workflow.rerun.agent.preview",
    "telegram.outbox.delivery.preview",
    "telegram.outbox.requeue.preview",
    "workflow.pause.preview",
    "workflow.stop.preview",
    "workflow.control_loop.job.requeue.preview",
    "workflow.incident.from_dead_letter.preview",
    "workflow.incident.closeout.cat_claw_report.preview",
    "workflow.incident.closeout.human_gate_package.preview",
    "workflow.rerun.phase.preview",
    "telegram.outbox.requeue.execution_package.preview"
  ];
  assert.deepEqual(priorityRuntime.PREVIEW_ACTION_PRIORITY.map((row) => row.action), expectedPriorityActions);
  const emptyPriority = priorityRuntime.previewActionPriorityModel([]);
  assert.equal(emptyPriority.length, expectedPriorityActions.length);
  assert.equal(emptyPriority.find((row) => row.action === "workflow.supervise.preview")?.priority, "P0");
  assert.equal(emptyPriority.find((row) => row.action === "workflow.supervise.preview")?.status, "not_observed");
  const observedPriority = priorityRuntime.previewActionPriorityModel([
    { workflowId: "wf-priority", source: "workflow_tasks", sourceId: "task-priority", previewActions: ["workflow.supervise.preview"] },
    { workflowId: "wf-priority", source: "mixed_meeting_dispatches", sourceId: "dispatch-priority", dispatchId: "dispatch-priority", previewActions: ["workflow.rerun.dispatch.preview"] },
    { workflowId: "wf-priority", source: "control_loop_jobs", sourceId: "job-priority", jobId: "job-priority", previewActions: ["workflow.control_loop.job.requeue.preview"] },
    { workflowId: "wf-priority", source: "telegram_outbox", sourceId: "outbox-priority", previewActions: ["telegram.outbox.delivery.preview"] },
    { workflowId: "wf-priority", source: "message_flows", sourceId: "flow-without-outbox", previewActions: ["telegram.outbox.delivery.preview"] },
    { workflowId: "wf-priority", source: "custom_source", sourceId: "custom-priority", previewActions: ["custom.preview.action"] }
  ]);
  assert.equal(observedPriority.find((row) => row.action === "workflow.supervise.preview")?.ready, 1);
  assert.equal(observedPriority.find((row) => row.action === "telegram.outbox.delivery.preview")?.ready, 1);
  assert.equal(observedPriority.find((row) => row.action === "telegram.outbox.delivery.preview")?.blocked, 1);
  const rerunPriority = observedPriority.find((row) => row.action === "workflow.rerun.agent.preview");
  assert.equal(rerunPriority?.ready, 1);
  assert.deepEqual(rerunPriority?.observedActions, ["workflow.rerun.dispatch.preview"]);
  assert.equal(observedPriority.find((row) => row.action === "workflow.control_loop.job.requeue.preview")?.ready, 1);
  const uncatalogedPriority = observedPriority.find((row) => row.action === "custom.preview.action");
  assert.equal(uncatalogedPriority?.status, "uncataloged");
  assert.equal(uncatalogedPriority?.priority, "Other");
  assert.equal(uncatalogedPriority?.observed, 1);
}

async function testWorkflowConsoleStaticDiagnosticMatrixContract() {
  const [app, css] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "static/console/app.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/style.css"), "utf8")
  ]);
  assert.equal(app.includes('section("Diagnostic Matrix", renderDiagnosticMatrix(data))'), true);
  assert.equal(app.includes("function diagnosticMatrixRows"), true);
  assert.equal(app.includes("function renderDiagnosticMatrix"), true);
  assert.equal(app.includes('key: "stale_dispatch"'), true);
  assert.equal(app.includes('key: "missing_receipt"'), true);
  assert.equal(app.includes('key: "failed_telegram"'), true);
  assert.equal(app.includes('key: "blocked_human_gate"'), true);
  assert.equal(app.includes('key: "runtime_failure"'), true);
  assert.equal(app.includes("openCommandTarget(row.target)"), true);
  assert.equal(app.includes("function diagnosticMatrixSourceRefs"), true);
  assert.equal(app.includes("function diagnosticMatrixTargetKey"), true);
  assert.equal(app.includes("function diagnosticMatrixRelatedTargets"), true);
  assert.equal(app.includes("function diagnosticMatrixRunbookSteps"), true);
  assert.equal(app.includes("function diagnosticMatrixEvidenceSummary"), true);
  assert.equal(app.includes("function inspectDiagnosticRunbook"), true);
  assert.equal(app.includes("function inspectSourceRef"), true);
  assert.equal(app.includes("function sourceRefDrilldownTargets"), true);
  assert.equal(app.includes("function renderSourceRefChip"), true);
  assert.equal(app.includes("Source Inspector"), true);
  assert.equal(app.includes('${row.label || "Diagnostic"} Runbook'), true);
  assert.equal(app.includes("Suggested Check Order"), true);
  assert.equal(app.includes("Governed Drilldowns"), true);
  assert.equal(app.includes("This runbook is read-only."), true);
  assert.equal(app.includes("Copy Runbook"), true);
  assert.equal(app.includes("inspectDiagnosticRunbook(row)"), true);
  assert.equal(app.includes("Suggested Drilldowns"), true);
  assert.equal(app.includes("This inspector is read-only."), true);
  assert.equal(app.includes("closeDrawer();\n          openCommandTarget(target);"), true);
  assert.equal(app.includes("sourceRefList(refs = [], context = {})"), true);
  assert.equal(app.includes("sourceRefDrilldownTargets(ref, context)"), true);
  assert.equal(app.includes("renderSourceRefChip(ref"), true);
  assert.equal(app.includes("section: target.section"), true);
  assert.equal(app.includes("operationsFilters: target.operationsFilters"), true);
  assert.equal(app.includes("Evidence Preview"), true);
  assert.equal(app.includes("Runbook"), true);
  assert.equal(app.includes("Copy Evidence"), true);
  assert.equal(app.includes("diagnosticMatrixTargetLabel"), true);
  assert.equal(app.includes("const readinessCritical"), true);
  assert.equal(app.includes("const readinessWarning"), true);
  assert.equal(app.includes('["not_ready", "failed", "unavailable", "error", "critical"].includes(readinessStatus)'), true);
  assert.equal(app.includes('severity: runtimeFailure.length || readinessCritical ? "critical" : readinessWarning ? "warning" : "ok"'), true);
  assert.equal(css.includes(".triage-matrix"), true);
  assert.equal(css.includes(".triage-matrix-row"), true);
  assert.equal(css.includes(".triage-matrix-actions"), true);
  assert.equal(css.includes(".triage-matrix-evidence"), true);
  assert.equal(css.includes(".triage-matrix-related"), true);
  assert.equal(css.includes(".source-ref-chips"), true);
  assert.equal(css.includes(".source-ref-chip"), true);
  assert.equal(css.includes(".source-ref-actions"), true);
  assert.equal(css.includes("grid-template-columns: minmax(110px, 0.5fr) minmax(0, 1fr) auto auto"), true);
  assert.equal(css.includes(".triage-matrix-evidence .mini-counts span"), true);
  assert.equal(css.includes("overflow-wrap: anywhere"), true);
  assert.equal(css.includes("word-break: break-word"), true);
  assert.equal(css.includes("grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))"), true);

  const sourceRefRuntime = new Function(`${extractFunctionSource(app, "sourceRefTargetKey")}
${extractFunctionSource(app, "sourceRefDrilldownTargets")}
return { sourceRefDrilldownTargets };`)();
  const targetLabels = (ref, context = {}) => sourceRefRuntime.sourceRefDrilldownTargets(ref, context).map((target) => target.label);
  assert.deepEqual(targetLabels({ source: "workflow_runs", field: "workflow_id", id: "wf-a" }), ["Workflow", "Evidence", "Operations"]);
  assert.deepEqual(targetLabels({ source: "runtime_agents", field: "agent_key", id: "hermers:cat_body" }), ["Agent", "Board"]);
  assert.deepEqual(targetLabels({ source: "mixed_meeting_dispatches", field: "dispatch_id", id: "dispatch-a" }, { workflowId: "wf-a", agentId: "cat_body" }), ["Workflow", "Evidence", "Operations", "Agent", "Board", "Dispatches"]);
  assert.deepEqual(targetLabels({ source: "message_flows", field: "flow_id", id: "flow-a" }, { workflowId: "wf-a", agentId: "cat_body" }), ["Workflow", "Evidence", "Operations", "Agent", "Board", "Message Flow"]);
  assert.equal(targetLabels({ source: "telegram_outbox", field: "outbox_id", id: "outbox-a" }, { workflowId: "wf-a" }).includes("Outbox"), true);
  assert.equal(targetLabels({ source: "human_gate_buttons", field: "button_id", id: "button-a" }, { workflowId: "wf-a" }).includes("Gate Readiness"), true);
  assert.equal(targetLabels({ source: "incident_states", field: "incident_id", id: "incident-a" }, { workflowId: "wf-a" }).includes("Incidents"), true);
  assert.equal(targetLabels({ source: "side_effect_ledger", field: "side_effect_id", id: "side-a" }, { workflowId: "wf-a" }).includes("Evidence Desk"), true);
  assert.deepEqual(targetLabels({ source: "mixed_meeting_dispatches", field: "dispatch_id", id: "dispatch-a" }), ["Operations"]);
  assert.deepEqual(targetLabels({ source: "message_flows", field: "flow_id", id: "flow-a" }), []);
  assert.deepEqual(targetLabels({ source: "telegram_outbox", field: "outbox_id", id: "outbox-a" }), ["Operations"]);
  assert.deepEqual(targetLabels({ source: "incident_states", field: "incident_id", id: "incident-a" }), []);
  assert.deepEqual(targetLabels({ source: "unknown_table", field: "opaque", id: "row-a" }), []);

  const runbookRuntime = new Function(`${extractFunctionSource(app, "sourceRefKey")}
${extractFunctionSource(app, "diagnosticMatrixSourceRefs")}
${extractFunctionSource(app, "diagnosticMatrixRunbookSteps")}
${extractFunctionSource(app, "diagnosticMatrixEvidenceSummary")}
return { diagnosticMatrixRunbookSteps, diagnosticMatrixEvidenceSummary };`)();
  assert.equal(runbookRuntime.diagnosticMatrixRunbookSteps({ key: "stale_dispatch" }).some((step) => step.includes("Open Operations")), true);
  assert.equal(runbookRuntime.diagnosticMatrixRunbookSteps({ key: "missing_receipt" }).some((step) => step.includes("Message Flow")), true);
  assert.equal(runbookRuntime.diagnosticMatrixRunbookSteps({ key: "failed_telegram" }).some((step) => step.includes("Outbox")), true);
  assert.equal(runbookRuntime.diagnosticMatrixRunbookSteps({ key: "blocked_human_gate" }).some((step) => step.includes("Gate Readiness")), true);
  assert.equal(runbookRuntime.diagnosticMatrixRunbookSteps({ key: "runtime_failure" }).some((step) => step.includes("System and Agent Board")), true);
  assert.equal(runbookRuntime.diagnosticMatrixEvidenceSummary({
    label: "Missing Receipt",
    severity: "warning",
    count: 1,
    blockers: [{ id: "message_flow_delivery_missing:flow-a", sourceRefs: [{ source: "message_flows", field: "flow_id", id: "flow-a" }] }]
  }), "message_flows.flow_id=flow-a");

  let drawerPayload = null;
  const calls = [];
  const copyPayloads = [];
  const hStub = (tag, attrs = {}, children = []) => ({
    tag,
    attrs,
    children: Array.isArray(children) ? children : [children]
  });
  const sectionStub = (title, body) => hStub("section", { title }, [body]);
  const findButton = (node, label) => {
    if (!node || typeof node !== "object") return null;
    if (node.tag === "button" && node.children.includes(label)) return node;
    for (const child of node.children || []) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  };
  const runbookDrawerRuntime = new Function("h", "section", "renderKeyValues", "sourceRefList", "emptyState", "closeDrawer", "openCommandTarget", "copyText", "showDrawer", `${extractFunctionSource(app, "sourceRefKey")}
${extractFunctionSource(app, "diagnosticMatrixSourceRefs")}
${extractFunctionSource(app, "sourceRefTargetKey")}
${extractFunctionSource(app, "diagnosticMatrixTargetKey")}
${extractFunctionSource(app, "diagnosticMatrixRelatedTargets")}
${extractFunctionSource(app, "diagnosticMatrixTargetLabel")}
${extractFunctionSource(app, "diagnosticMatrixRunbookSteps")}
${extractFunctionSource(app, "diagnosticMatrixEvidenceSummary")}
${extractFunctionSource(app, "inspectDiagnosticRunbook")}
return { inspectDiagnosticRunbook };`)(
    hStub,
    sectionStub,
    (rows) => hStub("key-values", {}, rows.map((row) => `${row.label}:${row.value}`)),
    (refs) => hStub("source-refs", {}, refs.map((ref) => `${ref.source}.${ref.field}=${ref.id}`)),
    (message) => hStub("empty", {}, [message]),
    () => calls.push("close"),
    (target) => calls.push(`open:${target.consoleView}:${target.tab || target.label || ""}`),
    (value, label) => {
      copyPayloads.push({ value, label });
      calls.push(`copy:${String(value).slice(0, 20)}`);
    },
    (payload) => { drawerPayload = payload; }
  );
  runbookDrawerRuntime.inspectDiagnosticRunbook({
    key: "missing_receipt",
    label: "Missing Receipt",
    severity: "warning",
    count: 1,
    detail: "Receipt gap needs evidence.",
    target: { label: "Board", consoleView: "kanban", workflowId: "wf-a", cardId: "flow-a" },
    blockers: [{
      id: "message_flow_delivery_missing:flow-a",
      workflowId: "wf-a",
      agentId: "cat_body",
      sourceRefs: [{ source: "message_flows", field: "flow_id", id: "flow-a" }],
      relatedTargets: [{ label: "Operations", consoleView: "operations", workflowId: "wf-a" }]
    }]
  });
  assert.equal(drawerPayload.title, "Missing Receipt Runbook");
  assert.equal(Array.isArray(drawerPayload.raw.steps), true);
  assert.equal(drawerPayload.raw.refs[0].source, "message_flows");
  assert.equal(drawerPayload.raw.targets.some((target) => target.label === "Operations" && target.consoleView === "operations"), true);
  assert.equal(JSON.stringify(drawerPayload.body).includes("This runbook is read-only"), true);
  assert.equal(typeof findButton(drawerPayload.body, "Copy Runbook").attrs.onClick, "function");
  findButton(drawerPayload.body, "Copy Runbook").attrs.onClick();
  assert.equal(calls.some((call) => call.startsWith("copy:")), true);
  assert.deepEqual(copyPayloads.at(-1), {
    value: drawerPayload.raw.steps.join("\n"),
    label: "Missing Receipt runbook"
  });
  calls.length = 0;
  findButton(drawerPayload.body, "Operations").attrs.onClick();
  assert.deepEqual(calls, ["close", "open:operations:Operations"]);
  drawerPayload = null;
  calls.length = 0;
  const inspectorRuntime = new Function("present", "h", "section", "copyText", "closeDrawer", "openCommandTarget", "emptyState", "showDrawer", `${extractFunctionSource(app, "sourceRefDisplay")}
${extractFunctionSource(app, "sourceRefTargetKey")}
${extractFunctionSource(app, "sourceRefDrilldownTargets")}
${extractFunctionSource(app, "inspectSourceRef")}
return { inspectSourceRef };`)(
    (value, fallback = "-") => (value === undefined || value === null || value === "" ? fallback : String(value)),
    hStub,
    sectionStub,
    () => {},
    () => calls.push("close"),
    (target) => calls.push(`open:${target.consoleView}:${target.tab || target.label || ""}`),
    (message) => hStub("empty", {}, [message]),
    (payload) => { drawerPayload = payload; }
  );
  inspectorRuntime.inspectSourceRef({ source: "message_flows", field: "flow_id", id: "flow-a" }, { workflowId: "wf-a", agentId: "cat_body" });
  assert.equal(drawerPayload.title, "Source Inspector");
  assert.equal(drawerPayload.raw.targets.some((target) => target.label === "Message Flow" && target.consoleView === "workflows" && target.tab === "message-flows"), true);
  const messageFlowButton = findButton(drawerPayload.body, "Message Flow");
  assert.equal(typeof messageFlowButton.attrs.onClick, "function");
  messageFlowButton.attrs.onClick();
  assert.deepEqual(calls, ["close", "open:workflows:message-flows"]);
}

async function testWorkflowConsoleStaticKanbanCardInspectorContract() {
  const [app, css] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "static/console/app.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "static/console/style.css"), "utf8")
  ]);
  assert.equal(app.includes('section("Next Safe Preview Actions", renderKanbanCardPreviewAudit(card))'), true);
  assert.equal(app.includes('section("Raw Detail And Audit Trail", renderKanbanCardDetailTargets(card))'), true);
  assert.equal(app.includes("function renderKanbanCardDetailTargets"), true);
  assert.equal(app.includes("function renderKanbanCardPreviewAudit"), true);
  assert.equal(app.includes("function previewControlLoopJobRequeue"), true);
  assert.equal(app.includes('action: "workflow.control_loop.job.requeue.preview"'), true);
  assert.equal(app.includes('action: "workflow.incident.from_dead_letter.preview"'), true);
  assert.equal(app.includes('Origin Source'), true);
  assert.equal(app.includes('origin_source_id'), true);
  assert.equal(app.includes('const originSources = new Set'), true);
  assert.equal(app.includes('First Seen'), true);
  assert.equal(app.includes('seen ${formatDate(card.firstSeenAt)}'), true);
  assert.equal(app.includes('updated ${formatDate(card.lastEventAt)}'), true);
  assert.equal(app.includes("WorkflowActionGateway -> workflow_operations"), true);
  assert.equal(app.includes("Preview only; no business-state mutation"), true);
  assert.equal(app.includes("Focused Board"), true);
  assert.equal(app.includes("closeDrawer();\n        row.onClick();"), true);
  assert.equal(/\.kanban-cards\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s.test(css), true);
  assert.equal(/\.kanban-card\s*\{[^}]*flex:\s*0 0 auto;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s.test(css), true);

  const runtime = new Function("sourceRefTargetKey", "emptyState", "h", `${extractFunctionSource(app, "renderKanbanCardDetailTargets")}
return { renderKanbanCardDetailTargets };`)(
    (target = {}) => JSON.stringify(target),
    (message) => ({ tag: "empty", children: [message] }),
    (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] })
  );
  const collectButtons = (node) => {
    if (!node || typeof node !== "object") return [];
    const here = node.tag === "button" ? [node] : [];
    return here.concat((node.children || []).flatMap(collectButtons));
  };
  const detailNode = runtime.renderKanbanCardDetailTargets({
    source: "mixed_meeting_dispatches",
    sourceId: "dispatch-a",
    workflowId: "wf-a",
    agentId: "cat_body",
    dispatchId: "dispatch-a",
    missingEvidence: ["runtime_receipt"]
  });
  const labels = collectButtons(detailNode).map((button) => button.children.join(""));
  assert.deepEqual(labels, ["Workflow", "Evidence", "Operations", "Agent", "Focused Board", "Dispatches", "Evidence Desk"]);
  const labelsFor = (card) => collectButtons(runtime.renderKanbanCardDetailTargets(card)).map((button) => button.children.join(""));
  assert.equal(labelsFor({ source: "workflow_tasks", sourceId: "task-a", workflowId: "wf-a", taskId: "task-a" }).includes("Tasks"), true);
  assert.equal(labelsFor({ source: "runtime_runs", sourceId: "run-a", workflowId: "wf-a", runtimeRunId: "run-a" }).includes("Runtime Runs"), true);
  assert.equal(labelsFor({ source: "runtime_current_state", sourceId: "hermers:cat_body", workflowId: "wf-a", runtimeRunId: "run-current" }).includes("Runtime Runs"), true);
  assert.equal(labelsFor({ source: "message_flows", sourceId: "flow-a", workflowId: "wf-a", flowId: "flow-a" }).includes("Message Flow"), true);
  assert.equal(labelsFor({ source: "telegram_outbox", sourceId: "outbox-a", workflowId: "wf-a", outboxId: "outbox-a" }).includes("Outbox"), true);
  assert.equal(labelsFor({ source: "control_loop_jobs", sourceId: "job-a", workflowId: "wf-a", jobId: "job-a" }).includes("Operations"), true);
  assert.equal(labelsFor({ source: "side_effect_ledger", sourceId: "side-effect-a", workflowId: "wf-a", sideEffectId: "side-effect-a", status: "uncertain" }).includes("Evidence Desk"), true);
  assert.equal(labelsFor({ source: "side_effect_ledger", sourceId: "side-effect-done", workflowId: "wf-a", sideEffectId: "side-effect-done", status: "committed" }).includes("Evidence Desk"), false);
  assert.deepEqual(
    labelsFor({ source: "protocol_objects", sourceId: "hg-a", workflowId: "wf-a", humanGateId: "hg-a" }).filter((label) => label.includes("Gate")),
    ["Human Gate", "Gate Readiness"]
  );
  assert.equal(labelsFor({ source: "incident_states", sourceId: "incident-a", workflowId: "wf-a" }).includes("Incidents"), true);
  const emptyNode = runtime.renderKanbanCardDetailTargets({ source: "unknown_source", sourceId: "row-a" });
  assert.equal(emptyNode.tag, "empty");

  const previewRuntime = new Function("kanbanPreviewActionSpec", "renderTable", "h", "chip", "emptyState", "closeDrawer", `${extractFunctionSource(app, "renderKanbanCardPreviewAudit")}
return { renderKanbanCardPreviewAudit };`)(
    (card = {}, action = "") => kanbanPreviewActionModel(card, action),
    (columns, rows) => ({ tag: "table", rows: rows.map((row) => columns.map((column) => ({ label: column.label, node: column.render(row) }))) }),
    (tag, attrs = {}, children = []) => ({ tag, attrs, children: Array.isArray(children) ? children : [children] }),
    (value, tone) => ({ tag: "chip", value, tone }),
    (message) => ({ tag: "empty", children: [message] }),
    () => {
      throw new Error("disabled preview actions should not close the drawer");
    }
  );
  const previewNode = previewRuntime.renderKanbanCardPreviewAudit({
    workflowId: "wf-a",
    source: "mixed_meeting_dispatches",
    sourceId: "dispatch-a",
    previewActions: ["unknown.preview.action"]
  });
  const previewButton = previewNode.rows[0].find((cell) => cell.label === "Preview").node;
  assert.equal(previewButton.attrs.disabled, true);
  assert.equal(previewButton.attrs.onClick, undefined);
  const auditCell = previewNode.rows[0].find((cell) => cell.label === "Audit Boundary").node;
  assert.equal(JSON.stringify(auditCell).includes("WorkflowActionGateway -> workflow_operations"), true);
  const requeuePreviewNode = previewRuntime.renderKanbanCardPreviewAudit({
    workflowId: "wf-a",
    source: "control_loop_jobs",
    sourceId: "job-a",
    jobId: "job-a",
    previewActions: ["workflow.control_loop.job.requeue.preview"]
  });
  const requeuePreviewButton = requeuePreviewNode.rows[0].find((cell) => cell.label === "Preview").node;
  assert.equal(requeuePreviewButton.attrs.disabled, false);
  const incidentPreviewNode = previewRuntime.renderKanbanCardPreviewAudit({
    workflowId: "wf-a",
    source: "side_effect_ledger",
    sourceId: "side-effect-a",
    sideEffectId: "side-effect-a",
    deadLetterKind: "side_effect_uncertain",
    previewActions: ["workflow.incident.from_dead_letter.preview"]
  });
  const incidentPreviewButton = incidentPreviewNode.rows[0].find((cell) => cell.label === "Preview").node;
  assert.equal(incidentPreviewButton.attrs.disabled, false);
}

async function testWorkflowConsoleStaticOperatorGradeReleaseGateContract() {
  const app = await fs.readFile(path.join(process.cwd(), "static/console/app.js"), "utf8");
  assert.equal(app.includes('section("Operator-Grade Release Gate", renderOperatorGradeReleaseGate(data))'), true);
  assert.equal(app.includes("function operatorGradeReleaseGateRows"), true);
  assert.equal(app.includes("function renderOperatorGradeReleaseGate"), true);
  assert.equal(app.includes('gate: "Read-only default"'), true);
  assert.equal(app.includes('gate: "Action policy visible"'), true);
  assert.equal(app.includes('gate: "Safety boundaries enforced"'), true);
  assert.equal(app.includes('gate: "Operator surfaces integrated"'), true);
  assert.equal(app.includes('gate: "Redaction policy present"'), true);
  assert.equal(app.includes('gate: "Runtime status observable"'), true);
  assert.equal(app.includes('gate: "Readiness evidence available"'), true);
  assert.equal(app.includes('gate: "No partial status failures"'), true);
  assert.equal(app.includes('gate: "Review gates recorded"'), true);
  assert.equal(app.includes('["loopback_default", "host_allowlist", "no_query_token", "cross_origin_mutation_block", "preview_first_actions", "redaction"]'), true);
  assert.equal(app.includes('["command-center", "activity", "agent-board", "kanban", "evidence-workspace", "operations", "system", "workflows"]'), true);
  assert.equal(app.includes('["hidden_read_only", "hidden_without_allow_writes"].includes(policy.writeActions || "")'), true);
  assert.equal(app.includes('const previewOnlyHidden = config.actionMode === "preview-only" && hiddenWrites'), true);
  assert.equal(app.includes('policy.writeActions === "allowlisted_by_gateway"'), true);
  assert.equal(app.includes('qualityKeys.has("spark_code_review")'), true);
  assert.equal(app.includes('qualityKeys.has("regression_suite")'), true);
  assert.equal(app.includes('qualityKeys.has("browser_smoke")'), true);

  const fnSource = extractFunctionSource(app, "operatorGradeReleaseGateRows");
  const operatorGradeReleaseGateRows = new Function("formatDate", `${fnSource}; return operatorGradeReleaseGateRows;`)((value) => value || "-");
  const boundaries = ["loopback_default", "host_allowlist", "no_query_token", "cross_origin_mutation_block", "preview_first_actions", "redaction"]
    .map((key) => ({ key, status: key === "cross_origin_mutation_block" ? "browser_enforced" : "enforced", detail: key }));
  const baseConfig = {
    actionMode: "preview-only",
    readOnlyMode: false,
    operatorPolicy: {
      previewActions: "allowed",
      writeActions: "hidden_without_allow_writes",
      auditSurface: "workflow_operations"
    },
    allowedConsoleViews: ["command-center", "activity", "agent-board", "kanban", "evidence-workspace", "operations", "system", "workflows"],
    redactionPolicyVersion: "workflow_console_redaction_v1",
    securityBoundaries: boundaries,
    releaseQualityGates: [
      { key: "spark_code_review", status: "recorded", detail: "Spark review recorded." },
      { key: "regression_suite", status: "recorded", detail: "Regression recorded." },
      { key: "browser_smoke", status: "recorded", detail: "Browser smoke recorded." },
      { key: "deployment_trace", status: "recorded", detail: "Deployment trace recorded." }
    ]
  };
  const baseData = {
    config: baseConfig,
    health: { ok: true, dbReadable: true, schemaVersion: "14" },
    readiness: { status: "ready", checkedAt: "2026-06-13T00:00:00.000Z", findingCount: 0 },
    partialFailures: []
  };
  const rows = operatorGradeReleaseGateRows(baseData);
  assert.equal(rows.find((row) => row.gate === "Read-only default")?.status, "pass");
  assert.equal(rows.find((row) => row.gate === "No partial status failures")?.status, "pass");
  assert.equal(rows.find((row) => row.gate === "Readiness evidence available")?.status, "pass");
  assert.equal(rows.find((row) => row.gate === "Review gates recorded")?.status, "pass");
  const requiredReviewGateRows = operatorGradeReleaseGateRows({
    ...baseData,
    config: {
      ...baseConfig,
      releaseQualityGates: baseConfig.releaseQualityGates.map((row) => ({ ...row, status: "required" }))
    }
  });
  assert.equal(requiredReviewGateRows.find((row) => row.gate === "Review gates recorded")?.status, "fail");

  const allowlistedRows = operatorGradeReleaseGateRows({
    ...baseData,
    config: {
      ...baseConfig,
      actionMode: "allowlisted",
      operatorPolicy: { ...baseConfig.operatorPolicy, writeActions: "allowlisted_by_gateway" }
    }
  });
  assert.equal(allowlistedRows.find((row) => row.gate === "Read-only default")?.status, "warn");
  assert.equal(allowlistedRows.find((row) => row.gate === "Action policy visible")?.status, "pass");

  const partialFailureRows = operatorGradeReleaseGateRows({ ...baseData, partialFailures: [{ path: "/health", message: "failed" }] });
  assert.equal(partialFailureRows.find((row) => row.gate === "No partial status failures")?.status, "warn");

  const missingReadinessRows = operatorGradeReleaseGateRows({ ...baseData, readiness: { status: "", findingCount: 0 } });
  assert.equal(missingReadinessRows.find((row) => row.gate === "Readiness evidence available")?.status, "fail");
  const notReadyRows = operatorGradeReleaseGateRows({ ...baseData, readiness: { status: "not_ready", findingCount: 2 } });
  assert.equal(notReadyRows.find((row) => row.gate === "Readiness evidence available")?.status, "warn");
  const missingReviewGateRows = operatorGradeReleaseGateRows({
    ...baseData,
    config: {
      ...baseConfig,
      releaseQualityGates: baseConfig.releaseQualityGates.filter((row) => row.key !== "spark_code_review")
    }
  });
  assert.equal(missingReviewGateRows.find((row) => row.gate === "Review gates recorded")?.status, "fail");
}

try {
  requireSqliteCli();
  const tests = [
    ["human_gate language/resume", testHumanGateLanguageAndResume],
    ["human_gate incident closeout approval resolves incidents", testHumanGateIncidentCloseoutApprovalResolvesIncidents],
    ["human_gate readiness checklist", testHumanGateReadinessChecklist],
    ["human_gate readiness legacy schema fallback", testHumanGateReadinessLegacySchemaFallback],
    ["workflow operations console audit", testWorkflowOperationsConsoleAudit],
    ["workflow run extracted action contracts", testWorkflowRunExtractedActionContracts],
    ["workflow intervention previews", testWorkflowInterventionPreviews],
    ["intervention extracted action contracts", testInterventionExtractedActionContracts],
    ["workflow v2 adapter job manifest", testWorkflowV2AdapterJobManifest],
    ["workflow v2 adapter runner drain", testWorkflowV2AdapterRunnerDrain],
    ["workflow v2 adapter runner concurrency/recovery", testWorkflowV2AdapterRunnerConcurrencyRecovery],
    ["workflow v2 plan advisory and canonical artifact", testWorkflowV2PlanAdvisoryAndCanonicalArtifact],
    ["workflow template self-evolution", testWorkflowTemplateSelfEvolution],
    ["workflow v2 info stack and session binding", testWorkflowV2InfoStackAndSessionBinding],
    ["workflow v2 extracted action contracts", testWorkflowV2ExtractedActionContracts],
    ["workflow v2 worker spawn and lifecycle gates", testWorkflowV2WorkerSpawnAndLifecycleGates],
    ["workflow v2 autonomous loop runtime enforcement", testWorkflowV2AutonomousLoopRuntimeEnforcement],
    ["workflow v2 evaluator optimizer contract", testWorkflowV2EvaluatorOptimizerContractFocused],
    ["workflow v2 review chain", testWorkflowV2ReviewChainFocused],
    ["workflow v2 governance human gate bridge", testWorkflowV2GovernanceHumanGateBridgeFocused],
    ["workflow v2 lifecycle renewal and validator", testWorkflowV2LifecycleRenewalAndValidatorFocused],
    ["workflow intervention execution", testWorkflowInterventionExecution],
    ["workflow verification results", testWorkflowVerificationResults],
    ["verification extracted action contracts", testVerificationExtractedActionContracts],
    ["control_loop job requeue", testControlLoopJobRequeue],
    ["control_loop job extracted action contracts", testControlLoopJobExtractedActionContracts],
    ["workflow evaluator evidence", testWorkflowEvaluatorEvidence],
    ["human_gate pending cleanup/retry", testHumanGatePendingCleanupAndRetryRedaction],
    ["human_gate ensure invalid buttons superseded", testHumanGateEnsureSupersedesInvalidExistingButtons],
    ["human_gate stage dedup/supersede", testHumanGateStageDedupAndSupersede],
    ["schedule resume semantics", testScheduleResumeSemantics],
    ["message_flow extracted action contracts", testMessageFlowExtractedActionContracts],
    ["telegram.live extracted action contracts", testTelegramLiveExtractedActionContracts],
    ["telegram.outbox extracted action contracts", testTelegramOutboxExtractedActionContracts],
    ["human_gate inbox extracted action contracts", testHumanGateInboxExtractedActionContracts],
    ["protocol record extracted action contracts", testProtocolRecordExtractedActionContracts],
    ["trade proposal extracted action contracts", testTradeProposalExtractedActionContracts],
    ["side_effect extracted action contracts", testSideEffectExtractedActionContracts],
    ["incident state extracted action contracts", testIncidentStateExtractedActionContracts],
    ["research extracted action contracts", testResearchExtractedActionContracts],
    ["cat_claw extracted action contracts", testCatClawExtractedActionContracts],
    ["runtime agent extracted action contracts", testRuntimeAgentExtractedActionContracts],
    ["meeting participant extracted action contracts", testMeetingParticipantExtractedActionContracts],
    ["meeting ingest extracted action contracts", testMeetingIngestExtractedActionContracts],
    ["topology extracted action contracts", testTopologyExtractedActionContracts],
    ["status extracted action contracts", testStatusExtractedActionContracts],
    ["permission extracted action contracts", testPermissionExtractedActionContracts],
    ["schedule extracted action contracts", testScheduleExtractedActionContracts],
    ["event extracted action contracts", testEventExtractedActionContracts],
    ["runtime event extracted action contracts", testRuntimeEventExtractedActionContracts],
    ["session extracted action contracts", testSessionExtractedActionContracts],
    ["checkpoint extracted action contracts", testCheckpointExtractedActionContracts],
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
    ["workflow v2 permission and console gate", testWorkflowV2PermissionAndConsoleGate],
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
    ["workflow console static live refresh contract", testWorkflowConsoleStaticLiveRefreshContract],
    ["workflow console static system status contract", testWorkflowConsoleStaticSystemStatusContract],
    ["workflow console static action gate contract", testWorkflowConsoleStaticActionGateContract],
    ["workflow console config operator policy modes", testWorkflowConsoleConfigOperatorPolicyModes],
    ["workflow console static context trail contract", testWorkflowConsoleStaticContextTrailContract],
    ["workflow console static diagnostic matrix contract", testWorkflowConsoleStaticDiagnosticMatrixContract],
    ["workflow console static kanban card inspector contract", testWorkflowConsoleStaticKanbanCardInspectorContract],
    ["workflow console static operator-grade release gate contract", testWorkflowConsoleStaticOperatorGradeReleaseGateContract],
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

  const grepArg = process.argv.find((arg) => arg.startsWith("--grep="));
  const grepIndex = process.argv.indexOf("--grep");
  const grepText = String(grepArg ? grepArg.slice("--grep=".length) : (grepIndex >= 0 ? process.argv[grepIndex + 1] || "" : "")).trim();
  const selectedTests = grepText
    ? tests.filter(([name]) => name.toLowerCase().includes(grepText.toLowerCase()))
    : tests;
  if (!selectedTests.length) {
    throw new Error(`no regression tests matched --grep ${JSON.stringify(grepText)}`);
  }

  for (const [name, fn] of selectedTests) {
    await fn();
    console.log(`ok - ${name}`);
  }
} finally {
  await Promise.all(createdRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
}
