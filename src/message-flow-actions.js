import { createHash } from "node:crypto";
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

export const MESSAGE_FLOW_ACTION_HANDLER_NAMES = {
  "message_flow.send": "messageFlowSend",
  "workflow.message_flow.send": "messageFlowSend",
  "message_flow.list": "messageFlowList",
  "message_flow.status": "messageFlowList",
  "workflow.message_flow.list": "messageFlowList",
  "workflow.message_flow.status": "messageFlowList",
  "message_flow.reconcile": "messageFlowReconcile",
  "workflow.message_flow.reconcile": "messageFlowReconcile"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`message_flow action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`message_flow action dependency missing: ${name}`);
  return context[name];
}

function sqlStringList(values) {
  return values.map((value) => sqlValue(value)).join(", ");
}

export function createMessageFlowActionRegistry(handlers = {}) {
  const entries = Object.entries(MESSAGE_FLOW_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing message_flow action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runMessageFlowAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createMessageFlowActionHandlers(context = {}) {
  const appendMessageFlowEvent = requireContextFunction(context, "appendMessageFlowEvent");
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const createMessageFlow = requireContextFunction(context, "createMessageFlow");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const incidentState = requireContextFunction(context, "incidentState");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const meetingIngest = requireContextFunction(context, "meetingIngest");
  const messageFlowAckTimeoutSeconds = requireContextFunction(context, "messageFlowAckTimeoutSeconds");
  const messageFlowIdFromParts = requireContextFunction(context, "messageFlowIdFromParts");
  const messageFlowSendPrompt = requireContextFunction(context, "messageFlowSendPrompt");
  const messageFlowSendTargets = requireContextFunction(context, "messageFlowSendTargets");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const normalizeReturnPolicy = requireContextFunction(context, "normalizeReturnPolicy");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const nowIso = requireContextFunction(context, "nowIso");
  const readMessageFlow = requireContextFunction(context, "readMessageFlow");
  const recoverAckedMessageFlowSemanticContinuations = requireContextFunction(context, "recoverAckedMessageFlowSemanticContinuations");
  const updateMessageFlowFromTelegramDelivery = requireContextFunction(context, "updateMessageFlowFromTelegramDelivery");
  const DEFAULT_RUNTIME_ACK_RETRY_SECONDS = requireContextValue(context, "DEFAULT_RUNTIME_ACK_RETRY_SECONDS");
  const DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS = requireContextValue(context, "DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS");
  const MESSAGE_FLOW_DELIVERY_RETURN_POLICIES = requireContextValue(context, "MESSAGE_FLOW_DELIVERY_RETURN_POLICIES");

  async function messageFlowList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const flowId = String(input.flowId || input.flow_id || "").trim();
    const dispatchId = String(input.dispatchId || input.dispatch_id || "").trim();
    const status = String(input.status || "").trim();
    const where = [];
    if (flowId) where.push(`flow_id=${sqlValue(flowId)}`);
    if (dispatchId) {
      const dispatchJson = JSON.stringify(dispatchId).slice(1, -1);
      where.push(`(dispatch_id=${sqlValue(dispatchId)} OR payload_json LIKE ${sqlValue(`%"ackDispatchId":"${dispatchJson}"%`)} OR payload_json LIKE ${sqlValue(`%"semanticDispatchId":"${dispatchJson}"%`)})`);
    }
    if (status) where.push(`status=${sqlValue(status)}`);
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(200, Number(input.limit || 20)));
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM message_flows
${whereSql}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true });
    for (const row of rows) {
      row.payload = parseJsonValue(row.payload_json, {});
      delete row.payload_json;
    }
    return { count: rows.length, rows, dbFile: paths.dbFile };
  }

  async function messageFlowSend(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const targets = messageFlowSendTargets(input);
    const { subject, body, sourceRefs, prompt } = messageFlowSendPrompt(input);
    const baseFlowId = String(input.messageFlowId || input.message_flow_id || input.flowId || input.flow_id || "").trim();
    const baseDispatchId = String(input.dispatchId || input.dispatch_id || "").trim();
    if (baseFlowId && targets.length > 1) throw new Error("messageFlowId/flowId can only be provided for a single target");
    if (baseDispatchId && targets.length > 1) throw new Error("dispatchId can only be provided for a single target");

    const createdAt = nowIso();
    const sourceRuntime = normalizeRuntime(input.fromRuntime || input.from_runtime || input.sourceRuntime || input.source_runtime || "other");
    const fromAgent = normalizeAgentId(input.fromAgent || input.from_agent || input.senderAgent || input.sender_agent || input.from || input.sender || "unknown");
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id || input.workflowId || input.workflow_id || `message-flow-${Date.now().toString(36)}`);
    const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
    const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
    const explicitSourceMessageId = String(input.sourceMessageId || input.source_message_id || input.providerMessageId || input.provider_message_id || input.messageId || input.message_id || "").trim();
    const baseIdempotencyKey = String(input.idempotencyKey || input.idempotency_key || (explicitSourceMessageId ? `message-flow-send:${sourceRuntime}:${fromAgent}:${explicitSourceMessageId}` : "")).trim();
    const sourceMessageId = explicitSourceMessageId || (baseIdempotencyKey ? `msg.${createHash("sha256").update(baseIdempotencyKey).digest("hex").slice(0, 24)}` : "");
    const messageType = String(input.messageType || input.message_type || "internal_notice").trim();
    const requiresAck = boolOption(input.requiresAck ?? input.requires_ack, false);
    const returnPolicy = normalizeReturnPolicy(input.returnPolicy || input.return_policy || input.deliveryPolicy || input.delivery_policy, "silent");
    const sourceChannel = String(input.sourceChannel || input.source_channel || "workflow_internal").trim();
    const sourceSystem = String(input.sourceSystem || input.source_system || "workflow.message_flow.send").trim();
    const sourceAccountId = firstText(input.sourceAccountId, input.source_account_id, input.accountId, input.account_id, input.account);
    const sourceChatId = firstText(input.sourceChatId, input.source_chat_id, input.chatId, input.chat_id, input.conversationId, input.conversation_id);
    const senderId = firstText(input.senderId, input.sender_id, fromAgent);
    if (returnPolicy === "reply_to_source_chat" && (!sourceChannel || !sourceAccountId || !sourceChatId || !senderId || !sourceMessageId)) {
      throw new Error("workflow.message_flow.send with return_policy=reply_to_source_chat requires source_channel, account_id, chat_id, sender_id, source_message_id");
    }
    const rawPayload = parseJsonValue(input.payload, input.payload || {});
    const ackTimeoutSeconds = messageFlowAckTimeoutSeconds(input);
    const ackContract = requiresAck
      ? {
          required: true,
          firstTurnOnly: true,
          timeoutSeconds: ackTimeoutSeconds,
          retryDelaySeconds: DEFAULT_RUNTIME_ACK_RETRY_SECONDS,
          maxAttempts: DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS,
          expectedPrefix: "ACK_RECEIVED"
        }
      : null;
    const sourcePayload = {
      messageType,
      subject,
      body,
      sourceRefs,
      requiresAck,
      source: {
        runtime: sourceRuntime,
        agentId: fromAgent,
        sourceChannel,
        sourceSystem,
        sourceAccountId,
        sourceChatId,
        senderId,
        sourceMessageId
      },
      ...(ackContract ? { ackContract } : {}),
      raw: rawPayload
    };

    let sourceRecord = null;
    if (boolOption(input.recordIngress ?? input.record_ingress, true)) {
      try {
        sourceRecord = await meetingIngest(rootDir, {
          meetingId,
          runtime: sourceRuntime,
          agentId: fromAgent,
          text: prompt,
          messageId: sourceMessageId || input.messageId || input.message_id || undefined,
          messageType,
          phase: input.phase || "message_flow_send",
          payload: sourcePayload
        });
      } catch (error) {
        if (!sourceMessageId || !isSqliteConstraintError(error)) throw error;
        sourceRecord = { messageId: sourceMessageId, deduped: true };
      }
    }

    const dispatches = [];
    for (const target of targets) {
      const targetKey = `${target.runtime || "registry"}:${target.agentId}`;
      const idempotencyKey = baseIdempotencyKey ? `${baseIdempotencyKey}:${cleanFileSegment(targetKey)}` : "";
      const flowId = baseFlowId || messageFlowIdFromParts(idempotencyKey || traceId, meetingId, sourceMessageId, targetKey, subject, body);
      const dispatchId = baseDispatchId || safeId("dispatch");
      const targetPayload = {
        ...sourcePayload,
        messageFlowId: flowId,
        target: {
          runtime: target.runtime,
          agentId: target.agentId,
          key: targetKey
        }
      };
      const dispatch = await meetingDispatch(rootDir, {
        meetingId,
        workflowId,
        traceId,
        idempotencyKey,
        dispatchId,
        runtime: target.runtime || undefined,
        agentId: target.agentId,
        dispatchType: input.dispatchType || input.dispatch_type || "message_flow_send",
        prompt,
        priority: input.priority || "normal",
        createdBy: input.createdBy || input.created_by || `${sourceRuntime}:${fromAgent}`,
        maxAttempts: input.maxAttempts || input.max_attempts || (requiresAck ? DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS : 1),
        returnPolicy: "silent",
        deliveryPolicy: "silent",
        sourceChannel,
        sourceSystem,
        sourceRuntime,
        sourceAccountId,
        sourceChatId,
        senderId,
        sourceMessageId,
        payload: targetPayload
      });
      const existingFlow = await readMessageFlow(paths, flowId);
      let flow = existingFlow;
      if (!existingFlow) {
        await createMessageFlow(paths, {
          flowId,
          traceId,
          idempotencyKey,
          meetingId,
          workflowId,
          dispatchId: dispatch.dispatchId,
          messageId: sourceRecord?.messageId || "",
          sourceChannel,
          sourceSystem,
          sourceRuntime,
          sourceAccountId,
          sourceChatId,
          senderId,
          sourceMessageId,
          routeAgentId: fromAgent,
          routeRuntime: sourceRuntime,
          targetRuntime: dispatch.runtime,
          targetAgentId: dispatch.agentId,
          targetPlatform: dispatch.platform || dispatch.runtime,
          workflowIngressAdapter: dispatch.workflowIngressAdapter || "",
          imIdentity: dispatch.imIdentity || "",
          executionIdentity: dispatch.executionIdentity || "",
          returnPolicy,
          status: "route_registered",
          createdAt,
          payload: {
            ...targetPayload,
            dispatchId: dispatch.dispatchId,
            dispatchStatus: dispatch.status,
            returnPolicy
          }
        });
        flow = await readMessageFlow(paths, flowId);
      }
      dispatches.push({
        target: targetKey,
        agentId: dispatch.agentId,
        runtime: dispatch.runtime,
        platform: dispatch.platform || flow?.target_platform || "",
        workflowIngressAdapter: dispatch.workflowIngressAdapter || flow?.workflow_ingress_adapter || "",
        imIdentity: dispatch.imIdentity || flow?.im_identity || "",
        executionIdentity: dispatch.executionIdentity || flow?.execution_identity || "",
        dispatchId: dispatch.dispatchId,
        dispatchStatus: dispatch.status,
        messageFlowId: flowId,
        messageFlowStatus: flow?.status || "",
        idempotencyKey,
        deduped: Boolean(dispatch.deduped || existingFlow)
      });
    }

    return {
      operation: "workflow.message_flow.send",
      meetingId,
      workflowId,
      traceId,
      idempotencyKey: baseIdempotencyKey,
      fromRuntime: sourceRuntime,
      fromAgent,
      messageId: sourceRecord?.messageId || "",
      messageType,
      subject,
      requiresAck,
      targetCount: dispatches.length,
      dispatches,
      dbFile: paths.dbFile
    };
  }

  async function messageFlowReconcile(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const stuckAfterMs = Math.max(60_000, Math.min(24 * 3600_000, Number(input.messageFlowStuckAfterMs || input.message_flow_stuck_after_ms || input.stuckAfterMs || input.stuck_after_ms || 5 * 60_000)));
    const limit = Math.max(1, Math.min(200, Number(input.messageFlowReconcileLimit || input.message_flow_reconcile_limit || input.limit || 20)));
    const cutoff = new Date(Date.now() - stuckAfterMs).toISOString();
    const recoveredSemanticContinuations = await recoverAckedMessageFlowSemanticContinuations(paths, { cutoff, limit });
    const rows = await sqlite(paths.dbFile, `
SELECT mf.*, o.status AS outbox_status, o.updated_at AS outbox_updated_at, o.target_kind, o.target_ref, o.payload_json AS outbox_payload_json
FROM message_flows mf
LEFT JOIN telegram_outbox o ON o.outbox_id=mf.outbox_id
WHERE (
    mf.final_output_present=1
    AND mf.delivery_receipt_present=0
    AND mf.return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])})
    AND mf.target_runtime NOT IN ('local_codex','codex')
    AND mf.runtime_completed_at IS NOT NULL
    AND mf.runtime_completed_at != ''
    AND mf.runtime_completed_at < ${sqlValue(cutoff)}
    AND mf.status NOT IN ('telegram_sent','telegram_failed')
  )
  OR (
    mf.final_output_present=0
    AND mf.delivery_receipt_present=0
    AND mf.target_runtime NOT IN ('local_codex','codex')
    AND mf.status='runtime_failed'
    AND mf.outbox_id IS NOT NULL
    AND mf.outbox_id != ''
    AND mf.runtime_failed_at IS NOT NULL
    AND mf.runtime_failed_at != ''
    AND mf.runtime_failed_at < ${sqlValue(cutoff)}
  )
