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

function compactText(value, limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}...`;
}

function timelineSeverity(status = "") {
  const value = String(status || "").toLowerCase();
  if (["failed", "blocked", "cancelled", "rejected", "expired", "uncertain"].includes(value)) return "critical";
  if (["pending", "queued", "waiting_human", "mitigating", "monitoring", "route_registered", "runtime_dispatched", "outbound_queued"].includes(value)) return "warning";
  if (["done", "completed", "approved", "sent", "acked", "success", "resolved", "runtime_completed", "telegram_sent"].includes(value)) return "ok";
  return "neutral";
}

function pushTimelineEvent(events, event) {
  if (!event?.at) return;
  events.push({
    at: event.at,
    kind: event.kind,
    status: event.status || "",
    severity: event.severity || timelineSeverity(event.status),
    title: event.title,
    subtitle: event.subtitle || "",
    actor: event.actor || "",
    refId: event.refId || "",
    payload: event.payload ? redact(event.payload) : undefined
  });
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

  async messageFlows(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    const flowWhere = `(workflow_id=${sqlValue(workflowId)} OR meeting_id=${sqlValue(workflowId)})`;
    const flows = await sqlite(this.paths.dbFile, `
SELECT flow_id, trace_id, idempotency_key, meeting_id, workflow_id, dispatch_id, runtime_run_id, outbox_id,
  source_channel, source_system, source_runtime, source_account_id, source_chat_id, sender_id, source_message_id,
  route_agent_id, route_runtime, target_runtime, target_agent_id, target_platform, workflow_ingress_adapter,
  im_identity, execution_identity, return_policy, status, inbound_received_at, route_registered_at,
  runtime_dispatched_at, runtime_completed_at, runtime_failed_at, outbound_queued_at, telegram_sent_at,
  telegram_failed_at, completed_at, failure_type, last_error, final_output_present, delivery_receipt_present,
  payload_json, created_at, updated_at
FROM message_flows
WHERE ${flowWhere}
ORDER BY updated_at DESC
LIMIT ${limit};`);
    const events = await sqlite(this.paths.dbFile, `
SELECT e.event_id, e.flow_id, e.status, e.event_type, e.payload_json, e.created_at,
  mf.return_policy, mf.target_runtime, mf.target_agent_id, mf.dispatch_id
FROM message_flow_events e
JOIN message_flows mf ON mf.flow_id=e.flow_id
WHERE ${flowWhere.replace(/workflow_id/g, "mf.workflow_id").replace(/meeting_id/g, "mf.meeting_id")}
ORDER BY e.created_at DESC
LIMIT ${limit};`);
    const summary = await sqlite(this.paths.dbFile, `
SELECT status, return_policy, target_runtime, COUNT(*) AS count,
  SUM(CASE WHEN final_output_present=1 THEN 1 ELSE 0 END) AS final_output_present,
  SUM(CASE WHEN delivery_receipt_present=1 THEN 1 ELSE 0 END) AS delivery_receipt_present
