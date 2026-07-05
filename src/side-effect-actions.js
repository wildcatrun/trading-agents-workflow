import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const SIDE_EFFECT_ACTION_HANDLER_NAMES = {
  "side_effect.record": "sideEffectRecord",
  "side_effect.ledger": "sideEffectRecord"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`side_effect action dependency missing: ${name}`);
  return value;
}

export function createSideEffectActionRegistry(handlers = {}) {
  const entries = Object.entries(SIDE_EFFECT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing side_effect action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runSideEffectAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createSideEffectActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const jsonHash = requireContextFunction(context, "jsonHash");
  const nowIso = requireContextFunction(context, "nowIso");
  const parseJsonValue = requireContextFunction(context, "parseJsonValue");
  const redactSensitiveForPersistence = requireContextFunction(context, "redactSensitiveForPersistence");
  const safeId = requireContextFunction(context, "safeId");

  async function sideEffectRecord(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const sideEffectId = input.sideEffectId || input.side_effect_id || safeId("side_effect");
    const createdAt = nowIso();
    const payload = redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}));
    const status = String(input.status || "planned").trim();
    const sideEffectType = String(input.sideEffectType || input.side_effect_type || input.type || "generic").trim();
    await sqlite(paths.dbFile, `
INSERT INTO side_effect_ledger(side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, input_hash, output_hash, artifact_ref, payload_json, created_at, updated_at)
VALUES (${sqlValue(sideEffectId)}, ${sqlValue(input.traceId || input.trace_id || "")}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.dispatchId || input.dispatch_id || "")}, ${sqlValue(input.idempotencyKey || input.idempotency_key || "")}, ${sqlValue(input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "")}, ${sqlValue(sideEffectType)}, ${sqlValue(status)}, ${sqlValue(input.inputHash || input.input_hash || jsonHash(payload))}, ${sqlValue(input.outputHash || input.output_hash || "")}, ${sqlValue(input.artifactRef || input.artifact_ref || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(side_effect_id) DO UPDATE SET
  status=excluded.status,
  output_hash=CASE WHEN excluded.output_hash != '' THEN excluded.output_hash ELSE side_effect_ledger.output_hash END,
  artifact_ref=CASE WHEN excluded.artifact_ref != '' THEN excluded.artifact_ref ELSE side_effect_ledger.artifact_ref END,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
    await appendWorkflowEvent(paths, {
      eventType: "side_effect.recorded",
      status,
      workflowId: input.workflowId || input.workflow_id || "",
      traceId: input.traceId || input.trace_id || "",
      dispatchId: input.dispatchId || input.dispatch_id || "",
      sideEffectId,
      actor: input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "workflow",
      sourceRuntime: "workflow",
      sourceAgent: input.ownerAgent || input.owner_agent || input.agentId || input.agent_id || "",
      nextState: status,
      artifactRef: input.artifactRef || input.artifact_ref || "",
      payload: { sideEffectType, inputHash: input.inputHash || input.input_hash || jsonHash(payload), outputHash: input.outputHash || input.output_hash || "" },
      createdAt
    });
    return { sideEffectId, sideEffectType, status, dbFile: paths.dbFile };
  }

  return {
    sideEffectRecord
  };
}
