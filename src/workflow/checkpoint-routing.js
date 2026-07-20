const CHECKPOINT_SOURCE_CLASS_ACTIONS = new Map([
  ["legacy_compat_checkpoint", "workflow.checkpoint.legacy_export"],
  ["legacy_checkpoint", "workflow.checkpoint.legacy_export"],
  ["legacy", "workflow.checkpoint.legacy_export"],
  ["v2_plan_checkpoint", "workflow.supervisor.checkpoint"],
  ["supervisor_checkpoint", "workflow.supervisor.checkpoint"],
  ["workflow_supervisor_checkpoint", "workflow.supervisor.checkpoint"],
  ["human_gate_archive_checkpoint", "workflow.archive.checkpoint"],
  ["archive_checkpoint", "workflow.archive.checkpoint"],
  ["workflow_archive_checkpoint", "workflow.archive.checkpoint"]
]);

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function listOption(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

export function checkpointSourceClass(value) {
  return firstText(value, "legacy_compat_checkpoint").replace(/-/g, "_");
}

export function checkpointActionForSourceClass(value) {
  const sourceClass = checkpointSourceClass(value);
  const action = CHECKPOINT_SOURCE_CLASS_ACTIONS.get(sourceClass);
  if (!action) {
    throw new Error(`unsupported workflow checkpoint source class: ${sourceClass}`);
  }
  return action;
}

export function workflowCheckpointCommandInput(options = {}) {
  const sourceClass = checkpointSourceClass(options.sourceClass ?? options["source-class"]);
  const action = checkpointActionForSourceClass(sourceClass);
  const workflowId = firstText(options.workflow, options.workflowId, options.workflow_id);
  const planId = firstText(options.plan, options.planId, options.plan_id, options["plan-id"]);
  const humanGateId = firstText(options.humanGate, options.humanGateId, options.human_gate_id, options["human-gate"], options["human-gate-id"]);
  const buttonId = firstText(options.button, options.buttonId, options.button_id, options["button-id"]);
  const decisionStatus = firstText(options.decisionStatus, options.decision_status, options["decision-status"]);
  if (!workflowId) throw new Error("workflow checkpoint requires --workflow");
  if (action === "workflow.supervisor.checkpoint" && !planId) {
    throw new Error("workflow checkpoint source-class v2_plan_checkpoint requires --plan");
  }
  if (action === "workflow.archive.checkpoint") {
    const missing = [];
    if (!planId) missing.push("--plan");
    if (!humanGateId) missing.push("--human-gate");
    if (!buttonId) missing.push("--button");
    if (missing.length) {
      throw new Error(`workflow checkpoint source-class human_gate_archive_checkpoint requires ${missing.join(", ")}`);
    }
  }
  return compactObject({
    action,
    sourceClass,
    workflowId,
    planId,
    humanGateId,
    buttonId,
    decisionStatus,
    checkpointId: options.checkpoint || options.checkpointId || options.checkpoint_id,
    summary: options.summary,
    nextActions: listOption(options.nextAction ?? options["next-action"]),
    tokenBudget: options.tokenBudget ?? options["token-budget"],
    compactAtPercent: options.compactAt ?? options["compact-at"] ?? options.compactAtPercent ?? options.compact_at_percent,
    restorePolicy: options.restorePolicy ?? options["restore-policy"],
    createdBy: options.createdBy ?? options["created-by"] ?? options.from
  });
}
