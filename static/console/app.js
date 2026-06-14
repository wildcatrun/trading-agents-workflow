import { kanbanPreviewActionModel } from "./preview-actions.js";

const state = {
  consoleView: "command-center",
  view: "active",
  selectedWorkflowId: "",
  tab: "overview",
  workflows: [],
  detail: null,
  lastPayload: null,
  detailSeq: 0,
  searchQuery: "",
  workbenchFilter: "all",
  severityFilter: "all",
  sortMode: "age_desc",
  focusAgentId: "",
  focusCardId: "",
  kanbanScope: "global",
  agentRuntimeFilter: "all",
  agentDispatchFilter: "all",
  agentAttentionFilter: "all",
  scopedActivity: false,
  commandPalette: null,
  commandPaletteQuery: "",
  config: null,
  liveRefreshEnabled: false,
  liveRefreshIntervalMs: 15000,
  liveRefreshInFlight: false,
  liveRefreshLastAt: "",
  recentActionResults: [],
  operationsFilters: {
    kind: "",
    severity: "",
    status: ""
  }
};

const CONSOLE_VIEWS = new Set(["command-center", "activity", "agent-board", "kanban", "evidence-workspace", "operations", "system", "workflows", "search"]);
const WORKBENCH_FILTERS = [
  { id: "all", label: "All" },
  { id: "blocked", label: "Blocked" },
  { id: "stale_ack", label: "Stale ACK" },
  { id: "waiting_receipt", label: "Waiting Receipt" },
  { id: "waiting_human", label: "Waiting Human" },
  { id: "failed_delivery", label: "Failed Delivery" }
];
const SEVERITY_FILTERS = [
  { value: "all", label: "All severity" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "ok", label: "OK" },
  { value: "neutral", label: "Neutral" }
];
const SORT_MODES = [
  { value: "age_desc", label: "Newest first" },
  { value: "age_asc", label: "Oldest first" },
  { value: "severity_desc", label: "Severity high" },
  { value: "severity_asc", label: "Severity low" }
];
const KANBAN_SCOPES = [
  { value: "global", label: "Global Board" },
  { value: "workflow", label: "Workflow Board" }
];
const AGENT_RUNTIME_FILTERS = [
  { value: "all", label: "All runtimes" },
  { value: "hermers", label: "Hermers" },
  { value: "openclaw", label: "OpenClaw" },
  { value: "local_codex", label: "Local Codex" },
  { value: "codex", label: "Codex" }
];
const AGENT_DISPATCH_FILTERS = [
  { value: "all", label: "All dispatch" },
  { value: "enabled", label: "Dispatch enabled" },
  { value: "disabled", label: "Dispatch disabled" }
];
const AGENT_ATTENTION_FILTERS = [
  { value: "all", label: "All attention" },
  { value: "attention", label: "Has attention" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "ok", label: "OK" }
];
const PREVIEW_ACTION_PRIORITY = [
  {
    action: "workflow.supervise.preview",
    priority: "P0",
    label: "Supervise Preview",
    firstWhen: "Any workflow needs a read-only next-step package.",
    boundary: "Preview package only; no workflow state mutation."
  },
  {
    action: "workflow.rerun.agent.preview",
    priority: "P1",
    label: "Rerun Agent/Dispatch Preview",
    firstWhen: "Dispatch, runtime, or message_flow evidence points to retry planning.",
    boundary: "Plans rerun input; does not drain runtime or rerun agents."
  },
  {
    action: "telegram.outbox.delivery.preview",
    priority: "P1",
    label: "Telegram Delivery Preview",
    firstWhen: "Queued, delivering, or failed outbox rows need delivery inspection.",
    boundary: "Delivery preview/audit only; no Telegram send."
  },
  {
    action: "telegram.outbox.requeue.preview",
    priority: "P2",
    label: "Telegram Requeue Preview",
    firstWhen: "Outbox delivery is failed or stale and needs requeue planning.",
    boundary: "Requeue preview only; no outbox status change."
  },
  {
    action: "workflow.pause.preview",
    priority: "P2",
    label: "Pause Preview",
    firstWhen: "Human Gate or operator review needs a reversible pause package.",
    boundary: "Pause package only; no workflow pause mutation."
  },
  {
    action: "workflow.stop.preview",
    priority: "P2",
    label: "Stop Preview",
    firstWhen: "Human Gate or operator review needs a stop/terminate package.",
    boundary: "Stop package only; no workflow termination."
  },
  {
    action: "workflow.control_loop.job.requeue.preview",
    priority: "P2",
    label: "Control-Loop Job Requeue Preview",
    firstWhen: "A failed/dead-letter job or expired lease needs retry planning.",
    boundary: "Requeue preview only; no queue state change or job execution."
  },
  {
    action: "workflow.incident.from_dead_letter.preview",
    priority: "P3",
    label: "Dead-Letter Incident Preview",
    firstWhen: "Dead-letter or side-effect uncertainty evidence needs incident packaging.",
    boundary: "Incident package preview only; no incident creation."
  },
  {
    action: "workflow.incident.closeout.cat_claw_report.preview",
    priority: "P3",
    label: "Cat Claw Closeout Preview",
    firstWhen: "Incident evidence needs secretary review.",
    boundary: "Closeout report preview only; no incident resolution or dispatch."
  },
  {
    action: "workflow.incident.closeout.human_gate_package.preview",
    priority: "P3",
    label: "Human Gate Package Preview",
    firstWhen: "Incident closeout is ready for Human Gate package inspection.",
    boundary: "Human Gate package preview only; no Human Gate request creation."
  },
  {
    action: "workflow.rerun.phase.preview",
    priority: "P4",
    label: "Rerun Phase Preview",
    firstWhen: "A phase-scoped task has enough context for phase retry planning.",
    boundary: "Phase retry preview only; no task reset or dispatch."
  },
  {
    action: "telegram.outbox.requeue.execution_package.preview",
    priority: "P4",
    label: "Requeue Execution Package Preview",
    firstWhen: "An operator needs the governed execution package before requeue.",
    boundary: "Execution package preview only; no outbox write."
  }
];
const SEVERITY_RANK = {
  critical: 4,
  warning: 3,
  ok: 2,
  neutral: 1,
  info: 1
};
const CONSOLE_VIEW_LABELS = {
  "command-center": "Command Center",
  activity: "Activity Feed",
  "agent-board": "Agent Board",
  kanban: "Kanban",
  "evidence-workspace": "Evidence",
  operations: "Operations",
  system: "System",
  workflows: "Workflows",
  search: "Search"
};

let suppressUrlWrite = false;
let liveRefreshTimer = null;

const STATUS_TONES = {
  active: "ok",
  done: "ok",
  completed: "ok",
  approved: "ok",
  sent: "ok",
  acked: "ok",
  success: "ok",
  runtime_completed: "ok",
  telegram_sent: "ok",
  local_codex_inbox_received: "ok",
  pass: "ok",
  ready: "ok",
  pending: "warning",
  queued: "warning",
  waiting_human: "warning",
  route_registered: "warning",
  runtime_dispatched: "warning",
  outbound_queued: "warning",
  paused: "warning",
  warn: "warning",
  needs_attention: "warning",
  blocked: "critical",
  failed: "critical",
  fail: "critical",
  not_ready: "critical",
  rejected: "critical",
  cancelled: "critical",
  expired: "critical",
  uncertain: "critical",
  runtime_failed: "critical",
  telegram_failed: "critical"
};

const DRAWER_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "summary"
].join(",");

let drawerReturnFocus = null;
let paletteReturnFocus = null;

function $(selector) {
  return document.querySelector(selector);
}

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else if (key === "dataset") {
      for (const [dataKey, dataValue] of Object.entries(value)) node.dataset[dataKey] = dataValue;
    } else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || response.statusText);
  return data;
}

