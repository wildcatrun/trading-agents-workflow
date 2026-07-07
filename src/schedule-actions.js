import {
  boolOption,
  firstText,
  parseJsonValue,
  safeId
} from "./workflow/json.js";
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

const WORKFLOW_TASK_PRIORITIES = new Set(["flash", "steer", "high", "normal", "low"]);
const WORKFLOW_SCHEDULE_STATUSES = new Set(["active", "paused", "disabled"]);
const WORKFLOW_SCHEDULE_KINDS = new Set(["cron", "interval"]);
const WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES = new Set(["skip", "allow"]);
const WORKFLOW_SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);

function nowIso() {
  return new Date().toISOString();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanFileSegment(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "item";
}

function normalizeIsoTimestamp(value, fieldName = "timestamp") {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${fieldName}: ${text}`);
  return date.toISOString();
}

function normalizeScheduleId(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("scheduleId is required");
  return cleanFileSegment(raw).slice(0, 120);
}

function normalizeScheduleStatus(value, fallback = "active") {
  const status = String(value || fallback).trim().toLowerCase();
  return WORKFLOW_SCHEDULE_STATUSES.has(status) ? status : fallback;
}

function normalizeScheduleKind(value, input = {}) {
  const raw = String(value || "").trim().toLowerCase();
  if (WORKFLOW_SCHEDULE_KINDS.has(raw)) return raw;
  if (input.cronExpr || input.cron_expr || input.cron) return "cron";
  return "interval";
}

function normalizeSchedulePriority(value) {
  const priority = String(value || "normal").trim();
  return WORKFLOW_TASK_PRIORITIES.has(priority) ? priority : "normal";
}

function normalizeSchedulePolicy(value, allowed, fallback) {
  const text = String(value || fallback).trim().toLowerCase();
  return allowed.has(text) ? text : fallback;
}

function normalizeTimezone(value) {
  const timezone = String(value || "Asia/Shanghai").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new Error(`invalid timezone: ${timezone}`);
  }
}

const CRON_MONTH_NAMES = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

const CRON_DOW_NAMES = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

function cronTokenNumber(token, aliases = {}) {
  const text = String(token || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(aliases, text)) return aliases[text];
  if (!/^\d+$/.test(text)) throw new Error(`invalid cron token: ${token}`);
  return Number(text);
}

function parseCronField(raw, min, max, aliases = {}, options = {}) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) throw new Error("empty cron field");
  const values = new Set();
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const explicitWildcard = text === "*";
  for (const part of parts) {
    const [rangePartRaw, stepRaw] = part.split("/");
    const rangePart = String(rangePartRaw || "").trim();
    const step = stepRaw === undefined || stepRaw === "" ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid cron step: ${part}`);
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [left, right] = rangePart.split("-");
      start = cronTokenNumber(left, aliases);
      end = cronTokenNumber(right, aliases);
    } else {
      start = cronTokenNumber(rangePart, aliases);
      end = start;
    }
    if (start > end) throw new Error(`invalid cron range: ${part}`);
    for (let value = start; value <= end; value += step) {
      let normalized = value;
      if (options.sevenIsSunday && normalized === 7) normalized = 0;
      if (normalized < min || normalized > (options.sevenIsSunday ? 6 : max)) {
        throw new Error(`cron value out of range: ${part}`);
      }
      values.add(normalized);
    }
  }
  const fullSize = options.sevenIsSunday ? 7 : max - min + 1;
  return { wildcard: explicitWildcard || values.size === fullSize, values };
}

