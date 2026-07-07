import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import tls from "node:tls";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { WorkflowReadModel } from "./console/read-model.js";
import { DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS } from "./control-loop-budget.js";
import { createWorkflowV2ActionRegistry, runWorkflowV2Action } from "./workflow-v2/index.js";
import {
  WORKFLOW_V2_ADAPTER_JOB_STATUSES,
  WORKFLOW_V2_CONTENT_STORAGES,
  WORKFLOW_V2_INFO_CLASSIFICATIONS,
  WORKFLOW_V2_MAX_CONCURRENT_WORKERS,
  WORKFLOW_V2_NODE_STATUSES,
  WORKFLOW_V2_NOTIFICATION_CHANNELS,
  WORKFLOW_V2_NOTIFICATION_PAYLOAD_MODES,
  WORKFLOW_V2_ORCHESTRATION_PATTERNS,
  WORKFLOW_V2_PLAN_STATUSES,
  WORKFLOW_V2_SENSITIVE_CLASSIFICATIONS,
  WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
  WORKFLOW_V2_WORKER_HANDOFF_STATUSES,
  WORKFLOW_V2_WORKER_PATTERNS,
  WORKFLOW_V2_WORKER_RUN_STATUSES,
  WORKFLOW_V2_WORKFLOW_STATES
} from "./workflow-v2/constants.js";
import {
  workflowV2AdapterJobSummary,
  workflowV2ErrorMessage,
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2NormalizeBackend,
  workflowV2NormalizeEnum,
  workflowV2OptionalNonNegativeInt,
  workflowV2PlanSummary,
  workflowV2UniqueTextArray,
  workflowV2UniqueTextList,
  workflowV2ValidationAdvisory,
  workflowV2ValidationError,
  workflowV2WorkerRunSummary
} from "./workflow-v2/helpers.js";
import {
  workflowV2PlanNodeHardGateErrors,
  workflowV2PlanOrchestrationContract
} from "./workflow-v2/plan.js";
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
  createMessageFlowActionHandlers,
  createMessageFlowActionRegistry,
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
  createHumanGateActionHandlers,
  createHumanGateActionRegistry,
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
  isTerminalWorkflowSessionRunStatus,
  requireWorkflowSessionRunStatus,
  runSessionAction,
  sessionJsonObject,
  sessionPackFromRow,
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
  fileExistsSync,
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
const MESSAGE_FLOW_STATUSES = new Set(["inbound_received", "route_registered", "runtime_dispatched", "runtime_acknowledged", "semantic_dispatched", "runtime_completed", "runtime_failed", "outbound_queued", "telegram_sent", "telegram_failed"]);
const MESSAGE_FLOW_RETURN_POLICIES = new Set(["reply_to_source_chat", "report_to_flashcat", "silent"]);
const MESSAGE_FLOW_DELIVERY_RETURN_POLICIES = new Set(["reply_to_source_chat", "report_to_flashcat"]);
const WORKFLOW_RUN_STATUSES = new Set(["active", "waiting_human", "blocked", "paused", "completed", "stopped", "cancelled"]);
const WORKFLOW_TASK_STATUSES = new Set(["pending", "in_progress", "done", "blocked", "failed", "cancelled"]);
const WORKFLOW_TASK_PRIORITIES = new Set(["flash", "steer", "high", "normal", "low"]);
const RETIRED_RUNTIME_AGENT_STATUSES = new Set(["retired", "archived"]);
const INCIDENT_STATUSES = new Set(["active", "mitigating", "monitoring", "resolved", "cancelled"]);
const INCIDENT_MODES = new Set(["normal", "degraded", "critical-only", "paper-only", "frozen"]);
const AUTO_RETRY_FAILURE_TYPES = new Set(["provider_timeout", "runtime_timeout", "acp_unavailable", "transient_runtime", "ack_contract_violation"]);
const DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS = 90;
const DEFAULT_RUNTIME_ACK_RETRY_SECONDS = 30;
const DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS = 3;
const TEST_SEMANTIC_CONTINUATION_FAILURE_ENV = "TRADING_AGENTS_WORKFLOW_TEST_SEMANTIC_CONTINUATION_FAILURE";
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
const HUMAN_GATE_APPROVE_OPTION_MIN = 2;
const HUMAN_GATE_APPROVE_OPTION_MAX = 5;
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

const WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES = new Set([
  "autonomous_loop",
  "agent_loop",
  "manager_worker_spawn",
  "task"
]);

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

function protocolObjectExpiresAt(protocolObject = {}) {
  return protocolPayloadField(protocolObject, ["expiresAt", "expires_at"]);
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

const WORKFLOW_V2_WORKER_LIFECYCLE_ACTION_HANDLERS = createWorkflowV2WorkerLifecycleActionHandlers({
  ensureWorkflowLayout,
  normalizeOptionalAgentId,
  nowIso,
  workflowSessionRunStart,
  workflowV2AutonomousLoopSpawnGate,
  workflowV2CleanupInfoStackItem,
  workflowV2InfoStackExistingItem,
  workflowV2InfoStackPreview,
  workflowV2InfoStackRecord,
  workflowV2LoadWorkerLifecycleActor,
  workflowV2PersistedPlanNodeHardGateErrors,
  workflowV2RequireSessionRunPatch,
  workflowV2RestoreWorkerHandoffRow,
  workflowV2RestoreWorkerRunRow,
  workflowV2WorkerHandoffById,
  workflowV2WorkerHandoffRow
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

async function workflowV2RestoreWorkerRunRow(paths, row = {}) {
  if (!row?.worker_run_id) return;
  await sqlite(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status=${sqlValue(row.status || "")},
    parent_worker_run_id=${sqlValue(row.parent_worker_run_id || "")},
    supersedes_worker_run_id=${sqlValue(row.supersedes_worker_run_id || "")},
    successor_worker_run_id=${sqlValue(row.successor_worker_run_id || "")},
    worker_generation=${sqlValue(Number(row.worker_generation || 0))},
    attempt=${sqlValue(Number(row.attempt || 0))},
    max_attempts=${sqlValue(Number(row.max_attempts || 1))},
    lease_owner=${sqlValue(row.lease_owner || "")},
    lease_until=${sqlValue(row.lease_until || "")},
    next_retry_at=${sqlValue(row.next_retry_at || "")},
    output_info_id=${sqlValue(row.output_info_id || "")},
    handoff_info_id=${sqlValue(row.handoff_info_id || "")},
    receipt_ref=${sqlValue(row.receipt_ref || "")},
    last_error=${sqlValue(row.last_error || "")},
    context_budget_tokens=${sqlValue(Number(row.context_budget_tokens || 0))},
    context_used_tokens=${sqlValue(Number(row.context_used_tokens || 0))},
    compaction_count=${sqlValue(Number(row.compaction_count || 0))},
    source_context_refs_json=${sqlValue(row.source_context_refs_json || "[]")},
    payload_json=${sqlValue(row.payload_json || "{}")},
    started_at=${sqlValue(row.started_at || "")},
    completed_at=${sqlValue(row.completed_at || "")},
    updated_at=${sqlValue(row.updated_at || nowIso())}
WHERE worker_run_id=${sqlValue(row.worker_run_id)};`);
}

async function workflowV2RestoreSessionRunRow(paths, row = {}) {
  if (!row?.run_id) return;
  await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET session_id=${sqlValue(row.session_id || "")},
    pack_version=${sqlValue(Number(row.pack_version || 0))},
    workflow_id=${sqlValue(row.workflow_id || "")},
    task_id=${sqlValue(row.task_id || "")},
    dispatch_id=${sqlValue(row.dispatch_id || "")},
    worker_id=${sqlValue(row.worker_id || "")},
    status=${sqlValue(row.status || "")},
    input_json=${sqlValue(row.input_json || "{}")},
    worker_input_json=${sqlValue(row.worker_input_json || "{}")},
    output_json=${sqlValue(row.output_json || "{}")},
    receipt_ref=${sqlValue(row.receipt_ref || "")},
    error=${sqlValue(row.error || "")},
    started_at=${sqlValue(row.started_at || "")},
    completed_at=${sqlValue(row.completed_at || "")},
    created_at=${sqlValue(row.created_at || nowIso())},
    updated_at=${sqlValue(row.updated_at || nowIso())}
WHERE run_id=${sqlValue(row.run_id)};`);
}

async function workflowV2RestoreManagerReviewRow(paths, row = null, reviewId = "") {
  const id = row?.review_id || reviewId;
  if (!id) return;
  if (!row) {
    await sqlite(paths.dbFile, `DELETE FROM workflow_v2_manager_reviews WHERE review_id=${sqlValue(id)};`);
    return;
  }
  await sqlite(paths.dbFile, `
UPDATE workflow_v2_manager_reviews
SET workflow_id=${sqlValue(row.workflow_id || "")},
    plan_id=${sqlValue(row.plan_id || "")},
    node_id=${sqlValue(row.node_id || "")},
    worker_run_id=${sqlValue(row.worker_run_id || "")},
    reviewer_agent=${sqlValue(row.reviewer_agent || "")},
    decision=${sqlValue(row.decision || "")},
    summary=${sqlValue(row.summary || "")},
    findings_json=${sqlValue(row.findings_json || "[]")},
    artifact_refs_json=${sqlValue(row.artifact_refs_json || "[]")},
    receipt_refs_json=${sqlValue(row.receipt_refs_json || "[]")},
    blocker_json=${sqlValue(row.blocker_json || "{}")},
    payload_json=${sqlValue(row.payload_json || "{}")},
    created_at=${sqlValue(row.created_at || nowIso())}
WHERE review_id=${sqlValue(id)};`);
}

async function workflowV2LoadPlanRow(paths, workflowId, planId) {
  if (!workflowId || !planId || !fileExistsSync(paths.dbFile)) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(workflowId)} AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowV2PatchPlanWorkflowState(paths, workflowId, planId, workflowState, timestamp = nowIso()) {
  if (!workflowId || !planId || !WORKFLOW_V2_WORKFLOW_STATES.has(workflowState)) return 0;
  return sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_plans
SET workflow_state=${sqlValue(workflowState)},
    updated_at=${sqlValue(timestamp)}
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)};`);
}

async function workflowV2PlanOrchestrationPattern(paths, workflowId = "", planId = "") {
  const row = await workflowV2LoadPlanRow(paths, workflowId, planId);
  const payload = workflowV2JsonObject(row?.payload_json, {});
  const orchestration = workflowV2JsonObject(payload.orchestration, {});
  return firstText(orchestration.pattern, payload.orchestrationPattern, payload.orchestration_pattern);
}

async function workflowV2PersistedPlanNodeHardGateErrors(paths, workflowId = "", planId = "") {
  if (!workflowId || !planId || !fileExistsSync(paths.dbFile)) return [];
  const planRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true });
  const planRow = planRows[0];
  if (!planRow) return [];
  const payload = workflowV2JsonObject(planRow.payload_json, {});
  const orchestration = workflowV2JsonObject(payload.orchestration, {});
  const participantManagers = workflowV2JsonArray(planRow.participant_managers_json, []);
  const contract = workflowV2PlanOrchestrationContract({
    orchestration,
    orchestrationPattern: orchestration.pattern,
    orchestrationRationale: orchestration.rationale,
    complexityTier: orchestration.complexityTier,
    taskGroupRequired: orchestration.taskGroupRequired,
    workerBudget: workflowV2JsonObject(orchestration.workerBudget, {})
  }, participantManagers);
  const nodeRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plan_nodes
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
ORDER BY created_at ASC, node_id ASC;`, { json: true });
  const nodes = nodeRows.map((row) => ({
    nodeId: row.node_id || "",
    planId: row.plan_id || "",
    workflowId: row.workflow_id || "",
    parentNodeId: row.parent_node_id || "",
    nodeType: row.node_type || "",
    status: row.status || "",
    ownerAgent: row.owner_agent || "",
    runtimeBackend: row.runtime_backend || "",
    sessionId: row.session_id || "",
    dependsOn: workflowV2JsonArray(row.depends_on_json, []),
    inputInfoId: row.input_info_id || "",
    outputInfoId: row.output_info_id || "",
    payload: workflowV2JsonObject(row.payload_json, {})
  }));
  return workflowV2PlanNodeHardGateErrors(contract, nodes);
}

function workflowV2PayloadText(payload = {}, ...keys) {
  const object = workflowV2JsonObject(payload, {});
  const values = [];
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    values.push(object[key], object[camelKey]);
  }
  return firstText(...values);
}

function workflowV2PayloadList(payload = {}, ...keys) {
  const object = workflowV2JsonObject(payload, {});
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    const list = workflowV2JsonArray(object[key] ?? object[camelKey], null);
    if (Array.isArray(list)) return workflowV2UniqueTextArray(list);
  }
  return [];
}

function workflowV2PayloadPositiveInt(payload = {}, ...keys) {
  const object = workflowV2JsonObject(payload, {});
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    const value = object[key] ?? object[camelKey];
    if (value !== undefined && value !== null && value !== "" && workflowV2NonNegativeInt(value, 0) > 0) {
      return workflowV2NonNegativeInt(value, 0);
    }
  }
  return 0;
}