function present(value, fallback = "-") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function short(value, limit = 110) {
  const text = present(value, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}

function formatDate(value) {
  if (!value) return "-";
  return String(value).replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function displayText(value, limit = 180) {
  if (value && typeof value === "object") {
    try {
      return short(JSON.stringify(value), limit);
    } catch {
      return short(String(value), limit);
    }
  }
  if (String(value || "").trim() === "[object Object]") return "Structured timeline note";
  return short(value, limit);
}

function timestampValue(value) {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function toneFor(value) {
  return STATUS_TONES[String(value || "").toLowerCase()] || "neutral";
}

function chip(value, tone = toneFor(value)) {
  return h("span", { className: `chip ${tone}` }, present(value));
}

function jsonBlock(value) {
  return h("pre", { className: "json" }, JSON.stringify(value, null, 2));
}

function redactClientText(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/tawhg:[A-Za-z0-9._=-]+/g, "tawhg:<redacted>")
    .replace(/(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)([-_])[A-Za-z0-9._~+/=-]+/gi, "$1$2[redacted]")
    .replace(/\b(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)\s+([^\s,;]+)/gi, "$1 [redacted]");
}

function redactClientValue(value) {
  if (typeof value === "string") return redactClientText(value);
  if (Array.isArray(value)) return value.map((item) => redactClientValue(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/callback|token|secret|password|api[_-]?key|access[_-]?key|refresh|bot[_-]?token/i.test(key)) result[key] = "[redacted]";
    else result[key] = redactClientValue(item);
  }
  return result;
}

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(value, label = "Value") {
  const text = present(value, "");
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setActionStatus(`${label} copied`, "ok");
  } catch {
    const textarea = h("textarea", { value: text, style: "position: fixed; left: -9999px; top: 0;" });
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    setActionStatus(`${label} copied`, "ok");
  }
}

function emptyState(text) {
  return h("div", { className: "empty" }, text);
}

function section(title, body, attrs = {}) {
  return h("section", { ...attrs, className: `content-section ${attrs.className || ""}`.trim() }, [
    h("div", { className: "section-head" }, h("h3", {}, title)),
    body
  ]);
}

function collapsibleSection(title, body, attrs = {}) {
  const { open = false, className = "", ...rest } = attrs;
  return h("details", { ...rest, className: `content-section collapsible-section ${className}`.trim(), open: open ? true : undefined }, [
    h("summary", { className: "section-head collapsible-section-head" }, [
      h("h3", {}, title),
      h("span", { className: "muted" }, "toggle")
    ]),
    h("div", { className: "collapsible-section-body" }, body)
  ]);
}

function copyableEvidenceId(value, label = "ID") {
  const text = present(value, "");
  if (!text) return h("span", {}, "-");
  return h("span", { className: "copyable-evidence-id" }, [
    h("code", {}, text),
    h("button", { type: "button", onClick: () => copyText(text, label) }, "Copy")
  ]);
}

function copyableEvidenceList(values = [], label = "Refs") {
  const refs = (values || []).filter(Boolean);
  if (!refs.length) return h("span", {}, "-");
  const shown = refs.slice(0, 8).map((value, index) => copyableEvidenceId(value, `${label} ${index + 1}`));
  if (refs.length > 8) {
    shown.push(h("span", { className: "copyable-evidence-more", title: refs.slice(8).join("\n") }, `+${refs.length - 8} more`));
    shown.push(h("button", { type: "button", onClick: () => copyText(refs.join("\n"), `${label} all`) }, "Copy All"));
  }
  return h("div", { className: "copyable-evidence-list" }, shown);
}

function scrollToConsoleSection(sectionId = "") {
  if (!sectionId) return;
  requestAnimationFrame(() => {
    const target = Array.from(document.querySelectorAll("[data-section]"))
      .find((node) => node.getAttribute("data-section") === sectionId);
    if (target?.tagName === "DETAILS") target.open = true;
    const parentDetails = target?.closest?.("details");
    if (parentDetails) parentDetails.open = true;
    target?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function renderTable(columns, rows, emptyText = "No records.") {
  if (!rows?.length) return emptyState(emptyText);
  const table = h("table", { className: "data-table" });
  const thead = h("thead", {}, h("tr", {}, columns.map((column) => h("th", {}, column.label))));
  const tbody = h("tbody");
  for (const row of rows) {
    const tr = h("tr");
    for (const column of columns) {
      const value = column.render ? column.render(row) : present(row[column.key]);
      tr.append(h("td", {}, value));
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  return h("div", { className: "table-wrap" }, table);
}

function statCard(label, value, detail = "") {
  return h("div", { className: "stat-card" }, [
    h("span", { className: "stat-label" }, label),
    h("strong", {}, present(value, "0")),
    detail ? h("span", { className: "stat-detail" }, detail) : null
  ]);
}

function updateContextTrail() {
  const root = $("#contextTrail");
  if (!root) return;
  const urlWorkflowViews = ["workflows", "evidence-workspace", "operations", "kanban"];
  const canShowWorkflowContext = Boolean(
    state.selectedWorkflowId &&
      (urlWorkflowViews.includes(state.consoleView) ||
        (state.consoleView === "activity" && state.scopedActivity))
  );
  const canShowAgentContext = Boolean(["agent-board", "kanban"].includes(state.consoleView) && state.focusAgentId);
  const canShowCardContext = Boolean(state.consoleView === "kanban" && state.focusCardId);
  const operationsFilterUrl = state.consoleView === "operations" || (state.consoleView === "workflows" && state.tab === "operations");
  const crumbs = [
    { label: "View", value: CONSOLE_VIEW_LABELS[state.consoleView] || state.consoleView },
    state.consoleView === "workflows" ? { label: "Queue", value: state.view } : null,
    canShowWorkflowContext ? { label: "Workflow", value: state.selectedWorkflowId } : null,
    state.tab && state.consoleView === "workflows" && state.tab !== "overview" ? { label: "Tab", value: state.tab } : null,
    state.consoleView === "kanban" ? { label: "Board Scope", value: state.kanbanScope === "workflow" ? "workflow" : "global" } : null,
    canShowAgentContext ? { label: "Agent", value: state.focusAgentId } : null,
    canShowCardContext ? { label: "Card", value: state.focusCardId } : null,
    state.consoleView === "agent-board" && state.agentRuntimeFilter !== "all" ? { label: "Runtime", value: state.agentRuntimeFilter } : null,
    state.consoleView === "agent-board" && state.agentDispatchFilter !== "all" ? { label: "Dispatch", value: state.agentDispatchFilter } : null,
    state.consoleView === "agent-board" && state.agentAttentionFilter !== "all" ? { label: "Attention", value: state.agentAttentionFilter } : null,
    state.consoleView === "search" && state.searchQuery ? { label: "Search", value: state.searchQuery } : null,
    isWorkbenchView() && state.workbenchFilter !== "all" ? { label: "Filter", value: state.workbenchFilter } : null,
    isWorkbenchView() && state.severityFilter !== "all" ? { label: "Severity", value: state.severityFilter } : null,
    isWorkbenchView() && state.sortMode !== "age_desc" ? { label: "Sort", value: state.sortMode } : null,
    state.consoleView === "activity" ? { label: "Scope", value: state.scopedActivity ? "workflow" : "global" } : null,
    operationsFilterUrl && state.operationsFilters.kind ? { label: "Kind", value: state.operationsFilters.kind } : null,
    operationsFilterUrl && state.operationsFilters.severity ? { label: "Op Severity", value: state.operationsFilters.severity } : null,
    operationsFilterUrl && state.operationsFilters.status ? { label: "Op Status", value: state.operationsFilters.status } : null,
    state.config?.actionMode ? { label: "Mode", value: state.config.actionMode } : null
  ].filter(Boolean);
  const currentUrl = window.location.href;
  root.replaceChildren(
    h("div", { className: "context-crumbs" }, crumbs.map((crumb) => (
      h("span", { className: "context-crumb" }, [
        h("span", { className: "context-label" }, crumb.label),
        h("strong", {}, short(crumb.value, 72))
      ])
    ))),
    h("button", { type: "button", className: "context-copy", onClick: () => copyText(currentUrl, "Console link") }, "Copy Link")
  );
}

function actionGatePanel(title, rows = []) {
  return h("div", { className: "action-gate-panel" }, [
    h("div", { className: "workflow-title" }, [
      h("strong", {}, title),
      chip(rows.every((row) => row.tone !== "critical") ? "gated" : "blocked", rows.every((row) => row.tone !== "critical") ? "ok" : "critical")
    ]),
    renderTable([
      { label: "Gate", key: "label" },
      { label: "Status", render: (row) => chip(row.status || "-", row.tone || toneFor(row.status)) },
      { label: "Evidence", key: "evidence" }
    ], rows, "No action gates.")
  ]);
}

function optionSelect(value, options = [], onChange) {
  const select = h("select", { onChange: (event) => onChange(event.target.value) }, options.map((option) => (
    h("option", { value: option.value }, option.label)
  )));
  select.value = value;
  return select;
}

function normalizeChoice(value, allowed, fallback) {
  const text = String(value || "").trim();
  return allowed.includes(text) ? text : fallback;
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const consoleView = params.get("console");
  state.consoleView = CONSOLE_VIEWS.has(consoleView)
    ? consoleView
    : params.get("workflow") ? "workflows" : "command-center";
  state.view = normalizeChoice(params.get("wfView"), ["active", "waiting_human", "blocked", "paused", "updated_24h"], "active");
  state.selectedWorkflowId = params.get("workflow") || "";
  state.scopedActivity = state.consoleView === "activity" && params.get("scope") === "workflow" && Boolean(state.selectedWorkflowId);
  if (state.consoleView === "activity" && !state.scopedActivity) state.selectedWorkflowId = "";
  state.kanbanScope = state.consoleView === "kanban"
    ? normalizeChoice(params.get("scope"), KANBAN_SCOPES.map((item) => item.value), state.selectedWorkflowId ? "workflow" : "global")
    : "global";
  if (state.consoleView === "kanban" && state.kanbanScope === "workflow" && !state.selectedWorkflowId) state.kanbanScope = "global";
  if (state.consoleView === "kanban" && state.kanbanScope === "global") state.selectedWorkflowId = "";
  state.tab = params.get("tab") || "overview";
  state.searchQuery = params.get("q") || "";
  state.workbenchFilter = normalizeChoice(params.get("filter"), WORKBENCH_FILTERS.map((item) => item.id), "all");
  state.severityFilter = normalizeChoice(params.get("severity"), SEVERITY_FILTERS.map((item) => item.value), "all");
  state.sortMode = normalizeChoice(params.get("sort"), SORT_MODES.map((item) => item.value), "age_desc");
  state.focusAgentId = params.get("agent") || "";
  state.focusCardId = params.get("card") || "";
  state.agentRuntimeFilter = state.consoleView === "agent-board"
    ? normalizeChoice(params.get("agentRuntime"), AGENT_RUNTIME_FILTERS.map((item) => item.value), "all")
    : "all";
  state.agentDispatchFilter = state.consoleView === "agent-board"
    ? normalizeChoice(params.get("agentDispatch"), AGENT_DISPATCH_FILTERS.map((item) => item.value), "all")
    : "all";
  state.agentAttentionFilter = state.consoleView === "agent-board"
    ? normalizeChoice(params.get("agentAttention"), AGENT_ATTENTION_FILTERS.map((item) => item.value), "all")
    : "all";
  state.operationsFilters.kind = params.get("opKind") || "";
  state.operationsFilters.severity = params.get("opSeverity") || "";
  state.operationsFilters.status = params.get("opStatus") || "";
  $("#globalSearchInput").value = state.searchQuery;
}

function writeUrlState({ replace = false } = {}) {
  if (suppressUrlWrite) return;
  const params = new URLSearchParams();
  if (state.consoleView !== "command-center") params.set("console", state.consoleView);
  if (state.view !== "active") params.set("wfView", state.view);
  if (["workflows", "evidence-workspace", "operations"].includes(state.consoleView) && state.selectedWorkflowId) params.set("workflow", state.selectedWorkflowId);
  if (state.consoleView === "kanban") {
    if (state.kanbanScope !== "global") params.set("scope", state.kanbanScope);
    if (state.kanbanScope === "workflow" && state.selectedWorkflowId) params.set("workflow", state.selectedWorkflowId);
  }
  if (state.consoleView === "activity" && state.scopedActivity && state.selectedWorkflowId) {
    params.set("workflow", state.selectedWorkflowId);
    params.set("scope", "workflow");
  }
  if (state.consoleView === "workflows" && state.tab !== "overview") params.set("tab", state.tab);
  if (state.consoleView === "search" && state.searchQuery) params.set("q", state.searchQuery);
  if (isWorkbenchView() && state.workbenchFilter !== "all") params.set("filter", state.workbenchFilter);
  if (isWorkbenchView() && state.severityFilter !== "all") params.set("severity", state.severityFilter);
  if (isWorkbenchView() && state.sortMode !== "age_desc") params.set("sort", state.sortMode);
  if (["agent-board", "kanban"].includes(state.consoleView) && state.focusAgentId) params.set("agent", state.focusAgentId);
  if (state.consoleView === "kanban" && state.focusCardId) params.set("card", state.focusCardId);
  if (state.consoleView === "agent-board" && state.agentRuntimeFilter !== "all") params.set("agentRuntime", state.agentRuntimeFilter);
  if (state.consoleView === "agent-board" && state.agentDispatchFilter !== "all") params.set("agentDispatch", state.agentDispatchFilter);
  if (state.consoleView === "agent-board" && state.agentAttentionFilter !== "all") params.set("agentAttention", state.agentAttentionFilter);
  const operationsFilterUrl = state.consoleView === "operations" || (state.consoleView === "workflows" && state.tab === "operations");
  if (operationsFilterUrl && state.operationsFilters.kind) params.set("opKind", state.operationsFilters.kind);
  if (operationsFilterUrl && state.operationsFilters.severity) params.set("opSeverity", state.operationsFilters.severity);
  if (operationsFilterUrl && state.operationsFilters.status) params.set("opStatus", state.operationsFilters.status);
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const method = replace ? "replaceState" : "pushState";
  if (nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history[method]({}, "", nextUrl);
  }
  updateContextTrail();
}

function isWorkbenchView() {
  return ["agent-board", "kanban", "search"].includes(state.consoleView);
}

function clearFocusState() {
  state.focusAgentId = "";
  state.focusCardId = "";
}

function recordText(record = {}) {
  return [
    record.kind,
    record.id,
    record.title,
    record.summary,
    record.status,
    record.column,
    record.source,
    record.sourceId,
    record.workflowId,
    record.agentId,
    record.runtime,
    record.dispatchId,
    record.flowId,
    record.outboxId,
    record.humanGateId,
    record.artifactRef,
    record.receiptRef,
    record.currentStage,
    record.staleKind,
    record.blockedReason,
    record.latest?.kind,
    record.latest?.status,
    record.currentState?.status,
    record.currentState?.currentStage,
    record.currentState?.staleKind,
    record.currentState?.blockedReason,
    ...(record.missingEvidence || []),
    ...(record.attentionFlags || []).flatMap((flag) => [flag.key, flag.severity, flag.detail]),
    ...(record.matchFields || [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function recordSeverity(record = {}) {
  const flagSeverity = (record.attentionFlags || [])
    .map((flag) => toneFor(flag.severity || flag.key))
    .sort((a, b) => (SEVERITY_RANK[b] || 0) - (SEVERITY_RANK[a] || 0))[0];
  if (flagSeverity) return flagSeverity;
  if (record.severity) return toneFor(record.severity);
  const column = String(record.column || "").toLowerCase();
  if (["blocked", "failed"].includes(column)) return "critical";
  if (["queued", "dispatched", "working", "waiting_receipt", "waiting_human"].includes(column)) return "warning";
  if ((record.missingEvidence || []).length) return "warning";
  if (record.currentState?.staleKind || record.staleKind) return "warning";
  return toneFor(record.attentionLevel || record.status || column);
}

function recordUpdatedAt(record = {}) {
  return record.latest?.lastEventAt
    || record.lastEventAt
    || record.updatedAt
    || record.createdAt
    || record.currentState?.lastEventAt
    || record.currentState?.updatedAt
    || record.latest?.lastEventAt
    || "";
}

function matchesWorkbenchFilter(record = {}) {
  const filter = state.workbenchFilter;
  if (filter === "all") return true;
  const text = recordText(record);
  const status = String(record.status || record.column || record.attentionLevel || "").toLowerCase();
  const column = String(record.column || "").toLowerCase();
  const source = String(record.source || record.kind || "").toLowerCase();
  const staleKind = String(record.staleKind || record.currentState?.staleKind || "").toLowerCase();
  const missingEvidence = (record.missingEvidence || []).map((item) => String(item || "").toLowerCase());
  if (filter === "blocked") {
    return ["blocked", "failed", "critical", "dead_letter"].some((token) => status.includes(token) || column.includes(token) || text.includes(token));
  }
  if (filter === "stale_ack") return staleKind === "ack_only" || text.includes("ack_only") || text.includes("ack-only") || text.includes("mechanical_ack");
  if (filter === "waiting_receipt") {
    return column === "waiting_receipt"
      || staleKind === "receipt_missing"
      || missingEvidence.some((item) => ["delivery_receipt", "runtime_receipt", "artifact_or_receipt", "receipt_or_artifact", "receipt"].includes(item))
      || text.includes("waiting receipt")
      || text.includes("missing receipt")
      || text.includes("receipt_required");
  }
  if (filter === "waiting_human") return column === "waiting_human" || status.includes("waiting_human") || text.includes("human_gate") || text.includes("human gate") || text.includes("feedback waiting");
  if (filter === "failed_delivery") return source === "telegram_outbox" && status.includes("failed") || text.includes("telegram_failed") || text.includes("failed delivery") || text.includes("delivery failed") || (text.includes("telegram") && status.includes("failed"));
  return true;
}

function matchesSeverityFilter(record = {}) {
  return state.severityFilter === "all" || recordSeverity(record) === state.severityFilter;
}

function matchesFocusFilter(record = {}) {
  if (state.consoleView === "agent-board" && state.focusAgentId) {
    return [record.agentId, record.agentKey, record.runtime && record.agentId ? `${record.runtime}:${record.agentId}` : ""]
      .some((value) => String(value || "") === state.focusAgentId);
  }
  if (state.consoleView === "kanban") {
    if (state.focusCardId && ![record.sourceId, record.id, record.dispatchId, record.flowId, record.outboxId, record.humanGateId, record.taskId, record.runtimeRunId].some((value) => String(value || "") === state.focusCardId)) return false;
  }
  return true;
}

function sortWorkbenchRecords(records = []) {
  const copy = [...records];
  return copy.sort((a, b) => {
    const severityDelta = (SEVERITY_RANK[recordSeverity(b)] || 0) - (SEVERITY_RANK[recordSeverity(a)] || 0);
    const timeDelta = timestampValue(recordUpdatedAt(b)) - timestampValue(recordUpdatedAt(a));
    if (state.sortMode === "severity_desc") return severityDelta || timeDelta;
    if (state.sortMode === "severity_asc") return -severityDelta || timeDelta;
    if (state.sortMode === "age_asc") return -timeDelta || severityDelta;
    return timeDelta || severityDelta;
  });
}

function applyWorkbench(records = []) {
  return sortWorkbenchRecords(records.filter((record) => matchesFocusFilter(record) && matchesWorkbenchFilter(record) && matchesSeverityFilter(record)));
}

function clearAgentBoardFilters() {
  state.agentRuntimeFilter = "all";
  state.agentDispatchFilter = "all";
  state.agentAttentionFilter = "all";
}

function matchesAgentBoardFilters(agent = {}) {
  if (state.consoleView !== "agent-board") return true;
  if (state.agentRuntimeFilter !== "all" && ![agent.runtime, agent.platform].some((value) => String(value || "") === state.agentRuntimeFilter)) return false;
  if (state.agentDispatchFilter === "enabled" && !agent.canReceiveDispatch) return false;
  if (state.agentDispatchFilter === "disabled" && agent.canReceiveDispatch) return false;
  const flags = agent.attentionFlags || [];
  const attentionLevel = String(agent.attentionLevel || "").toLowerCase();
  const hasAttention = flags.length > 0 || !["ok", "neutral", ""].includes(attentionLevel);
  if (state.agentAttentionFilter === "attention" && !hasAttention) return false;
  if (state.agentAttentionFilter === "critical" && attentionLevel !== "critical" && !flags.some((flag) => String(flag.severity || "").toLowerCase() === "critical")) return false;
  if (state.agentAttentionFilter === "warning" && attentionLevel !== "warning" && !flags.some((flag) => String(flag.severity || "").toLowerCase() === "warning")) return false;
  if (state.agentAttentionFilter === "ok" && hasAttention) return false;
  return true;
}

function agentBoardFilterControls(data = {}) {
  const agents = data.agents || [];
  const runtimeCounts = agents.reduce((acc, agent) => {
    const runtime = String(agent.runtime || agent.platform || "unknown");
    acc[runtime] = (acc[runtime] || 0) + 1;
    return acc;
  }, {});
  const setAgentFilter = (key, value) => {
    state[key] = value;
    writeUrlState();
    renderGlobalPayload(state.lastPayload);
  };
  return h("div", { className: "agent-board-scope-panel" }, [
    h("div", { className: "workflow-title" }, [
      h("strong", {}, "Agent Board Filters"),
      chip("read-only", "neutral")
    ]),
    h("p", { className: "muted" }, "Shows workflow-relevant runtime, dispatchability, work, and readiness signals only. Profile-local memory/RAG status remains in the runtime platform surface unless it is recorded as workflow readiness evidence."),
    h("div", { className: "agent-board-filter-grid" }, [
      h("label", {}, [
        h("span", {}, "Runtime"),
        optionSelect(state.agentRuntimeFilter, AGENT_RUNTIME_FILTERS, (value) => setAgentFilter("agentRuntimeFilter", value))
      ]),
      h("label", {}, [
        h("span", {}, "Dispatch"),
        optionSelect(state.agentDispatchFilter, AGENT_DISPATCH_FILTERS, (value) => setAgentFilter("agentDispatchFilter", value))
      ]),
      h("label", {}, [
        h("span", {}, "Attention"),
        optionSelect(state.agentAttentionFilter, AGENT_ATTENTION_FILTERS, (value) => setAgentFilter("agentAttentionFilter", value))
      ]),
      h("button", { type: "button", onClick: () => {
        clearAgentBoardFilters();
        writeUrlState();
        renderGlobalPayload(state.lastPayload);
      } }, "Reset Agent Filters")
    ]),
    h("div", { className: "mini-counts" }, [
      h("span", {}, `runtimes ${Object.entries(runtimeCounts).map(([key, value]) => `${key}:${value}`).join(" / ") || "none"}`),
      h("span", {}, `dispatch enabled ${agents.filter((agent) => agent.canReceiveDispatch).length}`),
      h("span", {}, `attention ${agents.filter((agent) => (agent.attentionFlags || []).length).length}`)
    ])
  ]);
}

function renderWorkbenchControls({ total = 0, shown = 0 } = {}) {
  if (!isWorkbenchView()) return null;
  const focusChips = [
    state.focusAgentId ? h("button", { type: "button", className: "focus-chip", onClick: () => {
      state.focusAgentId = "";
      writeUrlState();
      loadGlobalView();
    } }, `Agent ${state.focusAgentId} x`) : null,
    state.focusCardId ? h("button", { type: "button", className: "focus-chip", onClick: () => {
      state.focusCardId = "";
      writeUrlState();
      loadGlobalView();
    } }, `Card ${state.focusCardId} x`) : null
  ].filter(Boolean);
  return h("div", { className: "workbench-controls" }, [
    focusChips.length ? h("div", { className: "focus-strip", "aria-label": "Active focus" }, focusChips) : null,
    h("div", { className: "filter-preset-group", role: "group", "aria-label": "Saved filters" }, WORKBENCH_FILTERS.map((filter) => h("button", {
      type: "button",
      className: filter.id === state.workbenchFilter ? "active" : "",
      onClick: () => {
        state.workbenchFilter = filter.id;
        writeUrlState();
        renderGlobalPayload(state.lastPayload);
      }
    }, filter.label))),
    h("div", { className: "filter-selects" }, [
      optionSelect(state.severityFilter, SEVERITY_FILTERS, (value) => {
        state.severityFilter = value;
        writeUrlState();
        renderGlobalPayload(state.lastPayload);
      }),
      optionSelect(state.sortMode, SORT_MODES, (value) => {
        state.sortMode = value;
        writeUrlState();
        renderGlobalPayload(state.lastPayload);
      }),
      h("button", { type: "button", onClick: () => {
        state.workbenchFilter = "all";
        state.severityFilter = "all";
        state.sortMode = "age_desc";
        state.focusAgentId = "";
        state.focusCardId = "";
        clearAgentBoardFilters();
        writeUrlState();
        loadGlobalView();
      } }, "Reset")
    ]),
    h("div", { className: "filter-count" }, `${shown}/${total}`)
  ]);
}

function selectedWorkflow() {
  return state.workflows.find((item) => item.workflowId === state.selectedWorkflowId) || state.detail || null;
}

function countsFor(item) {
  return item?.counts || {};
}

function setActionStatus(message = "", tone = "") {
  const node = $("#actionStatus");
  node.textContent = message;
  node.className = `action-status ${tone}`.trim();
}

function liveRefreshText() {
  if (state.liveRefreshInFlight) return "Refreshing";
  if (!state.liveRefreshEnabled) return state.liveRefreshLastAt ? `Manual | ${formatDate(state.liveRefreshLastAt)}` : "Manual";
  return state.liveRefreshLastAt
    ? `Live ${Math.round(state.liveRefreshIntervalMs / 1000)}s | ${formatDate(state.liveRefreshLastAt)}`
    : `Live ${Math.round(state.liveRefreshIntervalMs / 1000)}s`;
}

function updateLiveControls(tone = "") {
  const toggle = $("#liveToggleButton");
  const interval = $("#liveIntervalSelect");
  const status = $("#liveStatus");
  if (!toggle || !interval || !status) return;
  toggle.textContent = state.liveRefreshEnabled ? "Live On" : "Live Off";
  toggle.classList.toggle("active", state.liveRefreshEnabled);
  toggle.setAttribute("aria-pressed", state.liveRefreshEnabled ? "true" : "false");
  interval.value = String(state.liveRefreshIntervalMs);
  status.textContent = liveRefreshText();
  status.className = `muted live-status ${tone}`.trim();
}

function clearLiveRefreshTimer() {
  if (!liveRefreshTimer) return;
  window.clearTimeout(liveRefreshTimer);
  liveRefreshTimer = null;
}

function scheduleLiveRefresh() {
  clearLiveRefreshTimer();
  if (!state.liveRefreshEnabled) return;
  liveRefreshTimer = window.setTimeout(() => {
    refreshConsole({ background: true });
  }, state.liveRefreshIntervalMs);
  updateLiveControls();
}

async function refreshConsole({ background = false } = {}) {
  if (state.liveRefreshInFlight) return;
  state.liveRefreshInFlight = true;
  clearLiveRefreshTimer();
  updateLiveControls();
  if (!background) setActionStatus("Refreshing...", "neutral");
  try {
    await loadConfig();
    await loadWorkflows();
    state.liveRefreshLastAt = new Date().toISOString();
    if (background) setActionStatus("Live refreshed", "ok");
    updateLiveControls();
  } catch (error) {
    setActionStatus(`Refresh failed: ${error.message}`, "critical");
    updateLiveControls("critical");
  } finally {
    state.liveRefreshInFlight = false;
    scheduleLiveRefresh();
  }
}

function setLiveRefreshEnabled(enabled) {
  state.liveRefreshEnabled = Boolean(enabled);
  if (state.liveRefreshEnabled) {
    refreshConsole({ background: true });
  } else {
    clearLiveRefreshTimer();
    updateLiveControls();
  }
}

function setDetailBody(node) {
  $("#detailBody").replaceChildren(node);
}

function setAppInert(isInert) {
  for (const node of document.querySelectorAll("body > header, body > main")) {
    if (isInert) {
      node.setAttribute("aria-hidden", "true");
      node.inert = true;
    } else {
      node.removeAttribute("aria-hidden");
      node.inert = false;
    }
  }
}

function closeDrawer() {
  $("#drawerRoot").replaceChildren();
  setAppInert(false);
  if (drawerReturnFocus?.isConnected) drawerReturnFocus.focus();
  drawerReturnFocus = null;
}

function closeCommandPalette() {
  $("#paletteRoot").replaceChildren();
  setAppInert(false);
  if (paletteReturnFocus?.isConnected) paletteReturnFocus.focus();
  paletteReturnFocus = null;
  state.commandPaletteQuery = "";
}

function commandText(command = {}) {
  return [
    command.id,
    command.group,
    command.title,
    command.subtitle,
    command.tone,
    ...(command.keywords || []),
    command.target?.workflowId,
    command.target?.agentId,
    command.target?.cardId,
    command.target?.consoleView
  ].filter(Boolean).join(" ").toLowerCase();
}

function filteredCommands() {
  const commands = state.commandPalette?.commands || [];
  const query = state.commandPaletteQuery.trim().toLowerCase();
  if (!query) return commands.slice(0, 80);
  const terms = query.split(/\s+/).filter(Boolean);
  return commands.filter((command) => terms.every((term) => commandText(command).includes(term))).slice(0, 80);
}

function paletteFocusableElements() {
  const panel = document.querySelector(".command-palette");
  if (!panel) return [];
  return Array.from(panel.querySelectorAll(DRAWER_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.disabled) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    return element.offsetParent !== null || element === document.activeElement;
  });
}

function trapPaletteFocus(event) {
  const panel = document.querySelector(".command-palette");
  if (!panel || event.key !== "Tab") return;
  const focusable = paletteFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function runCommand(command = {}) {
  closeCommandPalette();
  await openCommandTarget(command.target || {});
}

function renderCommandPalette() {
  const root = $("#paletteRoot");
  const commands = filteredCommands();
  const input = h("input", {
    type: "search",
    autocomplete: "off",
    spellcheck: "false",
    value: state.commandPaletteQuery,
    placeholder: "Jump to view, workflow, agent...",
    onInput: (event) => {
      state.commandPaletteQuery = event.target.value;
      renderCommandPalette();
    },
    onKeydown: async (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (commands[0]) await runCommand(commands[0]);
      }
    }
  });
  const body = commands.length
    ? h("div", { className: "command-list", role: "listbox" }, commands.map((command, index) => h("button", {
      type: "button",
      className: "command-item",
      role: "option",
      "aria-selected": index === 0 ? "true" : "false",
      onClick: () => runCommand(command)
    }, [
      h("div", {}, [
        h("strong", {}, command.title),
        h("p", { className: "muted" }, command.subtitle || command.id)
      ]),
      h("div", { className: "command-meta" }, [
        chip(command.group || "command", "neutral"),
        chip(command.tone || "neutral", toneFor(command.tone))
      ])
    ]))) : emptyState("No matching commands.");
  const panel = h("section", { className: "command-palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette", tabindex: "-1" }, [
    h("div", { className: "palette-head" }, [
      h("div", {}, [
        h("strong", {}, "Jump Console"),
        h("p", { className: "muted" }, `${state.commandPalette?.summary?.commands || 0} commands`)
      ]),
      h("button", { type: "button", onClick: closeCommandPalette, "aria-label": "Close command palette" }, "Close")
    ]),
    input,
    body
  ]);
  root.replaceChildren(h("div", { className: "drawer-backdrop", onClick: closeCommandPalette }), panel);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

async function openCommandPalette() {
  closeDrawer();
  paletteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setAppInert(true);
  state.commandPaletteQuery = "";
  state.commandPalette = null;
  $("#paletteRoot").replaceChildren(h("div", { className: "drawer-backdrop", onClick: closeCommandPalette }), h("section", { className: "command-palette loading", role: "dialog", "aria-modal": "true", "aria-label": "Command palette", tabindex: "-1" }, [
    h("div", { className: "palette-head" }, [
      h("strong", {}, "Jump Console"),
      h("button", { type: "button", onClick: closeCommandPalette, "aria-label": "Close command palette" }, "Close")
    ]),
    emptyState("Loading commands...")
  ]));
  try {
    state.commandPalette = await api("/api/command-palette");
    renderCommandPalette();
  } catch (error) {
    const closeButton = h("button", { type: "button", onClick: closeCommandPalette, "aria-label": "Close command palette" }, "Close");
    $("#paletteRoot").replaceChildren(h("div", { className: "drawer-backdrop", onClick: closeCommandPalette }), h("section", { className: "command-palette", role: "dialog", "aria-modal": "true", "aria-label": "Command palette", tabindex: "-1" }, [
      h("div", { className: "palette-head" }, [
        h("strong", {}, "Jump Console"),
        closeButton
      ]),
      h("div", { className: "error" }, error.message)
    ]));
    closeButton.focus();
  }
}

function drawerFocusableElements() {
  const panel = document.querySelector(".detail-drawer");
  if (!panel) return [];
  return Array.from(panel.querySelectorAll(DRAWER_FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.disabled) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    return element.offsetParent !== null || element === document.activeElement;
  });
}

function trapDrawerFocus(event) {
  const panel = document.querySelector(".detail-drawer");
  if (!panel || event.key !== "Tab") return;
  const focusable = drawerFocusableElements();
  if (!focusable.length) {
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showDrawer({ title, subtitle = "", tone = "neutral", body, raw }) {
  const root = $("#drawerRoot");
  drawerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const closeButton = h("button", { type: "button", onClick: closeDrawer, "aria-label": "Close drawer" }, "Close");
  const panel = h("aside", { className: "detail-drawer", role: "dialog", "aria-modal": "true", "aria-label": title, tabindex: "-1" }, [
    h("div", { className: "drawer-head" }, [
      h("div", {}, [
        h("div", { className: "workflow-title" }, [
          h("strong", {}, title),
          chip(tone, toneFor(tone))
        ]),
        subtitle ? h("p", { className: "muted" }, subtitle) : null
      ]),
      closeButton
    ]),
    h("div", { className: "drawer-body" }, [
      body,
      raw ? section("Raw", h("details", {}, [
        h("summary", {}, "JSON"),
        jsonBlock(raw)
      ])) : null
    ])
  ]);
  root.replaceChildren(h("div", { className: "drawer-backdrop", onClick: closeDrawer }), panel);
  closeButton.focus();
  setAppInert(true);
}

function sourceRefDisplay(ref = {}) {
  return `${present(ref.source)}.${present(ref.field)}=${present(ref.id)}`;
}

function sourceRefTargetKey(target = {}) {
  return JSON.stringify({
    label: target.label || "",
    consoleView: target.consoleView || "",
    workflowId: target.workflowId || "",
    tab: target.tab || "",
    agentId: target.agentId || "",
    cardId: target.cardId || "",
    section: target.section || "",
    operationsFilters: target.operationsFilters || {}
  });
}

function sourceRefDrilldownTargets(ref = {}, context = {}) {
  const source = String(ref.source || "").toLowerCase();
  const field = String(ref.field || "").toLowerCase();
  const id = String(ref.id || "").trim();
  const workflowId = context.workflowId || (field === "workflow_id" || source === "workflow" ? id : "");
  const agentId = context.agentId || (source === "runtime_agents" && id.includes(":") ? id.split(":").pop() : "");
  const targets = [];
  const seen = new Set();
  const pushTarget = (target = {}) => {
    if (!target.consoleView) return;
    const key = sourceRefTargetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };
  if (workflowId) {
    pushTarget({ label: "Workflow", consoleView: "workflows", workflowId, tab: "overview" });
    pushTarget({ label: "Evidence", consoleView: "evidence-workspace", workflowId });
    pushTarget({ label: "Operations", consoleView: "operations", workflowId });
  }
  if (agentId) {
    pushTarget({ label: "Agent", consoleView: "agent-board", agentId });
    pushTarget({ label: "Board", consoleView: "kanban", workflowId, agentId });
  }
  if (source.includes("dispatch") || field === "dispatch_id") {
    if (workflowId) {
      pushTarget({ label: "Dispatches", consoleView: "workflows", workflowId, tab: "dispatches" });
      pushTarget({ label: "Board", consoleView: "kanban", workflowId, agentId: context.agentId || agentId, cardId: id });
    }
    pushTarget({ label: "Operations", consoleView: "operations", workflowId, operationsFilters: { kind: "failed_dispatch", severity: "", status: "" } });
  }
  if (source.includes("runtime_runs") || field === "runtime_run_id") {
    if (workflowId) {
      pushTarget({ label: "Runtime", consoleView: "workflows", workflowId, tab: "runtime-runs" });
      pushTarget({ label: "Board", consoleView: "kanban", workflowId, agentId: context.agentId || agentId, cardId: id });
    }
    pushTarget({ label: "Operations", consoleView: "operations", workflowId });
  }
  if (source.includes("message_flow") || field === "flow_id") {
    if (workflowId) {
      pushTarget({ label: "Message Flow", consoleView: "workflows", workflowId, tab: "message-flows" });
      pushTarget({ label: "Board", consoleView: "kanban", workflowId, agentId: context.agentId || agentId, cardId: id });
    }
  }
  if (source.includes("telegram_outbox") || field === "outbox_id") {
    if (workflowId) pushTarget({ label: "Outbox", consoleView: "workflows", workflowId, tab: "outbox" });
    pushTarget({ label: "Operations", consoleView: "operations", workflowId, operationsFilters: { kind: "", severity: "critical", status: "failed" } });
  }
  if (source.includes("incident")) {
    if (workflowId) {
      pushTarget({ label: "Incidents", consoleView: "workflows", workflowId, tab: "incident-closeout" });
      pushTarget({ label: "Evidence", consoleView: "evidence-workspace", workflowId });
    }
  }
  if (source.includes("human_gate") || source.includes("protocol_objects") || source.includes("review_gates")) {
    if (workflowId) {
      pushTarget({ label: "Human Gate", consoleView: "workflows", workflowId, tab: "human-gates" });
      pushTarget({ label: "Gate Readiness", consoleView: "workflows", workflowId, tab: "human-gate-readiness" });
    }
  }
  if (source.includes("workflow_operations") || source.includes("control_loop") || source.includes("dead_letters")) {
    pushTarget({ label: "Operations", consoleView: "operations", workflowId });
  }
  if (source.includes("readiness_snapshots")) {
    pushTarget({ label: "System", consoleView: "system", section: "readiness" });
    pushTarget({ label: "Operations", consoleView: "operations", workflowId });
  }
  if (source.includes("side_effect") || source.includes("artifact") || source.includes("checkpoint") || source.includes("evidence")) {
    if (workflowId) {
      pushTarget({ label: "Evidence", consoleView: "evidence-workspace", workflowId });
      pushTarget({ label: "Evidence Desk", consoleView: "workflows", workflowId, tab: "evidence-desk" });
    }
  }
  return targets.slice(0, 6);
}

function inspectSourceRef(ref = {}, context = {}) {
  const targets = sourceRefDrilldownTargets(ref, context);
  showDrawer({
    title: "Source Inspector",
    subtitle: sourceRefDisplay(ref),
    tone: targets.length ? "ok" : "neutral",
    body: h("div", { className: "stack" }, [
      section("Source Ref", h("div", { className: "copy-block" }, [
        h("p", {}, sourceRefDisplay(ref)),
        h("div", { className: "actions" }, [
          h("button", { type: "button", onClick: () => copyText(ref.id, "Source ref id") }, "Copy Id"),
          h("button", { type: "button", onClick: () => copyText(sourceRefDisplay(ref), "Source ref") }, "Copy Ref")
        ])
      ])),
      section("Suggested Drilldowns", targets.length ? h("div", { className: "source-ref-actions" }, targets.map((target) => h("button", {
        type: "button",
        onClick: () => {
          closeDrawer();
          openCommandTarget(target);
        }
      }, target.label || "Open"))) : emptyState("No console drilldown can be inferred from this source ref.")),
      section("Boundary", h("p", { className: "muted" }, "This inspector is read-only. It routes to existing console surfaces and does not query raw database rows, retry jobs, mutate workflow state, or execute write actions."))
    ]),
    raw: { ref, context, targets }
  });
}

function renderSourceRefChip(ref = {}, context = {}) {
  return h("button", {
    type: "button",
    className: "source-ref-chip",
    title: `Inspect ${sourceRefDisplay(ref)}`,
    onClick: () => inspectSourceRef(ref, context)
  }, sourceRefDisplay(ref));
}

function sourceRefList(refs = [], context = {}) {
  const list = refs.filter((ref) => ref?.id);
  if (!list.length) return emptyState("No source refs.");
  return h("div", { className: "source-ref-list" }, list.map((ref) => h("div", { className: "source-ref-row" }, [
    h("span", {}, `${present(ref.source)}.${present(ref.field)}`),
    h("code", {}, present(ref.id)),
    h("button", { type: "button", onClick: () => inspectSourceRef(ref, context) }, "Inspect"),
    h("button", { type: "button", onClick: () => copyText(ref.id, "Ref") }, "Copy")
  ])));
}

function readinessFindingKey(finding = {}, index = 0) {
  return finding.key || finding.code || finding.type || `readiness_finding_${index + 1}`;
}

function readinessFindingSeverity(finding = {}) {
  return String(finding.severity || finding.status || "info").toLowerCase();
}

function readinessFindingTone(finding = {}) {
  const severity = readinessFindingSeverity(finding);
  if (severity === "critical" || severity === "error" || severity === "failed") return "critical";
  if (severity === "warning" || severity === "warn") return "warning";
  if (severity === "ok" || severity === "ready" || severity === "pass") return "ok";
  return toneFor(severity);
}

function readinessFindingSourceRefs(finding = {}, readiness = {}, index = 0) {
  const safeFinding = redactClientValue(finding);
  const safeReadiness = redactClientValue(readiness);
  return [
    { source: "readiness_snapshots", field: "snapshot_id", id: safeReadiness.snapshotId },
    { source: "readiness_snapshots", field: "finding_key", id: readinessFindingKey(safeFinding, index) },
    { source: "runtime_agents", field: "agent_id", id: safeFinding.agentId || safeFinding.agent_id || safeFinding.agent },
    { source: "workflow_runs", field: "workflow_id", id: safeFinding.workflowId || safeFinding.workflow_id },
    { source: "mixed_meeting_dispatches", field: "dispatch_id", id: safeFinding.dispatchId || safeFinding.dispatch_id },
    { source: "runtime_runs", field: "runtime_run_id", id: safeFinding.runtimeRunId || safeFinding.runtime_run_id },
    { source: "message_flows", field: "flow_id", id: safeFinding.flowId || safeFinding.flow_id },
    { source: "telegram_outbox", field: "outbox_id", id: safeFinding.outboxId || safeFinding.outbox_id }
  ].filter((ref) => ref.id);
}

function readinessFindingContext(finding = {}) {
  const safeFinding = redactClientValue(finding);
  const parts = [
    safeFinding.plane ? `plane=${safeFinding.plane}` : "",
    safeFinding.agentId || safeFinding.agent_id ? `agent=${safeFinding.agentId || safeFinding.agent_id}` : "",
    safeFinding.workflowId || safeFinding.workflow_id ? `workflow=${safeFinding.workflowId || safeFinding.workflow_id}` : "",
    safeFinding.profile ? `profile=${safeFinding.profile}` : "",
    safeFinding.backend || safeFinding.backendId ? `backend=${safeFinding.backend || safeFinding.backendId}` : "",
    safeFinding.path ? `path=${safeFinding.path}` : ""
  ].filter(Boolean);
  return parts.join(" | ") || "-";
}

function readinessFindingTargets(finding = {}, readiness = {}, index = 0) {
  const sourceTargets = readinessFindingSourceRefs(finding, readiness, index)
    .flatMap((ref) => sourceRefDrilldownTargets(ref, {
      workflowId: finding.workflowId || finding.workflow_id || "",
      agentId: finding.agentId || finding.agent_id || finding.agent || ""
    }));
  const targets = [{ label: "System", consoleView: "system", section: "readiness" }, ...sourceTargets];
  const seen = new Set();
  return targets.filter((target) => {
    const key = sourceRefTargetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

function readinessFindingEvidenceText(finding = {}, readiness = {}, index = 0) {
  const safeFinding = redactClientValue(finding);
  const safeReadiness = redactClientValue(readiness);
  return JSON.stringify({
    snapshotId: safeReadiness.snapshotId || "",
    checkedAt: safeReadiness.checkedAt || "",
    status: safeReadiness.status || "",
    finding: readinessFindingKey(safeFinding, index),
    severity: readinessFindingSeverity(safeFinding),
    plane: safeFinding.plane || "",
    context: readinessFindingContext(safeFinding),
    count: safeFinding.count ?? "",
    error: safeFinding.error || safeFinding.message || safeFinding.detail || "",
    sourceRefs: readinessFindingSourceRefs(safeFinding, safeReadiness, index)
  }, null, 2);
}

function inspectReadinessFinding(finding = {}, readiness = {}, index = 0) {
  const safeFinding = redactClientValue(finding);
  const safeReadiness = redactClientValue(readiness);
  const refs = readinessFindingSourceRefs(safeFinding, safeReadiness, index);
  const targets = readinessFindingTargets(safeFinding, safeReadiness, index);
  const severity = readinessFindingSeverity(safeFinding);
  showDrawer({
    title: "Readiness Finding Inspector",
    subtitle: readinessFindingKey(safeFinding, index),
    tone: readinessFindingTone(safeFinding),
    raw: { readiness: safeReadiness, finding: safeFinding, refs, targets },
    body: h("div", { className: "stack" }, [
      section("Finding", renderKeyValues([
        { label: "Severity", value: severity },
        { label: "Key", value: readinessFindingKey(safeFinding, index) },
        { label: "Plane", value: safeFinding.plane || "-" },
        { label: "Count", value: safeFinding.count ?? "-" },
        { label: "Context", value: readinessFindingContext(safeFinding) },
        { label: "Snapshot", value: safeReadiness.snapshotId || "-" },
        { label: "Checked", value: formatDate(safeReadiness.checkedAt) },
        { label: "Error / Detail", value: safeFinding.error || safeFinding.message || safeFinding.detail || "-" }
      ])),
      section("Source Refs", refs.length ? sourceRefList(refs, {
        workflowId: safeFinding.workflowId || safeFinding.workflow_id || "",
        agentId: safeFinding.agentId || safeFinding.agent_id || safeFinding.agent || ""
      }) : emptyState("No source refs for this readiness finding.")),
      section("Suggested Drilldowns", targets.length ? h("div", { className: "source-ref-actions" }, targets.map((target) => h("button", {
        type: "button",
        onClick: () => {
          closeDrawer();
          openCommandTarget(target);
        }
      }, target.label || "Open"))) : emptyState("No console drilldown is available for this finding.")),
      section("Copy Evidence", h("div", { className: "actions" }, [
        h("button", { type: "button", onClick: () => copyText(readinessFindingEvidenceText(safeFinding, safeReadiness, index), "Readiness evidence") }, "Copy Evidence"),
        h("button", { type: "button", onClick: () => copyText(readinessFindingKey(safeFinding, index), "Readiness finding key") }, "Copy Key")
      ])),
      section("Audit Boundary", h("p", { className: "muted" }, "This inspector reads the latest readiness snapshot and redacted finding payload. It does not run health checks, restart services, mutate workflow state, dispatch agents, or bypass Human Gate."))
    ])
  });
}

function renderReadinessFindings(readiness = {}) {
  const safeReadiness = redactClientValue(readiness || {});
  const findings = safeReadiness?.findings || [];
  if (!findings.length) return emptyState("No readiness findings in the latest snapshot.");
  const rows = findings.map((finding, index) => ({ finding, index }));
  return renderTable([
    { label: "Severity", render: ({ finding }) => chip(readinessFindingSeverity(finding), readinessFindingTone(finding)) },
    { label: "Finding", render: ({ finding, index }) => h("div", {}, [
      h("strong", {}, readinessFindingKey(finding, index)),
      h("p", { className: "muted" }, short(finding.error || finding.message || finding.detail || "", 120))
    ]) },
    { label: "Plane", render: ({ finding }) => finding.plane || "-" },
    { label: "Count", render: ({ finding }) => finding.count ?? "-" },
    { label: "Context", render: ({ finding }) => short(readinessFindingContext(finding), 160) },
    { label: "Evidence", render: ({ finding, index }) => h("div", { className: "actions compact-actions" }, [
      h("button", { type: "button", onClick: () => inspectReadinessFinding(finding, safeReadiness, index) }, "Inspect"),
      h("button", { type: "button", onClick: () => copyText(readinessFindingEvidenceText(finding, safeReadiness, index), "Readiness evidence") }, "Copy")
    ]) }
  ], rows, "No readiness findings in the latest snapshot.");
}

function agentSourceRefs(agent = {}) {
  return [
    { source: "runtime_agents", field: "agent_key", id: agent.agentKey },
    { source: "runtime_agents", field: "runtime_agent", id: agent.runtime && agent.agentId ? `${agent.runtime}:${agent.agentId}` : "" },
    { source: "runtime_agents", field: "endpoint_ref", id: agent.endpointRef },
    { source: "runtime_current_state", field: "active_workflow_id", id: agent.currentState?.activeWorkflowId },
    { source: "runtime_current_state", field: "active_dispatch_id", id: agent.currentState?.activeDispatchId },
    { source: "runtime_current_state", field: "runtime_run_id", id: agent.currentState?.runtimeRunId },
    { source: "latest", field: "dispatch_id", id: agent.latest?.dispatchId },
    { source: "latest", field: "flow_id", id: agent.latest?.flowId }
  ];
}

function kanbanSourceRefs(card = {}) {
  return [
    { source: card.source || "kanban", field: "source_id", id: card.sourceId },
    { source: "workflow", field: "workflow_id", id: card.workflowId },
    { source: "workflow_tasks", field: "task_id", id: card.taskId },
    { source: "mixed_meeting_dispatches", field: "dispatch_id", id: card.dispatchId },
    { source: "runtime_runs", field: "runtime_run_id", id: card.runtimeRunId },
    { source: "message_flows", field: "flow_id", id: card.flowId },
    { source: "telegram_outbox", field: "outbox_id", id: card.outboxId },
    { source: "human_gate", field: "human_gate_id", id: card.humanGateId },
    { source: "artifact", field: "artifact_ref", id: card.artifactRef },
    { source: "receipt", field: "receipt_ref", id: card.receiptRef }
  ];
}

function inspectAgent(agent = {}) {
  const current = agent.currentState || {};
  const latest = agent.latest || {};
  showDrawer({
    title: agent.agentId || agent.agentKey || "Agent",
    subtitle: agent.displayName || agent.role || agent.agentKey || "",
    tone: agent.attentionLevel || "ok",
    raw: agent,
    body: h("div", { className: "stack" }, [
      section("Identity", renderKeyValues([
        { label: "Agent", value: agent.agentId || "-" },
        { label: "Runtime", value: `${present(agent.runtime)} / ${present(agent.platform)}` },
        { label: "Role", value: agent.role || "-" },
        { label: "Dispatch", value: agent.canReceiveDispatch ? "enabled" : "disabled" },
        { label: "Endpoint", value: agent.endpointRef || "-" },
        { label: "Ingress", value: agent.workflowIngressAdapter || "-" }
      ])),
      section("Current State", renderKeyValues([
        { label: "Workflow", value: current.activeWorkflowId || "-" },
        { label: "Task", value: current.taskId || "-" },
        { label: "Dispatch", value: current.activeDispatchId || "-" },
        { label: "Stage", value: current.currentStage || current.status || "-" },
        { label: "Stage Status", value: current.stageStatus || "-" },
        { label: "Stale", value: current.staleKind || "-" },
        { label: "Artifact", value: current.latestArtifactRef || "-" },
        { label: "Receipt", value: current.latestReceiptRef || "-" },
        { label: "Updated", value: formatDate(current.lastEventAt || current.updatedAt) }
      ])),
      current.blockedReason ? section("Blocker", h("div", { className: "copy-block" }, current.blockedReason)) : null,
      section("Workload", renderKeyValues([
        { label: "Queued", value: agent.counts?.queued || 0 },
        { label: "Working", value: agent.counts?.working || 0 },
        { label: "Failed", value: agent.counts?.failed || 0 },
        { label: "Current States", value: agent.counts?.currentStates || 0 },
        { label: "Message Flows", value: agent.counts?.messageFlows || 0 }
      ])),
      section("Latest", renderKeyValues([
        { label: "Kind", value: latest.kind || "-" },
        { label: "Status", value: latest.status || "-" },
        { label: "Dispatch", value: latest.dispatchId || "-" },
        { label: "Flow", value: latest.flowId || "-" },
        { label: "At", value: formatDate(latest.lastEventAt) }
      ])),
      (agent.attentionFlags || []).length ? section("Attention Flags", h("div", { className: "chip-list padded" }, agent.attentionFlags.map((flag) => chip(flag.key, flag.severity)))) : null,
      section("Source Refs", sourceRefList(agentSourceRefs(agent), {
        workflowId: current.activeWorkflowId || latest.workflowId || "",
        agentId: agent.agentId || agent.agentKey || ""
      })),
      h("div", { className: "actions drawer-actions" }, [
        h("button", { type: "button", onClick: () => copyText(agent.agentId || agent.agentKey, "Agent") }, "Copy Agent"),
        current.activeWorkflowId ? h("button", { type: "button", onClick: () => {
          closeDrawer();
          selectWorkflow(current.activeWorkflowId);
        } }, "Open Workflow") : null
      ])
    ])
  });
}

function inspectKanbanCard(card = {}) {
  showDrawer({
    title: card.title || card.sourceId || "Kanban Card",
    subtitle: `${present(card.source)} / ${present(card.sourceId)}`,
    tone: card.status || card.column || "neutral",
    raw: card,
    body: h("div", { className: "stack" }, [
      section("Card", renderKeyValues([
        { label: "Column", value: card.column || "-" },
        { label: "Status", value: card.status || "-" },
        { label: "Workflow", value: card.workflowId || "-" },
        { label: "Agent", value: card.agentId || "-" },
        { label: "Runtime", value: card.runtime || "-" },
        { label: "Updated", value: formatDate(card.lastEventAt) }
      ])),
      card.summary ? section("Summary", h("div", { className: "copy-block" }, card.summary)) : null,
      section("Evidence Chain", renderKeyValues([
        { label: "Task", value: card.taskId || "-" },
        { label: "Dispatch", value: card.dispatchId || "-" },
        { label: "Runtime Run", value: card.runtimeRunId || "-" },
        { label: "Message Flow", value: card.flowId || "-" },
        { label: "Outbox", value: card.outboxId || "-" },
        { label: "Human Gate", value: card.humanGateId || "-" },
        { label: "Artifact", value: card.artifactRef || "-" },
        { label: "Receipt", value: card.receiptRef || "-" }
      ])),
      (card.missingEvidence || []).length ? section("Missing Evidence", h("div", { className: "chip-list padded" }, card.missingEvidence.map((item) => chip(item, "warning")))) : null,
      section("Next Safe Preview Actions", renderKanbanCardPreviewAudit(card)),
      section("Raw Detail And Audit Trail", renderKanbanCardDetailTargets(card)),
      section("Source Refs", sourceRefList(kanbanSourceRefs(card), {
        workflowId: card.workflowId || "",
        agentId: card.agentId || "",
        cardId: card.sourceId || ""
      })),
      h("div", { className: "actions drawer-actions" }, [
        h("button", { type: "button", onClick: () => copyText(card.sourceId || card.id, "Card") }, "Copy Card"),
        card.workflowId ? h("button", { type: "button", onClick: () => {
          closeDrawer();
          selectWorkflow(card.workflowId);
        } }, "Open Workflow") : null,
        card.dispatchId ? h("button", { type: "button", onClick: () => copyText(card.dispatchId, "Dispatch") }, "Copy Dispatch") : null,
        card.artifactRef ? h("button", { type: "button", onClick: () => copyText(card.artifactRef, "Artifact") }, "Copy Artifact") : null
      ])
    ])
  });
}

function renderKanbanCardDetailTargets(card = {}) {
  const targets = [];
  const seen = new Set();
  const pushTarget = (target = {}) => {
    if (!target.consoleView) return;
    const key = sourceRefTargetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };
  const workflowId = card.workflowId || "";
  if (workflowId) {
    pushTarget({ label: "Workflow", consoleView: "workflows", workflowId, tab: "overview" });
    pushTarget({ label: "Evidence", consoleView: "evidence-workspace", workflowId });
    pushTarget({ label: "Operations", consoleView: "operations", workflowId });
  }
  if (card.agentId) {
    pushTarget({ label: "Agent", consoleView: "agent-board", agentId: card.agentId });
    pushTarget({ label: "Focused Board", consoleView: "kanban", workflowId, agentId: card.agentId, cardId: card.sourceId || "" });
  }
  if (workflowId && (card.taskId || card.source === "workflow_tasks")) pushTarget({ label: "Tasks", consoleView: "workflows", workflowId, tab: "tasks" });
  if (workflowId && (card.dispatchId || card.source === "mixed_meeting_dispatches")) pushTarget({ label: "Dispatches", consoleView: "workflows", workflowId, tab: "dispatches" });
  if (workflowId && (card.runtimeRunId || card.source === "runtime_runs" || card.source === "runtime_current_state")) pushTarget({ label: "Runtime Runs", consoleView: "workflows", workflowId, tab: "runtime-runs" });
  if (workflowId && (card.flowId || card.source === "message_flows")) pushTarget({ label: "Message Flow", consoleView: "workflows", workflowId, tab: "message-flows" });
  if (workflowId && (card.outboxId || card.source === "telegram_outbox")) pushTarget({ label: "Outbox", consoleView: "workflows", workflowId, tab: "outbox" });
  if (workflowId && (card.humanGateId || card.source === "protocol_objects")) {
    pushTarget({ label: "Human Gate", consoleView: "workflows", workflowId, tab: "human-gates" });
    pushTarget({ label: "Gate Readiness", consoleView: "workflows", workflowId, tab: "human-gate-readiness" });
  }
  if (workflowId && card.source === "incident_states") pushTarget({ label: "Incidents", consoleView: "workflows", workflowId, tab: "incident-closeout" });
  const sideEffectNeedsEvidence = card.source === "side_effect_ledger" && ["uncertain", "side_effect_uncertain", "unknown", "failed"].includes(String(card.status || "").toLowerCase());
  if (workflowId && (card.artifactRef || card.receiptRef || sideEffectNeedsEvidence || (card.missingEvidence || []).length)) pushTarget({ label: "Evidence Desk", consoleView: "workflows", workflowId, tab: "evidence-desk" });
  if (!targets.length) return emptyState("No raw detail route can be inferred for this card.");
  return h("div", { className: "source-ref-actions" }, targets.map((target) => h("button", {
    type: "button",
    onClick: () => {
      closeDrawer();
      openCommandTarget(target);
    }
  }, target.label || "Open")));
}

function renderKanbanCardPreviewAudit(card = {}) {
  const specs = (card.previewActions || [])
    .map((action) => kanbanPreviewActionSpec(card, action))
    .filter(Boolean);
  if (!specs.length) return emptyState("No card-level preview action is advertised for this source.");
  return renderTable([
    { label: "Preview", render: (row) => h("button", {
      type: "button",
      disabled: !row.enabled,
      title: row.reason || row.label,
      onClick: row.enabled && row.onClick ? () => {
        closeDrawer();
        row.onClick();
      } : undefined
    }, row.label || row.action || "Preview") },
    { label: "Allowlist Action", render: (row) => h("code", {}, row.action || "-") },
    { label: "Status", render: (row) => chip(row.enabled ? "ready" : "blocked", row.enabled ? "ok" : "warning") },
    { label: "Audit Boundary", render: (row) => h("div", {}, [
      h("p", {}, "WorkflowActionGateway -> workflow_operations"),
      h("p", { className: "muted" }, row.reason || "Preview only; no business-state mutation until an explicitly enabled action passes policy.")
    ]) }
  ], specs, "No preview actions.");
}

function renderMetrics(workflows) {
  const totals = workflows.reduce((acc, item) => {
    const counts = countsFor(item);
    acc.total += 1;
    acc.tasks += counts.tasks || 0;
    acc.blocked += counts.blocked || 0;
    acc.human += counts.pendingHumanGates || 0;
    acc.failedDispatches += counts.failedDispatches || 0;
    acc.queuedDispatches += counts.queuedDispatches || 0;
    acc.failedOutbox += counts.failedOutbox || 0;
    return acc;
  }, { total: 0, tasks: 0, blocked: 0, human: 0, failedDispatches: 0, queuedDispatches: 0, failedOutbox: 0 });
  $("#metrics").replaceChildren(
    statCard("Workflows", totals.total),
    statCard("Tasks", totals.tasks, `${totals.blocked} blocked`),
    statCard("Human Gates", totals.human),
    statCard("Dispatch", totals.queuedDispatches, `${totals.failedDispatches} failed`),
    statCard("Outbox Failed", totals.failedOutbox)
  );
  $("#workflowCount").textContent = `${totals.total} loaded`;
}

function renderWorkflowList() {
  const list = $("#workflowList");
  list.replaceChildren();
  if (!state.workflows.length) {
    list.append(emptyState("No workflows in this view."));
    return;
  }
  for (const item of state.workflows) {
    const counts = countsFor(item);
    const active = item.workflowId === state.selectedWorkflowId;
    const button = h("button", {
      className: `workflow-item ${active ? "active" : ""}`,
      onClick: () => selectWorkflow(item.workflowId),
      "aria-pressed": active ? "true" : "false"
    }, [
      h("div", { className: "workflow-title" }, [
        h("strong", {}, item.workflowId),
        chip(item.status)
      ]),
      h("p", { className: "workflow-summary" }, short(item.summary || item.objective || item.workflowType, 150)),
      h("div", { className: "workflow-meta" }, [
        h("span", {}, present(item.ownerAgent)),
        h("span", {}, item.currentPhase ? `phase ${item.currentPhase}` : "no phase"),
        h("span", {}, item.currentDecision ? `decision ${item.currentDecision}` : "no decision")
      ]),
      h("div", { className: "mini-counts" }, [
        h("span", {}, `tasks ${counts.tasks || 0}`),
        h("span", {}, `blocked ${counts.blocked || 0}`),
        h("span", {}, `human ${counts.pendingHumanGates || 0}`),
        h("span", {}, `dispatch ${counts.queuedDispatches || 0}/${counts.failedDispatches || 0}`)
      ])
    ]);
    list.append(button);
  }
}

function renderDetailHeader() {
  const item = selectedWorkflow();
  $("#detailTitle").textContent = item?.workflowId || "Select a workflow";
  $("#detailSubtitle").textContent = item ? short(item.summary || item.objective || item.workflowType, 190) : "No workflow selected.";
  $("#previewButton").disabled = !state.selectedWorkflowId;
  const summary = $("#detailSummary");
  summary.replaceChildren();
  if (!item) return;
  const counts = countsFor(item);
  summary.append(
    statCard("Status", item.status, item.ownerAgent || ""),
    statCard("Tasks", counts.tasks || 0, `${counts.inProgress || 0} running`),
    statCard("Blocked", counts.blocked || 0),
    statCard("Human Gate", counts.pendingHumanGates || 0),
    statCard("Dispatch Failed", counts.failedDispatches || 0),
    statCard("Updated", formatDate(item.updatedAt))
  );
}

function setViewButtons() {
  document.querySelectorAll(".view-tabs button").forEach((button) => {
    if (button.dataset.consoleView) button.classList.toggle("active", button.dataset.consoleView === state.consoleView);
    else button.classList.toggle("active", state.consoleView === "workflows" && button.dataset.view === state.view);
  });
  updateContextTrail();
}

function setTabButtons() {
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === state.tab);
  });
}

async function loadConfig() {
  const config = await api("/api/config");
  state.config = config;
  $("#configLine").textContent = `${config.rootDir} | ${config.actionMode} | ${formatDate(config.serverTime)}`;
  updateContextTrail();
}

async function loadWorkflows() {
  setActionStatus("Loading workflows...", "neutral");
  const data = await api(`/api/workflows?view=${encodeURIComponent(state.view)}&limit=100`);
  state.workflows = data.workflows || [];
  const urlWorkflowViews = ["workflows", "evidence-workspace", "operations", "kanban"];
  let shouldReplaceWorkflowUrl = false;
  const shouldAutoSelectWorkflow = !["activity", "operations"].includes(state.consoleView)
    && !(state.consoleView === "kanban" && state.kanbanScope === "global");
  if (!state.selectedWorkflowId && shouldAutoSelectWorkflow && state.workflows[0]) {
    state.selectedWorkflowId = state.workflows[0].workflowId;
    shouldReplaceWorkflowUrl = urlWorkflowViews.includes(state.consoleView);
  }
  if (state.consoleView === "workflows" && state.selectedWorkflowId && !state.workflows.some((item) => item.workflowId === state.selectedWorkflowId)) {
    state.selectedWorkflowId = state.workflows[0]?.workflowId || "";
    state.detail = null;
    shouldReplaceWorkflowUrl = true;
  }
  if (shouldReplaceWorkflowUrl) writeUrlState({ replace: true });
  renderMetrics(state.workflows);
  renderWorkflowList();
  renderDetailHeader();
  setViewButtons();
  if (state.consoleView !== "workflows") return loadGlobalView();
  setActionStatus("Loaded", "ok");
  if (state.selectedWorkflowId) await loadDetail();
  else setDetailBody(emptyState("Select a workflow from the left queue."));
}

async function selectWorkflow(workflowId) {
  const wasGlobal = state.consoleView !== "workflows";
  if (["evidence-workspace", "operations"].includes(state.consoleView)) {
    state.scopedActivity = false;
    state.selectedWorkflowId = workflowId;
    state.detail = null;
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    scrollToConsoleSection(target.section);
    return;
  }
  state.consoleView = "workflows";
  state.scopedActivity = false;
  clearFocusState();
  if (state.selectedWorkflowId === workflowId && !wasGlobal) return;
  state.selectedWorkflowId = workflowId;
  state.detail = null;
  setViewButtons();
  writeUrlState();
  renderWorkflowList();
  renderDetailHeader();
  await loadDetail();
}

function renderGlobalPayload(data) {
  if (state.consoleView === "activity") renderActivityFeed(data);
  else if (state.consoleView === "agent-board") renderAgentBoard(data);
  else if (state.consoleView === "kanban") renderKanban(data);
  else if (state.consoleView === "evidence-workspace") renderEvidenceWorkspace(data);
  else if (state.consoleView === "operations") renderOperations(data);
  else if (state.consoleView === "system") renderSystemStatus(data);
  else if (state.consoleView === "search") renderSearchResults(data);
  else renderCommandCenter(data);
}

async function loadGlobalView() {
  setViewButtons();
  writeUrlState();
  $("#previewButton").disabled = true;
  const titleByView = {
    "command-center": "Command Center",
    activity: "Activity Feed",
    "agent-board": "Agent Board",
    kanban: "Workflow Kanban",
    "evidence-workspace": "Evidence Workspace",
    operations: "Operations",
    system: "System Status",
    search: "Global Search"
  };
  const subtitleByView = {
    "command-center": "Global readiness, queue, runtime, communication and evidence summary.",
    activity: "Recent blockers, operations, dead letters, control-loop jobs and message_flow attention.",
    "agent-board": "Registry-first agent runtime, dispatchability, current work and attention view.",
    kanban: "Derived read-only board over workflow, dispatch, runtime, message_flow, outbox and Human Gate state.",
    "evidence-workspace": "Workflow evidence package, incident closeout, Human Gate readiness and export surface.",
    operations: "Global operation audit, dead-letter evidence, queue pressure and governed preview surface.",
    system: "Console health, action policy, safety boundaries, redaction and readiness evidence.",
    search: "Search workflow, dispatch, agent, message_flow, artifact, Human Gate and incident anchors."
  };
  $("#detailTitle").textContent = titleByView[state.consoleView] || "Workflow Console";
  $("#detailSubtitle").textContent = subtitleByView[state.consoleView] || "";
  $("#detailSummary").replaceChildren();
  setDetailBody(emptyState("Loading control plane view..."));
  setActionStatus("Loading control plane view...", "neutral");
  const path = state.consoleView === "activity"
    ? `/api/activity-feed${state.selectedWorkflowId ? `?workflowId=${encodeURIComponent(state.selectedWorkflowId)}` : ""}`
    : state.consoleView === "agent-board"
    ? "/api/agent-board"
      : state.consoleView === "kanban"
        ? `/api/kanban?${kanbanQueryParams().toString()}`
        : "/api/command-center";
  try {
    const data = state.consoleView === "evidence-workspace"
      ? await loadEvidenceWorkspacePayload()
      : state.consoleView === "operations"
        ? await loadOperationsPayload()
        : state.consoleView === "system"
          ? await loadSystemStatusPayload()
          : state.consoleView === "search"
            ? await api("/api/search", { method: "POST", body: JSON.stringify({ q: state.searchQuery, limit: 100 }) })
            : await api(path);
    state.lastPayload = data;
    renderGlobalPayload(data);
    setActionStatus("Ready", "ok");
  } catch (error) {
    setDetailBody(h("div", { className: "error" }, error.message));
    setActionStatus("Error", "critical");
  }
}

async function loadSystemStatusPayload() {
  const safeApi = async (path) => {
    try {
      return { ok: true, value: await api(path) };
    } catch (error) {
      return { ok: false, error: { path, message: error.message } };
    }
  };
  const [configResult, healthResult, readinessResult] = await Promise.all([
    safeApi("/api/config"),
    safeApi("/health"),
    safeApi("/api/readiness/latest")
  ]);
  const config = configResult.ok ? configResult.value : (state.config || { service: "workflow-console", configError: configResult.error });
  const health = healthResult.ok ? healthResult.value : { ok: false, service: "workflow-console", error: healthResult.error };
  const readiness = readinessResult.ok ? readinessResult.value : { status: "unavailable", checkedAt: "", findings: [readinessResult.error] };
  state.config = config;
  return {
    schemaVersion: "workflow_console_system_status.v1",
    generatedAt: new Date().toISOString(),
    config,
    health,
    readiness,
    partialFailures: [configResult, healthResult, readinessResult]
      .filter((result) => !result.ok)
      .map((result) => result.error)
  };
}

async function loadEvidenceWorkspacePayload() {
  const workflowId = state.selectedWorkflowId || state.workflows[0]?.workflowId || "";
  if (!workflowId) {
    return {
      schemaVersion: "workflow_console_evidence_workspace.v1",
      generatedAt: new Date().toISOString(),
      workflowId: "",
      status: "no_workflow_selected",
      evidenceDesk: null,
      evidencePack: null,
      incidentCloseout: null
    };
  }
  state.selectedWorkflowId = workflowId;
  writeUrlState();
  renderWorkflowList();
  renderDetailHeader();
  const encoded = encodeURIComponent(workflowId);
  const [evidenceDesk, evidencePack, incidentCloseout] = await Promise.all([
    api(`/api/workflows/${encoded}/evidence-desk`),
    api(`/api/workflows/${encoded}/evidence-pack`),
    api(`/api/workflows/${encoded}/incident-closeout`)
  ]);
  state.detail = evidencePack.workflow || evidenceDesk.workflow || null;
  renderDetailHeader();
  return {
    schemaVersion: "workflow_console_evidence_workspace.v1",
    generatedAt: new Date().toISOString(),
    workflowId,
    status: evidenceDesk.status || incidentCloseout.status || "ready",
    evidenceDesk,
    evidencePack,
    incidentCloseout
  };
}

function operationsQueryParams(workflowId = "") {
  const params = new URLSearchParams();
  if (workflowId) params.set("workflowId", workflowId);
  if (state.operationsFilters.kind) params.set("deadLetterKind", state.operationsFilters.kind);
  if (state.operationsFilters.severity) params.set("deadLetterSeverity", state.operationsFilters.severity);
  if (state.operationsFilters.status) params.set("deadLetterStatus", state.operationsFilters.status);
  return params;
}

function kanbanQueryParams() {
  const params = new URLSearchParams();
  const scope = state.kanbanScope === "workflow" && state.selectedWorkflowId ? "workflow" : "global";
  params.set("scope", scope);
  if (scope === "workflow") params.set("workflowId", state.selectedWorkflowId);
  if (state.focusAgentId) params.set("agentId", state.focusAgentId);
  return params;
}

function availableValues(rows = [], key) {
  return new Set(rows.map((row) => String(row?.[key] || "").trim()).filter(Boolean));
}

function normalizeOperationsFiltersFromPayload(data = {}) {
  let changed = false;
  const availableKinds = availableValues(data.deadLetterAvailableSummary || [], "kind");
  const availableSeverities = availableValues(data.deadLetterAvailableSummary || [], "severity");
  const availableStatuses = availableValues(data.deadLetterAvailableStatuses || [], "status");
  if (state.operationsFilters.kind && !availableKinds.has(state.operationsFilters.kind)) {
    state.operationsFilters.kind = "";
    changed = true;
  }
  if (state.operationsFilters.severity && !availableSeverities.has(state.operationsFilters.severity)) {
    state.operationsFilters.severity = "";
    changed = true;
  }
  if (state.operationsFilters.status && !availableStatuses.has(state.operationsFilters.status)) {
    state.operationsFilters.status = "";
    changed = true;
  }
  return changed;
}

async function loadOperationsPayload() {
  const workflowId = state.selectedWorkflowId || "";
  const fetchOperations = () => {
    const params = operationsQueryParams(workflowId);
    return api(`/api/operations/summary?${params.toString()}`);
  };
  let operations = null;
  if (workflowId) {
    const encoded = encodeURIComponent(workflowId);
    const [firstOperations, detail] = await Promise.all([
      fetchOperations(),
      api(`/api/workflows/${encoded}`).catch(() => null)
    ]);
    operations = firstOperations;
    if (normalizeOperationsFiltersFromPayload(operations)) {
      writeUrlState({ replace: true });
      operations = await fetchOperations();
    }
    state.detail = detail || null;
    renderDetailHeader();
    return operations;
  }
  operations = await fetchOperations();
  if (normalizeOperationsFiltersFromPayload(operations)) {
    writeUrlState({ replace: true });
    operations = await fetchOperations();
  }
  return operations;
}

function detailPath(workflowId, tab) {
  const encoded = encodeURIComponent(workflowId);
  if (tab === "overview" || tab === "raw") return `/api/workflows/${encoded}`;
  if (tab === "evidence-desk") return `/api/workflows/${encoded}/evidence-desk`;
  if (tab === "operations") {
    const params = operationsQueryParams(workflowId);
    return `/api/operations/summary?${params.toString()}`;
  }
  return `/api/workflows/${encoded}/${tab}`;
}

async function loadDetail() {
  const workflowId = state.selectedWorkflowId;
  if (!workflowId) return;
  const seq = ++state.detailSeq;
  setDetailBody(emptyState("Loading detail..."));
  setActionStatus("Loading detail...", "neutral");
  try {
    let data = await api(detailPath(workflowId, state.tab));
    if (state.tab === "operations" && normalizeOperationsFiltersFromPayload(data)) {
      writeUrlState({ replace: true });
      data = await api(detailPath(workflowId, state.tab));
    }
    if (seq !== state.detailSeq) return;
    state.lastPayload = data;
    if (state.tab === "overview" || state.tab === "raw") state.detail = data;
    renderDetailHeader();
    renderCurrentTab(data);
    setActionStatus("Ready", "ok");
  } catch (error) {
    if (seq !== state.detailSeq) return;
    setDetailBody(h("div", { className: "error" }, error.message));
    setActionStatus("Error", "critical");
  }
}

async function openWorkflowTab(workflowId, tab = "overview") {
  if (!workflowId) return;
  state.consoleView = "workflows";
  clearFocusState();
  state.selectedWorkflowId = workflowId;
  state.tab = tab;
  state.detail = null;
  setViewButtons();
  setTabButtons();
  writeUrlState();
  renderWorkflowList();
  renderDetailHeader();
  await loadDetail();
}

function renderCurrentTab(data) {
  if (state.tab === "overview") return renderOverview(data);
  if (state.tab === "phases") return renderPhases(data);
  if (state.tab === "tasks") return renderTasks(data);
  if (state.tab === "dispatches") return renderDispatches(data);
  if (state.tab === "runtime-runs") return renderRuntimeRuns(data);
  if (state.tab === "agent-runs") return renderAgentRuns(data);
  if (state.tab === "verification") return renderVerification(data);
  if (state.tab === "message-flows") return renderMessageFlows(data);
  if (state.tab === "timeline") return renderTimeline(data);
  if (state.tab === "incident-closeout") return renderIncidentCloseout(data);
  if (state.tab === "human-gates") return renderHumanGates(data);
  if (state.tab === "human-gate-readiness") return renderHumanGateReadiness(data);
  if (state.tab === "outbox") return renderOutbox(data);
  if (state.tab === "operations") return renderOperations(data);
  if (state.tab === "evidence") return renderEvidence(data);
  if (state.tab === "receipts") return renderReceipts(data);
  if (state.tab === "evidence-desk") return renderEvidenceDesk(data);
  if (state.tab === "evidence-pack") return renderEvidencePack(data);
  return setDetailBody(jsonBlock(data));
}

function renderCommandCenter(data) {
  const workflow = data.workflowSummary || {};
  const runtime = data.runtimeSummary || {};
  const queue = data.queueSummary || {};
  const communication = data.communication || {};
  const evidence = data.evidence || {};
  const readiness = data.readiness || {};
  const triage = data.triage || {};
  const blockers = triage.topBlockers || [];
  const critical = data.attention?.critical || [];
  const warning = data.attention?.warning || [];
  setDetailBody(h("div", { className: "stack" }, [
    section("Operator Triage", h("div", { className: "quick-stats" }, [
      statCard("Overall", triage.overallState || readiness.status || "unknown", formatDate(data.generatedAt)),
      statCard("Blockers", triage.blockerCount || 0, `${blockers.length || 0} shown`),
      statCard("Runtime", triage.planes?.runtime || 0),
      statCard("Queue", triage.planes?.queue || 0),
      statCard("Communication", triage.planes?.communication || 0),
      statCard("Human Gate", triage.planes?.human_gate || 0),
      statCard("Evidence", triage.planes?.evidence || 0)
    ])),
    section("Diagnostic Matrix", renderDiagnosticMatrix(data)),
    section("Critical Blockers", blockers.length ? h("div", { className: "search-results" }, blockers.map(renderTriageBlocker)) : emptyState("No current blockers. The command center is ready.")),
    section("Control Plane", h("div", { className: "quick-stats" }, [
      statCard("Readiness", readiness.status || "unknown", formatDate(readiness.checkedAt)),
      statCard("Findings", readiness.findingCount || 0),
      statCard("Workflows", workflow.total || 0, `${workflow.blocked || 0} blocked`),
      statCard("Runtime Agents", runtime.total || 0, `${runtime.dispatchable || 0} dispatchable`),
      statCard("Queue", queue.total || 0, `${queue.failed || 0} failed / ${queue.dead_letter || 0} dead`),
      statCard("Human Gate", data.humanGate?.pending || workflow.pendingHumanGates || 0),
      statCard("Message Flow", communication.messageFlow?.total || 0, `${communication.messageFlowAttention || 0} attention`),
      statCard("Evidence Gaps", evidence.deadLetters || 0, `${evidence.sideEffectUncertain || 0} side-effect uncertain`)
    ])),
    section("Runtime Platforms", renderTable([
      { label: "Platform", key: "platform" },
      { label: "Agents", key: "count" }
    ], Object.entries(runtime.byPlatform || {}).map(([platform, count]) => ({ platform, count })), "No runtime platform summary.")),
    section("Attention", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Critical", render: (row) => chip(row.key, "critical") }
      ], critical.map((key) => ({ key })), "No critical attention."),
      renderTable([
        { label: "Warning", render: (row) => chip(row.key, "warning") }
      ], warning.map((key) => ({ key })), "No warning attention.")
    ])),
    section("Top Workflows", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Workflow", render: (row) => h("button", { onClick: () => selectWorkflow(row.workflowId) }, row.workflowId) },
      { label: "Owner", key: "ownerAgent" },
      { label: "Tasks", render: (row) => row.counts?.tasks || 0 },
      { label: "Human", render: (row) => row.counts?.pendingHumanGates || 0 },
      { label: "Failed Dispatch", render: (row) => row.counts?.failedDispatches || 0 },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) }
    ], data.topWorkflows || [], "No workflows recorded.")),
    section("Raw", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function diagnosticMatrixRows(data = {}) {
  const blockers = data.triage?.blockers || [];
  const attention = [...(data.attention?.critical || []), ...(data.attention?.warning || [])];
  const workflow = data.workflowSummary || {};
  const communication = data.communication || {};
  const humanGate = data.humanGate || {};
  const readiness = data.readiness || {};
  const readinessStatus = String(readiness.status || "").toLowerCase();
  const readinessCritical = ["not_ready", "failed", "unavailable", "error", "critical"].includes(readinessStatus);
  const readinessWarning = Boolean(readinessStatus && readinessStatus !== "ready" && !readinessCritical);
  const matchBlockers = (predicate) => blockers.filter((blocker) => predicate({
    ...blocker,
    idText: String(blocker.id || "").toLowerCase(),
    titleText: String(blocker.title || "").toLowerCase(),
    detailText: String(blocker.detail || "").toLowerCase()
  }));
  const countBlockers = (items, fallback = 0) => items.length
    ? items.reduce((total, item) => total + Number(item.count || 1), 0)
    : fallback;
  const firstTarget = (items, fallback) => items.find((item) => item.target)?.target || fallback;
  const staleDispatch = matchBlockers((item) => /failed_dispatch|max_attempt_dispatch|stale_dispatch/.test(item.idText));
  const missingReceipt = matchBlockers((item) => /message_flow_delivery_missing|receipt_missing|missing_receipt/.test(item.idText + item.detailText));
  const failedTelegram = matchBlockers((item) => /failed_outbox|telegram/.test(item.idText + item.titleText + item.detailText));
  const blockedHumanGate = matchBlockers((item) => /pending_human_gate|human_gate_feedback|blocked_human_gate/.test(item.idText));
  const runtimeFailure = matchBlockers((item) => (
    item.plane === "runtime" ||
    /readiness_not_ready|runtime_failed|runtime failure|runtime_failure/.test(item.idText + item.titleText + item.detailText)
  ));
  return [
    {
      key: "stale_dispatch",
      label: "Stale Dispatch",
      count: countBlockers(staleDispatch, workflow.failedDispatches || 0),
      severity: staleDispatch.some((item) => item.severity === "critical") || workflow.failedDispatches ? "critical" : "ok",
      detail: "Dispatch evidence needs Operations, board placement, and source refs.",
      target: firstTarget(staleDispatch, { consoleView: "operations" }),
      blockers: staleDispatch
    },
    {
      key: "missing_receipt",
      label: "Missing Receipt",
      count: countBlockers(missingReceipt, attention.includes("message_flow_attention") ? (communication.messageFlowAttention || 1) : 0),
      severity: missingReceipt.length || attention.includes("message_flow_attention") ? "warning" : "ok",
      detail: "Receipt gaps need message_flow, Kanban, and Evidence context.",
      target: firstTarget(missingReceipt, { consoleView: "kanban" }),
      blockers: missingReceipt
    },
    {
      key: "failed_telegram",
      label: "Failed Telegram",
      count: countBlockers(failedTelegram, workflow.failedOutbox || communication.telegramOutbox?.failed || 0),
      severity: failedTelegram.length || workflow.failedOutbox || communication.telegramOutbox?.failed ? "critical" : "ok",
      detail: "Delivery failures need outbox evidence and governed preview paths.",
      target: firstTarget(failedTelegram, { consoleView: "operations" }),
      blockers: failedTelegram
    },
    {
      key: "blocked_human_gate",
      label: "Blocked Human Gate",
      count: countBlockers(blockedHumanGate, humanGate.pending || workflow.pendingHumanGates || 0),
      severity: blockedHumanGate.length || humanGate.pending || workflow.pendingHumanGates ? "warning" : "ok",
      detail: "Human Gate blockers need readiness, buttons, and evidence package review.",
      target: firstTarget(blockedHumanGate, { consoleView: "evidence-workspace" }),
      blockers: blockedHumanGate
    },
    {
      key: "runtime_failure",
      label: "Runtime Failure",
      count: countBlockers(runtimeFailure, (readinessCritical || readinessWarning) ? (readiness.findingCount || 1) : 0),
      severity: runtimeFailure.length || readinessCritical ? "critical" : readinessWarning ? "warning" : "ok",
      detail: "Runtime findings need System status and registry-first agent context.",
      target: firstTarget(runtimeFailure, { consoleView: "system" }),
      blockers: runtimeFailure
    }
  ];
}

function sourceRefKey(ref = {}) {
  return `${ref.source || ""}.${ref.field || ""}=${ref.id || ""}`;
}

function diagnosticMatrixSourceRefs(row = {}) {
  const seen = new Set();
  const refs = [];
  for (const blocker of row.blockers || []) {
    for (const ref of blocker.sourceRefs || []) {
      if (!ref?.id) continue;
      const key = sourceRefKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push(ref);
    }
  }
  return refs;
}

function diagnosticMatrixTargetKey(target = {}) {
  return JSON.stringify({
    label: target.label || "",
    consoleView: target.consoleView || "",
    workflowId: target.workflowId || "",
    tab: target.tab || "",
    agentId: target.agentId || "",
    cardId: target.cardId || "",
    section: target.section || "",
    operationsFilters: target.operationsFilters || {}
  });
}

function diagnosticMatrixRelatedTargets(row = {}) {
  const seen = new Set();
  const targets = [];
  const pushTarget = (target = {}) => {
    if (!target?.consoleView) return;
    const key = diagnosticMatrixTargetKey(target);
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };
  pushTarget({ label: "Inspect", ...(row.target || {}) });
  for (const blocker of row.blockers || []) {
    for (const target of blocker.relatedTargets || []) pushTarget(target);
  }
  return targets;
}

function diagnosticMatrixTargetLabel(target = {}) {
  return target.label || (target.consoleView === "agent-board" ? "Agent"
    : target.consoleView === "kanban" ? "Board"
      : target.consoleView === "evidence-workspace" ? "Evidence"
        : target.consoleView === "operations" ? "Operations"
          : target.consoleView === "system" ? "System"
            : "Open");
}

function diagnosticMatrixRunbookSteps(row = {}) {
  const common = [
    "Start from the linked console surface, not raw database rows.",
    "Inspect source refs and evidence gaps before preparing any governed preview.",
    "Keep write actions disabled unless startup policy and Human Gate explicitly allow them."
  ];
  const stepsByKey = {
    stale_dispatch: [
      "Open Operations with the dispatch filters to confirm attempt count, failure type, and latest error.",
      "Open the focused Kanban card to check whether the task is still active, stale, or already superseded.",
      "Inspect Evidence for rollback boundaries before preparing a reconcile or rerun preview."
    ],
    missing_receipt: [
      "Open the Message Flow or focused Kanban route to confirm ACK, delivery, runtime receipt, and timeout windows.",
      "Compare dispatch, runtime run, and message_flow refs before treating the result as missing.",
      "Prepare only a governed reconcile preview if terminal receipt evidence remains absent."
    ],
    failed_telegram: [
      "Open Outbox or Operations to confirm delivery status, target, retry state, and receipt completeness.",
      "Inspect Evidence to verify the Human Gate or report object before any redelivery preview.",
      "Do not create a parallel Human Gate; preserve existing ids and delivery history."
    ],
    blocked_human_gate: [
      "Open Gate Readiness to confirm buttons, Chinese summary, options, Telegram delivery, and resume boundary.",
      "Inspect Evidence for Cat Claw review, rollback/stop conditions, and artifact references.",
      "Return incomplete packages to the workflow before presenting a Human Gate."
    ],
    runtime_failure: [
      "Open System and Agent Board to compare readiness findings with runtime registry ownership.",
      "Check whether the affected runtime, agent, dispatch, and message_flow evidence agree.",
      "Escalate to governed stability handling only after the failing plane and rollback path are clear."
    ]
  };
  return stepsByKey[row.key] || common;
}

function diagnosticMatrixEvidenceSummary(row = {}) {
  const refs = diagnosticMatrixSourceRefs(row);
  if (refs.length) return refs.map(sourceRefKey).join("\n");
  if (row.blockers?.length) return row.blockers.map((blocker) => blocker.id).filter(Boolean).join("\n");
  return `${row.label || "Diagnostic"}: ${row.severity || "unknown"} / count ${row.count || 0}`;
}

function inspectDiagnosticRunbook(row = {}) {
  const refs = diagnosticMatrixSourceRefs(row);
  const targets = diagnosticMatrixRelatedTargets(row);
  const steps = diagnosticMatrixRunbookSteps(row);
  showDrawer({
    title: `${row.label || "Diagnostic"} Runbook`,
    subtitle: row.detail || "Read-only diagnostic guidance",
    tone: row.severity || "neutral",
    raw: { row, refs, targets, steps },
    body: h("div", { className: "stack" }, [
      section("Current Signal", renderKeyValues([
        { label: "Status", value: row.severity === "ok" ? "clear" : row.severity || "unknown" },
        { label: "Count", value: row.count || 0 },
        { label: "Diagnostic", value: row.key || "-" },
        { label: "Detail", value: row.detail || "-" }
      ])),
      section("Evidence To Inspect", refs.length ? sourceRefList(refs, {
        workflowId: row.blockers?.find((blocker) => blocker.workflowId)?.workflowId || row.target?.workflowId || "",
        agentId: row.blockers?.find((blocker) => blocker.agentId)?.agentId || row.target?.agentId || ""
      }) : emptyState(row.count ? "Open the linked surface for row-level source refs." : "No active source refs.")),
      section("Suggested Check Order", h("ol", { className: "compact-list" }, steps.map((step) => h("li", {}, step)))),
      section("Governed Drilldowns", targets.length ? h("div", { className: "source-ref-actions" }, targets.map((target) => h("button", {
        type: "button",
        onClick: () => {
          closeDrawer();
          openCommandTarget(target);
        }
      }, diagnosticMatrixTargetLabel(target)))) : emptyState("No governed drilldown route is currently available.")),
      section("Boundary", h("p", { className: "muted" }, "This runbook is read-only. It explains inspection order and routes to governed console surfaces; it does not retry jobs, redeliver messages, mutate workflow state, or bypass Human Gate.")),
      h("div", { className: "actions drawer-actions" }, [
        h("button", { type: "button", onClick: () => copyText(diagnosticMatrixEvidenceSummary(row), `${row.label || "Diagnostic"} evidence`) }, "Copy Evidence"),
        h("button", { type: "button", onClick: () => copyText(steps.join("\n"), `${row.label || "Diagnostic"} runbook`) }, "Copy Runbook")
      ])
    ])
  });
}

function renderDiagnosticMatrix(data = {}) {
  const rows = diagnosticMatrixRows(data);
  return h("div", { className: "triage-matrix" }, rows.map((row) => {
    const refs = diagnosticMatrixSourceRefs(row);
    const relatedTargets = diagnosticMatrixRelatedTargets(row);
    const evidenceText = diagnosticMatrixEvidenceSummary(row);
    return h("article", { className: `triage-matrix-row ${row.severity}` }, [
      h("div", { className: "triage-matrix-main" }, [
        h("div", { className: "workflow-title" }, [
          h("strong", {}, row.label),
          chip(row.severity === "ok" ? "clear" : row.severity, row.severity)
        ]),
        h("p", { className: "workflow-summary" }, row.detail),
        row.blockers.length ? h("div", { className: "mini-counts" }, row.blockers.slice(0, 4).map((blocker) => (
          h("span", {}, short(blocker.id, 96))
        ))) : null,
        h("div", { className: "triage-matrix-evidence" }, [
          h("strong", {}, "Evidence Preview"),
          refs.length ? h("div", { className: "source-ref-chips" }, refs.slice(0, 6).map((ref) => (
            renderSourceRefChip(ref, {
              workflowId: row.blockers.find((blocker) => blocker.workflowId)?.workflowId || row.target?.workflowId || "",
              agentId: row.blockers.find((blocker) => blocker.agentId)?.agentId || row.target?.agentId || ""
            })
          ))) : h("p", { className: "muted" }, row.count ? "Open the linked surface for row-level source refs." : "No active source refs."),
          relatedTargets.length ? h("div", { className: "triage-matrix-related" }, relatedTargets.slice(0, 4).map((target) => (
            h("button", { type: "button", onClick: () => openCommandTarget(target) }, diagnosticMatrixTargetLabel(target))
          ))) : null
        ])
      ]),
      h("div", { className: "triage-matrix-actions" }, [
        h("strong", {}, String(row.count || 0)),
        h("button", { type: "button", onClick: () => openCommandTarget(row.target) }, "Inspect"),
        h("button", { type: "button", onClick: () => inspectDiagnosticRunbook(row) }, "Runbook"),
        h("button", { type: "button", onClick: () => copyText(evidenceText, `${row.label} evidence`) }, "Copy Evidence")
      ])
    ]);
  }));
}

function renderActivityFeed(data) {
  const summary = data.summary || {};
  const items = data.items || [];
  const groupRows = Object.entries(summary.byGroup || {}).map(([group, count]) => ({ group, count }));
  const severityRows = Object.entries(summary.bySeverity || {}).map(([severity, count]) => ({ severity, count }));
  const relatedButton = (target = {}) => {
    const label = target.label || (target.consoleView === "agent-board" ? "Agent"
      : target.consoleView === "kanban" ? "Board"
        : target.consoleView === "evidence-workspace" ? "Evidence"
          : target.consoleView === "operations" ? "Operations"
            : "Open");
    return h("button", { type: "button", onClick: () => openCommandTarget(target) }, label);
  };
  const activityItem = (item = {}) => {
    const refs = item.sourceRefs || [];
    const relatedTargets = item.relatedTargets || [];
    return h("article", { className: `activity-item ${item.severity || "neutral"}` }, [
      h("div", { className: "activity-marker" }),
      h("div", { className: "activity-body" }, [
        h("div", { className: "search-result-head" }, [
          h("div", {}, [
            h("div", { className: "workflow-title" }, [
              h("strong", {}, short(item.title || item.id, 140)),
              chip(item.group || "activity", "neutral"),
              chip(item.status || item.severity || "neutral", item.severity || toneFor(item.status))
            ]),
            item.subtitle ? h("p", { className: "workflow-summary" }, short(item.subtitle, 260)) : null
          ]),
          h("div", { className: "actions search-actions" }, [
            h("button", { type: "button", onClick: () => openCommandTarget(item.target || {}) }, "Open"),
            ...relatedTargets.slice(0, 3).map(relatedButton),
            item.workflowId ? h("button", { type: "button", onClick: () => copyText(item.workflowId, "Workflow") }, "Copy Workflow") : null,
            h("button", { type: "button", onClick: () => copyText(item.id, "Activity") }, "Copy Id")
          ])
        ]),
        h("div", { className: "workflow-meta" }, [
          h("span", {}, formatDate(item.at)),
          h("span", {}, item.workflowId ? `workflow ${item.workflowId}` : "global"),
          h("span", {}, item.agentId || "-"),
          h("span", {}, item.runtime || "-")
        ]),
        refs.length ? h("div", { className: "source-ref-chips" }, refs.slice(0, 6).map((ref) => renderSourceRefChip(ref, {
          workflowId: item.workflowId || "",
          agentId: item.agentId || ""
        }))) : null
      ])
    ]);
  };
  setDetailBody(h("div", { className: "stack" }, [
    section("Activity Summary", h("div", { className: "quick-stats" }, [
      statCard("Scope", data.workflowId ? "workflow" : "global", data.workflowId || "all workflows"),
      statCard("Returned", summary.returned || items.length, `${summary.totalBeforeLimit || items.length} total`),
      statCard("Critical", summary.bySeverity?.critical || 0),
      statCard("Warning", summary.bySeverity?.warning || 0),
      statCard("OK", summary.bySeverity?.ok || 0)
    ])),
    section("Groups", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Group", render: (row) => chip(row.group, "neutral") },
        { label: "Count", key: "count" }
      ], groupRows, "No activity groups."),
      renderTable([
        { label: "Severity", render: (row) => chip(row.severity, row.severity) },
        { label: "Count", key: "count" }
      ], severityRows, "No severity counts.")
    ])),
    section("Control Stream", items.length ? h("div", { className: "activity-feed" }, items.map(activityItem)) : emptyState("No activity items.")),
    section("Raw", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function renderSystemStatus(data) {
  const config = data.config || {};
  const health = data.health || {};
  const readiness = data.readiness || {};
  const boundaryRows = config.securityBoundaries || [];
  const qualityRows = config.releaseQualityGates || [];
  const qualityEvidence = config.releaseQualityEvidence || {};
  const queueRows = (config.allowedWorkflowQueues || config.allowedViews || []).map((queue) => ({ queue }));
  const viewRows = (config.allowedConsoleViews || []).map((view) => ({ view }));
  const partialFailures = data.partialFailures || [];
  setDetailBody(h("div", { className: "stack" }, [
    section("Console Runtime", h("div", { className: "quick-stats" }, [
      statCard("Service", health.service || config.service || "workflow-console", health.ok ? "ok" : "not ok"),
      statCard("DB", health.dbReadable ? "readable" : "unreadable", `schema ${health.schemaVersion || "-"}`),
      statCard("Action Mode", config.actionMode || "-", config.readOnlyMode ? "read-only" : "writes allowlisted"),
      statCard("Readiness", readiness?.status || "unknown", formatDate(readiness?.checkedAt)),
      statCard("Redaction", config.redactionPolicyVersion || "-"),
      statCard("Quality Evidence", qualityEvidence.status || "missing", qualityEvidence.releaseId || qualityEvidence.path || qualityEvidence.reason || "-"),
      statCard("Generated", formatDate(data.generatedAt))
    ])),
    section("Operator-Grade Release Gate", renderOperatorGradeReleaseGate(data)),
    section("Release Quality Gates", renderReleaseQualityRecords(qualityRows)),
    section("Safety Boundaries", renderTable([
      { label: "Boundary", render: (row) => h("code", {}, row.key || "-") },
      { label: "Status", render: (row) => chip(row.status || "unknown", row.status === "enforced" ? "ok" : "warning") },
      { label: "Detail", key: "detail" }
    ], boundaryRows, "No safety boundary metadata.")),
    partialFailures.length ? section("Partial Failures", renderTable([
      { label: "Endpoint", key: "path" },
      { label: "Error", key: "message" }
    ], partialFailures, "No partial failures.")) : null,
    section("Readiness Findings", renderReadinessFindings(readiness), { "data-section": "readiness" }),
    section("Routes And Queues", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Console View", key: "view" }
      ], viewRows, "No console views reported."),
      renderTable([
        { label: "Workflow Queue", key: "queue" }
      ], queueRows, "No workflow queues reported.")
    ])),
    section("Root And Health", h("div", { className: "copy-block" }, [
      h("p", {}, `Root: ${config.rootDir || health.rootDir || "-"}`),
      h("p", {}, `Server time: ${formatDate(config.serverTime)}`),
      jsonBlock({ health, config: { ...config, securityBoundaries: undefined } })
    ]))
  ]));
}

function operatorGradeReleaseGateRows(data = {}) {
  const config = data.config || {};
  const health = data.health || {};
  const readiness = data.readiness || {};
  const boundaryKeys = new Set((config.securityBoundaries || []).map((row) => row.key));
  const boundaryStatus = (key) => (config.securityBoundaries || []).find((row) => row.key === key)?.status || "";
  const views = new Set(config.allowedConsoleViews || []);
  const policy = config.operatorPolicy || {};
  const releaseQualityGates = config.releaseQualityGates || [];
  const allBoundaries = ["loopback_default", "host_allowlist", "no_query_token", "cross_origin_mutation_block", "preview_first_actions", "redaction"];
  const hasViews = ["command-center", "activity", "agent-board", "kanban", "evidence-workspace", "operations", "system", "workflows"]
    .every((view) => views.has(view));
  const qualityKeys = new Set(releaseQualityGates.map((row) => row.key));
  const qualityStatusesRecorded = releaseQualityGates.every((row) => ["recorded", "pass"].includes(row.status || ""));
  const reviewGatesRecorded = releaseQualityGates.length > 0
    && qualityKeys.has("spark_code_review")
    && qualityKeys.has("regression_suite")
    && qualityKeys.has("browser_smoke")
    && qualityStatusesRecorded;
  const hiddenWrites = ["hidden_read_only", "hidden_without_allow_writes"].includes(policy.writeActions || "");
  const allowlistedWrites = policy.writeActions === "allowlisted_by_gateway";
  const previewOnlyHidden = config.actionMode === "preview-only" && hiddenWrites;
  const readinessStatus = String(readiness.status || "").toLowerCase();
  const readinessOk = ["ready", "needs_attention"].includes(readinessStatus);
  return [
    {
      gate: "Read-only default",
      status: previewOnlyHidden ? "pass" : allowlistedWrites ? "warn" : "fail",
      evidence: previewOnlyHidden ? "Console exposes preview-only controls and executable writes are hidden." : `Mode ${config.actionMode || "unknown"} / ${policy.writeActions || "unknown"}.`
    },
    {
      gate: "Action policy visible",
      status: policy.previewActions === "allowed" && (hiddenWrites || allowlistedWrites) && policy.auditSurface ? "pass" : "fail",
      evidence: `${policy.previewActions || "preview unknown"} / ${policy.writeActions || "writes unknown"} / ${policy.auditSurface || "audit unknown"}`
    },
    {
      gate: "Safety boundaries enforced",
      status: allBoundaries.every((key) => boundaryKeys.has(key) && ["enforced", "browser_enforced", "policy_enabled"].includes(boundaryStatus(key))) ? "pass" : "fail",
      evidence: allBoundaries.filter((key) => boundaryKeys.has(key)).join(", ") || "No boundary metadata."
    },
    {
      gate: "Operator surfaces integrated",
      status: hasViews ? "pass" : "fail",
      evidence: "Command, Activity, Agent Board, Kanban, Evidence, Operations, System, and Workflow detail are registered views."
    },
    {
      gate: "Redaction policy present",
      status: config.redactionPolicyVersion && boundaryStatus("redaction") === "enforced" ? "pass" : "fail",
      evidence: config.redactionPolicyVersion || "Missing redaction policy version."
    },
    {
      gate: "Runtime status observable",
      status: health.ok && health.dbReadable ? "pass" : "fail",
      evidence: `health=${health.ok ? "ok" : "failed"} db=${health.dbReadable ? "readable" : "unreadable"} schema=${health.schemaVersion || "-"}`
    },
    {
      gate: "Readiness evidence available",
      status: readinessOk ? "pass" : readinessStatus ? "warn" : "fail",
      evidence: `${readiness.status || "missing"} ${readiness.checkedAt ? `at ${formatDate(readiness.checkedAt)}` : ""}`.trim()
    },
    {
      gate: "No partial status failures",
      status: (data.partialFailures || []).length ? "warn" : "pass",
      evidence: (data.partialFailures || []).length ? `${data.partialFailures.length} endpoint check(s) failed.` : "Config, health, and readiness probes completed."
    },
    {
      gate: "Review gates recorded",
      status: reviewGatesRecorded ? "pass" : "fail",
      evidence: reviewGatesRecorded ? `${releaseQualityGates.length} release quality gate record(s), including Spark review, regression, and browser smoke.` : "Spark review, regression, or browser smoke gates are not recorded yet."
    }
  ];
}

function renderOperatorGradeReleaseGate(data = {}) {
  return renderTable([
    { label: "Gate", key: "gate" },
    { label: "Status", render: (row) => chip(row.status, row.status === "pass" ? "ok" : row.status === "warn" ? "warning" : "critical") },
    { label: "Evidence", key: "evidence" }
  ], operatorGradeReleaseGateRows(data), "No operator-grade release gates.");
}

function renderReleaseQualityRecords(rows = []) {
  return renderTable([
    { label: "Gate", render: (row) => h("code", {}, row.key || "-") },
    { label: "Status", render: (row) => chip(row.status || "unknown", ["recorded", "pass"].includes(row.status) ? "ok" : row.status === "required" ? "warning" : "critical") },
    { label: "Evidence", key: "detail" },
    { label: "Refs", render: (row) => (row.evidenceRefs || []).length ? h("div", { className: "chip-list" }, row.evidenceRefs.map((item) => chip(item, "neutral"))) : "-" }
  ], rows, "No release quality gates.");
}

function renderAgentBoard(data) {
  const agents = data.agents || [];
  const visibleAgents = applyWorkbench(agents).filter(matchesAgentBoardFilters);
  const summary = data.summary || {};
  const agentTable = renderTable([
    { label: "Attention", render: (row) => chip(row.attentionLevel || "ok") },
    { label: "Agent", render: (row) => h("div", {}, [
      h("strong", {}, row.agentId),
      h("p", { className: "muted" }, row.displayName || row.role || row.agentKey)
    ]) },
    { label: "Runtime", render: (row) => h("div", {}, [
      h("p", {}, `${present(row.platform)} / ${present(row.runtime)}`),
      h("p", { className: "muted" }, `${present(row.workflowIngressAdapter)} -> ${present(row.executionIdentity)}`)
    ]) },
    { label: "Endpoint", render: (row) => h("code", {}, present(row.endpointRef)) },
    { label: "Dispatch", render: (row) => row.canReceiveDispatch ? chip("enabled", "ok") : chip("disabled", "warning") },
    { label: "Profile", render: (row) => row.profileMode ? h("div", {}, [
      chip(row.profileMode.observedMode || "observed"),
      h("p", { className: "muted" }, row.profileMode.reason || "")
    ]) : "-" },
    { label: "Current", render: (row) => row.currentState ? h("div", {}, [
      h("p", {}, `${present(row.currentState.currentStage || row.currentState.status)} ${present(row.currentState.stageStatus)}`),
      h("p", { className: "muted" }, short(row.currentState.blockedReason || row.currentState.staleKind || row.currentState.activeDispatchId, 110)),
      h("p", { className: "muted" }, formatDate(row.currentState.lastEventAt || row.currentState.updatedAt))
    ]) : "-" },
    { label: "Work", render: (row) => h("div", {}, [
      h("p", {}, `queued ${row.counts?.queued || 0} / working ${row.counts?.working || 0}`),
      h("p", { className: "muted" }, `failed ${row.counts?.failed || 0} / current ${row.counts?.currentStates || 0} / flows ${row.counts?.messageFlows || 0}`)
    ]) },
    { label: "Latest", render: (row) => h("div", {}, [
      h("p", {}, `${present(row.latest?.kind)} ${present(row.latest?.status)}`),
      h("p", { className: "muted" }, short(row.latest?.detail || row.latest?.dispatchId || row.latest?.flowId, 110)),
      h("p", { className: "muted" }, formatDate(row.latest?.lastEventAt))
    ]) },
    { label: "Flags", render: (row) => h("div", { className: "chip-list" }, (row.attentionFlags || []).map((flag) => chip(flag.key, flag.severity))) },
    { label: "Inspect", render: (row) => h("button", { type: "button", onClick: () => inspectAgent(row) }, "Inspect") }
  ], visibleAgents, "No runtime agents match the current filters.");
  setDetailBody(h("div", { className: "stack" }, [
    agentBoardFilterControls(data),
    renderWorkbenchControls({ total: agents.length, shown: visibleAgents.length }),
    section("Agent Board Summary", h("div", { className: "quick-stats" }, [
      statCard("Agents", summary.agents || agents.length),
      statCard("Shown", visibleAgents.length, state.workbenchFilter === "all" && state.severityFilter === "all" ? "unfiltered" : "filtered"),
      statCard("Ready", summary.ready || 0),
      statCard("Working", summary.working || 0),
      statCard("Blocked", summary.blocked || 0),
      statCard("Attention", summary.attention || 0),
      statCard("Source", data.source || "-")
    ])),
    section("Agents", h("div", { className: "agent-board-surface" }, [
      h("div", { className: "agent-table-view" }, agentTable),
      h("div", { className: "agent-card-list" }, visibleAgents.length ? visibleAgents.map(renderAgentCard) : [emptyState("No runtime agents match the current filters.")])
    ])),
    section("Raw", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function renderAgentCard(agent = {}) {
  const current = agent.currentState || {};
  const latest = agent.latest || {};
  return h("article", { className: `agent-card ${agent.attentionLevel || "ok"}` }, [
    h("div", { className: "workflow-title" }, [
      h("strong", {}, agent.agentId || agent.agentKey),
      chip(agent.attentionLevel || "ok", toneFor(agent.attentionLevel || "ok"))
    ]),
    h("p", { className: "workflow-summary" }, agent.displayName || agent.role || agent.agentKey || ""),
    h("div", { className: "kv-compact" }, [
      h("span", {}, "Runtime"),
      h("strong", {}, `${present(agent.platform)} / ${present(agent.runtime)}`),
      h("span", {}, "Dispatch"),
      h("strong", {}, agent.canReceiveDispatch ? "enabled" : "disabled"),
      h("span", {}, "Current"),
      h("strong", {}, current.currentStage || current.status || "-"),
      h("span", {}, "Latest"),
      h("strong", {}, `${present(latest.kind)} ${present(latest.status)}`)
    ]),
    (agent.attentionFlags || []).length ? h("div", { className: "chip-list" }, agent.attentionFlags.map((flag) => chip(flag.key, flag.severity))) : null,
    h("div", { className: "actions card-actions" }, [
      h("button", { type: "button", onClick: () => inspectAgent(agent) }, "Inspect"),
      current.activeWorkflowId ? h("button", { type: "button", onClick: () => selectWorkflow(current.activeWorkflowId) }, "Open Workflow") : null,
      h("button", { type: "button", onClick: () => copyText(agent.agentId || agent.agentKey, "Agent") }, "Copy Agent")
    ])
  ]);
}

async function setKanbanScope(scope) {
  state.kanbanScope = normalizeChoice(scope, KANBAN_SCOPES.map((item) => item.value), "global");
  if (state.kanbanScope === "workflow" && !state.selectedWorkflowId && state.workflows[0]) {
    state.selectedWorkflowId = state.workflows[0].workflowId;
  }
  if (state.kanbanScope === "workflow" && !state.selectedWorkflowId) state.kanbanScope = "global";
  if (state.kanbanScope === "global") {
    state.selectedWorkflowId = "";
    state.focusCardId = "";
  }
  writeUrlState();
  renderWorkflowList();
  renderDetailHeader();
  await loadGlobalView();
}

function renderKanbanScopeControls(data = {}) {
  const workflowId = state.selectedWorkflowId || "";
  const scope = data.query?.scope || state.kanbanScope || "global";
  const workflowAvailable = Boolean(workflowId || state.workflows[0]);
  return h("div", { className: "kanban-scope-panel" }, [
    h("div", { className: "workflow-title" }, [
      h("strong", {}, "Board Scope"),
      chip(scope === "workflow" ? "workflow" : "global", scope === "workflow" ? "warning" : "neutral")
    ]),
    h("p", { className: "muted" }, scope === "workflow"
      ? `Showing workflow-scoped board${workflowId ? ` for ${workflowId}` : ""}.`
      : `Showing the global agent/workflow board across all workflows${state.focusAgentId ? `, filtered to agent ${state.focusAgentId}` : ""}.`),
    h("div", { className: "actions kanban-scope-actions" }, [
      h("button", {
        type: "button",
        className: state.kanbanScope === "global" ? "active" : "",
        onClick: () => setKanbanScope("global")
      }, "Global Board"),
      h("button", {
        type: "button",
        className: state.kanbanScope === "workflow" ? "active" : "",
        disabled: !workflowAvailable,
        title: workflowAvailable ? "Use selected workflow scope" : "No workflow is available for workflow-scoped board.",
        onClick: workflowAvailable ? () => setKanbanScope("workflow") : undefined
      }, "Workflow Board"),
      workflowId ? h("button", { type: "button", onClick: () => copyText(workflowId, "Kanban workflow") }, "Copy Workflow") : null
    ]),
    h("p", { className: "muted" }, "Read-only scope switch. It changes the board query and URL only; it does not move cards, mutate workflow state, dispatch agents, or retry work.")
  ]);
}

function renderKanban(data) {
  const columns = data.columns || [];
  const filteredColumns = columns.map((column) => {
    const cards = applyWorkbench(column.cards || []);
    return { ...column, count: cards.length, cards };
  });
  const totalCards = columns.reduce((sum, column) => sum + ((column.cards || []).length), 0);
  const shownCards = filteredColumns.reduce((sum, column) => sum + ((column.cards || []).length), 0);
  const visibleCards = filteredColumns.flatMap((column) => column.cards || []);
  setDetailBody(h("div", { className: "stack" }, [
    renderKanbanScopeControls(data),
    renderWorkbenchControls({ total: totalCards, shown: shownCards }),
    section("Preview Action Priority", renderPreviewActionPriorityPanel(visibleCards), { "data-section": "preview-action-priority" }),
    section("Kanban Summary", h("div", { className: "quick-stats" }, [
      statCard("Cards", data.summary?.cards || 0),
      statCard("Shown", shownCards, state.workbenchFilter === "all" && state.severityFilter === "all" ? "unfiltered" : "filtered"),
      statCard("Workflows", data.summary?.workflows || 0),
      statCard("Agents", data.summary?.agents || 0),
      statCard("Source", data.source || "-")
    ])),
    h("div", { className: "kanban-board" }, filteredColumns.map((column) => h("section", { className: "kanban-column" }, [
      h("div", { className: "kanban-head" }, [
        h("strong", {}, column.label),
        chip(column.count || 0, column.count ? "warning" : "neutral")
      ]),
      h("div", { className: "kanban-cards" }, (column.cards || []).length
        ? column.cards.map(renderKanbanCard)
        : [h("div", { className: "kanban-empty" }, "Empty")])
    ]))),
    section("Raw", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function previewActionPriorityModel(cards = []) {
  const observed = new Map();
  for (const card of cards || []) {
    for (const action of card.previewActions || []) {
      const spec = kanbanPreviewActionSpec(card, action);
      const advertisedAction = String(action || "").trim();
      const key = spec.action || advertisedAction;
      const item = observed.get(key) || {
        action: key,
        observed: 0,
        ready: 0,
        blocked: 0,
        sources: new Set(),
        observedActions: new Set(),
        examples: []
      };
      item.observed += 1;
      if (spec.enabled) item.ready += 1;
      else item.blocked += 1;
      if (card.source) item.sources.add(card.source);
      if (advertisedAction) item.observedActions.add(advertisedAction);
      if (item.examples.length < 3) item.examples.push(card.sourceId || card.title || key);
      observed.set(key, item);
    }
  }
  const catalogRows = PREVIEW_ACTION_PRIORITY.map((entry) => {
    const item = observed.get(entry.action) || {
      observed: 0,
      ready: 0,
      blocked: 0,
      sources: new Set(),
      observedActions: new Set(),
      examples: []
    };
    return {
      ...entry,
      observed: item.observed || 0,
      ready: item.ready || 0,
      blocked: item.blocked || 0,
      sources: Array.from(item.sources || []),
      observedActions: Array.from(item.observedActions || []),
      examples: item.examples || [],
      status: item.ready ? "ready" : item.observed ? "blocked" : "not_observed"
    };
  });
  const catalogActions = new Set(PREVIEW_ACTION_PRIORITY.map((entry) => entry.action));
  const uncatalogedRows = Array.from(observed.values())
    .filter((item) => !catalogActions.has(item.action))
    .map((item) => ({
      action: item.action,
      priority: "Other",
      label: "Uncataloged Preview Action",
      firstWhen: "A card advertises this action, but it is not in the v1.0 priority catalog.",
      boundary: "Blocked for operator priority planning until reviewed and added to the governed catalog.",
      observed: item.observed || 0,
      ready: item.ready || 0,
      blocked: item.blocked || 0,
      sources: Array.from(item.sources || []),
      observedActions: Array.from(item.observedActions || []),
      examples: item.examples || [],
      status: "uncataloged"
    }));
  return [...catalogRows, ...uncatalogedRows];
}

function renderPreviewActionPriorityPanel(cards = []) {
  const rows = previewActionPriorityModel(cards);
  const observedCount = rows.filter((row) => row.observed > 0).length;
  const readyCount = rows.filter((row) => row.ready > 0).length;
  return h("div", { className: "preview-action-priority-panel" }, [
    h("div", { className: "quick-stats compact-stats" }, [
      statCard("Priority Actions", rows.length),
      statCard("Observed", observedCount, `${readyCount} ready`),
      statCard("Cards", cards.length),
      statCard("Mode", "preview-only", "no mutation")
    ]),
    renderTable([
      { label: "Priority", render: (row) => chip(row.priority, row.priority === "P0" || row.priority === "P1" ? "ok" : "neutral") },
      { label: "Action", render: (row) => h("div", {}, [
        h("strong", {}, row.label),
        h("code", {}, row.action),
        (row.observedActions || []).some((action) => action !== row.action)
          ? h("p", { className: "muted" }, `Observed variants: ${row.observedActions.join(", ")}`)
          : null
      ]) },
      { label: "Current Coverage", render: (row) => h("div", {}, [
        chip(row.status, row.status === "ready" ? "ok" : ["blocked", "uncataloged"].includes(row.status) ? "warning" : "neutral"),
        h("p", { className: "muted" }, `${row.observed || 0} observed / ${row.ready || 0} ready / ${row.blocked || 0} blocked`)
      ]) },
      { label: "First When", render: (row) => h("p", { className: "muted" }, row.firstWhen) },
      { label: "Sources", render: (row) => copyableEvidenceList(row.sources.length ? row.sources : row.examples, "Preview source") },
      { label: "Boundary", render: (row) => h("p", { className: "muted" }, row.boundary) }
    ], rows, "No preview action priority catalog."),
    h("p", { className: "muted" }, "Read-only priority matrix. It answers which v0.7 preview actions should surface first when real Kanban cards are sparse; uncataloged observed actions stay visible as warnings. It does not create actions, dispatch agents, send Telegram, or mutate workflow state.")
  ]);
}

function renderKanbanCard(card) {
  return h("article", { className: `kanban-card ${toneFor(card.status || card.column)}` }, [
    h("div", { className: "workflow-title" }, [
      h("strong", {}, short(card.title || card.sourceId, 70)),
      chip(card.status || card.source)
    ]),
    card.summary ? h("p", { className: "workflow-summary" }, short(card.summary, 120)) : null,
    h("div", { className: "workflow-meta" }, [
      card.workflowId ? h("button", { onClick: () => selectWorkflow(card.workflowId) }, card.workflowId) : h("span", {}, "no workflow"),
      h("span", {}, card.agentId || "-"),
      h("span", {}, card.runtime || "-")
    ]),
    h("div", { className: "mini-counts" }, [
      h("span", {}, card.source),
      h("span", {}, formatDate(card.lastEventAt)),
      card.dispatchId ? h("span", {}, `dispatch ${card.dispatchId}`) : null,
      card.flowId ? h("span", {}, `flow ${card.flowId}`) : null
    ]),
    (card.missingEvidence || []).length ? h("div", { className: "chip-list" }, card.missingEvidence.map((item) => chip(item, "warning"))) : null,
    h("div", { className: "card-actions" }, [
      h("button", { type: "button", onClick: () => inspectKanbanCard(card) }, "Inspect"),
      card.sourceId ? h("button", { type: "button", onClick: () => copyText(card.sourceId, "Card") }, "Copy") : null
    ]),
    renderKanbanPreviewActions(card)
  ]);
}

function renderKanbanPreviewActions(card = {}) {
  const actions = (card.previewActions || [])
    .map((action) => kanbanPreviewActionSpec(card, action))
    .filter(Boolean);
  if (!actions.length) return null;
  return h("div", { className: "card-actions" }, actions.map((spec) => h("button", {
    type: "button",
    disabled: !spec.enabled,
    title: spec.reason || spec.label,
    onClick: spec.enabled ? spec.onClick : undefined
  }, spec.label)));
}

function kanbanPreviewActionSpec(card = {}, action = "") {
  const model = kanbanPreviewActionModel(card, action);
  if (model.action === "workflow.supervise.preview") return { ...model, onClick: () => previewSupervise(model.workflowId) };
  if (["workflow.advance.preview", "workflow.pause.preview", "workflow.resume.preview", "workflow.stop.preview"].includes(model.action)) {
    return { ...model, onClick: () => previewIntervention(model.action, {}, model.workflowId) };
  }
  if (model.action === "workflow.rerun.agent.preview") {
    return {
      ...model,
      onClick: () => previewIntervention("workflow.rerun.agent.preview", {
        dispatchId: model.payload.dispatchId || "",
        runtimeRunId: model.payload.runtimeRunId || "",
        agentId: model.payload.agentId || ""
      }, model.workflowId)
    };
  }
  if (model.action === "workflow.rerun.phase.preview") {
    return {
      ...model,
      onClick: () => previewIntervention("workflow.rerun.phase.preview", { phaseKey: model.payload.phaseKey || "" }, model.workflowId)
    };
  }
  if (model.action === "telegram.outbox.delivery.preview") return { ...model, onClick: () => previewTelegramOutboxDelivery(model.outboxId) };
  if (model.action === "telegram.outbox.requeue.preview") return { ...model, onClick: () => previewTelegramOutboxRequeue(model.outboxId) };
  if (model.action === "telegram.outbox.requeue.execution_package.preview") return { ...model, onClick: () => previewTelegramOutboxRequeuePackage(model.outboxId) };
  if (model.action === "workflow.control_loop.job.requeue.preview") return { ...model, onClick: () => previewControlLoopJobRequeue(model.workflowId, model.jobId) };
  if (model.action === "workflow.incident.from_dead_letter.preview") {
    return { ...model, onClick: () => previewDeadLetterIncident({ workflowId: model.workflowId, kind: model.deadLetterKind, refId: model.refId }) };
  }
  if (model.action && model.action.startsWith("workflow.incident.closeout.")) {
    return { ...model, onClick: () => previewIncidentCloseout(model.action, model.incidentId || "", {}, model.workflowId) };
  }
  return model;
}

function renderSearchResults(data) {
  const results = data.results || [];
  const visibleResults = applyWorkbench(results);
  const byKind = Object.entries(visibleResults.reduce((acc, result) => {
    const kind = result.kind || "unknown";
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {})).map(([kind, count]) => ({ kind, count }));
  setDetailBody(h("div", { className: "stack" }, [
    renderWorkbenchControls({ total: results.length, shown: visibleResults.length }),
    section("Search Summary", h("div", { className: "quick-stats" }, [
      statCard("Query", data.query?.q || "-", data.summary?.status || ""),
      statCard("Results", data.summary?.total || 0, `${data.summary?.scanned || 0} scanned`),
      statCard("Shown", visibleResults.length, state.workbenchFilter === "all" && state.severityFilter === "all" ? "unfiltered" : "filtered"),
      statCard("Kinds", byKind.length || 0),
      statCard("Generated", formatDate(data.generatedAt))
    ])),
    section("Result Types", renderTable([
      { label: "Kind", render: (row) => chip(row.kind, "neutral") },
      { label: "Count", key: "count" }
    ], byKind, "No result types.")),
    section("Results", visibleResults.length ? h("div", { className: "search-results" }, visibleResults.map(renderSearchResult)) : emptyState(data.query?.q ? "No matching workflow records for the current filters." : "Enter a search query.")),
    data.summary?.missingSources?.length ? section("Missing Sources", h("div", { className: "chip-list padded" }, data.summary.missingSources.map((source) => chip(source, "warning")))) : null,
    section("Raw", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function renderSearchResult(result) {
  const refs = result.sourceRefs || [];
  const matches = result.matchFields || [];
  return h("article", { className: `search-result ${result.severity || toneFor(result.status)}` }, [
    h("div", { className: "search-result-head" }, [
      h("div", {}, [
        h("div", { className: "workflow-title" }, [
          h("strong", {}, short(result.title || result.id, 120)),
          chip(result.kind, "neutral")
        ]),
        h("p", { className: "workflow-summary" }, short(result.summary || result.id, 240))
      ]),
      h("div", { className: "actions search-actions" }, [
        h("button", { type: "button", onClick: () => openSearchResult(result) }, "Open"),
        h("button", { type: "button", onClick: () => copyText(result.id, "Id") }, "Copy Id"),
        result.workflowId ? h("button", { type: "button", onClick: () => copyText(result.workflowId, "Workflow") }, "Copy Workflow") : null
      ])
    ]),
    h("div", { className: "workflow-meta" }, [
      chip(result.status || "unknown", toneFor(result.status || result.severity)),
      h("span", {}, result.workflowId ? `workflow ${result.workflowId}` : "no workflow"),
      h("span", {}, result.runtime || "-"),
      h("span", {}, result.agentId || "-"),
      h("span", {}, formatDate(result.lastEventAt))
    ]),
    matches.length ? h("div", { className: "chip-list" }, matches.map((field) => chip(field, "neutral"))) : null,
    refs.length ? h("div", { className: "source-ref-chips" }, refs.slice(0, 6).map((ref) => renderSourceRefChip(ref, {
      workflowId: result.workflowId || result.target?.workflowId || "",
      agentId: result.agentId || result.target?.agentId || ""
    }))) : null
  ]);
}

async function openSearchResult(result = {}) {
  const target = result.target || {};
  if (target.consoleView) return openCommandTarget(target);
  if (target.workflowId) return openWorkflowTab(target.workflowId, target.tab || "overview");
}

async function openCommandTarget(target = {}) {
  if (target.consoleView === "workflows" && !target.workflowId) {
    state.consoleView = "workflows";
    state.scopedActivity = false;
    state.selectedWorkflowId = "";
    state.detail = null;
    state.tab = "overview";
    clearFocusState();
    setViewButtons();
    writeUrlState();
    await loadWorkflows();
    return;
  }
  if (target.consoleView === "workflows" && target.workflowId) {
    await openWorkflowTab(target.workflowId, target.tab || "overview");
    return;
  }
  if (target.consoleView === "agent-board") {
    state.consoleView = "agent-board";
    state.scopedActivity = false;
    state.selectedWorkflowId = "";
    state.detail = null;
    clearAgentBoardFilters();
    state.focusAgentId = target.agentId || "";
    state.focusCardId = "";
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    scrollToConsoleSection(target.section);
    return;
  }
  if (target.consoleView === "kanban") {
    state.consoleView = "kanban";
    state.scopedActivity = false;
    state.selectedWorkflowId = target.workflowId || "";
    state.kanbanScope = target.workflowId ? "workflow" : "global";
    state.detail = null;
    state.focusAgentId = target.agentId || "";
    state.focusCardId = target.cardId || "";
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    scrollToConsoleSection(target.section);
    return;
  }
  if (target.consoleView === "evidence-workspace") {
    state.consoleView = "evidence-workspace";
    state.scopedActivity = false;
    state.selectedWorkflowId = target.workflowId || "";
    state.detail = null;
    clearFocusState();
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    scrollToConsoleSection(target.section);
    return;
  }
  if (target.consoleView === "operations") {
    state.consoleView = "operations";
    state.scopedActivity = false;
    state.selectedWorkflowId = target.workflowId || "";
    state.detail = null;
    clearFocusState();
    state.operationsFilters = {
      kind: target.operationsFilters?.kind || "",
      severity: target.operationsFilters?.severity || "",
      status: target.operationsFilters?.status || ""
    };
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    scrollToConsoleSection(target.section);
    return;
  }
  if (target.consoleView === "activity") {
    state.consoleView = "activity";
    state.selectedWorkflowId = target.workflowId || "";
    state.scopedActivity = Boolean(target.workflowId);
    state.detail = null;
    clearFocusState();
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    return;
  }
  if (target.consoleView) {
    state.consoleView = target.consoleView;
    state.selectedWorkflowId = "";
    state.scopedActivity = false;
    state.detail = null;
    if (!["agent-board", "kanban"].includes(state.consoleView)) clearFocusState();
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    scrollToConsoleSection(target.section);
  }
}

function renderTriageBlocker(blocker = {}) {
  const refs = blocker.sourceRefs || [];
  const relatedTargets = blocker.relatedTargets || [];
  const relatedButton = (target = {}) => {
    const label = target.label || (target.consoleView === "agent-board" ? "Agent"
      : target.consoleView === "kanban" ? "Board"
        : target.consoleView === "evidence-workspace" ? "Evidence"
          : "Open");
    return h("button", { type: "button", onClick: () => openCommandTarget(target) }, label);
  };
  return h("article", { className: `search-result ${blocker.severity || "warning"}` }, [
    h("div", { className: "search-result-head" }, [
      h("div", {}, [
        h("div", { className: "workflow-title" }, [
          h("strong", {}, short(blocker.title || blocker.id, 120)),
          chip(blocker.plane || "control", "neutral"),
          chip(blocker.severity || "warning", blocker.severity || "warning")
        ]),
        h("p", { className: "workflow-summary" }, short(blocker.detail || blocker.id, 240))
      ]),
      h("div", { className: "actions search-actions" }, [
        h("button", { type: "button", onClick: () => openCommandTarget(blocker.target || {}) }, "Open"),
        ...relatedTargets.slice(0, 3).map(relatedButton),
        blocker.workflowId ? h("button", { type: "button", onClick: () => copyText(blocker.workflowId, "Workflow") }, "Copy Workflow") : null,
        blocker.id ? h("button", { type: "button", onClick: () => copyText(blocker.id, "Blocker") }, "Copy Id") : null
      ])
    ]),
    h("div", { className: "workflow-meta" }, [
      h("span", {}, blocker.workflowId ? `workflow ${blocker.workflowId}` : "global"),
      h("span", {}, blocker.agentId || "-"),
      h("span", {}, `count ${present(blocker.count, 1)}`),
      h("span", {}, formatDate(blocker.updatedAt))
    ]),
    refs.length ? h("div", { className: "source-ref-chips" }, refs.slice(0, 6).map((ref) => renderSourceRefChip(ref, {
      workflowId: blocker.workflowId || blocker.target?.workflowId || "",
      agentId: blocker.agentId || blocker.target?.agentId || ""
    }))) : null
  ]);
}

function renderOverview(data) {
  const counts = countsFor(data);
  const body = h("div", { className: "content-grid" }, [
    section("Workflow", h("div", { className: "kv-grid" }, [
      statCard("Type", data.workflowType),
      statCard("Owner", data.ownerAgent),
      statCard("Phase", data.currentPhase || "-"),
      statCard("Decision", data.currentDecision || "-"),
      statCard("Created", formatDate(data.createdAt)),
      statCard("Updated", formatDate(data.updatedAt))
    ])),
    section("Objective", h("div", { className: "copy-block" }, [
      h("p", {}, present(data.objective || data.summary, "No objective recorded.")),
      data.acceptanceCriteria ? h("p", {}, `Acceptance: ${data.acceptanceCriteria}`) : null,
      data.stopCondition ? h("p", {}, `Stop: ${data.stopCondition}`) : null
    ])),
    section("Counts", h("div", { className: "kv-grid" }, [
      statCard("Pending", counts.pending || 0),
      statCard("In Progress", counts.inProgress || 0),
      statCard("Done", counts.done || 0),
      statCard("Blocked", counts.blocked || 0),
      statCard("Queued Dispatch", counts.queuedDispatches || 0),
      statCard("Failed Dispatch", counts.failedDispatches || 0),
      statCard("Queued Outbox", counts.queuedOutbox || 0),
      statCard("Open Incidents", counts.openIncidents || 0)
    ])),
    section("Latest Checkpoint", data.latestCheckpoint ? h("div", { className: "copy-block" }, [
      h("p", {}, data.latestCheckpoint.checkpointId),
      h("p", {}, formatDate(data.latestCheckpoint.createdAt)),
      h("code", {}, data.latestCheckpoint.path || "-")
    ]) : emptyState("No checkpoint recorded.")),
    section("Payload", jsonBlock(data.payload || {}))
  ]);
  setDetailBody(body);
}

function phaseProgressValue(counts = {}) {
  const total = counts.total || 0;
  if (!total) return 0;
  return Math.round(((counts.done || 0) / total) * 100);
}

function renderPhaseStatus(counts = {}, status = "") {
  if (!(counts.total || 0) && status) return chip(status, toneFor(status));
  if ((counts.failed || 0) || (counts.blocked || 0)) return chip("blocked", "critical");
  if ((counts.inProgress || 0)) return chip("in progress", "warning");
  if ((counts.pending || 0) || (counts.humanGate || 0)) return chip("pending", "warning");
  if ((counts.cancelled || 0)) return chip("cancelled", "critical");
  if ((counts.done || 0) && counts.done === counts.total) return chip("done", "ok");
  return chip("empty", "neutral");
}

function renderPhases(data) {
  const phases = data.phases || [];
  if (!phases.length) return setDetailBody(emptyState("No phases inferred from workflow tasks."));
  const body = h("div", { className: "stack" }, [
    section("Phase Summary", h("div", { className: "quick-stats" }, [
      statCard("Phases", data.phaseCount || phases.length, data.source || (data.inferred ? "inferred from tasks" : "")),
      statCard("Tasks", data.totals?.total || 0, `${data.totals?.done || 0} done`),
      statCard("Blocked", data.totals?.blocked || 0),
      statCard("Cancelled", data.totals?.cancelled || 0),
      statCard("Human Gate", data.totals?.humanGate || 0),
      statCard("Dispatches", data.totals?.dispatches || 0),
      statCard("Runtime Runs", data.totals?.runtimeRuns || 0),
      statCard("Agent Runs", data.totals?.agentRuns || 0, `${data.totals?.agentWithReceipt || 0} receipts`)
    ])),
    h("div", { className: "phase-list" }, phases.map((phase, index) => renderPhaseCard(phase, index)))
  ]);
  setDetailBody(body);
}

function renderPhaseCard(phase, index) {
  const counts = phase.counts || {};
  const progress = phaseProgressValue(counts);
  const taskRows = (phase.tasks || []).slice(0, 8);
  const dispatchRows = (phase.dispatches || []).slice(0, 5);
  const runtimeRows = (phase.runtimeRuns || []).slice(0, 5);
  const agentRunRows = (phase.agentRuns || []).slice(0, 6);
  return h("article", { className: `phase-card ${toneFor(phase.status)}` }, [
    h("div", { className: "phase-head" }, [
      h("div", {}, [
        h("div", { className: "phase-title" }, [
          h("span", { className: "phase-index" }, String(index + 1).padStart(2, "0")),
          h("strong", {}, phase.phaseKey || "unphased")
        ]),
        h("p", { className: "muted" }, [
          `${(phase.ownerAgents || []).join(", ") || "no owner"} | `,
          `${(phase.runtimeAgents || []).join(", ") || "no runtime target"}`
        ])
      ]),
      renderPhaseStatus(counts, phase.status || phase.declaredStatus)
    ]),
    h("div", { className: "phase-progress" }, [
      h("div", { className: "phase-progress-bar", style: `width: ${Math.max(0, Math.min(100, progress))}%` }),
      h("span", {}, `${progress}%`)
    ]),
    h("div", { className: "phase-counts" }, [
      statCard("Tasks", counts.total || 0, `${counts.pending || 0} pending`),
      statCard("Running", counts.inProgress || 0),
      statCard("Done", counts.done || 0),
      statCard("Blocked", (counts.blocked || 0) + (counts.failed || 0)),
      statCard("Cancelled", counts.cancelled || 0),
      statCard("Dispatch", counts.dispatches || 0, `${counts.dispatchFailed || 0} failed`),
      statCard("Receipts", counts.receiptRequired || 0, `${counts.artifactPresent || 0} artifacts`),
      statCard("Agent Runs", counts.agentRuns || 0, `${counts.agentWithReceipt || 0} receipts`)
    ]),
    phase.blockers?.length ? h("div", { className: "phase-blockers" }, [
      h("strong", {}, "Blockers"),
      h("ul", {}, phase.blockers.map((blocker) => h("li", {}, `${blocker.taskId}: ${short(blocker.reason || blocker.status, 160)}`)))
    ]) : null,
    h("details", { open: index === 0 ? true : undefined }, [
      h("summary", {}, "Tasks"),
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Task", render: (row) => h("div", {}, [h("strong", {}, row.taskId), h("p", { className: "muted" }, short(row.summary, 120))]) },
        { label: "Owner", render: (row) => `${present(row.ownerAgent)} / ${present(row.runtime)}:${present(row.agentId)}` },
        { label: "Gate", render: (row) => row.humanGateRequired ? chip("human", "warning") : chip("auto", "neutral") },
        { label: "Artifact", render: (row) => h("code", {}, present(row.actualArtifactRef || row.expectedArtifact)) },
        { label: "Updated", render: (row) => formatDate(row.updatedAt) }
      ], taskRows, "No tasks in this phase.")
    ]),
    dispatchRows.length || runtimeRows.length ? h("details", {}, [
      h("summary", {}, "Dispatch / Runtime"),
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Dispatch", render: (row) => h("div", {}, [h("strong", {}, row.dispatchId), h("p", { className: "muted" }, short(row.promptPreview, 100))]) },
        { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agentId)}` },
        { label: "Attempt", render: (row) => row.maxAttempts ? `${row.attempt || 0}/${row.maxAttempts}` : present(row.attempt) },
        { label: "Updated", render: (row) => formatDate(row.updatedAt) },
        { label: "Error", render: (row) => short(row.lastError, 120) }
      ], dispatchRows, "No dispatches in this phase."),
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Runtime Run", key: "runtimeRunId" },
        { label: "Dispatch", key: "dispatchId" },
        { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agentId)}` },
        { label: "Latency", render: (row) => row.latencyMs ? `${row.latencyMs} ms` : "-" },
        { label: "Completed", render: (row) => formatDate(row.completedAt) },
        { label: "Error", render: (row) => short(row.error, 120) }
      ], runtimeRows, "No runtime runs in this phase.")
    ]) : null,
    agentRunRows.length ? h("details", {}, [
      h("summary", {}, "Agent Runs / Receipts"),
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Agent Run", render: (row) => h("div", {}, [
          h("strong", {}, row.agentRunId),
          h("p", { className: "muted" }, row.sessionRunId || row.runtimeRunId || row.dispatchId || "")
        ]) },
        { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agentId)}` },
        { label: "Evidence Chain", render: (row) => h("div", {}, [
          h("p", {}, `task ${present(row.taskId)}`),
          h("p", { className: "muted" }, `dispatch ${present(row.dispatchId)}`),
          h("p", { className: "muted" }, `runtime ${present(row.runtimeRunId)}`)
        ]) },
        { label: "Receipt", render: (row) => h("code", {}, present(row.receiptRef || row.outputHash || row.inputHash)) },
        { label: "Updated", render: (row) => formatDate(row.updatedAt) },
        { label: "Error", render: (row) => short(row.error, 120) }
      ], agentRunRows, "No agent runs indexed for this phase.")
    ]) : null,
    h("div", { className: "workflow-meta" }, [
      h("span", {}, phase.source || "workflow_tasks.phase"),
      phase.verifierAgent ? h("span", {}, `verifier ${phase.verifierAgent}`) : null,
      h("span", {}, `started ${formatDate(phase.startedAt)}`),
      h("span", {}, `updated ${formatDate(phase.updatedAt)}`),
      h("span", {}, phase.completedAt ? `completed ${formatDate(phase.completedAt)}` : "not complete")
    ])
  ]);
}

function renderTasks(data) {
  const tasks = data.tasks || [];
  const byStatus = tasks.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const body = h("div", { className: "stack" }, [
    h("div", { className: "quick-stats" }, Object.entries(byStatus).map(([status, count]) => statCard(status, count))),
    renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Task", render: (row) => h("div", {}, [h("strong", {}, row.taskId), h("p", { className: "muted" }, short(row.summary, 120))]) },
      { label: "Owner", render: (row) => h("div", {}, [present(row.ownerAgent), h("p", { className: "muted" }, `${present(row.runtime)}:${present(row.agentId)}`)]) },
      { label: "Phase", key: "phase" },
      { label: "Gate", render: (row) => row.humanGateRequired ? chip("human", "warning") : chip("auto", "neutral") },
      { label: "Artifact", render: (row) => h("code", {}, present(row.actualArtifactRef || row.expectedArtifact)) },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) }
    ], tasks, "No tasks recorded.")
  ]);
  setDetailBody(body);
}

function renderDispatches(data) {
  setDetailBody(renderTable([
    { label: "Status", render: (row) => chip(row.status) },
    { label: "Dispatch", render: (row) => h("div", {}, [h("strong", {}, row.dispatch_id), h("p", { className: "muted" }, short(row.prompt, 100))]) },
    { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agent_id)}` },
    { label: "Type", key: "dispatch_type" },
    { label: "Attempt", render: (row) => `${present(row.attempt, "0")}/${present(row.max_attempts, "1")}` },
    { label: "Runtime Run", render: (row) => h("div", {}, [present(row.latest_runtime_run_id), h("p", { className: "muted" }, present(row.latest_runtime_status))]) },
    { label: "Updated", render: (row) => formatDate(row.updated_at) },
    { label: "Error", render: (row) => short(row.last_error || row.latest_runtime_error, 120) }
  ], data.dispatches || [], "No dispatches recorded."));
}

function renderRuntimeRuns(data) {
  setDetailBody(renderTable([
    { label: "Status", render: (row) => chip(row.status) },
    { label: "Run", render: (row) => h("div", {}, [h("strong", {}, row.runtime_run_id), h("p", { className: "muted" }, row.dispatch_id)]) },
    { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agent_id)}` },
    { label: "Adapter", key: "adapter" },
    { label: "Attempt", key: "attempt" },
    { label: "Latency", render: (row) => row.latency_ms ? `${row.latency_ms} ms` : "-" },
    { label: "Started", render: (row) => formatDate(row.started_at) },
    { label: "Completed", render: (row) => formatDate(row.completed_at) },
    { label: "Error", render: (row) => short(row.error, 120) }
  ], data.runtimeRuns || [], "No runtime runs recorded."));
}

function renderAgentRuns(data) {
  const phaseSummary = data.phaseSummary || [];
  const summary = phaseSummary.length ? section("Phase Summary", h("div", { className: "quick-stats" }, phaseSummary.slice(0, 8).map((phase) => (
    statCard(phase.phaseKey || "unphased", phase.total || 0, `${phase.withReceipt || 0} receipts / ${phase.failed || 0} failed`)
  )))) : null;
  setDetailBody(h("div", { className: "stack" }, [
    summary,
    renderTable([
    { label: "Status", render: (row) => chip(row.status) },
    { label: "Agent Run", render: (row) => h("div", {}, [
      h("strong", {}, row.agent_run_id),
      h("p", { className: "muted" }, row.runtime_run_id || row.session_run_id || row.dispatch_id || "")
    ]) },
    { label: "Phase", render: (row) => h("div", {}, [
      present(row.phase_key),
      h("p", { className: "muted" }, present(row.task_id))
    ]) },
    { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agent_id)}` },
    { label: "Attempt", key: "attempt" },
    { label: "Receipt", render: (row) => h("code", {}, present(row.receipt_ref)) },
    { label: "Updated", render: (row) => formatDate(row.updated_at) },
    { label: "Error", render: (row) => short(row.error, 120) }
  ], data.agentRuns || [], "No agent runs indexed.")
  ]));
}

function renderVerification(data) {
  const summary = data.summary || {};
  const decisionRows = Object.entries(summary.byDecision || {}).map(([decision, count]) => ({ decision, count }));
  const typeRows = Object.entries(summary.byType || {}).map(([resultType, count]) => ({ resultType, count }));
  setDetailBody(h("div", { className: "stack" }, [
    section("Verification Summary", h("div", { className: "quick-stats" }, [
      statCard("Results", summary.total || data.count || 0, data.source || ""),
      statCard("Latest", summary.latestDecision || "-", formatDate(summary.latestCreatedAt)),
      statCard("Decisions", decisionRows.length || 0),
      statCard("Types", typeRows.length || 0)
    ])),
    h("div", { className: "content-grid" }, [
      section("By Decision", renderTable([
        { label: "Decision", render: (row) => chip(row.decision) },
        { label: "Count", key: "count" }
      ], decisionRows, "No verification decisions.")),
      section("By Type", renderTable([
        { label: "Type", key: "resultType" },
        { label: "Count", key: "count" }
      ], typeRows, "No verification result types."))
    ]),
    section("Verification Results", renderTable([
      { label: "Decision", render: (row) => chip(row.decision) },
      { label: "Type", key: "resultType" },
      { label: "Result", render: (row) => h("div", {}, [
        h("strong", {}, row.verificationId),
        h("p", { className: "muted" }, short(row.summary, 150))
      ]) },
      { label: "Scope", render: (row) => h("div", {}, [
        h("p", {}, `phase ${present(row.phaseKey || row.phaseId)}`),
        h("p", { className: "muted" }, `task ${present(row.taskId)} / agent ${present(row.agentRunId)}`)
      ]) },
      { label: "Reviewer", render: (row) => `${present(row.verifierAgent || row.refuterAgent || row.sourceAgent)} / ${present(row.sourceRuntime)}` },
      { label: "Evidence", render: (row) => h("code", {}, present([...(row.evidenceRefs || []), ...(row.artifactRefs || []), ...(row.receiptRefs || [])].slice(0, 3).join(", "))) },
      { label: "Created", render: (row) => formatDate(row.createdAt) }
    ], data.results || [], "No verifier/refuter results recorded."))
  ]));
}

function messageFlowClosure(row) {
  const status = String(row.status || "").toLowerCase();
  const target = `${present(row.targetRuntime)}:${present(row.targetAgentId)}`;
  if (status.includes("failed")) return "failed";
  if (status === "route_registered") return "route registered";
  if (status === "runtime_dispatched") return "runtime pending";
  if (status === "outbound_queued") return "delivery queued";
  if (["local_codex", "codex"].includes(String(row.targetRuntime || "").toLowerCase())) {
    return status === "runtime_completed" ? `inbox receipt (${target})` : `inbox pending (${target})`;
  }
  if (row.returnPolicy === "silent") return status === "runtime_completed" ? "runtime receipt only" : "runtime pending";
  if (row.deliveryReceiptPresent) return "delivered";
  if (row.finalOutputPresent) return "delivery pending";
  return "runtime pending";
}

function renderMessageFlows(data) {
  const flows = data.flows || [];
  const events = data.events || [];
  const summary = data.summary || [];
  const body = h("div", { className: "stack" }, [
    section("Closure Summary", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Return Policy", key: "returnPolicy" },
      { label: "Target Runtime", key: "targetRuntime" },
      { label: "Count", key: "count" },
      { label: "Runtime Output", key: "finalOutputPresent" },
      { label: "Delivery Receipt", key: "deliveryReceiptPresent" }
    ], summary, "No message_flow summary.")),
    section("Flows", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Flow", render: (row) => h("div", {}, [
        h("strong", {}, row.flowId),
        h("p", { className: "muted" }, row.traceId || row.idempotencyKey || row.dispatchId)
      ]) },
      { label: "Target", render: (row) => `${present(row.targetRuntime)}:${present(row.targetAgentId)}` },
      { label: "Policy", key: "returnPolicy" },
      { label: "Closure", render: (row) => messageFlowClosure(row) },
      { label: "Output", render: (row) => row.finalOutputPresent ? chip("present", "ok") : chip("not required/none", "neutral") },
      { label: "Delivery", render: (row) => row.deliveryReceiptPresent ? chip("receipt", "ok") : chip("no receipt", row.returnPolicy === "silent" || ["local_codex", "codex"].includes(String(row.targetRuntime || "").toLowerCase()) ? "neutral" : "warning") },
      { label: "Updated", render: (row) => formatDate(row.timestamps?.updatedAt) },
      { label: "Error", render: (row) => short(row.lastError, 120) }
    ], flows, "No message_flows recorded.")),
    section("Events", renderTable([
      { label: "At", render: (row) => formatDate(row.createdAt) },
      { label: "Event", render: (row) => h("div", {}, [
        h("strong", {}, row.eventType),
        h("p", { className: "muted" }, row.flowId)
      ]) },
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Target", render: (row) => `${present(row.targetRuntime)}:${present(row.targetAgentId)}` },
      { label: "Policy", key: "returnPolicy" },
      { label: "Dispatch", key: "dispatchId" }
    ], events, "No message_flow events."))
  ]);
  setDetailBody(body);
}

