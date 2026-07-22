function workflowV2ParseJsonValue(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function workflowV2ToList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

export function workflowV2JsonObject(value, fallback = {}) {
  const parsed = workflowV2ParseJsonValue(value, fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

export function workflowV2JsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return fallback;
    if (text.startsWith("[")) {
      const parsed = workflowV2ParseJsonValue(text, fallback);
      return Array.isArray(parsed) ? parsed : fallback;
    }
    return workflowV2ToList(text);
  }
  return fallback;
}

export function workflowV2NormalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback || "").trim().toLowerCase().replace(/-/g, "_");
  return allowed.has(normalized) ? normalized : fallback;
}

export function workflowV2NormalizeBackend(value, fallback = "hermers_docker_worker") {
  return String(value || fallback || "").trim().toLowerCase().replace(/-/g, "_");
}

export function workflowV2NonNegativeInt(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(0, Math.floor(Number(fallback) || 0));
  return Math.max(0, Math.floor(number));
}

export function workflowV2OptionalNonNegativeInt(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.floor(number));
}

export function workflowV2ValidationError(code, message, details = {}) {
  return { code, message, ...details };
}

export function workflowV2ValidationAdvisory(code, message, details = {}) {
  return { code, message, severity: "advisory", ...details };
}

export function workflowV2WorkerSessionRunInput(run = {}) {
  return {
    schemaVersion: "workflow_v2_worker_session_input.v1",
    workflowId: run.workflowId || "",
    planId: run.planId || "",
    nodeId: run.nodeId || "",
    workerRunId: run.workerRunId || "",
    parentWorkerRunId: run.parentWorkerRunId || "",
    supersedesWorkerRunId: run.supersedesWorkerRunId || "",
    workerGeneration: workflowV2NonNegativeInt(run.workerGeneration, 0),
    managerAgent: run.managerAgent || "",
    workerAgentId: run.workerAgentId || "",
    runtimeBackend: run.runtimeBackend || "",
    taskInputInfoId: run.taskInputInfoId || "",
    expectedOutputInfoId: run.outputInfoId || "",
    handoffInfoId: run.handoffInfoId || "",
    sourceContextRefs: workflowV2JsonArray(run.sourceContextRefs, []),
    context: {
      budgetTokens: workflowV2NonNegativeInt(run.contextBudgetTokens, 0),
      usedTokens: workflowV2NonNegativeInt(run.contextUsedTokens, 0),
      compactionCount: workflowV2NonNegativeInt(run.compactionCount, 0)
    },
    receiptRequired: true,
    reviewRequired: true,
    workerPayload: workflowV2JsonObject(run.payload, {})
  };
}

export function workflowV2ErrorMessage(error) {
  return String(error?.message || error || "unknown error").slice(0, 2000);
}

export function workflowV2UniqueTextList(value, fallback = []) {
  const items = workflowV2JsonArray(value, fallback);
  return Array.from(new Set(items.map((item) => String(item || "").trim()).filter(Boolean)));
}

