import path from "node:path";
import { parseJsonValue } from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const MEETING_PARTICIPANT_ACTION_HANDLER_NAMES = {
  "meeting.runtime_participant": "meetingRuntimeParticipant",
  "runtime.participant": "meetingRuntimeParticipant"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`meeting participant action dependency missing: ${name}`);
  return value;
}

export function createMeetingParticipantActionRegistry(handlers = {}) {
  const entries = Object.entries(MEETING_PARTICIPANT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing meeting participant action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runMeetingParticipantAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createMeetingParticipantActionHandlers(context = {}) {
  const appendJsonl = requireContextFunction(context, "appendJsonl");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const findActiveRuntimeAgent = requireContextFunction(context, "findActiveRuntimeAgent");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const nowIso = requireContextFunction(context, "nowIso");

  async function meetingRuntimeParticipant(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const runtime = normalizeRuntime(input.runtime || input.runtimeKey || input.runtime_key || input.platform);
    const agentId = normalizeAgentId(input.agentId || input.agent_id);
    const row = await findActiveRuntimeAgent(paths, runtime, agentId);
    if (!row) {
      throw new Error(`meeting runtime participant requires pre-registered active runtime agent: ${runtime}:${agentId}`);
    }
    const agent = { agentKey: row.agent_key, runtime: row.runtime, agentId: row.agent_id };
    const createdAt = nowIso();
    const participantRole = String(input.participantRole || input.participant_role || input.role || "participant").trim();
    await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_participants(meeting_id, agent_key, runtime, agent_id, participant_role, chair, decider, secretary, live_mode, status, metadata_json, created_at, updated_at)
VALUES (${sqlValue(meetingId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(agent.runtime)}, ${sqlValue(agent.agentId)}, ${sqlValue(participantRole)}, ${sqlValue(Boolean(input.chair))}, ${sqlValue(Boolean(input.decider))}, ${sqlValue(Boolean(input.secretary))}, ${sqlValue(input.liveMode || input.live_mode || "transparent")}, ${sqlValue(input.status || "active")}, ${sqlValue(JSON.stringify(parseJsonValue(input.metadata, input.metadata || {})))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(meeting_id, agent_key) DO UPDATE SET
  participant_role=excluded.participant_role,
  chair=excluded.chair,
  decider=excluded.decider,
  secretary=excluded.secretary,
  live_mode=excluded.live_mode,
  status=excluded.status,
  metadata_json=excluded.metadata_json,
  updated_at=excluded.updated_at;`);
    await appendJsonl(path.join(paths.bridgeDir, "participants.jsonl"), { meetingId, ...agent, participantRole, updatedAt: createdAt });
    return { meetingId, ...agent, participantRole, dbFile: paths.dbFile };
  }

  return {
    meetingRuntimeParticipant
  };
}
