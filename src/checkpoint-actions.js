import {
  safeId,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";
import {
  fileExistsSync,
  workflowPaths
} from "./workflow/paths.js";

export const CHECKPOINT_ACTION_HANDLER_NAMES = {
  "workflow.checkpoint": "workflowCheckpoint",
  "workflow.checkpoint.legacy_export": "workflowCheckpointLegacyExport",
  "workflow.checkpoint.legacy_alias": "workflowCheckpointLegacyAlias"
};

const LEGACY_CHECKPOINT_SOURCE_CLASSES = new Set([
  "legacy_compat_checkpoint",
  "legacy_checkpoint",
  "legacy",
  "legacy_supervise_escape_hatch_checkpoint",
  "human_gate_archive_legacy_fallback_checkpoint"
]);

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`checkpoint action dependency missing: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function workflowCheckpointSourceClass(input = {}) {
  return String(input.sourceClass || input.source_class || "").trim().replace(/-/g, "_");
}

function workflowCheckpointSourceRequiredDiagnostic(rootDir, input = {}) {
  const requestedAction = String(input.requestedAction || input.action || "workflow.checkpoint").trim();
  const sourceClass = workflowCheckpointSourceClass(input);
  return {
    schemaVersion: "workflow_checkpoint_source_required_result.v1",
    action: "workflow.checkpoint",
    requestedAction,
    sourceClass,
    status: "blocked",
    allowed: false,
    mutating: false,
    writeBlocked: true,
    reason: sourceClass ? "unsupported_legacy_checkpoint_source_class" : "legacy_checkpoint_source_class_required",
    message: sourceClass
      ? "workflow.checkpoint only accepts explicit legacy compatibility source classes."
      : "workflow.checkpoint requires an explicit legacy compatibility source class.",
    acceptedSourceClasses: [...LEGACY_CHECKPOINT_SOURCE_CLASSES].sort(),
    replacements: [
      {
        sourceClass: "v2_plan_checkpoint",
        action: "workflow.supervisor.checkpoint",
        cli: "workflow-checkpoint --workflow <id> --source-class v2_plan_checkpoint --plan <id>"
      },
      {
        sourceClass: "human_gate_archive_checkpoint",
        action: "workflow.archive.checkpoint",
        cli: "workflow-checkpoint --workflow <id> --source-class human_gate_archive_checkpoint --plan <id> --human-gate <id> --button <id>"
      },
      {
        sourceClass: "legacy_compat_checkpoint",
        action: "workflow.checkpoint.legacy_export",
        cli: "workflow-checkpoint --workflow <id> --source-class legacy_compat_checkpoint"
      }
    ],
    didWriteCheckpoint: false,
    didWriteArtifact: false,
    didUpdateArtifactIndex: false,
    didInitializeLayout: false,
    rootDir: String(rootDir || "")
  };
}

function workflowCheckpointFrozenDiagnostic(rootDir, input = {}) {
  const requestedAction = String(input.requestedAction || input.action || "workflow.checkpoint").trim();
  const sourceClass = workflowCheckpointSourceClass(input);
  return {
    schemaVersion: "workflow_checkpoint_frozen_result.v1",
    action: "workflow.checkpoint",
    requestedAction,
    sourceClass,
    status: "blocked",
    allowed: false,
    mutating: false,
    writeBlocked: true,
    reason: "legacy_checkpoint_writer_frozen",
    message: "workflow.checkpoint mutating writer is frozen; use v2/shared checkpoint writers or workflow.checkpoint.legacy_export for read-only legacy recovery inspection.",
    replacements: [
      {
        sourceClass: "v2_plan_checkpoint",
        action: "workflow.supervisor.checkpoint",
        cli: "workflow-checkpoint --workflow <id> --source-class v2_plan_checkpoint --plan <id>"
      },
      {
        sourceClass: "human_gate_archive_checkpoint",
        action: "workflow.archive.checkpoint",
        cli: "workflow-checkpoint --workflow <id> --source-class human_gate_archive_checkpoint --plan <id> --human-gate <id> --button <id>"
      },
      {
        sourceClass: "legacy_compat_checkpoint",
        action: "workflow.checkpoint.legacy_export",
        cli: "workflow-checkpoint --workflow <id> --source-class legacy_compat_checkpoint"
      }
    ],
    didWriteCheckpoint: false,
    didWriteArtifact: false,
    didUpdateArtifactIndex: false,
    didInitializeLayout: false,
    rootDir: String(rootDir || "")
  };
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

async function workflowCheckpointCore(paths, input = {}, helpers = {}) {
  const writeJsonArtifact = requireContextFunction(helpers, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(helpers, "writeTextArtifact");
  const record = await collectWorkflowCheckpointRecord(paths, input, helpers);
  const jsonRelPath = await writeJsonArtifact(paths.root, paths.checkpointsDir, record.checkpointId, record);
  const markdownRelPath = await writeTextArtifact(paths.root, paths.checkpointsDir, record.checkpointId, "md", renderWorkflowCheckpointMarkdown(record));
  await sqlite(paths.dbFile, `
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES (${sqlValue(record.checkpointId)}, ${sqlValue(record.workflowId)}, ${sqlValue(record.status)}, ${sqlValue(record.phase)}, ${sqlValue(record.decision)}, ${sqlValue(record.summary)}, ${sqlValue(JSON.stringify(record.resumePayload))}, ${sqlValue(JSON.stringify(record.activeTasks))}, ${sqlValue(JSON.stringify(record.blockedTasks))}, ${sqlValue(JSON.stringify(record.artifactRefs))}, ${sqlValue(JSON.stringify(record.nextActions))}, ${sqlValue(JSON.stringify(record.contextBudget))}, ${sqlValue(markdownRelPath)}, ${sqlValue(record.createdBy)}, ${sqlValue(record.createdAt)})
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
VALUES (${sqlValue(record.checkpointId)}, NULL, ${sqlValue(record.workflowId)}, 'workflow_checkpoint', ${sqlValue(markdownRelPath)}, ${sqlValue(record.summary)}, ${sqlValue(record.createdBy)}, ${sqlValue(record.createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
  return {
    checkpointId: record.checkpointId,
    workflowId: record.workflowId,
    status: record.status,
    phase: record.phase,
    decision: record.decision,
    relativePath: markdownRelPath,
    jsonRelativePath: jsonRelPath,
    resumePayload: record.resumePayload,
    dbFile: paths.dbFile
  };
}

async function collectWorkflowCheckpointRecord(paths, input = {}, helpers = {}) {
  const pendingHumanGateCount = requireContextFunction(helpers, "pendingHumanGateCount");
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
ORDER BY CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created_at;`, { json: true });
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
  return record;
}

async function workflowCheckpointLegacyExportCore(rootDir, input = {}, helpers = {}) {
  const requestedAction = String(input.requestedAction || input.action || "workflow.checkpoint.legacy_export").trim();
  const sourceClass = workflowCheckpointSourceClass(input) || "legacy_compat_checkpoint";
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  const paths = workflowPaths(rootDir, input);
  if (!fileExistsSync(paths.dbFile)) {
    return {
      schemaVersion: "workflow_checkpoint_legacy_export_result.v1",
      action: "workflow.checkpoint.legacy_export",
      requestedAction,
      sourceClass,
      status: "missing_db",
      allowed: true,
      mutating: false,
      writeBlocked: true,
      reason: "workflow_state_db_missing",
      message: "legacy checkpoint export did not run because the workflow state DB does not exist.",
      workflowId,
      checkpointId: "",
      resumePayload: null,
      didWriteCheckpoint: false,
      didWriteArtifact: false,
      didUpdateArtifactIndex: false,
      didInitializeLayout: false,
      dbFile: paths.dbFile,
      rootDir: paths.root
    };
  }
  try {
    const record = await collectWorkflowCheckpointRecord(paths, input, helpers);
    return {
      schemaVersion: "workflow_checkpoint_legacy_export_result.v1",
      action: "workflow.checkpoint.legacy_export",
      requestedAction,
      sourceClass,
      status: "exported",
      allowed: true,
      mutating: false,
      writeBlocked: true,
      reason: "legacy_checkpoint_export_read_only",
      message: "legacy checkpoint recovery state was exported read-only; no checkpoint row or artifact was written.",
      workflowId: record.workflowId,
      checkpointId: "",
      legacyCheckpointId: record.checkpointId,
      resumePayload: record.resumePayload,
      activeTasks: record.activeTasks,
      blockedTasks: record.blockedTasks,
      artifactRefs: record.artifactRefs,
      nextActions: record.nextActions,
      contextBudget: record.contextBudget,
      record,
      didWriteCheckpoint: false,
      didWriteArtifact: false,
      didUpdateArtifactIndex: false,
      didInitializeLayout: false,
      dbFile: paths.dbFile,
      rootDir: paths.root
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/^workflow not found:/.test(message)) throw error;
    return {
      schemaVersion: "workflow_checkpoint_legacy_export_result.v1",
      action: "workflow.checkpoint.legacy_export",
      requestedAction,
      sourceClass,
      status: "missing_legacy_workflow",
      allowed: true,
      mutating: false,
      writeBlocked: true,
      reason: "legacy_workflow_not_found",
      message,
      workflowId,
      checkpointId: "",
      resumePayload: null,
      didWriteCheckpoint: false,
      didWriteArtifact: false,
      didUpdateArtifactIndex: false,
      didInitializeLayout: false,
      dbFile: paths.dbFile,
      rootDir: paths.root
    };
  }
}

export function createCheckpointActionRegistry(handlers = {}) {
  const entries = Object.entries(CHECKPOINT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing checkpoint action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runCheckpointAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createCheckpointActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const pendingHumanGateCount = requireContextFunction(context, "pendingHumanGateCount");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");

  async function workflowCheckpoint(rootDir, input = {}) {
    return workflowCheckpointFrozenDiagnostic(rootDir, input);
  }

  async function workflowCheckpointLegacyAlias(rootDir, input = {}) {
    const requestedAction = String(input.requestedAction || input.action || "").trim();
    return {
      schemaVersion: "workflow_checkpoint_legacy_alias_result.v1",
      action: "workflow.checkpoint.legacy_alias",
      requestedAction,
      status: "blocked",
      allowed: false,
      mutating: false,
      writeBlocked: true,
      reason: "ambiguous_context_checkpoint_alias_retired",
      message: "context checkpoint aliases are retired; use an explicit checkpoint source class instead.",
      replacements: [
        {
          sourceClass: "v2_plan_checkpoint",
          action: "workflow.supervisor.checkpoint",
          cli: "workflow-checkpoint --workflow <id> --source-class v2_plan_checkpoint --plan <id>"
        },
        {
          sourceClass: "human_gate_archive_checkpoint",
          action: "workflow.archive.checkpoint",
          cli: "workflow-checkpoint --workflow <id> --source-class human_gate_archive_checkpoint --plan <id> --human-gate <id> --button <id>"
        },
        {
          sourceClass: "legacy_compat_checkpoint",
          action: "workflow.checkpoint.legacy_export",
          cli: "workflow-checkpoint --workflow <id> --source-class legacy_compat_checkpoint"
        }
      ],
      didWriteCheckpoint: false,
      didWriteArtifact: false,
      didUpdateArtifactIndex: false,
      didInitializeLayout: false,
      rootDir: String(rootDir || "")
    };
  }

  async function workflowCheckpointLegacyExport(rootDir, input = {}) {
    return workflowCheckpointLegacyExportCore(rootDir, input, {
      pendingHumanGateCount
    });
  }

  return {
    workflowCheckpoint,
    workflowCheckpointLegacyExport,
    workflowCheckpointLegacyAlias
  };
}

export function workflowCheckpointAllowsLegacyWrite(input = {}) {
  return false;
}
