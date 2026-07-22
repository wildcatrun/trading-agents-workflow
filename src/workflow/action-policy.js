import {
  strictBoolOption
} from "./json.js";

export const WORKFLOW_LEGACY_MUTATING_ACTIONS = new Set([
  "workflow.advance",
  "workflow.supervise"
]);

export const WORKFLOW_LEGACY_COMPATIBILITY_RETIREMENT = Object.freeze({
  policy: "frozen_short_term_compatibility",
  frozenSinceRelease: "v0.8.2-rc.1",
  defaultHiddenSinceRelease: "v0.8.2-rc.1",
  removalTargetRelease: "v1.0.0",
  escapeHatchEnv: "TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS",
  recommendation: "do not extend; keep only as a gated compatibility escape hatch until removal"
});

const WORKFLOW_ACTION_MIGRATION_EXACT = new Map([
  ["workflow.checkpoint", {
    decisionClass: "compat_shell_only",
    migrationStatus: "frozen_writer_diagnostic",
    replacement: "workflow.supervisor.checkpoint + workflow.archive.checkpoint + workflow.checkpoint.legacy_export",
    recommendation: "mutating writer is frozen; use v2/shared checkpoint writers or read-only legacy export"
  }],
  ["workflow.checkpoint.legacy_alias", {
    decisionClass: "compat_shell_only",
    migrationStatus: "frozen_alias_diagnostic",
    replacement: "workflow-checkpoint --source-class v2_plan_checkpoint | human_gate_archive_checkpoint | legacy_compat_checkpoint (read-only legacy_export)",
    recommendation: "do not write through ambiguous context checkpoint aliases; choose an explicit source class"
  }],
  ["workflow.checkpoint.legacy_export", {
    decisionClass: "compat_shell_only",
    migrationStatus: "legacy_read_only_export",
    replacement: "workflow.supervisor.checkpoint + workflow.archive.checkpoint",
    recommendation: "use only to inspect old workflow_runs/workflow_tasks recovery state without writing checkpoint rows"
  }],
  ["workflow.task.draft", {
    decisionClass: "compat_shell_only",
    migrationStatus: "legacy_active",
    replacement: "workflow.v2.plan.preview",
    recommendation: "use v2 plan preview/create or template instantiate for new authoring"
  }],
  ["workflow.task.list", {
    decisionClass: "compat_shell_only",
    migrationStatus: "legacy_active",
    recommendation: "keep for legacy history/read compatibility"
  }],
  ["workflow.tasks", {
    decisionClass: "compat_shell_only",
    migrationStatus: "legacy_active",
    replacement: "workflow.task.list",
    recommendation: "canonicalize legacy task list reads before retirement"
  }],
  ["workflow.advance", {
    decisionClass: "compat_shell_only",
    migrationStatus: "frozen_compatibility",
    replacement: "workflow.supervisor.readiness.preview + workflow.supervisor.next_actions.preview + workflow.dispatch.reconcile + workflow.control_loop.tick shared maintenance lanes",
    recommendation: "default-disabled compatibility executor only; do not use for new workflow progression, and remove after the legacy action escape hatch window closes"
  }],
  ["workflow.advance.preview", {
    decisionClass: "compat_shell_only",
    migrationStatus: "read_surface_migrated",
    replacement: "workflow.supervisor.readiness.preview",
    recommendation: "compatibility diagnostic only for legacy task/run history; use semantic supervisor readiness for new read surfaces"
  }],
  ["workflow.supervise", {
    decisionClass: "compat_shell_only",
    migrationStatus: "frozen_compatibility",
    replacement: "workflow.supervisor.readiness.preview + workflow.supervisor.next_actions.preview + workflow.supervisor.closeout + workflow.supervisor.report + workflow.control_loop.tick shared maintenance lanes",
    recommendation: "default-disabled compatibility executor only; do not use for new workflow supervision, and remove after the legacy action escape hatch window closes"
  }],
  ["workflow.supervise.preview", {
    decisionClass: "compat_shell_only",
    migrationStatus: "read_surface_migrated",
    replacement: "workflow.supervisor.next_actions.preview",
    recommendation: "compatibility diagnostic only for legacy workflow_tasks/workflow_runs cards; use semantic supervisor next-actions for evidence-gap and v2 readiness planning"
  }],
  ["workflow.evaluate", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "workflow.v2.evaluation_snapshot.preview + workflow.v2.validate",
    recommendation: "use v2 evaluation snapshot for read-only evidence decisions and workflow.v2.validate for consistency checks; keep legacy evaluator writes only during compatibility window"
  }],
  ["workflow.pause", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "v2 plan/node/worker pause state transition",
    recommendation: "map pause semantics onto v2 plans, nodes, workers, adapter jobs, Human Gate waits, and side-effect uncertainty"
  }],
  ["workflow.resume", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "v2 plan/node/worker resume state transition",
    recommendation: "map resume semantics onto v2 plans, nodes, workers, adapter jobs, Human Gate waits, and side-effect uncertainty"
  }],
  ["workflow.stop", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "v2 plan/node/worker stop state transition",
    recommendation: "map stop semantics onto v2 plans, nodes, workers, adapter jobs, Human Gate waits, and side-effect uncertainty"
  }],
  ["meeting.dispatch", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "dispatch.package.preview + dispatch.package.create",
    recommendation: "use canonical generic dispatch package actions for new callers; keep meeting.dispatch as a compatibility shim during the observation window"
  }],
  ["meeting.resume", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "keep until meeting template/runtime-adapter requirements are explicit"
  }],
  ["meeting.disperse", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "keep until meeting template/runtime-adapter requirements are explicit"
  }],
  ["meeting.runtime_participant", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "keep until meeting template/runtime-adapter requirements are explicit"
  }]
]);

