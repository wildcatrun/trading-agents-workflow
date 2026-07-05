import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const SCHEDULE_ACTION_HANDLER_NAMES = {
  "workflow.schedule.upsert": "workflowScheduleUpsert",
  "workflow.scheduler.upsert": "workflowScheduleUpsert",
  "workflow.schedule.list": "workflowScheduleList",
  "workflow.schedules": "workflowScheduleList",
  "workflow.scheduler.list": "workflowScheduleList",
  "workflow.schedule.pause": "workflowSchedulePause",
  "workflow.scheduler.pause": "workflowSchedulePause",
  "workflow.schedule.resume": "workflowScheduleResume",
  "workflow.scheduler.resume": "workflowScheduleResume",
  "workflow.schedule.disable": "workflowScheduleDisable",
  "workflow.scheduler.disable": "workflowScheduleDisable"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`schedule action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`schedule action dependency missing: ${name}`);
  return context[name];
}

export function createScheduleActionRegistry(handlers = {}) {
  const entries = Object.entries(SCHEDULE_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing schedule action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runScheduleAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createScheduleActionHandlers(context = {}) {
  const boolOption = requireContextFunction(context, "boolOption");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const firstText = requireContextFunction(context, "firstText");
  const nextScheduleRunAt = requireContextFunction(context, "nextScheduleRunAt");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeIsoTimestamp = requireContextFunction(context, "normalizeIsoTimestamp");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const normalizeScheduleId = requireContextFunction(context, "normalizeScheduleId");
  const normalizeScheduleKind = requireContextFunction(context, "normalizeScheduleKind");
  const normalizeSchedulePolicy = requireContextFunction(context, "normalizeSchedulePolicy");
  const normalizeSchedulePriority = requireContextFunction(context, "normalizeSchedulePriority");
  const normalizeScheduleStatus = requireContextFunction(context, "normalizeScheduleStatus");
  const normalizeTimezone = requireContextFunction(context, "normalizeTimezone");
  const nowIso = requireContextFunction(context, "nowIso");
  const parseCronExpression = requireContextFunction(context, "parseCronExpression");
  const parseJsonValue = requireContextFunction(context, "parseJsonValue");
  const scheduleRow = requireContextFunction(context, "scheduleRow");
  const WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES = requireContextValue(context, "WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES");
  const WORKFLOW_SCHEDULE_MISFIRE_POLICIES = requireContextValue(context, "WORKFLOW_SCHEDULE_MISFIRE_POLICIES");

  async function workflowScheduleUpsert(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const scheduleId = normalizeScheduleId(input.scheduleId || input.schedule_id || input.id);
    const existingRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
    const existing = existingRows[0] || {};
    const scheduleKind = normalizeScheduleKind(input.scheduleKind || input.schedule_kind || existing.schedule_kind, input);
    const status = normalizeScheduleStatus(input.status || existing.status || "active");
    const timezone = normalizeTimezone(input.timezone || existing.timezone || "Asia/Shanghai");
    const cronExpr = scheduleKind === "cron" ? String(input.cronExpr || input.cron_expr || input.cron || existing.cron_expr || "").trim() : "";
    const rawIntervalSeconds = Number(input.intervalSeconds || input.interval_seconds || existing.interval_seconds || 0);
    const intervalSeconds = scheduleKind === "interval"
      ? Math.max(10, Math.min(366 * 24 * 3600, rawIntervalSeconds))
      : null;
    if (scheduleKind === "cron") parseCronExpression(cronExpr);
    if (scheduleKind === "interval" && (!Number.isFinite(rawIntervalSeconds) || rawIntervalSeconds <= 0)) throw new Error("interval schedule requires intervalSeconds");

    const runtime = normalizeRuntime(input.runtime || existing.runtime || "hermers");
    const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || existing.agent_id);
    const prompt = firstText(input.prompt, input.text, existing.prompt);
    if (!prompt) throw new Error("schedule prompt is required");
    const priority = normalizeSchedulePriority(input.priority || existing.priority);
    const concurrencyPolicy = normalizeSchedulePolicy(input.concurrencyPolicy || input.concurrency_policy || existing.concurrency_policy, WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES, "skip");
    const misfirePolicy = normalizeSchedulePolicy(input.misfirePolicy || input.misfire_policy || existing.misfire_policy, WORKFLOW_SCHEDULE_MISFIRE_POLICIES, "skip");
    const catchupWindowSeconds = Math.max(0, Math.min(7 * 24 * 3600, Number(input.catchupWindowSeconds || input.catchup_window_seconds || existing.catchup_window_seconds || 900)));
    const timeoutSeconds = Math.max(5, Math.min(1800, Number(input.timeoutSeconds || input.timeout_seconds || existing.timeout_seconds || 45)));
    const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || input.max_attempts || existing.max_attempts || 1)));
    const payload = input.payload === undefined ? parseJsonValue(existing.payload_json, {}) : parseJsonValue(input.payload, input.payload || {});
    const now = nowIso();
    const nextRunInput = normalizeIsoTimestamp(input.nextRunAt || input.next_run_at || "", "nextRunAt");
    const resetNextRun = boolOption(input.resetNextRun ?? input.reset_next_run, false);
    const effectiveSchedule = { schedule_kind: scheduleKind, cron_expr: cronExpr, interval_seconds: intervalSeconds, timezone };
    const nextRunAt = nextRunInput || (!existing.schedule_id || resetNextRun || !existing.next_run_at ? nextScheduleRunAt(effectiveSchedule, now) : existing.next_run_at);
    const createdAt = existing.created_at || now;
    const createdBy = firstText(input.createdBy, input.created_by, input.from, existing.created_by, "workflow_scheduler");
    const dispatchType = firstText(input.dispatchType, input.dispatch_type, existing.dispatch_type, scheduleKind === "cron" ? "scheduled_cron" : "scheduled_interval");
    const name = firstText(input.name, existing.name, scheduleId);

    await sqlite(paths.dbFile, `
INSERT INTO workflow_schedules(schedule_id, name, status, schedule_kind, cron_expr, interval_seconds, timezone, runtime, agent_id, dispatch_type, priority, prompt, payload_json, concurrency_policy, catchup_window_seconds, misfire_policy, timeout_seconds, max_attempts, next_run_at, last_scheduled_at, last_dispatch_id, created_by, created_at, updated_at)
VALUES (${sqlValue(scheduleId)}, ${sqlValue(name)}, ${sqlValue(status)}, ${sqlValue(scheduleKind)}, ${sqlValue(cronExpr)}, ${sqlValue(intervalSeconds)}, ${sqlValue(timezone)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(dispatchType)}, ${sqlValue(priority)}, ${sqlValue(prompt)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(concurrencyPolicy)}, ${sqlValue(catchupWindowSeconds)}, ${sqlValue(misfirePolicy)}, ${sqlValue(timeoutSeconds)}, ${sqlValue(maxAttempts)}, ${sqlValue(nextRunAt)}, ${sqlValue(existing.last_scheduled_at || "")}, ${sqlValue(existing.last_dispatch_id || "")}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)}, ${sqlValue(now)})
ON CONFLICT(schedule_id) DO UPDATE SET
  name=excluded.name,
  status=excluded.status,
  schedule_kind=excluded.schedule_kind,
  cron_expr=excluded.cron_expr,
  interval_seconds=excluded.interval_seconds,
  timezone=excluded.timezone,
  runtime=excluded.runtime,
  agent_id=excluded.agent_id,
  dispatch_type=excluded.dispatch_type,
  priority=excluded.priority,
  prompt=excluded.prompt,
  payload_json=excluded.payload_json,
  concurrency_policy=excluded.concurrency_policy,
  catchup_window_seconds=excluded.catchup_window_seconds,
  misfire_policy=excluded.misfire_policy,
  timeout_seconds=excluded.timeout_seconds,
  max_attempts=excluded.max_attempts,
  next_run_at=excluded.next_run_at,
  created_by=COALESCE(NULLIF(workflow_schedules.created_by,''), excluded.created_by),
  updated_at=excluded.updated_at;`);

    const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
    return { schedule: scheduleRow(rows[0]), dbFile: paths.dbFile };
  }

  async function workflowScheduleList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const filters = [];
    if (input.scheduleId || input.schedule_id || input.id) filters.push(`schedule_id=${sqlValue(normalizeScheduleId(input.scheduleId || input.schedule_id || input.id))}`);
    if (input.status) filters.push(`status=${sqlValue(normalizeScheduleStatus(input.status))}`);
    if (input.runtime) filters.push(`runtime=${sqlValue(normalizeRuntime(input.runtime))}`);
    if (input.agentId || input.agent_id) filters.push(`agent_id=${sqlValue(normalizeAgentId(input.agentId || input.agent_id))}`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_schedules
${where}
ORDER BY status, next_run_at, schedule_id
LIMIT ${limit};`, { json: true });
    const runLimit = Math.max(0, Math.min(20, Number(input.runLimit || input.run_limit || 0)));
    const schedules = rows.map(scheduleRow);
    if (runLimit > 0) {
      for (const schedule of schedules) {
        const runs = await sqlite(paths.dbFile, `
SELECT *
FROM scheduled_runs
WHERE schedule_id=${sqlValue(schedule.scheduleId)}
ORDER BY scheduled_at DESC
LIMIT ${runLimit};`, { json: true });
        schedule.recentRuns = runs.map((row) => ({ ...row, result: parseJsonValue(row.result_json, {}) }));
      }
    }
    return { schedules, count: schedules.length, dbFile: paths.dbFile };
  }

  async function workflowScheduleStatus(rootDir, input = {}, forcedStatus = "") {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const scheduleId = normalizeScheduleId(input.scheduleId || input.schedule_id || input.id);
    const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
    if (!rows[0]) throw new Error(`schedule not found: ${scheduleId}`);
    const status = normalizeScheduleStatus(forcedStatus || input.status, rows[0].status || "paused");
    const now = nowIso();
    let nextRunAt = rows[0].next_run_at || "";
    if (status === "active" && (!nextRunAt || nextRunAt <= now || boolOption(input.resetNextRun ?? input.reset_next_run, false))) {
      nextRunAt = nextScheduleRunAt(rows[0], now);
    }
    await sqlite(paths.dbFile, `
UPDATE workflow_schedules
SET status=${sqlValue(status)},
    next_run_at=${sqlValue(nextRunAt)},
    updated_at=${sqlValue(now)}
WHERE schedule_id=${sqlValue(scheduleId)};`);
    const updated = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
    return { schedule: scheduleRow(updated[0]), dbFile: paths.dbFile };
  }

  return {
    workflowScheduleDisable: (rootDir, input = {}) => workflowScheduleStatus(rootDir, input, "disabled"),
    workflowScheduleList,
    workflowSchedulePause: (rootDir, input = {}) => workflowScheduleStatus(rootDir, input, "paused"),
    workflowScheduleResume: (rootDir, input = {}) => workflowScheduleStatus(rootDir, input, "active"),
    workflowScheduleUpsert
  };
}
