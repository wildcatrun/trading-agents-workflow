import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  boolOption,
  firstText
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";
import {
  workflowV2AdapterJobSummary,
  workflowV2HumanGatePackageSummary,
  workflowV2JsonArray,
  workflowV2JsonObject,
  workflowV2WorkerRunSummary
} from "./helpers.js";
import {
  WORKFLOW_V2_PROTOCOL_AUDIT_STATE,
  WORKFLOW_V2_SECRETARY_CLOSEOUT_REQUIRED,
  workflowV2IsProtocolAuditedPackageStatus,
  workflowV2IsSecretaryCloseoutRequired
} from "./neutral-names.js";

const ACTIVE_WORKER_STATUSES = new Set(["queued", "retry_scheduled", "running"]);
const REVIEW_WORKER_STATUSES = new Set(["submitted_for_review", "revise_required", "handoff_required", "needs_human_gate"]);
const BLOCKING_WORKER_STATUSES = new Set(["rejected", "blocked", "failed", "timed_out", "cancelled"]);
const TERMINAL_WORKER_STATUSES = new Set(["accepted", "rejected", "retired", "successor_spawned", "blocked", "failed", "timed_out", "cancelled"]);
const ACTIVE_ADAPTER_JOB_STATUSES = new Set(["queued", "retry_scheduled", "running"]);
const BLOCKING_ADAPTER_JOB_STATUSES = new Set(["failed", "cancelled"]);
const BLOCKING_PLAN_STATUSES = new Set(["blocked", "cancelled"]);
const BLOCKING_WORKFLOW_STATES = new Set(["blocked", "terminated", "cancelled"]);
const TERMINAL_NODE_STATUSES = new Set(["completed", "failed", "cancelled"]);
const BLOCKING_NODE_STATUSES = new Set(["blocked", "failed", "cancelled"]);
const CANDIDATE_NODE_STATUSES = new Set(["planned", "ready"]);

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 readiness action dependency missing: ${name}`);
  return value;
}

function positiveLimit(input = {}, fallback = 20, max = 100) {
  const raw = Number(input.limit ?? input.detailLimit ?? input.detail_limit ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(raw)));
}

function countByStatus(rows = []) {
  const counts = {};
  for (const row of rows) {
    const status = String(row.status || "unknown");
    counts[status] = Number(counts[status] || 0) + 1;
  }
  return counts;
}

function scopedWhere(input = {}, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const clauses = [];
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  if (workflowId) clauses.push(`${prefix}workflow_id=${sqlValue(workflowId)}`);
  if (planId) clauses.push(`${prefix}plan_id=${sqlValue(planId)}`);
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function rowScopeMatchesPlan(row = {}, plan = {}) {
  return row.workflow_id === plan.workflow_id && row.plan_id === plan.plan_id;
}

function nodeReadyForDispatch(node = {}, nodeStatusById = new Map()) {
  if (!CANDIDATE_NODE_STATUSES.has(node.status || "")) return false;
  const dependsOn = workflowV2JsonArray(node.depends_on_json, []);
  if (!dependsOn.length) return true;
  return dependsOn.every((nodeId) => nodeStatusById.get(String(nodeId)) === "completed");
}

function planSummary(row = {}) {
  return {
    planId: row.plan_id || "",
    workflowId: row.workflow_id || "",
    status: row.status || "",
    workflowState: row.workflow_state || "",
    taskOwnerAgent: row.task_owner_agent || "",
    plannerAgent: row.planner_agent || "",
    objective: row.objective || "",
    participantManagers: workflowV2JsonArray(row.participant_managers_json, []),
    acceptanceCriteria: workflowV2JsonArray(row.acceptance_criteria_json, []),
    humanGatePolicy: workflowV2JsonObject(row.human_gate_policy_json, {}),
    planSpecArtifactRef: row.plan_spec_artifact_ref || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || ""
  };
}

function nodeSummary(row = {}) {
  return {
    nodeId: row.node_id || "",
    planId: row.plan_id || "",
    workflowId: row.workflow_id || "",
    parentNodeId: row.parent_node_id || "",
    nodeType: row.node_type || "",
    status: row.status || "",
    ownerAgent: row.owner_agent || "",
    runtimeBackend: row.runtime_backend || "",
    sessionId: row.session_id || "",
    dependsOn: workflowV2JsonArray(row.depends_on_json, []),
    inputInfoId: row.input_info_id || "",
    outputInfoId: row.output_info_id || "",
    updatedAt: row.updated_at || ""
  };
}

function nextDecisionForPlan(plan = {}, scoped = {}) {
  const nodes = scoped.nodes || [];
  const workers = scoped.workers || [];
  const adapterJobs = scoped.adapterJobs || [];
  const humanGatePackages = scoped.humanGatePackages || [];
  const nodeStatusById = new Map(nodes.map((node) => [node.node_id, node.status]));
  const readyNodes = nodes.filter((node) => nodeReadyForDispatch(node, nodeStatusById));
  const activeWorkers = workers.filter((row) => ACTIVE_WORKER_STATUSES.has(row.status || ""));
  const reviewWorkers = workers.filter((row) => REVIEW_WORKER_STATUSES.has(row.status || ""));
  const blockingWorkers = workers.filter((row) => BLOCKING_WORKER_STATUSES.has(row.status || ""));
  const activeAdapterJobs = adapterJobs.filter((row) => ACTIVE_ADAPTER_JOB_STATUSES.has(row.status || ""));
  const blockingAdapterJobs = adapterJobs.filter((row) => BLOCKING_ADAPTER_JOB_STATUSES.has(row.status || ""));
  const auditedHumanGatePackages = humanGatePackages.filter((row) => workflowV2IsProtocolAuditedPackageStatus(row.status || ""));
  const draftHumanGatePackages = humanGatePackages.filter((row) => row.status === "draft");
  const blockedNodes = nodes.filter((node) => BLOCKING_NODE_STATUSES.has(node.status || ""));
  const allNodesTerminal = nodes.length > 0 && nodes.every((node) => TERMINAL_NODE_STATUSES.has(node.status || ""));
  const allNodesCompleted = nodes.length > 0 && nodes.every((node) => node.status === "completed");
  const reasons = [];
  let decision = "waiting_dependencies";
  if (BLOCKING_PLAN_STATUSES.has(plan.status || "") || BLOCKING_WORKFLOW_STATES.has(plan.workflow_state || "")) {
    decision = "blocked";
    reasons.push("plan_status_blocked_or_cancelled");
  } else if (blockedNodes.length || blockingWorkers.length || blockingAdapterJobs.length) {
    decision = "blocked";
    reasons.push("blocking_runtime_or_node_state");
  } else if (auditedHumanGatePackages.length || plan.workflow_state === "human_gate_request_due" || plan.workflow_state === "waiting_human") {
    decision = "human_gate_pending";
    reasons.push("human_gate_package_or_state_pending");
  } else if (activeWorkers.length || activeAdapterJobs.length) {
    decision = "receipts_collecting";
    reasons.push("worker_or_adapter_activity_pending");
  } else if (reviewWorkers.length) {
    decision = "waiting_review";
    reasons.push("worker_output_review_pending");
  } else if (readyNodes.length) {
    decision = "dispatch_ready";
    reasons.push("dependency_ready_v2_plan_nodes");
  } else if (allNodesCompleted || plan.status === "completed" || plan.workflow_state === "completed") {
    decision = WORKFLOW_V2_SECRETARY_CLOSEOUT_REQUIRED;
    reasons.push("v2_plan_complete_closeout_required");
  } else if (allNodesTerminal) {
    decision = "blocked";
    reasons.push("terminal_non_completed_nodes_present");
  } else if (draftHumanGatePackages.length) {
    decision = WORKFLOW_V2_PROTOCOL_AUDIT_STATE;
    reasons.push("human_gate_package_draft_requires_protocol_audit");
  } else {
    reasons.push(nodes.length ? "no_dependency_ready_nodes" : "plan_has_no_nodes");
  }
  return {
    decision,
    reasons,
    readyNodes,
    activeWorkers,
    reviewWorkers,
    blockingWorkers,
    activeAdapterJobs,
    blockingAdapterJobs,
    auditedHumanGatePackages,
    draftHumanGatePackages,
    blockedNodes
  };
}

function aggregateDecision(planDecisions = []) {
  if (!planDecisions.length) return { decision: "needs_planning", reasons: ["no_v2_plan_found"] };
  const priority = [
    "blocked",
    "human_gate_pending",
    "receipts_collecting",
    "waiting_review",
    "dispatch_ready",
    WORKFLOW_V2_PROTOCOL_AUDIT_STATE,
    "waiting_protocol_audit",
    WORKFLOW_V2_SECRETARY_CLOSEOUT_REQUIRED,
    "cat_claw_summary_required",
    "waiting_dependencies"
  ];
  for (const decision of priority) {
    const matches = planDecisions.filter((item) => item.decision === decision);
    if (matches.length) {
      return {
        decision,
        reasons: [...new Set(matches.flatMap((item) => item.reasons))]
      };
    }
  }
  return { decision: "waiting_dependencies", reasons: ["no_higher_priority_v2_action"] };
}

export function createWorkflowV2ReadinessActionHandlers(context = {}) {
  const nowIso = requireContextFunction(context, "nowIso");

  async function workflowV2ReadinessPreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const generatedAt = firstText(input.generatedAt, input.generated_at, input.now) || nowIso();
    const includeDetails = boolOption(input.includeDetails ?? input.include_details, true);
    const limit = positiveLimit(input);
    if (!fileExistsSync(paths.dbFile)) {
      return {
        operation: "workflow.v2.readiness.preview",
        dryRun: true,
        previewOnly: true,
        ok: true,
        status: "ok",
        decision: "needs_planning",
        nextDecision: "needs_planning",
        reasons: ["workflow_database_missing"],
        generatedAt,
        counts: { plans: 0, nodes: 0, workerRuns: 0, adapterJobs: 0, humanGatePackages: 0 },
        plans: [],
        would: {
          spawnWorkers: false,
          drainAdapterJobs: false,
          requestHumanGate: false,
          secretaryCloseout: false,
          catClawCloseout: false
        },
        dbFile: paths.dbFile
      };
    }
    const wherePlans = scopedWhere(input, "p");
    const plans = await sqlite(paths.dbFile, `