const WORKFLOW_ACTION_MIGRATION_PREFIXES = [
  ["workflow.schedule.", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "approved template or Human-Gate-approved v2 plan schedule",
    recommendation: "bind production schedules to approved templates or approved v2 plans"
  }],
  ["workflow.control_loop.", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "workflow.v2.adapter_runner service and shared maintenance",
    recommendation: "separate shared maintenance from legacy orchestration usage"
  }],
  ["runtime.bridge.", {
    decisionClass: "must_migrate",
    migrationStatus: "legacy_active",
    replacement: "workflow.v2.adapter_runner.drain",
    recommendation: "replace active worker execution only after live wrapper evidence"
  }],
  ["workflow.verification.", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "keep as shared/domain evidence until concrete v2 review templates absorb it"
  }],
  ["research.", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "migrate only under a concrete research workflow template plan"
  }],
  ["instrument.", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "migrate only under a concrete research workflow template plan"
  }],
  ["radar.", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "migrate only under a concrete research workflow template plan"
  }],
  ["thesis.", {
    decisionClass: "optional_or_template_later",
    migrationStatus: "legacy_active",
    recommendation: "migrate only under a concrete research workflow template plan"
  }]
];

export function workflowActionMigrationInfo(action) {
  const canonical = String(action || "").trim();
  if (!canonical) return null;
  const exact = WORKFLOW_ACTION_MIGRATION_EXACT.get(canonical);
  if (exact) return { action: canonical, ...exact };
  for (const [prefix, metadata] of WORKFLOW_ACTION_MIGRATION_PREFIXES) {
    if (canonical.startsWith(prefix)) return { action: canonical, ...metadata };
  }
  return null;
}

export const WORKFLOW_GENERIC_ORCHESTRATION_PLAN_ENTRY_ACTIONS = new Set([
  "workflow.v2.worker_spawn.create",
  "workflow.v2.worker_handoff.record",
  "workflow.v2.worker_retire.record",
  "workflow.v2.worker_successor.create",
  "workflow.v2.worker_adapter_job.record",
  "workflow.v2.worker_adapter_job.claim",
  "workflow.v2.worker_adapter_job.heartbeat",
  "workflow.v2.worker_adapter_job.release",
  "workflow.v2.worker_adapter_job.fail"
]);

