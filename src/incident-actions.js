import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const INCIDENT_ACTION_HANDLER_NAMES = {
  "incident.state": "incidentState",
  "workflow.incident": "incidentState",
  "workflow.incident.from_dead_letter.preview": "workflowIncidentFromDeadLetterPreview",
  "workflow.incident.from_dead_letter": "workflowIncidentFromDeadLetter"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`incident action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`incident action dependency missing: ${name}`);
  return context[name];
}

export function createIncidentActionRegistry(handlers = {}) {
  const entries = Object.entries(INCIDENT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing incident action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runIncidentAction(registry, action, rootDir, input = {}, permissionDecision = null) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input, permissionDecision) };
}

export function createIncidentActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const parseJsonValue = requireContextFunction(context, "parseJsonValue");
  const redactSensitiveForPersistence = requireContextFunction(context, "redactSensitiveForPersistence");
  const redactSensitiveTextForPersistence = requireContextFunction(context, "redactSensitiveTextForPersistence");
  const renderIncidentMarkdown = requireContextFunction(context, "renderIncidentMarkdown");
  const safeId = requireContextFunction(context, "safeId");
  const textHash = requireContextFunction(context, "textHash");
  const toList = requireContextFunction(context, "toList");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");
  const WorkflowReadModel = requireContextFunction(context, "WorkflowReadModel");
  const INCIDENT_MODES = requireContextValue(context, "INCIDENT_MODES");
  const INCIDENT_STATUSES = requireContextValue(context, "INCIDENT_STATUSES");

  async function incidentState(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const incidentId = input.incidentId || input.incident_id || safeId("incident");
    const createdAt = nowIso();
    const existingRows = await sqlite(paths.dbFile, `SELECT status FROM incident_states WHERE incident_id=${sqlValue(incidentId)} LIMIT 1;`, { json: true });
    const previousStatus = existingRows[0]?.status || "";
    const statusRaw = String(input.status || "active").trim();
    const status = INCIDENT_STATUSES.has(statusRaw) ? statusRaw : "active";
    const modeRaw = String(input.mode || (status === "resolved" ? "normal" : "degraded")).trim();
    const mode = INCIDENT_MODES.has(modeRaw) ? modeRaw : "degraded";
    const timeline = toList(input.timeline).length ? toList(input.timeline) : [`${createdAt} ${input.summary || input.text || "incident state recorded"}`];
    const payload = parseJsonValue(input.payload, input.payload || {});
    const record = {
      incidentId,
      status,
      mode,
      affectedPlanes: toList(input.affectedPlanes || input.affected_planes),
      summary: input.summary || input.text || "",
      commander: input.commander || input.actor || "flashcat",
      impact: input.impact || "",
      currentHypothesis: input.currentHypothesis || input.current_hypothesis || "",
      mitigation: input.mitigation || "",
      rollbackOptions: input.rollbackOptions || input.rollback_options || "",
      exitCriteria: input.exitCriteria || input.exit_criteria || "",
      timeline,
      declaredAt: input.declaredAt || input.declared_at || createdAt,
      nextUpdateAt: input.nextUpdateAt || input.next_update_at || "",
      payload,
      updatedAt: createdAt
    };
    const jsonRelPath = await writeJsonArtifact(paths.root, path.join(paths.bridgeDir, "incidents"), incidentId, record);
    const markdownRelPath = await writeTextArtifact(paths.root, path.join(paths.bridgeDir, "incidents"), incidentId, "md", renderIncidentMarkdown(record));
    await sqlite(paths.dbFile, `
INSERT INTO incident_states(incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at)
VALUES (${sqlValue(incidentId)}, ${sqlValue(status)}, ${sqlValue(mode)}, ${sqlValue(JSON.stringify(record.affectedPlanes))}, ${sqlValue(record.summary)}, ${sqlValue(record.commander)}, ${sqlValue(record.impact)}, ${sqlValue(record.currentHypothesis)}, ${sqlValue(record.mitigation)}, ${sqlValue(record.rollbackOptions)}, ${sqlValue(record.exitCriteria)}, ${sqlValue(JSON.stringify(timeline))}, ${sqlValue(JSON.stringify({ ...payload, jsonRelPath, markdownRelPath }))}, ${sqlValue(record.declaredAt)}, ${sqlValue(record.nextUpdateAt)}, ${sqlValue(status === "resolved" ? createdAt : "")}, ${sqlValue(createdAt)})
ON CONFLICT(incident_id) DO UPDATE SET
  status=excluded.status,
  mode=excluded.mode,
  affected_planes_json=excluded.affected_planes_json,
  summary=excluded.summary,
  commander=excluded.commander,
  impact=excluded.impact,
  current_hypothesis=excluded.current_hypothesis,
  mitigation=excluded.mitigation,
  rollback_options=excluded.rollback_options,
  exit_criteria=excluded.exit_criteria,
  timeline_json=excluded.timeline_json,
  payload_json=excluded.payload_json,
  next_update_at=excluded.next_update_at,
  resolved_at=excluded.resolved_at,
  updated_at=excluded.updated_at;`);
    await appendWorkflowEvent(paths, {
      eventType: previousStatus ? (status === "resolved" ? "incident.resolved" : "incident.updated") : "incident.created",
      status,
      workflowId: input.workflowId || input.workflow_id || "",
      traceId: input.traceId || input.trace_id || "",
      incidentId,
      actor: record.commander,
      sourceRuntime: "workflow",
      sourceAgent: record.commander,
      previousState: previousStatus,
      nextState: status,
      artifactRef: markdownRelPath,
      payload: {
        mode,
        summary: record.summary,
        affectedPlanes: record.affectedPlanes,
        jsonRelPath,
        markdownRelPath
      },
      createdAt
    });
    return { incidentId, status, mode, relativePath: markdownRelPath, jsonRelativePath: jsonRelPath, markdownRelativePath: markdownRelPath, dbFile: paths.dbFile };
  }

  function deadLetterIncidentInput(input = {}) {
    return {
      workflowId: String(input.workflowId || input.workflow_id || "").trim(),
      kind: String(input.kind || input.deadLetterKind || input.dead_letter_kind || "").trim(),
      refId: String(input.refId || input.ref_id || input.deadLetterRefId || input.dead_letter_ref_id || "").trim(),
      incidentId: String(input.incidentId || input.incident_id || "").trim()
    };
  }

  function deterministicDeadLetterIncidentId({ workflowId, kind, refId }) {
    const digest = textHash(`${workflowId || "-"}:${kind || "-"}:${refId || "-"}`).slice(0, 16);
    return `incident.dead_letter.${digest}`;
  }

  function deadLetterIncidentMode(candidate = {}) {
    const mode = String(candidate.suggestedMode || "").trim();
    return INCIDENT_MODES.has(mode) ? mode : "degraded";
  }

  function deadLetterIncidentStatus(candidate = {}) {
    if (candidate.severity === "warning") return "monitoring";
    const status = String(candidate.suggestedStatus || "").trim();
    if (INCIDENT_STATUSES.has(status)) return status;
    return "active";
  }

  function deadLetterIncidentSummary(candidate = {}, input = {}) {
    return String(input.summary || candidate.summary || `${candidate.kind || "dead_letter"} ${candidate.refId || ""}`).trim();
  }

  async function workflowIncidentFromDeadLetterPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const deadLetter = deadLetterIncidentInput(input);
    if (!deadLetter.workflowId) throw new Error("workflowId is required");
    if (!deadLetter.kind) throw new Error("kind is required");
    if (!deadLetter.refId) throw new Error("refId is required");
    const generatedAt = nowIso();
    const readModel = new WorkflowReadModel({ dbFile: paths.dbFile });
    const evidence = await readModel.deadLetterEvidence({
      workflowId: deadLetter.workflowId,
      kind: deadLetter.kind,
      refId: deadLetter.refId,
      messageFlowStuckMinutes: input.messageFlowStuckMinutes || input.message_flow_stuck_minutes
    });
    const candidate = evidence.incidentCandidate || null;
    const incidentId = deadLetter.incidentId || deterministicDeadLetterIncidentId(deadLetter);
    const violations = [];
    if (!evidence.found || !candidate) {
      violations.push({ code: "dead_letter_not_found", detail: "selected row no longer matches the current dead-letter predicate" });
    }
    if (candidate && candidate.writeMode !== "read_only_preview") {
      violations.push({ code: "candidate_write_mode_invalid", detail: `expected read_only_preview, got ${candidate.writeMode || "<empty>"}` });
    }
    return {
      schemaVersion: "workflow_dead_letter_incident_preview.v1",
      action: "workflow.incident.from_dead_letter.preview",
      preview: true,
      readOnly: true,
      eligible: violations.length === 0,
      generatedAt,
      workflowId: deadLetter.workflowId,
      kind: deadLetter.kind,
      refId: deadLetter.refId,
      incidentId,
      riskTier: "P2-medium",
      humanGateRequired: true,
      catClawAuditRequired: true,
      deadLetterEvidence: evidence,
      incidentCandidate: candidate,
      wouldWriteIncident: candidate ? {
        incidentId,
        status: deadLetterIncidentStatus(candidate),
        mode: deadLetterIncidentMode(candidate),
        affectedPlanes: candidate.affectedPlanes || [],
        summary: deadLetterIncidentSummary(candidate, input),
        payloadKeys: ["deadLetter", "incidentCandidate", "evidenceRefs", "humanGateId", "catClawAuditId", "operatorReason"]
      } : null,
      wouldCreateHumanGateRequest: false,
      wouldRetryOrRepair: false,
      wouldMutate: {
        incidentStates: violations.length === 0 ? 1 : 0,
        workflowEvents: violations.length === 0 ? 1 : 0,
        workflowRuns: 0,
        dispatches: 0,
        runtimeRuns: 0,
        outbox: 0,
        humanGateButtons: 0,
        sideEffects: 0
      },
      requiredEvidence: [
        "humanGateId or Flashcat original words",
        "catClawAuditId or secretaryAuditId",
        "operatorReason",
        "current workflow_dead_letter_evidence.v1 match"
      ],
      violations,
      limitations: [
        "Preview is read-only and does not persist incident state.",
        "Execution creates or updates only incident state/artifacts and the incident workflow event.",
        "Execution does not retry jobs, clear leases, resend Telegram, resume Human Gate, mutate side effects, or change workflow status."
      ],
      dbFile: paths.dbFile
    };
  }

  async function workflowIncidentFromDeadLetter(rootDir, input = {}, permissionDecision = null) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const preview = await workflowIncidentFromDeadLetterPreview(rootDir, input);
    if (!preview.eligible) {
      throw new Error(`dead-letter incident is not eligible: ${preview.violations.map((item) => item.code).join(",") || "unknown"}`);
    }
    const reason = String(input.operatorReason || input.operator_reason || input.reason || "").trim();
    if (!reason) throw new Error("operatorReason is required for dead-letter incident creation");
    const redactedReason = redactSensitiveTextForPersistence(reason);
    const candidate = preview.incidentCandidate;
    const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
    const catClawAuditId = String(input.catClawAuditId || input.cat_claw_audit_id || input.secretaryAuditId || input.secretary_audit_id || "").trim();
    const record = await incidentState(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      incidentId: preview.incidentId,
      workflowId: preview.workflowId,
      status: deadLetterIncidentStatus(candidate),
      mode: deadLetterIncidentMode(candidate),
      affectedPlanes: candidate.affectedPlanes || [],
      summary: deadLetterIncidentSummary(candidate, input),
      commander: input.commander || input.actor || permissionDecision?.caller?.agentId || "cat_claw",
      impact: input.impact || `Dead-letter item requires governed incident tracking: ${preview.kind}/${preview.refId}`,
      currentHypothesis: input.currentHypothesis || input.current_hypothesis || "Dead-letter/stuck attention row remains current at incident creation time.",
      mitigation: input.mitigation || "No automatic repair performed. Track evidence, ownership, and governed next action.",
      rollbackOptions: input.rollbackOptions || input.rollback_options || candidate.rollbackBoundary || "",
      exitCriteria: input.exitCriteria || input.exit_criteria || (candidate.exitCriteria || []).join("\n"),
      timeline: [
        `${preview.generatedAt} dead-letter incident linked from ${preview.kind}/${preview.refId}`,
        `${nowIso()} operator reason recorded: ${redactedReason}`
      ],
      payload: redactSensitiveForPersistence({
        schemaVersion: "workflow_dead_letter_incident_link.v1",
        deadLetter: {
          workflowId: preview.workflowId,
          kind: preview.kind,
          refId: preview.refId
        },
        incidentCandidate: candidate,
        deadLetterEvidence: preview.deadLetterEvidence,
        evidenceRefs: candidate.evidenceRefs || [],
        humanGateId,
        catClawAuditId,
        operatorReason: redactedReason,
        permissionPolicyOutcome: permissionDecision?.policyOutcome || "",
        createdByAction: "workflow.incident.from_dead_letter"
      })
    });
    return {
      ...record,
      schemaVersion: "workflow_dead_letter_incident_link_result.v1",
      action: "workflow.incident.from_dead_letter",
      workflowId: preview.workflowId,
      kind: preview.kind,
      refId: preview.refId,
      incidentCandidate: candidate,
      deadLetterEvidenceStatus: preview.deadLetterEvidence.status,
      writeBoundary: "incident_state_only",
      didRetryOrRepair: false
    };
  }

  return {
    incidentState,
    workflowIncidentFromDeadLetterPreview,
    workflowIncidentFromDeadLetter
  };
}
