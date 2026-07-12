import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";

function nowIso() {
  return new Date().toISOString();
}

export async function workflowV2RestoreManagerReviewRow(paths, row = null, reviewId = "") {
  const id = row?.review_id || reviewId;
  if (!id) return;
  if (!row) {
    await sqlite(paths.dbFile, `DELETE FROM workflow_v2_manager_reviews WHERE review_id=${sqlValue(id)};`);
    return;
  }
  await sqlite(paths.dbFile, `
UPDATE workflow_v2_manager_reviews
SET workflow_id=${sqlValue(row.workflow_id || "")},
    plan_id=${sqlValue(row.plan_id || "")},
    node_id=${sqlValue(row.node_id || "")},
    worker_run_id=${sqlValue(row.worker_run_id || "")},
    reviewer_agent=${sqlValue(row.reviewer_agent || "")},
    decision=${sqlValue(row.decision || "")},
    summary=${sqlValue(row.summary || "")},
    findings_json=${sqlValue(row.findings_json || "[]")},
    artifact_refs_json=${sqlValue(row.artifact_refs_json || "[]")},
    receipt_refs_json=${sqlValue(row.receipt_refs_json || "[]")},
    blocker_json=${sqlValue(row.blocker_json || "{}")},
    payload_json=${sqlValue(row.payload_json || "{}")},
    created_at=${sqlValue(row.created_at || nowIso())}
WHERE review_id=${sqlValue(id)};`);
}
