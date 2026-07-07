import fs from "node:fs/promises";
import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const INCIDENT_ACTION_HANDLER_NAMES = {
  "incident.state": "incidentState",
  "workflow.incident": "incidentState",
  "workflow.incident.from_dead_letter.preview": "workflowIncidentFromDeadLetterPreview",
  "workflow.incident.from_dead_letter": "workflowIncidentFromDeadLetter",
  "workflow.incident.closeout.cat_claw_report.preview": "workflowIncidentCloseoutPreview",
  "workflow.incident.closeout.human_gate_package.preview": "workflowIncidentCloseoutPreview",
  "workflow.incident.closeout.worklist.preview": "workflowIncidentCloseoutWorklistPreview",
  "workflow.incident.closeout.worklist.artifact.preview": "workflowIncidentCloseoutWorklistArtifactPreview",
  "workflow.incident.closeout.evidence.preview": "workflowIncidentCloseoutEvidencePreview",
  "workflow.incident.closeout.artifact.preview": "workflowIncidentCloseoutArtifactPreview",
  "workflow.incident.closeout.human_gate_request.preview": "workflowIncidentCloseoutHumanGateRequestPreview",
  "workflow.incident.closeout.worklist.artifact": "workflowIncidentCloseoutWorklistArtifact",
  "workflow.incident.closeout.evidence": "workflowIncidentCloseoutEvidence",
  "workflow.incident.closeout.artifact": "workflowIncidentCloseoutArtifact",
  "workflow.incident.closeout.human_gate_request": "workflowIncidentCloseoutHumanGateRequest"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`incident action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`incident action dependency missing: ${name}`);
  return context[name];
}

export function createIncidentActionRegistry(handlers = {}) {
  const entries = Object.entries(INCIDENT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing incident action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runIncidentAction(registry, action, rootDir, input = {}, permissionDecision = null) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input, permissionDecision) };
}

export function createIncidentActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const auditHumanGatePlanDetails = requireContextFunction(context, "auditHumanGatePlanDetails");
  const auditHumanGatePlanOptions = requireContextFunction(context, "auditHumanGatePlanOptions");
  const auditHumanGatePrimaryLanguage = requireContextFunction(context, "auditHumanGatePrimaryLanguage");
  const canonicalWorkflowAction = requireContextFunction(context, "canonicalWorkflowAction");
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const combineHumanGateAudits = requireContextFunction(context, "combineHumanGateAudits");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const firstText = requireContextFunction(context, "firstText");
  const humanGateButtonIsControl = requireContextFunction(context, "humanGateButtonIsControl");
  const humanGateButtonOptions = requireContextFunction(context, "humanGateButtonOptions");
  const humanGateButtonRole = requireContextFunction(context, "humanGateButtonRole");
  const humanGatePlanOptionButtons = requireContextFunction(context, "humanGatePlanOptionButtons");
  const humanGateRequest = requireContextFunction(context, "humanGateRequest");
  const humanGateWebAppConfig = requireContextFunction(context, "humanGateWebAppConfig");
  const nowIso = requireContextFunction(context, "nowIso");
  const parseJsonValue = requireContextFunction(context, "parseJsonValue");
  const permissionEvidencePresent = requireContextFunction(context, "permissionEvidencePresent");
  const redactSensitiveForPersistence = requireContextFunction(context, "redactSensitiveForPersistence");
  const redactSensitiveTextForPersistence = requireContextFunction(context, "redactSensitiveTextForPersistence");
  const renderIncidentMarkdown = requireContextFunction(context, "renderIncidentMarkdown");
  const safeId = requireContextFunction(context, "safeId");
  const textHash = requireContextFunction(context, "textHash");
  const toList = requireContextFunction(context, "toList");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");
  const WorkflowReadModel = requireContextFunction(context, "WorkflowReadModel");
  const HUMAN_GATE_APPROVE_OPTION_MAX = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MAX");
  const HUMAN_GATE_APPROVE_OPTION_MIN = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MIN");
  const INCIDENT_MODES = requireContextValue(context, "INCIDENT_MODES");
  const INCIDENT_STATUSES = requireContextValue(context, "INCIDENT_STATUSES");

  async function incidentState(rootDir, input = {}) {
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
      `由猫爪确认 ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} 个方案、暂停、终止按钮结构和中文格式正文完整。`,
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

function closeoutWorklistRecommendation(closeout = {}) {
  const failed = (closeout.checklist || []).filter((row) => row.status === "fail" && row.severity !== "warning");
  const missing = failed.map((row) => row.key).filter(Boolean);
  if (!closeout.selectedIncident) return "inspect_incident_linkage";
  if (missing.some((key) => ["human_gate_evidence", "cat_claw_audit", "operator_reason", "rollback_boundary"].includes(key))) {
    return "workflow.incident.closeout.evidence.preview";
  }
  if (missing.length) return "workflow.incident.closeout.cat_claw_report.preview";
  return "workflow.incident.closeout.human_gate_package.preview";
}

function incidentPayloadWorkflowRef(payload = {}) {
  return firstText(
    payload.workflowId,
    payload.workflow_id,
    payload.workflow?.workflowId,
    payload.workflow?.id,
    payload.payload?.workflowId,
    payload.payload?.workflow_id,
    payload.payload?.workflow?.id,
    payload.raw?.workflowId,
    payload.raw?.workflow_id,
    payload.deadLetter?.workflowId,
    payload.deadLetter?.workflow_id,
    payload.closeoutEvidence?.workflowId,
    payload.closeoutEvidence?.workflow_id
  );
}

async function workflowIncidentCloseoutWorklistPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required for closeout worklist preview");
  const limit = Math.max(1, Math.min(200, Number(input.limit || input.incidentLimit || input.incident_limit || 80)));
  const staleAfterMs = Math.max(60_000, Math.min(90 * 86400000, Number(input.staleIncidentAfterMs || input.stale_incident_after_ms || 24 * 3600000)));
  const staleCutoff = new Date(Date.now() - staleAfterMs).toISOString();
  const rows = await sqlite(paths.dbFile, `
