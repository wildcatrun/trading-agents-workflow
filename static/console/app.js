const state = {
  view: "active",
  selectedWorkflowId: "",
  tab: "overview",
  workflows: [],
  detail: null,
  lastPayload: null,
  detailSeq: 0
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
  pending: "warning",
  queued: "warning",
  waiting_human: "warning",
  route_registered: "warning",
  runtime_dispatched: "warning",
  outbound_queued: "warning",
  paused: "warning",
  blocked: "critical",
  failed: "critical",
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
    button.classList.toggle("active", button.dataset.view === state.view);
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
  setActionStatus("Loaded", "ok");
  if (state.selectedWorkflowId) await loadDetail();
  else setDetailBody(emptyState("Select a workflow from the left queue."));
}

async function selectWorkflow(workflowId) {
  if (state.selectedWorkflowId === workflowId) return;
  state.selectedWorkflowId = workflowId;
  state.detail = null;
  renderWorkflowList();
  renderDetailHeader();
  await loadDetail();
}

function detailPath(workflowId, tab) {
  const encoded = encodeURIComponent(workflowId);
  if (tab === "overview" || tab === "raw") return `/api/workflows/${encoded}`;
  if (tab === "operations") return "/api/operations/summary";
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
  if (state.tab === "tasks") return renderTasks(data);
  if (state.tab === "dispatches") return renderDispatches(data);
  if (state.tab === "runtime-runs") return renderRuntimeRuns(data);
  if (state.tab === "message-flows") return renderMessageFlows(data);
  if (state.tab === "timeline") return renderTimeline(data);
  if (state.tab === "human-gates") return renderHumanGates(data);
  if (state.tab === "outbox") return renderOutbox(data);
  if (state.tab === "operations") return renderOperations(data);
  if (state.tab === "evidence") return renderEvidence(data);
  return setDetailBody(jsonBlock(data));
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

function renderOutbox(data) {
  setDetailBody(renderTable([
    { label: "Status", render: (row) => chip(row.status) },
    { label: "Outbox", key: "outboxId" },
    { label: "Target", render: (row) => `${present(row.targetKind)}:${present(row.targetRef)}` },
    { label: "Type", key: "messageType" },
    { label: "Preview", render: (row) => short(row.textPreview, 130) },
    { label: "Updated", render: (row) => formatDate(row.updatedAt) }
  ], data.outbox || [], "No outbox messages."));
}

function renderOperations(data) {
  const readiness = data.readiness || {};
  const body = h("div", { className: "stack" }, [
    section("Readiness", readiness ? h("div", { className: "copy-block" }, [
      chip(readiness.status || "unknown"),
      h("p", {}, `Checked: ${formatDate(readiness.checkedAt)}`),
      jsonBlock(readiness.findings || [])
    ]) : emptyState("No readiness snapshot.")),
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
    state.tab = "raw";
    setTabButtons();
    state.lastPayload = result;
    setDetailBody(jsonBlock(result));
    setActionStatus("Preview OK", "ok");
  } catch (error) {
    setActionStatus("Preview failed", "critical");
    setDetailBody(h("div", { className: "error" }, error.message));
  }
}

document.querySelectorAll(".view-tabs button").forEach((button) => {
  button.addEventListener("click", async () => {
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
