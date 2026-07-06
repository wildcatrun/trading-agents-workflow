import { parseJsonValue } from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const MEETING_CONTROL_ACTION_HANDLER_NAMES = {
  "meeting.resume": "meetingResume",
  "meeting.disperse": "meetingDisperse"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`meeting control action dependency missing: ${name}`);
  return value;
}

export function createMeetingControlActionRegistry(handlers = {}) {
  const entries = Object.entries(MEETING_CONTROL_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing meeting control action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runMeetingControlAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createMeetingControlActionHandlers(context = {}) {
  const appendTranscript = requireContextFunction(context, "appendTranscript");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const nowIso = requireContextFunction(context, "nowIso");
  const safeId = requireContextFunction(context, "safeId");
  const toList = requireContextFunction(context, "toList");

  async function meetingResume(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const eventId = input.eventId || input.event_id || safeId("control");
    const createdAt = nowIso();
    await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'resume', ${sqlValue(input.status || "active")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify(parseJsonValue(input.payload, input.payload || {})))}, ${sqlValue(input.from || "flashcat")}, ${sqlValue(createdAt)});`);
    await appendTranscript(paths, meetingId, `- ${createdAt} [system:resume] ${input.summary || input.text || "meeting resumed"}`);
    return { meetingId, eventId, status: input.status || "active", dbFile: paths.dbFile };
  }

  async function meetingDisperse(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const eventId = input.eventId || input.event_id || safeId("control");
    const targets = toList(input.targets || input.target);
    const createdAt = nowIso();
    await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'disperse', 'queued', ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify({ targets, payload: parseJsonValue(input.payload, input.payload || {}) }))}, ${sqlValue(input.from || "main")}, ${sqlValue(createdAt)});`);
    const dispatches = [];
    for (const target of targets) {
      const [runtimePart, agentPart] = target.includes(":") ? target.split(":", 2) : ["", target];
      const dispatchInput = {
        meetingId,
        agentId: agentPart,
        dispatchType: "execute_meeting_conclusion",
        prompt: input.summary || input.text || "",
        priority: input.priority || "high",
        createdBy: input.from || "main",
        payload: input.payload
      };
      if (runtimePart) dispatchInput.runtime = runtimePart;
      dispatches.push(await meetingDispatch(rootDir, dispatchInput));
    }
    return { meetingId, eventId, status: "queued", dispatches, dbFile: paths.dbFile };
  }

  return {
    meetingResume,
    meetingDisperse
  };
}
