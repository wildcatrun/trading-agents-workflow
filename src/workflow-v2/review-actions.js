import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  boolOption,
  firstText,
  safeId
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount
} from "../workflow/sqlite.js";
import {
  WORKFLOW_V2_CAT_BRAIN_AUDIT_DECISIONS,
  WORKFLOW_V2_CAT_CLAW_AUDIT_DECISIONS,
  WORKFLOW_V2_REVIEW_DECISIONS,
  WORKFLOW_V2_TASK_GROUP_PACKAGE_STATUSES
} from "./constants.js";
import {
  workflowV2CatBrainAuditSummary,
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2ManagerReviewSummary,
  workflowV2NormalizeEnum,
  workflowV2OwnerReviewSummary,
  workflowV2PlanSummary,
  workflowV2TaskGroupPackageSummary,
  workflowV2UniqueTextArray,
  workflowV2UniqueTextList,
  workflowV2ValidationError
} from "./helpers.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 review action dependency missing: ${name}`);
  return value;
}

export function createWorkflowV2ReviewActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeOptionalAgentId = requireContextFunction(context, "normalizeOptionalAgentId");
  const nowIso = requireContextFunction(context, "nowIso");
  const workflowV2LoadPlanRow = requireContextFunction(context, "workflowV2LoadPlanRow");
  const workflowV2PatchPlanWorkflowState = requireContextFunction(context, "workflowV2PatchPlanWorkflowState");
  const workflowV2PlanOrchestrationPattern = requireContextFunction(context, "workflowV2PlanOrchestrationPattern");
  const workflowV2RequireSessionRunPatch = requireContextFunction(context, "workflowV2RequireSessionRunPatch");
  const workflowV2RestoreManagerReviewRow = requireContextFunction(context, "workflowV2RestoreManagerReviewRow");
  const workflowV2RestoreWorkerRunRow = requireContextFunction(context, "workflowV2RestoreWorkerRunRow");

function workflowV2EvaluatorDecisionStateForReview(decision = "") {
  const text = String(decision || "").trim().toLowerCase().replace(/-/g, "_");
  if (text === "revise_required") return "needs_revision";
  return text;
}

function workflowV2EvaluatorDecisionStates(value) {
  return workflowV2UniqueTextArray(workflowV2JsonArray(value, []))
    .map(workflowV2EvaluatorDecisionStateForReview)
    .filter(Boolean);
}

function workflowV2HasStructuredEvaluatorValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "object" && Object.keys(value).length > 0) return true;
    if (String(value).trim()) return true;
  }
  return false;
}

function workflowV2EvaluatorReceiptPayload(input = {}, review = {}, worker = {}) {
  const payload = workflowV2JsonObject(review.payload, {});
  const evaluator = workflowV2JsonObject(
    input.evaluatorReceipt
      ?? input.evaluator_receipt
      ?? input.evaluatorContract
      ?? input.evaluator_contract
      ?? payload.evaluatorReceipt
      ?? payload.evaluator_receipt
      ?? payload.evaluatorContract
      ?? payload.evaluator_contract
      ?? payload.evaluator,
    {}
  );
  const producerOutputInfoId = firstText(
    input.producerOutputInfoId,
    input.producer_output_info_id,
    evaluator.producerOutputInfoId,
    evaluator.producer_output_info_id,
    worker.output_info_id
  );
  const evaluatorInputInfoId = firstText(
    input.evaluatorInputInfoId,
    input.evaluator_input_info_id,
    evaluator.evaluatorInputInfoId,
    evaluator.evaluator_input_info_id,
    evaluator.inputInfoId,
    evaluator.input_info_id
  );
  const reviewArtifactRef = firstText(
    input.reviewArtifactRef,
    input.review_artifact_ref,
    evaluator.reviewArtifactRef,
    evaluator.review_artifact_ref,
    evaluator.reviewArtifact,
    evaluator.review_artifact,
    review.artifactRefs?.[0]
  );
  const reviewReceiptRef = firstText(
    input.reviewReceiptRef,
    input.review_receipt_ref,
    evaluator.reviewReceiptRef,
    evaluator.review_receipt_ref,
    review.receiptRefs?.[0]
  );
  const decisionState = workflowV2EvaluatorDecisionStateForReview(firstText(
    input.decisionState,
    input.decision_state,
    evaluator.decisionState,
    evaluator.decision_state,
    review.decision
  ));
  const decisionStates = workflowV2EvaluatorDecisionStates(
    input.decisionStates
      ?? input.decision_states
      ?? evaluator.decisionStates
      ?? evaluator.decision_states
      ?? ["accepted", "rejected", "needs_revision"]
  );
  return {
    schemaVersion: firstText(evaluator.schemaVersion, evaluator.schema_version, "workflow_v2_evaluator_receipt.v1"),
    producerNodeId: firstText(input.producerNodeId, input.producer_node_id, evaluator.producerNodeId, evaluator.producer_node_id, worker.node_id),
    producerWorkerRunId: firstText(input.producerWorkerRunId, input.producer_worker_run_id, evaluator.producerWorkerRunId, evaluator.producer_worker_run_id, worker.worker_run_id),
    producerOutputInfoId,
    evaluatorInputInfoId,
    rubric: evaluator.rubric ?? evaluator.rubricSchema ?? evaluator.rubric_schema ?? input.rubric ?? input.rubricSchema ?? input.rubric_schema,
    reviewArtifactRef,
    reviewReceiptRef,
    decisionState,
    decisionStates
  };
}

