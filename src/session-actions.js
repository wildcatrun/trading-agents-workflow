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

export const SESSION_ACTION_HANDLER_NAMES = {
  "workflow.session_pack.upsert": "workflowSessionPackUpsert",
  "workflow.session.pack.upsert": "workflowSessionPackUpsert",
  "session_pack.upsert": "workflowSessionPackUpsert",
  "workflow.session_pack.get": "workflowSessionPackGet",
  "workflow.session.pack.get": "workflowSessionPackGet",
  "session_pack.get": "workflowSessionPackGet",
  "workflow.session_pack.list": "workflowSessionPackList",
  "workflow.session.pack.list": "workflowSessionPackList",
  "session_pack.list": "workflowSessionPackList",
  "workflow.session_run.start": "workflowSessionRunStart",
  "workflow.session.run.start": "workflowSessionRunStart",
  "session_run.start": "workflowSessionRunStart",
  "workflow.session_run.complete": "workflowSessionRunComplete",
  "workflow.session.run.complete": "workflowSessionRunComplete",
  "session_run.complete": "workflowSessionRunComplete"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`session action dependency missing: ${name}`);
  return value;
}

const WORKFLOW_SESSION_PACK_STATUSES = new Set(["draft", "active", "disabled", "archived"]);
const WORKFLOW_SESSION_RUN_STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled"]);

