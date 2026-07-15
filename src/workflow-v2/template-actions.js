import fs from "node:fs/promises";
import path from "node:path";

import { workflowPaths } from "../workflow/paths.js";
import {
  boolOption,
  firstText,
  parseJsonValue,
  safeId,
  toList
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteTransaction
} from "../workflow/sqlite.js";
import {
  WORKFLOW_TEMPLATE_FAMILY_STATUSES,
  WORKFLOW_TEMPLATE_PROMOTION_TARGETS,
  WORKFLOW_TEMPLATE_SCHEMA_VERSION,
  workflowTemplateComparableArms,
  workflowTemplateHighRisk,
  workflowTemplateJsonHash,
  workflowTemplateNormalizeSpec,
  workflowTemplatePlanInput,
  workflowTemplateRedact,
  workflowTemplateRewardScore,
  workflowTemplateSummaryFromRows,
  workflowTemplateValidation
} from "./template.js";
import {
  workflowV2ErrorMessage,
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2ValidationAdvisory,
  workflowV2ValidationError
} from "./helpers.js";

export function createWorkflowTemplateActionHandlers(context = {}) {
  const {
    cleanFileSegment,
    ensureWorkflowLayout,
    nowIso,
    permissionEvidencePresent,
    relativeTo,
    workflowV2PlanCreate,
    workflowV2PlanPreview,
    writeJsonAtomic
  } = context;

function workflowTemplateId(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("templateId is required");
  return cleanFileSegment(text).slice(0, 160);
}

function workflowTemplateVersion(value, fallback = 1) {
  const version = workflowV2NonNegativeInt(value, fallback) || fallback;
  if (version < 1) throw new Error("template version must be a positive integer");
  return version;
}

function workflowTemplateArtifactId(templateId, version) {
  return `${cleanFileSegment(templateId)}.v${version}.workflow_template_spec.v1.json`;
}

function workflowTemplateArtifactPath(paths, templateId, version) {
  const artifactDir = path.join(paths.artifactsDir, "workflow-v2", "templates", cleanFileSegment(templateId));
  return path.join(artifactDir, `v${version}.json`);
}

function workflowTemplateEvalArtifactPath(paths, templateId, evalId) {
  const artifactDir = path.join(paths.artifactsDir, "workflow-v2", "templates", cleanFileSegment(templateId), "evals");
  return path.join(artifactDir, `${cleanFileSegment(evalId)}.fixture.json`);
}

function workflowTemplateAllowedCapabilities(spec = {}) {
  return Array.from(new Set([
    ...toList(spec.permissionPolicy?.allowedCapabilities),
    ...toList(spec.permissionPolicy?.allowed_capabilities),
    ...toList(spec.permissionPolicy?.capabilities),
    ...toList(spec.permissionPolicy?.permissions)
  ].map((item) => String(item || "").trim()).filter(Boolean)));
}

async function workflowTemplateVersionRow(paths, templateId, version = 0) {
  const versionWhere = version ? `AND version=${sqlValue(version)}` : "";
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_template_versions
WHERE template_id=${sqlValue(templateId)}
  ${versionWhere}
ORDER BY version DESC
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowTemplateSpecRow(paths, templateId) {
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_template_specs
WHERE template_id=${sqlValue(templateId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowTemplateLoadSpecFromRow(paths, versionRow = {}) {
  const artifactRef = String(versionRow.artifact_ref || "").trim();
  if (!artifactRef) throw new Error("template version does not have an artifact_ref");
  if (path.isAbsolute(artifactRef)) {
    throw new Error("template artifact_ref must be relative to workflow root");
  }
  const root = path.resolve(paths.root);
  const artifactPath = path.resolve(root, artifactRef);
  const relativePath = path.relative(root, artifactPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("template artifact path escapes workflow root");
  }
  const parsed = JSON.parse(await fs.readFile(artifactPath, "utf8"));
  const artifactHash = workflowTemplateJsonHash(parsed);
  if (versionRow.artifact_hash && artifactHash !== versionRow.artifact_hash) {
    throw new Error(`template artifact hash mismatch: ${versionRow.template_id} v${versionRow.version}`);
  }
  return parsed;
}

async function workflowTemplateResolveSpec(rootDir, input = {}) {
  if (input.templateSpec || input.template_spec || input.spec) {
    const spec = workflowTemplateNormalizeSpec(input);
    return { spec, source: "input" };
  }
  const paths = await ensureWorkflowLayout(rootDir, input);
  const templateId = workflowTemplateId(input.templateId || input.template_id);
  let version = input.version === undefined || input.version === null || input.version === ""
    ? 0
    : workflowTemplateVersion(input.version, 1);
  if (!version) {
    const family = await workflowTemplateSpecRow(paths, templateId);
    version = Number(family?.default_version || family?.active_version || 0);
  }
  const versionRow = await workflowTemplateVersionRow(paths, templateId, version);
  if (!versionRow) throw new Error(`template version not found: ${templateId}${version ? ` v${version}` : ""}`);
  const artifactSpec = await workflowTemplateLoadSpecFromRow(paths, versionRow);
  const spec = workflowTemplateNormalizeSpec({
    templateSpec: {
      ...artifactSpec,
      status: versionRow.status || artifactSpec.status
    }
  });
  return { spec, source: "registry", paths, versionRow };
}

async function workflowTemplatePreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const spec = workflowTemplateNormalizeSpec(input);
  const validation = workflowTemplateValidation(spec);
  let planPreviewInput = null;
  let planPreview = null;
  let planPreviewError = "";
  const variableInput = workflowV2JsonObject(input.variables || input.variableValues || input.variable_values, {});
  const missingRequiredVariables = workflowV2JsonArray(spec.variables, [])
    .filter((variable) => variable.required && variable.default === undefined && (variableInput[variable.name] === undefined || variableInput[variable.name] === null || variableInput[variable.name] === ""))
    .map((variable) => variable.name);
  if (validation.valid) {
    try {
      if (!missingRequiredVariables.length) {
        planPreviewInput = workflowTemplatePlanInput(spec, variableInput, input.planOverrides || input.plan_overrides || {});
        planPreview = await workflowV2PlanPreview(rootDir, planPreviewInput);
      }
    } catch (error) {
      planPreviewError = workflowV2ErrorMessage(error);
    }
  }
  return {
    operation: "workflow.template.preview",
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
    dryRun: true,
    previewOnly: true,
    valid: validation.valid && !planPreviewError,
    errors: planPreviewError ? [...validation.errors, workflowV2ValidationError("plan_preview_failed", planPreviewError)] : validation.errors,
    advisoryChecks: missingRequiredVariables.length
      ? [...validation.advisoryChecks, workflowV2ValidationAdvisory("template_variables_required_for_plan_preview", "template variables are required before rendering workflow.v2.plan.preview", { variables: missingRequiredVariables })]
      : validation.advisoryChecks,
    templateSpec: workflowTemplateRedact(spec),
    planPreviewInput: workflowTemplateRedact(planPreviewInput),
    planPreview,
    dbFile: paths.dbFile,
    writes: []
  };
}

function workflowTemplateDailyTradingCatalogSpecs() {
  const sharedPromotionPolicy = {
    autoPromote: false,
    defaultPromotionRequires: ["humanGateId", "catBrainAuditId", "catClawAuditId", "evalEvidenceRefs", "rollbackPolicy"],
    humanGateRequiredForTargets: ["default"],
    defaultTemplateSelectionEnabled: false
  };
  const sharedRollbackPolicy = {
    restorePreviousDefault: true,
    disableTemplateVersion: true,
    preserveArtifacts: true,
    rollbackRequires: ["humanGateId", "rollbackReason", "previousDefaultVersion"]
  };
  return [
    {
      schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
      templateId: "daily-trading.morning-readiness.v1",
      version: 1,
      status: "candidate",
      title: "每日交易盘前 readiness 固定模板",
      description: "盘前聚合数据新鲜度、运行面 readiness、风险约束和候选关注清单；不产生交易指令。",
      ownerAgent: "main",
      tags: ["daily-trading", "morning", "readiness", "paper-only", "candidate"],
      triggers: {
        shouldUse: ["trading_day_preopen", "manual_rehearsal"],
        shouldNotUse: ["live_order_submission", "broker_side_effect"],
        requiredSignals: ["market_calendar", "data_freshness", "runtime_readiness"],
        forbiddenSignals: ["unreviewed_trade_intent", "live_broker_credential"]
      },
      variables: [
        { name: "tradeDate", type: "string", required: true, description: "YYYY-MM-DD trading date" },
        { name: "marketScope", type: "string", required: true, default: "cn-a-share" },
        { name: "dataFreshnessRef", type: "string", required: true },
        { name: "riskRunbookRef", type: "string", required: true }
      ],
      riskPolicy: { riskTier: "high", tradingMode: "paper_only", liveTradingAllowed: false, sideEffectsAllowed: false },
      permissionPolicy: { allowedCapabilities: ["workflow.preview", "workflow.verify"], disallowedCapabilities: ["trade.live", "broker.write"] },
      planSpecSkeleton: {
        workflowId: "daily-trading-morning-{{tradeDate}}",
        planId: "daily-trading-morning-readiness-{{tradeDate}}",
        objective: "完成 {{tradeDate}} {{marketScope}} 盘前 readiness 审计，输出候选关注清单、数据/运行面风险和 Human Gate 所需证据；不得生成可执行交易指令。",
        taskOwnerAgent: "main",
        participantManagers: ["cat_heart", "cat_body", "cat_nose"],
        orchestrationPattern: "parallel_manager_sections",
        riskTier: "high",
        executionMode: "paper_only",
        variables: { tradeDate: "{{tradeDate}}", marketScope: "{{marketScope}}" },
        acceptanceCriteria: [
          "数据新鲜度证据引用存在",
          "运行面 readiness 证据引用存在",
          "风险约束和禁用 live trading 声明存在",
          "所有输出停留在候选研究/准备层"
        ],
        payload: {
          templateFamily: "daily-trading",
          stage: "morning_readiness",
          dataFreshnessRef: "{{dataFreshnessRef}}",
          riskRunbookRef: "{{riskRunbookRef}}"
        }
      },
      evalPolicy: {
        fixtureFamilies: ["freshness_gap", "runtime_degraded", "normal_preopen"],
        scoringCriteria: ["evidenceCompleteness", "timestampCompliance", "failClosedLiveTrading", "humanGateReadiness"],
        minimumRewardScore: 0.85
      },
      promotionPolicy: sharedPromotionPolicy,
      rollbackPolicy: sharedRollbackPolicy,
      audit: { createdBy: "main", catalogStatus: "draft_candidate", generatedBy: "workflow.template.daily_trading_catalog.preview" }
    },
    {
      schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
      templateId: "daily-trading.intraday-signal-review.v1",
      version: 1,
      status: "candidate",
      title: "每日交易盘中信号复核固定模板",
      description: "盘中复核研究信号、异常数据和候选交易意图；只能产出需 Human Gate 的结构化候选，不触发交易。",
      ownerAgent: "main",
      tags: ["daily-trading", "intraday", "signal-review", "paper-only", "candidate"],
      triggers: {
        shouldUse: ["intraday_signal_batch", "manual_signal_review"],
        shouldNotUse: ["raw_chat_trade_command", "live_order_submission"],
        requiredSignals: ["signal_batch_ref", "risk_context_ref"],
        forbiddenSignals: ["free_text_order", "broker_secret"]
      },
      variables: [
        { name: "tradeDate", type: "string", required: true },
        { name: "signalBatchRef", type: "string", required: true },
        { name: "riskContextRef", type: "string", required: true },
        { name: "maxCandidates", type: "integer", required: false, default: 5 }
      ],
      riskPolicy: { riskTier: "high", tradingMode: "paper_only", liveTradingAllowed: false, sideEffectsAllowed: false, requiresHumanGateForTradeIntent: true },
      permissionPolicy: { allowedCapabilities: ["workflow.preview", "workflow.verify"], disallowedCapabilities: ["trade.live", "broker.write"] },
      planSpecSkeleton: {
        workflowId: "daily-trading-intraday-{{tradeDate}}",
        planId: "daily-trading-intraday-signal-review-{{tradeDate}}",
        objective: "复核 {{tradeDate}} 盘中信号批次 {{signalBatchRef}}，最多形成 {{maxCandidates}} 个结构化候选意图；所有候选必须绑定风险上下文 {{riskContextRef}} 且等待 Human Gate。",
        taskOwnerAgent: "main",
        participantManagers: ["cat_heart", "cat_body", "cat_eyes", "cat_nose"],
        orchestrationPattern: "parallel_manager_sections",
        riskTier: "high",
        executionMode: "paper_only",
        acceptanceCriteria: [
          "信号批次引用存在",
          "每个候选都有风险上下文和过期时间",
          "没有 live broker 或下单副作用",
          "需要交易执行时只输出 Human Gate 候选表单"
        ],
        payload: {
          templateFamily: "daily-trading",
          stage: "intraday_signal_review",
          signalBatchRef: "{{signalBatchRef}}",
          riskContextRef: "{{riskContextRef}}",
          maxCandidates: "{{maxCandidates}}"
        }
      },
      evalPolicy: {
        fixtureFamilies: ["conflicting_signals", "stale_signal", "normal_signal_batch"],
        scoringCriteria: ["riskBindingCompleteness", "candidateExpiry", "failClosedLiveTrading", "evidenceTraceability"],
        minimumRewardScore: 0.88
      },
      promotionPolicy: sharedPromotionPolicy,
      rollbackPolicy: sharedRollbackPolicy,
      audit: { createdBy: "main", catalogStatus: "draft_candidate", generatedBy: "workflow.template.daily_trading_catalog.preview" }
    },
    {
      schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
      templateId: "daily-trading.eod-closeout.v1",
      version: 1,
      status: "candidate",
      title: "每日交易盘后收口固定模板",
      description: "盘后汇总 paper 结果、receipt、数据缺口和次日待办；不修改持仓或订单状态。",
      ownerAgent: "main",
      tags: ["daily-trading", "eod", "closeout", "paper-only", "candidate"],
      triggers: {
        shouldUse: ["trading_day_close", "manual_closeout"],
        shouldNotUse: ["order_reconciliation_write", "broker_state_mutation"],
        requiredSignals: ["paper_receipt_refs", "data_quality_summary"],
        forbiddenSignals: ["live_position_write", "credential_payload"]
      },
      variables: [
        { name: "tradeDate", type: "string", required: true },
        { name: "paperReceiptRefs", type: "array", required: true },
        { name: "dataQualityRef", type: "string", required: true }
      ],
      riskPolicy: { riskTier: "high", tradingMode: "paper_only", liveTradingAllowed: false, sideEffectsAllowed: false },
      permissionPolicy: { allowedCapabilities: ["workflow.preview", "workflow.verify"], disallowedCapabilities: ["trade.live", "broker.write", "position.write"] },
      planSpecSkeleton: {
        workflowId: "daily-trading-eod-{{tradeDate}}",
        planId: "daily-trading-eod-closeout-{{tradeDate}}",
        objective: "完成 {{tradeDate}} 盘后收口：汇总 paper receipt、数据质量、未决风险和次日待办；不得修改持仓、订单或 broker 状态。",
        taskOwnerAgent: "main",
        participantManagers: ["cat_heart", "cat_body", "cat_penclaw"],
        orchestrationPattern: "manager_worker",
        riskTier: "high",
        executionMode: "paper_only",
        acceptanceCriteria: [
          "paper receipt 引用完整",
          "数据质量引用存在",
          "未决风险和次日待办分离",
          "没有持仓、订单或 broker 写副作用"
        ],
        payload: {
          templateFamily: "daily-trading",
          stage: "eod_closeout",
          paperReceiptRefs: "{{paperReceiptRefs}}",
          dataQualityRef: "{{dataQualityRef}}"
        }
      },
      evalPolicy: {
        fixtureFamilies: ["missing_receipts", "data_gap", "normal_closeout"],
        scoringCriteria: ["receiptCompleteness", "dataQualityTraceability", "sideEffectAbsence", "nextDayActionClarity"],
        minimumRewardScore: 0.85
      },
      promotionPolicy: sharedPromotionPolicy,
      rollbackPolicy: sharedRollbackPolicy,
      audit: { createdBy: "main", catalogStatus: "draft_candidate", generatedBy: "workflow.template.daily_trading_catalog.preview" }
    }
  ].map((templateSpec) => workflowTemplateNormalizeSpec({ templateSpec }, { defaultStatus: "candidate" }));
}

async function workflowTemplateDailyTradingCatalogPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const specs = workflowTemplateDailyTradingCatalogSpecs();
  const templates = specs.map((spec) => {
    const validation = workflowTemplateValidation(spec);
    const highRisk = workflowTemplateHighRisk(spec);
    const defaultHumanGateRequired = workflowV2JsonArray(spec.promotionPolicy?.humanGateRequiredForTargets, []).includes("default")
      || workflowV2JsonArray(spec.promotionPolicy?.human_gate_required_for_targets, []).includes("default")
      || workflowV2JsonArray(spec.promotionPolicy?.defaultPromotionRequires, []).includes("humanGateId");
    return {
      templateId: spec.templateId,
      version: spec.version,
      status: spec.status,
      title: spec.title,
      ownerAgent: spec.ownerAgent,
      tags: spec.tags,
      riskTier: spec.riskPolicy?.riskTier || "",
      highRisk,
      defaultHumanGateRequired,
      autoPromote: boolOption(spec.promotionPolicy?.autoPromote ?? spec.promotionPolicy?.auto_promote, false),
      defaultTemplateSelectionEnabled: boolOption(spec.promotionPolicy?.defaultTemplateSelectionEnabled ?? spec.promotionPolicy?.default_template_selection_enabled, false),
      evalFixtureFamilies: workflowV2JsonArray(spec.evalPolicy?.fixtureFamilies ?? spec.evalPolicy?.fixture_families, []),
      scoringCriteria: workflowV2JsonArray(spec.evalPolicy?.scoringCriteria ?? spec.evalPolicy?.scoring_criteria, []),
      rollbackPolicy: workflowTemplateRedact(spec.rollbackPolicy),
      valid: validation.valid,
      errors: validation.errors,
      advisoryChecks: validation.advisoryChecks,
      templateSpec: workflowTemplateRedact(spec)
    };
  });
  const errors = templates.flatMap((item) => item.errors.map((error) => ({ ...error, templateId: item.templateId })));
  return {
    operation: "workflow.template.daily_trading_catalog.preview",
    schemaVersion: "workflow_template_daily_trading_catalog_preview.v1",
    dryRun: true,
    previewOnly: true,
    readOnly: true,
    valid: errors.length === 0,
    errors,
    templates,
    count: templates.length,
    catalogPolicy: {
      status: "draft_candidate_only",
      recordCandidates: false,
      promoteCandidates: false,
      automaticLiveSelection: false,
      liveTradingAllowed: false
    },
    wouldCreate: {
      templateSpecs: 0,
      templateVersions: 0,
      templateEvents: 0,
      defaultTemplateSelections: 0,
      workflowPlans: 0,
      tradingSideEffects: 0
    },
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowTemplateRecordCandidate(rootDir, input = {}) {
  const preview = await workflowTemplatePreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow template candidate is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const spec = {
    ...workflowTemplateNormalizeSpec({ ...input, templateSpec: preview.templateSpec }, { defaultStatus: "candidate" }),
    status: "candidate"
  };
  const validation = workflowTemplateValidation(spec);
  if (!validation.valid) throw new Error(`workflow template candidate is invalid: ${validation.errors.map((item) => item.code).join(",")}`);
  const now = nowIso();
  const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, spec.audit?.createdBy, "main");
  const artifactFile = workflowTemplateArtifactPath(paths, spec.templateId, spec.version);
  const artifactRef = relativeTo(paths.root, artifactFile);
  const artifactHash = workflowTemplateJsonHash(spec);
  const existingVersion = await workflowTemplateVersionRow(paths, spec.templateId, spec.version);
  if (existingVersion && existingVersion.artifact_hash && existingVersion.artifact_hash !== artifactHash) {
    throw new Error(`workflow template version is append-only and already exists with a different hash: ${spec.templateId} v${spec.version}`);
  }
  await writeJsonAtomic(artifactFile, spec);
  const artifactId = workflowTemplateArtifactId(spec.templateId, spec.version);
  const sourceWorkflowId = firstText(input.sourceWorkflowId, input.source_workflow_id, spec.audit?.sourceWorkflowId, spec.audit?.source_workflow_id);
  const sourcePlanId = firstText(input.sourcePlanId, input.source_plan_id, spec.audit?.sourcePlanId, spec.audit?.source_plan_id);
  const sourcePlanArtifactRef = firstText(input.sourcePlanArtifactRef, input.source_plan_artifact_ref, spec.audit?.sourcePlanArtifactRef, spec.audit?.source_plan_artifact_ref);
  const sourcePlanArtifactHash = firstText(input.sourcePlanArtifactHash, input.source_plan_artifact_hash, spec.audit?.sourcePlanArtifactHash, spec.audit?.source_plan_artifact_hash);
  const payload = workflowTemplateRedact({
    title: spec.title,
    description: spec.description,
    tags: spec.tags,
    triggers: spec.triggers,
    riskPolicy: spec.riskPolicy,
    permissionPolicy: spec.permissionPolicy,
    promotionPolicy: spec.promotionPolicy,
    rollbackPolicy: spec.rollbackPolicy,
    audit: spec.audit
  });
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_template_specs(template_id, family_status, owner_agent, title, description, risk_tier, tags_json, allowed_capabilities_json, default_version, active_version, payload_json, created_at, updated_at)
VALUES (${sqlValue(spec.templateId)}, 'active', ${sqlValue(spec.ownerAgent)}, ${sqlValue(spec.title)}, ${sqlValue(spec.description)}, ${sqlValue(spec.riskPolicy.riskTier)}, ${sqlValue(JSON.stringify(spec.tags))}, ${sqlValue(JSON.stringify(workflowTemplateAllowedCapabilities(spec)))}, 0, 0, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(template_id) DO UPDATE SET
  owner_agent=excluded.owner_agent,
  title=excluded.title,
  description=excluded.description,
  risk_tier=excluded.risk_tier,
  tags_json=excluded.tags_json,
  allowed_capabilities_json=excluded.allowed_capabilities_json,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  await sqlite(paths.dbFile, `
INSERT OR IGNORE INTO workflow_v2_template_versions(template_id, version, status, artifact_ref, artifact_hash, source_workflow_id, source_plan_id, source_plan_artifact_ref, source_plan_artifact_hash, promotion_state, payload_hash, payload_json, created_by, created_at)
VALUES (${sqlValue(spec.templateId)}, ${sqlValue(spec.version)}, ${sqlValue(spec.status)}, ${sqlValue(artifactRef)}, ${sqlValue(artifactHash)}, ${sqlValue(sourceWorkflowId)}, ${sqlValue(sourcePlanId)}, ${sqlValue(sourcePlanArtifactRef)}, ${sqlValue(sourcePlanArtifactHash)}, ${sqlValue(spec.status)}, ${sqlValue(workflowTemplateJsonHash(payload))}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdBy)}, ${sqlValue(now)});`);
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(artifactId)}, ${sqlValue(sourceWorkflowId)}, 'workflow_template_spec_json', ${sqlValue(artifactRef)}, ${sqlValue(spec.title)}, ${sqlValue(createdBy)}, ${sqlValue(now)})
ON CONFLICT(artifact_id) DO UPDATE SET workflow_id=excluded.workflow_id, kind=excluded.kind, path=excluded.path, summary=excluded.summary, created_by=excluded.created_by;`);
  const eventId = safeId("template-event");
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_template_events(event_id, template_id, version, event_type, status, actor, evidence_refs_json, payload_json, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(spec.templateId)}, ${sqlValue(spec.version)}, 'candidate_recorded', ${sqlValue(spec.status)}, ${sqlValue(createdBy)}, ${sqlValue(JSON.stringify(toList(input.evidenceRefs || input.evidence_refs)))}, ${sqlValue(JSON.stringify({ artifactRef, artifactHash, sourceWorkflowId, sourcePlanId }))}, ${sqlValue(now)});`);
  return {
    operation: "workflow.template.record_candidate",
    schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
    templateId: spec.templateId,
    version: spec.version,
    status: spec.status,
    artifact: { artifactId, artifactRef, artifactHash },
    eventId,
    dbFile: paths.dbFile
  };
}

async function workflowTemplateSearch(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const q = String(input.q || input.query || "").trim().toLowerCase();
  const status = String(input.status || "").trim();
  const ownerAgent = String(input.ownerAgent || input.owner_agent || "").trim();
  const riskTier = String(input.riskTier || input.risk_tier || "").trim();
  const limit = Math.max(1, Math.min(Number(input.limit || 50), 200));
  const where = [];
  if (q) where.push(`(instr(lower(s.template_id), ${sqlValue(q)}) > 0 OR instr(lower(s.title), ${sqlValue(q)}) > 0 OR instr(lower(s.description), ${sqlValue(q)}) > 0 OR instr(lower(s.tags_json), ${sqlValue(q)}) > 0)`);
  if (status) where.push(`s.family_status=${sqlValue(status)} OR latest.status=${sqlValue(status)}`);
  if (ownerAgent) where.push(`s.owner_agent=${sqlValue(ownerAgent)}`);
  if (riskTier) where.push(`s.risk_tier=${sqlValue(riskTier)}`);
  const rows = await sqlite(paths.dbFile, `
SELECT s.*, latest.version, latest.status AS latest_status, latest.artifact_ref, latest.artifact_hash, st.reward_score, st.eval_count, st.last_eval_at, st.rollback_target_version
FROM workflow_v2_template_specs s
LEFT JOIN workflow_v2_template_versions latest
  ON latest.template_id=s.template_id
  AND latest.version=(SELECT MAX(v.version) FROM workflow_v2_template_versions v WHERE v.template_id=s.template_id)
LEFT JOIN workflow_v2_template_stats st ON st.template_id=s.template_id
${where.length ? `WHERE ${where.map((item) => `(${item})`).join(" AND ")}` : ""}
ORDER BY s.updated_at DESC
LIMIT ${sqlValue(limit)};`, { json: true });
  return {
    operation: "workflow.template.search",
    schemaVersion: "workflow_template_search.v1",
    count: rows.length,
    templates: rows.map((row) => workflowTemplateSummaryFromRows(row, {
      template_id: row.template_id,
      version: row.version,
      status: row.latest_status,
      artifact_ref: row.artifact_ref,
      artifact_hash: row.artifact_hash
    }, row)),
    dbFile: paths.dbFile
  };
}

async function workflowTemplateGet(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const templateId = workflowTemplateId(input.templateId || input.template_id);
  const family = await workflowTemplateSpecRow(paths, templateId);
  if (!family) return { operation: "workflow.template.get", schemaVersion: "workflow_template_detail.v1", templateId, found: false, dbFile: paths.dbFile };
  const versionFilter = input.version === undefined || input.version === null || input.version === "" ? "" : `WHERE template_id=${sqlValue(templateId)} AND version=${sqlValue(workflowTemplateVersion(input.version, 1))}`;
  const versions = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_template_versions
${versionFilter || `WHERE template_id=${sqlValue(templateId)}`}
ORDER BY version DESC;`, { json: true });
  const statsRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_template_stats WHERE template_id=${sqlValue(templateId)} LIMIT 1;`, { json: true });
  const evals = await sqlite(paths.dbFile, `
SELECT eval_id, template_id, version, arm, fixture_artifact_ref, fixture_hash, isolated_root, metrics_json, reward_score, safety_freeze, evidence_refs_json, created_by, created_at
FROM workflow_v2_template_evals
WHERE template_id=${sqlValue(templateId)}
ORDER BY created_at DESC
LIMIT ${sqlValue(Math.max(1, Math.min(Number(input.evalLimit || input.eval_limit || 20), 100)))};`, { json: true });
  const events = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_template_events
WHERE template_id=${sqlValue(templateId)}
ORDER BY created_at DESC
LIMIT ${sqlValue(Math.max(1, Math.min(Number(input.eventLimit || input.event_limit || 50), 100)))};`, { json: true });
  let templateSpec = null;
  if (versions[0]?.artifact_ref && boolOption(input.includeSpec ?? input.include_spec, true)) {
    templateSpec = workflowTemplateRedact(await workflowTemplateLoadSpecFromRow(paths, versions[0]));
  }
  return {
    operation: "workflow.template.get",
    schemaVersion: "workflow_template_detail.v1",
    found: true,
    template: workflowTemplateSummaryFromRows(family, versions[0] || {}, statsRows[0] || {}),
    family: workflowTemplateRedact({
      ...family,
      payload: parseJsonValue(family.payload_json, {}),
      tags: parseJsonValue(family.tags_json, []),
      allowedCapabilities: parseJsonValue(family.allowed_capabilities_json, [])
    }),
    versions: versions.map((row) => workflowTemplateRedact({ ...row, payload: parseJsonValue(row.payload_json, {}) })),
    stats: statsRows[0] ? workflowTemplateRedact({ ...statsRows[0], metrics: parseJsonValue(statsRows[0].metrics_json, {}) }) : null,
    evals: evals.map((row) => workflowTemplateRedact({ ...row, metrics: parseJsonValue(row.metrics_json, {}), evidenceRefs: parseJsonValue(row.evidence_refs_json, []) })),
    events: events.map((row) => workflowTemplateRedact({ ...row, evidenceRefs: parseJsonValue(row.evidence_refs_json, []), payload: parseJsonValue(row.payload_json, {}) })),
    templateSpec,
    dbFile: paths.dbFile
  };
}

async function workflowTemplateInstantiatePreview(rootDir, input = {}) {
  const resolved = await workflowTemplateResolveSpec(rootDir, input);
  const validation = workflowTemplateValidation(resolved.spec);
  if (!validation.valid) {
    return {
      operation: "workflow.template.instantiate.preview",
      schemaVersion: "workflow_template_instantiation_preview.v1",
      dryRun: true,
      previewOnly: true,
      valid: false,
      errors: validation.errors,
      advisoryChecks: validation.advisoryChecks,
      template: { templateId: resolved.spec.templateId, version: resolved.spec.version, source: resolved.source },
      planInput: null,
      planPreview: null,
      writes: []
    };
  }
  const variables = workflowV2JsonObject(input.variables || input.variableValues || input.variable_values, {});
  const overrides = workflowV2JsonObject(input.planOverrides || input.plan_overrides, {});
  const planInput = workflowTemplatePlanInput(resolved.spec, variables, overrides);
  planInput.payload = workflowV2JsonObject(planInput.payload, {});
  planInput.payload.template = {
    ...workflowV2JsonObject(planInput.payload.template, {}),
    source: resolved.source,
    artifactRef: resolved.versionRow?.artifact_ref || "",
    artifactHash: resolved.versionRow?.artifact_hash || "",
    fixedPlan: true
  };
  const planPreview = await workflowV2PlanPreview(rootDir, planInput);
  return {
    operation: "workflow.template.instantiate.preview",
    schemaVersion: "workflow_template_instantiation_preview.v1",
    dryRun: true,
    previewOnly: true,
    valid: planPreview.valid,
    template: { templateId: resolved.spec.templateId, version: resolved.spec.version, source: resolved.source },
    planInput: workflowTemplateRedact(planInput),
    planPreview,
    writes: []
  };
}

async function workflowTemplateInstantiateRecord(rootDir, input = {}) {
  const preview = await workflowTemplateInstantiatePreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow template instantiation is invalid: ${preview.planPreview.errors.map((item) => item.code).join(",")}`);
  const created = await workflowV2PlanCreate(rootDir, preview.planInput);
  return {
    operation: "workflow.template.instantiate.record",
    schemaVersion: "workflow_template_instantiation_result.v1",
    template: preview.template,
    plan: created.plan,
    planSpecV2: created.planSpecV2,
    artifacts: created.artifacts,
    nodeCount: created.nodeCount,
    dbFile: created.dbFile
  };
}

