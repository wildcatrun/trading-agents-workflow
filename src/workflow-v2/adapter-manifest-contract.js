export function workflowV2ObjectValue(object, dottedPath) {
  return String(dottedPath || "").split(".").reduce((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return current[key];
  }, object);
}

export function workflowV2AdapterManifestContractIssue(row = {}, reason = "", details = {}) {
  return {
    adapterJobId: row.adapter_job_id || "",
    workflowId: row.workflow_id || "",
    workerRunId: row.worker_run_id || "",
    artifactRef: row.artifact_ref || "",
    reason,
    ...details
  };
}

function workflowV2CompareManifestField(issues, row, manifest, fieldPath, expected, reason = "manifest_field_mismatch") {
  const actual = workflowV2ObjectValue(manifest, fieldPath);
  if (actual !== expected) {
    issues.push(workflowV2AdapterManifestContractIssue(row, reason, {
      field: fieldPath,
      expected,
      actualPresent: actual !== undefined && actual !== null && actual !== "",
      actualType: Array.isArray(actual) ? "array" : typeof actual
    }));
  }
}

export function workflowV2AdapterManifestContractIssues(row = {}, manifest = {}) {
  const issues = [];
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    issues.push(workflowV2AdapterManifestContractIssue(row, "manifest_not_object"));
    return issues;
  }
  if (!row.worker_row_id) issues.push(workflowV2AdapterManifestContractIssue(row, "manifest_worker_row_missing"));
  if (!row.session_row_id) issues.push(workflowV2AdapterManifestContractIssue(row, "manifest_session_run_missing"));
  if (!row.preflight_row_id) issues.push(workflowV2AdapterManifestContractIssue(row, "manifest_preflight_missing"));
  if (!row.task_info_row_id) issues.push(workflowV2AdapterManifestContractIssue(row, "manifest_task_input_info_missing"));
  workflowV2CompareManifestField(issues, row, manifest, "schemaVersion", "workflow_v2_worker_adapter_job.v1");
  workflowV2CompareManifestField(issues, row, manifest, "contract.manifestSchemaVersion", "workflow_v2_worker_adapter_job.v1");
  workflowV2CompareManifestField(issues, row, manifest, "contract.runnerRequestSchemaVersion", "workflow_v2_external_adapter_runner_request.v1");
  workflowV2CompareManifestField(issues, row, manifest, "contract.taskInputReadAction", "workflow.v2.info_stack.read");
  workflowV2CompareManifestField(issues, row, manifest, "contract.submitAction", "workflow.v2.worker_result.submit");
  workflowV2CompareManifestField(issues, row, manifest, "contract.failAction", "workflow.v2.worker_result.fail");
  workflowV2CompareManifestField(issues, row, manifest, "contract.receiptRequired", true);
  workflowV2CompareManifestField(issues, row, manifest, "contract.managerReviewRequired", true);
  workflowV2CompareManifestField(issues, row, manifest, "adapterJobId", row.adapter_job_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "workflowId", row.workflow_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "planId", row.plan_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "nodeId", row.node_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "workerRunId", row.worker_run_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "sessionRunId", row.session_run_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "sessionId", row.worker_session_id || row.session_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "managerAgent", row.worker_manager_agent || "");
  workflowV2CompareManifestField(issues, row, manifest, "workerAgentId", row.worker_agent_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "runtimeBackend", row.runtime_backend || "");
  workflowV2CompareManifestField(issues, row, manifest, "lease.attempt", Number(row.worker_attempt || 0));
  workflowV2CompareManifestField(issues, row, manifest, "taskInput.infoId", row.worker_task_input_info_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "taskInput.readAction", "workflow.v2.info_stack.read");
  workflowV2CompareManifestField(issues, row, manifest, "output.expectedOutputInfoId", row.worker_output_info_id || `${row.worker_run_id || ""}.output`);
  workflowV2CompareManifestField(issues, row, manifest, "output.submitAction", "workflow.v2.worker_result.submit");
  workflowV2CompareManifestField(issues, row, manifest, "output.failAction", "workflow.v2.worker_result.fail");
  workflowV2CompareManifestField(issues, row, manifest, "output.receiptRequired", true);
  workflowV2CompareManifestField(issues, row, manifest, "output.managerReviewRequired", true);
  workflowV2CompareManifestField(issues, row, manifest, "constraints.noDirectDatabaseWrites", true);
  workflowV2CompareManifestField(issues, row, manifest, "constraints.noProductionSecrets", true);
  if (row.preflight_row_id) {
    workflowV2CompareManifestField(issues, row, manifest, "preflight.preflightId", row.preflight_row_id || "");
    workflowV2CompareManifestField(issues, row, manifest, "preflight.backendId", row.preflight_backend_id || "");
    workflowV2CompareManifestField(issues, row, manifest, "preflight.status", row.preflight_status || "");
    if (!["pass", "warn"].includes(row.preflight_status || "")) {
      issues.push(workflowV2AdapterManifestContractIssue(row, "manifest_preflight_status_not_runnable", {
        status: row.preflight_status || ""
      }));
    }
  }
  const sessionWorkerInput = (() => {
    try {
      return JSON.parse(row.session_worker_input_json || "{}");
    } catch {
      return {};
    }
  })();
  workflowV2CompareManifestField(issues, row, manifest, "sessionInput.schemaVersion", sessionWorkerInput.schemaVersion);
  workflowV2CompareManifestField(issues, row, manifest, "sessionInput.input.schemaVersion", workflowV2ObjectValue(sessionWorkerInput, "input.schemaVersion"));
  workflowV2CompareManifestField(issues, row, manifest, "sessionInput.input.workerRunId", row.worker_run_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "sessionInput.input.taskInputInfoId", row.worker_task_input_info_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "sessionInput.context.workflowId", row.workflow_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "sessionInput.context.taskId", row.node_id || "");
  workflowV2CompareManifestField(issues, row, manifest, "context.limitTokens", Number(row.worker_context_budget_tokens || 0));
  workflowV2CompareManifestField(issues, row, manifest, "context.usedTokens", Number(row.worker_context_used_tokens || 0));
  workflowV2CompareManifestField(issues, row, manifest, "context.compactionCount", Number(row.worker_compaction_count || 0));
  return issues;
}

export function workflowV2AdapterManifestContractErrorMessage(adapterJobId = "", issues = []) {
  const firstIssue = issues[0] || {};
  const reason = firstIssue.reason || "manifest_contract_invalid";
  const field = firstIssue.field ? ` field=${firstIssue.field}` : "";
  const count = issues.length ? ` issues=${issues.length}` : "";
  return `workflow v2 adapter job manifest contract invalid: ${adapterJobId || firstIssue.adapterJobId || ""} reason=${reason}${field}${count}`;
}
