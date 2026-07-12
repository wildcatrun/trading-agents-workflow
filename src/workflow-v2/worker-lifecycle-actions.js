import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  boolOption,
  firstText,
  jsonHash,
  safeId
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount,
  sqliteTransaction,
  tableColumns
} from "../workflow/sqlite.js";
import {
  requireWorkflowSessionRunStatus,
  sessionJsonObject,
  sessionPackFromRow,
  sessionRunFromRow,
  workerInputFromSessionPack
} from "../session-actions.js";
import {
  WORKFLOW_V2_DEFAULT_CONTEXT_PRESSURE_THRESHOLD,
  WORKFLOW_V2_DEFAULT_MAX_COMPACTIONS,
  WORKFLOW_V2_HANDOFF_RECORD_STATUSES,
  WORKFLOW_V2_SUCCESSOR_SOURCE_STATUSES,
  WORKFLOW_V2_WORKER_HANDOFF_STATUSES,
  WORKFLOW_V2_WORKER_RUN_STATUSES
} from "./constants.js";
import {
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2NormalizeBackend,
  workflowV2NormalizeEnum,
  workflowV2UniqueTextArray,
  workflowV2ValidationError,
  workflowV2WorkerRunSummary,
  workflowV2WorkerSessionRunInput
} from "./helpers.js";
import {
  workflowV2ValidateWorkerDelegationContract,
  workflowV2WorkerDelegationContract
} from "./plan.js";
import {
  workflowV2WorkerBackendPreflight as workflowV2WorkerBackendPreflightCore
} from "./backend-preflight.js";
import {
  workflowV2LoadWorkerLifecycleActor,
  workflowV2PersistedPlanNodeHardGateErrors,
  workflowV2RestoreWorkerHandoffRow,
  workflowV2RestoreWorkerRunRow,
  workflowV2WorkerHandoffById,
  workflowV2WorkerHandoffRow
} from "./worker-state.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 worker lifecycle action dependency missing: ${name}`);
  return value;
}

function hasAllColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
}

export function createWorkflowV2WorkerLifecycleActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeOptionalAgentId = requireContextFunction(context, "normalizeOptionalAgentId");
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowV2AutonomousLoopSpawnGate = requireContextFunction(context, "workflowV2AutonomousLoopSpawnGate");
  const workflowV2CleanupInfoStackItem = requireContextFunction(context, "workflowV2CleanupInfoStackItem");
  const workflowV2InfoStackExistingItem = requireContextFunction(context, "workflowV2InfoStackExistingItem");
  const workflowV2InfoStackPreview = requireContextFunction(context, "workflowV2InfoStackPreview");
  const workflowV2InfoStackRecord = requireContextFunction(context, "workflowV2InfoStackRecord");
  const workflowV2RequireSessionRunPatch = requireContextFunction(context, "workflowV2RequireSessionRunPatch");
  const workflowTaskPhaseInfo = requireContextFunction(context, "workflowTaskPhaseInfo");

function workflowV2BackendPreflightDeps() {
  return { boolOption, firstText, safeId, workflowPaths };
}


async function workflowV2WorkerBackendPreflight(rootDir, input = {}) {
  return workflowV2WorkerBackendPreflightCore(rootDir, input, workflowV2BackendPreflightDeps());
}


async function workflowV2WorkerBackendPreflightRecord(rootDir, input = {}) {
  const preview = await workflowV2WorkerBackendPreflight(rootDir, input);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  const preflight = preview.preflight;
  const findings = [
    ...preview.errors.map((item) => ({ severity: "error", ...item })),
    ...preview.warnings.map((item) => ({ severity: "warning", ...item }))
  ];
  const payload = {
    preflight,
    errors: preview.errors,
    warnings: preview.warnings,
    planId: firstText(input.planId, input.plan_id),
    nodeId: firstText(input.nodeId, input.node_id),
    workerRunId: firstText(input.workerRunId, input.worker_run_id)
  };
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_backend_preflights(preflight_id, workflow_id, backend_id, status, findings_json, payload_json, created_by, created_at)
VALUES (${sqlValue(preflight.preflightId)}, ${sqlValue(preflight.workflowId)}, ${sqlValue(preflight.backendId)}, ${sqlValue(preflight.status)}, ${sqlValue(JSON.stringify(findings))}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdBy)}, ${sqlValue(now)})
ON CONFLICT(preflight_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  backend_id=excluded.backend_id,
  status=excluded.status,
  findings_json=excluded.findings_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  created_at=excluded.created_at;`);
  return { ...preview, operation: "workflow.v2.worker_backend_preflight.record", dryRun: false, previewOnly: false, dbFile: paths.dbFile };
}


function workflowV2SessionAgentRunUpsertSql(run = {}) {
  const now = run.updatedAt || nowIso();
  const agentRunId = run.agentRunId || run.agent_run_id || "";
  if (!agentRunId) return "";
  return `
INSERT INTO workflow_agent_runs(agent_run_id, workflow_id, phase_id, phase_key, task_id, dispatch_id, runtime_run_id, session_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref, error, payload_json, started_at, completed_at, created_at, updated_at)
VALUES (${sqlValue(agentRunId)}, ${sqlValue(run.workflowId || "")}, ${sqlValue(run.phaseId || "")}, ${sqlValue(run.phaseKey || "")}, ${sqlValue(run.taskId || "")}, ${sqlValue(run.dispatchId || "")}, ${sqlValue(run.runtimeRunId || "")}, ${sqlValue(run.sessionRunId || "")}, ${sqlValue(run.runtime || "")}, ${sqlValue(run.agentId || "")}, ${sqlValue(run.status || "unknown")}, ${Number(run.attempt || 0)}, ${sqlValue(run.inputHash || "")}, ${sqlValue(run.outputHash || "")}, ${sqlValue(run.receiptRef || "")}, ${sqlValue(String(run.error || "").slice(0, 2000))}, ${sqlValue(JSON.stringify(run.payload || {}))}, ${sqlValue(run.startedAt || "")}, ${sqlValue(run.completedAt || "")}, ${sqlValue(run.createdAt || now)}, ${sqlValue(now)})
ON CONFLICT(agent_run_id) DO UPDATE SET
  workflow_id=COALESCE(NULLIF(excluded.workflow_id, ''), workflow_agent_runs.workflow_id),
  phase_id=COALESCE(NULLIF(excluded.phase_id, ''), workflow_agent_runs.phase_id),
  phase_key=COALESCE(NULLIF(excluded.phase_key, ''), workflow_agent_runs.phase_key),
  task_id=COALESCE(NULLIF(excluded.task_id, ''), workflow_agent_runs.task_id),
  dispatch_id=COALESCE(NULLIF(excluded.dispatch_id, ''), workflow_agent_runs.dispatch_id),
  runtime_run_id=COALESCE(NULLIF(excluded.runtime_run_id, ''), workflow_agent_runs.runtime_run_id),
  session_run_id=COALESCE(NULLIF(excluded.session_run_id, ''), workflow_agent_runs.session_run_id),
  runtime=COALESCE(NULLIF(excluded.runtime, ''), workflow_agent_runs.runtime),
  agent_id=COALESCE(NULLIF(excluded.agent_id, ''), workflow_agent_runs.agent_id),
  status=excluded.status,
  attempt=excluded.attempt,
  input_hash=COALESCE(NULLIF(excluded.input_hash, ''), workflow_agent_runs.input_hash),
  output_hash=COALESCE(NULLIF(excluded.output_hash, ''), workflow_agent_runs.output_hash),
  receipt_ref=COALESCE(NULLIF(excluded.receipt_ref, ''), workflow_agent_runs.receipt_ref),
  error=COALESCE(NULLIF(excluded.error, ''), workflow_agent_runs.error),
  payload_json=excluded.payload_json,
  started_at=COALESCE(NULLIF(excluded.started_at, ''), workflow_agent_runs.started_at),
  completed_at=COALESCE(NULLIF(excluded.completed_at, ''), workflow_agent_runs.completed_at),
  updated_at=excluded.updated_at;`;
}


async function workflowV2WorkerSpawnSessionRunPlan(paths, run, generatedAt) {
  const sessionRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(run.sessionId)} LIMIT 1;`, { json: true });
  const pack = sessionPackFromRow(sessionRows[0]);
  if (!pack) throw new Error(`workflow session pack not found: ${run.sessionId}`);
  if (!["active", "draft"].includes(pack.status)) throw new Error(`workflow session pack is not runnable: ${pack.status}`);
  const status = requireWorkflowSessionRunStatus("queued");
  const inputPayload = sessionJsonObject(workflowV2WorkerSessionRunInput(run), {});
  const context = {
    workflowId: run.workflowId,
    taskId: run.nodeId,
    traceId: "",
    dispatchId: ""
  };
  const workerId = run.workerAgentId || "";
  const existingRunRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(run.sessionRunId)} LIMIT 1;`, { json: true });
  if (existingRunRows[0]) {
    const existingRun = sessionRunFromRow(existingRunRows[0]);
    const conflicts = [];
    if (existingRun.sessionId !== run.sessionId) conflicts.push("sessionId");
    if (existingRun.status !== status) conflicts.push("status");
    if (context.workflowId && existingRun.workflowId !== context.workflowId) conflicts.push("workflowId");
    if (context.taskId && existingRun.taskId !== context.taskId) conflicts.push("taskId");
    if (workerId && existingRun.workerId !== workerId) conflicts.push("workerId");
    if (jsonHash(existingRun.input) !== jsonHash(inputPayload)) conflicts.push("input");
    if (conflicts.length) throw new Error(`workflow session run id conflict: ${run.sessionRunId} fields=${conflicts.join(",")}`);
    const resolvedDispatchId = existingRun.dispatchId || context.dispatchId;
    const phaseInfo = await workflowTaskPhaseInfo(paths, existingRun.workflowId || context.workflowId, existingRun.taskId || context.taskId);
    const sessionUpdateSql = resolvedDispatchId && !existingRun.dispatchId
      ? `