function renderTimeline(data) {
  const events = data.events || [];
  if (!events.length) return setDetailBody(emptyState("No timeline events recorded."));
  const list = h("div", { className: "timeline" });
  for (const event of events) {
    list.append(h("article", { className: `timeline-item ${event.severity || "neutral"}` }, [
      h("div", { className: "timeline-dot" }),
      h("div", { className: "timeline-body" }, [
        h("div", { className: "timeline-head" }, [
          h("strong", {}, event.title),
          chip(event.status || event.kind, event.severity || toneFor(event.status))
        ]),
        event.subtitle ? h("p", { className: "muted" }, displayText(event.subtitle, 220)) : null,
        h("div", { className: "workflow-meta" }, [
          h("span", {}, formatDate(event.at)),
          h("span", {}, event.kind),
          h("span", {}, event.actor || "-"),
          h("span", {}, event.refId || "-")
        ]),
        event.payload ? h("details", {}, [
          h("summary", {}, "Payload"),
          jsonBlock(event.payload)
        ]) : null
      ])
    ]));
  }
  setDetailBody(list);
}

function renderIncidentTimeline(events = []) {
  if (!events.length) return emptyState("No incident timeline events.");
  const list = h("div", { className: "timeline compact-timeline" });
  for (const event of events) {
    list.append(h("article", { className: `timeline-item ${event.severity || toneFor(event.status)}` }, [
      h("div", { className: "timeline-dot" }),
      h("div", { className: "timeline-body" }, [
        h("div", { className: "timeline-head" }, [
          h("strong", {}, event.title || event.kind || "-"),
          chip(event.status || event.kind, event.severity || toneFor(event.status))
        ]),
        event.subtitle ? h("p", { className: "muted" }, displayText(event.subtitle, 220)) : null,
        h("div", { className: "workflow-meta" }, [
          h("span", {}, formatDate(event.at)),
          h("span", {}, event.kind || "-"),
          h("span", {}, event.actor || "-"),
          h("span", {}, event.refId || "-")
        ]),
        event.payload ? h("details", {}, [
          h("summary", {}, "Payload"),
          jsonBlock(event.payload)
        ]) : null
      ])
    ]));
  }
  return list;
}

