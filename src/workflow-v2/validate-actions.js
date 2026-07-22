import fs from "node:fs/promises";
import path from "node:path";
import {
  fileExistsSync,
  workflowPaths
} from "../workflow/paths.js";
import {
  jsonHash
} from "../workflow/json.js";
import {
  sqlValue,
  sqlite,
  tableColumns
} from "../workflow/sqlite.js";
import {
  WORKFLOW_V2_ADAPTER_JOB_STATUSES,
  WORKFLOW_V2_MAX_CONCURRENT_WORKERS,
  WORKFLOW_V2_ORCHESTRATION_PATTERNS,
  WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS,
  WORKFLOW_V2_WORKER_HANDOFF_STATUSES,
  WORKFLOW_V2_WORKER_PATTERNS,
  WORKFLOW_V2_WORKER_RUN_STATUSES
} from "./constants.js";
import {
  workflowV2AdapterManifestContractIssue,
  workflowV2AdapterManifestContractIssues
} from "./adapter-manifest-contract.js";

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow v2 validate action dependency missing: ${name}`);
  return value;
}

function requireContextNumber(context, name) {
  const value = Number(context?.[name]);
  if (!Number.isFinite(value)) throw new Error(`workflow v2 validate action dependency missing: ${name}`);
  return value;
}

function requireContextIterable(context, name) {
  const value = context?.[name];
  if (!value || typeof value[Symbol.iterator] !== "function") throw new Error(`workflow v2 validate action dependency missing: ${name}`);
  return value;
}

export function createWorkflowV2ValidateActionHandlers(context = {}) {
  const hasAllColumns = requireContextFunction(context, "hasAllColumns");
  const HUMAN_GATE_APPROVE_OPTION_MAX = requireContextNumber(context, "humanGateApproveOptionMax");
  const HUMAN_GATE_APPROVE_OPTION_MIN = requireContextNumber(context, "humanGateApproveOptionMin");
  const WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES = new Set(requireContextIterable(context, "workflowV2AutonomousLoopNodeTypes"));

async function workflowV2SchemaSnapshot(dbFile) {
  const tables = {
    workflow_v2_plans: ["plan_id", "workflow_id", "status", "workflow_state", "task_owner_agent", "objective"],
    workflow_v2_plan_nodes: ["node_id", "plan_id", "workflow_id", "node_type", "status"],
    workflow_v2_info_items: ["info_id", "workflow_id", "classification", "content_storage"],
    workflow_v2_inbox_items: ["inbox_item_id", "info_id", "workflow_id", "recipient_kind", "recipient_id"],
    workflow_v2_access_grants: ["grant_id", "info_id", "principal_kind", "principal_id"],
    workflow_v2_read_receipts: ["receipt_id", "workflow_id", "info_id", "reader_kind", "reader_id"],
    workflow_v2_worker_runs: ["worker_run_id", "workflow_id", "plan_id", "node_id", "parent_worker_run_id", "supersedes_worker_run_id", "successor_worker_run_id", "worker_generation", "session_id", "preflight_id", "runtime_backend", "attempt", "max_attempts", "lease_owner", "lease_until", "next_retry_at", "handoff_info_id", "context_budget_tokens", "context_used_tokens", "compaction_count", "source_context_refs_json", "started_at", "completed_at"],
    workflow_v2_worker_adapter_jobs: ["adapter_job_id", "workflow_id", "plan_id", "node_id", "worker_run_id", "session_run_id", "runtime_backend", "worker_attempt", "runner_attempt", "max_runner_attempts", "status", "lease_owner", "lease_until", "next_retry_at", "artifact_ref", "info_id", "manifest_hash", "payload_json", "completed_at"],
    workflow_v2_worker_handoffs: ["handoff_id", "workflow_id", "plan_id", "worker_run_id", "successor_worker_run_id", "handoff_info_id", "status"],
    workflow_session_runs: ["run_id", "session_id", "workflow_id", "task_id", "worker_id", "status", "worker_input_json"],
    workflow_v2_manager_reviews: ["review_id", "workflow_id", "plan_id", "decision", "blocker_json"],
    workflow_v2_owner_reviews: ["review_id", "workflow_id", "plan_id", "owner_agent", "decision", "manager_review_refs_json"],
    workflow_v2_task_group_packages: ["package_id", "workflow_id", "plan_id", "owner_review_id", "task_group_agents_json", "status"],
    workflow_v2_cat_brain_audits: ["audit_id", "workflow_id", "plan_id", "task_group_package_id", "cat_brain_agent", "decision"],
    workflow_v2_cat_claw_audits: ["audit_id", "workflow_id", "plan_id", "cat_brain_audit_id", "cat_claw_agent", "decision"],
    workflow_v2_notifications: ["notification_id", "workflow_id", "payload_mode", "status"],
    workflow_v2_human_gate_packages: ["package_id", "workflow_id", "plan_id", "source_cat_claw_audit_id", "options_json", "required_controls_json"],
    workflow_v2_backend_preflights: ["preflight_id", "workflow_id", "backend_id", "status"]
  };
  const snapshot = {};
  for (const [table, required] of Object.entries(tables)) {
    const columns = await tableColumns(dbFile, table);
    snapshot[table] = {
      exists: columns.size > 0,
      requiredColumnsPresent: hasAllColumns(columns, required),
      missingColumns: required.filter((column) => !columns.has(column)),
      columns: Array.from(columns).sort()
    };
  }
  return snapshot;
}

async function workflowV2MismatchCheck(dbFile, schema, checkId, requiredTables, sql) {
  const skipped = requiredTables.filter((table) => !schema[table]?.exists);
  if (skipped.length) return { checkId, status: "skipped", skippedTables: skipped, count: 0 };
  const schemaGap = requiredTables.filter((table) => schema[table]?.exists && !schema[table]?.requiredColumnsPresent);
  if (schemaGap.length) return { checkId, status: "schema_gap", schemaGapTables: schemaGap, count: 0 };
  const rows = await sqlite(dbFile, sql, { json: true });
  const count = Number(rows[0]?.count || 0);
  return { checkId, status: count === 0 ? "pass" : "fail", count };
}

async function workflowV2AdvisoryCheck(dbFile, schema, checkId, requiredTables, sql) {
  const result = await workflowV2MismatchCheck(dbFile, schema, checkId, requiredTables, sql);
  if (result.status === "fail") {
    return { ...result, status: "advisory", severity: "advisory", advisory: true };
  }
  return { ...result, severity: "advisory", advisory: true };
}

async function workflowV2AdapterManifestArtifactFile(paths, artifactRef = "") {
  const text = String(artifactRef || "").trim();
  const prefix = "artifact://workflow-v2/";
  if (!text.startsWith(prefix)) {
    throw new Error(`adapter manifest artifact ref is not workflow-v2 scoped: ${text || "missing"}`);
  }
  const suffix = text.slice(prefix.length);
  if (!suffix || suffix.split("/").some((part) => part === "..")) {
    throw new Error(`adapter manifest artifact ref has unsafe path: ${text}`);
  }
  const base = path.resolve(paths.artifactsDir, "workflow-v2");
  const filePath = path.resolve(base, suffix);
  if (filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) {
    throw new Error(`adapter manifest artifact ref escapes artifact root: ${text}`);
  }
  const [realBase, realFile] = await Promise.all([
    fs.realpath(base),
    fs.realpath(filePath)
  ]);
  if (realFile !== realBase && !realFile.startsWith(`${realBase}${path.sep}`)) {
    throw new Error(`adapter manifest artifact real path escapes artifact root: ${text}`);
  }
  const stat = await fs.lstat(filePath);
  if (!stat.isFile()) {
    throw new Error(`adapter manifest artifact is not a regular file: ${text}`);
  }
  return filePath;
}

async function workflowV2AdapterManifestArtifactCheck(paths, schema) {
  const checkId = "adapter_job_manifest_artifacts_match_hash";
  const requiredTables = ["workflow_v2_worker_adapter_jobs"];
  const skipped = requiredTables.filter((table) => !schema[table]?.exists);
  if (skipped.length) return { checkId, status: "skipped", skippedTables: skipped, count: 0 };
  const schemaGap = requiredTables.filter((table) => schema[table]?.exists && !schema[table]?.requiredColumnsPresent);
  if (schemaGap.length) return { checkId, status: "schema_gap", schemaGapTables: schemaGap, count: 0 };
  const rows = await sqlite(paths.dbFile, `