async function workflowTemplateEvalPreview(rootDir, input = {}) {
  const resolved = await workflowTemplateResolveSpec(rootDir, input);
  const validation = workflowTemplateValidation(resolved.spec);
  const metrics = workflowV2JsonObject(input.metrics, {});
  const reward = workflowTemplateRewardScore(metrics);
  const arms = workflowV2JsonArray(input.arms || input.comparableArms || input.comparable_arms, []);
  const armKinds = workflowTemplateComparableArms({ arms });
  const isolatedRoots = arms.map((arm) => String(workflowV2JsonObject(arm, {}).isolatedRoot || workflowV2JsonObject(arm, {}).isolated_root || "").trim()).filter(Boolean);
  const errors = [];
  if (!input.fixtureSnapshot && !input.fixture_snapshot && !firstText(input.fixtureArtifactRef, input.fixture_artifact_ref)) {
    errors.push(workflowV2ValidationError("fixture_snapshot_required", "template eval requires an immutable fixture snapshot or fixture artifact ref"));
  }
  errors.push(...validation.errors);
  if (isolatedRoots.length && new Set(isolatedRoots).size !== isolatedRoots.length) {
    errors.push(workflowV2ValidationError("isolated_roots_must_be_distinct", "template eval arms must not share isolated roots"));
  }
  for (const required of ["baseline", "previous_version", "candidate_version"]) {
    if (!armKinds.has(required)) errors.push(workflowV2ValidationError("comparable_arm_required", "template eval requires comparable baseline, previous_version, and candidate_version arms", { arm: required }));
  }
  return {
    operation: "workflow.template.eval.preview",
    schemaVersion: "workflow_template_eval_preview.v1",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    advisoryChecks: validation.advisoryChecks,
    template: { templateId: resolved.spec.templateId, version: resolved.spec.version },
    metrics: workflowTemplateRedact(metrics),
    reward,
    comparableArms: Array.from(armKinds),
    writes: []
  };
}

