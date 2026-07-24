import {
  firstText,
  jsonHash,
  redactSensitiveTextForPersistence
} from "../workflow/json.js";
import {
  isSqliteConstraintError,
  sqlValue,
  sqlite,
  sqliteTransaction,
  tableColumns
} from "../workflow/sqlite.js";
import {
  workflowV2IsProtocolAuditState
} from "./neutral-names.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 evaluation action dependency missing: ${name}`);
  return value;
}

function hasColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
}

function countByStatus(rows = []) {
  const counts = {};
  for (const row of rows) {
    const status = String(row.status || "unknown");
    counts[status] = Number(row.count || 0);
  }
  return counts;
}

function countRows(rows = []) {
  return rows.reduce((total, row) => total + Number(row.count || 0), 0);
}

function sumCounts(counts = {}, names = []) {
  return names.reduce((total, name) => total + Number(counts[name] || 0), 0);
}

function scopedWhere(workflowId, planId = "", alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const clauses = [`${prefix}workflow_id=${sqlValue(workflowId)}`];
  if (planId) clauses.push(`${prefix}plan_id=${sqlValue(planId)}`);
  return clauses.join(" AND ");
}

function payloadExpr(alias = "", payloadColumn = "payload_json") {
  const prefix = alias ? `${alias}.` : "";
  const column = `${prefix}${payloadColumn}`;
  return `CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END`;
}

function payloadPlanWhere(planId, alias = "", payloadColumn = "payload_json") {
  const payload = payloadExpr(alias, payloadColumn);
  const value = sqlValue(planId);
  return `(
    json_extract(${payload}, '$.planId')=${value}
    OR json_extract(${payload}, '$.plan_id')=${value}
    OR json_extract(${payload}, '$.plan.planId')=${value}
    OR json_extract(${payload}, '$.plan.plan_id')=${value}
    OR json_extract(${payload}, '$.payload.planId')=${value}
    OR json_extract(${payload}, '$.payload.plan_id')=${value}
  )`;
}

function scopedRuntimeDispatchWhere(workflowId, planId = "", planCount = 0, runtimeAlias = "r", dispatchAlias = "d", requirePlanScope = false) {
  const base = `${runtimeAlias}.workflow_id=${sqlValue(workflowId)}`;
  if (!planId || (!requirePlanScope && Number(planCount || 0) <= 1)) return base;
  return `${base} AND (${payloadPlanWhere(planId, runtimeAlias)} OR ${payloadPlanWhere(planId, dispatchAlias)})`;
}

function scopedDispatchWhere(workflowId, planId = "", planCount = 0, alias = "d", requirePlanScope = false) {
  const base = `${alias}.workflow_id=${sqlValue(workflowId)}`;
  if (!planId || (!requirePlanScope && Number(planCount || 0) <= 1)) return base;
  return `${base} AND ${payloadPlanWhere(planId, alias)}`;
}

const NON_EVALUATOR_EVIDENCE_ARTIFACT_KINDS = Object.freeze([
  "workflow_v2_plan_spec_json",
  "workflow_template_spec_json"
]);

function evaluationDecision(snapshot = {}) {
  const counts = snapshot.counts || {};
  const v2 = snapshot.v2 || {};
  const validation = snapshot.validation || {};
  const verificationCounts = counts.verificationCounts || {};
  const planStatus = String(v2.planStatus || "");
  const workflowState = String(v2.workflowState || "");
  const workersByStatus = v2.workersByStatus || {};
  const failedVerification = Number(verificationCounts.fail || 0)
    + Number(verificationCounts.not_met || 0)
    + Number(verificationCounts.disputed || 0);
  const evidenceNeeds = Number(verificationCounts.needs_evidence || 0)
    + Number(verificationCounts.uncertain || 0);
  if (!v2.planFound) return "needs_evidence";
  if (Number(counts.sideEffectUncertain || 0) > 0) return "side_effect_uncertain";
  if (workflowV2IsProtocolAuditState(workflowState) || ["human_gate_request_due", "waiting_human"].includes(workflowState)) return "needs_human_gate";
  if (Number(workersByStatus.needs_human_gate || 0) > 0) return "needs_human_gate";
  if (Number(counts.pendingHumanGates || 0) > 0 || Number(verificationCounts.needs_human_gate || 0) > 0) return "needs_human_gate";
  if (Number(counts.activeIncidents || 0) > 0 || Number(verificationCounts.blocked || 0) > 0) return "blocked";
  if (["blocked", "cancelled"].includes(planStatus) || ["blocked", "cancelled", "terminated"].includes(workflowState)) return "blocked";
  if (Number(v2.blockedPlans || 0) > 0 || Number(v2.blockedNodes || 0) > 0 || Number(v2.blockedWorkers || 0) > 0) return "blocked";
  if (Number(v2.failedNodes || 0) > 0 || Number(v2.failedWorkers || 0) > 0 || Number(v2.failedAdapterJobs || 0) > 0) return "not_met";
  if (Number(counts.failedDispatches || 0) > 0 || Number(counts.failedRuntimeRuns || 0) > 0) return "not_met";
  if (failedVerification > 0) return "not_met";
  if (Number(v2.activeWorkers || 0) > 0 || Number(v2.activeAdapterJobs || 0) > 0) return "needs_evidence";
  if (Number(counts.activeDispatches || 0) > 0 || Number(counts.activeRuntimeRuns || 0) > 0) return "needs_evidence";
  if (Number(v2.reviewWorkers || 0) > 0) return "needs_evidence";
  if (Number(v2.nodesTotal || 0) > 0 && Number(v2.completedNodes || 0) < Number(v2.nodesTotal || 0)) return "needs_evidence";
  if (evidenceNeeds > 0) return "needs_evidence";
  if (Number(counts.artifactCount || 0) <= 0 || Number(counts.runtimeReceiptCount || 0) <= 0 || Number(counts.verificationTotal || 0) <= 0) return "needs_evidence";
  if (v2.planStatus === "completed" || v2.workflowState === "completed" || (Number(v2.nodesTotal || 0) > 0 && Number(v2.completedNodes || 0) === Number(v2.nodesTotal || 0))) return "met";
  return "needs_evidence";
}

function evaluationSummary(decision, snapshot = {}) {
  const v2 = snapshot.v2 || {};
  const counts = snapshot.counts || {};
  return [
    `v2 evaluation snapshot decision: ${decision}`,
    `workflow=${snapshot.workflowId || ""}`,
    `plan=${v2.planId || ""}`,
    `nodes=${v2.nodesTotal || 0}`,
    `workers=${v2.workersTotal || 0}`,
    `adapterJobs=${v2.adapterJobsTotal || 0}`,
    `evidence=${counts.evidenceTotal || 0}`,
    `pendingHumanGates=${counts.pendingHumanGates || 0}`,
    `sideEffectUncertain=${counts.sideEffectUncertain || 0}`,
    `activeIncidents=${counts.activeIncidents || 0}`
  ].join("; ");
}