UPDATE workflow_session_runs
SET dispatch_id=${sqlValue(resolvedDispatchId)}, updated_at=${sqlValue(generatedAt)}
WHERE run_id=${sqlValue(run.sessionRunId)}
  AND (dispatch_id IS NULL OR dispatch_id='');`
      : "";
    const agentRunSql = workflowV2SessionAgentRunUpsertSql({
      agentRunId: `session.${run.sessionRunId}`,
      workflowId: existingRun.workflowId || context.workflowId,
      phaseId: phaseInfo.phaseId,
      phaseKey: phaseInfo.phaseKey,
      taskId: existingRun.taskId || context.taskId,
      dispatchId: resolvedDispatchId,
      sessionRunId: run.sessionRunId,
      runtime: pack.runtimeTarget || "session_pack",
      agentId: existingRun.workerId || workerId || pack.ownerAgent || "",
      status: existingRun.status,
      attempt: 0,
      inputHash: jsonHash(existingRun.input),
      outputHash: jsonHash(existingRun.output),
      receiptRef: existingRun.receiptRef,
      error: existingRun.error,
      payload: { source: "workflow_session_runs", sessionId: run.sessionId, packVersion: existingRun.packVersion, dedupeBackfill: true },
      startedAt: existingRun.startedAt,
      completedAt: existingRun.completedAt,
      updatedAt: generatedAt
    });
    return {
      sessionRun: { ...existingRun, dispatchId: resolvedDispatchId, deduped: true, dbFile: paths.dbFile },
      sql: [sessionUpdateSql, agentRunSql].filter(Boolean).join("\n")
    };
  }
  const workerInput = workerInputFromSessionPack(pack, inputPayload, context);
  const phaseInfo = await workflowTaskPhaseInfo(paths, context.workflowId, context.taskId);
  const sessionRunSql = `
INSERT INTO workflow_session_runs(run_id, session_id, pack_version, workflow_id, task_id, dispatch_id, worker_id, status, input_json, worker_input_json, output_json, receipt_ref, error, started_at, completed_at, created_at, updated_at)
VALUES (${sqlValue(run.sessionRunId)}, ${sqlValue(run.sessionId)}, ${sqlValue(pack.version)}, ${sqlValue(context.workflowId)}, ${sqlValue(context.taskId)}, ${sqlValue(context.dispatchId)}, ${sqlValue(workerId)}, ${sqlValue(status)}, ${sqlValue(JSON.stringify(inputPayload))}, ${sqlValue(JSON.stringify(workerInput))}, '{}', '', '', '', '', ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)});`;
  const agentRunSql = workflowV2SessionAgentRunUpsertSql({
    agentRunId: `session.${run.sessionRunId}`,
    workflowId: context.workflowId,
    phaseId: phaseInfo.phaseId,
    phaseKey: phaseInfo.phaseKey,
    taskId: context.taskId,
    dispatchId: context.dispatchId,
    sessionRunId: run.sessionRunId,
    runtime: pack.runtimeTarget || "session_pack",
    agentId: workerId || pack.ownerAgent || "",
    status,
    attempt: 0,
    inputHash: jsonHash(inputPayload),
    payload: { source: "workflow_session_runs", sessionId: run.sessionId, packVersion: pack.version },
    startedAt: "",
    createdAt: generatedAt,
    updatedAt: generatedAt
  });
  return {
    sessionRun: { runId: run.sessionRunId, sessionId: run.sessionId, packVersion: pack.version, status, workerInput, dbFile: paths.dbFile },
    sql: [sessionRunSql, agentRunSql].join("\n")
  };
}


function workflowV2WorkerSpawnPreflightRecordSql(preview, input = {}, run = {}, generatedAt = "") {
  const preflight = preview.backendPreflight;
  const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  const findings = [
    ...preview.errors.map((item) => ({ severity: "error", ...item })),
    ...preview.warnings.map((item) => ({ severity: "warning", ...item }))
  ];
  const payload = {
    preflight,
    errors: preview.errors,
    warnings: preview.warnings,
    planId: run.planId,
    nodeId: run.nodeId,
    workerRunId: run.workerRunId
  };
  return `