async function workflowTemplateEvalRecord(rootDir, input = {}) {
  const preview = await workflowTemplateEvalPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow template eval is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const templateId = preview.template.templateId;
  const version = preview.template.version;
  const now = nowIso();
  const evalId = firstText(input.evalId, input.eval_id) || safeId("template-eval");
  const fixtureSnapshot = workflowTemplateRedact(workflowV2JsonObject(input.fixtureSnapshot || input.fixture_snapshot, {
    fixtureArtifactRef: input.fixtureArtifactRef || input.fixture_artifact_ref || "",
    arms: input.arms || input.comparableArms || input.comparable_arms || [],
    metrics: input.metrics || {}
  }));
  const fixtureFile = workflowTemplateEvalArtifactPath(paths, templateId, evalId);
  const fixtureRef = relativeTo(paths.root, fixtureFile);
  const fixtureHash = workflowTemplateJsonHash(fixtureSnapshot);
  const providedFixtureHash = firstText(input.fixtureHash, input.fixture_hash);
  if (providedFixtureHash && providedFixtureHash !== fixtureHash && !firstText(input.fixtureArtifactRef, input.fixture_artifact_ref)) {
    throw new Error("template eval fixture hash mismatch");
  }
  await writeJsonAtomic(fixtureFile, fixtureSnapshot);
  const reward = preview.reward;
  const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  const evidenceRefs = toList(input.evidenceRefs || input.evidence_refs);
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_template_evals(eval_id, template_id, version, arm, fixture_artifact_ref, fixture_hash, isolated_root, metrics_json, reward_score, safety_freeze, evidence_refs_json, payload_json, created_by, created_at)
VALUES (${sqlValue(evalId)}, ${sqlValue(templateId)}, ${sqlValue(version)}, 'candidate_version', ${sqlValue(fixtureRef)}, ${sqlValue(fixtureHash)}, ${sqlValue(firstText(input.isolatedRoot, input.isolated_root))}, ${sqlValue(JSON.stringify(preview.metrics))}, ${sqlValue(reward.score)}, ${sqlValue(reward.safetyFreeze ? 1 : 0)}, ${sqlValue(JSON.stringify(evidenceRefs))}, ${sqlValue(JSON.stringify({ comparableArms: preview.comparableArms, scoreCannotPromote: true }))}, ${sqlValue(createdBy)}, ${sqlValue(now)});`);
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${cleanFileSegment(evalId)}.fixture.json`)}, '', 'workflow_template_eval_fixture_json', ${sqlValue(fixtureRef)}, ${sqlValue(`Template eval fixture ${templateId} v${version}`)}, ${sqlValue(createdBy)}, ${sqlValue(now)})
ON CONFLICT(artifact_id) DO UPDATE SET kind=excluded.kind, path=excluded.path, summary=excluded.summary, created_by=excluded.created_by;`);
  await workflowTemplateStatsRefresh(rootDir, { ...input, templateId });
  return {
    operation: "workflow.template.eval.record",
    schemaVersion: "workflow_template_eval_result.v1",
    evalId,
    templateId,
    version,
    reward,
    fixture: { artifactRef: fixtureRef, artifactHash: fixtureHash },
    scoreCannotPromote: true,
    dbFile: paths.dbFile
  };
}

async function workflowTemplateStatsRefresh(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const templateId = workflowTemplateId(input.templateId || input.template_id);
  const family = await workflowTemplateSpecRow(paths, templateId);
  if (!family) throw new Error(`template not found: ${templateId}`);
  const rows = await sqlite(paths.dbFile, `
