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
  config: null,
  operationsFilters: {
    kind: "",
    severity: "",
    status: ""
  }
};

const CONSOLE_VIEWS = new Set(["command-center", "agent-board", "kanban", "evidence-workspace", "operations", "workflows", "search"]);
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
const SEVERITY_RANK = {
  critical: 4,
  warning: 3,
  ok: 2,
  neutral: 1,
  info: 1
};

let suppressUrlWrite = false;

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

function section(title, body) {
  return h("section", { className: "content-section" }, [
    h("div", { className: "section-head" }, h("h3", {}, title)),
    body
  ]);
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
  state.tab = params.get("tab") || "overview";
  state.searchQuery = params.get("q") || "";
  state.workbenchFilter = normalizeChoice(params.get("filter"), WORKBENCH_FILTERS.map((item) => item.id), "all");
  state.severityFilter = normalizeChoice(params.get("severity"), SEVERITY_FILTERS.map((item) => item.value), "all");
  state.sortMode = normalizeChoice(params.get("sort"), SORT_MODES.map((item) => item.value), "age_desc");
  state.focusAgentId = params.get("agent") || "";
  state.focusCardId = params.get("card") || "";
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
  if (["workflows", "evidence-workspace", "operations", "kanban"].includes(state.consoleView) && state.selectedWorkflowId) params.set("workflow", state.selectedWorkflowId);
  if (state.consoleView === "workflows" && state.tab !== "overview") params.set("tab", state.tab);
  if (state.consoleView === "search" && state.searchQuery) params.set("q", state.searchQuery);
  if (isWorkbenchView() && state.workbenchFilter !== "all") params.set("filter", state.workbenchFilter);
  if (isWorkbenchView() && state.severityFilter !== "all") params.set("severity", state.severityFilter);
  if (isWorkbenchView() && state.sortMode !== "age_desc") params.set("sort", state.sortMode);
  if (["agent-board", "kanban"].includes(state.consoleView) && state.focusAgentId) params.set("agent", state.focusAgentId);
  if (state.consoleView === "kanban" && state.focusCardId) params.set("card", state.focusCardId);
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

function sourceRefList(refs = []) {
  const list = refs.filter((ref) => ref?.id);
  if (!list.length) return emptyState("No source refs.");
  return h("div", { className: "source-ref-list" }, list.map((ref) => h("div", { className: "source-ref-row" }, [
    h("span", {}, `${present(ref.source)}.${present(ref.field)}`),
    h("code", {}, present(ref.id)),
    h("button", { type: "button", onClick: () => copyText(ref.id, "Ref") }, "Copy")
  ])));
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
      section("Source Refs", sourceRefList(agentSourceRefs(agent))),
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
      section("Source Refs", sourceRefList(kanbanSourceRefs(card))),
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
}

async function loadWorkflows() {
  setActionStatus("Loading workflows...", "neutral");
  const data = await api(`/api/workflows?view=${encodeURIComponent(state.view)}&limit=100`);
  state.workflows = data.workflows || [];
  if (!state.selectedWorkflowId && state.consoleView !== "operations" && state.workflows[0]) {
    state.selectedWorkflowId = state.workflows[0].workflowId;
  }
  if (state.consoleView === "workflows" && state.selectedWorkflowId && !state.workflows.some((item) => item.workflowId === state.selectedWorkflowId)) {
    state.selectedWorkflowId = state.workflows[0]?.workflowId || "";
    state.detail = null;
  }
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
    state.selectedWorkflowId = workflowId;
    state.detail = null;
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    return;
  }
  state.consoleView = "workflows";
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
  if (state.consoleView === "agent-board") renderAgentBoard(data);
  else if (state.consoleView === "kanban") renderKanban(data);
  else if (state.consoleView === "evidence-workspace") renderEvidenceWorkspace(data);
  else if (state.consoleView === "operations") renderOperations(data);
  else if (state.consoleView === "search") renderSearchResults(data);
  else renderCommandCenter(data);
}

