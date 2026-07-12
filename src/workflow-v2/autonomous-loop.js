import { fileExistsSync } from "../workflow/paths.js";
import {
  boolOption,
  firstText
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount
} from "../workflow/sqlite.js";
import {
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2UniqueTextArray,
  workflowV2ValidationError
} from "./helpers.js";

export const WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES = new Set([
  "autonomous_loop",
  "agent_loop",
  "manager_worker_spawn",
  "task"
]);

function workflowV2AutonomousLoopNowIso() {
  return new Date().toISOString();
}

function workflowV2PayloadText(payload = {}, ...keys) {
  const object = workflowV2JsonObject(payload, {});
  const values = [];
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    values.push(object[key], object[camelKey]);
  }
  return firstText(...values);
}

function workflowV2PayloadList(payload = {}, ...keys) {
  const object = workflowV2JsonObject(payload, {});
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    const list = workflowV2JsonArray(object[key] ?? object[camelKey], null);
    if (Array.isArray(list)) return workflowV2UniqueTextArray(list);
  }
  return [];
}

function workflowV2PayloadPositiveInt(payload = {}, ...keys) {
  const object = workflowV2JsonObject(payload, {});
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    const value = object[key] ?? object[camelKey];
    if (value !== undefined && value !== null && value !== "" && workflowV2NonNegativeInt(value, 0) > 0) {
      return workflowV2NonNegativeInt(value, 0);
    }
  }
  return 0;
}

