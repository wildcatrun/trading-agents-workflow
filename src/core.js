import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { runWorkflowAction, workflowStatus } from "./workflow.js";

export const PLUGIN_ID = "trading-agents-workflow";
export const SCHEMA_VERSION = 7;
export const DEFAULT_ROOT = "/home/flashcat/.openclaw/shared/trading-agents-workflow";

const VALID_MEETING_ID = /^[a-z0-9][a-z0-9._-]{2,120}$/;
const MEETING_TYPES = new Set([
  "pre_market",
  "post_market",
  "weekly",
  "monthly",
  "special",
  "research",
  "risk",
  "execution",
  "incident",
  "governance",
  "general",
  "market_briefing",
  "research_meeting",
  "trade_planning",
  "risk_review",
  "execution_review",
  "content_review",
  "incident_review",
  "system_governance"
]);
const TRADING_RELATED_TYPES = new Set([
  "pre_market",
  "post_market",
  "research",
  "risk",
  "execution",
  "market_briefing",
  "research_meeting",
  "trade_planning",
  "risk_review",
  "execution_review"
]);
const MEETING_MODES = new Set(["silent", "digest", "transparent", "command_only"]);
const COMMAND_TYPES = new Set([
  "start_meeting",
  "pause",
  "resume",
  "direction_change",
  "add_constraint",
  "add_participant",
  "remove_participant",
  "request_summary",
  "request_proposal",
  "approve",
  "approve_trial",
  "reject",
  "revise",
  "escalate_to_risk",
  "escalate_to_cat_brain",
  "human_gate_required",
  "freeze_phase",
  "revise_required",
  "notify_flashcat",
  "close_meeting"
]);
const HUMAN_GATE_TYPES = new Set([
  "institution_effective",
  "live_strategy_launch",
  "risk_budget_change",
  "high_risk_trade_execution",
  "role_permission_change",
  "long_term_memory_write",
  "incident_response_plan",
  "monthly_principle_adjustment",
  "organization_responsibility_change",
  "automation_boundary_expansion",
  "telegram_permission_expansion",
  "data_source_permission_upgrade",
  "trading_tool_permission_upgrade"
]);
const DEFAULT_TEMPLATES = {
  "pre-market.md": "# 盘前会\n\n## 市场概览\n\n## 今日观察重点\n\n## 风险提醒\n\n## 行动项\n",
  "post-market.md": "# 盘后会\n\n## 当日复盘\n\n## 盘前假设对照\n\n## 偏差与遗漏\n\n## 后续追踪\n",
  "weekly.md": "# 周会\n\n## 本周摘要\n\n## 行动项状态\n\n## 风险与分歧\n\n## 下周重点\n",
  "monthly.md": "# 月会\n\n## 月度复盘\n\n## 制度/原则候选\n\n## 风险预算与权限\n\n## Human Gate\n",
  "special.md": "# 临时专项会议\n\n## 主题\n\n## 目标\n\n## 产物\n\n## 决策\n",
  "incident.md": "# 事故复盘会\n\n## 事件\n\n## 影响\n\n## 根因\n\n## 处置方案\n\n## Human Gate\n",
  "execution-review.md": "# 执行复盘\n\n## 执行计划\n\n## 执行结果\n\n## 偏差\n\n## 复盘结论\n"
};

const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 30_000;

function nowIso() {
  return new Date().toISOString();
}

