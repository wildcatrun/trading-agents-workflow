import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  firstText,
  jsonHash,
  redactSensitiveForPersistence
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteTransaction,
  tableColumns
} from "../workflow/sqlite.js";
import {
  workflowV2AdapterJobSummary,
  workflowV2HumanGatePackageSummary,
  workflowV2PlanSummary,
  workflowV2WorkerRunSummary
} from "./helpers.js";

const ACTIVE_WORKER_STATUSES = new Set(["queued", "retry_scheduled", "running"]);
const ACTIVE_ADAPTER_JOB_STATUSES = new Set(["queued", "retry_scheduled", "running"]);
const ACTIVE_SESSION_STATUSES = new Set(["queued", "running"]);
const ACTIVE_DISPATCH_STATUSES = new Set(["queued", "sent", "runtime_dispatched", "running", "delivering"]);
const ACTIVE_OUTBOX_STATUSES = new Set(["queued", "delivering", "failed"]);
const UNRESOLVED_SIDE_EFFECT_STATUSES = new Set(["uncertain", "side_effect_uncertain", "unknown", "failed"]);
const ACTIVE_INCIDENT_STATUSES = new Set(["active", "mitigating", "monitoring"]);
const TERMINAL_PLAN_STATUSES = new Set(["completed", "cancelled", "superseded"]);
const TERMINAL_WORKFLOW_STATES = new Set(["completed", "terminated", "cancelled"]);
const SETTLEMENT_SOURCE_KINDS = new Set([
  "worker_run",
  "adapter_job",
  "session_run",
  "runtime_dispatch",
  "outbox_delivery",
  "side_effect",
  "incident",
  "human_gate",
  "human_gate_package"
]);
const SETTLEMENT_RESOLUTIONS = new Set([
  "terminal_receipt",
  "superseded",
  "cancelled_with_evidence",
  "human_accepted",
  "resolved",
  "waived_by_human_gate"
]);
const HUMAN_ACCEPTED_SETTLEMENT_RESOLUTIONS = new Set(["human_accepted", "waived_by_human_gate", "cancelled_with_evidence", "superseded"]);
const TERMINAL_RECEIPT_SETTLEMENT_RESOLUTIONS = new Set(["terminal_receipt", "resolved"]);
const TERMINAL_SOURCE_STATUSES = new Set([
  "completed",
  "succeeded",
  "success",
  "done",
  "sent",
  "delivered",
  "resolved",
  "closed",
  "approved",
  "waived",
  "rejected",
  "cancelled",
  "canceled",
  "superseded",
  "failed",
  "dead_letter",
  "terminal"
]);

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 intervention settlement dependency missing: ${name}`);
  return value;
}

function statusList(statuses) {
  return [...statuses].map((status) => sqlValue(status)).join(", ");
}

function scopedPlanWhere(input = {}, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const clauses = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  if (workflowId) clauses.push(`${prefix}workflow_id=${sqlValue(workflowId)}`);
  if (planId) clauses.push(`${prefix}plan_id=${sqlValue(planId)}`);
  return clauses.length ? clauses.join(" AND ") : "";
}

function planTerminal(plan = {}) {
  return TERMINAL_PLAN_STATUSES.has(plan.status || "") || TERMINAL_WORKFLOW_STATES.has(plan.workflowState || "");
}

function planPaused(plan = {}) {
  return plan.status === "blocked" || plan.workflowState === "blocked";
}

function interventionKind(input = {}) {
  const action = firstText(input.targetAction, input.target_action, input.interventionAction, input.intervention_action, input.action);
  const text = String(action || "workflow.v2.intervention_settlement.preview").toLowerCase().replace(/-/g, "_");
  const explicit = String(input.kind || input.interventionKind || input.intervention_kind || "").toLowerCase().replace(/-/g, "_");
  const value = explicit || text;
  if (value.includes("resume")) return "resume_plan";
  if (value.includes("terminate")) return "terminate_plan";
  if (value.includes("stop")) return "stop_plan";
  if (value.includes("pause")) return "pause_plan";
  return "intervention_settlement";
}

function hasAllColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
}

function settlementRecordSummary(row = {}) {
  return {
    settlementId: row.settlement_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    sourceKind: row.source_kind || "",
    sourceId: row.source_id || "",
    resolution: row.resolution || "",
    receiptRef: row.receipt_ref || "",
    humanGateId: row.human_gate_id || "",
    sideEffectId: row.side_effect_id || "",
    incidentId: row.incident_id || "",
    idempotencyKey: row.idempotency_key || "",
    payloadHash: row.payload_hash || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function settlementKey(kind, source) {
  return `${kind || ""}\n${source || ""}`;
}

function settlementSourceIdForRecord(input = {}, sourceKind, sourceId) {
  if (sourceKind === "side_effect") return firstText(input.sideEffectId, input.side_effect_id, sourceId);
  if (sourceKind === "incident") return firstText(input.incidentId, input.incident_id, sourceId);
  if (sourceKind === "human_gate") return firstText(input.humanGateId, input.human_gate_id, sourceId);
  return sourceId;
}

function settlementActor(input = {}, permissionDecision = null) {
  return firstText(input.actor, input.createdBy, input.created_by, permissionDecision?.caller?.agentId, "unknown");
}

function normalizeSourceKind(input = {}) {
  return String(firstText(input.sourceKind, input.source_kind, input.kind, input.source) || "").trim().toLowerCase().replace(/-/g, "_");
}

function normalizeResolution(input = {}) {
  return String(firstText(input.resolution, input.status) || "").trim().toLowerCase().replace(/-/g, "_");
}

async function loadSettlementRecords(dbFile, workflowId, planId) {
  const columns = await tableColumns(dbFile, "workflow_v2_intervention_settlements");
  if (!hasAllColumns(columns, ["settlement_id", "workflow_id", "plan_id", "source_kind", "source_id", "resolution", "updated_at"])) return [];
  const planClause = planId ? `AND (plan_id=${sqlValue(planId)} OR plan_id='')` : "";
  return sqlite(dbFile, `
