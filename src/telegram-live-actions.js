import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const TELEGRAM_LIVE_ACTION_HANDLER_NAMES = {
  "telegram.live": "telegramLiveConfigure",
  "telegram.live.configure": "telegramLiveConfigure"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`telegram.live action dependency missing: ${name}`);
  return value;
}

export function createTelegramLiveActionRegistry(handlers = {}) {
  const entries = Object.entries(TELEGRAM_LIVE_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing telegram.live action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runTelegramLiveAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createTelegramLiveActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const nowIso = requireContextFunction(context, "nowIso");
  const resolveTelegramLiveTarget = requireContextFunction(context, "resolveTelegramLiveTarget");

  async function telegramLiveConfigure(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const createdAt = nowIso();
    const mode = String(input.mode || "transparent").trim();
    const status = String(input.status || "active").trim();
    const target = await resolveTelegramLiveTarget(paths, meetingId, input);
    if (status === "active" && mode !== "silent" && !target.chatId && !target.channelId) {
      throw new Error(`telegram live target is required for active ${mode} meeting: ${meetingId}`);
    }
    const humanGateChannelId = target.humanGateChannelId || input.humanGateChannelId || input.human_gate_channel_id || target.channelId || target.chatId || "";
    await sqlite(paths.dbFile, `
INSERT INTO telegram_live_links(meeting_id, chat_id, channel_id, mode, status, human_gate_channel_id, created_at, updated_at)
VALUES (${sqlValue(meetingId)}, ${sqlValue(target.chatId)}, ${sqlValue(target.channelId)}, ${sqlValue(mode)}, ${sqlValue(status)}, ${sqlValue(humanGateChannelId)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(meeting_id) DO UPDATE SET
  chat_id=excluded.chat_id,
  channel_id=excluded.channel_id,
  mode=excluded.mode,
  status=excluded.status,
  human_gate_channel_id=excluded.human_gate_channel_id,
  updated_at=excluded.updated_at;`);
    return { meetingId, chatId: target.chatId, channelId: target.channelId, humanGateChannelId, mode, status, targetSource: target.source, dbFile: paths.dbFile };
  }

  return {
    telegramLiveConfigure
  };
}
