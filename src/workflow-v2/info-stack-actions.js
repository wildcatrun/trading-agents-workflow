import { workflowPaths } from "../workflow/paths.js";
import {
  boolOption,
  firstText,
  parseJsonValue,
  safeId,
  textHash
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";
import { workflowV2JsonObject } from "./helpers.js";
import {
  workflowV2InfoStackItemFromRow as workflowV2InfoStackItemFromRowCore,
  workflowV2InfoStackPreview as workflowV2InfoStackPreviewCore,
  workflowV2NotificationPreview as workflowV2NotificationPreviewCore
} from "./info-stack.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 info-stack action dependency missing: ${name}`);
  return value;
}

export function createWorkflowV2InfoStackActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeOptionalAgentId = requireContextFunction(context, "normalizeOptionalAgentId");
  const nowIso = requireContextFunction(context, "nowIso");

function workflowV2InfoStackDeps() {
  return {
    boolOption,
    firstText,
    normalizeOptionalAgentId,
    parseJsonValue,
    safeId,
    textHash,
    workflowPaths
  };
}

async function workflowV2NotificationPreview(rootDir, input = {}) {
  return workflowV2NotificationPreviewCore(rootDir, input, workflowV2InfoStackDeps());
}

async function workflowV2InfoStackPreview(rootDir, input = {}) {
  return workflowV2InfoStackPreviewCore(rootDir, input, workflowV2InfoStackDeps());
}

