import path from "node:path";
import { parseJsonValue } from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const MEETING_INGEST_ACTION_HANDLER_NAMES = {
  "meeting.ingest": "meetingIngest"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`meeting ingest action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`meeting ingest action dependency missing: ${name}`);
  return context[name];
}

export function createMeetingIngestActionRegistry(handlers = {}) {
  const entries = Object.entries(MEETING_INGEST_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing meeting ingest action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runMeetingIngestAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createMeetingIngestActionHandlers(context = {}) {
  const appendJsonl = requireContextFunction(context, "appendJsonl");
  const appendTranscript = requireContextFunction(context, "appendTranscript");
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const enqueueTelegramOutbox = requireContextFunction(context, "enqueueTelegramOutbox");
  const ensureRuntimeAgent = requireContextFunction(context, "ensureRuntimeAgent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const nowIso = requireContextFunction(context, "nowIso");
  const safeId = requireContextFunction(context, "safeId");
  const telegramLinkFor = requireContextFunction(context, "telegramLinkFor");
  const DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID = requireContextValue(context, "DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID");
  const REPORT_MESSAGE_TYPES = requireContextValue(context, "REPORT_MESSAGE_TYPES");

  async function meetingIngest(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const runtime = normalizeRuntime(input.runtime);
    const agentId = normalizeAgentId(input.agentId || input.agent_id || input.from || "unknown");
    const agent = await ensureRuntimeAgent(paths, { runtime, agentId, displayName: input.displayName || input.display_name || "", preserveExisting: true });
    const messageId = input.messageId || input.message_id || safeId("msg");
    const createdAt = nowIso();
    const text = String(input.text || input.summary || "").trim();
    if (!text) throw new Error("text is required");
    const messageType = String(input.messageType || input.message_type || "agent_message").trim();
    const payload = parseJsonValue(input.payload, input.payload || {});
    await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_messages(message_id, meeting_id, runtime, agent_id, agent_key, message_type, phase, text, payload_json, telegram_live_status, created_at)
VALUES (${sqlValue(messageId)}, ${sqlValue(meetingId)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(messageType)}, ${sqlValue(input.phase || "")}, ${sqlValue(text)}, ${sqlValue(JSON.stringify(payload))}, 'pending', ${sqlValue(createdAt)});`);
    await appendJsonl(path.join(paths.messagesDir, `${cleanFileSegment(meetingId)}.messages.jsonl`), { messageId, meetingId, runtime, agentId, messageType, text, payload, createdAt });
    const transcriptPath = await appendTranscript(paths, meetingId, `- ${createdAt} [${runtime}:${agentId}] ${text}`);
    const link = await telegramLinkFor(paths, meetingId);
    let telegramOutbox = null;
    if (link && String(link.mode || "transparent") !== "silent") {
      const targetRef = link.chat_id || link.channel_id || "";
      if (targetRef) {
        telegramOutbox = await enqueueTelegramOutbox(paths, {
          meetingId,
          targetKind: "group",
          targetRef,
          messageType: "meeting_live",
          text: `[${runtime}:${agentId}] ${text}`,
          payload: { messageId, runtime, agentId, phase: input.phase || "" }
        });
        await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status='queued' WHERE message_id=${sqlValue(messageId)};`);
      } else {
        await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status='failed_missing_target' WHERE message_id=${sqlValue(messageId)};`);
      }
    }
    let reportOutbox = null;
    if (REPORT_MESSAGE_TYPES.has(messageType) && payload.deliverySucceeded !== true) {
      const dispatchId = String(payload.dispatchId || payload.dispatch_id || "").trim();
      reportOutbox = await enqueueTelegramOutbox(paths, {
        outboxId: dispatchId ? `report-${cleanFileSegment(dispatchId)}` : `report-${messageId}`,
        meetingId,
        targetKind: "private",
        targetRef: DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
        messageType,
        text,
        payload: {
          ...payload,
          messageId,
          workflowId: payload.workflowId || payload.workflow_id || meetingId,
          dispatchId,
          reportDeliveryRequired: true,
          account: "cat_claw",
          target: DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID
        }
      });
    }
    return { meetingId, messageId, runtime, agentId, transcriptPath, telegramOutbox, reportOutbox, dbFile: paths.dbFile };
  }

  return {
    meetingIngest
  };
}