function workflowV2EvaluatorReceiptErrors(receipt = {}, review = {}, worker = {}) {
  const errors = [];
  if (!receipt.producerOutputInfoId) {
    errors.push(workflowV2ValidationError("evaluator_producer_output_required", "evaluator review requires producerOutputInfoId bound to the producer output"));
  }
  if (!receipt.evaluatorInputInfoId) {
    errors.push(workflowV2ValidationError("evaluator_input_required", "evaluator review requires evaluatorInputInfoId"));
  }
  if (!workflowV2HasStructuredEvaluatorValue(receipt.rubric)) {
    errors.push(workflowV2ValidationError("evaluator_rubric_required", "evaluator review requires rubric/rubricSchema"));
  }
  if (!receipt.reviewArtifactRef) {
    errors.push(workflowV2ValidationError("evaluator_review_artifact_required", "evaluator review requires a review artifact reference"));
  }
  if (!receipt.reviewReceiptRef) {
    errors.push(workflowV2ValidationError("evaluator_review_receipt_required", "evaluator review requires a review receipt reference"));
  }
  const states = new Set(receipt.decisionStates || []);
  for (const required of ["accepted", "rejected", "needs_revision"]) {
    if (!states.has(required)) {
      errors.push(workflowV2ValidationError("evaluator_decision_states_required", "evaluator review requires accepted/rejected/needs_revision decision states", { missingState: required }));
    }
  }
  if (!receipt.decisionState || !states.has(receipt.decisionState)) {
    errors.push(workflowV2ValidationError("evaluator_decision_state_required", "evaluator review decisionState must be one of the declared evaluator decision states", {
      decisionState: receipt.decisionState,
      decision: review.decision || ""
    }));
  }
  if (worker.worker_run_id && receipt.producerWorkerRunId !== worker.worker_run_id) {
    errors.push(workflowV2ValidationError("evaluator_producer_worker_mismatch", "evaluator receipt producerWorkerRunId must match the reviewed worker run", {
      producerWorkerRunId: receipt.producerWorkerRunId,
      workerRunId: worker.worker_run_id
    }));
  }
  if (worker.node_id && receipt.producerNodeId !== worker.node_id) {
    errors.push(workflowV2ValidationError("evaluator_producer_node_mismatch", "evaluator receipt producerNodeId must match the reviewed worker node", {
      producerNodeId: receipt.producerNodeId,
      nodeId: worker.node_id
    }));
  }
  if (worker.output_info_id && receipt.producerOutputInfoId !== worker.output_info_id) {
    errors.push(workflowV2ValidationError("evaluator_producer_output_mismatch", "evaluator receipt producerOutputInfoId must match the reviewed worker outputInfoId", {
      producerOutputInfoId: receipt.producerOutputInfoId,
      outputInfoId: worker.output_info_id
    }));
  }
  if (worker.output_info_id && receipt.evaluatorInputInfoId !== worker.output_info_id) {
    errors.push(workflowV2ValidationError("evaluator_input_output_mismatch", "evaluator receipt evaluatorInputInfoId must consume the reviewed worker outputInfoId", {
      evaluatorInputInfoId: receipt.evaluatorInputInfoId,
      outputInfoId: worker.output_info_id
    }));
  }
  return errors;
}

function workflowV2ManagerReviewHasEvaluatorReceipt(row = {}) {
  const payload = workflowV2JsonObject(row.payload_json ?? row.payload, {});
  const receipt = workflowV2JsonObject(payload.evaluatorReceipt ?? payload.evaluator_receipt, {});
  const states = new Set(workflowV2EvaluatorDecisionStates(receipt.decisionStates ?? receipt.decision_states));
  const producerWorkerRunId = firstText(receipt.producerWorkerRunId, receipt.producer_worker_run_id);
  const producerNodeId = firstText(receipt.producerNodeId, receipt.producer_node_id);
  const producerOutputInfoId = firstText(receipt.producerOutputInfoId, receipt.producer_output_info_id);
  const evaluatorInputInfoId = firstText(receipt.evaluatorInputInfoId, receipt.evaluator_input_info_id);
  return receipt.schemaVersion === "workflow_v2_evaluator_receipt.v1"
    && producerWorkerRunId === row.worker_run_id
    && producerNodeId === row.node_id
    && Boolean(producerOutputInfoId)
    && producerOutputInfoId === evaluatorInputInfoId
    && workflowV2HasStructuredEvaluatorValue(receipt.rubric)
    && Boolean(receipt.reviewArtifactRef || receipt.review_artifact_ref)
    && Boolean(receipt.reviewReceiptRef || receipt.review_receipt_ref)
    && states.has("accepted")
    && states.has("rejected")
    && states.has("needs_revision")
    && workflowV2EvaluatorDecisionStateForReview(receipt.decisionState ?? receipt.decision_state) === workflowV2EvaluatorDecisionStateForReview(row.decision);
}

