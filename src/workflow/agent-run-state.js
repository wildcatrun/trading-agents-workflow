import {
  sqlValue,
  sqlite
} from "./sqlite.js";

function nowIso() {
  return new Date().toISOString();
}

function cleanFileSegment(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "item";
}

export function workflowPhaseRecordId(workflowId, phaseKey) {
  return `phase.${cleanFileSegment(workflowId || "workflow")}.${cleanFileSegment(phaseKey || "unphased")}`;
}

export async function workflowTaskPhaseInfo(paths, workflowId, taskId, fallbackPhase = "") {
  const phaseKey = String(fallbackPhase || "").trim();
  if (!workflowId || !taskId) return { phaseKey, phaseId: phaseKey ? workflowPhaseRecordId(workflowId, phaseKey) : "" };
  const rows = await sqlite(paths.dbFile, `
SELECT phase FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)} AND task_id=${sqlValue(taskId)}
LIMIT 1;`, { json: true });
  const key = rows[0]?.phase || phaseKey;
  return { phaseKey: key || "", phaseId: key ? workflowPhaseRecordId(workflowId, key) : "" };
}

export async function upsertWorkflowAgentRun(paths, run = {}) {
  const now = run.updatedAt || nowIso();
  const agentRunId = run.agentRunId || run.agent_run_id || "";
  if (!agentRunId) return null;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_agent_runs(agent_run_id, workflow_id, phase_id, phase_key, task_id, dispatch_id, runtime_run_id, session_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref, error, payload_json, started_at, completed_at, created_at, updated_at)
VALUES (${sqlValue(agentRunId)}, ${sqlValue(run.workflowId || "")}, ${sqlValue(run.phaseId || "")}, ${sqlValue(run.phaseKey || "")}, ${sqlValue(run.taskId || "")}, ${sqlValue(run.dispatchId || "")}, ${sqlValue(run.runtimeRunId || "")}, ${sqlValue(run.sessionRunId || "")}, ${sqlValue(run.runtime || "")}, ${sqlValue(run.agentId || "")}, ${sqlValue(run.status || "unknown")}, ${Number(run.attempt || 0)}, ${sqlValue(run.inputHash || "")}, ${sqlValue(run.outputHash || "")}, ${sqlValue(run.receiptRef || "")}, ${sqlValue(String(run.error || "").slice(0, 2000))}, ${sqlValue(JSON.stringify(run.payload || {}))}, ${sqlValue(run.startedAt || "")}, ${sqlValue(run.completedAt || "")}, ${sqlValue(run.createdAt || now)}, ${sqlValue(now)})
ON CONFLICT(agent_run_id) DO UPDATE SET
  workflow_id=COALESCE(NULLIF(excluded.workflow_id, ''), workflow_agent_runs.workflow_id),
  phase_id=COALESCE(NULLIF(excluded.phase_id, ''), workflow_agent_runs.phase_id),
  phase_key=COALESCE(NULLIF(excluded.phase_key, ''), workflow_agent_runs.phase_key),
  task_id=COALESCE(NULLIF(excluded.task_id, ''), workflow_agent_runs.task_id),
  dispatch_id=COALESCE(NULLIF(excluded.dispatch_id, ''), workflow_agent_runs.dispatch_id),
  runtime_run_id=COALESCE(NULLIF(excluded.runtime_run_id, ''), workflow_agent_runs.runtime_run_id),
  session_run_id=COALESCE(NULLIF(excluded.session_run_id, ''), workflow_agent_runs.session_run_id),
  runtime=COALESCE(NULLIF(excluded.runtime, ''), workflow_agent_runs.runtime),
  agent_id=COALESCE(NULLIF(excluded.agent_id, ''), workflow_agent_runs.agent_id),
  status=excluded.status,
  attempt=excluded.attempt,
  input_hash=COALESCE(NULLIF(excluded.input_hash, ''), workflow_agent_runs.input_hash),
  output_hash=COALESCE(NULLIF(excluded.output_hash, ''), workflow_agent_runs.output_hash),
  receipt_ref=COALESCE(NULLIF(excluded.receipt_ref, ''), workflow_agent_runs.receipt_ref),
  error=COALESCE(NULLIF(excluded.error, ''), workflow_agent_runs.error),
  payload_json=excluded.payload_json,
  started_at=COALESCE(NULLIF(excluded.started_at, ''), workflow_agent_runs.started_at),
  completed_at=COALESCE(NULLIF(excluded.completed_at, ''), workflow_agent_runs.completed_at),
  updated_at=excluded.updated_at;`);
  return agentRunId;
}