function compatibilityStatus(parity = {}) {
  if (!parity.legacyObserved) return "needs_observation";
  if (parity.decisionMatched) return "matched";
  return "mismatch";
}

function addBlocker(blockers, code, decision, message, evidence = {}) {
  blockers.push({
    code,
    decision,
    message,
    evidence
  });
}

function evaluationBlockers(snapshot = {}) {
  const blockers = [];
  const counts = snapshot.counts || {};
  const v2 = snapshot.v2 || {};
  const verificationCounts = counts.verificationCounts || {};
  const workflowState = String(v2.workflowState || "");
  const planStatus = String(v2.planStatus || "");
  if (!v2.planFound) {
    addBlocker(blockers, "missing_v2_plan", "needs_evidence", "No v2 plan row was found for the requested workflow/plan scope.", { workflowId: snapshot.workflowId || "", planId: v2.planId || "" });
  }
  if (Number(counts.sideEffectUncertain || 0) > 0) {
    addBlocker(blockers, "side_effect_uncertain", "side_effect_uncertain", "Side-effect ledger contains uncertain or failed side effects.", { count: Number(counts.sideEffectUncertain || 0) });
  }
  if (workflowV2IsProtocolAuditState(workflowState) || ["human_gate_request_due", "waiting_human"].includes(workflowState)) {
    addBlocker(blockers, "workflow_state_requires_human_gate", "needs_human_gate", "Workflow state is waiting for Human Gate handling.", { workflowState });
  }
  if (Number(v2.workersByStatus?.needs_human_gate || 0) > 0) {
    addBlocker(blockers, "worker_needs_human_gate", "needs_human_gate", "At least one worker is waiting on Human Gate handling.", { count: Number(v2.workersByStatus.needs_human_gate || 0) });
  }
  if (Number(counts.pendingHumanGates || 0) > 0 || Number(verificationCounts.needs_human_gate || 0) > 0) {
    addBlocker(blockers, "pending_human_gate", "needs_human_gate", "Human Gate evidence is pending.", { pendingHumanGates: Number(counts.pendingHumanGates || 0), verifierNeedsHumanGate: Number(verificationCounts.needs_human_gate || 0) });
  }
  if (Number(counts.activeIncidents || 0) > 0) {
    addBlocker(blockers, "active_incident", "blocked", "Active incident state is linked to this workflow.", { count: Number(counts.activeIncidents || 0) });
  }
  if (Number(verificationCounts.blocked || 0) > 0 || ["blocked", "cancelled"].includes(planStatus) || ["blocked", "cancelled", "terminated"].includes(workflowState) || Number(v2.blockedPlans || 0) > 0 || Number(v2.blockedNodes || 0) > 0 || Number(v2.blockedWorkers || 0) > 0) {
    addBlocker(blockers, "blocked_execution_state", "blocked", "Plan, node, worker, or verification state is blocked/cancelled.", {
      planStatus,
      workflowState,
      blockedPlans: Number(v2.blockedPlans || 0),
      blockedNodes: Number(v2.blockedNodes || 0),
      blockedWorkers: Number(v2.blockedWorkers || 0),
      blockedVerification: Number(verificationCounts.blocked || 0)
    });
  }
  if (Number(v2.failedNodes || 0) > 0 || Number(v2.failedWorkers || 0) > 0 || Number(v2.failedAdapterJobs || 0) > 0 || Number(counts.failedDispatches || 0) > 0 || Number(counts.failedRuntimeRuns || 0) > 0) {
    addBlocker(blockers, "failed_runtime_or_dispatch", "not_met", "Dispatch, runtime, worker, adapter job, or node failure evidence is present.", {
      failedNodes: Number(v2.failedNodes || 0),
      failedWorkers: Number(v2.failedWorkers || 0),
      failedAdapterJobs: Number(v2.failedAdapterJobs || 0),
      failedDispatches: Number(counts.failedDispatches || 0),
      failedRuntimeRuns: Number(counts.failedRuntimeRuns || 0)
    });
  }
  const failedVerification = Number(verificationCounts.fail || 0) + Number(verificationCounts.not_met || 0) + Number(verificationCounts.disputed || 0);
  if (failedVerification > 0) {
    addBlocker(blockers, "failed_verification", "not_met", "Verifier/refuter/reducer evidence says acceptance is not met.", { count: failedVerification });
  }
  if (Number(v2.activeWorkers || 0) > 0 || Number(v2.activeAdapterJobs || 0) > 0 || Number(counts.activeDispatches || 0) > 0 || Number(counts.activeRuntimeRuns || 0) > 0 || Number(v2.reviewWorkers || 0) > 0) {
    addBlocker(blockers, "active_or_review_work_remaining", "needs_evidence", "Active dispatch/runtime/worker/review work remains.", {
      activeWorkers: Number(v2.activeWorkers || 0),
      activeAdapterJobs: Number(v2.activeAdapterJobs || 0),
      activeDispatches: Number(counts.activeDispatches || 0),
      activeRuntimeRuns: Number(counts.activeRuntimeRuns || 0),
      reviewWorkers: Number(v2.reviewWorkers || 0)
    });
  }
  if (Number(v2.nodesTotal || 0) > 0 && Number(v2.completedNodes || 0) < Number(v2.nodesTotal || 0)) {
    addBlocker(blockers, "incomplete_v2_nodes", "needs_evidence", "Not all v2 plan nodes are completed.", { completedNodes: Number(v2.completedNodes || 0), nodesTotal: Number(v2.nodesTotal || 0) });
  }
  const evidenceNeeds = Number(verificationCounts.needs_evidence || 0) + Number(verificationCounts.uncertain || 0);
  if (evidenceNeeds > 0) {
    addBlocker(blockers, "verification_needs_evidence", "needs_evidence", "Verification evidence is uncertain or still missing.", { count: evidenceNeeds });
  }
  if (Number(counts.artifactCount || 0) <= 0) {
    addBlocker(blockers, "missing_artifact_evidence", "needs_evidence", "No artifact evidence is recorded for the workflow.", {});
  }
  if (Number(counts.runtimeReceiptCount || 0) <= 0) {
    addBlocker(blockers, "missing_runtime_receipt", "needs_evidence", "No successful runtime receipt is recorded for the workflow.", {});
  }
  if (Number(counts.verificationTotal || 0) <= 0) {
    addBlocker(blockers, "missing_verification_evidence", "needs_evidence", "No non-evaluator verification evidence is recorded for the workflow.", {});
  }
  return blockers;
}

function boundedLimit(value, fallback = 20, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(numeric)));
}

