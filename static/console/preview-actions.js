export function kanbanPreviewActionModel(card = {}, action = "") {
  const workflowId = String(card.workflowId || "").trim();
  const outboxId = String(card.outboxId || (card.source === "telegram_outbox" ? card.sourceId : "") || "").trim();
  const incidentId = String(card.incidentId || (card.source === "incident_states" ? card.sourceId : "") || "").trim();
  const phaseKey = String(card.phaseKey || card.phase || "").trim();
  if (action === "workflow.supervise.preview") {
    return {
      action,
      label: "Preview Supervise",
      enabled: Boolean(workflowId),
      reason: workflowId ? "" : "workflowId is required",
      workflowId,
      payload: { workflowId }
    };
  }
  if (["workflow.advance.preview", "workflow.pause.preview", "workflow.resume.preview", "workflow.stop.preview"].includes(action)) {
    const labels = {
      "workflow.advance.preview": "Preview Advance",
      "workflow.pause.preview": "Preview Pause",
      "workflow.resume.preview": "Preview Resume",
      "workflow.stop.preview": "Preview Stop"
    };
    return {
      action,
      label: labels[action] || shortLabel(action),
      enabled: Boolean(workflowId),
      reason: workflowId ? "" : "workflowId is required",
      workflowId,
      payload: { workflowId }
    };
  }
  if (action === "workflow.rerun.agent.preview" || action === "workflow.rerun.dispatch.preview") {
    const dispatchId = String(card.dispatchId || "").trim();
    const runtimeRunId = String(card.runtimeRunId || "").trim();
    const agentId = String(card.agentId || "").trim();
    const hasTarget = Boolean(dispatchId || runtimeRunId || agentId);
    return {
      action: "workflow.rerun.agent.preview",
      label: dispatchId ? "Preview Rerun Dispatch" : "Preview Rerun Agent",
      enabled: Boolean(workflowId && hasTarget),
      reason: !workflowId ? "workflowId is required" : !hasTarget ? "dispatchId, runtimeRunId, or agentId is required" : "",
      workflowId,
      payload: { workflowId, dispatchId, runtimeRunId, agentId }
    };
  }
  if (action === "workflow.rerun.phase.preview") {
    return {
      action,
      label: "Preview Rerun Phase",
      enabled: Boolean(workflowId && phaseKey),
      reason: !workflowId ? "workflowId is required" : !phaseKey ? "phaseKey is required" : "",
      workflowId,
      payload: { workflowId, phaseKey }
    };
  }
  if (action === "telegram.outbox.delivery.preview") {
    return {
      action,
      label: "Preview Delivery",
      enabled: Boolean(outboxId),
      reason: outboxId ? "" : "outboxId is required",
      outboxId,
      payload: { outboxId }
    };
  }
  if (action === "telegram.outbox.requeue.preview" || action === "telegram.outbox.requeue.execution_package.preview") {
    return {
      action,
      label: action === "telegram.outbox.requeue.execution_package.preview" ? "Preview Requeue Package" : "Preview Requeue",
      enabled: Boolean(outboxId),
      reason: outboxId ? "" : "outboxId is required",
      outboxId,
      payload: { outboxId }
    };
  }
  if ([
    "workflow.incident.closeout.cat_claw_report.preview",
    "workflow.incident.closeout.human_gate_package.preview",
    "workflow.incident.closeout.worklist.preview",
    "workflow.incident.closeout.evidence.preview",
    "workflow.incident.closeout.artifact.preview",
    "workflow.incident.closeout.human_gate_request.preview"
  ].includes(action)) {
    const labels = {
      "workflow.incident.closeout.cat_claw_report.preview": "Preview Cat Claw",
      "workflow.incident.closeout.human_gate_package.preview": "Preview HGate",
      "workflow.incident.closeout.worklist.preview": "Preview Worklist",
      "workflow.incident.closeout.evidence.preview": "Preview Evidence",
      "workflow.incident.closeout.artifact.preview": "Preview Artifact",
      "workflow.incident.closeout.human_gate_request.preview": "Preview HGate Request"
    };
    return {
      action,
      label: labels[action] || shortLabel(action),
      enabled: Boolean(workflowId && (incidentId || action === "workflow.incident.closeout.worklist.preview")),
      reason: !workflowId ? "workflowId is required" : !incidentId && action !== "workflow.incident.closeout.worklist.preview" ? "incidentId is required" : "",
      workflowId,
      incidentId,
      payload: { workflowId, incidentId }
    };
  }
  return {
    action,
    label: shortLabel(action),
    enabled: false,
    reason: `No console preview handler is registered for ${action}`,
    payload: {}
  };
}

function shortLabel(value, limit = 34) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit - 1)}...` : text;
}