function nowStamp() {
  return nowIso().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function requireText(value, fieldName) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${fieldName} is required`);
  return text;
}

function normalizeMeetingId(value) {
  const normalized = requireText(value, "meetingId")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    .slice(0, 120);
  if (!VALID_MEETING_ID.test(normalized)) throw new Error(`invalid meetingId: ${value}`);
  return normalized;
}

function safeId(prefix) {
  return `${prefix}.${Date.now().toString(36)}.${randomUUID().slice(0, 8)}`;
}

function cleanSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._=-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function normalizeAgentAlias(value) {
  const text = String(value || "").trim();
  return text === "catclaw" ? "cat_claw" : text;
}

function normalizeAgentList(value, fallback = "main") {
  const agents = asStringArray(value).map(normalizeAgentAlias).filter(Boolean);
  return agents.length ? [...new Set(agents)] : [fallback];
}

function actionItemTaskStatus(value) {
  const status = String(value || "open").trim().toLowerCase();
  if (["done", "complete", "completed", "closed", "resolved"].includes(status)) return "done";
  if (["doing", "in_progress", "in-progress", "running"].includes(status)) return "in_progress";
  if (["blocked", "waiting", "pending_human_gate"].includes(status)) return "blocked";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  return "pending";
}

function defaultRuntimeForAgent(agentId) {
  if (["cat_body", "cat_ears", "cat_eyes", "cat_heart", "cat_nose", "cat_penclaw"].includes(agentId)) return "hermes_acp";
  if (["main", "cat_claw"].includes(agentId)) return "openclaw";
  return "";
}

function shouldMirrorActionItem(input) {
  return Boolean(input.promoteToWorkflowTask ?? input.promote_to_workflow_task ?? input.workflowTask ?? input.workflow_task ?? true);
}

async function mirrorActionItemToWorkflowTasks(rootDir, meetingId, item, input = {}) {
  if (!shouldMirrorActionItem(input)) return null;
  const owners = normalizeAgentList(item.owner_agent || input.ownerAgent || input.owner_agent || input.owner, "main");
  const status = actionItemTaskStatus(item.status || input.status);
  const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
  const baseTaskId = cleanSegment(input.taskId || input.task_id || `action-${meetingId}-${item.item_id}`);
  const mirrored = [];
  for (const owner of owners) {
    const multipleOwners = owners.length > 1;
    const taskId = multipleOwners ? `${baseTaskId}-${cleanSegment(owner)}`.slice(0, 180) : baseTaskId.slice(0, 180);
    const runtime = String(input.runtime || defaultRuntimeForAgent(owner)).trim();
    const payload = {
      source: "meeting.action_item",
      meetingId,
      actionItemId: item.item_id,
      originalOwnerAgent: item.owner_agent || "",
      mirroredAt: nowIso()
    };
    const taskInput = {
      workflowRootDir: rootDir,
      workflowId,
      taskId,
      phase: input.phase || "meeting_action_items",
      ownerAgent: owner,
      runtime,
      agentId: input.agentId || input.agent_id || owner,
      taskType: input.taskType || input.task_type || "meeting_action_item",
      status,
      priority: input.priority || item.priority || "normal",
      dependsOn: item.depends_on || input.dependsOn || input.depends_on || [],
      expectedArtifact: item.required_artifact || input.requiredArtifact || input.required_artifact || "",
      actualArtifactRef: input.actualArtifactRef || input.actual_artifact_ref || input.artifactRef || input.artifact_ref || "",
      receiptRequired: input.receiptRequired ?? input.receipt_required ?? true,
      humanGateRequired: input.humanGateRequired ?? input.human_gate_required ?? false,
      summary: item.title || input.summary || input.text || "",
      prompt: input.prompt || item.title || input.text || "",
      createdBy: normalizeAgentAlias(input.createdBy || input.created_by || input.updatedBy || input.from || item.created_by || "cat_claw"),
      dueAt: input.dueAt || input.due_at || item.due_at || "",
      payload
    };
    try {
      const created = await runWorkflowAction(rootDir, { action: "workflow.task.create", ...taskInput });
      mirrored.push({ taskId, ownerAgent: owner, runtime, status: created.status, operation: "create" });
    } catch (error) {
      if (!String(error?.message || error).includes("UNIQUE constraint failed")) throw error;
      const updated = await runWorkflowAction(rootDir, {
        action: "workflow.task.update",
        workflowRootDir: rootDir,
        taskId,
        status,
        summary: taskInput.summary,
        prompt: taskInput.prompt,
        expectedArtifact: taskInput.expectedArtifact,
        actualArtifactRef: taskInput.actualArtifactRef,
        payload
      });
      mirrored.push({ taskId, ownerAgent: owner, runtime, status: updated.status, operation: "update" });
    }
  }
  return mirrored;
}

function normalizeType(value, fallback = "general") {
  const type = String(value || fallback).trim();
  return MEETING_TYPES.has(type) ? type : fallback;
}

function normalizeMode(value) {
  const mode = String(value || "transparent").trim();
  return MEETING_MODES.has(mode) ? mode : "transparent";
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function resolveProtocolRoot(rootDir) {
  const raw = rootDir || process.env.TRADING_AGENTS_WORKFLOW_ROOT || process.env.CAT_MEETING_GOVERNANCE_ROOT || DEFAULT_ROOT;
  if (raw.startsWith("~/")) return path.resolve(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

export function protocolPaths(rootDir, meetingId) {
  const root = resolveProtocolRoot(rootDir);
  const id = meetingId ? normalizeMeetingId(meetingId) : null;
  const artifactDir = id ? path.join(root, "artifacts", id) : null;
  return {
    root,
    meetingsDir: path.join(root, "meetings"),
    commandsDir: path.join(root, "commands"),
    eventsDir: path.join(root, "events"),
    statesDir: path.join(root, "states"),
    actionItemsDir: path.join(root, "action_items"),
    decisionsDir: path.join(root, "decisions"),
    minutesDir: path.join(root, "minutes"),
    notificationsDir: path.join(root, "notifications"),
    artifactsDir: path.join(root, "artifacts"),
    templatesDir: path.join(root, "templates"),
    indexDir: path.join(root, "index"),
    dailyIndexDir: path.join(root, "index", "daily"),
    weeklyIndexDir: path.join(root, "index", "weekly"),
    monthlyIndexDir: path.join(root, "index", "monthly"),
    meetingsIndexFile: path.join(root, "index", "meetings.jsonl"),
    meetingFile: id ? path.join(root, "meetings", `${id}.md`) : null,
    commandsFile: id ? path.join(root, "commands", `${id}.commands.jsonl`) : null,
    eventsFile: id ? path.join(root, "events", `${id}.events.jsonl`) : null,
    stateFile: id ? path.join(root, "states", `${id}.state.json`) : null,
    actionItemsFile: id ? path.join(root, "action_items", `${id}.items.jsonl`) : null,
    decisionsFile: id ? path.join(root, "decisions", `${id}.decisions.jsonl`) : null,
    minutesFile: id ? path.join(root, "minutes", `${id}.minutes.md`) : null,
    notificationsFile: id ? path.join(root, "notifications", `${id}.notifications.jsonl`) : null,
    artifactDir,
    artifactManifestFile: artifactDir ? path.join(artifactDir, "manifest.jsonl") : null
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function withProtocolLock(rootDir, fn) {
  const root = resolveProtocolRoot(rootDir);
  await fs.mkdir(root, { recursive: true });
  const lockDir = path.join(root, ".cat-meeting-governance.lock");
  const startedAt = Date.now();
  while (true) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(path.join(lockDir, "owner.json"), JSON.stringify({ pid: process.pid, createdAt: nowIso() }, null, 2), "utf8");
      break;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      try {
        const stat = await fs.stat(lockDir);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) await fs.rm(lockDir, { recursive: true, force: true });
      } catch (statError) {
        if (!statError || statError.code !== "ENOENT") throw statError;
      }
      if (Date.now() - startedAt > LOCK_WAIT_MS) throw new Error(`timed out waiting for protocol lock: ${lockDir}`);
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true });
  }
}

async function ensureTemplateFiles(paths) {
  for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
    const filePath = path.join(paths.templatesDir, name);
    if (!(await exists(filePath))) await fs.writeFile(filePath, content, "utf8");
  }
}

async function ensureLayout(rootDir) {
  const paths = protocolPaths(rootDir);
  await Promise.all([
    fs.mkdir(paths.meetingsDir, { recursive: true }),
    fs.mkdir(paths.commandsDir, { recursive: true }),
    fs.mkdir(paths.eventsDir, { recursive: true }),
    fs.mkdir(paths.statesDir, { recursive: true }),
    fs.mkdir(paths.actionItemsDir, { recursive: true }),
    fs.mkdir(paths.decisionsDir, { recursive: true }),
    fs.mkdir(paths.minutesDir, { recursive: true }),
    fs.mkdir(paths.notificationsDir, { recursive: true }),
    fs.mkdir(paths.artifactsDir, { recursive: true }),
    fs.mkdir(paths.templatesDir, { recursive: true }),
    fs.mkdir(paths.indexDir, { recursive: true }),
    fs.mkdir(paths.dailyIndexDir, { recursive: true }),
    fs.mkdir(paths.weeklyIndexDir, { recursive: true }),
    fs.mkdir(paths.monthlyIndexDir, { recursive: true })
  ]);
  await ensureTemplateFiles(paths);
  return paths;
}

async function appendLine(filePath, line) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${line}\n`, "utf8");
}

