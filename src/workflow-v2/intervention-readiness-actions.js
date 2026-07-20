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
  if (typeof value !== "function") throw new Error(`workflow v2 intervention readiness dependency missing: ${name}`);
  return value;
}

function statusList(statuses) {
  return [...statuses].map((status) => sqlValue(status)).join(", ");
}

function countByStatus(rows = []) {
  const counts = {};
  for (const row of rows) counts[row.status || "unknown"] = Number(row.count || 0);
  return counts;
}

function hasAllColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
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

function interventionKind(input = {}) {
  const action = firstText(input.interventionAction, input.intervention_action, input.targetAction, input.target_action, input.action);
  const text = String(action || "workflow.v2.intervention_readiness.preview").toLowerCase().replace(/-/g, "_");
  const explicit = String(input.kind || input.interventionKind || input.intervention_kind || "").toLowerCase().replace(/-/g, "_");
  const value = explicit || text;
  if (value.includes("resume")) return "resume_plan";
  if (value.includes("terminate")) return "terminate_plan";
  if (value.includes("stop")) return "stop_plan";
  if (value.includes("rerun") && value.includes("node")) return "rerun_node";
  if (value.includes("rerun") && value.includes("worker")) return "rerun_worker";
  if (value.includes("pause")) return "pause_plan";
  return "intervention_readiness";
}

function riskTier(kind, blockers = []) {
  if (blockers.some((item) => item.code === "side_effect_uncertain")) return "P0-critical";
  if (kind === "stop_plan" || kind === "terminate_plan" || kind.startsWith("rerun_")) return "P1-high";
  if (kind === "pause_plan" || kind === "resume_plan") return "P2-medium";
  return "P2-medium";
}

function planTerminal(plan = {}) {
  return TERMINAL_PLAN_STATUSES.has(plan.status || "") || TERMINAL_WORKFLOW_STATES.has(plan.workflowState || "");
}

function planPaused(plan = {}) {
  return plan.status === "blocked" || plan.workflowState === "blocked";
}

function buildBlockers(kind, plan, facts = {}) {
  const blockers = [];
  const warnings = [];
  if (!plan) {
    blockers.push({ code: "v2_plan_not_found", detail: "v2 plan scope did not match any workflow_v2_plans row" });
    return { blockers, warnings };
  }
  if (planTerminal(plan)) blockers.push({ code: "plan_terminal", detail: `plan status=${plan.status} workflowState=${plan.workflowState}` });
  if (kind === "pause_plan" && planPaused(plan)) blockers.push({ code: "already_paused_or_blocked", detail: "plan is already blocked/paused for intervention purposes" });
  if (kind === "resume_plan" && !planPaused(plan) && plan.workflowState !== "waiting_human") {
    blockers.push({ code: "resume_invalid_state", detail: `resume requires blocked/waiting_human state, got status=${plan.status} workflowState=${plan.workflowState}` });
  }
  if (facts.activeWorkers > 0) blockers.push({ code: "active_workers", detail: `${facts.activeWorkers} v2 worker runs are active` });
  if (facts.activeAdapterJobs > 0) blockers.push({ code: "active_adapter_jobs", detail: `${facts.activeAdapterJobs} v2 adapter jobs are active` });
  if (facts.activeSessions > 0) blockers.push({ code: "active_session_runs", detail: `${facts.activeSessions} workflow session runs are active` });
  if (facts.activeDispatches > 0) blockers.push({ code: "active_dispatches", detail: `${facts.activeDispatches} shared dispatches are active` });
  if (facts.activeOutbox > 0) blockers.push({ code: "active_outbox", detail: `${facts.activeOutbox} Telegram outbox rows are queued/delivering/failed` });
  if (facts.sideEffectsUncertain > 0) blockers.push({ code: "side_effect_uncertain", detail: `${facts.sideEffectsUncertain} side-effect rows are unresolved` });
  if (facts.activeIncidents > 0) blockers.push({ code: "active_incidents", detail: `${facts.activeIncidents} incident states are active` });
  if (kind === "resume_plan" && facts.pendingHumanGates > 0) blockers.push({ code: "pending_human_gate", detail: `${facts.pendingHumanGates} Human Gate records remain pending` });
  if ((kind === "stop_plan" || kind === "terminate_plan") && !facts.latestCheckpoint) {
    blockers.push({ code: "checkpoint_required", detail: "stop/terminate readiness requires a latest checkpoint or rollback boundary" });
  }
  if (facts.draftHumanGatePackages > 0) warnings.push({ code: "draft_human_gate_packages", detail: `${facts.draftHumanGatePackages} v2 Human Gate packages still require Cat Claw audit` });
  if (facts.reviewWorkers > 0) warnings.push({ code: "review_workers", detail: `${facts.reviewWorkers} v2 worker runs are waiting for review or handoff` });
  return { blockers, warnings };
}

