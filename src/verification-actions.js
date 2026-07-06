import {
  jsonHash,
  parseJsonValue,
  redactSensitiveForPersistence,
  redactSensitiveTextForPersistence,
  safeId,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite,
  tableColumns
} from "./workflow/sqlite.js";

export const VERIFICATION_ACTION_HANDLER_NAMES = {
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

const WORKFLOW_VERIFICATION_RESULT_TYPES = new Set(["verifier", "refuter", "reducer", "secretary_audit", "evaluator"]);
const WORKFLOW_VERIFICATION_DECISIONS = new Set(["pass", "fail", "uncertain", "blocked", "needs_evidence", "needs_human_gate", "met", "not_met", "disputed", "side_effect_uncertain"]);

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`verification action dependency missing: ${name}`);
  return value;
}

function normalizeVerificationResultType(value) {
  const text = String(value || "verifier").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return WORKFLOW_VERIFICATION_RESULT_TYPES.has(text) ? text : "verifier";
}

function normalizeVerificationDecision(value) {
  const text = String(value || "uncertain").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return WORKFLOW_VERIFICATION_DECISIONS.has(text) ? text : "uncertain";
}

function workflowEvaluatorScopedWhere(workflowId, phaseKey = "", phaseColumn = "phase_key") {
  const filters = [`workflow_id=${sqlValue(workflowId)}`];
  if (phaseKey) filters.push(`${phaseColumn}=${sqlValue(phaseKey)}`);
  return filters.join(" AND ");
}

function workflowEvaluatorDecision(snapshot) {
  const taskCounts = snapshot.taskCounts || {};
  const dispatchCounts = snapshot.dispatchCounts || {};
  const runtimeCounts = snapshot.runtimeCounts || {};
  const verificationCounts = snapshot.verificationCounts || {};
  const failedVerification = Number(verificationCounts.fail || 0) + Number(verificationCounts.not_met || 0) + Number(verificationCounts.disputed || 0);
  const evidenceNeeds = Number(verificationCounts.needs_evidence || 0) + Number(verificationCounts.uncertain || 0);
  const passedVerification = Number(verificationCounts.pass || 0) + Number(verificationCounts.met || 0);
  if (Number(snapshot.sideEffectUncertainCount || 0) > 0) return "side_effect_uncertain";
  if (Number(snapshot.pendingHumanGates || 0) > 0 || Number(verificationCounts.needs_human_gate || 0) > 0) return "needs_human_gate";
  if (Number(snapshot.activeIncidentCount || 0) > 0 || Number(taskCounts.blocked || 0) > 0 || Number(verificationCounts.blocked || 0) > 0) return "blocked";
  if (Number(taskCounts.failed || 0) > 0 || Number(dispatchCounts.failed || 0) > 0 || Number(runtimeCounts.failed || 0) > 0 || failedVerification > 0) return "not_met";
  if (Number(taskCounts.pending || 0) > 0 || Number(taskCounts.in_progress || 0) > 0 || Number(dispatchCounts.queued || 0) > 0 || Number(dispatchCounts.sent || 0) > 0) return "needs_evidence";
  if (evidenceNeeds > 0) return "needs_evidence";
  if (Number(snapshot.evidenceCount || 0) <= 0) return "needs_evidence";
  if (Number(snapshot.taskTotal || 0) > 0 && Number(taskCounts.done || 0) < Number(snapshot.taskTotal || 0)) return "needs_evidence";
  if (passedVerification > 0 || Number(snapshot.taskTotal || 0) > 0) return "met";
  return "needs_evidence";
}

function workflowEvaluatorSummary(decision, snapshot) {
  const scope = snapshot.phaseKey ? `phase ${snapshot.phaseKey}` : "workflow";
  const bits = [
    `${scope} evaluator decision: ${decision}`,
    `tasks=${snapshot.taskTotal}`,
    `evidence=${snapshot.evidenceCount}`,
    `verification=${snapshot.verificationTotal}`,
    `pendingHumanGates=${snapshot.pendingHumanGates}`,
    `sideEffectUncertain=${snapshot.sideEffectUncertainCount}`,
    `activeIncidents=${snapshot.activeIncidentCount}`
  ];
  return bits.join("; ");
}

