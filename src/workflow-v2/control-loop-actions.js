import fs from "node:fs/promises";
import path from "node:path";
import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  boolOption,
  firstText,
  safeId,
  textHash
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount,
  tableColumns
} from "../workflow/sqlite.js";
import {
  workflowV2ErrorMessage,
  workflowV2JsonObject,
  workflowV2WorkerRunSummary
} from "./helpers.js";

const WORKFLOW_V2_WORKER_RUN_CONTROL_COLUMNS = [
  "worker_run_id",
  "workflow_id",
  "plan_id",
  "node_id",
  "preflight_id",
  "runtime_backend",
  "status",
  "attempt",
  "max_attempts",
  "lease_owner",
  "lease_until",
  "next_retry_at",
  "task_input_info_id",
  "output_info_id",
  "receipt_ref",
  "last_error",
  "started_at",
  "completed_at"
];

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 control loop action dependency missing: ${name}`);
  return value;
}

export function createWorkflowV2ControlLoopActionHandlers(context = {}) {
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const hasAllColumns = requireContextFunction(context, "hasAllColumns");
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowV2AutonomousLoopMaybeTerminalizeNode = requireContextFunction(context, "workflowV2AutonomousLoopMaybeTerminalizeNode");
  const workflowV2CleanupInfoStackItem = requireContextFunction(context, "workflowV2CleanupInfoStackItem");
  const workflowV2InfoStackExistingItem = requireContextFunction(context, "workflowV2InfoStackExistingItem");
  const workflowV2InfoStackRecord = requireContextFunction(context, "workflowV2InfoStackRecord");
  const workflowV2RequireSessionRunPatch = requireContextFunction(context, "workflowV2RequireSessionRunPatch");
  const workflowV2RestoreWorkerRunRow = requireContextFunction(context, "workflowV2RestoreWorkerRunRow");
  const workflowV2WorkerRetryDelayMs = requireContextFunction(context, "workflowV2WorkerRetryDelayMs");
  const writeJsonAtomic = requireContextFunction(context, "writeJsonAtomic");

async function workflowV2WorkerRunControlSchema(dbFile) {
  const workerColumns = await tableColumns(dbFile, "workflow_v2_worker_runs");
  const preflightColumns = await tableColumns(dbFile, "workflow_v2_backend_preflights");
  return {
    ready: hasAllColumns(workerColumns, WORKFLOW_V2_WORKER_RUN_CONTROL_COLUMNS) && hasAllColumns(preflightColumns, ["preflight_id", "workflow_id", "backend_id", "status"]),
    missingWorkerColumns: WORKFLOW_V2_WORKER_RUN_CONTROL_COLUMNS.filter((column) => !workerColumns.has(column)),
    missingPreflightColumns: ["preflight_id", "workflow_id", "backend_id", "status"].filter((column) => !preflightColumns.has(column)),
    workerTableExists: workerColumns.size > 0,
    preflightTableExists: preflightColumns.size > 0
  };
}

function workflowV2WorkerRunScopeClauses(input = {}, alias = "w") {
  const prefix = alias ? `${alias}.` : "";
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  const nodeId = firstText(input.nodeId, input.node_id);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id);
  const clauses = [];
  if (workflowId) clauses.push(`${prefix}workflow_id=${sqlValue(workflowId)}`);
  if (planId) clauses.push(`${prefix}plan_id=${sqlValue(planId)}`);
  if (nodeId) clauses.push(`${prefix}node_id=${sqlValue(nodeId)}`);
  if (workerRunId) clauses.push(`${prefix}worker_run_id=${sqlValue(workerRunId)}`);
  return clauses;
}

function workflowV2WorkerRunScopeClause(input = {}, alias = "w") {
  const clauses = workflowV2WorkerRunScopeClauses(input, alias);
  return clauses.length ? `AND ${clauses.join(" AND ")}` : "";
}

async function workflowV2ControlLoopPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  if (!fileExistsSync(paths.dbFile)) {
    return {
      operation: "workflow.v2.control_loop.preview",
      dryRun: true,
      previewOnly: true,
      status: "skipped",
      reason: "workflow database does not exist",
      generatedAt,
      counts: {},
      runnableWorkers: [],
      dbFile: paths.dbFile
    };
  }
  const schema = await workflowV2WorkerRunControlSchema(paths.dbFile);
  if (!schema.ready) {
    return {
      operation: "workflow.v2.control_loop.preview",
      dryRun: true,
      previewOnly: true,
      status: "schema_gap",
      ok: false,
      generatedAt,
      schema,
      counts: {},
      runnableWorkers: [],
      dbFile: paths.dbFile
    };
  }
  const workerRunScope = workflowV2WorkerRunScopeClause(input, "w");
  const counts = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN w.status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN w.status='retry_scheduled' THEN 1 ELSE 0 END) AS retry_scheduled,
  SUM(CASE WHEN w.status='running' THEN 1 ELSE 0 END) AS running,
  SUM(CASE WHEN w.status='running' AND COALESCE(w.lease_until,'')!='' AND w.lease_until <= ${sqlValue(generatedAt)} THEN 1 ELSE 0 END) AS expired_leases,
  SUM(CASE WHEN w.status='submitted_for_review' THEN 1 ELSE 0 END) AS submitted_for_review,
  SUM(CASE WHEN w.status IN ('accepted','rejected','failed','timed_out','cancelled') THEN 1 ELSE 0 END) AS terminal,
  SUM(CASE WHEN w.status IN ('queued','retry_scheduled') AND (w.next_retry_at='' OR w.next_retry_at <= ${sqlValue(generatedAt)}) THEN 1 ELSE 0 END) AS due,
  SUM(CASE WHEN p.preflight_id IS NULL OR p.workflow_id != w.workflow_id OR p.backend_id != w.runtime_backend OR p.status NOT IN ('pass','warn') THEN 1 ELSE 0 END) AS invalid_preflight
FROM workflow_v2_worker_runs w
LEFT JOIN workflow_v2_backend_preflights p ON p.preflight_id=w.preflight_id
WHERE 1=1 ${workerRunScope};`, { json: true });
  const limit = Math.max(1, Math.min(20, Number(input.limit || 10)));
  const rows = await sqlite(paths.dbFile, `
SELECT w.*
FROM workflow_v2_worker_runs w
JOIN workflow_v2_backend_preflights p ON p.preflight_id=w.preflight_id
WHERE w.status IN ('queued','retry_scheduled')
  AND (w.next_retry_at='' OR w.next_retry_at <= ${sqlValue(generatedAt)})
  AND w.attempt < w.max_attempts
  AND p.workflow_id=w.workflow_id
  AND p.backend_id=w.runtime_backend
  AND p.status IN ('pass','warn')
  ${workerRunScope}
ORDER BY w.updated_at ASC, w.created_at ASC
LIMIT ${limit};`, { json: true });
  return {
    operation: "workflow.v2.control_loop.preview",
    dryRun: true,
    previewOnly: true,
    status: "ok",
    ok: true,
    generatedAt,
    counts: counts[0] || {},
    runnableWorkers: rows.map(workflowV2WorkerRunSummary),
    dbFile: paths.dbFile
  };
}

