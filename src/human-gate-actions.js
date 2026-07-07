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
  "workflow.human_gate": "workflowHumanGateRecord",
  "human_gate.request": "humanGateRequest",
  "human_gate.web_app_review": "humanGateWebAppReview",
  "human_gate.review_form": "humanGateWebAppReview",
  "human_gate.web_app_submit": "humanGateWebAppSubmit",
  "human_gate.submit_form": "humanGateWebAppSubmit",
  "human_gate.button_callback": "humanGateButtonCallback",
  "human_gate.callback": "humanGateButtonCallback",
  "human_gate.feedback": "humanGateFeedback",
  "human_gate.submit_feedback": "humanGateFeedback",
  "human_gate.resume": "humanGateResume",
  "human_gate.confirm": "humanGateResume"
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

function humanGateRecordExpiresAt(firstText, record = {}) {
  const outer = parseJsonValue(record.payload || record.payload_json, {});
  const body = parseJsonValue(outer.payload, outer.payload || {});
  const raw = parseJsonValue(body.raw, body.raw || {});
  return firstText(body.expiresAt, raw.expiresAt, body.expires_at, raw.expires_at);
}

function humanGateRecordExpiry(firstText, record = {}) {
  const expiresAt = humanGateRecordExpiresAt(firstText, record);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  return {
    expiresAt,
    expired: Boolean(expiresAt && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()))
  };
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
  const auditHumanGatePlanDetails = requireContextFunction(context, "auditHumanGatePlanDetails");
  const auditHumanGatePlanOptions = requireContextFunction(context, "auditHumanGatePlanOptions");
  const auditHumanGatePrimaryLanguage = requireContextFunction(context, "auditHumanGatePrimaryLanguage");
  const boolOption = requireContextFunction(context, "boolOption");
  const combineHumanGateAudits = requireContextFunction(context, "combineHumanGateAudits");
  const createHumanGateButtons = requireContextFunction(context, "createHumanGateButtons");
  const dailyKey = requireContextFunction(context, "dailyKey");
  const deliverTelegramOutboxRow = requireContextFunction(context, "deliverTelegramOutboxRow");
  const enqueueTelegramOutbox = requireContextFunction(context, "enqueueTelegramOutbox");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const applyHumanGateWorkflowDecision = requireContextFunction(context, "applyHumanGateWorkflowDecision");
  const catTailPreOrderRiskAuditDispatchSpec = requireContextFunction(context, "catTailPreOrderRiskAuditDispatchSpec");
  const firstText = requireContextFunction(context, "firstText");
  const humanGateArtifactRef = requireContextFunction(context, "humanGateArtifactRef");
  const humanGateBody = requireContextFunction(context, "humanGateBody");
  const humanGateButtonDisplayLabel = requireContextFunction(context, "humanGateButtonDisplayLabel");
  const humanGateButtonFromRow = requireContextFunction(context, "humanGateButtonFromRow");
  const humanGateButtonSpecs = requireContextFunction(context, "humanGateButtonSpecs");
  const humanGateButtonTelegramStyle = requireContextFunction(context, "humanGateButtonTelegramStyle");
  const humanGateRecordById = requireContextFunction(context, "humanGateRecordById");
  const humanGateStageKey = requireContextFunction(context, "humanGateStageKey");
  const humanGateSummary = requireContextFunction(context, "humanGateSummary");
  const humanGateTelegramArtifacts = requireContextFunction(context, "humanGateTelegramArtifacts");
  const humanGateWebAppConfig = requireContextFunction(context, "humanGateWebAppConfig");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const normalizeRequester = requireContextFunction(context, "normalizeRequester");
  const nowIso = requireContextFunction(context, "nowIso");
  const pendingHumanGateForStage = requireContextFunction(context, "pendingHumanGateForStage");
  const relativeTo = requireContextFunction(context, "relativeTo");
  const protocolRecord = requireContextFunction(context, "protocolRecord");
  const resolveTelegramBotToken = requireContextFunction(context, "resolveTelegramBotToken");
  const safeId = requireContextFunction(context, "safeId");
  const safeMeetingDispatchWithRetry = requireContextFunction(context, "safeMeetingDispatchWithRetry");
  const sqliteChangeCount = requireContextFunction(context, "sqliteChangeCount");
  const meetingResume = requireContextFunction(context, "meetingResume");
  const supersedeHumanGateRecord = requireContextFunction(context, "supersedeHumanGateRecord");
  const telegramLinkFor = requireContextFunction(context, "telegramLinkFor");
  const textHash = requireContextFunction(context, "textHash");
  const updateHumanGateRecordFeedback = requireContextFunction(context, "updateHumanGateRecordFeedback");
  const verifyTelegramWebAppInitData = requireContextFunction(context, "verifyTelegramWebAppInitData");
  const workflowCheckpoint = requireContextFunction(context, "workflowCheckpoint");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const writeTextArtifact = requireContextFunction(context, "writeTextArtifact");
  const DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID = requireContextValue(context, "DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID");
  const HUMAN_GATE_APPROVE_OPTION_MAX = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MAX");
  const HUMAN_GATE_APPROVE_OPTION_MIN = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MIN");
  const HUMAN_GATE_STATUSES = requireContextValue(context, "HUMAN_GATE_STATUSES");
  const HUMAN_GATE_TEXT_POLICY_VERSION = requireContextValue(context, "HUMAN_GATE_TEXT_POLICY_VERSION");
  const INTERNAL_HUMAN_GATE_RECORD = requireContextValue(context, "INTERNAL_HUMAN_GATE_RECORD");

  function workflowFilterMatches(workflowId, value) {
    return !workflowId || String(value || "").trim() === workflowId;
  }

  function compactText(value, max = 220) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function humanGateRiskTier(input = {}) {
    const text = [
      input.sourceType,
      input.gateType,
      input.title,
      input.summary,
      input.workflowId,
      input.meetingId,
      JSON.stringify(input.payload || {})
    ].join(" ").toLowerCase();
    if (/(real[- ]?trade|live[- ]?trade|live_strategy|live strategy|strategy launch|资金|实盘|真实交易|production|deploy|cutover|gateway restart|restart gateway|database migration|schema migration|private key|secret|oauth|permission expansion|权限扩大)/.test(text)) return "P0";
    if (/(trade|order|execution|risk_budget|position|gateway|openclaw config|hermes migration|runtime migration|cron|heartbeat|config|model route|incident|权限|风控|迁移|部署|重启)/.test(text)) return "P1";
    if (/(human_gate|review|approval|automation|workflow|dry[- ]?run|observability|report|governance|制度|治理|观察)/.test(text)) return "P2";
    return "P3";
  }

  function humanGateDefaultAction(riskTier, input = {}) {
    const text = [input.sourceType, input.gateType, input.summary, input.title].join(" ").toLowerCase();
    if (riskTier === "P0") return "flash_lane_individual_review_required";
    if (riskTier === "P1") return "individual_review_required";
    if (/reject|blocked|failed|failure|异常|失败|阻塞/.test(text)) return "ask_revision";
    if (riskTier === "P2") return "review_then_batch";
    return "batch_approve_allowed";
  }

  function humanGateActionHint(item) {
    if (item.defaultAction === "flash_lane_individual_review_required") return "flash-lane single approve/reject/revise only";
    if (item.riskTier === "P0" || item.riskTier === "P1") return "single approve/reject/revise only";
    if (item.defaultAction === "ask_revision") return "ask responsible agent for revision";
    if (item.defaultAction === "review_then_batch") return "eligible for batch after quick review";
    return "eligible for batch approve";
  }

  function humanGateItem(sourceType, sourceId, fields = {}) {
    const riskTier = fields.riskTier || humanGateRiskTier({ sourceType, ...fields });
    const defaultAction = fields.defaultAction || humanGateDefaultAction(riskTier, { sourceType, ...fields });
    const requiresIndividualApproval = fields.requiresIndividualApproval ?? ["P0", "P1"].includes(riskTier);
    return {
      itemId: `item.${cleanFileSegment(sourceType)}.${cleanFileSegment(sourceId)}`,
      sourceType,
      sourceId,
      workflowId: String(fields.workflowId || "").trim(),
      meetingId: String(fields.meetingId || fields.workflowId || "").trim(),
      title: compactText(fields.title || sourceId, 120),
      summary: compactText(fields.summary || "", 360),
      riskTier,
      defaultAction,
      requiresIndividualApproval: Boolean(requiresIndividualApproval),
      status: fields.status || "pending",
      actionHint: fields.actionHint || "",
      buttons: Array.isArray(fields.buttons) ? fields.buttons : [],
      createdAt: fields.createdAt || nowIso(),
      payload: fields.payload || {},
      path: fields.path || ""
    };
  }

  function riskSummaryFor(items) {
    const summary = { total: items.length, P0: 0, P1: 0, P2: 0, P3: 0, individual: 0, batchEligible: 0, buttonChoices: 0 };
    for (const item of items) {
      summary[item.riskTier] = Number(summary[item.riskTier] || 0) + 1;
      if (item.requiresIndividualApproval) summary.individual += 1;
      else summary.batchEligible += 1;
      summary.buttonChoices += Array.isArray(item.buttons) ? item.buttons.length : 0;
    }
    return summary;
  }

  async function humanGateButtonsByGate(paths, gateIds = []) {
    const ids = [...new Set(gateIds.map((id) => String(id || "").trim()).filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id IN (${ids.map(sqlValue).join(",")})
ORDER BY created_at ASC;`, { json: true });
    const grouped = new Map();
    for (const row of rows) {
      const button = humanGateButtonFromRow(row, paths.root);
      const list = grouped.get(button.humanGateId) || [];
      list.push(button);
      grouped.set(button.humanGateId, list);
    }
    return grouped;
  }

  async function collectHumanGateInboxItems(paths, input = {}) {
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));
    const items = [];
    const pendingHumanGateIds = [];

    const humanGates = await sqlite(paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending'
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
    for (const row of humanGates) {
      const payload = parseJsonValue(row.payload_json, {});
      const body = parseJsonValue(payload.payload, payload.payload || {});
      const gateWorkflowId = body.workflowId || payload.workflowId || row.parent_object_id || "";
      if (!workflowFilterMatches(workflowId, gateWorkflowId)) continue;
      const gateType = body.gateType || payload.gateType || "human_gate_record";
      pendingHumanGateIds.push(row.object_id);
      items.push(humanGateItem("human_gate_record", row.object_id, {
        workflowId: gateWorkflowId,
        meetingId: gateWorkflowId,
        title: `${gateType}: ${row.object_id}`,
        summary: payload.summary || body.summary || "",
        gateType,
        status: row.status,
        createdAt: row.created_at,
        path: row.path,
        payload: { sourceAgent: row.source_agent, parentObjectId: row.parent_object_id, payload }
      }));
    }
    const buttonGroups = await humanGateButtonsByGate(paths, pendingHumanGateIds);
    for (const item of items) {
      if (item.sourceType !== "human_gate_record") continue;
      const buttons = buttonGroups.get(item.sourceId) || [];
      if (!buttons.length) {
        item.status = "blocked_missing_buttons";
        item.blocked = true;
        item.actionHint = "blocked: human_gate_record has no active buttons; cat_claw must not approve it and cat_brain must regenerate a button-first Human Gate";
        item.payload = { ...item.payload, buttons: [] };
        continue;
      }
      item.buttons = buttons;
      item.payload = { ...item.payload, buttons };
      item.actionHint = "select one recorded button; do not infer intent from natural language";
    }

    const reviewGates = await sqlite(paths.dbFile, `
SELECT gate_id, instrument_id, workflow_id, gate_type, status, summary, reviewer_agent, human_gate_required, resume_pointer, expires_at, evidence_paths_json, created_at
FROM review_gates
WHERE status='pending' OR (human_gate_required=1 AND status NOT IN ('approved','rejected','waived','expired','cancelled','done'))
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
    for (const row of reviewGates) {
      if (!workflowFilterMatches(workflowId, row.workflow_id)) continue;
      items.push(humanGateItem("review_gate", row.gate_id, {
        workflowId: row.workflow_id,
        meetingId: row.workflow_id,
        title: `${row.gate_type}: ${row.gate_id}`,
        summary: row.summary || "",
        gateType: row.gate_type,
        status: row.status,
        createdAt: row.created_at,
        payload: {
          instrumentId: row.instrument_id,
          reviewerAgent: row.reviewer_agent,
          humanGateRequired: Boolean(Number(row.human_gate_required || 0)),
          resumePointer: row.resume_pointer,
          expiresAt: row.expires_at,
          evidencePaths: parseJsonValue(row.evidence_paths_json, [])
        }
      }));
    }

    const gatedTasks = await sqlite(paths.dbFile, `
SELECT task_id, workflow_id, phase, owner_agent, runtime, agent_id, task_type, status, priority, expected_artifact, summary, due_at, created_at
FROM workflow_tasks
WHERE human_gate_required=1 AND status NOT IN ('done','failed','cancelled')
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
    for (const row of gatedTasks) {
      if (!workflowFilterMatches(workflowId, row.workflow_id)) continue;
      items.push(humanGateItem("workflow_task_gate", row.task_id, {
        workflowId: row.workflow_id,
        meetingId: row.workflow_id,
        title: `${row.task_type}: ${row.task_id}`,
        summary: row.summary || row.expected_artifact || "",
        gateType: "workflow_task_human_gate",
        status: row.status,
        createdAt: row.created_at,
        payload: {
          phase: row.phase,
          ownerAgent: row.owner_agent,
          runtime: row.runtime,
          agentId: row.agent_id,
          priority: row.priority,
          dueAt: row.due_at
        }
      }));
    }

    const reportDeliveryRows = await sqlite(paths.dbFile, `
SELECT outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at
FROM telegram_outbox
WHERE status IN ('queued','failed') AND message_type IN ('workflow_secretary_report','human_gate_report','human_gate_request')
ORDER BY created_at DESC
LIMIT ${limit};`, { json: true });
    for (const row of reportDeliveryRows) {
      const payload = parseJsonValue(row.payload_json, {});
      const itemWorkflowId = payload.workflowId || payload.workflow_id || row.meeting_id || "";
      if (!workflowFilterMatches(workflowId, itemWorkflowId)) continue;
      const riskTier = row.status === "failed" ? "P1" : "P2";
      items.push(humanGateItem("cat_claw_delivery", row.outbox_id, {
        workflowId: itemWorkflowId,
        meetingId: row.meeting_id,
        title: `${row.message_type}: ${row.outbox_id}`,
        summary: compactText(row.text || "", 320),
        gateType: row.message_type,
        riskTier,
        defaultAction: row.status === "failed" ? "repair_delivery" : "deliver_outbox",
        requiresIndividualApproval: false,
        status: row.status,
        createdAt: row.created_at,
        actionHint: row.status === "failed" ? "repair or resend delivery" : "deliver queued summary",
        payload: { targetKind: row.target_kind, targetRef: row.target_ref, updatedAt: row.updated_at, payload }
      }));
    }

    return items.slice(0, limit);
  }

  function renderHumanGateInboxHtml(batch) {
    const riskClass = (tier) => `risk-${String(tier || "P3").toLowerCase()}`;
    const buttonHtml = (buttons = []) => {
      if (!buttons.length) return `<span class="muted">-</span>`;
      return buttons.map((button) => `
            <div class="choice-row">
              <button type="button" class="choice choice-${escapeHtml(button.decisionStatus)}" data-command="${escapeHtml(button.cliCommand || "")}">${escapeHtml(button.label)}</button>
              <div class="choice-meta">
                <span>${escapeHtml(button.decisionStatus)}</span>
                <span>${escapeHtml(button.status)}</span>
                ${button.artifactRef ? `<span>artifact: ${escapeHtml(button.artifactRef)}</span>` : ""}
                <code>${escapeHtml(button.callbackData || "")}</code>
                <code>${escapeHtml(button.cliCommand || "")}</code>
              </div>
            </div>`).join("\n");
    };
    const rowHtml = batch.items.map((item) => `
        <tr class="${riskClass(item.riskTier)}">
          <td>${escapeHtml(item.riskTier)}</td>
          <td>${escapeHtml(item.sourceType)}<br><code>${escapeHtml(item.sourceId)}</code></td>
          <td>${escapeHtml(item.workflowId || "-")}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.summary || "-")}</td>
          <td>${buttonHtml(item.buttons)}</td>
          <td>${escapeHtml(item.defaultAction)}</td>
          <td>${item.requiresIndividualApproval ? "single" : "batch ok"}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.actionHint || humanGateActionHint(item))}</td>
        </tr>`).join("\n");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Human Gate Inbox ${escapeHtml(batch.batchId)}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #1f2933; }
    main { max-width: 1280px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .meta { color: #52606d; margin-bottom: 20px; }
    .summary { display: grid; grid-template-columns: repeat(7, minmax(100px, 1fr)); gap: 8px; margin: 16px 0 20px; }
    .metric { background: white; border: 1px solid #d9e2ec; border-radius: 6px; padding: 10px 12px; }
    .metric strong { display: block; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #d9e2ec; }
    th, td { text-align: left; vertical-align: top; padding: 10px; border-bottom: 1px solid #e4e7eb; font-size: 13px; }
    th { background: #eef2f7; position: sticky; top: 0; z-index: 1; }
    code { font-size: 12px; color: #334e68; }
    .muted { color: #829ab1; }
    .choice-row { display: grid; grid-template-columns: minmax(130px, 0.8fr) minmax(220px, 1.4fr); gap: 8px; align-items: start; padding: 6px 0; border-bottom: 1px solid #eef2f7; }
    .choice-row:last-child { border-bottom: 0; }
    .choice { appearance: none; border: 1px solid #bcccdc; background: #f8fafc; color: #1f2933; border-radius: 5px; padding: 7px 9px; font-size: 12px; font-weight: 650; text-align: left; cursor: pointer; }
    .choice-approved { border-color: #15803d; background: #f0fdf4; color: #14532d; }
    .choice-rejected { border-color: #b91c1c; background: #fef2f2; color: #7f1d1d; }
    .choice-paused, .choice-pending, .choice-expired { border-color: #64748b; background: #f8fafc; color: #334155; }
    .choice-terminated { border-color: #7f1d1d; background: #fee2e2; color: #7f1d1d; }
    .choice-meta { display: flex; flex-direction: column; gap: 4px; color: #52606d; }
    .choice-meta code { white-space: normal; overflow-wrap: anywhere; }
    .copied { outline: 2px solid #0f766e; }
    .risk-p0 td:first-child { border-left: 5px solid #b91c1c; font-weight: 700; }
    .risk-p1 td:first-child { border-left: 5px solid #d97706; font-weight: 700; }
    .risk-p2 td:first-child { border-left: 5px solid #2563eb; font-weight: 700; }
    .risk-p3 td:first-child { border-left: 5px solid #16a34a; font-weight: 700; }
    .empty { background: white; border: 1px solid #d9e2ec; border-radius: 6px; padding: 20px; }
    @media (max-width: 900px) { .summary { grid-template-columns: repeat(2, 1fr); } table { min-width: 1250px; } .scroll { overflow-x: auto; } }
  </style>
</head>
<body>
<main>
  <h1>Flashcat Human Gate Console</h1>
  <div class="meta">batch_id: <code>${escapeHtml(batch.batchId)}</code> | created_at: ${escapeHtml(batch.createdAt)} | target: ${escapeHtml(batch.targetRef)}</div>
  <div class="meta">Choice buttons copy the exact callback command. Cat Claw must record a selected button token, not infer Flashcat intent from free text.</div>
  <section class="summary">
    <div class="metric"><span>Total</span><strong>${batch.riskSummary.total}</strong></div>
    <div class="metric"><span>P0</span><strong>${batch.riskSummary.P0}</strong></div>
    <div class="metric"><span>P1</span><strong>${batch.riskSummary.P1}</strong></div>
    <div class="metric"><span>P2</span><strong>${batch.riskSummary.P2}</strong></div>
    <div class="metric"><span>P3</span><strong>${batch.riskSummary.P3}</strong></div>
    <div class="metric"><span>Batch eligible</span><strong>${batch.riskSummary.batchEligible}</strong></div>
    <div class="metric"><span>Button choices</span><strong>${batch.riskSummary.buttonChoices}</strong></div>
  </section>
  ${batch.items.length ? `<div class="scroll"><table>
    <thead>
      <tr>
        <th>Risk</th>
        <th>Source</th>
        <th>Workflow</th>
        <th>Title</th>
        <th>Summary</th>
        <th>Choice buttons</th>
        <th>Default action</th>
        <th>Approval mode</th>
        <th>Status</th>
        <th>Action hint</th>
      </tr>
    </thead>
    <tbody>${rowHtml}
    </tbody>
  </table></div>` : `<div class="empty">No pending Human Gate items.</div>`}
</main>
<script>
  document.querySelectorAll(".choice").forEach((button) => {
    button.addEventListener("click", async () => {
      const command = button.dataset.command || "";
      if (!command) return;
      try {
        await navigator.clipboard.writeText(command);
        button.classList.add("copied");
        const original = button.textContent;
        button.textContent = "Copied";
        window.setTimeout(() => {
          button.textContent = original;
          button.classList.remove("copied");
        }, 1200);
      } catch {
        window.prompt("Copy Human Gate callback command", command);
      }
    });
  });
</script>
</body>
</html>`;
  }

  function renderHumanGateTelegramSummary(batch) {
    const s = batch.riskSummary;
    const topItems = batch.items.slice(0, 5).map((item) => `- ${item.riskTier} ${item.sourceType} ${item.workflowId || "-"}: ${item.title}`).join("\n");
    return [
      `Human Gate Console | ${batch.createdAt}`,
      `batch_id: ${batch.batchId}`,
      `pending: ${s.total} | buttons: ${s.buttonChoices} | P0 ${s.P0} | P1 ${s.P1} | P2 ${s.P2} | P3 ${s.P3}`,
      `individual: ${s.individual} | batch_eligible: ${s.batchEligible}`,
      `html: ${batch.htmlPath}`,
      "",
      topItems || "- no pending items",
      "",
      "Suggested handling: P0/P1 single review; P2/P3 can be batched after quick scan."
    ].join("\n");
  }

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

  function humanGateFeedbackText(input = {}) {
    return String(firstText(
      input.flashcatOriginalWords,
      input.flashcat_original_words,
      input.feedbackText,
      input.feedback_text,
      input.reviewText,
      input.review_text,
      input.feedback,
      input.text,
      input.args
    )).trim();
  }

  function humanGateFeedbackRequiredReply(button = {}) {
    const callbackToken = String(button.callback_token || button.callbackToken || "").trim();
    const tokenText = callbackToken ? `tawhg:${callbackToken}` : "<Human Gate token>";
    return [
      `已记录 Human Gate 按钮选择：${button.label || ""}`,
      "请继续发送闪电猫原话/审核意见，Human Gate 才会正式完成。",
      "",
      "Telegram 当前不能从普通 inline callback button 直接弹出可输入文本框；请在本聊天发送带 token 的反馈：",
      `/hgate ${tokenText} 这里写闪电猫原话或审核意见`,
      "",
      "这段原话会按 token 绑定到本按钮、本事项和本 workflow，保存为“闪电猫原话”，并作为下一轮 workflow 校准方向和边界的依据。"
    ].join("\n");
  }

  function rawHumanGateCallbackToken(input = {}) {
    const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
    return firstText(
      input.token,
      input.callbackToken,
      input.callback_token,
      input.callbackData,
      input.callback_data,
      payload.token,
      payload.callbackToken,
      payload.callback_token,
      payload.callbackData,
      payload.callback_data,
      typeof input.payload === "string" ? input.payload : ""
    );
  }

  function normalizeHumanGateCallbackToken(input = {}) {
    const rawToken = rawHumanGateCallbackToken(input);
    return rawToken.startsWith("tawhg:") ? rawToken.slice("tawhg:".length) : rawToken;
  }

  async function humanGateButtonRowByToken(paths, input = {}) {
    const token = normalizeHumanGateCallbackToken(input);
    if (!token) return null;
    const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} LIMIT 1;`, { json: true });
    return rows[0] || null;
  }

  async function humanGateCallbackIdentityAllowed(input = {}) {
    const senderId = String(firstText(
      input.senderId,
      input.sender_id,
      input.fromUserId,
      input.from_user_id,
      input.userId,
      input.user_id,
      input.payload?.senderId,
      input.payload?.sender_id,
      input.payload?.fromUserId,
      input.payload?.from_user_id,
      input.payload?.userId,
      input.payload?.user_id,
      input.payload?.telegramWebApp?.userId,
      input.payload?.telegram_web_app?.userId
    )).trim();
    const sourceSystem = String(firstText(input.sourceSystem, input.source_system, input.source, input.payload?.source)).trim().toLowerCase();
    const requiresSender = /(telegram|web[_-]?app|callback[_-]?query|bot|wecom|im_adapter)/.test(sourceSystem);
    if (!senderId && requiresSender) return { ok: false, senderId: "", reason: "telegram_sender_id_required" };
    if (!senderId) return { ok: true, senderId: "", reason: "no_sender_id_supplied" };
    const webApp = await humanGateWebAppConfig(input);
    const allowed = webApp.allowedTelegramUserIds.length ? webApp.allowedTelegramUserIds : [DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID];
    if (!allowed.includes(senderId)) return { ok: false, senderId, reason: "telegram_user_not_allowed", allowedTelegramUserIds: allowed };
    return { ok: true, senderId, reason: "" };
  }

  async function humanGateRequest(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const requester = normalizeRequester(input.from || input.sourceAgent || input.source_agent || input.ownerAgent || input.owner_agent, "cat_claw");
    const workflowId = firstText(input.workflowId, input.workflow_id, input.parentObjectId, input.parent_object_id, meetingId);
    const gateType = firstText(input.gateType, input.gate_type, "workflow_continuation");
    const parentObjectId = input.parentObjectId || input.parent_object_id || workflowId;
    const stageKey = humanGateStageKey(input, workflowId, gateType, parentObjectId);
    const requestedHumanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
    const supersedeExisting = boolOption(input.supersedeExisting ?? input.supersede_existing ?? input.supersede ?? input.replaceExisting ?? input.replace_existing, false);
    const stageGateId = requestedHumanGateId || (supersedeExisting ? "" : `hgate.stage.${textHash(`${workflowId}:${gateType}:${stageKey}`).slice(0, 24)}`);
    const directHumanGateId = stageGateId || requestedHumanGateId;
    const requestPayload = parseJsonValue(input.payload, input.payload || {});
    const buttonSpecs = humanGateButtonSpecs(
      { object_id: stageGateId, path: "" },
      { ...input, payload: requestPayload },
      { ...input, raw: requestPayload }
    );
    const buttonAudit = combineHumanGateAudits(
      auditHumanGatePlanOptions(buttonSpecs),
      auditHumanGatePlanDetails(buttonSpecs),
      auditHumanGatePrimaryLanguage(input, buttonSpecs)
    );
    if (!buttonAudit.ok) {
      throw new Error(`Human Gate request blocked: ${buttonAudit.reason}; cat-brain main must provide ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} complete option details and Chinese-format report material before cat_claw submits to Flashcat`);
    }
    let gate = null;
    let supersededGate = null;
    if (directHumanGateId) {
      const existingGate = await humanGateRecordById(paths, directHumanGateId);
      const lockedButtons = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(directHumanGateId)} AND status IN ('feedback_pending','selected')
ORDER BY updated_at DESC, created_at ASC;`, { json: true });
      if (existingGate && !["pending", "superseded"].includes(existingGate.status)) {
        const rows = await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(directHumanGateId)}
