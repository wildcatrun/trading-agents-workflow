import {
  firstText
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount
} from "../workflow/sqlite.js";
import {
  workflowV2AdapterJobSummary,
  workflowV2NonNegativeInt
} from "./helpers.js";

function nowIso() {
  return new Date().toISOString();
}

export async function workflowV2AdapterJobById(dbFile, adapterJobId = "") {
  if (!adapterJobId) return null;
  const rows = await sqlite(dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
WHERE adapter_job_id=${sqlValue(adapterJobId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function workflowV2MarkAdapterJobTerminal(paths, input = {}, workerRunId = "", status = "completed", timestamp = nowIso(), expectedWorkerAttempt = 0) {
  const adapterJobId = firstText(input.adapterJobId, input.adapter_job_id);
  if (!adapterJobId && !workerRunId) return null;
  const runnerLeaseOwner = firstText(
    input.adapterJobLeaseOwner,
    input.adapter_job_lease_owner,
    input.runnerLeaseOwner,
    input.runner_lease_owner,
    input.runnerId,
    input.runner_id
  );
  const runnerLeaseUntil = firstText(
    input.adapterJobLeaseUntil,
    input.adapter_job_lease_until,
    input.runnerLeaseUntil,
    input.runner_lease_until
  );
  const workerAttempt = workflowV2NonNegativeInt(input.workerAttempt ?? input.worker_attempt ?? expectedWorkerAttempt, 0);
  const receiptRef = firstText(input.runnerReceiptRef, input.runner_receipt_ref, input.receiptRef, input.receipt_ref);
  const errorMessage = firstText(input.error, input.errorMessage, input.error_message);
  const clauses = adapterJobId
    ? [`adapter_job_id=${sqlValue(adapterJobId)}`]
    : [`worker_run_id=${sqlValue(workerRunId)}`, "status='running'"];
  if (workerRunId) clauses.push(`worker_run_id=${sqlValue(workerRunId)}`);
  if (workerAttempt > 0) clauses.push(`worker_attempt=${sqlValue(workerAttempt)}`);
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
WHERE ${clauses.join(" AND ")}
ORDER BY updated_at DESC
LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) {
    if (adapterJobId) throw new Error("workflow v2 adapter job terminal update found no matching running job");
    return null;
  }
  const errors = [];
  if (row.status !== "running") errors.push(`adapter_job_not_running:${row.status || ""}`);
  if (workerRunId && row.worker_run_id !== workerRunId) errors.push("worker_run_mismatch");
  if (workerAttempt > 0 && Number(row.worker_attempt || 0) !== workerAttempt) errors.push("worker_attempt_mismatch");
  if (!runnerLeaseOwner) errors.push("adapter_job_lease_owner_required");
  if (!runnerLeaseUntil) errors.push("adapter_job_lease_until_required");
  if (runnerLeaseOwner && row.lease_owner !== runnerLeaseOwner) errors.push("adapter_job_lease_owner_mismatch");
  if (runnerLeaseUntil && row.lease_until !== runnerLeaseUntil) errors.push("adapter_job_lease_until_mismatch");
  const adapterLeaseMs = Date.parse(row.lease_until || "");
  const timestampMs = Date.parse(timestamp || "");
  if (!Number.isFinite(adapterLeaseMs) || !Number.isFinite(timestampMs) || adapterLeaseMs <= timestampMs) errors.push("adapter_job_lease_expired");
  if (errors.length) throw new Error(`workflow v2 adapter job terminal update blocked: ${errors.join(",")}`);
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status=${sqlValue(status)},
    lease_owner='',
    lease_until='',
    runner_id='',
    next_retry_at='',
    runner_receipt_ref=${sqlValue(receiptRef)},
    last_error=${sqlValue(status === "failed" ? errorMessage : row.last_error || "")},
    completed_at=${sqlValue(timestamp)},
    updated_at=${sqlValue(timestamp)}
WHERE adapter_job_id=${sqlValue(row.adapter_job_id)}
  AND status='running'
  AND worker_run_id=${sqlValue(workerRunId || row.worker_run_id || "")}
  AND worker_attempt=${sqlValue(Number(row.worker_attempt || 0))}
  AND lease_owner=${sqlValue(runnerLeaseOwner)}
  AND lease_until=${sqlValue(runnerLeaseUntil)}
  AND lease_until > ${sqlValue(timestamp)};`);
  if (changed !== 1) throw new Error("workflow v2 adapter job terminal update lost runner lease before update");
  const updated = await workflowV2AdapterJobById(paths.dbFile, row.adapter_job_id);
  return { changed, job: workflowV2AdapterJobSummary(updated) };
}