async function loadGlobalView() {
  setViewButtons();
  writeUrlState();
  $("#previewButton").disabled = true;
  const titleByView = {
    "command-center": "Command Center",
    "agent-board": "Agent Board",
    kanban: "Workflow Kanban",
    "evidence-workspace": "Evidence Workspace",
    operations: "Operations",
    search: "Global Search"
  };
  const subtitleByView = {
    "command-center": "Global readiness, queue, runtime, communication and evidence summary.",
    "agent-board": "Registry-first agent runtime, dispatchability, current work and attention view.",
    kanban: "Derived read-only board over workflow, dispatch, runtime, message_flow, outbox and Human Gate state.",
    "evidence-workspace": "Workflow evidence package, incident closeout, Human Gate readiness and export surface.",
    operations: "Global operation audit, dead-letter evidence, queue pressure and governed preview surface.",
    search: "Search workflow, dispatch, agent, message_flow, artifact, Human Gate and incident anchors."
  };
  $("#detailTitle").textContent = titleByView[state.consoleView] || "Workflow Console";
  $("#detailSubtitle").textContent = subtitleByView[state.consoleView] || "";
  $("#detailSummary").replaceChildren();
  setDetailBody(emptyState("Loading control plane view..."));
  setActionStatus("Loading control plane view...", "neutral");
  const path = state.consoleView === "agent-board"
    ? "/api/agent-board"
    : state.consoleView === "kanban"
      ? `/api/kanban?${kanbanQueryParams().toString()}`
      : "/api/command-center";
  try {
    const data = state.consoleView === "evidence-workspace"
      ? await loadEvidenceWorkspacePayload()
      : state.consoleView === "operations"
        ? await loadOperationsPayload()
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
  if (state.selectedWorkflowId) params.set("workflowId", state.selectedWorkflowId);
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

function renderAgentBoard(data) {
  const agents = data.agents || [];
  const visibleAgents = applyWorkbench(agents);
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

function renderKanban(data) {
  const columns = data.columns || [];
  const filteredColumns = columns.map((column) => {
    const cards = applyWorkbench(column.cards || []);
    return { ...column, count: cards.length, cards };
  });
  const totalCards = columns.reduce((sum, column) => sum + ((column.cards || []).length), 0);
  const shownCards = filteredColumns.reduce((sum, column) => sum + ((column.cards || []).length), 0);
  setDetailBody(h("div", { className: "stack" }, [
    renderWorkbenchControls({ total: totalCards, shown: shownCards }),
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
  if (model.action === "telegram.outbox.delivery.preview") return { ...model, onClick: () => previewTelegramOutboxDelivery(model.outboxId) };
  if (model.action === "telegram.outbox.requeue.preview") return { ...model, onClick: () => previewTelegramOutboxRequeue(model.outboxId) };
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
    refs.length ? h("div", { className: "mini-counts" }, refs.slice(0, 6).map((ref) => h("span", {}, `${ref.source}.${ref.field}=${short(ref.id, 80)}`))) : null
  ]);
}

async function openSearchResult(result = {}) {
  const target = result.target || {};
  if (target.consoleView) return openCommandTarget(target);
  if (target.workflowId) return openWorkflowTab(target.workflowId, target.tab || "overview");
}

async function openCommandTarget(target = {}) {
  if (target.consoleView === "workflows" && target.workflowId) {
    await openWorkflowTab(target.workflowId, target.tab || "overview");
    return;
  }
  if (target.consoleView === "agent-board") {
    state.consoleView = "agent-board";
    state.selectedWorkflowId = "";
    state.detail = null;
    state.focusAgentId = target.agentId || "";
    state.focusCardId = "";
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    return;
  }
  if (target.consoleView === "kanban") {
    state.consoleView = "kanban";
    state.selectedWorkflowId = target.workflowId || "";
    state.detail = null;
    state.focusAgentId = target.agentId || "";
    state.focusCardId = target.cardId || "";
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    return;
  }
  if (target.consoleView === "evidence-workspace") {
    state.consoleView = "evidence-workspace";
    state.selectedWorkflowId = target.workflowId || "";
    state.detail = null;
    clearFocusState();
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
    return;
  }
  if (target.consoleView === "operations") {
    state.consoleView = "operations";
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
    return;
  }
  if (target.consoleView) {
    state.consoleView = target.consoleView;
    state.selectedWorkflowId = "";
    state.detail = null;
    if (!["agent-board", "kanban"].includes(state.consoleView)) clearFocusState();
    setViewButtons();
    writeUrlState();
    renderWorkflowList();
    renderDetailHeader();
    await loadGlobalView();
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
    refs.length ? h("div", { className: "mini-counts" }, refs.slice(0, 6).map((ref) => h("span", {}, `${ref.source}.${ref.field}=${short(ref.id, 80)}`))) : null
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
      statCard("Action Mode", "preview-only", "writes hidden unless server policy enables them")
    ])),
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
      jsonBlock(readiness.findings || [])
    ]) : emptyState("No readiness snapshot.")),
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
      { label: "Risk", render: (row) => chip(row.riskTier || "-", row.dryRun ? "neutral" : "warning") },
      { label: "Actor", key: "requestedBy" },
      { label: "Updated", render: (row) => formatDate(row.updatedAt) },
      { label: "Error", render: (row) => short(row.error, 140) }
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
    const options = await loadIncidentEvidenceOptions(data);
    state.lastPayload = { preview: result, evidenceOptions: options };
    renderDeadLetterIncidentPreview(result, data, options);
    setActionStatus(result.ok === false ? "Incident preview failed" : "Incident preview OK", result.ok === false ? "critical" : "ok");
  } catch (error) {
    setActionStatus("Incident preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
    state.lastPayload = result;
    setDetailBody(h("div", { className: "stack" }, [
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
    setActionStatus("Incident create failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
      section("Raw Preview", h("details", {}, [
        h("summary", {}, "JSON"),
        jsonBlock(response || {})
      ]))
    ]));
    return;
  }
  const wouldUpdate = preview.wouldUpdateWorkflow || {};
  setDetailBody(h("div", { className: "stack" }, [
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
  const readinessChecklist = readiness.checklist || [];
  const readinessStatus = (key) => readinessChecklist.find((item) => item.key === key)?.status || "";
  const pauseControlReady = readinessStatus("pause_control") === "pass";
  const terminateControlReady = readinessStatus("terminate_control") === "pass";
  const stopControlsReady = pauseControlReady && terminateControlReady;
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
      ])
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
    ])),
    section("Raw Workspace", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function renderEvidenceDesk(data) {
  const summary = data.summary || {};
  const missing = summary.missingEvidence || [];
  const readiness = data.readiness || {};
  const incident = data.incidentCloseout || {};
  const verification = data.verification || {};
  setDetailBody(h("div", { className: "stack" }, [
    section("Evidence Desk", h("div", { className: "quick-stats" }, [
      statCard("Status", data.status || "unknown", data.schemaVersion || ""),
      statCard("Missing", missing.length),
      statCard("Cat Claw Audit", summary.humanGateReadyForCatClawAudit ? "ready" : "not ready"),
      statCard("Human Gate", summary.humanGateReadyForSubmission ? "ready" : "not ready"),
      statCard("Receipts", summary.receiptPresent || 0, `${summary.receiptMissing || 0} missing`),
      statCard("Verification", summary.verificationResults || 0),
      statCard("Artifacts", summary.evidenceArtifacts || 0),
      statCard("Incidents", summary.incidents || 0)
    ])),
    section("Missing Evidence", missing.length
      ? h("div", { className: "chip-list" }, missing.map((item) => chip(item, "warning")))
      : emptyState("No missing evidence detected by the derived desk.")),
    section("Governed Preview Actions", renderEvidenceDeskPreviewActions(data)),
    section("Human Gate Readiness", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Check", render: (row) => h("div", {}, [
          h("strong", {}, row.label),
          h("p", { className: "muted" }, short(row.detail, 180))
        ]) },
        { label: "Severity", render: (row) => chip(row.severity, row.severity === "required" ? "critical" : "warning") },
        { label: "Refs", render: (row) => h("code", {}, present((row.refs || []).join(", "))) }
      ], readiness.checklist || [], "No readiness checklist."),
      h("div", { className: "quick-stats" }, [
        statCard("Records", readiness.summary?.recordCount || 0),
        statCard("Buttons", readiness.summary?.buttonCount || 0),
        statCard("Checkpoints", readiness.summary?.checkpointCount || 0),
        statCard("Artifacts", readiness.summary?.artifactCount || 0),
        statCard("Sent Outbox", readiness.summary?.sentOutboxCount || 0),
        statCard("Receipts", readiness.summary?.receiptPresentCount || 0)
      ])
    ])),
    section("Receipt Chain", renderTable([
      { label: "Status", render: (row) => chip(row.status) },
      { label: "Kind", key: "kind" },
      { label: "Receipt", render: (row) => h("div", {}, [
        h("strong", {}, row.receiptId),
        h("p", { className: "muted" }, short(row.title || row.summary, 120))
      ]) },
      { label: "Present", render: (row) => row.present ? chip("present", "ok") : chip("missing", "warning") },
      { label: "Chain", render: (row) => h("div", {}, [
        h("p", {}, `task ${present(row.taskId)} / dispatch ${present(row.dispatchId)}`),
        h("p", { className: "muted" }, `runtime ${present(row.runtimeRunId)} / outbox ${present(row.outboxId)}`)
      ]) },
      { label: "Updated", render: (row) => formatDate(row.updatedAt || row.createdAt) }
    ], (data.receipts?.receipts || []).slice(0, 80), "No receipt chain records.")),
    section("Verification", renderTable([
      { label: "Decision", render: (row) => chip(row.decision) },
      { label: "Type", key: "resultType" },
      { label: "Result", render: (row) => h("div", {}, [
        h("strong", {}, row.verificationId),
        h("p", { className: "muted" }, short(row.summary, 140))
      ]) },
      { label: "Reviewer", render: (row) => present(row.verifierAgent || row.refuterAgent || row.sourceAgent) },
      { label: "Created", render: (row) => formatDate(row.createdAt) }
    ], verification.results || [], "No verification results.")),
    section("Incidents / Closeout", h("div", { className: "content-grid" }, [
      renderTable([
        { label: "Status", render: (row) => chip(row.status) },
        { label: "Check", key: "label" },
        { label: "Detail", render: (row) => short(row.detail, 180) }
      ], incident.checklist || [], "No incident closeout checklist."),
      renderIncidentTimeline((incident.timeline || []).slice(0, 20))
    ])),
    section("Export", h("div", { className: "actions" }, [
      h("button", { onClick: () => downloadJson(`${data.workflowId || state.selectedWorkflowId}-evidence-desk.json`, data) }, "Download Desk JSON"),
      h("button", { onClick: () => loadWorkflowEvidencePack(data.workflowId || state.selectedWorkflowId) }, "Open Evidence Pack")
    ])),
    section("Raw", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
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
  const body = h("div", { className: "stack" }, [
    section("Evidence Pack Export", h("div", { className: "copy-block" }, [
      h("p", {}, `Schema: ${present(data.schemaVersion)}`),
      h("p", {}, `Generated: ${formatDate(data.generatedAt)}`),
      h("p", {}, `Mode: ${present(data.writeMode)}`),
      h("button", { onClick: () => downloadJson(filename, data) }, "Download JSON")
    ])),
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
    state.lastPayload = result;
    renderSupervisePreview(result);
    setActionStatus(result?.ok === false ? "Preview failed" : "Preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    setActionStatus("Preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
    state.lastPayload = result;
    renderInterventionPreview(result);
    setActionStatus(result?.ok === false ? "Preview failed" : "Preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    setActionStatus("Preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
    state.lastPayload = result;
    const preview = result.result || {};
    setDetailBody(h("div", { className: "stack" }, [
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
    setActionStatus("Delivery preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
    state.lastPayload = result;
    const preview = result.result || {};
    setDetailBody(h("div", { className: "stack" }, [
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
    setActionStatus("Requeue preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
    state.lastPayload = result;
    const preview = result.result || {};
    const pkg = preview.package || {};
    setDetailBody(h("div", { className: "stack" }, [
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
    setActionStatus("Execution package preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
    state.lastPayload = result;
    renderIncidentCloseoutPreview(result);
    setActionStatus(result?.ok === false ? "Closeout preview failed" : "Closeout preview OK", result?.ok === false ? "critical" : "ok");
  } catch (error) {
    setActionStatus("Closeout preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
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
    state.lastPayload = result;
    setDetailBody(h("div", { className: "stack" }, [
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
    setActionStatus("Human Gate request failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
  }
}

document.querySelectorAll(".view-tabs button[data-console-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    state.consoleView = button.dataset.consoleView;
    if (!["agent-board", "kanban"].includes(state.consoleView)) clearFocusState();
    if (state.consoleView === "operations") {
      state.selectedWorkflowId = "";
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
  await loadConfig();
  await loadWorkflows();
});
$("#previewButton").addEventListener("click", previewSupervise);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
  else if (event.key === "Tab") trapDrawerFocus(event);
});
window.addEventListener("popstate", async () => {
  closeDrawer();
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
try {
  await loadConfig();
  await loadWorkflows();
} catch (error) {
  setActionStatus("Startup error", "critical");
  setDetailBody(h("div", { className: "error" }, error.message));
}