const LEGACY_EVALUATOR_ENTRY_POINTS = Object.freeze([
  {
    action: "workflow.evaluate",
    kind: "canonical_legacy_writer",
    migrationStatus: "frozen_compatibility",
    mutating: true,
    replacement: "workflow.v2.evaluation_snapshot.preview + workflow.v2.evaluation.record + workflow.v2.evaluation_compatibility.preview"
  },
  {
    action: "workflow.evaluator.run",
    kind: "legacy_alias",
    migrationStatus: "frozen_compatibility",
    mutating: true,
    canonical: "workflow.evaluate",
    replacement: "workflow.v2.evaluation_snapshot.preview + workflow.v2.evaluation.record + workflow.v2.validate"
  },
  {
    action: "workflow.evaluation.run",
    kind: "legacy_alias",
    migrationStatus: "frozen_compatibility",
    mutating: true,
    canonical: "workflow.evaluate",
    replacement: "workflow.v2.evaluation_snapshot.preview + workflow.v2.evaluation.record + workflow.v2.validate"
  },
  {
    action: "workflow.goal.evaluate",
    kind: "legacy_alias",
    migrationStatus: "frozen_compatibility",
    mutating: true,
    canonical: "workflow.evaluate",
    replacement: "workflow.v2.evaluation_snapshot.preview + workflow.v2.evaluation.record + workflow.v2.validate"
  }
]);

const LEGACY_EVALUATOR_ACTIONS = Object.freeze(LEGACY_EVALUATOR_ENTRY_POINTS.map((entry) => entry.action));
const V2_EVALUATOR_READ_ACTIONS = Object.freeze([
  "workflow.v2.evaluation_snapshot.preview",
  "workflow.v2.evaluation.record",
  "workflow.v2.evaluation_compatibility.preview"
]);

function quotedList(values = []) {
  return values.map((value) => sqlValue(value)).join(", ");
}

