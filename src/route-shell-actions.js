import {
  boolOption,
  firstText,
  parseJsonValue,
  safeId
} from "./workflow/json.js";
import {
  isSqliteConstraintError,
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const ROUTE_SHELL_ACTION_HANDLER_NAMES = {
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`route_shell action dependency missing: ${name}`);
  return value;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function createRouteShellActionRegistry(handlers = {}) {
  const entries = Object.entries(ROUTE_SHELL_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing route_shell action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runRouteShellAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createRouteShellActionHandlers(context = {}) {
  const canRouteToRegisteredInstance = requireContextFunction(context, "canRouteToRegisteredInstance");
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const createMessageFlow = requireContextFunction(context, "createMessageFlow");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const findActiveRegisteredAgentInstances = requireContextFunction(context, "findActiveRegisteredAgentInstances");
  const isRouteShellIngress = requireContextFunction(context, "isRouteShellIngress");
  const isRouteShellOnlyRow = requireContextFunction(context, "isRouteShellOnlyRow");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const meetingIngest = requireContextFunction(context, "meetingIngest");
  const messageFlowIdFromParts = requireContextFunction(context, "messageFlowIdFromParts");
  const messageFlowSourceChannel = requireContextFunction(context, "messageFlowSourceChannel");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeAgentPlatform = requireContextFunction(context, "normalizeAgentPlatform");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const normalizeReturnPolicy = requireContextFunction(context, "normalizeReturnPolicy");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const normalizeWorkflowIngressAdapter = requireContextFunction(context, "normalizeWorkflowIngressAdapter");
  const nowIso = requireContextFunction(context, "nowIso");
  const readMessageFlow = requireContextFunction(context, "readMessageFlow");
  const registrySnapshot = requireContextFunction(context, "registrySnapshot");
  const runtimeBridgeDrain = requireContextFunction(context, "runtimeBridgeDrain");
  const sortRegisteredTargets = requireContextFunction(context, "sortRegisteredTargets");
  const updateMessageFlow = requireContextFunction(context, "updateMessageFlow");

  async function resolveRouteShellTarget(paths, input = {}) {
    const routeAgentId = normalizeAgentId(input.routeAgentId || input.route_agent_id || input.agentId || input.agent_id || input.target || "");
    const requireRouteShell = boolOption(input.requireRouteShell ?? input.require_route_shell, true);
    const instances = await findActiveRegisteredAgentInstances(paths, routeAgentId);
    const gatewayIngress = instances.find(isRouteShellIngress) || null;
    if (requireRouteShell && !gatewayIngress) {
      const passThrough = boolOption(input.passThroughOnNotRouteShell ?? input.pass_through_on_not_route_shell, false);
      return {
        ok: false,
        status: passThrough ? "not_route_shell" : "route_failed",
        passThrough,
        routeAgentId,
        reason: `active registry row with imIngressOwner=openclaw_gateway and imIngressAdapter=openclaw_route_shell not found for ${routeAgentId}`
      };
    }

    const explicitPlatform = normalizeAgentPlatform(input.targetPlatform || input.target_platform || input.runtime || "");
    const explicitAdapter = normalizeWorkflowIngressAdapter(input.workflowIngressAdapter || input.workflow_ingress_adapter || input.targetAdapter || input.target_adapter || "");
    const candidates = instances
      .filter((row) => !isRouteShellOnlyRow(row))
      .filter(canRouteToRegisteredInstance)
      .filter((row) => !explicitPlatform || registrySnapshot(row).platform === explicitPlatform)
      .filter((row) => !explicitAdapter || registrySnapshot(row).workflowIngressAdapter === explicitAdapter)
      .sort(sortRegisteredTargets);
    const target = candidates[0];
    if (target) return { ok: true, routeAgentId, gatewayIngress, target };

    return {
      ok: false,
      status: "route_failed",
      routeAgentId,
      gatewayIngress,
      reason: explicitPlatform || explicitAdapter
        ? `active registered target not found for ${routeAgentId}; requested platform=${explicitPlatform || "*"} adapter=${explicitAdapter || "*"}`
        : `active registered target not found for ${routeAgentId}; registry routing policy produced no dispatch-capable target`
    };
  }

  function routeShellSourceMessageId(input = {}) {
    return String(
      input.sourceMessageId ||
      input.source_message_id ||
      input.providerMessageId ||
      input.provider_message_id ||
      input.messageId ||
      input.message_id ||
      ""
    ).trim();
  }

  function routeShellAckText(result) {
    if (!result.ok) {
      const rawReason = String(result.reason || "unknown").replace(/\s+/g, " ").trim();
      const lowered = rawReason.toLowerCase();
      const reason = lowered.includes("database is locked")
        ? "sqlite database is locked after 5000ms busy timeout"
        : (lowered.includes("unique constraint failed") ? "sqlite unique constraint raced with an existing idempotency row" : rawReason);
      return [
        "ROUTE_FAILED",
        `timestamp: ${result.createdAt}`,
        `route_shell: openclaw_route_shell:${result.routeAgentId || ""}`,
        `reason: ${reason.length > 360 ? `${reason.slice(0, 360)}...` : reason}`
      ].join("\n");
    }
    return [
      "ROUTE_REGISTERED",
      `timestamp: ${result.createdAt}`,
      `trace_id: ${result.traceId}`,
      `flow_id: ${result.messageFlowId || ""}`
    ].join("\n");
  }

  async function routeShellIngest(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const createdAt = nowIso();
    const text = String(input.text || input.prompt || input.content || input.message || "").trim();
    if (!text) throw new Error("text is required for route_shell.ingest");

    const resolved = await resolveRouteShellTarget(paths, input);
    if (!resolved.ok) {
      const result = { ...resolved, ok: false, createdAt, dbFile: paths.dbFile };
      return { ...result, ackText: routeShellAckText(result) };
    }

    const sourceMessageId = routeShellSourceMessageId(input);
    const sourceSystem = String(input.sourceSystem || input.source_system || input.channel || "openclaw_route_shell").trim();
    const sourceRuntime = normalizeRuntime(input.sourceRuntime || input.source_runtime || "openclaw_route_shell");
    const targetRegistry = registrySnapshot(resolved.target);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id || `route-shell-${resolved.routeAgentId}-${sourceMessageId ? cleanFileSegment(sourceMessageId) : Date.now().toString(36)}`);
    const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
    const traceId = String(input.traceId || input.trace_id || (sourceMessageId ? `route-shell:${resolved.routeAgentId}:${cleanFileSegment(sourceMessageId)}` : safeId("route_trace"))).trim();
    const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || (sourceMessageId ? `route-shell:${resolved.routeAgentId}:${sourceSystem}:${sourceMessageId}` : "")).trim();
    const originalPayload = parseJsonValue(input.payload, input.payload || {});
    const beforeDispatch = objectValue(originalPayload.beforeDispatch || originalPayload.before_dispatch);
    const sourceChannel = messageFlowSourceChannel(input, originalPayload);
    const sourceChatId = String(input.chatId || input.chat_id || input.conversationId || input.conversation_id || beforeDispatch.conversationId || beforeDispatch.conversation_id || "").trim();
    const sourceAccountId = firstText(input.accountId, input.account_id, input.account, beforeDispatch.accountId, beforeDispatch.account_id);
    const senderId = firstText(input.senderId, input.sender_id, input.from, beforeDispatch.senderId, beforeDispatch.sender_id);
    const returnPolicy = normalizeReturnPolicy(input.returnPolicy || input.return_policy || input.deliveryPolicy || input.delivery_policy || targetRegistry.returnPolicy, targetRegistry.platform === "hermers" && sourceChannel === "telegram" ? "reply_to_source_chat" : "silent");
    if (targetRegistry.platform !== "openclaw" && returnPolicy === "reply_to_source_chat" && (!sourceChannel || !sourceAccountId || !sourceChatId || !senderId || !sourceMessageId)) {
      const result = {
        ok: false,
        status: "route_failed",
        routeAgentId: resolved.routeAgentId,
        createdAt,
        reason: "non-openclaw route-shell message requires return path: source_channel, account_id, chat_id, sender_id, source_message_id",
        dbFile: paths.dbFile
      };
      return { ...result, ackText: routeShellAckText(result) };
    }
    const messageFlowId = String(input.messageFlowId || input.message_flow_id || messageFlowIdFromParts(idempotencyKey, traceId, meetingId, sourceMessageId)).trim();
    const payload = {
      messageFlowId,
      routeShell: {
        messageFlowId,
        routeAgentId: resolved.routeAgentId,
        sourceRuntime,
        sourceSystem,
        sourceMessageId,
        sourceChannel,
        sourceAccountId,
        sourceChatId,
        senderId,
        returnPolicy,
        deliveryPolicy: returnPolicy,
        returnPath: {
          source_channel: sourceChannel,
          account_id: sourceAccountId,
          chat_id: sourceChatId,
          sender_id: senderId,
          source_message_id: sourceMessageId,
          delivery_policy: returnPolicy
        },
        receivedAt: input.receivedAt || input.received_at || createdAt,
        target: targetRegistry
      },
      originalPayload
    };
    if (idempotencyKey) {
      const existingRows = await sqlite(paths.dbFile, `
SELECT *
FROM mixed_meeting_dispatches
WHERE idempotency_key=${sqlValue(idempotencyKey)}
LIMIT 1;`, { json: true });
      const existing = existingRows[0];
      if (existing) {
        const existingFlow = await readMessageFlow(paths, messageFlowId);
        const result = {
          ok: true,
          status: existing.status,
          createdAt,
          routeAgentId: resolved.routeAgentId,
          routeRuntime: "openclaw_route_shell",
          targetPlatform: targetRegistry.platform,
          targetAgentId: existing.agent_id,
          executionAdapter: targetRegistry.executionAdapter,
          workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
          runtime: existing.runtime,
          agentId: existing.agent_id,
          meetingId: existing.meeting_id,
          workflowId: existing.workflow_id || workflowId,
          traceId: existing.trace_id || traceId,
          idempotencyKey,
          dispatchId: existing.dispatch_id,
          messageFlowId,
          messageFlowStatus: existingFlow?.status || "",
          deduped: true,
          ingressMessageId: "",
          drainResult: null,
          dbFile: paths.dbFile
        };
        return { ...result, ackText: routeShellAckText(result) };
      }
    }

    await createMessageFlow(paths, {
      flowId: messageFlowId,
      traceId,
      idempotencyKey,
      meetingId,
      workflowId,
      sourceChannel,
      sourceSystem,
      sourceRuntime,
      sourceAccountId,
      sourceChatId,
      senderId,
      sourceMessageId,
      routeAgentId: resolved.routeAgentId,
      routeRuntime: "openclaw_route_shell",
      targetRuntime: targetRegistry.platform,
      targetAgentId: resolved.target.agent_id,
      targetPlatform: targetRegistry.platform,
      workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
      imIdentity: targetRegistry.imIdentity,
      executionIdentity: targetRegistry.executionIdentity,
      returnPolicy,
      status: "inbound_received",
      createdAt,
      payload: { routeShell: payload.routeShell }
    });

    let ingress = null;
    if (boolOption(input.recordIngress ?? input.record_ingress, true)) {
      try {
        ingress = await meetingIngest(rootDir, {
          meetingId,
          runtime: sourceRuntime,
          agentId: resolved.routeAgentId,
          text,
          messageId: sourceMessageId || undefined,
          messageType: "route_shell_ingress",
          phase: "route_shell",
          payload
        });
      } catch (error) {
        if (sourceMessageId && isSqliteConstraintError(error)) {
          ingress = { messageId: sourceMessageId, deduped: true };
        } else {
          throw error;
        }
      }
    }

    const dispatch = await meetingDispatch(rootDir, {
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      runtime: targetRegistry.platform,
      agentId: resolved.target.agent_id,
      platform: targetRegistry.platform,
      executionAdapter: targetRegistry.executionAdapter,
      imIngressOwner: targetRegistry.imIngressOwner,
      imIngressAdapter: targetRegistry.imIngressAdapter,
      workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
      dispatchType: input.dispatchType || input.dispatch_type || "route_shell_forward",
      prompt: text,
      priority: input.priority || "normal",
      createdBy: `openclaw_route_shell:${resolved.routeAgentId}`,
      maxAttempts: input.maxAttempts || input.max_attempts || 1,
      payload
    });
    await updateMessageFlow(paths, messageFlowId, "route_registered", {
      dispatchId: dispatch.dispatchId,
      payload: {
        dispatchId: dispatch.dispatchId,
        dispatchStatus: dispatch.status,
        workflowIngressAdapter: targetRegistry.workflowIngressAdapter
      }
    });

    let drainResult = null;
    if (boolOption(input.drainNow ?? input.drain_now, false) && dispatch.status === "queued") {
      drainResult = await runtimeBridgeDrain(rootDir, {
        ...input,
        runtime: dispatch.runtime,
        dispatchId: dispatch.dispatchId,
        limit: 1,
        timeoutSeconds: input.timeoutSeconds || input.timeout_seconds || 45,
        dryRun: false
      });
    }

    const result = {
      ok: true,
      status: dispatch.status,
      createdAt,
      routeAgentId: resolved.routeAgentId,
      routeRuntime: "openclaw_route_shell",
      targetPlatform: targetRegistry.platform,
      targetAgentId: dispatch.agentId,
      executionAdapter: targetRegistry.executionAdapter,
      workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
      runtime: dispatch.runtime,
      agentId: dispatch.agentId,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId: dispatch.dispatchId,
      messageFlowId,
      deduped: Boolean(dispatch.deduped),
      ingressMessageId: ingress?.messageId || "",
      drainResult,
      dbFile: paths.dbFile
    };
    return { ...result, ackText: routeShellAckText(result) };
  }

  return {
    routeShellIngest
  };
}