INSERT INTO workflow_v2_backend_preflights(preflight_id, workflow_id, backend_id, status, findings_json, payload_json, created_by, created_at)
VALUES (${sqlValue(preflight.preflightId)}, ${sqlValue(preflight.workflowId)}, ${sqlValue(preflight.backendId)}, ${sqlValue(preflight.status)}, ${sqlValue(JSON.stringify(findings))}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdBy)}, ${sqlValue(generatedAt)})
ON CONFLICT(preflight_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  backend_id=excluded.backend_id,
  status=excluded.status,
  findings_json=excluded.findings_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  created_at=excluded.created_at;`;
}


function workflowV2WorkerSpawnRunUpsertSql(run, workerPayload, generatedAt) {
  return `
INSERT INTO workflow_v2_worker_runs(worker_run_id, workflow_id, plan_id, node_id, parent_worker_run_id, supersedes_worker_run_id, successor_worker_run_id, worker_generation, manager_agent, worker_agent_id, session_id, session_run_id, preflight_id, runtime_backend, status, attempt, max_attempts, lease_owner, lease_until, next_retry_at, task_input_info_id, output_info_id, handoff_info_id, receipt_ref, last_error, context_budget_tokens, context_used_tokens, compaction_count, source_context_refs_json, payload_json, started_at, completed_at, created_at, updated_at)
VALUES (${sqlValue(run.workerRunId)}, ${sqlValue(run.workflowId)}, ${sqlValue(run.planId)}, ${sqlValue(run.nodeId)}, ${sqlValue(run.parentWorkerRunId)}, ${sqlValue(run.supersedesWorkerRunId)}, ${sqlValue(run.successorWorkerRunId)}, ${sqlValue(run.workerGeneration)}, ${sqlValue(run.managerAgent)}, ${sqlValue(run.workerAgentId)}, ${sqlValue(run.sessionId)}, ${sqlValue(run.sessionRunId)}, ${sqlValue(run.preflightId)}, ${sqlValue(run.runtimeBackend)}, ${sqlValue(run.status)}, ${sqlValue(run.attempt)}, ${sqlValue(run.maxAttempts)}, ${sqlValue(run.leaseOwner)}, ${sqlValue(run.leaseUntil)}, ${sqlValue(run.nextRetryAt)}, ${sqlValue(run.taskInputInfoId)}, ${sqlValue(run.outputInfoId)}, ${sqlValue(run.handoffInfoId)}, ${sqlValue(run.receiptRef)}, ${sqlValue(run.lastError)}, ${sqlValue(run.contextBudgetTokens)}, ${sqlValue(run.contextUsedTokens)}, ${sqlValue(run.compactionCount)}, ${sqlValue(JSON.stringify(run.sourceContextRefs))}, ${sqlValue(JSON.stringify(workerPayload))}, ${sqlValue(run.startedAt)}, ${sqlValue(run.completedAt)}, ${sqlValue(generatedAt)}, ${sqlValue(generatedAt)})
ON CONFLICT(worker_run_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  node_id=excluded.node_id,
  parent_worker_run_id=excluded.parent_worker_run_id,
  supersedes_worker_run_id=excluded.supersedes_worker_run_id,
  successor_worker_run_id=excluded.successor_worker_run_id,
  worker_generation=excluded.worker_generation,
  manager_agent=excluded.manager_agent,
  worker_agent_id=excluded.worker_agent_id,
  session_id=excluded.session_id,
  session_run_id=excluded.session_run_id,
  preflight_id=excluded.preflight_id,
  runtime_backend=excluded.runtime_backend,
  status=excluded.status,
  attempt=excluded.attempt,
  max_attempts=excluded.max_attempts,
  lease_owner=excluded.lease_owner,
  lease_until=excluded.lease_until,
  next_retry_at=excluded.next_retry_at,
  task_input_info_id=excluded.task_input_info_id,
  output_info_id=excluded.output_info_id,
  handoff_info_id=excluded.handoff_info_id,
  receipt_ref=excluded.receipt_ref,
  last_error=excluded.last_error,
  context_budget_tokens=excluded.context_budget_tokens,
  context_used_tokens=excluded.context_used_tokens,
  compaction_count=excluded.compaction_count,
  source_context_refs_json=excluded.source_context_refs_json,
  payload_json=excluded.payload_json,
  started_at=excluded.started_at,
  completed_at=excluded.completed_at,
  updated_at=excluded.updated_at;`;
}


async function workflowV2WorkerSpawnPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workflowId = firstText(input.workflowId, input.workflow_id) || safeId("workflow-v2");
  const planId = firstText(input.planId, input.plan_id);
  const nodeId = firstText(input.nodeId, input.node_id);
  const managerAgent = normalizeOptionalAgentId(firstText(input.managerAgent, input.manager_agent, input.ownerAgent, input.owner_agent, "cat_heart")) || "cat_heart";
  const sessionId = firstText(input.sessionId, input.session_id, input.sessionTemplateId, input.session_template_id);
  const taskInputInfoId = firstText(input.taskInputInfoId, input.task_input_info_id, input.infoId, input.info_id);
  const runtimeBackend = workflowV2NormalizeBackend(input.runtimeBackend || input.runtime_backend || "hermers_docker_worker");
  if (!planId) errors.push(workflowV2ValidationError("plan_id_required", "worker spawn requires planId"));
  if (!nodeId) errors.push(workflowV2ValidationError("node_id_required", "worker spawn requires nodeId"));
  if (!sessionId) errors.push(workflowV2ValidationError("session_id_required", "worker spawn requires sessionId/sessionTemplateId from session repository"));
  if (!taskInputInfoId) errors.push(workflowV2ValidationError("task_input_info_id_required", "worker spawn requires taskInputInfoId pointer"));
  errors.push(...await workflowV2PersistedPlanNodeHardGateErrors(paths, workflowId, planId));
  const autonomousLoopGate = await workflowV2AutonomousLoopSpawnGate(paths, workflowId, planId, nodeId, input);
  errors.push(...autonomousLoopGate.errors);
  const preflight = await workflowV2WorkerBackendPreflight(rootDir, { ...input, backendId: runtimeBackend, workflowId });
  errors.push(...preflight.errors);
  const preflightId = firstText(input.preflightId, input.preflight_id, preflight.preflight.preflightId);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id) || safeId("v2-worker");
  const sessionRunId = firstText(input.sessionRunId, input.session_run_id) || `${workerRunId}.session`;
  const requestedStatus = firstText(input.status, input.workerStatus, input.worker_status);
  const normalizedRequestedStatus = requestedStatus ? workflowV2NormalizeEnum(requestedStatus, WORKFLOW_V2_WORKER_RUN_STATUSES, "") : "";
  if (requestedStatus && normalizedRequestedStatus !== "queued") {
    errors.push(workflowV2ValidationError("worker_spawn_status_must_be_queued", "worker spawn create can only create queued worker runs; lifecycle transitions must go through control-loop, result, review, or renewal actions", {
      requestedStatus,
      normalizedRequestedStatus
    }));
  }
  const parentWorkerRunId = firstText(input.parentWorkerRunId, input.parent_worker_run_id);
  const supersedesWorkerRunId = firstText(input.supersedesWorkerRunId, input.supersedes_worker_run_id);
  const successorWorkerRunId = firstText(input.successorWorkerRunId, input.successor_worker_run_id);
  const contextBudgetRaw = input.contextBudgetTokens ?? input.context_budget_tokens;
  const explicitContextBudget = contextBudgetRaw !== undefined && contextBudgetRaw !== null && String(contextBudgetRaw).trim() !== "";
  const contextBudgetTokens = workflowV2NonNegativeInt(contextBudgetRaw, 0);
  const delegation = workflowV2WorkerDelegationContract({ ...input, contextBudgetTokens });
  errors.push(...workflowV2ValidateWorkerDelegationContract(delegation, contextBudgetTokens, { explicitContextBudget }));
  const inputPayload = workflowV2JsonObject(input.payload, {});
  const inputAutonomousLoopPayload = workflowV2JsonObject(inputPayload.autonomousLoop ?? inputPayload.autonomous_loop, {});
  const workerRun = {
    workerRunId,
    workflowId,
    planId,
    nodeId,
    parentWorkerRunId,
    supersedesWorkerRunId,
    successorWorkerRunId,
    workerGeneration: workflowV2NonNegativeInt(input.workerGeneration ?? input.worker_generation, parentWorkerRunId || supersedesWorkerRunId ? 1 : 0),
    managerAgent,
    workerAgentId: firstText(input.workerAgentId, input.worker_agent_id) || safeId("worker"),
    sessionId,
    sessionRunId,
    preflightId,
    runtimeBackend,
    status: "queued",
    attempt: Math.max(0, Number(input.attempt || 0)),
    maxAttempts: Math.max(1, Math.min(20, Number(input.maxAttempts || input.max_attempts || 1))),
    leaseOwner: firstText(input.leaseOwner, input.lease_owner),
    leaseUntil: firstText(input.leaseUntil, input.lease_until),
    nextRetryAt: firstText(input.nextRetryAt, input.next_retry_at),
    taskInputInfoId,
    outputInfoId: firstText(input.outputInfoId, input.output_info_id),
    handoffInfoId: firstText(input.handoffInfoId, input.handoff_info_id),
    receiptRef: firstText(input.receiptRef, input.receipt_ref),
    lastError: firstText(input.lastError, input.last_error),
    contextBudgetTokens,
    contextUsedTokens: workflowV2NonNegativeInt(input.contextUsedTokens ?? input.context_used_tokens, 0),
    compactionCount: workflowV2NonNegativeInt(input.compactionCount ?? input.compaction_count, 0),
    sourceContextRefs: workflowV2JsonArray(input.sourceContextRefs ?? input.source_context_refs, []),
    startedAt: firstText(input.startedAt, input.started_at),
    completedAt: firstText(input.completedAt, input.completed_at),
    payload: {
      ...inputPayload,
      delegation,
      ...(autonomousLoopGate.state ? {
        autonomousLoop: {
          ...inputAutonomousLoopPayload,
          ...autonomousLoopGate.state
        }
      } : {})
    }
  };
  return {
    operation: "workflow.v2.worker_spawn.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    warnings: preflight.warnings,
    workerRun,
    sessionRunPlan: {
      runId: sessionRunId,
      sessionId,
      status: "queued",
      workflowId,
      taskId: nodeId,
      workerId: workerRun.workerAgentId,
      input: workflowV2WorkerSessionRunInput(workerRun)
    },
    backendPreflight: preflight.preflight,
    autonomousLoopGate,
    reviewRequired: true,
    dbFile: paths.dbFile,
    writes: []
  };
}


async function workflowV2WorkerSpawnCreate(rootDir, input = {}) {
  const preview = await workflowV2WorkerSpawnPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 worker spawn is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const run = preview.workerRun;
  const sessionPlan = await workflowV2WorkerSpawnSessionRunPlan(paths, run, now);
  const sessionRun = sessionPlan.sessionRun;
  const workerPayload = {
    ...run.payload,
    sessionRun: {
      sessionRunId: sessionRun.runId,
      sessionId: sessionRun.sessionId,
      packVersion: sessionRun.packVersion,
      status: sessionRun.status,
      source: "workflow_session_runs"
    }
  };
  await sqliteTransaction(paths.dbFile, [
    sessionPlan.sql,
    workflowV2WorkerSpawnPreflightRecordSql(preview, input, run, now),
    workflowV2WorkerSpawnRunUpsertSql(run, workerPayload, now)
  ].filter(Boolean).join("\n"));
  return { ...preview, operation: "workflow.v2.worker_spawn.create", dryRun: false, previewOnly: false, sessionRun, dbFile: paths.dbFile };
}


async function workflowV2WorkerLifecycleSchema(dbFile) {
  const workerColumns = await tableColumns(dbFile, "workflow_v2_worker_runs");
  const handoffColumns = await tableColumns(dbFile, "workflow_v2_worker_handoffs");
  const workerRequired = [
    "worker_run_id",
    "workflow_id",
    "plan_id",
    "node_id",
    "parent_worker_run_id",
    "supersedes_worker_run_id",
    "successor_worker_run_id",
    "worker_generation",
    "manager_agent",
    "status",
    "handoff_info_id",
    "output_info_id",
    "receipt_ref",
    "context_budget_tokens",
    "context_used_tokens",
    "compaction_count",
    "source_context_refs_json",
    "lease_until"
  ];
  const handoffRequired = [
    "handoff_id",
    "workflow_id",
    "plan_id",
    "worker_run_id",
    "successor_worker_run_id",
    "handoff_info_id",
    "status"
  ];
  return {
    ready: hasAllColumns(workerColumns, workerRequired) && hasAllColumns(handoffColumns, handoffRequired),
    missingWorkerColumns: workerRequired.filter((column) => !workerColumns.has(column)),
    missingHandoffColumns: handoffRequired.filter((column) => !handoffColumns.has(column)),
    workerTableExists: workerColumns.size > 0,
    handoffTableExists: handoffColumns.size > 0
  };
}


function workflowV2ContextPressureThreshold() {
  return WORKFLOW_V2_DEFAULT_CONTEXT_PRESSURE_THRESHOLD;
}


async function workflowV2WorkerLifecyclePreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const workerRunId = firstText(input.workerRunId, input.worker_run_id, input.runId, input.run_id);
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const errors = [];
  if (!workerRunId) errors.push(workflowV2ValidationError("worker_run_id_required", "worker lifecycle preview requires workerRunId"));
  if (!fileExistsSync(paths.dbFile)) {
    return {
      operation: "workflow.v2.worker_lifecycle.preview",
      dryRun: true,
      previewOnly: true,
      status: "skipped",
      valid: errors.length === 0,
      errors,
      reason: "workflow database does not exist",
      generatedAt,
      recommendation: null,
      dbFile: paths.dbFile,
      writes: []
    };
  }
  const schema = await workflowV2WorkerLifecycleSchema(paths.dbFile);
  if (!schema.ready) {
    return {
      operation: "workflow.v2.worker_lifecycle.preview",
      dryRun: true,
      previewOnly: true,
      status: "schema_gap",
      ok: false,
      valid: false,
      errors,
      generatedAt,
      schema,
      recommendation: null,
      dbFile: paths.dbFile,
      writes: []
    };
  }
  let row = null;
  if (workerRunId) {
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(workerRunId)}
LIMIT 1;`, { json: true });
    row = rows[0] || null;
    if (!row) errors.push(workflowV2ValidationError("worker_run_not_found", `worker run not found: ${workerRunId}`));
    if (row && workflowId && row.workflow_id !== workflowId) {
      errors.push(workflowV2ValidationError("workflow_id_mismatch", "worker lifecycle workflowId does not match worker run", {
        workerWorkflowId: row.workflow_id,
        workflowId
      }));
    }
  }
  if (!row) {
    return {
      operation: "workflow.v2.worker_lifecycle.preview",
      dryRun: true,
      previewOnly: true,
      status: "invalid",
      valid: false,
      errors,
      generatedAt,
      recommendation: null,
      dbFile: paths.dbFile,
      writes: []
    };
  }
  const planRows = await sqlite(paths.dbFile, `
SELECT task_owner_agent
FROM workflow_v2_plans
WHERE plan_id=${sqlValue(row.plan_id)}
LIMIT 1;`, { json: true });
  const reviewRows = await sqlite(paths.dbFile, `
SELECT review_id, reviewer_agent, decision, summary, created_at
FROM workflow_v2_manager_reviews
WHERE worker_run_id=${sqlValue(row.worker_run_id)}
ORDER BY created_at DESC
LIMIT 1;`, { json: true });
  const handoffRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_handoffs