function summarizeOperationRows(rows = []) {
  const byAction = {};
  const byActor = {};
  const byStatus = {};
  const latest = rows.map((row) => ({
    operationId: row.operation_id || "",
    action: row.action || "",
    requestedBy: redactSensitiveTextForPersistence(row.requested_by || ""),
    workflowId: row.workflow_id || "",
    status: row.status || "",
    dryRun: Boolean(Number(row.dry_run || 0)),
    inputHash: row.input_hash || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    completedAt: row.completed_at || ""
  }));
  for (const row of latest) {
    const action = row.action || "unknown";
    byAction[action] = (byAction[action] || 0) + 1;
    const actor = row.requestedBy || "unknown";
    byActor[actor] = (byActor[actor] || 0) + 1;
    const status = row.status || "unknown";
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  return {
    sampleCount: latest.length,
    byAction,
    byActor,
    byStatus,
    latest
  };
}

function v2EvaluationPayloadExpr(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `CASE WHEN json_valid(${prefix}payload_json) THEN ${prefix}payload_json ELSE '{}' END`;
}

async function findV2EvaluationRecordByIdempotency(paths, workflowId, planId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const payload = v2EvaluationPayloadExpr("v");
  const rows = await sqlite(paths.dbFile, `
SELECT verification_id, workflow_id, result_type, decision, phase_key, task_id, agent_run_id, payload_hash, created_at
FROM workflow_verification_results v
WHERE v.workflow_id=${sqlValue(workflowId)}
  AND v.result_type='evaluator'
  AND json_extract(${payload}, '$.operation')='workflow.v2.evaluation.record'
  AND COALESCE(json_extract(${payload}, '$.snapshot.v2.planId'), '')=${sqlValue(planId || "")}
  AND COALESCE(json_extract(${payload}, '$.idempotencyKey'), '')=${sqlValue(idempotencyKey)}
ORDER BY v.created_at DESC
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function findV2EvaluationClaim(paths, workflowId, planId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT workflow_id, plan_id, idempotency_key, verification_id, payload_hash, created_at
FROM workflow_v2_evaluation_record_idempotency
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId || "")}
  AND idempotency_key=${sqlValue(idempotencyKey)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function findV2EvaluationRecordByVerificationId(paths, verificationId) {
  if (!verificationId) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT verification_id, workflow_id, result_type, decision, phase_key, task_id, agent_run_id, payload_hash, created_at
FROM workflow_verification_results
WHERE verification_id=${sqlValue(verificationId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

function v2EvaluationClaimHash(input = {}) {
  return jsonHash({
    operation: "workflow.v2.evaluation.record",
    workflowId: input.workflowId || "",
    planId: input.planId || "",
    idempotencyKey: input.idempotencyKey || "",
    phaseId: firstText(input.phaseId, input.phase_id),
    phaseKey: input.phaseKey || "",
    taskId: firstText(input.taskId, input.task_id),
    agentRunId: firstText(input.agentRunId, input.agent_run_id),
    dispatchId: firstText(input.dispatchId, input.dispatch_id),
    runtimeRunId: firstText(input.runtimeRunId, input.runtime_run_id),
    sourceAgent: input.sourceAgent || "",
    sourceRuntime: input.sourceRuntime || "",
    confidence: input.confidence || "",
    riskBand: input.riskBand || "",
    summary: input.summary || "",
    findings: input.findings || [],
    recommendations: input.recommendations || [],
    evidenceRefs: input.evidenceRefs || [],
    artifactRefs: input.artifactRefs || [],
    receiptRefs: input.receiptRefs || [],
    explicitDecision: firstText(input.explicitDecision),
    explicitGeneratedAt: input.explicitGeneratedAt || ""
  });
}

function replayedEvaluationRecord(row, snapshotResult, planId, payloadHash, paths) {
  return {
    operation: "workflow.v2.evaluation.record",
    schemaVersion: "workflow_v2_evaluation_record_result.v1",
    status: "replayed",
    replayed: true,
    verificationId: row.verification_id,
    workflowId: row.workflow_id,
    planId: snapshotResult.snapshot?.v2?.planId || planId,
    resultType: row.result_type || "evaluator",
    decision: row.decision,
    payloadHash,
    createdAt: row.created_at || "",
    dbFile: paths.dbFile
  };
}

export function createWorkflowV2EvaluationActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateCount = requireContextFunction(context, "pendingHumanGateCount");
  const workflowPayloadSqlWhere = requireContextFunction(context, "workflowPayloadSqlWhere");
  const workflowPermissionCaller = requireContextFunction(context, "workflowPermissionCaller");
  const workflowV2Validate = requireContextFunction(context, "workflowV2Validate");

  async function workflowV2EvaluationSnapshotPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    if (!workflowId) throw new Error("workflowId is required");
    const planId = firstText(input.planId, input.plan_id);
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const tableNames = [
      "workflow_v2_plans",
      "workflow_v2_plan_nodes",
      "workflow_v2_worker_runs",
      "workflow_v2_worker_adapter_jobs",
      "workflow_v2_human_gate_packages",
      "artifact_index",
      "mixed_meeting_dispatches",
      "runtime_runs",
      "workflow_verification_results",
      "side_effect_ledger",
      "incident_states"
    ];
    const columns = {};
    await Promise.all(tableNames.map(async (tableName) => {
      columns[tableName] = await tableColumns(paths.dbFile, tableName);
    }));
    const missingSources = Object.entries(columns)
      .filter(([, columnSet]) => columnSet.size === 0)
      .map(([tableName]) => tableName);
    const planWhere = scopedWhere(workflowId, planId);
    const planRows = hasColumns(columns.workflow_v2_plans, ["workflow_id", "plan_id", "status", "workflow_state"]) ? await sqlite(paths.dbFile, `
SELECT plan_id, workflow_id, status, workflow_state, objective, updated_at
FROM workflow_v2_plans
WHERE ${planWhere}
ORDER BY updated_at DESC
LIMIT 1;`, { json: true }) : [];
    const plan = planRows[0] || null;
    const effectivePlanId = planId || plan?.plan_id || "";
    const planCount = hasColumns(columns.workflow_v2_plans, ["workflow_id"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(workflowId)};`, { json: true }))[0]?.count || 0) : 0;
    const requirePlanScope = Boolean(effectivePlanId && (!plan || Number(planCount || 0) > 1));
    const scoped = scopedWhere(workflowId, effectivePlanId);
    const nodeRows = effectivePlanId && hasColumns(columns.workflow_v2_plan_nodes, ["workflow_id", "plan_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_v2_plan_nodes
WHERE ${scoped}
GROUP BY status;`, { json: true }) : [];
    const workerRows = effectivePlanId && hasColumns(columns.workflow_v2_worker_runs, ["workflow_id", "plan_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_v2_worker_runs
WHERE ${scoped}
GROUP BY status;`, { json: true }) : [];
    const adapterJobRows = effectivePlanId && hasColumns(columns.workflow_v2_worker_adapter_jobs, ["workflow_id", "plan_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_v2_worker_adapter_jobs
WHERE ${scoped}
GROUP BY status;`, { json: true }) : [];
    const humanGatePackageRows = effectivePlanId && hasColumns(columns.workflow_v2_human_gate_packages, ["workflow_id", "plan_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_v2_human_gate_packages
WHERE ${scoped}
  AND status NOT IN ('sent','approved','rejected','expired','cancelled','completed')
GROUP BY status;`, { json: true }) : [];
    const dispatchRows = hasColumns(columns.mixed_meeting_dispatches, ["workflow_id", "status", "payload_json"]) ? await sqlite(paths.dbFile, `
SELECT d.status, COUNT(*) AS count
FROM mixed_meeting_dispatches d
WHERE ${scopedDispatchWhere(workflowId, effectivePlanId, planCount, "d", requirePlanScope)}
GROUP BY d.status;`, { json: true }) : [];
    const runtimeRows = hasColumns(columns.runtime_runs, ["workflow_id", "status", "payload_json"]) ? await sqlite(paths.dbFile, `
SELECT r.status, COUNT(*) AS count
FROM runtime_runs r
LEFT JOIN mixed_meeting_dispatches d ON d.dispatch_id=r.dispatch_id
WHERE ${scopedRuntimeDispatchWhere(workflowId, effectivePlanId, planCount, "r", "d", requirePlanScope)}
GROUP BY r.status;`, { json: true }) : [];
    const artifactKindFilter = hasColumns(columns.artifact_index, ["kind"])
      ? `AND kind NOT IN (${quotedList(NON_EVALUATOR_EVIDENCE_ARTIFACT_KINDS)})`
      : "";
    const artifactCount = hasColumns(columns.artifact_index, ["workflow_id"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)}
  ${artifactKindFilter};`, { json: true }))[0]?.count || 0) : 0;
    const runtimeReceiptCount = hasColumns(columns.runtime_runs, ["workflow_id", "status", "payload_json"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM runtime_runs r
LEFT JOIN mixed_meeting_dispatches d ON d.dispatch_id=r.dispatch_id
WHERE ${scopedRuntimeDispatchWhere(workflowId, effectivePlanId, planCount, "r", "d", requirePlanScope)}
  AND r.status IN ('acked','completed','success');`, { json: true }))[0]?.count || 0) : 0;
    const verificationPlanScope = [];
    if (effectivePlanId && requirePlanScope) {
      if (columns.workflow_verification_results.has("phase_key")) verificationPlanScope.push(`v.phase_key=${sqlValue(effectivePlanId)}`);
      if (columns.workflow_verification_results.has("payload_json")) verificationPlanScope.push(payloadPlanWhere(effectivePlanId, "v"));
    }
    const verificationScopeWhere = [
      `v.workflow_id=${sqlValue(workflowId)}`,
      "v.result_type != 'evaluator'"
    ];
    if (effectivePlanId && requirePlanScope) {
      verificationScopeWhere.push(verificationPlanScope.length ? `(${verificationPlanScope.join(" OR ")})` : "0=1");
    }
    const verificationRows = hasColumns(columns.workflow_verification_results, ["workflow_id", "result_type", "decision"]) ? await sqlite(paths.dbFile, `
SELECT decision AS status, COUNT(*) AS count
FROM workflow_verification_results v
WHERE ${verificationScopeWhere.join(" AND ")}
GROUP BY decision;`, { json: true }) : [];
    const sideEffectUncertain = hasColumns(columns.side_effect_ledger, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed');`, { json: true }))[0]?.count || 0) : 0;
    const activeIncidents = hasColumns(columns.incident_states, ["status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM incident_states
WHERE status IN ('active','mitigating','monitoring')
  AND ${workflowPayloadSqlWhere(workflowId, { parentColumn: "" })};`, { json: true }))[0]?.count || 0) : 0;
    const pendingHumanGates = await pendingHumanGateCount(paths, workflowId);
    const nodeCounts = countByStatus(nodeRows);
    const workerCounts = countByStatus(workerRows);
    const adapterJobCounts = countByStatus(adapterJobRows);
    const humanGatePackageCounts = countByStatus(humanGatePackageRows);
    const dispatchCounts = countByStatus(dispatchRows);
    const runtimeCounts = countByStatus(runtimeRows);
    const validation = await workflowV2Validate(rootDir, { ...input, workflowId, planId: effectivePlanId });
    const snapshot = {
      evaluatorVersion: "workflow_v2_evaluation_snapshot_v1",
      workflowId,
      generatedAt,
      v2: {
        planFound: Boolean(plan),
        planId: effectivePlanId,
        planCount,
        planScopeRequired: requirePlanScope,
        planStatus: plan?.status || "",
        workflowState: plan?.workflow_state || "",
        blockedPlans: plan && (["blocked", "cancelled"].includes(plan.status || "") || ["blocked", "cancelled", "terminated"].includes(plan.workflow_state || "")) ? 1 : 0,
        objective: redactSensitiveTextForPersistence(plan?.objective || ""),
        nodesByStatus: nodeCounts,
        nodesTotal: countRows(nodeRows),
        completedNodes: Number(nodeCounts.completed || 0),
        blockedNodes: Number(nodeCounts.blocked || 0),
        failedNodes: Number(nodeCounts.failed || 0) + Number(nodeCounts.cancelled || 0),
        workersByStatus: workerCounts,
        workersTotal: countRows(workerRows),
        activeWorkers: Number(workerCounts.queued || 0) + Number(workerCounts.retry_scheduled || 0) + Number(workerCounts.running || 0),
        reviewWorkers: Number(workerCounts.submitted_for_review || 0) + Number(workerCounts.revise_required || 0) + Number(workerCounts.handoff_required || 0),
        blockedWorkers: Number(workerCounts.blocked || 0),
        failedWorkers: Number(workerCounts.failed || 0) + Number(workerCounts.timed_out || 0) + Number(workerCounts.cancelled || 0) + Number(workerCounts.rejected || 0),
        adapterJobsByStatus: adapterJobCounts,
        adapterJobsTotal: countRows(adapterJobRows),
        activeAdapterJobs: Number(adapterJobCounts.queued || 0) + Number(adapterJobCounts.retry_scheduled || 0) + Number(adapterJobCounts.running || 0),
        failedAdapterJobs: Number(adapterJobCounts.failed || 0) + Number(adapterJobCounts.cancelled || 0),
        humanGatePackagesByStatus: humanGatePackageCounts,
        humanGatePackagesTotal: countRows(humanGatePackageRows)
      },
      counts: {
        artifactCount,
        runtimeReceiptCount,
        dispatchCounts,
        dispatchTotal: countRows(dispatchRows),
        failedDispatches: Number(dispatchCounts.failed || 0) + Number(dispatchCounts.cancelled || 0) + Number(dispatchCounts.error || 0),
        activeDispatches: Number(dispatchCounts.queued || 0) + Number(dispatchCounts.sent || 0) + Number(dispatchCounts.dispatched || 0) + Number(dispatchCounts.running || 0) + Number(dispatchCounts.retry_scheduled || 0),
        runtimeCounts,
        runtimeTotal: countRows(runtimeRows),
        failedRuntimeRuns: Number(runtimeCounts.failed || 0) + Number(runtimeCounts.cancelled || 0) + Number(runtimeCounts.error || 0),
        activeRuntimeRuns: Number(runtimeCounts.queued || 0) + Number(runtimeCounts.dispatched || 0) + Number(runtimeCounts.running || 0) + Number(runtimeCounts.acked || 0),
        verificationCounts: countByStatus(verificationRows),
        verificationTotal: countRows(verificationRows),
        pendingHumanGates,
        sideEffectUncertain,
        activeIncidents,
        evidenceTotal: artifactCount + runtimeReceiptCount + countRows(verificationRows)
      },
      validation: {
        status: validation.status || "",
        ok: Boolean(validation.ok),
        failedChecks: validation.failedChecks || [],
        failedChecksCount: (validation.failedChecks || []).length,
        advisoryFindings: validation.advisoryFindings || [],
        missingSchema: validation.missingSchema || []
      },
      missingSources
    };
    const decision = evaluationDecision(snapshot);
    const blockers = evaluationBlockers(snapshot);
    return {
      operation: "workflow.v2.evaluation_snapshot.preview",
      schemaVersion: "workflow_v2_evaluation_snapshot.v1",
      dryRun: true,
      previewOnly: true,
      writeMode: "read_only_snapshot",
      sourceClass: "v2",
      sourceClassLabel: "v2 active",
      status: decision === "met" ? "pass" : decision,
      ok: ["met", "needs_evidence", "needs_human_gate"].includes(decision),
      decision,
      summary: evaluationSummary(decision, snapshot),
      blockers,
      blockerCodes: blockers.map((blocker) => blocker.code),
      recommendations: decision === "met"
        ? ["Prepare Cat Claw secretary audit and Human Gate closeout evidence before continuation."]
        : ["Resolve blockers or collect missing v2 evidence before treating evaluation as met."],
      snapshot,
      dbFile: paths.dbFile
    };
  }

  async function workflowV2EvaluationRecord(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    if (!workflowId) throw new Error("workflowId is required");
    const planId = firstText(input.planId, input.plan_id);
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const snapshotResult = await workflowV2EvaluationSnapshotPreview(rootDir, {
      ...input,
      workflowId,
      planId,
      generatedAt
    });
    const idempotencyKey = firstText(input.idempotencyKey, input.idempotency_key);
    const explicitVerificationId = firstText(input.verificationId, input.verification_id);
    if (!explicitVerificationId && !idempotencyKey) {
      throw new Error("workflow.v2.evaluation.record requires verificationId or idempotencyKey for deterministic replay");
    }
    const verificationId = explicitVerificationId || `evaluation.v2.${jsonHash({ workflowId, planId: snapshotResult.snapshot?.v2?.planId || planId, idempotencyKey }).slice(0, 24)}`;
    const caller = permissionDecision?.caller || workflowPermissionCaller(input);
    const callerAgent = String(caller.agentId || "").trim();
    const callerRuntime = String(caller.runtime || "").trim();
    const sourceAgent = firstText(input.sourceAgent, input.source_agent, input.evaluatorAgent, input.evaluator_agent, callerAgent, "unknown");
    const sourceRuntime = firstText(input.sourceRuntime, input.source_runtime, input.runtime, callerRuntime);
    const decision = snapshotResult.decision;
    const confidence = firstText(input.confidence, decision === "met" ? "medium" : "low");
    const riskBand = firstText(input.riskBand, input.risk_band, ["met", "needs_evidence"].includes(decision) ? "medium" : "high");
    const summary = redactSensitiveTextForPersistence(input.summary || snapshotResult.summary || "");
    const findings = Array.isArray(input.findings)
      ? input.findings.map((item) => redactSensitiveTextForPersistence(item))
      : snapshotResult.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`);
    const recommendations = Array.isArray(input.recommendations)
      ? input.recommendations.map((item) => redactSensitiveTextForPersistence(item))
      : snapshotResult.recommendations;
    const evidenceRefs = Array.isArray(input.evidenceRefs || input.evidence_refs)
      ? (input.evidenceRefs || input.evidence_refs).map((item) => redactSensitiveTextForPersistence(item))
      : [];
    const artifactRefs = Array.isArray(input.artifactRefs || input.artifact_refs)
      ? (input.artifactRefs || input.artifact_refs).map((item) => redactSensitiveTextForPersistence(item))
      : [];
    const receiptRefs = Array.isArray(input.receiptRefs || input.receipt_refs)
      ? (input.receiptRefs || input.receipt_refs).map((item) => redactSensitiveTextForPersistence(item))
      : [];
    const payload = {
      evaluator: "workflow_v2_evaluator_v1",
      operation: "workflow.v2.evaluation.record",
      idempotencyKey,
      snapshot: snapshotResult.snapshot,
      decision,
      blockers: snapshotResult.blockers,
      blockerCodes: snapshotResult.blockerCodes,
      previewSummary: snapshotResult.summary,
      generatedAt
    };
    const payloadHash = jsonHash(payload);
    const createdAt = firstText(input.createdAt, input.created_at, generatedAt);
    const phaseKey = firstText(input.phaseKey, input.phase_key, input.phase, snapshotResult.snapshot?.v2?.planId, planId);
    const effectivePlanId = snapshotResult.snapshot?.v2?.planId || planId;
    const claimHash = v2EvaluationClaimHash({
      workflowId,
      planId: effectivePlanId,
      idempotencyKey,
      phaseId: firstText(input.phaseId, input.phase_id),
      phaseKey,
      taskId: firstText(input.taskId, input.task_id),
      agentRunId: firstText(input.agentRunId, input.agent_run_id),
      dispatchId: firstText(input.dispatchId, input.dispatch_id),
      runtimeRunId: firstText(input.runtimeRunId, input.runtime_run_id),
      sourceAgent: firstText(input.sourceAgent, input.source_agent, input.evaluatorAgent, input.evaluator_agent),
      sourceRuntime: firstText(input.sourceRuntime, input.source_runtime, input.runtime),
      confidence: firstText(input.confidence),
      riskBand: firstText(input.riskBand, input.risk_band),
      summary: firstText(input.summary),
      findings: Array.isArray(input.findings) ? input.findings : [],
      recommendations: Array.isArray(input.recommendations) ? input.recommendations : [],
      evidenceRefs: Array.isArray(input.evidenceRefs || input.evidence_refs) ? (input.evidenceRefs || input.evidence_refs) : [],
      artifactRefs: Array.isArray(input.artifactRefs || input.artifact_refs) ? (input.artifactRefs || input.artifact_refs) : [],
      receiptRefs: Array.isArray(input.receiptRefs || input.receipt_refs) ? (input.receiptRefs || input.receipt_refs) : [],
      explicitDecision: firstText(input.decision),
      explicitGeneratedAt: firstText(input.generatedAt, input.generated_at, input.now)
    });
    const existingClaim = await findV2EvaluationClaim(paths, workflowId, effectivePlanId, idempotencyKey);
    if (existingClaim) {
      if (existingClaim.payload_hash !== claimHash) {
        throw new Error(`workflow v2 evaluation record idempotency conflict: ${idempotencyKey}`);
      }
      const row = await findV2EvaluationRecordByVerificationId(paths, existingClaim.verification_id);
      if (!row) throw new Error(`workflow v2 evaluation record idempotency claim target missing: ${existingClaim.verification_id}`);
      return replayedEvaluationRecord(row, snapshotResult, planId, row.payload_hash || payloadHash, paths);
    }
    const existingByKey = await findV2EvaluationRecordByIdempotency(paths, workflowId, effectivePlanId, idempotencyKey);
    if (existingByKey) {
      if (firstText(input.generatedAt, input.generated_at, input.now) && existingByKey.payload_hash !== payloadHash) {
        throw new Error(`workflow v2 evaluation record idempotency conflict: ${idempotencyKey}`);
      }
      return replayedEvaluationRecord(existingByKey, snapshotResult, planId, existingByKey.payload_hash || payloadHash, paths);
    }
    const existingById = await findV2EvaluationRecordByVerificationId(paths, verificationId);
    if (existingById) {
      if (existingById.payload_hash !== payloadHash) {
        throw new Error(`workflow v2 evaluation record idempotency conflict: ${verificationId}`);
      }
      return replayedEvaluationRecord(existingById, snapshotResult, planId, payloadHash, paths);
    }
    try {
      await sqliteTransaction(paths.dbFile, `
${idempotencyKey ? `INSERT INTO workflow_v2_evaluation_record_idempotency(workflow_id, plan_id, idempotency_key, verification_id, payload_hash, created_at)
VALUES (${sqlValue(workflowId)}, ${sqlValue(effectivePlanId)}, ${sqlValue(idempotencyKey)}, ${sqlValue(verificationId)}, ${sqlValue(claimHash)}, ${sqlValue(createdAt)});` : ""}
INSERT INTO workflow_verification_results(verification_id, workflow_id, phase_id, phase_key, task_id, agent_run_id, dispatch_id, runtime_run_id, result_type, decision, verifier_agent, refuter_agent, source_runtime, source_agent, confidence, risk_band, summary, findings_json, recommendations_json, evidence_refs_json, artifact_refs_json, receipt_refs_json, payload_hash, payload_json, created_by, created_at)
VALUES (${sqlValue(verificationId)}, ${sqlValue(workflowId)}, ${sqlValue(firstText(input.phaseId, input.phase_id))}, ${sqlValue(phaseKey)}, ${sqlValue(firstText(input.taskId, input.task_id))}, ${sqlValue(firstText(input.agentRunId, input.agent_run_id))}, ${sqlValue(firstText(input.dispatchId, input.dispatch_id))}, ${sqlValue(firstText(input.runtimeRunId, input.runtime_run_id))}, 'evaluator', ${sqlValue(decision)}, '', '', ${sqlValue(sourceRuntime)}, ${sqlValue(sourceAgent)}, ${sqlValue(confidence)}, ${sqlValue(riskBand)}, ${sqlValue(summary)}, ${sqlValue(JSON.stringify(findings))}, ${sqlValue(JSON.stringify(recommendations))}, ${sqlValue(JSON.stringify(evidenceRefs))}, ${sqlValue(JSON.stringify(artifactRefs))}, ${sqlValue(JSON.stringify(receiptRefs))}, ${sqlValue(payloadHash)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(callerAgent || firstText(input.createdBy, input.created_by, input.actor, sourceAgent, "unknown"))}, ${sqlValue(createdAt)});
`);
    } catch (error) {
      if (idempotencyKey && isSqliteConstraintError(error)) {
        const claim = await findV2EvaluationClaim(paths, workflowId, effectivePlanId, idempotencyKey);
        if (claim && claim.payload_hash === claimHash) {
          const row = await findV2EvaluationRecordByVerificationId(paths, claim.verification_id);
          if (row) return replayedEvaluationRecord(row, snapshotResult, planId, row.payload_hash || payloadHash, paths);
        }
        throw new Error(`workflow v2 evaluation record idempotency conflict: ${idempotencyKey}`);
      }
      if (isSqliteConstraintError(error)) {
        const row = await findV2EvaluationRecordByVerificationId(paths, verificationId);
        if (row && row.payload_hash === payloadHash) {
          return replayedEvaluationRecord(row, snapshotResult, planId, payloadHash, paths);
        }
        throw new Error(`workflow v2 evaluation record idempotency conflict: ${verificationId}`);
      }
      throw error;
    }
    const persisted = await sqlite(paths.dbFile, `
SELECT verification_id, workflow_id, result_type, decision, phase_key, task_id, agent_run_id, payload_hash, created_at
FROM workflow_verification_results
WHERE verification_id=${sqlValue(verificationId)}
LIMIT 1;`, { json: true });
    if (!persisted[0]) throw new Error(`workflow v2 evaluation record failed to persist: ${verificationId}`);
    if (persisted[0].payload_hash !== payloadHash) {
      throw new Error(`workflow v2 evaluation record idempotency conflict: ${verificationId}`);
    }
    return {
      operation: "workflow.v2.evaluation.record",
      schemaVersion: "workflow_v2_evaluation_record_result.v1",
      status: "recorded",
      replayed: false,
      verificationId,
      workflowId,
      planId: snapshotResult.snapshot?.v2?.planId || planId,
      resultType: "evaluator",
      decision,
      payloadHash,
      createdAt,
      blockerCodes: snapshotResult.blockerCodes,
      dbFile: paths.dbFile
    };
  }

  async function workflowV2EvaluationCompatibilityPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    if (!workflowId) throw new Error("workflowId is required");
    const phaseKey = firstText(input.phaseKey, input.phase_key, input.phase);
    if (phaseKey) throw new Error("phaseKey is not supported for workflow.v2.evaluation_compatibility.preview until v2 phase/node scoped evaluation is implemented");
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const verificationColumns = await tableColumns(paths.dbFile, "workflow_verification_results");
    const filters = [`workflow_id=${sqlValue(workflowId)}`, "result_type='evaluator'"];
    if (phaseKey) filters.push(`phase_key=${sqlValue(phaseKey)}`);
    const where = filters.join(" AND ");
    const legacyRows = hasColumns(verificationColumns, ["workflow_id", "result_type", "decision", "created_at"]) ? await sqlite(paths.dbFile, `
SELECT verification_id, phase_key, decision, created_at, payload_hash
FROM workflow_verification_results
WHERE ${where}
ORDER BY created_at DESC
LIMIT 20;`, { json: true }) : [];
    const legacyDecisionRows = hasColumns(verificationColumns, ["workflow_id", "result_type", "decision"]) ? await sqlite(paths.dbFile, `
SELECT decision AS status, COUNT(*) AS count
FROM workflow_verification_results
WHERE ${where}
GROUP BY decision;`, { json: true }) : [];
    const v2Snapshot = await workflowV2EvaluationSnapshotPreview(rootDir, {
      ...input,
      workflowId,
      phaseKey,
      generatedAt
    });
    const legacyDecisionCounts = countByStatus(legacyDecisionRows);
    const latestLegacy = legacyRows[0] || null;
    const latestLegacyDecision = latestLegacy?.decision || "";
    const decisionMatched = Boolean(latestLegacyDecision) && latestLegacyDecision === v2Snapshot.decision;
    const legacyProblemDecisions = sumCounts(legacyDecisionCounts, ["fail", "not_met", "disputed", "blocked", "side_effect_uncertain"]);
    const status = compatibilityStatus({
      legacyObserved: Boolean(latestLegacy),
      decisionMatched
    });
    const freezeReviewCandidate = status === "matched"
      && v2Snapshot.snapshot?.v2?.planFound === true
      && legacyProblemDecisions === 0
      && !["needs_evidence", "needs_human_gate"].includes(v2Snapshot.decision);
    const freezeReadinessBlockers = [];
    if (!freezeReviewCandidate) freezeReadinessBlockers.push("parity_not_ready");
    freezeReadinessBlockers.push("caller_migration_not_proven");
    freezeReadinessBlockers.push("release_smoke_observation_missing");
    return {
      operation: "workflow.v2.evaluation_compatibility.preview",
      schemaVersion: "workflow_v2_evaluation_compatibility_preview.v1",
      dryRun: true,
      previewOnly: true,
      writeMode: "read_only_compatibility_audit",
      sourceClass: "v2",
      legacyAction: "workflow.evaluate",
      replacementAction: "workflow.v2.evaluation_snapshot.preview + workflow.v2.evaluation.record + workflow.v2.validate",
      workflowId,
      phaseKey,
      generatedAt,
      status,
      ok: status !== "mismatch",
      freezeCandidate: false,
      freezeReviewCandidate,
      freezeReadiness: {
        status: "not_ready",
        blockers: freezeReadinessBlockers
      },
      parity: {
        legacyObserved: Boolean(latestLegacy),
        latestLegacyDecision,
        v2Decision: v2Snapshot.decision,
        decisionMatched,
        legacyEvaluatorRows: legacyRows.length,
        legacyDecisionCounts,
        latestLegacy: latestLegacy ? {
          verificationId: latestLegacy.verification_id,
          phaseKey: latestLegacy.phase_key || "",
          decision: latestLegacy.decision || "",
          createdAt: latestLegacy.created_at || "",
          payloadHash: latestLegacy.payload_hash || ""
        } : null
      },
      v2: {
        decision: v2Snapshot.decision,
        status: v2Snapshot.status,
        planFound: Boolean(v2Snapshot.snapshot?.v2?.planFound),
        planId: v2Snapshot.snapshot?.v2?.planId || "",
        evidenceTotal: Number(v2Snapshot.snapshot?.counts?.evidenceTotal || 0),
        pendingHumanGates: Number(v2Snapshot.snapshot?.counts?.pendingHumanGates || 0),
        sideEffectUncertain: Number(v2Snapshot.snapshot?.counts?.sideEffectUncertain || 0),
        activeIncidents: Number(v2Snapshot.snapshot?.counts?.activeIncidents || 0),
        validationStatus: v2Snapshot.snapshot?.validation?.status || ""
      },
      recommendations: freezeReviewCandidate
        ? ["Treat workflow.evaluate as a freeze candidate only after caller migration and release-smoke observation are recorded."]
        : status === "mismatch"
          ? ["Do not freeze workflow.evaluate; explain the legacy/v2 evaluator decision delta first."]
          : ["Continue the compatibility observation window before freezing workflow.evaluate."],
      dbFile: paths.dbFile
    };
  }

  async function workflowV2EvaluationMigrationPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const limit = boundedLimit(input.limit, 20, 100);
    const verificationColumns = await tableColumns(paths.dbFile, "workflow_verification_results");
    const operationColumns = await tableColumns(paths.dbFile, "workflow_operations");
    const hasEvaluatorObservation = hasColumns(verificationColumns, ["workflow_id", "result_type", "decision", "source_agent", "source_runtime", "created_by", "created_at"]);
    const hasOperationObservation = hasColumns(operationColumns, ["action", "workflow_id", "requested_by", "status", "dry_run", "input_hash", "created_at", "updated_at", "completed_at"]);
    const filters = ["result_type='evaluator'"];
    if (workflowId) filters.push(`workflow_id=${sqlValue(workflowId)}`);
    const where = filters.join(" AND ");
    const operationFilters = [];
    if (workflowId) operationFilters.push(`workflow_id=${sqlValue(workflowId)}`);
    const operationScopeWhere = operationFilters.length ? `AND ${operationFilters.join(" AND ")}` : "";
    const totalRows = hasEvaluatorObservation ? await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_verification_results
