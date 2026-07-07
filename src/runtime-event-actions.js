import {
  jsonHash,
  parseJsonValue,
  redactSensitiveForPersistence,
  textHash,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const RUNTIME_EVENT_ACTION_HANDLER_NAMES = {
  "workflow.runtime_event.record": "workflowRuntimeEventRecord",
  "workflow.runtime.event.record": "workflowRuntimeEventRecord",
  "workflow.runtime-event.record": "workflowRuntimeEventRecord",
  "runtime.semantic.event": "workflowRuntimeEventRecord",
  "runtime.semantic.record": "workflowRuntimeEventRecord",
  "workflow.runtime_event.list": "workflowRuntimeEventList",
  "workflow.runtime.event.list": "workflowRuntimeEventList",
  "workflow.runtime-events": "workflowRuntimeEventList",
  "workflow.runtime.events": "workflowRuntimeEventList",
  "workflow.runtime_current_state": "workflowRuntimeCurrentState",
  "workflow.runtime_event.current": "workflowRuntimeCurrentState",
  "workflow.runtime.current": "workflowRuntimeCurrentState",
  "workflow.runtime_current": "workflowRuntimeCurrentState",
  "runtime.current_state": "workflowRuntimeCurrentState"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`runtime event action dependency missing: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function runtimeEventPayload(input = {}) {
  return redactSensitiveForPersistence(parseJsonValue(input.payload || input.payload_json, input.payload || input.payload_json || {}));
}

function runtimeEventDefaultStatus(eventType, suppliedStatus = "") {
  const status = String(suppliedStatus || "").trim();
  if (status) return status;
  const type = String(eventType || "").trim();
  if (type === "dispatch_bound") return "dispatched";
  if (type === "mechanical_ack") return "acked";
  if (type === "semantic_ack") return "working";
  if (type === "stage_change") return "working";
  if (type === "artifact_created") return "working";
  if (type === "blocked") return "blocked";
  if (type === "interrupted") return "interrupted";
  if (type === "turn_completed") return "completed";
  if (type === "turn_failed") return "failed";
  if (type === "session_compacted") return "compacted";
  return "recorded";
}

function runtimeEventStateStatus(eventType, eventStatus) {
  const status = String(eventStatus || "").trim();
  if (["blocked", "interrupted", "failed", "completed", "done", "success", "working", "running", "dispatched", "acked", "queued", "compacted"].includes(status)) {
    return status === "done" || status === "success" ? "completed" : status;
  }
  return runtimeEventDefaultStatus(eventType, status);
}

function runtimeEventRecordFromInput(input = {}, now = nowIso()) {
  const payload = runtimeEventPayload(input);
  const eventType = String(input.eventType || input.event_type || input.type || "").trim();
  if (!eventType) throw new Error("runtime semantic eventType is required");
  const runtime = String(input.runtime || input.sourceRuntime || input.source_runtime || input.targetRuntime || input.target_runtime || "").trim();
  const agentId = String(input.agentId || input.agent_id || input.sourceAgent || input.source_agent || input.targetAgentId || input.target_agent_id || "").trim();
  if (!runtime) throw new Error("runtime semantic event runtime is required");
  if (!agentId) throw new Error("runtime semantic event agentId is required");
  const eventTime = String(input.eventTime || input.event_time || input.createdAt || input.created_at || now).trim();
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
  const canonicalPayloadHash = jsonHash(payload);
  const suppliedPayloadHash = String(input.payloadHash || input.payload_hash || "").trim();
  if (suppliedPayloadHash && suppliedPayloadHash !== canonicalPayloadHash) {
    throw new Error("runtime semantic event payloadHash must match canonical redacted payload hash");
  }
  const seed = JSON.stringify({
    idempotencyKey,
    eventType,
    eventTime,
    runtime,
    agentId,
    workflowId: input.workflowId || input.workflow_id || "",
    dispatchId: input.dispatchId || input.dispatch_id || "",
    stage: input.stage || input.currentStage || input.current_stage || "",
    payloadHash: canonicalPayloadHash
  });
  return {
    eventId: String(input.eventId || input.event_id || (idempotencyKey ? `runtime_event.${textHash(idempotencyKey).slice(0, 24)}` : `runtime_event.${textHash(seed).slice(0, 24)}`)).trim(),
    eventType,
    eventTime,
    eventSequence: Math.max(0, Math.trunc(Number(input.eventSequence || input.event_sequence || 0) || 0)),
    workflowId: String(input.workflowId || input.workflow_id || "").trim(),
    taskId: String(input.taskId || input.task_id || "").trim(),
    dispatchId: String(input.dispatchId || input.dispatch_id || "").trim(),
    traceId: String(input.traceId || input.trace_id || "").trim(),
    correlationId: String(input.correlationId || input.correlation_id || "").trim(),
    parentEventId: String(input.parentEventId || input.parent_event_id || "").trim(),
    runtime,
    agentId,
    runtimeSessionId: String(input.runtimeSessionId || input.runtime_session_id || input.sessionId || input.session_id || "").trim(),
    runtimeRunId: String(input.runtimeRunId || input.runtime_run_id || "").trim(),
    acpTurnId: String(input.acpTurnId || input.acp_turn_id || "").trim(),
    promptId: String(input.promptId || input.prompt_id || "").trim(),
    stage: String(input.stage || input.currentStage || input.current_stage || "").trim(),
    status: runtimeEventDefaultStatus(eventType, input.status),
    blockedReason: String(input.blockedReason || input.blocked_reason || "").trim(),
    interruptionClass: String(input.interruptionClass || input.interruption_class || "").trim(),
    interruptedDispatchId: String(input.interruptedDispatchId || input.interrupted_dispatch_id || "").trim(),
    supersedesDispatchId: String(input.supersedesDispatchId || input.supersedes_dispatch_id || "").trim(),
    artifactUri: String(input.artifactUri || input.artifact_uri || input.artifactRef || input.artifact_ref || "").trim(),
    artifactType: String(input.artifactType || input.artifact_type || "").trim(),
    artifactSha256: String(input.artifactSha256 || input.artifact_sha256 || "").trim(),
    artifactReason: String(input.artifactReason || input.artifact_reason || "").trim(),
    evidenceRefs: toList(input.evidenceRefs || input.evidence_refs || input.receiptRefs || input.receipt_refs).map(String).filter(Boolean),
    toolName: String(input.toolName || input.tool_name || "").trim(),
    toolCallId: String(input.toolCallId || input.tool_call_id || "").trim(),
    durationMs: numberOrNull(input.durationMs || input.duration_ms),
    exitCode: numberOrNull(input.exitCode || input.exit_code),
    cwd: String(input.cwd || "").trim(),
    gitHead: String(input.gitHead || input.git_head || "").trim(),
    model: String(input.model || "").trim(),
    provider: String(input.provider || "").trim(),
    privacyClass: String(input.privacyClass || input.privacy_class || "internal").trim(),
    redactionStatus: String(input.redactionStatus || input.redaction_status || "redacted").trim(),
    ttl: String(input.ttl || "").trim(),
    errorClass: String(input.errorClass || input.error_class || "").trim(),
    severity: String(input.severity || (["blocked", "turn_failed"].includes(eventType) ? "warning" : "info")).trim(),
    idempotencyKey,
    sideEffectRef: String(input.sideEffectRef || input.side_effect_ref || "").trim(),
    payloadHash: canonicalPayloadHash,
    payload,
    createdAt: String(input.createdAt || input.created_at || now).trim(),
    endpointRef: String(input.endpointRef || input.endpoint_ref || "").trim(),
    latestReceiptRef: String(input.latestReceiptRef || input.latest_receipt_ref || input.receiptRef || input.receipt_ref || "").trim(),
    staleKind: String(input.staleKind || input.stale_kind || "").trim()
  };
}

function runtimeEventFromRow(row = {}) {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    eventTime: row.event_time,
    eventSequence: Number(row.event_sequence || 0),
    workflowId: row.workflow_id || "",
    taskId: row.task_id || "",
    dispatchId: row.dispatch_id || "",
    traceId: row.trace_id || "",
    correlationId: row.correlation_id || "",
    parentEventId: row.parent_event_id || "",
    runtime: row.runtime || "",
    agentId: row.agent_id || "",
    runtimeSessionId: row.runtime_session_id || "",
    runtimeRunId: row.runtime_run_id || "",
    acpTurnId: row.acp_turn_id || "",
    promptId: row.prompt_id || "",
    stage: row.stage || "",
    status: row.status || "",
    blockedReason: row.blocked_reason || "",
    interruptionClass: row.interruption_class || "",
    interruptedDispatchId: row.interrupted_dispatch_id || "",
    supersedesDispatchId: row.supersedes_dispatch_id || "",
    artifactUri: row.artifact_uri || "",
    artifactType: row.artifact_type || "",
    artifactSha256: row.artifact_sha256 || "",
    artifactReason: row.artifact_reason || "",
    latestReceiptRef: row.latest_receipt_ref || "",
    evidenceRefs: parseJsonValue(row.evidence_refs_json, []),
    toolName: row.tool_name || "",
    toolCallId: row.tool_call_id || "",
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    cwd: row.cwd || "",
    gitHead: row.git_head || "",
    model: row.model || "",
    provider: row.provider || "",
    privacyClass: row.privacy_class || "",
    redactionStatus: row.redaction_status || "",
    ttl: row.ttl || "",
    errorClass: row.error_class || "",
    severity: row.severity || "",
    idempotencyKey: row.idempotency_key || "",
    sideEffectRef: row.side_effect_ref || "",
    payloadHash: row.payload_hash || "",
    payload: parseJsonValue(row.payload_json, {}),
    createdAt: row.created_at || ""
  };
}

const RUNTIME_EVENT_DEDUPE_FIELDS = [
  "eventId",
  "eventType",
  "eventTime",
  "workflowId",
  "taskId",
  "dispatchId",
  "traceId",
  "correlationId",
  "parentEventId",
  "runtime",
  "agentId",
  "runtimeSessionId",
  "runtimeRunId",
  "acpTurnId",
  "promptId",
  "stage",
  "status",
  "blockedReason",
  "interruptionClass",
  "interruptedDispatchId",
  "supersedesDispatchId",
  "artifactUri",
  "artifactType",
  "artifactSha256",
  "artifactReason",
  "latestReceiptRef",
  "evidenceRefs",
  "toolName",
  "toolCallId",
  "durationMs",
  "exitCode",
  "cwd",
  "gitHead",
  "model",
  "provider",
  "privacyClass",
  "redactionStatus",
  "ttl",
  "errorClass",
  "severity",
  "idempotencyKey",
  "sideEffectRef",
  "payloadHash"
];

function runtimeEventDedupeValue(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function runtimeEventDedupeMismatch(existing, record) {
  for (const field of RUNTIME_EVENT_DEDUPE_FIELDS) {
    if (runtimeEventDedupeValue(existing[field]) !== runtimeEventDedupeValue(record[field])) return field;
  }
  return "";
}

function runtimeCurrentStateFromRow(row = {}) {
  return {
    stateKey: row.state_key || "",
    runtime: row.runtime || "",
    agentId: row.agent_id || "",
    endpointRef: row.endpoint_ref || "",
    activeWorkflowId: row.active_workflow_id || "",
    taskId: row.task_id || "",
    activeDispatchId: row.active_dispatch_id || "",
    traceId: row.trace_id || "",
    runtimeSessionId: row.runtime_session_id || "",
    runtimeRunId: row.runtime_run_id || "",
    acpTurnId: row.acp_turn_id || "",
    promptId: row.prompt_id || "",
    currentStage: row.current_stage || "",
    stageStatus: row.stage_status || "",
    semanticAckAt: row.semantic_ack_at || "",
    lastEventId: row.last_event_id || "",
    lastEventAt: row.last_event_at || "",
    lastEventSequence: Number(row.last_event_sequence || 0),
    latestArtifactRef: row.latest_artifact_ref || "",
    latestReceiptRef: row.latest_receipt_ref || "",
    blockedReason: row.blocked_reason || "",
    interruptionClass: row.interruption_class || "",
    interruptedDispatchId: row.interrupted_dispatch_id || "",
    staleKind: row.stale_kind || "",
    status: row.status || "",
    payload: parseJsonValue(row.payload_json, {}),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function runtimeCurrentStatePayload(record, previous = {}) {
  return redactSensitiveForPersistence({
    lastEventType: record.eventType,
    lastEventStatus: record.status,
    artifactReason: record.artifactReason || "",
    evidenceRefs: record.evidenceRefs,
    toolName: record.toolName || "",
    toolCallId: record.toolCallId || "",
    durationMs: record.durationMs,
    exitCode: record.exitCode,
    errorClass: record.errorClass || "",
    severity: record.severity || "",
    previousStatus: previous.status || "",
    payload: record.payload
  });
}

async function runtimeCurrentStateProject(paths, record) {
  const stateKey = `${record.runtime}:${record.agentId}`;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_current_state
WHERE state_key=${sqlValue(stateKey)}
LIMIT 1;`, { json: true });
  const previous = rows[0] || {};
  const previousEventTime = String(previous.last_event_at || "");
  const recordEventTime = String(record.eventTime || "");
  const previousSequence = Number(previous.last_event_sequence || 0);
  if (previousEventTime && (
    recordEventTime.localeCompare(previousEventTime) < 0
      || (recordEventTime === previousEventTime && Number(record.eventSequence || 0) <= previousSequence)
  )) {
    return runtimeCurrentStateFromRow(previous);
  }
  const scopeChanged = Boolean(
    previous.active_dispatch_id && record.dispatchId && record.dispatchId !== previous.active_dispatch_id
      || previous.active_workflow_id && record.workflowId && record.workflowId !== previous.active_workflow_id
      || previous.task_id && record.taskId && record.taskId !== previous.task_id
      || previous.runtime_run_id && record.runtimeRunId && record.runtimeRunId !== previous.runtime_run_id
  );
  const stateStatus = runtimeEventStateStatus(record.eventType, record.status);
  const clearsStale = scopeChanged || ["semantic_ack", "stage_change", "artifact_created", "turn_completed"].includes(record.eventType)
    || ["working", "completed"].includes(stateStatus);
  const current = {
    stateKey,
    runtime: record.runtime,
    agentId: record.agentId,
    endpointRef: record.endpointRef || previous.endpoint_ref || "",
    activeWorkflowId: record.workflowId || previous.active_workflow_id || "",
    taskId: record.taskId || previous.task_id || "",
    activeDispatchId: record.dispatchId || previous.active_dispatch_id || "",
    traceId: record.traceId || previous.trace_id || "",
    runtimeSessionId: record.runtimeSessionId || previous.runtime_session_id || "",
    runtimeRunId: record.runtimeRunId || previous.runtime_run_id || "",
    acpTurnId: record.acpTurnId || previous.acp_turn_id || "",
    promptId: record.promptId || previous.prompt_id || "",
    currentStage: record.stage || previous.current_stage || "",
    stageStatus: record.status || previous.stage_status || "",
    semanticAckAt: record.eventType === "semantic_ack" ? record.eventTime : scopeChanged ? "" : previous.semantic_ack_at || "",
    lastEventId: record.eventId,
    lastEventAt: record.eventTime,
    lastEventSequence: record.eventSequence,
    latestArtifactRef: record.artifactUri || (scopeChanged ? "" : previous.latest_artifact_ref || ""),
    latestReceiptRef: record.latestReceiptRef || (scopeChanged ? "" : previous.latest_receipt_ref || ""),
    blockedReason: record.blockedReason || (stateStatus === "blocked" && !scopeChanged ? previous.blocked_reason || "" : ""),
    interruptionClass: record.interruptionClass || (stateStatus === "interrupted" && !scopeChanged ? previous.interruption_class || "" : ""),
    interruptedDispatchId: record.interruptedDispatchId || (scopeChanged ? "" : previous.interrupted_dispatch_id || ""),
    staleKind: record.staleKind || (clearsStale ? "" : previous.stale_kind || ""),
    status: stateStatus,
    payload: runtimeCurrentStatePayload(record, previous),
    createdAt: previous.created_at || record.createdAt,
    updatedAt: record.eventTime || record.createdAt
  };
  await sqlite(paths.dbFile, `
INSERT INTO runtime_current_state(state_key, runtime, agent_id, endpoint_ref, active_workflow_id, task_id, active_dispatch_id, trace_id, runtime_session_id, runtime_run_id, acp_turn_id, prompt_id, current_stage, stage_status, semantic_ack_at, last_event_id, last_event_at, last_event_sequence, latest_artifact_ref, latest_receipt_ref, blocked_reason, interruption_class, interrupted_dispatch_id, stale_kind, status, payload_json, created_at, updated_at)
VALUES (${sqlValue(current.stateKey)}, ${sqlValue(current.runtime)}, ${sqlValue(current.agentId)}, ${sqlValue(current.endpointRef)}, ${sqlValue(current.activeWorkflowId)}, ${sqlValue(current.taskId)}, ${sqlValue(current.activeDispatchId)}, ${sqlValue(current.traceId)}, ${sqlValue(current.runtimeSessionId)}, ${sqlValue(current.runtimeRunId)}, ${sqlValue(current.acpTurnId)}, ${sqlValue(current.promptId)}, ${sqlValue(current.currentStage)}, ${sqlValue(current.stageStatus)}, ${sqlValue(current.semanticAckAt)}, ${sqlValue(current.lastEventId)}, ${sqlValue(current.lastEventAt)}, ${sqlValue(current.lastEventSequence)}, ${sqlValue(current.latestArtifactRef)}, ${sqlValue(current.latestReceiptRef)}, ${sqlValue(current.blockedReason)}, ${sqlValue(current.interruptionClass)}, ${sqlValue(current.interruptedDispatchId)}, ${sqlValue(current.staleKind)}, ${sqlValue(current.status)}, ${sqlValue(JSON.stringify(current.payload))}, ${sqlValue(current.createdAt)}, ${sqlValue(current.updatedAt)})
ON CONFLICT(state_key) DO UPDATE SET
  endpoint_ref=excluded.endpoint_ref,
  active_workflow_id=excluded.active_workflow_id,
  task_id=excluded.task_id,
  active_dispatch_id=excluded.active_dispatch_id,
  trace_id=excluded.trace_id,
  runtime_session_id=excluded.runtime_session_id,
  runtime_run_id=excluded.runtime_run_id,
  acp_turn_id=excluded.acp_turn_id,
  prompt_id=excluded.prompt_id,
  current_stage=excluded.current_stage,
  stage_status=excluded.stage_status,
  semantic_ack_at=excluded.semantic_ack_at,
  last_event_id=excluded.last_event_id,
  last_event_at=excluded.last_event_at,
  last_event_sequence=excluded.last_event_sequence,
  latest_artifact_ref=excluded.latest_artifact_ref,
  latest_receipt_ref=excluded.latest_receipt_ref,
  blocked_reason=excluded.blocked_reason,
  interruption_class=excluded.interruption_class,
  interrupted_dispatch_id=excluded.interrupted_dispatch_id,
  stale_kind=excluded.stale_kind,
  status=excluded.status,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  return current;
}

export async function appendRuntimeSemanticEvent(paths, input = {}) {
  const record = runtimeEventRecordFromInput(input);
  const duplicateFilters = [`event_id=${sqlValue(record.eventId)}`];
  if (record.idempotencyKey) duplicateFilters.push(`idempotency_key=${sqlValue(record.idempotencyKey)}`);
  const existingRows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_semantic_events
WHERE ${duplicateFilters.join(" OR ")}
ORDER BY event_time DESC, created_at DESC
LIMIT 5;`, { json: true });
  if (existingRows.length) {
    const byEventId = existingRows.find((row) => row.event_id === record.eventId);
    const byIdempotency = record.idempotencyKey ? existingRows.find((row) => row.idempotency_key === record.idempotencyKey) : null;
    if (byEventId && byIdempotency && byEventId.event_id !== byIdempotency.event_id) {
      throw new Error(`runtime semantic event idempotency conflict: eventId ${record.eventId} and idempotencyKey ${record.idempotencyKey} point to different events`);
    }
    const existing = runtimeEventFromRow(byEventId || byIdempotency || existingRows[0]);
    const mismatch = runtimeEventDedupeMismatch(existing, record);
    if (!mismatch) {
      const currentRows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_current_state
WHERE runtime=${sqlValue(existing.runtime)} AND agent_id=${sqlValue(existing.agentId)}
LIMIT 1;`, { json: true });
      return {
        schemaVersion: "workflow_runtime_semantic_event.v1",
        event: { ...existing, deduped: true },
        currentState: currentRows[0] ? runtimeCurrentStateFromRow(currentRows[0]) : null,
        dbFile: paths.dbFile
      };
    }
    throw new Error(`runtime semantic event idempotency conflict: ${record.eventId}${mismatch ? ` field=${mismatch}` : ""}`);
  }
  const seq = record.eventSequence || Number((await sqlite(paths.dbFile, `
SELECT COALESCE(MAX(event_sequence), 0) + 1 AS next_sequence
FROM runtime_semantic_events
WHERE runtime=${sqlValue(record.runtime)} AND agent_id=${sqlValue(record.agentId)};`, { json: true }))[0]?.next_sequence || 1);
  record.eventSequence = seq;
  await sqlite(paths.dbFile, `
INSERT INTO runtime_semantic_events(event_id, event_type, event_time, event_sequence, workflow_id, task_id, dispatch_id, trace_id, correlation_id, parent_event_id, runtime, agent_id, runtime_session_id, runtime_run_id, acp_turn_id, prompt_id, stage, status, blocked_reason, interruption_class, interrupted_dispatch_id, supersedes_dispatch_id, artifact_uri, artifact_type, artifact_sha256, artifact_reason, latest_receipt_ref, evidence_refs_json, tool_name, tool_call_id, duration_ms, exit_code, cwd, git_head, model, provider, privacy_class, redaction_status, ttl, error_class, severity, idempotency_key, side_effect_ref, payload_hash, payload_json, created_at)
VALUES (${sqlValue(record.eventId)}, ${sqlValue(record.eventType)}, ${sqlValue(record.eventTime)}, ${sqlValue(record.eventSequence)}, ${sqlValue(record.workflowId)}, ${sqlValue(record.taskId)}, ${sqlValue(record.dispatchId)}, ${sqlValue(record.traceId)}, ${sqlValue(record.correlationId)}, ${sqlValue(record.parentEventId)}, ${sqlValue(record.runtime)}, ${sqlValue(record.agentId)}, ${sqlValue(record.runtimeSessionId)}, ${sqlValue(record.runtimeRunId)}, ${sqlValue(record.acpTurnId)}, ${sqlValue(record.promptId)}, ${sqlValue(record.stage)}, ${sqlValue(record.status)}, ${sqlValue(record.blockedReason)}, ${sqlValue(record.interruptionClass)}, ${sqlValue(record.interruptedDispatchId)}, ${sqlValue(record.supersedesDispatchId)}, ${sqlValue(record.artifactUri)}, ${sqlValue(record.artifactType)}, ${sqlValue(record.artifactSha256)}, ${sqlValue(record.artifactReason)}, ${sqlValue(record.latestReceiptRef)}, ${sqlValue(JSON.stringify(record.evidenceRefs))}, ${sqlValue(record.toolName)}, ${sqlValue(record.toolCallId)}, ${sqlValue(record.durationMs)}, ${sqlValue(record.exitCode)}, ${sqlValue(record.cwd)}, ${sqlValue(record.gitHead)}, ${sqlValue(record.model)}, ${sqlValue(record.provider)}, ${sqlValue(record.privacyClass)}, ${sqlValue(record.redactionStatus)}, ${sqlValue(record.ttl)}, ${sqlValue(record.errorClass)}, ${sqlValue(record.severity)}, ${sqlValue(record.idempotencyKey)}, ${sqlValue(record.sideEffectRef)}, ${sqlValue(record.payloadHash)}, ${sqlValue(JSON.stringify(record.payload))}, ${sqlValue(record.createdAt)});`);
  const currentState = await runtimeCurrentStateProject(paths, record);
  return {
    schemaVersion: "workflow_runtime_semantic_event.v1",
    event: record,
    currentState,
    dbFile: paths.dbFile
  };
}

export async function workflowRuntimeEventRecordCore(paths, input = {}) {
  return appendRuntimeSemanticEvent(paths, input);
}

function workflowRuntimeEventWhere(input = {}) {
  const filters = [];
  const fieldMap = [
    ["workflow_id", input.workflowId || input.workflow_id],
    ["task_id", input.taskId || input.task_id],
    ["dispatch_id", input.dispatchId || input.dispatch_id],
    ["trace_id", input.traceId || input.trace_id],
    ["runtime", input.runtime],
    ["agent_id", input.agentId || input.agent_id],
    ["idempotency_key", input.idempotencyKey || input.idempotency_key],
    ["status", input.status],
    ["stage", input.stage || input.currentStage || input.current_stage]
  ];
  for (const [column, value] of fieldMap) {
    const text = String(value || "").trim();
    if (text) filters.push(`${column}=${sqlValue(text)}`);
  }
  const eventTypes = toList(input.eventTypes || input.event_types || input.eventType || input.event_type || input.type);
  if (eventTypes.length === 1) filters.push(`event_type=${sqlValue(eventTypes[0])}`);
  if (eventTypes.length > 1) filters.push(`event_type IN (${eventTypes.map(sqlValue).join(", ")})`);
  const since = String(input.since || input.eventAfter || input.event_after || input.createdAfter || input.created_after || "").trim();
  if (since) filters.push(`event_time >= ${sqlValue(since)}`);
  const until = String(input.until || input.eventBefore || input.event_before || input.createdBefore || input.created_before || "").trim();
  if (until) filters.push(`event_time <= ${sqlValue(until)}`);
  return filters.length ? `WHERE ${filters.join(" AND ")}` : "";
}

export async function workflowRuntimeEventListSnapshot(paths, input = {}) {
  const requestedLimit = Number(input.limit || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit))) : 100;
  const order = String(input.order || input.sort || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  const where = workflowRuntimeEventWhere(input);
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_semantic_events
${where}
ORDER BY event_time ${order}, event_sequence ${order}, event_id ${order}
LIMIT ${limit};`, { json: true });
  return {
    schemaVersion: "workflow_runtime_semantic_events.v1",
    count: rows.length,
    events: rows.map(runtimeEventFromRow),
    dbFile: paths.dbFile
  };
}

export async function workflowRuntimeCurrentStateSnapshot(paths, input = {}) {
  const filters = [];
  const fieldMap = [
    ["runtime", input.runtime],
    ["agent_id", input.agentId || input.agent_id],
    ["active_workflow_id", input.workflowId || input.workflow_id],
    ["active_dispatch_id", input.dispatchId || input.dispatch_id],
    ["trace_id", input.traceId || input.trace_id],
    ["status", input.status]
  ];
  for (const [column, value] of fieldMap) {
    const text = String(value || "").trim();
    if (text) filters.push(`${column}=${sqlValue(text)}`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const requestedLimit = Number(input.limit || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit))) : 100;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_current_state
${where}
ORDER BY updated_at DESC, state_key
LIMIT ${limit};`, { json: true });
  return {
    schemaVersion: "workflow_runtime_current_state.v1",
    generatedAt: nowIso(),
    count: rows.length,
    states: rows.map(runtimeCurrentStateFromRow),
    dbFile: paths.dbFile
  };
}

export function createRuntimeEventActionRegistry(handlers = {}) {
  const entries = Object.entries(RUNTIME_EVENT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing runtime event action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runRuntimeEventAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createRuntimeEventActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");

  async function workflowRuntimeEventRecord(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return appendRuntimeSemanticEvent(paths, input);
  }

  async function workflowRuntimeEventList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowRuntimeEventListSnapshot(paths, input);
  }

  async function workflowRuntimeCurrentState(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowRuntimeCurrentStateSnapshot(paths, input);
  }

  return {
    workflowRuntimeCurrentState,
    workflowRuntimeEventList,
    workflowRuntimeEventRecord
  };
}