async function appendJsonl(filePath, record) {
  await appendLine(filePath, JSON.stringify(record));
}

async function readJsonl(filePath) {
  if (!(await exists(filePath))) return [];
  const raw = await fs.readFile(filePath, "utf8");
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function appendMarkdown(filePath, section, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `\n## ${section}\n\n${String(text).trim()}\n`, "utf8");
}

async function appendEvent(paths, event) {
  const record = {
    schema_version: SCHEMA_VERSION,
    event_id: event.event_id || safeId("event"),
    ts: nowIso(),
    meeting_id: normalizeMeetingId(event.meeting_id),
    ...event
  };
  await appendJsonl(paths.eventsFile, record);
  return record;
}

async function appendCommand(paths, command) {
  const record = {
    schema_version: SCHEMA_VERSION,
    command_id: command.command_id || safeId("meetingcmd"),
    ts: nowIso(),
    status: "pending",
    ...command
  };
  await appendJsonl(paths.commandsFile, record);
  return record;
}

function buildMeetingMeta(input) {
  const meetingId = normalizeMeetingId(input.meetingId);
  const type = normalizeType(input.meetingType ?? input.meeting_type, "general");
  const participants = uniqueStrings(["main", ...asStringArray(input.participants)]);
  const observers = uniqueStrings(["cat_claw", ...asStringArray(input.observers)]);
  const notifyTargets = uniqueStrings(asStringArray(input.notifyTargets ?? input.notify_targets));
  return {
    schema_version: SCHEMA_VERSION,
    meeting_id: meetingId,
    meeting_type: type,
    title: requireText(input.title, "title"),
    status: String(input.status || "open").trim(),
    phase: String(input.phase || "opening").trim(),
    chair_agent: String(input.chairAgent || input.chair_agent || input.chair || "main").trim(),
    secretary_agent: String(input.secretaryAgent || input.secretary_agent || "cat_claw").trim(),
    participants,
    observers,
    visibility: normalizeMode(input.mode || input.visibility),
    human_gate_required: Boolean(input.humanGateRequired ?? input.human_gate_required ?? false),
    notify_targets: notifyTargets,
    telegram_target: String(input.telegramTarget ?? input.telegram_target ?? "").trim(),
    created_by: String(input.createdBy || input.created_by || input.chair || "main").trim(),
    created_at: nowIso(),
    closed_at: ""
  };
}

function renderMeetingMarkdown(meta, input) {
  return `# ${meta.title}

- meeting_id: ${meta.meeting_id}
- meeting_type: ${meta.meeting_type}
- status: ${meta.status}
- phase: ${meta.phase}
- chair_agent: ${meta.chair_agent}
- secretary_agent: ${meta.secretary_agent}
- participants: ${meta.participants.join(", ")}
- observers: ${meta.observers.join(", ")}
- created_at: ${meta.created_at}
- closed_at:
- telegram_target: ${meta.telegram_target || "unbound"}
- visibility: ${meta.visibility}
- human_gate_required: ${meta.human_gate_required}

## 0. 全局会议不变量

- 猫之脑 \`main\` 是所有正式会议默认主持人和控制面。
- 猫爪 \`cat_claw\` 是会议秘书型 agent，默认旁听、纪要、行动项、决策抽取、通知包和索引。
- Telegram 只作为透明直播、人类旁听、闪电猫介入和 Human Gate 前台，不作为 bot-to-bot 总线。
- 本会议不直接执行实盘下单，不绕过猫之尾风险决策和闪电猫 Human Gate。

## 1. 会议目标

${String(input.goal ?? input.purpose ?? "").trim() || "待补充。"}

## 2. 议程

${String(input.agenda ?? "- 待补充").trim()}

## 3. 讨论记录

## 4. Decisions

记录文件：\`decisions/${meta.meeting_id}.decisions.jsonl\`

## 5. Action Items

记录文件：\`action_items/${meta.meeting_id}.items.jsonl\`

## 6. Artifacts

目录：\`artifacts/${meta.meeting_id}/\`

## 7. Human Gate

强制项包括：制度生效、实盘策略上线、风险预算变更、高风险交易执行、角色权限变更、长期原则记忆写入、事故处置方案、月度原则调整、组织职责调整、自动化能力边界扩大。

## 8. Telegram 摘要

`;
}

async function readMeetingState(rootDir, meetingId) {
  const paths = protocolPaths(rootDir, meetingId);
  if (await exists(paths.stateFile)) return readJson(paths.stateFile);
  throw new Error(`meeting state not found: ${meetingId}`);
}

async function writeMeetingIndex(paths, meta) {
  await appendJsonl(paths.meetingsIndexFile, {
    schema_version: SCHEMA_VERSION,
    ts: nowIso(),
    event: "meeting.indexed",
    meeting_id: meta.meeting_id,
    meeting_type: meta.meeting_type,
    title: meta.title,
    status: meta.status,
    phase: meta.phase,
    chair_agent: meta.chair_agent,
    secretary_agent: meta.secretary_agent,
    human_gate_required: meta.human_gate_required,
    created_at: meta.created_at
  });
}

function latestById(records, idField) {
  const map = new Map();
  for (const record of records) {
    const id = record[idField];
    if (!id) continue;
    if (record.event === "create" || !map.has(id)) {
      map.set(id, { ...record });
      continue;
    }
    if (record.event === "update") {
      map.set(id, { ...map.get(id), ...record.updates, updated_at: record.ts });
    }
  }
  return [...map.values()];
}

