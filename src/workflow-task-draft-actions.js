import fs from "node:fs/promises";
import {
  boolOption,
  safeId,
  textHash,
  toList
} from "./workflow/json.js";
import {
  workflowPaths
} from "./workflow/paths.js";

export const WORKFLOW_TASK_DRAFT_ACTION_HANDLER_NAMES = {
  "workflow.task.draft": "workflowTaskDraft",
  "workflow.task.preview": "workflowTaskDraft",
  "workflow.task.create.preview": "workflowTaskDraft",
  "workflow.meeting_task.draft": "workflowTaskDraft"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow task draft action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`workflow task draft action dependency missing: ${name}`);
  return context[name];
}

export function createWorkflowTaskDraftActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_TASK_DRAFT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow task draft action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowTaskDraftAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createWorkflowTaskDraftActionHandlers(context = {}) {
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const nowIso = requireContextFunction(context, "nowIso");
  const resolveRegisteredDispatchTarget = requireContextFunction(context, "resolveRegisteredDispatchTarget");
  const HUMAN_GATE_APPROVE_OPTION_MIN = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MIN");
  const HUMAN_GATE_APPROVE_OPTION_MAX = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MAX");

  function uniqueAgentIds(values = []) {
    const result = [];
    const seen = new Set();
    for (const value of values) {
      const text = String(value || "").trim();
      if (!text) continue;
      const [, agentPart] = text.includes(":") ? text.split(":", 2) : ["", text];
      const agentId = normalizeAgentId(agentPart || text);
      if (seen.has(agentId)) continue;
      seen.add(agentId);
      result.push(agentId);
    }
    return result;
  }

  function taskDraftInputAgents(input = {}) {
    return uniqueAgentIds([
      ...toList(input.participants || input.participant),
      ...toList(input.agents || input.agentIds || input.agent_ids),
      ...toList(input.toAgents || input.to_agents || input.targets || input.to),
      ...toList(input.workers || input.worker),
      input.ownerAgent || input.owner_agent || input.owner,
      input.agentId || input.agent_id,
      input.consumerAgent || input.consumer_agent || input.consumer
    ]);
  }

  function stockLongTermTrackingDraftAppendix(input = {}) {
    const template = String(input.template || input.taskTemplate || input.task_template || "").trim().toLowerCase();
    const enabled = template === "stock_longterm_tracking"
      || template === "stock-longterm-tracking"
      || boolOption(input.stockLongTermTracking ?? input.stock_longterm_tracking, false);
    if (!enabled) return null;
    return {
      template: "stock_longterm_tracking",
      scope: [
        "Clarify cron ownership and failure response for long-term stock tracking.",
        "Clarify market_intelligence.db schema/data ownership and freshness evidence.",
        "Clarify data supplement boundaries across cat_eyes, cat_ears, cat_nose, and cat_heart consumption needs."
      ],
      proposedResponsibilityMap: [
        {
          agentId: "cat_eyes",
          focus: "price, technical, filing, chart, and visual inspection evidence",
          expectedOutput: "owned jobs, source boundaries, freshness checks, and supplementation gaps"
        },
        {
          agentId: "cat_ears",
          focus: "news, public narrative, catalyst, social and macro signal intake",
          expectedOutput: "owned jobs, source boundaries, freshness checks, and supplementation gaps"
        },
        {
          agentId: "cat_nose",
          focus: "data quality smell, anomaly detection, cross-source consistency, and stale-data alarms",
          expectedOutput: "owned jobs, source boundaries, freshness checks, and supplementation gaps"
        },
        {
          agentId: "cat_heart",
          focus: "consumer requirements for long-term tracking outputs and decision-readiness signals",
          expectedOutput: "consumer contract, minimum data set, freshness SLA, and acceptance criteria"
        }
      ],
      requiredArtifacts: [
        "current cron/job inventory with owner and state",
        "market_intelligence.db table/data-source ownership map",
        "data supplement backlog with owner and acceptance criteria",
        "executable division-of-responsibility plan with rollback/stop conditions"
      ]
    };
  }

  async function resolveDraftParticipant(paths, agentId) {
    try {
      await fs.access(paths.dbFile);
    } catch {
      return {
        agentId,
        registered: false,
        runtime: "",
        platform: "",
        workflowIngressAdapter: "",
        endpointRef: "",
        canReceiveDispatch: false,
        error: "workflow control-plane database not found; registry resolution skipped for pure preview"
      };
    }
    try {
      const resolved = await resolveRegisteredDispatchTarget(paths, { agentId });
      return {
        agentId,
        registered: true,
        runtime: resolved.target.runtime || "",
        platform: resolved.registry.platform || "",
        workflowIngressAdapter: resolved.registry.workflowIngressAdapter || "",
        endpointRef: resolved.registry.endpointRef || "",
        canReceiveDispatch: resolved.registry.canReceiveDispatch
      };
    } catch (error) {
      return {
        agentId,
        registered: false,
        runtime: "",
        platform: "",
        workflowIngressAdapter: "",
        endpointRef: "",
        canReceiveDispatch: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  function draftGate(name, ok, message, severity = "error") {
    return { name, status: ok ? "pass" : severity, message };
  }

  function taskDraftParticipantRole(agentId, governance = {}) {
    if (agentId === governance.chairAgent) return "chair";
    if (agentId === governance.secretaryAgent) return "secretary_auditor";
    if (agentId === governance.consumerAgent) return "consumer";
    return "worker";
  }

  function taskDraftPhaseDependencies(phases = []) {
    const phaseIds = new Set(phases.map((phase) => phase.id).filter(Boolean));
    const dependencies = new Map();
    for (const phase of phases) {
      const dependsOn = [];
      if (phase.id === "responsibility_self_check" || phase.id === "consumer_requirements") {
        dependsOn.push("scope");
      } else if (phase.id === "cross_discussion") {
        dependsOn.push("responsibility_self_check", "consumer_requirements");
        if (!phaseIds.has("responsibility_self_check") && !phaseIds.has("consumer_requirements")) dependsOn.push("scope");
      } else if (phase.id === "plan_synthesis") {
        dependsOn.push("cross_discussion");
        if (!phaseIds.has("cross_discussion")) dependsOn.push("responsibility_self_check");
      } else if (phase.id === "secretary_audit") {
        dependsOn.push("plan_synthesis");
      } else if (phase.id === "human_gate_package") {
        dependsOn.push("secretary_audit");
      }
      dependencies.set(phase.id, [...new Set(dependsOn.filter((id) => phaseIds.has(id)))]);
    }
    return dependencies;
  }

  function workflowPlanNodeType(phaseId) {
    if (phaseId === "secretary_audit") return "secretary_audit";
    if (phaseId === "human_gate_package") return "human_gate";
    if (phaseId === "plan_synthesis") return "reducer";
    return "worker";
  }

  function planSpecV2ContractOk(plan = {}) {
    const nodeFields = [
      "nodeId", "phaseId", "nodeType", "ownerAgent", "runtime", "agentId", "dependsOn",
      "inputRefs", "prompt", "allowedCapabilities", "expectedArtifacts", "receiptRequired",
      "humanGateRequired", "timeoutSeconds", "retryPolicy", "maxAttempts",
      "acceptanceCriteria", "policyGate", "sideEffectPolicy", "verifier",
      "failureRoute", "idempotencyKey"
    ];
    const evidenceRefs = ["artifactRefs", "receiptRefs", "messageFlowRefs", "outboxRefs", "sideEffectRefs", "incidentRefs", "readinessRefs", "checkpointRefs"];
    const resumeFields = ["checkpointBeforeHumanGate", "checkpointBeforeSideEffect", "checkpointAfterRuntimeReceipt", "reuseCompletedNodes", "invalidateOn", "resumeFrom", "sideEffectUncertainHandling"];
    const required = Boolean(
      plan?.schemaVersion === "workflow_plan_spec.v2"
      && plan.meta?.planId
      && plan.meta?.workflowId
      && plan.meta?.traceId
      && plan.meta?.idempotencyKey
      && plan.acceptance?.workflowSuccess
      && plan.verification?.mode
      && plan.verification?.verifierAgent
      && plan.verification?.rubric
      && plan.humanGatePolicy?.language
      && plan.permissionPolicy?.defaultOutcome
      && plan.artifacts
      && plan.audit
    );
    return required
      && plan.nodes.every((node) => nodeFields.every((field) => Object.prototype.hasOwnProperty.call(node, field)))
      && evidenceRefs.every((field) => Array.isArray(plan.evidencePolicy?.[field]))
      && resumeFields.every((field) => Object.prototype.hasOwnProperty.call(plan.resumePolicy || {}, field))
      && Array.isArray(plan.failureRoutes)
      && plan.failureRoutes.every((route) => route.routeId && route.match && route.action && route.ownerAgent);
  }

  function buildWorkflowPlanSpecV2(spec = {}, input = {}) {
    const governance = spec.governance || {};
    const phases = Array.isArray(spec.phases) ? spec.phases : [];
    const participantRows = Array.isArray(spec.participants) ? spec.participants : [];
    const participantById = new Map(participantRows.map((participant) => [participant.agentId, participant]));
    const phaseDependencies = taskDraftPhaseDependencies(phases);
    const planSeed = [spec.workflowId, spec.traceId, spec.idempotencyKey, spec.objective].join("\n");
    const sourceSystem = String(input.sourceSystem || input.source_system || "workflow.task.draft").trim();
    const timezone = String(input.timezone || input.time_zone || "Asia/Shanghai").trim();
    const acceptanceCriteria = toList(input.acceptanceCriteria || input.acceptance_criteria || input.acceptance)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const stopConditions = toList(input.stopCondition || input.stop_condition || input.stop)
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const humanGatePolicy = {
      ...(governance.humanGatePolicy || {
        language: "zh-CN",
        optionsMinimum: HUMAN_GATE_APPROVE_OPTION_MIN,
        optionsMaximum: HUMAN_GATE_APPROVE_OPTION_MAX,
        requiredControls: ["pause_workflow", "terminate_workflow"]
      }),
      required: Boolean(governance.humanGateRequired),
      submitterAgent: governance.secretaryAgent || "cat_claw",
      reviewerAgent: governance.chairAgent || "main",
      requiresOriginalWords: Boolean(governance.humanGateRequired),
      buttonStylePolicy: {
        approveOptions: "success",
        pauseWorkflow: "primary",
        terminateWorkflow: "danger",
        rejectOrReturn: "danger"
      },
      deliveryPolicy: "button_first_token_bound_review_form",
      resumeTarget: governance.chairAgent || "main",
      rollbackBoundary: "checkpoint_before_human_gate"
    };
    const phaseGraph = phases.map((phase, index) => {
      const ownerAgents = uniqueAgentIds([phase.ownerAgent, ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : [])]);
      return {
        phaseId: phase.id || `phase_${index + 1}`,
        ordinal: index + 1,
        status: "planned",
        ownerAgents,
        dependsOn: phaseDependencies.get(phase.id) || [],
        objective: phase.objective || "",
        acceptanceCriteria: [
          phase.objective || "Phase objective is completed.",
          "Required receipt and evidence references are returned before the next phase advances."
        ].filter(Boolean)
      };
    });
    const phaseNodeIds = new Map();
    const failureRoutes = [
      {
        routeId: "missing_receipt",
        match: { status: "needs_evidence" },
        action: "return_to_evidence_collection",
        ownerAgent: governance.chairAgent || "main",
        humanGateRequired: false,
        incidentRequired: false
      },
      {
        routeId: "human_gate_rejected_or_incomplete",
        match: { status: "human_gate_rejected" },
        action: "return_to_evidence_collection",
        ownerAgent: governance.chairAgent || "main",
        humanGateRequired: false,
        incidentRequired: false
      },
      {
        routeId: "human_gate_paused",
        match: { status: "human_gate_paused" },
        action: "pause_workflow",
        ownerAgent: governance.secretaryAgent || "cat_claw",
        humanGateRequired: true,
        incidentRequired: false
      },
      {
        routeId: "human_gate_terminated",
        match: { status: "human_gate_terminated" },
        action: "terminate_workflow",
        ownerAgent: governance.secretaryAgent || "cat_claw",
        humanGateRequired: true,
        incidentRequired: false
      },
      {
        routeId: "side_effect_uncertain",
        match: { status: "side_effect_uncertain" },
        action: "mark_side_effect_uncertain",
        ownerAgent: governance.chairAgent || "main",
        humanGateRequired: true,
        incidentRequired: true
      }
    ];
    const nodes = [];
    for (const phase of phaseGraph) {
      const nodeIds = [];
      for (const ownerAgent of phase.ownerAgents) {
        const participant = participantById.get(ownerAgent) || {};
        const nodeId = `node.${cleanFileSegment(phase.phaseId)}.${cleanFileSegment(ownerAgent)}`;
        nodeIds.push(nodeId);
        nodes.push({
          nodeId,
          phaseId: phase.phaseId,
          nodeType: workflowPlanNodeType(phase.phaseId),
          ownerAgent,
          runtime: participant.runtime || "",
          agentId: ownerAgent,
          taskType: phase.phaseId === "human_gate_package" ? "human_gate_package" : "workflow_phase",
          status: "planned",
          priority: spec.priority || "normal",
          dependsOn: [],
          inputRefs: [],
          prompt: [
            `Workflow: ${spec.workflowId}`,
            `Phase: ${phase.phaseId}`,
            `Objective: ${phase.objective || spec.objective || ""}`,
            "Return evidence, artifact refs, open risks, and readiness for the next phase."
          ].join("\n"),
          allowedCapabilities: [],
          expectedArtifacts: [`${phase.phaseId} evidence and receipt for ${spec.workflowId}`],
          acceptanceCriteria: phase.acceptanceCriteria,
          receiptRequired: true,
          humanGateRequired: phase.phaseId === "human_gate_package",
          timeoutSeconds: 3600,
          maxAttempts: 1,
          retryPolicy: {
            maxAttempts: 1,
            backoff: "manual_after_receipt_review"
          },
          policyGate: {
            outcome: phase.phaseId === "human_gate_package" ? "requires_human_gate" : "requires_protocol_audit",
            riskTier: "unknown"
          },
          toolPolicy: {
            requiredCapabilities: [],
            allowedTools: [],
            restrictedTools: []
          },
          sideEffectPolicy: {
            allowed: false,
            requiresLedger: true,
            idempotencyKeyRequired: true
          },
          verifier: {
            agentId: phase.phaseId === "secretary_audit" ? governance.secretaryAgent || "cat_claw" : governance.chairAgent || "main",
            mode: "reviewer_agent"
          },
          failureRoute: phase.phaseId === "human_gate_package" ? "human_gate_rejected_or_incomplete" : "missing_receipt",
          idempotencyKey: `workflow_plan_node:${spec.workflowId}:${phase.phaseId}:${ownerAgent}`,
          protected: ["main", "cat_claw", "cat_heart"].includes(ownerAgent)
        });
      }
      phaseNodeIds.set(phase.phaseId, nodeIds);
    }
    for (const node of nodes) {
      const phase = phaseGraph.find((item) => item.phaseId === node.phaseId);
      node.dependsOn = [...new Set((phase?.dependsOn || []).flatMap((phaseId) => phaseNodeIds.get(phaseId) || []))];
    }
    return {
      schemaVersion: "workflow_plan_spec.v2",
      meta: {
        planId: `plan.${textHash(planSeed).slice(0, 16)}`,
        planRevision: 1,
        workflowId: spec.workflowId,
        traceId: spec.traceId,
        idempotencyKey: spec.idempotencyKey,
        createdAt: spec.createdAt,
        updatedAt: spec.createdAt,
        timezone,
        sourceSystem,
        sourceChannel: input.sourceChannel || input.source_channel || sourceSystem,
        sourceMessageId: input.sourceMessageId || input.source_message_id || "",
        registrySnapshotRef: "runtime_agents@draft_time"
      },
      objective: {
        subject: spec.subject || "",
        goal: spec.objective || "",
        taskType: spec.taskType || "",
        priority: spec.priority || "normal",
        acceptanceCriteria,
        stopConditions
      },
      participants: participantRows.map((participant) => ({
        agentId: participant.agentId,
        role: taskDraftParticipantRole(participant.agentId, governance),
        runtime: participant.runtime || "",
        platform: participant.platform || "",
        endpointRef: participant.endpointRef || "",
        registered: Boolean(participant.registered),
        canReceiveDispatch: Boolean(participant.canReceiveDispatch),
        capabilities: []
      })),
      phaseGraph,
      nodes,
      acceptance: {
        workflowSuccess: acceptanceCriteria.length ? acceptanceCriteria : [
          "All planned nodes return receipt and evidence references.",
          "Cat Brain verifies semantic readiness before Cat Claw submits any Human Gate package."
        ],
        phaseSuccessDefaults: [
          "All phase nodes are terminal successful or explicitly waived by the reviewer.",
          "Required evidence is linked before dependent phases advance."
        ],
        requiredReceipts: nodes.filter((node) => node.receiptRequired).map((node) => node.nodeId),
        requiredArtifacts: nodes.flatMap((node) => node.expectedArtifacts || []),
        requiredHumanGates: nodes.filter((node) => node.humanGateRequired).map((node) => node.nodeId),
        blockedIf: ["missing_required_receipt", "missing_required_artifact", "human_gate_pending_or_rejected"],
        completeOnlyIf: ["required_receipts_present", "required_artifacts_present", "reviewer_verification_passed"]
      },
      verification: {
        mode: governance.humanGateRequired ? "human_gate" : "reviewer_agent",
        verifierAgent: governance.chairAgent || "main",
        refuterAgent: "",
        rubric: [
          "Task decomposition matches stated objective and agent responsibilities.",
          "Evidence and receipts are sufficient for each completed node.",
          `Human Gate packages preserve ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} approvable options, Chinese-format body, pause, terminate, and rollback boundaries.`
        ],
        minimumEvidence: ["runtime_receipt", "artifact_ref", "protocol_audit_before_human_gate"],
        failureHandling: "route_by_failureRoutes",
        required: true,
        verifierAgents: [governance.chairAgent || "main", governance.secretaryAgent || "cat_claw"],
        receiptRequired: true,
        evidenceRequired: true,
        protocolAuditBeforeHumanGate: Boolean(governance.humanGateRequired)
      },
      humanGatePolicy,
      permissionPolicy: {
        defaultOutcome: "allow",
        gates: [],
        finalApprover: "flashcat",
        governanceAuditRequired: true,
        catClawSubmitterRequired: Boolean(governance.humanGateRequired)
      },
      evidencePolicy: {
        artifactRefs: [],
        receiptRefs: [],
        messageFlowRefs: [],
        outboxRefs: [],
        sideEffectRefs: [],
        incidentRefs: [],
        readinessRefs: [],
        checkpointRefs: [],
        artifactRefsRequired: true,
        receiptRefsRequired: true,
        rawLogsInPlan: false,
        evidencePackBeforeHumanGate: Boolean(governance.humanGateRequired)
      },
      resumePolicy: {
        stableWorkflowId: true,
        stableTraceId: true,
        checkpointBeforeHumanGate: true,
        idempotencyKeyRequired: true,
        checkpointBeforeSideEffect: true,
        checkpointAfterRuntimeReceipt: true,
        reuseCompletedNodes: true,
        invalidateOn: ["participant_change", "acceptance_change", "permission_policy_change"],
        resumeFrom: "latest_checkpoint_or_terminal_receipt",
        sideEffectUncertainHandling: "pause_and_request_human_review",
        ...(spec.resumePolicy || {})
      },
      failureRoutes,
      artifacts: {
        planArtifactRef: "",
        sourceRefs: [],
        generatedRefs: []
      },
      audit: {
        generatedBy: "workflow.task.draft",
        status: "draft",
        reviewerAgent: governance.chairAgent || "main",
        secretaryAuditAgent: governance.secretaryAgent || "cat_claw",
        qualityGates: []
      },
      compatibility: {
        taskLaunchPackageVersion: "workflow_task_launch_package.v1",
        materializesTo: ["workflow_runs", "workflow_tasks", "workflow_task_dependencies"],
        phaseSource: "workflow_tasks.phase"
      }
    };
  }

  async function workflowTaskDraft(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const createdAt = nowIso();
    const workflowId = String(input.workflowId || input.workflow_id || input.meetingId || input.meeting_id || safeId("workflow")).trim();
    const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
    const subject = String(input.subject || input.summary || input.title || "").trim();
    const objective = String(input.objective || input.goal || input.prompt || input.body || input.text || subject).trim();
    const taskType = String(input.taskType || input.task_type || input.type || "meeting_task").trim();
    const defaultGovernance = boolOption(input.defaultGovernance ?? input.default_governance, true)
      && !boolOption(input.noDefaultGovernance ?? input.no_default_governance, false);
    const chairAgent = normalizeAgentId(input.chairAgent || input.chair_agent || input.chair || "main");
    const secretaryAgent = normalizeAgentId(input.secretaryAgent || input.secretary_agent || input.secretary || "cat_claw");
    const consumerAgent = input.consumerAgent || input.consumer_agent || input.consumer
      ? normalizeAgentId(input.consumerAgent || input.consumer_agent || input.consumer)
      : "";
    const requestedAgents = taskDraftInputAgents(input);
    const crossAgent = boolOption(input.crossAgent || input.cross_agent, false)
      || requestedAgents.length > 1
      || taskType.includes("meeting")
      || taskType.includes("cross");
    const requiresHumanGate = boolOption(input.requiresHumanGate ?? input.requires_human_gate ?? input.humanGateRequired ?? input.human_gate_required, true);
    const primaryOwner = requestedAgents[0] || chairAgent;
    const consumerPhaseOwner = consumerAgent || (crossAgent ? "cat_heart" : "");
    const needsSecretary = crossAgent || requiresHumanGate;
    const participants = uniqueAgentIds([
      ...(defaultGovernance && crossAgent ? [chairAgent] : []),
      ...requestedAgents,
      ...(consumerPhaseOwner ? [consumerPhaseOwner] : []),
      ...(defaultGovernance && needsSecretary ? [secretaryAgent] : [])
    ]);
    const participantRecords = [];
    for (const agentId of participants) {
      participantRecords.push(await resolveDraftParticipant(paths, agentId));
    }
    const participantIds = new Set(participants);
    const stockAppendix = stockLongTermTrackingDraftAppendix(input);
    const phases = crossAgent
      ? [
          {
            id: "scope",
            ownerAgent: chairAgent,
            objective: "Confirm task scope, participants, artifacts, and stop conditions before execution."
          },
          {
            id: "responsibility_self_check",
            ownerAgents: participants.filter((agentId) => ![chairAgent, secretaryAgent].includes(agentId)),
            objective: "Each participating owner audits its own current execution responsibilities, boundaries, inputs, and gaps."
          },
          {
            id: "cross_discussion",
            ownerAgent: chairAgent,
            objective: "Cat Brain hosts discussion, resolves overlaps, and records open conflicts for evidence-backed decisions."
          },
          ...(consumerPhaseOwner ? [{
            id: "consumer_requirements",
            ownerAgent: consumerPhaseOwner,
            objective: "Primary consuming agent states required outputs, freshness needs, acceptance criteria, and failure visibility."
          }] : []),
          {
            id: "plan_synthesis",
            ownerAgent: chairAgent,
            objective: `Cat Brain forms ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} mutually exclusive executable options with rollback and stop boundaries.`
          },
          ...(requiresHumanGate ? [
            {
              id: "secretary_audit",
              ownerAgent: secretaryAgent,
              objective: "Protocol audits evidence completeness, receipt references, Chinese-format report quality, and button-first Human Gate structure."
            },
            {
              id: "human_gate_package",
              ownerAgent: secretaryAgent,
              objective: `Cat Claw submits the audited package to Flashcat with ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} approve options plus pause and terminate controls.`
            }
          ] : [])
        ]
      : [
          {
            id: "task_preview",
            ownerAgent: primaryOwner,
            objective: "Preview normalized single-agent workflow task ownership, runtime resolution, receipt expectation, and stop conditions."
          },
          ...(requiresHumanGate ? [
            {
              id: "secretary_audit",
              ownerAgent: secretaryAgent,
              objective: "Protocol audits evidence completeness, receipt references, Chinese-format report quality, and button-first Human Gate structure."
            },
            {
              id: "human_gate_package",
              ownerAgent: secretaryAgent,
              objective: "Cat Claw submits the audited package to Flashcat before execution."
            }
          ] : [])
        ];
    const humanGateDraft = requiresHumanGate ? {
      options: [
        {
          id: "option_1",
          title: "Option 1",
          required: true,
          ownerAgent: chairAgent,
          acceptance: "Executable, mutually exclusive, evidence-backed plan option with rollback and stop boundaries."
        },
        {
          id: "option_2",
          title: "Option 2",
          required: true,
          ownerAgent: chairAgent,
          acceptance: "Executable, mutually exclusive, evidence-backed plan option with rollback and stop boundaries."
        }
      ],
      controls: [
        { id: "pause_workflow", required: true, ownerAgent: secretaryAgent },
        { id: "terminate_workflow", required: true, ownerAgent: secretaryAgent }
      ],
      language: "zh-CN",
      contentOwnerAgent: chairAgent,
      auditOwnerAgent: secretaryAgent
    } : null;
    const humanGateControls = new Set((humanGateDraft?.controls || []).map((control) => control.id));
    const gates = [
      draftGate("cross_agent_governance_defaults", !crossAgent || (participantIds.has(chairAgent) && participantIds.has(secretaryAgent)), "Cross-agent workflow drafts must include Cat Brain as chair and Cat Claw as secretary."),
      draftGate("cat_brain_chair_present", !crossAgent || participantIds.has(chairAgent), "Cat Brain/main is present as meeting host."),
      draftGate("cat_claw_secretary_present", !needsSecretary || participantIds.has(secretaryAgent), "Cat Claw/cat_claw is present as secretary, recorder, evidence auditor, and Human Gate reporter."),
      draftGate("participant_registry_resolution", participantRecords.every((row) => row.registered), "Every draft participant resolves through runtime_agents.", "warning"),
      draftGate("phase_owners_in_participants", phases.every((phase) => {
        const owners = [phase.ownerAgent, ...(phase.ownerAgents || [])].filter(Boolean);
        return owners.every((owner) => participantIds.has(owner));
      }), "Every phase owner is listed in participants and covered by registry resolution."),
      requiresHumanGate
        ? draftGate("approve_options_count_required", (humanGateDraft?.options || []).length >= HUMAN_GATE_APPROVE_OPTION_MIN && (humanGateDraft?.options || []).length <= HUMAN_GATE_APPROVE_OPTION_MAX, `Human Gate package requires ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} executable approve options.`)
        : { name: "approve_options_count_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
      requiresHumanGate
        ? draftGate("pause_terminate_controls_required", humanGateControls.has("pause_workflow") && humanGateControls.has("terminate_workflow"), "Human Gate package must include pause and terminate controls.")
        : { name: "pause_terminate_controls_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
      requiresHumanGate
        ? draftGate("protocol_audit_before_human_gate", phases.some((phase) => phase.id === "secretary_audit"), "Protocol audit phase is placed before Human Gate submission.")
        : { name: "protocol_audit_before_human_gate", status: "not_applicable", message: "Human Gate is not required for this draft." }
    ];
    const resumePolicy = {
      stableWorkflowId: true,
      stableTraceId: true,
      checkpointBeforeHumanGate: true,
      idempotencyKeyRequired: true
    };
    const spec = {
      workflowId,
      traceId,
      idempotencyKey: String(input.idempotencyKey || input.idempotency_key || `draft:${workflowId}`).trim(),
      taskType,
      subject,
      objective,
      priority: String(input.priority || "normal").trim(),
      createdAt,
      governance: {
        defaultGovernance,
        crossAgent,
        chairAgent,
        secretaryAgent,
        consumerAgent,
        humanGateRequired: requiresHumanGate,
        humanGatePolicy: {
          language: "zh-CN",
          optionsMinimum: HUMAN_GATE_APPROVE_OPTION_MIN,
          optionsMaximum: HUMAN_GATE_APPROVE_OPTION_MAX,
          requiredControls: ["pause_workflow", "terminate_workflow"],
          catBrainOwnsPlanContent: true,
          protocolAuditsAndSubmits: true
        }
      },
      participants: participantRecords,
      phases,
      humanGateDraft,
      qualityGates: [],
      resumePolicy,
      appendix: stockAppendix
    };
    const planSpecV2 = buildWorkflowPlanSpecV2(spec, input);
    const planMeta = planSpecV2.meta || {};
    const planGates = [
      draftGate("plan_spec_v2_required_ids", Boolean(planSpecV2.schemaVersion && planMeta.planId && planMeta.workflowId && planMeta.traceId && planMeta.idempotencyKey), "Workflow Plan Spec v2 must include stable plan/workflow/trace/idempotency ids."),
      draftGate("plan_spec_v2_contract_shape", planSpecV2ContractOk(planSpecV2), "Workflow Plan Spec v2 must satisfy the documented node, evidence, resume, artifacts, and audit field contract."),
      draftGate("node_acceptance_required", planSpecV2.nodes.every((node) => Array.isArray(node.acceptanceCriteria) && node.acceptanceCriteria.length > 0), "Every Plan Spec v2 node must include acceptance criteria."),
      requiresHumanGate
        ? draftGate("human_gate_original_words_required", planSpecV2.humanGatePolicy?.requiresOriginalWords === true, "Human Gate policy must require Flashcat original words before completion.")
        : { name: "human_gate_original_words_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
      requiresHumanGate
        ? draftGate("human_gate_chinese_body_required", planSpecV2.humanGatePolicy?.language === "zh-CN", "Human Gate policy must require Chinese-format report content.")
        : { name: "human_gate_chinese_body_required", status: "not_applicable", message: "Human Gate is not required for this draft." },
      draftGate("failure_routes_required", Array.isArray(planSpecV2.failureRoutes) && planSpecV2.failureRoutes.length >= 3, "Plan Spec v2 must declare fallback routes for missing receipts, Human Gate failure, and uncertain side effects.")
    ];
    spec.planSpecV2 = planSpecV2;
    spec.qualityGates = [...gates, ...planGates];
    const warnings = spec.qualityGates.filter((gate) => ["error", "warning"].includes(gate.status)).map((gate) => gate.message);
    return {
      operation: "workflow.task.draft",
      dryRun: true,
      mutated: false,
      dbFile: paths.dbFile,
      warnings,
      spec
    };
  }

  return {
    workflowTaskDraft
  };
}