function parseCronExpression(expression) {
  const fields = String(expression || "").trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron expression must have 5 fields: ${expression}`);
  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dom: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12, CRON_MONTH_NAMES),
    dow: parseCronField(fields[4], 0, 7, CRON_DOW_NAMES, { sevenIsSunday: true })
  };
}

function zonedFormatter(timezone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
}

function zonedDateParts(date, formatter) {
  const parts = {};
  for (const item of formatter.formatToParts(date)) {
    if (item.type !== "literal") parts[item.type] = item.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  };
}

function cronFieldMatches(field, value) {
  return field.values.has(value);
}

function cronMatchesDate(parsed, date, formatter) {
  const parts = zonedDateParts(date, formatter);
  if (!cronFieldMatches(parsed.minute, parts.minute)) return false;
  if (!cronFieldMatches(parsed.hour, parts.hour)) return false;
  if (!cronFieldMatches(parsed.month, parts.month)) return false;
  const domMatches = cronFieldMatches(parsed.dom, parts.day);
  const dowMatches = cronFieldMatches(parsed.dow, parts.dow);
  const dayMatches = !parsed.dom.wildcard && !parsed.dow.wildcard ? (domMatches || dowMatches) : (domMatches && dowMatches);
  return dayMatches;
}

function roundToNextMinute(date) {
  const next = new Date(date.getTime());
  next.setUTCSeconds(0, 0);
  if (next.getTime() <= date.getTime()) next.setUTCMinutes(next.getUTCMinutes() + 1);
  return next;
}

function nextCronRunAt(expression, timezone, fromIso = nowIso()) {
  const parsed = parseCronExpression(expression);
  const formatter = zonedFormatter(timezone);
  let cursor = roundToNextMinute(new Date(fromIso));
  const deadline = cursor.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= deadline) {
    if (cronMatchesDate(parsed, cursor, formatter)) return cursor.toISOString();
    cursor = new Date(cursor.getTime() + 60_000);
  }
  throw new Error(`no cron run found within 366 days: ${expression}`);
}

function scheduleRunId(scheduleId, scheduledAt) {
  return `scheduled_run.${cleanFileSegment(scheduleId)}.${cleanFileSegment(String(scheduledAt).replace(/[:.]/g, ""))}`;
}

function scheduledMeetingId(scheduleId, scheduledAt) {
  return `scheduled.${cleanFileSegment(scheduleId)}.${cleanFileSegment(String(scheduledAt).replace(/[:.]/g, ""))}`.slice(0, 120);
}

function scheduleRow(row = {}) {
  return {
    scheduleId: row.schedule_id || "",
    name: row.name || "",
    status: row.status || "",
    scheduleKind: row.schedule_kind || "",
    cronExpr: row.cron_expr || "",
    intervalSeconds: Number(row.interval_seconds || 0) || null,
    timezone: row.timezone || "",
    runtime: row.runtime || "",
    agentId: row.agent_id || "",
    dispatchType: row.dispatch_type || "",
    priority: row.priority || "normal",
    prompt: row.prompt || "",
    payload: parseJsonValue(row.payload_json, {}),
    concurrencyPolicy: row.concurrency_policy || "skip",
    catchupWindowSeconds: Number(row.catchup_window_seconds || 0) || 0,
    misfirePolicy: row.misfire_policy || "skip",
    timeoutSeconds: Number(row.timeout_seconds || 0) || 45,
    maxAttempts: Number(row.max_attempts || 0) || 1,
    nextRunAt: row.next_run_at || "",
    lastScheduledAt: row.last_scheduled_at || "",
    lastDispatchId: row.last_dispatch_id || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function nextScheduleRunAt(schedule, fromIso = nowIso()) {
  const kind = normalizeScheduleKind(schedule.schedule_kind || schedule.scheduleKind, schedule);
  if (kind === "cron") {
    const cronExpr = String(schedule.cron_expr || schedule.cronExpr || schedule.cron || "").trim();
    if (!cronExpr) throw new Error("cron schedule requires cronExpr");
    return nextCronRunAt(cronExpr, normalizeTimezone(schedule.timezone), fromIso);
  }
  const rawIntervalSeconds = Number(schedule.interval_seconds || schedule.intervalSeconds || 0);
  if (!Number.isFinite(rawIntervalSeconds) || rawIntervalSeconds <= 0) throw new Error("interval schedule requires intervalSeconds");
  const intervalSeconds = Math.max(10, Math.min(366 * 24 * 3600, rawIntervalSeconds));
  const fromDate = new Date(fromIso);
  if (Number.isNaN(fromDate.getTime())) throw new Error(`invalid schedule base timestamp: ${fromIso}`);
  return new Date(fromDate.getTime() + intervalSeconds * 1000).toISOString();
}

function nextScheduleRunAfterSeed(schedule, scheduledAt, now, misfired) {
  let nextRunAt = nextScheduleRunAt(schedule, scheduledAt);
  if (!misfired || schedule.misfire_policy !== "skip") return nextRunAt;
  const catchupSeconds = Math.max(0, Number(schedule.catchup_window_seconds || 0));
  const oldestAllowed = new Date(new Date(now).getTime() - catchupSeconds * 1000).toISOString();
  let guard = 0;
  while (nextRunAt && nextRunAt < oldestAllowed && guard < 1000) {
    nextRunAt = nextScheduleRunAt(schedule, nextRunAt);
    guard += 1;
  }
  return nextRunAt;
}

async function hasActiveScheduledDispatch(paths, scheduleId) {
  const rows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM scheduled_runs sr
LEFT JOIN mixed_meeting_dispatches d ON d.dispatch_id=sr.dispatch_id
WHERE sr.schedule_id=${sqlValue(scheduleId)}
  AND sr.status IN ('queued','dispatched')
  AND (
    sr.status='queued'
    OR d.dispatch_id IS NULL
    OR d.status IN ('queued','sent')
  );`, { json: true });
  return Number(rows[0]?.count || 0) > 0;
}