ORDER BY mf.runtime_completed_at
LIMIT ${limit};`, { json: true });
    const incidents = [];
    for (const row of rows) {
      if (["sent", "failed"].includes(String(row.outbox_status || ""))) {
        const outboxPayload = parseJsonValue(row.outbox_payload_json, {});
        const synced = await updateMessageFlowFromTelegramDelivery(paths, {
          outbox_id: row.outbox_id,
          target_ref: row.target_ref || "",
          payload_json: JSON.stringify({
            ...outboxPayload,
            messageFlowId: outboxPayload.messageFlowId || row.flow_id
          })
        }, {
          status: row.outbox_status,
          target: row.target_ref || "",
          reconciled: true,
          receipts: Array.isArray(outboxPayload.delivery?.receipts) ? outboxPayload.delivery.receipts : [],
          error: outboxPayload.delivery?.error || ""
        });
        await appendMessageFlowEvent(paths, row.flow_id, synced?.status || row.status, "outbox_terminal_state_reconciled", {
          outboxId: row.outbox_id,
          outboxStatus: row.outbox_status,
          deliveryReceiptPresent: Number(synced?.delivery_receipt_present || 0) === 1
        });
        incidents.push({
          flowId: row.flow_id,
          dispatchId: row.dispatch_id || "",
          status: "reconciled_from_outbox",
          outboxId: row.outbox_id,
          outboxStatus: row.outbox_status,
          messageFlowStatus: synced?.status || ""
        });
        continue;
      }
      const incidentId = `message-flow-stuck-${cleanFileSegment(row.flow_id)}`;
      const minutes = Math.round(stuckAfterMs / 60_000);
      const summary = Number(row.final_output_present || 0) === 1
        ? `message_flow ${row.flow_id} runtime completed but Telegram delivery receipt is still missing after ${minutes}m`
        : `message_flow ${row.flow_id} runtime failed but failure-notice delivery receipt is still missing after ${minutes}m`;
      const incident = await incidentState(paths.root, {
        incidentId,
        status: "active",
        mode: "degraded",
        commander: "trading-agents-workflow",
        affectedPlanes: ["workflow", "runtime_bridge", "telegram"],
        summary,
        impact: Number(row.final_output_present || 0) === 1
          ? "A non-OpenClaw agent produced runtime output, but the user-visible reply has not been confirmed by Telegram delivery receipt."
          : "A non-OpenClaw agent failed, and the user-visible failure notice has not been confirmed by Telegram delivery receipt.",
        currentHypothesis: row.outbox_id
          ? `telegram_outbox ${row.outbox_id} status=${row.outbox_status || "missing"}`
          : "message_flow has no outbound outbox id after runtime completion",
        mitigation: "30s control loop records this incident and lets telegram_outbox delivery/retry continue under queue governance.",
        rollbackOptions: "No destructive rollback. Preserve flow, dispatch, runtime_run, and outbox evidence; inspect Telegram delivery and return path.",
        exitCriteria: "message_flows.delivery_receipt_present=1 and status=telegram_sent, or the flow is explicitly marked telegram_failed with evidence.",
        timeline: [
          `${nowIso()} ${summary}`,
          `flow=${row.flow_id} dispatch=${row.dispatch_id || ""} outbox=${row.outbox_id || ""} outbox_status=${row.outbox_status || ""}`
        ],
        payload: {
          flowId: row.flow_id,
          dispatchId: row.dispatch_id || "",
          runtimeRunId: row.runtime_run_id || "",
          messageId: row.message_id || "",
          outboxId: row.outbox_id || "",
          outboxStatus: row.outbox_status || "",
          targetKind: row.target_kind || "",
          targetRef: row.target_ref || "",
          runtimeCompletedAt: row.runtime_completed_at || "",
          status: row.status,
          stuckAfterMs,
          cutoff
        }
      });
      await appendMessageFlowEvent(paths, row.flow_id, row.status, "stuck_incident_recorded", {
        incidentId: incident.incidentId,
        stuckAfterMs,
        outboxId: row.outbox_id || "",
        outboxStatus: row.outbox_status || ""
      });
      incidents.push({
        flowId: row.flow_id,
        status: row.status,
        incidentId: incident.incidentId,
        outboxId: row.outbox_id || "",
        outboxStatus: row.outbox_status || "",
        runtimeCompletedAt: row.runtime_completed_at || ""
      });
    }
    return { operation: "message_flow.reconcile", stuckAfterMs, cutoff, count: rows.length, recoveredSemanticContinuations, incidents, dbFile: paths.dbFile };
  }

  return {
    messageFlowList,
    messageFlowSend,
    messageFlowReconcile
  };
}