SELECT adapter_job_id, workflow_id, worker_run_id, artifact_ref, manifest_hash
FROM workflow_v2_worker_adapter_jobs
WHERE artifact_ref!=''
ORDER BY adapter_job_id ASC;`, { json: true });
  const issues = [];
  for (const row of rows) {
    try {
      const artifactFile = await workflowV2AdapterManifestArtifactFile(paths, row.artifact_ref || "");
      const manifest = JSON.parse(await fs.readFile(artifactFile, "utf8"));
      const actualHash = `sha256:${jsonHash(manifest)}`;
      if (!row.manifest_hash) {
        issues.push({
          adapterJobId: row.adapter_job_id || "",
          workflowId: row.workflow_id || "",
          workerRunId: row.worker_run_id || "",
          artifactRef: row.artifact_ref || "",
          actualHash,
          reason: "manifest_hash_missing"
        });
      } else if (actualHash !== row.manifest_hash) {
        issues.push({
          adapterJobId: row.adapter_job_id || "",
          workflowId: row.workflow_id || "",
          workerRunId: row.worker_run_id || "",
          artifactRef: row.artifact_ref || "",
          expectedHash: row.manifest_hash || "",
          actualHash,
          reason: "manifest_hash_mismatch"
        });
      }
    } catch (error) {
      issues.push({
        adapterJobId: row.adapter_job_id || "",
        workflowId: row.workflow_id || "",
        workerRunId: row.worker_run_id || "",
        artifactRef: row.artifact_ref || "",
        expectedHash: row.manifest_hash || "",
        reason: "manifest_artifact_unreadable",
        error: String(error?.message || error)
      });
    }
  }
  return {
    checkId,
    status: issues.length ? "fail" : "pass",
    count: issues.length,
    checkedCount: rows.length,
    issues: issues.slice(0, 20)
  };
}

async function workflowV2AdapterManifestContractCheck(paths, schema) {
  const checkId = "adapter_job_manifest_contract_consistency";
  const requiredTables = ["workflow_v2_worker_adapter_jobs", "workflow_v2_worker_runs", "workflow_session_runs", "workflow_v2_backend_preflights", "workflow_v2_info_items"];
  const skipped = requiredTables.filter((table) => !schema[table]?.exists);
  if (skipped.length) return { checkId, status: "skipped", skippedTables: skipped, count: 0 };
  const schemaGap = requiredTables.filter((table) => schema[table]?.exists && !schema[table]?.requiredColumnsPresent);
  if (schemaGap.length) return { checkId, status: "schema_gap", schemaGapTables: schemaGap, count: 0 };
  const rows = await sqlite(paths.dbFile, `