SELECT version, COUNT(*) AS eval_count, AVG(reward_score) AS reward_score, MAX(created_at) AS last_eval_at, MAX(safety_freeze) AS safety_freeze
FROM workflow_v2_template_evals
WHERE template_id=${sqlValue(templateId)}
GROUP BY version
ORDER BY version DESC
LIMIT 1;`, { json: true });
  const current = rows[0] || { version: family.active_version || family.default_version || 0, eval_count: 0, reward_score: null, last_eval_at: "", safety_freeze: 0 };
  const rollbackRows = await sqlite(paths.dbFile, `
SELECT previous_version
FROM workflow_v2_template_events
WHERE template_id=${sqlValue(templateId)}
  AND previous_version > 0
ORDER BY created_at DESC
LIMIT 1;`, { json: true });
  const fallbackRollback = Number(family.default_version || family.active_version || 0);
  const rollbackTarget = Number(rollbackRows[0]?.previous_version || fallbackRollback || 0);
  const now = nowIso();
  const metrics = { safetyFreeze: Boolean(Number(current.safety_freeze || 0)) };
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_template_stats(template_id, version, reward_score, eval_count, last_eval_at, rollback_target_version, metrics_json, updated_at)
VALUES (${sqlValue(templateId)}, ${sqlValue(Number(current.version || 0))}, ${current.reward_score === null || current.reward_score === undefined ? "NULL" : sqlValue(Number(current.reward_score))}, ${sqlValue(Number(current.eval_count || 0))}, ${sqlValue(current.last_eval_at || "")}, ${sqlValue(rollbackTarget)}, ${sqlValue(JSON.stringify(metrics))}, ${sqlValue(now)})
ON CONFLICT(template_id) DO UPDATE SET
  version=excluded.version,
  reward_score=excluded.reward_score,
  eval_count=excluded.eval_count,
  last_eval_at=excluded.last_eval_at,
  rollback_target_version=excluded.rollback_target_version,
  metrics_json=excluded.metrics_json,
  updated_at=excluded.updated_at;`);
  return {
    operation: "workflow.template.stats.refresh",
    schemaVersion: "workflow_template_stats_result.v1",
    templateId,
    version: Number(current.version || 0),
    rewardScore: current.reward_score === null || current.reward_score === undefined ? null : Number(current.reward_score),
    evalCount: Number(current.eval_count || 0),
    rollbackTargetVersion: rollbackTarget,
    safetyFreeze: Boolean(Number(current.safety_freeze || 0)),
    dbFile: paths.dbFile
  };
}

