import { createHash } from "node:crypto";
import {
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2ValidationAdvisory,
  workflowV2ValidationError
} from "./helpers.js";
import {
  boolOption
} from "../workflow/json.js";

export const WORKFLOW_TEMPLATE_SCHEMA_VERSION = "workflow_template_spec.v1";
export const WORKFLOW_TEMPLATE_STATUSES = new Set([
  "candidate",
  "shadow",
  "active",
  "default",
  "frozen",
  "retired",
  "rolled_back"
]);
export const WORKFLOW_TEMPLATE_FAMILY_STATUSES = new Set(["active", "frozen", "retired"]);
export const WORKFLOW_TEMPLATE_RISK_TIERS = new Set(["low", "medium", "high", "critical", "P0", "P1", "P2", "P3"]);
export const WORKFLOW_TEMPLATE_PROMOTION_TARGETS = new Set(["shadow", "active", "default", "frozen", "retired"]);
export const WORKFLOW_TEMPLATE_EVAL_ARM_KINDS = new Set(["baseline", "previous_version", "candidate_version"]);

const HIGH_RISK_TEXT = /\b(P0|P1|trading|trade|production|prod|secret|credential|deploy|deployment|release|gateway|oauth|database|migration|schema migration|live side[- ]?effect|live trading|real[- ]?trade)\b|实盘|真实交易|生产|部署|发布|网关|数据库|密钥|凭据|迁移/i;
const SENSITIVE_KEY = /(^|[_-])(token|secret|password|credential|api[_-]?key|access[_-]?key|refresh|private[_-]?key|callback[_-]?token)($|[_-])/i;

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

function cleanTemplateId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

