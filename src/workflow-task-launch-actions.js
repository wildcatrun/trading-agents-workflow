import {
  parseJsonValue,
  redactSensitiveForPersistence
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const WORKFLOW_TASK_LAUNCH_ACTION_HANDLER_NAMES = {
  "workflow.task.launch.list": "workflowTaskLaunchList"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow task launch action dependency missing: ${name}`);
  return value;
}

export function createWorkflowTaskLaunchActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_TASK_LAUNCH_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow task launch action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowTaskLaunchAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createWorkflowTaskLaunchActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");

  async function workflowTaskLaunchList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const filters = ["object_type='workflow_task_launch_package'"];
    if (input.workflowId || input.workflow_id) filters.push(`parent_object_id=${sqlValue(input.workflowId || input.workflow_id)}`);
    if (input.status) filters.push(`status=${sqlValue(input.status)}`);
    const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
    const rows = await sqlite(paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at
FROM protocol_objects
WHERE ${filters.join(" AND ")}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true });
    return {
      count: rows.length,
      taskLaunches: rows.map((row) => {
        const payload = parseJsonValue(row.payload_json, {});
        return {
          draftId: row.object_id,
          status: row.status,
          workflowId: row.parent_object_id || payload.workflowId || "",
          subject: payload.subject || "",
          objective: payload.objective || "",
          sourceAgent: row.source_agent || "",
          path: row.path || "",
          artifacts: payload.artifactRefs || {},
          roles: payload.roles || {},
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          payload: redactSensitiveForPersistence(payload)
        };
      }),
      dbFile: paths.dbFile
    };
  }

  return {
    workflowTaskLaunchList
  };
}