async function listActionItemsFile(filePath) {
  return latestById(await readJsonl(filePath), "item_id");
}

async function listDecisionsFile(filePath) {
  return latestById(await readJsonl(filePath), "decision_id");
}

function notificationMarkdown(meetingId, payload) {
  return `# 会议通知

- 会议：${meetingId}
- 目标：${payload.target || "flashcat"}
- 状态：${payload.status || "pending"}
- 摘要：${payload.summary || payload.text || ""}
- 需要闪电猫确认：${payload.humanGateRequired || payload.human_gate_required ? "yes" : "no"}
- 风险：${payload.risk || ""}
- 相关 artifact：${asStringArray(payload.artifacts).join(", ") || "none"}
`;
}

export async function initProtocol(rootDir) {
  return withProtocolLock(rootDir, async () => {
    const paths = await ensureLayout(rootDir);
    return {
      schemaVersion: SCHEMA_VERSION,
      root: paths.root,
      meetingsDir: paths.meetingsDir,
      commandsDir: paths.commandsDir,
      eventsDir: paths.eventsDir,
      statesDir: paths.statesDir,
      actionItemsDir: paths.actionItemsDir,
      decisionsDir: paths.decisionsDir,
      minutesDir: paths.minutesDir,
      notificationsDir: paths.notificationsDir,
      artifactsDir: paths.artifactsDir,
      templatesDir: paths.templatesDir,
      indexDir: paths.indexDir
    };
  });
}

export async function status(rootDir) {
  const paths = await ensureLayout(rootDir);
  const [meetings, commands, states, minutes, notifications] = await Promise.all([
    fs.readdir(paths.meetingsDir).catch(() => []),
    fs.readdir(paths.commandsDir).catch(() => []),
    fs.readdir(paths.statesDir).catch(() => []),
    fs.readdir(paths.minutesDir).catch(() => []),
    fs.readdir(paths.notificationsDir).catch(() => [])
  ]);
  return {
    schemaVersion: SCHEMA_VERSION,
    root: paths.root,
    meetingsDir: paths.meetingsDir,
    commandsDir: paths.commandsDir,
    eventsDir: paths.eventsDir,
    statesDir: paths.statesDir,
    actionItemsDir: paths.actionItemsDir,
    decisionsDir: paths.decisionsDir,
    minutesDir: paths.minutesDir,
    notificationsDir: paths.notificationsDir,
    artifactsDir: paths.artifactsDir,
    templatesDir: paths.templatesDir,
    indexDir: paths.indexDir,
    meetingCount: meetings.filter((name) => name.endsWith(".md")).length,
    commandStreamCount: commands.filter((name) => name.endsWith(".jsonl")).length,
    stateCount: states.filter((name) => name.endsWith(".json")).length,
    minutesCount: minutes.filter((name) => name.endsWith(".md")).length,
    notificationStreamCount: notifications.filter((name) => name.endsWith(".jsonl")).length,
    workflow: await workflowStatus(rootDir).catch((error) => ({ available: false, error: error.message }))
  };
}

export async function createMeeting(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    await ensureLayout(rootDir);
    const meta = buildMeetingMeta(input);
    const paths = protocolPaths(rootDir, meta.meeting_id);
    if (await exists(paths.meetingFile)) throw new Error(`meeting already exists: ${meta.meeting_id}`);
    await fs.mkdir(paths.artifactDir, { recursive: true });
    await fs.writeFile(paths.meetingFile, renderMeetingMarkdown(meta, input), "utf8");
    await writeJson(paths.stateFile, meta);
    await writeMeetingIndex(protocolPaths(rootDir), meta);
    const command = await appendCommand(paths, {
      meeting_id: meta.meeting_id,
      source: "tool",
      from: meta.created_by,
      target: "main",
      type: "start_meeting",
      text: `Meeting created: ${meta.title}`,
      status: "accepted",
      metadata: { meeting_type: meta.meeting_type, visibility: meta.visibility, secretary_agent: meta.secretary_agent }
    });
    const event = await appendEvent(paths, {
      meeting_id: meta.meeting_id,
      event: "meeting.created",
      actor: meta.created_by,
      metadata: meta
    });
    return {
      ...meta,
      meetingFile: paths.meetingFile,
      commandsFile: paths.commandsFile,
      eventsFile: paths.eventsFile,
      stateFile: paths.stateFile,
      actionItemsFile: paths.actionItemsFile,
      decisionsFile: paths.decisionsFile,
      minutesFile: paths.minutesFile,
      notificationsFile: paths.notificationsFile,
      artifactDir: paths.artifactDir,
      artifactManifestFile: paths.artifactManifestFile,
      command,
      event
    };
  });
}

export async function appendMeeting(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const paths = protocolPaths(rootDir, input.meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const section = String(input.section || "讨论记录").trim();
    const actor = String(input.actor || input.from || "unknown").trim();
    const text = requireText(input.text, "text");
    await appendMarkdown(paths.meetingFile, `${section} / ${actor} / ${nowIso()}`, text);
    const event = await appendEvent(paths, {
      meeting_id: normalizeMeetingId(input.meetingId),
      event: "meeting.appended",
      actor,
      section,
      text
    });
    return { meetingId: normalizeMeetingId(input.meetingId), section, actor, meetingFile: paths.meetingFile, event };
  });
}

export async function recordCommand(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const paths = protocolPaths(rootDir, input.meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const type = String(input.type || "direction_change").trim();
    if (!COMMAND_TYPES.has(type)) throw new Error(`invalid command type: ${type}`);
    const command = await appendCommand(paths, {
      meeting_id: normalizeMeetingId(input.meetingId),
      source: String(input.source || "tool"),
      from: String(input.from || input.actor || "unknown"),
      target: String(input.target || "main"),
      type,
      text: requireText(input.text, "text"),
      priority: input.priority === "steer" ? "steer" : "normal",
      status: String(input.status || "pending"),
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
    });
    await appendEvent(paths, {
      meeting_id: normalizeMeetingId(input.meetingId),
      event: "meeting.command",
      actor: command.from,
      command_id: command.command_id,
      command_type: command.type
    });
    return command;
  });
}