function workflowEvaluatorFindings(decision, snapshot) {
  const findings = [];
  if (snapshot.acceptanceCriteria) findings.push(`acceptance criteria present: ${snapshot.acceptanceCriteria}`);
  if (snapshot.planSpecPresent) findings.push("Plan Spec v2 payload is present.");
  if (Number(snapshot.taskTotal || 0) > 0) findings.push(`task counts: ${JSON.stringify(snapshot.taskCounts)}`);
  if (Number(snapshot.evidenceCount || 0) > 0) findings.push(`evidence count: ${snapshot.evidenceCount}`);
  if (Number(snapshot.verificationTotal || 0) > 0) findings.push(`verification decisions: ${JSON.stringify(snapshot.verificationCounts)}`);
  if (Number(snapshot.pendingHumanGates || 0) > 0) findings.push(`pending Human Gate count: ${snapshot.pendingHumanGates}`);
  if (Number(snapshot.sideEffectUncertainCount || 0) > 0) findings.push(`side-effect uncertain count: ${snapshot.sideEffectUncertainCount}`);
  if (Number(snapshot.activeIncidentCount || 0) > 0) findings.push(`active incident count: ${snapshot.activeIncidentCount}`);
  if (!findings.length) findings.push(`evaluator produced ${decision} with no additional evidence.`);
  return findings;
}

function workflowEvaluatorRecommendations(decision) {
  if (decision === "met") return ["Prepare Cat Claw secretary audit before any Human Gate closeout."];
  if (decision === "needs_human_gate") return ["Keep workflow paused at the Human Gate boundary until Flashcat original words are captured."];
  if (decision === "side_effect_uncertain") return ["Do not retry side effects automatically; prepare uncertainty evidence for human review."];
  if (decision === "blocked") return ["Create or update an incident/evidence item before further workflow progress."];
  if (decision === "not_met") return ["Route the failed acceptance evidence back to the responsible phase for repair."];
  return ["Collect missing artifacts, receipts, verifier/refuter outputs, or readiness evidence before approval."];
}

function countByStatus(rows = []) {
  return Object.fromEntries(rows.map((row) => [row.status || "unknown", Number(row.count || 0)]));
}

function hasAllColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
}

export function createVerificationActionRegistry(handlers = {}) {
  const entries = Object.entries(VERIFICATION_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing verification action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runVerificationAction(registry, action, rootDir, input = {}, permissionDecision = null) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input, permissionDecision) };
}

