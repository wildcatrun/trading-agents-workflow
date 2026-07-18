import path from "node:path";
import { DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS } from "./control-loop-budget.js";
import {
  boolOption,
  parseJsonValue,
  safeId,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount
} from "./workflow/sqlite.js";

export const CONTROL_LOOP_TICK_ACTION_HANDLER_NAMES = {
  "workflow.control_loop.tick": "workflowControlLoopTick",
  "workflow.loop.tick": "workflowControlLoopTick",
  "workflow.reconciler.tick": "workflowControlLoopTick"
};

const CONTROL_LOOP_RETIRED_RUNTIME_DRAINS = new Set(["openclaw_route_shell"]);

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`control-loop tick action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`control-loop tick action dependency missing: ${name}`);
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

function controlLoopStatuses(input = {}, CONTROL_LOOP_WORKFLOW_STATUSES, WORKFLOW_RUN_STATUSES) {
  const requested = toList(input.workflowStatuses || input.workflow_statuses || input.statuses);
  const statuses = requested.length ? requested : [...CONTROL_LOOP_WORKFLOW_STATUSES];
  const valid = statuses.filter((status) => WORKFLOW_RUN_STATUSES.has(status));
  return valid.length ? valid : [...CONTROL_LOOP_WORKFLOW_STATUSES];
}

async function appendControlLoopEvent(paths, tickId, phase, data = {}, context = {}) {
  const appendJsonl = requireContextFunction(context, "appendJsonl");
  const nowIso = requireContextFunction(context, "nowIso");
  await appendJsonl(path.join(paths.bridgeDir, "control-loop-events.jsonl"), {
    ts: nowIso(),
    tickId,
    phase,
    ...data
  });
}

export function controlLoopTickBudgetMs(input = {}) {
  return boundedNumber([input.tickBudgetMs, input.tick_budget_ms], 60_000, 5_000, 30 * 60_000);
}

export function controlLoopTimeoutSeconds(input = {}) {
  return boundedNumber([input.timeoutSeconds, input.timeout_seconds], 45, 5, 900);
}

function controlLoopWorkflowSuperviseCooldownMs(input = {}, status = "") {
  const defaultIdleCooldownMs = 5 * 60_000;
  const idleValue = input.idleWorkflowSuperviseCooldownMs
    ?? input.idle_workflow_supervise_cooldown_ms
    ?? input.blockedWorkflowSuperviseCooldownMs
    ?? input.blocked_workflow_supervise_cooldown_ms
    ?? defaultIdleCooldownMs;
  const generalValue = input.workflowSuperviseCooldownMs ?? input.workflow_supervise_cooldown_ms ?? 0;
  const value = ["blocked", "waiting_human"].includes(String(status || "")) ? idleValue : generalValue;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(24 * 3600_000, Math.max(0, number));
}

function controlLoopJobLeaseMs(input = {}, job = null) {
  const requested = boundedNumber([input.jobLeaseMs, input.job_lease_ms], 120_000, 10_000, 60 * 60_000);
  const payload = job ? parseJsonValue(job.payload_json || job.payload, {}) : {};
  const payloadTimeoutSeconds = boundedNumber([payload.timeoutSeconds, payload.timeout_seconds], 0, 0, 900);
  const timeoutSeconds = Math.max(controlLoopTimeoutSeconds(input), Number.isFinite(payloadTimeoutSeconds) ? payloadTimeoutSeconds : 0);
  const minSafe = Math.max(controlLoopTickBudgetMs(input) + 30_000, (timeoutSeconds + 30) * 1000);
  return Math.max(requested, minSafe);
}

export function createControlLoopTickActionRegistry(handlers = {}) {
  const entries = Object.entries(CONTROL_LOOP_TICK_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing control-loop tick action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runControlLoopTickAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createControlLoopTickActionHandlers(context = {}) {
  const acquireControlLoopLease = requireContextFunction(context, "acquireControlLoopLease");
  const appendJsonl = requireContextFunction(context, "appendJsonl");
  const ensurePendingHumanGateRequests = requireContextFunction(context, "ensurePendingHumanGateRequests");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const enqueueControlLoopJob = requireContextFunction(context, "enqueueControlLoopJob");
  const humanGateInbox = requireContextFunction(context, "humanGateInbox");
  const maybeRunWorkflowRetention = requireContextFunction(context, "maybeRunWorkflowRetention");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const messageFlowReconcile = requireContextFunction(context, "messageFlowReconcile");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeKnownRuntime = requireContextFunction(context, "normalizeKnownRuntime");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const nowIso = requireContextFunction(context, "nowIso");
  const releaseControlLoopLease = requireContextFunction(context, "releaseControlLoopLease");
  const runtimeBridgeDrain = requireContextFunction(context, "runtimeBridgeDrain");
  const seedDueScheduleJobs = requireContextFunction(context, "seedDueScheduleJobs");
  const runScheduledDispatchJob = requireContextFunction(context, "runScheduledDispatchJob");
  const staleDispatchReconcile = requireContextFunction(context, "staleDispatchReconcile");
  const telegramOutbox = requireContextFunction(context, "telegramOutbox");
  const workflowReadinessSnapshot = requireContextFunction(context, "workflowReadinessSnapshot");
  const workflowSupervisor = requireContextFunction(context, "workflowSupervisor");
  const CONTROL_LOOP_ACTIVE_JOB_STATUSES = requireContextValue(context, "CONTROL_LOOP_ACTIVE_JOB_STATUSES");
  const CONTROL_LOOP_WORKFLOW_STATUSES = requireContextValue(context, "CONTROL_LOOP_WORKFLOW_STATUSES");
  const DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID = requireContextValue(context, "DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID");
  const MESSAGE_FLOW_DELIVERY_RETURN_POLICIES = requireContextValue(context, "MESSAGE_FLOW_DELIVERY_RETURN_POLICIES");
  const RUNTIMES = requireContextValue(context, "RUNTIMES");
  const TELEGRAM_OUTBOX_DELIVERY_LEASE_MS = requireContextValue(context, "TELEGRAM_OUTBOX_DELIVERY_LEASE_MS");
  const WORKFLOW_RUN_STATUSES = requireContextValue(context, "WORKFLOW_RUN_STATUSES");
  const eventContext = { appendJsonl, nowIso };

  function controlLoopRuntimeDrainTimeoutSeconds(dispatchType = "", runtime = "", input = {}) {
    const type = String(dispatchType || "").trim();
    const normalizedRuntime = normalizeKnownRuntime(runtime);
    if (normalizedRuntime === "openclaw" && ["message_flow_send", "message_flow_semantic"].includes(type)) {
      return Math.max(controlLoopTimeoutSeconds(input), DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS);
    }
    return controlLoopTimeoutSeconds(input);
  }

  async function seedControlLoopJobs(paths, input = {}) {
    const seeded = [];
    const maxWorkflows = Math.max(1, Math.min(100, Number(input.maxWorkflowSeed || input.max_workflow_seed || input.maxWorkflows || input.max_workflows || 20)));
    const runtimeLimit = Math.max(1, Math.min(20, Number(input.runtimeLimit || input.runtime_limit || input.limit || 1)));
    const outboxLimit = Math.max(1, Math.min(20, Number(input.outboxLimit || input.outbox_limit || 5)));
    const timeoutSeconds = controlLoopTimeoutSeconds(input);
    const autoDispatch = boolOption(input.autoDispatch ?? input.auto_dispatch, true);
    const autoReport = boolOption(input.autoReport ?? input.auto_report, false);
    const drainQueued = boolOption(input.drainQueued ?? input.drain_queued, true);
    const deliverOutbox = boolOption(input.deliverOutbox ?? input.deliver_outbox, true);
    const ensureHumanGateRequests = boolOption(input.ensureHumanGateRequests ?? input.ensure_human_gate_requests, true);
    const createHumanGateInbox = boolOption(input.createHumanGateInbox ?? input.create_human_gate_inbox, true);
    const explicitRuntimeInput = input.runtime !== undefined || input.runtimes !== undefined;
    const requestedRuntimeValues = explicitRuntimeInput ? toList(input.runtimes ?? input.runtime) : [];
    const invalidRequestedRuntimes = requestedRuntimeValues.filter((runtime) => !normalizeKnownRuntime(runtime));
    if (drainQueued && explicitRuntimeInput && invalidRequestedRuntimes.length) {
      throw new Error(`invalid runtime for control_loop drain: ${[...new Set(invalidRequestedRuntimes)].join(",")}`);
    }
    const reportRuntime = normalizeRuntime(input.reportRuntime || input.report_runtime || "openclaw");
    const reportAgent = normalizeAgentId(input.reportAgent || input.report_agent || "cat_claw");
    const staleDispatchAfterMs = Math.max(5 * 60_000, Number(input.staleDispatchAfterMs || input.stale_dispatch_after_ms || (timeoutSeconds + 60) * 1000));
    const staleDispatchCutoff = new Date(Date.now() - staleDispatchAfterMs).toISOString();
    const dispatchReconcileLimit = Math.max(1, Math.min(100, Number(input.dispatchReconcileLimit || input.dispatch_reconcile_limit || 20)));
    const messageFlowStuckAfterMs = Math.max(60_000, Math.min(24 * 3600_000, Number(input.messageFlowStuckAfterMs || input.message_flow_stuck_after_ms || 5 * 60_000)));
    const messageFlowReconcileLimit = Math.max(1, Math.min(200, Number(input.messageFlowReconcileLimit || input.message_flow_reconcile_limit || 20)));
    const messageFlowStuckCutoff = new Date(Date.now() - messageFlowStuckAfterMs).toISOString();
    const statuses = controlLoopStatuses(input, CONTROL_LOOP_WORKFLOW_STATUSES, WORKFLOW_RUN_STATUSES);

    seeded.push(...await seedDueScheduleJobs(paths, input));

    const workflowRows = await sqlite(paths.dbFile, `
