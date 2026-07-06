import {
  boolOption,
  parseJsonValue,
  safeId
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const WORKFLOW_RUN_ACTION_HANDLER_NAMES = {
  "workflow.run.upsert": "workflowRunUpsert",
  "workflow.initiative.upsert": "workflowRunUpsert"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow run action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`workflow run action dependency missing: ${name}`);
  return context[name];
}

export function createWorkflowRunActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_RUN_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow run action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowRunAction(registry, action, rootDir, input = {}, permissionDecision = null) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input, permissionDecision) };
}

export function createWorkflowRunActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const WORKFLOW_RUN_STATUSES = requireContextValue(context, "WORKFLOW_RUN_STATUSES");

  async function workflowRunUpsert(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const createdAt = nowIso();
    const workflowId = String(input.workflowId || input.workflow_id || input.initiativeId || input.initiative_id || safeId("workflow")).trim();
    const existingRows = await sqlite(paths.dbFile, `SELECT status FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
    const previousStatus = existingRows[0]?.status || "";
    const statusRaw = String(input.status || "active").trim();
    const status = WORKFLOW_RUN_STATUSES.has(statusRaw) ? statusRaw : "active";
    const workflowType = String(input.workflowType || input.workflow_type || input.type || "initiative").trim();
    const payload = {
      ...parseJsonValue(input.payload, input.payload || {}),
      flashLane: boolOption(input.flashLane ?? input.flash_lane, false),
      tradingExecution: boolOption(input.tradingExecution ?? input.trading_execution, false)
    };
    await sqlite(paths.dbFile, `
INSERT INTO workflow_runs(workflow_id, workflow_type, status, instrument_id, owner_agent, summary, objective, acceptance_criteria, stop_condition, current_phase, current_decision, payload_json, created_at, updated_at)
VALUES (${sqlValue(workflowId)}, ${sqlValue(workflowType)}, ${sqlValue(status)}, ${sqlValue(input.instrumentId || input.instrument_id || null)}, ${sqlValue(input.ownerAgent || input.owner_agent || "main")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.objective || input.goal || "")}, ${sqlValue(input.acceptanceCriteria || input.acceptance_criteria || "")}, ${sqlValue(input.stopCondition || input.stop_condition || "")}, ${sqlValue(input.phase || input.currentPhase || input.current_phase || "")}, ${sqlValue(input.currentDecision || input.current_decision || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(workflow_id) DO UPDATE SET
  workflow_type=excluded.workflow_type,
  status=excluded.status,
  instrument_id=COALESCE(excluded.instrument_id, workflow_runs.instrument_id),
  owner_agent=excluded.owner_agent,
  summary=CASE WHEN excluded.summary != '' THEN excluded.summary ELSE workflow_runs.summary END,
  objective=CASE WHEN excluded.objective != '' THEN excluded.objective ELSE workflow_runs.objective END,
  acceptance_criteria=CASE WHEN excluded.acceptance_criteria != '' THEN excluded.acceptance_criteria ELSE workflow_runs.acceptance_criteria END,
  stop_condition=CASE WHEN excluded.stop_condition != '' THEN excluded.stop_condition ELSE workflow_runs.stop_condition END,
  current_phase=CASE WHEN excluded.current_phase != '' THEN excluded.current_phase ELSE workflow_runs.current_phase END,
  current_decision=CASE WHEN excluded.current_decision != '' THEN excluded.current_decision ELSE workflow_runs.current_decision END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
    await appendWorkflowEvent(paths, {
      eventType: previousStatus ? "workflow.updated" : "workflow.created",
      workflowId,
      actor: input.createdBy || input.created_by || input.from || input.ownerAgent || input.owner_agent || "main",
      previousState: previousStatus,
      nextState: status,
      sourceRuntime: "workflow",
      sourceAgent: input.ownerAgent || input.owner_agent || "main",
      payload: { workflowType, summary: input.summary || input.text || "", phase: input.phase || input.currentPhase || input.current_phase || "" },
      createdAt
    });
    return { workflowId, status, workflowType, dbFile: paths.dbFile };
  }

  return {
    workflowRunUpsert
  };
}
