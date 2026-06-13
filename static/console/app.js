const state = {
  consoleView: "command-center",
  view: "active",
  selectedWorkflowId: "",
  tab: "overview",
  workflows: [],
  detail: null,
  lastPayload: null,
  detailSeq: 0,
  operationsFilters: {
    kind: "",
    severity: "",
    status: ""
  }
};

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
  return h("select", { value, onChange: (event) => onChange(event.target.value) }, options.map((option) => (
    h("option", { value: option.value }, option.label)
  )));
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
  $("#configLine").textContent = `${config.rootDir} | ${config.actionMode} | ${formatDate(config.serverTime)}`;
}

async function loadWorkflows() {
  setActionStatus("Loading workflows...", "neutral");
  const data = await api(`/api/workflows?view=${encodeURIComponent(state.view)}&limit=100`);
  state.workflows = data.workflows || [];
  if (!state.selectedWorkflowId && state.workflows[0]) {
    state.selectedWorkflowId = state.workflows[0].workflowId;
  }
  if (state.selectedWorkflowId && !state.workflows.some((item) => item.workflowId === state.selectedWorkflowId)) {
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
  state.consoleView = "workflows";
  if (state.selectedWorkflowId === workflowId && !wasGlobal) return;
  state.selectedWorkflowId = workflowId;
  state.detail = null;
  setViewButtons();
  renderWorkflowList();
  renderDetailHeader();
  await loadDetail();
}

async function loadGlobalView() {
  setViewButtons();
  $("#previewButton").disabled = true;
  const titleByView = {
    "command-center": "Command Center",
    "agent-board": "Agent Board",
    kanban: "Workflow Kanban"
  };
  const subtitleByView = {
    "command-center": "Global readiness, queue, runtime, communication and evidence summary.",
    "agent-board": "Registry-first agent runtime, dispatchability, current work and attention view.",
    kanban: "Derived read-only board over workflow, dispatch, runtime, message_flow, outbox and Human Gate state."
  };
  $("#detailTitle").textContent = titleByView[state.consoleView] || "Workflow Console";
  $("#detailSubtitle").textContent = subtitleByView[state.consoleView] || "";
  $("#detailSummary").replaceChildren();
  setDetailBody(emptyState("Loading control plane view..."));
  setActionStatus("Loading control plane view...", "neutral");
  const path = state.consoleView === "agent-board"
    ? "/api/agent-board"
    : state.consoleView === "kanban"
      ? "/api/kanban"
      : "/api/command-center";
  try {
    const data = await api(path);
    state.lastPayload = data;
    if (state.consoleView === "agent-board") renderAgentBoard(data);
    else if (state.consoleView === "kanban") renderKanban(data);
    else renderCommandCenter(data);
    setActionStatus("Ready", "ok");
  } catch (error) {
    setDetailBody(h("div", { className: "error" }, error.message));
    setActionStatus("Error", "critical");
  }
}

function detailPath(workflowId, tab) {
  const encoded = encodeURIComponent(workflowId);
  if (tab === "overview" || tab === "raw") return `/api/workflows/${encoded}`;
  if (tab === "evidence-desk") return `/api/workflows/${encoded}/evidence-desk`;
  if (tab === "operations") {
    const params = new URLSearchParams({ workflowId });
    if (state.operationsFilters.kind) params.set("deadLetterKind", state.operationsFilters.kind);
    if (state.operationsFilters.severity) params.set("deadLetterSeverity", state.operationsFilters.severity);
    if (state.operationsFilters.status) params.set("deadLetterStatus", state.operationsFilters.status);
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
    const data = await api(detailPath(workflowId, state.tab));
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
  const critical = data.attention?.critical || [];
  const warning = data.attention?.warning || [];
  setDetailBody(h("div", { className: "stack" }, [
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
  const summary = data.summary || {};
  setDetailBody(h("div", { className: "stack" }, [
    section("Agent Board Summary", h("div", { className: "quick-stats" }, [
      statCard("Agents", summary.agents || agents.length),
      statCard("Ready", summary.ready || 0),
      statCard("Working", summary.working || 0),
      statCard("Blocked", summary.blocked || 0),
      statCard("Attention", summary.attention || 0),
      statCard("Source", data.source || "-")
    ])),
    section("Agents", renderTable([
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
      { label: "Work", render: (row) => h("div", {}, [
        h("p", {}, `queued ${row.counts?.queued || 0} / working ${row.counts?.working || 0}`),
        h("p", { className: "muted" }, `failed ${row.counts?.failed || 0} / flows ${row.counts?.messageFlows || 0}`)
      ]) },
      { label: "Latest", render: (row) => h("div", {}, [
        h("p", {}, `${present(row.latest?.kind)} ${present(row.latest?.status)}`),
        h("p", { className: "muted" }, short(row.latest?.detail || row.latest?.dispatchId || row.latest?.flowId, 110)),
        h("p", { className: "muted" }, formatDate(row.latest?.lastEventAt))
      ]) },
      { label: "Flags", render: (row) => h("div", { className: "chip-list" }, (row.attentionFlags || []).map((flag) => chip(flag.key, flag.severity))) }
    ], agents, "No runtime agents registered.")),
    section("Raw", h("details", {}, [
      h("summary", {}, "JSON"),
      jsonBlock(data)
    ]))
  ]));
}

function renderKanban(data) {
  const columns = data.columns || [];
  setDetailBody(h("div", { className: "stack" }, [
    section("Kanban Summary", h("div", { className: "quick-stats" }, [
      statCard("Cards", data.summary?.cards || 0),
      statCard("Workflows", data.summary?.workflows || 0),
      statCard("Agents", data.summary?.agents || 0),
      statCard("Source", data.source || "-")
    ])),
    h("div", { className: "kanban-board" }, columns.map((column) => h("section", { className: "kanban-column" }, [
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
    (card.missingEvidence || []).length ? h("div", { className: "chip-list" }, card.missingEvidence.map((item) => chip(item, "warning"))) : null
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
        event.subtitle ? h("p", { className: "muted" }, event.subtitle) : null,
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
        event.subtitle ? h("p", { className: "muted" }, event.subtitle) : null,
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
    section("Controlled Intervention Previews", h("div", { className: "copy-block" }, [
      h("div", { className: "actions" }, [
        h("button", { onClick: () => previewIntervention("workflow.pause.preview") }, "Preview Pause"),
        h("button", { onClick: () => previewIntervention("workflow.resume.preview") }, "Preview Resume"),
        h("button", { onClick: () => previewIntervention("workflow.stop.preview") }, "Preview Stop"),
        h("button", { onClick: () => previewIntervention("workflow.rerun.phase.preview", { phaseKey: workflow.currentPhase || "" }) }, "Preview Rerun Phase")
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
          await loadDetail();
        }),
        optionSelect(state.operationsFilters.severity, severityOptions, async (value) => {
          state.operationsFilters.severity = value;
          await loadDetail();
        }),
        optionSelect(state.operationsFilters.status, statusOptions, async (value) => {
          state.operationsFilters.status = value;
          await loadDetail();
        }),
        h("button", { onClick: async () => {
          state.operationsFilters.kind = "";
          state.operationsFilters.severity = "";
          state.operationsFilters.status = "";
          await loadDetail();
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
    section("Create Linked Incident", h("div", { className: "form-grid" }, [
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
    ])),
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
        h("button", { onClick: () => loadDetail() }, "Back to Operations"),
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

function renderEvidencePack(data) {
  const manifest = data.manifest || {};
  const filename = `${present(data.workflowId || state.selectedWorkflowId, "workflow")}-evidence-pack.json`;
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

async function previewSupervise() {
  if (!state.selectedWorkflowId) return;
  setActionStatus("Preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action: "workflow.supervise.preview",
        actor: "workflow-console",
        reason: "console preview",
        payload: {
          workflowId: state.selectedWorkflowId,
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

async function previewIntervention(action, extraPayload = {}) {
  if (!state.selectedWorkflowId) return;
  setActionStatus("Intervention preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action,
        actor: "workflow-console",
        reason: "console controlled intervention preview",
        payload: {
          workflowId: state.selectedWorkflowId,
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

async function previewIncidentCloseout(action, incidentId = "", extraPayload = {}) {
  if (!state.selectedWorkflowId) return;
  setActionStatus("Closeout package preview running...", "neutral");
  try {
    const result = await api("/api/actions", {
      method: "POST",
      body: JSON.stringify({
        action,
        actor: "workflow-console",
        reason: "console incident closeout package preview",
        payload: {
          workflowId: state.selectedWorkflowId,
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
    setViewButtons();
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
    state.view = button.dataset.view;
    state.selectedWorkflowId = "";
    state.detail = null;
    await loadWorkflows();
  });
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", async () => {
    state.tab = button.dataset.tab;
    setTabButtons();
    await loadDetail();
  });
});

$("#refreshButton").addEventListener("click", async () => {
  await loadConfig();
  await loadWorkflows();
});
$("#previewButton").addEventListener("click", previewSupervise);

setViewButtons();
setTabButtons();
try {
  await loadConfig();
  await loadWorkflows();
} catch (error) {
  setActionStatus("Startup error", "critical");
  setDetailBody(h("div", { className: "error" }, error.message));
}