SELECT workflow_id, status, current_decision, payload_json, updated_at
FROM workflow_runs
WHERE status IN (${sqlStringList(statuses)})
ORDER BY
  CASE status WHEN 'waiting_human' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
  updated_at
LIMIT ${maxWorkflows};`, { json: true });
    for (const row of workflowRows) {
      const payload = parseJsonValue(row.payload_json, {});
      const flashLane = boolOption(payload.flashLane ?? payload.flash_lane ?? payload.tradingExecution ?? payload.trading_execution, false);
      const superviseCooldownMs = flashLane ? 0 : controlLoopWorkflowSuperviseCooldownMs(input, row.status);
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "workflow_supervise",
        dedupeKey: `workflow_supervise:${row.workflow_id}`,
        priority: flashLane ? "flash" : row.status === "waiting_human" ? "steer" : row.status === "blocked" ? "high" : "normal",
        workflowId: row.workflow_id,
        cooldownMs: superviseCooldownMs,
        payload: {
          workflowId: row.workflow_id,
          meetingId: row.workflow_id,
          flashLane,
          workflowStatus: row.status,
          superviseCooldownMs,
          autoDispatch,
          autoReport,
          reportRuntime,
          reportAgent,
          runtimeLimit,
          timeoutSeconds,
          maxCycles: input.maxCycles || input.max_cycles || 1
        }
      }));
    }

    const staleDispatchRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE status='sent' AND updated_at < ${sqlValue(staleDispatchCutoff)};`, { json: true });
    if (Number(staleDispatchRows[0]?.count || 0) > 0) {
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "stale_dispatch_reconcile",
        dedupeKey: "stale_dispatch_reconcile",
        priority: "high",
        payload: { limit: dispatchReconcileLimit, staleDispatchAfterMs }
      }));
    }

    const stuckMessageFlowRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM message_flows