SELECT
  j.adapter_job_id,
  j.workflow_id,
  j.plan_id,
  j.node_id,
  j.worker_run_id,
  j.session_run_id,
  j.runtime_backend,
  j.worker_attempt,
  j.artifact_ref,
  j.manifest_hash,
  j.info_id,
  w.worker_run_id AS worker_row_id,
  w.session_id AS worker_session_id,
  w.manager_agent AS worker_manager_agent,
  w.worker_agent_id AS worker_agent_id,
  w.preflight_id AS worker_preflight_id,
  w.task_input_info_id AS worker_task_input_info_id,
  w.output_info_id AS worker_output_info_id,
  w.context_budget_tokens AS worker_context_budget_tokens,
  w.context_used_tokens AS worker_context_used_tokens,
  w.compaction_count AS worker_compaction_count,
  s.run_id AS session_row_id,
  s.session_id AS session_id,
  s.workflow_id AS session_workflow_id,
  s.task_id AS session_task_id,
  s.worker_id AS session_worker_id,
  s.worker_input_json AS session_worker_input_json,
  p.preflight_id AS preflight_row_id,
  p.workflow_id AS preflight_workflow_id,
  p.backend_id AS preflight_backend_id,
  p.status AS preflight_status,
  task.info_id AS task_info_row_id
FROM workflow_v2_worker_adapter_jobs j
LEFT JOIN workflow_v2_worker_runs w ON w.worker_run_id=j.worker_run_id
LEFT JOIN workflow_session_runs s ON s.run_id=j.session_run_id
LEFT JOIN workflow_v2_backend_preflights p ON p.preflight_id=w.preflight_id
LEFT JOIN workflow_v2_info_items task ON task.info_id=w.task_input_info_id
WHERE j.artifact_ref!=''
ORDER BY j.adapter_job_id ASC;`, { json: true });
  const issues = [];
  for (const row of rows) {
    try {
      const artifactFile = await workflowV2AdapterManifestArtifactFile(paths, row.artifact_ref || "");
      const manifest = JSON.parse(await fs.readFile(artifactFile, "utf8"));
      issues.push(...workflowV2AdapterManifestContractIssues(row, manifest));
    } catch (error) {
      issues.push(workflowV2AdapterManifestContractIssue(row, "manifest_contract_unreadable", {
        error: String(error?.message || error)
      }));
    }
  }
  return {
    checkId,
    status: issues.length ? "fail" : "pass",
    count: issues.length,
    checkedCount: rows.length,
    issues: issues.slice(0, 20)
  };
}

async function workflowV2Validate(rootDir, input = {}) {
  const paths = workflowPaths(rootDir, input);
  if (!fileExistsSync(paths.dbFile)) {
    return {
      operation: "workflow.v2.validate",
      dryRun: true,
      previewOnly: true,
      status: "skipped",
      ok: true,
      reason: "workflow database does not exist",
      schema: {},
      checks: [],
      advisoryChecks: [],
      dbFile: paths.dbFile
    };
  }
  const schema = await workflowV2SchemaSnapshot(paths.dbFile);
  const checks = [];
  const advisoryChecks = [];
  const workerStatusesSql = [...WORKFLOW_V2_WORKER_RUN_STATUSES].map((status) => sqlValue(status)).join(", ");
  const adapterJobStatusesSql = [...WORKFLOW_V2_ADAPTER_JOB_STATUSES].map((status) => sqlValue(status)).join(", ");
  const handoffStatusesSql = [...WORKFLOW_V2_WORKER_HANDOFF_STATUSES].map((status) => sqlValue(status)).join(", ");
  const orchestrationPatternsSql = [...WORKFLOW_V2_ORCHESTRATION_PATTERNS].map((status) => sqlValue(status)).join(", ");
  const workerPatternsSql = [...WORKFLOW_V2_WORKER_PATTERNS].map((status) => sqlValue(status)).join(", ");
  const autonomousLoopNodeTypesSql = [...WORKFLOW_V2_AUTONOMOUS_LOOP_NODE_TYPES].map((status) => sqlValue(status)).join(", ");
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "plans_required_fields", ["workflow_v2_plans"], `
SELECT COUNT(*) AS count
FROM workflow_v2_plans
WHERE workflow_id='' OR objective='' OR task_owner_agent='' OR workflow_state='';`));
  advisoryChecks.push(await workflowV2AdvisoryCheck(paths.dbFile, schema, "plans_anthropic_orchestration_contract", ["workflow_v2_plans"], `
SELECT COUNT(*) AS count
FROM workflow_v2_plans
WHERE json_valid(acceptance_criteria_json)=0
   OR json_array_length(acceptance_criteria_json)=0
   OR json_valid(payload_json)=0
   OR COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.pattern'), '') NOT IN (${orchestrationPatternsSql})
   OR COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.rationale'), '')=''
   OR json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.workerBudget.maxWorkers') IS NULL
   OR json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.workerBudget.concurrencyLimit') IS NULL
   OR json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.workerBudget.maxWorkerContextTokens') IS NULL
   OR COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.workerBudget.concurrencyLimit'), 0) > ${WORKFLOW_V2_MAX_CONCURRENT_WORKERS}
   OR COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.workerBudget.maxWorkerContextTokens'), 0) > ${WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS}
   OR (COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.pattern'), '') IN (${workerPatternsSql}) AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.workerBudget.maxWorkers'), 0) < 1)
   OR (COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.pattern'), '')='direct_owner_execution' AND COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.orchestration.workerBudget.maxWorkers'), 0) > 0);`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "nodes_match_plans", ["workflow_v2_plan_nodes", "workflow_v2_plans"], `