WHERE worker_run_id=${sqlValue(row.worker_run_id)}
ORDER BY updated_at DESC, created_at DESC
LIMIT 1;`, { json: true });
  const taskOwnerAgent = normalizeOptionalAgentId(planRows[0]?.task_owner_agent || "") || "";
  const latestReview = reviewRows[0] || null;
  const latestHandoff = handoffRows[0] || null;
  const budget = workflowV2NonNegativeInt(input.contextBudgetTokens ?? input.context_budget_tokens, row.context_budget_tokens || 0);
  const used = workflowV2NonNegativeInt(input.contextUsedTokens ?? input.context_used_tokens, row.context_used_tokens || 0);
  const compactionCount = workflowV2NonNegativeInt(input.compactionCount ?? input.compaction_count, row.compaction_count || 0);
  const maxCompactions = WORKFLOW_V2_DEFAULT_MAX_COMPACTIONS;
  const threshold = workflowV2ContextPressureThreshold(input);
  const contextPressureRatio = budget > 0 ? used / budget : null;
  const signals = [];
  if (contextPressureRatio !== null && contextPressureRatio >= threshold) {
    signals.push({
      code: "context_pressure_high",
      severity: contextPressureRatio >= 0.95 ? "critical" : "warning",
      ratio: Number(contextPressureRatio.toFixed(4)),
      threshold
    });
  }
  if (compactionCount >= maxCompactions) {
    signals.push({
      code: "compaction_limit_reached",
      severity: compactionCount > maxCompactions ? "critical" : "warning",
      compactionCount,
      maxCompactions
    });
  }
  if (latestReview && ["rejected", "revise_required"].includes(latestReview.decision)) {
    signals.push({
      code: "review_failure",
      severity: "warning",
      reviewId: latestReview.review_id,
      decision: latestReview.decision
    });
  }
  const leaseUntilMs = Date.parse(row.lease_until || "");
  const generatedAtMs = Date.parse(generatedAt || "");
  if (row.status === "running" && row.lease_until && !Number.isNaN(leaseUntilMs) && !Number.isNaN(generatedAtMs) && leaseUntilMs <= generatedAtMs) {
    signals.push({ code: "lease_expired", severity: "warning", leaseUntil: row.lease_until });
  }
  if (row.status === "submitted_for_review") signals.push({ code: "review_due", severity: "info" });
  if (row.status === "handoff_required" && !latestHandoff) signals.push({ code: "handoff_package_missing", severity: "warning" });
  if (row.status === "handoff_required" && latestHandoff && latestHandoff.status !== "accepted") {
    signals.push({
      code: "handoff_not_accepted",
      severity: "warning",
      handoffId: latestHandoff.handoff_id,
      handoffStatus: latestHandoff.status
    });
  }
  if (row.status === "blocked") signals.push({ code: "blocked_condition", severity: "warning", lastError: row.last_error || "" });
  if (row.status === "needs_human_gate") signals.push({ code: "human_gate_required", severity: "info" });

  const terminalNoAction = new Set(["accepted", "cancelled", "successor_spawned"]);
  let recommendedAction = "continue";
  let reason = "worker can continue under current lifecycle policy";
  if (terminalNoAction.has(row.status)) {
    recommendedAction = "no_action";
    reason = `worker status ${row.status} does not require renewal`;
  } else if (row.status === "retired") {
    recommendedAction = row.successor_worker_run_id ? "no_action" : "spawn_successor";
    reason = row.successor_worker_run_id ? "retired worker already points at a successor" : "retired worker has no successor";
  } else if (row.status === "handoff_required") {
    recommendedAction = latestHandoff?.status === "accepted" ? "spawn_successor" : "handoff_required";
    reason = latestHandoff?.status === "accepted" ? "accepted handoff package exists and successor can be prepared" : "accepted handoff package is required before successor spawn";
  } else if (["failed", "timed_out", "rejected", "revise_required"].includes(row.status)) {
    recommendedAction = "spawn_successor";
    reason = `worker status ${row.status} should be renewed by successor worker`;
  } else if (row.status === "blocked") {
    recommendedAction = "escalate_to_owner";
    reason = "blocked worker requires owner/manager condition review before renewal";
  } else if (row.status === "needs_human_gate") {
    recommendedAction = "human_gate_due";
    reason = "worker outcome requires Human Gate path, not automatic renewal";
  } else if (signals.some((signal) => ["context_pressure_high", "compaction_limit_reached"].includes(signal.code))) {
    recommendedAction = "handoff_required";
    reason = "context pressure or compaction threshold requires a curated handoff before more work";
  } else if (row.status === "submitted_for_review") {
    recommendedAction = "review_due";
    reason = "worker output is waiting for responsible owner/manager review";
  }
  const handoffNeeded = ["handoff_required", "spawn_successor", "retire"].includes(recommendedAction);
  const sourceContextRefs = workflowV2JsonArray(input.sourceContextRefs ?? input.source_context_refs, workflowV2JsonArray(row.source_context_refs_json, []));
  const artifactRefs = workflowV2JsonArray(input.artifactRefs ?? input.artifact_refs, row.output_info_id ? [row.output_info_id] : []);
  const receiptRefs = workflowV2JsonArray(input.receiptRefs ?? input.receipt_refs, row.receipt_ref ? [row.receipt_ref] : []);
  const handoffId = firstText(input.handoffId, input.handoff_id) || `${row.worker_run_id}.handoff`;
  const handoffInfoId = firstText(input.handoffInfoId, input.handoff_info_id, row.handoff_info_id) || `${handoffId}.info`;
  return {
    operation: "workflow.v2.worker_lifecycle.preview",
    dryRun: true,
    previewOnly: true,
    status: "ok",
    ok: errors.length === 0,
    valid: errors.length === 0,
    errors,
    generatedAt,
    workerRun: workflowV2WorkerRunSummary(row),
    telemetry: {
      contextBudgetTokens: budget,
      contextUsedTokens: used,
      contextPressureRatio: contextPressureRatio === null ? null : Number(contextPressureRatio.toFixed(4)),
      contextPressureThreshold: threshold,
      compactionCount,
      maxCompactions
    },
    latestReview,
    latestHandoff: latestHandoff ? {
      handoffId: latestHandoff.handoff_id,
      status: latestHandoff.status,
      handoffInfoId: latestHandoff.handoff_info_id,
      successorWorkerRunId: latestHandoff.successor_worker_run_id,
      updatedAt: latestHandoff.updated_at
    } : null,
    signals,
    recommendation: {
      action: recommendedAction,
      reason,
      handoffRequired: handoffNeeded,
      successorAllowed: ["spawn_successor", "retire"].includes(recommendedAction) || (recommendedAction === "handoff_required" && latestHandoff?.status === "accepted"),
      requiredAuthority: {
        kind: "responsible_owner_or_manager",
        managerAgent: row.manager_agent || "",
        taskOwnerAgent,
        allowedAgents: Array.from(new Set([row.manager_agent || "", taskOwnerAgent].filter(Boolean)))
      }
    },
    handoffPackagePreview: handoffNeeded ? {
      handoffId,
      workflowId: row.workflow_id,
      planId: row.plan_id,
      nodeId: row.node_id,
      workerRunId: row.worker_run_id,
      managerAgent: row.manager_agent || "",
      successorWorkerRunId: row.successor_worker_run_id || firstText(input.successorWorkerRunId, input.successor_worker_run_id),
      handoffInfoId,
      status: "recommended",
      reason,
      sourceContextRefs,
      artifactRefs,
      receiptRefs
    } : null,
    dbFile: paths.dbFile,
    writes: []
  };
}


async function workflowV2CleanupWorkerSpawn(paths, workerRunId = "", sessionRunId = "", preflightId = "", deletePreflight = false) {
  if (workerRunId) {
    await sqlite(paths.dbFile, `DELETE FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(workerRunId)};`);
  }
  if (sessionRunId) {
    await sqlite(paths.dbFile, `