FROM message_flows
WHERE ${flowWhere}
GROUP BY status, return_policy, target_runtime
ORDER BY status, return_policy, target_runtime;`);
    return {
      workflowId,
      count: flows.length,
      flows: flows.map((row) => ({
        flowId: row.flow_id,
        traceId: row.trace_id || "",
        idempotencyKey: row.idempotency_key || "",
        meetingId: row.meeting_id || "",
        workflowId: row.workflow_id || "",
        dispatchId: row.dispatch_id || "",
        runtimeRunId: row.runtime_run_id || "",
        outboxId: row.outbox_id || "",
        source: {
          channel: row.source_channel || "",
          system: row.source_system || "",
          runtime: row.source_runtime || "",
          accountId: row.source_account_id || "",
          chatId: row.source_chat_id || "",
          senderId: row.sender_id || "",
          sourceMessageId: row.source_message_id || ""
        },
        routeAgentId: row.route_agent_id || "",
        routeRuntime: row.route_runtime || "",
        targetRuntime: row.target_runtime || "",
        targetAgentId: row.target_agent_id || "",
        targetPlatform: row.target_platform || "",
        workflowIngressAdapter: row.workflow_ingress_adapter || "",
        imIdentity: row.im_identity || "",
        executionIdentity: row.execution_identity || "",
        returnPolicy: row.return_policy || "",
        status: row.status,
        finalOutputPresent: Boolean(Number(row.final_output_present || 0)),
        deliveryReceiptPresent: Boolean(Number(row.delivery_receipt_present || 0)),
        failureType: row.failure_type || "",
        lastError: row.last_error || "",
        timestamps: {
          inboundReceivedAt: row.inbound_received_at || "",
          routeRegisteredAt: row.route_registered_at || "",
          runtimeDispatchedAt: row.runtime_dispatched_at || "",
          runtimeCompletedAt: row.runtime_completed_at || "",
          runtimeFailedAt: row.runtime_failed_at || "",
          outboundQueuedAt: row.outbound_queued_at || "",
          telegramSentAt: row.telegram_sent_at || "",
          telegramFailedAt: row.telegram_failed_at || "",
          completedAt: row.completed_at || "",
          createdAt: row.created_at || "",
          updatedAt: row.updated_at || ""
        },
        payload: redact(parseJson(row.payload_json, {}))
      })),
      events: events.map((row) => ({
        eventId: row.event_id,
        flowId: row.flow_id,
        status: row.status,
        eventType: row.event_type,
        returnPolicy: row.return_policy || "",
        targetRuntime: row.target_runtime || "",
        targetAgentId: row.target_agent_id || "",
        dispatchId: row.dispatch_id || "",
        payload: redact(parseJson(row.payload_json, {})),
        createdAt: row.created_at
      })),
      summary: summary.map((row) => ({
        status: row.status,
        returnPolicy: row.return_policy || "",
        targetRuntime: row.target_runtime || "",
        count: toInt(row.count),
        finalOutputPresent: toInt(row.final_output_present),
        deliveryReceiptPresent: toInt(row.delivery_receipt_present)
      }))
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

  async timeline(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 160, 300);
    const events = [];
    const [
      tasks,
      dispatches,
      runtimeRuns,
      humanGateRecords,
      humanGateButtons,
      outbox,
      checkpoints,
      artifacts,
      sideEffects,
      incidents,
      messageFlowEvents
    ] = await Promise.all([
      sqlite(this.paths.dbFile, `
SELECT task_id, parent_task_id, phase, owner_agent, runtime, agent_id, task_type, status, priority, summary, blocked_reason, created_at, updated_at
FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY updated_at DESC
LIMIT 120;`),
      sqlite(this.paths.dbFile, `
SELECT dispatch_id, runtime, agent_id, dispatch_type, status, priority, prompt, created_by, created_at, updated_at, sent_at, acked_at, completed_at, failure_type, last_error, payload_json
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 120;`),
      sqlite(this.paths.dbFile, `
