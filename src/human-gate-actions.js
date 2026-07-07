import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";
import { parseJsonValue } from "./workflow/json.js";

export const HUMAN_GATE_ACTION_HANDLER_NAMES = {
  "human_gate.inbox": "humanGateInbox",
  "human_gate.console": "humanGateInbox",
  "human_gate.batch_inbox": "humanGateInbox",
  "human_gate.record": "workflowHumanGateRecord",
  "workflow.human_gate": "workflowHumanGateRecord"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`human_gate action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`human_gate action dependency missing: ${name}`);
  return context[name];
}

export function createHumanGateActionRegistry(handlers = {}) {
  const entries = Object.entries(HUMAN_GATE_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing human_gate action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runHumanGateAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createHumanGateActionHandlers(context = {}) {
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const collectHumanGateInboxItems = requireContextFunction(context, "collectHumanGateInboxItems");
  const dailyKey = requireContextFunction(context, "dailyKey");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const humanGateActionHint = requireContextFunction(context, "humanGateActionHint");
  const nowIso = requireContextFunction(context, "nowIso");
  const relativeTo = requireContextFunction(context, "relativeTo");
  const renderHumanGateInboxHtml = requireContextFunction(context, "renderHumanGateInboxHtml");
  const renderHumanGateTelegramSummary = requireContextFunction(context, "renderHumanGateTelegramSummary");
  const protocolRecord = requireContextFunction(context, "protocolRecord");
  const riskSummaryFor = requireContextFunction(context, "riskSummaryFor");
  const safeId = requireContextFunction(context, "safeId");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");
  const DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID = requireContextValue(context, "DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID");
  const HUMAN_GATE_STATUSES = requireContextValue(context, "HUMAN_GATE_STATUSES");

  async function workflowHumanGateRecord(rootDir, input = {}) {
    const statusRaw = String(input.status || "pending").trim();
    const status = HUMAN_GATE_STATUSES.has(statusRaw) ? statusRaw : "pending";
    return protocolRecord(rootDir, {
      ...input,
      objectType: "human_gate_record",
      objectId: input.humanGateId || input.human_gate_id || input.gateId || input.gate_id || input.objectId || input.object_id,
      parentObjectId: input.parentObjectId || input.parent_object_id || input.riskDecisionId || input.risk_decision_id || input.proposalId || input.proposal_id || "",
      status,
      sourceSystem: input.sourceSystem || input.source_system || "local_codex",
      sourceAgent: input.sourceAgent || input.source_agent || input.from || "flashcat",
      payload: {
        gateType: input.gateType || input.gate_type || "high_risk_trade_execution",
        humanGateStageKey: input.humanGateStageKey || input.human_gate_stage_key || input.stageKey || input.stage_key || "",
        stage: input.stage || input.phase || "",
        meetingId: input.meetingId || input.meeting_id || "",
        actor: input.actor || input.from || "flashcat",
        assurance: input.assurance || input.authAssurance || "",
        expiresAt: input.expiresAt || input.expires_at || "",
        decisionAt: ["approved", "rejected", "paused", "terminated", "expired"].includes(status) ? nowIso() : "",
        resumePointer: input.resumePointer || input.resume_pointer || input.dispatchId || input.dispatch_id || "",
        workflowId: input.workflowId || input.workflow_id || "",
        traceId: input.traceId || input.trace_id || "",
        summary: input.summary || input.text || "",
        raw: parseJsonValue(input.payload, input.payload || {})
      }
    });
  }

  async function humanGateInbox(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const createdAt = nowIso();
    const batchId = input.batchId || input.batch_id || safeId(`hgate-batch-${dailyKey()}`);
    const targetRef = String(input.target || input.targetRef || input.target_ref || DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID).trim();
    const title = String(input.title || `Human Gate Inbox ${dailyKey()}`).trim();
    const items = await collectHumanGateInboxItems(paths, input);
    const riskSummary = riskSummaryFor(items);
    const batch = {
      batchId,
      status: items.length ? "open" : "empty",
      title,
      targetRef,
      createdAt,
      riskSummary,
      items
    };
    const htmlPath = await writeTextArtifact(paths.root, paths.humanGateInboxDir, batchId, "html", renderHumanGateInboxHtml({ ...batch, htmlPath: "" }));
    batch.htmlPath = htmlPath;
    batch.telegramSummary = renderHumanGateTelegramSummary(batch);
    const jsonPath = relativeTo(paths.root, path.join(paths.humanGateInboxDir, `${cleanFileSegment(batchId)}.json`));
    batch.jsonPath = jsonPath;
    await writeJsonArtifact(paths.root, paths.humanGateInboxDir, batchId, batch);

    await sqlite(paths.dbFile, `
INSERT INTO human_gate_batches(batch_id, status, title, target_ref, risk_summary_json, default_action, html_path, json_path, telegram_summary, created_by, created_at, updated_at)
VALUES (${sqlValue(batchId)}, ${sqlValue(batch.status)}, ${sqlValue(title)}, ${sqlValue(targetRef)}, ${sqlValue(JSON.stringify(riskSummary))}, ${sqlValue(riskSummary.individual ? "review_p0_p1_first" : "batch_review_allowed")}, ${sqlValue(htmlPath)}, ${sqlValue(jsonPath)}, ${sqlValue(batch.telegramSummary)}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(batch_id) DO UPDATE SET
  status=excluded.status,
  title=excluded.title,
  target_ref=excluded.target_ref,
  risk_summary_json=excluded.risk_summary_json,
  default_action=excluded.default_action,
  html_path=excluded.html_path,
  json_path=excluded.json_path,
  telegram_summary=excluded.telegram_summary,
  updated_at=excluded.updated_at;`);
    await sqlite(paths.dbFile, `DELETE FROM human_gate_batch_items WHERE batch_id=${sqlValue(batchId)};`);
    for (const item of items) {
      await sqlite(paths.dbFile, `
INSERT INTO human_gate_batch_items(batch_id, item_id, source_type, source_id, workflow_id, meeting_id, title, summary, risk_tier, default_action, requires_individual_approval, status, action_hint, payload_json, created_at)
VALUES (${sqlValue(batchId)}, ${sqlValue(item.itemId)}, ${sqlValue(item.sourceType)}, ${sqlValue(item.sourceId)}, ${sqlValue(item.workflowId)}, ${sqlValue(item.meetingId)}, ${sqlValue(item.title)}, ${sqlValue(item.summary)}, ${sqlValue(item.riskTier)}, ${sqlValue(item.defaultAction)}, ${sqlValue(item.requiresIndividualApproval)}, ${sqlValue(item.status)}, ${sqlValue(item.actionHint || humanGateActionHint(item))}, ${sqlValue(JSON.stringify(item.payload || {}))}, ${sqlValue(item.createdAt)});`);
    }
    await sqlite(paths.dbFile, `
INSERT INTO artifact_index(artifact_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(batchId)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, 'human_gate_inbox', ${sqlValue(htmlPath)}, ${sqlValue(`${riskSummary.total} pending Human Gate inbox items`)}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)})
ON CONFLICT(artifact_id) DO UPDATE SET path=excluded.path, summary=excluded.summary, created_by=excluded.created_by, created_at=excluded.created_at;`);

    return {
      batchId,
      status: batch.status,
      createdAt,
      targetRef,
      count: items.length,
      riskSummary,
      htmlPath,
      jsonPath,
      telegramSummary: batch.telegramSummary,
      items,
      dbFile: paths.dbFile
    };
  }

  return {
    humanGateInbox,
    workflowHumanGateRecord
  };
}