async function workflowV2AutonomousLoopNodeSpec(paths, workflowId = "", planId = "", nodeId = "") {
  if (!workflowId || !planId || !nodeId || !fileExistsSync(paths.dbFile)) return { active: false };
  const rows = await sqlite(paths.dbFile, `
SELECT
  p.workflow_id AS workflow_id,
  p.plan_id AS plan_id,
  p.payload_json AS plan_payload_json,
  n.node_id AS node_id,
  n.node_type AS node_type,
  n.status AS node_status,
  n.output_info_id AS node_output_info_id,
  n.payload_json AS node_payload_json
FROM workflow_v2_plan_nodes n
JOIN workflow_v2_plans p ON p.workflow_id=n.workflow_id AND p.plan_id=n.plan_id
WHERE n.workflow_id=${sqlValue(workflowId)}
  AND n.plan_id=${sqlValue(planId)}
  AND n.node_id=${sqlValue(nodeId)}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  if (!row) return { active: false };
  const planPayload = workflowV2JsonObject(row.plan_payload_json, {});
  const orchestration = workflowV2JsonObject(planPayload.orchestration, {});
  const pattern = firstText(orchestration.pattern, planPayload.orchestrationPattern, planPayload.orchestration_pattern);
  const nodeType = String(row.node_type || "").trim();
  const nodePayload = workflowV2JsonObject(row.node_payload_json, {});
  if (pattern !== "autonomous_agent_loop" || !WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES.has(nodeType)) {
    return { active: false, pattern, nodeType, row };
  }
  const maxIterations = workflowV2PayloadPositiveInt(nodePayload, "maxIterations", "max_iterations", "iterationCap", "iteration_cap");
  const feedbackCheckpoints = workflowV2PayloadList(nodePayload, "toolFeedbackCheckpoints", "tool_feedback_checkpoints", "environmentFeedbackCheckpoints", "environment_feedback_checkpoints");
  const stopCondition = workflowV2PayloadText(nodePayload, "stopCondition", "stop_condition");
  const stopConditions = workflowV2PayloadList(nodePayload, "stopConditions", "stop_conditions");
  return {
    active: true,
    workflowId,
    planId,
    nodeId,
    nodeType,
    nodeStatus: row.node_status || "",
    nodeOutputInfoId: row.node_output_info_id || "",
    nodePayload,
    pattern,
    maxIterations,
    feedbackCheckpoints,
    stopCondition,
    stopConditions,
    row
  };
}

async function workflowV2AutonomousLoopIterationStats(paths, spec = {}) {
  if (!spec.active || !fileExistsSync(paths.dbFile)) return { iterationCount: 0, workerRunIds: [] };
  const rows = await sqlite(paths.dbFile, `
SELECT worker_run_id, status, output_info_id, receipt_ref, completed_at, created_at, updated_at
FROM workflow_v2_worker_runs
WHERE workflow_id=${sqlValue(spec.workflowId)}
  AND plan_id=${sqlValue(spec.planId)}
  AND node_id=${sqlValue(spec.nodeId)}
  AND status!='cancelled'
ORDER BY created_at ASC, worker_run_id ASC;`, { json: true });
  return {
    iterationCount: rows.length,
    workerRunIds: rows.map((row) => row.worker_run_id || "").filter(Boolean),
    latestWorkerRun: rows[rows.length - 1] || null
  };
}

function workflowV2TimestampAtOrAfter(candidate = "", threshold = "") {
  if (!threshold) return true;
  if (!candidate) return false;
  const candidateTime = Date.parse(candidate);
  const thresholdTime = Date.parse(threshold);
  if (Number.isFinite(candidateTime) && Number.isFinite(thresholdTime)) return candidateTime >= thresholdTime;
  return String(candidate) >= String(threshold);
}

function workflowV2AutonomousLoopFeedbackCheckpointAt(stats = {}) {
  const latest = stats.latestWorkerRun || {};
  return firstText(latest.completed_at, latest.updated_at, latest.created_at);
}

function workflowV2AutonomousLoopInputPayload(input = {}) {
  const payload = workflowV2JsonObject(input.payload, {});
  const loop = workflowV2JsonObject(input.autonomousLoop ?? input.autonomous_loop ?? payload.autonomousLoop ?? payload.autonomous_loop, {});
  return { payload, loop };
}

function workflowV2AutonomousLoopTextRefs(...values) {
  const refs = [];
  for (const value of values) {
    refs.push(...workflowV2JsonArray(value, value === undefined || value === null ? [] : [value]));
  }
  return workflowV2UniqueTextArray(refs);
}

function workflowV2AutonomousLoopFeedbackRefs(input = {}) {
  const { payload, loop } = workflowV2AutonomousLoopInputPayload(input);
  return {
    infoIds: workflowV2AutonomousLoopTextRefs(
      input.toolFeedbackInfoId,
      input.tool_feedback_info_id,
      input.toolFeedbackInfoIds,
      input.tool_feedback_info_ids,
      input.environmentFeedbackInfoId,
      input.environment_feedback_info_id,
      input.environmentFeedbackInfoIds,
      input.environment_feedback_info_ids,
      input.feedbackInfoId,
      input.feedback_info_id,
      input.feedbackInfoIds,
      input.feedback_info_ids,
      payload.toolFeedbackInfoId,
      payload.tool_feedback_info_id,
      payload.environmentFeedbackInfoId,
      payload.environment_feedback_info_id,
      payload.feedbackInfoId,
      payload.feedback_info_id,
      loop.toolFeedbackInfoId,
      loop.tool_feedback_info_id,
      loop.environmentFeedbackInfoId,
      loop.environment_feedback_info_id,
      loop.feedbackInfoId,
      loop.feedback_info_id,
      loop.feedbackInfoIds,
      loop.feedback_info_ids
    ),
    receiptRefs: workflowV2AutonomousLoopTextRefs(
      input.toolFeedbackReceiptRef,
      input.tool_feedback_receipt_ref,
      input.toolFeedbackReceiptRefs,
      input.tool_feedback_receipt_refs,
      input.environmentFeedbackReceiptRef,
      input.environment_feedback_receipt_ref,
      input.environmentFeedbackReceiptRefs,
      input.environment_feedback_receipt_refs,
      input.feedbackReceiptRef,
      input.feedback_receipt_ref,
      input.feedbackReceiptRefs,
      input.feedback_receipt_refs,
      payload.toolFeedbackReceiptRef,
      payload.tool_feedback_receipt_ref,
      payload.environmentFeedbackReceiptRef,
      payload.environment_feedback_receipt_ref,
      payload.feedbackReceiptRef,
      payload.feedback_receipt_ref,
      loop.toolFeedbackReceiptRef,
      loop.tool_feedback_receipt_ref,
      loop.environmentFeedbackReceiptRef,
      loop.environment_feedback_receipt_ref,
      loop.feedbackReceiptRef,
      loop.feedback_receipt_ref,
      loop.feedbackReceiptRefs,
      loop.feedback_receipt_refs
    )
  };
}

function workflowV2AutonomousLoopInfoPayloadHasFeedback(payload = {}) {
  const object = workflowV2JsonObject(payload, {});
  const loop = workflowV2JsonObject(object.autonomousLoop ?? object.autonomous_loop, {});
  return boolOption(object.autonomousLoopFeedback ?? object.autonomous_loop_feedback, false)
    || boolOption(object.toolFeedback ?? object.tool_feedback, false)
    || boolOption(object.environmentFeedback ?? object.environment_feedback, false)
    || boolOption(loop.feedback ?? loop.hasFeedback ?? loop.has_feedback, false)
    || Boolean(firstText(
      object.feedbackKind,
      object.feedback_kind,
      object.toolFeedbackKind,
      object.tool_feedback_kind,
      object.environmentFeedbackKind,
      object.environment_feedback_kind,
      loop.feedbackKind,
      loop.feedback_kind,
      loop.toolFeedbackKind,
      loop.tool_feedback_kind,
      loop.environmentFeedbackKind,
      loop.environment_feedback_kind
    ));
}

function workflowV2AutonomousLoopPayloadFeedbackLineage(payload = {}) {
  const object = workflowV2JsonObject(payload, {});
  const loop = workflowV2JsonObject(object.autonomousLoop ?? object.autonomous_loop, {});
  return firstText(
    object.sourceWorkerRunId,
    object.source_worker_run_id,
    object.feedbackSourceWorkerRunId,
    object.feedback_source_worker_run_id,
    object.workerRunId,
    object.worker_run_id,
    loop.sourceWorkerRunId,
    loop.source_worker_run_id,
    loop.feedbackSourceWorkerRunId,
    loop.feedback_source_worker_run_id,
    loop.workerRunId,
    loop.worker_run_id
  );
}

function workflowV2AutonomousLoopPayloadFeedbackCheckpoint(payload = {}) {
  const object = workflowV2JsonObject(payload, {});
  const loop = workflowV2JsonObject(object.autonomousLoop ?? object.autonomous_loop, {});
  return firstText(
    object.feedbackCheckpoint,
    object.feedback_checkpoint,
    object.checkpoint,
    object.checkpointKey,
    object.checkpoint_key,
    object.feedbackKind,
    object.feedback_kind,
    object.toolFeedbackKind,
    object.tool_feedback_kind,
    object.environmentFeedbackKind,
    object.environment_feedback_kind,
    loop.feedbackCheckpoint,
    loop.feedback_checkpoint,
    loop.checkpoint,
    loop.checkpointKey,
    loop.checkpoint_key,
    loop.feedbackKind,
    loop.feedback_kind,
    loop.toolFeedbackKind,
    loop.tool_feedback_kind,
    loop.environmentFeedbackKind,
    loop.environment_feedback_kind
  );
}

function workflowV2AutonomousLoopFeedbackMatchesPreviousWorker(row = {}, payload = {}, stats = {}) {
  const latestWorkerRunId = firstText(stats.latestWorkerRun?.worker_run_id);
  if (!latestWorkerRunId) return false;
  return row.worker_run_id === latestWorkerRunId
    || workflowV2AutonomousLoopPayloadFeedbackLineage(payload) === latestWorkerRunId;
}

function workflowV2AutonomousLoopFeedbackMatchesCheckpoint(spec = {}, payload = {}) {
  const checkpoints = workflowV2UniqueTextArray(spec.feedbackCheckpoints || []);
  if (!checkpoints.length) return true;
  return checkpoints.includes(workflowV2AutonomousLoopPayloadFeedbackCheckpoint(payload));
}

function workflowV2AutonomousLoopFeedbackRowIssue(row = {}, spec = {}, stats = {}, checkpointAt = "") {
  const payload = workflowV2JsonObject(row.payload_json, {});
  if (!workflowV2TimestampAtOrAfter(firstText(row.updated_at, row.created_at), checkpointAt)) return "stale";
  if (!workflowV2AutonomousLoopInfoPayloadHasFeedback(payload)) return "not_feedback";
  if (!workflowV2AutonomousLoopFeedbackMatchesPreviousWorker(row, payload, stats)) return "lineage_mismatch";
  if (!workflowV2AutonomousLoopFeedbackMatchesCheckpoint(spec, payload)) return "checkpoint_mismatch";
  return "";
}

async function workflowV2AutonomousLoopFeedbackEvidence(paths, spec = {}, input = {}, stats = {}) {
  const iterationCount = workflowV2NonNegativeInt(stats.iterationCount, 0);
  if (!spec.active || iterationCount <= 0) return { required: false, present: true, evidence: [] };
  const refs = workflowV2AutonomousLoopFeedbackRefs(input);
  const checkpointAt = workflowV2AutonomousLoopFeedbackCheckpointAt(stats);
  const evidence = [];
  const missingInfoIds = [];
  const staleInfoIds = [];
  const invalidInfoIds = [];
  const lineageMismatchInfoIds = [];
  const checkpointMismatchInfoIds = [];
  for (const infoId of refs.infoIds) {
    const rows = await sqlite(paths.dbFile, `
SELECT info_id, workflow_id, plan_id, node_id, worker_run_id, summary, payload_json, created_at, updated_at
FROM workflow_v2_info_items
WHERE info_id=${sqlValue(infoId)}
LIMIT 1;`, { json: true });
    const row = rows[0] || null;
    if (!row || row.workflow_id !== spec.workflowId || row.plan_id !== spec.planId || row.node_id !== spec.nodeId) {
      missingInfoIds.push(infoId);
    } else {
      const issue = workflowV2AutonomousLoopFeedbackRowIssue(row, spec, stats, checkpointAt);
      if (!issue) {
        evidence.push({ kind: "info_item", infoId, workerRunId: row.worker_run_id || "", summary: row.summary || "" });
      } else if (issue === "stale") {
        staleInfoIds.push(infoId);
      } else if (issue === "lineage_mismatch") {
        lineageMismatchInfoIds.push(infoId);
      } else if (issue === "checkpoint_mismatch") {
        checkpointMismatchInfoIds.push(infoId);
      } else {
        invalidInfoIds.push(infoId);
      }
    }
  }
  if (evidence.length) {
    return {
      required: true,
      present: true,
      evidence,
      missingInfoIds,
      staleInfoIds,
      invalidInfoIds,
      lineageMismatchInfoIds,
      checkpointMismatchInfoIds,
      checkpointAt,
      receiptRefs: refs.receiptRefs
    };
  }
  const rows = await sqlite(paths.dbFile, `
SELECT info_id, worker_run_id, summary, payload_json, created_at, updated_at
FROM workflow_v2_info_items
WHERE workflow_id=${sqlValue(spec.workflowId)}
  AND plan_id=${sqlValue(spec.planId)}
  AND node_id=${sqlValue(spec.nodeId)}
  AND (created_at >= ${sqlValue(checkpointAt)} OR updated_at >= ${sqlValue(checkpointAt)})
ORDER BY created_at DESC, info_id DESC;`, { json: true });
  for (const row of rows) {
    if (
      workflowV2AutonomousLoopInfoPayloadHasFeedback(row.payload_json)
      && workflowV2AutonomousLoopFeedbackMatchesPreviousWorker(row, workflowV2JsonObject(row.payload_json, {}), stats)
      && workflowV2AutonomousLoopFeedbackMatchesCheckpoint(spec, workflowV2JsonObject(row.payload_json, {}))
    ) {
      evidence.push({ kind: "info_item", infoId: row.info_id || "", workerRunId: row.worker_run_id || "", summary: row.summary || "" });
      break;
    }
  }
  return {
    required: true,
    present: evidence.length > 0,
    evidence,
    missingInfoIds,
    staleInfoIds,
    invalidInfoIds,
    lineageMismatchInfoIds,
    checkpointMismatchInfoIds,
    checkpointAt,
    receiptRefs: refs.receiptRefs
  };
}

async function workflowV2AutonomousLoopSpawnGate(paths, workflowId = "", planId = "", nodeId = "", input = {}) {
  const spec = await workflowV2AutonomousLoopNodeSpec(paths, workflowId, planId, nodeId);
  if (!spec.active) return { active: false, errors: [], state: null };
  const stats = await workflowV2AutonomousLoopIterationStats(paths, spec);
  const errors = [];
  const latestStatus = String(stats.latestWorkerRun?.status || "").trim();
  if (["completed", "cancelled", "failed"].includes(spec.nodeStatus)) {
    errors.push(workflowV2ValidationError("autonomous_loop_terminal", "autonomous_agent_loop node is already terminal and cannot spawn another iteration", {
      workflowId,
      planId,
      nodeId,
      nodeStatus: spec.nodeStatus
    }));
  }
  if (spec.maxIterations > 0 && stats.iterationCount >= spec.maxIterations) {
    errors.push(workflowV2ValidationError("autonomous_loop_iteration_cap_reached", "autonomous_agent_loop reached maxIterations and cannot spawn another iteration", {
      workflowId,
      planId,
      nodeId,
      iterationCount: stats.iterationCount,
      maxIterations: spec.maxIterations
    }));
  }
  if (stats.iterationCount > 0 && ["queued", "retry_scheduled", "running"].includes(latestStatus)) {
    errors.push(workflowV2ValidationError("autonomous_loop_previous_iteration_open", "autonomous_agent_loop cannot spawn the next iteration while the previous iteration is still open", {
      workflowId,
      planId,
      nodeId,
      iterationCount: stats.iterationCount,
      latestWorkerRunId: stats.latestWorkerRun?.worker_run_id || "",
      latestStatus
    }));
  }
  const feedback = await workflowV2AutonomousLoopFeedbackEvidence(paths, spec, input, stats);
  if (!feedback.present) {
    errors.push(workflowV2ValidationError("autonomous_loop_feedback_required", "autonomous_agent_loop requires tool/environment feedback evidence before the next iteration", {
      workflowId,
      planId,
      nodeId,
      iterationCount: stats.iterationCount,
      feedbackCheckpoints: spec.feedbackCheckpoints,
      feedbackCheckpointAt: feedback.checkpointAt || "",
      missingInfoIds: feedback.missingInfoIds || [],
      staleInfoIds: feedback.staleInfoIds || [],
      invalidInfoIds: feedback.invalidInfoIds || [],
      lineageMismatchInfoIds: feedback.lineageMismatchInfoIds || [],
      checkpointMismatchInfoIds: feedback.checkpointMismatchInfoIds || [],
      receiptRefs: feedback.receiptRefs || []
    }));
  }
  return {
    active: true,
    errors,
    state: {
      pattern: spec.pattern,
      nodeType: spec.nodeType,
      iterationCount: stats.iterationCount,
      nextIteration: stats.iterationCount + 1,
      maxIterations: spec.maxIterations,
      feedbackRequired: feedback.required,
      feedbackEvidence: feedback.evidence || [],
      stopCondition: spec.stopCondition,
      stopConditions: spec.stopConditions
    }
  };
}

function workflowV2AutonomousLoopStopConditionSatisfied(input = {}, workerPayload = {}) {
  const { payload, loop } = workflowV2AutonomousLoopInputPayload(input);
  const workerLoop = workflowV2JsonObject(workerPayload.autonomousLoop ?? workerPayload.autonomous_loop, {});
  return boolOption(input.stopConditionSatisfied ?? input.stop_condition_satisfied, false)
    || boolOption(input.autonomousLoopStopSatisfied ?? input.autonomous_loop_stop_satisfied, false)
    || boolOption(payload.stopConditionSatisfied ?? payload.stop_condition_satisfied, false)
    || boolOption(payload.autonomousLoopStopSatisfied ?? payload.autonomous_loop_stop_satisfied, false)
    || boolOption(loop.stopConditionSatisfied ?? loop.stop_condition_satisfied, false)
    || boolOption(loop.stopSatisfied ?? loop.stop_satisfied, false)
    || boolOption(workerLoop.stopConditionSatisfied ?? workerLoop.stop_condition_satisfied, false)
    || boolOption(workerLoop.stopSatisfied ?? workerLoop.stop_satisfied, false);
}

async function workflowV2AutonomousLoopMaybeTerminalizeNode(paths, row = {}, input = {}, timestamp = nowIso()) {
  const workflowId = firstText(row.workflow_id, row.workflowId);
  const planId = firstText(row.plan_id, row.planId);
  const nodeId = firstText(row.node_id, row.nodeId);
  const workerRunId = firstText(row.worker_run_id, row.workerRunId);
  const workerPayload = workflowV2JsonObject(row.payload_json ?? row.payload, {});
  const spec = await workflowV2AutonomousLoopNodeSpec(paths, workflowId, planId, nodeId);
  if (!spec.active || !workflowV2AutonomousLoopStopConditionSatisfied(input, workerPayload)) return null;
  const outputInfoId = firstText(input.outputInfoId, input.output_info_id, row.output_info_id, row.outputInfoId);
  const receiptRef = firstText(input.receiptRef, input.receipt_ref, row.receipt_ref, row.receiptRef);
  const nextPayload = {
    ...spec.nodePayload,
    autonomousLoopRuntime: {
      ...workflowV2JsonObject(spec.nodePayload.autonomousLoopRuntime ?? spec.nodePayload.autonomous_loop_runtime, {}),
      stopConditionSatisfied: true,
      terminalWorkerRunId: workerRunId,
      terminalOutputInfoId: outputInfoId,
      terminalReceiptRef: receiptRef,
      terminalizedAt: timestamp
    }
  };
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_plan_nodes
SET status='completed',
    output_info_id=${sqlValue(outputInfoId || spec.nodeOutputInfoId || "")},
    payload_json=${sqlValue(JSON.stringify(nextPayload))},
    updated_at=${sqlValue(timestamp)}
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
  AND node_id=${sqlValue(nodeId)}
  AND status NOT IN ('completed','cancelled','failed');`);
  return {
    terminalized: changed === 1,
    workflowId,
    planId,
    nodeId,
    workerRunId,
    status: "completed",
    outputInfoId: outputInfoId || spec.nodeOutputInfoId || "",
    receiptRef
  };
}

async function workflowV2PatchSessionRunState(paths, runId = "", patch = {}) {
  if (!runId) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_session_runs
WHERE run_id=${sqlValue(runId)}
LIMIT 1;`, { json: true });
  const current = sessionRunFromRow(rows[0]);
  if (!current) return null;
  const timestamp = firstText(patch.timestamp, patch.updatedAt, patch.updated_at, nowIso());
  const status = requireWorkflowSessionRunStatus(patch.status || current.status, current.status);
  const output = patch.output !== undefined ? sessionJsonObject(patch.output) : current.output;
  const receiptRef = patch.receiptRef !== undefined || patch.receipt_ref !== undefined ? firstText(patch.receiptRef, patch.receipt_ref) : current.receiptRef;
  const errorText = patch.error !== undefined ? String(patch.error || "") : current.error;
  const startedAt = status === "running" && !current.startedAt ? timestamp : current.startedAt;
  const completedAt = isTerminalWorkflowSessionRunStatus(status) ? (current.completedAt || timestamp) : "";
  await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET status=${sqlValue(status)},
    output_json=${sqlValue(JSON.stringify(output))},
    receipt_ref=${sqlValue(receiptRef)},
    error=${sqlValue(errorText)},
    started_at=${sqlValue(startedAt)},
    completed_at=${sqlValue(completedAt)},
    updated_at=${sqlValue(timestamp)}
WHERE run_id=${sqlValue(runId)};`);
  const packRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(current.sessionId)} LIMIT 1;`, { json: true });
  const pack = sessionPackFromRow(packRows[0]) || {};
  const phaseInfo = await workflowTaskPhaseInfo(paths, current.workflowId, current.taskId);
  let agentRunSyncError = "";
  try {
    await upsertWorkflowAgentRun(paths, {
      agentRunId: `session.${runId}`,
      workflowId: current.workflowId,
      phaseId: phaseInfo.phaseId,
      phaseKey: phaseInfo.phaseKey,
      taskId: current.taskId,
      dispatchId: current.dispatchId,
      sessionRunId: runId,
      runtime: pack.runtimeTarget || "session_pack",
      agentId: current.workerId || pack.ownerAgent || "",
      status,
      inputHash: jsonHash(current.input),
      outputHash: jsonHash(output),
      receiptRef,
      error: errorText,
      payload: { source: "workflow_session_runs", sessionId: current.sessionId, packVersion: current.packVersion, v2Patch: true },
      startedAt,
      completedAt,
      updatedAt: timestamp
    });
  } catch (error) {
    agentRunSyncError = workflowV2ErrorMessage(error);
  }
  const updatedRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
  const updated = sessionRunFromRow(updatedRows[0]);
  return updated ? { ...updated, agentRunSyncError } : null;
}

async function workflowV2RequireSessionRunPatch(paths, runId = "", patch = {}, context = "worker lifecycle") {
  const sessionRun = await workflowV2PatchSessionRunState(paths, runId, patch);
  if (!sessionRun) {
    throw new Error(`workflow v2 session run patch failed: ${context} session_run_id=${runId || ""}`);
  }
  return sessionRun;
}

function workflowV2WorkerRetryDelayMs(input = {}, attempt = 1) {
  const value = Number(input.retryDelayMs || input.retry_delay_ms || 5_000 * Math.max(1, attempt));
  return Math.max(0, Math.min(30 * 60_000, Number.isFinite(value) ? value : 5_000));
}

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
  workflowV2RestoreWorkerRunRow,
  workflowV2WorkerRetryDelayMs,
  writeJsonAtomic
});

export const {
  workflowV2ControlLoopPreview,
  workflowV2ControlLoopTick
} = WORKFLOW_V2_CONTROL_LOOP_ACTION_HANDLERS;

async function workflowV2LoadWorkerRunForResult(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id, input.runId, input.run_id);
  if (!workerRunId) {
    return { paths, workerRunId, row: null, errors: [workflowV2ValidationError("worker_run_id_required", "worker result requires workerRunId")] };
  }
  if (!fileExistsSync(paths.dbFile)) {
    return { paths, workerRunId, row: null, errors: [workflowV2ValidationError("workflow_database_missing", "workflow database does not exist")] };
  }
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(workerRunId)}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  const errors = [];
  if (!row) errors.push(workflowV2ValidationError("worker_run_not_found", `worker run not found: ${workerRunId}`));
  return { paths, workerRunId, row, errors };
}

function workflowV2LeaseCheckAt(input = {}) {
  return firstText(input.leaseCheckAt, input.lease_check_at, input.generatedAt, input.generated_at, input.now) || nowIso();
}

function workflowV2LeaseErrors(row = {}, input = {}) {
  const errors = [];
  const leaseOwner = firstText(input.leaseOwner, input.lease_owner);
  const leaseUntil = firstText(input.leaseUntil, input.lease_until);
  const leaseCheckAt = workflowV2LeaseCheckAt(input);
  if (!leaseOwner) errors.push(workflowV2ValidationError("lease_owner_required", "worker result requires leaseOwner"));
  if (!leaseUntil) errors.push(workflowV2ValidationError("lease_until_required", "worker result requires leaseUntil"));
  if (row.status && row.status !== "running") errors.push(workflowV2ValidationError("worker_not_running", `worker result requires running status, got ${row.status}`));
  if (row.lease_owner && leaseOwner && row.lease_owner !== leaseOwner) errors.push(workflowV2ValidationError("lease_owner_mismatch", "worker result leaseOwner does not match current lease"));
  if (row.lease_until && leaseUntil && row.lease_until !== leaseUntil) errors.push(workflowV2ValidationError("lease_until_mismatch", "worker result leaseUntil does not match current lease"));
  if (!row.lease_owner || !row.lease_until) errors.push(workflowV2ValidationError("worker_not_leased", "worker result requires an active worker lease"));
  const rowLeaseMs = Date.parse(row.lease_until || "");
  const checkAtMs = Date.parse(leaseCheckAt || "");
  if (row.lease_until && Number.isNaN(rowLeaseMs)) errors.push(workflowV2ValidationError("lease_until_invalid", "worker result leaseUntil is not a valid timestamp"));
  if (Number.isNaN(checkAtMs)) errors.push(workflowV2ValidationError("lease_check_at_invalid", "worker result lease check timestamp is invalid"));
  if (row.lease_until && !Number.isNaN(rowLeaseMs) && !Number.isNaN(checkAtMs) && rowLeaseMs <= checkAtMs) {
    errors.push(workflowV2ValidationError("lease_expired", "worker result lease has expired"));
  }
  return errors;
}

const WORKFLOW_V2_WORKER_RESULT_ACTION_HANDLERS = createWorkflowV2WorkerResultActionHandlers({
  ensureWorkflowLayout,
  nowIso,
  workflowV2AutonomousLoopMaybeTerminalizeNode,
  workflowV2CleanupInfoStackItem,
  workflowV2InfoStackExistingItem,
  workflowV2InfoStackPreview,
  workflowV2InfoStackRecord,
  workflowV2LeaseCheckAt,
  workflowV2LeaseErrors,
  workflowV2LoadWorkerRunForResult,
  workflowV2MarkAdapterJobTerminal,
  workflowV2RequireSessionRunPatch,
  workflowV2RestoreSessionRunRow,
  workflowV2RestoreWorkerRunRow,
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
  workflowV2LeaseCheckAt,
  workflowV2LeaseErrors,
  workflowV2LoadWorkerRunForResult,
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

async function workflowV2AdapterJobById(dbFile, adapterJobId = "") {
  if (!adapterJobId) return null;
  const rows = await sqlite(dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
WHERE adapter_job_id=${sqlValue(adapterJobId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowV2MarkAdapterJobTerminal(paths, input = {}, workerRunId = "", status = "completed", timestamp = nowIso(), expectedWorkerAttempt = 0) {
  const adapterJobId = firstText(input.adapterJobId, input.adapter_job_id);
  if (!adapterJobId && !workerRunId) return null;
  const runnerLeaseOwner = firstText(
    input.adapterJobLeaseOwner,
    input.adapter_job_lease_owner,
    input.runnerLeaseOwner,
    input.runner_lease_owner,
    input.runnerId,
    input.runner_id
  );
  const runnerLeaseUntil = firstText(
    input.adapterJobLeaseUntil,
    input.adapter_job_lease_until,
    input.runnerLeaseUntil,
    input.runner_lease_until
  );
  const workerAttempt = workflowV2NonNegativeInt(input.workerAttempt ?? input.worker_attempt ?? expectedWorkerAttempt, 0);
  const receiptRef = firstText(input.runnerReceiptRef, input.runner_receipt_ref, input.receiptRef, input.receipt_ref);
  const errorMessage = firstText(input.error, input.errorMessage, input.error_message);
  const clauses = adapterJobId
    ? [`adapter_job_id=${sqlValue(adapterJobId)}`]
    : [`worker_run_id=${sqlValue(workerRunId)}`, "status='running'"];
  if (workerRunId) clauses.push(`worker_run_id=${sqlValue(workerRunId)}`);
  if (workerAttempt > 0) clauses.push(`worker_attempt=${sqlValue(workerAttempt)}`);
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_adapter_jobs
WHERE ${clauses.join(" AND ")}
ORDER BY updated_at DESC
LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) {
    if (adapterJobId) throw new Error("workflow v2 adapter job terminal update found no matching running job");
    return null;
  }
  const errors = [];
  if (row.status !== "running") errors.push(`adapter_job_not_running:${row.status || ""}`);
  if (workerRunId && row.worker_run_id !== workerRunId) errors.push("worker_run_mismatch");
  if (workerAttempt > 0 && Number(row.worker_attempt || 0) !== workerAttempt) errors.push("worker_attempt_mismatch");
  if (!runnerLeaseOwner) errors.push("adapter_job_lease_owner_required");
  if (!runnerLeaseUntil) errors.push("adapter_job_lease_until_required");
  if (runnerLeaseOwner && row.lease_owner !== runnerLeaseOwner) errors.push("adapter_job_lease_owner_mismatch");
  if (runnerLeaseUntil && row.lease_until !== runnerLeaseUntil) errors.push("adapter_job_lease_until_mismatch");
  const adapterLeaseMs = Date.parse(row.lease_until || "");
  const timestampMs = Date.parse(timestamp || "");
  if (!Number.isFinite(adapterLeaseMs) || !Number.isFinite(timestampMs) || adapterLeaseMs <= timestampMs) errors.push("adapter_job_lease_expired");
  if (errors.length) throw new Error(`workflow v2 adapter job terminal update blocked: ${errors.join(",")}`);
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_adapter_jobs
SET status=${sqlValue(status)},
    lease_owner='',
    lease_until='',
    runner_id='',
    next_retry_at='',
    runner_receipt_ref=${sqlValue(receiptRef)},
    last_error=${sqlValue(status === "failed" ? errorMessage : row.last_error || "")},
    completed_at=${sqlValue(timestamp)},
    updated_at=${sqlValue(timestamp)}
WHERE adapter_job_id=${sqlValue(row.adapter_job_id)}
  AND status='running'
  AND worker_run_id=${sqlValue(workerRunId || row.worker_run_id || "")}
  AND worker_attempt=${sqlValue(Number(row.worker_attempt || 0))}
  AND lease_owner=${sqlValue(runnerLeaseOwner)}
  AND lease_until=${sqlValue(runnerLeaseUntil)}
  AND lease_until > ${sqlValue(timestamp)};`);
  if (changed !== 1) throw new Error("workflow v2 adapter job terminal update lost runner lease before update");
  const updated = await workflowV2AdapterJobById(paths.dbFile, row.adapter_job_id);
  return { changed, job: workflowV2AdapterJobSummary(updated) };
}

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

