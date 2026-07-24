import {
  firstText,
  jsonHash,
  redactSensitiveForPersistence
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteTransaction
} from "../workflow/sqlite.js";
import {
  WORKFLOW_V2_PLAN_STATUSES,
  WORKFLOW_V2_WORKFLOW_STATES
} from "./constants.js";
import {
  workflowV2JsonObject,
  workflowV2PlanSummary
} from "./helpers.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 intervention dependency missing: ${name}`);
  return value;
}

function interventionKindFromAction(action = "") {
  const value = String(action || "").toLowerCase().replace(/-/g, "_");
  if (value.includes("resume")) return "resume_plan";
  if (value.includes("terminate")) return "terminate_plan";
  if (value.includes("stop")) return "stop_plan";
  if (value.includes("pause")) return "pause_plan";
  return "";
}

function evidenceText(input = {}, camel, snake) {
  return firstText(input[camel], input[snake]);
}

function requireEvidence(input = {}, camel, snake, label) {
  const value = evidenceText(input, camel, snake);
  if (!value) throw new Error(`${label} is required for workflow v2 intervention execution`);
  return value;
}

function nextInterventionState(kind, planRow = {}, payload = {}) {
  const last = workflowV2JsonObject(payload.intervention?.last, {});
  if (kind === "pause_plan") {
    return {
      status: "blocked",
      workflowState: "blocked"
    };
  }
  if (kind === "resume_plan") {
    const previousStatus = firstText(last.previousPlanStatus, last.previous_status, payload.intervention?.previousPlanStatus);
    const previousWorkflowState = firstText(last.previousWorkflowState, last.previous_workflow_state, payload.intervention?.previousWorkflowState);
    const status = WORKFLOW_V2_PLAN_STATUSES.has(previousStatus) && previousStatus !== "blocked" && previousStatus !== "cancelled"
      ? previousStatus
      : "running";
    const workflowState = WORKFLOW_V2_WORKFLOW_STATES.has(previousWorkflowState)
      && !["blocked", "terminated", "cancelled", "completed"].includes(previousWorkflowState)
      ? previousWorkflowState
      : "active";
    return { status, workflowState };
  }
  if (kind === "stop_plan" || kind === "terminate_plan") {
    return {
      status: "cancelled",
      workflowState: kind === "terminate_plan" ? "terminated" : "cancelled"
    };
  }
  return {
    status: planRow.status || "planned",
    workflowState: planRow.workflow_state || "planned"
  };
}

function replayValueConflict(label, requested = "", recorded = "") {
  const requestedText = firstText(requested);
  const recordedText = firstText(recorded);
  if (requestedText && recordedText && requestedText !== recordedText) {
    throw new Error(`workflow v2 intervention idempotency conflict: ${label} does not match existing event`);
  }
}

