import { boolOption } from "./workflow/json.js";
import {
  sqlValue,
  sqlite,
  tableColumns
} from "./workflow/sqlite.js";

export const INTERVENTION_ACTION_HANDLER_NAMES = {
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

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`intervention action dependency missing: ${name}`);
  return value;
}

function countByStatus(rows = []) {
  return Object.fromEntries(rows.map((row) => [row.status || "unknown", Number(row.count || 0)]));
}

function statusCountTotal(counts = {}, statuses = []) {
  return statuses.reduce((total, status) => total + Number(counts[status] || 0), 0);
}

function hasAllColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
}

function interventionTarget(input = {}) {
  return {
    phaseId: String(input.phaseId || input.phase_id || "").trim(),
    phaseKey: String(input.phaseKey || input.phase_key || input.phase || "").trim(),
    agentRunId: String(input.agentRunId || input.agent_run_id || "").trim(),
    dispatchId: String(input.dispatchId || input.dispatch_id || "").trim(),
    runtimeRunId: String(input.runtimeRunId || input.runtime_run_id || "").trim(),
    runtime: String(input.runtime || "").trim(),
    agentId: String(input.agentId || input.agent_id || "").trim()
  };
}

function workflowInterventionKind(action) {
  if (action === "workflow.pause" || action.includes(".pause.")) return "pause_workflow";
  if (action === "workflow.resume" || action.includes(".resume.")) return "resume_workflow";
  if (action === "workflow.stop" || action === "workflow.terminate" || action.includes(".stop.") || action.includes(".terminate.")) return "stop_workflow";
  if (action.includes(".rerun.agent.")) return "rerun_agent";
  if (action.includes(".rerun.phase.")) return "rerun_phase";
  return "unknown";
}

function workflowInterventionPreviewAction(kind) {
  if (kind === "pause_workflow") return "workflow.pause.preview";
  if (kind === "resume_workflow") return "workflow.resume.preview";
  if (kind === "stop_workflow") return "workflow.stop.preview";
  if (kind === "rerun_agent") return "workflow.rerun.agent.preview";
  if (kind === "rerun_phase") return "workflow.rerun.phase.preview";
  return "";
}

function workflowInterventionNextState(kind, workflowStatus) {
  if (kind === "pause_workflow") return "paused";
  if (kind === "resume_workflow") return "active";
  if (kind === "stop_workflow") return "stopped";
  return workflowStatus;
}

function interventionRiskTier(kind, context = {}) {
  if (kind === "stop_workflow") return context.sideEffectUncertainCount ? "P0-critical" : "P1-high";
  if (kind === "rerun_agent" || kind === "rerun_phase") return "P1-high";
  return "P2-medium";
}

function evaluateInterventionEligibility(kind, workflow, context = {}, input = {}) {
  const status = String(workflow.status || "").trim();
  const terminal = ["completed", "stopped", "cancelled"].includes(status);
  const violations = [];
  const warnings = [];
  if (terminal) violations.push({ code: "workflow_terminal", detail: `workflow status is ${status}` });
  if (kind === "pause_workflow" && status === "paused") violations.push({ code: "already_paused", detail: "workflow is already paused" });
  if (kind === "pause_workflow" && !["active", "waiting_human", "blocked"].includes(status)) {
    violations.push({ code: "pause_invalid_status", detail: `pause preview expects active/waiting_human/blocked, got ${status || "unknown"}` });
  }
  if (kind === "resume_workflow") {
    if (!["paused", "blocked"].includes(status)) violations.push({ code: "resume_invalid_status", detail: `resume preview expects paused/blocked, got ${status || "unknown"}` });
    if (context.pendingHumanGates > 0 && !boolOption(input.allowPendingHumanGate ?? input.allow_pending_human_gate, false)) {
      violations.push({ code: "pending_human_gate", detail: "pending Human Gate must be closed before resume" });
    }
  }
  if (kind === "stop_workflow" && !["active", "waiting_human", "blocked", "paused"].includes(status)) {
    violations.push({ code: "stop_invalid_status", detail: `stop preview expects active/waiting_human/blocked/paused, got ${status || "unknown"}` });
  }
  if (kind === "rerun_agent") {
    const hasTarget = Boolean(context.target.agentRunId || context.target.dispatchId || context.target.runtimeRunId || context.target.agentId);
    if (!hasTarget) violations.push({ code: "missing_agent_target", detail: "rerun agent preview requires agentRunId, dispatchId, runtimeRunId, or agentId" });
    if (context.targetAgentRunCount === 0 && context.targetDispatchCount === 0) warnings.push({ code: "target_not_found", detail: "no matching agent run or dispatch evidence was found" });
  }
  if (kind === "rerun_phase") {
    if (!context.target.phaseId && !context.target.phaseKey) violations.push({ code: "missing_phase_target", detail: "rerun phase preview requires phaseId or phaseKey" });
    if ((context.target.phaseId || context.target.phaseKey) && context.targetPhaseCount === 0) violations.push({ code: "phase_not_found", detail: "no matching workflow phase was found" });
  }
  if (context.sideEffectUncertainCount > 0) warnings.push({ code: "side_effect_uncertain", detail: `${context.sideEffectUncertainCount} side-effect records are uncertain` });
  if (context.activeDispatchCount > 0 && ["pause_workflow", "stop_workflow", "rerun_phase"].includes(kind)) {
    warnings.push({ code: "active_dispatches", detail: `${context.activeDispatchCount} dispatches are queued or sent` });
  }
  return { eligible: violations.length === 0, violations, warnings };
}