export async function summarizeMeeting(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const paths = protocolPaths(rootDir, input.meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const summary = requireText(input.summary || input.text, "summary");
    await appendMarkdown(paths.meetingFile, `会议摘要 / ${nowIso()}`, summary);
    if (input.telegramText) await appendMarkdown(paths.meetingFile, `Telegram 摘要 / ${nowIso()}`, String(input.telegramText));
    await appendEvent(paths, {
      meeting_id: normalizeMeetingId(input.meetingId),
      event: "meeting.summary",
      actor: String(input.from || input.actor || "main"),
      summary
    });
    return { meetingId: normalizeMeetingId(input.meetingId), meetingFile: paths.meetingFile };
  });
}

export async function closeMeeting(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const summary = String(input.summary || "").trim();
    await appendMarkdown(paths.meetingFile, `会议关闭 / ${nowIso()}`, summary || "会议关闭。");
    const state = await readMeetingState(rootDir, meetingId).catch(() => null);
    if (state) {
      state.status = "closed";
      state.phase = "closed";
      state.closed_at = nowIso();
      state.closed_by = String(input.closedBy || input.actor || "main");
      await writeJson(paths.stateFile, state);
    }
    const command = await appendCommand(paths, {
      meeting_id: meetingId,
      source: "tool",
      from: String(input.closedBy || input.actor || "main"),
      target: "main",
      type: "close_meeting",
      text: summary || "close meeting",
      status: "accepted"
    });
    await appendEvent(paths, { meeting_id: meetingId, event: "meeting.closed", actor: command.from, summary });
    return { meetingId, meetingFile: paths.meetingFile, stateFile: paths.stateFile, command };
  });
}

export async function handoffMeeting(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const paths = protocolPaths(rootDir, input.meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const to = requireText(input.to || input.target, "to");
    const text = requireText(input.text || input.summary, "text");
    await appendMarkdown(paths.meetingFile, `Handoff / ${to} / ${nowIso()}`, text);
    const command = await appendCommand(paths, {
      meeting_id: normalizeMeetingId(input.meetingId),
      source: "tool",
      from: String(input.from || "main"),
      target: to,
      type: "direction_change",
      text,
      priority: input.priority === "steer" ? "steer" : "normal",
      status: "pending",
      metadata: { handoff: true }
    });
    await appendEvent(paths, { meeting_id: normalizeMeetingId(input.meetingId), event: "meeting.handoff", actor: command.from, target: to });
    return { meetingId: normalizeMeetingId(input.meetingId), to, command };
  });
}

export async function writeArtifact(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    await fs.mkdir(paths.artifactDir, { recursive: true });
    const name = String(input.name || `${String(input.kind || "artifact")}-${nowStamp()}.md`)
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-");
    if (!name || name.includes("..")) throw new Error(`invalid artifact name: ${input.name}`);
    const filePath = path.join(paths.artifactDir, name.endsWith(".md") ? name : `${name}.md`);
    const content = requireText(input.content || input.text, "content");
    await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    const manifest = {
      schema_version: SCHEMA_VERSION,
      artifact_id: safeId("artifact"),
      meeting_id: meetingId,
      kind: String(input.kind || "artifact"),
      path: path.relative(resolveProtocolRoot(rootDir), filePath),
      author_agent: String(input.authorAgent || input.author_agent || input.from || "unknown"),
      confidence: input.confidence === undefined ? null : Number(input.confidence),
      summary: String(input.summary || "").trim(),
      sha256: sha256(content),
      created_at: nowIso()
    };
    await appendJsonl(paths.artifactManifestFile, manifest);
    await appendMarkdown(paths.meetingFile, `Artifact / ${nowIso()}`, `- kind: ${manifest.kind}\n- path: \`${manifest.path}\`\n- sha256: ${manifest.sha256}\n- summary: ${manifest.summary}`);
    await appendEvent(paths, { meeting_id: meetingId, event: "meeting.artifact", actor: manifest.author_agent, artifact_id: manifest.artifact_id, kind: manifest.kind });
    return { meetingId, artifactPath: filePath, manifest };
  });
}

export async function recordHumanGate(rootDir, input) {
  const gateType = String(input.gateType || input.type || "").trim();
  if (!HUMAN_GATE_TYPES.has(gateType)) throw new Error(`invalid human gate type: ${gateType}`);
  const status = String(input.status || "pending").trim();
  const command = await recordCommand(rootDir, {
    ...input,
    type: status === "approved" ? "approve" : status === "rejected" ? "reject" : "human_gate_required",
    source: input.source || "human_gate",
    from: input.from || "闪电猫",
    target: input.target || "main",
    text: requireText(input.text || input.decision, "text"),
    metadata: {
      ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
      human_gate: true,
      gate_type: gateType,
      gate_status: status
    }
  });
  return command;
}

export async function telegramBridge(rootDir, input) {
  return recordCommand(rootDir, {
    meetingId: input.meetingId,
    source: "telegram",
    from: input.from || "telegram",
    target: input.target || "main",
    type: input.commandType || input.type || "direction_change",
    text: input.text,
    priority: input.priority,
    status: "pending",
    metadata: {
      telegram_bridge: true,
      chat_id: input.chatId ?? null,
      message_id: input.messageId ?? null,
      mention: input.mention ?? null
    }
  });
}

export async function meetingState(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    const state = await readMeetingState(rootDir, meetingId);
    const updates = {};
    for (const [inputKey, stateKey] of [
      ["status", "status"],
      ["phase", "phase"],
      ["visibility", "visibility"],
      ["chairAgent", "chair_agent"],
      ["chair_agent", "chair_agent"],
      ["secretaryAgent", "secretary_agent"],
      ["secretary_agent", "secretary_agent"]
    ]) {
      if (input[inputKey] !== undefined) updates[stateKey] = String(input[inputKey]).trim();
    }
    if (input.humanGateRequired !== undefined) updates.human_gate_required = Boolean(input.humanGateRequired);
    if (input.human_gate_required !== undefined) updates.human_gate_required = Boolean(input.human_gate_required);
    if (input.participants !== undefined) updates.participants = uniqueStrings(asStringArray(input.participants));
    if (input.observers !== undefined) updates.observers = uniqueStrings(asStringArray(input.observers));
    if (input.notifyTargets !== undefined || input.notify_targets !== undefined) {
      updates.notify_targets = uniqueStrings(asStringArray(input.notifyTargets ?? input.notify_targets));
    }
    if (Object.keys(updates).length > 0) {
      Object.assign(state, updates, { updated_at: nowIso(), updated_by: String(input.updatedBy || input.from || "tool") });
      await writeJson(paths.stateFile, state);
      await appendEvent(paths, { meeting_id: meetingId, event: "meeting.state", actor: state.updated_by, updates });
    }
    return state;
  });
}