async function seedDueScheduleJobsCore(paths, input = {}, context = {}) {
  const enqueueControlLoopJob = context.enqueueControlLoopJob;
  if (typeof enqueueControlLoopJob !== "function") throw new Error("schedule action dependency missing: enqueueControlLoopJob");
  if (!boolOption(input.enableSchedules ?? input.enable_schedules, true)) return [];
  const now = normalizeIsoTimestamp(input.now || input.nowIso || input.now_iso || nowIso(), "now");
  const limit = Math.max(1, Math.min(100, Number(input.scheduleLimit || input.schedule_limit || 20)));
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_schedules
WHERE status='active'
  AND next_run_at IS NOT NULL
  AND next_run_at != ''
  AND next_run_at <= ${sqlValue(now)}
ORDER BY
  CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  next_run_at,
  schedule_id
LIMIT ${limit};`, { json: true });
  const seeded = [];
  for (const raw of rows) {
    const schedule = { ...raw };
    const scheduledAt = normalizeIsoTimestamp(schedule.next_run_at, "nextRunAt");
    const runId = scheduleRunId(schedule.schedule_id, scheduledAt);
    const catchupSeconds = Math.max(0, Number(schedule.catchup_window_seconds || 0));
    const misfired = catchupSeconds > 0 && scheduledAt < new Date(new Date(now).getTime() - catchupSeconds * 1000).toISOString();
    const activeDispatch = schedule.concurrency_policy === "skip" ? await hasActiveScheduledDispatch(paths, schedule.schedule_id) : false;
    const skipped = (misfired && schedule.misfire_policy === "skip") || activeDispatch;
    const status = skipped ? "skipped" : "queued";
    const error = activeDispatch ? "concurrency_policy_skip" : misfired ? "misfire_window_exceeded" : "";
    const createdAt = nowIso();

    await sqlite(paths.dbFile, `
INSERT OR IGNORE INTO scheduled_runs(run_id, schedule_id, scheduled_at, status, workflow_id, meeting_id, dispatch_id, runtime, agent_id, attempt, result_json, error, created_at, updated_at, completed_at)
VALUES (${sqlValue(runId)}, ${sqlValue(schedule.schedule_id)}, ${sqlValue(scheduledAt)}, ${sqlValue(status)}, '', '', '', ${sqlValue(schedule.runtime)}, ${sqlValue(schedule.agent_id)}, 0, ${sqlValue(JSON.stringify({ seededAt: createdAt, skipped }))}, ${sqlValue(error)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)}, ${sqlValue(skipped ? createdAt : "")});`);

    let job = null;
    if (!skipped) {
      job = await enqueueControlLoopJob(paths, {
        jobType: "scheduled_dispatch",
        dedupeKey: `scheduled_dispatch:${schedule.schedule_id}:${scheduledAt}`,
        priority: schedule.priority || "normal",
        workflowId: `schedule.${schedule.schedule_id}`,
        runtime: schedule.runtime,
        maxAttempts: schedule.max_attempts || 1,
        payload: { scheduleId: schedule.schedule_id, runId, scheduledAt }
      });
    }

    const nextRunAt = nextScheduleRunAfterSeed(schedule, scheduledAt, now, misfired);
    await sqlite(paths.dbFile, `