SELECT runtime_run_id, dispatch_id, runtime, agent_id, adapter, backend, acp_agent, status, failure_type, attempt, started_at, completed_at, latency_ms, error, payload_json
FROM runtime_runs
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY started_at DESC
LIMIT 120;`),
      sqlite(this.paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at, updated_at
FROM protocol_objects
WHERE object_type='human_gate_record'
  AND (parent_object_id=${sqlValue(workflowId)} OR payload_json LIKE ${sqlValue(`%${workflowId}%`)})
ORDER BY created_at DESC
LIMIT 80;`),
      sqlite(this.paths.dbFile, `
SELECT button_id, human_gate_id, label, decision_status, button_role, summary, status, created_by, created_at, updated_at, selected_by, selected_at, feedback_status, feedback_received_at, payload_json
FROM human_gate_buttons
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 120;`),
      sqlite(this.paths.dbFile, `
SELECT outbox_id, target_kind, target_ref, message_type, status, text, created_at, updated_at, payload_json
FROM telegram_outbox
WHERE meeting_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 100;`),
      sqlite(this.paths.dbFile, `
SELECT checkpoint_id, status, phase, decision, summary, path, created_by, created_at
FROM workflow_checkpoints
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 80;`),
      sqlite(this.paths.dbFile, `
SELECT artifact_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 100;`),
      sqlite(this.paths.dbFile, `
SELECT side_effect_id, trace_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, artifact_ref, payload_json, created_at, updated_at
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 100;`),
      sqlite(this.paths.dbFile, `
SELECT incident_id, status, mode, summary, commander, impact, mitigation, declared_at, next_update_at, resolved_at, updated_at, payload_json
FROM incident_states
WHERE payload_json LIKE ${sqlValue(`%${workflowId}%`)}
ORDER BY declared_at DESC
LIMIT 80;`),
      sqlite(this.paths.dbFile, `
SELECT e.event_id, e.flow_id, e.status, e.event_type, e.payload_json, e.created_at,
  mf.return_policy, mf.target_runtime, mf.target_agent_id, mf.dispatch_id
FROM message_flow_events e
JOIN message_flows mf ON mf.flow_id=e.flow_id
WHERE mf.workflow_id=${sqlValue(workflowId)} OR mf.meeting_id=${sqlValue(workflowId)}
ORDER BY e.created_at DESC
LIMIT 120;`)
    ]);

    for (const row of tasks) {
      pushTimelineEvent(events, {
        at: row.updated_at || row.created_at,
        kind: "task",
        status: row.status,
        title: `Task ${row.status}: ${row.task_id}`,
        subtitle: compactText(row.summary || row.blocked_reason || row.task_type),
        actor: row.owner_agent || row.agent_id,
        refId: row.task_id,
        payload: {
          phase: row.phase,
          runtime: row.runtime,
          agentId: row.agent_id,
          priority: row.priority,
          blockedReason: row.blocked_reason
        }
      });
    }

    for (const row of dispatches) {
      const basePayload = {
        runtime: row.runtime,
        agentId: row.agent_id,
        dispatchType: row.dispatch_type,
        priority: row.priority,
        promptPreview: compactText(row.prompt, 240),
        failureType: row.failure_type,
        lastError: compactText(row.last_error, 240),
        payload: parseJson(row.payload_json, {})
      };
      pushTimelineEvent(events, {
        at: row.created_at,
        kind: "dispatch.created",
        status: "created",
        severity: "neutral",
        title: `Dispatch created: ${row.dispatch_id}`,
        subtitle: `${row.runtime}:${row.agent_id} / ${row.dispatch_type}`,
        actor: row.created_by,
        refId: row.dispatch_id,
        payload: basePayload
      });
      if (row.sent_at) {
        pushTimelineEvent(events, {
          at: row.sent_at,
          kind: "dispatch.sent",
          status: "sent",
          title: `Dispatch sent: ${row.dispatch_id}`,
          subtitle: `${row.runtime}:${row.agent_id}`,
          actor: row.created_by,
          refId: row.dispatch_id,
          payload: basePayload
        });
      }
      if (row.acked_at) {
        pushTimelineEvent(events, {
          at: row.acked_at,
          kind: "dispatch.acked",
          status: "acked",
          title: `Dispatch acked: ${row.dispatch_id}`,
          subtitle: `${row.runtime}:${row.agent_id}`,
          actor: row.created_by,
          refId: row.dispatch_id,
          payload: basePayload
        });
      }
      if (row.completed_at || row.status === "failed") {
        pushTimelineEvent(events, {
          at: row.completed_at || row.updated_at,
          kind: "dispatch.completed",
          status: row.status,
          title: `Dispatch ${row.status}: ${row.dispatch_id}`,
          subtitle: compactText(row.last_error || `${row.runtime}:${row.agent_id}`),
          actor: row.created_by,
          refId: row.dispatch_id,
          payload: basePayload
        });
      }
    }

    for (const row of runtimeRuns) {
      pushTimelineEvent(events, {
        at: row.started_at,
        kind: "runtime.started",
        status: "started",
        severity: "neutral",
        title: `Runtime started: ${row.runtime_run_id}`,
        subtitle: `${row.runtime}:${row.agent_id} / ${row.adapter}`,
        actor: row.agent_id,
        refId: row.runtime_run_id,
        payload: {
          dispatchId: row.dispatch_id,
          backend: row.backend,
          acpAgent: row.acp_agent,
          attempt: row.attempt,
          payload: parseJson(row.payload_json, {})
        }
      });
      if (row.completed_at || row.status === "failed") {
        pushTimelineEvent(events, {
          at: row.completed_at || row.started_at,
          kind: "runtime.completed",
          status: row.status,
          title: `Runtime ${row.status}: ${row.runtime_run_id}`,
          subtitle: compactText(row.error || `${row.latency_ms || 0} ms`),
          actor: row.agent_id,
          refId: row.runtime_run_id,
          payload: {
            dispatchId: row.dispatch_id,
            failureType: row.failure_type,
            latencyMs: row.latency_ms,
            error: compactText(row.error, 240),
            payload: parseJson(row.payload_json, {})
          }
        });
      }
    }

    for (const row of humanGateRecords) {
      pushTimelineEvent(events, {
        at: row.updated_at || row.created_at,
        kind: "human_gate.record",
        status: row.status,
        title: `Human Gate ${row.status}: ${row.object_id}`,
        subtitle: row.path || row.parent_object_id || "",
        actor: row.source_agent,
        refId: row.object_id,
        payload: parseJson(row.payload_json, {})
      });
    }

    for (const row of humanGateButtons) {
      pushTimelineEvent(events, {
        at: row.selected_at || row.feedback_received_at || row.updated_at || row.created_at,
        kind: "human_gate.button",
        status: row.selected_at ? "selected" : row.status,
        severity: row.selected_at ? "ok" : timelineSeverity(row.status),
        title: `Human Gate button: ${row.label}`,
        subtitle: compactText(row.summary || row.prompt || row.decision_status),
        actor: row.selected_by || row.created_by,
        refId: row.button_id,
        payload: {
          humanGateId: row.human_gate_id,
          decisionStatus: row.decision_status,
          buttonRole: row.button_role,
          feedbackStatus: row.feedback_status,
          payload: parseJson(row.payload_json, {})
        }
      });
    }

    for (const row of outbox) {
      pushTimelineEvent(events, {
        at: row.updated_at || row.created_at,
        kind: "outbox",
        status: row.status,
        title: `Telegram outbox ${row.status}: ${row.outbox_id}`,
        subtitle: compactText(row.text || row.message_type),
        actor: row.target_ref,
        refId: row.outbox_id,
        payload: {
          targetKind: row.target_kind,
          targetRef: row.target_ref,
          messageType: row.message_type,
          payload: parseJson(row.payload_json, {})
        }
      });
    }

    for (const row of checkpoints) {
      pushTimelineEvent(events, {
        at: row.created_at,
        kind: "checkpoint",
        status: row.status,
        title: `Checkpoint: ${row.checkpoint_id}`,
        subtitle: compactText(row.summary || row.decision || row.phase),
        actor: row.created_by,
        refId: row.checkpoint_id,
        payload: { phase: row.phase, decision: row.decision, path: row.path }
      });
    }

    for (const row of artifacts) {
      pushTimelineEvent(events, {
        at: row.created_at,
        kind: "artifact",
        status: "created",
        severity: "ok",
        title: `Artifact: ${row.artifact_id}`,
        subtitle: compactText(row.summary || row.path || row.kind),
        actor: row.created_by,
        refId: row.artifact_id,
        payload: { kind: row.kind, path: row.path }
      });
    }

    for (const row of sideEffects) {
      pushTimelineEvent(events, {
        at: row.updated_at || row.created_at,
        kind: "side_effect",
        status: row.status,
        title: `Side effect ${row.status}: ${row.side_effect_id}`,
        subtitle: compactText(row.artifact_ref || row.side_effect_type),
        actor: row.owner_agent,
        refId: row.side_effect_id,
        payload: {
          traceId: row.trace_id,
          dispatchId: row.dispatch_id,
          sideEffectType: row.side_effect_type,
          artifactRef: row.artifact_ref,
          payload: parseJson(row.payload_json, {})
        }
      });
    }

    for (const row of incidents) {
      pushTimelineEvent(events, {
        at: row.resolved_at || row.updated_at || row.declared_at,
        kind: "incident",
        status: row.status,
        title: `Incident ${row.status}: ${row.incident_id}`,
        subtitle: compactText(row.summary || row.impact || row.mitigation),
        actor: row.commander,
        refId: row.incident_id,
        payload: {
          mode: row.mode,
          impact: row.impact,
          mitigation: row.mitigation,
          nextUpdateAt: row.next_update_at,
          payload: parseJson(row.payload_json, {})
        }
      });
    }

    for (const row of messageFlowEvents) {
      const payload = parseJson(row.payload_json, {});
      pushTimelineEvent(events, {
        at: row.created_at,
        kind: "message_flow",
        status: row.status,
        title: `Message flow ${row.event_type}: ${row.flow_id}`,
        subtitle: `${row.return_policy || "-"} / ${row.target_runtime || "-"}:${row.target_agent_id || "-"}`,
        actor: row.target_agent_id,
        refId: row.flow_id,
        payload: {
          eventId: row.event_id,
          eventType: row.event_type,
          returnPolicy: row.return_policy,
          targetRuntime: row.target_runtime,
          targetAgentId: row.target_agent_id,
          dispatchId: row.dispatch_id,
          payload
        }
      });
    }

    events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return {
      workflowId,
      count: Math.min(events.length, limit),
      totalEvents: events.length,
      events: events.slice(0, limit)
    };
  }

  async runtimeAgents() {
    const rows = await sqlite(this.paths.dbFile, "SELECT * FROM runtime_agents ORDER BY platform, agent_id;");
    return {
      warnings: [
        "main is Cat Brain id.",
        "cat_claw is OpenClaw secretary/Human Gate entrance, not a Hermers profile.",
        "openclaw_route_shell is a route shell, not a second executor.",
        "platform and workflow_ingress_adapter are the routing source of truth; ACP is an adapter, not a platform."
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
    const messageFlow = await sqlite(this.paths.dbFile, `
SELECT status, return_policy, target_runtime, COUNT(*) AS count,
  SUM(CASE WHEN final_output_present=1 THEN 1 ELSE 0 END) AS final_output_present,
  SUM(CASE WHEN delivery_receipt_present=1 THEN 1 ELSE 0 END) AS delivery_receipt_present
FROM message_flows
GROUP BY status, return_policy, target_runtime
ORDER BY status, return_policy, target_runtime;`);
    const messageFlowAttention = await sqlite(this.paths.dbFile, `
SELECT flow_id, workflow_id, meeting_id, target_runtime, target_agent_id, return_policy, status,
  final_output_present, delivery_receipt_present, runtime_completed_at, runtime_failed_at,
  outbox_id, updated_at, last_error
FROM message_flows
WHERE
  (
    return_policy IN ('reply_to_source_chat','report_to_flashcat')
    AND delivery_receipt_present=0
    AND target_runtime NOT IN ('local_codex','codex')
    AND (COALESCE(runtime_completed_at,'') != '' OR COALESCE(runtime_failed_at,'') != '')
  )
  OR status IN ('runtime_failed','telegram_failed')
ORDER BY updated_at ASC
LIMIT 100;`);
    const controlLoopJobDetails = await sqlite(this.paths.dbFile, `
SELECT job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json,
  attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at
FROM control_loop_jobs
WHERE job_type IN ('runtime_drain','message_flow_reconcile','telegram_outbox_deliver','human_gate_request_ensure','human_gate_inbox')
ORDER BY updated_at DESC
LIMIT 120;`);
    const readiness = await this.readinessLatest();
    return {
      controlLoopJobs: jobs,
      controlLoopJobDetails: controlLoopJobDetails.map((row) => {
        const payload = parseJson(row.payload_json, {});
        const result = parseJson(row.result_json, {});
        const exactDispatchId = String(payload.dispatchId || payload.dispatch_id || "").trim();
        const dedupeParts = String(row.dedupe_key || "").split(":");
        const dedupeDispatchId = row.job_type === "runtime_drain" && dedupeParts.length >= 3 ? dedupeParts.slice(2).join(":") : "";
        const dispatchId = exactDispatchId || dedupeDispatchId;
        return {
          jobId: row.job_id,
          jobType: row.job_type,
          dedupeKey: row.dedupe_key,
          drainKind: row.job_type === "runtime_drain" ? (dispatchId ? "exact" : "generic") : "",
          exactDispatchId: dispatchId,
          priority: row.priority,
          status: row.status,
          workflowId: row.workflow_id || "",
          runtime: row.runtime || "",
          attempt: toInt(row.attempt),
          maxAttempts: toInt(row.max_attempts),
          nextRunAt: row.next_run_at || "",
          leaseOwner: row.lease_owner || "",
          leaseUntil: row.lease_until || "",
          lastError: row.last_error || "",
          resultStatus: result.status || "",
          payload: redact(payload),
          result: redact(result),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          completedAt: row.completed_at || ""
        };
      }),
      staleDispatches,
      telegramOutbox: outbox,
      humanGate,
      messageFlow,
      messageFlowAttention,
      readiness
    };
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