export function workflowV2PlanSummary(row = {}) {
  if (!row) return null;
  return {
    planId: row.plan_id || "",
    workflowId: row.workflow_id || "",
    status: row.status || "",
    workflowState: row.workflow_state || "",
    taskOwnerAgent: row.task_owner_agent || "",
    plannerAgent: row.planner_agent || "",
    participantManagers: workflowV2JsonArray(row.participant_managers_json, []),
    objective: row.objective || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function workflowV2ManagerReviewSummary(row = {}) {
  if (!row) return null;
  return {
    reviewId: row.review_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    nodeId: row.node_id || "",
    workerRunId: row.worker_run_id || "",
    reviewerAgent: row.reviewer_agent || "",
    decision: row.decision || "",
    summary: row.summary || "",
    findings: workflowV2JsonArray(row.findings_json, []),
    artifactRefs: workflowV2JsonArray(row.artifact_refs_json, []),
    receiptRefs: workflowV2JsonArray(row.receipt_refs_json, []),
    blocker: workflowV2JsonObject(row.blocker_json, {}),
    createdAt: row.created_at || ""
  };
}

export function workflowV2OwnerReviewSummary(row = {}) {
  if (!row) return null;
  return {
    reviewId: row.review_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    ownerAgent: row.owner_agent || "",
    decision: row.decision || "",
    summary: row.summary || "",
    managerReviewRefs: workflowV2JsonArray(row.manager_review_refs_json, []),
    artifactRefs: workflowV2JsonArray(row.artifact_refs_json, []),
    receiptRefs: workflowV2JsonArray(row.receipt_refs_json, []),
    findings: workflowV2JsonArray(row.findings_json, []),
    payload: workflowV2JsonObject(row.payload_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function workflowV2TaskGroupPackageSummary(row = {}) {
  if (!row) return null;
  return {
    packageId: row.package_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    ownerReviewId: row.owner_review_id || "",
    taskOwnerAgent: row.task_owner_agent || "",
    taskGroupAgents: workflowV2JsonArray(row.task_group_agents_json, []),
    status: row.status || "",
    summary: row.summary || "",
    managerReviewRefs: workflowV2JsonArray(row.manager_review_refs_json, []),
    ownerReviewRefs: workflowV2JsonArray(row.owner_review_refs_json, []),
    artifactRefs: workflowV2JsonArray(row.artifact_refs_json, []),
    evidenceRefs: workflowV2JsonArray(row.evidence_refs_json, []),
    payload: workflowV2JsonObject(row.payload_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function workflowV2GovernanceAuditSummary(row = {}) {
  if (!row) return null;
  return {
    auditId: row.audit_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    taskGroupPackageId: row.task_group_package_id || "",
    catBrainAgent: row.cat_brain_agent || "",
    decision: row.decision || "",
    scope: row.scope || "",
    summary: row.summary || "",
    findings: workflowV2JsonArray(row.findings_json, []),
    evidenceRefs: workflowV2JsonArray(row.evidence_refs_json, []),
    payload: workflowV2JsonObject(row.payload_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function workflowV2ProtocolAuditSummary(row = {}) {
  if (!row) return null;
  return {
    auditId: row.audit_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    governanceAuditId: row.governance_audit_id || "",
    catClawAgent: row.cat_claw_agent || "",
    decision: row.decision || "",
    summary: row.summary || "",
    checks: workflowV2JsonArray(row.checks_json, []),
    evidenceRefs: workflowV2JsonArray(row.evidence_refs_json, []),
    payload: workflowV2JsonObject(row.payload_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function workflowV2HumanGatePackageSummary(row = {}) {
  if (!row) return null;
  return {
    packageId: row.package_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    sourceReviewId: row.source_review_id || "",
    sourceProtocolAuditId: row.source_protocol_audit_id || "",
    catBrainAgent: row.cat_brain_agent || "",
    catClawAgent: row.cat_claw_agent || "",
    status: row.status || "",
    options: workflowV2JsonArray(row.options_json, []),
    requiredControls: workflowV2JsonArray(row.required_controls_json, []),
    evidenceRefs: workflowV2JsonArray(row.evidence_refs_json, []),
    payload: workflowV2JsonObject(row.payload_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function workflowV2WorkerRunSummary(row = {}) {
  return {
    workerRunId: row.worker_run_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    nodeId: row.node_id || "",
    parentWorkerRunId: row.parent_worker_run_id || "",
    supersedesWorkerRunId: row.supersedes_worker_run_id || "",
    successorWorkerRunId: row.successor_worker_run_id || "",
    workerGeneration: Number(row.worker_generation || 0),
    managerAgent: row.manager_agent || "",
    workerAgentId: row.worker_agent_id || "",
    sessionId: row.session_id || "",
    sessionRunId: row.session_run_id || "",
    preflightId: row.preflight_id || "",
    runtimeBackend: row.runtime_backend || "",
    status: row.status || "",
    attempt: Number(row.attempt || 0),
    maxAttempts: Number(row.max_attempts || 1),
    leaseOwner: row.lease_owner || "",
    leaseUntil: row.lease_until || "",
    nextRetryAt: row.next_retry_at || "",
    taskInputInfoId: row.task_input_info_id || "",
    outputInfoId: row.output_info_id || "",
    handoffInfoId: row.handoff_info_id || "",
    receiptRef: row.receipt_ref || "",
    lastError: row.last_error || "",
    contextBudgetTokens: Number(row.context_budget_tokens || 0),
    contextUsedTokens: Number(row.context_used_tokens || 0),
    compactionCount: Number(row.compaction_count || 0),
    sourceContextRefs: workflowV2JsonArray(row.source_context_refs_json, []),
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

export function workflowV2AdapterJobSummary(row = {}) {
  if (!row?.adapter_job_id) return null;
  return {
    adapterJobId: row.adapter_job_id || "",
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    nodeId: row.node_id || "",
    workerRunId: row.worker_run_id || "",
    sessionRunId: row.session_run_id || "",
    runtimeBackend: row.runtime_backend || "",
    workerAttempt: Number(row.worker_attempt || 0),
    runnerAttempt: Number(row.runner_attempt || 0),
    maxRunnerAttempts: Number(row.max_runner_attempts || 3),
    status: row.status || "",
    leaseOwner: row.lease_owner || "",
    leaseUntil: row.lease_until || "",
    nextRetryAt: row.next_retry_at || "",
    runnerId: row.runner_id || "",
    artifactRef: row.artifact_ref || "",
    artifactId: row.artifact_id || "",
    infoId: row.info_id || "",
    manifestHash: row.manifest_hash || "",
    runnerReceiptRef: row.runner_receipt_ref || "",
    lastError: row.last_error || "",
    payload: workflowV2JsonObject(row.payload_json, {}),
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    completedAt: row.completed_at || ""
  };
}

export function workflowV2AdapterJobLeaseMs(input = {}) {
  const requested = Number(input.adapterJobLeaseMs || input.adapter_job_lease_ms || input.leaseMs || input.lease_ms || 300_000);
  if (!Number.isFinite(requested)) return 300_000;
  return Math.max(10_000, Math.min(60 * 60_000, Math.floor(requested)));
}

export function workflowV2AdapterJobRetryDelayMs(input = {}, runnerAttempt = 0) {
  const requested = Number(input.retryDelayMs ?? input.retry_delay_ms);
  if (Number.isFinite(requested)) return Math.max(0, Math.min(60 * 60_000, Math.floor(requested)));
  return Math.min(10 * 60_000, Math.max(10_000, 10_000 * Math.max(1, Number(runnerAttempt || 1))));
}

export function workflowV2CapacityInt(candidates = [], fallback = 1, min = 0, max = 10_000) {
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const value = Number(candidate);
    if (Number.isFinite(value)) return Math.max(min, Math.min(max, Math.floor(value)));
  }
  return Math.max(min, Math.min(max, Math.floor(Number(fallback) || 0)));
}

export function workflowV2DefaultProviderConcurrency(providerModel = "", backendMaxActiveJobs = 200) {
  const text = String(providerModel || "").toLowerCase();
  if (/(iflytek|xunfei|xfyun)/.test(text)) return Math.min(3, backendMaxActiveJobs);
  return backendMaxActiveJobs;
}

export function workflowV2UniqueTextArray(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
