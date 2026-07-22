import {
  firstText,
  parseJsonValue,
  redactSensitiveForPersistence,
  redactSensitiveTextForPersistence,
  safeId
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount
} from "./workflow/sqlite.js";

export const CONTROL_LOOP_JOB_ACTION_HANDLER_NAMES = {
  "workflow.control_loop.lanes.preview": "workflowControlLoopLanesPreview",
  "workflow.maintenance.lanes.preview": "workflowControlLoopLanesPreview",
  "workflow.scheduler.lanes.preview": "workflowControlLoopLanesPreview",
  "workflow.control_loop.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
  "workflow.control_loop.job.retry.preview": "workflowControlLoopJobRequeuePreview",
  "workflow.control-loop.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
  "workflow.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
  "control_loop.job.requeue.preview": "workflowControlLoopJobRequeuePreview",
  "workflow.control_loop.job.requeue": "workflowControlLoopJobRequeue",
  "workflow.control_loop.job.retry": "workflowControlLoopJobRequeue",
  "workflow.control-loop.job.requeue": "workflowControlLoopJobRequeue",
  "workflow.job.requeue": "workflowControlLoopJobRequeue",
  "control_loop.job.requeue": "workflowControlLoopJobRequeue"
};

const CONTROL_LOOP_LANE_OWNERSHIP = Object.freeze([
  {
    laneId: "approved_schedule_runner",
    jobTypes: ["scheduled_dispatch"],
    ownershipClass: "shared_scheduler",
    defaultState: "active",
    seedSurface: "seedDueScheduleJobs",
    executorSurface: "runScheduledDispatchJob",
    replacementRole: "approved template / Human-Gate-governed schedule dispatch",
    freezeEligibility: "not_v1_freeze_candidate_shared_lane"
  },
  {
    laneId: "runtime_drain",
    jobTypes: ["runtime_drain"],
    ownershipClass: "shared_runtime_substrate",
    defaultState: "active",
    seedSurface: "workflow.control_loop.tick",
    executorSurface: "runtime.bridge.drain",
    replacementRole: "bounded runtime dispatch drain through runtime adapters",
    freezeEligibility: "not_v1_freeze_candidate_shared_lane"
  },
  {
    laneId: "stale_dispatch_reconcile",
    jobTypes: ["stale_dispatch_reconcile"],
    ownershipClass: "shared_maintenance",
    defaultState: "active",
    seedSurface: "workflow.control_loop.tick",
    executorSurface: "workflow.dispatch.reconcile",
    replacementRole: "mechanical stale dispatch receipt/failure reconcile",
    freezeEligibility: "not_v1_freeze_candidate_shared_lane"
  },
  {
    laneId: "message_flow_reconcile",
    jobTypes: ["message_flow_reconcile"],
    ownershipClass: "shared_maintenance",
    defaultState: "active",
    seedSurface: "workflow.control_loop.tick",
    executorSurface: "message_flow.reconcile",
    replacementRole: "mechanical message_flow delivery/receipt reconcile",
    freezeEligibility: "not_v1_freeze_candidate_shared_lane"
  },
  {
    laneId: "meeting_dispatch_retry",
    jobTypes: ["meeting_dispatch_retry"],
    ownershipClass: "shared_dispatch_compatibility",
    defaultState: "active_compatibility",
    seedSurface: "meeting.dispatch compatibility retry",
    executorSurface: "meeting.dispatch",
    replacementRole: "compatibility retry while generic dispatch package bridge matures",
    freezeEligibility: "defer_to_generic_dispatch_bridge_migration"
  },
  {
    laneId: "human_gate_maintenance",
    jobTypes: ["human_gate_request_ensure", "human_gate_inbox"],
    ownershipClass: "shared_human_gate",
    defaultState: "active",
    seedSurface: "workflow.control_loop.tick",
    executorSurface: "human_gate request/inbox shared rails",
    replacementRole: "Human Gate request eligibility and inbox evidence batching",
    freezeEligibility: "not_v1_freeze_candidate_shared_lane"
  },
  {
    laneId: "telegram_outbox_delivery",
    jobTypes: ["telegram_outbox_deliver"],
    ownershipClass: "shared_delivery",
    defaultState: "active",
    seedSurface: "workflow.control_loop.tick",
    executorSurface: "telegram.outbox delivery shared rails",
    replacementRole: "bounded Telegram/outbox delivery progress",
    freezeEligibility: "not_v1_freeze_candidate_shared_lane"
  },
  {
    laneId: "legacy_workflow_supervise",
    jobTypes: ["workflow_supervise"],
    ownershipClass: "legacy_lane_default_closed",
    defaultState: "default_closed",
    seedSurface: "workflow.control_loop.tick legacyWorkflowSuperviseLane flag",
    executorSurface: "workflow.supervise compatibility",
    replacementRole: "legacy supervisor compatibility only; not shared maintenance",
    freezeEligibility: "freeze_candidate_after_observation_window_and_caller_audit"
  }
]);

