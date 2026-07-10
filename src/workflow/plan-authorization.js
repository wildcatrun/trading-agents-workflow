import {
  firstText,
  parseJsonValue
} from "./json.js";
import {
  sqlValue,
  sqlite
} from "./sqlite.js";

export const APPROVED_TEMPLATE_VERSION_STATUSES = new Set(["active", "default"]);
export const BLOCKED_WORKFLOW_V2_PLAN_STATES = new Set(["draft", "blocked", "terminated", "cancelled"]);
export const HUMAN_GATE_WORKFLOW_ID_KEYS = new Set(["workflowid", "sourceworkflowid", "targetworkflowid"]);
export const HUMAN_GATE_PLAN_ID_KEYS = new Set(["planid", "sourceplanid", "targetplanid"]);

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function tableExists(dbFile, tableName) {
  const rows = await sqlite(dbFile, `
SELECT name
FROM sqlite_master
WHERE type='table' AND name=${sqlValue(tableName)}
LIMIT 1;`, { json: true });
  return Boolean(rows[0]);
}

export function normalizedReferenceKey(key = "") {
  return String(key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function humanGateJsonReferenceClause(referenceId = "", normalizedKeys = new Set()) {
  const ref = String(referenceId || "").trim();
  if (!ref) return "";
  const keyValues = [...normalizedKeys].map((key) => sqlValue(key)).join(", ");
  return `EXISTS (
    SELECT 1
    FROM json_tree(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END) AS payload_ref
    WHERE payload_ref.key IS NOT NULL
      AND lower(replace(replace(replace(replace(replace(replace(CAST(payload_ref.key AS TEXT), '_', ''), '-', ''), '.', ''), ' ', ''), ':', ''), '/', '')) IN (${keyValues})
      AND CAST(payload_ref.value AS TEXT)=${sqlValue(ref)}
  )`;
}

export function humanGatePayloadReferencesPlan(payload = {}, workflowId = "", planId = "") {
  if (Array.isArray(payload)) {
    return payload.some((item) => humanGatePayloadReferencesPlan(item, workflowId, planId));
  }
  if (!payload || typeof payload !== "object") return false;
  const expectedWorkflowId = String(workflowId || "").trim();
  const expectedPlanId = String(planId || "").trim();
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = normalizedReferenceKey(key);
    if (expectedPlanId) {
      if (HUMAN_GATE_PLAN_ID_KEYS.has(normalizedKey) && String(value || "").trim() === expectedPlanId) return true;
    } else if (expectedWorkflowId && HUMAN_GATE_WORKFLOW_ID_KEYS.has(normalizedKey) && String(value || "").trim() === expectedWorkflowId) {
      return true;
    }
    if (value && typeof value === "object" && humanGatePayloadReferencesPlan(value, workflowId, planId)) return true;
  }
  return false;
}

function humanGateRowReferencesPlan(row = {}, workflowId = "", planId = "") {
  const parentObjectId = String(row.parent_object_id || "").trim();
  const expectedWorkflowId = String(workflowId || "").trim();
  const expectedPlanId = String(planId || "").trim();
  if (expectedPlanId) {
    if (parentObjectId === expectedPlanId) return true;
  } else if (expectedWorkflowId && parentObjectId === expectedWorkflowId) {
    return true;
  }
  const payload = parseJsonValue(row.payload_json, {});
  return humanGatePayloadReferencesPlan(payload, expectedWorkflowId, expectedPlanId);
}

export function workflowPlanStateAllowsExecution(row = {}) {
  return !BLOCKED_WORKFLOW_V2_PLAN_STATES.has(String(row.workflow_state || "").trim().toLowerCase())
    && !BLOCKED_WORKFLOW_V2_PLAN_STATES.has(String(row.status || "").trim().toLowerCase());
}

export function workflowScheduleTemplateRequest(input = {}, payload = {}, existingPayload = {}) {
  const template = objectValue(
    input.template
    || input.workflowTemplate
    || input.workflow_template
    || payload.template
    || payload.workflowTemplate
    || payload.workflow_template
    || payload.productionTemplate
    || payload.production_template
    || existingPayload.productionTemplate
    || existingPayload.production_template
  );
  const templateId = firstText(
    input.templateId,
    input.template_id,
    input.workflowTemplateId,
    input.workflow_template_id,
    template.templateId,
    template.template_id,
    payload.templateId,
    payload.template_id,
    payload.workflowTemplateId,
    payload.workflow_template_id,
    existingPayload.templateId,
    existingPayload.template_id
  );
  const versionText = firstText(
    input.templateVersion,
    input.template_version,
    input.workflowTemplateVersion,
    input.workflow_template_version,
    template.version,
    template.templateVersion,
    template.template_version,
    payload.templateVersion,
    payload.template_version,
    payload.workflowTemplateVersion,
    payload.workflow_template_version,
    existingPayload.templateVersion,
    existingPayload.template_version
  );
  const version = versionText ? Number(versionText) : 0;
  return {
    templateId,
    version: Number.isInteger(version) && version > 0 ? version : 0
  };
}

export async function approvedTemplateScheduleRef(paths, input = {}, payload = {}, existingPayload = {}) {
  const request = workflowScheduleTemplateRequest(input, payload, existingPayload);
  if (!request.templateId) return null;
  const specsReady = await tableExists(paths.dbFile, "workflow_v2_template_specs");
  const versionsReady = await tableExists(paths.dbFile, "workflow_v2_template_versions");
  if (!specsReady || !versionsReady) throw new Error("workflow template registry is not initialized");
  const familyRows = await sqlite(paths.dbFile, `
SELECT template_id, family_status, default_version, active_version
FROM workflow_v2_template_specs
WHERE template_id=${sqlValue(request.templateId)}
LIMIT 1;`, { json: true });
  const family = familyRows[0];
  if (!family) throw new Error(`approved workflow template not found: ${request.templateId}`);
  const familyStatus = String(family.family_status || "").trim().toLowerCase();
  if (familyStatus !== "active") {
    throw new Error(`workflow template family is not active: ${request.templateId} status=${family.family_status || ""}`);
  }
  const defaultVersion = Number(family.default_version || 0);
  const activeVersion = Number(family.active_version || 0);
  const version = request.version || defaultVersion || activeVersion;
  if (!version) throw new Error(`workflow template has no active/default version: ${request.templateId}`);
  if (![defaultVersion, activeVersion].includes(version)) {
    throw new Error(`workflow template version is not the active/default version: ${request.templateId} v${version}`);
  }
  const versionRows = await sqlite(paths.dbFile, `
SELECT template_id, version, status, artifact_ref, artifact_hash
FROM workflow_v2_template_versions
WHERE template_id=${sqlValue(request.templateId)}
  AND version=${sqlValue(version)}
LIMIT 1;`, { json: true });
  const row = versionRows[0];
  if (!row) throw new Error(`workflow template version not found: ${request.templateId} v${version}`);
  const status = String(row.status || "").trim().toLowerCase();
  if (!APPROVED_TEMPLATE_VERSION_STATUSES.has(status)) {
    throw new Error(`workflow template version is not approved for production scheduling: ${request.templateId} v${version} status=${status}`);
  }
  return {
    templateId: row.template_id,
    version: Number(row.version || version),
    status,
    artifactRef: row.artifact_ref || "",
    artifactHash: row.artifact_hash || ""
  };
}

export function workflowSchedulePlanRequest(input = {}, payload = {}, existingPayload = {}) {
  const plan = objectValue(
    input.plan
    || input.workflowPlan
    || input.workflow_plan
    || payload.plan
    || payload.workflowPlan
    || payload.workflow_plan
    || payload.productionPlan
    || payload.production_plan
    || existingPayload.productionPlan
    || existingPayload.production_plan
  );
  return {
    workflowId: firstText(input.workflowId, input.workflow_id, plan.workflowId, plan.workflow_id, payload.workflowId, payload.workflow_id, existingPayload.workflowId, existingPayload.workflow_id),
    planId: firstText(input.planId, input.plan_id, plan.planId, plan.plan_id, payload.planId, payload.plan_id, existingPayload.planId, existingPayload.plan_id),
    humanGateId: firstText(input.humanGateId, input.human_gate_id, plan.humanGateId, plan.human_gate_id, payload.humanGateId, payload.human_gate_id, existingPayload.humanGateId, existingPayload.human_gate_id)
  };
}

export async function approvedHumanGateForPlan(paths, { workflowId = "", planId = "", humanGateId = "" } = {}) {
  const clauses = [`object_type='human_gate_record'`, `status='approved'`];
  if (humanGateId) {
    clauses.push(`object_id=${sqlValue(humanGateId)}`);
  } else {
    const candidates = [];
    if (planId) {
      candidates.push(`parent_object_id=${sqlValue(planId)}`);
      candidates.push(humanGateJsonReferenceClause(planId, HUMAN_GATE_PLAN_ID_KEYS));
    } else if (workflowId) {
      candidates.push(`parent_object_id=${sqlValue(workflowId)}`);
      candidates.push(humanGateJsonReferenceClause(workflowId, HUMAN_GATE_WORKFLOW_ID_KEYS));
    }
    if (!candidates.length) return null;
    clauses.push(`(${candidates.join(" OR ")})`);
  }
  const rows = await sqlite(paths.dbFile, `
SELECT object_id, parent_object_id, payload_json, updated_at
FROM protocol_objects
  WHERE ${clauses.join(" AND ")}
ORDER BY updated_at DESC;`, { json: true });
  for (const row of rows) {
    if (humanGateRowReferencesPlan(row, workflowId, planId)) return row;
  }
  return null;
}

export async function approvedHumanGatePlanScheduleRef(paths, input = {}, payload = {}, existingPayload = {}) {
  const request = workflowSchedulePlanRequest(input, payload, existingPayload);
  if (!request.planId && !request.workflowId && !request.humanGateId) return null;
  const plansReady = await tableExists(paths.dbFile, "workflow_v2_plans");
  const protocolReady = await tableExists(paths.dbFile, "protocol_objects");
  if (!plansReady || !protocolReady) throw new Error("workflow plan or Human Gate registry is not initialized");
  const planClauses = [];
  if (request.planId) planClauses.push(`plan_id=${sqlValue(request.planId)}`);
  if (request.workflowId) planClauses.push(`workflow_id=${sqlValue(request.workflowId)}`);
  if (!planClauses.length) throw new Error("approved Human Gate schedule requires planId or workflowId");
  const planRows = await sqlite(paths.dbFile, `
SELECT plan_id, workflow_id, status, workflow_state, task_owner_agent, planner_agent, plan_spec_artifact_ref, plan_spec_artifact_hash
FROM workflow_v2_plans
WHERE ${planClauses.join(" AND ")}
ORDER BY updated_at DESC
LIMIT 2;`, { json: true });
  if (!planRows.length) throw new Error(`approved workflow plan not found: ${request.planId || request.workflowId}`);
  if (planRows.length > 1) throw new Error("approved Human Gate schedule matched multiple workflow plans; specify both workflowId and planId");
  const plan = planRows[0];
  if (!workflowPlanStateAllowsExecution(plan)) {
    throw new Error(`workflow plan is not schedulable: ${plan.workflow_id}/${plan.plan_id} status=${plan.status} state=${plan.workflow_state}`);
  }
  const humanGate = await approvedHumanGateForPlan(paths, {
    workflowId: plan.workflow_id,
    planId: plan.plan_id,
    humanGateId: request.humanGateId
  });
  if (!humanGate) throw new Error(`approved Human Gate record not found for workflow plan: ${plan.workflow_id}/${plan.plan_id}`);
  return {
    workflowId: plan.workflow_id,
    planId: plan.plan_id,
    status: plan.status,
    workflowState: plan.workflow_state,
    taskOwnerAgent: plan.task_owner_agent || "",
    plannerAgent: plan.planner_agent || "",
    planSpecArtifactRef: plan.plan_spec_artifact_ref || "",
    planSpecArtifactHash: plan.plan_spec_artifact_hash || "",
    humanGateId: humanGate.object_id || "",
    approvedAt: humanGate.updated_at || ""
  };
}

export async function workflowPlanApprovedTemplateAuthorization(paths, planRow = {}) {
  const planPayload = parseJsonValue(planRow.payload_json, {});
  const template = objectValue(planPayload.template || planPayload.productionTemplate || planPayload.production_template);
  const templateId = firstText(template.templateId, template.template_id);
  const version = Number(firstText(template.version, template.templateVersion, template.template_version));
  if (!templateId || !Number.isInteger(version) || version <= 0) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT s.template_id, s.family_status, s.default_version, s.active_version, v.version, v.status
FROM workflow_v2_template_specs s
JOIN workflow_v2_template_versions v ON v.template_id=s.template_id
WHERE s.template_id=${sqlValue(templateId)}
  AND v.version=${sqlValue(version)}
LIMIT 1;`, { json: true });
  const row = rows[0];
  if (!row) return null;
  const versionStatus = String(row.status || "").trim().toLowerCase();
  const familyStatus = String(row.family_status || "").trim().toLowerCase();
  const activeVersion = Number(row.active_version || 0);
  const defaultVersion = Number(row.default_version || 0);
  if (familyStatus !== "active") return null;
  if (!APPROVED_TEMPLATE_VERSION_STATUSES.has(versionStatus)) return null;
  if (![activeVersion, defaultVersion].includes(version)) return null;
  return { kind: "approved_template", templateId, version, status: versionStatus };
}

export async function workflowPlanApprovedHumanGateAuthorization(paths, planRow = {}) {
  const workflowId = String(planRow.workflow_id || "").trim();
  const planId = String(planRow.plan_id || "").trim();
  if (!workflowId && !planId) return null;
  const candidateClauses = [];
  if (planId) {
    candidateClauses.push(`parent_object_id=${sqlValue(planId)}`);
    candidateClauses.push(humanGateJsonReferenceClause(planId, HUMAN_GATE_PLAN_ID_KEYS));
  } else if (workflowId) {
    candidateClauses.push(`parent_object_id=${sqlValue(workflowId)}`);
    candidateClauses.push(humanGateJsonReferenceClause(workflowId, HUMAN_GATE_WORKFLOW_ID_KEYS));
  }
  if (!candidateClauses.length) return null;
  const rows = await sqlite(paths.dbFile, `
SELECT object_id, parent_object_id, payload_json, updated_at
FROM protocol_objects
WHERE object_type='human_gate_record'
  AND status='approved'
  AND (${candidateClauses.join(" OR ")})
ORDER BY updated_at DESC;`, { json: true });
  for (const row of rows) {
    if (humanGateRowReferencesPlan(row, workflowId, planId)) {
      return { kind: "approved_human_gate", humanGateId: row.object_id };
    }
  }
  return null;
}

export async function workflowGenericOrchestrationPlanRows(paths, input = {}) {
  const workflowId = firstText(input.workflowId, input.workflow_id);
  const planId = firstText(input.planId, input.plan_id);
  const nodeId = firstText(input.nodeId, input.node_id);
  const workerRunId = firstText(input.workerRunId, input.worker_run_id);
  const adapterJobId = firstText(input.adapterJobId, input.adapter_job_id, input.jobId, input.job_id);
  const handoffId = firstText(input.handoffId, input.handoff_id);
  const rows = [];
  if (planId || workflowId || nodeId) {
    const clauses = [];
    if (planId) clauses.push(`p.plan_id=${sqlValue(planId)}`);
    if (workflowId) clauses.push(`p.workflow_id=${sqlValue(workflowId)}`);
    if (nodeId) clauses.push(`n.node_id=${sqlValue(nodeId)}`);
    rows.push(...await sqlite(paths.dbFile, `
SELECT DISTINCT p.*
FROM workflow_v2_plans p
LEFT JOIN workflow_v2_plan_nodes n ON n.workflow_id=p.workflow_id AND n.plan_id=p.plan_id
WHERE ${clauses.join(" AND ")}
LIMIT 5;`, { json: true }));
  }
  if (workerRunId) {
    rows.push(...await sqlite(paths.dbFile, `
SELECT DISTINCT p.*
FROM workflow_v2_worker_runs w
JOIN workflow_v2_plans p ON p.workflow_id=w.workflow_id AND p.plan_id=w.plan_id
WHERE w.worker_run_id=${sqlValue(workerRunId)}
LIMIT 5;`, { json: true }));
  }
  if (adapterJobId) {
    rows.push(...await sqlite(paths.dbFile, `
SELECT DISTINCT p.*
FROM workflow_v2_worker_adapter_jobs j
JOIN workflow_v2_plans p ON p.workflow_id=j.workflow_id AND p.plan_id=j.plan_id
WHERE j.adapter_job_id=${sqlValue(adapterJobId)}
LIMIT 5;`, { json: true }));
  }
  if (handoffId) {
    rows.push(...await sqlite(paths.dbFile, `
SELECT DISTINCT p.*
FROM workflow_v2_worker_handoffs h
JOIN workflow_v2_plans p ON p.workflow_id=h.workflow_id AND p.plan_id=h.plan_id
WHERE h.handoff_id=${sqlValue(handoffId)}
LIMIT 5;`, { json: true }));
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.workflow_id || ""}:${row.plan_id || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function workflowGenericOrchestrationAuthorized(paths, input = {}) {
  const planRows = await workflowGenericOrchestrationPlanRows(paths, input);
  for (const planRow of planRows) {
    if (!workflowPlanStateAllowsExecution(planRow)) continue;
    const templateAuth = await workflowPlanApprovedTemplateAuthorization(paths, planRow);
    if (templateAuth) return { allowed: true, ...templateAuth, workflowId: planRow.workflow_id, planId: planRow.plan_id };
    const humanGateAuth = await workflowPlanApprovedHumanGateAuthorization(paths, planRow);
    if (humanGateAuth) return { allowed: true, ...humanGateAuth, workflowId: planRow.workflow_id, planId: planRow.plan_id };
  }
  return { allowed: false };
}
