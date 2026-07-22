import {
  firstText
} from "../workflow/json.js";
import {
  fileExistsSync
} from "../workflow/paths.js";
import {
  sqlValue,
  sqlite
} from "../workflow/sqlite.js";

export async function workflowV2ProtocolAuditRowById(paths, auditId) {
  if (!auditId || !fileExistsSync(paths.dbFile)) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_protocol_audits
WHERE audit_id=${sqlValue(auditId)}
LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export async function workflowV2HumanGatePackageRow(paths, input = {}) {
  if (!fileExistsSync(paths.dbFile)) return null;
  const packageId = firstText(input.packageId, input.package_id, input.humanGatePackageId, input.human_gate_package_id);
  if (packageId) {
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_human_gate_packages
WHERE package_id=${sqlValue(packageId)}
LIMIT 1;`, { json: true });
    return rows[0] || null;
  }
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  const sourceProtocolAuditId = firstText(input.sourceSecretaryAuditId, input.source_secretary_audit_id, input.secretaryAuditId, input.secretary_audit_id, input.sourceProtocolAuditId, input.source_protocol_audit_id, input.protocolAuditId, input.protocol_audit_id);
  const filters = [];
  if (workflowId) filters.push(`workflow_id=${sqlValue(workflowId)}`);
  if (planId) filters.push(`plan_id=${sqlValue(planId)}`);
  if (sourceProtocolAuditId) filters.push(`source_protocol_audit_id=${sqlValue(sourceProtocolAuditId)}`);
  if (!filters.length) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT *
FROM workflow_v2_human_gate_packages
WHERE ${filters.join(" AND ")}
ORDER BY updated_at DESC, created_at DESC
LIMIT 1;`, { json: true });
  return rows[0] || null;
}
