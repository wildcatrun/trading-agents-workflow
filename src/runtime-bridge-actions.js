import {
  parseJsonValue,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const RUNTIME_BRIDGE_ACTION_HANDLER_NAMES = {
  "runtime.bridge": "runtimeBridgeDrain",
  "runtime.bridge.drain": "runtimeBridgeDrain"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`runtime bridge action dependency missing: ${name}`);
  return value;
}

function sqlStringList(values) {
  return values.map((value) => sqlValue(value)).join(", ");
}

export function createRuntimeBridgeActionRegistry(handlers = {}) {
  const entries = Object.entries(RUNTIME_BRIDGE_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing runtime bridge action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runRuntimeBridgeAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createRuntimeBridgeActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const claimQueuedDispatch = requireContextFunction(context, "claimQueuedDispatch");
  const classifyHermersProfileAdmission = requireContextFunction(context, "classifyHermersProfileAdmission");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const failRuntimeBridgeInvalidDispatch = requireContextFunction(context, "failRuntimeBridgeInvalidDispatch");
  const failRuntimeBridgeRegistryDispatch = requireContextFunction(context, "failRuntimeBridgeRegistryDispatch");
  const loadHermersProfileModes = requireContextFunction(context, "loadHermersProfileModes");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const normalizeWorkflowIngressAdapter = requireContextFunction(context, "normalizeWorkflowIngressAdapter");
  const nowIso = requireContextFunction(context, "nowIso");
  const profileModesReadinessPayload = requireContextFunction(context, "profileModesReadinessPayload");
  const recordRuntimeBridgeFailureState = requireContextFunction(context, "recordRuntimeBridgeFailureState");
  const runHermesAcpDispatch = requireContextFunction(context, "runHermesAcpDispatch");
  const runHermesDispatch = requireContextFunction(context, "runHermesDispatch");
  const runLocalCodexDispatch = requireContextFunction(context, "runLocalCodexDispatch");
  const runOpenClawDispatch = requireContextFunction(context, "runOpenClawDispatch");
  const updateDispatch = requireContextFunction(context, "updateDispatch");
  const validateRuntimeBridgeRegistryRow = requireContextFunction(context, "validateRuntimeBridgeRegistryRow");
  const validateRuntimeBridgeTaskPayload = requireContextFunction(context, "validateRuntimeBridgeTaskPayload");

  async function appendRuntimeBridgeResultEvent(paths, row, result = {}) {
    if (!row?.dispatch_id || !result?.status || result.status === "skipped") return;
    await appendWorkflowEvent(paths, {
      eventType: "runtime.receipt",
      status: result.status,
      workflowId: row.workflow_id || result.workflowId || "",
      traceId: row.trace_id || result.traceId || "",
      dispatchId: row.dispatch_id,
      runtimeRunId: result.runtimeRunId || "",
      messageFlowId: result.messageFlowId || "",
      actor: "runtime.bridge",
      sourceRuntime: row.runtime || result.runtime || "",
      sourceAgent: row.agent_id || result.agentId || "",
      previousState: "queued",
      nextState: result.status,
      payload: {
        runtime: row.runtime || result.runtime || "",
        agentId: row.agent_id || result.agentId || "",
        adapter: result.adapter || "",
        backend: result.backend || "",
        failureType: result.failureType || "",
        retryScheduled: Boolean(result.retryScheduled),
        error: result.error || ""
      }
    });
  }

  async function runtimeBridgeDrain(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const runtime = normalizeRuntime(input.runtime || "hermers");
    const limit = Math.max(1, Math.min(20, Number(input.limit || 1)));
    const dryRun = Boolean(input.dryRun || input.dry_run);
    const dispatchId = String(input.dispatchId || input.dispatch_id || "").trim();
    const dispatchFilter = dispatchId ? `AND d.dispatch_id=${sqlValue(dispatchId)}` : "";
    const excludeDispatchTypes = toList(input.excludeDispatchTypes || input.exclude_dispatch_types).map((item) => String(item || "").trim()).filter(Boolean);
    const excludeDispatchTypeFilter = excludeDispatchTypes.length ? `AND d.dispatch_type NOT IN (${sqlStringList(excludeDispatchTypes)})` : "";
    const hermersModes = runtime === "hermers" ? await loadHermersProfileModes(input) : null;
    const rows = await sqlite(paths.dbFile, `
SELECT d.*, a.agent_key AS registry_agent_key, a.runtime AS registry_runtime, a.status AS registry_status, a.display_name, a.role, a.endpoint_ref, a.platform, a.execution_adapter, a.im_ingress_owner, a.im_ingress_adapter, a.workflow_ingress_adapter, a.can_receive_dispatch
FROM mixed_meeting_dispatches d
LEFT JOIN runtime_agents a ON a.agent_key=d.agent_key
WHERE d.status='queued' AND d.runtime=${sqlValue(runtime)}
  ${dispatchFilter}
  ${excludeDispatchTypeFilter}
  AND (d.next_retry_at IS NULL OR d.next_retry_at='' OR d.next_retry_at <= ${sqlValue(nowIso())})
ORDER BY
  CASE d.priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  d.created_at
LIMIT ${limit};`, { json: true });
    if (dryRun) return { runtime, dryRun: true, count: rows.length, profileModes: hermersModes ? profileModesReadinessPayload(hermersModes) : null, dispatches: rows.map((row) => {
      const admission = runtime === "hermers" ? classifyHermersProfileAdmission(row, hermersModes, input) : { allowed: true, action: "allow" };
      const registryValidation = validateRuntimeBridgeRegistryRow(row, runtime);
      const taskValidation = validateRuntimeBridgeTaskPayload(row);
      return { dispatchId: row.dispatch_id, meetingId: row.meeting_id, workflowId: row.workflow_id, traceId: row.trace_id, agentId: row.agent_id, attempt: row.attempt, maxAttempts: row.max_attempts, endpointRef: row.endpoint_ref, registryValidation, taskValidation, admission };
    }) };
    const results = [];
    for (const row of rows) {
      const validation = validateRuntimeBridgeRegistryRow(row, runtime);
      if (!validation.ok) {
        const result = await failRuntimeBridgeRegistryDispatch(paths, row, validation, input);
        await appendRuntimeBridgeResultEvent(paths, row, result);
        results.push(result);
        continue;
      }
      const taskValidation = validateRuntimeBridgeTaskPayload(row);
      if (!taskValidation.ok) {
        const result = await failRuntimeBridgeInvalidDispatch(paths, row, taskValidation, input);
        await appendRuntimeBridgeResultEvent(paths, row, result);
        results.push(result);
        continue;
      }
      const claim = await claimQueuedDispatch(paths, row, input);
      if (!claim.claimed) {
        results.push({ dispatchId: row.dispatch_id, runtime, agentId: row.agent_id, status: "skipped", reason: claim.reason, currentStatus: claim.row?.status || "" });
        continue;
      }
      const claimedRow = claim.row;
      try {
        let result = null;
        if (runtime === "openclaw_route_shell") {
          const failedAt = nowIso();
          const error = "openclaw_route_shell runtime bridge repair is retired; use runtime_agents plus message_flow or the target runtime adapter";
          await updateDispatch(paths, claimedRow.dispatch_id, "failed", {
            adapter: "route_shell_retired",
            failedAt,
            failureType: "route_shell_retired",
            error
          });
          await recordRuntimeBridgeFailureState(paths, claimedRow, {
            eventTime: failedAt,
            adapter: "route_shell_retired",
            failureType: "route_shell_retired",
            error,
            stage: "route_shell_retired"
          });
          result = {
            dispatchId: claimedRow.dispatch_id,
            runtime,
            agentId: claimedRow.agent_id,
            status: "failed",
            failureType: "route_shell_retired",
            error
          };
        } else if (runtime === "hermers") {
          const adapter = normalizeWorkflowIngressAdapter(claimedRow.workflow_ingress_adapter || claimedRow.execution_adapter || "", claimedRow.platform || "", runtime);
          if (adapter === "acp") {
            result = await runHermesAcpDispatch(paths, claimedRow, input);
          } else if (adapter === "cli") {
            result = await runHermesDispatch(paths, claimedRow, { ...input, adapterName: "cli" });
          } else {
            const failedAt = nowIso();
            const error = `hermers adapter not implemented: ${adapter}`;
            await updateDispatch(paths, claimedRow.dispatch_id, "failed", { adapter, failedAt, failureType: "runtime_adapter_unimplemented", error });
            await recordRuntimeBridgeFailureState(paths, claimedRow, {
              eventTime: failedAt,
              adapter,
              failureType: "runtime_adapter_unimplemented",
              error,
              stage: "adapter_unimplemented"
            });
            result = { dispatchId: claimedRow.dispatch_id, runtime, agentId: claimedRow.agent_id, status: "failed", failureType: "runtime_adapter_unimplemented", error };
          }
        } else if (runtime === "openclaw") {
          result = await runOpenClawDispatch(paths, claimedRow, input);
        } else if (runtime === "local_codex" || runtime === "codex") {
          result = await runLocalCodexDispatch(paths, claimedRow, input);
        } else {
          const failedAt = nowIso();
          const error = `runtime adapter not implemented: ${runtime}`;
          await updateDispatch(paths, claimedRow.dispatch_id, "failed", { adapter: "none", failedAt, failureType: "runtime_adapter_unimplemented", error });
          await recordRuntimeBridgeFailureState(paths, claimedRow, {
            eventTime: failedAt,
            adapter: "none",
            failureType: "runtime_adapter_unimplemented",
            error,
            stage: "adapter_unimplemented"
          });
          result = { dispatchId: claimedRow.dispatch_id, runtime, agentId: claimedRow.agent_id, status: "failed", failureType: "runtime_adapter_unimplemented", error };
        }
        await appendRuntimeBridgeResultEvent(paths, claimedRow, result);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedAt = nowIso();
        await updateDispatch(paths, claimedRow.dispatch_id, "failed", { adapter: "runtime_bridge", failedAt, failureType: "runtime_bridge_error", error: message.slice(0, 2000) });
        await recordRuntimeBridgeFailureState(paths, claimedRow, {
          eventTime: failedAt,
          adapter: "runtime_bridge",
          failureType: "runtime_bridge_error",
          error: message,
          stage: "runtime_bridge_error"
        });
        const result = { dispatchId: claimedRow.dispatch_id, runtime, agentId: claimedRow.agent_id, status: "failed", failureType: "runtime_bridge_error", error: message };
        await appendRuntimeBridgeResultEvent(paths, claimedRow, result);
        results.push(result);
      }
    }
    return { runtime, count: rows.length, results, dbFile: paths.dbFile };
  }

  return {
    runtimeBridgeDrain
  };
}
