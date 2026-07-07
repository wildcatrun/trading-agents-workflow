import {
  jsonHash,
  parseJsonValue,
  redactSensitiveForPersistence,
  safeId,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const EVENT_ACTION_HANDLER_NAMES = {
  "workflow.event.append": "workflowEventAppend",
  "workflow.events.append": "workflowEventAppend",
  "workflow.event.list": "workflowEventList",
  "workflow.events": "workflowEventList",
  "workflow.events.list": "workflowEventList",
  "workflow.event.timeline": "workflowEventTimeline",
  "workflow.timeline": "workflowEventTimeline",
  "workflow.events.timeline": "workflowEventTimeline"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`event action dependency missing: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

export function workflowEventFromRow(row) {
  if (!row) return null;
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    status: row.status,
    workflowId: row.workflow_id || "",
    traceId: row.trace_id || "",
    taskId: row.task_id || "",
    dispatchId: row.dispatch_id || "",
    runtimeRunId: row.runtime_run_id || "",
    messageFlowId: row.message_flow_id || "",
    humanGateId: row.human_gate_id || "",
    sideEffectId: row.side_effect_id || "",
    incidentId: row.incident_id || "",
    actor: row.actor || "",
    sourceRuntime: row.source_runtime || "",
    sourceAgent: row.source_agent || "",
    previousState: row.previous_state || "",
    nextState: row.next_state || "",
    idempotencyKey: row.idempotency_key || "",
    artifactRef: row.artifact_ref || "",
    payloadHash: row.payload_hash || "",
    payload: parseJsonValue(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function workflowEventPayload(input = {}) {
  return redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}));
}

function workflowEventRecordFromInput(input = {}, now = nowIso()) {
  const payload = workflowEventPayload(input);
  const eventType = String(input.eventType || input.event_type || input.type || "").trim();
  if (!eventType) throw new Error("workflow eventType is required");
  const canonicalPayloadHash = jsonHash(payload);
  const suppliedPayloadHash = String(input.payloadHash || input.payload_hash || "").trim();
  if (suppliedPayloadHash && suppliedPayloadHash !== canonicalPayloadHash) {
    throw new Error("workflow event payloadHash must match canonical redacted payload hash");
  }
  return {
    eventId: String(input.eventId || input.event_id || safeId("workflow_event")).trim(),
    eventType,
    status: String(input.status || "recorded").trim(),
    workflowId: String(input.workflowId || input.workflow_id || "").trim(),
    traceId: String(input.traceId || input.trace_id || "").trim(),
    taskId: String(input.taskId || input.task_id || "").trim(),
    dispatchId: String(input.dispatchId || input.dispatch_id || "").trim(),
    runtimeRunId: String(input.runtimeRunId || input.runtime_run_id || "").trim(),
    messageFlowId: String(input.messageFlowId || input.message_flow_id || input.flowId || input.flow_id || "").trim(),
    humanGateId: String(input.humanGateId || input.human_gate_id || "").trim(),
    sideEffectId: String(input.sideEffectId || input.side_effect_id || "").trim(),
    incidentId: String(input.incidentId || input.incident_id || "").trim(),
    actor: String(input.actor || input.createdBy || input.created_by || input.from || "").trim(),
    sourceRuntime: String(input.sourceRuntime || input.source_runtime || input.runtime || "").trim(),
    sourceAgent: String(input.sourceAgent || input.source_agent || input.agentId || input.agent_id || "").trim(),
    previousState: String(input.previousState || input.previous_state || input.fromState || input.from_state || "").trim(),
    nextState: String(input.nextState || input.next_state || input.toState || input.to_state || "").trim(),
    idempotencyKey: String(input.idempotencyKey || input.idempotency_key || "").trim(),
    artifactRef: String(input.artifactRef || input.artifact_ref || "").trim(),
    payloadHash: canonicalPayloadHash,
    payload,
    createdAt: String(input.createdAt || input.created_at || now).trim()
  };
}

const WORKFLOW_EVENT_DEDUPE_FIELDS = [
  "eventType",
  "status",
  "workflowId",
  "traceId",
  "taskId",
  "dispatchId",
  "runtimeRunId",
  "messageFlowId",
  "humanGateId",
  "sideEffectId",
  "incidentId",
  "actor",
  "sourceRuntime",
  "sourceAgent",
  "previousState",
  "nextState",
  "idempotencyKey",
  "artifactRef",
  "payloadHash"
];

function workflowEventDedupeMismatch(existing, record) {
  for (const field of WORKFLOW_EVENT_DEDUPE_FIELDS) {
    if (String(existing[field] || "") !== String(record[field] || "")) return field;
  }
  return "";
}

export async function appendWorkflowEvent(paths, input = {}) {
  const record = workflowEventRecordFromInput(input);
  const duplicateFilters = [`event_id=${sqlValue(record.eventId)}`];
  if (record.idempotencyKey) duplicateFilters.push(`idempotency_key=${sqlValue(record.idempotencyKey)}`);
  const existingRows = await sqlite(paths.dbFile, `
SELECT * FROM workflow_events
WHERE ${duplicateFilters.join(" OR ")}
ORDER BY created_at DESC
LIMIT 5;`, { json: true });
  if (existingRows.length) {
    const byEventId = existingRows.find((row) => row.event_id === record.eventId);
    const byIdempotency = record.idempotencyKey ? existingRows.find((row) => row.idempotency_key === record.idempotencyKey) : null;
    if (byEventId && byIdempotency && byEventId.event_id !== byIdempotency.event_id) {
      throw new Error(`workflow event idempotency conflict: eventId ${record.eventId} and idempotencyKey ${record.idempotencyKey} point to different events`);
    }
    const existing = workflowEventFromRow(byEventId || byIdempotency || existingRows[0]);
    const sameEventId = existing.eventId === record.eventId;
    const sameIdempotency = record.idempotencyKey && existing.idempotencyKey === record.idempotencyKey;
    const mismatch = workflowEventDedupeMismatch(existing, record);
    if ((sameEventId || sameIdempotency) && !mismatch) {
      return { ...existing, deduped: true, dbFile: paths.dbFile };
    }
    throw new Error(`workflow event idempotency conflict: ${sameEventId ? record.eventId : record.idempotencyKey}${mismatch ? ` field=${mismatch}` : ""}`);
  }
  await sqlite(paths.dbFile, `
INSERT INTO workflow_events(event_id, event_type, status, workflow_id, trace_id, task_id, dispatch_id, runtime_run_id, message_flow_id, human_gate_id, side_effect_id, incident_id, actor, source_runtime, source_agent, previous_state, next_state, idempotency_key, artifact_ref, payload_hash, payload_json, created_at)
VALUES (${sqlValue(record.eventId)}, ${sqlValue(record.eventType)}, ${sqlValue(record.status)}, ${sqlValue(record.workflowId)}, ${sqlValue(record.traceId)}, ${sqlValue(record.taskId)}, ${sqlValue(record.dispatchId)}, ${sqlValue(record.runtimeRunId)}, ${sqlValue(record.messageFlowId)}, ${sqlValue(record.humanGateId)}, ${sqlValue(record.sideEffectId)}, ${sqlValue(record.incidentId)}, ${sqlValue(record.actor)}, ${sqlValue(record.sourceRuntime)}, ${sqlValue(record.sourceAgent)}, ${sqlValue(record.previousState)}, ${sqlValue(record.nextState)}, ${sqlValue(record.idempotencyKey)}, ${sqlValue(record.artifactRef)}, ${sqlValue(record.payloadHash)}, ${sqlValue(JSON.stringify(record.payload))}, ${sqlValue(record.createdAt)});`);
  return { ...record, dbFile: paths.dbFile };
}

function workflowEventWhere(input = {}) {
  const filters = [];
  const fieldMap = [
    ["workflow_id", input.workflowId || input.workflow_id],
    ["trace_id", input.traceId || input.trace_id],
    ["task_id", input.taskId || input.task_id],
    ["dispatch_id", input.dispatchId || input.dispatch_id],
    ["runtime_run_id", input.runtimeRunId || input.runtime_run_id],
    ["message_flow_id", input.messageFlowId || input.message_flow_id || input.flowId || input.flow_id],
    ["human_gate_id", input.humanGateId || input.human_gate_id],
    ["side_effect_id", input.sideEffectId || input.side_effect_id],
    ["incident_id", input.incidentId || input.incident_id],
    ["idempotency_key", input.idempotencyKey || input.idempotency_key],
    ["status", input.status]
  ];
  for (const [column, value] of fieldMap) {
    const text = String(value || "").trim();
    if (text) filters.push(`${column}=${sqlValue(text)}`);
  }
  const eventTypes = toList(input.eventTypes || input.event_types || input.eventType || input.event_type || input.type);
  if (eventTypes.length === 1) filters.push(`event_type=${sqlValue(eventTypes[0])}`);
  if (eventTypes.length > 1) filters.push(`event_type IN (${eventTypes.map(sqlValue).join(", ")})`);
  const since = String(input.since || input.createdAfter || input.created_after || "").trim();
  if (since) filters.push(`created_at >= ${sqlValue(since)}`);
  const until = String(input.until || input.createdBefore || input.created_before || "").trim();
  if (until) filters.push(`created_at <= ${sqlValue(until)}`);
  return filters.length ? `WHERE ${filters.join(" AND ")}` : "";
}

export async function workflowEventListSnapshot(paths, input = {}) {
  const requestedLimit = Number(input.limit || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit))) : 100;
  const order = String(input.order || input.sort || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  const where = workflowEventWhere(input);
  const rows = await sqlite(paths.dbFile, `
SELECT * FROM workflow_events
${where}
ORDER BY created_at ${order}, event_id ${order}
LIMIT ${limit};`, { json: true });
  return { count: rows.length, events: rows.map(workflowEventFromRow), dbFile: paths.dbFile };
}

export function createEventActionRegistry(handlers = {}) {
  const entries = Object.entries(EVENT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing event action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runEventAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createEventActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");

  async function workflowEventAppend(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return appendWorkflowEvent(paths, input);
  }

  async function workflowEventList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowEventListSnapshot(paths, input);
  }

  async function workflowEventTimeline(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowEventListSnapshot(paths, { ...input, order: "asc" });
  }

  return {
    workflowEventAppend,
    workflowEventList,
    workflowEventTimeline
  };
}