SELECT COUNT(*) AS count
FROM workflow_v2_plan_nodes n
LEFT JOIN workflow_v2_plans p ON p.plan_id=n.plan_id
WHERE p.plan_id IS NULL OR p.workflow_id != n.workflow_id;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_runs_match_plan_node", ["workflow_v2_worker_runs", "workflow_v2_plans", "workflow_v2_plan_nodes"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs w
LEFT JOIN workflow_v2_plans p ON p.plan_id=w.plan_id
LEFT JOIN workflow_v2_plan_nodes n ON n.node_id=w.node_id
WHERE p.plan_id IS NULL OR n.node_id IS NULL OR p.workflow_id != w.workflow_id OR n.workflow_id != w.workflow_id;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_runs_require_valid_preflight", ["workflow_v2_worker_runs", "workflow_v2_backend_preflights"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs w
LEFT JOIN workflow_v2_backend_preflights p ON p.preflight_id=w.preflight_id
WHERE w.preflight_id=''
   OR p.preflight_id IS NULL
   OR p.workflow_id != w.workflow_id
   OR p.backend_id != w.runtime_backend
   OR p.status NOT IN ('pass','warn');`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_runs_session_runs_match", ["workflow_v2_worker_runs", "workflow_session_runs"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs w
LEFT JOIN workflow_session_runs s ON s.run_id=w.session_run_id
WHERE w.session_run_id=''
   OR s.run_id IS NULL
   OR s.session_id != w.session_id
   OR s.workflow_id != w.workflow_id
   OR s.task_id != w.node_id
   OR s.worker_id != w.worker_agent_id
   OR (w.status IN ('queued','retry_scheduled') AND s.status != 'queued')
   OR (w.status='running' AND s.status != 'running')
   OR (w.status IN ('submitted_for_review','accepted','rejected','revise_required','needs_human_gate','handoff_required','successor_spawned') AND s.status != 'completed')
   OR (w.status='retired' AND s.status NOT IN ('completed','failed'))
   OR (w.status IN ('blocked','failed','timed_out') AND s.status != 'failed')
   OR (w.status='cancelled' AND s.status != 'cancelled');`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "v2_session_runs_have_worker_runs", ["workflow_session_runs", "workflow_v2_worker_runs"], `
SELECT COUNT(*) AS count
FROM workflow_session_runs s
LEFT JOIN workflow_v2_worker_runs w ON w.session_run_id=s.run_id
WHERE (
    json_valid(s.input_json)=0
    OR json_extract(CASE WHEN json_valid(s.input_json) THEN s.input_json ELSE '{}' END, '$.schemaVersion')='workflow_v2_worker_session_input.v1'
  )
  AND w.worker_run_id IS NULL;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_run_control_lifecycle_fields", ["workflow_v2_worker_runs"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs
WHERE max_attempts < 1
   OR attempt < 0
   OR (status='running' AND (lease_owner='' OR lease_until='' OR attempt < 1 OR started_at=''))
   OR (status='retry_scheduled' AND next_retry_at='')
   OR (status IN ('submitted_for_review','accepted','rejected','revise_required','needs_human_gate') AND (output_info_id='' OR receipt_ref='' OR completed_at=''))
   OR (status='handoff_required' AND handoff_info_id='')
   OR (status='successor_spawned' AND successor_worker_run_id='')
   OR (status IN ('submitted_for_review','accepted','rejected','revise_required','handoff_required','retired','successor_spawned','blocked','needs_human_gate','failed','timed_out','cancelled') AND lease_owner!='')
   OR (status IN ('submitted_for_review','accepted','rejected','revise_required','handoff_required','retired','successor_spawned','blocked','needs_human_gate','failed','timed_out','cancelled') AND lease_until!='');`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_runs_anthropic_delegation_contract", ["workflow_v2_worker_runs"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs
