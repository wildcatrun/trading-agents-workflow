import {
  firstText
} from "./json.js";

export const DEFAULT_WORKFLOW_GOVERNANCE_ROLES = Object.freeze({
  catBrain: Object.freeze({
    role: "catBrain",
    agentId: "main",
    runtime: "openclaw",
    description: "structural governance auditor / incident commander"
  }),
  catClaw: Object.freeze({
    role: "catClaw",
    agentId: "cat_claw",
    runtime: "openclaw",
    deliveryAccount: "cat_claw",
    description: "secretary auditor / Human Gate package reporter"
  })
});

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function normalizeRoleBinding(value = {}, fallback = {}) {
  const raw = objectValue(value);
  const agentId = firstText(raw.agentId, raw.agent_id, raw.agent, raw.id, raw.name, fallback.agentId);
  const runtime = firstText(raw.runtime, raw.platform, raw.backend, fallback.runtime);
  const deliveryAccount = firstText(raw.deliveryAccount, raw.delivery_account, raw.account, fallback.deliveryAccount);
  return {
    ...fallback,
    ...raw,
    role: fallback.role || raw.role || "",
    agentId,
    runtime,
    ...(deliveryAccount ? { deliveryAccount } : {})
  };
}

function roleObject(input = {}) {
  return firstObject(
    input.governanceRoles,
    input.governance_roles,
    input.roleBindings,
    input.role_bindings
  );
}

export function workflowGovernanceRoles(input = {}) {
  const roles = roleObject(input);
  const catBrainRaw = firstObject(
    roles.catBrain,
    roles.cat_brain,
    roles.governanceLead,
    roles.governance_lead,
    roles.governanceAuditor,
    roles.governance_auditor
  );
  const catClawRaw = firstObject(
    roles.catClaw,
    roles.cat_claw,
    roles.secretary,
    roles.secretaryAuditor,
    roles.secretary_auditor,
    roles.humanGateReporter,
    roles.human_gate_reporter
  );
  const catBrain = normalizeRoleBinding({
    ...catBrainRaw,
    agentId: firstText(input.catBrainAgent, input.cat_brain_agent, input.governanceAgent, input.governance_agent, catBrainRaw.agentId, catBrainRaw.agent_id),
    runtime: firstText(input.catBrainRuntime, input.cat_brain_runtime, input.governanceRuntime, input.governance_runtime, catBrainRaw.runtime)
  }, DEFAULT_WORKFLOW_GOVERNANCE_ROLES.catBrain);
  const catClaw = normalizeRoleBinding({
    ...catClawRaw,
    agentId: firstText(input.catClawAgent, input.cat_claw_agent, input.secretaryAgent, input.secretary_agent, input.reportAgent, input.report_agent, catClawRaw.agentId, catClawRaw.agent_id),
    runtime: firstText(input.catClawRuntime, input.cat_claw_runtime, input.secretaryRuntime, input.secretary_runtime, input.reportRuntime, input.report_runtime, catClawRaw.runtime),
    deliveryAccount: firstText(input.deliveryAccount, input.delivery_account, input.account, catClawRaw.deliveryAccount, catClawRaw.delivery_account)
  }, DEFAULT_WORKFLOW_GOVERNANCE_ROLES.catClaw);
  return { catBrain, catClaw };
}

export function workflowGovernanceRole(input = {}, roleName = "catBrain") {
  const roles = workflowGovernanceRoles(input);
  return roleName === "catClaw" || roleName === "cat_claw" || roleName === "secretary"
    ? roles.catClaw
    : roles.catBrain;
}