ORDER BY created_at ASC;`, { json: true });
        return {
          meetingId,
          workflowId,
          humanGateId: directHumanGateId,
          gateType,
          stageKey,
          reusedStageGate: true,
          alreadySubmitted: true,
          status: existingGate.status,
          buttons: rows.map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root)),
          deliveryRequired: false,
          dbFile: paths.dbFile
        };
      }
      if (lockedButtons.length) {
        const selected = lockedButtons.find((row) => row.status === "selected") || lockedButtons[0];
        return {
          meetingId,
          workflowId,
          humanGateId: directHumanGateId,
          gateType,
          stageKey,
          reusedStageGate: true,
          alreadySubmitted: selected.status === "selected",
          status: selected.status === "selected" ? selected.decision_status : "feedback_pending",
          buttons: lockedButtons.map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root)),
          deliveryRequired: false,
          dbFile: paths.dbFile
        };
      }
    }
    const stageMatch = await pendingHumanGateForStage(paths, { workflowId, gateType, stageKey, excludeHumanGateId: requestedHumanGateId });
    if (stageMatch?.row) {
      if (supersedeExisting) {
        supersededGate = await supersedeHumanGateRecord(paths, stageMatch.row, "superseded_by_new_human_gate_request_same_stage");
      } else {
        gate = { objectId: stageMatch.row.object_id, objectType: "human_gate_record", status: "pending", idempotentReplay: true, reusedStageGate: true };
      }
    }
    if (!gate) {
      gate = await workflowHumanGateRecord(rootDir, {
        ...input,
        [INTERNAL_HUMAN_GATE_RECORD]: true,
        humanGateId: stageGateId || input.humanGateId || input.human_gate_id,
        workflowId,
        parentObjectId,
        gateType,
        humanGateStageKey: stageKey,
        actor: input.actor || requester,
        status: "pending",
        sourceSystem: input.sourceSystem || input.source_system || "openclaw",
        sourceAgent: requester
      });
    }
    let buttons = (await sqlite(paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id=${sqlValue(gate.objectId)} AND status='active'
ORDER BY created_at ASC;`, { json: true })).map((buttonRow) => humanGateButtonFromRow(buttonRow, paths.root));
    if (!buttons.length) {
      buttons = await createHumanGateButtons(paths, {
        ...input,
        buttons: buttonSpecs,
        addDefaultControls: false,
        workflowId,
        meetingId,
        humanGateId: gate.objectId,
        createdBy: requester
      });
    }
    const { webApp, presentation, telegramReplyMarkup, text } = await humanGateTelegramArtifacts(input, buttons);
    const eventId = safeId("control");
    const createdAt = nowIso();
    await sqlite(paths.dbFile, `
INSERT INTO meeting_control_events(event_id, meeting_id, event_type, status, summary, payload_json, created_by, created_at)
VALUES (${sqlValue(eventId)}, ${sqlValue(meetingId)}, 'human_gate_request', 'pending', ${sqlValue(input.summary || input.text || "")}, ${sqlValue(JSON.stringify({ humanGateId: gate.objectId, gateType, workflowId, buttons }))}, ${sqlValue(requester)}, ${sqlValue(createdAt)});`);
    const link = await telegramLinkFor(paths, meetingId);
    const channelTarget = firstText(input.channelId, input.channel_id, input.channel);
    const explicitTarget = firstText(input.targetRef, input.target_ref, input.target, input.chatId, input.chat_id, input.notifyTargets, input.notify_targets, channelTarget);
    const linkTarget = firstText(link?.human_gate_channel_id, link?.channel_id, link?.chat_id);
    const targetRef = explicitTarget || linkTarget || DEFAULT_FLASHCAT_TELEGRAM_CHAT_ID;
    const targetKind = firstText(input.targetKind, input.target_kind) || (channelTarget || targetRef.startsWith("-") ? "channel" : "private");
    const deliveryAccount = normalizeRequester(input.account || input.telegramAccount || input.telegram_account, "cat_claw");
    const telegramOutbox = await enqueueTelegramOutbox(paths, {
      outboxId: `hgate-${cleanFileSegment(gate.objectId)}`,
      meetingId,
      targetKind,
      targetRef,
      messageType: "human_gate_request",
      text,
      payload: { humanGateId: gate.objectId, gateType, workflowId, eventId, account: deliveryAccount, requester, targetKind, targetRef, buttons, presentation, telegramReplyMarkup, webApp, textPolicyVersion: HUMAN_GATE_TEXT_POLICY_VERSION }
    });
    let delivery = null;
    const shouldDeliver = boolOption(input.autoDeliver ?? input.auto_deliver ?? input.deliver, false);
    if (shouldDeliver && telegramOutbox.status === "queued") {
      const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(telegramOutbox.outboxId)} LIMIT 1;`, { json: true });
      if (rows[0]) delivery = await deliverTelegramOutboxRow(paths, rows[0], { ...input, account: deliveryAccount, target: targetRef });
    }
    await appendWorkflowEvent(paths, {
      eventType: "human_gate.requested",
      status: "pending",
      workflowId,
      humanGateId: gate.objectId,
      actor: requester,
      sourceRuntime: "workflow",
      sourceAgent: requester,
      nextState: "pending",
      artifactRef: telegramOutbox.outboxId,
      payload: {
        meetingId,
        gateType,
        stageKey,
        reusedStageGate: Boolean(gate.idempotentReplay),
        supersededHumanGateId: supersededGate?.humanGateId || "",
        targetKind,
        targetRef,
        buttonCount: buttons.length,
        telegramOutboxId: telegramOutbox.outboxId,
        deliveryStatus: delivery?.status || telegramOutbox.status
      },
      createdAt
    });
    return { meetingId, workflowId, humanGateId: gate.objectId, gateType, stageKey, reusedStageGate: Boolean(gate.idempotentReplay), supersededGate, eventId, buttons, presentation, telegramReplyMarkup, webApp, targetKind, targetRef, deliveryAccount, telegramOutbox, deliveryRequired: telegramOutbox.status === "queued" && !delivery, delivery, status: "pending", dbFile: paths.dbFile };
  }

  async function humanGateWebAppReview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const button = await humanGateButtonRowByToken(paths, input);
    if (!button) return { handled: true, status: "not_found", token: normalizeHumanGateCallbackToken(input), replyText: "Human Gate 按钮已失效或不存在。", dbFile: paths.dbFile };
    const record = await humanGateRecordById(paths, button.human_gate_id) || {};
    const expiry = humanGateRecordExpiry(firstText, record);
    const recordPayload = parseJsonValue(record.payload_json, {});
    const body = humanGateBody(recordPayload);
    const webApp = await humanGateWebAppConfig(input);
    const publicButton = humanGateButtonFromRow(button, paths.root);
    const canSubmit = ["active", "feedback_pending"].includes(button.status) && !expiry.expired;
    return {
      handled: true,
      status: expiry.expired ? "expired" : canSubmit ? "ready" : button.status,
      canSubmit,
      token: button.callback_token,
      humanGateId: button.human_gate_id,
      workflowId: button.workflow_id || "",
      meetingId: button.meeting_id || "",
      button: {
        buttonId: button.button_id,
        label: publicButton.label,
        displayLabel: humanGateButtonDisplayLabel(publicButton, 0),
        decisionStatus: button.decision_status,
        role: button.button_role || "",
        style: humanGateButtonTelegramStyle(publicButton, 0),
        artifactRef: button.artifact_ref || "",
        summary: button.summary || "",
        prompt: button.prompt || "",
        status: button.status,
        feedbackStatus: button.feedback_status || "",
        selectedAt: button.selected_at || "",
        feedbackReceivedAt: button.feedback_received_at || ""
      },
      humanGate: {
        status: record.status || "",
        summary: humanGateSummary(recordPayload, body),
        gateType: body.gateType || body.gate_type || recordPayload.gateType || recordPayload.gate_type || "",
        artifactRef: humanGateArtifactRef(record, recordPayload, body),
        createdAt: record.created_at || "",
        updatedAt: record.updated_at || "",
        expiresAt: expiry.expiresAt
      },
      webApp,
      dbFile: paths.dbFile
    };
  }

  async function humanGateWebAppSubmit(rootDir, input = {}) {
    await ensureWorkflowLayout(rootDir, input);
    const token = normalizeHumanGateCallbackToken(input);
    const feedbackText = humanGateFeedbackText(input);
    if (!token) return { handled: true, status: "token_required", replyText: "缺少 Human Gate token，无法判断这段原话对应哪个按钮/事项/workflow。" };
    if (!feedbackText) return { handled: true, status: "feedback_required", replyText: "请填写闪电猫原话或审核意见；点击发送后 Human Gate 才会正式完成。" };
    const webApp = await humanGateWebAppConfig(input);
    const account = String(input.account || input.accountId || input.account_id || "cat_claw").trim();
    const initData = String(input.initData || input.init_data || input.telegramWebAppInitData || input.telegram_web_app_init_data || "").trim();
    let telegramAuth = { ok: false, reason: initData ? "not_checked" : "missing_init_data" };
    if (initData) {
      const botToken = await resolveTelegramBotToken(account, input);
      telegramAuth = verifyTelegramWebAppInitData(initData, botToken, {
        maxAgeSeconds: webApp.maxInitDataAgeSeconds,
        allowedTelegramUserIds: webApp.allowedTelegramUserIds
      });
    }
    const verifyPolicy = webApp.verifyTelegramInitData;
    const strictVerify = ["1", "true", "required", "strict", "yes"].includes(verifyPolicy);
    if (telegramAuth.reason === "telegram_user_not_allowed") {
      return { handled: true, status: "telegram_user_not_allowed", telegramAuth, replyText: "该 Telegram 用户不在 Human Gate 允许提交名单中。" };
    }
    if (strictVerify && !telegramAuth.ok) {
      return { handled: true, status: "telegram_auth_failed", telegramAuth, replyText: `Telegram Web App 身份校验失败：${telegramAuth.reason}` };
    }
    if (telegramAuth.ok && webApp.allowedTelegramUserIds.length && telegramAuth.userId && !webApp.allowedTelegramUserIds.includes(telegramAuth.userId)) {
      return { handled: true, status: "telegram_user_not_allowed", telegramAuth, replyText: "该 Telegram 用户不在 Human Gate 允许提交名单中。" };
    }
    return humanGateButtonCallback(rootDir, {
      ...input,
      token,
      feedbackText,
      actor: input.actor || telegramAuth.userId || "flashcat",
      senderId: input.senderId || input.sender_id || telegramAuth.userId || "",
      sourceSystem: input.sourceSystem || input.source_system || "telegram_web_app",
      payload: {
        ...(input.payload && typeof input.payload === "object" ? input.payload : {}),
        telegramWebApp: {
          initDataPresent: Boolean(initData),
          initDataVerified: Boolean(telegramAuth.ok),
          authReason: telegramAuth.reason || "",
          userId: telegramAuth.userId || "",
          username: telegramAuth.username || "",
          submittedAt: nowIso()
        }
      }
    });
  }

  async function humanGateButtonCallback(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const token = normalizeHumanGateCallbackToken(input);
    if (!token) throw new Error("callback token is required");
    const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} LIMIT 1;`, { json: true });
    const button = rows[0];
    if (!button) return { handled: true, status: "unknown", token, replyText: "Human Gate 按钮已失效或不存在。" };
    const identity = await humanGateCallbackIdentityAllowed(input);
    if (!identity.ok) {
      const replyText = identity.reason === "telegram_sender_id_required"
        ? "Human Gate Telegram 回调缺少发送者身份，已拒绝处理；请通过绑定 token 的 Web App 或带 senderId 的受治理入口提交。"
        : "该 Telegram 用户不在 Human Gate 允许提交名单中。";
      return { handled: true, status: identity.reason, token, telegramAuth: identity, replyText };
    }
    const record = await humanGateRecordById(paths, button.human_gate_id);
    const expiry = humanGateRecordExpiry(firstText, record || {});
    if (expiry.expired) {
      const expiredAt = nowIso();
      await sqlite(paths.dbFile, `
UPDATE human_gate_buttons
SET status='expired', updated_at=${sqlValue(expiredAt)}
WHERE human_gate_id=${sqlValue(button.human_gate_id)} AND status IN ('active','feedback_pending');`);
      await sqlite(paths.dbFile, `
UPDATE protocol_objects
SET status='expired', updated_at=${sqlValue(expiredAt)}
WHERE object_id=${sqlValue(button.human_gate_id)} AND object_type='human_gate_record' AND status='pending';`);
      return { handled: true, status: "expired", token, workflowId: button.workflow_id, meetingId: button.meeting_id, humanGateId: button.human_gate_id, buttonId: button.button_id, expiresAt: expiry.expiresAt, replyText: "Human Gate 已过期，请让猫爪重新提交最新证据包和按钮。" };
    }
    const feedbackText = humanGateFeedbackText(input);
    if (button.status === "feedback_pending" && !feedbackText) return { handled: true, status: "feedback_pending", token, replyText: humanGateFeedbackRequiredReply(button) };
    if (button.status !== "active" && !(button.status === "feedback_pending" && feedbackText)) return { handled: true, status: button.status, token, replyText: "Human Gate 按钮已经处理过。" };
    const selectedAt = button.selected_at || nowIso();
    const now = nowIso();
    const actor = String(input.actor || input.senderId || input.sender_id || input.from || button.selected_by || "flashcat").trim();
    const callbackChatId = String(input.callbackChatId || input.callback_chat_id || button.callback_chat_id || "").trim();
    const callbackMessageId = String(input.callbackMessageId || input.callback_message_id || button.callback_message_id || "").trim();
    const feedbackPayload = {
      source: input.sourceSystem || input.source_system || "human_gate.button_callback",
      accountId: input.accountId || input.account_id || input.payload?.accountId || "",
      senderId: input.senderId || input.sender_id || actor,
      callbackChatId,
      callbackMessageId,
      callbackData: input.callbackData || input.callback_data || input.payload?.callbackData || "",
      telegramWebApp: input.telegramWebApp || input.telegram_web_app || input.payload?.telegramWebApp || input.payload?.telegram_web_app || {},
      selectedAt,
      updatedAt: now
    };
    if (!feedbackText) {
      const pendingChanges = await sqliteChangeCount(paths.dbFile, `
UPDATE human_gate_buttons
SET status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'feedback_pending' ELSE 'superseded' END,
    selected_by=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(actor)} ELSE selected_by END,
    selected_at=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(selectedAt)} ELSE selected_at END,
    callback_chat_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackChatId)} ELSE callback_chat_id END,
    callback_message_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackMessageId)} ELSE callback_message_id END,
    feedback_status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'waiting_flashcat_words' ELSE feedback_status END,
    feedback_payload_json=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(JSON.stringify(feedbackPayload))} ELSE feedback_payload_json END,
    updated_at=${sqlValue(now)}
WHERE human_gate_id=${sqlValue(button.human_gate_id)}
  AND status='active'
  AND NOT EXISTS (
    SELECT 1 FROM human_gate_buttons existing
    WHERE existing.human_gate_id=${sqlValue(button.human_gate_id)}
      AND existing.status IN ('feedback_pending','selected')
  );`);
      if (!pendingChanges) {
        const latestRows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE button_id=${sqlValue(button.button_id)} LIMIT 1;`, { json: true });
        const latest = latestRows[0] || button;
        return {
          handled: true,
          status: latest.status || "stale",
          workflowId: latest.workflow_id || button.workflow_id,
          meetingId: latest.meeting_id || button.meeting_id,
          humanGateId: latest.human_gate_id || button.human_gate_id,
          buttonId: latest.button_id || button.button_id,
          label: latest.label || button.label,
          replyText: latest.status === "feedback_pending" ? humanGateFeedbackRequiredReply(latest) : "Human Gate 按钮已经处理过。",
          dbFile: paths.dbFile
        };
      }
      await updateHumanGateRecordFeedback(paths, button.human_gate_id, "pending", {
        ...feedbackPayload,
        status: "waiting_flashcat_words",
        buttonId: button.button_id,
        buttonLabel: button.label,
        decisionStatus: button.decision_status,
        role: button.button_role || ""
      }, now);
      await meetingResume(rootDir, {
        workflowRootDir: paths.root,
        meetingId: button.meeting_id || button.workflow_id,
        from: actor,
        status: "feedback_pending",
        text: `Human Gate button selected; waiting for Flashcat original words: ${button.label}`,
        payload: {
          workflowId: button.workflow_id,
          humanGateId: button.human_gate_id,
          buttonId: button.button_id,
          status: "feedback_pending",
          source: "human_gate.button_callback"
        }
      });
      return {
        handled: true,
        status: "feedback_pending",
        workflowId: button.workflow_id,
        meetingId: button.meeting_id,
        humanGateId: button.human_gate_id,
        buttonId: button.button_id,
        label: button.label,
        replyText: humanGateFeedbackRequiredReply(button),
        dbFile: paths.dbFile
      };
    }

    const feedbackReceivedAt = now;
    const finalFeedbackPayload = {
      ...feedbackPayload,
      status: "received",
      feedbackReceivedAt,
      flashcatOriginalWords: feedbackText,
      buttonId: button.button_id,
      buttonLabel: button.label,
      decisionStatus: button.decision_status,
      role: button.button_role || ""
    };
    const finalChanges = await sqliteChangeCount(paths.dbFile, `
UPDATE human_gate_buttons
SET status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'selected' WHEN status IN ('active','feedback_pending') THEN 'superseded' ELSE status END,
    selected_by=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(actor)} ELSE selected_by END,
    selected_at=CASE WHEN button_id=${sqlValue(button.button_id)} THEN COALESCE(NULLIF(selected_at,''), ${sqlValue(selectedAt)}) ELSE selected_at END,
    callback_chat_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackChatId)} ELSE callback_chat_id END,
    callback_message_id=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(callbackMessageId)} ELSE callback_message_id END,
    feedback_status=CASE WHEN button_id=${sqlValue(button.button_id)} THEN 'received' WHEN status='feedback_pending' THEN 'superseded' ELSE feedback_status END,
    feedback_text=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(feedbackText)} ELSE feedback_text END,
    feedback_received_at=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(feedbackReceivedAt)} ELSE feedback_received_at END,
    feedback_payload_json=CASE WHEN button_id=${sqlValue(button.button_id)} THEN ${sqlValue(JSON.stringify(finalFeedbackPayload))} ELSE feedback_payload_json END,
    updated_at=${sqlValue(feedbackReceivedAt)}
