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
import {
  WORKFLOW_ACTION_PERMISSION_RULES,
  WORKFLOW_PERMISSION_READ_ACTIONS,
  WORKFLOW_POLICY_HARD_GATE_ACTIONS,
  WORKFLOW_REGISTRY_WRITE_ACTIONS
} from "./workflow/action-policy.js";

export const PERMISSION_ACTION_HANDLER_NAMES = {
  "workflow.permission.check": "workflowPermissionCheck",
  "workflow.permission.explain": "workflowPermissionCheck"
};

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
        "workflow.checkpoint"
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