export const WORKFLOW_GENERIC_ORCHESTRATION_WRITE_ACTIONS = new Set([
  ...WORKFLOW_GENERIC_ORCHESTRATION_PLAN_ENTRY_ACTIONS,
  "workflow.v2.control_loop.tick",
  "workflow.v2.adapter_runner.drain",
  "workflow.v2.worker_result.submit",
  "workflow.v2.worker_result.fail"
]);

export const WORKFLOW_CONSOLE_GENERIC_ORCHESTRATION_WRITE_ACTIONS = new Set(WORKFLOW_GENERIC_ORCHESTRATION_WRITE_ACTIONS);

export const WORKFLOW_CONSOLE_DEFAULT_ALLOWED_ACTIONS = new Set([
  "workflow.advance.preview",
  "workflow.supervise.preview",
  "workflow.pause.preview",
  "workflow.resume.preview",
  "workflow.stop.preview",
  "workflow.incident.from_dead_letter.preview",
  "workflow.control_loop.lanes.preview",
  "workflow.control_loop.job.requeue.preview",
  "dispatch.package.callsites.preview",
  "dispatch.package.parity.preview",
  "dispatch.package.schema.preview",
  "dispatch.package.topology.preview",
  "workflow.incident.closeout.cat_claw_report.preview",
  "workflow.incident.closeout.human_gate_package.preview",
  "workflow.incident.closeout.worklist.preview",
  "workflow.incident.closeout.worklist.artifact.preview",
  "workflow.incident.closeout.evidence.preview",
  "workflow.incident.closeout.artifact.preview",
  "workflow.incident.closeout.human_gate_request.preview",
  "telegram.outbox.delivery.preview",
  "telegram.outbox.requeue.preview",
  "telegram.outbox.requeue.execution_package.preview",
  "workflow.rerun.agent.preview",
  "workflow.rerun.phase.preview",
  "workflow.v2.plan.preview",
  "workflow.supervisor.readiness.preview",
  "workflow.v2.readiness.preview",
  "workflow.supervisor.next_actions.preview",
  "workflow.archive.checkpoint.preview",
  "workflow.supervisor.checkpoint.preview",
  "workflow.supervisor.closeout.preview",
  "workflow.supervisor.report.preview",
  "workflow.v2.next_actions.preview",
  "workflow.v2.info_stack.preview",
  "workflow.v2.info_stack.read",
  "workflow.v2.notification.preview",
  "workflow.v2.worker_backend.preflight",
  "workflow.v2.worker_spawn.preview",
  "workflow.v2.owner_review.preview",
  "workflow.v2.task_group_package.preview",
  "workflow.v2.cat_brain_audit.preview",
  "workflow.v2.cat_brain_semantic_check.preview",
  "workflow.v2.cat_claw_audit.preview",
  "workflow.v2.cat_claw_package_audit.preview",
  "workflow.v2.human_gate_package.preview",
  "workflow.v2.human_gate_request.preview",
  "workflow.v2.intervention_readiness.preview",
  "workflow.v2.intervention.readiness.preview",
  "workflow.v2.pause.preview",
  "workflow.v2.resume.preview",
  "workflow.v2.stop.preview",
  "workflow.v2.terminate.preview",
  "workflow.v2.evaluation_snapshot.preview",
  "workflow.v2.evaluation_compatibility.preview",
  "workflow.v2.evaluation_migration.preview",
  "workflow.v2.control_loop.preview",
  "workflow.v2.worker_lifecycle.preview",
  "workflow.v2.worker_handoff.preview",
  "workflow.v2.worker_retire.preview",
  "workflow.v2.worker_successor.preview",
  "workflow.v2.worker_adapter_job.preview",
  "workflow.v2.worker_adapter_job.list",
  "workflow.v2.adapter_runner.preview",
  "workflow.v2.adapter_runner.wrapper_contract.preview",
  "workflow.v2.adapter_runner.service_plan.preview",
  "workflow.v2.adapter_runner.drain_readiness.preview",
  "workflow.v2.worker_result.submit.preview",
  "workflow.v2.worker_result.fail.preview",
  "workflow.v2.validate",
  "workflow.template.daily_trading_catalog.preview"
]);