async function workflowV2InfoStackRecord(rootDir, input = {}) {
  const preview = await workflowV2InfoStackPreview(rootDir, input);
  if (!preview.valid) throw new Error(`workflow v2 info stack item is invalid: ${preview.errors.map((item) => item.code).join(",")}`);
  const paths = await ensureWorkflowLayout(rootDir, input);
  const now = nowIso();
  const createdBy = firstText(input.createdBy, input.created_by, input.callerAgent, input.caller_agent, "main");
  const item = preview.infoItem;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_info_items(info_id, workflow_id, plan_id, node_id, worker_run_id, classification, content_storage, content_ref, content_hash, summary, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(item.infoId)}, ${sqlValue(item.workflowId)}, ${sqlValue(item.planId)}, ${sqlValue(item.nodeId)}, ${sqlValue(item.workerRunId)}, ${sqlValue(item.classification)}, ${sqlValue(item.contentStorage)}, ${sqlValue(item.contentRef)}, ${sqlValue(item.contentHash)}, ${sqlValue(item.summary)}, ${sqlValue(JSON.stringify(item.payload))}, ${sqlValue(createdBy)}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(info_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  plan_id=excluded.plan_id,
  node_id=excluded.node_id,
  worker_run_id=excluded.worker_run_id,
  classification=excluded.classification,
  content_storage=excluded.content_storage,
  content_ref=excluded.content_ref,
  content_hash=excluded.content_hash,
  summary=excluded.summary,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  if (preview.inboxItem) {
    const inbox = preview.inboxItem;
    await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_inbox_items(inbox_item_id, info_id, workflow_id, recipient_kind, recipient_id, status, notification_id, payload_json, created_at, updated_at)
VALUES (${sqlValue(inbox.inboxItemId)}, ${sqlValue(inbox.infoId)}, ${sqlValue(inbox.workflowId)}, ${sqlValue(inbox.recipientKind)}, ${sqlValue(inbox.recipientId)}, ${sqlValue(inbox.status)}, ${sqlValue(preview.notification.notificationId)}, ${sqlValue(JSON.stringify(inbox.payload))}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(inbox_item_id) DO UPDATE SET
  info_id=excluded.info_id,
  workflow_id=excluded.workflow_id,
  recipient_kind=excluded.recipient_kind,
  recipient_id=excluded.recipient_id,
  status=excluded.status,
  notification_id=excluded.notification_id,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  }
  if (preview.accessGrant) {
    const grant = preview.accessGrant;
    await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_access_grants(grant_id, info_id, inbox_item_id, principal_kind, principal_id, access_mode, token_ref, expires_at, status, payload_json, created_at, updated_at)
VALUES (${sqlValue(grant.grantId)}, ${sqlValue(grant.infoId)}, ${sqlValue(grant.inboxItemId)}, ${sqlValue(grant.principalKind)}, ${sqlValue(grant.principalId)}, ${sqlValue(grant.accessMode)}, ${sqlValue(grant.tokenRef)}, ${sqlValue(grant.expiresAt)}, ${sqlValue(grant.status)}, '{}', ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(grant_id) DO UPDATE SET
  info_id=excluded.info_id,
  inbox_item_id=excluded.inbox_item_id,
  principal_kind=excluded.principal_kind,
  principal_id=excluded.principal_id,
  access_mode=excluded.access_mode,
  token_ref=excluded.token_ref,
  expires_at=excluded.expires_at,
  status=excluded.status,
  updated_at=excluded.updated_at;`);
  }
  const notification = preview.notification;
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_notifications(notification_id, workflow_id, info_id, inbox_item_id, message_flow_id, channel, target_agent, payload_mode, status, payload_json, created_at, updated_at)
VALUES (${sqlValue(notification.notificationId)}, ${sqlValue(item.workflowId)}, ${sqlValue(notification.infoId)}, ${sqlValue(notification.inboxItemId)}, ${sqlValue(notification.messageFlowId)}, ${sqlValue(notification.channel)}, ${sqlValue(notification.targetAgent)}, ${sqlValue(notification.payloadMode)}, ${sqlValue(notification.status)}, ${sqlValue(JSON.stringify(notification.payload))}, ${sqlValue(now)}, ${sqlValue(now)})
ON CONFLICT(notification_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  info_id=excluded.info_id,
  inbox_item_id=excluded.inbox_item_id,
  message_flow_id=excluded.message_flow_id,
  channel=excluded.channel,
  target_agent=excluded.target_agent,
  payload_mode=excluded.payload_mode,
  status=excluded.status,
  payload_json=excluded.payload_json,
  updated_at=excluded.updated_at;`);
  return { ...preview, operation: "workflow.v2.info_stack.record", dryRun: false, previewOnly: false, dbFile: paths.dbFile };
}

function workflowV2InfoStackItemFromRow(row = {}, includeInlineContent = false) {
  return workflowV2InfoStackItemFromRowCore(row, includeInlineContent, workflowV2InfoStackDeps());
}

async function workflowV2InfoStackRead(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const infoId = firstText(input.infoId, input.info_id);
  const inboxItemId = firstText(input.inboxItemId, input.inbox_item_id);
  const grantId = firstText(input.grantId, input.grant_id);
  const allowDirectInfoRead = boolOption(input.allowDirectInfoRead ?? input.allow_direct_info_read, false);
  const principalKind = firstText(input.principalKind, input.principal_kind, input.readerKind, input.reader_kind, input.recipientKind, input.recipient_kind, "agent");
  const principalId = firstText(input.principalId, input.principal_id, input.readerId, input.reader_id, input.recipientId, input.recipient_id, input.recipientAgent, input.recipient_agent, input.callerAgent, input.caller_agent);
  if (!grantId && !inboxItemId && !allowDirectInfoRead) {
    throw new Error("workflow v2 info read requires inboxItemId or grantId");
  }
  let rows = [];
  if (grantId) {
    rows = await sqlite(paths.dbFile, `
SELECT i.*, inbox.inbox_item_id AS matched_inbox_item_id, g.grant_id AS matched_grant_id, g.principal_kind, g.principal_id, g.status AS grant_status, g.expires_at AS grant_expires_at
FROM workflow_v2_access_grants g
JOIN workflow_v2_info_items i ON i.info_id=g.info_id
LEFT JOIN workflow_v2_inbox_items inbox ON inbox.inbox_item_id=g.inbox_item_id
WHERE g.grant_id=${sqlValue(grantId)}
LIMIT 1;`, { json: true });
  } else if (inboxItemId) {
    rows = await sqlite(paths.dbFile, `
SELECT i.*, inbox.inbox_item_id AS matched_inbox_item_id, '' AS matched_grant_id, inbox.recipient_kind AS principal_kind, inbox.recipient_id AS principal_id, inbox.status AS inbox_status
FROM workflow_v2_inbox_items inbox
JOIN workflow_v2_info_items i ON i.info_id=inbox.info_id
WHERE inbox.inbox_item_id=${sqlValue(inboxItemId)}
LIMIT 1;`, { json: true });
  } else if (infoId && allowDirectInfoRead) {
    rows = await sqlite(paths.dbFile, `
SELECT *, '' AS matched_inbox_item_id, '' AS matched_grant_id
FROM workflow_v2_info_items
WHERE info_id=${sqlValue(infoId)}
LIMIT 1;`, { json: true });
  }
  const row = rows[0];
  if (!row) throw new Error("workflow v2 info item not found or unreadable");
  if (infoId && row.info_id !== infoId) throw new Error("workflow v2 info id mismatch");
  if (grantId) {
    if (row.grant_status !== "active") throw new Error(`workflow v2 access grant is not active: ${row.grant_status || "unknown"}`);
    if (row.grant_expires_at && new Date(row.grant_expires_at).getTime() < Date.now()) throw new Error("workflow v2 access grant expired");
  }
  if (principalId && row.principal_id && row.principal_id !== principalId) throw new Error("workflow v2 info read principal mismatch");
  if (principalKind && row.principal_kind && row.principal_kind !== principalKind) throw new Error("workflow v2 info read principal kind mismatch");
  const item = workflowV2InfoStackItemFromRow(row, boolOption(input.includeInlineContent ?? input.include_inline_content, false));
  return {
    operation: "workflow.v2.info_stack.read",
    readOnly: true,
    item,
    access: {
      inboxItemId: row.matched_inbox_item_id || inboxItemId || "",
      grantId: row.matched_grant_id || grantId || "",
      principalKind: row.principal_kind || principalKind,
      principalId: row.principal_id || principalId
    },
    receiptRecordAction: "workflow.v2.read_receipt.record",
    dbFile: paths.dbFile
  };
}

async function workflowV2ReadReceiptRecord(rootDir, input = {}) {
  const paths = await ensureWorkflowLayout(rootDir, input);
  const infoId = firstText(input.infoId, input.info_id);
  if (!infoId) throw new Error("workflow v2 read receipt requires infoId");
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const receipt = {
    receiptId: firstText(input.receiptId, input.receipt_id) || safeId("v2-read"),
    workflowId,
    infoId,
    inboxItemId: firstText(input.inboxItemId, input.inbox_item_id),
    grantId: firstText(input.grantId, input.grant_id),
    readerKind: firstText(input.readerKind, input.reader_kind, input.principalKind, input.principal_kind, "agent"),
    readerId: firstText(input.readerId, input.reader_id, input.principalId, input.principal_id, input.callerAgent, input.caller_agent),
    status: firstText(input.status, "read"),
    payload: workflowV2JsonObject(input.payload, {}),
    createdAt: nowIso()
  };
  if (!receipt.inboxItemId && !receipt.grantId) throw new Error("workflow v2 read receipt requires inboxItemId or grantId");
  await sqlite(paths.dbFile, `
INSERT INTO workflow_v2_read_receipts(receipt_id, workflow_id, info_id, inbox_item_id, grant_id, reader_kind, reader_id, status, payload_json, created_at)
VALUES (${sqlValue(receipt.receiptId)}, ${sqlValue(receipt.workflowId)}, ${sqlValue(receipt.infoId)}, ${sqlValue(receipt.inboxItemId)}, ${sqlValue(receipt.grantId)}, ${sqlValue(receipt.readerKind)}, ${sqlValue(receipt.readerId)}, ${sqlValue(receipt.status)}, ${sqlValue(JSON.stringify(receipt.payload))}, ${sqlValue(receipt.createdAt)})
ON CONFLICT(receipt_id) DO UPDATE SET
  workflow_id=excluded.workflow_id,
  info_id=excluded.info_id,
  inbox_item_id=excluded.inbox_item_id,
  grant_id=excluded.grant_id,
  reader_kind=excluded.reader_kind,
  reader_id=excluded.reader_id,
  status=excluded.status,
  payload_json=excluded.payload_json;`);
  return { operation: "workflow.v2.read_receipt.record", receipt, dbFile: paths.dbFile };
}

  return {
    workflowV2NotificationPreview,
    workflowV2InfoStackPreview,
    workflowV2InfoStackRecord,
    workflowV2InfoStackRead,
    workflowV2ReadReceiptRecord
  };
}