const CONTROL_LOOP_LANE_BY_JOB_TYPE = new Map(CONTROL_LOOP_LANE_OWNERSHIP.flatMap((lane) => lane.jobTypes.map((jobType) => [jobType, lane])));

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`control-loop job action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`control-loop job action dependency missing: ${name}`);
  return context[name];
}

function sqlStringList(values) {
  return values.map((value) => sqlValue(value)).join(", ");
}

function boundedNumber(values, fallback, min, max) {
  const candidates = Array.isArray(values) ? values : [values];
  for (const value of candidates) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(min, Math.min(max, number));
  }
  return Math.max(min, Math.min(max, fallback));
}

function controlLoopJobSummary(row = {}) {
  return {
    jobId: row.job_id || "",
    jobType: row.job_type || "",
    dedupeKey: row.dedupe_key || "",
    priority: row.priority || "",
    status: row.status || "",
    workflowId: row.workflow_id || "",
    runtime: row.runtime || "",
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextRunAt: row.next_run_at || "",
    leaseOwner: row.lease_owner || "",
    leaseUntil: row.lease_until || "",
    lastError: redactSensitiveTextForPersistence(row.last_error || ""),
    completedAt: row.completed_at || "",
    updatedAt: row.updated_at || ""
  };
}

function countBy(rows = [], key) {
  const counts = {};
  for (const row of rows) {
    const value = String(row[key] || "unknown");
    counts[value] = (counts[value] || 0) + Number(row.count || 0);
  }
  return counts;
}

function laneForJobType(jobType = "") {
  return CONTROL_LOOP_LANE_BY_JOB_TYPE.get(String(jobType || "")) || {
    laneId: "unknown_control_loop_job",
    jobTypes: [String(jobType || "unknown")],
    ownershipClass: "unknown",
    defaultState: "unknown",
    seedSurface: "unknown",
    executorSurface: "unknown",
    replacementRole: "unclassified control_loop_jobs row",
    freezeEligibility: "not_freeze_eligible_until_classified"
  };
}

export function createControlLoopJobActionRegistry(handlers = {}) {
  const entries = Object.entries(CONTROL_LOOP_JOB_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing control-loop job action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runControlLoopJobAction(registry, action, rootDir, input = {}, permissionDecision = null) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input, permissionDecision) };
}

export function createControlLoopJobActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const CONTROL_LOOP_ACTIVE_JOB_STATUSES = requireContextValue(context, "CONTROL_LOOP_ACTIVE_JOB_STATUSES");

  async function workflowControlLoopLanesPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const generatedAt = nowIso();
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const limit = boundedNumber([input.limit], 20, 1, 200);
    const workflowClause = workflowId ? `WHERE workflow_id=${sqlValue(workflowId)}` : "";
    const andWorkflowClause = workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : "";
    const statusRows = await sqlite(paths.dbFile, `
SELECT job_type, status, COUNT(*) AS count, MAX(updated_at) AS last_updated_at
FROM control_loop_jobs
${workflowClause}
GROUP BY job_type, status
ORDER BY job_type, status;`, { json: true });
    const sampleRows = await sqlite(paths.dbFile, `
SELECT job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, completed_at, updated_at
FROM control_loop_jobs
WHERE 1=1
  ${andWorkflowClause}
