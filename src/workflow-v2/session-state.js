import {
  firstText,
  jsonHash
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";
import {
  isTerminalWorkflowSessionRunStatus,
  requireWorkflowSessionRunStatus,
  sessionJsonObject,
  sessionPackFromRow,
  sessionRunFromRow
} from "../session-actions.js";
import {
  workflowV2ErrorMessage
} from "./helpers.js";

function nowIso() {
  return new Date().toISOString();
}

function sessionStateDependencies(deps = {}) {
  if (typeof deps.workflowTaskPhaseInfo !== "function") {
    throw new Error("workflow v2 session state dependency missing: workflowTaskPhaseInfo");
  }
  if (typeof deps.upsertWorkflowAgentRun !== "function") {
    throw new Error("workflow v2 session state dependency missing: upsertWorkflowAgentRun");
  }
  return {
    workflowTaskPhaseInfo: deps.workflowTaskPhaseInfo,
    upsertWorkflowAgentRun: deps.upsertWorkflowAgentRun
  };
}

export async function workflowV2RestoreSessionRunRow(paths, row = {}) {
  if (!row?.run_id) return;
  await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET session_id=${sqlValue(row.session_id || "")},
    pack_version=${sqlValue(Number(row.pack_version || 0))},
    workflow_id=${sqlValue(row.workflow_id || "")},
    task_id=${sqlValue(row.task_id || "")},
    dispatch_id=${sqlValue(row.dispatch_id || "")},
    worker_id=${sqlValue(row.worker_id || "")},
    status=${sqlValue(row.status || "")},
    input_json=${sqlValue(row.input_json || "{}")},
    worker_input_json=${sqlValue(row.worker_input_json || "{}")},
    output_json=${sqlValue(row.output_json || "{}")},
    receipt_ref=${sqlValue(row.receipt_ref || "")},
    error=${sqlValue(row.error || "")},
    started_at=${sqlValue(row.started_at || "")},
    completed_at=${sqlValue(row.completed_at || "")},
    created_at=${sqlValue(row.created_at || nowIso())},
    updated_at=${sqlValue(row.updated_at || nowIso())}
WHERE run_id=${sqlValue(row.run_id)};`);
}

export async function workflowV2PatchSessionRunState(paths, runId = "", patch = {}, deps = {}) {
  if (!runId) return null;
  const { workflowTaskPhaseInfo, upsertWorkflowAgentRun } = sessionStateDependencies(deps);
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_session_runs
WHERE run_id=${sqlValue(runId)}
LIMIT 1;`, { json: true });
  const current = sessionRunFromRow(rows[0]);
  if (!current) return null;
  const timestamp = firstText(patch.timestamp, patch.updatedAt, patch.updated_at, nowIso());
  const status = requireWorkflowSessionRunStatus(patch.status || current.status, current.status);
  const output = patch.output !== undefined ? sessionJsonObject(patch.output) : current.output;
  const receiptRef = patch.receiptRef !== undefined || patch.receipt_ref !== undefined ? firstText(patch.receiptRef, patch.receipt_ref) : current.receiptRef;
  const errorText = patch.error !== undefined ? String(patch.error || "") : current.error;
  const startedAt = status === "running" && !current.startedAt ? timestamp : current.startedAt;
  const completedAt = isTerminalWorkflowSessionRunStatus(status) ? (current.completedAt || timestamp) : "";
  await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET status=${sqlValue(status)},
    output_json=${sqlValue(JSON.stringify(output))},
    receipt_ref=${sqlValue(receiptRef)},
    error=${sqlValue(errorText)},
    started_at=${sqlValue(startedAt)},
    completed_at=${sqlValue(completedAt)},
    updated_at=${sqlValue(timestamp)}
WHERE run_id=${sqlValue(runId)};`);
  const packRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(current.sessionId)} LIMIT 1;`, { json: true });
  const pack = sessionPackFromRow(packRows[0]) || {};
  const phaseInfo = await workflowTaskPhaseInfo(paths, current.workflowId, current.taskId);
  let agentRunSyncError = "";
  try {
    await upsertWorkflowAgentRun(paths, {
      agentRunId: `session.${runId}`,
      workflowId: current.workflowId,
      phaseId: phaseInfo.phaseId,
      phaseKey: phaseInfo.phaseKey,
      taskId: current.taskId,
      dispatchId: current.dispatchId,
      sessionRunId: runId,
      runtime: pack.runtimeTarget || "session_pack",
      agentId: current.workerId || pack.ownerAgent || "",
      status,
      inputHash: jsonHash(current.input),
      outputHash: jsonHash(output),
      receiptRef,
      error: errorText,
      payload: { source: "workflow_session_runs", sessionId: current.sessionId, packVersion: current.packVersion, v2Patch: true },
      startedAt,
      completedAt,
      updatedAt: timestamp
    });
  } catch (error) {
    agentRunSyncError = workflowV2ErrorMessage(error);
  }
  const updatedRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
  const updated = sessionRunFromRow(updatedRows[0]);
  return updated ? { ...updated, agentRunSyncError } : null;
}

export async function workflowV2RequireSessionRunPatch(paths, runId = "", patch = {}, context = "worker lifecycle", deps = {}) {
  const sessionRun = await workflowV2PatchSessionRunState(paths, runId, patch, deps);
  if (!sessionRun) {
    throw new Error(`workflow v2 session run patch failed: ${context} session_run_id=${runId || ""}`);
  }
  return sessionRun;
}

export function workflowV2WorkerRetryDelayMs(input = {}, attempt = 1) {
  const value = Number(input.retryDelayMs || input.retry_delay_ms || 5_000 * Math.max(1, attempt));
  return Math.max(0, Math.min(30 * 60_000, Number.isFinite(value) ? value : 5_000));
}
