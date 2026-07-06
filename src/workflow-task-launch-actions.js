import path from "node:path";
import {
  jsonHash,
  parseJsonValue,
  redactSensitiveForPersistence,
  safeId,
  textHash,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const WORKFLOW_TASK_LAUNCH_ACTION_HANDLER_NAMES = {
  "workflow.task.launch.prepare": "workflowTaskLaunchPrepare",
  "workflow.task.launch.draft": "workflowTaskLaunchPrepare",
  "workflow.task.launch.submit": "workflowTaskLaunchPrepare",
  "workflow.task.launch.list": "workflowTaskLaunchList",
  "workflow.task.launch.review": "workflowTaskLaunchReview",
  "workflow.task.launch.brain_review": "workflowTaskLaunchReview",
  "workflow.task.launch.approve": "workflowTaskLaunchApprove"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow task launch action dependency missing: ${name}`);
  return value;
}

export function createWorkflowTaskLaunchActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_TASK_LAUNCH_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow task launch action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowTaskLaunchAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createWorkflowTaskLaunchActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const isWorkflowTrustedOperator = requireContextFunction(context, "isWorkflowTrustedOperator");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const nowIso = requireContextFunction(context, "nowIso");
  const readProtocolObject = requireContextFunction(context, "readProtocolObject");
  const workflowPermissionCaller = requireContextFunction(context, "workflowPermissionCaller");
  const workflowPhaseRecordId = requireContextFunction(context, "workflowPhaseRecordId");
  const workflowRunUpsert = requireContextFunction(context, "workflowRunUpsert");
  const workflowTaskCreate = requireContextFunction(context, "workflowTaskCreate");
  const workflowTaskDraft = requireContextFunction(context, "workflowTaskDraft");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");

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

  function workflowTaskLaunchPhaseTasks(spec = {}, input = {}) {
    const workflowId = spec.workflowId || safeId("workflow");
    const draftId = String(input.draftId || input.draft_id || taskLaunchDraftId(spec, input)).trim();
    const prefix = cleanFileSegment(draftId);
    const phaseTaskIds = new Map();
    const tasks = [];
    const phases = Array.isArray(spec.phases) ? spec.phases : [];
    for (const phase of phases) {
      const owners = uniqueAgentIds([
        phase.ownerAgent,
        ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : [])
      ]);
      const taskIds = [];
      owners.forEach((ownerAgent, index) => {
        const suffix = owners.length > 1 ? `${phase.id}-${ownerAgent}` : phase.id;
        const taskId = `task.${prefix}.${cleanFileSegment(suffix || `phase-${index + 1}`)}`;
        taskIds.push(taskId);
        const dependsOn = [];
        if (phase.id === "responsibility_self_check" || phase.id === "consumer_requirements") {
          dependsOn.push(...(phaseTaskIds.get("scope") || []));
        } else if (phase.id === "cross_discussion") {
          dependsOn.push(...(phaseTaskIds.get("responsibility_self_check") || []));
          dependsOn.push(...(phaseTaskIds.get("consumer_requirements") || []));
          if (!dependsOn.length) dependsOn.push(...(phaseTaskIds.get("scope") || []));
        } else if (phase.id === "plan_synthesis") {
          dependsOn.push(...(phaseTaskIds.get("cross_discussion") || []));
          if (!dependsOn.length) dependsOn.push(...(phaseTaskIds.get("responsibility_self_check") || []));
        } else if (phase.id === "secretary_audit") {
          dependsOn.push(...(phaseTaskIds.get("plan_synthesis") || []));
        } else if (phase.id === "human_gate_package") {
          dependsOn.push(...(phaseTaskIds.get("secretary_audit") || []));
        }
        tasks.push({
          taskId,
          workflowId,
          phase: phase.id || "",
          ownerAgent,
          agentId: ownerAgent,
          taskType: phase.id === "human_gate_package" ? "human_gate_package" : "workflow_phase",
          status: "pending",
          priority: spec.priority || "normal",
          dependsOn: [...new Set(dependsOn)],
          receiptRequired: true,
          humanGateRequired: phase.id === "human_gate_package",
          expectedArtifact: `${phase.id || "phase"} evidence and receipt for ${workflowId}`,
          summary: `${phase.id || "phase"}: ${phase.objective || spec.subject || spec.objective || ""}`.slice(0, 500),
          prompt: [
            `Workflow task launch package ${draftId} has been approved by Flashcat and is now active.`,
            `Phase: ${phase.id || ""}`,
            `Objective: ${phase.objective || spec.objective || ""}`,
            "Use the canonical task launch package, referenced artifacts, receipts, and Flashcat original words as binding context.",
            "Return evidence, artifact refs, open risks, and whether the next phase is ready."
          ].join("\n")
        });
      });
      phaseTaskIds.set(phase.id, taskIds);
    }
    return tasks;
  }

  function taskLaunchDraftId(spec = {}, input = {}) {
    const explicit = String(input.draftId || input.draft_id || "").trim();
    if (explicit) return explicit;
    const stableSeed = [
      spec.workflowId || input.workflowId || input.workflow_id || "",
      spec.idempotencyKey || input.idempotencyKey || input.idempotency_key || "",
      spec.objective || input.objective || input.goal || input.prompt || input.body || input.text || ""
    ].join("\n");
    if (stableSeed.trim()) return `tlp.${textHash(stableSeed).slice(0, 16)}`;
    return safeId("task-launch");
  }

  function taskLaunchAuditMatrix(spec = {}, input = {}) {
    const chairAgent = spec.governance?.chairAgent || "main";
    const secretaryAgent = spec.governance?.secretaryAgent || "cat_claw";
    const consumerAgent = spec.governance?.consumerAgent || input.consumerAgent || input.consumer_agent || "";
    return [
      {
        stage: "intent_clarification",
        ownerAgent: secretaryAgent,
        auditorAgent: chairAgent,
        rejectAuthority: [chairAgent, "flashcat"],
        reworkTargetAgent: secretaryAgent,
        auditObjective: "Verify Cat Claw captured Flashcat's intent, unresolved questions, launch scope, and stop boundaries before execution."
      },
      {
        stage: "cat_brain_review",
        ownerAgent: chairAgent,
        auditorAgent: chairAgent,
        rejectAuthority: [chairAgent],
        reworkTargetAgent: secretaryAgent,
        auditObjective: "Review the canonical task launch package for phase order, agent boundaries, audit gates, evidence needs, and Human Gate readiness."
      },
      ...(consumerAgent ? [{
        stage: "consumer_contract_review",
        ownerAgent: consumerAgent,
        auditorAgent: chairAgent,
        rejectAuthority: [consumerAgent, chairAgent],
        reworkTargetAgent: secretaryAgent,
        auditObjective: "Verify the consuming agent can use the proposed outputs and that acceptance criteria are explicit."
      }] : []),
      {
        stage: "flashcat_launch_decision",
        ownerAgent: secretaryAgent,
        auditorAgent: "flashcat",
        rejectAuthority: ["flashcat"],
        reworkTargetAgent: secretaryAgent,
        auditObjective: "Flashcat approves, rejects, pauses, or terminates launch with token-bound original words."
      }
    ];
  }

  function renderTaskLaunchMarkdown(pkg = {}) {
    const lines = [];
    const addList = (items = [], render) => {
      if (!items.length) {
        lines.push("- none");
        return;
      }
      for (const item of items) lines.push(render(item));
    };
    lines.push(`# Task Launch Package ${pkg.draftId}`);
    lines.push("");
    lines.push(`- status: ${pkg.status}`);
    lines.push(`- workflow_id: ${pkg.workflowId}`);
    lines.push(`- trace_id: ${pkg.traceId}`);
    lines.push(`- created_at: ${pkg.createdAt}`);
    lines.push(`- drafter: ${pkg.roles?.drafterAgent || ""}`);
    lines.push(`- reviewer: ${pkg.roles?.reviewerAgent || ""}`);
    lines.push(`- final_approver: ${pkg.roles?.finalApprover || ""}`);
    lines.push("");
    lines.push("## Objective");
    lines.push("");
    lines.push(pkg.objective || "待补充。");
    lines.push("");
    lines.push("## Flashcat Intent");
    lines.push("");
    lines.push(pkg.intent?.flashcatIntent || pkg.intent?.sourceSummary || "待猫爪通过多轮会话补齐。");
    lines.push("");
    lines.push("## Participants");
    lines.push("");
    addList(pkg.participants || [], (participant) => `- ${participant.agentId}: runtime=${participant.runtime || ""} platform=${participant.platform || ""} registered=${participant.registered}`);
    lines.push("");
    lines.push("## Phases");
    lines.push("");
    addList(pkg.phases || [], (phase) => `- ${phase.id}: owner=${phase.ownerAgent || (phase.ownerAgents || []).join(",")} | ${phase.objective || ""}`);
    lines.push("");
    lines.push("## Audit Matrix");
    lines.push("");
    addList(pkg.auditMatrix || [], (gate) => `- ${gate.stage}: owner=${gate.ownerAgent} auditor=${gate.auditorAgent} reject=${(gate.rejectAuthority || []).join(",")} rework=${gate.reworkTargetAgent}`);
    lines.push("");
    lines.push("## Launch Tasks After Approval");
    lines.push("");
    addList(pkg.launchMaterialization?.tasks || [], (task) => `- ${task.taskId}: ${task.phase} -> ${task.ownerAgent} depends=[${(task.dependsOn || []).join(",")}]`);
    lines.push("");
    lines.push("## Human Gate");
    lines.push("");
    lines.push(`- required: ${Boolean(pkg.governance?.humanGateRequired)}`);
    lines.push(`- submitter: ${pkg.roles?.secretaryAgent || "cat_claw"}`);
    lines.push("- Flashcat original words are required before launch approval is complete.");
    lines.push("");
    lines.push("## Post Approval");
    lines.push("");
    lines.push(`- original_words_interpreter: ${pkg.postApproval?.flashcatOriginalWordsInterpreter || ""}`);
    lines.push(`- next_round_planner: ${pkg.postApproval?.nextRoundPlannerAgent || ""}`);
    lines.push(`- consumer: ${pkg.roles?.consumerAgent || ""}`);
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  function buildTaskLaunchPackage(draft = {}, input = {}, artifactRefs = {}) {
    const spec = draft.spec || {};
    const draftId = String(input.draftId || input.draft_id || taskLaunchDraftId(spec, input)).trim();
    const secretaryAgent = spec.governance?.secretaryAgent || normalizeAgentId(input.drafterAgent || input.drafter_agent || input.createdBy || input.from || "cat_claw");
    const chairAgent = spec.governance?.chairAgent || "main";
    const consumerAgent = spec.governance?.consumerAgent || input.consumerAgent || input.consumer_agent || "";
    const tasks = workflowTaskLaunchPhaseTasks(spec, { ...input, draftId });
    return {
      schemaVersion: "workflow_task_launch_package.v1",
      draftId,
      workflowId: spec.workflowId,
      traceId: spec.traceId,
      idempotencyKey: spec.idempotencyKey,
      status: "pending_cat_brain_review",
      taskType: spec.taskType,
      subject: spec.subject,
      objective: spec.objective,
      priority: spec.priority,
      createdAt: spec.createdAt || nowIso(),
      roles: {
        intentOwner: "flashcat",
        drafterAgent: secretaryAgent,
        secretaryAgent,
        reviewerAgent: chairAgent,
        supervisorAgent: chairAgent,
        finalApprover: "flashcat",
        consumerAgent,
        outputConsumerAgent: consumerAgent || ""
      },
      intent: {
        sourceSystem: input.sourceSystem || input.source_system || "workflow.task.launch.prepare",
        sourceSummary: input.intentSummary || input.intent_summary || input.summary || spec.subject || "",
        flashcatIntent: input.flashcatIntent || input.flashcat_intent || spec.objective || "",
        clarificationStatus: input.clarificationStatus || input.clarification_status || "initial_draft",
        openQuestions: toList(input.openQuestions || input.open_questions)
      },
      governance: spec.governance,
      participants: spec.participants || [],
      phases: spec.phases || [],
      planSpecV2: spec.planSpecV2 || null,
      auditMatrix: taskLaunchAuditMatrix(spec, input),
      qualityGates: spec.qualityGates || [],
      humanGateDraft: spec.humanGateDraft || null,
      launchMaterialization: {
        mode: "approval_required",
        materializeAction: "workflow.task.launch.approve",
        createsWorkflowRun: true,
        createsWorkflowTasks: true,
        tasks
      },
      postApproval: {
        flashcatOriginalWordsRequired: true,
        flashcatOriginalWordsInterpreter: secretaryAgent,
        nextRoundPlannerAgent: chairAgent,
        nextRoundDispatcher: "workflow",
        resumePolicy: spec.resumePolicy || {}
      },
      artifactRefs,
      appendix: spec.appendix || null
    };
  }

  async function syncWorkflowPhasesFromPlanSpec(paths, pkg = {}, timestamp = nowIso()) {
    const workflowId = pkg.workflowId || pkg.planSpecV2?.meta?.workflowId || "";
    if (!workflowId) return [];
    const plan = pkg.planSpecV2 || {};
    const phaseGraph = Array.isArray(plan.phaseGraph) ? plan.phaseGraph : [];
    const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
    const phases = phaseGraph.length ? phaseGraph : (Array.isArray(pkg.phases) ? pkg.phases.map((phase, index) => ({
      phaseId: phase.id || `phase_${index + 1}`,
      ordinal: index + 1,
      status: "planned",
      ownerAgents: uniqueAgentIds([phase.ownerAgent, ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : [])]),
      dependsOn: [],
      objective: phase.objective || "",
      acceptanceCriteria: [phase.objective || ""].filter(Boolean)
    })) : []);
    const synced = [];
    for (const phase of phases) {
      const phaseKey = phase.phaseId || phase.phaseKey || phase.id || "";
      if (!phaseKey) continue;
      const phaseNodes = nodes.filter((node) => node.phaseId === phaseKey);
      const ownerAgents = uniqueAgentIds([
        ...(Array.isArray(phase.ownerAgents) ? phase.ownerAgents : []),
        phase.ownerAgent,
        ...phaseNodes.map((node) => node.ownerAgent)
      ]);
      const verifierAgent = phase.verifierAgent || phaseNodes.find((node) => node.verifier?.agentId)?.verifier?.agentId || plan.verification?.verifierAgent || "";
      const humanGateRequired = phase.humanGateRequired === true || phaseNodes.some((node) => node.humanGateRequired === true);
      const phaseId = workflowPhaseRecordId(workflowId, phaseKey);
      const payload = {
        source: "planSpecV2",
        planId: plan.meta?.planId || "",
        objective: phase.objective || "",
        phase,
        nodeCount: phaseNodes.length
      };
      await sqlite(paths.dbFile, `
INSERT INTO workflow_phases(phase_id, workflow_id, phase_key, ordinal, status, owner_agent, owner_agents_json, depends_on_json, acceptance_criteria_json, verifier_agent, human_gate_required, plan_node_refs_json, payload_json, created_at, started_at, completed_at, updated_at)
VALUES (${sqlValue(phaseId)}, ${sqlValue(workflowId)}, ${sqlValue(phaseKey)}, ${Number(phase.ordinal || 0)}, ${sqlValue(phase.status || "planned")}, ${sqlValue(ownerAgents[0] || "")}, ${sqlValue(JSON.stringify(ownerAgents))}, ${sqlValue(JSON.stringify(phase.dependsOn || []))}, ${sqlValue(JSON.stringify(phase.acceptanceCriteria || []))}, ${sqlValue(verifierAgent)}, ${humanGateRequired ? 1 : 0}, ${sqlValue(JSON.stringify(phaseNodes.map((node) => node.nodeId)))}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(timestamp)}, NULL, NULL, ${sqlValue(timestamp)})
ON CONFLICT(phase_id) DO UPDATE SET
  ordinal=excluded.ordinal,
  status=CASE WHEN workflow_phases.status IN ('done','failed','cancelled') THEN workflow_phases.status ELSE excluded.status END,
  owner_agent=excluded.owner_agent,
  owner_agents_json=excluded.owner_agents_json,
  depends_on_json=excluded.depends_on_json,
  acceptance_criteria_json=excluded.acceptance_criteria_json,
  verifier_agent=excluded.verifier_agent,
  human_gate_required=excluded.human_gate_required,
  plan_node_refs_json=excluded.plan_node_refs_json,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
      synced.push({ phaseId, phaseKey, status: phase.status || "planned", ownerAgents, nodeCount: phaseNodes.length });
    }
    return synced;
  }

  async function workflowTaskLaunchPrepare(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const draft = await workflowTaskDraft(rootDir, {
      ...input,
      secretaryAgent: input.secretaryAgent || input.secretary_agent || input.drafterAgent || input.drafter_agent || "cat_claw",
      chairAgent: input.chairAgent || input.chair_agent || "main",
      requiresHumanGate: input.requiresHumanGate ?? input.requires_human_gate ?? true
    });
    const blockingErrors = (draft.spec?.qualityGates || []).filter((gate) => gate.status === "error");
    if (blockingErrors.length) {
      throw new Error(`workflow task launch package has blocking draft gate errors: ${blockingErrors.map((gate) => gate.name).join(", ")}`);
    }
    const draftId = String(input.draftId || input.draft_id || taskLaunchDraftId(draft.spec, input)).trim();
    const existingPackage = await readProtocolObject(paths, draftId);
    if (existingPackage?.object_type === "workflow_task_launch_package") {
      const existingStatus = String(existingPackage.status || "").trim();
      if (["pending_flashcat_launch", "launched"].includes(existingStatus)) {
        throw new Error(`workflow task launch package cannot be overwritten after Cat Brain review or launch: ${draftId} status=${existingStatus}`);
      }
    }
    const packageDir = path.join(paths.artifactsDir, "task-launch", cleanFileSegment(draft.spec.workflowId));
    const initialPackage = buildTaskLaunchPackage(draft, { ...input, draftId });
    const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, draftId, initialPackage);
    const markdownPackage = { ...initialPackage, artifactRefs: { canonicalJson: jsonRelPath } };
    const mdRelPath = await writeTextArtifact(paths.root, packageDir, draftId, "md", renderTaskLaunchMarkdown(markdownPackage));
    const pkg = { ...initialPackage, artifactRefs: { canonicalJson: jsonRelPath, markdown: mdRelPath } };
    await writeJsonArtifact(paths.root, packageDir, draftId, pkg);
    const hash = jsonHash(pkg);
    const updatedAt = nowIso();
    await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${draftId}.json`)}, ${sqlValue(pkg.workflowId)}, 'workflow_task_launch_package_json', ${sqlValue(jsonRelPath)}, ${sqlValue(pkg.subject || pkg.objective || "")}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(`${draftId}.md`)}, ${sqlValue(pkg.workflowId)}, 'workflow_task_launch_package_markdown', ${sqlValue(mdRelPath)}, ${sqlValue(pkg.subject || pkg.objective || "")}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES (${sqlValue(draftId)}, 'workflow_task_launch_package', ${sqlValue(pkg.status)}, NULL, ${sqlValue(pkg.intent.sourceSystem)}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.workflowId)}, ${sqlValue(jsonRelPath)}, ${sqlValue(JSON.stringify(pkg))}, ${sqlValue(hash)}, ${sqlValue(pkg.createdAt)}, ${sqlValue(updatedAt)})
