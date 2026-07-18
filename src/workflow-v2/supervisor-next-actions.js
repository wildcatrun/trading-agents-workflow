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

const CHECKPOINT_PREVIEW_PLAN_DECISIONS = new Set(["human_gate_pending", "cat_claw_summary_required"]);
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
      { status: "preview_available", executorStatus: "v2_checkpoint_writer_gap", note: "v2 checkpoint writer is not yet implemented" }
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
      `blocker_review:${planId}`,
      "operator_blocker_review",
      "workflow.supervisor.readiness.preview",
      "blocked_v2_plan_requires_evidence_review_before_continuation",
      { workflowId, planId },
      { status: "blocked" }
    ));
  }
  if (plan.decision === "cat_claw_summary_required") {
    result.push(candidate(
      `checkpoint:${planId}`,
      "workflow_checkpoint_preview",
      "workflow.supervisor.checkpoint.preview",
      "completed_v2_plan_requires_checkpoint_boundary_before_closeout",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "v2_checkpoint_writer_gap", note: "v2 checkpoint writer is not yet implemented" }
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
FROM workflow_checkpoints
WHERE workflow_id IN (${ids.map(sqlValue).join(", ")})
ORDER BY workflow_id ASC, created_at DESC
LIMIT ${sqlValue(ids.length * limit)};`, { json: true });
  const grouped = new Map(ids.map((id) => [id, []]));
  for (const row of rows) {
    const workflowId = String(row.workflow_id || "");
    if (!grouped.has(workflowId)) grouped.set(workflowId, []);
    if (grouped.get(workflowId).length < limit) grouped.get(workflowId).push(row);
  }
  return grouped;
}

function checkpointCandidateForPlan(plan = {}, checkpoints = []) {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  const latestCheckpoint = checkpoints[0] || null;
  return {
    candidateId: `checkpoint:${planId || workflowId || "unknown"}`,
    candidateType: "workflow_checkpoint_preview",
    status: latestCheckpoint ? "existing_checkpoint_available" : "checkpoint_missing_preview_available",
    executorStatus: "v2_checkpoint_writer_gap",
    reason: latestCheckpoint
      ? "existing_checkpoint_boundary_available_for_v2_plan"
      : "v2_plan_needs_checkpoint_boundary_before_closeout_or_human_gate",
    previewOnly: true,
    mutatesNow: false,
    followUpAction: "workflow.supervisor.checkpoint.preview",
    writeAction: "workflow.checkpoint",
    workflowId,
    planId,
    readinessDecision: plan.decision || "",
    existingCheckpointCount: checkpoints.length,
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
      wouldWriteCheckpointNow: false,
      wouldWriteArtifactNow: false,
      wouldUpdateArtifactIndexNow: false,
      checkpointParityStatus: "preview_only_v2_checkpoint_writer_gap",
      reason: "checkpoint preview is read-only and does not write checkpoint rows or artifacts"
    }
  };
}

function closeoutIdForPlan(workflowId, planId) {
  return `workflow_v2_closeout.${textHash(`${workflowId}:${planId}`).slice(0, 24)}`;
}

function closeoutDispatchIdempotencyKey(closeoutId) {
  return `workflow.supervisor.closeout:${closeoutId}:cat_claw_report`;
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

function closeoutCandidateForPlan(plan = {}, checkpoints = [], closeouts = [], input = {}) {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  const latestCheckpoint = checkpoints[0] || null;
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
    evidenceRefs: [
      plan.planSpecArtifactRef || "",
      ...(plan.readyNodes || []).map((node) => node.outputInfoId || "").filter(Boolean),
      ...(plan.activeWorkers || []).map((worker) => worker.outputInfoId || worker.receiptRef || "").filter(Boolean),
      ...(plan.activeAdapterJobs || []).map((job) => job.artifactRef || job.runnerReceiptRef || "").filter(Boolean),
      ...(plan.humanGatePackages || []).flatMap((pkg) => pkg.evidenceRefs || [])
    ].filter(Boolean),
    checkpointPreview: {
      wouldWriteCheckpointNow: false,
      checkpointAction: "workflow.checkpoint",
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

export function createWorkflowSupervisorNextActionsHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const meetingDispatch = requireContextFunction(context, "meetingDispatch");
  const workflowV2ReadinessPreview = requireContextFunction(context, "workflowV2ReadinessPreview");
  const nowIso = requireContextFunction(context, "nowIso");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");

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
    const dispatch = await meetingDispatch(rootDir, {
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
        writeCheckpoint: false,
        writeArtifact: false,
        updateArtifactIndex: false,
        dispatch: false,
        requestHumanGate: false
      },
      readiness,
      limitations: [
        "preview_only_no_state_mutation",
        "does_not_write_workflow_checkpoint",
        "does_not_write_checkpoint_artifact",
        "does_not_update_artifact_index",
        "v2_checkpoint_writer_not_implemented"
      ],
      dbFile: readiness.dbFile
    };
  }

  return {
    workflowSupervisorNextActionsPreview,
    workflowSupervisorCheckpointPreview,
    workflowSupervisorCloseoutPreview,
    workflowSupervisorCloseout
  };
}