async function workflowV2LoadWorkerLifecycleActor(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workerRunId = firstText(input.workerRunId, input.worker_run_id, input.sourceWorkerRunId, input.source_worker_run_id, input.runId, input.run_id);
  const workflowId = firstText(input.workflowId, input.workflow_id);
  if (!workerRunId) errors.push(workflowV2ValidationError("worker_run_id_required", "worker lifecycle action requires workerRunId/sourceWorkerRunId"));
  if (!fileExistsSync(paths.dbFile)) {
    errors.push(workflowV2ValidationError("workflow_database_missing", "workflow database does not exist"));
    return {
      paths,
      errors,
      workerRunId,
      workflowId,
      row: null,
      plan: null,
      callerAgent: "",
      managerAgent: "",
      taskOwnerAgent: "",
      allowedAgents: []
    };
  }
  let row = null;
  if (workerRunId) {
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(workerRunId)}
LIMIT 1;`, { json: true });
    row = rows[0] || null;
    if (!row) errors.push(workflowV2ValidationError("worker_run_not_found", `worker run not found: ${workerRunId}`));
    if (row && workflowId && row.workflow_id !== workflowId) {
      errors.push(workflowV2ValidationError("workflow_id_mismatch", "worker lifecycle action workflowId does not match worker run", {
        workerWorkflowId: row.workflow_id,
        workflowId
      }));
    }
  }
  let plan = null;
  if (row?.plan_id) {
    const planRows = await sqlite(paths.dbFile, `
SELECT plan_id, workflow_id, task_owner_agent
FROM workflow_v2_plans
WHERE plan_id=${sqlValue(row.plan_id)}
LIMIT 1;`, { json: true });
    plan = planRows[0] || null;
    if (!plan) {
      errors.push(workflowV2ValidationError("plan_not_found", "worker lifecycle action requires the worker plan record"));
    } else if (plan.workflow_id !== row.workflow_id) {
      errors.push(workflowV2ValidationError("plan_workflow_mismatch", "worker lifecycle action plan workflow does not match worker run"));
    }
  }
  const callerAgent = normalizeOptionalAgentId(firstText(input.callerAgent, input.caller_agent, input.createdBy, input.created_by));
  const managerAgent = normalizeOptionalAgentId(row?.manager_agent || "");
  const taskOwnerAgent = normalizeOptionalAgentId(plan?.task_owner_agent || "");
  const allowedAgents = workflowV2UniqueTextArray([managerAgent, taskOwnerAgent]);
  if (!callerAgent) {
    errors.push(workflowV2ValidationError("caller_agent_required", "worker lifecycle action requires callerAgent/createdBy for manager or task-owner authority"));
  } else if (row && allowedAgents.length && !allowedAgents.includes(callerAgent)) {
    errors.push(workflowV2ValidationError("caller_agent_not_authorized", "worker lifecycle action can only be performed by the responsible manager or task owner", {
      callerAgent,
      allowedAgents
    }));
  }
  return { paths, errors, workerRunId, workflowId, row, plan, callerAgent, managerAgent, taskOwnerAgent, allowedAgents };
}

async function workflowV2WorkerHandoffRow(paths, workerRunId = "", handoffId = "") {
  if (!workerRunId && !handoffId) return null;
  const clauses = [];
  if (workerRunId) clauses.push(`worker_run_id=${sqlValue(workerRunId)}`);
  if (handoffId) clauses.push(`handoff_id=${sqlValue(handoffId)}`);
  const order = handoffId ? "" : "ORDER BY updated_at DESC, created_at DESC";
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_handoffs
WHERE ${clauses.join(" AND ")}
${order}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowV2WorkerHandoffById(paths, handoffId = "") {
  if (!handoffId) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_handoffs
WHERE handoff_id=${sqlValue(handoffId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowV2RestoreWorkerHandoffRow(paths, row = null, handoffId = "") {
  const id = row?.handoff_id || handoffId;
  if (!id) return;
  if (!row) {
    await sqlite(paths.dbFile, `DELETE FROM workflow_v2_worker_handoffs WHERE handoff_id=${sqlValue(id)};`);
    return;
  }
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_worker_handoffs(handoff_id, workflow_id, plan_id, node_id, worker_run_id, manager_agent, successor_worker_run_id, handoff_info_id, status, reason, summary, source_context_refs_json, artifact_refs_json, receipt_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(row.handoff_id)}, ${sqlValue(row.workflow_id || "")}, ${sqlValue(row.plan_id || "")}, ${sqlValue(row.node_id || "")}, ${sqlValue(row.worker_run_id || "")}, ${sqlValue(row.manager_agent || "")}, ${sqlValue(row.successor_worker_run_id || "")}, ${sqlValue(row.handoff_info_id || "")}, ${sqlValue(row.status || "draft")}, ${sqlValue(row.reason || "")}, ${sqlValue(row.summary || "")}, ${sqlValue(row.source_context_refs_json || "[]")}, ${sqlValue(row.artifact_refs_json || "[]")}, ${sqlValue(row.receipt_refs_json || "[]")}, ${sqlValue(row.payload_json || "{}")}, ${sqlValue(row.created_by || "")}, ${sqlValue(row.created_at || nowIso())}, ${sqlValue(row.updated_at || nowIso())})
ON CONFLICT(handoff_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  node_id=excluded.node_id,
  worker_run_id=excluded.worker_run_id,
  manager_agent=excluded.manager_agent,
  successor_worker_run_id=excluded.successor_worker_run_id,
  handoff_info_id=excluded.handoff_info_id,
  status=excluded.status,
  reason=excluded.reason,
  summary=excluded.summary,
  source_context_refs_json=excluded.source_context_refs_json,
  artifact_refs_json=excluded.artifact_refs_json,
  receipt_refs_json=excluded.receipt_refs_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at;`);
}

const WORKFLOW_V2_REVIEW_ACTION_HANDLERS = createWorkflowV2ReviewActionHandlers({
  ensureWorkflowLayout,
  normalizeOptionalAgentId,
  nowIso,
  workflowV2LoadPlanRow,
  workflowV2PatchPlanWorkflowState,
  workflowV2PlanOrchestrationPattern,
  workflowV2RequireSessionRunPatch,
  workflowV2RestoreManagerReviewRow,
  workflowV2RestoreWorkerRunRow
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

function workflowFilterMatches(workflowId, value) {
  return !workflowId || String(value || "").trim() === workflowId;
}

function humanGateRiskTier(input = {}) {
  const text = [
    input.sourceType,
    input.gateType,
    input.title,
    input.summary,
    input.workflowId,
    input.meetingId,
    JSON.stringify(input.payload || {})
  ].join(" ").toLowerCase();
  if (/(real[- ]?trade|live[- ]?trade|live_strategy|live strategy|strategy launch|资金|实盘|真实交易|production|deploy|cutover|gateway restart|restart gateway|database migration|schema migration|private key|secret|oauth|permission expansion|权限扩大)/.test(text)) return "P0";
  if (/(trade|order|execution|risk_budget|position|gateway|openclaw config|hermes migration|runtime migration|cron|heartbeat|config|model route|incident|权限|风控|迁移|部署|重启)/.test(text)) return "P1";
  if (/(human_gate|review|approval|automation|workflow|dry[- ]?run|observability|report|governance|制度|治理|观察)/.test(text)) return "P2";
  return "P3";
}

function humanGateDefaultAction(riskTier, input = {}) {
  const text = [input.sourceType, input.gateType, input.summary, input.title].join(" ").toLowerCase();
  if (riskTier === "P0") return "flash_lane_individual_review_required";
  if (riskTier === "P1") return "individual_review_required";
  if (/reject|blocked|failed|failure|异常|失败|阻塞/.test(text)) return "ask_revision";
  if (riskTier === "P2") return "review_then_batch";
  return "batch_approve_allowed";
}

function humanGateActionHint(item) {
  if (item.defaultAction === "flash_lane_individual_review_required") return "flash-lane single approve/reject/revise only";
  if (item.riskTier === "P0" || item.riskTier === "P1") return "single approve/reject/revise only";
  if (item.defaultAction === "ask_revision") return "ask responsible agent for revision";
  if (item.defaultAction === "review_then_batch") return "eligible for batch after quick review";
  return "eligible for batch approve";
}

function humanGateItem(sourceType, sourceId, fields = {}) {
  const riskTier = fields.riskTier || humanGateRiskTier({ sourceType, ...fields });
  const defaultAction = fields.defaultAction || humanGateDefaultAction(riskTier, { sourceType, ...fields });
  const requiresIndividualApproval = fields.requiresIndividualApproval ?? ["P0", "P1"].includes(riskTier);
  return {
    itemId: `item.${cleanFileSegment(sourceType)}.${cleanFileSegment(sourceId)}`,
    sourceType,
    sourceId,
    workflowId: String(fields.workflowId || "").trim(),
    meetingId: String(fields.meetingId || fields.workflowId || "").trim(),
    title: compactText(fields.title || sourceId, 120),
    summary: compactText(fields.summary || "", 360),
    riskTier,
    defaultAction,
    requiresIndividualApproval: Boolean(requiresIndividualApproval),
    status: fields.status || "pending",
    actionHint: fields.actionHint || "",
    buttons: Array.isArray(fields.buttons) ? fields.buttons : [],
    createdAt: fields.createdAt || nowIso(),
    payload: fields.payload || {},
    path: fields.path || ""
  };
}

function riskSummaryFor(items) {
  const summary = { total: items.length, P0: 0, P1: 0, P2: 0, P3: 0, individual: 0, batchEligible: 0, buttonChoices: 0 };
  for (const item of items) {
    summary[item.riskTier] = Number(summary[item.riskTier] || 0) + 1;
    if (item.requiresIndividualApproval) summary.individual += 1;
    else summary.batchEligible += 1;
    summary.buttonChoices += Array.isArray(item.buttons) ? item.buttons.length : 0;
  }
  return summary;
}

function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, "'\\''")}'`;
}

function humanGateButtonFromRow(row, rootDir = "") {
  const callbackToken = String(row.callback_token || "").trim();
  const rootArg = rootDir ? ` --root ${shellQuote(rootDir)}` : ` --root "$ROOT"`;
  return {
    buttonId: row.button_id,
    callbackToken,
    humanGateId: row.human_gate_id,
    workflowId: row.workflow_id || "",
    meetingId: row.meeting_id || "",
    label: row.label,
    decisionStatus: row.decision_status,
    role: row.button_role || "",
    artifactRef: row.artifact_ref || "",
    summary: row.summary || "",
    prompt: row.prompt || "",
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    selectedBy: row.selected_by || "",
    selectedAt: row.selected_at || "",
    feedbackStatus: row.feedback_status || "",
    feedbackText: row.feedback_text || "",
    feedbackReceivedAt: row.feedback_received_at || "",
    feedbackPayload: parseJsonValue(row.feedback_payload_json, {}),
    callbackData: callbackToken ? `tawhg:${callbackToken}` : "",
    toolAction: { action: "human_gate.button_callback", token: callbackToken, actor: "flashcat" },
    feedbackToolAction: { action: "human_gate.feedback", token: callbackToken, actor: "flashcat", text: "<闪电猫原话或审核意见>" },
    cliCommand: callbackToken ? `node bin/cat-meeting-governance.mjs human-gate-callback --token ${callbackToken} --actor flashcat${rootArg}` : "",
    feedbackCliCommand: callbackToken ? `node bin/cat-meeting-governance.mjs human-gate-feedback --token ${callbackToken} --actor flashcat --text "<闪电猫原话或审核意见>"${rootArg}` : "",
    payload: parseJsonValue(row.payload_json, {})
  };
}

