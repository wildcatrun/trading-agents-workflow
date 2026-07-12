import {
  boolOption,
  firstText,
  textHash
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount
} from "../workflow/sqlite.js";
import {
  workflowV2JsonObject,
  workflowV2ValidationError,
  workflowV2WorkerRunSummary
} from "./helpers.js";
import {
  workflowV2LeaseCheckAt,
  workflowV2LeaseErrors,
  workflowV2LoadWorkerRunForResult,
  workflowV2RestoreWorkerRunRow
} from "./worker-state.js";
import {
  workflowV2MarkAdapterJobTerminal
} from "./adapter-job-state.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 worker result action dependency missing: ${name}`);
  return value;
}

export function createWorkflowV2WorkerResultActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowV2AutonomousLoopMaybeTerminalizeNode = requireContextFunction(context, "workflowV2AutonomousLoopMaybeTerminalizeNode");
  const workflowV2CleanupInfoStackItem = requireContextFunction(context, "workflowV2CleanupInfoStackItem");
  const workflowV2InfoStackExistingItem = requireContextFunction(context, "workflowV2InfoStackExistingItem");
  const workflowV2InfoStackPreview = requireContextFunction(context, "workflowV2InfoStackPreview");
  const workflowV2InfoStackRecord = requireContextFunction(context, "workflowV2InfoStackRecord");
  const workflowV2RequireSessionRunPatch = requireContextFunction(context, "workflowV2RequireSessionRunPatch");
  const workflowV2RestoreSessionRunRow = requireContextFunction(context, "workflowV2RestoreSessionRunRow");
  const workflowV2WorkerRetryDelayMs = requireContextFunction(context, "workflowV2WorkerRetryDelayMs");

function workflowV2ReceiptRefForResult(row = {}, input = {}, resultKind = "submit") {
  const explicit = firstText(input.receiptRef, input.receipt_ref);
  if (explicit) return explicit;
  const receipt = workflowV2JsonObject(input.receipt ?? input.runtimeReceipt ?? input.runtime_receipt, {});
  if (Object.keys(receipt).length === 0) return "";
  const digest = textHash(JSON.stringify({ workerRunId: row.worker_run_id || "", resultKind, receipt })).slice(0, 16);
  return `receipt://workflow-v2/${row.worker_run_id || "worker"}/${resultKind}/${digest}`;
}

