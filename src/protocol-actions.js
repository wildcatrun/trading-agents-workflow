import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const PROTOCOL_ACTION_HANDLER_NAMES = {
  "protocol.record": "protocolRecord",
  "protocol.object": "protocolRecord"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`protocol action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`protocol action dependency missing: ${name}`);
  return context[name];
}

export function createProtocolActionRegistry(handlers = {}) {
  const entries = Object.entries(PROTOCOL_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing protocol action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runProtocolAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createProtocolActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const jsonHash = requireContextFunction(context, "jsonHash");
  const nowIso = requireContextFunction(context, "nowIso");
  const parseJsonValue = requireContextFunction(context, "parseJsonValue");
  const redactSensitiveForPersistence = requireContextFunction(context, "redactSensitiveForPersistence");
  const safeId = requireContextFunction(context, "safeId");
  const upsertInstrumentRecord = requireContextFunction(context, "upsertInstrumentRecord");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const INTERNAL_HUMAN_GATE_RECORD = requireContextValue(context, "INTERNAL_HUMAN_GATE_RECORD");
  const PROTOCOL_OBJECT_TYPES = requireContextValue(context, "PROTOCOL_OBJECT_TYPES");

  async function protocolRecord(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    let instrument = null;
    if (input.symbol || input.instrumentId || input.instrument_id) instrument = await upsertInstrumentRecord(paths, input);
    const objectTypeRaw = String(input.objectType || input.object_type || "generic").trim();
    const objectType = PROTOCOL_OBJECT_TYPES.has(objectTypeRaw) ? objectTypeRaw : "generic";
    const objectId = input.objectId || input.object_id || safeId(objectType.replace(/_/g, "-"));
    const status = String(input.status || "recorded").trim();
    if (objectType === "human_gate_record" && input[INTERNAL_HUMAN_GATE_RECORD] !== true) {
      throw new Error("human_gate_record writes are button-first only; use human_gate.request to create pending gates and human_gate.button_callback or human_gate.feedback to close them");
    }
    const sourceSystem = String(input.sourceSystem || input.source_system || input.source || "openclaw").trim();
    const sourceAgent = String(input.sourceAgent || input.source_agent || input.createdBy || input.from || "cat_claw").trim();
    const payload = {
      objectId,
      objectType,
      status,
      instrumentId: instrument?.instrumentId || input.instrumentId || input.instrument_id || null,
      sourceSystem,
      sourceAgent,
      summary: input.summary || input.text || "",
      payload: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {})),
      createdAt: input.createdAt || input.created_at || nowIso()
    };
    const hash = jsonHash(payload);
    const relPath = await writeJsonArtifact(paths.root, path.join(paths.protocolDir, objectType), objectId, { ...payload, hash });
    await sqlite(paths.dbFile, `
INSERT INTO protocol_objects(object_id, object_type, status, instrument_id, source_system, source_agent, parent_object_id, path, payload_json, hash, created_at, updated_at)
VALUES (${sqlValue(objectId)}, ${sqlValue(objectType)}, ${sqlValue(status)}, ${sqlValue(instrument?.instrumentId || input.instrumentId || input.instrument_id || null)}, ${sqlValue(sourceSystem)}, ${sqlValue(sourceAgent)}, ${sqlValue(input.parentObjectId || input.parent_object_id || "")}, ${sqlValue(relPath)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(hash)}, ${sqlValue(payload.createdAt)}, ${sqlValue(nowIso())})
ON CONFLICT(object_id) DO UPDATE SET
  object_type=excluded.object_type,
  status=excluded.status,
  instrument_id=excluded.instrument_id,
  source_system=excluded.source_system,
  source_agent=excluded.source_agent,
  parent_object_id=excluded.parent_object_id,
  path=excluded.path,
  payload_json=excluded.payload_json,
  hash=excluded.hash,
  updated_at=excluded.updated_at;`);
    return { objectId, objectType, status, instrumentId: instrument?.instrumentId || null, path: path.join(paths.root, relPath), relativePath: relPath, hash, dbFile: paths.dbFile };
  }

  return {
    protocolRecord
  };
}