function humanGateBody(payload = {}) {
  return parseJsonValue(payload.payload, payload.payload || {});
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

function humanGateArtifactRef(row, payload = {}, body = {}) {
  return String(body.artifactRef || body.artifact_ref || body.resumePointer || body.resume_pointer || body.raw?.artifactRef || body.raw?.artifact_ref || row.path || "").trim();
}

function humanGateSummary(payload = {}, body = {}) {
  return String(body.summary || payload.summary || "").trim();
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

function humanGateButtonStatus(value = {}) {
  return String(value.decisionStatus || value.decision_status || value.status || "").trim();
}

function humanGateButtonRole(value = {}) {
  return String(value.role || value.buttonRole || value.button_role || "").trim();
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

function humanGatePlanOptionButtons(buttons = []) {
  return buttons.filter((button) => {
    const status = humanGateButtonStatus(button);
    const role = humanGateButtonRole(button);
    const controlToken = String(button.control || button.controlId || button.control_id || role || status || "").trim().toLowerCase();
    const isControl = ["reject", "rejected", "pause", "paused", "terminate", "terminated"].includes(controlToken);
    const hasOptionIdentity = Boolean(firstText(button.optionId, button.option_id, button.optionKey, button.option_key, button.key, button.id));
    const roleLooksLikeOption = /approve[_-]?option|option|plan|alternative/i.test(role);
    return (status === "approved" || (!status && (hasOptionIdentity || roleLooksLikeOption))) && !isControl;
  });
}

function auditHumanGatePlanOptions(buttons = []) {
  const planButtons = humanGatePlanOptionButtons(buttons);
  const ok = planButtons.length >= HUMAN_GATE_APPROVE_OPTION_MIN && planButtons.length <= HUMAN_GATE_APPROVE_OPTION_MAX;
  return {
    ok,
    planCount: planButtons.length,
    requiredPlanCountMin: HUMAN_GATE_APPROVE_OPTION_MIN,
    requiredPlanCountMax: HUMAN_GATE_APPROVE_OPTION_MAX,
    reason: ok
      ? ""
      : planButtons.length < HUMAN_GATE_APPROVE_OPTION_MIN
        ? "human_gate_requires_at_least_two_alternatives"
        : "human_gate_allows_at_most_five_alternatives"
  };
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

function combineHumanGateAudits(...audits) {
  const failed = audits.filter((audit) => audit && !audit.ok);
  if (!failed.length) return { ok: true, reason: "", audits };
  const details = failed.reduce((acc, audit) => ({ ...acc, ...audit }), {});
  return {
    ...details,
    ok: false,
    reason: failed.map((audit) => audit.reason).filter(Boolean).join(";") || "human_gate_audit_failed",
    audits
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

async function humanGateButtonsByGate(paths, gateIds = []) {
  const ids = [...new Set(gateIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id IN (${ids.map(sqlValue).join(",")})
ORDER BY created_at ASC;`, { json: true });
  const grouped = new Map();
  for (const row of rows) {
    const button = humanGateButtonFromRow(row, paths.root);
    const list = grouped.get(button.humanGateId) || [];
    list.push(button);
    grouped.set(button.humanGateId, list);
  }
  return grouped;
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

async function collectHumanGateInboxItems(paths, input = {}) {
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));
  const items = [];
  const pendingHumanGateIds = [];

  const humanGates = await sqlite(paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending'
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
  for (const row of humanGates) {
    const payload = parseJsonValue(row.payload_json, {});
    const body = parseJsonValue(payload.payload, payload.payload || {});
    const gateWorkflowId = body.workflowId || payload.workflowId || row.parent_object_id || "";
    if (!workflowFilterMatches(workflowId, gateWorkflowId)) continue;
    const gateType = body.gateType || payload.gateType || "human_gate_record";
    pendingHumanGateIds.push(row.object_id);
    items.push(humanGateItem("human_gate_record", row.object_id, {
      workflowId: gateWorkflowId,
      meetingId: gateWorkflowId,
      title: `${gateType}: ${row.object_id}`,
      summary: payload.summary || body.summary || "",
      gateType,
      status: row.status,
      createdAt: row.created_at,
      path: row.path,
      payload: { sourceAgent: row.source_agent, parentObjectId: row.parent_object_id, payload }
    }));
  }
  const buttonGroups = await humanGateButtonsByGate(paths, pendingHumanGateIds);
  for (const item of items) {
    if (item.sourceType !== "human_gate_record") continue;
    const buttons = buttonGroups.get(item.sourceId) || [];
    if (!buttons.length) {
      item.status = "blocked_missing_buttons";
      item.blocked = true;
      item.actionHint = "blocked: human_gate_record has no active buttons; cat_claw must not approve it and cat_brain must regenerate a button-first Human Gate";
      item.payload = { ...item.payload, buttons: [] };
      continue;
    }
    item.buttons = buttons;
    item.payload = { ...item.payload, buttons };
    item.actionHint = "select one recorded button; do not infer intent from natural language";
  }

  const reviewGates = await sqlite(paths.dbFile, `
SELECT gate_id, instrument_id, workflow_id, gate_type, status, summary, reviewer_agent, human_gate_required, resume_pointer, expires_at, evidence_paths_json, created_at
FROM review_gates
WHERE status='pending' OR (human_gate_required=1 AND status NOT IN ('approved','rejected','waived','expired','cancelled','done'))
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
  for (const row of reviewGates) {
    if (!workflowFilterMatches(workflowId, row.workflow_id)) continue;
    items.push(humanGateItem("review_gate", row.gate_id, {
      workflowId: row.workflow_id,
      meetingId: row.workflow_id,
      title: `${row.gate_type}: ${row.gate_id}`,
      summary: row.summary || "",
      gateType: row.gate_type,
      status: row.status,
      createdAt: row.created_at,
      payload: {
        instrumentId: row.instrument_id,
        reviewerAgent: row.reviewer_agent,
        humanGateRequired: Boolean(Number(row.human_gate_required || 0)),
        resumePointer: row.resume_pointer,
        expiresAt: row.expires_at,
        evidencePaths: parseJsonValue(row.evidence_paths_json, [])
      }
    }));
  }

  const gatedTasks = await sqlite(paths.dbFile, `
SELECT task_id, workflow_id, phase, owner_agent, runtime, agent_id, task_type, status, priority, expected_artifact, summary, due_at, created_at
FROM workflow_tasks
WHERE human_gate_required=1 AND status NOT IN ('done','failed','cancelled')
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
  for (const row of gatedTasks) {
    if (!workflowFilterMatches(workflowId, row.workflow_id)) continue;
    items.push(humanGateItem("workflow_task_gate", row.task_id, {
      workflowId: row.workflow_id,
      meetingId: row.workflow_id,
      title: `${row.task_type}: ${row.task_id}`,
      summary: row.summary || row.expected_artifact || "",
      gateType: "workflow_task_human_gate",
      status: row.status,
      createdAt: row.created_at,
      payload: {
        phase: row.phase,
        ownerAgent: row.owner_agent,
        runtime: row.runtime,
        agentId: row.agent_id,
        priority: row.priority,
        dueAt: row.due_at
      }
    }));
  }

  const reportDeliveryRows = await sqlite(paths.dbFile, `
SELECT outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at
FROM telegram_outbox
WHERE status IN ('queued','failed') AND message_type IN ('workflow_secretary_report','human_gate_report','human_gate_request')
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
  for (const row of reportDeliveryRows) {
    const payload = parseJsonValue(row.payload_json, {});
    const itemWorkflowId = payload.workflowId || payload.workflow_id || row.meeting_id || "";
    if (!workflowFilterMatches(workflowId, itemWorkflowId)) continue;
    const riskTier = row.status === "failed" ? "P1" : "P2";
    items.push(humanGateItem("cat_claw_delivery", row.outbox_id, {
      workflowId: itemWorkflowId,
      meetingId: row.meeting_id,
      title: `${row.message_type}: ${row.outbox_id}`,
      summary: compactText(row.text || "", 320),
      gateType: row.message_type,
      riskTier,
      defaultAction: row.status === "failed" ? "repair_delivery" : "deliver_outbox",
      requiresIndividualApproval: false,
      status: row.status,
      createdAt: row.created_at,
      actionHint: row.status === "failed" ? "repair or resend delivery" : "deliver queued summary",
      payload: { targetKind: row.target_kind, targetRef: row.target_ref, updatedAt: row.updated_at, payload }
    }));
  }

  return items.slice(0, limit);
}

function renderHumanGateInboxHtml(batch) {
  const riskClass = (tier) => `risk-${String(tier || "P3").toLowerCase()}`;
  const buttonHtml = (buttons = []) => {
    if (!buttons.length) return `<span class="muted">-</span>`;
    return buttons.map((button) => `
            <div class="choice-row">
              <button type="button" class="choice choice-${escapeHtml(button.decisionStatus)}" data-command="${escapeHtml(button.cliCommand || "")}">${escapeHtml(button.label)}</button>
              <div class="choice-meta">
                <span>${escapeHtml(button.decisionStatus)}</span>
                <span>${escapeHtml(button.status)}</span>
                ${button.artifactRef ? `<span>artifact: ${escapeHtml(button.artifactRef)}</span>` : ""}
                <code>${escapeHtml(button.callbackData || "")}</code>
                <code>${escapeHtml(button.cliCommand || "")}</code>
              </div>
            </div>`).join("\n");
  };
  const rowHtml = batch.items.map((item) => `
        <tr class="${riskClass(item.riskTier)}">
          <td>${escapeHtml(item.riskTier)}</td>
          <td>${escapeHtml(item.sourceType)}<br><code>${escapeHtml(item.sourceId)}</code></td>
          <td>${escapeHtml(item.workflowId || "-")}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.summary || "-")}</td>
          <td>${buttonHtml(item.buttons)}</td>
          <td>${escapeHtml(item.defaultAction)}</td>
          <td>${item.requiresIndividualApproval ? "single" : "batch ok"}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.actionHint || humanGateActionHint(item))}</td>
        </tr>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Human Gate Inbox ${escapeHtml(batch.batchId)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #1f2933; }
    main { max-width: 1280px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .meta { color: #52606d; margin-bottom: 20px; }
    .summary { display: grid; grid-template-columns: repeat(7, minmax(100px, 1fr)); gap: 8px; margin: 16px 0 20px; }
    .metric { background: white; border: 1px solid #d9e2ec; border-radius: 6px; padding: 10px 12px; }
    .metric strong { display: block; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #d9e2ec; }
    th, td { text-align: left; vertical-align: top; padding: 10px; border-bottom: 1px solid #e4e7eb; font-size: 13px; }
    th { background: #eef2f7; position: sticky; top: 0; z-index: 1; }
    code { font-size: 12px; color: #334e68; }
    .muted { color: #829ab1; }
    .choice-row { display: grid; grid-template-columns: minmax(130px, 0.8fr) minmax(220px, 1.4fr); gap: 8px; align-items: start; padding: 6px 0; border-bottom: 1px solid #eef2f7; }
    .choice-row:last-child { border-bottom: 0; }
    .choice { appearance: none; border: 1px solid #bcccdc; background: #f8fafc; color: #1f2933; border-radius: 5px; padding: 7px 9px; font-size: 12px; font-weight: 650; text-align: left; cursor: pointer; }
    .choice-approved { border-color: #15803d; background: #f0fdf4; color: #14532d; }
    .choice-rejected { border-color: #b91c1c; background: #fef2f2; color: #7f1d1d; }
    .choice-paused, .choice-pending, .choice-expired { border-color: #64748b; background: #f8fafc; color: #334155; }
    .choice-terminated { border-color: #7f1d1d; background: #fee2e2; color: #7f1d1d; }
    .choice-meta { display: flex; flex-direction: column; gap: 4px; color: #52606d; }
    .choice-meta code { white-space: normal; overflow-wrap: anywhere; }
    .copied { outline: 2px solid #0f766e; }
    .risk-p0 td:first-child { border-left: 5px solid #b91c1c; font-weight: 700; }
    .risk-p1 td:first-child { border-left: 5px solid #d97706; font-weight: 700; }
    .risk-p2 td:first-child { border-left: 5px solid #2563eb; font-weight: 700; }
    .risk-p3 td:first-child { border-left: 5px solid #16a34a; font-weight: 700; }
    .empty { background: white; border: 1px solid #d9e2ec; border-radius: 6px; padding: 20px; }
    @media (max-width: 900px) { .summary { grid-template-columns: repeat(2, 1fr); } table { min-width: 1250px; } .scroll { overflow-x: auto; } }
  </style>
</head>
<body>
<main>
  <h1>Flashcat Human Gate Console</h1>
  <div class="meta">batch_id: <code>${escapeHtml(batch.batchId)}</code> | created_at: ${escapeHtml(batch.createdAt)} | target: ${escapeHtml(batch.targetRef)}</div>
  <div class="meta">Choice buttons copy the exact callback command. Cat Claw must record a selected button token, not infer Flashcat intent from free text.</div>
  <section class="summary">
    <div class="metric"><span>Total</span><strong>${batch.riskSummary.total}</strong></div>
    <div class="metric"><span>P0</span><strong>${batch.riskSummary.P0}</strong></div>
    <div class="metric"><span>P1</span><strong>${batch.riskSummary.P1}</strong></div>
    <div class="metric"><span>P2</span><strong>${batch.riskSummary.P2}</strong></div>
    <div class="metric"><span>P3</span><strong>${batch.riskSummary.P3}</strong></div>
    <div class="metric"><span>Batch eligible</span><strong>${batch.riskSummary.batchEligible}</strong></div>
    <div class="metric"><span>Button choices</span><strong>${batch.riskSummary.buttonChoices}</strong></div>
  </section>
  ${batch.items.length ? `<div class="scroll"><table>
    <thead>
      <tr>
        <th>Risk</th>
        <th>Source</th>
        <th>Workflow</th>
        <th>Title</th>
        <th>Summary</th>
        <th>Choice buttons</th>
        <th>Default action</th>
        <th>Approval mode</th>
        <th>Status</th>
        <th>Action hint</th>
      </tr>
    </thead>
    <tbody>${rowHtml}
    </tbody>
  </table></div>` : `<div class="empty">No pending Human Gate items.</div>`}
</main>
<script>
  document.querySelectorAll(".choice").forEach((button) => {
    button.addEventListener("click", async () => {
      const command = button.dataset.command || "";
      if (!command) return;
      try {
        await navigator.clipboard.writeText(command);
        button.classList.add("copied");
        const original = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = original;
          button.classList.remove("copied");
        }, 1200);
      } catch {
        window.prompt("Copy Human Gate callback command", command);
      }
    });
  });
</script>
</body>
</html>`;
}

function renderHumanGateTelegramSummary(batch) {
  const s = batch.riskSummary;
  const topItems = batch.items.slice(0, 5).map((item) => `- ${item.riskTier} ${item.sourceType} ${item.workflowId || "-"}: ${item.title}`).join("\n");
  return [
    `Human Gate Console | ${batch.createdAt}`,
    `batch_id: ${batch.batchId}`,
    `pending: ${s.total} | buttons: ${s.buttonChoices} | P0 ${s.P0} | P1 ${s.P1} | P2 ${s.P2} | P3 ${s.P3}`,
    `individual: ${s.individual} | batch_eligible: ${s.batchEligible}`,
    `html: ${batch.htmlPath}`,
    "",
    topItems || "- no pending items",
    "",
    "Suggested handling: P0/P1 single review; P2/P3 can be batched after quick scan."
  ].join("\n");
}

async function enqueueTelegramOutbox(paths, input) {
  const outboxId = input.outboxId || input.outbox_id || safeId("tg");
  const createdAt = nowIso();
  const payload = parseJsonValue(input.payload, input.payload || {});
  const messageType = input.messageType || input.message_type || "meeting_live";
  const status = input.status || "queued";
  const targetRef = input.targetRef || input.target_ref || "";
  if (TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES.has(String(messageType)) && ["queued", "delivering"].includes(String(status)) && !String(targetRef || "").trim()) {
    throw new Error(`telegram_outbox target_ref is required for ${messageType}`);
  }
  const existing = await sqlite(paths.dbFile, `SELECT outbox_id, status, message_type FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
  if (existing[0]) {
    const existingStatus = String(existing[0].status || "");
    const existingType = String(existing[0].message_type || "");
    if (messageType === "human_gate_request" && existingType === "human_gate_request" && ["cancelled", "failed"].includes(existingStatus)) {
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET meeting_id=${sqlValue(input.meetingId || input.meeting_id || "")},
    target_kind=${sqlValue(input.targetKind || input.target_kind || "group")},
    target_ref=${sqlValue(targetRef)},
    status=${sqlValue(status)},
    text=${sqlValue(input.text || "")},
    payload_json=${sqlValue(JSON.stringify(payload))},
    updated_at=${sqlValue(createdAt)}
WHERE outbox_id=${sqlValue(outboxId)};`);
      await writeJsonArtifact(paths.root, path.join(paths.telegramDir, "outbox"), outboxId, {
        outboxId,
        meetingId: input.meetingId || input.meeting_id || "",
        targetKind: input.targetKind || input.target_kind || "group",
        targetRef,
        messageType,
        status,
        text: input.text || "",
        payload,
        createdAt,
        updatedAt: createdAt,
        requeuedFromStatus: existingStatus
      });
      return { outboxId, status, deduped: true, requeued: true, previousStatus: existingStatus };
    }
    return { outboxId, status: existingStatus, deduped: true };
  }
  await sqlite(paths.dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES (${sqlValue(outboxId)}, ${sqlValue(input.meetingId || input.meeting_id || "")}, ${sqlValue(input.targetKind || input.target_kind || "group")}, ${sqlValue(targetRef)}, ${sqlValue(messageType)}, ${sqlValue(status)}, ${sqlValue(input.text || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  await writeJsonArtifact(paths.root, path.join(paths.telegramDir, "outbox"), outboxId, {
    outboxId,
    meetingId: input.meetingId || input.meeting_id || "",
    targetKind: input.targetKind || input.target_kind || "group",
    targetRef,
    messageType,
    status,
    text: input.text || "",
    payload,
    createdAt
  });
  return { outboxId, status };
}

function telegramChunks(text, limit = 3500) {
  const value = String(text || "").trim();
  if (value.length <= limit) return [value];
  const chunks = [];
  let remaining = value;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.map((chunk, index) => chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n${chunk}` : chunk);
}

function normalizeTelegramBotApiChatId(value = "") {
  return String(value || "").trim().replace(/^telegram:/, "");
}

function noProxyList() {
  return String(process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function noProxyMatches(hostname = "", port = "") {
  const host = String(hostname || "").toLowerCase();
  const hostPort = `${host}:${String(port || "").trim()}`;
  for (const entryRaw of noProxyList()) {
    const entry = entryRaw.toLowerCase();
    if (entry === "*") return true;
    if (entry.includes(":") && entry === hostPort) return true;
    const domain = entry.replace(/^\./, "");
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function proxyUrlForHttpsTarget(targetUrl) {
  const url = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl || ""));
  if (noProxyMatches(url.hostname, url.port || "443")) return "";
  return firstText(
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy
  );
}

function proxyAuthorizationHeader(proxyUrl) {
  if (!proxyUrl.username) return "";
  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password || "");
  return `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n`;
}

function connectTlsViaHttpProxy(proxyRawUrl, target, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let proxyUrl;
    try {
      proxyUrl = new URL(proxyRawUrl);
    } catch (error) {
      reject(error);
      return;
    }
    if (!["http:", "https:"].includes(proxyUrl.protocol)) {
      reject(new Error(`unsupported proxy protocol for telegram bot api: ${proxyUrl.protocol}`));
      return;
    }

    const proxyPort = Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80));
    const targetHost = String(target.hostname || target.host || "").trim();
    const targetPort = Number(target.port || 443);
    const connectOptions = { host: proxyUrl.hostname, port: proxyPort };
    const rawSocket = proxyUrl.protocol === "https:"
      ? tls.connect({ ...connectOptions, servername: proxyUrl.hostname })
      : net.connect(connectOptions);
    let settled = false;
    let buffered = Buffer.alloc(0);

    const cleanup = () => {
      rawSocket.removeListener("data", onData);
      rawSocket.removeListener("error", onError);
      rawSocket.removeListener("timeout", onTimeout);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rawSocket.destroy();
      reject(error);
    };
    const onError = (error) => fail(error);
    const onTimeout = () => fail(new Error("telegram bot api proxy connect timeout"));
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffered.slice(0, headerEnd).toString("latin1");
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(header)) {
        fail(new Error(`telegram bot api proxy connect failed: ${header.split("\r\n")[0] || "unknown response"}`));
        return;
      }
      cleanup();
      const secureSocket = tls.connect({
        socket: rawSocket,
        servername: target.servername || targetHost,
        ALPNProtocols: ["http/1.1"]
      }, () => {
        if (settled) return;
        settled = true;
        secureSocket.setTimeout(0);
        resolve(secureSocket);
      });
      secureSocket.once("error", fail);
      secureSocket.setTimeout(timeoutMs, () => fail(new Error("telegram bot api tls handshake timeout")));
    };
    const sendConnect = () => {
      const auth = proxyAuthorizationHeader(proxyUrl);
      rawSocket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n${auth}\r\n`);
    };

    rawSocket.setTimeout(timeoutMs, onTimeout);
    rawSocket.once("error", onError);
    rawSocket.on("data", onData);
    rawSocket.once(proxyUrl.protocol === "https:" ? "secureConnect" : "connect", sendConnect);
  });
}

function telegramBotApiHttpPost(url, body, timeoutMs = 30000) {
  const targetUrl = url instanceof URL ? url : new URL(String(url || ""));
  const payload = JSON.stringify(body);
  const proxyUrl = proxyUrlForHttpsTarget(targetUrl);
  return new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: Number(targetUrl.port || 443),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    };
    if (proxyUrl) {
      requestOptions.createConnection = (options, callback) => {
        connectTlsViaHttpProxy(proxyUrl, {
          hostname: targetUrl.hostname,
          port: Number(targetUrl.port || 443),
          servername: options.servername || targetUrl.hostname
        }, timeoutMs).then((socket) => callback(null, socket), callback);
      };
    }
    const req = https.request(requestOptions, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          req.destroy(new Error("telegram bot api response too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage || "",
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("telegram bot api request timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function telegramBotApiPost(token, method, body, timeoutMs = 30000) {
  const response = await telegramBotApiHttpPost(`https://api.telegram.org/bot${token}/${method}`, body, timeoutMs);
  const parsed = parseJsonValue(response.text, null);
  if (response.statusCode < 200 || response.statusCode >= 300 || !parsed || parsed.ok === false) {
    const description = parsed?.description || response.text || response.statusMessage;
    throw new Error(`telegram bot api ${method} failed: ${String(description).slice(0, 1000)}`);
  }
  return parsed.result || parsed;
}

async function deliverTelegramOutboxRowViaWebApp(paths, row, input, context) {
  const payload = context.payload || {};
  const replyMarkup = payload.telegramReplyMarkup || payload.reply_markup || null;
  if (!replyMarkup?.inline_keyboard?.length) return null;
  const account = context.account;
  const target = normalizeTelegramBotApiChatId(context.target);
  if (!target) return null;
  const token = await resolveTelegramBotToken(account, input);
  if (!token) return null;
  const deliveredAt = nowIso();
  const receipts = Array.isArray(payload.delivery?.receipts) ? [...payload.delivery.receipts] : [];
  const startIndex = Math.min(receipts.length, context.chunks.length);
  try {
    for (const [index, chunk] of context.chunks.entries()) {
      if (index < startIndex) continue;
      const receipt = await telegramBotApiPost(token, "sendMessage", {
        chat_id: target,
        text: chunk,
        disable_web_page_preview: true,
        ...(index === context.chunks.length - 1 ? { reply_markup: replyMarkup } : {})
      }, context.timeoutSeconds * 1000);
      receipts.push(receipt);
    }
    const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, mode: "direct_bot_api_web_app", deliveredAt, receipts } };
    await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='sent', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(deliveredAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
    return { outboxId: row.outbox_id, status: "sent", account, target, mode: "direct_bot_api_web_app", parts: context.chunks.length, receipts };
  } catch (error) {
    const failedAt = nowIso();
    if (receipts.length > 0) {
      const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, mode: "direct_bot_api_web_app", failedAt, error: String(error?.message || error).slice(0, 2000), receipts } };
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='failed', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(failedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
      return { outboxId: row.outbox_id, status: "failed", account, target, mode: "direct_bot_api_web_app", error: String(error?.message || error).slice(0, 2000), receipts };
    }
    return { outboxId: row.outbox_id, status: "web_app_direct_delivery_unavailable", account, target, error: String(error?.message || error).slice(0, 2000), receipts };
  }
}

async function claimTelegramOutboxDelivery(paths, row, input = {}) {
  const status = String(row.status || "").trim();
  if (!["queued", "failed", "delivering"].includes(status)) {
    return { claimed: false, row, reason: `status_${status || "unknown"}` };
  }
  const claimedAt = nowIso();
  const staleBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
  const payload = parseJsonValue(row.payload_json, {});
  const claim = {
    claimId: safeId("tg_claim"),
    claimedAt,
    owner: firstText(input.owner, input.from, "workflow"),
    previousStatus: status
  };
  const updatedPayload = { ...payload, deliveryClaim: claim };
  const statusPredicate = status === "delivering"
    ? `status='delivering' AND updated_at <= ${sqlValue(staleBefore)}`
    : `status=${sqlValue(status)}`;
  const changed = await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='delivering', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(claimedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)} AND (${statusPredicate});
SELECT changes() AS changed;`, { json: true });
  if (Number(changed?.[0]?.changed || 0) !== 1) {
    const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(row.outbox_id)} LIMIT 1;`, { json: true });
    return { claimed: false, row: rows[0] || row, reason: "not_claimed" };
  }
  return {
    claimed: true,
    row: {
      ...row,
      status: "delivering",
      payload_json: JSON.stringify(updatedPayload),
      updated_at: claimedAt
    },
    claim
  };
}

async function deliverTelegramOutboxRow(paths, row, input = {}) {
  const claim = await claimTelegramOutboxDelivery(paths, row, input);
  if (!claim.claimed) {
    return { outboxId: row.outbox_id, status: claim.row?.status || row.status || "not_claimed", skipped: true, reason: claim.reason };
  }
  row = claim.row;
  const payload = parseJsonValue(row.payload_json, {});
  const account = String(input.account || payload.account || "cat_claw").trim();
  const explicitTarget = String(input.target || "").trim();
  const rowTarget = String(row.target_ref || "").trim();
  if (!explicitTarget && !rowTarget) {
    const failedAt = nowIso();
    const error = "telegram_outbox target_ref is required unless an explicit target override is provided";
    const updatedPayload = { ...payload, delivery: { channel: "telegram", account, failedAt, error } };
    await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='failed', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(failedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
    const result = { outboxId: row.outbox_id, status: "failed", account, error };
    await updateMessageFlowFromTelegramDelivery(paths, row, result);
    return result;
  }
  const target = explicitTarget || rowTarget;
  const openclawBin = String(input.openclawBin || input.openclaw_bin || "openclaw").trim();
  const timeoutSeconds = Math.max(5, Math.min(120, Number(input.timeoutSeconds || input.timeout_seconds || 30)));
  const chunks = telegramChunks(row.text);
  const deliveredAt = nowIso();
  const receipts = Array.isArray(payload.delivery?.receipts) ? [...payload.delivery.receipts] : [];
  const startIndex = Math.min(receipts.length, chunks.length);
  try {
    const webAppDelivery = await deliverTelegramOutboxRowViaWebApp(paths, row, input, { payload, account, target, chunks, timeoutSeconds });
    if (webAppDelivery?.status === "sent" || webAppDelivery?.status === "failed") {
      await updateMessageFlowFromTelegramDelivery(paths, row, webAppDelivery);
      return webAppDelivery;
    }
    if (webAppDelivery?.status === "web_app_direct_delivery_unavailable") {
      payload.webAppDirectDeliveryFallback = {
        attemptedAt: nowIso(),
        error: webAppDelivery.error,
        reason: "falling_back_to_openclaw_callback_buttons"
      };
    }
    for (const [index, chunk] of chunks.entries()) {
      if (index < startIndex) continue;
      const args = [
        "message",
        "send",
        "--channel",
        "telegram",
        "--account",
        account,
        "--target",
        target,
        "--message",
        chunk,
        "--json"
      ];
      if (payload.presentation && index === chunks.length - 1) {
        args.push("--presentation", JSON.stringify(payload.presentation));
      }
      const { stdout, stderr } = await execFileAsync(openclawBin, args, {
        cwd: paths.root,
        timeout: timeoutSeconds * 1000,
        maxBuffer: 4 * 1024 * 1024
      });
      const parsed = parseJsonValue(String(stdout || "").trim(), null);
      if (!parsed || parsed.payload?.ok === false || parsed.ok === false) {
        throw new Error(`telegram send failed: ${String(stdout || stderr || "").slice(0, 1000)}`);
      }
      receipts.push(parsed.payload || parsed);
    }
    const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, deliveredAt, receipts } };
    await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='sent', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(deliveredAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
    const result = { outboxId: row.outbox_id, status: "sent", account, target, parts: chunks.length, receipts };
    await updateMessageFlowFromTelegramDelivery(paths, row, result);
    return result;
  } catch (error) {
    const failedAt = nowIso();
    const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, failedAt, error: String(error?.message || error).slice(0, 2000), receipts } };
    await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='failed', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(failedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
    const result = { outboxId: row.outbox_id, status: "failed", account, target, error: String(error?.message || error).slice(0, 2000), receipts };
    await updateMessageFlowFromTelegramDelivery(paths, row, result);
    return result;
  }
}

async function autoDeliverReportOutbox(paths, ingest, input = {}) {
  if (!ingest?.reportOutbox?.outboxId) return null;
  const enabled = boolOption(input.autoDeliverReportOutbox ?? input.auto_deliver_report_outbox ?? input.reportDelivery ?? input.report_delivery, true);
  if (!enabled) return { outboxId: ingest.reportOutbox.outboxId, status: "queued", skipped: true };
  const rows = await sqlite(paths.dbFile, `
SELECT * FROM telegram_outbox
WHERE outbox_id=${sqlValue(ingest.reportOutbox.outboxId)}
LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) return { outboxId: ingest.reportOutbox.outboxId, status: "missing" };
  if (row.status !== "queued") return { outboxId: row.outbox_id, status: row.status, skipped: true };
  return deliverTelegramOutboxRow(paths, row, input);
}

function messageFlowIdFromParts(...parts) {
  const seed = parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n") || safeId("flow");
  return `flow.${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function messageFlowSendTargets(input = {}) {
  const rawTargets = input.targets ?? input.toAgents ?? input.to_agents ?? input.toAgent ?? input.to_agent ?? input.to ?? input.target ?? input.agentId ?? input.agent_id;
  const targetItems = Array.isArray(rawTargets)
    ? rawTargets
    : (typeof rawTargets === "string" ? toList(rawTargets) : (rawTargets ? [rawTargets] : []));
  const fallbackRuntime = String(input.targetRuntime || input.target_runtime || input.runtime || "").trim();
  const seen = new Set();
  const targets = [];
  for (const item of targetItems) {
    let runtime = "";
    let agentId = "";
    if (item && typeof item === "object") {
      runtime = String(item.runtime || item.platform || "").trim();
      agentId = String(item.agentId || item.agent_id || item.agent || item.id || "").trim();
    } else {
      const text = String(item || "").trim();
      if (!text) continue;
      const parts = text.includes(":") ? text.split(":", 2) : ["", text];
      runtime = parts[0] || "";
      agentId = parts[1] || "";
    }
    agentId = normalizeAgentId(agentId);
    runtime = runtime ? normalizeRuntime(runtime) : (fallbackRuntime ? normalizeRuntime(fallbackRuntime) : "");
    const key = `${runtime || "*"}:${agentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ runtime, agentId, key });
  }
  if (!targets.length) throw new Error("at least one target/toAgent is required for workflow.message_flow.send");
  return targets;
}

function messageFlowAckTimeoutSeconds(input = {}) {
  const raw = input.ackTimeoutSeconds ?? input.ack_timeout_seconds ?? DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS;
  return Math.max(5, Math.min(300, Number(raw) || DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS));
}

function messageFlowSendPrompt(input = {}) {
  const subject = String(input.subject || input.title || "").trim();
  const body = String(input.body || input.text || input.message || input.content || "").trim();
  const sourceRefs = toList(input.sourceRefs || input.source_refs || input.artifacts || input.artifactRefs || input.artifact_refs);
  const requiresAck = boolOption(input.requiresAck ?? input.requires_ack, false);
  const ackTimeoutSeconds = messageFlowAckTimeoutSeconds(input);
  if (!subject && !body) throw new Error("body/text/message or subject is required for workflow.message_flow.send");
  const lines = [];
  if (subject) lines.push(`Subject: ${subject}`);
  if (body) lines.push(body);
  if (sourceRefs.length) lines.push(["Source refs:", ...sourceRefs.map((ref) => `- ${ref}`)].join("\n"));
  if (requiresAck) {
    lines.push([
      "Immediate ACK required:",
      `- First runtime turn must return ACK_RECEIVED within ${ackTimeoutSeconds}s after receiving the complete message.`,
      "- The ACK only confirms receipt and message integrity; it is not the semantic task result.",
      "- Include an ISO timestamp, dispatch id if visible, message_flow id if visible, and a one-line received scope.",
      `- If no ACK is received, workflow retries on the ${DEFAULT_RUNTIME_ACK_RETRY_SECONDS}s governed control-loop path.`
    ].join("\n"));
  }
  return { subject, body, sourceRefs, prompt: lines.join("\n\n") };
}

function messageFlowStatusTimestampColumn(status) {
  return {
    inbound_received: "inbound_received_at",
    route_registered: "route_registered_at",
    runtime_dispatched: "runtime_dispatched_at",
    runtime_acknowledged: "",
    semantic_dispatched: "",
    runtime_completed: "runtime_completed_at",
    runtime_failed: "runtime_failed_at",
    outbound_queued: "outbound_queued_at",
    telegram_sent: "telegram_sent_at",
    telegram_failed: "telegram_failed_at"
  }[status] || "";
}

const MESSAGE_FLOW_STATUS_RANK = {
  inbound_received: 1,
  route_registered: 2,
  runtime_dispatched: 3,
  runtime_acknowledged: 4,
  semantic_dispatched: 5,
  runtime_failed: 6,
  runtime_completed: 6,
  outbound_queued: 7,
  telegram_failed: 8,
  telegram_sent: 9
};

function isMessageFlowStatusRegression(currentStatus, nextStatus) {
  if (!currentStatus || currentStatus === nextStatus) return false;
  if (currentStatus === "telegram_sent" && nextStatus !== "telegram_sent") return true;
  if (currentStatus === "telegram_failed" && !["telegram_failed", "telegram_sent"].includes(nextStatus)) return true;
  const currentRank = MESSAGE_FLOW_STATUS_RANK[currentStatus] || 0;
  const nextRank = MESSAGE_FLOW_STATUS_RANK[nextStatus] || 0;
  if (currentRank && nextRank && nextRank < currentRank) return true;
  if (currentStatus === "runtime_completed" && nextStatus === "runtime_failed") return true;
  return false;
}

async function appendMessageFlowEvent(paths, flowId, status, eventType, payload = {}) {
  await sqlite(paths.dbFile, `
INSERT INTO message_flow_events(event_id, flow_id, status, event_type, payload_json, created_at)
VALUES (${sqlValue(safeId("flowevt"))}, ${sqlValue(flowId)}, ${sqlValue(status)}, ${sqlValue(eventType)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(nowIso())});`);
}

async function createMessageFlow(paths, input = {}) {
  const createdAt = input.createdAt || input.created_at || nowIso();
  const flowId = String(input.flowId || input.flow_id || messageFlowIdFromParts(input.idempotencyKey || input.idempotency_key, input.traceId || input.trace_id, input.meetingId || input.meeting_id)).trim();
  const status = MESSAGE_FLOW_STATUSES.has(String(input.status || "inbound_received")) ? String(input.status || "inbound_received") : "inbound_received";
  const returnPolicy = normalizeReturnPolicy(input.returnPolicy || input.return_policy, "silent");
  const payload = parseJsonValue(input.payload, input.payload || {});
  const timestampColumn = messageFlowStatusTimestampColumn(status);
  await sqlite(paths.dbFile, `
INSERT INTO message_flows(flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, runtime_run_id, message_id, outbox_id, source_channel, source_system, source_runtime, source_account_id, source_chat_id, sender_id, source_message_id, route_agent_id, route_runtime, target_runtime, target_agent_id, target_platform, workflow_ingress_adapter, im_identity, execution_identity, return_policy, status, inbound_received_at, route_registered_at, runtime_dispatched_at, runtime_completed_at, runtime_failed_at, outbound_queued_at, telegram_sent_at, telegram_failed_at, completed_at, failure_type, last_error, final_output_present, delivery_receipt_present, payload_json, created_at, updated_at)
VALUES (${sqlValue(flowId)}, ${sqlValue(input.traceId || input.trace_id || "")}, ${sqlValue(input.idempotencyKey || input.idempotency_key || "")}, ${sqlValue(input.meetingId || input.meeting_id || "")}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.dispatchId || input.dispatch_id || "")}, ${sqlValue(input.runtimeRunId || input.runtime_run_id || "")}, ${sqlValue(input.messageId || input.message_id || "")}, ${sqlValue(input.outboxId || input.outbox_id || "")}, ${sqlValue(input.sourceChannel || input.source_channel || "")}, ${sqlValue(input.sourceSystem || input.source_system || "")}, ${sqlValue(input.sourceRuntime || input.source_runtime || "")}, ${sqlValue(input.sourceAccountId || input.source_account_id || "")}, ${sqlValue(input.sourceChatId || input.source_chat_id || "")}, ${sqlValue(input.senderId || input.sender_id || "")}, ${sqlValue(input.sourceMessageId || input.source_message_id || "")}, ${sqlValue(input.routeAgentId || input.route_agent_id || "")}, ${sqlValue(input.routeRuntime || input.route_runtime || "")}, ${sqlValue(input.targetRuntime || input.target_runtime || "")}, ${sqlValue(input.targetAgentId || input.target_agent_id || "")}, ${sqlValue(input.targetPlatform || input.target_platform || "")}, ${sqlValue(input.workflowIngressAdapter || input.workflow_ingress_adapter || "")}, ${sqlValue(input.imIdentity || input.im_identity || "")}, ${sqlValue(input.executionIdentity || input.execution_identity || "")}, ${sqlValue(returnPolicy)}, ${sqlValue(status)}, ${sqlValue(timestampColumn === "inbound_received_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "route_registered_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "runtime_dispatched_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "runtime_completed_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "runtime_failed_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "outbound_queued_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "telegram_sent_at" ? createdAt : "")}, ${sqlValue(timestampColumn === "telegram_failed_at" ? createdAt : "")}, ${sqlValue(["telegram_sent", "telegram_failed"].includes(status) ? createdAt : "")}, ${sqlValue(input.failureType || input.failure_type || "")}, ${sqlValue(input.lastError || input.last_error || "")}, ${sqlValue(input.finalOutputPresent ? 1 : 0)}, ${sqlValue(input.deliveryReceiptPresent ? 1 : 0)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(flow_id) DO UPDATE SET
  trace_id=CASE WHEN excluded.trace_id != '' THEN excluded.trace_id ELSE message_flows.trace_id END,
  idempotency_key=CASE WHEN excluded.idempotency_key != '' THEN excluded.idempotency_key ELSE message_flows.idempotency_key END,
  meeting_id=CASE WHEN excluded.meeting_id != '' THEN excluded.meeting_id ELSE message_flows.meeting_id END,
  workflow_id=CASE WHEN excluded.workflow_id != '' THEN excluded.workflow_id ELSE message_flows.workflow_id END,
  dispatch_id=CASE WHEN excluded.dispatch_id != '' THEN excluded.dispatch_id ELSE message_flows.dispatch_id END,
  runtime_run_id=CASE WHEN excluded.runtime_run_id != '' THEN excluded.runtime_run_id ELSE message_flows.runtime_run_id END,
  message_id=CASE WHEN excluded.message_id != '' THEN excluded.message_id ELSE message_flows.message_id END,
  outbox_id=CASE WHEN excluded.outbox_id != '' THEN excluded.outbox_id ELSE message_flows.outbox_id END,
  source_channel=CASE WHEN excluded.source_channel != '' THEN excluded.source_channel ELSE message_flows.source_channel END,
  source_system=CASE WHEN excluded.source_system != '' THEN excluded.source_system ELSE message_flows.source_system END,
  source_runtime=CASE WHEN excluded.source_runtime != '' THEN excluded.source_runtime ELSE message_flows.source_runtime END,
  source_account_id=CASE WHEN excluded.source_account_id != '' THEN excluded.source_account_id ELSE message_flows.source_account_id END,
  source_chat_id=CASE WHEN excluded.source_chat_id != '' THEN excluded.source_chat_id ELSE message_flows.source_chat_id END,
  sender_id=CASE WHEN excluded.sender_id != '' THEN excluded.sender_id ELSE message_flows.sender_id END,
  source_message_id=CASE WHEN excluded.source_message_id != '' THEN excluded.source_message_id ELSE message_flows.source_message_id END,
  route_agent_id=CASE WHEN excluded.route_agent_id != '' THEN excluded.route_agent_id ELSE message_flows.route_agent_id END,
  route_runtime=CASE WHEN excluded.route_runtime != '' THEN excluded.route_runtime ELSE message_flows.route_runtime END,
  target_runtime=CASE WHEN excluded.target_runtime != '' THEN excluded.target_runtime ELSE message_flows.target_runtime END,
  target_agent_id=CASE WHEN excluded.target_agent_id != '' THEN excluded.target_agent_id ELSE message_flows.target_agent_id END,
  target_platform=CASE WHEN excluded.target_platform != '' THEN excluded.target_platform ELSE message_flows.target_platform END,
  workflow_ingress_adapter=CASE WHEN excluded.workflow_ingress_adapter != '' THEN excluded.workflow_ingress_adapter ELSE message_flows.workflow_ingress_adapter END,
  im_identity=CASE WHEN excluded.im_identity != '' THEN excluded.im_identity ELSE message_flows.im_identity END,
  execution_identity=CASE WHEN excluded.execution_identity != '' THEN excluded.execution_identity ELSE message_flows.execution_identity END,
  return_policy=CASE WHEN excluded.return_policy != 'silent' OR message_flows.return_policy='' THEN excluded.return_policy ELSE message_flows.return_policy END,
  status=CASE
    WHEN message_flows.status='telegram_sent' AND excluded.status!='telegram_sent' THEN message_flows.status
    WHEN message_flows.status='telegram_failed' AND excluded.status NOT IN ('telegram_failed','telegram_sent') THEN message_flows.status
    ELSE excluded.status
  END,
  inbound_received_at=CASE WHEN excluded.inbound_received_at != '' THEN excluded.inbound_received_at ELSE message_flows.inbound_received_at END,
  route_registered_at=CASE WHEN excluded.route_registered_at != '' THEN excluded.route_registered_at ELSE message_flows.route_registered_at END,
  runtime_dispatched_at=CASE WHEN excluded.runtime_dispatched_at != '' THEN excluded.runtime_dispatched_at ELSE message_flows.runtime_dispatched_at END,
  runtime_completed_at=CASE WHEN excluded.runtime_completed_at != '' THEN excluded.runtime_completed_at ELSE message_flows.runtime_completed_at END,
  runtime_failed_at=CASE WHEN excluded.runtime_failed_at != '' THEN excluded.runtime_failed_at ELSE message_flows.runtime_failed_at END,
  outbound_queued_at=CASE WHEN excluded.outbound_queued_at != '' THEN excluded.outbound_queued_at ELSE message_flows.outbound_queued_at END,
  telegram_sent_at=CASE WHEN excluded.telegram_sent_at != '' THEN excluded.telegram_sent_at ELSE message_flows.telegram_sent_at END,
  telegram_failed_at=CASE WHEN excluded.telegram_failed_at != '' THEN excluded.telegram_failed_at ELSE message_flows.telegram_failed_at END,
  completed_at=CASE WHEN excluded.completed_at != '' THEN excluded.completed_at ELSE message_flows.completed_at END,
  failure_type=CASE WHEN excluded.failure_type != '' THEN excluded.failure_type ELSE message_flows.failure_type END,
  last_error=CASE WHEN excluded.last_error != '' THEN excluded.last_error ELSE message_flows.last_error END,
  final_output_present=CASE WHEN excluded.final_output_present != 0 THEN excluded.final_output_present ELSE message_flows.final_output_present END,
  delivery_receipt_present=CASE WHEN excluded.delivery_receipt_present != 0 THEN excluded.delivery_receipt_present ELSE message_flows.delivery_receipt_present END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  await appendMessageFlowEvent(paths, flowId, status, "state", payload);
  return { flowId, status, returnPolicy };
}

async function readMessageFlow(paths, flowId) {
  if (!flowId) return null;
  const rows = await sqlite(paths.dbFile, `SELECT * FROM message_flows WHERE flow_id=${sqlValue(flowId)} LIMIT 1;`, { json: true });
  return rows[0] || null;
}

function messageFlowIdFromDispatchPayload(row = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  return String(payload.messageFlowId || payload.message_flow_id || payload.routeShell?.messageFlowId || payload.routeShell?.message_flow_id || payload.payload?.messageFlowId || payload.payload?.routeShell?.messageFlowId || "").trim();
}

function dispatchPayloadObject(row = {}) {
  return parseJsonValue(row.payload_json, {});
}

function isSemanticContinuationDispatch(row = {}) {
  const payload = dispatchPayloadObject(row);
  const nested = objectValue(payload.payload);
  return boolOption(payload.semanticContinuation ?? payload.semantic_continuation ?? nested.semanticContinuation ?? nested.semantic_continuation, false);
}

function semanticContinuationTimeoutSeconds(payload = {}, input = {}, fallbackSeconds = DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS, maxSeconds = 3600) {
  const nested = objectValue(payload.payload);
  const raw = Number(
    nested.semanticTimeoutSeconds ??
    nested.semantic_timeout_seconds ??
    payload.semanticTimeoutSeconds ??
    payload.semantic_timeout_seconds ??
    nested.timeoutSeconds ??
    nested.timeout_seconds ??
    payload.timeoutSeconds ??
    payload.timeout_seconds ??
    input.semanticTimeoutSeconds ??
    input.semantic_timeout_seconds ??
    fallbackSeconds
  );
  return Math.max(60, Math.min(maxSeconds, Number.isFinite(raw) && raw > 0 ? raw : fallbackSeconds));
}

function messageFlowDispatchStartedStatus(row = {}) {
  return isSemanticContinuationDispatch(row) ? "semantic_dispatched" : "runtime_dispatched";
}

async function messageFlowForDispatch(paths, row = {}) {
  const flowId = messageFlowIdFromDispatchPayload(row);
  if (flowId) return readMessageFlow(paths, flowId);
  const rows = await sqlite(paths.dbFile, `SELECT * FROM message_flows WHERE dispatch_id=${sqlValue(row.dispatch_id || "")} LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function updateMessageFlow(paths, flowId, status, patch = {}) {
  if (!flowId || !MESSAGE_FLOW_STATUSES.has(status)) return null;
  const rows = await sqlite(paths.dbFile, `SELECT status, payload_json FROM message_flows WHERE flow_id=${sqlValue(flowId)} LIMIT 1;`, { json: true });
  if (!rows[0]) return null;
  const currentStatus = String(rows[0].status || "").trim();
  if (isMessageFlowStatusRegression(currentStatus, status)) {
    await appendMessageFlowEvent(paths, flowId, currentStatus, "state_regression_blocked", {
      attemptedStatus: status,
      reason: "terminal_message_flow_status_is_monotonic",
      payload: patch.payload || {}
    });
    return readMessageFlow(paths, flowId);
  }
  const existingPayload = parseJsonValue(rows[0].payload_json, {});
  const payload = { ...existingPayload, ...parseJsonValue(patch.payload, patch.payload || {}), updatedAt: nowIso() };
  const updatedAt = patch.updatedAt || patch.updated_at || nowIso();
  const timestampColumn = messageFlowStatusTimestampColumn(status);
  const assignments = [
    `status=${sqlValue(status)}`,
    `payload_json=${sqlValue(JSON.stringify(payload))}`,
    `updated_at=${sqlValue(updatedAt)}`
  ];
  if (timestampColumn) assignments.push(`${timestampColumn}=${sqlValue(updatedAt)}`);
  if (["telegram_sent", "telegram_failed"].includes(status)) assignments.push(`completed_at=${sqlValue(updatedAt)}`);
  if (patch.dispatchId || patch.dispatch_id) assignments.push(`dispatch_id=${sqlValue(patch.dispatchId || patch.dispatch_id)}`);
  if (patch.runtimeRunId || patch.runtime_run_id) assignments.push(`runtime_run_id=${sqlValue(patch.runtimeRunId || patch.runtime_run_id)}`);
  if (patch.messageId || patch.message_id) assignments.push(`message_id=${sqlValue(patch.messageId || patch.message_id)}`);
  if (patch.outboxId || patch.outbox_id) assignments.push(`outbox_id=${sqlValue(patch.outboxId || patch.outbox_id)}`);
  if (patch.failureType || patch.failure_type) assignments.push(`failure_type=${sqlValue(patch.failureType || patch.failure_type)}`);
  if (patch.lastError || patch.last_error) assignments.push(`last_error=${sqlValue(String(patch.lastError || patch.last_error).slice(0, 2000))}`);
  if (patch.finalOutputPresent !== undefined || patch.final_output_present !== undefined) assignments.push(`final_output_present=${sqlValue((patch.finalOutputPresent ?? patch.final_output_present) ? 1 : 0)}`);
  if (patch.deliveryReceiptPresent !== undefined || patch.delivery_receipt_present !== undefined) assignments.push(`delivery_receipt_present=${sqlValue((patch.deliveryReceiptPresent ?? patch.delivery_receipt_present) ? 1 : 0)}`);
  await sqlite(paths.dbFile, `UPDATE message_flows SET ${assignments.join(", ")} WHERE flow_id=${sqlValue(flowId)};`);
  await appendMessageFlowEvent(paths, flowId, status, "state", patch.payload || {});
  return readMessageFlow(paths, flowId);
}

function messageFlowSourceChannel(input = {}, originalPayload = {}) {
  const beforeDispatch = objectValue(originalPayload.beforeDispatch || originalPayload.before_dispatch);
  const sourceSystem = String(input.sourceSystem || input.source_system || "").toLowerCase();
  return firstText(input.sourceChannel, input.source_channel, input.channelId, input.channel_id, input.channel, beforeDispatch.channel, sourceSystem.includes("telegram") ? "telegram" : "");
}

function messageFlowOutputIsFinal(text = "") {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();
  const requestFailedPlaceholder = /^(llm|model|runtime|agent) request failed(?:[\.:][^\r\n]*)?$/i;
  if (!value) return false;
  if (/^heartbeat_(ok|degraded)\b/i.test(value)) return true;
  if (requestFailedPlaceholder.test(value)) return false;
  if (lower.startsWith("operation interrupted:")) return false;
  if (lower.includes("operation interrupted") && (lower.includes("waiting for model response") || lower.includes("cancelled"))) return false;
  return true;
}

function messageFlowSemanticPromptFromPayload(payload = {}, fallback = "") {
  const subject = String(payload.subject || payload.title || "").trim();
  const body = String(payload.body || payload.text || payload.message || payload.content || "").trim();
  const sourceRefs = toList(payload.sourceRefs || payload.source_refs || payload.artifacts || payload.artifactRefs || payload.artifact_refs);
  const lines = [];
  if (subject) lines.push(`Subject: ${subject}`);
  if (body) lines.push(body);
  if (sourceRefs.length) lines.push(["Source refs:", ...sourceRefs.map((ref) => `- ${ref}`)].join("\n"));
  return lines.join("\n\n") || String(fallback || "").trim();
}

function messageFlowAckDispatchId(flow = {}) {
  const payload = parseJsonValue(flow.payload_json, {});
  return firstText(
    payload.ackDispatchId,
    payload.ack_dispatch_id,
    payload.ack?.dispatchId,
    payload.ack?.dispatch_id,
    flow.dispatch_id
  );
}

function messageFlowSemanticIdempotencyKey(flowId, ackDispatchId) {
  return `message-flow-semantic:${flowId}:${ackDispatchId}`;
}

function messageFlowDeliveryTarget(flow = {}) {
  const returnPolicy = normalizeReturnPolicy(flow.return_policy, "silent");
  if (returnPolicy === "silent") return null;
  if (returnPolicy === "report_to_flashcat") {
    return { targetKind: "private", targetRef: DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID, account: "cat_claw", mode: returnPolicy };
  }
  if (returnPolicy === "reply_to_source_chat") {
    if (String(flow.source_channel || "").toLowerCase() !== "telegram" || !String(flow.source_chat_id || "").trim()) return null;
    const targetRef = String(flow.source_chat_id || "").trim();
    return {
      targetKind: targetRef.startsWith("-") ? "group" : "private",
      targetRef,
      account: firstText(flow.source_account_id, flow.route_agent_id, flow.target_agent_id, "cat_claw"),
      mode: returnPolicy
    };
  }
  return null;
}

function formatMessageFlowFailureText(flow = {}, data = {}) {
  const agent = firstText(flow.target_agent_id, flow.route_agent_id, "unknown");
  const failureType = firstText(data.failureType, data.failure_type, flow.failure_type, "runtime_failed");
  const error = compactText(firstText(data.error, data.lastError, data.last_error, flow.last_error, "非 OpenClaw agent 本轮没有产出可投递的正式回复。"), 900);
  return [
    `【${agent} 未产出有效回复】`,
    `时间：${nowIso()}`,
    `Flow：${flow.flow_id || ""}`,
    `Dispatch：${flow.dispatch_id || ""}`,
    `状态：${failureType}`,
    `原因：${error}`,
    "",
    "说明：route-shell 只表示入口已登记；本消息来自 workflow 的跨平台消息流状态机，不把 route-shell ack 或 Hermers 空输出伪装成正式回复。"
  ].join("\n");
}

async function enqueueMessageFlowOutbound(paths, flow, text, input = {}, extraPayload = {}) {
  if (!flow?.flow_id) return { status: "skipped", reason: "missing_flow" };
  const target = messageFlowDeliveryTarget(flow);
  if (!target) {
    await appendMessageFlowEvent(paths, flow.flow_id, flow.status || "runtime_completed", "delivery_skipped", { reason: "return_policy_silent_or_missing_target" });
    return { status: "delivery_skipped", reason: "return_policy_silent_or_missing_target", flowId: flow.flow_id };
  }
  const outboxId = flow.outbox_id || `flow-${cleanFileSegment(flow.flow_id)}`;
  let rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
  if (!rows[0]) {
    await enqueueTelegramOutbox(paths, {
      outboxId,
      meetingId: flow.meeting_id,
      targetKind: target.targetKind,
      targetRef: target.targetRef,
      messageType: "message_flow_reply",
      text,
      payload: {
        ...extraPayload,
        messageFlowId: flow.flow_id,
        dispatchId: flow.dispatch_id || "",
        messageId: flow.message_id || "",
        returnPolicy: flow.return_policy || "",
        account: target.account,
        target: target.targetRef,
        flowDeliveryRequired: true
      }
    });
    const flowFailedWithoutOutput = Number(flow.final_output_present || 0) === 0
      && String(flow.status || "") === "runtime_failed"
      && (extraPayload.finalOutputPresent === false || extraPayload.final_output_present === false);
    await updateMessageFlow(paths, flow.flow_id, flowFailedWithoutOutput ? "runtime_failed" : "outbound_queued", { outboxId, payload: { outboxId, targetRef: target.targetRef, account: target.account } });
    rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
  }
  const row = rows[0];
  if (!row) return { status: "missing_outbox", outboxId };
  if (row.status === "sent") {
    return updateMessageFlowFromTelegramDelivery(paths, row, {
      outboxId,
      status: "sent",
      account: target.account,
      target: target.targetRef,
      alreadySent: true
    });
  }
  const deliverNow = boolOption(input.autoDeliverMessageFlowOutbox ?? input.auto_deliver_message_flow_outbox ?? input.deliverMessageFlowOutbox ?? input.deliver_message_flow_outbox, true);
  if (!deliverNow || row.status !== "queued") return { status: row.status, outboxId, queued: true };
  return deliverTelegramOutboxRow(paths, row, { ...input, account: target.account, target: target.targetRef });
}

async function updateMessageFlowFromTelegramDelivery(paths, row, result = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  const flowId = String(payload.messageFlowId || payload.message_flow_id || "").trim();
  if (!flowId) return null;
  const flow = await readMessageFlow(paths, flowId);
  const hasFinalOutput = Number(flow?.final_output_present || 0) === 1;
  const payloadReceipts = Array.isArray(payload.delivery?.receipts) ? payload.delivery.receipts : [];
  const resultReceipts = Array.isArray(result.receipts) ? result.receipts : [];
  const deliveryReceiptVerified = result.status === "sent" && (payloadReceipts.length > 0 || resultReceipts.length > 0);
  const status = result.status === "sent"
    ? (hasFinalOutput ? "telegram_sent" : "runtime_failed")
    : "telegram_failed";
  const messageId = String(payload.messageId || payload.message_id || "").trim();
  if (messageId) {
    await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status=${sqlValue(status === "telegram_sent" ? "sent" : "failed")} WHERE message_id=${sqlValue(messageId)};`);
  }
  return updateMessageFlow(paths, flowId, status, {
    outboxId: row.outbox_id,
    deliveryReceiptPresent: deliveryReceiptVerified,
    lastError: result.error || "",
    payload: { delivery: result }
  });
}

async function finishMessageFlowRuntime(paths, row, data = {}, input = {}) {
  const flow = await messageFlowForDispatch(paths, row);
  if (!flow) return null;
  const text = String(data.text || "").trim();
  const finalOutputPresent = data.finalOutputPresent ?? messageFlowOutputIsFinal(text);
  const runtimeRunId = data.runtimeRunId || data.runtime_run_id || "";
  const messageId = data.messageId || data.message_id || "";
  const status = finalOutputPresent ? "runtime_completed" : "runtime_failed";
  const failureType = finalOutputPresent ? "" : firstText(data.failureType, data.failure_type, "incomplete_output");
  const lastError = finalOutputPresent ? "" : firstText(data.lastError, data.last_error, text || "runtime did not produce final output");
  const updated = await updateMessageFlow(paths, flow.flow_id, status, {
    runtimeRunId,
    messageId,
    finalOutputPresent,
    failureType,
    lastError,
    payload: {
      runtimeStatus: status,
      runtimeRunId,
      messageId,
      outputHash: data.outputHash || data.output_hash || "",
      dispatchStatus: row.status
    }
  });
  const latest = updated || await readMessageFlow(paths, flow.flow_id);
  if (String(latest?.status || "") !== status || Boolean(Number(latest?.final_output_present || 0)) !== Boolean(finalOutputPresent)) {
    await appendMessageFlowEvent(paths, flow.flow_id, latest?.status || flow.status || "", "delivery_skipped_after_state_regression_block", {
      attemptedStatus: status,
      attemptedFinalOutputPresent: Boolean(finalOutputPresent),
      persistedStatus: latest?.status || "",
      persistedFinalOutputPresent: Boolean(Number(latest?.final_output_present || 0))
    });
    return {
      status: "state_regression_blocked",
      flowId: flow.flow_id,
      attemptedStatus: status,
      persistedStatus: latest?.status || "",
      deliverySkipped: true
    };
  }
  const deliveryText = finalOutputPresent ? text : formatMessageFlowFailureText(latest || flow, { failureType, lastError });
  return enqueueMessageFlowOutbound(paths, latest || flow, deliveryText, input, {
    runtimeStatus: status,
    failureType,
    finalOutputPresent: Boolean(finalOutputPresent)
  });
}

async function acknowledgeMessageFlowRuntime(paths, row, data = {}) {
  const flow = await messageFlowForDispatch(paths, row);
  if (!flow) return null;
  const runtimeRunId = data.runtimeRunId || data.runtime_run_id || "";
  const messageId = data.messageId || data.message_id || "";
  const text = String(data.text || "").trim();
  const updated = await updateMessageFlow(paths, flow.flow_id, "runtime_acknowledged", {
    runtimeRunId,
    messageId,
    finalOutputPresent: false,
    deliveryReceiptPresent: false,
    payload: {
      runtimeStatus: "runtime_acknowledged",
      runtimeRunId,
      messageId,
      ackDispatchId: row.dispatch_id,
      outputHash: data.outputHash || data.output_hash || "",
      dispatchStatus: row.status,
      ack: {
        receivedAt: data.receivedAt || data.received_at || nowIso(),
        text: text.slice(0, 1000)
      }
    }
  });
  return {
    status: updated?.status || "runtime_acknowledged",
    flowId: flow.flow_id,
    finalOutputPresent: false,
    deliveryQueued: false
  };
}

async function messageTextForRuntimeReceipt(paths, messageId = "") {
  const id = String(messageId || "").trim();
  if (!id) return "";
  const rows = await sqlite(paths.dbFile, `
SELECT text
FROM mixed_meeting_messages
WHERE message_id=${sqlValue(id)}
LIMIT 1;`, { json: true });
  return String(rows[0]?.text || "").trim();
}

async function syncMessageFlowFromTerminalDispatchReceipt(paths, row, receipt = {}, input = {}) {
  const flow = await messageFlowForDispatch(paths, row);
  if (!flow) return null;
  const status = String(receipt.status || "").trim();
  const runtimeRunId = String(receipt.runtimeRunId || receipt.runtime_run_id || "").trim();
  const messageId = String(receipt.messageId || receipt.message_id || "").trim();
  const text = await messageTextForRuntimeReceipt(paths, messageId);
  const outputHash = text ? textHash(text) : "";
  if (status === "acked") {
    const ack = runtimeAckContract(row, input);
    if (ack.required) {
      const result = await acknowledgeMessageFlowRuntime(paths, row, {
        runtimeRunId,
        messageId,
        text,
        outputHash,
        receivedAt: receipt.completedAt || receipt.completed_at || nowIso()
      });
      await appendMessageFlowEvent(paths, flow.flow_id, result?.status || "runtime_acknowledged", "stale_dispatch_terminal_receipt_synced", {
        dispatchId: row.dispatch_id,
        runtimeRunId,
        messageId,
        terminalStatus: status,
        ackRequired: true
      });
      return result;
    }
    return finishMessageFlowRuntime(paths, row, {
      runtimeRunId,
      messageId,
      text,
      outputHash,
      finalOutputPresent: messageFlowOutputIsFinal(text),
      failureType: "runtime_output_missing",
      lastError: text ? "" : "terminal acked runtime receipt did not reference recoverable message text"
    }, input);
  }
  if (status === "failed") {
    return finishMessageFlowRuntime(paths, row, {
      runtimeRunId,
      messageId,
      finalOutputPresent: false,
      failureType: receipt.failureType || receipt.failure_type || "runtime_failed",
      lastError: receipt.error || receipt.lastError || receipt.last_error || "terminal runtime receipt failed"
    }, input);
  }
  await appendMessageFlowEvent(paths, flow.flow_id, flow.status || "", "stale_dispatch_terminal_receipt_sync_skipped", {
    dispatchId: row.dispatch_id,
    runtimeRunId,
    messageId,
    terminalStatus: status || "unknown"
  });
  return { status: "skipped", reason: "unsupported_terminal_status", flowId: flow.flow_id };
}

async function queueMessageFlowSemanticContinuation(paths, row, data = {}, input = {}) {
  const ack = runtimeAckContract(row, input);
  if (!ack.required || !ack.semanticContinuation) return null;
  const flow = await messageFlowForDispatch(paths, row);
  if (!flow) return null;
  const payload = dispatchPayloadObject(row);
  const nested = objectValue(payload.payload);
  if (isSemanticContinuationDispatch(row)) return null;
  if (
    boolOption(process.env[TEST_SEMANTIC_CONTINUATION_FAILURE_ENV], false)
    && boolOption(input.forceSemanticContinuationFailure ?? input.force_semantic_continuation_failure, false)
  ) {
    await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_failed", {
      ackDispatchId: row.dispatch_id,
      reason: "forced_semantic_continuation_failure"
    });
    return { status: "failed", reason: "forced_semantic_continuation_failure" };
  }
  const idempotencyKey = messageFlowSemanticIdempotencyKey(flow.flow_id, row.dispatch_id);
  const semanticDispatchId = `dispatch.semantic.${textHash(idempotencyKey).slice(0, 24)}`;
  const semanticPrompt = messageFlowSemanticPromptFromPayload(nested, row.prompt || payload.prompt || "");
  const semanticTimeoutSeconds = semanticContinuationTimeoutSeconds(payload, input);
  const semanticPayload = {
    ...nested,
    requiresAck: false,
    timeoutSeconds: semanticTimeoutSeconds,
    semanticTimeoutSeconds,
    ackContract: {
      ...(objectValue(nested.ackContract || nested.ack_contract)),
      required: false,
      acknowledgedByDispatch: row.dispatch_id,
      acknowledgedByRuntimeRun: data.runtimeRunId || data.runtime_run_id || "",
      acknowledgedAt: data.receivedAt || data.received_at || nowIso()
    },
    semanticContinuation: true,
    semanticContinuationOf: row.dispatch_id,
    ackDispatchId: row.dispatch_id,
    ackRuntimeRunId: data.runtimeRunId || data.runtime_run_id || "",
    ackMessageId: data.messageId || data.message_id || "",
    messageFlowId: flow.flow_id
  };
  let dispatch;
  try {
    dispatch = await meetingDispatch(paths.root, {
	    meetingId: row.meeting_id,
	    workflowId: row.workflow_id || payload.workflowId || payload.workflow_id || flow.workflow_id || row.meeting_id,
	    traceId: row.trace_id || payload.traceId || payload.trace_id || flow.trace_id || safeId("trace"),
	    idempotencyKey,
	    dispatchId: semanticDispatchId,
	    runtime: row.runtime,
    agentId: row.agent_id,
    dispatchType: "message_flow_semantic",
    prompt: semanticPrompt,
    priority: row.priority || "normal",
    createdBy: "workflow:message_flow_ack",
    maxAttempts: input.semanticMaxAttempts || input.semantic_max_attempts || nested.semanticMaxAttempts || nested.semantic_max_attempts || 1,
    timeoutSeconds: semanticTimeoutSeconds,
    returnPolicy: "silent",
    deliveryPolicy: "silent",
    sourceChannel: flow.source_channel || nested.source?.sourceChannel || nested.source?.source_channel || "",
    sourceSystem: "workflow.message_flow.semantic_continuation",
    sourceRuntime: flow.source_runtime || nested.source?.runtime || "",
    sourceAccountId: flow.source_account_id || nested.source?.sourceAccountId || nested.source?.source_account_id || "",
    sourceChatId: flow.source_chat_id || nested.source?.sourceChatId || nested.source?.source_chat_id || "",
    senderId: flow.sender_id || nested.source?.senderId || nested.source?.sender_id || "",
    sourceMessageId: flow.source_message_id || nested.source?.sourceMessageId || nested.source?.source_message_id || "",
    messageFlowId: flow.flow_id,
    payload: semanticPayload
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_failed", {
      ackDispatchId: row.dispatch_id,
      idempotencyKey,
      error: message.slice(0, 2000)
    });
    return { status: "failed", reason: "semantic_continuation_dispatch_failed", error: message };
  }
  await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_queued", {
    ackDispatchId: row.dispatch_id,
    semanticDispatchId: dispatch.dispatchId,
    deduped: Boolean(dispatch.deduped),
    idempotencyKey
  });
  return {
    status: dispatch.status,
    dispatchId: dispatch.dispatchId,
    runtime: dispatch.runtime,
    agentId: dispatch.agentId,
    deduped: Boolean(dispatch.deduped),
    idempotencyKey
  };
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
    return semanticContinuationTimeoutSeconds(payload, input, DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS, maxSeconds);
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

function assertSemanticContinuationQueued(semanticContinuation) {
  if (!semanticContinuation || semanticContinuation.status !== "failed") return;
  throw new Error(`semantic continuation dispatch failed: ${semanticContinuation.error || semanticContinuation.reason || "unknown"}`);
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

function humanGateStageKey(input = {}, workflowId = "", gateType = "", parentObjectId = "") {
  const explicit = firstText(
    input.humanGateStageKey,
    input.human_gate_stage_key,
    input.stageKey,
    input.stage_key,
    input.workflowStage,
    input.workflow_stage,
    input.stage,
    input.phase
  );
  if (explicit) return cleanFileSegment(explicit);
  const taskId = firstText(input.taskId, input.task_id);
  if (taskId) return `task:${cleanFileSegment(taskId)}`;
  const dispatchId = firstText(input.dispatchId, input.dispatch_id);
  if (dispatchId) return `dispatch:${cleanFileSegment(dispatchId)}`;
  const parent = firstText(parentObjectId, workflowId);
  return `workflow:${cleanFileSegment(parent || gateType || "default")}`;
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

function humanGateButtonIsControl(button = {}) {
  const status = humanGateButtonStatus(button);
  const role = humanGateButtonRole(button);
  return status !== "approved" || ["reject", "pause", "terminate"].includes(role);
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

export async function humanGateRequest(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const requester = normalizeRequester(input.from || input.sourceAgent || input.source_agent || input.ownerAgent || input.owner_agent, "cat_claw");
  const workflowId = firstText(input.workflowId, input.workflow_id, input.parentObjectId, input.parent_object_id, meetingId);
  const gateType = firstText(input.gateType, input.gate_type, "workflow_continuation");
  const parentObjectId = input.parentObjectId || input.parent_object_id || workflowId;
  const stageKey = humanGateStageKey(input, workflowId, gateType, parentObjectId);
  const requestedHumanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
  const supersedeExisting = boolOption(input.supersedeExisting ?? input.supersede_existing ?? input.supersede ?? input.replaceExisting ?? input.replace_existing, false);
  const stageGateId = requestedHumanGateId || (supersedeExisting ? "" : `hgate.stage.${textHash(`${workflowId}:${gateType}:${stageKey}`).slice(0, 24)}`);
  const directHumanGateId = stageGateId || requestedHumanGateId;
  const requestPayload = parseJsonValue(input.payload, input.payload || {});
  const buttonSpecs = humanGateButtonSpecs(
    { object_id: stageGateId, path: "" },
    { ...input, payload: requestPayload },
    { ...input, raw: requestPayload }
  );
  const buttonAudit = combineHumanGateAudits(
    auditHumanGatePlanOptions(buttonSpecs),
    auditHumanGatePlanDetails(buttonSpecs),
    auditHumanGatePrimaryLanguage(input, buttonSpecs)
  );
  if (!buttonAudit.ok) {
    throw new Error(`Human Gate request blocked: ${buttonAudit.reason}; cat-brain main must provide ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} complete option details and Chinese-format report material before cat_claw submits to Flashcat`);
  }
  let gate = null;
  let supersededGate = null;
  if (directHumanGateId) {
    const existingGate = await humanGateRecordById(paths, directHumanGateId);
    const lockedButtons = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(directHumanGateId)} AND status IN ('feedback_pending','selected')
ORDER BY updated_at DESC, created_at ASC;`, { json: true });
    if (existingGate && !["pending", "superseded"].includes(existingGate.status)) {
      const rows = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(directHumanGateId)}
ORDER BY created_at ASC;`, { json: true });
      return {
        meetingId,
        workflowId,
        humanGateId: directHumanGateId,
        gateType,
        stageKey,
        reusedStageGate: true,
        alreadySubmitted: true,
        status: existingGate.status,
        buttons: rows.map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root)),
        deliveryRequired: false,
        dbFile: paths.dbFile
      };
    }
    if (lockedButtons.length) {
      const selected = lockedButtons.find((row) => row.status === "selected") || lockedButtons[0];
      return {
        meetingId,
        workflowId,
        humanGateId: directHumanGateId,
        gateType,
        stageKey,
        reusedStageGate: true,
        alreadySubmitted: selected.status === "selected",
        status: selected.status === "selected" ? selected.decision_status : "feedback_pending",
        buttons: lockedButtons.map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root)),
        deliveryRequired: false,
        dbFile: paths.dbFile
      };
    }
  }
  const stageMatch = await pendingHumanGateForStage(paths, { workflowId, gateType, stageKey, excludeHumanGateId: requestedHumanGateId });
  if (stageMatch?.row) {
    if (supersedeExisting) {
      supersededGate = await supersedeHumanGateRecord(paths, stageMatch.row, "superseded_by_new_human_gate_request_same_stage");
    } else {
      gate = { objectId: stageMatch.row.object_id, objectType: "human_gate_record", status: "pending", idempotentReplay: true, reusedStageGate: true };
    }
  }
  if (!gate) {
    gate = await workflowHumanGateRecord(rootDir, {
      ...input,
      [INTERNAL_HUMAN_GATE_RECORD]: true,
      humanGateId: stageGateId || input.humanGateId || input.human_gate_id,
      workflowId,
      parentObjectId,
      gateType,
      humanGateStageKey: stageKey,
      actor: input.actor || requester,
      status: "pending",
      sourceSystem: input.sourceSystem || input.source_system || "openclaw",
      sourceAgent: requester
    });
  }
  let buttons = (await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(gate.objectId)} AND status='active'
ORDER BY created_at ASC;`, { json: true })).map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root));
  if (!buttons.length) {
    buttons = await createHumanGateButtons(paths, {
      ...input,
      buttons: buttonSpecs,
      addDefaultControls: false,
      workflowId,
      meetingId,
      humanGateId: gate.objectId,
      createdBy: requester
    });
  }
  const { webApp, presentation, telegramReplyMarkup, text } = await humanGateTelegramArtifacts(input, buttons);
  const eventId = safeId("control");
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'human_gate_request', 'pending', ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify({ humanGateId: gate.objectId, gateType, workflowId, buttons }))}, ${sqlValue(requester)}, ${sqlValue(createdAt)});`);
  const link = await telegramLinkFor(paths, meetingId);
  const channelTarget = firstText(input.channelId, input.channel_id, input.channel);
  const explicitTarget = firstText(input.targetRef, input.target_ref, input.target, input.chatId, input.chat_id, input.notifyTargets, input.notify_targets, channelTarget);
  const linkTarget = firstText(link?.human_gate_channel_id, link?.channel_id, link?.chat_id);
  const targetRef = explicitTarget || linkTarget || DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID;
  const targetKind = firstText(input.targetKind, input.target_kind) || (channelTarget || targetRef.startsWith("-") ? "channel" : "private");
  const deliveryAccount = normalizeRequester(input.account || input.telegramAccount || input.telegram_account, "cat_claw");
  const telegramOutbox = await enqueueTelegramOutbox(paths, {
    outboxId: `hgate-${cleanFileSegment(gate.objectId)}`,
    meetingId,
    targetKind,
    targetRef,
    messageType: "human_gate_request",
    text,
    payload: { humanGateId: gate.objectId, gateType, workflowId, eventId, account: deliveryAccount, requester, targetKind, targetRef, buttons, presentation, telegramReplyMarkup, webApp, textPolicyVersion: HUMAN_GATE_TEXT_POLICY_VERSION }
  });
  let delivery = null;
  const shouldDeliver = boolOption(input.autoDeliver ?? input.auto_deliver ?? input.deliver, false);
  if (shouldDeliver && telegramOutbox.status === "queued") {
    const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(telegramOutbox.outboxId)} LIMIT 1;`, { json: true });
    if (rows[0]) delivery = await deliverTelegramOutboxRow(paths, rows[0], { ...input, account: deliveryAccount, target: targetRef });
  }
  await appendWorkflowEvent(paths, {
    eventType: "human_gate.requested",
    status: "pending",
    workflowId,
    humanGateId: gate.objectId,
    actor: requester,
    sourceRuntime: "workflow",
    sourceAgent: requester,
    nextState: "pending",
    artifactRef: telegramOutbox.outboxId,
    payload: {
      meetingId,
      gateType,
      stageKey,
      reusedStageGate: Boolean(gate.idempotentReplay),
      supersededHumanGateId: supersededGate?.humanGateId || "",
      targetKind,
      targetRef,
      buttonCount: buttons.length,
      telegramOutboxId: telegramOutbox.outboxId,
      deliveryStatus: delivery?.status || telegramOutbox.status
    },
    createdAt
  });
  return { meetingId, workflowId, humanGateId: gate.objectId, gateType, stageKey, reusedStageGate: Boolean(gate.idempotentReplay), supersededGate, eventId, buttons, presentation, telegramReplyMarkup, webApp, targetKind, targetRef, deliveryAccount, telegramOutbox, deliveryRequired: telegramOutbox.status === "queued" && !delivery, delivery, status: "pending", dbFile: paths.dbFile };
}

async function workflowPayloadWithHumanGateFeedback(paths, workflowId, button, selectedAt, feedbackContext = {}) {
  const workflowRows = await sqlite(paths.dbFile, `SELECT payload_json FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
  const existingPayload = parseJsonValue(workflowRows[0]?.payload_json, {});
  const latestHumanGateFeedback = {
    humanGateId: button.human_gate_id,
    buttonId: button.button_id,
    buttonLabel: button.label,
    decisionStatus: button.decision_status,
    role: button.button_role || "",
    selectedAt,
    flashcatOriginalWords: String(feedbackContext.flashcatOriginalWords || "").trim(),
    feedbackReceivedAt: feedbackContext.feedbackReceivedAt || selectedAt,
    feedbackSource: feedbackContext.feedbackSource || "human_gate.feedback"
  };
  return {
    ...existingPayload,
    latestHumanGateFeedback,
    humanGateFeedbackHistory: [
      ...(Array.isArray(existingPayload.humanGateFeedbackHistory) ? existingPayload.humanGateFeedbackHistory.slice(-19) : []),
      latestHumanGateFeedback
    ]
  };
}

async function applyHumanGateWorkflowDecision(paths, button, selectedAt, feedbackContext = {}) {
  const workflowId = String(button.workflow_id || "").trim();
  if (!workflowId) return null;
  const workflowPayload = await workflowPayloadWithHumanGateFeedback(paths, workflowId, button, selectedAt, feedbackContext);
  const decisionStatus = normalizeHumanGateDecisionStatus(button.decision_status, "");
  const role = String(button.button_role || "").trim();
  if (decisionStatus === "approved" || decisionStatus === "rejected") {
    const closeoutResolution = decisionStatus === "approved"
      ? await applyIncidentCloseoutApproval(paths, button, selectedAt, feedbackContext)
      : null;
    await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET status='active',
    current_decision=${sqlValue(`human_gate_${decisionStatus}`)},
    payload_json=${sqlValue(JSON.stringify(workflowPayload))},
    updated_at=${sqlValue(selectedAt)}
WHERE workflow_id=${sqlValue(workflowId)} AND status IN ('active','waiting_human','blocked','paused');`);
    return { workflowId, workflowStatus: "active", currentDecision: `human_gate_${decisionStatus}`, closeoutResolution };
  }
  if (decisionStatus === "paused" || role === "pause") {
    await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET status='paused',
    current_decision='human_gate_paused',
    payload_json=${sqlValue(JSON.stringify(workflowPayload))},
    updated_at=${sqlValue(selectedAt)}
WHERE workflow_id=${sqlValue(workflowId)};`);
    await sqlite(paths.dbFile, `
UPDATE control_loop_jobs
SET status='cancelled', updated_at=${sqlValue(selectedAt)}, result_json=${sqlValue(JSON.stringify({ cancelledBy: "human_gate_pause", selectedAt }))}
WHERE workflow_id=${sqlValue(workflowId)} AND status IN ('queued','running','retry_scheduled');`);
    return { workflowId, workflowStatus: "paused", currentDecision: "human_gate_paused" };
  }
  if (decisionStatus === "terminated" || role === "terminate") {
    const archivePayload = {
      ...workflowPayload,
      archivedWorkflow: {
        humanGateId: button.human_gate_id,
        buttonId: button.button_id,
        buttonLabel: button.label,
        selectedAt,
        flashcatOriginalWords: String(feedbackContext.flashcatOriginalWords || "").trim(),
        archiveReason: "flashcat_completed_and_closed",
        resumeAllowed: true,
        resumeAction: "human_gate.resume or workflow.run status=active with the archived workflow_id"
      }
    };
    await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET status='stopped',
    current_decision='human_gate_archived_complete',
    current_phase='archived',
    payload_json=${sqlValue(JSON.stringify(archivePayload))},
    updated_at=${sqlValue(selectedAt)}
WHERE workflow_id=${sqlValue(workflowId)};`);
    await sqlite(paths.dbFile, `
UPDATE workflow_tasks
SET status='cancelled', blocked_reason='terminated by Human Gate button', completed_at=COALESCE(NULLIF(completed_at,''), ${sqlValue(selectedAt)}), updated_at=${sqlValue(selectedAt)}
WHERE workflow_id=${sqlValue(workflowId)} AND status IN ('pending','in_progress','blocked');`);
    await sqlite(paths.dbFile, `
UPDATE mixed_meeting_dispatches
SET status='cancelled', failure_type='workflow_terminated', last_error='cancelled by Human Gate terminate button', completed_at=COALESCE(NULLIF(completed_at,''), ${sqlValue(selectedAt)}), updated_at=${sqlValue(selectedAt)}
WHERE workflow_id=${sqlValue(workflowId)} AND status='queued';`);
    await sqlite(paths.dbFile, `
UPDATE control_loop_jobs
SET status='cancelled', updated_at=${sqlValue(selectedAt)}, result_json=${sqlValue(JSON.stringify({ cancelledBy: "human_gate_terminate", selectedAt }))}
WHERE workflow_id=${sqlValue(workflowId)} AND status IN ('queued','running','retry_scheduled');`);
    return { workflowId, workflowStatus: "stopped", currentDecision: "human_gate_archived_complete", archived: true, resumeAllowed: true };
  }
  return { workflowId, workflowStatus: "", currentDecision: "" };
}

function humanGateButtonPayloadObject(button = {}) {
  return parseJsonValue(button.payload_json || button.payloadJson || button.payload, {});
}

function humanGateButtonNestedPayload(buttonPayload = {}) {
  return parseJsonValue(buttonPayload.payload, buttonPayload.payload || {});
}

function humanGateCloseoutApprovalOption(buttonPayload = {}) {
  const nested = humanGateButtonNestedPayload(buttonPayload);
  return firstText(buttonPayload.optionId, buttonPayload.option_id, buttonPayload.optionKey, buttonPayload.option_key, nested.optionId, nested.option_id, nested.optionKey, nested.option_key);
}

function humanGateCloseoutArtifactRef(button = {}, buttonPayload = {}) {
  const nested = humanGateButtonNestedPayload(buttonPayload);
  return firstText(button.artifact_ref, button.artifactRef, buttonPayload.artifactRef, buttonPayload.artifact_ref, nested.artifactRef, nested.artifact_ref);
}

function artifactPathInsideRoot(root, relativePath) {
  const text = String(relativePath || "").trim();
  if (!text || /^[a-z]+:\/\//i.test(text)) return "";
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, text);
  const rel = path.relative(resolvedRoot, resolvedPath);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return resolvedPath;
}

async function readHumanGateCloseoutArtifact(paths, artifactRef = "") {
  const ref = String(artifactRef || "").trim();
  if (!ref) return null;
  const candidates = [];
  candidates.push(ref);
  if (/\.md$/i.test(ref)) candidates.push(ref.replace(/\.md$/i, ".json"));
  if (/\.markdown$/i.test(ref)) candidates.push(ref.replace(/\.markdown$/i, ".json"));
  if (!/\.json$/i.test(ref)) candidates.push(`${ref}.json`);
  for (const candidate of Array.from(new Set(candidates))) {
    const filePath = artifactPathInsideRoot(paths.root, candidate);
    if (!filePath) continue;
    try {
      const record = parseJsonValue(await fs.readFile(filePath, "utf8"), null);
      if (record && typeof record === "object") return { record, ref: candidate, filePath };
    } catch {
      continue;
    }
  }
  const artifactIds = Array.from(new Set(candidates.flatMap((candidate) => {
    const text = String(candidate || "").trim();
    const base = path.basename(text).replace(/\.(json|md|markdown)$/i, "");
    return [text, base, `${base}.json`].filter(Boolean);
  })));
  if (artifactIds.length) {
    const rows = await sqlite(paths.dbFile, `
SELECT artifact_id, path
FROM artifact_index
WHERE artifact_id IN (${artifactIds.map(sqlValue).join(",")})
   OR path IN (${artifactIds.map(sqlValue).join(",")})
ORDER BY created_at DESC
LIMIT 10;`, { json: true });
    for (const row of rows) {
      const filePath = artifactPathInsideRoot(paths.root, row.path);
      if (!filePath) continue;
      try {
        const record = parseJsonValue(await fs.readFile(filePath, "utf8"), null);
        if (record && typeof record === "object") return { record, ref: row.path || row.artifact_id, filePath };
      } catch {
        continue;
      }
    }
  }
  return null;
}

function closeoutArtifactIncidentIds(record = {}) {
  const ids = [];
  for (const row of Array.isArray(record.closeout?.incidents) ? record.closeout.incidents : []) {
    const id = String(row?.incidentId || row?.incident_id || "").trim();
    if (id) ids.push(id);
  }
  const selectedId = String(record.closeout?.selectedIncident?.incidentId || record.closeout?.selectedIncident?.incident_id || "").trim();
  if (selectedId) ids.push(selectedId);
  const recordId = String(record.incidentId || record.incident_id || "").trim();
  if (recordId) ids.push(recordId);
  return Array.from(new Set(ids));
}

async function applyIncidentCloseoutApproval(paths, button, selectedAt, feedbackContext = {}) {
  const workflowId = String(button.workflow_id || "").trim();
  const buttonPayload = humanGateButtonPayloadObject(button);
  const optionId = humanGateCloseoutApprovalOption(buttonPayload);
  if (optionId !== "A") return null;
  const record = await humanGateRecordById(paths, button.human_gate_id);
  const recordPayload = parseJsonValue(record?.payload_json, {});
  const body = humanGateBody(recordPayload);
  const raw = parseJsonValue(body.raw, body.raw || {});
  const gateType = firstText(body.gateType, body.gate_type, raw.gateType, raw.gate_type);
  if (gateType !== "incident_closeout") return null;
  const artifactRef = humanGateCloseoutArtifactRef(button, buttonPayload) || raw.closeoutArtifactRef || raw.closeout_artifact_ref || raw.closeoutArtifactId || "";
  const artifact = await readHumanGateCloseoutArtifact(paths, artifactRef);
  if (!artifact?.record) return { applied: false, reason: "closeout_artifact_not_found", artifactRef };
  if (artifact.record.schemaVersion !== "workflow_incident_closeout_artifact.v1" || artifact.record.packageKind !== "human_gate_package") {
    return { applied: false, reason: "invalid_closeout_artifact", artifactRef: artifact.ref };
  }
  if (workflowId && String(artifact.record.workflowId || "") !== workflowId) {
    return { applied: false, reason: "workflow_mismatch", artifactRef: artifact.ref, artifactWorkflowId: artifact.record.workflowId || "" };
  }
  const incidentIds = closeoutArtifactIncidentIds(artifact.record);
  if (!incidentIds.length) return { applied: false, reason: "no_incidents_in_closeout_artifact", artifactRef: artifact.ref };
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM incident_states
WHERE incident_id IN (${incidentIds.map(sqlValue).join(",")})
  AND status IN ('active','mitigating','monitoring')
ORDER BY updated_at ASC;`, { json: true });
  const resolved = [];
  for (const row of rows) {
    const payload = parseJsonValue(row.payload_json, {});
    const timeline = parseJsonValue(row.timeline_json, []);
    const note = `${selectedAt} resolved by Human Gate incident closeout approval; humanGateId=${button.human_gate_id}; buttonId=${button.button_id}; option=A; artifact=${artifact.ref}`;
    await incidentState(paths.root, {
      workflowRootDir: paths.root,
      workflowId,
      incidentId: row.incident_id,
      status: "resolved",
      mode: "normal",
      affectedPlanes: parseJsonValue(row.affected_planes_json, []),
      summary: row.summary || `Incident ${row.incident_id} resolved by Human Gate closeout approval.`,
      commander: "workflow",
      impact: row.impact || "",
      currentHypothesis: row.current_hypothesis || "",
      mitigation: row.mitigation || "",
      rollbackOptions: row.rollback_options || "Reopen incident if closeout evidence is later found invalid or the condition recurs.",
      exitCriteria: row.exit_criteria || "Human Gate closeout approved and runtime readiness is ready.",
      timeline: [...(Array.isArray(timeline) ? timeline : []), note],
      declaredAt: row.declared_at || selectedAt,
      nextUpdateAt: "",
      payload: {
        ...payload,
        closeoutResolution: {
          schemaVersion: "workflow_incident_closeout_resolution.v1",
          resolvedAt: nowIso(),
          selectedAt,
          workflowId,
          humanGateId: button.human_gate_id,
          buttonId: button.button_id,
          buttonLabel: button.label || "",
          optionId,
          artifactRef: artifact.ref,
          flashcatOriginalWords: String(feedbackContext.flashcatOriginalWords || "").trim(),
          feedbackReceivedAt: feedbackContext.feedbackReceivedAt || selectedAt
        }
      }
    });
    resolved.push(row.incident_id);
  }
  await appendWorkflowEvent(paths, {
    eventType: "incident.closeout_approved",
    status: resolved.length ? "resolved" : "noop",
    workflowId,
    humanGateId: button.human_gate_id,
    actor: "workflow",
    sourceRuntime: "workflow",
    sourceAgent: "workflow",
    artifactRef: artifact.ref,
    payload: {
      buttonId: button.button_id,
      optionId,
      artifactRef: artifact.ref,
      incidentCount: incidentIds.length,
      resolvedIncidentCount: resolved.length,
      resolvedIncidentIds: resolved,
      flashcatOriginalWords: String(feedbackContext.flashcatOriginalWords || "").trim(),
      feedbackReceivedAt: feedbackContext.feedbackReceivedAt || selectedAt
    },
    createdAt: selectedAt
  });
  return { applied: true, artifactRef: artifact.ref, incidentCount: incidentIds.length, resolvedIncidentCount: resolved.length, resolvedIncidentIds: resolved };
}