async function workflowV2WorkerResultSubmitPreview(rootDir, input = {}) {
  const { paths, row, errors } = await workflowV2LoadWorkerRunForResult(rootDir, input);
  if (row) errors.push(...workflowV2LeaseErrors(row, input));
  const leaseCheckAt = workflowV2LeaseCheckAt(input);
  const outputInfoId = firstText(input.outputInfoId, input.output_info_id, row?.output_info_id, `${row?.worker_run_id || "worker"}.output`);
  const receiptRef = row ? workflowV2ReceiptRefForResult(row, input, "submit") : firstText(input.receiptRef, input.receipt_ref);
  if (!receiptRef) errors.push(workflowV2ValidationError("receipt_ref_required", "worker result submit requires receiptRef or receipt evidence"));
  const outputInfoExisting = row ? await workflowV2InfoStackExistingItem(paths.dbFile, outputInfoId) : null;
  if (row && outputInfoExisting && (
    outputInfoExisting.workflow_id !== row.workflow_id
    || outputInfoExisting.worker_run_id !== row.worker_run_id
    || row.output_info_id !== outputInfoId
  )) {
    errors.push(workflowV2ValidationError("output_info_id_conflict", "worker result outputInfoId already exists outside the current worker output binding", {
      outputInfoId,
      existingWorkflowId: outputInfoExisting.workflow_id || "",
      existingWorkerRunId: outputInfoExisting.worker_run_id || "",
      currentWorkerOutputInfoId: row.output_info_id || ""
    }));
  }
  let infoPreview = null;
  if (row) {
    infoPreview = await workflowV2InfoStackPreview(rootDir, {
      ...input,
      workflowId: row.workflow_id,
      planId: row.plan_id,
      nodeId: row.node_id,
      workerRunId: row.worker_run_id,
      infoId: outputInfoId,
      recipientAgent: row.manager_agent,
      classification: input.classification || "internal",
      contentStorage: input.contentStorage || input.content_storage || "artifact_ref",
      summary: firstText(input.summary, input.outputSummary, input.output_summary, `Worker output for ${row.worker_run_id}`)
    });
    errors.push(...infoPreview.errors);
  }
  return {
    operation: "workflow.v2.worker_result.submit.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    workerRun: row ? workflowV2WorkerRunSummary(row) : null,
    outputInfoId,
    outputInfoExisting,
    leaseCheckAt,
    receiptRef,
    infoPreview,
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2WorkerResultSubmit(rootDir, input = {}) {
  const preview = await workflowV2WorkerResultSubmitPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 worker result submit is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = workflowV2LeaseCheckAt(input);
  const row = preview.workerRun;
  const receipt = workflowV2JsonObject(input.receipt ?? input.runtimeReceipt ?? input.runtime_receipt, {});
  const rawRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(row.workerRunId)} LIMIT 1;`, { json: true });
  const rawRow = rawRows[0] || {};
  const rawSessionRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(row.sessionRunId || "")} LIMIT 1;`, { json: true });
  const rawSessionRow = rawSessionRows[0] || null;
  const outputInfo = await workflowV2InfoStackRecord(paths.root, {
    ...input,
    workflowId: row.workflowId,
    planId: row.planId,
    nodeId: row.nodeId,
    workerRunId: row.workerRunId,
    infoId: preview.outputInfoId,
    recipientAgent: row.managerAgent,
    classification: input.classification || "internal",
    contentStorage: input.contentStorage || input.content_storage || "artifact_ref",
    summary: firstText(input.summary, input.outputSummary, input.output_summary, `Worker output for ${row.workerRunId}`)
  });
  const payload = workflowV2JsonObject(input.payload, {});
  const currentRows = await sqlite(paths.dbFile, `
SELECT payload_json
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(row.workerRunId)}
LIMIT 1;`, { json: true });
  const currentPayload = workflowV2JsonObject(currentRows[0]?.payload_json, {});
  const nextPayload = {
    ...currentPayload,
    adapterResult: {
      submittedAt: now,
      receiptRef: preview.receiptRef,
      outputInfoId: preview.outputInfoId,
      receipt,
      payload
    }
  };
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status='submitted_for_review',
    output_info_id=${sqlValue(preview.outputInfoId)},
    receipt_ref=${sqlValue(preview.receiptRef)},
    lease_owner='',
    lease_until='',
    next_retry_at='',
    payload_json=${sqlValue(JSON.stringify(nextPayload))},
    completed_at=${sqlValue(now)},
    updated_at=${sqlValue(now)}
WHERE worker_run_id=${sqlValue(row.workerRunId)}
  AND status='running'
  AND lease_owner=${sqlValue(row.leaseOwner)}
  AND lease_until=${sqlValue(row.leaseUntil)}
  AND lease_until > ${sqlValue(preview.leaseCheckAt)};`);
  if (changed !== 1) {
    if (!preview.outputInfoExisting) {
      await workflowV2CleanupInfoStackItem(paths.dbFile, preview.outputInfoId);
    }
    throw new Error("workflow v2 worker result submit lost lease before update");
  }
  let adapterJobUpdate = null;
  try {
    await workflowV2RequireSessionRunPatch(paths, row.sessionRunId || "", {
      status: "completed",
      output: {
        outputInfoId: preview.outputInfoId,
        receiptRef: preview.receiptRef,
        runtimeBackend: row.runtimeBackend || "",
        adapterResult: true
      },
      receiptRef: preview.receiptRef,
      timestamp: now
    }, "adapter worker submit");
    adapterJobUpdate = await workflowV2MarkAdapterJobTerminal(paths, input, row.workerRunId, "completed", now, row.attempt);
  } catch (error) {
    await workflowV2RestoreWorkerRunRow(paths, rawRow);
    if (rawSessionRow) await workflowV2RestoreSessionRunRow(paths, rawSessionRow);
    if (!preview.outputInfoExisting) {
      await workflowV2CleanupInfoStackItem(paths.dbFile, preview.outputInfoId);
    }
    throw error;
  }
  const autonomousLoop = await workflowV2AutonomousLoopMaybeTerminalizeNode(paths, {
    ...rawRow,
    output_info_id: preview.outputInfoId,
    receipt_ref: preview.receiptRef,
    payload_json: JSON.stringify(nextPayload)
  }, {
    ...input,
    outputInfoId: preview.outputInfoId,
    receiptRef: preview.receiptRef
  }, now);
  return {
    ...preview,
    operation: "workflow.v2.worker_result.submit",
    dryRun: false,
    previewOnly: false,
    outputInfo: outputInfo.infoItem,
    adapterJobUpdate,
    autonomousLoop,
    dbFile: paths.dbFile
  };
}

async function workflowV2WorkerResultFailPreview(rootDir, input = {}) {
  const { paths, row, errors } = await workflowV2LoadWorkerRunForResult(rootDir, input);
  if (row) errors.push(...workflowV2LeaseErrors(row, input));
  const leaseCheckAt = workflowV2LeaseCheckAt(input);
  const failureType = firstText(input.failureType, input.failure_type, "runtime_failure");
  const errorMessage = firstText(input.error, input.errorMessage, input.error_message, input.summary);
  if (!errorMessage) errors.push(workflowV2ValidationError("error_required", "worker result fail requires error/errorMessage"));
  const attempt = Number(row?.attempt || 0);
  const maxAttempts = Math.max(1, Number(row?.max_attempts || 1));
  const retryAllowed = boolOption(input.retryAllowed ?? input.retry_allowed, true);
  const retry = Boolean(row) && retryAllowed && attempt < maxAttempts;
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const nextRetryAt = retry ? new Date(new Date(generatedAt).getTime() + workflowV2WorkerRetryDelayMs(input, attempt)).toISOString() : "";
  return {
    operation: "workflow.v2.worker_result.fail.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    workerRun: row ? workflowV2WorkerRunSummary(row) : null,
    leaseCheckAt,
    failureType,
    errorMessage,
    retry,
    nextStatus: retry ? "retry_scheduled" : "failed",
    nextRetryAt,
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2WorkerResultFail(rootDir, input = {}) {
  const preview = await workflowV2WorkerResultFailPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 worker result fail is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const row = preview.workerRun;
  const now = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const payload = workflowV2JsonObject(input.payload, {});
  const rawRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(row.workerRunId)} LIMIT 1;`, { json: true });
  const rawRow = rawRows[0] || {};
  const rawSessionRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(row.sessionRunId || "")} LIMIT 1;`, { json: true });
  const rawSessionRow = rawSessionRows[0] || null;
  const currentPayload = workflowV2JsonObject(rawRow.payload_json, {});
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status=${sqlValue(preview.nextStatus)},
    lease_owner='',
    lease_until='',
    next_retry_at=${sqlValue(preview.nextRetryAt)},
    last_error=${sqlValue(preview.errorMessage)},
    payload_json=${sqlValue(JSON.stringify({
      ...currentPayload,
      adapterFailure: {
        failedAt: now,
        failureType: preview.failureType,
        error: preview.errorMessage,
        retry: preview.retry,
        payload
      }
    }))},
    completed_at=${sqlValue(preview.retry ? "" : now)},
    updated_at=${sqlValue(now)}
WHERE worker_run_id=${sqlValue(row.workerRunId)}
  AND status='running'
  AND lease_owner=${sqlValue(row.leaseOwner)}
  AND lease_until=${sqlValue(row.leaseUntil)}
  AND lease_until > ${sqlValue(preview.leaseCheckAt)};`);
  if (changed !== 1) throw new Error("workflow v2 worker result fail lost lease before update");
  let adapterJobUpdate = null;
  try {
    await workflowV2RequireSessionRunPatch(paths, row.sessionRunId || "", {
      status: preview.retry ? "queued" : "failed",
      error: preview.errorMessage,
      timestamp: now
    }, "adapter worker failure");
    adapterJobUpdate = await workflowV2MarkAdapterJobTerminal(paths, input, row.workerRunId, "failed", now, row.attempt);
  } catch (error) {
    await workflowV2RestoreWorkerRunRow(paths, rawRow);
    if (rawSessionRow) await workflowV2RestoreSessionRunRow(paths, rawSessionRow);
    throw error;
  }
  return {
    ...preview,
    operation: "workflow.v2.worker_result.fail",
    dryRun: false,
    previewOnly: false,
    adapterJobUpdate,
    dbFile: paths.dbFile
  };
}

return {
  workflowV2WorkerResultSubmitPreview,
  workflowV2WorkerResultSubmit,
  workflowV2WorkerResultFailPreview,
  workflowV2WorkerResultFail
};
}