function renderIncidentCloseout(data) {
  const incident = data.selectedIncident || null;
  const refs = data.refs || {};
  const counts = data.counts || {};
  const body = h("div", { className: "stack" }, [
    section("Incident Closeout", incident ? h("div", { className: "copy-block" }, [
      h("div", { className: "quick-stats" }, [
        statCard("Status", data.status || "unknown", data.schemaVersion || ""),
        statCard("Incident", incident.incidentId || "-"),
        statCard("State", incident.status || "-", incident.mode || ""),
        statCard("Passed", counts.passed || 0, `${counts.checklist || 0} checks`),
        statCard("Failed", counts.failed || 0),
        statCard("Warnings", counts.warnings || 0)
      ]),
      h("div", { className: "workflow-meta" }, [
        h("span", {}, `Dead-letter ${present(refs.deadLetter?.kind)}:${present(refs.deadLetter?.refId)}`),
        h("span", {}, `Human Gate ${present(refs.humanGateId)}`),
        h("span", {}, `Cat Claw Audit ${present(refs.catClawAuditId)}`),
        h("span", {}, `Updated ${formatDate(incident.updatedAt)}`)
      ]),
      h("div", { className: "actions" }, [
        h("button", { onClick: () => previewIncidentCloseout("workflow.incident.closeout.cat_claw_report.preview", incident.incidentId) }, "Preview Cat Claw Report"),
        h("button", { onClick: () => previewIncidentCloseout("workflow.incident.closeout.human_gate_package.preview", incident.incidentId) }, "Preview Human Gate Package"),
        h("button", { onClick: () => previewIncidentCloseout("workflow.incident.closeout.artifact.preview", incident.incidentId, { packageKind: "human_gate_package" }) }, "Preview Artifact Persist"),
        h("button", { onClick: () => previewIncidentCloseout("workflow.incident.closeout.human_gate_request.preview", incident.incidentId) }, "Preview HGate Request")
      ]),
      h("p", { className: "muted" }, "Preview only. These actions do not close incidents, create Human Gate requests, write artifacts, dispatch Cat Claw, or send Telegram. HGate Request preview reads a persisted closeout artifact if one exists."),
      h("p", {}, incident.summary || "No incident summary.")
    ]) : emptyState("No incident state is linked to this workflow.")),
    section("Checklist", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Check", render: (row) => h("div", {}, [
        h("strong", {}, row.label),
        h("p", { className: "muted" }, row.key)
      ]) },
      { label: "Severity", render: (row) => chip(row.severity, row.severity === "required" ? "critical" : "warning") },
      { label: "Detail", render: (row) => short(row.detail, 220) },
      { label: "Refs", render: (row) => h("code", {}, present((row.refs || []).join(", "))) }
    ], data.checklist || [], "No closeout checklist.")),
    section("Linked Incidents", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Incident", render: (row) => h("div", {}, [
        h("strong", {}, row.incidentId),
        h("p", { className: "muted" }, short(row.summary, 140))
      ]) },
      { label: "Mode", key: "mode" },
      { label: "Commander", key: "commander" },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) },
      { label: "Resolved", render: (row) => formatDate(row.resolvedAt) }
    ], data.incidents || [], "No linked incidents.")),
    section("Timeline", renderIncidentTimeline(data.timeline || [])),
    section("Refs", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(refs)
    ]))
  ]);
  setDetailBody(body);
}