async function workflowTemplatePromotePreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const templateId = workflowTemplateId(input.templateId || input.template_id);
  const version = workflowTemplateVersion(input.version, 1);
  const targetStatus = String(input.targetStatus || input.target_status || input.status || "active").trim().toLowerCase().replace(/-/g, "_");
  if (!WORKFLOW_TEMPLATE_PROMOTION_TARGETS.has(targetStatus)) throw new Error(`unsupported template promotion target: ${targetStatus}`);
  const family = await workflowTemplateSpecRow(paths, templateId);
  const versionRow = await workflowTemplateVersionRow(paths, templateId, version);
  if (!family || !versionRow) throw new Error(`template version not found: ${templateId} v${version}`);
  const spec = await workflowTemplateLoadSpecFromRow(paths, versionRow);
  const statsRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_template_stats WHERE template_id=${sqlValue(templateId)} LIMIT 1;`, { json: true });
  const cachedStats = statsRows[0] || {};
  const versionEvalRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS eval_count, AVG(reward_score) AS reward_score, MAX(created_at) AS last_eval_at, MAX(safety_freeze) AS safety_freeze
FROM workflow_v2_template_evals
WHERE template_id=${sqlValue(templateId)}
  AND version=${sqlValue(version)};`, { json: true });
  const versionEvalStats = versionEvalRows[0] || {};
  const stats = {
    ...cachedStats,
    version,
    reward_score: versionEvalStats.reward_score,
    eval_count: Number(versionEvalStats.eval_count || 0),
    last_eval_at: versionEvalStats.last_eval_at || "",
    rollback_target_version: cachedStats.rollback_target_version || 0,
    metrics_json: JSON.stringify({ safetyFreeze: Boolean(Number(versionEvalStats.safety_freeze || 0)) })
  };
  const highRisk = workflowTemplateHighRisk(spec, input) || targetStatus === "default" && ["high", "critical", "P0", "P1"].includes(String(family.risk_tier || ""));
  const requirements = [];
  const hasCatBrain = permissionEvidencePresent(input, ["cat_brain_audit_id", "catBrainAuditId", "cat_brain_review_id", "catBrainReviewId"]);
  const hasCatClaw = permissionEvidencePresent(input, ["cat_claw_audit_id", "catClawAuditId", "secretary_audit_id", "secretaryAuditId"]);
  const hasHumanGate = permissionEvidencePresent(input, ["human_gate_id", "humanGateId", "human_gate_evidence", "humanGateEvidence", "flashcat_original_words", "flashcatOriginalWords"]);
  if (["active", "default"].includes(targetStatus) && !hasCatBrain) requirements.push({ type: "cat_brain_review", reason: "Cat Brain review is required before active/default template promotion" });
  if (["active", "default"].includes(targetStatus) && !hasCatClaw) requirements.push({ type: "cat_claw_audit", reason: "Cat Claw audit is required before active/default template promotion" });
  if (targetStatus === "default" && highRisk && !hasHumanGate) requirements.push({ type: "human_gate", reason: "High-risk default template promotion requires Human Gate evidence" });
  if (Number(stats.eval_count || 0) < 1 && ["active", "default"].includes(targetStatus)) requirements.push({ type: "eval_evidence", reason: "At least one eval record is required before active/default promotion" });
  const statsMetrics = parseJsonValue(stats.metrics_json, {});
  if (statsMetrics.safetyFreeze && ["active", "default"].includes(targetStatus)) requirements.push({ type: "safety_freeze", reason: "Safety penalties freeze promotion eligibility until resolved" });
  return {
    operation: "workflow.template.promote.preview",
    schemaVersion: "workflow_template_promotion_preview.v1",
    dryRun: true,
    previewOnly: true,
    valid: requirements.length === 0,
    requirements,
    highRisk,
    template: workflowTemplateSummaryFromRows(family, versionRow, stats),
    targetStatus,
    writes: []
  };
}