DELETE FROM workflow_agent_runs WHERE agent_run_id=${sqlValue(`session.${sessionRunId}`)} OR session_run_id=${sqlValue(sessionRunId)};
DELETE FROM workflow_session_runs WHERE run_id=${sqlValue(sessionRunId)};`);
  }
  if (deletePreflight && preflightId) {
    await sqlite(paths.dbFile, `DELETE FROM workflow_v2_backend_preflights WHERE preflight_id=${sqlValue(preflightId)};`);
  }
}


async function workflowV2WorkerHandoffPreview(rootDir, input = {}) {
  const loaded = await workflowV2LoadWorkerLifecycleActor(rootDir, input);
  const { paths, row } = loaded;
  const errors = [...loaded.errors];
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const requestedStatus = firstText(input.status, input.handoffStatus, input.handoff_status, "accepted");
  const status = workflowV2NormalizeEnum(requestedStatus, WORKFLOW_V2_WORKER_HANDOFF_STATUSES, "");
  if (!status) {
    errors.push(workflowV2ValidationError("handoff_status_invalid", "worker handoff status is not recognized", { requestedStatus }));
  } else if (!WORKFLOW_V2_HANDOFF_RECORD_STATUSES.has(status)) {
    errors.push(workflowV2ValidationError("handoff_status_not_recordable", "worker handoff record only supports recommended, required, or accepted status", { status }));
  }
  let handoffPackage = null;
  let infoExisting = null;
  let infoPreview = null;
  let existingHandoff = null;
  if (row) {
    if (["cancelled", "successor_spawned"].includes(row.status)) {
      errors.push(workflowV2ValidationError("worker_not_handoff_eligible", `worker status ${row.status} cannot record a new handoff`));
    }
    const handoffId = firstText(input.handoffId, input.handoff_id) || `${row.worker_run_id}.handoff`;
    const handoffInfoId = firstText(input.handoffInfoId, input.handoff_info_id, row.handoff_info_id) || `${handoffId}.info`;
    const summary = firstText(input.summary, input.handoffSummary, input.handoff_summary);
    const reason = firstText(input.reason, input.handoffReason, input.handoff_reason, "worker lifecycle handoff recorded");
    if (!summary) errors.push(workflowV2ValidationError("handoff_summary_required", "worker handoff requires a summary"));
    existingHandoff = handoffId
      ? await workflowV2WorkerHandoffById(paths, handoffId)
      : await workflowV2WorkerHandoffRow(paths, row.worker_run_id, "");
    if (existingHandoff && existingHandoff.worker_run_id !== row.worker_run_id) {
      errors.push(workflowV2ValidationError("handoff_id_conflict", "handoffId already belongs to another worker run", {
        handoffId,
        existingWorkerRunId: existingHandoff.worker_run_id
      }));
    }
    infoExisting = await workflowV2InfoStackExistingItem(paths.dbFile, handoffInfoId);
    if (infoExisting && (infoExisting.workflow_id !== row.workflow_id || (infoExisting.worker_run_id && infoExisting.worker_run_id !== row.worker_run_id))) {
      errors.push(workflowV2ValidationError("handoff_info_id_conflict", "handoffInfoId already exists outside the current worker handoff binding", {
        handoffInfoId,
        existingWorkflowId: infoExisting.workflow_id || "",
        existingWorkerRunId: infoExisting.worker_run_id || ""
      }));
    }
    const sourceContextRefs = workflowV2UniqueTextArray(workflowV2JsonArray(input.sourceContextRefs ?? input.source_context_refs, workflowV2JsonArray(row.source_context_refs_json, [])));
    const artifactRefs = workflowV2UniqueTextArray(workflowV2JsonArray(input.artifactRefs ?? input.artifact_refs, row.output_info_id ? [row.output_info_id] : []));
    const receiptRefs = workflowV2UniqueTextArray(workflowV2JsonArray(input.receiptRefs ?? input.receipt_refs, row.receipt_ref ? [row.receipt_ref] : []));
    const payload = workflowV2JsonObject(input.payload, {});
    handoffPackage = {
      handoffId,
      workflowId: row.workflow_id,
      planId: row.plan_id,
      nodeId: row.node_id,
      workerRunId: row.worker_run_id,
      managerAgent: row.manager_agent || "",
      successorWorkerRunId: firstText(input.successorWorkerRunId, input.successor_worker_run_id),
      handoffInfoId,
      status: status || requestedStatus,
      reason,
      summary,
      sourceContextRefs,
      artifactRefs,
      receiptRefs,
      payload
    };
    if (!infoExisting) {
      infoPreview = await workflowV2InfoStackPreview(rootDir, {
        ...input,
        workflowId: row.workflow_id,
        planId: row.plan_id,
        nodeId: row.node_id,
        workerRunId: row.worker_run_id,
        infoId: handoffInfoId,
        recipientAgent: firstText(input.recipientAgent, input.recipient_agent, row.manager_agent),
        classification: input.classification || "internal",
        contentStorage: input.contentStorage || input.content_storage || "artifact_ref",
        summary,
        payload: {
          ...payload,
          lifecycleAction: "worker_handoff",
          handoffId,
          sourceWorkerRunId: row.worker_run_id,
          sourceContextRefs,
          artifactRefs,
          receiptRefs
        }
      });
      errors.push(...infoPreview.errors);
    }
  }
  return {
    operation: "workflow.v2.worker_handoff.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    generatedAt,
    workerRun: row ? workflowV2WorkerRunSummary(row) : null,
    authority: {
      callerAgent: loaded.callerAgent,
      managerAgent: loaded.managerAgent,
      taskOwnerAgent: loaded.taskOwnerAgent,
      allowedAgents: loaded.allowedAgents
    },
    handoffPackage,
    existingHandoff: existingHandoff ? {
      handoffId: existingHandoff.handoff_id,
      status: existingHandoff.status,
      workerRunId: existingHandoff.worker_run_id,
      handoffInfoId: existingHandoff.handoff_info_id
    } : null,
    infoAction: infoExisting ? "reference_existing" : "create_info_stack_item",
    infoExisting,
    infoPreview,
    dbFile: paths.dbFile,
    writes: []
  };
}


async function workflowV2WorkerHandoffRecord(rootDir, input = {}) {
  const preview = await workflowV2WorkerHandoffPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 worker handoff is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const handoff = preview.handoffPackage;
  const rawRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(handoff.workerRunId)} LIMIT 1;`, { json: true });
  const rawRow = rawRows[0] || {};
  const existingHandoffById = await workflowV2WorkerHandoffById(paths, handoff.handoffId);
  if (existingHandoffById && existingHandoffById.worker_run_id !== handoff.workerRunId) {
    throw new Error(`workflow v2 worker handoff is invalid: handoff_id_conflict`);
  }
  const existingHandoff = existingHandoffById || await workflowV2WorkerHandoffRow(paths, handoff.workerRunId, handoff.handoffId);
  let infoRecord = null;
  let createdInfo = false;
  try {
    if (!preview.infoExisting) {
      infoRecord = await workflowV2InfoStackRecord(paths.root, {
        ...input,
        workflowId: handoff.workflowId,
        planId: handoff.planId,
        nodeId: handoff.nodeId,
        workerRunId: handoff.workerRunId,
        infoId: handoff.handoffInfoId,
        recipientAgent: firstText(input.recipientAgent, input.recipient_agent, handoff.managerAgent),
        classification: input.classification || "internal",
        contentStorage: input.contentStorage || input.content_storage || "artifact_ref",
        summary: handoff.summary,
        payload: {
          ...handoff.payload,
          lifecycleAction: "worker_handoff",
          handoffId: handoff.handoffId,
          sourceWorkerRunId: handoff.workerRunId,
          sourceContextRefs: handoff.sourceContextRefs,
          artifactRefs: handoff.artifactRefs,
          receiptRefs: handoff.receiptRefs
        }
      });
      createdInfo = true;
    }
    await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_worker_handoffs(handoff_id, workflow_id, plan_id, node_id, worker_run_id, manager_agent, successor_worker_run_id, handoff_info_id, status, reason, summary, source_context_refs_json, artifact_refs_json, receipt_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(handoff.handoffId)}, ${sqlValue(handoff.workflowId)}, ${sqlValue(handoff.planId)}, ${sqlValue(handoff.nodeId)}, ${sqlValue(handoff.workerRunId)}, ${sqlValue(handoff.managerAgent)}, ${sqlValue(handoff.successorWorkerRunId)}, ${sqlValue(handoff.handoffInfoId)}, ${sqlValue(handoff.status)}, ${sqlValue(handoff.reason)}, ${sqlValue(handoff.summary)}, ${sqlValue(JSON.stringify(handoff.sourceContextRefs))}, ${sqlValue(JSON.stringify(handoff.artifactRefs))}, ${sqlValue(JSON.stringify(handoff.receiptRefs))}, ${sqlValue(JSON.stringify(handoff.payload))}, ${sqlValue(preview.authority.callerAgent)}, ${sqlValue(existingHandoff?.created_at || now)}, ${sqlValue(now)})