function humanGateFeedbackText(input = {}) {
  return String(firstText(
    input.flashcatOriginalWords,
    input.flashcat_original_words,
    input.feedbackText,
    input.feedback_text,
    input.reviewText,
    input.review_text,
    input.feedback,
    input.text,
    input.args
  )).trim();
}

function humanGateFeedbackRequiredReply(button = {}) {
  const callbackToken = String(button.callback_token || button.callbackToken || "").trim();
  const tokenText = callbackToken ? `tawhg:${callbackToken}` : "<Human Gate token>";
  return [
    `已记录 Human Gate 按钮选择：${button.label || ""}`,
    "请继续发送闪电猫原话/审核意见，Human Gate 才会正式完成。",
    "",
    "Telegram 当前不能从普通 inline callback button 直接弹出可输入文本框；请在本聊天发送带 token 的反馈：",
    `/hgate ${tokenText} 这里写闪电猫原话或审核意见`,
    "",
    "这段原话会按 token 绑定到本按钮、本事项和本 workflow，保存为“闪电猫原话”，并作为下一轮 workflow 校准方向和边界的依据。"
  ].join("\n");
}

async function updateHumanGateRecordFeedback(paths, humanGateId, status, feedback, updatedAt) {
  const rows = await sqlite(paths.dbFile, `SELECT payload_json FROM protocol_objects WHERE object_id=${sqlValue(humanGateId)} AND object_type='human_gate_record' LIMIT 1;`, { json: true });
  if (!rows[0]) return null;
  const recordPayload = parseJsonValue(rows[0].payload_json, {});
  const nestedPayload = parseJsonValue(recordPayload.payload, recordPayload.payload || {});
  const history = Array.isArray(nestedPayload.humanGateFeedbackHistory) ? nestedPayload.humanGateFeedbackHistory.slice(-19) : [];
  const nextPayload = {
    ...recordPayload,
    status,
    payload: {
      ...nestedPayload,
      decisionAt: ["approved", "rejected", "paused", "terminated", "expired"].includes(status) ? updatedAt : nestedPayload.decisionAt || "",
      decisionStatus: ["approved", "rejected", "paused", "terminated"].includes(status) ? status : nestedPayload.decisionStatus || "",
      humanGateFeedback: feedback,
      humanGateFeedbackHistory: [...history, feedback]
    }
  };
  const hash = jsonHash(nextPayload);
  const relPath = await writeJsonArtifact(paths.root, path.join(paths.protocolDir, "human_gate_record"), humanGateId, { ...nextPayload, hash });
  await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status=${sqlValue(status)},
    path=${sqlValue(relPath)},
    payload_json=${sqlValue(JSON.stringify(nextPayload))},
    hash=${sqlValue(hash)},
    updated_at=${sqlValue(updatedAt)}
WHERE object_id=${sqlValue(humanGateId)} AND object_type='human_gate_record';`);
  return nextPayload;
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

function rawHumanGateCallbackToken(input = {}) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  return firstText(
    input.token,
    input.callbackToken,
    input.callback_token,
    input.callbackData,
    input.callback_data,
    payload.token,
    payload.callbackToken,
    payload.callback_token,
    payload.callbackData,
    payload.callback_data,
    typeof input.payload === "string" ? input.payload : ""
  );
}

function normalizeHumanGateCallbackToken(input = {}) {
  const rawToken = rawHumanGateCallbackToken(input);
  return rawToken.startsWith("tawhg:") ? rawToken.slice("tawhg:".length) : rawToken;
}

async function humanGateButtonRowByToken(paths, input = {}) {
  const token = normalizeHumanGateCallbackToken(input);
  if (!token) return null;
  const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function humanGateRecordById(paths, humanGateId) {
  const rows = await sqlite(paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at, updated_at
FROM protocol_objects
WHERE object_id=${sqlValue(humanGateId)} AND object_type='human_gate_record'
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

function humanGateRecordExpiry(record = {}) {
  const expiresAt = protocolObjectExpiresAt(record);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  return {
    expiresAt,
    expired: Boolean(expiresAt && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()))
  };
}

async function humanGateCallbackIdentityAllowed(input = {}) {
  const senderId = String(firstText(
    input.senderId,
    input.sender_id,
    input.fromUserId,
    input.from_user_id,
    input.userId,
    input.user_id,
    input.payload?.senderId,
    input.payload?.sender_id,
    input.payload?.fromUserId,
    input.payload?.from_user_id,
    input.payload?.userId,
    input.payload?.user_id,
    input.payload?.telegramWebApp?.userId,
    input.payload?.telegram_web_app?.userId
  )).trim();
  const sourceSystem = String(firstText(input.sourceSystem, input.source_system, input.source, input.payload?.source)).trim().toLowerCase();
  const requiresSender = /(telegram|web[_-]?app|callback[_-]?query|bot|wecom|im_adapter)/.test(sourceSystem);
  if (!senderId && requiresSender) return { ok: false, senderId: "", reason: "telegram_sender_id_required" };
  if (!senderId) return { ok: true, senderId: "", reason: "no_sender_id_supplied" };
  const webApp = await humanGateWebAppConfig(input);
  const allowed = webApp.allowedTelegramUserIds.length ? webApp.allowedTelegramUserIds : [DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID];
  if (!allowed.includes(senderId)) return { ok: false, senderId, reason: "telegram_user_not_allowed", allowedTelegramUserIds: allowed };
  return { ok: true, senderId, reason: "" };
}

export async function humanGateWebAppReview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const button = await humanGateButtonRowByToken(paths, input);
  if (!button) return { handled: true, status: "not_found", token: normalizeHumanGateCallbackToken(input), replyText: "Human Gate 按钮已失效或不存在。", dbFile: paths.dbFile };
  const record = await humanGateRecordById(paths, button.human_gate_id) || {};
  const expiry = humanGateRecordExpiry(record);
  const recordPayload = parseJsonValue(record.payload_json, {});
  const body = humanGateBody(recordPayload);
  const webApp = await humanGateWebAppConfig(input);
  const publicButton = humanGateButtonFromRow(button, paths.root);
  const canSubmit = ["active", "feedback_pending"].includes(button.status) && !expiry.expired;
  return {
    handled: true,
    status: expiry.expired ? "expired" : canSubmit ? "ready" : button.status,
    canSubmit,
    token: button.callback_token,
    humanGateId: button.human_gate_id,
    workflowId: button.workflow_id || "",
    meetingId: button.meeting_id || "",
    button: {
      buttonId: button.button_id,
      label: publicButton.label,
      displayLabel: humanGateButtonDisplayLabel(publicButton, 0),
      decisionStatus: button.decision_status,
      role: button.button_role || "",
      style: humanGateButtonTelegramStyle(publicButton, 0),
      artifactRef: button.artifact_ref || "",
      summary: button.summary || "",
      prompt: button.prompt || "",
      status: button.status,
      feedbackStatus: button.feedback_status || "",
      selectedAt: button.selected_at || "",
      feedbackReceivedAt: button.feedback_received_at || ""
    },
    humanGate: {
      status: record.status || "",
      summary: humanGateSummary(recordPayload, body),
      gateType: body.gateType || body.gate_type || recordPayload.gateType || recordPayload.gate_type || "",
      artifactRef: humanGateArtifactRef(record, recordPayload, body),
      createdAt: record.created_at || "",
      updatedAt: record.updated_at || "",
      expiresAt: expiry.expiresAt
    },
    webApp,
    dbFile: paths.dbFile
  };
}

export async function humanGateWebAppSubmit(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const token = normalizeHumanGateCallbackToken(input);
  const feedbackText = humanGateFeedbackText(input);
  if (!token) return { handled: true, status: "token_required", replyText: "缺少 Human Gate token，无法判断这段原话对应哪个按钮/事项/workflow。" };
  if (!feedbackText) return { handled: true, status: "feedback_required", replyText: "请填写闪电猫原话或审核意见；点击发送后 Human Gate 才会正式完成。" };
  const webApp = await humanGateWebAppConfig(input);
  const account = String(input.account || input.accountId || input.account_id || "cat_claw").trim();
  const initData = String(input.initData || input.init_data || input.telegramWebAppInitData || input.telegram_web_app_init_data || "").trim();
  let telegramAuth = { ok: false, reason: initData ? "not_checked" : "missing_init_data" };
  if (initData) {
    const botToken = await resolveTelegramBotToken(account, input);
    telegramAuth = verifyTelegramWebAppInitData(initData, botToken, {
      maxAgeSeconds: webApp.maxInitDataAgeSeconds,
      allowedTelegramUserIds: webApp.allowedTelegramUserIds
    });
  }
  const verifyPolicy = webApp.verifyTelegramInitData;
  const strictVerify = ["1", "true", "required", "strict", "yes"].includes(verifyPolicy);
  if (telegramAuth.reason === "telegram_user_not_allowed") {
    return { handled: true, status: "telegram_user_not_allowed", telegramAuth, replyText: "该 Telegram 用户不在 Human Gate 允许提交名单中。" };
  }
  if (strictVerify && !telegramAuth.ok) {
    return { handled: true, status: "telegram_auth_failed", telegramAuth, replyText: `Telegram Web App 身份校验失败：${telegramAuth.reason}` };
  }
  if (telegramAuth.ok && webApp.allowedTelegramUserIds.length && telegramAuth.userId && !webApp.allowedTelegramUserIds.includes(telegramAuth.userId)) {
    return { handled: true, status: "telegram_user_not_allowed", telegramAuth, replyText: "该 Telegram 用户不在 Human Gate 允许提交名单中。" };
  }
  return humanGateButtonCallback(rootDir, {
    ...input,
    token,
    feedbackText,
    actor: input.actor || telegramAuth.userId || "flashcat",
    senderId: input.senderId || input.sender_id || telegramAuth.userId || "",
    sourceSystem: input.sourceSystem || input.source_system || "telegram_web_app",
    payload: {
      ...(input.payload && typeof input.payload === "object" ? input.payload : {}),
      telegramWebApp: {
        initDataPresent: Boolean(initData),
        initDataVerified: Boolean(telegramAuth.ok),
        authReason: telegramAuth.reason || "",
        userId: telegramAuth.userId || "",
        username: telegramAuth.username || "",
        submittedAt: nowIso()
      }
    }
  });
}

async function findPendingHumanGateFeedbackButton(paths, input = {}) {
  const token = normalizeHumanGateCallbackToken(input);
  if (token) {
    const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} AND status='feedback_pending' LIMIT 1;`, { json: true });
    if (rows[0]) return rows[0];
  }
  return null;
}

