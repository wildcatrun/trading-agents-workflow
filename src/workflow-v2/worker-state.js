import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  firstText
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";
import {
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2UniqueTextArray,
  workflowV2ValidationError
} from "./helpers.js";
import {
  workflowV2PlanNodeHardGateErrors,
  workflowV2PlanOrchestrationContract
} from "./plan.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeAgentId(value) {
  const agentId = String(value || "").trim();
  if (!agentId) throw new Error("agentId is required");
  if (agentId === "catclaw") throw new Error("retired agent id catclaw is invalid; use cat_claw");
  return agentId.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 96);
}

function normalizeOptionalAgentId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return normalizeAgentId(text);
}

export async function workflowV2RestoreWorkerRunRow(paths, row = {}) {
  if (!row?.worker_run_id) return;
  await sqlite(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status=${sqlValue(row.status || "")},
    parent_worker_run_id=${sqlValue(row.parent_worker_run_id || "")},
    supersedes_worker_run_id=${sqlValue(row.supersedes_worker_run_id || "")},
    successor_worker_run_id=${sqlValue(row.successor_worker_run_id || "")},
    worker_generation=${sqlValue(Number(row.worker_generation || 0))},
    attempt=${sqlValue(Number(row.attempt || 0))},
    max_attempts=${sqlValue(Number(row.max_attempts || 1))},
    lease_owner=${sqlValue(row.lease_owner || "")},
    lease_until=${sqlValue(row.lease_until || "")},
    next_retry_at=${sqlValue(row.next_retry_at || "")},
    output_info_id=${sqlValue(row.output_info_id || "")},
    handoff_info_id=${sqlValue(row.handoff_info_id || "")},
    receipt_ref=${sqlValue(row.receipt_ref || "")},
    last_error=${sqlValue(row.last_error || "")},
    context_budget_tokens=${sqlValue(Number(row.context_budget_tokens || 0))},
    context_used_tokens=${sqlValue(Number(row.context_used_tokens || 0))},
    compaction_count=${sqlValue(Number(row.compaction_count || 0))},
    source_context_refs_json=${sqlValue(row.source_context_refs_json || "[]")},
    payload_json=${sqlValue(row.payload_json || "{}")},
    started_at=${sqlValue(row.started_at || "")},
    completed_at=${sqlValue(row.completed_at || "")},
    updated_at=${sqlValue(row.updated_at || nowIso())}
WHERE worker_run_id=${sqlValue(row.worker_run_id)};`);
}

export async function workflowV2PersistedPlanNodeHardGateErrors(paths, workflowId = "", planId = "") {
  if (!workflowId || !planId || !fileExistsSync(paths.dbFile)) return [];
  const planRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true });
  const planRow = planRows[0];
  if (!planRow) return [];
  const payload = workflowV2JsonObject(planRow.payload_json, {});
  const orchestration = workflowV2JsonObject(payload.orchestration, {});
  const participantManagers = workflowV2JsonArray(planRow.participant_managers_json, []);
  const contract = workflowV2PlanOrchestrationContract({
    orchestration,
    orchestrationPattern: orchestration.pattern,
    orchestrationRationale: orchestration.rationale,
    complexityTier: orchestration.complexityTier,
    taskGroupRequired: orchestration.taskGroupRequired,
    workerBudget: workflowV2JsonObject(orchestration.workerBudget, {})
  }, participantManagers);
  const nodeRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plan_nodes
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
ORDER BY created_at ASC, node_id ASC;`, { json: true });
  const nodes = nodeRows.map((row) => ({
    nodeId: row.node_id || "",
    planId: row.plan_id || "",
    workflowId: row.workflow_id || "",
    parentNodeId: row.parent_node_id || "",
    nodeType: row.node_type || "",
    status: row.status || "",
    ownerAgent: row.owner_agent || "",
    runtimeBackend: row.runtime_backend || "",
    sessionId: row.session_id || "",
    dependsOn: workflowV2JsonArray(row.depends_on_json, []),
    inputInfoId: row.input_info_id || "",
    outputInfoId: row.output_info_id || "",
    payload: workflowV2JsonObject(row.payload_json, {})
  }));
  return workflowV2PlanNodeHardGateErrors(contract, nodes);
}