SELECT *
FROM workflow_v2_intervention_settlements
WHERE workflow_id=${sqlValue(workflowId)}
  ${planClause}
ORDER BY updated_at DESC, created_at DESC;`, { json: true });
}

function splitSettlementItems(settlementItems = [], settlementRows = []) {
  const settledBySource = new Map();
  for (const row of settlementRows) {
    const sourceKind = row.source_kind || "";
    const sourceId = row.source_id || "";
    const resolution = row.resolution || "";
    if (!SETTLEMENT_SOURCE_KINDS.has(sourceKind) || !SETTLEMENT_RESOLUTIONS.has(resolution) || !sourceId) continue;
    const key = settlementKey(sourceKind, sourceId);
    if (!settledBySource.has(key)) settledBySource.set(key, settlementRecordSummary(row));
  }
  const openItems = [];
  const settledItems = [];
  for (const item of settlementItems) {
    const settlementRecord = settledBySource.get(settlementKey(item.kind, item.source));
    if (settlementRecord) {
      settledItems.push({
        ...item,
        settlementRecord
      });
    } else {
      openItems.push(item);
    }
  }
  return { openItems, settledItems, settlementRecords: [...settledBySource.values()] };
}

function terminalStatus(status = "") {
  return TERMINAL_SOURCE_STATUSES.has(String(status || "").trim().toLowerCase());
}

async function tableHasColumns(dbFile, table, columns = []) {
  const existing = await tableColumns(dbFile, table);
  return hasAllColumns(existing, columns);
}

async function settlementSourceState(dbFile, workflowId, planId, sourceKind, sourceId) {
  const source = sqlValue(sourceId);
  if (sourceKind === "worker_run" && await tableHasColumns(dbFile, "workflow_v2_worker_runs", ["worker_run_id", "workflow_id", "plan_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status, receipt_ref
FROM workflow_v2_worker_runs
WHERE worker_run_id=${source}
  AND workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status), receiptRef: rows[0].receipt_ref || "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "adapter_job" && await tableHasColumns(dbFile, "workflow_v2_worker_adapter_jobs", ["adapter_job_id", "workflow_id", "plan_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status, runner_receipt_ref, artifact_ref
FROM workflow_v2_worker_adapter_jobs
WHERE adapter_job_id=${source}
  AND workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status), receiptRef: firstText(rows[0].runner_receipt_ref, rows[0].artifact_ref) } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "session_run" && await tableHasColumns(dbFile, "workflow_session_runs", ["run_id", "workflow_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status, receipt_ref
FROM workflow_session_runs
WHERE run_id=${source}
  AND workflow_id=${sqlValue(workflowId)}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status), receiptRef: rows[0].receipt_ref || "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "runtime_dispatch" && await tableHasColumns(dbFile, "mixed_meeting_dispatches", ["dispatch_id", "workflow_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status
FROM mixed_meeting_dispatches
WHERE dispatch_id=${source}
  AND workflow_id=${sqlValue(workflowId)}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status), receiptRef: "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "outbox_delivery" && await tableHasColumns(dbFile, "telegram_outbox", ["outbox_id", "meeting_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status
FROM telegram_outbox
WHERE outbox_id=${source}
  AND meeting_id=${sqlValue(workflowId)}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status), receiptRef: "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "side_effect" && await tableHasColumns(dbFile, "side_effect_ledger", ["side_effect_id", "workflow_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status, artifact_ref
FROM side_effect_ledger
WHERE side_effect_id=${source}
  AND workflow_id=${sqlValue(workflowId)}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status), receiptRef: rows[0].artifact_ref || "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "incident" && await tableHasColumns(dbFile, "incident_states", ["incident_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status, resolved_at
FROM incident_states
WHERE incident_id=${source}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status) || Boolean(rows[0].resolved_at), receiptRef: "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "human_gate") {
    const reviewGateRows = await tableHasColumns(dbFile, "review_gates", ["gate_id", "workflow_id", "status"]) ? await sqlite(dbFile, `