SELECT incident_id, status, mode, summary, commander, declared_at, updated_at, payload_json
FROM incident_states
WHERE status IN ('active','mitigating','monitoring')
ORDER BY updated_at ASC, declared_at ASC
LIMIT ${limit};`, { json: true });
  const readModel = new WorkflowReadModel({ dbFile: paths.dbFile });
  const items = [];
  let rejectedByScope = 0;
  for (const row of rows) {
    const closeout = await readModel.incidentCloseout(workflowId, {
      incidentId: row.incident_id,
      limit: input.timelineLimit || input.timeline_limit || 80
    });
    if (!closeout.selectedIncident) {
      rejectedByScope += 1;
      continue;
    }
    const failed = (closeout.checklist || []).filter((item) => item.status === "fail" && item.severity !== "warning");
    const warnings = (closeout.checklist || []).filter((item) => item.status === "warn" || item.severity === "warning");
    const payload = parseJsonValue(row.payload_json, {});
    items.push(redactSensitiveForPersistence({
      incidentId: row.incident_id,
      workflowId,
      status: row.status || "",
      mode: row.mode || "",
      summary: row.summary || "",
      commander: row.commander || "",
      declaredAt: row.declared_at || "",
      updatedAt: row.updated_at || "",
      stale: !row.updated_at || String(row.updated_at) < staleCutoff,
      payloadWorkflowId: incidentPayloadWorkflowRef(payload),
      closeoutStatus: closeout.status || "not_found",
      selected: Boolean(closeout.selectedIncident),
      missingRequired: failed.map((item) => ({
        key: item.key,
        label: item.label,
        detail: item.detail,
        severity: item.severity
      })),
      warningKeys: warnings.map((item) => item.key).filter(Boolean),
      recommendation: closeoutWorklistRecommendation(closeout)
    }));
  }
  const byRecommendation = {};
  const byCloseoutStatus = {};
  for (const item of items) {
    byRecommendation[item.recommendation] = (byRecommendation[item.recommendation] || 0) + 1;
    byCloseoutStatus[item.closeoutStatus] = (byCloseoutStatus[item.closeoutStatus] || 0) + 1;
  }
  return {
    schemaVersion: "workflow_incident_closeout_worklist_preview.v1",
    action: "workflow.incident.closeout.worklist.preview",
    preview: true,
    readOnly: true,
    writeMode: "read_only_closeout_worklist_preview",
    generatedAt: nowIso(),
    workflowId,
    limit,
    staleIncidentAfterMs: staleAfterMs,
    counts: {
      openIncidentsScanned: rows.length,
      selected: items.filter((item) => item.selected).length,
      rejectedByScope,
      stale: items.filter((item) => item.stale).length,
      byRecommendation,
      byCloseoutStatus
    },
    nextActions: [
      "workflow.incident.closeout.worklist.artifact.preview",
      "workflow.incident.closeout.evidence.preview",
      "workflow.incident.closeout.evidence",
      "workflow.incident.closeout.cat_claw_report.preview",
      "workflow.incident.closeout.human_gate_package.preview"
    ],
    items,
    limitations: [
      "Preview is read-only and does not update incidents, create artifacts, create Human Gate requests, enqueue Telegram, dispatch runtimes, or mutate side effects.",
      "Legacy incidents without explicit workflow links are evaluated against the supplied workflowId; explicit other-workflow links remain rejected by incidentCloseout.",
      "Use evidence preview/write for missing evidence before preparing Cat Claw closeout or Human Gate packages."
    ],
    dbFile: paths.dbFile
  };
}

function renderCloseoutWorklistMarkdown(record = {}) {
  const worklist = record.worklist || {};
  const counts = worklist.counts || {};
  const items = worklist.items || [];
  return `# Incident Closeout Worklist