ON CONFLICT(handoff_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  node_id=excluded.node_id,
  worker_run_id=excluded.worker_run_id,
  manager_agent=excluded.manager_agent,
  successor_worker_run_id=excluded.successor_worker_run_id,
  handoff_info_id=excluded.handoff_info_id,
  status=excluded.status,
  reason=excluded.reason,
  summary=excluded.summary,
  source_context_refs_json=excluded.source_context_refs_json,
  artifact_refs_json=excluded.artifact_refs_json,
  receipt_refs_json=excluded.receipt_refs_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  updated_at=excluded.updated_at;`);
    const currentPayload = workflowV2JsonObject(rawRow.payload_json, {});
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status='handoff_required',
    lease_owner='',
    lease_until='',
    next_retry_at='',
    handoff_info_id=${sqlValue(handoff.handoffInfoId)},
    last_error=CASE WHEN last_error='' THEN ${sqlValue(handoff.reason)} ELSE last_error END,
    payload_json=${sqlValue(JSON.stringify({
      ...currentPayload,
      lifecycleRenewal: {
        action: "handoff_recorded",
        handoffId: handoff.handoffId,
        handoffInfoId: handoff.handoffInfoId,
        handoffStatus: handoff.status,
        recordedAt: now,
        callerAgent: preview.authority.callerAgent
      }
    }))},
    completed_at=CASE WHEN completed_at='' THEN ${sqlValue(now)} ELSE completed_at END,
    updated_at=${sqlValue(now)}
WHERE worker_run_id=${sqlValue(handoff.workerRunId)}
  AND status=${sqlValue(rawRow.status || "")}
  AND handoff_info_id=${sqlValue(rawRow.handoff_info_id || "")}
  AND successor_worker_run_id=${sqlValue(rawRow.successor_worker_run_id || "")};`);
    if (changed !== 1) throw new Error("workflow v2 worker handoff lost worker row before update");
    const sessionRun = await workflowV2RequireSessionRunPatch(paths, rawRow.session_run_id || "", {
      status: "completed",
      output: {
        handoffId: handoff.handoffId,
        handoffInfoId: handoff.handoffInfoId,
        handoffStatus: handoff.status,
        lifecycleAction: "handoff_recorded"
      },
      timestamp: now
    }, "worker handoff record");
    return {
      ...preview,
      operation: "workflow.v2.worker_handoff.record",
      dryRun: false,
      previewOnly: false,
      handoff,
      infoItem: infoRecord?.infoItem || preview.infoExisting,
      sessionRun,
      dbFile: paths.dbFile
    };
  } catch (error) {
    await workflowV2RestoreWorkerRunRow(paths, rawRow);
    await workflowV2RestoreWorkerHandoffRow(paths, existingHandoff, handoff.handoffId);
    if (createdInfo) await workflowV2CleanupInfoStackItem(paths.dbFile, handoff.handoffInfoId);
    throw error;
  }
}


