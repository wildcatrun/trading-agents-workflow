export function kanbanPreviewActionModel(card = {}, action = "") {
  const workflowId = String(card.workflowId || "").trim();
  const outboxId = String(card.outboxId || (card.source === "telegram_outbox" ? card.sourceId : "") || "").trim();
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
  if (action === "telegram.outbox.requeue.preview") {
    return {
      action,
      label: "Preview Requeue",
      enabled: Boolean(outboxId),
      reason: outboxId ? "" : "outboxId is required",
      outboxId,
      payload: { outboxId }
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
