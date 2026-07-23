import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  firstText
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
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

function buildStateTransitionBlockers(kind, plan, settlementItems = [], checkpoint = null) {
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
  if ((kind === "stop_plan" || kind === "terminate_plan") && !checkpoint) {
    blockers.push({ code: "checkpoint_required", detail: "stop/terminate settlement requires a latest checkpoint or rollback boundary" });
  }
  for (const item of settlementItems) {
    if (item.severity === "warning") continue;
    blockers.push({ code: `settlement_required:${item.kind}`, detail: `${item.kind} ${item.source} status=${item.status} requires ${item.requiredAction}` });
  }
  return blockers;
}

export function createWorkflowV2InterventionSettlementActionHandlers(context = {}) {
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowPayloadSqlWhere = requireContextFunction(context, "workflowPayloadSqlWhere");

  async function workflowV2InterventionSettlementPreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const kind = interventionKind(input);
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
    const settlementItems = buildSettlementItems({
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
    const blockers = buildStateTransitionBlockers(kind, plan, settlementItems, checkpoint);
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
      plan,
      readiness,
      blockers,
      latestCheckpoint: checkpoint,
      settlementItems,
      settlementSummary: {
        total: settlementItems.length,
        blocking: settlementItems.filter((item) => item.severity === "blocking").length,
        critical: settlementItems.filter((item) => item.severity === "critical").length,
        warning: settlementItems.filter((item) => item.severity === "warning").length
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

  return {
    workflowV2InterventionSettlementPreview
  };
}