SELECT status
FROM review_gates
WHERE gate_id=${source}
  AND workflow_id=${sqlValue(workflowId)}
LIMIT 1;`, { json: true }) : [];
    if (reviewGateRows[0]) return { exists: true, terminal: terminalStatus(reviewGateRows[0].status), receiptRef: "" };
    const protocolRows = await tableHasColumns(dbFile, "protocol_objects", ["object_id", "object_type", "status", "parent_object_id", "payload_json"]) ? await sqlite(dbFile, `
SELECT status
FROM protocol_objects
WHERE object_id=${source}
  AND object_type='human_gate_record'
  AND (parent_object_id=${sqlValue(workflowId)} OR payload_json LIKE ${sqlValue(`%${workflowId}%`)})
LIMIT 1;`, { json: true }) : [];
    return protocolRows[0] ? { exists: true, terminal: terminalStatus(protocolRows[0].status), receiptRef: "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  if (sourceKind === "human_gate_package" && await tableHasColumns(dbFile, "workflow_v2_human_gate_packages", ["package_id", "workflow_id", "plan_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT status
FROM workflow_v2_human_gate_packages
WHERE package_id=${source}
  AND workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true });
    return rows[0] ? { exists: true, terminal: terminalStatus(rows[0].status), receiptRef: "" } : { exists: false, terminal: false, receiptRef: "" };
  }
  return { exists: false, terminal: false, receiptRef: "" };
}

async function approvedHumanGateExists(dbFile, workflowId, humanGateId) {
  if (!humanGateId) return false;
  if (await tableHasColumns(dbFile, "review_gates", ["gate_id", "workflow_id", "status"])) {
    const rows = await sqlite(dbFile, `
SELECT gate_id
FROM review_gates
WHERE gate_id=${sqlValue(humanGateId)}
  AND workflow_id=${sqlValue(workflowId)}
  AND status IN ('approved','waived')
LIMIT 1;`, { json: true });
    if (rows[0]) return true;
  }
  if (await tableHasColumns(dbFile, "protocol_objects", ["object_id", "object_type", "status", "parent_object_id", "payload_json"])) {
    const rows = await sqlite(dbFile, `
SELECT object_id
FROM protocol_objects
WHERE object_id=${sqlValue(humanGateId)}
  AND object_type='human_gate_record'
  AND status IN ('approved','waived')
  AND (parent_object_id=${sqlValue(workflowId)} OR payload_json LIKE ${sqlValue(`%${workflowId}%`)})
LIMIT 1;`, { json: true });
    if (rows[0]) return true;
  }
  return false;
}

async function approvedProtocolAuditExists(dbFile, workflowId, planId, auditId) {
  if (!auditId) return false;
  if (!await tableHasColumns(dbFile, "workflow_v2_protocol_audits", ["audit_id", "workflow_id", "plan_id", "decision"])) return false;
  const rows = await sqlite(dbFile, `
SELECT audit_id
FROM workflow_v2_protocol_audits
WHERE audit_id=${sqlValue(auditId)}
  AND workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
  AND decision IN ('pass','approved','met')
LIMIT 1;`, { json: true });
  return Boolean(rows[0]);
}

async function firstRows(dbFile, table, whereClause, orderColumn, limit = 20) {
  const columns = await tableColumns(dbFile, table);
  if (!columns.size) return [];
  const where = whereClause ? `WHERE ${whereClause}` : "";
  const order = columns.has(orderColumn) ? `ORDER BY ${orderColumn} DESC` : "";
  return sqlite(dbFile, `SELECT * FROM ${table} ${where} ${order} LIMIT ${Math.max(1, Math.min(50, Number(limit) || 20))};`, { json: true });
}

async function latestCheckpoint(dbFile, workflowId) {
  const columns = await tableColumns(dbFile, "workflow_checkpoints");
  if (!hasAllColumns(columns, ["workflow_id", "checkpoint_id", "status", "phase", "decision", "path", "created_at"])) return null;
  const rows = await sqlite(dbFile, `
SELECT checkpoint_id, status, phase, decision, path, created_at
FROM workflow_checkpoints
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