function workflowV2WorkerLeaseMs(input = {}) {
  const value = Number(input.workerLeaseMs || input.worker_lease_ms || input.leaseMs || input.lease_ms || 60_000);
  return Math.max(1_000, Math.min(30 * 60_000, Number.isFinite(value) ? value : 60_000));
}

async function workflowV2ExpireWorkerLeases(paths, input = {}, generatedAt = nowIso()) {
  const limit = Math.max(1, Math.min(50, Number(input.expireLimit || input.expire_limit || 20)));
  const workerRunScope = workflowV2WorkerRunScopeClause(input, "");
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE status='running'
  AND COALESCE(lease_until,'')!=''
  AND lease_until <= ${sqlValue(generatedAt)}
  ${workerRunScope}
ORDER BY lease_until ASC, updated_at ASC
LIMIT ${limit};`, { json: true });
  const expired = [];
  for (const row of rows) {
    const attempt = Number(row.attempt || 0);
    const maxAttempts = Math.max(1, Number(row.max_attempts || 1));
    const retry = attempt < maxAttempts;
    const status = retry ? "retry_scheduled" : "timed_out";
    const nextRetryAt = retry ? new Date(new Date(generatedAt).getTime() + workflowV2WorkerRetryDelayMs(input, attempt)).toISOString() : "";
    const lastError = "worker lease expired before completion";
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status=${sqlValue(status)},
    lease_owner='',
    lease_until='',
    next_retry_at=${sqlValue(nextRetryAt)},
    last_error=${sqlValue(lastError)},
    completed_at=${sqlValue(retry ? "" : generatedAt)},
    updated_at=${sqlValue(generatedAt)}
WHERE worker_run_id=${sqlValue(row.worker_run_id)}
  AND status='running'
  AND lease_owner=${sqlValue(row.lease_owner || "")}
  AND lease_until=${sqlValue(row.lease_until || "")}
  ${workerRunScope};`);
    if (changed !== 1) {
      expired.push({ workerRunId: row.worker_run_id, status: "lease_lost" });
      continue;
    }
    try {
      await workflowV2RequireSessionRunPatch(paths, row.session_run_id || "", {
        status: retry ? "queued" : "failed",
        error: lastError,
        timestamp: generatedAt
      }, "worker lease expiry");
      const closedAdapterJobs = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status='cancelled',
    lease_owner='',
    lease_until='',
    runner_id='',
    next_retry_at='',
    last_error=${sqlValue(lastError)},
    completed_at=${sqlValue(generatedAt)},
    updated_at=${sqlValue(generatedAt)}
WHERE worker_run_id=${sqlValue(row.worker_run_id)}
  AND worker_attempt=${sqlValue(attempt)}
  AND status IN ('queued','retry_scheduled','running');`);
      expired.push({ workerRunId: row.worker_run_id, status, attempt, maxAttempts, nextRetryAt, lastError, closedAdapterJobs });
    } catch (error) {
      await workflowV2RestoreWorkerRunRow(paths, row);
      expired.push({ workerRunId: row.worker_run_id, status: "session_sync_failed", error: workflowV2ErrorMessage(error) });
    }
  }
  return expired;
}

async function workflowV2ClaimWorkerRuns(paths, input = {}, generatedAt = nowIso()) {
  const owner = firstText(input.claimOwner, input.claim_owner, input.owner, input.leaseOwner, input.lease_owner) || `pid:${process.pid}:${safeId("v2-claim")}`;
  const limit = Math.max(1, Math.min(20, Number(input.workerLimit || input.worker_limit || input.limit || 4)));
  const leaseUntil = new Date(new Date(generatedAt).getTime() + workflowV2WorkerLeaseMs(input)).toISOString();
  const workerRunScope = workflowV2WorkerRunScopeClause(input, "w");
  const updateWorkerRunScope = workflowV2WorkerRunScopeClause(input, "");
  const rows = await sqlite(paths.dbFile, `
SELECT w.*
FROM workflow_v2_worker_runs w
JOIN workflow_v2_backend_preflights p ON p.preflight_id=w.preflight_id
WHERE w.status IN ('queued','retry_scheduled')
  AND (w.next_retry_at='' OR w.next_retry_at <= ${sqlValue(generatedAt)})
  AND w.attempt < w.max_attempts
  AND p.workflow_id=w.workflow_id
  AND p.backend_id=w.runtime_backend
  AND p.status IN ('pass','warn')
  ${workerRunScope}
ORDER BY w.updated_at ASC, w.created_at ASC
LIMIT ${limit};`, { json: true });
  const claimed = [];
  const claimErrors = [];
  for (const row of rows) {
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status='running',
    attempt=attempt+1,
    lease_owner=${sqlValue(owner)},
    lease_until=${sqlValue(leaseUntil)},
    next_retry_at='',
    started_at=CASE WHEN started_at='' THEN ${sqlValue(generatedAt)} ELSE started_at END,
    updated_at=${sqlValue(generatedAt)}
WHERE worker_run_id=${sqlValue(row.worker_run_id)}
  AND status IN ('queued','retry_scheduled')
  AND (next_retry_at='' OR next_retry_at <= ${sqlValue(generatedAt)})
  AND attempt < max_attempts
  AND EXISTS (
    SELECT 1
    FROM workflow_v2_backend_preflights p
    WHERE p.preflight_id=workflow_v2_worker_runs.preflight_id
      AND p.workflow_id=workflow_v2_worker_runs.workflow_id
      AND p.backend_id=workflow_v2_worker_runs.runtime_backend
      AND p.status IN ('pass','warn')
  )
  ${updateWorkerRunScope};`);
    if (changed !== 1) continue;
    const latest = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(row.worker_run_id)} AND status='running' AND lease_owner=${sqlValue(owner)} LIMIT 1;`, { json: true });
    if (latest[0]) {
      try {
        await workflowV2RequireSessionRunPatch(paths, latest[0].session_run_id || "", {
          status: "running",
          timestamp: generatedAt
        }, "worker claim");
        claimed.push(latest[0]);
      } catch (error) {
        await workflowV2RestoreWorkerRunRow(paths, row);
        claimErrors.push({ workerRunId: row.worker_run_id, status: "session_sync_failed", error: workflowV2ErrorMessage(error) });
      }
    }
  }
  return { claimed, claimErrors };
}

async function workflowV2ExecuteDeterministicWorker(paths, row = {}, input = {}, generatedAt = nowIso()) {
  if (row.runtime_backend !== "local_deterministic") {
    return { workerRunId: row.worker_run_id, status: "leased_waiting_adapter", runtimeBackend: row.runtime_backend };
  }
  const payload = workflowV2JsonObject(row.payload_json, {});
  const outputInfoId = firstText(row.output_info_id, `${row.worker_run_id}.output`);
  const summary = firstText(payload.outputSummary, payload.output_summary, input.outputSummary, input.output_summary, `Deterministic local worker output for ${row.worker_run_id}`);
  const artifactDir = path.join(paths.artifactsDir, "workflow-v2", cleanFileSegment(row.workflow_id || "workflow"), "worker-runs");
  const artifactFile = path.join(artifactDir, `${cleanFileSegment(row.worker_run_id)}.deterministic-output.json`);
  const outputInfoExisting = await workflowV2InfoStackExistingItem(paths.dbFile, outputInfoId);
  const artifactPayload = {
    schemaVersion: "workflow_v2_local_deterministic_output.v1",
    generatedAt,
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    nodeId: row.node_id || "",
    workerRunId: row.worker_run_id || "",
    managerAgent: row.manager_agent || "",
    workerAgentId: row.worker_agent_id || "",
    sessionId: row.session_id || "",
    sessionRunId: row.session_run_id || "",
    runtimeBackend: row.runtime_backend || "",
    attempt: Number(row.attempt || 0),
    taskInputInfoId: row.task_input_info_id || "",
    summary,
    deterministic: true
  };
  await fs.mkdir(artifactDir, { recursive: true });
  await writeJsonAtomic(artifactFile, artifactPayload);
  const artifactRef = `artifact://workflow-v2/${cleanFileSegment(row.workflow_id || "workflow")}/worker-runs/${cleanFileSegment(row.worker_run_id)}.deterministic-output.json`;
  await workflowV2InfoStackRecord(paths.root, {
    workflowId: row.workflow_id,
    planId: row.plan_id,
    nodeId: row.node_id,
    workerRunId: row.worker_run_id,
    infoId: outputInfoId,
    classification: "internal",
    contentStorage: "artifact_ref",
    artifactRef,
    recipientAgent: row.manager_agent,
    summary,
    payload: {
      runner: "local_deterministic",
      artifactFile,
      generatedAt,
      taskInputInfoId: row.task_input_info_id || ""
    }
  });
  const receiptRef = `receipt://workflow-v2/${row.worker_run_id}/local-deterministic/${textHash(JSON.stringify(artifactPayload)).slice(0, 16)}`;
  const nextPayload = {
    ...payload,
    localDeterministic: {
      outputInfoId,
      artifactRef,
      artifactFile,
      receiptRef,
      generatedAt
    }
  };
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status='submitted_for_review',
    output_info_id=${sqlValue(outputInfoId)},
    receipt_ref=${sqlValue(receiptRef)},
    lease_owner='',
    lease_until='',
    payload_json=${sqlValue(JSON.stringify(nextPayload))},
    completed_at=${sqlValue(generatedAt)},
    updated_at=${sqlValue(generatedAt)}