ORDER BY updated_at DESC, created_at DESC
LIMIT ${limit};`, { json: true });
    const observedJobTypes = [...new Set(statusRows.map((row) => String(row.job_type || "unknown")))];
    const lanesById = new Map(CONTROL_LOOP_LANE_OWNERSHIP.map((lane) => [lane.laneId, {
      ...lane,
      jobTypes: [...lane.jobTypes],
      statusCounts: {},
      activeJobs: 0,
      retryJobs: 0,
      terminalAttentionJobs: 0,
      lastObservedAt: "",
      observed: false
    }]));
    for (const jobType of observedJobTypes) {
      const lane = laneForJobType(jobType);
      if (!lanesById.has(lane.laneId)) {
        lanesById.set(lane.laneId, {
          ...lane,
          jobTypes: [...lane.jobTypes],
          statusCounts: {},
          activeJobs: 0,
          retryJobs: 0,
          terminalAttentionJobs: 0,
          lastObservedAt: "",
          observed: false
        });
      }
    }
    for (const row of statusRows) {
      const lane = lanesById.get(laneForJobType(row.job_type).laneId);
      const status = String(row.status || "unknown");
      const count = Number(row.count || 0);
      lane.observed = true;
      lane.statusCounts[status] = (lane.statusCounts[status] || 0) + count;
      if (CONTROL_LOOP_ACTIVE_JOB_STATUSES.has(status)) lane.activeJobs += count;
      if (status === "retry_scheduled") lane.retryJobs += count;
      if (["failed", "dead_letter"].includes(status)) lane.terminalAttentionJobs += count;
      if (row.last_updated_at && (!lane.lastObservedAt || row.last_updated_at > lane.lastObservedAt)) lane.lastObservedAt = row.last_updated_at;
    }
    const lanes = [...lanesById.values()].map((lane) => ({
      laneId: lane.laneId,
      jobTypes: lane.jobTypes,
      ownershipClass: lane.ownershipClass,
      defaultState: lane.defaultState,
      seedSurface: lane.seedSurface,
      executorSurface: lane.executorSurface,
      replacementRole: lane.replacementRole,
      freezeEligibility: lane.freezeEligibility,
      observed: Boolean(lane.observed),
      statusCounts: lane.statusCounts,
      activeJobs: lane.activeJobs,
      retryJobs: lane.retryJobs,
      terminalAttentionJobs: lane.terminalAttentionJobs,
      lastObservedAt: lane.lastObservedAt
    }));
    const unclassifiedJobTypes = observedJobTypes.filter((jobType) => !CONTROL_LOOP_LANE_BY_JOB_TYPE.has(jobType));
    const allStatusCounts = countBy(statusRows, "status");
    return {
      schemaVersion: "workflow_control_loop_lanes_preview.v1",
      action: "workflow.control_loop.lanes.preview",
      preview: true,
      readOnly: true,
      sourceClass: "shared_maintenance",
      writeBoundary: "read_only_inventory",
      generatedAt,
      workflowId,
      laneCount: lanes.length,
      lanes,
      observedJobTypes,
      unclassifiedJobTypes,
      queueSummary: {
        statusCounts: allStatusCounts,
        activeJobs: lanes.reduce((total, lane) => total + lane.activeJobs, 0),
        retryJobs: lanes.reduce((total, lane) => total + lane.retryJobs, 0),
        terminalAttentionJobs: lanes.reduce((total, lane) => total + lane.terminalAttentionJobs, 0)
      },
      sampleJobs: sampleRows.map(controlLoopJobSummary),
      freezeReadiness: {
        status: "not_ready",
        blockers: [
          "shared_maintenance_lanes_must_remain_active",
          ...(unclassifiedJobTypes.length ? ["unclassified_control_loop_job_types_observed"] : []),
          ...(lanes.some((lane) => lane.laneId === "legacy_workflow_supervise" && lane.activeJobs > 0) ? ["legacy_workflow_supervise_active_jobs_observed"] : [])
        ]
      },
      limitations: [
        "Preview is read-only and does not seed, claim, run, requeue, or delete control-loop jobs.",
        "Lane ownership describes current shared maintenance responsibilities, not a v2-only replacement.",
        "Only legacy_workflow_supervise may become freeze-eligible after observation and caller audit; shared lanes are not v1 freeze candidates."
      ],
      wouldMutate: {
        controlLoopJobs: 0,
        workflowEvents: 0,
        dispatches: 0,
        runtimeRuns: 0,
        messageFlows: 0,
        outbox: 0,
        humanGate: 0,
        sideEffects: 0
      },
      dbFile: paths.dbFile
    };
  }

  async function workflowControlLoopJobRequeuePreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const jobId = firstText(input.jobId, input.job_id, input.refId, input.ref_id);
    if (!jobId) throw new Error("jobId is required");
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const workflowClause = workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : "";
    const generatedAt = nowIso();
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM control_loop_jobs
WHERE job_id=${sqlValue(jobId)}
  ${workflowClause}
LIMIT 1;`, { json: true });
    const row = rows[0] || null;
    const violations = [];
    if (!row) {
      violations.push({ code: "job_not_found", detail: "No matching control_loop_jobs row exists for the requested jobId/workflowId." });
    }
    const activeStatuses = [...CONTROL_LOOP_ACTIVE_JOB_STATUSES];
    let activeConflict = null;
    if (row?.dedupe_key) {
      const conflictRows = await sqlite(paths.dbFile, `
SELECT job_id, status
FROM control_loop_jobs
WHERE dedupe_key=${sqlValue(row.dedupe_key)}
  AND job_id != ${sqlValue(row.job_id)}
  AND status IN (${sqlStringList(activeStatuses)})
ORDER BY updated_at DESC
LIMIT 1;`, { json: true });
      activeConflict = conflictRows[0] || null;
      if (activeConflict) {
        violations.push({ code: "active_dedupe_conflict", detail: `Active job ${activeConflict.job_id} already owns dedupe_key ${row.dedupe_key}.` });
      }
    }
    const status = String(row?.status || "").trim();
    const expiredLease = status === "running" && String(row?.lease_until || "").trim() && String(row.lease_until) <= generatedAt;
    const failedTerminal = ["failed", "dead_letter"].includes(status);
    if (row && !failedTerminal && !expiredLease) {
      violations.push({ code: "status_not_requeueable", detail: `Only failed/dead_letter jobs or expired running leases can be requeued; current status is ${status || "unknown"}.` });
    }
    const resetAttempt = boundedNumber([input.resetAttempt, input.reset_attempt], 0, 0, Math.max(0, Number(row?.max_attempts || 20)));
    const nextRunAt = firstText(input.nextRunAt, input.next_run_at, generatedAt);
    const operatorReason = firstText(input.requeueOperatorReason, input.requeue_operator_reason, input.operatorReason, input.operator_reason, input.reason);
    const eligible = violations.length === 0;
    return {
      schemaVersion: "workflow_control_loop_job_requeue_preview.v1",
      action: "workflow.control_loop.job.requeue.preview",
      preview: true,
      readOnly: true,
      eligible,
      governanceReady: eligible && Boolean(operatorReason),
      generatedAt,
      jobId,
      workflowId: workflowId || row?.workflow_id || "",
      currentJob: row ? controlLoopJobSummary(row) : null,
      activeDedupeConflict: activeConflict ? { jobId: activeConflict.job_id, status: activeConflict.status } : null,
      requeuePlan: row ? {
        nextStatus: "queued",
        resetAttempt,
        nextRunAt,
        clearLease: true,
        clearLastError: true,
        clearCompletedAt: true,
        preserveEvidenceInPayloadHistory: true
      } : null,
      wouldMutate: row ? {
        controlLoopJobs: eligible ? 1 : 0,
        workflowEvents: eligible ? 1 : 0,
        dispatches: 0,
        runtimeRuns: 0,
        messageFlows: 0,
        outbox: 0,
        humanGate: 0,
        sideEffects: 0
      } : { controlLoopJobs: 0, workflowEvents: 0 },
      requiredEvidence: ["operatorReason or requeueOperatorReason"],
      violations,
      limitations: [
        "Preview is read-only and does not change queue state.",
        "Execution only requeues the selected control_loop_jobs row and writes one workflow event.",
        "Execution does not run the job, dispatch agents, deliver Telegram, resume Human Gate, or mutate trading state."
      ],
      dbFile: paths.dbFile
    };
  }

  async function workflowControlLoopJobRequeue(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const preview = await workflowControlLoopJobRequeuePreview(rootDir, input);
    if (!preview.eligible) {
      throw new Error(`control-loop job is not requeueable: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
    }
    const operatorReason = firstText(input.requeueOperatorReason, input.requeue_operator_reason, input.operatorReason, input.operator_reason, input.reason);
    if (!operatorReason) throw new Error("operatorReason is required to requeue a control-loop job");
    const row = (await sqlite(paths.dbFile, `SELECT * FROM control_loop_jobs WHERE job_id=${sqlValue(preview.jobId)} LIMIT 1;`, { json: true }))[0];
    if (!row) throw new Error(`control-loop job disappeared before requeue: ${preview.jobId}`);
    const requeuedAt = nowIso();
    const resetAttempt = preview.requeuePlan.resetAttempt;
    const nextRunAt = preview.requeuePlan.nextRunAt || requeuedAt;
    const payload = parseJsonValue(row.payload_json, {});
    const requeueHistory = Array.isArray(payload.requeueHistory) ? payload.requeueHistory.slice(-9) : [];
    requeueHistory.push(redactSensitiveForPersistence({
      requeuedAt,
      operatorReason,
      requestedBy: permissionDecision?.caller?.agentId || firstText(input.actor, input.requester, input.callerAgent, input.caller_agent, "unknown"),
      previous: {
        status: row.status || "",
        attempt: Number(row.attempt || 0),
        nextRunAt: row.next_run_at || "",
        leaseOwner: row.lease_owner || "",
        leaseUntil: row.lease_until || "",
        lastError: row.last_error || "",
        completedAt: row.completed_at || "",
        result: parseJsonValue(row.result_json, {})
      }
    }));
    const nextPayload = {
      ...payload,
      requeueHistory,
      requeue: {
        lastRequeuedAt: requeuedAt,
        lastRequeuedBy: permissionDecision?.caller?.agentId || firstText(input.actor, input.requester, input.callerAgent, input.caller_agent, "unknown"),
        resetAttempt,
        nextRunAt,
        reason: redactSensitiveTextForPersistence(operatorReason)
      }
    };
    const persistedPayload = redactSensitiveForPersistence(nextPayload);
    const activeStatuses = sqlStringList([...CONTROL_LOOP_ACTIVE_JOB_STATUSES]);
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status='queued',
    attempt=${sqlValue(resetAttempt)},
    next_run_at=${sqlValue(nextRunAt)},
    lease_owner='',
    lease_until='',
    last_error='',
    completed_at='',
    result_json='{}',
    payload_json=${sqlValue(JSON.stringify(persistedPayload))},
    updated_at=${sqlValue(requeuedAt)}
WHERE job_id=${sqlValue(row.job_id)}
  AND (
    status IN ('failed','dead_letter')
    OR (status='running' AND COALESCE(lease_until,'') != '' AND lease_until <= ${sqlValue(preview.generatedAt)})
  )
  AND NOT EXISTS (
    SELECT 1
    FROM control_loop_jobs other
    WHERE other.dedupe_key=${sqlValue(row.dedupe_key)}
      AND other.job_id != ${sqlValue(row.job_id)}
      AND other.status IN (${activeStatuses})
  );`);
    if (changed !== 1) {
      throw new Error(`control-loop job requeue lost race or became ineligible: ${row.job_id}`);
    }
    await appendWorkflowEvent(paths, {
      eventType: "control_loop.job.requeued",
      status: "queued",
      workflowId: row.workflow_id || "",
      actor: permissionDecision?.caller?.agentId || firstText(input.actor, input.requester, input.callerAgent, input.caller_agent, "workflow"),
      sourceRuntime: permissionDecision?.caller?.runtime || firstText(input.callerRuntime, input.caller_runtime, "workflow"),
      previousState: row.status || "",
      nextState: "queued",
      eventId: safeId("workflow_event.requeue"),
      idempotencyKey: "",
      payload: {
        jobId: row.job_id,
        jobType: row.job_type || "",
        dedupeKey: row.dedupe_key || "",
        previousAttempt: Number(row.attempt || 0),
        resetAttempt,
        nextRunAt,
        operatorReason: redactSensitiveTextForPersistence(operatorReason)
      },
      createdAt: requeuedAt
    });
    const latest = (await sqlite(paths.dbFile, `SELECT * FROM control_loop_jobs WHERE job_id=${sqlValue(row.job_id)} LIMIT 1;`, { json: true }))[0];
    return {
      schemaVersion: "workflow_control_loop_job_requeue_result.v1",
      action: "workflow.control_loop.job.requeue",
      status: "queued",
      requeued: true,
      requeuedAt,
      jobId: row.job_id,
      workflowId: row.workflow_id || "",
      previousStatus: row.status || "",
      currentJob: controlLoopJobSummary(latest || row),
      writeBoundary: "control_loop_job_only",
      didRunJob: false,
      didDispatchAgent: false,
      didDeliverTelegram: false,
      didMutateTradingState: false,
      dbFile: paths.dbFile
    };
  }

  return {
    workflowControlLoopLanesPreview,
    workflowControlLoopJobRequeuePreview,
    workflowControlLoopJobRequeue
  };
}
