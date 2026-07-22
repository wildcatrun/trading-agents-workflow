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

async function tableExists(dbFile, tableName) {
  const rows = await sqlite(dbFile, `SELECT name FROM sqlite_master WHERE type='table' AND name=${sqlValue(tableName)} LIMIT 1;`, { json: true });
  return Boolean(rows[0]);
}

function v2TaskGroupPackageFromRow(row = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  return {
    packageId: row.package_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    source: "workflow_v2_task_group_packages",
    sourceClass: "v2",
    sourceClassLabel: "v2 active",
    packageClass: "task_group",
    status: row.status || "",
    summary: redactSensitiveForPersistence(row.summary || ""),
    taskOwnerAgent: row.task_owner_agent || "",
    taskGroupAgents: redactSensitiveForPersistence(parseJsonValue(row.task_group_agents_json, [])),
    artifactRefs: redactSensitiveForPersistence(parseJsonValue(row.artifact_refs_json, [])),
    evidenceRefs: redactSensitiveForPersistence(parseJsonValue(row.evidence_refs_json, [])),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    payload: redactSensitiveForPersistence(payload)
  };
}

function v2HumanGatePackageFromRow(row = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  return {
    packageId: row.package_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    source: "workflow_v2_human_gate_packages",
    sourceClass: "v2",
    sourceClassLabel: "v2 active",
    packageClass: "human_gate",
    status: row.status || "",
    summary: redactSensitiveForPersistence(payload.summary || payload.title || ""),
    catBrainAgent: row.cat_brain_agent || "",
    catClawAgent: row.cat_claw_agent || "",
    options: redactSensitiveForPersistence(parseJsonValue(row.options_json, [])),
    requiredControls: redactSensitiveForPersistence(parseJsonValue(row.required_controls_json, [])),
    evidenceRefs: redactSensitiveForPersistence(parseJsonValue(row.evidence_refs_json, [])),
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    payload: redactSensitiveForPersistence(payload)
  };
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
    const workflowId = input.workflowId || input.workflow_id || "";
    const v2Where = [
      workflowId ? `workflow_id=${sqlValue(workflowId)}` : "1=1",
      input.status ? `status=${sqlValue(input.status)}` : "1=1"
    ].join(" AND ");
    const v2TaskGroupPackages = await tableExists(paths.dbFile, "workflow_v2_task_group_packages")
      ? (await sqlite(paths.dbFile, `
SELECT package_id, workflow_id, plan_id, task_owner_agent, task_group_agents_json, status, summary, artifact_refs_json, evidence_refs_json, payload_json, created_at, updated_at
FROM workflow_v2_task_group_packages
WHERE ${v2Where}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true })).map(v2TaskGroupPackageFromRow)
      : [];
    const v2HumanGatePackages = await tableExists(paths.dbFile, "workflow_v2_human_gate_packages")
      ? (await sqlite(paths.dbFile, `
SELECT package_id, workflow_id, plan_id, cat_brain_agent, cat_claw_agent, status, options_json, required_controls_json, evidence_refs_json, payload_json, created_at, updated_at
FROM workflow_v2_human_gate_packages
WHERE ${v2Where}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true })).map(v2HumanGatePackageFromRow)
      : [];
    const v2Packages = [...v2TaskGroupPackages, ...v2HumanGatePackages]
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
      .slice(0, limit);
    const taskLaunches = rows.map((row) => {
      const payload = parseJsonValue(row.payload_json, {});
      return {
        draftId: row.object_id,
        status: row.status,
        workflowId: row.parent_object_id || payload.workflowId || "",
        subject: redactSensitiveForPersistence(payload.subject || ""),
        objective: redactSensitiveForPersistence(payload.objective || ""),
        source: "workflow_task_launch_package",
        sourceClass: "v1",
        sourceClassLabel: "v1 archived/compat",
        compatibilityStatus: "legacy_read_only",
        sourceAgent: row.source_agent || "",
        path: redactSensitiveForPersistence(row.path || ""),
        artifacts: redactSensitiveForPersistence(payload.artifactRefs || {}),
        roles: redactSensitiveForPersistence(payload.roles || {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        payload: redactSensitiveForPersistence(payload)
      };
    });
    return {
      count: rows.length,
      summary: {
        legacyTaskLaunchCount: taskLaunches.length,
        v2TaskGroupPackageCount: v2TaskGroupPackages.length,
        v2HumanGatePackageCount: v2HumanGatePackages.length,
        v2PackageCount: v2Packages.length,
        packageCount: taskLaunches.length + v2Packages.length
      },
      packages: [...v2Packages, ...taskLaunches],
      v2Packages,
      taskLaunches,
      dbFile: paths.dbFile
    };
  }

  return {
    workflowTaskLaunchList
  };
}
