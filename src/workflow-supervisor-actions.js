import { boolOption } from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const WORKFLOW_SUPERVISOR_ACTION_HANDLER_NAMES = {
  "workflow.supervise": "workflowSupervisor",
  "workflow.supervisor": "workflowSupervisor",
  "workflow.supervise.preview": "workflowSupervisorPreview",
  "workflow.supervisor.preview": "workflowSupervisorPreview",
  "workflow.preview.supervise": "workflowSupervisorPreview"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow supervisor action dependency missing: ${name}`);
  return value;
}

export function createWorkflowSupervisorActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_SUPERVISOR_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow supervisor action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowSupervisorAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createWorkflowSupervisorActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowAdvance = requireContextFunction(context, "workflowAdvance");
  const workflowAdvancePreview = requireContextFunction(context, "workflowAdvancePreview");
  const workflowCheckpoint = requireContextFunction(context, "workflowCheckpoint");

  function supervisorReportPrompt(workflow, advanceResult, checkpointResult, input = {}) {
    const summary = advanceResult.summary || {};
    const blocked = (advanceResult.blockedTasks || []).map((task) => `${task.task_id}: ${task.blocked_reason || task.summary || ""}`).join("\n");
    return [
      "你是猫爪 cat_claw，是猫体系会议制度的秘书、Human Gate 入口和向闪电猫汇报的收口 agent。",
      "",
      "请基于以下 workflow 状态，向闪电猫 Telegram 私聊 8390724843 提交正式汇报。不要只告知讨论结果，必须包含下一步行动方案、需要闪电猫确认的问题、阻塞项和建议推进路径。",
      "",
      `timestamp: ${nowIso()}`,
      `workflow_id: ${workflow.workflow_id}`,
      `objective: ${workflow.objective || workflow.summary || ""}`,
      `status: ${workflow.status}`,
      `phase: ${workflow.current_phase || ""}`,
      `decision: ${advanceResult.decision}`,
      `task_counts: total=${summary.total || 0}, pending=${summary.pending || 0}, in_progress=${summary.inProgress || 0}, done=${summary.done || 0}, blocked=${summary.blocked || 0}, pending_human_gates=${summary.pendingHumanGates || 0}`,
      checkpointResult?.relativePath ? `checkpoint: ${checkpointResult.relativePath}` : "",
      blocked ? `blocked_tasks:\n${blocked}` : "",
      input.text ? `flashcat_context: ${input.text}` : "",
      "",
      "输出要求：",
      "1. 先给结论和当前是否可继续推进。",
      "2. 给出下一轮具体行动方案，包括由猫之脑、猫爪、猫之体和相关专业 agent 分别做什么。",
      "3. 如果需要闪电猫确认，明确列出确认项和默认建议。",
      "4. 如果无需确认，说明你将如何推动下一轮并继续收口。",
      "5. 全文带 ISO 时间戳。"
    ].filter(Boolean).join("\n");
  }

  async function workflowSupervisor(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const meetingId = String(input.meetingId || input.meeting_id || workflowId).trim();
    const startedAt = nowIso();
    const maxCycles = Math.max(1, Math.min(5, Number(input.maxCycles || input.max_cycles || 1)));
    const autoDispatch = boolOption(input.autoDispatch ?? input.auto_dispatch, true);
    const drain = boolOption(input.drain, false);
    const autoReport = boolOption(input.autoReport ?? input.auto_report, true);
    const reportRuntime = normalizeRuntime(input.reportRuntime || input.report_runtime || "openclaw");
    const reportAgent = normalizeAgentId(input.reportAgent || input.report_agent || "cat_claw");
    const runtimeLimit = Math.max(1, Math.min(20, Number(input.limit || input.runtimeLimit || input.runtime_limit || 5)));
    const timeoutSeconds = Math.max(5, Math.min(900, Number(input.timeoutSeconds || input.timeout_seconds || 120)));
    const dryRun = boolOption(input.dryRun ?? input.dry_run, false);
    const writeCheckpoint = !dryRun && boolOption(input.checkpoint ?? input.writeCheckpoint ?? input.write_checkpoint, true);
    const cycles = [];
    const deferredRuntimeDrains = [];
    let finalAdvance = null;
    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const advance = await workflowAdvance(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        workflowId,
        meetingId,
        autoDispatch,
        syncDispatches: true
      });
      const cycleRecord = { cycle, advance, runtimeDrains: [], deferredRuntimeDrains: [] };
      cycles.push(cycleRecord);
      finalAdvance = advance;
      if (!drain || dryRun || !advance.dispatched.length) break;
      const runtimes = [...new Set(advance.dispatched.map((item) => item.runtime).filter(Boolean))];
      for (const runtime of runtimes) {
        const deferred = {
          action: "runtime.bridge.drain",
          runtime,
          dispatchIds: advance.dispatched
            .filter((item) => item.runtime === runtime)
            .map((item) => item.dispatchId || item.dispatch_id || "")
            .filter(Boolean),
          limit: runtimeLimit,
          timeoutSeconds,
          status: "deferred",
          reason: "workflow.supervise no longer executes runtime.bridge.drain directly; control-loop runtime_drain jobs own generic dispatch draining"
        };
        cycleRecord.deferredRuntimeDrains.push(deferred);
        deferredRuntimeDrains.push(deferred);
      }
      break;
    }
    finalAdvance = await workflowAdvance(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      workflowId,
      meetingId,
      autoDispatch: false,
      syncDispatches: true
    });
    const dispatched = cycles.flatMap((cycle) => cycle.advance?.dispatched || []);
    const checkpoint = writeCheckpoint
      ? await workflowCheckpoint(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        workflowId,
        summary: input.summary || `Supervisor checkpoint at ${startedAt}; decision=${finalAdvance.decision}`,
        nextActions: input.nextActions || input.next_actions || []
      })
      : null;
    let catClawReport = null;
    let catClawReportDrain = null;
    let catClawReportDrainDeferred = null;
    if (autoReport && ["cat_claw_summary_required", "blocked", "human_gate_pending"].includes(finalAdvance.decision)) {
      const workflowRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
      const workflow = workflowRows[0] || { workflow_id: workflowId };
      const reportStateKey = [finalAdvance.decision, workflow.status || "", workflow.current_phase || ""].filter(Boolean).join(":") || "latest";
      const reportIdempotencyKey = input.reportIdempotencyKey || input.report_idempotency_key || `workflow:${workflowId}:cat_claw_report:${checkpoint?.checkpointId || reportStateKey}`;
      catClawReport = await meetingDispatch(rootDir, {
        workflowRootDir: paths.root,
        meetingId,
        workflowId,
        traceId: `${workflowId}:cat_claw_report:${Date.now()}`,
        idempotencyKey: reportIdempotencyKey,
        runtime: reportRuntime,
        agentId: reportAgent,
        dispatchType: finalAdvance.decision === "human_gate_pending" ? "human_gate_report" : "workflow_secretary_report",
        priority: "high",
        createdBy: "workflow_supervisor",
        prompt: supervisorReportPrompt(workflow, finalAdvance, checkpoint, input),
        payload: {
          workflowId,
          meetingId,
          checkpointId: checkpoint?.checkpointId || "",
          decision: finalAdvance.decision,
          reportTarget: "telegram:8390724843"
        }
      });
      if (drain && !dryRun && catClawReport?.dispatchId) {
        catClawReportDrainDeferred = {
          action: "runtime.bridge.drain",
          runtime: catClawReport.runtime,
          dispatchId: catClawReport.dispatchId,
          limit: 1,
          timeoutSeconds,
          status: "deferred",
          reason: "workflow.supervise no longer executes Cat Claw report runtime drain directly; control-loop runtime_drain jobs own generic dispatch draining"
        };
        deferredRuntimeDrains.push(catClawReportDrainDeferred);
      }
    }
    return {
      workflowId,
      meetingId,
      startedAt,
      completedAt: nowIso(),
      cycles,
      dispatched,
      deferredRuntimeDrains,
      finalAdvance,
      checkpoint,
      catClawReport,
      catClawReportDrain,
      catClawReportDrainDeferred,
      dryRun,
      dbFile: paths.dbFile
    };
  }

  async function workflowSupervisorPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const meetingId = String(input.meetingId || input.meeting_id || workflowId).trim();
    const startedAt = nowIso();
    const maxCycles = Math.max(1, Math.min(5, Number(input.maxCycles || input.max_cycles || 1)));
    const autoDispatch = boolOption(input.autoDispatch ?? input.auto_dispatch, true);
    const drain = boolOption(input.drain, false);
    const autoReport = boolOption(input.autoReport ?? input.auto_report, true);
    const reportRuntime = normalizeRuntime(input.reportRuntime || input.report_runtime || "openclaw");
    const reportAgent = normalizeAgentId(input.reportAgent || input.report_agent || "cat_claw");
    const checkpoint = boolOption(input.checkpoint ?? input.writeCheckpoint ?? input.write_checkpoint, true);
    const advance = await workflowAdvancePreview(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      workflowId,
      meetingId,
      autoDispatch,
      syncDispatches: true
    });
    const wouldDrainRuntimes = drain && advance.wouldDispatch.length
      ? [...new Set(advance.wouldDispatch.map((item) => item.runtime).filter(Boolean))]
      : [];
    const wouldReport = autoReport && ["cat_claw_summary_required", "blocked", "human_gate_pending"].includes(advance.decision);
    return {
      workflowId,
      meetingId,
      action: "workflow.supervise.preview",
      preview: true,
      readOnly: true,
      startedAt,
      completedAt: nowIso(),
      maxCycles,
      advance,
      wouldDrainRuntimes,
      wouldCheckpoint: checkpoint,
      wouldCatClawReport: wouldReport ? {
        runtime: reportRuntime,
        agentId: reportAgent,
        dispatchType: advance.decision === "human_gate_pending" ? "human_gate_report" : "workflow_secretary_report",
        priority: "high"
      } : null,
      limitations: [
        "Preview is read-only and does not model later cycles after wouldDispatch tasks run.",
        "Runtime drain is no longer executed by workflow.supervise; generic dispatch draining is deferred to control-loop runtime_drain jobs.",
        "Checkpoint creation, Telegram outbox delivery, and Cat Claw report dispatch are not executed."
      ],
      dbFile: paths.dbFile
    };
  }

  return {
    workflowSupervisor,
    workflowSupervisorPreview
  };
}
