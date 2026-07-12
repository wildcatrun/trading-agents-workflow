import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";

export async function workflowV2InfoStackExistingItem(dbFile, infoId = "") {
  if (!infoId) return null;
  const rows = await sqlite(dbFile, `
SELECT info_id, workflow_id, worker_run_id
FROM workflow_v2_info_items
WHERE info_id=${sqlValue(infoId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function workflowV2CleanupInfoStackItem(dbFile, infoId = "") {
  if (!infoId) return;
  await sqlite(dbFile, `
DELETE FROM workflow_v2_read_receipts WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_notifications WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_access_grants WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_inbox_items WHERE info_id=${sqlValue(infoId)};
DELETE FROM workflow_v2_info_items WHERE info_id=${sqlValue(infoId)};`);
}