WHERE (
    final_output_present=1
    AND delivery_receipt_present=0
    AND return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])})
    AND runtime_completed_at IS NOT NULL
    AND runtime_completed_at != ''
    AND runtime_completed_at < ${sqlValue(messageFlowStuckCutoff)}
    AND status NOT IN ('telegram_sent','telegram_failed')
  )
  OR (
    final_output_present=0
    AND delivery_receipt_present=0
    AND status='runtime_failed'
    AND outbox_id IS NOT NULL
    AND outbox_id != ''
    AND runtime_failed_at IS NOT NULL
    AND runtime_failed_at != ''
    AND runtime_failed_at < ${sqlValue(messageFlowStuckCutoff)}
  )
  OR (
    final_output_present=0
    AND delivery_receipt_present=0
    AND status='runtime_acknowledged'
    AND updated_at < ${sqlValue(messageFlowStuckCutoff)}
    AND NOT EXISTS (
      SELECT 1
      FROM mixed_meeting_dispatches d
      WHERE d.dispatch_type='message_flow_semantic'
        AND d.idempotency_key=('message-flow-semantic:' || message_flows.flow_id || ':' || message_flows.dispatch_id)
    )
  );`, { json: true });
    if (Number(stuckMessageFlowRows[0]?.count || 0) > 0) {
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "message_flow_reconcile",
        dedupeKey: "message_flow_reconcile",
        priority: "high",
        payload: { limit: messageFlowReconcileLimit, messageFlowStuckAfterMs }
      }));
    }

    if (drainQueued) {
      const requestedRuntimes = requestedRuntimeValues.map(normalizeKnownRuntime).filter(Boolean);
      const configuredRuntimes = new Set(requestedRuntimes);
      if (!configuredRuntimes.size) {
        const dueRuntimeRows = await sqlite(paths.dbFile, `
