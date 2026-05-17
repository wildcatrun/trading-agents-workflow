import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const WORKFLOW_SCHEMA_VERSION = 6;
export const DEFAULT_WORKFLOW_ROOT = "/home/flashcat/.openclaw/shared/trading-agents-workflow";

const ASSET_TYPES = new Set(["stock", "futures", "crypto", "forex", "etf", "index", "commodity", "other"]);
const THESIS_STATUSES = new Set(["draft", "active", "watch", "stale", "invalidated", "closed"]);
const RADAR_ZONES = new Set(["bright", "dark", "overheated", "dead_water", "watch_only", "risk_avoid", "unknown"]);
const GATE_STATUSES = new Set(["pending", "approved", "rejected", "waived"]);
const PROTOCOL_OBJECT_TYPES = new Set(["research_signal", "evidence_pack", "research_memo", "trade_proposal", "risk_decision", "human_gate_record", "simulation_request", "simulation_result", "executable_trade_intent", "trading_core_receipt", "execution_audit_summary", "generic"]);
const RISK_DECISION_STATUSES = new Set(["pending", "approved", "rejected", "revise_required"]);
const HUMAN_GATE_STATUSES = new Set(["pending", "approved", "rejected", "expired"]);
const TRADE_SIDES = new Set(["buy", "sell", "short", "cover", "reduce", "close"]);
const ORDER_TYPES = new Set(["market", "limit", "stop", "stop_limit", "twap", "vwap"]);
const RECEIPT_STATUSES = new Set(["accepted", "rejected", "submitted", "filled", "partial", "cancelled", "failed"]);
const RUNTIMES = new Set(["openclaw", "openclaw_route_shell", "hermes", "hermes_acp", "telegram", "local_codex", "codex", "claude_code", "claude-code", "opencode", "trading_sim", "trading_core", "system", "other"]);
const DISPATCH_STATUSES = new Set(["queued", "sent", "acked", "failed", "cancelled"]);
const WORKFLOW_RUN_STATUSES = new Set(["active", "waiting_human", "blocked", "completed", "stopped", "cancelled"]);
const WORKFLOW_TASK_STATUSES = new Set(["pending", "in_progress", "done", "blocked", "failed", "cancelled"]);
const WORKFLOW_TASK_PRIORITIES = new Set(["steer", "high", "normal", "low"]);
const INCIDENT_STATUSES = new Set(["active", "mitigating", "monitoring", "resolved", "cancelled"]);
const INCIDENT_MODES = new Set(["normal", "degraded", "critical-only", "paper-only", "frozen"]);
const AUTO_RETRY_FAILURE_TYPES = new Set(["provider_timeout", "runtime_timeout", "acp_unavailable", "transient_runtime"]);

function nowIso() {
  return new Date().toISOString();
}

function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function safeId(prefix) {
  return `${prefix}.${Date.now().toString(36)}.${randomUUID().slice(0, 8)}`;
}

function resolveHome(value) {
  if (value && value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value ? path.resolve(value) : value;
}

export function resolveWorkflowRoot(rootDir, input = {}) {
  const explicit = input.workflowRootDir || input.workflow_root || process.env.TRADING_AGENTS_WORKFLOW_ROOT;
  if (explicit) return resolveHome(String(explicit));
  const candidate = rootDir || process.env.CAT_MEETING_GOVERNANCE_ROOT;
  if (candidate) return resolveHome(String(candidate));
  return DEFAULT_WORKFLOW_ROOT;
}

export function workflowPaths(rootDir, input = {}) {
  const root = resolveWorkflowRoot(rootDir, input);
  return {
    root,
    dbFile: path.join(root, "tracking.db"),
    researchDir: path.join(root, "research"),
    thesisDir: path.join(root, "thesis"),
    radarDir: path.join(root, "radar"),
    evidenceDir: path.join(root, "evidence"),
    memosDir: path.join(root, "memos"),
    gatesDir: path.join(root, "gates"),
    artifactsDir: path.join(root, "artifacts"),
    checkpointsDir: path.join(root, "workflows", "checkpoints"),
    protocolDir: path.join(root, "protocol"),
    intentsDir: path.join(root, "intents"),
    receiptsDir: path.join(root, "receipts"),
    bridgeDir: path.join(root, "bridge"),
    dispatchesDir: path.join(root, "bridge", "dispatches"),
    messagesDir: path.join(root, "bridge", "messages"),
    telegramDir: path.join(root, "bridge", "telegram"),
    humanGateDir: path.join(root, "bridge", "human_gates"),
    workflowsDir: path.join(root, "workflows"),
    templatesDir: path.join(root, "templates"),
    exportsDir: path.join(root, "exports"),
    indexDir: path.join(root, "index")
  };
}

function normalizeAssetType(value) {
  const assetType = String(value || "stock").trim().toLowerCase();
  return ASSET_TYPES.has(assetType) ? assetType : "other";
}

function normalizeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!symbol) throw new Error("symbol is required");
  if (!/^[A-Z0-9._:/=-]{1,64}$/.test(symbol)) throw new Error(`invalid symbol: ${value}`);
  return symbol;
}

function instrumentId(assetType, symbol) {
  return `${normalizeAssetType(assetType)}:${normalizeSymbol(symbol)}`;
}

function toList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseJsonValue(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readTelegramTargetConfig(paths) {
  const files = [
    path.join(paths.root, "telegram-targets.json"),
    path.join(paths.root, "config", "telegram-targets.json")
  ];
  for (const file of files) {
    const config = await readOptionalJson(file);
    if (config && typeof config === "object") return config;
  }
  return {};
}

function targetValue(entry) {
  if (typeof entry === "string") return { chatId: entry, channelId: "" };
  if (!entry || typeof entry !== "object") return { chatId: "", channelId: "" };
  return {
    chatId: String(entry.chatId || entry.chat_id || entry.chat || "").trim(),
    channelId: String(entry.channelId || entry.channel_id || entry.channel || "").trim(),
    humanGateChannelId: String(entry.humanGateChannelId || entry.human_gate_channel_id || "").trim()
  };
}

function lookupTelegramAlias(config, key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return null;
  const aliases = config.aliases || config.targets || {};
  const entry = aliases[trimmed] || aliases[trimmed.toLowerCase()];
  return entry ? targetValue(entry) : null;
}

async function resolveTelegramLiveTarget(paths, meetingId, input) {
  const direct = {
    chatId: String(input.chatId || input.chat_id || "").trim(),
    channelId: String(input.channelId || input.channel_id || "").trim(),
    humanGateChannelId: String(input.humanGateChannelId || input.human_gate_channel_id || "").trim()
  };
  if (direct.chatId || direct.channelId) return { ...direct, source: "input" };

  const config = await readTelegramTargetConfig(paths);
  const targetKeys = [
    input.targetRef,
    input.target_ref,
    input.target,
    input.targetName,
    input.target_name,
    input.telegramTarget,
    input.telegram_target,
    input.groupName,
    input.group_name
  ];
  for (const key of targetKeys) {
    const match = lookupTelegramAlias(config, key);
    if (match && (match.chatId || match.channelId)) return { ...match, source: "alias" };
  }

  const rules = config.meetingPatterns || config.meeting_patterns || [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const pattern = String(rule.pattern || rule.match || "").trim();
    if (!pattern) continue;
    const flags = rule.caseSensitive || rule.case_sensitive ? "" : "i";
    if (new RegExp(pattern, flags).test(meetingId)) {
      const match = targetValue(rule);
      if (match.chatId || match.channelId) return { ...match, source: "meeting_pattern" };
    }
  }

  const fallback = targetValue(config.default || config.defaultTarget || config.default_target);
  if (fallback.chatId || fallback.channelId) return { ...fallback, source: "default" };
  return { ...direct, source: "unresolved" };
}

function jsonHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function textHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeRuntime(value) {
  const runtime = String(value || "openclaw").trim().toLowerCase();
  return RUNTIMES.has(runtime) ? runtime : "other";
}

function normalizeAgentId(value) {
  const agentId = String(value || "").trim();
  if (!agentId) throw new Error("agentId is required");
  return agentId.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 96);
}

function runtimeAgentKey(runtime, agentId) {
  return `${normalizeRuntime(runtime)}:${normalizeAgentId(agentId)}`;
}

function normalizeMeetingRef(value) {
  const meetingId = String(value || "").trim();
  if (!meetingId) throw new Error("meetingId is required");
  return cleanFileSegment(meetingId).slice(0, 120);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function cleanFileSegment(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "item";
}

async function sqlite(dbFile, sql, { json = false } = {}) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
    const args = json ? ["-cmd", ".timeout 5000", "-json", dbFile, sql] : ["-cmd", ".timeout 5000", dbFile, sql];
  try {
    const { stdout } = await execFileAsync("sqlite3", args, { maxBuffer: 10 * 1024 * 1024 });
    if (!json) return stdout;
    const text = stdout.trim();
    return text ? JSON.parse(text) : [];
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("sqlite3 CLI is required for trading-agents-workflow v0.6");
    }
    throw error;
  }
}

async function tableColumns(dbFile, tableName) {
  const rows = await sqlite(dbFile, `PRAGMA table_info(${tableName});`, { json: true });
  return new Set(rows.map((row) => row.name));
}

async function ensureColumns(dbFile, tableName, columns) {
  const existing = await tableColumns(dbFile, tableName);
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      await sqlite(dbFile, `ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition};`);
    }
  }
}

async function ensureWorkflowLayout(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  await Promise.all([
    fs.mkdir(paths.researchDir, { recursive: true }),
    fs.mkdir(paths.thesisDir, { recursive: true }),
    fs.mkdir(paths.radarDir, { recursive: true }),
    fs.mkdir(paths.evidenceDir, { recursive: true }),
    fs.mkdir(paths.memosDir, { recursive: true }),
    fs.mkdir(paths.gatesDir, { recursive: true }),
    fs.mkdir(paths.artifactsDir, { recursive: true }),
    fs.mkdir(paths.checkpointsDir, { recursive: true }),
    fs.mkdir(paths.protocolDir, { recursive: true }),
    fs.mkdir(paths.intentsDir, { recursive: true }),
    fs.mkdir(paths.receiptsDir, { recursive: true }),
    fs.mkdir(paths.bridgeDir, { recursive: true }),
    fs.mkdir(paths.dispatchesDir, { recursive: true }),
    fs.mkdir(paths.messagesDir, { recursive: true }),
    fs.mkdir(paths.telegramDir, { recursive: true }),
    fs.mkdir(paths.humanGateDir, { recursive: true }),
    fs.mkdir(paths.workflowsDir, { recursive: true }),
    fs.mkdir(paths.templatesDir, { recursive: true }),
    fs.mkdir(paths.exportsDir, { recursive: true }),
    fs.mkdir(paths.indexDir, { recursive: true })
  ]);
  await initDatabase(paths.dbFile);
  await ensureWorkflowTemplates(paths);
  return paths;
}

async function ensureWorkflowTemplates(paths) {
  const templates = {
    "thesis-card.md": "# Thesis Card\n\n## Thesis\n\n## Evidence\n\n## Falsification Triggers\n\n## Next Review\n",
    "evidence-pack.md": "# Evidence Pack\n\n## Source\n\n## Summary\n\n## Supports\n\n## Conflicts\n",
    "research-memo.md": "# Research Memo\n\n## Question\n\n## Evidence\n\n## Conclusion\n\n## Next Steps\n"
  };
  for (const [name, content] of Object.entries(templates)) {
    const filePath = path.join(paths.templatesDir, name);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, content, "utf8");
    }
  }
}