export function createVerificationActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const isWorkflowTrustedOperator = requireContextFunction(context, "isWorkflowTrustedOperator");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateCount = requireContextFunction(context, "pendingHumanGateCount");
  const workflowPayloadSqlWhere = requireContextFunction(context, "workflowPayloadSqlWhere");
  const workflowPermissionCaller = requireContextFunction(context, "workflowPermissionCaller");

  function workflowVerificationRecordFromInput(input = {}, now = nowIso()) {
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const resultType = normalizeVerificationResultType(input.resultType || input.result_type || input.type || input.role);
    const decision = normalizeVerificationDecision(input.decision || input.status || input.result || input.outcome);
    const permissionDecision = input.__permissionDecision || {};
    const caller = permissionDecision.caller || workflowPermissionCaller(input);
    const trustedCaller = isWorkflowTrustedOperator(caller);
    const callerAgent = String(caller.agentId || "").trim();
    const declaredSourceAgent = String(input.sourceAgent || input.source_agent || input.agentId || input.agent_id || "").trim();
    const effectiveSourceAgent = callerAgent && (!trustedCaller || !declaredSourceAgent) ? callerAgent : declaredSourceAgent;
    const declaredVerifierAgent = String(input.verifierAgent || input.verifier_agent || (resultType === "verifier" ? input.agentId || input.agent_id || input.sourceAgent || input.source_agent || "" : "")).trim();
    const declaredRefuterAgent = String(input.refuterAgent || input.refuter_agent || (resultType === "refuter" ? input.agentId || input.agent_id || input.sourceAgent || input.source_agent || "" : "")).trim();
    const payload = redactSensitiveForPersistence(parseJsonValue(input.payload, {
      raw: input.raw || {},
      criteria: input.criteria || input.acceptanceCriteria || input.acceptance_criteria || [],
      notes: input.notes || ""
    }));
    const createdAt = String(input.createdAt || input.created_at || now).trim();
    return {
      verificationId: String(input.verificationId || input.verification_id || safeId(`verification.${resultType}`)).trim(),
      workflowId,
      phaseId: String(input.phaseId || input.phase_id || "").trim(),
      phaseKey: String(input.phaseKey || input.phase_key || input.phase || "").trim(),
      taskId: String(input.taskId || input.task_id || "").trim(),
      agentRunId: String(input.agentRunId || input.agent_run_id || "").trim(),
      dispatchId: String(input.dispatchId || input.dispatch_id || "").trim(),
      runtimeRunId: String(input.runtimeRunId || input.runtime_run_id || "").trim(),
      resultType,
      decision,
      verifierAgent: resultType === "verifier" && callerAgent && !trustedCaller ? effectiveSourceAgent : declaredVerifierAgent,
      refuterAgent: resultType === "refuter" && callerAgent && !trustedCaller ? effectiveSourceAgent : declaredRefuterAgent,
      sourceRuntime: String(input.sourceRuntime || input.source_runtime || input.runtime || "").trim(),
      sourceAgent: effectiveSourceAgent,
      confidence: String(input.confidence || "").trim(),
      riskBand: String(input.riskBand || input.risk_band || "").trim(),
      summary: redactSensitiveTextForPersistence(input.summary || input.reviewSummary || input.review_summary || input.text || "").trim(),
      findings: redactSensitiveForPersistence(toList(input.findings || input.finding)),
      recommendations: redactSensitiveForPersistence(toList(input.recommendations || input.recommendation || input.nextActions || input.next_actions)),
      evidenceRefs: redactSensitiveForPersistence(toList(input.evidenceRefs || input.evidence_refs || input.evidencePaths || input.evidence_paths)),
      artifactRefs: redactSensitiveForPersistence(toList(input.artifactRefs || input.artifact_refs || input.artifacts)),
      receiptRefs: redactSensitiveForPersistence(toList(input.receiptRefs || input.receipt_refs || input.receipts)),
      payload,
      payloadHash: jsonHash(payload),
      createdBy: callerAgent || String(input.createdBy || input.created_by || input.actor || input.from || input.sourceAgent || input.source_agent || "").trim() || "unknown",
      createdAt
    };
  }

  async function workflowVerificationRecord(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const record = workflowVerificationRecordFromInput({ ...input, __permissionDecision: permissionDecision });
    const exists = await sqlite(paths.dbFile, `SELECT verification_id FROM workflow_verification_results WHERE verification_id=${sqlValue(record.verificationId)} LIMIT 1;`, { json: true });
    if (exists[0]) throw new Error(`workflow verification result already exists: ${record.verificationId}`);
    await sqlite(paths.dbFile, `
INSERT INTO workflow_verification_results(verification_id, workflow_id, phase_id, phase_key, task_id, agent_run_id, dispatch_id, runtime_run_id, result_type, decision, verifier_agent, refuter_agent, source_runtime, source_agent, confidence, risk_band, summary, findings_json, recommendations_json, evidence_refs_json, artifact_refs_json, receipt_refs_json, payload_hash, payload_json, created_by, created_at)
VALUES (${sqlValue(record.verificationId)}, ${sqlValue(record.workflowId)}, ${sqlValue(record.phaseId)}, ${sqlValue(record.phaseKey)}, ${sqlValue(record.taskId)}, ${sqlValue(record.agentRunId)}, ${sqlValue(record.dispatchId)}, ${sqlValue(record.runtimeRunId)}, ${sqlValue(record.resultType)}, ${sqlValue(record.decision)}, ${sqlValue(record.verifierAgent)}, ${sqlValue(record.refuterAgent)}, ${sqlValue(record.sourceRuntime)}, ${sqlValue(record.sourceAgent)}, ${sqlValue(record.confidence)}, ${sqlValue(record.riskBand)}, ${sqlValue(record.summary)}, ${sqlValue(JSON.stringify(record.findings))}, ${sqlValue(JSON.stringify(record.recommendations))}, ${sqlValue(JSON.stringify(record.evidenceRefs))}, ${sqlValue(JSON.stringify(record.artifactRefs))}, ${sqlValue(JSON.stringify(record.receiptRefs))}, ${sqlValue(record.payloadHash)}, ${sqlValue(JSON.stringify(record.payload))}, ${sqlValue(record.createdBy)}, ${sqlValue(record.createdAt)});`);
    return {
      verificationId: record.verificationId,
      workflowId: record.workflowId,
      resultType: record.resultType,
      decision: record.decision,
      phaseKey: record.phaseKey,
      taskId: record.taskId,
      agentRunId: record.agentRunId,
      payloadHash: record.payloadHash,
      createdAt: record.createdAt,
      dbFile: paths.dbFile
    };
  }

  async function workflowVerificationList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const filters = [];
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (workflowId) filters.push(`workflow_id=${sqlValue(workflowId)}`);
    const phaseKey = String(input.phaseKey || input.phase_key || "").trim();
    if (phaseKey) filters.push(`phase_key=${sqlValue(phaseKey)}`);
    const taskId = String(input.taskId || input.task_id || "").trim();
    if (taskId) filters.push(`task_id=${sqlValue(taskId)}`);
    const resultType = String(input.resultType || input.result_type || "").trim();
    if (resultType) filters.push(`result_type=${sqlValue(resultType)}`);
    const decision = String(input.decision || "").trim();
    if (decision) filters.push(`decision=${sqlValue(decision)}`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const requestedLimit = Number(input.limit || 100);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, Math.trunc(requestedLimit))) : 100;
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_verification_results
${where}
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
    return { count: rows.length, results: rows, dbFile: paths.dbFile };
  }

  async function workflowEvaluate(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const phaseKey = String(input.phaseKey || input.phase_key || input.phase || "").trim();
    const workflowRows = await sqlite(paths.dbFile, `
SELECT workflow_id, status, summary, objective, acceptance_criteria, current_phase, current_decision, payload_json, updated_at
FROM workflow_runs
WHERE workflow_id=${sqlValue(workflowId)}
LIMIT 1;`, { json: true });
    const workflow = workflowRows[0];
    if (!workflow) throw new Error(`workflow not found: ${workflowId}`);
    const [
      taskColumns,
      dispatchColumns,
      runtimeColumns,
      agentRunColumns,
      artifactColumns,
      sideEffectColumns,
      incidentColumns,
      verificationColumns
    ] = await Promise.all([
      tableColumns(paths.dbFile, "workflow_tasks"),
      tableColumns(paths.dbFile, "mixed_meeting_dispatches"),
      tableColumns(paths.dbFile, "runtime_runs"),
      tableColumns(paths.dbFile, "workflow_agent_runs"),
      tableColumns(paths.dbFile, "artifact_index"),
      tableColumns(paths.dbFile, "side_effect_ledger"),
      tableColumns(paths.dbFile, "incident_states"),
      tableColumns(paths.dbFile, "workflow_verification_results")
    ]);
    const taskWhere = workflowEvaluatorScopedWhere(workflowId, phaseKey, "phase");
    const phaseKeyWhere = workflowEvaluatorScopedWhere(workflowId, phaseKey, "phase_key");
    const workflowWhere = `workflow_id=${sqlValue(workflowId)}`;
    const taskScopedWhere = phaseKey && taskColumns.has("phase") ? taskWhere : workflowWhere;
    const agentRunScopedWhere = phaseKey && agentRunColumns.has("phase_key") ? phaseKeyWhere : workflowWhere;
    const verificationScopedWhere = phaseKey && verificationColumns.has("phase_key") ? phaseKeyWhere : workflowWhere;
    const taskRows = hasAllColumns(taskColumns, ["workflow_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_tasks
WHERE ${taskScopedWhere}
GROUP BY status;`, { json: true }) : [];
    const dispatchRows = hasAllColumns(dispatchColumns, ["workflow_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE ${workflowWhere}
GROUP BY status;`, { json: true }) : [];
    const runtimeRows = hasAllColumns(runtimeColumns, ["workflow_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM runtime_runs
WHERE ${workflowWhere}
GROUP BY status;`, { json: true }) : [];
    const agentRunReceiptCount = hasAllColumns(agentRunColumns, ["workflow_id", "receipt_ref"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_agent_runs
WHERE ${agentRunScopedWhere}
  AND receipt_ref IS NOT NULL
  AND receipt_ref != '';`, { json: true }))[0]?.count || 0) : 0;
    const runtimeReceiptCount = hasAllColumns(runtimeColumns, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM runtime_runs
WHERE ${workflowWhere}
  AND status IN ('acked','completed','success');`, { json: true }))[0]?.count || 0) : 0;
    const artifactRows = hasAllColumns(artifactColumns, ["workflow_id", "artifact_id", "path", "created_at"]) ? await sqlite(paths.dbFile, `
SELECT artifact_id, path
FROM artifact_index
WHERE ${workflowWhere}
ORDER BY created_at DESC
LIMIT 20;`, { json: true }) : [];
    const verificationRows = hasAllColumns(verificationColumns, ["workflow_id", "decision", "result_type"]) ? await sqlite(paths.dbFile, `
SELECT verification_id, result_type, decision, payload_hash, created_at
FROM workflow_verification_results
WHERE ${verificationScopedWhere}
  AND result_type != 'evaluator'
ORDER BY created_at DESC
LIMIT 50;`, { json: true }) : [];
    const verificationCounts = {};
    const verificationTypeCounts = {};
    for (const row of verificationRows) {
      verificationCounts[row.decision || "unknown"] = (verificationCounts[row.decision || "unknown"] || 0) + 1;
      verificationTypeCounts[row.result_type || "unknown"] = (verificationTypeCounts[row.result_type || "unknown"] || 0) + 1;
    }
    const sideEffectUncertainCount = hasAllColumns(sideEffectColumns, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM side_effect_ledger
WHERE ${workflowWhere}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed');`, { json: true }))[0]?.count || 0) : 0;
    const activeIncidentCount = hasAllColumns(incidentColumns, ["status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM incident_states
WHERE status IN ('active','mitigating','monitoring')
  AND ${workflowPayloadSqlWhere(workflowId, { parentColumn: "" })};`, { json: true }))[0]?.count || 0) : 0;
    const pendingHumanGates = await pendingHumanGateCount(paths, workflowId);
    const workflowPayload = parseJsonValue(workflow.payload_json, {});
    const acceptanceCriteria = String(input.acceptanceCriteria || input.acceptance_criteria || workflow.acceptance_criteria || workflowPayload?.spec?.objective?.acceptanceCriteria || workflowPayload?.planSpecV2?.objective?.acceptanceCriteria || "").trim();
    const snapshot = {
      evaluatorVersion: "workflow_evaluator_v1",
      workflowId,
      phaseKey,
      workflowStatus: workflow.status || "",
      workflowSummary: workflow.summary || "",
      objective: workflow.objective || "",
      acceptanceCriteria,
      planSpecPresent: Boolean(workflowPayload.planSpecV2 || workflowPayload.spec?.planSpecV2 || workflowPayload.spec?.phaseGraph),
      taskCounts: countByStatus(taskRows),
      taskTotal: taskRows.reduce((total, row) => total + Number(row.count || 0), 0),
      dispatchCounts: countByStatus(dispatchRows),
      runtimeCounts: countByStatus(runtimeRows),
      receiptCount: agentRunReceiptCount + runtimeReceiptCount,
      artifactCount: artifactRows.length,
      evidenceCount: artifactRows.length + agentRunReceiptCount + runtimeReceiptCount + verificationRows.length,
      verificationCounts,
      verificationTypeCounts,
      verificationTotal: verificationRows.length,
      pendingHumanGates,
      sideEffectUncertainCount,
      activeIncidentCount,
      evaluatedAt: nowIso()
    };
    const decision = normalizeVerificationDecision(input.decision || workflowEvaluatorDecision(snapshot));
    return workflowVerificationRecord(rootDir, {
      ...input,
      verificationId: input.verificationId || input.verification_id || safeId(`evaluation.${workflowId}${phaseKey ? `.${phaseKey}` : ""}`),
      workflowId,
      phaseKey,
      resultType: "evaluator",
      decision,
      sourceAgent: input.sourceAgent || input.source_agent || input.evaluatorAgent || input.evaluator_agent || input.callerAgent || input.caller_agent || "",
      sourceRuntime: input.sourceRuntime || input.source_runtime || input.callerRuntime || input.caller_runtime || "",
      confidence: input.confidence || (decision === "met" ? "medium" : "low"),
      riskBand: input.riskBand || input.risk_band || (["met", "needs_evidence"].includes(decision) ? "medium" : "high"),
      summary: input.summary || workflowEvaluatorSummary(decision, snapshot),
      findings: input.findings || workflowEvaluatorFindings(decision, snapshot),
      recommendations: input.recommendations || workflowEvaluatorRecommendations(decision),
      artifactRefs: input.artifactRefs || input.artifact_refs || artifactRows.map((row) => row.path || row.artifact_id).filter(Boolean),
      receiptRefs: input.receiptRefs || input.receipt_refs || verificationRows.map((row) => row.verification_id || row.payload_hash).filter(Boolean).slice(0, 20),
      payload: {
        evaluator: "workflow_evaluator_v1",
        snapshot,
        latestVerificationResults: verificationRows.slice(0, 10)
      }
    }, permissionDecision);
  }

  return {
    workflowVerificationRecord,
    workflowVerificationList,
    workflowEvaluate
  };
}
