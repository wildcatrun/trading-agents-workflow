import { createHash } from "node:crypto";
import {
  WORKFLOW_V2_MAX_CONCURRENT_WORKERS,
  WORKFLOW_V2_NODE_STATUSES,
  WORKFLOW_V2_ORCHESTRATION_PATTERNS,
  WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
  WORKFLOW_V2_WORKER_PATTERNS
} from "./constants.js";
import {
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2NormalizeBackend,
  workflowV2NormalizeEnum,
  workflowV2OptionalNonNegativeInt,
  workflowV2UniqueTextList,
  workflowV2ValidationAdvisory,
  workflowV2ValidationError
} from "./helpers.js";

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

function nowIso() {
  return new Date().toISOString();
}

function boolOption(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(value);
}

function textHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeAgentId(value) {
  const agentId = String(value || "").trim();
  if (!agentId) throw new Error("agentId is required");
  if (agentId === "catclaw") throw new Error("retired agent id catclaw is invalid; use cat_claw");
  return agentId.replace(/[^a-zA-Z0-9._:-]+/g, "_").slice(0, 96);
}

function normalizeOptionalAgentId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return normalizeAgentId(text);
}

export function workflowV2InputOrchestrationPattern(input = {}) {
  const payload = workflowV2JsonObject(input.payload, {});
  const orchestrationInput = workflowV2JsonObject(input.orchestration ?? input.orchestration_contract ?? payload.orchestration, {});
  return workflowV2NormalizeEnum(
    firstText(input.orchestrationPattern, input.orchestration_pattern, input.workflowPattern, input.workflow_pattern, orchestrationInput.pattern, orchestrationInput.orchestrationPattern, orchestrationInput.orchestration_pattern, payload.orchestrationPattern, payload.orchestration_pattern),
    WORKFLOW_V2_ORCHESTRATION_PATTERNS,
    ""
  );
}

export function workflowV2HasExplicitPlanManagers(input = {}) {
  return [
    "participantManagers",
    "participant_managers",
    "managers",
    "managerAgents",
    "manager_agents"
  ].some((key) => input[key] !== undefined && input[key] !== null && input[key] !== "");
}

export function workflowV2PlanOrchestrationContract(input = {}, managerAgents = []) {
  const payload = workflowV2JsonObject(input.payload, {});
  const orchestrationInput = workflowV2JsonObject(input.orchestration ?? input.orchestration_contract ?? payload.orchestration, {});
  const workerBudgetInput = workflowV2JsonObject(input.workerBudget ?? input.worker_budget ?? orchestrationInput.workerBudget ?? orchestrationInput.worker_budget ?? payload.workerBudget ?? payload.worker_budget, {});
  const pattern = workflowV2InputOrchestrationPattern(input);
  const workerBudget = {
    maxWorkers: workflowV2OptionalNonNegativeInt(firstText(input.maxWorkers, input.max_workers, workerBudgetInput.maxWorkers, workerBudgetInput.max_workers)),
    concurrencyLimit: workflowV2OptionalNonNegativeInt(firstText(input.workerConcurrencyLimit, input.worker_concurrency_limit, input.concurrencyLimit, input.concurrency_limit, workerBudgetInput.concurrencyLimit, workerBudgetInput.concurrency_limit)),
    maxWorkerContextTokens: workflowV2OptionalNonNegativeInt(firstText(input.maxWorkerContextTokens, input.max_worker_context_tokens, workerBudgetInput.maxWorkerContextTokens, workerBudgetInput.max_worker_context_tokens))
  };
  const rationale = firstText(input.orchestrationRationale, input.orchestration_rationale, orchestrationInput.rationale, orchestrationInput.reason, payload.orchestrationRationale, payload.orchestration_rationale);
  const taskGroupRequired = boolOption(input.taskGroupRequired ?? input.task_group_required ?? orchestrationInput.taskGroupRequired ?? orchestrationInput.task_group_required, false);
  const managerCount = Array.isArray(managerAgents) ? managerAgents.length : 0;
  return {
    pattern,
    rationale,
    complexityTier: firstText(input.complexityTier, input.complexity_tier, orchestrationInput.complexityTier, orchestrationInput.complexity_tier),
    taskGroupRequired,
    managerCount,
    workerBudget
  };
}

