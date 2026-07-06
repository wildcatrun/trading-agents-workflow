import { safeId } from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const DISPATCH_RECONCILE_ACTION_HANDLER_NAMES = {
  "workflow.dispatch.reconcile": "staleDispatchReconcile",
  "dispatch.reconcile": "staleDispatchReconcile",
  "stale_dispatch.reconcile": "staleDispatchReconcile"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`dispatch reconcile action dependency missing: ${name}`);
  return value;
}

export function createDispatchReconcileActionRegistry(handlers = {}) {
  const entries = Object.entries(DISPATCH_RECONCILE_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing dispatch reconcile action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runDispatchReconcileAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createDispatchReconcileActionHandlers(context = {}) {
  const controlLoopTimeoutSeconds = requireContextFunction(context, "controlLoopTimeoutSeconds");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const finishMessageFlowRuntime = requireContextFunction(context, "finishMessageFlowRuntime");
  const messageFlowForDispatch = requireContextFunction(context, "messageFlowForDispatch");
  const nextRetryAt = requireContextFunction(context, "nextRetryAt");
  const nowIso = requireContextFunction(context, "nowIso");
  const recordRuntimeBridgeFailureState = requireContextFunction(context, "recordRuntimeBridgeFailureState");
  const recordRuntimeBridgeSemanticEvent = requireContextFunction(context, "recordRuntimeBridgeSemanticEvent");
  const recordRuntimeRun = requireContextFunction(context, "recordRuntimeRun");
  const runtimeAckContract = requireContextFunction(context, "runtimeAckContract");
  const syncMessageFlowFromTerminalDispatchReceipt = requireContextFunction(context, "syncMessageFlowFromTerminalDispatchReceipt");
  const updateDispatch = requireContextFunction(context, "updateDispatch");

  async function recordStaleDispatchProjection(paths, row, receipt = {}, input = {}) {
    const terminalStatus = String(receipt.status || "").trim();
    const completedAt = receipt.completedAt || receipt.completed_at || nowIso();
    const runtimeRunId = receipt.runtimeRunId || receipt.runtime_run_id || "";
    const messageId = receipt.messageId || receipt.message_id || "";
    const attempt = Number(receipt.attempt ?? row.attempt ?? 0) || 0;
    const ack = runtimeAckContract(row, input);
    const common = {
      eventTime: completedAt,
      runtimeRunId,
      adapter: "stale_dispatch_reconcile",
      attempt,
      messageId,
      latestReceiptRef: messageId,
      stage: "stale_terminal_receipt_synced",
      payload: { terminalStatus, reconciled: true }
    };
    if (terminalStatus === "acked") {
      if (ack.required) {
        await recordRuntimeBridgeSemanticEvent(paths, row, "mechanical_ack", {
          ...common,
          stage: "stale_terminal_ack_synced",
          idempotencyKey: `stale-reconcile:${row.dispatch_id}:${runtimeRunId || "missing-run"}:mechanical_ack`
        });
        return;
      }
      if (receipt.finalOutputPresent === false || receipt.final_output_present === false || (receipt.finalOutputPresent === undefined && receipt.final_output_present === undefined && !messageId)) {
        await recordRuntimeBridgeFailureState(paths, row, {
          eventTime: completedAt,
          runtimeRunId,
          adapter: "stale_dispatch_reconcile",
          attempt,
          failureType: receipt.failureType || receipt.failure_type || "runtime_output_missing",
          error: receipt.error || receipt.lastError || receipt.last_error || "terminal acked runtime receipt did not reference final output",
          status: "failed",
          stage: "turn_failed",
          idempotencyKey: `stale-reconcile:${row.dispatch_id}:${runtimeRunId || "missing-run"}:turn_failed`,
          payload: { terminalStatus, reconciled: true, finalOutputPresent: false }
        });
        return;
      }
      await recordRuntimeBridgeSemanticEvent(paths, row, "semantic_ack", {
        ...common,
        stage: "stale_terminal_semantic_synced",
        idempotencyKey: `stale-reconcile:${row.dispatch_id}:${runtimeRunId || "missing-run"}:semantic_ack`
      });
      await recordRuntimeBridgeSemanticEvent(paths, row, "turn_completed", {
        ...common,
        stage: "stale_terminal_turn_completed",
        idempotencyKey: `stale-reconcile:${row.dispatch_id}:${runtimeRunId || "missing-run"}:turn_completed`
      });
      return;
    }
    if (terminalStatus === "failed" || terminalStatus === "retry_scheduled") {
      await recordRuntimeBridgeFailureState(paths, row, {
        eventTime: completedAt,
        runtimeRunId,
        adapter: "stale_dispatch_reconcile",
        attempt,
        failureType: receipt.failureType || receipt.failure_type || "runtime_stale",
        error: receipt.error || receipt.lastError || receipt.last_error || "stale dispatch reconciled from terminal runtime receipt",
        retryScheduled: terminalStatus === "retry_scheduled" || Boolean(receipt.retryScheduled || receipt.retry_scheduled),
        status: terminalStatus === "retry_scheduled" || receipt.retryScheduled || receipt.retry_scheduled ? "queued" : "failed",
        stage: terminalStatus === "retry_scheduled" || receipt.retryScheduled || receipt.retry_scheduled ? "retry_scheduled" : "turn_failed",
        payload: { terminalStatus, reconciled: true }
      });
    }
  }

  async function staleDispatchReconcile(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const timeoutSeconds = controlLoopTimeoutSeconds(input);
    const staleAfterMs = Math.max(5 * 60_000, Number(input.staleDispatchAfterMs || input.stale_dispatch_after_ms || (timeoutSeconds + 60) * 1000));
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const limit = Math.max(1, Math.min(100, Number(input.limit || input.dispatchReconcileLimit || input.dispatch_reconcile_limit || 20)));
    const rows = await sqlite(paths.dbFile, `
SELECT d.*,
  (SELECT rr.runtime_run_id FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_runtime_run_id,
  (SELECT rr.status FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_status,
  (SELECT rr.completed_at FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_completed_at,
  (SELECT rr.attempt FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_attempt,
  (SELECT rr.message_id FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_message_id,
  (SELECT rr.failure_type FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_failure_type,
  (SELECT rr.error FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_error
FROM mixed_meeting_dispatches d
WHERE d.status='sent'
  AND d.updated_at < ${sqlValue(cutoff)}
ORDER BY d.updated_at
LIMIT ${limit};`, { json: true });
    const results = [];
    for (const row of rows) {
      const terminalStatus = String(row.terminal_status || "").trim();
      if (terminalStatus === "acked") {
        await updateDispatch(paths, row.dispatch_id, "acked", {
          adapter: "stale_dispatch_reconcile",
          completedAt: row.terminal_completed_at || nowIso(),
          messageId: row.terminal_message_id || "",
          reconciledFrom: row.status
        });
        const messageFlowSync = await syncMessageFlowFromTerminalDispatchReceipt(paths, { ...row, status: "acked" }, {
          status: "acked",
          runtimeRunId: row.terminal_runtime_run_id || "",
          messageId: row.terminal_message_id || "",
          completedAt: row.terminal_completed_at || ""
        }, input);
        const syncedFlow = await messageFlowForDispatch(paths, row);
        await recordStaleDispatchProjection(paths, row, {
          status: "acked",
          runtimeRunId: row.terminal_runtime_run_id || "",
          messageId: row.terminal_message_id || "",
          completedAt: row.terminal_completed_at || "",
          attempt: row.terminal_attempt || row.attempt || 0,
          finalOutputPresent: syncedFlow ? Boolean(Number(syncedFlow.final_output_present || 0)) : undefined,
          failureType: syncedFlow?.failure_type || "",
          error: syncedFlow?.last_error || ""
        }, input);
        results.push({ dispatchId: row.dispatch_id, status: "acked", reason: "terminal_runtime_receipt", messageFlowSync });
        continue;
      }
      if (terminalStatus === "failed" || terminalStatus === "retry_scheduled") {
        const attempt = Math.max(Number(row.attempt || 0) + 1, Number(row.terminal_attempt || 0) || 0);
        const shouldRetry = terminalStatus === "retry_scheduled" && attempt < Number(row.max_attempts || 1);
        const ack = runtimeAckContract(row, input);
        await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", {
          adapter: "stale_dispatch_reconcile",
          failedAt: row.terminal_completed_at || nowIso(),
          failureType: row.terminal_failure_type || "runtime_stale",
          error: row.terminal_error || "stale sent dispatch reconciled from terminal runtime receipt",
          attempt,
          nextRetryAt: shouldRetry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : ""
        });
        const messageFlowSync = shouldRetry ? null : await syncMessageFlowFromTerminalDispatchReceipt(paths, { ...row, status: "failed" }, {
          status: "failed",
          runtimeRunId: row.terminal_runtime_run_id || "",
          messageId: row.terminal_message_id || "",
          completedAt: row.terminal_completed_at || "",
          failureType: row.terminal_failure_type || "runtime_stale",
          error: row.terminal_error || "stale sent dispatch reconciled from terminal runtime receipt"
        }, input);
        await recordStaleDispatchProjection(paths, row, {
          status: shouldRetry ? "retry_scheduled" : "failed",
          runtimeRunId: row.terminal_runtime_run_id || "",
          messageId: row.terminal_message_id || "",
          completedAt: row.terminal_completed_at || "",
          attempt,
          failureType: row.terminal_failure_type || "runtime_stale",
          error: row.terminal_error || "stale sent dispatch reconciled from terminal runtime receipt",
          retryScheduled: shouldRetry
        }, input);
        results.push({ dispatchId: row.dispatch_id, status: shouldRetry ? "queued" : "failed", reason: "terminal_runtime_receipt", messageFlowSync });
        continue;
      }
      const maxAttempts = Number(row.max_attempts || 1);
      const attempt = Number(row.attempt || 0) + 1;
      const retry = attempt < maxAttempts;
      const ack = runtimeAckContract(row, input);
      const completedAt = nowIso();
      const error = `stale sent dispatch exceeded ${Math.round(staleAfterMs / 1000)}s without terminal runtime receipt`;
      await updateDispatch(paths, row.dispatch_id, retry ? "queued" : "failed", {
        adapter: "stale_dispatch_reconcile",
        failedAt: completedAt,
        failureType: "runtime_stale",
        error,
        attempt,
        nextRetryAt: retry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : ""
      });
      const staleRuntimeRunId = await recordRuntimeRun(paths, row, {
        runtimeRunId: safeId(retry ? "runtime_run_retry" : "runtime_run_failed"),
        adapter: "stale_dispatch_reconcile",
        status: retry ? "retry_scheduled" : "failed",
        failureType: "runtime_stale",
        startedAt: row.sent_at || row.updated_at || row.created_at,
        completedAt,
        attempt,
        error,
        payload: { staleAfterMs, retry }
      });
      if (!retry) {
        await finishMessageFlowRuntime(paths, row, {
          runtimeRunId: staleRuntimeRunId,
          finalOutputPresent: false,
          failureType: "runtime_stale",
          lastError: error
        }, input);
      }
      await recordStaleDispatchProjection(paths, row, {
        status: retry ? "retry_scheduled" : "failed",
        runtimeRunId: staleRuntimeRunId,
        completedAt,
        attempt,
        failureType: "runtime_stale",
        error,
        retryScheduled: retry
      }, input);
      results.push({ dispatchId: row.dispatch_id, status: retry ? "queued" : "failed", reason: "missing_terminal_runtime_receipt" });
    }
    return { operation: "stale_dispatch_reconcile", cutoff, staleAfterMs, count: rows.length, results, dbFile: paths.dbFile };
  }

  return {
    staleDispatchReconcile
  };
}
