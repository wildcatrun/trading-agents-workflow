import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { WorkflowReadModel } from "./console/read-model.js";
import { createWorkflowV2ActionRegistry, runWorkflowV2Action } from "./workflow-v2/index.js";
import {
  workflowV2LoadPlanRow,
  workflowV2PatchPlanWorkflowState,
  workflowV2PlanOrchestrationPattern
} from "./workflow-v2/plan-state.js";
import {
  workflowV2RequireSessionRunPatch as workflowV2RequireSessionRunPatchCore,
  workflowV2RestoreSessionRunRow,
  workflowV2WorkerRetryDelayMs
} from "./workflow-v2/session-state.js";
import {
  workflowV2RestoreManagerReviewRow
} from "./workflow-v2/review-state.js";
import {
  WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES,
  workflowV2AutonomousLoopMaybeTerminalizeNode,
  workflowV2AutonomousLoopSpawnGate
} from "./workflow-v2/autonomous-loop.js";
import { createWorkflowV2InfoStackActionHandlers } from "./workflow-v2/info-stack-actions.js";
import { createWorkflowV2WorkerLifecycleActionHandlers } from "./workflow-v2/worker-lifecycle-actions.js";
import { createWorkflowV2AdapterRunnerActionHandlers } from "./workflow-v2/adapter-runner-actions.js";
import { createWorkflowV2ControlLoopActionHandlers } from "./workflow-v2/control-loop-actions.js";
import { createWorkflowV2WorkerResultActionHandlers } from "./workflow-v2/worker-result-actions.js";
import { createWorkflowV2ReviewActionHandlers } from "./workflow-v2/review-actions.js";
import { createWorkflowV2HumanGateActionHandlers } from "./workflow-v2/human-gate-actions.js";
import { createWorkflowV2PlanActionHandlers } from "./workflow-v2/plan-actions.js";
import { createWorkflowTemplateActionHandlers } from "./workflow-v2/template-actions.js";
import { createWorkflowV2ValidateActionHandlers } from "./workflow-v2/validate-actions.js";
import {
  createWorkflowRunActionHandlers,
  createWorkflowRunActionRegistry,
  runWorkflowRunAction
} from "./workflow-run-actions.js";
import {
  createWorkflowAdvanceActionHandlers,
  createWorkflowAdvanceActionRegistry,
  runWorkflowAdvanceAction
} from "./workflow-advance-actions.js";
import {
  createWorkflowSupervisorActionHandlers,
  createWorkflowSupervisorActionRegistry,
  runWorkflowSupervisorAction
} from "./workflow-supervisor-actions.js";
import {
  createWorkflowTaskActionHandlers,
  createWorkflowTaskActionRegistry,
  runWorkflowTaskAction
} from "./workflow-task-actions.js";
import {
  createWorkflowTaskDraftActionHandlers,
  createWorkflowTaskDraftActionRegistry,
  runWorkflowTaskDraftAction
} from "./workflow-task-draft-actions.js";
import {
  createWorkflowTaskLaunchActionHandlers,
  createWorkflowTaskLaunchActionRegistry,
  runWorkflowTaskLaunchAction
} from "./workflow-task-launch-actions.js";
import {
  createWorkflowSwarmActionHandlers,
  createWorkflowSwarmActionRegistry,
  runWorkflowSwarmAction
} from "./workflow-swarm-actions.js";
import {
  createControlLoopJobActionHandlers,
  createControlLoopJobActionRegistry,
  runControlLoopJobAction
} from "./control-loop-job-actions.js";
import {
  controlLoopTimeoutSeconds,
  createControlLoopTickActionHandlers,
  createControlLoopTickActionRegistry,
  runControlLoopTickAction
} from "./control-loop-tick-actions.js";
import {
  createDispatchReconcileActionHandlers,
  createDispatchReconcileActionRegistry,
  runDispatchReconcileAction
} from "./dispatch-reconcile-actions.js";
import {
  createCatClawActionHandlers,
  createCatClawActionRegistry,
  runCatClawAction
} from "./cat-claw-actions.js";
import {
  createCheckpointActionHandlers,
  createCheckpointActionRegistry,
  runCheckpointAction
} from "./checkpoint-actions.js";
import {
  appendWorkflowEvent,
  createEventActionHandlers,
  createEventActionRegistry,
  runEventAction
} from "./event-actions.js";
import {
  DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS,
  DEFAULT_RUNTIME_ACK_RETRY_SECONDS,
  DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS,
  MESSAGE_FLOW_DELIVERY_RETURN_POLICIES,
  MESSAGE_FLOW_RETURN_POLICIES,
  createMessageFlowActionHandlers,
  createMessageFlowActionRegistry,
  createMessageFlowRuntimeHelpers,
  runMessageFlowAction
} from "./message-flow-actions.js";
import {
  createPermissionActionHandlers,
  createPermissionActionRegistry,
  createPermissionCore,
  runPermissionAction
} from "./permission-actions.js";
import {
  createTelegramOutboxActionHandlers,
  createTelegramOutboxActionRegistry,
  runTelegramOutboxAction
} from "./telegram-outbox-actions.js";
import {
  createTelegramLiveActionHandlers,
  createTelegramLiveActionRegistry,
  runTelegramLiveAction
} from "./telegram-live-actions.js";
import {
  createTopologyActionHandlers,
  createTopologyActionRegistry,
  runTopologyAction
} from "./topology-actions.js";
import {
  HUMAN_GATE_APPROVE_OPTION_MAX,
  HUMAN_GATE_APPROVE_OPTION_MIN,
  auditHumanGatePlanOptions,
  combineHumanGateAudits,
  createHumanGateActionHandlers,
  createHumanGateActionRegistry,
  humanGateArtifactRef,
  humanGateBody,
  humanGateButtonFromRow,
  humanGateButtonIsControl,
  humanGateButtonRole,
  humanGateButtonStatus,
  humanGatePlanOptionButtons,
  humanGateSummary,
  runHumanGateAction
} from "./human-gate-actions.js";
import {
  createIncidentActionHandlers,
  createIncidentActionRegistry,
  runIncidentAction
} from "./incident-actions.js";
import {
  createInterventionActionHandlers,
  createInterventionActionRegistry,
  runInterventionAction
} from "./intervention-actions.js";
import {
  createProtocolActionHandlers,
  createProtocolActionRegistry,
  runProtocolAction
} from "./protocol-actions.js";
import {
  createResearchActionHandlers,
  createResearchActionRegistry,
  runResearchAction
} from "./research-actions.js";
import {
  appendRuntimeSemanticEvent,
  createRuntimeEventActionHandlers,
  createRuntimeEventActionRegistry,
  runRuntimeEventAction
} from "./runtime-event-actions.js";
import {
  createRuntimeAgentActionHandlers,
  createRuntimeAgentActionRegistry,
  runRuntimeAgentAction
} from "./runtime-agent-actions.js";
import {
  createMeetingParticipantActionHandlers,
  createMeetingParticipantActionRegistry,
  runMeetingParticipantAction
} from "./meeting-participant-actions.js";
import {
  createMeetingIngestActionHandlers,
  createMeetingIngestActionRegistry,
  runMeetingIngestAction
} from "./meeting-ingest-actions.js";
import {
  createMeetingDispatchActionHandlers,
  createMeetingDispatchActionRegistry,
  runMeetingDispatchAction
} from "./meeting-dispatch-actions.js";
import {
  createMeetingControlActionHandlers,
  createMeetingControlActionRegistry,
  runMeetingControlAction
} from "./meeting-control-actions.js";
import {
  createRouteShellActionHandlers,
  createRouteShellActionRegistry,
  runRouteShellAction
} from "./route-shell-actions.js";
import {
  createRuntimeBridgeActionHandlers,
  createRuntimeBridgeActionRegistry,
  runRuntimeBridgeAction
} from "./runtime-bridge-actions.js";
import {
  createScheduleActionHandlers,
  createScheduleActionRegistry,
  runScheduleAction
} from "./schedule-actions.js";
import {
  createSessionActionHandlers,
  createSessionActionRegistry,
  runSessionAction,
  sessionRunFromRow
} from "./session-actions.js";
import {
  createSideEffectActionHandlers,
  createSideEffectActionRegistry,
  runSideEffectAction
} from "./side-effect-actions.js";
import {
  createStatusActionHandlers,
  createStatusActionRegistry,
  runStatusAction
} from "./status-actions.js";
import {
  createTradeActionHandlers,
  createTradeActionRegistry,
  runTradeAction
} from "./trade-actions.js";
import {
  createVerificationActionHandlers,
  createVerificationActionRegistry,
  runVerificationAction
} from "./verification-actions.js";
import {
  LEGACY_TRACKING_DB,
  LEGACY_WORKFLOW_ROOT,
  WORKFLOW_CONTROL_PLANE_DB,
  resolveHome,
  resolveWorkflowRoot,
  workflowPaths
} from "./workflow/paths.js";
import {
  boolOption,
  firstText,
  jsonHash,
  parseJsonValue,
  redactSensitiveForPersistence,
  redactSensitiveTextForPersistence,
  safeId,
  textHash,
  toList
} from "./workflow/json.js";
import {
  WORKFLOW_GENERIC_ORCHESTRATION_WRITE_ACTIONS,
  WORKFLOW_LEGACY_MUTATING_ACTIONS,
  workflowActionBlockedResult,
  workflowActionOverrideEnabled
} from "./workflow/action-policy.js";
import {
  workflowGenericOrchestrationAuthorized
} from "./workflow/plan-authorization.js";
import {
  ensureColumns,
  isSqliteConstraintError,
  sqlValue,
  sqlite,
  sqliteChangeCount,
  sqliteTransaction,
  tableColumns
} from "./workflow/sqlite.js";

const execFileAsync = promisify(execFile);

export const WORKFLOW_SCHEMA_VERSION = 16;
export {
  LEGACY_TRACKING_DB,
  LEGACY_WORKFLOW_ROOT,
  WORKFLOW_CONTROL_PLANE_DB,
  resolveWorkflowRoot,
  workflowPaths
};

const ASSET_TYPES = new Set(["stock", "futures", "crypto", "forex", "etf", "index", "commodity", "other"]);
const THESIS_STATUSES = new Set(["draft", "active", "watch", "stale", "invalidated", "closed"]);
const RADAR_ZONES = new Set(["bright", "dark", "overheated", "dead_water", "watch_only", "risk_avoid", "unknown"]);
const GATE_STATUSES = new Set(["pending", "approved", "rejected", "waived"]);
const PROTOCOL_OBJECT_TYPES = new Set(["research_signal", "evidence_pack", "research_memo", "trade_proposal", "risk_decision", "human_gate_record", "workflow_task_launch_package", "simulation_request", "simulation_result", "executable_trade_intent", "trading_core_receipt", "execution_audit_summary", "generic"]);
const HUMAN_GATE_STATUSES = new Set(["pending", "approved", "rejected", "paused", "terminated", "expired", "superseded"]);
const RUNTIMES = new Set(["openclaw", "openclaw_route_shell", "hermers", "telegram", "local_codex", "codex", "claude_code", "claude-code", "opencode", "trading_sim", "trading_core", "system", "other"]);
const DISPATCH_STATUSES = new Set(["queued", "sent", "acked", "failed", "cancelled"]);
const WORKFLOW_RUN_STATUSES = new Set(["active", "waiting_human", "blocked", "paused", "completed", "stopped", "cancelled"]);
const WORKFLOW_TASK_STATUSES = new Set(["pending", "in_progress", "done", "blocked", "failed", "cancelled"]);
const WORKFLOW_TASK_PRIORITIES = new Set(["flash", "steer", "high", "normal", "low"]);
const RETIRED_RUNTIME_AGENT_STATUSES = new Set(["retired", "archived"]);
const INCIDENT_STATUSES = new Set(["active", "mitigating", "monitoring", "resolved", "cancelled"]);
const INCIDENT_MODES = new Set(["normal", "degraded", "critical-only", "paper-only", "frozen"]);
const AUTO_RETRY_FAILURE_TYPES = new Set(["provider_timeout", "runtime_timeout", "acp_unavailable", "transient_runtime", "ack_contract_violation"]);
const REPORT_MESSAGE_TYPES = new Set(["workflow_secretary_report", "human_gate_report"]);
const TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES = new Set(["human_gate_request", "human_gate_report", "workflow_secretary_report", "message_flow_reply", "meeting_live"]);
const INTERNAL_HUMAN_GATE_RECORD = Symbol("internal_human_gate_record");
const DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID = "8390724843";
const CONTROL_LOOP_WORKFLOW_STATUSES = new Set(["active", "waiting_human", "blocked"]);
const CONTROL_LOOP_ACTIVE_JOB_STATUSES = new Set(["queued", "running", "retry_scheduled"]);
const DEFAULT_WORKFLOW_RETENTION_HOURS = 72;
const DEFAULT_WORKFLOW_RETENTION_INTERVAL_MS = 60 * 60_000;
const HUMAN_GATE_TEXT_POLICY_VERSION = "human_gate_chinese_feedback_style_v1";
const HUMAN_GATE_WEB_APP_ROUTE_PATH = "/plugins/trading-agents-workflow/human-gate";
const DEFAULT_HERMERS_PROFILE_MODES_PATH = "/home/flashcat/.openclaw/stability/hermers-profile-modes.json";
const TELEGRAM_BUTTON_STYLES = new Set(["danger", "success", "primary"]);
const HUMAN_GATE_PLAN_STYLE = "success";
const HUMAN_GATE_CONTROL_STYLES = {
  approve: "success",
  approve_option: "success",
  reject: "danger",
  rejected: "danger",
  pause: "primary",
  paused: "primary",
  terminate: "danger",
  terminated: "danger"
};
const HUMAN_GATE_REDACTED_DETAIL_KEY = /callback|token|secret|password|api[_-]?key|access[_-]?key|refresh/i;
const TELEGRAM_OUTBOX_DELIVERY_LEASE_MS = 120_000;
const HUMAN_GATE_ZH_TEXT = new Map([
  [
    "Hermes cron/heartbeat migration Human Gate: choose an approved option after cat_claw audit pass. Recommended path remains the controlled pilot unless Flashcat selects otherwise.",
    "Hermes cron/heartbeat 迁移 Human Gate：猫爪复核通过后，请在可批准方案中选择下一步路径。除非闪电猫另行选择，建议路径仍为受控试点。"
  ],
  ["Freeze-and-map only", "冻结现状并梳理边界"],
  ["Controlled pilot with dual-path verification", "受控试点并保留双路径验证"],
  ["Controlled pilot with dual-path ver...", "受控试点并保留双路径验证"],
  ["Problem-exposure improvement track", "暴露问题并改进治理"],
  [
    "Approve no migration or shutdown. Keep current cron/control path unchanged. Only collect evidence and map boundary issues: WeCom auth error 850002, Telegram target/channel mismatch, Hermes/OpenClaw control-path ambiguity, readiness degraded / queued dispatches.",
    "批准不迁移、不停用现有机制。保持当前 cron/control 路径不变，只收集证据并梳理边界问题：WeCom 鉴权错误 850002、Telegram target/channel 不一致、Hermes/OpenClaw 控制路径不清、readiness 降级和排队 dispatch。"
  ],
  [
    "Proceed with Plan A freeze-and-map only. No migration, shutdown, or sole Hermes execution.",
    "按方案 A 仅执行冻结现状和边界梳理。不迁移、不停用、不切到 Hermes 单独执行。"
  ],
  ["No operational change; stop evidence collection.", "没有运行态变更；如需停止，结束证据收集即可。"],
  [
    "Approve a limited Hermes/OpenClaw pilot only for non-trading workflow dispatch/reporting, while old cron remains active as fallback. Require receipt comparison, delivery-channel verification, and readiness recovery evidence before any shutdown.",
    "批准仅针对非交易 workflow dispatch/reporting 的受控 Hermes/OpenClaw 试点，同时保留旧 cron 作为回退路径。在任何停用旧路径前，必须完成 receipt 对比、投递通道验证和 readiness 恢复证据。"
  ],
  [
    "Proceed with Plan B controlled pilot and dual-path verification. Keep old cron fallback active.",
    "按方案 B 执行受控试点和双路径验证；旧 cron 回退路径保持 active。"
  ],
  ["Stop pilot dispatches and continue old cron path.", "停止试点 dispatch，继续使用旧 cron 路径。"],
  [
    "Approve Plan C as chosen direction: actively expose workflow problems so the cat-system can improve, but forbid old cron shutdown and forbid Hermes sole execution before a later Human Gate. Use current failures as training/governance evidence.",
    "批准方案 C 作为当前方向：主动暴露 workflow 问题，让猫体系用这些故障改进治理；但在后续 Human Gate 前，禁止停用旧 cron，禁止让 Hermes 单独执行。当前故障只作为训练和治理证据使用。"
  ],
  [
    "Proceed with Plan C problem-exposure improvement track. No old cron shutdown and no Hermes sole execution before a later Human Gate.",
    "按方案 C 执行问题暴露和治理改进；在后续 Human Gate 前不得停用旧 cron，也不得切到 Hermes 单独执行。"
  ],
  [
    "If readiness worsens or delivery paths remain unverifiable, return to Plan A freeze-and-map.",
    "如果 readiness 继续恶化，或投递路径仍无法验证，回退到方案 A：冻结现状并梳理边界。"
  ]
]);

const WORKFLOW_PURE_PREVIEW_ACTIONS = new Set([
  "workflow.task.draft",
  "workflow.v2.plan.preview",
  "workflow.v2.info_stack.preview",
  "workflow.v2.info_stack.read",
  "workflow.v2.worker_spawn.preview",
  "workflow.v2.notification.preview",
  "workflow.v2.worker_backend.preflight",
  "workflow.v2.owner_review.preview",
  "workflow.v2.task_group_package.preview",
  "workflow.v2.cat_brain_audit.preview",
  "workflow.v2.cat_claw_audit.preview",
  "workflow.v2.human_gate_package.preview",
  "workflow.v2.human_gate_request.preview",
  "workflow.v2.control_loop.preview",
  "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker_handoff.preview",
  "workflow.v2.worker_retire.preview",
  "workflow.v2.worker_successor.preview",
  "workflow.v2.worker_adapter_job.preview",
  "workflow.v2.adapter_runner.preview",
  "workflow.v2.worker_result.submit.preview",
  "workflow.v2.worker_result.fail.preview",
  "workflow.v2.validate",
  "workflow.template.preview",
  "workflow.template.search",
  "workflow.template.get",
  "workflow.template.instantiate.preview",
  "workflow.template.eval.preview",
  "workflow.template.stats.refresh",
  "workflow.template.promote.preview",
  "workflow.template.extract.preview"
]);

const WORKFLOW_ACTION_ALIASES = {
  status: "workflow.status",
  "trading_workflow.init": "workflow.init",
  "trading_workflow.status": "workflow.status",
  "workflow.dashboard": "workflow.health",
  "workflow.health.dashboard": "workflow.health",
  "trading_workflow.health": "workflow.health",
  "trading_workflow.readiness": "workflow.readiness",
  "trading_workflow.topology": "workflow.topology",
  "workflow.runtime-agents": "workflow.runtime_agents",
  "workflow.runtime.registry": "workflow.runtime_agents",
  "workflow.initiative.upsert": "workflow.run.upsert",
  "workflow.swarm": "workflow.swarm.plan",
  "workflow.task.preview": "workflow.task.draft",
  "workflow.task.create.preview": "workflow.task.draft",
  "workflow.meeting_task.draft": "workflow.task.draft",
  "workflow.task.launch.preview": "workflow.task.draft",
  "workflow.task.launch.draft": "workflow.task.launch.prepare",
  "workflow.task.launch.submit": "workflow.task.launch.prepare",
  "workflow.task.launch.brain_review": "workflow.task.launch.review",
  "workflow.tasks": "workflow.task.list",
  "workflow.preview.advance": "workflow.advance.preview",
  "workflow.supervisor": "workflow.supervise",
  "workflow.supervisor.preview": "workflow.supervise.preview",
  "workflow.preview.supervise": "workflow.supervise.preview",
  "workflow.preview.pause": "workflow.pause.preview",
  "workflow.preview.resume": "workflow.resume.preview",
  "workflow.preview.stop": "workflow.stop.preview",
  "workflow.terminate.preview": "workflow.stop.preview",
  "workflow.preview.terminate": "workflow.stop.preview",
  "workflow.terminate": "workflow.stop",
  "workflow.rerun_agent.preview": "workflow.rerun.agent.preview",
  "workflow.preview.rerun_agent": "workflow.rerun.agent.preview",
  "workflow.rerun_phase.preview": "workflow.rerun.phase.preview",
  "workflow.preview.rerun_phase": "workflow.rerun.phase.preview",
  "workflow.incident.dead_letter.preview": "workflow.incident.from_dead_letter.preview",
  "workflow.incident.dead-letter.preview": "workflow.incident.from_dead_letter.preview",
  "workflow.incident.from_dead-letter.preview": "workflow.incident.from_dead_letter.preview",
  "workflow.incident.dead_letter": "workflow.incident.from_dead_letter",
  "workflow.incident.dead-letter": "workflow.incident.from_dead_letter",
  "workflow.incident.from_dead-letter": "workflow.incident.from_dead_letter",
  "workflow.control_loop.job.retry.preview": "workflow.control_loop.job.requeue.preview",
  "workflow.control_loop.job.retry": "workflow.control_loop.job.requeue",
  "workflow.control-loop.job.requeue.preview": "workflow.control_loop.job.requeue.preview",
  "workflow.control-loop.job.requeue": "workflow.control_loop.job.requeue",
  "workflow.job.requeue.preview": "workflow.control_loop.job.requeue.preview",
  "workflow.job.requeue": "workflow.control_loop.job.requeue",
  "control_loop.job.requeue.preview": "workflow.control_loop.job.requeue.preview",
  "control_loop.job.requeue": "workflow.control_loop.job.requeue",
  "workflow.incident.closeout.report.preview": "workflow.incident.closeout.cat_claw_report.preview",
  "workflow.incident.closeout.cat-claw-report.preview": "workflow.incident.closeout.cat_claw_report.preview",
  "workflow.incident.closeout.hgate.preview": "workflow.incident.closeout.human_gate_package.preview",
  "workflow.incident.closeout.human-gate-package.preview": "workflow.incident.closeout.human_gate_package.preview",
  "workflow.incident.closeout.list.preview": "workflow.incident.closeout.worklist.preview",
  "workflow.incident.closeout.batch.preview": "workflow.incident.closeout.worklist.preview",
  "workflow.incident.closeout.inventory.preview": "workflow.incident.closeout.worklist.preview",
  "workflow.incident.closeout.worklist.persist.preview": "workflow.incident.closeout.worklist.artifact.preview",
  "workflow.incident.closeout.worklist.persist": "workflow.incident.closeout.worklist.artifact",
  "workflow.incident.closeout.worklist-artifact.preview": "workflow.incident.closeout.worklist.artifact.preview",
  "workflow.incident.closeout.worklist-artifact": "workflow.incident.closeout.worklist.artifact",
  "workflow.incident.closeout.annotate.preview": "workflow.incident.closeout.evidence.preview",
  "workflow.incident.closeout.annotate": "workflow.incident.closeout.evidence",
  "workflow.incident.closeout.evidence-record.preview": "workflow.incident.closeout.evidence.preview",
  "workflow.incident.closeout.evidence-record": "workflow.incident.closeout.evidence",
  "workflow.incident.closeout.persist.preview": "workflow.incident.closeout.artifact.preview",
  "workflow.incident.closeout.persist": "workflow.incident.closeout.artifact",
  "workflow.incident.closeout.hgate-request.preview": "workflow.incident.closeout.human_gate_request.preview",
  "workflow.incident.closeout.human-gate-request.preview": "workflow.incident.closeout.human_gate_request.preview",
  "workflow.incident.closeout.hgate-request": "workflow.incident.closeout.human_gate_request",
  "workflow.incident.closeout.human-gate-request": "workflow.incident.closeout.human_gate_request",
  "telegram.outbox.preview_delivery": "telegram.outbox.delivery.preview",
  "telegram.outbox.delivery-preview": "telegram.outbox.delivery.preview",
  "telegram.outbox.preview_requeue": "telegram.outbox.requeue.preview",
  "telegram.outbox.requeue-preview": "telegram.outbox.requeue.preview",
  "telegram.outbox.resend.preview": "telegram.outbox.requeue.preview",
  "telegram.outbox.redelivery.preview": "telegram.outbox.requeue.preview",
  "telegram.outbox.requeue.package.preview": "telegram.outbox.requeue.execution_package.preview",
  "telegram.outbox.requeue.execution-package.preview": "telegram.outbox.requeue.execution_package.preview",
  "telegram.outbox.resend.package.preview": "telegram.outbox.requeue.execution_package.preview",
  "telegram.outbox.redelivery.package.preview": "telegram.outbox.requeue.execution_package.preview",
  "telegram.outbox.deliver": "telegram.outbox.delivery",
  "telegram.outbox.delivery.execute": "telegram.outbox.delivery",
  "workflow.telegram.outbox.delivery": "telegram.outbox.delivery",
  "workflow.telegram.outbox.delivery.preview": "telegram.outbox.delivery.preview",
  "workflow.telegram.outbox.requeue.preview": "telegram.outbox.requeue.preview",
  "workflow.telegram.outbox.requeue.package.preview": "telegram.outbox.requeue.execution_package.preview",
  "workflow.loop.tick": "workflow.control_loop.tick",
  "workflow.reconciler.tick": "workflow.control_loop.tick",
  "workflow.scheduler.upsert": "workflow.schedule.upsert",
  "workflow.schedules": "workflow.schedule.list",
  "workflow.scheduler.list": "workflow.schedule.list",
  "workflow.scheduler.pause": "workflow.schedule.pause",
  "workflow.scheduler.resume": "workflow.schedule.resume",
  "workflow.scheduler.disable": "workflow.schedule.disable",
  "workflow.context_checkpoint": "workflow.checkpoint",
  "context.checkpoint": "workflow.checkpoint",
  "workflow.events.append": "workflow.event.append",
  "workflow.events": "workflow.event.list",
  "workflow.events.list": "workflow.event.list",
  "workflow.timeline": "workflow.event.timeline",
  "workflow.events.timeline": "workflow.event.timeline",
  "workflow.runtime.event.record": "workflow.runtime_event.record",
  "workflow.runtime-event.record": "workflow.runtime_event.record",
  "runtime.semantic.event": "workflow.runtime_event.record",
  "runtime.semantic.record": "workflow.runtime_event.record",
  "workflow.runtime.event.list": "workflow.runtime_event.list",
  "workflow.runtime-events": "workflow.runtime_event.list",
  "workflow.runtime.events": "workflow.runtime_event.list",
  "workflow.runtime_event.current": "workflow.runtime_current_state",
  "workflow.runtime.current": "workflow.runtime_current_state",
  "workflow.runtime_current": "workflow.runtime_current_state",
  "runtime.current_state": "workflow.runtime_current_state",
  "workflow.verifier_refuter.record": "workflow.verification.record",
  "workflow.verifier-refuter.record": "workflow.verification.record",
  "verifier_refuter.record": "workflow.verification.record",
  "verifier.refuter.record": "workflow.verification.record",
  "workflow.verification": "workflow.verification.record",
  "workflow.verifications": "workflow.verification.list",
  "workflow.evaluator.run": "workflow.evaluate",
  "workflow.evaluation.run": "workflow.evaluate",
  "workflow.goal.evaluate": "workflow.evaluate",
  "workflow.evaluator.record": "workflow.verification.record",
  "workflow.evaluation.record": "workflow.verification.record",
  "workflow.session.pack.upsert": "workflow.session_pack.upsert",
  "session_pack.upsert": "workflow.session_pack.upsert",
  "workflow.session.pack.get": "workflow.session_pack.get",
  "session_pack.get": "workflow.session_pack.get",
  "workflow.session.pack.list": "workflow.session_pack.list",
  "session_pack.list": "workflow.session_pack.list",
  "workflow.session.run.start": "workflow.session_run.start",
  "session_run.start": "workflow.session_run.start",
  "workflow.session.run.complete": "workflow.session_run.complete",
  "session_run.complete": "workflow.session_run.complete",
  "workflow.v2.plan.draft": "workflow.v2.plan.preview",
  "workflow.v2.plan.create.preview": "workflow.v2.plan.preview",
  "workflow.v2.info-stack.preview": "workflow.v2.info_stack.preview",
  "workflow.v2.info_stack.draft": "workflow.v2.info_stack.preview",
  "workflow.v2.info-stack.record": "workflow.v2.info_stack.record",
  "workflow.v2.info-stack.read": "workflow.v2.info_stack.read",
  "workflow.v2.read-receipt.record": "workflow.v2.read_receipt.record",
  "workflow.v2.info_stack.read_receipt.record": "workflow.v2.read_receipt.record",
  "workflow.v2.worker-spawn.preview": "workflow.v2.worker_spawn.preview",
  "workflow.v2.worker_spawn.draft": "workflow.v2.worker_spawn.preview",
  "workflow.v2.worker-spawn.create": "workflow.v2.worker_spawn.create",
  "workflow.v2.worker_backend.preview": "workflow.v2.worker_backend.preflight",
  "workflow.v2.worker-backend.preflight": "workflow.v2.worker_backend.preflight",
  "workflow.v2.worker_backend.preflight.record": "workflow.v2.worker_backend_preflight.record",
  "workflow.v2.worker-backend.preflight.record": "workflow.v2.worker_backend_preflight.record",
  "workflow.v2.backend.preflight.record": "workflow.v2.worker_backend_preflight.record",
  "workflow.v2.backend.preflight": "workflow.v2.worker_backend.preflight",
  "workflow.v2.owner-review.preview": "workflow.v2.owner_review.preview",
  "workflow.v2.owner_review.record": "workflow.v2.owner_review.record",
  "workflow.v2.owner-review.record": "workflow.v2.owner_review.record",
  "workflow.v2.task-group-package.preview": "workflow.v2.task_group_package.preview",
  "workflow.v2.task_group_package.record": "workflow.v2.task_group_package.record",
  "workflow.v2.task-group-package.record": "workflow.v2.task_group_package.record",
  "workflow.v2.group_package.preview": "workflow.v2.task_group_package.preview",
  "workflow.v2.group-package.preview": "workflow.v2.task_group_package.preview",
  "workflow.v2.group_package.record": "workflow.v2.task_group_package.record",
  "workflow.v2.group-package.record": "workflow.v2.task_group_package.record",
  "workflow.v2.cat-brain-audit.preview": "workflow.v2.cat_brain_audit.preview",
  "workflow.v2.cat_brain_audit.record": "workflow.v2.cat_brain_audit.record",
  "workflow.v2.cat-brain-audit.record": "workflow.v2.cat_brain_audit.record",
  "workflow.v2.cat-claw-audit.preview": "workflow.v2.cat_claw_audit.preview",
  "workflow.v2.cat_claw_audit.record": "workflow.v2.cat_claw_audit.record",
  "workflow.v2.cat-claw-audit.record": "workflow.v2.cat_claw_audit.record",
  "workflow.v2.human-gate-package.preview": "workflow.v2.human_gate_package.preview",
  "workflow.v2.human-gate-package.record": "workflow.v2.human_gate_package.record",
  "workflow.v2.human-gate-request.preview": "workflow.v2.human_gate_request.preview",
  "workflow.v2.human_gate_request.submit.preview": "workflow.v2.human_gate_request.preview",
  "workflow.v2.human-gate-request.submit.preview": "workflow.v2.human_gate_request.preview",
  "workflow.v2.human-gate-request": "workflow.v2.human_gate_request",
  "workflow.v2.human_gate_request.submit": "workflow.v2.human_gate_request",
  "workflow.v2.human-gate-request.submit": "workflow.v2.human_gate_request",
  "workflow.v2.control-loop.preview": "workflow.v2.control_loop.preview",
  "workflow.v2.worker_queue.preview": "workflow.v2.control_loop.preview",
  "workflow.v2.worker-queue.preview": "workflow.v2.control_loop.preview",
  "workflow.v2.worker_lifecycle": "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker-lifecycle": "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker_lifecycle.preview": "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker-lifecycle.preview": "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker_renewal.preview": "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker-renewal.preview": "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker_handoff.preview": "workflow.v2.worker_handoff.preview",
  "workflow.v2.worker-handoff.preview": "workflow.v2.worker_handoff.preview",
  "workflow.v2.worker_handoff.record": "workflow.v2.worker_handoff.record",
  "workflow.v2.worker-handoff.record": "workflow.v2.worker_handoff.record",
  "workflow.v2.worker_retire.preview": "workflow.v2.worker_retire.preview",
  "workflow.v2.worker-retire.preview": "workflow.v2.worker_retire.preview",
  "workflow.v2.worker_retire.record": "workflow.v2.worker_retire.record",
  "workflow.v2.worker-retire.record": "workflow.v2.worker_retire.record",
  "workflow.v2.worker_successor.preview": "workflow.v2.worker_successor.preview",
  "workflow.v2.worker-successor.preview": "workflow.v2.worker_successor.preview",
  "workflow.v2.worker_successor.create": "workflow.v2.worker_successor.create",
  "workflow.v2.worker-successor.create": "workflow.v2.worker_successor.create",
  "workflow.v2.worker_renewal.create": "workflow.v2.worker_successor.create",
  "workflow.v2.worker-renewal.create": "workflow.v2.worker_successor.create",
  "workflow.v2.control-loop.tick": "workflow.v2.control_loop.tick",
  "workflow.v2.worker_queue.tick": "workflow.v2.control_loop.tick",
  "workflow.v2.worker-queue.tick": "workflow.v2.control_loop.tick",
  "workflow.v2.worker-adapter-job.preview": "workflow.v2.worker_adapter_job.preview",
  "workflow.v2.worker_runner_job.preview": "workflow.v2.worker_adapter_job.preview",
  "workflow.v2.worker-runner-job.preview": "workflow.v2.worker_adapter_job.preview",
  "workflow.v2.adapter_job.preview": "workflow.v2.worker_adapter_job.preview",
  "workflow.v2.adapter-job.preview": "workflow.v2.worker_adapter_job.preview",
  "workflow.v2.worker-adapter-job.record": "workflow.v2.worker_adapter_job.record",
  "workflow.v2.worker_runner_job.record": "workflow.v2.worker_adapter_job.record",
  "workflow.v2.worker-runner-job.record": "workflow.v2.worker_adapter_job.record",
  "workflow.v2.adapter_job.record": "workflow.v2.worker_adapter_job.record",
  "workflow.v2.adapter-job.record": "workflow.v2.worker_adapter_job.record",
  "workflow.v2.worker-adapter-job.list": "workflow.v2.worker_adapter_job.list",
  "workflow.v2.worker_runner_job.list": "workflow.v2.worker_adapter_job.list",
  "workflow.v2.worker-runner-job.list": "workflow.v2.worker_adapter_job.list",
  "workflow.v2.adapter_job.list": "workflow.v2.worker_adapter_job.list",
  "workflow.v2.adapter-job.list": "workflow.v2.worker_adapter_job.list",
  "workflow.v2.worker-adapter-job.claim": "workflow.v2.worker_adapter_job.claim",
  "workflow.v2.worker_runner_job.claim": "workflow.v2.worker_adapter_job.claim",
  "workflow.v2.worker-runner-job.claim": "workflow.v2.worker_adapter_job.claim",
  "workflow.v2.adapter_job.claim": "workflow.v2.worker_adapter_job.claim",
  "workflow.v2.adapter-job.claim": "workflow.v2.worker_adapter_job.claim",
  "workflow.v2.worker-adapter-job.heartbeat": "workflow.v2.worker_adapter_job.heartbeat",
  "workflow.v2.worker_runner_job.heartbeat": "workflow.v2.worker_adapter_job.heartbeat",
  "workflow.v2.worker-runner-job.heartbeat": "workflow.v2.worker_adapter_job.heartbeat",
  "workflow.v2.adapter_job.heartbeat": "workflow.v2.worker_adapter_job.heartbeat",
  "workflow.v2.adapter-job.heartbeat": "workflow.v2.worker_adapter_job.heartbeat",
  "workflow.v2.worker-adapter-job.release": "workflow.v2.worker_adapter_job.release",
  "workflow.v2.worker_runner_job.release": "workflow.v2.worker_adapter_job.release",
  "workflow.v2.worker-runner-job.release": "workflow.v2.worker_adapter_job.release",
  "workflow.v2.adapter_job.release": "workflow.v2.worker_adapter_job.release",
  "workflow.v2.adapter-job.release": "workflow.v2.worker_adapter_job.release",
  "workflow.v2.worker-adapter-job.fail": "workflow.v2.worker_adapter_job.fail",
  "workflow.v2.worker_runner_job.fail": "workflow.v2.worker_adapter_job.fail",
  "workflow.v2.worker-runner-job.fail": "workflow.v2.worker_adapter_job.fail",
  "workflow.v2.adapter_job.fail": "workflow.v2.worker_adapter_job.fail",
  "workflow.v2.adapter-job.fail": "workflow.v2.worker_adapter_job.fail",
  "workflow.v2.adapter_runner.preview": "workflow.v2.adapter_runner.preview",
  "workflow.v2.adapter-runner.preview": "workflow.v2.adapter_runner.preview",
  "workflow.v2.worker_adapter_runner.preview": "workflow.v2.adapter_runner.preview",
  "workflow.v2.worker-adapter-runner.preview": "workflow.v2.adapter_runner.preview",
  "workflow.v2.runner.drain.preview": "workflow.v2.adapter_runner.preview",
  "workflow.v2.adapter_runner.drain": "workflow.v2.adapter_runner.drain",
  "workflow.v2.adapter-runner.drain": "workflow.v2.adapter_runner.drain",
  "workflow.v2.worker_adapter_runner.drain": "workflow.v2.adapter_runner.drain",
  "workflow.v2.worker-adapter-runner.drain": "workflow.v2.adapter_runner.drain",
  "workflow.v2.runner.drain": "workflow.v2.adapter_runner.drain",
  "workflow.v2.worker-result.submit.preview": "workflow.v2.worker_result.submit.preview",
  "workflow.v2.worker_result.complete.preview": "workflow.v2.worker_result.submit.preview",
  "workflow.v2.worker-result.complete.preview": "workflow.v2.worker_result.submit.preview",
  "workflow.v2.worker_queue.complete.preview": "workflow.v2.worker_result.submit.preview",
  "workflow.v2.worker-queue.complete.preview": "workflow.v2.worker_result.submit.preview",
  "workflow.v2.worker-result.submit": "workflow.v2.worker_result.submit",
  "workflow.v2.worker_result.complete": "workflow.v2.worker_result.submit",
  "workflow.v2.worker-result.complete": "workflow.v2.worker_result.submit",
  "workflow.v2.worker_queue.complete": "workflow.v2.worker_result.submit",
  "workflow.v2.worker-queue.complete": "workflow.v2.worker_result.submit",
  "workflow.v2.worker-result.fail.preview": "workflow.v2.worker_result.fail.preview",
  "workflow.v2.worker_queue.fail.preview": "workflow.v2.worker_result.fail.preview",
  "workflow.v2.worker-queue.fail.preview": "workflow.v2.worker_result.fail.preview",
  "workflow.v2.worker-result.fail": "workflow.v2.worker_result.fail",
  "workflow.v2.worker_queue.fail": "workflow.v2.worker_result.fail",
  "workflow.v2.worker-queue.fail": "workflow.v2.worker_result.fail",
  "workflow.v2.consistency.validate": "workflow.v2.validate",
  "workflow.v2.validator": "workflow.v2.validate",
  "workflow.template.record-candidate": "workflow.template.record_candidate",
  "workflow.template.candidate.record": "workflow.template.record_candidate",
  "workflow.template.instantiate": "workflow.template.instantiate.record",
  "workflow.template.instantiate.create": "workflow.template.instantiate.record",
  "workflow.template.eval": "workflow.template.eval.record",
  "workflow.template.evaluate.preview": "workflow.template.eval.preview",
  "workflow.template.evaluate": "workflow.template.eval.record",
  "workflow.template.promote": "workflow.template.promote.record",
  "workflow.template.rollback": "workflow.template.rollback.record",
  "workflow.template.extract": "workflow.template.extract.record",
  "runtime.agent": "runtime.agent.upsert",
  "route-shell.ingest": "route_shell.ingest",
  "route_shell.route": "route_shell.ingest",
  "runtime.participant": "meeting.runtime_participant",
  "telegram.live.configure": "telegram.live",
  "dispatch.reconcile": "workflow.dispatch.reconcile",
  "stale_dispatch.reconcile": "workflow.dispatch.reconcile",
  "runtime.bridge": "runtime.bridge.drain",
  "human_gate.review_form": "human_gate.web_app_review",
  "human_gate.submit_form": "human_gate.web_app_submit",
  "human_gate.callback": "human_gate.button_callback",
  "human_gate.submit_feedback": "human_gate.feedback",
  "human_gate.console": "human_gate.inbox",
  "human_gate.batch_inbox": "human_gate.inbox",
  "human_gate.confirm": "human_gate.resume",
  "workflow.message_flow.send": "message_flow.send",
  "message_flow.status": "message_flow.list",
  "workflow.message_flow.list": "message_flow.list",
  "workflow.message_flow.status": "message_flow.list",
  "workflow.message_flow.reconcile": "message_flow.reconcile",
  "protocol.object": "protocol.record",
  "workflow.human_gate": "human_gate.record",
  "execution.intent": "trade.intent",
  "execution.receipt": "trading_core.receipt",
  "side_effect.ledger": "side_effect.record",
  "workflow.incident": "incident.state",
  "tracking.instrument": "instrument.upsert",
  "thesis.create": "thesis.update",
  "human_gate.review": "gate.review",
  "workflow.permission.explain": "workflow.permission.check"
};

async function workflowConvergenceGate(rootDir, action, requestedAction, input = {}) {
  if (WORKFLOW_LEGACY_MUTATING_ACTIONS.has(action)
    && !workflowActionOverrideEnabled(input, "TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS", "allowLegacyAction", "allow_legacy_action", "legacyMode", "legacy_mode")) {
    return workflowActionBlockedResult(
      action,
      requestedAction,
      "legacy_action_disabled",
      "legacy mutating workflow actions are retained for compatibility but are disabled by default; use approved templates for production workflow execution",
      "TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1"
    );
  }
  if (WORKFLOW_GENERIC_ORCHESTRATION_WRITE_ACTIONS.has(action)
    && !workflowActionOverrideEnabled(input, "TRADING_AGENTS_WORKFLOW_ENABLE_GENERIC_ORCHESTRATION", "allowGenericOrchestration", "allow_generic_orchestration", "genericMode", "generic_mode")
    && !(await workflowGenericOrchestrationAuthorized(await ensureWorkflowLayout(rootDir, input), input)).allowed) {
    return workflowActionBlockedResult(
      action,
      requestedAction,
      "generic_orchestration_context_required",
      "generic orchestration entry actions require an approved template plan, approved Human Gate plan, or explicit diagnostics override",
      "TRADING_AGENTS_WORKFLOW_ENABLE_GENERIC_ORCHESTRATION=1"
    );
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normalizeAssetType(value) {
  const assetType = String(value || "stock").trim().toLowerCase();
  return ASSET_TYPES.has(assetType) ? assetType : "other";
}

function normalizeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!symbol) throw new Error("symbol is required");
  if (!/^[A-Z0-9._:/=-]{1,64}$/.test(symbol)) throw new Error(`invalid symbol: ${value}`);
  return symbol;
}

function instrumentId(assetType, symbol) {
  return `${normalizeAssetType(assetType)}:${normalizeSymbol(symbol)}`;
}

function normalizeRequester(value, fallback = "cat_claw") {
  const text = firstText(value, fallback);
  if (text === "catclaw") throw new Error("retired agent id catclaw is invalid; use cat_claw");
  return text;
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readTelegramTargetConfig(paths) {
  const files = [
    path.join(paths.root, "telegram-targets.json"),
    path.join(paths.root, "config", "telegram-targets.json")
  ];
  for (const file of files) {
    const config = await readOptionalJson(file);
    if (config && typeof config === "object") return config;
  }
  return {};
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveHomePath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "~") return process.env.HOME || raw;
  if (raw.startsWith("~/")) return path.join(process.env.HOME || os.homedir(), raw.slice(2));
  return raw;
}

async function readOpenClawConfig() {
  const home = process.env.OPENCLAW_HOME || (process.env.HOME ? path.join(process.env.HOME, ".openclaw") : "");
  const candidates = [
    process.env.OPENCLAW_CONFIG,
    home ? path.join(home, "openclaw.json") : "",
    path.join(os.homedir(), ".openclaw", "openclaw.json")
  ].map(resolveHomePath).filter(Boolean);
  for (const file of [...new Set(candidates)]) {
    const config = await readOptionalJson(file).catch(() => null);
    if (config && typeof config === "object") return config;
  }
  return {};
}

function tradingWorkflowPluginConfig(config = {}) {
  return objectValue(config.plugins?.entries?.["trading-agents-workflow"]?.config);
}

function normalizeHumanGateWebAppRoutePath(value) {
  const raw = String(value || HUMAN_GATE_WEB_APP_ROUTE_PATH).trim();
  if (!raw) return HUMAN_GATE_WEB_APP_ROUTE_PATH;
  return raw.startsWith("/") ? raw.replace(/\/+$/g, "") || "/" : `/${raw.replace(/\/+$/g, "")}`;
}

function normalizeHumanGateWebAppBaseUrl(baseUrl, routePath = HUMAN_GATE_WEB_APP_ROUTE_PATH) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return "";
    const normalizedRoute = normalizeHumanGateWebAppRoutePath(routePath);
    const rawPath = url.pathname.replace(/\/+$/g, "");
    if (!rawPath.endsWith(normalizedRoute)) {
      url.pathname = `${rawPath}/${normalizedRoute.replace(/^\/+/, "")}`.replace(/\/{2,}/g, "/");
    }
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/g, "");
  } catch {
    return "";
  }
}

async function humanGateWebAppConfig(input = {}) {
  const config = await readOpenClawConfig();
  const plugin = tradingWorkflowPluginConfig(config);
  const humanGate = objectValue(plugin.humanGate || plugin.human_gate);
  const routePath = normalizeHumanGateWebAppRoutePath(firstText(
    input.webAppRoutePath,
    input.web_app_route_path,
    process.env.TRADING_AGENTS_WORKFLOW_HG_WEBAPP_ROUTE,
    process.env.TRADING_AGENTS_WORKFLOW_WEB_APP_ROUTE,
    humanGate.webAppRoutePath,
    humanGate.web_app_route_path,
    plugin.humanGateWebAppRoutePath,
    plugin.human_gate_web_app_route_path,
    HUMAN_GATE_WEB_APP_ROUTE_PATH
  ));
  const baseUrl = normalizeHumanGateWebAppBaseUrl(firstText(
    input.webAppBaseUrl,
    input.web_app_base_url,
    process.env.TRADING_AGENTS_WORKFLOW_HG_WEBAPP_BASE_URL,
    process.env.TRADING_AGENTS_WORKFLOW_WEB_APP_BASE_URL,
    humanGate.webAppBaseUrl,
    humanGate.web_app_base_url,
    plugin.humanGateWebAppBaseUrl,
    plugin.human_gate_web_app_base_url
  ), routePath);
  const verifyTelegramInitData = firstText(
    input.verifyTelegramInitData,
    input.verify_telegram_init_data,
    humanGate.verifyTelegramInitData,
    humanGate.verify_telegram_init_data,
    "required"
  );
  const maxInitDataAgeSeconds = Math.max(60, Math.min(7 * 24 * 3600, Number(firstText(
    input.webAppInitDataMaxAgeSeconds,
    input.web_app_init_data_max_age_seconds,
    humanGate.webAppInitDataMaxAgeSeconds,
    humanGate.web_app_init_data_max_age_seconds,
    24 * 3600
  ))));
  const allowedTelegramUserIds = toList(
    input.allowedTelegramUserIds ?? input.allowed_telegram_user_ids ??
    humanGate.allowedTelegramUserIds ?? humanGate.allowed_telegram_user_ids ??
    DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID
  ).map((item) => String(item || "").trim()).filter(Boolean);
  return {
    enabled: Boolean(baseUrl),
    baseUrl,
    routePath,
    verifyTelegramInitData: String(verifyTelegramInitData || "required").trim().toLowerCase(),
    maxInitDataAgeSeconds,
    allowedTelegramUserIds
  };
}

function humanGateWebAppReviewUrl(token, webApp = {}) {
  const callbackToken = String(token || "").trim();
  if (!callbackToken || !webApp.baseUrl) return "";
  const url = new URL(`${webApp.baseUrl.replace(/\/+$/g, "")}/review`);
  url.searchParams.set("token", callbackToken);
  return url.toString();
}

function humanGateWebAppReplyMarkup(buttons = [], webApp = {}) {
  if (!webApp.enabled || !webApp.baseUrl) return null;
  const rows = [];
  for (const [index, button] of buttons.entries()) {
    const callbackToken = String(button.callbackToken || button.callback_token || "").trim();
    const url = humanGateWebAppReviewUrl(callbackToken, webApp);
    if (!url) continue;
    rows.push([{
      text: humanGateButtonDisplayLabel(button, index),
      web_app: { url }
    }]);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

function telegramConfigFromOpenClaw(config = {}) {
  return objectValue(config.channels?.telegram || config.telegram || config.plugins?.entries?.telegram?.config);
}

function telegramAccountConfig(telegram = {}, accountId = "") {
  const normalized = String(accountId || "").trim();
  const accounts = telegram.accounts;
  if (Array.isArray(accounts)) {
    return objectValue(accounts.find((account) => {
      const id = String(account?.id || account?.accountId || account?.account_id || account?.name || "").trim();
      return normalized ? id === normalized : id === "default";
    }) || accounts[0]);
  }
  if (accounts && typeof accounts === "object") {
    return objectValue(accounts[normalized] || accounts.default || Object.values(accounts)[0]);
  }
  return {};
}

async function resolveSecretLike(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const direct = firstText(value.value, value.secret, value.token, value.plaintext, value.plainText);
  if (direct) return direct;
  const envName = firstText(value.env, value.envVar, value.env_var, value.$env, value.fromEnv);
  if (envName && process.env[envName]) return String(process.env[envName]).trim();
  const file = resolveHomePath(firstText(value.file, value.path, value.$file, value.fromFile));
  if (file) {
    try {
      return (await fs.readFile(file, "utf8")).trim();
    } catch {
      return "";
    }
  }
  return "";
}

async function resolveTelegramBotToken(accountId = "", input = {}) {
  const envToken = firstText(
    input.telegramBotToken,
    input.telegram_bot_token,
    process.env.TRADING_AGENTS_WORKFLOW_TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.OPENCLAW_TELEGRAM_BOT_TOKEN
  );
  if (envToken) return envToken;
  const config = await readOpenClawConfig();
  const telegram = telegramConfigFromOpenClaw(config);
  const account = telegramAccountConfig(telegram, accountId);
  for (const candidate of [account.botToken, account.bot_token, account.token, telegram.botToken, telegram.bot_token, telegram.token]) {
    const token = await resolveSecretLike(candidate);
    if (token) return token;
  }
  const tokenFile = resolveHomePath(firstText(account.tokenFile, account.token_file, telegram.tokenFile, telegram.token_file));
  if (!tokenFile) return "";
  try {
    return (await fs.readFile(tokenFile, "utf8")).trim();
  } catch {
    return "";
  }
}

function verifyTelegramWebAppInitData(initData = "", botToken = "", options = {}) {
  const raw = String(initData || "").trim();
  if (!raw) return { ok: false, reason: "missing_init_data" };
  if (!botToken) return { ok: false, reason: "missing_bot_token" };
  const params = new URLSearchParams(raw);
  const receivedHash = params.get("hash") || "";
  if (!receivedHash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const received = Buffer.from(receivedHash, "hex");
  const computed = Buffer.from(computedHash, "hex");
  if (received.length !== computed.length || !timingSafeEqual(received, computed)) return { ok: false, reason: "hash_mismatch" };
  const authDate = Number(params.get("auth_date") || 0);
  const maxAgeSeconds = Number(options.maxAgeSeconds || 0);
  if (authDate && maxAgeSeconds > 0 && Date.now() / 1000 - authDate > maxAgeSeconds) return { ok: false, reason: "init_data_expired", authDate };
  const user = parseJsonValue(params.get("user"), {});
  const userId = String(user?.id || "").trim();
  const allowed = Array.isArray(options.allowedTelegramUserIds) ? options.allowedTelegramUserIds.map((item) => String(item || "").trim()).filter(Boolean) : [];
  if (allowed.length && userId && !allowed.includes(userId)) return { ok: false, reason: "telegram_user_not_allowed", userId };
  return { ok: true, userId, username: user?.username || "", authDate, reason: "" };
}

function targetValue(entry) {
  if (typeof entry === "string") return { chatId: entry, channelId: "" };
  if (!entry || typeof entry !== "object") return { chatId: "", channelId: "" };
  return {
    chatId: String(entry.chatId || entry.chat_id || entry.chat || "").trim(),
    channelId: String(entry.channelId || entry.channel_id || entry.channel || "").trim(),
    humanGateChannelId: String(entry.humanGateChannelId || entry.human_gate_channel_id || "").trim()
  };
}

function lookupTelegramAlias(config, key) {
  const trimmed = String(key || "").trim();
  if (!trimmed) return null;
  const aliases = config.aliases || config.targets || {};
  const entry = aliases[trimmed] || aliases[trimmed.toLowerCase()];
  return entry ? targetValue(entry) : null;
}

async function resolveTelegramLiveTarget(paths, meetingId, input) {
  const direct = {
    chatId: String(input.chatId || input.chat_id || "").trim(),
    channelId: String(input.channelId || input.channel_id || "").trim(),
    humanGateChannelId: String(input.humanGateChannelId || input.human_gate_channel_id || "").trim()
  };
  if (direct.chatId || direct.channelId) return { ...direct, source: "input" };

  const config = await readTelegramTargetConfig(paths);
  const targetKeys = [
    input.targetRef,
    input.target_ref,
    input.target,
    input.targetName,
    input.target_name,
    input.telegramTarget,
    input.telegram_target,
    input.groupName,
    input.group_name
  ];
  for (const key of targetKeys) {
    const match = lookupTelegramAlias(config, key);
    if (match && (match.chatId || match.channelId)) return { ...match, source: "alias" };
  }

  const rules = config.meetingPatterns || config.meeting_patterns || [];
  for (const rule of Array.isArray(rules) ? rules : []) {
    const pattern = String(rule.pattern || rule.match || "").trim();
    if (!pattern) continue;
    const flags = rule.caseSensitive || rule.case_sensitive ? "" : "i";
    if (new RegExp(pattern, flags).test(meetingId)) {
      const match = targetValue(rule);
      if (match.chatId || match.channelId) return { ...match, source: "meeting_pattern" };
    }
  }

  const fallback = targetValue(config.default || config.defaultTarget || config.default_target);
  if (fallback.chatId || fallback.channelId) return { ...fallback, source: "default" };
  return { ...direct, source: "unresolved" };
}

function nestedProtocolPayload(protocolObject = {}) {
  protocolObject = protocolObject || {};
  const outer = parseJsonValue(protocolObject.payload || protocolObject.payload_json, {});
  return parseJsonValue(outer.payload, outer.payload || {});
}

function protocolPayloadField(protocolObject = {}, keys = []) {
  const body = nestedProtocolPayload(protocolObject);
  const raw = parseJsonValue(body.raw, body.raw || {});
  for (const key of keys) {
    const value = firstText(body[key], raw[key]);
    if (value) return String(value).trim();
  }
  return "";
}

function protocolPayloadValue(protocolObject = {}, keys = []) {
  const body = nestedProtocolPayload(protocolObject);
  const raw = parseJsonValue(body.raw, body.raw || {});
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") return body[key];
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") return raw[key];
  }
  return undefined;
}

function protocolObjectReferences(protocolObject = {}, objectId = "") {
  const needle = String(objectId || "").trim();
  if (!needle) return false;
  if (String(protocolObject.parent_object_id || "").trim() === needle) return true;
  const body = nestedProtocolPayload(protocolObject);
  const raw = parseJsonValue(body.raw, body.raw || {});
  const fields = [
    body.proposalId,
    body.proposal_id,
    body.riskDecisionId,
    body.risk_decision_id,
    body.preOrderRiskAuditId,
    body.pre_order_risk_audit_id,
    body.humanGateId,
    body.human_gate_id,
    body.workflowId,
    body.workflow_id,
    raw.proposalId,
    raw.proposal_id,
    raw.riskDecisionId,
    raw.risk_decision_id,
    raw.preOrderRiskAuditId,
    raw.pre_order_risk_audit_id,
    raw.humanGateId,
    raw.human_gate_id,
    raw.workflowId,
    raw.workflow_id
  ];
  return fields.some((value) => String(value || "").trim() === needle);
}

function workflowPayloadSqlWhere(workflowId, { payloadColumn = "payload_json", parentColumn = "parent_object_id" } = {}) {
  const value = sqlValue(workflowId);
  const parentClause = parentColumn ? `${parentColumn}=${value} OR ` : "";
  return `(
    ${parentClause}json_extract(${payloadColumn}, '$.workflowId')=${value}
    OR json_extract(${payloadColumn}, '$.workflow_id')=${value}
    OR json_extract(${payloadColumn}, '$.workflow.workflowId')=${value}
    OR json_extract(${payloadColumn}, '$.workflow.id')=${value}
    OR json_extract(${payloadColumn}, '$.payload.workflowId')=${value}
    OR json_extract(${payloadColumn}, '$.payload.workflow_id')=${value}
    OR json_extract(${payloadColumn}, '$.payload.workflow.id')=${value}
    OR json_extract(${payloadColumn}, '$.raw.workflowId')=${value}
    OR json_extract(${payloadColumn}, '$.raw.workflow_id')=${value}
  )`;
}

function dispatchPayloadReferences(payload = {}, objectId = "") {
  const needle = String(objectId || "").trim();
  if (!needle) return false;
  const fields = [
    payload.humanGateId,
    payload.human_gate_id,
    payload.proposalId,
    payload.proposal_id,
    payload.tradeProposalId,
    payload.trade_proposal_id,
    payload.preOrderRiskAuditId,
    payload.pre_order_risk_audit_id,
    payload.workflowId,
    payload.workflow_id
  ];
  return fields.some((value) => String(value || "").trim() === needle);
}

async function findCatTailPreOrderRiskAuditDispatch(paths, { workflowId = "", humanGateId = "", proposalId = "", preOrderRiskAuditId = "" } = {}) {
  const rows = await sqlite(paths.dbFile, `
SELECT dispatch_id, workflow_id, meeting_id, runtime, agent_id, dispatch_type, status, payload_json, created_at, updated_at
FROM mixed_meeting_dispatches
WHERE runtime='openclaw'
  AND agent_id='cat_tail'
  AND dispatch_type='pre_order_risk_audit'
  AND status NOT IN ('failed','cancelled')
ORDER BY created_at DESC
LIMIT 200;`, { json: true });
  for (const row of rows) {
    const payload = parseJsonValue(row.payload_json, {});
    const body = parseJsonValue(payload.payload, payload.payload || {});
    if (workflowId && String(row.workflow_id || payload.workflowId || payload.workflow_id || body.workflowId || body.workflow_id || "").trim() !== String(workflowId).trim()) continue;
    if (!dispatchPayloadReferences(payload, humanGateId) && !dispatchPayloadReferences(body, humanGateId)) continue;
    if (!dispatchPayloadReferences(payload, proposalId) && !dispatchPayloadReferences(body, proposalId)) continue;
    if (!dispatchPayloadReferences(payload, preOrderRiskAuditId) && !dispatchPayloadReferences(body, preOrderRiskAuditId)) continue;
    return { ...row, payload, body };
  }
  return null;
}

function normalizeRuntime(value) {
  const raw = String(value || "openclaw").trim().toLowerCase();
  const runtime = raw === "hermes" || raw === "hermes_acp" ? "hermers" : raw;
  return RUNTIMES.has(runtime) ? runtime : "other";
}

function normalizeKnownRuntime(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const runtime = raw === "hermes" || raw === "hermes_acp" ? "hermers" : raw;
  return RUNTIMES.has(runtime) ? runtime : "";
}

function normalizeRegistryToken(value, fallback = "") {
  return String(value || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .slice(0, 96);
}

function normalizeAgentPlatform(value, runtime = "") {
  const explicit = normalizeRegistryToken(value);
  if (explicit) {
    if (explicit === "hermes" || explicit === "hermes_acp") return "hermers";
    return explicit;
  }
  if (!String(runtime || "").trim()) return "";
  const normalizedRuntime = normalizeRuntime(runtime);
  if (normalizedRuntime === "openclaw_route_shell") return "openclaw";
  if (normalizedRuntime === "hermers") return "hermers";
  if (normalizedRuntime === "openclaw") return "openclaw";
  return normalizedRuntime || "other";
}

function normalizeExecutionAdapter(value, platform = "", runtime = "") {
  const explicit = normalizeRegistryToken(value);
  if (explicit) return explicit === "hermes_acp" ? "acp" : explicit;
  if (!String(platform || "").trim() && !String(runtime || "").trim()) return "";
  const normalizedRuntime = normalizeRuntime(runtime);
  if (normalizedRuntime === "openclaw_route_shell") return "route_shell";
  if (normalizedRuntime === "openclaw") return "native";
  if (normalizeAgentPlatform(platform, runtime) === "hermers") return "acp";
  return "adapter";
}

function normalizeImIngressOwner(value, platform = "", runtime = "") {
  const explicit = normalizeRegistryToken(value);
  if (explicit) return explicit;
  if (!String(platform || "").trim() && !String(runtime || "").trim()) return "";
  const normalizedRuntime = normalizeRuntime(runtime);
  if (normalizedRuntime === "openclaw" || normalizedRuntime === "openclaw_route_shell") return "openclaw_gateway";
  if (normalizeAgentPlatform(platform, runtime) === "openclaw") return "openclaw_gateway";
  return "external_platform";
}

function normalizeImIngressAdapter(value, owner = "", runtime = "") {
  const explicit = normalizeRegistryToken(value);
  if (explicit) return explicit;
  if (!String(owner || "").trim() && !String(runtime || "").trim()) return "";
  const normalizedRuntime = normalizeRuntime(runtime);
  if (normalizedRuntime === "openclaw_route_shell") return "openclaw_route_shell";
  if (normalizedRuntime === "openclaw") return "openclaw_native";
  if (normalizeRegistryToken(owner) === "openclaw_gateway") return "openclaw_route_shell";
  return "platform_im";
}

function normalizeWorkflowIngressAdapter(value, platform = "", runtime = "") {
  const explicit = normalizeRegistryToken(value);
  if (explicit) return explicit === "hermes_acp" ? "acp" : explicit;
  if (!String(platform || "").trim() && !String(runtime || "").trim()) return "";
  const normalizedRuntime = normalizeRuntime(runtime);
  if (normalizedRuntime === "openclaw_route_shell") return "route_shell";
  if (normalizedRuntime === "openclaw") return "openclaw_native";
  if (normalizeAgentPlatform(platform, runtime) === "hermers") return "acp";
  return "adapter";
}

function normalizeImIdentity(value, owner = "", adapter = "", runtime = "") {
  const explicit = normalizeRegistryToken(value);
  if (explicit) return explicit;
  const normalizedRuntime = normalizeRuntime(runtime);
  const normalizedOwner = normalizeRegistryToken(owner);
  const normalizedAdapter = normalizeRegistryToken(adapter);
  if (normalizedRuntime === "openclaw_route_shell" || normalizedAdapter === "openclaw_route_shell") return "openclaw_route_shell";
  if (normalizedRuntime === "openclaw" || normalizedAdapter === "openclaw_native") return "openclaw_native";
  if (normalizedOwner && normalizedAdapter) return `${normalizedOwner}:${normalizedAdapter}`.slice(0, 96);
  return normalizedAdapter || normalizedOwner || "";
}

function normalizeExecutionIdentity(value, platform = "", workflowIngressAdapter = "", runtime = "") {
  const explicit = normalizeRegistryToken(value);
  if (explicit) return explicit;
  const normalizedRuntime = normalizeRuntime(runtime);
  const normalizedPlatform = normalizeAgentPlatform(platform, runtime);
  const normalizedAdapter = normalizeWorkflowIngressAdapter(workflowIngressAdapter, normalizedPlatform, runtime);
  if (normalizedRuntime === "openclaw_route_shell") return "openclaw_route_shell";
  if (normalizedRuntime === "openclaw" || (normalizedPlatform === "openclaw" && normalizedAdapter === "openclaw_native")) return "openclaw_native";
  if (normalizedPlatform === "hermers" && normalizedAdapter === "acp") return "hermers_acp";
  if (normalizedPlatform && normalizedAdapter) return `${normalizedPlatform}_${normalizedAdapter}`.slice(0, 96);
  return normalizedPlatform || normalizedAdapter || "";
}

function normalizeReturnPolicy(value, fallback = "silent") {
  const explicit = normalizeRegistryToken(value);
  const aliases = {
    reply: "reply_to_source_chat",
    reply_to_source: "reply_to_source_chat",
    source_chat: "reply_to_source_chat",
    telegram_source: "reply_to_source_chat",
    report: "report_to_flashcat",
    flashcat: "report_to_flashcat",
    none: "silent",
    disabled: "silent"
  };
  const normalized = aliases[explicit] || explicit;
  if (MESSAGE_FLOW_RETURN_POLICIES.has(normalized)) return normalized;
  return MESSAGE_FLOW_RETURN_POLICIES.has(fallback) ? fallback : "silent";
}

function registrySnapshot(row = {}) {
  return {
    agentKey: row.agent_key || "",
    agentId: row.agent_id || "",
    platform: row.platform || normalizeAgentPlatform("", row.runtime),
    executionAdapter: row.execution_adapter || normalizeExecutionAdapter("", row.platform, row.runtime),
    imIngressOwner: row.im_ingress_owner || normalizeImIngressOwner("", row.platform, row.runtime),
    imIngressAdapter: row.im_ingress_adapter || normalizeImIngressAdapter("", row.im_ingress_owner, row.runtime),
    workflowIngressAdapter: row.workflow_ingress_adapter || normalizeWorkflowIngressAdapter("", row.platform, row.runtime),
    imIdentity: row.im_identity || normalizeImIdentity("", row.im_ingress_owner, row.im_ingress_adapter, row.runtime),
    executionIdentity: row.execution_identity || normalizeExecutionIdentity("", row.platform, row.workflow_ingress_adapter, row.runtime),
    returnPolicy: normalizeReturnPolicy(row.return_policy, "silent"),
    canReceiveDispatch: Number(row.can_receive_dispatch ?? 1) !== 0,
    canStartWorkflow: Number(row.can_start_workflow ?? 1) !== 0,
    gatewayProxyAllowed: Number(row.gateway_proxy_allowed ?? 1) !== 0,
    endpointRef: row.endpoint_ref || ""
  };
}

function normalizeAgentId(value) {
  const agentId = String(value || "").trim();
  if (!agentId) throw new Error("agentId is required");
  if (agentId === "catclaw") throw new Error("retired agent id catclaw is invalid; use cat_claw");
  return agentId.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 96);
}

function normalizeOptionalAgentId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return normalizeAgentId(text);
}

export function canonicalWorkflowAction(action) {
  const raw = String(action || "workflow.status").trim();
  return WORKFLOW_ACTION_ALIASES[raw] || raw;
}

const PERMISSION_CORE = createPermissionCore({
  canonicalWorkflowAction,
  normalizeOptionalAgentId,
  normalizeRuntime
});

const {
  evaluateWorkflowPermission,
  isWorkflowPolicyHardGateAction,
  isWorkflowTrustedOperator,
  permissionEvidencePresent,
  workflowPermissionCaller
} = PERMISSION_CORE;

async function authorizeWorkflowAction(rootDir, input = {}) {
  const action = canonicalWorkflowAction(input.action || "workflow.status");
  if (action === "workflow.permission.check") return null;
  if (WORKFLOW_PURE_PREVIEW_ACTIONS.has(action)) {
    return {
      allowed: true,
      action,
      originalAction: String(input.action || ""),
      risk: "low",
      mutating: false,
      readOnly: true,
      requiredCapability: "read",
      caller: workflowPermissionCaller(input),
      registered: false,
      reason: "pure_preview_allowed",
      row: null
    };
  }
  const paths = await ensureWorkflowLayout(rootDir, input);
  const decision = await evaluateWorkflowPermission(paths, input);
  if (!decision.allowed) {
    await appendWorkflowEvent(paths, {
      eventType: "permission.denied",
      status: "denied",
      workflowId: input.workflowId || input.workflow_id || "",
      traceId: input.traceId || input.trace_id || "",
      actor: decision.caller.agentId || "unknown",
      sourceRuntime: decision.caller.runtime || "",
      sourceAgent: decision.caller.agentId || "",
      nextState: decision.reason,
      payload: {
        action: decision.action,
        originalAction: decision.originalAction,
        risk: decision.risk,
        requiredCapability: decision.requiredCapability,
        reason: decision.reason
      }
    }).catch(() => {});
    throw new Error(`workflow permission denied: action=${decision.action} caller=${decision.caller.agentId || "<local>"} requiredCapability=${decision.requiredCapability} reason=${decision.reason}`);
  }
  if (isWorkflowPolicyHardGateAction(action) && decision.actionable === false) {
    await appendWorkflowEvent(paths, {
      eventType: "permission.policy_blocked",
      status: "denied",
      workflowId: input.workflowId || input.workflow_id || "",
      traceId: input.traceId || input.trace_id || "",
      actor: decision.caller.agentId || "unknown",
      sourceRuntime: decision.caller.runtime || "",
      sourceAgent: decision.caller.agentId || "",
      nextState: decision.policyOutcome || "policy_blocked",
      payload: {
        action: decision.action,
        originalAction: decision.originalAction,
        risk: decision.risk,
        requiredCapability: decision.requiredCapability,
        policyOutcome: decision.policyOutcome,
        requirements: decision.requirements || []
      }
    }).catch(() => {});
    throw new Error(`workflow policy blocked: action=${decision.action} policyOutcome=${decision.policyOutcome || "unknown"} requirements=${(decision.requirements || []).map((item) => item.type).join(",") || "none"}`);
  }
  return decision;
}

function normalizeMeetingRef(value) {
  const meetingId = String(value || "").trim();
  if (!meetingId) throw new Error("meetingId is required");
  return cleanFileSegment(meetingId).slice(0, 120);
}

function normalizeIsoTimestamp(value, fieldName = "timestamp") {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${fieldName}: ${text}`);
  return date.toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.max(0, Math.min(100, number));
}

function cleanFileSegment(value) {
  return String(value).trim().replace(/[^a-zA-Z0-9._=-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "item";
}

async function writeJsonAtomic(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureLegacyWorkflowV2PlanColumnsForInit(dbFile) {
  const existing = await tableColumns(dbFile, "workflow_v2_plans");
  if (!existing.size) return;
  await ensureColumns(dbFile, "workflow_v2_plans", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_revision", "INTEGER NOT NULL DEFAULT 1"],
    ["status", "TEXT NOT NULL DEFAULT 'draft'"],
    ["workflow_state", "TEXT NOT NULL DEFAULT 'draft'"],
    ["task_owner_agent", "TEXT NOT NULL DEFAULT ''"],
    ["planner_agent", "TEXT NOT NULL DEFAULT 'main'"],
    ["objective", "TEXT NOT NULL DEFAULT ''"],
    ["participant_managers_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["acceptance_criteria_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["constraints_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["human_gate_policy_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["plan_spec_artifact_ref", "TEXT NOT NULL DEFAULT ''"],
    ["plan_spec_artifact_hash", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
}

async function ensureWorkflowLayout(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  await Promise.all([
    fs.mkdir(paths.researchDir, { recursive: true }),
    fs.mkdir(paths.thesisDir, { recursive: true }),
    fs.mkdir(paths.radarDir, { recursive: true }),
    fs.mkdir(paths.evidenceDir, { recursive: true }),
    fs.mkdir(paths.memosDir, { recursive: true }),
    fs.mkdir(paths.gatesDir, { recursive: true }),
    fs.mkdir(paths.artifactsDir, { recursive: true }),
    fs.mkdir(paths.checkpointsDir, { recursive: true }),
    fs.mkdir(paths.protocolDir, { recursive: true }),
    fs.mkdir(paths.intentsDir, { recursive: true }),
    fs.mkdir(paths.receiptsDir, { recursive: true }),
    fs.mkdir(paths.bridgeDir, { recursive: true }),
    fs.mkdir(paths.dispatchesDir, { recursive: true }),
    fs.mkdir(paths.messagesDir, { recursive: true }),
    fs.mkdir(paths.telegramDir, { recursive: true }),
    fs.mkdir(paths.humanGateDir, { recursive: true }),
    fs.mkdir(paths.humanGateInboxDir, { recursive: true }),
    fs.mkdir(paths.workflowsDir, { recursive: true }),
    fs.mkdir(paths.templatesDir, { recursive: true }),
    fs.mkdir(paths.exportsDir, { recursive: true }),
    fs.mkdir(paths.registryDir, { recursive: true }),
    fs.mkdir(paths.indexDir, { recursive: true })
  ]);
  await initDatabase(paths.dbFile);
  await ensureLegacyDbAlias(paths);
  await ensureWorkflowTemplates(paths);
  return paths;
}

async function ensureLegacyDbAlias(paths) {
  if (path.resolve(paths.dbFile) !== path.resolve(paths.primaryDbFile)) return;
  try {
    const existing = await fs.lstat(paths.legacyDbFile);
    if (existing.isSymbolicLink()) {
      const target = await fs.readlink(paths.legacyDbFile);
      if (target === WORKFLOW_CONTROL_PLANE_DB || path.resolve(paths.root, target) === path.resolve(paths.primaryDbFile)) return;
    }
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
  try {
    await fs.symlink(WORKFLOW_CONTROL_PLANE_DB, paths.legacyDbFile);
  } catch {
    // Compatibility alias is best-effort; all governed code uses primaryDbFile.
  }
}

async function ensureWorkflowTemplates(paths) {
  const templates = {
    "thesis-card.md": "# Thesis Card\n\n## Thesis\n\n## Evidence\n\n## Falsification Triggers\n\n## Next Review\n",
    "evidence-pack.md": "# Evidence Pack\n\n## Source\n\n## Summary\n\n## Supports\n\n## Conflicts\n",
    "research-memo.md": "# Research Memo\n\n## Question\n\n## Evidence\n\n## Conclusion\n\n## Next Steps\n"
  };
  for (const [name, content] of Object.entries(templates)) {
    const filePath = path.join(paths.templatesDir, name);
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, content, "utf8");
    }
  }
}

async function initDatabase(dbFile) {
  await ensureLegacyWorkflowV2PlanColumnsForInit(dbFile);
  const schema = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS instruments (
  instrument_id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  exchange TEXT,
  currency TEXT,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_instruments_asset_symbol ON instruments(asset_type, symbol);
CREATE TABLE IF NOT EXISTS tracking_states (
  instrument_id TEXT PRIMARY KEY REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  research_state TEXT,
  radar_zone TEXT,
  retail_heat_score REAL,
  news_catalyst_score REAL,
  fundamental_score REAL,
  sentiment_stage TEXT,
  fundamental_trend TEXT,
  valuation_state TEXT,
  thesis_status TEXT,
  thesis_path TEXT,
  last_evidence_at TEXT,
  last_memo_at TEXT,
  last_review_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_scores (
  score_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  radar_zone TEXT,
  retail_heat_score REAL,
  news_catalyst_score REAL,
  fundamental_score REAL,
  sentiment_stage TEXT,
  source_reliability TEXT,
  catalyst_window TEXT,
  fundamental_trend TEXT,
  valuation_state TEXT,
  confidence TEXT,
  summary TEXT,
  evidence_paths_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_radar_scores_instrument_asof ON radar_scores(instrument_id, as_of DESC);
CREATE TABLE IF NOT EXISTS thesis_index (
  thesis_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  title TEXT,
  path TEXT NOT NULL,
  summary TEXT,
  falsification_triggers TEXT,
  owner_agent TEXT NOT NULL,
  review_due_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thesis_instrument ON thesis_index(instrument_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS evidence_items (
  evidence_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source TEXT,
  reliability TEXT,
  path TEXT NOT NULL,
  summary TEXT,
  supports TEXT,
  conflicts TEXT,
  captured_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_instrument ON evidence_items(instrument_id, captured_at DESC);
CREATE TABLE IF NOT EXISTS research_memos (
  memo_id TEXT PRIMARY KEY,
  instrument_id TEXT NOT NULL REFERENCES instruments(instrument_id) ON DELETE CASCADE,
  memo_type TEXT NOT NULL,
  path TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  conclusion TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memos_instrument ON research_memos(instrument_id, created_at DESC);
CREATE TABLE IF NOT EXISTS review_gates (
  gate_id TEXT PRIMARY KEY,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  workflow_id TEXT,
  gate_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  reviewer_agent TEXT,
  human_gate_required INTEGER NOT NULL DEFAULT 0,
  resume_pointer TEXT,
  expires_at TEXT,
  decision_at TEXT,
  approver TEXT,
  evidence_paths_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_runs (
  workflow_id TEXT PRIMARY KEY,
  workflow_type TEXT NOT NULL,
  status TEXT NOT NULL,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  owner_agent TEXT NOT NULL,
  summary TEXT,
  objective TEXT,
  acceptance_criteria TEXT,
  stop_condition TEXT,
  current_phase TEXT,
  current_decision TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_phases (
  phase_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned',
  owner_agent TEXT,
  owner_agents_json TEXT NOT NULL DEFAULT '[]',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  verifier_agent TEXT,
  human_gate_required INTEGER NOT NULL DEFAULT 0,
  plan_node_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_phases_workflow_key ON workflow_phases(workflow_id, phase_key);
CREATE INDEX IF NOT EXISTS idx_workflow_phases_workflow ON workflow_phases(workflow_id, ordinal, phase_key);
CREATE TABLE IF NOT EXISTS workflow_tasks (
  task_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  parent_task_id TEXT,
  phase TEXT,
  owner_agent TEXT NOT NULL,
  runtime TEXT,
  agent_id TEXT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  expected_artifact TEXT,
  actual_artifact_ref TEXT,
  receipt_required INTEGER NOT NULL DEFAULT 1,
  human_gate_required INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  prompt TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  blocked_reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  due_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_workflow ON workflow_tasks(workflow_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_tasks_owner ON workflow_tasks(owner_agent, status, created_at);
CREATE TABLE IF NOT EXISTS workflow_task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id, depends_on_task_id),
  FOREIGN KEY(task_id) REFERENCES workflow_tasks(task_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends ON workflow_task_dependencies(depends_on_task_id);
CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT,
  decision TEXT,
  summary TEXT,
  resume_payload_json TEXT NOT NULL,
  active_tasks_json TEXT NOT NULL DEFAULT '[]',
  blocked_tasks_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  next_actions_json TEXT NOT NULL DEFAULT '[]',
  context_budget_json TEXT NOT NULL DEFAULT '{}',
  path TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workflow_id) REFERENCES workflow_runs(workflow_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_workflow ON workflow_checkpoints(workflow_id, created_at DESC);
CREATE TABLE IF NOT EXISTS workflow_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'recorded',
  workflow_id TEXT,
  trace_id TEXT,
  task_id TEXT,
  dispatch_id TEXT,
  runtime_run_id TEXT,
  message_flow_id TEXT,
  human_gate_id TEXT,
  side_effect_id TEXT,
  incident_id TEXT,
  actor TEXT,
  source_runtime TEXT,
  source_agent TEXT,
  previous_state TEXT,
  next_state TEXT,
  idempotency_key TEXT,
  artifact_ref TEXT,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_events_workflow ON workflow_events(workflow_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_events_trace ON workflow_events(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(event_type, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_events_idempotency ON workflow_events(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE TABLE IF NOT EXISTS workflow_verification_results (
  verification_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  phase_id TEXT,
  phase_key TEXT,
  task_id TEXT,
  agent_run_id TEXT,
  dispatch_id TEXT,
  runtime_run_id TEXT,
  result_type TEXT NOT NULL,
  decision TEXT NOT NULL,
  verifier_agent TEXT,
  refuter_agent TEXT,
  source_runtime TEXT,
  source_agent TEXT,
  confidence TEXT,
  risk_band TEXT,
  summary TEXT,
  findings_json TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_verification_workflow ON workflow_verification_results(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_verification_phase ON workflow_verification_results(workflow_id, phase_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_verification_task ON workflow_verification_results(workflow_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_verification_decision ON workflow_verification_results(workflow_id, decision, created_at DESC);
CREATE TABLE IF NOT EXISTS workflow_session_packs (
  session_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  owner_agent TEXT NOT NULL,
  task_type TEXT NOT NULL,
  runtime_target TEXT NOT NULL,
  purpose TEXT NOT NULL,
  system_brief TEXT NOT NULL DEFAULT '',
  working_context_json TEXT NOT NULL DEFAULT '{}',
  tool_policy_json TEXT NOT NULL DEFAULT '{}',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  checkpoint_refs_json TEXT NOT NULL DEFAULT '[]',
  resource_budget_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  pack_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_packs_owner ON workflow_session_packs(owner_agent, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_packs_task_type ON workflow_session_packs(task_type, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_session_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workflow_session_packs(session_id) ON DELETE RESTRICT,
  pack_version INTEGER NOT NULL,
  workflow_id TEXT,
  task_id TEXT,
  dispatch_id TEXT,
  worker_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  worker_input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  receipt_ref TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_runs_session ON workflow_session_runs(session_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_runs_workflow ON workflow_session_runs(workflow_id, task_id, created_at DESC);
CREATE TABLE IF NOT EXISTS workflow_agent_runs (
  agent_run_id TEXT PRIMARY KEY,
  workflow_id TEXT,
  phase_id TEXT,
  phase_key TEXT,
  task_id TEXT,
  dispatch_id TEXT,
  runtime_run_id TEXT,
  session_run_id TEXT,
  runtime TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  input_hash TEXT,
  output_hash TEXT,
  receipt_ref TEXT,
  error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_agent_runs_workflow ON workflow_agent_runs(workflow_id, phase_key, task_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_agent_runs_dispatch ON workflow_agent_runs(dispatch_id, runtime_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_agent_runs_session ON workflow_agent_runs(session_run_id);
CREATE TABLE IF NOT EXISTS artifact_index (
  artifact_id TEXT PRIMARY KEY,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  workflow_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  summary TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS protocol_objects (
  object_id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  status TEXT NOT NULL,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  source_system TEXT,
  source_agent TEXT,
  parent_object_id TEXT,
  path TEXT,
  payload_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_protocol_objects_type_status ON protocol_objects(object_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_protocol_objects_instrument ON protocol_objects(instrument_id, created_at DESC);
CREATE TABLE IF NOT EXISTS executable_trade_intents (
  intent_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  instrument_id TEXT REFERENCES instruments(instrument_id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL,
  order_type TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  risk_decision_id TEXT NOT NULL,
  human_gate_id TEXT NOT NULL,
  source_system TEXT NOT NULL,
  actor TEXT NOT NULL,
  assurance TEXT NOT NULL,
  client_cert_fingerprint TEXT,
  idempotency_key TEXT,
  intent_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_intents_idempotency ON executable_trade_intents(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_trade_intents_status ON executable_trade_intents(status, created_at DESC);
CREATE TABLE IF NOT EXISTS trading_core_receipts (
  receipt_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES executable_trade_intents(intent_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  trading_core_ref TEXT,
  source_system TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trading_core_receipts_intent ON trading_core_receipts(intent_id, created_at DESC);
CREATE TABLE IF NOT EXISTS side_effect_ledger (
  side_effect_id TEXT PRIMARY KEY,
  trace_id TEXT,
  workflow_id TEXT,
  dispatch_id TEXT,
  idempotency_key TEXT,
  owner_agent TEXT,
  side_effect_type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_hash TEXT,
  output_hash TEXT,
  artifact_ref TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_agents (
  agent_key TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  display_name TEXT,
  role TEXT,
  status TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  execution_adapter TEXT NOT NULL DEFAULT '',
  im_ingress_owner TEXT NOT NULL DEFAULT '',
  im_ingress_adapter TEXT NOT NULL DEFAULT '',
  workflow_ingress_adapter TEXT NOT NULL DEFAULT '',
  im_identity TEXT NOT NULL DEFAULT '',
  execution_identity TEXT NOT NULL DEFAULT '',
  return_policy TEXT NOT NULL DEFAULT '',
  can_receive_dispatch INTEGER NOT NULL DEFAULT 1,
  can_start_workflow INTEGER NOT NULL DEFAULT 1,
  gateway_proxy_allowed INTEGER NOT NULL DEFAULT 1,
  routing_policy_json TEXT NOT NULL DEFAULT '{}',
  endpoint_ref TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_agents_runtime_id ON runtime_agents(runtime, agent_id);
CREATE TABLE IF NOT EXISTS mixed_meeting_participants (
  meeting_id TEXT NOT NULL,
  agent_key TEXT NOT NULL REFERENCES runtime_agents(agent_key) ON DELETE CASCADE,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  participant_role TEXT NOT NULL,
  chair INTEGER NOT NULL DEFAULT 0,
  decider INTEGER NOT NULL DEFAULT 0,
  secretary INTEGER NOT NULL DEFAULT 0,
  live_mode TEXT NOT NULL DEFAULT 'transparent',
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(meeting_id, agent_key)
);
CREATE INDEX IF NOT EXISTS idx_mixed_participants_meeting ON mixed_meeting_participants(meeting_id, runtime, agent_id);
CREATE TABLE IF NOT EXISTS mixed_meeting_messages (
  message_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_key TEXT,
  message_type TEXT NOT NULL,
  phase TEXT,
  text TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  telegram_live_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mixed_messages_meeting ON mixed_meeting_messages(meeting_id, created_at);
CREATE TABLE IF NOT EXISTS mixed_meeting_dispatches (
  dispatch_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  workflow_id TEXT,
  trace_id TEXT,
  idempotency_key TEXT,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_key TEXT,
  dispatch_type TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  next_retry_at TEXT,
  failure_type TEXT,
  last_error TEXT,
  prompt TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  acked_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mixed_dispatches_status ON mixed_meeting_dispatches(status, runtime, created_at);
CREATE TABLE IF NOT EXISTS runtime_runs (
  runtime_run_id TEXT PRIMARY KEY,
  dispatch_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  workflow_id TEXT,
  trace_id TEXT,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  backend TEXT,
  acp_agent TEXT,
  session_key TEXT,
  status TEXT NOT NULL,
  failure_type TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  latency_ms INTEGER,
  message_id TEXT,
  input_hash TEXT,
  output_hash TEXT,
  error TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_dispatch ON runtime_runs(dispatch_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_runs_trace ON runtime_runs(trace_id, started_at DESC);
CREATE TABLE IF NOT EXISTS runtime_semantic_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_sequence INTEGER NOT NULL DEFAULT 0,
  workflow_id TEXT,
  task_id TEXT,
  dispatch_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  parent_event_id TEXT,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  runtime_session_id TEXT,
  runtime_run_id TEXT,
  acp_turn_id TEXT,
  prompt_id TEXT,
  stage TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  blocked_reason TEXT,
  interruption_class TEXT,
  interrupted_dispatch_id TEXT,
  supersedes_dispatch_id TEXT,
  artifact_uri TEXT,
  artifact_type TEXT,
  artifact_sha256 TEXT,
  artifact_reason TEXT,
  latest_receipt_ref TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  tool_name TEXT,
  tool_call_id TEXT,
  duration_ms INTEGER,
  exit_code INTEGER,
  cwd TEXT,
  git_head TEXT,
  model TEXT,
  provider TEXT,
  privacy_class TEXT NOT NULL DEFAULT 'internal',
  redaction_status TEXT NOT NULL DEFAULT 'redacted',
  ttl TEXT,
  error_class TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  idempotency_key TEXT,
  side_effect_ref TEXT,
  payload_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_semantic_events_dispatch ON runtime_semantic_events(dispatch_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_semantic_events_agent ON runtime_semantic_events(runtime, agent_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_semantic_events_workflow ON runtime_semantic_events(workflow_id, event_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_semantic_events_idempotency ON runtime_semantic_events(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE TABLE IF NOT EXISTS runtime_current_state (
  state_key TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  endpoint_ref TEXT,
  active_workflow_id TEXT,
  task_id TEXT,
  active_dispatch_id TEXT,
  trace_id TEXT,
  runtime_session_id TEXT,
  runtime_run_id TEXT,
  acp_turn_id TEXT,
  prompt_id TEXT,
  current_stage TEXT,
  stage_status TEXT NOT NULL DEFAULT '',
  semantic_ack_at TEXT,
  last_event_id TEXT,
  last_event_at TEXT,
  last_event_sequence INTEGER NOT NULL DEFAULT 0,
  latest_artifact_ref TEXT,
  latest_receipt_ref TEXT,
  blocked_reason TEXT,
  interruption_class TEXT,
  interrupted_dispatch_id TEXT,
  stale_kind TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_current_state_runtime_agent ON runtime_current_state(runtime, agent_id);
CREATE INDEX IF NOT EXISTS idx_runtime_current_state_workflow ON runtime_current_state(active_workflow_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_current_state_dispatch ON runtime_current_state(active_dispatch_id);
CREATE TABLE IF NOT EXISTS telegram_live_links (
  meeting_id TEXT PRIMARY KEY,
  chat_id TEXT,
  channel_id TEXT,
  mode TEXT NOT NULL DEFAULT 'transparent',
  status TEXT NOT NULL DEFAULT 'active',
  human_gate_channel_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_outbox (
  outbox_id TEXT PRIMARY KEY,
  meeting_id TEXT,
  target_kind TEXT NOT NULL,
  target_ref TEXT,
  message_type TEXT NOT NULL,
  status TEXT NOT NULL,
  text TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegram_outbox_status ON telegram_outbox(status, created_at);
CREATE TABLE IF NOT EXISTS message_flows (
  flow_id TEXT PRIMARY KEY,
  trace_id TEXT,
  idempotency_key TEXT,
  meeting_id TEXT NOT NULL,
  workflow_id TEXT,
  dispatch_id TEXT,
  runtime_run_id TEXT,
  message_id TEXT,
  outbox_id TEXT,
  source_channel TEXT NOT NULL DEFAULT '',
  source_system TEXT NOT NULL DEFAULT '',
  source_runtime TEXT NOT NULL DEFAULT '',
  source_account_id TEXT NOT NULL DEFAULT '',
  source_chat_id TEXT NOT NULL DEFAULT '',
  sender_id TEXT NOT NULL DEFAULT '',
  source_message_id TEXT NOT NULL DEFAULT '',
  route_agent_id TEXT NOT NULL DEFAULT '',
  route_runtime TEXT NOT NULL DEFAULT '',
  target_runtime TEXT NOT NULL DEFAULT '',
  target_agent_id TEXT NOT NULL DEFAULT '',
  target_platform TEXT NOT NULL DEFAULT '',
  workflow_ingress_adapter TEXT NOT NULL DEFAULT '',
  im_identity TEXT NOT NULL DEFAULT '',
  execution_identity TEXT NOT NULL DEFAULT '',
  return_policy TEXT NOT NULL DEFAULT 'silent',
  status TEXT NOT NULL,
  inbound_received_at TEXT,
  route_registered_at TEXT,
  runtime_dispatched_at TEXT,
  runtime_completed_at TEXT,
  runtime_failed_at TEXT,
  outbound_queued_at TEXT,
  telegram_sent_at TEXT,
  telegram_failed_at TEXT,
  completed_at TEXT,
  failure_type TEXT,
  last_error TEXT,
  final_output_present INTEGER NOT NULL DEFAULT 0,
  delivery_receipt_present INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_flows_status ON message_flows(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_message_flows_dispatch ON message_flows(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_message_flows_trace ON message_flows(trace_id);
CREATE INDEX IF NOT EXISTS idx_message_flows_outbox ON message_flows(outbox_id);
CREATE TABLE IF NOT EXISTS message_flow_events (
  event_id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  status TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_flow_events_flow ON message_flow_events(flow_id, created_at);
CREATE TABLE IF NOT EXISTS human_gate_buttons (
  button_id TEXT PRIMARY KEY,
  callback_token TEXT NOT NULL UNIQUE,
  human_gate_id TEXT NOT NULL,
  workflow_id TEXT,
  meeting_id TEXT,
  label TEXT NOT NULL,
  decision_status TEXT NOT NULL,
  button_role TEXT,
  artifact_ref TEXT,
  summary TEXT,
  prompt TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  selected_by TEXT,
  selected_at TEXT,
  callback_chat_id TEXT,
  callback_message_id TEXT,
  feedback_status TEXT,
  feedback_text TEXT,
  feedback_received_at TEXT,
  feedback_payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_human_gate_buttons_gate ON human_gate_buttons(human_gate_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_human_gate_buttons_workflow ON human_gate_buttons(workflow_id, status, created_at);
CREATE TABLE IF NOT EXISTS human_gate_batches (
  batch_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  title TEXT,
  target_ref TEXT,
  risk_summary_json TEXT NOT NULL DEFAULT '{}',
  default_action TEXT,
  html_path TEXT,
  json_path TEXT,
  telegram_summary TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_human_gate_batches_status ON human_gate_batches(status, created_at DESC);
CREATE TABLE IF NOT EXISTS human_gate_batch_items (
  batch_id TEXT NOT NULL REFERENCES human_gate_batches(batch_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  workflow_id TEXT,
  meeting_id TEXT,
  title TEXT,
  summary TEXT,
  risk_tier TEXT NOT NULL,
  default_action TEXT,
  requires_individual_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  action_hint TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(batch_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_human_gate_batch_items_batch ON human_gate_batch_items(batch_id, risk_tier, status);
CREATE INDEX IF NOT EXISTS idx_human_gate_batch_items_source ON human_gate_batch_items(source_type, source_id);
CREATE TABLE IF NOT EXISTS meeting_control_events (
  event_id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_control_events_meeting ON meeting_control_events(meeting_id, created_at);
CREATE TABLE IF NOT EXISTS incident_states (
  incident_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  affected_planes_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT NOT NULL,
  commander TEXT,
  impact TEXT,
  current_hypothesis TEXT,
  mitigation TEXT,
  rollback_options TEXT,
  exit_criteria TEXT,
  timeline_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  declared_at TEXT NOT NULL,
  next_update_at TEXT,
  resolved_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS readiness_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  planes_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS workflow_schedules (
  schedule_id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  schedule_kind TEXT NOT NULL,
  cron_expr TEXT,
  interval_seconds INTEGER,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  dispatch_type TEXT NOT NULL DEFAULT 'scheduled_dispatch',
  priority TEXT NOT NULL DEFAULT 'normal',
  prompt TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  concurrency_policy TEXT NOT NULL DEFAULT 'skip',
  catchup_window_seconds INTEGER NOT NULL DEFAULT 900,
  misfire_policy TEXT NOT NULL DEFAULT 'skip',
  timeout_seconds INTEGER NOT NULL DEFAULT 45,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_scheduled_at TEXT,
  last_dispatch_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'workflow_scheduler',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_due ON workflow_schedules(status, next_run_at, priority);
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_target ON workflow_schedules(runtime, agent_id, status);
CREATE TABLE IF NOT EXISTS scheduled_runs (
  run_id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL,
  workflow_id TEXT,
  meeting_id TEXT,
  dispatch_id TEXT,
  runtime TEXT,
  agent_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(schedule_id, scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_schedule ON scheduled_runs(schedule_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_dispatch ON scheduled_runs(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status ON scheduled_runs(status, updated_at);
CREATE TABLE IF NOT EXISTS control_loop_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'queued',
  workflow_id TEXT,
  runtime TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 20,
  next_run_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_control_loop_jobs_status ON control_loop_jobs(status, next_run_at, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_control_loop_jobs_workflow ON control_loop_jobs(workflow_id, status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_control_loop_jobs_active_dedupe ON control_loop_jobs(dedupe_key) WHERE status IN ('queued','running','retry_scheduled');
CREATE TABLE IF NOT EXISTS workflow_v2_plans (
  plan_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  workflow_state TEXT NOT NULL DEFAULT 'draft',
  task_owner_agent TEXT NOT NULL,
  planner_agent TEXT NOT NULL,
  objective TEXT NOT NULL,
  participant_managers_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '{}',
  human_gate_policy_json TEXT NOT NULL DEFAULT '{}',
  plan_spec_artifact_ref TEXT NOT NULL DEFAULT '',
  plan_spec_artifact_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_v2_plans_workflow ON workflow_v2_plans(workflow_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_plans_status ON workflow_v2_plans(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_plans_workflow_state ON workflow_v2_plans(workflow_state, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_plan_nodes (
  node_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  parent_node_id TEXT,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  owner_agent TEXT NOT NULL DEFAULT '',
  runtime_backend TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  input_info_id TEXT NOT NULL DEFAULT '',
  output_info_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_nodes_plan ON workflow_v2_plan_nodes(plan_id, status, node_type);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_nodes_workflow ON workflow_v2_plan_nodes(workflow_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_info_items (
  info_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT 'internal',
  content_storage TEXT NOT NULL DEFAULT 'artifact_ref',
  content_ref TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (classification NOT IN ('sensitive','secret','trading') OR content_storage != 'inline')
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_info_workflow ON workflow_v2_info_items(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_info_plan_node ON workflow_v2_info_items(plan_id, node_id, created_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_inbox_items (
  inbox_item_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  recipient_kind TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notification_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_inbox_recipient ON workflow_v2_inbox_items(recipient_kind, recipient_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_inbox_info ON workflow_v2_inbox_items(info_id);
CREATE TABLE IF NOT EXISTS workflow_v2_access_grants (
  grant_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  inbox_item_id TEXT NOT NULL DEFAULT '',
  principal_kind TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'read',
  token_ref TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_grants_info ON workflow_v2_access_grants(info_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_grants_principal ON workflow_v2_access_grants(principal_kind, principal_id, status);
CREATE TABLE IF NOT EXISTS workflow_v2_read_receipts (
  receipt_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  info_id TEXT NOT NULL,
  inbox_item_id TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL DEFAULT '',
  reader_kind TEXT NOT NULL DEFAULT '',
  reader_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'read',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_read_receipts_info ON workflow_v2_read_receipts(info_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_read_receipts_reader ON workflow_v2_read_receipts(reader_kind, reader_id, created_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_worker_runs (
  worker_run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  parent_worker_run_id TEXT NOT NULL DEFAULT '',
  supersedes_worker_run_id TEXT NOT NULL DEFAULT '',
  successor_worker_run_id TEXT NOT NULL DEFAULT '',
  worker_generation INTEGER NOT NULL DEFAULT 0,
  manager_agent TEXT NOT NULL,
  worker_agent_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  session_run_id TEXT NOT NULL DEFAULT '',
  preflight_id TEXT NOT NULL DEFAULT '',
  runtime_backend TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT NOT NULL DEFAULT '',
  task_input_info_id TEXT NOT NULL DEFAULT '',
  output_info_id TEXT NOT NULL DEFAULT '',
  handoff_info_id TEXT NOT NULL DEFAULT '',
  receipt_ref TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  context_budget_tokens INTEGER NOT NULL DEFAULT 0,
  context_used_tokens INTEGER NOT NULL DEFAULT 0,
  compaction_count INTEGER NOT NULL DEFAULT 0,
  source_context_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_workflow ON workflow_v2_worker_runs(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_manager ON workflow_v2_worker_runs(manager_agent, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_session ON workflow_v2_worker_runs(session_id, session_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_preflight ON workflow_v2_worker_runs(preflight_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_lineage ON workflow_v2_worker_runs(parent_worker_run_id, supersedes_worker_run_id, successor_worker_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_queue ON workflow_v2_worker_runs(status, next_retry_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_lease ON workflow_v2_worker_runs(status, lease_until);
CREATE TABLE IF NOT EXISTS workflow_v2_worker_adapter_jobs (
  adapter_job_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL,
  session_run_id TEXT NOT NULL DEFAULT '',
  runtime_backend TEXT NOT NULL,
  worker_attempt INTEGER NOT NULL DEFAULT 0,
  runner_attempt INTEGER NOT NULL DEFAULT 0,
  max_runner_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'queued',
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT NOT NULL DEFAULT '',
  runner_id TEXT NOT NULL DEFAULT '',
  artifact_ref TEXT NOT NULL DEFAULT '',
  artifact_id TEXT NOT NULL DEFAULT '',
  info_id TEXT NOT NULL DEFAULT '',
  manifest_hash TEXT NOT NULL DEFAULT '',
  runner_receipt_ref TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_worker_attempt ON workflow_v2_worker_adapter_jobs(worker_run_id, worker_attempt);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_queue ON workflow_v2_worker_adapter_jobs(status, runtime_backend, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_lease ON workflow_v2_worker_adapter_jobs(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_workflow ON workflow_v2_worker_adapter_jobs(workflow_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_worker_handoffs (
  handoff_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL,
  manager_agent TEXT NOT NULL,
  successor_worker_run_id TEXT NOT NULL DEFAULT '',
  handoff_info_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  reason TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  source_context_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_handoffs_workflow ON workflow_v2_worker_handoffs(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_handoffs_worker ON workflow_v2_worker_handoffs(worker_run_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_manager_reviews (
  review_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL DEFAULT '',
  reviewer_agent TEXT NOT NULL,
  decision TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  findings_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  blocker_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_reviews_workflow ON workflow_v2_manager_reviews(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_reviews_worker ON workflow_v2_manager_reviews(worker_run_id, created_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_owner_reviews (
  review_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  owner_agent TEXT NOT NULL,
  decision TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  manager_review_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  findings_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_owner_reviews_workflow ON workflow_v2_owner_reviews(workflow_id, decision, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_task_group_packages (
  package_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  owner_review_id TEXT NOT NULL DEFAULT '',
  task_owner_agent TEXT NOT NULL,
  task_group_agents_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  summary TEXT NOT NULL DEFAULT '',
  manager_review_refs_json TEXT NOT NULL DEFAULT '[]',
  owner_review_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_task_group_packages_workflow ON workflow_v2_task_group_packages(workflow_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_cat_brain_audits (
  audit_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  task_group_package_id TEXT NOT NULL DEFAULT '',
  cat_brain_agent TEXT NOT NULL DEFAULT 'main',
  decision TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'governance_semantic',
  summary TEXT NOT NULL DEFAULT '',
  findings_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_cat_brain_audits_workflow ON workflow_v2_cat_brain_audits(workflow_id, decision, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_cat_claw_audits (
  audit_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  cat_brain_audit_id TEXT NOT NULL DEFAULT '',
  cat_claw_agent TEXT NOT NULL DEFAULT 'cat_claw',
  decision TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  checks_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_cat_claw_audits_workflow ON workflow_v2_cat_claw_audits(workflow_id, decision, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_notifications (
  notification_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  info_id TEXT NOT NULL DEFAULT '',
  inbox_item_id TEXT NOT NULL DEFAULT '',
  message_flow_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'message_flow',
  target_agent TEXT NOT NULL DEFAULT '',
  payload_mode TEXT NOT NULL DEFAULT 'pointer_only',
  status TEXT NOT NULL DEFAULT 'prepared',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_notifications_workflow ON workflow_v2_notifications(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_notifications_info ON workflow_v2_notifications(info_id, inbox_item_id);
CREATE TABLE IF NOT EXISTS workflow_v2_human_gate_packages (
  package_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  source_review_id TEXT NOT NULL DEFAULT '',
  source_cat_claw_audit_id TEXT NOT NULL DEFAULT '',
  cat_brain_agent TEXT NOT NULL DEFAULT 'main',
  cat_claw_agent TEXT NOT NULL DEFAULT 'cat_claw',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'cat_claw_audited')),
  options_json TEXT NOT NULL DEFAULT '[]',
  required_controls_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_hgate_workflow ON workflow_v2_human_gate_packages(workflow_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_v2_backend_preflights (
  preflight_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL DEFAULT '',
  backend_id TEXT NOT NULL,
  status TEXT NOT NULL,
  findings_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_backend_preflights_backend ON workflow_v2_backend_preflights(backend_id, created_at DESC);
CREATE TABLE IF NOT EXISTS workflow_operations (
  operation_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'workflow',
  scope_id TEXT NOT NULL DEFAULT '',
  workflow_id TEXT,
  requested_by TEXT NOT NULL DEFAULT '',
  reason TEXT,
  risk_tier TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  human_gate_id TEXT,
  input_hash TEXT,
  preview_result_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
INSERT INTO schema_meta(key, value, updated_at)
VALUES ('workflow_schema_version', ${sqlValue(WORKFLOW_SCHEMA_VERSION)}, ${sqlValue(nowIso())})
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
`;
  await sqlite(dbFile, schema);
  await migrateDatabase(dbFile);
}

async function migrateDatabase(dbFile) {
  await ensureColumns(dbFile, "workflow_runs", [
    ["objective", "TEXT"],
    ["acceptance_criteria", "TEXT"],
    ["stop_condition", "TEXT"],
    ["current_phase", "TEXT"],
    ["current_decision", "TEXT"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"]
  ]);
  await ensureColumns(dbFile, "review_gates", [
    ["resume_pointer", "TEXT"],
    ["expires_at", "TEXT"],
    ["decision_at", "TEXT"],
    ["approver", "TEXT"]
  ]);
  await ensureColumns(dbFile, "workflow_session_runs", [
    ["dispatch_id", "TEXT"]
  ]);
  await sqlite(dbFile, `
CREATE INDEX IF NOT EXISTS idx_session_runs_dispatch ON workflow_session_runs(dispatch_id);`, { json: false });
  await ensureColumns(dbFile, "workflow_verification_results", [
    ["verification_id", "TEXT"],
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["phase_id", "TEXT"],
    ["phase_key", "TEXT"],
    ["task_id", "TEXT"],
    ["agent_run_id", "TEXT"],
    ["dispatch_id", "TEXT"],
    ["runtime_run_id", "TEXT"],
    ["result_type", "TEXT NOT NULL DEFAULT 'verifier'"],
    ["decision", "TEXT NOT NULL DEFAULT 'uncertain'"],
    ["verifier_agent", "TEXT"],
    ["refuter_agent", "TEXT"],
    ["source_runtime", "TEXT"],
    ["source_agent", "TEXT"],
    ["confidence", "TEXT"],
    ["risk_band", "TEXT"],
    ["summary", "TEXT"],
    ["findings_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["recommendations_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["artifact_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["receipt_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_hash", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await sqlite(dbFile, `
CREATE INDEX IF NOT EXISTS idx_workflow_verification_workflow ON workflow_verification_results(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_verification_phase ON workflow_verification_results(workflow_id, phase_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_verification_task ON workflow_verification_results(workflow_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_verification_decision ON workflow_verification_results(workflow_id, decision, created_at DESC);`, { json: false });
  await ensureColumns(dbFile, "workflow_operations", [
    ["operation_id", "TEXT"],
    ["action", "TEXT NOT NULL DEFAULT ''"],
    ["scope_type", "TEXT NOT NULL DEFAULT 'workflow'"],
    ["scope_id", "TEXT NOT NULL DEFAULT ''"],
    ["workflow_id", "TEXT"],
    ["requested_by", "TEXT NOT NULL DEFAULT ''"],
    ["reason", "TEXT"],
    ["risk_tier", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT ''"],
    ["dry_run", "INTEGER NOT NULL DEFAULT 0"],
    ["idempotency_key", "TEXT"],
    ["human_gate_id", "TEXT"],
    ["input_hash", "TEXT"],
    ["preview_result_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["result_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["error", "TEXT"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["completed_at", "TEXT"]
  ]);
  await sqlite(dbFile, `
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_operations_operation_id ON workflow_operations(operation_id);
CREATE INDEX IF NOT EXISTS idx_workflow_operations_status ON workflow_operations(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_operations_scope ON workflow_operations(scope_type, scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_operations_workflow ON workflow_operations(workflow_id, updated_at DESC);`, { json: false });
  await ensureWorkflowV2Schema(dbFile);
  await ensureColumns(dbFile, "runtime_agents", [
    ["platform", "TEXT NOT NULL DEFAULT ''"],
    ["execution_adapter", "TEXT NOT NULL DEFAULT ''"],
    ["im_ingress_owner", "TEXT NOT NULL DEFAULT ''"],
    ["im_ingress_adapter", "TEXT NOT NULL DEFAULT ''"],
    ["workflow_ingress_adapter", "TEXT NOT NULL DEFAULT ''"],
    ["im_identity", "TEXT NOT NULL DEFAULT ''"],
    ["execution_identity", "TEXT NOT NULL DEFAULT ''"],
    ["return_policy", "TEXT NOT NULL DEFAULT ''"],
    ["can_receive_dispatch", "INTEGER NOT NULL DEFAULT 1"],
    ["can_start_workflow", "INTEGER NOT NULL DEFAULT 1"],
    ["gateway_proxy_allowed", "INTEGER NOT NULL DEFAULT 1"],
    ["routing_policy_json", "TEXT NOT NULL DEFAULT '{}'"]
  ]);
  await sqlite(dbFile, `
UPDATE runtime_agents
SET
  platform=CASE
    WHEN platform IS NOT NULL AND platform != '' THEN platform
    WHEN runtime IN ('hermes','hermes_acp','hermers') THEN 'hermers'
    WHEN runtime IN ('openclaw','openclaw_route_shell') THEN 'openclaw'
    ELSE runtime
  END,
  execution_adapter=CASE
    WHEN execution_adapter IS NOT NULL AND execution_adapter != '' THEN execution_adapter
    WHEN runtime='openclaw_route_shell' THEN 'route_shell'
    WHEN runtime='openclaw' THEN 'native'
    WHEN runtime IN ('hermes','hermes_acp','hermers') THEN 'acp'
    ELSE 'adapter'
  END,
  im_ingress_owner=CASE
    WHEN im_ingress_owner IS NOT NULL AND im_ingress_owner != '' THEN im_ingress_owner
    WHEN runtime IN ('openclaw','openclaw_route_shell') THEN 'openclaw_gateway'
    ELSE 'external_platform'
  END,
  im_ingress_adapter=CASE
    WHEN im_ingress_adapter IS NOT NULL AND im_ingress_adapter != '' THEN im_ingress_adapter
    WHEN runtime='openclaw_route_shell' THEN 'openclaw_route_shell'
    WHEN runtime='openclaw' THEN 'openclaw_native'
    ELSE 'platform_im'
  END,
  workflow_ingress_adapter=CASE
    WHEN workflow_ingress_adapter IS NOT NULL AND workflow_ingress_adapter != '' THEN workflow_ingress_adapter
    WHEN runtime='openclaw_route_shell' THEN 'route_shell'
    WHEN runtime='openclaw' THEN 'openclaw_native'
    WHEN runtime IN ('hermes','hermes_acp','hermers') THEN 'acp'
    ELSE 'adapter'
  END,
  im_identity=CASE
    WHEN im_identity IS NOT NULL AND im_identity != '' THEN im_identity
    WHEN runtime='openclaw_route_shell' OR im_ingress_adapter='openclaw_route_shell' THEN 'openclaw_route_shell'
    WHEN runtime='openclaw' OR im_ingress_adapter='openclaw_native' THEN 'openclaw_native'
    WHEN im_ingress_owner != '' AND im_ingress_adapter != '' THEN im_ingress_owner || ':' || im_ingress_adapter
    ELSE im_ingress_adapter
  END,
  execution_identity=CASE
    WHEN execution_identity IS NOT NULL AND execution_identity != '' THEN execution_identity
    WHEN runtime='openclaw_route_shell' THEN 'openclaw_route_shell'
    WHEN runtime='openclaw' OR (platform='openclaw' AND workflow_ingress_adapter='openclaw_native') THEN 'openclaw_native'
    WHEN platform='hermers' AND workflow_ingress_adapter='acp' THEN 'hermers_acp'
    WHEN platform != '' AND workflow_ingress_adapter != '' THEN platform || '_' || workflow_ingress_adapter
    ELSE platform
  END,
  return_policy=CASE
    WHEN return_policy IS NOT NULL AND return_policy != '' THEN return_policy
    WHEN runtime='openclaw_route_shell' THEN 'silent'
    WHEN runtime='hermers' AND im_ingress_adapter='openclaw_route_shell' THEN 'reply_to_source_chat'
    WHEN runtime='openclaw' THEN 'reply_to_source_chat'
    ELSE 'silent'
  END
WHERE platform='' OR execution_adapter='' OR im_ingress_owner='' OR im_ingress_adapter='' OR workflow_ingress_adapter='' OR im_identity='' OR execution_identity='' OR return_policy='';
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, routing_policy_json, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
SELECT
  'hermers:' || agent_id,
  'hermers',
  agent_id,
  display_name,
  role,
  status,
  'hermers',
  CASE WHEN execution_adapter != '' THEN execution_adapter ELSE 'acp' END,
  CASE
    WHEN EXISTS (SELECT 1 FROM runtime_agents r2 WHERE r2.agent_id=runtime_agents.agent_id AND r2.runtime='openclaw_route_shell') THEN 'openclaw_gateway'
    WHEN im_ingress_owner != '' THEN im_ingress_owner
    ELSE 'external_platform'
  END,
  CASE
    WHEN EXISTS (SELECT 1 FROM runtime_agents r2 WHERE r2.agent_id=runtime_agents.agent_id AND r2.runtime='openclaw_route_shell') THEN 'openclaw_route_shell'
    WHEN im_ingress_adapter != '' THEN im_ingress_adapter
    ELSE 'platform_im'
  END,
  CASE WHEN workflow_ingress_adapter != '' THEN workflow_ingress_adapter ELSE 'acp' END,
  CASE
    WHEN EXISTS (SELECT 1 FROM runtime_agents r2 WHERE r2.agent_id=runtime_agents.agent_id AND r2.runtime='openclaw_route_shell') THEN 'openclaw_route_shell'
    WHEN im_identity != '' THEN im_identity
    ELSE 'platform_im'
  END,
  CASE WHEN execution_identity != '' THEN execution_identity ELSE 'hermers_acp' END,
  CASE
    WHEN EXISTS (SELECT 1 FROM runtime_agents r2 WHERE r2.agent_id=runtime_agents.agent_id AND r2.runtime='openclaw_route_shell') THEN 'reply_to_source_chat'
    WHEN return_policy != '' THEN return_policy
    ELSE 'silent'
  END,
  can_receive_dispatch,
  can_start_workflow,
  gateway_proxy_allowed,
  routing_policy_json,
  endpoint_ref,
  capabilities_json,
  metadata_json,
  created_at,
  updated_at
FROM runtime_agents
WHERE runtime IN ('hermes','hermes_acp')
ON CONFLICT(agent_key) DO UPDATE SET
  display_name=excluded.display_name,
  role=excluded.role,
  status=excluded.status,
  platform=excluded.platform,
  execution_adapter=excluded.execution_adapter,
  im_ingress_owner=excluded.im_ingress_owner,
  im_ingress_adapter=excluded.im_ingress_adapter,
  workflow_ingress_adapter=excluded.workflow_ingress_adapter,
  im_identity=excluded.im_identity,
  execution_identity=excluded.execution_identity,
  return_policy=excluded.return_policy,
  can_receive_dispatch=excluded.can_receive_dispatch,
  can_start_workflow=excluded.can_start_workflow,
  gateway_proxy_allowed=excluded.gateway_proxy_allowed,
  routing_policy_json=excluded.routing_policy_json,
  endpoint_ref=excluded.endpoint_ref,
  capabilities_json=excluded.capabilities_json,
  metadata_json=excluded.metadata_json,
  updated_at=excluded.updated_at;
UPDATE runtime_agents
SET
  im_ingress_owner='openclaw_gateway',
  im_ingress_adapter='openclaw_route_shell',
  im_identity='openclaw_route_shell',
  execution_identity=CASE
    WHEN platform='hermers' AND workflow_ingress_adapter='acp' THEN 'hermers_acp'
    WHEN execution_identity='' THEN 'hermers_acp'
    ELSE execution_identity
  END,
  return_policy='reply_to_source_chat',
  updated_at=${sqlValue(nowIso())}
WHERE runtime='hermers'
  AND EXISTS (
    SELECT 1
    FROM runtime_agents route_shell
    WHERE route_shell.agent_id=runtime_agents.agent_id
      AND route_shell.runtime='openclaw_route_shell'
      AND route_shell.status='active'
  );
UPDATE mixed_meeting_dispatches SET runtime='hermers' WHERE runtime IN ('hermes','hermes_acp');
UPDATE mixed_meeting_messages SET runtime='hermers' WHERE runtime IN ('hermes','hermes_acp');
INSERT OR IGNORE INTO mixed_meeting_participants(meeting_id, agent_key, runtime, agent_id, participant_role, chair, decider, secretary, live_mode, status, metadata_json, created_at, updated_at)
SELECT meeting_id, 'hermers:' || agent_id, 'hermers', agent_id, participant_role, chair, decider, secretary, live_mode, status, metadata_json, created_at, updated_at
FROM mixed_meeting_participants
WHERE runtime IN ('hermes','hermes_acp');
DELETE FROM mixed_meeting_participants WHERE runtime IN ('hermes','hermes_acp');
UPDATE workflow_tasks SET runtime='hermers' WHERE runtime IN ('hermes','hermes_acp');
UPDATE runtime_runs SET runtime='hermers' WHERE runtime IN ('hermes','hermes_acp');
UPDATE mixed_meeting_dispatches SET agent_key='hermers:' || agent_id WHERE agent_key IN (SELECT agent_key FROM runtime_agents WHERE runtime IN ('hermes','hermes_acp'));
UPDATE mixed_meeting_messages SET agent_key='hermers:' || agent_id WHERE agent_key IN (SELECT agent_key FROM runtime_agents WHERE runtime IN ('hermes','hermes_acp'));
DELETE FROM runtime_agents WHERE runtime IN ('hermes','hermes_acp');
`);
  await sqlite(dbFile, `
CREATE TABLE IF NOT EXISTS runtime_semantic_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_time TEXT NOT NULL,
  event_sequence INTEGER NOT NULL DEFAULT 0,
  workflow_id TEXT,
  task_id TEXT,
  dispatch_id TEXT,
  trace_id TEXT,
  correlation_id TEXT,
  parent_event_id TEXT,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  runtime_session_id TEXT,
  runtime_run_id TEXT,
  acp_turn_id TEXT,
  prompt_id TEXT,
  stage TEXT,
  status TEXT NOT NULL DEFAULT 'recorded',
  blocked_reason TEXT,
  interruption_class TEXT,
  interrupted_dispatch_id TEXT,
  supersedes_dispatch_id TEXT,
  artifact_uri TEXT,
  artifact_type TEXT,
  artifact_sha256 TEXT,
  artifact_reason TEXT,
  latest_receipt_ref TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  tool_name TEXT,
  tool_call_id TEXT,
  duration_ms INTEGER,
  exit_code INTEGER,
  cwd TEXT,
  git_head TEXT,
  model TEXT,
  provider TEXT,
  privacy_class TEXT NOT NULL DEFAULT 'internal',
  redaction_status TEXT NOT NULL DEFAULT 'redacted',
  ttl TEXT,
  error_class TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  idempotency_key TEXT,
  side_effect_ref TEXT,
  payload_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_current_state (
  state_key TEXT PRIMARY KEY,
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  endpoint_ref TEXT,
  active_workflow_id TEXT,
  task_id TEXT,
  active_dispatch_id TEXT,
  trace_id TEXT,
  runtime_session_id TEXT,
  runtime_run_id TEXT,
  acp_turn_id TEXT,
  prompt_id TEXT,
  current_stage TEXT,
  stage_status TEXT NOT NULL DEFAULT '',
  semantic_ack_at TEXT,
  last_event_id TEXT,
  last_event_at TEXT,
  last_event_sequence INTEGER NOT NULL DEFAULT 0,
  latest_artifact_ref TEXT,
  latest_receipt_ref TEXT,
  blocked_reason TEXT,
  interruption_class TEXT,
  interrupted_dispatch_id TEXT,
  stale_kind TEXT,
  status TEXT NOT NULL DEFAULT 'unknown',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`, { json: false });
  await ensureColumns(dbFile, "runtime_semantic_events", [
    ["event_sequence", "INTEGER NOT NULL DEFAULT 0"],
    ["workflow_id", "TEXT"],
    ["task_id", "TEXT"],
    ["dispatch_id", "TEXT"],
    ["trace_id", "TEXT"],
    ["correlation_id", "TEXT"],
    ["parent_event_id", "TEXT"],
    ["runtime_session_id", "TEXT"],
    ["runtime_run_id", "TEXT"],
    ["acp_turn_id", "TEXT"],
    ["prompt_id", "TEXT"],
    ["stage", "TEXT"],
    ["blocked_reason", "TEXT"],
    ["interruption_class", "TEXT"],
    ["interrupted_dispatch_id", "TEXT"],
    ["supersedes_dispatch_id", "TEXT"],
    ["artifact_uri", "TEXT"],
    ["artifact_type", "TEXT"],
    ["artifact_sha256", "TEXT"],
    ["artifact_reason", "TEXT"],
    ["latest_receipt_ref", "TEXT"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["tool_name", "TEXT"],
    ["tool_call_id", "TEXT"],
    ["duration_ms", "INTEGER"],
    ["exit_code", "INTEGER"],
    ["cwd", "TEXT"],
    ["git_head", "TEXT"],
    ["model", "TEXT"],
    ["provider", "TEXT"],
    ["privacy_class", "TEXT NOT NULL DEFAULT 'internal'"],
    ["redaction_status", "TEXT NOT NULL DEFAULT 'redacted'"],
    ["ttl", "TEXT"],
    ["error_class", "TEXT"],
    ["severity", "TEXT NOT NULL DEFAULT 'info'"],
    ["idempotency_key", "TEXT"],
    ["side_effect_ref", "TEXT"],
    ["payload_hash", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "runtime_current_state", [
    ["endpoint_ref", "TEXT"],
    ["active_workflow_id", "TEXT"],
    ["task_id", "TEXT"],
    ["active_dispatch_id", "TEXT"],
    ["trace_id", "TEXT"],
    ["runtime_session_id", "TEXT"],
    ["runtime_run_id", "TEXT"],
    ["acp_turn_id", "TEXT"],
    ["prompt_id", "TEXT"],
    ["current_stage", "TEXT"],
    ["stage_status", "TEXT NOT NULL DEFAULT ''"],
    ["semantic_ack_at", "TEXT"],
    ["last_event_id", "TEXT"],
    ["last_event_at", "TEXT"],
    ["last_event_sequence", "INTEGER NOT NULL DEFAULT 0"],
    ["latest_artifact_ref", "TEXT"],
    ["latest_receipt_ref", "TEXT"],
    ["blocked_reason", "TEXT"],
    ["interruption_class", "TEXT"],
    ["interrupted_dispatch_id", "TEXT"],
    ["stale_kind", "TEXT"]
  ]);
  await sqlite(dbFile, `
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_semantic_events_event_id ON runtime_semantic_events(event_id);
CREATE INDEX IF NOT EXISTS idx_runtime_semantic_events_dispatch ON runtime_semantic_events(dispatch_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_semantic_events_agent ON runtime_semantic_events(runtime, agent_id, event_time DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_semantic_events_workflow ON runtime_semantic_events(workflow_id, event_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_semantic_events_idempotency ON runtime_semantic_events(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_current_state_state_key ON runtime_current_state(state_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_current_state_runtime_agent ON runtime_current_state(runtime, agent_id);
CREATE INDEX IF NOT EXISTS idx_runtime_current_state_workflow ON runtime_current_state(active_workflow_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_current_state_dispatch ON runtime_current_state(active_dispatch_id);
`, { json: false });
  await ensureColumns(dbFile, "mixed_meeting_dispatches", [
    ["workflow_id", "TEXT"],
    ["trace_id", "TEXT"],
    ["idempotency_key", "TEXT"],
    ["attempt", "INTEGER NOT NULL DEFAULT 0"],
    ["max_attempts", "INTEGER NOT NULL DEFAULT 1"],
    ["next_retry_at", "TEXT"],
    ["failure_type", "TEXT"],
    ["last_error", "TEXT"],
    ["sent_at", "TEXT"],
    ["acked_at", "TEXT"],
    ["completed_at", "TEXT"]
  ]);
  await ensureColumns(dbFile, "human_gate_buttons", [
    ["feedback_status", "TEXT"],
    ["feedback_text", "TEXT"],
    ["feedback_received_at", "TEXT"],
    ["feedback_payload_json", "TEXT NOT NULL DEFAULT '{}'"]
  ]);
  await sqlite(dbFile, `
CREATE UNIQUE INDEX IF NOT EXISTS idx_mixed_dispatches_idempotency ON mixed_meeting_dispatches(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_mixed_dispatches_trace ON mixed_meeting_dispatches(trace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mixed_dispatches_retry ON mixed_meeting_dispatches(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_side_effects_idempotency ON side_effect_ledger(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_incident_states_status ON incident_states(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_readiness_snapshots_checked ON readiness_snapshots(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_events_workflow ON workflow_events(workflow_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_events_trace ON workflow_events(trace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(event_type, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_events_idempotency ON workflow_events(idempotency_key) WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_session_runs_dispatch ON workflow_session_runs(dispatch_id);
CREATE TABLE IF NOT EXISTS workflow_schedules (
  schedule_id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  schedule_kind TEXT NOT NULL,
  cron_expr TEXT,
  interval_seconds INTEGER,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  runtime TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  dispatch_type TEXT NOT NULL DEFAULT 'scheduled_dispatch',
  priority TEXT NOT NULL DEFAULT 'normal',
  prompt TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  concurrency_policy TEXT NOT NULL DEFAULT 'skip',
  catchup_window_seconds INTEGER NOT NULL DEFAULT 900,
  misfire_policy TEXT NOT NULL DEFAULT 'skip',
  timeout_seconds INTEGER NOT NULL DEFAULT 45,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_scheduled_at TEXT,
  last_dispatch_id TEXT,
  created_by TEXT NOT NULL DEFAULT 'workflow_scheduler',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_due ON workflow_schedules(status, next_run_at, priority);
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_target ON workflow_schedules(runtime, agent_id, status);
CREATE TABLE IF NOT EXISTS scheduled_runs (
  run_id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL,
  workflow_id TEXT,
  meeting_id TEXT,
  dispatch_id TEXT,
  runtime TEXT,
  agent_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(schedule_id, scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_schedule ON scheduled_runs(schedule_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_dispatch ON scheduled_runs(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_runs_status ON scheduled_runs(status, updated_at);
CREATE TABLE IF NOT EXISTS control_loop_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'queued',
  workflow_id TEXT,
  runtime TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 20,
  next_run_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_control_loop_jobs_status ON control_loop_jobs(status, next_run_at, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_control_loop_jobs_workflow ON control_loop_jobs(workflow_id, status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_control_loop_jobs_active_dedupe ON control_loop_jobs(dedupe_key) WHERE status IN ('queued','running','retry_scheduled');
CREATE TABLE IF NOT EXISTS workflow_session_packs (
  session_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  owner_agent TEXT NOT NULL,
  task_type TEXT NOT NULL,
  runtime_target TEXT NOT NULL,
  purpose TEXT NOT NULL,
  system_brief TEXT NOT NULL DEFAULT '',
  working_context_json TEXT NOT NULL DEFAULT '{}',
  tool_policy_json TEXT NOT NULL DEFAULT '{}',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  checkpoint_refs_json TEXT NOT NULL DEFAULT '[]',
  resource_budget_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  pack_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_packs_owner ON workflow_session_packs(owner_agent, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_packs_task_type ON workflow_session_packs(task_type, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS workflow_session_runs (
  run_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES workflow_session_packs(session_id) ON DELETE RESTRICT,
  pack_version INTEGER NOT NULL,
  workflow_id TEXT,
  task_id TEXT,
  dispatch_id TEXT,
  worker_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL DEFAULT '{}',
  worker_input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  receipt_ref TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_runs_session ON workflow_session_runs(session_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_runs_workflow ON workflow_session_runs(workflow_id, task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_runs_dispatch ON workflow_session_runs(dispatch_id);
CREATE TABLE IF NOT EXISTS human_gate_buttons (
  button_id TEXT PRIMARY KEY,
  callback_token TEXT NOT NULL UNIQUE,
  human_gate_id TEXT NOT NULL,
  workflow_id TEXT,
  meeting_id TEXT,
  label TEXT NOT NULL,
  decision_status TEXT NOT NULL,
  button_role TEXT,
  artifact_ref TEXT,
  summary TEXT,
  prompt TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  selected_by TEXT,
  selected_at TEXT,
  callback_chat_id TEXT,
  callback_message_id TEXT,
  feedback_status TEXT,
  feedback_text TEXT,
  feedback_received_at TEXT,
  feedback_payload_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_human_gate_buttons_gate ON human_gate_buttons(human_gate_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_human_gate_buttons_workflow ON human_gate_buttons(workflow_id, status, created_at);
CREATE TABLE IF NOT EXISTS human_gate_batches (
  batch_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  title TEXT,
  target_ref TEXT,
  risk_summary_json TEXT NOT NULL DEFAULT '{}',
  default_action TEXT,
  html_path TEXT,
  json_path TEXT,
  telegram_summary TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_human_gate_batches_status ON human_gate_batches(status, created_at DESC);
CREATE TABLE IF NOT EXISTS human_gate_batch_items (
  batch_id TEXT NOT NULL REFERENCES human_gate_batches(batch_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  workflow_id TEXT,
  meeting_id TEXT,
  title TEXT,
  summary TEXT,
  risk_tier TEXT NOT NULL,
  default_action TEXT,
  requires_individual_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  action_hint TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY(batch_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_human_gate_batch_items_batch ON human_gate_batch_items(batch_id, risk_tier, status);
CREATE INDEX IF NOT EXISTS idx_human_gate_batch_items_source ON human_gate_batch_items(source_type, source_id);
`);
}

async function ensureWorkflowV2Schema(dbFile) {
  await sqlite(dbFile, `
CREATE TABLE IF NOT EXISTS workflow_v2_plans (
  plan_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  workflow_state TEXT NOT NULL DEFAULT 'draft',
  task_owner_agent TEXT NOT NULL,
  planner_agent TEXT NOT NULL,
  objective TEXT NOT NULL,
  participant_managers_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  constraints_json TEXT NOT NULL DEFAULT '{}',
  human_gate_policy_json TEXT NOT NULL DEFAULT '{}',
  plan_spec_artifact_ref TEXT NOT NULL DEFAULT '',
  plan_spec_artifact_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_plan_nodes (
  node_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  parent_node_id TEXT,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  owner_agent TEXT NOT NULL DEFAULT '',
  runtime_backend TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL DEFAULT '',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  input_info_id TEXT NOT NULL DEFAULT '',
  output_info_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_info_items (
  info_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT 'internal',
  content_storage TEXT NOT NULL DEFAULT 'artifact_ref',
  content_ref TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (classification NOT IN ('sensitive','secret','trading') OR content_storage != 'inline')
);
CREATE TABLE IF NOT EXISTS workflow_v2_inbox_items (
  inbox_item_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  recipient_kind TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notification_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_access_grants (
  grant_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  inbox_item_id TEXT NOT NULL DEFAULT '',
  principal_kind TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'read',
  token_ref TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_read_receipts (
  receipt_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  info_id TEXT NOT NULL,
  inbox_item_id TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL DEFAULT '',
  reader_kind TEXT NOT NULL DEFAULT '',
  reader_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'read',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_worker_runs (
  worker_run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  parent_worker_run_id TEXT NOT NULL DEFAULT '',
  supersedes_worker_run_id TEXT NOT NULL DEFAULT '',
  successor_worker_run_id TEXT NOT NULL DEFAULT '',
  worker_generation INTEGER NOT NULL DEFAULT 0,
  manager_agent TEXT NOT NULL,
  worker_agent_id TEXT NOT NULL DEFAULT '',
  session_id TEXT NOT NULL,
  session_run_id TEXT NOT NULL DEFAULT '',
  preflight_id TEXT NOT NULL DEFAULT '',
  runtime_backend TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT NOT NULL DEFAULT '',
  task_input_info_id TEXT NOT NULL DEFAULT '',
  output_info_id TEXT NOT NULL DEFAULT '',
  handoff_info_id TEXT NOT NULL DEFAULT '',
  receipt_ref TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  context_budget_tokens INTEGER NOT NULL DEFAULT 0,
  context_used_tokens INTEGER NOT NULL DEFAULT 0,
  compaction_count INTEGER NOT NULL DEFAULT 0,
  source_context_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_worker_adapter_jobs (
  adapter_job_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL,
  session_run_id TEXT NOT NULL DEFAULT '',
  runtime_backend TEXT NOT NULL,
  worker_attempt INTEGER NOT NULL DEFAULT 0,
  runner_attempt INTEGER NOT NULL DEFAULT 0,
  max_runner_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'queued',
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT NOT NULL DEFAULT '',
  runner_id TEXT NOT NULL DEFAULT '',
  artifact_ref TEXT NOT NULL DEFAULT '',
  artifact_id TEXT NOT NULL DEFAULT '',
  info_id TEXT NOT NULL DEFAULT '',
  manifest_hash TEXT NOT NULL DEFAULT '',
  runner_receipt_ref TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS workflow_v2_worker_handoffs (
  handoff_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL,
  manager_agent TEXT NOT NULL,
  successor_worker_run_id TEXT NOT NULL DEFAULT '',
  handoff_info_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  reason TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  source_context_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_manager_reviews (
  review_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL DEFAULT '',
  reviewer_agent TEXT NOT NULL,
  decision TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  findings_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  blocker_json TEXT NOT NULL DEFAULT '{}',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_owner_reviews (
  review_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  owner_agent TEXT NOT NULL,
  decision TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  manager_review_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  findings_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_task_group_packages (
  package_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  owner_review_id TEXT NOT NULL DEFAULT '',
  task_owner_agent TEXT NOT NULL,
  task_group_agents_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  summary TEXT NOT NULL DEFAULT '',
  manager_review_refs_json TEXT NOT NULL DEFAULT '[]',
  owner_review_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_cat_brain_audits (
  audit_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  task_group_package_id TEXT NOT NULL DEFAULT '',
  cat_brain_agent TEXT NOT NULL DEFAULT 'main',
  decision TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'governance_semantic',
  summary TEXT NOT NULL DEFAULT '',
  findings_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_cat_claw_audits (
  audit_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  cat_brain_audit_id TEXT NOT NULL DEFAULT '',
  cat_claw_agent TEXT NOT NULL DEFAULT 'cat_claw',
  decision TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  checks_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_notifications (
  notification_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  info_id TEXT NOT NULL DEFAULT '',
  inbox_item_id TEXT NOT NULL DEFAULT '',
  message_flow_id TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'message_flow',
  target_agent TEXT NOT NULL DEFAULT '',
  payload_mode TEXT NOT NULL DEFAULT 'pointer_only',
  status TEXT NOT NULL DEFAULT 'prepared',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_human_gate_packages (
  package_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  source_review_id TEXT NOT NULL DEFAULT '',
  source_cat_claw_audit_id TEXT NOT NULL DEFAULT '',
  cat_brain_agent TEXT NOT NULL DEFAULT 'main',
  cat_claw_agent TEXT NOT NULL DEFAULT 'cat_claw',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'cat_claw_audited')),
  options_json TEXT NOT NULL DEFAULT '[]',
  required_controls_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_backend_preflights (
  preflight_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL DEFAULT '',
  backend_id TEXT NOT NULL,
  status TEXT NOT NULL,
  findings_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_template_specs (
  template_id TEXT PRIMARY KEY,
  family_status TEXT NOT NULL DEFAULT 'active',
  owner_agent TEXT NOT NULL DEFAULT 'main',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  risk_tier TEXT NOT NULL DEFAULT 'medium',
  tags_json TEXT NOT NULL DEFAULT '[]',
  allowed_capabilities_json TEXT NOT NULL DEFAULT '[]',
  default_version INTEGER NOT NULL DEFAULT 0,
  active_version INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_template_versions (
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'candidate',
  artifact_ref TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  source_workflow_id TEXT NOT NULL DEFAULT '',
  source_plan_id TEXT NOT NULL DEFAULT '',
  source_plan_artifact_ref TEXT NOT NULL DEFAULT '',
  source_plan_artifact_hash TEXT NOT NULL DEFAULT '',
  promotion_state TEXT NOT NULL DEFAULT 'candidate',
  payload_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY(template_id, version)
);
CREATE TABLE IF NOT EXISTS workflow_v2_template_evals (
  eval_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  arm TEXT NOT NULL DEFAULT 'candidate_version',
  fixture_artifact_ref TEXT NOT NULL DEFAULT '',
  fixture_hash TEXT NOT NULL DEFAULT '',
  isolated_root TEXT NOT NULL DEFAULT '',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  reward_score REAL,
  safety_freeze INTEGER NOT NULL DEFAULT 0,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_template_stats (
  template_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  reward_score REAL,
  eval_count INTEGER NOT NULL DEFAULT 0,
  last_eval_at TEXT NOT NULL DEFAULT '',
  rollback_target_version INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_v2_template_events (
  event_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL,
  previous_version INTEGER NOT NULL DEFAULT 0,
  next_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  human_gate_id TEXT NOT NULL DEFAULT '',
  cat_brain_audit_id TEXT NOT NULL DEFAULT '',
  cat_claw_audit_id TEXT NOT NULL DEFAULT '',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);`, { json: false });
  await ensureColumns(dbFile, "workflow_v2_plans", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_revision", "INTEGER NOT NULL DEFAULT 1"],
    ["status", "TEXT NOT NULL DEFAULT 'draft'"],
    ["workflow_state", "TEXT NOT NULL DEFAULT 'draft'"],
    ["task_owner_agent", "TEXT NOT NULL DEFAULT ''"],
    ["planner_agent", "TEXT NOT NULL DEFAULT 'main'"],
    ["objective", "TEXT NOT NULL DEFAULT ''"],
    ["participant_managers_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["acceptance_criteria_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["constraints_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["human_gate_policy_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["plan_spec_artifact_ref", "TEXT NOT NULL DEFAULT ''"],
    ["plan_spec_artifact_hash", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_plan_nodes", [
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["parent_node_id", "TEXT"],
    ["node_type", "TEXT NOT NULL DEFAULT 'task'"],
    ["status", "TEXT NOT NULL DEFAULT 'planned'"],
    ["owner_agent", "TEXT NOT NULL DEFAULT ''"],
    ["runtime_backend", "TEXT NOT NULL DEFAULT ''"],
    ["session_id", "TEXT NOT NULL DEFAULT ''"],
    ["depends_on_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["input_info_id", "TEXT NOT NULL DEFAULT ''"],
    ["output_info_id", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_info_items", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["node_id", "TEXT NOT NULL DEFAULT ''"],
    ["worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["classification", "TEXT NOT NULL DEFAULT 'internal'"],
    ["content_storage", "TEXT NOT NULL DEFAULT 'artifact_ref'"],
    ["content_ref", "TEXT NOT NULL DEFAULT ''"],
    ["content_hash", "TEXT NOT NULL DEFAULT ''"],
    ["summary", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_inbox_items", [
    ["info_id", "TEXT NOT NULL DEFAULT ''"],
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["recipient_kind", "TEXT NOT NULL DEFAULT 'agent'"],
    ["recipient_id", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'pending'"],
    ["notification_id", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_access_grants", [
    ["info_id", "TEXT NOT NULL DEFAULT ''"],
    ["inbox_item_id", "TEXT NOT NULL DEFAULT ''"],
    ["principal_kind", "TEXT NOT NULL DEFAULT 'agent'"],
    ["principal_id", "TEXT NOT NULL DEFAULT ''"],
    ["access_mode", "TEXT NOT NULL DEFAULT 'read'"],
    ["token_ref", "TEXT NOT NULL DEFAULT ''"],
    ["expires_at", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'active'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_read_receipts", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["info_id", "TEXT NOT NULL DEFAULT ''"],
    ["inbox_item_id", "TEXT NOT NULL DEFAULT ''"],
    ["grant_id", "TEXT NOT NULL DEFAULT ''"],
    ["reader_kind", "TEXT NOT NULL DEFAULT ''"],
    ["reader_id", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'read'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_worker_runs", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["node_id", "TEXT NOT NULL DEFAULT ''"],
    ["parent_worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["supersedes_worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["successor_worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["worker_generation", "INTEGER NOT NULL DEFAULT 0"],
    ["manager_agent", "TEXT NOT NULL DEFAULT ''"],
    ["worker_agent_id", "TEXT NOT NULL DEFAULT ''"],
    ["session_id", "TEXT NOT NULL DEFAULT ''"],
    ["session_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["preflight_id", "TEXT NOT NULL DEFAULT ''"],
    ["runtime_backend", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'queued'"],
    ["attempt", "INTEGER NOT NULL DEFAULT 0"],
    ["max_attempts", "INTEGER NOT NULL DEFAULT 1"],
    ["lease_owner", "TEXT NOT NULL DEFAULT ''"],
    ["lease_until", "TEXT NOT NULL DEFAULT ''"],
    ["next_retry_at", "TEXT NOT NULL DEFAULT ''"],
    ["task_input_info_id", "TEXT NOT NULL DEFAULT ''"],
    ["output_info_id", "TEXT NOT NULL DEFAULT ''"],
    ["handoff_info_id", "TEXT NOT NULL DEFAULT ''"],
    ["receipt_ref", "TEXT NOT NULL DEFAULT ''"],
    ["last_error", "TEXT NOT NULL DEFAULT ''"],
    ["context_budget_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["context_used_tokens", "INTEGER NOT NULL DEFAULT 0"],
    ["compaction_count", "INTEGER NOT NULL DEFAULT 0"],
    ["source_context_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["started_at", "TEXT NOT NULL DEFAULT ''"],
    ["completed_at", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_worker_adapter_jobs", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["node_id", "TEXT NOT NULL DEFAULT ''"],
    ["worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["session_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["runtime_backend", "TEXT NOT NULL DEFAULT ''"],
    ["worker_attempt", "INTEGER NOT NULL DEFAULT 0"],
    ["runner_attempt", "INTEGER NOT NULL DEFAULT 0"],
    ["max_runner_attempts", "INTEGER NOT NULL DEFAULT 3"],
    ["status", "TEXT NOT NULL DEFAULT 'queued'"],
    ["lease_owner", "TEXT NOT NULL DEFAULT ''"],
    ["lease_until", "TEXT NOT NULL DEFAULT ''"],
    ["next_retry_at", "TEXT NOT NULL DEFAULT ''"],
    ["runner_id", "TEXT NOT NULL DEFAULT ''"],
    ["artifact_ref", "TEXT NOT NULL DEFAULT ''"],
    ["artifact_id", "TEXT NOT NULL DEFAULT ''"],
    ["info_id", "TEXT NOT NULL DEFAULT ''"],
    ["manifest_hash", "TEXT NOT NULL DEFAULT ''"],
    ["runner_receipt_ref", "TEXT NOT NULL DEFAULT ''"],
    ["last_error", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["completed_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_worker_handoffs", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["node_id", "TEXT NOT NULL DEFAULT ''"],
    ["worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["manager_agent", "TEXT NOT NULL DEFAULT ''"],
    ["successor_worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["handoff_info_id", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT 'draft'"],
    ["reason", "TEXT NOT NULL DEFAULT ''"],
    ["summary", "TEXT NOT NULL DEFAULT ''"],
    ["source_context_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["artifact_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["receipt_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_manager_reviews", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["node_id", "TEXT NOT NULL DEFAULT ''"],
    ["worker_run_id", "TEXT NOT NULL DEFAULT ''"],
    ["reviewer_agent", "TEXT NOT NULL DEFAULT ''"],
    ["decision", "TEXT NOT NULL DEFAULT ''"],
    ["summary", "TEXT NOT NULL DEFAULT ''"],
    ["findings_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["artifact_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["receipt_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["blocker_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_owner_reviews", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["owner_agent", "TEXT NOT NULL DEFAULT ''"],
    ["decision", "TEXT NOT NULL DEFAULT ''"],
    ["summary", "TEXT NOT NULL DEFAULT ''"],
    ["manager_review_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["artifact_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["receipt_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["findings_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_task_group_packages", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["owner_review_id", "TEXT NOT NULL DEFAULT ''"],
    ["task_owner_agent", "TEXT NOT NULL DEFAULT ''"],
    ["task_group_agents_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["status", "TEXT NOT NULL DEFAULT 'draft'"],
    ["summary", "TEXT NOT NULL DEFAULT ''"],
    ["manager_review_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["owner_review_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["artifact_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_cat_brain_audits", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["task_group_package_id", "TEXT NOT NULL DEFAULT ''"],
    ["cat_brain_agent", "TEXT NOT NULL DEFAULT 'main'"],
    ["decision", "TEXT NOT NULL DEFAULT ''"],
    ["scope", "TEXT NOT NULL DEFAULT 'governance_semantic'"],
    ["summary", "TEXT NOT NULL DEFAULT ''"],
    ["findings_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_cat_claw_audits", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["cat_brain_audit_id", "TEXT NOT NULL DEFAULT ''"],
    ["cat_claw_agent", "TEXT NOT NULL DEFAULT 'cat_claw'"],
    ["decision", "TEXT NOT NULL DEFAULT ''"],
    ["summary", "TEXT NOT NULL DEFAULT ''"],
    ["checks_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_notifications", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["info_id", "TEXT NOT NULL DEFAULT ''"],
    ["inbox_item_id", "TEXT NOT NULL DEFAULT ''"],
    ["message_flow_id", "TEXT NOT NULL DEFAULT ''"],
    ["channel", "TEXT NOT NULL DEFAULT 'message_flow'"],
    ["target_agent", "TEXT NOT NULL DEFAULT ''"],
    ["payload_mode", "TEXT NOT NULL DEFAULT 'pointer_only'"],
    ["status", "TEXT NOT NULL DEFAULT 'prepared'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_human_gate_packages", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["source_review_id", "TEXT NOT NULL DEFAULT ''"],
    ["source_cat_claw_audit_id", "TEXT NOT NULL DEFAULT ''"],
    ["cat_brain_agent", "TEXT NOT NULL DEFAULT 'main'"],
    ["cat_claw_agent", "TEXT NOT NULL DEFAULT 'cat_claw'"],
    ["status", "TEXT NOT NULL DEFAULT 'draft'"],
    ["options_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["required_controls_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_backend_preflights", [
    ["workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["backend_id", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT ''"],
    ["findings_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_template_specs", [
    ["family_status", "TEXT NOT NULL DEFAULT 'active'"],
    ["owner_agent", "TEXT NOT NULL DEFAULT 'main'"],
    ["title", "TEXT NOT NULL DEFAULT ''"],
    ["description", "TEXT NOT NULL DEFAULT ''"],
    ["risk_tier", "TEXT NOT NULL DEFAULT 'medium'"],
    ["tags_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["allowed_capabilities_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["default_version", "INTEGER NOT NULL DEFAULT 0"],
    ["active_version", "INTEGER NOT NULL DEFAULT 0"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_template_versions", [
    ["status", "TEXT NOT NULL DEFAULT 'candidate'"],
    ["artifact_ref", "TEXT NOT NULL DEFAULT ''"],
    ["artifact_hash", "TEXT NOT NULL DEFAULT ''"],
    ["source_workflow_id", "TEXT NOT NULL DEFAULT ''"],
    ["source_plan_id", "TEXT NOT NULL DEFAULT ''"],
    ["source_plan_artifact_ref", "TEXT NOT NULL DEFAULT ''"],
    ["source_plan_artifact_hash", "TEXT NOT NULL DEFAULT ''"],
    ["promotion_state", "TEXT NOT NULL DEFAULT 'candidate'"],
    ["payload_hash", "TEXT NOT NULL DEFAULT ''"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_template_evals", [
    ["template_id", "TEXT NOT NULL DEFAULT ''"],
    ["version", "INTEGER NOT NULL DEFAULT 0"],
    ["arm", "TEXT NOT NULL DEFAULT 'candidate_version'"],
    ["fixture_artifact_ref", "TEXT NOT NULL DEFAULT ''"],
    ["fixture_hash", "TEXT NOT NULL DEFAULT ''"],
    ["isolated_root", "TEXT NOT NULL DEFAULT ''"],
    ["metrics_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["reward_score", "REAL"],
    ["safety_freeze", "INTEGER NOT NULL DEFAULT 0"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_by", "TEXT NOT NULL DEFAULT ''"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_template_stats", [
    ["version", "INTEGER NOT NULL DEFAULT 0"],
    ["reward_score", "REAL"],
    ["eval_count", "INTEGER NOT NULL DEFAULT 0"],
    ["last_eval_at", "TEXT NOT NULL DEFAULT ''"],
    ["rollback_target_version", "INTEGER NOT NULL DEFAULT 0"],
    ["metrics_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await ensureColumns(dbFile, "workflow_v2_template_events", [
    ["template_id", "TEXT NOT NULL DEFAULT ''"],
    ["version", "INTEGER NOT NULL DEFAULT 0"],
    ["event_type", "TEXT NOT NULL DEFAULT ''"],
    ["previous_version", "INTEGER NOT NULL DEFAULT 0"],
    ["next_version", "INTEGER NOT NULL DEFAULT 0"],
    ["status", "TEXT NOT NULL DEFAULT ''"],
    ["actor", "TEXT NOT NULL DEFAULT ''"],
    ["human_gate_id", "TEXT NOT NULL DEFAULT ''"],
    ["cat_brain_audit_id", "TEXT NOT NULL DEFAULT ''"],
    ["cat_claw_audit_id", "TEXT NOT NULL DEFAULT ''"],
    ["evidence_refs_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["payload_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"]
  ]);
  await sqlite(dbFile, `
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_v2_plans_workflow ON workflow_v2_plans(workflow_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_plans_status ON workflow_v2_plans(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_plans_workflow_state ON workflow_v2_plans(workflow_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_nodes_plan ON workflow_v2_plan_nodes(plan_id, status, node_type);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_nodes_workflow ON workflow_v2_plan_nodes(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_info_workflow ON workflow_v2_info_items(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_info_plan_node ON workflow_v2_info_items(plan_id, node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_inbox_recipient ON workflow_v2_inbox_items(recipient_kind, recipient_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_inbox_info ON workflow_v2_inbox_items(info_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_grants_info ON workflow_v2_access_grants(info_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_grants_principal ON workflow_v2_access_grants(principal_kind, principal_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_read_receipts_info ON workflow_v2_read_receipts(info_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_read_receipts_reader ON workflow_v2_read_receipts(reader_kind, reader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_workflow ON workflow_v2_worker_runs(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_manager ON workflow_v2_worker_runs(manager_agent, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_session ON workflow_v2_worker_runs(session_id, session_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_preflight ON workflow_v2_worker_runs(preflight_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_lineage ON workflow_v2_worker_runs(parent_worker_run_id, supersedes_worker_run_id, successor_worker_run_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_queue ON workflow_v2_worker_runs(status, next_retry_at, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_lease ON workflow_v2_worker_runs(status, lease_until);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_worker_attempt ON workflow_v2_worker_adapter_jobs(worker_run_id, worker_attempt);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_queue ON workflow_v2_worker_adapter_jobs(status, runtime_backend, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_lease ON workflow_v2_worker_adapter_jobs(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_workflow ON workflow_v2_worker_adapter_jobs(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_handoffs_workflow ON workflow_v2_worker_handoffs(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_handoffs_worker ON workflow_v2_worker_handoffs(worker_run_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_reviews_workflow ON workflow_v2_manager_reviews(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_reviews_worker ON workflow_v2_manager_reviews(worker_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_owner_reviews_workflow ON workflow_v2_owner_reviews(workflow_id, decision, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_task_group_packages_workflow ON workflow_v2_task_group_packages(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_cat_brain_audits_workflow ON workflow_v2_cat_brain_audits(workflow_id, decision, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_cat_claw_audits_workflow ON workflow_v2_cat_claw_audits(workflow_id, decision, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_notifications_workflow ON workflow_v2_notifications(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_notifications_info ON workflow_v2_notifications(info_id, inbox_item_id);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_hgate_workflow ON workflow_v2_human_gate_packages(workflow_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_backend_preflights_backend ON workflow_v2_backend_preflights(backend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_template_specs_status ON workflow_v2_template_specs(family_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_template_specs_owner ON workflow_v2_template_specs(owner_agent, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_template_versions_status ON workflow_v2_template_versions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_template_versions_artifact ON workflow_v2_template_versions(artifact_hash);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_template_evals_template ON workflow_v2_template_evals(template_id, version, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_v2_template_events_template ON workflow_v2_template_events(template_id, created_at DESC);`, { json: false });
}

async function upsertInstrumentRecord(paths, input) {
  const assetType = normalizeAssetType(input.assetType || input.asset_type);
  const symbol = normalizeSymbol(input.symbol);
  const id = input.instrumentId || input.instrument_id || instrumentId(assetType, symbol);
  const createdAt = nowIso();
  const name = String(input.name || "").trim();
  const status = String(input.instrumentStatus || input.instrument_status || "active");
  const sql = `
INSERT INTO instruments(instrument_id, asset_type, symbol, name, exchange, currency, aliases_json, tags_json, status, created_at, updated_at)
VALUES (${sqlValue(id)}, ${sqlValue(assetType)}, ${sqlValue(symbol)}, ${sqlValue(name)}, ${sqlValue(input.exchange || "")}, ${sqlValue(input.currency || "")}, ${sqlValue(JSON.stringify(toList(input.aliases)))}, ${sqlValue(JSON.stringify(toList(input.tags)))}, ${sqlValue(status)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(instrument_id) DO UPDATE SET
  name=COALESCE(NULLIF(excluded.name,''), instruments.name),
  exchange=COALESCE(NULLIF(excluded.exchange,''), instruments.exchange),
  currency=COALESCE(NULLIF(excluded.currency,''), instruments.currency),
  aliases_json=CASE WHEN excluded.aliases_json='[]' THEN instruments.aliases_json ELSE excluded.aliases_json END,
  tags_json=CASE WHEN excluded.tags_json='[]' THEN instruments.tags_json ELSE excluded.tags_json END,
  status=CASE WHEN ${sqlValue(Boolean(input.instrumentStatus || input.instrument_status))}=1 THEN excluded.status ELSE instruments.status END,
  updated_at=excluded.updated_at;`;
  await sqlite(paths.dbFile, sql);
  return { instrumentId: id, assetType, symbol, name };
}

async function readInstrument(paths, input) {
  const id = input.instrumentId || input.instrument_id || instrumentId(input.assetType || input.asset_type, input.symbol);
  const rows = await sqlite(paths.dbFile, `SELECT * FROM instruments WHERE instrument_id=${sqlValue(id)} LIMIT 1;`, { json: true });
  return rows[0] || null;
}

function relativeTo(root, filePath) {
  return path.relative(root, filePath);
}

function renderThesisMarkdown(record, input) {
  return `# ${record.title || `${record.symbol} Thesis`}

- instrument_id: ${record.instrumentId}
- asset_type: ${record.assetType}
- symbol: ${record.symbol}
- status: ${record.status}
- owner_agent: ${record.ownerAgent}
- updated_at: ${record.updatedAt}

## Thesis Summary

${record.summary || "待补充。"}

## Evidence

${String(input.evidence || input.evidenceSummary || "待补充。").trim()}

## Falsification Triggers

${record.falsificationTriggers || "待补充。"}

## Key Metrics To Watch

${String(input.keyMetricsToWatch || input.key_metrics_to_watch || "待补充。").trim()}

## Next Review

${record.reviewDueAt || "待定"}
`;
}

async function commandProbe(command, args, options = {}) {
  const startedAt = nowIso();
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeoutMs || 30000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) }
    });
    return {
      ok: true,
      startedAt,
      completedAt: nowIso(),
      stdout: String(stdout || "").slice(0, options.maxText || 2000),
      stderr: String(stderr || "").slice(0, options.maxText || 2000)
    };
  } catch (error) {
    return {
      ok: false,
      startedAt,
      completedAt: nowIso(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function gatewayHealthFinding(probe = {}) {
  if (!probe.ok) return { severity: "warning", key: "openclaw_gateway_health_failed", plane: "control", error: probe.error };
  const text = `${probe.stdout || ""}\n${probe.stderr || ""}`.toLowerCase();
  if (text.includes("gateway event loop: degraded")) {
    return { severity: "warning", key: "openclaw_gateway_event_loop_degraded", plane: "control", error: "openclaw health reported degraded Gateway event loop" };
  }
  if (text.includes("gateway event loop: critical")) {
    return { severity: "critical", key: "openclaw_gateway_event_loop_critical", plane: "control", error: "openclaw health reported critical Gateway event loop" };
  }
  return null;
}

async function activeReadinessChecks(paths, input, findings) {
  const checks = {};
  const proxyEnv = {
    HTTP_PROXY: input.httpProxy || input.http_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890",
    HTTPS_PROXY: input.httpsProxy || input.https_proxy || process.env.HTTPS_PROXY || "http://127.0.0.1:7890",
    ALL_PROXY: input.allProxy || input.all_proxy || process.env.ALL_PROXY || "socks5://127.0.0.1:7890"
  };
  const openclawBin = String(input.openclawBin || input.openclaw_bin || process.env.OPENCLAW_BIN || "openclaw").trim();
  checks.openclawGateway = await commandProbe(openclawBin, ["health"], {
    cwd: paths.root,
    timeoutMs: 60000,
    env: { OPENCLAW_ALLOW_INSECURE_PRIVATE_WS: "1", ...proxyEnv }
  });
  const gatewayFinding = gatewayHealthFinding(checks.openclawGateway);
  if (gatewayFinding) findings.push(gatewayFinding);

  const hermesBin = resolveHome(firstText(input.hermesBin, input.hermes_bin, process.env.HERMES_BIN, "/home/flashcat/hermes-agent/venv/bin/hermes"));
  const hermesCwd = resolveHome(firstText(input.hermesCwd, input.hermes_cwd, process.env.HERMES_CWD, "/home/flashcat/hermes-agent"));
  const hermersRows = await sqlite(paths.dbFile, `
SELECT runtime, agent_id, endpoint_ref, platform, execution_adapter, workflow_ingress_adapter
FROM runtime_agents
WHERE platform='hermers' AND workflow_ingress_adapter='acp' AND status='active'
ORDER BY agent_id;`, { json: true });
  checks.hermersProfiles = [];
  for (const row of hermersRows) {
    const profile = hermesProfileFromEndpoint(row.endpoint_ref, row.agent_id);
    if (!profile || profile.includes(":") || !/^[a-zA-Z0-9_-]+$/.test(profile)) {
      const result = {
        agentId: row.agent_id,
        profile,
        ok: false,
        checkedAt: nowIso(),
        skipped: true,
        error: "invalid Hermers profile resolved from runtime_agents registry"
      };
      checks.hermersProfiles.push(result);
      findings.push({ severity: "warning", key: "hermers_registry_profile_invalid", plane: "runtime", agentId: row.agent_id, profile, endpointRef: row.endpoint_ref || "", error: result.error });
      continue;
    }
    const result = await commandProbe(hermesBin, ["-p", profile, "acp", "--check"], {
      cwd: hermesCwd,
      timeoutMs: 20000,
      env: proxyEnv,
      maxText: 1000
    });
    checks.hermersProfiles.push({ agentId: row.agent_id, profile, ...result });
    if (!result.ok) findings.push({ severity: "warning", key: "hermers_acp_check_failed", plane: "runtime", agentId: row.agent_id, profile, error: result.error });
  }

  const backendId = String(input.acpBackend || input.acp_backend || process.env.TRADING_AGENTS_ACP_BACKEND || "acpx").trim();
  let acpBackendCleanup = async () => {};
  try {
    const resolvedBackend = await resolveAcpBackend(backendId, input, paths);
    acpBackendCleanup = resolvedBackend.cleanup || acpBackendCleanup;
    checks.acpBackend = { ok: true, backend: backendId, source: resolvedBackend.source || "", checkedAt: nowIso() };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const explicitBackend = acpBackendExplicitlyRequested(input);
    const allowFallback = boolOption(input.acpBackendFallback ?? input.acp_backend_fallback ?? process.env.TRADING_AGENTS_ACP_BACKEND_FALLBACK, !explicitBackend);
    const fallbackAvailable = allowFallback && checks.hermersProfiles.some((profile) => profile.ok);
    checks.acpBackend = {
      ok: false,
      backend: backendId,
      checkedAt: nowIso(),
      error: errorMessage,
      fallbackAvailable,
      fallbackAdapter: fallbackAvailable ? "cli" : "",
      fallbackProbe: fallbackAvailable ? "hermes_profile_acp_check" : ""
    };
    findings.push({
      severity: fallbackAvailable ? "info" : "warning",
      key: fallbackAvailable ? "acp_backend_fallback_active" : "acp_backend_unavailable",
      plane: "runtime",
      backend: backendId,
      fallbackAdapter: fallbackAvailable ? "cli" : "",
      fallbackProbe: fallbackAvailable ? "hermes_profile_acp_check" : "",
      error: errorMessage
    });
  } finally {
    try {
      await acpBackendCleanup();
    } catch (error) {
      findings.push({ severity: "warning", key: "acp_backend_cleanup_failed", plane: "runtime", backend: backendId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return checks;
}

function workflowPhaseRecordId(workflowId, phaseKey) {
  return `phase.${cleanFileSegment(workflowId || "workflow")}.${cleanFileSegment(phaseKey || "unphased")}`;
}

async function workflowTaskPhaseInfo(paths, workflowId, taskId, fallbackPhase = "") {
  const phaseKey = String(fallbackPhase || "").trim();
  if (!workflowId || !taskId) return { phaseKey, phaseId: phaseKey ? workflowPhaseRecordId(workflowId, phaseKey) : "" };
  const rows = await sqlite(paths.dbFile, `
SELECT phase FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)} AND task_id=${sqlValue(taskId)}
LIMIT 1;`, { json: true });
  const key = rows[0]?.phase || phaseKey;
  return { phaseKey: key || "", phaseId: key ? workflowPhaseRecordId(workflowId, key) : "" };
}

async function upsertWorkflowAgentRun(paths, run = {}) {
  const now = run.updatedAt || nowIso();
  const agentRunId = run.agentRunId || run.agent_run_id || "";
  if (!agentRunId) return null;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_agent_runs(agent_run_id, workflow_id, phase_id, phase_key, task_id, dispatch_id, runtime_run_id, session_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref, error, payload_json, started_at, completed_at, created_at, updated_at)
VALUES (${sqlValue(agentRunId)}, ${sqlValue(run.workflowId || "")}, ${sqlValue(run.phaseId || "")}, ${sqlValue(run.phaseKey || "")}, ${sqlValue(run.taskId || "")}, ${sqlValue(run.dispatchId || "")}, ${sqlValue(run.runtimeRunId || "")}, ${sqlValue(run.sessionRunId || "")}, ${sqlValue(run.runtime || "")}, ${sqlValue(run.agentId || "")}, ${sqlValue(run.status || "unknown")}, ${Number(run.attempt || 0)}, ${sqlValue(run.inputHash || "")}, ${sqlValue(run.outputHash || "")}, ${sqlValue(run.receiptRef || "")}, ${sqlValue(String(run.error || "").slice(0, 2000))}, ${sqlValue(JSON.stringify(run.payload || {}))}, ${sqlValue(run.startedAt || "")}, ${sqlValue(run.completedAt || "")}, ${sqlValue(run.createdAt || now)}, ${sqlValue(now)})
ON CONFLICT(agent_run_id) DO UPDATE SET
  workflow_id=COALESCE(NULLIF(excluded.workflow_id, ''), workflow_agent_runs.workflow_id),
  phase_id=COALESCE(NULLIF(excluded.phase_id, ''), workflow_agent_runs.phase_id),
  phase_key=COALESCE(NULLIF(excluded.phase_key, ''), workflow_agent_runs.phase_key),
  task_id=COALESCE(NULLIF(excluded.task_id, ''), workflow_agent_runs.task_id),
  dispatch_id=COALESCE(NULLIF(excluded.dispatch_id, ''), workflow_agent_runs.dispatch_id),
  runtime_run_id=COALESCE(NULLIF(excluded.runtime_run_id, ''), workflow_agent_runs.runtime_run_id),
  session_run_id=COALESCE(NULLIF(excluded.session_run_id, ''), workflow_agent_runs.session_run_id),
  runtime=COALESCE(NULLIF(excluded.runtime, ''), workflow_agent_runs.runtime),
  agent_id=COALESCE(NULLIF(excluded.agent_id, ''), workflow_agent_runs.agent_id),
  status=excluded.status,
  attempt=excluded.attempt,
  input_hash=COALESCE(NULLIF(excluded.input_hash, ''), workflow_agent_runs.input_hash),
  output_hash=COALESCE(NULLIF(excluded.output_hash, ''), workflow_agent_runs.output_hash),
  receipt_ref=COALESCE(NULLIF(excluded.receipt_ref, ''), workflow_agent_runs.receipt_ref),
  error=COALESCE(NULLIF(excluded.error, ''), workflow_agent_runs.error),
  payload_json=excluded.payload_json,
  started_at=COALESCE(NULLIF(excluded.started_at, ''), workflow_agent_runs.started_at),
  completed_at=COALESCE(NULLIF(excluded.completed_at, ''), workflow_agent_runs.completed_at),
  updated_at=excluded.updated_at;`);
  return agentRunId;
}

async function pendingHumanGateCount(paths, workflowId) {
  const rows = await sqlite(paths.dbFile, `
SELECT (
  SELECT COUNT(*) FROM review_gates
  WHERE workflow_id=${sqlValue(workflowId)}
    AND (status='pending' OR (human_gate_required=1 AND status NOT IN ('approved','waived','rejected')))
) + (
  SELECT COUNT(*) FROM protocol_objects
  WHERE object_type='human_gate_record'
    AND status='pending'
    AND ${workflowPayloadSqlWhere(workflowId)}
) AS count;`, { json: true });
  return Number(rows[0]?.count || 0);
}

function countByStatus(rows = []) {
  return Object.fromEntries(rows.map((row) => [row.status || "unknown", Number(row.count || 0)]));
}

function statusCountTotal(counts = {}, statuses = []) {
  return statuses.reduce((total, status) => total + Number(counts[status] || 0), 0);
}

function hasAllColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
}

const MESSAGE_FLOW_RUNTIME_HELPERS = createMessageFlowRuntimeHelpers({
  cleanFileSegment,
  deliverTelegramOutboxRow: (...args) => deliverTelegramOutboxRow(...args),
  enqueueTelegramOutbox: (...args) => TELEGRAM_OUTBOX_ACTION_HANDLERS.enqueueTelegramOutbox(...args),
  meetingDispatch: (...args) => meetingDispatch(...args),
  normalizeAgentId,
  normalizeReturnPolicy,
  normalizeRuntime,
  nowIso,
  runtimeAckContract,
  DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID
});

const {
  acknowledgeMessageFlowRuntime,
  appendMessageFlowEvent,
  createMessageFlow,
  dispatchPayloadObject,
  finishMessageFlowRuntime,
  isSemanticContinuationDispatch,
  messageFlowAckTimeoutSeconds,
  messageFlowDispatchStartedStatus,
  messageFlowForDispatch,
  messageFlowIdFromDispatchPayload,
  messageFlowIdFromParts,
  messageFlowOutputIsFinal,
  messageFlowSendPrompt,
  messageFlowSendTargets,
  messageFlowSourceChannel,
  queueMessageFlowSemanticContinuation,
  readMessageFlow,
  recoverAckedMessageFlowSemanticContinuations,
  semanticContinuationTimeoutSeconds,
  syncMessageFlowFromTerminalDispatchReceipt,
  updateMessageFlow,
  updateMessageFlowFromTelegramDelivery
} = MESSAGE_FLOW_RUNTIME_HELPERS;

export const CHECKPOINT_ACTION_HANDLERS = createCheckpointActionHandlers({
  ensureWorkflowLayout,
  pendingHumanGateCount,
  writeJsonArtifact,
  writeTextArtifact
});

export const CHECKPOINT_ACTION_REGISTRY = createCheckpointActionRegistry(CHECKPOINT_ACTION_HANDLERS);

export const {
  workflowCheckpoint
} = CHECKPOINT_ACTION_HANDLERS;

export const CONTROL_LOOP_JOB_ACTION_HANDLERS = createControlLoopJobActionHandlers({
  appendWorkflowEvent,
  ensureWorkflowLayout,
  nowIso,
  CONTROL_LOOP_ACTIVE_JOB_STATUSES
});

export const CONTROL_LOOP_JOB_ACTION_REGISTRY = createControlLoopJobActionRegistry(CONTROL_LOOP_JOB_ACTION_HANDLERS);

export const {
  workflowControlLoopJobRequeuePreview,
  workflowControlLoopJobRequeue
} = CONTROL_LOOP_JOB_ACTION_HANDLERS;

export const WORKFLOW_RUN_ACTION_HANDLERS = createWorkflowRunActionHandlers({
  appendWorkflowEvent,
  ensureWorkflowLayout,
  nowIso,
  WORKFLOW_RUN_STATUSES
});

export const WORKFLOW_RUN_ACTION_REGISTRY = createWorkflowRunActionRegistry(WORKFLOW_RUN_ACTION_HANDLERS);

export const {
  workflowRunUpsert
} = WORKFLOW_RUN_ACTION_HANDLERS;

export const WORKFLOW_TASK_ACTION_HANDLERS = createWorkflowTaskActionHandlers({
  ensureWorkflowLayout,
  normalizeAgentId,
  nowIso,
  resolveRegisteredDispatchTarget,
  safeId,
  workflowRunUpsert,
  WORKFLOW_TASK_PRIORITIES,
  WORKFLOW_TASK_STATUSES
});

export const WORKFLOW_TASK_ACTION_REGISTRY = createWorkflowTaskActionRegistry(WORKFLOW_TASK_ACTION_HANDLERS);

export const {
  workflowTaskCreate,
  workflowTaskUpdate,
  workflowTaskList
} = WORKFLOW_TASK_ACTION_HANDLERS;

export const WORKFLOW_ADVANCE_ACTION_HANDLERS = createWorkflowAdvanceActionHandlers({
  cleanFileSegment,
  ensureWorkflowLayout,
  meetingDispatch: (...args) => meetingDispatch(...args),
  messageFlowForDispatch,
  nowIso,
  pendingHumanGateCount,
  workflowTaskUpdate
});

export const WORKFLOW_ADVANCE_ACTION_REGISTRY = createWorkflowAdvanceActionRegistry(WORKFLOW_ADVANCE_ACTION_HANDLERS);

export const {
  workflowAdvance,
  workflowAdvancePreview
} = WORKFLOW_ADVANCE_ACTION_HANDLERS;

export const WORKFLOW_SUPERVISOR_ACTION_HANDLERS = createWorkflowSupervisorActionHandlers({
  ensureWorkflowLayout,
  meetingDispatch: (...args) => meetingDispatch(...args),
  normalizeAgentId,
  normalizeRuntime,
  nowIso,
  runtimeBridgeDrain: (...args) => runtimeBridgeDrain(...args),
  workflowAdvance,
  workflowAdvancePreview,
  workflowCheckpoint
});

export const WORKFLOW_SUPERVISOR_ACTION_REGISTRY = createWorkflowSupervisorActionRegistry(WORKFLOW_SUPERVISOR_ACTION_HANDLERS);

export const {
  workflowSupervisor,
  workflowSupervisorPreview
} = WORKFLOW_SUPERVISOR_ACTION_HANDLERS;

export const WORKFLOW_TASK_DRAFT_ACTION_HANDLERS = createWorkflowTaskDraftActionHandlers({
  cleanFileSegment,
  normalizeAgentId,
  nowIso,
  resolveRegisteredDispatchTarget,
  HUMAN_GATE_APPROVE_OPTION_MIN,
  HUMAN_GATE_APPROVE_OPTION_MAX
});

export const WORKFLOW_TASK_DRAFT_ACTION_REGISTRY = createWorkflowTaskDraftActionRegistry(WORKFLOW_TASK_DRAFT_ACTION_HANDLERS);

export const {
  workflowTaskDraft
} = WORKFLOW_TASK_DRAFT_ACTION_HANDLERS;

export const WORKFLOW_TASK_LAUNCH_ACTION_HANDLERS = createWorkflowTaskLaunchActionHandlers({
  appendWorkflowEvent,
  cleanFileSegment,
  ensureWorkflowLayout,
  isWorkflowTrustedOperator,
  normalizeAgentId,
  nowIso,
  readProtocolObject,
  workflowPermissionCaller,
  workflowPhaseRecordId,
  workflowRunUpsert,
  workflowTaskCreate,
  workflowTaskDraft,
  writeJsonArtifact,
  writeTextArtifact
});

export const WORKFLOW_TASK_LAUNCH_ACTION_REGISTRY = createWorkflowTaskLaunchActionRegistry(WORKFLOW_TASK_LAUNCH_ACTION_HANDLERS);

export const {
  workflowTaskLaunchPrepare,
  workflowTaskLaunchList,
  workflowTaskLaunchReview,
  workflowTaskLaunchApprove
} = WORKFLOW_TASK_LAUNCH_ACTION_HANDLERS;

export const WORKFLOW_SWARM_ACTION_HANDLERS = createWorkflowSwarmActionHandlers({
  boolOption,
  cleanFileSegment,
  ensureWorkflowLayout,
  normalizeAgentId,
  normalizeRuntime,
  safeId,
  toList,
  workflowRunUpsert,
  workflowTaskCreate
});

export const WORKFLOW_SWARM_ACTION_REGISTRY = createWorkflowSwarmActionRegistry(WORKFLOW_SWARM_ACTION_HANDLERS);

export const {
  workflowSwarmPlan
} = WORKFLOW_SWARM_ACTION_HANDLERS;

export const VERIFICATION_ACTION_HANDLERS = createVerificationActionHandlers({
  ensureWorkflowLayout,
  isWorkflowTrustedOperator,
  nowIso,
  pendingHumanGateCount,
  workflowPayloadSqlWhere,
  workflowPermissionCaller
});

export const VERIFICATION_ACTION_REGISTRY = createVerificationActionRegistry(VERIFICATION_ACTION_HANDLERS);

export const {
  workflowVerificationRecord,
  workflowVerificationList,
  workflowEvaluate
} = VERIFICATION_ACTION_HANDLERS;

export const SESSION_ACTION_HANDLERS = createSessionActionHandlers({
  ensureWorkflowLayout,
  normalizeAgentId,
  upsertWorkflowAgentRun,
  workflowTaskPhaseInfo
});

export const SESSION_ACTION_REGISTRY = createSessionActionRegistry(SESSION_ACTION_HANDLERS);

export const {
  workflowSessionPackGet,
  workflowSessionPackList,
  workflowSessionPackUpsert,
  workflowSessionRunComplete,
  workflowSessionRunStart
} = SESSION_ACTION_HANDLERS;

const WORKFLOW_V2_PLAN_ACTION_HANDLERS = createWorkflowV2PlanActionHandlers({
  cleanFileSegment,
  ensureWorkflowLayout,
  humanGateApproveOptionMax: HUMAN_GATE_APPROVE_OPTION_MAX,
  humanGateApproveOptionMin: HUMAN_GATE_APPROVE_OPTION_MIN,
  nowIso,
  relativeTo,
  writeJsonAtomic
});

export const {
  workflowV2PlanPreview,
  workflowV2PlanCreate
} = WORKFLOW_V2_PLAN_ACTION_HANDLERS;

const WORKFLOW_TEMPLATE_ACTION_HANDLERS = createWorkflowTemplateActionHandlers({
  cleanFileSegment,
  ensureWorkflowLayout,
  nowIso,
  permissionEvidencePresent,
  relativeTo,
  workflowV2PlanCreate,
  workflowV2PlanPreview,
  writeJsonAtomic
});

export const {
  workflowTemplatePreview,
  workflowTemplateRecordCandidate,
  workflowTemplateSearch,
  workflowTemplateGet,
  workflowTemplateInstantiatePreview,
  workflowTemplateInstantiateRecord,
  workflowTemplateEvalPreview,
  workflowTemplateEvalRecord,
  workflowTemplateStatsRefresh,
  workflowTemplatePromotePreview,
  workflowTemplatePromoteRecord,
  workflowTemplateRollbackPreview,
  workflowTemplateRollbackRecord,
  workflowTemplateExtractPreview,
  workflowTemplateExtractRecord
} = WORKFLOW_TEMPLATE_ACTION_HANDLERS;

const WORKFLOW_V2_INFO_STACK_ACTION_HANDLERS = createWorkflowV2InfoStackActionHandlers({
  ensureWorkflowLayout,
  normalizeOptionalAgentId,
  nowIso
});

export const {
  workflowV2NotificationPreview,
  workflowV2InfoStackPreview,
  workflowV2InfoStackRecord,
  workflowV2InfoStackRead,
  workflowV2ReadReceiptRecord
} = WORKFLOW_V2_INFO_STACK_ACTION_HANDLERS;

const WORKFLOW_V2_SESSION_STATE_DEPS = {
  workflowTaskPhaseInfo,
  upsertWorkflowAgentRun
};

const workflowV2RequireSessionRunPatch = (paths, runId = "", patch = {}, context = "worker lifecycle") => (
  workflowV2RequireSessionRunPatchCore(paths, runId, patch, context, WORKFLOW_V2_SESSION_STATE_DEPS)
);

const WORKFLOW_V2_WORKER_LIFECYCLE_ACTION_HANDLERS = createWorkflowV2WorkerLifecycleActionHandlers({
  ensureWorkflowLayout,
  normalizeOptionalAgentId,
  nowIso,
  workflowTaskPhaseInfo,
  workflowV2AutonomousLoopSpawnGate,
  workflowV2CleanupInfoStackItem,
  workflowV2InfoStackExistingItem,
  workflowV2InfoStackPreview,
  workflowV2InfoStackRecord,
  workflowV2RequireSessionRunPatch
});

export const {
  workflowV2WorkerBackendPreflight,
  workflowV2WorkerBackendPreflightRecord,
  workflowV2WorkerSpawnPreview,
  workflowV2WorkerSpawnCreate,
  workflowV2WorkerLifecyclePreview,
  workflowV2WorkerHandoffPreview,
  workflowV2WorkerHandoffRecord,
  workflowV2WorkerRetirePreview,
  workflowV2WorkerRetireRecord,
  workflowV2WorkerSuccessorPreview,
  workflowV2WorkerSuccessorCreate
} = WORKFLOW_V2_WORKER_LIFECYCLE_ACTION_HANDLERS;

const WORKFLOW_V2_CONTROL_LOOP_ACTION_HANDLERS = createWorkflowV2ControlLoopActionHandlers({
  cleanFileSegment,
  ensureWorkflowLayout,
  hasAllColumns,
  nowIso,
  workflowV2AutonomousLoopMaybeTerminalizeNode,
  workflowV2CleanupInfoStackItem,
  workflowV2InfoStackExistingItem,
  workflowV2InfoStackRecord,
  workflowV2RequireSessionRunPatch,
  workflowV2WorkerRetryDelayMs,
  writeJsonAtomic
});

export const {
  workflowV2ControlLoopPreview,
  workflowV2ControlLoopTick
} = WORKFLOW_V2_CONTROL_LOOP_ACTION_HANDLERS;

const WORKFLOW_V2_WORKER_RESULT_ACTION_HANDLERS = createWorkflowV2WorkerResultActionHandlers({
  ensureWorkflowLayout,
  nowIso,
  workflowV2AutonomousLoopMaybeTerminalizeNode,
  workflowV2CleanupInfoStackItem,
  workflowV2InfoStackExistingItem,
  workflowV2InfoStackPreview,
  workflowV2InfoStackRecord,
  workflowV2RequireSessionRunPatch,
  workflowV2RestoreSessionRunRow,
  workflowV2WorkerRetryDelayMs
});

export const {
  workflowV2WorkerResultSubmitPreview,
  workflowV2WorkerResultSubmit,
  workflowV2WorkerResultFailPreview,
  workflowV2WorkerResultFail
} = WORKFLOW_V2_WORKER_RESULT_ACTION_HANDLERS;

const WORKFLOW_V2_ADAPTER_RUNNER_ACTION_HANDLERS = createWorkflowV2AdapterRunnerActionHandlers({
  cleanFileSegment,
  ensureWorkflowLayout,
  execFileAsync,
  nowIso,
  pathExists,
  sessionRunFromRow,
  workflowV2CleanupInfoStackItem,
  workflowV2InfoStackExistingItem,
  workflowV2InfoStackPreview,
  workflowV2InfoStackRecord,
  workflowV2WorkerResultFail,
  workflowV2WorkerResultSubmit,
  writeJsonAtomic
});

export const {
  workflowV2WorkerAdapterJobPreview,
  workflowV2WorkerAdapterJobRecord,
  workflowV2WorkerAdapterJobList,
  workflowV2WorkerAdapterJobClaim,
  workflowV2WorkerAdapterJobHeartbeat,
  workflowV2WorkerAdapterJobRelease,
  workflowV2WorkerAdapterJobFail,
  workflowV2AdapterRunnerPreview,
  workflowV2AdapterRunnerDrain
} = WORKFLOW_V2_ADAPTER_RUNNER_ACTION_HANDLERS;

async function workflowV2InfoStackExistingItem(dbFile, infoId = "") {
  if (!infoId) return null;
  const rows = await sqlite(dbFile, `
SELECT info_id, workflow_id, worker_run_id
FROM workflow_v2_info_items
WHERE info_id=${sqlValue(infoId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowV2CleanupInfoStackItem(dbFile, infoId = "") {
  if (!infoId) return;
  await sqlite(dbFile, `
DELETE FROM workflow_v2_read_receipts WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_notifications WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_access_grants WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_inbox_items WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_info_items WHERE info_id=${sqlValue(infoId)};`);
}

const WORKFLOW_V2_REVIEW_ACTION_HANDLERS = createWorkflowV2ReviewActionHandlers({
  ensureWorkflowLayout,
  normalizeOptionalAgentId,
  nowIso,
  workflowV2LoadPlanRow,
  workflowV2PatchPlanWorkflowState,
  workflowV2PlanOrchestrationPattern,
  workflowV2RequireSessionRunPatch,
  workflowV2RestoreManagerReviewRow
});

export const {
  workflowV2ManagerReviewRecord,
  workflowV2OwnerReviewPreview,
  workflowV2OwnerReviewRecord,
  workflowV2TaskGroupPackagePreview,
  workflowV2TaskGroupPackageRecord,
  workflowV2CatBrainAuditPreview,
  workflowV2CatBrainAuditRecord,
  workflowV2CatClawAuditPreview,
  workflowV2CatClawAuditRecord
} = WORKFLOW_V2_REVIEW_ACTION_HANDLERS;

const WORKFLOW_V2_HUMAN_GATE_ACTION_HANDLERS = createWorkflowV2HumanGateActionHandlers({
  auditHumanGatePlanDetails,
  auditHumanGatePlanOptions,
  auditHumanGatePrimaryLanguage,
  combineHumanGateAudits,
  ensureWorkflowLayout,
  humanGateApproveOptionMax: HUMAN_GATE_APPROVE_OPTION_MAX,
  humanGateApproveOptionMin: HUMAN_GATE_APPROVE_OPTION_MIN,
  humanGateButtonIsControl,
  humanGateButtonOptions,
  humanGateButtonRole,
  humanGatePlanOptionButtons,
  humanGateRequest,
  humanGateWebAppConfig,
  normalizeOptionalAgentId,
  nowIso,
  pendingHumanGateForStage,
  workflowV2PatchPlanWorkflowState
});

export const {
  workflowV2HumanGatePackagePreview,
  workflowV2HumanGatePackageRecord,
  workflowV2HumanGateRequestPreview,
  workflowV2HumanGateRequest
} = WORKFLOW_V2_HUMAN_GATE_ACTION_HANDLERS;

const WORKFLOW_V2_VALIDATE_ACTION_HANDLERS = createWorkflowV2ValidateActionHandlers({
  hasAllColumns,
  humanGateApproveOptionMax: HUMAN_GATE_APPROVE_OPTION_MAX,
  humanGateApproveOptionMin: HUMAN_GATE_APPROVE_OPTION_MIN,
  workflowV2AutonomousLoopNodeTypes: WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES
});

export const {
  workflowV2Validate
} = WORKFLOW_V2_VALIDATE_ACTION_HANDLERS;

async function readProtocolObject(paths, objectId) {
  if (!objectId) return null;
  const rows = await sqlite(paths.dbFile, `SELECT * FROM protocol_objects WHERE object_id=${sqlValue(objectId)} LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) return null;
  return { ...row, payload: parseJsonValue(row.payload_json, {}) };
}

async function writeJsonArtifact(root, dir, id, payload) {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${cleanFileSegment(id)}.json`);
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return relativeTo(root, filePath);
}

async function writeTextArtifact(root, dir, id, extension, content) {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${cleanFileSegment(id)}.${extension}`);
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return relativeTo(root, filePath);
}

async function appendJsonl(filePath, record) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
}

function numberOption(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function retentionConfig(input = {}) {
  return {
    enabled: boolOption(
      input.retention ?? input.enableRetention ?? input.enable_retention ?? process.env.TRADING_AGENTS_WORKFLOW_RETENTION,
      true
    ),
    retentionHours: numberOption(
      input.retentionHours ?? input.retention_hours ?? process.env.TRADING_AGENTS_WORKFLOW_RETENTION_HOURS,
      DEFAULT_WORKFLOW_RETENTION_HOURS,
      1,
      30 * 24
    ),
    intervalMs: numberOption(
      input.retentionIntervalMs ?? input.retention_interval_ms ?? process.env.TRADING_AGENTS_WORKFLOW_RETENTION_INTERVAL_MS,
      DEFAULT_WORKFLOW_RETENTION_INTERVAL_MS,
      60_000,
      24 * 3600_000
    )
  };
}

function extractJsonlRecordTimestamp(record = {}) {
  return firstText(
    record.ts,
    record.startedAt,
    record.checkedAt,
    record.createdAt,
    record.updatedAt,
    record.completedAt,
    record.dispatchedAt,
    record.receivedAt
  );
}

function extractJsonlLineTimestamp(line) {
  try {
    return extractJsonlRecordTimestamp(JSON.parse(line));
  } catch {
    const match = String(line || "").match(/"(ts|startedAt|checkedAt|createdAt|updatedAt|completedAt|dispatchedAt|receivedAt)":"([^"]+)"/);
    return match ? match[2] : "";
  }
}

function isTimestampBefore(timestamp, cutoffMs) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed < cutoffMs;
}

async function firstJsonlTimestamp(filePath) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!String(line).trim()) continue;
      return extractJsonlLineTimestamp(line);
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return "";
}

async function pruneJsonlFile(filePath, cutoffMs) {
  const firstTimestamp = await firstJsonlTimestamp(filePath);
  if (!firstTimestamp || !isTimestampBefore(firstTimestamp, cutoffMs)) {
    return { file: path.basename(filePath), status: "kept", firstTimestamp };
  }

  const tmpFile = `${filePath}.tmp-retention-${process.pid}`;
  let total = 0;
  let kept = 0;
  let pruned = 0;
  let missingTimestamp = 0;
  const input = createReadStream(filePath, { encoding: "utf8" });
  const reader = createInterface({ input, crlfDelay: Infinity });
  const output = createWriteStream(tmpFile, { encoding: "utf8" });
  const waitForDrain = () => new Promise((resolve) => output.once("drain", resolve));
  try {
    for await (const line of reader) {
      if (!String(line).trim()) continue;
      total += 1;
      const timestamp = extractJsonlLineTimestamp(line);
      if (timestamp && isTimestampBefore(timestamp, cutoffMs)) {
        pruned += 1;
        continue;
      }
      if (!timestamp) missingTimestamp += 1;
      kept += 1;
      if (!output.write(`${line}\n`)) await waitForDrain();
    }
    await new Promise((resolve, reject) => {
      output.once("error", reject);
      output.end(resolve);
    });
    await fs.rename(tmpFile, filePath);
    return { file: path.basename(filePath), status: "pruned", firstTimestamp, total, kept, pruned, missingTimestamp };
  } catch (error) {
    output.destroy();
    await fs.rm(tmpFile, { force: true }).catch(() => {});
    throw error;
  } finally {
    reader.close();
    input.destroy();
  }
}

async function pruneWorkflowBackups(paths) {
  const removed = [];
  const backupDir = path.join(paths.root, "backups");
  for (const dir of [backupDir]) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const filePath = path.join(dir, entry.name);
      await fs.rm(filePath, { force: true });
      removed.push(relativeTo(paths.root, filePath));
    }
  }

  let rootEntries = [];
  try {
    rootEntries = await fs.readdir(paths.root, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  for (const entry of rootEntries) {
    if (!entry.isFile() || (!entry.name.startsWith(`${WORKFLOW_CONTROL_PLANE_DB}.bak-`) && !entry.name.startsWith(`${LEGACY_TRACKING_DB}.bak-`))) continue;
    const filePath = path.join(paths.root, entry.name);
    await fs.rm(filePath, { force: true });
    removed.push(relativeTo(paths.root, filePath));
  }
  return { removedCount: removed.length, removed };
}

async function pruneWorkflowBridgeJsonl(paths, cutoffMs) {
  let entries = [];
  try {
    entries = await fs.readdir(paths.bridgeDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    results.push(await pruneJsonlFile(path.join(paths.bridgeDir, entry.name), cutoffMs));
  }
  return results;
}

async function pruneWorkflowDatabase(paths, cutoffIso) {
  const activeStatuses = [...CONTROL_LOOP_ACTIVE_JOB_STATUSES].map(sqlValue).join(",");
  const before = await sqlite(paths.dbFile, `
SELECT 'readiness_snapshots' AS name, COUNT(*) AS count FROM readiness_snapshots WHERE checked_at < ${sqlValue(cutoffIso)}
UNION ALL SELECT 'control_loop_jobs', COUNT(*) FROM control_loop_jobs WHERE created_at < ${sqlValue(cutoffIso)} AND status NOT IN (${activeStatuses});`, { json: true });
  await sqlite(paths.dbFile, `
PRAGMA busy_timeout=10000;
DELETE FROM readiness_snapshots WHERE checked_at < ${sqlValue(cutoffIso)};
DELETE FROM control_loop_jobs WHERE created_at < ${sqlValue(cutoffIso)} AND status NOT IN (${activeStatuses});`);
  return Object.fromEntries(before.map((row) => [row.name, Number(row.count || 0)]));
}

async function maybeRunWorkflowRetention(paths, input = {}) {
  const config = retentionConfig(input);
  if (!config.enabled) return { status: "disabled" };
  const markerFile = path.join(paths.bridgeDir, "control-loop-retention.json");
  const previous = await readOptionalJson(markerFile).catch(() => null);
  const lastRunMs = Date.parse(previous?.lastRunAt || "");
  if (Number.isFinite(lastRunMs) && Date.now() - lastRunMs < config.intervalMs) {
    return { status: "skipped_recent", lastRunAt: previous.lastRunAt, retentionHours: config.retentionHours, intervalMs: config.intervalMs };
  }

  const startedAt = nowIso();
  const cutoffMs = Date.now() - config.retentionHours * 3600_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  const backups = await pruneWorkflowBackups(paths);
  const database = await pruneWorkflowDatabase(paths, cutoffIso);
  const bridgeJsonl = await pruneWorkflowBridgeJsonl(paths, cutoffMs);
  const completedAt = nowIso();
  const summary = { status: "ok", startedAt, completedAt, cutoffIso, retentionHours: config.retentionHours, intervalMs: config.intervalMs, backups, database, bridgeJsonl };
  await fs.writeFile(markerFile, `${JSON.stringify({ ...summary, lastRunAt: completedAt }, null, 2)}\n`, "utf8");
  return summary;
}

async function appendTranscript(paths, meetingId, line) {
  const filePath = path.join(paths.messagesDir, `${cleanFileSegment(meetingId)}.transcript.md`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${line}\n`, "utf8");
  return relativeTo(paths.root, filePath);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compactText(value, max = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function humanGateTranslatedText(value, max = 520) {
  const text = compactText(value, max);
  if (!text) return "";
  return compactText(HUMAN_GATE_ZH_TEXT.get(text) || text, max);
}

function stripHumanGatePlanPrefix(value = "") {
  return String(value || "")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^(?:批准)?方案\s*[A-Z]\s*[:：]?\s*/i, "")
    .replace(/^(?:plan|option)\s*[A-Z]\s*[:：]?\s*/i, "")
    .replace(/^[A-Z]\s*[:：]\s*/i, "")
    .trim();
}

function humanGateLocalizedPlanTitle(value = {}, key = "", max = 36) {
  const payload = parseJsonValue(value.payload, value.payload || {});
  const nestedPayload = parseJsonValue(payload.payload, payload.payload || {});
  const raw = stripHumanGatePlanPrefix(firstText(
    nestedPayload.title,
    nestedPayload.name,
    payload.title,
    payload.name,
    value.title,
    value.name,
    value.label,
    value.summary,
    value.description,
    value.text,
    key ? `方案 ${key}` : ""
  ));
  return humanGateTranslatedText(raw, max);
}

function humanGateLocalizedDetail(value, max = 520) {
  return humanGateTranslatedText(humanGateSafeDetailString(value, max), max);
}

function humanGateWorkflowId(row, payload = {}, body = {}) {
  return String(body.workflowId || body.workflow_id || payload.workflowId || payload.workflow_id || row.parent_object_id || row.object_id || "").trim();
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function buttonArrayFromRaw(raw) {
  const parsed = parseJsonValue(raw, raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed).map(([key, value]) => value && typeof value === "object" ? { optionKey: key, ...value } : { optionKey: key, label: String(value || key).trim() });
  }
  return null;
}

function humanGateButtonSource(payload = {}, body = {}) {
  const raw = firstDefined(
    body.buttons,
    body.buttonOptions,
    body.button_options,
    body.choices,
    body.raw?.buttons,
    body.raw?.buttonOptions,
    body.raw?.button_options,
    body.raw?.choices,
    payload.buttons,
    payload.buttonOptions,
    payload.button_options,
    payload.choices
  );
  const parsed = buttonArrayFromRaw(raw);
  return parsed && parsed.length ? parsed : null;
}

function humanGateAlternativeSource(payload = {}, body = {}) {
  const raw = firstDefined(
    body.alternatives,
    body.plans,
    body.planOptions,
    body.plan_options,
    body.options,
    body.raw?.alternatives,
    body.raw?.plans,
    body.raw?.planOptions,
    body.raw?.plan_options,
    body.raw?.options,
    payload.alternatives,
    payload.plans,
    payload.planOptions,
    payload.plan_options,
    payload.options
  );
  const parsed = buttonArrayFromRaw(raw);
  return parsed && parsed.length ? parsed : null;
}

function optionKeyLabel(value, index) {
  const raw = String(value.optionKey || value.option_key || value.key || value.id || value.name || "").trim();
  if (raw) return raw.toUpperCase();
  return String(index + 1);
}

function humanGateAlternativeButtons(row, payload = {}, body = {}) {
  const alternatives = humanGateAlternativeSource(payload, body);
  if (!alternatives) return null;
  const artifactRef = humanGateArtifactRef(row, payload, body);
  return alternatives.map((rawItem, index) => {
    const value = rawItem && typeof rawItem === "object" ? rawItem : { title: String(rawItem || "").trim() };
    const key = optionKeyLabel(value, index);
    const title = humanGateLocalizedPlanTitle(value, key);
    const summary = humanGateLocalizedDetail(firstText(value.summary, value.description, value.text, title || `批准方案 ${key}`), 700);
    const prompt = humanGateLocalizedDetail(firstText(value.prompt, value.nextAction, value.next_action, `按方案 ${key} 继续推进 workflow。`), 520);
    const rollback = humanGateLocalizedDetail(firstText(value.rollback, value.rollbackPlan, value.rollback_plan, value.recovery, value.restore, value.fallback), 520);
    return {
      label: `批准方案 ${key}${title ? `：${title}` : ""}`,
      decisionStatus: "approved",
      role: "approve_option",
      style: HUMAN_GATE_PLAN_STYLE,
      artifactRef: String(value.artifactRef || value.artifact_ref || artifactRef).trim(),
      summary,
      prompt,
      rollback,
      payload: { ...value, optionKey: key, optionIndex: index, localized: { title, summary, prompt, rollback } }
    };
  });
}

function humanGateControlButtons(row, payload = {}, body = {}, options = {}) {
  const summary = humanGateSummary(payload, body);
  const artifactRef = humanGateArtifactRef(row, payload, body);
  const controls = [];
  if (options.includeApprove) {
    controls.push({
      label: "批准并继续",
      decisionStatus: "approved",
      role: "approve",
      style: "success",
      artifactRef,
      summary: summary || "批准本次 Human Gate，继续推进工作流。",
      prompt: "从本次已批准的 Human Gate 边界继续推进工作流。"
    });
  }
  controls.push(
    {
      label: "退回补证/修改",
      decisionStatus: "rejected",
      role: "reject",
      style: "danger",
      artifactRef,
      summary: humanGateTranslatedText(summary, 700) || "退回本次 Human Gate，要求补齐证据包或修改方案后再次提交。",
      prompt: "补齐证据包或修改方案；如仍需闪电猫确认，重新提交 Human Gate。"
    },
    {
      label: "暂停工作流",
      decisionStatus: "paused",
      role: "pause",
      style: "primary",
      artifactRef,
      summary: "暂停该 workflow，不继续自动推进，等待新的明确指令或 Human Gate。",
      prompt: "暂停该 workflow；不要继续自动推进。"
    },
    {
      label: "终止工作流",
      decisionStatus: "terminated",
      role: "terminate",
      style: "danger",
      artifactRef,
      summary: "闪电猫确认成果已完成且复核满足要求，进入猫爪/猫之脑正式收口并结束该 workflow。",
      prompt: "进入工作流收口：猫爪整理最终汇报，猫之脑关闭任务和证据状态，结束该 workflow。"
    }
  );
  return controls;
}

function rawHumanGateButtonObject(rawItem) {
  if (typeof rawItem === "string") {
    const parsed = parseJsonValue(rawItem, rawItem);
    return parsed && typeof parsed === "object" ? parsed : { label: String(parsed || rawItem || "").trim() };
  }
  return rawItem && typeof rawItem === "object" ? { ...rawItem } : { label: String(rawItem || "").trim() };
}

function humanGatePlanKey(value = {}, fallback = "") {
  const raw = String(value.optionKey || value.option_key || value.key || value.payload?.optionKey || value.payload?.option_key || "").trim();
  if (raw) return raw.toUpperCase();
  const label = String(value.label || value.title || value.text || "").trim();
  const match = label.match(/(?:批准)?方案\s*([A-Z0-9一二三四五])(?:\s|:|：|\.|、|$)/i)
    || label.match(/\b(?:plan|option)\s*([A-Z0-9])(?:\s|:|：|\.|、|$)/i)
    || label.match(/^([A-Z0-9])(?:\s|:|：|\.|、|$)/);
  return match ? match[1].toUpperCase() : fallback;
}

function normalizeRawHumanGateButtonSpecs(specs = [], row = {}, payload = {}, body = {}) {
  const result = [];
  let nextPlanIndex = 0;
  for (const rawItem of specs) {
    const value = rawHumanGateButtonObject(rawItem);
    const roleRaw = humanGateButtonRole(value);
    const status = normalizeHumanGateDecisionStatus(humanGateButtonStatus(value), humanGateDecisionStatusFromRole(roleRaw, "approved"));
    const role = roleRaw || defaultHumanGateButtonRole(status);
    const isControl = status !== "approved" || ["reject", "pause", "terminate"].includes(role);
    if (!isControl) {
      const defaultKey = String(nextPlanIndex + 1);
      const key = humanGatePlanKey(value, defaultKey);
      nextPlanIndex += 1;
      const title = humanGateLocalizedPlanTitle(value, key);
      const rawPayload = parseJsonValue(value.payload, value.payload || {});
      const summary = humanGateLocalizedDetail(firstText(value.summary, value.description, value.text, title || `批准方案 ${key}`), 700);
      const prompt = humanGateLocalizedDetail(firstText(value.prompt, value.nextAction, value.next_action), 520);
      const rollback = humanGateLocalizedDetail(firstText(value.rollback, value.rollbackPlan, value.rollback_plan, rawPayload.rollback, rawPayload.rollbackPlan, rawPayload.rollback_plan, rawPayload.recovery, rawPayload.restore, rawPayload.fallback), 520);
      result.push({
        ...value,
        label: `批准方案 ${key}${title ? `：${title}` : ""}`,
        decisionStatus: "approved",
        role: role === "approve" ? "approve_option" : role,
        style: HUMAN_GATE_PLAN_STYLE,
        summary,
        prompt,
        rollback,
        payload: { ...rawPayload, optionKey: key, optionIndex: nextPlanIndex - 1, localized: { title, summary, prompt, rollback } }
      });
    } else {
      result.push({
        ...value,
        summary: humanGateTranslatedText(value.summary || value.description || value.text || "", 700),
        decisionStatus: status,
        role,
        style: HUMAN_GATE_CONTROL_STYLES[role] || HUMAN_GATE_CONTROL_STYLES[status] || value.style || defaultHumanGateButtonStyle(status)
      });
    }
  }
  return result;
}

function hasHumanGateButton(buttons = [], statuses = [], roles = []) {
  const statusSet = new Set(statuses);
  const roleSet = new Set(roles);
  return buttons.some((button) => {
    const status = humanGateButtonStatus(button);
    const role = humanGateButtonRole(button);
    return (status && statusSet.has(status)) || (role && roleSet.has(role));
  });
}

function withHumanGateControlButtons(buttons = [], row = {}, payload = {}, body = {}) {
  const result = [...buttons];
  const controls = humanGateControlButtons(row, payload, body, { includeApprove: false });
  for (const control of controls) {
    const status = humanGateButtonStatus(control);
    const role = humanGateButtonRole(control);
    if (!hasHumanGateButton(result, [status], [role])) result.push(control);
  }
  return result;
}

function humanGateButtonSpecs(row, payload = {}, body = {}) {
  const explicit = humanGateButtonSource(payload, body);
  if (explicit) return withHumanGateControlButtons(normalizeRawHumanGateButtonSpecs(explicit, row, payload, body), row, payload, body);
  const alternatives = humanGateAlternativeButtons(row, payload, body);
  if (alternatives) return withHumanGateControlButtons(normalizeRawHumanGateButtonSpecs(alternatives, row, payload, body), row, payload, body);
  return defaultHumanGateButtons(row, payload, body);
}

function auditHumanGatePlanDetails(buttons = []) {
  const planButtons = humanGatePlanOptionButtons(buttons);
  const missing = [];
  const nonChinese = [];
  for (const [index, button] of planButtons.entries()) {
    const fallback = String(index + 1);
    const key = humanGatePlanKey(button, fallback);
    const title = humanGateLocalizedPlanTitle(button, key, 80);
    const summary = firstHumanGateDetail(button, ["summary", "description", "text", "content"], 700);
    const prompt = firstHumanGateDetail(button, ["prompt", "nextAction", "next_action", "nextStep", "next_step", "execution", "action"], 520);
    const rollback = firstHumanGateDetail(button, ["rollback", "rollbackPlan", "rollback_plan", "rollbackBoundary", "rollback_boundary", "recovery", "restore", "fallback"], 520);
    if (!title && !String(button.label || "").trim()) missing.push(`${key}.title`);
    if (!summary) missing.push(`${key}.summary`);
    if (!prompt) missing.push(`${key}.prompt`);
    if (!rollback) missing.push(`${key}.rollback`);
    const optionText = [title, summary, prompt, rollback].filter(Boolean).join("\n");
    if (optionText && !hasChineseFormatProse(optionText, { minChineseChars: 4, minChineseShare: 0.2 })) nonChinese.push(`${key}.option`);
  }
  const ok = missing.length === 0 && nonChinese.length === 0;
  return {
    ok,
    missingDetailFields: missing,
    nonChineseDetailFields: nonChinese,
    languagePolicy: "cat_claw_report_chinese_format; English terms, agent ids, artifact paths, symbols, and callback/tool names may remain original",
    reason: missing.length
      ? "human_gate_requires_complete_plan_details"
      : nonChinese.length
        ? "human_gate_requires_chinese_plan_details"
        : ""
  };
}

function countChineseChars(value) {
  return (String(value || "").match(/[\u3400-\u9fff]/g) || []).length;
}

function countLatinWordTokens(value) {
  return (String(value || "").match(/[A-Za-z][A-Za-z0-9_-]*/g) || [])
    .filter((token) => token.length > 1)
    .length;
}

function chineseFormatProfile(value) {
  const text = String(value || "");
  const chineseChars = countChineseChars(text);
  const latinWordTokens = countLatinWordTokens(text);
  const chineseShare = chineseChars / Math.max(1, chineseChars + latinWordTokens * 2);
  return { chineseChars, latinWordTokens, chineseShare };
}

function hasChineseFormatProse(value, options = {}) {
  const minChineseChars = Number(options.minChineseChars || 8);
  const minChineseShare = Number(options.minChineseShare || 0.25);
  const profile = chineseFormatProfile(value);
  return profile.chineseChars >= minChineseChars && profile.chineseShare >= minChineseShare;
}

function auditHumanGatePrimaryLanguage(context = {}, buttons = []) {
  const payload = parseJsonValue(context.payload, context.payload || {});
  const nestedPayload = parseJsonValue(payload.payload, payload.payload || {});
  const primaryTextParts = [
    context.title,
    context.summary,
    context.text,
    context.content,
    context.description,
    payload.title,
    payload.summary,
    payload.text,
    payload.content,
    payload.description,
    nestedPayload.title,
    nestedPayload.summary,
    nestedPayload.text,
    nestedPayload.content,
    nestedPayload.description
  ];
  const textParts = [...primaryTextParts];
  for (const [index, button] of humanGatePlanOptionButtons(buttons).entries()) {
    const fallback = String(index + 1);
    const key = humanGatePlanKey(button, fallback);
    textParts.push(
      humanGateLocalizedPlanTitle(button, key, 80),
      firstHumanGateDetail(button, ["summary", "description", "text", "content"], 700),
      firstHumanGateDetail(button, ["prompt", "nextAction", "next_action", "nextStep", "next_step", "execution", "action"], 520),
      firstHumanGateDetail(button, ["rollback", "rollbackPlan", "rollback_plan", "rollbackBoundary", "rollback_boundary", "recovery", "restore", "fallback"], 520)
    );
  }
  const primaryAuthoredText = primaryTextParts.filter(Boolean).join("\n");
  const visibleAuthoredText = textParts.filter(Boolean).join("\n");
  const primaryProfile = chineseFormatProfile(primaryAuthoredText);
  const visibleProfile = chineseFormatProfile(visibleAuthoredText);
  const requiredChineseChars = 8;
  const requiredChineseShare = 0.25;
  const ok = hasChineseFormatProse(primaryAuthoredText, { minChineseChars: requiredChineseChars, minChineseShare: requiredChineseShare })
    && hasChineseFormatProse(visibleAuthoredText, { minChineseChars: requiredChineseChars, minChineseShare: requiredChineseShare });
  return {
    ok,
    primaryChineseChars: primaryProfile.chineseChars,
    chineseChars: visibleProfile.chineseChars,
    primaryLatinWordTokens: primaryProfile.latinWordTokens,
    latinWordTokens: visibleProfile.latinWordTokens,
    primaryChineseShare: primaryProfile.chineseShare,
    chineseShare: visibleProfile.chineseShare,
    requiredChineseChars,
    requiredChineseShare,
    languagePolicy: "cat_claw_report_chinese_format; English terms, agent ids, artifact paths, symbols, and callback/tool names may remain original",
    reason: ok ? "" : "human_gate_requires_chinese_primary_report"
  };
}

function humanGateButtonShape(value = {}) {
  return [humanGateButtonStatus(value), humanGateButtonRole(value), String(value.label || value.title || value.text || "").trim(), String(value.style || "").trim()].join("\u0000");
}

function humanGateButtonsRequireRefresh(existingButtons = [], desiredSpecs = []) {
  if (!existingButtons.length) return true;
  if (existingButtons.some((button) => ["Approve and continue", "Reject and revise"].includes(String(button.label || "").trim()))) return true;
  const desiredButtons = humanGateButtonOptions({ buttons: desiredSpecs, addDefaultControls: false });
  const existingShapes = new Set(existingButtons.map(humanGateButtonShape));
  return desiredButtons.some((button) => !existingShapes.has(humanGateButtonShape(button)));
}

function defaultHumanGateButtons(row, payload = {}, body = {}) {
  return [];
}

async function ensureHumanGateButtonSet(paths, row, payload = {}, body = {}, workflowId = "", meetingId = "") {
  const lockedRows = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(row.object_id)} AND status IN ('feedback_pending','selected')
ORDER BY updated_at DESC
LIMIT 1;`, { json: true });
  if (lockedRows[0]) {
    return {
      buttons: [humanGateButtonFromRow(lockedRows[0], paths.root)],
      refreshed: false,
      reason: `human_gate_${lockedRows[0].status}`,
      audit: { ok: true, reason: "" }
    };
  }
  const desiredSpecs = humanGateButtonSpecs(row, payload, body);
  let buttons = (await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(row.object_id)} AND status='active'
ORDER BY created_at ASC;`, { json: true })).map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root));
  if (!desiredSpecs.length && buttons.length) {
    const existingAudit = combineHumanGateAudits(
      auditHumanGatePlanOptions(buttons),
      auditHumanGatePlanDetails(buttons),
      auditHumanGatePrimaryLanguage({ ...payload, ...body, payload, text: body.text || body.summary || payload.text || payload.summary || row.summary || "" }, buttons)
    );
    if (existingAudit.ok) return { buttons, refreshed: false, reason: "existing_buttons_retained", audit: existingAudit };
    const refreshedAt = nowIso();
    await sqlite(paths.dbFile, `
UPDATE human_gate_buttons
SET status='superseded', updated_at=${sqlValue(refreshedAt)}
WHERE human_gate_id=${sqlValue(row.object_id)} AND status='active';`);
    return { buttons: [], refreshed: true, reason: existingAudit.reason, audit: existingAudit };
  }
  const audit = combineHumanGateAudits(
    auditHumanGatePlanOptions(desiredSpecs),
    auditHumanGatePlanDetails(desiredSpecs),
    auditHumanGatePrimaryLanguage({ ...payload, ...body, payload, text: body.text || body.summary || payload.text || payload.summary || row.summary || "" }, desiredSpecs)
  );
  if (!audit.ok) {
    const refreshedAt = nowIso();
    await sqlite(paths.dbFile, `
UPDATE human_gate_buttons
SET status='superseded', updated_at=${sqlValue(refreshedAt)}
WHERE human_gate_id=${sqlValue(row.object_id)} AND status='active';`);
    return { buttons: [], refreshed: true, reason: audit.reason, audit };
  }
  if (!buttons.length) {
    buttons = await createHumanGateButtons(paths, {
      workflowId,
      meetingId,
      humanGateId: row.object_id,
      createdBy: "cat_claw",
      buttons: desiredSpecs
    });
    return { buttons, refreshed: true, reason: "created", audit };
  }
  if (!humanGateButtonsRequireRefresh(buttons, desiredSpecs)) return { buttons, refreshed: false, reason: "", audit };
  const refreshedAt = nowIso();
  await sqlite(paths.dbFile, `
UPDATE human_gate_buttons
SET status='superseded', updated_at=${sqlValue(refreshedAt)}
WHERE human_gate_id=${sqlValue(row.object_id)} AND status='active';`);
  buttons = await createHumanGateButtons(paths, {
    workflowId,
    meetingId,
    humanGateId: row.object_id,
    createdBy: "cat_claw",
    buttons: desiredSpecs
  });
  return { buttons, refreshed: true, reason: "refreshed_button_policy", audit };
}

async function dispatchHumanGatePlanRevision(rootDir, paths, row, workflowId, meetingId, summary, audit) {
  const createdAt = nowIso();
  const eventId = safeId("control");
  await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId || workflowId || row.object_id)}, 'human_gate_audit_failed', 'blocked', ${sqlValue("Human Gate evidence package lacks required complete approve options")}, ${sqlValue(JSON.stringify({ humanGateId: row.object_id, workflowId, audit }))}, 'cat_claw', ${sqlValue(createdAt)});`);
  const dispatch = await meetingDispatch(rootDir, {
    workflowRootDir: paths.root,
    meetingId: meetingId || workflowId || row.object_id,
    workflowId,
    traceId: `${workflowId || row.object_id}:human_gate_policy_audit:${row.object_id}`,
    idempotencyKey: `workflow:${workflowId || row.object_id}:human_gate_policy_audit:${row.object_id}`,
    runtime: "openclaw",
    agentId: "main",
    dispatchType: "human_gate_evidence_revision",
    priority: "steer",
    createdBy: "cat_claw",
    prompt: [
      "猫爪 Human Gate 证据包审计未通过。",
      `Human Gate ID: ${row.object_id}`,
      `Workflow ID: ${workflowId || ""}`,
      `摘要: ${summary || ""}`,
      "",
      `硬性要求：提交给闪电猫的 Human Gate 汇报必须包含 ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} 个可独立批准的备选方案。`,
      "语言要求：猫爪正式汇报使用中文格式组织正文和说明，让闪电猫直接读懂；English terms、agent id、artifact 路径、symbol、tool/callback 名称和必要原文可以保留原文，不要求每个词都翻译成中文。",
      "硬性要求：Telegram 按钮必须使用 Bot API style 字段渲染整按钮颜色；不要用颜色方块 emoji 冒充按钮底色。",
      `猫爪只审计是否满足该结构，不生成方案内容。请猫之脑 main 补齐备选方案内容，并在再次交给猫爪前自检：${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} 个方案存在、互斥、可执行、有证据和回滚边界，正式汇报整体按中文格式组织。`,
      "补齐后再由猫爪复核并提交 button-first Human Gate。"
    ].filter(Boolean).join("\n"),
    payload: {
      workflowId,
      meetingId,
      humanGateId: row.object_id,
      audit,
      source: "cat_claw.human_gate_policy_audit"
    }
  });
  return { eventId, dispatch };
}

async function safeMeetingDispatchWithRetry(rootDir, paths, dispatchInput = {}, context = {}) {
  try {
    return await meetingDispatch(rootDir, {
      ...dispatchInput,
      workflowRootDir: paths.root
    });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 2000);
    const safeMessage = redactSensitiveForPersistence(message);
    const createdAt = nowIso();
    const eventId = safeId("control");
    const stableDispatchKey = dispatchInput.idempotencyKey || dispatchInput.traceId || textHash(JSON.stringify(dispatchInput || {})).slice(0, 24);
    const dedupeKey = `meeting_dispatch_retry:${stableDispatchKey}`;
    const persistedDispatchInput = redactSensitiveForPersistence(dispatchInput);
    const persistedContext = redactSensitiveForPersistence(context);
    const retryJob = await enqueueControlLoopJob(paths, {
      jobType: "meeting_dispatch_retry",
      dedupeKey,
      priority: dispatchInput.priority || "steer",
      workflowId: dispatchInput.workflowId || dispatchInput.workflow_id || "",
      runtime: dispatchInput.runtime || "",
      maxAttempts: context.maxAttempts || context.max_attempts || dispatchInput.retryMaxAttempts || dispatchInput.retry_max_attempts || 5,
      payload: {
        dispatchInput: persistedDispatchInput,
        context: persistedContext,
        originalError: safeMessage,
        queuedAt: createdAt
      }
    });
    await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(dispatchInput.meetingId || dispatchInput.meeting_id || dispatchInput.workflowId || dispatchInput.workflow_id || "")}, 'meeting_dispatch_retry_enqueued', 'retry_scheduled', ${sqlValue(`Meeting dispatch retry scheduled: ${safeMessage}`)}, ${sqlValue(JSON.stringify({ dispatchInput: persistedDispatchInput, context: persistedContext, retryJob, error: safeMessage }))}, ${sqlValue(dispatchInput.createdBy || dispatchInput.created_by || "system")}, ${sqlValue(createdAt)});`);
    return {
      status: "retry_scheduled",
      dispatchId: "",
      retryJob,
      error: safeMessage,
      meetingId: dispatchInput.meetingId || dispatchInput.meeting_id || "",
      workflowId: dispatchInput.workflowId || dispatchInput.workflow_id || "",
      runtime: dispatchInput.runtime || "",
      agentId: dispatchInput.agentId || dispatchInput.agent_id || ""
    };
  }
}

async function ensurePendingHumanGateRequests(rootDir, paths, input = {}) {
  const limit = Math.max(1, Math.min(20, Number(input.humanGateRequestLimit || input.human_gate_request_limit || 5)));
  const targetRef = String(input.target || input.targetRef || input.target_ref || DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID).trim();
  const account = String(input.account || "cat_claw").trim();
  const resendSentAfterMs = Math.max(5 * 60_000, Math.min(24 * 3600_000, Number(input.humanGateResendAfterMs || input.human_gate_resend_after_ms || 30 * 60_000)));
  const resendCutoff = new Date(Date.now() - resendSentAfterMs).toISOString();
  const existingRows = await sqlite(paths.dbFile, `
SELECT outbox_id, status, payload_json, created_at, updated_at
FROM telegram_outbox
WHERE message_type='human_gate_request'
ORDER BY created_at DESC
LIMIT 500;`, { json: true });
  const outboxByGate = new Map();
  for (const row of existingRows) {
    const payload = parseJsonValue(row.payload_json, {});
    const humanGateId = String(payload.humanGateId || payload.human_gate_id || "").trim();
    if (humanGateId && !outboxByGate.has(humanGateId)) outboxByGate.set(humanGateId, row);
  }

  const rows = await sqlite(paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending'
ORDER BY created_at ASC
LIMIT ${limit};`, { json: true });
  const results = [];
  for (const row of rows) {
    const payload = parseJsonValue(row.payload_json, {});
    const body = humanGateBody(payload);
    const workflowId = humanGateWorkflowId(row, payload, body);
    const meetingId = String(body.meetingId || body.meeting_id || workflowId || row.object_id).trim();
    const gateType = String(body.gateType || body.gate_type || payload.gateType || payload.gate_type || "workflow_continuation").trim();
    const summary = String(body.summary || payload.summary || `Human Gate required: ${row.object_id}`).trim();
    const existing = outboxByGate.get(row.object_id);
    const existingPayload = parseJsonValue(existing?.payload_json, {});
    const textPolicyRefresh = Boolean(existing && existingPayload.textPolicyVersion !== HUMAN_GATE_TEXT_POLICY_VERSION);
    const buttonSet = await ensureHumanGateButtonSet(paths, row, payload, body, workflowId, meetingId);
    if (!buttonSet.audit?.ok) {
      let outboxToCancel = existing;
      if (!outboxToCancel) {
        const fallbackRows = await sqlite(paths.dbFile, `
SELECT outbox_id, status, payload_json
FROM telegram_outbox
WHERE outbox_id=${sqlValue(`hgate-${cleanFileSegment(row.object_id)}`)}
LIMIT 1;`, { json: true });
        outboxToCancel = fallbackRows[0] || null;
      }
      if (["queued", "delivering", "failed"].includes(String(outboxToCancel?.status || ""))) {
        await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='cancelled',
    payload_json=${sqlValue(JSON.stringify({ ...parseJsonValue(outboxToCancel.payload_json, {}), cancelledAt: nowIso(), cancelledReason: buttonSet.audit.reason }))},
    updated_at=${sqlValue(nowIso())}
WHERE outbox_id=${sqlValue(outboxToCancel.outbox_id)};`);
      }
      let revision = null;
      try {
        revision = await dispatchHumanGatePlanRevision(rootDir, paths, row, workflowId, meetingId, summary, buttonSet.audit);
      } catch (error) {
        revision = { status: "failed", error: String(error?.message || error).slice(0, 2000) };
      }
	      results.push({ humanGateId: row.object_id, workflowId, status: "blocked_human_gate_options_policy", audit: buttonSet.audit, revisionDispatch: revision.dispatch, outboxId: outboxToCancel?.outbox_id || existing?.outbox_id || "" });
      continue;
    }
    const { buttons } = buttonSet;
    if (buttonSet.reason === "human_gate_selected" || buttonSet.reason === "human_gate_feedback_pending") {
      results.push({
        humanGateId: row.object_id,
        workflowId,
        status: buttonSet.reason,
        outboxId: existing?.outbox_id || "",
        buttons: buttons.length
      });
      continue;
    }

    const presentationInput = { ...input, title: "Human Gate 确认", text: summary };
    const { webApp, presentation, telegramReplyMarkup, text } = await humanGateTelegramArtifacts(presentationInput, buttons);
    const outboxPayload = {
      humanGateId: row.object_id,
      gateType,
      workflowId,
      eventId: "",
      account,
      requester: "cat_claw",
      targetKind: targetRef.startsWith("-") ? "channel" : "private",
      targetRef,
      buttons,
      presentation,
      telegramReplyMarkup,
      webApp,
      textPolicyVersion: HUMAN_GATE_TEXT_POLICY_VERSION,
      ensuredBy: "workflow.control_loop.tick"
    };
    if (buttonSet.refreshed) outboxPayload.buttonPolicyRefresh = { reason: buttonSet.reason, refreshedAt: nowIso() };
    if (existing?.status === "queued") {
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET target_kind=${sqlValue(outboxPayload.targetKind)},
    target_ref=${sqlValue(targetRef)},
    text=${sqlValue(text)},
    payload_json=${sqlValue(JSON.stringify(outboxPayload))},
    updated_at=${sqlValue(nowIso())}
WHERE outbox_id=${sqlValue(existing.outbox_id)};`);
      results.push({ humanGateId: row.object_id, workflowId, status: buttonSet.refreshed ? "updated_queued_outbox_buttons" : `outbox_${existing.status}`, outboxId: existing.outbox_id, buttons: buttons.length });
      continue;
    }
    if (existing?.status === "sent" && String(existing.updated_at || existing.created_at || "") >= resendCutoff) {
      if (!buttonSet.refreshed && !textPolicyRefresh) {
        results.push({ humanGateId: row.object_id, workflowId, status: "outbox_sent", outboxId: existing.outbox_id, resendAfterMs: resendSentAfterMs });
        continue;
      }
    }
    if (existing?.status === "failed") {
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='queued',
    target_kind=${sqlValue(outboxPayload.targetKind)},
    target_ref=${sqlValue(targetRef)},
    text=${sqlValue(text)},
    payload_json=${sqlValue(JSON.stringify(outboxPayload))},
    updated_at=${sqlValue(nowIso())}
WHERE outbox_id=${sqlValue(existing.outbox_id)};`);
      results.push({ humanGateId: row.object_id, workflowId, status: "requeued_failed_outbox", outboxId: existing.outbox_id, buttons: buttons.length });
      continue;
    }
    if (existing?.status === "sent") {
      const previousPayload = parseJsonValue(existing.payload_json, {});
      const resendPayload = {
        ...outboxPayload,
        resend: {
          previousOutboxStatus: "sent",
          previousUpdatedAt: existing.updated_at || "",
          previousDelivery: previousPayload.delivery || null,
          previousTextPolicyVersion: previousPayload.textPolicyVersion || "",
          resendAfterMs: resendSentAfterMs,
          reason: buttonSet.refreshed ? "button_policy_refreshed" : textPolicyRefresh ? "message_text_policy_refreshed" : "sent_without_callback",
          requeuedAt: nowIso()
        }
      };
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='queued',
    target_kind=${sqlValue(outboxPayload.targetKind)},
    target_ref=${sqlValue(targetRef)},
    text=${sqlValue(text)},
    payload_json=${sqlValue(JSON.stringify(resendPayload))},
    updated_at=${sqlValue(nowIso())}
WHERE outbox_id=${sqlValue(existing.outbox_id)};`);
      results.push({ humanGateId: row.object_id, workflowId, status: buttonSet.refreshed ? "requeued_sent_outbox_buttons" : textPolicyRefresh ? "requeued_sent_outbox_text_policy" : "requeued_stale_sent_outbox", outboxId: existing.outbox_id, buttons: buttons.length, resendAfterMs: resendSentAfterMs });
      continue;
    }

    const outbox = await enqueueTelegramOutbox(paths, {
      outboxId: `hgate-${cleanFileSegment(row.object_id)}`,
      meetingId,
      targetKind: outboxPayload.targetKind,
      targetRef,
      messageType: "human_gate_request",
      text,
      payload: outboxPayload
    });
    results.push({ humanGateId: row.object_id, workflowId, status: outbox.status, outboxId: outbox.outboxId, buttons: buttons.length });
  }
  return { status: "ok", count: results.length, results };
}

function enqueueTelegramOutbox(...args) {
  return TELEGRAM_OUTBOX_ACTION_HANDLERS.enqueueTelegramOutbox(...args);
}

async function runLocalCodexDispatch(paths, row, input = {}) {
  const adapter = "local_codex_inbox";
  const startedAt = nowIso();
  const attempt = Number(row.attempt || 0) + 1;
  await updateDispatch(paths, row.dispatch_id, "sent", { adapter, startedAt, attempt });
  const runtimeRunId = await recordRuntimeRun(paths, row, {
    adapter,
    status: "started",
    startedAt,
    attempt,
    payload: { deliveryMode: "local_codex_inbox" }
  });
  await recordRuntimeBridgeSemanticEvent(paths, row, "dispatch_bound", {
    eventTime: startedAt,
    runtimeRunId,
    adapter,
    attempt,
    stage: "dispatch_bound",
    payload: { deliveryMode: "local_codex_inbox" }
  });
  const flow = await messageFlowForDispatch(paths, row);
  if (flow) {
    await updateMessageFlow(paths, flow.flow_id, messageFlowDispatchStartedStatus(row), {
      dispatchId: row.dispatch_id,
      runtimeRunId,
      payload: { dispatchId: row.dispatch_id, runtimeRunId, adapter }
    });
  }
  const completedAt = nowIso();
  const receiptText = [
    "LOCAL_CODEX_INBOX_RECEIVED",
    `timestamp: ${completedAt}`,
    `dispatch_id: ${row.dispatch_id}`,
    `flow_id: ${flow?.flow_id || ""}`
  ].join("\n");
  const outputHash = textHash(receiptText);
  await updateDispatch(paths, row.dispatch_id, "acked", { adapter, completedAt, attempt, messageId: "" });
  const ackRuntimeRunId = await completeRuntimeRun(paths, row, runtimeRunId, {
    adapter,
    status: "acked",
    startedAt,
    completedAt,
    attempt,
    outputHash,
    payload: {
      deliveryMode: "local_codex_inbox",
      localCodexReceivesVia: "workflow_message_flows"
    }
  });
  await recordRuntimeBridgeSemanticEvent(paths, row, "mechanical_ack", {
    eventTime: completedAt,
    runtimeRunId: ackRuntimeRunId,
    adapter,
    attempt,
    stage: "local_codex_inbox_received",
    messageFlowId: flow?.flow_id || "",
    payload: {
      deliveryMode: "local_codex_inbox",
      semanticReply: false
    }
  });
  let messageFlowDelivery = null;
  if (flow) {
    const updated = await updateMessageFlow(paths, flow.flow_id, "runtime_completed", {
      runtimeRunId: ackRuntimeRunId,
      finalOutputPresent: false,
      payload: {
        runtimeStatus: "local_codex_inbox_received",
        runtimeRunId: ackRuntimeRunId,
        outputHash,
        localCodexInboxReceipt: {
          receivedAt: completedAt,
          dispatchId: row.dispatch_id,
          flowId: flow.flow_id
        }
      }
    });
    await appendMessageFlowEvent(paths, flow.flow_id, "runtime_completed", "local_codex_inbox_received", {
      dispatchId: row.dispatch_id,
      runtimeRunId: ackRuntimeRunId,
      note: "local_codex inbox receipt is delivery evidence, not a semantic agent reply"
    });
    messageFlowDelivery = {
      status: "local_codex_inbox_received",
      flowId: flow.flow_id,
      finalOutputPresent: Boolean(Number(updated?.final_output_present || 0)),
      deliverySkipped: true,
      reason: "local_codex_inbox_receipt_not_semantic_reply"
    };
  }
  await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
    ts: completedAt,
    event: "runtime_dispatch_acked",
    dispatchId: row.dispatch_id,
    meetingId: row.meeting_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    adapter,
    completedAt,
    attempt,
    runtimeRunId: ackRuntimeRunId,
    messageFlowDelivery
  });
  return {
    dispatchId: row.dispatch_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    status: "acked",
    adapter,
    runtimeRunId: ackRuntimeRunId,
    messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
    messageFlowDelivery
  };
}

function renderIncidentMarkdown(record) {
  const affectedPlanes = record.affectedPlanes.length ? record.affectedPlanes.join(", ") : "unspecified";
  const timeline = record.timeline.length ? record.timeline.map((item) => `- ${item}`).join("\n") : "- none";
  return `# Cat-System Incident State

- incident_id: ${record.incidentId}
- status: ${record.status}
- mode: ${record.mode}
- declared_at: ${record.declaredAt}
- updated_at: ${record.updatedAt}
- next_update_at: ${record.nextUpdateAt || "unset"}
- commander: ${record.commander || "unset"}
- affected_planes: ${affectedPlanes}

## Summary

${record.summary || "No summary recorded."}

## Impact

${record.impact || "Not recorded."}

## Current Hypothesis

${record.currentHypothesis || "Not recorded."}

## Active Mitigation

${record.mitigation || "Not recorded."}

## Rollback Options

${record.rollbackOptions || "Not recorded."}

## Exit Criteria

${record.exitCriteria || "Not recorded."}

## Timeline

${timeline}
`;
}

async function telegramLinkFor(paths, meetingId) {
  const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_live_links WHERE meeting_id=${sqlValue(meetingId)} AND status='active' LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function findActiveRuntimeAgent(paths, runtime, agentId) {
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_agents
WHERE runtime=${sqlValue(normalizeRuntime(runtime))}
  AND agent_id=${sqlValue(normalizeAgentId(agentId))}
  AND status='active'
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function findActiveRegisteredAgentInstances(paths, agentId) {
  const normalizedAgentId = normalizeAgentId(agentId);
  if (normalizedAgentId === "cat_claw") {
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_agents
WHERE agent_id='cat_claw'
  AND runtime='openclaw'
  AND platform='openclaw'
  AND workflow_ingress_adapter='openclaw_native'
  AND status='active'
ORDER BY updated_at DESC;`, { json: true });
    return rows;
  }
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_agents
WHERE agent_id=${sqlValue(normalizedAgentId)}
  AND status='active'
ORDER BY updated_at DESC;`, { json: true });
  return rows;
}

function isRouteShellIngress(row) {
  const snap = registrySnapshot(row);
  return snap.imIngressOwner === "openclaw_gateway" && snap.imIngressAdapter === "openclaw_route_shell";
}

function isRouteShellOnlyRow(row) {
  const snap = registrySnapshot(row);
  return row.runtime === "openclaw_route_shell" || snap.executionAdapter === "route_shell" || snap.workflowIngressAdapter === "route_shell";
}

function canRouteToRegisteredInstance(row) {
  const snap = registrySnapshot(row);
  return snap.canReceiveDispatch && snap.workflowIngressAdapter && snap.workflowIngressAdapter !== "route_shell" && snap.workflowIngressAdapter !== "none";
}

function sortRegisteredTargets(left, right) {
  const policyFor = (row) => parseJsonValue(row.routing_policy_json, {});
  const rankFor = (row) => {
    const policy = policyFor(row);
    const primary = boolOption(policy.primary ?? row.primary, false) ? -1000 : 0;
    const rank = Number(policy.routingRank ?? policy.routing_rank ?? policy.dispatchPriority ?? policy.dispatch_priority ?? row.routing_rank ?? 100);
    return primary + (Number.isFinite(rank) ? rank : 100);
  };
  const rankDelta = rankFor(left) - rankFor(right);
  if (rankDelta !== 0) return rankDelta;
  return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
}

async function resolveRegisteredDispatchTarget(paths, input = {}) {
  const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || "main");
  const explicitPlatform = normalizeAgentPlatform(input.platform || input.runtime || "");
  const explicitAdapter = normalizeWorkflowIngressAdapter(input.workflowIngressAdapter || input.workflow_ingress_adapter || input.targetAdapter || input.target_adapter || "");
  const instances = await findActiveRegisteredAgentInstances(paths, agentId);
  const candidates = instances
    .filter(canRouteToRegisteredInstance)
    .filter((row) => !explicitPlatform || registrySnapshot(row).platform === explicitPlatform || normalizeRuntime(row.runtime) === explicitPlatform)
    .filter((row) => !explicitAdapter || registrySnapshot(row).workflowIngressAdapter === explicitAdapter)
    .sort(sortRegisteredTargets);
  const target = candidates[0];
  if (!target) {
    const filterText = explicitPlatform || explicitAdapter
      ? `; requested platform=${explicitPlatform || "*"} adapter=${explicitAdapter || "*"}`
      : "";
    throw new Error(`active dispatch-capable registry row not found for ${agentId}${filterText}`);
  }
  return { agentId, target, registry: registrySnapshot(target) };
}

function dispatchSourceMessageId(input = {}, fallback = "") {
  return firstText(
    input.sourceMessageId,
    input.source_message_id,
    input.providerMessageId,
    input.provider_message_id,
    input.messageId,
    input.message_id,
    input.cronRunId,
    input.cron_run_id,
    fallback
  );
}

function dispatchReturnPolicyInput(input = {}, originalPayload = {}, targetRegistry = {}) {
  const delivery = objectValue(input.delivery || input.delivery_config || originalPayload.delivery || originalPayload.deliveryConfig || originalPayload.delivery_config);
  const explicit = firstText(
    input.returnPolicy,
    input.return_policy,
    input.deliveryPolicy,
    input.delivery_policy,
    delivery.returnPolicy,
    delivery.return_policy,
    delivery.deliveryPolicy,
    delivery.delivery_policy
  );
  if (explicit) return explicit;
  const deliveryMode = String(delivery.mode || "").trim().toLowerCase();
  const deliveryChannel = String(delivery.channel || "").trim().toLowerCase();
  if (deliveryMode === "announce" && (deliveryChannel === "telegram" || delivery.to || delivery.chatId || delivery.chat_id)) return "reply_to_source_chat";
  return "";
}

async function createDispatchMessageFlow(paths, input = {}, context = {}) {
  const targetRegistry = context.targetRegistry || {};
  if (targetRegistry.platform === "openclaw") return null;
  const originalPayload = parseJsonValue(input.payload, input.payload || {});
  const beforeDispatch = objectValue(originalPayload.beforeDispatch || originalPayload.before_dispatch);
  const delivery = objectValue(input.delivery || input.delivery_config || originalPayload.delivery || originalPayload.deliveryConfig || originalPayload.delivery_config);
  const sourceChannel = messageFlowSourceChannel(input, originalPayload);
  const sourceChatId = String(firstText(input.sourceChatId, input.source_chat_id, input.chatId, input.chat_id, input.conversationId, input.conversation_id, delivery.to, delivery.chatId, delivery.chat_id, beforeDispatch.conversationId, beforeDispatch.conversation_id)).trim();
  const sourceAccountId = firstText(input.sourceAccountId, input.source_account_id, input.accountId, input.account_id, input.account, delivery.accountId, delivery.account_id, delivery.account, beforeDispatch.accountId, beforeDispatch.account_id);
  const senderId = firstText(input.senderId, input.sender_id, input.from, delivery.senderId, delivery.sender_id, beforeDispatch.senderId, beforeDispatch.sender_id, "openclaw_cron");
  const sourceMessageId = dispatchSourceMessageId(input, context.dispatchId);
  const returnPolicy = normalizeReturnPolicy(dispatchReturnPolicyInput(input, originalPayload, targetRegistry), "silent");
  if (returnPolicy === "silent") return null;
  if (returnPolicy === "reply_to_source_chat" && (!sourceChannel || !sourceAccountId || !sourceChatId || !senderId || !sourceMessageId)) {
    throw new Error("non-openclaw meeting.dispatch with return_policy=reply_to_source_chat requires source_channel, account_id, chat_id, sender_id, source_message_id");
  }
  const flowId = String(input.messageFlowId || input.message_flow_id || originalPayload.messageFlowId || originalPayload.message_flow_id || messageFlowIdFromParts(context.idempotencyKey, context.traceId, context.meetingId, sourceMessageId, context.dispatchId)).trim();
  const result = { flowId, returnPolicy };
  if (context.validateOnly) return result;
  await createMessageFlow(paths, {
    flowId,
    traceId: context.traceId,
    idempotencyKey: context.idempotencyKey,
    meetingId: context.meetingId,
    workflowId: context.workflowId,
    dispatchId: context.dispatchId,
    sourceChannel,
    sourceSystem: firstText(input.sourceSystem, input.source_system, delivery.sourceSystem, delivery.source_system, "workflow_dispatch"),
    sourceRuntime: normalizeRuntime(input.sourceRuntime || input.source_runtime || "workflow_dispatch"),
    sourceAccountId,
    sourceChatId,
    senderId,
    sourceMessageId,
    routeAgentId: firstText(input.routeAgentId, input.route_agent_id, context.createdBy),
    routeRuntime: normalizeRuntime(input.routeRuntime || input.route_runtime || "openclaw_route_shell"),
    targetRuntime: targetRegistry.platform || context.dispatchRuntime,
    targetAgentId: context.agentId,
    targetPlatform: targetRegistry.platform || context.dispatchRuntime,
    workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
    imIdentity: targetRegistry.imIdentity,
    executionIdentity: targetRegistry.executionIdentity,
    returnPolicy,
    status: "route_registered",
    createdAt: context.createdAt,
    payload: {
      dispatchId: context.dispatchId,
      dispatchType: context.dispatchType,
      createdBy: context.createdBy,
      directDispatch: true,
      delivery
    }
  });
  return result;
}

function hermesProfileFromEndpoint(endpointRef, agentId) {
  const endpoint = String(endpointRef || "").trim();
  if (endpoint.startsWith("hermers-profile:")) return endpoint.slice("hermers-profile:".length).trim();
  if (endpoint.startsWith("hermes-profile:")) return endpoint.slice("hermes-profile:".length).trim();
  if (endpoint.startsWith("profile:")) return endpoint.slice("profile:".length).trim();
  return "";
}

function hermersProfileModesPath(input = {}) {
  const value = firstText(
    input.hermersProfileModesPath,
    input.hermers_profile_modes_path,
    input.stabilityProfileModesPath,
    input.stability_profile_modes_path,
    process.env.TRADING_AGENTS_WORKFLOW_PROFILE_MODES_PATH,
    process.env.CAT_AGENTS_STABILITY_PROFILE_MODES_PATH,
    process.env.OPENCLAW_STABILITY_PROFILE_MODES_PATH,
    DEFAULT_HERMERS_PROFILE_MODES_PATH
  );
  return resolveHome(value);
}

async function loadHermersProfileModes(input = {}) {
  const filePath = hermersProfileModesPath(input);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("profile modes payload must be a JSON object");
    if (parsed.profiles !== undefined && (!parsed.profiles || typeof parsed.profiles !== "object" || Array.isArray(parsed.profiles))) {
      throw new Error("profile modes payload profiles must be an object");
    }
    const profiles = parsed.profiles || {};
    return {
      ok: true,
      path: filePath,
      updatedAt: parsed.updatedAt || parsed.updated_at || parsed.generatedAt || parsed.generated_at || "",
      profiles,
      raw: parsed
    };
  } catch (error) {
    const code = error && typeof error === "object" ? error.code : "";
    return {
      ok: false,
      unavailable: code === "ENOENT",
      path: filePath,
      profiles: {},
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function hermersProfileModeForRow(row, modes = {}) {
  const profile = hermesProfileFromEndpoint(row.endpoint_ref, row.agent_id);
  const profiles = modes?.profiles || {};
  const entry = profile ? (profiles[profile] || profiles[profile.replace(/_/g, "")] || null) : null;
  const observedMode = String(entry?.observedMode || entry?.observed_mode || entry?.readinessObservation || entry?.readiness_observation || entry?.targetMode || entry?.target_mode || entry?.mode || "").trim().toLowerCase();
  return {
    profile,
    entry,
    observedMode,
    managed: entry?.managed ?? null,
    protected: entry?.protected ?? null,
    activeWork: entry?.activeWork ?? entry?.active_work ?? null,
    reason: entry?.reason || entry?.lastReason || entry?.last_reason || ""
  };
}

function profileModeEvidenceForRow(row, modes = {}) {
  const data = hermersProfileModeForRow(row, modes);
  if (!data.profile && !data.entry && !data.observedMode) return {};
  return {
    profile: data.profile,
    profileMode: data.observedMode || "",
    profileManaged: data.managed,
    profileProtected: data.protected,
    profileActiveWork: data.activeWork,
    profileAdmissionReason: data.reason
  };
}

function profileModesReadinessPayload(modes = {}) {
  const profiles = Object.fromEntries(Object.entries(modes.profiles || {}).map(([profile, entry]) => [profile, {
    observedMode: entry?.observedMode || entry?.observed_mode || entry?.readinessObservation || entry?.readiness_observation || entry?.targetMode || entry?.target_mode || entry?.mode || "",
    managed: entry?.managed ?? null,
    protected: entry?.protected ?? null,
    activeWork: entry?.activeWork ?? entry?.active_work ?? null,
    reason: entry?.reason || entry?.lastReason || entry?.last_reason || ""
  }]));
  return {
    ok: Boolean(modes.ok),
    unavailable: Boolean(modes.unavailable),
    path: modes.path || "",
    updatedAt: modes.updatedAt || "",
    profileCount: Object.keys(profiles).length,
    profiles,
    error: modes.ok ? "" : (modes.error || "")
  };
}

function classifyHermersProfileAdmission(row, modes = {}, input = {}) {
  const mode = hermersProfileModeForRow(row, modes);
  const payload = parseJsonValue(row.payload_json, {});
  const dispatchType = row.dispatch_type || payload.dispatchType || payload.dispatch_type || "";
  const priority = String(row.priority || payload.priority || "normal").trim().toLowerCase();
  const humanGateContext = isHumanGateDispatchContext(row, payload, dispatchType);
  return { allowed: true, action: "observe", ...mode, priority, dispatchType, humanGateContext };
}

function validateRuntimeBridgeRegistryRow(row, runtime) {
  if (!row.agent_key || !row.registry_agent_key) {
    return { ok: false, failureType: "runtime_registry_missing", error: "queued dispatch has no matching runtime_agents row" };
  }
  if (row.registry_status !== "active") {
    return { ok: false, failureType: "runtime_registry_inactive", error: `runtime_agents row is not active: ${row.registry_status || "unknown"}` };
  }
  if (Number(row.can_receive_dispatch ?? 0) === 0) {
    return { ok: false, failureType: "runtime_registry_dispatch_disabled", error: "runtime_agents row has can_receive_dispatch=0" };
  }
  const snap = registrySnapshot({
    runtime: row.registry_runtime || row.runtime,
    platform: row.platform,
    execution_adapter: row.execution_adapter,
    workflow_ingress_adapter: row.workflow_ingress_adapter,
    im_ingress_owner: row.im_ingress_owner,
    im_ingress_adapter: row.im_ingress_adapter,
    can_receive_dispatch: row.can_receive_dispatch,
    endpoint_ref: row.endpoint_ref
  });
  if (!snap.workflowIngressAdapter || snap.workflowIngressAdapter === "none" || snap.workflowIngressAdapter === "route_shell") {
    return { ok: false, failureType: "runtime_registry_adapter_unavailable", error: `workflow ingress adapter is not dispatch-capable: ${snap.workflowIngressAdapter || "missing"}` };
  }
  if (runtime === "hermers") {
    if (snap.platform !== "hermers") {
      return { ok: false, failureType: "runtime_registry_platform_mismatch", error: `expected Hermers platform, got ${snap.platform || "missing"}` };
    }
    if (!snap.endpointRef || !hermesProfileFromEndpoint(snap.endpointRef, row.agent_id)) {
      return { ok: false, failureType: "runtime_registry_endpoint_missing", error: "Hermers dispatch requires a runtime_agents endpoint_ref profile" };
    }
  }
  return { ok: true, adapter: snap.workflowIngressAdapter, platform: snap.platform, endpointRef: snap.endpointRef };
}

function validateRuntimeBridgeTaskPayload(row) {
  const taskText = runtimeBridgeTaskText(row);
  if (!taskText) {
    return { ok: false, failureType: "invalid_dispatch_prompt", error: "queued dispatch has no task prompt for runtime bridge" };
  }
  return { ok: true };
}

function runtimeBridgeTaskText(row) {
  const payload = parseJsonValue(row.payload_json, {});
  const nestedPayload = objectValue(payload.payload);
  return firstText(row.prompt, payload.prompt, nestedPayload.prompt, nestedPayload.message, nestedPayload.body);
}

async function failRuntimeBridgeRegistryDispatch(paths, row, validation, input = {}) {
  const failedAt = nowIso();
  await updateDispatch(paths, row.dispatch_id, "failed", {
    adapter: "runtime_registry",
    failedAt,
    failureType: validation.failureType,
    error: validation.error
  });
  const runtimeRunId = await recordRuntimeRun(paths, row, {
    adapter: "runtime_registry",
    status: "failed",
    failureType: validation.failureType,
    startedAt: failedAt,
    completedAt: failedAt,
    error: validation.error,
    payload: { registryValidation: validation, owner: firstText(input.owner, input.from, "workflow") }
  });
  await finishMessageFlowRuntime(paths, row, {
    runtimeRunId,
    finalOutputPresent: false,
    failureType: validation.failureType,
    lastError: validation.error
  }, input);
  await recordRuntimeBridgeFailureState(paths, row, {
    eventTime: failedAt,
    runtimeRunId,
    adapter: "runtime_registry",
    failureType: validation.failureType,
    error: validation.error,
    stage: "registry_validation_failed",
    payload: { registryValidation: validation }
  });
  return {
    dispatchId: row.dispatch_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    status: "failed",
    failureType: validation.failureType,
    error: validation.error
  };
}

async function failRuntimeBridgeInvalidDispatch(paths, row, validation, input = {}) {
  const failedAt = nowIso();
  await updateDispatch(paths, row.dispatch_id, "failed", {
    adapter: "runtime_bridge_validation",
    failedAt,
    failureType: validation.failureType,
    error: validation.error
  });
  const runtimeRunId = await recordRuntimeRun(paths, row, {
    adapter: "runtime_bridge_validation",
    status: "failed",
    failureType: validation.failureType,
    startedAt: failedAt,
    completedAt: failedAt,
    error: validation.error,
    payload: { validation, owner: firstText(input.owner, input.from, "workflow") }
  });
  await finishMessageFlowRuntime(paths, row, {
    runtimeRunId,
    finalOutputPresent: false,
    failureType: validation.failureType,
    lastError: validation.error
  }, input);
  await recordRuntimeBridgeFailureState(paths, row, {
    eventTime: failedAt,
    runtimeRunId,
    adapter: "runtime_bridge_validation",
    failureType: validation.failureType,
    error: validation.error,
    stage: "dispatch_validation_failed",
    payload: { validation }
  });
  return {
    dispatchId: row.dispatch_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    status: "failed",
    failureType: validation.failureType,
    error: validation.error
  };
}

function isHumanGateDispatchContext(row, payload, dispatchType) {
  const flagCandidates = [
    row.human_gate_required,
    payload.humanGateRequired,
    payload.human_gate_required,
    payload.requiresHumanGate,
    payload.requires_human_gate,
    payload.humanGate?.required,
    payload.human_gate?.required,
    payload.payload?.humanGateRequired,
    payload.payload?.human_gate_required
  ];
  if (flagCandidates.some((value) => boolOption(value, false))) return true;
  return String(dispatchType || "").toLowerCase().startsWith("human_gate");
}

function runtimeAckContract(row = {}, input = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  const nestedPayload = objectValue(payload.payload);
  const rawContract = objectValue(
    input.ackContract ||
    input.ack_contract ||
    payload.ackContract ||
    payload.ack_contract ||
    nestedPayload.ackContract ||
    nestedPayload.ack_contract
  );
  const required = boolOption(
    rawContract.required ??
    rawContract.requiresAck ??
    rawContract.requires_ack ??
    input.requiresAck ??
    input.requires_ack ??
    payload.requiresAck ??
    payload.requires_ack ??
    nestedPayload.requiresAck ??
    nestedPayload.requires_ack,
    false
  );
  const timeoutSeconds = Math.max(5, Math.min(300, Number(
    rawContract.timeoutSeconds ??
    rawContract.timeout_seconds ??
    input.ackTimeoutSeconds ??
    input.ack_timeout_seconds ??
    DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS
  ) || DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS));
  const retryDelaySeconds = Math.max(5, Math.min(900, Number(
    rawContract.retryDelaySeconds ??
    rawContract.retry_delay_seconds ??
    input.ackRetrySeconds ??
    input.ack_retry_seconds ??
    DEFAULT_RUNTIME_ACK_RETRY_SECONDS
  ) || DEFAULT_RUNTIME_ACK_RETRY_SECONDS));
  const maxAttempts = Math.max(1, Math.min(10, Number(
    rawContract.maxAttempts ??
    rawContract.max_attempts ??
    DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS
  ) || DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS));
  const semanticContinuation = boolOption(
    rawContract.semanticContinuation ??
    rawContract.semantic_continuation,
    true
  );
  return {
    required,
    firstTurnOnly: boolOption(rawContract.firstTurnOnly ?? rawContract.first_turn_only, true),
    timeoutSeconds,
    retryDelaySeconds,
    maxAttempts,
    semanticContinuation,
    expectedPrefix: String(rawContract.expectedPrefix || rawContract.expected_prefix || "ACK_RECEIVED").trim() || "ACK_RECEIVED"
  };
}

function runtimeDispatchTimeoutSeconds(row, input = {}, fallbackSeconds = 300, maxSeconds = 1800) {
  const payload = dispatchPayloadObject(row);
  if (isSemanticContinuationDispatch(row)) {
    return semanticContinuationTimeoutSeconds(payload, input, undefined, maxSeconds);
  }
  const ack = runtimeAckContract(row, input);
  if (ack.required) return Math.max(5, Math.min(maxSeconds, ack.timeoutSeconds));
  return Math.max(30, Math.min(maxSeconds, Number(input.timeoutSeconds || input.timeout_seconds || fallbackSeconds)));
}

function validateRuntimeAckOutput(text = "", ack = {}) {
  if (!ack.required) return true;
  const trimmed = String(text || "").trim();
  const firstLine = trimmed.split(/\r?\n/, 1)[0] || "";
  const expectedPrefix = String(ack.expectedPrefix || "ACK_RECEIVED").trim() || "ACK_RECEIVED";
  if (firstLine === expectedPrefix || firstLine.startsWith(`${expectedPrefix} `) || firstLine.startsWith(`${expectedPrefix}:`)) return true;
  throw new Error(`ACK contract violation: expected first line to start with ${expectedPrefix}`);
}

function runtimeFailureShouldRetry(failureType, ack = {}) {
  if (AUTO_RETRY_FAILURE_TYPES.has(failureType)) return true;
  return Boolean(ack.required && failureType === "empty_output");
}

function buildRuntimeBridgePrompt(row) {
  const payload = parseJsonValue(row.payload_json, {});
  const ack = runtimeAckContract(row);
  const role = row.role ? `Runtime role: ${row.role}` : "";
  const createdBy = row.created_by || payload.chair || "main";
  const invocationTs = nowIso();
  const dispatchType = row.dispatch_type || payload.dispatchType || "discussion_turn";
  const messageFlowId = messageFlowIdFromDispatchPayload(row);
  const humanGateContext = isHumanGateDispatchContext(row, payload, dispatchType);
  const humanGateRequirement = humanGateContext
    ? "- This dispatch explicitly involves Human Gate. Preserve button-first confirmation boundaries and do not bypass Flashcat confirmation."
    : "- This dispatch is not a Human Gate request. Do not create, imply, or route through Human Gate unless humanGateRequired=true or a human_gate dispatch type is explicitly present.";
  const heartbeatBudget = dispatchType === "cron_heartbeat"
    ? [
        "",
        "Cron heartbeat runtime budget:",
        "- This heartbeat is a lightweight liveness/readiness check, not a heavy report.",
        "- Finish within the workflow runtime budget; prefer a timely bounded reply over exhaustive diagnostics.",
        "- Use at most 4 quick tool calls. Do not run broad scans, long scripts, package installs, or slow network probes.",
        "- If a check is slow, blocked, or inconclusive, skip it and report skipped_due_to_budget with the evidence you already have.",
        "- Start the final answer with HEARTBEAT_OK when basic liveness is confirmed, or HEARTBEAT_DEGRADED when a real issue is found."
      ]
    : [];
  return [
    "You are being invoked by trading-agents-workflow through the OpenClaw gateway control plane.",
    "Treat this as one assigned collaboration turn in a mixed-runtime trading_agents workflow.",
    "OpenClaw Gateway is the information/workflow hub; trading-agents-workflow is the trading workflow scheduler; Hermers is the agent platform; ACP is the Hermers workflow ingress adapter.",
    "",
    `Invocation timestamp: ${invocationTs}`,
    `Meeting ID: ${row.meeting_id}`,
    `Dispatch ID: ${row.dispatch_id}`,
    messageFlowId ? `Message Flow ID: ${messageFlowId}` : "",
    `Assigned agent: ${row.runtime}:${row.agent_id}`,
    `Created by: ${createdBy}`,
    role,
    `Dispatch type: ${dispatchType}`,
    ...heartbeatBudget,
    "",
    "Task:",
    runtimeBridgeTaskText(row),
    "",
    ...(ack.required
      ? [
          "First-turn ACK contract:",
          `- Return ${ack.expectedPrefix} as the first line within ${ack.timeoutSeconds}s of receiving this complete dispatch.`,
          "- This turn is only a receipt/integrity confirmation, not the semantic task result.",
          messageFlowId
            ? `- Include: ISO timestamp, Dispatch ID ${row.dispatch_id}, Message Flow ID ${messageFlowId}, received scope, and any obvious truncation/integrity issue.`
            : `- Include: ISO timestamp, Dispatch ID ${row.dispatch_id}, received scope, and any obvious truncation/integrity issue.`,
          `- If no ACK is returned, workflow will retry through the ${ack.retryDelaySeconds}s governed retry loop.`
        ]
      : []),
    ...(ack.required ? [""] : []),
    "Output requirements:",
    ack.required ? "- Return the ACK only for this first runtime turn." : "- Return the final answer only.",
    "- Include an ISO timestamp in the answer.",
    "- State evidence, assumptions, uncertainty, and next workflow action clearly.",
    humanGateRequirement,
    "- For normal message-flow replies, the next workflow action must describe the actual reply/report path, not an invented approval gate.",
    "- ACP runs non-interactively. Do not request interactive permissions; use only already-authorized capabilities, or return a bounded failure/degraded result with the missing permission or adapter named.",
    "- Do not execute live trades or create executable trade intents.",
    "- If a structured workflow object is needed, name the intended object type such as research_signal, evidence_pack, research_memo, trade_proposal, risk_decision, or artifact."
  ].filter(Boolean).join("\n");
}

async function updateDispatch(paths, dispatchId, status, patch = {}) {
  const rows = await sqlite(paths.dbFile, `SELECT payload_json FROM mixed_meeting_dispatches WHERE dispatch_id=${sqlValue(dispatchId)} LIMIT 1;`, { json: true });
  const currentPayload = parseJsonValue(rows[0]?.payload_json, {});
  const payload = { ...currentPayload, bridge: { ...(currentPayload.bridge || {}), ...patch, updatedAt: nowIso() } };
  const assignments = [
    `status=${sqlValue(status)}`,
    `payload_json=${sqlValue(JSON.stringify(payload))}`,
    `updated_at=${sqlValue(nowIso())}`
  ];
  if (patch.startedAt || patch.sentAt) assignments.push(`sent_at=${sqlValue(patch.startedAt || patch.sentAt)}`);
  if (patch.completedAt || patch.ackedAt) assignments.push(`acked_at=${sqlValue(patch.completedAt || patch.ackedAt)}`, `completed_at=${sqlValue(patch.completedAt || patch.ackedAt)}`);
  if (patch.failedAt) assignments.push(`completed_at=${sqlValue(patch.failedAt)}`);
  if (patch.failureType) assignments.push(`failure_type=${sqlValue(patch.failureType)}`);
  if (patch.error) assignments.push(`last_error=${sqlValue(String(patch.error).slice(0, 2000))}`);
  if (patch.nextRetryAt) assignments.push(`next_retry_at=${sqlValue(patch.nextRetryAt)}`);
  if (patch.attempt !== undefined) assignments.push(`attempt=${sqlValue(Number(patch.attempt) || 0)}`);
  if (status === "queued") assignments.push("sent_at=NULL", "acked_at=NULL", "completed_at=NULL");
  if (status === "sent") assignments.push("acked_at=NULL", "completed_at=NULL", "failure_type=NULL", "last_error=NULL", "next_retry_at=NULL");
  if (status === "acked") assignments.push("failure_type=NULL", "last_error=NULL", "next_retry_at=NULL");
  if (["failed", "cancelled"].includes(status) && !patch.nextRetryAt) assignments.push("next_retry_at=NULL");
  await sqlite(paths.dbFile, `
UPDATE mixed_meeting_dispatches
SET ${assignments.join(", ")}
WHERE dispatch_id=${sqlValue(dispatchId)};`);
}

async function claimQueuedDispatch(paths, row, input = {}) {
  if (String(row.status || "") !== "queued") return { claimed: false, row, reason: `status_${row.status || "unknown"}` };
  const claimedAt = nowIso();
  const attempt = Number(row.attempt || 0) || 0;
  const currentPayload = parseJsonValue(row.payload_json, {});
  const claim = {
    claimId: safeId("dispatch_claim"),
    claimedAt,
    owner: firstText(input.owner, input.from, "workflow"),
    runtime: row.runtime || "",
    attempt
  };
  const payload = { ...currentPayload, bridge: { ...(currentPayload.bridge || {}), claim, claimedAt, updatedAt: claimedAt } };
  const changed = await sqlite(paths.dbFile, `
UPDATE mixed_meeting_dispatches
SET status='sent',
    sent_at=${sqlValue(claimedAt)},
    acked_at=NULL,
    completed_at=NULL,
    failure_type=NULL,
    last_error=NULL,
    next_retry_at=NULL,
    payload_json=${sqlValue(JSON.stringify(payload))},
    updated_at=${sqlValue(claimedAt)}
WHERE dispatch_id=${sqlValue(row.dispatch_id)}
  AND status='queued'
  AND attempt=${sqlValue(attempt)};
SELECT changes() AS changed;`, { json: true });
  if (Number(changed?.[0]?.changed || 0) !== 1) {
    const rows = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE dispatch_id=${sqlValue(row.dispatch_id)} LIMIT 1;`, { json: true });
    return { claimed: false, row: rows[0] || row, reason: "not_claimed" };
  }
  return {
    claimed: true,
    row: {
      ...row,
      status: "sent",
      sent_at: claimedAt,
      acked_at: null,
      completed_at: null,
      failure_type: null,
      last_error: null,
      next_retry_at: null,
      payload_json: JSON.stringify(payload),
      updated_at: claimedAt
    },
    claim
  };
}

function classifyRuntimeError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();
  if (error?.killed || error?.signal || error?.code === "ETIMEDOUT") return "runtime_timeout";
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out")) return "runtime_timeout";
  if (lower.includes("permission prompt unavailable") || lower.includes("permission") && lower.includes("non-interactive")) return "permission_unavailable";
  if (lower.includes("ack contract violation")) return "ack_contract_violation";
  if (lower.includes("operation interrupted") && (lower.includes("waiting for model response") || lower.includes("cancelled"))) return "runtime_timeout";
  if (lower.includes("acp runtime backend") || lower.includes("acp") && lower.includes("unavailable")) return "acp_unavailable";
  if (lower.includes("oauth") || lower.includes("auth")) return "auth_unavailable";
  if (lower.includes("empty output")) return "empty_output";
  if (lower.includes("incomplete output") || lower.includes("operation interrupted")) return "incomplete_output";
  if (lower.includes("schema") || lower.includes("validation")) return "schema_validation";
  if (lower.includes("guardrail")) return "guardrail_block";
  if (lower.includes("stale")) return "stale_input";
  return "transient_runtime";
}

function nextRetryAt(attempt, retryDelaySeconds = 0) {
  const fixedDelay = Number(retryDelaySeconds || 0);
  if (Number.isFinite(fixedDelay) && fixedDelay > 0) {
    return new Date(Date.now() + Math.max(5, Math.min(900, fixedDelay)) * 1000).toISOString();
  }
  const base = Math.min(900, 30 * Math.max(1, 2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.min(30, base));
  return new Date(Date.now() + (base + jitter) * 1000).toISOString();
}

async function recordRuntimeRun(paths, row, data) {
  const startedAt = data.startedAt || nowIso();
  const completedAt = data.completedAt || data.failedAt || null;
  const latencyMs = completedAt ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()) : null;
  const runtimeRunId = data.runtimeRunId || safeId("runtime_run");
  const payload = parseJsonValue(row.payload_json, {});
  await sqlite(paths.dbFile, `
INSERT INTO runtime_runs(runtime_run_id, dispatch_id, meeting_id, workflow_id, trace_id, runtime, agent_id, adapter, backend, acp_agent, session_key, status, failure_type, attempt, started_at, completed_at, latency_ms, message_id, input_hash, output_hash, error, payload_json)
VALUES (${sqlValue(runtimeRunId)}, ${sqlValue(row.dispatch_id)}, ${sqlValue(row.meeting_id)}, ${sqlValue(row.workflow_id || payload.workflowId || "")}, ${sqlValue(row.trace_id || payload.traceId || "")}, ${sqlValue(row.runtime)}, ${sqlValue(row.agent_id)}, ${sqlValue(data.adapter || "")}, ${sqlValue(data.backend || "")}, ${sqlValue(data.acpAgent || "")}, ${sqlValue(data.sessionKey || "")}, ${sqlValue(data.status || "started")}, ${sqlValue(data.failureType || "")}, ${sqlValue(Number(data.attempt ?? row.attempt ?? 0) || 0)}, ${sqlValue(startedAt)}, ${sqlValue(completedAt)}, ${sqlValue(latencyMs)}, ${sqlValue(data.messageId || "")}, ${sqlValue(data.inputHash || textHash(row.prompt || payload.prompt || ""))}, ${sqlValue(data.outputHash || "")}, ${sqlValue(data.error ? String(data.error).slice(0, 2000) : "")}, ${sqlValue(JSON.stringify(data.payload || {}))});`);
  const workflowId = row.workflow_id || payload.workflowId || "";
  const taskId = payload.taskId || payload.task_id || payload.payload?.taskId || payload.payload?.task_id || "";
  const phaseInfo = await workflowTaskPhaseInfo(paths, workflowId, taskId, payload.phase || "");
  await upsertWorkflowAgentRun(paths, {
    agentRunId: `runtime.${runtimeRunId}`,
    workflowId,
    phaseId: phaseInfo.phaseId,
    phaseKey: phaseInfo.phaseKey,
    taskId,
    dispatchId: row.dispatch_id,
    runtimeRunId,
    runtime: row.runtime,
    agentId: row.agent_id,
    status: data.status || "started",
    attempt: Number(data.attempt ?? row.attempt ?? 0) || 0,
    inputHash: data.inputHash || textHash(row.prompt || payload.prompt || ""),
    outputHash: data.outputHash || "",
    receiptRef: data.messageId || "",
    error: data.error || "",
    payload: { source: "runtime_runs", adapter: data.adapter || "", backend: data.backend || "", failureType: data.failureType || "" },
    startedAt,
    completedAt,
    createdAt: startedAt,
    updatedAt: completedAt || startedAt
  });
  return runtimeRunId;
}

async function completeRuntimeRun(paths, row, runtimeRunId, data) {
  const startedAt = data.startedAt || nowIso();
  const completedAt = data.completedAt || data.failedAt || nowIso();
  const latencyMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
  const payload = parseJsonValue(row.payload_json, {});
  await sqlite(paths.dbFile, `
UPDATE runtime_runs
SET status=${sqlValue(data.status || "acked")},
    failure_type=${sqlValue(data.failureType || "")},
    backend=COALESCE(NULLIF(${sqlValue(data.backend || "")}, ''), backend),
    acp_agent=COALESCE(NULLIF(${sqlValue(data.acpAgent || "")}, ''), acp_agent),
    session_key=COALESCE(NULLIF(${sqlValue(data.sessionKey || "")}, ''), session_key),
    completed_at=${sqlValue(completedAt)},
    latency_ms=${sqlValue(latencyMs)},
    message_id=${sqlValue(data.messageId || "")},
    output_hash=${sqlValue(data.outputHash || "")},
    error=${sqlValue(data.error ? String(data.error).slice(0, 2000) : "")},
    payload_json=${sqlValue(JSON.stringify(data.payload || {}))}
WHERE runtime_run_id=${sqlValue(runtimeRunId)};`);
  const workflowId = row.workflow_id || payload.workflowId || "";
  const taskId = payload.taskId || payload.task_id || payload.payload?.taskId || payload.payload?.task_id || "";
  const phaseInfo = await workflowTaskPhaseInfo(paths, workflowId, taskId, payload.phase || "");
  await upsertWorkflowAgentRun(paths, {
    agentRunId: `runtime.${runtimeRunId}`,
    workflowId,
    phaseId: phaseInfo.phaseId,
    phaseKey: phaseInfo.phaseKey,
    taskId,
    dispatchId: row.dispatch_id,
    runtimeRunId,
    runtime: row.runtime,
    agentId: row.agent_id,
    status: data.status || "acked",
    attempt: Number(data.attempt ?? row.attempt ?? 0) || 0,
    inputHash: data.inputHash || textHash(row.prompt || payload.prompt || ""),
    outputHash: data.outputHash || "",
    receiptRef: data.messageId || "",
    error: data.error || "",
    payload: { source: "runtime_runs", adapter: data.adapter || "", backend: data.backend || "", failureType: data.failureType || "" },
    startedAt,
    completedAt,
    createdAt: startedAt,
    updatedAt: completedAt
  });
  return runtimeRunId;
}

function runtimeBridgeEventWorkflowId(row = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  return String(row.workflow_id || payload.workflowId || payload.workflow_id || "").trim();
}

function runtimeBridgeEventTaskId(row = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  return String(payload.taskId || payload.task_id || payload.payload?.taskId || payload.payload?.task_id || "").trim();
}

async function recordRuntimeBridgeSemanticEvent(paths, row, eventType, data = {}) {
  if (!row?.runtime || !row?.agent_id || !eventType) return null;
  const payload = parseJsonValue(row.payload_json, {});
  const eventTime = data.eventTime || data.event_time || nowIso();
  const runtimeRunId = String(data.runtimeRunId || data.runtime_run_id || "").trim();
  const adapter = String(data.adapter || "").trim();
  const idempotencyParts = [
    "runtime-bridge",
    row.dispatch_id || "",
    runtimeRunId || `attempt-${data.attempt ?? row.attempt ?? ""}`,
    eventType
  ].map((part) => cleanFileSegment(part || "none"));
  const eventPayload = {
    adapter,
    backend: data.backend || "",
    profile: data.profile || "",
    acpAgent: data.acpAgent || data.acp_agent || "",
    sessionKey: data.sessionKey || data.session_key || "",
    sessionMode: data.sessionMode || data.session_mode || "",
    messageFlowId: data.messageFlowId || data.message_flow_id || messageFlowIdFromDispatchPayload(row),
    dispatchType: row.dispatch_type || payload.dispatchType || payload.dispatch_type || "",
    attempt: Number(data.attempt ?? row.attempt ?? 0) || 0,
    retryScheduled: Boolean(data.retryScheduled),
    failureType: data.failureType || "",
    semanticContinuation: Boolean(data.semanticContinuation),
    source: "runtime_bridge"
  };
  try {
    return await appendRuntimeSemanticEvent(paths, {
      eventType,
      eventTime,
      workflowId: runtimeBridgeEventWorkflowId(row),
      taskId: runtimeBridgeEventTaskId(row),
      dispatchId: row.dispatch_id || "",
      traceId: row.trace_id || payload.traceId || payload.trace_id || "",
      correlationId: data.correlationId || data.correlation_id || payload.correlationId || payload.correlation_id || "",
      runtime: row.runtime,
      agentId: row.agent_id,
      endpointRef: row.endpoint_ref || "",
      runtimeSessionId: data.runtimeSessionId || data.runtime_session_id || data.sessionKey || data.session_key || "",
      runtimeRunId,
      acpTurnId: data.acpTurnId || data.acp_turn_id || "",
      promptId: data.promptId || data.prompt_id || "",
      stage: data.stage || eventType,
      status: data.status || "",
      blockedReason: data.blockedReason || data.blocked_reason || "",
      latestReceiptRef: data.latestReceiptRef || data.latest_receipt_ref || data.messageId || data.message_id || "",
      staleKind: data.staleKind || data.stale_kind || "",
      evidenceRefs: toList(data.evidenceRefs || data.evidence_refs || data.messageId || data.message_id || data.runtimeRunId || data.runtime_run_id).map(String).filter(Boolean),
      durationMs: data.durationMs || data.duration_ms,
      errorClass: data.errorClass || data.error_class || data.failureType || "",
      severity: data.severity || (eventType === "turn_failed" ? "warning" : "info"),
      idempotencyKey: data.idempotencyKey || data.idempotency_key || idempotencyParts.join(":"),
      payload: { ...eventPayload, ...(data.payload || {}) }
    });
  } catch (error) {
    await appendWorkflowEvent(paths, {
      eventType: "runtime.semantic_event_failed",
      status: "degraded",
      workflowId: runtimeBridgeEventWorkflowId(row),
      traceId: row.trace_id || payload.traceId || payload.trace_id || "",
      dispatchId: row.dispatch_id || "",
      runtimeRunId,
      actor: "runtime.bridge",
      sourceRuntime: row.runtime || "",
      sourceAgent: row.agent_id || "",
      payload: {
        eventType,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        error: error instanceof Error ? error.message : String(error)
      }
    }).catch(() => {});
    await appendJsonl(path.join(paths.bridgeDir, "runtime_events_errors.jsonl"), {
      ts: nowIso(),
      event: "runtime_semantic_event_record_failed",
      dispatchId: row.dispatch_id || "",
      runtime: row.runtime || "",
      agentId: row.agent_id || "",
      eventType,
      error: error instanceof Error ? error.message : String(error)
    }).catch(() => {});
    return null;
  }
}

async function recordRuntimeBridgeFailureState(paths, row, data = {}) {
  return recordRuntimeBridgeSemanticEvent(paths, row, "turn_failed", {
    eventTime: data.eventTime || data.event_time || data.failedAt || data.failed_at || nowIso(),
    runtimeRunId: data.runtimeRunId || data.runtime_run_id || "",
    adapter: data.adapter || "runtime_bridge",
    backend: data.backend || "",
    acpAgent: data.acpAgent || data.acp_agent || "",
    sessionMode: data.sessionMode || data.session_mode || "",
    sessionKey: data.sessionKey || data.session_key || "",
    attempt: data.attempt ?? row.attempt ?? 0,
    failureType: data.failureType || data.failure_type || "runtime_bridge_error",
    retryScheduled: Boolean(data.retryScheduled || data.retry_scheduled),
    status: data.status || (data.retryScheduled || data.retry_scheduled ? "queued" : "failed"),
    stage: data.stage || (data.retryScheduled || data.retry_scheduled ? "retry_scheduled" : "turn_failed"),
    idempotencyKey: data.idempotencyKey || data.idempotency_key || "",
    payload: {
      error: String(data.error || "").slice(0, 1000),
      ...(data.payload || {})
    }
  });
}

async function runHermesDispatch(paths, row, input = {}) {
  const adapter = String(input.adapterName || input.adapter_name || "cli").trim() || "cli";
  const hermesBin = resolveHome(input.hermesBin || input.hermes_bin || process.env.HERMES_BIN || "/home/flashcat/hermes-agent/venv/bin/hermes");
  const proxyEnv = {
    HTTP_PROXY: input.httpProxy || input.http_proxy || process.env.HTTP_PROXY || "http://127.0.0.1:7890",
    HTTPS_PROXY: input.httpsProxy || input.https_proxy || process.env.HTTPS_PROXY || "http://127.0.0.1:7890",
    ALL_PROXY: input.allProxy || input.all_proxy || process.env.ALL_PROXY || "socks5://127.0.0.1:7890"
  };
  const profile = hermesProfileFromEndpoint(row.endpoint_ref, row.agent_id);
  if (!profile) throw new Error(`Hermes profile is required for ${row.agent_id}`);
  const ack = runtimeAckContract(row, input);
  const timeoutSeconds = runtimeDispatchTimeoutSeconds(row, input, 900, 3600);
  const prompt = buildRuntimeBridgePrompt(row);
  const args = ["--profile", profile, "--accept-hooks", "-z", prompt];
  const startedAt = nowIso();
  const attempt = Number(row.attempt || 0) + 1;
  await updateDispatch(paths, row.dispatch_id, "sent", { adapter, profile, startedAt, attempt });
  const runtimeRunId = await recordRuntimeRun(paths, row, { adapter, status: "started", startedAt, attempt, payload: { profile } });
  await recordRuntimeBridgeSemanticEvent(paths, row, "dispatch_bound", {
    eventTime: startedAt,
    runtimeRunId,
    adapter,
    profile,
    attempt,
    stage: "dispatch_bound"
  });
  const flow = await messageFlowForDispatch(paths, row);
  if (flow) {
    await updateMessageFlow(paths, flow.flow_id, messageFlowDispatchStartedStatus(row), {
      dispatchId: row.dispatch_id,
      runtimeRunId,
      payload: { dispatchId: row.dispatch_id, runtimeRunId, adapter, profile }
    });
  }
  await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
    event: "runtime_dispatch_started",
    dispatchId: row.dispatch_id,
    meetingId: row.meeting_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    adapter,
    profile,
    startedAt,
    attempt,
    runtimeRunId
  });
  try {
    const { stdout, stderr } = await execFileAsync(hermesBin, args, {
      cwd: paths.root,
      timeout: timeoutSeconds * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, ...proxyEnv, HERMES_ACCEPT_HOOKS: "1" }
    });
    const text = String(stdout || "").trim();
    if (!text) throw new Error(String(stderr || "Hermes returned empty output").trim());
    if (!messageFlowOutputIsFinal(text)) throw new Error(`Hermes returned incomplete output: ${compactText(text, 500)}`);
    validateRuntimeAckOutput(text, ack);
    const completedAt = nowIso();
    const outputHash = textHash(text);
    const ingest = await meetingIngest(paths.root, {
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      text,
      messageType: row.dispatch_type || "agent_message",
      phase: "runtime_bridge",
      payload: {
        dispatchId: row.dispatch_id,
        adapter,
        profile,
        stderr: String(stderr || "").trim().slice(0, 2000)
      }
    });
    const reportDelivery = ack.required ? null : await autoDeliverReportOutbox(paths, ingest, input);
    await updateDispatch(paths, row.dispatch_id, "acked", { adapter, profile, completedAt, messageId: ingest.messageId, attempt });
    const ackRuntimeRunId = await completeRuntimeRun(paths, row, runtimeRunId, { adapter, status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { profile } });
    const messageFlowDelivery = ack.required ? await acknowledgeMessageFlowRuntime(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      text,
      outputHash,
      receivedAt: completedAt
    }) : await finishMessageFlowRuntime(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      text,
      outputHash
    }, input);
    const semanticContinuation = ack.required ? await queueMessageFlowSemanticContinuation(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      receivedAt: completedAt
    }, input) : null;
    if (ack.required) {
      await recordRuntimeBridgeSemanticEvent(paths, row, "mechanical_ack", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter,
        profile,
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        semanticContinuation: semanticContinuation?.status === "queued",
        stage: "ack_received"
      });
      if (semanticContinuation?.status === "failed") {
        await recordRuntimeBridgeSemanticEvent(paths, row, "blocked", {
          eventTime: completedAt,
          runtimeRunId: ackRuntimeRunId,
          adapter,
          profile,
          attempt,
          messageId: ingest.messageId,
          latestReceiptRef: ingest.messageId,
          messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
          stage: "semantic_continuation_failed",
          blockedReason: semanticContinuation.reason || semanticContinuation.error || "semantic_continuation_failed",
          staleKind: "semantic_continuation_failed",
          payload: { semanticContinuation }
        });
      }
    } else {
      await recordRuntimeBridgeSemanticEvent(paths, row, "semantic_ack", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter,
        profile,
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        stage: isSemanticContinuationDispatch(row) ? "semantic_continuation_received" : "semantic_response_received"
      });
      await recordRuntimeBridgeSemanticEvent(paths, row, "turn_completed", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter,
        profile,
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        stage: isSemanticContinuationDispatch(row) ? "semantic_continuation_completed" : "turn_completed"
      });
    }
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      event: "runtime_dispatch_acked",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter,
      profile,
      messageId: ingest.messageId,
      completedAt,
      attempt,
      runtimeRunId: ackRuntimeRunId,
      messageFlowDelivery,
      semanticContinuation
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: "acked", adapter, profile, messageId: ingest.messageId, runtimeRunId: ackRuntimeRunId, messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "", reportDelivery, messageFlowDelivery, semanticContinuation };
  } catch (error) {
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    const failureType = classifyRuntimeError(error);
    const shouldRetry = runtimeFailureShouldRetry(failureType, ack) && attempt < Number(row.max_attempts || 1);
    await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", { adapter, profile, failedAt, error: message.slice(0, 2000), failureType, attempt, nextRetryAt: shouldRetry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : "" });
    const failedRuntimeRunId = await completeRuntimeRun(paths, row, runtimeRunId, { adapter, status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { profile, retry: shouldRetry } });
    if (!shouldRetry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId: failedRuntimeRunId,
        finalOutputPresent: false,
        failureType,
        lastError: message
      }, input);
    }
    await recordRuntimeBridgeSemanticEvent(paths, row, "turn_failed", {
      eventTime: failedAt,
      runtimeRunId: failedRuntimeRunId,
      adapter,
      profile,
      attempt,
      failureType,
      retryScheduled: shouldRetry,
      status: shouldRetry ? "queued" : "failed",
      stage: shouldRetry ? "retry_scheduled" : "turn_failed",
      payload: { error: message.slice(0, 1000) }
    });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      event: "runtime_dispatch_failed",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter,
      profile,
      failureType,
      retryScheduled: shouldRetry,
      error: message.slice(0, 2000),
      failedAt,
      attempt,
      runtimeRunId
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: shouldRetry ? "queued" : "failed", adapter, profile, runtimeRunId: failedRuntimeRunId, messageFlowId: flow?.flow_id || "", failureType, retryScheduled: shouldRetry, error: message };
  }
}

function hermesAcpAgentFromEndpoint(endpointRef, agentId) {
  const endpoint = String(endpointRef || "").trim();
  const hermesBin = "/home/flashcat/hermes-agent/venv/bin/hermes";
  const commandForProfile = (profile) => profile ? `${hermesBin} -p ${profile} acp --accept-hooks` : "";
  const commandForAlias = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.includes("/") || raw.includes(" ")) return raw;
    if (raw.startsWith("hermes_")) return commandForProfile(raw.slice("hermes_".length));
    return raw;
  };
  if (endpoint.startsWith("acp-agent:")) return commandForAlias(endpoint.slice("acp-agent:".length));
  if (endpoint.startsWith("hermes-acp:")) return commandForAlias(endpoint.slice("hermes-acp:".length));
  const profile = hermesProfileFromEndpoint(endpoint, agentId);
  return commandForProfile(profile.replace(/[^a-zA-Z0-9_-]+/g, "_"));
}

function uniqueResolvedPaths(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const resolved = resolveHome(text);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

async function pathAccessible(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function openClawPackageBaseCandidates(input = {}) {
  const explicit = [
    input.openclawRequireBase,
    input.openclaw_require_base,
    process.env.TRADING_AGENTS_OPENCLAW_REQUIRE_BASE,
    input.openclawPackageDir ? path.join(resolveHome(input.openclawPackageDir), "package.json") : "",
    input.openclaw_package_dir ? path.join(resolveHome(input.openclaw_package_dir), "package.json") : "",
    process.env.TRADING_AGENTS_OPENCLAW_PACKAGE_DIR ? path.join(resolveHome(process.env.TRADING_AGENTS_OPENCLAW_PACKAGE_DIR), "package.json") : "",
    process.env.OPENCLAW_PACKAGE_DIR ? path.join(resolveHome(process.env.OPENCLAW_PACKAGE_DIR), "package.json") : ""
  ];
  const acpxPeerBases = (await acpxPackageDirCandidates(input)).map((dir) => path.join(dir, "package.json"));
  return uniqueResolvedPaths([
    ...explicit,
    ...acpxPeerBases,
    "/usr/lib/node_modules/openclaw/package.json",
    "/usr/local/lib/node_modules/openclaw/package.json"
  ]);
}

async function importFromRequireBase(requireBase, specifier) {
  const require = createRequire(requireBase);
  const resolved = require.resolve(specifier);
  return { module: await import(pathToFileURL(resolved).href), resolved };
}

async function importAcpRuntimeBackendModule(input = {}) {
  const attempts = [];
  try {
    return { module: await import("openclaw/plugin-sdk/acp-runtime-backend"), source: "node-resolution:openclaw" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    attempts.push(`node-resolution: ${message}`);
  }
  for (const base of await openClawPackageBaseCandidates(input)) {
    if (!await pathAccessible(base)) continue;
    try {
      const resolved = await importFromRequireBase(base, "openclaw/plugin-sdk/acp-runtime-backend");
      return { module: resolved.module, source: `require-base:${base}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push(`${base}: ${message}`);
    }
  }
  throw new Error(`OpenClaw ACP runtime SDK is unavailable in this process: ${attempts.join("; ")}`);
}

async function acpxPackageDirCandidates(input = {}) {
  const explicitDirs = uniqueResolvedPaths([
    input.acpxPackageDir,
    input.acpx_package_dir,
    process.env.TRADING_AGENTS_ACPX_PACKAGE_DIR,
    process.env.OPENCLAW_ACPX_PACKAGE_DIR
  ]);
  const legacyInstallDir = path.join(os.homedir(), ".openclaw", "npm", "node_modules", "@openclaw", "acpx");
  if (explicitDirs.length > 0) return uniqueResolvedPaths([...explicitDirs, legacyInstallDir]);

  const projectRoots = uniqueResolvedPaths([
    input.openclawNpmProjectsDir,
    input.openclaw_npm_projects_dir,
    process.env.TRADING_AGENTS_OPENCLAW_NPM_PROJECTS_DIR,
    process.env.OPENCLAW_NPM_PROJECTS_DIR,
    path.join(os.homedir(), ".openclaw", "npm", "projects")
  ]);
  const projectScanLimit = Math.max(1, Math.min(100, Number(firstText(
    input.acpxProjectScanLimit,
    input.acpx_project_scan_limit,
    process.env.TRADING_AGENTS_ACPX_PROJECT_SCAN_LIMIT,
    25
  )) || 25));
  const projectInstallDirs = [];
  for (const root of projectRoots) {
    try {
      const entries = (await fs.readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith("openclaw-acpx-"))
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, projectScanLimit);
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith("openclaw-acpx-")) continue;
        const packageDir = path.join(root, entry.name, "node_modules", "@openclaw", "acpx");
        const validPackageDir = await validAcpxPackageDir(packageDir);
        if (!validPackageDir) continue;
        projectInstallDirs.push(validPackageDir);
      }
    } catch {
      // Optional OpenClaw plugin project layout; ignore when absent or unreadable.
    }
  }
  return uniqueResolvedPaths([...projectInstallDirs, legacyInstallDir]);
}

async function validAcpxPackageDir(packageDir) {
  try {
    const stat = await fs.lstat(packageDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    const packageJson = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
    if (packageJson?.name !== "@openclaw/acpx") return false;
    return await fs.realpath(packageDir);
  } catch {
    return false;
  }
}

async function importAcpxRegisterRuntime(input = {}) {
  const attempts = [];
  const direct = firstText(
    input.acpxRegisterModule,
    input.acpx_register_module,
    process.env.TRADING_AGENTS_ACPX_REGISTER_MODULE
  );
  if (direct) {
    const resolved = resolveHome(direct);
    try {
      return { module: await import(pathToFileURL(resolved).href), source: resolved };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push(`${resolved}: ${message}`);
    }
  }
  for (const dir of await acpxPackageDirCandidates(input)) {
    const registerPath = path.join(dir, "dist", "register.runtime.js");
    if (!await pathAccessible(registerPath)) continue;
    try {
      return { module: await import(pathToFileURL(registerPath).href), source: registerPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push(`${registerPath}: ${message}`);
    }
  }
  throw new Error(`OpenClaw ACPX runtime plugin is unavailable in this process: ${attempts.join("; ") || "no @openclaw/acpx package found"}`);
}

function standaloneAcpxLogger(input = {}) {
  if (!boolOption(input.verboseAcp ?? input.verbose_acp ?? process.env.TRADING_AGENTS_VERBOSE_ACP, false)) {
    return { info() {}, warn() {}, error() {}, debug() {} };
  }
  return {
    info(message) { console.error(`[trading-agents-workflow acpx] ${message}`); },
    warn(message) { console.error(`[trading-agents-workflow acpx] warn: ${message}`); },
    error(message) { console.error(`[trading-agents-workflow acpx] error: ${message}`); },
    debug(message) { console.error(`[trading-agents-workflow acpx] debug: ${message}`); }
  };
}

function standaloneAcpxPluginConfig(paths, input = {}) {
  const parsedConfig = typeof input.acpxPluginConfig === "object" && input.acpxPluginConfig !== null
    ? input.acpxPluginConfig
    : typeof input.acpx_plugin_config === "object" && input.acpx_plugin_config !== null
      ? input.acpx_plugin_config
      : parseJsonValue(input.acpxPluginConfigJson || input.acpx_plugin_config_json || process.env.TRADING_AGENTS_ACPX_PLUGIN_CONFIG_JSON, {});
  const rawConfig = parsedConfig && typeof parsedConfig === "object" && !Array.isArray(parsedConfig) ? parsedConfig : {};
  const stateDir = resolveHome(firstText(
    input.acpxStateDir,
    input.acpx_state_dir,
    process.env.TRADING_AGENTS_ACPX_STATE_DIR,
    rawConfig.stateDir,
    path.join(paths.bridgeDir, "acpx-runtime")
  ));
  const cwd = resolveHome(firstText(
    input.acpxCwd,
    input.acpx_cwd,
    rawConfig.cwd,
    paths.root
  ));
  return {
    ...rawConfig,
    cwd,
    stateDir
  };
}

async function startStandaloneAcpxBackend(paths, input = {}) {
  const imported = await importAcpxRegisterRuntime(input);
  const createService = imported.module.createAcpxRuntimeService;
  if (typeof createService !== "function") throw new Error(`OpenClaw ACPX runtime plugin has no createAcpxRuntimeService export: ${imported.source}`);
  const pluginConfig = standaloneAcpxPluginConfig(paths, input);
  const service = createService({ pluginConfig });
  const ctx = {
    workspaceDir: paths.root,
    stateDir: pluginConfig.stateDir,
    config: { acp: { allowedAgents: toList(input.acpAllowedAgents || input.acp_allowed_agents || process.env.TRADING_AGENTS_ACP_ALLOWED_AGENTS) } },
    logger: standaloneAcpxLogger(input)
  };
  await service.start(ctx);
  return { source: imported.source, stateDir: pluginConfig.stateDir, service, ctx };
}

async function resolveAcpBackend(backendId, input = {}, paths = null) {
  const normalizedBackendId = String(backendId || "acpx").trim().toLowerCase() || "acpx";
  const imported = await importAcpRuntimeBackendModule(input);
  let backend = imported.module.getAcpRuntimeBackend?.(normalizedBackendId);
  let source = imported.source;
  let cleanup = async () => {};
  if (!backend?.runtime && normalizedBackendId === "acpx" && paths) {
    const standalone = await startStandaloneAcpxBackend(paths, input);
    backend = imported.module.getAcpRuntimeBackend?.(normalizedBackendId);
    source = `${source}; acpx-service:${standalone.source}`;
    cleanup = async () => {
      await standalone.service?.stop?.(standalone.ctx);
    };
  }
  if (!backend?.runtime) throw new Error(`ACP runtime backend is not loaded: ${normalizedBackendId}`);
  return { backend, source, cleanup };
}

function acpTextFromEvent(event) {
  if (!event || typeof event !== "object") return "";
  if (event.type === "text_delta" && (event.stream === undefined || event.stream === "output")) return String(event.text || "");
  return "";
}

function acpTimeoutError(timeoutSeconds) {
  const error = new Error(`Hermes ACP runtime timed out after ${timeoutSeconds}s without final output`);
  error.code = "RUNTIME_TIMEOUT";
  return error;
}

async function collectAcpTurnOutput(backend, request, timeoutSeconds, controller) {
  const chunks = [];
  const acpEvents = [];
  const turn = (async () => {
    for await (const event of backend.runtime.runTurn(request)) {
      if (event?.type === "error") throw new Error(event.message || "ACP runtime turn failed");
      const text = acpTextFromEvent(event);
      if (text) chunks.push(text);
      if (event?.type && event.type !== "text_delta") {
        acpEvents.push({
          type: event.type,
          text: String(event.text || event.message || "").slice(0, 1000),
          tag: event.tag || "",
          stopReason: event.stopReason || ""
        });
      }
    }
    return { text: chunks.join("").trim(), acpEvents };
  })();
  let hardTimeout = null;
  try {
    return await Promise.race([
      turn,
      new Promise((_, reject) => {
        hardTimeout = setTimeout(() => {
          controller.abort();
          reject(acpTimeoutError(timeoutSeconds));
        }, timeoutSeconds * 1000 + 3000);
      })
    ]);
  } finally {
    if (hardTimeout) clearTimeout(hardTimeout);
    turn.catch(() => {});
  }
}

function acpBackendExplicitlyRequested(input = {}) {
  return input.acpBackend !== undefined
    || input.acp_backend !== undefined;
}

async function runHermesAcpDispatch(paths, row, input = {}) {
  const explicitBackend = acpBackendExplicitlyRequested(input);
  const backendId = String(input.acpBackend || input.acp_backend || process.env.TRADING_AGENTS_ACP_BACKEND || "acpx").trim();
  const registryAcpAgent = String(hermesAcpAgentFromEndpoint(row.endpoint_ref, row.agent_id)).trim();
  const requestedAcpAgent = String(input.acpAgent || input.acp_agent || "").trim();
  if (requestedAcpAgent && requestedAcpAgent !== registryAcpAgent) {
    throw new Error(`Hermers ACP agent override is not registry-owned for ${row.agent_id}`);
  }
  const acpAgent = registryAcpAgent;
  if (!acpAgent) throw new Error(`Hermes ACP agent alias is required for ${row.agent_id}`);
  const sessionMode = String(input.sessionMode || input.session_mode || "persistent").trim() === "oneshot" ? "oneshot" : "persistent";
  const ack = runtimeAckContract(row, input);
  const timeoutSeconds = runtimeDispatchTimeoutSeconds(row, input, 900, 3600);
  const sessionKey = cleanFileSegment(input.sessionKey || input.session_key || `workflow-${row.meeting_id}-${row.agent_id}`);
  const prompt = buildRuntimeBridgePrompt(row);
  const startedAt = nowIso();
  const attempt = Number(row.attempt || 0) + 1;
  let backend;
  let backendSource = "";
  let backendCleanup = async () => {};
  try {
    const resolvedBackend = await resolveAcpBackend(backendId, input, paths);
    backend = resolvedBackend.backend;
    backendSource = resolvedBackend.source;
    backendCleanup = resolvedBackend.cleanup || backendCleanup;
  } catch (error) {
    const allowFallback = boolOption(input.acpBackendFallback ?? input.acp_backend_fallback ?? process.env.TRADING_AGENTS_ACP_BACKEND_FALLBACK, !explicitBackend);
    if (allowFallback) {
      return runHermesDispatch(paths, row, {
        ...input,
        adapterName: "cli",
        adapter_name: "cli",
        acpBackendFallback: false,
        acp_backend_fallback: false,
        acpFallbackFromBackend: backendId,
        acp_fallback_from_backend: backendId,
        acpFallbackError: error instanceof Error ? error.message : String(error),
        acp_fallback_error: error instanceof Error ? error.message : String(error)
      });
    }
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    const failureType = "acp_unavailable";
    const shouldRetry = attempt < Number(row.max_attempts || 1);
    await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", { adapter: "acp", backend: backendId, acpAgent, failedAt, error: message.slice(0, 2000), failureType, attempt, nextRetryAt: shouldRetry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : "" });
    const runtimeRunId = await recordRuntimeRun(paths, row, { adapter: "acp", backend: backendId, acpAgent, sessionKey, status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { sessionMode, retry: shouldRetry, failClosed: true } });
    if (!shouldRetry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId,
        finalOutputPresent: false,
        failureType,
        lastError: message
      }, input);
    }
    await recordRuntimeBridgeSemanticEvent(paths, row, "turn_failed", {
      eventTime: failedAt,
      runtimeRunId,
      adapter: "acp",
      backend: backendId,
      acpAgent,
      sessionMode,
      sessionKey,
      attempt,
      failureType,
      retryScheduled: shouldRetry,
      status: shouldRetry ? "queued" : "failed",
      stage: shouldRetry ? "retry_scheduled" : "turn_failed",
      payload: { error: message.slice(0, 1000), failClosed: true }
    });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      ts: failedAt,
      event: "runtime_dispatch_failed",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "acp",
      backend: backendId,
      acpAgent,
      sessionMode,
      sessionKey,
      failureType,
      retryScheduled: shouldRetry,
      error: message.slice(0, 2000),
      failedAt,
      attempt,
      runtimeRunId
    });
    const flow = await messageFlowForDispatch(paths, row);
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: shouldRetry ? "queued" : "failed", adapter: "acp", backend: backendId, acpAgent, sessionKey, runtimeRunId, messageFlowId: flow?.flow_id || "", failureType, retryScheduled: shouldRetry, error: message };
  }
  await updateDispatch(paths, row.dispatch_id, "sent", { adapter: "acp", backend: backendId, backendSource, acpAgent, sessionMode, sessionKey, startedAt, attempt });
  const runtimeRunId = await recordRuntimeRun(paths, row, { adapter: "acp", backend: backendId, acpAgent, sessionKey, status: "started", startedAt, attempt, payload: { sessionMode, backendSource } });
  await recordRuntimeBridgeSemanticEvent(paths, row, "dispatch_bound", {
    eventTime: startedAt,
    runtimeRunId,
    adapter: "acp",
    backend: backendId,
    acpAgent,
    sessionMode,
    sessionKey,
    attempt,
    stage: "dispatch_bound"
  });
  const flow = await messageFlowForDispatch(paths, row);
  if (flow) {
    await updateMessageFlow(paths, flow.flow_id, messageFlowDispatchStartedStatus(row), {
      dispatchId: row.dispatch_id,
      runtimeRunId,
      payload: { dispatchId: row.dispatch_id, runtimeRunId, adapter: "acp", backend: backendId, acpAgent, sessionMode }
    });
  }
  await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
    ts: startedAt,
    event: "runtime_dispatch_started",
    dispatchId: row.dispatch_id,
    meetingId: row.meeting_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    adapter: "acp",
    backend: backendId,
    backendSource,
    acpAgent,
    sessionMode,
    sessionKey,
    attempt,
    runtimeRunId
  });
  let timeout = null;
  const controller = new AbortController();
  try {
    const handle = await backend.runtime.ensureSession({
      sessionKey,
      agent: acpAgent,
      mode: sessionMode,
      cwd: paths.root
    });
    timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
    if (typeof timeout.unref === "function") timeout.unref();
    const { text, acpEvents } = await collectAcpTurnOutput(backend, {
      handle,
      text: prompt,
      mode: "prompt",
      requestId: row.dispatch_id,
      signal: controller.signal
    }, timeoutSeconds, controller);
    if (!text && controller.signal.aborted) throw acpTimeoutError(timeoutSeconds);
    if (!text) throw new Error("Hermes ACP returned empty output");
    if (!messageFlowOutputIsFinal(text)) throw new Error(`Hermes ACP returned incomplete output: ${compactText(text, 500)}`);
    validateRuntimeAckOutput(text, ack);
    const completedAt = nowIso();
    const outputHash = textHash(text);
    const ingest = await meetingIngest(paths.root, {
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      text,
      messageType: row.dispatch_type || "agent_message",
      phase: "runtime_bridge_acp",
      payload: {
        dispatchId: row.dispatch_id,
        adapter: "acp",
        backend: backendId,
        backendSource,
        acpAgent,
        sessionMode,
        sessionKey,
        handle,
        events: acpEvents.slice(-20)
      }
    });
    const reportDelivery = ack.required ? null : await autoDeliverReportOutbox(paths, ingest, input);
    await updateDispatch(paths, row.dispatch_id, "acked", { adapter: "acp", backend: backendId, acpAgent, completedAt, messageId: ingest.messageId, attempt });
    const ackRuntimeRunId = await completeRuntimeRun(paths, row, runtimeRunId, { adapter: "acp", backend: backendId, acpAgent, sessionKey, status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { sessionMode, backendSource, events: acpEvents.slice(-20) } });
    const messageFlowDelivery = ack.required ? await acknowledgeMessageFlowRuntime(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      text,
      outputHash,
      receivedAt: completedAt
    }) : await finishMessageFlowRuntime(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      text,
      outputHash
    }, input);
    const semanticContinuation = ack.required ? await queueMessageFlowSemanticContinuation(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      receivedAt: completedAt
    }, input) : null;
    if (ack.required) {
      await recordRuntimeBridgeSemanticEvent(paths, row, "mechanical_ack", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter: "acp",
        backend: backendId,
        acpAgent,
        sessionMode,
        sessionKey,
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        semanticContinuation: semanticContinuation?.status === "queued",
        stage: "ack_received"
      });
      if (semanticContinuation?.status === "failed") {
        await recordRuntimeBridgeSemanticEvent(paths, row, "blocked", {
          eventTime: completedAt,
          runtimeRunId: ackRuntimeRunId,
          adapter: "acp",
          backend: backendId,
          acpAgent,
          sessionMode,
          sessionKey,
          attempt,
          messageId: ingest.messageId,
          latestReceiptRef: ingest.messageId,
          messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
          stage: "semantic_continuation_failed",
          blockedReason: semanticContinuation.reason || semanticContinuation.error || "semantic_continuation_failed",
          staleKind: "semantic_continuation_failed",
          payload: { semanticContinuation }
        });
      }
    } else {
      await recordRuntimeBridgeSemanticEvent(paths, row, "semantic_ack", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter: "acp",
        backend: backendId,
        acpAgent,
        sessionMode,
        sessionKey,
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        stage: isSemanticContinuationDispatch(row) ? "semantic_continuation_received" : "semantic_response_received"
      });
      await recordRuntimeBridgeSemanticEvent(paths, row, "turn_completed", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter: "acp",
        backend: backendId,
        acpAgent,
        sessionMode,
        sessionKey,
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        stage: isSemanticContinuationDispatch(row) ? "semantic_continuation_completed" : "turn_completed"
      });
    }
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      ts: completedAt,
      event: "runtime_dispatch_acked",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "acp",
      backend: backendId,
      backendSource,
      acpAgent,
      sessionMode,
      sessionKey,
      messageId: ingest.messageId,
      completedAt,
      attempt,
      runtimeRunId: ackRuntimeRunId,
      messageFlowDelivery,
      semanticContinuation
    });
    if (sessionMode === "oneshot") await backend.runtime.close({ handle, reason: "trading-agents-workflow oneshot completed", discardPersistentState: true }).catch(() => {});
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: "acked", adapter: "acp", backend: backendId, acpAgent, sessionKey, messageId: ingest.messageId, runtimeRunId: ackRuntimeRunId, messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "", reportDelivery, messageFlowDelivery, semanticContinuation };
  } catch (error) {
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    const failureType = classifyRuntimeError(error);
    const shouldRetry = runtimeFailureShouldRetry(failureType, ack) && attempt < Number(row.max_attempts || 1);
    await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", { adapter: "acp", backend: backendId, acpAgent, failedAt, error: message.slice(0, 2000), failureType, attempt, nextRetryAt: shouldRetry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : "" });
    const failedRuntimeRunId = await completeRuntimeRun(paths, row, runtimeRunId, { adapter: "acp", backend: backendId, acpAgent, sessionKey, status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { sessionMode, backendSource, retry: shouldRetry } });
    if (!shouldRetry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId: failedRuntimeRunId,
        finalOutputPresent: false,
        failureType,
        lastError: message
      }, input);
    }
    await recordRuntimeBridgeSemanticEvent(paths, row, "turn_failed", {
      eventTime: failedAt,
      runtimeRunId: failedRuntimeRunId,
      adapter: "acp",
      backend: backendId,
      acpAgent,
      sessionMode,
      sessionKey,
      attempt,
      failureType,
      retryScheduled: shouldRetry,
      status: shouldRetry ? "queued" : "failed",
      stage: shouldRetry ? "retry_scheduled" : "turn_failed",
      payload: { error: message.slice(0, 1000) }
    });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      ts: failedAt,
      event: "runtime_dispatch_failed",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "acp",
      backend: backendId,
      backendSource,
      acpAgent,
      sessionMode,
      sessionKey,
      failureType,
      retryScheduled: shouldRetry,
      error: message.slice(0, 2000),
      failedAt,
      attempt,
      runtimeRunId
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: shouldRetry ? "queued" : "failed", adapter: "acp", backend: backendId, acpAgent, sessionKey, runtimeRunId: failedRuntimeRunId, messageFlowId: flow?.flow_id || "", failureType, retryScheduled: shouldRetry, error: message };
  } finally {
    if (timeout) clearTimeout(timeout);
    await backendCleanup();
  }
}

async function runOpenClawDispatch(paths, row, input = {}) {
  const openclawBin = String(input.openclawBin || input.openclaw_bin || process.env.OPENCLAW_BIN || "openclaw").trim();
  const ack = runtimeAckContract(row, input);
  const timeoutSeconds = runtimeDispatchTimeoutSeconds(row, input, 300, 1800);
  const prompt = buildRuntimeBridgePrompt(row);
  const startedAt = nowIso();
  const attempt = Number(row.attempt || 0) + 1;
  const args = [
    "agent",
    "--agent",
    row.agent_id,
    "--message",
    prompt,
    "--json",
    "--timeout",
    String(timeoutSeconds)
  ];
  await updateDispatch(paths, row.dispatch_id, "sent", { adapter: "openclaw", openclawBin, startedAt, attempt });
  const runtimeRunId = await recordRuntimeRun(paths, row, { adapter: "openclaw", status: "started", startedAt, attempt, payload: { openclawBin } });
  await recordRuntimeBridgeSemanticEvent(paths, row, "dispatch_bound", {
    eventTime: startedAt,
    runtimeRunId,
    adapter: "openclaw",
    attempt,
    stage: "dispatch_bound"
  });
  const flow = await messageFlowForDispatch(paths, row);
  if (flow) {
    await updateMessageFlow(paths, flow.flow_id, messageFlowDispatchStartedStatus(row), {
      dispatchId: row.dispatch_id,
      runtimeRunId,
      payload: { dispatchId: row.dispatch_id, runtimeRunId, adapter: "openclaw", openclawBin }
    });
  }
  await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
    ts: startedAt,
    event: "runtime_dispatch_started",
    dispatchId: row.dispatch_id,
    meetingId: row.meeting_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    adapter: "openclaw",
    attempt,
    runtimeRunId
  });
  try {
    const { stdout, stderr } = await execFileAsync(openclawBin, args, {
      cwd: paths.root,
      timeout: (ack.required ? timeoutSeconds + 10 : timeoutSeconds + 30) * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, TRADING_AGENTS_WORKFLOW_BRIDGE: "openclaw" }
    });
    const raw = String(stdout || "").trim();
    const parsed = parseJsonValue(raw, null);
    if (!parsed || typeof parsed !== "object") throw new Error(`OpenClaw returned non-JSON output: ${raw.slice(0, 1000) || String(stderr || "").slice(0, 1000)}`);
    if (parsed.status && parsed.status !== "ok") throw new Error(`OpenClaw agent status=${parsed.status}: ${parsed.summary || raw.slice(0, 1000)}`);
    const payloadTexts = Array.isArray(parsed.result?.payloads)
      ? parsed.result.payloads.map((item) => String(item?.text || "").trim()).filter(Boolean)
      : [];
    const text = payloadTexts.join("\n\n").trim() || String(parsed.summary || "").trim();
    if (!text) throw new Error(`OpenClaw returned empty output: ${String(stderr || "").slice(0, 1000)}`);
    validateRuntimeAckOutput(text, ack);
    if (!messageFlowOutputIsFinal(text)) throw new Error(`OpenClaw returned incomplete output: ${compactText(text, 500)}`);
    const completedAt = nowIso();
    const outputHash = textHash(text);
    const ingest = await meetingIngest(paths.root, {
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      text,
      messageType: row.dispatch_type || "agent_message",
      phase: "runtime_bridge_openclaw",
      payload: {
        dispatchId: row.dispatch_id,
        adapter: "openclaw",
        runId: parsed.runId || "",
        deliverySucceeded: parsed.result?.deliverySucceeded ?? parsed.deliverySucceeded ?? null,
        stderr: String(stderr || "").trim().slice(0, 2000)
      }
    });
    const reportDelivery = ack.required ? null : await autoDeliverReportOutbox(paths, ingest, input);
    await updateDispatch(paths, row.dispatch_id, "acked", { adapter: "openclaw", completedAt, messageId: ingest.messageId, attempt, runId: parsed.runId || "" });
    const ackRuntimeRunId = await completeRuntimeRun(paths, row, runtimeRunId, { adapter: "openclaw", status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { runId: parsed.runId || "" } });
    const messageFlowDelivery = ack.required ? await acknowledgeMessageFlowRuntime(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      text,
      outputHash,
      receivedAt: completedAt
    }) : await finishMessageFlowRuntime(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      text,
      outputHash
    }, input);
    const semanticContinuation = ack.required ? await queueMessageFlowSemanticContinuation(paths, row, {
      runtimeRunId: ackRuntimeRunId,
      messageId: ingest.messageId,
      receivedAt: completedAt
    }, input) : null;
    if (ack.required) {
      await recordRuntimeBridgeSemanticEvent(paths, row, "mechanical_ack", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter: "openclaw",
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        semanticContinuation: semanticContinuation?.status === "queued",
        stage: "ack_received",
        payload: { runId: parsed.runId || "" }
      });
      if (semanticContinuation?.status === "failed") {
        await recordRuntimeBridgeSemanticEvent(paths, row, "blocked", {
          eventTime: completedAt,
          runtimeRunId: ackRuntimeRunId,
          adapter: "openclaw",
          attempt,
          messageId: ingest.messageId,
          latestReceiptRef: ingest.messageId,
          messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
          stage: "semantic_continuation_failed",
          blockedReason: semanticContinuation.reason || semanticContinuation.error || "semantic_continuation_failed",
          staleKind: "semantic_continuation_failed",
          payload: { runId: parsed.runId || "", semanticContinuation }
        });
      }
    } else {
      await recordRuntimeBridgeSemanticEvent(paths, row, "semantic_ack", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter: "openclaw",
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        stage: isSemanticContinuationDispatch(row) ? "semantic_continuation_received" : "semantic_response_received",
        payload: { runId: parsed.runId || "" }
      });
      await recordRuntimeBridgeSemanticEvent(paths, row, "turn_completed", {
        eventTime: completedAt,
        runtimeRunId: ackRuntimeRunId,
        adapter: "openclaw",
        attempt,
        messageId: ingest.messageId,
        latestReceiptRef: ingest.messageId,
        messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "",
        stage: isSemanticContinuationDispatch(row) ? "semantic_continuation_completed" : "turn_completed",
        payload: { runId: parsed.runId || "" }
      });
    }
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      ts: completedAt,
      event: "runtime_dispatch_acked",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "openclaw",
      messageId: ingest.messageId,
      completedAt,
      attempt,
      runtimeRunId: ackRuntimeRunId,
      runId: parsed.runId || "",
      messageFlowDelivery,
      semanticContinuation
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: "acked", adapter: "openclaw", messageId: ingest.messageId, runId: parsed.runId || "", runtimeRunId: ackRuntimeRunId, messageFlowId: messageFlowDelivery?.flowId || flow?.flow_id || "", reportDelivery, messageFlowDelivery, semanticContinuation };
  } catch (error) {
    const failedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    const failureType = classifyRuntimeError(error);
    const shouldRetry = runtimeFailureShouldRetry(failureType, ack) && attempt < Number(row.max_attempts || 1);
    await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", { adapter: "openclaw", failedAt, error: message.slice(0, 2000), failureType, attempt, nextRetryAt: shouldRetry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : "" });
    const failedRuntimeRunId = await completeRuntimeRun(paths, row, runtimeRunId, { adapter: "openclaw", status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { retry: shouldRetry } });
    if (!shouldRetry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId: failedRuntimeRunId,
        finalOutputPresent: false,
        failureType,
        lastError: message
      }, input);
    }
    await recordRuntimeBridgeSemanticEvent(paths, row, "turn_failed", {
      eventTime: failedAt,
      runtimeRunId: failedRuntimeRunId,
      adapter: "openclaw",
      attempt,
      failureType,
      retryScheduled: shouldRetry,
      status: shouldRetry ? "queued" : "failed",
      stage: shouldRetry ? "retry_scheduled" : "turn_failed",
      payload: { error: message.slice(0, 1000) }
    });
    await appendJsonl(path.join(paths.bridgeDir, "runtime_runs.jsonl"), {
      ts: failedAt,
      event: "runtime_dispatch_failed",
      dispatchId: row.dispatch_id,
      meetingId: row.meeting_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      adapter: "openclaw",
      failureType,
      retryScheduled: shouldRetry,
      error: message.slice(0, 2000),
      failedAt,
      attempt,
      runtimeRunId
    });
    return { dispatchId: row.dispatch_id, runtime: row.runtime, agentId: row.agent_id, status: shouldRetry ? "queued" : "failed", adapter: "openclaw", runtimeRunId: failedRuntimeRunId, messageFlowId: flow?.flow_id || "", failureType, retryScheduled: shouldRetry, error: message };
  }
}

function normalizeHumanGateDecisionStatus(value, fallback = "approved") {
  const raw = String(value || "").trim();
  if (["pause", "paused"].includes(raw)) return "paused";
  if (["terminate", "terminated", "stop", "stopped"].includes(raw)) return "terminated";
  if (HUMAN_GATE_STATUSES.has(raw)) return raw;
  return fallback;
}

function humanGateDecisionStatusFromRole(role, fallback = "approved") {
  const text = String(role || "").trim();
  if (text === "reject") return "rejected";
  if (text === "pause") return "paused";
  if (text === "terminate") return "terminated";
  if (text === "approve" || text === "approve_option") return "approved";
  return fallback;
}

function defaultHumanGateButtonRole(decisionStatus) {
  if (decisionStatus === "rejected") return "reject";
  if (decisionStatus === "paused") return "pause";
  if (decisionStatus === "terminated") return "terminate";
  return "approve";
}

function defaultHumanGateButtonStyle(decisionStatus) {
  if (decisionStatus === "approved") return "success";
  if (decisionStatus === "rejected" || decisionStatus === "terminated") return "danger";
  return "primary";
}

function humanGateButtonOptions(input = {}) {
  const raw = input.buttons ?? input.options ?? input.choices;
  const values = normalizeRawHumanGateButtonSpecs(buttonArrayFromRaw(raw) || [], {}, input, input);
  const options = values.map((rawItem, index) => {
    const item = typeof rawItem === "string" ? parseJsonValue(rawItem, rawItem) : rawItem;
    const value = item && typeof item === "object" ? item : { label: String(item || "").trim() };
    const label = String(value.label || value.title || value.text || value.name || `Option ${index + 1}`).trim();
    if (!label) return null;
    const roleRaw = String(value.role || value.buttonRole || value.button_role || "").trim();
    const statusRaw = String(value.status || value.decisionStatus || value.decision_status || "").trim();
    const decisionStatus = normalizeHumanGateDecisionStatus(statusRaw, humanGateDecisionStatusFromRole(roleRaw, "approved"));
    const role = roleRaw || defaultHumanGateButtonRole(decisionStatus);
    return {
      label,
      decisionStatus,
      role,
      style: TELEGRAM_BUTTON_STYLES.has(value.style) ? value.style : defaultHumanGateButtonStyle(decisionStatus),
      artifactRef: String(value.artifactRef || value.artifact_ref || value.path || "").trim(),
      summary: String(value.summary || value.description || value.text || label).trim(),
      prompt: String(value.prompt || value.nextAction || value.next_action || "").trim(),
      payload: value
    };
  }).filter(Boolean);
  const addDefaultControls = input.addDefaultControls !== false && input.appendDefaultControls !== false && input.noDefaultControls !== true && input.no_default_controls !== true;
  if (!addDefaultControls || !options.length || !auditHumanGatePlanOptions(options).ok) return options;
  return withHumanGateControlButtons(options, {}, input, input);
}

function humanGateRecordStageKey(row = {}, payload = {}, body = {}) {
  const explicit = firstText(
    body.humanGateStageKey,
    body.human_gate_stage_key,
    body.stageKey,
    body.stage_key,
    body.workflowStage,
    body.workflow_stage,
    body.stage,
    body.phase,
    payload.humanGateStageKey,
    payload.human_gate_stage_key,
    payload.stageKey,
    payload.stage_key
  );
  if (explicit) return explicit;
  return `workflow:${cleanFileSegment(firstText(row.parent_object_id, body.workflowId, payload.workflowId, row.object_id, "default"))}`;
}

function humanGateRecordGateType(payload = {}, body = {}) {
  return firstText(body.gateType, body.gate_type, payload.gateType, payload.gate_type, "workflow_continuation");
}

async function pendingHumanGateForStage(paths, { workflowId, gateType, stageKey, excludeHumanGateId = "" } = {}) {
  const rows = await sqlite(paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending'
ORDER BY created_at DESC;`, { json: true });
  for (const row of rows) {
    if (excludeHumanGateId && row.object_id === excludeHumanGateId) continue;
    const payload = parseJsonValue(row.payload_json, {});
    const body = humanGateBody(payload);
    if (humanGateWorkflowId(row, payload, body) !== workflowId) continue;
    if (humanGateRecordGateType(payload, body) !== gateType) continue;
    if (humanGateRecordStageKey(row, payload, body) !== stageKey) continue;
    return { row, payload, body };
  }
  return null;
}

async function supersedeHumanGateRecord(paths, row, reason = "superseded_by_new_human_gate_request") {
  if (!row?.object_id) return null;
  const supersededAt = nowIso();
  const payload = parseJsonValue(row.payload_json, {});
  const updatedPayload = { ...payload, status: "superseded", supersededAt, supersededReason: reason };
  const hash = jsonHash(updatedPayload);
  const relPath = await writeJsonArtifact(paths.root, path.join(paths.protocolDir, "human_gate_record"), row.object_id, { ...updatedPayload, hash });
  await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status='superseded',
    path=${sqlValue(relPath)},
    payload_json=${sqlValue(JSON.stringify(updatedPayload))},
    hash=${sqlValue(hash)},
    updated_at=${sqlValue(supersededAt)}
WHERE object_id=${sqlValue(row.object_id)} AND object_type='human_gate_record' AND status='pending';
UPDATE human_gate_buttons
SET status='superseded',
    updated_at=${sqlValue(supersededAt)}
WHERE human_gate_id=${sqlValue(row.object_id)} AND status IN ('active','feedback_pending');`);
  const outboxRows = await sqlite(paths.dbFile, `
SELECT outbox_id, status, payload_json
FROM telegram_outbox
WHERE message_type='human_gate_request'
ORDER BY created_at DESC
LIMIT 500;`, { json: true });
  for (const outbox of outboxRows) {
    const outboxPayload = parseJsonValue(outbox.payload_json, {});
    const humanGateId = String(outboxPayload.humanGateId || outboxPayload.human_gate_id || "").trim();
    if (humanGateId !== row.object_id) continue;
    if (["queued", "delivering", "failed"].includes(String(outbox.status || ""))) {
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='cancelled',
    payload_json=${sqlValue(JSON.stringify({ ...outboxPayload, cancelledAt: supersededAt, cancelledReason: reason }))},
    updated_at=${sqlValue(supersededAt)}
WHERE outbox_id=${sqlValue(outbox.outbox_id)};`);
    }
  }
  await appendWorkflowEvent(paths, {
    eventType: "human_gate.superseded",
    status: "superseded",
    workflowId: humanGateWorkflowId(row, payload, humanGateBody(payload)),
    humanGateId: row.object_id,
    actor: "workflow",
    sourceRuntime: "workflow",
    sourceAgent: "workflow",
    previousState: "pending",
    nextState: "superseded",
    payload: { reason }
  });
  return { humanGateId: row.object_id, status: "superseded", supersededAt, reason };
}

async function createHumanGateButtons(paths, input = {}) {
  const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
  if (!humanGateId) return [];
  const lockedRows = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(humanGateId)} AND status IN ('feedback_pending','selected')
ORDER BY updated_at DESC, created_at ASC;`, { json: true });
  if (lockedRows.length) return lockedRows.map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root));
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  const meetingId = String(input.meetingId || input.meeting_id || workflowId).trim();
  const createdBy = String(input.createdBy || input.created_by || input.from || "cat_claw").trim();
  const createdAt = nowIso();
  let options = humanGateButtonOptions(input);
  if (!options.length) return [];
  const buttons = [];
  for (const [index, option] of options.entries()) {
    const buttonSeed = `${humanGateId}:${index}:${option.label}:${option.decisionStatus}:${option.role}`;
    const callbackToken = textHash(`token:${buttonSeed}`).slice(0, 24);
    const buttonId = `hgatebtn.${textHash(`button:${buttonSeed}`).slice(0, 24)}`;
    await sqlite(paths.dbFile, `
INSERT INTO human_gate_buttons(button_id, callback_token, human_gate_id, workflow_id, meeting_id, label, decision_status, button_role, artifact_ref, summary, prompt, payload_json, status, created_by, created_at, updated_at)
VALUES (${sqlValue(buttonId)}, ${sqlValue(callbackToken)}, ${sqlValue(humanGateId)}, ${sqlValue(workflowId)}, ${sqlValue(meetingId)}, ${sqlValue(option.label)}, ${sqlValue(option.decisionStatus)}, ${sqlValue(option.role)}, ${sqlValue(option.artifactRef)}, ${sqlValue(option.summary)}, ${sqlValue(option.prompt)}, ${sqlValue(JSON.stringify(option.payload || {}))}, 'active', ${sqlValue(createdBy)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(button_id) DO UPDATE SET
  callback_token=excluded.callback_token,
  workflow_id=excluded.workflow_id,
  meeting_id=excluded.meeting_id,
  label=excluded.label,
  decision_status=excluded.decision_status,
  button_role=excluded.button_role,
  artifact_ref=excluded.artifact_ref,
  summary=excluded.summary,
  prompt=excluded.prompt,
  payload_json=excluded.payload_json,
  status='active',
  created_by=excluded.created_by,
  updated_at=excluded.updated_at
WHERE human_gate_buttons.human_gate_id=excluded.human_gate_id
  AND human_gate_buttons.status='superseded';`);
    buttons.push({
      buttonId,
      callbackToken,
      humanGateId,
      workflowId,
      meetingId,
      label: option.label,
      decisionStatus: option.decisionStatus,
      role: option.role,
      style: option.style,
      artifactRef: option.artifactRef,
      summary: option.summary,
      prompt: option.prompt,
      payload: option.payload || {},
      callbackData: `tawhg:${callbackToken}`
    });
  }
  return buttons;
}

function humanGateButtonTelegramStyle(button = {}, index = 0) {
  const status = humanGateButtonStatus(button);
  const role = humanGateButtonRole(button);
  if (!humanGateButtonIsControl(button)) {
    return HUMAN_GATE_PLAN_STYLE;
  }
  const style = HUMAN_GATE_CONTROL_STYLES[role] || HUMAN_GATE_CONTROL_STYLES[status] || defaultHumanGateButtonStyle(status);
  return TELEGRAM_BUTTON_STYLES.has(style) ? style : "primary";
}

function humanGateButtonDisplayLabel(button = {}, index = 0) {
  const label = String(button.label || button.title || button.text || `Option ${index + 1}`).trim();
  if (humanGateButtonIsControl(button)) return humanGateTranslatedText(label, 48) || label;
  const fallback = String(index + 1);
  const key = humanGatePlanKey(button, fallback);
  const title = humanGateLocalizedPlanTitle(button, key, 36);
  return `批准方案 ${key}${title ? `：${title}` : ""}`;
}

function humanGateSafeDetailString(value, max = 520, depth = 0) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = parseJsonValue(value, value);
  if (Array.isArray(parsed)) {
    return compactText(parsed.map((item) => humanGateSafeDetailString(item, 180, depth + 1)).filter(Boolean).join("; "), max);
  }
  if (parsed && typeof parsed === "object") {
    if (depth > 3) return compactText("[nested detail omitted]", max);
    const parts = [];
    for (const [key, item] of Object.entries(parsed)) {
      if (HUMAN_GATE_REDACTED_DETAIL_KEY.test(key)) continue;
      const text = humanGateSafeDetailString(item, 180, depth + 1);
      if (text) parts.push(`${key}: ${text}`);
    }
    return compactText(parts.join("; "), max);
  }
  return compactText(parsed, max);
}

function humanGatePayloadSources(button = {}) {
  const payload = parseJsonValue(button.payload, button.payload || {});
  const nestedPayload = parseJsonValue(payload.payload, payload.payload || {});
  const raw = parseJsonValue(payload.raw, payload.raw || {});
  const details = parseJsonValue(payload.details, payload.details || {});
  return [button, payload, nestedPayload, raw, details].filter((source) => source && typeof source === "object");
}

function firstHumanGateDetail(button = {}, keys = [], max = 520) {
  for (const source of humanGatePayloadSources(button)) {
    for (const key of keys) {
      if (source[key] === undefined || source[key] === null || source[key] === "") continue;
      const text = humanGateLocalizedDetail(source[key], max);
      if (text) return text;
    }
  }
  return "";
}

function humanGateButtonDetailLines(button = {}, index = 0) {
  const displayLabel = humanGateButtonDisplayLabel(button, index);
  const lines = [displayLabel];
  const summary = firstHumanGateDetail(button, ["summary", "description", "text", "content"], 700);
  const prompt = firstHumanGateDetail(button, ["prompt", "nextAction", "next_action", "nextStep", "next_step", "execution", "action"], 520);
  const boundary = firstHumanGateDetail(button, ["boundary", "executionBoundary", "execution_boundary", "scope", "constraints", "stopCondition", "stop_condition"], 520);
  const evidence = firstHumanGateDetail(button, ["evidence", "evidenceRefs", "evidence_refs", "receipts", "receipt", "readiness", "runtimeDispatch", "runtime_dispatch", "outboxDelivery", "outbox_delivery"], 620);
  const rollback = firstHumanGateDetail(button, ["rollback", "rollbackPlan", "rollback_plan", "rollbackBoundary", "rollback_boundary", "recovery", "restore", "fallback"], 520);
  const artifact = firstHumanGateDetail(button, ["artifactRef", "artifact_ref", "artifact", "artifactRefs", "artifact_refs", "path"], 420) || humanGateSafeDetailString(button.artifactRef, 420);
  if (summary) lines.push(`  内容：${summary}`);
  if (prompt) lines.push(`  下一步/执行边界：${prompt}`);
  if (boundary) lines.push(`  约束边界：${boundary}`);
  if (evidence) lines.push(`  证据/回执：${evidence}`);
  if (rollback) lines.push(`  回滚/停止：${rollback}`);
  if (artifact) lines.push(`  产物/记录：${artifact}`);
  return lines;
}

function humanGateButtonPresentation(input = {}, buttons = []) {
  if (!buttons.length) return null;
  const text = humanGateTranslatedText(input.text || input.summary || "", 900);
  const webApp = input.webApp || input.web_app || {};
  const contextText = webApp.enabled
    ? "请点击对应按钮，在弹出的审核表单里填写“闪电猫原话/审核意见”，点击发送后 Human Gate 才正式完成并恢复 workflow。"
    : "请先点击按钮锁定选择；随后发送 /hgate 加闪电猫原话或审核意见。原话提交后 Human Gate 才正式完成并恢复 workflow。";
  return {
    title: input.title || "Human Gate 确认",
    tone: "warning",
    policyVersion: HUMAN_GATE_TEXT_POLICY_VERSION,
    blocks: [
      text ? { type: "text", text } : null,
      { type: "context", text: contextText },
      {
        type: "buttons",
        buttons: buttons.map((button, index) => ({
          label: humanGateButtonDisplayLabel(button, index),
          value: button.callbackData,
          style: humanGateButtonTelegramStyle(button, index),
          color: humanGateButtonTelegramStyle(button, index),
          webAppUrl: humanGateWebAppReviewUrl(button.callbackToken || button.callback_token, webApp)
        }))
      }
    ].filter(Boolean)
  };
}

function humanGateButtonFallbackText(input = {}, buttons = []) {
  const text = humanGateTranslatedText(input.text || input.summary || "", 900);
  if (!buttons.length) return text;
  const useWebApp = Boolean((input.webApp || input.web_app || {}).enabled);
  const planButtons = buttons.filter((button) => !humanGateButtonIsControl(button));
  const controlButtons = buttons.filter((button) => humanGateButtonIsControl(button));
  const lines = [
    text,
    "",
    "人工确认决策材料（Human Gate）：",
    ...planButtons.flatMap((button, index) => humanGateButtonDetailLines(button, index)),
    controlButtons.length ? "" : null,
    controlButtons.length ? "工作流控制：": null,
    ...controlButtons.flatMap((button, index) => humanGateButtonDetailLines(button, planButtons.length + index)),
    "",
    useWebApp
      ? "请只点击下方按钮确认选择；Web App 表单会把按钮选择和闪电猫原话绑定到同一个 Human Gate token，不应根据自然语言猜测闪电猫意图。"
      : "请只点击下方按钮确认选择；如 Web App 未配置，系统只接受带 token 的 /hgate 兜底反馈，不应根据自然语言猜测闪电猫意图。"
  ].filter((line) => line !== "" && line !== null);
  return lines.join("\n");
}

async function humanGateTelegramArtifacts(input = {}, buttons = []) {
  const webApp = await humanGateWebAppConfig(input);
  const presentationInput = { ...input, webApp };
  return {
    webApp,
    presentation: humanGateButtonPresentation(presentationInput, buttons),
    telegramReplyMarkup: humanGateWebAppReplyMarkup(buttons, webApp),
    text: humanGateButtonFallbackText(presentationInput, buttons)
  };
}

export async function humanGateRequest(rootDir, input = {}) {
  return HUMAN_GATE_ACTION_HANDLERS.humanGateRequest(rootDir, input);
}

async function catTailPreOrderRiskAuditDispatchSpec(paths, button, feedbackText, selectedAt) {
  if (String(button.decision_status || "").trim() !== "approved") return null;
  const record = await readProtocolObject(paths, button.human_gate_id);
  if (!record || record.object_type !== "human_gate_record") return null;
  const recordPayload = parseJsonValue(record.payload || record.payload_json, {});
  const body = humanGateBody(recordPayload);
  const raw = parseJsonValue(body.raw, body.raw || {});
  const buttonPayload = parseJsonValue(button.payload_json, {});
  const explicitDispatchType = firstText(
    buttonPayload.dispatchType,
    buttonPayload.dispatch_type,
    buttonPayload.nextDispatchType,
    buttonPayload.next_dispatch_type,
    body.dispatchType,
    body.dispatch_type,
    body.nextDispatchType,
    body.next_dispatch_type,
    raw.dispatchType,
    raw.dispatch_type,
    raw.nextDispatchType,
    raw.next_dispatch_type
  );
  const explicitTarget = firstText(
    buttonPayload.targetAgent,
    buttonPayload.target_agent,
    buttonPayload.nextAgent,
    buttonPayload.next_agent,
    body.targetAgent,
    body.target_agent,
    body.nextAgent,
    body.next_agent,
    raw.targetAgent,
    raw.target_agent,
    raw.nextAgent,
    raw.next_agent
  );
  const explicitTargetAgent = String(explicitTarget || "").includes(":")
    ? String(explicitTarget || "").split(":").pop()
    : String(explicitTarget || "");
  if (explicitDispatchType !== "pre_order_risk_audit" || explicitTargetAgent !== "cat_tail") return null;
  const proposalId = firstText(
    buttonPayload.proposalId,
    buttonPayload.proposal_id,
    buttonPayload.tradeProposalId,
    buttonPayload.trade_proposal_id,
    body.proposalId,
    body.proposal_id,
    body.tradeProposalId,
    body.trade_proposal_id,
    raw.proposalId,
    raw.proposal_id,
    raw.tradeProposalId,
    raw.trade_proposal_id,
    record.parent_object_id
  );
  if (!proposalId) return null;
  const preOrderRiskAuditId = firstText(
    buttonPayload.preOrderRiskAuditId,
    buttonPayload.pre_order_risk_audit_id,
    body.preOrderRiskAuditId,
    body.pre_order_risk_audit_id,
    raw.preOrderRiskAuditId,
    raw.pre_order_risk_audit_id,
    `pora.${textHash(`${button.human_gate_id}:${button.button_id}:${proposalId}`).slice(0, 24)}`
  );
  return {
    workflowId: button.workflow_id,
    meetingId: button.meeting_id || button.workflow_id,
    humanGateId: button.human_gate_id,
    buttonId: button.button_id,
    proposalId,
    preOrderRiskAuditId,
    selectedOption: button.label,
    selectedAt,
    flashcatOriginalWords: feedbackText,
    requestPayload: body,
    requestRawPayload: raw,
    buttonPayload
  };
}

async function acquireControlLoopLease(paths, input = {}) {
  const owner = String(input.owner || input.leaseOwner || input.lease_owner || `pid:${process.pid}`).trim();
  const leaseMs = Math.max(10_000, Math.min(600_000, Number(input.leaseMs || input.lease_ms || 120_000)));
  const now = Date.now();
  const leaseFile = path.join(paths.bridgeDir, "control-loop-lease.json");
  const lockDir = path.join(paths.bridgeDir, "control-loop.lock");
  const current = await readOptionalJson(leaseFile);
  const lockedUntil = Date.parse(current?.lockedUntil || "");
  if (current?.owner && Number.isFinite(lockedUntil) && lockedUntil > now) {
    return { acquired: false, owner: current.owner, lockedUntil: current.lockedUntil, leaseFile: relativeTo(paths.root, leaseFile) };
  }
  await fs.mkdir(paths.bridgeDir, { recursive: true });
  try {
    await fs.mkdir(lockDir);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const latest = await readOptionalJson(leaseFile);
    const latestLockedUntil = Date.parse(latest?.lockedUntil || "");
    if (latest?.owner && Number.isFinite(latestLockedUntil) && latestLockedUntil > now) {
      return { acquired: false, owner: latest.owner, lockedUntil: latest.lockedUntil, leaseFile: relativeTo(paths.root, leaseFile) };
    }
    await fs.rm(lockDir, { recursive: true, force: true });
    try {
      await fs.mkdir(lockDir);
    } catch (retryError) {
      if (retryError?.code === "EEXIST") {
        return { acquired: false, owner: latest?.owner || "unknown", lockedUntil: latest?.lockedUntil || "", leaseFile: relativeTo(paths.root, leaseFile) };
      }
      throw retryError;
    }
  }
  const lease = {
    acquired: true,
    owner,
    acquiredAt: nowIso(),
    lockedUntil: new Date(now + leaseMs).toISOString(),
    leaseMs
  };
  await fs.writeFile(leaseFile, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
  return { ...lease, leaseFile: relativeTo(paths.root, leaseFile), lockDir: relativeTo(paths.root, lockDir) };
}

async function releaseControlLoopLease(paths, lease, result = {}) {
  if (!lease?.acquired) return;
  const leaseFile = path.join(paths.bridgeDir, "control-loop-lease.json");
  const lockDir = path.join(paths.bridgeDir, "control-loop.lock");
  const current = await readOptionalJson(leaseFile);
  if (current?.owner !== lease.owner || current?.acquiredAt !== lease.acquiredAt) return;
  await fs.writeFile(leaseFile, `${JSON.stringify({
    owner: lease.owner,
    status: result.status || "idle",
    acquiredAt: lease.acquiredAt,
    releasedAt: nowIso(),
    lockedUntil: nowIso(),
    lastTickId: result.tickId || "",
    lastError: result.error || ""
  }, null, 2)}\n`, "utf8");
  await fs.rm(lockDir, { recursive: true, force: true });
}

async function enqueueControlLoopJob(paths, input = {}) {
  const jobType = String(input.jobType || input.job_type || "").trim();
  if (!jobType) throw new Error("control loop jobType is required");
  const dedupeKey = String(input.dedupeKey || input.dedupe_key || jobType).trim();
  const activeStatuses = [...CONTROL_LOOP_ACTIVE_JOB_STATUSES].map(sqlValue).join(",");
  const existing = await sqlite(paths.dbFile, `
SELECT job_id, job_type, status, attempt, next_run_at
FROM control_loop_jobs
WHERE dedupe_key=${sqlValue(dedupeKey)} AND status IN (${activeStatuses})
LIMIT 1;`, { json: true });
  if (existing[0]) return { jobId: existing[0].job_id, jobType, dedupeKey, status: existing[0].status, deduped: true };
  const cooldownMs = Math.max(0, Number(input.cooldownMs || input.cooldown_ms || 0));
  if (cooldownMs > 0) {
    const cooldownCutoff = new Date(Date.now() - cooldownMs).toISOString();
    const recent = await sqlite(paths.dbFile, `
SELECT job_id, job_type, status, updated_at
FROM control_loop_jobs
WHERE dedupe_key=${sqlValue(dedupeKey)}
  AND status NOT IN (${activeStatuses})
  AND updated_at >= ${sqlValue(cooldownCutoff)}
ORDER BY updated_at DESC
LIMIT 1;`, { json: true });
    if (recent[0]) {
      return {
        jobId: recent[0].job_id,
        jobType,
        dedupeKey,
        status: recent[0].status,
        deduped: true,
        skipped: true,
        reason: "cooldown",
        cooldownMs,
        recentUpdatedAt: recent[0].updated_at
      };
    }
  }
  const jobId = input.jobId || input.job_id || safeId("ctljob");
  const createdAt = nowIso();
  const payload = parseJsonValue(input.payload, input.payload || {});
  await sqlite(paths.dbFile, `
INSERT INTO control_loop_jobs(job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json, attempt, max_attempts, next_run_at, created_at, updated_at)
VALUES (${sqlValue(jobId)}, ${sqlValue(jobType)}, ${sqlValue(dedupeKey)}, ${sqlValue(input.priority || "normal")}, 'queued', ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.runtime || "")}, ${sqlValue(JSON.stringify(payload))}, '{}', 0, ${sqlValue(Number(input.maxAttempts || input.max_attempts || 20))}, ${sqlValue(input.nextRunAt || input.next_run_at || createdAt)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  return { jobId, jobType, dedupeKey, status: "queued", deduped: false };
}

export const INCIDENT_ACTION_HANDLERS = createIncidentActionHandlers({
  appendWorkflowEvent,
  auditHumanGatePlanDetails,
  auditHumanGatePlanOptions,
  auditHumanGatePrimaryLanguage,
  canonicalWorkflowAction,
  cleanFileSegment,
  combineHumanGateAudits,
  ensureWorkflowLayout,
  firstText,
  humanGateButtonIsControl,
  humanGateButtonOptions,
  humanGateButtonRole,
  humanGatePlanOptionButtons,
  humanGateRequest,
  humanGateWebAppConfig,
  nowIso,
  parseJsonValue,
  permissionEvidencePresent,
  redactSensitiveForPersistence,
  redactSensitiveTextForPersistence,
  renderIncidentMarkdown,
  safeId,
  textHash,
  toList,
  writeJsonArtifact,
  writeTextArtifact,
  WorkflowReadModel,
  HUMAN_GATE_APPROVE_OPTION_MAX,
  HUMAN_GATE_APPROVE_OPTION_MIN,
  INCIDENT_MODES,
  INCIDENT_STATUSES
});

export const INCIDENT_ACTION_REGISTRY = createIncidentActionRegistry(INCIDENT_ACTION_HANDLERS);

export const {
  incidentState,
  workflowIncidentFromDeadLetterPreview,
  workflowIncidentFromDeadLetter,
  workflowIncidentCloseoutPreview,
  workflowIncidentCloseoutWorklistPreview,
  workflowIncidentCloseoutWorklistArtifactPreview,
  workflowIncidentCloseoutWorklistArtifact,
  workflowIncidentCloseoutEvidencePreview,
  workflowIncidentCloseoutEvidence,
  workflowIncidentCloseoutArtifactPreview,
  workflowIncidentCloseoutArtifact,
  workflowIncidentCloseoutHumanGateRequestPreview,
  workflowIncidentCloseoutHumanGateRequest
} = INCIDENT_ACTION_HANDLERS;

export const INTERVENTION_ACTION_HANDLERS = createInterventionActionHandlers({
  appendWorkflowEvent,
  canonicalWorkflowAction,
  ensureWorkflowLayout,
  nowIso,
  pendingHumanGateCount
});

export const INTERVENTION_ACTION_REGISTRY = createInterventionActionRegistry(INTERVENTION_ACTION_HANDLERS);

export const {
  workflowInterventionPreview,
  workflowInterventionExecute
} = INTERVENTION_ACTION_HANDLERS;

export const CAT_CLAW_ACTION_HANDLERS = createCatClawActionHandlers({
  dailyKey,
  ensureWorkflowLayout
});

export const CAT_CLAW_ACTION_REGISTRY = createCatClawActionRegistry(CAT_CLAW_ACTION_HANDLERS);

export const {
  cat_clawAudit
} = CAT_CLAW_ACTION_HANDLERS;

export const TOPOLOGY_ACTION_HANDLERS = createTopologyActionHandlers({
  ensureWorkflowLayout,
  jsonHash,
  loadHermersProfileModes,
  nowIso,
  profileModeEvidenceForRow,
  registrySnapshot,
  workflowPaths,
  writeJsonAtomic,
  RETIRED_RUNTIME_AGENT_STATUSES,
  WORKFLOW_SCHEMA_VERSION
});

export const TOPOLOGY_ACTION_REGISTRY = createTopologyActionRegistry(TOPOLOGY_ACTION_HANDLERS);

export const {
  workflowRuntimeAgents,
  workflowTopology
} = TOPOLOGY_ACTION_HANDLERS;

export const STATUS_ACTION_HANDLERS = createStatusActionHandlers({
  activeReadinessChecks,
  ensureWorkflowLayout,
  loadHermersProfileModes,
  profileModesReadinessPayload,
  readInstrument,
  WORKFLOW_SCHEMA_VERSION
});

export const STATUS_ACTION_REGISTRY = createStatusActionRegistry(STATUS_ACTION_HANDLERS);

export const {
  workflowHealth,
  workflowHealthSnapshot,
  workflowInit,
  workflowReadiness,
  workflowReadinessSnapshot,
  workflowStatus
} = STATUS_ACTION_HANDLERS;

export const PERMISSION_ACTION_HANDLERS = createPermissionActionHandlers({
  ensureWorkflowLayout,
  evaluateWorkflowPermission
});

export const PERMISSION_ACTION_REGISTRY = createPermissionActionRegistry(PERMISSION_ACTION_HANDLERS);

export const {
  workflowPermissionCheck
} = PERMISSION_ACTION_HANDLERS;

const SCHEDULE_ACTION_HANDLERS_INTERNAL = createScheduleActionHandlers({
  enqueueControlLoopJob,
  ensureWorkflowLayout,
  meetingDispatch: (...args) => meetingDispatch(...args),
  normalizeAgentId,
  normalizeRuntime
});

const {
  runScheduledDispatchJob,
  seedDueScheduleJobs,
  workflowScheduleDisable,
  workflowScheduleList,
  workflowSchedulePause,
  workflowScheduleResume,
  workflowScheduleUpsert
} = SCHEDULE_ACTION_HANDLERS_INTERNAL;

export const SCHEDULE_ACTION_HANDLERS = {
  workflowScheduleDisable,
  workflowScheduleList,
  workflowSchedulePause,
  workflowScheduleResume,
  workflowScheduleUpsert
};

export const SCHEDULE_ACTION_REGISTRY = createScheduleActionRegistry(SCHEDULE_ACTION_HANDLERS);

export {
  workflowScheduleDisable,
  workflowScheduleList,
  workflowSchedulePause,
  workflowScheduleResume,
  workflowScheduleUpsert
};

export const EVENT_ACTION_HANDLERS = createEventActionHandlers({
  ensureWorkflowLayout
});

export const EVENT_ACTION_REGISTRY = createEventActionRegistry(EVENT_ACTION_HANDLERS);

export const {
  workflowEventAppend,
  workflowEventList,
  workflowEventTimeline
} = EVENT_ACTION_HANDLERS;

export const RUNTIME_EVENT_ACTION_HANDLERS = createRuntimeEventActionHandlers({
  ensureWorkflowLayout
});

export const RUNTIME_EVENT_ACTION_REGISTRY = createRuntimeEventActionRegistry(RUNTIME_EVENT_ACTION_HANDLERS);

export const {
  workflowRuntimeCurrentState,
  workflowRuntimeEventList,
  workflowRuntimeEventRecord
} = RUNTIME_EVENT_ACTION_HANDLERS;

export const RUNTIME_AGENT_ACTION_HANDLERS = createRuntimeAgentActionHandlers({
  ensureWorkflowLayout,
  normalizeAgentId,
  normalizeAgentPlatform,
  normalizeExecutionAdapter,
  normalizeExecutionIdentity,
  normalizeImIdentity,
  normalizeImIngressAdapter,
  normalizeImIngressOwner,
  normalizeReturnPolicy,
  normalizeRuntime,
  normalizeWorkflowIngressAdapter,
  nowIso,
  registrySnapshot,
  workflowRuntimeAgents
});

export const RUNTIME_AGENT_ACTION_REGISTRY = createRuntimeAgentActionRegistry(RUNTIME_AGENT_ACTION_HANDLERS);

export const {
  ensureRuntimeAgent,
  runtimeAgentUpsert
} = RUNTIME_AGENT_ACTION_HANDLERS;

export const MEETING_PARTICIPANT_ACTION_HANDLERS = createMeetingParticipantActionHandlers({
  appendJsonl,
  ensureWorkflowLayout,
  findActiveRuntimeAgent,
  normalizeAgentId,
  normalizeMeetingRef,
  normalizeRuntime,
  nowIso
});

export const MEETING_PARTICIPANT_ACTION_REGISTRY = createMeetingParticipantActionRegistry(MEETING_PARTICIPANT_ACTION_HANDLERS);

export const {
  meetingRuntimeParticipant
} = MEETING_PARTICIPANT_ACTION_HANDLERS;

export const RESEARCH_ACTION_HANDLERS = createResearchActionHandlers({
  clampScore,
  cleanFileSegment,
  dailyKey,
  ensureWorkflowLayout,
  nowIso,
  relativeTo,
  renderThesisMarkdown,
  safeId,
  toList,
  upsertInstrumentRecord,
  GATE_STATUSES,
  RADAR_ZONES,
  THESIS_STATUSES
});

export const RESEARCH_ACTION_REGISTRY = createResearchActionRegistry(RESEARCH_ACTION_HANDLERS);

export const {
  gateReview,
  instrumentUpsert,
  radarUpdate,
  researchEvidence,
  researchMemo,
  thesisUpdate
} = RESEARCH_ACTION_HANDLERS;

export const MEETING_INGEST_ACTION_HANDLERS = createMeetingIngestActionHandlers({
  appendJsonl,
  appendTranscript,
  cleanFileSegment,
  enqueueTelegramOutbox,
  ensureRuntimeAgent,
  ensureWorkflowLayout,
  normalizeAgentId,
  normalizeMeetingRef,
  normalizeRuntime,
  nowIso,
  safeId,
  telegramLinkFor,
  DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
  REPORT_MESSAGE_TYPES
});

export const MEETING_INGEST_ACTION_REGISTRY = createMeetingIngestActionRegistry(MEETING_INGEST_ACTION_HANDLERS);

export const {
  meetingIngest
} = MEETING_INGEST_ACTION_HANDLERS;

export const MEETING_DISPATCH_ACTION_HANDLERS = createMeetingDispatchActionHandlers({
  appendWorkflowEvent,
  createDispatchMessageFlow,
  ensureRuntimeAgent,
  ensureWorkflowLayout,
  normalizeAgentId,
  normalizeMeetingRef,
  normalizeRuntime,
  nowIso,
  resolveRegisteredDispatchTarget,
  routeShellIngest: (...args) => routeShellIngest(...args),
  writeJsonArtifact,
  DISPATCH_STATUSES
});

export const MEETING_DISPATCH_ACTION_REGISTRY = createMeetingDispatchActionRegistry(MEETING_DISPATCH_ACTION_HANDLERS);

export const {
  meetingDispatch
} = MEETING_DISPATCH_ACTION_HANDLERS;

export const MEETING_CONTROL_ACTION_HANDLERS = createMeetingControlActionHandlers({
  appendTranscript,
  ensureWorkflowLayout,
  meetingDispatch,
  normalizeMeetingRef,
  nowIso,
  safeId,
  toList
});

export const MEETING_CONTROL_ACTION_REGISTRY = createMeetingControlActionRegistry(MEETING_CONTROL_ACTION_HANDLERS);

export const {
  meetingResume,
  meetingDisperse
} = MEETING_CONTROL_ACTION_HANDLERS;

export const ROUTE_SHELL_ACTION_HANDLERS = createRouteShellActionHandlers({
  canRouteToRegisteredInstance,
  cleanFileSegment,
  createMessageFlow,
  ensureWorkflowLayout,
  findActiveRegisteredAgentInstances,
  isRouteShellIngress,
  isRouteShellOnlyRow,
  meetingDispatch,
  meetingIngest,
  messageFlowIdFromParts,
  messageFlowSourceChannel,
  normalizeAgentId,
  normalizeAgentPlatform,
  normalizeMeetingRef,
  normalizeReturnPolicy,
  normalizeRuntime,
  normalizeWorkflowIngressAdapter,
  nowIso,
  readMessageFlow,
  registrySnapshot,
  runtimeBridgeDrain: (...args) => runtimeBridgeDrain(...args),
  sortRegisteredTargets,
  updateMessageFlow
});

export const ROUTE_SHELL_ACTION_REGISTRY = createRouteShellActionRegistry(ROUTE_SHELL_ACTION_HANDLERS);

export const {
  routeShellIngest
} = ROUTE_SHELL_ACTION_HANDLERS;

export const RUNTIME_BRIDGE_ACTION_HANDLERS = createRuntimeBridgeActionHandlers({
  appendWorkflowEvent,
  claimQueuedDispatch,
  classifyHermersProfileAdmission,
  ensureWorkflowLayout,
  failRuntimeBridgeInvalidDispatch,
  failRuntimeBridgeRegistryDispatch,
  loadHermersProfileModes,
  normalizeRuntime,
  normalizeWorkflowIngressAdapter,
  nowIso,
  profileModesReadinessPayload,
  recordRuntimeBridgeFailureState,
  routeShellIngest,
  runHermesAcpDispatch,
  runHermesDispatch,
  runLocalCodexDispatch,
  runOpenClawDispatch,
  updateDispatch,
  validateRuntimeBridgeRegistryRow,
  validateRuntimeBridgeTaskPayload
});

export const RUNTIME_BRIDGE_ACTION_REGISTRY = createRuntimeBridgeActionRegistry(RUNTIME_BRIDGE_ACTION_HANDLERS);

export const {
  runtimeBridgeDrain
} = RUNTIME_BRIDGE_ACTION_HANDLERS;

export const DISPATCH_RECONCILE_ACTION_HANDLERS = createDispatchReconcileActionHandlers({
  controlLoopTimeoutSeconds,
  ensureWorkflowLayout,
  finishMessageFlowRuntime,
  messageFlowForDispatch,
  nextRetryAt,
  nowIso,
  recordRuntimeBridgeFailureState,
  recordRuntimeBridgeSemanticEvent,
  recordRuntimeRun,
  runtimeAckContract,
  syncMessageFlowFromTerminalDispatchReceipt,
  updateDispatch
});

export const DISPATCH_RECONCILE_ACTION_REGISTRY = createDispatchReconcileActionRegistry(DISPATCH_RECONCILE_ACTION_HANDLERS);

export const {
  staleDispatchReconcile
} = DISPATCH_RECONCILE_ACTION_HANDLERS;

export const MESSAGE_FLOW_ACTION_HANDLERS = createMessageFlowActionHandlers({
  appendMessageFlowEvent,
  cleanFileSegment,
  createMessageFlow,
  ensureWorkflowLayout,
  incidentState,
  meetingDispatch,
  meetingIngest,
  messageFlowAckTimeoutSeconds,
  messageFlowIdFromParts,
  messageFlowSendPrompt,
  messageFlowSendTargets,
  normalizeAgentId,
  normalizeMeetingRef,
  normalizeReturnPolicy,
  normalizeRuntime,
  nowIso,
  readMessageFlow,
  recoverAckedMessageFlowSemanticContinuations,
  updateMessageFlowFromTelegramDelivery,
  DEFAULT_RUNTIME_ACK_RETRY_SECONDS,
  DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS,
  MESSAGE_FLOW_DELIVERY_RETURN_POLICIES
});

export const MESSAGE_FLOW_ACTION_REGISTRY = createMessageFlowActionRegistry(MESSAGE_FLOW_ACTION_HANDLERS);

export const {
  messageFlowList,
  messageFlowSend,
  messageFlowReconcile
} = MESSAGE_FLOW_ACTION_HANDLERS;

export const TELEGRAM_LIVE_ACTION_HANDLERS = createTelegramLiveActionHandlers({
  ensureWorkflowLayout,
  normalizeMeetingRef,
  nowIso,
  resolveTelegramLiveTarget
});

export const TELEGRAM_LIVE_ACTION_REGISTRY = createTelegramLiveActionRegistry(TELEGRAM_LIVE_ACTION_HANDLERS);

export const {
  telegramLiveConfigure
} = TELEGRAM_LIVE_ACTION_HANDLERS;

export const TELEGRAM_OUTBOX_ACTION_HANDLERS = createTelegramOutboxActionHandlers({
  appendWorkflowEvent,
  ensureWorkflowLayout,
  humanGatePlanOptionButtons,
  nowIso,
  resolveTelegramBotToken,
  updateMessageFlowFromTelegramDelivery,
  writeJsonArtifact,
  HUMAN_GATE_APPROVE_OPTION_MAX,
  HUMAN_GATE_APPROVE_OPTION_MIN,
  TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES,
  TELEGRAM_OUTBOX_DELIVERY_LEASE_MS
});

export const TELEGRAM_OUTBOX_ACTION_REGISTRY = createTelegramOutboxActionRegistry(TELEGRAM_OUTBOX_ACTION_HANDLERS);

export const {
  autoDeliverReportOutbox,
  deliverTelegramOutboxRow,
  telegramOutboxDeliveryPreview,
  telegramOutboxRequeuePreview,
  telegramOutboxRequeueExecutionPackagePreview,
  telegramOutboxDelivery,
  telegramOutbox
} = TELEGRAM_OUTBOX_ACTION_HANDLERS;

export const HUMAN_GATE_ACTION_HANDLERS = createHumanGateActionHandlers({
  auditHumanGatePlanDetails,
  auditHumanGatePrimaryLanguage,
  appendWorkflowEvent,
  boolOption,
  catTailPreOrderRiskAuditDispatchSpec,
  cleanFileSegment,
  createHumanGateButtons,
  dailyKey,
  deliverTelegramOutboxRow,
  enqueueTelegramOutbox,
  ensureWorkflowLayout,
  firstText,
  humanGateButtonDisplayLabel,
  humanGateButtonSpecs,
  humanGateButtonTelegramStyle,
  humanGateTelegramArtifacts,
  humanGateWebAppConfig,
  incidentState,
  normalizeMeetingRef,
  normalizeRequester,
  nowIso,
  pendingHumanGateForStage,
  protocolRecord: (...args) => protocolRecord(...args),
  relativeTo,
  resolveTelegramBotToken,
  safeId,
  safeMeetingDispatchWithRetry,
  sqliteChangeCount,
  meetingResume,
  supersedeHumanGateRecord,
  telegramLinkFor,
  textHash,
  verifyTelegramWebAppInitData,
  workflowCheckpoint,
  writeJsonArtifact,
  writeTextArtifact,
  DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
  HUMAN_GATE_STATUSES,
  HUMAN_GATE_TEXT_POLICY_VERSION,
  INTERNAL_HUMAN_GATE_RECORD
});

export const HUMAN_GATE_ACTION_REGISTRY = createHumanGateActionRegistry(HUMAN_GATE_ACTION_HANDLERS);

export const {
  humanGateButtonCallback,
  humanGateFeedback,
  humanGateInbox,
  humanGateResume,
  humanGateWebAppReview,
  humanGateWebAppSubmit,
  workflowHumanGateRecord
} = HUMAN_GATE_ACTION_HANDLERS;

export const CONTROL_LOOP_TICK_ACTION_HANDLERS = createControlLoopTickActionHandlers({
  acquireControlLoopLease,
  appendJsonl,
  ensurePendingHumanGateRequests,
  ensureWorkflowLayout,
  enqueueControlLoopJob,
  humanGateInbox,
  maybeRunWorkflowRetention,
  meetingDispatch,
  messageFlowReconcile,
  normalizeAgentId,
  normalizeKnownRuntime,
  normalizeRuntime,
  nowIso,
  releaseControlLoopLease,
  runScheduledDispatchJob,
  runtimeBridgeDrain,
  seedDueScheduleJobs,
  staleDispatchReconcile,
  telegramOutbox,
  workflowReadinessSnapshot,
  workflowSupervisor,
  CONTROL_LOOP_ACTIVE_JOB_STATUSES,
  CONTROL_LOOP_WORKFLOW_STATUSES,
  DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
  MESSAGE_FLOW_DELIVERY_RETURN_POLICIES,
  RUNTIMES,
  TELEGRAM_OUTBOX_DELIVERY_LEASE_MS,
  WORKFLOW_RUN_STATUSES
});

export const CONTROL_LOOP_TICK_ACTION_REGISTRY = createControlLoopTickActionRegistry(CONTROL_LOOP_TICK_ACTION_HANDLERS);

export const {
  workflowControlLoopTick
} = CONTROL_LOOP_TICK_ACTION_HANDLERS;

export const PROTOCOL_ACTION_HANDLERS = createProtocolActionHandlers({
  ensureWorkflowLayout,
  jsonHash,
  nowIso,
  parseJsonValue,
  redactSensitiveForPersistence,
  safeId,
  upsertInstrumentRecord,
  writeJsonArtifact,
  INTERNAL_HUMAN_GATE_RECORD,
  PROTOCOL_OBJECT_TYPES
});

export const PROTOCOL_ACTION_REGISTRY = createProtocolActionRegistry(PROTOCOL_ACTION_HANDLERS);

export const {
  protocolRecord
} = PROTOCOL_ACTION_HANDLERS;

export const TRADE_ACTION_HANDLERS = createTradeActionHandlers({
  ensureWorkflowLayout,
  findCatTailPreOrderRiskAuditDispatch,
  protocolObjectReferences,
  protocolPayloadField,
  protocolPayloadValue,
  protocolRecord,
  readProtocolObject,
  upsertInstrumentRecord,
  writeJsonArtifact
});

export const TRADE_ACTION_REGISTRY = createTradeActionRegistry(TRADE_ACTION_HANDLERS);

export const {
  riskDecision,
  tradeIntent,
  tradeProposal,
  tradingCoreReceipt
} = TRADE_ACTION_HANDLERS;

export const SIDE_EFFECT_ACTION_HANDLERS = createSideEffectActionHandlers({
  appendWorkflowEvent,
  ensureWorkflowLayout,
  jsonHash,
  nowIso,
  parseJsonValue,
  redactSensitiveForPersistence,
  safeId
});

export const SIDE_EFFECT_ACTION_REGISTRY = createSideEffectActionRegistry(SIDE_EFFECT_ACTION_HANDLERS);

export const {
  sideEffectRecord
} = SIDE_EFFECT_ACTION_HANDLERS;

export const WORKFLOW_V2_ACTION_REGISTRY = createWorkflowV2ActionRegistry({
  workflowV2PlanPreview,
  workflowV2PlanCreate,
  workflowV2InfoStackPreview,
  workflowV2InfoStackRecord,
  workflowV2InfoStackRead,
  workflowV2ReadReceiptRecord,
  workflowV2NotificationPreview,
  workflowV2WorkerBackendPreflight,
  workflowV2WorkerBackendPreflightRecord,
  workflowV2WorkerSpawnPreview,
  workflowV2WorkerSpawnCreate,
  workflowV2WorkerLifecyclePreview,
  workflowV2WorkerHandoffPreview,
  workflowV2WorkerHandoffRecord,
  workflowV2WorkerRetirePreview,
  workflowV2WorkerRetireRecord,
  workflowV2WorkerSuccessorPreview,
  workflowV2WorkerSuccessorCreate,
  workflowV2ControlLoopPreview,
  workflowV2ControlLoopTick,
  workflowV2WorkerAdapterJobPreview,
  workflowV2WorkerAdapterJobRecord,
  workflowV2WorkerAdapterJobList,
  workflowV2WorkerAdapterJobClaim,
  workflowV2WorkerAdapterJobHeartbeat,
  workflowV2WorkerAdapterJobRelease,
  workflowV2WorkerAdapterJobFail,
  workflowV2AdapterRunnerPreview,
  workflowV2AdapterRunnerDrain,
  workflowV2WorkerResultSubmitPreview,
  workflowV2WorkerResultSubmit,
  workflowV2WorkerResultFailPreview,
  workflowV2WorkerResultFail,
  workflowV2ManagerReviewRecord,
  workflowV2OwnerReviewPreview,
  workflowV2OwnerReviewRecord,
  workflowV2TaskGroupPackagePreview,
  workflowV2TaskGroupPackageRecord,
  workflowV2CatBrainAuditPreview,
  workflowV2CatBrainAuditRecord,
  workflowV2CatClawAuditPreview,
  workflowV2CatClawAuditRecord,
  workflowV2HumanGatePackagePreview,
  workflowV2HumanGatePackageRecord,
  workflowV2HumanGateRequestPreview,
  workflowV2HumanGateRequest,
  workflowV2Validate,
  workflowTemplatePreview,
  workflowTemplateRecordCandidate,
  workflowTemplateSearch,
  workflowTemplateGet,
  workflowTemplateInstantiatePreview,
  workflowTemplateInstantiateRecord,
  workflowTemplateEvalPreview,
  workflowTemplateEvalRecord,
  workflowTemplateStatsRefresh,
  workflowTemplatePromotePreview,
  workflowTemplatePromoteRecord,
  workflowTemplateRollbackPreview,
  workflowTemplateRollbackRecord,
  workflowTemplateExtractPreview,
  workflowTemplateExtractRecord
});

export async function runWorkflowAction(rootDir, input = {}) {
  const requestedAction = String(input.action || "workflow.status");
  const action = canonicalWorkflowAction(requestedAction);
  const permissionDecision = await authorizeWorkflowAction(rootDir, input);
  const convergenceGate = await workflowConvergenceGate(rootDir, action, requestedAction, input);
  if (convergenceGate) return convergenceGate;
  const workflowV2Result = await runWorkflowV2Action(WORKFLOW_V2_ACTION_REGISTRY, action, rootDir, input, permissionDecision);
  if (workflowV2Result.handled) return workflowV2Result.value;
  const messageFlowResult = await runMessageFlowAction(MESSAGE_FLOW_ACTION_REGISTRY, action, rootDir, input);
  if (messageFlowResult.handled) return messageFlowResult.value;
  const telegramLiveResult = await runTelegramLiveAction(TELEGRAM_LIVE_ACTION_REGISTRY, action, rootDir, input);
  if (telegramLiveResult.handled) return telegramLiveResult.value;
  const telegramOutboxResult = await runTelegramOutboxAction(TELEGRAM_OUTBOX_ACTION_REGISTRY, action, rootDir, input);
  if (telegramOutboxResult.handled) return telegramOutboxResult.value;
  const humanGateResult = await runHumanGateAction(HUMAN_GATE_ACTION_REGISTRY, action, rootDir, input);
  if (humanGateResult.handled) return humanGateResult.value;
  const protocolResult = await runProtocolAction(PROTOCOL_ACTION_REGISTRY, action, rootDir, input);
  if (protocolResult.handled) return protocolResult.value;
  const tradeResult = await runTradeAction(TRADE_ACTION_REGISTRY, action, rootDir, input);
  if (tradeResult.handled) return tradeResult.value;
  const sideEffectResult = await runSideEffectAction(SIDE_EFFECT_ACTION_REGISTRY, action, rootDir, input);
  if (sideEffectResult.handled) return sideEffectResult.value;
  const incidentResult = await runIncidentAction(INCIDENT_ACTION_REGISTRY, action, rootDir, input, permissionDecision);
  if (incidentResult.handled) return incidentResult.value;
  const interventionResult = await runInterventionAction(INTERVENTION_ACTION_REGISTRY, action, rootDir, input, permissionDecision);
  if (interventionResult.handled) return interventionResult.value;
  const researchResult = await runResearchAction(RESEARCH_ACTION_REGISTRY, action, rootDir, input);
  if (researchResult.handled) return researchResult.value;
  const catClawResult = await runCatClawAction(CAT_CLAW_ACTION_REGISTRY, action, rootDir, input);
  if (catClawResult.handled) return catClawResult.value;
  const topologyResult = await runTopologyAction(TOPOLOGY_ACTION_REGISTRY, action, rootDir, input);
  if (topologyResult.handled) return topologyResult.value;
  const runtimeAgentResult = await runRuntimeAgentAction(RUNTIME_AGENT_ACTION_REGISTRY, action, rootDir, input);
  if (runtimeAgentResult.handled) return runtimeAgentResult.value;
  const meetingParticipantResult = await runMeetingParticipantAction(MEETING_PARTICIPANT_ACTION_REGISTRY, action, rootDir, input);
  if (meetingParticipantResult.handled) return meetingParticipantResult.value;
  const meetingIngestResult = await runMeetingIngestAction(MEETING_INGEST_ACTION_REGISTRY, action, rootDir, input);
  if (meetingIngestResult.handled) return meetingIngestResult.value;
  const meetingDispatchResult = await runMeetingDispatchAction(MEETING_DISPATCH_ACTION_REGISTRY, action, rootDir, input);
  if (meetingDispatchResult.handled) return meetingDispatchResult.value;
  const meetingControlResult = await runMeetingControlAction(MEETING_CONTROL_ACTION_REGISTRY, action, rootDir, input);
  if (meetingControlResult.handled) return meetingControlResult.value;
  const routeShellResult = await runRouteShellAction(ROUTE_SHELL_ACTION_REGISTRY, action, rootDir, input);
  if (routeShellResult.handled) return routeShellResult.value;
  const dispatchReconcileResult = await runDispatchReconcileAction(DISPATCH_RECONCILE_ACTION_REGISTRY, action, rootDir, input);
  if (dispatchReconcileResult.handled) return dispatchReconcileResult.value;
  const statusResult = await runStatusAction(STATUS_ACTION_REGISTRY, action, rootDir, input);
  if (statusResult.handled) return statusResult.value;
  const permissionResult = await runPermissionAction(PERMISSION_ACTION_REGISTRY, action, rootDir, input);
  if (permissionResult.handled) return permissionResult.value;
  const scheduleResult = await runScheduleAction(SCHEDULE_ACTION_REGISTRY, action, rootDir, input);
  if (scheduleResult.handled) return scheduleResult.value;
  const eventResult = await runEventAction(EVENT_ACTION_REGISTRY, action, rootDir, input);
  if (eventResult.handled) return eventResult.value;
  const runtimeEventResult = await runRuntimeEventAction(RUNTIME_EVENT_ACTION_REGISTRY, action, rootDir, input);
  if (runtimeEventResult.handled) return runtimeEventResult.value;
  const sessionResult = await runSessionAction(SESSION_ACTION_REGISTRY, action, rootDir, input);
  if (sessionResult.handled) return sessionResult.value;
  const checkpointResult = await runCheckpointAction(CHECKPOINT_ACTION_REGISTRY, action, rootDir, input);
  if (checkpointResult.handled) return checkpointResult.value;
  const controlLoopJobResult = await runControlLoopJobAction(CONTROL_LOOP_JOB_ACTION_REGISTRY, action, rootDir, input, permissionDecision);
  if (controlLoopJobResult.handled) return controlLoopJobResult.value;
  const verificationResult = await runVerificationAction(VERIFICATION_ACTION_REGISTRY, action, rootDir, input, permissionDecision);
  if (verificationResult.handled) return verificationResult.value;
  const workflowRunResult = await runWorkflowRunAction(WORKFLOW_RUN_ACTION_REGISTRY, action, rootDir, input, permissionDecision);
  if (workflowRunResult.handled) return workflowRunResult.value;
  const workflowTaskResult = await runWorkflowTaskAction(WORKFLOW_TASK_ACTION_REGISTRY, action, rootDir, input);
  if (workflowTaskResult.handled) return workflowTaskResult.value;
  const workflowTaskDraftResult = await runWorkflowTaskDraftAction(WORKFLOW_TASK_DRAFT_ACTION_REGISTRY, action, rootDir, input);
  if (workflowTaskDraftResult.handled) return workflowTaskDraftResult.value;
  const workflowTaskLaunchResult = await runWorkflowTaskLaunchAction(WORKFLOW_TASK_LAUNCH_ACTION_REGISTRY, action, rootDir, input);
  if (workflowTaskLaunchResult.handled) return workflowTaskLaunchResult.value;
  const workflowSwarmResult = await runWorkflowSwarmAction(WORKFLOW_SWARM_ACTION_REGISTRY, action, rootDir, input);
  if (workflowSwarmResult.handled) return workflowSwarmResult.value;
  const workflowAdvanceResult = await runWorkflowAdvanceAction(WORKFLOW_ADVANCE_ACTION_REGISTRY, action, rootDir, input);
  if (workflowAdvanceResult.handled) return workflowAdvanceResult.value;
  const workflowSupervisorResult = await runWorkflowSupervisorAction(WORKFLOW_SUPERVISOR_ACTION_REGISTRY, action, rootDir, input);
  if (workflowSupervisorResult.handled) return workflowSupervisorResult.value;
  const controlLoopTickResult = await runControlLoopTickAction(CONTROL_LOOP_TICK_ACTION_REGISTRY, action, rootDir, input);
  if (controlLoopTickResult.handled) return controlLoopTickResult.value;
  const runtimeBridgeResult = await runRuntimeBridgeAction(RUNTIME_BRIDGE_ACTION_REGISTRY, action, rootDir, input);
  if (runtimeBridgeResult.handled) return runtimeBridgeResult.value;
  throw new Error(`unknown workflow action: ${requestedAction}${requestedAction === action ? "" : ` (canonical: ${action})`}`);
}