async function workflowV2WorkerRetirePreview(rootDir, input = {}) {
  const loaded = await workflowV2LoadWorkerLifecycleActor(rootDir, input);
  const { paths, row } = loaded;
  const errors = [...loaded.errors];
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const handoffId = firstText(input.handoffId, input.handoff_id);
  const latestHandoff = row ? await workflowV2WorkerHandoffRow(paths, row.worker_run_id, handoffId) : null;
  const allowWithoutHandoff = boolOption(input.allowWithoutHandoff ?? input.allow_without_handoff, false);
  const reason = firstText(input.reason, input.summary, input.retireReason, input.retire_reason);
  if (!reason) errors.push(workflowV2ValidationError("retire_reason_required", "worker retire requires reason/summary"));
  if (row && ["cancelled", "successor_spawned", "accepted"].includes(row.status)) {
    errors.push(workflowV2ValidationError("worker_not_retire_eligible", `worker status ${row.status} cannot be retired by lifecycle action`));
  }
  if (row && handoffId && !latestHandoff) {
    errors.push(workflowV2ValidationError("handoff_not_found_for_worker", "handoffId does not belong to the worker being retired", {
      handoffId,
      workerRunId: row.worker_run_id
    }));
  } else if (row && (!latestHandoff || latestHandoff.status !== "accepted") && !allowWithoutHandoff) {
    errors.push(workflowV2ValidationError("accepted_handoff_required_before_retire", "worker retire requires an accepted handoff package unless allowWithoutHandoff=true"));
  }
  return {
    operation: "workflow.v2.worker_retire.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    generatedAt,
    workerRun: row ? workflowV2WorkerRunSummary(row) : null,
    authority: {
      callerAgent: loaded.callerAgent,
      managerAgent: loaded.managerAgent,
      taskOwnerAgent: loaded.taskOwnerAgent,
      allowedAgents: loaded.allowedAgents
    },
    latestHandoff: latestHandoff ? {
      handoffId: latestHandoff.handoff_id,
      status: latestHandoff.status,
      handoffInfoId: latestHandoff.handoff_info_id,
      successorWorkerRunId: latestHandoff.successor_worker_run_id
    } : null,
    allowWithoutHandoff,
    nextStatus: "retired",
    nextSessionStatus: latestHandoff?.status === "accepted" ? "completed" : "failed",
    reason,
    dbFile: paths.dbFile,
    writes: []
  };
}


async function workflowV2WorkerRetireRecord(rootDir, input = {}) {
  const preview = await workflowV2WorkerRetirePreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 worker retire is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = preview.generatedAt || nowIso();
  const row = preview.workerRun;
  const rawRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(row.workerRunId)} LIMIT 1;`, { json: true });
  const rawRow = rawRows[0] || {};
  const currentPayload = workflowV2JsonObject(rawRow.payload_json, {});
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status='retired',
    lease_owner='',
    lease_until='',
    next_retry_at='',
    handoff_info_id=CASE WHEN handoff_info_id='' THEN ${sqlValue(preview.latestHandoff?.handoffInfoId || "")} ELSE handoff_info_id END,
    last_error=${sqlValue(preview.reason)},
    payload_json=${sqlValue(JSON.stringify({
      ...currentPayload,
      lifecycleRenewal: {
        action: "worker_retired",
        reason: preview.reason,
        handoffId: preview.latestHandoff?.handoffId || "",
        retiredAt: now,
        callerAgent: preview.authority.callerAgent
      }
    }))},
    completed_at=CASE WHEN completed_at='' THEN ${sqlValue(now)} ELSE completed_at END,
    updated_at=${sqlValue(now)}
WHERE worker_run_id=${sqlValue(row.workerRunId)}
  AND status=${sqlValue(rawRow.status || "")}
  AND handoff_info_id=${sqlValue(rawRow.handoff_info_id || "")}
  AND successor_worker_run_id=${sqlValue(rawRow.successor_worker_run_id || "")};`);
  if (changed !== 1) throw new Error("workflow v2 worker retire lost worker row before update");
  try {
    const sessionRun = await workflowV2RequireSessionRunPatch(paths, row.sessionRunId || "", {
      status: preview.nextSessionStatus,
      output: {
        lifecycleAction: "worker_retired",
        reason: preview.reason,
        handoffId: preview.latestHandoff?.handoffId || "",
        handoffInfoId: preview.latestHandoff?.handoffInfoId || ""
      },
      error: preview.nextSessionStatus === "failed" ? preview.reason : "",
      timestamp: now
    }, "worker retire");
    return {
      ...preview,
      operation: "workflow.v2.worker_retire.record",
      dryRun: false,
      previewOnly: false,
      sessionRun,
      dbFile: paths.dbFile
    };
  } catch (error) {
    await workflowV2RestoreWorkerRunRow(paths, rawRow);
    throw error;
  }
}