function uniqueTextList(value) {
  return [...new Set(workflowV2JsonArray(value, []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeRiskTier(value, fallback = "medium") {
  const raw = String(value || fallback || "").trim();
  const normalized = raw.toUpperCase() === "P0" || raw.toUpperCase() === "P1"
    ? raw.toUpperCase()
    : raw.toLowerCase();
  return WORKFLOW_TEMPLATE_RISK_TIERS.has(normalized) ? normalized : fallback;
}

function normalizeTemplateStatus(value, fallback = "candidate") {
  const normalized = String(value || fallback || "").trim().toLowerCase().replace(/-/g, "_");
  return WORKFLOW_TEMPLATE_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeVariable(variable = {}) {
  const item = workflowV2JsonObject(variable, {});
  const name = String(item.name || item.key || "").trim();
  return {
    name,
    type: String(item.type || "string").trim().toLowerCase(),
    required: boolOption(item.required, false),
    default: item.default,
    description: String(item.description || "").trim(),
    allowedValues: uniqueTextList(item.allowedValues || item.allowed_values),
    sensitive: boolOption(item.sensitive, SENSITIVE_KEY.test(name))
  };
}

function normalizeTriggerBlock(value = {}) {
  const block = workflowV2JsonObject(value, {});
  return {
    shouldUse: uniqueTextList(block.shouldUse || block.should_use),
    shouldNotUse: uniqueTextList(block.shouldNotUse || block.should_not_use),
    requiredSignals: uniqueTextList(block.requiredSignals || block.required_signals),
    forbiddenSignals: uniqueTextList(block.forbiddenSignals || block.forbidden_signals)
  };
}

function normalizePolicyObject(value = {}) {
  return workflowV2JsonObject(value, {});
}

export function workflowTemplateJsonHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function workflowTemplateRedact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/tawhg:[A-Za-z0-9._=-]+/g, "tawhg:<redacted>")
      .replace(/(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]");
  }
  if (typeof value !== "object") return value;
  if (depth > 8) return "[nested redacted]";
  if (Array.isArray(value)) return value.map((item) => workflowTemplateRedact(item, depth + 1));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(String(key || "")) ? "[redacted]" : workflowTemplateRedact(item, depth + 1);
  }
  return result;
}

export function workflowTemplateNormalizeSpec(input = {}, options = {}) {
  const raw = workflowV2JsonObject(input.templateSpec ?? input.template_spec ?? input.spec ?? input, {});
  const templateId = cleanTemplateId(firstText(raw.templateId, raw.template_id, input.templateId, input.template_id));
  const version = workflowV2NonNegativeInt(firstText(raw.version, input.version), 1) || 1;
  const riskPolicy = {
    ...normalizePolicyObject(raw.riskPolicy || raw.risk_policy),
    riskTier: normalizeRiskTier(firstText(raw.riskPolicy?.riskTier, raw.risk_policy?.risk_tier, raw.riskTier, raw.risk_tier, input.riskTier, input.risk_tier), "medium")
  };
  const spec = {
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
    templateId,
    version,
    status: normalizeTemplateStatus(firstText(raw.status, input.status, options.defaultStatus), options.defaultStatus || "candidate"),
    title: firstText(raw.title, input.title),
    description: firstText(raw.description, raw.summary, input.description, input.summary),
    ownerAgent: firstText(raw.ownerAgent, raw.owner_agent, input.ownerAgent, input.owner_agent, "main"),
    tags: uniqueTextList(raw.tags || input.tags),
    triggers: normalizeTriggerBlock(raw.triggers),
    variables: workflowV2JsonArray(raw.variables, []).map(normalizeVariable).filter((item) => item.name),
    riskPolicy,
    permissionPolicy: normalizePolicyObject(raw.permissionPolicy || raw.permission_policy),
    planSpecSkeleton: workflowV2JsonObject(raw.planSpecSkeleton || raw.plan_spec_skeleton || raw.planSkeleton || raw.plan_skeleton, {}),
    evalPolicy: normalizePolicyObject(raw.evalPolicy || raw.eval_policy),
    promotionPolicy: normalizePolicyObject(raw.promotionPolicy || raw.promotion_policy),
    rollbackPolicy: normalizePolicyObject(raw.rollbackPolicy || raw.rollback_policy),
    audit: {
      ...normalizePolicyObject(raw.audit),
      createdBy: firstText(raw.audit?.createdBy, raw.audit?.created_by, input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main")
    }
  };
  return spec;
}

export function workflowTemplateValidation(spec = {}) {
  const errors = [];
  const advisories = [];
  if (spec.schemaVersion !== WORKFLOW_TEMPLATE_SCHEMA_VERSION) {
    errors.push(workflowV2ValidationError("schema_version_invalid", "template schemaVersion must be workflow_template_spec.v1", { schemaVersion: spec.schemaVersion || "" }));
  }
  if (!spec.templateId) errors.push(workflowV2ValidationError("template_id_required", "templateId is required"));
  if (!Number.isInteger(Number(spec.version)) || Number(spec.version) < 1) {
    errors.push(workflowV2ValidationError("version_invalid", "template version must be a positive integer"));
  }
  if (!WORKFLOW_TEMPLATE_STATUSES.has(String(spec.status || ""))) {
    errors.push(workflowV2ValidationError("status_invalid", "template status is not supported", { status: spec.status || "" }));
  }
  if (!spec.title) errors.push(workflowV2ValidationError("title_required", "template title is required"));
  if (!spec.description) advisories.push(workflowV2ValidationAdvisory("description_recommended", "template description is recommended"));
  if (!spec.ownerAgent) errors.push(workflowV2ValidationError("owner_agent_required", "ownerAgent is required"));
  const variableNames = new Set();
  for (const variable of workflowV2JsonArray(spec.variables, [])) {
    if (!variable.name) errors.push(workflowV2ValidationError("variable_name_required", "every variable requires a name"));
    if (variable.name && variableNames.has(variable.name)) {
      errors.push(workflowV2ValidationError("variable_name_duplicate", "template variables must be unique", { variable: variable.name }));
    }
    variableNames.add(variable.name);
    if (variable.sensitive) {
      errors.push(workflowV2ValidationError("sensitive_variable_disallowed", "template variables must not carry sensitive values", { variable: variable.name }));
    }
  }
  if (!spec.planSpecSkeleton || typeof spec.planSpecSkeleton !== "object" || Array.isArray(spec.planSpecSkeleton)) {
    errors.push(workflowV2ValidationError("plan_skeleton_required", "planSpecSkeleton must be an object"));
  } else if (!firstText(spec.planSpecSkeleton.objective, spec.planSpecSkeleton.summary, spec.planSpecSkeleton.prompt, spec.planSpecSkeleton.text)) {
    errors.push(workflowV2ValidationError("plan_skeleton_objective_required", "planSpecSkeleton must provide objective/summary/prompt/text"));
  }
  if (!workflowV2JsonArray(spec.variables, []).length) {
    advisories.push(workflowV2ValidationAdvisory("variables_recommended", "templates should expose task-specific values as variables"));
  }
  return {
    valid: errors.length === 0,
    errors,
    advisoryChecks: advisories,
    warnings: advisories
  };
}

function resolveVariableValue(variable = {}, values = {}) {
  if (values[variable.name] !== undefined && values[variable.name] !== null && values[variable.name] !== "") return values[variable.name];
  if (variable.default !== undefined) return variable.default;
  if (variable.required) throw new Error(`template variable is required: ${variable.name}`);
  return "";
}

function coerceVariableValue(variable = {}, value) {
  if (value === "" && !variable.required) return value;
  if (variable.type === "number" || variable.type === "integer") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`template variable must be numeric: ${variable.name}`);
    return variable.type === "integer" ? Math.trunc(number) : number;
  }
  if (variable.type === "boolean") return boolOption(value, false);
  if (variable.type === "array") return workflowV2JsonArray(value, []);
  if (variable.type === "object") return workflowV2JsonObject(value, {});
  const text = String(value ?? "");
  if (variable.allowedValues?.length && !variable.allowedValues.includes(text)) {
    throw new Error(`template variable has unsupported value: ${variable.name}`);
  }
  return text;
}

function replacePlaceholders(value, variables = {}) {
  if (typeof value === "string") {
    const whole = value.match(/^\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}$/);
    if (whole && Object.hasOwn(variables, whole[1])) return variables[whole[1]];
    return value.replace(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g, (match, name) => {
      if (!Object.hasOwn(variables, name)) return match;
      const replacement = variables[name];
      return typeof replacement === "string" ? replacement : JSON.stringify(replacement);
    });
  }
  if (Array.isArray(value)) return value.map((item) => replacePlaceholders(item, variables));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = replacePlaceholders(item, variables);
  return result;
}