export async function meetingActionItem(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const operation = String(input.operation || input.op || (input.itemId ? "update" : input.title ? "create" : "list"));
    if (operation === "list") {
      return { meetingId, items: await listActionItemsFile(paths.actionItemsFile) };
    }
    if (operation === "create") {
      const item = {
        schema_version: SCHEMA_VERSION,
        event: "create",
        ts: nowIso(),
        item_id: input.itemId || safeId("ai"),
        meeting_id: meetingId,
        title: requireText(input.title || input.text, "title"),
        owner_agent: normalizeAgentList(input.ownerAgent || input.owner_agent || input.owner, "main").join(","),
        status: String(input.status || "open"),
        depends_on: asStringArray(input.dependsOn || input.depends_on),
        required_artifact: String(input.requiredArtifact || input.required_artifact || ""),
        created_by: normalizeAgentAlias(input.createdBy || input.created_by || input.from || "cat_claw"),
        created_at: nowIso()
      };
      await appendJsonl(paths.actionItemsFile, item);
      await appendEvent(paths, { meeting_id: meetingId, event: "meeting.action_item.created", actor: item.created_by, item_id: item.item_id });
      const workflowTasks = await mirrorActionItemToWorkflowTasks(rootDir, meetingId, item, input);
      if (workflowTasks) item.workflow_tasks = workflowTasks;
      return item;
    }
    if (operation === "update") {
      const itemId = requireText(input.itemId || input.item_id, "itemId");
      const updates = {};
      for (const [inputKey, itemKey] of [
        ["title", "title"],
        ["status", "status"],
        ["result", "result"],
        ["ownerAgent", "owner_agent"],
        ["owner_agent", "owner_agent"],
        ["requiredArtifact", "required_artifact"],
        ["required_artifact", "required_artifact"]
      ]) {
        if (input[inputKey] !== undefined) updates[itemKey] = itemKey === "owner_agent" ? normalizeAgentList(input[inputKey], "main").join(",") : input[inputKey];
      }
      const record = {
        schema_version: SCHEMA_VERSION,
        event: "update",
        ts: nowIso(),
        meeting_id: meetingId,
        item_id: itemId,
        updates,
        updated_by: normalizeAgentAlias(input.updatedBy || input.from || "cat_claw")
      };
      await appendJsonl(paths.actionItemsFile, record);
      await appendEvent(paths, { meeting_id: meetingId, event: "meeting.action_item.updated", actor: record.updated_by, item_id: itemId, updates });
      const syntheticItem = {
        item_id: itemId,
        title: updates.title || input.title || input.text || itemId,
        owner_agent: updates.owner_agent || input.ownerAgent || input.owner_agent || "main",
        status: updates.status || input.status || "open",
        required_artifact: updates.required_artifact || input.requiredArtifact || input.required_artifact || "",
        depends_on: input.dependsOn || input.depends_on || []
      };
      const workflowTasks = await mirrorActionItemToWorkflowTasks(rootDir, meetingId, syntheticItem, input);
      if (workflowTasks) record.workflow_tasks = workflowTasks;
      return record;
    }
    throw new Error(`invalid action item operation: ${operation}`);
  });
}

export async function meetingDecision(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const operation = String(input.operation || input.op || (input.decisionId ? "update" : input.title ? "create" : "list"));
    if (operation === "list") {
      return { meetingId, decisions: await listDecisionsFile(paths.decisionsFile) };
    }
    if (operation === "create") {
      const humanGateRequired = Boolean(input.humanGateRequired ?? input.human_gate_required ?? false);
      const decision = {
        schema_version: SCHEMA_VERSION,
        event: "create",
        ts: nowIso(),
        decision_id: input.decisionId || safeId("decision"),
        meeting_id: meetingId,
        title: requireText(input.title || input.text, "title"),
        status: String(input.status || (humanGateRequired ? "pending_human_gate" : "proposed")),
        proposed_by: String(input.proposedBy || input.proposed_by || input.from || "main"),
        approved_by: input.approvedBy || input.approved_by || null,
        evidence: asStringArray(input.evidence),
        human_gate_required: humanGateRequired,
        created_at: nowIso()
      };
      await appendJsonl(paths.decisionsFile, decision);
      await appendEvent(paths, { meeting_id: meetingId, event: "meeting.decision.created", actor: decision.proposed_by, decision_id: decision.decision_id });
      return decision;
    }
    if (operation === "update") {
      const decisionId = requireText(input.decisionId || input.decision_id, "decisionId");
      const updates = {};
      for (const [inputKey, decisionKey] of [
        ["title", "title"],
        ["status", "status"],
        ["approvedBy", "approved_by"],
        ["approved_by", "approved_by"],
        ["result", "result"],
        ["rationale", "rationale"]
      ]) {
        if (input[inputKey] !== undefined) updates[decisionKey] = input[inputKey];
      }
      if (input.evidence !== undefined) updates.evidence = asStringArray(input.evidence);
      if (input.humanGateRequired !== undefined) updates.human_gate_required = Boolean(input.humanGateRequired);
      if (input.human_gate_required !== undefined) updates.human_gate_required = Boolean(input.human_gate_required);
      const record = {
        schema_version: SCHEMA_VERSION,
        event: "update",
        ts: nowIso(),
        meeting_id: meetingId,
        decision_id: decisionId,
        updates,
        updated_by: String(input.updatedBy || input.from || "cat_claw")
      };
      await appendJsonl(paths.decisionsFile, record);
      await appendEvent(paths, { meeting_id: meetingId, event: "meeting.decision.updated", actor: record.updated_by, decision_id: decisionId, updates });
      return record;
    }
    throw new Error(`invalid decision operation: ${operation}`);
  });
}