async function workflowV2InterventionReplay(paths, request = {}) {
  const idempotencyKey = request.idempotencyKey || "";
  if (!idempotencyKey) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_events
WHERE event_type='workflow.v2.intervention.executed'
  AND idempotency_key=${sqlValue(idempotencyKey)}
ORDER BY created_at DESC
LIMIT 1;`, { json: true });
  const eventRow = rows[0];
  if (!eventRow) return null;
  const payload = workflowV2JsonObject(eventRow.payload_json, {});
  const workflowId = eventRow.workflow_id || payload.workflowId || "";
  const planId = payload.planId || "";
  replayValueConflict("action", request.action, payload.action);
  replayValueConflict("kind", request.kind, payload.kind);
  replayValueConflict("workflowId", request.workflowId, workflowId);
  replayValueConflict("planId", request.planId, planId);
  replayValueConflict("humanGateId", request.humanGateId, eventRow.human_gate_id || payload.humanGateId);
  replayValueConflict("protocolAuditId", request.protocolAuditId, payload.protocolAuditId);
  replayValueConflict("rollbackBoundary", request.rollbackBoundary, eventRow.artifact_ref || payload.rollbackBoundary);
  const planRows = workflowId && planId ? await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true }) : [];
  return {
    operation: "workflow.v2.intervention.execute",
    workflowId,
    planId,
    action: payload.action || "",
    kind: payload.kind || "",
    status: "replayed",
    idempotencyKey,
    humanGateId: eventRow.human_gate_id || payload.humanGateId || "",
    protocolAuditId: payload.protocolAuditId || "",
    rollbackBoundary: eventRow.artifact_ref || payload.rollbackBoundary || "",
    previousPlanStatus: payload.previousPlanStatus || "",
    previousWorkflowState: eventRow.previous_state || payload.previousWorkflowState || "",
    nextPlanStatus: payload.nextPlanStatus || "",
    nextWorkflowState: eventRow.next_state || payload.nextWorkflowState || "",
    replayed: true,
    plan: workflowV2PlanSummary(planRows[0] || null),
    dbFile: paths.dbFile
  };
}

function mergeInterventionPayload(payload = {}, patch = {}) {
  const history = Array.isArray(payload.intervention?.history) ? payload.intervention.history : [];
  return {
    ...payload,
    intervention: {
      ...(payload.intervention || {}),
      last: patch,
      history: [...history, patch].slice(-20)
    }
  };
}

export function createWorkflowV2InterventionActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowV2InterventionSettlementPreview = requireContextFunction(context, "workflowV2InterventionSettlementPreview");

  async function workflowV2InterventionExecute(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const action = String(input.action || "").trim();
    const kind = interventionKindFromAction(action);
    if (!["pause_plan", "resume_plan", "stop_plan", "terminate_plan"].includes(kind)) {
      throw new Error(`unsupported workflow v2 intervention action: ${action}`);
    }
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const planId = firstText(input.planId, input.plan_id);
    if (!workflowId && !planId) throw new Error("workflowId or planId is required");
    const operatorReason = firstText(input.operatorReason, input.operator_reason, input.reason, input.summary);
    if (!operatorReason) throw new Error("operatorReason is required for workflow v2 intervention execution");
    const humanGateId = requireEvidence(input, "humanGateId", "human_gate_id", "humanGateId");
    const protocolAuditId = requireEvidence(input, "protocolAuditId", "protocol_audit_id", "protocolAuditId");
    const idempotencyKey = requireEvidence(input, "idempotencyKey", "idempotency_key", "idempotencyKey");
    const rollbackBoundary = firstText(
      input.rollbackBoundary,
      input.rollback_boundary,
      input.resumeBoundary,
      input.resume_boundary,
      input.stopCondition,
      input.stop_condition
    );
    const replay = await workflowV2InterventionReplay(paths, {
      idempotencyKey,
      action,
      kind,
      workflowId,
      planId,
      humanGateId,
      protocolAuditId,
      rollbackBoundary
    });
    if (replay) return replay;
    const readiness = await workflowV2InterventionSettlementPreview(rootDir, {
      ...input,
      action: `${action}.preview`,
      targetAction: action
    });
    const eligible = Boolean(readiness.eligibleForStateTransition ?? readiness.eligible);
    if (!eligible) {
      const codes = (readiness.blockers || []).map((item) => item.code).join(",") || "unknown";
      throw new Error(`workflow v2 intervention not eligible: action=${action} blockers=${codes}`);
    }
    if ((kind === "stop_plan" || kind === "terminate_plan") && !rollbackBoundary && !readiness.latestCheckpoint?.path) {
      throw new Error("rollbackBoundary or latest checkpoint is required for workflow v2 stop/terminate execution");
    }
    const scope = readiness.scope || {};
    const resolvedWorkflowId = firstText(workflowId, scope.workflowId);
    const resolvedPlanId = firstText(planId, scope.planId);
    const planRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(resolvedWorkflowId)}
  AND plan_id=${sqlValue(resolvedPlanId)}
LIMIT 1;`, { json: true });
    const planRow = planRows[0];
    if (!planRow) throw new Error(`workflow v2 plan not found: workflowId=${resolvedWorkflowId} planId=${resolvedPlanId}`);
    const now = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const payload = workflowV2JsonObject(planRow.payload_json, {});
    const next = nextInterventionState(kind, planRow, payload);
    const record = {
      schemaVersion: "workflow_v2_intervention_transition.v1",
      action,
      kind,
      previousPlanStatus: planRow.status || "",
      previousWorkflowState: planRow.workflow_state || "",
      nextPlanStatus: next.status,
      nextWorkflowState: next.workflowState,
      humanGateId,
      protocolAuditId,
      idempotencyKey,
      rollbackBoundary: rollbackBoundary || readiness.latestCheckpoint?.path || "",
      latestCheckpoint: readiness.latestCheckpoint?.path || "",
      operatorReasonPresent: true,
      actor: firstText(input.actor, input.createdBy, input.created_by, permissionDecision?.caller?.agentId, "unknown"),
      settlementSummary: readiness.settlementSummary || {},
      executedAt: now
    };
    const nextPayload = mergeInterventionPayload(payload, record);
    const eventPayload = redactSensitiveForPersistence({
      action,
      kind,
      planId: resolvedPlanId,
      previousPlanStatus: record.previousPlanStatus,
      previousWorkflowState: record.previousWorkflowState,
      nextPlanStatus: record.nextPlanStatus,
      nextWorkflowState: record.nextWorkflowState,
      humanGateId,
      protocolAuditId,
      rollbackBoundary: record.rollbackBoundary,
      riskTier: readiness.riskTier,
      blockersChecked: (readiness.blockers || []).length,
      settlementSummary: readiness.settlementSummary || {},
      warnings: readiness.warnings || [],
      permissionPolicyOutcome: permissionDecision?.policyOutcome || ""
    });
    const eventPayloadHash = jsonHash(eventPayload);
    await sqliteTransaction(paths.dbFile, `
UPDATE workflow_v2_plans
SET status=${sqlValue(next.status)},
    workflow_state=${sqlValue(next.workflowState)},
    payload_json=${sqlValue(JSON.stringify(nextPayload))},
    updated_at=${sqlValue(now)}
WHERE workflow_id=${sqlValue(resolvedWorkflowId)}
  AND plan_id=${sqlValue(resolvedPlanId)};
INSERT INTO workflow_events(event_id, event_type, status, workflow_id, trace_id, task_id, dispatch_id, runtime_run_id, message_flow_id, human_gate_id, side_effect_id, incident_id, actor, source_runtime, source_agent, previous_state, next_state, idempotency_key, artifact_ref, payload_hash, payload_json, created_at)
VALUES (${sqlValue(`workflow_v2_intervention.${idempotencyKey}`)}, 'workflow.v2.intervention.executed', ${sqlValue(next.workflowState)}, ${sqlValue(resolvedWorkflowId)}, ${sqlValue(firstText(input.traceId, input.trace_id))}, '', '', '', '', ${sqlValue(humanGateId)}, '', '', ${sqlValue(record.actor)}, ${sqlValue(firstText(input.sourceRuntime, input.source_runtime, permissionDecision?.caller?.runtime, "workflow"))}, ${sqlValue(firstText(input.sourceAgent, input.source_agent, permissionDecision?.caller?.agentId))}, ${sqlValue(planRow.workflow_state || "")}, ${sqlValue(next.workflowState)}, ${sqlValue(idempotencyKey)}, ${sqlValue(record.rollbackBoundary)}, ${sqlValue(eventPayloadHash)}, ${sqlValue(JSON.stringify(eventPayload))}, ${sqlValue(now)});`);
    const updatedRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(resolvedWorkflowId)}
  AND plan_id=${sqlValue(resolvedPlanId)}
LIMIT 1;`, { json: true });
    return {
      operation: "workflow.v2.intervention.execute",
      workflowId: resolvedWorkflowId,
      planId: resolvedPlanId,
      action,
      kind,
      status: "executed",
      previousPlanStatus: record.previousPlanStatus,
      previousWorkflowState: record.previousWorkflowState,
      nextPlanStatus: record.nextPlanStatus,
      nextWorkflowState: record.nextWorkflowState,
      humanGateId,
      protocolAuditId,
      idempotencyKey,
      rollbackBoundary: record.rollbackBoundary,
      riskTier: readiness.riskTier || (kind === "stop_plan" || kind === "terminate_plan" ? "P1-high" : "P2-medium"),
      changed: 1,
      plan: workflowV2PlanSummary(updatedRows[0] || null),
      limitations: [
        "writes_only_workflow_v2_plans_and_workflow_events",
        "does_not_mutate_legacy_workflow_runs",
        "does_not_cancel_workers_adapter_jobs_sessions_dispatches_outbox_or_side_effects",
        "readiness_blockers_must_be_clear_before_execution"
      ],
      dbFile: paths.dbFile
    };
  }

  return {
    workflowV2InterventionExecute
  };
}