export async function workflowV2LoadWorkerRunForResult(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id, input.runId, input.run_id);
  if (!workerRunId) {
    return { paths, workerRunId, row: null, errors: [workflowV2ValidationError("worker_run_id_required", "worker result requires workerRunId")] };
  }
  if (!fileExistsSync(paths.dbFile)) {
    return { paths, workerRunId, row: null, errors: [workflowV2ValidationError("workflow_database_missing", "workflow database does not exist")] };
  }
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(workerRunId)}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  const errors = [];
  if (!row) errors.push(workflowV2ValidationError("worker_run_not_found", `worker run not found: ${workerRunId}`));
  return { paths, workerRunId, row, errors };
}

export function workflowV2LeaseCheckAt(input = {}) {
  return firstText(input.leaseCheckAt, input.lease_check_at, input.generatedAt, input.generated_at, input.now) || nowIso();
}

export function workflowV2LeaseErrors(row = {}, input = {}) {
  const errors = [];
  const leaseOwner = firstText(input.leaseOwner, input.lease_owner);
  const leaseUntil = firstText(input.leaseUntil, input.lease_until);
  const leaseCheckAt = workflowV2LeaseCheckAt(input);
  if (!leaseOwner) errors.push(workflowV2ValidationError("lease_owner_required", "worker result requires leaseOwner"));
  if (!leaseUntil) errors.push(workflowV2ValidationError("lease_until_required", "worker result requires leaseUntil"));
  if (row.status && row.status !== "running") errors.push(workflowV2ValidationError("worker_not_running", `worker result requires running status, got ${row.status}`));
  if (row.lease_owner && leaseOwner && row.lease_owner !== leaseOwner) errors.push(workflowV2ValidationError("lease_owner_mismatch", "worker result leaseOwner does not match current lease"));
  if (row.lease_until && leaseUntil && row.lease_until !== leaseUntil) errors.push(workflowV2ValidationError("lease_until_mismatch", "worker result leaseUntil does not match current lease"));
  if (!row.lease_owner || !row.lease_until) errors.push(workflowV2ValidationError("worker_not_leased", "worker result requires an active worker lease"));
  const rowLeaseMs = Date.parse(row.lease_until || "");
  const checkAtMs = Date.parse(leaseCheckAt || "");
  if (row.lease_until && Number.isNaN(rowLeaseMs)) errors.push(workflowV2ValidationError("lease_until_invalid", "worker result leaseUntil is not a valid timestamp"));
  if (Number.isNaN(checkAtMs)) errors.push(workflowV2ValidationError("lease_check_at_invalid", "worker result lease check timestamp is invalid"));
  if (row.lease_until && !Number.isNaN(rowLeaseMs) && !Number.isNaN(checkAtMs) && rowLeaseMs <= checkAtMs) {
    errors.push(workflowV2ValidationError("lease_expired", "worker result lease has expired"));
  }
  return errors;
}