export async function meetingMinutes(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const state = await readMeetingState(rootDir, meetingId).catch(() => ({}));
    const items = await listActionItemsFile(paths.actionItemsFile);
    const decisions = await listDecisionsFile(paths.decisionsFile);
    const content = String(input.content || input.text || input.summary || "").trim() || `# 会议纪要

## 基本信息

- meeting_id: ${meetingId}
- meeting_type: ${state.meeting_type || "unknown"}
- chair_agent: ${state.chair_agent || "main"}
- secretary_agent: ${state.secretary_agent || "cat_claw"}
- status: ${state.status || "unknown"}
- phase: ${state.phase || "unknown"}

## 主要讨论

待补充。

## 决策

${decisions.length ? decisions.map((d) => `- [${d.status}] ${d.title} (${d.decision_id})`).join("\n") : "- 无"}

## 行动项

${items.length ? items.map((item) => `- [${item.status}] ${item.title} -> ${item.owner_agent} (${item.item_id})`).join("\n") : "- 无"}

## 需要闪电猫确认

${decisions.filter((d) => d.human_gate_required && !["approved", "rejected"].includes(d.status)).map((d) => `- ${d.title} (${d.decision_id})`).join("\n") || "- 无"}
`;
    const mode = String(input.mode || "write");
    if (mode === "append" && await exists(paths.minutesFile)) await appendMarkdown(paths.minutesFile, `更新 / ${nowIso()}`, content);
    else await fs.writeFile(paths.minutesFile, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    await appendEvent(paths, { meeting_id: meetingId, event: "meeting.minutes", actor: String(input.from || input.createdBy || "cat_claw") });
    return { meetingId, minutesFile: paths.minutesFile };
  });
}

export async function meetingNotify(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const record = {
      schema_version: SCHEMA_VERSION,
      notification_id: input.notificationId || safeId("notify"),
      ts: nowIso(),
      meeting_id: meetingId,
      target: String(input.target || "flashcat"),
      channel: String(input.channel || "telegram"),
      status: String(input.status || "pending"),
      summary: requireText(input.summary || input.text, "summary"),
      human_gate_required: Boolean(input.humanGateRequired ?? input.human_gate_required ?? false),
      risk: String(input.risk || ""),
      artifacts: asStringArray(input.artifacts),
      created_by: String(input.createdBy || input.from || "cat_claw"),
      markdown: notificationMarkdown(meetingId, input)
    };
    await appendJsonl(paths.notificationsFile, record);
    await appendEvent(paths, { meeting_id: meetingId, event: "meeting.notify", actor: record.created_by, notification_id: record.notification_id, target: record.target });
    return record;
  });
}

export async function meetingIndex(rootDir, input = {}) {
  const paths = await ensureLayout(rootDir);
  const records = await readJsonl(paths.meetingsIndexFile);
  const latest = latestById(records.map((record) => ({ ...record, event: record.event === "meeting.indexed" ? "create" : record.event })), "meeting_id");
  if (input.meetingId) return latest.find((record) => record.meeting_id === normalizeMeetingId(input.meetingId)) || null;
  return { root: paths.root, meetings: latest };
}

export async function meetingValidate(rootDir, input) {
  const meetingId = normalizeMeetingId(input.meetingId);
  const paths = protocolPaths(rootDir, meetingId);
  const findings = [];
  const ok = (condition, code, severity, message) => {
    if (!condition) findings.push({ code, severity, message });
  };
  ok(await exists(paths.meetingFile), "missing_meeting_file", "error", "meeting markdown is missing");
  ok(await exists(paths.stateFile), "missing_state_file", "error", "state json is missing");
  ok(await exists(paths.minutesFile), "missing_minutes", "warning", "minutes file is missing");
  const state = await readMeetingState(rootDir, meetingId).catch(() => null);
  if (state) {
    ok(Boolean(state.chair_agent), "missing_chair", "error", "chair_agent is required");
    ok(Boolean(state.secretary_agent), "missing_secretary", "warning", "secretary_agent is required");
    ok(Boolean(state.meeting_type), "missing_meeting_type", "error", "meeting_type is required");
  }
  const actionItems = await listActionItemsFile(paths.actionItemsFile);
  const openItems = actionItems.filter((item) => !["done", "closed", "cancelled"].includes(String(item.status)));
  if (openItems.length > 0) findings.push({ code: "open_action_items", severity: "info", message: `${openItems.length} action item(s) still open` });
  const decisions = await listDecisionsFile(paths.decisionsFile);
  const pendingHuman = decisions.filter((decision) => decision.human_gate_required && !["approved", "rejected"].includes(String(decision.status)));
  if (pendingHuman.length > 0) findings.push({ code: "pending_human_gate", severity: "warning", message: `${pendingHuman.length} Human Gate decision(s) pending` });
  if (state && TRADING_RELATED_TYPES.has(state.meeting_type)) {
    const manifest = await readJsonl(paths.artifactManifestFile);
    const kinds = new Set(manifest.map((item) => item.kind));
    if (["research", "research_meeting"].includes(state.meeting_type)) {
      ok(kinds.has("evidence_pack") || kinds.has("research_memo"), "missing_research_artifact", "warning", "research meeting should have evidence_pack or research_memo");
    }
    if (["risk", "risk_review"].includes(state.meeting_type)) {
      ok(kinds.has("risk_decision"), "missing_risk_decision", "warning", "risk meeting should have risk_decision artifact");
    }
  }
  return { meetingId, valid: !findings.some((finding) => finding.severity === "error"), findings };
}