export function workflowTemplateVariableValues(spec = {}, values = {}) {
  const inputValues = workflowV2JsonObject(values, {});
  const resolved = {};
  for (const variable of workflowV2JsonArray(spec.variables, [])) {
    resolved[variable.name] = coerceVariableValue(variable, resolveVariableValue(variable, inputValues));
  }
  return resolved;
}

export function workflowTemplatePlanInput(spec = {}, values = {}, overrides = {}) {
  const resolvedVariables = workflowTemplateVariableValues(spec, values);
  const skeleton = replacePlaceholders(spec.planSpecSkeleton || {}, resolvedVariables);
  const cleanOverrides = workflowV2JsonObject(overrides, {});
  return {
    ...skeleton,
    ...cleanOverrides,
    payload: {
      ...workflowV2JsonObject(skeleton.payload, {}),
      ...workflowV2JsonObject(cleanOverrides.payload, {}),
      template: {
        schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
        templateId: spec.templateId,
        version: spec.version,
        status: spec.status
      },
      templateVariables: workflowTemplateRedact(resolvedVariables)
    }
  };
}

export function workflowTemplateHighRisk(spec = {}, input = {}) {
  const riskTier = normalizeRiskTier(firstText(spec.riskPolicy?.riskTier, spec.riskTier, input.riskTier, input.risk_tier), "medium");
  const text = JSON.stringify({
    templateId: spec.templateId,
    title: spec.title,
    description: spec.description,
    tags: spec.tags,
    riskPolicy: spec.riskPolicy,
    permissionPolicy: spec.permissionPolicy,
    promotionPolicy: spec.promotionPolicy,
    input: workflowTemplateRedact(input)
  });
  return ["P0", "P1", "critical", "high"].includes(riskTier) || HIGH_RISK_TEXT.test(text);
}