SELECT p.*
FROM workflow_v2_plans p
${wherePlans}
ORDER BY p.updated_at DESC, p.created_at DESC, p.plan_id ASC
LIMIT ${limit};`, { json: true });
    if (!plans.length) {
      return {
        operation: "workflow.v2.readiness.preview",
        dryRun: true,
        previewOnly: true,
        ok: true,
        status: "ok",
        decision: "needs_planning",
        nextDecision: "needs_planning",
        reasons: ["no_v2_plan_found"],
        generatedAt,
        counts: { plans: 0, nodes: 0, workerRuns: 0, adapterJobs: 0, humanGatePackages: 0 },
        plans: [],
        would: {
          spawnWorkers: false,
          drainAdapterJobs: false,
          requestHumanGate: false,
          secretaryCloseout: false,
          catClawCloseout: false
        },
        dbFile: paths.dbFile
      };
    }
    const whereScope = scopedWhere(input);
    const [nodes, workers, adapterJobs, humanGatePackages] = await Promise.all([
      sqlite(paths.dbFile, `SELECT * FROM workflow_v2_plan_nodes ${whereScope} ORDER BY updated_at DESC, created_at DESC, node_id ASC;`, { json: true }),
      sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_runs ${whereScope} ORDER BY updated_at DESC, created_at DESC, worker_run_id ASC;`, { json: true }),
      sqlite(paths.dbFile, `SELECT * FROM workflow_v2_worker_adapter_jobs ${whereScope} ORDER BY updated_at DESC, created_at DESC, adapter_job_id ASC;`, { json: true }),
      sqlite(paths.dbFile, `SELECT * FROM workflow_v2_human_gate_packages ${whereScope} ORDER BY updated_at DESC, created_at DESC, package_id ASC;`, { json: true })
    ]);
    const planDecisions = plans.map((plan) => {
      const scoped = {
        nodes: nodes.filter((row) => rowScopeMatchesPlan(row, plan)),
        workers: workers.filter((row) => rowScopeMatchesPlan(row, plan)),
        adapterJobs: adapterJobs.filter((row) => rowScopeMatchesPlan(row, plan)),
        humanGatePackages: humanGatePackages.filter((row) => rowScopeMatchesPlan(row, plan))
      };
      const decision = nextDecisionForPlan(plan, scoped);
      const details = {
        ...planSummary(plan),
        decision: decision.decision,
        reasons: decision.reasons,
        counts: {
          nodes: scoped.nodes.length,
          nodesByStatus: countByStatus(scoped.nodes),
          workerRuns: scoped.workers.length,
          workerRunsByStatus: countByStatus(scoped.workers),
          adapterJobs: scoped.adapterJobs.length,
          adapterJobsByStatus: countByStatus(scoped.adapterJobs),
          humanGatePackages: scoped.humanGatePackages.length,
          humanGatePackagesByStatus: countByStatus(scoped.humanGatePackages),
          readyNodes: decision.readyNodes.length,
          activeWorkers: decision.activeWorkers.length,
          reviewWorkers: decision.reviewWorkers.length,
          activeAdapterJobs: decision.activeAdapterJobs.length,
          auditedHumanGatePackages: decision.auditedHumanGatePackages.length
        },
        would: {
          spawnWorkers: decision.decision === "dispatch_ready" && decision.readyNodes.length > 0,
          drainAdapterJobs: decision.activeAdapterJobs.length > 0,
          requestHumanGate: decision.auditedHumanGatePackages.length > 0,
          secretaryCloseout: workflowV2IsSecretaryCloseoutRequired(decision.decision),
          catClawCloseout: workflowV2IsSecretaryCloseoutRequired(decision.decision)
        }
      };
      if (includeDetails) {
        details.readyNodes = decision.readyNodes.slice(0, limit).map(nodeSummary);
        details.activeWorkers = decision.activeWorkers.slice(0, limit).map(workflowV2WorkerRunSummary);
        details.reviewWorkers = decision.reviewWorkers.slice(0, limit).map(workflowV2WorkerRunSummary);
        details.activeAdapterJobs = decision.activeAdapterJobs.slice(0, limit).map(workflowV2AdapterJobSummary).filter(Boolean);
        details.humanGatePackages = decision.auditedHumanGatePackages.slice(0, limit).map(workflowV2HumanGatePackageSummary).filter(Boolean);
        details.draftHumanGatePackages = decision.draftHumanGatePackages.slice(0, limit).map(workflowV2HumanGatePackageSummary).filter(Boolean);
      }
      return details;
    });
    const aggregate = aggregateDecision(planDecisions);
    return {
      operation: "workflow.v2.readiness.preview",
      dryRun: true,
      previewOnly: true,
      ok: true,
      status: "ok",
      decision: aggregate.decision,
      nextDecision: aggregate.decision,
      reasons: aggregate.reasons,
      generatedAt,
      counts: {
        plans: plans.length,
        plansByStatus: countByStatus(plans),
        nodes: nodes.length,
        nodesByStatus: countByStatus(nodes),
        workerRuns: workers.length,
        workerRunsByStatus: countByStatus(workers),
        adapterJobs: adapterJobs.length,
        adapterJobsByStatus: countByStatus(adapterJobs),
        humanGatePackages: humanGatePackages.length,
        humanGatePackagesByStatus: countByStatus(humanGatePackages)
      },
      plans: planDecisions,
      would: {
        spawnWorkers: planDecisions.some((item) => item.would.spawnWorkers),
        drainAdapterJobs: planDecisions.some((item) => item.would.drainAdapterJobs),
        requestHumanGate: planDecisions.some((item) => item.would.requestHumanGate),
        secretaryCloseout: planDecisions.some((item) => item.would.secretaryCloseout),
        catClawCloseout: planDecisions.some((item) => item.would.catClawCloseout)
      },
      limitations: [
        "preview_only_no_dispatch_or_state_mutation",
        "human_gate_completion_is_owned_by_human_gate_records_not_v2_package_status"
      ],
      dbFile: paths.dbFile
    };
  }

  return {
    workflowV2ReadinessPreview
  };
}