function nowIso() {
  return new Date().toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function sessionJsonObject(value, fallback = {}) {
  const parsed = parseJsonValue(value, value === undefined ? fallback : value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  return redactSensitiveForPersistence(parsed);
}

function sessionJsonArray(value) {
  const parsed = parseJsonValue(value, value || []);
  if (Array.isArray(parsed)) return redactSensitiveForPersistence(parsed);
  return toList(parsed);
}

function requireWorkflowSessionPackStatus(value, fallback = "active") {
  const status = String(value || fallback).trim();
  if (!WORKFLOW_SESSION_PACK_STATUSES.has(status)) throw new Error(`unknown workflow session pack status: ${status}`);
  return status;
}

export function requireWorkflowSessionRunStatus(value, fallback = "running") {
  const status = String(value || fallback).trim();
  if (!WORKFLOW_SESSION_RUN_STATUSES.has(status)) throw new Error(`unknown workflow session run status: ${status}`);
  return status;
}

export function isTerminalWorkflowSessionRunStatus(status) {
  return ["completed", "failed", "cancelled"].includes(status);
}

function sessionPackHash(record) {
  return jsonHash({
    sessionId: record.sessionId,
    status: record.status,
    ownerAgent: record.ownerAgent,
    taskType: record.taskType,
    runtimeTarget: record.runtimeTarget,
    purpose: record.purpose,
    systemBrief: record.systemBrief,
    workingContext: record.workingContext,
    toolPolicy: record.toolPolicy,
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    evidenceRefs: record.evidenceRefs,
    checkpointRefs: record.checkpointRefs,
    resourceBudget: record.resourceBudget,
    metadata: record.metadata
  });
}

export function sessionPackFromRow(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    version: Number(row.version || 1),
    status: row.status,
    ownerAgent: row.owner_agent,
    taskType: row.task_type,
    runtimeTarget: row.runtime_target,
    purpose: row.purpose,
    systemBrief: row.system_brief || "",
    workingContext: parseJsonValue(row.working_context_json, {}),
    toolPolicy: parseJsonValue(row.tool_policy_json, {}),
    inputSchema: parseJsonValue(row.input_schema_json, {}),
    outputSchema: parseJsonValue(row.output_schema_json, {}),
    evidenceRefs: parseJsonValue(row.evidence_refs_json, []),
    checkpointRefs: parseJsonValue(row.checkpoint_refs_json, []),
    resourceBudget: parseJsonValue(row.resource_budget_json, {}),
    metadata: parseJsonValue(row.metadata_json, {}),
    packHash: row.pack_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function sessionRunFromRow(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    packVersion: Number(row.pack_version || 1),
    workflowId: row.workflow_id || "",
    taskId: row.task_id || "",
    dispatchId: row.dispatch_id || "",
    workerId: row.worker_id || "",
    status: row.status,
    input: parseJsonValue(row.input_json, {}),
    workerInput: parseJsonValue(row.worker_input_json, {}),
    output: parseJsonValue(row.output_json, {}),
    receiptRef: row.receipt_ref || "",
    error: row.error || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function workerInputFromSessionPack(pack, inputPayload = {}, context = {}) {
  return {
    schemaVersion: 1,
    objectType: "workflow_session_worker_input",
    sessionId: pack.sessionId,
    sessionVersion: pack.version,
    packHash: pack.packHash,
    purpose: pack.purpose,
    ownerAgent: pack.ownerAgent,
    taskType: pack.taskType,
    runtimeTarget: pack.runtimeTarget,
    systemBrief: pack.systemBrief,
    workingContext: pack.workingContext,
    toolPolicy: pack.toolPolicy,
    inputSchema: pack.inputSchema,
    outputSchema: pack.outputSchema,
    evidenceRefs: pack.evidenceRefs,
    checkpointRefs: pack.checkpointRefs,
    resourceBudget: pack.resourceBudget,
    input: inputPayload,
    context,
    instructions: {
      loadOnlyReferencedArtifacts: true,
      doNotInferMissingHumanApproval: true,
      writeStructuredOutputOnly: Object.keys(pack.outputSchema || {}).length > 0
    }
  };
}

export function createSessionActionRegistry(handlers = {}) {
  const entries = Object.entries(SESSION_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing session action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runSessionAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createSessionActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const upsertWorkflowAgentRun = requireContextFunction(context, "upsertWorkflowAgentRun");
  const workflowTaskPhaseInfo = requireContextFunction(context, "workflowTaskPhaseInfo");

  async function workflowSessionPackUpsertCore(paths, input = {}) {
    const now = nowIso();
    const sessionId = String(input.sessionId || input.session_id || safeId("session-pack")).trim();
    const existingRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(sessionId)} LIMIT 1;`, { json: true });
    const existing = existingRows[0] || null;
    const requestedVersion = numberOrNull(input.version);
    const version = requestedVersion !== null && requestedVersion > 0
      ? Math.trunc(requestedVersion)
      : (existing ? Number(existing.version || 1) : 1);
    const status = requireWorkflowSessionPackStatus(input.status || existing?.status || "active");
    const ownerAgent = normalizeAgentId(input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || existing?.owner_agent || "main");
    const taskType = String(input.taskType || input.task_type || input.type || existing?.task_type || "task").trim();
    const runtimeTarget = String(input.runtimeTarget || input.runtime_target || input.runtime || existing?.runtime_target || "hermers").trim();
    const purpose = String(input.purpose || input.summary || input.text || existing?.purpose || "").trim();
    if (!purpose) throw new Error("session pack purpose is required");
    const record = {
      sessionId,
      version,
      status,
      ownerAgent,
      taskType,
      runtimeTarget,
      purpose,
      systemBrief: String(input.systemBrief || input.system_brief || existing?.system_brief || "").trim(),
      workingContext: input.workingContext !== undefined || input.working_context !== undefined
        ? sessionJsonObject(input.workingContext ?? input.working_context)
        : parseJsonValue(existing?.working_context_json, {}),
      toolPolicy: input.toolPolicy !== undefined || input.tool_policy !== undefined
        ? sessionJsonObject(input.toolPolicy ?? input.tool_policy)
        : parseJsonValue(existing?.tool_policy_json, {}),
      inputSchema: input.inputSchema !== undefined || input.input_schema !== undefined
        ? sessionJsonObject(input.inputSchema ?? input.input_schema)
        : parseJsonValue(existing?.input_schema_json, {}),
      outputSchema: input.outputSchema !== undefined || input.output_schema !== undefined
        ? sessionJsonObject(input.outputSchema ?? input.output_schema)
        : parseJsonValue(existing?.output_schema_json, {}),
      evidenceRefs: input.evidenceRefs !== undefined || input.evidence_refs !== undefined
        ? sessionJsonArray(input.evidenceRefs ?? input.evidence_refs)
        : parseJsonValue(existing?.evidence_refs_json, []),
      checkpointRefs: input.checkpointRefs !== undefined || input.checkpoint_refs !== undefined
        ? sessionJsonArray(input.checkpointRefs ?? input.checkpoint_refs)
        : parseJsonValue(existing?.checkpoint_refs_json, []),
      resourceBudget: input.resourceBudget !== undefined || input.resource_budget !== undefined
        ? sessionJsonObject(input.resourceBudget ?? input.resource_budget)
        : parseJsonValue(existing?.resource_budget_json, {}),
      metadata: input.metadata !== undefined
        ? sessionJsonObject(input.metadata)
        : parseJsonValue(existing?.metadata_json, {}),
      createdBy: input.createdBy || input.created_by || input.from || existing?.created_by || "main",
      createdAt: existing?.created_at || now,
      updatedAt: now
    };
    record.packHash = sessionPackHash(record);
    if (existing && requestedVersion === null && record.packHash === existing.pack_hash) {
      return { ...sessionPackFromRow(existing), deduped: true, dbFile: paths.dbFile };
    }
    if (existing && requestedVersion === null) record.version = Number(existing.version || 1) + 1;
    await sqlite(paths.dbFile, `
INSERT INTO workflow_session_packs(session_id, version, status, owner_agent, task_type, runtime_target, purpose, system_brief, working_context_json, tool_policy_json, input_schema_json, output_schema_json, evidence_refs_json, checkpoint_refs_json, resource_budget_json, metadata_json, pack_hash, created_by, created_at, updated_at)
VALUES (${sqlValue(record.sessionId)}, ${sqlValue(record.version)}, ${sqlValue(record.status)}, ${sqlValue(record.ownerAgent)}, ${sqlValue(record.taskType)}, ${sqlValue(record.runtimeTarget)}, ${sqlValue(record.purpose)}, ${sqlValue(record.systemBrief)}, ${sqlValue(JSON.stringify(record.workingContext))}, ${sqlValue(JSON.stringify(record.toolPolicy))}, ${sqlValue(JSON.stringify(record.inputSchema))}, ${sqlValue(JSON.stringify(record.outputSchema))}, ${sqlValue(JSON.stringify(record.evidenceRefs))}, ${sqlValue(JSON.stringify(record.checkpointRefs))}, ${sqlValue(JSON.stringify(record.resourceBudget))}, ${sqlValue(JSON.stringify(record.metadata))}, ${sqlValue(record.packHash)}, ${sqlValue(record.createdBy)}, ${sqlValue(record.createdAt)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(session_id) DO UPDATE SET
  version=excluded.version,
  status=excluded.status,
  owner_agent=excluded.owner_agent,
  task_type=excluded.task_type,
  runtime_target=excluded.runtime_target,
  purpose=excluded.purpose,
  system_brief=excluded.system_brief,
  working_context_json=excluded.working_context_json,
  tool_policy_json=excluded.tool_policy_json,
  input_schema_json=excluded.input_schema_json,
  output_schema_json=excluded.output_schema_json,
  evidence_refs_json=excluded.evidence_refs_json,
  checkpoint_refs_json=excluded.checkpoint_refs_json,
  resource_budget_json=excluded.resource_budget_json,
  metadata_json=excluded.metadata_json,
  pack_hash=excluded.pack_hash,
  updated_at=excluded.updated_at;`);
    return { ...record, dbFile: paths.dbFile };
  }

  async function workflowSessionPackGetSnapshot(paths, input = {}) {
    const sessionId = String(input.sessionId || input.session_id || "").trim();
    if (!sessionId) throw new Error("sessionId is required");
    const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(sessionId)} LIMIT 1;`, { json: true });
    const pack = sessionPackFromRow(rows[0]);
    if (!pack) throw new Error(`workflow session pack not found: ${sessionId}`);
    return { ...pack, workerInputTemplate: workerInputFromSessionPack(pack), dbFile: paths.dbFile };
  }

  async function workflowSessionPackListSnapshot(paths, input = {}) {
    const filters = [];
    if (input.status) filters.push(`status=${sqlValue(requireWorkflowSessionPackStatus(input.status))}`);
    if (input.ownerAgent || input.owner_agent) filters.push(`owner_agent=${sqlValue(normalizeAgentId(input.ownerAgent || input.owner_agent))}`);
    if (input.taskType || input.task_type) filters.push(`task_type=${sqlValue(input.taskType || input.task_type)}`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const requestedLimit = Number(input.limit || 100);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, requestedLimit)) : 100;
    const rows = await sqlite(paths.dbFile, `
SELECT * FROM workflow_session_packs
${where}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true });
    return { count: rows.length, packs: rows.map(sessionPackFromRow), dbFile: paths.dbFile };
  }

  async function workflowSessionRunStartCore(paths, input = {}) {
    const now = nowIso();
    const sessionId = String(input.sessionId || input.session_id || "").trim();
    if (!sessionId) throw new Error("sessionId is required");
    const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(sessionId)} LIMIT 1;`, { json: true });
    const pack = sessionPackFromRow(rows[0]);
    if (!pack) throw new Error(`workflow session pack not found: ${sessionId}`);
    if (!["active", "draft"].includes(pack.status)) throw new Error(`workflow session pack is not runnable: ${pack.status}`);
    const runId = String(input.runId || input.run_id || safeId("session-run")).trim();
    const status = requireWorkflowSessionRunStatus(input.status || "running");
    const inputPayload = sessionJsonObject(input.input ?? input.payload ?? {});
    const context = {
      workflowId: String(input.workflowId || input.workflow_id || "").trim(),
      taskId: String(input.taskId || input.task_id || "").trim(),
      traceId: String(input.traceId || input.trace_id || "").trim(),
      dispatchId: String(input.dispatchId || input.dispatch_id || "").trim()
    };
    const workerId = String(input.workerId || input.worker_id || "").trim();
    const existingRunRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
    if (existingRunRows[0]) {
      const existingRun = sessionRunFromRow(existingRunRows[0]);
      const conflicts = [];
      if (existingRun.sessionId !== sessionId) conflicts.push("sessionId");
      if ((input.status || input.status === "") && existingRun.status !== status) conflicts.push("status");
      if (context.workflowId && existingRun.workflowId !== context.workflowId) conflicts.push("workflowId");
      if (context.taskId && existingRun.taskId !== context.taskId) conflicts.push("taskId");
      if (context.dispatchId && existingRun.dispatchId && existingRun.dispatchId !== context.dispatchId) conflicts.push("dispatchId");
      if (workerId && existingRun.workerId !== workerId) conflicts.push("workerId");
      if ((input.input !== undefined || input.payload !== undefined) && jsonHash(existingRun.input) !== jsonHash(inputPayload)) conflicts.push("input");
      if (conflicts.length) throw new Error(`workflow session run id conflict: ${runId} fields=${conflicts.join(",")}`);
      const resolvedDispatchId = existingRun.dispatchId || context.dispatchId;
      if (resolvedDispatchId && !existingRun.dispatchId) {
        await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET dispatch_id=${sqlValue(resolvedDispatchId)}, updated_at=${sqlValue(now)}
WHERE run_id=${sqlValue(runId)}
  AND (dispatch_id IS NULL OR dispatch_id='');`);
      }
      const phaseInfo = await workflowTaskPhaseInfo(paths, existingRun.workflowId || context.workflowId, existingRun.taskId || context.taskId);
      await upsertWorkflowAgentRun(paths, {
        agentRunId: `session.${runId}`,
        workflowId: existingRun.workflowId || context.workflowId,
        phaseId: phaseInfo.phaseId,
        phaseKey: phaseInfo.phaseKey,
        taskId: existingRun.taskId || context.taskId,
        dispatchId: resolvedDispatchId,
        sessionRunId: runId,
        runtime: pack.runtimeTarget || "session_pack",
        agentId: existingRun.workerId || workerId || pack.ownerAgent || "",
        status: existingRun.status,
        attempt: 0,
        inputHash: jsonHash(existingRun.input),
        outputHash: jsonHash(existingRun.output),
        receiptRef: existingRun.receiptRef,
        error: existingRun.error,
        payload: { source: "workflow_session_runs", sessionId, packVersion: existingRun.packVersion, dedupeBackfill: true },
        startedAt: existingRun.startedAt,
        completedAt: existingRun.completedAt,
        updatedAt: now
      });
      return { ...existingRun, dispatchId: resolvedDispatchId, deduped: true, dbFile: paths.dbFile };
    }
    const workerInput = workerInputFromSessionPack(pack, inputPayload, context);
    await sqlite(paths.dbFile, `
INSERT INTO workflow_session_runs(run_id, session_id, pack_version, workflow_id, task_id, dispatch_id, worker_id, status, input_json, worker_input_json, output_json, receipt_ref, error, started_at, completed_at, created_at, updated_at)
VALUES (${sqlValue(runId)}, ${sqlValue(sessionId)}, ${sqlValue(pack.version)}, ${sqlValue(context.workflowId)}, ${sqlValue(context.taskId)}, ${sqlValue(context.dispatchId)}, ${sqlValue(workerId)}, ${sqlValue(status)}, ${sqlValue(JSON.stringify(inputPayload))}, ${sqlValue(JSON.stringify(workerInput))}, '{}', '', '', ${sqlValue(status === "running" ? now : "")}, '', ${sqlValue(now)}, ${sqlValue(now)});`);
    const phaseInfo = await workflowTaskPhaseInfo(paths, context.workflowId, context.taskId);
    await upsertWorkflowAgentRun(paths, {
      agentRunId: `session.${runId}`,
      workflowId: context.workflowId,
      phaseId: phaseInfo.phaseId,
      phaseKey: phaseInfo.phaseKey,
      taskId: context.taskId,
      dispatchId: context.dispatchId,
      sessionRunId: runId,
      runtime: pack.runtimeTarget || "session_pack",
      agentId: workerId || pack.ownerAgent || "",
      status,
      attempt: 0,
      inputHash: jsonHash(inputPayload),
      payload: { source: "workflow_session_runs", sessionId, packVersion: pack.version },
      startedAt: status === "running" ? now : "",
      createdAt: now,
      updatedAt: now
    });
    return { runId, sessionId, packVersion: pack.version, status, workerInput, dbFile: paths.dbFile };
  }

  async function workflowSessionRunCompleteCore(paths, input = {}) {
    const runId = String(input.runId || input.run_id || "").trim();
    if (!runId) throw new Error("runId is required");
    const currentRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
    if (!currentRows[0]) throw new Error(`workflow session run not found: ${runId}`);
    const current = sessionRunFromRow(currentRows[0]);
    const now = nowIso();
    const status = requireWorkflowSessionRunStatus(input.status || "completed", "completed");
    const outputProvided = input.output !== undefined || input.result !== undefined || input.payload !== undefined;
    const receiptProvided = input.receiptRef !== undefined || input.receipt_ref !== undefined || input.artifactRef !== undefined || input.artifact_ref !== undefined;
    const errorProvided = input.error !== undefined;
    const output = outputProvided ? sessionJsonObject(input.output ?? input.result ?? input.payload ?? {}) : current.output;
    const receiptRef = receiptProvided ? String(input.receiptRef || input.receipt_ref || input.artifactRef || input.artifact_ref || "") : current.receiptRef;
    const errorText = errorProvided ? String(input.error || "") : current.error;
    if (isTerminalWorkflowSessionRunStatus(current.status)) {
      const conflicts = [];
      if (status !== current.status) conflicts.push("status");
      if (outputProvided && jsonHash(output) !== jsonHash(current.output)) conflicts.push("output");
      if (receiptProvided && receiptRef !== current.receiptRef) conflicts.push("receiptRef");
      if (errorProvided && errorText !== current.error) conflicts.push("error");
      if (conflicts.length) throw new Error(`workflow session run terminal conflict: ${runId} fields=${conflicts.join(",")}`);
      return { ...current, deduped: true, dbFile: paths.dbFile };
    }
    await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET status=${sqlValue(status)},
    output_json=${sqlValue(JSON.stringify(output))},
    receipt_ref=${sqlValue(receiptRef)},
    error=${sqlValue(errorText)},
    completed_at=${sqlValue(isTerminalWorkflowSessionRunStatus(status) ? now : current.completedAt)},
    updated_at=${sqlValue(now)}
WHERE run_id=${sqlValue(runId)};`);
    const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
    const next = sessionRunFromRow(rows[0]);
    const existingAgentRunRows = await sqlite(paths.dbFile, `SELECT dispatch_id, phase_id, phase_key, runtime, agent_id FROM workflow_agent_runs WHERE agent_run_id=${sqlValue(`session.${runId}`)} LIMIT 1;`, { json: true });
    const existingAgentRun = existingAgentRunRows[0] || {};
    const phaseInfo = await workflowTaskPhaseInfo(paths, next.workflowId, next.taskId);
    await upsertWorkflowAgentRun(paths, {
      agentRunId: `session.${runId}`,
      workflowId: next.workflowId,
      phaseId: phaseInfo.phaseId || existingAgentRun.phase_id || "",
      phaseKey: phaseInfo.phaseKey || existingAgentRun.phase_key || "",
      taskId: next.taskId,
      dispatchId: next.dispatchId || existingAgentRun.dispatch_id || "",
      sessionRunId: runId,
      runtime: existingAgentRun.runtime || "session_pack",
      agentId: next.workerId || existingAgentRun.agent_id || "",
      status: next.status,
      inputHash: jsonHash(next.input),
      outputHash: jsonHash(next.output),
      receiptRef: next.receiptRef,
      error: next.error,
      payload: { source: "workflow_session_runs", sessionId: next.sessionId, packVersion: next.packVersion },
      startedAt: next.startedAt,
      completedAt: next.completedAt,
      updatedAt: now
    });
    return { ...next, dbFile: paths.dbFile };
  }

  async function workflowSessionPackUpsert(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionPackUpsertCore(paths, input);
  }

  async function workflowSessionPackGet(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionPackGetSnapshot(paths, input);
  }

  async function workflowSessionPackList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionPackListSnapshot(paths, input);
  }

  async function workflowSessionRunStart(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionRunStartCore(paths, input);
  }

  async function workflowSessionRunComplete(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionRunCompleteCore(paths, input);
  }

  return {
    workflowSessionPackGet,
    workflowSessionPackList,
    workflowSessionPackUpsert,
    workflowSessionRunComplete,
    workflowSessionRunStart
  };
}
