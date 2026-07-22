import path from "node:path";

import {
  boolOption,
  firstText,
  jsonHash,
  redactSensitiveForPersistence,
  textHash
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";
import {
  workflowV2JsonArray,
  workflowV2JsonObject
} from "./helpers.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow supervisor next-actions dependency missing: ${name}`);
  return value;
}

function candidate(id, type, followUpAction, reason, input = {}, details = {}) {
  return {
    candidateId: id,
    candidateType: type,
    followUpAction,
    reason,
    input,
    previewOnly: true,
    mutatesNow: false,
    ...details
  };
}

const CHECKPOINT_PREVIEW_PLAN_DECISIONS = new Set(["blocked", "human_gate_pending", "cat_claw_summary_required"]);
const REPORT_PLAN_DECISIONS = new Set(["blocked", "human_gate_pending"]);
const SUPERVISOR_CLOSEOUT_REPORT_RUNTIME = "openclaw";
const SUPERVISOR_CLOSEOUT_REPORT_AGENT = "cat_claw";

function planNeedsCheckpointPreview(plan = {}) {
  return CHECKPOINT_PREVIEW_PLAN_DECISIONS.has(String(plan.decision || ""));
}

function nodeSpawnReadiness(node = {}) {
  const missing = [];
  if (!node.nodeId) missing.push("nodeId");
  if (!node.workflowId) missing.push("workflowId");
  if (!node.planId) missing.push("planId");
  if (!node.ownerAgent) missing.push("managerAgent");
  if (!node.sessionId) missing.push("sessionId");
  if (!node.inputInfoId) missing.push("taskInputInfoId");
  return {
    ready: missing.length === 0,
    missingInputFields: missing
  };
}

function candidatesForPlan(plan = {}, limit = 20) {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  const result = [];
  if (plan.decision === "dispatch_ready") {
    for (const node of (plan.readyNodes || []).slice(0, limit)) {
      const readiness = nodeSpawnReadiness(node);
      result.push(candidate(
        `worker_spawn:${node.nodeId || result.length + 1}`,
        "worker_spawn_preview",
        "workflow.v2.worker_spawn.preview",
        "dependency_ready_v2_plan_node",
        {
          workflowId,
          planId,
          nodeId: node.nodeId || "",
          managerAgent: node.ownerAgent || "",
          runtimeBackend: node.runtimeBackend || "",
          sessionId: node.sessionId || "",
          taskInputInfoId: node.inputInfoId || ""
        },
        {
          status: readiness.ready ? "ready" : "input_required",
          missingInputFields: readiness.missingInputFields
        }
      ));
    }
  }
  if (plan.decision === "receipts_collecting") {
    if (Number(plan.counts?.activeWorkers || 0) > 0) {
      result.push(candidate(
        `control_loop:${planId}`,
        "worker_control_loop_preview",
        "workflow.v2.control_loop.preview",
        "active_or_queued_workers_require_receipt_collection_preview",
        { workflowId, planId }
      ));
    }
    if (Number(plan.counts?.activeAdapterJobs || 0) > 0) {
      result.push(candidate(
        `adapter_drain:${planId}`,
        "adapter_runner_drain_readiness_preview",
        "workflow.v2.adapter_runner.drain_readiness.preview",
        "active_adapter_jobs_require_drain_readiness_preview",
        { workflowId, planId }
      ));
    }
  }
  if (plan.decision === "waiting_review") {
    result.push(candidate(
      `manager_review:${planId}`,
      "manager_review_required",
      "workflow.v2.owner_review.preview",
      "submitted_worker_outputs_require_review",
      { workflowId, planId },
      { status: "input_required" }
    ));
  }
  if (plan.decision === "waiting_cat_claw_audit") {
    for (const pkg of (plan.draftHumanGatePackages || []).slice(0, limit)) {
      result.push(candidate(
        `cat_claw_package_audit:${pkg.packageId || result.length + 1}`,
        "cat_claw_package_audit_preview",
        "workflow.v2.cat_claw_package_audit.preview",
        "draft_human_gate_package_requires_cat_claw_audit",
        {
          workflowId,
          planId,
          packageId: pkg.packageId || ""
        },
        { status: pkg.packageId ? "ready" : "input_required" }
      ));
    }
    if (!result.some((item) => item.candidateType === "cat_claw_package_audit_preview")) {
      result.push(candidate(
        `cat_claw_package_audit:${planId}`,
        "cat_claw_package_audit_preview",
        "workflow.v2.cat_claw_package_audit.preview",
        "draft_human_gate_package_requires_cat_claw_audit",
        { workflowId, planId },
        { status: "input_required" }
      ));
    }
  }
  if (plan.decision === "human_gate_pending") {
    result.push(candidate(
      `checkpoint:${planId}`,
      "workflow_checkpoint_preview",
      "workflow.supervisor.checkpoint.preview",
      "v2_plan_requires_checkpoint_boundary_before_human_gate_request",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "v2_checkpoint_writer_available", writeAction: "workflow.supervisor.checkpoint", note: "workflow.supervisor.checkpoint can write a v2 checkpoint boundary after separate authorization" }
    ));
    result.push(candidate(
      `cat_claw_report:${planId}`,
      "cat_claw_report_required",
      "workflow.supervisor.report.preview",
      "human_gate_pending_v2_plan_requires_cat_claw_report_evidence",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "checkpoint_gated_executor_available", note: "workflow.supervisor.report requires an existing checkpoint boundary before it writes report evidence and queues Cat Claw dispatch" }
    ));
    for (const pkg of (plan.humanGatePackages || []).slice(0, limit)) {
      result.push(candidate(
        `human_gate_request:${pkg.packageId || result.length + 1}`,
        "human_gate_request_preview",
        "workflow.v2.human_gate_request.preview",
        "cat_claw_audited_human_gate_package_can_be_requested",
        {
          workflowId,
          planId,
          packageId: pkg.packageId || ""
        },
        { status: pkg.packageId ? "ready" : "input_required" }
      ));
    }
  }
  if (plan.decision === "blocked") {
    result.push(candidate(
      `checkpoint:${planId}`,
      "workflow_checkpoint_preview",
      "workflow.supervisor.checkpoint.preview",
      "blocked_v2_plan_requires_checkpoint_boundary_before_cat_claw_report",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "v2_checkpoint_writer_available", writeAction: "workflow.supervisor.checkpoint", note: "workflow.supervisor.checkpoint can write a v2 checkpoint boundary after separate authorization" }
    ));
    result.push(candidate(
      `blocker_review:${planId}`,
      "operator_blocker_review",
      "workflow.supervisor.readiness.preview",
      "blocked_v2_plan_requires_evidence_review_before_continuation",
      { workflowId, planId },
      { status: "blocked" }
    ));
    result.push(candidate(
      `cat_claw_report:${planId}`,
      "cat_claw_report_required",
      "workflow.supervisor.report.preview",
      "blocked_v2_plan_requires_cat_claw_report_evidence",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "checkpoint_gated_executor_available", note: "workflow.supervisor.report requires an existing checkpoint boundary before it writes report evidence and queues Cat Claw dispatch" }
    ));
  }
  if (plan.decision === "cat_claw_summary_required") {
    result.push(candidate(
      `checkpoint:${planId}`,
      "workflow_checkpoint_preview",
      "workflow.supervisor.checkpoint.preview",
      "completed_v2_plan_requires_checkpoint_boundary_before_closeout",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "v2_checkpoint_writer_available", writeAction: "workflow.supervisor.checkpoint", note: "workflow.supervisor.checkpoint can write a v2 checkpoint boundary after separate authorization" }
    ));
    result.push(candidate(
      `cat_claw_closeout:${planId}`,
      "cat_claw_closeout_required",
      "workflow.supervisor.closeout.preview",
      "completed_v2_plan_requires_cat_claw_closeout_evidence",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "checkpoint_gated_executor_available", note: "workflow.supervisor.closeout requires an existing checkpoint boundary before it writes closeout evidence and queues Cat Claw dispatch" }
    ));
  }
  return result;
}

