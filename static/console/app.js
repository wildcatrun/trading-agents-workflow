const state = {
  view: "active",
  selectedWorkflowId: "",
  tab: "overview"
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || response.statusText);
  return data;
}

function setJson(value) {
  document.querySelector("#detailBody").textContent = JSON.stringify(value, null, 2);
}

function workflowLabel(item) {
  const counts = item.counts || {};
  return [
    `${item.status} | ${item.ownerAgent || ""}`,
    `tasks ${counts.tasks || 0}, blocked ${counts.blocked || 0}, human ${counts.pendingHumanGates || 0}`,
    item.currentDecision ? `decision ${item.currentDecision}` : ""
  ].filter(Boolean).join(" / ");
}

async function loadConfig() {
  const config = await api("/api/config");
  document.querySelector("#configLine").textContent = `${config.rootDir} | ${config.actionMode}`;
}

async function loadWorkflows() {
  const data = await api(`/api/workflows?view=${encodeURIComponent(state.view)}&limit=100`);
  const list = document.querySelector("#workflowList");
  list.innerHTML = "";
  for (const item of data.workflows || []) {
    const button = document.createElement("button");
    button.className = "workflow-item";
    const title = document.createElement("strong");
    title.textContent = item.workflowId;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = workflowLabel(item);
    button.append(title, meta);
    button.addEventListener("click", () => selectWorkflow(item.workflowId));
    list.appendChild(button);
  }
  if (!data.workflows?.length) {
    const empty = document.createElement("div");
    empty.className = "workflow-item meta";
    empty.textContent = "No workflows in this view.";
    list.appendChild(empty);
  }
}

async function selectWorkflow(workflowId) {
  state.selectedWorkflowId = workflowId;
  document.querySelector("#detailTitle").textContent = workflowId;
  document.querySelector("#previewButton").disabled = false;
  await loadDetail();
}

async function loadDetail() {
  const workflowId = state.selectedWorkflowId;
  if (!workflowId) return;
  if (state.tab === "overview") return setJson(await api(`/api/workflows/${encodeURIComponent(workflowId)}`));
  if (state.tab === "operations") return setJson(await api("/api/operations/summary"));
  return setJson(await api(`/api/workflows/${encodeURIComponent(workflowId)}/${state.tab}`));
}

async function previewSupervise() {
  if (!state.selectedWorkflowId) return;
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
  state.tab = "overview";
  document.querySelectorAll(".tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === "overview"));
  setJson(result);
}

document.querySelectorAll("nav button").forEach((button) => {
  button.addEventListener("click", async () => {
    state.view = button.dataset.view;
    document.querySelectorAll("nav button").forEach((item) => item.classList.toggle("active", item === button));
    await loadWorkflows();
  });
});

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", async () => {
    state.tab = button.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.toggle("active", item === button));
    await loadDetail();
  });
});

document.querySelector("#refreshButton").addEventListener("click", loadWorkflows);
document.querySelector("#previewButton").addEventListener("click", previewSupervise);

await loadConfig();
await loadWorkflows();
