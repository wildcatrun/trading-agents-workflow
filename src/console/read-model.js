import { dbReadable, parseJson, redact, sqlite, sqlValue, toInt } from "./sqlite.js";

const DEFAULT_LIMIT = 100;

function clampLimit(value, fallback = DEFAULT_LIMIT, max = 500) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(number)));
}

function workflowViewWhere(view) {
  if (view === "active") return "wr.status='active'";
  if (view === "waiting_human") return "wr.status='waiting_human'";
  if (view === "blocked") return "wr.status='blocked'";
  if (view === "paused") return "wr.status='paused'";
  if (view === "updated_24h") return `wr.updated_at >= datetime('now', '-1 day')`;
  return "";
}

function parseWorkflowRow(row) {
  return {
    workflowId: row.workflow_id,
    workflowType: row.workflow_type,
    status: row.status,
    ownerAgent: row.owner_agent,
    summary: row.summary || "",
    objective: row.objective || "",
    acceptanceCriteria: row.acceptance_criteria || "",
    stopCondition: row.stop_condition || "",
    currentPhase: row.current_phase || "",
    currentDecision: row.current_decision || "",
    payload: redact(parseJson(row.payload_json, {})),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    counts: {
      tasks: toInt(row.task_count),
      pending: toInt(row.pending_tasks),
      inProgress: toInt(row.in_progress_tasks),
      done: toInt(row.done_tasks),
      blocked: toInt(row.blocked_tasks),
      pendingHumanGates: toInt(row.pending_human_gates),
      queuedDispatches: toInt(row.queued_dispatches),
      sentDispatches: toInt(row.sent_dispatches),
      failedDispatches: toInt(row.failed_dispatches),
      queuedOutbox: toInt(row.queued_outbox),
      failedOutbox: toInt(row.failed_outbox),
      openIncidents: toInt(row.open_incidents),
      sideEffectUncertain: toInt(row.side_effect_uncertain)
    },
    latestCheckpoint: row.latest_checkpoint_id ? {
      checkpointId: row.latest_checkpoint_id,
      createdAt: row.latest_checkpoint_at || "",
      path: row.latest_checkpoint_path || ""
    } : null
  };
}

export class WorkflowReadModel {
  constructor(paths) {
    this.paths = paths;
  }

  async health() {
    const readable = await dbReadable(this.paths.dbFile);
    let schemaVersion = "";
    if (readable) {
      const rows = await sqlite(this.paths.dbFile, "SELECT value FROM schema_meta WHERE key='workflow_schema_version' LIMIT 1;");
      schemaVersion = rows[0]?.value || "";
    }
    return { dbReadable: readable, schemaVersion };
  }

