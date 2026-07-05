import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const INCIDENT_ACTION_HANDLER_NAMES = {
  "incident.state": "incidentState",
  "workflow.incident": "incidentState"
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

export async function runIncidentAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createIncidentActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const parseJsonValue = requireContextFunction(context, "parseJsonValue");
  const renderIncidentMarkdown = requireContextFunction(context, "renderIncidentMarkdown");
  const safeId = requireContextFunction(context, "safeId");
  const toList = requireContextFunction(context, "toList");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");
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

  return {
    incidentState
  };
}