WHERE worker_run_id=${sqlValue(row.worker_run_id)}
  AND status='running'
  AND lease_owner=${sqlValue(row.lease_owner || "")}
  AND lease_until=${sqlValue(row.lease_until || "")};`);
  if (changed !== 1) {
    if (!outputInfoExisting) await workflowV2CleanupInfoStackItem(paths.dbFile, outputInfoId);
    await fs.rm(artifactFile, { force: true });
    return { workerRunId: row.worker_run_id, status: "lease_lost" };
  }
  try {
    await workflowV2RequireSessionRunPatch(paths, row.session_run_id || "", {
      status: "completed",
      output: {
        outputInfoId,
        artifactRef,
        artifactFile,
        receiptRef,
        runtimeBackend: row.runtime_backend || "",
        deterministic: true
      },
      receiptRef,
      timestamp: generatedAt
    }, "deterministic worker completion");
  } catch (error) {
    await workflowV2RestoreWorkerRunRow(paths, row);
    if (!outputInfoExisting) await workflowV2CleanupInfoStackItem(paths.dbFile, outputInfoId);
    await fs.rm(artifactFile, { force: true });
    return { workerRunId: row.worker_run_id, status: "session_sync_failed", error: workflowV2ErrorMessage(error) };
  }
  const autonomousLoop = await workflowV2AutonomousLoopMaybeTerminalizeNode(paths, {
    ...row,
    output_info_id: outputInfoId,
    receipt_ref: receiptRef,
    payload_json: JSON.stringify(nextPayload)
  }, {
    ...input,
    outputInfoId,
    receiptRef
  }, generatedAt);
  return {
    workerRunId: row.worker_run_id,
    status: "submitted_for_review",
    outputInfoId,
    artifactRef,
    artifactFile,
    receiptRef,
    autonomousLoop
  };
}

async function workflowV2ControlLoopTick(rootDir, input = {}) {
  if (boolOption(input.dryRun ?? input.dry_run, false)) {
    return workflowV2ControlLoopPreview(rootDir, input);
  }
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const schema = await workflowV2WorkerRunControlSchema(paths.dbFile);
  if (!schema.ready) {
    return {
      operation: "workflow.v2.control_loop.tick",
      status: "schema_gap",
      ok: false,
      generatedAt,
      schema,
      expiredLeases: [],
      claimedWorkers: [],
      workerResults: [],
      dbFile: paths.dbFile
    };
  }
  const expiredLeases = await workflowV2ExpireWorkerLeases(paths, input, generatedAt);
  const claimResult = await workflowV2ClaimWorkerRuns(paths, input, generatedAt);
  const claimed = claimResult.claimed || [];
  const workerResults = [];
  for (const errorResult of claimResult.claimErrors || []) {
    workerResults.push(errorResult);
  }
  for (const row of claimed) {
    try {
      workerResults.push(await workflowV2ExecuteDeterministicWorker(paths, row, input, generatedAt));
    } catch (error) {
      workerResults.push({ workerRunId: row.worker_run_id || "", status: "worker_execution_failed", error: workflowV2ErrorMessage(error) });
    }
  }
  const after = await workflowV2ControlLoopPreview(rootDir, { ...input, generatedAt });
  return {
    operation: "workflow.v2.control_loop.tick",
    status: "ok",
    ok: true,
    dryRun: false,
    previewOnly: false,
    generatedAt,
    expiredLeases,
    claimedWorkers: claimed.map(workflowV2WorkerRunSummary),
    workerResults,
    counts: after.counts || {},
    dbFile: paths.dbFile
  };
}

  return {
    workflowV2ControlLoopPreview,
    workflowV2ControlLoopTick
  };
}