ON CONFLICT(object_id) DO UPDATE SET
  status=excluded.status,
  source_system=excluded.source_system,
  source_agent=excluded.source_agent,
  parent_object_id=excluded.parent_object_id,
  path=excluded.path,
  payload_json=excluded.payload_json,
  hash=excluded.hash,
  updated_at=excluded.updated_at;
INSERT INTO review_gates(gate_id, workflow_id, gate_type, status, summary, reviewer_agent, human_gate_required, resume_pointer, evidence_paths_json, created_by, created_at, updated_at)
VALUES (${sqlValue(`gate.${draftId}.cat_brain_review`)}, ${sqlValue(pkg.workflowId)}, 'task_launch_cat_brain_review', 'pending', ${sqlValue(`猫之脑复核 task launch package: ${pkg.subject || pkg.workflowId}`)}, ${sqlValue(pkg.roles.reviewerAgent)}, ${sqlValue(pkg.governance?.humanGateRequired ? 1 : 0)}, ${sqlValue(draftId)}, ${sqlValue(JSON.stringify([jsonRelPath, mdRelPath]))}, ${sqlValue(pkg.roles.drafterAgent)}, ${sqlValue(pkg.createdAt)}, ${sqlValue(updatedAt)})
ON CONFLICT(gate_id) DO UPDATE SET status=excluded.status, summary=excluded.summary, reviewer_agent=excluded.reviewer_agent, human_gate_required=excluded.human_gate_required, resume_pointer=excluded.resume_pointer, evidence_paths_json=excluded.evidence_paths_json, updated_at=excluded.updated_at;`);
    await appendWorkflowEvent(paths, {
      eventType: "workflow.task_launch.prepared",
      status: "pending_cat_brain_review",
      workflowId: pkg.workflowId,
      traceId: pkg.traceId,
      actor: pkg.roles.drafterAgent,
      sourceRuntime: "workflow",
      sourceAgent: pkg.roles.drafterAgent,
      idempotencyKey: `task_launch_prepare:${draftId}`,
      artifactRef: jsonRelPath,
      payload: { draftId, markdown: mdRelPath, reviewerAgent: pkg.roles.reviewerAgent, finalApprover: pkg.roles.finalApprover },
      createdAt: updatedAt
    });
    return {
      operation: "workflow.task.launch.prepare",
      mutated: true,
      draftId,
      status: pkg.status,
      workflowId: pkg.workflowId,
      traceId: pkg.traceId,
      package: pkg,
      artifacts: { canonicalJson: jsonRelPath, markdown: mdRelPath },
      reviewGateId: `gate.${draftId}.cat_brain_review`,
      dbFile: paths.dbFile,
      warnings: draft.warnings || []
    };
  }

  async function workflowTaskLaunchList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const filters = ["object_type='workflow_task_launch_package'"];
    if (input.workflowId || input.workflow_id) filters.push(`parent_object_id=${sqlValue(input.workflowId || input.workflow_id)}`);
    if (input.status) filters.push(`status=${sqlValue(input.status)}`);
    const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
    const rows = await sqlite(paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at
FROM protocol_objects
WHERE ${filters.join(" AND ")}
ORDER BY updated_at DESC
LIMIT ${limit};`, { json: true });
    return {
      count: rows.length,
      taskLaunches: rows.map((row) => {
        const payload = parseJsonValue(row.payload_json, {});
        return {
          draftId: row.object_id,
          status: row.status,
          workflowId: row.parent_object_id || payload.workflowId || "",
          subject: payload.subject || "",
          objective: payload.objective || "",
          sourceAgent: row.source_agent || "",
          path: row.path || "",
          artifacts: payload.artifactRefs || {},
          roles: payload.roles || {},
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          payload: redactSensitiveForPersistence(payload)
        };
      }),
      dbFile: paths.dbFile
    };
  }

  async function workflowTaskLaunchReview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const draftId = String(input.draftId || input.draft_id || input.objectId || input.object_id || "").trim();
    if (!draftId) throw new Error("draftId is required");
    const reviewStatus = String(input.status || input.decision || "approved").trim();
    if (!["approved", "rejected", "revise_required"].includes(reviewStatus)) {
      throw new Error("task launch review status must be approved, rejected, or revise_required");
    }
    const reviewOpinion = String(input.reviewOpinion || input.review_opinion || input.opinion || input.text || input.summary || "").trim();
    if (!reviewOpinion) throw new Error("Cat Brain review opinion is required");
    const reviewerAgent = normalizeAgentId(input.reviewerAgent || input.reviewer_agent || input.actor || "main");
    const row = await readProtocolObject(paths, draftId);
    if (!row || row.object_type !== "workflow_task_launch_package") throw new Error(`workflow task launch package not found: ${draftId}`);
    const pkg = row.payload || {};
    if (row.status !== "pending_cat_brain_review") {
      throw new Error(`workflow task launch package review must start from pending_cat_brain_review: ${draftId} status=${row.status}`);
    }
    if (reviewerAgent !== (pkg.roles?.reviewerAgent || "main")) {
      throw new Error(`task launch review must be performed by package reviewer ${pkg.roles?.reviewerAgent || "main"}`);
    }
    const caller = workflowPermissionCaller(input);
    if (caller.agentId && caller.agentId !== reviewerAgent && !isWorkflowTrustedOperator(caller)) {
      throw new Error(`task launch review caller ${caller.agentId} cannot impersonate reviewer ${reviewerAgent}`);
    }
    const reviewedAt = nowIso();
    const nextStatus = reviewStatus === "approved" ? "pending_flashcat_launch" : reviewStatus;
    const nextPackage = {
      ...pkg,
      status: nextStatus,
      catBrainReview: {
        status: reviewStatus,
        reviewerAgent,
        reviewOpinion,
        reviewedAt
      }
    };
    const packageDir = path.join(paths.artifactsDir, "task-launch", cleanFileSegment(pkg.workflowId || draftId));
    const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, draftId, nextPackage);
    await writeTextArtifact(paths.root, packageDir, draftId, "md", renderTaskLaunchMarkdown(nextPackage));
    const hash = jsonHash(nextPackage);
    await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status=${sqlValue(nextStatus)},
    path=${sqlValue(jsonRelPath)},
    payload_json=${sqlValue(JSON.stringify(nextPackage))},
    hash=${sqlValue(hash)},
    updated_at=${sqlValue(reviewedAt)}
