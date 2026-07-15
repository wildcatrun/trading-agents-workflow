import {
  workflowPaths
} from "../workflow/paths.js";
import {
  firstText,
  redactSensitiveForPersistence,
  safeId
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";
import {
  WORKFLOW_V2_HUMAN_GATE_INTERACTION_TYPES,
  WORKFLOW_V2_HUMAN_GATE_OPTION_KEYS,
  WORKFLOW_V2_HUMAN_GATE_PACKAGE_STATUSES,
  WORKFLOW_V2_HUMAN_GATE_SUBMISSION_KINDS
} from "./constants.js";
import {
  workflowV2CatClawAuditSummary,
  workflowV2HumanGatePackageSummary,
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NormalizeEnum,
  workflowV2UniqueTextList,
  workflowV2ValidationError
} from "./helpers.js";
import {
  workflowV2CatClawAuditRowById,
  workflowV2HumanGatePackageRow
} from "./human-gate-state.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 Human Gate action dependency missing: ${name}`);
  return value;
}

function contextNumber(context, name, fallback) {
  const value = Number(context?.[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function createWorkflowV2HumanGateActionHandlers(context = {}) {
  const auditHumanGatePlanDetails = requireContextFunction(context, "auditHumanGatePlanDetails");
  const auditHumanGatePlanOptions = requireContextFunction(context, "auditHumanGatePlanOptions");
  const auditHumanGatePrimaryLanguage = requireContextFunction(context, "auditHumanGatePrimaryLanguage");
  const combineHumanGateAudits = requireContextFunction(context, "combineHumanGateAudits");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const humanGateButtonIsControl = requireContextFunction(context, "humanGateButtonIsControl");
  const humanGateButtonOptions = requireContextFunction(context, "humanGateButtonOptions");
  const humanGateButtonRole = requireContextFunction(context, "humanGateButtonRole");
  const humanGatePlanOptionButtons = requireContextFunction(context, "humanGatePlanOptionButtons");
  const humanGateRequest = requireContextFunction(context, "humanGateRequest");
  const humanGateWebAppConfig = requireContextFunction(context, "humanGateWebAppConfig");
  const normalizeOptionalAgentId = requireContextFunction(context, "normalizeOptionalAgentId");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateForStage = requireContextFunction(context, "pendingHumanGateForStage");
  const workflowV2PatchPlanWorkflowState = requireContextFunction(context, "workflowV2PatchPlanWorkflowState");
  const HUMAN_GATE_APPROVE_OPTION_MIN = contextNumber(context, "humanGateApproveOptionMin", 2);
  const HUMAN_GATE_APPROVE_OPTION_MAX = contextNumber(context, "humanGateApproveOptionMax", 5);

function workflowV2PackageAuditCheck(key, pass, detail = "", extra = {}) {
  return {
    key,
    status: pass ? "pass" : "fail",
    detail,
    ...extra
  };
}

function workflowV2PackageOptionEvidenceRefs(option = {}) {
  return Array.from(new Set([
    ...workflowV2JsonArray(option.evidenceRefs ?? option.evidence_refs, []),
    ...workflowV2JsonArray(option.artifactRefs ?? option.artifact_refs, []),
    ...workflowV2JsonArray(option.sourceRefs ?? option.source_refs, []),
    ...workflowV2JsonArray(option.receiptRefs ?? option.receipt_refs, []),
    firstText(option.artifactRef, option.artifact_ref),
    firstText(option.receiptRef, option.receipt_ref)
  ].map((item) => String(item || "").trim()).filter(Boolean)));
}

function workflowV2PackageHasDeliveryPayload(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => workflowV2PackageHasDeliveryPayload(item));
  if (typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value)) {
    const normalized = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    if (["delivery", "deliver", "auto_deliver", "auto_delivery", "telegram_delivery", "runtime_dispatch", "message_flow_dispatch"].includes(normalized)) return true;
    if (workflowV2PackageHasDeliveryPayload(item)) return true;
  }
  return false;
}

function workflowV2PackageSensitiveRedactionChanged(value) {
  return JSON.stringify(redactSensitiveForPersistence(value)) !== JSON.stringify(value);
}

async function workflowV2CatClawPackageAuditPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const generatedAt = nowIso();
  const warnings = [];
  const inlinePackage = workflowV2JsonObject(input.humanGatePackage ?? input.human_gate_package ?? input.package, {});
  const hasInlinePackage = Object.keys(inlinePackage).length > 0;
  const packageSelectorId = firstText(input.packageId, input.package_id, input.humanGatePackageId, input.human_gate_package_id);
  const hasMixedSelectors = Boolean(packageSelectorId && hasInlinePackage);
  const packageRow = !hasInlinePackage && packageSelectorId ? await workflowV2HumanGatePackageRow(paths, { packageId: packageSelectorId }) : null;
  const pkg = packageRow
    ? workflowV2HumanGatePackageSummary(packageRow)
    : hasInlinePackage
      ? inlinePackage
      : {
          packageId: firstText(input.packageId, input.package_id, input.humanGatePackageId, input.human_gate_package_id),
          workflowId: firstText(input.workflowId, input.workflow_id),
          planId: firstText(input.planId, input.plan_id),
          sourceCatClawAuditId: firstText(input.sourceCatClawAuditId, input.source_cat_claw_audit_id, input.catClawAuditId, input.cat_claw_audit_id),
          catBrainAgent: firstText(input.catBrainAgent, input.cat_brain_agent, "main"),
          catClawAgent: firstText(input.catClawAgent, input.cat_claw_agent, "cat_claw"),
          status: firstText(input.status, "draft"),
          options: workflowV2JsonArray(input.options, []),
          requiredControls: workflowV2JsonArray(input.requiredControls ?? input.required_controls, []),
          evidenceRefs: workflowV2UniqueTextList(input.evidenceRefs ?? input.evidence_refs),
          payload: workflowV2JsonObject(input.payload, {})
        };
  const options = workflowV2JsonArray(pkg.options, []);
  const evidenceRefs = workflowV2UniqueTextList(pkg.evidenceRefs ?? pkg.evidence_refs);
  const requiredControls = workflowV2UniqueTextList(pkg.requiredControls ?? pkg.required_controls);
  const missingOptionDetails = [];
  const missingOptionEvidence = [];
  for (const [index, rawOption] of options.entries()) {
    const option = workflowV2JsonObject(rawOption, {});
    const optionId = firstText(option.optionId, option.option_id, option.id, `option_${index + 1}`);
    const hasDetails = Boolean(
      firstText(option.optionId, option.option_id, option.id)
      && firstText(option.title, option.name)
      && firstText(option.body, option.content, option.text, option.description)
      && firstText(option.summary)
      && firstText(option.prompt, option.nextAction, option.next_action)
      && firstText(option.rollback, option.rollbackPlan, option.rollback_plan, option.recovery, option.restore)
    );
    if (!hasDetails) missingOptionDetails.push(optionId);
    if (workflowV2PackageOptionEvidenceRefs(option).length === 0) missingOptionEvidence.push(optionId);
  }
  const deliveryPayloadPresent = workflowV2PackageHasDeliveryPayload(pkg);
  const sensitiveRedactionRequired = workflowV2PackageSensitiveRedactionChanged(pkg);
  if (sensitiveRedactionRequired) {
    warnings.push({ code: "sensitive_values_redacted_in_preview", detail: "Sensitive-looking package values were redacted from preview output; persisted package data should not contain raw tokens or credentials." });
  }
  const checks = [
    workflowV2PackageAuditCheck("exact_selector_or_inline_package", Boolean(packageSelectorId || hasInlinePackage) && !hasMixedSelectors, "preview requires exactly one selector source: packageId or inline humanGatePackage input", { packageSelectorId, hasInlinePackage }),
    workflowV2PackageAuditCheck("package_available", Boolean(packageRow || hasInlinePackage), "exact package row or inline package is available"),
    workflowV2PackageAuditCheck("workflow_scope_present", Boolean(firstText(pkg.workflowId, pkg.workflow_id) && firstText(pkg.planId, pkg.plan_id)), "package is bound to workflowId and planId"),
    workflowV2PackageAuditCheck("cat_claw_source_present", Boolean(firstText(pkg.sourceCatClawAuditId, pkg.source_cat_claw_audit_id)), "package references sourceCatClawAuditId"),
    workflowV2PackageAuditCheck("option_count_in_range", options.length >= HUMAN_GATE_APPROVE_OPTION_MIN && options.length <= HUMAN_GATE_APPROVE_OPTION_MAX, `package has ${options.length} approve options`, {
      min: HUMAN_GATE_APPROVE_OPTION_MIN,
      max: HUMAN_GATE_APPROVE_OPTION_MAX
    }),
    workflowV2PackageAuditCheck("option_details_present", missingOptionDetails.length === 0, "each option has id, title, body, summary, prompt, and rollback", { missingOptionIds: missingOptionDetails }),
    workflowV2PackageAuditCheck("option_evidence_present", missingOptionEvidence.length === 0, "each option has artifact/evidence/source/receipt refs", { missingOptionIds: missingOptionEvidence }),
    workflowV2PackageAuditCheck("package_evidence_present", evidenceRefs.length > 0, "package has evidenceRefs"),
    workflowV2PackageAuditCheck("controls_present", requiredControls.includes("pause") && requiredControls.includes("terminate"), "package keeps pause and terminate controls"),
    workflowV2PackageAuditCheck("delivery_boundary_clean", !deliveryPayloadPresent, "package does not carry delivery/runtime dispatch instructions"),
    workflowV2PackageAuditCheck("token_redaction_clean", !sensitiveRedactionRequired, "package preview does not expose raw token/secret-like values")
  ];
  const violations = checks
    .filter((check) => check.status !== "pass")
    .map((check) => workflowV2ValidationError(check.key, check.detail, check));
  return {
    schemaVersion: "workflow_v2_cat_claw_package_audit_preview.v1",
    action: "workflow.v2.cat_claw_package_audit.preview",
    preview: true,
    readOnly: true,
    generatedAt,
    valid: violations.length === 0,
    packageId: firstText(pkg.packageId, pkg.package_id),
    workflowId: firstText(pkg.workflowId, pkg.workflow_id),
    planId: firstText(pkg.planId, pkg.plan_id),
    sourceCatClawAuditId: firstText(pkg.sourceCatClawAuditId, pkg.source_cat_claw_audit_id),
    status: firstText(pkg.status),
    checks,
    violations,
    warnings,
    humanGatePackage: redactSensitiveForPersistence(pkg),
    wouldCreate: {
      humanGateRecords: 0,
      telegramOutbox: 0,
      telegramDeliveries: 0,
      runtimeDispatches: 0,
      workflowStatusUpdates: 0
    },
    limitations: [
      "Preview is read-only and does not create or mutate Human Gate packages, Human Gate requests, Telegram outbox rows, runtime dispatches, or workflow state.",
      "Cat Claw package audit preview checks structure and boundaries only; it does not make Flashcat decisions or complete Human Gate.",
      "Actual outward notification remains the separate governed workflow.v2.human_gate_request and telegram.outbox.delivery path."
    ],
    dbFile: paths.dbFile
  };
}

async function workflowV2HumanGatePackagePreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  if (!workflowId) errors.push(workflowV2ValidationError("workflow_id_required", "Human Gate package requires workflowId"));
  const sourceCatClawAuditId = firstText(input.sourceCatClawAuditId, input.source_cat_claw_audit_id, input.catClawAuditId, input.cat_claw_audit_id);
  let packagePlanId = firstText(input.planId, input.plan_id);
  let sourceCatClawAudit = null;
  let sourcePlanId = "";
  if (sourceCatClawAuditId) {
    const auditRow = await workflowV2CatClawAuditRowById(paths, sourceCatClawAuditId);
    if (!auditRow || auditRow.workflow_id !== workflowId) {
      errors.push(workflowV2ValidationError("cat_claw_audit_not_found", "Human Gate package sourceCatClawAuditId must reference a Cat Claw audit for the same workflow", { sourceCatClawAuditId }));
    } else if (auditRow.decision !== "protocol_ready") {
      errors.push(workflowV2ValidationError("cat_claw_audit_not_protocol_ready", "Human Gate package source Cat Claw audit must be protocol_ready", { sourceCatClawAuditId, decision: auditRow.decision }));
    } else if (packagePlanId && auditRow.plan_id !== packagePlanId) {
      errors.push(workflowV2ValidationError("cat_claw_audit_plan_mismatch", "Human Gate package sourceCatClawAuditId must reference a Cat Claw audit for the same plan", { sourceCatClawAuditId, expectedPlanId: packagePlanId, actualPlanId: auditRow.plan_id }));
    } else {
      sourceCatClawAudit = workflowV2CatClawAuditSummary(auditRow);
      sourcePlanId = auditRow.plan_id || "";
      packagePlanId = packagePlanId || sourcePlanId;
    }
  }
  const rawOptions = workflowV2JsonArray(input.options, []);
  const options = rawOptions.map((option, index) => {
    const item = workflowV2JsonObject(option, {});
    const title = firstText(item.title, `方案 ${index + 1}`);
    const body = firstText(item.body, item.content, item.summary);
    const prompt = firstText(item.prompt, item.nextAction, item.next_action, body);
    const rollback = firstText(item.rollback, item.rollbackPlan, item.rollback_plan, item.recovery, item.restore, "如该方案执行条件不满足，退回 task owner 重新汇总证据并恢复到上一 checkpoint。");
    return {
      optionId: firstText(item.optionId, item.option_id, `option_${index + 1}`),
      title,
      body,
      summary: firstText(item.summary, body, title),
      prompt,
      rollback,
      buttonStyle: "success",
      approvalPayload: workflowV2JsonObject(item.approvalPayload ?? item.approval_payload, {})
    };
  });
  if (options.length < HUMAN_GATE_APPROVE_OPTION_MIN) {
    errors.push(workflowV2ValidationError("human_gate_min_two_options_required", `Human Gate package must contain at least ${HUMAN_GATE_APPROVE_OPTION_MIN} independent approve options`));
  }
  if (!rawOptions.length) {
    errors.push(workflowV2ValidationError("human_gate_options_required", "Human Gate package options must be authored by task owner/Cat Brain evidence; Cat Claw package code must not generate default options"));
  }
  if (options.length > HUMAN_GATE_APPROVE_OPTION_MAX) {
    errors.push(workflowV2ValidationError("human_gate_max_five_options_required", `Human Gate package must contain at most ${HUMAN_GATE_APPROVE_OPTION_MAX} independent approve options`));
  }
  const incompleteOptionIds = options
    .filter((option) => !option.optionId || !option.title || !option.body || !option.summary || !option.prompt || !option.rollback)
    .map((option) => option.optionId || option.title || "<unknown>");
  if (incompleteOptionIds.length) {
    errors.push(workflowV2ValidationError("human_gate_option_details_required", "Human Gate package options require optionId, title, body, summary, prompt, and rollback", { incompleteOptionIds }));
  }
  const rawStatus = firstText(input.status);
  const defaultStatus = sourceCatClawAuditId ? "cat_claw_audited" : "draft";
  const normalizedStatus = workflowV2NormalizeEnum(rawStatus, WORKFLOW_V2_HUMAN_GATE_PACKAGE_STATUSES, defaultStatus);
  if (rawStatus) {
    const rawNormalized = rawStatus.trim().toLowerCase().replace(/-/g, "_");
    if (!WORKFLOW_V2_HUMAN_GATE_PACKAGE_STATUSES.has(rawNormalized)) {
      errors.push(workflowV2ValidationError("human_gate_package_status_invalid", "Human Gate package status is limited to draft or cat_claw_audited in the local v2 control-plane slice", { status: rawStatus }));
    }
  }
  if (normalizedStatus === "cat_claw_audited" && !sourceCatClawAuditId) {
    errors.push(workflowV2ValidationError("source_cat_claw_audit_required", "cat_claw_audited Human Gate package requires sourceCatClawAuditId"));
  }
  const packagePreview = {
    packageId: firstText(input.packageId, input.package_id) || safeId("v2-hgate"),
    workflowId,
    planId: packagePlanId,
    sourceReviewId: firstText(input.sourceReviewId, input.source_review_id),
    sourceCatClawAuditId,
    catBrainAgent: normalizeOptionalAgentId(firstText(input.catBrainAgent, input.cat_brain_agent, "main")) || "main",
    catClawAgent: normalizeOptionalAgentId(firstText(input.catClawAgent, input.cat_claw_agent, "cat_claw")) || "cat_claw",
    status: normalizedStatus,
    options,
    requiredControls: ["pause", "terminate"],
    controls: [
      { controlId: "pause_workflow", title: "暂停工作流", buttonStyle: "primary", decision: "paused" },
      { controlId: "terminate_workflow", title: "终止工作流", buttonStyle: "danger", decision: "terminated" }
    ],
    evidenceRefs: workflowV2UniqueTextList(input.evidenceRefs ?? input.evidence_refs, sourceCatClawAudit?.evidenceRefs || []),
    payload: {
      ...workflowV2JsonObject(input.payload, {}),
      sourceCatClawAuditId: sourceCatClawAuditId || "",
      sourcePlanId: packagePlanId
    },
    sourceCatClawAudit
  };
  return {
    operation: "workflow.v2.human_gate_package.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    humanGatePackage: packagePreview,
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2HumanGatePackageRecord(rootDir, input = {}) {
  const preview = await workflowV2HumanGatePackagePreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 Human Gate package is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const pkg = preview.humanGatePackage;
  const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_human_gate_packages(package_id, workflow_id, plan_id, source_review_id, source_cat_claw_audit_id, cat_brain_agent, cat_claw_agent, status, options_json, required_controls_json, evidence_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(pkg.packageId)}, ${sqlValue(pkg.workflowId)}, ${sqlValue(pkg.planId)}, ${sqlValue(pkg.sourceReviewId)}, ${sqlValue(pkg.sourceCatClawAuditId)}, ${sqlValue(pkg.catBrainAgent)}, ${sqlValue(pkg.catClawAgent)}, ${sqlValue(pkg.status)}, ${sqlValue(JSON.stringify(pkg.options))}, ${sqlValue(JSON.stringify(pkg.requiredControls))}, ${sqlValue(JSON.stringify(pkg.evidenceRefs))}, ${sqlValue(JSON.stringify({ ...pkg.payload, controls: pkg.controls }))}, ${sqlValue(createdBy)}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(package_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  source_review_id=excluded.source_review_id,
  source_cat_claw_audit_id=excluded.source_cat_claw_audit_id,
  cat_brain_agent=excluded.cat_brain_agent,
  cat_claw_agent=excluded.cat_claw_agent,
  status=excluded.status,
  options_json=excluded.options_json,
  required_controls_json=excluded.required_controls_json,
  evidence_refs_json=excluded.evidence_refs_json,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  if (pkg.planId) {
    await workflowV2PatchPlanWorkflowState(paths, pkg.workflowId, pkg.planId, pkg.status === "cat_claw_audited" ? "human_gate_request_due" : "waiting_cat_claw_audit", now);
  }
  return { ...preview, operation: "workflow.v2.human_gate_package.record", dryRun: false, previewOnly: false, dbFile: paths.dbFile };
}

function workflowV2HumanGateRequestInputFromPackage(pkg = {}, input = {}) {
  const packagePayload = workflowV2JsonObject(pkg.payload, {});
  const submissionKind = workflowV2NormalizeEnum(
    input.submissionKind ?? input.submission_kind ?? packagePayload.submissionKind ?? packagePayload.submission_kind,
    WORKFLOW_V2_HUMAN_GATE_SUBMISSION_KINDS,
    "task_output"
  );
  const interactionType = workflowV2NormalizeEnum(
    input.interactionType ?? input.interaction_type ?? packagePayload.interactionType ?? packagePayload.interaction_type,
    WORKFLOW_V2_HUMAN_GATE_INTERACTION_TYPES,
    "approval"
  );
  const responseSchema = workflowV2JsonObject(
    input.responseSchema ?? input.response_schema ?? packagePayload.responseSchema ?? packagePayload.response_schema,
    {
      required: ["buttonSelection", "flashcatOriginalWords"],
      flashcatOriginalWordsRequired: true,
      fields: [
        { name: "buttonSelection", type: "button", required: true },
        { name: "flashcatOriginalWords", type: "text", required: true }
      ]
    }
  );
  const resumeContract = {
    sourcePackageId: pkg.packageId,
    sourcePlanId: pkg.planId,
    completionAction: "human_gate.resume",
    approved: "resume_workflow_from_selected_option",
    rejected: "return_to_task_owner_or_cat_brain",
    paused: "pause_workflow",
    terminated: "closeout_and_archive",
    ...workflowV2JsonObject(input.resumeContract ?? input.resume_contract ?? packagePayload.resumeContract ?? packagePayload.resume_contract, {})
  };
  const evidenceRefs = Array.isArray(pkg.evidenceRefs) ? pkg.evidenceRefs : [];
  const artifactRef = firstText(input.artifactRef, input.artifact_ref, evidenceRefs[0], `workflow_v2_human_gate_package:${pkg.packageId}`);
  const optionButtons = (Array.isArray(pkg.options) ? pkg.options : []).map((rawOption, index) => {
    const option = workflowV2JsonObject(rawOption, {});
    const optionKey = WORKFLOW_V2_HUMAN_GATE_OPTION_KEYS[index] || String(index + 1);
    const title = firstText(option.title, option.name, `方案 ${optionKey}`);
    const body = firstText(option.body, option.content, option.text, option.description, title);
    const summary = firstText(option.summary, body, title);
    const prompt = firstText(option.prompt, option.nextAction, option.next_action, body, summary);
    const rollback = firstText(option.rollback, option.rollbackPlan, option.rollback_plan, option.recovery, option.restore, "如该方案执行条件不满足，退回 task owner 补齐证据并恢复到上一 checkpoint。");
    return {
      optionId: firstText(option.optionId, option.option_id, option.id, `option_${index + 1}`),
      optionKey,
      title,
      summary,
      prompt,
      rollback,
      artifactRef: firstText(option.artifactRef, option.artifact_ref, artifactRef),
      payload: {
        ...workflowV2JsonObject(option.approvalPayload ?? option.approval_payload, {}),
        optionId: firstText(option.optionId, option.option_id, option.id, `option_${index + 1}`),
        optionKey,
        workflowV2HumanGatePackageId: pkg.packageId,
        workflowId: pkg.workflowId,
        planId: pkg.planId,
        submissionKind,
        interactionType,
        sourceCatClawAuditId: pkg.sourceCatClawAuditId,
        evidenceRefs,
        rollback
      }
    };
  });
  const evidenceText = evidenceRefs.length ? `证据/回执：${evidenceRefs.slice(0, 8).join("；")}` : "证据/回执：已记录在 v2 Human Gate package payload 中。";
  const defaultText = [
    `猫爪正式汇报：workflow ${pkg.workflowId} 的 v2 plan ${pkg.planId} 已完成 task owner 汇总、task group 产出、猫之脑治理审计和猫爪协议审计。`,
    `提交类型：${submissionKind}；交互类型：${interactionType}。Human Gate 在这里是受治理的人类交互边界，不只是 approval 开关。`,
    "请闪电猫选择一个可批准方案，并在按钮表单中填写闪电猫原话/审核意见。按钮选择和原话绑定后，Human Gate 才正式完成并恢复 workflow。",
    evidenceText
  ].join("\n");
  return {
    workflowId: pkg.workflowId,
    meetingId: firstText(input.meetingId, input.meeting_id, pkg.workflowId),
    gateType: firstText(input.gateType, input.gate_type, "workflow_v2_task_delivery"),
    humanGateStageKey: firstText(input.humanGateStageKey, input.human_gate_stage_key, input.stageKey, input.stage_key, `workflow-v2:${pkg.planId}:${pkg.packageId}`),
    submissionKind,
    interactionType,
    responseSchema,
    resumeContract,
    title: firstText(input.title, `v2 workflow Human Gate：${pkg.planId}`),
    summary: firstText(input.summary, input.text, defaultText),
    text: firstText(input.text, input.reportText, input.report_text, defaultText),
    artifactRef,
    buttons: optionButtons,
    addDefaultControls: true,
    from: "cat_claw",
    sourceAgent: "cat_claw",
    actor: firstText(input.actor, input.callerAgent, input.caller_agent, input.createdBy, input.created_by, "cat_claw"),
    autoDeliver: false,
    auto_deliver: false,
    deliver: false,
    humanGateId: firstText(input.humanGateId, input.human_gate_id, input.requestHumanGateId, input.request_human_gate_id),
    targetKind: firstText(input.targetKind, input.target_kind),
    targetRef: firstText(input.targetRef, input.target_ref, input.target, input.chatId, input.chat_id, input.notifyTargets, input.notify_targets),
    payload: {
      workflowV2HumanGatePackageId: pkg.packageId,
      workflowId: pkg.workflowId,
      planId: pkg.planId,
      submissionKind,
      interactionType,
      responseSchema,
      resumeContract,
      sourceReviewId: pkg.sourceReviewId,
      sourceCatClawAuditId: pkg.sourceCatClawAuditId,
      catBrainAgent: pkg.catBrainAgent,
      catClawAgent: pkg.catClawAgent,
      evidenceRefs,
      requiredControls: pkg.requiredControls,
      controls: packagePayload.controls || [],
      packagePayload,
      writeBoundary: "human_gate_request_only"
    }
  };
}

async function workflowV2HumanGateRequestPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const generatedAt = nowIso();
  const violations = [];
  const writeViolations = [];
  const warnings = [];
  const requestedWorkflowId = firstText(input.workflowId, input.workflow_id);
  const requestedPlanId = firstText(input.planId, input.plan_id);
  const packageSelectorId = firstText(input.packageId, input.package_id, input.humanGatePackageId, input.human_gate_package_id);
  const sourceAuditSelectorId = firstText(input.sourceCatClawAuditId, input.source_cat_claw_audit_id, input.catClawAuditId, input.cat_claw_audit_id);
  const hasSelector = Boolean(packageSelectorId);
  if (!packageSelectorId) {
    violations.push(workflowV2ValidationError("human_gate_package_selector_required", "v2 Human Gate request preview requires an exact packageId selector"));
  }
  const packageRow = hasSelector ? await workflowV2HumanGatePackageRow(paths, input) : null;
  if (hasSelector && !packageRow) {
    violations.push(workflowV2ValidationError("human_gate_package_not_found", "No v2 Human Gate package matched the selector"));
  }
  const pkg = packageRow ? workflowV2HumanGatePackageSummary(packageRow) : null;
  if (pkg && requestedWorkflowId && pkg.workflowId !== requestedWorkflowId) {
    violations.push(workflowV2ValidationError("workflow_mismatch", "v2 Human Gate package workflowId does not match request", { expectedWorkflowId: requestedWorkflowId, actualWorkflowId: pkg.workflowId }));
  }
  if (pkg && requestedPlanId && pkg.planId !== requestedPlanId) {
    violations.push(workflowV2ValidationError("plan_mismatch", "v2 Human Gate package planId does not match request", { expectedPlanId: requestedPlanId, actualPlanId: pkg.planId }));
  }
  if (pkg && sourceAuditSelectorId && pkg.sourceCatClawAuditId !== sourceAuditSelectorId) {
    violations.push(workflowV2ValidationError("source_cat_claw_audit_mismatch", "v2 Human Gate package sourceCatClawAuditId does not match request", { expectedSourceCatClawAuditId: sourceAuditSelectorId, actualSourceCatClawAuditId: pkg.sourceCatClawAuditId }));
  }
  if (pkg && pkg.status !== "cat_claw_audited") {
    violations.push(workflowV2ValidationError("human_gate_package_not_cat_claw_audited", "Formal Human Gate request requires a cat_claw_audited v2 package", { packageId: pkg.packageId, status: pkg.status }));
  }
  if (pkg && !pkg.sourceCatClawAuditId) {
    violations.push(workflowV2ValidationError("source_cat_claw_audit_required", "Formal Human Gate request requires sourceCatClawAuditId on the v2 package", { packageId: pkg.packageId }));
  }
  const packagePayloadForMetadata = workflowV2JsonObject(pkg?.payload, {});
  const rawSubmissionKind = firstText(input.submissionKind, input.submission_kind, packagePayloadForMetadata.submissionKind, packagePayloadForMetadata.submission_kind);
  if (rawSubmissionKind && !WORKFLOW_V2_HUMAN_GATE_SUBMISSION_KINDS.has(rawSubmissionKind.trim().toLowerCase().replace(/-/g, "_"))) {
    violations.push(workflowV2ValidationError("submission_kind_invalid", "v2 Human Gate submissionKind is not supported", { submissionKind: rawSubmissionKind }));
  }
  const rawInteractionType = firstText(input.interactionType, input.interaction_type, packagePayloadForMetadata.interactionType, packagePayloadForMetadata.interaction_type);
  if (rawInteractionType && !WORKFLOW_V2_HUMAN_GATE_INTERACTION_TYPES.has(rawInteractionType.trim().toLowerCase().replace(/-/g, "_"))) {
    violations.push(workflowV2ValidationError("interaction_type_invalid", "v2 Human Gate interactionType is not supported", { interactionType: rawInteractionType }));
  }
  let sourceCatClawAudit = null;
  if (pkg?.sourceCatClawAuditId) {
    const sourceRow = await workflowV2CatClawAuditRowById(paths, pkg.sourceCatClawAuditId);
    if (!sourceRow) {
      violations.push(workflowV2ValidationError("source_cat_claw_audit_not_found", "sourceCatClawAuditId does not reference an existing Cat Claw audit", { sourceCatClawAuditId: pkg.sourceCatClawAuditId }));
    } else if (sourceRow.workflow_id !== pkg.workflowId || sourceRow.plan_id !== pkg.planId) {
      violations.push(workflowV2ValidationError("source_cat_claw_audit_scope_mismatch", "source Cat Claw audit must match the v2 package workflow and plan", { sourceCatClawAuditId: pkg.sourceCatClawAuditId }));
    } else if (sourceRow.decision !== "protocol_ready") {
      violations.push(workflowV2ValidationError("source_cat_claw_audit_not_protocol_ready", "source Cat Claw audit must be protocol_ready before Human Gate request", { sourceCatClawAuditId: pkg.sourceCatClawAuditId, decision: sourceRow.decision }));
    } else {
      sourceCatClawAudit = workflowV2CatClawAuditSummary(sourceRow);
    }
  }
  const callerAgent = normalizeOptionalAgentId(firstText(input.callerAgent, input.caller_agent, input.actor, input.createdBy, input.created_by, "cat_claw")) || "cat_claw";
  if (callerAgent !== "cat_claw") {
    writeViolations.push(workflowV2ValidationError("caller_agent_not_authorized", "Formal v2 Human Gate request must be submitted by cat_claw", { callerAgent }));
  }
  const requestInput = pkg ? workflowV2HumanGateRequestInputFromPackage(pkg, { ...input, actor: callerAgent, callerAgent }) : null;
  const buttons = requestInput ? humanGateButtonOptions(requestInput) : [];
  const audit = requestInput ? combineHumanGateAudits(
    auditHumanGatePlanOptions(buttons),
    auditHumanGatePlanDetails(buttons),
    auditHumanGatePrimaryLanguage(requestInput, buttons)
  ) : { ok: false, reason: "human_gate_package_not_available", audits: [] };
  if (requestInput && !audit.ok) {
    violations.push(workflowV2ValidationError("human_gate_audit_failed", audit.reason || "Human Gate request draft does not satisfy button-first audit"));
  }
  const webApp = await humanGateWebAppConfig(input);
  if (!webApp.enabled) {
    warnings.push({ code: "web_app_base_url_missing", detail: "Token-bound Telegram Web App base URL is not configured; formal delivery will rely on governed token fallback until configured." });
  }
  const eligible = violations.length === 0;
  const writeReady = eligible && writeViolations.length === 0;
  const stageMatch = eligible ? await pendingHumanGateForStage(paths, {
    workflowId: requestInput.workflowId,
    gateType: requestInput.gateType,
    stageKey: requestInput.humanGateStageKey
  }) : null;
  const planButtons = humanGatePlanOptionButtons(buttons);
  const controlRoles = new Set(buttons.filter((button) => humanGateButtonIsControl(button)).map((button) => humanGateButtonRole(button)));
  return {
    schemaVersion: "workflow_v2_human_gate_request_preview.v1",
    action: "workflow.v2.human_gate_request.preview",
    preview: true,
    readOnly: true,
    generatedAt,
    workflowId: pkg?.workflowId || requestedWorkflowId,
    planId: pkg?.planId || requestedPlanId,
    packageId: pkg?.packageId || packageSelectorId,
    sourceCatClawAuditId: pkg?.sourceCatClawAuditId || sourceAuditSelectorId,
    submissionKind: requestInput?.submissionKind || "",
    interactionType: requestInput?.interactionType || "",
    responseSchema: requestInput?.responseSchema || null,
    resumeContract: requestInput?.resumeContract || null,
    eligible,
    requestReady: eligible,
    writeReady,
    audit,
    buttonSummary: {
      total: buttons.length,
      planCount: planButtons.length,
      planCountMin: HUMAN_GATE_APPROVE_OPTION_MIN,
      planCountMax: HUMAN_GATE_APPROVE_OPTION_MAX,
      hasPause: controlRoles.has("pause"),
      hasTerminate: controlRoles.has("terminate"),
      hasReject: controlRoles.has("reject")
    },
    wouldCreate: {
      humanGateRecords: eligible && !stageMatch ? 1 : 0,
      humanGateButtons: eligible && !stageMatch ? buttons.length : 0,
      meetingControlEvents: eligible ? 1 : 0,
      telegramOutbox: eligible && !stageMatch ? 1 : 0,
      workflowEvents: eligible ? 1 : 0,
      runtimeDispatches: 0,
      telegramDeliveries: 0,
      workflowStatusUpdates: eligible ? 1 : 0
    },
    existingPendingHumanGateId: stageMatch?.row?.object_id || "",
    requestDraft: requestInput ? redactSensitiveForPersistence({
      action: "human_gate.request",
      workflowId: requestInput.workflowId,
      meetingId: requestInput.meetingId,
      gateType: requestInput.gateType,
      humanGateStageKey: requestInput.humanGateStageKey,
      submissionKind: requestInput.submissionKind,
      interactionType: requestInput.interactionType,
      responseSchema: requestInput.responseSchema,
      resumeContract: requestInput.resumeContract,
      title: requestInput.title,
      summary: requestInput.summary,
      text: requestInput.text,
      artifactRef: requestInput.artifactRef,
      buttons
    }) : null,
    requestInput,
    humanGatePackage: pkg,
    sourceCatClawAudit,
    violations: [...violations, ...writeViolations],
    writeViolations,
    warnings,
    limitations: [
      "Preview is read-only and does not create Human Gate records, buttons, Telegram outbox, workflow events, or runtime dispatches.",
      "Execution creates only the formal pending Human Gate request and queued Telegram outbox; actual delivery stays under telegram.outbox.delivery governance.",
      "Human Gate completion remains button-first via human_gate.resume / Web App feedback and is not represented by workflow_v2_human_gate_packages status."
    ],
    dbFile: paths.dbFile
  };
}

async function workflowV2HumanGateRequest(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const preview = await workflowV2HumanGateRequestPreview(rootDir, input);
  if (!preview.eligible) {
    throw new Error(`v2 Human Gate request is not eligible: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  if (!preview.writeReady) {
    throw new Error(`v2 Human Gate request is not write-ready: ${(preview.writeViolations || preview.violations || []).map((item) => item.code).join(",") || "unknown"}`);
  }
  const requestInput = {
    ...preview.requestInput,
    actor: input.actor || permissionDecision?.caller?.agentId || preview.requestInput.actor || "cat_claw"
  };
  const result = await humanGateRequest(rootDir, requestInput);
  const linkedAt = nowIso();
  const currentPayload = workflowV2JsonObject(preview.humanGatePackage?.payload, {});
  const currentLink = workflowV2JsonObject(currentPayload.humanGateRequest, {});
  const linkage = {
    humanGateId: result.humanGateId,
    gateType: result.gateType,
    stageKey: result.stageKey,
    submissionKind: preview.submissionKind,
    interactionType: preview.interactionType,
    responseSchema: preview.responseSchema,
    resumeContract: preview.resumeContract,
    telegramOutboxId: result.telegramOutbox?.outboxId || "",
    telegramOutboxStatus: result.telegramOutbox?.status || "",
    requestedAt: linkedAt,
    reusedStageGate: Boolean(result.reusedStageGate),
    deliveryRequired: Boolean(result.deliveryRequired)
  };
  const packageLinkReused = currentLink.humanGateId === result.humanGateId
    && currentLink.gateType === result.gateType
    && currentLink.stageKey === result.stageKey;
  if (!packageLinkReused) {
    await sqlite(paths.dbFile, `
UPDATE workflow_v2_human_gate_packages
SET payload_json=${sqlValue(JSON.stringify({
      ...currentPayload,
      humanGateRequest: linkage,
      humanGateRequestHistory: [
        ...workflowV2JsonArray(currentPayload.humanGateRequestHistory, []).slice(-9),
        linkage
      ]
    }))},
    updated_at=${sqlValue(linkedAt)}
WHERE package_id=${sqlValue(preview.packageId)};`);
  }
  if (preview.workflowId && preview.planId) {
    await workflowV2PatchPlanWorkflowState(paths, preview.workflowId, preview.planId, "waiting_human", linkedAt);
  }
  return {
    schemaVersion: "workflow_v2_human_gate_request_result.v1",
    action: "workflow.v2.human_gate_request",
    workflowId: result.workflowId,
    planId: preview.planId,
    packageId: preview.packageId,
    sourceCatClawAuditId: preview.sourceCatClawAuditId,
    submissionKind: preview.submissionKind,
    interactionType: preview.interactionType,
    responseSchema: preview.responseSchema,
    resumeContract: preview.resumeContract,
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
    didUpdateWorkflowStatus: true,
    didLinkPackage: true,
    didWritePackageLink: !packageLinkReused,
    packageLinkReused,
    deliveryRequired: Boolean(result.deliveryRequired),
    targetKind: result.targetKind,
    targetRef: result.targetRef,
    buttons: result.buttons || [],
    dbFile: result.dbFile
  };
}

return {
  workflowV2CatClawPackageAuditPreview,
  workflowV2HumanGatePackagePreview,
  workflowV2HumanGatePackageRecord,
  workflowV2HumanGateRequestPreview,
  workflowV2HumanGateRequest
};
}