export const WORKFLOW_CONSOLE_OPTIONAL_WRITE_ACTIONS = new Set([
  "workflow.pause",
  "workflow.resume",
  "workflow.stop",
  "workflow.incident.from_dead_letter",
  "workflow.control_loop.job.requeue",
  "workflow.incident.closeout.worklist.artifact",
  "workflow.incident.closeout.evidence",
  "workflow.incident.closeout.artifact",
  "workflow.incident.closeout.human_gate_request",
  "workflow.v2.plan.create",
  "workflow.v2.info_stack.record",
  "workflow.v2.read_receipt.record",
  "workflow.v2.worker_backend_preflight.record",
  "workflow.v2.manager_review.record",
  "workflow.v2.owner_review.record",
  "workflow.v2.task_group_package.record",
  "workflow.v2.cat_brain_audit.record",
  "workflow.v2.cat_claw_audit.record",
  "workflow.v2.human_gate_package.record",
  "workflow.v2.human_gate_request",
  "workflow.v2.pause",
  "workflow.v2.resume",
  "workflow.v2.stop",
  "workflow.v2.terminate",
  "workflow.archive.checkpoint",
  "workflow.supervisor.checkpoint",
  "workflow.supervisor.closeout",
  "workflow.supervisor.report",
  "telegram.outbox.delivery",
  "human_gate.inbox",
  "human_gate.console"
]);

export const WORKFLOW_CONSOLE_READ_ONLY_ACTIONS = new Set(WORKFLOW_CONSOLE_DEFAULT_ALLOWED_ACTIONS);

export function workflowConsoleAllowedActions({ allowWrites = false } = {}) {
  const actions = new Set(WORKFLOW_CONSOLE_DEFAULT_ALLOWED_ACTIONS);
  if (allowWrites) {
    for (const action of WORKFLOW_CONSOLE_OPTIONAL_WRITE_ACTIONS) actions.add(action);
    for (const action of WORKFLOW_CONSOLE_GENERIC_ORCHESTRATION_WRITE_ACTIONS) actions.add(action);
  }
  return actions;
}

export const WORKFLOW_PERMISSION_READ_ACTIONS = new Set([
  ...WORKFLOW_CONSOLE_DEFAULT_ALLOWED_ACTIONS,
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
  "workflow.runtime_event.list",
  "workflow.runtime_current_state",
  "workflow.verification.list",
  "workflow.session_pack.get",
  "workflow.session_pack.list",
  "workflow.checkpoint",
  "workflow.checkpoint.legacy_alias",
  "workflow.checkpoint.legacy_export",
  "workflow.template.preview",
  "workflow.template.daily_trading_catalog.preview",
  "workflow.template.search",
  "workflow.template.get",
  "workflow.template.instantiate.preview",
  "workflow.template.eval.preview",
  "workflow.template.stats.refresh",
  "workflow.template.promote.preview",
  "workflow.template.rollback.preview",
  "workflow.template.extract.preview",
  "workflow.schedule.list",
  "workflow.maintenance.lanes.preview",
  "workflow.scheduler.lanes.preview",
  "dispatch.package.callsites.preview",
  "dispatch.package.parity.preview",
  "dispatch.package.schema.preview",
  "dispatch.package.topology.preview",
  "dispatch.package.preview",
  "human_gate.web_app_review",
  "human_gate.inbox",
  "message_flow.list",
  "workflow.permission.check"
]);

