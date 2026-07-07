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
  "human_gate.web_app_review": "humanGateWebAppReview",
  "human_gate.review_form": "humanGateWebAppReview",
  "human_gate.web_app_submit": "humanGateWebAppSubmit",
  "human_gate.submit_form": "humanGateWebAppSubmit",
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
  const humanGateArtifactRef = requireContextFunction(context, "humanGateArtifactRef");
  const humanGateBody = requireContextFunction(context, "humanGateBody");
  const humanGateButtonCallback = requireContextFunction(context, "humanGateButtonCallback");
  const humanGateButtonDisplayLabel = requireContextFunction(context, "humanGateButtonDisplayLabel");
  const humanGateButtonFromRow = requireContextFunction(context, "humanGateButtonFromRow");
  const humanGateButtonRowByToken = requireContextFunction(context, "humanGateButtonRowByToken");
  const humanGateButtonTelegramStyle = requireContextFunction(context, "humanGateButtonTelegramStyle");
  const humanGateFeedbackText = requireContextFunction(context, "humanGateFeedbackText");
  const humanGateRecordById = requireContextFunction(context, "humanGateRecordById");
  const humanGateRecordExpiry = requireContextFunction(context, "humanGateRecordExpiry");
  const humanGateSummary = requireContextFunction(context, "humanGateSummary");
  const humanGateWebAppConfig = requireContextFunction(context, "humanGateWebAppConfig");
  const normalizeHumanGateCallbackToken = requireContextFunction(context, "normalizeHumanGateCallbackToken");
  const nowIso = requireContextFunction(context, "nowIso");
  const rawHumanGateCallbackToken = requireContextFunction(context, "rawHumanGateCallbackToken");
  const relativeTo = requireContextFunction(context, "relativeTo");
  const renderHumanGateInboxHtml = requireContextFunction(context, "renderHumanGateInboxHtml");
  const renderHumanGateTelegramSummary = requireContextFunction(context, "renderHumanGateTelegramSummary");
  const protocolRecord = requireContextFunction(context, "protocolRecord");
  const resolveTelegramBotToken = requireContextFunction(context, "resolveTelegramBotToken");
  const riskSummaryFor = requireContextFunction(context, "riskSummaryFor");
  const safeId = requireContextFunction(context, "safeId");
  const verifyTelegramWebAppInitData = requireContextFunction(context, "verifyTelegramWebAppInitData");
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

  async function humanGateWebAppReview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const button = await humanGateButtonRowByToken(paths, input);
    if (!button) return { handled: true, status: "not_found", token: normalizeHumanGateCallbackToken(input), replyText: "Human Gate 按钮已失效或不存在。", dbFile: paths.dbFile };
    const record = await humanGateRecordById(paths, button.human_gate_id) || {};
    const expiry = humanGateRecordExpiry(record);
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
    humanGateFeedback,
    humanGateInbox,
    humanGateResume,
    humanGateWebAppReview,
    humanGateWebAppSubmit,
    workflowHumanGateRecord
  };
}
