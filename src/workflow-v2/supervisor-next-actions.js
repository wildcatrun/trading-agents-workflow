import {
  boolOption,
  firstText
} from "../workflow/json.js";

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
      `cat_claw_closeout:${planId}`,
      "cat_claw_closeout_required",
      "workflow.supervisor.closeout.preview",
      "completed_v2_plan_requires_cat_claw_closeout_evidence",
      { workflowId, planId },
      { status: "preview_available", executorStatus: "replacement_gap", note: "final v2 closeout executor is not yet implemented" }
    ));
  }
  return result;
}

function closeoutCandidateForPlan(plan = {}) {
  const workflowId = plan.workflowId || "";
  const planId = plan.planId || "";
  return {
    candidateId: `cat_claw_closeout:${planId || workflowId || "unknown"}`,
    candidateType: "cat_claw_closeout_preview",
    status: plan.decision === "cat_claw_summary_required" ? "ready_for_closeout_preview" : "not_ready",
    executorStatus: "replacement_gap",
    reason: plan.decision === "cat_claw_summary_required"
      ? "completed_v2_plan_requires_cat_claw_closeout_evidence"
      : "v2_plan_not_ready_for_closeout",
    previewOnly: true,
    mutatesNow: false,
    followUpAction: "workflow.supervisor.closeout.preview",
    workflowId,
    planId,
    input: {
      workflowId,
      planId,
      catBrainAgent: "main",
      catClawAgent: "cat_claw",
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
      checkpointParityStatus: "legacy_checkpoint_action_still_required",
      reason: "closeout preview is read-only and does not write legacy checkpoint rows"
    },
    closeoutPreview: {
      wouldDispatchCatClawNow: false,
      wouldRequestHumanGateNow: false,
      reportTarget: "openclaw:cat_claw",
      requiredDecision: "cat_claw_summary_required"
    }
  };
}

export function createWorkflowSupervisorNextActionsHandlers(context = {}) {
  const workflowV2ReadinessPreview = requireContextFunction(context, "workflowV2ReadinessPreview");

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
    const closeoutCandidates = plans
      .filter((plan) => plan.decision === "cat_claw_summary_required")
      .map(closeoutCandidateForPlan)
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
        requestHumanGate: false
      },
      readiness,
      limitations: [
        "preview_only_no_state_mutation",
        "does_not_write_workflow_checkpoint",
        "does_not_dispatch_cat_claw_report",
        "final_v2_closeout_executor_not_implemented"
      ],
      dbFile: readiness.dbFile
    };
  }

  return {
    workflowSupervisorNextActionsPreview,
    workflowSupervisorCloseoutPreview
  };
}