export async function humanGateFeedback(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const feedbackText = humanGateFeedbackText(input);
  const rawToken = rawHumanGateCallbackToken(input);
  if (!rawToken) return { handled: true, status: "token_required", replyText: "请使用按钮提示中的完整格式提交：/hgate tawhg:<token> 闪电猫原话或审核意见。裸 /hgate 不会被接受，避免多个 Human Gate 并发时错配。" };
  if (!feedbackText) return { handled: true, status: "feedback_required", replyText: "请在 token 后输入闪电猫原话或审核意见，例如：/hgate tawhg:<token> 这里写审核意见。" };
  const button = await findPendingHumanGateFeedbackButton(paths, input);
  if (!button) return { handled: true, status: "not_found", replyText: "没有找到与该 token 对应、且正在等待闪电猫原话的 Human Gate 选择；请确认先点击了对应按钮，并使用按钮提示里的 token。" };
  return humanGateButtonCallback(rootDir, {
    ...input,
    token: button.callback_token,
    feedbackText,
    actor: input.actor || input.senderId || input.sender_id || input.from || button.selected_by || "flashcat",
    sourceSystem: input.sourceSystem || input.source_system || "human_gate_feedback"
  });
}

export async function humanGateButtonCallback(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const token = normalizeHumanGateCallbackToken(input);
  if (!token) throw new Error("callback token is required");
  const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} LIMIT 1;`, { json: true });
  const button = rows[0];
  if (!button) return { handled: true, status: "unknown", token, replyText: "Human Gate 按钮已失效或不存在。" };
  const identity = await humanGateCallbackIdentityAllowed(input);
  if (!identity.ok) {
    const replyText = identity.reason === "telegram_sender_id_required"
      ? "Human Gate Telegram 回调缺少发送者身份，已拒绝处理；请通过绑定 token 的 Web App 或带 senderId 的受治理入口提交。"
      : "该 Telegram 用户不在 Human Gate 允许提交名单中。";
    return { handled: true, status: identity.reason, token, telegramAuth: identity, replyText };
  }
  const record = await humanGateRecordById(paths, button.human_gate_id);
  const expiry = humanGateRecordExpiry(record || {});
  if (expiry.expired) {
    const expiredAt = nowIso();
    await sqlite(paths.dbFile, `