export async function cat_clawObserve(rootDir, input) {
  return withProtocolLock(rootDir, async () => {
    const meetingId = normalizeMeetingId(input.meetingId);
    const paths = protocolPaths(rootDir, meetingId);
    if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
    const event = await appendEvent(paths, {
      meeting_id: meetingId,
      event: "cat_claw.observe",
      actor: "cat_claw",
      text: String(input.text || input.note || ""),
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {}
    });
    if (input.text || input.note) await appendMarkdown(paths.meetingFile, `猫爪旁听 / ${nowIso()}`, String(input.text || input.note));
    return event;
  });
}

export async function cat_clawDigest(rootDir, input = {}) {
  const paths = await ensureLayout(rootDir);
  const period = String(input.period || "daily");
  const date = input.date ? new Date(input.date) : new Date();
  const meetings = (await meetingIndex(rootDir)).meetings;
  const key = period === "monthly" ? monthKey(date) : period === "weekly" ? weekKey(date) : dailyKey(date);
  const filePath = period === "monthly"
    ? path.join(paths.monthlyIndexDir, `${key}.md`)
    : period === "weekly"
      ? path.join(paths.weeklyIndexDir, `${key}.md`)
      : path.join(paths.dailyIndexDir, `${key}.md`);
  const title = period === "monthly" ? "月度会议摘要" : period === "weekly" ? "周会议摘要" : "日会议摘要";
  const content = `# ${title} ${key}

生成者：cat_claw

## 会议列表

${meetings.length ? meetings.map((meeting) => `- [${meeting.status}] ${meeting.meeting_id} / ${meeting.meeting_type} / ${meeting.title}`).join("\n") : "- 无"}

## 待处理 Human Gate

${meetings.filter((meeting) => meeting.human_gate_required).map((meeting) => `- ${meeting.meeting_id} / ${meeting.title}`).join("\n") || "- 无"}
`;
  await fs.writeFile(filePath, content, "utf8");
  return { period, key, digestFile: filePath, meetingCount: meetings.length };
}

export async function showMeeting(rootDir, input) {
  const paths = protocolPaths(rootDir, input.meetingId);
  if (!(await exists(paths.meetingFile))) throw new Error(`meeting not found: ${input.meetingId}`);
  const text = await fs.readFile(paths.meetingFile, "utf8");
  return { meetingId: normalizeMeetingId(input.meetingId), meetingFile: paths.meetingFile, text };
}

export async function listMeetings(rootDir) {
  const paths = await ensureLayout(rootDir);
  const files = await fs.readdir(paths.meetingsDir).catch(() => []);
  return files.filter((name) => name.endsWith(".md")).sort().map((name) => ({
    meetingId: name.replace(/\.md$/, ""),
    meetingFile: path.join(paths.meetingsDir, name)
  }));
}

export async function runAction(rootDir, input = {}) {
  const action = String(input.action || "status");
  if (
    action.startsWith("workflow.") ||
    action.startsWith("trading_workflow.") ||
    action.startsWith("instrument.") ||
    action.startsWith("tracking.") ||
    action.startsWith("radar.") ||
    action.startsWith("thesis.") ||
    action.startsWith("research.") ||
    action.startsWith("gate.") ||
    action.startsWith("protocol.") ||
    action.startsWith("trade.") ||
    action.startsWith("risk.") ||
    action.startsWith("trading_core.") ||
    action.startsWith("execution.") ||
    action.startsWith("runtime.") ||
    action.startsWith("side_effect.") ||
    action.startsWith("incident.") ||
    action === "telegram.live" ||
    action === "telegram.live.configure" ||
    action === "telegram.outbox" ||
    action === "meeting.runtime_participant" ||
    action === "meeting.dispatch" ||
    action === "meeting.ingest" ||
    action === "meeting.resume" ||
    action === "meeting.disperse" ||
    action === "human_gate.request" ||
    action === "human_gate.resume" ||
    action === "human_gate.confirm" ||
    action === "human_gate.inbox" ||
    action === "human_gate.batch_inbox" ||
    action === "human_gate.review" ||
    (action === "human_gate.record" && !input.meetingId && !input.meeting_id) ||
    action === "cat_claw.audit"
  ) {
    return runWorkflowAction(rootDir, input);
  }
  switch (action) {
    case "init":
      return initProtocol(rootDir);
    case "status":
      return status(rootDir);
    case "meeting.create":
    case "create_meeting":
    case "open_meeting":
      return createMeeting(rootDir, input);
    case "meeting.append":
    case "append_meeting":
    case "append_note":
      return appendMeeting(rootDir, input);
    case "meeting.command":
    case "record_command":
      return recordCommand(rootDir, input);
    case "meeting.summary":
    case "summarize_meeting":
      return summarizeMeeting(rootDir, input);
    case "meeting.close":
    case "close_meeting":
      return closeMeeting(rootDir, input);
    case "meeting.handoff":
    case "handoff_meeting":
      return handoffMeeting(rootDir, input);
    case "meeting.artifact":
    case "write_artifact":
      return writeArtifact(rootDir, input);
    case "human_gate.record":
    case "record_human_gate":
      return recordHumanGate(rootDir, input);
    case "telegram.bridge":
    case "telegram_bridge":
      return telegramBridge(rootDir, input);
    case "meeting.state":
      return meetingState(rootDir, input);
    case "meeting.action_item":
    case "meeting.action-item":
      return meetingActionItem(rootDir, input);
    case "meeting.decision":
      return meetingDecision(rootDir, input);
    case "meeting.minutes":
      return meetingMinutes(rootDir, input);
    case "meeting.notify":
      return meetingNotify(rootDir, input);
    case "meeting.index":
      return meetingIndex(rootDir, input);
    case "meeting.validate":
      return meetingValidate(rootDir, input);
    case "cat_claw.observe":
      return cat_clawObserve(rootDir, input);
    case "cat_claw.minutes":
      return meetingMinutes(rootDir, { ...input, from: input.from || "cat_claw" });
    case "cat_claw.digest":
      return cat_clawDigest(rootDir, input);
    case "cat_claw.notify":
      return meetingNotify(rootDir, { ...input, from: input.from || "cat_claw" });
    case "meeting.show":
    case "show_meeting":
      return showMeeting(rootDir, input);
    case "meeting.list":
    case "list_meetings":
      return listMeetings(rootDir);
    default:
      throw new Error(`unknown action: ${action}`);
  }
}
