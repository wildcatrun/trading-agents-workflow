import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import tls from "node:tls";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { WorkflowReadModel } from "./console/read-model.js";

const execFileAsync = promisify(execFile);

export const WORKFLOW_SCHEMA_VERSION = 13;
export const LEGACY_WORKFLOW_ROOT = "/home/flashcat/.openclaw/shared/trading-agents-workflow";
const ALLOW_LEGACY_ROOT_ENV = "TRADING_AGENTS_WORKFLOW_ALLOW_LEGACY_ROOT";

const ASSET_TYPES = new Set(["stock", "futures", "crypto", "forex", "etf", "index", "commodity", "other"]);
const THESIS_STATUSES = new Set(["draft", "active", "watch", "stale", "invalidated", "closed"]);
const RADAR_ZONES = new Set(["bright", "dark", "overheated", "dead_water", "watch_only", "risk_avoid", "unknown"]);
const GATE_STATUSES = new Set(["pending", "approved", "rejected", "waived"]);
const PROTOCOL_OBJECT_TYPES = new Set(["research_signal", "evidence_pack", "research_memo", "trade_proposal", "risk_decision", "human_gate_record", "workflow_task_launch_package", "simulation_request", "simulation_result", "executable_trade_intent", "trading_core_receipt", "execution_audit_summary", "generic"]);
const RISK_DECISION_STATUSES = new Set(["pending", "approved", "rejected", "revise_required"]);
const HUMAN_GATE_STATUSES = new Set(["pending", "approved", "rejected", "paused", "terminated", "expired", "superseded"]);
const TRADE_SIDES = new Set(["buy", "sell", "short", "cover", "reduce", "close"]);
const ORDER_TYPES = new Set(["market", "limit", "stop", "stop_limit", "twap", "vwap"]);
const TRADING_CORE_SIDES = new Set(["buy", "sell"]);
const TRADING_CORE_ORDER_TYPES = new Set(["market", "limit"]);
const TRADING_CORE_ASSURANCE_VALUES = new Set(["mtls", "codex_mtls", "local_codex_mtls"]);
const TRADING_CORE_EXECUTION_MODES = new Set(["paper", "simulation"]);
const RECEIPT_STATUSES = new Set(["accepted", "rejected", "submitted", "filled", "partial", "cancelled", "failed"]);
const TRADING_CORE_RECEIPT_TRANSITIONS = {
  ready_for_trading_core: new Set(["accepted", "submitted", "partial", "filled", "cancelled", "rejected", "failed"]),
  trading_core_accepted: new Set(["submitted", "partial", "filled", "cancelled", "rejected", "failed"]),
  trading_core_submitted: new Set(["partial", "filled", "cancelled", "failed", "rejected"]),
  trading_core_partial: new Set(["partial", "filled", "cancelled", "failed"]),
  trading_core_rejected: new Set([]),
  trading_core_failed: new Set([]),
  trading_core_cancelled: new Set([]),
  trading_core_filled: new Set([])
};
const RUNTIMES = new Set(["openclaw", "openclaw_route_shell", "hermers", "telegram", "local_codex", "codex", "claude_code", "claude-code", "opencode", "trading_sim", "trading_core", "system", "other"]);
const DISPATCH_STATUSES = new Set(["queued", "sent", "acked", "failed", "cancelled"]);
const MESSAGE_FLOW_STATUSES = new Set(["inbound_received", "route_registered", "runtime_dispatched", "runtime_acknowledged", "semantic_dispatched", "runtime_completed", "runtime_failed", "outbound_queued", "telegram_sent", "telegram_failed"]);
const MESSAGE_FLOW_RETURN_POLICIES = new Set(["reply_to_source_chat", "report_to_flashcat", "silent"]);
const MESSAGE_FLOW_DELIVERY_RETURN_POLICIES = new Set(["reply_to_source_chat", "report_to_flashcat"]);
const WORKFLOW_RUN_STATUSES = new Set(["active", "waiting_human", "blocked", "paused", "completed", "stopped", "cancelled"]);
const WORKFLOW_TASK_STATUSES = new Set(["pending", "in_progress", "done", "blocked", "failed", "cancelled"]);
const WORKFLOW_TASK_PRIORITIES = new Set(["flash", "steer", "high", "normal", "low"]);
const WORKFLOW_SESSION_PACK_STATUSES = new Set(["draft", "active", "disabled", "archived"]);
const WORKFLOW_SESSION_RUN_STATUSES = new Set(["queued", "running", "completed", "failed", "cancelled"]);
const WORKFLOW_SCHEDULE_STATUSES = new Set(["active", "paused", "disabled"]);
const WORKFLOW_SCHEDULE_KINDS = new Set(["cron", "interval"]);
const WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES = new Set(["skip", "allow"]);
const WORKFLOW_SCHEDULE_MISFIRE_POLICIES = new Set(["skip", "run_once"]);
const RETIRED_RUNTIME_AGENT_STATUSES = new Set(["retired", "archived"]);
const INCIDENT_STATUSES = new Set(["active", "mitigating", "monitoring", "resolved", "cancelled"]);
const INCIDENT_MODES = new Set(["normal", "degraded", "critical-only", "paper-only", "frozen"]);
const AUTO_RETRY_FAILURE_TYPES = new Set(["provider_timeout", "runtime_timeout", "acp_unavailable", "transient_runtime", "ack_contract_violation"]);
const DEFAULT_RUNTIME_ACK_TIMEOUT_SECONDS = 90;
const DEFAULT_RUNTIME_ACK_RETRY_SECONDS = 30;
const DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS = 3;
const DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS = 300;
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
const TELEGRAM_OUTBOX_DELIVERY_LEASE_MS = 120_000;
const HUMAN_GATE_ZH_TEXT = new Map([
  [
    "Hermes cron/heartbeat migration Human Gate: choose A/B/C next path after cat_claw audit pass. Recommended path remains Plan C unless Flashcat selects otherwise.",
    "Hermes cron/heartbeat 迁移 Human Gate：猫爪复核通过后，请在 A/B/C 中选择下一步路径。除非闪电猫另行选择，建议路径仍为方案 C。"
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

const WORKFLOW_PERMISSION_READ_ACTIONS = new Set([
  "workflow.status",
  "workflow.health",
  "workflow.readiness",
  "workflow.topology",
  "workflow.runtime_agents",
  "workflow.task.draft",
  "workflow.task.launch.list",
  "workflow.task.list",
  "workflow.event.list",
  "workflow.event.timeline",
  "workflow.verification.list",
  "workflow.session_pack.get",
  "workflow.session_pack.list",
  "workflow.schedule.list",
  "human_gate.web_app_review",
  "human_gate.inbox",
  "message_flow.list",
  "workflow.permission.check",
  "workflow.pause.preview",
  "workflow.resume.preview",
  "workflow.stop.preview",
  "workflow.incident.from_dead_letter.preview",
  "workflow.control_loop.job.requeue.preview",
  "workflow.incident.closeout.cat_claw_report.preview",
  "workflow.incident.closeout.human_gate_package.preview",
  "workflow.incident.closeout.artifact.preview",
  "workflow.incident.closeout.human_gate_request.preview",
  "telegram.outbox.delivery.preview",
  "telegram.outbox.requeue.preview",
  "telegram.outbox.requeue.execution_package.preview",
  "workflow.rerun.agent.preview",
  "workflow.rerun.phase.preview"
]);

const WORKFLOW_PURE_PREVIEW_ACTIONS = new Set([
  "workflow.task.draft"
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

const WORKFLOW_ACTION_PERMISSION_RULES = {
  "workflow.run.upsert": { capability: "workflow.write", risk: "medium", mutating: true },
  "workflow.swarm.plan": { capability: "workflow.plan", risk: "medium", mutating: true },
  "workflow.task.launch.prepare": { capability: "workflow.task.launch.prepare", risk: "medium", mutating: true },
  "workflow.task.launch.review": { capability: "workflow.task.launch.review", risk: "high", mutating: true, requiresCatClawAudit: true },
  "workflow.task.launch.approve": { capability: "workflow.task.launch.approve", risk: "high", mutating: true, requiresCatClawAudit: true },
  "workflow.task.create": { capability: "workflow.task.write", risk: "medium", mutating: true },
  "workflow.task.update": { capability: "workflow.task.write", risk: "medium", mutating: true },
  "workflow.advance": { capability: "workflow.operate", risk: "high", mutating: true, requiresCatClawAudit: true },
  "workflow.pause": { capability: "workflow.operate", risk: "high", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.resume": { capability: "workflow.operate", risk: "high", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.stop": { capability: "workflow.operate", risk: "high", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.supervise": { capability: "workflow.operate", risk: "high", mutating: true },
  "workflow.control_loop.tick": { capability: "workflow.operate", risk: "high", mutating: true },
  "workflow.control_loop.job.requeue": { capability: "workflow.operate", risk: "medium", mutating: true },
  "workflow.schedule.upsert": { capability: "schedule.write", risk: "high", mutating: true, requiresCatClawAudit: true },
  "workflow.schedule.pause": { capability: "schedule.write", risk: "high", mutating: true },
  "workflow.schedule.resume": { capability: "schedule.write", risk: "high", mutating: true },
  "workflow.schedule.disable": { capability: "schedule.write", risk: "high", mutating: true },
  "workflow.checkpoint": { capability: "workflow.checkpoint", risk: "medium", mutating: true },
  "workflow.event.append": { capability: "workflow.event.write", risk: "medium", mutating: true },
  "workflow.verification.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.evaluate": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.session_pack.upsert": { capability: "session.write", risk: "medium", mutating: true },
  "workflow.session_run.start": { capability: "session.run", risk: "medium", mutating: true },
  "workflow.session_run.complete": { capability: "session.run", risk: "medium", mutating: true },
  "runtime.agent.upsert": { capability: "registry.write", risk: "high", mutating: true, requiresCatClawAudit: true },
  "route_shell.ingest": { capability: "message_flow.send", risk: "low", mutating: true },
  "meeting.runtime_participant": { capability: "dispatch.write", risk: "medium", mutating: true },
  "telegram.live": { capability: "telegram.configure", risk: "high", mutating: true, requiresCatClawAudit: true },
  "meeting.dispatch": { capability: "dispatch.write", risk: "high", mutating: true },
  "meeting.ingest": { capability: "receipt.write", risk: "medium", mutating: true },
  "workflow.dispatch.reconcile": { capability: "dispatch.reconcile", risk: "high", mutating: true },
  "runtime.bridge.drain": { capability: "runtime.dispatch", risk: "high", mutating: true },
  "human_gate.request": { capability: "human_gate.write", risk: "high", mutating: true, requiresCatClawAudit: true },
  "human_gate.web_app_submit": { capability: "human_gate.submit", risk: "high", mutating: true },
  "human_gate.button_callback": { capability: "human_gate.submit", risk: "high", mutating: true },
  "human_gate.feedback": { capability: "human_gate.submit", risk: "high", mutating: true },
  "human_gate.resume": { capability: "human_gate.submit", risk: "high", mutating: true },
  "meeting.resume": { capability: "workflow.operate", risk: "high", mutating: true },
  "meeting.disperse": { capability: "dispatch.write", risk: "high", mutating: true },
  "telegram.outbox": { capability: "telegram.outbox", risk: "high", mutating: true },
  "telegram.outbox.delivery": { capability: "telegram.outbox", risk: "medium", mutating: true, requiresCatClawAudit: true },
  "message_flow.send": { capability: "message_flow.send", risk: "low", mutating: true },
  "message_flow.reconcile": { capability: "message_flow.reconcile", risk: "medium", mutating: true },
  "protocol.record": { capability: "protocol.write", risk: "medium", mutating: true },
  "trade.proposal": { capability: "trade.proposal", risk: "high", mutating: true, requiresCatClawAudit: true, requiresFreshnessCheck: true },
  "risk.decision": { capability: "risk.decision", risk: "critical", mutating: true, requiresCatClawAudit: true, requiresFreshnessCheck: true },
  "human_gate.record": { capability: "human_gate.record", risk: "critical", mutating: true, requiresCatClawAudit: true },
  "trade.intent": { capability: "trade.intent", risk: "critical", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true, requiresFreshnessCheck: true },
  "trading_core.receipt": { capability: "trading_core.receipt", risk: "critical", mutating: true, requiresHumanGateEvidence: true, requiresFreshnessCheck: true },
  "side_effect.record": { capability: "side_effect.record", risk: "high", mutating: true, requiresCatClawAudit: true },
  "incident.state": { capability: "incident.write", risk: "medium", mutating: true },
  "workflow.incident.from_dead_letter": { capability: "incident.write", risk: "medium", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.incident.closeout.artifact": { capability: "incident.write", risk: "medium", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.incident.closeout.human_gate_request": { capability: "human_gate.write", risk: "medium", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "instrument.upsert": { capability: "research.write", risk: "medium", mutating: true },
  "radar.update": { capability: "research.write", risk: "medium", mutating: true },
  "thesis.update": { capability: "research.write", risk: "medium", mutating: true },
  "research.evidence": { capability: "research.write", risk: "medium", mutating: true },
  "research.memo": { capability: "research.write", risk: "medium", mutating: true },
  "gate.review": { capability: "gate.review", risk: "medium", mutating: true },
  "cat_claw.audit": { capability: "cat_claw.audit", risk: "low", mutating: true }
};

const WORKFLOW_REGISTRY_WRITE_ACTIONS = new Set([
  "runtime.agent.upsert"
]);

const LOCAL_CODEX_REGISTRY_WRITE_ENV = "TRADING_AGENTS_WORKFLOW_LOCAL_CODEX_REGISTRY_WRITE";
const LOCAL_CODEX_REGISTRY_WRITER_AGENTS = new Set(["local_codex", "codex"]);
const LOCAL_CODEX_REGISTRY_WRITER_RUNTIMES = new Set(["local_codex", "codex"]);
const LOCAL_CODEX_REGISTRY_WRITER_SOURCE_SYSTEMS = new Set([
  "codex",
  "cli",
  "codex_cli",
  "codex_desktop",
  "codex_mcp",
  "local_codex",
  "local_codex_mcp",
  "local_codex_mtls"
]);

const WORKFLOW_POLICY_HARD_GATE_ACTIONS = new Set([
  "risk.decision",
  "trade.intent",
  "trading_core.receipt",
  "workflow.pause",
  "workflow.resume",
  "workflow.stop",
  "workflow.incident.from_dead_letter",
  "workflow.incident.closeout.artifact",
  "workflow.incident.closeout.human_gate_request",
  "telegram.outbox.delivery"
]);

function nowIso() {
  return new Date().toISOString();
}

function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function boolOption(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(value);
}

function safeId(prefix) {
  return `${prefix}.${Date.now().toString(36)}.${randomUUID().slice(0, 8)}`;
}

function resolveHome(value) {
  if (value && value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value ? path.resolve(value) : value;
}

export function resolveWorkflowRoot(rootDir, input = {}) {
  const inputRoot = input.workflowRootDir || input.workflow_root || input.workflowRoot || input.rootDir || input.root;
  if (rootDir && inputRoot) {
    const resolvedRootDir = resolveHome(String(rootDir));
    const resolvedInputRoot = resolveHome(String(inputRoot));
    if (resolvedRootDir !== resolvedInputRoot) {
      throw new Error(`workflow root mismatch: rootDir=${resolvedRootDir} input.workflowRootDir=${resolvedInputRoot}; pass one active workflow root only`);
    }
  }
  const candidate = inputRoot || rootDir || process.env.TRADING_AGENTS_WORKFLOW_ROOT || process.env.CAT_MEETING_GOVERNANCE_ROOT;
  if (!candidate) {
    throw new Error(`trading-agents-workflow root is required; pass --root or set TRADING_AGENTS_WORKFLOW_ROOT. Legacy root ${LEGACY_WORKFLOW_ROOT} has retired and is fail-closed.`);
  }
  const root = resolveHome(String(candidate));
  const legacyRoot = path.resolve(LEGACY_WORKFLOW_ROOT);
  if (root === legacyRoot && !boolOption(process.env[ALLOW_LEGACY_ROOT_ENV], false)) {
    throw new Error(`legacy trading-agents-workflow root has retired and is fail-closed: ${LEGACY_WORKFLOW_ROOT}; pass --root or set TRADING_AGENTS_WORKFLOW_ROOT to an active state root. To temporarily allow it, set ${ALLOW_LEGACY_ROOT_ENV}=1.`);
  }
  return root;
}

export function workflowPaths(rootDir, input = {}) {
  const root = resolveWorkflowRoot(rootDir, input);
  return {
    root,
    dbFile: path.join(root, "tracking.db"),
    researchDir: path.join(root, "research"),
    thesisDir: path.join(root, "thesis"),
    radarDir: path.join(root, "radar"),
    evidenceDir: path.join(root, "evidence"),
    memosDir: path.join(root, "memos"),
    gatesDir: path.join(root, "gates"),
    artifactsDir: path.join(root, "artifacts"),
    checkpointsDir: path.join(root, "workflows", "checkpoints"),
    protocolDir: path.join(root, "protocol"),
    intentsDir: path.join(root, "intents"),
    receiptsDir: path.join(root, "receipts"),
    bridgeDir: path.join(root, "bridge"),
    dispatchesDir: path.join(root, "bridge", "dispatches"),
    messagesDir: path.join(root, "bridge", "messages"),
    telegramDir: path.join(root, "bridge", "telegram"),
    humanGateDir: path.join(root, "bridge", "human_gates"),
    humanGateInboxDir: path.join(root, "human-gates", "inbox"),
    workflowsDir: path.join(root, "workflows"),
    templatesDir: path.join(root, "templates"),
    exportsDir: path.join(root, "exports"),
    registryDir: path.join(root, "registry"),
    indexDir: path.join(root, "index")
  };
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

function toList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function firstText(...values) {
  for (const value of values) {
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      const text = String(item ?? "").trim();
      if (text) return text;
    }
  }
  return "";
}

function normalizeRequester(value, fallback = "cat_claw") {
  const text = firstText(value, fallback);
  if (text === "catclaw") throw new Error("retired agent id catclaw is invalid; use cat_claw");
  return text;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseJsonValue(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
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

function jsonHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function textHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

const SENSITIVE_PERSISTENCE_KEY = /(^|[_-])(token|secret|password|credential|api[_-]?key|access[_-]?key|refresh[_-]?key|private[_-]?key|callback[_-]?data|callback[_-]?token)($|[_-])/i;

function isSensitivePersistenceKey(key) {
  const normalized = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return SENSITIVE_PERSISTENCE_KEY.test(normalized);
}

function redactSensitiveTextForPersistence(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/tawhg:[A-Za-z0-9._=-]+/g, "tawhg:<redacted>")
    .replace(/(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)\s+([^\s,;]+)/gi, "$1 [redacted]");
}

function redactSensitiveForPersistence(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return redactSensitiveTextForPersistence(value);
  }
  if (typeof value !== "object") return value;
  if (depth > 8) return "[nested redacted]";
  if (Array.isArray(value)) return value.map((item) => redactSensitiveForPersistence(item, depth + 1));
  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = isSensitivePersistenceKey(key) ? "[redacted]" : redactSensitiveForPersistence(item, depth + 1);
  }
  return redacted;
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

function receiptIntentStatus(status) {
  if (status === "rejected" || status === "failed") return `trading_core_${status}`;
  return `trading_core_${status}`;
}

function numericField(source = {}, keys = []) {
  for (const key of keys) {
    const value = numberOrNull(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeTradingCorePriceConstraints(value, orderType) {
  const raw = parseJsonValue(value, value || {});
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const referencePrice = numericField(input, ["referencePrice", "reference_price", "lastPrice", "last_price", "price"]);
  const limitPrice = numericField(input, ["limitPrice", "limit_price"]);
  const maxSlippageBps = numericField(input, ["maxSlippageBps", "max_slippage_bps"]);
  const referencePriceTimestamp = firstText(
    input.referencePriceTimestamp,
    input.reference_price_timestamp,
    input.referencePriceAt,
    input.reference_price_at,
    input.priceTimestamp,
    input.price_timestamp,
    input.asOf,
    input.as_of
  );
  const normalized = {};
  const rejectionReasons = [];
  if (referencePrice === null || referencePrice <= 0) {
    rejectionReasons.push("missing_positive_reference_price");
  } else {
    normalized.referencePrice = referencePrice;
  }
  if (orderType === "limit") {
    if (limitPrice === null || limitPrice <= 0) {
      rejectionReasons.push("missing_positive_limit_price");
    } else {
      normalized.limitPrice = limitPrice;
    }
  } else if (limitPrice !== null && limitPrice > 0) {
    normalized.limitPrice = limitPrice;
  }
  if (maxSlippageBps !== null && maxSlippageBps >= 0) normalized.maxSlippageBps = maxSlippageBps;
  if (referencePriceTimestamp) normalized.referencePriceTimestamp = referencePriceTimestamp;
  return { value: normalized, rejectionReasons };
}

function normalizeTradingCoreRiskLimits(value) {
  const raw = parseJsonValue(value, value || {});
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const normalized = {};
  const maxNotionalUsd = numericField(input, ["maxNotionalUsd", "max_notional_usd", "maxNotional", "max_notional"]);
  const maxOrderNotionalUsd = numericField(input, ["maxOrderNotionalUsd", "max_order_notional_usd", "maxOrderNotional", "max_order_notional"]);
  const maxLossUsd = numericField(input, ["maxLossUsd", "max_loss_usd", "maxLoss", "max_loss"]);
  const maxDailyLossUsd = numericField(input, ["maxDailyLossUsd", "max_daily_loss_usd", "maxDailyLoss", "max_daily_loss"]);
  const rejectionReasons = [];
  if (maxNotionalUsd !== null) normalized.maxNotionalUsd = maxNotionalUsd;
  if (maxOrderNotionalUsd !== null) normalized.maxOrderNotionalUsd = maxOrderNotionalUsd;
  if (maxLossUsd !== null) normalized.maxLossUsd = maxLossUsd;
  if (maxDailyLossUsd !== null) normalized.maxDailyLossUsd = maxDailyLossUsd;
  const hasPositiveNotionalGuardrail = (maxNotionalUsd !== null && maxNotionalUsd > 0) || (maxOrderNotionalUsd !== null && maxOrderNotionalUsd > 0);
  const hasLossGuardrail = (maxLossUsd !== null && maxLossUsd >= 0) || (maxDailyLossUsd !== null && maxDailyLossUsd >= 0);
  if (!hasPositiveNotionalGuardrail && !hasLossGuardrail) rejectionReasons.push("missing_numeric_risk_guardrail");
  if ((maxNotionalUsd !== null && maxNotionalUsd <= 0) || (maxOrderNotionalUsd !== null && maxOrderNotionalUsd <= 0)) {
    rejectionReasons.push("invalid_notional_risk_guardrail");
  }
  if ((maxLossUsd !== null && maxLossUsd < 0) || (maxDailyLossUsd !== null && maxDailyLossUsd < 0)) {
    rejectionReasons.push("invalid_loss_risk_guardrail");
  }
  return { value: normalized, rejectionReasons };
}

function executableTradeIntentHash(intent) {
  return jsonHash({ ...intent, intentHash: "" });
}

function buildExecutableTradeIntent(input, data) {
  const {
    intentId,
    status,
    instrument,
    side,
    quantity,
    orderType,
    proposalId,
    riskDecisionId,
    preOrderRiskAuditId,
    humanGateId,
    workflowId,
    traceId,
    executionMode,
    sourceSystem,
    actor,
    assurance,
    clientCertFingerprint,
    idempotencyKey,
    priceConstraints,
    riskLimits,
    expiresAt,
    marketType,
    exchange,
    baseAsset,
    quoteAsset,
    clientOrderId,
    timeInForce,
    rejectionReasons
  } = data;
  const executable = {
    schemaVersion: 1,
    objectType: "executable_trade_intent",
    intentId,
    workflowId,
    traceId,
    status,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    side,
    quantity,
    orderType,
    proposalId,
    riskDecisionId,
    preOrderRiskAuditId,
    humanGateId,
    actor,
    assurance,
    clientCertFingerprint,
    idempotencyKey,
    priceConstraints,
    riskLimits,
    expiresAt,
    executionMode,
    sourceSystem,
    rejectionReasons
  };
  const optional = {
    marketType,
    exchange,
    baseAsset,
    quoteAsset,
    clientOrderId,
    timeInForce,
    payload: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}))
  };
  for (const [key, value] of Object.entries(optional)) {
    if (key === "payload") {
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) executable[key] = value;
      continue;
    }
    const text = String(value || "").trim();
    if (text) executable[key] = text;
  }
  executable.intentHash = executableTradeIntentHash(executable);
  return executable;
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

function boolInt(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(text)) return 0;
  if (["1", "true", "yes", "on"].includes(text)) return 1;
  return fallback ? 1 : 0;
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

function runtimeAgentKey(runtime, agentId) {
  return `${normalizeRuntime(runtime)}:${normalizeAgentId(agentId)}`;
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

function workflowActionPermissionRule(action, input = {}) {
  const canonical = canonicalWorkflowAction(action);
  if (WORKFLOW_PERMISSION_READ_ACTIONS.has(canonical)) {
    return { action: canonical, capability: "read", risk: "low", mutating: false, readOnly: true };
  }
  if (canonical === "telegram.outbox") {
    const operation = String(input.operation || "").trim().toLowerCase();
    const deliver = boolOption(input.deliver ?? input.autoDeliver ?? input.auto_deliver, false);
    if (!deliver && ["", "list", "status", "get", "read"].includes(operation)) {
      return { action: canonical, capability: "read", risk: "low", mutating: false, readOnly: true };
    }
  }
  return { action: canonical, ...(WORKFLOW_ACTION_PERMISSION_RULES[canonical] || { capability: "workflow.write", risk: "medium", mutating: true }) };
}

function workflowPermissionCaller(input = {}) {
  const callerAgent = normalizeOptionalAgentId(firstText(
    input.callerAgent,
    input.caller_agent,
    input.principalAgent,
    input.principal_agent,
    input.fromAgent,
    input.from_agent,
    input.sourceAgent,
    input.source_agent,
    input.createdBy,
    input.created_by,
    input.updatedBy,
    input.updated_by,
    input.requester,
    input.actor
  ));
  const callerRuntimeText = firstText(
    input.callerRuntime,
    input.caller_runtime,
    input.principalRuntime,
    input.principal_runtime,
    input.fromRuntime,
    input.from_runtime,
    input.sourceRuntime,
    input.source_runtime,
    input.runtime
  );
  return {
    agentId: callerAgent,
    runtime: callerRuntimeText ? normalizeRuntime(callerRuntimeText) : "",
    sourceSystem: String(input.sourceSystem || input.source_system || "").trim(),
    toolMode: "",
    requestedToolMode: String(input.toolMode || input.tool_mode || input.capabilityMode || input.capability_mode || "").trim().toLowerCase()
  };
}

function workflowCapabilitySetFromList(value, set = new Set()) {
  for (const item of toList(value)) set.add(item);
  return set;
}

function workflowActionSetFromList(value, set = new Set()) {
  for (const item of toList(value)) set.add(canonicalWorkflowAction(item));
  return set;
}

function workflowCapabilityPolicy(capabilities = {}, mode = "") {
  const policy = {
    mode: String(mode || capabilities.mode || capabilities.capabilityMode || capabilities.capability_mode || "").trim().toLowerCase(),
    permissions: new Set(),
    allowedActions: new Set(),
    forbiddenActions: new Set()
  };
  workflowCapabilitySetFromList(capabilities.permissions, policy.permissions);
  workflowCapabilitySetFromList(capabilities.capabilities, policy.permissions);
  workflowCapabilitySetFromList(capabilities.allowedCapabilities, policy.permissions);
  workflowCapabilitySetFromList(capabilities.allowed_capabilities, policy.permissions);
  workflowCapabilitySetFromList(capabilities.workflowCapabilities, policy.permissions);
  workflowCapabilitySetFromList(capabilities.workflow_capabilities, policy.permissions);
  workflowActionSetFromList(capabilities.allowedActions, policy.allowedActions);
  workflowActionSetFromList(capabilities.allowed_actions, policy.allowedActions);
  workflowActionSetFromList(capabilities.forbiddenActions, policy.forbiddenActions);
  workflowActionSetFromList(capabilities.forbidden_actions, policy.forbiddenActions);
  const tools = objectValue(capabilities.tools);
  workflowCapabilitySetFromList(tools.permissions, policy.permissions);
  workflowCapabilitySetFromList(tools.capabilities, policy.permissions);
  workflowActionSetFromList(tools.allowedActions, policy.allowedActions);
  workflowActionSetFromList(tools.allowed_actions, policy.allowedActions);
  workflowActionSetFromList(tools.forbiddenActions, policy.forbiddenActions);
  workflowActionSetFromList(tools.forbidden_actions, policy.forbiddenActions);
  for (const [key, value] of Object.entries(capabilities)) {
    if (value === true && /^[a-z0-9_.:-]+$/i.test(key)) policy.permissions.add(key);
  }
  return policy;
}

function addWorkflowDefaultCapabilities(policy, caller = {}, row = null) {
  if (!row) return policy;
  const agent = String(caller.agentId || row?.agent_id || "").trim();
  const mode = String(caller.toolMode || policy.mode || "").trim().toLowerCase();
  if (agent === "main" || agent === "cat_heart" || agent === "catheart") {
    policy.permissions.add("*");
    return policy;
  }
  if (mode === "governance" || agent === "cat_claw") {
    for (const permission of [
      "read",
      "message_flow.send",
      "human_gate.write",
      "human_gate.submit",
      "human_gate.record",
      "telegram.outbox",
      "cat_claw.audit",
      "incident.write",
      "workflow.event.write",
      "workflow.verify",
      "workflow.checkpoint",
      "workflow.task.launch.prepare"
    ]) {
      policy.permissions.add(permission);
    }
  }
  if (mode === "message_only") policy.permissions.add("message_flow.send");
  return policy;
}

function workflowPermissionHasCapability(policy, action, capability) {
  if (policy.forbiddenActions.has(action)) return false;
  if (policy.permissions.has("*") || policy.permissions.has("all") || policy.permissions.has("workflow.full") || policy.permissions.has("admin.full")) return true;
  if (policy.allowedActions.has(action)) return true;
  if (policy.permissions.has(capability)) return true;
  if (capability === "read" && policy.permissions.has("read")) return true;
  return false;
}

function isWorkflowTrustedOperator(caller = {}) {
  const agent = String(caller.agentId || "").trim();
  const runtime = String(caller.runtime || "").trim();
  const source = String(caller.sourceSystem || "").trim().toLowerCase();
  return ["flashcat", "local_codex", "codex", "system", "tool", "admin"].includes(agent)
    || ["local_codex", "codex", "system"].includes(runtime)
    || ["codex_mtls", "local_codex", "local_codex_mtls", "human_gate_console"].includes(source);
}

function isLocalCodexRegistryWriter(caller = {}) {
  const agent = String(caller.agentId || "").trim();
  const runtime = String(caller.runtime || "").trim();
  const source = String(caller.sourceSystem || "").trim().toLowerCase();
  return boolOption(process.env[LOCAL_CODEX_REGISTRY_WRITE_ENV], false)
    && LOCAL_CODEX_REGISTRY_WRITER_AGENTS.has(agent)
    && LOCAL_CODEX_REGISTRY_WRITER_RUNTIMES.has(runtime)
    && LOCAL_CODEX_REGISTRY_WRITER_SOURCE_SYSTEMS.has(source);
}

function permissionEvidencePresent(input = {}, names = []) {
  return names.some((name) => {
    const camel = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return input[name] !== undefined && input[name] !== null && input[name] !== ""
      || input[camel] !== undefined && input[camel] !== null && input[camel] !== "";
  });
}

async function workflowPermissionSideEffectUncertain(paths, input = {}) {
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) return 0;
  const columns = await tableColumns(paths.dbFile, "side_effect_ledger");
  if (!hasAllColumns(columns, ["workflow_id", "status"])) return 0;
  const rows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed');`, { json: true });
  return Number(rows[0]?.count || 0);
}

async function workflowPermissionPolicyAssessment(paths, rule, input = {}, capabilityAllowed = true) {
  const requirements = [];
  const warnings = [];
  const addRequirement = (type, reason, evidence = []) => {
    if (requirements.some((item) => item.type === type)) return;
    requirements.push({ type, reason, evidence });
  };
  if (!capabilityAllowed) {
    return { policyOutcome: "deny", actionable: false, requirements, policyWarnings: warnings };
  }
  if (rule.requiresHumanGateEvidence && !permissionEvidencePresent(input, [
    "human_gate_id",
    "humanGateId",
    "human_gate_evidence",
    "humanGateEvidence",
    "risk_decision_id",
    "riskDecisionId",
    "flashcat_original_words",
    "flashcatOriginalWords"
  ])) {
    addRequirement("human_gate", "human gate evidence or Flashcat original words are required before this action", ["humanGateId", "riskDecisionId", "flashcatOriginalWords"]);
  }
  if (rule.requiresCatClawAudit && !permissionEvidencePresent(input, [
    "cat_claw_audit_id",
    "catClawAuditId",
    "cat_claw_audit",
    "catClawAudit",
    "secretary_audit_id",
    "secretaryAuditId"
  ])) {
    addRequirement("cat_claw_audit", "Cat Claw secretary audit evidence is required before this action", ["catClawAuditId", "secretaryAuditId"]);
  }
  if (rule.requiresFreshnessCheck && !permissionEvidencePresent(input, [
    "freshness_checked_at",
    "freshnessCheckedAt",
    "freshness_evidence",
    "freshnessEvidence",
    "data_freshness_at",
    "dataFreshnessAt"
  ])) {
    addRequirement("freshness_check", "freshness evidence is required before trading or data-sensitive action", ["freshnessCheckedAt", "freshnessEvidence", "dataFreshnessAt"]);
  }
  const sideEffectUncertainCount = await workflowPermissionSideEffectUncertain(paths, input);
  if (sideEffectUncertainCount > 0 && ["high", "critical"].includes(String(rule.risk || "").toLowerCase())) {
    addRequirement("side_effect_uncertain", `${sideEffectUncertainCount} uncertain side-effect record(s) must be resolved before high-risk action`, ["side_effect_ledger"]);
  }
  const outcomeOrder = ["side_effect_uncertain", "human_gate", "cat_claw_audit", "freshness_check"];
  const first = outcomeOrder.find((type) => requirements.some((item) => item.type === type));
  const policyOutcome = first === "human_gate" ? "requires_human_gate"
    : first === "cat_claw_audit" ? "requires_cat_claw_audit"
      : first === "freshness_check" ? "requires_freshness_check"
        : first === "side_effect_uncertain" ? "side_effect_uncertain"
          : "allow";
  return {
    policyOutcome,
    actionable: policyOutcome === "allow",
    requirements,
    policyWarnings: warnings,
    sideEffectUncertainCount
  };
}

async function workflowPermissionAgentRow(paths, caller = {}) {
  if (!caller.agentId) return null;
  const runtimeFilter = caller.runtime ? `AND runtime=${sqlValue(caller.runtime)}` : "";
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM runtime_agents
WHERE agent_id=${sqlValue(caller.agentId)}
  ${runtimeFilter}
ORDER BY
  CASE status WHEN 'active' THEN 0 ELSE 1 END,
  CASE runtime WHEN ${sqlValue(caller.runtime || "")} THEN 0 ELSE 1 END,
  updated_at DESC
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function evaluateWorkflowPermission(paths, input = {}) {
  const targetAction = input.targetAction || input.target_action || input.checkAction || input.check_action || input.action || "workflow.status";
  const rule = workflowActionPermissionRule(targetAction, input);
  const caller = workflowPermissionCaller(input);
  const decision = {
    allowed: true,
    action: rule.action,
    originalAction: String(targetAction || ""),
    risk: rule.risk || "medium",
    mutating: Boolean(rule.mutating),
    readOnly: Boolean(rule.readOnly),
    requiredCapability: rule.capability || "workflow.write",
    caller,
    registered: false,
    reason: "allowed",
    policyOutcome: "allow",
    requirements: [],
    policyWarnings: [],
    actionable: true,
    row: null
  };
  if (rule.readOnly) {
    decision.reason = "read_action";
    return decision;
  }
  if (WORKFLOW_REGISTRY_WRITE_ACTIONS.has(rule.action) && !isLocalCodexRegistryWriter(caller)) {
    decision.allowed = false;
    decision.reason = "registry_write_local_codex_only";
    decision.policyOutcome = "deny";
    decision.actionable = false;
    return decision;
  }
  if (!caller.agentId) {
    decision.reason = "local_unscoped_default_allow";
    Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, true));
    return decision;
  }
  if (isWorkflowTrustedOperator(caller)) {
    decision.reason = "trusted_operator";
    Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, true));
    return decision;
  }
  const row = await workflowPermissionAgentRow(paths, caller);
  decision.registered = Boolean(row);
  decision.row = row ? {
    agentKey: row.agent_key,
    runtime: row.runtime,
    agentId: row.agent_id,
    status: row.status,
    canReceiveDispatch: Number(row.can_receive_dispatch ?? 1) !== 0,
    canStartWorkflow: Number(row.can_start_workflow ?? 1) !== 0
  } : null;
  const capabilities = parseJsonValue(row?.capabilities_json, {});
  const policy = addWorkflowDefaultCapabilities(workflowCapabilityPolicy(capabilities, caller.toolMode), caller, row);
  if (policy.forbiddenActions.has(rule.action)) {
    decision.allowed = false;
    decision.reason = "action_forbidden_by_policy";
    Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, false));
    return decision;
  }
  if (!row && !workflowPermissionHasCapability(policy, rule.action, rule.capability) && rule.action !== "message_flow.send") {
    decision.allowed = false;
    decision.reason = "caller_not_registered";
    Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, false));
    return decision;
  }
  if (row && String(row.status || "") !== "active") {
    decision.allowed = false;
    decision.reason = `runtime_agent_not_active:${row.status || "unknown"}`;
    Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, false));
    return decision;
  }
  if (row && rule.action === "workflow.run.upsert" && Number(row.can_start_workflow ?? 1) === 0) {
    decision.allowed = false;
    decision.reason = "runtime_agent_cannot_start_workflow";
    Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, false));
    return decision;
  }
  if (!workflowPermissionHasCapability(policy, rule.action, rule.capability) && rule.action !== "message_flow.send") {
    decision.allowed = false;
    decision.reason = `missing_capability:${rule.capability}`;
    Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, false));
    return decision;
  }
  decision.reason = row ? "capability_allowed" : "low_risk_message_flow_default";
  Object.assign(decision, await workflowPermissionPolicyAssessment(paths, rule, input, true));
  return decision;
}

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
  if (WORKFLOW_POLICY_HARD_GATE_ACTIONS.has(action) && decision.actionable === false) {
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

export async function workflowPermissionCheck(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const decision = await evaluateWorkflowPermission(paths, input);
  return { ...decision, dbFile: paths.dbFile };
}

function assertRuntimeAgentRegistrationAllowed(runtime, agentId, registry = {}) {
  const normalizedRuntime = normalizeRuntime(runtime);
  const normalizedAgentId = normalizeAgentId(agentId);
  if (normalizedAgentId !== "cat_claw") return;
  const normalizedPlatform = normalizeAgentPlatform(registry.platform, normalizedRuntime);
  const executionAdapter = normalizeExecutionAdapter(registry.executionAdapter, normalizedPlatform, normalizedRuntime);
  const workflowIngressAdapter = normalizeWorkflowIngressAdapter(registry.workflowIngressAdapter, normalizedPlatform, normalizedRuntime);
  const imIngressOwner = normalizeImIngressOwner(registry.imIngressOwner, normalizedPlatform, normalizedRuntime);
  const imIngressAdapter = normalizeImIngressAdapter(registry.imIngressAdapter, imIngressOwner, normalizedRuntime);
  const imIdentity = normalizeImIdentity(registry.imIdentity, imIngressOwner, imIngressAdapter, normalizedRuntime);
  const executionIdentity = normalizeExecutionIdentity(registry.executionIdentity, normalizedPlatform, workflowIngressAdapter, normalizedRuntime);
  if (
    normalizedRuntime !== "openclaw" ||
    normalizedPlatform !== "openclaw" ||
    executionAdapter !== "native" ||
    workflowIngressAdapter !== "openclaw_native" ||
    imIngressOwner !== "openclaw_gateway" ||
    imIngressAdapter !== "openclaw_native" ||
    imIdentity !== "openclaw_native" ||
    executionIdentity !== "openclaw_native"
  ) {
    throw new Error("cat_claw is an OpenClaw-only secretary agent; register and dispatch it as openclaw:cat_claw with openclaw_native adapters");
  }
}

function normalizeMeetingRef(value) {
  const meetingId = String(value || "").trim();
  if (!meetingId) throw new Error("meetingId is required");
  return cleanFileSegment(meetingId).slice(0, 120);
}

function normalizeScheduleId(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("scheduleId is required");
  return cleanFileSegment(raw).slice(0, 120);
}

function normalizeScheduleStatus(value, fallback = "active") {
  const status = String(value || fallback).trim().toLowerCase();
  return WORKFLOW_SCHEDULE_STATUSES.has(status) ? status : fallback;
}

function normalizeScheduleKind(value, input = {}) {
  const raw = String(value || "").trim().toLowerCase();
  if (WORKFLOW_SCHEDULE_KINDS.has(raw)) return raw;
  if (input.cronExpr || input.cron_expr || input.cron) return "cron";
  return "interval";
}

function normalizeSchedulePriority(value) {
  const priority = String(value || "normal").trim();
  return WORKFLOW_TASK_PRIORITIES.has(priority) ? priority : "normal";
}

function normalizeSchedulePolicy(value, allowed, fallback) {
  const text = String(value || fallback).trim().toLowerCase();
  return allowed.has(text) ? text : fallback;
}

function normalizeTimezone(value) {
  const timezone = String(value || "Asia/Shanghai").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new Error(`invalid timezone: ${timezone}`);
  }
}

function normalizeIsoTimestamp(value, fieldName = "timestamp") {
  const text = String(value || "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${fieldName}: ${text}`);
  return date.toISOString();
}

const CRON_MONTH_NAMES = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

const CRON_DOW_NAMES = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

function cronTokenNumber(token, aliases = {}) {
  const text = String(token || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(aliases, text)) return aliases[text];
  if (!/^\d+$/.test(text)) throw new Error(`invalid cron token: ${token}`);
  return Number(text);
}

function parseCronField(raw, min, max, aliases = {}, options = {}) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) throw new Error("empty cron field");
  const values = new Set();
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const explicitWildcard = text === "*";
  for (const part of parts) {
    const [rangePartRaw, stepRaw] = part.split("/");
    const rangePart = String(rangePartRaw || "").trim();
    const step = stepRaw === undefined || stepRaw === "" ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`invalid cron step: ${part}`);
    let start;
    let end;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const [left, right] = rangePart.split("-");
      start = cronTokenNumber(left, aliases);
      end = cronTokenNumber(right, aliases);
    } else {
      start = cronTokenNumber(rangePart, aliases);
      end = start;
    }
    if (start > end) throw new Error(`invalid cron range: ${part}`);
    for (let value = start; value <= end; value += step) {
      let normalized = value;
      if (options.sevenIsSunday && normalized === 7) normalized = 0;
      if (normalized < min || normalized > (options.sevenIsSunday ? 6 : max)) {
        throw new Error(`cron value out of range: ${part}`);
      }
      values.add(normalized);
    }
  }
  const fullSize = options.sevenIsSunday ? 7 : max - min + 1;
  return { wildcard: explicitWildcard || values.size === fullSize, values };
}

function parseCronExpression(expression) {
  const fields = String(expression || "").trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron expression must have 5 fields: ${expression}`);
  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dom: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12, CRON_MONTH_NAMES),
    dow: parseCronField(fields[4], 0, 7, CRON_DOW_NAMES, { sevenIsSunday: true })
  };
}

function zonedFormatter(timezone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
}

function zonedDateParts(date, formatter) {
  const parts = {};
  for (const item of formatter.formatToParts(date)) {
    if (item.type !== "literal") parts[item.type] = item.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  };
}

function cronFieldMatches(field, value) {
  return field.values.has(value);
}

function cronMatchesDate(parsed, date, formatter) {
  const parts = zonedDateParts(date, formatter);
  if (!cronFieldMatches(parsed.minute, parts.minute)) return false;
  if (!cronFieldMatches(parsed.hour, parts.hour)) return false;
  if (!cronFieldMatches(parsed.month, parts.month)) return false;
  const domMatches = cronFieldMatches(parsed.dom, parts.day);
  const dowMatches = cronFieldMatches(parsed.dow, parts.dow);
  const dayMatches = !parsed.dom.wildcard && !parsed.dow.wildcard ? (domMatches || dowMatches) : (domMatches && dowMatches);
  return dayMatches;
}

function roundToNextMinute(date) {
  const next = new Date(date.getTime());
  next.setUTCSeconds(0, 0);
  if (next.getTime() <= date.getTime()) next.setUTCMinutes(next.getUTCMinutes() + 1);
  return next;
}

function nextCronRunAt(expression, timezone, fromIso = nowIso()) {
  const parsed = parseCronExpression(expression);
  const formatter = zonedFormatter(timezone);
  let cursor = roundToNextMinute(new Date(fromIso));
  const deadline = cursor.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (cursor.getTime() <= deadline) {
    if (cronMatchesDate(parsed, cursor, formatter)) return cursor.toISOString();
    cursor = new Date(cursor.getTime() + 60_000);
  }
  throw new Error(`no cron run found within 366 days: ${expression}`);
}

function scheduleRunId(scheduleId, scheduledAt) {
  return `scheduled_run.${cleanFileSegment(scheduleId)}.${cleanFileSegment(String(scheduledAt).replace(/[:.]/g, ""))}`;
}

function scheduledMeetingId(scheduleId, scheduledAt) {
  return `scheduled.${cleanFileSegment(scheduleId)}.${cleanFileSegment(String(scheduledAt).replace(/[:.]/g, ""))}`.slice(0, 120);
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

async function sqlite(dbFile, sql, { json = false } = {}) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
    const args = json ? ["-cmd", ".timeout 5000", "-json", dbFile, sql] : ["-cmd", ".timeout 5000", dbFile, sql];
  try {
    const { stdout } = await execFileAsync("sqlite3", args, { maxBuffer: 10 * 1024 * 1024 });
    if (!json) return stdout;
    const text = stdout.trim();
    return text ? JSON.parse(text) : [];
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("sqlite3 CLI is required for trading-agents-workflow v0.6");
    }
    throw error;
  }
}

async function sqliteChangeCount(dbFile, sql) {
  const rows = await sqlite(dbFile, `${String(sql || "").trim().replace(/;+\s*$/, "")};
SELECT changes() AS changes;`, { json: true });
  return Number(rows[0]?.changes || 0);
}

async function writeJsonAtomic(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tmpPath, filePath);
}

function isSqliteConstraintError(error) {
  const text = `${error?.message || ""}\n${error?.stderr || ""}`.toLowerCase();
  return text.includes("constraint failed") || text.includes("unique constraint failed");
}

async function tableColumns(dbFile, tableName) {
  const rows = await sqlite(dbFile, `PRAGMA table_info(${tableName});`, { json: true });
  return new Set(rows.map((row) => row.name));
}

async function ensureColumns(dbFile, tableName, columns) {
  const existing = await tableColumns(dbFile, tableName);
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      await sqlite(dbFile, `ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition};`);
    }
  }
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
  await ensureWorkflowTemplates(paths);
  return paths;
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

export async function workflowInit(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    root: paths.root,
    dbFile: paths.dbFile,
    thesisDir: paths.thesisDir,
    evidenceDir: paths.evidenceDir,
    memosDir: paths.memosDir,
    gatesDir: paths.gatesDir,
    protocolDir: paths.protocolDir,
    intentsDir: paths.intentsDir,
    receiptsDir: paths.receiptsDir,
    bridgeDir: paths.bridgeDir,
    workflowsDir: paths.workflowsDir,
    templatesDir: paths.templatesDir
  };
}

function readinessStatus(findings) {
  if (findings.some((finding) => finding.severity === "critical")) return "critical";
  if (findings.some((finding) => finding.severity === "warning")) return "degraded";
  return "ready";
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

  const hermesBin = resolveHome(input.hermesBin || input.hermes_bin || process.env.HERMES_BIN || "/home/flashcat/hermes-agent/venv/bin/hermes");
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
      cwd: "/home/flashcat/hermes-agent",
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
    checks.acpBackend = { ok: false, backend: backendId, checkedAt: nowIso(), error: error instanceof Error ? error.message : String(error) };
    findings.push({ severity: "warning", key: "acp_backend_unavailable", plane: "runtime", backend: backendId, error: checks.acpBackend.error });
  } finally {
    try {
      await acpBackendCleanup();
    } catch (error) {
      findings.push({ severity: "warning", key: "acp_backend_cleanup_failed", plane: "runtime", backend: backendId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return checks;
}

async function workflowReadinessSnapshot(paths, input = {}) {
  const checkedAt = nowIso();
  const dispatchRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='queued' AND created_at < ${sqlValue(new Date(Date.now() - 15 * 60000).toISOString())} AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(checkedAt)}) THEN 1 ELSE 0 END) AS stale_queued,
  SUM(CASE WHEN status='sent' AND updated_at < ${sqlValue(new Date(Date.now() - 30 * 60000).toISOString())} THEN 1 ELSE 0 END) AS stale_sent
FROM mixed_meeting_dispatches;`, { json: true });
  const runtimeRows = await sqlite(paths.dbFile, `
SELECT
  platform,
  SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
  COUNT(*) AS total
FROM runtime_agents
GROUP BY platform;`, { json: true });
  const outboxRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
FROM telegram_outbox;`, { json: true });
  const humanGateRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS pending,
  SUM(CASE WHEN created_at < ${sqlValue(new Date(Date.now() - 6 * 3600000).toISOString())} THEN 1 ELSE 0 END) AS stale
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending';`, { json: true });
  const dataFreshnessRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS tracked,
  SUM(CASE WHEN updated_at < ${sqlValue(new Date(Date.now() - 3 * 86400000).toISOString())} THEN 1 ELSE 0 END) AS stale
FROM tracking_states;`, { json: true });
  const recentRuntimeRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN rr.status='failed' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN rr.status='retry_scheduled' THEN 1 ELSE 0 END) AS retry_scheduled,
  COUNT(*) AS total
FROM runtime_runs rr
WHERE started_at >= ${sqlValue(new Date(Date.now() - 6 * 3600000).toISOString())};`, { json: true });
  const staleStartedRuntimeAfterMs = Math.max(5 * 60_000, Math.min(24 * 3600_000, Number(input.staleRuntimeRunAfterMs || input.stale_runtime_run_after_ms || 30 * 60_000)));
  const staleStartedRuntimeCutoff = new Date(Date.now() - staleStartedRuntimeAfterMs).toISOString();
  const staleStartedRuntimeRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM runtime_runs rr
WHERE rr.status='started'
  AND rr.started_at IS NOT NULL
  AND rr.started_at != ''
  AND rr.started_at < ${sqlValue(staleStartedRuntimeCutoff)}
  AND NOT EXISTS (
    SELECT 1
    FROM runtime_runs terminal
    WHERE terminal.dispatch_id=rr.dispatch_id
      AND terminal.runtime_run_id != rr.runtime_run_id
      AND terminal.attempt=rr.attempt
      AND terminal.status IN ('acked','failed','retry_scheduled')
      AND terminal.completed_at IS NOT NULL
      AND terminal.completed_at != ''
      AND terminal.completed_at >= rr.started_at
  );`, { json: true });
  const messageFlowIntegrityRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN final_output_present=0 AND status='telegram_sent' THEN 1 ELSE 0 END) AS failed_output_marked_sent,
  SUM(CASE WHEN final_output_present=1 AND status='telegram_sent' AND delivery_receipt_present=0 THEN 1 ELSE 0 END) AS sent_without_receipt,
  COUNT(*) AS total
FROM message_flows;`, { json: true });
  const hermersModes = await loadHermersProfileModes(input);
  const dispatch = dispatchRows[0] || {};
  const outbox = outboxRows[0] || {};
  const humanGate = humanGateRows[0] || {};
  const dataFreshness = dataFreshnessRows[0] || {};
  const recentRuntime = recentRuntimeRows[0] || {};
  const staleStartedRuntime = staleStartedRuntimeRows[0] || {};
  const messageFlowIntegrity = messageFlowIntegrityRows[0] || {};
  const findings = [];
  if (Number(dispatch.stale_sent || 0) > 0) findings.push({ severity: "critical", key: "stale_sent_dispatches", count: Number(dispatch.stale_sent || 0), plane: "orchestration" });
  if (Number(dispatch.stale_queued || 0) > 0) findings.push({ severity: "warning", key: "stale_queued_dispatches", count: Number(dispatch.stale_queued || 0), plane: "orchestration" });
  if (Number(outbox.failed || 0) > 0) findings.push({ severity: "warning", key: "telegram_outbox_failed", count: Number(outbox.failed || 0), plane: "communication" });
  if (Number(humanGate.stale || 0) > 0) findings.push({ severity: "warning", key: "stale_human_gate", count: Number(humanGate.stale || 0), plane: "orchestration" });
  if (Number(dataFreshness.stale || 0) > 0) findings.push({ severity: "warning", key: "stale_tracking_data", count: Number(dataFreshness.stale || 0), plane: "data" });
  if (Number(recentRuntime.failed || 0) > 0) findings.push({ severity: "warning", key: "recent_runtime_failures", count: Number(recentRuntime.failed || 0), plane: "runtime" });
  if (Number(staleStartedRuntime.count || 0) > 0) findings.push({ severity: "warning", key: "stale_started_runtime_runs", count: Number(staleStartedRuntime.count || 0), plane: "runtime" });
  if (Number(messageFlowIntegrity.failed_output_marked_sent || 0) > 0) findings.push({ severity: "critical", key: "message_flow_failed_output_marked_sent", count: Number(messageFlowIntegrity.failed_output_marked_sent || 0), plane: "communication" });
  if (Number(messageFlowIntegrity.sent_without_receipt || 0) > 0) findings.push({ severity: "critical", key: "message_flow_sent_without_receipt", count: Number(messageFlowIntegrity.sent_without_receipt || 0), plane: "communication" });
  if (!hermersModes.ok && !hermersModes.unavailable) findings.push({ severity: "warning", key: "hermers_profile_modes_unreadable", plane: "runtime", path: hermersModes.path, error: hermersModes.error });
  const activeChecks = Boolean(input.activeChecks || input.active_checks);
  const persistSnapshot = boolOption(input.persistReadinessSnapshot ?? input.persist_readiness_snapshot, true);
  const active = activeChecks ? await activeReadinessChecks(paths, input, findings) : null;
  const planes = {
    control: active ? { openclawGateway: active.openclawGateway } : {},
    orchestration: { dispatch },
    runtime: { runtimes: runtimeRows, recentRuntime, staleStartedRuntime, hermersProfiles: active?.hermersProfiles || [], hermersProfileModes: profileModesReadinessPayload(hermersModes), acpBackend: active?.acpBackend || null },
    communication: { telegramOutbox: outbox, messageFlowIntegrity },
    data: { trackingFreshness: dataFreshness },
    humanGate: humanGate
  };
  const status = readinessStatus(findings);
  const snapshotId = persistSnapshot ? safeId("readiness") : "";
  if (persistSnapshot) {
    await sqlite(paths.dbFile, `
INSERT INTO readiness_snapshots(snapshot_id, status, checked_at, planes_json, findings_json, payload_json)
VALUES (${sqlValue(snapshotId)}, ${sqlValue(status)}, ${sqlValue(checkedAt)}, ${sqlValue(JSON.stringify(planes))}, ${sqlValue(JSON.stringify(findings))}, ${sqlValue(JSON.stringify({ activeChecks }))});`);
  }
  return { snapshotId, status, checkedAt, activeChecks, planes, findings };
}

function healthSeverityRank(severity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function healthStatus(blockers = []) {
  if (blockers.some((item) => item.severity === "critical")) return "blocked";
  if (blockers.some((item) => item.severity === "warning")) return "degraded";
  return "ready";
}

function boundedNumber(values, fallback, min, max) {
  const candidates = Array.isArray(values) ? values : [values];
  for (const value of candidates) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(min, Math.min(max, number));
  }
  return Math.max(min, Math.min(max, fallback));
}

function healthRecommendationFor(blocker) {
  const actions = {
    stale_sent_dispatches: ["workflow.dispatch.reconcile", "runtime.bridge.drain"],
    stale_queued_dispatches: ["workflow.control_loop.tick", "runtime.bridge.drain"],
    failed_dispatches: ["workflow.dispatch.reconcile", "workflow.incident.from_dead_letter.preview"],
    failed_control_loop_jobs: ["workflow.control_loop.job.requeue.preview", "workflow.incident.from_dead_letter.preview"],
    expired_control_loop_leases: ["workflow.control_loop.job.requeue.preview", "workflow.control_loop.tick", "workflow.incident.from_dead_letter.preview"],
    message_flow_delivery_missing: ["message_flow.reconcile", "workflow.incident.from_dead_letter.preview"],
    stale_human_gate: ["human_gate.inbox", "human_gate.request"],
    pending_human_gate_without_buttons: ["human_gate.inbox"],
    telegram_outbox_failed: ["telegram.outbox.requeue.preview", "telegram.outbox.delivery.preview"],
    registry_dispatch_disabled: ["workflow.runtime_agents"],
    stale_started_runtime_runs: ["runtime.bridge.drain", "workflow.incident.from_dead_letter.preview"]
  };
  const guidance = {
    stale_sent_dispatches: "Reconcile stale sent dispatches against terminal runtime receipts before retrying.",
    stale_queued_dispatches: "Run the control loop or targeted runtime drain to claim queued dispatches.",
    failed_dispatches: "Inspect failed dispatches and create incident evidence before rerun.",
    failed_control_loop_jobs: "Inspect failed control-loop jobs and decide retry versus incident.",
    expired_control_loop_leases: "Expired leases indicate a worker died or stalled; reclaim through control-loop tick after checking logs.",
    message_flow_delivery_missing: "Runtime finished but governed delivery evidence is missing; reconcile message_flow before resending.",
    stale_human_gate: "Human Gate has been pending too long; refresh inbox/outbox evidence without creating duplicate gates.",
    pending_human_gate_without_buttons: "Human Gate record lacks active buttons; regenerate through the governed Human Gate path.",
    telegram_outbox_failed: "Use requeue preview before redelivery so receipts remain auditable.",
    registry_dispatch_disabled: "Registered runtime agent cannot receive dispatch; fix registry intentionally from local Codex.",
    stale_started_runtime_runs: "Runtime run stayed started past the lease window; inspect runtime adapter and receipt evidence."
  };
  return {
    key: blocker.key,
    summary: guidance[blocker.key] || "Inspect the linked evidence and choose a governed recovery action.",
    actions: actions[blocker.key] || ["workflow.readiness"]
  };
}

async function workflowHealthSnapshot(paths, input = {}) {
  const checkedAt = nowIso();
  const staleDispatchAfterMs = boundedNumber([input.staleDispatchAfterMs, input.stale_dispatch_after_ms], 30 * 60_000, 5 * 60_000, 24 * 3600_000);
  const staleDispatchCutoff = new Date(Date.now() - staleDispatchAfterMs).toISOString();
  const staleHumanGateAfterMs = boundedNumber([input.staleHumanGateAfterMs, input.stale_human_gate_after_ms], 6 * 3600_000, 30 * 60_000, 30 * 86400_000);
  const staleHumanGateCutoff = new Date(Date.now() - staleHumanGateAfterMs).toISOString();
  const messageFlowStuckAfterMs = boundedNumber([input.messageFlowStuckAfterMs, input.message_flow_stuck_after_ms], 5 * 60_000, 60_000, 24 * 3600_000);
  const messageFlowStuckCutoff = new Date(Date.now() - messageFlowStuckAfterMs).toISOString();
  const readiness = await workflowReadinessSnapshot(paths, {
    ...input,
    activeChecks: boolOption(input.activeChecks ?? input.active_checks, false),
    persistReadinessSnapshot: false
  });
  const workflowRows = await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_runs
GROUP BY status
ORDER BY status;`, { json: true });
  const dispatchRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='sent' AND updated_at < ${sqlValue(staleDispatchCutoff)} THEN 1 ELSE 0 END) AS stale_sent,
  SUM(CASE WHEN status='queued' AND created_at < ${sqlValue(staleDispatchCutoff)} AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(checkedAt)}) THEN 1 ELSE 0 END) AS stale_queued
FROM mixed_meeting_dispatches;`, { json: true });
  const controlLoopRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status IN ('queued','retry_scheduled') THEN 1 ELSE 0 END) AS runnable,
  SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
  SUM(CASE WHEN status IN ('failed','dead_letter') THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='running' AND lease_until IS NOT NULL AND lease_until != '' AND lease_until <= ${sqlValue(checkedAt)} THEN 1 ELSE 0 END) AS expired_leases
FROM control_loop_jobs;`, { json: true });
  const messageFlowRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN delivery_receipt_present=0 AND return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])}) AND target_runtime NOT IN ('local_codex','codex') AND (COALESCE(runtime_completed_at,'') != '' OR COALESCE(runtime_failed_at,'') != '') THEN 1 ELSE 0 END) AS missing_delivery,
  SUM(CASE WHEN status IN ('runtime_failed','telegram_failed') THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN final_output_present=1 AND delivery_receipt_present=0 AND return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])}) AND target_runtime NOT IN ('local_codex','codex') AND COALESCE(runtime_completed_at,'') != '' AND runtime_completed_at <= ${sqlValue(messageFlowStuckCutoff)} THEN 1 ELSE 0 END) AS stuck_after_runtime
FROM message_flows;`, { json: true });
  const humanGateRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS pending,
  SUM(CASE WHEN created_at <= ${sqlValue(staleHumanGateCutoff)} THEN 1 ELSE 0 END) AS stale,
  SUM(CASE WHEN NOT EXISTS (
    SELECT 1 FROM human_gate_buttons b
    WHERE b.human_gate_id=protocol_objects.object_id
      AND b.status='active'
  ) THEN 1 ELSE 0 END) AS without_buttons
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending';`, { json: true });
  const outboxRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='delivering' THEN 1 ELSE 0 END) AS delivering,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
FROM telegram_outbox;`, { json: true });
  const registryRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
  SUM(CASE WHEN status='active' AND can_receive_dispatch=0 THEN 1 ELSE 0 END) AS dispatch_disabled
FROM runtime_agents;`, { json: true });
  const runtimeRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN rr.status='failed' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN rr.status='started'
    AND rr.started_at IS NOT NULL
    AND rr.started_at != ''
    AND rr.started_at < ${sqlValue(new Date(Date.now() - boundedNumber([input.staleRuntimeRunAfterMs, input.stale_runtime_run_after_ms], 30 * 60_000, 5 * 60_000, 24 * 3600_000)).toISOString())}
    AND NOT EXISTS (
      SELECT 1
      FROM runtime_runs terminal
      WHERE terminal.dispatch_id=rr.dispatch_id
        AND terminal.runtime_run_id != rr.runtime_run_id
        AND terminal.attempt=rr.attempt
        AND terminal.status IN ('acked','failed','retry_scheduled')
        AND terminal.completed_at IS NOT NULL
        AND terminal.completed_at != ''
        AND terminal.completed_at >= rr.started_at
    )
    THEN 1 ELSE 0 END) AS stale_started
FROM runtime_runs rr;`, { json: true });

  const dispatch = dispatchRows[0] || {};
  const controlLoop = controlLoopRows[0] || {};
  const messageFlow = messageFlowRows[0] || {};
  const humanGate = humanGateRows[0] || {};
  const outbox = outboxRows[0] || {};
  const registry = registryRows[0] || {};
  const runtime = runtimeRows[0] || {};
  const blockers = [];
  const addBlocker = (severity, key, count, plane, evidence = {}) => {
    const numeric = Number(count || 0);
    if (numeric <= 0) return;
    blockers.push({ severity, key, count: numeric, plane, evidence });
  };
  for (const finding of readiness.findings || []) {
    addBlocker(finding.severity || "warning", finding.key || "readiness_finding", finding.count || 1, finding.plane || "readiness", finding);
  }
  addBlocker("critical", "failed_control_loop_jobs", controlLoop.failed, "control_loop");
  addBlocker("critical", "expired_control_loop_leases", controlLoop.expired_leases, "control_loop");
  addBlocker("critical", "failed_dispatches", dispatch.failed, "dispatch");
  addBlocker("critical", "stale_sent_dispatches", dispatch.stale_sent, "dispatch");
  addBlocker("warning", "stale_queued_dispatches", dispatch.stale_queued, "dispatch");
  addBlocker("critical", "message_flow_delivery_missing", Number(messageFlow.missing_delivery || 0) + Number(messageFlow.stuck_after_runtime || 0), "message_flow");
  addBlocker("warning", "pending_human_gate_without_buttons", humanGate.without_buttons, "human_gate");
  addBlocker("warning", "telegram_outbox_failed", outbox.failed, "communication");
  addBlocker("warning", "registry_dispatch_disabled", registry.dispatch_disabled, "registry");
  addBlocker("warning", "stale_started_runtime_runs", runtime.stale_started, "runtime");
  const uniqueBlockers = [];
  const seen = new Set();
  for (const blocker of blockers.sort((a, b) => healthSeverityRank(a.severity) - healthSeverityRank(b.severity) || b.count - a.count || a.key.localeCompare(b.key))) {
    const dedupe = `${blocker.key}:${blocker.plane}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    uniqueBlockers.push(blocker);
  }
  const status = healthStatus(uniqueBlockers);
  const topBlockers = uniqueBlockers.slice(0, boundedNumber([input.limit, input.blockerLimit, input.blocker_limit], 8, 1, 20));
  const recommendations = topBlockers.map(healthRecommendationFor);
  return {
    schemaVersion: "workflow_health.v1",
    status,
    checkedAt,
    readiness: {
      snapshotId: readiness.snapshotId,
      status: readiness.status,
      findings: readiness.findings || []
    },
    lanes: {
      workflows: Object.fromEntries(workflowRows.map((row) => [row.status || "unknown", Number(row.count || 0)])),
      dispatch: {
        queued: Number(dispatch.queued || 0),
        sent: Number(dispatch.sent || 0),
        failed: Number(dispatch.failed || 0),
        staleQueued: Number(dispatch.stale_queued || 0),
        staleSent: Number(dispatch.stale_sent || 0)
      },
      controlLoop: {
        runnable: Number(controlLoop.runnable || 0),
        running: Number(controlLoop.running || 0),
        failed: Number(controlLoop.failed || 0),
        expiredLeases: Number(controlLoop.expired_leases || 0)
      },
      runtime: {
        failedRuns: Number(runtime.failed || 0),
        staleStartedRuns: Number(runtime.stale_started || 0)
      },
      messageFlow: {
        missingDelivery: Number(messageFlow.missing_delivery || 0),
        stuckAfterRuntime: Number(messageFlow.stuck_after_runtime || 0),
        failed: Number(messageFlow.failed || 0)
      },
      humanGate: {
        pending: Number(humanGate.pending || 0),
        stale: Number(humanGate.stale || 0),
        withoutButtons: Number(humanGate.without_buttons || 0)
      },
      communication: {
        telegramQueued: Number(outbox.queued || 0),
        telegramDelivering: Number(outbox.delivering || 0),
        telegramFailed: Number(outbox.failed || 0)
      },
      registry: {
        total: Number(registry.total || 0),
        active: Number(registry.active || 0),
        dispatchDisabled: Number(registry.dispatch_disabled || 0)
      }
    },
    topBlockers,
    recommendations,
    nextActions: [...new Set(recommendations.flatMap((item) => item.actions))],
    dbFile: paths.dbFile
  };
}

export async function workflowStatus(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const counts = await sqlite(paths.dbFile, `
SELECT 'instruments' AS name, COUNT(*) AS count FROM instruments
UNION ALL SELECT 'radar_scores', COUNT(*) FROM radar_scores
UNION ALL SELECT 'thesis', COUNT(*) FROM thesis_index
UNION ALL SELECT 'evidence', COUNT(*) FROM evidence_items
UNION ALL SELECT 'memos', COUNT(*) FROM research_memos
UNION ALL SELECT 'gates', COUNT(*) FROM review_gates
UNION ALL SELECT 'workflows', COUNT(*) FROM workflow_runs
UNION ALL SELECT 'workflow_phases', COUNT(*) FROM workflow_phases
UNION ALL SELECT 'workflow_tasks', COUNT(*) FROM workflow_tasks
UNION ALL SELECT 'workflow_task_dependencies', COUNT(*) FROM workflow_task_dependencies
UNION ALL SELECT 'workflow_checkpoints', COUNT(*) FROM workflow_checkpoints
UNION ALL SELECT 'workflow_events', COUNT(*) FROM workflow_events
UNION ALL SELECT 'workflow_verification_results', COUNT(*) FROM workflow_verification_results
UNION ALL SELECT 'workflow_session_packs', COUNT(*) FROM workflow_session_packs
UNION ALL SELECT 'workflow_session_runs', COUNT(*) FROM workflow_session_runs
UNION ALL SELECT 'workflow_agent_runs', COUNT(*) FROM workflow_agent_runs
UNION ALL SELECT 'workflow_operations', COUNT(*) FROM workflow_operations
UNION ALL SELECT 'protocol_objects', COUNT(*) FROM protocol_objects
UNION ALL SELECT 'trade_intents', COUNT(*) FROM executable_trade_intents
UNION ALL SELECT 'trading_core_receipts', COUNT(*) FROM trading_core_receipts
UNION ALL SELECT 'runtime_runs', COUNT(*) FROM runtime_runs
UNION ALL SELECT 'side_effects', COUNT(*) FROM side_effect_ledger
UNION ALL SELECT 'incidents', COUNT(*) FROM incident_states
UNION ALL SELECT 'readiness_snapshots', COUNT(*) FROM readiness_snapshots
UNION ALL SELECT 'runtime_agents', COUNT(*) FROM runtime_agents
UNION ALL SELECT 'mixed_meeting_participants', COUNT(*) FROM mixed_meeting_participants
UNION ALL SELECT 'mixed_meeting_messages', COUNT(*) FROM mixed_meeting_messages
UNION ALL SELECT 'mixed_meeting_dispatches', COUNT(*) FROM mixed_meeting_dispatches
UNION ALL SELECT 'telegram_outbox', COUNT(*) FROM telegram_outbox
UNION ALL SELECT 'control_loop_jobs', COUNT(*) FROM control_loop_jobs;`, { json: true });
  const readiness = await workflowReadinessSnapshot(paths, input);
  const result = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    root: paths.root,
    dbFile: paths.dbFile,
    readiness,
    counts: Object.fromEntries(counts.map((row) => [row.name, row.count]))
  };
  if (input.symbol || input.instrumentId || input.instrument_id) {
    const instrument = await readInstrument(paths, input);
    const state = instrument ? (await sqlite(paths.dbFile, `SELECT * FROM tracking_states WHERE instrument_id=${sqlValue(instrument.instrument_id)};`, { json: true }))[0] || null : null;
    return { ...result, instrument, state };
  }
  return result;
}

export async function workflowRunUpsert(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const createdAt = nowIso();
  const workflowId = String(input.workflowId || input.workflow_id || input.initiativeId || input.initiative_id || safeId("workflow")).trim();
  const existingRows = await sqlite(paths.dbFile, `SELECT status FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
  const previousStatus = existingRows[0]?.status || "";
  const statusRaw = String(input.status || "active").trim();
  const status = WORKFLOW_RUN_STATUSES.has(statusRaw) ? statusRaw : "active";
  const workflowType = String(input.workflowType || input.workflow_type || input.type || "initiative").trim();
  const payload = {
    ...parseJsonValue(input.payload, input.payload || {}),
    flashLane: boolOption(input.flashLane ?? input.flash_lane, false),
    tradingExecution: boolOption(input.tradingExecution ?? input.trading_execution, false)
  };
  await sqlite(paths.dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, instrument_id, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES (${sqlValue(workflowId)}, ${sqlValue(workflowType)}, ${sqlValue(status)}, ${sqlValue(input.instrumentId || input.instrument_id || null)}, ${sqlValue(input.ownerAgent || input.owner_agent || "main")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.objective || input.goal || "")}, ${sqlValue(input.acceptanceCriteria || input.acceptance_criteria || "")}, ${sqlValue(input.stopCondition || input.stop_condition || "")}, ${sqlValue(input.phase || input.currentPhase || input.current_phase || "")}, ${sqlValue(input.currentDecision || input.current_decision || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(workflow_id) DO UPDATE SET
  workflow_type=excluded.workflow_type,
  status=excluded.status,
  instrument_id=COALESCE(excluded.instrument_id, workflow_runs.instrument_id),
  owner_agent=excluded.owner_agent,
  summary=CASE WHEN excluded.summary != '' THEN excluded.summary ELSE workflow_runs.summary END,
  objective=CASE WHEN excluded.objective != '' THEN excluded.objective ELSE workflow_runs.objective END,
  acceptance_criteria=CASE WHEN excluded.acceptance_criteria != '' THEN excluded.acceptance_criteria ELSE workflow_runs.acceptance_criteria END,
  stop_condition=CASE WHEN excluded.stop_condition != '' THEN excluded.stop_condition ELSE workflow_runs.stop_condition END,
  current_phase=CASE WHEN excluded.current_phase != '' THEN excluded.current_phase ELSE workflow_runs.current_phase END,
  current_decision=CASE WHEN excluded.current_decision != '' THEN excluded.current_decision ELSE workflow_runs.current_decision END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  await appendWorkflowEvent(paths, {
    eventType: previousStatus ? "workflow.updated" : "workflow.created",
    workflowId,
    actor: input.createdBy || input.created_by || input.from || input.ownerAgent || input.owner_agent || "main",
    previousState: previousStatus,
    nextState: status,
    sourceRuntime: "workflow",
    sourceAgent: input.ownerAgent || input.owner_agent || "main",
    payload: { workflowType, summary: input.summary || input.text || "", phase: input.phase || input.currentPhase || input.current_phase || "" },
    createdAt
  });
  return { workflowId, status, workflowType, dbFile: paths.dbFile };
}

export async function workflowTaskCreate(rootDir, input = {}) {
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

function uniqueAgentIds(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    const [, agentPart] = text.includes(":") ? text.split(":", 2) : ["", text];
    const agentId = normalizeAgentId(agentPart || text);
    if (seen.has(agentId)) continue;
    seen.add(agentId);
    result.push(agentId);
  }
  return result;
}

function taskDraftInputAgents(input = {}) {
  return uniqueAgentIds([
    ...toList(input.participants || input.participant),
    ...toList(input.agents || input.agentIds || input.agent_ids),
    ...toList(input.toAgents || input.to_agents || input.targets || input.to),
    ...toList(input.workers || input.worker),
    input.ownerAgent || input.owner_agent || input.owner,
    input.agentId || input.agent_id,
    input.consumerAgent || input.consumer_agent || input.consumer
  ]);
}

function stockLongTermTrackingDraftAppendix(input = {}) {
  const template = String(input.template || input.taskTemplate || input.task_template || "").trim().toLowerCase();
  const enabled = template === "stock_longterm_tracking"
    || template === "stock-longterm-tracking"
    || boolOption(input.stockLongTermTracking ?? input.stock_longterm_tracking, false);
  if (!enabled) return null;
  return {
    template: "stock_longterm_tracking",
    scope: [
      "Clarify cron ownership and failure response for long-term stock tracking.",
      "Clarify market_intelligence.db schema/data ownership and freshness evidence.",
      "Clarify data supplement boundaries across cat_eyes, cat_ears, cat_nose, and cat_heart consumption needs."
    ],
    proposedResponsibilityMap: [
      {
        agentId: "cat_eyes",
        focus: "price, technical, filing, chart, and visual inspection evidence",
        expectedOutput: "owned jobs, source boundaries, freshness checks, and supplementation gaps"
      },
      {
        agentId: "cat_ears",
        focus: "news, public narrative, catalyst, social and macro signal intake",
        expectedOutput: "owned jobs, source boundaries, freshness checks, and supplementation gaps"
      },
      {
        agentId: "cat_nose",
        focus: "data quality smell, anomaly detection, cross-source consistency, and stale-data alarms",
        expectedOutput: "owned jobs, source boundaries, freshness checks, and supplementation gaps"
      },
      {
        agentId: "cat_heart",
        focus: "consumer requirements for long-term tracking outputs and decision-readiness signals",
        expectedOutput: "consumer contract, minimum data set, freshness SLA, and acceptance criteria"
      }
    ],
    requiredArtifacts: [
      "current cron/job inventory with owner and state",
      "market_intelligence.db table/data-source ownership map",
      "data supplement backlog with owner and acceptance criteria",
      "executable division-of-responsibility plan with rollback/stop conditions"
    ]
  };
}

async function resolveDraftParticipant(paths, agentId) {
  try {
    await fs.access(paths.dbFile);
  } catch {
    return {
      agentId,
      registered: false,
      runtime: "",
      platform: "",
      workflowIngressAdapter: "",
      endpointRef: "",
      canReceiveDispatch: false,
      error: "tracking.db not found; registry resolution skipped for pure preview"
    };
  }
  try {
    const resolved = await resolveRegisteredDispatchTarget(paths, { agentId });
    return {
      agentId,
      registered: true,
      runtime: resolved.target.runtime || "",
      platform: resolved.registry.platform || "",
      workflowIngressAdapter: resolved.registry.workflowIngressAdapter || "",
      endpointRef: resolved.registry.endpointRef || "",
      canReceiveDispatch: resolved.registry.canReceiveDispatch
    };
  } catch (error) {
    return {
      agentId,
      registered: false,
      runtime: "",
      platform: "",
      workflowIngressAdapter: "",
      endpointRef: "",
      canReceiveDispatch: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function draftGate(name, ok, message, severity = "error") {
  return { name, status: ok ? "pass" : severity, message };
}

function taskDraftParticipantRole(agentId, governance = {}) {
  if (agentId === governance.chairAgent) return "chair";
  if (agentId === governance.secretaryAgent) return "secretary_auditor";
  if (agentId === governance.consumerAgent) return "consumer";
  return "worker";
}

function taskDraftPhaseDependencies(phases = []) {
  const phaseIds = new Set(phases.map((phase) => phase.id).filter(Boolean));
  const dependencies = new Map();
  for (const phase of phases) {
    const dependsOn = [];
    if (phase.id === "responsibility_self_check" || phase.id === "consumer_requirements") {
      dependsOn.push("scope");
    } else if (phase.id === "cross_discussion") {
      dependsOn.push("responsibility_self_check", "consumer_requirements");
      if (!phaseIds.has("responsibility_self_check") && !phaseIds.has("consumer_requirements")) dependsOn.push("scope");
    } else if (phase.id === "plan_synthesis") {
      dependsOn.push("cross_discussion");
      if (!phaseIds.has("cross_discussion")) dependsOn.push("responsibility_self_check");
    } else if (phase.id === "secretary_audit") {
      dependsOn.push("plan_synthesis");
    } else if (phase.id === "human_gate_package") {
      dependsOn.push("secretary_audit");
    }
    dependencies.set(phase.id, [...new Set(dependsOn.filter((id) => phaseIds.has(id)))]);
  }
  return dependencies;
}

function workflowPlanNodeType(phaseId) {
  if (phaseId === "secretary_audit") return "secretary_audit";
  if (phaseId === "human_gate_package") return "human_gate";
  if (phaseId === "plan_synthesis") return "reducer";
  return "worker";
}

function planSpecV2ContractOk(plan = {}) {
  const nodeFields = [
    "nodeId", "phaseId", "nodeType", "ownerAgent", "runtime", "agentId", "dependsOn",
    "inputRefs", "prompt", "allowedCapabilities", "expectedArtifacts", "receiptRequired",
    "humanGateRequired", "timeoutSeconds", "retryPolicy", "maxAttempts",
    "acceptanceCriteria", "policyGate", "sideEffectPolicy", "verifier",
    "failureRoute", "idempotencyKey"
  ];
  const evidenceRefs = ["artifactRefs", "receiptRefs", "messageFlowRefs", "outboxRefs", "sideEffectRefs", "incidentRefs", "readinessRefs", "checkpointRefs"];
  const resumeFields = ["checkpointBeforeHumanGate", "checkpointBeforeSideEffect", "checkpointAfterRuntimeReceipt", "reuseCompletedNodes", "invalidateOn", "resumeFrom", "sideEffectUncertainHandling"];
  const required = Boolean(
    plan?.schemaVersion === "workflow_plan_spec.v2"
    && plan.meta?.planId
    && plan.meta?.workflowId
    && plan.meta?.traceId
    && plan.meta?.idempotencyKey
    && plan.acceptance?.workflowSuccess
    && plan.verification?.mode
    && plan.verification?.verifierAgent
    && plan.verification?.rubric
    && plan.humanGatePolicy?.language
    && plan.permissionPolicy?.defaultOutcome
    && plan.artifacts
    && plan.audit
  );
  return required
    && plan.nodes.every((node) => nodeFields.every((field) => Object.prototype.hasOwnProperty.call(node, field)))
    && evidenceRefs.every((field) => Array.isArray(plan.evidencePolicy?.[field]))
    && resumeFields.every((field) => Object.prototype.hasOwnProperty.call(plan.resumePolicy || {}, field))
    && Array.isArray(plan.failureRoutes)
    && plan.failureRoutes.every((route) => route.routeId && route.match && route.action && route.ownerAgent);
}

function buildWorkflowPlanSpecV2(spec = {}, input = {}) {
  const governance = spec.governance || {};
  const phases = Array.isArray(spec.phases) ? spec.phases : [];
  const participantRows = Array.isArray(spec.participants) ? spec.participants : [];
  const participantById = new Map(participantRows.map((participant) => [participant.agentId, participant]));
  const phaseDependencies = taskDraftPhaseDependencies(phases);
  const planSeed = [spec.workflowId, spec.traceId, spec.idempotencyKey, spec.objective].join("\n");
  const sourceSystem = String(input.sourceSystem || input.source_system || "workflow.task.draft").trim();
  const timezone = String(input.timezone || input.time_zone || "Asia/Shanghai").trim();
  const acceptanceCriteria = toList(input.acceptanceCriteria || input.acceptance_criteria || input.acceptance)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const stopConditions = toList(input.stopCondition || input.stop_condition || input.stop)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const humanGatePolicy = {
    ...(governance.humanGatePolicy || {
      language: "zh-CN",
      optionsMinimum: 3,
      requiredControls: ["pause_workflow", "terminate_workflow"]
    }),
    required: Boolean(governance.humanGateRequired),
    submitterAgent: governance.secretaryAgent || "cat_claw",
    reviewerAgent: governance.chairAgent || "main",
    requiresOriginalWords: Boolean(governance.humanGateRequired),
    buttonStylePolicy: {
      approveOptions: "success",
      pauseWorkflow: "primary",
      terminateWorkflow: "danger",
      rejectOrReturn: "danger"
    },
    deliveryPolicy: "button_first_token_bound_review_form",
    resumeTarget: governance.chairAgent || "main",
    rollbackBoundary: "checkpoint_before_human_gate"
  };
  const phaseGraph = phases.map((phase, index) => {
    const ownerAgents = uniqueAgentIds([phase.ownerAgent, ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : [])]);
    return {
      phaseId: phase.id || `phase_${index + 1}`,
      ordinal: index + 1,
      status: "planned",
      ownerAgents,
      dependsOn: phaseDependencies.get(phase.id) || [],
      objective: phase.objective || "",
      acceptanceCriteria: [
        phase.objective || "Phase objective is completed.",
        "Required receipt and evidence references are returned before the next phase advances."
      ].filter(Boolean)
    };
  });
  const phaseNodeIds = new Map();
  const failureRoutes = [
    {
      routeId: "missing_receipt",
      match: { status: "needs_evidence" },
      action: "return_to_evidence_collection",
      ownerAgent: governance.chairAgent || "main",
      humanGateRequired: false,
      incidentRequired: false
    },
    {
      routeId: "human_gate_rejected_or_incomplete",
      match: { status: "human_gate_rejected" },
      action: "return_to_evidence_collection",
      ownerAgent: governance.chairAgent || "main",
      humanGateRequired: false,
      incidentRequired: false
    },
    {
      routeId: "human_gate_paused",
      match: { status: "human_gate_paused" },
      action: "pause_workflow",
      ownerAgent: governance.secretaryAgent || "cat_claw",
      humanGateRequired: true,
      incidentRequired: false
    },
    {
      routeId: "human_gate_terminated",
      match: { status: "human_gate_terminated" },
      action: "terminate_workflow",
      ownerAgent: governance.secretaryAgent || "cat_claw",
      humanGateRequired: true,
      incidentRequired: false
    },
    {
      routeId: "side_effect_uncertain",
      match: { status: "side_effect_uncertain" },
      action: "mark_side_effect_uncertain",
      ownerAgent: governance.chairAgent || "main",
      humanGateRequired: true,
      incidentRequired: true
    }
  ];
  const nodes = [];
  for (const phase of phaseGraph) {
    const nodeIds = [];
    for (const ownerAgent of phase.ownerAgents) {
      const participant = participantById.get(ownerAgent) || {};
      const nodeId = `node.${cleanFileSegment(phase.phaseId)}.${cleanFileSegment(ownerAgent)}`;
      nodeIds.push(nodeId);
      nodes.push({
        nodeId,
        phaseId: phase.phaseId,
        nodeType: workflowPlanNodeType(phase.phaseId),
        ownerAgent,
        runtime: participant.runtime || "",
        agentId: ownerAgent,
        taskType: phase.phaseId === "human_gate_package" ? "human_gate_package" : "workflow_phase",
        status: "planned",
        priority: spec.priority || "normal",
        dependsOn: [],
        inputRefs: [],
        prompt: [
          `Workflow: ${spec.workflowId}`,
          `Phase: ${phase.phaseId}`,
          `Objective: ${phase.objective || spec.objective || ""}`,
          "Return evidence, artifact refs, open risks, and readiness for the next phase."
        ].join("\n"),
        allowedCapabilities: [],
        expectedArtifacts: [`${phase.phaseId} evidence and receipt for ${spec.workflowId}`],
        acceptanceCriteria: phase.acceptanceCriteria,
        receiptRequired: true,
        humanGateRequired: phase.phaseId === "human_gate_package",
        timeoutSeconds: 3600,
        maxAttempts: 1,
        retryPolicy: {
          maxAttempts: 1,
          backoff: "manual_after_receipt_review"
        },
        policyGate: {
          outcome: phase.phaseId === "human_gate_package" ? "requires_human_gate" : "requires_cat_claw_audit",
          riskTier: "unknown"
        },
        toolPolicy: {
          requiredCapabilities: [],
          allowedTools: [],
          restrictedTools: []
        },
        sideEffectPolicy: {
          allowed: false,
          requiresLedger: true,
          idempotencyKeyRequired: true
        },
        verifier: {
          agentId: phase.phaseId === "secretary_audit" ? governance.secretaryAgent || "cat_claw" : governance.chairAgent || "main",
          mode: "reviewer_agent"
        },
        failureRoute: phase.phaseId === "human_gate_package" ? "human_gate_rejected_or_incomplete" : "missing_receipt",
        idempotencyKey: `workflow_plan_node:${spec.workflowId}:${phase.phaseId}:${ownerAgent}`,
        protected: ["main", "cat_claw", "cat_heart"].includes(ownerAgent)
      });
    }
    phaseNodeIds.set(phase.phaseId, nodeIds);
  }
  for (const node of nodes) {
    const phase = phaseGraph.find((item) => item.phaseId === node.phaseId);
    node.dependsOn = [...new Set((phase?.dependsOn || []).flatMap((phaseId) => phaseNodeIds.get(phaseId) || []))];
  }
  return {
    schemaVersion: "workflow_plan_spec.v2",
    meta: {
      planId: `plan.${textHash(planSeed).slice(0, 16)}`,
      planRevision: 1,
      workflowId: spec.workflowId,
      traceId: spec.traceId,
      idempotencyKey: spec.idempotencyKey,
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
      timezone,
      sourceSystem,
      sourceChannel: input.sourceChannel || input.source_channel || sourceSystem,
      sourceMessageId: input.sourceMessageId || input.source_message_id || "",
      registrySnapshotRef: "runtime_agents@draft_time"
    },
    objective: {
      subject: spec.subject || "",
      goal: spec.objective || "",
      taskType: spec.taskType || "",
      priority: spec.priority || "normal",
      acceptanceCriteria,
      stopConditions
    },
    participants: participantRows.map((participant) => ({
      agentId: participant.agentId,
      role: taskDraftParticipantRole(participant.agentId, governance),
      runtime: participant.runtime || "",
      platform: participant.platform || "",
      endpointRef: participant.endpointRef || "",
      registered: Boolean(participant.registered),
      canReceiveDispatch: Boolean(participant.canReceiveDispatch),
      capabilities: []
    })),
    phaseGraph,
    nodes,
    acceptance: {
      workflowSuccess: acceptanceCriteria.length ? acceptanceCriteria : [
        "All planned nodes return receipt and evidence references.",
        "Cat Brain verifies semantic readiness before Cat Claw submits any Human Gate package."
      ],
      phaseSuccessDefaults: [
        "All phase nodes are terminal successful or explicitly waived by the reviewer.",
        "Required evidence is linked before dependent phases advance."
      ],
      requiredReceipts: nodes.filter((node) => node.receiptRequired).map((node) => node.nodeId),
      requiredArtifacts: nodes.flatMap((node) => node.expectedArtifacts || []),
      requiredHumanGates: nodes.filter((node) => node.humanGateRequired).map((node) => node.nodeId),
      blockedIf: ["missing_required_receipt", "missing_required_artifact", "human_gate_pending_or_rejected"],
      completeOnlyIf: ["required_receipts_present", "required_artifacts_present", "reviewer_verification_passed"]
    },
    verification: {
      mode: governance.humanGateRequired ? "human_gate" : "reviewer_agent",
      verifierAgent: governance.chairAgent || "main",
      refuterAgent: "",
      rubric: [
        "Task decomposition matches stated objective and agent responsibilities.",
        "Evidence and receipts are sufficient for each completed node.",
        "Human Gate packages preserve A/B/C options, Chinese body, pause, terminate, and rollback boundaries."
      ],
      minimumEvidence: ["runtime_receipt", "artifact_ref", "cat_claw_audit_before_human_gate"],
      failureHandling: "route_by_failureRoutes",
      required: true,
      verifierAgents: [governance.chairAgent || "main", governance.secretaryAgent || "cat_claw"],
      receiptRequired: true,
      evidenceRequired: true,
      catClawAuditBeforeHumanGate: Boolean(governance.humanGateRequired)
    },
    humanGatePolicy,
    permissionPolicy: {
      defaultOutcome: "allow",
      gates: [],
      finalApprover: "flashcat",
      catBrainReviewRequired: true,
      catClawSubmitterRequired: Boolean(governance.humanGateRequired)
    },
    evidencePolicy: {
      artifactRefs: [],
      receiptRefs: [],
      messageFlowRefs: [],
      outboxRefs: [],
      sideEffectRefs: [],
      incidentRefs: [],
      readinessRefs: [],
      checkpointRefs: [],
      artifactRefsRequired: true,
      receiptRefsRequired: true,
      rawLogsInPlan: false,
      evidencePackBeforeHumanGate: Boolean(governance.humanGateRequired)
    },
    resumePolicy: {
      stableWorkflowId: true,
      stableTraceId: true,
      checkpointBeforeHumanGate: true,
      idempotencyKeyRequired: true,
      checkpointBeforeSideEffect: true,
      checkpointAfterRuntimeReceipt: true,
      reuseCompletedNodes: true,
      invalidateOn: ["participant_change", "acceptance_change", "permission_policy_change"],
      resumeFrom: "latest_checkpoint_or_terminal_receipt",
      sideEffectUncertainHandling: "pause_and_request_human_review",
      ...(spec.resumePolicy || {})
    },
    failureRoutes,
    artifacts: {
      planArtifactRef: "",
      sourceRefs: [],
      generatedRefs: []
    },
    audit: {
      generatedBy: "workflow.task.draft",
      status: "draft",
      reviewerAgent: governance.chairAgent || "main",
      secretaryAuditAgent: governance.secretaryAgent || "cat_claw",
      qualityGates: []
    },
    compatibility: {
      taskLaunchPackageVersion: "workflow_task_launch_package.v1",
      materializesTo: ["workflow_runs", "workflow_tasks", "workflow_task_dependencies"],
      phaseSource: "workflow_tasks.phase"
    }
  };
}

export async function workflowTaskDraft(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const createdAt = nowIso();
  const workflowId = String(input.workflowId || input.workflow_id || input.meetingId || input.meeting_id || safeId("workflow")).trim();
  const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
  const subject = String(input.subject || input.summary || input.title || "").trim();
  const objective = String(input.objective || input.goal || input.prompt || input.body || input.text || subject).trim();
  const taskType = String(input.taskType || input.task_type || input.type || "meeting_task").trim();
  const defaultGovernance = boolOption(input.defaultGovernance ?? input.default_governance, true)
    && !boolOption(input.noDefaultGovernance ?? input.no_default_governance, false);
  const chairAgent = normalizeAgentId(input.chairAgent || input.chair_agent || input.chair || "main");
  const secretaryAgent = normalizeAgentId(input.secretaryAgent || input.secretary_agent || input.secretary || "cat_claw");
  const consumerAgent = input.consumerAgent || input.consumer_agent || input.consumer
    ? normalizeAgentId(input.consumerAgent || input.consumer_agent || input.consumer)
    : "";
  const requestedAgents = taskDraftInputAgents(input);
  const crossAgent = boolOption(input.crossAgent || input.cross_agent, false)
    || requestedAgents.length > 1
    || taskType.includes("meeting")
    || taskType.includes("cross");
  const requiresHumanGate = boolOption(input.requiresHumanGate ?? input.requires_human_gate ?? input.humanGateRequired ?? input.human_gate_required, true);
  const primaryOwner = requestedAgents[0] || chairAgent;
  const consumerPhaseOwner = consumerAgent || (crossAgent ? "cat_heart" : "");
  const needsSecretary = crossAgent || requiresHumanGate;
  const participants = uniqueAgentIds([
    ...(defaultGovernance && crossAgent ? [chairAgent] : []),
    ...requestedAgents,
    ...(consumerPhaseOwner ? [consumerPhaseOwner] : []),
    ...(defaultGovernance && needsSecretary ? [secretaryAgent] : [])
  ]);
  const participantRecords = [];
  for (const agentId of participants) {
    participantRecords.push(await resolveDraftParticipant(paths, agentId));
  }
  const participantIds = new Set(participants);
  const stockAppendix = stockLongTermTrackingDraftAppendix(input);
  const phases = crossAgent
    ? [
        {
          id: "scope",
          ownerAgent: chairAgent,
          objective: "Confirm task scope, participants, artifacts, and stop conditions before execution."
        },
        {
          id: "responsibility_self_check",
          ownerAgents: participants.filter((agentId) => ![chairAgent, secretaryAgent].includes(agentId)),
          objective: "Each participating owner audits its own current execution responsibilities, boundaries, inputs, and gaps."
        },
        {
          id: "cross_discussion",
          ownerAgent: chairAgent,
          objective: "Cat Brain hosts discussion, resolves overlaps, and records open conflicts for evidence-backed decisions."
        },
        ...(consumerPhaseOwner ? [{
          id: "consumer_requirements",
          ownerAgent: consumerPhaseOwner,
          objective: "Primary consuming agent states required outputs, freshness needs, acceptance criteria, and failure visibility."
        }] : []),
        {
          id: "plan_synthesis",
          ownerAgent: chairAgent,
          objective: "Cat Brain forms at least three mutually exclusive executable options with rollback and stop boundaries."
        },
        ...(requiresHumanGate ? [
          {
            id: "secretary_audit",
            ownerAgent: secretaryAgent,
            objective: "Cat Claw audits evidence completeness, receipt references, Chinese report quality, and button-first Human Gate structure."
          },
          {
            id: "human_gate_package",
            ownerAgent: secretaryAgent,
            objective: "Cat Claw submits the audited package to Flashcat with A/B/C approve options plus pause and terminate controls."
          }
        ] : [])
      ]
	    : [
	        {
	          id: "task_preview",
	          ownerAgent: primaryOwner,
	          objective: "Preview normalized single-agent workflow task ownership, runtime resolution, receipt expectation, and stop conditions."
	        },
	        ...(requiresHumanGate ? [
	          {
	            id: "secretary_audit",
	            ownerAgent: secretaryAgent,
	            objective: "Cat Claw audits evidence completeness, receipt references, Chinese report quality, and button-first Human Gate structure."
	          },
	          {
	            id: "human_gate_package",
	            ownerAgent: secretaryAgent,
	            objective: "Cat Claw submits the audited package to Flashcat before execution."
	          }
	        ] : [])
	      ];
  const humanGateDraft = requiresHumanGate ? {
    options: [
      {
        id: "A",
        title: "Option A",
        required: true,
        ownerAgent: chairAgent,
        acceptance: "Executable, mutually exclusive, evidence-backed plan option with rollback and stop boundaries."
      },
      {
        id: "B",
        title: "Option B",
        required: true,
        ownerAgent: chairAgent,
        acceptance: "Executable, mutually exclusive, evidence-backed plan option with rollback and stop boundaries."
      },
      {
        id: "C",
        title: "Option C",
        required: true,
        ownerAgent: chairAgent,
        acceptance: "Executable, mutually exclusive, evidence-backed plan option with rollback and stop boundaries."
      }
    ],
    controls: [
      { id: "pause_workflow", required: true, ownerAgent: secretaryAgent },
      { id: "terminate_workflow", required: true, ownerAgent: secretaryAgent }
    ],
    language: "zh-CN",
    contentOwnerAgent: chairAgent,
    auditOwnerAgent: secretaryAgent
  } : null;
  const humanGateControls = new Set((humanGateDraft?.controls || []).map((control) => control.id));
  const gates = [
    draftGate("cross_agent_governance_defaults", !crossAgent || (participantIds.has(chairAgent) && participantIds.has(secretaryAgent)), "Cross-agent workflow drafts must include Cat Brain as chair and Cat Claw as secretary."),
    draftGate("cat_brain_chair_present", !crossAgent || participantIds.has(chairAgent), "Cat Brain/main is present as meeting host."),
    draftGate("cat_claw_secretary_present", !needsSecretary || participantIds.has(secretaryAgent), "Cat Claw/cat_claw is present as secretary, recorder, evidence auditor, and Human Gate reporter."),
    draftGate("participant_registry_resolution", participantRecords.every((row) => row.registered), "Every draft participant resolves through runtime_agents.", "warning"),
    draftGate("phase_owners_in_participants", phases.every((phase) => {
      const owners = [phase.ownerAgent, ...(phase.ownerAgents || [])].filter(Boolean);
      return owners.every((owner) => participantIds.has(owner));
    }), "Every phase owner is listed in participants and covered by registry resolution."),
    requiresHumanGate
      ? draftGate("three_options_required", (humanGateDraft?.options || []).length >= 3, "Human Gate package requires at least A/B/C executable options.")
      : { name: "three_options_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
    requiresHumanGate
      ? draftGate("pause_terminate_controls_required", humanGateControls.has("pause_workflow") && humanGateControls.has("terminate_workflow"), "Human Gate package must include pause and terminate controls.")
      : { name: "pause_terminate_controls_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
    requiresHumanGate
      ? draftGate("cat_claw_audit_before_human_gate", phases.some((phase) => phase.id === "secretary_audit"), "Cat Claw audit phase is placed before Human Gate submission.")
      : { name: "cat_claw_audit_before_human_gate", status: "not_applicable", message: "Human Gate is not required for this draft." }
  ];
  const resumePolicy = {
    stableWorkflowId: true,
    stableTraceId: true,
    checkpointBeforeHumanGate: true,
    idempotencyKeyRequired: true
  };
  const spec = {
    workflowId,
    traceId,
    idempotencyKey: String(input.idempotencyKey || input.idempotency_key || `draft:${workflowId}`).trim(),
    taskType,
    subject,
    objective,
    priority: String(input.priority || "normal").trim(),
    createdAt,
    governance: {
      defaultGovernance,
      crossAgent,
      chairAgent,
      secretaryAgent,
      consumerAgent,
      humanGateRequired: requiresHumanGate,
      humanGatePolicy: {
        language: "zh-CN",
        optionsMinimum: 3,
        requiredControls: ["pause_workflow", "terminate_workflow"],
        catBrainOwnsPlanContent: true,
        catClawAuditsAndSubmits: true
      }
    },
	    participants: participantRecords,
	    phases,
	    humanGateDraft,
	    qualityGates: [],
    resumePolicy,
    appendix: stockAppendix
  };
  const planSpecV2 = buildWorkflowPlanSpecV2(spec, input);
  const planMeta = planSpecV2.meta || {};
  const planGates = [
    draftGate("plan_spec_v2_required_ids", Boolean(planSpecV2.schemaVersion && planMeta.planId && planMeta.workflowId && planMeta.traceId && planMeta.idempotencyKey), "Workflow Plan Spec v2 must include stable plan/workflow/trace/idempotency ids."),
    draftGate("plan_spec_v2_contract_shape", planSpecV2ContractOk(planSpecV2), "Workflow Plan Spec v2 must satisfy the documented node, evidence, resume, artifacts, and audit field contract."),
    draftGate("node_acceptance_required", planSpecV2.nodes.every((node) => Array.isArray(node.acceptanceCriteria) && node.acceptanceCriteria.length > 0), "Every Plan Spec v2 node must include acceptance criteria."),
    requiresHumanGate
      ? draftGate("human_gate_original_words_required", planSpecV2.humanGatePolicy?.requiresOriginalWords === true, "Human Gate policy must require Flashcat original words before completion.")
      : { name: "human_gate_original_words_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
    requiresHumanGate
      ? draftGate("human_gate_chinese_body_required", planSpecV2.humanGatePolicy?.language === "zh-CN", "Human Gate policy must require Chinese report content.")
      : { name: "human_gate_chinese_body_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
    draftGate("failure_routes_required", Array.isArray(planSpecV2.failureRoutes) && planSpecV2.failureRoutes.length >= 3, "Plan Spec v2 must declare fallback routes for missing receipts, Human Gate failure, and uncertain side effects.")
  ];
  spec.planSpecV2 = planSpecV2;
  spec.qualityGates = [...gates, ...planGates];
  const warnings = spec.qualityGates.filter((gate) => ["error", "warning"].includes(gate.status)).map((gate) => gate.message);
  return {
    operation: "workflow.task.draft",
    dryRun: true,
    mutated: false,
    dbFile: paths.dbFile,
    warnings,
    spec
  };
}

function workflowTaskLaunchPhaseTasks(spec = {}, input = {}) {
  const workflowId = spec.workflowId || safeId("workflow");
  const draftId = String(input.draftId || input.draft_id || taskLaunchDraftId(spec, input)).trim();
  const prefix = cleanFileSegment(draftId);
  const phaseTaskIds = new Map();
  const tasks = [];
  const phases = Array.isArray(spec.phases) ? spec.phases : [];
  for (const phase of phases) {
    const owners = uniqueAgentIds([
      phase.ownerAgent,
      ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : [])
    ]);
    const taskIds = [];
    owners.forEach((ownerAgent, index) => {
      const suffix = owners.length > 1 ? `${phase.id}-${ownerAgent}` : phase.id;
      const taskId = `task.${prefix}.${cleanFileSegment(suffix || `phase-${index + 1}`)}`;
      taskIds.push(taskId);
      const dependsOn = [];
      if (phase.id === "responsibility_self_check" || phase.id === "consumer_requirements") {
        dependsOn.push(...(phaseTaskIds.get("scope") || []));
      } else if (phase.id === "cross_discussion") {
        dependsOn.push(...(phaseTaskIds.get("responsibility_self_check") || []));
        dependsOn.push(...(phaseTaskIds.get("consumer_requirements") || []));
        if (!dependsOn.length) dependsOn.push(...(phaseTaskIds.get("scope") || []));
      } else if (phase.id === "plan_synthesis") {
        dependsOn.push(...(phaseTaskIds.get("cross_discussion") || []));
        if (!dependsOn.length) dependsOn.push(...(phaseTaskIds.get("responsibility_self_check") || []));
      } else if (phase.id === "secretary_audit") {
        dependsOn.push(...(phaseTaskIds.get("plan_synthesis") || []));
      } else if (phase.id === "human_gate_package") {
        dependsOn.push(...(phaseTaskIds.get("secretary_audit") || []));
      }
      tasks.push({
        taskId,
        workflowId,
        phase: phase.id || "",
        ownerAgent,
        agentId: ownerAgent,
        taskType: phase.id === "human_gate_package" ? "human_gate_package" : "workflow_phase",
        status: "pending",
        priority: spec.priority || "normal",
        dependsOn: [...new Set(dependsOn)],
        receiptRequired: true,
        humanGateRequired: phase.id === "human_gate_package",
        expectedArtifact: `${phase.id || "phase"} evidence and receipt for ${workflowId}`,
        summary: `${phase.id || "phase"}: ${phase.objective || spec.subject || spec.objective || ""}`.slice(0, 500),
        prompt: [
          `Workflow task launch package ${draftId} has been approved by Flashcat and is now active.`,
          `Phase: ${phase.id || ""}`,
          `Objective: ${phase.objective || spec.objective || ""}`,
          "Use the canonical task launch package, referenced artifacts, receipts, and Flashcat original words as binding context.",
          "Return evidence, artifact refs, open risks, and whether the next phase is ready."
        ].join("\n")
      });
    });
    phaseTaskIds.set(phase.id, taskIds);
  }
  return tasks;
}

function taskLaunchDraftId(spec = {}, input = {}) {
  const explicit = String(input.draftId || input.draft_id || "").trim();
  if (explicit) return explicit;
  const stableSeed = [
    spec.workflowId || input.workflowId || input.workflow_id || "",
    spec.idempotencyKey || input.idempotencyKey || input.idempotency_key || "",
    spec.objective || input.objective || input.goal || input.prompt || input.body || input.text || ""
  ].join("\n");
  if (stableSeed.trim()) return `tlp.${textHash(stableSeed).slice(0, 16)}`;
  return safeId("task-launch");
}

function taskLaunchAuditMatrix(spec = {}, input = {}) {
  const chairAgent = spec.governance?.chairAgent || "main";
  const secretaryAgent = spec.governance?.secretaryAgent || "cat_claw";
  const consumerAgent = spec.governance?.consumerAgent || input.consumerAgent || input.consumer_agent || "";
  return [
    {
      stage: "intent_clarification",
      ownerAgent: secretaryAgent,
      auditorAgent: chairAgent,
      rejectAuthority: [chairAgent, "flashcat"],
      reworkTargetAgent: secretaryAgent,
      auditObjective: "Verify Cat Claw captured Flashcat's intent, unresolved questions, launch scope, and stop boundaries before execution."
    },
    {
      stage: "cat_brain_review",
      ownerAgent: chairAgent,
      auditorAgent: chairAgent,
      rejectAuthority: [chairAgent],
      reworkTargetAgent: secretaryAgent,
      auditObjective: "Review the canonical task launch package for phase order, agent boundaries, audit gates, evidence needs, and Human Gate readiness."
    },
    ...(consumerAgent ? [{
      stage: "consumer_contract_review",
      ownerAgent: consumerAgent,
      auditorAgent: chairAgent,
      rejectAuthority: [consumerAgent, chairAgent],
      reworkTargetAgent: secretaryAgent,
      auditObjective: "Verify the consuming agent can use the proposed outputs and that acceptance criteria are explicit."
    }] : []),
    {
      stage: "flashcat_launch_decision",
      ownerAgent: secretaryAgent,
      auditorAgent: "flashcat",
      rejectAuthority: ["flashcat"],
      reworkTargetAgent: secretaryAgent,
      auditObjective: "Flashcat approves, rejects, pauses, or terminates launch with token-bound original words."
    }
  ];
}

function renderTaskLaunchMarkdown(pkg = {}) {
  const lines = [];
  const addList = (items = [], render) => {
    if (!items.length) {
      lines.push("- none");
      return;
    }
    for (const item of items) lines.push(render(item));
  };
  lines.push(`# Task Launch Package ${pkg.draftId}`);
  lines.push("");
  lines.push(`- status: ${pkg.status}`);
  lines.push(`- workflow_id: ${pkg.workflowId}`);
  lines.push(`- trace_id: ${pkg.traceId}`);
  lines.push(`- created_at: ${pkg.createdAt}`);
  lines.push(`- drafter: ${pkg.roles?.drafterAgent || ""}`);
  lines.push(`- reviewer: ${pkg.roles?.reviewerAgent || ""}`);
  lines.push(`- final_approver: ${pkg.roles?.finalApprover || ""}`);
  lines.push("");
  lines.push("## Objective");
  lines.push("");
  lines.push(pkg.objective || "待补充。");
  lines.push("");
  lines.push("## Flashcat Intent");
  lines.push("");
  lines.push(pkg.intent?.flashcatIntent || pkg.intent?.sourceSummary || "待猫爪通过多轮会话补齐。");
  lines.push("");
  lines.push("## Participants");
  lines.push("");
  addList(pkg.participants || [], (participant) => `- ${participant.agentId}: runtime=${participant.runtime || ""} platform=${participant.platform || ""} registered=${participant.registered}`);
  lines.push("");
  lines.push("## Phases");
  lines.push("");
  addList(pkg.phases || [], (phase) => `- ${phase.id}: owner=${phase.ownerAgent || (phase.ownerAgents || []).join(",")} | ${phase.objective || ""}`);
  lines.push("");
  lines.push("## Audit Matrix");
  lines.push("");
  addList(pkg.auditMatrix || [], (gate) => `- ${gate.stage}: owner=${gate.ownerAgent} auditor=${gate.auditorAgent} reject=${(gate.rejectAuthority || []).join(",")} rework=${gate.reworkTargetAgent}`);
  lines.push("");
  lines.push("## Launch Tasks After Approval");
  lines.push("");
  addList(pkg.launchMaterialization?.tasks || [], (task) => `- ${task.taskId}: ${task.phase} -> ${task.ownerAgent} depends=[${(task.dependsOn || []).join(",")}]`);
  lines.push("");
  lines.push("## Human Gate");
  lines.push("");
  lines.push(`- required: ${Boolean(pkg.governance?.humanGateRequired)}`);
  lines.push(`- submitter: ${pkg.roles?.secretaryAgent || "cat_claw"}`);
  lines.push("- Flashcat original words are required before launch approval is complete.");
  lines.push("");
  lines.push("## Post Approval");
  lines.push("");
  lines.push(`- original_words_interpreter: ${pkg.postApproval?.flashcatOriginalWordsInterpreter || ""}`);
  lines.push(`- next_round_planner: ${pkg.postApproval?.nextRoundPlannerAgent || ""}`);
  lines.push(`- consumer: ${pkg.roles?.consumerAgent || ""}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildTaskLaunchPackage(draft = {}, input = {}, artifactRefs = {}) {
  const spec = draft.spec || {};
  const draftId = String(input.draftId || input.draft_id || taskLaunchDraftId(spec, input)).trim();
  const secretaryAgent = spec.governance?.secretaryAgent || normalizeAgentId(input.drafterAgent || input.drafter_agent || input.createdBy || input.from || "cat_claw");
  const chairAgent = spec.governance?.chairAgent || "main";
  const consumerAgent = spec.governance?.consumerAgent || input.consumerAgent || input.consumer_agent || "";
  const tasks = workflowTaskLaunchPhaseTasks(spec, { ...input, draftId });
  return {
    schemaVersion: "workflow_task_launch_package.v1",
    draftId,
    workflowId: spec.workflowId,
    traceId: spec.traceId,
    idempotencyKey: spec.idempotencyKey,
    status: "pending_cat_brain_review",
    taskType: spec.taskType,
    subject: spec.subject,
    objective: spec.objective,
    priority: spec.priority,
    createdAt: spec.createdAt || nowIso(),
    roles: {
      intentOwner: "flashcat",
      drafterAgent: secretaryAgent,
      secretaryAgent,
      reviewerAgent: chairAgent,
      supervisorAgent: chairAgent,
      finalApprover: "flashcat",
      consumerAgent,
      outputConsumerAgent: consumerAgent || ""
    },
    intent: {
      sourceSystem: input.sourceSystem || input.source_system || "workflow.task.launch.prepare",
      sourceSummary: input.intentSummary || input.intent_summary || input.summary || spec.subject || "",
      flashcatIntent: input.flashcatIntent || input.flashcat_intent || spec.objective || "",
      clarificationStatus: input.clarificationStatus || input.clarification_status || "initial_draft",
      openQuestions: toList(input.openQuestions || input.open_questions)
    },
    governance: spec.governance,
    participants: spec.participants || [],
    phases: spec.phases || [],
    planSpecV2: spec.planSpecV2 || null,
    auditMatrix: taskLaunchAuditMatrix(spec, input),
    qualityGates: spec.qualityGates || [],
    humanGateDraft: spec.humanGateDraft || null,
    launchMaterialization: {
      mode: "approval_required",
      materializeAction: "workflow.task.launch.approve",
      createsWorkflowRun: true,
      createsWorkflowTasks: true,
      tasks
    },
    postApproval: {
      flashcatOriginalWordsRequired: true,
      flashcatOriginalWordsInterpreter: secretaryAgent,
      nextRoundPlannerAgent: chairAgent,
      nextRoundDispatcher: "workflow",
      resumePolicy: spec.resumePolicy || {}
    },
    artifactRefs,
    appendix: spec.appendix || null
  };
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

async function syncWorkflowPhasesFromPlanSpec(paths, pkg = {}, timestamp = nowIso()) {
  const workflowId = pkg.workflowId || pkg.planSpecV2?.meta?.workflowId || "";
  if (!workflowId) return [];
  const plan = pkg.planSpecV2 || {};
  const phaseGraph = Array.isArray(plan.phaseGraph) ? plan.phaseGraph : [];
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const phases = phaseGraph.length ? phaseGraph : (Array.isArray(pkg.phases) ? pkg.phases.map((phase, index) => ({
    phaseId: phase.id || `phase_${index + 1}`,
    ordinal: index + 1,
    status: "planned",
    ownerAgents: uniqueAgentIds([phase.ownerAgent, ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : [])]),
    dependsOn: [],
    objective: phase.objective || "",
    acceptanceCriteria: [phase.objective || ""].filter(Boolean)
  })) : []);
  const synced = [];
  for (const phase of phases) {
    const phaseKey = phase.phaseId || phase.phaseKey || phase.id || "";
    if (!phaseKey) continue;
    const phaseNodes = nodes.filter((node) => node.phaseId === phaseKey);
    const ownerAgents = uniqueAgentIds([
      ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : []),
      phase.ownerAgent,
      ...phaseNodes.map((node) => node.ownerAgent)
    ]);
    const verifierAgent = phase.verifierAgent || phaseNodes.find((node) => node.verifier?.agentId)?.verifier?.agentId || plan.verification?.verifierAgent || "";
    const humanGateRequired = phase.humanGateRequired === true || phaseNodes.some((node) => node.humanGateRequired === true);
    const phaseId = workflowPhaseRecordId(workflowId, phaseKey);
    const payload = {
      source: "planSpecV2",
      planId: plan.meta?.planId || "",
      objective: phase.objective || "",
      phase,
      nodeCount: phaseNodes.length
    };
    await sqlite(paths.dbFile, `
INSERT INTO workflow_phases(phase_id, workflow_id, phase_key, ordinal, status, owner_agent, owner_agents_json, depends_on_json, acceptance_criteria_json, verifier_agent, human_gate_required, plan_node_refs_json, payload_json, created_at, started_at, completed_at, updated_at)
VALUES (${sqlValue(phaseId)}, ${sqlValue(workflowId)}, ${sqlValue(phaseKey)}, ${Number(phase.ordinal || 0)}, ${sqlValue(phase.status || "planned")}, ${sqlValue(ownerAgents[0] || "")}, ${sqlValue(JSON.stringify(ownerAgents))}, ${sqlValue(JSON.stringify(phase.dependsOn || []))}, ${sqlValue(JSON.stringify(phase.acceptanceCriteria || []))}, ${sqlValue(verifierAgent)}, ${humanGateRequired ? 1 : 0}, ${sqlValue(JSON.stringify(phaseNodes.map((node) => node.nodeId)))}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(timestamp)}, NULL, NULL, ${sqlValue(timestamp)})
ON CONFLICT(phase_id) DO UPDATE SET
  ordinal=excluded.ordinal,
  status=CASE WHEN workflow_phases.status IN ('done','failed','cancelled') THEN workflow_phases.status ELSE excluded.status END,
  owner_agent=excluded.owner_agent,
  owner_agents_json=excluded.owner_agents_json,
  depends_on_json=excluded.depends_on_json,
  acceptance_criteria_json=excluded.acceptance_criteria_json,
  verifier_agent=excluded.verifier_agent,
  human_gate_required=excluded.human_gate_required,
  plan_node_refs_json=excluded.plan_node_refs_json,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
    synced.push({ phaseId, phaseKey, status: phase.status || "planned", ownerAgents, nodeCount: phaseNodes.length });
  }
  return synced;
}

export async function workflowTaskLaunchPrepare(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const draft = await workflowTaskDraft(rootDir, {
    ...input,
    secretaryAgent: input.secretaryAgent || input.secretary_agent || input.drafterAgent || input.drafter_agent || "cat_claw",
    chairAgent: input.chairAgent || input.chair_agent || "main",
    requiresHumanGate: input.requiresHumanGate ?? input.requires_human_gate ?? true
  });
  const blockingErrors = (draft.spec?.qualityGates || []).filter((gate) => gate.status === "error");
  if (blockingErrors.length) {
    throw new Error(`workflow task launch package has blocking draft gate errors: ${blockingErrors.map((gate) => gate.name).join(", ")}`);
  }
  const draftId = String(input.draftId || input.draft_id || taskLaunchDraftId(draft.spec, input)).trim();
  const existingPackage = await readProtocolObject(paths, draftId);
  if (existingPackage?.object_type === "workflow_task_launch_package") {
    const existingStatus = String(existingPackage.status || "").trim();
    if (["pending_flashcat_launch", "launched"].includes(existingStatus)) {
      throw new Error(`workflow task launch package cannot be overwritten after Cat Brain review or launch: ${draftId} status=${existingStatus}`);
    }
  }
  const packageDir = path.join(paths.artifactsDir, "task-launch", cleanFileSegment(draft.spec.workflowId));
  const initialPackage = buildTaskLaunchPackage(draft, { ...input, draftId });
  const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, draftId, initialPackage);
  const markdownPackage = { ...initialPackage, artifactRefs: { canonicalJson: jsonRelPath } };
  const mdRelPath = await writeTextArtifact(paths.root, packageDir, draftId, "md", renderTaskLaunchMarkdown(markdownPackage));
  const pkg = { ...initialPackage, artifactRefs: { canonicalJson: jsonRelPath, markdown: mdRelPath } };
  await writeJsonArtifact(paths.root, packageDir, draftId, pkg);
  const hash = jsonHash(pkg);
  const updatedAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${draftId}.json`)}, ${sqlValue(pkg.workflowId)}, 'workflow_task_launch_package_json', ${sqlValue(jsonRelPath)}, ${sqlValue(pkg.subject || pkg.objective || "")}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${draftId}.md`)}, ${sqlValue(pkg.workflowId)}, 'workflow_task_launch_package_markdown', ${sqlValue(mdRelPath)}, ${sqlValue(pkg.subject || pkg.objective || "")}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES (${sqlValue(draftId)}, 'workflow_task_launch_package', ${sqlValue(pkg.status)}, NULL, ${sqlValue(pkg.intent.sourceSystem)}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.workflowId)}, ${sqlValue(jsonRelPath)}, ${sqlValue(JSON.stringify(pkg))}, ${sqlValue(hash)}, ${sqlValue(pkg.createdAt)}, ${sqlValue(updatedAt)})
ON CONFLICT(object_id) DO UPDATE SET
  status=excluded.status,
  source_system=excluded.source_system,
  source_agent=excluded.source_agent,
  parent_object_id=excluded.parent_object_id,
  path=excluded.path,
  payload_json=excluded.payload_json,
  hash=excluded.hash,
  updated_at=excluded.updated_at;
INSERT INTO review_gates(gate_id, workflow_id, gate_type, status, summary, reviewer_agent, human_gate_required, resume_pointer, evidence_paths_json, created_by, created_at, updated_at)
VALUES (${sqlValue(`gate.${draftId}.cat_brain_review`)}, ${sqlValue(pkg.workflowId)}, 'task_launch_cat_brain_review', 'pending', ${sqlValue(`猫之脑复核 task launch package: ${pkg.subject || pkg.workflowId}`)}, ${sqlValue(pkg.roles.reviewerAgent)}, ${sqlValue(pkg.governance?.humanGateRequired ? 1 : 0)}, ${sqlValue(draftId)}, ${sqlValue(JSON.stringify([jsonRelPath, mdRelPath]))}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.createdAt)}, ${sqlValue(updatedAt)})
ON CONFLICT(gate_id) DO UPDATE SET status=excluded.status, summary=excluded.summary, reviewer_agent=excluded.reviewer_agent, human_gate_required=excluded.human_gate_required, resume_pointer=excluded.resume_pointer, evidence_paths_json=excluded.evidence_paths_json, updated_at=excluded.updated_at;`);
  await appendWorkflowEvent(paths, {
    eventType: "workflow.task_launch.prepared",
    status: "pending_cat_brain_review",
    workflowId: pkg.workflowId,
    traceId: pkg.traceId,
    actor: pkg.roles.drafterAgent,
    sourceRuntime: "workflow",
    sourceAgent: pkg.roles.drafterAgent,
    idempotencyKey: `task_launch_prepare:${draftId}`,
    artifactRef: jsonRelPath,
    payload: { draftId, markdown: mdRelPath, reviewerAgent: pkg.roles.reviewerAgent, finalApprover: pkg.roles.finalApprover },
    createdAt: updatedAt
  });
  return {
    operation: "workflow.task.launch.prepare",
    mutated: true,
    draftId,
    status: pkg.status,
    workflowId: pkg.workflowId,
    traceId: pkg.traceId,
    package: pkg,
    artifacts: { canonicalJson: jsonRelPath, markdown: mdRelPath },
    reviewGateId: `gate.${draftId}.cat_brain_review`,
    dbFile: paths.dbFile,
    warnings: draft.warnings || []
  };
}

export async function workflowTaskLaunchList(rootDir, input = {}) {
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

export async function workflowTaskLaunchReview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const draftId = String(input.draftId || input.draft_id || input.objectId || input.object_id || "").trim();
  if (!draftId) throw new Error("draftId is required");
  const reviewStatus = String(input.status || input.decision || "approved").trim();
  if (!["approved", "rejected", "revise_required"].includes(reviewStatus)) {
    throw new Error("task launch review status must be approved, rejected, or revise_required");
  }
  const reviewOpinion = String(input.reviewOpinion || input.review_opinion || input.opinion || input.text || input.summary || "").trim();
  if (!reviewOpinion) throw new Error("Cat Brain review opinion is required");
  const reviewerAgent = normalizeAgentId(input.reviewerAgent || input.reviewer_agent || input.actor || "main");
  const row = await readProtocolObject(paths, draftId);
  if (!row || row.object_type !== "workflow_task_launch_package") throw new Error(`workflow task launch package not found: ${draftId}`);
  const pkg = row.payload || {};
  if (row.status !== "pending_cat_brain_review") {
    throw new Error(`workflow task launch package review must start from pending_cat_brain_review: ${draftId} status=${row.status}`);
  }
  if (reviewerAgent !== (pkg.roles?.reviewerAgent || "main")) {
    throw new Error(`task launch review must be performed by package reviewer ${pkg.roles?.reviewerAgent || "main"}`);
  }
  const caller = workflowPermissionCaller(input);
  if (caller.agentId && caller.agentId !== reviewerAgent && !isWorkflowTrustedOperator(caller)) {
    throw new Error(`task launch review caller ${caller.agentId} cannot impersonate reviewer ${reviewerAgent}`);
  }
  const reviewedAt = nowIso();
  const nextStatus = reviewStatus === "approved" ? "pending_flashcat_launch" : reviewStatus;
  const nextPackage = {
    ...pkg,
    status: nextStatus,
    catBrainReview: {
      status: reviewStatus,
      reviewerAgent,
      reviewOpinion,
      reviewedAt
    }
  };
  const packageDir = path.join(paths.artifactsDir, "task-launch", cleanFileSegment(pkg.workflowId || draftId));
  const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, draftId, nextPackage);
  await writeTextArtifact(paths.root, packageDir, draftId, "md", renderTaskLaunchMarkdown(nextPackage));
  const hash = jsonHash(nextPackage);
  await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status=${sqlValue(nextStatus)},
    path=${sqlValue(jsonRelPath)},
    payload_json=${sqlValue(JSON.stringify(nextPackage))},
    hash=${sqlValue(hash)},
    updated_at=${sqlValue(reviewedAt)}
WHERE object_id=${sqlValue(draftId)} AND object_type='workflow_task_launch_package';
UPDATE review_gates
SET status=${sqlValue(reviewStatus === "revise_required" ? "rejected" : reviewStatus)},
    summary=${sqlValue(reviewOpinion)},
    decision_at=${sqlValue(reviewedAt)},
    approver=${sqlValue(reviewerAgent)},
    updated_at=${sqlValue(reviewedAt)}
WHERE resume_pointer=${sqlValue(draftId)} AND gate_type='task_launch_cat_brain_review';`);
  await appendWorkflowEvent(paths, {
    eventType: "workflow.task_launch.reviewed",
    status: nextStatus,
    workflowId: pkg.workflowId,
    traceId: pkg.traceId,
    actor: reviewerAgent,
    sourceRuntime: "workflow",
    sourceAgent: reviewerAgent,
    idempotencyKey: `task_launch_review:${draftId}:${reviewStatus}`,
    artifactRef: jsonRelPath,
    payload: { draftId, reviewStatus, reviewOpinion },
    createdAt: reviewedAt
  });
  return {
    operation: "workflow.task.launch.review",
    mutated: true,
    draftId,
    status: nextStatus,
    reviewStatus,
    workflowId: pkg.workflowId,
    artifactRef: jsonRelPath,
    dbFile: paths.dbFile
  };
}

export async function workflowTaskLaunchApprove(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const draftId = String(input.draftId || input.draft_id || input.objectId || input.object_id || "").trim();
  if (!draftId) throw new Error("draftId is required");
  const feedbackText = String(input.feedbackText || input.feedback_text || input.flashcatOriginalWords || input.flashcat_original_words || input.originalWords || input.original_words || "").trim();
  if (!feedbackText) throw new Error("Flashcat original words / feedbackText is required before task launch approval");
  const row = await readProtocolObject(paths, draftId);
  if (!row || row.object_type !== "workflow_task_launch_package") throw new Error(`workflow task launch package not found: ${draftId}`);
  const pkg = row.payload || {};
  if (row.status !== "pending_flashcat_launch") {
    throw new Error(`workflow task launch package must pass Cat Brain review before Flashcat launch approval: ${draftId} status=${row.status}`);
  }
  const approvedAt = nowIso();
  const approvedBy = String(input.approvedBy || input.approved_by || input.actor || "flashcat").trim();
  const caller = workflowPermissionCaller(input);
  const sourceSystem = String(input.sourceSystem || input.source_system || "").trim().toLowerCase();
  const approveSourceAllowed = approvedBy === "flashcat"
    && (!caller.agentId
      || caller.agentId === "flashcat"
      || isWorkflowTrustedOperator(caller)
      || ["human_gate_console", "human_gate_web_app", "human_gate", "workflow_gui"].includes(sourceSystem));
  if (!approveSourceAllowed) {
    throw new Error("task launch approval must come from Flashcat Human Gate, governed GUI, or trusted local control plane");
  }
  const materializedTasks = [];
  await workflowRunUpsert(rootDir, {
    workflowId: pkg.workflowId,
    workflowType: pkg.taskType || "initiative",
    status: "active",
    ownerAgent: pkg.roles?.supervisorAgent || "main",
    summary: pkg.subject || pkg.objective || "",
    objective: pkg.objective || "",
    currentPhase: "launched",
    payload: {
      taskLaunchPackageId: draftId,
      taskLaunchArtifacts: pkg.artifactRefs || {},
      flashcatOriginalWords: feedbackText,
      approvedAt,
      approvedBy
    }
  });
  for (const task of pkg.launchMaterialization?.tasks || []) {
    const existing = await sqlite(paths.dbFile, `SELECT task_id FROM workflow_tasks WHERE task_id=${sqlValue(task.taskId)} LIMIT 1;`, { json: true });
    if (existing[0]) {
      materializedTasks.push({ taskId: task.taskId, status: "already_exists" });
      continue;
    }
    const created = await workflowTaskCreate(rootDir, {
      ...task,
      createdBy: approvedBy,
      payload: {
        ...(task.payload || {}),
        taskLaunchPackageId: draftId,
        taskLaunchArtifacts: pkg.artifactRefs || {},
        flashcatOriginalWords: feedbackText,
        approvedAt,
        approvedBy
      }
    });
    materializedTasks.push({ taskId: created.taskId, status: "created", ownerAgent: created.ownerAgent, runtime: created.runtime });
  }
  const materializedPhases = await syncWorkflowPhasesFromPlanSpec(paths, pkg, approvedAt);
  const nextPackage = {
    ...pkg,
    status: "launched",
    approvedAt,
    approvedBy,
    materializedPhases,
    flashcatOriginalWords: feedbackText,
    materializedTasks
  };
  const packageDir = path.join(paths.artifactsDir, "task-launch", cleanFileSegment(pkg.workflowId || draftId));
  const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, draftId, nextPackage);
  await writeTextArtifact(paths.root, packageDir, draftId, "md", renderTaskLaunchMarkdown(nextPackage));
  const hash = jsonHash(nextPackage);
  await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status='launched',
    path=${sqlValue(jsonRelPath)},
    payload_json=${sqlValue(JSON.stringify(nextPackage))},
    hash=${sqlValue(hash)},
    updated_at=${sqlValue(approvedAt)}
WHERE object_id=${sqlValue(draftId)} AND object_type='workflow_task_launch_package';
UPDATE review_gates
SET updated_at=${sqlValue(approvedAt)}
WHERE resume_pointer=${sqlValue(draftId)} AND gate_type='task_launch_cat_brain_review';`);
  await appendWorkflowEvent(paths, {
    eventType: "workflow.task_launch.launched",
    status: "launched",
    workflowId: pkg.workflowId,
    traceId: pkg.traceId,
    actor: approvedBy,
    sourceRuntime: "workflow",
    sourceAgent: approvedBy,
    idempotencyKey: `task_launch_approve:${draftId}`,
    artifactRef: jsonRelPath,
    payload: { draftId, materializedPhases, materializedTasks, flashcatOriginalWords: feedbackText },
    createdAt: approvedAt
  });
  return {
    operation: "workflow.task.launch.approve",
    mutated: true,
    draftId,
    status: "launched",
    workflowId: pkg.workflowId,
    materializedPhases,
    materializedTasks,
    artifactRef: jsonRelPath,
    dbFile: paths.dbFile
  };
}

export async function workflowTaskUpdate(rootDir, input = {}) {
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

export async function workflowTaskList(rootDir, input = {}) {
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

function parseWorkerSpec(value, fallbackRuntime = "openclaw") {
  const text = String(value || "").trim();
  if (!text) return { runtime: fallbackRuntime, agentId: "main" };
  const [runtimePart, agentPart] = text.includes(":") ? text.split(":", 2) : [fallbackRuntime, text];
  return { runtime: normalizeRuntime(runtimePart), agentId: normalizeAgentId(agentPart) };
}

function parseSwarmShards(input = {}) {
  const raw = input.shards ?? input.targets ?? input.items ?? input.symbols ?? [];
  const parsed = parseJsonValue(raw, raw);
  const values = Array.isArray(parsed) ? parsed : toList(parsed);
  if (values.length) {
    return values.map((item, index) => {
      if (item && typeof item === "object") {
        return {
          id: String(item.id || item.shardId || item.shard_id || `shard-${String(index + 1).padStart(3, "0")}`),
          text: String(item.text || item.summary || item.target || item.symbol || JSON.stringify(item)),
          payload: item
        };
      }
      const text = String(item).trim();
      return { id: cleanFileSegment(text || `shard-${String(index + 1).padStart(3, "0")}`), text, payload: { value: text } };
    });
  }
  const shardCount = Math.max(1, Math.min(300, Number(input.shardCount || input.shard_count || 1)));
  return Array.from({ length: shardCount }, (_, index) => ({
    id: `shard-${String(index + 1).padStart(3, "0")}`,
    text: `shard ${index + 1} of ${shardCount}`,
    payload: { index: index + 1, total: shardCount }
  }));
}

function renderSwarmWorkerPrompt(input, shard) {
  const objective = String(input.objective || input.goal || input.summary || "").trim();
  const instructions = String(input.prompt || input.instructions || input.text || "").trim();
  return [
    "You are working as one bounded shard worker in a trading_agents swarm-style workflow.",
    "Stay inside your assigned shard. Do not expand scope unless evidence requires it.",
    "",
    `Objective: ${objective}`,
    `Shard: ${shard.id}`,
    `Shard input: ${shard.text}`,
    instructions ? `Instructions: ${instructions}` : "",
    "",
    "Return a concise artifact-ready result with evidence, assumptions, uncertainty, and recommended next action.",
    "Do not execute trades. Do not bypass Human Gate."
  ].filter(Boolean).join("\n");
}

function renderSwarmReducerPrompt(input, shards, fanoutTasks) {
  const objective = String(input.objective || input.goal || input.summary || "").trim();
  const acceptance = String(input.acceptanceCriteria || input.acceptance_criteria || "").trim();
  return [
    "You are the reducer for a trading_agents swarm-style workflow.",
    "Synthesize worker shard outputs into one next-action package. Preserve disagreement and uncertainty instead of flattening it.",
    "",
    `Objective: ${objective}`,
    acceptance ? `Acceptance criteria: ${acceptance}` : "",
    `Shard count: ${shards.length}`,
    "",
    "Worker task ids:",
    fanoutTasks.map((task) => `- ${task.taskId}: ${task.shardId}`).join("\n"),
    "",
    "Reducer output requirements:",
    "1. State the integrated conclusion.",
    "2. List evidence and gaps by shard.",
    "3. Identify unresolved conflicts or missing receipts.",
    "4. Propose the next workflow step for cat-brain main.",
    "5. If Flashcat confirmation is needed, produce a Cat Claw-ready Human Gate package."
  ].filter(Boolean).join("\n");
}

async function workflowTaskExists(paths, taskId) {
  const rows = await sqlite(paths.dbFile, `SELECT task_id, status FROM workflow_tasks WHERE task_id=${sqlValue(taskId)} LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function workflowSwarmPlan(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || input.initiativeId || input.initiative_id || safeId("swarm")).trim();
  const objective = String(input.objective || input.goal || input.summary || "").trim();
  if (!objective) throw new Error("objective is required");
  const phase = String(input.phase || "swarm").trim();
  const createdBy = String(input.createdBy || input.created_by || input.from || "main").trim();
  const runRows = await sqlite(paths.dbFile, `SELECT workflow_id FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
  let workflowRun = null;
  if (!runRows[0]) {
    workflowRun = await workflowRunUpsert(rootDir, {
      workflowRootDir: paths.root,
      workflowId,
      workflowType: input.workflowType || input.workflow_type || "swarm",
      status: "active",
      ownerAgent: input.ownerAgent || input.owner_agent || "main",
      objective,
      acceptanceCriteria: input.acceptanceCriteria || input.acceptance_criteria || "",
      stopCondition: input.stopCondition || input.stop_condition || "Flashcat accepts the final next-action package or blocks continuation.",
      phase,
      payload: {
        swarmPlan: true,
        createdBy,
        source: input.source || "workflow.swarm.plan"
      }
    });
  }
  const shards = parseSwarmShards(input);
  const fanoutLimit = Math.max(1, Math.min(300, Number(input.fanoutLimit || input.fanout_limit || shards.length)));
  const workers = toList(input.workers || input.worker || input.workerPool || input.worker_pool);
  const workerPool = (workers.length ? workers : ["openclaw:main"]).map((worker) => parseWorkerSpec(worker));
  const reducer = parseWorkerSpec(input.reducer || input.reducerAgent || input.reducer_agent || "openclaw:main");
  const created = [];
  const skipped = [];
  for (const [index, shard] of shards.slice(0, fanoutLimit).entries()) {
    const worker = workerPool[index % workerPool.length];
    const taskId = String(input.taskPrefix || input.task_prefix || `${workflowId}-swarm`).trim() + `-${cleanFileSegment(shard.id).slice(0, 48)}`;
    const existing = await workflowTaskExists(paths, taskId);
    if (existing) {
      skipped.push({ taskId, shardId: shard.id, status: existing.status });
      continue;
    }
    const task = await workflowTaskCreate(rootDir, {
      workflowRootDir: paths.root,
      workflowId,
      taskId,
      phase,
      ownerAgent: worker.agentId,
      runtime: worker.runtime,
      agentId: worker.agentId,
      taskType: input.taskType || input.task_type || "swarm_shard",
      priority: input.priority || "normal",
      summary: `${objective} / ${shard.id}`,
      prompt: renderSwarmWorkerPrompt(input, shard),
      expectedArtifact: input.expectedArtifact || input.expected_artifact || `swarm shard result: ${shard.id}`,
      receiptRequired: true,
      humanGateRequired: false,
      createdBy,
      payload: {
        swarm: true,
        shardId: shard.id,
        shardText: shard.text,
        shardPayload: shard.payload,
        shardIndex: index + 1,
        shardCount: Math.min(shards.length, fanoutLimit)
      }
    });
    created.push({ ...task, shardId: shard.id });
  }
  const reducerTaskId = String(input.reducerTaskId || input.reducer_task_id || `${workflowId}-swarm-reduce`).trim();
  let reducerTask = null;
  const reducerExisting = await workflowTaskExists(paths, reducerTaskId);
  if (reducerExisting) {
    skipped.push({ taskId: reducerTaskId, shardId: "reduce", status: reducerExisting.status });
  } else {
    const dependencyIds = [...created.map((task) => task.taskId), ...skipped.filter((task) => task.shardId !== "reduce").map((task) => task.taskId)];
    reducerTask = await workflowTaskCreate(rootDir, {
      workflowRootDir: paths.root,
      workflowId,
      taskId: reducerTaskId,
      phase,
      ownerAgent: reducer.agentId,
      runtime: reducer.runtime,
      agentId: reducer.agentId,
      taskType: "swarm_reduce",
      priority: boolOption(input.flashLane ?? input.flash_lane, false) ? "flash" : "high",
      dependsOn: dependencyIds,
      summary: `${objective} / reduce shard outputs`,
      prompt: renderSwarmReducerPrompt(input, shards.slice(0, fanoutLimit), [...created, ...skipped]),
      expectedArtifact: input.reducerArtifact || input.reducer_artifact || "integrated swarm next-action package",
      receiptRequired: true,
      humanGateRequired: boolOption(input.reducerHumanGate || input.reducer_human_gate, false),
      createdBy,
      payload: {
        swarm: true,
        reducer: true,
        shardTaskIds: dependencyIds,
        shardCount: dependencyIds.length
      }
    });
  }
  return {
    workflowId,
    workflowRun,
    objective,
    phase,
    shardCount: shards.length,
    plannedShardCount: Math.min(shards.length, fanoutLimit),
    workerPool,
    reducer,
    createdTasks: created,
    reducerTask,
    skippedTasks: skipped,
    dbFile: paths.dbFile
  };
}

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

export async function workflowAdvancePreview(rootDir, input = {}) {
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

export async function workflowAdvance(rootDir, input = {}) {
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

export async function workflowSupervisor(rootDir, input = {}) {
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
    const cycleRecord = { cycle, advance, runtimeDrains: [] };
    cycles.push(cycleRecord);
    finalAdvance = advance;
    if (!drain || dryRun || !advance.dispatched.length) break;
    const runtimes = [...new Set(advance.dispatched.map((item) => item.runtime).filter(Boolean))];
    for (const runtime of runtimes) {
      const drained = await runtimeBridgeDrain(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        runtime,
        limit: runtimeLimit,
        timeoutSeconds,
        dryRun: false
      });
      cycleRecord.runtimeDrains.push(drained);
    }
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
      catClawReportDrain = await runtimeBridgeDrain(rootDir, {
        ...input,
        workflowRootDir: paths.root,
        runtime: catClawReport.runtime,
        dispatchId: catClawReport.dispatchId,
        limit: 1,
        timeoutSeconds,
        dryRun: false
      });
    }
  }
  return {
    workflowId,
    meetingId,
    startedAt,
    completedAt: nowIso(),
    cycles,
    dispatched,
    finalAdvance,
    checkpoint,
    catClawReport,
    catClawReportDrain,
    dryRun,
    dbFile: paths.dbFile
  };
}

export async function workflowSupervisorPreview(rootDir, input = {}) {
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
      "Runtime drain, checkpoint creation, Telegram outbox delivery, and Cat Claw report dispatch are not executed."
    ],
    dbFile: paths.dbFile
  };
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

function interventionTarget(input = {}) {
  return {
    phaseId: String(input.phaseId || input.phase_id || "").trim(),
    phaseKey: String(input.phaseKey || input.phase_key || input.phase || "").trim(),
    agentRunId: String(input.agentRunId || input.agent_run_id || "").trim(),
    dispatchId: String(input.dispatchId || input.dispatch_id || "").trim(),
    runtimeRunId: String(input.runtimeRunId || input.runtime_run_id || "").trim(),
    runtime: String(input.runtime || "").trim(),
    agentId: String(input.agentId || input.agent_id || "").trim()
  };
}

function workflowInterventionKind(action) {
  if (action === "workflow.pause" || action.includes(".pause.")) return "pause_workflow";
  if (action === "workflow.resume" || action.includes(".resume.")) return "resume_workflow";
  if (action === "workflow.stop" || action === "workflow.terminate" || action.includes(".stop.") || action.includes(".terminate.")) return "stop_workflow";
  if (action.includes(".rerun.agent.")) return "rerun_agent";
  if (action.includes(".rerun.phase.")) return "rerun_phase";
  return "unknown";
}

function workflowInterventionPreviewAction(kind) {
  if (kind === "pause_workflow") return "workflow.pause.preview";
  if (kind === "resume_workflow") return "workflow.resume.preview";
  if (kind === "stop_workflow") return "workflow.stop.preview";
  if (kind === "rerun_agent") return "workflow.rerun.agent.preview";
  if (kind === "rerun_phase") return "workflow.rerun.phase.preview";
  return "";
}

function workflowInterventionNextState(kind, workflowStatus) {
  if (kind === "pause_workflow") return "paused";
  if (kind === "resume_workflow") return "active";
  if (kind === "stop_workflow") return "stopped";
  return workflowStatus;
}

function interventionRiskTier(kind, context = {}) {
  if (kind === "stop_workflow") return context.sideEffectUncertainCount ? "P0-critical" : "P1-high";
  if (kind === "rerun_agent" || kind === "rerun_phase") return "P1-high";
  return "P2-medium";
}

function evaluateInterventionEligibility(kind, workflow, context = {}, input = {}) {
  const status = String(workflow.status || "").trim();
  const terminal = ["completed", "stopped", "cancelled"].includes(status);
  const violations = [];
  const warnings = [];
  if (terminal) violations.push({ code: "workflow_terminal", detail: `workflow status is ${status}` });
  if (kind === "pause_workflow" && status === "paused") violations.push({ code: "already_paused", detail: "workflow is already paused" });
  if (kind === "pause_workflow" && !["active", "waiting_human", "blocked"].includes(status)) {
    violations.push({ code: "pause_invalid_status", detail: `pause preview expects active/waiting_human/blocked, got ${status || "unknown"}` });
  }
  if (kind === "resume_workflow") {
    if (!["paused", "blocked"].includes(status)) violations.push({ code: "resume_invalid_status", detail: `resume preview expects paused/blocked, got ${status || "unknown"}` });
    if (context.pendingHumanGates > 0 && !boolOption(input.allowPendingHumanGate ?? input.allow_pending_human_gate, false)) {
      violations.push({ code: "pending_human_gate", detail: "pending Human Gate must be closed before resume" });
    }
  }
  if (kind === "stop_workflow" && !["active", "waiting_human", "blocked", "paused"].includes(status)) {
    violations.push({ code: "stop_invalid_status", detail: `stop preview expects active/waiting_human/blocked/paused, got ${status || "unknown"}` });
  }
  if (kind === "rerun_agent") {
    const hasTarget = Boolean(context.target.agentRunId || context.target.dispatchId || context.target.runtimeRunId || context.target.agentId);
    if (!hasTarget) violations.push({ code: "missing_agent_target", detail: "rerun agent preview requires agentRunId, dispatchId, runtimeRunId, or agentId" });
    if (context.targetAgentRunCount === 0 && context.targetDispatchCount === 0) warnings.push({ code: "target_not_found", detail: "no matching agent run or dispatch evidence was found" });
  }
  if (kind === "rerun_phase") {
    if (!context.target.phaseId && !context.target.phaseKey) violations.push({ code: "missing_phase_target", detail: "rerun phase preview requires phaseId or phaseKey" });
    if ((context.target.phaseId || context.target.phaseKey) && context.targetPhaseCount === 0) violations.push({ code: "phase_not_found", detail: "no matching workflow phase was found" });
  }
  if (context.sideEffectUncertainCount > 0) warnings.push({ code: "side_effect_uncertain", detail: `${context.sideEffectUncertainCount} side-effect records are uncertain` });
  if (context.activeDispatchCount > 0 && ["pause_workflow", "stop_workflow", "rerun_phase"].includes(kind)) {
    warnings.push({ code: "active_dispatches", detail: `${context.activeDispatchCount} dispatches are queued or sent` });
  }
  return { eligible: violations.length === 0, violations, warnings };
}

export async function workflowInterventionPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const action = canonicalWorkflowAction(input.action || "workflow.pause.preview");
  const kind = workflowInterventionKind(action);
  if (kind === "unknown") throw new Error(`unsupported intervention preview action: ${action}`);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const checkedAt = nowIso();
  const workflowRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
  if (!workflowRows[0]) throw new Error(`workflow not found: ${workflowId}`);
  const workflow = workflowRows[0];
  const target = interventionTarget(input);
  const [taskColumns, dispatchColumns, phaseColumns, checkpointColumns, sideEffectColumns, agentRunColumns] = await Promise.all([
    tableColumns(paths.dbFile, "workflow_tasks"),
    tableColumns(paths.dbFile, "mixed_meeting_dispatches"),
    tableColumns(paths.dbFile, "workflow_phases"),
    tableColumns(paths.dbFile, "workflow_checkpoints"),
    tableColumns(paths.dbFile, "side_effect_ledger"),
    tableColumns(paths.dbFile, "workflow_agent_runs")
  ]);
  const taskCounts = hasAllColumns(taskColumns, ["workflow_id", "status"]) ? countByStatus(await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)}
GROUP BY status;`, { json: true })) : {};
  const dispatchCounts = hasAllColumns(dispatchColumns, ["workflow_id", "status"]) ? countByStatus(await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
GROUP BY status;`, { json: true })) : {};
  const phaseCounts = hasAllColumns(phaseColumns, ["workflow_id", "status"]) ? countByStatus(await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_phases
WHERE workflow_id=${sqlValue(workflowId)}
GROUP BY status;`, { json: true })) : {};
  const pendingHumanGates = await pendingHumanGateCount(paths, workflowId);
  const latestCheckpoint = hasAllColumns(checkpointColumns, ["workflow_id", "checkpoint_id", "status", "phase", "decision", "path", "created_at"]) ? (await sqlite(paths.dbFile, `
SELECT checkpoint_id, status, phase, decision, path, created_at
FROM workflow_checkpoints
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 1;`, { json: true }))[0] || null : null;
  const sideEffectUncertainCount = hasAllColumns(sideEffectColumns, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed')
LIMIT 1;`, { json: true }))[0]?.count || 0) : 0;
  const activeDispatchCount = statusCountTotal(dispatchCounts, ["queued", "sent", "runtime_dispatched", "running", "delivering"]);
  const phaseWhere = target.phaseId
    ? `phase_id=${sqlValue(target.phaseId)}`
    : (target.phaseKey ? `phase_key=${sqlValue(target.phaseKey)}` : "0=1");
  const targetPhaseRows = hasAllColumns(phaseColumns, ["workflow_id", "phase_id", "phase_key", "status", "ordinal", "owner_agent", "verifier_agent", "human_gate_required", "updated_at"]) ? await sqlite(paths.dbFile, `
SELECT phase_id, phase_key, status, ordinal, owner_agent, verifier_agent, human_gate_required, updated_at
FROM workflow_phases
WHERE workflow_id=${sqlValue(workflowId)}
  AND ${phaseWhere}
ORDER BY ordinal, phase_key
LIMIT 20;`, { json: true }) : [];
  const agentRunFilters = [];
  if (target.agentRunId) agentRunFilters.push(`agent_run_id=${sqlValue(target.agentRunId)}`);
  if (target.dispatchId) agentRunFilters.push(`dispatch_id=${sqlValue(target.dispatchId)}`);
  if (target.runtimeRunId) agentRunFilters.push(`runtime_run_id=${sqlValue(target.runtimeRunId)}`);
  if (target.agentId) agentRunFilters.push(`agent_id=${sqlValue(target.agentId)}`);
  if (target.runtime) agentRunFilters.push(`runtime=${sqlValue(target.runtime)}`);
  const agentRunWhere = agentRunFilters.length ? agentRunFilters.join(" AND ") : "0=1";
  const targetAgentRuns = hasAllColumns(agentRunColumns, ["workflow_id", "agent_run_id", "phase_key", "task_id", "dispatch_id", "runtime_run_id", "runtime", "agent_id", "status", "receipt_ref", "updated_at"]) ? await sqlite(paths.dbFile, `
SELECT agent_run_id, phase_key, task_id, dispatch_id, runtime_run_id, runtime, agent_id, status, receipt_ref, updated_at
FROM workflow_agent_runs
WHERE workflow_id=${sqlValue(workflowId)}
  AND ${agentRunWhere}
ORDER BY updated_at DESC
LIMIT 20;`, { json: true }) : [];
  const dispatchFilters = [];
  if (target.dispatchId) dispatchFilters.push(`dispatch_id=${sqlValue(target.dispatchId)}`);
  if (target.agentId) dispatchFilters.push(`agent_id=${sqlValue(target.agentId)}`);
  if (target.runtime) dispatchFilters.push(`runtime=${sqlValue(target.runtime)}`);
  const dispatchWhere = dispatchFilters.length ? dispatchFilters.join(" AND ") : "0=1";
  const targetDispatches = hasAllColumns(dispatchColumns, ["workflow_id", "dispatch_id", "runtime", "agent_id", "status", "attempt", "max_attempts", "updated_at", "last_error"]) ? await sqlite(paths.dbFile, `
SELECT dispatch_id, '' AS task_id, runtime, agent_id, status, attempt, max_attempts, updated_at, last_error
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
  AND ${dispatchWhere}
ORDER BY updated_at DESC
LIMIT 20;`, { json: true }) : [];
  const context = {
    target,
    taskCounts,
    dispatchCounts,
    phaseCounts,
    pendingHumanGates,
    latestCheckpoint,
    sideEffectUncertainCount,
    activeDispatchCount,
    targetPhaseCount: targetPhaseRows.length,
    targetAgentRunCount: targetAgentRuns.length,
    targetDispatchCount: targetDispatches.length
  };
  const eligibility = evaluateInterventionEligibility(kind, workflow, context, input);
  const riskTier = interventionRiskTier(kind, context);
  return {
    workflowId,
    action,
    kind,
    preview: true,
    readOnly: true,
    eligible: eligibility.eligible,
    riskTier,
    humanGateRequired: true,
    catClawAuditRequired: true,
    checkedAt,
    workflow: {
      workflowId: workflow.workflow_id,
      status: workflow.status,
      currentPhase: workflow.current_phase || "",
      currentDecision: workflow.current_decision || "",
      updatedAt: workflow.updated_at
    },
    target,
    wouldUpdateWorkflow: ["pause_workflow", "resume_workflow", "stop_workflow"].includes(kind) ? {
      status: workflowInterventionNextState(kind, workflow.status),
      currentDecision: `${kind}_requested`,
      updatedAt: checkedAt
    } : null,
    wouldCreateHumanGateRequest: true,
    wouldRequireEvidence: [
      "latest_checkpoint",
      "workflow_operations_record",
      "cat_claw_audit",
      "operator_reason",
      "rollback_or_resume_boundary"
    ],
    wouldAffect: {
      activeDispatches: activeDispatchCount,
      pendingHumanGates,
      sideEffectUncertain: sideEffectUncertainCount,
      targetPhases: targetPhaseRows.length,
      targetAgentRuns: targetAgentRuns.length,
      targetDispatches: targetDispatches.length
    },
    counts: { tasks: taskCounts, dispatches: dispatchCounts, phases: phaseCounts },
    latestCheckpoint,
    targetPhases: targetPhaseRows,
    targetAgentRuns,
    targetDispatches,
    violations: eligibility.violations,
    warnings: eligibility.warnings,
    limitations: [
      "Preview is read-only and does not update workflow state.",
      "No dispatch, runtime drain, Telegram delivery, Human Gate submission, or task reset is executed.",
      "Real pause/resume/stop/rerun controls remain disabled until transition policy and Human Gate execution paths are implemented."
    ],
    dbFile: paths.dbFile
  };
}

export async function workflowInterventionExecute(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const action = canonicalWorkflowAction(input.action || "");
  const kind = workflowInterventionKind(action);
  if (!["pause_workflow", "resume_workflow", "stop_workflow"].includes(kind)) {
    throw new Error(`unsupported intervention execution action: ${action}`);
  }
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const reason = String(input.operatorReason || input.operator_reason || input.reason || input.summary || "").trim();
  if (!reason) throw new Error("operatorReason is required for workflow intervention execution");
  const previewAction = workflowInterventionPreviewAction(kind);
  const preview = await workflowInterventionPreview(rootDir, { ...input, action: previewAction });
  if (!preview.eligible) {
    const codes = (preview.violations || []).map((item) => item.code).join(",") || "unknown";
    throw new Error(`workflow intervention not eligible: action=${action} violations=${codes}`);
  }
  const rollbackBoundary = String(input.rollbackBoundary || input.rollback_boundary || input.resumeBoundary || input.resume_boundary || input.stopCondition || input.stop_condition || preview.latestCheckpoint?.path || "").trim();
  if (!rollbackBoundary) {
    throw new Error("rollbackBoundary or latest checkpoint is required for workflow intervention execution");
  }
  const now = nowIso();
  const previousStatus = preview.workflow.status || "";
  const nextStatus = workflowInterventionNextState(kind, previousStatus);
  const currentDecision = `${kind}_executed`;
  await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET status=${sqlValue(nextStatus)},
    current_decision=${sqlValue(currentDecision)},
    updated_at=${sqlValue(now)}
WHERE workflow_id=${sqlValue(workflowId)};`);
  await appendWorkflowEvent(paths, {
    eventType: "workflow.intervention.executed",
    status: nextStatus,
    workflowId,
    traceId: input.traceId || input.trace_id || "",
    humanGateId: input.humanGateId || input.human_gate_id || "",
    actor: input.actor || input.createdBy || input.created_by || permissionDecision?.caller?.agentId || "unknown",
    sourceRuntime: input.sourceRuntime || input.source_runtime || permissionDecision?.caller?.runtime || "workflow",
    sourceAgent: input.sourceAgent || input.source_agent || permissionDecision?.caller?.agentId || "",
    previousState: previousStatus,
    nextState: nextStatus,
    idempotencyKey: input.idempotencyKey || input.idempotency_key || "",
    artifactRef: preview.latestCheckpoint?.path || "",
    payload: {
      action,
      kind,
      currentDecision,
      reason,
      rollbackBoundary,
      riskTier: preview.riskTier,
      catClawAuditId: input.catClawAuditId || input.cat_claw_audit_id || "",
      permissionPolicyOutcome: permissionDecision?.policyOutcome || "",
      warnings: preview.warnings || [],
      wouldAffect: preview.wouldAffect || {}
    },
    createdAt: now
  });
  return {
    workflowId,
    action,
    kind,
    status: "executed",
    previousStatus,
    nextStatus,
    currentDecision,
    executedAt: now,
    humanGateId: String(input.humanGateId || input.human_gate_id || "").trim(),
    catClawAuditId: String(input.catClawAuditId || input.cat_claw_audit_id || "").trim(),
    rollbackBoundary,
    riskTier: preview.riskTier,
    affected: {
      workflowRuns: 1,
      dispatches: 0,
      runtimeRuns: 0,
      outbox: 0,
      humanGateRequests: 0,
      sideEffects: 0
    },
    limitations: [
      "Only workflow_runs status/current_decision/updated_at and workflow_events were written.",
      "No task reset, dispatch retry, runtime drain, Telegram delivery, Human Gate submission, or side-effect retry was executed."
    ],
    dbFile: paths.dbFile
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

export async function workflowCheckpoint(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
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
  const jsonRelPath = await writeJsonArtifact(paths.root, paths.checkpointsDir, checkpointId, record);
  const markdownRelPath = await writeTextArtifact(paths.root, paths.checkpointsDir, checkpointId, "md", renderWorkflowCheckpointMarkdown(record));
  await sqlite(paths.dbFile, `
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES (${sqlValue(checkpointId)}, ${sqlValue(workflowId)}, ${sqlValue(record.status)}, ${sqlValue(record.phase)}, ${sqlValue(record.decision)}, ${sqlValue(record.summary)}, ${sqlValue(JSON.stringify(resumePayload))}, ${sqlValue(JSON.stringify(activeTasks))}, ${sqlValue(JSON.stringify(blockedTasks))}, ${sqlValue(JSON.stringify(artifactRefs))}, ${sqlValue(JSON.stringify(nextActions))}, ${sqlValue(JSON.stringify(contextBudget))}, ${sqlValue(markdownRelPath)}, ${sqlValue(record.createdBy)}, ${sqlValue(createdAt)})
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
VALUES (${sqlValue(checkpointId)}, NULL, ${sqlValue(workflowId)}, 'workflow_checkpoint', ${sqlValue(markdownRelPath)}, ${sqlValue(record.summary)}, ${sqlValue(record.createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
  return {
    checkpointId,
    workflowId,
    status: record.status,
    phase: record.phase,
    decision: record.decision,
    relativePath: markdownRelPath,
    jsonRelativePath: jsonRelPath,
    resumePayload,
    dbFile: paths.dbFile
  };
}

function sessionJsonObject(value, fallback = {}) {
  const parsed = parseJsonValue(value, value === undefined ? fallback : value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  return redactSensitiveForPersistence(parsed);
}

function workflowEventFromRow(row) {
  if (!row) return null;
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    status: row.status,
    workflowId: row.workflow_id || "",
    traceId: row.trace_id || "",
    taskId: row.task_id || "",
    dispatchId: row.dispatch_id || "",
    runtimeRunId: row.runtime_run_id || "",
    messageFlowId: row.message_flow_id || "",
    humanGateId: row.human_gate_id || "",
    sideEffectId: row.side_effect_id || "",
    incidentId: row.incident_id || "",
    actor: row.actor || "",
    sourceRuntime: row.source_runtime || "",
    sourceAgent: row.source_agent || "",
    previousState: row.previous_state || "",
    nextState: row.next_state || "",
    idempotencyKey: row.idempotency_key || "",
    artifactRef: row.artifact_ref || "",
    payloadHash: row.payload_hash || "",
    payload: parseJsonValue(row.payload_json, {}),
    createdAt: row.created_at
  };
}

function workflowEventPayload(input = {}) {
  return redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}));
}

function workflowEventRecordFromInput(input = {}, now = nowIso()) {
  const payload = workflowEventPayload(input);
  const eventType = String(input.eventType || input.event_type || input.type || "").trim();
  if (!eventType) throw new Error("workflow eventType is required");
  const canonicalPayloadHash = jsonHash(payload);
  const suppliedPayloadHash = String(input.payloadHash || input.payload_hash || "").trim();
  if (suppliedPayloadHash && suppliedPayloadHash !== canonicalPayloadHash) {
    throw new Error("workflow event payloadHash must match canonical redacted payload hash");
  }
  return {
    eventId: String(input.eventId || input.event_id || safeId("workflow_event")).trim(),
    eventType,
    status: String(input.status || "recorded").trim(),
    workflowId: String(input.workflowId || input.workflow_id || "").trim(),
    traceId: String(input.traceId || input.trace_id || "").trim(),
    taskId: String(input.taskId || input.task_id || "").trim(),
    dispatchId: String(input.dispatchId || input.dispatch_id || "").trim(),
    runtimeRunId: String(input.runtimeRunId || input.runtime_run_id || "").trim(),
    messageFlowId: String(input.messageFlowId || input.message_flow_id || input.flowId || input.flow_id || "").trim(),
    humanGateId: String(input.humanGateId || input.human_gate_id || "").trim(),
    sideEffectId: String(input.sideEffectId || input.side_effect_id || "").trim(),
    incidentId: String(input.incidentId || input.incident_id || "").trim(),
    actor: String(input.actor || input.createdBy || input.created_by || input.from || "").trim(),
    sourceRuntime: String(input.sourceRuntime || input.source_runtime || input.runtime || "").trim(),
    sourceAgent: String(input.sourceAgent || input.source_agent || input.agentId || input.agent_id || "").trim(),
    previousState: String(input.previousState || input.previous_state || input.fromState || input.from_state || "").trim(),
    nextState: String(input.nextState || input.next_state || input.toState || input.to_state || "").trim(),
    idempotencyKey: String(input.idempotencyKey || input.idempotency_key || "").trim(),
    artifactRef: String(input.artifactRef || input.artifact_ref || "").trim(),
    payloadHash: canonicalPayloadHash,
    payload,
    createdAt: String(input.createdAt || input.created_at || now).trim()
  };
}

const WORKFLOW_EVENT_DEDUPE_FIELDS = [
  "eventType",
  "status",
  "workflowId",
  "traceId",
  "taskId",
  "dispatchId",
  "runtimeRunId",
  "messageFlowId",
  "humanGateId",
  "sideEffectId",
  "incidentId",
  "actor",
  "sourceRuntime",
  "sourceAgent",
  "previousState",
  "nextState",
  "idempotencyKey",
  "artifactRef",
  "payloadHash"
];

function workflowEventDedupeMismatch(existing, record) {
  for (const field of WORKFLOW_EVENT_DEDUPE_FIELDS) {
    if (String(existing[field] || "") !== String(record[field] || "")) return field;
  }
  return "";
}

const WORKFLOW_VERIFICATION_RESULT_TYPES = new Set(["verifier", "refuter", "reducer", "secretary_audit", "evaluator"]);
const WORKFLOW_VERIFICATION_DECISIONS = new Set(["pass", "fail", "uncertain", "blocked", "needs_evidence", "needs_human_gate", "met", "not_met", "disputed", "side_effect_uncertain"]);

function normalizeVerificationResultType(value) {
  const text = String(value || "verifier").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return WORKFLOW_VERIFICATION_RESULT_TYPES.has(text) ? text : "verifier";
}

function normalizeVerificationDecision(value) {
  const text = String(value || "uncertain").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return WORKFLOW_VERIFICATION_DECISIONS.has(text) ? text : "uncertain";
}

function workflowVerificationRecordFromInput(input = {}, now = nowIso()) {
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const resultType = normalizeVerificationResultType(input.resultType || input.result_type || input.type || input.role);
  const decision = normalizeVerificationDecision(input.decision || input.status || input.result || input.outcome);
  const permissionDecision = input.__permissionDecision || {};
  const caller = permissionDecision.caller || workflowPermissionCaller(input);
  const trustedCaller = isWorkflowTrustedOperator(caller);
  const callerAgent = String(caller.agentId || "").trim();
  const declaredSourceAgent = String(input.sourceAgent || input.source_agent || input.agentId || input.agent_id || "").trim();
  const effectiveSourceAgent = callerAgent && (!trustedCaller || !declaredSourceAgent) ? callerAgent : declaredSourceAgent;
  const declaredVerifierAgent = String(input.verifierAgent || input.verifier_agent || (resultType === "verifier" ? input.agentId || input.agent_id || input.sourceAgent || input.source_agent || "" : "")).trim();
  const declaredRefuterAgent = String(input.refuterAgent || input.refuter_agent || (resultType === "refuter" ? input.agentId || input.agent_id || input.sourceAgent || input.source_agent || "" : "")).trim();
  const payload = redactSensitiveForPersistence(parseJsonValue(input.payload, {
    raw: input.raw || {},
    criteria: input.criteria || input.acceptanceCriteria || input.acceptance_criteria || [],
    notes: input.notes || ""
  }));
  const createdAt = String(input.createdAt || input.created_at || now).trim();
  return {
    verificationId: String(input.verificationId || input.verification_id || safeId(`verification.${resultType}`)).trim(),
    workflowId,
    phaseId: String(input.phaseId || input.phase_id || "").trim(),
    phaseKey: String(input.phaseKey || input.phase_key || input.phase || "").trim(),
    taskId: String(input.taskId || input.task_id || "").trim(),
    agentRunId: String(input.agentRunId || input.agent_run_id || "").trim(),
    dispatchId: String(input.dispatchId || input.dispatch_id || "").trim(),
    runtimeRunId: String(input.runtimeRunId || input.runtime_run_id || "").trim(),
    resultType,
    decision,
    verifierAgent: resultType === "verifier" && callerAgent && !trustedCaller ? effectiveSourceAgent : declaredVerifierAgent,
    refuterAgent: resultType === "refuter" && callerAgent && !trustedCaller ? effectiveSourceAgent : declaredRefuterAgent,
    sourceRuntime: String(input.sourceRuntime || input.source_runtime || input.runtime || "").trim(),
    sourceAgent: effectiveSourceAgent,
    confidence: String(input.confidence || "").trim(),
    riskBand: String(input.riskBand || input.risk_band || "").trim(),
    summary: redactSensitiveTextForPersistence(input.summary || input.reviewSummary || input.review_summary || input.text || "").trim(),
    findings: redactSensitiveForPersistence(toList(input.findings || input.finding)),
    recommendations: redactSensitiveForPersistence(toList(input.recommendations || input.recommendation || input.nextActions || input.next_actions)),
    evidenceRefs: redactSensitiveForPersistence(toList(input.evidenceRefs || input.evidence_refs || input.evidencePaths || input.evidence_paths)),
    artifactRefs: redactSensitiveForPersistence(toList(input.artifactRefs || input.artifact_refs || input.artifacts)),
    receiptRefs: redactSensitiveForPersistence(toList(input.receiptRefs || input.receipt_refs || input.receipts)),
    payload,
    payloadHash: jsonHash(payload),
    createdBy: callerAgent || String(input.createdBy || input.created_by || input.actor || input.from || input.sourceAgent || input.source_agent || "").trim() || "unknown",
    createdAt
  };
}

export async function workflowVerificationRecord(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const record = workflowVerificationRecordFromInput({ ...input, __permissionDecision: permissionDecision });
  const exists = await sqlite(paths.dbFile, `SELECT verification_id FROM workflow_verification_results WHERE verification_id=${sqlValue(record.verificationId)} LIMIT 1;`, { json: true });
  if (exists[0]) throw new Error(`workflow verification result already exists: ${record.verificationId}`);
  await sqlite(paths.dbFile, `
INSERT INTO workflow_verification_results(verification_id, workflow_id, phase_id, phase_key, task_id, agent_run_id, dispatch_id, runtime_run_id, result_type, decision, verifier_agent, refuter_agent, source_runtime, source_agent, confidence, risk_band, summary, findings_json, recommendations_json, evidence_refs_json, artifact_refs_json, receipt_refs_json, payload_hash, payload_json, created_by, created_at)
VALUES (${sqlValue(record.verificationId)}, ${sqlValue(record.workflowId)}, ${sqlValue(record.phaseId)}, ${sqlValue(record.phaseKey)}, ${sqlValue(record.taskId)}, ${sqlValue(record.agentRunId)}, ${sqlValue(record.dispatchId)}, ${sqlValue(record.runtimeRunId)}, ${sqlValue(record.resultType)}, ${sqlValue(record.decision)}, ${sqlValue(record.verifierAgent)}, ${sqlValue(record.refuterAgent)}, ${sqlValue(record.sourceRuntime)}, ${sqlValue(record.sourceAgent)}, ${sqlValue(record.confidence)}, ${sqlValue(record.riskBand)}, ${sqlValue(record.summary)}, ${sqlValue(JSON.stringify(record.findings))}, ${sqlValue(JSON.stringify(record.recommendations))}, ${sqlValue(JSON.stringify(record.evidenceRefs))}, ${sqlValue(JSON.stringify(record.artifactRefs))}, ${sqlValue(JSON.stringify(record.receiptRefs))}, ${sqlValue(record.payloadHash)}, ${sqlValue(JSON.stringify(record.payload))}, ${sqlValue(record.createdBy)}, ${sqlValue(record.createdAt)});`);
  return {
    verificationId: record.verificationId,
    workflowId: record.workflowId,
    resultType: record.resultType,
    decision: record.decision,
    phaseKey: record.phaseKey,
    taskId: record.taskId,
    agentRunId: record.agentRunId,
    payloadHash: record.payloadHash,
    createdAt: record.createdAt,
    dbFile: paths.dbFile
  };
}

export async function workflowVerificationList(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const filters = [];
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (workflowId) filters.push(`workflow_id=${sqlValue(workflowId)}`);
  const phaseKey = String(input.phaseKey || input.phase_key || "").trim();
  if (phaseKey) filters.push(`phase_key=${sqlValue(phaseKey)}`);
  const taskId = String(input.taskId || input.task_id || "").trim();
  if (taskId) filters.push(`task_id=${sqlValue(taskId)}`);
  const resultType = String(input.resultType || input.result_type || "").trim();
  if (resultType) filters.push(`result_type=${sqlValue(resultType)}`);
  const decision = String(input.decision || "").trim();
  if (decision) filters.push(`decision=${sqlValue(decision)}`);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const requestedLimit = Number(input.limit || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, Math.trunc(requestedLimit))) : 100;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_verification_results
${where}
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
  return { count: rows.length, results: rows, dbFile: paths.dbFile };
}

function workflowEvaluatorScopedWhere(workflowId, phaseKey = "", phaseColumn = "phase_key") {
  const filters = [`workflow_id=${sqlValue(workflowId)}`];
  if (phaseKey) filters.push(`${phaseColumn}=${sqlValue(phaseKey)}`);
  return filters.join(" AND ");
}

function workflowEvaluatorDecision(snapshot) {
  const taskCounts = snapshot.taskCounts || {};
  const dispatchCounts = snapshot.dispatchCounts || {};
  const runtimeCounts = snapshot.runtimeCounts || {};
  const verificationCounts = snapshot.verificationCounts || {};
  const failedVerification = Number(verificationCounts.fail || 0) + Number(verificationCounts.not_met || 0) + Number(verificationCounts.disputed || 0);
  const evidenceNeeds = Number(verificationCounts.needs_evidence || 0) + Number(verificationCounts.uncertain || 0);
  const passedVerification = Number(verificationCounts.pass || 0) + Number(verificationCounts.met || 0);
  if (Number(snapshot.sideEffectUncertainCount || 0) > 0) return "side_effect_uncertain";
  if (Number(snapshot.pendingHumanGates || 0) > 0 || Number(verificationCounts.needs_human_gate || 0) > 0) return "needs_human_gate";
  if (Number(snapshot.activeIncidentCount || 0) > 0 || Number(taskCounts.blocked || 0) > 0 || Number(verificationCounts.blocked || 0) > 0) return "blocked";
  if (Number(taskCounts.failed || 0) > 0 || Number(dispatchCounts.failed || 0) > 0 || Number(runtimeCounts.failed || 0) > 0 || failedVerification > 0) return "not_met";
  if (Number(taskCounts.pending || 0) > 0 || Number(taskCounts.in_progress || 0) > 0 || Number(dispatchCounts.queued || 0) > 0 || Number(dispatchCounts.sent || 0) > 0) return "needs_evidence";
  if (evidenceNeeds > 0) return "needs_evidence";
  if (Number(snapshot.evidenceCount || 0) <= 0) return "needs_evidence";
  if (Number(snapshot.taskTotal || 0) > 0 && Number(taskCounts.done || 0) < Number(snapshot.taskTotal || 0)) return "needs_evidence";
  if (passedVerification > 0 || Number(snapshot.taskTotal || 0) > 0) return "met";
  return "needs_evidence";
}

function workflowEvaluatorSummary(decision, snapshot) {
  const scope = snapshot.phaseKey ? `phase ${snapshot.phaseKey}` : "workflow";
  const bits = [
    `${scope} evaluator decision: ${decision}`,
    `tasks=${snapshot.taskTotal}`,
    `evidence=${snapshot.evidenceCount}`,
    `verification=${snapshot.verificationTotal}`,
    `pendingHumanGates=${snapshot.pendingHumanGates}`,
    `sideEffectUncertain=${snapshot.sideEffectUncertainCount}`,
    `activeIncidents=${snapshot.activeIncidentCount}`
  ];
  return bits.join("; ");
}

function workflowEvaluatorFindings(decision, snapshot) {
  const findings = [];
  if (snapshot.acceptanceCriteria) findings.push(`acceptance criteria present: ${snapshot.acceptanceCriteria}`);
  if (snapshot.planSpecPresent) findings.push("Plan Spec v2 payload is present.");
  if (Number(snapshot.taskTotal || 0) > 0) findings.push(`task counts: ${JSON.stringify(snapshot.taskCounts)}`);
  if (Number(snapshot.evidenceCount || 0) > 0) findings.push(`evidence count: ${snapshot.evidenceCount}`);
  if (Number(snapshot.verificationTotal || 0) > 0) findings.push(`verification decisions: ${JSON.stringify(snapshot.verificationCounts)}`);
  if (Number(snapshot.pendingHumanGates || 0) > 0) findings.push(`pending Human Gate count: ${snapshot.pendingHumanGates}`);
  if (Number(snapshot.sideEffectUncertainCount || 0) > 0) findings.push(`side-effect uncertain count: ${snapshot.sideEffectUncertainCount}`);
  if (Number(snapshot.activeIncidentCount || 0) > 0) findings.push(`active incident count: ${snapshot.activeIncidentCount}`);
  if (!findings.length) findings.push(`evaluator produced ${decision} with no additional evidence.`);
  return findings;
}

function workflowEvaluatorRecommendations(decision) {
  if (decision === "met") return ["Prepare Cat Claw secretary audit before any Human Gate closeout."];
  if (decision === "needs_human_gate") return ["Keep workflow paused at the Human Gate boundary until Flashcat original words are captured."];
  if (decision === "side_effect_uncertain") return ["Do not retry side effects automatically; prepare uncertainty evidence for human review."];
  if (decision === "blocked") return ["Create or update an incident/evidence item before further workflow progress."];
  if (decision === "not_met") return ["Route the failed acceptance evidence back to the responsible phase for repair."];
  return ["Collect missing artifacts, receipts, verifier/refuter outputs, or readiness evidence before approval."];
}

export async function workflowEvaluate(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const phaseKey = String(input.phaseKey || input.phase_key || input.phase || "").trim();
  const workflowRows = await sqlite(paths.dbFile, `
SELECT workflow_id, status, summary, objective, acceptance_criteria, current_phase, current_decision, payload_json, updated_at
FROM workflow_runs
WHERE workflow_id=${sqlValue(workflowId)}
LIMIT 1;`, { json: true });
  const workflow = workflowRows[0];
  if (!workflow) throw new Error(`workflow not found: ${workflowId}`);
  const [
    taskColumns,
    dispatchColumns,
    runtimeColumns,
    agentRunColumns,
    artifactColumns,
    sideEffectColumns,
    incidentColumns,
    verificationColumns
  ] = await Promise.all([
    tableColumns(paths.dbFile, "workflow_tasks"),
    tableColumns(paths.dbFile, "mixed_meeting_dispatches"),
    tableColumns(paths.dbFile, "runtime_runs"),
    tableColumns(paths.dbFile, "workflow_agent_runs"),
    tableColumns(paths.dbFile, "artifact_index"),
    tableColumns(paths.dbFile, "side_effect_ledger"),
    tableColumns(paths.dbFile, "incident_states"),
    tableColumns(paths.dbFile, "workflow_verification_results")
  ]);
  const taskWhere = workflowEvaluatorScopedWhere(workflowId, phaseKey, "phase");
  const phaseKeyWhere = workflowEvaluatorScopedWhere(workflowId, phaseKey, "phase_key");
  const workflowWhere = `workflow_id=${sqlValue(workflowId)}`;
  const taskScopedWhere = phaseKey && taskColumns.has("phase") ? taskWhere : workflowWhere;
  const agentRunScopedWhere = phaseKey && agentRunColumns.has("phase_key") ? phaseKeyWhere : workflowWhere;
  const verificationScopedWhere = phaseKey && verificationColumns.has("phase_key") ? phaseKeyWhere : workflowWhere;
  const taskRows = hasAllColumns(taskColumns, ["workflow_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_tasks
WHERE ${taskScopedWhere}
GROUP BY status;`, { json: true }) : [];
  const dispatchRows = hasAllColumns(dispatchColumns, ["workflow_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE ${workflowWhere}
GROUP BY status;`, { json: true }) : [];
  const runtimeRows = hasAllColumns(runtimeColumns, ["workflow_id", "status"]) ? await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM runtime_runs
WHERE ${workflowWhere}
GROUP BY status;`, { json: true }) : [];
  const agentRunReceiptCount = hasAllColumns(agentRunColumns, ["workflow_id", "receipt_ref"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_agent_runs
WHERE ${agentRunScopedWhere}
  AND receipt_ref IS NOT NULL
  AND receipt_ref != '';`, { json: true }))[0]?.count || 0) : 0;
  const runtimeReceiptCount = hasAllColumns(runtimeColumns, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM runtime_runs
WHERE ${workflowWhere}
  AND status IN ('acked','completed','success');`, { json: true }))[0]?.count || 0) : 0;
  const artifactRows = hasAllColumns(artifactColumns, ["workflow_id", "artifact_id", "path", "created_at"]) ? await sqlite(paths.dbFile, `
SELECT artifact_id, path
FROM artifact_index
WHERE ${workflowWhere}
ORDER BY created_at DESC
LIMIT 20;`, { json: true }) : [];
  const verificationRows = hasAllColumns(verificationColumns, ["workflow_id", "decision", "result_type"]) ? await sqlite(paths.dbFile, `
SELECT verification_id, result_type, decision, payload_hash, created_at
FROM workflow_verification_results
WHERE ${verificationScopedWhere}
  AND result_type != 'evaluator'
ORDER BY created_at DESC
LIMIT 50;`, { json: true }) : [];
  const verificationCounts = {};
  const verificationTypeCounts = {};
  for (const row of verificationRows) {
    verificationCounts[row.decision || "unknown"] = (verificationCounts[row.decision || "unknown"] || 0) + 1;
    verificationTypeCounts[row.result_type || "unknown"] = (verificationTypeCounts[row.result_type || "unknown"] || 0) + 1;
  }
  const sideEffectUncertainCount = hasAllColumns(sideEffectColumns, ["workflow_id", "status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM side_effect_ledger
WHERE ${workflowWhere}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed');`, { json: true }))[0]?.count || 0) : 0;
  const activeIncidentCount = hasAllColumns(incidentColumns, ["status"]) ? Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM incident_states
WHERE status IN ('active','mitigating','monitoring')
  AND ${workflowPayloadSqlWhere(workflowId, { parentColumn: "" })};`, { json: true }))[0]?.count || 0) : 0;
  const pendingHumanGates = await pendingHumanGateCount(paths, workflowId);
  const workflowPayload = parseJsonValue(workflow.payload_json, {});
  const acceptanceCriteria = String(input.acceptanceCriteria || input.acceptance_criteria || workflow.acceptance_criteria || workflowPayload?.spec?.objective?.acceptanceCriteria || workflowPayload?.planSpecV2?.objective?.acceptanceCriteria || "").trim();
  const snapshot = {
    evaluatorVersion: "workflow_evaluator_v1",
    workflowId,
    phaseKey,
    workflowStatus: workflow.status || "",
    workflowSummary: workflow.summary || "",
    objective: workflow.objective || "",
    acceptanceCriteria,
    planSpecPresent: Boolean(workflowPayload.planSpecV2 || workflowPayload.spec?.planSpecV2 || workflowPayload.spec?.phaseGraph),
    taskCounts: countByStatus(taskRows),
    taskTotal: taskRows.reduce((total, row) => total + Number(row.count || 0), 0),
    dispatchCounts: countByStatus(dispatchRows),
    runtimeCounts: countByStatus(runtimeRows),
    receiptCount: agentRunReceiptCount + runtimeReceiptCount,
    artifactCount: artifactRows.length,
    evidenceCount: artifactRows.length + agentRunReceiptCount + runtimeReceiptCount + verificationRows.length,
    verificationCounts,
    verificationTypeCounts,
    verificationTotal: verificationRows.length,
    pendingHumanGates,
    sideEffectUncertainCount,
    activeIncidentCount,
    evaluatedAt: nowIso()
  };
  const decision = normalizeVerificationDecision(input.decision || workflowEvaluatorDecision(snapshot));
  return workflowVerificationRecord(rootDir, {
    ...input,
    verificationId: input.verificationId || input.verification_id || safeId(`evaluation.${workflowId}${phaseKey ? `.${phaseKey}` : ""}`),
    workflowId,
    phaseKey,
    resultType: "evaluator",
    decision,
    sourceAgent: input.sourceAgent || input.source_agent || input.evaluatorAgent || input.evaluator_agent || input.callerAgent || input.caller_agent || "",
    sourceRuntime: input.sourceRuntime || input.source_runtime || input.callerRuntime || input.caller_runtime || "",
    confidence: input.confidence || (decision === "met" ? "medium" : "low"),
    riskBand: input.riskBand || input.risk_band || (["met", "needs_evidence"].includes(decision) ? "medium" : "high"),
    summary: input.summary || workflowEvaluatorSummary(decision, snapshot),
    findings: input.findings || workflowEvaluatorFindings(decision, snapshot),
    recommendations: input.recommendations || workflowEvaluatorRecommendations(decision),
    artifactRefs: input.artifactRefs || input.artifact_refs || artifactRows.map((row) => row.path || row.artifact_id).filter(Boolean),
    receiptRefs: input.receiptRefs || input.receipt_refs || verificationRows.map((row) => row.verification_id || row.payload_hash).filter(Boolean).slice(0, 20),
    payload: {
      evaluator: "workflow_evaluator_v1",
      snapshot,
      latestVerificationResults: verificationRows.slice(0, 10)
    }
  }, permissionDecision);
}

export async function workflowEventAppend(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  return appendWorkflowEvent(paths, input);
}

async function appendWorkflowEvent(paths, input = {}) {
  const record = workflowEventRecordFromInput(input);
  const duplicateFilters = [`event_id=${sqlValue(record.eventId)}`];
  if (record.idempotencyKey) duplicateFilters.push(`idempotency_key=${sqlValue(record.idempotencyKey)}`);
  const existingRows = await sqlite(paths.dbFile, `
SELECT * FROM workflow_events
WHERE ${duplicateFilters.join(" OR ")}
ORDER BY created_at DESC
LIMIT 5;`, { json: true });
  if (existingRows.length) {
    const byEventId = existingRows.find((row) => row.event_id === record.eventId);
    const byIdempotency = record.idempotencyKey ? existingRows.find((row) => row.idempotency_key === record.idempotencyKey) : null;
    if (byEventId && byIdempotency && byEventId.event_id !== byIdempotency.event_id) {
      throw new Error(`workflow event idempotency conflict: eventId ${record.eventId} and idempotencyKey ${record.idempotencyKey} point to different events`);
    }
    const existing = workflowEventFromRow(byEventId || byIdempotency || existingRows[0]);
    const sameEventId = existing.eventId === record.eventId;
    const sameIdempotency = record.idempotencyKey && existing.idempotencyKey === record.idempotencyKey;
    const mismatch = workflowEventDedupeMismatch(existing, record);
    if ((sameEventId || sameIdempotency) && !mismatch) {
      return { ...existing, deduped: true, dbFile: paths.dbFile };
    }
    throw new Error(`workflow event idempotency conflict: ${sameEventId ? record.eventId : record.idempotencyKey}${mismatch ? ` field=${mismatch}` : ""}`);
  }
  await sqlite(paths.dbFile, `
INSERT INTO workflow_events(event_id, event_type, status, workflow_id, trace_id, task_id, dispatch_id, runtime_run_id, message_flow_id, human_gate_id, side_effect_id, incident_id, actor, source_runtime, source_agent, previous_state, next_state, idempotency_key, artifact_ref, payload_hash, payload_json, created_at)
VALUES (${sqlValue(record.eventId)}, ${sqlValue(record.eventType)}, ${sqlValue(record.status)}, ${sqlValue(record.workflowId)}, ${sqlValue(record.traceId)}, ${sqlValue(record.taskId)}, ${sqlValue(record.dispatchId)}, ${sqlValue(record.runtimeRunId)}, ${sqlValue(record.messageFlowId)}, ${sqlValue(record.humanGateId)}, ${sqlValue(record.sideEffectId)}, ${sqlValue(record.incidentId)}, ${sqlValue(record.actor)}, ${sqlValue(record.sourceRuntime)}, ${sqlValue(record.sourceAgent)}, ${sqlValue(record.previousState)}, ${sqlValue(record.nextState)}, ${sqlValue(record.idempotencyKey)}, ${sqlValue(record.artifactRef)}, ${sqlValue(record.payloadHash)}, ${sqlValue(JSON.stringify(record.payload))}, ${sqlValue(record.createdAt)});`);
  return { ...record, dbFile: paths.dbFile };
}

function workflowEventWhere(input = {}) {
  const filters = [];
  const fieldMap = [
    ["workflow_id", input.workflowId || input.workflow_id],
    ["trace_id", input.traceId || input.trace_id],
    ["task_id", input.taskId || input.task_id],
    ["dispatch_id", input.dispatchId || input.dispatch_id],
    ["runtime_run_id", input.runtimeRunId || input.runtime_run_id],
    ["message_flow_id", input.messageFlowId || input.message_flow_id || input.flowId || input.flow_id],
    ["human_gate_id", input.humanGateId || input.human_gate_id],
    ["side_effect_id", input.sideEffectId || input.side_effect_id],
    ["incident_id", input.incidentId || input.incident_id],
    ["idempotency_key", input.idempotencyKey || input.idempotency_key],
    ["status", input.status]
  ];
  for (const [column, value] of fieldMap) {
    const text = String(value || "").trim();
    if (text) filters.push(`${column}=${sqlValue(text)}`);
  }
  const eventTypes = toList(input.eventTypes || input.event_types || input.eventType || input.event_type || input.type);
  if (eventTypes.length === 1) filters.push(`event_type=${sqlValue(eventTypes[0])}`);
  if (eventTypes.length > 1) filters.push(`event_type IN (${eventTypes.map(sqlValue).join(", ")})`);
  const since = String(input.since || input.createdAfter || input.created_after || "").trim();
  if (since) filters.push(`created_at >= ${sqlValue(since)}`);
  const until = String(input.until || input.createdBefore || input.created_before || "").trim();
  if (until) filters.push(`created_at <= ${sqlValue(until)}`);
  return filters.length ? `WHERE ${filters.join(" AND ")}` : "";
}

export async function workflowEventList(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const requestedLimit = Number(input.limit || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit))) : 100;
  const order = String(input.order || input.sort || "").toLowerCase() === "asc" ? "ASC" : "DESC";
  const where = workflowEventWhere(input);
  const rows = await sqlite(paths.dbFile, `
SELECT * FROM workflow_events
${where}
ORDER BY created_at ${order}, event_id ${order}
LIMIT ${limit};`, { json: true });
  return { count: rows.length, events: rows.map(workflowEventFromRow), dbFile: paths.dbFile };
}

export async function workflowEventTimeline(rootDir, input = {}) {
  return workflowEventList(rootDir, { ...input, order: "asc" });
}

function sessionJsonArray(value) {
  const parsed = parseJsonValue(value, value || []);
  if (Array.isArray(parsed)) return redactSensitiveForPersistence(parsed);
  return toList(parsed);
}

function requireWorkflowSessionPackStatus(value, fallback = "active") {
  const status = String(value || fallback).trim();
  if (!WORKFLOW_SESSION_PACK_STATUSES.has(status)) throw new Error(`unknown workflow session pack status: ${status}`);
  return status;
}

function requireWorkflowSessionRunStatus(value, fallback = "running") {
  const status = String(value || fallback).trim();
  if (!WORKFLOW_SESSION_RUN_STATUSES.has(status)) throw new Error(`unknown workflow session run status: ${status}`);
  return status;
}

function isTerminalWorkflowSessionRunStatus(status) {
  return ["completed", "failed", "cancelled"].includes(status);
}

function sessionPackHash(record) {
  return jsonHash({
    sessionId: record.sessionId,
    status: record.status,
    ownerAgent: record.ownerAgent,
    taskType: record.taskType,
    runtimeTarget: record.runtimeTarget,
    purpose: record.purpose,
    systemBrief: record.systemBrief,
    workingContext: record.workingContext,
    toolPolicy: record.toolPolicy,
    inputSchema: record.inputSchema,
    outputSchema: record.outputSchema,
    evidenceRefs: record.evidenceRefs,
    checkpointRefs: record.checkpointRefs,
    resourceBudget: record.resourceBudget,
    metadata: record.metadata
  });
}

function sessionPackFromRow(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    version: Number(row.version || 1),
    status: row.status,
    ownerAgent: row.owner_agent,
    taskType: row.task_type,
    runtimeTarget: row.runtime_target,
    purpose: row.purpose,
    systemBrief: row.system_brief || "",
    workingContext: parseJsonValue(row.working_context_json, {}),
    toolPolicy: parseJsonValue(row.tool_policy_json, {}),
    inputSchema: parseJsonValue(row.input_schema_json, {}),
    outputSchema: parseJsonValue(row.output_schema_json, {}),
    evidenceRefs: parseJsonValue(row.evidence_refs_json, []),
    checkpointRefs: parseJsonValue(row.checkpoint_refs_json, []),
    resourceBudget: parseJsonValue(row.resource_budget_json, {}),
    metadata: parseJsonValue(row.metadata_json, {}),
    packHash: row.pack_hash,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sessionRunFromRow(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    packVersion: Number(row.pack_version || 1),
    workflowId: row.workflow_id || "",
    taskId: row.task_id || "",
    dispatchId: row.dispatch_id || "",
    workerId: row.worker_id || "",
    status: row.status,
    input: parseJsonValue(row.input_json, {}),
    workerInput: parseJsonValue(row.worker_input_json, {}),
    output: parseJsonValue(row.output_json, {}),
    receiptRef: row.receipt_ref || "",
    error: row.error || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function workerInputFromSessionPack(pack, inputPayload = {}, context = {}) {
  return {
    schemaVersion: 1,
    objectType: "workflow_session_worker_input",
    sessionId: pack.sessionId,
    sessionVersion: pack.version,
    packHash: pack.packHash,
    purpose: pack.purpose,
    ownerAgent: pack.ownerAgent,
    taskType: pack.taskType,
    runtimeTarget: pack.runtimeTarget,
    systemBrief: pack.systemBrief,
    workingContext: pack.workingContext,
    toolPolicy: pack.toolPolicy,
    inputSchema: pack.inputSchema,
    outputSchema: pack.outputSchema,
    evidenceRefs: pack.evidenceRefs,
    checkpointRefs: pack.checkpointRefs,
    resourceBudget: pack.resourceBudget,
    input: inputPayload,
    context,
    instructions: {
      loadOnlyReferencedArtifacts: true,
      doNotInferMissingHumanApproval: true,
      writeStructuredOutputOnly: Object.keys(pack.outputSchema || {}).length > 0
    }
  };
}

export async function workflowSessionPackUpsert(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const sessionId = String(input.sessionId || input.session_id || safeId("session-pack")).trim();
  const existingRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(sessionId)} LIMIT 1;`, { json: true });
  const existing = existingRows[0] || null;
  const requestedVersion = numberOrNull(input.version);
  const version = requestedVersion !== null && requestedVersion > 0
    ? Math.trunc(requestedVersion)
    : (existing ? Number(existing.version || 1) : 1);
  const status = requireWorkflowSessionPackStatus(input.status || existing?.status || "active");
  const ownerAgent = normalizeAgentId(input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || existing?.owner_agent || "main");
  const taskType = String(input.taskType || input.task_type || input.type || existing?.task_type || "task").trim();
  const runtimeTarget = String(input.runtimeTarget || input.runtime_target || input.runtime || existing?.runtime_target || "hermers").trim();
  const purpose = String(input.purpose || input.summary || input.text || existing?.purpose || "").trim();
  if (!purpose) throw new Error("session pack purpose is required");
  const record = {
    sessionId,
    version,
    status,
    ownerAgent,
    taskType,
    runtimeTarget,
    purpose,
    systemBrief: String(input.systemBrief || input.system_brief || existing?.system_brief || "").trim(),
    workingContext: input.workingContext !== undefined || input.working_context !== undefined
      ? sessionJsonObject(input.workingContext ?? input.working_context)
      : parseJsonValue(existing?.working_context_json, {}),
    toolPolicy: input.toolPolicy !== undefined || input.tool_policy !== undefined
      ? sessionJsonObject(input.toolPolicy ?? input.tool_policy)
      : parseJsonValue(existing?.tool_policy_json, {}),
    inputSchema: input.inputSchema !== undefined || input.input_schema !== undefined
      ? sessionJsonObject(input.inputSchema ?? input.input_schema)
      : parseJsonValue(existing?.input_schema_json, {}),
    outputSchema: input.outputSchema !== undefined || input.output_schema !== undefined
      ? sessionJsonObject(input.outputSchema ?? input.output_schema)
      : parseJsonValue(existing?.output_schema_json, {}),
    evidenceRefs: input.evidenceRefs !== undefined || input.evidence_refs !== undefined
      ? sessionJsonArray(input.evidenceRefs ?? input.evidence_refs)
      : parseJsonValue(existing?.evidence_refs_json, []),
    checkpointRefs: input.checkpointRefs !== undefined || input.checkpoint_refs !== undefined
      ? sessionJsonArray(input.checkpointRefs ?? input.checkpoint_refs)
      : parseJsonValue(existing?.checkpoint_refs_json, []),
    resourceBudget: input.resourceBudget !== undefined || input.resource_budget !== undefined
      ? sessionJsonObject(input.resourceBudget ?? input.resource_budget)
      : parseJsonValue(existing?.resource_budget_json, {}),
    metadata: input.metadata !== undefined
      ? sessionJsonObject(input.metadata)
      : parseJsonValue(existing?.metadata_json, {}),
    createdBy: input.createdBy || input.created_by || input.from || existing?.created_by || "main",
    createdAt: existing?.created_at || now,
    updatedAt: now
  };
  record.packHash = sessionPackHash(record);
  if (existing && requestedVersion === null && record.packHash === existing.pack_hash) {
    return { ...sessionPackFromRow(existing), deduped: true, dbFile: paths.dbFile };
  }
  if (existing && requestedVersion === null) record.version = Number(existing.version || 1) + 1;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_session_packs(session_id, version, status, owner_agent, task_type, runtime_target, purpose, system_brief, working_context_json, tool_policy_json, input_schema_json, output_schema_json, evidence_refs_json, checkpoint_refs_json, resource_budget_json, metadata_json, pack_hash, created_by, created_at, updated_at)
VALUES (${sqlValue(record.sessionId)}, ${sqlValue(record.version)}, ${sqlValue(record.status)}, ${sqlValue(record.ownerAgent)}, ${sqlValue(record.taskType)}, ${sqlValue(record.runtimeTarget)}, ${sqlValue(record.purpose)}, ${sqlValue(record.systemBrief)}, ${sqlValue(JSON.stringify(record.workingContext))}, ${sqlValue(JSON.stringify(record.toolPolicy))}, ${sqlValue(JSON.stringify(record.inputSchema))}, ${sqlValue(JSON.stringify(record.outputSchema))}, ${sqlValue(JSON.stringify(record.evidenceRefs))}, ${sqlValue(JSON.stringify(record.checkpointRefs))}, ${sqlValue(JSON.stringify(record.resourceBudget))}, ${sqlValue(JSON.stringify(record.metadata))}, ${sqlValue(record.packHash)}, ${sqlValue(record.createdBy)}, ${sqlValue(record.createdAt)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(session_id) DO UPDATE SET
  version=excluded.version,
  status=excluded.status,
  owner_agent=excluded.owner_agent,
  task_type=excluded.task_type,
  runtime_target=excluded.runtime_target,
  purpose=excluded.purpose,
  system_brief=excluded.system_brief,
  working_context_json=excluded.working_context_json,
  tool_policy_json=excluded.tool_policy_json,
  input_schema_json=excluded.input_schema_json,
  output_schema_json=excluded.output_schema_json,
  evidence_refs_json=excluded.evidence_refs_json,
  checkpoint_refs_json=excluded.checkpoint_refs_json,
  resource_budget_json=excluded.resource_budget_json,
  metadata_json=excluded.metadata_json,
  pack_hash=excluded.pack_hash,
  updated_at=excluded.updated_at;`);
  return { ...record, dbFile: paths.dbFile };
}

export async function workflowSessionPackGet(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const sessionId = String(input.sessionId || input.session_id || "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(sessionId)} LIMIT 1;`, { json: true });
  const pack = sessionPackFromRow(rows[0]);
  if (!pack) throw new Error(`workflow session pack not found: ${sessionId}`);
  return { ...pack, workerInputTemplate: workerInputFromSessionPack(pack), dbFile: paths.dbFile };
}

export async function workflowSessionPackList(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const filters = [];
  if (input.status) filters.push(`status=${sqlValue(requireWorkflowSessionPackStatus(input.status))}`);
  if (input.ownerAgent || input.owner_agent) filters.push(`owner_agent=${sqlValue(normalizeAgentId(input.ownerAgent || input.owner_agent))}`);
  if (input.taskType || input.task_type) filters.push(`task_type=${sqlValue(input.taskType || input.task_type)}`);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const requestedLimit = Number(input.limit || 100);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(500, requestedLimit)) : 100;
  const rows = await sqlite(paths.dbFile, `
SELECT * FROM workflow_session_packs
${where}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true });
  return { count: rows.length, packs: rows.map(sessionPackFromRow), dbFile: paths.dbFile };
}

export async function workflowSessionRunStart(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const sessionId = String(input.sessionId || input.session_id || "").trim();
  if (!sessionId) throw new Error("sessionId is required");
  const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_packs WHERE session_id=${sqlValue(sessionId)} LIMIT 1;`, { json: true });
  const pack = sessionPackFromRow(rows[0]);
  if (!pack) throw new Error(`workflow session pack not found: ${sessionId}`);
  if (!["active", "draft"].includes(pack.status)) throw new Error(`workflow session pack is not runnable: ${pack.status}`);
  const runId = String(input.runId || input.run_id || safeId("session-run")).trim();
  const status = requireWorkflowSessionRunStatus(input.status || "running");
  const inputPayload = sessionJsonObject(input.input ?? input.payload ?? {});
  const context = {
    workflowId: String(input.workflowId || input.workflow_id || "").trim(),
    taskId: String(input.taskId || input.task_id || "").trim(),
    traceId: String(input.traceId || input.trace_id || "").trim(),
    dispatchId: String(input.dispatchId || input.dispatch_id || "").trim()
  };
  const workerId = String(input.workerId || input.worker_id || "").trim();
  const existingRunRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
  if (existingRunRows[0]) {
    const existingRun = sessionRunFromRow(existingRunRows[0]);
    const conflicts = [];
    if (existingRun.sessionId !== sessionId) conflicts.push("sessionId");
    if ((input.status || input.status === "") && existingRun.status !== status) conflicts.push("status");
    if (context.workflowId && existingRun.workflowId !== context.workflowId) conflicts.push("workflowId");
    if (context.taskId && existingRun.taskId !== context.taskId) conflicts.push("taskId");
    if (context.dispatchId && existingRun.dispatchId && existingRun.dispatchId !== context.dispatchId) conflicts.push("dispatchId");
    if (workerId && existingRun.workerId !== workerId) conflicts.push("workerId");
    if ((input.input !== undefined || input.payload !== undefined) && jsonHash(existingRun.input) !== jsonHash(inputPayload)) conflicts.push("input");
    if (conflicts.length) throw new Error(`workflow session run id conflict: ${runId} fields=${conflicts.join(",")}`);
    const resolvedDispatchId = existingRun.dispatchId || context.dispatchId;
    if (resolvedDispatchId && !existingRun.dispatchId) {
      await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET dispatch_id=${sqlValue(resolvedDispatchId)}, updated_at=${sqlValue(now)}
WHERE run_id=${sqlValue(runId)}
  AND (dispatch_id IS NULL OR dispatch_id='');`);
    }
    const phaseInfo = await workflowTaskPhaseInfo(paths, existingRun.workflowId || context.workflowId, existingRun.taskId || context.taskId);
    await upsertWorkflowAgentRun(paths, {
      agentRunId: `session.${runId}`,
      workflowId: existingRun.workflowId || context.workflowId,
      phaseId: phaseInfo.phaseId,
      phaseKey: phaseInfo.phaseKey,
      taskId: existingRun.taskId || context.taskId,
      dispatchId: resolvedDispatchId,
      sessionRunId: runId,
      runtime: pack.runtimeTarget || "session_pack",
      agentId: existingRun.workerId || workerId || pack.ownerAgent || "",
      status: existingRun.status,
      attempt: 0,
      inputHash: jsonHash(existingRun.input),
      outputHash: jsonHash(existingRun.output),
      receiptRef: existingRun.receiptRef,
      error: existingRun.error,
      payload: { source: "workflow_session_runs", sessionId, packVersion: existingRun.packVersion, dedupeBackfill: true },
      startedAt: existingRun.startedAt,
      completedAt: existingRun.completedAt,
      updatedAt: now
    });
    return { ...existingRun, dispatchId: resolvedDispatchId, deduped: true, dbFile: paths.dbFile };
  }
  const workerInput = workerInputFromSessionPack(pack, inputPayload, context);
  await sqlite(paths.dbFile, `
INSERT INTO workflow_session_runs(run_id, session_id, pack_version, workflow_id, task_id, dispatch_id, worker_id, status, input_json, worker_input_json, output_json, receipt_ref, error, started_at, completed_at, created_at, updated_at)
VALUES (${sqlValue(runId)}, ${sqlValue(sessionId)}, ${sqlValue(pack.version)}, ${sqlValue(context.workflowId)}, ${sqlValue(context.taskId)}, ${sqlValue(context.dispatchId)}, ${sqlValue(workerId)}, ${sqlValue(status)}, ${sqlValue(JSON.stringify(inputPayload))}, ${sqlValue(JSON.stringify(workerInput))}, '{}', '', '', ${sqlValue(status === "running" ? now : "")}, '', ${sqlValue(now)}, ${sqlValue(now)});`);
  const phaseInfo = await workflowTaskPhaseInfo(paths, context.workflowId, context.taskId);
  await upsertWorkflowAgentRun(paths, {
    agentRunId: `session.${runId}`,
    workflowId: context.workflowId,
    phaseId: phaseInfo.phaseId,
    phaseKey: phaseInfo.phaseKey,
    taskId: context.taskId,
    dispatchId: context.dispatchId,
    sessionRunId: runId,
    runtime: pack.runtimeTarget || "session_pack",
    agentId: workerId || pack.ownerAgent || "",
    status,
    attempt: 0,
    inputHash: jsonHash(inputPayload),
    payload: { source: "workflow_session_runs", sessionId, packVersion: pack.version },
    startedAt: status === "running" ? now : "",
    createdAt: now,
    updatedAt: now
  });
  return { runId, sessionId, packVersion: pack.version, status, workerInput, dbFile: paths.dbFile };
}

export async function workflowSessionRunComplete(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const runId = String(input.runId || input.run_id || "").trim();
  if (!runId) throw new Error("runId is required");
  const currentRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
  if (!currentRows[0]) throw new Error(`workflow session run not found: ${runId}`);
  const current = sessionRunFromRow(currentRows[0]);
  const now = nowIso();
  const status = requireWorkflowSessionRunStatus(input.status || "completed", "completed");
  const outputProvided = input.output !== undefined || input.result !== undefined || input.payload !== undefined;
  const receiptProvided = input.receiptRef !== undefined || input.receipt_ref !== undefined || input.artifactRef !== undefined || input.artifact_ref !== undefined;
  const errorProvided = input.error !== undefined;
  const output = outputProvided ? sessionJsonObject(input.output ?? input.result ?? input.payload ?? {}) : current.output;
  const receiptRef = receiptProvided ? String(input.receiptRef || input.receipt_ref || input.artifactRef || input.artifact_ref || "") : current.receiptRef;
  const errorText = errorProvided ? String(input.error || "") : current.error;
  if (isTerminalWorkflowSessionRunStatus(current.status)) {
    const conflicts = [];
    if (status !== current.status) conflicts.push("status");
    if (outputProvided && jsonHash(output) !== jsonHash(current.output)) conflicts.push("output");
    if (receiptProvided && receiptRef !== current.receiptRef) conflicts.push("receiptRef");
    if (errorProvided && errorText !== current.error) conflicts.push("error");
    if (conflicts.length) throw new Error(`workflow session run terminal conflict: ${runId} fields=${conflicts.join(",")}`);
    return { ...current, deduped: true, dbFile: paths.dbFile };
  }
  await sqlite(paths.dbFile, `
UPDATE workflow_session_runs
SET status=${sqlValue(status)},
    output_json=${sqlValue(JSON.stringify(output))},
    receipt_ref=${sqlValue(receiptRef)},
    error=${sqlValue(errorText)},
    completed_at=${sqlValue(isTerminalWorkflowSessionRunStatus(status) ? now : current.completedAt)},
    updated_at=${sqlValue(now)}
WHERE run_id=${sqlValue(runId)};`);
  const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_session_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
  const next = sessionRunFromRow(rows[0]);
  const existingAgentRunRows = await sqlite(paths.dbFile, `SELECT dispatch_id, phase_id, phase_key, runtime, agent_id FROM workflow_agent_runs WHERE agent_run_id=${sqlValue(`session.${runId}`)} LIMIT 1;`, { json: true });
  const existingAgentRun = existingAgentRunRows[0] || {};
  const phaseInfo = await workflowTaskPhaseInfo(paths, next.workflowId, next.taskId);
  await upsertWorkflowAgentRun(paths, {
    agentRunId: `session.${runId}`,
    workflowId: next.workflowId,
    phaseId: phaseInfo.phaseId || existingAgentRun.phase_id || "",
    phaseKey: phaseInfo.phaseKey || existingAgentRun.phase_key || "",
    taskId: next.taskId,
    dispatchId: next.dispatchId || existingAgentRun.dispatch_id || "",
    sessionRunId: runId,
    runtime: existingAgentRun.runtime || "session_pack",
    agentId: next.workerId || existingAgentRun.agent_id || "",
    status: next.status,
    inputHash: jsonHash(next.input),
    outputHash: jsonHash(next.output),
    receiptRef: next.receiptRef,
    error: next.error,
    payload: { source: "workflow_session_runs", sessionId: next.sessionId, packVersion: next.packVersion },
    startedAt: next.startedAt,
    completedAt: next.completedAt,
    updatedAt: now
  });
  return { ...next, dbFile: paths.dbFile };
}

export async function instrumentUpsert(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  return { ...instrument, dbFile: paths.dbFile };
}

export async function radarUpdate(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const zone = RADAR_ZONES.has(String(input.radarZone || input.radar_zone || "unknown")) ? String(input.radarZone || input.radar_zone || "unknown") : "unknown";
  const score = {
    scoreId: input.scoreId || input.score_id || safeId("radar"),
    asOf: String(input.asOf || input.as_of || dailyKey()),
    retailHeatScore: clampScore(input.retailHeatScore ?? input.retail_heat_score),
    newsCatalystScore: clampScore(input.newsCatalystScore ?? input.news_catalyst_score),
    fundamentalScore: clampScore(input.fundamentalScore ?? input.fundamental_score),
    summary: String(input.summary || input.text || "").trim(),
    createdBy: String(input.createdBy || input.from || "cat_claw")
  };
  await sqlite(paths.dbFile, `
INSERT INTO radar_scores(score_id, instrument_id, as_of, radar_zone, retail_heat_score, news_catalyst_score, fundamental_score, sentiment_stage, source_reliability, catalyst_window, fundamental_trend, valuation_state, confidence, summary, evidence_paths_json, created_by, created_at)
VALUES (${sqlValue(score.scoreId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(score.asOf)}, ${sqlValue(zone)}, ${sqlValue(score.retailHeatScore)}, ${sqlValue(score.newsCatalystScore)}, ${sqlValue(score.fundamentalScore)}, ${sqlValue(input.sentimentStage || input.sentiment_stage || "")}, ${sqlValue(input.sourceReliability || input.source_reliability || "")}, ${sqlValue(input.catalystWindow || input.catalyst_window || "")}, ${sqlValue(input.fundamentalTrend || input.fundamental_trend || "")}, ${sqlValue(input.valuationState || input.valuation_state || "")}, ${sqlValue(input.confidence || "")}, ${sqlValue(score.summary)}, ${sqlValue(JSON.stringify(toList(input.evidencePaths || input.evidence_paths)))}, ${sqlValue(score.createdBy)}, ${sqlValue(nowIso())});
INSERT INTO tracking_states(instrument_id, research_state, radar_zone, retail_heat_score, news_catalyst_score, fundamental_score, sentiment_stage, fundamental_trend, valuation_state, last_review_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(input.researchState || input.research_state || "")}, ${sqlValue(zone)}, ${sqlValue(score.retailHeatScore)}, ${sqlValue(score.newsCatalystScore)}, ${sqlValue(score.fundamentalScore)}, ${sqlValue(input.sentimentStage || input.sentiment_stage || "")}, ${sqlValue(input.fundamentalTrend || input.fundamental_trend || "")}, ${sqlValue(input.valuationState || input.valuation_state || "")}, ${sqlValue(score.asOf)}, ${sqlValue(nowIso())})
ON CONFLICT(instrument_id) DO UPDATE SET
  research_state=COALESCE(NULLIF(excluded.research_state,''), tracking_states.research_state),
  radar_zone=excluded.radar_zone,
  retail_heat_score=excluded.retail_heat_score,
  news_catalyst_score=excluded.news_catalyst_score,
  fundamental_score=excluded.fundamental_score,
  sentiment_stage=excluded.sentiment_stage,
  fundamental_trend=excluded.fundamental_trend,
  valuation_state=excluded.valuation_state,
  last_review_at=excluded.last_review_at,
  updated_at=excluded.updated_at;`);
  return { ...score, instrumentId: instrument.instrumentId, assetType: instrument.assetType, symbol: instrument.symbol, radarZone: zone, dbFile: paths.dbFile };
}

export async function thesisUpdate(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const status = THESIS_STATUSES.has(String(input.status || "active")) ? String(input.status || "active") : "active";
  const ownerAgent = String(input.ownerAgent || input.owner_agent || "cat_ears");
  const title = String(input.title || `${instrument.symbol} thesis`).trim();
  const assetDir = path.join(paths.thesisDir, instrument.assetType);
  await fs.mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, `${cleanFileSegment(instrument.symbol)}.md`);
  const record = {
    thesisId: input.thesisId || input.thesis_id || instrument.instrumentId,
    instrumentId: instrument.instrumentId,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    title,
    status,
    ownerAgent,
    summary: String(input.summary || input.text || "").trim(),
    falsificationTriggers: String(input.falsificationTriggers || input.falsification_triggers || "").trim(),
    reviewDueAt: String(input.reviewDueAt || input.review_due_at || ""),
    updatedAt: nowIso()
  };
  const content = String(input.content || "").trim() || renderThesisMarkdown(record, input);
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  const relPath = relativeTo(paths.root, filePath);
  await sqlite(paths.dbFile, `
INSERT INTO thesis_index(thesis_id, instrument_id, status, title, path, summary, falsification_triggers, owner_agent, review_due_at, created_at, updated_at)
VALUES (${sqlValue(record.thesisId)}, ${sqlValue(record.instrumentId)}, ${sqlValue(status)}, ${sqlValue(title)}, ${sqlValue(relPath)}, ${sqlValue(record.summary)}, ${sqlValue(record.falsificationTriggers)}, ${sqlValue(ownerAgent)}, ${sqlValue(record.reviewDueAt)}, ${sqlValue(record.updatedAt)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(thesis_id) DO UPDATE SET
  status=excluded.status,
  title=excluded.title,
  path=excluded.path,
  summary=excluded.summary,
  falsification_triggers=excluded.falsification_triggers,
  owner_agent=excluded.owner_agent,
  review_due_at=excluded.review_due_at,
  updated_at=excluded.updated_at;
INSERT INTO tracking_states(instrument_id, thesis_status, thesis_path, updated_at)
VALUES (${sqlValue(record.instrumentId)}, ${sqlValue(status)}, ${sqlValue(relPath)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(instrument_id) DO UPDATE SET thesis_status=excluded.thesis_status, thesis_path=excluded.thesis_path, updated_at=excluded.updated_at;`);
  return { ...record, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
}

export async function researchEvidence(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const evidenceId = input.evidenceId || input.evidence_id || safeId("evidence");
  const capturedAt = String(input.capturedAt || input.captured_at || nowIso());
  const assetDir = path.join(paths.evidenceDir, instrument.assetType, cleanFileSegment(instrument.symbol));
  await fs.mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, `${dailyKey(new Date(capturedAt))}-${cleanFileSegment(String(input.kind || "evidence"))}-${evidenceId.split(".").pop()}.md`);
  const content = String(input.content || `# Evidence ${evidenceId}

- instrument_id: ${instrument.instrumentId}
- kind: ${input.kind || "evidence"}
- source: ${input.source || ""}
- reliability: ${input.reliability || ""}
- captured_at: ${capturedAt}

## Summary

${String(input.summary || input.text || "").trim() || "待补充。"}

## Supports

${String(input.supports || "").trim() || "待补充。"}

## Conflicts

${String(input.conflicts || "").trim() || "待补充。"}
`).trim();
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  const relPath = relativeTo(paths.root, filePath);
  await sqlite(paths.dbFile, `
INSERT INTO evidence_items(evidence_id, instrument_id, kind, source, reliability, path, summary, supports, conflicts, captured_at, created_by, created_at)
VALUES (${sqlValue(evidenceId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.kind || "evidence")}, ${sqlValue(input.source || "")}, ${sqlValue(input.reliability || "")}, ${sqlValue(relPath)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.supports || "")}, ${sqlValue(input.conflicts || "")}, ${sqlValue(capturedAt)}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(nowIso())});
INSERT INTO tracking_states(instrument_id, last_evidence_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(capturedAt)}, ${sqlValue(nowIso())})
ON CONFLICT(instrument_id) DO UPDATE SET last_evidence_at=excluded.last_evidence_at, updated_at=excluded.updated_at;`);
  return { evidenceId, instrumentId: instrument.instrumentId, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
}

export async function researchMemo(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const instrument = await upsertInstrumentRecord(paths, input);
  const memoId = input.memoId || input.memo_id || safeId("memo");
  const createdAt = nowIso();
  const assetDir = path.join(paths.memosDir, instrument.assetType, cleanFileSegment(instrument.symbol));
  await fs.mkdir(assetDir, { recursive: true });
  const filePath = path.join(assetDir, `${dailyKey()}-${cleanFileSegment(input.memoType || input.memo_type || "research-memo")}.md`);
  const content = String(input.content || `# ${input.title || `${instrument.symbol} Research Memo`}

- memo_id: ${memoId}
- instrument_id: ${instrument.instrumentId}
- memo_type: ${input.memoType || input.memo_type || "research_memo"}
- created_at: ${createdAt}

## Summary

${String(input.summary || input.text || "").trim() || "待补充。"}

## Conclusion

${String(input.conclusion || "").trim() || "待补充。"}
`).trim();
  await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  const relPath = relativeTo(paths.root, filePath);
  await sqlite(paths.dbFile, `
INSERT INTO research_memos(memo_id, instrument_id, memo_type, path, title, summary, conclusion, created_by, created_at)
VALUES (${sqlValue(memoId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.memoType || input.memo_type || "research_memo")}, ${sqlValue(relPath)}, ${sqlValue(input.title || "")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.conclusion || "")}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)});
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(memoId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, 'research_memo', ${sqlValue(relPath)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)});
INSERT INTO tracking_states(instrument_id, last_memo_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(instrument_id) DO UPDATE SET last_memo_at=excluded.last_memo_at, updated_at=excluded.updated_at;`);
  return { memoId, instrumentId: instrument.instrumentId, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
}

export async function gateReview(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  let instrument = null;
  if (input.symbol || input.instrumentId || input.instrument_id) instrument = await upsertInstrumentRecord(paths, input);
  const gateId = input.gateId || input.gate_id || safeId("gate");
  const status = GATE_STATUSES.has(String(input.status || "pending")) ? String(input.status || "pending") : "pending";
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO review_gates(gate_id, instrument_id, workflow_id, gate_type, status, summary, reviewer_agent, human_gate_required, resume_pointer, expires_at, decision_at, approver, evidence_paths_json, created_by, created_at, updated_at)
VALUES (${sqlValue(gateId)}, ${sqlValue(instrument?.instrumentId || null)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.gateType || input.gate_type || "review_gate")}, ${sqlValue(status)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.reviewerAgent || input.reviewer_agent || "")}, ${sqlValue(Boolean(input.humanGateRequired ?? input.human_gate_required))}, ${sqlValue(input.resumePointer || input.resume_pointer || "")}, ${sqlValue(input.expiresAt || input.expires_at || "")}, ${sqlValue(["approved", "rejected", "waived"].includes(status) ? createdAt : "")}, ${sqlValue(input.approver || input.actor || "")}, ${sqlValue(JSON.stringify(toList(input.evidencePaths || input.evidence_paths)))}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  return { gateId, status, instrumentId: instrument?.instrumentId || null, dbFile: paths.dbFile };
}

export async function workflowTopology(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const registeredAgents = await sqlite(paths.dbFile, `
SELECT agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, endpoint_ref, updated_at
FROM runtime_agents
WHERE status NOT IN (${Array.from(RETIRED_RUNTIME_AGENT_STATUSES).map(sqlValue).join(", ")})
ORDER BY platform, agent_id;`, { json: true });
  const hermersModes = await loadHermersProfileModes(input);
  const activeAgentIds = [
    ...new Set(
      registeredAgents
        .filter((row) => row.status === "active")
        .map((row) => String(row.agent_id || "").trim())
        .filter(Boolean)
    )
  ];
  const runtimeRegistry = registeredAgents.reduce((acc, row) => {
    const snap = registrySnapshot(row);
    if (!acc[snap.platform]) acc[snap.platform] = [];
    const profileModeEvidence = snap.platform === "hermers" ? profileModeEvidenceForRow(row, hermersModes) : {};
    acc[snap.platform].push({
      agentKey: row.agent_key,
      runtime: row.runtime,
      agentId: row.agent_id,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      platform: snap.platform,
      executionAdapter: snap.executionAdapter,
      imIngressOwner: snap.imIngressOwner,
      imIngressAdapter: snap.imIngressAdapter,
      workflowIngressAdapter: snap.workflowIngressAdapter,
      imIdentity: snap.imIdentity,
      executionIdentity: snap.executionIdentity,
      returnPolicy: snap.returnPolicy,
      canReceiveDispatch: snap.canReceiveDispatch,
      canStartWorkflow: snap.canStartWorkflow,
      gatewayProxyAllowed: snap.gatewayProxyAllowed,
      endpointRef: row.endpoint_ref,
      updatedAt: row.updated_at,
      ...profileModeEvidence
    });
    return acc;
  }, {});
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    root: paths.root,
    runtimeRegistry,
    topology: {
      serverA: {
        role: "execution_and_simulation_plane",
        services: ["trading_sim", "trading_core"],
        stores: ["exchange_api_keys", "accounts", "positions", "orders", "execution_risk"],
        boundary: "Server A is the only side allowed to hold broker/exchange credentials and live position/order state."
      },
      serverB: {
        role: "openclaw_hermers_workflow_plane",
        services: ["openclaw", "hermers_agents", "trading-agents-workflow"],
        agents: activeAgentIds,
        stores: ["meetings", "research", "protocol_objects", "human_gate", "audit"],
        boundary: "Server B produces reviewed intents only; it must not store exchange API keys or live account state."
      },
      localCodex: {
        role: "flashcat_primary_conversation_panel",
        advancedOperationAuth: "mTLS client certificate required for executable trade intents."
      }
    },
    allowedPath: "research_signal/evidence_pack/research_memo -> trade_proposal -> cat_claw_evidence_audit -> human_gate_record -> cat_tail_pre_order_risk_audit -> risk_decision -> executable_trade_intent -> trading_core_receipt",
    blockedPath: "Telegram/IM/plaintext commands cannot create ready_for_trading_core intents."
  };
}

export async function workflowRuntimeAgents(rootDir, input = {}) {
  const topology = await workflowTopology(rootDir, input);
  const runtimes = Object.entries(topology.runtimeRegistry || {}).map(([platform, agents]) => ({
    platform,
    active: agents.filter((agent) => agent.status === "active").length,
    total: agents.length
  }));
  const generatedAt = nowIso();
  const records = Object.values(topology.runtimeRegistry || {}).flat();
  const activeOpenClawAgents = records
    .filter((agent) => agent.status === "active" && agent.runtime === "openclaw" && agent.platform === "openclaw")
    .map((agent) => agent.agentId)
    .filter(Boolean)
    .sort();
  const snapshot = {
    schemaVersion: 1,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    generatedAt,
    generatedAtEpoch: Math.floor(new Date(generatedAt).getTime() / 1000),
    source: {
      root: topology.root,
      dbFile: workflowPaths(rootDir, input).dbFile,
      table: "runtime_agents",
      authority: "trading-agents-workflow.runtime_agents"
    },
    runtimeRegistry: topology.runtimeRegistry,
    records,
    derivedScopes: {
      activeOpenClawAgentIds: activeOpenClawAgents
    },
    runtimes,
    count: runtimes.reduce((sum, item) => sum + item.total, 0),
    checksum: ""
  };
  snapshot.checksum = jsonHash({ ...snapshot, checksum: "" });
  const paths = workflowPaths(rootDir, input);
  const snapshotFile = path.join(paths.registryDir, "runtime-agents.snapshot.json");
  await writeJsonAtomic(snapshotFile, snapshot);
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
    root: topology.root,
    runtimeRegistry: topology.runtimeRegistry,
    snapshotFile,
    snapshotGeneratedAt: generatedAt,
    derivedScopes: snapshot.derivedScopes,
    runtimes,
    count: runtimes.reduce((sum, item) => sum + item.total, 0)
  };
}

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
    if (!entry.isFile() || !entry.name.startsWith("tracking.db.bak-")) continue;
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
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < alphabet.length ? alphabet[index] : String(index + 1);
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
  const match = label.match(/(?:批准)?方案\s*([A-Z])(?:\s|:|：|\.|、|$)/i)
    || label.match(/\b(?:plan|option)\s*([A-Z])(?:\s|:|：|\.|、|$)/i)
    || label.match(/^([A-Z])(?:\s|:|：|\.|、|$)/);
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
      const defaultKey = nextPlanIndex < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[nextPlanIndex] : String(nextPlanIndex + 1);
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
    return status === "approved" && !["reject", "pause", "terminate"].includes(role);
  });
}

function auditHumanGatePlanOptions(buttons = []) {
  const planButtons = humanGatePlanOptionButtons(buttons);
  const keys = new Set(planButtons.map((button, index) => humanGatePlanKey(button, index < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] : String(index + 1))).filter(Boolean));
  const missing = ["A", "B", "C"].filter((key) => !keys.has(key));
  const ok = planButtons.length >= 3 && missing.length === 0;
  return {
    ok,
    planCount: planButtons.length,
    requiredPlanCount: 3,
    requiredKeys: ["A", "B", "C"],
    missingKeys: missing,
    reason: ok ? "" : "human_gate_requires_at_least_abc_alternatives"
  };
}

function auditHumanGatePlanDetails(buttons = []) {
  const planButtons = humanGatePlanOptionButtons(buttons);
  const missing = [];
  const nonChinese = [];
  for (const [index, button] of planButtons.entries()) {
    const fallback = index < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] : String(index + 1);
    const key = humanGatePlanKey(button, fallback);
    const title = humanGateLocalizedPlanTitle(button, key, 80);
    const summary = firstHumanGateDetail(button, ["summary", "description", "text", "content"], 700);
    const prompt = firstHumanGateDetail(button, ["prompt", "nextAction", "next_action", "nextStep", "next_step", "execution", "action"], 520);
    const rollback = firstHumanGateDetail(button, ["rollback", "rollbackPlan", "rollback_plan", "rollbackBoundary", "rollback_boundary", "recovery", "restore", "fallback"], 520);
    if (!title && !String(button.label || "").trim()) missing.push(`${key}.title`);
    if (!summary) missing.push(`${key}.summary`);
    if (!prompt) missing.push(`${key}.prompt`);
    if (!rollback) missing.push(`${key}.rollback`);
    for (const [field, text] of Object.entries({ title, summary, prompt, rollback })) {
      if (text && countChineseChars(text) < 2) nonChinese.push(`${key}.${field}`);
    }
  }
  const ok = missing.length === 0 && nonChinese.length === 0;
  return {
    ok,
    missingDetailFields: missing,
    nonChineseDetailFields: nonChinese,
    languagePolicy: "cat_claw_report_primary_language_zh; technical terms, agent ids, artifact paths, symbols, and callback/tool names may remain original",
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
    const fallback = index < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] : String(index + 1);
    const key = humanGatePlanKey(button, fallback);
    textParts.push(
      humanGateLocalizedPlanTitle(button, key, 80),
      firstHumanGateDetail(button, ["summary", "description", "text", "content"], 700),
      firstHumanGateDetail(button, ["prompt", "nextAction", "next_action", "nextStep", "next_step", "execution", "action"], 520),
      firstHumanGateDetail(button, ["rollback", "rollbackPlan", "rollback_plan", "rollbackBoundary", "rollback_boundary", "recovery", "restore", "fallback"], 520)
    );
  }
  const primaryAuthoredText = primaryTextParts.filter(Boolean).join("\n");
  const primaryChineseChars = countChineseChars(primaryAuthoredText);
  const visibleAuthoredText = textParts.filter(Boolean).join("\n");
  const chineseChars = countChineseChars(visibleAuthoredText);
  const requiredChineseChars = 6;
  const ok = primaryChineseChars >= requiredChineseChars && chineseChars >= requiredChineseChars;
  return {
    ok,
    primaryChineseChars,
    chineseChars,
    requiredChineseChars,
    languagePolicy: "cat_claw_report_primary_language_zh; technical terms, agent ids, artifact paths, symbols, and callback/tool names may remain original",
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
  const desiredSpecs = humanGateButtonSpecs(row, payload, body);
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
  let buttons = (await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(row.object_id)} AND status='active'
ORDER BY created_at ASC;`, { json: true })).map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root));
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
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId || workflowId || row.object_id)}, 'human_gate_audit_failed', 'blocked', ${sqlValue("Human Gate evidence package lacks required complete A/B/C alternatives")}, ${sqlValue(JSON.stringify({ humanGateId: row.object_id, workflowId, audit }))}, 'cat_claw', ${sqlValue(createdAt)});`);
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
      "硬性要求：提交给闪电猫的 Human Gate 汇报必须包含至少 A/B/C 三个以上可独立批准的备选方案。",
      "语言要求：猫爪正式汇报以中文作为 primary language，正文结构和说明应让闪电猫直接读懂；技术名词、agent id、artifact 路径、symbol、tool/callback 名称和必要原文可以保留原文，不要求每个字段全中文，但整份材料不能是纯英文。",
      "硬性要求：Telegram 按钮必须使用 Bot API style 字段渲染整按钮颜色；不要用颜色方块 emoji 冒充按钮底色。",
      "猫爪只审计是否满足该结构，不生成方案内容。请猫之脑 main 补齐备选方案内容，并在再次交给猫爪前自检：方案 A、方案 B、方案 C 都存在、互斥、可执行、有证据和回滚边界，正式汇报整体以中文为主。",
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
      const revision = await dispatchHumanGatePlanRevision(rootDir, paths, row, workflowId, meetingId, summary, buttonSet.audit);
      if (existing?.status === "queued") {
        await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='cancelled',
    payload_json=${sqlValue(JSON.stringify({ ...parseJsonValue(existing.payload_json, {}), cancelledAt: nowIso(), cancelledReason: buttonSet.audit.reason }))},
    updated_at=${sqlValue(nowIso())}
WHERE outbox_id=${sqlValue(existing.outbox_id)};`);
      }
      results.push({ humanGateId: row.object_id, workflowId, status: "blocked_missing_abc_options", audit: buttonSet.audit, revisionDispatch: revision.dispatch, outboxId: existing?.outbox_id || "" });
      continue;
    }
    const { buttons } = buttonSet;

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

export async function humanGateInbox(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const createdAt = nowIso();
  const batchId = input.batchId || input.batch_id || safeId(`hgate-batch-${dailyKey()}`);
  const targetRef = String(input.target || input.targetRef || input.target_ref || DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID).trim();
  const title = String(input.title || `Human Gate Inbox ${dailyKey()}`).trim();
  const items = await collectHumanGateInboxItems(paths, input);
  const riskSummary = riskSummaryFor(items);
  const batch = {
    batchId,
    status: items.length ? "open" : "empty",
    title,
    targetRef,
    createdAt,
    riskSummary,
    items
  };
  const htmlPath = await writeTextArtifact(paths.root, paths.humanGateInboxDir, batchId, "html", renderHumanGateInboxHtml({ ...batch, htmlPath: "" }));
  batch.htmlPath = htmlPath;
  batch.telegramSummary = renderHumanGateTelegramSummary(batch);
  const jsonPath = relativeTo(paths.root, path.join(paths.humanGateInboxDir, `${cleanFileSegment(batchId)}.json`));
  batch.jsonPath = jsonPath;
  await writeJsonArtifact(paths.root, paths.humanGateInboxDir, batchId, batch);

  await sqlite(paths.dbFile, `
INSERT INTO human_gate_batches(batch_id, status, title, target_ref, risk_summary_json, default_action, html_path, json_path, telegram_summary, created_by, created_at, updated_at)
VALUES (${sqlValue(batchId)}, ${sqlValue(batch.status)}, ${sqlValue(title)}, ${sqlValue(targetRef)}, ${sqlValue(JSON.stringify(riskSummary))}, ${sqlValue(riskSummary.individual ? "review_p0_p1_first" : "batch_review_allowed")}, ${sqlValue(htmlPath)}, ${sqlValue(jsonPath)}, ${sqlValue(batch.telegramSummary)}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(batch_id) DO UPDATE SET
  status=excluded.status,
  title=excluded.title,
  target_ref=excluded.target_ref,
  risk_summary_json=excluded.risk_summary_json,
  default_action=excluded.default_action,
  html_path=excluded.html_path,
  json_path=excluded.json_path,
  telegram_summary=excluded.telegram_summary,
  updated_at=excluded.updated_at;`);
  await sqlite(paths.dbFile, `DELETE FROM human_gate_batch_items WHERE batch_id=${sqlValue(batchId)};`);
  for (const item of items) {
    await sqlite(paths.dbFile, `
INSERT INTO human_gate_batch_items(batch_id, item_id, source_type, source_id, workflow_id, meeting_id, title, summary, risk_tier, default_action, requires_individual_approval, status, action_hint, payload_json, created_at)
VALUES (${sqlValue(batchId)}, ${sqlValue(item.itemId)}, ${sqlValue(item.sourceType)}, ${sqlValue(item.sourceId)}, ${sqlValue(item.workflowId)}, ${sqlValue(item.meetingId)}, ${sqlValue(item.title)}, ${sqlValue(item.summary)}, ${sqlValue(item.riskTier)}, ${sqlValue(item.defaultAction)}, ${sqlValue(item.requiresIndividualApproval)}, ${sqlValue(item.status)}, ${sqlValue(item.actionHint || humanGateActionHint(item))}, ${sqlValue(JSON.stringify(item.payload || {}))}, ${sqlValue(item.createdAt)});`);
  }
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(batchId)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, 'human_gate_inbox', ${sqlValue(htmlPath)}, ${sqlValue(`${riskSummary.total} pending Human Gate inbox items`)}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);

  return {
    batchId,
    status: batch.status,
    createdAt,
    targetRef,
    count: items.length,
    riskSummary,
    htmlPath,
    jsonPath,
    telegramSummary: batch.telegramSummary,
    items,
    dbFile: paths.dbFile
  };
}

async function enqueueTelegramOutbox(paths, input) {
  const outboxId = input.outboxId || input.outbox_id || safeId("tg");
  const existing = await sqlite(paths.dbFile, `SELECT outbox_id, status FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
  if (existing[0]) return { outboxId, status: existing[0].status, deduped: true };
  const createdAt = nowIso();
  const payload = parseJsonValue(input.payload, input.payload || {});
  const messageType = input.messageType || input.message_type || "meeting_live";
  const status = input.status || "queued";
  const targetRef = input.targetRef || input.target_ref || "";
  if (TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES.has(String(messageType)) && ["queued", "delivering"].includes(String(status)) && !String(targetRef || "").trim()) {
    throw new Error(`telegram_outbox target_ref is required for ${messageType}`);
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

async function telegramOutboxDeliveryPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const outboxId = String(input.outboxId || input.outbox_id || "").trim();
  if (!outboxId) throw new Error("outboxId is required");
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM telegram_outbox
WHERE outbox_id=${sqlValue(outboxId)}
LIMIT 1;`, { json: true });
  const row = rows[0];
  const base = {
    schemaVersion: "telegram_outbox_delivery_preview.v1",
    action: "telegram.outbox.delivery.preview",
    readOnly: true,
    writeBoundary: "preview_only",
    outboxId,
    dbFile: paths.dbFile
  };
  if (!row) {
    return {
      ...base,
      eligible: false,
      claimEligible: false,
      wouldSendTelegram: false,
      wouldInvokeOpenClawCli: false,
      violations: [{ code: "outbox_not_found", detail: `telegram_outbox row not found: ${outboxId}` }],
      warnings: [],
      wouldUpdate: {
        telegramOutboxStatus: "unchanged",
        messageFlowDelivery: "unchanged"
      }
    };
  }
  const payload = parseJsonValue(row.payload_json, {});
  const account = String(input.account || payload.account || "cat_claw").trim();
  const explicitTarget = String(input.target || "").trim();
  const rowTarget = String(row.target_ref || "").trim();
  const target = explicitTarget || rowTarget;
  const normalizedTarget = normalizeTelegramBotApiChatId(target);
  const status = String(row.status || "").trim();
  const messageType = String(row.message_type || "").trim();
  const updatedAt = String(row.updated_at || "").trim();
  const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
  const staleDelivering = status === "delivering" && Boolean(updatedAt) && updatedAt <= staleDeliveringBefore;
  const claimEligible = status === "queued" || status === "failed" || staleDelivering;
  const claimReason = claimEligible
    ? (staleDelivering ? "stale_delivering_reclaimable" : `status_${status}`)
    : `status_${status || "unknown"}`;
  const text = String(row.text || "");
  const chunks = telegramChunks(text);
  const receipts = Array.isArray(payload.delivery?.receipts) ? payload.delivery.receipts : [];
  const startIndex = Math.min(receipts.length, chunks.length);
  const replyMarkup = payload.telegramReplyMarkup || payload.reply_markup || null;
  const inlineKeyboard = Array.isArray(replyMarkup?.inline_keyboard) ? replyMarkup.inline_keyboard : [];
  const inlineButtonCount = inlineKeyboard.reduce((count, buttonRow) => count + (Array.isArray(buttonRow) ? buttonRow.length : 0), 0);
  const payloadButtons = Array.isArray(payload.buttons) ? payload.buttons : [];
  const buttonCount = inlineButtonCount || payloadButtons.length;
  const targetRequired = TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES.has(messageType);
  const deliveryOperatorReason = String(
    input.deliveryOperatorReason ||
    input.delivery_operator_reason ||
    input.executionReason ||
    input.execution_reason ||
    ""
  ).trim();
  const catClawAuditId = firstText(
    input.catClawAuditId,
    input.cat_claw_audit_id,
    input.catClawAudit,
    input.cat_claw_audit,
    input.secretaryAuditId,
    input.secretary_audit_id
  );
  const deliveryApprovalId = firstText(
    input.deliveryApprovalId,
    input.delivery_approval_id,
    input.deliveryEvidenceId,
    input.delivery_evidence_id,
    input.humanGateEvidence,
    input.human_gate_evidence,
    input.evidenceHumanGateId,
    input.evidence_human_gate_id
  );
  const violations = [];
  const warnings = [];
  const governanceViolations = [];
  const governanceWarnings = [];
  if (!claimEligible) {
    violations.push({ code: "status_not_claimable", detail: `delivery claim would be skipped for status=${status || "unknown"}` });
  }
  if (!normalizedTarget) {
    violations.push({ code: "target_missing", detail: "telegram_outbox target_ref or explicit target is required before delivery" });
  }
  if (!text.trim()) {
    violations.push({ code: "text_missing", detail: "telegram_outbox text is empty" });
  }
  if (status === "failed") {
    warnings.push({ code: "retry_failed_outbox", detail: "delivery would retry a failed outbox row" });
  }
  if (staleDelivering) {
    warnings.push({ code: "stale_delivering_reclaim", detail: `delivery lease is older than ${TELEGRAM_OUTBOX_DELIVERY_LEASE_MS}ms` });
  }
  if (receipts.length > 0) {
    warnings.push({ code: "partial_receipts_present", detail: `delivery would resume after ${startIndex} recorded receipt(s)` });
  }
  if (!deliveryOperatorReason) {
    governanceViolations.push({ code: "delivery_operator_reason_required", detail: "A future delivery execution must carry an explicit delivery operator reason." });
  }
  if (messageType === "human_gate_request" && !catClawAuditId) {
    governanceViolations.push({ code: "cat_claw_audit_required", detail: "Human Gate request delivery must be backed by Cat Claw/secretary audit evidence." });
  }
  if (messageType === "human_gate_request" && buttonCount < 5) {
    governanceViolations.push({ code: "human_gate_buttons_incomplete", detail: "Human Gate request delivery expects A/B/C approve options plus pause and terminate controls." });
  }
  if (messageType === "human_gate_request" && account !== "cat_claw") {
    governanceWarnings.push({ code: "non_cat_claw_delivery_account", detail: `Human Gate request delivery should normally use cat_claw, got ${account || "<empty>"}.` });
  }
  if (targetRequired && !normalizedTarget) {
    governanceViolations.push({ code: "governed_target_required", detail: "Governed delivery cannot proceed without a bound Telegram target." });
  }
  const directBotApiWebAppCandidate = Boolean(inlineKeyboard.length && normalizedTarget);
  const eligible = violations.length === 0;
  const governanceReady = eligible && governanceViolations.length === 0;
  return {
    ...base,
    meetingId: row.meeting_id || "",
    status,
    messageType,
    targetKind: row.target_kind || "",
    targetRef: rowTarget,
    targetOverride: Boolean(explicitTarget),
    targetRequired,
    account,
    eligible,
    claimEligible,
    claimReason,
    createdAt: row.created_at || "",
    updatedAt,
    textLength: text.length,
    textPreview: redactSensitiveTextForPersistence(text.slice(0, 500)),
    chunkCount: chunks.length,
    resumedReceiptCount: receipts.length,
    pendingChunkCount: Math.max(0, chunks.length - startIndex),
    buttonSummary: {
      hasInlineKeyboard: inlineKeyboard.length > 0,
      rowCount: inlineKeyboard.length,
      buttonCount,
      payloadButtonCount: payloadButtons.length
    },
    deliveryPath: {
      directBotApiWebAppCandidate,
      openclawCliCandidate: Boolean(normalizedTarget),
      modeOrder: directBotApiWebAppCandidate
        ? ["direct_bot_api_web_app", "openclaw_message_send"]
        : ["openclaw_message_send"],
      presentationOnLastChunk: Boolean(payload.presentation)
    },
    executionPolicy: {
      previewOnly: true,
      futureAction: "telegram.outbox.delivery",
      riskTier: "P2-controlled-delivery",
      governanceReady,
      requiredBeforeExecution: [
        "console writes explicitly enabled",
        "operator reason",
        "idempotency key",
        "claimable outbox status",
        "bound Telegram target",
        ...(messageType === "human_gate_request" ? ["Cat Claw/secretary audit evidence", "A/B/C approve buttons plus pause/terminate controls"] : [])
      ],
      evidencePresence: {
        deliveryOperatorReason: Boolean(deliveryOperatorReason),
        catClawAudit: Boolean(catClawAuditId),
        deliveryApproval: Boolean(deliveryApprovalId)
      },
      hardStops: [...violations, ...governanceViolations],
      warnings: [...warnings, ...governanceWarnings]
    },
    receiptPolicy: {
      deliveryReceiptRequired: true,
      terminalOutboxStatuses: ["sent", "failed"],
      sideEffectUncertainStatuses: ["delivering", "web_app_direct_delivery_unavailable"],
      requiredReceiptFields: ["channel", "account", "target", "deliveredAt or failedAt", "receipts or error"],
      messageFlowSync: messageType === "message_flow_reply" ? "required_after_terminal_delivery" : "not_required_for_message_type",
      humanGateDeliveryEvidence: messageType === "human_gate_request" ? "telegram_outbox_payload_delivery_required_before_closeout" : "not_applicable",
      idempotencyBoundary: "outbox_id + deliveryClaim.claimId + recorded receipt count"
    },
    wouldSendTelegram: eligible,
    wouldInvokeOpenClawCli: eligible,
    wouldReadBotToken: directBotApiWebAppCandidate ? "only_during_actual_delivery" : "no",
    wouldUpdate: {
      telegramOutboxStatus: eligible ? "delivering_then_sent_or_failed" : "unchanged",
      deliveryClaim: eligible,
      messageFlowDelivery: eligible ? "sent_or_failed" : "unchanged"
    },
    violations,
    warnings,
    governanceViolations,
    governanceWarnings
  };
}

async function telegramOutboxRequeuePreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const outboxId = String(input.outboxId || input.outbox_id || "").trim();
  if (!outboxId) throw new Error("outboxId is required");
  const explicitRequeueReason = firstText(
    input.requeueOperatorReason,
    input.requeue_operator_reason,
    input.redeliveryOperatorReason,
    input.redelivery_operator_reason
  );
  const deliveryPreviewInput = explicitRequeueReason && !firstText(input.deliveryOperatorReason, input.delivery_operator_reason, input.executionReason, input.execution_reason)
    ? { ...input, deliveryOperatorReason: explicitRequeueReason }
    : input;
  const deliveryPreview = await telegramOutboxDeliveryPreview(rootDir, deliveryPreviewInput);
  const base = {
    schemaVersion: "telegram_outbox_requeue_preview.v1",
    action: "telegram.outbox.requeue.preview",
    readOnly: true,
    writeBoundary: "preview_only",
    outboxId,
    dbFile: paths.dbFile,
    deliveryPreview
  };
  if (!deliveryPreview.meetingId && deliveryPreview.violations?.some((row) => row.code === "outbox_not_found")) {
    return {
      ...base,
      eligible: false,
      requeueEligible: false,
      wouldRequeue: false,
      wouldResendTelegram: false,
      recommendedNextAction: "none",
      requeuePolicy: {
        strategy: "outbox_not_found",
        preserveOutboxId: true,
        preserveHumanGateId: true,
        preserveButtonIds: true,
        createNewHumanGateRequest: false
      },
      violations: deliveryPreview.violations || [],
      warnings: deliveryPreview.warnings || [],
      governanceViolations: [],
      governanceWarnings: [],
      wouldUpdate: {
        telegramOutboxStatus: "unchanged",
        deliveryClaim: false,
        messageFlowDelivery: "unchanged"
      }
    };
  }
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM telegram_outbox
WHERE outbox_id=${sqlValue(outboxId)}
LIMIT 1;`, { json: true });
  const row = rows[0];
  const payload = parseJsonValue(row?.payload_json, {});
  const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const deliveryClaim = payload.deliveryClaim && typeof payload.deliveryClaim === "object" ? payload.deliveryClaim : {};
  const status = String(row?.status || deliveryPreview.status || "").trim();
  const messageType = String(row?.message_type || deliveryPreview.messageType || "").trim();
  const updatedAt = String(row?.updated_at || "").trim();
  const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
  const staleDelivering = status === "delivering" && Boolean(updatedAt) && updatedAt <= staleDeliveringBefore;
  const freshDelivering = status === "delivering" && !staleDelivering;
  const failed = status === "failed";
  const queued = status === "queued";
  const sent = status === "sent";
  const receipts = Array.isArray(delivery.receipts) ? delivery.receipts : [];
  const requeueOperatorReason = firstText(
    input.requeueOperatorReason,
    input.requeue_operator_reason,
    input.redeliveryOperatorReason,
    input.redelivery_operator_reason,
    input.deliveryOperatorReason,
    input.delivery_operator_reason,
    input.executionReason,
    input.execution_reason
  );
  const catClawAuditId = firstText(
    input.catClawAuditId,
    input.cat_claw_audit_id,
    input.catClawAudit,
    input.cat_claw_audit,
    input.secretaryAuditId,
    input.secretary_audit_id
  );
  const deliveryApprovalId = firstText(
    input.deliveryApprovalId,
    input.delivery_approval_id,
    input.deliveryEvidenceId,
    input.delivery_evidence_id,
    input.humanGateEvidence,
    input.human_gate_evidence,
    input.evidenceHumanGateId,
    input.evidence_human_gate_id
  );
  const humanGateId = firstText(
    input.humanGateId,
    input.human_gate_id,
    payload.humanGateId,
    payload.human_gate_id,
    payload.humanGate?.id,
    payload.human_gate?.id
  );
  let strategy = "not_requeueable";
  if (failed) strategy = "retry_failed_delivery";
  else if (staleDelivering) strategy = "reclaim_stale_delivery_lease";
  else if (queued) strategy = "already_queued";
  else if (freshDelivering) strategy = "wait_for_active_delivery_lease";
  else if (sent) strategy = "terminal_sent_idempotent_replay_only";
  const requeueEligible = failed || staleDelivering;
  const violations = [];
  const warnings = [];
  const governanceViolations = [];
  const governanceWarnings = [];
  if (!requeueEligible) {
    violations.push({
      code: sent ? "already_sent" : freshDelivering ? "delivery_lease_active" : queued ? "already_queued" : "status_not_requeueable",
      detail: sent
        ? "Outbox is already sent; a future delivery execution should return idempotent replay, not resend."
        : freshDelivering
          ? "Outbox is delivering and the delivery lease is not stale yet."
          : queued
            ? "Outbox is already queued; no requeue step is needed before governed delivery."
            : `Outbox status ${status || "unknown"} is not eligible for requeue preview.`
    });
  }
  for (const item of deliveryPreview.violations || []) {
    if (item.code !== "status_not_claimable") violations.push(item);
  }
  if (!requeueOperatorReason && requeueEligible) {
    governanceViolations.push({ code: "requeue_operator_reason_required", detail: "A future resend/requeue action must carry an explicit requeue or delivery operator reason." });
  }
  if (messageType === "human_gate_request" && requeueEligible && !catClawAuditId) {
    governanceViolations.push({ code: "cat_claw_audit_required", detail: "Human Gate notification redelivery must be backed by Cat Claw/secretary audit evidence." });
  }
  if (messageType === "human_gate_request" && requeueEligible && !humanGateId) {
    governanceWarnings.push({ code: "human_gate_id_not_embedded", detail: "No Human Gate id was found in input or outbox payload; preserve the existing outbox id and button ids before any redelivery." });
  }
  if (failed) warnings.push({ code: "failed_outbox_redelivery", detail: "Preview would retry a failed outbox row through the governed delivery path." });
  if (staleDelivering) warnings.push({ code: "stale_delivery_lease", detail: `Preview would reclaim a delivery lease older than ${TELEGRAM_OUTBOX_DELIVERY_LEASE_MS}ms.` });
  if (receipts.length > 0) warnings.push({ code: "partial_receipts_present", detail: `Existing delivery receipts (${receipts.length}) must be preserved; later delivery resumes after recorded parts.` });
  const deliveryGovernanceReady = Boolean(deliveryPreview.executionPolicy?.governanceReady);
  const governanceReady = requeueEligible && governanceViolations.length === 0 && deliveryGovernanceReady;
  return {
    ...base,
    meetingId: deliveryPreview.meetingId || row?.meeting_id || "",
    status,
    messageType,
    targetKind: deliveryPreview.targetKind || row?.target_kind || "",
    targetRef: deliveryPreview.targetRef || row?.target_ref || "",
    account: deliveryPreview.account || "",
    eligible: requeueEligible && (deliveryPreview.eligible || false),
    requeueEligible,
    deliveryExecutionEligible: Boolean(deliveryPreview.eligible),
    governanceReady,
    strategy,
    recommendedNextAction: requeueEligible ? "telegram.outbox.delivery" : "none",
    wouldRequeue: requeueEligible,
    wouldResendTelegram: requeueEligible && deliveryPreview.eligible,
    wouldInvokeOpenClawCli: requeueEligible && deliveryPreview.wouldInvokeOpenClawCli,
    currentDelivery: {
      channel: delivery.channel || "",
      account: delivery.account || payload.account || "",
      target: delivery.target || row?.target_ref || "",
      deliveredAt: delivery.deliveredAt || "",
      failedAt: delivery.failedAt || "",
      error: redactSensitiveTextForPersistence(String(delivery.error || "").slice(0, 1000)),
      receiptCount: receipts.length,
      claimId: deliveryClaim.claimId || "",
      claimedAt: deliveryClaim.claimedAt || "",
      claimOwner: deliveryClaim.owner || "",
      previousStatus: deliveryClaim.previousStatus || ""
    },
    requeuePolicy: {
      previewOnly: true,
      futureAction: "telegram.outbox.delivery",
      strategy,
      preserveOutboxId: true,
      preserveHumanGateId: true,
      preserveButtonIds: true,
      preserveDeliveryReceipts: true,
      createNewHumanGateRequest: false,
      createNewTelegramOutbox: false,
      idempotencyRequired: true,
      operatorReasonRequired: true,
      catClawAuditRequired: messageType === "human_gate_request",
      humanGateId: humanGateId || "",
      buttonCount: deliveryPreview.buttonSummary?.buttonCount || 0,
      existingReceiptCount: receipts.length,
      staleLeaseCutoff: staleDeliveringBefore,
      sideEffectBoundary: "telegram_delivery_only"
    },
    executionPolicy: {
      previewOnly: true,
      futureAction: "telegram.outbox.delivery",
      governanceReady,
      requiredBeforeExecution: [
        "console writes explicitly enabled",
        "idempotency key",
        "explicit requeue or delivery operator reason",
        "failed or stale-delivering outbox status",
        "bound Telegram target",
        "preserve original outbox id, Human Gate id, button ids, and existing receipts",
        ...(messageType === "human_gate_request" ? ["Cat Claw/secretary audit evidence"] : [])
      ],
      evidencePresence: {
        requeueOperatorReason: Boolean(requeueOperatorReason),
        catClawAudit: Boolean(catClawAuditId),
        deliveryApproval: Boolean(deliveryApprovalId),
        humanGateId: Boolean(humanGateId)
      },
      hardStops: [...violations, ...governanceViolations, ...(deliveryPreview.governanceViolations || [])],
      warnings: [...warnings, ...governanceWarnings, ...(deliveryPreview.governanceWarnings || [])]
    },
    wouldUpdate: {
      telegramOutboxStatus: requeueEligible ? "delivering_then_sent_or_failed" : "unchanged",
      deliveryClaim: requeueEligible,
      messageFlowDelivery: requeueEligible ? deliveryPreview.wouldUpdate?.messageFlowDelivery || "sent_or_failed" : "unchanged",
      workflowStatus: "unchanged",
      humanGateRecord: "unchanged",
      tradingState: "unchanged"
    },
    violations,
    warnings,
    governanceViolations,
    governanceWarnings
  };
}

function telegramRequeueStrategyChinese(strategy = "") {
  const map = {
    retry_failed_delivery: "失败投递重试",
    reclaim_stale_delivery_lease: "回收过期投递租约后重试",
    wait_for_active_delivery_lease: "等待当前投递租约结束",
    terminal_sent_idempotent_replay_only: "已投递完成，仅允许幂等回放",
    already_queued: "已在排队中，无需重排",
    not_requeueable: "当前状态不可重排",
    outbox_not_found: "未找到 outbox"
  };
  return map[strategy] || strategy || "未知策略";
}

function telegramRequeueStatusChinese(status = "") {
  const map = {
    failed: "失败",
    delivering: "投递中",
    queued: "排队中",
    sent: "已投递",
    cancelled: "已取消"
  };
  return map[status] || status || "未知";
}

async function telegramOutboxRequeueExecutionPackagePreview(rootDir, input = {}) {
  const generatedAt = nowIso();
  const requeue = await telegramOutboxRequeuePreview(rootDir, input);
  const outboxId = requeue.outboxId || String(input.outboxId || input.outbox_id || "").trim();
  const humanGateId = requeue.requeuePolicy?.humanGateId || "";
  const statusCn = telegramRequeueStatusChinese(requeue.status);
  const strategyCn = telegramRequeueStrategyChinese(requeue.strategy);
  const missingEvidence = [];
  if (!requeue.executionPolicy?.evidencePresence?.requeueOperatorReason) missingEvidence.push("明确的重投递/投递操作理由");
  if (requeue.requeuePolicy?.catClawAuditRequired && !requeue.executionPolicy?.evidencePresence?.catClawAudit) missingEvidence.push("猫爪/秘书复核证据");
  if (!requeue.executionPolicy?.evidencePresence?.humanGateId && requeue.messageType === "human_gate_request") missingEvidence.push("原 Human Gate id");
  if (!requeue.deliveryExecutionEligible) missingEvidence.push("可用的 Telegram target/text/button 投递条件");
  const preservation = [
    `原 outbox id：${outboxId || "缺失"}`,
    `原 Human Gate id：${humanGateId || "未在 payload/input 中发现"}`,
    `按钮数量：${requeue.requeuePolicy?.buttonCount ?? 0}，不得新建并行 Human Gate 决策对象`,
    `已有投递 receipt 数量：${requeue.requeuePolicy?.existingReceiptCount ?? 0}，必须原样保留并从已记录分片后续投递`,
    `目标：${requeue.targetKind || "-"}:${requeue.targetRef || "-"}`,
    "未来实际执行只能进入 telegram.outbox.delivery，并由该动作二次校验 idempotency key、operator reason、Cat Claw audit 和 target"
  ];
  const summaryLines = [
    `事项：Telegram outbox 重投递执行前确认包。`,
    `当前 outbox：${outboxId || "缺失"}，状态：${statusCn}（${requeue.status || "unknown"}），策略：${strategyCn}（${requeue.strategy || "unknown"}）。`,
    `目标：${requeue.targetKind || "-"}:${requeue.targetRef || "-"}，账号：${requeue.account || "-"}，消息类型：${requeue.messageType || "-"}.`,
    requeue.requeueEligible
      ? "机器判断：该 outbox 处于 failed 或 stale-delivering，可进入受治理重投递路径的执行前审计。"
      : "机器判断：该 outbox 当前不应重投递；如果已经 sent，应走幂等回放审计，而不是重新发送。",
    requeue.governanceReady
      ? "治理状态：执行前关键证据已满足，仍需人类确认是否允许进入实际 delivery action。"
      : `治理状态：尚未满足执行条件，缺口：${missingEvidence.length ? missingEvidence.join("、") : "见 hardStops/warnings"}.`,
    "边界：本包只用于猫爪/闪电猫审计，不会重置 outbox、不 claim lease、不发送 Telegram、不创建 Human Gate、不写 side effect、不触碰交易状态。"
  ];
  const options = [
    {
      optionId: "A",
      title: "批准受治理重投递",
      buttonLabel: "方案 A：批准重投递",
      buttonStyle: "success",
      recommendation: requeue.governanceReady ? "recommended_when_operator_confirms" : "blocked_until_missing_evidence_resolved",
      content: "在补齐/确认 Cat Claw audit、操作理由和 idempotency key 后，只允许通过 telegram.outbox.delivery 执行实际投递；不得新建 Human Gate 或新 outbox。",
      nextStep: "由受控执行入口调用 telegram.outbox.delivery，并保留同一个 outbox/Human Gate/button/receipt 证据链。",
      executionBoundary: "telegram_delivery_only"
    },
    {
      optionId: "B",
      title: "暂缓重投递并补证",
      buttonLabel: "方案 B：暂缓补证",
      buttonStyle: "success",
      recommendation: requeue.governanceReady ? "optional_cautious_path" : "recommended_until_ready",
      content: "不执行重投递；先补齐猫爪复核、操作理由、目标/按钮/receipt 证据，或等待 fresh delivering lease 自然结束。",
      nextStep: "保持 outbox 当前状态不变，继续收集证据或等待下一轮队列/人工复核。",
      executionBoundary: "no_write"
    },
    {
      optionId: "C",
      title: "不重投递并收口为审计记录",
      buttonLabel: "方案 C：不重投递",
      buttonStyle: "success",
      recommendation: requeue.status === "sent" ? "recommended_for_sent_rows" : "use_when_redelivery_risk_exceeds_value",
      content: "不重新发送 Telegram；将当前状态作为审计事实处理。已 sent 的 outbox 只能记录幂等回放，不应再次发送。",
      nextStep: "由猫爪/猫之脑补充 closeout 或 incident 说明，说明为什么不重投递。",
      executionBoundary: "audit_only"
    }
  ];
  const controls = [
    {
      controlId: "pause_workflow",
      title: "暂停工作流",
      buttonLabel: "暂停工作流",
      buttonStyle: "primary",
      content: "暂停后不执行重投递，等待猫爪或闪电猫补充指令。"
    },
    {
      controlId: "terminate_workflow",
      title: "终止工作流",
      buttonLabel: "终止工作流",
      buttonStyle: "danger",
      content: "终止表示本段重投递事项不再推进，进入归档/可恢复记录流程；不是删除 workflow。"
    }
  ];
  const packageTextZh = [
    "# Telegram outbox 重投递执行前确认包",
    "",
    ...summaryLines.map((line) => `- ${line}`),
    "",
    "## 必须保留的证据链",
    ...preservation.map((line) => `- ${line}`),
    "",
    "## 可选方案",
    ...options.map((option) => `- ${option.optionId}. ${option.title}：${option.content}`),
    "",
    "## 控制项",
    ...controls.map((control) => `- ${control.title}：${control.content}`)
  ].join("\n");
  return {
    schemaVersion: "telegram_outbox_requeue_execution_package_preview.v1",
    action: "telegram.outbox.requeue.execution_package.preview",
    readOnly: true,
    writeBoundary: "preview_only",
    generatedAt,
    outboxId,
    meetingId: requeue.meetingId || "",
    humanGateId,
    status: requeue.status || "",
    strategy: requeue.strategy || "",
    strategyZh: strategyCn,
    requeueEligible: Boolean(requeue.requeueEligible),
    governanceReady: Boolean(requeue.governanceReady),
    readyForCatClawReview: Boolean(requeue.outboxId && requeue.messageType),
    readyForExecutionRequest: Boolean(requeue.governanceReady),
    futureExecutionAction: "telegram.outbox.delivery",
    didWrite: false,
    didSendTelegram: false,
    didCreateHumanGate: false,
    didCreateOutbox: false,
    didTouchTradingState: false,
    package: {
      titleZh: "Telegram outbox 重投递执行前确认包",
      summaryZh: summaryLines,
      preservationZh: preservation,
      missingEvidenceZh: missingEvidence,
      options,
      controls,
      packageTextZh
    },
    auditBoundary: {
      preserveOutboxId: true,
      preserveHumanGateId: true,
      preserveButtonIds: true,
      preserveDeliveryReceipts: true,
      noParallelHumanGate: true,
      noParallelOutbox: true,
      futureExecutionBoundary: "telegram_delivery_only"
    },
    requeuePreview: requeue,
    violations: requeue.violations || [],
    governanceViolations: requeue.governanceViolations || [],
    warnings: requeue.warnings || [],
    governanceWarnings: requeue.governanceWarnings || []
  };
}

async function telegramOutboxDelivery(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const outboxId = String(input.outboxId || input.outbox_id || "").trim();
  if (!outboxId) throw new Error("outboxId is required");
  const idempotencyKey = firstText(input.idempotencyKey, input.idempotency_key);
  if (!idempotencyKey) throw new Error("idempotencyKey is required for telegram outbox delivery execution");
  const preview = await telegramOutboxDeliveryPreview(rootDir, input);
  const hardStops = [
    ...(Array.isArray(preview.violations) ? preview.violations : []),
    ...(Array.isArray(preview.governanceViolations) ? preview.governanceViolations : [])
  ];
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM telegram_outbox
WHERE outbox_id=${sqlValue(outboxId)}
LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) throw new Error(`telegram_outbox row not found: ${outboxId}`);
  if (preview.status === "sent") {
    const payload = parseJsonValue(row.payload_json, {});
    const delivery = payload.delivery || {};
    return {
      schemaVersion: "telegram_outbox_delivery_result.v1",
      action: "telegram.outbox.delivery",
      writeBoundary: "telegram_delivery_only",
      outboxId,
      meetingId: preview.meetingId,
      messageType: preview.messageType,
      account: preview.account,
      targetKind: preview.targetKind,
      targetRef: preview.targetRef,
      deliveryStatus: "sent",
      idempotentReplay: true,
      didClaimOutbox: false,
      didSendTelegram: false,
      didUpdateOutbox: false,
      didUpdateMessageFlow: false,
      didTouchTradingState: false,
      receiptCount: Array.isArray(delivery.receipts) ? delivery.receipts.length : 0,
      receiptPolicy: preview.receiptPolicy,
      executionPolicy: {
        ...preview.executionPolicy,
        previewOnly: false
      },
      result: redactSensitiveForPersistence({ outboxId, status: "sent", delivery }),
      dbFile: paths.dbFile
    };
  }
  if (!preview.eligible || !preview.executionPolicy?.governanceReady) {
    throw new Error(`telegram outbox delivery blocked: ${hardStops.map((item) => item.code || item.detail).filter(Boolean).join(",") || "policy_not_ready"}`);
  }
  const result = await deliverTelegramOutboxRow(paths, row, {
    ...input,
    account: preview.account,
    target: preview.targetRef
  });
  const status = String(result?.status || "").trim() || "unknown";
  const workflowId = firstText(input.workflowId, input.workflow_id, preview.meetingId);
  const deliveryReceiptCount = Array.isArray(result?.receipts) ? result.receipts.length : 0;
  await appendWorkflowEvent(paths, {
    eventType: "telegram.outbox.delivery.executed",
    status,
    workflowId,
    traceId: input.traceId || input.trace_id || "",
    actor: firstText(input.actor, input.createdBy, input.created_by, "workflow"),
    sourceRuntime: "workflow",
    sourceAgent: firstText(input.sourceAgent, input.source_agent, input.actor, "workflow"),
    nextState: status,
    artifactRef: outboxId,
    payload: redactSensitiveForPersistence({
      outboxId,
      idempotencyKey,
      messageType: preview.messageType,
      targetKind: preview.targetKind,
      targetRef: preview.targetRef,
      account: preview.account,
      deliveryStatus: status,
      receiptCount: deliveryReceiptCount,
      receiptPolicy: preview.receiptPolicy,
      result
    })
  });
  return {
    schemaVersion: "telegram_outbox_delivery_result.v1",
    action: "telegram.outbox.delivery",
    writeBoundary: "telegram_delivery_only",
    outboxId,
    meetingId: preview.meetingId,
    messageType: preview.messageType,
    account: preview.account,
    targetKind: preview.targetKind,
    targetRef: preview.targetRef,
    deliveryStatus: status,
    didClaimOutbox: !result?.skipped,
    didSendTelegram: status === "sent",
    didUpdateOutbox: ["sent", "failed"].includes(status),
    didUpdateMessageFlow: preview.receiptPolicy?.messageFlowSync === "required_after_terminal_delivery" && ["sent", "failed"].includes(status),
    didTouchTradingState: false,
    receiptCount: deliveryReceiptCount,
    receiptPolicy: preview.receiptPolicy,
    executionPolicy: {
      ...preview.executionPolicy,
      previewOnly: false
    },
    result: redactSensitiveForPersistence(result),
    dbFile: paths.dbFile
  };
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
  if (!value) return false;
  if (/^heartbeat_(ok|degraded)\b/i.test(value)) return true;
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
  const ackRuntimeRunId = safeId("runtime_run_ack");
  await recordRuntimeRun(paths, row, {
    runtimeRunId: ackRuntimeRunId,
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

async function ensureRuntimeAgent(paths, input) {
  const runtime = normalizeRuntime(input.runtime || input.runtimeKey || input.runtime_key || input.platform);
  const agentId = normalizeAgentId(input.agentId || input.agent_id);
  const agentKey = runtimeAgentKey(runtime, agentId);
  const createdAt = nowIso();
  const displayName = String(input.displayName || input.display_name || "").trim();
  const role = String(input.role || "").trim();
  const endpointRef = String(input.endpointRef || input.endpoint_ref || "").trim();
  const platformInput = input.platform || input.runtimePlatform || input.runtime_platform;
  const executionAdapterInput = input.executionAdapter || input.execution_adapter;
  const imIngressOwnerInput = input.imIngressOwner || input.im_ingress_owner;
  const imIngressAdapterInput = input.imIngressAdapter || input.im_ingress_adapter;
  const workflowIngressAdapterInput = input.workflowIngressAdapter || input.workflow_ingress_adapter;
  const platform = normalizeAgentPlatform(platformInput, runtime);
  const executionAdapter = normalizeExecutionAdapter(executionAdapterInput, platform, runtime);
  const imIngressOwner = normalizeImIngressOwner(imIngressOwnerInput, platform, runtime);
  const imIngressAdapter = normalizeImIngressAdapter(imIngressAdapterInput, imIngressOwner, runtime);
  const workflowIngressAdapter = normalizeWorkflowIngressAdapter(workflowIngressAdapterInput, platform, runtime);
  const imIdentityInput = input.imIdentity || input.im_identity;
  const executionIdentityInput = input.executionIdentity || input.execution_identity;
  const returnPolicyInput = input.returnPolicy || input.return_policy;
  const imIdentity = normalizeImIdentity(imIdentityInput, imIngressOwner, imIngressAdapter, runtime);
  const executionIdentity = normalizeExecutionIdentity(executionIdentityInput, platform, workflowIngressAdapter, runtime);
  const returnPolicy = normalizeReturnPolicy(returnPolicyInput, executionIdentity === "hermers_acp" && imIdentity === "openclaw_route_shell" ? "reply_to_source_chat" : "silent");
  const imIdentityExplicit = firstText(imIdentityInput) ? 1 : 0;
  const executionIdentityExplicit = firstText(executionIdentityInput) ? 1 : 0;
  const returnPolicyExplicit = firstText(returnPolicyInput) ? 1 : 0;
  const platformExplicit = firstText(platformInput) ? 1 : 0;
  const executionAdapterExplicit = firstText(executionAdapterInput) ? 1 : 0;
  const imIngressOwnerExplicit = firstText(imIngressOwnerInput) ? 1 : 0;
  const imIngressAdapterExplicit = firstText(imIngressAdapterInput) ? 1 : 0;
  const workflowIngressAdapterExplicit = firstText(workflowIngressAdapterInput) ? 1 : 0;
  const canReceiveDispatch = boolInt(input.canReceiveDispatch ?? input.can_receive_dispatch, workflowIngressAdapter !== "none");
  const canStartWorkflow = boolInt(input.canStartWorkflow ?? input.can_start_workflow, true);
  const gatewayProxyAllowed = boolInt(input.gatewayProxyAllowed ?? input.gateway_proxy_allowed, imIngressOwner === "openclaw_gateway");
  const routingPolicy = parseJsonValue(input.routingPolicy || input.routing_policy, input.routingPolicy || input.routing_policy || {});
  const capabilitiesJson = JSON.stringify(parseJsonValue(input.capabilities, input.capabilities || {}));
  const metadataJson = JSON.stringify(parseJsonValue(input.metadata, input.metadata || {}));
  const preserveExisting = Boolean(input.preserveExisting || input.preserve_existing);
  assertRuntimeAgentRegistrationAllowed(runtime, agentId, {
    platform,
    executionAdapter,
    workflowIngressAdapter,
    imIngressOwner,
    imIngressAdapter,
    imIdentity,
    executionIdentity
  });
  const conflictUpdate = preserveExisting ? `
  display_name=CASE WHEN ${sqlValue(displayName)} != '' THEN excluded.display_name ELSE runtime_agents.display_name END,
  role=CASE WHEN ${sqlValue(role)} != '' THEN excluded.role ELSE runtime_agents.role END,
  status=excluded.status,
  platform=CASE WHEN ${sqlValue(platformExplicit)}=1 OR runtime_agents.platform='' THEN excluded.platform ELSE runtime_agents.platform END,
  execution_adapter=CASE WHEN ${sqlValue(executionAdapterExplicit)}=1 OR runtime_agents.execution_adapter='' THEN excluded.execution_adapter ELSE runtime_agents.execution_adapter END,
  im_ingress_owner=CASE WHEN ${sqlValue(imIngressOwnerExplicit)}=1 OR runtime_agents.im_ingress_owner='' THEN excluded.im_ingress_owner ELSE runtime_agents.im_ingress_owner END,
  im_ingress_adapter=CASE WHEN ${sqlValue(imIngressAdapterExplicit)}=1 OR runtime_agents.im_ingress_adapter='' THEN excluded.im_ingress_adapter ELSE runtime_agents.im_ingress_adapter END,
  workflow_ingress_adapter=CASE WHEN ${sqlValue(workflowIngressAdapterExplicit)}=1 OR runtime_agents.workflow_ingress_adapter='' THEN excluded.workflow_ingress_adapter ELSE runtime_agents.workflow_ingress_adapter END,
  im_identity=CASE WHEN ${sqlValue(imIdentityExplicit)}=1 OR runtime_agents.im_identity='' THEN excluded.im_identity ELSE runtime_agents.im_identity END,
  execution_identity=CASE WHEN ${sqlValue(executionIdentityExplicit)}=1 OR runtime_agents.execution_identity='' THEN excluded.execution_identity ELSE runtime_agents.execution_identity END,
  return_policy=CASE WHEN ${sqlValue(returnPolicyExplicit)}=1 OR runtime_agents.return_policy='' THEN excluded.return_policy ELSE runtime_agents.return_policy END,
  can_receive_dispatch=excluded.can_receive_dispatch,
  can_start_workflow=excluded.can_start_workflow,
  gateway_proxy_allowed=excluded.gateway_proxy_allowed,
  routing_policy_json=CASE WHEN ${sqlValue(JSON.stringify(routingPolicy))} != '{}' THEN excluded.routing_policy_json ELSE runtime_agents.routing_policy_json END,
  endpoint_ref=CASE WHEN ${sqlValue(endpointRef)} != '' THEN excluded.endpoint_ref ELSE runtime_agents.endpoint_ref END,
  capabilities_json=CASE WHEN ${sqlValue(capabilitiesJson)} != '{}' THEN excluded.capabilities_json ELSE runtime_agents.capabilities_json END,
  metadata_json=CASE WHEN ${sqlValue(metadataJson)} != '{}' THEN excluded.metadata_json ELSE runtime_agents.metadata_json END,
  updated_at=excluded.updated_at;` : `
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
  updated_at=excluded.updated_at;`;
  await sqlite(paths.dbFile, `
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, routing_policy_json, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
VALUES (${sqlValue(agentKey)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(displayName || agentId)}, ${sqlValue(role)}, ${sqlValue(input.status || "active")}, ${sqlValue(platform)}, ${sqlValue(executionAdapter)}, ${sqlValue(imIngressOwner)}, ${sqlValue(imIngressAdapter)}, ${sqlValue(workflowIngressAdapter)}, ${sqlValue(imIdentity)}, ${sqlValue(executionIdentity)}, ${sqlValue(returnPolicy)}, ${sqlValue(canReceiveDispatch)}, ${sqlValue(canStartWorkflow)}, ${sqlValue(gatewayProxyAllowed)}, ${sqlValue(JSON.stringify(routingPolicy))}, ${sqlValue(endpointRef)}, ${sqlValue(capabilitiesJson)}, ${sqlValue(metadataJson)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(agent_key) DO UPDATE SET
${conflictUpdate}`);
  const rows = await sqlite(paths.dbFile, `SELECT * FROM runtime_agents WHERE agent_key=${sqlValue(agentKey)} LIMIT 1;`, { json: true });
  const saved = registrySnapshot(rows[0] || { agent_key: agentKey, runtime, agent_id: agentId, platform, execution_adapter: executionAdapter, im_ingress_owner: imIngressOwner, im_ingress_adapter: imIngressAdapter, workflow_ingress_adapter: workflowIngressAdapter, im_identity: imIdentity, execution_identity: executionIdentity, return_policy: returnPolicy, can_receive_dispatch: canReceiveDispatch, can_start_workflow: canStartWorkflow, gateway_proxy_allowed: gatewayProxyAllowed });
  const exported = await workflowRuntimeAgents(paths.root, { workflowRootDir: paths.root });
  return { agentKey: saved.agentKey, runtime: rows[0]?.runtime || runtime, agentId: saved.agentId, platform: saved.platform, executionAdapter: saved.executionAdapter, imIngressOwner: saved.imIngressOwner, imIngressAdapter: saved.imIngressAdapter, workflowIngressAdapter: saved.workflowIngressAdapter, imIdentity: saved.imIdentity, executionIdentity: saved.executionIdentity, returnPolicy: saved.returnPolicy, canReceiveDispatch: saved.canReceiveDispatch, canStartWorkflow: saved.canStartWorkflow, gatewayProxyAllowed: saved.gatewayProxyAllowed, snapshotFile: exported.snapshotFile, snapshotGeneratedAt: exported.snapshotGeneratedAt };
}

export async function protocolRecord(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  let instrument = null;
  if (input.symbol || input.instrumentId || input.instrument_id) instrument = await upsertInstrumentRecord(paths, input);
  const objectTypeRaw = String(input.objectType || input.object_type || "generic").trim();
  const objectType = PROTOCOL_OBJECT_TYPES.has(objectTypeRaw) ? objectTypeRaw : "generic";
  const objectId = input.objectId || input.object_id || safeId(objectType.replace(/_/g, "-"));
  const status = String(input.status || "recorded").trim();
  if (objectType === "human_gate_record" && input[INTERNAL_HUMAN_GATE_RECORD] !== true) {
    throw new Error("human_gate_record writes are button-first only; use human_gate.request to create pending gates and human_gate.button_callback or human_gate.feedback to close them");
  }
  const sourceSystem = String(input.sourceSystem || input.source_system || input.source || "openclaw").trim();
  const sourceAgent = String(input.sourceAgent || input.source_agent || input.createdBy || input.from || "cat_claw").trim();
  const payload = {
    objectId,
    objectType,
    status,
    instrumentId: instrument?.instrumentId || input.instrumentId || input.instrument_id || null,
    sourceSystem,
    sourceAgent,
    summary: input.summary || input.text || "",
    payload: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {})),
    createdAt: input.createdAt || input.created_at || nowIso()
  };
  const hash = jsonHash(payload);
  const relPath = await writeJsonArtifact(paths.root, path.join(paths.protocolDir, objectType), objectId, { ...payload, hash });
  await sqlite(paths.dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES (${sqlValue(objectId)}, ${sqlValue(objectType)}, ${sqlValue(status)}, ${sqlValue(instrument?.instrumentId || input.instrumentId || input.instrument_id || null)}, ${sqlValue(sourceSystem)}, ${sqlValue(sourceAgent)}, ${sqlValue(input.parentObjectId || input.parent_object_id || "")}, ${sqlValue(relPath)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(hash)}, ${sqlValue(payload.createdAt)}, ${sqlValue(nowIso())})
ON CONFLICT(object_id) DO UPDATE SET
  object_type=excluded.object_type,
  status=excluded.status,
  instrument_id=excluded.instrument_id,
  source_system=excluded.source_system,
  source_agent=excluded.source_agent,
  parent_object_id=excluded.parent_object_id,
  path=excluded.path,
  payload_json=excluded.payload_json,
  hash=excluded.hash,
  updated_at=excluded.updated_at;`);
  return { objectId, objectType, status, instrumentId: instrument?.instrumentId || null, path: path.join(paths.root, relPath), relativePath: relPath, hash, dbFile: paths.dbFile };
}

export async function tradeProposal(rootDir, input) {
  return protocolRecord(rootDir, {
    ...input,
    objectType: "trade_proposal",
    objectId: input.proposalId || input.proposal_id || input.objectId || input.object_id,
    status: input.status || "proposed",
    sourceSystem: input.sourceSystem || input.source_system || "openclaw_hermers",
    sourceAgent: input.sourceAgent || input.source_agent || input.createdBy || input.from || "cat_heart",
    payload: {
      thesisId: input.thesisId || input.thesis_id || "",
      memoId: input.memoId || input.memo_id || "",
      side: input.side || "",
      quantity: input.quantity || "",
      orderType: input.orderType || input.order_type || "",
      priceConstraints: parseJsonValue(input.priceConstraints || input.price_constraints, input.priceConstraints || input.price_constraints || {}),
      riskLimits: parseJsonValue(input.riskLimits || input.risk_limits, input.riskLimits || input.risk_limits || {}),
      rationale: input.rationale || input.summary || input.text || "",
      raw: parseJsonValue(input.payload, input.payload || {})
    }
  });
}

export async function riskDecision(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const statusRaw = String(input.status || "pending").trim();
  const status = RISK_DECISION_STATUSES.has(statusRaw) ? statusRaw : "pending";
  const proposalId = String(input.proposalId || input.proposal_id || input.parentObjectId || input.parent_object_id || "").trim();
  const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
  const preOrderRiskAuditId = String(input.preOrderRiskAuditId || input.pre_order_risk_audit_id || input.auditId || input.audit_id || "").trim();
  const decision = String(input.decision || input.riskDecision || input.risk_decision || (status === "approved" ? "approved_for_paper_execution" : status)).trim();
  const reviewerAgent = String(input.reviewerAgent || input.reviewer_agent || "cat_tail").trim();
  const dispatchType = String(input.dispatchType || input.dispatch_type || "pre_order_risk_audit").trim();
  const riskLimits = parseJsonValue(input.riskLimits || input.risk_limits, input.riskLimits || input.risk_limits || {});
  const normalizedRisk = normalizeTradingCoreRiskLimits(riskLimits);
  const evidenceRefs = toList(input.evidenceRefs || input.evidence_refs);
  const isTerminalRiskDecision = status === "approved" || status === "rejected";
  if (isTerminalRiskDecision) {
    const terminalLabel = status;
    const proposal = await readProtocolObject(paths, proposalId);
    if (!proposalId || !proposal || proposal.object_type !== "trade_proposal") {
      throw new Error(`${terminalLabel} risk.decision requires an existing trade_proposal parent`);
    }
    const humanGate = await readProtocolObject(paths, humanGateId);
    if (!humanGateId || !humanGate || humanGate.object_type !== "human_gate_record" || humanGate.status !== "approved") {
      throw new Error(`${terminalLabel} risk.decision requires an approved Human Gate parent`);
    }
    if (!protocolObjectReferences(humanGate, proposalId)) {
      throw new Error(`${terminalLabel} risk.decision requires Human Gate bound to the trade_proposal`);
    }
    if (!preOrderRiskAuditId) throw new Error(`${terminalLabel} risk.decision requires preOrderRiskAuditId`);
    if (reviewerAgent !== "cat_tail") throw new Error(`${terminalLabel} risk.decision requires reviewerAgent=cat_tail`);
    if (dispatchType !== "pre_order_risk_audit") throw new Error(`${terminalLabel} risk.decision requires dispatchType=pre_order_risk_audit`);
    if (status === "approved" && decision !== "approved_for_paper_execution") throw new Error("approved risk.decision currently allows only approved_for_paper_execution");
    if (status === "rejected" && decision !== "rejected") throw new Error("rejected risk.decision requires decision=rejected");
    if (normalizedRisk.rejectionReasons.length) throw new Error(`${terminalLabel} risk.decision requires numeric riskLimits: ${normalizedRisk.rejectionReasons.join(",")}`);
    if (!evidenceRefs.length) throw new Error(`${terminalLabel} risk.decision requires evidenceRefs`);
    const workflowId = firstText(input.workflowId, input.workflow_id, protocolPayloadField(humanGate, ["workflowId", "workflow_id"]));
    const catTailDispatch = await findCatTailPreOrderRiskAuditDispatch(paths, { workflowId, humanGateId, proposalId, preOrderRiskAuditId });
    if (!catTailDispatch) throw new Error(`${terminalLabel} risk.decision requires matching cat_tail pre_order_risk_audit dispatch`);
  }
  return protocolRecord(rootDir, {
    ...input,
    objectType: "risk_decision",
    objectId: input.riskDecisionId || input.risk_decision_id || input.decisionId || input.decision_id || input.objectId || input.object_id,
    parentObjectId: proposalId,
    status,
    sourceSystem: input.sourceSystem || input.source_system || "openclaw",
    sourceAgent: input.sourceAgent || input.source_agent || input.reviewerAgent || input.reviewer_agent || "cat_tail",
    payload: {
      proposalId,
      humanGateId,
      preOrderRiskAuditId,
      reviewerAgent,
      dispatchType,
      riskBudgetImpact: input.riskBudgetImpact || input.risk_budget_impact || "",
      decision,
      riskLimits: normalizedRisk.value,
      evidenceRefs,
      paperRef: input.paperRef || input.paper_ref || input.artifactRef || input.artifact_ref || "",
      summary: input.summary || input.text || "",
      raw: parseJsonValue(input.payload, input.payload || {})
    }
  });
}

export async function workflowHumanGateRecord(rootDir, input) {
  const statusRaw = String(input.status || "pending").trim();
  const status = HUMAN_GATE_STATUSES.has(statusRaw) ? statusRaw : "pending";
  return protocolRecord(rootDir, {
    ...input,
    objectType: "human_gate_record",
    objectId: input.humanGateId || input.human_gate_id || input.gateId || input.gate_id || input.objectId || input.object_id,
    parentObjectId: input.parentObjectId || input.parent_object_id || input.riskDecisionId || input.risk_decision_id || input.proposalId || input.proposal_id || "",
    status,
    sourceSystem: input.sourceSystem || input.source_system || "local_codex",
    sourceAgent: input.sourceAgent || input.source_agent || input.from || "flashcat",
    payload: {
      gateType: input.gateType || input.gate_type || "high_risk_trade_execution",
      humanGateStageKey: input.humanGateStageKey || input.human_gate_stage_key || input.stageKey || input.stage_key || "",
      stage: input.stage || input.phase || "",
      meetingId: input.meetingId || input.meeting_id || "",
      actor: input.actor || input.from || "flashcat",
      assurance: input.assurance || input.authAssurance || "",
      expiresAt: input.expiresAt || input.expires_at || "",
      decisionAt: ["approved", "rejected", "paused", "terminated", "expired"].includes(status) ? nowIso() : "",
      resumePointer: input.resumePointer || input.resume_pointer || input.dispatchId || input.dispatch_id || "",
      workflowId: input.workflowId || input.workflow_id || "",
      traceId: input.traceId || input.trace_id || "",
      summary: input.summary || input.text || "",
      raw: parseJsonValue(input.payload, input.payload || {})
    }
  });
}

export async function tradeIntent(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
  let existingIntent = null;
  if (idempotencyKey) {
    const existing = await sqlite(paths.dbFile, `SELECT * FROM executable_trade_intents WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
    existingIntent = existing[0] || null;
  }

  const instrument = await upsertInstrumentRecord(paths, input);
  const intentId = input.intentId || input.intent_id || safeId("intent");
  const proposalId = String(input.proposalId || input.proposal_id || "").trim();
  const riskDecisionId = String(input.riskDecisionId || input.risk_decision_id || "").trim();
  const preOrderRiskAuditId = String(input.preOrderRiskAuditId || input.pre_order_risk_audit_id || "").trim();
  const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
  const sideRaw = String(input.side || "").trim().toLowerCase();
  const side = TRADING_CORE_SIDES.has(sideRaw) ? sideRaw : "";
  const orderTypeRaw = String(input.orderType || input.order_type || "limit").trim().toLowerCase();
  const orderType = TRADING_CORE_ORDER_TYPES.has(orderTypeRaw) ? orderTypeRaw : "";
  const actor = String(input.actor || input.from || "").trim().toLowerCase();
  const assurance = String(input.assurance || input.authAssurance || input.auth_assurance || input.auth?.assurance || "").trim().toLowerCase();
  const sourceSystem = String(input.sourceSystem || input.source_system || input.source || "unknown").trim();
  const clientCertFingerprint = String(input.clientCertFingerprint || input.client_cert_fingerprint || input.cert || "").trim();
  const quantity = numberOrNull(input.quantity);
  const expiresAt = String(input.expiresAt || input.expires_at || "").trim();
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const normalizedPrice = normalizeTradingCorePriceConstraints(input.priceConstraints || input.price_constraints, orderType);
  const priceConstraints = normalizedPrice.value;
  let normalizedRisk = normalizeTradingCoreRiskLimits(input.riskLimits || input.risk_limits);
  let riskLimits = normalizedRisk.value;
  const proposal = await readProtocolObject(paths, proposalId);
  const risk = await readProtocolObject(paths, riskDecisionId);
  const humanGate = await readProtocolObject(paths, humanGateId);
  const callerProvidedRiskLimits = input.riskLimits !== undefined || input.risk_limits !== undefined;
  let riskDecisionRiskLimits = null;
  if (risk && risk.object_type === "risk_decision") {
    riskDecisionRiskLimits = normalizeTradingCoreRiskLimits(protocolPayloadValue(risk, ["riskLimits", "risk_limits"]));
    normalizedRisk = riskDecisionRiskLimits;
    riskLimits = normalizedRisk.value;
  }
  const workflowId = firstText(input.workflowId, input.workflow_id, protocolPayloadField(humanGate, ["workflowId", "workflow_id"]));
  const traceId = firstText(input.traceId, input.trace_id, protocolPayloadField(humanGate, ["traceId", "trace_id"]));
  const executionMode = String(input.executionMode || input.execution_mode || "paper").trim().toLowerCase();
  const marketType = String(input.marketType || input.market_type || "").trim().toLowerCase();
  const exchange = String(input.exchange || "").trim();
  const baseAsset = String(input.baseAsset || input.base_asset || "").trim().toUpperCase();
  const quoteAsset = String(input.quoteAsset || input.quote_asset || "").trim().toUpperCase();
  const clientOrderId = String(input.clientOrderId || input.client_order_id || idempotencyKey || "").trim();
  const timeInForce = String(input.timeInForce || input.time_in_force || "").trim().toLowerCase();
  const humanGateExpiresAt = protocolObjectExpiresAt(humanGate || {});
  const humanGateExpiresAtMs = humanGateExpiresAt ? Date.parse(humanGateExpiresAt) : NaN;
  const rejectionReasons = [];

  if (!proposalId || !proposal || proposal.object_type !== "trade_proposal") rejectionReasons.push("missing_valid_trade_proposal");
  if (!riskDecisionId || !risk || risk.object_type !== "risk_decision" || risk.status !== "approved") rejectionReasons.push("missing_approved_cat_tail_risk_decision");
  if (!humanGateId || !humanGate || humanGate.object_type !== "human_gate_record" || humanGate.status !== "approved") rejectionReasons.push("missing_approved_flashcat_human_gate");
  if (!preOrderRiskAuditId) rejectionReasons.push("missing_pre_order_risk_audit_id");
  if (proposal && proposal.object_type === "trade_proposal" && risk && risk.object_type === "risk_decision" && !protocolObjectReferences(risk, proposalId)) {
    rejectionReasons.push("risk_decision_not_bound_to_trade_proposal");
  }
  if (risk && risk.object_type === "risk_decision") {
    if (protocolPayloadField(risk, ["reviewerAgent", "reviewer_agent"]) !== "cat_tail") rejectionReasons.push("risk_decision_reviewer_must_be_cat_tail");
    if (protocolPayloadField(risk, ["dispatchType", "dispatch_type"]) !== "pre_order_risk_audit") rejectionReasons.push("risk_decision_must_come_from_pre_order_risk_audit");
    if (protocolPayloadField(risk, ["decision"]) !== "approved_for_paper_execution") rejectionReasons.push("risk_decision_must_approve_paper_execution");
    if (!protocolObjectReferences(risk, humanGateId)) rejectionReasons.push("risk_decision_not_bound_to_human_gate");
    if (!protocolObjectReferences(risk, preOrderRiskAuditId)) rejectionReasons.push("risk_decision_not_bound_to_pre_order_risk_audit");
    if (riskDecisionRiskLimits?.rejectionReasons.length) rejectionReasons.push("risk_decision_missing_numeric_risk_limits");
    const evidenceRefs = protocolPayloadValue(risk, ["evidenceRefs", "evidence_refs"]);
    if (!Array.isArray(evidenceRefs) || !evidenceRefs.length) rejectionReasons.push("risk_decision_missing_evidence_refs");
    const catTailDispatch = await findCatTailPreOrderRiskAuditDispatch(paths, { workflowId, humanGateId, proposalId, preOrderRiskAuditId });
    if (!catTailDispatch) rejectionReasons.push("risk_decision_missing_cat_tail_pre_order_risk_audit_dispatch");
    if (callerProvidedRiskLimits) {
      const callerRisk = normalizeTradingCoreRiskLimits(input.riskLimits || input.risk_limits);
      if (JSON.stringify(callerRisk.value) !== JSON.stringify(riskLimits)) rejectionReasons.push("risk_limits_must_match_cat_tail_risk_decision");
    }
  }
  if (humanGate && humanGate.object_type === "human_gate_record") {
    if (!protocolObjectReferences(humanGate, proposalId)) rejectionReasons.push("human_gate_not_bound_to_trade_proposal");
    if (humanGateExpiresAt && (!Number.isFinite(humanGateExpiresAtMs) || humanGateExpiresAtMs <= Date.now())) rejectionReasons.push("human_gate_expired");
  }
  if (proposal?.instrument_id && proposal.instrument_id !== instrument.instrumentId) rejectionReasons.push("proposal_instrument_mismatch");
  if (risk?.instrument_id && risk.instrument_id !== instrument.instrumentId) rejectionReasons.push("risk_decision_instrument_mismatch");
  if (humanGate?.instrument_id && humanGate.instrument_id !== instrument.instrumentId) rejectionReasons.push("human_gate_instrument_mismatch");
  if (!workflowId) rejectionReasons.push("missing_workflow_id");
  if (!traceId) rejectionReasons.push("missing_trace_id");
  if (!TRADING_CORE_EXECUTION_MODES.has(executionMode)) rejectionReasons.push("invalid_execution_mode");
  if (actor !== "flashcat") rejectionReasons.push("actor_must_be_flashcat");
  if (!TRADING_CORE_ASSURANCE_VALUES.has(assurance)) rejectionReasons.push("local_codex_mtls_required");
  if (!clientCertFingerprint) rejectionReasons.push("client_cert_fingerprint_required");
  if (!side) rejectionReasons.push("invalid_trading_core_side");
  if (!idempotencyKey) rejectionReasons.push("missing_idempotency_key");
  if (quantity === null || quantity <= 0) rejectionReasons.push("invalid_trade_quantity");
  if (!orderType) rejectionReasons.push("invalid_trading_core_order_type");
  if (instrument.assetType === "crypto") {
    if (marketType !== "spot") rejectionReasons.push("crypto_market_type_must_be_spot");
    if (!exchange) rejectionReasons.push("crypto_exchange_required");
    if (!baseAsset) rejectionReasons.push("crypto_base_asset_required");
    if (!quoteAsset) rejectionReasons.push("crypto_quote_asset_required");
    if (!clientOrderId) rejectionReasons.push("crypto_client_order_id_required");
    if (!timeInForce) rejectionReasons.push("crypto_time_in_force_required");
  }
  if (!expiresAt || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) rejectionReasons.push("missing_or_expired_intent_expiry");
  rejectionReasons.push(...normalizedPrice.rejectionReasons);
  rejectionReasons.push(...normalizedRisk.rejectionReasons);

  const status = rejectionReasons.length ? "rejected" : "ready_for_trading_core";
  const createdAt = nowIso();
  const executableIntent = buildExecutableTradeIntent(input, {
    intentId,
    status,
    instrument,
    side: side || sideRaw,
    quantity,
    orderType: orderType || orderTypeRaw,
    proposalId,
    riskDecisionId,
    preOrderRiskAuditId,
    humanGateId,
    humanGate,
    workflowId,
    traceId,
    executionMode,
    sourceSystem,
    actor,
    assurance,
    clientCertFingerprint,
    idempotencyKey,
    priceConstraints,
    riskLimits,
    expiresAt,
    marketType,
    exchange,
    baseAsset,
    quoteAsset,
    clientOrderId,
    timeInForce,
    rejectionReasons
  });
  const payload = {
    ...executableIntent,
    intentId,
    status,
    instrumentId: instrument.instrumentId,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    side: side || sideRaw,
    quantity,
    orderType: orderType || orderTypeRaw,
    proposalId,
    riskDecisionId,
    preOrderRiskAuditId,
    humanGateId,
    sourceSystem,
    actor,
    assurance,
    clientCertFingerprintHash: clientCertFingerprint ? textHash(clientCertFingerprint) : "",
    rawInput: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}))
  };
  const persistencePayload = {
    ...payload,
    clientCertFingerprint: clientCertFingerprint ? "[redacted]" : ""
  };
  const intentHash = executableIntent.intentHash;
  if (existingIntent) {
    if (String(existingIntent.intent_hash || "") === intentHash) {
      return { ...existingIntent, idempotentReplay: true, dbFile: paths.dbFile };
    }
    throw new Error("idempotency_key_conflict: existing executable_trade_intent payload differs from this request");
  }
  const relPath = await writeJsonArtifact(paths.root, paths.intentsDir, intentId, executableIntent);
  await sqlite(paths.dbFile, `
INSERT INTO executable_trade_intents(intent_id, status, instrument_id, asset_type, symbol, side, quantity, order_type, proposal_id, risk_decision_id, human_gate_id, source_system, actor, assurance, client_cert_fingerprint, idempotency_key, intent_hash, payload_json, rejection_reason, created_at, updated_at)
VALUES (${sqlValue(intentId)}, ${sqlValue(status)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(instrument.assetType)}, ${sqlValue(instrument.symbol)}, ${sqlValue(side || sideRaw)}, ${sqlValue(quantity)}, ${sqlValue(orderType || orderTypeRaw)}, ${sqlValue(proposalId)}, ${sqlValue(riskDecisionId)}, ${sqlValue(humanGateId)}, ${sqlValue(sourceSystem)}, ${sqlValue(actor)}, ${sqlValue(assurance)}, ${sqlValue(clientCertFingerprint ? textHash(clientCertFingerprint) : "")}, ${sqlValue(idempotencyKey)}, ${sqlValue(intentHash)}, ${sqlValue(JSON.stringify(persistencePayload))}, ${sqlValue(rejectionReasons.join(","))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  await protocolRecord(rootDir, {
    ...input,
    objectType: "executable_trade_intent",
    objectId: intentId,
    instrumentId: instrument.instrumentId,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    parentObjectId: humanGateId,
    status,
    sourceSystem,
    sourceAgent: actor || "unknown",
    payload: { ...persistencePayload, relativePath: relPath }
  });
  return { intentId, status, rejectionReasons, instrumentId: instrument.instrumentId, path: path.join(paths.root, relPath), relativePath: relPath, intentHash, dbFile: paths.dbFile };
}

export async function tradingCoreReceipt(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const intentId = String(input.intentId || input.intent_id || "").trim();
  if (!intentId) throw new Error("intentId is required");
  const intents = await sqlite(paths.dbFile, `SELECT * FROM executable_trade_intents WHERE intent_id=${sqlValue(intentId)} LIMIT 1;`, { json: true });
  const intent = intents[0];
  if (!intent) throw new Error(`unknown intentId: ${intentId}`);
  const statusRaw = String(input.status || "accepted").trim();
  if (!RECEIPT_STATUSES.has(statusRaw)) throw new Error(`unknown trading_core receipt status: ${statusRaw || "<empty>"}`);
  const status = statusRaw;
  const currentIntentStatus = String(intent.status || "").trim();
  const allowedTransitions = TRADING_CORE_RECEIPT_TRANSITIONS[currentIntentStatus];
  if (!allowedTransitions || !allowedTransitions.has(status)) {
    throw new Error(`invalid trading_core receipt transition: ${currentIntentStatus || "<unknown>"} -> ${status}`);
  }
  const receiptId = input.receiptId || input.receipt_id || safeId("receipt");
  const createdAt = nowIso();
  const payload = {
    receiptId,
    intentId,
    status,
    tradingCoreRef: input.tradingCoreRef || input.trading_core_ref || "",
    sourceSystem: input.sourceSystem || input.source_system || "trading_core",
    summary: input.summary || input.text || "",
    raw: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}))
  };
  const relPath = await writeJsonArtifact(paths.root, paths.receiptsDir, receiptId, payload);
  await sqlite(paths.dbFile, `
INSERT INTO trading_core_receipts(receipt_id, intent_id, status, trading_core_ref, source_system, payload_json, created_at)
VALUES (${sqlValue(receiptId)}, ${sqlValue(intentId)}, ${sqlValue(status)}, ${sqlValue(payload.tradingCoreRef)}, ${sqlValue(payload.sourceSystem)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)});
UPDATE executable_trade_intents
SET status=${sqlValue(receiptIntentStatus(status))}, updated_at=${sqlValue(createdAt)}
WHERE intent_id=${sqlValue(intentId)};`);
  await protocolRecord(rootDir, {
    objectType: "trading_core_receipt",
    objectId: receiptId,
    parentObjectId: intentId,
    status,
    sourceSystem: payload.sourceSystem,
    sourceAgent: "trading_core",
    payload: { ...payload, relativePath: relPath }
  });
  return { receiptId, intentId, status, tradingCoreRef: payload.tradingCoreRef, path: path.join(paths.root, relPath), relativePath: relPath, dbFile: paths.dbFile };
}

export async function sideEffectRecord(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const sideEffectId = input.sideEffectId || input.side_effect_id || safeId("side_effect");
  const createdAt = nowIso();
  const payload = redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}));
  const status = String(input.status || "planned").trim();
  const sideEffectType = String(input.sideEffectType || input.side_effect_type || input.type || "generic").trim();
  await sqlite(paths.dbFile, `
INSERT INTO side_effect_ledger(side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, input_hash, output_hash, artifact_ref, payload_json, created_at, updated_at)
VALUES (${sqlValue(sideEffectId)}, ${sqlValue(input.traceId || input.trace_id || "")}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.dispatchId || input.dispatch_id || "")}, ${sqlValue(input.idempotencyKey || input.idempotency_key || "")}, ${sqlValue(input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "")}, ${sqlValue(sideEffectType)}, ${sqlValue(status)}, ${sqlValue(input.inputHash || input.input_hash || jsonHash(payload))}, ${sqlValue(input.outputHash || input.output_hash || "")}, ${sqlValue(input.artifactRef || input.artifact_ref || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(side_effect_id) DO UPDATE SET
  status=excluded.status,
  output_hash=CASE WHEN excluded.output_hash != '' THEN excluded.output_hash ELSE side_effect_ledger.output_hash END,
  artifact_ref=CASE WHEN excluded.artifact_ref != '' THEN excluded.artifact_ref ELSE side_effect_ledger.artifact_ref END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  await appendWorkflowEvent(paths, {
    eventType: "side_effect.recorded",
    status,
    workflowId: input.workflowId || input.workflow_id || "",
    traceId: input.traceId || input.trace_id || "",
    dispatchId: input.dispatchId || input.dispatch_id || "",
    sideEffectId,
    actor: input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "workflow",
    sourceRuntime: "workflow",
    sourceAgent: input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "",
    nextState: status,
    artifactRef: input.artifactRef || input.artifact_ref || "",
    payload: { sideEffectType, inputHash: input.inputHash || input.input_hash || jsonHash(payload), outputHash: input.outputHash || input.output_hash || "" },
    createdAt
  });
  return { sideEffectId, sideEffectType, status, dbFile: paths.dbFile };
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

function deadLetterIncidentInput(input = {}) {
  return {
    workflowId: String(input.workflowId || input.workflow_id || "").trim(),
    kind: String(input.kind || input.deadLetterKind || input.dead_letter_kind || "").trim(),
    refId: String(input.refId || input.ref_id || input.deadLetterRefId || input.dead_letter_ref_id || "").trim(),
    incidentId: String(input.incidentId || input.incident_id || "").trim()
  };
}

function deterministicDeadLetterIncidentId({ workflowId, kind, refId }) {
  const digest = textHash(`${workflowId || "-"}:${kind || "-"}:${refId || "-"}`).slice(0, 16);
  return `incident.dead_letter.${digest}`;
}

function deadLetterIncidentMode(candidate = {}) {
  const mode = String(candidate.suggestedMode || "").trim();
  return INCIDENT_MODES.has(mode) ? mode : "degraded";
}

function deadLetterIncidentStatus(candidate = {}) {
  if (candidate.severity === "warning") return "monitoring";
  const status = String(candidate.suggestedStatus || "").trim();
  if (INCIDENT_STATUSES.has(status)) return status;
  return "active";
}

function deadLetterIncidentSummary(candidate = {}, input = {}) {
  return String(input.summary || candidate.summary || `${candidate.kind || "dead_letter"} ${candidate.refId || ""}`).trim();
}

async function workflowIncidentFromDeadLetterPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const deadLetter = deadLetterIncidentInput(input);
  if (!deadLetter.workflowId) throw new Error("workflowId is required");
  if (!deadLetter.kind) throw new Error("kind is required");
  if (!deadLetter.refId) throw new Error("refId is required");
  const generatedAt = nowIso();
  const readModel = new WorkflowReadModel({ dbFile: paths.dbFile });
  const evidence = await readModel.deadLetterEvidence({
    workflowId: deadLetter.workflowId,
    kind: deadLetter.kind,
    refId: deadLetter.refId,
    messageFlowStuckMinutes: input.messageFlowStuckMinutes || input.message_flow_stuck_minutes
  });
  const candidate = evidence.incidentCandidate || null;
  const incidentId = deadLetter.incidentId || deterministicDeadLetterIncidentId(deadLetter);
  const violations = [];
  if (!evidence.found || !candidate) {
    violations.push({ code: "dead_letter_not_found", detail: "selected row no longer matches the current dead-letter predicate" });
  }
  if (candidate && candidate.writeMode !== "read_only_preview") {
    violations.push({ code: "candidate_write_mode_invalid", detail: `expected read_only_preview, got ${candidate.writeMode || "<empty>"}` });
  }
  return {
    schemaVersion: "workflow_dead_letter_incident_preview.v1",
    action: "workflow.incident.from_dead_letter.preview",
    preview: true,
    readOnly: true,
    eligible: violations.length === 0,
    generatedAt,
    workflowId: deadLetter.workflowId,
    kind: deadLetter.kind,
    refId: deadLetter.refId,
    incidentId,
    riskTier: "P2-medium",
    humanGateRequired: true,
    catClawAuditRequired: true,
    deadLetterEvidence: evidence,
    incidentCandidate: candidate,
    wouldWriteIncident: candidate ? {
      incidentId,
      status: deadLetterIncidentStatus(candidate),
      mode: deadLetterIncidentMode(candidate),
      affectedPlanes: candidate.affectedPlanes || [],
      summary: deadLetterIncidentSummary(candidate, input),
      payloadKeys: ["deadLetter", "incidentCandidate", "evidenceRefs", "humanGateId", "catClawAuditId", "operatorReason"]
    } : null,
    wouldCreateHumanGateRequest: false,
    wouldRetryOrRepair: false,
    wouldMutate: {
      incidentStates: violations.length === 0 ? 1 : 0,
      workflowEvents: violations.length === 0 ? 1 : 0,
      workflowRuns: 0,
      dispatches: 0,
      runtimeRuns: 0,
      outbox: 0,
      humanGateButtons: 0,
      sideEffects: 0
    },
    requiredEvidence: [
      "humanGateId or Flashcat original words",
      "catClawAuditId or secretaryAuditId",
      "operatorReason",
      "current workflow_dead_letter_evidence.v1 match"
    ],
    violations,
    limitations: [
      "Preview is read-only and does not persist incident state.",
      "Execution creates or updates only incident state/artifacts and the incident workflow event.",
      "Execution does not retry jobs, clear leases, resend Telegram, resume Human Gate, mutate side effects, or change workflow status."
    ],
    dbFile: paths.dbFile
  };
}

async function workflowIncidentFromDeadLetter(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const preview = await workflowIncidentFromDeadLetterPreview(rootDir, input);
  if (!preview.eligible) {
    throw new Error(`dead-letter incident is not eligible: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  const reason = String(input.operatorReason || input.operator_reason || input.reason || "").trim();
  if (!reason) throw new Error("operatorReason is required for dead-letter incident creation");
  const redactedReason = redactSensitiveTextForPersistence(reason);
  const candidate = preview.incidentCandidate;
  const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
  const catClawAuditId = String(input.catClawAuditId || input.cat_claw_audit_id || input.secretaryAuditId || input.secretary_audit_id || "").trim();
  const record = await incidentState(rootDir, {
    ...input,
    workflowRootDir: paths.root,
    incidentId: preview.incidentId,
    workflowId: preview.workflowId,
    status: deadLetterIncidentStatus(candidate),
    mode: deadLetterIncidentMode(candidate),
    affectedPlanes: candidate.affectedPlanes || [],
    summary: deadLetterIncidentSummary(candidate, input),
    commander: input.commander || input.actor || permissionDecision?.caller?.agentId || "cat_claw",
    impact: input.impact || `Dead-letter item requires governed incident tracking: ${preview.kind}/${preview.refId}`,
    currentHypothesis: input.currentHypothesis || input.current_hypothesis || "Dead-letter/stuck attention row remains current at incident creation time.",
    mitigation: input.mitigation || "No automatic repair performed. Track evidence, ownership, and governed next action.",
    rollbackOptions: input.rollbackOptions || input.rollback_options || candidate.rollbackBoundary || "",
    exitCriteria: input.exitCriteria || input.exit_criteria || (candidate.exitCriteria || []).join("\n"),
    timeline: [
      `${preview.generatedAt} dead-letter incident linked from ${preview.kind}/${preview.refId}`,
      `${nowIso()} operator reason recorded: ${redactedReason}`
    ],
    payload: redactSensitiveForPersistence({
      schemaVersion: "workflow_dead_letter_incident_link.v1",
      deadLetter: {
        workflowId: preview.workflowId,
        kind: preview.kind,
        refId: preview.refId
      },
      incidentCandidate: candidate,
      deadLetterEvidence: preview.deadLetterEvidence,
      evidenceRefs: candidate.evidenceRefs || [],
      humanGateId,
      catClawAuditId,
      operatorReason: redactedReason,
      permissionPolicyOutcome: permissionDecision?.policyOutcome || "",
      createdByAction: "workflow.incident.from_dead_letter"
    })
  });
  return {
    ...record,
    schemaVersion: "workflow_dead_letter_incident_link_result.v1",
    action: "workflow.incident.from_dead_letter",
    workflowId: preview.workflowId,
    kind: preview.kind,
    refId: preview.refId,
    incidentCandidate: candidate,
    deadLetterEvidenceStatus: preview.deadLetterEvidence.status,
    writeBoundary: "incident_state_only",
    didRetryOrRepair: false
  };
}

function closeoutPackageKindForAction(action) {
  const canonical = canonicalWorkflowAction(action || "");
  if (canonical === "workflow.incident.closeout.human_gate_package.preview") return "human_gate_package";
  return "cat_claw_report";
}

function closeoutPackageKindFromInput(input = {}, action = "") {
  const raw = String(input.packageKind || input.package_kind || input.kind || "").trim();
  if (["human_gate_package", "human-gate-package", "hgate", "human_gate"].includes(raw)) return "human_gate_package";
  if (["cat_claw_report", "cat-claw-report", "cat_claw", "report", "secretary_report"].includes(raw)) return "cat_claw_report";
  return closeoutPackageKindForAction(action);
}

function closeoutEvidenceRefs(closeout = {}) {
  const refs = closeout.refs || {};
  return [
    refs.incidentId ? `incident:${refs.incidentId}` : "",
    refs.deadLetter?.kind && refs.deadLetter?.refId ? `dead-letter:${refs.deadLetter.kind}:${refs.deadLetter.refId}` : "",
    refs.humanGateId ? `human-gate:${refs.humanGateId}` : "",
    refs.catClawAuditId ? `cat-claw-audit:${refs.catClawAuditId}` : "",
    ...(refs.workflowEventIds || []).slice(0, 8).map((id) => `workflow-event:${id}`),
    ...(refs.checkpointIds || []).slice(0, 5).map((id) => `checkpoint:${id}`)
  ].filter(Boolean);
}

function closeoutDraftOptions(closeout = {}) {
  const failed = Number(closeout.counts?.failed || 0);
  return [
    {
      optionId: "A",
      optionKey: "A",
      title: "批准收口并归档",
      style: "success",
      decisionStatus: "approved",
      role: "approve_option",
      summary: failed
        ? "仅在补齐失败检查项后可批准；当前预览把缺口列入 evidenceGaps。"
        : "确认证据链满足收口条件，由猫爪提交最终中文收口并保留 checkpoint/resume 路径。",
      prompt: "批准本次 incident closeout，允许猫爪以该证据包为依据准备正式收口汇报。",
      rollback: "如发现证据缺口或投递异常，停止 Human Gate 投递并退回猫之脑补证。"
    },
    {
      optionId: "B",
      optionKey: "B",
      title: "退回补证后再提交",
      style: "success",
      decisionStatus: "approved",
      role: "approve_option",
      summary: "要求猫之脑补齐失败检查项、刷新 receipt/checkpoint 或补充 rollback/side-effect 边界后再提交。",
      prompt: "批准退回补证路线：猫之脑补齐证据，猫爪复核通过后重新提交 Human Gate。",
      rollback: "补证失败或 evidenceGaps 仍存在时，保持 incident monitoring，不进入正式 closeout。"
    },
    {
      optionId: "C",
      optionKey: "C",
      title: "继续监控不关闭",
      style: "success",
      decisionStatus: "approved",
      role: "approve_option",
      summary: "保持 incident 处于 monitoring/active，等待下一轮 workflow evidence 和猫爪复核。",
      prompt: "批准继续监控路线：暂不关闭 incident，下一轮由猫之脑补充运行证据并由猫爪复核。",
      rollback: "如监控期间出现新 dead-letter 或 side-effect uncertainty，升级为新的 incident 复核。"
    },
    {
      optionId: "pause",
      title: "暂停工作流",
      style: "primary",
      decisionStatus: "paused",
      role: "pause",
      summary: "暂停相关 workflow 推进，保留恢复路径和当前证据包。",
      prompt: "暂停该 workflow；不要继续自动推进，等待闪电猫新的明确指令。",
      rollback: "恢复前必须重新检查 closeout artifact、receipt、checkpoint 和 pending Human Gate 状态。"
    },
    {
      optionId: "terminate",
      title: "终止工作流",
      style: "danger",
      decisionStatus: "terminated",
      role: "terminate",
      summary: "表示本段工作已完成且复核满足要求，进入归档、checkpoint 和可恢复记录流程。",
      prompt: "终止该 workflow 并进入猫爪/猫之脑收口、归档、checkpoint 和可恢复记录流程。",
      rollback: "终止不是删除；后续只能按 workflow id、incident id 或 checkpoint 恢复。"
    }
  ];
}

function closeoutReportDraft(closeout = {}, packageKind = "cat_claw_report") {
  const incident = closeout.selectedIncident || {};
  const refs = closeout.refs || {};
  const checklist = closeout.checklist || [];
  const evidenceGaps = checklist.filter((row) => row.status === "fail").map((row) => ({
    key: row.key,
    label: row.label,
    detail: row.detail,
    severity: row.severity
  }));
  const warnings = checklist.filter((row) => row.status === "warn").map((row) => ({
    key: row.key,
    label: row.label,
    detail: row.detail,
    severity: row.severity
  }));
  const humanGatePackage = packageKind === "human_gate_package";
  const title = humanGatePackage
    ? `Human Gate 收口证据包预览：${incident.incidentId || closeout.incidentId || "unknown"}`
    : `猫爪收口复核报告预览：${incident.incidentId || closeout.incidentId || "unknown"}`;
  const decision = evidenceGaps.length
    ? "当前不应提交最终 Human Gate；需要先补齐失败检查项。"
    : warnings.length
      ? "可进入猫爪收口复核，但提交前应处理或说明 warning。"
      : "证据链满足收口预览条件，可由猫爪继续准备正式中文汇报。";
  return redactSensitiveForPersistence({
    title,
    language: "zh-CN",
    audience: humanGatePackage ? "flashcat_human_gate" : "cat_claw",
    summaryZh: `workflow ${closeout.workflowId || "-"} 的 incident ${incident.incidentId || "-"} 当前状态为 ${incident.status || "-"} / ${incident.mode || "-"}；closeout 状态为 ${closeout.status || "unknown"}。${decision}`,
    decision,
    incident: {
      incidentId: incident.incidentId || closeout.incidentId || "",
      status: incident.status || "",
      mode: incident.mode || "",
      summary: incident.summary || "",
      updatedAt: incident.updatedAt || ""
    },
    evidenceRefs: closeoutEvidenceRefs(closeout),
    checklist: checklist.map((row) => ({
      key: row.key,
      label: row.label,
      status: row.status,
      severity: row.severity,
      detail: row.detail,
      refs: row.refs || []
    })),
    evidenceGaps,
    warnings,
    rollbackBoundary: incident.rollbackOptions || refs.deadLetter?.rollbackBoundary || closeout.deadLetterEvidence?.incidentCandidate?.rollbackBoundary || "",
    receiptSummary: refs.receiptSummary || {},
    humanGateOptions: humanGatePackage ? closeoutDraftOptions(closeout) : [],
    nextActions: humanGatePackage ? [
      "由猫爪确认三方案、暂停、终止按钮结构和中文正文完整。",
      "如 evidenceGaps 为空，才可进入正式 Human Gate 投递；本预览不创建请求、不发送 Telegram。",
      "若闪电猫选择退回或暂停，保留 workflow id、incident id、checkpoint/resume 证据。"
    ] : [
      "猫爪复核 checklist、timeline、Human Gate evidence、Cat Claw audit 和 rollback boundary。",
      "如 evidenceGaps 非空，打回猫之脑补证；如仅有 warning，决定是否说明后提交。",
      "通过后再准备 Human Gate package；本预览不派发猫爪、不写 artifact。"
    ]
  });
}

async function workflowIncidentCloseoutPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const action = canonicalWorkflowAction(input.action || "workflow.incident.closeout.cat_claw_report.preview");
  const packageKind = closeoutPackageKindForAction(action);
  const incidentId = String(input.incidentId || input.incident_id || "").trim();
  const readModel = new WorkflowReadModel({ dbFile: paths.dbFile });
  const closeout = await readModel.incidentCloseout(workflowId, {
    incidentId,
    limit: input.limit || input.timelineLimit || input.timeline_limit
  });
  const failedRequired = (closeout.checklist || []).filter((row) => row.status === "fail" && row.severity !== "warning");
  const warnings = (closeout.checklist || []).filter((row) => row.status === "warn");
  const violations = [];
  if (!closeout.selectedIncident) {
    violations.push({ code: "incident_not_found", detail: "No incident state is linked to this workflow or incident id." });
  }
  for (const row of failedRequired) {
    violations.push({ code: `missing_${row.key}`, detail: row.detail || row.label || row.key });
  }
  const draft = closeoutReportDraft(closeout, packageKind);
  return {
    schemaVersion: "workflow_incident_closeout_preview.v1",
    action,
    preview: true,
    readOnly: true,
    writeMode: "read_only_closeout_package_preview",
    generatedAt: nowIso(),
    workflowId,
    incidentId: closeout.incidentId || incidentId,
    packageKind,
    eligible: violations.length === 0,
    closeoutStatus: closeout.status,
    closeoutCounts: closeout.counts || {},
    wouldCreate: {
      artifacts: 0,
      workflowEvents: 0,
      incidentStates: 0,
      humanGateRequests: 0,
      humanGateButtons: 0,
      telegramOutbox: 0,
      runtimeDispatches: 0,
      catClawCloseoutReport: packageKind === "cat_claw_report",
      humanGateCloseoutPackage: packageKind === "human_gate_package"
    },
    reportDraft: draft,
    requiredEvidence: failedRequired.map((row) => ({
      key: row.key,
      label: row.label,
      detail: row.detail,
      severity: row.severity
    })),
    warnings: warnings.map((row) => ({
      key: row.key,
      label: row.label,
      detail: row.detail,
      severity: row.severity
    })),
    violations,
    limitations: [
      "Preview is read-only and does not persist reports, Human Gate records, buttons, Telegram outbox, workflow events, or incident state.",
      "Cat Claw closeout must still be reviewed by cat_claw before any formal Human Gate package is delivered.",
      "Human Gate delivery remains button-first and requires a separate governed write path with Flashcat original words."
    ],
    closeout,
    dbFile: paths.dbFile
  };
}

function renderCloseoutArtifactMarkdown(record = {}) {
  const draft = record.reportDraft || {};
  const incident = draft.incident || {};
  const options = draft.humanGateOptions || [];
  const gaps = draft.evidenceGaps || [];
  const warnings = draft.warnings || [];
  const refs = draft.evidenceRefs || [];
  return `# ${draft.title || "Incident Closeout Artifact"}

## Summary

${draft.summaryZh || "-"}

## Decision

${draft.decision || "-"}

## Incident

- workflowId: ${record.workflowId || "-"}
- incidentId: ${incident.incidentId || record.incidentId || "-"}
- status: ${incident.status || "-"}
- mode: ${incident.mode || "-"}
- packageKind: ${record.packageKind || "-"}
- artifactId: ${record.artifactId || "-"}
- persistedAt: ${record.persistedAt || "-"}
- createdBy: ${record.createdBy || "-"}

## Human Gate Options

${options.length ? options.map((item) => `- ${item.optionId || "-"} / ${item.style || "-"} / ${item.title || "-"}: ${item.summary || ""}`).join("\n") : "- none"}

## Evidence Gaps

${gaps.length ? gaps.map((item) => `- ${item.key || "-"} (${item.severity || "-"}): ${item.detail || item.label || ""}`).join("\n") : "- none"}

## Warnings

${warnings.length ? warnings.map((item) => `- ${item.key || "-"}: ${item.detail || item.label || ""}`).join("\n") : "- none"}

## Evidence Refs

${refs.length ? refs.map((item) => `- ${item}`).join("\n") : "- none"}

## Boundaries

- writeBoundary: ${record.writeBoundary || "closeout_artifact_only"}
- noIncidentStateMutation: true
- noWorkflowStatusMutation: true
- noHumanGateMutation: true
- noTelegramOutboxMutation: true
- noRuntimeDispatchMutation: true
`;
}

async function workflowIncidentCloseoutArtifactPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const action = canonicalWorkflowAction(input.action || "workflow.incident.closeout.artifact.preview");
  const packageKind = closeoutPackageKindFromInput(input, action);
  const packageAction = packageKind === "human_gate_package"
    ? "workflow.incident.closeout.human_gate_package.preview"
    : "workflow.incident.closeout.cat_claw_report.preview";
  const base = await workflowIncidentCloseoutPreview(rootDir, { ...input, action: packageAction });
  const operatorReason = String(input.operatorReason || input.operator_reason || input.reason || "").trim();
  const hasHumanGateEvidence = permissionEvidencePresent(input, [
    "human_gate_id",
    "humanGateId",
    "human_gate_evidence",
    "humanGateEvidence",
    "risk_decision_id",
    "riskDecisionId",
    "flashcat_original_words",
    "flashcatOriginalWords"
  ]);
  const hasCatClawAudit = permissionEvidencePresent(input, [
    "cat_claw_audit_id",
    "catClawAuditId",
    "cat_claw_audit",
    "catClawAudit",
    "secretary_audit_id",
    "secretaryAuditId"
  ]);
  const writeViolations = [];
  if (!operatorReason) writeViolations.push({ code: "operator_reason_required", detail: "operatorReason is required before persisting a closeout artifact" });
  if (!hasHumanGateEvidence) writeViolations.push({ code: "human_gate_evidence_required", detail: "Human Gate evidence or Flashcat original words are required by policy" });
  if (!hasCatClawAudit) writeViolations.push({ code: "cat_claw_audit_required", detail: "Cat Claw audit or secretary audit evidence is required by policy" });
  const artifactId = String(input.artifactId || input.artifact_id || safeId("incident.closeout")).trim();
  return {
    schemaVersion: "workflow_incident_closeout_artifact_preview.v1",
    action,
    preview: true,
    readOnly: true,
    writeMode: "read_only_closeout_artifact_preview",
    generatedAt: nowIso(),
    workflowId: base.workflowId,
    incidentId: base.incidentId,
    artifactId,
    packageKind,
    eligible: base.eligible,
    writeReady: base.eligible && writeViolations.length === 0,
    closeoutStatus: base.closeoutStatus,
    wouldCreate: {
      artifactIndexRows: base.eligible ? 2 : 0,
      files: base.eligible ? 2 : 0,
      workflowEvents: base.eligible ? 1 : 0,
      incidentStates: 0,
      humanGateRequests: 0,
      humanGateButtons: 0,
      telegramOutbox: 0,
      runtimeDispatches: 0,
      workflowStatusUpdates: 0
    },
    reportDraft: base.reportDraft,
    requiredEvidence: base.requiredEvidence || [],
    warnings: base.warnings || [],
    violations: [...(base.violations || []), ...writeViolations],
    limitations: [
      "Preview is read-only and does not persist the closeout artifact.",
      "Execution writes only JSON/Markdown closeout artifacts, artifact_index rows, and one audit workflow event.",
      "Execution does not close incidents, create Human Gate requests/buttons, dispatch Cat Claw, enqueue Telegram, retry jobs, or change workflow status."
    ],
    closeoutPreview: base,
    dbFile: paths.dbFile
  };
}

async function workflowIncidentCloseoutArtifact(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const preview = await workflowIncidentCloseoutArtifactPreview(rootDir, input);
  if (!preview.eligible) {
    throw new Error(`closeout artifact is not eligible: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  if (!preview.writeReady) {
    throw new Error(`closeout artifact is not write-ready: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  const operatorReason = String(input.operatorReason || input.operator_reason || input.reason || "").trim();
  if (!operatorReason) throw new Error("operatorReason is required for closeout artifact persistence");
  const createdAt = nowIso();
  const artifactId = cleanFileSegment(preview.artifactId || safeId("incident.closeout"));
  const createdBy = input.createdBy || input.created_by || input.actor || permissionDecision?.caller?.agentId || "cat_claw";
  const record = redactSensitiveForPersistence({
    schemaVersion: "workflow_incident_closeout_artifact.v1",
    artifactId,
    workflowId: preview.workflowId,
    incidentId: preview.incidentId,
    packageKind: preview.packageKind,
    persistedAt: createdAt,
    createdBy,
    humanGateId: input.humanGateId || input.human_gate_id || "",
    catClawAuditId: input.catClawAuditId || input.cat_claw_audit_id || input.secretaryAuditId || input.secretary_audit_id || "",
    operatorReason: redactSensitiveTextForPersistence(operatorReason),
    permissionPolicyOutcome: permissionDecision?.policyOutcome || "",
    writeBoundary: "closeout_artifact_only",
    reportDraft: preview.reportDraft,
    closeout: preview.closeoutPreview?.closeout || null,
    limitations: preview.limitations
  });
  const packageDir = path.join(paths.bridgeDir, "incident-closeout");
  const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, artifactId, record);
  const markdownRelPath = await writeTextArtifact(paths.root, packageDir, artifactId, "md", renderCloseoutArtifactMarkdown({ ...record, jsonRelPath }));
  const summary = record.reportDraft?.title || `Incident closeout artifact ${record.incidentId || artifactId}`;
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${artifactId}.json`)}, NULL, ${sqlValue(record.workflowId)}, ${sqlValue(`incident_closeout_${record.packageKind}_json`)}, ${sqlValue(jsonRelPath)}, ${sqlValue(summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${artifactId}.md`)}, NULL, ${sqlValue(record.workflowId)}, ${sqlValue(`incident_closeout_${record.packageKind}_markdown`)}, ${sqlValue(markdownRelPath)}, ${sqlValue(summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
  await appendWorkflowEvent(paths, {
    eventType: "incident.closeout_artifact.persisted",
    status: "persisted",
    workflowId: record.workflowId,
    incidentId: record.incidentId,
    actor: createdBy,
    sourceRuntime: "workflow",
    sourceAgent: createdBy,
    artifactRef: markdownRelPath,
    payload: {
      artifactId,
      packageKind: record.packageKind,
      jsonRelPath,
      markdownRelPath,
      writeBoundary: "closeout_artifact_only"
    },
    createdAt
  });
  return {
    schemaVersion: "workflow_incident_closeout_artifact_result.v1",
    action: "workflow.incident.closeout.artifact",
    workflowId: record.workflowId,
    incidentId: record.incidentId,
    artifactId,
    packageKind: record.packageKind,
    jsonRelativePath: jsonRelPath,
    markdownRelativePath: markdownRelPath,
    writeBoundary: "closeout_artifact_only",
    didCloseIncident: false,
    didCreateHumanGate: false,
    didDispatchRuntime: false,
    didSendTelegram: false,
    dbFile: paths.dbFile
  };
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

function closeoutArtifactIdInputs(input = {}) {
  const raw = firstText(
    input.closeoutArtifactId,
    input.closeout_artifact_id,
    input.artifactId,
    input.artifact_id,
    input.closeoutArtifact,
    input.closeout_artifact
  );
  if (!raw) return [];
  const text = String(raw).trim();
  const base = text.replace(/\.(json|md|markdown)$/i, "");
  return Array.from(new Set([
    text,
    `${base}.json`,
    cleanFileSegment(base),
    `${cleanFileSegment(base)}.json`
  ].filter(Boolean)));
}

async function readCloseoutArtifactCandidate(paths, input = {}) {
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  const incidentId = String(input.incidentId || input.incident_id || "").trim();
  const candidates = closeoutArtifactIdInputs(input);
  const explicit = candidates.length > 0;
  const rows = explicit
    ? await sqlite(paths.dbFile, `
SELECT artifact_id, workflow_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE artifact_id IN (${candidates.map((item) => sqlValue(item)).join(",")})
   OR path IN (${candidates.map((item) => sqlValue(item)).join(",")})
ORDER BY created_at DESC
LIMIT 20;`, { json: true })
    : await sqlite(paths.dbFile, `
SELECT artifact_id, workflow_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE kind='incident_closeout_human_gate_package_json'
  ${workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : ""}
ORDER BY created_at DESC
LIMIT 100;`, { json: true });
  for (const row of rows) {
    if (row.kind !== "incident_closeout_human_gate_package_json") continue;
    const filePath = artifactPathInsideRoot(paths.root, row.path);
    if (!filePath) continue;
    let record = null;
    try {
      record = parseJsonValue(await fs.readFile(filePath, "utf8"), null);
    } catch {
      record = null;
    }
    if (!record || typeof record !== "object") continue;
    if (workflowId && String(record.workflowId || "") !== workflowId) continue;
    if (incidentId && String(record.incidentId || "") !== incidentId) continue;
    const markdownRows = await sqlite(paths.dbFile, `
SELECT artifact_id, path
FROM artifact_index
WHERE artifact_id=${sqlValue(String(row.artifact_id || "").replace(/\.json$/i, ".md"))}
LIMIT 1;`, { json: true });
    return {
      row,
      record,
      jsonPath: row.path,
      markdownPath: markdownRows[0]?.path || "",
      filePath
    };
  }
  return null;
}

function closeoutArtifactButtonInputs(record = {}, artifactRef = "") {
  const options = record.reportDraft?.humanGateOptions || [];
  return options.map((option) => ({
    ...option,
    key: option.optionKey || option.optionId || option.key,
    optionKey: option.optionKey || option.optionId || option.key,
    label: option.label || option.title || option.optionId || "",
    artifactRef,
    payload: {
      ...(option.payload || {}),
      optionId: option.optionId || "",
      optionKey: option.optionKey || option.optionId || option.key || "",
      title: option.title || "",
      summary: option.summary || "",
      prompt: option.prompt || "",
      rollback: option.rollback || "",
      artifactRef
    }
  }));
}

function closeoutHumanGateWriteEvidence(input = {}) {
  return {
    humanGateEvidence: firstText(
      input.humanGateEvidence,
      input.human_gate_evidence,
      input.existingHumanGateId,
      input.existing_human_gate_id,
      input.evidenceHumanGateId,
      input.evidence_human_gate_id,
      input.humanGateId,
      input.human_gate_id,
      input.riskDecisionId,
      input.risk_decision_id,
      input.flashcatOriginalWords,
      input.flashcat_original_words
    ),
    catClawAuditId: firstText(
      input.catClawAuditId,
      input.cat_claw_audit_id,
      input.catClawAudit,
      input.cat_claw_audit,
      input.secretaryAuditId,
      input.secretary_audit_id
    ),
    operatorReason: String(input.operatorReason || input.operator_reason || input.reason || "").trim()
  };
}

function closeoutHumanGateRequestInput(record = {}, artifact = {}, input = {}) {
  const workflowId = String(record.workflowId || input.workflowId || input.workflow_id || "").trim();
  const incidentId = String(record.incidentId || input.incidentId || input.incident_id || "").trim();
  const artifactRef = artifact.markdownPath || artifact.jsonPath || "";
  const evidence = closeoutHumanGateWriteEvidence(input);
  return {
    workflowId,
    meetingId: workflowId,
    gateType: "incident_closeout",
    humanGateStageKey: `incident-closeout:${cleanFileSegment(incidentId || "unknown")}`,
    title: record.reportDraft?.title || "Human Gate 收口确认",
    summary: record.reportDraft?.summaryZh || "",
    text: record.reportDraft?.summaryZh || "",
    artifactRef,
    buttons: closeoutArtifactButtonInputs(record, artifactRef),
    addDefaultControls: true,
    from: "cat_claw",
    sourceAgent: "cat_claw",
    actor: input.actor || input.createdBy || input.created_by || "cat_claw",
    autoDeliver: false,
    auto_deliver: false,
    deliver: false,
    humanGateId: firstText(input.requestHumanGateId, input.request_human_gate_id, input.newHumanGateId, input.new_human_gate_id),
    payload: {
      closeoutArtifactId: artifact.row?.artifact_id || "",
      closeoutArtifactRef: artifactRef,
      closeoutIncidentId: incidentId,
      closeoutPackageKind: record.packageKind || "",
      humanGateEvidence: evidence.humanGateEvidence,
      catClawAuditId: evidence.catClawAuditId,
      operatorReason: redactSensitiveTextForPersistence(evidence.operatorReason),
      writeBoundary: "human_gate_request_only"
    }
  };
}

async function workflowIncidentCloseoutHumanGateRequestPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  const incidentId = String(input.incidentId || input.incident_id || "").trim();
  const generatedAt = nowIso();
  const artifact = await readCloseoutArtifactCandidate(paths, input);
  const violations = [];
  const warnings = [];
  if (!artifact) {
    violations.push({ code: "closeout_artifact_not_found", detail: "No persisted human_gate_package closeout artifact matches the workflow/incident/artifact selector." });
  }
  const record = artifact?.record || {};
  if (artifact && record.schemaVersion !== "workflow_incident_closeout_artifact.v1") {
    violations.push({ code: "invalid_closeout_artifact_schema", detail: `Expected workflow_incident_closeout_artifact.v1, got ${record.schemaVersion || "<empty>"}.` });
  }
  if (artifact && record.packageKind !== "human_gate_package") {
    violations.push({ code: "invalid_closeout_package_kind", detail: `Expected human_gate_package, got ${record.packageKind || "<empty>"}.` });
  }
  if (workflowId && artifact && String(record.workflowId || "") !== workflowId) {
    violations.push({ code: "workflow_mismatch", detail: "Closeout artifact workflowId does not match the request." });
  }
  if (incidentId && artifact && String(record.incidentId || "") !== incidentId) {
    violations.push({ code: "incident_mismatch", detail: "Closeout artifact incidentId does not match the request." });
  }
  const requestInput = artifact ? closeoutHumanGateRequestInput(record, artifact, input) : {
    workflowId: record.workflowId || workflowId,
    meetingId: record.workflowId || workflowId,
    gateType: "incident_closeout",
    humanGateStageKey: `incident-closeout:${cleanFileSegment(record.incidentId || incidentId || "unknown")}`,
    title: record.reportDraft?.title || "Human Gate 收口确认",
    summary: record.reportDraft?.summaryZh || "",
    text: record.reportDraft?.summaryZh || "",
    artifactRef: "",
    buttons: [],
    addDefaultControls: true
  };
  const buttons = humanGateButtonOptions(requestInput);
  const audit = combineHumanGateAudits(
    auditHumanGatePlanOptions(buttons),
    auditHumanGatePlanDetails(buttons),
    auditHumanGatePrimaryLanguage(requestInput, buttons)
  );
  if (!audit.ok) {
    violations.push({ code: "human_gate_audit_failed", detail: audit.reason || "Human Gate request draft does not satisfy button-first audit." });
  }
  const webApp = await humanGateWebAppConfig(input);
  if (!webApp.enabled) {
    warnings.push({ code: "web_app_base_url_missing", detail: "Token-bound Telegram Web App base URL is not configured; formal delivery would need configured Web App or governed token fallback." });
  }
  const writeEvidence = closeoutHumanGateWriteEvidence(input);
  const writeViolations = [];
  if (!writeEvidence.operatorReason) writeViolations.push({ code: "operator_reason_required", detail: "operatorReason is required before creating the formal Human Gate request." });
  if (!writeEvidence.humanGateEvidence) writeViolations.push({ code: "human_gate_evidence_required", detail: "Existing Human Gate evidence, risk decision, or Flashcat original words are required by policy." });
  if (!writeEvidence.catClawAuditId) writeViolations.push({ code: "cat_claw_audit_required", detail: "Cat Claw audit or secretary audit evidence is required by policy." });
  const planButtons = humanGatePlanOptionButtons(buttons);
  const controlRoles = new Set(buttons.filter((button) => humanGateButtonIsControl(button)).map((button) => humanGateButtonRole(button)));
  const eligible = violations.length === 0;
  return {
    schemaVersion: "workflow_incident_closeout_human_gate_request_preview.v1",
    action: "workflow.incident.closeout.human_gate_request.preview",
    preview: true,
    readOnly: true,
    writeMode: "read_only_human_gate_request_preview",
    generatedAt,
    workflowId: record.workflowId || workflowId,
    incidentId: record.incidentId || incidentId,
    closeoutArtifactId: artifact?.row?.artifact_id || "",
    packageKind: record.packageKind || "",
    eligible,
    requestReady: eligible,
    writeReady: eligible && writeViolations.length === 0,
    audit,
    buttonSummary: {
      total: buttons.length,
      planCount: planButtons.length,
      controlRoles: Array.from(controlRoles).sort(),
      hasA: planButtons.some((button, index) => humanGatePlanKey(button, index < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] : String(index + 1)) === "A"),
      hasB: planButtons.some((button, index) => humanGatePlanKey(button, index < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] : String(index + 1)) === "B"),
      hasC: planButtons.some((button, index) => humanGatePlanKey(button, index < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] : String(index + 1)) === "C"),
      hasPause: controlRoles.has("pause"),
      hasTerminate: controlRoles.has("terminate"),
      hasReject: controlRoles.has("reject")
    },
    wouldCreate: {
      humanGateRecords: eligible ? 1 : 0,
      humanGateButtons: eligible ? buttons.length : 0,
      meetingControlEvents: eligible ? 1 : 0,
      telegramOutbox: eligible ? 1 : 0,
      workflowEvents: eligible ? 1 : 0,
      runtimeDispatches: 0,
      incidentStates: 0,
      workflowStatusUpdates: 0,
      telegramDeliveries: 0
    },
    requestDraft: redactSensitiveForPersistence({
      action: "human_gate.request",
      workflowId: requestInput.workflowId,
      meetingId: requestInput.meetingId,
      gateType: requestInput.gateType,
      humanGateStageKey: requestInput.humanGateStageKey,
      title: requestInput.title,
      summary: requestInput.summary,
      text: requestInput.text,
      artifactRef: requestInput.artifactRef,
      buttons
    }),
    reportDraft: redactSensitiveForPersistence({
      ...(record.reportDraft || {}),
      humanGateOptions: buttons
    }),
    artifact: artifact ? {
      artifactId: artifact.row.artifact_id,
      jsonPath: artifact.jsonPath,
      markdownPath: artifact.markdownPath,
      createdAt: artifact.row.created_at,
      createdBy: artifact.row.created_by
    } : null,
    violations: [...violations, ...writeViolations],
    writeViolations,
    warnings,
    limitations: [
      "Preview is read-only and does not create Human Gate records, buttons, Telegram outbox, workflow events, or incident state.",
      "Formal Human Gate request creation must use a separate governed write path and preserve button-first token-bound review.",
      "Preview does not dispatch Cat Claw, deliver Telegram, close incidents, archive workflows, retry jobs, or mutate side effects."
    ],
    dbFile: paths.dbFile
  };
}

async function workflowIncidentCloseoutHumanGateRequest(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const preview = await workflowIncidentCloseoutHumanGateRequestPreview(rootDir, input);
  if (!preview.eligible) {
    throw new Error(`closeout Human Gate request is not eligible: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  if (!preview.writeReady) {
    throw new Error(`closeout Human Gate request is not write-ready: ${(preview.writeViolations || preview.violations || []).map((item) => item.code).join(",") || "unknown"}`);
  }
  const artifact = await readCloseoutArtifactCandidate(paths, input);
  if (!artifact) throw new Error("closeout artifact not found");
  const requestInput = closeoutHumanGateRequestInput(artifact.record, artifact, {
    ...input,
    actor: input.actor || permissionDecision?.caller?.agentId || "cat_claw"
  });
  const result = await humanGateRequest(rootDir, requestInput);
  return {
    schemaVersion: "workflow_incident_closeout_human_gate_request_result.v1",
    action: "workflow.incident.closeout.human_gate_request",
    workflowId: result.workflowId,
    incidentId: artifact.record.incidentId || input.incidentId || input.incident_id || "",
    closeoutArtifactId: artifact.row.artifact_id,
    humanGateId: result.humanGateId,
    gateType: result.gateType,
    stageKey: result.stageKey,
    writeBoundary: "human_gate_request_only",
    reusedStageGate: Boolean(result.reusedStageGate),
    didEnsureHumanGate: true,
    didCreateHumanGate: !Boolean(result.reusedStageGate),
    didCreateHumanGateButtons: Array.isArray(result.buttons),
    humanGateButtonCount: result.buttons?.length || 0,
    didEnsureTelegramOutbox: Boolean(result.telegramOutbox?.outboxId),
    didCreateTelegramOutbox: Boolean(result.telegramOutbox?.outboxId) && !Boolean(result.telegramOutbox?.deduped),
    telegramOutboxDeduped: Boolean(result.telegramOutbox?.deduped),
    telegramOutboxId: result.telegramOutbox?.outboxId || "",
    didSendTelegram: Boolean(result.delivery),
    didDispatchRuntime: false,
    didCloseIncident: false,
    didUpdateWorkflowStatus: false,
    deliveryRequired: Boolean(result.deliveryRequired),
    targetKind: result.targetKind,
    targetRef: result.targetRef,
    dbFile: result.dbFile
  };
}

export async function incidentState(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const incidentId = input.incidentId || input.incident_id || safeId("incident");
  const createdAt = nowIso();
  const existingRows = await sqlite(paths.dbFile, `SELECT status FROM incident_states WHERE incident_id=${sqlValue(incidentId)} LIMIT 1;`, { json: true });
  const previousStatus = existingRows[0]?.status || "";
  const statusRaw = String(input.status || "active").trim();
  const status = INCIDENT_STATUSES.has(statusRaw) ? statusRaw : "active";
  const modeRaw = String(input.mode || (status === "resolved" ? "normal" : "degraded")).trim();
  const mode = INCIDENT_MODES.has(modeRaw) ? modeRaw : "degraded";
  const timeline = toList(input.timeline).length ? toList(input.timeline) : [`${createdAt} ${input.summary || input.text || "incident state recorded"}`];
  const payload = parseJsonValue(input.payload, input.payload || {});
  const record = {
    incidentId,
    status,
    mode,
    affectedPlanes: toList(input.affectedPlanes || input.affected_planes),
    summary: input.summary || input.text || "",
    commander: input.commander || input.actor || "flashcat",
    impact: input.impact || "",
    currentHypothesis: input.currentHypothesis || input.current_hypothesis || "",
    mitigation: input.mitigation || "",
    rollbackOptions: input.rollbackOptions || input.rollback_options || "",
    exitCriteria: input.exitCriteria || input.exit_criteria || "",
    timeline,
    declaredAt: input.declaredAt || input.declared_at || createdAt,
    nextUpdateAt: input.nextUpdateAt || input.next_update_at || "",
    payload,
    updatedAt: createdAt
  };
  const jsonRelPath = await writeJsonArtifact(paths.root, path.join(paths.bridgeDir, "incidents"), incidentId, record);
  const markdownRelPath = await writeTextArtifact(paths.root, path.join(paths.bridgeDir, "incidents"), incidentId, "md", renderIncidentMarkdown(record));
  await sqlite(paths.dbFile, `
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES (${sqlValue(incidentId)}, ${sqlValue(status)}, ${sqlValue(mode)}, ${sqlValue(JSON.stringify(record.affectedPlanes))}, ${sqlValue(record.summary)}, ${sqlValue(record.commander)}, ${sqlValue(record.impact)}, ${sqlValue(record.currentHypothesis)}, ${sqlValue(record.mitigation)}, ${sqlValue(record.rollbackOptions)}, ${sqlValue(record.exitCriteria)}, ${sqlValue(JSON.stringify(timeline))}, ${sqlValue(JSON.stringify({ ...payload, jsonRelPath, markdownRelPath }))}, ${sqlValue(record.declaredAt)}, ${sqlValue(record.nextUpdateAt)}, ${sqlValue(status === "resolved" ? createdAt : "")}, ${sqlValue(createdAt)})
ON CONFLICT(incident_id) DO UPDATE SET
  status=excluded.status,
  mode=excluded.mode,
  affected_planes_json=excluded.affected_planes_json,
  summary=excluded.summary,
  commander=excluded.commander,
  impact=excluded.impact,
  current_hypothesis=excluded.current_hypothesis,
  mitigation=excluded.mitigation,
  rollback_options=excluded.rollback_options,
  exit_criteria=excluded.exit_criteria,
  timeline_json=excluded.timeline_json,
  payload_json=excluded.payload_json,
  next_update_at=excluded.next_update_at,
  resolved_at=excluded.resolved_at,
  updated_at=excluded.updated_at;`);
  await appendWorkflowEvent(paths, {
    eventType: previousStatus ? (status === "resolved" ? "incident.resolved" : "incident.updated") : "incident.created",
    status,
    workflowId: input.workflowId || input.workflow_id || "",
    traceId: input.traceId || input.trace_id || "",
    incidentId,
    actor: record.commander,
    sourceRuntime: "workflow",
    sourceAgent: record.commander,
    previousState: previousStatus,
    nextState: status,
    artifactRef: markdownRelPath,
    payload: {
      mode,
      summary: record.summary,
      affectedPlanes: record.affectedPlanes,
      jsonRelPath,
      markdownRelPath
    },
    createdAt
  });
  return { incidentId, status, mode, relativePath: markdownRelPath, jsonRelativePath: jsonRelPath, markdownRelativePath: markdownRelPath, dbFile: paths.dbFile };
}

export async function runtimeAgentUpsert(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const agent = await ensureRuntimeAgent(paths, { ...input, preserveExisting: true });
  return { ...agent, dbFile: paths.dbFile };
}

export async function meetingRuntimeParticipant(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const runtime = normalizeRuntime(input.runtime || input.runtimeKey || input.runtime_key || input.platform);
  const agentId = normalizeAgentId(input.agentId || input.agent_id);
  const row = await findActiveRuntimeAgent(paths, runtime, agentId);
  if (!row) {
    throw new Error(`meeting runtime participant requires pre-registered active runtime agent: ${runtime}:${agentId}`);
  }
  const agent = { agentKey: row.agent_key, runtime: row.runtime, agentId: row.agent_id };
  const createdAt = nowIso();
  const participantRole = String(input.participantRole || input.participant_role || input.role || "participant").trim();
  await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_participants(meeting_id, agent_key, runtime, agent_id, participant_role, chair, decider, secretary, live_mode, status, metadata_json, created_at, updated_at)
VALUES (${sqlValue(meetingId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(agent.runtime)}, ${sqlValue(agent.agentId)}, ${sqlValue(participantRole)}, ${sqlValue(Boolean(input.chair))}, ${sqlValue(Boolean(input.decider))}, ${sqlValue(Boolean(input.secretary))}, ${sqlValue(input.liveMode || input.live_mode || "transparent")}, ${sqlValue(input.status || "active")}, ${sqlValue(JSON.stringify(parseJsonValue(input.metadata, input.metadata || {})))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(meeting_id, agent_key) DO UPDATE SET
  participant_role=excluded.participant_role,
  chair=excluded.chair,
  decider=excluded.decider,
  secretary=excluded.secretary,
  live_mode=excluded.live_mode,
  status=excluded.status,
  metadata_json=excluded.metadata_json,
  updated_at=excluded.updated_at;`);
  await appendJsonl(path.join(paths.bridgeDir, "participants.jsonl"), { meetingId, ...agent, participantRole, updatedAt: createdAt });
  return { meetingId, ...agent, participantRole, dbFile: paths.dbFile };
}

export async function telegramLiveConfigure(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const createdAt = nowIso();
  const mode = String(input.mode || "transparent").trim();
  const status = String(input.status || "active").trim();
  const target = await resolveTelegramLiveTarget(paths, meetingId, input);
  if (status === "active" && mode !== "silent" && !target.chatId && !target.channelId) {
    throw new Error(`telegram live target is required for active ${mode} meeting: ${meetingId}`);
  }
  const humanGateChannelId = target.humanGateChannelId || input.humanGateChannelId || input.human_gate_channel_id || target.channelId || target.chatId || "";
  await sqlite(paths.dbFile, `
INSERT INTO telegram_live_links(meeting_id, chat_id, channel_id, mode, status, human_gate_channel_id, created_at, updated_at)
VALUES (${sqlValue(meetingId)}, ${sqlValue(target.chatId)}, ${sqlValue(target.channelId)}, ${sqlValue(mode)}, ${sqlValue(status)}, ${sqlValue(humanGateChannelId)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(meeting_id) DO UPDATE SET
  chat_id=excluded.chat_id,
  channel_id=excluded.channel_id,
  mode=excluded.mode,
  status=excluded.status,
  human_gate_channel_id=excluded.human_gate_channel_id,
  updated_at=excluded.updated_at;`);
  return { meetingId, chatId: target.chatId, channelId: target.channelId, humanGateChannelId, mode, status, targetSource: target.source, dbFile: paths.dbFile };
}

async function telegramLinkFor(paths, meetingId) {
  const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_live_links WHERE meeting_id=${sqlValue(meetingId)} AND status='active' LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function meetingDispatch(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || "main");
  const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
  const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
  const requestedRuntime = String(input.runtime || "").trim();
  const runtime = requestedRuntime ? normalizeRuntime(requestedRuntime) : "";
  if (runtime === "openclaw_route_shell") {
    return routeShellIngest(rootDir, {
      ...input,
      runtime: undefined,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      routeAgentId: agentId,
      text: input.prompt || input.text || "",
      sourceSystem: input.sourceSystem || input.source_system || input.source || "workflow_dispatch",
      sourceRuntime: "openclaw_route_shell",
      dispatchType: input.dispatchType || input.dispatch_type || "route_shell_forward",
      payload: {
        originalDispatchRequest: {
          runtime,
          agentId,
          dispatchType: input.dispatchType || input.dispatch_type || "",
          createdBy: input.createdBy || input.created_by || input.chair || "",
          payload: parseJsonValue(input.payload, input.payload || {})
        }
      }
    });
  }
  const resolvedTarget = runtime
    ? await resolveRegisteredDispatchTarget(paths, { ...input, runtime, agentId })
    : await resolveRegisteredDispatchTarget(paths, { ...input, agentId });
  const targetRegistry = resolvedTarget.registry;
  const dispatchRuntime = targetRegistry.platform || runtime;
  const agent = await ensureRuntimeAgent(paths, {
    runtime: dispatchRuntime,
    platform: targetRegistry.platform,
    agentId,
    displayName: input.displayName || input.display_name || "",
    executionAdapter: targetRegistry.executionAdapter,
    imIngressOwner: targetRegistry.imIngressOwner,
    imIngressAdapter: targetRegistry.imIngressAdapter,
    workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
    endpointRef: targetRegistry.endpointRef,
    preserveExisting: true
  });
  if (idempotencyKey) {
    const existing = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
    if (existing[0]) {
      return {
        meetingId,
        dispatchId: existing[0].dispatch_id,
        runtime: existing[0].runtime,
        agentId: existing[0].agent_id,
        status: existing[0].status,
        traceId: existing[0].trace_id,
        idempotencyKey,
        deduped: true,
        dbFile: paths.dbFile
      };
    }
  }
  const dispatchId = input.dispatchId || input.dispatch_id || safeId("dispatch");
  const status = DISPATCH_STATUSES.has(String(input.status || "queued")) ? String(input.status || "queued") : "queued";
  const createdAt = nowIso();
  const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || input.max_attempts || 1)));
  const payload = {
    meetingId,
    workflowId,
    traceId,
    idempotencyKey,
    dispatchId,
    runtime: dispatchRuntime,
    agentId,
    dispatchType: input.dispatchType || input.dispatch_type || "discussion_turn",
    prompt: input.prompt || input.text || "",
    phase: input.phase || "",
    chair: input.chair || input.createdBy || input.created_by || "main",
    attempt: 0,
    maxAttempts,
    payload: parseJsonValue(input.payload, input.payload || {})
  };
  await createDispatchMessageFlow(paths, input, {
    validateOnly: true,
    targetRegistry,
    meetingId,
    workflowId,
    traceId,
    idempotencyKey,
    dispatchId,
    dispatchRuntime,
    agentId,
    dispatchType: payload.dispatchType,
    createdBy: payload.chair,
    createdAt
  });
  try {
    await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(dispatchId)}, ${sqlValue(meetingId)}, ${sqlValue(workflowId)}, ${sqlValue(traceId)}, ${sqlValue(idempotencyKey)}, ${sqlValue(dispatchRuntime)}, ${sqlValue(agentId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(payload.dispatchType)}, ${sqlValue(status)}, ${sqlValue(input.priority || "normal")}, 0, ${sqlValue(maxAttempts)}, ${sqlValue(payload.prompt)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(payload.chair)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
  } catch (error) {
    if (idempotencyKey && isSqliteConstraintError(error)) {
      const existing = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
      if (existing[0]) {
        return {
          meetingId,
          dispatchId: existing[0].dispatch_id,
          runtime: existing[0].runtime,
          agentId: existing[0].agent_id,
          status: existing[0].status,
          traceId: existing[0].trace_id,
          idempotencyKey,
          deduped: true,
          dbFile: paths.dbFile
        };
      }
    }
    throw error;
  }
  const messageFlow = await createDispatchMessageFlow(paths, input, {
    targetRegistry,
    meetingId,
    workflowId,
    traceId,
    idempotencyKey,
    dispatchId,
    dispatchRuntime,
    agentId,
    dispatchType: payload.dispatchType,
    createdBy: payload.chair,
    createdAt
  });
  const relPath = await writeJsonArtifact(paths.root, path.join(paths.dispatchesDir, status), dispatchId, payload);
  await appendWorkflowEvent(paths, {
    eventType: "dispatch.created",
    status,
    workflowId,
    traceId,
    dispatchId,
    actor: payload.chair,
    sourceRuntime: "workflow",
    sourceAgent: payload.chair,
    nextState: status,
    idempotencyKey: idempotencyKey ? `workflow_event:dispatch.created:${idempotencyKey}` : "",
    artifactRef: relPath,
    payload: {
      meetingId,
      runtime: dispatchRuntime,
      agentId,
      dispatchType: payload.dispatchType,
      priority: input.priority || "normal",
      messageFlowId: messageFlow?.flowId || ""
    },
    createdAt
  });
  return { meetingId, workflowId, traceId, idempotencyKey, dispatchId, runtime: dispatchRuntime, platform: targetRegistry.platform, workflowIngressAdapter: targetRegistry.workflowIngressAdapter, imIdentity: targetRegistry.imIdentity, executionIdentity: targetRegistry.executionIdentity, agentId, status, messageFlowId: messageFlow?.flowId || "", returnPolicy: messageFlow?.returnPolicy || "", relativePath: relPath, dbFile: paths.dbFile };
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

async function resolveRouteShellTarget(paths, input = {}) {
  const routeAgentId = normalizeAgentId(input.routeAgentId || input.route_agent_id || input.agentId || input.agent_id || input.target || "");
  const requireRouteShell = boolOption(input.requireRouteShell ?? input.require_route_shell, true);
  const instances = await findActiveRegisteredAgentInstances(paths, routeAgentId);
  const gatewayIngress = instances.find(isRouteShellIngress) || null;
  if (requireRouteShell && !gatewayIngress) {
    const passThrough = boolOption(input.passThroughOnNotRouteShell ?? input.pass_through_on_not_route_shell, false);
    return {
      ok: false,
      status: passThrough ? "not_route_shell" : "route_failed",
      passThrough,
      routeAgentId,
      reason: `active registry row with imIngressOwner=openclaw_gateway and imIngressAdapter=openclaw_route_shell not found for ${routeAgentId}`
    };
  }

  const explicitPlatform = normalizeAgentPlatform(input.targetPlatform || input.target_platform || input.runtime || "");
  const explicitAdapter = normalizeWorkflowIngressAdapter(input.workflowIngressAdapter || input.workflow_ingress_adapter || input.targetAdapter || input.target_adapter || "");
  const candidates = instances
    .filter((row) => !isRouteShellOnlyRow(row))
    .filter(canRouteToRegisteredInstance)
    .filter((row) => !explicitPlatform || registrySnapshot(row).platform === explicitPlatform)
    .filter((row) => !explicitAdapter || registrySnapshot(row).workflowIngressAdapter === explicitAdapter)
    .sort(sortRegisteredTargets);
  const target = candidates[0];
  if (target) return { ok: true, routeAgentId, gatewayIngress, target };

  return {
    ok: false,
    status: "route_failed",
    routeAgentId,
    gatewayIngress,
    reason: explicitPlatform || explicitAdapter
      ? `active registered target not found for ${routeAgentId}; requested platform=${explicitPlatform || "*"} adapter=${explicitAdapter || "*"}`
      : `active registered target not found for ${routeAgentId}; registry routing policy produced no dispatch-capable target`
  };
}

function routeShellSourceMessageId(input = {}) {
  return String(
    input.sourceMessageId ||
    input.source_message_id ||
    input.providerMessageId ||
    input.provider_message_id ||
    input.messageId ||
    input.message_id ||
    ""
  ).trim();
}

function routeShellAckText(result) {
  if (!result.ok) {
    const rawReason = String(result.reason || "unknown").replace(/\s+/g, " ").trim();
    const lowered = rawReason.toLowerCase();
    const reason = lowered.includes("database is locked")
      ? "sqlite database is locked after 5000ms busy timeout"
      : (lowered.includes("unique constraint failed") ? "sqlite unique constraint raced with an existing idempotency row" : rawReason);
    return [
      "ROUTE_FAILED",
      `timestamp: ${result.createdAt}`,
      `route_shell: openclaw_route_shell:${result.routeAgentId || ""}`,
      `reason: ${reason.length > 360 ? `${reason.slice(0, 360)}...` : reason}`
    ].join("\n");
  }
  return [
    "ROUTE_REGISTERED",
    `timestamp: ${result.createdAt}`,
    `trace_id: ${result.traceId}`,
    `flow_id: ${result.messageFlowId || ""}`
  ].join("\n");
}

export async function routeShellIngest(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const createdAt = nowIso();
  const text = String(input.text || input.prompt || input.content || input.message || "").trim();
  if (!text) throw new Error("text is required for route_shell.ingest");

  const resolved = await resolveRouteShellTarget(paths, input);
  if (!resolved.ok) {
    const result = { ...resolved, ok: false, createdAt, dbFile: paths.dbFile };
    return { ...result, ackText: routeShellAckText(result) };
  }

  const sourceMessageId = routeShellSourceMessageId(input);
  const sourceSystem = String(input.sourceSystem || input.source_system || input.channel || "openclaw_route_shell").trim();
  const sourceRuntime = normalizeRuntime(input.sourceRuntime || input.source_runtime || "openclaw_route_shell");
  const targetRegistry = registrySnapshot(resolved.target);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id || `route-shell-${resolved.routeAgentId}-${sourceMessageId ? cleanFileSegment(sourceMessageId) : Date.now().toString(36)}`);
  const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
  const traceId = String(input.traceId || input.trace_id || (sourceMessageId ? `route-shell:${resolved.routeAgentId}:${cleanFileSegment(sourceMessageId)}` : safeId("route_trace"))).trim();
  const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || (sourceMessageId ? `route-shell:${resolved.routeAgentId}:${sourceSystem}:${sourceMessageId}` : "")).trim();
  const originalPayload = parseJsonValue(input.payload, input.payload || {});
  const beforeDispatch = objectValue(originalPayload.beforeDispatch || originalPayload.before_dispatch);
  const sourceChannel = messageFlowSourceChannel(input, originalPayload);
  const sourceChatId = String(input.chatId || input.chat_id || input.conversationId || input.conversation_id || beforeDispatch.conversationId || beforeDispatch.conversation_id || "").trim();
  const sourceAccountId = firstText(input.accountId, input.account_id, input.account, beforeDispatch.accountId, beforeDispatch.account_id);
  const senderId = firstText(input.senderId, input.sender_id, input.from, beforeDispatch.senderId, beforeDispatch.sender_id);
  const returnPolicy = normalizeReturnPolicy(input.returnPolicy || input.return_policy || input.deliveryPolicy || input.delivery_policy || targetRegistry.returnPolicy, targetRegistry.platform === "hermers" && sourceChannel === "telegram" ? "reply_to_source_chat" : "silent");
  if (targetRegistry.platform !== "openclaw" && returnPolicy === "reply_to_source_chat" && (!sourceChannel || !sourceAccountId || !sourceChatId || !senderId || !sourceMessageId)) {
    const result = {
      ok: false,
      status: "route_failed",
      routeAgentId: resolved.routeAgentId,
      createdAt,
      reason: "non-openclaw route-shell message requires return path: source_channel, account_id, chat_id, sender_id, source_message_id",
      dbFile: paths.dbFile
    };
    return { ...result, ackText: routeShellAckText(result) };
  }
  const messageFlowId = String(input.messageFlowId || input.message_flow_id || messageFlowIdFromParts(idempotencyKey, traceId, meetingId, sourceMessageId)).trim();
  const payload = {
    messageFlowId,
    routeShell: {
      messageFlowId,
      routeAgentId: resolved.routeAgentId,
      sourceRuntime,
      sourceSystem,
      sourceMessageId,
      sourceChannel,
      sourceAccountId,
      sourceChatId,
      senderId,
      returnPolicy,
      deliveryPolicy: returnPolicy,
      returnPath: {
        source_channel: sourceChannel,
        account_id: sourceAccountId,
        chat_id: sourceChatId,
        sender_id: senderId,
        source_message_id: sourceMessageId,
        delivery_policy: returnPolicy
      },
      receivedAt: input.receivedAt || input.received_at || createdAt,
      target: targetRegistry
    },
    originalPayload
  };
  if (idempotencyKey) {
    const existingRows = await sqlite(paths.dbFile, `
SELECT *
FROM mixed_meeting_dispatches
WHERE idempotency_key=${sqlValue(idempotencyKey)}
LIMIT 1;`, { json: true });
    const existing = existingRows[0];
    if (existing) {
      const existingFlow = await readMessageFlow(paths, messageFlowId);
      const result = {
        ok: true,
        status: existing.status,
        createdAt,
        routeAgentId: resolved.routeAgentId,
        routeRuntime: "openclaw_route_shell",
        targetPlatform: targetRegistry.platform,
        targetAgentId: existing.agent_id,
        executionAdapter: targetRegistry.executionAdapter,
        workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
        runtime: existing.runtime,
        agentId: existing.agent_id,
        meetingId: existing.meeting_id,
        workflowId: existing.workflow_id || workflowId,
        traceId: existing.trace_id || traceId,
        idempotencyKey,
        dispatchId: existing.dispatch_id,
        messageFlowId,
        messageFlowStatus: existingFlow?.status || "",
        deduped: true,
        ingressMessageId: "",
        drainResult: null,
        dbFile: paths.dbFile
      };
      return { ...result, ackText: routeShellAckText(result) };
    }
  }

  await createMessageFlow(paths, {
    flowId: messageFlowId,
    traceId,
    idempotencyKey,
    meetingId,
    workflowId,
    sourceChannel,
    sourceSystem,
    sourceRuntime,
    sourceAccountId,
    sourceChatId,
    senderId,
    sourceMessageId,
    routeAgentId: resolved.routeAgentId,
    routeRuntime: "openclaw_route_shell",
    targetRuntime: targetRegistry.platform,
    targetAgentId: resolved.target.agent_id,
    targetPlatform: targetRegistry.platform,
    workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
    imIdentity: targetRegistry.imIdentity,
    executionIdentity: targetRegistry.executionIdentity,
    returnPolicy,
    status: "inbound_received",
    createdAt,
    payload: { routeShell: payload.routeShell }
  });

  let ingress = null;
  if (boolOption(input.recordIngress ?? input.record_ingress, true)) {
    try {
      ingress = await meetingIngest(rootDir, {
        meetingId,
        runtime: sourceRuntime,
        agentId: resolved.routeAgentId,
        text,
        messageId: sourceMessageId || undefined,
        messageType: "route_shell_ingress",
        phase: "route_shell",
        payload
      });
    } catch (error) {
      if (sourceMessageId && isSqliteConstraintError(error)) {
        ingress = { messageId: sourceMessageId, deduped: true };
      } else {
        throw error;
      }
    }
  }

  const dispatch = await meetingDispatch(rootDir, {
    meetingId,
    workflowId,
    traceId,
    idempotencyKey,
    runtime: targetRegistry.platform,
    agentId: resolved.target.agent_id,
    platform: targetRegistry.platform,
    executionAdapter: targetRegistry.executionAdapter,
    imIngressOwner: targetRegistry.imIngressOwner,
    imIngressAdapter: targetRegistry.imIngressAdapter,
    workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
    dispatchType: input.dispatchType || input.dispatch_type || "route_shell_forward",
    prompt: text,
    priority: input.priority || "normal",
    createdBy: `openclaw_route_shell:${resolved.routeAgentId}`,
    maxAttempts: input.maxAttempts || input.max_attempts || 1,
    payload
  });
  await updateMessageFlow(paths, messageFlowId, "route_registered", {
    dispatchId: dispatch.dispatchId,
    payload: {
      dispatchId: dispatch.dispatchId,
      dispatchStatus: dispatch.status,
      workflowIngressAdapter: targetRegistry.workflowIngressAdapter
    }
  });

  let drainResult = null;
  if (boolOption(input.drainNow ?? input.drain_now, false) && dispatch.status === "queued") {
    drainResult = await runtimeBridgeDrain(rootDir, {
      ...input,
      runtime: dispatch.runtime,
      dispatchId: dispatch.dispatchId,
      limit: 1,
      timeoutSeconds: input.timeoutSeconds || input.timeout_seconds || 45,
      dryRun: false
    });
  }

  const result = {
    ok: true,
    status: dispatch.status,
    createdAt,
    routeAgentId: resolved.routeAgentId,
    routeRuntime: "openclaw_route_shell",
    targetPlatform: targetRegistry.platform,
    targetAgentId: dispatch.agentId,
    executionAdapter: targetRegistry.executionAdapter,
    workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
    runtime: dispatch.runtime,
    agentId: dispatch.agentId,
    meetingId,
    workflowId,
    traceId,
    idempotencyKey,
    dispatchId: dispatch.dispatchId,
    messageFlowId,
    deduped: Boolean(dispatch.deduped),
    ingressMessageId: ingress?.messageId || "",
    drainResult,
    dbFile: paths.dbFile
  };
  return { ...result, ackText: routeShellAckText(result) };
}

export async function meetingIngest(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const runtime = normalizeRuntime(input.runtime);
  const agentId = normalizeAgentId(input.agentId || input.agent_id || input.from || "unknown");
  const agent = await ensureRuntimeAgent(paths, { runtime, agentId, displayName: input.displayName || input.display_name || "", preserveExisting: true });
  const messageId = input.messageId || input.message_id || safeId("msg");
  const createdAt = nowIso();
  const text = String(input.text || input.summary || "").trim();
  if (!text) throw new Error("text is required");
  const messageType = String(input.messageType || input.message_type || "agent_message").trim();
  const payload = parseJsonValue(input.payload, input.payload || {});
  await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_messages(message_id, meeting_id, runtime, agent_id, agent_key, message_type, phase, text, payload_json, telegram_live_status, created_at)
VALUES (${sqlValue(messageId)}, ${sqlValue(meetingId)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(messageType)}, ${sqlValue(input.phase || "")}, ${sqlValue(text)}, ${sqlValue(JSON.stringify(payload))}, 'pending', ${sqlValue(createdAt)});`);
  await appendJsonl(path.join(paths.messagesDir, `${cleanFileSegment(meetingId)}.messages.jsonl`), { messageId, meetingId, runtime, agentId, messageType, text, payload, createdAt });
  const transcriptPath = await appendTranscript(paths, meetingId, `- ${createdAt} [${runtime}:${agentId}] ${text}`);
  const link = await telegramLinkFor(paths, meetingId);
  let telegramOutbox = null;
  if (link && String(link.mode || "transparent") !== "silent") {
    const targetRef = link.chat_id || link.channel_id || "";
    if (targetRef) {
      telegramOutbox = await enqueueTelegramOutbox(paths, {
        meetingId,
        targetKind: "group",
        targetRef,
        messageType: "meeting_live",
        text: `[${runtime}:${agentId}] ${text}`,
        payload: { messageId, runtime, agentId, phase: input.phase || "" }
      });
      await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status='queued' WHERE message_id=${sqlValue(messageId)};`);
    } else {
      await sqlite(paths.dbFile, `UPDATE mixed_meeting_messages SET telegram_live_status='failed_missing_target' WHERE message_id=${sqlValue(messageId)};`);
    }
  }
  let reportOutbox = null;
  if (REPORT_MESSAGE_TYPES.has(messageType) && payload.deliverySucceeded !== true) {
    const dispatchId = String(payload.dispatchId || payload.dispatch_id || "").trim();
    reportOutbox = await enqueueTelegramOutbox(paths, {
      outboxId: dispatchId ? `report-${cleanFileSegment(dispatchId)}` : `report-${messageId}`,
      meetingId,
      targetKind: "private",
      targetRef: DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
      messageType,
      text,
      payload: {
        ...payload,
        messageId,
        workflowId: payload.workflowId || payload.workflow_id || meetingId,
        dispatchId,
        reportDeliveryRequired: true,
        account: "cat_claw",
        target: DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID
      }
    });
  }
  return { meetingId, messageId, runtime, agentId, transcriptPath, telegramOutbox, reportOutbox, dbFile: paths.dbFile };
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
    `Assigned agent: ${row.runtime}:${row.agent_id}`,
    `Created by: ${createdBy}`,
    role,
    `Dispatch type: ${dispatchType}`,
    ...heartbeatBudget,
    "",
    "Task:",
    row.prompt || payload.prompt || "",
    "",
    ...(ack.required
      ? [
          "First-turn ACK contract:",
          `- Return ${ack.expectedPrefix} as the first line within ${ack.timeoutSeconds}s of receiving this complete dispatch.`,
          "- This turn is only a receipt/integrity confirmation, not the semantic task result.",
          `- Include: ISO timestamp, Dispatch ID ${row.dispatch_id}, Message Flow ID ${payload.payload?.messageFlowId || payload.messageFlowId || ""}, received scope, and any obvious truncation/integrity issue.`,
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
    const ackRuntimeRunId = safeId("runtime_run_ack");
    await recordRuntimeRun(paths, row, { runtimeRunId: ackRuntimeRunId, adapter, status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { profile } });
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
    const failedRuntimeRunId = await recordRuntimeRun(paths, row, { adapter, status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { profile, retry: shouldRetry } });
    if (!shouldRetry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId: failedRuntimeRunId,
        finalOutputPresent: false,
        failureType,
        lastError: message
      }, input);
    }
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

function openClawPackageBaseCandidates(input = {}) {
  const explicit = [
    input.openclawRequireBase,
    input.openclaw_require_base,
    process.env.TRADING_AGENTS_OPENCLAW_REQUIRE_BASE,
    input.openclawPackageDir ? path.join(resolveHome(input.openclawPackageDir), "package.json") : "",
    input.openclaw_package_dir ? path.join(resolveHome(input.openclaw_package_dir), "package.json") : "",
    process.env.TRADING_AGENTS_OPENCLAW_PACKAGE_DIR ? path.join(resolveHome(process.env.TRADING_AGENTS_OPENCLAW_PACKAGE_DIR), "package.json") : "",
    process.env.OPENCLAW_PACKAGE_DIR ? path.join(resolveHome(process.env.OPENCLAW_PACKAGE_DIR), "package.json") : ""
  ];
  const acpxPeerBases = acpxPackageDirCandidates(input).map((dir) => path.join(dir, "package.json"));
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
  for (const base of openClawPackageBaseCandidates(input)) {
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

function acpxPackageDirCandidates(input = {}) {
  return uniqueResolvedPaths([
    input.acpxPackageDir,
    input.acpx_package_dir,
    process.env.TRADING_AGENTS_ACPX_PACKAGE_DIR,
    process.env.OPENCLAW_ACPX_PACKAGE_DIR,
    path.join(os.homedir(), ".openclaw", "npm", "node_modules", "@openclaw", "acpx")
  ]);
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
  for (const dir of acpxPackageDirCandidates(input)) {
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

async function runHermesAcpDispatch(paths, row, input = {}) {
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
    const ackRuntimeRunId = safeId("runtime_run_ack");
    await recordRuntimeRun(paths, row, { runtimeRunId: ackRuntimeRunId, adapter: "acp", backend: backendId, acpAgent, sessionKey, status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { sessionMode, backendSource, events: acpEvents.slice(-20) } });
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
    const failedRuntimeRunId = await recordRuntimeRun(paths, row, { adapter: "acp", backend: backendId, acpAgent, sessionKey, status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { sessionMode, backendSource, retry: shouldRetry } });
    if (!shouldRetry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId: failedRuntimeRunId,
        finalOutputPresent: false,
        failureType,
        lastError: message
      }, input);
    }
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
    const ackRuntimeRunId = safeId("runtime_run_ack");
    await recordRuntimeRun(paths, row, { runtimeRunId: ackRuntimeRunId, adapter: "openclaw", status: "acked", startedAt, completedAt, attempt, messageId: ingest.messageId, outputHash, payload: { runId: parsed.runId || "" } });
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
    const failedRuntimeRunId = await recordRuntimeRun(paths, row, { adapter: "openclaw", status: shouldRetry ? "retry_scheduled" : "failed", failureType, startedAt, completedAt: failedAt, attempt, error: message, payload: { retry: shouldRetry } });
    if (!shouldRetry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId: failedRuntimeRunId,
        finalOutputPresent: false,
        failureType,
        lastError: message
      }, input);
    }
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

async function redirectQueuedRouteShellDispatch(paths, row, input = {}) {
  const payload = parseJsonValue(row.payload_json, {});
  const result = await routeShellIngest(paths.root, {
    ...input,
    runtime: undefined,
    meetingId: row.meeting_id,
    workflowId: row.workflow_id || payload.workflowId || row.meeting_id,
    traceId: row.trace_id || payload.traceId || safeId("route_trace"),
    idempotencyKey: `route-shell-forward:${row.dispatch_id}`,
    routeAgentId: row.agent_id,
    text: row.prompt || payload.prompt || "",
    sourceMessageId: `dispatch-${row.dispatch_id}`,
    sourceSystem: "runtime_bridge:openclaw_route_shell",
    sourceRuntime: "openclaw_route_shell",
    dispatchType: row.dispatch_type || payload.dispatchType || "route_shell_forward",
    priority: row.priority || "normal",
    maxAttempts: row.max_attempts || 1,
    recordIngress: true,
    payload: {
      redirectedFromDispatch: {
        dispatchId: row.dispatch_id,
        runtime: row.runtime,
        agentId: row.agent_id,
        dispatchType: row.dispatch_type,
        idempotencyKey: row.idempotency_key,
        createdAt: row.created_at
      },
      originalPayload: payload
    }
  });
  if (result.ok) {
    await updateDispatch(paths, row.dispatch_id, "cancelled", {
      adapter: "route_shell_redirect",
      completedAt: nowIso(),
      redirectedToDispatchId: result.dispatchId,
      redirectedToPlatform: result.targetPlatform,
      redirectedToAdapter: result.workflowIngressAdapter,
      redirectedToAgentId: result.targetAgentId
    });
    return {
      dispatchId: row.dispatch_id,
      runtime: row.runtime,
      agentId: row.agent_id,
      status: "redirected",
      redirectedToDispatchId: result.dispatchId,
      redirectedToPlatform: result.targetPlatform,
      redirectedToAdapter: result.workflowIngressAdapter,
      redirectedToAgentId: result.targetAgentId,
      targetStatus: result.status,
      deduped: result.deduped
    };
  }
  await updateDispatch(paths, row.dispatch_id, "failed", {
    adapter: "route_shell_redirect",
    failedAt: nowIso(),
    failureType: "route_shell_target_unavailable",
    error: result.reason || "route-shell redirect failed"
  });
  return {
    dispatchId: row.dispatch_id,
    runtime: row.runtime,
    agentId: row.agent_id,
    status: "failed",
    failureType: "route_shell_target_unavailable",
    error: result.reason || "route-shell redirect failed"
  };
}

async function appendRuntimeBridgeResultEvent(paths, row, result = {}) {
  if (!row?.dispatch_id || !result?.status || result.status === "skipped") return;
  await appendWorkflowEvent(paths, {
    eventType: "runtime.receipt",
    status: result.status,
    workflowId: row.workflow_id || result.workflowId || "",
    traceId: row.trace_id || result.traceId || "",
    dispatchId: row.dispatch_id,
    runtimeRunId: result.runtimeRunId || "",
    messageFlowId: result.messageFlowId || "",
    actor: "runtime.bridge",
    sourceRuntime: row.runtime || result.runtime || "",
    sourceAgent: row.agent_id || result.agentId || "",
    previousState: "queued",
    nextState: result.status,
    payload: {
      runtime: row.runtime || result.runtime || "",
      agentId: row.agent_id || result.agentId || "",
      adapter: result.adapter || "",
      backend: result.backend || "",
      failureType: result.failureType || "",
      retryScheduled: Boolean(result.retryScheduled),
      error: result.error || ""
    }
  });
}

export async function runtimeBridgeDrain(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const runtime = normalizeRuntime(input.runtime || "hermers");
  const limit = Math.max(1, Math.min(20, Number(input.limit || 1)));
  const dryRun = Boolean(input.dryRun || input.dry_run);
  const dispatchId = String(input.dispatchId || input.dispatch_id || "").trim();
  const dispatchFilter = dispatchId ? `AND d.dispatch_id=${sqlValue(dispatchId)}` : "";
  const hermersModes = runtime === "hermers" ? await loadHermersProfileModes(input) : null;
  const rows = await sqlite(paths.dbFile, `
SELECT d.*, a.agent_key AS registry_agent_key, a.runtime AS registry_runtime, a.status AS registry_status, a.display_name, a.role, a.endpoint_ref, a.platform, a.execution_adapter, a.im_ingress_owner, a.im_ingress_adapter, a.workflow_ingress_adapter, a.can_receive_dispatch
FROM mixed_meeting_dispatches d
LEFT JOIN runtime_agents a ON a.agent_key=d.agent_key
WHERE d.status='queued' AND d.runtime=${sqlValue(runtime)}
  ${dispatchFilter}
  AND (d.next_retry_at IS NULL OR d.next_retry_at='' OR d.next_retry_at <= ${sqlValue(nowIso())})
ORDER BY
  CASE d.priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  d.created_at
LIMIT ${limit};`, { json: true });
  if (dryRun) return { runtime, dryRun: true, count: rows.length, profileModes: hermersModes ? profileModesReadinessPayload(hermersModes) : null, dispatches: rows.map((row) => {
    const admission = runtime === "hermers" ? classifyHermersProfileAdmission(row, hermersModes, input) : { allowed: true, action: "allow" };
    const registryValidation = validateRuntimeBridgeRegistryRow(row, runtime);
    return { dispatchId: row.dispatch_id, meetingId: row.meeting_id, workflowId: row.workflow_id, traceId: row.trace_id, agentId: row.agent_id, attempt: row.attempt, maxAttempts: row.max_attempts, endpointRef: row.endpoint_ref, registryValidation, admission };
  }) };
  const results = [];
  for (const row of rows) {
    const validation = validateRuntimeBridgeRegistryRow(row, runtime);
    if (!validation.ok) {
      const result = await failRuntimeBridgeRegistryDispatch(paths, row, validation, input);
      await appendRuntimeBridgeResultEvent(paths, row, result);
      results.push(result);
      continue;
    }
    const claim = await claimQueuedDispatch(paths, row, input);
    if (!claim.claimed) {
      results.push({ dispatchId: row.dispatch_id, runtime, agentId: row.agent_id, status: "skipped", reason: claim.reason, currentStatus: claim.row?.status || "" });
      continue;
    }
    const claimedRow = claim.row;
    try {
      let result = null;
      if (runtime === "openclaw_route_shell") {
        result = await redirectQueuedRouteShellDispatch(paths, claimedRow, input);
      } else if (runtime === "hermers") {
        const adapter = normalizeWorkflowIngressAdapter(claimedRow.workflow_ingress_adapter || claimedRow.execution_adapter || "", claimedRow.platform || "", runtime);
        if (adapter === "acp") {
          result = await runHermesAcpDispatch(paths, claimedRow, input);
        } else if (adapter === "cli") {
          result = await runHermesDispatch(paths, claimedRow, { ...input, adapterName: "cli" });
        } else {
          await updateDispatch(paths, claimedRow.dispatch_id, "failed", { adapter, failedAt: nowIso(), error: `hermers adapter not implemented: ${adapter}` });
          result = { dispatchId: claimedRow.dispatch_id, runtime, agentId: claimedRow.agent_id, status: "failed", error: `hermers adapter not implemented: ${adapter}` };
        }
      } else if (runtime === "openclaw") {
        result = await runOpenClawDispatch(paths, claimedRow, input);
      } else if (runtime === "local_codex" || runtime === "codex") {
        result = await runLocalCodexDispatch(paths, claimedRow, input);
      } else {
        await updateDispatch(paths, claimedRow.dispatch_id, "failed", { adapter: "none", failedAt: nowIso(), error: `runtime adapter not implemented: ${runtime}` });
        result = { dispatchId: claimedRow.dispatch_id, runtime, agentId: claimedRow.agent_id, status: "failed", error: `runtime adapter not implemented: ${runtime}` };
      }
      await appendRuntimeBridgeResultEvent(paths, claimedRow, result);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateDispatch(paths, claimedRow.dispatch_id, "failed", { adapter: "runtime_bridge", failedAt: nowIso(), failureType: "runtime_bridge_error", error: message.slice(0, 2000) });
      const result = { dispatchId: claimedRow.dispatch_id, runtime, agentId: claimedRow.agent_id, status: "failed", failureType: "runtime_bridge_error", error: message };
      await appendRuntimeBridgeResultEvent(paths, claimedRow, result);
      results.push(result);
    }
  }
  return { runtime, count: rows.length, results, dbFile: paths.dbFile };
}

export async function staleDispatchReconcile(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const timeoutSeconds = controlLoopTimeoutSeconds(input);
  const staleAfterMs = Math.max(5 * 60_000, Number(input.staleDispatchAfterMs || input.stale_dispatch_after_ms || (timeoutSeconds + 60) * 1000));
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
  const limit = Math.max(1, Math.min(100, Number(input.limit || input.dispatchReconcileLimit || input.dispatch_reconcile_limit || 20)));
  const rows = await sqlite(paths.dbFile, `
SELECT d.*,
  (SELECT rr.runtime_run_id FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_runtime_run_id,
  (SELECT rr.status FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_status,
  (SELECT rr.completed_at FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_completed_at,
  (SELECT rr.attempt FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_attempt,
  (SELECT rr.message_id FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('acked','failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_message_id,
  (SELECT rr.failure_type FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_failure_type,
  (SELECT rr.error FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id AND rr.status IN ('failed','retry_scheduled') AND rr.completed_at IS NOT NULL AND rr.completed_at != '' AND rr.completed_at >= COALESCE(NULLIF(d.sent_at,''), d.updated_at, d.created_at) ORDER BY rr.completed_at DESC, rr.started_at DESC LIMIT 1) AS terminal_error
FROM mixed_meeting_dispatches d
WHERE d.status='sent'
  AND d.updated_at < ${sqlValue(cutoff)}
ORDER BY d.updated_at
LIMIT ${limit};`, { json: true });
  const results = [];
  for (const row of rows) {
    const terminalStatus = String(row.terminal_status || "").trim();
    if (terminalStatus === "acked") {
      await updateDispatch(paths, row.dispatch_id, "acked", {
        adapter: "stale_dispatch_reconcile",
        completedAt: row.terminal_completed_at || nowIso(),
        messageId: row.terminal_message_id || "",
        reconciledFrom: row.status
      });
      const messageFlowSync = await syncMessageFlowFromTerminalDispatchReceipt(paths, { ...row, status: "acked" }, {
        status: "acked",
        runtimeRunId: row.terminal_runtime_run_id || "",
        messageId: row.terminal_message_id || "",
        completedAt: row.terminal_completed_at || ""
      }, input);
      results.push({ dispatchId: row.dispatch_id, status: "acked", reason: "terminal_runtime_receipt", messageFlowSync });
      continue;
    }
    if (terminalStatus === "failed" || terminalStatus === "retry_scheduled") {
      const attempt = Math.max(Number(row.attempt || 0) + 1, Number(row.terminal_attempt || 0) || 0);
      const shouldRetry = terminalStatus === "retry_scheduled" && attempt < Number(row.max_attempts || 1);
      const ack = runtimeAckContract(row, input);
      await updateDispatch(paths, row.dispatch_id, shouldRetry ? "queued" : "failed", {
        adapter: "stale_dispatch_reconcile",
        failedAt: row.terminal_completed_at || nowIso(),
        failureType: row.terminal_failure_type || "runtime_stale",
        error: row.terminal_error || "stale sent dispatch reconciled from terminal runtime receipt",
        attempt,
        nextRetryAt: shouldRetry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : ""
      });
      const messageFlowSync = shouldRetry ? null : await syncMessageFlowFromTerminalDispatchReceipt(paths, { ...row, status: "failed" }, {
        status: "failed",
        runtimeRunId: row.terminal_runtime_run_id || "",
        messageId: row.terminal_message_id || "",
        completedAt: row.terminal_completed_at || "",
        failureType: row.terminal_failure_type || "runtime_stale",
        error: row.terminal_error || "stale sent dispatch reconciled from terminal runtime receipt"
      }, input);
      results.push({ dispatchId: row.dispatch_id, status: shouldRetry ? "queued" : "failed", reason: "terminal_runtime_receipt", messageFlowSync });
      continue;
    }
    const maxAttempts = Number(row.max_attempts || 1);
    const attempt = Number(row.attempt || 0) + 1;
    const retry = attempt < maxAttempts;
    const ack = runtimeAckContract(row, input);
    const completedAt = nowIso();
    const error = `stale sent dispatch exceeded ${Math.round(staleAfterMs / 1000)}s without terminal runtime receipt`;
    await updateDispatch(paths, row.dispatch_id, retry ? "queued" : "failed", {
      adapter: "stale_dispatch_reconcile",
      failedAt: completedAt,
      failureType: "runtime_stale",
      error,
      attempt,
      nextRetryAt: retry ? nextRetryAt(attempt, ack.required ? ack.retryDelaySeconds : 0) : ""
    });
    const staleRuntimeRunId = await recordRuntimeRun(paths, row, {
      runtimeRunId: safeId(retry ? "runtime_run_retry" : "runtime_run_failed"),
      adapter: "stale_dispatch_reconcile",
      status: retry ? "retry_scheduled" : "failed",
      failureType: "runtime_stale",
      startedAt: row.sent_at || row.updated_at || row.created_at,
      completedAt,
      attempt,
      error,
      payload: { staleAfterMs, retry }
    });
    if (!retry) {
      await finishMessageFlowRuntime(paths, row, {
        runtimeRunId: staleRuntimeRunId,
        finalOutputPresent: false,
        failureType: "runtime_stale",
        lastError: error
      }, input);
    }
    results.push({ dispatchId: row.dispatch_id, status: retry ? "queued" : "failed", reason: "missing_terminal_runtime_receipt" });
  }
  return { operation: "stale_dispatch_reconcile", cutoff, staleAfterMs, count: rows.length, results, dbFile: paths.dbFile };
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
ON CONFLICT(button_id) DO NOTHING;`);
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
  const fallback = index < 26 ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[index] : String(index + 1);
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
    throw new Error(`Human Gate request blocked: ${buttonAudit.reason}; cat-brain main must provide complete plan A/B/C details and Chinese-primary report material before cat_claw submits to Flashcat`);
  }
  let gate = null;
  let supersededGate = null;
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
    await sqlite(paths.dbFile, `
UPDATE workflow_runs
SET status='active',
    current_decision=${sqlValue(`human_gate_${decisionStatus}`)},
    payload_json=${sqlValue(JSON.stringify(workflowPayload))},
    updated_at=${sqlValue(selectedAt)}
WHERE workflow_id=${sqlValue(workflowId)} AND status IN ('active','waiting_human','blocked','paused');`);
    return { workflowId, workflowStatus: "active", currentDecision: `human_gate_${decisionStatus}` };
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
    payload: {
      ...nestedPayload,
      humanGateFeedback: feedback,
      humanGateFeedbackHistory: [...history, feedback]
    }
  };
  await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status=${sqlValue(status)}, payload_json=${sqlValue(JSON.stringify(nextPayload))}, updated_at=${sqlValue(updatedAt)}
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

export async function meetingResume(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const eventId = input.eventId || input.event_id || safeId("control");
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'resume', ${sqlValue(input.status || "active")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify(parseJsonValue(input.payload, input.payload || {})))}, ${sqlValue(input.from || "flashcat")}, ${sqlValue(createdAt)});`);
  await appendTranscript(paths, meetingId, `- ${createdAt} [system:resume] ${input.summary || input.text || "meeting resumed"}`);
  return { meetingId, eventId, status: input.status || "active", dbFile: paths.dbFile };
}

export async function meetingDisperse(rootDir, input) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
  const eventId = input.eventId || input.event_id || safeId("control");
  const targets = toList(input.targets || input.target);
  const createdAt = nowIso();
  await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'disperse', 'queued', ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify({ targets, payload: parseJsonValue(input.payload, input.payload || {}) }))}, ${sqlValue(input.from || "main")}, ${sqlValue(createdAt)});`);
  const dispatches = [];
  for (const target of targets) {
    const [runtimePart, agentPart] = target.includes(":") ? target.split(":", 2) : ["", target];
    const dispatchInput = {
      meetingId,
      agentId: agentPart,
      dispatchType: "execute_meeting_conclusion",
      prompt: input.summary || input.text || "",
      priority: input.priority || "high",
      createdBy: input.from || "main",
      payload: input.payload
    };
    if (runtimePart) dispatchInput.runtime = runtimePart;
    dispatches.push(await meetingDispatch(rootDir, dispatchInput));
  }
  return { meetingId, eventId, status: "queued", dispatches, dbFile: paths.dbFile };
}

export async function telegramOutbox(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  if (input.operation === "deliver" || input.deliver) {
    const limit = Math.max(1, Math.min(20, Number(input.limit || 5)));
    const outboxId = String(input.outboxId || input.outbox_id || "").trim();
    const status = String(input.status || "queued").trim();
    const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
    const statusWhere = status === "queued"
      ? `(status='queued' OR (status='delivering' AND updated_at <= ${sqlValue(staleDeliveringBefore)}))`
      : `status=${sqlValue(status)}`;
    const where = outboxId ? `outbox_id=${sqlValue(outboxId)}` : statusWhere;
    const rows = await sqlite(paths.dbFile, `
SELECT * FROM telegram_outbox
WHERE ${where}
ORDER BY created_at
LIMIT ${limit};`, { json: true });
    const results = [];
    for (const row of rows) {
      results.push(await deliverTelegramOutboxRow(paths, row, input));
    }
    return { operation: "deliver", count: rows.length, results, dbFile: paths.dbFile };
  }
  if (input.operation === "mark" || input.operation === "update") {
    const outboxId = String(input.outboxId || input.outbox_id || "").trim();
    if (!outboxId) throw new Error("outboxId is required");
    const status = String(input.status || "sent").trim();
    const updatedAt = nowIso();
    await sqlite(paths.dbFile, `UPDATE telegram_outbox SET status=${sqlValue(status)}, updated_at=${sqlValue(updatedAt)} WHERE outbox_id=${sqlValue(outboxId)};`);
    const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
    let messageFlowSync = null;
    if (rows[0] && ["sent", "failed"].includes(status)) {
      messageFlowSync = await updateMessageFlowFromTelegramDelivery(paths, rows[0], {
        outboxId,
        status,
        target: rows[0].target_ref || "",
        manual: true,
        updatedAt
      });
    }
    return { outboxId, status, messageFlowSync, dbFile: paths.dbFile };
  }
  const limit = Math.max(1, Math.min(200, Number(input.limit || 20)));
  const status = String(input.status || "queued").trim();
  const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE status=${sqlValue(status)} ORDER BY created_at LIMIT ${limit};`, { json: true });
  return { status, count: rows.length, rows, dbFile: paths.dbFile };
}

export async function messageFlowList(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const flowId = String(input.flowId || input.flow_id || "").trim();
  const dispatchId = String(input.dispatchId || input.dispatch_id || "").trim();
  const status = String(input.status || "").trim();
  const where = [];
  if (flowId) where.push(`flow_id=${sqlValue(flowId)}`);
  if (dispatchId) {
    const dispatchJson = JSON.stringify(dispatchId).slice(1, -1);
    where.push(`(dispatch_id=${sqlValue(dispatchId)} OR payload_json LIKE ${sqlValue(`%"ackDispatchId":"${dispatchJson}"%`)} OR payload_json LIKE ${sqlValue(`%"semanticDispatchId":"${dispatchJson}"%`)})`);
  }
  if (status) where.push(`status=${sqlValue(status)}`);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, Number(input.limit || 20)));
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM message_flows
${whereSql}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true });
  for (const row of rows) {
    row.payload = parseJsonValue(row.payload_json, {});
    delete row.payload_json;
  }
  return { count: rows.length, rows, dbFile: paths.dbFile };
}

export async function messageFlowSend(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const targets = messageFlowSendTargets(input);
  const { subject, body, sourceRefs, prompt } = messageFlowSendPrompt(input);
  const baseFlowId = String(input.messageFlowId || input.message_flow_id || input.flowId || input.flow_id || "").trim();
  const baseDispatchId = String(input.dispatchId || input.dispatch_id || "").trim();
  if (baseFlowId && targets.length > 1) throw new Error("messageFlowId/flowId can only be provided for a single target");
  if (baseDispatchId && targets.length > 1) throw new Error("dispatchId can only be provided for a single target");

  const createdAt = nowIso();
  const sourceRuntime = normalizeRuntime(input.fromRuntime || input.from_runtime || input.sourceRuntime || input.source_runtime || "other");
  const fromAgent = normalizeAgentId(input.fromAgent || input.from_agent || input.senderAgent || input.sender_agent || input.from || input.sender || "unknown");
  const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id || input.workflowId || input.workflow_id || `message-flow-${Date.now().toString(36)}`);
  const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
  const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
  const explicitSourceMessageId = String(input.sourceMessageId || input.source_message_id || input.providerMessageId || input.provider_message_id || input.messageId || input.message_id || "").trim();
  const baseIdempotencyKey = String(input.idempotencyKey || input.idempotency_key || (explicitSourceMessageId ? `message-flow-send:${sourceRuntime}:${fromAgent}:${explicitSourceMessageId}` : "")).trim();
  const sourceMessageId = explicitSourceMessageId || (baseIdempotencyKey ? `msg.${createHash("sha256").update(baseIdempotencyKey).digest("hex").slice(0, 24)}` : "");
  const messageType = String(input.messageType || input.message_type || "internal_notice").trim();
  const requiresAck = boolOption(input.requiresAck ?? input.requires_ack, false);
  const returnPolicy = normalizeReturnPolicy(input.returnPolicy || input.return_policy || input.deliveryPolicy || input.delivery_policy, "silent");
  const sourceChannel = String(input.sourceChannel || input.source_channel || "workflow_internal").trim();
  const sourceSystem = String(input.sourceSystem || input.source_system || "workflow.message_flow.send").trim();
  const sourceAccountId = firstText(input.sourceAccountId, input.source_account_id, input.accountId, input.account_id, input.account);
  const sourceChatId = firstText(input.sourceChatId, input.source_chat_id, input.chatId, input.chat_id, input.conversationId, input.conversation_id);
  const senderId = firstText(input.senderId, input.sender_id, fromAgent);
  if (returnPolicy === "reply_to_source_chat" && (!sourceChannel || !sourceAccountId || !sourceChatId || !senderId || !sourceMessageId)) {
    throw new Error("workflow.message_flow.send with return_policy=reply_to_source_chat requires source_channel, account_id, chat_id, sender_id, source_message_id");
  }
  const rawPayload = parseJsonValue(input.payload, input.payload || {});
  const ackTimeoutSeconds = messageFlowAckTimeoutSeconds(input);
  const ackContract = requiresAck
    ? {
        required: true,
        firstTurnOnly: true,
        timeoutSeconds: ackTimeoutSeconds,
        retryDelaySeconds: DEFAULT_RUNTIME_ACK_RETRY_SECONDS,
        maxAttempts: DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS,
        expectedPrefix: "ACK_RECEIVED"
      }
    : null;
  const sourcePayload = {
    messageType,
    subject,
    body,
    sourceRefs,
    requiresAck,
    source: {
      runtime: sourceRuntime,
      agentId: fromAgent,
      sourceChannel,
      sourceSystem,
      sourceAccountId,
      sourceChatId,
      senderId,
      sourceMessageId
    },
    ...(ackContract ? { ackContract } : {}),
    raw: rawPayload
  };

  let sourceRecord = null;
  if (boolOption(input.recordIngress ?? input.record_ingress, true)) {
    try {
      sourceRecord = await meetingIngest(rootDir, {
        meetingId,
        runtime: sourceRuntime,
        agentId: fromAgent,
        text: prompt,
        messageId: sourceMessageId || input.messageId || input.message_id || undefined,
        messageType,
        phase: input.phase || "message_flow_send",
        payload: sourcePayload
      });
    } catch (error) {
      if (!sourceMessageId || !isSqliteConstraintError(error)) throw error;
      sourceRecord = { messageId: sourceMessageId, deduped: true };
    }
  }

  const dispatches = [];
  for (const target of targets) {
    const targetKey = `${target.runtime || "registry"}:${target.agentId}`;
    const idempotencyKey = baseIdempotencyKey ? `${baseIdempotencyKey}:${cleanFileSegment(targetKey)}` : "";
    const flowId = baseFlowId || messageFlowIdFromParts(idempotencyKey || traceId, meetingId, sourceMessageId, targetKey, subject, body);
    const dispatchId = baseDispatchId || safeId("dispatch");
    const targetPayload = {
      ...sourcePayload,
      messageFlowId: flowId,
      target: {
        runtime: target.runtime,
        agentId: target.agentId,
        key: targetKey
      }
    };
    const dispatch = await meetingDispatch(rootDir, {
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId,
      runtime: target.runtime || undefined,
      agentId: target.agentId,
      dispatchType: input.dispatchType || input.dispatch_type || "message_flow_send",
      prompt,
      priority: input.priority || "normal",
      createdBy: input.createdBy || input.created_by || `${sourceRuntime}:${fromAgent}`,
      maxAttempts: input.maxAttempts || input.max_attempts || (requiresAck ? DEFAULT_RUNTIME_ACK_MAX_ATTEMPTS : 1),
      returnPolicy: "silent",
      deliveryPolicy: "silent",
      sourceChannel,
      sourceSystem,
      sourceRuntime,
      sourceAccountId,
      sourceChatId,
      senderId,
      sourceMessageId,
      payload: targetPayload
    });
    const existingFlow = await readMessageFlow(paths, flowId);
    let flow = existingFlow;
    if (!existingFlow) {
      await createMessageFlow(paths, {
        flowId,
        traceId,
        idempotencyKey,
        meetingId,
        workflowId,
        dispatchId: dispatch.dispatchId,
        messageId: sourceRecord?.messageId || "",
        sourceChannel,
        sourceSystem,
        sourceRuntime,
        sourceAccountId,
        sourceChatId,
        senderId,
        sourceMessageId,
        routeAgentId: fromAgent,
        routeRuntime: sourceRuntime,
        targetRuntime: dispatch.runtime,
        targetAgentId: dispatch.agentId,
        targetPlatform: dispatch.platform || dispatch.runtime,
        workflowIngressAdapter: dispatch.workflowIngressAdapter || "",
        imIdentity: dispatch.imIdentity || "",
        executionIdentity: dispatch.executionIdentity || "",
        returnPolicy,
        status: "route_registered",
        createdAt,
        payload: {
          ...targetPayload,
          dispatchId: dispatch.dispatchId,
          dispatchStatus: dispatch.status,
          returnPolicy
        }
      });
      flow = await readMessageFlow(paths, flowId);
    }
    dispatches.push({
      target: targetKey,
      agentId: dispatch.agentId,
      runtime: dispatch.runtime,
      platform: dispatch.platform || flow?.target_platform || "",
      workflowIngressAdapter: dispatch.workflowIngressAdapter || flow?.workflow_ingress_adapter || "",
      imIdentity: dispatch.imIdentity || flow?.im_identity || "",
      executionIdentity: dispatch.executionIdentity || flow?.execution_identity || "",
      dispatchId: dispatch.dispatchId,
      dispatchStatus: dispatch.status,
      messageFlowId: flowId,
      messageFlowStatus: flow?.status || "",
      idempotencyKey,
      deduped: Boolean(dispatch.deduped || existingFlow)
    });
  }

  return {
    operation: "workflow.message_flow.send",
    meetingId,
    workflowId,
    traceId,
    idempotencyKey: baseIdempotencyKey,
    fromRuntime: sourceRuntime,
    fromAgent,
    messageId: sourceRecord?.messageId || "",
    messageType,
    subject,
    requiresAck,
    targetCount: dispatches.length,
    dispatches,
    dbFile: paths.dbFile
  };
}

export async function messageFlowReconcile(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const stuckAfterMs = Math.max(60_000, Math.min(24 * 3600_000, Number(input.messageFlowStuckAfterMs || input.message_flow_stuck_after_ms || input.stuckAfterMs || input.stuck_after_ms || 5 * 60_000)));
  const limit = Math.max(1, Math.min(200, Number(input.messageFlowReconcileLimit || input.message_flow_reconcile_limit || input.limit || 20)));
  const cutoff = new Date(Date.now() - stuckAfterMs).toISOString();
  const recoveredSemanticContinuations = await recoverAckedMessageFlowSemanticContinuations(paths, { cutoff, limit });
  const rows = await sqlite(paths.dbFile, `
SELECT mf.*, o.status AS outbox_status, o.updated_at AS outbox_updated_at, o.target_kind, o.target_ref, o.payload_json AS outbox_payload_json
FROM message_flows mf
LEFT JOIN telegram_outbox o ON o.outbox_id=mf.outbox_id
WHERE (
    mf.final_output_present=1
    AND mf.delivery_receipt_present=0
    AND mf.return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])})
    AND mf.target_runtime NOT IN ('local_codex','codex')
    AND mf.runtime_completed_at IS NOT NULL
    AND mf.runtime_completed_at != ''
    AND mf.runtime_completed_at < ${sqlValue(cutoff)}
    AND mf.status NOT IN ('telegram_sent','telegram_failed')
  )
  OR (
    mf.final_output_present=0
    AND mf.delivery_receipt_present=0
    AND mf.target_runtime NOT IN ('local_codex','codex')
    AND mf.status='runtime_failed'
    AND mf.outbox_id IS NOT NULL
    AND mf.outbox_id != ''
    AND mf.runtime_failed_at IS NOT NULL
    AND mf.runtime_failed_at != ''
    AND mf.runtime_failed_at < ${sqlValue(cutoff)}
  )
ORDER BY mf.runtime_completed_at
LIMIT ${limit};`, { json: true });
  const incidents = [];
  for (const row of rows) {
    if (["sent", "failed"].includes(String(row.outbox_status || ""))) {
      const outboxPayload = parseJsonValue(row.outbox_payload_json, {});
      const synced = await updateMessageFlowFromTelegramDelivery(paths, {
        outbox_id: row.outbox_id,
        target_ref: row.target_ref || "",
        payload_json: JSON.stringify({
          ...outboxPayload,
          messageFlowId: outboxPayload.messageFlowId || row.flow_id
        })
      }, {
        status: row.outbox_status,
        target: row.target_ref || "",
        reconciled: true,
        receipts: Array.isArray(outboxPayload.delivery?.receipts) ? outboxPayload.delivery.receipts : [],
        error: outboxPayload.delivery?.error || ""
      });
      await appendMessageFlowEvent(paths, row.flow_id, synced?.status || row.status, "outbox_terminal_state_reconciled", {
        outboxId: row.outbox_id,
        outboxStatus: row.outbox_status,
        deliveryReceiptPresent: Number(synced?.delivery_receipt_present || 0) === 1
      });
      incidents.push({
        flowId: row.flow_id,
        dispatchId: row.dispatch_id || "",
        status: "reconciled_from_outbox",
        outboxId: row.outbox_id,
        outboxStatus: row.outbox_status,
        messageFlowStatus: synced?.status || ""
      });
      continue;
    }
    const incidentId = `message-flow-stuck-${cleanFileSegment(row.flow_id)}`;
    const minutes = Math.round(stuckAfterMs / 60_000);
    const summary = Number(row.final_output_present || 0) === 1
      ? `message_flow ${row.flow_id} runtime completed but Telegram delivery receipt is still missing after ${minutes}m`
      : `message_flow ${row.flow_id} runtime failed but failure-notice delivery receipt is still missing after ${minutes}m`;
    const incident = await incidentState(paths.root, {
      incidentId,
      status: "active",
      mode: "degraded",
      commander: "trading-agents-workflow",
      affectedPlanes: ["workflow", "runtime_bridge", "telegram"],
      summary,
      impact: Number(row.final_output_present || 0) === 1
        ? "A non-OpenClaw agent produced runtime output, but the user-visible reply has not been confirmed by Telegram delivery receipt."
        : "A non-OpenClaw agent failed, and the user-visible failure notice has not been confirmed by Telegram delivery receipt.",
      currentHypothesis: row.outbox_id
        ? `telegram_outbox ${row.outbox_id} status=${row.outbox_status || "missing"}`
        : "message_flow has no outbound outbox id after runtime completion",
      mitigation: "30s control loop records this incident and lets telegram_outbox delivery/retry continue under queue governance.",
      rollbackOptions: "No destructive rollback. Preserve flow, dispatch, runtime_run, and outbox evidence; inspect Telegram delivery and return path.",
      exitCriteria: "message_flows.delivery_receipt_present=1 and status=telegram_sent, or the flow is explicitly marked telegram_failed with evidence.",
      timeline: [
        `${nowIso()} ${summary}`,
        `flow=${row.flow_id} dispatch=${row.dispatch_id || ""} outbox=${row.outbox_id || ""} outbox_status=${row.outbox_status || ""}`
      ],
      payload: {
        flowId: row.flow_id,
        dispatchId: row.dispatch_id || "",
        runtimeRunId: row.runtime_run_id || "",
        messageId: row.message_id || "",
        outboxId: row.outbox_id || "",
        outboxStatus: row.outbox_status || "",
        targetKind: row.target_kind || "",
        targetRef: row.target_ref || "",
        runtimeCompletedAt: row.runtime_completed_at || "",
        status: row.status,
        stuckAfterMs,
        cutoff
      }
    });
    await appendMessageFlowEvent(paths, row.flow_id, row.status, "stuck_incident_recorded", {
      incidentId: incident.incidentId,
      stuckAfterMs,
      outboxId: row.outbox_id || "",
      outboxStatus: row.outbox_status || ""
    });
    incidents.push({
      flowId: row.flow_id,
      status: row.status,
      incidentId: incident.incidentId,
      outboxId: row.outbox_id || "",
      outboxStatus: row.outbox_status || "",
      runtimeCompletedAt: row.runtime_completed_at || ""
    });
  }
  return { operation: "message_flow.reconcile", stuckAfterMs, cutoff, count: rows.length, recoveredSemanticContinuations, incidents, dbFile: paths.dbFile };
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

function sqlStringList(values) {
  return values.map((value) => sqlValue(value)).join(", ");
}

function scheduleRow(row = {}) {
  return {
    scheduleId: row.schedule_id || "",
    name: row.name || "",
    status: row.status || "",
    scheduleKind: row.schedule_kind || "",
    cronExpr: row.cron_expr || "",
    intervalSeconds: Number(row.interval_seconds || 0) || null,
    timezone: row.timezone || "",
    runtime: row.runtime || "",
    agentId: row.agent_id || "",
    dispatchType: row.dispatch_type || "",
    priority: row.priority || "normal",
    prompt: row.prompt || "",
    payload: parseJsonValue(row.payload_json, {}),
    concurrencyPolicy: row.concurrency_policy || "skip",
    catchupWindowSeconds: Number(row.catchup_window_seconds || 0) || 0,
    misfirePolicy: row.misfire_policy || "skip",
    timeoutSeconds: Number(row.timeout_seconds || 0) || 45,
    maxAttempts: Number(row.max_attempts || 0) || 1,
    nextRunAt: row.next_run_at || "",
    lastScheduledAt: row.last_scheduled_at || "",
    lastDispatchId: row.last_dispatch_id || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function nextScheduleRunAt(schedule, fromIso = nowIso()) {
  const kind = normalizeScheduleKind(schedule.schedule_kind || schedule.scheduleKind, schedule);
  if (kind === "cron") {
    const cronExpr = String(schedule.cron_expr || schedule.cronExpr || schedule.cron || "").trim();
    if (!cronExpr) throw new Error("cron schedule requires cronExpr");
    return nextCronRunAt(cronExpr, normalizeTimezone(schedule.timezone), fromIso);
  }
  const rawIntervalSeconds = Number(schedule.interval_seconds || schedule.intervalSeconds || 0);
  if (!Number.isFinite(rawIntervalSeconds) || rawIntervalSeconds <= 0) throw new Error("interval schedule requires intervalSeconds");
  const intervalSeconds = Math.max(10, Math.min(366 * 24 * 3600, rawIntervalSeconds));
  const fromDate = new Date(fromIso);
  if (Number.isNaN(fromDate.getTime())) throw new Error(`invalid schedule base timestamp: ${fromIso}`);
  return new Date(fromDate.getTime() + intervalSeconds * 1000).toISOString();
}

function nextScheduleRunAfterSeed(schedule, scheduledAt, now, misfired) {
  let nextRunAt = nextScheduleRunAt(schedule, scheduledAt);
  if (!misfired || schedule.misfire_policy !== "skip") return nextRunAt;
  const catchupSeconds = Math.max(0, Number(schedule.catchup_window_seconds || 0));
  const oldestAllowed = new Date(new Date(now).getTime() - catchupSeconds * 1000).toISOString();
  let guard = 0;
  while (nextRunAt && nextRunAt < oldestAllowed && guard < 1000) {
    nextRunAt = nextScheduleRunAt(schedule, nextRunAt);
    guard += 1;
  }
  return nextRunAt;
}

async function workflowScheduleUpsert(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const scheduleId = normalizeScheduleId(input.scheduleId || input.schedule_id || input.id);
  const existingRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
  const existing = existingRows[0] || {};
  const scheduleKind = normalizeScheduleKind(input.scheduleKind || input.schedule_kind || existing.schedule_kind, input);
  const status = normalizeScheduleStatus(input.status || existing.status || "active");
  const timezone = normalizeTimezone(input.timezone || existing.timezone || "Asia/Shanghai");
  const cronExpr = scheduleKind === "cron" ? String(input.cronExpr || input.cron_expr || input.cron || existing.cron_expr || "").trim() : "";
  const rawIntervalSeconds = Number(input.intervalSeconds || input.interval_seconds || existing.interval_seconds || 0);
  const intervalSeconds = scheduleKind === "interval"
    ? Math.max(10, Math.min(366 * 24 * 3600, rawIntervalSeconds))
    : null;
  if (scheduleKind === "cron") parseCronExpression(cronExpr);
  if (scheduleKind === "interval" && (!Number.isFinite(rawIntervalSeconds) || rawIntervalSeconds <= 0)) throw new Error("interval schedule requires intervalSeconds");

  const runtime = normalizeRuntime(input.runtime || existing.runtime || "hermers");
  const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || existing.agent_id);
  const prompt = firstText(input.prompt, input.text, existing.prompt);
  if (!prompt) throw new Error("schedule prompt is required");
  const priority = normalizeSchedulePriority(input.priority || existing.priority);
  const concurrencyPolicy = normalizeSchedulePolicy(input.concurrencyPolicy || input.concurrency_policy || existing.concurrency_policy, WORKFLOW_SCHEDULE_CONCURRENCY_POLICIES, "skip");
  const misfirePolicy = normalizeSchedulePolicy(input.misfirePolicy || input.misfire_policy || existing.misfire_policy, WORKFLOW_SCHEDULE_MISFIRE_POLICIES, "skip");
  const catchupWindowSeconds = Math.max(0, Math.min(7 * 24 * 3600, Number(input.catchupWindowSeconds || input.catchup_window_seconds || existing.catchup_window_seconds || 900)));
  const timeoutSeconds = Math.max(5, Math.min(1800, Number(input.timeoutSeconds || input.timeout_seconds || existing.timeout_seconds || 45)));
  const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || input.max_attempts || existing.max_attempts || 1)));
  const payload = input.payload === undefined ? parseJsonValue(existing.payload_json, {}) : parseJsonValue(input.payload, input.payload || {});
  const now = nowIso();
  const nextRunInput = normalizeIsoTimestamp(input.nextRunAt || input.next_run_at || "", "nextRunAt");
  const resetNextRun = boolOption(input.resetNextRun ?? input.reset_next_run, false);
  const effectiveSchedule = { schedule_kind: scheduleKind, cron_expr: cronExpr, interval_seconds: intervalSeconds, timezone };
  const nextRunAt = nextRunInput || (!existing.schedule_id || resetNextRun || !existing.next_run_at ? nextScheduleRunAt(effectiveSchedule, now) : existing.next_run_at);
  const createdAt = existing.created_at || now;
  const createdBy = firstText(input.createdBy, input.created_by, input.from, existing.created_by, "workflow_scheduler");
  const dispatchType = firstText(input.dispatchType, input.dispatch_type, existing.dispatch_type, scheduleKind === "cron" ? "scheduled_cron" : "scheduled_interval");
  const name = firstText(input.name, existing.name, scheduleId);

  await sqlite(paths.dbFile, `
INSERT INTO workflow_schedules(schedule_id, name, status, schedule_kind, cron_expr, interval_seconds, timezone, runtime, agent_id, dispatch_type, priority, prompt, payload_json, concurrency_policy, catchup_window_seconds, misfire_policy, timeout_seconds, max_attempts, next_run_at, last_scheduled_at, last_dispatch_id, created_by, created_at, updated_at)
VALUES (${sqlValue(scheduleId)}, ${sqlValue(name)}, ${sqlValue(status)}, ${sqlValue(scheduleKind)}, ${sqlValue(cronExpr)}, ${sqlValue(intervalSeconds)}, ${sqlValue(timezone)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(dispatchType)}, ${sqlValue(priority)}, ${sqlValue(prompt)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(concurrencyPolicy)}, ${sqlValue(catchupWindowSeconds)}, ${sqlValue(misfirePolicy)}, ${sqlValue(timeoutSeconds)}, ${sqlValue(maxAttempts)}, ${sqlValue(nextRunAt)}, ${sqlValue(existing.last_scheduled_at || "")}, ${sqlValue(existing.last_dispatch_id || "")}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)}, ${sqlValue(now)})
ON CONFLICT(schedule_id) DO UPDATE SET
  name=excluded.name,
  status=excluded.status,
  schedule_kind=excluded.schedule_kind,
  cron_expr=excluded.cron_expr,
  interval_seconds=excluded.interval_seconds,
  timezone=excluded.timezone,
  runtime=excluded.runtime,
  agent_id=excluded.agent_id,
  dispatch_type=excluded.dispatch_type,
  priority=excluded.priority,
  prompt=excluded.prompt,
  payload_json=excluded.payload_json,
  concurrency_policy=excluded.concurrency_policy,
  catchup_window_seconds=excluded.catchup_window_seconds,
  misfire_policy=excluded.misfire_policy,
  timeout_seconds=excluded.timeout_seconds,
  max_attempts=excluded.max_attempts,
  next_run_at=excluded.next_run_at,
  created_by=COALESCE(NULLIF(workflow_schedules.created_by,''), excluded.created_by),
  updated_at=excluded.updated_at;`);

  const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
  return { schedule: scheduleRow(rows[0]), dbFile: paths.dbFile };
}

async function workflowScheduleList(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const filters = [];
  if (input.scheduleId || input.schedule_id || input.id) filters.push(`schedule_id=${sqlValue(normalizeScheduleId(input.scheduleId || input.schedule_id || input.id))}`);
  if (input.status) filters.push(`status=${sqlValue(normalizeScheduleStatus(input.status))}`);
  if (input.runtime) filters.push(`runtime=${sqlValue(normalizeRuntime(input.runtime))}`);
  if (input.agentId || input.agent_id) filters.push(`agent_id=${sqlValue(normalizeAgentId(input.agentId || input.agent_id))}`);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_schedules
${where}
ORDER BY status, next_run_at, schedule_id
LIMIT ${limit};`, { json: true });
  const runLimit = Math.max(0, Math.min(20, Number(input.runLimit || input.run_limit || 0)));
  const schedules = rows.map(scheduleRow);
  if (runLimit > 0) {
    for (const schedule of schedules) {
      const runs = await sqlite(paths.dbFile, `
SELECT *
FROM scheduled_runs
WHERE schedule_id=${sqlValue(schedule.scheduleId)}
ORDER BY scheduled_at DESC
LIMIT ${runLimit};`, { json: true });
      schedule.recentRuns = runs.map((row) => ({ ...row, result: parseJsonValue(row.result_json, {}) }));
    }
  }
  return { schedules, count: schedules.length, dbFile: paths.dbFile };
}

async function workflowScheduleStatus(rootDir, input = {}, forcedStatus = "") {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const scheduleId = normalizeScheduleId(input.scheduleId || input.schedule_id || input.id);
  const rows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
  if (!rows[0]) throw new Error(`schedule not found: ${scheduleId}`);
  const status = normalizeScheduleStatus(forcedStatus || input.status, rows[0].status || "paused");
  const now = nowIso();
  let nextRunAt = rows[0].next_run_at || "";
  if (status === "active" && (!nextRunAt || nextRunAt <= now || boolOption(input.resetNextRun ?? input.reset_next_run, false))) {
    nextRunAt = nextScheduleRunAt(rows[0], now);
  }
  await sqlite(paths.dbFile, `
UPDATE workflow_schedules
SET status=${sqlValue(status)},
    next_run_at=${sqlValue(nextRunAt)},
    updated_at=${sqlValue(now)}
WHERE schedule_id=${sqlValue(scheduleId)};`);
  const updated = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
  return { schedule: scheduleRow(updated[0]), dbFile: paths.dbFile };
}

async function hasActiveScheduledDispatch(paths, scheduleId) {
  const rows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM scheduled_runs sr
LEFT JOIN mixed_meeting_dispatches d ON d.dispatch_id=sr.dispatch_id
WHERE sr.schedule_id=${sqlValue(scheduleId)}
  AND sr.status IN ('queued','dispatched')
  AND (
    sr.status='queued'
    OR d.dispatch_id IS NULL
    OR d.status IN ('queued','sent')
  );`, { json: true });
  return Number(rows[0]?.count || 0) > 0;
}

async function seedDueScheduleJobs(paths, input = {}) {
  if (!boolOption(input.enableSchedules ?? input.enable_schedules, true)) return [];
  const now = normalizeIsoTimestamp(input.now || input.nowIso || input.now_iso || nowIso(), "now");
  const limit = Math.max(1, Math.min(100, Number(input.scheduleLimit || input.schedule_limit || 20)));
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_schedules
WHERE status='active'
  AND next_run_at IS NOT NULL
  AND next_run_at != ''
  AND next_run_at <= ${sqlValue(now)}
ORDER BY
  CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  next_run_at,
  schedule_id
LIMIT ${limit};`, { json: true });
  const seeded = [];
  for (const raw of rows) {
    const schedule = { ...raw };
    const scheduledAt = normalizeIsoTimestamp(schedule.next_run_at, "nextRunAt");
    const runId = scheduleRunId(schedule.schedule_id, scheduledAt);
    const catchupSeconds = Math.max(0, Number(schedule.catchup_window_seconds || 0));
    const misfired = catchupSeconds > 0 && scheduledAt < new Date(new Date(now).getTime() - catchupSeconds * 1000).toISOString();
    const activeDispatch = schedule.concurrency_policy === "skip" ? await hasActiveScheduledDispatch(paths, schedule.schedule_id) : false;
    const skipped = (misfired && schedule.misfire_policy === "skip") || activeDispatch;
    const status = skipped ? "skipped" : "queued";
    const error = activeDispatch ? "concurrency_policy_skip" : misfired ? "misfire_window_exceeded" : "";
    const createdAt = nowIso();

    await sqlite(paths.dbFile, `
INSERT OR IGNORE INTO scheduled_runs(run_id, schedule_id, scheduled_at, status, workflow_id, meeting_id, dispatch_id, runtime, agent_id, attempt, result_json, error, created_at, updated_at, completed_at)
VALUES (${sqlValue(runId)}, ${sqlValue(schedule.schedule_id)}, ${sqlValue(scheduledAt)}, ${sqlValue(status)}, '', '', '', ${sqlValue(schedule.runtime)}, ${sqlValue(schedule.agent_id)}, 0, ${sqlValue(JSON.stringify({ seededAt: createdAt, skipped }))}, ${sqlValue(error)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)}, ${sqlValue(skipped ? createdAt : "")});`);

    let job = null;
    if (!skipped) {
      job = await enqueueControlLoopJob(paths, {
        jobType: "scheduled_dispatch",
        dedupeKey: `scheduled_dispatch:${schedule.schedule_id}:${scheduledAt}`,
        priority: schedule.priority || "normal",
        workflowId: `schedule.${schedule.schedule_id}`,
        runtime: schedule.runtime,
        maxAttempts: schedule.max_attempts || 1,
        payload: { scheduleId: schedule.schedule_id, runId, scheduledAt }
      });
    }

    const nextRunAt = nextScheduleRunAfterSeed(schedule, scheduledAt, now, misfired);
    await sqlite(paths.dbFile, `
UPDATE workflow_schedules
SET next_run_at=${sqlValue(nextRunAt)},
    last_scheduled_at=${sqlValue(scheduledAt)},
    updated_at=${sqlValue(createdAt)}
WHERE schedule_id=${sqlValue(schedule.schedule_id)}
  AND next_run_at=${sqlValue(scheduledAt)};`);
    seeded.push({ scheduleId: schedule.schedule_id, runId, scheduledAt, status, error, job });
  }
  return seeded;
}

async function runScheduledDispatchJob(rootDir, paths, job, input = {}) {
  const payload = parseJsonValue(job.payload_json, {});
  const scheduleId = normalizeScheduleId(payload.scheduleId || payload.schedule_id);
  const scheduledAt = normalizeIsoTimestamp(payload.scheduledAt || payload.scheduled_at, "scheduledAt");
  const runId = String(payload.runId || payload.run_id || scheduleRunId(scheduleId, scheduledAt)).trim();
  const scheduleRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_schedules WHERE schedule_id=${sqlValue(scheduleId)} LIMIT 1;`, { json: true });
  const schedule = scheduleRows[0];
  if (!schedule) throw new Error(`schedule not found: ${scheduleId}`);
  const runRows = await sqlite(paths.dbFile, `SELECT * FROM scheduled_runs WHERE run_id=${sqlValue(runId)} LIMIT 1;`, { json: true });
  const run = runRows[0];
  if (!run) throw new Error(`scheduled run not found: ${runId}`);
  if (run.status !== "queued") return { scheduleId, runId, status: run.status, skipped: true };
  const workflowId = scheduledMeetingId(scheduleId, scheduledAt);
  const meetingId = workflowId;
  const traceId = `schedule.${scheduleId}.${cleanFileSegment(scheduledAt.replace(/[:.]/g, ""))}`;
  const idempotencyKey = `schedule:${scheduleId}:${scheduledAt}`;
  const schedulePayload = parseJsonValue(schedule.payload_json, {});
  const delivery = objectValue(schedulePayload.delivery || schedulePayload.deliveryConfig || schedulePayload.delivery_config);
  const deliveryMode = String(delivery.mode || "").trim().toLowerCase();
  const deliveryChannel = String(delivery.channel || "").trim().toLowerCase();
  const deliveryAccount = firstText(schedulePayload.accountId, schedulePayload.account_id, delivery.accountId, delivery.account_id, delivery.account, schedule.agent_id);
  const deliveryTarget = firstText(schedulePayload.chatId, schedulePayload.chat_id, schedulePayload.conversationId, schedulePayload.conversation_id, delivery.to, delivery.chatId, delivery.chat_id);
  const wantsTelegramReply = deliveryMode === "announce" && (deliveryChannel === "telegram" || deliveryTarget);
  try {
    const dispatch = await meetingDispatch(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId: `dispatch.${runId}`,
      runtime: schedule.runtime,
      agentId: schedule.agent_id,
      dispatchType: schedule.dispatch_type || "scheduled_dispatch",
      priority: schedule.priority || "normal",
      prompt: schedule.prompt,
      createdBy: schedule.created_by || "workflow_scheduler",
      maxAttempts: schedule.max_attempts || 1,
      ...(wantsTelegramReply ? {
        delivery,
        returnPolicy: firstText(schedulePayload.returnPolicy, schedulePayload.return_policy, delivery.returnPolicy, delivery.return_policy, "reply_to_source_chat"),
        deliveryPolicy: firstText(schedulePayload.deliveryPolicy, schedulePayload.delivery_policy, delivery.deliveryPolicy, delivery.delivery_policy, "reply_to_source_chat"),
        sourceChannel: firstText(schedulePayload.sourceChannel, schedulePayload.source_channel, delivery.channel, "telegram"),
        sourceSystem: firstText(schedulePayload.sourceSystem, schedulePayload.source_system, "workflow_scheduler"),
        sourceRuntime: firstText(schedulePayload.sourceRuntime, schedulePayload.source_runtime, "workflow_scheduler"),
        accountId: deliveryAccount,
        chatId: deliveryTarget,
        senderId: firstText(schedulePayload.senderId, schedulePayload.sender_id, "workflow_scheduler"),
        sourceMessageId: firstText(schedulePayload.sourceMessageId, schedulePayload.source_message_id, `schedule:${schedule.schedule_id}:${scheduledAt}`),
        routeAgentId: firstText(schedulePayload.routeAgentId, schedulePayload.route_agent_id, "workflow_scheduler"),
        routeRuntime: firstText(schedulePayload.routeRuntime, schedulePayload.route_runtime, "workflow_scheduler")
      } : {}),
      payload: {
        scheduleId,
        runId,
        scheduledAt,
        scheduleKind: schedule.schedule_kind,
        scheduleName: schedule.name || "",
        schedulePayload
      }
    });
    const completedAt = nowIso();
    await sqlite(paths.dbFile, `
UPDATE scheduled_runs
SET status='dispatched',
    workflow_id=${sqlValue(workflowId)},
    meeting_id=${sqlValue(meetingId)},
    dispatch_id=${sqlValue(dispatch.dispatchId)},
    runtime=${sqlValue(dispatch.runtime || schedule.runtime)},
    agent_id=${sqlValue(dispatch.agentId || schedule.agent_id)},
    attempt=attempt+1,
    result_json=${sqlValue(JSON.stringify({ dispatch, dispatchedAt: completedAt }))},
    updated_at=${sqlValue(completedAt)}
WHERE run_id=${sqlValue(runId)};`);
    await sqlite(paths.dbFile, `
UPDATE workflow_schedules
SET last_dispatch_id=${sqlValue(dispatch.dispatchId)},
    updated_at=${sqlValue(completedAt)}
WHERE schedule_id=${sqlValue(scheduleId)};`);
    await enqueueControlLoopJob(paths, {
      jobType: "runtime_drain",
      dedupeKey: `runtime_drain:${dispatch.runtime || schedule.runtime}`,
      priority: schedule.priority === "flash" ? "flash" : "high",
      runtime: dispatch.runtime || schedule.runtime,
      payload: {
        runtime: dispatch.runtime || schedule.runtime,
        limit: 1,
        timeoutSeconds: schedule.timeout_seconds || input.timeoutSeconds || input.timeout_seconds || 45
      }
    });
    return { scheduleId, runId, scheduledAt, status: "dispatched", dispatchId: dispatch.dispatchId, runtime: dispatch.runtime, agentId: dispatch.agentId, deduped: Boolean(dispatch.deduped) };
  } catch (error) {
    const failedAt = nowIso();
    const terminal = Number(job.attempt || 0) >= Number(job.max_attempts || 1);
    await sqlite(paths.dbFile, `
UPDATE scheduled_runs
SET status=${sqlValue(terminal ? "failed" : "queued")},
    attempt=attempt+1,
    error=${sqlValue(String(error?.message || error).slice(0, 2000))},
    updated_at=${sqlValue(failedAt)},
    completed_at=${sqlValue(terminal ? failedAt : "")}
WHERE run_id=${sqlValue(runId)};`);
    throw error;
  }
}

function controlLoopStatuses(input = {}) {
  const requested = toList(input.workflowStatuses || input.workflow_statuses || input.statuses);
  const statuses = requested.length ? requested : [...CONTROL_LOOP_WORKFLOW_STATUSES];
  const valid = statuses.filter((status) => WORKFLOW_RUN_STATUSES.has(status));
  return valid.length ? valid : [...CONTROL_LOOP_WORKFLOW_STATUSES];
}

async function appendControlLoopEvent(paths, tickId, phase, data = {}) {
  await appendJsonl(path.join(paths.bridgeDir, "control-loop-events.jsonl"), {
    ts: nowIso(),
    tickId,
    phase,
    ...data
  });
}

function controlLoopPriorityRank(priority) {
  const value = String(priority || "normal").trim();
  if (value === "flash") return -1;
  if (value === "steer") return 0;
  if (value === "high") return 1;
  if (value === "normal") return 2;
  if (value === "low") return 3;
  return 4;
}

function controlLoopTickBudgetMs(input = {}) {
  return Math.max(5_000, Math.min(30 * 60_000, Number(input.tickBudgetMs || input.tick_budget_ms || 60_000)));
}

function controlLoopTimeoutSeconds(input = {}) {
  return Math.max(5, Math.min(900, Number(input.timeoutSeconds || input.timeout_seconds || 45)));
}

function controlLoopWorkflowSuperviseCooldownMs(input = {}, status = "") {
  const defaultIdleCooldownMs = 5 * 60_000;
  const idleValue = input.idleWorkflowSuperviseCooldownMs
    ?? input.idle_workflow_supervise_cooldown_ms
    ?? input.blockedWorkflowSuperviseCooldownMs
    ?? input.blocked_workflow_supervise_cooldown_ms
    ?? defaultIdleCooldownMs;
  const generalValue = input.workflowSuperviseCooldownMs ?? input.workflow_supervise_cooldown_ms ?? 0;
  const value = ["blocked", "waiting_human"].includes(String(status || "")) ? idleValue : generalValue;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(24 * 3600_000, Math.max(0, number));
}

function controlLoopJobLeaseMs(input = {}) {
  const requested = Math.max(10_000, Math.min(60 * 60_000, Number(input.jobLeaseMs || input.job_lease_ms || 120_000)));
  const minSafe = Math.max(controlLoopTickBudgetMs(input) + 30_000, (controlLoopTimeoutSeconds(input) + 30) * 1000);
  return Math.max(requested, minSafe);
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

async function seedControlLoopJobs(paths, input = {}) {
  const seeded = [];
  const maxWorkflows = Math.max(1, Math.min(100, Number(input.maxWorkflowSeed || input.max_workflow_seed || input.maxWorkflows || input.max_workflows || 20)));
  const runtimeLimit = Math.max(1, Math.min(20, Number(input.runtimeLimit || input.runtime_limit || input.limit || 1)));
  const outboxLimit = Math.max(1, Math.min(20, Number(input.outboxLimit || input.outbox_limit || 5)));
  const timeoutSeconds = controlLoopTimeoutSeconds(input);
  const autoDispatch = boolOption(input.autoDispatch ?? input.auto_dispatch, true);
  const autoReport = boolOption(input.autoReport ?? input.auto_report, false);
  const drainQueued = boolOption(input.drainQueued ?? input.drain_queued, true);
  const deliverOutbox = boolOption(input.deliverOutbox ?? input.deliver_outbox, true);
  const ensureHumanGateRequests = boolOption(input.ensureHumanGateRequests ?? input.ensure_human_gate_requests, true);
  const createHumanGateInbox = boolOption(input.createHumanGateInbox ?? input.create_human_gate_inbox, true);
  const explicitRuntimeInput = input.runtime !== undefined || input.runtimes !== undefined;
  const requestedRuntimeValues = explicitRuntimeInput ? toList(input.runtimes ?? input.runtime) : [];
  const invalidRequestedRuntimes = requestedRuntimeValues.filter((runtime) => !normalizeKnownRuntime(runtime));
  if (drainQueued && explicitRuntimeInput && invalidRequestedRuntimes.length) {
    throw new Error(`invalid runtime for control_loop drain: ${[...new Set(invalidRequestedRuntimes)].join(",")}`);
  }
  const reportRuntime = normalizeRuntime(input.reportRuntime || input.report_runtime || "openclaw");
  const reportAgent = normalizeAgentId(input.reportAgent || input.report_agent || "cat_claw");
  const staleDispatchAfterMs = Math.max(5 * 60_000, Number(input.staleDispatchAfterMs || input.stale_dispatch_after_ms || (timeoutSeconds + 60) * 1000));
  const staleDispatchCutoff = new Date(Date.now() - staleDispatchAfterMs).toISOString();
  const dispatchReconcileLimit = Math.max(1, Math.min(100, Number(input.dispatchReconcileLimit || input.dispatch_reconcile_limit || 20)));
  const messageFlowStuckAfterMs = Math.max(60_000, Math.min(24 * 3600_000, Number(input.messageFlowStuckAfterMs || input.message_flow_stuck_after_ms || 5 * 60_000)));
  const messageFlowReconcileLimit = Math.max(1, Math.min(200, Number(input.messageFlowReconcileLimit || input.message_flow_reconcile_limit || 20)));
  const messageFlowStuckCutoff = new Date(Date.now() - messageFlowStuckAfterMs).toISOString();
  const statuses = controlLoopStatuses(input);

  seeded.push(...await seedDueScheduleJobs(paths, input));

  const workflowRows = await sqlite(paths.dbFile, `
SELECT workflow_id, status, current_decision, payload_json, updated_at
FROM workflow_runs
WHERE status IN (${sqlStringList(statuses)})
ORDER BY
  CASE status WHEN 'waiting_human' THEN 0 WHEN 'blocked' THEN 1 ELSE 2 END,
  updated_at
LIMIT ${maxWorkflows};`, { json: true });
  for (const row of workflowRows) {
    const payload = parseJsonValue(row.payload_json, {});
    const flashLane = boolOption(payload.flashLane ?? payload.flash_lane ?? payload.tradingExecution ?? payload.trading_execution, false);
    const superviseCooldownMs = flashLane ? 0 : controlLoopWorkflowSuperviseCooldownMs(input, row.status);
    seeded.push(await enqueueControlLoopJob(paths, {
      jobType: "workflow_supervise",
      dedupeKey: `workflow_supervise:${row.workflow_id}`,
      priority: flashLane ? "flash" : row.status === "waiting_human" ? "steer" : row.status === "blocked" ? "high" : "normal",
      workflowId: row.workflow_id,
      cooldownMs: superviseCooldownMs,
      payload: {
        workflowId: row.workflow_id,
        meetingId: row.workflow_id,
        flashLane,
        workflowStatus: row.status,
        superviseCooldownMs,
        autoDispatch,
        autoReport,
        reportRuntime,
        reportAgent,
        runtimeLimit,
        timeoutSeconds,
        maxCycles: input.maxCycles || input.max_cycles || 1
      }
    }));
  }

  const staleDispatchRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE status='sent' AND updated_at < ${sqlValue(staleDispatchCutoff)};`, { json: true });
  if (Number(staleDispatchRows[0]?.count || 0) > 0) {
    seeded.push(await enqueueControlLoopJob(paths, {
      jobType: "stale_dispatch_reconcile",
      dedupeKey: "stale_dispatch_reconcile",
      priority: "high",
      payload: { limit: dispatchReconcileLimit, staleDispatchAfterMs }
    }));
  }

  const stuckMessageFlowRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM message_flows
WHERE (
    final_output_present=1
    AND delivery_receipt_present=0
    AND return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])})
    AND runtime_completed_at IS NOT NULL
    AND runtime_completed_at != ''
    AND runtime_completed_at < ${sqlValue(messageFlowStuckCutoff)}
    AND status NOT IN ('telegram_sent','telegram_failed')
  )
  OR (
    final_output_present=0
    AND delivery_receipt_present=0
    AND status='runtime_failed'
    AND outbox_id IS NOT NULL
    AND outbox_id != ''
    AND runtime_failed_at IS NOT NULL
    AND runtime_failed_at != ''
    AND runtime_failed_at < ${sqlValue(messageFlowStuckCutoff)}
  )
  OR (
    final_output_present=0
    AND delivery_receipt_present=0
    AND status='runtime_acknowledged'
    AND updated_at < ${sqlValue(messageFlowStuckCutoff)}
    AND NOT EXISTS (
      SELECT 1
      FROM mixed_meeting_dispatches d
      WHERE d.dispatch_type='message_flow_semantic'
        AND d.idempotency_key=('message-flow-semantic:' || message_flows.flow_id || ':' || message_flows.dispatch_id)
    )
  );`, { json: true });
  if (Number(stuckMessageFlowRows[0]?.count || 0) > 0) {
    seeded.push(await enqueueControlLoopJob(paths, {
      jobType: "message_flow_reconcile",
      dedupeKey: "message_flow_reconcile",
      priority: "high",
      payload: { limit: messageFlowReconcileLimit, messageFlowStuckAfterMs }
    }));
  }

  if (drainQueued) {
    const requestedRuntimes = requestedRuntimeValues.map(normalizeKnownRuntime).filter(Boolean);
    const configuredRuntimes = new Set(requestedRuntimes);
    if (!configuredRuntimes.size) {
      const dueRuntimeRows = await sqlite(paths.dbFile, `
SELECT runtime
FROM mixed_meeting_dispatches
WHERE status='queued'
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())})
GROUP BY runtime
ORDER BY runtime;`, { json: true });
      for (const row of dueRuntimeRows) {
        const runtime = normalizeKnownRuntime(row.runtime);
        if (runtime) configuredRuntimes.add(runtime);
      }
    }
    const runtimes = [...configuredRuntimes];
    const preciseRuntimeExclusion = runtimes.length ? `AND runtime NOT IN (${sqlStringList(runtimes)})` : "";
    for (const runtime of runtimes) {
      const rows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE status='queued' AND runtime=${sqlValue(runtime)}
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())});`, { json: true });
      if (Number(rows[0]?.count || 0) <= 0) continue;
      const hasFlash = Number((await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE status='queued' AND runtime=${sqlValue(runtime)} AND priority='flash'
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())});`, { json: true }))[0]?.count || 0) > 0;
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "runtime_drain",
        dedupeKey: `runtime_drain:${runtime}`,
        priority: hasFlash ? "flash" : "high",
        runtime,
        payload: { runtime, limit: runtimeLimit, timeoutSeconds }
      }));
    }
    const messageFlowDispatchRows = await sqlite(paths.dbFile, `
SELECT dispatch_id, runtime, priority
FROM mixed_meeting_dispatches
WHERE status='queued'
  AND dispatch_type IN ('message_flow_send','message_flow_semantic')
  ${preciseRuntimeExclusion}
  AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(nowIso())})
ORDER BY
  CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  created_at
LIMIT ${runtimeLimit};`, { json: true });
    for (const row of messageFlowDispatchRows) {
      const runtime = normalizeRuntime(row.runtime);
      if (!RUNTIMES.has(runtime)) continue;
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "runtime_drain",
        dedupeKey: `runtime_drain:${runtime}:${row.dispatch_id}`,
        priority: row.priority || "high",
        runtime,
        payload: { runtime, dispatchId: row.dispatch_id, limit: 1, timeoutSeconds }
      }));
    }
  }

  if (ensureHumanGateRequests) {
    const rows = await sqlite(paths.dbFile, `SELECT COUNT(*) AS count FROM protocol_objects WHERE object_type='human_gate_record' AND status='pending';`, { json: true });
    if (Number(rows[0]?.count || 0) > 0) {
      const flashRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending'
  AND (
    payload_json LIKE ${sqlValue('%"flashLane":true%')}
    OR payload_json LIKE ${sqlValue('%"flash_lane":true%')}
    OR payload_json LIKE ${sqlValue('%live_trade%')}
    OR payload_json LIKE ${sqlValue('%real_trade%')}
    OR payload_json LIKE ${sqlValue('%真实交易%')}
    OR payload_json LIKE ${sqlValue('%实盘%')}
  );`, { json: true });
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "human_gate_request_ensure",
        dedupeKey: "human_gate_request_ensure",
        priority: Number(flashRows[0]?.count || 0) > 0 ? "flash" : "steer",
        payload: { limit: input.humanGateRequestLimit || input.human_gate_request_limit || 5 }
      }));
    }
  }

  if (deliverOutbox) {
    const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
    const rows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM telegram_outbox
WHERE status='queued'
   OR (status='delivering' AND updated_at <= ${sqlValue(staleDeliveringBefore)});`, { json: true });
    if (Number(rows[0]?.count || 0) > 0) {
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "telegram_outbox_deliver",
        dedupeKey: "telegram_outbox_deliver",
        priority: "high",
        payload: { limit: outboxLimit }
      }));
    }
  }

  if (createHumanGateInbox) {
    const recentCutoff = new Date(Date.now() - Math.max(60_000, Math.min(24 * 3600_000, Number(input.humanGateInboxIntervalMs || input.human_gate_inbox_interval_ms || 30 * 60_000)))).toISOString();
    const recent = await sqlite(paths.dbFile, `SELECT batch_id FROM human_gate_batches WHERE created_at >= ${sqlValue(recentCutoff)} LIMIT 1;`, { json: true });
    const pending = await sqlite(paths.dbFile, `
SELECT
  (SELECT COUNT(*) FROM protocol_objects WHERE object_type='human_gate_record' AND status='pending') +
  (SELECT COUNT(*) FROM review_gates WHERE status='pending' OR (human_gate_required=1 AND status NOT IN ('approved','rejected','waived','expired','cancelled','done'))) +
  (SELECT COUNT(*) FROM workflow_tasks WHERE human_gate_required=1 AND status NOT IN ('done','failed','cancelled')) +
  (SELECT COUNT(*) FROM telegram_outbox WHERE status IN ('queued','failed') AND message_type IN ('workflow_secretary_report','human_gate_report','human_gate_request')) AS count;`, { json: true });
    if (!recent[0] && Number(pending[0]?.count || 0) > 0) {
      seeded.push(await enqueueControlLoopJob(paths, {
        jobType: "human_gate_inbox",
        dedupeKey: "human_gate_inbox",
        priority: "normal",
        payload: { limit: input.humanGateInboxLimit || input.human_gate_inbox_limit || 100 }
      }));
    }
  }

  return seeded;
}

async function claimControlLoopJobs(paths, input = {}) {
  const owner = String(input.claimOwner || input.claim_owner || input.owner || input.leaseOwner || input.lease_owner || `pid:${process.pid}:${safeId("claim")}`).trim();
  const limit = Math.max(1, Math.min(20, Number(input.jobLimit || input.job_limit || 4)));
  const leaseMs = controlLoopJobLeaseMs(input);
  const now = nowIso();
  const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM control_loop_jobs
WHERE (
    status IN ('queued','retry_scheduled')
    AND (next_run_at IS NULL OR next_run_at='' OR next_run_at <= ${sqlValue(now)})
  )
  OR (status='running' AND lease_until <= ${sqlValue(now)})
ORDER BY
  CASE priority WHEN 'flash' THEN -1 WHEN 'steer' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
  created_at
LIMIT ${limit};`, { json: true });
  const claimed = [];
  for (const row of rows) {
    const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status='running',
    attempt=attempt+1,
    lease_owner=${sqlValue(owner)},
    lease_until=${sqlValue(leaseUntil)},
    updated_at=${sqlValue(now)}
WHERE job_id=${sqlValue(row.job_id)}
  AND (
    status IN ('queued','retry_scheduled')
    OR (status='running' AND lease_until <= ${sqlValue(now)})
  );`);
    if (changed !== 1) continue;
    const latest = await sqlite(paths.dbFile, `SELECT * FROM control_loop_jobs WHERE job_id=${sqlValue(row.job_id)} AND status='running' AND lease_owner=${sqlValue(owner)} LIMIT 1;`, { json: true });
    if (latest[0]) claimed.push(latest[0]);
  }
  return claimed;
}

async function completeControlLoopJob(paths, job, result = {}) {
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status='done',
    result_json=${sqlValue(JSON.stringify(result))},
    lease_owner='',
    lease_until='',
    completed_at=${sqlValue(nowIso())},
    updated_at=${sqlValue(nowIso())}
WHERE job_id=${sqlValue(job.job_id)}
  AND status='running'
  AND lease_owner=${sqlValue(job.lease_owner || "")}
  AND lease_until=${sqlValue(job.lease_until || "")};`);
  return changed === 1
    ? { status: "done", completed: true }
    : { status: "lease_lost", completed: false, reason: "control_loop_job_lease_owner_changed" };
}

async function failControlLoopJob(paths, job, error) {
  const message = String(error?.message || error).slice(0, 1000);
  const attempt = Number(job.attempt || 0);
  const maxAttempts = Number(job.max_attempts || 20);
  const retry = attempt < maxAttempts;
  const delayMs = Math.min(5 * 60_000, 5_000 * Math.max(1, attempt));
  const nextRunAt = retry ? new Date(Date.now() + delayMs).toISOString() : "";
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status=${sqlValue(retry ? "retry_scheduled" : "failed")},
    last_error=${sqlValue(message)},
    next_run_at=${sqlValue(nextRunAt)},
    lease_owner='',
    lease_until='',
    updated_at=${sqlValue(nowIso())}
WHERE job_id=${sqlValue(job.job_id)}
  AND status='running'
  AND lease_owner=${sqlValue(job.lease_owner || "")}
  AND lease_until=${sqlValue(job.lease_until || "")};`);
  if (changed !== 1) return { status: "lease_lost", error: message, nextRunAt: "", reason: "control_loop_job_lease_owner_changed" };
  return { status: retry ? "retry_scheduled" : "failed", error: message, nextRunAt };
}

function controlLoopJobSummary(row = {}) {
  return {
    jobId: row.job_id || "",
    jobType: row.job_type || "",
    dedupeKey: row.dedupe_key || "",
    priority: row.priority || "",
    status: row.status || "",
    workflowId: row.workflow_id || "",
    runtime: row.runtime || "",
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 0),
    nextRunAt: row.next_run_at || "",
    leaseOwner: row.lease_owner || "",
    leaseUntil: row.lease_until || "",
    lastError: redactSensitiveTextForPersistence(row.last_error || ""),
    completedAt: row.completed_at || "",
    updatedAt: row.updated_at || ""
  };
}

async function workflowControlLoopJobRequeuePreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const jobId = firstText(input.jobId, input.job_id, input.refId, input.ref_id);
  if (!jobId) throw new Error("jobId is required");
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const workflowClause = workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : "";
  const generatedAt = nowIso();
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM control_loop_jobs
WHERE job_id=${sqlValue(jobId)}
  ${workflowClause}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  const violations = [];
  if (!row) {
    violations.push({ code: "job_not_found", detail: "No matching control_loop_jobs row exists for the requested jobId/workflowId." });
  }
  const activeStatuses = [...CONTROL_LOOP_ACTIVE_JOB_STATUSES];
  let activeConflict = null;
  if (row?.dedupe_key) {
    const conflictRows = await sqlite(paths.dbFile, `
SELECT job_id, status
FROM control_loop_jobs
WHERE dedupe_key=${sqlValue(row.dedupe_key)}
  AND job_id != ${sqlValue(row.job_id)}
  AND status IN (${sqlStringList(activeStatuses)})
ORDER BY updated_at DESC
LIMIT 1;`, { json: true });
    activeConflict = conflictRows[0] || null;
    if (activeConflict) {
      violations.push({ code: "active_dedupe_conflict", detail: `Active job ${activeConflict.job_id} already owns dedupe_key ${row.dedupe_key}.` });
    }
  }
  const status = String(row?.status || "").trim();
  const expiredLease = status === "running" && String(row?.lease_until || "").trim() && String(row.lease_until) <= generatedAt;
  const failedTerminal = ["failed", "dead_letter"].includes(status);
  if (row && !failedTerminal && !expiredLease) {
    violations.push({ code: "status_not_requeueable", detail: `Only failed/dead_letter jobs or expired running leases can be requeued; current status is ${status || "unknown"}.` });
  }
  const resetAttempt = boundedNumber([input.resetAttempt, input.reset_attempt], 0, 0, Math.max(0, Number(row?.max_attempts || 20)));
  const nextRunAt = firstText(input.nextRunAt, input.next_run_at, generatedAt);
  const operatorReason = firstText(input.requeueOperatorReason, input.requeue_operator_reason, input.operatorReason, input.operator_reason, input.reason);
  const eligible = violations.length === 0;
  return {
    schemaVersion: "workflow_control_loop_job_requeue_preview.v1",
    action: "workflow.control_loop.job.requeue.preview",
    preview: true,
    readOnly: true,
    eligible,
    governanceReady: eligible && Boolean(operatorReason),
    generatedAt,
    jobId,
    workflowId: workflowId || row?.workflow_id || "",
    currentJob: row ? controlLoopJobSummary(row) : null,
    activeDedupeConflict: activeConflict ? { jobId: activeConflict.job_id, status: activeConflict.status } : null,
    requeuePlan: row ? {
      nextStatus: "queued",
      resetAttempt,
      nextRunAt,
      clearLease: true,
      clearLastError: true,
      clearCompletedAt: true,
      preserveEvidenceInPayloadHistory: true
    } : null,
    wouldMutate: row ? {
      controlLoopJobs: eligible ? 1 : 0,
      workflowEvents: eligible ? 1 : 0,
      dispatches: 0,
      runtimeRuns: 0,
      messageFlows: 0,
      outbox: 0,
      humanGate: 0,
      sideEffects: 0
    } : { controlLoopJobs: 0, workflowEvents: 0 },
    requiredEvidence: ["operatorReason or requeueOperatorReason"],
    violations,
    limitations: [
      "Preview is read-only and does not change queue state.",
      "Execution only requeues the selected control_loop_jobs row and writes one workflow event.",
      "Execution does not run the job, dispatch agents, deliver Telegram, resume Human Gate, or mutate trading state."
    ],
    dbFile: paths.dbFile
  };
}

async function workflowControlLoopJobRequeue(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const preview = await workflowControlLoopJobRequeuePreview(rootDir, input);
  if (!preview.eligible) {
    throw new Error(`control-loop job is not requeueable: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  const operatorReason = firstText(input.requeueOperatorReason, input.requeue_operator_reason, input.operatorReason, input.operator_reason, input.reason);
  if (!operatorReason) throw new Error("operatorReason is required to requeue a control-loop job");
  const row = (await sqlite(paths.dbFile, `SELECT * FROM control_loop_jobs WHERE job_id=${sqlValue(preview.jobId)} LIMIT 1;`, { json: true }))[0];
  if (!row) throw new Error(`control-loop job disappeared before requeue: ${preview.jobId}`);
  const requeuedAt = nowIso();
  const resetAttempt = preview.requeuePlan.resetAttempt;
  const nextRunAt = preview.requeuePlan.nextRunAt || requeuedAt;
  const payload = parseJsonValue(row.payload_json, {});
  const requeueHistory = Array.isArray(payload.requeueHistory) ? payload.requeueHistory.slice(-9) : [];
  requeueHistory.push(redactSensitiveForPersistence({
    requeuedAt,
    operatorReason,
    requestedBy: permissionDecision?.caller?.agentId || firstText(input.actor, input.requester, input.callerAgent, input.caller_agent, "unknown"),
    previous: {
      status: row.status || "",
      attempt: Number(row.attempt || 0),
      nextRunAt: row.next_run_at || "",
      leaseOwner: row.lease_owner || "",
      leaseUntil: row.lease_until || "",
      lastError: row.last_error || "",
      completedAt: row.completed_at || "",
      result: parseJsonValue(row.result_json, {})
    }
  }));
  const nextPayload = {
    ...payload,
    requeueHistory,
    requeue: {
      lastRequeuedAt: requeuedAt,
      lastRequeuedBy: permissionDecision?.caller?.agentId || firstText(input.actor, input.requester, input.callerAgent, input.caller_agent, "unknown"),
      resetAttempt,
      nextRunAt,
      reason: redactSensitiveTextForPersistence(operatorReason)
    }
  };
  const persistedPayload = redactSensitiveForPersistence(nextPayload);
  const activeStatuses = sqlStringList([...CONTROL_LOOP_ACTIVE_JOB_STATUSES]);
  const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE control_loop_jobs
SET status='queued',
    attempt=${sqlValue(resetAttempt)},
    next_run_at=${sqlValue(nextRunAt)},
    lease_owner='',
    lease_until='',
    last_error='',
    completed_at='',
    result_json='{}',
    payload_json=${sqlValue(JSON.stringify(persistedPayload))},
    updated_at=${sqlValue(requeuedAt)}
WHERE job_id=${sqlValue(row.job_id)}
  AND (
    status IN ('failed','dead_letter')
    OR (status='running' AND COALESCE(lease_until,'') != '' AND lease_until <= ${sqlValue(preview.generatedAt)})
  )
  AND NOT EXISTS (
    SELECT 1
    FROM control_loop_jobs other
    WHERE other.dedupe_key=${sqlValue(row.dedupe_key)}
      AND other.job_id != ${sqlValue(row.job_id)}
      AND other.status IN (${activeStatuses})
  );`);
  if (changed !== 1) {
    throw new Error(`control-loop job requeue lost race or became ineligible: ${row.job_id}`);
  }
  await appendWorkflowEvent(paths, {
    eventType: "control_loop.job.requeued",
    status: "queued",
    workflowId: row.workflow_id || "",
    actor: permissionDecision?.caller?.agentId || firstText(input.actor, input.requester, input.callerAgent, input.caller_agent, "workflow"),
    sourceRuntime: permissionDecision?.caller?.runtime || firstText(input.callerRuntime, input.caller_runtime, "workflow"),
    previousState: row.status || "",
    nextState: "queued",
    eventId: safeId("workflow_event.requeue"),
    idempotencyKey: "",
    payload: {
      jobId: row.job_id,
      jobType: row.job_type || "",
      dedupeKey: row.dedupe_key || "",
      previousAttempt: Number(row.attempt || 0),
      resetAttempt,
      nextRunAt,
      operatorReason: redactSensitiveTextForPersistence(operatorReason)
    },
    createdAt: requeuedAt
  });
  const latest = (await sqlite(paths.dbFile, `SELECT * FROM control_loop_jobs WHERE job_id=${sqlValue(row.job_id)} LIMIT 1;`, { json: true }))[0];
  return {
    schemaVersion: "workflow_control_loop_job_requeue_result.v1",
    action: "workflow.control_loop.job.requeue",
    status: "queued",
    requeued: true,
    requeuedAt,
    jobId: row.job_id,
    workflowId: row.workflow_id || "",
    previousStatus: row.status || "",
    currentJob: controlLoopJobSummary(latest || row),
    writeBoundary: "control_loop_job_only",
    didRunJob: false,
    didDispatchAgent: false,
    didDeliverTelegram: false,
    didMutateTradingState: false,
    dbFile: paths.dbFile
  };
}

async function runControlLoopJob(rootDir, paths, job, input = {}) {
  const payload = parseJsonValue(job.payload_json, {});
  if (job.job_type === "workflow_supervise") {
    const workflowId = job.workflow_id || payload.workflowId || payload.workflow_id;
    const supervised = await workflowSupervisor(rootDir, {
      ...input,
      ...payload,
      workflowRootDir: paths.root,
      workflowId,
      meetingId: payload.meetingId || payload.meeting_id || workflowId,
      drain: false,
      checkpoint: false,
      dryRun: false
    });
    const enqueuedDrains = [];
    for (const dispatch of supervised.dispatched || []) {
      const runtime = normalizeRuntime(dispatch.runtime || "");
      const dispatchId = String(dispatch.dispatchId || dispatch.dispatch_id || "").trim();
      if (!dispatchId || !RUNTIMES.has(runtime)) continue;
      enqueuedDrains.push(await enqueueControlLoopJob(paths, {
        jobType: "runtime_drain",
        dedupeKey: `runtime_drain:${runtime}:${dispatchId}`,
        priority: dispatch.priority || "high",
        runtime,
        workflowId,
        payload: { runtime, dispatchId, limit: 1, timeoutSeconds: payload.timeoutSeconds || payload.timeout_seconds || input.timeoutSeconds || input.timeout_seconds || 45 }
      }));
    }
    return {
      workflowId,
      decision: supervised.finalAdvance?.decision || "",
      dispatched: supervised.dispatched?.length || 0,
      enqueuedDrains,
      catClawReportDispatchId: supervised.catClawReport?.dispatchId || ""
    };
  }
  if (job.job_type === "scheduled_dispatch") {
    return runScheduledDispatchJob(rootDir, paths, job, input);
  }
  if (job.job_type === "runtime_drain") {
    const limit = boundedNumber([payload.limit, payload.runtimeLimit, payload.runtime_limit, input.runtimeLimit, input.runtime_limit, input.limit], 1, 1, 20);
    return runtimeBridgeDrain(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      runtime: payload.runtime || job.runtime,
      dispatchId: payload.dispatchId || payload.dispatch_id || input.dispatchId || input.dispatch_id || "",
      limit,
      timeoutSeconds: payload.timeoutSeconds || payload.timeout_seconds || input.timeoutSeconds || input.timeout_seconds || 45,
      dryRun: false
    });
  }
  if (job.job_type === "stale_dispatch_reconcile") {
    return staleDispatchReconcile(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      limit: payload.limit || input.dispatchReconcileLimit || input.dispatch_reconcile_limit || 20,
      staleDispatchAfterMs: payload.staleDispatchAfterMs || payload.stale_dispatch_after_ms || input.staleDispatchAfterMs || input.stale_dispatch_after_ms
    });
  }
  if (job.job_type === "message_flow_reconcile") {
    return messageFlowReconcile(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      limit: payload.limit || input.messageFlowReconcileLimit || input.message_flow_reconcile_limit || 20,
      messageFlowStuckAfterMs: payload.messageFlowStuckAfterMs || payload.message_flow_stuck_after_ms || input.messageFlowStuckAfterMs || input.message_flow_stuck_after_ms
    });
  }
  if (job.job_type === "meeting_dispatch_retry") {
    const dispatchInput = parseJsonValue(payload.dispatchInput, payload.dispatchInput || {});
    if (!dispatchInput || typeof dispatchInput !== "object" || Array.isArray(dispatchInput)) {
      throw new Error("meeting_dispatch_retry payload.dispatchInput is required");
    }
    return meetingDispatch(rootDir, {
      ...dispatchInput,
      workflowRootDir: paths.root
    });
  }
  if (job.job_type === "human_gate_request_ensure") {
    return ensurePendingHumanGateRequests(rootDir, paths, { ...input, ...payload });
  }
  if (job.job_type === "telegram_outbox_deliver") {
    return telegramOutbox(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      operation: "deliver",
      status: "queued",
      limit: payload.limit || input.outboxLimit || input.outbox_limit || 5,
      account: input.account
    });
  }
  if (job.job_type === "human_gate_inbox") {
    return humanGateInbox(rootDir, {
      ...input,
      ...payload,
      workflowRootDir: paths.root,
      target: input.target || DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID,
      from: input.from || "cat_claw"
    });
  }
  throw new Error(`unknown control loop job type: ${job.job_type}`);
}

export async function workflowControlLoopTick(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const tickId = input.tickId || input.tick_id || safeId("workflow_tick");
  const startedAt = nowIso();
  const lease = await acquireControlLoopLease(paths, input);
  if (!lease.acquired) {
    return { tickId, status: "skipped_lease_held", startedAt, lease, dbFile: paths.dbFile };
  }

  const result = {
    tickId,
    status: "running",
    startedAt,
    lease,
    readinessBefore: null,
    readinessAfter: null,
    seededJobs: [],
    claimedJobs: [],
    jobResults: [],
    dbFile: paths.dbFile
  };

  try {
    const tickBudgetMs = controlLoopTickBudgetMs(input);
    const timeoutSeconds = controlLoopTimeoutSeconds(input);
    const jobLeaseMs = controlLoopJobLeaseMs(input);
    const claimOwner = `${input.owner || input.leaseOwner || input.lease_owner || `pid:${process.pid}`}:${tickId}`;
    const dryRun = boolOption(input.dryRun ?? input.dry_run, false);
    const jobLimit = Math.max(1, Math.min(20, Number(input.jobLimit || input.job_limit || input.maxJobs || input.max_jobs || 4)));
    const startedAtMs = Date.now();
    const withinBudget = () => Date.now() - startedAtMs < tickBudgetMs;

    await appendControlLoopEvent(paths, tickId, "started", { lease, tickBudgetMs, timeoutSeconds, jobLeaseMs, jobLimit, dryRun });
    await appendControlLoopEvent(paths, tickId, "readiness_before_started");
    result.readinessBefore = await workflowReadinessSnapshot(paths, { ...input, activeChecks: false });
    await appendControlLoopEvent(paths, tickId, "readiness_before_completed", { status: result.readinessBefore?.status || "" });

    if (!dryRun) {
      await appendControlLoopEvent(paths, tickId, "job_seed_started");
      result.seededJobs = await seedControlLoopJobs(paths, input);
      await appendControlLoopEvent(paths, tickId, "job_seed_completed", { count: result.seededJobs.length });

      for (let index = 0; index < jobLimit && withinBudget(); index += 1) {
        const [job] = await claimControlLoopJobs(paths, { ...input, claimOwner, jobLimit: 1, jobLeaseMs, tickBudgetMs, timeoutSeconds });
        if (!job) break;
        const jobSummary = {
          jobId: job.job_id,
          jobType: job.job_type,
          dedupeKey: job.dedupe_key,
          priority: job.priority,
          workflowId: job.workflow_id || "",
          runtime: job.runtime || "",
          attempt: job.attempt
        };
        result.claimedJobs.push(jobSummary);
        await appendControlLoopEvent(paths, tickId, "job_started", jobSummary);
        try {
          const jobResult = await runControlLoopJob(rootDir, paths, job, input);
          const completed = await completeControlLoopJob(paths, job, jobResult);
          result.jobResults.push({ ...jobSummary, status: completed.status, result: jobResult, reason: completed.reason || "" });
          await appendControlLoopEvent(paths, tickId, completed.completed ? "job_completed" : "job_completion_skipped", { ...jobSummary, ...completed });
        } catch (error) {
          const failed = await failControlLoopJob(paths, job, error);
          result.jobResults.push({ ...jobSummary, ...failed });
          await appendControlLoopEvent(paths, tickId, failed.status === "lease_lost" ? "job_failure_skipped" : "job_failed", { ...jobSummary, ...failed });
        }
      }
    } else {
      result.seededJobs = [];
      result.jobResults.push({ status: "dry_run", summary: "control loop queue was not mutated" });
    }

    await appendControlLoopEvent(paths, tickId, "readiness_after_started");
    result.readinessAfter = await workflowReadinessSnapshot(paths, { ...input, activeChecks: false });
    await appendControlLoopEvent(paths, tickId, "readiness_after_completed", { status: result.readinessAfter?.status || "" });
    if (!dryRun) {
      try {
        result.retention = await maybeRunWorkflowRetention(paths, input);
        await appendControlLoopEvent(paths, tickId, "retention_completed", {
          status: result.retention?.status || "",
          cutoffIso: result.retention?.cutoffIso || "",
          backupRemovedCount: result.retention?.backups?.removedCount || 0,
          database: result.retention?.database || {}
        });
      } catch (error) {
        result.retention = { status: "failed", error: String(error?.message || error).slice(0, 1000) };
        await appendControlLoopEvent(paths, tickId, "retention_failed", { error: result.retention.error });
      }
    }
    result.status = "ok";
    result.completedAt = nowIso();
    await appendJsonl(path.join(paths.bridgeDir, "control-loop.jsonl"), result);
    await appendControlLoopEvent(paths, tickId, "completed", { status: result.status });
    return result;
  } catch (error) {
    result.status = "failed";
    result.error = String(error?.message || error).slice(0, 2000);
    result.completedAt = nowIso();
    await appendJsonl(path.join(paths.bridgeDir, "control-loop.jsonl"), result);
    await appendControlLoopEvent(paths, tickId, "failed", { error: result.error });
    return result;
  } finally {
    await releaseControlLoopLease(paths, lease, result);
  }
}

export async function cat_clawAudit(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const staleDays = Number(input.staleDays || input.stale_days || 30);
  const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
  const staleThesis = await sqlite(paths.dbFile, `
SELECT i.instrument_id, i.asset_type, i.symbol, t.thesis_status, t.thesis_path, t.updated_at
FROM instruments i
LEFT JOIN tracking_states t ON t.instrument_id=i.instrument_id
WHERE t.thesis_path IS NULL OR t.updated_at < ${sqlValue(cutoff)}
ORDER BY i.instrument_id;`, { json: true });
  const missingThreeFace = await sqlite(paths.dbFile, `
SELECT i.instrument_id, i.asset_type, i.symbol, t.radar_zone, t.retail_heat_score, t.news_catalyst_score, t.fundamental_score
FROM instruments i
LEFT JOIN tracking_states t ON t.instrument_id=i.instrument_id
WHERE t.radar_zone IN ('bright','dark','overheated')
  AND (t.retail_heat_score IS NULL OR t.news_catalyst_score IS NULL OR t.fundamental_score IS NULL)
ORDER BY i.instrument_id;`, { json: true });
  const pendingGates = await sqlite(paths.dbFile, `
SELECT gate_id, instrument_id, gate_type, status, summary, human_gate_required, created_at
FROM review_gates
WHERE status='pending' OR human_gate_required=1
ORDER BY created_at DESC;`, { json: true });
  const filePath = path.join(paths.indexDir, `cat_claw-audit-${dailyKey()}.md`);
  const content = `# Cat Claw Workflow Audit ${dailyKey()}

## Stale Thesis

${staleThesis.length ? staleThesis.map((row) => `- ${row.instrument_id} updated_at=${row.updated_at || "none"}`).join("\n") : "- none"}

## Missing Three-Face Inputs

${missingThreeFace.length ? missingThreeFace.map((row) => `- ${row.instrument_id} zone=${row.radar_zone} retail=${row.retail_heat_score} news=${row.news_catalyst_score} fundamental=${row.fundamental_score}`).join("\n") : "- none"}

## Pending Gates

${pendingGates.length ? pendingGates.map((row) => `- ${row.gate_id} ${row.instrument_id || ""} ${row.gate_type} status=${row.status} human_gate=${row.human_gate_required}`).join("\n") : "- none"}
`;
  await fs.writeFile(filePath, content, "utf8");
  return { auditFile: filePath, staleThesisCount: staleThesis.length, missingThreeFaceCount: missingThreeFace.length, pendingGateCount: pendingGates.length };
}

export async function runWorkflowAction(rootDir, input = {}) {
  const requestedAction = String(input.action || "workflow.status");
  const action = canonicalWorkflowAction(requestedAction);
  const permissionDecision = await authorizeWorkflowAction(rootDir, input);
  switch (action) {
    case "workflow.init":
    case "trading_workflow.init":
      return workflowInit(rootDir, input);
    case "workflow.status":
    case "trading_workflow.status":
      return workflowStatus(rootDir, input);
    case "workflow.health":
    case "workflow.dashboard": {
      const paths = await ensureWorkflowLayout(rootDir, input);
      return workflowHealthSnapshot(paths, input);
    }
    case "workflow.readiness":
    case "trading_workflow.readiness": {
      const paths = await ensureWorkflowLayout(rootDir, input);
      return workflowReadinessSnapshot(paths, input);
    }
    case "workflow.topology":
    case "trading_workflow.topology":
      return workflowTopology(rootDir, input);
    case "workflow.runtime_agents":
    case "workflow.runtime-agents":
    case "workflow.runtime.registry":
      return workflowRuntimeAgents(rootDir, input);
    case "workflow.permission.check":
    case "workflow.permission.explain":
      return workflowPermissionCheck(rootDir, input);
    case "workflow.run.upsert":
    case "workflow.initiative.upsert":
      return workflowRunUpsert(rootDir, input);
    case "workflow.swarm.plan":
    case "workflow.swarm":
      return workflowSwarmPlan(rootDir, input);
    case "workflow.task.draft":
    case "workflow.task.preview":
    case "workflow.task.create.preview":
    case "workflow.meeting_task.draft":
      return workflowTaskDraft(rootDir, input);
    case "workflow.task.launch.prepare":
    case "workflow.task.launch.draft":
    case "workflow.task.launch.submit":
      return workflowTaskLaunchPrepare(rootDir, input);
    case "workflow.task.launch.list":
      return workflowTaskLaunchList(rootDir, input);
    case "workflow.task.launch.review":
    case "workflow.task.launch.brain_review":
      return workflowTaskLaunchReview(rootDir, input);
    case "workflow.task.launch.approve":
      return workflowTaskLaunchApprove(rootDir, input);
    case "workflow.task.create":
      return workflowTaskCreate(rootDir, input);
    case "workflow.task.update":
      return workflowTaskUpdate(rootDir, input);
    case "workflow.task.list":
    case "workflow.tasks":
      return workflowTaskList(rootDir, input);
    case "workflow.advance":
      return workflowAdvance(rootDir, input);
    case "workflow.advance.preview":
    case "workflow.preview.advance":
      return workflowAdvancePreview(rootDir, input);
    case "workflow.supervise":
    case "workflow.supervisor":
      return workflowSupervisor(rootDir, input);
    case "workflow.supervise.preview":
    case "workflow.supervisor.preview":
    case "workflow.preview.supervise":
      return workflowSupervisorPreview(rootDir, input);
    case "workflow.pause":
    case "workflow.resume":
    case "workflow.stop":
    case "workflow.terminate":
      return workflowInterventionExecute(rootDir, input, permissionDecision);
    case "workflow.pause.preview":
    case "workflow.preview.pause":
    case "workflow.resume.preview":
    case "workflow.preview.resume":
    case "workflow.stop.preview":
    case "workflow.preview.stop":
    case "workflow.terminate.preview":
    case "workflow.preview.terminate":
    case "workflow.rerun.agent.preview":
    case "workflow.rerun_agent.preview":
    case "workflow.preview.rerun_agent":
    case "workflow.rerun.phase.preview":
    case "workflow.rerun_phase.preview":
    case "workflow.preview.rerun_phase":
      return workflowInterventionPreview(rootDir, input);
    case "workflow.incident.from_dead_letter.preview":
      return workflowIncidentFromDeadLetterPreview(rootDir, input);
    case "workflow.control_loop.job.requeue.preview":
      return workflowControlLoopJobRequeuePreview(rootDir, input);
    case "workflow.control_loop.job.requeue":
      return workflowControlLoopJobRequeue(rootDir, input, permissionDecision);
    case "workflow.incident.closeout.cat_claw_report.preview":
    case "workflow.incident.closeout.human_gate_package.preview":
      return workflowIncidentCloseoutPreview(rootDir, input);
    case "workflow.incident.closeout.artifact.preview":
      return workflowIncidentCloseoutArtifactPreview(rootDir, input);
    case "workflow.incident.closeout.human_gate_request.preview":
      return workflowIncidentCloseoutHumanGateRequestPreview(rootDir, input);
    case "workflow.control_loop.tick":
    case "workflow.loop.tick":
    case "workflow.reconciler.tick":
      return workflowControlLoopTick(rootDir, input);
    case "workflow.schedule.upsert":
    case "workflow.scheduler.upsert":
      return workflowScheduleUpsert(rootDir, input);
    case "workflow.schedule.list":
    case "workflow.schedules":
    case "workflow.scheduler.list":
      return workflowScheduleList(rootDir, input);
    case "workflow.schedule.pause":
    case "workflow.scheduler.pause":
      return workflowScheduleStatus(rootDir, input, "paused");
    case "workflow.schedule.resume":
    case "workflow.scheduler.resume":
      return workflowScheduleStatus(rootDir, input, "active");
    case "workflow.schedule.disable":
    case "workflow.scheduler.disable":
      return workflowScheduleStatus(rootDir, input, "disabled");
    case "workflow.checkpoint":
    case "workflow.context_checkpoint":
    case "context.checkpoint":
      return workflowCheckpoint(rootDir, input);
    case "workflow.event.append":
    case "workflow.events.append":
      return workflowEventAppend(rootDir, input);
    case "workflow.verification.record":
    case "workflow.verifier_refuter.record":
    case "workflow.verifier-refuter.record":
    case "verifier_refuter.record":
    case "verifier.refuter.record":
    case "workflow.evaluator.record":
    case "workflow.evaluation.record":
      return workflowVerificationRecord(rootDir, input, permissionDecision);
    case "workflow.verification.list":
      return workflowVerificationList(rootDir, input);
    case "workflow.evaluate":
    case "workflow.evaluator.run":
    case "workflow.evaluation.run":
    case "workflow.goal.evaluate":
      return workflowEvaluate(rootDir, input, permissionDecision);
    case "workflow.event.list":
    case "workflow.events":
    case "workflow.events.list":
      return workflowEventList(rootDir, input);
    case "workflow.event.timeline":
    case "workflow.timeline":
    case "workflow.events.timeline":
      return workflowEventTimeline(rootDir, input);
    case "workflow.session_pack.upsert":
    case "workflow.session.pack.upsert":
    case "session_pack.upsert":
      return workflowSessionPackUpsert(rootDir, input);
    case "workflow.session_pack.get":
    case "workflow.session.pack.get":
    case "session_pack.get":
      return workflowSessionPackGet(rootDir, input);
    case "workflow.session_pack.list":
    case "workflow.session.pack.list":
    case "session_pack.list":
      return workflowSessionPackList(rootDir, input);
    case "workflow.session_run.start":
    case "workflow.session.run.start":
    case "session_run.start":
      return workflowSessionRunStart(rootDir, input);
    case "workflow.session_run.complete":
    case "workflow.session.run.complete":
    case "session_run.complete":
      return workflowSessionRunComplete(rootDir, input);
    case "runtime.agent":
    case "runtime.agent.upsert":
      return runtimeAgentUpsert(rootDir, input);
    case "route_shell.ingest":
    case "route-shell.ingest":
    case "route_shell.route":
      return routeShellIngest(rootDir, input);
    case "meeting.runtime_participant":
    case "runtime.participant":
      return meetingRuntimeParticipant(rootDir, input);
    case "telegram.live":
    case "telegram.live.configure":
      return telegramLiveConfigure(rootDir, input);
    case "meeting.dispatch":
      return meetingDispatch(rootDir, input);
    case "meeting.ingest":
      return meetingIngest(rootDir, input);
    case "workflow.dispatch.reconcile":
    case "dispatch.reconcile":
    case "stale_dispatch.reconcile":
      return staleDispatchReconcile(rootDir, input);
    case "runtime.bridge":
    case "runtime.bridge.drain":
      return runtimeBridgeDrain(rootDir, input);
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
    case "human_gate.inbox":
    case "human_gate.console":
    case "human_gate.batch_inbox":
      return humanGateInbox(rootDir, input);
    case "human_gate.resume":
    case "human_gate.confirm":
      return humanGateResume(rootDir, input);
    case "meeting.resume":
      return meetingResume(rootDir, input);
    case "meeting.disperse":
      return meetingDisperse(rootDir, input);
    case "telegram.outbox.delivery.preview":
      return telegramOutboxDeliveryPreview(rootDir, input);
    case "telegram.outbox.requeue.preview":
      return telegramOutboxRequeuePreview(rootDir, input);
    case "telegram.outbox.requeue.execution_package.preview":
      return telegramOutboxRequeueExecutionPackagePreview(rootDir, input);
    case "telegram.outbox.delivery":
      return telegramOutboxDelivery(rootDir, input);
    case "telegram.outbox":
      return telegramOutbox(rootDir, input);
    case "message_flow.send":
    case "workflow.message_flow.send":
      return messageFlowSend(rootDir, input);
    case "message_flow.list":
    case "message_flow.status":
    case "workflow.message_flow.list":
    case "workflow.message_flow.status":
      return messageFlowList(rootDir, input);
    case "message_flow.reconcile":
    case "workflow.message_flow.reconcile":
      return messageFlowReconcile(rootDir, input);
    case "protocol.record":
    case "protocol.object":
      return protocolRecord(rootDir, input);
    case "trade.proposal":
      return tradeProposal(rootDir, input);
    case "risk.decision":
      return riskDecision(rootDir, input);
    case "human_gate.record":
    case "workflow.human_gate":
      return workflowHumanGateRecord(rootDir, input);
    case "trade.intent":
    case "execution.intent":
      return tradeIntent(rootDir, input);
    case "trading_core.receipt":
    case "execution.receipt":
      return tradingCoreReceipt(rootDir, input);
    case "side_effect.record":
    case "side_effect.ledger":
      return sideEffectRecord(rootDir, input);
    case "incident.state":
    case "workflow.incident":
      return incidentState(rootDir, input);
    case "workflow.incident.from_dead_letter":
      return workflowIncidentFromDeadLetter(rootDir, input, permissionDecision);
    case "workflow.incident.closeout.artifact":
      return workflowIncidentCloseoutArtifact(rootDir, input, permissionDecision);
    case "workflow.incident.closeout.human_gate_request":
      return workflowIncidentCloseoutHumanGateRequest(rootDir, input, permissionDecision);
    case "instrument.upsert":
    case "tracking.instrument":
      return instrumentUpsert(rootDir, input);
    case "radar.update":
      return radarUpdate(rootDir, input);
    case "thesis.update":
    case "thesis.create":
      return thesisUpdate(rootDir, input);
    case "research.evidence":
      return researchEvidence(rootDir, input);
    case "research.memo":
      return researchMemo(rootDir, input);
    case "gate.review":
    case "human_gate.review":
      return gateReview(rootDir, input);
    case "cat_claw.audit":
      return cat_clawAudit(rootDir, input);
    default:
      throw new Error(`unknown workflow action: ${requestedAction}${requestedAction === action ? "" : ` (canonical: ${action})`}`);
  }
}