WHERE object_id=${sqlValue(draftId)} AND object_type='workflow_task_launch_package';
UPDATE review_gates
SET status=${sqlValue(reviewStatus === "revise_required" ? "rejected" : reviewStatus)},
    summary=${sqlValue(reviewOpinion)},
    decision_at=${sqlValue(reviewedAt)},
    approver=${sqlValue(reviewerAgent)},
    updated_at=${sqlValue(reviewedAt)}
WHERE resume_pointer=${sqlValue(draftId)} AND gate_type='task_launch_cat_brain_review';`);
    await appendWorkflowEvent(paths, {
      eventType: "workflow.task_launch.reviewed",
      status: nextStatus,
      workflowId: pkg.workflowId,
      traceId: pkg.traceId,
      actor: reviewerAgent,
      sourceRuntime: "workflow",
      sourceAgent: reviewerAgent,
      idempotencyKey: `task_launch_review:${draftId}:${reviewStatus}`,
      artifactRef: jsonRelPath,
      payload: { draftId, reviewStatus, reviewOpinion },
      createdAt: reviewedAt
    });
    return {
      operation: "workflow.task.launch.review",
      mutated: true,
      draftId,
      status: nextStatus,
      reviewStatus,
      workflowId: pkg.workflowId,
      artifactRef: jsonRelPath,
      dbFile: paths.dbFile
    };
  }

  async function workflowTaskLaunchApprove(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const draftId = String(input.draftId || input.draft_id || input.objectId || input.object_id || "").trim();
    if (!draftId) throw new Error("draftId is required");
    const feedbackText = String(input.feedbackText || input.feedback_text || input.flashcatOriginalWords || input.flashcat_original_words || input.originalWords || input.original_words || "").trim();
    if (!feedbackText) throw new Error("Flashcat original words / feedbackText is required before task launch approval");
    const row = await readProtocolObject(paths, draftId);
    if (!row || row.object_type !== "workflow_task_launch_package") throw new Error(`workflow task launch package not found: ${draftId}`);
    const pkg = row.payload || {};
    if (row.status !== "pending_flashcat_launch") {
      throw new Error(`workflow task launch package must pass Cat Brain review before Flashcat launch approval: ${draftId} status=${row.status}`);
    }
    const approvedAt = nowIso();
    const approvedBy = String(input.approvedBy || input.approved_by || input.actor || "flashcat").trim();
    const caller = workflowPermissionCaller(input);
    const trustedCaller = isWorkflowTrustedOperator({ ...caller, sourceSystem: "" });
    const approveSourceAllowed = approvedBy === "flashcat"
      && (!caller.agentId
        || caller.agentId === "flashcat"
        || trustedCaller);
    if (!approveSourceAllowed) {
      throw new Error("task launch approval must come from Flashcat Human Gate, governed GUI, or trusted local control plane");
    }
    const materializedTasks = [];
    const launchWorkflowPayload = {
      taskLaunchPackageId: draftId,
      taskLaunchArtifacts: pkg.artifactRefs || {},
      flashcatOriginalWords: feedbackText,
      approvedAt,
      approvedBy
    };
    const persistedLaunchWorkflowPayload = {
      ...launchWorkflowPayload,
      flashLane: false,
      tradingExecution: false
    };
    const restoreLaunchWorkflowRow = async () => sqlite(paths.dbFile, `