SELECT runtime
FROM mixed_meeting_dispatches
WHERE status='queued'
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())})
GROUP BY runtime
ORDER BY runtime;`, { json: true });
        for (const row of dueRuntimeRows) {
          const runtime = normalizeKnownRuntime(row.runtime);
          if (runtime && !CONTROL_LOOP_RETIRED_RUNTIME_DRAINS.has(runtime)) configuredRuntimes.add(runtime);
        }
      }
      const runtimes = [...configuredRuntimes].filter((runtime) => !CONTROL_LOOP_RETIRED_RUNTIME_DRAINS.has(runtime));
      const preciseExcludedRuntimes = runtimes.filter((runtime) => runtime !== "openclaw");
      const preciseRuntimeExclusion = preciseExcludedRuntimes.length ? `AND runtime NOT IN (${sqlStringList(preciseExcludedRuntimes)})` : "";
      for (const runtime of runtimes) {
        const genericDispatchTypeFilter = runtime === "openclaw" ? "AND dispatch_type NOT IN ('message_flow_send','message_flow_semantic')" : "";
        const rows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE status='queued' AND runtime=${sqlValue(runtime)}
  ${genericDispatchTypeFilter}
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())});`, { json: true });
        if (Number(rows[0]?.count || 0) <= 0) continue;
        const hasFlash = Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE status='queued' AND runtime=${sqlValue(runtime)} AND priority='flash'
  ${genericDispatchTypeFilter}
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())});`, { json: true }))[0]?.count || 0) > 0;
        seeded.push(await enqueueControlLoopJob(paths, {
          jobType: "runtime_drain",
          dedupeKey: `runtime_drain:${runtime}`,
          priority: hasFlash ? "flash" : "high",
          runtime,
          payload: {
            runtime,
            limit: runtimeLimit,
            timeoutSeconds,
            ...(runtime === "openclaw" ? { excludeDispatchTypes: ["message_flow_send", "message_flow_semantic"] } : {})
          }
        }));
      }
      const messageFlowDispatchRows = await sqlite(paths.dbFile, `
SELECT dispatch_id, runtime, priority, dispatch_type
FROM mixed_meeting_dispatches
WHERE status='queued'
  AND dispatch_type IN ('message_flow_send','message_flow_semantic')
  ${preciseRuntimeExclusion}
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())})
ORDER BY
  CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  created_at