export async function workflowV2LoadWorkerLifecycleActor(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workerRunId = firstText(input.workerRunId, input.worker_run_id, input.sourceWorkerRunId, input.source_worker_run_id, input.runId, input.run_id);
  const workflowId = firstText(input.workflowId, input.workflow_id);
  if (!workerRunId) errors.push(workflowV2ValidationError("worker_run_id_required", "worker lifecycle action requires workerRunId/sourceWorkerRunId"));
  if (!fileExistsSync(paths.dbFile)) {
    errors.push(workflowV2ValidationError("workflow_database_missing", "workflow database does not exist"));
    return {
      paths,
      errors,
      workerRunId,
      workflowId,
      row: null,
      plan: null,
      callerAgent: "",
      managerAgent: "",
      taskOwnerAgent: "",
      allowedAgents: []
    };
  }
  let row = null;
  if (workerRunId) {
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(workerRunId)}
LIMIT 1;`, { json: true });
    row = rows[0] || null;
    if (!row) errors.push(workflowV2ValidationError("worker_run_not_found", `worker run not found: ${workerRunId}`));
    if (row && workflowId && row.workflow_id !== workflowId) {
      errors.push(workflowV2ValidationError("workflow_id_mismatch", "worker lifecycle action workflowId does not match worker run", {
        workerWorkflowId: row.workflow_id,
        workflowId
      }));
    }
  }
  let plan = null;
  if (row?.plan_id) {
    const planRows = await sqlite(paths.dbFile, `
SELECT plan_id, workflow_id, task_owner_agent
FROM workflow_v2_plans
WHERE plan_id=${sqlValue(row.plan_id)}
LIMIT 1;`, { json: true });
    plan = planRows[0] || null;
    if (!plan) {
      errors.push(workflowV2ValidationError("plan_not_found", "worker lifecycle action requires the worker plan record"));
    } else if (plan.workflow_id !== row.workflow_id) {
      errors.push(workflowV2ValidationError("plan_workflow_mismatch", "worker lifecycle action plan workflow does not match worker run"));
    }
  }
  const callerAgent = normalizeOptionalAgentId(firstText(input.callerAgent, input.caller_agent, input.createdBy, input.created_by));
  const managerAgent = normalizeOptionalAgentId(row?.manager_agent || "");
  const taskOwnerAgent = normalizeOptionalAgentId(plan?.task_owner_agent || "");
  const allowedAgents = workflowV2UniqueTextArray([managerAgent, taskOwnerAgent]);
  if (!callerAgent) {
    errors.push(workflowV2ValidationError("caller_agent_required", "worker lifecycle action requires callerAgent/createdBy for manager or task-owner authority"));
  } else if (row && allowedAgents.length && !allowedAgents.includes(callerAgent)) {
    errors.push(workflowV2ValidationError("caller_agent_not_authorized", "worker lifecycle action can only be performed by the responsible manager or task owner", {
      callerAgent,
      allowedAgents
    }));
  }
  return { paths, errors, workerRunId, workflowId, row, plan, callerAgent, managerAgent, taskOwnerAgent, allowedAgents };
}

export async function workflowV2WorkerHandoffRow(paths, workerRunId = "", handoffId = "") {
  if (!workerRunId && !handoffId) return null;
  const clauses = [];
  if (workerRunId) clauses.push(`worker_run_id=${sqlValue(workerRunId)}`);
  if (handoffId) clauses.push(`handoff_id=${sqlValue(handoffId)}`);
  const order = handoffId ? "" : "ORDER BY updated_at DESC, created_at DESC";
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_handoffs
WHERE ${clauses.join(" AND ")}
${order}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function workflowV2WorkerHandoffById(paths, handoffId = "") {
  if (!handoffId) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_handoffs
WHERE handoff_id=${sqlValue(handoffId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function workflowV2RestoreWorkerHandoffRow(paths, row = null, handoffId = "") {
  const id = row?.handoff_id || handoffId;
  if (!id) return;
  if (!row) {
    await sqlite(paths.dbFile, `DELETE FROM workflow_v2_worker_handoffs WHERE handoff_id=${sqlValue(id)};`);
    return;
  }
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_worker_handoffs(handoff_id, workflow_id, plan_id, node_id, worker_run_id, manager_agent, successor_worker_run_id, handoff_info_id, status, reason, summary, source_context_refs_json, artifact_refs_json, receipt_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(row.handoff_id)}, ${sqlValue(row.workflow_id || "")}, ${sqlValue(row.plan_id || "")}, ${sqlValue(row.node_id || "")}, ${sqlValue(row.worker_run_id || "")}, ${sqlValue(row.manager_agent || "")}, ${sqlValue(row.successor_worker_run_id || "")}, ${sqlValue(row.handoff_info_id || "")}, ${sqlValue(row.status || "draft")}, ${sqlValue(row.reason || "")}, ${sqlValue(row.summary || "")}, ${sqlValue(row.source_context_refs_json || "[]")}, ${sqlValue(row.artifact_refs_json || "[]")}, ${sqlValue(row.receipt_refs_json || "[]")}, ${sqlValue(row.payload_json || "{}")}, ${sqlValue(row.created_by || "")}, ${sqlValue(row.created_at || nowIso())}, ${sqlValue(row.updated_at || nowIso())})
ON CONFLICT(handoff_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  node_id=excluded.node_id,
  worker_run_id=excluded.worker_run_id,
  manager_agent=excluded.manager_agent,
  successor_worker_run_id=excluded.successor_worker_run_id,
  handoff_info_id=excluded.handoff_info_id,
  status=excluded.status,
  reason=excluded.reason,
  summary=excluded.summary,
  source_context_refs_json=excluded.source_context_refs_json,
  artifact_refs_json=excluded.artifact_refs_json,
  receipt_refs_json=excluded.receipt_refs_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at;`);
}