async function workflowV2WorkerSuccessorPreview(rootDir, input = {}) {
  const loaded = await workflowV2LoadWorkerLifecycleActor(rootDir, input);
  const { paths, row } = loaded;
  const errors = [...loaded.errors];
  const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
  const handoffId = firstText(input.handoffId, input.handoff_id);
  const acceptedHandoff = row ? await workflowV2WorkerHandoffRow(paths, row.worker_run_id, handoffId) : null;
  if (row && handoffId && !acceptedHandoff) {
    errors.push(workflowV2ValidationError("handoff_not_found_for_worker", "handoffId does not belong to the worker spawning a successor", {
      handoffId,
      workerRunId: row.worker_run_id
    }));
  } else if (row && (!acceptedHandoff || acceptedHandoff.status !== "accepted")) {
    errors.push(workflowV2ValidationError("accepted_handoff_required_before_successor", "successor worker requires an accepted handoff package"));
  }
  if (row && !WORKFLOW_V2_SUCCESSOR_SOURCE_STATUSES.has(row.status)) {
    errors.push(workflowV2ValidationError("worker_not_successor_eligible", `worker status ${row.status} cannot spawn a successor`));
  }
  if (row?.successor_worker_run_id) {
    errors.push(workflowV2ValidationError("successor_already_exists", "source worker already points to a successor", {
      successorWorkerRunId: row.successor_worker_run_id
    }));
  }
  let spawnInput = null;
  let spawnPreview = null;
  if (row) {
    const successorWorkerRunId = firstText(input.successorWorkerRunId, input.successor_worker_run_id, input.newWorkerRunId, input.new_worker_run_id) || safeId("v2-worker-successor");
    if (successorWorkerRunId === row.worker_run_id) {
      errors.push(workflowV2ValidationError("successor_worker_run_id_conflict", "successor workerRunId must differ from source workerRunId"));
    }
    const existingSuccessorRows = await sqlite(paths.dbFile, `SELECT worker_run_id FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(successorWorkerRunId)} LIMIT 1;`, { json: true });
    if (existingSuccessorRows[0]) {
      errors.push(workflowV2ValidationError("successor_worker_run_id_exists", "successor workerRunId already exists", { successorWorkerRunId }));
    }
    const handoffInfoId = acceptedHandoff?.handoff_info_id || row.handoff_info_id || "";
    const handoffSourceRefs = workflowV2JsonArray(acceptedHandoff?.source_context_refs_json, []);
    const explicitSourceRefs = workflowV2JsonArray(input.sourceContextRefs ?? input.source_context_refs, null);
    const sourceContextRefs = workflowV2UniqueTextArray(explicitSourceRefs || [
      handoffInfoId,
      ...handoffSourceRefs,
      ...workflowV2JsonArray(row.source_context_refs_json, [])
    ]);
    const sourcePayload = workflowV2JsonObject(row.payload_json, {});
    const explicitDelegation = workflowV2JsonObject(input.delegation ?? input.delegationContract ?? input.delegation_contract, null);
    const successorDelegation = explicitDelegation || workflowV2JsonObject(sourcePayload.delegation, {});
    spawnInput = {
      ...input,
      workflowId: row.workflow_id,
      planId: row.plan_id,
      nodeId: row.node_id,
      managerAgent: row.manager_agent,
      workerRunId: successorWorkerRunId,
      sessionRunId: firstText(input.successorSessionRunId, input.successor_session_run_id, input.sessionRunId, input.session_run_id) || `${successorWorkerRunId}.session`,
      sessionId: firstText(input.sessionId, input.session_id, row.session_id),
      runtimeBackend: workflowV2NormalizeBackend(input.runtimeBackend || input.runtime_backend || row.runtime_backend),
      taskInputInfoId: firstText(input.taskInputInfoId, input.task_input_info_id, handoffInfoId),
      parentWorkerRunId: firstText(input.parentWorkerRunId, input.parent_worker_run_id, row.worker_run_id),
      supersedesWorkerRunId: firstText(input.supersedesWorkerRunId, input.supersedes_worker_run_id, row.worker_run_id),
      successorWorkerRunId: "",
      workerGeneration: workflowV2NonNegativeInt(input.workerGeneration ?? input.worker_generation, Number(row.worker_generation || 0) + 1),
      handoffInfoId,
      contextBudgetTokens: workflowV2NonNegativeInt(input.contextBudgetTokens ?? input.context_budget_tokens, row.context_budget_tokens || 0),
      contextUsedTokens: workflowV2NonNegativeInt(input.contextUsedTokens ?? input.context_used_tokens, 0),
      compactionCount: workflowV2NonNegativeInt(input.compactionCount ?? input.compaction_count, 0),
      sourceContextRefs,
      delegation: successorDelegation,
      payload: {
        ...workflowV2JsonObject(input.payload, {}),
        delegation: successorDelegation,
        lifecycleRenewal: {
          action: "successor_spawned",
          sourceWorkerRunId: row.worker_run_id,
          handoffId: acceptedHandoff?.handoff_id || "",
          handoffInfoId,
          generatedAt
        }
      }
    };
    spawnPreview = await workflowV2WorkerSpawnPreview(rootDir, spawnInput);
    errors.push(...spawnPreview.errors);
  }
  return {
    operation: "workflow.v2.worker_successor.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    generatedAt,
    workerRun: row ? workflowV2WorkerRunSummary(row) : null,
    authority: {
      callerAgent: loaded.callerAgent,
      managerAgent: loaded.managerAgent,
      taskOwnerAgent: loaded.taskOwnerAgent,
      allowedAgents: loaded.allowedAgents
    },
    acceptedHandoff: acceptedHandoff ? {
      handoffId: acceptedHandoff.handoff_id,
      status: acceptedHandoff.status,
      handoffInfoId: acceptedHandoff.handoff_info_id,
      sourceContextRefs: workflowV2JsonArray(acceptedHandoff.source_context_refs_json, []),
      artifactRefs: workflowV2JsonArray(acceptedHandoff.artifact_refs_json, []),
      receiptRefs: workflowV2JsonArray(acceptedHandoff.receipt_refs_json, [])
    } : null,
    spawnInput,
    successorWorkerRun: spawnPreview?.workerRun || null,
    spawnPreview,
    dbFile: paths.dbFile,
    writes: []
  };
}


async function workflowV2WorkerSuccessorCreate(rootDir, input = {}) {
  const preview = await workflowV2WorkerSuccessorPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 worker successor is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = preview.generatedAt || nowIso();
  const source = preview.workerRun;
  const successor = preview.successorWorkerRun;
  const rawSourceRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs WHERE worker_run_id=${sqlValue(source.workerRunId)} LIMIT 1;`, { json: true });
  const rawSourceRow = rawSourceRows[0] || {};
  const rawHandoff = await workflowV2WorkerHandoffRow(paths, source.workerRunId, preview.acceptedHandoff?.handoffId || "");
  const existingPreflightRows = await sqlite(paths.dbFile, `SELECT preflight_id FROM workflow_v2_backend_preflights WHERE preflight_id=${sqlValue(successor.preflightId)} LIMIT 1;`, { json: true });
  let spawnResult = null;
  try {
    spawnResult = await workflowV2WorkerSpawnCreate(rootDir, preview.spawnInput);
    const handoffPayload = workflowV2JsonObject(rawHandoff?.payload_json, {});
    const handoffChanged = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_handoffs
SET status='superseded',
    successor_worker_run_id=${sqlValue(successor.workerRunId)},
    payload_json=${sqlValue(JSON.stringify({
      ...handoffPayload,
      successorWorkerRunId: successor.workerRunId,
      supersededAt: now,
      callerAgent: preview.authority.callerAgent
    }))},
    updated_at=${sqlValue(now)}
WHERE handoff_id=${sqlValue(preview.acceptedHandoff.handoffId)}
  AND worker_run_id=${sqlValue(source.workerRunId)}
  AND status=${sqlValue(rawHandoff?.status || "")}
  AND successor_worker_run_id=${sqlValue(rawHandoff?.successor_worker_run_id || "")};`);
    if (handoffChanged !== 1) throw new Error("workflow v2 worker successor lost accepted handoff before update");
    const currentPayload = workflowV2JsonObject(rawSourceRow.payload_json, {});
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status='successor_spawned',
    successor_worker_run_id=${sqlValue(successor.workerRunId)},
    lease_owner='',
    lease_until='',
    next_retry_at='',
    handoff_info_id=CASE WHEN handoff_info_id='' THEN ${sqlValue(preview.acceptedHandoff.handoffInfoId)} ELSE handoff_info_id END,
    payload_json=${sqlValue(JSON.stringify({
      ...currentPayload,
      lifecycleRenewal: {
        action: "successor_spawned",
        successorWorkerRunId: successor.workerRunId,
        handoffId: preview.acceptedHandoff.handoffId,
        handoffInfoId: preview.acceptedHandoff.handoffInfoId,
        spawnedAt: now,
        callerAgent: preview.authority.callerAgent
      }
    }))},
    completed_at=CASE WHEN completed_at='' THEN ${sqlValue(now)} ELSE completed_at END,
    updated_at=${sqlValue(now)}
WHERE worker_run_id=${sqlValue(source.workerRunId)}
  AND status=${sqlValue(rawSourceRow.status || "")}
  AND handoff_info_id=${sqlValue(rawSourceRow.handoff_info_id || "")}
  AND successor_worker_run_id=${sqlValue(rawSourceRow.successor_worker_run_id || "")};`);
    if (changed !== 1) throw new Error("workflow v2 worker successor lost source worker before update");
    const sourceSessionRun = await workflowV2RequireSessionRunPatch(paths, source.sessionRunId || "", {
      status: "completed",
      output: {
        lifecycleAction: "successor_spawned",
        successorWorkerRunId: successor.workerRunId,
        handoffId: preview.acceptedHandoff.handoffId,
        handoffInfoId: preview.acceptedHandoff.handoffInfoId
      },
      timestamp: now
    }, "worker successor create");
    return {
      ...preview,
      operation: "workflow.v2.worker_successor.create",
      dryRun: false,
      previewOnly: false,
      spawnResult,
      sourceSessionRun,
      dbFile: paths.dbFile
    };
  } catch (error) {
    await workflowV2RestoreWorkerRunRow(paths, rawSourceRow);
    await workflowV2RestoreWorkerHandoffRow(paths, rawHandoff, preview.acceptedHandoff?.handoffId || "");
    if (spawnResult) {
      await workflowV2CleanupWorkerSpawn(
        paths,
        successor.workerRunId,
        successor.sessionRunId,
        successor.preflightId,
        !existingPreflightRows[0]
      );
    }
    throw error;
  }
}



  return {
    workflowV2WorkerBackendPreflight,
    workflowV2WorkerBackendPreflightRecord,
    workflowV2WorkerSpawnPreview,
    workflowV2WorkerSpawnCreate,
    workflowV2WorkerLifecyclePreview,
    workflowV2WorkerHandoffPreview,
    workflowV2WorkerHandoffRecord,
    workflowV2WorkerRetirePreview,
    workflowV2WorkerRetireRecord,
    workflowV2WorkerSuccessorPreview,
    workflowV2WorkerSuccessorCreate
  };
}
