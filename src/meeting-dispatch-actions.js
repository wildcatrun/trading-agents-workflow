import path from "node:path";
import {
  parseJsonValue,
  safeId
} from "./workflow/json.js";
import {
  isSqliteConstraintError,
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const MEETING_DISPATCH_ACTION_HANDLER_NAMES = {
  "meeting.dispatch": "meetingDispatch"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`meeting dispatch action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`meeting dispatch action dependency missing: ${name}`);
  return context[name];
}

export function createMeetingDispatchActionRegistry(handlers = {}) {
  const entries = Object.entries(MEETING_DISPATCH_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing meeting dispatch action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runMeetingDispatchAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createMeetingDispatchActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const createDispatchMessageFlow = requireContextFunction(context, "createDispatchMessageFlow");
  const ensureRuntimeAgent = requireContextFunction(context, "ensureRuntimeAgent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const nowIso = requireContextFunction(context, "nowIso");
  const resolveRegisteredDispatchTarget = requireContextFunction(context, "resolveRegisteredDispatchTarget");
  const routeShellIngest = requireContextFunction(context, "routeShellIngest");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const DISPATCH_STATUSES = requireContextValue(context, "DISPATCH_STATUSES");

  async function meetingDispatch(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || "main");
    const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
    const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
    const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
    const requestedRuntime = String(input.runtime || "").trim();
    const runtime = requestedRuntime ? normalizeRuntime(requestedRuntime) : "";
    if (runtime === "openclaw_route_shell") {
      return routeShellIngest(rootDir, {
        ...input,
        runtime: undefined,
        meetingId,
        workflowId,
        traceId,
        idempotencyKey,
        routeAgentId: agentId,
        text: input.prompt || input.text || "",
        sourceSystem: input.sourceSystem || input.source_system || input.source || "workflow_dispatch",
        sourceRuntime: "openclaw_route_shell",
        dispatchType: input.dispatchType || input.dispatch_type || "route_shell_forward",
        payload: {
          originalDispatchRequest: {
            runtime,
            agentId,
            dispatchType: input.dispatchType || input.dispatch_type || "",
            createdBy: input.createdBy || input.created_by || input.chair || "",
            payload: parseJsonValue(input.payload, input.payload || {})
          }
        }
      });
    }
    const resolvedTarget = runtime
      ? await resolveRegisteredDispatchTarget(paths, { ...input, runtime, agentId })
      : await resolveRegisteredDispatchTarget(paths, { ...input, agentId });
    const targetRegistry = resolvedTarget.registry;
    const dispatchRuntime = targetRegistry.platform || runtime;
    const agent = await ensureRuntimeAgent(paths, {
      runtime: dispatchRuntime,
      platform: targetRegistry.platform,
      agentId,
      displayName: input.displayName || input.display_name || "",
      executionAdapter: targetRegistry.executionAdapter,
      imIngressOwner: targetRegistry.imIngressOwner,
      imIngressAdapter: targetRegistry.imIngressAdapter,
      workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
      endpointRef: targetRegistry.endpointRef,
      preserveExisting: true
    });
    if (idempotencyKey) {
      const existing = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
      if (existing[0]) {
        return {
          meetingId,
          dispatchId: existing[0].dispatch_id,
          runtime: existing[0].runtime,
          agentId: existing[0].agent_id,
          status: existing[0].status,
          traceId: existing[0].trace_id,
          idempotencyKey,
          deduped: true,
          dbFile: paths.dbFile
        };
      }
    }
    const dispatchId = input.dispatchId || input.dispatch_id || safeId("dispatch");
    const status = DISPATCH_STATUSES.has(String(input.status || "queued")) ? String(input.status || "queued") : "queued";
    const createdAt = nowIso();
    const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || input.max_attempts || 1)));
    const payload = {
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId,
      runtime: dispatchRuntime,
      agentId,
      dispatchType: input.dispatchType || input.dispatch_type || "discussion_turn",
      prompt: input.prompt || input.text || "",
      phase: input.phase || "",
      chair: input.chair || input.createdBy || input.created_by || "main",
      attempt: 0,
      maxAttempts,
      payload: parseJsonValue(input.payload, input.payload || {})
    };
    await createDispatchMessageFlow(paths, input, {
      validateOnly: true,
      targetRegistry,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId,
      dispatchRuntime,
      agentId,
      dispatchType: payload.dispatchType,
      createdBy: payload.chair,
      createdAt
    });
    try {
      await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(dispatchId)}, ${sqlValue(meetingId)}, ${sqlValue(workflowId)}, ${sqlValue(traceId)}, ${sqlValue(idempotencyKey)}, ${sqlValue(dispatchRuntime)}, ${sqlValue(agentId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(payload.dispatchType)}, ${sqlValue(status)}, ${sqlValue(input.priority || "normal")}, 0, ${sqlValue(maxAttempts)}, ${sqlValue(payload.prompt)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(payload.chair)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
    } catch (error) {
      if (idempotencyKey && isSqliteConstraintError(error)) {
        const existing = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
        if (existing[0]) {
          return {
            meetingId,
            dispatchId: existing[0].dispatch_id,
            runtime: existing[0].runtime,
            agentId: existing[0].agent_id,
            status: existing[0].status,
            traceId: existing[0].trace_id,
            idempotencyKey,
            deduped: true,
            dbFile: paths.dbFile
          };
        }
      }
      throw error;
    }
    const messageFlow = await createDispatchMessageFlow(paths, input, {
      targetRegistry,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId,
      dispatchRuntime,
      agentId,
      dispatchType: payload.dispatchType,
      createdBy: payload.chair,
      createdAt
    });
    const relPath = await writeJsonArtifact(paths.root, path.join(paths.dispatchesDir, status), dispatchId, payload);
    await appendWorkflowEvent(paths, {
      eventType: "dispatch.created",
      status,
      workflowId,
      traceId,
      dispatchId,
      actor: payload.chair,
      sourceRuntime: "workflow",
      sourceAgent: payload.chair,
      nextState: status,
      idempotencyKey: idempotencyKey ? `workflow_event:dispatch.created:${idempotencyKey}` : "",
      artifactRef: relPath,
      payload: {
        meetingId,
        runtime: dispatchRuntime,
        agentId,
        dispatchType: payload.dispatchType,
        priority: input.priority || "normal",
        messageFlowId: messageFlow?.flowId || ""
      },
      createdAt
    });
    return { meetingId, workflowId, traceId, idempotencyKey, dispatchId, runtime: dispatchRuntime, platform: targetRegistry.platform, workflowIngressAdapter: targetRegistry.workflowIngressAdapter, imIdentity: targetRegistry.imIdentity, executionIdentity: targetRegistry.executionIdentity, agentId, status, messageFlowId: messageFlow?.flowId || "", returnPolicy: messageFlow?.returnPolicy || "", relativePath: relPath, dbFile: paths.dbFile };
  }

  return {
    meetingDispatch
  };
}
