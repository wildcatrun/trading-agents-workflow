import {
  WORKFLOW_V2_CONTENT_STORAGES,
  WORKFLOW_V2_INFO_CLASSIFICATIONS,
  WORKFLOW_V2_NOTIFICATION_CHANNELS,
  WORKFLOW_V2_NOTIFICATION_PAYLOAD_MODES,
  WORKFLOW_V2_SENSITIVE_CLASSIFICATIONS
} from "./constants.js";
import {
  workflowV2JsonObject,
  workflowV2NormalizeEnum,
  workflowV2ValidationError
} from "./helpers.js";

function requireDep(deps, name) {
  const value = deps?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 info-stack dependency missing: ${name}`);
  return value;
}

export async function workflowV2NotificationPreview(rootDir, input = {}, deps = {}) {
  const workflowPaths = requireDep(deps, "workflowPaths");
  const firstText = requireDep(deps, "firstText");
  const safeId = requireDep(deps, "safeId");
  const normalizeOptionalAgentId = requireDep(deps, "normalizeOptionalAgentId");
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const channel = workflowV2NormalizeEnum(input.channel, WORKFLOW_V2_NOTIFICATION_CHANNELS, "message_flow");
  const payloadMode = workflowV2NormalizeEnum(input.payloadMode || input.payload_mode, WORKFLOW_V2_NOTIFICATION_PAYLOAD_MODES, "pointer_only");
  const status = String(input.status || "prepared").trim().toLowerCase();
  const infoId = String(input.infoId || input.info_id || "").trim();
  const inboxItemId = String(input.inboxItemId || input.inbox_item_id || "").trim();
  const messageFlowId = String(input.messageFlowId || input.message_flow_id || input.flowId || input.flow_id || "").trim();
  const notificationBody = firstText(input.notificationBody, input.notification_body, input.notificationText, input.notification_text);
  if (payloadMode === "pointer_only" && notificationBody) {
    errors.push(workflowV2ValidationError("pointer_notification_body_disallowed", "pointer_only notification may not carry full body text"));
  }
  if (payloadMode === "legacy_inline" && !firstText(input.legacyInlineReason, input.legacy_inline_reason)) {
    errors.push(workflowV2ValidationError("legacy_inline_reason_required", "legacy_inline notification requires legacyInlineReason"));
  }
  if (channel === "message_flow" && ["sent", "delivered", "failed", "telegram_sent", "telegram_failed"].includes(status) && !messageFlowId) {
    errors.push(workflowV2ValidationError("message_flow_id_required_for_terminal_notification", "sent/delivered message_flow notification requires messageFlowId"));
  }
  const notificationId = String(input.notificationId || input.notification_id || safeId("v2-notify")).trim();
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const payload = {
    schemaVersion: 1,
    payloadMode,
    workflowId,
    infoId,
    inboxItemId,
    messageFlowId,
    title: firstText(input.title, input.subject),
    summary: firstText(input.summary),
    readAction: "workflow.v2.info_stack.read",
    expiresAt: firstText(input.expiresAt, input.expires_at),
    traceId: firstText(input.traceId, input.trace_id),
    legacyInlineReason: firstText(input.legacyInlineReason, input.legacy_inline_reason)
  };
  return {
    operation: "workflow.v2.notification.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    notification: {
      notificationId,
      workflowId,
      infoId,
      inboxItemId,
      messageFlowId,
      channel,
      targetAgent: normalizeOptionalAgentId(firstText(input.targetAgent, input.target_agent, input.recipientAgent, input.recipient_agent)),
      payloadMode,
      status,
      payload
    },
    dbFile: paths.dbFile,
    writes: []
  };
}

export async function workflowV2InfoStackPreview(rootDir, input = {}, deps = {}) {
  const workflowPaths = requireDep(deps, "workflowPaths");
  const firstText = requireDep(deps, "firstText");
  const safeId = requireDep(deps, "safeId");
  const boolOption = requireDep(deps, "boolOption");
  const textHash = requireDep(deps, "textHash");
  const paths = workflowPaths(rootDir, input);
  const errors = [];
  const workflowId = firstText(input.workflowId, input.workflow_id) || safeId("workflow-v2");
  const planId = firstText(input.planId, input.plan_id);
  const nodeId = firstText(input.nodeId, input.node_id);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id);
  const infoId = firstText(input.infoId, input.info_id) || safeId("v2-info");
  const classification = workflowV2NormalizeEnum(input.classification, WORKFLOW_V2_INFO_CLASSIFICATIONS, "internal");
  const bodyText = firstText(input.bodyText, input.body_text, input.contentText, input.content_text, input.text);
  const explicitStorage = firstText(input.contentStorage, input.content_storage);
  const contentStorage = workflowV2NormalizeEnum(explicitStorage || "artifact_ref", WORKFLOW_V2_CONTENT_STORAGES, "artifact_ref");
  const inlineReason = firstText(input.inlineReason, input.inline_reason, input.legacyInlineReason, input.legacy_inline_reason);
  const allowInlineContent = boolOption(input.allowInlineContent ?? input.allow_inline_content, false);
  const contentRef = firstText(input.contentRef, input.content_ref, input.artifactRef, input.artifact_ref, input.externalRef, input.external_ref);
  if (WORKFLOW_V2_SENSITIVE_CLASSIFICATIONS.has(classification) && (contentStorage === "inline" || bodyText)) {
    errors.push(workflowV2ValidationError("sensitive_inline_body_disallowed", "sensitive/secret/trading info must be stored by artifact_ref/external_ref/redacted pointer, not inline body"));
  }
  if (contentStorage === "inline" && (!allowInlineContent || !inlineReason)) {
    errors.push(workflowV2ValidationError("inline_content_requires_explicit_reason", "inline info storage requires allowInlineContent=true and inlineReason"));
  }
  if (contentStorage !== "inline" && !contentRef && contentStorage !== "redacted") {
    errors.push(workflowV2ValidationError("content_ref_required", `${contentStorage} info requires contentRef/artifactRef/externalRef`));
  }
  const recipientKind = firstText(input.recipientKind, input.recipient_kind, "agent");
  const recipientId = firstText(input.recipientId, input.recipient_id, input.recipientAgent, input.recipient_agent, input.targetAgent, input.target_agent);
  const inboxItemId = recipientId ? (firstText(input.inboxItemId, input.inbox_item_id) || safeId("v2-inbox")) : "";
  const grantId = recipientId ? (firstText(input.grantId, input.grant_id) || safeId("v2-grant")) : "";
  const notificationPreview = await workflowV2NotificationPreview(rootDir, {
    ...input,
    workflowId,
    infoId,
    inboxItemId,
    targetAgent: recipientKind === "agent" ? recipientId : input.targetAgent,
    payloadMode: input.payloadMode || input.payload_mode || "pointer_only"
  }, deps);
  errors.push(...notificationPreview.errors);
  const contentHash = contentStorage === "inline" ? textHash(bodyText) : textHash(`${contentStorage}:${contentRef}`);
  return {
    operation: "workflow.v2.info_stack.preview",
    dryRun: true,
    previewOnly: true,
    valid: errors.length === 0,
    errors,
    infoItem: {
      infoId,
      workflowId,
      planId,
      nodeId,
      workerRunId,
      classification,
      contentStorage,
      contentRef,
      contentHash,
      summary: firstText(input.summary),
      payload: {
        ...workflowV2JsonObject(input.payload, {}),
        ...(contentStorage === "inline" ? { inlineReason } : {}),
        ...(contentStorage === "inline" ? { content: bodyText } : {})
      }
    },
    inboxItem: inboxItemId ? {
      inboxItemId,
      infoId,
      workflowId,
      recipientKind,
      recipientId,
      status: "pending",
      payload: workflowV2JsonObject(input.inboxPayload || input.inbox_payload, {})
    } : null,
    accessGrant: grantId ? {
      grantId,
      infoId,
      inboxItemId,
      principalKind: recipientKind,
      principalId: recipientId,
      accessMode: firstText(input.accessMode, input.access_mode, "read"),
      tokenRef: firstText(input.tokenRef, input.token_ref),
      expiresAt: firstText(input.expiresAt, input.expires_at),
      status: "active"
    } : null,
    notification: notificationPreview.notification,
    dbFile: paths.dbFile,
    writes: []
  };
}

export function workflowV2InfoStackItemFromRow(row = {}, includeInlineContent = false, deps = {}) {
  const parseJsonValue = requireDep(deps, "parseJsonValue");
  if (!row.info_id) return null;
  const payload = parseJsonValue(row.payload_json, {});
  const classification = row.classification || "internal";
  const sensitive = WORKFLOW_V2_SENSITIVE_CLASSIFICATIONS.has(classification);
  const item = {
    infoId: row.info_id,
    workflowId: row.workflow_id || "",
    planId: row.plan_id || "",
    nodeId: row.node_id || "",
    workerRunId: row.worker_run_id || "",
    classification,
    contentStorage: row.content_storage || "artifact_ref",
    contentRef: row.content_ref || "",
    contentHash: row.content_hash || "",
    summary: row.summary || "",
    payload: {
      ...payload,
      ...(payload.content ? { content: "[not returned by default]" } : {})
    },
    inlineContentReturned: false
  };
  if (includeInlineContent && item.contentStorage === "inline" && !sensitive) {
    item.payload = payload;
    item.inlineContentReturned = Boolean(payload.content);
  }
  return item;
}