WHERE ${where};`, { json: true }) : [];
    const decisionRows = hasEvaluatorObservation ? await sqlite(paths.dbFile, `
SELECT decision AS status, COUNT(*) AS count
FROM workflow_verification_results
WHERE ${where}
GROUP BY decision;`, { json: true }) : [];
    const sourceRows = hasEvaluatorObservation ? await sqlite(paths.dbFile, `
SELECT COALESCE(NULLIF(source_agent, ''), NULLIF(created_by, ''), 'unknown') AS source_agent,
       COALESCE(NULLIF(source_runtime, ''), 'unknown') AS source_runtime,
       COUNT(*) AS count,
       MAX(created_at) AS last_observed_at
FROM workflow_verification_results
WHERE ${where}
GROUP BY COALESCE(NULLIF(source_agent, ''), NULLIF(created_by, ''), 'unknown'), COALESCE(NULLIF(source_runtime, ''), 'unknown')
ORDER BY count DESC, last_observed_at DESC
LIMIT ${limit};`, { json: true }) : [];
    const latestRows = hasEvaluatorObservation ? await sqlite(paths.dbFile, `
SELECT verification_id, workflow_id, phase_key, decision, source_agent, source_runtime, created_by, created_at, payload_hash
FROM workflow_verification_results
WHERE ${where}
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true }) : [];
    const legacyOperationRows = hasOperationObservation ? await sqlite(paths.dbFile, `
SELECT operation_id, action, workflow_id, requested_by, status, dry_run, input_hash, created_at, updated_at, completed_at
FROM workflow_operations
WHERE action IN (${quotedList(LEGACY_EVALUATOR_ACTIONS)})
${operationScopeWhere}
ORDER BY updated_at DESC, created_at DESC
LIMIT ${limit};`, { json: true }) : [];
    const v2OperationRows = hasOperationObservation ? await sqlite(paths.dbFile, `
SELECT operation_id, action, workflow_id, requested_by, status, dry_run, input_hash, created_at, updated_at, completed_at
FROM workflow_operations
WHERE action IN (${quotedList(V2_EVALUATOR_READ_ACTIONS)})
${operationScopeWhere}
ORDER BY updated_at DESC, created_at DESC
LIMIT ${limit};`, { json: true }) : [];
    const evaluatorRowsTotal = Number(totalRows[0]?.count || 0);
    const completedV2OperationRows = v2OperationRows.filter((row) => String(row.status || "") === "completed");
    const callerOperationEvidence = {
      hasOperationObservation,
      legacy: summarizeOperationRows(legacyOperationRows),
      v2: summarizeOperationRows(v2OperationRows),
      proofEligibleV2SampleCount: completedV2OperationRows.length,
      callerMigrationProof: hasOperationObservation && legacyOperationRows.length === 0 && completedV2OperationRows.length > 0,
      limitations: [
        "workflow_operations only proves calls that passed through the console/action gateway audit surface",
        "absence of legacy rows in this table is not proof that no internal direct registry caller exists",
        "operation row summaries are limited samples ordered by updated_at and created_at"
      ]
    };
    const blockers = [
      "legacy_writer_still_registered",
      "compatibility_observation_window_open",
      "release_smoke_observation_missing"
    ];
    if (!callerOperationEvidence.callerMigrationProof) blockers.push("caller_migration_not_proven");
    if (!hasEvaluatorObservation) blockers.push("legacy_observation_table_missing");
    if (!hasOperationObservation) blockers.push("caller_operation_audit_missing");
    if (evaluatorRowsTotal > 0) blockers.push("legacy_evaluator_rows_observed");
    return {
      operation: "workflow.v2.evaluation_migration.preview",
      schemaVersion: "workflow_v2_evaluation_migration_preview.v1",
      dryRun: true,
      previewOnly: true,
      writeMode: "read_only_migration_inventory",
      sourceClass: "v2",
      workflowId,
      generatedAt,
      status: "not_ready",
      ok: true,
      freezeCandidate: false,
      legacyEntryPoints: LEGACY_EVALUATOR_ENTRY_POINTS,
      replacementEntryPoints: [
        {
          action: "workflow.v2.evaluation_snapshot.preview",
          kind: "read_only_decision_snapshot",
          mutating: false
        },
        {
          action: "workflow.v2.evaluation.record",
          kind: "durable_evaluator_evidence_writer",
          mutating: true
        },
        {
          action: "workflow.v2.evaluation_compatibility.preview",
          kind: "read_only_legacy_v2_parity_audit",
          mutating: false
        }
      ],
      toolSurface: {
        internalRegistryRetainsLegacyEvaluate: true,
        legacyEvaluateDefaultFrozen: true,
        fullToolExposesLegacyEvaluate: false,
        fullToolHasV2EvaluationRecord: true,
        fullToolHasV2EvaluationPreviews: true,
        governanceToolExposesLegacyEvaluate: false,
        governanceToolHasV2EvaluationRecord: true,
        governanceToolHasV2EvaluationPreviews: true
      },
      observations: {
        hasEvaluatorObservation,
        evaluatorRowsTotal,
        decisionCounts: countByStatus(decisionRows),
        callerMigrationProof: callerOperationEvidence.callerMigrationProof,
        attributionLimitations: [
          "workflow_verification_results stores evaluator/source attribution, not a complete external caller inventory",
          "caller migration requires separate tool-schema/client usage evidence"
        ],
        sourceAttributionGroups: sourceRows.map((row) => ({
          sourceAgent: row.source_agent || "unknown",
          sourceRuntime: row.source_runtime || "unknown",
          count: Number(row.count || 0),
          lastObservedAt: row.last_observed_at || ""
        })),
        latestEvaluatorRows: latestRows.map((row) => ({
          verificationId: row.verification_id || "",
          workflowId: row.workflow_id || "",
          phaseKey: row.phase_key || "",
          decision: row.decision || "",
          sourceAgent: row.source_agent || "",
          sourceRuntime: row.source_runtime || "",
          createdBy: row.created_by || "",
          createdAt: row.created_at || "",
          payloadHash: row.payload_hash || ""
        }))
      },
      callerOperationEvidence,
      freezeReadiness: {
        status: "not_ready",
        blockers
      },
      migrationChecklist: [
        "Retarget new read-only evaluator decisions to workflow.v2.evaluation_snapshot.preview.",
        "Record durable v2 evaluator evidence with workflow.v2.evaluation.record.",
        "Use workflow.v2.evaluation_compatibility.preview only for parity observation against existing legacy evaluator rows.",
        "Do not freeze workflow.evaluate until caller migration evidence and release-smoke observation are recorded.",
        "Keep workflow.evaluate as a default-frozen compatibility writer only during the explicit evidence window."
      ],
      dbFile: paths.dbFile
    };
  }

  return {
    workflowV2EvaluationSnapshotPreview,
    workflowV2EvaluationRecord,
    workflowV2EvaluationCompatibilityPreview,
    workflowV2EvaluationMigrationPreview
  };
}