LIMIT ${runtimeLimit};`, { json: true });
      for (const row of messageFlowDispatchRows) {
        const runtime = normalizeRuntime(row.runtime);
        if (!RUNTIMES.has(runtime)) continue;
        seeded.push(await enqueueControlLoopJob(paths, {
          jobType: "runtime_drain",
          dedupeKey: `runtime_drain:${runtime}:${row.dispatch_id}`,
          priority: row.priority || "high",
          runtime,
          payload: {
            runtime,
            dispatchId: row.dispatch_id,
            limit: 1,
            timeoutSeconds: controlLoopRuntimeDrainTimeoutSeconds(row.dispatch_type, runtime, input)
          }
        }));
      }
    }

    if (ensureHumanGateRequests) {
      const rows = await sqlite(paths.dbFile, `SELECT COUNT(*) AS count FROM protocol_objects WHERE object_type='human_gate_record' AND status='pending';`, { json: true });
      if (Number(rows[0]?.count || 0) > 0) {
        const flashRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending'
  AND (
    payload_json LIKE ${sqlValue('%"flashLane":true%')}
    OR payload_json LIKE ${sqlValue('%"flash_lane":true%')}
    OR payload_json LIKE ${sqlValue('%live_trade%')}
    OR payload_json LIKE ${sqlValue('%real_trade%')}
    OR payload_json LIKE ${sqlValue('%真实交易%')}
    OR payload_json LIKE ${sqlValue('%实盘%')}
  );`, { json: true });
        seeded.push(await enqueueControlLoopJob(paths, {
          jobType: "human_gate_request_ensure",
          dedupeKey: "human_gate_request_ensure",
          priority: Number(flashRows[0]?.count || 0) > 0 ? "flash" : "steer",
          payload: { limit: input.humanGateRequestLimit || input.human_gate_request_limit || 5 }
        }));
      }
    }

    if (deliverOutbox) {
      const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
      const rows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM telegram_outbox
WHERE status='queued'
   OR (status='delivering' AND updated_at <= ${sqlValue(staleDeliveringBefore)});`, { json: true });
      if (Number(rows[0]?.count || 0) > 0) {
        seeded.push(await enqueueControlLoopJob(paths, {
          jobType: "telegram_outbox_deliver",
          dedupeKey: "telegram_outbox_deliver",
          priority: "high",
          payload: { limit: outboxLimit }
        }));
      }
    }

    if (createHumanGateInbox) {
      const recentCutoff = new Date(Date.now() - Math.max(60_000, Math.min(24 * 3600_000, Number(input.humanGateInboxIntervalMs || input.human_gate_inbox_interval_ms || 30 * 60_000)))).toISOString();
      const recent = await sqlite(paths.dbFile, `SELECT batch_id FROM human_gate_batches WHERE created_at >= ${sqlValue(recentCutoff)} LIMIT 1;`, { json: true });
      const pending = await sqlite(paths.dbFile, `
SELECT
  (SELECT COUNT(*) FROM protocol_objects WHERE object_type='human_gate_record' AND status='pending') +
  (SELECT COUNT(*) FROM review_gates WHERE status='pending' OR (human_gate_required=1 AND status NOT IN ('approved','rejected','waived','expired','cancelled','done'))) +
  (SELECT COUNT(*) FROM workflow_tasks WHERE human_gate_required=1 AND status NOT IN ('done','failed','cancelled')) +
  (SELECT COUNT(*) FROM telegram_outbox WHERE status IN ('queued','failed') AND message_type IN ('workflow_secretary_report','human_gate_report','human_gate_request')) AS count;`, { json: true });
      if (!recent[0] && Number(pending[0]?.count || 0) > 0) {
        seeded.push(await enqueueControlLoopJob(paths, {
          jobType: "human_gate_inbox",
          dedupeKey: "human_gate_inbox",
          priority: "normal",
          payload: { limit: input.humanGateInboxLimit || input.human_gate_inbox_limit || 100 }
        }));
      }
    }

    return seeded;
  }

  async function claimControlLoopJobs(paths, input = {}) {
    const owner = String(input.claimOwner || input.claim_owner || input.owner || input.leaseOwner || input.lease_owner || `pid:${process.pid}:${safeId("claim")}`).trim();
    const limit = Math.max(1, Math.min(20, Number(input.jobLimit || input.job_limit || 4)));
    const now = nowIso();
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM control_loop_jobs
WHERE (
    status IN ('queued','retry_scheduled')
    AND (next_run_at IS NULL OR next_run_at='' OR next_run_at <= ${sqlValue(now)})
  )
  OR (status='running' AND lease_until <= ${sqlValue(now)})
ORDER BY
  CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  created_at
LIMIT ${limit};`, { json: true });
    const claimed = [];
    for (const row of rows) {
      const rowLeaseMs = controlLoopJobLeaseMs(input, row);
      const rowLeaseUntil = new Date(Date.now() + rowLeaseMs).toISOString();
      const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status='running',
    attempt=attempt+1,
    lease_owner=${sqlValue(owner)},
    lease_until=${sqlValue(rowLeaseUntil)},
    updated_at=${sqlValue(now)}
WHERE job_id=${sqlValue(row.job_id)}
  AND (
    status IN ('queued','retry_scheduled')
    OR (status='running' AND lease_until <= ${sqlValue(now)})
  );`);
      if (changed !== 1) continue;
      const latest = await sqlite(paths.dbFile, `SELECT * FROM control_loop_jobs WHERE job_id=${sqlValue(row.job_id)} AND status='running' AND lease_owner=${sqlValue(owner)} LIMIT 1;`, { json: true });
      if (latest[0]) claimed.push(latest[0]);
    }
    return claimed;
  }

  async function completeControlLoopJob(paths, job, result = {}) {
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status='done',
    result_json=${sqlValue(JSON.stringify(result))},
    lease_owner='',
    lease_until='',
    completed_at=${sqlValue(nowIso())},
    updated_at=${sqlValue(nowIso())}
WHERE job_id=${sqlValue(job.job_id)}
  AND status='running'
  AND lease_owner=${sqlValue(job.lease_owner || "")}
  AND lease_until=${sqlValue(job.lease_until || "")};`);
    return changed === 1
      ? { status: "done", completed: true }
      : { status: "lease_lost", completed: false, reason: "control_loop_job_lease_owner_changed" };
  }

  async function failControlLoopJob(paths, job, error) {
    const message = String(error?.message || error).slice(0, 1000);
    const attempt = Number(job.attempt || 0);
    const maxAttempts = Number(job.max_attempts || 20);
    const retry = attempt < maxAttempts;
    const delayMs = Math.min(5 * 60_000, 5_000 * Math.max(1, attempt));
    const nextRunAt = retry ? new Date(Date.now() + delayMs).toISOString() : "";
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status=${sqlValue(retry ? "retry_scheduled" : "failed")},
    last_error=${sqlValue(message)},
    next_run_at=${sqlValue(nextRunAt)},
    lease_owner='',
    lease_until='',
    updated_at=${sqlValue(nowIso())}
WHERE job_id=${sqlValue(job.job_id)}
  AND status='running'
  AND lease_owner=${sqlValue(job.lease_owner || "")}
  AND lease_until=${sqlValue(job.lease_until || "")};`);
    if (changed !== 1) return { status: "lease_lost", error: message, nextRunAt: "", reason: "control_loop_job_lease_owner_changed" };
    return { status: retry ? "retry_scheduled" : "failed", error: message, nextRunAt };
  }

  async function runControlLoopJob(rootDir, paths, job, input = {}) {
    const payload = parseJsonValue(job.payload_json, {});
    if (job.job_type === "workflow_supervise") {
      const workflowId = job.workflow_id || payload.workflowId || payload.workflow_id;
      const supervised = await workflowSupervisor(rootDir, {
        ...input,
        ...payload,
        workflowRootDir: paths.root,
        workflowId,
        meetingId: payload.meetingId || payload.meeting_id || workflowId,
        drain: false,
        checkpoint: false,
        dryRun: false
      });
      const enqueuedDrains = [];
      for (const dispatch of supervised.dispatched || []) {
        const runtime = normalizeRuntime(dispatch.runtime || "");
        const dispatchId = String(dispatch.dispatchId || dispatch.dispatch_id || "").trim();
        if (!dispatchId || !RUNTIMES.has(runtime)) continue;
        const dispatchRows = await sqlite(paths.dbFile, `
SELECT dispatch_type
FROM mixed_meeting_dispatches
WHERE dispatch_id=${sqlValue(dispatchId)}
LIMIT 1;`, { json: true });
        const dispatchType = dispatch.dispatchType || dispatch.dispatch_type || dispatchRows[0]?.dispatch_type || "";
        enqueuedDrains.push(await enqueueControlLoopJob(paths, {
          jobType: "runtime_drain",
          dedupeKey: `runtime_drain:${runtime}:${dispatchId}`,
          priority: dispatch.priority || "high",
          runtime,
          workflowId,
          payload: {
            runtime,
            dispatchId,
            limit: 1,
            timeoutSeconds: controlLoopRuntimeDrainTimeoutSeconds(dispatchType, runtime, { ...input, ...payload })
          }
        }));
      }
      return {
        workflowId,
        decision: supervised.finalAdvance?.decision || "",
        dispatched: supervised.dispatched?.length || 0,
        enqueuedDrains,
        catClawReportDispatchId: supervised.catClawReport?.dispatchId || ""
      };
    }
    if (job.job_type === "scheduled_dispatch") {
      return runScheduledDispatchJob(rootDir, paths, job, input);
    }
    if (job.job_type === "runtime_drain") {
      const limit = boundedNumber([payload.limit, payload.runtimeLimit, payload.runtime_limit, input.runtimeLimit, input.runtime_limit, input.limit], 1, 1, 20);
      return runtimeBridgeDrain(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        runtime: payload.runtime || job.runtime,
        dispatchId: payload.dispatchId || payload.dispatch_id || input.dispatchId || input.dispatch_id || "",
        excludeDispatchTypes: payload.excludeDispatchTypes || payload.exclude_dispatch_types || input.excludeDispatchTypes || input.exclude_dispatch_types,
        limit,
        timeoutSeconds: payload.timeoutSeconds || payload.timeout_seconds || input.timeoutSeconds || input.timeout_seconds || 45,
        dryRun: false
      });
    }
    if (job.job_type === "stale_dispatch_reconcile") {
      return staleDispatchReconcile(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        limit: payload.limit || input.dispatchReconcileLimit || input.dispatch_reconcile_limit || 20,
        staleDispatchAfterMs: payload.staleDispatchAfterMs || payload.stale_dispatch_after_ms || input.staleDispatchAfterMs || input.stale_dispatch_after_ms
      });
    }
    if (job.job_type === "message_flow_reconcile") {
      return messageFlowReconcile(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        limit: payload.limit || input.messageFlowReconcileLimit || input.message_flow_reconcile_limit || 20,
        messageFlowStuckAfterMs: payload.messageFlowStuckAfterMs || payload.message_flow_stuck_after_ms || input.messageFlowStuckAfterMs || input.message_flow_stuck_after_ms
      });
    }
    if (job.job_type === "meeting_dispatch_retry") {
      const dispatchInput = parseJsonValue(payload.dispatchInput, payload.dispatchInput || {});
      if (!dispatchInput || typeof dispatchInput !== "object" || Array.isArray(dispatchInput)) {
        throw new Error("meeting_dispatch_retry payload.dispatchInput is required");
      }
      return meetingDispatch(rootDir, {
        ...dispatchInput,
        workflowRootDir: paths.root
      });
    }
    if (job.job_type === "human_gate_request_ensure") {
      return ensurePendingHumanGateRequests(rootDir, paths, { ...input, ...payload });
    }
    if (job.job_type === "telegram_outbox_deliver") {
      return telegramOutbox(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        operation: "deliver",
        status: "queued",
        limit: payload.limit || input.outboxLimit || input.outbox_limit || 5,
        account: input.account
      });
    }
    if (job.job_type === "human_gate_inbox") {
      return humanGateInbox(rootDir, {
        ...input,
        ...payload,
        workflowRootDir: paths.root,
        target: input.target || DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
        from: input.from || "cat_claw"
      });
    }
    throw new Error(`unknown control loop job type: ${job.job_type}`);
  }

  async function workflowControlLoopTick(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const tickId = input.tickId || input.tick_id || safeId("workflow_tick");
    const startedAt = nowIso();
    const lease = await acquireControlLoopLease(paths, input);
    if (!lease.acquired) {
      return { tickId, status: "skipped_lease_held", startedAt, lease, dbFile: paths.dbFile };
    }

    const result = {
      tickId,
      status: "running",
      startedAt,
      lease,
      readinessBefore: null,
      readinessAfter: null,
      seededJobs: [],
      claimedJobs: [],
      jobResults: [],
      dbFile: paths.dbFile
    };

    try {
      const tickBudgetMs = controlLoopTickBudgetMs(input);
      const timeoutSeconds = controlLoopTimeoutSeconds(input);
      const jobLeaseMs = controlLoopJobLeaseMs(input);
      const claimOwner = `${input.owner || input.leaseOwner || input.lease_owner || `pid:${process.pid}`}:${tickId}`;
      const dryRun = boolOption(input.dryRun ?? input.dry_run, false);
      const jobLimit = Math.max(1, Math.min(20, Number(input.jobLimit || input.job_limit || input.maxJobs || input.max_jobs || 4)));
      const startedAtMs = Date.now();
      const withinBudget = () => Date.now() - startedAtMs < tickBudgetMs;

      await appendControlLoopEvent(paths, tickId, "started", { lease, tickBudgetMs, timeoutSeconds, jobLeaseMs, jobLimit, dryRun }, eventContext);
      await appendControlLoopEvent(paths, tickId, "readiness_before_started", {}, eventContext);
      result.readinessBefore = await workflowReadinessSnapshot(paths, { ...input, activeChecks: false });
      await appendControlLoopEvent(paths, tickId, "readiness_before_completed", { status: result.readinessBefore?.status || "" }, eventContext);

      if (!dryRun) {
        await appendControlLoopEvent(paths, tickId, "job_seed_started", {}, eventContext);
        result.seededJobs = await seedControlLoopJobs(paths, input);
        await appendControlLoopEvent(paths, tickId, "job_seed_completed", { count: result.seededJobs.length }, eventContext);

        for (let index = 0; index < jobLimit && withinBudget(); index += 1) {
          const [job] = await claimControlLoopJobs(paths, { ...input, claimOwner, jobLimit: 1, jobLeaseMs, tickBudgetMs, timeoutSeconds });
          if (!job) break;
          const jobSummary = {
            jobId: job.job_id,
            jobType: job.job_type,
            dedupeKey: job.dedupe_key,
            priority: job.priority,
            workflowId: job.workflow_id || "",
            runtime: job.runtime || "",
            attempt: job.attempt,
            leaseUntil: job.lease_until || ""
          };
          result.claimedJobs.push(jobSummary);
          await appendControlLoopEvent(paths, tickId, "job_started", jobSummary, eventContext);
          try {
            const jobResult = await runControlLoopJob(rootDir, paths, job, input);
            const completed = await completeControlLoopJob(paths, job, jobResult);
            result.jobResults.push({ ...jobSummary, status: completed.status, result: jobResult, reason: completed.reason || "" });
            await appendControlLoopEvent(paths, tickId, completed.completed ? "job_completed" : "job_completion_skipped", { ...jobSummary, ...completed }, eventContext);
          } catch (error) {
            const failed = await failControlLoopJob(paths, job, error);
            result.jobResults.push({ ...jobSummary, ...failed });
            await appendControlLoopEvent(paths, tickId, failed.status === "lease_lost" ? "job_failure_skipped" : "job_failed", { ...jobSummary, ...failed }, eventContext);
          }
        }
      } else {
        result.seededJobs = [];
        result.jobResults.push({ status: "dry_run", summary: "control loop queue was not mutated" });
      }

      await appendControlLoopEvent(paths, tickId, "readiness_after_started", {}, eventContext);
      result.readinessAfter = await workflowReadinessSnapshot(paths, { ...input, activeChecks: false });
      await appendControlLoopEvent(paths, tickId, "readiness_after_completed", { status: result.readinessAfter?.status || "" }, eventContext);
      if (!dryRun) {
        try {
          result.retention = await maybeRunWorkflowRetention(paths, input);
          await appendControlLoopEvent(paths, tickId, "retention_completed", {
            status: result.retention?.status || "",
            cutoffIso: result.retention?.cutoffIso || "",
            backupRemovedCount: result.retention?.backups?.removedCount || 0,
            database: result.retention?.database || {}
          }, eventContext);
        } catch (error) {
          result.retention = { status: "failed", error: String(error?.message || error).slice(0, 1000) };
          await appendControlLoopEvent(paths, tickId, "retention_failed", { error: result.retention.error }, eventContext);
        }
      }
      result.status = "ok";
      result.completedAt = nowIso();
      await appendJsonl(path.join(paths.bridgeDir, "control-loop.jsonl"), result);
      await appendControlLoopEvent(paths, tickId, "completed", { status: result.status }, eventContext);
      return result;
    } catch (error) {
      result.status = "failed";
      result.error = String(error?.message || error).slice(0, 2000);
      result.completedAt = nowIso();
      await appendJsonl(path.join(paths.bridgeDir, "control-loop.jsonl"), result);
      await appendControlLoopEvent(paths, tickId, "failed", { error: result.error }, eventContext);
      return result;
    } finally {
      await releaseControlLoopLease(paths, lease, result);
    }
  }

  return {
    workflowControlLoopTick
  };
}