async function countRowsByStatus(dbFile, table, whereClause = "") {
  const columns = await tableColumns(dbFile, table);
  if (!columns.size || !columns.has("status")) return { rows: [], counts: {} };
  const where = whereClause ? `WHERE ${whereClause}` : "";
  const rows = await sqlite(dbFile, `SELECT status, COUNT(*) AS count FROM ${table} ${where} GROUP BY status;`, { json: true });
  return { rows, counts: countByStatus(rows) };
}

function sumStatuses(counts = {}, statuses) {
  return [...statuses].reduce((total, status) => total + Number(counts[status] || 0), 0);
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

async function firstRows(dbFile, table, whereClause, orderColumn, limit = 20) {
  const columns = await tableColumns(dbFile, table);
  if (!columns.size) return [];
  const where = whereClause ? `WHERE ${whereClause}` : "";
  const order = columns.has(orderColumn) ? `ORDER BY ${orderColumn} DESC` : "";
  return sqlite(dbFile, `SELECT * FROM ${table} ${where} ${order} LIMIT ${Math.max(1, Math.min(50, Number(limit) || 20))};`, { json: true });
}

export function createWorkflowV2InterventionReadinessActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateCount = requireContextFunction(context, "pendingHumanGateCount");
  const workflowPayloadSqlWhere = requireContextFunction(context, "workflowPayloadSqlWhere");

  async function workflowV2InterventionReadinessPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const kind = interventionKind(input);
    const planScope = scopedPlanWhere(input, "p");
    if (!planScope && !firstText(input.workflowId, input.workflow_id)) throw new Error("workflowId or planId is required");
    if (!fileExistsSync(paths.dbFile)) {
      return {
        operation: "workflow.v2.intervention_readiness.preview",
        dryRun: true,
        previewOnly: true,
        eligible: false,
        kind,
        riskTier: "P2-medium",
        blockers: [{ code: "workflow_database_missing", detail: "workflow database does not exist" }],
        warnings: [],
        generatedAt,
        dbFile: paths.dbFile
      };
    }
    const planRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans p
${planScope ? `WHERE ${planScope}` : ""}
ORDER BY p.updated_at DESC, p.created_at DESC, p.plan_id ASC
LIMIT 20;`, { json: true });
    const plan = workflowV2PlanSummary(planRows[0] || null);
    const workflowId = firstText(input.workflowId, input.workflow_id, plan?.workflowId);
    const planId = firstText(input.planId, input.plan_id, plan?.planId);
    if (!plan) {
      const { blockers, warnings } = buildBlockers(kind, null, {});
      return {
        operation: "workflow.v2.intervention_readiness.preview",
        dryRun: true,
        previewOnly: true,
        kind,
        eligible: false,
        riskTier: riskTier(kind, blockers),
        humanGateRequired: true,
        catClawAuditRequired: true,
        generatedAt,
        scope: { workflowId, planId },
        plan: null,
        counts: {},
        latestCheckpoint: null,
        activeWorkers: [],
        activeAdapterJobs: [],
        humanGatePackages: [],
        blockers,
        warnings,
        requiredEvidence: [
          "v2_plan_scope"
        ],
        limitations: [
          "preview_only_no_state_mutation",
          "does_not_pause_workers_cancel_adapter_jobs_or_send_human_gate",
          "future_execution_must_use_dedicated_v2_state_transition_action"
        ],
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
      nodeStatus,
      workerStatus,
      adapterJobStatus,
      sessionStatus,
      dispatchStatus,
      outboxStatus,
      humanGatePackageStatus,
      sideEffectStatus,
      incidentStatus,
      checkpoint,
      workerRows,
      adapterRows,
      humanGatePackageRows
    ] = await Promise.all([
      countRowsByStatus(paths.dbFile, "workflow_v2_plan_nodes", scope),
      countRowsByStatus(paths.dbFile, "workflow_v2_worker_runs", scope),
      countRowsByStatus(paths.dbFile, "workflow_v2_worker_adapter_jobs", scope),
      countRowsByStatus(paths.dbFile, "workflow_session_runs", workflowOnlyScope),
      countRowsByStatus(paths.dbFile, "mixed_meeting_dispatches", workflowOnlyScope),
      countRowsByStatus(paths.dbFile, "telegram_outbox", outboxScope),
      countRowsByStatus(paths.dbFile, "workflow_v2_human_gate_packages", scope),
      countRowsByStatus(paths.dbFile, "side_effect_ledger", workflowOnlyScope),
      countRowsByStatus(paths.dbFile, "incident_states", `status IN (${statusList(ACTIVE_INCIDENT_STATUSES)}) AND ${workflowPayloadSqlWhere(workflowId, { parentColumn: "" })}`),
      workflowId ? latestCheckpoint(paths.dbFile, workflowId) : null,
      firstRows(paths.dbFile, "workflow_v2_worker_runs", `${scope ? `${scope} AND ` : ""}status IN (${statusList(ACTIVE_WORKER_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "workflow_v2_worker_adapter_jobs", `${scope ? `${scope} AND ` : ""}status IN (${statusList(ACTIVE_ADAPTER_JOB_STATUSES)})`, "updated_at"),
      firstRows(paths.dbFile, "workflow_v2_human_gate_packages", `${scope ? `${scope} AND ` : ""}status IN ('draft','cat_claw_audited')`, "updated_at")
    ]);
    const pendingHumanGates = workflowId ? await pendingHumanGateCount(paths, workflowId) : 0;
    const facts = {
      activeWorkers: sumStatuses(workerStatus.counts, ACTIVE_WORKER_STATUSES),
      reviewWorkers: sumStatuses(workerStatus.counts, new Set(["submitted_for_review", "revise_required", "handoff_required", "needs_human_gate"])),
      activeAdapterJobs: sumStatuses(adapterJobStatus.counts, ACTIVE_ADAPTER_JOB_STATUSES),
      activeSessions: sumStatuses(sessionStatus.counts, ACTIVE_SESSION_STATUSES),
      activeDispatches: sumStatuses(dispatchStatus.counts, ACTIVE_DISPATCH_STATUSES),
      activeOutbox: sumStatuses(outboxStatus.counts, ACTIVE_OUTBOX_STATUSES),
      sideEffectsUncertain: sumStatuses(sideEffectStatus.counts, UNRESOLVED_SIDE_EFFECT_STATUSES),
      activeIncidents: sumStatuses(incidentStatus.counts, ACTIVE_INCIDENT_STATUSES),
      pendingHumanGates,
      draftHumanGatePackages: Number(humanGatePackageStatus.counts.draft || 0),
      latestCheckpoint: checkpoint
    };
    const { blockers, warnings } = buildBlockers(kind, plan, facts);
    const eligible = blockers.length === 0;
    return {
      operation: "workflow.v2.intervention_readiness.preview",
      dryRun: true,
      previewOnly: true,
      kind,
      eligible,
      riskTier: riskTier(kind, blockers),
      humanGateRequired: true,
      catClawAuditRequired: true,
      generatedAt,
      scope: { workflowId, planId },
      plan,
      counts: {
        nodes: nodeStatus.counts,
        workers: workerStatus.counts,
        adapterJobs: adapterJobStatus.counts,
        sessionRuns: sessionStatus.counts,
        dispatches: dispatchStatus.counts,
        outbox: outboxStatus.counts,
        humanGatePackages: humanGatePackageStatus.counts,
        sideEffects: sideEffectStatus.counts,
        activeIncidents: incidentStatus.counts,
        pendingHumanGates
      },
      latestCheckpoint: checkpoint,
      activeWorkers: workerRows.map(workflowV2WorkerRunSummary).filter(Boolean),
      activeAdapterJobs: adapterRows.map(workflowV2AdapterJobSummary).filter(Boolean),
      humanGatePackages: humanGatePackageRows.map(workflowV2HumanGatePackageSummary).filter(Boolean),
      blockers,
      warnings,
      requiredEvidence: [
        "operator_reason",
        "cat_claw_audit",
        "human_gate_evidence",
        "checkpoint_or_rollback_boundary",
        "runtime_drain_or_cancellation_receipts",
        "side_effect_uncertainty_resolution"
      ],
      limitations: [
        "preview_only_no_state_mutation",
        "does_not_pause_workers_cancel_adapter_jobs_or_send_human_gate",
        "future_execution_must_use_dedicated_v2_state_transition_action"
      ],
      dbFile: paths.dbFile
    };
  }

  return {
    workflowV2InterventionReadinessPreview
  };
}