  async workflowList(query = {}) {
    const limit = clampLimit(query.limit);
    const filters = [];
    const viewFilter = query.view === undefined ? workflowViewWhere("active") : workflowViewWhere(query.view);
    if (viewFilter) filters.push(viewFilter);
    if (query.status) filters.push(`wr.status=${sqlValue(query.status)}`);
    if (query.owner) filters.push(`wr.owner_agent=${sqlValue(query.owner)}`);
    if (query.q) {
      const q = `%${String(query.q).trim()}%`;
      filters.push(`(wr.workflow_id LIKE ${sqlValue(q)} OR wr.summary LIKE ${sqlValue(q)} OR wr.objective LIKE ${sqlValue(q)})`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const rows = await sqlite(this.paths.dbFile, `
SELECT wr.*,
  (SELECT COUNT(*) FROM workflow_tasks wt WHERE wt.workflow_id=wr.workflow_id) AS task_count,
  (SELECT COUNT(*) FROM workflow_tasks wt WHERE wt.workflow_id=wr.workflow_id AND wt.status='pending') AS pending_tasks,
  (SELECT COUNT(*) FROM workflow_tasks wt WHERE wt.workflow_id=wr.workflow_id AND wt.status='in_progress') AS in_progress_tasks,
  (SELECT COUNT(*) FROM workflow_tasks wt WHERE wt.workflow_id=wr.workflow_id AND wt.status='done') AS done_tasks,
  (SELECT COUNT(*) FROM workflow_tasks wt WHERE wt.workflow_id=wr.workflow_id AND wt.status IN ('blocked','failed')) AS blocked_tasks,
  (
    (SELECT COUNT(*) FROM protocol_objects po WHERE po.object_type='human_gate_record' AND po.status='pending' AND (po.parent_object_id=wr.workflow_id OR po.payload_json LIKE '%' || wr.workflow_id || '%')) +
    (SELECT COUNT(*) FROM review_gates rg WHERE rg.workflow_id=wr.workflow_id AND (rg.status='pending' OR (rg.human_gate_required=1 AND rg.status NOT IN ('approved','rejected','waived','expired','cancelled','done')))) +
    (SELECT COUNT(*) FROM workflow_tasks wt WHERE wt.workflow_id=wr.workflow_id AND wt.human_gate_required=1 AND wt.status NOT IN ('done','failed','cancelled'))
  ) AS pending_human_gates,
  (SELECT COUNT(*) FROM mixed_meeting_dispatches md WHERE md.workflow_id=wr.workflow_id AND md.status='queued') AS queued_dispatches,
  (SELECT COUNT(*) FROM mixed_meeting_dispatches md WHERE md.workflow_id=wr.workflow_id AND md.status='sent') AS sent_dispatches,
  (SELECT COUNT(*) FROM mixed_meeting_dispatches md WHERE md.workflow_id=wr.workflow_id AND md.status='failed') AS failed_dispatches,
  (SELECT COUNT(*) FROM telegram_outbox tg WHERE tg.meeting_id=wr.workflow_id AND tg.status='queued') AS queued_outbox,
  (SELECT COUNT(*) FROM telegram_outbox tg WHERE tg.meeting_id=wr.workflow_id AND tg.status='failed') AS failed_outbox,
  (SELECT COUNT(*) FROM incident_states inc WHERE inc.status IN ('active','mitigating','monitoring') AND inc.payload_json LIKE '%' || wr.workflow_id || '%') AS open_incidents,
  (SELECT COUNT(*) FROM side_effect_ledger se WHERE se.workflow_id=wr.workflow_id AND se.status='uncertain') AS side_effect_uncertain,
  (SELECT wc.checkpoint_id FROM workflow_checkpoints wc WHERE wc.workflow_id=wr.workflow_id ORDER BY wc.created_at DESC LIMIT 1) AS latest_checkpoint_id,
  (SELECT wc.created_at FROM workflow_checkpoints wc WHERE wc.workflow_id=wr.workflow_id ORDER BY wc.created_at DESC LIMIT 1) AS latest_checkpoint_at,
  (SELECT wc.path FROM workflow_checkpoints wc WHERE wc.workflow_id=wr.workflow_id ORDER BY wc.created_at DESC LIMIT 1) AS latest_checkpoint_path
FROM workflow_runs wr
${where}
ORDER BY wr.updated_at DESC
LIMIT ${limit};`);
    return { count: rows.length, workflows: rows.map(parseWorkflowRow) };
  }

  async workflowDetail(workflowId) {
    const rows = await sqlite(this.paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`);
    if (!rows[0]) return null;
    const list = await this.workflowList({ q: workflowId, limit: 50, view: "" });
    const enriched = list.workflows.find((item) => item.workflowId === workflowId);
    return enriched || parseWorkflowRow(rows[0]);
  }

  async tasks(workflowId) {
    const rows = await sqlite(this.paths.dbFile, `SELECT * FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)} ORDER BY created_at;`);
    const edges = await sqlite(this.paths.dbFile, `
SELECT task_id, depends_on_task_id FROM workflow_task_dependencies
WHERE task_id IN (SELECT task_id FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)})
ORDER BY task_id, depends_on_task_id;`);
    return {
      workflowId,
      tasks: rows.map((row) => ({
        taskId: row.task_id,
        parentTaskId: row.parent_task_id || "",
        phase: row.phase || "",
        ownerAgent: row.owner_agent,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        taskType: row.task_type,
        status: row.status,
        priority: row.priority,
        dependsOn: parseJson(row.depends_on_json, []),
        expectedArtifact: row.expected_artifact || "",
        actualArtifactRef: row.actual_artifact_ref || "",
        receiptRequired: Boolean(Number(row.receipt_required || 0)),
        humanGateRequired: Boolean(Number(row.human_gate_required || 0)),
        summary: row.summary || "",
        blockedReason: row.blocked_reason || "",
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      edges: edges.map((row) => ({ from: row.depends_on_task_id, to: row.task_id, type: "depends_on" }))
    };
  }

  async dispatches(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    const rows = await sqlite(this.paths.dbFile, `
SELECT d.*,
  (SELECT rr.runtime_run_id FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY rr.started_at DESC LIMIT 1) AS latest_runtime_run_id,
  (SELECT rr.status FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY rr.started_at DESC LIMIT 1) AS latest_runtime_status,
  (SELECT rr.error FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY rr.started_at DESC LIMIT 1) AS latest_runtime_error
FROM mixed_meeting_dispatches d
WHERE d.workflow_id=${sqlValue(workflowId)}
ORDER BY d.created_at DESC
LIMIT ${limit};`);
    return { workflowId, count: rows.length, dispatches: rows.map((row) => ({ ...row, payload: redact(parseJson(row.payload_json, {})), payload_json: undefined })) };
  }

  async runtimeRuns(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    const rows = await sqlite(this.paths.dbFile, `
SELECT * FROM runtime_runs
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY started_at DESC
LIMIT ${limit};`);
    return { workflowId, count: rows.length, runtimeRuns: rows.map((row) => ({ ...row, payload: redact(parseJson(row.payload_json, {})), payload_json: undefined })) };
  }

  async humanGates(workflowId) {
    const records = await sqlite(this.paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at, updated_at
FROM protocol_objects
WHERE object_type='human_gate_record'
  AND (parent_object_id=${sqlValue(workflowId)} OR payload_json LIKE ${sqlValue(`%${workflowId}%`)})
ORDER BY created_at DESC;`);
    const buttons = await sqlite(this.paths.dbFile, `
SELECT button_id, human_gate_id, workflow_id, meeting_id, label, decision_status, button_role, artifact_ref, summary, prompt, payload_json, status, created_by, created_at, updated_at, selected_by, selected_at, feedback_status, feedback_received_at
FROM human_gate_buttons
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at ASC;`);
    const batches = await sqlite(this.paths.dbFile, `
SELECT b.batch_id, b.status, b.title, b.target_ref, b.risk_summary_json, b.default_action, b.html_path, b.json_path, b.telegram_summary, b.created_by, b.created_at, b.updated_at
FROM human_gate_batches b
WHERE b.batch_id IN (SELECT batch_id FROM human_gate_batch_items WHERE workflow_id=${sqlValue(workflowId)})
ORDER BY b.created_at DESC
LIMIT 50;`);
    return {
      workflowId,
      records: records.map((row) => ({ ...row, payload: redact(parseJson(row.payload_json, {})), payload_json: undefined })),
      buttons: buttons.map((row) => ({ ...row, payload: redact(parseJson(row.payload_json, {})), payload_json: undefined })),
      batches: batches.map((row) => ({ ...row, riskSummary: parseJson(row.risk_summary_json, {}), risk_summary_json: undefined }))
    };
  }

  async outbox(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    const rows = await sqlite(this.paths.dbFile, `
SELECT * FROM telegram_outbox
WHERE meeting_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT ${limit};`);
    return {
      workflowId,
      count: rows.length,
      outbox: rows.map((row) => ({
        outboxId: row.outbox_id,
        meetingId: row.meeting_id || "",
        targetKind: row.target_kind,
        targetRef: row.target_ref || "",
        messageType: row.message_type,
        status: row.status,
        textPreview: String(row.text || "").slice(0, 500),
        payload: redact(parseJson(row.payload_json, {})),
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
    };
  }

  async checkpoints(workflowId) {
    const rows = await sqlite(this.paths.dbFile, `
SELECT * FROM workflow_checkpoints
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 100;`);
    return {
      workflowId,
      count: rows.length,
      checkpoints: rows.map((row) => ({
        checkpointId: row.checkpoint_id,
        status: row.status,
        phase: row.phase || "",
        decision: row.decision || "",
        summary: row.summary || "",
        resumePayload: redact(parseJson(row.resume_payload_json, {})),
        activeTasks: parseJson(row.active_tasks_json, []),
        blockedTasks: parseJson(row.blocked_tasks_json, []),
        artifactRefs: parseJson(row.artifact_refs_json, []),
        nextActions: parseJson(row.next_actions_json, []),
        contextBudget: parseJson(row.context_budget_json, {}),
        path: row.path || "",
        createdBy: row.created_by,
        createdAt: row.created_at
      }))
    };
  }

  async evidence(workflowId) {
    const artifacts = await sqlite(this.paths.dbFile, `
SELECT artifact_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 200;`);
    const sideEffects = await sqlite(this.paths.dbFile, `
SELECT side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, artifact_ref, payload_json, created_at, updated_at
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 200;`);
    return {
      workflowId,
      artifacts,
      sideEffects: sideEffects.map((row) => ({ ...row, payload: redact(parseJson(row.payload_json, {})), payload_json: undefined }))
    };
  }

  async runtimeAgents() {
    const rows = await sqlite(this.paths.dbFile, "SELECT * FROM runtime_agents ORDER BY runtime, agent_id;");
    return {
      warnings: [
        "main is Cat Brain id.",
        "cat_claw is OpenClaw secretary/Human Gate entrance, not a Hermes profile.",
        "openclaw_route_shell is a route shell, not a second executor."
      ],
      count: rows.length,
      agents: rows.map((row) => ({
        ...row,
        capabilities: redact(parseJson(row.capabilities_json, {})),
        metadata: redact(parseJson(row.metadata_json, {})),
        capabilities_json: undefined,
        metadata_json: undefined
      }))
    };
  }

  async operationsSummary() {
    const jobs = await sqlite(this.paths.dbFile, `
SELECT status, job_type, COUNT(*) AS count
FROM control_loop_jobs
GROUP BY status, job_type
ORDER BY status, job_type;`);
    const staleDispatches = await sqlite(this.paths.dbFile, `
SELECT dispatch_id, workflow_id, runtime, agent_id, status, attempt, max_attempts, updated_at, failure_type, last_error
FROM mixed_meeting_dispatches
WHERE (status='sent' AND updated_at < datetime('now', '-30 minutes'))
   OR status='failed'
ORDER BY updated_at ASC
LIMIT 100;`);
    const outbox = await sqlite(this.paths.dbFile, `
SELECT status, message_type, COUNT(*) AS count
FROM telegram_outbox
GROUP BY status, message_type
ORDER BY status, message_type;`);
    const humanGate = await sqlite(this.paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM protocol_objects
WHERE object_type='human_gate_record'
GROUP BY status
ORDER BY status;`);
    const readiness = await this.readinessLatest();
    return { controlLoopJobs: jobs, staleDispatches, telegramOutbox: outbox, humanGate, readiness };
  }

  async readinessLatest() {
    const rows = await sqlite(this.paths.dbFile, `
SELECT * FROM readiness_snapshots
ORDER BY checked_at DESC
LIMIT 1;`);
    const row = rows[0];
    if (!row) return null;
    return {
      snapshotId: row.snapshot_id,
      status: row.status,
      checkedAt: row.checked_at,
      planes: redact(parseJson(row.planes_json, {})),
      findings: redact(parseJson(row.findings_json, [])),
      payload: redact(parseJson(row.payload_json, {}))
    };
  }
}