export function createInterventionActionRegistry(handlers = {}) {
  const entries = Object.entries(INTERVENTION_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing intervention action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runInterventionAction(registry, action, rootDir, input = {}, permissionDecision = null) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input, permissionDecision) };
}

export function createInterventionActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const canonicalWorkflowAction = requireContextFunction(context, "canonicalWorkflowAction");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateCount = requireContextFunction(context, "pendingHumanGateCount");

  async function workflowInterventionPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const action = canonicalWorkflowAction(input.action || "workflow.pause.preview");
    const kind = workflowInterventionKind(action);
    if (kind === "unknown") throw new Error(`unsupported intervention preview action: ${action}`);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const checkedAt = nowIso();
    const workflowRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
    if (!workflowRows[0]) throw new Error(`workflow not found: ${workflowId}`);
    const workflow = workflowRows[0];
    const target = interventionTarget(input);
    const [taskColumns, dispatchColumns, phaseColumns, checkpointColumns, sideEffectColumns, agentRunColumns] = await Promise.all([
      tableColumns(paths.dbFile, "workflow_tasks"),
      tableColumns(paths.dbFile, "mixed_meeting_dispatches"),
      tableColumns(paths.dbFile, "workflow_phases"),
      tableColumns(paths.dbFile, "workflow_checkpoints"),
      tableColumns(paths.dbFile, "side_effect_ledger"),
      tableColumns(paths.dbFile, "workflow_agent_runs")
    ]);
    const taskCounts = hasAllColumns(taskColumns, ["workflow_id", "status"]) ? countByStatus(await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)}
