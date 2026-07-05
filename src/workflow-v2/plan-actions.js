import fs from "node:fs/promises";
import path from "node:path";

import { workflowPaths } from "../workflow/paths.js";
import {
  boolOption,
  firstText,
  jsonHash,
  safeId
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";
import {
  WORKFLOW_V2_MAX_CONCURRENT_WORKERS,
  WORKFLOW_V2_NODE_STATUSES,
  WORKFLOW_V2_PLAN_STATUSES,
  WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
  WORKFLOW_V2_WORKFLOW_STATES
} from "./constants.js";
import {
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2NonNegativeInt,
  workflowV2NormalizeBackend,
  workflowV2NormalizeEnum,
  workflowV2ValidationError
} from "./helpers.js";
import {
  workflowV2DefaultPlanNodes,
  workflowV2HasExplicitPlanManagers,
  workflowV2InputOrchestrationPattern,
  workflowV2PlanManagers,
  workflowV2PlanNeedsExecutableNodeHardGate,
  workflowV2PlanNodeHardGateErrors,
  workflowV2PlanNodeAdvisories,
  workflowV2PlanOrchestrationAdvisories,
  workflowV2PlanOrchestrationContract,
  workflowV2PlanSpecArtifact
} from "./plan.js";

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

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function createWorkflowV2PlanActionHandlers(context = {}) {
  const {
    cleanFileSegment,
    ensureWorkflowLayout,
    humanGateApproveOptionMax,
    humanGateApproveOptionMin,
    nowIso,
    relativeTo,
    writeJsonAtomic
  } = context;
  const HUMAN_GATE_APPROVE_OPTION_MIN = Number(humanGateApproveOptionMin || 2);
  const HUMAN_GATE_APPROVE_OPTION_MAX = Number(humanGateApproveOptionMax || 5);

async function workflowV2PlanPreview(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const objective = firstText(input.objective, input.summary, input.prompt, input.text);
  if (!objective) errors.push(workflowV2ValidationError("objective_required", "workflow v2 plan preview requires objective/summary/prompt"));
  const workflowId = firstText(input.workflowId, input.workflow_id) || safeId("workflow-v2");
  const planId = firstText(input.planId, input.plan_id) || `${workflowId}.plan`;
  const planRevision = workflowV2NonNegativeInt(input.planRevision ?? input.plan_revision, 1) || 1;
  const taskOwnerAgent = normalizeOptionalAgentId(firstText(input.taskOwnerAgent, input.task_owner_agent, input.ownerAgent, input.owner_agent, "cat_heart")) || "cat_heart";
  const inputPattern = workflowV2InputOrchestrationPattern(input);
  const participantManagers = inputPattern === "direct_owner_execution" && !workflowV2HasExplicitPlanManagers(input)
    ? []
    : workflowV2PlanManagers(input);
  const acceptanceCriteria = workflowV2JsonArray(input.acceptanceCriteria ?? input.acceptance_criteria, []);
  const orchestration = workflowV2PlanOrchestrationContract(input, participantManagers);
  const orchestrationAdvisories = workflowV2PlanOrchestrationAdvisories(orchestration, acceptanceCriteria);
  const plan = {
    planId,
    workflowId,
    planRevision,
    status: workflowV2NormalizeEnum(input.status, WORKFLOW_V2_PLAN_STATUSES, "draft"),
    workflowState: workflowV2NormalizeEnum(input.workflowState || input.workflow_state, WORKFLOW_V2_WORKFLOW_STATES, "draft"),
    taskOwnerAgent,
    plannerAgent: normalizeOptionalAgentId(firstText(input.plannerAgent, input.planner_agent, "main")) || "main",
    objective,
    participantManagers,
    acceptanceCriteria,
    orchestrationPattern: orchestration.pattern,
    orchestrationRationale: orchestration.rationale,
    complexityTier: orchestration.complexityTier,
    taskGroupRequired: orchestration.taskGroupRequired,
    workerBudget: orchestration.workerBudget,
    constraints: workflowV2JsonObject(input.constraints, {}),
    humanGatePolicy: {
      required: boolOption(input.humanGateRequired ?? input.human_gate_required, true),
      ownerAgent: "cat_claw",
      minApproveOptions: HUMAN_GATE_APPROVE_OPTION_MIN,
      maxApproveOptions: HUMAN_GATE_APPROVE_OPTION_MAX,
      controls: ["pause", "terminate"],
      flashcatOriginalWordsRequired: true,
      language: "zh-CN"
    },
    resumePolicy: {
      checkpointRequired: true,
      stableWorkflowIdRequired: true,
      idempotencyRequired: true
    },
    payload: {
      ...workflowV2JsonObject(input.payload, {}),
      orchestration
    }
  };
  const nodes = workflowV2JsonArray(input.nodes, null)?.map((node, index) => {
    const item = workflowV2JsonObject(node, {});
    return {
      nodeId: String(item.nodeId || item.node_id || `${planId}.node.${index + 1}`).trim(),
      planId,
      workflowId,
      parentNodeId: String(item.parentNodeId || item.parent_node_id || "").trim(),
      nodeType: String(item.nodeType || item.node_type || "task").trim(),
      status: workflowV2NormalizeEnum(item.status, WORKFLOW_V2_NODE_STATUSES, "planned"),
      ownerAgent: normalizeOptionalAgentId(item.ownerAgent || item.owner_agent || taskOwnerAgent) || taskOwnerAgent,
      runtimeBackend: workflowV2NormalizeBackend(item.runtimeBackend || item.runtime_backend || "hermers_docker_worker"),
      sessionId: String(item.sessionId || item.session_id || "").trim(),
      dependsOn: workflowV2JsonArray(item.dependsOn ?? item.depends_on, []),
      inputInfoId: String(item.inputInfoId || item.input_info_id || "").trim(),
      outputInfoId: String(item.outputInfoId || item.output_info_id || "").trim(),
      payload: workflowV2JsonObject(item.payload, {})
    };
  }) || workflowV2DefaultPlanNodes(plan, input);
  const advisoryChecks = [
    ...orchestrationAdvisories,
    ...workflowV2PlanNodeAdvisories(orchestration, nodes)
  ];
  const planSpecV2 = workflowV2PlanSpecArtifact(plan, nodes, input);
  return {
    operation: "workflow.v2.plan.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    advisoryChecks,
    warnings: advisoryChecks,
    recommendations: {
      source: "anthropic_simplest_effective_pattern",
      preferredPattern: orchestration.pattern || (participantManagers.length ? "manager_worker" : "direct_owner_execution"),
      workerContextLimitTokens: WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
      maxConcurrentWorkersDesignTarget: WORKFLOW_V2_MAX_CONCURRENT_WORKERS
    },
    plan,
    planSpecV2,
    nodes,
    dbFile: paths.dbFile,
    writes: []
  };
}

async function workflowV2PlanCreate(rootDir, input = {}) {
  const validationPreview = await workflowV2PlanPreview(rootDir, input);
  if (!validationPreview.valid) throw new Error(`workflow v2 plan is invalid: ${validationPreview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const existingRows = await sqlite(paths.dbFile, `SELECT * FROM workflow_v2_plans WHERE plan_id=${sqlValue(validationPreview.plan.planId)} LIMIT 1;`, { json: true });
  const existingPlan = existingRows[0] || null;
  const createdAt = existingPlan?.created_at || firstText(input.createdAt, input.created_at, now);
  const existingUpdatedAt = existingPlan?.updated_at || createdAt;
  const createdBy = existingPlan?.created_by || firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  const planRevision = workflowV2NonNegativeInt(input.planRevision ?? input.plan_revision ?? existingPlan?.plan_revision, 1) || 1;
  const preview = await workflowV2PlanPreview(rootDir, {
    ...input,
    createdAt,
    updatedAt: existingUpdatedAt,
    createdBy,
    planRevision
  });
  const plan = {
    ...preview.plan,
    status: workflowV2NormalizeEnum(input.status, WORKFLOW_V2_PLAN_STATUSES, "planned"),
    workflowState: workflowV2NormalizeEnum(input.workflowState || input.workflow_state, WORKFLOW_V2_WORKFLOW_STATES, "planned")
  };
  const planNodeHardGateErrors = workflowV2PlanNeedsExecutableNodeHardGate(plan)
    ? workflowV2PlanNodeHardGateErrors(workflowV2PlanOrchestrationContract(plan, plan.participantManagers), preview.nodes)
    : [];
  if (planNodeHardGateErrors.length) {
    throw new Error(`workflow v2 executable plan hard gate failed: ${planNodeHardGateErrors.map((item) => item.code).join(",")}`);
  }
  const artifactId = cleanFileSegment(firstText(input.artifactId, input.artifact_id, `${plan.planId}.workflow_plan_spec.v2`));
  const artifactDir = path.join(paths.artifactsDir, "workflow-v2", cleanFileSegment(plan.workflowId), "plans");
  const planSpecFilePath = path.join(artifactDir, `${artifactId}.json`);
  const planSpecPath = relativeTo(paths.root, planSpecFilePath);
  let planSpecV2 = {
    ...preview.planSpecV2,
    meta: {
      ...preview.planSpecV2.meta,
      createdAt,
      updatedAt: existingUpdatedAt,
      createdBy
    }
  };
  planSpecV2.artifacts = {
    ...planSpecV2.artifacts,
    canonicalPlan: {
      ...(planSpecV2.artifacts?.canonicalPlan || {}),
      path: planSpecPath,
      artifactId: `${artifactId}.json`,
      sourceOfTruth: true
    }
  };
  let planSpecHash = jsonHash(planSpecV2);
  const existingArtifactStable = existingPlan?.plan_spec_artifact_ref === planSpecPath
    && existingPlan?.plan_spec_artifact_hash === planSpecHash
    && await pathExists(planSpecFilePath);
  const rowUpdatedAt = existingArtifactStable ? existingUpdatedAt : now;
  if (!existingArtifactStable) {
    planSpecV2 = {
      ...planSpecV2,
      meta: {
        ...planSpecV2.meta,
        updatedAt: rowUpdatedAt
      },
      audit: {
        ...planSpecV2.audit,
        generatedAt: createdAt
      }
    };
    planSpecHash = jsonHash(planSpecV2);
    await writeJsonAtomic(planSpecFilePath, planSpecV2);
  }
  const planPayload = {
    ...workflowV2JsonObject(plan.payload, {}),
    orchestration: {
      pattern: plan.orchestrationPattern,
      rationale: plan.orchestrationRationale,
      complexityTier: plan.complexityTier,
      taskGroupRequired: Boolean(plan.taskGroupRequired),
      workerBudget: workflowV2JsonObject(plan.workerBudget, {})
    },
    planSpecV2ArtifactRef: planSpecPath,
    planSpecV2ArtifactId: `${artifactId}.json`,
    planSpecV2Hash: planSpecHash
  };
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_plans(plan_id, workflow_id, plan_revision, status, workflow_state, task_owner_agent, planner_agent, objective, participant_managers_json, acceptance_criteria_json, constraints_json, human_gate_policy_json, plan_spec_artifact_ref, plan_spec_artifact_hash, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(plan.planId)}, ${sqlValue(plan.workflowId)}, ${sqlValue(plan.planRevision)}, ${sqlValue(plan.status)}, ${sqlValue(plan.workflowState)}, ${sqlValue(plan.taskOwnerAgent)}, ${sqlValue(plan.plannerAgent)}, ${sqlValue(plan.objective)}, ${sqlValue(JSON.stringify(plan.participantManagers))}, ${sqlValue(JSON.stringify(plan.acceptanceCriteria))}, ${sqlValue(JSON.stringify(plan.constraints))}, ${sqlValue(JSON.stringify(plan.humanGatePolicy))}, ${sqlValue(planSpecPath)}, ${sqlValue(planPayload.planSpecV2Hash)}, ${sqlValue(JSON.stringify(planPayload))}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)}, ${sqlValue(rowUpdatedAt)})
ON CONFLICT(plan_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_revision=excluded.plan_revision,
  status=excluded.status,
  workflow_state=excluded.workflow_state,
  task_owner_agent=excluded.task_owner_agent,
  planner_agent=excluded.planner_agent,
  objective=excluded.objective,
  participant_managers_json=excluded.participant_managers_json,
  acceptance_criteria_json=excluded.acceptance_criteria_json,
  constraints_json=excluded.constraints_json,
  human_gate_policy_json=excluded.human_gate_policy_json,
  plan_spec_artifact_ref=excluded.plan_spec_artifact_ref,
  plan_spec_artifact_hash=excluded.plan_spec_artifact_hash,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${artifactId}.json`)}, ${sqlValue(plan.workflowId)}, 'workflow_v2_plan_spec_json', ${sqlValue(planSpecPath)}, ${sqlValue(plan.objective)}, ${sqlValue(createdBy)}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET workflow_id=excluded.workflow_id, kind=excluded.kind, path=excluded.path, summary=excluded.summary, created_by=excluded.created_by;`);
  for (const node of preview.nodes) {
    await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_plan_nodes(node_id, plan_id, workflow_id, parent_node_id, node_type, status, owner_agent, runtime_backend, session_id, depends_on_json, input_info_id, output_info_id, payload_json, created_at, updated_at)
VALUES (${sqlValue(node.nodeId)}, ${sqlValue(node.planId)}, ${sqlValue(node.workflowId)}, ${sqlValue(node.parentNodeId)}, ${sqlValue(node.nodeType)}, ${sqlValue(node.status)}, ${sqlValue(node.ownerAgent)}, ${sqlValue(node.runtimeBackend)}, ${sqlValue(node.sessionId)}, ${sqlValue(JSON.stringify(node.dependsOn))}, ${sqlValue(node.inputInfoId)}, ${sqlValue(node.outputInfoId)}, ${sqlValue(JSON.stringify(node.payload))}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(node_id) DO UPDATE SET
  plan_id=excluded.plan_id,
  workflow_id=excluded.workflow_id,
  parent_node_id=excluded.parent_node_id,
  node_type=excluded.node_type,
  status=excluded.status,
  owner_agent=excluded.owner_agent,
  runtime_backend=excluded.runtime_backend,
  session_id=excluded.session_id,
  depends_on_json=excluded.depends_on_json,
  input_info_id=excluded.input_info_id,
  output_info_id=excluded.output_info_id,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  }
  return {
    operation: "workflow.v2.plan.create",
    plan: { ...plan, payload: planPayload },
    planSpecV2,
    artifacts: {
      planSpecV2: planSpecPath,
      canonicalJson: planSpecPath,
      artifactId: `${artifactId}.json`
    },
    nodeCount: preview.nodes.length,
    nodes: preview.nodes,
    dbFile: paths.dbFile
  };
}


  return {
    workflowV2PlanPreview,
    workflowV2PlanCreate
  };
}