async function initDatabase(dbFile) {
  const schema = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS instruments (
  instrument_id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  exchange TEXT,
  currency TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instruments_asset_symbol ON instruments(asset_type, symbol);
CREATE TABLE IF NOT EXISTS tracking_states (
  instrument_id TEXT PRIMARY KEY REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  research_state TEXT,
  radar_zone TEXT,
  retail_heat_score REAL,
  news_catalyst_score REAL,
  fundamental_score REAL,
  sentiment_stage TEXT,
  fundamental_trend TEXT,
  valuation_state TEXT,
  thesis_status TEXT,
  thesis_path TEXT,
  last_evidence_at TEXT,
  last_memo_at TEXT,
  last_review_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_scores (
  score_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  radar_zone TEXT,
  retail_heat_score REAL,
  news_catalyst_score REAL,
  fundamental_score REAL,
  sentiment_stage TEXT,
  source_reliability TEXT,
  catalyst_window TEXT,
  fundamental_trend TEXT,
  valuation_state TEXT,
  confidence TEXT,
  summary TEXT,
  evidence_paths_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_radar_scores_instrument_asof ON radar_scores(instrument_id, as_of DESC);
CREATE TABLE IF NOT EXISTS thesis_index (
  thesis_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  title TEXT,
  path TEXT NOT NULL,
  summary TEXT,
  falsification_triggers TEXT,
  owner_agent TEXT NOT NULL,
  review_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thesis_instrument ON thesis_index(instrument_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source TEXT,
  reliability TEXT,
  path TEXT NOT NULL,
  summary TEXT,
  supports TEXT,
  conflicts TEXT,
  captured_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_instrument ON evidence_items(instrument_id, captured_at DESC);
CREATE TABLE IF NOT EXISTS research_memos (
  memo_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  memo_type TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  conclusion TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memos_instrument ON research_memos(instrument_id, created_at DESC);
CREATE TABLE IF NOT EXISTS review_gates (
  gate_id TEXT PRIMARY KEY,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  workflow_id TEXT,
  gate_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  reviewer_agent TEXT,
  human_gate_required INTEGER NOT NULL DEFAULT 0,
  resume_pointer TEXT,
  expires_at TEXT,
  decision_at TEXT,
  approver TEXT,
  evidence_paths_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  workflow_id TEXT PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  owner_agent TEXT NOT NULL,
  summary TEXT,
  objective TEXT,
  acceptance_criteria TEXT,
  stop_condition TEXT,
  current_phase TEXT,
  current_decision TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_tasks (
  task_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  parent_task_id TEXT,
  phase TEXT,
  owner_agent TEXT NOT NULL,
  runtime TEXT,
  agent_id TEXT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  expected_artifact TEXT,
  actual_artifact_ref TEXT,
  receipt_required INTEGER NOT NULL DEFAULT 1,
  human_gate_required INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  blocked_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  due_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_workflow ON workflow_tasks(workflow_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_owner ON workflow_tasks(owner_agent, status, created_at);
CREATE TABLE IF NOT EXISTS workflow_task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id, depends_on_task_id),
  FOREIGN KEY(task_id) REFERENCES workflow_tasks(task_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends ON workflow_task_dependencies(depends_on_task_id);
CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT,
  decision TEXT,
  summary TEXT,
  resume_payload_json TEXT NOT NULL,
  active_tasks_json TEXT NOT NULL DEFAULT '[]',
  blocked_tasks_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  next_actions_json TEXT NOT NULL DEFAULT '[]',
  context_budget_json TEXT NOT NULL DEFAULT '{}',
  path TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_workflow ON workflow_checkpoints(workflow_id, created_at DESC);
CREATE TABLE IF NOT EXISTS artifact_index (
  artifact_id TEXT PRIMARY KEY,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  workflow_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS protocol_objects (
  object_id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  status TEXT NOT NULL,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  source_system TEXT,
  source_agent TEXT,
  parent_object_id TEXT,
  path TEXT,
  payload_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_protocol_objects_type_status ON protocol_objects(object_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_protocol_objects_instrument ON protocol_objects(instrument_id, created_at DESC);
CREATE TABLE IF NOT EXISTS executable_trade_intents (
  intent_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL,
  order_type TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  risk_decision_id TEXT NOT NULL,
  human_gate_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  actor TEXT NOT NULL,
  assurance TEXT NOT NULL,
  client_cert_fingerprint TEXT,
  idempotency_key TEXT,
  intent_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_intents_idempotency ON executable_trade_intents(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_trade_intents_status ON executable_trade_intents(status, created_at DESC);
CREATE TABLE IF NOT EXISTS trading_core_receipts (
  receipt_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES executable_trade_intents(intent_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trading_core_ref TEXT,
  source_system TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_core_receipts_intent ON trading_core_receipts(intent_id, created_at DESC);
CREATE TABLE IF NOT EXISTS side_effect_ledger (
  side_effect_id TEXT PRIMARY KEY,
  trace_id TEXT,
  workflow_id TEXT,
  dispatch_id TEXT,
  idempotency_key TEXT,
  owner_agent TEXT,
  side_effect_type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_hash TEXT,
  output_hash TEXT,
  artifact_ref TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_agents (
  agent_key TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  display_name TEXT,
  role TEXT,
  status TEXT NOT NULL,
  endpoint_ref TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_agents_runtime_id ON runtime_agents(runtime, agent_id);
CREATE TABLE IF NOT EXISTS mixed_meeting_participants (
  meeting_id TEXT NOT NULL,
  agent_key TEXT NOT NULL REFERENCES runtime_agents(agent_key) ON DELETE CASCADE,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  participant_role TEXT NOT NULL,
  chair INTEGER NOT NULL DEFAULT 0,
  decider INTEGER NOT NULL DEFAULT 0,
  secretary INTEGER NOT NULL DEFAULT 0,
  live_mode TEXT NOT NULL DEFAULT 'transparent',
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(meeting_id, agent_key)
);
CREATE INDEX IF NOT EXISTS idx_mixed_participants_meeting ON mixed_meeting_participants(meeting_id, runtime, agent_id);
CREATE TABLE IF NOT EXISTS mixed_meeting_messages (
  message_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_key TEXT,
  message_type TEXT NOT NULL,
  phase TEXT,
  text TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  telegram_live_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mixed_messages_meeting ON mixed_meeting_messages(meeting_id, created_at);
CREATE TABLE IF NOT EXISTS mixed_meeting_dispatches (
  dispatch_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  workflow_id TEXT,
  trace_id TEXT,
  idempotency_key TEXT,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_key TEXT,
  dispatch_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  next_retry_at TEXT,
  failure_type TEXT,
  last_error TEXT,
  prompt TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  acked_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mixed_dispatches_status ON mixed_meeting_dispatches(status, runtime, created_at);
CREATE TABLE IF NOT EXISTS runtime_runs (
  runtime_run_id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  workflow_id TEXT,
  trace_id TEXT,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  backend TEXT,
  acp_agent TEXT,
  session_key TEXT,
  status TEXT NOT NULL,
  failure_type TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  latency_ms INTEGER,
  message_id TEXT,
  input_hash TEXT,
  output_hash TEXT,
  error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_dispatch ON runtime_runs(dispatch_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_trace ON runtime_runs(trace_id, started_at DESC);
CREATE TABLE IF NOT EXISTS telegram_live_links (
  meeting_id TEXT PRIMARY KEY,
  chat_id TEXT,
  channel_id TEXT,
  mode TEXT NOT NULL DEFAULT 'transparent',
  status TEXT NOT NULL DEFAULT 'active',
  human_gate_channel_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_outbox (
  outbox_id TEXT PRIMARY KEY,
  meeting_id TEXT,
  target_kind TEXT NOT NULL,
  target_ref TEXT,
  message_type TEXT NOT NULL,
  status TEXT NOT NULL,
  text TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_outbox_status ON telegram_outbox(status, created_at);
CREATE TABLE IF NOT EXISTS meeting_control_events (
  event_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_control_events_meeting ON meeting_control_events(meeting_id, created_at);
CREATE TABLE IF NOT EXISTS incident_states (
  incident_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  affected_planes_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  commander TEXT,
  impact TEXT,
  current_hypothesis TEXT,
  mitigation TEXT,
  rollback_options TEXT,
  exit_criteria TEXT,
  timeline_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  declared_at TEXT NOT NULL,
  next_update_at TEXT,
  resolved_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS readiness_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  planes_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO schema_meta(key, value, updated_at)
VALUES ('workflow_schema_version', ${sqlValue(WORKFLOW_SCHEMA_VERSION)}, ${sqlValue(nowIso())})
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
`;
  await sqlite(dbFile, schema);
  await migrateDatabase(dbFile);
}

async function migrateDatabase(dbFile) {
  await ensureColumns(dbFile, "workflow_runs", [
    ["objective", "TEXT"],
    ["acceptance_criteria", "TEXT"],
    ["stop_condition", "TEXT"],
    ["current_phase", "TEXT"],
    ["current_decision", "TEXT"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"]
  ]);
  await ensureColumns(dbFile, "review_gates", [
    ["resume_pointer", "TEXT"],
    ["expires_at", "TEXT"],
    ["decision_at", "TEXT"],
    ["approver", "TEXT"]
  ]);
  await ensureColumns(dbFile, "mixed_meeting_dispatches", [
    ["workflow_id", "TEXT"],
    ["trace_id", "TEXT"],
    ["idempotency_key", "TEXT"],
    ["attempt", "INTEGER NOT NULL DEFAULT 0"],
    ["max_attempts", "INTEGER NOT NULL DEFAULT 1"],
    ["next_retry_at", "TEXT"],
    ["failure_type", "TEXT"],
    ["last_error", "TEXT"],
    ["sent_at", "TEXT"],
    ["acked_at", "TEXT"],
    ["completed_at", "TEXT"]
  ]);
  await sqlite(dbFile, `
CREATE UNIQUE INDEX IF NOT EXISTS idx_mixed_dispatches_idempotency ON mixed_meeting_dispatches(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_mixed_dispatches_trace ON mixed_meeting_dispatches(trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mixed_dispatches_retry ON mixed_meeting_dispatches(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_side_effects_idempotency ON side_effect_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_incident_states_status ON incident_states(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_readiness_snapshots_checked ON readiness_snapshots(checked_at DESC);
`);
}

async function upsertInstrumentRecord(paths, input) {
  const assetType = normalizeAssetType(input.assetType || input.asset_type);
  const symbol = normalizeSymbol(input.symbol);
  const id = input.instrumentId || input.instrument_id || instrumentId(assetType, symbol);
  const createdAt = nowIso();
  const name = String(input.name || "").trim();
  const status = String(input.instrumentStatus || input.instrument_status || "active");
  const sql = `
INSERT INTO instruments(instrument_id, asset_type, symbol, name, exchange, currency, aliases_json, tags_json, status, created_at, updated_at)
VALUES (${sqlValue(id)}, ${sqlValue(assetType)}, ${sqlValue(symbol)}, ${sqlValue(name)}, ${sqlValue(input.exchange || "")}, ${sqlValue(input.currency || "")}, ${sqlValue(JSON.stringify(toList(input.aliases)))}, ${sqlValue(JSON.stringify(toList(input.tags)))}, ${sqlValue(status)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(instrument_id) DO UPDATE SET
  name=COALESCE(NULLIF(excluded.name,''), instruments.name),
  exchange=COALESCE(NULLIF(excluded.exchange,''), instruments.exchange),
  currency=COALESCE(NULLIF(excluded.currency,''), instruments.currency),
  aliases_json=CASE WHEN excluded.aliases_json='[]' THEN instruments.aliases_json ELSE excluded.aliases_json END,
  tags_json=CASE WHEN excluded.tags_json='[]' THEN instruments.tags_json ELSE excluded.tags_json END,
  status=CASE WHEN ${sqlValue(Boolean(input.instrumentStatus || input.instrument_status))}=1 THEN excluded.status ELSE instruments.status END,
  updated_at=excluded.updated_at;`;
  await sqlite(paths.dbFile, sql);
  return { instrumentId: id, assetType, symbol, name };
}

async function readInstrument(paths, input) {
  const id = input.instrumentId || input.instrument_id || instrumentId(input.assetType || input.asset_type, input.symbol);
  const rows = await sqlite(paths.dbFile, `SELECT * FROM instruments WHERE instrument_id=${sqlValue(id)} LIMIT 1;`, { json: true });
  return rows[0] || null;
}

function relativeTo(root, filePath) {
  return path.relative(root, filePath);
}

function renderThesisMarkdown(record, input) {
  return `# ${record.title || `${record.symbol} Thesis`}

- instrument_id: ${record.instrumentId}
- asset_type: ${record.assetType}
- symbol: ${record.symbol}
- status: ${record.status}
- owner_agent: ${record.ownerAgent}
- updated_at: ${record.updatedAt}

## Thesis Summary

${record.summary || "待补充。"}

## Evidence

${String(input.evidence || input.evidenceSummary || "待补充。").trim()}

## Falsification Triggers

${record.falsificationTriggers || "待补充。"}

## Key Metrics To Watch

${String(input.keyMetricsToWatch || input.key_metrics_to_watch || "待补充。").trim()}

## Next Review

${record.reviewDueAt || "待定"}
`;
}

export async function workflowInit(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  return {
    schemaVersion: 6,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    root: paths.root,
    dbFile: paths.dbFile,
    thesisDir: paths.thesisDir,
    evidenceDir: paths.evidenceDir,
    memosDir: paths.memosDir,
    gatesDir: paths.gatesDir,
    protocolDir: paths.protocolDir,
    intentsDir: paths.intentsDir,
    receiptsDir: paths.receiptsDir,
    bridgeDir: paths.bridgeDir,
    workflowsDir: paths.workflowsDir,
    templatesDir: paths.templatesDir
  };
}

function readinessStatus(findings) {
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.some((finding) => finding.severity === "warning")) return "degraded";
  return "ready";
}

async function commandProbe(command, args, options = {}) {
  const startedAt = nowIso();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeoutMs || 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) }
    });
    return {
      ok: true,
      startedAt,
      completedAt: nowIso(),
      stdout: String(stdout || "").slice(0, options.maxText || 2000),
      stderr: String(stderr || "").slice(0, options.maxText || 2000)
    };
  } catch (error) {
    return {
      ok: false,
      startedAt,
      completedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function activeReadinessChecks(paths, input, findings) {
  const checks = {};
  const proxyEnv = {
    HTTP_PROXY: input.httpProxy || input.http_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890",
    HTTPS_PROXY: input.httpsProxy || input.https_proxy || process.env.HTTPS_PROXY || "http://127.0.0.1:7890",
    ALL_PROXY: input.allProxy || input.all_proxy || process.env.ALL_PROXY || "socks5://127.0.0.1:7890"
  };
  checks.openclawGateway = await commandProbe("openclaw", ["health"], {
    cwd: paths.root,
    timeoutMs: 60000,
    env: { OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: "1", ...proxyEnv }
  });
  if (!checks.openclawGateway.ok) findings.push({ severity: "warning", key: "openclaw_gateway_health_failed", plane: "control", error: checks.openclawGateway.error });

  const hermesBin = resolveHome(input.hermesBin || input.hermes_bin || process.env.HERMES_BIN || "/home/flashcat/hermes-agent/venv/bin/hermes");
  const hermesRows = await sqlite(paths.dbFile, `
SELECT runtime, agent_id, endpoint_ref
FROM runtime_agents
WHERE runtime='hermes_acp' AND status='active'
ORDER BY agent_id;`, { json: true });
  checks.hermesProfiles = [];
  for (const row of hermesRows) {
    const profile = hermesProfileFromEndpoint(row.endpoint_ref, row.agent_id);
    const result = await commandProbe(hermesBin, ["-p", profile, "acp", "--check"], {
      cwd: "/home/flashcat/hermes-agent",
      timeoutMs: 20000,
      env: proxyEnv,
      maxText: 1000
    });
    checks.hermesProfiles.push({ agentId: row.agent_id, profile, ...result });
    if (!result.ok) findings.push({ severity: "warning", key: "hermes_acp_check_failed", plane: "runtime", agentId: row.agent_id, profile, error: result.error });
  }

  const backendId = String(input.acpBackend || input.acp_backend || process.env.TRADING_AGENTS_ACP_BACKEND || "acpx").trim();
  try {
    await resolveAcpBackend(backendId);
    checks.acpBackend = { ok: true, backend: backendId, checkedAt: nowIso() };
  } catch (error) {
    checks.acpBackend = { ok: false, backend: backendId, checkedAt: nowIso(), error: error instanceof Error ? error.message : String(error) };
    findings.push({ severity: "warning", key: "acp_backend_unavailable", plane: "runtime", backend: backendId, error: checks.acpBackend.error });
  }

  return checks;
}

async function workflowReadinessSnapshot(paths, input = {}) {
  const checkedAt = nowIso();
  const dispatchRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='queued' AND created_at < ${sqlValue(new Date(Date.now() - 15 * 60000).toISOString())} THEN 1 ELSE 0 END) AS stale_queued,
  SUM(CASE WHEN status='sent' AND updated_at < ${sqlValue(new Date(Date.now() - 30 * 60000).toISOString())} THEN 1 ELSE 0 END) AS stale_sent
FROM mixed_meeting_dispatches;`, { json: true });
  const runtimeRows = await sqlite(paths.dbFile, `
SELECT
  runtime,
  SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
  COUNT(*) AS total
FROM runtime_agents
GROUP BY runtime;`, { json: true });
  const outboxRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
FROM telegram_outbox;`, { json: true });
  const humanGateRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS pending,
  SUM(CASE WHEN created_at < ${sqlValue(new Date(Date.now() - 6 * 3600000).toISOString())} THEN 1 ELSE 0 END) AS stale
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending';`, { json: true });
  const dataFreshnessRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS tracked,
  SUM(CASE WHEN updated_at < ${sqlValue(new Date(Date.now() - 3 * 86400000).toISOString())} THEN 1 ELSE 0 END) AS stale
FROM tracking_states;`, { json: true });
  const recentRuntimeRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='retry_scheduled' THEN 1 ELSE 0 END) AS retry_scheduled,
  COUNT(*) AS total
FROM runtime_runs
WHERE started_at >= ${sqlValue(new Date(Date.now() - 6 * 3600000).toISOString())};`, { json: true });
  const dispatch = dispatchRows[0] || {};
  const outbox = outboxRows[0] || {};
  const humanGate = humanGateRows[0] || {};
  const dataFreshness = dataFreshnessRows[0] || {};
  const recentRuntime = recentRuntimeRows[0] || {};
  const findings = [];
  if (Number(dispatch.stale_sent || 0) > 0) findings.push({ severity: "critical", key: "stale_sent_dispatches", count: Number(dispatch.stale_sent || 0), plane: "orchestration" });
  if (Number(dispatch.stale_queued || 0) > 0) findings.push({ severity: "warning", key: "stale_queued_dispatches", count: Number(dispatch.stale_queued || 0), plane: "orchestration" });
  if (Number(outbox.failed || 0) > 0) findings.push({ severity: "warning", key: "telegram_outbox_failed", count: Number(outbox.failed || 0), plane: "communication" });
  if (Number(humanGate.stale || 0) > 0) findings.push({ severity: "warning", key: "stale_human_gate", count: Number(humanGate.stale || 0), plane: "orchestration" });
  if (Number(dataFreshness.stale || 0) > 0) findings.push({ severity: "warning", key: "stale_tracking_data", count: Number(dataFreshness.stale || 0), plane: "data" });
  if (Number(recentRuntime.failed || 0) > 0) findings.push({ severity: "warning", key: "recent_runtime_failures", count: Number(recentRuntime.failed || 0), plane: "runtime" });
  const activeChecks = Boolean(input.activeChecks || input.active_checks);
  const active = activeChecks ? await activeReadinessChecks(paths, input, findings) : null;
  const planes = {
    control: active ? { openclawGateway: active.openclawGateway } : {},
    orchestration: { dispatch },
    runtime: { runtimes: runtimeRows, recentRuntime, hermesProfiles: active?.hermesProfiles || [], acpBackend: active?.acpBackend || null },
    communication: { telegramOutbox: outbox },
    data: { trackingFreshness: dataFreshness },
    humanGate: humanGate
  };
  const status = readinessStatus(findings);
  const snapshotId = safeId("readiness");
  await sqlite(paths.dbFile, `
INSERT INTO readiness_snapshots(snapshot_id, status, checked_at, planes_json, findings_json, payload_json)
VALUES (${sqlValue(snapshotId)}, ${sqlValue(status)}, ${sqlValue(checkedAt)}, ${sqlValue(JSON.stringify(planes))}, ${sqlValue(JSON.stringify(findings))}, ${sqlValue(JSON.stringify({ activeChecks }))});`);
  return { snapshotId, status, checkedAt, activeChecks, planes, findings };
}

export async function workflowStatus(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const counts = await sqlite(paths.dbFile, `
SELECT 'instruments' AS name, COUNT(*) AS count FROM instruments
UNION ALL SELECT 'radar_scores', COUNT(*) FROM radar_scores
UNION ALL SELECT 'thesis', COUNT(*) FROM thesis_index
UNION ALL SELECT 'evidence', COUNT(*) FROM evidence_items
UNION ALL SELECT 'memos', COUNT(*) FROM research_memos
UNION ALL SELECT 'gates', COUNT(*) FROM review_gates
UNION ALL SELECT 'workflows', COUNT(*) FROM workflow_runs
UNION ALL SELECT 'workflow_tasks', COUNT(*) FROM workflow_tasks
UNION ALL SELECT 'workflow_task_dependencies', COUNT(*) FROM workflow_task_dependencies
UNION ALL SELECT 'workflow_checkpoints', COUNT(*) FROM workflow_checkpoints
UNION ALL SELECT 'protocol_objects', COUNT(*) FROM protocol_objects
UNION ALL SELECT 'trade_intents', COUNT(*) FROM executable_trade_intents
UNION ALL SELECT 'trading_core_receipts', COUNT(*) FROM trading_core_receipts
UNION ALL SELECT 'runtime_runs', COUNT(*) FROM runtime_runs
UNION ALL SELECT 'side_effects', COUNT(*) FROM side_effect_ledger
UNION ALL SELECT 'incidents', COUNT(*) FROM incident_states
UNION ALL SELECT 'readiness_snapshots', COUNT(*) FROM readiness_snapshots
UNION ALL SELECT 'runtime_agents', COUNT(*) FROM runtime_agents
UNION ALL SELECT 'mixed_meeting_participants', COUNT(*) FROM mixed_meeting_participants
UNION ALL SELECT 'mixed_meeting_messages', COUNT(*) FROM mixed_meeting_messages
UNION ALL SELECT 'mixed_meeting_dispatches', COUNT(*) FROM mixed_meeting_dispatches
UNION ALL SELECT 'telegram_outbox', COUNT(*) FROM telegram_outbox;`, { json: true });
  const readiness = await workflowReadinessSnapshot(paths, input);
  const result = {
    schemaVersion: 6,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    root: paths.root,
    dbFile: paths.dbFile,
    readiness,
    counts: Object.fromEntries(counts.map((row) => [row.name, row.count]))
  };
  if (input.symbol || input.instrumentId || input.instrument_id) {
    const instrument = await readInstrument(paths, input);
    const state = instrument ? (await sqlite(paths.dbFile, `SELECT * FROM tracking_states WHERE instrument_id=${sqlValue(instrument.instrument_id)};`, { json: true }))[0] || null : null;
    return { ...result, instrument, state };
  }
  return result;
}

export async function workflowRunUpsert(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const createdAt = nowIso();
  const workflowId = String(input.workflowId || input.workflow_id || input.initiativeId || input.initiative_id || safeId("workflow")).trim();
  const statusRaw = String(input.status || "active").trim();
  const status = WORKFLOW_RUN_STATUSES.has(statusRaw) ? statusRaw : "active";
  const workflowType = String(input.workflowType || input.workflow_type || input.type || "initiative").trim();
  const payload = parseJsonValue(input.payload, input.payload || {});
  await sqlite(paths.dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, instrument_id, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES (${sqlValue(workflowId)}, ${sqlValue(workflowType)}, ${sqlValue(status)}, ${sqlValue(input.instrumentId || input.instrument_id || null)}, ${sqlValue(input.ownerAgent || input.owner_agent || "main")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.objective || input.goal || "")}, ${sqlValue(input.acceptanceCriteria || input.acceptance_criteria || "")}, ${sqlValue(input.stopCondition || input.stop_condition || "")}, ${sqlValue(input.phase || input.currentPhase || input.current_phase || "")}, ${sqlValue(input.currentDecision || input.current_decision || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(workflow_id) DO UPDATE SET
  workflow_type=excluded.workflow_type,
  status=excluded.status,
  instrument_id=COALESCE(excluded.instrument_id, workflow_runs.instrument_id),
  owner_agent=excluded.owner_agent,
  summary=CASE WHEN excluded.summary != '' THEN excluded.summary ELSE workflow_runs.summary END,
  objective=CASE WHEN excluded.objective != '' THEN excluded.objective ELSE workflow_runs.objective END,
  acceptance_criteria=CASE WHEN excluded.acceptance_criteria != '' THEN excluded.acceptance_criteria ELSE workflow_runs.acceptance_criteria END,
  stop_condition=CASE WHEN excluded.stop_condition != '' THEN excluded.stop_condition ELSE workflow_runs.stop_condition END,
  current_phase=CASE WHEN excluded.current_phase != '' THEN excluded.current_phase ELSE workflow_runs.current_phase END,
  current_decision=CASE WHEN excluded.current_decision != '' THEN excluded.current_decision ELSE workflow_runs.current_decision END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  return { workflowId, status, workflowType, dbFile: paths.dbFile };
}

export async function workflowTaskCreate(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const createdAt = nowIso();
  const workflowId = String(input.workflowId || input.workflow_id || input.initiativeId || input.initiative_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  await workflowRunUpsert(rootDir, {
    ...input,
    workflowId,
    workflowType: input.workflowType || input.workflow_type || "initiative",
    status: input.workflowStatus || input.workflow_status || "active"
  });
  const taskId = String(input.taskId || input.task_id || safeId("task")).trim();
  const statusRaw = String(input.status || "pending").trim();
  const status = WORKFLOW_TASK_STATUSES.has(statusRaw) ? statusRaw : "pending";
  const priorityRaw = String(input.priority || "normal").trim();
  const priority = WORKFLOW_TASK_PRIORITIES.has(priorityRaw) ? priorityRaw : "normal";
  const ownerAgent = String(input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "main").trim();
  const runtime = String(input.runtime || "").trim();
  const agentId = String(input.agentId || input.agent_id || ownerAgent).trim();
  const dependsOn = toList(input.dependsOn || input.depends_on || input.after);
  const payload = parseJsonValue(input.payload, input.payload || {});
  await sqlite(paths.dbFile, `
INSERT INTO workflow_tasks(task_id, workflow_id, parent_task_id, phase, owner_agent, runtime, agent_id, task_type, status, priority, depends_on_json, expected_artifact, actual_artifact_ref, receipt_required, human_gate_required, summary, prompt, payload_json, blocked_reason, created_by, created_at, due_at, started_at, completed_at, updated_at)
VALUES (${sqlValue(taskId)}, ${sqlValue(workflowId)}, ${sqlValue(input.parentTaskId || input.parent_task_id || "")}, ${sqlValue(input.phase || "")}, ${sqlValue(ownerAgent)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(input.taskType || input.task_type || input.type || "task")}, ${sqlValue(status)}, ${sqlValue(priority)}, ${sqlValue(JSON.stringify(dependsOn))}, ${sqlValue(input.expectedArtifact || input.expected_artifact || "")}, ${sqlValue(input.actualArtifactRef || input.actual_artifact_ref || input.artifactRef || input.artifact_ref || "")}, ${sqlValue(input.receiptRequired ?? input.receipt_required ?? true)}, ${sqlValue(input.humanGateRequired ?? input.human_gate_required ?? false)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.prompt || input.text || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(input.blockedReason || input.blocked_reason || "")}, ${sqlValue(input.createdBy || input.created_by || input.from || "main")}, ${sqlValue(createdAt)}, ${sqlValue(input.dueAt || input.due_at || "")}, ${sqlValue(status === "in_progress" ? createdAt : "")}, ${sqlValue(status === "done" ? createdAt : "")}, ${sqlValue(createdAt)});`);
  for (const dependency of dependsOn) {
    await sqlite(paths.dbFile, `
INSERT OR IGNORE INTO workflow_task_dependencies(task_id, depends_on_task_id, created_at)
VALUES (${sqlValue(taskId)}, ${sqlValue(dependency)}, ${sqlValue(createdAt)});`);
  }
  return { taskId, workflowId, status, priority, ownerAgent, runtime, agentId, dependsOn, dbFile: paths.dbFile };
}

export async function workflowTaskUpdate(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const taskId = String(input.taskId || input.task_id || "").trim();
  if (!taskId) throw new Error("taskId is required");
  const currentRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_tasks WHERE task_id=${sqlValue(taskId)} LIMIT 1;`, { json: true });
  if (!currentRows[0]) throw new Error(`workflow task not found: ${taskId}`);
  const current = currentRows[0];
  const updatedAt = nowIso();
  const statusRaw = String(input.status || current.status).trim();
  const status = WORKFLOW_TASK_STATUSES.has(statusRaw) ? statusRaw : current.status;
  const payload = input.payload === undefined ? current.payload_json : JSON.stringify(parseJsonValue(input.payload, input.payload || {}));
  await sqlite(paths.dbFile, `
UPDATE workflow_tasks
SET status=${sqlValue(status)},
    summary=${sqlValue(input.summary ?? current.summary ?? "")},
    prompt=${sqlValue(input.prompt ?? current.prompt ?? "")},
    expected_artifact=${sqlValue(input.expectedArtifact ?? input.expected_artifact ?? current.expected_artifact ?? "")},
    actual_artifact_ref=${sqlValue(input.actualArtifactRef ?? input.actual_artifact_ref ?? input.artifactRef ?? input.artifact_ref ?? current.actual_artifact_ref ?? "")},
    blocked_reason=${sqlValue(input.blockedReason ?? input.blocked_reason ?? current.blocked_reason ?? "")},
    payload_json=${sqlValue(payload)},
    started_at=${sqlValue(status === "in_progress" && !current.started_at ? updatedAt : current.started_at || "")},
    completed_at=${sqlValue(["done", "failed", "cancelled"].includes(status) && !current.completed_at ? updatedAt : current.completed_at || "")},
    updated_at=${sqlValue(updatedAt)}
WHERE task_id=${sqlValue(taskId)};`);
  return { taskId, workflowId: current.workflow_id, status, dbFile: paths.dbFile };
}

export async function workflowTaskList(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const filters = [];
  if (input.workflowId || input.workflow_id) filters.push(`workflow_id=${sqlValue(input.workflowId || input.workflow_id)}`);
  if (input.status) filters.push(`status=${sqlValue(input.status)}`);
  if (input.ownerAgent || input.owner_agent) filters.push(`owner_agent=${sqlValue(input.ownerAgent || input.owner_agent)}`);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));
  const rows = await sqlite(paths.dbFile, `
SELECT * FROM workflow_tasks
${where}
ORDER BY workflow_id, CASE priority WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at
LIMIT ${limit};`, { json: true });
  return { count: rows.length, tasks: rows, dbFile: paths.dbFile };
}

async function pendingHumanGateCount(paths, workflowId) {
  const rows = await sqlite(paths.dbFile, `
SELECT (
  SELECT COUNT(*) FROM review_gates
  WHERE workflow_id=${sqlValue(workflowId)}
    AND (status='pending' OR (human_gate_required=1 AND status NOT IN ('approved','waived','rejected')))
) + (
  SELECT COUNT(*) FROM protocol_objects
  WHERE object_type='human_gate_record'
    AND status='pending'
    AND (payload_json LIKE ${sqlValue(`%${workflowId}%`)} OR parent_object_id=${sqlValue(workflowId)})
) AS count;`, { json: true });
  return Number(rows[0]?.count || 0);
}

export async function workflowAdvance(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const checkedAt = nowIso();
  const workflowRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
  if (!workflowRows[0]) throw new Error(`workflow not found: ${workflowId}`);
  const tasks = await sqlite(paths.dbFile, `SELECT * FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)} ORDER BY created_at;`, { json: true });
  const statusByTask = Object.fromEntries(tasks.map((task) => [task.task_id, task.status]));
  const workflowHumanGates = await pendingHumanGateCount(paths, workflowId);
  const blocked = tasks.filter((task) => task.status === "blocked" || task.status === "failed");
  const inProgress = tasks.filter((task) => task.status === "in_progress");
  const pending = tasks.filter((task) => task.status === "pending");
  const taskHumanGates = pending.filter((task) => Number(task.human_gate_required || 0) > 0);
  const pendingHumanGates = workflowHumanGates + taskHumanGates.length;
  const readyTasks = pending.filter((task) => {
    if (Number(task.human_gate_required || 0) > 0) return false;
    const deps = toList(parseJsonValue(task.depends_on_json, []));
    return deps.every((dep) => statusByTask[dep] === "done");
  });
  let decision = "needs_planning";
  if (pendingHumanGates > 0) decision = "human_gate_pending";
  else if (!tasks.length) decision = "needs_planning";
  else if (readyTasks.length) decision = "dispatch_ready";
  else if (inProgress.length) decision = "receipts_collecting";
  else if (tasks.every((task) => task.status === "done")) decision = input.goalComplete || input.goal_complete ? "completed" : "cat_claw_summary_required";
  else if (blocked.length) decision = "blocked";
  else decision = "waiting_dependencies";

  const dispatched = [];
  if (Boolean(input.autoDispatch || input.auto_dispatch) && decision === "dispatch_ready") {
    for (const task of readyTasks) {
      if (!task.runtime || !task.agent_id) continue;
      const dispatch = await meetingDispatch(rootDir, {
        workflowRootDir: input.workflowRootDir || input.workflow_root,
        meetingId: input.meetingId || input.meeting_id || workflowId,
        workflowId,
        traceId: input.traceId || input.trace_id || `${workflowId}:${task.task_id}`,
        idempotencyKey: `workflow_task:${task.task_id}:dispatch`,
        runtime: task.runtime,
        agentId: task.agent_id,
        dispatchType: task.task_type || "workflow_task",
        priority: task.priority === "steer" ? "steer" : "normal",
        prompt: task.prompt || task.summary || "",
        createdBy: input.createdBy || input.created_by || "main",
        payload: { taskId: task.task_id, expectedArtifact: task.expected_artifact || "", workflowAdvance: true }
      });
      await workflowTaskUpdate(rootDir, { workflowRootDir: input.workflowRootDir || input.workflow_root, taskId: task.task_id, status: "in_progress" });
      dispatched.push({ taskId: task.task_id, dispatchId: dispatch.dispatchId, runtime: task.runtime, agentId: task.agent_id, status: dispatch.status, deduped: dispatch.deduped || false });
    }
    if (dispatched.length) decision = "dispatching";
  }

  await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET current_decision=${sqlValue(decision)}, updated_at=${sqlValue(checkedAt)},
    status=${sqlValue(decision === "completed" ? "completed" : decision === "human_gate_pending" ? "waiting_human" : decision === "blocked" ? "blocked" : workflowRows[0].status)}
WHERE workflow_id=${sqlValue(workflowId)};`);
  const summary = {
    total: tasks.length,
    pending: Math.max(0, pending.length - dispatched.length),
    ready: Math.max(0, readyTasks.length - dispatched.length),
    inProgress: inProgress.length + dispatched.length,
    done: tasks.filter((task) => task.status === "done").length,
    blocked: blocked.length,
    pendingHumanGates,
    workflowHumanGates,
    taskHumanGates: taskHumanGates.length
  };
  return { workflowId, decision, checkedAt, summary, readyTasks, blockedTasks: blocked, dispatched, dbFile: paths.dbFile };
}

function renderWorkflowCheckpointMarkdown(record) {
  const taskLine = (task) => `- ${task.task_id}: ${task.status} | ${task.owner_agent || ""}/${task.runtime || ""}/${task.agent_id || ""} | ${task.summary || ""}`.trim();
  const artifactLine = (artifact) => `- ${artifact.kind || "artifact"}: ${artifact.path || artifact.actual_artifact_ref || ""} ${artifact.summary ? `| ${artifact.summary}` : ""}`.trim();
  const actionLine = (action) => `- ${action}`.trim();
  return `# Workflow Checkpoint

- checkpoint_id: ${record.checkpointId}
- workflow_id: ${record.workflowId}
- status: ${record.status}
- phase: ${record.phase || ""}
- decision: ${record.decision || ""}
- created_by: ${record.createdBy}
- created_at: ${record.createdAt}

## Summary

${record.summary || "待补充。"}

## Resume Payload

\`\`\`json
${JSON.stringify(record.resumePayload, null, 2)}
\`\`\`

## Active Tasks

${record.activeTasks.length ? record.activeTasks.map(taskLine).join("\n") : "- none"}

## Blocked Tasks

${record.blockedTasks.length ? record.blockedTasks.map(taskLine).join("\n") : "- none"}

## Artifact Refs

${record.artifactRefs.length ? record.artifactRefs.map(artifactLine).join("\n") : "- none"}

## Next Actions

${record.nextActions.length ? record.nextActions.map(actionLine).join("\n") : "- none"}
`;
}

export async function workflowCheckpoint(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const createdAt = nowIso();
  const checkpointId = String(input.checkpointId || input.checkpoint_id || safeId("checkpoint")).trim();
  const workflowRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
  if (!workflowRows[0]) throw new Error(`workflow not found: ${workflowId}`);
  const workflow = workflowRows[0];
  const tasks = await sqlite(paths.dbFile, `
SELECT * FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY CASE priority WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at;`, { json: true });
  const activeTasks = tasks.filter((task) => ["pending", "in_progress"].includes(task.status));
  const blockedTasks = tasks.filter((task) => ["blocked", "failed"].includes(task.status));
  const doneTasks = tasks.filter((task) => task.status === "done");
  const artifactRows = await sqlite(paths.dbFile, `
SELECT artifact_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 50;`, { json: true });
  const taskArtifacts = tasks
    .filter((task) => task.actual_artifact_ref)
    .map((task) => ({
      kind: "workflow_task_artifact",
      task_id: task.task_id,
      path: task.actual_artifact_ref,
      summary: task.summary || ""
    }));
  const artifactRefs = [...artifactRows, ...taskArtifacts];
  const workflowHumanGates = await pendingHumanGateCount(paths, workflowId);
  const pendingHumanGates = workflowHumanGates + activeTasks.filter((task) => Number(task.human_gate_required || 0) > 0).length;
  const nextActions = toList(input.nextActions || input.next_actions).length
    ? toList(input.nextActions || input.next_actions)
    : [
        activeTasks.length ? "continue_or_collect_active_task_receipts" : "",
        blockedTasks.length ? "resolve_blocked_tasks_or_escalate" : "",
        pendingHumanGates ? "cat_claw_submit_pending_human_gate_package" : "",
        !activeTasks.length && !blockedTasks.length && doneTasks.length ? "cat_claw_prepare_summary_or_next_phase" : "",
        !tasks.length ? "main_create_next_phase_tasks" : ""
      ].filter(Boolean);
  const resumePayload = {
    workflowId,
    objective: workflow.objective || "",
    acceptanceCriteria: workflow.acceptance_criteria || "",
    stopCondition: workflow.stop_condition || "",
    status: workflow.status,
    phase: workflow.current_phase || "",
    decision: workflow.current_decision || "",
    summary: input.summary || workflow.summary || "",
    counts: {
      totalTasks: tasks.length,
      activeTasks: activeTasks.length,
      doneTasks: doneTasks.length,
      blockedTasks: blockedTasks.length,
      pendingHumanGates,
      artifactRefs: artifactRefs.length
    },
    activeTaskIds: activeTasks.map((task) => task.task_id),
    blockedTaskIds: blockedTasks.map((task) => task.task_id),
    artifactRefs: artifactRefs.map((artifact) => artifact.path || artifact.actual_artifact_ref || "").filter(Boolean),
    nextActions
  };
  const contextBudget = {
    mode: input.mode || input.contextMode || input.context_mode || "checkpoint",
    tokenBudget: numberOrNull(input.tokenBudget || input.token_budget),
    compactAtPercent: numberOrNull(input.compactAtPercent || input.compact_at_percent) ?? 70,
    restorePolicy: input.restorePolicy || input.restore_policy || "load_checkpoint_plus_referenced_artifacts_only"
  };
  const record = {
    checkpointId,
    workflowId,
    status: workflow.status,
    phase: workflow.current_phase || "",
    decision: workflow.current_decision || "",
    summary: input.summary || workflow.summary || "",
    resumePayload,
    activeTasks,
    blockedTasks,
    artifactRefs,
    nextActions,
    contextBudget,
    createdBy: input.createdBy || input.created_by || input.from || "main",
    createdAt
  };
  const jsonRelPath = await writeJsonArtifact(paths.root, paths.checkpointsDir, checkpointId, record);
  const markdownRelPath = await writeTextArtifact(paths.root, paths.checkpointsDir, checkpointId, "md", renderWorkflowCheckpointMarkdown(record));
  await sqlite(paths.dbFile, `
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES (${sqlValue(checkpointId)}, ${sqlValue(workflowId)}, ${sqlValue(record.status)}, ${sqlValue(record.phase)}, ${sqlValue(record.decision)}, ${sqlValue(record.summary)}, ${sqlValue(JSON.stringify(resumePayload))}, ${sqlValue(JSON.stringify(activeTasks))}, ${sqlValue(JSON.stringify(blockedTasks))}, ${sqlValue(JSON.stringify(artifactRefs))}, ${sqlValue(JSON.stringify(nextActions))}, ${sqlValue(JSON.stringify(contextBudget))}, ${sqlValue(markdownRelPath)}, ${sqlValue(record.createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(checkpoint_id) DO UPDATE SET
  status=excluded.status,
  phase=excluded.phase,
  decision=excluded.decision,
  summary=excluded.summary,
  resume_payload_json=excluded.resume_payload_json,
  active_tasks_json=excluded.active_tasks_json,
  blocked_tasks_json=excluded.blocked_tasks_json,
  artifact_refs_json=excluded.artifact_refs_json,
  next_actions_json=excluded.next_actions_json,
  context_budget_json=excluded.context_budget_json,
  path=excluded.path,
  created_by=excluded.created_by,
  created_at=excluded.created_at;`);
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(checkpointId)}, NULL, ${sqlValue(workflowId)}, 'workflow_checkpoint', ${sqlValue(markdownRelPath)}, ${sqlValue(record.summary)}, ${sqlValue(record.createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
  return {
    checkpointId,
    workflowId,
    status: record.status,
    phase: record.phase,
    decision: record.decision,
    relativePath: markdownRelPath,
    jsonRelativePath: jsonRelPath,
    resumePayload,
    dbFile: paths.dbFile
  };
}

export async function instrumentUpsert(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  return { ...instrument, dbFile: paths.dbFile };
}

export async function radarUpdate(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const zone = RADAR_ZONES.has(String(input.radarZone || input.radar_zone || "unknown")) ? String(input.radarZone || input.radar_zone || "unknown") : "unknown";
  const score = {
    scoreId: input.scoreId || input.score_id || safeId("radar"),
    asOf: String(input.asOf || input.as_of || dailyKey()),
    retailHeatScore: clampScore(input.retailHeatScore ?? input.retail_heat_score),
    newsCatalystScore: clampScore(input.newsCatalystScore ?? input.news_catalyst_score),
    fundamentalScore: clampScore(input.fundamentalScore ?? input.fundamental_score),
    summary: String(input.summary || input.text || "").trim(),
    createdBy: String(input.createdBy || input.from || "cat_claw")
  };
  await sqlite(paths.dbFile, `
INSERT INTO radar_scores(score_id, instrument_id, as_of, radar_zone, retail_heat_score, news_catalyst_score, fundamental_score, sentiment_stage, source_reliability, catalyst_window, fundamental_trend, valuation_state, confidence, summary, evidence_paths_json, created_by, created_at)
VALUES (${sqlValue(score.scoreId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(score.asOf)}, ${sqlValue(zone)}, ${sqlValue(score.retailHeatScore)}, ${sqlValue(score.newsCatalystScore)}, ${sqlValue(score.fundamentalScore)}, ${sqlValue(input.sentimentStage || input.sentiment_stage || "")}, ${sqlValue(input.sourceReliability || input.source_reliability || "")}, ${sqlValue(input.catalystWindow || input.catalyst_window || "")}, ${sqlValue(input.fundamentalTrend || input.fundamental_trend || "")}, ${sqlValue(input.valuationState || input.valuation_state || "")}, ${sqlValue(input.confidence || "")}, ${sqlValue(score.summary)}, ${sqlValue(JSON.stringify(toList(input.evidencePaths || input.evidence_paths)))}, ${sqlValue(score.createdBy)}, ${sqlValue(nowIso())});
INSERT INTO tracking_states(instrument_id, research_state, radar_zone, retail_heat_score, news_catalyst_score, fundamental_score, sentiment_stage, fundamental_trend, valuation_state, last_review_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(input.researchState || input.research_state || "")}, ${sqlValue(zone)}, ${sqlValue(score.retailHeatScore)}, ${sqlValue(score.newsCatalystScore)}, ${sqlValue(score.fundamentalScore)}, ${sqlValue(input.sentimentStage || input.sentiment_stage || "")}, ${sqlValue(input.fundamentalTrend || input.fundamental_trend || "")}, ${sqlValue(input.valuationState || input.valuation_state || "")}, ${sqlValue(score.asOf)}, ${sqlValue(nowIso())})
ON CONFLICT(instrument_id) DO UPDATE SET
  research_state=COALESCE(NULLIF(excluded.research_state,''), tracking_states.research_state),
  radar_zone=excluded.radar_zone,
  retail_heat_score=excluded.retail_heat_score,
  news_catalyst_score=excluded.news_catalyst_score,
  fundamental_score=excluded.fundamental_score,
  sentiment_stage=excluded.sentiment_stage,
  fundamental_trend=excluded.fundamental_trend,
  valuation_state=excluded.valuation_state,
  last_review_at=excluded.last_review_at,
  updated_at=excluded.updated_at;`);
  return { ...score, instrumentId: instrument.instrumentId, assetType: instrument.assetType, symbol: instrument.symbol, radarZone: zone, dbFile: paths.dbFile };
}

export async function thesisUpdate(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const status = THESIS_STATUSES.has(String(input.status || "active")) ? String(input.status || "active") : "active";
  const ownerAgent = String(input.ownerAgent || input.owner_agent || "cat_ears");
  const title = String(input.title || `${instrument.symbol} thesis`).trim();
  const assetDir = path.join(paths.thesisDir, instrument.assetType);
  await fs.mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, `${cleanFileSegment(instrument.symbol)}.md`);
  const record = {
    thesisId: input.thesisId || input.thesis_id || instrument.instrumentId,
    instrumentId: instrument.instrumentId,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    title,
    status,
    ownerAgent,
    summary: String(input.summary || input.text || "").trim(),
    falsificationTriggers: String(input.falsificationTriggers || input.falsification_triggers || "").trim(),
    reviewDueAt: String(input.reviewDueAt || input.review_due_at || ""),
    updatedAt: nowIso()
  };
  const content = String(input.content || "").trim() || renderThesisMarkdown(record, input);
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  const relPath = relativeTo(paths.root, filePath);
  await sqlite(paths.dbFile, `
INSERT INTO thesis_index(thesis_id, instrument_id, status, title, path, summary, falsification_triggers, owner_agent, review_due_at, created_at, updated_at)
VALUES (${sqlValue(record.thesisId)}, ${sqlValue(record.instrumentId)}, ${sqlValue(status)}, ${sqlValue(title)}, ${sqlValue(relPath)}, ${sqlValue(record.summary)}, ${sqlValue(record.falsificationTriggers)}, ${sqlValue(ownerAgent)}, ${sqlValue(record.reviewDueAt)}, ${sqlValue(record.updatedAt)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(thesis_id) DO UPDATE SET
  status=excluded.status,
  title=excluded.title,
  path=excluded.path,
  summary=excluded.summary,
  falsification_triggers=excluded.falsification_triggers,
  owner_agent=excluded.owner_agent,
  review_due_at=excluded.review_due_at,
  updated_at=excluded.updated_at;
INSERT INTO tracking_states(instrument_id, thesis_status, thesis_path, updated_at)
VALUES (${sqlValue(record.instrumentId)}, ${sqlValue(status)}, ${sqlValue(relPath)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(instrument_id) DO UPDATE SET thesis_status=excluded.thesis_status, thesis_path=excluded.thesis_path, updated_at=excluded.updated_at;`);
  return { ...record, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
}

export async function researchEvidence(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const evidenceId = input.evidenceId || input.evidence_id || safeId("evidence");
  const capturedAt = String(input.capturedAt || input.captured_at || nowIso());
  const assetDir = path.join(paths.evidenceDir, instrument.assetType, cleanFileSegment(instrument.symbol));
  await fs.mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, `${dailyKey(new Date(capturedAt))}-${cleanFileSegment(String(input.kind || "evidence"))}-${evidenceId.split(".").pop()}.md`);
  const content = String(input.content || `# Evidence ${evidenceId}

- instrument_id: ${instrument.instrumentId}
- kind: ${input.kind || "evidence"}
- source: ${input.source || ""}
- reliability: ${input.reliability || ""}
- captured_at: ${capturedAt}

## Summary

${String(input.summary || input.text || "").trim() || "待补充。"}

## Supports

${String(input.supports || "").trim() || "待补充。"}

## Conflicts

${String(input.conflicts || "").trim() || "待补充。"}
`).trim();
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  const relPath = relativeTo(paths.root, filePath);
  await sqlite(paths.dbFile, `
INSERT INTO evidence_items(evidence_id, instrument_id, kind, source, reliability, path, summary, supports, conflicts, captured_at, created_by, created_at)
VALUES (${sqlValue(evidenceId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.kind || "evidence")}, ${sqlValue(input.source || "")}, ${sqlValue(input.reliability || "")}, ${sqlValue(relPath)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.supports || "")}, ${sqlValue(input.conflicts || "")}, ${sqlValue(capturedAt)}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(nowIso())});
INSERT INTO tracking_states(instrument_id, last_evidence_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(capturedAt)}, ${sqlValue(nowIso())})
ON CONFLICT(instrument_id) DO UPDATE SET last_evidence_at=excluded.last_evidence_at, updated_at=excluded.updated_at;`);
  return { evidenceId, instrumentId: instrument.instrumentId, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
}

export async function researchMemo(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const memoId = input.memoId || input.memo_id || safeId("memo");
  const createdAt = nowIso();
  const assetDir = path.join(paths.memosDir, instrument.assetType, cleanFileSegment(instrument.symbol));
  await fs.mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, `${dailyKey()}-${cleanFileSegment(input.memoType || input.memo_type || "research-memo")}.md`);
  const content = String(input.content || `# ${input.title || `${instrument.symbol} Research Memo`}

- memo_id: ${memoId}
- instrument_id: ${instrument.instrumentId}
- memo_type: ${input.memoType || input.memo_type || "research_memo"}
- created_at: ${createdAt}

## Summary

${String(input.summary || input.text || "").trim() || "待补充。"}

## Conclusion

${String(input.conclusion || "").trim() || "待补充。"}
`).trim();
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  const relPath = relativeTo(paths.root, filePath);
  await sqlite(paths.dbFile, `
INSERT INTO research_memos(memo_id, instrument_id, memo_type, path, title, summary, conclusion, created_by, created_at)
VALUES (${sqlValue(memoId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.memoType || input.memo_type || "research_memo")}, ${sqlValue(relPath)}, ${sqlValue(input.title || "")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.conclusion || "")}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)});
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(memoId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, 'research_memo', ${sqlValue(relPath)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)});
INSERT INTO tracking_states(instrument_id, last_memo_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(instrument_id) DO UPDATE SET last_memo_at=excluded.last_memo_at, updated_at=excluded.updated_at;`);
  return { memoId, instrumentId: instrument.instrumentId, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
}

export async function gateReview(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  let instrument = null;
  if (input.symbol || input.instrumentId || input.instrument_id) instrument = await upsertInstrumentRecord(paths, input);
  const gateId = input.gateId || input.gate_id || safeId("gate");
  const status = GATE_STATUSES.has(String(input.status || "pending")) ? String(input.status || "pending") : "pending";
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO review_gates(gate_id, instrument_id, workflow_id, gate_type, status, summary, reviewer_agent, human_gate_required, resume_pointer, expires_at, decision_at, approver, evidence_paths_json, created_by, created_at, updated_at)
VALUES (${sqlValue(gateId)}, ${sqlValue(instrument?.instrumentId || null)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.gateType || input.gate_type || "review_gate")}, ${sqlValue(status)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.reviewerAgent || input.reviewer_agent || "")}, ${sqlValue(Boolean(input.humanGateRequired ?? input.human_gate_required))}, ${sqlValue(input.resumePointer || input.resume_pointer || "")}, ${sqlValue(input.expiresAt || input.expires_at || "")}, ${sqlValue(["approved", "rejected", "waived"].includes(status) ? createdAt : "")}, ${sqlValue(input.approver || input.actor || "")}, ${sqlValue(JSON.stringify(toList(input.evidencePaths || input.evidence_paths)))}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  return { gateId, status, instrumentId: instrument?.instrumentId || null, dbFile: paths.dbFile };
}

export async function workflowTopology(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const registeredAgents = await sqlite(paths.dbFile, `
SELECT runtime, agent_id, display_name, role, status, endpoint_ref
FROM runtime_agents
ORDER BY runtime, agent_id;`, { json: true });
  const activeAgentIds = [
    ...new Set(
      registeredAgents
        .filter((row) => row.status === "active")
        .map((row) => String(row.agent_id || "").trim())
        .filter(Boolean)
    )
  ];
  const runtimeRegistry = registeredAgents.reduce((acc, row) => {
    if (!acc[row.runtime]) acc[row.runtime] = [];
    acc[row.runtime].push({
      agentId: row.agent_id,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      endpointRef: row.endpoint_ref
    });
    return acc;
  }, {});
  return {
    schemaVersion: 6,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    root: paths.root,
    runtimeRegistry,
    topology: {
      serverA: {
        role: "execution_and_simulation_plane",
        services: ["trading_sim", "trading_core"],
        stores: ["exchange_api_keys", "accounts", "positions", "orders", "execution_risk"],
        boundary: "Server A is the only side allowed to hold broker/exchange credentials and live position/order state."
      },
      serverB: {
        role: "openclaw_hermes_workflow_plane",
        services: ["openclaw", "hermes_agents", "trading-agents-workflow"],
        agents: activeAgentIds,
        stores: ["meetings", "research", "protocol_objects", "human_gate", "audit"],
        boundary: "Server B produces reviewed intents only; it must not store exchange API keys or live account state."
      },
      localCodex: {
        role: "flashcat_primary_conversation_panel",
        advancedOperationAuth: "mTLS client certificate required for executable trade intents."
      }
    },
    allowedPath: "research_signal/evidence_pack/research_memo -> trade_proposal -> risk_decision -> human_gate_record -> executable_trade_intent -> trading_core_receipt",
    blockedPath: "Telegram/IM/plaintext commands cannot create ready_for_trading_core intents."
  };
}

async function readProtocolObject(paths, objectId) {
  if (!objectId) return null;
  const rows = await sqlite(paths.dbFile, `SELECT * FROM protocol_objects WHERE object_id=${sqlValue(objectId)} LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) return null;
  return { ...row, payload: parseJsonValue(row.payload_json, {}) };
}

async function writeJsonArtifact(root, dir, id, payload) {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${cleanFileSegment(id)}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relativeTo(root, filePath);
}

async function writeTextArtifact(root, dir, id, extension, content) {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${cleanFileSegment(id)}.${extension}`);
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return relativeTo(root, filePath);
}

async function appendJsonl(filePath, record) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

async function appendTranscript(paths, meetingId, line) {
  const filePath = path.join(paths.messagesDir, `${cleanFileSegment(meetingId)}.transcript.md`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${line}\n`, "utf8");
  return relativeTo(paths.root, filePath);
}

async function enqueueTelegramOutbox(paths, input) {
  const outboxId = input.outboxId || input.outbox_id || safeId("tg");
  const createdAt = nowIso();
  const payload = parseJsonValue(input.payload, input.payload || {});
  await sqlite(paths.dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES (${sqlValue(outboxId)}, ${sqlValue(input.meetingId || input.meeting_id || "")}, ${sqlValue(input.targetKind || input.target_kind || "group")}, ${sqlValue(input.targetRef || input.target_ref || "")}, ${sqlValue(input.messageType || input.message_type || "meeting_live")}, ${sqlValue(input.status || "queued")}, ${sqlValue(input.text || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  await writeJsonArtifact(paths.root, path.join(paths.telegramDir, "outbox"), outboxId, {
    outboxId,
    meetingId: input.meetingId || input.meeting_id || "",
    targetKind: input.targetKind || input.target_kind || "group",
    targetRef: input.targetRef || input.target_ref || "",
    messageType: input.messageType || input.message_type || "meeting_live",
    status: input.status || "queued",
    text: input.text || "",
    payload,
    createdAt
  });
  return { outboxId, status: input.status || "queued" };
}

async function ensureRuntimeAgent(paths, input) {
  const runtime = normalizeRuntime(input.runtime);
  const agentId = normalizeAgentId(input.agentId || input.agent_id);
  const agentKey = runtimeAgentKey(runtime, agentId);
  const createdAt = nowIso();
  const displayName = String(input.displayName || input.display_name || "").trim();
  const role = String(input.role || "").trim();
  const endpointRef = String(input.endpointRef || input.endpoint_ref || "").trim();
  const preserveExisting = Boolean(input.preserveExisting || input.preserve_existing);
  const conflictUpdate = preserveExisting ? `
  display_name=CASE WHEN ${sqlValue(displayName)} != '' THEN excluded.display_name ELSE runtime_agents.display_name END,
  role=CASE WHEN ${sqlValue(role)} != '' THEN excluded.role ELSE runtime_agents.role END,
  status=excluded.status,
  endpoint_ref=CASE WHEN ${sqlValue(endpointRef)} != '' THEN excluded.endpoint_ref ELSE runtime_agents.endpoint_ref END,
  capabilities_json=CASE WHEN ${sqlValue(JSON.stringify(parseJsonValue(input.capabilities, input.capabilities || {})))} != '{}' THEN excluded.capabilities_json ELSE runtime_agents.capabilities_json END,
  metadata_json=CASE WHEN ${sqlValue(JSON.stringify(parseJsonValue(input.metadata, input.metadata || {})))} != '{}' THEN excluded.metadata_json ELSE runtime_agents.metadata_json END,
  updated_at=excluded.updated_at;` : `
  display_name=excluded.display_name,
  role=excluded.role,
  status=excluded.status,
  endpoint_ref=excluded.endpoint_ref,
  capabilities_json=excluded.capabilities_json,
  metadata_json=excluded.metadata_json,
  updated_at=excluded.updated_at;`;
  await sqlite(paths.dbFile, `
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
VALUES (${sqlValue(agentKey)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(displayName || agentId)}, ${sqlValue(role)}, ${sqlValue(input.status || "active")}, ${sqlValue(endpointRef)}, ${sqlValue(JSON.stringify(parseJsonValue(input.capabilities, input.capabilities || {})))}, ${sqlValue(JSON.stringify(parseJsonValue(input.metadata, input.metadata || {})))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(agent_key) DO UPDATE SET
${conflictUpdate}`);
  return { agentKey, runtime, agentId };
}

export async function protocolRecord(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  let instrument = null;
  if (input.symbol || input.instrumentId || input.instrument_id) instrument = await upsertInstrumentRecord(paths, input);
  const objectTypeRaw = String(input.objectType || input.object_type || "generic").trim();
  const objectType = PROTOCOL_OBJECT_TYPES.has(objectTypeRaw) ? objectTypeRaw : "generic";
  const objectId = input.objectId || input.object_id || safeId(objectType.replace(/_/g, "-"));
  const status = String(input.status || "recorded").trim();
  const sourceSystem = String(input.sourceSystem || input.source_system || input.source || "openclaw").trim();
  const sourceAgent = String(input.sourceAgent || input.source_agent || input.createdBy || input.from || "cat_claw").trim();
  const payload = {
    objectId,
    objectType,
    status,
    instrumentId: instrument?.instrumentId || input.instrumentId || input.instrument_id || null,
    sourceSystem,
    sourceAgent,
    summary: input.summary || input.text || "",
    payload: parseJsonValue(input.payload, input.payload || {}),
    createdAt: input.createdAt || input.created_at || nowIso()
  };
  const hash = jsonHash(payload);
  const relPath = await writeJsonArtifact(paths.root, path.join(paths.protocolDir, objectType), objectId, { ...payload, hash });
  await sqlite(paths.dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES (${sqlValue(objectId)}, ${sqlValue(objectType)}, ${sqlValue(status)}, ${sqlValue(instrument?.instrumentId || input.instrumentId || input.instrument_id || null)}, ${sqlValue(sourceSystem)}, ${sqlValue(sourceAgent)}, ${sqlValue(input.parentObjectId || input.parent_object_id || "")}, ${sqlValue(relPath)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(hash)}, ${sqlValue(payload.createdAt)}, ${sqlValue(nowIso())})
ON CONFLICT(object_id) DO UPDATE SET
  object_type=excluded.object_type,
  status=excluded.status,
  instrument_id=excluded.instrument_id,
  source_system=excluded.source_system,
  source_agent=excluded.source_agent,
  parent_object_id=excluded.parent_object_id,
  path=excluded.path,
  payload_json=excluded.payload_json,
  hash=excluded.hash,
  updated_at=excluded.updated_at;`);
  return { objectId, objectType, status, instrumentId: instrument?.instrumentId || null, path: path.join(paths.root, relPath), relativePath: relPath, hash, dbFile: paths.dbFile };
}

export async function tradeProposal(rootDir, input) {
  return protocolRecord(rootDir, {
    ...input,
    objectType: "trade_proposal",
    objectId: input.proposalId || input.proposal_id || input.objectId || input.object_id,
    status: input.status || "proposed",
    sourceSystem: input.sourceSystem || input.source_system || "openclaw_hermes",
    sourceAgent: input.sourceAgent || input.source_agent || input.createdBy || input.from || "cat_heart",
    payload: {
      thesisId: input.thesisId || input.thesis_id || "",
      memoId: input.memoId || input.memo_id || "",
      side: input.side || "",
      quantity: input.quantity || "",
      orderType: input.orderType || input.order_type || "",
      priceConstraints: parseJsonValue(input.priceConstraints || input.price_constraints, input.priceConstraints || input.price_constraints || {}),
      riskLimits: parseJsonValue(input.riskLimits || input.risk_limits, input.riskLimits || input.risk_limits || {}),
      rationale: input.rationale || input.summary || input.text || "",
      raw: parseJsonValue(input.payload, input.payload || {})
    }
  });
}

export async function riskDecision(rootDir, input) {
  const statusRaw = String(input.status || "pending").trim();
  const status = RISK_DECISION_STATUSES.has(statusRaw) ? statusRaw : "pending";
  return protocolRecord(rootDir, {
    ...input,
    objectType: "risk_decision",
    objectId: input.riskDecisionId || input.risk_decision_id || input.decisionId || input.decision_id || input.objectId || input.object_id,
    parentObjectId: input.proposalId || input.proposal_id || input.parentObjectId || input.parent_object_id || "",
    status,
    sourceSystem: input.sourceSystem || input.source_system || "openclaw",
    sourceAgent: input.sourceAgent || input.source_agent || input.reviewerAgent || input.reviewer_agent || "cat_tail",
    payload: {
      proposalId: input.proposalId || input.proposal_id || "",
      reviewerAgent: input.reviewerAgent || input.reviewer_agent || "cat_tail",
      riskBudgetImpact: input.riskBudgetImpact || input.risk_budget_impact || "",
      decision: status,
      summary: input.summary || input.text || "",
      raw: parseJsonValue(input.payload, input.payload || {})
    }
  });
}

export async function workflowHumanGateRecord(rootDir, input) {
  const statusRaw = String(input.status || "pending").trim();
  const status = HUMAN_GATE_STATUSES.has(statusRaw) ? statusRaw : "pending";
  return protocolRecord(rootDir, {
    ...input,
    objectType: "human_gate_record",
    objectId: input.humanGateId || input.human_gate_id || input.gateId || input.gate_id || input.objectId || input.object_id,
    parentObjectId: input.parentObjectId || input.parent_object_id || input.riskDecisionId || input.risk_decision_id || input.proposalId || input.proposal_id || "",
    status,
    sourceSystem: input.sourceSystem || input.source_system || "local_codex",
    sourceAgent: input.sourceAgent || input.source_agent || input.from || "flashcat",
    payload: {
      gateType: input.gateType || input.gate_type || "high_risk_trade_execution",
      actor: input.actor || input.from || "flashcat",
      assurance: input.assurance || input.authAssurance || "",
      expiresAt: input.expiresAt || input.expires_at || "",
      decisionAt: ["approved", "rejected", "expired"].includes(status) ? nowIso() : "",
      resumePointer: input.resumePointer || input.resume_pointer || input.dispatchId || input.dispatch_id || "",
      workflowId: input.workflowId || input.workflow_id || "",
      traceId: input.traceId || input.trace_id || "",
      summary: input.summary || input.text || "",
      raw: parseJsonValue(input.payload, input.payload || {})
    }
  });
}

export async function tradeIntent(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
  if (idempotencyKey) {
    const existing = await sqlite(paths.dbFile, `SELECT * FROM executable_trade_intents WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
    if (existing[0]) return { ...existing[0], idempotentReplay: true, dbFile: paths.dbFile };
  }

  const instrument = await upsertInstrumentRecord(paths, input);
  const intentId = input.intentId || input.intent_id || safeId("intent");
  const proposalId = String(input.proposalId || input.proposal_id || "").trim();
  const riskDecisionId = String(input.riskDecisionId || input.risk_decision_id || "").trim();
  const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
  const sideRaw = String(input.side || "").trim().toLowerCase();
  const side = TRADE_SIDES.has(sideRaw) ? sideRaw : "";
  const orderTypeRaw = String(input.orderType || input.order_type || "limit").trim().toLowerCase();
  const orderType = ORDER_TYPES.has(orderTypeRaw) ? orderTypeRaw : "limit";
  const actor = String(input.actor || input.from || "").trim().toLowerCase();
  const assurance = String(input.assurance || input.authAssurance || input.auth_assurance || input.auth?.assurance || "").trim().toLowerCase();
  const sourceSystem = String(input.sourceSystem || input.source_system || input.source || "unknown").trim();
  const clientCertFingerprint = String(input.clientCertFingerprint || input.client_cert_fingerprint || input.cert || "").trim();
  const proposal = await readProtocolObject(paths, proposalId);
  const risk = await readProtocolObject(paths, riskDecisionId);
  const humanGate = await readProtocolObject(paths, humanGateId);
  const rejectionReasons = [];

  if (!proposalId || !proposal || proposal.object_type !== "trade_proposal") rejectionReasons.push("missing_valid_trade_proposal");
  if (!riskDecisionId || !risk || risk.object_type !== "risk_decision" || risk.status !== "approved") rejectionReasons.push("missing_approved_cat_tail_risk_decision");
  if (!humanGateId || !humanGate || humanGate.object_type !== "human_gate_record" || humanGate.status !== "approved") rejectionReasons.push("missing_approved_flashcat_human_gate");
  if (actor !== "flashcat") rejectionReasons.push("actor_must_be_flashcat");
  if (!["mtls", "codex_mtls", "local_codex_mtls"].includes(assurance) && sourceSystem !== "codex_mtls") rejectionReasons.push("local_codex_mtls_required");
  if (!clientCertFingerprint) rejectionReasons.push("client_cert_fingerprint_required");
  if (!side) rejectionReasons.push("invalid_trade_side");

  const status = rejectionReasons.length ? "rejected" : "ready_for_trading_core";
  const createdAt = nowIso();
  const payload = {
    intentId,
    status,
    instrumentId: instrument.instrumentId,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    side,
    quantity: numberOrNull(input.quantity),
    orderType,
    proposalId,
    riskDecisionId,
    humanGateId,
    sourceSystem,
    actor,
    assurance,
    clientCertFingerprint,
    priceConstraints: parseJsonValue(input.priceConstraints || input.price_constraints, input.priceConstraints || input.price_constraints || {}),
    riskLimits: parseJsonValue(input.riskLimits || input.risk_limits, input.riskLimits || input.risk_limits || {}),
    expiresAt: input.expiresAt || input.expires_at || "",
    rejectionReasons,
    raw: parseJsonValue(input.payload, input.payload || {})
  };
  const intentHash = jsonHash(payload);
  const relPath = await writeJsonArtifact(paths.root, paths.intentsDir, intentId, { ...payload, intentHash });
  await sqlite(paths.dbFile, `
INSERT INTO executable_trade_intents(intent_id, status, instrument_id, asset_type, symbol, side, quantity, order_type, proposal_id, risk_decision_id, human_gate_id, source_system, actor, assurance, client_cert_fingerprint, idempotency_key, intent_hash, payload_json, rejection_reason, created_at, updated_at)
VALUES (${sqlValue(intentId)}, ${sqlValue(status)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(instrument.assetType)}, ${sqlValue(instrument.symbol)}, ${sqlValue(side || sideRaw)}, ${sqlValue(numberOrNull(input.quantity))}, ${sqlValue(orderType)}, ${sqlValue(proposalId)}, ${sqlValue(riskDecisionId)}, ${sqlValue(humanGateId)}, ${sqlValue(sourceSystem)}, ${sqlValue(actor)}, ${sqlValue(assurance)}, ${sqlValue(clientCertFingerprint)}, ${sqlValue(idempotencyKey)}, ${sqlValue(intentHash)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(rejectionReasons.join(","))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  await protocolRecord(rootDir, {
    ...input,
    objectType: "executable_trade_intent",
    objectId: intentId,
    instrumentId: instrument.instrumentId,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    parentObjectId: humanGateId,
    status,
    sourceSystem,
    sourceAgent: actor || "unknown",
    payload: { ...payload, intentHash, relativePath: relPath }
  });
  return { intentId, status, rejectionReasons, instrumentId: instrument.instrumentId, path: path.join(paths.root, relPath), relativePath: relPath, intentHash, dbFile: paths.dbFile };
}

export async function tradingCoreReceipt(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const intentId = String(input.intentId || input.intent_id || "").trim();
  if (!intentId) throw new Error("intentId is required");
  const intents = await sqlite(paths.dbFile, `SELECT * FROM executable_trade_intents WHERE intent_id=${sqlValue(intentId)} LIMIT 1;`, { json: true });
  if (!intents[0]) throw new Error(`unknown intentId: ${intentId}`);
  const statusRaw = String(input.status || "accepted").trim();
  const status = RECEIPT_STATUSES.has(statusRaw) ? statusRaw : "accepted";
  const receiptId = input.receiptId || input.receipt_id || safeId("receipt");
  const createdAt = nowIso();
  const payload = {
    receiptId,
    intentId,
    status,
    tradingCoreRef: input.tradingCoreRef || input.trading_core_ref || "",
    sourceSystem: input.sourceSystem || input.source_system || "trading_core",
    summary: input.summary || input.text || "",
    raw: parseJsonValue(input.payload, input.payload || {})
  };
  const relPath = await writeJsonArtifact(paths.root, paths.receiptsDir, receiptId, payload);
  await sqlite(paths.dbFile, `
INSERT INTO trading_core_receipts(receipt_id, intent_id, status, trading_core_ref, source_system, payload_json, created_at)
VALUES (${sqlValue(receiptId)}, ${sqlValue(intentId)}, ${sqlValue(status)}, ${sqlValue(payload.tradingCoreRef)}, ${sqlValue(payload.sourceSystem)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)});
UPDATE executable_trade_intents
SET status=${sqlValue(status === "rejected" || status === "failed" ? "trading_core_rejected" : `trading_core_${status}`)}, updated_at=${sqlValue(createdAt)}
WHERE intent_id=${sqlValue(intentId)};`);
  await protocolRecord(rootDir, {
    objectType: "trading_core_receipt",
    objectId: receiptId,
    parentObjectId: intentId,
    status,
    sourceSystem: payload.sourceSystem,
    sourceAgent: "trading_core",
    payload: { ...payload, relativePath: relPath }
  });
  return { receiptId, intentId, status, tradingCoreRef: payload.tradingCoreRef, path: path.join(paths.root, relPath), relativePath: relPath, dbFile: paths.dbFile };
}

export async function sideEffectRecord(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const sideEffectId = input.sideEffectId || input.side_effect_id || safeId("side_effect");
  const createdAt = nowIso();
  const payload = parseJsonValue(input.payload, input.payload || {});
  const status = String(input.status || "planned").trim();
  const sideEffectType = String(input.sideEffectType || input.side_effect_type || input.type || "generic").trim();
  await sqlite(paths.dbFile, `
INSERT INTO side_effect_ledger(side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, input_hash, output_hash, artifact_ref, payload_json, created_at, updated_at)
VALUES (${sqlValue(sideEffectId)}, ${sqlValue(input.traceId || input.trace_id || "")}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.dispatchId || input.dispatch_id || "")}, ${sqlValue(input.idempotencyKey || input.idempotency_key || "")}, ${sqlValue(input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "")}, ${sqlValue(sideEffectType)}, ${sqlValue(status)}, ${sqlValue(input.inputHash || input.input_hash || jsonHash(payload))}, ${sqlValue(input.outputHash || input.output_hash || "")}, ${sqlValue(input.artifactRef || input.artifact_ref || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(side_effect_id) DO UPDATE SET
  status=excluded.status,
  output_hash=CASE WHEN excluded.output_hash != '' THEN excluded.output_hash ELSE side_effect_ledger.output_hash END,
  artifact_ref=CASE WHEN excluded.artifact_ref != '' THEN excluded.artifact_ref ELSE side_effect_ledger.artifact_ref END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  return { sideEffectId, sideEffectType, status, dbFile: paths.dbFile };
}

function renderIncidentMarkdown(record) {
  const affectedPlanes = record.affectedPlanes.length ? record.affectedPlanes.join(", ") : "unspecified";
  const timeline = record.timeline.length ? record.timeline.map((item) => `- ${item}`).join("\n") : "- none";
  return `# Cat-System Incident State

- incident_id: ${record.incidentId}
- status: ${record.status}
- mode: ${record.mode}
- declared_at: ${record.declaredAt}
- updated_at: ${record.updatedAt}
- next_update_at: ${record.nextUpdateAt || "unset"}
- commander: ${record.commander || "unset"}
- affected_planes: ${affectedPlanes}

## Summary

${record.summary || "No summary recorded."}

## Impact

${record.impact || "Not recorded."}

## Current Hypothesis

${record.currentHypothesis || "Not recorded."}

## Active Mitigation

${record.mitigation || "Not recorded."}

## Rollback Options

${record.rollbackOptions || "Not recorded."}

## Exit Criteria

${record.exitCriteria || "Not recorded."}

## Timeline

${timeline}
`;
}

export async function incidentState(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const incidentId = input.incidentId || input.incident_id || safeId("incident");
  const createdAt = nowIso();
  const statusRaw = String(input.status || "active").trim();
  const status = INCIDENT_STATUSES.has(statusRaw) ? statusRaw : "active";
  const modeRaw = String(input.mode || (status === "resolved" ? "normal" : "degraded")).trim();
  const mode = INCIDENT_MODES.has(modeRaw) ? modeRaw : "degraded";
  const timeline = toList(input.timeline).length ? toList(input.timeline) : [`${createdAt} ${input.summary || input.text || "incident state recorded"}`];
  const payload = parseJsonValue(input.payload, input.payload || {});
  const record = {
    incidentId,
    status,
    mode,
    affectedPlanes: toList(input.affectedPlanes || input.affected_planes),
    summary: input.summary || input.text || "",
    commander: input.commander || input.actor || "flashcat",
    impact: input.impact || "",
    currentHypothesis: input.currentHypothesis || input.current_hypothesis || "",
    mitigation: input.mitigation || "",
    rollbackOptions: input.rollbackOptions || input.rollback_options || "",
    exitCriteria: input.exitCriteria || input.exit_criteria || "",
    timeline,
    declaredAt: input.declaredAt || input.declared_at || createdAt,
    nextUpdateAt: input.nextUpdateAt || input.next_update_at || "",
    payload,
    updatedAt: createdAt
  };
  const jsonRelPath = await writeJsonArtifact(paths.root, path.join(paths.bridgeDir, "incidents"), incidentId, record);
  const markdownRelPath = await writeTextArtifact(paths.root, path.join(paths.bridgeDir, "incidents"), incidentId, "md", renderIncidentMarkdown(record));
  await sqlite(paths.dbFile, `
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES (${sqlValue(incidentId)}, ${sqlValue(status)}, ${sqlValue(mode)}, ${sqlValue(JSON.stringify(record.affectedPlanes))}, ${sqlValue(record.summary)}, ${sqlValue(record.commander)}, ${sqlValue(record.impact)}, ${sqlValue(record.currentHypothesis)}, ${sqlValue(record.mitigation)}, ${sqlValue(record.rollbackOptions)}, ${sqlValue(record.exitCriteria)}, ${sqlValue(JSON.stringify(timeline))}, ${sqlValue(JSON.stringify({ ...payload, jsonRelPath, markdownRelPath }))}, ${sqlValue(record.declaredAt)}, ${sqlValue(record.nextUpdateAt)}, ${sqlValue(status === "resolved" ? createdAt : "")}, ${sqlValue(createdAt)})
ON CONFLICT(incident_id) DO UPDATE SET
  status=excluded.status,
  mode=excluded.mode,
  affected_planes_json=excluded.affected_planes_json,
  summary=excluded.summary,
  commander=excluded.commander,
  impact=excluded.impact,
  current_hypothesis=excluded.current_hypothesis,
  mitigation=excluded.mitigation,
  rollback_options=excluded.rollback_options,
  exit_criteria=excluded.exit_criteria,
  timeline_json=excluded.timeline_json,
  payload_json=excluded.payload_json,
  next_update_at=excluded.next_update_at,
  resolved_at=excluded.resolved_at,
  updated_at=excluded.updated_at;`);
  return { incidentId, status, mode, relativePath: markdownRelPath, jsonRelativePath: jsonRelPath, markdownRelativePath: markdownRelPath, dbFile: paths.dbFile };
}

export async function runtimeAgentUpsert(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const agent = await ensureRuntimeAgent(paths, { ...input, preserveExisting: true });
  return { ...agent, dbFile: paths.dbFile };
}

export async function meetingRuntimeParticipant(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const agent = await ensureRuntimeAgent(paths, input);
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

export async function telegramLiveConfigure(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const createdAt = nowIso();
  const mode = String(input.mode || "transparent").trim();
  const status = String(input.status || "active").trim();
  const target = await resolveTelegramLiveTarget(paths, meetingId, input);
  if (status === "active" && mode !== "silent" && !target.chatId && !target.channelId) {
    throw new Error(`telegram live target is required for active ${mode} meeting: ${meetingId}`);
  }
  const humanGateChannelId = target.humanGateChannelId || input.humanGateChannelId || input.human_gate_channel_id || target.channelId || target.chatId || "";
  await sqlite(paths.dbFile, `
INSERT INTO telegram_live_links(meeting_id, chat_id, channel_id, mode, status, human_gate_channel_id, created_at, updated_at)
VALUES (${sqlValue(meetingId)}, ${sqlValue(target.chatId)}, ${sqlValue(target.channelId)}, ${sqlValue(mode)}, ${sqlValue(status)}, ${sqlValue(humanGateChannelId)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(meeting_id) DO UPDATE SET
  chat_id=excluded.chat_id,
  channel_id=excluded.channel_id,
  mode=excluded.mode,
  status=excluded.status,
  human_gate_channel_id=excluded.human_gate_channel_id,
  updated_at=excluded.updated_at;`);
  return { meetingId, chatId: target.chatId, channelId: target.channelId, humanGateChannelId, mode, status, targetSource: target.source, dbFile: paths.dbFile };
}

async function telegramLinkFor(paths, meetingId) {
  const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_live_links WHERE meeting_id=${sqlValue(meetingId)} AND status='active' LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function meetingDispatch(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const runtime = normalizeRuntime(input.runtime);
  const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || "main");
  const agent = await ensureRuntimeAgent(paths, { runtime, agentId, displayName: input.displayName || input.display_name || "", preserveExisting: true });
  const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
  const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
  if (idempotencyKey) {
    const existing = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
    if (existing[0]) {
      return {
        meetingId,
        dispatchId: existing[0].dispatch_id,
        runtime: existing[0].runtime,
        agentId: existing[0].agent_id,
        status: existing[0].status,
        traceId: existing[0].trace_id,
        idempotencyKey,
        deduped: true,
        dbFile: paths.dbFile
      };
    }
  }
  const dispatchId = input.dispatchId || input.dispatch_id || safeId("dispatch");
  const status = DISPATCH_STATUSES.has(String(input.status || "queued")) ? String(input.status || "queued") : "queued";
  const createdAt = nowIso();
  const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || input.max_attempts || 1)));
  const payload = {
    meetingId,
    workflowId,
    traceId,
    idempotencyKey,
    dispatchId,
    runtime,
    agentId,
    dispatchType: input.dispatchType || input.dispatch_type || "discussion_turn",
    prompt: input.prompt || input.text || "",
    phase: input.phase || "",
    chair: input.chair || input.createdBy || input.created_by || "main",
    attempt: 0,
    maxAttempts,
    payload: parseJsonValue(input.payload, input.payload || {})
  };
  await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(dispatchId)}, ${sqlValue(meetingId)}, ${sqlValue(workflowId)}, ${sqlValue(traceId)}, ${sqlValue(idempotencyKey)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(payload.dispatchType)}, ${sqlValue(status)}, ${sqlValue(input.priority || "normal")}, 0, ${sqlValue(maxAttempts)}, ${sqlValue(payload.prompt)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(payload.chair)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  const relPath = await writeJsonArtifact(paths.root, path.join(paths.dispatchesDir, status), dispatchId, payload);
  return { meetingId, workflowId, traceId, idempotencyKey, dispatchId, runtime, agentId, status, relativePath: relPath, dbFile: paths.dbFile };
}

export async function meetingIngest(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const runtime = normalizeRuntime(input.runtime);
  const agentId = normalizeAgentId(input.agentId || input.agent_id || input.from || "unknown");
  const agent = await ensureRuntimeAgent(paths, { runtime, agentId, displayName: input.displayName || input.display_name || "", preserveExisting: true });
  const messageId = input.messageId || input.message_id || safeId("msg");
  const createdAt = nowIso();
  const text = String(input.text || input.summary || "").trim();
  if (!text) throw new Error("text is required");
  const messageType = String(input.messageType || input.message_type || "agent_message").trim();
  const payload = parseJsonValue(input.payload, input.payload || {});
  await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_messages(message_id, meeting_id, runtime, agent_id, agent_key, message_type, phase, text, payload_json, telegram_live_status, created_at)
VALUES (${sqlValue(messageId)}, ${sqlValue(meetingId)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(messageType)}, ${sqlValue(input.phase || "")}, ${sqlValue(text)}, ${sqlValue(JSON.stringify(payload))}, 'pending', ${sqlValue(createdAt)});`);
  await appendJsonl(path.join(paths.messagesDir, `${cleanFileSegment(meetingId)}.messages.jsonl`), { messageId, meetingId, runtime, agentId, messageType, text, payload, createdAt });
  const transcriptPath = await appendTranscript(paths, meetingId, `- ${createdAt} [${runtime}:${agentId}] ${text}`);
  const link = await telegramLinkFor(paths, meetingId);
  let telegramOutbox = null;
  if (link && String(link.mode || "transparent") !== "silent") {
    const targetRef = link.chat_id || link.channel_id || "";
    if (targetRef) {
      telegramOutbox = await enqueueTelegramOutbox(paths, {
        meetingId,
        targetKind: "group",
        targetRef,
        messageType: "meeting_live",
        text: `[${runtime}:${agentId}] ${text}`,
        payload: { messageId, runtime, agentId, phase: input.phase || "" }
      });
      await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status='queued' WHERE message_id=${sqlValue(messageId)};`);
    } else {
      await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status='failed_missing_target' WHERE message_id=${sqlValue(messageId)};`);
    }
  }
  return { meetingId, messageId, runtime, agentId, transcriptPath, telegramOutbox, dbFile: paths.dbFile };
}

function hermesProfileFromEndpoint(endpointRef, agentId) {
  const endpoint = String(endpointRef || "").trim();
  if (endpoint.startsWith("hermes-profile:")) return endpoint.slice("hermes-profile:".length).trim();
  if (endpoint.startsWith("profile:")) return endpoint.slice("profile:".length).trim();
  return String(agentId || "").replace(/_/g, "").trim();
}

function buildRuntimeBridgePrompt(row) {
  const payload = parseJsonValue(row.payload_json, {});
  const role = row.role ? `Runtime role: ${row.role}` : "";
  const createdBy = row.created_by || payload.chair || "main";
  const invocationTs = nowIso();
  return [
    "You are being invoked by trading-agents-workflow through the OpenClaw gateway control plane.",
    "Treat this as one assigned collaboration turn in a mixed-runtime trading_agents workflow.",
    "OpenClaw Gateway is the information/workflow hub; trading-agents-workflow is the trading workflow scheduler; Hermes is the agent runtime container; ACP is the standard Hermes invocation channel.",
    "",
    `Invocation timestamp: ${invocationTs}`,
    `Meeting ID: ${row.meeting_id}`,
    `Dispatch ID: ${row.dispatch_id}`,
    `Assigned agent: ${row.runtime}:${row.agent_id}`,
    `Created by: ${createdBy}`,
    role,
    `Dispatch type: ${row.dispatch_type || payload.dispatchType || "discussion_turn"}`,
    "",
    "Task:",
    row.prompt || payload.prompt || "",
    "",
    "Output requirements:",
    "- Return the final answer only.",
    "- Include an ISO timestamp in the answer.",
    "- State evidence, assumptions, uncertainty, and next workflow action clearly.",
    "- Do not bypass Human Gate.",
    "- Do not execute live trades or create executable trade intents.",
    "- If a structured workflow object is needed, name the intended object type such as research_signal, evidence_pack, research_memo, trade_proposal, risk_decision, or artifact."
  ].filter(Boolean).join("\n");
}

async function updateDispatch(paths, dispatchId, status, patch = {}) {
  const rows = await sqlite(paths.dbFile, `SELECT payload_json FROM mixed_meeting_dispatches WHERE dispatch_id=${sqlValue(dispatchId)} LIMIT 1;`, { json: true });
  const currentPayload = parseJsonValue(rows[0]?.payload_json, {});
  const payload = { ...currentPayload, bridge: { ...(currentPayload.bridge || {}), ...patch, updatedAt: nowIso() } };
  const assignments = [
    `status=${sqlValue(status)}`,
    `payload_json=${sqlValue(JSON.stringify(payload))}`,
    `updated_at=${sqlValue(nowIso())}`
  ];
  if (patch.startedAt || patch.sentAt) assignments.push(`sent_at=${sqlValue(patch.startedAt || patch.sentAt)}`);
  if (patch.completedAt || patch.ackedAt) assignments.push(`acked_at=${sqlValue(patch.completedAt || patch.ackedAt)}`, `completed_at=${sqlValue(patch.completedAt || patch.ackedAt)}`);
  if (patch.failedAt) assignments.push(`completed_at=${sqlValue(patch.failedAt)}`);
  if (patch.failureType) assignments.push(`failure_type=${sqlValue(patch.failureType)}`);
  if (patch.error) assignments.push(`last_error=${sqlValue(String(patch.error).slice(0, 2000))}`);
  if (patch.nextRetryAt) assignments.push(`next_retry_at=${sqlValue(patch.nextRetryAt)}`);
  if (patch.attempt !== undefined) assignments.push(`attempt=${sqlValue(Number(patch.attempt) || 0)}`);
  await sqlite(paths.dbFile, `
UPDATE mixed_meeting_dispatches
SET ${assignments.join(", ")}
WHERE dispatch_id=${sqlValue(dispatchId)};`);
}

function classifyRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out")) return "runtime_timeout";
  if (lower.includes("acp runtime backend") || lower.includes("acp") && lower.includes("unavailable")) return "acp_unavailable";
  if (lower.includes("oauth") || lower.includes("auth")) return "auth_unavailable";
  if (lower.includes("empty output")) return "empty_output";
  if (lower.includes("schema") || lower.includes("validation")) return "schema_validation";
  if (lower.includes("guardrail")) return "guardrail_block";
  if (lower.includes("stale")) return "stale_input";
  return "transient_runtime";
}

function nextRetryAt(attempt) {
  const base = Math.min(900, 30 * Math.max(1, 2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.min(30, base));
  return new Date(Date.now() + (base + jitter) * 1000).toISOString();
}

async function recordRuntimeRun(paths, row, data) {
  const startedAt = data.startedAt || nowIso();
  const completedAt = data.completedAt || data.failedAt || null;
  const latencyMs = completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null;
  const runtimeRunId = data.runtimeRunId || safeId("runtime_run");
  const payload = parseJsonValue(row.payload_json, {});
  await sqlite(paths.dbFile, `
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES (${sqlValue(runtimeRunId)}, ${sqlValue(row.dispatch_id)}, ${sqlValue(row.meeting_id)}, ${sqlValue(row.workflow_id || payload.workflowId || "")}, ${sqlValue(row.trace_id || payload.traceId || "")}, ${sqlValue(row.runtime)}, ${sqlValue(row.agent_id)}, ${sqlValue(data.adapter || "")}, ${sqlValue(data.backend || "")}, ${sqlValue(data.acpAgent || "")}, ${sqlValue(data.sessionKey || "")}, ${sqlValue(data.status || "started")}, ${sqlValue(data.failureType || "")}, ${sqlValue(Number(data.attempt ?? row.attempt ?? 0) || 0)}, ${sqlValue(startedAt)}, ${sqlValue(completedAt)}, ${sqlValue(latencyMs)}, ${sqlValue(data.messageId || "")}, ${sqlValue(data.inputHash || textHash(row.prompt || payload.prompt || ""))}, ${sqlValue(data.outputHash || "")}, ${sqlValue(data.error ? String(data.error).slice(0, 2000) : "")}, ${sqlValue(JSON.stringify(data.payload || {}))});`);
  return runtimeRunId;
}

async function runHermesDispatch(paths, row, input = {}) {
  const hermesBin = resolveHome(input.hermesBin || input.hermes_bin || process.env.HERMES_BIN || "/home/flashcat/hermes-agent/venv/bin/hermes");
  const proxyEnv = {
    HTTP_PROXY: input.httpProxy || input.http_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890",
    HTTPS_PROXY: input.httpsProxy || input.https_proxy || process.env.HTTPS_PROXY || "http://127.0.0.1:7890",
    ALL_PROXY: input.allProxy || input.all_proxy || process.env.ALL_PROXY || "socks5://127.0.0.1:7890"
  };
  const profile = hermesProfileFromEndpoint(row.endpoint_ref, row.agent_id);
  if (!profile) throw new Error(`Hermes profile is required for ${row.agent_id}`);
  const timeoutSeconds = Math.max(30, Math.min(3600, Number(input.timeoutSeconds || input.timeout_seconds || 900)));
  const prompt = buildRuntimeBridgePrompt(row);
  const args = ["--profile", profile, "--accept-hooks", "-z", prompt];
  const startedAt = nowIso();
  const attempt = Number(row.attempt || 0) + 1;
  await updateDispatch(paths, row.dispatch_id, "sent", { adapter: "hermes", profile, startedAt, attempt });
  const runtimeRunId = await recordRuntimeRun(paths, row, { adapter: "hermes", status: "started", startedAt, attempt, payload: { profile } });
  await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
    event: "runtime_dispatch_started",
    dispatchId: row.dispatch_id,
    meetingId: row.meeting_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    adapter: "hermes",
    profile,
    startedAt,
    attempt,
    runtimeRunId
  });
  try {
    const { stdout, stderr } = await execFileAsync(hermesBin, args, {
      cwd: paths.root,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, ...proxyEnv, HERMES_ACCEPT_HOOKS: "1" }
    });
    const text = String(stdout || "").trim();
    if (!text) throw new Error(String(stderr || "Hermes returned empty output").trim());
    const completedAt = nowIso();
    const outputHash = textHash(text);
    const ingest = await meetingIngest(paths.root, {
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      text,
      messageType: row.dispatch_type || "agent_message",
      phase: "runtime_bridge",
      payload: {
        dispatchId: row.dispatch_id,
        adapter: "hermes",
        profile,
        stderr: String(stderr || "").trim().slice(0, 2000)
      }
    });
    await updateDispatch(paths, row.dispatch_id, "acked", { adapter: "hermes", profile, completedAt, messageId: ingest.messageId, attempt });
    await recordRuntimeRun(paths, row, { runtimeRunId: safeId("runtime_run_ack"), adapter: "hermes", status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { profile } });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      event: "runtime_dispatch_acked",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "hermes",
      profile,
      messageId: ingest.messageId,
      completedAt,
      attempt,
      runtimeRunId
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: "acked", profile, messageId: ingest.messageId };
  } catch (error) {
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    const failureType = classifyRuntimeError(error);
    const shouldRetry = AUTO_RETRY_FAILURE_TYPES.has(failureType) && attempt < Number(row.max_attempts || 1);
    await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", { adapter: "hermes", profile, failedAt, error: message.slice(0, 2000), failureType, attempt, nextRetryAt: shouldRetry ? nextRetryAt(attempt) : "" });
    await recordRuntimeRun(paths, row, { adapter: "hermes", status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { profile, retry: shouldRetry } });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      event: "runtime_dispatch_failed",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "hermes",
      profile,
      failureType,
      retryScheduled: shouldRetry,
      error: message.slice(0, 2000),
      failedAt,
      attempt,
      runtimeRunId
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: shouldRetry ? "queued" : "failed", profile, failureType, retryScheduled: shouldRetry, error: message };
  }
}

function hermesAcpAgentFromEndpoint(endpointRef, agentId) {
  const endpoint = String(endpointRef || "").trim();
  const hermesBin = "/home/flashcat/hermes-agent/venv/bin/hermes";
  const commandForProfile = (profile) => profile ? `${hermesBin} -p ${profile} acp --accept-hooks` : "";
  const commandForAlias = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.includes("/") || raw.includes(" ")) return raw;
    if (raw.startsWith("hermes_")) return commandForProfile(raw.slice("hermes_".length));
    return raw;
  };
  if (endpoint.startsWith("acp-agent:")) return commandForAlias(endpoint.slice("acp-agent:".length));
  if (endpoint.startsWith("hermes-acp:")) return commandForAlias(endpoint.slice("hermes-acp:".length));
  const profile = hermesProfileFromEndpoint(endpoint, agentId);
  return commandForProfile(profile.replace(/[^a-zA-Z0-9_-]+/g, "_"));
}

async function resolveAcpBackend(backendId) {
  let module;
  try {
    module = await import("openclaw/plugin-sdk/acp-runtime-backend");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenClaw ACP runtime SDK is unavailable in this process: ${message}`);
  }
  const backend = module.getAcpRuntimeBackend?.(backendId);
  if (!backend?.runtime) throw new Error(`ACP runtime backend is not loaded: ${backendId}`);
  return backend;
}

function acpTextFromEvent(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "text_delta" && (event.stream === undefined || event.stream === "output")) return String(event.text || "");
  return "";
}

async function runHermesAcpDispatch(paths, row, input = {}) {
  const backendId = String(input.acpBackend || input.acp_backend || process.env.TRADING_AGENTS_ACP_BACKEND || "acpx").trim();
  const acpAgent = String(input.acpAgent || input.acp_agent || hermesAcpAgentFromEndpoint(row.endpoint_ref, row.agent_id)).trim();
  if (!acpAgent) throw new Error(`Hermes ACP agent alias is required for ${row.agent_id}`);
  const sessionMode = String(input.sessionMode || input.session_mode || "persistent").trim() === "oneshot" ? "oneshot" : "persistent";
  const timeoutSeconds = Math.max(30, Math.min(3600, Number(input.timeoutSeconds || input.timeout_seconds || 900)));
  const sessionKey = cleanFileSegment(input.sessionKey || input.session_key || `workflow-${row.meeting_id}-${row.agent_id}`);
  const prompt = buildRuntimeBridgePrompt(row);
  const startedAt = nowIso();
  const attempt = Number(row.attempt || 0) + 1;
  await updateDispatch(paths, row.dispatch_id, "sent", { adapter: "hermes_acp", backend: backendId, acpAgent, sessionMode, sessionKey, startedAt, attempt });
  const runtimeRunId = await recordRuntimeRun(paths, row, { adapter: "hermes_acp", backend: backendId, acpAgent, sessionKey, status: "started", startedAt, attempt, payload: { sessionMode } });
  await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
    ts: startedAt,
    event: "runtime_dispatch_started",
    dispatchId: row.dispatch_id,
    meetingId: row.meeting_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    adapter: "hermes_acp",
    backend: backendId,
    acpAgent,
    sessionMode,
    sessionKey,
    attempt,
    runtimeRunId
  });
  let timeout = null;
  const controller = new AbortController();
  try {
    const backend = await resolveAcpBackend(backendId);
    const handle = await backend.runtime.ensureSession({
      sessionKey,
      agent: acpAgent,
      mode: sessionMode,
      cwd: paths.root
    });
    timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    const chunks = [];
    const acpEvents = [];
    for await (const event of backend.runtime.runTurn({
      handle,
      text: prompt,
      mode: "prompt",
      requestId: row.dispatch_id,
      signal: controller.signal
    })) {
      if (event?.type === "error") throw new Error(event.message || "ACP runtime turn failed");
      const text = acpTextFromEvent(event);
      if (text) chunks.push(text);
      if (event?.type && event.type !== "text_delta") {
        acpEvents.push({
          type: event.type,
          text: String(event.text || event.message || "").slice(0, 1000),
          tag: event.tag || "",
          stopReason: event.stopReason || ""
        });
      }
    }
    const text = chunks.join("").trim();
    if (!text) throw new Error("Hermes ACP returned empty output");
    const completedAt = nowIso();
    const outputHash = textHash(text);
    const ingest = await meetingIngest(paths.root, {
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      text,
      messageType: row.dispatch_type || "agent_message",
      phase: "runtime_bridge_acp",
      payload: {
        dispatchId: row.dispatch_id,
        adapter: "hermes_acp",
        backend: backendId,
        acpAgent,
        sessionMode,
        sessionKey,
        handle,
        events: acpEvents.slice(-20)
      }
    });
    await updateDispatch(paths, row.dispatch_id, "acked", { adapter: "hermes_acp", backend: backendId, acpAgent, completedAt, messageId: ingest.messageId, attempt });
    await recordRuntimeRun(paths, row, { runtimeRunId: safeId("runtime_run_ack"), adapter: "hermes_acp", backend: backendId, acpAgent, sessionKey, status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { sessionMode, events: acpEvents.slice(-20) } });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      ts: completedAt,
      event: "runtime_dispatch_acked",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "hermes_acp",
      backend: backendId,
      acpAgent,
      sessionMode,
      sessionKey,
      messageId: ingest.messageId,
      completedAt,
      attempt,
      runtimeRunId
    });
    if (sessionMode === "oneshot") await backend.runtime.close({ handle, reason: "trading-agents-workflow oneshot completed", discardPersistentState: true }).catch(() => {});
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: "acked", adapter: "hermes_acp", backend: backendId, acpAgent, sessionKey, messageId: ingest.messageId };
  } catch (error) {
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    const failureType = classifyRuntimeError(error);
    const shouldRetry = AUTO_RETRY_FAILURE_TYPES.has(failureType) && attempt < Number(row.max_attempts || 1);
    await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", { adapter: "hermes_acp", backend: backendId, acpAgent, failedAt, error: message.slice(0, 2000), failureType, attempt, nextRetryAt: shouldRetry ? nextRetryAt(attempt) : "" });
    await recordRuntimeRun(paths, row, { adapter: "hermes_acp", backend: backendId, acpAgent, sessionKey, status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { sessionMode, retry: shouldRetry } });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      ts: failedAt,
      event: "runtime_dispatch_failed",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "hermes_acp",
      backend: backendId,
      acpAgent,
      sessionMode,
      sessionKey,
      failureType,
      retryScheduled: shouldRetry,
      error: message.slice(0, 2000),
      failedAt,
      attempt,
      runtimeRunId
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: shouldRetry ? "queued" : "failed", adapter: "hermes_acp", backend: backendId, acpAgent, sessionKey, failureType, retryScheduled: shouldRetry, error: message };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runtimeBridgeDrain(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const runtime = normalizeRuntime(input.runtime || "hermes");
  const limit = Math.max(1, Math.min(20, Number(input.limit || 1)));
  const dryRun = Boolean(input.dryRun || input.dry_run);
  const rows = await sqlite(paths.dbFile, `
SELECT d.*, a.display_name, a.role, a.endpoint_ref
FROM mixed_meeting_dispatches d
LEFT JOIN runtime_agents a ON a.agent_key=d.agent_key
WHERE d.status='queued' AND d.runtime=${sqlValue(runtime)}
  AND (d.next_retry_at IS NULL OR d.next_retry_at='' OR d.next_retry_at <= ${sqlValue(nowIso())})
ORDER BY d.created_at
LIMIT ${limit};`, { json: true });
  if (dryRun) return { runtime, dryRun: true, count: rows.length, dispatches: rows.map((row) => ({ dispatchId: row.dispatch_id, meetingId: row.meeting_id, workflowId: row.workflow_id, traceId: row.trace_id, agentId: row.agent_id, attempt: row.attempt, maxAttempts: row.max_attempts, endpointRef: row.endpoint_ref })) };
  const results = [];
  for (const row of rows) {
    if (runtime === "hermes_acp") {
      results.push(await runHermesAcpDispatch(paths, row, input));
    } else if (runtime === "hermes") {
      results.push(await runHermesDispatch(paths, row, input));
    } else {
      await updateDispatch(paths, row.dispatch_id, "failed", { adapter: "none", failedAt: nowIso(), error: `runtime adapter not implemented: ${runtime}` });
      results.push({ dispatchId: row.dispatch_id, runtime, agentId: row.agent_id, status: "failed", error: `runtime adapter not implemented: ${runtime}` });
    }
  }
  return { runtime, count: rows.length, results, dbFile: paths.dbFile };
}

export async function humanGateRequest(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const gate = await workflowHumanGateRecord(rootDir, {
    ...input,
    status: "pending",
    sourceSystem: input.sourceSystem || input.source_system || "openclaw",
    sourceAgent: input.sourceAgent || input.source_agent || input.from || "main"
  });
  const eventId = safeId("control");
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'human_gate_request', 'pending', ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify({ humanGateId: gate.objectId, gateType: input.gateType || input.gate_type || "" }))}, ${sqlValue(input.from || input.sourceAgent || "main")}, ${sqlValue(createdAt)});`);
  const link = await telegramLinkFor(paths, meetingId);
  const telegramOutbox = await enqueueTelegramOutbox(paths, {
    meetingId,
    targetKind: "channel",
    targetRef: input.channelId || input.channel_id || link?.human_gate_channel_id || link?.channel_id || "",
    messageType: "human_gate_request",
    text: input.text || input.summary || "",
    payload: { humanGateId: gate.objectId, gateType: input.gateType || input.gate_type || "", eventId }
  });
  return { meetingId, humanGateId: gate.objectId, eventId, telegramOutbox, status: "pending", dbFile: paths.dbFile };
}

export async function meetingResume(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const eventId = input.eventId || input.event_id || safeId("control");
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'resume', ${sqlValue(input.status || "active")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify(parseJsonValue(input.payload, input.payload || {})))}, ${sqlValue(input.from || "flashcat")}, ${sqlValue(createdAt)});`);
  await appendTranscript(paths, meetingId, `- ${createdAt} [system:resume] ${input.summary || input.text || "meeting resumed"}`);
  return { meetingId, eventId, status: input.status || "active", dbFile: paths.dbFile };
}

export async function meetingDisperse(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const eventId = input.eventId || input.event_id || safeId("control");
  const targets = toList(input.targets || input.target);
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'disperse', 'queued', ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify({ targets, payload: parseJsonValue(input.payload, input.payload || {}) }))}, ${sqlValue(input.from || "main")}, ${sqlValue(createdAt)});`);
  const dispatches = [];
  for (const target of targets) {
    const [runtimePart, agentPart] = target.includes(":") ? target.split(":", 2) : ["openclaw", target];
    dispatches.push(await meetingDispatch(rootDir, {
      meetingId,
      runtime: runtimePart,
      agentId: agentPart,
      dispatchType: "execute_meeting_conclusion",
      prompt: input.summary || input.text || "",
      priority: input.priority || "high",
      createdBy: input.from || "main",
      payload: input.payload
    }));
  }
  return { meetingId, eventId, status: "queued", dispatches, dbFile: paths.dbFile };
}

export async function telegramOutbox(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  if (input.operation === "mark" || input.operation === "update") {
    const outboxId = String(input.outboxId || input.outbox_id || "").trim();
    if (!outboxId) throw new Error("outboxId is required");
    const status = String(input.status || "sent").trim();
    await sqlite(paths.dbFile, `UPDATE telegram_outbox SET status=${sqlValue(status)}, updated_at=${sqlValue(nowIso())} WHERE outbox_id=${sqlValue(outboxId)};`);
    return { outboxId, status, dbFile: paths.dbFile };
  }
  const limit = Math.max(1, Math.min(200, Number(input.limit || 20)));
  const status = String(input.status || "queued").trim();
  const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE status=${sqlValue(status)} ORDER BY created_at LIMIT ${limit};`, { json: true });
  return { status, count: rows.length, rows, dbFile: paths.dbFile };
}

export async function cat_clawAudit(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const staleDays = Number(input.staleDays || input.stale_days || 30);
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
  const staleThesis = await sqlite(paths.dbFile, `
SELECT i.instrument_id, i.asset_type, i.symbol, t.thesis_status, t.thesis_path, t.updated_at
FROM instruments i
LEFT JOIN tracking_states t ON t.instrument_id=i.instrument_id
WHERE t.thesis_path IS NULL OR t.updated_at < ${sqlValue(cutoff)}
ORDER BY i.instrument_id;`, { json: true });
  const missingThreeFace = await sqlite(paths.dbFile, `
SELECT i.instrument_id, i.asset_type, i.symbol, t.radar_zone, t.retail_heat_score, t.news_catalyst_score, t.fundamental_score
FROM instruments i
LEFT JOIN tracking_states t ON t.instrument_id=i.instrument_id
WHERE t.radar_zone IN ('bright','dark','overheated')
  AND (t.retail_heat_score IS NULL OR t.news_catalyst_score IS NULL OR t.fundamental_score IS NULL)
ORDER BY i.instrument_id;`, { json: true });
  const pendingGates = await sqlite(paths.dbFile, `
SELECT gate_id, instrument_id, gate_type, status, summary, human_gate_required, created_at
FROM review_gates
WHERE status='pending' OR human_gate_required=1
ORDER BY created_at DESC;`, { json: true });
  const filePath = path.join(paths.indexDir, `cat_claw-audit-${dailyKey()}.md`);
  const content = `# Catclaw Workflow Audit ${dailyKey()}

## Stale Thesis

${staleThesis.length ? staleThesis.map((row) => `- ${row.instrument_id} updated_at=${row.updated_at || "none"}`).join("\n") : "- none"}

## Missing Three-Face Inputs

${missingThreeFace.length ? missingThreeFace.map((row) => `- ${row.instrument_id} zone=${row.radar_zone} retail=${row.retail_heat_score} news=${row.news_catalyst_score} fundamental=${row.fundamental_score}`).join("\n") : "- none"}

## Pending Gates

${pendingGates.length ? pendingGates.map((row) => `- ${row.gate_id} ${row.instrument_id || ""} ${row.gate_type} status=${row.status} human_gate=${row.human_gate_required}`).join("\n") : "- none"}
`;
  await fs.writeFile(filePath, content, "utf8");
  return { auditFile: filePath, staleThesisCount: staleThesis.length, missingThreeFaceCount: missingThreeFace.length, pendingGateCount: pendingGates.length };
}

export async function runWorkflowAction(rootDir, input = {}) {
  const action = String(input.action || "workflow.status");
  switch (action) {
    case "workflow.init":
    case "trading_workflow.init":
      return workflowInit(rootDir, input);
    case "workflow.status":
    case "trading_workflow.status":
      return workflowStatus(rootDir, input);
    case "workflow.readiness":
    case "trading_workflow.readiness": {
      const paths = await ensureWorkflowLayout(rootDir, input);
      return workflowReadinessSnapshot(paths, input);
    }
    case "workflow.topology":
    case "trading_workflow.topology":
      return workflowTopology(rootDir, input);
    case "workflow.run.upsert":
    case "workflow.initiative.upsert":
      return workflowRunUpsert(rootDir, input);
    case "workflow.task.create":
      return workflowTaskCreate(rootDir, input);
    case "workflow.task.update":
      return workflowTaskUpdate(rootDir, input);
    case "workflow.task.list":
    case "workflow.tasks":
      return workflowTaskList(rootDir, input);
    case "workflow.advance":
      return workflowAdvance(rootDir, input);
    case "workflow.checkpoint":
    case "workflow.context_checkpoint":
    case "context.checkpoint":
      return workflowCheckpoint(rootDir, input);
    case "runtime.agent":
    case "runtime.agent.upsert":
      return runtimeAgentUpsert(rootDir, input);
    case "meeting.runtime_participant":
    case "runtime.participant":
      return meetingRuntimeParticipant(rootDir, input);
    case "telegram.live":
    case "telegram.live.configure":
      return telegramLiveConfigure(rootDir, input);
    case "meeting.dispatch":
      return meetingDispatch(rootDir, input);
    case "meeting.ingest":
      return meetingIngest(rootDir, input);
    case "runtime.bridge":
    case "runtime.bridge.drain":
      return runtimeBridgeDrain(rootDir, input);
    case "human_gate.request":
      return humanGateRequest(rootDir, input);
    case "meeting.resume":
      return meetingResume(rootDir, input);
    case "meeting.disperse":
      return meetingDisperse(rootDir, input);
    case "telegram.outbox":
      return telegramOutbox(rootDir, input);
    case "protocol.record":
    case "protocol.object":
      return protocolRecord(rootDir, input);
    case "trade.proposal":
      return tradeProposal(rootDir, input);
    case "risk.decision":
      return riskDecision(rootDir, input);
    case "human_gate.record":
    case "workflow.human_gate":
      return workflowHumanGateRecord(rootDir, input);
    case "trade.intent":
    case "execution.intent":
      return tradeIntent(rootDir, input);
    case "trading_core.receipt":
    case "execution.receipt":
      return tradingCoreReceipt(rootDir, input);
    case "side_effect.record":
    case "side_effect.ledger":
      return sideEffectRecord(rootDir, input);
    case "incident.state":
    case "workflow.incident":
      return incidentState(rootDir, input);
    case "instrument.upsert":
    case "tracking.instrument":
      return instrumentUpsert(rootDir, input);
    case "radar.update":
      return radarUpdate(rootDir, input);
    case "thesis.update":
    case "thesis.create":
      return thesisUpdate(rootDir, input);
    case "research.evidence":
      return researchEvidence(rootDir, input);
    case "research.memo":
      return researchMemo(rootDir, input);
    case "gate.review":
    case "human_gate.review":
      return gateReview(rootDir, input);
    case "cat_claw.audit":
      return cat_clawAudit(rootDir, input);
    default:
      throw new Error(`unknown workflow action: ${action}`);
  }
}