export function workflowV2PlanOrchestrationAdvisories(contract = {}, acceptanceCriteria = []) {
  const advisories = [];
  if (!contract.pattern) {
    advisories.push(workflowV2ValidationAdvisory("orchestration_pattern_recommended", "workflow v2 plan should name an orchestrationPattern when the task shape is known"));
  }
  if (contract.pattern && !WORKFLOW_V2_ORCHESTRATION_PATTERNS.has(contract.pattern)) {
    advisories.push(workflowV2ValidationAdvisory("orchestration_pattern_unsupported", "workflow v2 plan orchestrationPattern is not in the known pattern set", { pattern: contract.pattern }));
  }
  if (!contract.rationale) {
    advisories.push(workflowV2ValidationAdvisory("orchestration_rationale_recommended", "workflow v2 plan should include brief orchestration rationale for Cat Brain governance audit"));
  }
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
    advisories.push(workflowV2ValidationAdvisory("acceptance_criteria_recommended", "workflow v2 plan should include acceptanceCriteria before deeper execution"));
  }
  const budget = workflowV2JsonObject(contract.workerBudget, {});
  if (budget.maxWorkers === null || budget.maxWorkers === undefined) {
    advisories.push(workflowV2ValidationAdvisory("worker_budget_max_workers_recommended", "workflow v2 plan should estimate workerBudget.maxWorkers when workers may be spawned"));
  }
  if (budget.concurrencyLimit === null || budget.concurrencyLimit === undefined) {
    advisories.push(workflowV2ValidationAdvisory("worker_budget_concurrency_recommended", "workflow v2 plan should estimate workerBudget.concurrencyLimit when workers may be spawned"));
  }
  if (budget.maxWorkerContextTokens === null || budget.maxWorkerContextTokens === undefined) {
    advisories.push(workflowV2ValidationAdvisory("worker_budget_context_limit_recommended", "workflow v2 plan should state the max worker context budget when workers may be spawned"));
  }
  if (Number(budget.concurrencyLimit || 0) > WORKFLOW_V2_MAX_CONCURRENT_WORKERS) {
    advisories.push(workflowV2ValidationAdvisory("worker_budget_concurrency_too_high", `workflow v2 planned concurrency is above the current ${WORKFLOW_V2_MAX_CONCURRENT_WORKERS} worker design target`, { concurrencyLimit: budget.concurrencyLimit }));
  }
  if (Number(budget.maxWorkerContextTokens || 0) > WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS) {
    advisories.push(workflowV2ValidationAdvisory("worker_context_limit_too_high", `workflow v2 planned worker context limit is above the ${WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS} token worker window`, { maxWorkerContextTokens: budget.maxWorkerContextTokens }));
  }
  if (WORKFLOW_V2_WORKER_PATTERNS.has(contract.pattern) && Number(budget.maxWorkers || 0) < 1) {
    advisories.push(workflowV2ValidationAdvisory("worker_budget_incompatible_with_pattern", "worker orchestration patterns should reserve workerBudget.maxWorkers >= 1", { pattern: contract.pattern }));
  }
  if (contract.pattern === "direct_owner_execution" && Number(budget.maxWorkers || 0) > 0) {
    advisories.push(workflowV2ValidationAdvisory("direct_owner_budget_inconsistent", "direct_owner_execution plans usually should not reserve worker budget"));
  }
  if (["manager_worker", "parallel_manager_sections"].includes(contract.pattern) && Number(contract.managerCount || 0) < 1) {
    advisories.push(workflowV2ValidationAdvisory("manager_pattern_without_managers", "manager_worker and parallel_manager_sections patterns should include participant managers"));
  }
  return advisories;
}

function workflowV2NodePayload(node = {}) {
  return workflowV2JsonObject(node.payload, {});
}

function workflowV2NodeText(node = {}, ...keys) {
  const payload = workflowV2NodePayload(node);
  const values = [];
  for (const key of keys) {
    values.push(node[key], payload[key]);
    if (key.includes("_")) values.push(payload[key.replace(/_([a-z])/g, (_, char) => char.toUpperCase())]);
  }
  return firstText(...values);
}

function workflowV2NodeList(node = {}, ...keys) {
  const payload = workflowV2NodePayload(node);
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    const list = workflowV2JsonArray(node[key] ?? payload[key] ?? payload[camelKey], null);
    if (Array.isArray(list)) return list;
  }
  return [];
}

function workflowV2NodeHasValue(node = {}, ...keys) {
  const payload = workflowV2NodePayload(node);
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    const value = node[key] ?? payload[key] ?? payload[camelKey];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length > 0) return true;
    if (typeof value === "object" && Object.keys(value).length > 0) return true;
    if (String(value).trim()) return true;
  }
  return false;
}