function sessionRunSummary(row = {}) {
  return {
    sessionRunId: row.run_id || "",
    sessionId: row.session_id || "",
    workflowId: row.workflow_id || "",
    taskId: row.task_id || "",
    dispatchId: row.dispatch_id || "",
    workerId: row.worker_id || "",
    status: row.status || "",
    receiptRef: row.receipt_ref || "",
    error: row.error || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function dispatchSummary(row = {}) {
  return {
    dispatchId: row.dispatch_id || "",
    workflowId: row.workflow_id || "",
    meetingId: row.meeting_id || "",
    runtime: row.runtime || "",
    agentId: row.agent_id || "",
    agentKey: row.agent_key || "",
    dispatchType: row.dispatch_type || "",
    status: row.status || "",
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextRetryAt: row.next_retry_at || "",
    failureType: row.failure_type || "",
    lastError: row.last_error || "",
    createdAt: row.created_at || "",
    sentAt: row.sent_at || "",
    ackedAt: row.acked_at || "",
    completedAt: row.completed_at || "",
    updatedAt: row.updated_at || ""
  };
}

function outboxSummary(row = {}) {
  return {
    outboxId: row.outbox_id || "",
    meetingId: row.meeting_id || "",
    targetKind: row.target_kind || "",
    targetRef: row.target_ref || "",
    messageType: row.message_type || "",
    status: row.status || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function sideEffectSummary(row = {}) {
  return {
    sideEffectId: row.side_effect_id || "",
    workflowId: row.workflow_id || "",
    dispatchId: row.dispatch_id || "",
    idempotencyKey: row.idempotency_key || "",
    ownerAgent: row.owner_agent || "",
    sideEffectType: row.side_effect_type || "",
    status: row.status || "",
    artifactRef: row.artifact_ref || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function incidentSummary(row = {}) {
  return {
    incidentId: row.incident_id || "",
    status: row.status || "",
    mode: row.mode || "",
    summary: row.summary || "",
    commander: row.commander || "",
    impact: row.impact || "",
    declaredAt: row.declared_at || "",
    nextUpdateAt: row.next_update_at || "",
    resolvedAt: row.resolved_at || "",
    updatedAt: row.updated_at || ""
  };
}

function humanGateSummary(row = {}) {
  return {
    humanGateId: row.gate_id || row.object_id || "",
    sourceTable: row.source_table || "",
    status: row.status || "",
    gateType: row.gate_type || row.object_type || "",
    summary: row.summary || "",
    reviewerAgent: row.reviewer_agent || row.source_agent || "",
    resumePointer: row.resume_pointer || row.path || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function settlementItem(kind, source, status, owner, requiredAction, evidence = {}, severity = "blocking") {
  return {
    kind,
    source,
    status,
    owner,
    requiredAction,
    severity,
    evidence
  };
}

function buildSettlementItems({
  workerRows = [],
  adapterRows = [],
  sessionRows = [],
  dispatchRows = [],
  outboxRows = [],
  sideEffectRows = [],
  incidentRows = [],
  humanGateRows = [],
  humanGatePackageRows = []
} = {}) {
  return [
    ...workerRows.map((row) => settlementItem(
      "worker_run",
      row.worker_run_id || "",
      row.status || "",
      row.manager_agent || row.worker_agent_id || "",
      "obtain_terminal_worker_receipt_or_record_governed_worker_cancellation",
      workflowV2WorkerRunSummary(row)
    )),
    ...adapterRows.map((row) => settlementItem(
      "adapter_job",
      row.adapter_job_id || "",
      row.status || "",
      row.runner_id || row.lease_owner || row.runtime_backend || "",
      "obtain_terminal_adapter_job_receipt_or_record_governed_adapter_cancellation",
      workflowV2AdapterJobSummary(row)
    )),
    ...sessionRows.map((row) => settlementItem(
      "session_run",
      row.run_id || "",
      row.status || "",
      row.worker_id || "",
      "obtain_terminal_session_receipt_before_plan_state_transition",
      sessionRunSummary(row)
    )),
    ...dispatchRows.map((row) => settlementItem(
      "runtime_dispatch",
      row.dispatch_id || "",
      row.status || "",
      row.agent_key || row.agent_id || row.runtime || "",
      "reconcile_dispatch_to_terminal_receipt_or_record_safe_cancellation_evidence",
      dispatchSummary(row)
    )),
    ...outboxRows.map((row) => settlementItem(
      "outbox_delivery",
      row.outbox_id || "",
      row.status || "",
      row.target_ref || row.target_kind || "",
      "deliver_cancel_or_supersede_outbox_with_delivery_receipt",
      outboxSummary(row)
    )),
    ...sideEffectRows.map((row) => settlementItem(
      "side_effect",
      row.side_effect_id || "",
      row.status || "",
      row.owner_agent || "",
      "resolve_side_effect_uncertainty_before_stop_terminate_or_rerun",
      sideEffectSummary(row),
      "critical"
    )),
    ...incidentRows.map((row) => settlementItem(
      "incident",
      row.incident_id || "",
      row.status || "",
      row.commander || "",
      "close_or_downgrade_incident_with_exit_criteria_evidence",
      incidentSummary(row)
    )),
    ...humanGateRows.map((row) => settlementItem(
      "human_gate",
      row.gate_id || row.object_id || "",
      row.status || "",
      row.reviewer_agent || row.source_agent || "",
      "collect_human_gate_decision_or_supersede_with_audited_closeout",
      humanGateSummary(row)
    )),
    ...humanGatePackageRows.map((row) => settlementItem(
      "human_gate_package",
      row.package_id || "",
      row.status || "",
      row.cat_claw_agent || row.cat_brain_agent || "",
      "complete_protocol_audit_or_supersede_human_gate_package",
      workflowV2HumanGatePackageSummary(row),
      row.status === "draft" ? "blocking" : "warning"
    ))
  ];
}

function buildStateTransitionBlockers(kind, plan, settlementItems = [], checkpoint = null, rollbackBoundary = "") {
  const blockers = [];
  if (!plan) {
    blockers.push({ code: "v2_plan_not_found", detail: "v2 plan scope did not match any workflow_v2_plans row" });
    return blockers;
  }
  if (planTerminal(plan)) blockers.push({ code: "plan_terminal", detail: `plan status=${plan.status} workflowState=${plan.workflowState}` });
  if (kind === "pause_plan" && planPaused(plan)) blockers.push({ code: "already_paused_or_blocked", detail: "plan is already blocked/paused for intervention purposes" });
  if (kind === "resume_plan" && !planPaused(plan) && plan.workflowState !== "waiting_human") {
    blockers.push({ code: "resume_invalid_state", detail: `resume requires blocked/waiting_human state, got status=${plan.status} workflowState=${plan.workflowState}` });
  }
  if ((kind === "stop_plan" || kind === "terminate_plan") && !checkpoint && !rollbackBoundary) {
    blockers.push({ code: "checkpoint_required", detail: "stop/terminate settlement requires a latest checkpoint or rollback boundary" });
  }
  for (const item of settlementItems) {
    if (item.severity === "warning") continue;
    blockers.push({ code: `settlement_required:${item.kind}`, detail: `${item.kind} ${item.source} status=${item.status} requires ${item.requiredAction}` });
  }
  return blockers;
}

function riskTier(kind, settlementItems = []) {
  if (settlementItems.some((item) => item.kind === "side_effect" && item.severity === "critical")) return "P0-critical";
  if (kind === "stop_plan" || kind === "terminate_plan") return "P1-high";
  if (kind === "pause_plan" || kind === "resume_plan") return "P2-medium";
  return "P2-medium";
}

export function createWorkflowV2InterventionSettlementActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowPayloadSqlWhere = requireContextFunction(context, "workflowPayloadSqlWhere");

  async function workflowV2InterventionSettlementPreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const kind = interventionKind(input);
    const rollbackBoundary = firstText(input.rollbackBoundary, input.rollback_boundary, input.resumeBoundary, input.resume_boundary, input.stopCondition, input.stop_condition);
    const planScope = scopedPlanWhere(input, "p");
    if (!planScope && !firstText(input.workflowId, input.workflow_id)) throw new Error("workflowId or planId is required");
    if (!fileExistsSync(paths.dbFile)) {
      return {
        operation: "workflow.v2.intervention_settlement.preview",
        dryRun: true,
        previewOnly: true,
        eligibleForStateTransition: false,
        kind,
        generatedAt,
        scope: {
          workflowId: firstText(input.workflowId, input.workflow_id),
          planId: firstText(input.planId, input.plan_id)
        },
        riskTier: "P2-medium",
        plan: null,
        blockers: [{ code: "workflow_database_missing", detail: "workflow database does not exist" }],
        readiness: {
          operation: "workflow.v2.intervention_settlement.readiness_summary",
          eligible: false,
          source: "settlement_preview_read_only"
        },
        settlementItems: [],
        requiredEvidence: ["workflow_database"],
        limitations: ["preview_only_no_state_mutation"],
        dbFile: paths.dbFile
      };
    }
    const planColumns = await tableColumns(paths.dbFile, "workflow_v2_plans");
    const planRows = planColumns.size ? await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans p
${planScope ? `WHERE ${planScope}` : ""}
ORDER BY p.updated_at DESC, p.created_at DESC, p.plan_id ASC
LIMIT 20;`, { json: true }) : [];
    const plan = workflowV2PlanSummary(planRows[0] || null);
    const workflowId = firstText(input.workflowId, input.workflow_id, plan?.workflowId);
    const planId = firstText(input.planId, input.plan_id, plan?.planId);
    if (!plan || !workflowId) {
      return {
        operation: "workflow.v2.intervention_settlement.preview",
        dryRun: true,
        previewOnly: true,
        eligibleForStateTransition: false,
        kind,
        generatedAt,
        scope: { workflowId, planId },
        riskTier: "P2-medium",
        plan,
        blockers: [{ code: "v2_plan_not_found", detail: "v2 plan scope did not match any workflow_v2_plans row" }],
        readiness: {
          operation: "workflow.v2.intervention_settlement.readiness_summary",
          eligible: false,
          source: "settlement_preview_read_only"
        },
        settlementItems: [],
        requiredEvidence: ["v2_plan_scope"],
        limitations: ["preview_only_no_state_mutation"],
        dbFile: paths.dbFile
      };
    }
    const scope = [
      workflowId ? `workflow_id=${sqlValue(workflowId)}` : "",
      planId ? `plan_id=${sqlValue(planId)}` : ""
    ].filter(Boolean).join(" AND ");
    const workflowOnlyScope = workflowId ? `workflow_id=${sqlValue(workflowId)}` : scope;
    const outboxScope = workflowId ? `meeting_id=${sqlValue(workflowId)}` : "";
    const [
      checkpoint,
      workerRows,
      adapterRows,
      sessionRows,
      dispatchRows,
      outboxRows,
      sideEffectRows,
      incidentRows,
      reviewGateRows,
      protocolHumanGateRows,
      humanGatePackageRows
    ] = await Promise.all([
      latestCheckpoint(paths.dbFile, workflowId),
      firstRows(paths.dbFile, "workflow_v2_worker_runs", `${scope ? `${scope} AND ` : ""}status IN (${statusList(ACTIVE_WORKER_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "workflow_v2_worker_adapter_jobs", `${scope ? `${scope} AND ` : ""}status IN (${statusList(ACTIVE_ADAPTER_JOB_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "workflow_session_runs", `${workflowOnlyScope ? `${workflowOnlyScope} AND ` : ""}status IN (${statusList(ACTIVE_SESSION_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "mixed_meeting_dispatches", `${workflowOnlyScope ? `${workflowOnlyScope} AND ` : ""}status IN (${statusList(ACTIVE_DISPATCH_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "telegram_outbox", `${outboxScope ? `${outboxScope} AND ` : ""}status IN (${statusList(ACTIVE_OUTBOX_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "side_effect_ledger", `${workflowOnlyScope ? `${workflowOnlyScope} AND ` : ""}status IN (${statusList(UNRESOLVED_SIDE_EFFECT_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "incident_states", `status IN (${statusList(ACTIVE_INCIDENT_STATUSES)}) AND ${workflowPayloadSqlWhere(workflowId, { parentColumn: "" })}`, "updated_at"),
      firstRows(paths.dbFile, "review_gates", `workflow_id=${sqlValue(workflowId)} AND (status='pending' OR (human_gate_required=1 AND status NOT IN ('approved','waived','rejected')))`, "updated_at"),
      firstRows(paths.dbFile, "protocol_objects", `object_type='human_gate_record' AND status='pending' AND ${workflowPayloadSqlWhere(workflowId)}`, "updated_at"),
      firstRows(paths.dbFile, "workflow_v2_human_gate_packages", `${scope ? `${scope} AND ` : ""}status IN ('draft','protocol_audited')`, "updated_at")
    ]);
    const humanGateRows = [
      ...reviewGateRows.map((row) => ({ ...row, source_table: "review_gates" })),
      ...protocolHumanGateRows.map((row) => ({ ...row, source_table: "protocol_objects" }))
    ];
    const rawSettlementItems = buildSettlementItems({
      workerRows,
      adapterRows,
      sessionRows,
      dispatchRows,
      outboxRows,
      sideEffectRows,
      incidentRows,
      humanGateRows,
      humanGatePackageRows
    });
    const settlementRecords = await loadSettlementRecords(paths.dbFile, workflowId, planId);
    const {
      openItems: settlementItems,
      settledItems,
      settlementRecords: matchedSettlementRecords
    } = splitSettlementItems(rawSettlementItems, settlementRecords);
    const blockers = buildStateTransitionBlockers(kind, plan, settlementItems, checkpoint, rollbackBoundary);
    const eligibleForStateTransition = blockers.length === 0;
    const readiness = {
      operation: "workflow.v2.intervention_settlement.readiness_summary",
      eligible: eligibleForStateTransition,
      source: "settlement_preview_read_only",
      blockers
    };
    return {
      operation: "workflow.v2.intervention_settlement.preview",
      dryRun: true,
      previewOnly: true,
      eligibleForStateTransition,
      kind,
      generatedAt,
      scope: { workflowId, planId },
      riskTier: riskTier(kind, settlementItems),
      plan,
      readiness,
      blockers,
      latestCheckpoint: checkpoint,
      settlementItems,
      settledItems,
      settlementRecords: matchedSettlementRecords,
      settlementSummary: {
        total: settlementItems.length,
        blocking: settlementItems.filter((item) => item.severity === "blocking").length,
        critical: settlementItems.filter((item) => item.severity === "critical").length,
        warning: settlementItems.filter((item) => item.severity === "warning").length,
        settled: settledItems.length
      },
      requiredEvidence: [
        "terminal_worker_or_cancellation_receipts",
        "adapter_job_terminal_receipts",
        "session_run_terminal_receipts",
        "dispatch_terminal_receipts",
        "outbox_delivery_or_supersede_receipts",
        "human_gate_decision_or_supersede_evidence",
        "side_effect_uncertainty_resolution",
        "incident_exit_criteria_evidence",
        "checkpoint_or_rollback_boundary"
      ],
      limitations: [
        "preview_only_no_state_mutation",
        "does_not_cancel_workers_adapter_jobs_sessions_dispatches_outbox_or_side_effects",
        "does_not_mark_human_gate_or_incident_terminal",
        "state_transition_must_continue_to_use_workflow_v2_pause_resume_stop_terminate"
      ],
      dbFile: paths.dbFile
    };
  }

  async function workflowV2InterventionSettlementRecord(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const planId = firstText(input.planId, input.plan_id);
    if (!workflowId) throw new Error("workflowId is required for workflow v2 intervention settlement record");
    if (!planId) throw new Error("planId is required for workflow v2 intervention settlement record");
    const sourceKind = normalizeSourceKind(input);
    if (!SETTLEMENT_SOURCE_KINDS.has(sourceKind)) {
      throw new Error(`unsupported workflow v2 intervention settlement sourceKind: ${sourceKind || "missing"}`);
    }
    const sourceId = firstText(input.sourceId, input.source_id, input.sourceRef, input.source_ref);
    if (!sourceId) throw new Error("sourceId is required for workflow v2 intervention settlement record");
    const resolution = normalizeResolution(input);
    if (!SETTLEMENT_RESOLUTIONS.has(resolution)) {
      throw new Error(`unsupported workflow v2 intervention settlement resolution: ${resolution || "missing"}`);
    }
    const receiptRef = firstText(input.receiptRef, input.receipt_ref, input.artifactRef, input.artifact_ref);
    const humanGateId = firstText(input.humanGateId, input.human_gate_id);
    const protocolAuditId = firstText(input.protocolAuditId, input.protocol_audit_id);
    const sideEffectId = sourceKind === "side_effect"
      ? settlementSourceIdForRecord(input, sourceKind, sourceId)
      : firstText(input.sideEffectId, input.side_effect_id);
    const incidentId = sourceKind === "incident"
      ? settlementSourceIdForRecord(input, sourceKind, sourceId)
      : firstText(input.incidentId, input.incident_id);
    if (!receiptRef && !humanGateId && !sideEffectId && !incidentId) {
      throw new Error("receiptRef, humanGateId, sideEffectId, or incidentId is required for workflow v2 intervention settlement record");
    }
    const idempotencyKey = firstText(input.idempotencyKey, input.idempotency_key);
    const explicitSettlementId = firstText(input.settlementId, input.settlement_id);
    if (!idempotencyKey && !explicitSettlementId) {
      throw new Error("idempotencyKey or settlementId is required for workflow v2 intervention settlement record");
    }
    const now = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const actor = settlementActor(input, permissionDecision);
    const settlementId = explicitSettlementId || `workflow_v2_intervention_settlement.${jsonHash({
      workflowId,
      planId,
      sourceKind,
      sourceId,
      idempotencyKey
    }).slice(0, 24)}`;
    const payload = redactSensitiveForPersistence({
      schemaVersion: "workflow_v2_intervention_settlement.v1",
      workflowId,
      planId,
      sourceKind,
      sourceId,
      resolution,
      receiptRef,
      humanGateId,
      sideEffectId,
      incidentId,
      idempotencyKey,
      protocolAuditId,
      operatorReasonPresent: Boolean(firstText(input.operatorReason, input.operator_reason, input.reason, input.summary)),
      evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs : Array.isArray(input.evidence_refs) ? input.evidence_refs : [],
      permissionPolicyOutcome: permissionDecision?.policyOutcome || ""
    });
    const payloadHash = jsonHash(payload);
    const sourceState = await settlementSourceState(paths.dbFile, workflowId, planId, sourceKind, sourceId);
    if (!sourceState.exists) {
      throw new Error(`workflow v2 intervention settlement source evidence not found: sourceKind=${sourceKind} sourceId=${sourceId}`);
    }
    const humanGateApproved = await approvedHumanGateExists(paths.dbFile, workflowId, humanGateId);
    const protocolAuditApproved = await approvedProtocolAuditExists(paths.dbFile, workflowId, planId, protocolAuditId);
    if (TERMINAL_RECEIPT_SETTLEMENT_RESOLUTIONS.has(resolution) && !sourceState.terminal) {
      throw new Error(`workflow v2 intervention settlement terminal source evidence is required: sourceKind=${sourceKind} sourceId=${sourceId} resolution=${resolution}`);
    }
    if (HUMAN_ACCEPTED_SETTLEMENT_RESOLUTIONS.has(resolution) && !humanGateApproved && !protocolAuditApproved) {
      throw new Error(`workflow v2 intervention settlement approved Human Gate or protocol audit evidence is required: sourceKind=${sourceKind} sourceId=${sourceId} resolution=${resolution}`);
    }
    const existingByIdempotencyRows = idempotencyKey ? await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_intervention_settlements
WHERE idempotency_key=${sqlValue(idempotencyKey)}
LIMIT 1;`, { json: true }) : [];
    if (existingByIdempotencyRows[0]) {
      if (existingByIdempotencyRows[0].payload_hash !== payloadHash) {
        throw new Error("workflow v2 intervention settlement idempotency conflict: payloadHash does not match existing idempotencyKey");
      }
      return {
        operation: "workflow.v2.intervention_settlement.record",
        workflowId,
        planId,
        settlementId: existingByIdempotencyRows[0].settlement_id || settlementId,
        sourceKind,
        sourceId,
        resolution,
        receiptRef,
        humanGateId,
        sideEffectId,
        incidentId,
        idempotencyKey,
        payloadHash,
        status: "replayed",
        replayed: true,
        record: settlementRecordSummary(existingByIdempotencyRows[0]),
        dbFile: paths.dbFile
      };
    }
    const existingRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_intervention_settlements
WHERE settlement_id=${sqlValue(settlementId)}
LIMIT 1;`, { json: true });
    if (existingRows[0]) {
      if (existingRows[0].payload_hash !== payloadHash) {
        throw new Error("workflow v2 intervention settlement idempotency conflict: payloadHash does not match existing record");
      }
      return {
        operation: "workflow.v2.intervention_settlement.record",
        workflowId,
        planId,
        settlementId,
        sourceKind,
        sourceId,
        resolution,
        receiptRef,
        humanGateId,
        sideEffectId,
        incidentId,
        idempotencyKey,
        payloadHash,
        status: "replayed",
        replayed: true,
        record: settlementRecordSummary(existingRows[0]),
        dbFile: paths.dbFile
      };
    }
    await sqliteTransaction(paths.dbFile, `
INSERT OR IGNORE INTO workflow_v2_intervention_settlements(settlement_id, workflow_id, plan_id, source_kind, source_id, resolution, receipt_ref, human_gate_id, side_effect_id, incident_id, idempotency_key, payload_hash, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(settlementId)}, ${sqlValue(workflowId)}, ${sqlValue(planId)}, ${sqlValue(sourceKind)}, ${sqlValue(sourceId)}, ${sqlValue(resolution)}, ${sqlValue(receiptRef)}, ${sqlValue(humanGateId)}, ${sqlValue(sideEffectId)}, ${sqlValue(incidentId)}, ${sqlValue(idempotencyKey)}, ${sqlValue(payloadHash)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(actor)}, ${sqlValue(now)}, ${sqlValue(now)});`);
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_intervention_settlements
WHERE settlement_id=${sqlValue(settlementId)}
LIMIT 1;`, { json: true });
    const row = rows[0] || null;
    if (!row) throw new Error(`workflow v2 intervention settlement record failed: ${settlementId}`);
    if (row.payload_hash !== payloadHash) {
      throw new Error("workflow v2 intervention settlement idempotency conflict: payloadHash does not match existing record");
    }
    return {
      operation: "workflow.v2.intervention_settlement.record",
      workflowId,
      planId,
      settlementId,
      sourceKind,
      sourceId,
      resolution,
      receiptRef,
      humanGateId,
      sideEffectId,
      incidentId,
      idempotencyKey,
      payloadHash,
      status: "recorded",
      replayed: false,
      record: settlementRecordSummary(row),
      dbFile: paths.dbFile
    };
  }

  return {
    workflowV2InterventionSettlementPreview,
    workflowV2InterventionSettlementRecord
  };
}