UPDATE human_gate_buttons
SET status='expired', updated_at=${sqlValue(expiredAt)}
WHERE human_gate_id=${sqlValue(button.human_gate_id)} AND status IN ('active','feedback_pending');`);
    await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status='expired', updated_at=${sqlValue(expiredAt)}
WHERE object_id=${sqlValue(button.human_gate_id)} AND object_type='human_gate_record' AND status='pending';`);
    return { handled: true, status: "expired", token, workflowId: button.workflow_id, meetingId: button.meeting_id, humanGateId: button.human_gate_id, buttonId: button.button_id, expiresAt: expiry.expiresAt, replyText: "Human Gate 已过期，请让猫爪重新提交最新证据包和按钮。" };
  }
  const feedbackText = humanGateFeedbackText(input);
  if (button.status === "feedback_pending" && !feedbackText) return { handled: true, status: "feedback_pending", token, replyText: humanGateFeedbackRequiredReply(button) };
  if (button.status !== "active" && !(button.status === "feedback_pending" && feedbackText)) return { handled: true, status: button.status, token, replyText: "Human Gate 按钮已经处理过。" };
  const selectedAt = button.selected_at || nowIso();
  const now = nowIso();
  const actor = String(input.actor || input.senderId || input.sender_id || input.from || button.selected_by || "flashcat").trim();
  const callbackChatId = String(input.callbackChatId || input.callback_chat_id || button.callback_chat_id || "").trim();
  const callbackMessageId = String(input.callbackMessageId || input.callback_message_id || button.callback_message_id || "").trim();
  const feedbackPayload = {
    source: input.sourceSystem || input.source_system || "human_gate.button_callback",
    accountId: input.accountId || input.account_id || input.payload?.accountId || "",
    senderId: input.senderId || input.sender_id || actor,
    callbackChatId,
    callbackMessageId,
    callbackData: input.callbackData || input.callback_data || input.payload?.callbackData || "",
    telegramWebApp: input.telegramWebApp || input.telegram_web_app || input.payload?.telegramWebApp || input.payload?.telegram_web_app || {},
    selectedAt,
    updatedAt: now
  };
  if (!feedbackText) {
    const pendingChanges = await sqliteChangeCount(paths.dbFile, `
UPDATE human_gate_buttons
SET status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'feedback_pending' ELSE 'superseded' END,
    selected_by=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(actor)} ELSE selected_by END,
    selected_at=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(selectedAt)} ELSE selected_at END,
    callback_chat_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackChatId)} ELSE callback_chat_id END,
    callback_message_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackMessageId)} ELSE callback_message_id END,
    feedback_status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'waiting_flashcat_words' ELSE feedback_status END,
    feedback_payload_json=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(JSON.stringify(feedbackPayload))} ELSE feedback_payload_json END,
    updated_at=${sqlValue(now)}
WHERE human_gate_id=${sqlValue(button.human_gate_id)}
  AND status='active'
  AND NOT EXISTS (
    SELECT 1 FROM human_gate_buttons existing
    WHERE existing.human_gate_id=${sqlValue(button.human_gate_id)}
      AND existing.status IN ('feedback_pending','selected')
  );`);
    if (!pendingChanges) {
      const latestRows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE button_id=${sqlValue(button.button_id)} LIMIT 1;`, { json: true });
      const latest = latestRows[0] || button;
      return {
        handled: true,
        status: latest.status || "stale",
        workflowId: latest.workflow_id || button.workflow_id,
        meetingId: latest.meeting_id || button.meeting_id,
        humanGateId: latest.human_gate_id || button.human_gate_id,
        buttonId: latest.button_id || button.button_id,
        label: latest.label || button.label,
        replyText: latest.status === "feedback_pending" ? humanGateFeedbackRequiredReply(latest) : "Human Gate 按钮已经处理过。",
        dbFile: paths.dbFile
      };
    }
    await updateHumanGateRecordFeedback(paths, button.human_gate_id, "pending", {
      ...feedbackPayload,
      status: "waiting_flashcat_words",
      buttonId: button.button_id,
      buttonLabel: button.label,
      decisionStatus: button.decision_status,
      role: button.button_role || ""
    }, now);
    await meetingResume(rootDir, {
      workflowRootDir: paths.root,
      meetingId: button.meeting_id || button.workflow_id,
      from: actor,
      status: "feedback_pending",
      text: `Human Gate button selected; waiting for Flashcat original words: ${button.label}`,
      payload: {
        workflowId: button.workflow_id,
        humanGateId: button.human_gate_id,
        buttonId: button.button_id,
        status: "feedback_pending",
        source: "human_gate.button_callback"
      }
    });
    return {
      handled: true,
      status: "feedback_pending",
      workflowId: button.workflow_id,
      meetingId: button.meeting_id,
      humanGateId: button.human_gate_id,
      buttonId: button.button_id,
      label: button.label,
      replyText: humanGateFeedbackRequiredReply(button),
      dbFile: paths.dbFile
    };
  }

  const feedbackReceivedAt = now;
  const finalFeedbackPayload = {
    ...feedbackPayload,
    status: "received",
    feedbackReceivedAt,
    flashcatOriginalWords: feedbackText,
    buttonId: button.button_id,
    buttonLabel: button.label,
    decisionStatus: button.decision_status,
    role: button.button_role || ""
  };
  const finalChanges = await sqliteChangeCount(paths.dbFile, `
UPDATE human_gate_buttons
SET status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'selected' WHEN status IN ('active','feedback_pending') THEN 'superseded' ELSE status END,
    selected_by=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(actor)} ELSE selected_by END,
    selected_at=CASE WHEN button_id=${sqlValue(button.button_id)} THEN COALESCE(NULLIF(selected_at,''), ${sqlValue(selectedAt)}) ELSE selected_at END,
    callback_chat_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackChatId)} ELSE callback_chat_id END,
    callback_message_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackMessageId)} ELSE callback_message_id END,
    feedback_status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'received' WHEN status='feedback_pending' THEN 'superseded' ELSE feedback_status END,
    feedback_text=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(feedbackText)} ELSE feedback_text END,
    feedback_received_at=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(feedbackReceivedAt)} ELSE feedback_received_at END,
    feedback_payload_json=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(JSON.stringify(finalFeedbackPayload))} ELSE feedback_payload_json END,
    updated_at=${sqlValue(feedbackReceivedAt)}