WHERE context_budget_tokens < 1
   OR context_budget_tokens > ${WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS}
   OR json_valid(payload_json)=0
   OR COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.delegation.objective'), '')=''
   OR COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.delegation.outputFormat'), '')=''
   OR COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.delegation.toolBoundary'), '')=''
   OR COALESCE(json_array_length(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.delegation.acceptanceCriteria')), 0) < 1
   OR (
        COALESCE(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.delegation.stopCondition'), '')=''
        AND COALESCE(json_array_length(json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END, '$.delegation.stopConditions')), 0) < 1
      );`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "autonomous_loop_iteration_caps", ["workflow_v2_worker_runs", "workflow_v2_plans", "workflow_v2_plan_nodes"], `
WITH autonomous_nodes AS (
  SELECT
    n.workflow_id,
    n.plan_id,
    n.node_id,
    CAST(COALESCE(
      json_extract(CASE WHEN json_valid(n.payload_json) THEN n.payload_json ELSE '{}' END, '$.maxIterations'),
      json_extract(CASE WHEN json_valid(n.payload_json) THEN n.payload_json ELSE '{}' END, '$.max_iterations'),
      json_extract(CASE WHEN json_valid(n.payload_json) THEN n.payload_json ELSE '{}' END, '$.iterationCap'),
      json_extract(CASE WHEN json_valid(n.payload_json) THEN n.payload_json ELSE '{}' END, '$.iteration_cap'),
      0
    ) AS INTEGER) AS max_iterations
  FROM workflow_v2_plan_nodes n
  JOIN workflow_v2_plans p ON p.workflow_id=n.workflow_id AND p.plan_id=n.plan_id
  WHERE COALESCE(json_extract(CASE WHEN json_valid(p.payload_json) THEN p.payload_json ELSE '{}' END, '$.orchestration.pattern'), '')='autonomous_agent_loop'
    AND n.node_type IN (${autonomousLoopNodeTypesSql})
)
SELECT COUNT(*) AS count
FROM autonomous_nodes a
WHERE a.max_iterations > 0
  AND (
    SELECT COUNT(*)
    FROM workflow_v2_worker_runs w
    WHERE w.workflow_id=a.workflow_id
      AND w.plan_id=a.plan_id
      AND w.node_id=a.node_id
      AND w.status!='cancelled'
  ) > a.max_iterations;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_run_statuses_are_known", ["workflow_v2_worker_runs"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs
WHERE status NOT IN (${workerStatusesSql});`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_lineage_references_match", ["workflow_v2_worker_runs", "workflow_v2_info_items"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs w
LEFT JOIN workflow_v2_worker_runs parent ON parent.worker_run_id=w.parent_worker_run_id AND w.parent_worker_run_id!=''
LEFT JOIN workflow_v2_worker_runs superseded ON superseded.worker_run_id=w.supersedes_worker_run_id AND w.supersedes_worker_run_id!=''
LEFT JOIN workflow_v2_worker_runs successor ON successor.worker_run_id=w.successor_worker_run_id AND w.successor_worker_run_id!=''
LEFT JOIN workflow_v2_info_items handoff_info ON handoff_info.info_id=w.handoff_info_id AND w.handoff_info_id!=''
WHERE w.worker_generation < 0
   OR w.context_budget_tokens < 0
   OR w.context_used_tokens < 0
   OR w.compaction_count < 0
   OR json_valid(w.source_context_refs_json)=0
   OR (w.parent_worker_run_id!='' AND (parent.worker_run_id IS NULL OR parent.workflow_id != w.workflow_id))
   OR (w.supersedes_worker_run_id!='' AND (superseded.worker_run_id IS NULL OR superseded.workflow_id != w.workflow_id))
   OR (w.successor_worker_run_id!='' AND (successor.worker_run_id IS NULL OR successor.workflow_id != w.workflow_id))
   OR (w.handoff_info_id!='' AND (handoff_info.info_id IS NULL OR handoff_info.workflow_id != w.workflow_id));`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_handoffs_match_worker_runs", ["workflow_v2_worker_handoffs", "workflow_v2_worker_runs", "workflow_v2_plans", "workflow_v2_info_items"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_handoffs h
LEFT JOIN workflow_v2_worker_runs w ON w.worker_run_id=h.worker_run_id
LEFT JOIN workflow_v2_plans p ON p.plan_id=h.plan_id
LEFT JOIN workflow_v2_worker_runs successor ON successor.worker_run_id=h.successor_worker_run_id AND h.successor_worker_run_id!=''
LEFT JOIN workflow_v2_info_items handoff_info ON handoff_info.info_id=h.handoff_info_id AND h.handoff_info_id!=''
WHERE h.status NOT IN (${handoffStatusesSql})
   OR w.worker_run_id IS NULL
   OR w.workflow_id != h.workflow_id
   OR p.plan_id IS NULL
   OR p.workflow_id != h.workflow_id
   OR json_valid(h.source_context_refs_json)=0
   OR json_valid(h.artifact_refs_json)=0
   OR json_valid(h.receipt_refs_json)=0
   OR (h.status IN ('recommended','required','accepted','superseded') AND h.handoff_info_id='')
   OR (h.status='superseded' AND h.successor_worker_run_id='')
   OR (h.successor_worker_run_id!='' AND (successor.worker_run_id IS NULL OR successor.workflow_id != h.workflow_id))
   OR (h.handoff_info_id!='' AND (handoff_info.info_id IS NULL OR handoff_info.workflow_id != h.workflow_id));`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "worker_run_output_info_exists", ["workflow_v2_worker_runs", "workflow_v2_info_items"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs w
LEFT JOIN workflow_v2_info_items i ON i.info_id=w.output_info_id
WHERE w.output_info_id!=''
  AND (i.info_id IS NULL OR i.workflow_id != w.workflow_id OR i.worker_run_id != w.worker_run_id);`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "adapter_jobs_match_worker_runs", ["workflow_v2_worker_adapter_jobs", "workflow_v2_worker_runs", "workflow_v2_info_items"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_adapter_jobs j
LEFT JOIN workflow_v2_worker_runs w ON w.worker_run_id=j.worker_run_id
LEFT JOIN workflow_v2_info_items i ON i.info_id=j.info_id
WHERE j.status NOT IN (${adapterJobStatusesSql})
   OR w.worker_run_id IS NULL
   OR w.workflow_id != j.workflow_id
   OR w.runtime_backend != j.runtime_backend
   OR (j.plan_id!='' AND w.plan_id != j.plan_id)
   OR (j.node_id!='' AND w.node_id != j.node_id)
   OR (j.session_run_id!='' AND w.session_run_id != j.session_run_id)
   OR j.worker_attempt < 1
   OR j.runner_attempt < 0
   OR j.max_runner_attempts < 1
   OR json_valid(j.payload_json)=0
   OR j.artifact_ref=''
   OR j.info_id=''
   OR j.manifest_hash=''
   OR i.info_id IS NULL
   OR i.workflow_id != j.workflow_id
   OR i.worker_run_id != j.worker_run_id
   OR (j.status IN ('queued','retry_scheduled','running') AND w.status != 'running')
   OR (j.status IN ('queued','retry_scheduled','running') AND w.attempt != j.worker_attempt)
   OR (j.status='running' AND (j.lease_owner='' OR j.lease_until=''))
   OR (j.status='retry_scheduled' AND j.next_retry_at='')
   OR (j.status IN ('completed','failed','cancelled') AND j.completed_at='')
   OR (j.status IN ('queued','retry_scheduled','completed','failed','cancelled') AND (j.lease_owner!='' OR j.lease_until!=''));`));
  checks.push(await workflowV2AdapterManifestArtifactCheck(paths, schema));
  checks.push(await workflowV2AdapterManifestContractCheck(paths, schema));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "accepted_worker_runs_require_accepted_manager_review", ["workflow_v2_worker_runs", "workflow_v2_manager_reviews"], `
SELECT COUNT(*) AS count
FROM workflow_v2_worker_runs w
LEFT JOIN workflow_v2_manager_reviews r ON r.worker_run_id=w.worker_run_id AND r.workflow_id=w.workflow_id AND r.decision='accepted'
WHERE w.status='accepted' AND r.review_id IS NULL;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "info_references_match", ["workflow_v2_info_items", "workflow_v2_plans", "workflow_v2_plan_nodes", "workflow_v2_worker_runs"], `
SELECT COUNT(*) AS count
FROM workflow_v2_info_items i
LEFT JOIN workflow_v2_plans p ON p.plan_id=i.plan_id AND i.plan_id!=''
LEFT JOIN workflow_v2_plan_nodes n ON n.node_id=i.node_id AND i.node_id!=''
LEFT JOIN workflow_v2_worker_runs w ON w.worker_run_id=i.worker_run_id AND i.worker_run_id!=''
WHERE (i.plan_id!='' AND (p.plan_id IS NULL OR p.workflow_id != i.workflow_id))
   OR (i.node_id!='' AND (n.node_id IS NULL OR n.workflow_id != i.workflow_id))
   OR (i.worker_run_id!='' AND (w.worker_run_id IS NULL OR w.workflow_id != i.workflow_id));`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "inbox_grants_notifications_match_info", ["workflow_v2_info_items", "workflow_v2_inbox_items", "workflow_v2_access_grants", "workflow_v2_notifications"], `
SELECT
  (SELECT COUNT(*) FROM workflow_v2_inbox_items inbox LEFT JOIN workflow_v2_info_items info ON info.info_id=inbox.info_id WHERE info.info_id IS NULL OR info.workflow_id != inbox.workflow_id)
  + (SELECT COUNT(*) FROM workflow_v2_access_grants grant_row LEFT JOIN workflow_v2_info_items info ON info.info_id=grant_row.info_id WHERE info.info_id IS NULL)
  + (SELECT COUNT(*) FROM workflow_v2_notifications note LEFT JOIN workflow_v2_info_items info ON info.info_id=note.info_id WHERE note.info_id!='' AND (info.info_id IS NULL OR info.workflow_id != note.workflow_id))
  AS count;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "read_receipts_match_info_inbox_grant", ["workflow_v2_read_receipts", "workflow_v2_info_items", "workflow_v2_inbox_items", "workflow_v2_access_grants"], `
SELECT COUNT(*) AS count
FROM workflow_v2_read_receipts r
LEFT JOIN workflow_v2_info_items i ON i.info_id=r.info_id
LEFT JOIN workflow_v2_inbox_items inbox ON inbox.inbox_item_id=r.inbox_item_id AND r.inbox_item_id!=''
LEFT JOIN workflow_v2_access_grants grant_row ON grant_row.grant_id=r.grant_id AND r.grant_id!=''
WHERE i.info_id IS NULL OR i.workflow_id != r.workflow_id
   OR (r.inbox_item_id='' AND r.grant_id='')
   OR (r.inbox_item_id!='' AND (inbox.inbox_item_id IS NULL OR inbox.workflow_id != r.workflow_id))
   OR (r.grant_id!='' AND (grant_row.grant_id IS NULL OR grant_row.info_id != r.info_id));`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "manager_reviews_match_worker_runs", ["workflow_v2_manager_reviews", "workflow_v2_plans", "workflow_v2_worker_runs"], `
SELECT COUNT(*) AS count
FROM workflow_v2_manager_reviews r
LEFT JOIN workflow_v2_plans p ON p.plan_id=r.plan_id
LEFT JOIN workflow_v2_worker_runs w ON w.worker_run_id=r.worker_run_id
WHERE p.plan_id IS NULL OR p.workflow_id != r.workflow_id
   OR r.worker_run_id=''
   OR w.worker_run_id IS NULL
   OR w.workflow_id != r.workflow_id
   OR w.plan_id != r.plan_id
   OR w.manager_agent != r.reviewer_agent
   OR (r.decision='accepted' AND w.status != 'accepted')
   OR json_valid(r.findings_json)=0
   OR json_valid(r.artifact_refs_json)=0
   OR json_valid(r.receipt_refs_json)=0
   OR json_valid(r.blocker_json)=0
   OR json_valid(r.payload_json)=0;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "evaluator_optimizer_manager_reviews_have_receipts", ["workflow_v2_manager_reviews", "workflow_v2_plans", "workflow_v2_worker_runs"], `
WITH evaluator_reviews AS (
  SELECT
    r.review_id,
    r.decision,
    r.node_id,
    r.worker_run_id,
    w.output_info_id,
    CASE WHEN json_valid(r.payload_json) THEN r.payload_json ELSE '{}' END AS payload_json
  FROM workflow_v2_manager_reviews r
  JOIN workflow_v2_plans p ON p.workflow_id=r.workflow_id AND p.plan_id=r.plan_id
  LEFT JOIN workflow_v2_worker_runs w ON w.workflow_id=r.workflow_id AND w.plan_id=r.plan_id AND w.worker_run_id=r.worker_run_id
  WHERE COALESCE(json_extract(CASE WHEN json_valid(p.payload_json) THEN p.payload_json ELSE '{}' END, '$.orchestration.pattern'), '')='evaluator_optimizer'
    AND r.decision IN ('accepted','rejected','revise_required')
)
SELECT COUNT(*) AS count
FROM evaluator_reviews r
WHERE COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.schemaVersion'), '')!='workflow_v2_evaluator_receipt.v1'
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.producerOutputInfoId'), '')=''
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.evaluatorInputInfoId'), '')=''
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.rubric'), '')=''
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.reviewArtifactRef'), '')=''
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.reviewReceiptRef'), '')=''
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.producerWorkerRunId'), '') != r.worker_run_id
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.producerNodeId'), '') != r.node_id
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.producerOutputInfoId'), '') != r.output_info_id
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.evaluatorInputInfoId'), '') != r.output_info_id
   OR COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.decisionState'), '') NOT IN ('accepted','rejected','needs_revision')
   OR NOT EXISTS (
        SELECT 1
        FROM json_each(COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.decisionStates'), '[]')) state
        WHERE LOWER(REPLACE(state.value, '-', '_'))='accepted'
      )
   OR NOT EXISTS (
        SELECT 1
        FROM json_each(COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.decisionStates'), '[]')) state
        WHERE LOWER(REPLACE(state.value, '-', '_'))='rejected'
      )
   OR NOT EXISTS (
        SELECT 1
        FROM json_each(COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.decisionStates'), '[]')) state
        WHERE LOWER(REPLACE(state.value, '-', '_')) IN ('needs_revision','revise_required')
      )
   OR (
        CASE r.decision
          WHEN 'accepted' THEN 'accepted'
          WHEN 'rejected' THEN 'rejected'
          WHEN 'revise_required' THEN 'needs_revision'
          ELSE r.decision
        END
      ) != COALESCE(json_extract(r.payload_json, '$.evaluatorReceipt.decisionState'), '');`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "manager_review_decisions_are_outcomes", ["workflow_v2_manager_reviews"], `
	SELECT COUNT(*) AS count
	FROM workflow_v2_manager_reviews
	WHERE decision NOT IN ('accepted','revise_required','rejected','needs_human_gate');`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "owner_reviews_match_plan_and_owner", ["workflow_v2_owner_reviews", "workflow_v2_plans"], `
SELECT COUNT(*) AS count
FROM workflow_v2_owner_reviews r
LEFT JOIN workflow_v2_plans p ON p.plan_id=r.plan_id
WHERE p.plan_id IS NULL
   OR p.workflow_id != r.workflow_id
   OR p.task_owner_agent != r.owner_agent
   OR r.decision NOT IN ('accepted','revise_required','rejected','needs_human_gate')
   OR json_valid(r.manager_review_refs_json)=0
   OR json_valid(r.artifact_refs_json)=0
   OR json_valid(r.receipt_refs_json)=0
   OR json_valid(r.findings_json)=0
   OR json_valid(r.payload_json)=0;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "owner_review_manager_refs_exist", ["workflow_v2_owner_reviews", "workflow_v2_manager_reviews"], `
SELECT COUNT(*) AS count
FROM workflow_v2_owner_reviews r
JOIN json_each(CASE WHEN json_valid(r.manager_review_refs_json) THEN r.manager_review_refs_json ELSE '[]' END) ref
LEFT JOIN workflow_v2_manager_reviews m ON m.review_id=ref.value
WHERE m.review_id IS NULL
   OR m.workflow_id != r.workflow_id
   OR m.plan_id != r.plan_id
   OR m.decision != 'accepted';`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "task_group_packages_match_owner_reviews", ["workflow_v2_task_group_packages", "workflow_v2_owner_reviews", "workflow_v2_plans"], `
SELECT COUNT(*) AS count
FROM workflow_v2_task_group_packages p
LEFT JOIN workflow_v2_plans plan_row ON plan_row.plan_id=p.plan_id
LEFT JOIN workflow_v2_owner_reviews r ON r.review_id=p.owner_review_id
WHERE plan_row.plan_id IS NULL
   OR plan_row.workflow_id != p.workflow_id
   OR p.task_owner_agent != plan_row.task_owner_agent
   OR r.review_id IS NULL
   OR r.workflow_id != p.workflow_id
   OR r.plan_id != p.plan_id
   OR r.decision != 'accepted'
   OR p.status NOT IN ('draft','ready','revision_required','cancelled')
   OR json_valid(p.task_group_agents_json)=0
   OR json_valid(p.manager_review_refs_json)=0
   OR json_valid(p.owner_review_refs_json)=0
   OR json_valid(p.artifact_refs_json)=0
   OR json_valid(p.evidence_refs_json)=0
   OR json_valid(p.payload_json)=0;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "cat_brain_audits_match_accepted_source", ["workflow_v2_cat_brain_audits", "workflow_v2_task_group_packages", "workflow_v2_owner_reviews"], `
SELECT COUNT(*) AS count
FROM workflow_v2_cat_brain_audits a
LEFT JOIN workflow_v2_task_group_packages p ON p.package_id=a.task_group_package_id AND COALESCE(a.task_group_package_id, '') != ''
LEFT JOIN workflow_v2_owner_reviews r ON r.review_id=json_extract(CASE WHEN json_valid(a.payload_json) THEN a.payload_json ELSE '{}' END, '$.sourceOwnerReviewId')
WHERE (
      (
        COALESCE(a.task_group_package_id, '') != ''
        AND (p.package_id IS NULL OR p.workflow_id != a.workflow_id OR p.plan_id != a.plan_id OR p.status != 'ready')
      )
      OR (
        COALESCE(a.task_group_package_id, '') = ''
        AND (r.review_id IS NULL OR r.workflow_id != a.workflow_id OR r.plan_id != a.plan_id OR r.decision != 'accepted')
      )
   )
   OR a.cat_brain_agent != 'main'
   OR a.decision NOT IN ('approved','revision_required','rejected','needs_human_gate')
   OR json_valid(a.findings_json)=0
   OR json_valid(a.evidence_refs_json)=0
   OR json_valid(a.payload_json)=0;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "cat_claw_audits_match_cat_brain_audits", ["workflow_v2_cat_claw_audits", "workflow_v2_cat_brain_audits"], `
SELECT COUNT(*) AS count
FROM workflow_v2_cat_claw_audits a
LEFT JOIN workflow_v2_cat_brain_audits b ON b.audit_id=a.cat_brain_audit_id
WHERE b.audit_id IS NULL
   OR b.workflow_id != a.workflow_id
   OR b.plan_id != a.plan_id
   OR b.decision NOT IN ('approved','needs_human_gate')
   OR a.cat_claw_agent != 'cat_claw'
   OR a.decision NOT IN ('protocol_ready','protocol_revision_required','rejected')
   OR (a.decision='protocol_ready' AND json_array_length(a.evidence_refs_json)=0)
   OR json_valid(a.checks_json)=0
   OR json_valid(a.evidence_refs_json)=0
   OR json_valid(a.payload_json)=0;`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "human_gate_packages_options_count", ["workflow_v2_human_gate_packages"], `
SELECT COUNT(*) AS count
FROM workflow_v2_human_gate_packages
WHERE json_valid(options_json)=0
   OR json_array_length(options_json) < ${HUMAN_GATE_APPROVE_OPTION_MIN}
   OR json_array_length(options_json) > ${HUMAN_GATE_APPROVE_OPTION_MAX}
   OR json_valid(required_controls_json)=0
   OR instr(required_controls_json, 'pause')=0
   OR instr(required_controls_json, 'terminate')=0
   OR status NOT IN ('draft','protocol_audited','cat_claw_audited');`));
  checks.push(await workflowV2MismatchCheck(paths.dbFile, schema, "human_gate_packages_cat_claw_source_ready", ["workflow_v2_human_gate_packages", "workflow_v2_cat_claw_audits"], `
SELECT COUNT(*) AS count
FROM workflow_v2_human_gate_packages p
LEFT JOIN workflow_v2_cat_claw_audits a ON a.audit_id=COALESCE(NULLIF(p.source_cat_claw_audit_id, ''), json_extract(CASE WHEN json_valid(p.payload_json) THEN p.payload_json ELSE '{}' END, '$.sourceCatClawAuditId'))
WHERE json_valid(p.payload_json)=0
   OR (p.status IN ('protocol_audited','cat_claw_audited')
      AND COALESCE(NULLIF(p.source_cat_claw_audit_id, ''), json_extract(CASE WHEN json_valid(p.payload_json) THEN p.payload_json ELSE '{}' END, '$.sourceCatClawAuditId'), '') = '')
   OR (COALESCE(NULLIF(p.source_cat_claw_audit_id, ''), json_extract(CASE WHEN json_valid(p.payload_json) THEN p.payload_json ELSE '{}' END, '$.sourceCatClawAuditId'), '') != ''
      AND (a.audit_id IS NULL OR a.workflow_id != p.workflow_id OR a.plan_id != p.plan_id OR a.decision != 'protocol_ready'));`));
  const failed = checks.filter((check) => check.status === "fail");
  const advisoryFindings = advisoryChecks.filter((check) => check.status === "advisory");
  const schemaMissing = Object.entries(schema).filter(([, info]) => !info.exists || !info.requiredColumnsPresent);
  return {
    operation: "workflow.v2.validate",
    dryRun: true,
    previewOnly: true,
    status: failed.length || schemaMissing.length ? "fail" : "pass",
    ok: failed.length === 0 && schemaMissing.length === 0,
    schema,
    checks,
    advisoryChecks,
    failedChecks: failed.map((check) => check.checkId),
    advisoryFindings: advisoryFindings.map((check) => check.checkId),
    advisoryCount: advisoryFindings.reduce((total, check) => total + Number(check.count || 0), 0),
    missingSchema: schemaMissing.map(([table, info]) => ({ table, missingColumns: info.missingColumns, exists: info.exists })),
    dbFile: paths.dbFile
  };
}


  return {
    workflowV2Validate
  };
}