GROUP BY status;`, { json: true })) : {};
    const dispatchCounts = hasAllColumns(dispatchColumns, ["workflow_id", "status"]) ? countByStatus(await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
GROUP BY status;`, { json: true })) : {};
    const phaseCounts = hasAllColumns(phaseColumns, ["workflow_id", "status"]) ? countByStatus(await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_phases
WHERE workflow_id=${sqlValue(workflowId)}
GROUP BY status;`, { json: true })) : {};
    const pendingHumanGates = await pendingHumanGateCount(paths, workflowId);
    const latestCheckpoint = hasAllColumns(checkpointColumns, ["workflow_id", "checkpoint_id", "status", "phase", "decision", "path", "created_at"]) ? (await sqlite(paths.dbFile, `
SELECT checkpoint_id, status, phase, decision, path, created_at
FROM workflow_checkpoints
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 1;`, { json: true }))[0] || null : null;
    const sideEffectUncertainCount = hasAllColumns(sideEffectColumns, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed')
LIMIT 1;`, { json: true }))[0]?.count || 0) : 0;
    const activeDispatchCount = statusCountTotal(dispatchCounts, ["queued", "sent", "runtime_dispatched", "running", "delivering"]);
    const phaseWhere = target.phaseId
      ? `phase_id=${sqlValue(target.phaseId)}`
      : (target.phaseKey ? `phase_key=${sqlValue(target.phaseKey)}` : "0=1");
    const targetPhaseRows = hasAllColumns(phaseColumns, ["workflow_id", "phase_id", "phase_key", "status", "ordinal", "owner_agent", "verifier_agent", "human_gate_required", "updated_at"]) ? await sqlite(paths.dbFile, `
SELECT phase_id, phase_key, status, ordinal, owner_agent, verifier_agent, human_gate_required, updated_at
FROM workflow_phases
WHERE workflow_id=${sqlValue(workflowId)}
  AND ${phaseWhere}
ORDER BY ordinal, phase_key
LIMIT 20;`, { json: true }) : [];
    const agentRunFilters = [];
    if (target.agentRunId) agentRunFilters.push(`agent_run_id=${sqlValue(target.agentRunId)}`);
    if (target.dispatchId) agentRunFilters.push(`dispatch_id=${sqlValue(target.dispatchId)}`);
    if (target.runtimeRunId) agentRunFilters.push(`runtime_run_id=${sqlValue(target.runtimeRunId)}`);
    if (target.agentId) agentRunFilters.push(`agent_id=${sqlValue(target.agentId)}`);
    if (target.runtime) agentRunFilters.push(`runtime=${sqlValue(target.runtime)}`);
    const agentRunWhere = agentRunFilters.length ? agentRunFilters.join(" AND ") : "0=1";
    const targetAgentRuns = hasAllColumns(agentRunColumns, ["workflow_id", "agent_run_id", "phase_key", "task_id", "dispatch_id", "runtime_run_id", "runtime", "agent_id", "status", "receipt_ref", "updated_at"]) ? await sqlite(paths.dbFile, `
SELECT agent_run_id, phase_key, task_id, dispatch_id, runtime_run_id, runtime, agent_id, status, receipt_ref, updated_at
FROM workflow_agent_runs
WHERE workflow_id=${sqlValue(workflowId)}
  AND ${agentRunWhere}
ORDER BY updated_at DESC
LIMIT 20;`, { json: true }) : [];
    const dispatchFilters = [];
    if (target.dispatchId) dispatchFilters.push(`dispatch_id=${sqlValue(target.dispatchId)}`);
    if (target.agentId) dispatchFilters.push(`agent_id=${sqlValue(target.agentId)}`);
    if (target.runtime) dispatchFilters.push(`runtime=${sqlValue(target.runtime)}`);
    const dispatchWhere = dispatchFilters.length ? dispatchFilters.join(" AND ") : "0=1";
    const targetDispatches = hasAllColumns(dispatchColumns, ["workflow_id", "dispatch_id", "runtime", "agent_id", "status", "attempt", "max_attempts", "updated_at", "last_error"]) ? await sqlite(paths.dbFile, `
SELECT dispatch_id, '' AS task_id, runtime, agent_id, status, attempt, max_attempts, updated_at, last_error
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
  AND ${dispatchWhere}
ORDER BY updated_at DESC
LIMIT 20;`, { json: true }) : [];
    const context = {
      target,
      taskCounts,
      dispatchCounts,
      phaseCounts,
      pendingHumanGates,
      latestCheckpoint,
      sideEffectUncertainCount,
      activeDispatchCount,
      targetPhaseCount: targetPhaseRows.length,
      targetAgentRunCount: targetAgentRuns.length,
      targetDispatchCount: targetDispatches.length
    };
    const eligibility = evaluateInterventionEligibility(kind, workflow, context, input);
    const riskTier = interventionRiskTier(kind, context);
    return {
      workflowId,
      action,
      kind,
      preview: true,
      readOnly: true,
      eligible: eligibility.eligible,
      riskTier,
      humanGateRequired: true,
      catClawAuditRequired: true,
      checkedAt,
      workflow: {
        workflowId: workflow.workflow_id,
        status: workflow.status,
        currentPhase: workflow.current_phase || "",
        currentDecision: workflow.current_decision || "",
        updatedAt: workflow.updated_at
      },
      target,
      wouldUpdateWorkflow: ["pause_workflow", "resume_workflow", "stop_workflow"].includes(kind) ? {
        status: workflowInterventionNextState(kind, workflow.status),
        currentDecision: `${kind}_requested`,
        updatedAt: checkedAt
      } : null,
      wouldCreateHumanGateRequest: true,
      wouldRequireEvidence: [
        "latest_checkpoint",
        "workflow_operations_record",
        "cat_claw_audit",
        "operator_reason",
        "rollback_or_resume_boundary"
      ],
      wouldAffect: {
        activeDispatches: activeDispatchCount,
        pendingHumanGates,
        sideEffectUncertain: sideEffectUncertainCount,
        targetPhases: targetPhaseRows.length,
        targetAgentRuns: targetAgentRuns.length,
        targetDispatches: targetDispatches.length
      },
      counts: { tasks: taskCounts, dispatches: dispatchCounts, phases: phaseCounts },
      latestCheckpoint,
      targetPhases: targetPhaseRows,
      targetAgentRuns,
      targetDispatches,
      violations: eligibility.violations,
      warnings: eligibility.warnings,
      limitations: [
        "Preview is read-only and does not update workflow state.",
        "No dispatch, runtime drain, Telegram delivery, Human Gate submission, or task reset is executed.",
        "Real pause/resume/stop/rerun controls remain disabled until transition policy and Human Gate execution paths are implemented."
      ],
      dbFile: paths.dbFile
    };
  }

  async function workflowInterventionExecute(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const action = canonicalWorkflowAction(input.action || "");
    const kind = workflowInterventionKind(action);
    if (!["pause_workflow", "resume_workflow", "stop_workflow"].includes(kind)) {
      throw new Error(`unsupported intervention execution action: ${action}`);
    }
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const reason = String(input.operatorReason || input.operator_reason || input.reason || input.summary || "").trim();
    if (!reason) throw new Error("operatorReason is required for workflow intervention execution");
    const previewAction = workflowInterventionPreviewAction(kind);
    const preview = await workflowInterventionPreview(rootDir, { ...input, action: previewAction });
    if (!preview.eligible) {
      const codes = (preview.violations || []).map((item) => item.code).join(",") || "unknown";
      throw new Error(`workflow intervention not eligible: action=${action} violations=${codes}`);
    }
    const rollbackBoundary = String(input.rollbackBoundary || input.rollback_boundary || input.resumeBoundary || input.resume_boundary || input.stopCondition || input.stop_condition || preview.latestCheckpoint?.path || "").trim();
    if (!rollbackBoundary) {
      throw new Error("rollbackBoundary or latest checkpoint is required for workflow intervention execution");
    }
    const now = nowIso();
    const previousStatus = preview.workflow.status || "";
    const nextStatus = workflowInterventionNextState(kind, previousStatus);
    const currentDecision = `${kind}_executed`;
    await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET status=${sqlValue(nextStatus)},
    current_decision=${sqlValue(currentDecision)},
    updated_at=${sqlValue(now)}
WHERE workflow_id=${sqlValue(workflowId)};`);
    await appendWorkflowEvent(paths, {
      eventType: "workflow.intervention.executed",
      status: nextStatus,
      workflowId,
      traceId: input.traceId || input.trace_id || "",
      humanGateId: input.humanGateId || input.human_gate_id || "",
      actor: input.actor || input.createdBy || input.created_by || permissionDecision?.caller?.agentId || "unknown",
      sourceRuntime: input.sourceRuntime || input.source_runtime || permissionDecision?.caller?.runtime || "workflow",
      sourceAgent: input.sourceAgent || input.source_agent || permissionDecision?.caller?.agentId || "",
      previousState: previousStatus,
      nextState: nextStatus,
      idempotencyKey: input.idempotencyKey || input.idempotency_key || "",
      artifactRef: preview.latestCheckpoint?.path || "",
      payload: {
        action,
        kind,
        currentDecision,
        reason,
        rollbackBoundary,
        riskTier: preview.riskTier,
        catClawAuditId: input.catClawAuditId || input.cat_claw_audit_id || "",
        permissionPolicyOutcome: permissionDecision?.policyOutcome || "",
        warnings: preview.warnings || [],
        wouldAffect: preview.wouldAffect || {}
      },
      createdAt: now
    });
    return {
      workflowId,
      action,
      kind,
      status: "executed",
      previousStatus,
      nextStatus,
      currentDecision,
      executedAt: now,
      humanGateId: String(input.humanGateId || input.human_gate_id || "").trim(),
      catClawAuditId: String(input.catClawAuditId || input.cat_claw_audit_id || "").trim(),
      rollbackBoundary,
      riskTier: preview.riskTier,
      affected: {
        workflowRuns: 1,
        dispatches: 0,
        runtimeRuns: 0,
        outbox: 0,
        humanGateRequests: 0,
        sideEffects: 0
      },
      limitations: [
        "Only workflow_runs status/current_decision/updated_at and workflow_events were written.",
        "No task reset, dispatch retry, runtime drain, Telegram delivery, Human Gate submission, or side-effect retry was executed."
      ],
      dbFile: paths.dbFile
    };
  }

  return {
    workflowInterventionPreview,
    workflowInterventionExecute
  };
}
