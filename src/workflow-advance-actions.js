import {
  boolOption,
  parseJsonValue,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const WORKFLOW_ADVANCE_ACTION_HANDLER_NAMES = {
  "workflow.advance": "workflowAdvance",
  "workflow.advance.preview": "workflowAdvancePreview",
  "workflow.preview.advance": "workflowAdvancePreview"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow advance action dependency missing: ${name}`);
  return value;
}

export function createWorkflowAdvanceActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_ADVANCE_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow advance action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowAdvanceAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

function workflowAdvanceAnalysis(tasks, workflowHumanGates, input = {}) {
  const statusByTask = Object.fromEntries(tasks.map((task) => [task.task_id, task.status]));
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
  return { decision, blocked, inProgress, pending, taskHumanGates, pendingHumanGates, readyTasks, workflowHumanGates };
}

function applyWorkflowTaskSyncPlan(tasks, syncPlan = []) {
  if (!syncPlan.length) return tasks;
  const planByTask = new Map(syncPlan.map((item) => [item.taskId, item]));
  return tasks.map((task) => {
    const update = planByTask.get(task.task_id);
    if (!update) return task;
    return {
      ...task,
      status: update.status,
      actual_artifact_ref: update.actualArtifactRef || task.actual_artifact_ref || "",
      blocked_reason: update.blockedReason || task.blocked_reason || "",
      completed_at: update.completedAt || task.completed_at || ""
    };
  });
}

function workflowStatusAfterAdvance(workflowStatus, decision) {
  if (decision === "completed") return "completed";
  if (decision === "human_gate_pending") return "waiting_human";
  if (decision === "blocked") return "blocked";
  return workflowStatus;
}

function workflowAdvanceSummary(tasks, analysis, dispatchedCount = 0) {
  return {
    total: tasks.length,
    pending: Math.max(0, analysis.pending.length - dispatchedCount),
    ready: Math.max(0, analysis.readyTasks.length - dispatchedCount),
    inProgress: analysis.inProgress.length + dispatchedCount,
    done: tasks.filter((task) => task.status === "done").length,
    blocked: analysis.blocked.length,
    pendingHumanGates: analysis.pendingHumanGates,
    workflowHumanGates: analysis.workflowHumanGates,
    taskHumanGates: analysis.taskHumanGates.length
  };
}

export function createWorkflowAdvanceActionHandlers(context = {}) {
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const messageFlowForDispatch = requireContextFunction(context, "messageFlowForDispatch");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateCount = requireContextFunction(context, "pendingHumanGateCount");
  const workflowTaskUpdate = requireContextFunction(context, "workflowTaskUpdate");

  async function workflowTaskSyncPlanFromDispatches(paths, workflowId) {
    const dispatches = await sqlite(paths.dbFile, `
SELECT dispatch_id, meeting_id, workflow_id, status, runtime, agent_id, failure_type, last_error, payload_json, updated_at, completed_at, acked_at
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
  AND status IN ('acked','failed','cancelled')
ORDER BY updated_at;`, { json: true });
    const updates = [];
    for (const dispatch of dispatches) {
      const payload = parseJsonValue(dispatch.payload_json, {});
      const taskId = String(payload?.payload?.taskId || payload?.taskId || "").trim();
      if (!taskId) continue;
      const taskRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_tasks WHERE task_id=${sqlValue(taskId)} AND workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
      const task = taskRows[0];
      if (!task || ["done", "failed", "cancelled"].includes(task.status)) continue;
      const flow = dispatch.status === "acked" ? await messageFlowForDispatch(paths, dispatch) : null;
      const deliveryBlocked = flow
        && flow.return_policy !== "silent"
        && !(String(flow.status || "") === "telegram_sent" && Number(flow.delivery_receipt_present || 0) === 1);
      const completedAt = deliveryBlocked ? "" : (dispatch.completed_at || dispatch.acked_at || dispatch.updated_at || nowIso());
      const status = deliveryBlocked ? "blocked" : dispatch.status === "acked" ? "done" : dispatch.status === "cancelled" ? "cancelled" : "failed";
      const artifactRef = dispatch.status === "acked" && !deliveryBlocked
        ? `bridge/messages/${cleanFileSegment(dispatch.meeting_id)}.messages.jsonl#${dispatch.dispatch_id}`
        : task.actual_artifact_ref || "";
      const blockedReason = deliveryBlocked
        ? `message_flow_delivery_pending: ${flow.flow_id} status=${flow.status || "unknown"} outbox=${flow.outbox_id || ""}`
        : dispatch.status === "failed"
        ? `${dispatch.failure_type || "runtime_failed"}: ${String(dispatch.last_error || "").slice(0, 300)}`
        : task.blocked_reason || "";
      updates.push({
        taskId,
        dispatchId: dispatch.dispatch_id,
        status,
        runtime: dispatch.runtime,
        agentId: dispatch.agent_id,
        failureType: dispatch.failure_type || "",
        actualArtifactRef: artifactRef,
        blockedReason,
        completedAt
      });
    }
    return updates;
  }

  async function syncWorkflowTasksFromDispatches(paths, workflowId) {
    const updates = await workflowTaskSyncPlanFromDispatches(paths, workflowId);
    for (const update of updates) {
      await sqlite(paths.dbFile, `
UPDATE workflow_tasks
SET status=${sqlValue(update.status)},
    actual_artifact_ref=${sqlValue(update.actualArtifactRef || "")},
    blocked_reason=${sqlValue(update.blockedReason || "")},
    completed_at=${update.status === "blocked" ? "NULL" : sqlValue(update.completedAt || nowIso())},
    updated_at=${sqlValue(nowIso())}
WHERE task_id=${sqlValue(update.taskId)} AND workflow_id=${sqlValue(workflowId)};`);
    }
    return updates.map((update) => ({
      taskId: update.taskId,
      dispatchId: update.dispatchId,
      status: update.status,
      runtime: update.runtime,
      agentId: update.agentId,
      failureType: update.failureType || ""
    }));
  }

  async function workflowAdvancePreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const checkedAt = nowIso();
    const workflowRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
    if (!workflowRows[0]) throw new Error(`workflow not found: ${workflowId}`);
    const workflow = workflowRows[0];
    const tasks = await sqlite(paths.dbFile, `SELECT * FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)} ORDER BY created_at;`, { json: true });
    const syncDispatches = boolOption(input.syncDispatches ?? input.sync_dispatches, true);
    const syncPlan = syncDispatches ? await workflowTaskSyncPlanFromDispatches(paths, workflowId) : [];
    const previewTasks = applyWorkflowTaskSyncPlan(tasks, syncPlan);
    const workflowHumanGates = await pendingHumanGateCount(paths, workflowId);
    const analysis = workflowAdvanceAnalysis(previewTasks, workflowHumanGates, input);
    const wouldDispatch = boolOption(input.autoDispatch ?? input.auto_dispatch, false) && analysis.decision === "dispatch_ready"
      ? analysis.readyTasks
          .filter((task) => task.runtime && task.agent_id)
          .map((task) => ({
            taskId: task.task_id,
            runtime: task.runtime,
            agentId: task.agent_id,
            dispatchType: task.task_type || "workflow_task",
            priority: task.priority === "steer" ? "steer" : "normal",
            traceId: input.traceId || input.trace_id || `${workflowId}:${task.task_id}`,
            idempotencyKey: `workflow_task:${task.task_id}:dispatch`
          }))
      : [];
    const nextStatus = workflowStatusAfterAdvance(workflow.status, analysis.decision);
    return {
      workflowId,
      action: "workflow.advance.preview",
      preview: true,
      readOnly: true,
      checkedAt,
      decision: analysis.decision,
      wouldUpdateWorkflow: {
        currentDecision: analysis.decision,
        status: nextStatus,
        updatedAt: checkedAt
      },
      summary: workflowAdvanceSummary(previewTasks, analysis, wouldDispatch.length),
      readyTasks: analysis.readyTasks,
      blockedTasks: analysis.blocked,
      wouldDispatch,
      wouldSyncTasks: syncPlan,
      syncDispatches,
      dbFile: paths.dbFile
    };
  }

  async function workflowAdvance(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const checkedAt = nowIso();
    const syncedTasks = boolOption(input.syncDispatches ?? input.sync_dispatches, true) ? await syncWorkflowTasksFromDispatches(paths, workflowId) : [];
    const workflowRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
    if (!workflowRows[0]) throw new Error(`workflow not found: ${workflowId}`);
    const tasks = await sqlite(paths.dbFile, `SELECT * FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)} ORDER BY created_at;`, { json: true });
    const workflowHumanGates = await pendingHumanGateCount(paths, workflowId);
    const analysis = workflowAdvanceAnalysis(tasks, workflowHumanGates, input);
    let { decision } = analysis;
    const dispatched = [];
    if (boolOption(input.autoDispatch ?? input.auto_dispatch, false) && decision === "dispatch_ready") {
      for (const task of analysis.readyTasks) {
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
        dispatched.push({
          taskId: task.task_id,
          dispatchId: dispatch.dispatchId,
          runtime: task.runtime,
          agentId: task.agent_id,
          priority: task.priority === "steer" ? "steer" : "normal",
          status: dispatch.status,
          deduped: dispatch.deduped || false
        });
      }
      if (dispatched.length) decision = "dispatching";
    }

    await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET current_decision=${sqlValue(decision)}, updated_at=${sqlValue(checkedAt)},
    status=${sqlValue(workflowStatusAfterAdvance(workflowRows[0].status, decision))}
WHERE workflow_id=${sqlValue(workflowId)};`);
    const summary = workflowAdvanceSummary(tasks, analysis, dispatched.length);
    return { workflowId, decision, checkedAt, summary, readyTasks: analysis.readyTasks, blockedTasks: analysis.blocked, dispatched, syncedTasks, dbFile: paths.dbFile };
  }

  return {
    workflowAdvance,
    workflowAdvancePreview
  };
}
