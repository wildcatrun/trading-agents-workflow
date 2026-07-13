import { createHash } from "node:crypto";
import { DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS } from "./control-loop-budget.js";
import {
  boolOption,
  firstText,
  parseJsonValue,
  safeId,
  textHash,
  toList
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

export const MESSAGE_FLOW_STATUSES = new Set(["inbound_received", "route_registered", "runtime_dispatched", "runtime_acknowledged", "semantic_dispatched", "runtime_completed", "runtime_failed", "outbound_queued", "telegram_sent", "telegram_failed"]);
export const MESSAGE_FLOW_RETURN_POLICIES = new Set(["reply_to_source_chat", "report_to_flashcat", "silent"]);
export const MESSAGE_FLOW_DELIVERY_RETURN_POLICIES = new Set(["reply_to_source_chat", "report_to_flashcat"]);
export const DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS = 90;
export const DEFAULT_RUNTIME_ACK_RETRY_SECONDS = 30;
export const DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS = 3;
export const TEST_SEMANTIC_CONTINUATION_FAILURE_ENV = "TRADING_AGENTS_WORKFLOW_TEST_SEMANTIC_CONTINUATION_FAILURE";

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

function contextFunction(context, name) {
  return (...args) => requireContextFunction(context, name)(...args);
}

function contextValue(context, name, fallback = undefined) {
  return name in (context || {}) ? context[name] : fallback;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function compactText(value, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function normalizeMessageFlowReturnPolicy(value, fallback = "silent") {
  const normalized = String(value || "").trim();
  if (MESSAGE_FLOW_RETURN_POLICIES.has(normalized)) return normalized;
  return MESSAGE_FLOW_RETURN_POLICIES.has(fallback) ? fallback : "silent";
}

export function createMessageFlowRuntimeHelpers(context = {}) {
  const cleanFileSegment = contextFunction(context, "cleanFileSegment");
  const deliverTelegramOutboxRow = contextFunction(context, "deliverTelegramOutboxRow");
  const enqueueTelegramOutbox = contextFunction(context, "enqueueTelegramOutbox");
  const meetingDispatch = contextFunction(context, "meetingDispatch");
  const normalizeAgentId = contextFunction(context, "normalizeAgentId");
  const normalizeRuntime = contextFunction(context, "normalizeRuntime");
  const nowIso = contextFunction(context, "nowIso");
  const runtimeAckContract = contextFunction(context, "runtimeAckContract");
  const normalizeReturnPolicy = typeof context?.normalizeReturnPolicy === "function"
    ? context.normalizeReturnPolicy
    : normalizeMessageFlowReturnPolicy;
  const DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID = contextValue(context, "DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID", "");

  function messageFlowIdFromParts(...parts) {
    const seed = parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n") || safeId("flow");
    return `flow.${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  }

  function messageFlowSendTargets(input = {}) {
    const rawTargets = input.targets ?? input.toAgents ?? input.to_agents ?? input.toAgent ?? input.to_agent ?? input.to ?? input.target ?? input.agentId ?? input.agent_id;
    const targetItems = Array.isArray(rawTargets)
      ? rawTargets
      : (typeof rawTargets === "string" ? toList(rawTargets) : (rawTargets ? [rawTargets] : []));
    const fallbackRuntime = String(input.targetRuntime || input.target_runtime || input.runtime || "").trim();
    const seen = new Set();
    const targets = [];
    for (const item of targetItems) {
      let runtime = "";
      let agentId = "";
      if (item && typeof item === "object") {
        runtime = String(item.runtime || item.platform || "").trim();
        agentId = String(item.agentId || item.agent_id || item.agent || item.id || "").trim();
      } else {
        const text = String(item || "").trim();
        if (!text) continue;
        const parts = text.includes(":") ? text.split(":", 2) : ["", text];
        runtime = parts[0] || "";
        agentId = parts[1] || "";
      }
      agentId = normalizeAgentId(agentId);
      runtime = runtime ? normalizeRuntime(runtime) : (fallbackRuntime ? normalizeRuntime(fallbackRuntime) : "");
      const key = `${runtime || "*"}:${agentId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ runtime, agentId, key });
    }
    if (!targets.length) throw new Error("at least one target/toAgent is required for workflow.message_flow.send");
    return targets;
  }

  function messageFlowAckTimeoutSeconds(input = {}) {
    const raw = input.ackTimeoutSeconds ?? input.ack_timeout_seconds ?? DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS;
    return Math.max(5, Math.min(300, Number(raw) || DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS));
  }

  function messageFlowSendPrompt(input = {}) {
    const subject = String(input.subject || input.title || "").trim();
    const body = String(input.body || input.text || input.message || input.content || "").trim();
    const sourceRefs = toList(input.sourceRefs || input.source_refs || input.artifacts || input.artifactRefs || input.artifact_refs);
    const requiresAck = boolOption(input.requiresAck ?? input.requires_ack, false);
    const ackTimeoutSeconds = messageFlowAckTimeoutSeconds(input);
    if (!subject && !body) throw new Error("body/text/message or subject is required for workflow.message_flow.send");
    const lines = [];
    if (subject) lines.push(`Subject: ${subject}`);
    if (body) lines.push(body);
    if (sourceRefs.length) lines.push(["Source refs:", ...sourceRefs.map((ref) => `- ${ref}`)].join("\n"));
    if (requiresAck) {
      lines.push([
        "Immediate ACK required:",
        `- First runtime turn must return ACK_RECEIVED within ${ackTimeoutSeconds}s after receiving the complete message.`,
        "- The ACK only confirms receipt and message integrity; it is not the semantic task result.",
        "- Include an ISO timestamp, dispatch id if visible, message_flow id if visible, and a one-line received scope.",
        `- If no ACK is received, workflow retries on the ${DEFAULT_RUNTIME_ACK_RETRY_SECONDS}s governed control-loop path.`
      ].join("\n"));
    }
    return { subject, body, sourceRefs, prompt: lines.join("\n\n") };
  }

  function messageFlowStatusTimestampColumn(status) {
    return {
      inbound_received: "inbound_received_at",
      route_registered: "route_registered_at",
      runtime_dispatched: "runtime_dispatched_at",
      runtime_acknowledged: "",
      semantic_dispatched: "",
      runtime_completed: "runtime_completed_at",
      runtime_failed: "runtime_failed_at",
      outbound_queued: "outbound_queued_at",
      telegram_sent: "telegram_sent_at",
      telegram_failed: "telegram_failed_at"
    }[status] || "";
  }

  const MESSAGE_FLOW_STATUS_RANK = {
    inbound_received: 1,
    route_registered: 2,
    runtime_dispatched: 3,
    runtime_acknowledged: 4,
    semantic_dispatched: 5,
    runtime_failed: 6,
    runtime_completed: 6,
    outbound_queued: 7,
    telegram_failed: 8,
    telegram_sent: 9
  };

  function isMessageFlowStatusRegression(currentStatus, nextStatus) {
    if (!currentStatus || currentStatus === nextStatus) return false;
    if (currentStatus === "telegram_sent" && nextStatus !== "telegram_sent") return true;
    if (currentStatus === "telegram_failed" && !["telegram_failed", "telegram_sent"].includes(nextStatus)) return true;
    const currentRank = MESSAGE_FLOW_STATUS_RANK[currentStatus] || 0;
    const nextRank = MESSAGE_FLOW_STATUS_RANK[nextStatus] || 0;
    if (currentRank && nextRank && nextRank < currentRank) return true;
    if (currentStatus === "runtime_completed" && nextStatus === "runtime_failed") return true;
    return false;
  }

  async function appendMessageFlowEvent(paths, flowId, status, eventType, payload = {}) {
    await sqlite(paths.dbFile, `
INSERT INTO message_flow_events(event_id, flow_id, status, event_type, payload_json, created_at)
VALUES (${sqlValue(safeId("flowevt"))}, ${sqlValue(flowId)}, ${sqlValue(status)}, ${sqlValue(eventType)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(nowIso())});`);
  }

  async function createMessageFlow(paths, input = {}) {
    const createdAt = input.createdAt || input.created_at || nowIso();
    const flowId = String(input.flowId || input.flow_id || messageFlowIdFromParts(input.idempotencyKey || input.idempotency_key, input.traceId || input.trace_id, input.meetingId || input.meeting_id)).trim();
    const status = MESSAGE_FLOW_STATUSES.has(String(input.status || "inbound_received")) ? String(input.status || "inbound_received") : "inbound_received";
    const returnPolicy = normalizeReturnPolicy(input.returnPolicy || input.return_policy, "silent");
    const payload = parseJsonValue(input.payload, input.payload || {});
    const timestampColumn = messageFlowStatusTimestampColumn(status);
    await sqlite(paths.dbFile, `
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, runtime_run_id, message_id, outbox_id, source_channel, source_system, source_runtime, source_account_id, source_chat_id, sender_id, source_message_id, route_agent_id, route_runtime, target_runtime, target_agent_id, target_platform, workflow_ingress_adapter, im_identity, execution_identity, return_policy, status, inbound_received_at, route_registered_at, runtime_dispatched_at, runtime_completed_at, runtime_failed_at, outbound_queued_at, telegram_sent_at, telegram_failed_at, completed_at, failure_type, last_error, final_output_present, delivery_receipt_present, payload_json, created_at, updated_at)
VALUES (${sqlValue(flowId)}, ${sqlValue(input.traceId || input.trace_id || "")}, ${sqlValue(input.idempotencyKey || input.idempotency_key || "")}, ${sqlValue(input.meetingId || input.meeting_id || "")}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.dispatchId || input.dispatch_id || "")}, ${sqlValue(input.runtimeRunId || input.runtime_run_id || "")}, ${sqlValue(input.messageId || input.message_id || "")}, ${sqlValue(input.outboxId || input.outbox_id || "")}, ${sqlValue(input.sourceChannel || input.source_channel || "")}, ${sqlValue(input.sourceSystem || input.source_system || "")}, ${sqlValue(input.sourceRuntime || input.source_runtime || "")}, ${sqlValue(input.sourceAccountId || input.source_account_id || "")}, ${sqlValue(input.sourceChatId || input.source_chat_id || "")}, ${sqlValue(input.senderId || input.sender_id || "")}, ${sqlValue(input.sourceMessageId || input.source_message_id || "")}, ${sqlValue(input.routeAgentId || input.route_agent_id || "")}, ${sqlValue(input.routeRuntime || input.route_runtime || "")}, ${sqlValue(input.targetRuntime || input.target_runtime || "")}, ${sqlValue(input.targetAgentId || input.target_agent_id || "")}, ${sqlValue(input.targetPlatform || input.target_platform || "")}, ${sqlValue(input.workflowIngressAdapter || input.workflow_ingress_adapter || "")}, ${sqlValue(input.imIdentity || input.im_identity || "")}, ${sqlValue(input.executionIdentity || input.execution_identity || "")}, ${sqlValue(returnPolicy)}, ${sqlValue(status)}, ${sqlValue(timestampColumn === "inbound_received_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "route_registered_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "runtime_dispatched_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "runtime_completed_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "runtime_failed_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "outbound_queued_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "telegram_sent_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "telegram_failed_at" ? createdAt : "")}, ${sqlValue(["telegram_sent", "telegram_failed"].includes(status) ? createdAt : "")}, ${sqlValue(input.failureType || input.failure_type || "")}, ${sqlValue(input.lastError || input.last_error || "")}, ${sqlValue(input.finalOutputPresent ? 1 : 0)}, ${sqlValue(input.deliveryReceiptPresent ? 1 : 0)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(flow_id) DO UPDATE SET
  trace_id=CASE WHEN excluded.trace_id != '' THEN excluded.trace_id ELSE message_flows.trace_id END,
  idempotency_key=CASE WHEN excluded.idempotency_key != '' THEN excluded.idempotency_key ELSE message_flows.idempotency_key END,
  meeting_id=CASE WHEN excluded.meeting_id != '' THEN excluded.meeting_id ELSE message_flows.meeting_id END,
  workflow_id=CASE WHEN excluded.workflow_id != '' THEN excluded.workflow_id ELSE message_flows.workflow_id END,
  dispatch_id=CASE WHEN excluded.dispatch_id != '' THEN excluded.dispatch_id ELSE message_flows.dispatch_id END,
  runtime_run_id=CASE WHEN excluded.runtime_run_id != '' THEN excluded.runtime_run_id ELSE message_flows.runtime_run_id END,
  message_id=CASE WHEN excluded.message_id != '' THEN excluded.message_id ELSE message_flows.message_id END,
  outbox_id=CASE WHEN excluded.outbox_id != '' THEN excluded.outbox_id ELSE message_flows.outbox_id END,
  source_channel=CASE WHEN excluded.source_channel != '' THEN excluded.source_channel ELSE message_flows.source_channel END,
  source_system=CASE WHEN excluded.source_system != '' THEN excluded.source_system ELSE message_flows.source_system END,
  source_runtime=CASE WHEN excluded.source_runtime != '' THEN excluded.source_runtime ELSE message_flows.source_runtime END,
  source_account_id=CASE WHEN excluded.source_account_id != '' THEN excluded.source_account_id ELSE message_flows.source_account_id END,
  source_chat_id=CASE WHEN excluded.source_chat_id != '' THEN excluded.source_chat_id ELSE message_flows.source_chat_id END,
  sender_id=CASE WHEN excluded.sender_id != '' THEN excluded.sender_id ELSE message_flows.sender_id END,
  source_message_id=CASE WHEN excluded.source_message_id != '' THEN excluded.source_message_id ELSE message_flows.source_message_id END,
  route_agent_id=CASE WHEN excluded.route_agent_id != '' THEN excluded.route_agent_id ELSE message_flows.route_agent_id END,
  route_runtime=CASE WHEN excluded.route_runtime != '' THEN excluded.route_runtime ELSE message_flows.route_runtime END,
  target_runtime=CASE WHEN excluded.target_runtime != '' THEN excluded.target_runtime ELSE message_flows.target_runtime END,
  target_agent_id=CASE WHEN excluded.target_agent_id != '' THEN excluded.target_agent_id ELSE message_flows.target_agent_id END,
  target_platform=CASE WHEN excluded.target_platform != '' THEN excluded.target_platform ELSE message_flows.target_platform END,
  workflow_ingress_adapter=CASE WHEN excluded.workflow_ingress_adapter != '' THEN excluded.workflow_ingress_adapter ELSE message_flows.workflow_ingress_adapter END,
  im_identity=CASE WHEN excluded.im_identity != '' THEN excluded.im_identity ELSE message_flows.im_identity END,
  execution_identity=CASE WHEN excluded.execution_identity != '' THEN excluded.execution_identity ELSE message_flows.execution_identity END,
  return_policy=CASE WHEN excluded.return_policy != 'silent' OR message_flows.return_policy='' THEN excluded.return_policy ELSE message_flows.return_policy END,
  status=CASE
    WHEN message_flows.status='telegram_sent' AND excluded.status!='telegram_sent' THEN message_flows.status
    WHEN message_flows.status='telegram_failed' AND excluded.status NOT IN ('telegram_failed','telegram_sent') THEN message_flows.status
    ELSE excluded.status
  END,
  inbound_received_at=CASE WHEN excluded.inbound_received_at != '' THEN excluded.inbound_received_at ELSE message_flows.inbound_received_at END,
  route_registered_at=CASE WHEN excluded.route_registered_at != '' THEN excluded.route_registered_at ELSE message_flows.route_registered_at END,
  runtime_dispatched_at=CASE WHEN excluded.runtime_dispatched_at != '' THEN excluded.runtime_dispatched_at ELSE message_flows.runtime_dispatched_at END,
  runtime_completed_at=CASE WHEN excluded.runtime_completed_at != '' THEN excluded.runtime_completed_at ELSE message_flows.runtime_completed_at END,
  runtime_failed_at=CASE WHEN excluded.runtime_failed_at != '' THEN excluded.runtime_failed_at ELSE message_flows.runtime_failed_at END,
  outbound_queued_at=CASE WHEN excluded.outbound_queued_at != '' THEN excluded.outbound_queued_at ELSE message_flows.outbound_queued_at END,
  telegram_sent_at=CASE WHEN excluded.telegram_sent_at != '' THEN excluded.telegram_sent_at ELSE message_flows.telegram_sent_at END,
  telegram_failed_at=CASE WHEN excluded.telegram_failed_at != '' THEN excluded.telegram_failed_at ELSE message_flows.telegram_failed_at END,
  completed_at=CASE WHEN excluded.completed_at != '' THEN excluded.completed_at ELSE message_flows.completed_at END,
  failure_type=CASE WHEN excluded.failure_type != '' THEN excluded.failure_type ELSE message_flows.failure_type END,
  last_error=CASE WHEN excluded.last_error != '' THEN excluded.last_error ELSE message_flows.last_error END,
  final_output_present=CASE WHEN excluded.final_output_present != 0 THEN excluded.final_output_present ELSE message_flows.final_output_present END,
  delivery_receipt_present=CASE WHEN excluded.delivery_receipt_present != 0 THEN excluded.delivery_receipt_present ELSE message_flows.delivery_receipt_present END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
    await appendMessageFlowEvent(paths, flowId, status, "state", payload);
    return { flowId, status, returnPolicy };
  }

  async function readMessageFlow(paths, flowId) {
    if (!flowId) return null;
    const rows = await sqlite(paths.dbFile, `SELECT * FROM message_flows WHERE flow_id=${sqlValue(flowId)} LIMIT 1;`, { json: true });
    return rows[0] || null;
  }

  function messageFlowIdFromDispatchPayload(row = {}) {
    const payload = parseJsonValue(row.payload_json, {});
    return String(payload.messageFlowId || payload.message_flow_id || payload.routeShell?.messageFlowId || payload.routeShell?.message_flow_id || payload.payload?.messageFlowId || payload.payload?.routeShell?.messageFlowId || "").trim();
  }

  function dispatchPayloadObject(row = {}) {
    return parseJsonValue(row.payload_json, {});
  }

  function isSemanticContinuationDispatch(row = {}) {
    const payload = dispatchPayloadObject(row);
    const nested = objectValue(payload.payload);
    return boolOption(payload.semanticContinuation ?? payload.semantic_continuation ?? nested.semanticContinuation ?? nested.semantic_continuation, false);
  }

  function semanticContinuationTimeoutSeconds(payload = {}, input = {}, fallbackSeconds = DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS, maxSeconds = 3600) {
    const nested = objectValue(payload.payload);
    const raw = Number(
      nested.semanticTimeoutSeconds ??
      nested.semantic_timeout_seconds ??
      payload.semanticTimeoutSeconds ??
      payload.semantic_timeout_seconds ??
      nested.timeoutSeconds ??
      nested.timeout_seconds ??
      payload.timeoutSeconds ??
      payload.timeout_seconds ??
      input.semanticTimeoutSeconds ??
      input.semantic_timeout_seconds ??
      fallbackSeconds
    );
    return Math.max(60, Math.min(maxSeconds, Number.isFinite(raw) && raw > 0 ? raw : fallbackSeconds));
  }

  function messageFlowDispatchStartedStatus(row = {}) {
    return isSemanticContinuationDispatch(row) ? "semantic_dispatched" : "runtime_dispatched";
  }

  async function messageFlowForDispatch(paths, row = {}) {
    const flowId = messageFlowIdFromDispatchPayload(row);
    if (flowId) return readMessageFlow(paths, flowId);
    const rows = await sqlite(paths.dbFile, `SELECT * FROM message_flows WHERE dispatch_id=${sqlValue(row.dispatch_id || "")} LIMIT 1;`, { json: true });
    return rows[0] || null;
  }

  async function updateMessageFlow(paths, flowId, status, patch = {}) {
    if (!flowId || !MESSAGE_FLOW_STATUSES.has(status)) return null;
    const rows = await sqlite(paths.dbFile, `SELECT status, payload_json FROM message_flows WHERE flow_id=${sqlValue(flowId)} LIMIT 1;`, { json: true });
    if (!rows[0]) return null;
    const currentStatus = String(rows[0].status || "").trim();
    if (isMessageFlowStatusRegression(currentStatus, status)) {
      await appendMessageFlowEvent(paths, flowId, currentStatus, "state_regression_blocked", {
        attemptedStatus: status,
        reason: "terminal_message_flow_status_is_monotonic",
        payload: patch.payload || {}
      });
      return readMessageFlow(paths, flowId);
    }
    const existingPayload = parseJsonValue(rows[0].payload_json, {});
    const payload = { ...existingPayload, ...parseJsonValue(patch.payload, patch.payload || {}), updatedAt: nowIso() };
    const updatedAt = patch.updatedAt || patch.updated_at || nowIso();
    const timestampColumn = messageFlowStatusTimestampColumn(status);
    const assignments = [
      `status=${sqlValue(status)}`,
      `payload_json=${sqlValue(JSON.stringify(payload))}`,
      `updated_at=${sqlValue(updatedAt)}`
    ];
    if (timestampColumn) assignments.push(`${timestampColumn}=${sqlValue(updatedAt)}`);
    if (["telegram_sent", "telegram_failed"].includes(status)) assignments.push(`completed_at=${sqlValue(updatedAt)}`);
    if (patch.dispatchId || patch.dispatch_id) assignments.push(`dispatch_id=${sqlValue(patch.dispatchId || patch.dispatch_id)}`);
    if (patch.runtimeRunId || patch.runtime_run_id) assignments.push(`runtime_run_id=${sqlValue(patch.runtimeRunId || patch.runtime_run_id)}`);
    if (patch.messageId || patch.message_id) assignments.push(`message_id=${sqlValue(patch.messageId || patch.message_id)}`);
    if (patch.outboxId || patch.outbox_id) assignments.push(`outbox_id=${sqlValue(patch.outboxId || patch.outbox_id)}`);
    if (patch.failureType || patch.failure_type) assignments.push(`failure_type=${sqlValue(patch.failureType || patch.failure_type)}`);
    if (patch.lastError || patch.last_error) assignments.push(`last_error=${sqlValue(String(patch.lastError || patch.last_error).slice(0, 2000))}`);
    if (patch.finalOutputPresent !== undefined || patch.final_output_present !== undefined) assignments.push(`final_output_present=${sqlValue((patch.finalOutputPresent ?? patch.final_output_present) ? 1 : 0)}`);
    if (patch.deliveryReceiptPresent !== undefined || patch.delivery_receipt_present !== undefined) assignments.push(`delivery_receipt_present=${sqlValue((patch.deliveryReceiptPresent ?? patch.delivery_receipt_present) ? 1 : 0)}`);
    await sqlite(paths.dbFile, `UPDATE message_flows SET ${assignments.join(", ")} WHERE flow_id=${sqlValue(flowId)};`);
    await appendMessageFlowEvent(paths, flowId, status, "state", patch.payload || {});
    return readMessageFlow(paths, flowId);
  }

  function messageFlowSourceChannel(input = {}, originalPayload = {}) {
    const beforeDispatch = objectValue(originalPayload.beforeDispatch || originalPayload.before_dispatch);
    const sourceSystem = String(input.sourceSystem || input.source_system || "").toLowerCase();
    return firstText(input.sourceChannel, input.source_channel, input.channelId, input.channel_id, input.channel, beforeDispatch.channel, sourceSystem.includes("telegram") ? "telegram" : "");
  }

  function messageFlowOutputIsFinal(text = "") {
    const value = String(text || "").trim();
    const lower = value.toLowerCase();
    const requestFailedPlaceholder = /^(llm|model|runtime|agent) request failed(?:[\.:][^\r\n]*)?$/i;
    if (!value) return false;
    if (/^heartbeat_(ok|degraded)\b/i.test(value)) return true;
    if (requestFailedPlaceholder.test(value)) return false;
    if (lower.startsWith("operation interrupted:")) return false;
    if (lower.includes("operation interrupted") && (lower.includes("waiting for model response") || lower.includes("cancelled"))) return false;
    return true;
  }

  function messageFlowSemanticPromptFromPayload(payload = {}, fallback = "") {
    const subject = String(payload.subject || payload.title || "").trim();
    const body = String(payload.body || payload.text || payload.message || payload.content || "").trim();
    const sourceRefs = toList(payload.sourceRefs || payload.source_refs || payload.artifacts || payload.artifactRefs || payload.artifact_refs);
    const lines = [];
    if (subject) lines.push(`Subject: ${subject}`);
    if (body) lines.push(body);
    if (sourceRefs.length) lines.push(["Source refs:", ...sourceRefs.map((ref) => `- ${ref}`)].join("\n"));
    return lines.join("\n\n") || String(fallback || "").trim();
  }

  function messageFlowAckDispatchId(flow = {}) {
    const payload = parseJsonValue(flow.payload_json, {});
    return firstText(
      payload.ackDispatchId,
      payload.ack_dispatch_id,
      payload.ack?.dispatchId,
      payload.ack?.dispatch_id,
      flow.dispatch_id
    );
  }

  function messageFlowSemanticIdempotencyKey(flowId, ackDispatchId) {
    return `message-flow-semantic:${flowId}:${ackDispatchId}`;
  }

  function messageFlowDeliveryTarget(flow = {}) {
    const returnPolicy = normalizeReturnPolicy(flow.return_policy, "silent");
    if (returnPolicy === "silent") return null;
    if (returnPolicy === "report_to_flashcat") {
      return { targetKind: "private", targetRef: DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID, account: "cat_claw", mode: returnPolicy };
    }
    if (returnPolicy === "reply_to_source_chat") {
      if (String(flow.source_channel || "").toLowerCase() !== "telegram" || !String(flow.source_chat_id || "").trim()) return null;
      const targetRef = String(flow.source_chat_id || "").trim();
      return {
        targetKind: targetRef.startsWith("-") ? "group" : "private",
        targetRef,
        account: firstText(flow.source_account_id, flow.route_agent_id, flow.target_agent_id, "cat_claw"),
        mode: returnPolicy
      };
    }
    return null;
  }

  function formatMessageFlowFailureText(flow = {}, data = {}) {
    const agent = firstText(flow.target_agent_id, flow.route_agent_id, "unknown");
    const failureType = firstText(data.failureType, data.failure_type, flow.failure_type, "runtime_failed");
    const error = compactText(firstText(data.error, data.lastError, data.last_error, flow.last_error, "非 OpenClaw agent 本轮没有产出可投递的正式回复。"), 900);
    return [
      `【${agent} 未产出有效回复】`,
      `时间：${nowIso()}`,
      `Flow：${flow.flow_id || ""}`,
      `Dispatch：${flow.dispatch_id || ""}`,
      `状态：${failureType}`,
      `原因：${error}`,
      "",
      "说明：route-shell 只表示入口已登记；本消息来自 workflow 的跨平台消息流状态机，不把 route-shell ack 或 Hermers 空输出伪装成正式回复。"
    ].join("\n");
  }

  async function enqueueMessageFlowOutbound(paths, flow, text, input = {}, extraPayload = {}) {
    if (!flow?.flow_id) return { status: "skipped", reason: "missing_flow" };
    const target = messageFlowDeliveryTarget(flow);
    if (!target) {
      await appendMessageFlowEvent(paths, flow.flow_id, flow.status || "runtime_completed", "delivery_skipped", { reason: "return_policy_silent_or_missing_target" });
      return { status: "delivery_skipped", reason: "return_policy_silent_or_missing_target", flowId: flow.flow_id };
    }
    const outboxId = flow.outbox_id || `flow-${cleanFileSegment(flow.flow_id)}`;
    let rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
    if (!rows[0]) {
      await enqueueTelegramOutbox(paths, {
        outboxId,
        meetingId: flow.meeting_id,
        targetKind: target.targetKind,
        targetRef: target.targetRef,
        messageType: "message_flow_reply",
        text,
        payload: {
          ...extraPayload,
          messageFlowId: flow.flow_id,
          dispatchId: flow.dispatch_id || "",
          messageId: flow.message_id || "",
          returnPolicy: flow.return_policy || "",
          account: target.account,
          target: target.targetRef,
          flowDeliveryRequired: true
        }
      });
      const flowFailedWithoutOutput = Number(flow.final_output_present || 0) === 0
        && String(flow.status || "") === "runtime_failed"
        && (extraPayload.finalOutputPresent === false || extraPayload.final_output_present === false);
      await updateMessageFlow(paths, flow.flow_id, flowFailedWithoutOutput ? "runtime_failed" : "outbound_queued", { outboxId, payload: { outboxId, targetRef: target.targetRef, account: target.account } });
      rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
    }
    const row = rows[0];
    if (!row) return { status: "missing_outbox", outboxId };
    if (row.status === "sent") {
      return updateMessageFlowFromTelegramDelivery(paths, row, {
        outboxId,
        status: "sent",
        account: target.account,
        target: target.targetRef,
        alreadySent: true
      });
    }
    const deliverNow = boolOption(input.autoDeliverMessageFlowOutbox ?? input.auto_deliver_message_flow_outbox ?? input.deliverMessageFlowOutbox ?? input.deliver_message_flow_outbox, true);
    if (!deliverNow || row.status !== "queued") return { status: row.status, outboxId, queued: true };
    return deliverTelegramOutboxRow(paths, row, { ...input, account: target.account, target: target.targetRef });
  }

  async function updateMessageFlowFromTelegramDelivery(paths, row, result = {}) {
    const messageType = String(row.message_type || row.messageType || "").trim();
    if (messageType !== "message_flow_reply") return null;
    const payload = parseJsonValue(row.payload_json, {});
    const flowId = String(payload.messageFlowId || payload.message_flow_id || "").trim();
    if (!flowId) return null;
    const flow = await readMessageFlow(paths, flowId);
    const hasFinalOutput = Number(flow?.final_output_present || 0) === 1;
    const payloadReceipts = Array.isArray(payload.delivery?.receipts) ? payload.delivery.receipts : [];
    const resultReceipts = Array.isArray(result.receipts) ? result.receipts : [];
    const deliveryReceiptVerified = result.status === "sent" && (payloadReceipts.length > 0 || resultReceipts.length > 0);
    const status = result.status === "sent"
      ? (hasFinalOutput ? "telegram_sent" : "runtime_failed")
      : "telegram_failed";
    const messageId = String(payload.messageId || payload.message_id || "").trim();
    if (messageId) {
      await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status=${sqlValue(status === "telegram_sent" ? "sent" : "failed")} WHERE message_id=${sqlValue(messageId)};`);
    }
    return updateMessageFlow(paths, flowId, status, {
      outboxId: row.outbox_id,
      deliveryReceiptPresent: deliveryReceiptVerified,
      lastError: result.error || "",
      payload: { delivery: result }
    });
  }

  async function finishMessageFlowRuntime(paths, row, data = {}, input = {}) {
    const flow = await messageFlowForDispatch(paths, row);
    if (!flow) return null;
    const text = String(data.text || "").trim();
    const finalOutputPresent = data.finalOutputPresent ?? messageFlowOutputIsFinal(text);
    const runtimeRunId = data.runtimeRunId || data.runtime_run_id || "";
    const messageId = data.messageId || data.message_id || "";
    const status = finalOutputPresent ? "runtime_completed" : "runtime_failed";
    const failureType = finalOutputPresent ? "" : firstText(data.failureType, data.failure_type, "incomplete_output");
    const lastError = finalOutputPresent ? "" : firstText(data.lastError, data.last_error, text || "runtime did not produce final output");
    const updated = await updateMessageFlow(paths, flow.flow_id, status, {
      runtimeRunId,
      messageId,
      finalOutputPresent,
      failureType,
      lastError,
      payload: {
        runtimeStatus: status,
        runtimeRunId,
        messageId,
        outputHash: data.outputHash || data.output_hash || "",
        dispatchStatus: row.status
      }
    });
    const latest = updated || await readMessageFlow(paths, flow.flow_id);
    if (String(latest?.status || "") !== status || Boolean(Number(latest?.final_output_present || 0)) !== Boolean(finalOutputPresent)) {
      await appendMessageFlowEvent(paths, flow.flow_id, latest?.status || flow.status || "", "delivery_skipped_after_state_regression_block", {
        attemptedStatus: status,
        attemptedFinalOutputPresent: Boolean(finalOutputPresent),
        persistedStatus: latest?.status || "",
        persistedFinalOutputPresent: Boolean(Number(latest?.final_output_present || 0))
      });
      return {
        status: "state_regression_blocked",
        flowId: flow.flow_id,
        attemptedStatus: status,
        persistedStatus: latest?.status || "",
        deliverySkipped: true
      };
    }
    const deliveryText = finalOutputPresent ? text : formatMessageFlowFailureText(latest || flow, { failureType, lastError });
    return enqueueMessageFlowOutbound(paths, latest || flow, deliveryText, input, {
      runtimeStatus: status,
      failureType,
      finalOutputPresent: Boolean(finalOutputPresent)
    });
  }

  async function acknowledgeMessageFlowRuntime(paths, row, data = {}) {
    const flow = await messageFlowForDispatch(paths, row);
    if (!flow) return null;
    const runtimeRunId = data.runtimeRunId || data.runtime_run_id || "";
    const messageId = data.messageId || data.message_id || "";
    const text = String(data.text || "").trim();
    const updated = await updateMessageFlow(paths, flow.flow_id, "runtime_acknowledged", {
      runtimeRunId,
      messageId,
      finalOutputPresent: false,
      deliveryReceiptPresent: false,
      payload: {
        runtimeStatus: "runtime_acknowledged",
        runtimeRunId,
        messageId,
        ackDispatchId: row.dispatch_id,
        outputHash: data.outputHash || data.output_hash || "",
        dispatchStatus: row.status,
        ack: {
          receivedAt: data.receivedAt || data.received_at || nowIso(),
          text: text.slice(0, 1000)
        }
      }
    });
    return {
      status: updated?.status || "runtime_acknowledged",
      flowId: flow.flow_id,
      finalOutputPresent: false,
      deliveryQueued: false
    };
  }

  async function messageTextForRuntimeReceipt(paths, messageId = "") {
    const id = String(messageId || "").trim();
    if (!id) return "";
    const rows = await sqlite(paths.dbFile, `
SELECT text
FROM mixed_meeting_messages
WHERE message_id=${sqlValue(id)}
LIMIT 1;`, { json: true });
    return String(rows[0]?.text || "").trim();
  }

  async function syncMessageFlowFromTerminalDispatchReceipt(paths, row, receipt = {}, input = {}) {
    const flow = await messageFlowForDispatch(paths, row);
    if (!flow) return null;
    const status = String(receipt.status || "").trim();
    const runtimeRunId = String(receipt.runtimeRunId || receipt.runtime_run_id || "").trim();
    const messageId = String(receipt.messageId || receipt.message_id || "").trim();
    const text = await messageTextForRuntimeReceipt(paths, messageId);
    const outputHash = text ? textHash(text) : "";
    if (status === "acked") {
      const ack = runtimeAckContract(row, input);
      if (ack.required) {
        const result = await acknowledgeMessageFlowRuntime(paths, row, {
          runtimeRunId,
          messageId,
          text,
          outputHash,
          receivedAt: receipt.completedAt || receipt.completed_at || nowIso()
        });
        await appendMessageFlowEvent(paths, flow.flow_id, result?.status || "runtime_acknowledged", "stale_dispatch_terminal_receipt_synced", {
          dispatchId: row.dispatch_id,
          runtimeRunId,
          messageId,
          terminalStatus: status,
          ackRequired: true
        });
        return result;
      }
      return finishMessageFlowRuntime(paths, row, {
        runtimeRunId,
        messageId,
        text,
        outputHash,
        finalOutputPresent: messageFlowOutputIsFinal(text),
        failureType: "runtime_output_missing",
        lastError: text ? "" : "terminal acked runtime receipt did not reference recoverable message text"
      }, input);
    }
    if (status === "failed") {
      return finishMessageFlowRuntime(paths, row, {
        runtimeRunId,
        messageId,
        finalOutputPresent: false,
        failureType: receipt.failureType || receipt.failure_type || "runtime_failed",
        lastError: receipt.error || receipt.lastError || receipt.last_error || "terminal runtime receipt failed"
      }, input);
    }
    await appendMessageFlowEvent(paths, flow.flow_id, flow.status || "", "stale_dispatch_terminal_receipt_sync_skipped", {
      dispatchId: row.dispatch_id,
      runtimeRunId,
      messageId,
      terminalStatus: status || "unknown"
    });
    return { status: "skipped", reason: "unsupported_terminal_status", flowId: flow.flow_id };
  }

  async function queueMessageFlowSemanticContinuation(paths, row, data = {}, input = {}) {
    const ack = runtimeAckContract(row, input);
    if (!ack.required || !ack.semanticContinuation) return null;
    const flow = await messageFlowForDispatch(paths, row);
    if (!flow) return null;
    const payload = dispatchPayloadObject(row);
    const nested = objectValue(payload.payload);
    if (isSemanticContinuationDispatch(row)) return null;
    if (
      boolOption(process.env[TEST_SEMANTIC_CONTINUATION_FAILURE_ENV], false)
      && boolOption(input.forceSemanticContinuationFailure ?? input.force_semantic_continuation_failure, false)
    ) {
      await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_failed", {
        ackDispatchId: row.dispatch_id,
        reason: "forced_semantic_continuation_failure"
      });
      return { status: "failed", reason: "forced_semantic_continuation_failure" };
    }
    const idempotencyKey = messageFlowSemanticIdempotencyKey(flow.flow_id, row.dispatch_id);
    const semanticDispatchId = `dispatch.semantic.${textHash(idempotencyKey).slice(0, 24)}`;
    const semanticPrompt = messageFlowSemanticPromptFromPayload(nested, row.prompt || payload.prompt || "");
    const semanticTimeoutSeconds = semanticContinuationTimeoutSeconds(payload, input);
    const semanticPayload = {
      ...nested,
      requiresAck: false,
      timeoutSeconds: semanticTimeoutSeconds,
      semanticTimeoutSeconds,
      ackContract: {
        ...(objectValue(nested.ackContract || nested.ack_contract)),
        required: false,
        acknowledgedByDispatch: row.dispatch_id,
        acknowledgedByRuntimeRun: data.runtimeRunId || data.runtime_run_id || "",
        acknowledgedAt: data.receivedAt || data.received_at || nowIso()
      },
      semanticContinuation: true,
      semanticContinuationOf: row.dispatch_id,
      ackDispatchId: row.dispatch_id,
      ackRuntimeRunId: data.runtimeRunId || data.runtime_run_id || "",
      ackMessageId: data.messageId || data.message_id || "",
      messageFlowId: flow.flow_id
    };
    let dispatch;
    try {
      dispatch = await meetingDispatch(paths.root, {
        meetingId: row.meeting_id,
        workflowId: row.workflow_id || payload.workflowId || payload.workflow_id || flow.workflow_id || row.meeting_id,
        traceId: row.trace_id || payload.traceId || payload.trace_id || flow.trace_id || safeId("trace"),
        idempotencyKey,
        dispatchId: semanticDispatchId,
        runtime: row.runtime,
        agentId: row.agent_id,
        dispatchType: "message_flow_semantic",
        prompt: semanticPrompt,
        priority: row.priority || "normal",
        createdBy: "workflow:message_flow_ack",
        maxAttempts: input.semanticMaxAttempts || input.semantic_max_attempts || nested.semanticMaxAttempts || nested.semantic_max_attempts || 1,
        timeoutSeconds: semanticTimeoutSeconds,
        returnPolicy: "silent",
        deliveryPolicy: "silent",
        sourceChannel: flow.source_channel || nested.source?.sourceChannel || nested.source?.source_channel || "",
        sourceSystem: "workflow.message_flow.semantic_continuation",
        sourceRuntime: flow.source_runtime || nested.source?.runtime || "",
        sourceAccountId: flow.source_account_id || nested.source?.sourceAccountId || nested.source?.source_account_id || "",
        sourceChatId: flow.source_chat_id || nested.source?.sourceChatId || nested.source?.source_chat_id || "",
        senderId: flow.sender_id || nested.source?.senderId || nested.source?.sender_id || "",
        sourceMessageId: flow.source_message_id || nested.source?.sourceMessageId || nested.source?.source_message_id || "",
        messageFlowId: flow.flow_id,
        payload: semanticPayload
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_failed", {
        ackDispatchId: row.dispatch_id,
        idempotencyKey,
        error: message.slice(0, 2000)
      });
      return { status: "failed", reason: "semantic_continuation_dispatch_failed", error: message };
    }
    await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_queued", {
      ackDispatchId: row.dispatch_id,
      semanticDispatchId: dispatch.dispatchId,
      deduped: Boolean(dispatch.deduped),
      idempotencyKey
    });
    return {
      status: dispatch.status,
      dispatchId: dispatch.dispatchId,
      runtime: dispatch.runtime,
      agentId: dispatch.agentId,
      deduped: Boolean(dispatch.deduped),
      idempotencyKey
    };
  }

  function assertSemanticContinuationQueued(semanticContinuation) {
    if (!semanticContinuation || semanticContinuation.status !== "failed") return;
    throw new Error(`semantic continuation dispatch failed: ${semanticContinuation.error || semanticContinuation.reason || "unknown"}`);
  }

  async function recoverAckedMessageFlowSemanticContinuations(paths, input = {}) {
    const cutoff = input.cutoff || new Date(Date.now() - 5 * 60_000).toISOString();
    const limit = Math.max(1, Math.min(200, Number(input.limit || 20)));
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM message_flows
WHERE status='runtime_acknowledged'
  AND final_output_present=0
  AND delivery_receipt_present=0
  AND updated_at < ${sqlValue(cutoff)}
ORDER BY updated_at
LIMIT ${limit};`, { json: true });
    const results = [];
    for (const flow of rows) {
      const ackDispatchId = messageFlowAckDispatchId(flow);
      if (!ackDispatchId) {
        await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_reconcile_skipped", {
          reason: "missing_ack_dispatch_id"
        });
        results.push({ flowId: flow.flow_id, status: "skipped", reason: "missing_ack_dispatch_id" });
        continue;
      }
      const idempotencyKey = messageFlowSemanticIdempotencyKey(flow.flow_id, ackDispatchId);
      const existing = await sqlite(paths.dbFile, `
SELECT dispatch_id, status
FROM mixed_meeting_dispatches
WHERE dispatch_type='message_flow_semantic'
  AND idempotency_key=${sqlValue(idempotencyKey)}
LIMIT 1;`, { json: true });
      if (existing[0]) {
        await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_reconcile_existing", {
          ackDispatchId,
          semanticDispatchId: existing[0].dispatch_id,
          semanticStatus: existing[0].status,
          idempotencyKey
        });
        results.push({ flowId: flow.flow_id, status: "existing", dispatchId: existing[0].dispatch_id, semanticStatus: existing[0].status });
        continue;
      }
      const dispatchRows = await sqlite(paths.dbFile, `
SELECT *
FROM mixed_meeting_dispatches
WHERE dispatch_id=${sqlValue(ackDispatchId)}
LIMIT 1;`, { json: true });
      const ackDispatch = dispatchRows[0];
      if (!ackDispatch) {
        await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_reconcile_failed", {
          ackDispatchId,
          reason: "ack_dispatch_missing"
        });
        results.push({ flowId: flow.flow_id, status: "failed", reason: "ack_dispatch_missing", ackDispatchId });
        continue;
      }
      const continuation = await queueMessageFlowSemanticContinuation(paths, ackDispatch, {
        runtimeRunId: flow.runtime_run_id || "",
        messageId: flow.message_id || "",
        receivedAt: flow.updated_at || nowIso()
      }, input);
      assertSemanticContinuationQueued(continuation);
      results.push({ flowId: flow.flow_id, status: "queued", ackDispatchId, semanticDispatchId: continuation.dispatchId });
    }
    return results;
  }

  return {
    acknowledgeMessageFlowRuntime,
    appendMessageFlowEvent,
    createMessageFlow,
    dispatchPayloadObject,
    enqueueMessageFlowOutbound,
    finishMessageFlowRuntime,
    isMessageFlowStatusRegression,
    isSemanticContinuationDispatch,
    messageFlowAckDispatchId,
    messageFlowAckTimeoutSeconds,
    messageFlowDeliveryTarget,
    messageFlowDispatchStartedStatus,
    messageFlowForDispatch,
    messageFlowIdFromDispatchPayload,
    messageFlowIdFromParts,
    messageFlowOutputIsFinal,
    messageFlowSemanticIdempotencyKey,
    messageFlowSemanticPromptFromPayload,
    messageFlowSendPrompt,
    messageFlowSendTargets,
    messageFlowSourceChannel,
    messageFlowStatusTimestampColumn,
    messageTextForRuntimeReceipt,
    queueMessageFlowSemanticContinuation,
    readMessageFlow,
    recoverAckedMessageFlowSemanticContinuations,
    semanticContinuationTimeoutSeconds,
    syncMessageFlowFromTerminalDispatchReceipt,
    updateMessageFlow,
    updateMessageFlowFromTelegramDelivery
  };
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