WHERE human_gate_id=${sqlValue(button.human_gate_id)}
  AND (status IN ('active','feedback_pending') OR (button_id=${sqlValue(button.button_id)} AND status='feedback_pending'))
  AND NOT EXISTS (
    SELECT 1 FROM human_gate_buttons existing
    WHERE existing.human_gate_id=${sqlValue(button.human_gate_id)}
      AND existing.status='selected'
  );`);
  if (!finalChanges) {
    const latestRows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE button_id=${sqlValue(button.button_id)} LIMIT 1;`, { json: true });
    const latest = latestRows[0] || button;
    return {
      handled: true,
      status: latest.status || "stale",
      workflowId: latest.workflow_id || button.workflow_id,
      meetingId: latest.meeting_id || button.meeting_id,
      humanGateId: latest.human_gate_id || button.human_gate_id,
      buttonId: latest.button_id || button.button_id,
      label: latest.label || button.label,
      replyText: "Human Gate 按钮已经处理过。",
      dbFile: paths.dbFile
    };
  }
  await updateHumanGateRecordFeedback(paths, button.human_gate_id, button.decision_status, finalFeedbackPayload, feedbackReceivedAt);
  const workflowDecision = await applyHumanGateWorkflowDecision(paths, button, feedbackReceivedAt, {
    flashcatOriginalWords: feedbackText,
    feedbackReceivedAt,
    feedbackSource: finalFeedbackPayload.source
  });
  const resume = await meetingResume(rootDir, {
    workflowRootDir: paths.root,
    meetingId: button.meeting_id || button.workflow_id,
    from: actor,
    status: button.decision_status,
    text: [
      `Human Gate button selected: ${button.label}`,
      `闪电猫原话：${feedbackText}`
    ].join("\n"),
    payload: {
      workflowId: button.workflow_id,
      humanGateId: button.human_gate_id,
      buttonId: button.button_id,
      callbackTokenPresent: Boolean(token),
      status: button.decision_status,
      role: button.button_role || "",
      flashcatOriginalWords: feedbackText,
      feedbackReceivedAt,
      source: "human_gate.feedback",
      workflowDecision
    }
  });
  let dispatch = null;
  let archiveCheckpoint = null;
  const closeoutDispatches = [];
  if (["approved", "rejected"].includes(button.decision_status)) {
    const catTailAudit = await catTailPreOrderRiskAuditDispatchSpec(paths, button, feedbackText, selectedAt);
    const nextAction = button.decision_status === "approved"
      ? "Continue the next workflow round under the selected Human Gate button boundary."
      : "Revise the plan according to the selected Human Gate rejection button and prepare a new next-action package.";
    dispatch = await safeMeetingDispatchWithRetry(rootDir, paths, catTailAudit ? {
      workflowRootDir: paths.root,
      meetingId: catTailAudit.meetingId,
      workflowId: catTailAudit.workflowId,
      traceId: `${button.workflow_id}:pre_order_risk_audit:${button.button_id}`,
      idempotencyKey: `workflow:${button.workflow_id}:pre_order_risk_audit:${button.button_id}`,
      runtime: "openclaw",
      agentId: "cat_tail",
      dispatchType: "pre_order_risk_audit",
      priority: "high",
      createdBy: actor,
      prompt: [
        "你是猫之尾 cat_tail。闪电猫已经通过 Human Gate 批准进入下单前最后风控审计。",
        `Workflow ID: ${catTailAudit.workflowId}`,
        `Human Gate ID: ${catTailAudit.humanGateId}`,
        `Trade proposal ID: ${catTailAudit.proposalId}`,
        `Pre-order risk audit ID: ${catTailAudit.preOrderRiskAuditId}`,
        `Selected option: ${catTailAudit.selectedOption}`,
        `闪电猫原话/审核意见：${feedbackText}`,
        "",
        "只执行 pre_order_risk_audit。请基于证据包、Human Gate 原话和硬性风控规则输出中文风控 paper，并生成结构化 risk_decision。",
        "risk_decision 必须包含 reviewerAgent=cat_tail、dispatchType=pre_order_risk_audit、decision、riskLimits、evidenceRefs、paperRef、humanGateId、proposalId、preOrderRiskAuditId。当前只能批准 paper execution 或拒绝。不要下单，不要向 trading_core 发送自然语言。"
      ].filter(Boolean).join("\n"),
      payload: {
        dispatchType: "pre_order_risk_audit",
        workflowId: catTailAudit.workflowId,
        meetingId: catTailAudit.meetingId,
        humanGateId: catTailAudit.humanGateId,
        buttonId: catTailAudit.buttonId,
        proposalId: catTailAudit.proposalId,
        preOrderRiskAuditId: catTailAudit.preOrderRiskAuditId,
        selectedOption: catTailAudit.selectedOption,
        selectedAt,
        selectedBy: actor,
        flashcatOriginalWords: feedbackText,
        requestPayload: catTailAudit.requestPayload,
        requestRawPayload: catTailAudit.requestRawPayload,
        buttonPayload: catTailAudit.buttonPayload
      }
    } : {
      workflowRootDir: paths.root,
      meetingId: button.meeting_id || button.workflow_id,
      workflowId: button.workflow_id,
      traceId: `${button.workflow_id}:human_gate_button:${button.button_id}`,
      idempotencyKey: `workflow:${button.workflow_id}:human_gate_button:${button.button_id}`,
      runtime: input.runtime || "openclaw",
      agentId: input.agentId || input.agent_id || "main",
      dispatchType: "human_gate_resume",
      priority: "steer",
      createdBy: actor,
      prompt: [
        `Human Gate button selected: ${button.label}`,
        `Human Gate status: ${button.decision_status}`,
        `Workflow ID: ${button.workflow_id}`,
        `Meeting ID: ${button.meeting_id}`,
        `Human Gate ID: ${button.human_gate_id}`,
        `Button ID: ${button.button_id}`,
        button.summary ? `Button summary: ${button.summary}` : "",
        button.artifact_ref ? `Artifact ref: ${button.artifact_ref}` : "",
        button.prompt ? `Selected action: ${button.prompt}` : "",
        `闪电猫原话/审核意见：${feedbackText}`,
        "",
        "You are cat-brain main. Resume the workflow from this exact button decision.",
        nextAction,
        "The selected button status is the formal Human Gate decision. Treat Flashcat's original words as binding guidance for the next workflow direction, scope, and boundaries."
      ].filter(Boolean).join("\n"),
      payload: {
        workflowId: button.workflow_id,
        meetingId: button.meeting_id,
        humanGateId: button.human_gate_id,
        buttonId: button.button_id,
        buttonLabel: button.label,
        status: button.decision_status,
        role: button.button_role || "",
        artifactRef: button.artifact_ref || "",
        summary: button.summary || "",
        selectedAt,
        selectedBy: actor,
        flashcatOriginalWords: feedbackText,
        feedbackReceivedAt,
        humanGateResume: true,
        buttonPayload: parseJsonValue(button.payload_json, {})
      }
    }, {
      source: "human_gate_button_callback",
      humanGateId: button.human_gate_id,
      buttonId: button.button_id
    });
  }
  if (workflowDecision?.archived) {
    archiveCheckpoint = await workflowCheckpoint(rootDir, {
      workflowRootDir: paths.root,
      workflowId: button.workflow_id,
      summary: `Flashcat selected Human Gate closeout button: ${button.label}. Archive the workflow as completed/closed while preserving resume state.`,
      nextActions: [
        "cat_brain main closes workflow state, confirms no pending unsafe side effects remain, and records resume boundary.",
        "cat_claw prepares final Chinese closeout report with archive id, checkpoint id, and resume instructions."
      ],
      createdBy: "cat_claw"
    });
    closeoutDispatches.push(await safeMeetingDispatchWithRetry(rootDir, paths, {
      workflowRootDir: paths.root,
      meetingId: button.meeting_id || button.workflow_id,
      workflowId: button.workflow_id,
      traceId: `${button.workflow_id}:human_gate_archive_main:${button.button_id}`,
      idempotencyKey: `workflow:${button.workflow_id}:human_gate_archive_main:${button.button_id}`,
      runtime: "openclaw",
      agentId: "main",
      dispatchType: "workflow_archive_closeout",
      priority: "steer",
      createdBy: actor,
      prompt: [
        "闪电猫点击了 Human Gate 终止/收口按钮。",
        "语义：闪电猫认为本段工作成果已完成且复核满足要求，需要归档并结束该 workflow；这不是删除，也不是不可恢复。",
        `Workflow ID: ${button.workflow_id}`,
        `Human Gate ID: ${button.human_gate_id}`,
        `Checkpoint ID: ${archiveCheckpoint?.checkpointId || ""}`,
        `闪电猫原话/审核意见：${feedbackText}`,
        "",
        "请猫之脑 main 完成必要收口：确认任务状态、证据包、receipt、outbox、side-effect ledger 和恢复边界；如果未来闪电猫要求 resume，应从该 checkpoint/workflow_id 继续。"
      ].join("\n"),
      payload: {
        workflowId: button.workflow_id,
        humanGateId: button.human_gate_id,
        checkpointId: archiveCheckpoint?.checkpointId || "",
        flashcatOriginalWords: feedbackText,
        feedbackReceivedAt,
        archived: true,
        resumeAllowed: true
      }
    }, {
      source: "human_gate_archive_closeout",
      humanGateId: button.human_gate_id,
      buttonId: button.button_id,
      targetAgent: "main"
    }));
    closeoutDispatches.push(await safeMeetingDispatchWithRetry(rootDir, paths, {
      workflowRootDir: paths.root,
      meetingId: button.meeting_id || button.workflow_id,
      workflowId: button.workflow_id,
      traceId: `${button.workflow_id}:human_gate_archive_cat_claw:${button.button_id}`,
      idempotencyKey: `workflow:${button.workflow_id}:human_gate_archive_cat_claw:${button.button_id}`,
      runtime: "openclaw",
      agentId: "cat_claw",
      dispatchType: "workflow_archive_closeout_report",
      priority: "steer",
      createdBy: actor,
      prompt: [
        "闪电猫点击了 Human Gate 终止/收口按钮。",
        "请猫爪以中文准备最终收口汇报，包含：工作流已归档、最终成果摘要、证据/receipt 指针、checkpoint id、未来 resume 方法和仍需注意的边界。",
        `Workflow ID: ${button.workflow_id}`,
        `Human Gate ID: ${button.human_gate_id}`,
        `Checkpoint ID: ${archiveCheckpoint?.checkpointId || ""}`,
        `闪电猫原话/审核意见：${feedbackText}`,
        "不要生成新的方案；只做秘书收口和恢复指针说明。"
      ].join("\n"),
      payload: {
        workflowId: button.workflow_id,
        humanGateId: button.human_gate_id,
        checkpointId: archiveCheckpoint?.checkpointId || "",
        flashcatOriginalWords: feedbackText,
        feedbackReceivedAt,
        archived: true,
        resumeAllowed: true
      }
    }, {
      source: "human_gate_archive_closeout",
      humanGateId: button.human_gate_id,
      buttonId: button.button_id,
      targetAgent: "cat_claw"
    }));
  }
  await appendWorkflowEvent(paths, {
    eventType: "human_gate.submitted",
    status: button.decision_status,
    workflowId: button.workflow_id,
    traceId: `${button.workflow_id}:human_gate:${button.button_id}`,
    humanGateId: button.human_gate_id,
    actor,
    sourceRuntime: "workflow",
    sourceAgent: actor,
    previousState: "pending",
    nextState: button.decision_status,
    idempotencyKey: `workflow_event:human_gate.submitted:${button.button_id}`,
    artifactRef: button.artifact_ref || "",
    payload: {
      meetingId: button.meeting_id,
      buttonId: button.button_id,
      buttonLabel: button.label,
      decisionStatus: button.decision_status,
      role: button.button_role || "",
      feedbackReceivedAt,
      flashcatOriginalWords: feedbackText,
      workflowDecision,
      dispatchId: dispatch?.dispatchId || "",
      archiveCheckpointId: archiveCheckpoint?.checkpointId || ""
    }
  });
  return {
    handled: true,
    status: button.decision_status,
    workflowId: button.workflow_id,
    meetingId: button.meeting_id,
    humanGateId: button.human_gate_id,
    buttonId: button.button_id,
    label: button.label,
    workflowDecision,
    archiveCheckpoint,
    resume,
    dispatch,
    closeoutDispatches,
    flashcatOriginalWords: feedbackText,
    feedbackReceivedAt,
    replyText: `已收到闪电猫原话并正式完成 Human Gate：${button.label}`,
    dbFile: paths.dbFile
  };
}

export async function humanGateResume(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const token = normalizeHumanGateCallbackToken(input);
  const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
  const buttonId = String(input.buttonId || input.button_id || "").trim();
  const feedbackText = humanGateFeedbackText(input);
  if (!token) {
    throw new Error("human_gate.resume is button-first only; callbackToken is required");
  }
  if (!feedbackText) {
    throw new Error("human_gate.resume requires Flashcat original words or review feedback");
  }
  const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} LIMIT 1;`, { json: true });
  const button = rows[0];
  if (!button) throw new Error("human_gate.resume callback token was not found");
  const resolvedHumanGateId = humanGateId || String(button.human_gate_id || "").trim();
  const resolvedButtonId = buttonId || String(button.button_id || "").trim();
  if (!resolvedHumanGateId || !resolvedButtonId) {
    throw new Error("human_gate.resume is button-first only; humanGateId and buttonId could not be resolved from the callback token");
  }
  if (String(button.human_gate_id || "") !== resolvedHumanGateId || String(button.button_id || "") !== resolvedButtonId) {
    throw new Error("human_gate.resume token does not match the supplied humanGateId/buttonId");
  }
  return humanGateButtonCallback(rootDir, {
    ...input,
    workflowRootDir: paths.root,
    token,
    humanGateId: resolvedHumanGateId,
    buttonId: resolvedButtonId,
    feedbackText,
    sourceSystem: input.sourceSystem || input.source_system || "human_gate.resume"
  });
}

async function recoverAckedMessageFlowSemanticContinuations(paths, input = {}) {
  const cutoff = input.cutoff || new Date(Date.now() - 5 * 60_000).toISOString();
  const limit = Math.max(1, Math.min(200, Number(input.limit || 20)));
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM message_flows
WHERE status='runtime_acknowledged'
  AND final_output_present=0
  AND delivery_receipt_present=0
  AND updated_at < ${sqlValue(cutoff)}
ORDER BY updated_at
LIMIT ${limit};`, { json: true });
  const results = [];
  for (const flow of rows) {
    const ackDispatchId = messageFlowAckDispatchId(flow);
    if (!ackDispatchId) {
      await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_reconcile_skipped", {
        reason: "missing_ack_dispatch_id"
      });
      results.push({ flowId: flow.flow_id, status: "skipped", reason: "missing_ack_dispatch_id" });
      continue;
    }
    const idempotencyKey = messageFlowSemanticIdempotencyKey(flow.flow_id, ackDispatchId);
    const existing = await sqlite(paths.dbFile, `
SELECT dispatch_id, status
FROM mixed_meeting_dispatches
WHERE dispatch_type='message_flow_semantic'
  AND idempotency_key=${sqlValue(idempotencyKey)}
LIMIT 1;`, { json: true });
    if (existing[0]) {
      await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_reconcile_existing", {
        ackDispatchId,
        semanticDispatchId: existing[0].dispatch_id,
        semanticStatus: existing[0].status,
        idempotencyKey
      });
      results.push({ flowId: flow.flow_id, status: "existing", dispatchId: existing[0].dispatch_id, semanticStatus: existing[0].status });
      continue;
    }
    const dispatchRows = await sqlite(paths.dbFile, `
SELECT *
FROM mixed_meeting_dispatches
WHERE dispatch_id=${sqlValue(ackDispatchId)}
LIMIT 1;`, { json: true });
    const ackDispatch = dispatchRows[0];
    if (!ackDispatch) {
      await appendMessageFlowEvent(paths, flow.flow_id, "runtime_acknowledged", "semantic_continuation_reconcile_failed", {
        ackDispatchId,
        reason: "ack_dispatch_missing"
      });
      results.push({ flowId: flow.flow_id, status: "failed", reason: "ack_dispatch_missing", ackDispatchId });
      continue;
    }
    const continuation = await queueMessageFlowSemanticContinuation(paths, ackDispatch, {
      runtimeRunId: flow.runtime_run_id || "",
      messageId: flow.message_id || "",
      receivedAt: flow.updated_at || nowIso()
    }, input);
    assertSemanticContinuationQueued(continuation);
    results.push({ flowId: flow.flow_id, status: "queued", ackDispatchId, semanticDispatchId: continuation.dispatchId });
  }
  return results;
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
  deliverTelegramOutboxRow,
  ensureWorkflowLayout,
  humanGatePlanOptionButtons,
  nowIso,
  updateMessageFlowFromTelegramDelivery,
  HUMAN_GATE_APPROVE_OPTION_MAX,
  HUMAN_GATE_APPROVE_OPTION_MIN,
  TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES,
  TELEGRAM_OUTBOX_DELIVERY_LEASE_MS
});

export const TELEGRAM_OUTBOX_ACTION_REGISTRY = createTelegramOutboxActionRegistry(TELEGRAM_OUTBOX_ACTION_HANDLERS);

export const {
  telegramOutboxDeliveryPreview,
  telegramOutboxRequeuePreview,
  telegramOutboxRequeueExecutionPackagePreview,
  telegramOutboxDelivery,
  telegramOutbox
} = TELEGRAM_OUTBOX_ACTION_HANDLERS;

export const HUMAN_GATE_ACTION_HANDLERS = createHumanGateActionHandlers({
  cleanFileSegment,
  collectHumanGateInboxItems,
  dailyKey,
  ensureWorkflowLayout,
  humanGateActionHint,
  nowIso,
  protocolRecord: (...args) => protocolRecord(...args),
  relativeTo,
  renderHumanGateInboxHtml,
  renderHumanGateTelegramSummary,
  riskSummaryFor,
  safeId,
  writeJsonArtifact,
  writeTextArtifact,
  DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
  HUMAN_GATE_STATUSES
});

export const HUMAN_GATE_ACTION_REGISTRY = createHumanGateActionRegistry(HUMAN_GATE_ACTION_HANDLERS);

export const {
  humanGateInbox,
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
  workflowTemplateRollbackRecord,
  workflowTemplateExtractPreview,
  workflowTemplateExtractRecord
});

export async function runWorkflowAction(rootDir, input = {}) {
  const requestedAction = String(input.action || "workflow.status");
  const action = canonicalWorkflowAction(requestedAction);
  const permissionDecision = await authorizeWorkflowAction(rootDir, input);
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
  switch (action) {
    case "human_gate.request":
      return humanGateRequest(rootDir, input);
    case "human_gate.web_app_review":
    case "human_gate.review_form":
      return humanGateWebAppReview(rootDir, input);
    case "human_gate.web_app_submit":
    case "human_gate.submit_form":
      return humanGateWebAppSubmit(rootDir, input);
    case "human_gate.button_callback":
    case "human_gate.callback":
      return humanGateButtonCallback(rootDir, input);
    case "human_gate.feedback":
    case "human_gate.submit_feedback":
      return humanGateFeedback(rootDir, input);
    case "human_gate.resume":
    case "human_gate.confirm":
      return humanGateResume(rootDir, input);
    default:
      throw new Error(`unknown workflow action: ${requestedAction}${requestedAction === action ? "" : ` (canonical: ${action})`}`);
  }
}
