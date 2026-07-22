import {
  firstText,
  redactSensitiveTextForPersistence
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
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
  if (failedVerification > 0) return "not_met";
  if (Number(v2.activeWorkers || 0) > 0 || Number(v2.activeAdapterJobs || 0) > 0) return "needs_evidence";
  if (Number(v2.reviewWorkers || 0) > 0) return "needs_evidence";
  if (Number(v2.nodesTotal || 0) > 0 && Number(v2.completedNodes || 0) < Number(v2.nodesTotal || 0)) return "needs_evidence";
  if (evidenceNeeds > 0) return "needs_evidence";
  if (Number(counts.evidenceTotal || 0) <= 0) return "needs_evidence";
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

function boundedLimit(value, fallback = 20, max = 100) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(numeric)));
}

const LEGACY_EVALUATOR_ENTRY_POINTS = Object.freeze([
  {
    action: "workflow.evaluate",
    kind: "canonical_legacy_writer",
    migrationStatus: "legacy_active",
    mutating: true,
    replacement: "workflow.v2.evaluation_snapshot.preview + workflow.v2.evaluation_compatibility.preview"
  },
  {
    action: "workflow.evaluator.run",
    kind: "legacy_alias",
    migrationStatus: "legacy_active",
    mutating: true,
    canonical: "workflow.evaluate",
    replacement: "workflow.v2.evaluation_snapshot.preview"
  },
  {
    action: "workflow.evaluation.run",
    kind: "legacy_alias",
    migrationStatus: "legacy_active",
    mutating: true,
    canonical: "workflow.evaluate",
    replacement: "workflow.v2.evaluation_snapshot.preview"
  },
  {
    action: "workflow.goal.evaluate",
    kind: "legacy_alias",
    migrationStatus: "legacy_active",
    mutating: true,
    canonical: "workflow.evaluate",
    replacement: "workflow.v2.evaluation_snapshot.preview"
  }
]);

const LEGACY_EVALUATOR_ACTIONS = Object.freeze(LEGACY_EVALUATOR_ENTRY_POINTS.map((entry) => entry.action));
const V2_EVALUATOR_READ_ACTIONS = Object.freeze([
  "workflow.v2.evaluation_snapshot.preview",
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

export function createWorkflowV2EvaluationActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateCount = requireContextFunction(context, "pendingHumanGateCount");
  const workflowPayloadSqlWhere = requireContextFunction(context, "workflowPayloadSqlWhere");
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
    const artifactCount = hasColumns(columns.artifact_index, ["workflow_id"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)};`, { json: true }))[0]?.count || 0) : 0;
    const runtimeReceiptCount = hasColumns(columns.runtime_runs, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM runtime_runs
WHERE workflow_id=${sqlValue(workflowId)}
  AND status IN ('acked','completed','success');`, { json: true }))[0]?.count || 0) : 0;
    const verificationRows = hasColumns(columns.workflow_verification_results, ["workflow_id", "result_type", "decision"]) ? await sqlite(paths.dbFile, `
SELECT decision AS status, COUNT(*) AS count
FROM workflow_verification_results
WHERE workflow_id=${sqlValue(workflowId)}
  AND result_type != 'evaluator'
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
    const validation = await workflowV2Validate(rootDir, { ...input, workflowId, planId: effectivePlanId });
    const snapshot = {
      evaluatorVersion: "workflow_v2_evaluation_snapshot_v1",
      workflowId,
      generatedAt,
      v2: {
        planFound: Boolean(plan),
        planId: effectivePlanId,
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
      recommendations: decision === "met"
        ? ["Prepare Cat Claw secretary audit and Human Gate closeout evidence before continuation."]
        : ["Resolve blockers or collect missing v2 evidence before treating evaluation as met."],
      snapshot,
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
      replacementAction: "workflow.v2.evaluation_snapshot.preview",
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
          action: "workflow.v2.evaluation_compatibility.preview",
          kind: "read_only_legacy_v2_parity_audit",
          mutating: false
        }
      ],
      toolSurface: {
        internalRegistryRetainsLegacyEvaluate: true,
        fullToolExposesLegacyEvaluate: false,
        fullToolHasV2EvaluationPreviews: true,
        governanceToolExposesLegacyEvaluate: false,
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
        "Use workflow.v2.evaluation_compatibility.preview only for parity observation against existing legacy evaluator rows.",
        "Do not freeze workflow.evaluate until caller migration evidence and release-smoke observation are recorded.",
        "Keep workflow.evaluate as a compatibility writer only during the explicit evidence window."
      ],
      dbFile: paths.dbFile
    };
  }

  return {
    workflowV2EvaluationSnapshotPreview,
    workflowV2EvaluationCompatibilityPreview,
    workflowV2EvaluationMigrationPreview
  };
}