function renderIncidentCloseoutPreview(response) {
  const preview = previewPayload(response);
  if (response?.ok === false || !preview) {
    setDetailBody(h("div", { className: "stack" }, [
      section("Closeout Preview Error", renderKeyValues([
        { label: "Status", value: response?.ok === false ? "failed" : "missing result" },
        { label: "Action", value: response?.action || "-" },
        { label: "Operation", value: response?.operationId || "-" },
        { label: "Message", value: response?.message || response?.error || "-" }
      ])),
      renderActionResultInspector(response || {}, { action: response?.action || "workflow.incident.closeout.preview", workflowId: state.selectedWorkflowId }),
      section("Raw Preview", h("details", {}, [
        h("summary", {}, "JSON"),
        jsonBlock(response || {})
      ]))
    ]));
    return;
  }
  const draft = preview.reportDraft || {};
  const humanGateOptions = draft.humanGateOptions || preview.requestDraft?.buttons || [];
  const wouldCreate = preview.wouldCreate || {};
  const isHumanGateRequestPreview = preview.action === "workflow.incident.closeout.human_gate_request.preview";
  const humanGateEvidenceInput = h("input", {
    type: "text",
    name: "humanGateEvidence",
    autocomplete: "off",
    placeholder: "existing Human Gate evidence / risk decision / Flashcat original words"
  });
  const auditInput = h("input", {
    type: "text",
    name: "catClawAuditId",
    autocomplete: "off",
    placeholder: "Cat Claw audit / secretary audit id"
  });
  const reasonInput = h("textarea", {
    name: "operatorReason",
    rows: 3,
    placeholder: "operator reason"
  });
  const submitFields = {
    humanGateEvidence: humanGateEvidenceInput,
    catClawAuditId: auditInput,
    operatorReason: reasonInput
  };
  setDetailBody(h("div", { className: "stack" }, [
    renderActionResultInspector(response, { action: response.action || preview.action || "workflow.incident.closeout.preview", workflowId: preview.workflowId || state.selectedWorkflowId }),
    section("Closeout Package Preview", renderKeyValues([
      { label: "Workflow", value: preview.workflowId || state.selectedWorkflowId },
      { label: "Incident", value: preview.incidentId || "-" },
      { label: "Package", value: preview.packageKind || "-" },
      { label: "Eligible", value: preview.eligible ? "yes" : "no" },
      { label: "Closeout", value: preview.closeoutStatus || "-" },
      { label: "Operation", value: response.operationId || "-" }
    ])),
    section("Write Boundary", renderKeyValues([
      { label: "Artifacts", value: wouldCreate.artifacts ?? wouldCreate.artifactIndexRows ?? 0 },
      { label: "Files", value: wouldCreate.files || 0 },
      { label: "Workflow Events", value: wouldCreate.workflowEvents || 0 },
      { label: "Human Gate Requests", value: wouldCreate.humanGateRequests ?? wouldCreate.humanGateRecords ?? 0 },
      { label: "Telegram Outbox", value: wouldCreate.telegramOutbox || 0 },
      { label: "Runtime Dispatches", value: wouldCreate.runtimeDispatches || 0 }
    ])),
    section("Draft", h("div", { className: "copy-block" }, [
      h("h3", {}, draft.title || "Closeout draft"),
      h("p", {}, draft.summaryZh || ""),
      h("p", { className: "muted" }, draft.decision || "")
    ])),
    section("Human Gate Options", renderTable([
      { label: "Option", render: (row) => row.optionId || row.payload?.optionKey || row.role || "-" },
      { label: "Title", render: (row) => row.title || row.label || row.payload?.title || "-" },
      { label: "Style", render: (row) => chip(row.style || "-") },
      { label: "Summary", render: (row) => short(row.summary, 220) }
    ], humanGateOptions, "No Human Gate options in this package.")),
    isHumanGateRequestPreview ? section("Create Human Gate Request", h("div", { className: "form-grid" }, [
      h("label", {}, [
        h("span", {}, "Human Gate Evidence"),
        humanGateEvidenceInput
      ]),
      h("label", {}, [
        h("span", {}, "Cat Claw Audit"),
        auditInput
      ]),
      h("label", { className: "wide" }, [
        h("span", {}, "Reason"),
        reasonInput
      ]),
      h("div", { className: "actions wide" }, [
        h("button", {
          disabled: !preview.eligible || !preview.closeoutArtifactId,
          onClick: () => executeCloseoutHumanGateRequest(preview, submitFields)
        }, "Create HGate Request")
      ])
    ])) : null,
    section("Violations", renderTable([
      { label: "Code", key: "code" },
      { label: "Detail", render: (row) => short(row.detail, 220) }
    ], preview.violations || [], "No blocking violations.")),
    section("Evidence Gaps", renderTable([
      { label: "Key", key: "key" },
      { label: "Check", key: "label" },
      { label: "Severity", render: (row) => chip(row.severity, row.severity === "required" ? "critical" : "warning") },
      { label: "Detail", render: (row) => short(row.detail, 220) }
    ], preview.requiredEvidence || draft.evidenceGaps || [], "No blocking evidence gaps.")),
    section("Warnings", renderTable([
      { label: "Key", key: "key" },
      { label: "Check", key: "label" },
      { label: "Detail", render: (row) => short(row.detail, 220) }
    ], preview.warnings || [], "No warnings.")),
    section("Evidence Refs", h("ul", { className: "compact-list" }, (draft.evidenceRefs || []).map((item) => h("li", {}, h("code", {}, item))))),
    section("Limitations", h("ul", { className: "compact-list" }, (preview.limitations || []).map((item) => h("li", {}, item)))),
    section("Raw Preview", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(response)
    ]))
  ]));
}

function renderHumanGates(data) {
  const body = h("div", { className: "stack" }, [
    section("Records", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Human Gate", key: "object_id" },
      { label: "Source", key: "source_agent" },
      { label: "Path", render: (row) => h("code", {}, present(row.path)) },
      { label: "Updated", render: (row) => formatDate(row.updated_at) }
    ], data.records || [], "No Human Gate records.")),
    section("Buttons", renderTable([
      { label: "Status", render: (row) => chip(row.selected_at ? "selected" : row.status) },
      { label: "Button", render: (row) => h("div", {}, [h("strong", {}, row.label), h("p", { className: "muted" }, short(row.summary || row.prompt, 120))]) },
      { label: "Role", key: "button_role" },
      { label: "Decision", key: "decision_status" },
      { label: "Selected By", key: "selected_by" },
      { label: "Selected At", render: (row) => formatDate(row.selected_at) }
    ], data.buttons || [], "No Human Gate buttons.")),
    section("Batches", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Batch", render: (row) => h("div", {}, [h("strong", {}, row.batch_id), h("p", { className: "muted" }, short(row.title, 120))]) },
      { label: "Default", key: "default_action" },
      { label: "HTML", render: (row) => h("code", {}, present(row.html_path)) },
      { label: "Created", render: (row) => formatDate(row.created_at) }
    ], data.batches || [], "No Human Gate batches."))
  ]);
  setDetailBody(body);
}

function renderHumanGateReadiness(data) {
  const summary = data.summary || {};
  const checklist = data.checklist || [];
  const body = h("div", { className: "stack" }, [
    section("Readiness", h("div", { className: "copy-block" }, [
      h("div", { className: "quick-stats" }, [
        statCard("Status", data.status || "unknown", data.schemaVersion || ""),
        statCard("Passed", summary.passed || 0, `${summary.total || checklist.length || 0} checks`),
        statCard("Failed", summary.failed || 0),
        statCard("Warnings", summary.warnings || 0),
        statCard("Approve Options", summary.approveOptionCount || 0, `${summary.buttonCount || 0} buttons`),
        statCard("Receipts", summary.receiptPresentCount || 0),
        statCard("Artifacts", summary.artifactCount || 0),
        statCard("Sent Outbox", summary.sentOutboxCount || 0)
      ]),
      h("div", { className: "workflow-meta" }, [
        h("span", {}, `Cat Claw audit: ${data.readyForCatClawAudit ? "ready" : "not ready"}`),
        h("span", {}, `Human Gate submit: ${data.readyForHumanGateSubmission ? "ready" : "needs attention"}`),
        h("span", {}, `Latest gate ${present(summary.latestHumanGateId)}`),
        h("span", {}, formatDate(data.generatedAt))
      ])
    ])),
    section("Checklist", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Check", render: (row) => h("div", {}, [
        h("strong", {}, row.label),
        h("p", { className: "muted" }, row.key)
      ]) },
      { label: "Severity", render: (row) => chip(row.severity, row.severity === "required" ? "critical" : "warning") },
      { label: "Detail", render: (row) => short(row.detail, 220) },
      { label: "Refs", render: (row) => h("code", {}, present((row.refs || []).join(", "))) }
    ], checklist, "No Human Gate readiness checks.")),
    section("Evidence Counts", h("div", { className: "quick-stats" }, [
      statCard("Records", summary.recordCount || 0),
      statCard("Buttons", summary.buttonCount || 0),
      statCard("Checkpoints", summary.checkpointCount || 0),
      statCard("Artifacts", summary.artifactCount || 0),
      statCard("Delivery", data.delivery?.sent || 0, `${data.delivery?.queued || 0} queued / ${data.delivery?.failed || 0} failed`)
    ]))
  ]);
  setDetailBody(body);
}

function renderOutbox(data) {
  setDetailBody(renderTable([
    { label: "Status", render: (row) => chip(row.status) },
    { label: "Outbox", key: "outboxId" },
    { label: "Target", render: (row) => `${present(row.targetKind)}:${present(row.targetRef)}` },
    { label: "Type", key: "messageType" },
    { label: "Delivery", render: (row) => h("div", {}, [
      chip(row.deliveryReceipt?.receiptState || row.status || "-"),
      h("p", { className: "muted" }, `receipts ${row.deliveryReceipt?.receiptCount ?? 0}`)
    ]) },
    { label: "Preview", render: (row) => short(row.textPreview, 130) },
    { label: "Updated", render: (row) => formatDate(row.updatedAt) },
    { label: "Action", render: (row) => h("div", { className: "actions compact-actions" }, [
      h("button", { onClick: () => previewTelegramOutboxDelivery(row.outboxId) }, "Preview Delivery"),
      h("button", { onClick: () => previewTelegramOutboxRequeue(row.outboxId) }, "Preview Requeue")
    ]) }
  ], data.outbox || [], "No outbox messages."));
}