function workflowV2NodeHasPositiveInt(node = {}, ...keys) {
  const payload = workflowV2NodePayload(node);
  for (const key of keys) {
    const camelKey = key.includes("_") ? key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()) : key;
    const value = node[key] ?? payload[key] ?? payload[camelKey];
    if (value !== undefined && value !== null && value !== "" && workflowV2NonNegativeInt(value, 0) > 0) return true;
  }
  return false;
}

function workflowV2NormalizeEvaluatorDecisionState(value = "") {
  const text = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (text === "revise_required") return "needs_revision";
  return text;
}

function workflowV2EvaluatorDecisionStates(node = {}) {
  return workflowV2NodeList(node, "decisionStates", "decision_states", "outcomeStates", "outcome_states")
    .map(workflowV2NormalizeEvaluatorDecisionState)
    .filter(Boolean);
}

function workflowV2EvaluatorReferencesProducer(node = {}, producerNodeIds = []) {
  const producerSet = new Set(producerNodeIds.filter(Boolean));
  if (!producerSet.size) return false;
  const refs = [
    ...workflowV2NodeList(node, "producerNodeIds", "producer_node_ids", "producerNodes", "producer_nodes"),
    workflowV2NodeText(node, "producerNodeId", "producer_node_id")
  ].filter(Boolean);
  const dependsOn = workflowV2JsonArray(node.dependsOn ?? node.depends_on, []);
  return [...refs, ...dependsOn].some((ref) => producerSet.has(ref));
}