UPDATE workflow_runs
SET workflow_type=${sqlValue(pkg.taskType || "initiative")},
    status='active',
    owner_agent=${sqlValue(pkg.roles?.supervisorAgent || "main")},
    summary=${sqlValue(pkg.subject || pkg.objective || "")},
    objective=${sqlValue(pkg.objective || "")},
    current_phase='launched',
    payload_json=${sqlValue(JSON.stringify(persistedLaunchWorkflowPayload))},
    updated_at=${sqlValue(approvedAt)}
WHERE workflow_id=${sqlValue(pkg.workflowId)};`);
    await workflowRunUpsert(rootDir, {
      workflowId: pkg.workflowId,
      workflowType: pkg.taskType || "initiative",
      status: "active",
      ownerAgent: pkg.roles?.supervisorAgent || "main",
      summary: pkg.subject || pkg.objective || "",
      objective: pkg.objective || "",
      currentPhase: "launched",
      payload: launchWorkflowPayload
    });
    try {
      for (const task of pkg.launchMaterialization?.tasks || []) {
        const existing = await sqlite(paths.dbFile, `SELECT task_id FROM workflow_tasks WHERE task_id=${sqlValue(task.taskId)} LIMIT 1;`, { json: true });
        if (existing[0]) {
          materializedTasks.push({ taskId: task.taskId, status: "already_exists" });
          continue;
        }
        const created = await workflowTaskCreate(rootDir, {
          ...task,
          createdBy: approvedBy,
          payload: {
            ...(task.payload || {}),
            taskLaunchPackageId: draftId,
            taskLaunchArtifacts: pkg.artifactRefs || {},
            flashcatOriginalWords: feedbackText,
            approvedAt,
            approvedBy
          }
        });
        materializedTasks.push({ taskId: created.taskId, status: "created", ownerAgent: created.ownerAgent, runtime: created.runtime });
      }
      const materializedPhases = await syncWorkflowPhasesFromPlanSpec(paths, pkg, approvedAt);
      const nextPackage = {
        ...pkg,
        status: "launched",
        approvedAt,
        approvedBy,
        materializedPhases,
        flashcatOriginalWords: feedbackText,
        materializedTasks
      };
      const packageDir = path.join(paths.artifactsDir, "task-launch", cleanFileSegment(pkg.workflowId || draftId));
      const jsonRelPath = await writeJsonArtifact(paths.root, packageDir, draftId, nextPackage);
      await writeTextArtifact(paths.root, packageDir, draftId, "md", renderTaskLaunchMarkdown(nextPackage));
      const hash = jsonHash(nextPackage);
      await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status='launched',
    path=${sqlValue(jsonRelPath)},
    payload_json=${sqlValue(JSON.stringify(nextPackage))},
    hash=${sqlValue(hash)},
    updated_at=${sqlValue(approvedAt)}
WHERE object_id=${sqlValue(draftId)} AND object_type='workflow_task_launch_package';
UPDATE review_gates
SET updated_at=${sqlValue(approvedAt)}
WHERE resume_pointer=${sqlValue(draftId)} AND gate_type='task_launch_cat_brain_review';`);
      await appendWorkflowEvent(paths, {
        eventType: "workflow.task_launch.launched",
        status: "launched",
        workflowId: pkg.workflowId,
        traceId: pkg.traceId,
        actor: approvedBy,
        sourceRuntime: "workflow",
        sourceAgent: approvedBy,
        idempotencyKey: `task_launch_approve:${draftId}`,
        artifactRef: jsonRelPath,
        payload: { draftId, materializedPhases, materializedTasks, flashcatOriginalWords: feedbackText },
        createdAt: approvedAt
      });
      return {
        operation: "workflow.task.launch.approve",
        mutated: true,
        draftId,
        status: "launched",
        workflowId: pkg.workflowId,
        materializedPhases,
        materializedTasks,
        artifactRef: jsonRelPath,
        dbFile: paths.dbFile
      };
    } finally {
      await restoreLaunchWorkflowRow();
    }
  }

  return {
    workflowTaskLaunchPrepare,
    workflowTaskLaunchList,
    workflowTaskLaunchReview,
    workflowTaskLaunchApprove
  };
}
