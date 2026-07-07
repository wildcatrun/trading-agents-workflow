import {
  boolOption,
  firstText,
  parseJsonValue,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite,
  tableColumns
} from "./workflow/sqlite.js";

export const PERMISSION_ACTION_HANDLER_NAMES = {
  "workflow.permission.check": "workflowPermissionCheck",
  "workflow.permission.explain": "workflowPermissionCheck"
};

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
  "workflow.runtime_event.list",
  "workflow.runtime_current_state",
  "workflow.verification.list",
  "workflow.session_pack.get",
  "workflow.session_pack.list",
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
  "workflow.v2.worker_adapter_job.list",
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
  "workflow.template.extract.preview",
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
  "workflow.incident.closeout.worklist.preview",
  "workflow.incident.closeout.worklist.artifact.preview",
  "workflow.incident.closeout.evidence.preview",
  "workflow.incident.closeout.artifact.preview",
  "workflow.incident.closeout.human_gate_request.preview",
  "telegram.outbox.delivery.preview",
  "telegram.outbox.requeue.preview",
  "telegram.outbox.requeue.execution_package.preview",
  "workflow.rerun.agent.preview",
  "workflow.rerun.phase.preview"
]);

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
  "workflow.v2.adapter_runner.drain": { capability: "workflow.worker.adapter_runner", risk: "medium", mutating: true },
  "workflow.v2.worker_result.submit": { capability: "workflow.worker.result", risk: "medium", mutating: true },
  "workflow.v2.worker_result.fail": { capability: "workflow.worker.result", risk: "medium", mutating: true },
  "workflow.v2.manager_review.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.owner_review.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.task_group_package.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.cat_brain_audit.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.v2.cat_claw_audit.record": { capability: "cat_claw.audit", risk: "medium", mutating: true },
  "workflow.v2.human_gate_package.record": { capability: "human_gate.write", risk: "high", mutating: true },
  "workflow.v2.human_gate_request": { capability: "human_gate.write", risk: "high", mutating: true },
  "workflow.template.record_candidate": { capability: "workflow.write", risk: "medium", mutating: true },
  "workflow.template.instantiate.record": { capability: "workflow.write", risk: "medium", mutating: true },
  "workflow.template.eval.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.template.extract.record": { capability: "workflow.verify", risk: "medium", mutating: true },
  "workflow.template.promote.record": { capability: "workflow.template.promote", risk: "high", mutating: true },
  "workflow.template.rollback.record": { capability: "workflow.template.promote", risk: "high", mutating: true },
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
  "workflow.incident.closeout.evidence",
  "workflow.incident.closeout.artifact",
  "workflow.incident.closeout.human_gate_request",
  "workflow.template.promote.record",
  "workflow.template.rollback.record",
  "telegram.outbox.delivery"
]);

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`permission action dependency missing: ${name}`);
  return value;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasAllColumns(columns, names = []) {
  return names.every((name) => columns.has(name));
}

function workflowCapabilitySetFromList(value, set = new Set()) {
  for (const item of toList(value)) set.add(item);
  return set;
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

export function createPermissionCore(context = {}) {
  const canonicalWorkflowAction = requireContextFunction(context, "canonicalWorkflowAction");
  const normalizeOptionalAgentId = requireContextFunction(context, "normalizeOptionalAgentId");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");

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

  function isWorkflowPolicyHardGateAction(action) {
    return WORKFLOW_POLICY_HARD_GATE_ACTIONS.has(canonicalWorkflowAction(action));
  }

  return {
    evaluateWorkflowPermission,
    isWorkflowPolicyHardGateAction,
    isWorkflowTrustedOperator,
    permissionEvidencePresent,
    workflowPermissionCaller
  };
}

export function createPermissionActionRegistry(handlers = {}) {
  const entries = Object.entries(PERMISSION_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing permission action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runPermissionAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createPermissionActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const evaluateWorkflowPermission = requireContextFunction(context, "evaluateWorkflowPermission");

  async function workflowPermissionCheck(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const decision = await evaluateWorkflowPermission(paths, input);
    return { ...decision, dbFile: paths.dbFile };
  }

  return {
    workflowPermissionCheck
  };
}