WHERE human_gate_id=${sqlValue(button.human_gate_id)}
  AND (status IN ('active','feedback_pending') OR (button_id=${sqlValue(button.button_id)} AND status='feedback_pending'))
  AND NOT EXISTS (
    SELECT 1 FROM human_gate_buttons existing
    WHERE existing.human_gate_id=${sqlValue(button.human_gate_id)}
      AND existing.status='selected'
  );`);
    if (!finalChanges) {
      const latestRows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE button_id=${sqlValue(button.button_id)} LIMIT 1;`, { json: true });
      const latest = latestRows[0] || button;
      return {
        handled: true,
        status: latest.status || "stale",
        workflowId: latest.workflow_id || button.workflow_id,
        meetingId: latest.meeting_id || button.meeting_id,
        humanGateId: latest.human_gate_id || button.human_gate_id,
        buttonId: latest.button_id || button.button_id,
        label: latest.label || button.label,
        replyText: "Human Gate 按钮已经处理过。",
        dbFile: paths.dbFile
      };
    }
    await updateHumanGateRecordFeedback(paths, button.human_gate_id, button.decision_status, finalFeedbackPayload, feedbackReceivedAt);
    const workflowDecision = await applyHumanGateWorkflowDecision(paths, button, feedbackReceivedAt, {
      flashcatOriginalWords: feedbackText,
      feedbackReceivedAt,
      feedbackSource: finalFeedbackPayload.source
    });
    const resume = await meetingResume(rootDir, {
      workflowRootDir: paths.root,
      meetingId: button.meeting_id || button.workflow_id,
      from: actor,
      status: button.decision_status,
      text: [
        `Human Gate button selected: ${button.label}`,
        `闪电猫原话：${feedbackText}`
      ].join("\n"),
      payload: {
        workflowId: button.workflow_id,
        humanGateId: button.human_gate_id,
        buttonId: button.button_id,
        callbackTokenPresent: Boolean(token),
        status: button.decision_status,
        role: button.button_role || "",
        flashcatOriginalWords: feedbackText,
        feedbackReceivedAt,
        source: "human_gate.feedback",
        workflowDecision
      }
    });
    let dispatch = null;
    let archiveCheckpoint = null;
    const closeoutDispatches = [];
    if (["approved", "rejected"].includes(button.decision_status)) {
      const catTailAudit = await catTailPreOrderRiskAuditDispatchSpec(paths, button, feedbackText, selectedAt);
      const nextAction = button.decision_status === "approved"
        ? "Continue the next workflow round under the selected Human Gate button boundary."
        : "Revise the plan according to the selected Human Gate rejection button and prepare a new next-action package.";
      dispatch = await safeMeetingDispatchWithRetry(rootDir, paths, catTailAudit ? {
        workflowRootDir: paths.root,
        meetingId: catTailAudit.meetingId,
        workflowId: catTailAudit.workflowId,
        traceId: `${button.workflow_id}:pre_order_risk_audit:${button.button_id}`,
        idempotencyKey: `workflow:${button.workflow_id}:pre_order_risk_audit:${button.button_id}`,
        runtime: "openclaw",
        agentId: "cat_tail",
        dispatchType: "pre_order_risk_audit",
        priority: "high",
        createdBy: actor,
        prompt: [
          "你是猫之尾 cat_tail。闪电猫已经通过 Human Gate 批准进入下单前最后风控审计。",
          `Workflow ID: ${catTailAudit.workflowId}`,
          `Human Gate ID: ${catTailAudit.humanGateId}`,
          `Trade proposal ID: ${catTailAudit.proposalId}`,
          `Pre-order risk audit ID: ${catTailAudit.preOrderRiskAuditId}`,
          `Selected option: ${catTailAudit.selectedOption}`,
          `闪电猫原话/审核意见：${feedbackText}`,
          "",
          "只执行 pre_order_risk_audit。请基于证据包、Human Gate 原话和硬性风控规则输出中文风控 paper，并生成结构化 risk_decision。",
          "risk_decision 必须包含 reviewerAgent=cat_tail、dispatchType=pre_order_risk_audit、decision、riskLimits、evidenceRefs、paperRef、humanGateId、proposalId、preOrderRiskAuditId。当前只能批准 paper execution 或拒绝。不要下单，不要向 trading_core 发送自然语言。"
        ].filter(Boolean).join("\n"),
        payload: {
          dispatchType: "pre_order_risk_audit",
          workflowId: catTailAudit.workflowId,
          meetingId: catTailAudit.meetingId,
          humanGateId: catTailAudit.humanGateId,
          buttonId: catTailAudit.buttonId,
          proposalId: catTailAudit.proposalId,
          preOrderRiskAuditId: catTailAudit.preOrderRiskAuditId,
          selectedOption: catTailAudit.selectedOption,
          selectedAt,
          selectedBy: actor,
          flashcatOriginalWords: feedbackText,
          requestPayload: catTailAudit.requestPayload,
          requestRawPayload: catTailAudit.requestRawPayload,
          buttonPayload: catTailAudit.buttonPayload
        }
      } : {
        workflowRootDir: paths.root,
        meetingId: button.meeting_id || button.workflow_id,
        workflowId: button.workflow_id,
        traceId: `${button.workflow_id}:human_gate_button:${button.button_id}`,
        idempotencyKey: `workflow:${button.workflow_id}:human_gate_button:${button.button_id}`,
        runtime: input.runtime || "openclaw",
        agentId: input.agentId || input.agent_id || "main",
        dispatchType: "human_gate_resume",
        priority: "steer",
        createdBy: actor,
        prompt: [
          `Human Gate button selected: ${button.label}`,
          `Human Gate status: ${button.decision_status}`,
          `Workflow ID: ${button.workflow_id}`,
          `Meeting ID: ${button.meeting_id}`,
          `Human Gate ID: ${button.human_gate_id}`,
          `Button ID: ${button.button_id}`,
          button.summary ? `Button summary: ${button.summary}` : "",
          button.artifact_ref ? `Artifact ref: ${button.artifact_ref}` : "",
          button.prompt ? `Selected action: ${button.prompt}` : "",
          `闪电猫原话/审核意见：${feedbackText}`,
          "",
          "You are cat-brain main. Resume the workflow from this exact button decision.",
          nextAction,
          "The selected button status is the formal Human Gate decision. Treat Flashcat's original words as binding guidance for the next workflow direction, scope, and boundaries."
        ].filter(Boolean).join("\n"),
        payload: {
          workflowId: button.workflow_id,
          meetingId: button.meeting_id,
          humanGateId: button.human_gate_id,
          buttonId: button.button_id,
          buttonLabel: button.label,
          status: button.decision_status,
          role: button.button_role || "",
          artifactRef: button.artifact_ref || "",
          summary: button.summary || "",
          selectedAt,
          selectedBy: actor,
          flashcatOriginalWords: feedbackText,
          feedbackReceivedAt,
          humanGateResume: true,
          buttonPayload: parseJsonValue(button.payload_json, {})
        }
      }, {
        source: "human_gate_button_callback",
        humanGateId: button.human_gate_id,
        buttonId: button.button_id
      });
    }
    if (workflowDecision?.archived) {
      archiveCheckpoint = await workflowCheckpoint(rootDir, {
        workflowRootDir: paths.root,
        workflowId: button.workflow_id,
        summary: `Flashcat selected Human Gate closeout button: ${button.label}. Archive the workflow as completed/closed while preserving resume state.`,
        nextActions: [
          "cat_brain main closes workflow state, confirms no pending unsafe side effects remain, and records resume boundary.",
          "cat_claw prepares final Chinese closeout report with archive id, checkpoint id, and resume instructions."
        ],
        createdBy: "cat_claw"
      });
      closeoutDispatches.push(await safeMeetingDispatchWithRetry(rootDir, paths, {
        workflowRootDir: paths.root,
        meetingId: button.meeting_id || button.workflow_id,
        workflowId: button.workflow_id,
        traceId: `${button.workflow_id}:human_gate_archive_main:${button.button_id}`,
        idempotencyKey: `workflow:${button.workflow_id}:human_gate_archive_main:${button.button_id}`,
        runtime: "openclaw",
        agentId: "main",
        dispatchType: "workflow_archive_closeout",
        priority: "steer",
        createdBy: actor,
        prompt: [
          "闪电猫点击了 Human Gate 终止/收口按钮。",
          "语义：闪电猫认为本段工作成果已完成且复核满足要求，需要归档并结束该 workflow；这不是删除，也不是不可恢复。",
          `Workflow ID: ${button.workflow_id}`,
          `Human Gate ID: ${button.human_gate_id}`,
          `Checkpoint ID: ${archiveCheckpoint?.checkpointId || ""}`,
          `闪电猫原话/审核意见：${feedbackText}`,
          "",
          "请猫之脑 main 完成必要收口：确认任务状态、证据包、receipt、outbox、side-effect ledger 和恢复边界；如果未来闪电猫要求 resume，应从该 checkpoint/workflow_id 继续。"
        ].join("\n"),
        payload: {
          workflowId: button.workflow_id,
          humanGateId: button.human_gate_id,
          checkpointId: archiveCheckpoint?.checkpointId || "",
          flashcatOriginalWords: feedbackText,
          feedbackReceivedAt,
          archived: true,
          resumeAllowed: true
        }
      }, {
        source: "human_gate_archive_closeout",
        humanGateId: button.human_gate_id,
        buttonId: button.button_id,
        targetAgent: "main"
      }));
      closeoutDispatches.push(await safeMeetingDispatchWithRetry(rootDir, paths, {
        workflowRootDir: paths.root,
        meetingId: button.meeting_id || button.workflow_id,
        workflowId: button.workflow_id,
        traceId: `${button.workflow_id}:human_gate_archive_cat_claw:${button.button_id}`,
        idempotencyKey: `workflow:${button.workflow_id}:human_gate_archive_cat_claw:${button.button_id}`,
        runtime: "openclaw",
        agentId: "cat_claw",
        dispatchType: "workflow_archive_closeout_report",
        priority: "steer",
        createdBy: actor,
        prompt: [
          "闪电猫点击了 Human Gate 终止/收口按钮。",
          "请猫爪以中文准备最终收口汇报，包含：工作流已归档、最终成果摘要、证据/receipt 指针、checkpoint id、未来 resume 方法和仍需注意的边界。",
          `Workflow ID: ${button.workflow_id}`,
          `Human Gate ID: ${button.human_gate_id}`,
          `Checkpoint ID: ${archiveCheckpoint?.checkpointId || ""}`,
          `闪电猫原话/审核意见：${feedbackText}`,
          "不要生成新的方案；只做秘书收口和恢复指针说明。"
        ].join("\n"),
        payload: {
          workflowId: button.workflow_id,
          humanGateId: button.human_gate_id,
          checkpointId: archiveCheckpoint?.checkpointId || "",
          flashcatOriginalWords: feedbackText,
          feedbackReceivedAt,
          archived: true,
          resumeAllowed: true
        }
      }, {
        source: "human_gate_archive_closeout",
        humanGateId: button.human_gate_id,
        buttonId: button.button_id,
        targetAgent: "cat_claw"
      }));
    }
    await appendWorkflowEvent(paths, {
      eventType: "human_gate.submitted",
      status: button.decision_status,
      workflowId: button.workflow_id,
      traceId: `${button.workflow_id}:human_gate:${button.button_id}`,
      humanGateId: button.human_gate_id,
      actor,
      sourceRuntime: "workflow",
      sourceAgent: actor,
      previousState: "pending",
      nextState: button.decision_status,
      idempotencyKey: `workflow_event:human_gate.submitted:${button.button_id}`,
      artifactRef: button.artifact_ref || "",
      payload: {
        meetingId: button.meeting_id,
        buttonId: button.button_id,
        buttonLabel: button.label,
        decisionStatus: button.decision_status,
        role: button.button_role || "",
        feedbackReceivedAt,
        flashcatOriginalWords: feedbackText,
        workflowDecision,
        dispatchId: dispatch?.dispatchId || "",
        archiveCheckpointId: archiveCheckpoint?.checkpointId || ""
      }
    });
    return {
      handled: true,
      status: button.decision_status,
      workflowId: button.workflow_id,
      meetingId: button.meeting_id,
      humanGateId: button.human_gate_id,
      buttonId: button.button_id,
      label: button.label,
      workflowDecision,
      archiveCheckpoint,
      resume,
      dispatch,
      closeoutDispatches,
      flashcatOriginalWords: feedbackText,
      feedbackReceivedAt,
      replyText: `已收到闪电猫原话并正式完成 Human Gate：${button.label}`,
      dbFile: paths.dbFile
    };
  }

  async function findPendingHumanGateFeedbackButton(paths, input = {}) {
    const token = normalizeHumanGateCallbackToken(input);
    if (token) {
      const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} AND status='feedback_pending' LIMIT 1;`, { json: true });
      if (rows[0]) return rows[0];
    }
    return null;
  }

  async function humanGateFeedback(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const feedbackText = humanGateFeedbackText(input);
    const rawToken = rawHumanGateCallbackToken(input);
    if (!rawToken) return { handled: true, status: "token_required", replyText: "请使用按钮提示中的完整格式提交：/hgate tawhg:<token> 闪电猫原话或审核意见。裸 /hgate 不会被接受，避免多个 Human Gate 并发时错配。" };
    if (!feedbackText) return { handled: true, status: "feedback_required", replyText: "请在 token 后输入闪电猫原话或审核意见，例如：/hgate tawhg:<token> 这里写审核意见。" };
    const button = await findPendingHumanGateFeedbackButton(paths, input);
    if (!button) return { handled: true, status: "not_found", replyText: "没有找到与该 token 对应、且正在等待闪电猫原话的 Human Gate 选择；请确认先点击了对应按钮，并使用按钮提示里的 token。" };
    return humanGateButtonCallback(rootDir, {
      ...input,
      token: button.callback_token,
      feedbackText,
      actor: input.actor || input.senderId || input.sender_id || input.from || button.selected_by || "flashcat",
      sourceSystem: input.sourceSystem || input.source_system || "human_gate_feedback"
    });
  }

  async function humanGateResume(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const token = normalizeHumanGateCallbackToken(input);
    const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
    const buttonId = String(input.buttonId || input.button_id || "").trim();
    const feedbackText = humanGateFeedbackText(input);
    if (!token) {
      throw new Error("human_gate.resume is button-first only; callbackToken is required");
    }
    if (!feedbackText) {
      throw new Error("human_gate.resume requires Flashcat original words or review feedback");
    }
    const rows = await sqlite(paths.dbFile, `SELECT * FROM human_gate_buttons WHERE callback_token=${sqlValue(token)} LIMIT 1;`, { json: true });
    const button = rows[0];
    if (!button) throw new Error("human_gate.resume callback token was not found");
    const resolvedHumanGateId = humanGateId || String(button.human_gate_id || "").trim();
    const resolvedButtonId = buttonId || String(button.button_id || "").trim();
    if (!resolvedHumanGateId || !resolvedButtonId) {
      throw new Error("human_gate.resume is button-first only; humanGateId and buttonId could not be resolved from the callback token");
    }
    if (String(button.human_gate_id || "") !== resolvedHumanGateId || String(button.button_id || "") !== resolvedButtonId) {
      throw new Error("human_gate.resume token does not match the supplied humanGateId/buttonId");
    }
    return humanGateButtonCallback(rootDir, {
      ...input,
      workflowRootDir: paths.root,
      token,
      humanGateId: resolvedHumanGateId,
      buttonId: resolvedButtonId,
      feedbackText,
      sourceSystem: input.sourceSystem || input.source_system || "human_gate.resume"
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
    humanGateButtonCallback,
    humanGateFeedback,
    humanGateInbox,
    humanGateRequest,
    humanGateResume,
    humanGateWebAppReview,
    humanGateWebAppSubmit,
    workflowHumanGateRecord
  };
}