async function workflowV2AcceptedManagerReviewRows(paths, workflowId, planId, reviewIds = []) {
  if (!workflowId || !planId || !fileExistsSync(paths.dbFile)) {
    return { rows: [], missingIds: reviewIds, nonAcceptedIds: [] };
  }
  if (!reviewIds.length) {
    const rows = await sqlite(paths.dbFile, `
SELECT workflow_v2_manager_reviews.*
FROM workflow_v2_manager_reviews
JOIN workflow_v2_worker_runs w ON w.worker_run_id=workflow_v2_manager_reviews.worker_run_id
WHERE workflow_v2_manager_reviews.workflow_id=${sqlValue(workflowId)}
  AND workflow_v2_manager_reviews.plan_id=${sqlValue(planId)}
  AND workflow_v2_manager_reviews.decision='accepted'
  AND workflow_v2_manager_reviews.worker_run_id!=''
  AND w.workflow_id=workflow_v2_manager_reviews.workflow_id
  AND w.plan_id=workflow_v2_manager_reviews.plan_id
  AND w.manager_agent=workflow_v2_manager_reviews.reviewer_agent
  AND w.status='accepted'
ORDER BY workflow_v2_manager_reviews.created_at DESC;`, { json: true });
    return { rows, missingIds: [], nonAcceptedIds: [] };
  }
  const rows = [];
  const missingIds = [];
  const nonAcceptedIds = [];
  for (const reviewId of reviewIds) {
    const found = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_manager_reviews
WHERE review_id=${sqlValue(reviewId)}
LIMIT 1;`, { json: true });
    const row = found[0];
    if (!row || row.workflow_id !== workflowId || row.plan_id !== planId) {
      missingIds.push(reviewId);
    } else if (row.decision !== "accepted" || !row.worker_run_id) {
      nonAcceptedIds.push(reviewId);
    } else {
      const workerRows = await sqlite(paths.dbFile, `
SELECT worker_run_id
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(row.worker_run_id)}
  AND workflow_id=${sqlValue(row.workflow_id)}
  AND plan_id=${sqlValue(row.plan_id)}
  AND manager_agent=${sqlValue(row.reviewer_agent)}
  AND status='accepted'
LIMIT 1;`, { json: true });
      if (!workerRows[0]) {
        nonAcceptedIds.push(reviewId);
      } else {
        rows.push(row);
      }
    }
  }
  return { rows, missingIds, nonAcceptedIds };
}

async function workflowV2LatestOwnerReviewRow(paths, workflowId, planId) {
  if (!workflowId || !planId || !fileExistsSync(paths.dbFile)) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_owner_reviews
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)}
  AND decision='accepted'
ORDER BY updated_at DESC, created_at DESC
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

async function workflowV2OwnerReviewRow(paths, workflowId, planId, reviewId) {
  if (!reviewId || !fileExistsSync(paths.dbFile)) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_owner_reviews
WHERE review_id=${sqlValue(reviewId)}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  if (!row || row.workflow_id !== workflowId || row.plan_id !== planId) return null;
  return row;
}

async function workflowV2TaskGroupPackageRow(paths, workflowId, planId, packageId) {
  if (!packageId || !fileExistsSync(paths.dbFile)) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_task_group_packages
WHERE package_id=${sqlValue(packageId)}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  if (!row || row.workflow_id !== workflowId || row.plan_id !== planId) return null;
  return row;
}

async function workflowV2CatBrainAuditRow(paths, workflowId, planId, auditId) {
  if (!auditId || !fileExistsSync(paths.dbFile)) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_cat_brain_audits
WHERE audit_id=${sqlValue(auditId)}
LIMIT 1;`, { json: true });
  const row = rows[0] || null;
  if (!row || row.workflow_id !== workflowId || row.plan_id !== planId) return null;
  return row;
}

async function workflowV2ManagerReviewRecord(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  if (String(input.decision || "").trim().toLowerCase() === "blocked") {
    throw new Error("workflow v2 manager review decision blocked is not allowed; use revise_required or needs_human_gate with blocker details");
  }
  const decision = workflowV2NormalizeEnum(input.decision, WORKFLOW_V2_REVIEW_DECISIONS, "revise_required");
  const now = nowIso();
  const review = {
    reviewId: firstText(input.reviewId, input.review_id) || safeId("v2-review"),
    workflowId: firstText(input.workflowId, input.workflow_id),
    planId: firstText(input.planId, input.plan_id),
    nodeId: firstText(input.nodeId, input.node_id),
    workerRunId: firstText(input.workerRunId, input.worker_run_id),
    reviewerAgent: normalizeOptionalAgentId(firstText(input.reviewerAgent, input.reviewer_agent, input.callerAgent, input.caller_agent, "cat_heart")) || "cat_heart",
    decision,
    summary: firstText(input.summary, input.text),
    findings: workflowV2JsonArray(input.findings, []),
    artifactRefs: workflowV2JsonArray(input.artifactRefs ?? input.artifact_refs, []),
    receiptRefs: workflowV2JsonArray(input.receiptRefs ?? input.receipt_refs, []),
    blocker: workflowV2JsonObject(input.blocker ?? input.blocker_json ?? input.blockerJson, {}),
    payload: workflowV2JsonObject(input.payload, {})
  };
  if (!review.workflowId || !review.planId) throw new Error("workflow v2 manager review requires workflowId and planId");
  if (!review.workerRunId) throw new Error("workflow v2 manager review requires workerRunId; manager reviews must be bound to a submitted worker run");
  let workerStatus = "";
  let nextLastError = "";
  let workerSessionRunId = "";
  let previousWorkerRow = null;
  let reviewWorkerRow = null;
  const existingReviewRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_manager_reviews WHERE review_id=${sqlValue(review.reviewId)} LIMIT 1;`, { json: true });
  const previousReviewRow = existingReviewRows[0] || null;
  if (review.workerRunId) {
    const workerRows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_worker_runs
WHERE worker_run_id=${sqlValue(review.workerRunId)}
LIMIT 1;`, { json: true });
    const worker = workerRows[0];
    if (!worker) throw new Error(`workflow v2 manager review worker run not found: ${review.workerRunId}`);
    previousWorkerRow = worker;
    reviewWorkerRow = worker;
    if (review.workflowId && worker.workflow_id !== review.workflowId) throw new Error("workflow v2 manager review workflowId does not match worker run");
    if (review.planId && worker.plan_id !== review.planId) throw new Error("workflow v2 manager review planId does not match worker run");
    if (review.nodeId && worker.node_id !== review.nodeId) throw new Error("workflow v2 manager review nodeId does not match worker run");
    review.nodeId = review.nodeId || worker.node_id || "";
    if (worker.manager_agent && review.reviewerAgent !== worker.manager_agent) {
      throw new Error(`workflow v2 manager review reviewer_agent_not_worker_manager: expected ${worker.manager_agent}, got ${review.reviewerAgent}`);
    }
    if (worker.status !== "submitted_for_review") {
      throw new Error(`workflow v2 manager review requires worker status submitted_for_review, got ${worker.status || "unknown"}`);
    }
    workerSessionRunId = worker.session_run_id || "";
    const workerStatusByDecision = {
      accepted: "accepted",
      rejected: "rejected",
      revise_required: "revise_required",
      needs_human_gate: "needs_human_gate"
    };
    workerStatus = workerStatusByDecision[decision] || "submitted_for_review";
    if (["accepted", "rejected", "revise_required", "needs_human_gate"].includes(workerStatus) && (!worker.output_info_id || !worker.receipt_ref || !worker.completed_at)) {
      throw new Error(`workflow v2 manager review decision ${decision} requires worker output_info_id, receipt_ref, and completed_at`);
    }
    nextLastError = ["rejected", "revise_required"].includes(workerStatus) ? review.summary : "";
  }
  const planPattern = await workflowV2PlanOrchestrationPattern(paths, review.workflowId, review.planId);
  if (planPattern === "evaluator_optimizer") {
    const evaluatorReceipt = workflowV2EvaluatorReceiptPayload(input, review, reviewWorkerRow || {});
    const evaluatorErrors = workflowV2EvaluatorReceiptErrors(evaluatorReceipt, review, reviewWorkerRow || {});
    if (evaluatorErrors.length) {
      throw new Error(`workflow v2 evaluator review is invalid: ${evaluatorErrors.map((item) => item.code).join(",")}`);
    }
    review.payload = {
      ...review.payload,
      evaluatorReceipt
    };
  }
  try {
    await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_manager_reviews(review_id, workflow_id, plan_id, node_id, worker_run_id, reviewer_agent, decision, summary, findings_json, artifact_refs_json, receipt_refs_json, blocker_json, payload_json, created_at)
VALUES (${sqlValue(review.reviewId)}, ${sqlValue(review.workflowId)}, ${sqlValue(review.planId)}, ${sqlValue(review.nodeId)}, ${sqlValue(review.workerRunId)}, ${sqlValue(review.reviewerAgent)}, ${sqlValue(review.decision)}, ${sqlValue(review.summary)}, ${sqlValue(JSON.stringify(review.findings))}, ${sqlValue(JSON.stringify(review.artifactRefs))}, ${sqlValue(JSON.stringify(review.receiptRefs))}, ${sqlValue(JSON.stringify(review.blocker))}, ${sqlValue(JSON.stringify(review.payload))}, ${sqlValue(now)})
ON CONFLICT(review_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  node_id=excluded.node_id,
  worker_run_id=excluded.worker_run_id,
  reviewer_agent=excluded.reviewer_agent,
  decision=excluded.decision,
  summary=excluded.summary,
  findings_json=excluded.findings_json,
  artifact_refs_json=excluded.artifact_refs_json,
  receipt_refs_json=excluded.receipt_refs_json,
  blocker_json=excluded.blocker_json,
  payload_json=excluded.payload_json;`);
    if (review.workerRunId) {
      const changed = await sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_worker_runs
SET status=${sqlValue(workerStatus)},
    lease_owner='',
    lease_until='',
    next_retry_at='',
    last_error=${sqlValue(nextLastError)},
    completed_at=CASE WHEN completed_at='' THEN ${sqlValue(now)} ELSE completed_at END,
    updated_at=${sqlValue(now)}
WHERE worker_run_id=${sqlValue(review.workerRunId)}
  AND status='submitted_for_review'
  AND manager_agent=${sqlValue(review.reviewerAgent)};`);
      if (changed !== 1) throw new Error("workflow v2 manager review lost worker review state before update");
      const sessionStatusByWorkerStatus = {
        accepted: "completed",
        rejected: "completed",
        revise_required: "completed",
        needs_human_gate: "completed"
      };
      const sessionStatus = sessionStatusByWorkerStatus[workerStatus];
      if (sessionStatus) {
        await workflowV2RequireSessionRunPatch(paths, workerSessionRunId, {
          status: sessionStatus,
          error: nextLastError,
          timestamp: now
        }, "manager review");
      }
    }
  } catch (error) {
    if (previousWorkerRow) await workflowV2RestoreWorkerRunRow(paths, previousWorkerRow);
    await workflowV2RestoreManagerReviewRow(paths, previousReviewRow, review.reviewId);
    throw error;
  }
  return { operation: "workflow.v2.manager_review.record", review, dbFile: paths.dbFile };
}

