import {
  parseJsonValue,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const WORKFLOW_TASK_ACTION_HANDLER_NAMES = {
  "workflow.task.create": "workflowTaskCreate",
  "workflow.task.update": "workflowTaskUpdate",
  "workflow.task.list": "workflowTaskList",
  "workflow.tasks": "workflowTaskList"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow task action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`workflow task action dependency missing: ${name}`);
  return context[name];
}

export function createWorkflowTaskActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_TASK_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow task action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowTaskAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createWorkflowTaskActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const nowIso = requireContextFunction(context, "nowIso");
  const resolveRegisteredDispatchTarget = requireContextFunction(context, "resolveRegisteredDispatchTarget");
  const safeId = requireContextFunction(context, "safeId");
  const workflowRunUpsert = requireContextFunction(context, "workflowRunUpsert");
  const WORKFLOW_TASK_PRIORITIES = requireContextValue(context, "WORKFLOW_TASK_PRIORITIES");
  const WORKFLOW_TASK_STATUSES = requireContextValue(context, "WORKFLOW_TASK_STATUSES");

  async function workflowTaskCreate(rootDir, input = {}) {
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
    const ownerAgent = normalizeAgentId(input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "main");
    const agentId = normalizeAgentId(input.agentId || input.agent_id || ownerAgent);
    let runtime = String(input.runtime || input.platform || "").trim();
    if (!runtime) {
      try {
        runtime = (await resolveRegisteredDispatchTarget(paths, { agentId })).registry.platform;
      } catch {
        runtime = "";
      }
    }
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

  async function workflowTaskUpdate(rootDir, input = {}) {
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

  async function workflowTaskList(rootDir, input = {}) {
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
ORDER BY workflow_id, CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created_at
LIMIT ${limit};`, { json: true });
    return { count: rows.length, tasks: rows, dbFile: paths.dbFile };
  }

  return {
    workflowTaskCreate,
    workflowTaskUpdate,
    workflowTaskList
  };
}