export function workflowTemplateComparableArms(evaluation = {}) {
  const arms = workflowV2JsonArray(evaluation.arms || evaluation.comparableArms || evaluation.comparable_arms, [])
    .map((arm) => workflowV2JsonObject(arm, {}))
    .filter((arm) => WORKFLOW_TEMPLATE_EVAL_ARM_KINDS.has(String(arm.kind || arm.arm || "").trim()));
  return new Set(arms.map((arm) => String(arm.kind || arm.arm).trim()));
}

export function workflowTemplateRewardScore(metricsInput = {}) {
  const metrics = workflowV2JsonObject(metricsInput, {});
  const clamp01 = (value, fallback = 0) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(1, number));
  };
  const positive =
    0.20 * clamp01(metrics.planGatePassRate ?? metrics.plan_gate_pass_rate) +
    0.20 * clamp01(metrics.executionSuccessRate ?? metrics.execution_success_rate) +
    0.15 * clamp01(metrics.receiptCompletenessRate ?? metrics.receipt_completeness_rate) +
    0.15 * clamp01(metrics.evaluatorAcceptRate ?? metrics.evaluator_accept_rate) +
    0.10 * clamp01(metrics.toolFeedbackCompleteness ?? metrics.tool_feedback_completeness) +
    0.10 * clamp01(metrics.rollbackReadinessRate ?? metrics.rollback_readiness_rate) +
    0.05 * (1 - clamp01(metrics.ownerRevisionRate ?? metrics.owner_revision_rate)) +
    0.05 * (1 - clamp01(metrics.humanGateReturnRate ?? metrics.human_gate_return_rate));
  const penalties =
    0.30 * clamp01(metrics.sideEffectUncertainRate ?? metrics.side_effect_uncertain_rate) +
    0.20 * clamp01(metrics.freshnessViolationRate ?? metrics.freshness_violation_rate) +
    0.10 * clamp01(metrics.duplicateWorkRate ?? metrics.duplicate_work_rate);
  const score = Math.max(0, Math.min(100, Math.round((positive - penalties) * 1000) / 10));
  const safetyFreeze = clamp01(metrics.sideEffectUncertainRate ?? metrics.side_effect_uncertain_rate) > 0
    || clamp01(metrics.freshnessViolationRate ?? metrics.freshness_violation_rate) > 0;
  return { score, safetyFreeze };
}

export function workflowTemplateSummaryFromRows(specRow = {}, versionRow = {}, statsRow = {}) {
  const payload = workflowV2JsonObject(specRow.payload_json, {});
  return {
    templateId: specRow.template_id || versionRow.template_id || "",
    title: specRow.title || payload.title || "",
    description: specRow.description || payload.description || "",
    ownerAgent: specRow.owner_agent || "",
    familyStatus: specRow.family_status || "",
    riskTier: specRow.risk_tier || "",
    tags: workflowV2JsonArray(specRow.tags_json, []),
    defaultVersion: Number(specRow.default_version || 0),
    activeVersion: Number(specRow.active_version || 0),
    latestVersion: Number(versionRow.version || 0),
    latestStatus: versionRow.status || "",
    latestArtifactRef: versionRow.artifact_ref || "",
    latestArtifactHash: versionRow.artifact_hash || "",
    score: statsRow.reward_score === undefined || statsRow.reward_score === null ? null : Number(statsRow.reward_score),
    evalCount: Number(statsRow.eval_count || 0),
    lastEvalAt: statsRow.last_eval_at || "",
    rollbackTargetVersion: Number(statsRow.rollback_target_version || 0),
    updatedAt: specRow.updated_at || versionRow.created_at || ""
  };
}