async function checkpointRowsByWorkflow(dbFile, workflowIds = [], limit = 20) {
  const ids = [...new Set(workflowIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!dbFile || !ids.length) return new Map();
  const tableRows = await sqlite(dbFile, "SELECT name FROM sqlite_master WHERE type='table' AND name='workflow_checkpoints' LIMIT 1;", { json: true });
  if (!tableRows[0]) return new Map();
  const rows = await sqlite(dbFile, `
SELECT workflow_id, checkpoint_id, status, phase, decision, summary, path, created_by, created_at
     , resume_payload_json
FROM workflow_checkpoints
WHERE workflow_id IN (${ids.map(sqlValue).join(", ")})
  AND checkpoint_id LIKE 'workflow_supervisor_checkpoint.%'
ORDER BY workflow_id ASC, created_at DESC
;`, { json: true });
  const grouped = new Map(ids.map((id) => [id, []]));
  for (const row of rows) {
    const workflowId = String(row.workflow_id || "");
    if (!grouped.has(workflowId)) grouped.set(workflowId, []);
    if (grouped.get(workflowId).length < limit) grouped.get(workflowId).push(row);
  }
  return grouped;
}

function supervisorCheckpointIdForPlan(workflowId, planId, decision) {
  return `workflow_supervisor_checkpoint.${textHash(`${workflowId}:${planId}:${decision}`).slice(0, 24)}`;
}

function supervisorCheckpointResumePayload(row = {}) {
  return workflowV2JsonObject(row.resume_payload_json, {});
}

function supervisorCheckpointMatchesPlan(row = {}, workflowId = "", planId = "", decision = "") {
  const requiredCheckpointId = supervisorCheckpointIdForPlan(workflowId, planId, decision);
  if (String(row.workflow_id || "") !== workflowId) return false;
  if (String(row.checkpoint_id || "") !== requiredCheckpointId) return false;
  const payload = supervisorCheckpointResumePayload(row);
  return payload.schemaVersion === "workflow_supervisor_checkpoint_resume.v1"
    && payload.workflowId === workflowId
    && payload.planId === planId
    && payload.readinessDecision === decision;
}

function supervisorCheckpointsForPlan(checkpoints = [], plan = {}, decision = "") {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  const requiredDecision = decision || plan.decision || "";
  return checkpoints.filter((row) => supervisorCheckpointMatchesPlan(row, workflowId, planId, requiredDecision));
}

function checkpointCandidateForPlan(plan = {}, checkpoints = []) {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  const decision = plan.decision || "";
  const matchingCheckpoints = supervisorCheckpointsForPlan(checkpoints, plan, plan.decision || "");
  const latestCheckpoint = matchingCheckpoints[0] || null;
  const checkpointId = supervisorCheckpointIdForPlan(workflowId, planId, plan.decision || "");
  const ready = planNeedsCheckpointPreview(plan);
  const missingReason = decision === "blocked"
    ? "v2_plan_needs_checkpoint_boundary_before_blocked_report"
    : decision === "human_gate_pending"
      ? "v2_plan_needs_checkpoint_boundary_before_human_gate_report_or_request"
      : "v2_plan_needs_checkpoint_boundary_before_closeout";
  return {
    candidateId: `checkpoint:${planId || workflowId || "unknown"}`,
    candidateType: "workflow_supervisor_checkpoint",
    status: latestCheckpoint ? "existing_checkpoint_available" : "checkpoint_missing_preview_available",
    executorStatus: ready ? "ready" : "precondition_failed",
    reason: latestCheckpoint
      ? "existing_checkpoint_boundary_available_for_v2_plan"
      : missingReason,
    previewOnly: true,
    mutatesNow: false,
    followUpAction: "workflow.supervisor.checkpoint.preview",
    previewAction: "workflow.supervisor.checkpoint.preview",
    writeAction: "workflow.supervisor.checkpoint",
    workflowId,
    planId,
    readinessDecision: plan.decision || "",
    input: {
      workflowId,
      planId,
      checkpointId,
      readinessDecision: plan.decision || ""
    },
    existingCheckpointCount: matchingCheckpoints.length,
    latestCheckpoint: latestCheckpoint ? {
      checkpointId: latestCheckpoint.checkpoint_id || "",
      status: latestCheckpoint.status || "",
      phase: latestCheckpoint.phase || "",
      decision: latestCheckpoint.decision || "",
      summary: latestCheckpoint.summary || "",
      path: latestCheckpoint.path || "",
      createdBy: latestCheckpoint.created_by || "",
      createdAt: latestCheckpoint.created_at || ""
    } : null,
    v2StateSummary: {
      nodes: Number(plan.counts?.nodes || 0),
      readyNodes: Number(plan.counts?.readyNodes || 0),
      activeWorkers: Number(plan.counts?.activeWorkers || 0),
      reviewWorkers: Number(plan.counts?.reviewWorkers || 0),
      activeAdapterJobs: Number(plan.counts?.activeAdapterJobs || 0),
      humanGatePackages: Number(plan.counts?.humanGatePackages || 0)
    },
    evidenceRefs: [
      plan.planSpecArtifactRef || "",
      ...(plan.readyNodes || []).map((node) => node.outputInfoId || node.inputInfoId || "").filter(Boolean),
      ...(plan.activeWorkers || []).map((worker) => worker.outputInfoId || worker.receiptRef || "").filter(Boolean),
      ...(plan.reviewWorkers || []).map((worker) => worker.outputInfoId || worker.receiptRef || "").filter(Boolean),
      ...(plan.activeAdapterJobs || []).map((job) => job.artifactRef || job.runnerReceiptRef || "").filter(Boolean),
      ...(plan.humanGatePackages || []).flatMap((pkg) => pkg.evidenceRefs || [])
    ].filter(Boolean),
    checkpointPreview: {
      wouldWriteCheckpointNow: ready,
      wouldWriteArtifactNow: ready,
      wouldUpdateArtifactIndexNow: ready,
      checkpointParityStatus: "v2_checkpoint_writer_available",
      checkpointId,
      reason: "checkpoint preview is read-only; workflow.supervisor.checkpoint writes the v2 checkpoint boundary"
    }
  };
}

function archiveCheckpointIdForInput(input = {}, workflowId = "", planId = "") {
  const humanGateId = firstText(input.humanGateId, input.human_gate_id, input.batchId, input.batch_id);
  const buttonId = firstText(input.buttonId, input.button_id, input.buttonKey, input.button_key);
  const decisionStatus = firstText(input.decisionStatus, input.decision_status, input.status, "archived");
  return `workflow_archive_checkpoint.${textHash(`${workflowId}:${planId}:${humanGateId}:${buttonId}:${decisionStatus}`).slice(0, 24)}`;
}

function archiveCheckpointCandidateForPlan(plan = {}, input = {}) {
  const workflowId = firstText(input.workflowId, input.workflow_id, plan.workflowId);
  const planId = firstText(input.planId, input.plan_id, plan.planId);
  const sourceStatePresent = plan.synthetic !== true && Boolean(plan.workflowId && plan.planId);
  const checkpointId = archiveCheckpointIdForInput(input, workflowId, planId);
  const humanGateId = firstText(input.humanGateId, input.human_gate_id, input.batchId, input.batch_id);
  const buttonId = firstText(input.buttonId, input.button_id, input.buttonKey, input.button_key);
  const decisionStatus = firstText(input.decisionStatus, input.decision_status, input.status, "archived");
  const nextActions = workflowV2JsonArray(input.nextActions || input.next_actions, [
    "record archive checkpoint with dedicated v2/shared writer",
    "keep Human Gate closeout dispatch separate from checkpoint persistence",
    "do not require legacy workflow_runs/workflow_tasks rows"
  ]);
  const missingInputFields = [];
  if (!workflowId) missingInputFields.push("workflowId");
  if (!firstText(input.planId, input.plan_id)) missingInputFields.push("planId");
  if (!humanGateId) missingInputFields.push("humanGateId");
  if (!buttonId) missingInputFields.push("buttonId");
  if (!sourceStatePresent) missingInputFields.push("matchingV2Plan");
  const ready = missingInputFields.length === 0;
  return {
    candidateId: `archive_checkpoint:${humanGateId || planId || workflowId || "unknown"}`,
    candidateType: "workflow_archive_checkpoint",
    sourceClass: sourceStatePresent ? "v2_plan_archive_checkpoint" : "missing_v2_plan_archive_checkpoint",
    status: ready ? "preview_available" : "input_required",
    executorStatus: ready ? "ready" : "precondition_failed",
    reason: sourceStatePresent
      ? "human_gate_archive_closeout_can_use_v2_plan_evidence_without_legacy_workflow_rows"
      : "human_gate_archive_checkpoint_preview_requires_matching_v2_plan_state",
    previewOnly: true,
    mutatesNow: false,
    followUpAction: "workflow.archive.checkpoint.preview",
    previewAction: "workflow.archive.checkpoint.preview",
    writeAction: "workflow.archive.checkpoint",
    workflowId,
    planId,
    humanGateId,
    buttonId,
    decisionStatus,
    missingInputFields,
    input: {
      workflowId,
      planId,
      checkpointId,
      humanGateId,
      buttonId,
      decisionStatus
    },
    checkpointPreview: {
      schemaVersion: "workflow_archive_checkpoint_record.v1",
      resumePayloadSchemaVersion: "workflow_archive_checkpoint_resume.v1",
      wouldWriteCheckpointNow: true,
      wouldWriteArtifactNow: true,
      wouldUpdateArtifactIndexNow: true,
      wouldDispatchNow: false,
      wouldRequestHumanGateNow: false,
      wouldSendTelegramNow: false,
      wouldDrainRuntimeNow: false,
      wouldUpdateV2PlanStateNow: false,
      wouldUpdateV2NodeStateNow: false,
      checkpointId,
      nextActions
    },
    evidenceRefs: evidenceRefsForPlan(plan, { includeDraftHumanGatePackages: true })
  };
}

function closeoutIdForPlan(workflowId, planId) {
  return `workflow_v2_closeout.${textHash(`${workflowId}:${planId}`).slice(0, 24)}`;
}

function closeoutDispatchIdempotencyKey(closeoutId) {
  return `workflow.supervisor.closeout:${closeoutId}:cat_claw_report`;
}

function evidenceRefsForPlan(plan = {}, options = {}) {
  const refs = [
    plan.planSpecArtifactRef || "",
    ...(plan.readyNodes || []).map((node) => node.outputInfoId || "").filter(Boolean),
    ...(plan.activeWorkers || []).map((worker) => worker.outputInfoId || worker.receiptRef || "").filter(Boolean),
    ...(plan.activeAdapterJobs || []).map((job) => job.artifactRef || job.runnerReceiptRef || "").filter(Boolean),
    ...(plan.humanGatePackages || []).flatMap((pkg) => pkg.evidenceRefs || [])
  ];
  if (options.includeDraftHumanGatePackages) {
    refs.push(...(plan.draftHumanGatePackages || []).flatMap((pkg) => pkg.evidenceRefs || []));
  }
  return refs.filter(Boolean);
}

function reportIdForPlan(workflowId, planId, decision) {
  return `workflow_supervisor_report.${textHash(`${workflowId}:${planId}:${decision}`).slice(0, 24)}`;
}

function reportDispatchIdempotencyKey(reportId) {
  return `workflow.supervisor.report:${reportId}:cat_claw_report`;
}

function reportDispatchTypeForDecision(decision = "") {
  return decision === "human_gate_pending" ? "human_gate_report" : "workflow_secretary_report";
}

async function closeoutRowsByPlan(dbFile, plans = [], limit = 20) {
  if (!dbFile || !plans.length) return new Map();
  const tableRows = await sqlite(dbFile, "SELECT name FROM sqlite_master WHERE type='table' AND name='protocol_objects' LIMIT 1;", { json: true });
  if (!tableRows[0]) return new Map();
  const pairs = plans
    .map((plan) => ({ workflowId: String(plan.workflowId || "").trim(), planId: String(plan.planId || "").trim() }))
    .filter((plan) => plan.workflowId && plan.planId);
  if (!pairs.length) return new Map();
  const clauses = pairs.map((plan) => `(json_extract(po.payload_json, '$.workflowId')=${sqlValue(plan.workflowId)} AND json_extract(po.payload_json, '$.planId')=${sqlValue(plan.planId)})`);
  const rows = await sqlite(dbFile, `
SELECT po.object_id, po.status, po.path, po.payload_json, po.created_at, po.updated_at
FROM protocol_objects po
WHERE po.object_type='workflow_v2_closeout_record'
  AND (${clauses.join(" OR ")})
ORDER BY po.created_at DESC
LIMIT ${sqlValue(pairs.length * limit)};`, { json: true });
  const grouped = new Map(pairs.map((plan) => [`${plan.workflowId}:${plan.planId}`, []]));
  for (const row of rows) {
    const payload = workflowV2JsonObject(row.payload_json, {});
    const key = `${payload.workflowId || ""}:${payload.planId || ""}`;
    if (!grouped.has(key)) grouped.set(key, []);
    if (grouped.get(key).length < limit) grouped.get(key).push(row);
  }
  return grouped;
}

async function reportRowsByPlan(dbFile, plans = [], limit = 20) {
  if (!dbFile || !plans.length) return new Map();
  const tableRows = await sqlite(dbFile, "SELECT name FROM sqlite_master WHERE type='table' AND name='protocol_objects' LIMIT 1;", { json: true });
  if (!tableRows[0]) return new Map();
  const pairs = plans
    .map((plan) => ({ workflowId: String(plan.workflowId || "").trim(), planId: String(plan.planId || "").trim(), decision: String(plan.decision || "").trim() }))
    .filter((plan) => plan.workflowId && plan.planId && plan.decision);
  if (!pairs.length) return new Map();
  const clauses = pairs.map((plan) => `(json_extract(po.payload_json, '$.workflowId')=${sqlValue(plan.workflowId)} AND json_extract(po.payload_json, '$.planId')=${sqlValue(plan.planId)} AND json_extract(po.payload_json, '$.readinessDecision')=${sqlValue(plan.decision)})`);
  const rows = await sqlite(dbFile, `
SELECT po.object_id, po.status, po.path, po.payload_json, po.created_at, po.updated_at
FROM protocol_objects po
WHERE po.object_type='workflow_supervisor_report_record'
  AND (${clauses.join(" OR ")})
ORDER BY po.created_at DESC
LIMIT ${sqlValue(pairs.length * limit)};`, { json: true });
  const grouped = new Map(pairs.map((plan) => [`${plan.workflowId}:${plan.planId}:${plan.decision}`, []]));
  for (const row of rows) {
    const payload = workflowV2JsonObject(row.payload_json, {});
    const key = `${payload.workflowId || ""}:${payload.planId || ""}:${payload.readinessDecision || ""}`;
    if (!grouped.has(key)) grouped.set(key, []);
    if (grouped.get(key).length < limit) grouped.get(key).push(row);
  }
  return grouped;
}

function closeoutCandidateForPlan(plan = {}, checkpoints = [], closeouts = [], input = {}) {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  const matchingCheckpoints = supervisorCheckpointsForPlan(checkpoints, plan, "cat_claw_summary_required");
  const latestCheckpoint = matchingCheckpoints[0] || null;
  const latestCloseout = closeouts[0] || null;
  const closeoutId = closeoutIdForPlan(workflowId, planId);
  const ready = plan.decision === "cat_claw_summary_required" && Boolean(latestCheckpoint) && !latestCloseout;
  return {
    candidateId: `cat_claw_closeout:${planId || workflowId || "unknown"}`,
    candidateType: "cat_claw_closeout",
    status: latestCloseout
      ? "existing_closeout_available"
      : ready
        ? "ready_for_closeout"
        : plan.decision === "cat_claw_summary_required"
          ? "checkpoint_required"
          : "not_ready",
    executorStatus: latestCloseout
      ? "already_recorded"
      : ready
        ? "ready"
        : "precondition_failed",
    reason: latestCloseout
      ? "v2_plan_closeout_already_recorded"
      : plan.decision === "cat_claw_summary_required"
        ? latestCheckpoint
          ? "completed_v2_plan_can_dispatch_cat_claw_closeout"
          : "completed_v2_plan_requires_checkpoint_before_closeout"
        : "v2_plan_not_ready_for_closeout",
    previewOnly: true,
    mutatesNow: false,
    followUpAction: latestCloseout ? "workflow.supervisor.closeout.preview" : "workflow.supervisor.closeout",
    previewAction: "workflow.supervisor.closeout.preview",
    writeAction: "workflow.supervisor.closeout",
    workflowId,
    planId,
    input: {
      workflowId,
      planId,
      closeoutId,
      catBrainAgent: "main",
      catClawAgent: SUPERVISOR_CLOSEOUT_REPORT_AGENT,
      readinessDecision: plan.decision || ""
    },
    evidenceRefs: evidenceRefsForPlan(plan),
    checkpointPreview: {
      wouldWriteCheckpointNow: false,
      checkpointAction: "workflow.supervisor.checkpoint",
      checkpointParityStatus: latestCheckpoint ? "existing_checkpoint_available" : "checkpoint_required_before_closeout",
      latestCheckpointId: latestCheckpoint?.checkpoint_id || "",
      reason: latestCheckpoint
        ? "closeout can reference existing checkpoint evidence"
        : "closeout execution refuses to run without an existing checkpoint boundary"
    },
    closeoutPreview: {
      wouldWriteCloseoutArtifactNow: ready,
      wouldRecordCloseoutNow: ready,
      wouldDispatchCatClawNow: ready,
      wouldRequestHumanGateNow: false,
      reportTarget: `${SUPERVISOR_CLOSEOUT_REPORT_RUNTIME}:${SUPERVISOR_CLOSEOUT_REPORT_AGENT}`,
      requiredDecision: "cat_claw_summary_required",
      closeoutId,
      dispatchIdempotencyKey: closeoutDispatchIdempotencyKey(closeoutId)
    },
    latestCloseout: latestCloseout ? {
      closeoutId: latestCloseout.object_id || "",
      status: latestCloseout.status || "",
      path: latestCloseout.path || "",
      createdAt: latestCloseout.created_at || "",
      updatedAt: latestCloseout.updated_at || ""
    } : null
  };
}

function reportCandidateForPlan(plan = {}, checkpoints = [], reports = [], input = {}) {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  const decision = plan.decision || "";
  const matchingCheckpoints = supervisorCheckpointsForPlan(checkpoints, plan, decision);
  const latestCheckpoint = matchingCheckpoints[0] || null;
  const latestReport = reports[0] || null;
  const reportId = reportIdForPlan(workflowId, planId, decision);
  const ready = REPORT_PLAN_DECISIONS.has(decision) && Boolean(latestCheckpoint) && !latestReport;
  return {
    candidateId: `cat_claw_report:${planId || workflowId || "unknown"}`,
    candidateType: "cat_claw_report",
    status: latestReport
      ? "existing_report_available"
      : ready
        ? "ready_for_report"
        : REPORT_PLAN_DECISIONS.has(decision)
          ? "checkpoint_required"
          : "not_ready",
    executorStatus: latestReport
      ? "already_recorded"
      : ready
        ? "ready"
        : "precondition_failed",
    reason: latestReport
      ? "v2_plan_supervisor_report_already_recorded"
      : REPORT_PLAN_DECISIONS.has(decision)
        ? latestCheckpoint
          ? `${decision}_v2_plan_can_dispatch_cat_claw_report`
          : `${decision}_v2_plan_requires_checkpoint_before_report`
        : "v2_plan_not_ready_for_supervisor_report",
    previewOnly: true,
    mutatesNow: false,
    followUpAction: latestReport ? "workflow.supervisor.report.preview" : "workflow.supervisor.report",
    previewAction: "workflow.supervisor.report.preview",
    writeAction: "workflow.supervisor.report",
    workflowId,
    planId,
    input: {
      workflowId,
      planId,
      reportId,
      catBrainAgent: "main",
      catClawAgent: SUPERVISOR_CLOSEOUT_REPORT_AGENT,
      readinessDecision: decision
    },
    evidenceRefs: evidenceRefsForPlan(plan, { includeDraftHumanGatePackages: true }),
    checkpointPreview: {
      wouldWriteCheckpointNow: false,
      checkpointAction: "workflow.supervisor.checkpoint",
      checkpointParityStatus: latestCheckpoint ? "existing_checkpoint_available" : "checkpoint_required_before_report",
      latestCheckpointId: latestCheckpoint?.checkpoint_id || "",
      reason: latestCheckpoint
        ? "report can reference existing checkpoint evidence"
        : "report execution refuses to run without an existing checkpoint boundary"
    },
    reportPreview: {
      wouldWriteReportArtifactNow: ready,
      wouldRecordReportNow: ready,
      wouldDispatchCatClawNow: ready,
      wouldRequestHumanGateNow: false,
      reportTarget: `${SUPERVISOR_CLOSEOUT_REPORT_RUNTIME}:${SUPERVISOR_CLOSEOUT_REPORT_AGENT}`,
      requiredDecisions: [...REPORT_PLAN_DECISIONS],
      readinessDecision: decision,
      dispatchType: reportDispatchTypeForDecision(decision),
      reportId,
      dispatchIdempotencyKey: reportDispatchIdempotencyKey(reportId)
    },
    latestReport: latestReport ? {
      reportId: latestReport.object_id || "",
      status: latestReport.status || "",
      path: latestReport.path || "",
      createdAt: latestReport.created_at || "",
      updatedAt: latestReport.updated_at || ""
    } : null
  };
}

export function createWorkflowSupervisorNextActionsHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const dispatchPackageCreate = typeof context.dispatchPackageCreate === "function" ? context.dispatchPackageCreate : meetingDispatch;
  const workflowV2ReadinessPreview = requireContextFunction(context, "workflowV2ReadinessPreview");
  const nowIso = requireContextFunction(context, "nowIso");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");

  async function workflowSupervisorNextActionsPreview(rootDir, input = {}) {
    const includeReadiness = boolOption(input.includeReadiness ?? input.include_readiness, true);
    const limit = Math.max(1, Math.min(100, Number(input.limit || input.detailLimit || input.detail_limit || 20) || 20));
    const readiness = await workflowV2ReadinessPreview(rootDir, {
      ...input,
      includeDetails: true,
      limit
    });
    const plans = readiness.plans || [];
    const candidates = plans.flatMap((plan) => candidatesForPlan(plan, limit)).slice(0, limit);
    return {
      operation: "workflow.supervisor.next_actions.preview",
      dryRun: true,
      previewOnly: true,
      ok: true,
      status: "ok",
      generatedAt: readiness.generatedAt || firstText(input.generatedAt, input.generated_at, input.now),
      decision: readiness.decision,
      nextDecision: readiness.nextDecision || readiness.decision,
      reasons: readiness.reasons || [],
      candidateCount: candidates.length,
      candidates,
      would: {
        mutate: false,
        dispatch: false,
        claimAdapterJob: false,
        requestHumanGate: false,
        restartRuntime: false
      },
      ...(includeReadiness ? { readiness } : {}),
      limitations: [
        "preview_only_no_state_mutation",
        "candidate_actions_require_separate_authorized_calls",
        "legacy_advance_supervise_not_frozen_by_this_preview"
      ],
      dbFile: readiness.dbFile
    };
  }

  async function workflowSupervisorCloseoutPreview(rootDir, input = {}) {
    const limit = Math.max(1, Math.min(100, Number(input.limit || input.detailLimit || input.detail_limit || 20) || 20));
    const readiness = await workflowV2ReadinessPreview(rootDir, {
      ...input,
      includeDetails: true,
      limit
    });
    const plans = readiness.plans || [];
    const closeoutPlans = plans.filter((plan) => plan.decision === "cat_claw_summary_required");
    const checkpointsByWorkflow = await checkpointRowsByWorkflow(readiness.dbFile, closeoutPlans.map((plan) => plan.workflowId), limit);
    const closeoutsByPlan = await closeoutRowsByPlan(readiness.dbFile, closeoutPlans, limit);
    const closeoutCandidates = plans
      .filter((plan) => plan.decision === "cat_claw_summary_required")
      .map((plan) => closeoutCandidateForPlan(
        plan,
        checkpointsByWorkflow.get(plan.workflowId) || [],
        closeoutsByPlan.get(`${plan.workflowId}:${plan.planId}`) || [],
        input
      ))
      .slice(0, limit);
    return {
      operation: "workflow.supervisor.closeout.preview",
      dryRun: true,
      previewOnly: true,
      ok: true,
      status: closeoutCandidates.length ? "ready" : "not_ready",
      generatedAt: readiness.generatedAt || firstText(input.generatedAt, input.generated_at, input.now),
      decision: readiness.decision,
      nextDecision: readiness.nextDecision || readiness.decision,
      reasons: closeoutCandidates.length ? ["cat_claw_closeout_preview_available"] : ["no_v2_plan_ready_for_closeout"],
      closeoutCandidateCount: closeoutCandidates.length,
      closeoutCandidates,
      would: {
        mutate: false,
        dispatch: false,
        writeCheckpoint: false,
        writeCloseoutArtifact: false,
        recordCloseout: false,
        requestHumanGate: false
      },
      readiness,
      limitations: [
        "preview_only_no_state_mutation",
        "does_not_write_workflow_checkpoint",
        "does_not_write_closeout_artifact_or_record",
        "does_not_dispatch_cat_claw_report",
        "workflow.supervisor.closeout execution requires an existing checkpoint boundary and separate write authorization"
      ],
      dbFile: readiness.dbFile
    };
  }

  async function workflowArchiveCheckpointPreview(rootDir, input = {}) {
    const limit = Math.max(1, Math.min(100, Number(input.limit || input.detailLimit || input.detail_limit || 20) || 20));
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const planId = firstText(input.planId, input.plan_id);
    const readiness = await workflowV2ReadinessPreview(rootDir, {
      ...input,
      includeDetails: true,
      limit
    });
    const plans = (readiness.plans || []).filter((plan) => {
      if (workflowId && plan.workflowId !== workflowId) return false;
      if (planId && plan.planId !== planId) return false;
      return true;
    });
    const fallbackPlan = {
      workflowId,
      planId,
      decision: "human_gate_archive_closeout",
      synthetic: true
    };
    const archivePlans = plans.length ? plans : [fallbackPlan];
    const archiveCheckpointCandidates = archivePlans
      .map((plan) => archiveCheckpointCandidateForPlan(plan, input))
      .slice(0, limit);
    const readyCount = archiveCheckpointCandidates.filter((item) => item.status === "preview_available").length;
    return {
      operation: "workflow.archive.checkpoint.preview",
      dryRun: true,
      previewOnly: true,
      ok: true,
      status: readyCount ? "ready" : "input_required",
      generatedAt: readiness.generatedAt || firstText(input.generatedAt, input.generated_at, input.now),
      decision: "archive_checkpoint_preview",
      readinessDecision: readiness.decision || "",
      reasons: readyCount
        ? ["human_gate_archive_checkpoint_replacement_preview_available"]
        : ["human_gate_archive_checkpoint_preview_requires_workflow_id_human_gate_id_button_id_and_matching_v2_plan"],
      archiveCheckpointCandidateCount: archiveCheckpointCandidates.length,
      archiveCheckpointCandidates,
      would: {
        mutate: false,
        writeCheckpoint: true,
        writeArtifact: true,
        updateArtifactIndex: true,
        dispatch: false,
        requestHumanGate: false,
        sendTelegram: false,
        drainRuntime: false,
        updateWorkflowRun: false,
        updateWorkflowTask: false,
        updateV2PlanState: false,
        updateV2NodeState: false
      },
      readiness,
      limitations: [
        "preview_only_no_state_mutation",
        "does_not_require_legacy_workflow_runs_or_workflow_tasks",
        "workflow.archive.checkpoint requires separate write authorization",
        "does_not_dispatch",
        "does_not_request_human_gate",
        "does_not_update_workflow_run_or_task_state",
        "does_not_update_v2_plan_or_node_state"
      ],
      dbFile: readiness.dbFile
    };
  }

  async function workflowArchiveCheckpoint(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const preview = await workflowArchiveCheckpointPreview(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const planId = firstText(input.planId, input.plan_id);
    const humanGateId = firstText(input.humanGateId, input.human_gate_id, input.batchId, input.batch_id);
    const buttonId = firstText(input.buttonId, input.button_id, input.buttonKey, input.button_key);
    const candidate = preview.archiveCheckpointCandidates.find((item) => {
      if (workflowId && item.workflowId !== workflowId) return false;
      if (planId && item.planId !== planId) return false;
      if (humanGateId && item.humanGateId !== humanGateId) return false;
      if (buttonId && item.buttonId !== buttonId) return false;
      return true;
    });
    if (!candidate) throw new Error("workflow archive checkpoint is not available: no matching v2 archive checkpoint candidate");
    if (candidate.executorStatus !== "ready") {
      throw new Error(`workflow archive checkpoint is not write-ready: ${candidate.status}`);
    }
    const createdAt = firstText(input.createdAt, input.created_at, input.selectedAt, input.selected_at, input.feedbackReceivedAt, input.feedback_received_at) || nowIso();
    const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "cat_claw");
    const readinessPlan = (preview.readiness?.plans || []).find((plan) => plan.workflowId === candidate.workflowId && plan.planId === candidate.planId) || {};
    const nextActions = workflowV2JsonArray(input.nextActions || input.next_actions, candidate.checkpointPreview.nextActions || []);
    const artifactRefs = [
      ...(candidate.evidenceRefs || []),
      ...(workflowV2JsonArray(input.evidenceRefs || input.evidence_refs, []))
    ].filter(Boolean);
    const contextBudget = {
      mode: firstText(input.mode, input.contextMode, input.context_mode, "workflow_archive_checkpoint"),
      tokenBudget: Number(input.tokenBudget || input.token_budget || 0) || null,
      compactAtPercent: Number(input.compactAtPercent || input.compact_at_percent || 70) || 70,
      restorePolicy: firstText(input.restorePolicy, input.restore_policy, "load_archive_checkpoint_plus_referenced_artifacts_only")
    };
    const resumePayload = redactSensitiveForPersistence({
      schemaVersion: "workflow_archive_checkpoint_resume.v1",
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      humanGateId: candidate.humanGateId,
      buttonId: candidate.buttonId,
      decisionStatus: candidate.decisionStatus,
      selectedAt: firstText(input.selectedAt, input.selected_at, ""),
      feedbackReceivedAt: firstText(input.feedbackReceivedAt, input.feedback_received_at, ""),
      flashcatOriginalWords: firstText(input.flashcatOriginalWords, input.flashcat_original_words, input.feedbackText, input.feedback_text, ""),
      generatedAt: createdAt,
      createdBy,
      sourceClass: candidate.sourceClass,
      planStatus: readinessPlan.status || "",
      workflowState: readinessPlan.workflowState || "",
      readinessDecision: preview.readinessDecision || "",
      objective: readinessPlan.objective || "",
      taskOwnerAgent: readinessPlan.taskOwnerAgent || "",
      plannerAgent: readinessPlan.plannerAgent || "",
      participantManagers: readinessPlan.participantManagers || [],
      counts: readinessPlan.counts || {},
      nodeIds: (readinessPlan.nodes || []).map((node) => node.nodeId).filter(Boolean),
      activeWorkerRunIds: (readinessPlan.activeWorkers || []).map((worker) => worker.workerRunId).filter(Boolean),
      reviewWorkerRunIds: (readinessPlan.reviewWorkers || []).map((worker) => worker.workerRunId).filter(Boolean),
      activeAdapterJobIds: (readinessPlan.activeAdapterJobs || []).map((job) => job.adapterJobId).filter(Boolean),
      humanGatePackageIds: (readinessPlan.humanGatePackages || []).map((pkg) => pkg.packageId).filter(Boolean),
      draftHumanGatePackageIds: (readinessPlan.draftHumanGatePackages || []).map((pkg) => pkg.packageId).filter(Boolean),
      planSpecArtifactRef: readinessPlan.planSpecArtifactRef || "",
      artifactRefs,
      nextActions
    });
    const checkpointId = candidate.input.checkpointId;
    const checkpointRecord = redactSensitiveForPersistence({
      schemaVersion: "workflow_archive_checkpoint_record.v1",
      checkpointId,
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      humanGateId: candidate.humanGateId,
      buttonId: candidate.buttonId,
      status: "archived",
      phase: "archived",
      decision: "human_gate_archived_complete",
      summary: firstText(input.summary, input.text, `Human Gate archive checkpoint for workflow ${candidate.workflowId}.`),
      resumePayload,
      activeTasks: [],
      blockedTasks: [],
      artifactRefs,
      nextActions,
      contextBudget,
      v2StateSummary: {
        nodes: Number(readinessPlan.counts?.nodes || 0),
        readyNodes: Number(readinessPlan.counts?.readyNodes || 0),
        activeWorkers: Number(readinessPlan.counts?.activeWorkers || 0),
        reviewWorkers: Number(readinessPlan.counts?.reviewWorkers || 0),
        activeAdapterJobs: Number(readinessPlan.counts?.activeAdapterJobs || 0),
        humanGatePackages: Number(readinessPlan.counts?.humanGatePackages || 0)
      },
      writeBoundary: "archive_checkpoint_artifact_row_and_event_only",
      sideEffects: {
        writesCheckpoint: true,
        writesCheckpointArtifact: true,
        updatesArtifactIndex: true,
        dispatchesCatClaw: false,
        requestsHumanGate: false,
        sendsTelegram: false,
        drainsRuntime: false,
        updatesWorkflowRunState: false,
        updatesWorkflowTaskState: false,
        updatesV2PlanState: false,
        updatesV2NodeState: false
      },
      payload: workflowV2JsonObject(input.payload, {}),
      createdBy,
      createdAt
    });
    const hash = jsonHash(checkpointRecord);
    const jsonRelativePath = await writeJsonArtifact(paths.root, paths.checkpointsDir, checkpointId, { ...checkpointRecord, hash });
    const markdown = [
      "# Workflow Archive Checkpoint",
      "",
      `- checkpoint_id: ${checkpointId}`,
      `- workflow_id: ${candidate.workflowId}`,
      `- plan_id: ${candidate.planId}`,
      `- human_gate_id: ${candidate.humanGateId}`,
      `- button_id: ${candidate.buttonId}`,
      `- status: ${checkpointRecord.status}`,
      `- phase: ${checkpointRecord.phase}`,
      `- decision: ${checkpointRecord.decision}`,
      `- created_by: ${createdBy}`,
      `- created_at: ${createdAt}`,
      `- json_artifact: ${jsonRelativePath}`,
      "",
      "## Summary",
      "",
      checkpointRecord.summary,
      "",
      "## Resume Payload",
      "",
      "```json",
      JSON.stringify(resumePayload, null, 2),
      "```",
      "",
      "## Next Actions",
      "",
      nextActions.length ? nextActions.map((action) => `- ${action}`).join("\n") : "- none"
    ].join("\n");
    const markdownRelativePath = await writeTextArtifact(paths.root, paths.checkpointsDir, checkpointId, "md", markdown);
    await sqlite(paths.dbFile, `
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES (${sqlValue(checkpointId)}, ${sqlValue(candidate.workflowId)}, ${sqlValue(checkpointRecord.status)}, ${sqlValue(checkpointRecord.phase)}, ${sqlValue(checkpointRecord.decision)}, ${sqlValue(checkpointRecord.summary)}, ${sqlValue(JSON.stringify(resumePayload))}, '[]', '[]', ${sqlValue(JSON.stringify(artifactRefs))}, ${sqlValue(JSON.stringify(nextActions))}, ${sqlValue(JSON.stringify(contextBudget))}, ${sqlValue(markdownRelativePath)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(checkpoint_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
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
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(checkpointId)}, ${sqlValue(candidate.workflowId)}, 'workflow_checkpoint', ${sqlValue(markdownRelativePath)}, ${sqlValue(checkpointRecord.summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET workflow_id=excluded.workflow_id, kind=excluded.kind, path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
    await appendWorkflowEvent(paths, {
      eventType: "workflow.archive.checkpoint.recorded",
      status: "recorded",
      workflowId: candidate.workflowId,
      traceId: `${candidate.workflowId}:archive_checkpoint:${checkpointId}`,
      humanGateId: candidate.humanGateId,
      actor: createdBy,
      sourceRuntime: "workflow",
      sourceAgent: createdBy,
      idempotencyKey: `workflow_event:workflow.archive.checkpoint.recorded:${checkpointId}`,
      artifactRef: markdownRelativePath,
      payload: {
        checkpointId,
        planId: candidate.planId,
        humanGateId: candidate.humanGateId,
        buttonId: candidate.buttonId,
        decisionStatus: candidate.decisionStatus,
        jsonArtifactRef: jsonRelativePath,
        writeBoundary: "archive_checkpoint_artifact_row_and_event_only"
      },
      createdAt
    });
    return {
      schemaVersion: "workflow_archive_checkpoint_result.v1",
      action: "workflow.archive.checkpoint",
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      humanGateId: candidate.humanGateId,
      buttonId: candidate.buttonId,
      checkpointId,
      status: "recorded",
      writeBoundary: "archive_checkpoint_artifact_row_and_event_only",
      didWriteCheckpoint: true,
      didWriteArtifact: true,
      didUpdateArtifactIndex: true,
      didDispatch: false,
      didRequestHumanGate: false,
      didSendTelegram: false,
      didDrainRuntime: false,
      didUpdateWorkflowRun: false,
      didUpdateWorkflowTask: false,
      didUpdateV2PlanState: false,
      didUpdateV2NodeState: false,
      artifact: {
        artifactId: checkpointId,
        kind: "workflow_checkpoint",
        relativePath: markdownRelativePath,
        jsonRelativePath,
        hash
      },
      resumePayload,
      dbFile: paths.dbFile
    };
  }

  async function workflowSupervisorCloseout(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const preview = await workflowSupervisorCloseoutPreview(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const planId = firstText(input.planId, input.plan_id);
    const candidate = preview.closeoutCandidates.find((item) => {
      if (workflowId && item.workflowId !== workflowId) return false;
      if (planId && item.planId !== planId) return false;
      return true;
    });
    if (!candidate) throw new Error("workflow supervisor closeout is not available: no cat_claw_summary_required v2 plan candidate");
    if (candidate.executorStatus !== "ready") {
      throw new Error(`workflow supervisor closeout is not write-ready: ${candidate.status}`);
    }
    const createdAt = nowIso();
    const closeoutId = candidate.input.closeoutId;
    const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "workflow_supervisor");
    const reportAgent = SUPERVISOR_CLOSEOUT_REPORT_AGENT;
    const reportRuntime = SUPERVISOR_CLOSEOUT_REPORT_RUNTIME;
    const latestCheckpointId = candidate.checkpointPreview.latestCheckpointId || "";
    const closeoutPayload = redactSensitiveForPersistence({
      schemaVersion: "workflow_supervisor_closeout_record.v1",
      closeoutId,
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      status: "cat_claw_dispatch_queued",
      createdAt,
      createdBy,
      catBrainAgent: candidate.input.catBrainAgent,
      catClawAgent: reportAgent,
      reportRuntime,
      readinessDecision: candidate.input.readinessDecision,
      checkpointId: latestCheckpointId,
      evidenceRefs: candidate.evidenceRefs,
      summary: firstText(input.summary, input.text, `Completed v2 plan ${candidate.planId} requires Cat Claw closeout report.`),
      writeBoundary: "closeout_artifact_record_and_cat_claw_dispatch_only",
      sideEffects: {
        writesCloseoutArtifact: true,
        writesProtocolObject: true,
        dispatchesCatClaw: true,
        writesCheckpoint: false,
        requestsHumanGate: false,
        sendsTelegram: false,
        drainsRuntime: false
      },
      payload: workflowV2JsonObject(input.payload, {})
    });
    const hash = jsonHash(closeoutPayload);
    const relativePath = await writeJsonArtifact(paths.root, path.join(paths.workflowsDir, "closeouts"), closeoutId, { ...closeoutPayload, hash });
    await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(closeoutId)}, ${sqlValue(candidate.workflowId)}, 'workflow_v2_closeout', ${sqlValue(relativePath)}, ${sqlValue(closeoutPayload.summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET workflow_id=excluded.workflow_id, kind=excluded.kind, path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
    await sqlite(paths.dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES (${sqlValue(closeoutId)}, 'workflow_v2_closeout_record', 'cat_claw_dispatch_queued', 'workflow', ${sqlValue(createdBy)}, ${sqlValue(candidate.planId)}, ${sqlValue(relativePath)}, ${sqlValue(JSON.stringify(closeoutPayload))}, ${sqlValue(hash)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(object_id) DO UPDATE SET
  status=excluded.status,
  source_system=excluded.source_system,
  source_agent=excluded.source_agent,
  parent_object_id=excluded.parent_object_id,
  path=excluded.path,
  payload_json=excluded.payload_json,
  hash=excluded.hash,
  updated_at=excluded.updated_at;`);
    await appendWorkflowEvent(paths, {
      eventType: "workflow.supervisor.closeout.recorded",
      status: "cat_claw_dispatch_queued",
      workflowId: candidate.workflowId,
      traceId: `${candidate.workflowId}:closeout:${closeoutId}`,
      actor: createdBy,
      sourceRuntime: "workflow",
      sourceAgent: createdBy,
      idempotencyKey: `workflow_event:workflow.supervisor.closeout.recorded:${closeoutId}`,
      artifactRef: relativePath,
      payload: {
        closeoutId,
        planId: candidate.planId,
        checkpointId: latestCheckpointId,
        reportAgent,
        reportRuntime
      },
      createdAt
    });
    const dispatch = await dispatchPackageCreate(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      meetingId: firstText(input.meetingId, input.meeting_id, candidate.workflowId),
      workflowId: candidate.workflowId,
      traceId: `${candidate.workflowId}:cat_claw_closeout:${textHash(closeoutId).slice(0, 16)}`,
      idempotencyKey: closeoutDispatchIdempotencyKey(closeoutId),
      runtime: reportRuntime,
      agentId: reportAgent,
      dispatchType: "workflow_secretary_closeout_report",
      priority: firstText(input.priority, "high"),
      createdBy,
      prompt: [
        "你是猫爪 cat_claw，是 workflow 秘书和向闪电猫汇报的入口。",
        "请基于 closeout artifact 与 checkpoint evidence，整理本 v2 plan 的正式收口报告。",
        "不要自行创建 Human Gate；如需要闪电猫确认，只输出 Human Gate 候选项和证据引用，交由受治理 Human Gate 流程处理。",
        "",
        `timestamp: ${createdAt}`,
        `workflow_id: ${candidate.workflowId}`,
        `plan_id: ${candidate.planId}`,
        `closeout_id: ${closeoutId}`,
        `checkpoint_id: ${latestCheckpointId}`,
        `closeout_artifact: ${relativePath}`,
        `evidence_refs: ${(candidate.evidenceRefs || []).join(", ")}`
      ].join("\n"),
      payload: {
        closeoutId,
        workflowId: candidate.workflowId,
        planId: candidate.planId,
        checkpointId: latestCheckpointId,
        closeoutArtifactRef: relativePath,
        reportTarget: "openclaw:cat_claw",
        noDirectHumanGate: true,
        noDirectTelegram: true
      }
    });
    return {
      schemaVersion: "workflow_supervisor_closeout_result.v1",
      action: "workflow.supervisor.closeout",
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      closeoutId,
      status: "cat_claw_dispatch_queued",
      writeBoundary: "closeout_artifact_record_and_cat_claw_dispatch_only",
      didWriteCloseoutArtifact: true,
      didRecordCloseout: true,
      didDispatchCatClaw: Boolean(dispatch?.dispatchId),
      didWriteCheckpoint: false,
      didRequestHumanGate: false,
      didSendTelegram: false,
      didDrainRuntime: false,
      artifact: {
        artifactId: closeoutId,
        kind: "workflow_v2_closeout",
        relativePath,
        hash
      },
      dispatch,
      dbFile: paths.dbFile
    };
  }

  async function workflowSupervisorReportPreview(rootDir, input = {}) {
    const limit = Math.max(1, Math.min(100, Number(input.limit || input.detailLimit || input.detail_limit || 20) || 20));
    const readiness = await workflowV2ReadinessPreview(rootDir, {
      ...input,
      includeDetails: true,
      limit
    });
    const plans = readiness.plans || [];
    const reportPlans = plans.filter((plan) => REPORT_PLAN_DECISIONS.has(plan.decision));
    const checkpointsByWorkflow = await checkpointRowsByWorkflow(readiness.dbFile, reportPlans.map((plan) => plan.workflowId), limit);
    const reportsByPlan = await reportRowsByPlan(readiness.dbFile, reportPlans, limit);
    const reportCandidates = reportPlans
      .map((plan) => reportCandidateForPlan(
        plan,
        checkpointsByWorkflow.get(plan.workflowId) || [],
        reportsByPlan.get(`${plan.workflowId}:${plan.planId}:${plan.decision}`) || [],
        input
      ))
      .slice(0, limit);
    return {
      operation: "workflow.supervisor.report.preview",
      dryRun: true,
      previewOnly: true,
      ok: true,
      status: reportCandidates.length ? "ready" : "not_ready",
      generatedAt: readiness.generatedAt || firstText(input.generatedAt, input.generated_at, input.now),
      decision: readiness.decision,
      nextDecision: readiness.nextDecision || readiness.decision,
      reasons: reportCandidates.length ? ["cat_claw_report_preview_available"] : ["no_v2_plan_ready_for_cat_claw_report"],
      reportCandidateCount: reportCandidates.length,
      reportCandidates,
      would: {
        mutate: false,
        dispatch: false,
        writeCheckpoint: false,
        writeReportArtifact: false,
        recordReport: false,
        requestHumanGate: false,
        sendTelegram: false,
        drainRuntime: false
      },
      readiness,
      limitations: [
        "preview_only_no_state_mutation",
        "does_not_write_workflow_checkpoint",
        "does_not_write_report_artifact_or_record",
        "does_not_dispatch_cat_claw_report",
        "does_not_request_human_gate",
        "workflow.supervisor.report execution requires an existing checkpoint boundary and separate write authorization"
      ],
      dbFile: readiness.dbFile
    };
  }

  async function workflowSupervisorReport(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const preview = await workflowSupervisorReportPreview(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const planId = firstText(input.planId, input.plan_id);
    const candidate = preview.reportCandidates.find((item) => {
      if (workflowId && item.workflowId !== workflowId) return false;
      if (planId && item.planId !== planId) return false;
      return true;
    });
    if (!candidate) throw new Error("workflow supervisor report is not available: no blocked or human_gate_pending v2 plan candidate");
    if (candidate.executorStatus === "already_recorded") {
      const reportId = candidate.input.reportId;
      const dispatchRows = await sqlite(paths.dbFile, `
SELECT dispatch_id, runtime, agent_id, dispatch_type, status, priority
FROM mixed_meeting_dispatches
WHERE idempotency_key=${sqlValue(reportDispatchIdempotencyKey(reportId))}
LIMIT 1;`, { json: true });
      const dispatchRow = dispatchRows[0] || null;
      return {
        schemaVersion: "workflow_supervisor_report_result.v1",
        action: "workflow.supervisor.report",
        workflowId: candidate.workflowId,
        planId: candidate.planId,
        reportId,
        status: "already_recorded",
        readinessDecision: candidate.input.readinessDecision,
        writeBoundary: "report_artifact_record_and_cat_claw_dispatch_only",
        didWriteReportArtifact: false,
        didRecordReport: false,
        didDispatchCatClaw: false,
        didWriteCheckpoint: false,
        didRequestHumanGate: false,
        didSendTelegram: false,
        didDrainRuntime: false,
        didUpdateV2PlanState: false,
        didUpdateV2NodeState: false,
        artifact: candidate.latestReport ? {
          artifactId: reportId,
          kind: "workflow_supervisor_report",
          relativePath: candidate.latestReport.path || ""
        } : null,
        dispatch: dispatchRow ? {
          dispatchId: dispatchRow.dispatch_id || "",
          runtime: dispatchRow.runtime || "",
          agentId: dispatchRow.agent_id || "",
          dispatchType: dispatchRow.dispatch_type || "",
          status: dispatchRow.status || "",
          priority: dispatchRow.priority || ""
        } : null,
        dbFile: paths.dbFile
      };
    }
    if (candidate.executorStatus !== "ready") {
      throw new Error(`workflow supervisor report is not write-ready: ${candidate.status}`);
    }
    const createdAt = nowIso();
    const reportId = candidate.input.reportId;
    const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "workflow_supervisor");
    const reportAgent = SUPERVISOR_CLOSEOUT_REPORT_AGENT;
    const reportRuntime = SUPERVISOR_CLOSEOUT_REPORT_RUNTIME;
    const latestCheckpointId = candidate.checkpointPreview.latestCheckpointId || "";
    const readinessDecision = candidate.input.readinessDecision;
    const dispatchType = reportDispatchTypeForDecision(readinessDecision);
    const reportPayload = redactSensitiveForPersistence({
      schemaVersion: "workflow_supervisor_report_record.v1",
      reportId,
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      status: "cat_claw_dispatch_queued",
      createdAt,
      createdBy,
      catBrainAgent: candidate.input.catBrainAgent,
      catClawAgent: reportAgent,
      reportRuntime,
      readinessDecision,
      dispatchType,
      checkpointId: latestCheckpointId,
      evidenceRefs: candidate.evidenceRefs,
      summary: firstText(input.summary, input.text, `${readinessDecision} v2 plan ${candidate.planId} requires Cat Claw report.`),
      writeBoundary: "report_artifact_record_and_cat_claw_dispatch_only",
      sideEffects: {
        writesReportArtifact: true,
        writesProtocolObject: true,
        dispatchesCatClaw: true,
        writesCheckpoint: false,
        requestsHumanGate: false,
        sendsTelegram: false,
        drainsRuntime: false,
        updatesV2PlanState: false,
        updatesV2NodeState: false
      },
      payload: workflowV2JsonObject(input.payload, {})
    });
    const hash = jsonHash(reportPayload);
    const relativePath = await writeJsonArtifact(paths.root, path.join(paths.workflowsDir, "reports"), reportId, { ...reportPayload, hash });
    await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(reportId)}, ${sqlValue(candidate.workflowId)}, 'workflow_supervisor_report', ${sqlValue(relativePath)}, ${sqlValue(reportPayload.summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET workflow_id=excluded.workflow_id, kind=excluded.kind, path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
    await sqlite(paths.dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES (${sqlValue(reportId)}, 'workflow_supervisor_report_record', 'cat_claw_dispatch_queued', 'workflow', ${sqlValue(createdBy)}, ${sqlValue(candidate.planId)}, ${sqlValue(relativePath)}, ${sqlValue(JSON.stringify(reportPayload))}, ${sqlValue(hash)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(object_id) DO UPDATE SET
  status=excluded.status,
  source_system=excluded.source_system,
  source_agent=excluded.source_agent,
  parent_object_id=excluded.parent_object_id,
  path=excluded.path,
  payload_json=excluded.payload_json,
  hash=excluded.hash,
  updated_at=excluded.updated_at;`);
    await appendWorkflowEvent(paths, {
      eventType: "workflow.supervisor.report.recorded",
      status: "cat_claw_dispatch_queued",
      workflowId: candidate.workflowId,
      traceId: `${candidate.workflowId}:report:${reportId}`,
      actor: createdBy,
      sourceRuntime: "workflow",
      sourceAgent: createdBy,
      idempotencyKey: `workflow_event:workflow.supervisor.report.recorded:${reportId}`,
      artifactRef: relativePath,
      payload: {
        reportId,
        planId: candidate.planId,
        checkpointId: latestCheckpointId,
        readinessDecision,
        dispatchType,
        reportAgent,
        reportRuntime
      },
      createdAt
    });
    const dispatch = await dispatchPackageCreate(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      meetingId: firstText(input.meetingId, input.meeting_id, candidate.workflowId),
      workflowId: candidate.workflowId,
      traceId: `${candidate.workflowId}:cat_claw_report:${textHash(reportId).slice(0, 16)}`,
      idempotencyKey: reportDispatchIdempotencyKey(reportId),
      runtime: reportRuntime,
      agentId: reportAgent,
      dispatchType,
      priority: firstText(input.priority, "high"),
      createdBy,
      prompt: [
        "你是猫爪 cat_claw，是 workflow 秘书、Human Gate 入口和向闪电猫汇报的收口 agent。",
        "请基于 report artifact 与 checkpoint evidence，整理本 v2 plan 的正式异常/待确认报告。",
        "不要自行绕过 workflow 创建 Human Gate；如需要闪电猫确认，只输出候选项、证据引用和建议下一步，交由受治理 Human Gate 流程处理。",
        "",
        `timestamp: ${createdAt}`,
        `workflow_id: ${candidate.workflowId}`,
        `plan_id: ${candidate.planId}`,
        `readiness_decision: ${readinessDecision}`,
        `report_id: ${reportId}`,
        `checkpoint_id: ${latestCheckpointId}`,
        `report_artifact: ${relativePath}`,
        `evidence_refs: ${(candidate.evidenceRefs || []).join(", ")}`
      ].join("\n"),
      payload: {
        reportId,
        workflowId: candidate.workflowId,
        planId: candidate.planId,
        readinessDecision,
        checkpointId: latestCheckpointId,
        reportArtifactRef: relativePath,
        reportTarget: "openclaw:cat_claw",
        noDirectHumanGate: true,
        noDirectTelegram: true
      }
    });
    return {
      schemaVersion: "workflow_supervisor_report_result.v1",
      action: "workflow.supervisor.report",
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      reportId,
      status: "cat_claw_dispatch_queued",
      readinessDecision,
      writeBoundary: "report_artifact_record_and_cat_claw_dispatch_only",
      didWriteReportArtifact: true,
      didRecordReport: true,
      didDispatchCatClaw: Boolean(dispatch?.dispatchId),
      didWriteCheckpoint: false,
      didRequestHumanGate: false,
      didSendTelegram: false,
      didDrainRuntime: false,
      didUpdateV2PlanState: false,
      didUpdateV2NodeState: false,
      artifact: {
        artifactId: reportId,
        kind: "workflow_supervisor_report",
        relativePath,
        hash
      },
      dispatch,
      dbFile: paths.dbFile
    };
  }

  async function workflowSupervisorCheckpointPreview(rootDir, input = {}) {
    const limit = Math.max(1, Math.min(100, Number(input.limit || input.detailLimit || input.detail_limit || 20) || 20));
    const readiness = await workflowV2ReadinessPreview(rootDir, {
      ...input,
      includeDetails: true,
      limit
    });
    const plans = (readiness.plans || []).filter(planNeedsCheckpointPreview);
    const checkpointsByWorkflow = await checkpointRowsByWorkflow(readiness.dbFile, plans.map((plan) => plan.workflowId), limit);
    const checkpointCandidates = plans
      .map((plan) => checkpointCandidateForPlan(plan, checkpointsByWorkflow.get(plan.workflowId) || []))
      .slice(0, limit);
    return {
      operation: "workflow.supervisor.checkpoint.preview",
      dryRun: true,
      previewOnly: true,
      ok: true,
      status: checkpointCandidates.length ? "ready" : "not_ready",
      generatedAt: readiness.generatedAt || firstText(input.generatedAt, input.generated_at, input.now),
      decision: readiness.decision,
      nextDecision: readiness.nextDecision || readiness.decision,
      reasons: checkpointCandidates.length ? ["workflow_checkpoint_preview_available"] : ["no_v2_plan_available_for_checkpoint_preview"],
      checkpointCandidateCount: checkpointCandidates.length,
      checkpointCandidates: checkpointCandidates.slice(0, limit),
      would: {
        mutate: false,
        writeCheckpoint: true,
        writeArtifact: true,
        updateArtifactIndex: true,
        dispatch: false,
        requestHumanGate: false
      },
      readiness,
      limitations: [
        "preview_only_no_state_mutation",
        "workflow.supervisor.checkpoint requires separate write authorization",
        "does_not_dispatch",
        "does_not_request_human_gate",
        "does_not_update_v2_plan_or_node_state"
      ],
      dbFile: readiness.dbFile
    };
  }

  async function workflowSupervisorCheckpoint(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const preview = await workflowSupervisorCheckpointPreview(rootDir, input);
    const workflowId = firstText(input.workflowId, input.workflow_id);
    const planId = firstText(input.planId, input.plan_id);
    if (!planId) throw new Error("workflow supervisor checkpoint requires planId");
    const candidate = preview.checkpointCandidates.find((item) => {
      if (workflowId && item.workflowId !== workflowId) return false;
      if (planId && item.planId !== planId) return false;
      return true;
    });
    if (!candidate) throw new Error("workflow supervisor checkpoint is not available: no checkpoint-ready v2 plan candidate");
    if (candidate.executorStatus !== "ready") {
      throw new Error(`workflow supervisor checkpoint is not write-ready: ${candidate.status}`);
    }
    const createdAt = nowIso();
    const checkpointId = candidate.input.checkpointId;
    const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "workflow_supervisor");
    const readinessPlan = (preview.readiness?.plans || []).find((plan) => plan.workflowId === candidate.workflowId && plan.planId === candidate.planId) || {};
    const nextActions = candidate.readinessDecision === "human_gate_pending"
      ? ["workflow.v2.human_gate_request.preview"]
      : ["workflow.supervisor.closeout.preview", "workflow.supervisor.closeout"];
    const artifactRefs = [
      ...(candidate.evidenceRefs || []),
      ...(workflowV2JsonArray(input.evidenceRefs || input.evidence_refs, []))
    ].filter(Boolean);
    const resumePayload = redactSensitiveForPersistence({
      schemaVersion: "workflow_supervisor_checkpoint_resume.v1",
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      planStatus: readinessPlan.status || "",
      workflowState: readinessPlan.workflowState || "",
      readinessDecision: candidate.readinessDecision,
      generatedAt: createdAt,
      createdBy,
      objective: readinessPlan.objective || "",
      taskOwnerAgent: readinessPlan.taskOwnerAgent || "",
      plannerAgent: readinessPlan.plannerAgent || "",
      participantManagers: readinessPlan.participantManagers || [],
      counts: readinessPlan.counts || {},
      nodeIds: (readinessPlan.nodes || []).map((node) => node.nodeId).filter(Boolean),
      readyNodeIds: (readinessPlan.readyNodes || []).map((node) => node.nodeId).filter(Boolean),
      activeWorkerRunIds: (readinessPlan.activeWorkers || []).map((worker) => worker.workerRunId).filter(Boolean),
      reviewWorkerRunIds: (readinessPlan.reviewWorkers || []).map((worker) => worker.workerRunId).filter(Boolean),
      activeAdapterJobIds: (readinessPlan.activeAdapterJobs || []).map((job) => job.adapterJobId).filter(Boolean),
      humanGatePackageIds: (readinessPlan.humanGatePackages || []).map((pkg) => pkg.packageId).filter(Boolean),
      draftHumanGatePackageIds: (readinessPlan.draftHumanGatePackages || []).map((pkg) => pkg.packageId).filter(Boolean),
      planSpecArtifactRef: readinessPlan.planSpecArtifactRef || "",
      artifactRefs,
      nextActions
    });
    const contextBudget = {
      mode: firstText(input.mode, input.contextMode, input.context_mode, "workflow_supervisor_checkpoint"),
      tokenBudget: Number(input.tokenBudget || input.token_budget || 0) || null,
      compactAtPercent: Number(input.compactAtPercent || input.compact_at_percent || 70) || 70,
      restorePolicy: firstText(input.restorePolicy, input.restore_policy, "load_v2_checkpoint_plus_referenced_artifacts_only")
    };
    const checkpointRecord = redactSensitiveForPersistence({
      schemaVersion: "workflow_supervisor_checkpoint_record.v1",
      checkpointId,
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      status: readinessPlan.status || "active",
      phase: readinessPlan.workflowState || candidate.readinessDecision || "",
      decision: candidate.readinessDecision,
      summary: firstText(input.summary, input.text, `V2 supervisor checkpoint for plan ${candidate.planId}: ${candidate.readinessDecision}.`),
      resumePayload,
      activeTasks: [],
      blockedTasks: candidate.readinessDecision === "blocked" ? [readinessPlan] : [],
      artifactRefs,
      nextActions,
      contextBudget,
      v2StateSummary: candidate.v2StateSummary,
      writeBoundary: "v2_checkpoint_artifact_row_and_event_only",
      sideEffects: {
        writesCheckpoint: true,
        writesCheckpointArtifact: true,
        updatesArtifactIndex: true,
        dispatchesCatClaw: false,
        requestsHumanGate: false,
        sendsTelegram: false,
        drainsRuntime: false,
        updatesV2PlanState: false,
        updatesV2NodeState: false
      },
      payload: workflowV2JsonObject(input.payload, {}),
      createdBy,
      createdAt
    });
    const hash = jsonHash(checkpointRecord);
    const jsonRelativePath = await writeJsonArtifact(paths.root, paths.checkpointsDir, checkpointId, { ...checkpointRecord, hash });
    const markdown = [
      "# Workflow Supervisor Checkpoint",
      "",
      `- checkpoint_id: ${checkpointId}`,
      `- workflow_id: ${candidate.workflowId}`,
      `- plan_id: ${candidate.planId}`,
      `- status: ${checkpointRecord.status}`,
      `- phase: ${checkpointRecord.phase}`,
      `- decision: ${checkpointRecord.decision}`,
      `- created_by: ${createdBy}`,
      `- created_at: ${createdAt}`,
      `- json_artifact: ${jsonRelativePath}`,
      "",
      "## Summary",
      "",
      checkpointRecord.summary,
      "",
      "## Resume Payload",
      "",
      "```json",
      JSON.stringify(resumePayload, null, 2),
      "```",
      "",
      "## Next Actions",
      "",
      nextActions.length ? nextActions.map((action) => `- ${action}`).join("\n") : "- none"
    ].join("\n");
    const markdownRelativePath = await writeTextArtifact(paths.root, paths.checkpointsDir, checkpointId, "md", markdown);
    await sqlite(paths.dbFile, `
INSERT INTO workflow_checkpoints(checkpoint_id, workflow_id, status, phase, decision, summary, resume_payload_json, active_tasks_json, blocked_tasks_json, artifact_refs_json, next_actions_json, context_budget_json, path, created_by, created_at)
VALUES (${sqlValue(checkpointId)}, ${sqlValue(candidate.workflowId)}, ${sqlValue(checkpointRecord.status)}, ${sqlValue(checkpointRecord.phase)}, ${sqlValue(checkpointRecord.decision)}, ${sqlValue(checkpointRecord.summary)}, ${sqlValue(JSON.stringify(resumePayload))}, '[]', ${sqlValue(JSON.stringify(checkpointRecord.blockedTasks))}, ${sqlValue(JSON.stringify(artifactRefs))}, ${sqlValue(JSON.stringify(nextActions))}, ${sqlValue(JSON.stringify(contextBudget))}, ${sqlValue(markdownRelativePath)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(checkpoint_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
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
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(checkpointId)}, ${sqlValue(candidate.workflowId)}, 'workflow_checkpoint', ${sqlValue(markdownRelativePath)}, ${sqlValue(checkpointRecord.summary)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET workflow_id=excluded.workflow_id, kind=excluded.kind, path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);
    await appendWorkflowEvent(paths, {
      eventType: "workflow.supervisor.checkpoint.recorded",
      status: "recorded",
      workflowId: candidate.workflowId,
      traceId: `${candidate.workflowId}:checkpoint:${checkpointId}`,
      actor: createdBy,
      sourceRuntime: "workflow",
      sourceAgent: createdBy,
      idempotencyKey: `workflow_event:workflow.supervisor.checkpoint.recorded:${checkpointId}`,
      artifactRef: markdownRelativePath,
      payload: {
        checkpointId,
        planId: candidate.planId,
        decision: candidate.readinessDecision,
        jsonArtifactRef: jsonRelativePath
      },
      createdAt
    });
    return {
      schemaVersion: "workflow_supervisor_checkpoint_result.v1",
      action: "workflow.supervisor.checkpoint",
      workflowId: candidate.workflowId,
      planId: candidate.planId,
      checkpointId,
      status: "recorded",
      writeBoundary: "v2_checkpoint_artifact_row_and_event_only",
      didWriteCheckpoint: true,
      didWriteArtifact: true,
      didUpdateArtifactIndex: true,
      didDispatch: false,
      didRequestHumanGate: false,
      didSendTelegram: false,
      didDrainRuntime: false,
      didUpdateV2PlanState: false,
      didUpdateV2NodeState: false,
      artifact: {
        artifactId: checkpointId,
        kind: "workflow_checkpoint",
        relativePath: markdownRelativePath,
        jsonRelativePath,
        hash
      },
      resumePayload,
      dbFile: paths.dbFile
    };
  }

  return {
    workflowSupervisorNextActionsPreview,
    workflowArchiveCheckpointPreview,
    workflowArchiveCheckpoint,
    workflowSupervisorCheckpointPreview,
    workflowSupervisorCheckpoint,
    workflowSupervisorCloseoutPreview,
    workflowSupervisorCloseout,
    workflowSupervisorReportPreview,
    workflowSupervisorReport
  };
}
