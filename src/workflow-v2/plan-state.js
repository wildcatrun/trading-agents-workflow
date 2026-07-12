import {
  fileExistsSync
} from "../workflow/paths.js";
import {
  firstText
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  sqliteChangeCount
} from "../workflow/sqlite.js";
import {
  WORKFLOW_V2_WORKFLOW_STATES
} from "./constants.js";
import {
  workflowV2JsonObject
} from "./helpers.js";

function nowIso() {
  return new Date().toISOString();
}

export async function workflowV2LoadPlanRow(paths, workflowId, planId) {
  if (!workflowId || !planId || !fileExistsSync(paths.dbFile)) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_plans
WHERE workflow_id=${sqlValue(workflowId)} AND plan_id=${sqlValue(planId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function workflowV2PatchPlanWorkflowState(paths, workflowId, planId, workflowState, timestamp = nowIso()) {
  if (!workflowId || !planId || !WORKFLOW_V2_WORKFLOW_STATES.has(workflowState)) return 0;
  return sqliteChangeCount(paths.dbFile, `
UPDATE workflow_v2_plans
SET workflow_state=${sqlValue(workflowState)},
    updated_at=${sqlValue(timestamp)}
WHERE workflow_id=${sqlValue(workflowId)}
  AND plan_id=${sqlValue(planId)};`);
}

export async function workflowV2PlanOrchestrationPattern(paths, workflowId = "", planId = "") {
  const row = await workflowV2LoadPlanRow(paths, workflowId, planId);
  const payload = workflowV2JsonObject(row?.payload_json, {});
  const orchestration = workflowV2JsonObject(payload.orchestration, {});
  return firstText(orchestration.pattern, payload.orchestrationPattern, payload.orchestration_pattern);
}