UPDATE workflow_schedules
SET next_run_at=${sqlValue(nextRunAt)},
    last_scheduled_at=${sqlValue(scheduledAt)},
    updated_at=${sqlValue(createdAt)}
WHERE schedule_id=${sqlValue(schedule.schedule_id)}
  AND next_run_at=${sqlValue(scheduledAt)};`);
    seeded.push({ scheduleId: schedule.schedule_id, runId, scheduledAt, status, error, job });
  }
  return seeded;
}

async function runScheduledDispatchJobCore(rootDir, paths, job, input = {}, context = {}) {
  const meetingDispatch = context.meetingDispatch;
  const enqueueControlLoopJob = context.enqueueControlLoopJob;
  if (typeof meetingDispatch !== "function") throw new Error("schedule action dependency missing: meetingDispatch");
  if (typeof enqueueControlLoopJob !== "function") throw new Error("schedule action dependency missing: enqueueControlLoopJob");
  const payload = parseJsonValue(job.payload_json, {});
  const scheduleId = normalizeScheduleId(payload.scheduleId || payload.schedule_id);
  const scheduledAt = normalizeIsoTimestamp(payload.scheduledAt || payload.scheduled_at, "scheduledAt");
  const runId = String(payload.runId || payload.run_id || scheduleRunId(scheduleId, scheduledAt)).trim();
  const scheduleRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
  const schedule = scheduleRows[0];
  if (!schedule) throw new Error(`schedule not found: ${scheduleId}`);
  const runRows = await sqlite(paths.dbFile, `SELECT * FROM scheduled_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
  const run = runRows[0];
  if (!run) throw new Error(`scheduled run not found: ${runId}`);
  if (run.status !== "queued") return { scheduleId, runId, status: run.status, skipped: true };
  const workflowId = scheduledMeetingId(scheduleId, scheduledAt);
  const meetingId = workflowId;
  const traceId = `schedule.${scheduleId}.${cleanFileSegment(scheduledAt.replace(/[:.]/g, ""))}`;
  const idempotencyKey = `schedule:${scheduleId}:${scheduledAt}`;
  const schedulePayload = parseJsonValue(schedule.payload_json, {});
  const delivery = objectValue(schedulePayload.delivery || schedulePayload.deliveryConfig || schedulePayload.delivery_config);
  const deliveryMode = String(delivery.mode || "").trim().toLowerCase();
  const deliveryChannel = String(delivery.channel || "").trim().toLowerCase();
  const deliveryAccount = firstText(schedulePayload.accountId, schedulePayload.account_id, delivery.accountId, delivery.account_id, delivery.account, schedule.agent_id);
  const deliveryTarget = firstText(schedulePayload.chatId, schedulePayload.chat_id, schedulePayload.conversationId, schedulePayload.conversation_id, delivery.to, delivery.chatId, delivery.chat_id);
  const wantsTelegramReply = deliveryMode === "announce" && (deliveryChannel === "telegram" || deliveryTarget);
  try {
    const dispatch = await meetingDispatch(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId: `dispatch.${runId}`,
      runtime: schedule.runtime,
      agentId: schedule.agent_id,
      dispatchType: schedule.dispatch_type || "scheduled_dispatch",
      priority: schedule.priority || "normal",
      prompt: schedule.prompt,
      createdBy: schedule.created_by || "workflow_scheduler",
      maxAttempts: schedule.max_attempts || 1,
      ...(wantsTelegramReply ? {
        delivery,
        returnPolicy: firstText(schedulePayload.returnPolicy, schedulePayload.return_policy, delivery.returnPolicy, delivery.return_policy, "reply_to_source_chat"),
        deliveryPolicy: firstText(schedulePayload.deliveryPolicy, schedulePayload.delivery_policy, delivery.deliveryPolicy, delivery.delivery_policy, "reply_to_source_chat"),
        sourceChannel: firstText(schedulePayload.sourceChannel, schedulePayload.source_channel, delivery.channel, "telegram"),
        sourceSystem: firstText(schedulePayload.sourceSystem, schedulePayload.source_system, "workflow_scheduler"),
        sourceRuntime: firstText(schedulePayload.sourceRuntime, schedulePayload.source_runtime, "workflow_scheduler"),
        accountId: deliveryAccount,
        chatId: deliveryTarget,
        senderId: firstText(schedulePayload.senderId, schedulePayload.sender_id, "workflow_scheduler"),
        sourceMessageId: firstText(schedulePayload.sourceMessageId, schedulePayload.source_message_id, `schedule:${schedule.schedule_id}:${scheduledAt}`),
        routeAgentId: firstText(schedulePayload.routeAgentId, schedulePayload.route_agent_id, "workflow_scheduler"),
        routeRuntime: firstText(schedulePayload.routeRuntime, schedulePayload.route_runtime, "workflow_scheduler")
      } : {}),
      payload: {
        scheduleId,
        runId,
        scheduledAt,
        scheduleKind: schedule.schedule_kind,
        scheduleName: schedule.name || "",
        schedulePayload
      }
    });
    const completedAt = nowIso();
    await sqlite(paths.dbFile, `
UPDATE scheduled_runs
SET status='dispatched',
    workflow_id=${sqlValue(workflowId)},
    meeting_id=${sqlValue(meetingId)},
    dispatch_id=${sqlValue(dispatch.dispatchId)},
    runtime=${sqlValue(dispatch.runtime || schedule.runtime)},
    agent_id=${sqlValue(dispatch.agentId || schedule.agent_id)},
    attempt=attempt+1,
    result_json=${sqlValue(JSON.stringify({ dispatch, dispatchedAt: completedAt }))},
    updated_at=${sqlValue(completedAt)}
WHERE run_id=${sqlValue(runId)};`);
    await sqlite(paths.dbFile, `
UPDATE workflow_schedules
SET last_dispatch_id=${sqlValue(dispatch.dispatchId)},
    updated_at=${sqlValue(completedAt)}
WHERE schedule_id=${sqlValue(scheduleId)};`);
    await enqueueControlLoopJob(paths, {
      jobType: "runtime_drain",
      dedupeKey: `runtime_drain:${dispatch.runtime || schedule.runtime}`,
      priority: schedule.priority === "flash" ? "flash" : "high",
      runtime: dispatch.runtime || schedule.runtime,
      payload: {
        runtime: dispatch.runtime || schedule.runtime,
        limit: 1,
        timeoutSeconds: schedule.timeout_seconds || input.timeoutSeconds || input.timeout_seconds || 45
      }
    });
    return { scheduleId, runId, scheduledAt, status: "dispatched", dispatchId: dispatch.dispatchId, runtime: dispatch.runtime, agentId: dispatch.agentId, deduped: Boolean(dispatch.deduped) };
  } catch (error) {
    const failedAt = nowIso();
    const terminal = Number(job.attempt || 0) >= Number(job.max_attempts || 1);
    await sqlite(paths.dbFile, `
UPDATE scheduled_runs
SET status=${sqlValue(terminal ? "failed" : "queued")},
    attempt=attempt+1,
    error=${sqlValue(String(error?.message || error).slice(0, 2000))},
    updated_at=${sqlValue(failedAt)},
    completed_at=${sqlValue(terminal ? failedAt : "")}
WHERE run_id=${sqlValue(runId)};`);
    throw error;
  }
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
  const enqueueControlLoopJob = requireContextFunction(context, "enqueueControlLoopJob");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const scheduleCoreContext = { enqueueControlLoopJob, meetingDispatch };

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
    runScheduledDispatchJob: (rootDir, paths, job, input = {}) => runScheduledDispatchJobCore(rootDir, paths, job, input, scheduleCoreContext),
    seedDueScheduleJobs: (paths, input = {}) => seedDueScheduleJobsCore(paths, input, scheduleCoreContext),
    workflowScheduleDisable: (rootDir, input = {}) => workflowScheduleStatus(rootDir, input, "disabled"),
    workflowScheduleList,
    workflowSchedulePause: (rootDir, input = {}) => workflowScheduleStatus(rootDir, input, "paused"),
    workflowScheduleResume: (rootDir, input = {}) => workflowScheduleStatus(rootDir, input, "active"),
    workflowScheduleUpsert
  };
}