## Summary

- workflowId: ${record.workflowId || worklist.workflowId || "-"}
- artifactId: ${record.artifactId || "-"}
- generatedAt: ${record.persistedAt || worklist.generatedAt || "-"}
- openIncidentsScanned: ${counts.openIncidentsScanned ?? 0}
- selected: ${counts.selected ?? 0}
- rejectedByScope: ${counts.rejectedByScope ?? 0}
- stale: ${counts.stale ?? 0}

## Next Actions

${(worklist.nextActions || []).map((item) => `- ${item}`).join("\n") || "- none"}

## Items

${items.length ? items.map((item, index) => {
  const missing = (item.missingRequired || []).map((row) => row.key).filter(Boolean).join(", ") || "none";
  return `${index + 1}. ${item.incidentId} status=${item.closeoutStatus} recommendation=${item.recommendation} missing=${missing}`;
}).join("\n") : "- none"}

## Boundary

- writeBoundary: closeout_worklist_artifact_only
- noIncidentStateMutation: true
- noHumanGateMutation: true
- noTelegramOutboxMutation: true
- noRuntimeDispatchMutation: true
- noSideEffectMutation: true
`;
}

async function workflowIncidentCloseoutWorklistArtifactPreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const worklist = await workflowIncidentCloseoutWorklistPreview(rootDir, input);
  const operatorReason = String(input.operatorReason || input.operator_reason || input.reason || "").trim();
  const writeViolations = [];
  if (!operatorReason) writeViolations.push({ code: "operator_reason_required", detail: "operatorReason is required before persisting a closeout worklist artifact." });
  const artifactId = String(input.artifactId || input.artifact_id || safeId("incident.closeout.worklist")).trim();
  return {
    schemaVersion: "workflow_incident_closeout_worklist_artifact_preview.v1",
    action: "workflow.incident.closeout.worklist.artifact.preview",
    preview: true,
    readOnly: true,
    writeMode: "read_only_closeout_worklist_artifact_preview",
    generatedAt: nowIso(),
    workflowId: worklist.workflowId,
    artifactId,
    eligible: true,
    writeReady: writeViolations.length === 0,
    worklistCounts: worklist.counts || {},
    wouldCreate: {
      artifactIndexRows: 2,
      files: 2,
      workflowEvents: 1,
      incidentStates: 0,
      humanGateRequests: 0,
      humanGateButtons: 0,
      telegramOutbox: 0,
      runtimeDispatches: 0,
      sideEffects: 0,
      workflowStatusUpdates: 0
    },
    violations: writeViolations,
    limitations: [
      "Preview is read-only and does not persist the closeout worklist artifact.",
      "Execution writes only JSON/Markdown worklist artifacts, artifact_index rows, and one audit workflow event.",
      "Execution does not close incidents, record closeout evidence, create Human Gate requests/buttons, dispatch Cat Claw, enqueue Telegram, retry jobs, or change workflow status."
    ],
    worklist,
    dbFile: paths.dbFile
  };
}

async function workflowIncidentCloseoutWorklistArtifact(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const preview = await workflowIncidentCloseoutWorklistArtifactPreview(rootDir, input);
  if (!preview.writeReady) {
    throw new Error(`closeout worklist artifact is not write-ready: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  const operatorReason = String(input.operatorReason || input.operator_reason || input.reason || "").trim();
  if (!operatorReason) throw new Error("operatorReason is required for closeout worklist artifact persistence");
  const createdAt = nowIso();
  const artifactId = cleanFileSegment(preview.artifactId || safeId("incident.closeout.worklist"));
  const createdBy = input.createdBy || input.created_by || input.actor || permissionDecision?.caller?.agentId || "local_codex";
  const record = redactSensitiveForPersistence({
    schemaVersion: "workflow_incident_closeout_worklist_artifact.v1",
    artifactId,
    workflowId: preview.workflowId,
    persistedAt: createdAt,
    createdBy,
    operatorReason: redactSensitiveTextForPersistence(operatorReason),
    permissionPolicyOutcome: permissionDecision?.policyOutcome || "",
    writeBoundary: "closeout_worklist_artifact_only",
    worklist: preview.worklist,
    limitations: preview.limitations
  });
  const packageDir = path.join(paths.bridgeDir, "incident-closeout-worklists");
  const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, artifactId, record);
  const markdownRelPath = await writeTextArtifact(paths.root, packageDir, artifactId, "md", renderCloseoutWorklistMarkdown({ ...record, jsonRelPath }));
  const summary = `Incident closeout worklist ${record.workflowId || artifactId}`;
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${artifactId}.json`)}, NULL, ${sqlValue(record.workflowId)}, 'incident_closeout_worklist_json', ${sqlValue(jsonRelPath)}, ${sqlValue(summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${artifactId}.md`)}, NULL, ${sqlValue(record.workflowId)}, 'incident_closeout_worklist_markdown', ${sqlValue(markdownRelPath)}, ${sqlValue(summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
  await appendWorkflowEvent(paths, {
    eventType: "incident.closeout_worklist_artifact.persisted",
    status: "persisted",
    workflowId: record.workflowId,
    actor: createdBy,
    sourceRuntime: "workflow",
    sourceAgent: createdBy,
    artifactRef: markdownRelPath,
    payload: {
      artifactId,
      jsonRelPath,
      markdownRelPath,
      writeBoundary: "closeout_worklist_artifact_only",
      counts: record.worklist?.counts || {}
    },
    createdAt
  });
  return {
    schemaVersion: "workflow_incident_closeout_worklist_artifact_result.v1",
    action: "workflow.incident.closeout.worklist.artifact",
    workflowId: record.workflowId,
    artifactId,
    jsonRelativePath: jsonRelPath,
    markdownRelativePath: markdownRelPath,
    writeBoundary: "closeout_worklist_artifact_only",
    didCloseIncident: false,
    didRecordCloseoutEvidence: false,
    didCreateHumanGate: false,
    didDispatchRuntime: false,
    didSendTelegram: false,
    dbFile: paths.dbFile
  };
}

function closeoutEvidenceInput(input = {}) {
  return {
    humanGateEvidence: firstText(
      input.humanGateEvidence,
      input.human_gate_evidence,
      input.humanGateId,
      input.human_gate_id,
      input.riskDecisionId,
      input.risk_decision_id,
      input.flashcatOriginalWords,
      input.flashcat_original_words
    ),
    humanGateId: firstText(input.humanGateId, input.human_gate_id),
    riskDecisionId: firstText(input.riskDecisionId, input.risk_decision_id),
    flashcatOriginalWords: firstText(input.flashcatOriginalWords, input.flashcat_original_words),
    catClawAuditId: firstText(
      input.catClawAuditId,
      input.cat_claw_audit_id,
      input.catClawAudit,
      input.cat_claw_audit,
      input.secretaryAuditId,
      input.secretary_audit_id
    ),
    operatorReason: firstText(input.operatorReason, input.operator_reason, input.reason),
    rollbackBoundary: firstText(input.rollbackBoundary, input.rollback_boundary, input.rollbackOptions, input.rollback_options, input.stopBoundary, input.stop_boundary),
    evidenceSummary: firstText(input.evidenceSummary, input.evidence_summary, input.summary, input.text)
  };
}

function closeoutEvidenceViolations(evidence = {}) {
  const violations = [];
  if (!evidence.operatorReason) violations.push({ code: "operator_reason_required", detail: "operatorReason is required before recording closeout evidence." });
  if (!evidence.rollbackBoundary) violations.push({ code: "rollback_boundary_required", detail: "rollbackBoundary or rollbackOptions is required before recording closeout evidence." });
  if (!evidence.catClawAuditId) violations.push({ code: "cat_claw_audit_required", detail: "Cat Claw audit or secretary audit evidence is required before recording closeout evidence." });
  if (!evidence.humanGateEvidence) violations.push({ code: "human_gate_evidence_required", detail: "Human Gate evidence, risk decision, or Flashcat original words are required before recording closeout evidence." });
  return violations;
}

async function workflowIncidentCloseoutEvidencePreview(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const workflowId = String(input.workflowId || input.workflow_id || "").trim();
  if (!workflowId) throw new Error("workflowId is required");
  const incidentId = String(input.incidentId || input.incident_id || "").trim();
  if (!incidentId) throw new Error("incidentId is required");
  const generatedAt = nowIso();
  const readModel = new WorkflowReadModel({ dbFile: paths.dbFile });
  const closeoutBefore = await readModel.incidentCloseout(workflowId, {
    incidentId,
    limit: input.limit || input.timelineLimit || input.timeline_limit
  });
  const evidence = closeoutEvidenceInput(input);
  const inputViolations = closeoutEvidenceViolations(evidence);
  const violations = [];
  if (!closeoutBefore.selectedIncident) {
    violations.push({ code: "incident_not_found", detail: "No incident state is linked to this workflow or incident id." });
  }
  return {
    schemaVersion: "workflow_incident_closeout_evidence_preview.v1",
    action: "workflow.incident.closeout.evidence.preview",
    preview: true,
    readOnly: true,
    writeMode: "read_only_closeout_evidence_preview",
    generatedAt,
    workflowId,
    incidentId,
    eligible: violations.length === 0,
    writeReady: violations.length === 0 && inputViolations.length === 0,
    closeoutStatusBefore: closeoutBefore.status,
    closeoutCountsBefore: closeoutBefore.counts || {},
    closeoutChecklistBefore: closeoutBefore.checklist || [],
    wouldUpdate: {
      incidentStates: violations.length === 0 ? 1 : 0,
      workflowEvents: violations.length === 0 ? 1 : 0,
      payloadFields: ["closeoutEvidence", "operatorReason", "catClawAuditId", "humanGateEvidence", "incidentCandidate.rollbackBoundary"],
      status: false,
      resolvedAt: false,
      humanGateRequests: 0,
      telegramOutbox: 0,
      runtimeDispatches: 0,
      artifacts: 0,
      sideEffects: 0
    },
    evidence: redactSensitiveForPersistence({
      humanGateEvidence: evidence.humanGateEvidence,
      humanGateId: evidence.humanGateId,
      riskDecisionId: evidence.riskDecisionId,
      flashcatOriginalWords: evidence.flashcatOriginalWords,
      catClawAuditId: evidence.catClawAuditId,
      operatorReason: evidence.operatorReason,
      rollbackBoundary: evidence.rollbackBoundary,
      evidenceSummary: evidence.evidenceSummary
    }),
    violations: [...violations, ...inputViolations],
    limitations: [
      "Preview is read-only and does not update incident state.",
      "Execution records evidence only; it does not close incidents, resolve workflow status, create Human Gate requests, enqueue Telegram, dispatch runtimes, or mutate side effects.",
      "Formal closeout still requires a separate closeout artifact and Human Gate path."
    ],
    dbFile: paths.dbFile
  };
}

async function workflowIncidentCloseoutEvidence(rootDir, input = {}, permissionDecision = null) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const preview = await workflowIncidentCloseoutEvidencePreview(rootDir, input);
  if (!preview.eligible) {
    throw new Error(`closeout evidence is not eligible: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  if (!preview.writeReady) {
    throw new Error(`closeout evidence is not write-ready: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
  }
  const evidence = closeoutEvidenceInput(input);
  const createdAt = nowIso();
  const createdBy = input.createdBy || input.created_by || input.actor || permissionDecision?.caller?.agentId || "cat_claw";
  const rows = await sqlite(paths.dbFile, `
SELECT incident_id, payload_json, rollback_options, timeline_json
FROM incident_states
WHERE incident_id=${sqlValue(preview.incidentId)}
LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) throw new Error("incident not found");
  const currentPayload = parseJsonValue(row.payload_json, {});
  const closeoutEvidence = {
    schemaVersion: "workflow_incident_closeout_evidence.v1",
    workflowId: preview.workflowId,
    incidentId: preview.incidentId,
    recordedAt: createdAt,
    recordedBy: createdBy,
    humanGateEvidence: evidence.humanGateEvidence,
    humanGateId: evidence.humanGateId,
    riskDecisionId: evidence.riskDecisionId,
    flashcatOriginalWords: evidence.flashcatOriginalWords,
    catClawAuditId: evidence.catClawAuditId,
    operatorReason: evidence.operatorReason,
    rollbackBoundary: evidence.rollbackBoundary,
    evidenceSummary: evidence.evidenceSummary,
    writeBoundary: "incident_closeout_evidence_only"
  };
  const existingEvidence = Array.isArray(currentPayload.closeoutEvidenceHistory) ? currentPayload.closeoutEvidenceHistory : [];
  const payload = redactSensitiveForPersistence({
    ...currentPayload,
    workflowId: preview.workflowId,
    closeoutEvidence,
    closeoutEvidenceHistory: [...existingEvidence, closeoutEvidence].slice(-20),
    operatorReason: evidence.operatorReason,
    catClawAuditId: evidence.catClawAuditId,
    humanGateEvidence: evidence.humanGateEvidence,
    humanGateId: evidence.humanGateId || currentPayload.humanGateId || "",
    riskDecisionId: evidence.riskDecisionId || currentPayload.riskDecisionId || "",
    flashcatOriginalWords: evidence.flashcatOriginalWords || currentPayload.flashcatOriginalWords || "",
    incidentCandidate: {
      ...(currentPayload.incidentCandidate || {}),
      rollbackBoundary: evidence.rollbackBoundary
    }
  });
  const timeline = toList(parseJsonValue(row.timeline_json, []));
  const timelineNote = `${createdAt} closeout evidence recorded by ${createdBy}; boundary=incident_closeout_evidence_only`;
  const rollbackOptions = evidence.rollbackBoundary || row.rollback_options || "";
  await sqlite(paths.dbFile, `
UPDATE incident_states
SET payload_json=${sqlValue(JSON.stringify(payload))},
    rollback_options=${sqlValue(rollbackOptions)},
    timeline_json=${sqlValue(JSON.stringify([...timeline, timelineNote]))},
    updated_at=${sqlValue(createdAt)}
WHERE incident_id=${sqlValue(preview.incidentId)};`);
  await appendWorkflowEvent(paths, {
    eventType: "incident.closeout_evidence.recorded",
    status: "recorded",
    workflowId: preview.workflowId,
    incidentId: preview.incidentId,
    actor: createdBy,
    sourceRuntime: "workflow",
    sourceAgent: createdBy,
    nextState: "evidence_recorded",
    payload: {
      catClawAuditId: evidence.catClawAuditId,
      humanGateEvidence: evidence.humanGateEvidence,
      writeBoundary: "incident_closeout_evidence_only"
    },
    createdAt
  });
  const closeoutAfter = await new WorkflowReadModel({ dbFile: paths.dbFile }).incidentCloseout(preview.workflowId, {
    incidentId: preview.incidentId,
    limit: input.limit || input.timelineLimit || input.timeline_limit
  });
  return {
    schemaVersion: "workflow_incident_closeout_evidence_result.v1",
    action: "workflow.incident.closeout.evidence",
    workflowId: preview.workflowId,
    incidentId: preview.incidentId,
    recordedAt: createdAt,
    recordedBy: createdBy,
    writeBoundary: "incident_closeout_evidence_only",
    closeoutStatusBefore: preview.closeoutStatusBefore,
    closeoutStatusAfter: closeoutAfter.status,
    closeoutCountsAfter: closeoutAfter.counts || {},
    didCloseIncident: false,
    didUpdateIncidentStatus: false,
    didCreateHumanGate: false,
    didSendTelegram: false,
    didDispatchRuntime: false,
    didMutateSideEffects: false,
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
	      planCountMin: HUMAN_GATE_APPROVE_OPTION_MIN,
	      planCountMax: HUMAN_GATE_APPROVE_OPTION_MAX,
	      planCountWithinPolicy: planButtons.length >= HUMAN_GATE_APPROVE_OPTION_MIN && planButtons.length <= HUMAN_GATE_APPROVE_OPTION_MAX,
	      controlRoles: Array.from(controlRoles).sort(),
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


  return {
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
  };
}