export function workflowV2PlanNodeAdvisories(contract = {}, nodes = []) {
  const advisories = [];
  const pattern = String(contract.pattern || "").trim();
  const nodeList = Array.isArray(nodes) ? nodes : [];
  const managerWorkerNodes = nodeList.filter((node) => node.nodeType === "manager_worker_spawn");
  const reviewNodes = nodeList.filter((node) => ["manager_review", "owner_review", "worker_review", "evaluator_review", "evaluator"].includes(node.nodeType));

  if (["manager_worker", "parallel_manager_sections"].includes(pattern)) {
    if (managerWorkerNodes.length === 0) {
      advisories.push(workflowV2ValidationAdvisory(
        "manager_worker_spawn_node_recommended",
        "manager-worker orchestration should include at least one manager_worker_spawn node before manager review",
        { pattern }
      ));
    }
    const missingDomain = managerWorkerNodes.filter((node) => !workflowV2NodeText(node, "domainOwnership", "domain_ownership", "domain", "section"));
    if (missingDomain.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "manager_worker_domain_ownership_recommended",
        "manager-worker plan nodes should state domainOwnership/section so parallel work has clear ownership",
        { nodeIds: missingDomain.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
    const missingArtifacts = managerWorkerNodes.filter((node) => workflowV2NodeList(node, "expectedArtifacts", "expected_artifacts").length === 0);
    if (missingArtifacts.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "manager_worker_expected_artifacts_recommended",
        "manager-worker plan nodes should name expectedArtifacts for artifact-first synthesis",
        { nodeIds: missingArtifacts.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
    const missingReviewPolicy = managerWorkerNodes.filter((node) => !workflowV2NodeText(node, "reviewPolicy", "review_policy"));
    if (missingReviewPolicy.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "manager_worker_review_policy_recommended",
        "manager-worker plan nodes should state reviewPolicy before worker output can become evidence",
        { nodeIds: missingReviewPolicy.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
  }

  if (pattern === "parallel_manager_sections") {
    const sections = managerWorkerNodes
      .map((node) => workflowV2NodeText(node, "domainOwnership", "domain_ownership", "domain", "section").toLowerCase())
      .filter(Boolean);
    if (managerWorkerNodes.length < 2) {
      advisories.push(workflowV2ValidationAdvisory(
        "parallel_sections_need_multiple_managers",
        "parallel_manager_sections should include at least two manager-owned sections",
        { managerWorkerNodeCount: managerWorkerNodes.length }
      ));
    }
    if (sections.length && new Set(sections).size !== sections.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "parallel_sections_should_be_distinct",
        "parallel_manager_sections should use distinct section/domain ownership labels",
        { sections }
      ));
    }
  }

  if (pattern === "evaluator_optimizer") {
    const producerNodes = nodeList.filter((node) => ["producer", "optimizer", "manager_worker_spawn", "worker_producer"].includes(node.nodeType));
    if (producerNodes.length === 0 || reviewNodes.length === 0) {
      advisories.push(workflowV2ValidationAdvisory(
        "evaluator_optimizer_pair_recommended",
        "evaluator_optimizer plans should expose a producer node and a distinct evaluator/review node"
      ));
    }
    const sameOwnerPairs = producerNodes.flatMap((producer) => reviewNodes
      .filter((review) => review.ownerAgent && producer.ownerAgent && review.ownerAgent === producer.ownerAgent)
      .map((review) => ({ producerNodeId: producer.nodeId, evaluatorNodeId: review.nodeId, ownerAgent: review.ownerAgent })));
    if (sameOwnerPairs.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "evaluator_optimizer_distinct_reviewer_recommended",
        "evaluator_optimizer review should be separate from the producing worker/manager when possible",
        { pairs: sameOwnerPairs }
      ));
    }
    const producerNodeIds = producerNodes.map((node) => node.nodeId).filter(Boolean);
    const missingProducerOutputContract = producerNodes.filter((node) => !workflowV2NodeHasValue(node, "producerOutput", "producer_output", "producerOutputSchema", "producer_output_schema", "outputSchema", "output_schema", "outputContract", "output_contract", "expectedArtifacts", "expected_artifacts"));
    if (missingProducerOutputContract.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "evaluator_optimizer_producer_output_contract_recommended",
        "evaluator_optimizer producer nodes should declare producer output schema/contract or expected artifacts",
        { nodeIds: missingProducerOutputContract.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
    const missingEvaluatorContract = reviewNodes.filter((node) => {
      const referencesProducer = workflowV2EvaluatorReferencesProducer(node, producerNodeIds);
      const hasInput = workflowV2NodeHasValue(node, "evaluatorInput", "evaluator_input", "evaluatorInputSchema", "evaluator_input_schema", "inputSchema", "input_schema", "producerOutputInput", "producer_output_input");
      const hasRubric = workflowV2NodeHasValue(node, "rubric", "rubricSchema", "rubric_schema", "evaluationRubric", "evaluation_rubric");
      const hasReviewArtifact = workflowV2NodeHasValue(node, "reviewArtifact", "review_artifact", "reviewArtifactRef", "review_artifact_ref", "reviewArtifactSchema", "review_artifact_schema", "expectedReviewArtifact", "expected_review_artifact");
      return !referencesProducer || !hasInput || !hasRubric || !hasReviewArtifact;
    });
    if (missingEvaluatorContract.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "evaluator_optimizer_evaluator_contract_recommended",
        "evaluator_optimizer evaluator nodes should bind producer input, rubric/schema, and review artifact contract",
        { nodeIds: missingEvaluatorContract.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
    const missingDecisionStates = reviewNodes.filter((node) => {
      const states = new Set(workflowV2EvaluatorDecisionStates(node));
      return !states.has("accepted") || !states.has("rejected") || !states.has("needs_revision");
    });
    if (missingDecisionStates.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "evaluator_optimizer_decision_states_recommended",
        "evaluator_optimizer evaluator nodes should declare accepted/rejected/needs_revision decision states",
        { nodeIds: missingDecisionStates.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
  }

  if (pattern === "autonomous_agent_loop") {
    const loopNodes = nodeList.filter((node) => ["autonomous_loop", "agent_loop", "manager_worker_spawn", "task"].includes(node.nodeType));
    const missingIterationCap = loopNodes.filter((node) => !workflowV2NodeHasPositiveInt(node, "maxIterations", "max_iterations", "iterationCap", "iteration_cap"));
    if (missingIterationCap.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "autonomous_loop_iteration_cap_recommended",
        "autonomous_agent_loop nodes should state maxIterations/iterationCap to prevent open-ended loops",
        { nodeIds: missingIterationCap.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
    const missingToolFeedback = loopNodes.filter((node) => workflowV2NodeList(node, "toolFeedbackCheckpoints", "tool_feedback_checkpoints", "environmentFeedbackCheckpoints", "environment_feedback_checkpoints").length === 0);
    if (missingToolFeedback.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "autonomous_loop_tool_feedback_recommended",
        "autonomous_agent_loop nodes should state tool/environment feedback checkpoints",
        { nodeIds: missingToolFeedback.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
    const missingStopCondition = loopNodes.filter((node) => !workflowV2NodeText(node, "stopCondition", "stop_condition") && workflowV2NodeList(node, "stopConditions", "stop_conditions").length === 0);
    if (missingStopCondition.length) {
      advisories.push(workflowV2ValidationAdvisory(
        "autonomous_loop_stop_condition_recommended",
        "autonomous_agent_loop nodes should state stopCondition/stopConditions",
        { nodeIds: missingStopCondition.map((node) => node.nodeId).filter(Boolean) }
      ));
    }
  }

  return advisories;
}

const WORKFLOW_V2_PLAN_NODE_HARD_GATE_MESSAGES = {
  manager_worker_spawn_node_recommended: {
    code: "manager_worker_spawn_node_required",
    message: "manager-worker executable orchestration requires at least one manager_worker_spawn node before manager review"
  },
  manager_worker_domain_ownership_recommended: {
    code: "manager_worker_domain_ownership_required",
    message: "manager-worker executable nodes require domainOwnership/section so parallel work has clear ownership"
  },
  manager_worker_expected_artifacts_recommended: {
    code: "manager_worker_expected_artifacts_required",
    message: "manager-worker executable nodes require expectedArtifacts for artifact-first synthesis"
  },
  manager_worker_review_policy_recommended: {
    code: "manager_worker_review_policy_required",
    message: "manager-worker executable nodes require reviewPolicy before worker output can become evidence"
  },
  parallel_sections_need_multiple_managers: {
    code: "parallel_sections_multiple_managers_required",
    message: "parallel_manager_sections executable plans require at least two manager-owned sections"
  },
  parallel_sections_should_be_distinct: {
    code: "parallel_sections_distinct_required",
    message: "parallel_manager_sections executable plans require distinct section/domain ownership labels"
  },
  evaluator_optimizer_pair_recommended: {
    code: "evaluator_optimizer_pair_required",
    message: "evaluator_optimizer executable plans require a producer node and a distinct evaluator/review node"
  },
  evaluator_optimizer_distinct_reviewer_recommended: {
    code: "evaluator_optimizer_distinct_reviewer_required",
    message: "evaluator_optimizer executable review must be separate from the producing worker/manager"
  },
  evaluator_optimizer_producer_output_contract_recommended: {
    code: "evaluator_optimizer_producer_output_contract_required",
    message: "evaluator_optimizer executable producer nodes require producer output schema/contract or expected artifacts"
  },
  evaluator_optimizer_evaluator_contract_recommended: {
    code: "evaluator_optimizer_evaluator_contract_required",
    message: "evaluator_optimizer executable evaluator nodes require producer input binding, rubric/schema, and review artifact contract"
  },
  evaluator_optimizer_decision_states_recommended: {
    code: "evaluator_optimizer_decision_states_required",
    message: "evaluator_optimizer executable evaluator nodes require accepted/rejected/needs_revision decision states"
  },
  autonomous_loop_iteration_cap_recommended: {
    code: "autonomous_loop_iteration_cap_required",
    message: "autonomous_agent_loop executable nodes require maxIterations/iterationCap"
  },
  autonomous_loop_tool_feedback_recommended: {
    code: "autonomous_loop_tool_feedback_required",
    message: "autonomous_agent_loop executable nodes require tool/environment feedback checkpoints"
  },
  autonomous_loop_stop_condition_recommended: {
    code: "autonomous_loop_stop_condition_required",
    message: "autonomous_agent_loop executable nodes require stopCondition/stopConditions"
  }
};

export function workflowV2PlanNodeHardGateErrors(contract = {}, nodes = []) {
  return workflowV2PlanNodeAdvisories(contract, nodes)
    .map((advisory) => {
      const hardGate = WORKFLOW_V2_PLAN_NODE_HARD_GATE_MESSAGES[advisory.code];
      if (!hardGate) return null;
      const { severity, code, message, ...details } = advisory;
      return workflowV2ValidationError(hardGate.code, hardGate.message, details);
    })
    .filter(Boolean);
}

export function workflowV2PlanNeedsExecutableNodeHardGate(plan = {}) {
  const status = String(plan.status || "").trim();
  const workflowState = String(plan.workflowState || plan.workflow_state || "").trim();
  return !(status === "draft" && workflowState === "draft");
}

export function workflowV2WorkerDelegationContract(input = {}) {
  const payload = workflowV2JsonObject(input.payload, {});
  const delegationInput = workflowV2JsonObject(input.delegation ?? input.delegationContract ?? input.delegation_contract ?? payload.delegation ?? payload.delegationContract ?? payload.delegation_contract, {});
  const acceptanceCriteria = workflowV2JsonArray(input.acceptanceCriteria ?? input.acceptance_criteria ?? delegationInput.acceptanceCriteria ?? delegationInput.acceptance_criteria, []);
  const stopConditions = workflowV2JsonArray(input.stopConditions ?? input.stop_conditions ?? delegationInput.stopConditions ?? delegationInput.stop_conditions, []);
  const stopCondition = firstText(input.stopCondition, input.stop_condition, delegationInput.stopCondition, delegationInput.stop_condition);
  return {
    objective: firstText(input.workerObjective, input.worker_objective, input.delegationObjective, input.delegation_objective, delegationInput.objective, delegationInput.goal),
    outputFormat: firstText(input.outputFormat, input.output_format, delegationInput.outputFormat, delegationInput.output_format),
    toolBoundary: firstText(input.toolBoundary, input.tool_boundary, delegationInput.toolBoundary, delegationInput.tool_boundary),
    acceptanceCriteria,
    stopCondition,
    stopConditions,
    reviewPath: firstText(input.reviewPath, input.review_path, delegationInput.reviewPath, delegationInput.review_path, "manager_review"),
    maxContextTokens: workflowV2NonNegativeInt(input.contextBudgetTokens ?? input.context_budget_tokens, WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS)
  };
}

export function workflowV2ValidateWorkerDelegationContract(contract = {}, contextBudgetTokens = 0, options = {}) {
  const errors = [];
  if (!contract.objective) errors.push(workflowV2ValidationError("worker_objective_required", "worker spawn requires a bounded workerObjective/delegation.objective"));
  if (!contract.outputFormat) errors.push(workflowV2ValidationError("worker_output_format_required", "worker spawn requires outputFormat/delegation.outputFormat"));
  if (!contract.toolBoundary) errors.push(workflowV2ValidationError("worker_tool_boundary_required", "worker spawn requires toolBoundary/delegation.toolBoundary"));
  if (!Array.isArray(contract.acceptanceCriteria) || contract.acceptanceCriteria.length === 0) {
    errors.push(workflowV2ValidationError("worker_acceptance_criteria_required", "worker spawn requires delegation acceptanceCriteria"));
  }
  if (!contract.stopCondition && (!Array.isArray(contract.stopConditions) || contract.stopConditions.length === 0)) {
    errors.push(workflowV2ValidationError("worker_stop_condition_required", "worker spawn requires stopCondition or stopConditions"));
  }
  if (!options.explicitContextBudget) {
    errors.push(workflowV2ValidationError("worker_context_budget_required", "worker spawn requires explicit contextBudgetTokens"));
  } else if (Number(contextBudgetTokens || 0) < 1) {
    errors.push(workflowV2ValidationError("worker_context_budget_required", "worker spawn requires explicit contextBudgetTokens"));
  }
  if (Number(contextBudgetTokens || 0) > WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS) {
    errors.push(workflowV2ValidationError("worker_context_budget_too_high", `worker contextBudgetTokens cannot exceed ${WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS}`, { contextBudgetTokens }));
  }
  return errors;
}

export function workflowV2PlanManagers(input = {}) {
  const explicit = workflowV2JsonArray(input.participantManagers ?? input.participant_managers ?? input.managers ?? input.managerAgents ?? input.manager_agents, null);
  const managers = explicit || ["cat_body", "cat_nose", "cat_eyes", "cat_ears", "cat_penclaw"];
  return managers.map((agent) => normalizeOptionalAgentId(agent)).filter(Boolean);
}

export function workflowV2DefaultPlanNodes(plan = {}, input = {}) {
  const nodes = [];
  const managerAgents = Array.isArray(plan.participantManagers) ? plan.participantManagers : workflowV2PlanManagers(input);
  const workflowId = plan.workflowId;
  const planId = plan.planId;
  const taskOwnerAgent = plan.taskOwnerAgent || "cat_heart";
  const addNode = (nodeType, ownerAgent, extra = {}) => {
    const nodeId = String(extra.nodeId || `${planId}.${nodeType}.${nodes.length + 1}`).replace(/[^a-zA-Z0-9._:-]+/g, "_");
    nodes.push({
      nodeId,
      planId,
      workflowId,
      parentNodeId: extra.parentNodeId || "",
      nodeType,
      status: workflowV2NormalizeEnum(extra.status, WORKFLOW_V2_NODE_STATUSES, "planned"),
      ownerAgent: normalizeOptionalAgentId(ownerAgent) || taskOwnerAgent,
      runtimeBackend: workflowV2NormalizeBackend(extra.runtimeBackend || extra.runtime_backend || "hermers_docker_worker"),
      sessionId: String(extra.sessionId || extra.session_id || "").trim(),
      dependsOn: workflowV2JsonArray(extra.dependsOn ?? extra.depends_on, []),
      inputInfoId: String(extra.inputInfoId || extra.input_info_id || "").trim(),
      outputInfoId: String(extra.outputInfoId || extra.output_info_id || "").trim(),
      payload: workflowV2JsonObject(extra.payload, {})
    });
  };
  addNode("intake", taskOwnerAgent, { runtimeBackend: "hermers" });
  addNode("manager_planning", taskOwnerAgent, { runtimeBackend: "hermers", dependsOn: [nodes[0]?.nodeId].filter(Boolean) });
  for (const manager of managerAgents) {
    addNode("manager_worker_spawn", manager, {
      dependsOn: [nodes[1]?.nodeId].filter(Boolean),
      payload: {
        managerAgent: manager,
        domainOwnership: manager,
        expectedArtifacts: [`artifact:${manager}:manager_output`],
        reviewPolicy: "manager accepts, revises, or rejects worker output before owner synthesis"
      }
    });
    addNode("manager_review", manager, {
      dependsOn: [nodes[nodes.length - 1]?.nodeId].filter(Boolean),
      runtimeBackend: "hermers",
      payload: {
        managerAgent: manager,
        reviewPolicy: "review against node acceptance criteria, artifact refs, and receipts"
      }
    });
  }
  addNode("cat_brain_synthesis", "main", { dependsOn: nodes.filter((node) => node.nodeType === "manager_review").map((node) => node.nodeId), runtimeBackend: "hermers" });
  addNode("cat_claw_audit", "cat_claw", { dependsOn: [nodes[nodes.length - 1]?.nodeId].filter(Boolean), runtimeBackend: "openclaw_review_only" });
  addNode("human_gate", "cat_claw", { dependsOn: [nodes[nodes.length - 1]?.nodeId].filter(Boolean), runtimeBackend: "openclaw_review_only" });
  addNode("closeout", taskOwnerAgent, { dependsOn: [nodes[nodes.length - 1]?.nodeId].filter(Boolean), runtimeBackend: "hermers" });
  return nodes;
}

export function workflowV2PlanSpecArtifact(plan = {}, nodes = [], input = {}) {
  const createdAt = firstText(input.createdAt, input.created_at, nowIso());
  const updatedAt = firstText(input.updatedAt, input.updated_at, createdAt);
  const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, plan.plannerAgent, "main");
  const planRevision = workflowV2NonNegativeInt(plan.planRevision ?? input.planRevision ?? input.plan_revision, 1) || 1;
  const workflowId = plan.workflowId || firstText(input.workflowId, input.workflow_id);
  const planId = plan.planId || firstText(input.planId, input.plan_id) || `${workflowId}.plan`;
  const participantAgents = workflowV2UniqueTextList([], [
    plan.taskOwnerAgent,
    plan.plannerAgent,
    ...(Array.isArray(plan.participantManagers) ? plan.participantManagers : [])
  ]).filter(Boolean);
  const traceId = firstText(input.traceId, input.trace_id, `trace-v2-${textHash([workflowId, planId, createdAt].join(":")).slice(0, 16)}`);
  return {
    schemaVersion: "workflow_plan_spec.v2",
    meta: {
      workflowId,
      planId,
      planRevision,
      traceId,
      idempotencyKey: firstText(input.idempotencyKey, input.idempotency_key, `workflow_v2_plan:${workflowId}:${planId}:${planRevision}`),
      workflowType: firstText(input.workflowType, input.workflow_type, "workflow_v2_orchestration"),
      riskTier: firstText(input.riskTier, input.risk_tier, "medium"),
      createdAt,
      updatedAt,
      timezone: firstText(input.timezone, input.time_zone, "Asia/Shanghai"),
      createdBy,
      sourceSystem: firstText(input.sourceSystem, input.source_system, "workflow.v2.plan"),
      sourceChannel: firstText(input.sourceChannel, input.source_channel, "workflow_api"),
      sourceMessageId: firstText(input.sourceMessageId, input.source_message_id)
    },
    objective: {
      goal: plan.objective || "",
      acceptanceCriteria: Array.isArray(plan.acceptanceCriteria) ? plan.acceptanceCriteria : [],
      constraints: workflowV2JsonObject(plan.constraints, {}),
      stopConditions: workflowV2JsonArray(input.stopConditions ?? input.stop_conditions ?? input.stopCondition ?? input.stop_condition, [])
    },
    participants: participantAgents.map((agentId) => ({
      agentId,
      role: agentId === plan.taskOwnerAgent ? "task_owner" : agentId === plan.plannerAgent ? "governor" : "manager",
      runtime: agentId === "main" || agentId === "cat_claw" ? "openclaw" : "hermers",
      source: "runtime_agents"
    })),
    phaseGraph: nodes.map((node, index) => ({
      phaseId: node.nodeId,
      ordinal: index + 1,
      nodeType: node.nodeType,
      ownerAgent: node.ownerAgent,
      dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn : [],
      status: node.status || "planned"
    })),
    nodes: nodes.map((node) => ({
      nodeId: node.nodeId,
      phaseId: node.nodeId,
      nodeType: node.nodeType,
      ownerAgent: node.ownerAgent,
      runtime: node.runtimeBackend,
      agentId: node.ownerAgent,
      status: node.status || "planned",
      dependsOn: Array.isArray(node.dependsOn) ? node.dependsOn : [],
      inputRefs: node.inputInfoId ? [node.inputInfoId] : [],
      outputRefs: node.outputInfoId ? [node.outputInfoId] : [],
      expectedArtifacts: workflowV2JsonArray(node.payload?.expectedArtifacts ?? node.payload?.expected_artifacts, []),
      acceptanceCriteria: workflowV2JsonArray(node.payload?.acceptanceCriteria ?? node.payload?.acceptance_criteria, plan.acceptanceCriteria || []),
      receiptRequired: true,
      humanGateRequired: node.nodeType === "human_gate",
      verifier: node.nodeType === "cat_claw_audit"
        ? { agentId: "cat_claw", mode: "protocol_audit" }
        : node.nodeType === "cat_brain_synthesis"
          ? { agentId: "main", mode: "governance_audit" }
          : { agentId: plan.taskOwnerAgent, mode: "owner_or_manager_review" },
      payload: workflowV2JsonObject(node.payload, {})
    })),
    orchestration: {
      pattern: plan.orchestrationPattern || "",
      rationale: plan.orchestrationRationale || "",
      complexityTier: plan.complexityTier || "",
      taskGroupRequired: Boolean(plan.taskGroupRequired),
      workerBudget: workflowV2JsonObject(plan.workerBudget, {})
    },
    acceptance: {
      workflowSuccess: Array.isArray(plan.acceptanceCriteria) ? plan.acceptanceCriteria : [],
      ownerReviewsManagerArtifacts: true,
      workerOutputRequiresOwnerOrManagerReview: true,
      boundedDelegationRequired: true,
      maxWorkerContextTokens: WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
      completeOnlyIf: ["plan_artifact_persisted", "required_receipts_present", "owner_review_passed", "cat_brain_governance_audit_passed"]
    },
    verification: {
      mode: "owner_manager_cat_brain_cat_claw",
      verifierAgent: plan.plannerAgent || "main",
      ownerReviewRequired: true,
      managerReviewRequiredForManagerWorkerPaths: true,
      catBrainAuditBeforeHumanGate: true,
      catClawAuditBeforeHumanGate: true
    },
    humanGatePolicy: workflowV2JsonObject(plan.humanGatePolicy, {}),
    permissionPolicy: {
      defaultOutcome: "deny_without_registered_runtime_agent",
      ownerAgent: plan.taskOwnerAgent,
      catBrainAgent: plan.plannerAgent || "main",
      catClawAgent: "cat_claw"
    },
    evidencePolicy: {
      artifactRefs: [],
      receiptRefs: [],
      infoRefs: [],
      rawLogsInPlan: false
    },
    resumePolicy: {
      checkpointRequired: true,
      stableWorkflowIdRequired: true,
      idempotencyRequired: true,
      resumeFrom: "workflow_v2_plan_artifact"
    },
    failureRoutes: [
      { routeId: "worker_review_failed", match: { state: "waiting_review" }, action: "return_to_manager_or_respawn_worker", ownerAgent: plan.taskOwnerAgent },
      { routeId: "manager_artifact_rejected", match: { state: "waiting_manager" }, action: "return_to_manager_revision", ownerAgent: plan.taskOwnerAgent },
      { routeId: "human_gate_request_due", match: { state: "human_gate_request_due" }, action: "cat_claw_submit_human_gate_request", ownerAgent: "cat_claw" },
      { routeId: "human_gate_waiting", match: { state: "waiting_human" }, action: "await_flashcat_human_gate_response", ownerAgent: "cat_claw" }
    ],
    artifacts: {
      canonicalPlan: {
        kind: "workflow_v2_plan_spec_json",
        path: "",
        sourceOfTruth: true
      }
    },
    audit: {
      generatedBy: "workflow.v2.plan",
      generatedAt: createdAt,
      designReference: "Anthropic Building effective agents: simple composable workflows, orchestrator-workers, evaluator-optimizer"
    }
  };
}