async function workflowTemplatePromoteRecord(rootDir, input = {}) {
  const preview = await workflowTemplatePromotePreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow template promotion blocked: ${preview.requirements.map((item) => item.type).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const templateId = preview.template.templateId;
  const version = workflowTemplateVersion(input.version, preview.template.latestVersion || 1);
  const targetStatus = preview.targetStatus;
  const family = await workflowTemplateSpecRow(paths, templateId);
  const previousVersion = targetStatus === "default" ? Number(family.default_version || 0) : Number(family.active_version || 0);
  const nextFamilyStatus = targetStatus === "frozen" ? "frozen" : targetStatus === "retired" ? "retired" : "active";
  if (!WORKFLOW_TEMPLATE_FAMILY_STATUSES.has(nextFamilyStatus)) throw new Error(`unsupported template family status: ${nextFamilyStatus}`);
  const defaultVersionSql = targetStatus === "default" ? sqlValue(version) : "default_version";
  const activeVersionSql = ["default", "active"].includes(targetStatus) ? sqlValue(version) : "active_version";
  const eventId = safeId("template-event");
  const actor = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  await sqliteTransaction(paths.dbFile, `
UPDATE workflow_v2_template_versions
SET status=${sqlValue(targetStatus)}, promotion_state=${sqlValue(targetStatus)}
WHERE template_id=${sqlValue(templateId)} AND version=${sqlValue(version)};
UPDATE workflow_v2_template_specs
SET family_status=${sqlValue(nextFamilyStatus)},
    default_version=${defaultVersionSql},
    active_version=${activeVersionSql},
    updated_at=${sqlValue(now)}
WHERE template_id=${sqlValue(templateId)};
INSERT INTO workflow_v2_template_events(event_id, template_id, version, event_type, previous_version, next_version, status, actor, human_gate_id, cat_brain_audit_id, cat_claw_audit_id, evidence_refs_json, payload_json, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(templateId)}, ${sqlValue(version)}, 'promoted', ${sqlValue(previousVersion)}, ${sqlValue(version)}, ${sqlValue(targetStatus)}, ${sqlValue(actor)}, ${sqlValue(firstText(input.humanGateId, input.human_gate_id))}, ${sqlValue(firstText(input.catBrainAuditId, input.cat_brain_audit_id, input.catBrainReviewId, input.cat_brain_review_id))}, ${sqlValue(firstText(input.catClawAuditId, input.cat_claw_audit_id, input.secretaryAuditId, input.secretary_audit_id))}, ${sqlValue(JSON.stringify(toList(input.evidenceRefs || input.evidence_refs)))}, ${sqlValue(JSON.stringify({ highRisk: preview.highRisk, requirementsSatisfied: true }))}, ${sqlValue(now)});`);
  await workflowTemplateStatsRefresh(rootDir, { ...input, templateId });
  return {
    operation: "workflow.template.promote.record",
    schemaVersion: "workflow_template_promotion_result.v1",
    templateId,
    version,
    targetStatus,
    previousVersion,
    eventId,
    dbFile: paths.dbFile
  };
}

async function workflowTemplateRollbackPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const templateId = workflowTemplateId(input.templateId || input.template_id);
  const family = await workflowTemplateSpecRow(paths, templateId);
  if (!family) throw new Error(`template not found: ${templateId}`);
  const statsRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_template_stats WHERE template_id=${sqlValue(templateId)} LIMIT 1;`, { json: true });
  const rollbackVersion = workflowTemplateVersion(input.rollbackToVersion || input.rollback_to_version || statsRows[0]?.rollback_target_version || family.default_version || family.active_version, 1);
  const targetVersion = await workflowTemplateVersionRow(paths, templateId, rollbackVersion);
  if (!targetVersion) throw new Error(`rollback target template version not found: ${templateId} v${rollbackVersion}`);
  const targetSpec = await workflowTemplateLoadSpecFromRow(paths, targetVersion);
  const previousVersion = Number(family.default_version || family.active_version || 0);
  const reason = firstText(input.rollbackReason, input.rollback_reason, input.reason, input.summary);
  const hasCatBrain = permissionEvidencePresent(input, ["cat_brain_audit_id", "catBrainAuditId", "cat_brain_review_id", "catBrainReviewId"]);
  const hasCatClaw = permissionEvidencePresent(input, ["cat_claw_audit_id", "catClawAuditId", "secretary_audit_id", "secretaryAuditId"]);
  const hasHumanGate = permissionEvidencePresent(input, ["human_gate_id", "humanGateId", "human_gate_evidence", "humanGateEvidence", "flashcat_original_words", "flashcatOriginalWords"]);
  const approvedRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_v2_template_events
WHERE template_id=${sqlValue(templateId)}
  AND next_version=${sqlValue(rollbackVersion)}
  AND status IN ('active','default');`, { json: true });
  const approvedTarget = ["active", "default", "rolled_back"].includes(String(targetVersion.status || ""))
    || Number(family.default_version || 0) === rollbackVersion
    || Number(family.active_version || 0) === rollbackVersion
    || Number(approvedRows[0]?.count || 0) > 0;
  const highRisk = workflowTemplateHighRisk(targetSpec, input) || ["high", "critical", "P0", "P1"].includes(String(family.risk_tier || ""));
  const requirements = [];
  if (!reason) requirements.push({ type: "rollback_reason", reason: "rollback requires an explicit reason" });
  if (!approvedTarget) requirements.push({ type: "approved_target", reason: "rollback target must be a previously active/default template version" });
  if (!hasCatBrain) requirements.push({ type: "cat_brain_review", reason: "Cat Brain review is required before template rollback" });
  if (!hasCatClaw) requirements.push({ type: "cat_claw_audit", reason: "Cat Claw audit is required before template rollback" });
  if (highRisk && !hasHumanGate) requirements.push({ type: "human_gate", reason: "High-risk template rollback requires Human Gate evidence" });
  return {
    operation: "workflow.template.rollback.preview",
    schemaVersion: "workflow_template_rollback_preview.v1",
    dryRun: true,
    previewOnly: true,
    valid: requirements.length === 0,
    requirements,
    highRisk,
    templateId,
    previousVersion,
    rollbackVersion,
    targetStatus: targetVersion.status || "",
    writes: []
  };
}