function renderOperations(data) {
  const readiness = data.readiness || {};
  const workflow = selectedWorkflow() || {};
  const workflowId = data.workflowId || state.selectedWorkflowId || "";
  const scoped = Boolean(workflowId);
  const policy = state.config?.operatorPolicy || {};
  const actionGateRows = [
    { label: "Operator Role", status: policy.role || "local_console_operator_unverified", tone: "neutral", evidence: policy.roleEvidence || "Static local console role; not a user identity assertion." },
    { label: "Server Mode", status: state.config?.actionMode || "preview-only", tone: state.config?.readOnlyMode === false ? "warning" : "ok", evidence: state.config?.readOnlyMode === false ? "Writes still require action gateway allowlist." : "Read-only mode hides executable writes." },
    { label: "Workflow Scope", status: scoped ? "available" : "required", tone: scoped ? "ok" : "critical", evidence: scoped ? workflowId : "Deep-link or select a workflow before workflow-scoped previews." },
    { label: "Preview Audit", status: policy.auditSurface || "workflow_operations", tone: "ok", evidence: "Preview actions append console operation audit rows." },
    { label: "Executable Writes", status: policy.writeActions || "hidden_read_only", tone: policy.writeActions === "hidden_read_only" ? "ok" : "warning", evidence: "Real writes remain hidden unless startup policy enables them and gateway policy allows them." }
  ];
  const reloadOperations = async () => {
    writeUrlState();
    if (state.consoleView === "operations") await loadGlobalView();
    else await loadDetail();
  };
  const availableDeadLetters = data.deadLetterAvailableSummary || data.deadLetterSummary || [];
  const kindOptions = [
    { value: "", label: "All kinds" },
    ...Array.from(new Set(availableDeadLetters.map((row) => row.kind).filter(Boolean))).sort().map((kind) => ({ value: kind, label: kind }))
  ];
  const severityOptions = [
    { value: "", label: "All severities" },
    ...Array.from(new Set(availableDeadLetters.map((row) => row.severity).filter(Boolean))).sort().map((severity) => ({ value: severity, label: severity }))
  ];
  const statusOptions = [
    { value: "", label: "All statuses" },
    ...Array.from(new Set((data.deadLetterAvailableStatuses || []).map((row) => row.status).filter(Boolean))).sort().map((status) => ({ value: status, label: status }))
  ];
  const deadLetterFilter = data.deadLetterFilter || {};
  const body = h("div", { className: "stack" }, [
    section("Operations Scope", h("div", { className: "quick-stats" }, [
      statCard("Scope", scoped ? "workflow" : "global", scoped ? workflowId : "all workflows"),
      statCard("Dead Letters", deadLetterFilter.totalAfterFilter ?? (data.deadLetters || []).length, `${deadLetterFilter.returned ?? (data.deadLetters || []).length} shown`),
      statCard("Operations", (data.workflowOperations || []).length),
      statCard("Action Mode", state.config?.actionMode || "preview-only", state.config?.operatorPolicy?.writeActions || "writes hidden unless server policy enables them")
    ])),
    section("Action Gate", actionGatePanel("Workflow Intervention Gate", actionGateRows)),
    section("Action Audit Ledger", renderActionAuditLedger(data.actionAuditSummary || {})),
    section("Recent Action Results", renderRecentActionResults()),
    section("Controlled Intervention Previews", h("div", { className: "copy-block" }, [
      h("div", { className: "actions" }, [
        h("button", { disabled: !scoped, title: scoped ? `Workflow ${workflowId}` : "Select or deep-link a workflow to preview workflow-scoped actions.", onClick: scoped ? () => previewIntervention("workflow.pause.preview", {}, workflowId) : undefined }, "Preview Pause"),
        h("button", { disabled: !scoped, title: scoped ? `Workflow ${workflowId}` : "Select or deep-link a workflow to preview workflow-scoped actions.", onClick: scoped ? () => previewIntervention("workflow.resume.preview", {}, workflowId) : undefined }, "Preview Resume"),
        h("button", { disabled: !scoped, title: scoped ? `Workflow ${workflowId}` : "Select or deep-link a workflow to preview workflow-scoped actions.", onClick: scoped ? () => previewIntervention("workflow.stop.preview", {}, workflowId) : undefined }, "Preview Stop"),
        h("button", { disabled: !scoped, title: scoped ? `Workflow ${workflowId}` : "Select or deep-link a workflow to preview workflow-scoped actions.", onClick: scoped ? () => previewIntervention("workflow.rerun.phase.preview", { phaseKey: workflow.currentPhase || "" }, workflowId) : undefined }, "Preview Rerun Phase")
      ]),
      h("p", { className: "muted" }, "Preview only. These controls do not pause, resume, stop, rerun, submit Human Gate, drain runtime, or mutate workflow state.")
    ])),
    section("Readiness", readiness ? h("div", { className: "copy-block" }, [
      chip(readiness.status || "unknown"),
      h("p", {}, `Checked: ${formatDate(readiness.checkedAt)}`),
      renderReadinessFindings(readiness)
    ]) : emptyState("No readiness snapshot."), { "data-section": "readiness" }),
    section("Dead-Letter / Stuck Attention", h("div", { className: "stack" }, [
      h("div", { className: "actions" }, [
        optionSelect(state.operationsFilters.kind, kindOptions, async (value) => {
          state.operationsFilters.kind = value;
          await reloadOperations();
        }),
        optionSelect(state.operationsFilters.severity, severityOptions, async (value) => {
          state.operationsFilters.severity = value;
          await reloadOperations();
        }),
        optionSelect(state.operationsFilters.status, statusOptions, async (value) => {
          state.operationsFilters.status = value;
          await reloadOperations();
        }),
        h("button", { onClick: async () => {
          state.operationsFilters.kind = "";
          state.operationsFilters.severity = "";
          state.operationsFilters.status = "";
          await reloadOperations();
        } }, "Clear")
      ]),
      h("p", { className: "muted" }, `${present(deadLetterFilter.returned, (data.deadLetters || []).length)} shown / ${present(deadLetterFilter.totalAfterFilter, (data.deadLetters || []).length)} matching / ${present(deadLetterFilter.totalBeforeFilter, (data.deadLetters || []).length)} total`),
      renderTable([
        { label: "Severity", render: (row) => chip(row.severity || row.status) },
        { label: "Kind", key: "kind" },
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Workflow", key: "workflowId" },
        { label: "Ref", key: "refId" },
        { label: "Attempt", render: (row) => row.maxAttempts ? `${present(row.attempt, "0")}/${present(row.maxAttempts, "0")}` : "-" },
        { label: "Updated", render: (row) => formatDate(row.updatedAt) },
        { label: "Detail", render: (row) => short(row.detail || row.title, 140) },
        { label: "Evidence", render: (row) => h("button", { onClick: () => loadDeadLetterEvidence(row) }, "Evidence") }
      ], data.deadLetters || [], "No dead-letter or stuck attention items.")
    ])),
    section("Workflow Operations", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Operation", render: (row) => h("div", {}, [
        h("strong", {}, row.operationId),
        h("p", { className: "muted" }, short(row.action, 120))
      ]) },
      { label: "Scope", render: (row) => `${present(row.scopeType)}:${present(row.scopeId || row.workflowId)}` },
      { label: "Risk", render: (row) => chip(row.riskTier || "-", operationRiskTone(row)) },
      { label: "Actor", key: "requestedBy" },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) },
      { label: "Error", render: (row) => short(row.error, 140) },
      { label: "Evidence", render: (row) => h("button", { type: "button", onClick: () => inspectWorkflowOperation(row) }, "Inspect") }
    ], data.workflowOperations || [], "No workflow operations recorded.")),
    section("Workflow Operation Summary", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Action", key: "action" },
      { label: "Risk", key: "riskTier" },
      { label: "Dry Run", render: (row) => row.dryRun ? "yes" : "no" },
      { label: "Count", key: "count" }
    ], data.workflowOperationSummary || [], "No workflow operation summary.")),
    section("Control Loop Jobs", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Job Type", key: "job_type" },
      { label: "Count", key: "count" }
    ], data.controlLoopJobs || [], "No control loop job summary.")),
    section("Stale / Failed Dispatches", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Dispatch", key: "dispatch_id" },
      { label: "Workflow", key: "workflow_id" },
      { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agent_id)}` },
      { label: "Attempt", render: (row) => `${present(row.attempt)}/${present(row.max_attempts)}` },
      { label: "Updated", render: (row) => formatDate(row.updated_at) },
      { label: "Error", render: (row) => short(row.last_error, 120) }
    ], data.staleDispatches || [], "No stale or failed dispatches.")),
    section("Telegram Outbox", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Type", key: "message_type" },
      { label: "Count", key: "count" }
    ], data.telegramOutbox || [], "No outbox summary.")),
    section("Delivery Executions", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Outbox", key: "outboxId" },
      { label: "Delivery", render: (row) => h("div", {}, [
        chip(row.deliveryStatus || "-"),
        h("p", { className: "muted" }, row.idempotentReplay ? "idempotent replay" : row.didSendTelegram ? "sent" : "not sent")
      ]) },
      { label: "Receipts", key: "receiptCount" },
      { label: "Actor", key: "requestedBy" },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) },
      { label: "Error", render: (row) => short(row.error, 120) }
    ], data.deliveryExecutions || [], "No governed delivery execution operations.")),
    section("Human Gate", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Count", key: "count" }
    ], data.humanGate || [], "No Human Gate summary.")),
    section("Runtime Drain Jobs", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Kind", render: (row) => row.drainKind ? chip(row.drainKind, row.drainKind === "exact" ? "ok" : "neutral") : "-" },
      { label: "Job", render: (row) => h("div", {}, [
        h("strong", {}, row.jobId),
        h("p", { className: "muted" }, short(row.dedupeKey, 120))
      ]) },
      { label: "Runtime", key: "runtime" },
      { label: "Dispatch", key: "exactDispatchId" },
      { label: "Attempt", render: (row) => `${present(row.attempt)}/${present(row.maxAttempts)}` },
      { label: "Next", render: (row) => formatDate(row.nextRunAt) },
      { label: "Lease", render: (row) => formatDate(row.leaseUntil) },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) },
      { label: "Error", render: (row) => short(row.lastError, 120) }
    ], (data.controlLoopJobDetails || []).filter((row) => row.jobType === "runtime_drain"), "No runtime drain jobs.")),
    section("Message Flow", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Return Policy", key: "return_policy" },
      { label: "Target Runtime", key: "target_runtime" },
      { label: "Count", key: "count" },
      { label: "Runtime Output", key: "final_output_present" },
      { label: "Delivery Receipt", key: "delivery_receipt_present" }
    ], data.messageFlow || [], "No message_flow summary.")),
    section("Message Flow Attention", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Flow", key: "flow_id" },
      { label: "Workflow", render: (row) => present(row.workflow_id || row.meeting_id) },
      { label: "Target", render: (row) => `${present(row.target_runtime)}:${present(row.target_agent_id)}` },
      { label: "Policy", key: "return_policy" },
      { label: "Outbox", key: "outbox_id" },
      { label: "Updated", render: (row) => formatDate(row.updated_at) },
      { label: "Error", render: (row) => short(row.last_error, 120) }
    ], data.messageFlowAttention || [], "No delivery-required message_flow needs attention."))
  ]);
  setDetailBody(body);
}

function renderActionAuditLedger(summary = {}) {
  const latestFailures = summary.latestFailures || [];
  const sourceRefSummary = (refs = []) => (refs || [])
    .map((ref) => `${ref.source || "source"}.${ref.field || "id"}=${ref.id || "-"}`)
    .join(", ");
  return h("div", { className: "stack" }, [
    h("div", { className: "quick-stats" }, [
      statCard("Audit Rows", summary.total || 0, `latest ${formatDate(summary.lastUpdatedAt)}; current result window`),
      statCard("Previews", summary.previewRows || 0, "dry-run operation rows"),
      statCard("Executable Rows", summary.executableRows || 0, "should stay 0 in read-only mode"),
      statCard("Rejected / Failed+Denied", `${summary.rejectedRows || 0}/${summary.failedRows || 0}`, `${summary.failureEvidenceRows || 0} row(s) with visible failure evidence`)
    ]),
    h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Status", render: (row) => chip(row.status || "unknown") },
        { label: "Count", key: "count" }
      ], summary.statusCounts || [], "No operation status counts."),
      renderTable([
        { label: "Risk", render: (row) => chip(row.riskTier || "unknown", row.riskTier === "high" ? "critical" : row.riskTier === "medium" ? "warning" : "neutral") },
        { label: "Count", key: "count" }
      ], summary.riskCounts || [], "No operation risk counts."),
      renderTable([
        { label: "Actor", key: "actor" },
        { label: "Count", key: "count" }
      ], summary.actorCounts || [], "No operation actors.")
    ]),
    renderTable([
      { label: "Status", render: (row) => chip(row.status || "unknown") },
      { label: "Operation", render: (row) => h("div", {}, [
        h("strong", {}, row.operationId || "-"),
        h("p", { className: "muted" }, short(row.action, 120))
      ]) },
      { label: "Actor", key: "actor" },
      { label: "Workflow", key: "workflowId" },
      { label: "Reason", render: (row) => short(row.reason, 120) },
      { label: "Failure Evidence", render: (row) => short(row.error, 140) },
      { label: "Source Ref", render: (row) => sourceRefSummary(row.sourceRefs) || "-" },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) },
      { label: "Ref", render: (row) => {
        const refText = sourceRefSummary(row.sourceRefs) || row.operationId || "";
        return refText ? h("button", { type: "button", onClick: () => copyText(refText, "Operation ref") }, "Copy") : "-";
      } },
      { label: "Evidence", render: (row) => h("button", { type: "button", onClick: () => inspectWorkflowOperation(row) }, "Inspect") }
    ], latestFailures, "No rejected, failed, denied, or error-bearing workflow operations.")
  ]);
}

async function loadDeadLetterEvidence(row = {}) {
  const workflowId = row.workflowId || "";
  if (!row.kind || !row.refId) return;
  if (!workflowId) {
    setActionStatus("Dead-letter workflow id missing", "warning");
    setDetailBody(emptyState("This dead-letter row has no workflow id, so scoped evidence cannot be loaded."));
    return;
  }
  setActionStatus("Loading dead-letter evidence...", "neutral");
  try {
    const params = new URLSearchParams({
      kind: row.kind,
      refId: row.refId,
      workflowId
    });
    const data = await api(`/api/operations/dead-letter-evidence?${params.toString()}`);
    state.lastPayload = data;
    renderDeadLetterEvidence(data);
    setActionStatus(data.found ? "Evidence loaded" : "Evidence not found", data.found ? "ok" : "warning");
  } catch (error) {
    setActionStatus("Evidence load failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
  }
}

async function backToOperations() {
  if (state.consoleView === "operations") {
    await loadGlobalView();
    return;
  }
  await loadDetail();
}

async function loadWorkflowEvidencePack(workflowId) {
  const id = workflowId || "";
  if (!id) {
    setActionStatus("Workflow id missing", "warning");
    setDetailBody(emptyState("Workflow evidence pack requires a workflow id."));
    return;
  }
  setActionStatus("Loading workflow evidence pack...", "neutral");
  try {
    const data = await api(`/api/workflows/${encodeURIComponent(id)}/evidence-pack`);
    state.lastPayload = data;
    renderEvidencePack(data);
    setActionStatus(data.found ? "Evidence pack loaded" : "Evidence pack not found", data.found ? "ok" : "warning");
  } catch (error) {
    setActionStatus("Evidence pack load failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
  }
}

async function previewDeadLetterIncident(data) {
  if (!data?.workflowId || !data?.kind || !data?.refId) {
    setActionStatus("Incident preview requires workflow, kind, and ref", "warning");
    return;
  }
  setActionStatus("Incident preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "workflow.incident.from_dead_letter.preview",
        actor: "workflow-console",
        reason: "console dead-letter incident preview",
        payload: {
          workflowId: data.workflowId,
          kind: data.kind,
          refId: data.refId
        }
      })
    });
    recordActionResult(result, { action: "workflow.incident.from_dead_letter.preview", workflowId: data.workflowId, label: "Dead-Letter Incident Preview" });
    const options = await loadIncidentEvidenceOptions(data);
    state.lastPayload = { preview: result, evidenceOptions: options };
    renderDeadLetterIncidentPreview(result, data, options);
    setActionStatus(result.ok === false ? "Incident preview failed" : "Incident preview OK", result.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "workflow.incident.from_dead_letter.preview", workflowId: data.workflowId, label: "Dead-Letter Incident Preview" });
    setActionStatus("Incident preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "workflow.incident.from_dead_letter.preview", workflowId: data.workflowId }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function previewControlLoopJobRequeue(workflowId, jobId) {
  if (!workflowId || !jobId) {
    setActionStatus("Job requeue preview requires workflow and job id", "warning");
    return;
  }
  setActionStatus("Job requeue preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "workflow.control_loop.job.requeue.preview",
        actor: "workflow-console",
        reason: "console control-loop job requeue preview",
        payload: {
          workflowId,
          jobId,
          operatorReason: "console preview only"
        }
      })
    });
    recordActionResult(result, { action: "workflow.control_loop.job.requeue.preview", workflowId, label: "Job Requeue Preview" });
    state.lastPayload = result;
    setDetailBody(h("div", { className: "stack" }, [
      section("Job Requeue Preview", renderActionResultInspector(result, { action: "workflow.control_loop.job.requeue.preview", workflowId })),
      section("Read-Only Boundary", h("p", { className: "muted" }, "This preview does not requeue the job, drain runtime, dispatch agents, send Telegram, resume Human Gate, or mutate workflow state."))
    ]));
    setActionStatus(result.ok === false ? "Job requeue preview failed" : "Job requeue preview OK", result.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "workflow.control_loop.job.requeue.preview", workflowId, label: "Job Requeue Preview" });
    setActionStatus("Job requeue preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "workflow.control_loop.job.requeue.preview", workflowId }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function loadIncidentEvidenceOptions(data) {
  if (!data?.workflowId) return null;
  const params = new URLSearchParams({
    kind: data.kind || "",
    refId: data.refId || ""
  });
  try {
    return await api(`/api/workflows/${encodeURIComponent(data.workflowId)}/incident-evidence-options?${params.toString()}`);
  } catch {
    return null;
  }
}

async function executeDeadLetterIncident(sourceData, fields) {
  const humanGateId = fields.humanGateId.value.trim();
  const catClawAuditId = fields.catClawAuditId.value.trim();
  const operatorReason = fields.operatorReason.value.trim();
  if (!humanGateId || !catClawAuditId || !operatorReason) {
    setActionStatus("Human Gate, Cat Claw audit, and reason are required", "warning");
    return;
  }
  setActionStatus("Creating linked incident...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "workflow.incident.from_dead_letter",
        actor: "workflow-console",
        reason: operatorReason,
        payload: {
          workflowId: sourceData.workflowId,
          kind: sourceData.kind,
          refId: sourceData.refId,
          humanGateId,
          catClawAuditId,
          operatorReason
        }
      })
    });
    recordActionResult(result, { action: "workflow.incident.from_dead_letter", workflowId: sourceData.workflowId, label: "Create Linked Incident" });
    state.lastPayload = result;
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "workflow.incident.from_dead_letter", workflowId: sourceData.workflowId }),
      section("Dead-Letter Incident Result", renderKeyValues([
        { label: "Status", value: result.ok === false ? "failed" : "ok" },
        { label: "Operation", value: result.operationId || "-" },
        { label: "Incident", value: result.result?.incidentId || "-" },
        { label: "Boundary", value: result.result?.writeBoundary || "-" },
        { label: "Repair", value: result.result?.didRetryOrRepair ? "yes" : "no" }
      ])),
      section("Raw Result", h("details", { open: true }, [
        h("summary", {}, "JSON"),
        jsonBlock(result)
      ]))
    ]));
    setActionStatus(result.ok === false ? "Incident create failed" : "Incident linked", result.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "workflow.incident.from_dead_letter", workflowId: sourceData.workflowId, label: "Create Linked Incident" });
    setActionStatus("Incident create failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "workflow.incident.from_dead_letter", workflowId: sourceData.workflowId }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

function evidenceOptionLabel(option) {
  if (!option) return "-";
  const status = option.status || option.decision || "";
  const source = option.sourceAgent || option.source || "";
  const reason = option.recommendationSummary ? ` (${short(option.recommendationSummary, 70)})` : "";
  const summary = option.summary ? ` - ${short(option.summary, 70)}` : "";
  return `${option.id}${status ? ` [${status}]` : ""}${source ? ` ${source}` : ""}${reason}${summary}`;
}

function evidenceSelect(name, options = [], placeholder, fallbackPlaceholder) {
  if (!options.length) {
    return h("input", {
      type: "text",
      name,
      autocomplete: "off",
      placeholder: fallbackPlaceholder
    });
  }
  return h("select", { name }, [
    h("option", { value: "" }, placeholder),
    ...options.map((option) => h("option", { value: option.id }, evidenceOptionLabel(option)))
  ]);
}

function recommendationText(option = {}) {
  if (option.recommendationSummary) return option.recommendationSummary;
  return (option.recommendationReasons || []).map((reason) => reason.label || reason.code).filter(Boolean).join("; ") || "-";
}

function renderDeadLetterIncidentPreview(response, sourceData, evidenceOptions = null) {
  const result = response.result || {};
  const humanGateOptions = evidenceOptions?.humanGateOptions || [];
  const catClawAuditOptions = evidenceOptions?.catClawAuditOptions || [];
  const canCreateIncident = state.consoleView === "workflows" && state.config?.readOnlyMode === false;
  const humanGateInput = evidenceSelect("humanGateId", humanGateOptions, "Select Human Gate evidence", "humanGateId");
  const auditInput = evidenceSelect("catClawAuditId", catClawAuditOptions, "Select Cat Claw audit evidence", "catClawAuditId");
  const reasonInput = h("textarea", {
    name: "operatorReason",
    rows: 3,
    placeholder: "operator reason"
  });
  const fields = {
    humanGateId: humanGateInput,
    catClawAuditId: auditInput,
    operatorReason: reasonInput
  };
  setDetailBody(h("div", { className: "stack" }, [
    renderActionResultInspector(response, { action: "workflow.incident.from_dead_letter.preview", workflowId: sourceData.workflowId }),
    section("Dead-Letter Incident Preview", renderKeyValues([
      { label: "Status", value: response.ok === false ? "failed" : "ok" },
      { label: "Operation", value: response.operationId || "-" },
      { label: "Eligible", value: result.eligible ? "yes" : "no" },
      { label: "Incident", value: result.incidentId || "-" },
      { label: "Would Retry", value: result.wouldRetryOrRepair ? "yes" : "no" },
      { label: "Boundary", value: result.wouldMutate ? "incident_state_only" : "-" }
    ])),
    canCreateIncident ? section("Create Linked Incident", h("div", { className: "form-grid" }, [
      h("label", {}, [
        h("span", {}, "Human Gate"),
        humanGateInput
      ]),
      h("label", {}, [
        h("span", {}, "Cat Claw Audit"),
        auditInput
      ]),
      h("label", { className: "wide" }, [
        h("span", {}, "Reason"),
        reasonInput
      ]),
      h("div", { className: "actions wide" }, [
        h("button", {
          disabled: response.ok === false || !result.eligible,
          onClick: () => executeDeadLetterIncident(sourceData, fields)
        }, "Create Incident")
      ])
    ])) : section("Create Linked Incident", emptyState(state.consoleView === "operations"
      ? "Real incident creation is hidden in preview-only Operations. Use Incident Preview to inspect the package; executable writes require the workflow detail console with writes explicitly enabled."
      : "Real incident creation is hidden while the console is read-only. Use Incident Preview to inspect the package; executable writes require startup policy to enable writes.")),
    section("Evidence Options", evidenceOptions ? h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Human Gate", key: "id" },
        { label: "Status", key: "status" },
        { label: "Source", key: "sourceAgent" },
        { label: "Reason", render: (row) => short(recommendationText(row), 140) },
        { label: "Summary", render: (row) => short(row.summary, 120) }
      ], humanGateOptions, "No Human Gate candidates."),
      renderTable([
        { label: "Cat Claw Audit", key: "id" },
        { label: "Decision", key: "decision" },
        { label: "Source", key: "sourceAgent" },
        { label: "Reason", render: (row) => short(recommendationText(row), 140) },
        { label: "Summary", render: (row) => short(row.summary, 120) }
      ], catClawAuditOptions, "No Cat Claw audit candidates.")
    ]) : emptyState("Evidence options could not be loaded; ids can still be entered manually.")),
    section("Raw Preview", h("details", { open: true }, [
      h("summary", {}, "JSON"),
      jsonBlock(response)
    ]))
  ]));
}

function renderDeadLetterEvidence(data) {
  const manifest = data.manifest || {};
  const incidentCandidate = data.incidentCandidate || null;
  const filename = `${present(data.workflowId, "workflow")}-${present(data.kind, "dead-letter")}-${present(data.refId, "ref")}-evidence.json`;
  const body = h("div", { className: "stack" }, [
    section("Dead-Letter Evidence", h("div", { className: "copy-block" }, [
      h("div", { className: "actions" }, [
        h("button", { onClick: () => backToOperations() }, "Back to Operations"),
        h("button", { disabled: !data.workflowId, onClick: () => loadWorkflowEvidencePack(data.workflowId) }, "Workflow Pack"),
        h("button", { disabled: !incidentCandidate, onClick: () => previewDeadLetterIncident(data) }, "Incident Preview"),
        h("button", { onClick: () => downloadJson(filename, data) }, "Download JSON")
      ]),
      renderKeyValues([
        { label: "Schema", value: data.schemaVersion || "-" },
        { label: "Workflow", value: data.workflowId || "-" },
        { label: "Kind", value: data.kind || "-" },
        { label: "Ref", value: data.refId || "-" },
        { label: "Status", value: data.status || "-" },
        { label: "Generated", value: formatDate(data.generatedAt) }
      ])
    ])),
    section("Manifest", h("div", { className: "quick-stats" }, [
      statCard("Primary", manifest.primaryCount || 0),
      statCard("Dispatches", manifest.relatedDispatchCount || 0),
      statCard("Runtime Runs", manifest.relatedRuntimeRunCount || 0),
      statCard("Message Flows", manifest.relatedMessageFlowCount || 0),
      statCard("Events", manifest.relatedMessageFlowEventCount || 0),
      statCard("Outbox", manifest.relatedOutboxCount || 0),
      statCard("Human Gate", `${manifest.relatedHumanGateRecordCount || 0}/${manifest.relatedHumanGateButtonCount || 0}`, "records/buttons"),
      statCard("Side Effects", manifest.relatedSideEffectCount || 0)
    ])),
    section("Incident Candidate", incidentCandidate ? h("div", { className: "stack" }, [
      renderKeyValues([
        { label: "Schema", value: incidentCandidate.schemaVersion || "-" },
        { label: "Mode", value: incidentCandidate.writeMode || "-" },
        { label: "Severity", value: incidentCandidate.severity || "-" },
        { label: "Suggested", value: `${incidentCandidate.suggestedStatus || "-"}/${incidentCandidate.suggestedMode || "-"}` },
        { label: "Planes", value: (incidentCandidate.affectedPlanes || []).join(", ") || "-" }
      ]),
      h("p", { className: "muted" }, incidentCandidate.rollbackBoundary || "Read-only preview; no incident has been created."),
      section("Recommended Actions", renderTable([
        { label: "#", key: "step" },
        { label: "Action", key: "text" }
      ], (incidentCandidate.recommendedNextActions || []).map((text, index) => ({
        step: index + 1,
        text
      })), "No recommended actions.")),
      section("Evidence Refs", renderTable([
        { label: "Source", key: "source" },
        { label: "Field", key: "field" },
        { label: "Id", render: (row) => h("code", {}, present(row.id)) }
      ], incidentCandidate.evidenceRefs || [], "No evidence references."))
    ]) : emptyState("No incident candidate.")),
    section("Raw Evidence", h("details", { open: true }, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]);
  setDetailBody(body);
}

function renderInterventionPreview(response) {
  const preview = previewPayload(response);
  if (response?.ok === false || !preview) {
    setDetailBody(h("div", { className: "stack" }, [
      section("Preview Error", renderKeyValues([
        { label: "Status", value: response?.ok === false ? "failed" : "missing result" },
        { label: "Action", value: response?.action || "-" },
        { label: "Operation", value: response?.operationId || "-" },
        { label: "Message", value: response?.message || response?.error || "-" }
      ])),
      renderActionResultInspector(response || {}, { action: response?.action || "workflow.intervention.preview", workflowId: state.selectedWorkflowId }),
      section("Raw Preview", h("details", {}, [
        h("summary", {}, "JSON"),
        jsonBlock(response || {})
      ]))
    ]));
    return;
  }
  const wouldUpdate = preview.wouldUpdateWorkflow || {};
  setDetailBody(h("div", { className: "stack" }, [
    renderActionResultInspector(response, { action: response.action || preview.action || "workflow.intervention.preview", workflowId: preview.workflowId || state.selectedWorkflowId }),
    section("Intervention Preview", renderKeyValues([
      { label: "Workflow", value: preview.workflowId || state.selectedWorkflowId },
      { label: "Kind", value: preview.kind || "-" },
      { label: "Eligible", value: preview.eligible ? "yes" : "no" },
      { label: "Risk", value: preview.riskTier || response.riskTier || "-" },
      { label: "Human Gate", value: preview.humanGateRequired ? "required" : "not required" },
      { label: "Next Status", value: wouldUpdate.status || "-" },
      { label: "Operation", value: response.operationId || "-" }
    ])),
    section("Would Affect", renderKeyValues([
      { label: "Active Dispatches", value: preview.wouldAffect?.activeDispatches || 0 },
      { label: "Pending Human Gates", value: preview.wouldAffect?.pendingHumanGates || 0 },
      { label: "Side Effects", value: preview.wouldAffect?.sideEffectUncertain || 0 },
      { label: "Target Phases", value: preview.wouldAffect?.targetPhases || 0 },
      { label: "Target Agent Runs", value: preview.wouldAffect?.targetAgentRuns || 0 }
    ])),
    section("Violations", renderTable([
      { label: "Code", key: "code" },
      { label: "Detail", render: (row) => short(row.detail, 220) }
    ], preview.violations || [], "No blocking violations.")),
    section("Warnings", renderTable([
      { label: "Code", key: "code" },
      { label: "Detail", render: (row) => short(row.detail, 220) }
    ], preview.warnings || [], "No warnings.")),
    section("Limitations", h("ul", { className: "compact-list" }, (preview.limitations || []).map((item) => h("li", {}, item)))),
    section("Raw Preview", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(response)
    ]))
  ]));
}

function renderEvidence(data) {
  const body = h("div", { className: "stack" }, [
    section("Artifacts", renderTable([
      { label: "Artifact", key: "artifact_id" },
      { label: "Kind", key: "kind" },
      { label: "Summary", render: (row) => short(row.summary, 140) },
      { label: "Path", render: (row) => h("code", {}, present(row.path)) },
      { label: "Created By", key: "created_by" },
      { label: "Created", render: (row) => formatDate(row.created_at) }
    ], data.artifacts || [], "No artifacts.")),
    section("Side Effects", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Side Effect", key: "side_effect_id" },
      { label: "Type", key: "side_effect_type" },
      { label: "Owner", key: "owner_agent" },
      { label: "Artifact", render: (row) => h("code", {}, present(row.artifact_ref)) },
      { label: "Updated", render: (row) => formatDate(row.updated_at) }
    ], data.sideEffects || [], "No side effects."))
  ]);
  setDetailBody(body);
}

function renderReceipts(data) {
  const summary = data.summary || {};
  const kindRows = Object.entries(summary.byKind || {}).map(([kind, count]) => ({ kind, count }));
  const statusRows = Object.entries(summary.byStatus || {}).map(([status, count]) => ({ status, count }));
  const body = h("div", { className: "stack" }, [
    section("Receipt Summary", h("div", { className: "quick-stats" }, [
      statCard("Shown Receipts", summary.total || data.count || 0, `${data.source || ""} / ${data.summaryScope || summary.scope || "shown"}`),
      statCard("Present", summary.present || 0),
      statCard("Missing", summary.missing || 0),
      statCard("Kinds", kindRows.length || 0),
      statCard("Candidates", data.candidateCount || data.count || 0, `limit ${data.limit || "-"}`)
    ])),
    h("div", { className: "content-grid" }, [
      section("By Kind", renderTable([
        { label: "Kind", key: "kind" },
        { label: "Count", key: "count" }
      ], kindRows, "No receipt kinds.")),
      section("By Status", renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Count", key: "count" }
      ], statusRows, "No receipt statuses."))
    ]),
    section("Unified Receipts", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Kind", key: "kind" },
      { label: "Receipt", render: (row) => h("div", {}, [
        h("strong", {}, row.receiptId),
        h("p", { className: "muted" }, short(row.title, 120))
      ]) },
      { label: "Present", render: (row) => row.present ? chip("present", "ok") : chip("missing", "warning") },
      { label: "Delivery", render: (row) => row.deliveryReceipt ? h("div", {}, [
        chip(row.deliveryReceipt.receiptState || "-"),
        h("p", { className: "muted" }, `receipts ${row.deliveryReceipt.receiptCount || 0}`)
      ]) : "-" },
      { label: "Chain", render: (row) => h("div", {}, [
        h("p", {}, `phase ${present(row.phaseKey)}`),
        h("p", { className: "muted" }, `task ${present(row.taskId)} / dispatch ${present(row.dispatchId)}`),
        h("p", { className: "muted" }, `runtime ${present(row.runtimeRunId)} / outbox ${present(row.outboxId)}`)
      ]) },
      { label: "Artifact", render: (row) => h("code", {}, present(row.artifactRef)) },
      { label: "Source", key: "source" },
      { label: "Updated", render: (row) => formatDate(row.updatedAt || row.createdAt) },
      { label: "Summary", render: (row) => short(row.summary, 140) }
    ], data.receipts || [], "No receipts or evidence records."))
  ]);
  setDetailBody(body);
}

function renderEvidenceWorkspace(data = {}) {
  const workflowId = data.workflowId || state.selectedWorkflowId || "";
  const desk = data.evidenceDesk || {};
  const pack = data.evidencePack || {};
  const incident = data.incidentCloseout || {};
  const summary = desk.summary || {};
  const missing = summary.missingEvidence || [];
  const readiness = desk.readiness || {};
  const manifest = pack.manifest || {};
  const selectedIncident = incident.selectedIncident || null;
  const exportStamp = String(data.generatedAt || pack.generatedAt || new Date().toISOString()).replace(/[^0-9TZ]/g, "");
  const workspaceExportProvenance = evidenceExportProvenanceModel(data, {
    surface: "evidence-workspace",
    filename: `${workflowId || "workflow"}-evidence-workspace-${exportStamp}.json`
  });
  const readinessChecklist = readiness.checklist || [];
  const readinessStatus = (key) => readinessChecklist.find((item) => item.key === key)?.status || "";
  const pauseControlReady = readinessStatus("pause_control") === "pass";
  const terminateControlReady = readinessStatus("terminate_control") === "pass";
  const stopControlsReady = pauseControlReady && terminateControlReady;
  const policy = state.config?.operatorPolicy || {};
  const exportGateRows = [
    { label: "Operator Role", status: policy.role || "local_console_operator_unverified", tone: "neutral", evidence: policy.roleEvidence || "Static local console role; not a user identity assertion." },
    { label: "Export Mode", status: policy.evidenceExport || "redacted_browser_download", tone: "ok", evidence: "Browser download of the redacted read model; no workflow business write." },
    { label: "Workflow Scope", status: workflowId ? "available" : "required", tone: workflowId ? "ok" : "critical", evidence: workflowId || "Select a workflow before exporting evidence." },
    { label: "Human Gate Readiness", status: summary.humanGateReadyForSubmission ? "ready" : "not ready", tone: summary.humanGateReadyForSubmission ? "ok" : "warning", evidence: summary.humanGateReadyForSubmission ? "Readiness checklist allows submission." : "Evidence export is allowed, but submission still needs readiness." },
    { label: "Incident Preview Scope", status: selectedIncident ? "available" : "not selected", tone: selectedIncident ? "ok" : "warning", evidence: selectedIncident ? selectedIncident.incidentId : "Incident closeout previews stay disabled until an incident is selected." }
  ];
  const timeline = [
    ...(incident.timeline || []).map((event) => ({ ...event, packageSource: "incident" })),
    ...((pack.timeline?.events || []).slice(0, 80)).map((event) => ({ ...event, packageSource: "workflow" }))
  ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 18);
  if (!workflowId) {
    setDetailBody(emptyState("Select a workflow from the queue to open its evidence workspace."));
    return;
  }
  setDetailBody(h("div", { className: "stack" }, [
    section("Evidence Package", h("div", { className: "package-grid" }, [
      h("article", { className: `package-card ${toneFor(desk.status || data.status)}` }, [
        h("div", { className: "workflow-title" }, [
          h("strong", {}, workflowId),
          chip(desk.status || data.status || "unknown")
        ]),
        h("p", { className: "workflow-summary" }, selectedWorkflow()?.summary || selectedWorkflow()?.objective || "Workflow evidence package."),
        h("div", { className: "mini-counts" }, [
          h("span", {}, `generated ${formatDate(data.generatedAt)}`),
          h("span", {}, `pack ${formatDate(pack.generatedAt)}`),
          h("span", {}, pack.writeMode || "read_only")
        ]),
        h("div", { className: "actions card-actions" }, [
          h("button", { type: "button", onClick: () => openWorkflowTab(workflowId, "evidence-desk") }, "Open Evidence Desk"),
          h("button", { type: "button", onClick: () => openWorkflowTab(workflowId, "evidence-pack") }, "Open Pack Tab"),
          h("button", { type: "button", onClick: () => downloadJson(`${workflowId}-evidence-workspace-${exportStamp}.json`, data) }, "Download Workspace")
        ])
      ]),
      h("article", { className: `package-card ${missing.length ? "warning" : "ok"}` }, [
        h("div", { className: "workflow-title" }, [
          h("strong", {}, "Review Readiness"),
          chip(missing.length ? "needs evidence" : "ready", missing.length ? "warning" : "ok")
        ]),
        h("div", { className: "quick-stats compact-stats" }, [
          statCard("Missing", missing.length),
          statCard("Cat Claw", summary.humanGateReadyForCatClawAudit ? "ready" : "not ready"),
          statCard("Human Gate", summary.humanGateReadyForSubmission ? "ready" : "not ready"),
          statCard("Receipts", summary.receiptPresent || 0, `${summary.receiptMissing || 0} missing`)
        ])
      ]),
      h("article", { className: `package-card ${selectedIncident ? toneFor(incident.status) : "neutral"}` }, [
        h("div", { className: "workflow-title" }, [
          h("strong", {}, "Incident Package"),
          chip(selectedIncident ? (incident.status || selectedIncident.status) : "none")
        ]),
        selectedIncident ? h("p", { className: "workflow-summary" }, `${selectedIncident.incidentId}: ${short(selectedIncident.summary, 180)}`) : h("p", { className: "workflow-summary" }, "No incident linked to this workflow."),
        h("div", { className: "actions card-actions" }, [
          h("button", { type: "button", disabled: !selectedIncident, onClick: selectedIncident ? () => openWorkflowTab(workflowId, "incident-closeout") : undefined }, "Open Incident"),
          h("button", { type: "button", disabled: !selectedIncident, onClick: selectedIncident ? () => previewIncidentCloseout("workflow.incident.closeout.cat_claw_report.preview", selectedIncident.incidentId, {}, workflowId) : undefined }, "Preview Cat Claw"),
          h("button", { type: "button", disabled: !selectedIncident, onClick: selectedIncident ? () => previewIncidentCloseout("workflow.incident.closeout.human_gate_package.preview", selectedIncident.incidentId, {}, workflowId) : undefined }, "Preview HGate")
        ])
      ])
    ])),
    section("Cat Claw Secretary Handoff", renderCatClawSecretaryHandoff(data, {
      workflowId,
      selectedIncident,
      compact: false
    }), { "data-section": "cat-claw-secretary-handoff" }),
    section("Export Gate", actionGatePanel("Evidence Export Gate", exportGateRows)),
    section("Export Provenance", renderEvidenceExportProvenance(workspaceExportProvenance), { "data-section": "evidence-export-provenance" }),
    section("Missing Evidence First", missing.length
      ? h("div", { className: "chip-list padded" }, missing.map((item) => chip(item, "warning")))
      : emptyState("No missing evidence detected by the derived desk.")),
    section("Rollback And Stop Boundary", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Boundary", key: "label" },
        { label: "Status", render: (row) => chip(row.status, row.tone) },
        { label: "Evidence", render: (row) => h("code", {}, present(row.evidence)) }
      ], [
        { label: "Checkpoint", status: manifest.checkpointCount ? "available" : "missing", tone: manifest.checkpointCount ? "ok" : "warning", evidence: `${manifest.checkpointCount || 0} checkpoint rows` },
        { label: "Pause/Stop Preview", status: "preview-only", tone: "neutral", evidence: "open workflow detail actions" },
        {
          label: "Human Gate Pause/Stop Controls",
          status: stopControlsReady ? "available" : "missing",
          tone: stopControlsReady ? "ok" : "critical",
          evidence: `pause ${pauseControlReady ? "pass" : "missing"} / terminate ${terminateControlReady ? "pass" : "missing"}`
        },
        { label: "Side Effects", status: manifest.sideEffectCount ? "review required" : "none recorded", tone: manifest.sideEffectCount ? "warning" : "ok", evidence: `${manifest.sideEffectCount || 0} side-effect rows` }
      ]),
      sourceRefList([
        { source: "workflow_checkpoints", field: "workflow_id", id: manifest.checkpointCount ? workflowId : "" },
        { source: "workflow_side_effects", field: "workflow_id", id: manifest.sideEffectCount ? workflowId : "" },
        { source: "console_actions", field: "workflow_id", id: workflowId }
      ], { workflowId })
    ])),
    section("Human Gate And Review Gates", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Check", render: (row) => h("div", {}, [
          h("strong", {}, row.label),
          h("p", { className: "muted" }, short(row.detail, 180))
        ]) },
        { label: "Severity", render: (row) => chip(row.severity, row.severity === "required" ? "critical" : "warning") },
        { label: "Refs", render: (row) => h("code", {}, present((row.refs || []).join(", "))) }
      ], readinessChecklist, "No Human Gate readiness checklist."),
      h("div", { className: "quick-stats" }, [
        statCard("Records", readiness.summary?.recordCount || 0),
        statCard("Buttons", readiness.summary?.buttonCount || 0),
        statCard("Checkpoints", readiness.summary?.checkpointCount || 0),
        statCard("Artifacts", readiness.summary?.artifactCount || 0),
        statCard("Sent Outbox", readiness.summary?.sentOutboxCount || 0),
        statCard("Receipts", readiness.summary?.receiptPresentCount || 0)
      ])
    ])),
    section("Evidence Pack Manifest", renderTable([
      { label: "Section", key: "section" },
      { label: "Count", key: "count" }
    ], [
      { section: "phases", count: manifest.phaseCount || 0 },
      { section: "tasks", count: manifest.taskCount || 0 },
      { section: "dispatches", count: manifest.dispatchCount || 0 },
      { section: "runtimeRuns", count: manifest.runtimeRunCount || 0 },
      { section: "agentRuns", count: manifest.agentRunCount || 0 },
      { section: "messageFlows", count: manifest.messageFlowCount || 0 },
      { section: "humanGate records/buttons", count: `${manifest.humanGateRecordCount || 0}/${manifest.humanGateButtonCount || 0}` },
      { section: "outbox", count: manifest.outboxCount || 0 },
      { section: "checkpoints", count: manifest.checkpointCount || 0 },
      { section: "artifacts/sideEffects", count: `${manifest.artifactCount || 0}/${manifest.sideEffectCount || 0}` },
      { section: "receipts", count: manifest.receiptCount || 0 },
      { section: "operations", count: manifest.operationCount || 0 },
      { section: "timeline", count: manifest.timelineEventCount || 0 }
    ], "No evidence pack manifest.")),
    section("Compressed Timeline", renderIncidentTimeline(timeline)),
    section("Source Package Refs", sourceRefList([
      { source: "workflow", field: "workflow_id", id: workflowId },
      { source: "evidence_pack", field: "schema", id: pack.schemaVersion },
      { source: "incident_closeout", field: "incident_id", id: selectedIncident?.incidentId },
      { source: "human_gate", field: "records", id: String(readiness.summary?.recordCount || "") },
      { source: "artifact", field: "count", id: String(manifest.artifactCount || "") }
    ], { workflowId })),
    section("Raw Workspace", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function evidenceExportProvenanceModel(data = {}, options = {}) {
  const pack = data.evidencePack || data;
  const manifest = pack.manifest || {};
  const workflowId = options.workflowId || data.workflowId || pack.workflowId || state.selectedWorkflowId || "";
  const filename = options.filename || `${present(workflowId, "workflow")}-evidence-export.json`;
  const redactionPolicyVersion = data.redactionPolicyVersion || pack.redactionPolicyVersion || "workflow_console_redaction_v1";
  const writeMode = pack.writeMode || data.writeMode || "read_only_derived_export";
  return {
    schemaVersion: "workflow_console_export_provenance.v1",
    generatedAt: data.generatedAt || pack.generatedAt || new Date().toISOString(),
    workflowId,
    surface: options.surface || "evidence-pack",
    filename,
    exportMode: "console_only_browser_download",
    serverArtifactStatus: "not_written",
    workflowArtifactPolicy: "deferred_to_governed_write_action",
    redactionPolicyVersion,
    writeMode,
    auditBoundary: "Browser download is local to the operator. Workflow artifact persistence must use a separate governed action with policy, audit, and Human Gate evidence.",
    manifest: {
      workflowPresent: manifest.workflowPresent ?? pack.found ?? Boolean(pack.workflow),
      phaseCount: manifest.phaseCount || 0,
      taskCount: manifest.taskCount || 0,
      dispatchCount: manifest.dispatchCount || 0,
      runtimeRunCount: manifest.runtimeRunCount || 0,
      agentRunCount: manifest.agentRunCount || 0,
      messageFlowCount: manifest.messageFlowCount || 0,
      humanGateRecordCount: manifest.humanGateRecordCount || 0,
      humanGateButtonCount: manifest.humanGateButtonCount || 0,
      outboxCount: manifest.outboxCount || 0,
      checkpointCount: manifest.checkpointCount || 0,
      artifactCount: manifest.artifactCount || 0,
      sideEffectCount: manifest.sideEffectCount || 0,
      receiptCount: manifest.receiptCount || 0,
      operationCount: manifest.operationCount || 0,
      deliveryExecutionCount: manifest.deliveryExecutionCount || 0,
      timelineEventCount: manifest.timelineEventCount || 0,
      limit: manifest.limit || ""
    },
    sourceRefs: [
      { source: "workflow", field: "workflow_id", id: workflowId },
      { source: "evidence_pack", field: "schema", id: pack.schemaVersion || data.schemaVersion || "" },
      { source: "artifact_index", field: "workflow_id", id: manifest.artifactCount ? workflowId : "" },
      { source: "workflow_operations", field: "workflow_id", id: manifest.operationCount ? workflowId : "" }
    ]
  };
}

function renderEvidenceExportProvenance(model = {}) {
  const manifest = model.manifest || {};
  const manifestPayload = evidenceExportProvenancePayload(model);
  const gateRows = [
    { label: "Export Ownership", status: model.exportMode || "console_only_browser_download", tone: "ok", evidence: "The current export is a browser-local operator download." },
    { label: "Server Artifact", status: model.serverArtifactStatus || "not_written", tone: "neutral", evidence: "No artifact_index row or server file is created by this download control." },
    { label: "Workflow Artifact", status: model.workflowArtifactPolicy || "deferred_to_governed_write_action", tone: "warning", evidence: "Persisting a workflow artifact requires a separate governed write action and Human Gate policy." },
    { label: "Redaction", status: model.redactionPolicyVersion || "workflow_console_redaction_v1", tone: "ok", evidence: "The export uses the redacted console read model." },
    { label: "Audit Boundary", status: model.writeMode || "read_only_derived_export", tone: "neutral", evidence: model.auditBoundary || "Read-only export boundary." }
  ];
  return h("div", { className: "export-provenance-panel" }, [
    h("div", { className: "quick-stats compact-stats" }, [
      statCard("Mode", model.exportMode || "console_only_browser_download", model.surface || "evidence"),
      statCard("Server Artifact", model.serverArtifactStatus || "not_written"),
      statCard("Workflow Artifact", model.workflowArtifactPolicy || "deferred"),
      statCard("Receipts", manifest.receiptCount || 0),
      statCard("Artifacts", manifest.artifactCount || 0, `${manifest.sideEffectCount || 0} side effects`),
      statCard("Operations", manifest.operationCount || 0)
    ]),
    actionGatePanel("Export Provenance Boundary", gateRows),
    renderTable([
      { label: "Section", key: "section" },
      { label: "Count", key: "count" }
    ], [
      { section: "workflow", count: manifest.workflowPresent ? 1 : 0 },
      { section: "phases/tasks", count: `${manifest.phaseCount || 0}/${manifest.taskCount || 0}` },
      { section: "dispatch/runtime", count: `${manifest.dispatchCount || 0}/${manifest.runtimeRunCount || 0}` },
      { section: "message/outbox", count: `${manifest.messageFlowCount || 0}/${manifest.outboxCount || 0}` },
      { section: "humanGate", count: `${manifest.humanGateRecordCount || 0}/${manifest.humanGateButtonCount || 0}` },
      { section: "evidence", count: `${manifest.artifactCount || 0}/${manifest.sideEffectCount || 0}` },
      { section: "receipts", count: manifest.receiptCount || 0 },
      { section: "operations/timeline", count: `${manifest.operationCount || 0}/${manifest.timelineEventCount || 0}` }
    ], "No export manifest counts."),
    h("div", { className: "actions export-provenance-actions" }, [
      h("button", { type: "button", onClick: () => copyText(JSON.stringify(manifestPayload, null, 2), "Export provenance manifest") }, "Copy Manifest"),
      h("button", { type: "button", onClick: () => downloadJson(String(model.filename || "evidence-export.json").replace(/\.json$/i, "-manifest.json"), manifestPayload) }, "Download Manifest"),
      h("button", { type: "button", disabled: !model.workflowId, onClick: model.workflowId ? () => copyText(model.workflowId, "Workflow") : undefined }, "Copy Workflow")
    ]),
    h("p", { className: "muted" }, "Resolved v1.0 boundary: evidence export is console-only by default. A workflow artifact export is not implicit; it must be a separately reviewed governed action."),
    sourceRefList(model.sourceRefs || [], { workflowId: model.workflowId || "" })
  ]);
}

function evidenceExportProvenancePayload(model = {}) {
  const manifest = model.manifest || {};
  return redactClientValue({
    schemaVersion: model.schemaVersion || "workflow_console_export_provenance.v1",
    generatedAt: model.generatedAt || "",
    workflowId: model.workflowId || "",
    surface: model.surface || "",
    filename: model.filename || "",
    exportMode: model.exportMode || "console_only_browser_download",
    serverArtifactStatus: model.serverArtifactStatus || "not_written",
    workflowArtifactPolicy: model.workflowArtifactPolicy || "deferred_to_governed_write_action",
    redactionPolicyVersion: model.redactionPolicyVersion || "workflow_console_redaction_v1",
    writeMode: model.writeMode || "read_only_derived_export",
    auditBoundary: model.auditBoundary || "",
    manifest: {
      workflowPresent: Boolean(manifest.workflowPresent),
      phaseCount: manifest.phaseCount || 0,
      taskCount: manifest.taskCount || 0,
      dispatchCount: manifest.dispatchCount || 0,
      runtimeRunCount: manifest.runtimeRunCount || 0,
      agentRunCount: manifest.agentRunCount || 0,
      messageFlowCount: manifest.messageFlowCount || 0,
      humanGateRecordCount: manifest.humanGateRecordCount || 0,
      humanGateButtonCount: manifest.humanGateButtonCount || 0,
      outboxCount: manifest.outboxCount || 0,
      checkpointCount: manifest.checkpointCount || 0,
      artifactCount: manifest.artifactCount || 0,
      sideEffectCount: manifest.sideEffectCount || 0,
      receiptCount: manifest.receiptCount || 0,
      operationCount: manifest.operationCount || 0,
      deliveryExecutionCount: manifest.deliveryExecutionCount || 0,
      timelineEventCount: manifest.timelineEventCount || 0,
      limit: manifest.limit || ""
    },
    sourceRefs: model.sourceRefs || []
  });
}

function readinessCheckByKey(readiness = {}, key = "") {
  return (readiness.checklist || []).find((item) => item.key === key) || null;
}

function readinessCheckPassed(readiness = {}, key = "") {
  return readinessCheckByKey(readiness, key)?.status === "pass";
}

function catClawSecretaryHandoffModel(data = {}, options = {}) {
  const workflowId = options.workflowId || data.workflowId || state.selectedWorkflowId || "";
  const desk = data.evidenceDesk || data;
  const summary = desk.summary || {};
  const readiness = desk.readiness || {};
  const pack = data.evidencePack || {};
  const manifest = pack.manifest || {};
  const incident = data.incidentCloseout || desk.incidentCloseout || {};
  const selectedIncident = options.selectedIncident || incident.selectedIncident || null;
  const secretaryCheck = readinessCheckByKey(readiness, "cat_claw_secretary_path");
  const checkpointCount = readiness.summary?.checkpointCount ?? manifest.checkpointCount ?? summary.checkpoints ?? 0;
  const artifactCount = readiness.summary?.artifactCount ?? manifest.artifactCount ?? summary.evidenceArtifacts ?? 0;
  const sentOutboxCount = readiness.summary?.sentOutboxCount ?? 0;
  const receiptPresent = summary.receiptPresent ?? readiness.summary?.receiptPresentCount ?? manifest.receiptCount ?? 0;
  const receiptMissing = summary.receiptMissing ?? 0;
  const missing = summary.missingEvidence || [];
  const readinessRefsByStatus = (status) => (readiness.checklist || [])
    .filter((item) => item.status === status)
    .flatMap((item) => item.refs || [])
    .slice(0, 12);
  const nonPassingReadinessRefs = (readiness.checklist || [])
    .filter((item) => item.status !== "pass")
    .flatMap((item) => item.refs || [])
    .slice(0, 12);
  const rows = [
    {
      key: "secretary_path",
      label: "Cat Claw secretary path",
      status: secretaryCheck?.status === "pass" ? "pass" : secretaryCheck?.status === "warn" ? "warn" : "fail",
      detail: secretaryCheck?.detail || "No cat_claw source/creator is recorded.",
      refs: secretaryCheck?.refs || []
    },
    {
      key: "cat_claw_audit",
      label: "Cat Claw audit readiness",
      status: summary.humanGateReadyForCatClawAudit ? "pass" : "fail",
      detail: summary.humanGateReadyForCatClawAudit ? "Evidence package is ready for Cat Claw audit." : "Cat Claw audit readiness is not yet satisfied.",
      refs: [...(readinessCheckByKey(readiness, "cat_claw_secretary_path")?.refs || []), ...(readinessCheckByKey(readiness, "evidence_artifacts")?.refs || [])]
    },
    {
      key: "human_gate_submission",
      label: "Human Gate submission readiness",
      status: summary.humanGateReadyForSubmission ? "pass" : "fail",
      detail: summary.humanGateReadyForSubmission ? "Human Gate package has required button/report evidence." : "Human Gate submission readiness is incomplete.",
      refs: summary.humanGateReadyForSubmission ? readinessRefsByStatus("pass") : nonPassingReadinessRefs
    },
    {
      key: "receipt_chain",
      label: "Receipt chain",
      status: receiptPresent > 0 && receiptMissing === 0 ? "pass" : receiptPresent > 0 ? "warn" : "fail",
      detail: `${receiptPresent} present receipt(s), ${receiptMissing} missing receipt(s).`,
      refs: (readinessCheckByKey(readiness, "receipt_coverage")?.refs || [])
    },
    {
      key: "rollback_boundary",
      label: "Rollback / stop boundary",
      status: checkpointCount > 0 && readinessCheckPassed(readiness, "pause_control") && readinessCheckPassed(readiness, "terminate_control") ? "pass" : "fail",
      detail: `checkpoint ${checkpointCount || 0}, pause ${readinessCheckPassed(readiness, "pause_control") ? "pass" : "missing"}, terminate ${readinessCheckPassed(readiness, "terminate_control") ? "pass" : "missing"}.`,
      refs: [
        ...(readinessCheckByKey(readiness, "checkpoint_available")?.refs || []),
        ...(readinessCheckByKey(readiness, "pause_control")?.refs || []),
        ...(readinessCheckByKey(readiness, "terminate_control")?.refs || [])
      ]
    },
    {
      key: "delivery_evidence",
      label: "Delivery evidence",
      status: sentOutboxCount > 0 ? "pass" : readinessCheckByKey(readiness, "telegram_delivery_observed")?.status === "warn" ? "warn" : "fail",
      detail: readinessCheckByKey(readiness, "telegram_delivery_observed")?.detail || `${sentOutboxCount} sent outbox message(s).`,
      refs: readinessCheckByKey(readiness, "telegram_delivery_observed")?.refs || []
    },
    {
      key: "incident_package",
      label: "Incident closeout package",
      status: selectedIncident ? "pass" : "warn",
      detail: selectedIncident ? `Incident ${selectedIncident.incidentId} is available for closeout preview.` : "No selected incident package; this may be fine for non-incident workflows.",
      refs: selectedIncident?.incidentId ? [selectedIncident.incidentId] : []
    }
  ];
  const failed = rows.filter((row) => row.status === "fail").length;
  const warnings = rows.filter((row) => row.status === "warn").length;
  return {
    workflowId,
    status: failed ? "not_ready" : warnings || missing.length ? "needs_attention" : "ready",
    rows,
    missing,
    summary: {
      failed,
      warnings,
      passed: rows.filter((row) => row.status === "pass").length,
      checkpointCount,
      artifactCount,
      receiptPresent,
      receiptMissing,
      sentOutboxCount
    }
  };
}

function catClawSecretaryHandoffEvidenceText(model = {}) {
  return [
    `workflow=${redactClientText(model.workflowId || "-")}`,
    `status=${redactClientText(model.status || "unknown")}`,
    ...(model.rows || []).map((row) => redactClientText(`${row.key}:${row.status}:${(row.refs || []).join(",") || row.detail || "-"}`))
  ].join("\n");
}

function renderCatClawSecretaryHandoff(data = {}, options = {}) {
  const model = catClawSecretaryHandoffModel(data, options);
  const workflowId = model.workflowId || "";
  const selectedIncident = options.selectedIncident || data.incidentCloseout?.selectedIncident || data.evidenceDesk?.incidentCloseout?.selectedIncident || null;
  return h("div", { className: "secretary-handoff" }, [
    h("div", { className: "quick-stats compact-stats" }, [
      statCard("Secretary Status", model.status || "unknown", "cat_claw handoff"),
      statCard("Passed", model.summary.passed || 0),
      statCard("Warnings", model.summary.warnings || 0),
      statCard("Failed", model.summary.failed || 0),
      statCard("Receipts", model.summary.receiptPresent || 0, `${model.summary.receiptMissing || 0} missing`),
      statCard("Artifacts", model.summary.artifactCount || 0)
    ]),
    renderTable([
      { label: "Status", render: (row) => chip(row.status, row.status === "pass" ? "ok" : row.status === "warn" ? "warning" : "critical") },
      { label: "Secretary Check", render: (row) => h("div", {}, [
        h("strong", {}, row.label),
        h("p", { className: "muted" }, short(row.detail, 180))
      ]) },
      { label: "Refs", render: (row) => copyableEvidenceList(row.refs || [], "Secretary handoff ref") }
    ], model.rows, "No Cat Claw handoff checks."),
    h("div", { className: "actions secretary-handoff-actions" }, [
      h("button", { type: "button", disabled: !workflowId, onClick: workflowId ? () => openWorkflowTab(workflowId, "evidence-desk") : undefined }, "Open Evidence Desk"),
      h("button", { type: "button", disabled: !workflowId, onClick: workflowId ? () => openWorkflowTab(workflowId, "human-gate-readiness") : undefined }, "Open Gate Readiness"),
      h("button", { type: "button", disabled: !workflowId, onClick: workflowId ? () => openWorkflowTab(workflowId, "evidence-pack") : undefined }, "Open Evidence Pack"),
      h("button", { type: "button", disabled: !selectedIncident, onClick: selectedIncident ? () => openWorkflowTab(workflowId, "incident-closeout") : undefined }, "Open Incident"),
      h("button", { type: "button", onClick: () => copyText(catClawSecretaryHandoffEvidenceText(model), "Cat Claw handoff evidence") }, "Copy Handoff")
    ]),
    h("p", { className: "muted" }, "Read-only secretary shortcut. It does not dispatch Cat Claw, submit Human Gate, send Telegram, mutate evidence, or approve workflow continuation.")
  ]);
}

function renderEvidenceDesk(data) {
  const summary = data.summary || {};
  const missing = summary.missingEvidence || [];
  const readiness = data.readiness || {};
  const incident = data.incidentCloseout || {};
  const verification = data.verification || {};
  setDetailBody(h("div", { className: "stack" }, [
    collapsibleSection("Evidence Desk", h("div", { className: "copy-block" }, [
      h("div", { className: "quick-stats" }, [
        statCard("Status", data.status || "unknown", data.schemaVersion || ""),
        statCard("Missing", missing.length),
        statCard("Cat Claw Audit", summary.humanGateReadyForCatClawAudit ? "ready" : "not ready"),
        statCard("Human Gate", summary.humanGateReadyForSubmission ? "ready" : "not ready"),
        statCard("Receipts", summary.receiptPresent || 0, `${summary.receiptMissing || 0} missing`),
        statCard("Verification", summary.verificationResults || 0),
        statCard("Artifacts", summary.evidenceArtifacts || 0),
        statCard("Incidents", summary.incidents || 0)
      ]),
      h("div", { className: "workflow-meta" }, [
        h("span", {}, "Workflow"),
        copyableEvidenceId(data.workflowId || state.selectedWorkflowId, "Workflow"),
        h("span", {}, `Generated ${formatDate(data.generatedAt)}`)
      ])
    ]), { open: true, "data-section": "evidence-desk-summary" }),
    collapsibleSection("Missing Evidence", missing.length
      ? h("div", { className: "chip-list" }, missing.map((item) => chip(item, "warning")))
      : emptyState("No missing evidence detected by the derived desk."), { open: Boolean(missing.length), "data-section": "evidence-desk-missing" }),
    collapsibleSection("Governed Preview Actions", renderEvidenceDeskPreviewActions(data), { open: true, "data-section": "evidence-desk-preview-actions" }),
    collapsibleSection("Cat Claw Secretary Handoff", renderCatClawSecretaryHandoff(data, {
      workflowId: data.workflowId || state.selectedWorkflowId,
      compact: true
    }), { open: true, "data-section": "cat-claw-secretary-handoff" }),
    collapsibleSection("Human Gate Readiness", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Check", render: (row) => h("div", {}, [
          h("strong", {}, row.label),
          h("p", { className: "muted" }, short(row.detail, 180))
        ]) },
        { label: "Severity", render: (row) => chip(row.severity, row.severity === "required" ? "critical" : "warning") },
        { label: "Refs", render: (row) => copyableEvidenceList(row.refs || [], "Readiness ref") }
      ], readiness.checklist || [], "No readiness checklist."),
      h("div", { className: "quick-stats" }, [
        statCard("Records", readiness.summary?.recordCount || 0),
        statCard("Buttons", readiness.summary?.buttonCount || 0),
        statCard("Checkpoints", readiness.summary?.checkpointCount || 0),
        statCard("Artifacts", readiness.summary?.artifactCount || 0),
        statCard("Sent Outbox", readiness.summary?.sentOutboxCount || 0),
        statCard("Receipts", readiness.summary?.receiptPresentCount || 0)
      ])
    ]), { open: true, "data-section": "evidence-desk-human-gate" }),
    collapsibleSection("Receipt Chain", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Kind", key: "kind" },
      { label: "Receipt", render: (row) => h("div", {}, [
        copyableEvidenceId(row.receiptId, "Receipt"),
        h("p", { className: "muted" }, short(row.title || row.summary, 120))
      ]) },
      { label: "Present", render: (row) => row.present ? chip("present", "ok") : chip("missing", "warning") },
      { label: "Chain", render: (row) => h("div", {}, [
        h("p", {}, "Task / Dispatch"),
        copyableEvidenceList([row.taskId, row.dispatchId], "Receipt chain"),
        h("p", { className: "muted" }, "Runtime / Outbox"),
        copyableEvidenceList([row.runtimeRunId, row.outboxId], "Receipt chain")
      ]) },
      { label: "Updated", render: (row) => formatDate(row.updatedAt || row.createdAt) }
    ], (data.receipts?.receipts || []).slice(0, 80), "No receipt chain records."), { open: (data.receipts?.receipts || []).length > 0, "data-section": "evidence-desk-receipts" }),
    collapsibleSection("Verification", renderTable([
      { label: "Decision", render: (row) => chip(row.decision) },
      { label: "Type", key: "resultType" },
      { label: "Result", render: (row) => h("div", {}, [
        copyableEvidenceId(row.verificationId, "Verification"),
        h("p", { className: "muted" }, short(row.summary, 140))
      ]) },
      { label: "Reviewer", render: (row) => present(row.verifierAgent || row.refuterAgent || row.sourceAgent) },
      { label: "Created", render: (row) => formatDate(row.createdAt) }
    ], verification.results || [], "No verification results."), { open: (verification.results || []).length > 0, "data-section": "evidence-desk-verification" }),
    collapsibleSection("Incidents / Closeout", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Check", key: "label" },
        { label: "Detail", render: (row) => short(row.detail, 180) }
      ], incident.checklist || [], "No incident closeout checklist."),
      renderIncidentTimeline((incident.timeline || []).slice(0, 20))
    ]), { open: (incident.checklist || []).some((row) => row.status === "fail"), "data-section": "evidence-desk-closeout" }),
    collapsibleSection("Export", h("div", { className: "actions" }, [
      h("button", { onClick: () => downloadJson(`${data.workflowId || state.selectedWorkflowId}-evidence-desk.json`, data) }, "Download Desk JSON"),
      h("button", { onClick: () => loadWorkflowEvidencePack(data.workflowId || state.selectedWorkflowId) }, "Open Evidence Pack")
    ]), { "data-section": "evidence-desk-export" }),
    collapsibleSection("Raw", h("details", {}, [
      h("summary", {}, "JSON Payload"),
      jsonBlock(data)
    ]), { "data-section": "evidence-desk-raw" })
  ]));
}

function renderEvidenceDeskPreviewActions(data = {}) {
  const workflowId = data.workflowId || state.selectedWorkflowId || "";
  const incident = data.incidentCloseout?.selectedIncident || null;
  const outboxRows = (data.outbox?.outbox || [])
    .filter((row) => ["queued", "failed", "delivering"].includes(String(row.status || "")))
    .slice(0, 3);
  const buttons = [
    h("button", {
      type: "button",
      disabled: !workflowId,
      title: workflowId ? "Preview supervise package through WorkflowActionGateway" : "workflowId is required",
      onClick: workflowId ? () => previewSupervise(workflowId) : undefined
    }, "Preview Supervise"),
    h("button", {
      type: "button",
      disabled: !workflowId,
      title: workflowId ? "Open the read-only evidence pack" : "workflowId is required",
      onClick: workflowId ? () => loadWorkflowEvidencePack(workflowId) : undefined
    }, "Open Evidence Pack")
  ];
  if (incident?.incidentId) {
    buttons.push(
      h("button", {
        type: "button",
        disabled: !workflowId,
        title: workflowId ? `Workflow ${workflowId} / Incident ${incident.incidentId}` : "workflowId is required",
        onClick: workflowId ? () => previewIncidentCloseout("workflow.incident.closeout.cat_claw_report.preview", incident.incidentId, {}, workflowId) : undefined
      }, "Preview Cat Claw Report"),
      h("button", {
        type: "button",
        disabled: !workflowId,
        title: workflowId ? `Workflow ${workflowId} / Incident ${incident.incidentId}` : "workflowId is required",
        onClick: workflowId ? () => previewIncidentCloseout("workflow.incident.closeout.human_gate_package.preview", incident.incidentId, {}, workflowId) : undefined
      }, "Preview HGate Package")
    );
  }
  for (const row of outboxRows) {
    const outboxId = row.outboxId || "";
    buttons.push(
      h("button", {
        type: "button",
        disabled: !outboxId,
        title: outboxId ? `Outbox ${outboxId}` : "outboxId is required",
        onClick: outboxId ? () => previewTelegramOutboxDelivery(outboxId) : undefined
      }, `Preview Delivery ${short(outboxId || "missing-outbox", 18)}`),
      h("button", {
        type: "button",
        disabled: !outboxId,
        title: outboxId ? `Outbox ${outboxId}` : "outboxId is required",
        onClick: outboxId ? () => previewTelegramOutboxRequeue(outboxId) : undefined
      }, `Preview Requeue ${short(outboxId || "missing-outbox", 18)}`)
    );
  }
  return h("div", { className: "stack" }, [
    h("div", { className: "actions" }, buttons),
    h("p", { className: "muted" }, "Preview only. These controls generate governed preview/read packages and audit rows where applicable; they do not mutate workflow state or send Telegram.")
  ]);
}

function renderEvidencePack(data) {
  const manifest = data.manifest || {};
  const exportStamp = String(data.generatedAt || new Date().toISOString()).replace(/[^0-9TZ]/g, "");
  const filename = `${present(data.workflowId || state.selectedWorkflowId, "workflow")}-evidence-pack-${exportStamp}.json`;
  const exportProvenance = evidenceExportProvenanceModel(data, {
    surface: "evidence-pack",
    filename
  });
  const body = h("div", { className: "stack" }, [
    section("Evidence Pack Export", h("div", { className: "copy-block" }, [
      h("p", {}, `Schema: ${present(data.schemaVersion)}`),
      h("p", {}, `Generated: ${formatDate(data.generatedAt)}`),
      h("p", {}, `Mode: ${present(data.writeMode)}`),
      h("button", { onClick: () => downloadJson(filename, data) }, "Download JSON")
    ])),
    section("Export Provenance", renderEvidenceExportProvenance(exportProvenance), { "data-section": "evidence-pack-export-provenance" }),
    section("Manifest", h("div", { className: "quick-stats" }, [
      statCard("Workflow", data.found ? "present" : "missing"),
      statCard("Phases", manifest.phaseCount || 0),
      statCard("Tasks", manifest.taskCount || 0),
      statCard("Dispatches", manifest.dispatchCount || 0),
      statCard("Agent Runs", manifest.agentRunCount || 0),
      statCard("Receipts", manifest.receiptCount || 0),
      statCard("Operations", manifest.operationCount || 0, `${manifest.deliveryExecutionCount || 0} delivery`),
      statCard("Human Gate", `${manifest.humanGateRecordCount || 0}/${manifest.humanGateButtonCount || 0}`, "records/buttons"),
      statCard("Timeline", manifest.timelineEventCount || 0)
    ])),
    section("Included Sections", renderTable([
      { label: "Section", key: "section" },
      { label: "Count", key: "count" }
    ], [
      { section: "workflow", count: data.workflow ? 1 : 0 },
      { section: "phases", count: manifest.phaseCount || 0 },
      { section: "tasks", count: manifest.taskCount || 0 },
      { section: "dispatches", count: manifest.dispatchCount || 0 },
      { section: "runtimeRuns", count: manifest.runtimeRunCount || 0 },
      { section: "agentRuns", count: manifest.agentRunCount || 0 },
      { section: "messageFlows", count: manifest.messageFlowCount || 0 },
      { section: "humanGates", count: (manifest.humanGateRecordCount || 0) + (manifest.humanGateButtonCount || 0) },
      { section: "outbox", count: manifest.outboxCount || 0 },
      { section: "checkpoints", count: manifest.checkpointCount || 0 },
      { section: "evidence", count: (manifest.artifactCount || 0) + (manifest.sideEffectCount || 0) },
      { section: "receipts", count: manifest.receiptCount || 0 },
      { section: "operations", count: manifest.operationCount || 0 },
      { section: "deliveryExecutions", count: manifest.deliveryExecutionCount || 0 },
      { section: "timeline", count: manifest.timelineEventCount || 0 }
    ], "No sections.")),
    section("Raw Pack Preview", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]);
  setDetailBody(body);
}

function renderKeyValues(items = []) {
  return h("div", { className: "kv-grid" }, items.map((item) => statCard(item.label, item.value, item.detail || "")));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function yesNoUnknown(value) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function previewPayload(response) {
  if (response?.result && typeof response.result === "object") return response.result;
  if (response?.advance || response?.finalAdvance || response?.workflowId) return response;
  return null;
}

function actionResultWorkflowId(response = {}, context = {}) {
  return context.workflowId
    || response.workflowId
    || response.result?.workflowId
    || response.result?.workflow_id
    || response.result?.preview?.workflowId
    || "";
}

function actionResultStatus(response = {}) {
  if (response.status) return response.status;
  if (response.ok === false) return "failed";
  if (response.operationId) return "completed";
  return "unknown";
}

function actionResultFailureText(response = {}) {
  return response.message || response.error || response.errorMessage || response.result?.error || "";
}

function actionResultEvidenceText(response = {}, context = {}) {
  return [
    `action=${response.action || context.action || "-"}`,
    `operation=${response.operationId || "-"}`,
    `status=${actionResultStatus(response)}`,
    `workflow=${actionResultWorkflowId(response, context) || "-"}`,
    `dryRun=${yesNoUnknown(response.dryRun)}`,
    `inputHash=${response.inputHash || "-"}`,
    actionResultFailureText(response) ? `failure=${actionResultFailureText(response)}` : ""
  ].filter(Boolean).join("\n");
}

function recordActionResult(response = {}, context = {}) {
  const record = {
    recordedAt: new Date().toISOString(),
    label: context.label || response.action || "Console action",
    action: response.action || context.action || "",
    workflowId: actionResultWorkflowId(response, context),
    operationId: response.operationId || "",
    status: actionResultStatus(response),
    dryRun: response.dryRun,
    riskTier: response.riskTier || "",
    inputHash: response.inputHash || "",
    failure: actionResultFailureText(response),
    response
  };
  const key = record.operationId || `${record.action}:${record.recordedAt}`;
  state.recentActionResults = [record, ...state.recentActionResults.filter((item) => (item.operationId || item.recordedAt) !== key)].slice(0, 6);
  return record;
}

function actionRequestFailure(error, context = {}) {
  const response = {
    ok: false,
    action: context.action || "",
    dryRun: String(context.action || "").endsWith(".preview"),
    errorCode: "request_failed",
    message: error instanceof Error ? error.message : String(error)
  };
  recordActionResult(response, context);
  return response;
}

function hasPayload(value) {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(String(value || "").trim());
}

function operationTerminalFailureStatus(status = "") {
  return ["failed", "fail", "error", "denied", "runtime_failed", "telegram_failed", "delivery_failed", "action_failed"].includes(String(status || "").toLowerCase());
}

function operationRiskTone(row = {}) {
  if (operationTerminalFailureStatus(row.status)) return "critical";
  const statusTone = toneFor(row.status);
  if (statusTone === "critical") return "critical";
  const risk = String(row.riskTier || "").toLowerCase();
  if (risk.includes("high")) return "critical";
  if (risk.includes("medium")) return "warning";
  if (row.dryRun) return "neutral";
  return "warning";
}

function workflowOperationToActionResponse(row = {}) {
  return {
    ok: !operationTerminalFailureStatus(row.status) && String(row.status || "").toLowerCase() !== "rejected",
    status: row.status || "",
    action: row.action || "",
    operationId: row.operationId || "",
    workflowId: row.workflowId || "",
    dryRun: row.dryRun,
    riskTier: row.riskTier || "",
    inputHash: row.inputHash || "",
    error: row.error || "",
    resultSummary: row.status || "",
    result: row.dryRun ? (row.previewResult || {}) : (row.result || {})
  };
}

function renderActionResultInspector(response = {}, context = {}) {
  const workflowId = actionResultWorkflowId(response, context);
  const operationId = response.operationId || "";
  const failure = actionResultFailureText(response);
  const sourceRefs = operationId ? [{ source: "workflow_operations", field: "operation_id", id: operationId }] : [];
  return section("Action Result Inspector", h("div", { className: "stack" }, [
    renderKeyValues([
      { label: "Status", value: actionResultStatus(response) },
      { label: "Action", value: response.action || context.action || "-" },
      { label: "Operation", value: operationId || "-" },
      { label: "Workflow", value: workflowId || "-" },
      { label: "Dry Run", value: yesNoUnknown(response.dryRun) },
      { label: "Risk", value: response.riskTier || "-" },
      { label: "Input Hash", value: response.inputHash || "-" }
    ]),
    h("div", { className: "actions drawer-actions" }, [
      h("button", {
        type: "button",
        disabled: !operationId,
        title: operationId ? "Copy workflow_operations source ref" : "No operation row was recorded for this failed request.",
        onClick: operationId ? () => copyText(`workflow_operations.operation_id=${operationId}`, "Operation ref") : undefined
      }, "Copy Operation Ref"),
      h("button", { type: "button", onClick: () => copyText(actionResultEvidenceText(response, context), "Action result evidence") }, "Copy Result Evidence"),
      h("button", {
        type: "button",
        onClick: () => openCommandTarget({ consoleView: "operations", workflowId })
      }, "Open Operations Audit")
    ]),
    sourceRefs.length ? sourceRefList(sourceRefs, { workflowId }) : emptyState("No workflow_operations row is available because the browser request failed before the action gateway returned an operation id."),
    section("Audit Boundary", h("p", { className: "muted" }, "Action evidence is anchored in WorkflowActionGateway -> workflow_operations. This inspector does not retry, approve writes, mutate workflow state, redeliver messages, or bypass Human Gate.")),
    failure ? section("Failure Evidence", h("div", { className: "error" }, failure)) : null
  ]));
}

function inspectWorkflowOperation(row = {}) {
  const response = workflowOperationToActionResponse(row);
  const workflowId = row.workflowId || "";
  const sourceRefs = row.operationId ? [{ source: "workflow_operations", field: "operation_id", id: row.operationId }] : [];
  showDrawer({
    title: "Workflow Operation Inspector",
    subtitle: row.operationId || row.action || "workflow_operations row",
    tone: operationRiskTone(row),
    raw: row,
    body: h("div", { className: "stack" }, [
      renderActionResultInspector(response, { action: row.action || "", workflowId }),
      section("Operation Audit Row", renderKeyValues([
        { label: "Operation", value: row.operationId || "-" },
        { label: "Action", value: row.action || "-" },
        { label: "Status", value: row.status || "-" },
        { label: "Scope", value: `${present(row.scopeType)}:${present(row.scopeId || row.workflowId)}` },
        { label: "Actor", value: row.requestedBy || "-" },
        { label: "Reason", value: row.reason || "-" },
        { label: "Idempotency", value: row.idempotencyKey || "-" },
        { label: "Human Gate", value: row.humanGateId || "-" },
        { label: "Created", value: formatDate(row.createdAt) },
        { label: "Updated", value: formatDate(row.updatedAt) },
        { label: "Completed", value: formatDate(row.completedAt) }
      ])),
      sourceRefs.length ? section("Source Ref", sourceRefList(sourceRefs, { workflowId })) : null,
      hasPayload(row.previewResult) ? section("Preview Result", h("details", { open: true }, [
        h("summary", {}, "Redacted JSON"),
        jsonBlock(row.previewResult)
      ])) : emptyState("No preview_result_json payload recorded for this operation."),
      hasPayload(row.result) ? section("Result", h("details", { open: !row.dryRun }, [
        h("summary", {}, "Redacted JSON"),
        jsonBlock(row.result)
      ])) : null,
      row.error ? section("Failure Evidence", h("div", { className: "error" }, row.error)) : null,
      section("Audit Boundary", h("p", { className: "muted" }, "This inspector reads the durable workflow_operations row and redacted stored results. It does not rerun the action, approve writes, mutate workflow state, redeliver Telegram, or bypass Human Gate."))
    ])
  });
}

function renderRecentActionResults() {
  return renderTable([
    { label: "Status", render: (row) => chip(row.status || "unknown") },
    { label: "Action", render: (row) => h("div", {}, [
      h("strong", {}, row.action || "-"),
      h("p", { className: "muted" }, row.label || "-")
    ]) },
    { label: "Operation", render: (row) => h("code", {}, present(row.operationId)) },
    { label: "Workflow", key: "workflowId" },
    { label: "Dry Run", render: (row) => yesNoUnknown(row.dryRun) },
    { label: "Failure", render: (row) => short(row.failure, 120) },
    { label: "Recorded", render: (row) => formatDate(row.recordedAt) },
    { label: "Evidence", render: (row) => h("button", { type: "button", onClick: () => showDrawer({
      title: "Action Result Inspector",
      subtitle: row.operationId || row.action || "Console action",
      tone: row.status === "failed" ? "critical" : toneFor(row.status),
      raw: row.response,
      body: h("div", { className: "stack" }, [
        renderActionResultInspector(row.response, { action: row.action, workflowId: row.workflowId, label: row.label }),
        section("Raw Result", h("details", { open: true }, [
          h("summary", {}, "JSON"),
          jsonBlock(row.response)
        ]))
      ])
    }) }, "Inspect") }
  ], state.recentActionResults, "No action results in this browser session.");
}

function renderSupervisePreview(response) {
  const preview = previewPayload(response);
  if (response?.ok === false || !preview) {
    const body = h("div", { className: "stack" }, [
      section("Preview Error", renderKeyValues([
        { label: "Status", value: response?.ok === false ? "failed" : "missing result" },
        { label: "Action", value: response?.action || "workflow.supervise.preview" },
        { label: "Operation", value: response?.operationId || "-" },
        { label: "Error Code", value: response?.errorCode || "-" },
        { label: "Message", value: response?.message || response?.error || response?.errorMessage || "-" },
        { label: "Risk Tier", value: response?.riskTier || "-" },
        { label: "Dry Run", value: yesNoUnknown(response?.dryRun) }
      ])),
      renderActionResultInspector(response || {}, { action: "workflow.supervise.preview", workflowId: state.selectedWorkflowId }),
      section("Raw Preview", h("details", {}, [
        h("summary", {}, "JSON"),
        jsonBlock(response || {})
      ]))
    ]);
    setDetailBody(body);
    return;
  }
  const advance = preview.advance || preview.finalAdvance || {};
  const summary = advance.summary || {};
  const wouldUpdate = advance.wouldUpdateWorkflow || {};
  const wouldDispatch = asArray(advance.wouldDispatch);
  const wouldSyncTasks = asArray(advance.wouldSyncTasks);
  const blockedTasks = asArray(advance.blockedTasks);
  const readyTasks = asArray(advance.readyTasks);
  const wouldDrainRuntimes = asArray(preview.wouldDrainRuntimes);
  const limitations = asArray(preview.limitations);
  const wouldReport = preview.wouldCatClawReport || null;
  const body = h("div", { className: "stack" }, [
    renderActionResultInspector(response, { action: "workflow.supervise.preview", workflowId: preview.workflowId || response.workflowId || state.selectedWorkflowId }),
    section("Supervise Preview", renderKeyValues([
      { label: "Workflow", value: preview.workflowId || response.workflowId || state.selectedWorkflowId },
      { label: "Decision", value: advance.decision || response.resultSummary || response.result_summary || "-" },
      { label: "Next Status", value: wouldUpdate.status || "-" },
      { label: "Would Checkpoint", value: yesNoUnknown(preview.wouldCheckpoint) },
      { label: "Would Report", value: wouldReport ? `${wouldReport.runtime}:${wouldReport.agentId}` : "no" },
      { label: "Dry Run", value: yesNoUnknown(response?.dryRun ?? preview.readOnly ?? preview.preview) }
    ])),
    section("Task Counts", renderKeyValues([
      { label: "Total", value: summary.total || 0 },
      { label: "Pending", value: summary.pending || 0 },
      { label: "Ready Tasks", value: readyTasks.length, detail: `${summary.ready || 0} remaining after dispatch preview` },
      { label: "In Progress", value: summary.inProgress || 0 },
      { label: "Done", value: summary.done || 0 },
      { label: "Blocked", value: summary.blocked || 0 },
      { label: "Human Gates", value: summary.pendingHumanGates || 0, detail: `${summary.taskHumanGates || 0} task / ${summary.workflowHumanGates || 0} workflow` }
    ])),
    section("Would Dispatch", renderTable([
      { label: "Task", key: "taskId" },
      { label: "Runtime", render: (row) => `${present(row.runtime)}:${present(row.agentId)}` },
      { label: "Type", key: "dispatchType" },
      { label: "Priority", key: "priority" },
      { label: "Trace", render: (row) => h("code", {}, present(row.traceId)) },
      { label: "Idempotency", render: (row) => h("code", {}, present(row.idempotencyKey)) }
    ], wouldDispatch, "No dispatch would be created.")),
    section("Would Sync Tasks", renderTable([
      { label: "Task", key: "taskId" },
      { label: "Status", render: (row) => chip(row.status || "-") },
      { label: "Artifact", render: (row) => h("code", {}, present(row.actualArtifactRef)) },
      { label: "Completed", render: (row) => formatDate(row.completedAt) },
      { label: "Blocked Reason", render: (row) => short(row.blockedReason, 160) }
    ], wouldSyncTasks, "No task status sync predicted.")),
    section("Ready Tasks", renderTable([
      { label: "Task", key: "task_id" },
      { label: "Status", render: (row) => chip(row.status || "-") },
      { label: "Owner", render: (row) => `${present(row.owner_agent)} / ${present(row.runtime)}:${present(row.agent_id)}` },
      { label: "Phase", key: "phase" },
      { label: "Summary", render: (row) => short(row.summary, 140) }
    ], readyTasks, "No ready tasks.")),
    section("Blocked Tasks", renderTable([
      { label: "Task", key: "task_id" },
      { label: "Status", render: (row) => chip(row.status || "-") },
      { label: "Owner", render: (row) => `${present(row.owner_agent)} / ${present(row.runtime)}:${present(row.agent_id)}` },
      { label: "Phase", key: "phase" },
      { label: "Reason", render: (row) => short(row.blocked_reason || row.summary, 160) }
    ], blockedTasks, "No blocked tasks.")),
    section("Control Loop Effects", renderKeyValues([
      { label: "Would Drain", value: wouldDrainRuntimes.length ? wouldDrainRuntimes.join(", ") : "disabled (drain=false)" },
      { label: "Would Cat Claw Report", value: wouldReport ? `${wouldReport.dispatchType || "report"} / ${wouldReport.priority || "high"}` : "no" },
      { label: "Max Cycles", value: preview.maxCycles || "-" },
      { label: "Operation", value: response.operationId || "-" }
    ])),
    limitations.length ? section("Limitations", h("ul", { className: "compact-list" }, limitations.map((item) => h("li", {}, item)))) : null,
    section("Raw Preview", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(response)
    ]))
  ]);
  setDetailBody(body);
}

async function previewSupervise(workflowId = state.selectedWorkflowId) {
  if (!workflowId) return;
  setActionStatus("Preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "workflow.supervise.preview",
        actor: "workflow-console",
        reason: "console preview",
        payload: {
          workflowId,
          autoDispatch: true,
          drain: false,
          autoReport: true
        }
      })
    });
    recordActionResult(result, { action: "workflow.supervise.preview", workflowId, label: "Preview Supervise" });
    state.lastPayload = result;
    renderSupervisePreview(result);
    setActionStatus(result?.ok === false ? "Preview failed" : "Preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "workflow.supervise.preview", workflowId, label: "Preview Supervise" });
    setActionStatus("Preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "workflow.supervise.preview", workflowId }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function previewIntervention(action, extraPayload = {}, workflowId = state.selectedWorkflowId) {
  if (!workflowId) return;
  setActionStatus("Intervention preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action,
        actor: "workflow-console",
        reason: "console controlled intervention preview",
        payload: {
          workflowId,
          ...extraPayload
        }
      })
    });
    recordActionResult(result, { action, workflowId, label: "Intervention Preview" });
    state.lastPayload = result;
    renderInterventionPreview(result);
    setActionStatus(result?.ok === false ? "Preview failed" : "Preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action, workflowId, label: "Intervention Preview" });
    setActionStatus("Preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action, workflowId }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function previewTelegramOutboxDelivery(outboxId = "") {
  if (!outboxId) return;
  setActionStatus("Telegram delivery preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "telegram.outbox.delivery.preview",
        actor: "workflow-console",
        reason: "console telegram outbox delivery preview",
        payload: { outboxId }
      })
    });
    recordActionResult(result, { action: "telegram.outbox.delivery.preview", label: "Telegram Delivery Preview" });
    state.lastPayload = result;
    const preview = result.result || {};
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "telegram.outbox.delivery.preview" }),
      section("Telegram Delivery Preview", renderKeyValues([
        { label: "Status", value: result.ok === false ? "failed" : "ok" },
        { label: "Outbox", value: preview.outboxId || outboxId },
        { label: "Eligible", value: preview.eligible ? "yes" : "no" },
        { label: "Current Status", value: preview.status || "-" },
        { label: "Target", value: `${present(preview.targetKind)}:${present(preview.targetRef)}` },
        { label: "Account", value: preview.account || "-" },
        { label: "Chunks", value: preview.chunkCount ?? "-" },
        { label: "Pending Chunks", value: preview.pendingChunkCount ?? "-" },
        { label: "Inline Buttons", value: preview.buttonSummary?.buttonCount ?? 0 },
        { label: "Would Send", value: preview.wouldSendTelegram ? "yes" : "no" },
        { label: "Would Update", value: preview.wouldUpdate?.telegramOutboxStatus || "-" }
      ])),
      section("Delivery Path", jsonBlock(preview.deliveryPath || {})),
      section("Execution Policy", jsonBlock(preview.executionPolicy || {})),
      section("Receipt Policy", jsonBlock(preview.receiptPolicy || {})),
      section("Violations", jsonBlock(preview.violations || [])),
      section("Governance Violations", jsonBlock(preview.governanceViolations || [])),
      section("Warnings", jsonBlock(preview.warnings || [])),
      section("Raw Preview", h("details", { open: true }, [
        h("summary", {}, "JSON"),
        jsonBlock(result)
      ]))
    ]));
    setActionStatus(result?.ok === false ? "Delivery preview failed" : "Delivery preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "telegram.outbox.delivery.preview", label: "Telegram Delivery Preview" });
    setActionStatus("Delivery preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "telegram.outbox.delivery.preview" }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function previewTelegramOutboxRequeue(outboxId = "") {
  if (!outboxId) return;
  setActionStatus("Telegram requeue preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "telegram.outbox.requeue.preview",
        actor: "workflow-console",
        reason: "console telegram outbox requeue preview",
        payload: { outboxId }
      })
    });
    recordActionResult(result, { action: "telegram.outbox.requeue.preview", label: "Telegram Requeue Preview" });
    state.lastPayload = result;
    const preview = result.result || {};
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "telegram.outbox.requeue.preview" }),
      section("Telegram Requeue Preview", renderKeyValues([
        { label: "Status", value: result.ok === false ? "failed" : "ok" },
        { label: "Outbox", value: preview.outboxId || outboxId },
        { label: "Current Status", value: preview.status || "-" },
        { label: "Strategy", value: preview.strategy || "-" },
        { label: "Requeue Eligible", value: preview.requeueEligible ? "yes" : "no" },
        { label: "Delivery Eligible", value: preview.deliveryExecutionEligible ? "yes" : "no" },
        { label: "Governance Ready", value: preview.governanceReady ? "yes" : "no" },
        { label: "Would Requeue", value: preview.wouldRequeue ? "yes" : "no" },
        { label: "Would Resend", value: preview.wouldResendTelegram ? "yes" : "no" },
        { label: "Recommended", value: preview.recommendedNextAction || "-" }
      ])),
      section("Execution Package", h("div", { className: "copy-block" }, [
        h("p", {}, "Preview a Chinese Cat Claw / Human Gate execution package. This does not requeue, send Telegram, or create Human Gate records."),
        h("button", { onClick: () => previewTelegramOutboxRequeuePackage(outboxId) }, "Preview Execution Package")
      ])),
      section("Current Delivery", jsonBlock(preview.currentDelivery || {})),
      section("Requeue Policy", jsonBlock(preview.requeuePolicy || {})),
      section("Execution Policy", jsonBlock(preview.executionPolicy || {})),
      section("Would Update", jsonBlock(preview.wouldUpdate || {})),
      section("Violations", jsonBlock(preview.violations || [])),
      section("Governance Violations", jsonBlock(preview.governanceViolations || [])),
      section("Warnings", jsonBlock(preview.warnings || [])),
      section("Raw Preview", h("details", { open: true }, [
        h("summary", {}, "JSON"),
        jsonBlock(result)
      ]))
    ]));
    setActionStatus(result?.ok === false ? "Requeue preview failed" : "Requeue preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "telegram.outbox.requeue.preview", label: "Telegram Requeue Preview" });
    setActionStatus("Requeue preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "telegram.outbox.requeue.preview" }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function previewTelegramOutboxRequeuePackage(outboxId = "") {
  if (!outboxId) return;
  setActionStatus("Requeue execution package preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "telegram.outbox.requeue.execution_package.preview",
        actor: "workflow-console",
        reason: "console telegram outbox requeue execution package preview",
        payload: { outboxId }
      })
    });
    recordActionResult(result, { action: "telegram.outbox.requeue.execution_package.preview", label: "Requeue Execution Package Preview" });
    state.lastPayload = result;
    const preview = result.result || {};
    const pkg = preview.package || {};
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "telegram.outbox.requeue.execution_package.preview" }),
      section("Requeue Execution Package", renderKeyValues([
        { label: "Status", value: result.ok === false ? "failed" : "ok" },
        { label: "Outbox", value: preview.outboxId || outboxId },
        { label: "Human Gate", value: preview.humanGateId || "-" },
        { label: "Strategy", value: preview.strategyZh || preview.strategy || "-" },
        { label: "Cat Claw Review", value: preview.readyForCatClawReview ? "ready" : "not ready" },
        { label: "Execution Request", value: preview.readyForExecutionRequest ? "ready" : "not ready" },
        { label: "Future Action", value: preview.futureExecutionAction || "-" },
        { label: "Writes", value: preview.didWrite ? "yes" : "no" },
        { label: "Telegram Sent", value: preview.didSendTelegram ? "yes" : "no" }
      ])),
      section("Chinese Summary", h("div", { className: "copy-block" }, (pkg.summaryZh || []).map((line) => h("p", {}, line)))),
      section("Preservation Boundary", h("ul", { className: "compact-list" }, (pkg.preservationZh || []).map((line) => h("li", {}, line)))),
      section("Missing Evidence", (pkg.missingEvidenceZh || []).length
        ? h("ul", { className: "compact-list" }, pkg.missingEvidenceZh.map((line) => h("li", {}, line)))
        : h("p", { className: "muted" }, "No missing evidence reported by preview.")),
      section("A/B/C Options", renderTable([
        { label: "Option", key: "optionId" },
        { label: "Title", key: "title" },
        { label: "Button", render: (row) => `${row.buttonLabel || "-"} / ${row.buttonStyle || "-"}` },
        { label: "Recommendation", key: "recommendation" },
        { label: "Boundary", key: "executionBoundary" },
        { label: "Content", render: (row) => short(row.content, 220) }
      ], pkg.options || [], "No options in package.")),
      section("Controls", renderTable([
        { label: "Control", key: "title" },
        { label: "Button", render: (row) => `${row.buttonLabel || "-"} / ${row.buttonStyle || "-"}` },
        { label: "Content", render: (row) => short(row.content, 220) }
      ], pkg.controls || [], "No controls in package.")),
      section("Package Markdown", h("pre", { className: "json" }, pkg.packageTextZh || "")),
      section("Raw Preview", h("details", { open: true }, [
        h("summary", {}, "JSON"),
        jsonBlock(result)
      ]))
    ]));
    setActionStatus(result?.ok === false ? "Execution package preview failed" : "Execution package preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "telegram.outbox.requeue.execution_package.preview", label: "Requeue Execution Package Preview" });
    setActionStatus("Execution package preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "telegram.outbox.requeue.execution_package.preview" }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function previewIncidentCloseout(action, incidentId = "", extraPayload = {}, workflowId = state.selectedWorkflowId) {
  if (!workflowId) return;
  setActionStatus("Closeout package preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action,
        actor: "workflow-console",
        reason: "console incident closeout package preview",
        payload: {
          workflowId,
          incidentId,
          ...extraPayload
        }
      })
    });
    recordActionResult(result, { action, workflowId, label: "Incident Closeout Preview" });
    state.lastPayload = result;
    renderIncidentCloseoutPreview(result);
    setActionStatus(result?.ok === false ? "Closeout preview failed" : "Closeout preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action, workflowId, label: "Incident Closeout Preview" });
    setActionStatus("Closeout preview failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action, workflowId }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

async function executeCloseoutHumanGateRequest(preview, fields) {
  const humanGateEvidence = fields.humanGateEvidence.value.trim();
  const catClawAuditId = fields.catClawAuditId.value.trim();
  const operatorReason = fields.operatorReason.value.trim();
  if (!humanGateEvidence || !catClawAuditId || !operatorReason) {
    setActionStatus("Human Gate evidence, Cat Claw audit, and reason are required", "warning");
    return;
  }
  setActionStatus("Creating Human Gate request...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "workflow.incident.closeout.human_gate_request",
        actor: "workflow-console",
        reason: operatorReason,
        payload: {
          workflowId: preview.workflowId || state.selectedWorkflowId,
          incidentId: preview.incidentId || "",
          closeoutArtifactId: preview.closeoutArtifactId || "",
          humanGateEvidence,
          catClawAuditId,
          operatorReason
        }
      })
    });
    recordActionResult(result, { action: "workflow.incident.closeout.human_gate_request", workflowId: preview.workflowId || state.selectedWorkflowId, label: "Create Human Gate Request" });
    state.lastPayload = result;
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "workflow.incident.closeout.human_gate_request", workflowId: preview.workflowId || state.selectedWorkflowId }),
      section("Human Gate Request Result", renderKeyValues([
        { label: "Status", value: result.ok === false ? "failed" : "ok" },
        { label: "Operation", value: result.operationId || "-" },
        { label: "Human Gate", value: result.result?.humanGateId || "-" },
        { label: "Outbox", value: result.result?.telegramOutboxId || "-" },
        { label: "Boundary", value: result.result?.writeBoundary || "-" },
        { label: "Delivered", value: result.result?.didSendTelegram ? "yes" : "no" }
      ])),
      section("Raw Result", h("details", { open: true }, [
        h("summary", {}, "JSON"),
        jsonBlock(result)
      ]))
    ]));
    setActionStatus(result.ok === false ? "Human Gate request failed" : "Human Gate request created", result.ok === false ? "critical" : "ok");
  } catch (error) {
    const result = actionRequestFailure(error, { action: "workflow.incident.closeout.human_gate_request", workflowId: preview.workflowId || state.selectedWorkflowId, label: "Create Human Gate Request" });
    setActionStatus("Human Gate request failed", "critical");
    setDetailBody(h("div", { className: "stack" }, [
      renderActionResultInspector(result, { action: "workflow.incident.closeout.human_gate_request", workflowId: preview.workflowId || state.selectedWorkflowId }),
      section("Request Error", h("div", { className: "error" }, error.message))
    ]));
  }
}

document.querySelectorAll(".view-tabs button[data-console-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    const previousConsoleView = state.consoleView;
    state.consoleView = button.dataset.consoleView;
    if (previousConsoleView === "agent-board" && state.consoleView !== "agent-board") clearAgentBoardFilters();
    if (state.consoleView === "agent-board" && previousConsoleView !== "agent-board") clearAgentBoardFilters();
    if (!["agent-board", "kanban"].includes(state.consoleView)) clearFocusState();
    if (["activity", "operations"].includes(state.consoleView)) {
      state.selectedWorkflowId = "";
      state.scopedActivity = false;
      state.detail = null;
    }
    setViewButtons();
    writeUrlState();
    if (state.consoleView === "workflows") {
      if (state.selectedWorkflowId) await loadDetail();
      else await loadWorkflows();
      return;
    }
    await loadGlobalView();
  });
});

document.querySelectorAll(".view-tabs button[data-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.consoleView = "workflows";
    state.scopedActivity = false;
    clearFocusState();
    state.view = button.dataset.view;
    state.selectedWorkflowId = "";
    state.detail = null;
    writeUrlState();
    await loadWorkflows();
  });
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", async () => {
    state.tab = button.dataset.tab;
    setTabButtons();
    writeUrlState();
    await loadDetail();
  });
});

$("#globalSearchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.searchQuery = $("#globalSearchInput").value.trim();
  state.consoleView = "search";
  clearFocusState();
  setViewButtons();
  writeUrlState();
  await loadGlobalView();
});

$("#refreshButton").addEventListener("click", async () => {
  await refreshConsole();
});
$("#liveToggleButton").addEventListener("click", () => {
  setLiveRefreshEnabled(!state.liveRefreshEnabled);
});
$("#liveIntervalSelect").addEventListener("change", () => {
  state.liveRefreshIntervalMs = Number($("#liveIntervalSelect").value || 15000);
  scheduleLiveRefresh();
});
$("#previewButton").addEventListener("click", previewSupervise);
$("#commandPaletteButton").addEventListener("click", openCommandPalette);
document.addEventListener("keydown", (event) => {
  const paletteOpen = Boolean(document.querySelector(".command-palette"));
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommandPalette();
    return;
  }
  if (event.key === "Escape") {
    if (paletteOpen) closeCommandPalette();
    else closeDrawer();
  } else if (event.key === "Tab") {
    if (paletteOpen) trapPaletteFocus(event);
    else trapDrawerFocus(event);
  }
});
window.addEventListener("popstate", async () => {
  closeDrawer();
  closeCommandPalette();
  suppressUrlWrite = true;
  try {
    readUrlState();
    setViewButtons();
    setTabButtons();
    await loadWorkflows();
  } finally {
    suppressUrlWrite = false;
  }
});

readUrlState();
setViewButtons();
setTabButtons();
updateLiveControls();
updateContextTrail();
try {
  await loadConfig();
  await loadWorkflows();
} catch (error) {
  setActionStatus("Startup error", "critical");
  setDetailBody(h("div", { className: "error" }, error.message));
}