async function workflowV2OwnerReviewPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  if (!workflowId) errors.push(workflowV2ValidationError("workflow_id_required", "owner review requires workflowId"));
  if (!planId) errors.push(workflowV2ValidationError("plan_id_required", "owner review requires planId"));
  const planRow = await workflowV2LoadPlanRow(paths, workflowId, planId);
  if (workflowId && planId && !planRow) errors.push(workflowV2ValidationError("plan_not_found", "owner review requires an existing v2 plan", { workflowId, planId }));
  if (String(input.decision || "").trim().toLowerCase() === "blocked") {
    errors.push(workflowV2ValidationError("blocked_decision_not_allowed", "owner review decision blocked is not allowed; use revise_required or needs_human_gate with findings"));
  }
  const decision = workflowV2NormalizeEnum(input.decision, WORKFLOW_V2_REVIEW_DECISIONS, "accepted");
  const plan = workflowV2PlanSummary(planRow);
  const ownerAgent = normalizeOptionalAgentId(firstText(input.ownerAgent, input.owner_agent, plan?.taskOwnerAgent, "cat_heart")) || "cat_heart";
  const callerAgent = normalizeOptionalAgentId(firstText(input.callerAgent, input.caller_agent, input.createdBy, input.created_by, ownerAgent)) || ownerAgent;
  if (plan?.taskOwnerAgent && ownerAgent !== plan.taskOwnerAgent) {
    errors.push(workflowV2ValidationError("owner_agent_mismatch", "owner review ownerAgent must match plan task owner", { expectedOwnerAgent: plan.taskOwnerAgent, ownerAgent }));
  }
  if (plan?.taskOwnerAgent && callerAgent !== plan.taskOwnerAgent) {
    errors.push(workflowV2ValidationError("caller_agent_not_authorized", "only the plan task owner may record owner review", { expectedCallerAgent: plan.taskOwnerAgent, callerAgent }));
  }
  const requestedReviewIds = workflowV2UniqueTextList(input.managerReviewIds ?? input.manager_review_ids ?? input.managerReviewRefs ?? input.manager_review_refs, []);
  const managerReviewSet = await workflowV2AcceptedManagerReviewRows(paths, workflowId, planId, requestedReviewIds);
  if (managerReviewSet.missingIds.length) {
    errors.push(workflowV2ValidationError("manager_review_not_found", "owner review references unknown manager review ids", { missingIds: managerReviewSet.missingIds }));
  }
  if (managerReviewSet.nonAcceptedIds.length) {
    errors.push(workflowV2ValidationError("manager_review_not_accepted", "owner review may only accept accepted manager review outputs", { nonAcceptedIds: managerReviewSet.nonAcceptedIds }));
  }
  const planPattern = await workflowV2PlanOrchestrationPattern(paths, workflowId, planId);
  if (planPattern === "evaluator_optimizer" && managerReviewSet.rows.length) {
    const nonEvaluatorReviewIds = managerReviewSet.rows
      .filter((row) => !workflowV2ManagerReviewHasEvaluatorReceipt(row))
      .map((row) => row.review_id)
      .filter(Boolean);
    if (nonEvaluatorReviewIds.length) {
      errors.push(workflowV2ValidationError(
        "evaluator_review_receipt_required",
        "evaluator_optimizer owner review may only consume accepted evaluator receipts",
        { nonEvaluatorReviewIds }
      ));
    }
  }
  const allowNoManagerReviews = boolOption(input.allowNoManagerReviews ?? input.allow_no_manager_reviews, false);
  if (planPattern === "evaluator_optimizer" && allowNoManagerReviews && !managerReviewSet.rows.length) {
    errors.push(workflowV2ValidationError(
      "evaluator_review_required",
      "evaluator_optimizer owner review requires accepted evaluator receipts and cannot use allowNoManagerReviews"
    ));
  }
  if (!managerReviewSet.rows.length && !allowNoManagerReviews) {
    errors.push(workflowV2ValidationError("manager_review_required", "owner review requires accepted manager reviews unless allowNoManagerReviews is explicitly set"));
  }
  const artifactRefs = workflowV2UniqueTextList(input.artifactRefs ?? input.artifact_refs, managerReviewSet.rows.flatMap((row) => workflowV2JsonArray(row.artifact_refs_json, [])));
  const receiptRefs = workflowV2UniqueTextList(input.receiptRefs ?? input.receipt_refs, managerReviewSet.rows.flatMap((row) => workflowV2JsonArray(row.receipt_refs_json, [])));
  if (!managerReviewSet.rows.length && allowNoManagerReviews && !artifactRefs.length && !receiptRefs.length) {
    errors.push(workflowV2ValidationError("owner_direct_evidence_required", "owner-direct review requires artifactRefs or receiptRefs when no manager reviews are used"));
  }
  const taskGroupRequired = boolOption(input.taskGroupRequired ?? input.task_group_required, managerReviewSet.rows.length > 1);
  const nextWorkflowState = decision === "accepted"
    ? taskGroupRequired ? "waiting_group_discussion" : "waiting_cat_brain_check"
    : decision === "needs_human_gate" ? "waiting_cat_brain_check" : "waiting_manager";
  const review = {
    reviewId: firstText(input.reviewId, input.review_id) || safeId("v2-owner-review"),
    workflowId,
    planId,
    ownerAgent,
    callerAgent,
    decision,
    summary: firstText(input.summary, input.text),
    managerReviewRefs: managerReviewSet.rows.map((row) => row.review_id),
    managerReviews: managerReviewSet.rows.map(workflowV2ManagerReviewSummary),
    artifactRefs,
    receiptRefs,
    findings: workflowV2JsonArray(input.findings, []),
    payload: {
      ...workflowV2JsonObject(input.payload, {}),
      allowNoManagerReviews,
      taskGroupRequired,
      nextWorkflowState
    },
    nextWorkflowState
  };
  return {
    operation: "workflow.v2.owner_review.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    ownerReview: review,
    plan,
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2OwnerReviewRecord(rootDir, input = {}) {
  const preview = await workflowV2OwnerReviewPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 owner review is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const review = preview.ownerReview;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_owner_reviews(review_id, workflow_id, plan_id, owner_agent, decision, summary, manager_review_refs_json, artifact_refs_json, receipt_refs_json, findings_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(review.reviewId)}, ${sqlValue(review.workflowId)}, ${sqlValue(review.planId)}, ${sqlValue(review.ownerAgent)}, ${sqlValue(review.decision)}, ${sqlValue(review.summary)}, ${sqlValue(JSON.stringify(review.managerReviewRefs))}, ${sqlValue(JSON.stringify(review.artifactRefs))}, ${sqlValue(JSON.stringify(review.receiptRefs))}, ${sqlValue(JSON.stringify(review.findings))}, ${sqlValue(JSON.stringify(review.payload))}, ${sqlValue(review.callerAgent)}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(review_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  owner_agent=excluded.owner_agent,
  decision=excluded.decision,
  summary=excluded.summary,
  manager_review_refs_json=excluded.manager_review_refs_json,
  artifact_refs_json=excluded.artifact_refs_json,
  receipt_refs_json=excluded.receipt_refs_json,
  findings_json=excluded.findings_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  updated_at=excluded.updated_at;`);
  await workflowV2PatchPlanWorkflowState(paths, review.workflowId, review.planId, review.nextWorkflowState, now);
  return { ...preview, operation: "workflow.v2.owner_review.record", dryRun: false, previewOnly: false, dbFile: paths.dbFile };
}

async function workflowV2TaskGroupPackagePreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  if (!workflowId) errors.push(workflowV2ValidationError("workflow_id_required", "task group package requires workflowId"));
  if (!planId) errors.push(workflowV2ValidationError("plan_id_required", "task group package requires planId"));
  const planRow = await workflowV2LoadPlanRow(paths, workflowId, planId);
  if (workflowId && planId && !planRow) errors.push(workflowV2ValidationError("plan_not_found", "task group package requires an existing v2 plan", { workflowId, planId }));
  const plan = workflowV2PlanSummary(planRow);
  const ownerReviewId = firstText(input.ownerReviewId, input.owner_review_id) || (await workflowV2LatestOwnerReviewRow(paths, workflowId, planId))?.review_id || "";
  const ownerReviewRow = await workflowV2OwnerReviewRow(paths, workflowId, planId, ownerReviewId);
  if (!ownerReviewId || !ownerReviewRow) {
    errors.push(workflowV2ValidationError("owner_review_not_found", "task group package requires an accepted owner review", { ownerReviewId }));
  } else if (ownerReviewRow.decision !== "accepted") {
    errors.push(workflowV2ValidationError("owner_review_not_accepted", "task group package requires an accepted owner review", { ownerReviewId, decision: ownerReviewRow.decision }));
  }
  const ownerReview = workflowV2OwnerReviewSummary(ownerReviewRow);
  const taskOwnerAgent = normalizeOptionalAgentId(firstText(input.taskOwnerAgent, input.task_owner_agent, plan?.taskOwnerAgent, ownerReview?.ownerAgent, "cat_heart")) || "cat_heart";
  const callerAgent = normalizeOptionalAgentId(firstText(input.callerAgent, input.caller_agent, input.createdBy, input.created_by, taskOwnerAgent)) || taskOwnerAgent;
  if (plan?.taskOwnerAgent && callerAgent !== plan.taskOwnerAgent) {
    errors.push(workflowV2ValidationError("caller_agent_not_authorized", "only the plan task owner may record task group package", { expectedCallerAgent: plan.taskOwnerAgent, callerAgent }));
  }
  const ownerManagerRefs = ownerReview?.managerReviewRefs || [];
  const managerReviewRows = ownerManagerRefs.length ? (await workflowV2AcceptedManagerReviewRows(paths, workflowId, planId, ownerManagerRefs)).rows : [];
  const defaultGroupAgents = [
    taskOwnerAgent,
    "cat_body",
    ...managerReviewRows.map((row) => row.reviewer_agent),
    ...(plan?.participantManagers || [])
  ];
  const taskGroupAgents = workflowV2UniqueTextList(input.taskGroupAgents ?? input.task_group_agents ?? input.participantAgents ?? input.participant_agents, defaultGroupAgents)
    .map((agent) => normalizeOptionalAgentId(agent))
    .filter(Boolean);
  const status = workflowV2NormalizeEnum(input.status, WORKFLOW_V2_TASK_GROUP_PACKAGE_STATUSES, "ready");
  const artifactRefs = workflowV2UniqueTextList(input.artifactRefs ?? input.artifact_refs, ownerReview?.artifactRefs || []);
  const evidenceRefs = workflowV2UniqueTextList(input.evidenceRefs ?? input.evidence_refs, [
    ...(ownerReview?.receiptRefs || []),
    ...(ownerReview?.artifactRefs || [])
  ]);
  const pkg = {
    packageId: firstText(input.packageId, input.package_id) || safeId("v2-task-group-package"),
    workflowId,
    planId,
    ownerReviewId,
    taskOwnerAgent,
    callerAgent,
    taskGroupAgents,
    status,
    summary: firstText(input.summary, input.text, ownerReview?.summary),
    managerReviewRefs: ownerManagerRefs,
    ownerReviewRefs: ownerReviewId ? [ownerReviewId] : [],
    artifactRefs,
    evidenceRefs,
    payload: {
      ...workflowV2JsonObject(input.payload, {}),
      taskGroupRequired: boolOption(input.taskGroupRequired ?? input.task_group_required, taskGroupAgents.length > 1),
      nextWorkflowState: status === "ready" ? "waiting_cat_brain_check" : "waiting_group_discussion"
    }
  };
  return {
    operation: "workflow.v2.task_group_package.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    taskGroupPackage: pkg,
    ownerReview,
    plan,
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2TaskGroupPackageRecord(rootDir, input = {}) {
  const preview = await workflowV2TaskGroupPackagePreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 task group package is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const pkg = preview.taskGroupPackage;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_task_group_packages(package_id, workflow_id, plan_id, owner_review_id, task_owner_agent, task_group_agents_json, status, summary, manager_review_refs_json, owner_review_refs_json, artifact_refs_json, evidence_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(pkg.packageId)}, ${sqlValue(pkg.workflowId)}, ${sqlValue(pkg.planId)}, ${sqlValue(pkg.ownerReviewId)}, ${sqlValue(pkg.taskOwnerAgent)}, ${sqlValue(JSON.stringify(pkg.taskGroupAgents))}, ${sqlValue(pkg.status)}, ${sqlValue(pkg.summary)}, ${sqlValue(JSON.stringify(pkg.managerReviewRefs))}, ${sqlValue(JSON.stringify(pkg.ownerReviewRefs))}, ${sqlValue(JSON.stringify(pkg.artifactRefs))}, ${sqlValue(JSON.stringify(pkg.evidenceRefs))}, ${sqlValue(JSON.stringify(pkg.payload))}, ${sqlValue(pkg.callerAgent)}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(package_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  owner_review_id=excluded.owner_review_id,
  task_owner_agent=excluded.task_owner_agent,
  task_group_agents_json=excluded.task_group_agents_json,
  status=excluded.status,
  summary=excluded.summary,
  manager_review_refs_json=excluded.manager_review_refs_json,
  owner_review_refs_json=excluded.owner_review_refs_json,
  artifact_refs_json=excluded.artifact_refs_json,
  evidence_refs_json=excluded.evidence_refs_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  updated_at=excluded.updated_at;`);
  await workflowV2PatchPlanWorkflowState(paths, pkg.workflowId, pkg.planId, pkg.payload.nextWorkflowState, now);
  return { ...preview, operation: "workflow.v2.task_group_package.record", dryRun: false, previewOnly: false, dbFile: paths.dbFile };
}

async function workflowV2CatBrainAuditPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  const taskGroupPackageId = firstText(input.taskGroupPackageId, input.task_group_package_id, input.packageId, input.package_id);
  const ownerReviewId = firstText(input.ownerReviewId, input.owner_review_id, input.sourceReviewId, input.source_review_id);
  if (!workflowId) errors.push(workflowV2ValidationError("workflow_id_required", "Cat Brain audit requires workflowId"));
  if (!planId) errors.push(workflowV2ValidationError("plan_id_required", "Cat Brain audit requires planId"));
  if (!taskGroupPackageId && !ownerReviewId) {
    errors.push(workflowV2ValidationError("cat_brain_audit_source_required", "Cat Brain audit requires taskGroupPackageId or an accepted ownerReviewId/sourceReviewId"));
  }
  const planRow = await workflowV2LoadPlanRow(paths, workflowId, planId);
  if (workflowId && planId && !planRow) errors.push(workflowV2ValidationError("plan_not_found", "Cat Brain audit requires an existing v2 plan", { workflowId, planId }));
  const taskGroupPackageRow = taskGroupPackageId ? await workflowV2TaskGroupPackageRow(paths, workflowId, planId, taskGroupPackageId) : null;
  const ownerReviewRow = !taskGroupPackageId && ownerReviewId ? await workflowV2OwnerReviewRow(paths, workflowId, planId, ownerReviewId) : null;
  if (taskGroupPackageId && !taskGroupPackageRow) {
    errors.push(workflowV2ValidationError("task_group_package_not_found", "Cat Brain audit requires a task group package for the same workflow and plan", { taskGroupPackageId }));
  } else if (taskGroupPackageRow && taskGroupPackageRow.status !== "ready") {
    errors.push(workflowV2ValidationError("task_group_package_not_ready", "Cat Brain audit requires a ready task group package", { taskGroupPackageId, status: taskGroupPackageRow.status }));
  }
  if (!taskGroupPackageId && ownerReviewId && !ownerReviewRow) {
    errors.push(workflowV2ValidationError("owner_review_not_found", "Cat Brain owner-direct audit requires an owner review for the same workflow and plan", { ownerReviewId }));
  } else if (ownerReviewRow && ownerReviewRow.decision !== "accepted") {
    errors.push(workflowV2ValidationError("owner_review_not_accepted", "Cat Brain owner-direct audit requires an accepted owner review", { ownerReviewId, decision: ownerReviewRow.decision }));
  }
  if (String(input.decision || "").trim().toLowerCase() === "blocked") {
    errors.push(workflowV2ValidationError("blocked_decision_not_allowed", "Cat Brain audit decision blocked is not allowed; use revision_required, rejected, or needs_human_gate"));
  }
  const catBrainAgent = normalizeOptionalAgentId(firstText(input.catBrainAgent, input.cat_brain_agent, "main")) || "main";
  const callerAgent = normalizeOptionalAgentId(firstText(input.callerAgent, input.caller_agent, input.createdBy, input.created_by, catBrainAgent)) || catBrainAgent;
  if (catBrainAgent !== "main" || callerAgent !== "main") {
    errors.push(workflowV2ValidationError("caller_agent_not_authorized", "Cat Brain governance audit must be recorded by main", { catBrainAgent, callerAgent }));
  }
  const decision = workflowV2NormalizeEnum(input.decision, WORKFLOW_V2_CAT_BRAIN_AUDIT_DECISIONS, "approved");
  const pkg = workflowV2TaskGroupPackageSummary(taskGroupPackageRow);
  const ownerReview = workflowV2OwnerReviewSummary(ownerReviewRow);
  const evidenceRefs = workflowV2UniqueTextList(input.evidenceRefs ?? input.evidence_refs, pkg?.evidenceRefs || [
    ...(ownerReview?.receiptRefs || []),
    ...(ownerReview?.artifactRefs || [])
  ]);
  const audit = {
    auditId: firstText(input.auditId, input.audit_id) || safeId("v2-cat-brain-audit"),
    workflowId,
    planId,
    taskGroupPackageId: taskGroupPackageId || "",
    catBrainAgent,
    callerAgent,
    decision,
    scope: firstText(input.scope, "governance_semantic"),
    summary: firstText(input.summary, input.text),
    findings: workflowV2JsonArray(input.findings, []),
    evidenceRefs,
    payload: {
      ...workflowV2JsonObject(input.payload, {}),
      sourceKind: taskGroupPackageId ? "task_group_package" : "owner_review",
      sourceOwnerReviewId: ownerReviewId || "",
      nextWorkflowState: ["approved", "needs_human_gate"].includes(decision) ? "waiting_cat_claw_audit" : "waiting_group_discussion"
    }
  };
  return {
    operation: "workflow.v2.cat_brain_audit.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    catBrainAudit: audit,
    taskGroupPackage: pkg,
    ownerReview,
    plan: workflowV2PlanSummary(planRow),
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2CatBrainAuditRecord(rootDir, input = {}) {
  const preview = await workflowV2CatBrainAuditPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 Cat Brain audit is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const audit = preview.catBrainAudit;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_cat_brain_audits(audit_id, workflow_id, plan_id, task_group_package_id, cat_brain_agent, decision, scope, summary, findings_json, evidence_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(audit.auditId)}, ${sqlValue(audit.workflowId)}, ${sqlValue(audit.planId)}, ${sqlValue(audit.taskGroupPackageId)}, ${sqlValue(audit.catBrainAgent)}, ${sqlValue(audit.decision)}, ${sqlValue(audit.scope)}, ${sqlValue(audit.summary)}, ${sqlValue(JSON.stringify(audit.findings))}, ${sqlValue(JSON.stringify(audit.evidenceRefs))}, ${sqlValue(JSON.stringify(audit.payload))}, ${sqlValue(audit.callerAgent)}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(audit_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  task_group_package_id=excluded.task_group_package_id,
  cat_brain_agent=excluded.cat_brain_agent,
  decision=excluded.decision,
  scope=excluded.scope,
  summary=excluded.summary,
  findings_json=excluded.findings_json,
  evidence_refs_json=excluded.evidence_refs_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  updated_at=excluded.updated_at;`);
  await workflowV2PatchPlanWorkflowState(paths, audit.workflowId, audit.planId, audit.payload.nextWorkflowState, now);
  return { ...preview, operation: "workflow.v2.cat_brain_audit.record", dryRun: false, previewOnly: false, dbFile: paths.dbFile };
}

async function workflowV2CatClawAuditPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  const catBrainAuditId = firstText(input.catBrainAuditId, input.cat_brain_audit_id, input.auditSourceId, input.audit_source_id);
  if (!workflowId) errors.push(workflowV2ValidationError("workflow_id_required", "Cat Claw audit requires workflowId"));
  if (!planId) errors.push(workflowV2ValidationError("plan_id_required", "Cat Claw audit requires planId"));
  if (!catBrainAuditId) errors.push(workflowV2ValidationError("cat_brain_audit_id_required", "Cat Claw audit requires catBrainAuditId"));
  const planRow = await workflowV2LoadPlanRow(paths, workflowId, planId);
  if (workflowId && planId && !planRow) errors.push(workflowV2ValidationError("plan_not_found", "Cat Claw audit requires an existing v2 plan", { workflowId, planId }));
  const brainAuditRow = await workflowV2CatBrainAuditRow(paths, workflowId, planId, catBrainAuditId);
  if (!brainAuditRow) {
    errors.push(workflowV2ValidationError("cat_brain_audit_not_found", "Cat Claw audit requires Cat Brain audit evidence for the same workflow and plan", { catBrainAuditId }));
  } else if (!["approved", "needs_human_gate"].includes(brainAuditRow.decision)) {
    errors.push(workflowV2ValidationError("cat_brain_audit_not_approved", "Cat Claw audit requires Cat Brain approved or needs_human_gate decision", { catBrainAuditId, decision: brainAuditRow.decision }));
  }
  if (String(input.decision || "").trim().toLowerCase() === "blocked") {
    errors.push(workflowV2ValidationError("blocked_decision_not_allowed", "Cat Claw audit decision blocked is not allowed; use protocol_revision_required or rejected"));
  }
  const catClawAgent = normalizeOptionalAgentId(firstText(input.catClawAgent, input.cat_claw_agent, "cat_claw")) || "cat_claw";
  const callerAgent = normalizeOptionalAgentId(firstText(input.callerAgent, input.caller_agent, input.createdBy, input.created_by, catClawAgent)) || catClawAgent;
  if (catClawAgent !== "cat_claw" || callerAgent !== "cat_claw") {
    errors.push(workflowV2ValidationError("caller_agent_not_authorized", "Cat Claw protocol audit must be recorded by cat_claw", { catClawAgent, callerAgent }));
  }
  const decision = workflowV2NormalizeEnum(input.decision, WORKFLOW_V2_CAT_CLAW_AUDIT_DECISIONS, "protocol_ready");
  const brainAudit = workflowV2CatBrainAuditSummary(brainAuditRow);
  const evidenceRefs = workflowV2UniqueTextList(input.evidenceRefs ?? input.evidence_refs, brainAudit?.evidenceRefs || []);
  if (decision === "protocol_ready" && !evidenceRefs.length) {
    errors.push(workflowV2ValidationError("evidence_refs_required", "Cat Claw protocol_ready audit requires evidenceRefs"));
  }
  const audit = {
    auditId: firstText(input.auditId, input.audit_id) || safeId("v2-cat-claw-audit"),
    workflowId,
    planId,
    catBrainAuditId,
    catClawAgent,
    callerAgent,
    decision,
    summary: firstText(input.summary, input.text),
    checks: workflowV2JsonArray(input.checks, []),
    evidenceRefs,
    payload: {
      ...workflowV2JsonObject(input.payload, {}),
      nextWorkflowState: decision === "protocol_ready" ? "human_gate_request_due" : "waiting_cat_brain_check"
    }
  };
  return {
    operation: "workflow.v2.cat_claw_audit.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    catClawAudit: audit,
    catBrainAudit: brainAudit,
    plan: workflowV2PlanSummary(planRow),
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2CatClawAuditRecord(rootDir, input = {}) {
  const preview = await workflowV2CatClawAuditPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 Cat Claw audit is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const audit = preview.catClawAudit;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_cat_claw_audits(audit_id, workflow_id, plan_id, cat_brain_audit_id, cat_claw_agent, decision, summary, checks_json, evidence_refs_json, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(audit.auditId)}, ${sqlValue(audit.workflowId)}, ${sqlValue(audit.planId)}, ${sqlValue(audit.catBrainAuditId)}, ${sqlValue(audit.catClawAgent)}, ${sqlValue(audit.decision)}, ${sqlValue(audit.summary)}, ${sqlValue(JSON.stringify(audit.checks))}, ${sqlValue(JSON.stringify(audit.evidenceRefs))}, ${sqlValue(JSON.stringify(audit.payload))}, ${sqlValue(audit.callerAgent)}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(audit_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  cat_brain_audit_id=excluded.cat_brain_audit_id,
  cat_claw_agent=excluded.cat_claw_agent,
  decision=excluded.decision,
  summary=excluded.summary,
  checks_json=excluded.checks_json,
  evidence_refs_json=excluded.evidence_refs_json,
  payload_json=excluded.payload_json,
  created_by=excluded.created_by,
  updated_at=excluded.updated_at;`);
  await workflowV2PatchPlanWorkflowState(paths, audit.workflowId, audit.planId, audit.payload.nextWorkflowState, now);
  return { ...preview, operation: "workflow.v2.cat_claw_audit.record", dryRun: false, previewOnly: false, dbFile: paths.dbFile };
}

  return {
    workflowV2ManagerReviewRecord,
    workflowV2OwnerReviewPreview,
    workflowV2OwnerReviewRecord,
    workflowV2TaskGroupPackagePreview,
    workflowV2TaskGroupPackageRecord,
    workflowV2CatBrainAuditPreview,
    workflowV2CatBrainAuditRecord,
    workflowV2CatClawAuditPreview,
    workflowV2CatClawAuditRecord
  };
}