async function workflowTemplateRollbackRecord(rootDir, input = {}) {
  const preview = await workflowTemplateRollbackPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow template rollback blocked: ${preview.requirements.map((item) => item.type).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const templateId = preview.templateId;
  const previousVersion = preview.previousVersion;
  const rollbackVersion = preview.rollbackVersion;
  const eventId = safeId("template-event");
  const actor = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  await sqliteTransaction(paths.dbFile, `
UPDATE workflow_v2_template_specs
SET active_version=${sqlValue(rollbackVersion)},
    default_version=${sqlValue(rollbackVersion)},
    family_status='active',
    updated_at=${sqlValue(now)}
WHERE template_id=${sqlValue(templateId)};
UPDATE workflow_v2_template_versions
SET status='rolled_back', promotion_state='rolled_back'
WHERE template_id=${sqlValue(templateId)} AND version=${sqlValue(previousVersion)};
UPDATE workflow_v2_template_versions
SET status='default', promotion_state='default'
WHERE template_id=${sqlValue(templateId)} AND version=${sqlValue(rollbackVersion)};
INSERT INTO workflow_v2_template_events(event_id, template_id, version, event_type, previous_version, next_version, status, actor, human_gate_id, cat_brain_audit_id, cat_claw_audit_id, evidence_refs_json, payload_json, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(templateId)}, ${sqlValue(rollbackVersion)}, 'rolled_back', ${sqlValue(previousVersion)}, ${sqlValue(rollbackVersion)}, 'default', ${sqlValue(actor)}, ${sqlValue(firstText(input.humanGateId, input.human_gate_id))}, ${sqlValue(firstText(input.catBrainAuditId, input.cat_brain_audit_id, input.catBrainReviewId, input.cat_brain_review_id))}, ${sqlValue(firstText(input.catClawAuditId, input.cat_claw_audit_id, input.secretaryAuditId, input.secretary_audit_id))}, ${sqlValue(JSON.stringify(toList(input.evidenceRefs || input.evidence_refs)))}, ${sqlValue(JSON.stringify({ artifactsDeleted: false, highRisk: preview.highRisk, rollbackReason: firstText(input.rollbackReason, input.rollback_reason, input.reason, input.summary) }))}, ${sqlValue(now)});`);
  await workflowTemplateStatsRefresh(rootDir, { ...input, templateId });
  return {
    operation: "workflow.template.rollback.record",
    schemaVersion: "workflow_template_rollback_result.v1",
    templateId,
    previousVersion,
    rollbackVersion,
    artifactsDeleted: false,
    eventId,
    dbFile: paths.dbFile
  };
}

async function workflowTemplateExtractPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = firstText(input.workflowId, input.workflow_id);
  if (!workflowId) throw new Error("workflowId is required for template extraction");
  const sideEffects = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed');`, { json: true });
  if (Number(sideEffects[0]?.count || 0) > 0 && !boolOption(input.negativeTemplate || input.negative_template, false)) {
    throw new Error("template extraction refused: unresolved side-effect uncertainty");
  }
  const planRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(workflowId)}