async function workflowV2AutonomousLoopNodeSpec(paths, workflowId = "", planId = "", nodeId = "") {
  if (!workflowId || !planId || !nodeId || !fileExistsSync(paths.dbFile)) return { active: false };
  const rows = await sqlite(paths.dbFile, `
SELECT
  p.workflow_id AS workflow_id,
  p.plan_id AS plan_id,
  p.payload_json AS plan_payload_json,
  n.node_id AS node_id,
  n.node_type AS node_type,
  n.status AS node_status,
  n.output_info_id AS node_output_info_id,
  n.payload_json AS node_payload_json
FROM workflow_v2_plan_nodes n
JOIN workflow_v2_plans p ON p.workflow_id=n.workflow_id AND p.plan_id=n.plan_id
WHERE n.workflow_id=${sqlValue(workflowId)}
  AND n.plan_id=${sqlValue(planId)}
  AND n.node_id=${sqlValue(nodeId)}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  if (!row) return { active: false };
  const planPayload = workflowV2JsonObject(row.plan_payload_json, {});
  const orchestration = workflowV2JsonObject(planPayload.orchestration, {});
  const pattern = firstText(orchestration.pattern, planPayload.orchestrationPattern, planPayload.orchestration_pattern);
  const nodeType = String(row.node_type || "").trim();
  const nodePayload = workflowV2JsonObject(row.node_payload_json, {});
  if (pattern !== "autonomous_agent_loop" || !WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES.has(nodeType)) {
    return { active: false, pattern, nodeType, row };
  }
  const maxIterations = workflowV2PayloadPositiveInt(nodePayload, "maxIterations", "max_iterations", "iterationCap", "iteration_cap");
  const feedbackCheckpoints = workflowV2PayloadList(nodePayload, "toolFeedbackCheckpoints", "tool_feedback_checkpoints", "environmentFeedbackCheckpoints", "environment_feedback_checkpoints");
  const stopCondition = workflowV2PayloadText(nodePayload, "stopCondition", "stop_condition");
  const stopConditions = workflowV2PayloadList(nodePayload, "stopConditions", "stop_conditions");
  return {
    active: true,
    workflowId,
    planId,
    nodeId,
    nodeType,
    nodeStatus: row.node_status || "",
    nodeOutputInfoId: row.node_output_info_id || "",
    nodePayload,
    pattern,
    maxIterations,
    feedbackCheckpoints,
    stopCondition,
    stopConditions,
    row
  };
}

async function workflowV2AutonomousLoopIterationStats(paths, spec = {}) {
  if (!spec.active || !fileExistsSync(paths.dbFile)) return { iterationCount: 0, workerRunIds: [] };
  const rows = await sqlite(paths.dbFile, `
SELECT worker_run_id, status, output_info_id, receipt_ref, completed_at, created_at, updated_at
FROM workflow_v2_worker_runs
WHERE workflow_id=${sqlValue(spec.workflowId)}
  AND plan_id=${sqlValue(spec.planId)}
  AND node_id=${sqlValue(spec.nodeId)}
  AND status!='cancelled'
ORDER BY created_at ASC, worker_run_id ASC;`, { json: true });
  return {
    iterationCount: rows.length,
    workerRunIds: rows.map((row) => row.worker_run_id || "").filter(Boolean),
    latestWorkerRun: rows[rows.length - 1] || null
  };
}

function workflowV2TimestampAtOrAfter(candidate = "", threshold = "") {
  if (!threshold) return true;
  if (!candidate) return false;
  const candidateTime = Date.parse(candidate);
  const thresholdTime = Date.parse(threshold);
  if (Number.isFinite(candidateTime) && Number.isFinite(thresholdTime)) return candidateTime >= thresholdTime;
  return String(candidate) >= String(threshold);
}

function workflowV2AutonomousLoopFeedbackCheckpointAt(stats = {}) {
  const latest = stats.latestWorkerRun || {};
  return firstText(latest.completed_at, latest.updated_at, latest.created_at);
}

function workflowV2AutonomousLoopInputPayload(input = {}) {
  const payload = workflowV2JsonObject(input.payload, {});
  const loop = workflowV2JsonObject(input.autonomousLoop ?? input.autonomous_loop ?? payload.autonomousLoop ?? payload.autonomous_loop, {});
  return { payload, loop };
}

function workflowV2AutonomousLoopTextRefs(...values) {
  const refs = [];
  for (const value of values) {
    refs.push(...workflowV2JsonArray(value, value === undefined || value === null ? [] : [value]));
  }
  return workflowV2UniqueTextArray(refs);
}

function workflowV2AutonomousLoopFeedbackRefs(input = {}) {
  const { payload, loop } = workflowV2AutonomousLoopInputPayload(input);
  return {
    infoIds: workflowV2AutonomousLoopTextRefs(
      input.toolFeedbackInfoId,
      input.tool_feedback_info_id,
      input.toolFeedbackInfoIds,
      input.tool_feedback_info_ids,
      input.environmentFeedbackInfoId,
      input.environment_feedback_info_id,
      input.environmentFeedbackInfoIds,
      input.environment_feedback_info_ids,
      input.feedbackInfoId,
      input.feedback_info_id,
      input.feedbackInfoIds,
      input.feedback_info_ids,
      payload.toolFeedbackInfoId,
      payload.tool_feedback_info_id,
      payload.environmentFeedbackInfoId,
      payload.environment_feedback_info_id,
      payload.feedbackInfoId,
      payload.feedback_info_id,
      loop.toolFeedbackInfoId,
      loop.tool_feedback_info_id,
      loop.environmentFeedbackInfoId,
      loop.environment_feedback_info_id,
      loop.feedbackInfoId,
      loop.feedback_info_id,
      loop.feedbackInfoIds,
      loop.feedback_info_ids
    ),
    receiptRefs: workflowV2AutonomousLoopTextRefs(
      input.toolFeedbackReceiptRef,
      input.tool_feedback_receipt_ref,
      input.toolFeedbackReceiptRefs,
      input.tool_feedback_receipt_refs,
      input.environmentFeedbackReceiptRef,
      input.environment_feedback_receipt_ref,
      input.environmentFeedbackReceiptRefs,
      input.environment_feedback_receipt_refs,
      input.feedbackReceiptRef,
      input.feedback_receipt_ref,
      input.feedbackReceiptRefs,
      input.feedback_receipt_refs,
      payload.toolFeedbackReceiptRef,
      payload.tool_feedback_receipt_ref,
      payload.environmentFeedbackReceiptRef,
      payload.environment_feedback_receipt_ref,
      payload.feedbackReceiptRef,
      payload.feedback_receipt_ref,
      loop.toolFeedbackReceiptRef,
      loop.tool_feedback_receipt_ref,
      loop.environmentFeedbackReceiptRef,
      loop.environment_feedback_receipt_ref,
      loop.feedbackReceiptRef,
      loop.feedback_receipt_ref,
      loop.feedbackReceiptRefs,
      loop.feedback_receipt_refs
    )
  };
}

function workflowV2AutonomousLoopInfoPayloadHasFeedback(payload = {}) {
  const object = workflowV2JsonObject(payload, {});
  const loop = workflowV2JsonObject(object.autonomousLoop ?? object.autonomous_loop, {});
  return boolOption(object.autonomousLoopFeedback ?? object.autonomous_loop_feedback, false)
    || boolOption(object.toolFeedback ?? object.tool_feedback, false)
    || boolOption(object.environmentFeedback ?? object.environment_feedback, false)
    || boolOption(loop.feedback ?? loop.hasFeedback ?? loop.has_feedback, false)
    || Boolean(firstText(
      object.feedbackKind,
      object.feedback_kind,
      object.toolFeedbackKind,
      object.tool_feedback_kind,
      object.environmentFeedbackKind,
      object.environment_feedback_kind,
      loop.feedbackKind,
      loop.feedback_kind,
      loop.toolFeedbackKind,
      loop.tool_feedback_kind,
      loop.environmentFeedbackKind,
      loop.environment_feedback_kind
    ));
}

function workflowV2AutonomousLoopPayloadFeedbackLineage(payload = {}) {
  const object = workflowV2JsonObject(payload, {});
  const loop = workflowV2JsonObject(object.autonomousLoop ?? object.autonomous_loop, {});
  return firstText(
    object.sourceWorkerRunId,
    object.source_worker_run_id,
    object.feedbackSourceWorkerRunId,
    object.feedback_source_worker_run_id,
    object.workerRunId,
    object.worker_run_id,
    loop.sourceWorkerRunId,
    loop.source_worker_run_id,
    loop.feedbackSourceWorkerRunId,
    loop.feedback_source_worker_run_id,
    loop.workerRunId,
    loop.worker_run_id
  );
}

function workflowV2AutonomousLoopPayloadFeedbackCheckpoint(payload = {}) {
  const object = workflowV2JsonObject(payload, {});
  const loop = workflowV2JsonObject(object.autonomousLoop ?? object.autonomous_loop, {});
  return firstText(
    object.feedbackCheckpoint,
    object.feedback_checkpoint,
    object.checkpoint,
    object.checkpointKey,
    object.checkpoint_key,
    object.feedbackKind,
    object.feedback_kind,
    object.toolFeedbackKind,
    object.tool_feedback_kind,
    object.environmentFeedbackKind,
    object.environment_feedback_kind,
    loop.feedbackCheckpoint,
    loop.feedback_checkpoint,
    loop.checkpoint,
    loop.checkpointKey,
    loop.checkpoint_key,
    loop.feedbackKind,
    loop.feedback_kind,
    loop.toolFeedbackKind,
    loop.tool_feedback_kind,
    loop.environmentFeedbackKind,
    loop.environment_feedback_kind
  );
}

function workflowV2AutonomousLoopFeedbackMatchesPreviousWorker(row = {}, payload = {}, stats = {}) {
  const latestWorkerRunId = firstText(stats.latestWorkerRun?.worker_run_id);
  if (!latestWorkerRunId) return false;
  return row.worker_run_id === latestWorkerRunId
    || workflowV2AutonomousLoopPayloadFeedbackLineage(payload) === latestWorkerRunId;
}

function workflowV2AutonomousLoopFeedbackMatchesCheckpoint(spec = {}, payload = {}) {
  const checkpoints = workflowV2UniqueTextArray(spec.feedbackCheckpoints || []);
  if (!checkpoints.length) return true;
  return checkpoints.includes(workflowV2AutonomousLoopPayloadFeedbackCheckpoint(payload));
}

function workflowV2AutonomousLoopFeedbackRowIssue(row = {}, spec = {}, stats = {}, checkpointAt = "") {
  const payload = workflowV2JsonObject(row.payload_json, {});
  if (!workflowV2TimestampAtOrAfter(firstText(row.updated_at, row.created_at), checkpointAt)) return "stale";
  if (!workflowV2AutonomousLoopInfoPayloadHasFeedback(payload)) return "not_feedback";
  if (!workflowV2AutonomousLoopFeedbackMatchesPreviousWorker(row, payload, stats)) return "lineage_mismatch";
  if (!workflowV2AutonomousLoopFeedbackMatchesCheckpoint(spec, payload)) return "checkpoint_mismatch";
  return "";
}

async function workflowV2AutonomousLoopFeedbackEvidence(paths, spec = {}, input = {}, stats = {}) {
  const iterationCount = workflowV2NonNegativeInt(stats.iterationCount, 0);
  if (!spec.active || iterationCount <= 0) return { required: false, present: true, evidence: [] };
  const refs = workflowV2AutonomousLoopFeedbackRefs(input);
  const checkpointAt = workflowV2AutonomousLoopFeedbackCheckpointAt(stats);
  const evidence = [];
  const missingInfoIds = [];
  const staleInfoIds = [];
  const invalidInfoIds = [];
  const lineageMismatchInfoIds = [];
  const checkpointMismatchInfoIds = [];
  for (const infoId of refs.infoIds) {
    const rows = await sqlite(paths.dbFile, `
SELECT info_id, workflow_id, plan_id, node_id, worker_run_id, summary, payload_json, created_at, updated_at
FROM workflow_v2_info_items
WHERE info_id=${sqlValue(infoId)}
LIMIT 1;`, { json: true });
    const row = rows[0] || null;
    if (!row || row.workflow_id !== spec.workflowId || row.plan_id !== spec.planId || row.node_id !== spec.nodeId) {
      missingInfoIds.push(infoId);
    } else {
      const issue = workflowV2AutonomousLoopFeedbackRowIssue(row, spec, stats, checkpointAt);
      if (!issue) {
        evidence.push({ kind: "info_item", infoId, workerRunId: row.worker_run_id || "", summary: row.summary || "" });
      } else if (issue === "stale") {
        staleInfoIds.push(infoId);
      } else if (issue === "lineage_mismatch") {
        lineageMismatchInfoIds.push(infoId);
      } else if (issue === "checkpoint_mismatch") {
        checkpointMismatchInfoIds.push(infoId);
      } else {
        invalidInfoIds.push(infoId);
      }
    }
  }
  if (evidence.length) {
    return {
      required: true,
      present: true,
      evidence,
      missingInfoIds,
      staleInfoIds,
      invalidInfoIds,
      lineageMismatchInfoIds,
      checkpointMismatchInfoIds,
      checkpointAt,
      receiptRefs: refs.receiptRefs
    };
  }
  const rows = await sqlite(paths.dbFile, `
SELECT info_id, worker_run_id, summary, payload_json, created_at, updated_at
FROM workflow_v2_info_items
WHERE workflow_id=${sqlValue(spec.workflowId)}
  AND plan_id=${sqlValue(spec.planId)}
  AND node_id=${sqlValue(spec.nodeId)}
  AND (created_at >= ${sqlValue(checkpointAt)} OR updated_at >= ${sqlValue(checkpointAt)})
ORDER BY created_at DESC, info_id DESC;`, { json: true });
  for (const row of rows) {
    if (
      workflowV2AutonomousLoopInfoPayloadHasFeedback(row.payload_json)
      && workflowV2AutonomousLoopFeedbackMatchesPreviousWorker(row, workflowV2JsonObject(row.payload_json, {}), stats)
      && workflowV2AutonomousLoopFeedbackMatchesCheckpoint(spec, workflowV2JsonObject(row.payload_json, {}))
    ) {
      evidence.push({ kind: "info_item", infoId: row.info_id || "", workerRunId: row.worker_run_id || "", summary: row.summary || "" });
      break;
    }
  }
  return {
    required: true,
    present: evidence.length > 0,
    evidence,
    missingInfoIds,
    staleInfoIds,
    invalidInfoIds,
    lineageMismatchInfoIds,
    checkpointMismatchInfoIds,
    checkpointAt,
    receiptRefs: refs.receiptRefs
  };
}

export async function workflowV2AutonomousLoopSpawnGate(paths, workflowId = "", planId = "", nodeId = "", input = {}) {
  const spec = await workflowV2AutonomousLoopNodeSpec(paths, workflowId, planId, nodeId);
  if (!spec.active) return { active: false, errors: [], state: null };
  const stats = await workflowV2AutonomousLoopIterationStats(paths, spec);
  const errors = [];
  const latestStatus = String(stats.latestWorkerRun?.status || "").trim();
  if (["completed", "cancelled", "failed"].includes(spec.nodeStatus)) {
    errors.push(workflowV2ValidationError("autonomous_loop_terminal", "autonomous_agent_loop node is already terminal and cannot spawn another iteration", {
      workflowId,
      planId,
      nodeId,
      nodeStatus: spec.nodeStatus
    }));
  }
  if (spec.maxIterations > 0 && stats.iterationCount >= spec.maxIterations) {
    errors.push(workflowV2ValidationError("autonomous_loop_iteration_cap_reached", "autonomous_agent_loop reached maxIterations and cannot spawn another iteration", {
      workflowId,
      planId,
      nodeId,
      iterationCount: stats.iterationCount,
      maxIterations: spec.maxIterations
    }));
  }
  if (stats.iterationCount > 0 && ["queued", "retry_scheduled", "running"].includes(latestStatus)) {
    errors.push(workflowV2ValidationError("autonomous_loop_previous_iteration_open", "autonomous_agent_loop cannot spawn the next iteration while the previous iteration is still open", {
      workflowId,
      planId,
      nodeId,
      iterationCount: stats.iterationCount,
      latestWorkerRunId: stats.latestWorkerRun?.worker_run_id || "",
      latestStatus
    }));
  }
  const feedback = await workflowV2AutonomousLoopFeedbackEvidence(paths, spec, input, stats);
  if (!feedback.present) {
    errors.push(workflowV2ValidationError("autonomous_loop_feedback_required", "autonomous_agent_loop requires tool/environment feedback evidence before the next iteration", {
      workflowId,
      planId,
      nodeId,
      iterationCount: stats.iterationCount,
      feedbackCheckpoints: spec.feedbackCheckpoints,
      feedbackCheckpointAt: feedback.checkpointAt || "",
      missingInfoIds: feedback.missingInfoIds || [],
      staleInfoIds: feedback.staleInfoIds || [],
      invalidInfoIds: feedback.invalidInfoIds || [],
      lineageMismatchInfoIds: feedback.lineageMismatchInfoIds || [],
      checkpointMismatchInfoIds: feedback.checkpointMismatchInfoIds || [],
      receiptRefs: feedback.receiptRefs || []
    }));
  }
  return {
    active: true,
    errors,
    state: {
      pattern: spec.pattern,
      nodeType: spec.nodeType,
      iterationCount: stats.iterationCount,
      nextIteration: stats.iterationCount + 1,
      maxIterations: spec.maxIterations,
      feedbackRequired: feedback.required,
      feedbackEvidence: feedback.evidence || [],
      stopCondition: spec.stopCondition,
      stopConditions: spec.stopConditions
    }
  };
}

function workflowV2AutonomousLoopStopConditionSatisfied(input = {}, workerPayload = {}) {
  const { payload, loop } = workflowV2AutonomousLoopInputPayload(input);
  const workerLoop = workflowV2JsonObject(workerPayload.autonomousLoop ?? workerPayload.autonomous_loop, {});
  return boolOption(input.stopConditionSatisfied ?? input.stop_condition_satisfied, false)
    || boolOption(input.autonomousLoopStopSatisfied ?? input.autonomous_loop_stop_satisfied, false)
    || boolOption(payload.stopConditionSatisfied ?? payload.stop_condition_satisfied, false)
    || boolOption(payload.autonomousLoopStopSatisfied ?? payload.autonomous_loop_stop_satisfied, false)
    || boolOption(loop.stopConditionSatisfied ?? loop.stop_condition_satisfied, false)
    || boolOption(loop.stopSatisfied ?? loop.stop_satisfied, false)
    || boolOption(workerLoop.stopConditionSatisfied ?? workerLoop.stop_condition_satisfied, false)
    || boolOption(workerLoop.stopSatisfied ?? workerLoop.stop_satisfied, false);
}

export async function workflowV2AutonomousLoopMaybeTerminalizeNode(paths, row = {}, input = {}, timestamp = workflowV2AutonomousLoopNowIso()) {
  const workflowId = firstText(row.workflow_id, row.workflowId);
  const planId = firstText(row.plan_id, row.planId);
  const nodeId = firstText(row.node_id, row.nodeId);
  const workerRunId = firstText(row.worker_run_id, row.workerRunId);
  const workerPayload = workflowV2JsonObject(row.payload_json ?? row.payload, {});
  const spec = await workflowV2AutonomousLoopNodeSpec(paths, workflowId, planId, nodeId);
  if (!spec.active || !workflowV2AutonomousLoopStopConditionSatisfied(input, workerPayload)) return null;
  const outputInfoId = firstText(input.outputInfoId, input.output_info_id, row.output_info_id, row.outputInfoId);
  const receiptRef = firstText(input.receiptRef, input.receipt_ref, row.receipt_ref, row.receiptRef);
  const nextPayload = {
    ...spec.nodePayload,
    autonomousLoopRuntime: {
      ...workflowV2JsonObject(spec.nodePayload.autonomousLoopRuntime ?? spec.nodePayload.autonomous_loop_runtime, {}),
      stopConditionSatisfied: true,
      terminalWorkerRunId: workerRunId,
      terminalOutputInfoId: outputInfoId,
      terminalReceiptRef: receiptRef,
      terminalizedAt: timestamp
    }
  };
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_plan_nodes
SET status='completed',
    output_info_id=${sqlValue(outputInfoId || spec.nodeOutputInfoId || "")},
    payload_json=${sqlValue(JSON.stringify(nextPayload))},
    updated_at=${sqlValue(timestamp)}
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
  AND node_id=${sqlValue(nodeId)}
  AND status NOT IN ('completed','cancelled','failed');`);
  return {
    terminalized: changed === 1,
    workflowId,
    planId,
    nodeId,
    workerRunId,
    status: "completed",
    outputInfoId: outputInfoId || spec.nodeOutputInfoId || "",
    receiptRef
  };
}