export const WORKFLOW_ACTION_PERMISSION_RULES = {
  "workflow.init": { capability: "workflow.init", risk: "medium", mutating: true },
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
  "workflow.event.append": { capability: "workflow.event.write", risk: "medium", mutating: true },
  "workflow.runtime_event.record": { capability: "workflow.event.write", risk: "medium", mutating: true },
  "workflow.verification.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.evaluate": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.session_pack.upsert": { capability: "session.write", risk: "medium", mutating: true },
  "workflow.session_run.start": { capability: "session.run", risk: "medium", mutating: true },
  "workflow.session_run.complete": { capability: "session.run", risk: "medium", mutating: true },
  "workflow.v2.plan.create": { capability: "workflow.write", risk: "medium", mutating: true },
  "workflow.v2.info_stack.record": { capability: "workflow.info_stack.write", risk: "medium", mutating: true },
  "workflow.v2.read_receipt.record": { capability: "workflow.info_stack.read_receipt", risk: "low", mutating: true },
  "workflow.v2.worker_backend_preflight.record": { capability: "workflow.worker.preflight", risk: "medium", mutating: true },
  "workflow.v2.worker_spawn.create": { capability: "workflow.worker.spawn", risk: "medium", mutating: true },
  "workflow.v2.worker_lifecycle.preview": { capability: "workflow.worker.lifecycle", risk: "low", mutating: false },
  "workflow.v2.worker_handoff.record": { capability: "workflow.worker.lifecycle", risk: "medium", mutating: true },
  "workflow.v2.worker_retire.record": { capability: "workflow.worker.lifecycle", risk: "medium", mutating: true },
  "workflow.v2.worker_successor.create": { capability: "workflow.worker.lifecycle", risk: "medium", mutating: true },
  "workflow.v2.control_loop.tick": { capability: "workflow.worker.control_loop", risk: "medium", mutating: true },
  "workflow.v2.worker_adapter_job.record": { capability: "workflow.worker.adapter_job", risk: "medium", mutating: true },
  "workflow.v2.worker_adapter_job.claim": { capability: "workflow.worker.adapter_job", risk: "medium", mutating: true },
  "workflow.v2.worker_adapter_job.heartbeat": { capability: "workflow.worker.adapter_job", risk: "medium", mutating: true },
  "workflow.v2.worker_adapter_job.release": { capability: "workflow.worker.adapter_job", risk: "medium", mutating: true },
  "workflow.v2.worker_adapter_job.fail": { capability: "workflow.worker.adapter_job", risk: "medium", mutating: true },
  "workflow.v2.adapter_runner.drain": { capability: "workflow.worker.adapter_runner", risk: "high", mutating: true },
  "workflow.v2.worker_result.submit": { capability: "workflow.worker.result", risk: "medium", mutating: true },
  "workflow.v2.worker_result.fail": { capability: "workflow.worker.result", risk: "medium", mutating: true },
  "workflow.v2.manager_review.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.owner_review.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.task_group_package.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.cat_brain_audit.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.cat_claw_audit.record": { capability: "cat_claw.audit", risk: "medium", mutating: true },
  "workflow.v2.human_gate_package.record": { capability: "human_gate.write", risk: "high", mutating: true },
  "workflow.v2.human_gate_request": { capability: "human_gate.write", risk: "high", mutating: true },
  "workflow.v2.pause": { capability: "workflow.operate", risk: "high", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.v2.resume": { capability: "workflow.operate", risk: "high", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.v2.stop": { capability: "workflow.operate", risk: "high", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.v2.terminate": { capability: "workflow.operate", risk: "high", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
  "workflow.archive.checkpoint": { capability: "workflow.checkpoint", risk: "medium", mutating: true },
  "workflow.supervisor.checkpoint": { capability: "workflow.checkpoint", risk: "medium", mutating: true },
  "workflow.supervisor.closeout": { capability: "dispatch.write", risk: "high", mutating: true },
  "workflow.supervisor.report": { capability: "dispatch.write", risk: "high", mutating: true },
  "workflow.template.record_candidate": { capability: "workflow.write", risk: "medium", mutating: true },
  "workflow.template.instantiate.record": { capability: "workflow.write", risk: "medium", mutating: true },
  "workflow.template.eval.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.template.extract.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.template.promote.record": { capability: "workflow.template.promote", risk: "high", mutating: true },
  "workflow.template.rollback.record": { capability: "workflow.template.promote", risk: "high", mutating: true },
  "runtime.agent.upsert": { capability: "registry.write", risk: "high", mutating: true, requiresCatClawAudit: true },
  "meeting.runtime_participant": { capability: "dispatch.write", risk: "medium", mutating: true },
  "telegram.live": { capability: "telegram.configure", risk: "high", mutating: true, requiresCatClawAudit: true },
  "dispatch.package.create": { capability: "dispatch.write", risk: "high", mutating: true },
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
  "workflow.incident.closeout.worklist.artifact": { capability: "incident.write", risk: "medium", mutating: true },
  "workflow.incident.closeout.evidence": { capability: "incident.write", risk: "medium", mutating: true, requiresHumanGateEvidence: true, requiresCatClawAudit: true },
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

export const WORKFLOW_PERMISSION_KNOWN_ACTIONS = new Set([
  ...WORKFLOW_PERMISSION_READ_ACTIONS,
  ...Object.keys(WORKFLOW_ACTION_PERMISSION_RULES)
]);

export const WORKFLOW_REGISTRY_WRITE_ACTIONS = new Set([
  "runtime.agent.upsert"
]);

export const WORKFLOW_POLICY_HARD_GATE_ACTIONS = new Set([
  "risk.decision",
  "trade.intent",
  "trading_core.receipt",
  "workflow.pause",
  "workflow.resume",
  "workflow.stop",
  "workflow.v2.pause",
  "workflow.v2.resume",
  "workflow.v2.stop",
  "workflow.v2.terminate",
  "workflow.incident.from_dead_letter",
  "workflow.incident.closeout.evidence",
  "workflow.incident.closeout.artifact",
  "workflow.incident.closeout.human_gate_request",
  "workflow.template.promote.record",
  "workflow.template.rollback.record",
  "telegram.outbox.delivery"
]);


export function workflowActionFlagEnabled(value) {
  return strictBoolOption(value, false);
}

export function workflowActionEnvEnabled(name) {
  return workflowActionFlagEnabled(process.env[name]);
}

export function workflowActionOverrideEnabled(input, envName, ...fieldNames) {
  if (workflowActionEnvEnabled(envName)) return true;
  return fieldNames.some((name) => workflowActionFlagEnabled(input?.[name]));
}

export const WORKFLOW_INTERNAL_LEGACY_COMPATIBILITY_TOKEN = Symbol("workflow.internalLegacyCompatibility");

export function workflowLegacyActionOverrideEnabled(input = {}, action = "") {
  if (workflowActionEnvEnabled("TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS")) return true;
  const marker = input?.[WORKFLOW_INTERNAL_LEGACY_COMPATIBILITY_TOKEN];
  if (!marker || typeof marker !== "object") return false;
  const source = String(marker.source || "").trim();
  const allowedActions = Array.isArray(marker.actions) ? marker.actions.map((item) => String(item).trim()) : [];
  return source === "meeting.action_item" && allowedActions.includes(action);
}

export function workflowActionBlockedResult(action, requestedAction, reason, message, enableEnv) {
  return {
    schemaVersion: "workflow_convergence_gate_result.v1",
    action,
    requestedAction,
    status: "blocked",
    allowed: false,
    productionSafe: false,
    mutating: true,
    reason,
    message,
    enableEnv
  };
}