${input.planId || input.plan_id ? `AND plan_id=${sqlValue(input.planId || input.plan_id)}` : ""}
ORDER BY updated_at DESC
LIMIT 1;`, { json: true });
  const plan = planRows[0];
  if (!plan) throw new Error(`workflow v2 plan not found for extraction: ${workflowId}`);
  const ownerReviews = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_owner_reviews
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(plan.plan_id)}
  AND decision IN ('accepted','needs_human_gate')
ORDER BY created_at DESC
LIMIT 1;`, { json: true });
  if (!ownerReviews[0] && !boolOption(input.allowWithoutOwnerReview || input.allow_without_owner_review, false)) {
    throw new Error("template extraction requires successful owner review or explicit allowWithoutOwnerReview for a dry candidate");
  }
  const nodes = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plan_nodes
WHERE plan_id=${sqlValue(plan.plan_id)}
ORDER BY created_at ASC;`, { json: true });
  const templateId = firstText(input.templateId, input.template_id, `template.workflow.v2.${cleanFileSegment(plan.plan_id)}`);
  const skeleton = {
    workflowId: "{{workflowId}}",
    planId: "{{planId}}",
    objective: "{{objective}}",
    taskOwnerAgent: plan.task_owner_agent || "cat_heart",
    plannerAgent: plan.planner_agent || "main",
    participantManagers: parseJsonValue(plan.participant_managers_json, []),
    acceptanceCriteria: parseJsonValue(plan.acceptance_criteria_json, []),
    constraints: parseJsonValue(plan.constraints_json, {}),
    humanGateRequired: true,
    orchestration: parseJsonValue(plan.payload_json, {}).orchestration || {},
    nodes: nodes.map((node, index) => ({
      nodeId: `{{planId}}.node.${index + 1}`,
      nodeType: node.node_type,
      ownerAgent: node.owner_agent,
      runtimeBackend: node.runtime_backend,
      dependsOn: parseJsonValue(node.depends_on_json, []),
      payload: workflowTemplateRedact(parseJsonValue(node.payload_json, {}))
    }))
  };
  const spec = workflowTemplateNormalizeSpec({
    templateSpec: {
      schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
      templateId,
      version: workflowTemplateVersion(input.version, 1),
      status: "candidate",
      title: firstText(input.title, `Extracted template from ${plan.plan_id}`),
      description: firstText(input.description, `Candidate template extracted from successful workflow ${workflowId}.`),
      ownerAgent: firstText(input.ownerAgent, input.owner_agent, plan.task_owner_agent, "main"),
      tags: ["extracted", "workflow-v2", ...toList(input.tags)],
      variables: [
        { name: "workflowId", type: "string", required: true },
        { name: "planId", type: "string", required: true },
        { name: "objective", type: "string", required: true }
      ],
      riskPolicy: { riskTier: firstText(input.riskTier, input.risk_tier, "medium") },
      permissionPolicy: {},
      planSpecSkeleton: skeleton,
      evalPolicy: {},
      promotionPolicy: { autoPromote: false },
      rollbackPolicy: { restorePreviousDefault: true },
      audit: {
        sourceWorkflowId: workflowId,
        sourcePlanId: plan.plan_id,
        sourcePlanArtifactRef: plan.plan_spec_artifact_ref,
        sourcePlanArtifactHash: plan.plan_spec_artifact_hash,
        extractedAt: nowIso()
      }
    }
  }, { defaultStatus: "candidate" });
  const validation = workflowTemplateValidation(spec);
  return {
    operation: "workflow.template.extract.preview",
    schemaVersion: "workflow_template_extract_preview.v1",
    dryRun: true,
    previewOnly: true,
    valid: validation.valid,
    errors: validation.errors,
    advisoryChecks: validation.advisoryChecks,
    templateSpec: workflowTemplateRedact(spec),
    source: { workflowId, planId: plan.plan_id, ownerReviewId: ownerReviews[0]?.review_id || "", sideEffectUncertain: 0 },
    writes: []
  };
}

async function workflowTemplateExtractRecord(rootDir, input = {}) {
  const preview = await workflowTemplateExtractPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow template extraction is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const recorded = await workflowTemplateRecordCandidate(rootDir, {
    ...input,
    templateSpec: preview.templateSpec,
    sourceWorkflowId: preview.source.workflowId,
    sourcePlanId: preview.source.planId
  });
  return {
    operation: "workflow.template.extract.record",
    schemaVersion: "workflow_template_extract_result.v1",
    ...recorded,
    extractedStatus: "candidate"
  };
}


  return {
    workflowTemplatePreview,
    workflowTemplateDailyTradingCatalogPreview,
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
  };
}
