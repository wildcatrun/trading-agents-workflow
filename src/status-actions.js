import {
  boolOption,
  safeId
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const STATUS_ACTION_HANDLER_NAMES = {
  "workflow.init": "workflowInit",
  "trading_workflow.init": "workflowInit",
  "workflow.status": "workflowStatus",
  "trading_workflow.status": "workflowStatus",
  "workflow.health": "workflowHealth",
  "workflow.dashboard": "workflowHealth",
  "workflow.health.dashboard": "workflowHealth",
  "trading_workflow.health": "workflowHealth",
  "workflow.readiness": "workflowReadiness",
  "trading_workflow.readiness": "workflowReadiness"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`status action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`status action dependency missing: ${name}`);
  return context[name];
}

const MESSAGE_FLOW_DELIVERY_RETURN_POLICIES = new Set(["reply_to_source_chat", "report_to_flashcat"]);

function nowIso() {
  return new Date().toISOString();
}

function sqlStringList(values) {
  return values.map(sqlValue).join(", ");
}

function readinessStatus(findings) {
  if (findings.some((item) => item.severity === "critical")) return "critical";
  if (findings.some((item) => item.severity === "warning")) return "degraded";
  return "ready";
}

function healthSeverityRank(severity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function healthStatus(blockers = []) {
  if (blockers.some((item) => item.severity === "critical")) return "blocked";
  if (blockers.some((item) => item.severity === "warning")) return "degraded";
  return "ready";
}

function safeJsonExtractSql(column, pathExpression) {
  return `json_extract(CASE WHEN json_valid(${column}) THEN ${column} ELSE '{}' END, ${pathExpression})`;
}

function archivedTerminalFailureSql(alias = "", refColumns = []) {
  const prefix = alias ? `${alias}.` : "";
  const payloadColumn = `${prefix}payload_json`;
  const archiveStatus = safeJsonExtractSql(payloadColumn, "'$.healthArchive.status'");
  const archiveIncidentId = safeJsonExtractSql(payloadColumn, "'$.healthArchive.incidentId'");
  const archiveHumanGateId = safeJsonExtractSql(payloadColumn, "'$.healthArchive.humanGateId'");
  const archiveArtifactRef = safeJsonExtractSql(payloadColumn, "'$.healthArchive.artifactRef'");
  const rowRefChecks = refColumns.map(({ archiveKey, column }) => {
    const archiveRef = safeJsonExtractSql(payloadColumn, sqlValue(`$.healthArchive.${archiveKey}`));
    return `COALESCE(${archiveRef}, '')=COALESCE(${prefix}${column}, '')`;
  });
  return `COALESCE(${archiveStatus}, '')='archived'
    AND COALESCE(${archiveIncidentId}, '')!=''
    AND COALESCE(${archiveHumanGateId}, '')!=''
    AND COALESCE(${archiveArtifactRef}, '')!=''
    AND (${rowRefChecks.length ? rowRefChecks.join(" OR ") : "0"})
    AND EXISTS (
      SELECT 1
      FROM incident_states archive_incident
      WHERE archive_incident.incident_id=${archiveIncidentId}
        AND archive_incident.status='resolved'
        AND COALESCE(${safeJsonExtractSql("archive_incident.payload_json", "'$.closeoutResolution.schemaVersion'")}, '')='workflow_incident_closeout_resolution.v1'
        AND COALESCE(${safeJsonExtractSql("archive_incident.payload_json", "'$.closeoutResolution.humanGateId'")}, '')=COALESCE(${archiveHumanGateId}, '')
        AND COALESCE(${safeJsonExtractSql("archive_incident.payload_json", "'$.closeoutResolution.artifactRef'")}, '')=COALESCE(${archiveArtifactRef}, '')
    )`;
}

function boundedNumber(values, fallback, min, max) {
  const candidates = Array.isArray(values) ? values : [values];
  for (const value of candidates) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(min, Math.min(max, number));
  }
  return Math.max(min, Math.min(max, fallback));
}

function healthRecommendationFor(blocker) {
  const actions = {
    stale_sent_dispatches: ["workflow.dispatch.reconcile", "runtime.bridge.drain"],
    stale_queued_dispatches: ["workflow.control_loop.tick", "runtime.bridge.drain"],
    failed_dispatches: ["workflow.dispatch.reconcile", "workflow.incident.from_dead_letter.preview"],
    failed_control_loop_jobs: ["workflow.control_loop.job.requeue.preview", "workflow.incident.from_dead_letter.preview"],
    expired_control_loop_leases: ["workflow.control_loop.job.requeue.preview", "workflow.control_loop.tick", "workflow.incident.from_dead_letter.preview"],
    message_flow_delivery_missing: ["message_flow.reconcile", "workflow.incident.from_dead_letter.preview"],
    stale_human_gate: ["human_gate.inbox", "human_gate.request"],
    pending_human_gate_without_buttons: ["human_gate.inbox"],
    telegram_outbox_failed: ["telegram.outbox.requeue.preview", "telegram.outbox.delivery.preview"],
    registry_dispatch_disabled: ["workflow.runtime_agents"],
    stale_started_runtime_runs: ["runtime.bridge.drain", "workflow.incident.from_dead_letter.preview"],
    open_incidents: ["workflow.incident.closeout.worklist.preview", "workflow.incident.closeout.evidence.preview", "workflow.incident.closeout.cat_claw_report.preview", "workflow.incident.closeout.human_gate_package.preview"],
    stale_open_incidents: ["workflow.incident.closeout.worklist.preview", "workflow.incident.closeout.evidence.preview", "workflow.incident.closeout.cat_claw_report.preview", "workflow.incident.closeout.human_gate_package.preview"]
  };
  const guidance = {
    stale_sent_dispatches: "Reconcile stale sent dispatches against terminal runtime receipts before retrying.",
    stale_queued_dispatches: "Run the control loop or targeted runtime drain to claim queued dispatches.",
    failed_dispatches: "Inspect failed dispatches and create incident evidence before rerun.",
    failed_control_loop_jobs: "Inspect failed control-loop jobs and decide retry versus incident.",
    expired_control_loop_leases: "Expired leases indicate a worker died or stalled; reclaim through control-loop tick after checking logs.",
    message_flow_delivery_missing: "Runtime finished but governed delivery evidence is missing; reconcile message_flow before resending.",
    stale_human_gate: "Human Gate has been pending too long; refresh inbox/outbox evidence without creating duplicate gates.",
    pending_human_gate_without_buttons: "Human Gate record lacks active buttons; regenerate through the governed Human Gate path.",
    telegram_outbox_failed: "Use requeue preview before redelivery so receipts remain auditable.",
    registry_dispatch_disabled: "Registered runtime agent cannot receive dispatch; fix registry intentionally from local Codex.",
    stale_started_runtime_runs: "Runtime run stayed started past the lease window; inspect runtime adapter and receipt evidence.",
    open_incidents: "Incident states are still open; prepare closeout evidence instead of treating runtime liveness as normal.",
    stale_open_incidents: "Incident states are open past the update window; prepare Cat Claw closeout or Human Gate package evidence."
  };
  return {
    key: blocker.key,
    summary: guidance[blocker.key] || "Inspect the linked evidence and choose a governed recovery action.",
    actions: actions[blocker.key] || ["workflow.readiness"]
  };
}

export function createStatusActionRegistry(handlers = {}) {
  const entries = Object.entries(STATUS_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing status action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runStatusAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createStatusActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const activeReadinessChecks = requireContextFunction(context, "activeReadinessChecks");
  const loadHermersProfileModes = requireContextFunction(context, "loadHermersProfileModes");
  const profileModesReadinessPayload = requireContextFunction(context, "profileModesReadinessPayload");
  const readInstrument = requireContextFunction(context, "readInstrument");
  const WORKFLOW_SCHEMA_VERSION = requireContextValue(context, "WORKFLOW_SCHEMA_VERSION");

  async function workflowReadinessSnapshot(paths, input = {}) {
    const checkedAt = nowIso();
    const dispatchRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='queued' AND created_at < ${sqlValue(new Date(Date.now() - 15 * 60000).toISOString())} AND (next_retry_at IS NULL OR next_retry_at='' OR next_retry_at <= ${sqlValue(checkedAt)}) THEN 1 ELSE 0 END) AS stale_queued,
  SUM(CASE WHEN status='sent' AND updated_at < ${sqlValue(new Date(Date.now() - 30 * 60000).toISOString())} THEN 1 ELSE 0 END) AS stale_sent
FROM mixed_meeting_dispatches;`, { json: true });
    const runtimeRows = await sqlite(paths.dbFile, `
SELECT
  platform,
  SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
  COUNT(*) AS total
FROM runtime_agents
GROUP BY platform;`, { json: true });
    const outboxRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
FROM telegram_outbox;`, { json: true });
    const humanGateRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS pending,
  SUM(CASE WHEN created_at < ${sqlValue(new Date(Date.now() - 6 * 3600000).toISOString())} THEN 1 ELSE 0 END) AS stale
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending';`, { json: true });
    const dataFreshnessRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS tracked,
  SUM(CASE WHEN updated_at < ${sqlValue(new Date(Date.now() - 3 * 86400000).toISOString())} THEN 1 ELSE 0 END) AS stale
FROM tracking_states;`, { json: true });
    const recentRuntimeRows = await sqlite(paths.dbFile, `
WITH recent AS (
  SELECT
    rr.*,
    CASE WHEN EXISTS (
      SELECT 1
      FROM runtime_runs recovered
      WHERE recovered.dispatch_id=rr.dispatch_id
        AND recovered.runtime_run_id != rr.runtime_run_id
        AND recovered.status='acked'
        AND COALESCE(recovered.attempt, 0) >= COALESCE(rr.attempt, 0)
        AND recovered.completed_at IS NOT NULL
        AND recovered.completed_at != ''
        AND recovered.completed_at >= COALESCE(NULLIF(rr.completed_at,''), rr.started_at)
    ) THEN 1 ELSE 0 END AS recovered_by_dispatch_ack,
    CASE WHEN (
      json_extract(CASE WHEN json_valid(rr.payload_json) THEN rr.payload_json ELSE '{}' END, '$.readiness.ignore') = 1
      OR json_extract(CASE WHEN json_valid(rr.payload_json) THEN rr.payload_json ELSE '{}' END, '$.readinessIgnore') = 1
      OR json_extract(CASE WHEN json_valid(rr.payload_json) THEN rr.payload_json ELSE '{}' END, '$.diagnostic.expectedFailure') = 1
      OR EXISTS (
        SELECT 1
        FROM mixed_meeting_dispatches d
        WHERE d.dispatch_id=rr.dispatch_id
          AND (
            json_extract(CASE WHEN json_valid(d.payload_json) THEN d.payload_json ELSE '{}' END, '$.readiness.ignore') = 1
            OR json_extract(CASE WHEN json_valid(d.payload_json) THEN d.payload_json ELSE '{}' END, '$.readinessIgnore') = 1
            OR json_extract(CASE WHEN json_valid(d.payload_json) THEN d.payload_json ELSE '{}' END, '$.payload.readiness.ignore') = 1
            OR json_extract(CASE WHEN json_valid(d.payload_json) THEN d.payload_json ELSE '{}' END, '$.payload.diagnostic.expectedFailure') = 1
        )
      )
    ) THEN 1 ELSE 0 END AS diagnostic_ignored,
    CASE WHEN (${archivedTerminalFailureSql("rr", [{ archiveKey: "runtimeRunId", column: "runtime_run_id" }, { archiveKey: "runId", column: "runtime_run_id" }, { archiveKey: "dispatchId", column: "dispatch_id" }, { archiveKey: "refId", column: "runtime_run_id" }])}) THEN 1 ELSE 0 END AS archived_terminal_failure
  FROM runtime_runs rr
  WHERE rr.started_at >= ${sqlValue(new Date(Date.now() - 6 * 3600000).toISOString())}
)
SELECT
  SUM(CASE WHEN status='failed' AND recovered_by_dispatch_ack=0 AND diagnostic_ignored=0 AND archived_terminal_failure=0 THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='failed' AND recovered_by_dispatch_ack=0 AND diagnostic_ignored=1 THEN 1 ELSE 0 END) AS diagnostic_ignored,
  SUM(CASE WHEN status='failed' AND recovered_by_dispatch_ack=1 THEN 1 ELSE 0 END) AS recovered_by_dispatch_ack,
  SUM(CASE WHEN status='failed' AND archived_terminal_failure=1 THEN 1 ELSE 0 END) AS archived_failed,
  SUM(CASE WHEN status='retry_scheduled' THEN 1 ELSE 0 END) AS retry_scheduled,
  COUNT(*) AS total
FROM recent;`, { json: true });
    const staleStartedRuntimeAfterMs = Math.max(5 * 60_000, Math.min(24 * 3600_000, Number(input.staleRuntimeRunAfterMs || input.stale_runtime_run_after_ms || 30 * 60_000)));
    const staleStartedRuntimeCutoff = new Date(Date.now() - staleStartedRuntimeAfterMs).toISOString();
    const staleStartedRuntimeRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM runtime_runs rr
WHERE rr.status='started'
  AND rr.started_at IS NOT NULL
  AND rr.started_at != ''
  AND rr.started_at < ${sqlValue(staleStartedRuntimeCutoff)}
  AND NOT EXISTS (
    SELECT 1
    FROM runtime_runs terminal
    WHERE terminal.dispatch_id=rr.dispatch_id
      AND terminal.runtime_run_id != rr.runtime_run_id
      AND terminal.status IN ('acked','failed','retry_scheduled')
      AND terminal.completed_at IS NOT NULL
      AND terminal.completed_at != ''
      AND terminal.completed_at >= rr.started_at
      AND (
        terminal.attempt=rr.attempt
        OR (
          terminal.adapter='stale_dispatch_reconcile'
          AND terminal.failure_type='runtime_stale'
          AND terminal.started_at=rr.started_at
        )
      )
  );`, { json: true });
    const messageFlowIntegrityRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN final_output_present=0 AND status='telegram_sent' THEN 1 ELSE 0 END) AS failed_output_marked_sent,
  SUM(CASE WHEN final_output_present=1 AND status='telegram_sent' AND delivery_receipt_present=0 THEN 1 ELSE 0 END) AS sent_without_receipt,
  COUNT(*) AS total
FROM message_flows;`, { json: true });
    const hermersModes = await loadHermersProfileModes(input);
    const dispatch = dispatchRows[0] || {};
    const outbox = outboxRows[0] || {};
    const humanGate = humanGateRows[0] || {};
    const dataFreshness = dataFreshnessRows[0] || {};
    const recentRuntime = recentRuntimeRows[0] || {};
    const staleStartedRuntime = staleStartedRuntimeRows[0] || {};
    const messageFlowIntegrity = messageFlowIntegrityRows[0] || {};
    const findings = [];
    if (Number(dispatch.stale_sent || 0) > 0) findings.push({ severity: "critical", key: "stale_sent_dispatches", count: Number(dispatch.stale_sent || 0), plane: "orchestration" });
    if (Number(dispatch.stale_queued || 0) > 0) findings.push({ severity: "warning", key: "stale_queued_dispatches", count: Number(dispatch.stale_queued || 0), plane: "orchestration" });
    if (Number(outbox.failed || 0) > 0) findings.push({ severity: "warning", key: "telegram_outbox_failed", count: Number(outbox.failed || 0), plane: "communication" });
    if (Number(humanGate.stale || 0) > 0) findings.push({ severity: "warning", key: "stale_human_gate", count: Number(humanGate.stale || 0), plane: "orchestration" });
    if (Number(dataFreshness.stale || 0) > 0) findings.push({ severity: "warning", key: "stale_tracking_data", count: Number(dataFreshness.stale || 0), plane: "data" });
    if (Number(recentRuntime.failed || 0) > 0) findings.push({ severity: "warning", key: "recent_runtime_failures", count: Number(recentRuntime.failed || 0), plane: "runtime" });
    if (Number(staleStartedRuntime.count || 0) > 0) findings.push({ severity: "warning", key: "stale_started_runtime_runs", count: Number(staleStartedRuntime.count || 0), plane: "runtime" });
    if (Number(messageFlowIntegrity.failed_output_marked_sent || 0) > 0) findings.push({ severity: "critical", key: "message_flow_failed_output_marked_sent", count: Number(messageFlowIntegrity.failed_output_marked_sent || 0), plane: "communication" });
    if (Number(messageFlowIntegrity.sent_without_receipt || 0) > 0) findings.push({ severity: "critical", key: "message_flow_sent_without_receipt", count: Number(messageFlowIntegrity.sent_without_receipt || 0), plane: "communication" });
    if (!hermersModes.ok && !hermersModes.unavailable) findings.push({ severity: "warning", key: "hermers_profile_modes_unreadable", plane: "runtime", path: hermersModes.path, error: hermersModes.error });
    const activeChecks = Boolean(input.activeChecks || input.active_checks);
    const persistSnapshot = boolOption(input.persistReadinessSnapshot ?? input.persist_readiness_snapshot, true);
    const active = activeChecks ? await activeReadinessChecks(paths, input, findings) : null;
    const planes = {
      control: active ? { openclawGateway: active.openclawGateway } : {},
      orchestration: { dispatch },
      runtime: { runtimes: runtimeRows, recentRuntime, staleStartedRuntime, hermersProfiles: active?.hermersProfiles || [], hermersProfileModes: profileModesReadinessPayload(hermersModes), acpBackend: active?.acpBackend || null },
      communication: { telegramOutbox: outbox, messageFlowIntegrity },
      data: { trackingFreshness: dataFreshness },
      humanGate
    };
    const status = readinessStatus(findings);
    const snapshotId = persistSnapshot ? safeId("readiness") : "";
    if (persistSnapshot) {
      await sqlite(paths.dbFile, `
INSERT INTO readiness_snapshots(snapshot_id, status, checked_at, planes_json, findings_json, payload_json)
VALUES (${sqlValue(snapshotId)}, ${sqlValue(status)}, ${sqlValue(checkedAt)}, ${sqlValue(JSON.stringify(planes))}, ${sqlValue(JSON.stringify(findings))}, ${sqlValue(JSON.stringify({ activeChecks }))});`);
    }
    return { snapshotId, status, checkedAt, activeChecks, planes, findings };
  }

  async function workflowHealthSnapshot(paths, input = {}) {
    const checkedAt = nowIso();
    const staleDispatchAfterMs = boundedNumber([input.staleDispatchAfterMs, input.stale_dispatch_after_ms], 30 * 60_000, 5 * 60_000, 24 * 3600_000);
    const staleDispatchCutoff = new Date(Date.now() - staleDispatchAfterMs).toISOString();
    const staleHumanGateAfterMs = boundedNumber([input.staleHumanGateAfterMs, input.stale_human_gate_after_ms], 6 * 3600_000, 30 * 60_000, 30 * 86400_000);
    const staleHumanGateCutoff = new Date(Date.now() - staleHumanGateAfterMs).toISOString();
    const staleIncidentAfterMs = boundedNumber([input.staleIncidentAfterMs, input.stale_incident_after_ms], 24 * 3600_000, 60 * 60_000, 90 * 86400_000);
    const staleIncidentCutoff = new Date(Date.now() - staleIncidentAfterMs).toISOString();
    const messageFlowStuckAfterMs = boundedNumber([input.messageFlowStuckAfterMs, input.message_flow_stuck_after_ms], 5 * 60_000, 60_000, 24 * 3600_000);
    const messageFlowStuckCutoff = new Date(Date.now() - messageFlowStuckAfterMs).toISOString();
    const readiness = await workflowReadinessSnapshot(paths, {
      ...input,
      activeChecks: boolOption(input.activeChecks ?? input.active_checks, false),
      persistReadinessSnapshot: false
    });
    const workflowRows = await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM workflow_runs
GROUP BY status
ORDER BY status;`, { json: true });
    const dispatchRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN md.status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN md.status='sent' THEN 1 ELSE 0 END) AS sent,
  SUM(CASE WHEN md.status='failed' AND NOT (${archivedTerminalFailureSql("md", [{ archiveKey: "dispatchId", column: "dispatch_id" }, { archiveKey: "refId", column: "dispatch_id" }])}) THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN md.status='failed' AND (${archivedTerminalFailureSql("md", [{ archiveKey: "dispatchId", column: "dispatch_id" }, { archiveKey: "refId", column: "dispatch_id" }])}) THEN 1 ELSE 0 END) AS archived_failed,
  SUM(CASE WHEN md.status='sent' AND md.updated_at < ${sqlValue(staleDispatchCutoff)} THEN 1 ELSE 0 END) AS stale_sent,
  SUM(CASE WHEN md.status='queued' AND md.created_at < ${sqlValue(staleDispatchCutoff)} AND (md.next_retry_at IS NULL OR md.next_retry_at='' OR md.next_retry_at <= ${sqlValue(checkedAt)}) THEN 1 ELSE 0 END) AS stale_queued
FROM mixed_meeting_dispatches md;`, { json: true });
    const controlLoopRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status IN ('queued','retry_scheduled') THEN 1 ELSE 0 END) AS runnable,
  SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
  SUM(CASE WHEN status IN ('failed','dead_letter') THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN status='running' AND lease_until IS NOT NULL AND lease_until != '' AND lease_until <= ${sqlValue(checkedAt)} THEN 1 ELSE 0 END) AS expired_leases
FROM control_loop_jobs;`, { json: true });
    const messageFlowRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN mf.delivery_receipt_present=0 AND mf.return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])}) AND mf.target_runtime NOT IN ('local_codex','codex') AND (COALESCE(mf.runtime_completed_at,'') != '' OR COALESCE(mf.runtime_failed_at,'') != '') THEN 1 ELSE 0 END) AS missing_delivery,
  SUM(CASE WHEN mf.status IN ('runtime_failed','telegram_failed') AND NOT (${archivedTerminalFailureSql("mf", [{ archiveKey: "flowId", column: "flow_id" }, { archiveKey: "messageFlowId", column: "flow_id" }, { archiveKey: "dispatchId", column: "dispatch_id" }, { archiveKey: "refId", column: "flow_id" }])}) THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN mf.status IN ('runtime_failed','telegram_failed') AND (${archivedTerminalFailureSql("mf", [{ archiveKey: "flowId", column: "flow_id" }, { archiveKey: "messageFlowId", column: "flow_id" }, { archiveKey: "dispatchId", column: "dispatch_id" }, { archiveKey: "refId", column: "flow_id" }])}) THEN 1 ELSE 0 END) AS archived_failed,
  SUM(CASE WHEN mf.final_output_present=1 AND mf.delivery_receipt_present=0 AND mf.return_policy IN (${sqlStringList([...MESSAGE_FLOW_DELIVERY_RETURN_POLICIES])}) AND mf.target_runtime NOT IN ('local_codex','codex') AND COALESCE(mf.runtime_completed_at,'') != '' AND mf.runtime_completed_at <= ${sqlValue(messageFlowStuckCutoff)} THEN 1 ELSE 0 END) AS stuck_after_runtime
FROM message_flows mf;`, { json: true });
    const humanGateRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS pending,
  SUM(CASE WHEN created_at <= ${sqlValue(staleHumanGateCutoff)} THEN 1 ELSE 0 END) AS stale,
  SUM(CASE WHEN NOT EXISTS (
    SELECT 1 FROM human_gate_buttons b
    WHERE b.human_gate_id=protocol_objects.object_id
      AND b.status='active'
  ) THEN 1 ELSE 0 END) AS without_buttons
FROM protocol_objects
WHERE object_type='human_gate_record' AND status='pending';`, { json: true });
    const outboxRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
  SUM(CASE WHEN status='delivering' THEN 1 ELSE 0 END) AS delivering,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
FROM telegram_outbox;`, { json: true });
    const registryRows = await sqlite(paths.dbFile, `
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
  SUM(CASE WHEN status='active' AND can_receive_dispatch=0 THEN 1 ELSE 0 END) AS dispatch_disabled
FROM runtime_agents;`, { json: true });
    const runtimeRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN rr.status='failed' AND NOT (${archivedTerminalFailureSql("rr", [{ archiveKey: "runtimeRunId", column: "runtime_run_id" }, { archiveKey: "runId", column: "runtime_run_id" }, { archiveKey: "dispatchId", column: "dispatch_id" }, { archiveKey: "refId", column: "runtime_run_id" }])}) THEN 1 ELSE 0 END) AS failed,
  SUM(CASE WHEN rr.status='failed' AND (${archivedTerminalFailureSql("rr", [{ archiveKey: "runtimeRunId", column: "runtime_run_id" }, { archiveKey: "runId", column: "runtime_run_id" }, { archiveKey: "dispatchId", column: "dispatch_id" }, { archiveKey: "refId", column: "runtime_run_id" }])}) THEN 1 ELSE 0 END) AS archived_failed,
  SUM(CASE WHEN rr.status='started'
    AND rr.started_at IS NOT NULL
    AND rr.started_at != ''
    AND rr.started_at < ${sqlValue(new Date(Date.now() - boundedNumber([input.staleRuntimeRunAfterMs, input.stale_runtime_run_after_ms], 30 * 60_000, 5 * 60_000, 24 * 3600_000)).toISOString())}
    AND NOT EXISTS (
      SELECT 1
      FROM runtime_runs terminal
      WHERE terminal.dispatch_id=rr.dispatch_id
        AND terminal.runtime_run_id != rr.runtime_run_id
        AND terminal.status IN ('acked','failed','retry_scheduled')
        AND terminal.completed_at IS NOT NULL
        AND terminal.completed_at != ''
        AND terminal.completed_at >= rr.started_at
        AND (
          terminal.attempt=rr.attempt
          OR (
            terminal.adapter='stale_dispatch_reconcile'
            AND terminal.failure_type='runtime_stale'
            AND terminal.started_at=rr.started_at
          )
        )
    )
    THEN 1 ELSE 0 END) AS stale_started
FROM runtime_runs rr;`, { json: true });
    const incidentRows = await sqlite(paths.dbFile, `
SELECT
  SUM(CASE WHEN status IN ('active','mitigating','monitoring') THEN 1 ELSE 0 END) AS open,
  SUM(CASE WHEN status IN ('active','mitigating','monitoring') AND COALESCE(NULLIF(next_update_at,''), updated_at, declared_at) <= ${sqlValue(staleIncidentCutoff)} THEN 1 ELSE 0 END) AS stale_open,
  SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) AS resolved,
  SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled
FROM incident_states;`, { json: true });

    const dispatch = dispatchRows[0] || {};
    const controlLoop = controlLoopRows[0] || {};
    const messageFlow = messageFlowRows[0] || {};
    const humanGate = humanGateRows[0] || {};
    const outbox = outboxRows[0] || {};
    const registry = registryRows[0] || {};
    const runtime = runtimeRows[0] || {};
    const incident = incidentRows[0] || {};
    const blockers = [];
    const addBlocker = (severity, key, count, plane, evidence = {}) => {
      const numeric = Number(count || 0);
      if (numeric <= 0) return;
      blockers.push({ severity, key, count: numeric, plane, evidence });
    };
    for (const finding of readiness.findings || []) {
      addBlocker(finding.severity || "warning", finding.key || "readiness_finding", finding.count || 1, finding.plane || "readiness", finding);
    }
    addBlocker("critical", "failed_control_loop_jobs", controlLoop.failed, "control_loop");
    addBlocker("critical", "expired_control_loop_leases", controlLoop.expired_leases, "control_loop");
    addBlocker("warning", "failed_dispatches", dispatch.failed, "dispatch", {
      terminal: true,
      guidance: "Terminal failed dispatches are dead-letter evidence; they require incident/archive handling but do not mean the runtime queue is currently blocked."
    });
    addBlocker("critical", "stale_sent_dispatches", dispatch.stale_sent, "dispatch");
    addBlocker("warning", "stale_queued_dispatches", dispatch.stale_queued, "dispatch");
    addBlocker("critical", "message_flow_delivery_missing", Number(messageFlow.missing_delivery || 0) + Number(messageFlow.stuck_after_runtime || 0), "message_flow");
    addBlocker("warning", "pending_human_gate_without_buttons", humanGate.without_buttons, "human_gate");
    addBlocker("warning", "telegram_outbox_failed", outbox.failed, "communication");
    addBlocker("warning", "registry_dispatch_disabled", registry.dispatch_disabled, "registry");
    addBlocker("warning", "stale_started_runtime_runs", runtime.stale_started, "runtime");
    addBlocker("warning", "open_incidents", incident.open, "incident", {
      staleOpen: Number(incident.stale_open || 0),
      guidance: "Open incidents require governed closeout evidence; they do not imply runtime queue blockage."
    });
    addBlocker("warning", "stale_open_incidents", incident.stale_open, "incident", {
      staleIncidentAfterMs,
      guidance: "Incident updates are stale; prepare a closeout package or refresh the incident timeline."
    });
    const uniqueBlockers = [];
    const seen = new Set();
    for (const blocker of blockers.sort((a, b) => healthSeverityRank(a.severity) - healthSeverityRank(b.severity) || b.count - a.count || a.key.localeCompare(b.key))) {
      const dedupe = `${blocker.key}:${blocker.plane}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      uniqueBlockers.push(blocker);
    }
    const status = healthStatus(uniqueBlockers);
    const topBlockers = uniqueBlockers.slice(0, boundedNumber([input.limit, input.blockerLimit, input.blocker_limit], 8, 1, 20));
    const recommendations = topBlockers.map(healthRecommendationFor);
    return {
      schemaVersion: "workflow_health.v1",
      status,
      checkedAt,
      readiness: {
        snapshotId: readiness.snapshotId,
        status: readiness.status,
        findings: readiness.findings || []
      },
      lanes: {
        workflows: Object.fromEntries(workflowRows.map((row) => [row.status || "unknown", Number(row.count || 0)])),
        dispatch: {
          queued: Number(dispatch.queued || 0),
          sent: Number(dispatch.sent || 0),
          failed: Number(dispatch.failed || 0),
          archivedFailed: Number(dispatch.archived_failed || 0),
          staleQueued: Number(dispatch.stale_queued || 0),
          staleSent: Number(dispatch.stale_sent || 0)
        },
        controlLoop: {
          runnable: Number(controlLoop.runnable || 0),
          running: Number(controlLoop.running || 0),
          failed: Number(controlLoop.failed || 0),
          expiredLeases: Number(controlLoop.expired_leases || 0)
        },
        runtime: {
          failedRuns: Number(runtime.failed || 0),
          archivedFailedRuns: Number(runtime.archived_failed || 0),
          staleStartedRuns: Number(runtime.stale_started || 0)
        },
        messageFlow: {
          missingDelivery: Number(messageFlow.missing_delivery || 0),
          stuckAfterRuntime: Number(messageFlow.stuck_after_runtime || 0),
          failed: Number(messageFlow.failed || 0),
          archivedFailed: Number(messageFlow.archived_failed || 0)
        },
        humanGate: {
          pending: Number(humanGate.pending || 0),
          stale: Number(humanGate.stale || 0),
          withoutButtons: Number(humanGate.without_buttons || 0)
        },
        communication: {
          telegramQueued: Number(outbox.queued || 0),
          telegramDelivering: Number(outbox.delivering || 0),
          telegramFailed: Number(outbox.failed || 0)
        },
        registry: {
          total: Number(registry.total || 0),
          active: Number(registry.active || 0),
          dispatchDisabled: Number(registry.dispatch_disabled || 0)
        },
        incidents: {
          open: Number(incident.open || 0),
          staleOpen: Number(incident.stale_open || 0),
          resolved: Number(incident.resolved || 0),
          cancelled: Number(incident.cancelled || 0)
        }
      },
      topBlockers,
      recommendations,
      nextActions: [...new Set(recommendations.flatMap((item) => item.actions))],
      dbFile: paths.dbFile
    };
  }

  async function workflowInit(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
      root: paths.root,
      dbFile: paths.dbFile,
      thesisDir: paths.thesisDir,
      evidenceDir: paths.evidenceDir,
      memosDir: paths.memosDir,
      gatesDir: paths.gatesDir,
      protocolDir: paths.protocolDir,
      intentsDir: paths.intentsDir,
      receiptsDir: paths.receiptsDir,
      bridgeDir: paths.bridgeDir,
      workflowsDir: paths.workflowsDir,
      templatesDir: paths.templatesDir
    };
  }

  async function workflowStatus(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const counts = await sqlite(paths.dbFile, `
SELECT 'instruments' AS name, COUNT(*) AS count FROM instruments
UNION ALL SELECT 'radar_scores', COUNT(*) FROM radar_scores
UNION ALL SELECT 'thesis', COUNT(*) FROM thesis_index
UNION ALL SELECT 'evidence', COUNT(*) FROM evidence_items
UNION ALL SELECT 'memos', COUNT(*) FROM research_memos
UNION ALL SELECT 'gates', COUNT(*) FROM review_gates
UNION ALL SELECT 'workflows', COUNT(*) FROM workflow_runs
UNION ALL SELECT 'workflow_phases', COUNT(*) FROM workflow_phases
UNION ALL SELECT 'workflow_tasks', COUNT(*) FROM workflow_tasks
UNION ALL SELECT 'workflow_task_dependencies', COUNT(*) FROM workflow_task_dependencies
UNION ALL SELECT 'workflow_checkpoints', COUNT(*) FROM workflow_checkpoints
UNION ALL SELECT 'workflow_events', COUNT(*) FROM workflow_events
UNION ALL SELECT 'workflow_verification_results', COUNT(*) FROM workflow_verification_results
UNION ALL SELECT 'workflow_session_packs', COUNT(*) FROM workflow_session_packs
UNION ALL SELECT 'workflow_session_runs', COUNT(*) FROM workflow_session_runs
UNION ALL SELECT 'workflow_agent_runs', COUNT(*) FROM workflow_agent_runs
UNION ALL SELECT 'workflow_operations', COUNT(*) FROM workflow_operations
UNION ALL SELECT 'protocol_objects', COUNT(*) FROM protocol_objects
UNION ALL SELECT 'trade_intents', COUNT(*) FROM executable_trade_intents
UNION ALL SELECT 'trading_core_receipts', COUNT(*) FROM trading_core_receipts
UNION ALL SELECT 'runtime_runs', COUNT(*) FROM runtime_runs
UNION ALL SELECT 'side_effects', COUNT(*) FROM side_effect_ledger
UNION ALL SELECT 'incidents', COUNT(*) FROM incident_states
UNION ALL SELECT 'readiness_snapshots', COUNT(*) FROM readiness_snapshots
UNION ALL SELECT 'runtime_agents', COUNT(*) FROM runtime_agents
UNION ALL SELECT 'mixed_meeting_participants', COUNT(*) FROM mixed_meeting_participants
UNION ALL SELECT 'mixed_meeting_messages', COUNT(*) FROM mixed_meeting_messages
UNION ALL SELECT 'mixed_meeting_dispatches', COUNT(*) FROM mixed_meeting_dispatches
UNION ALL SELECT 'telegram_outbox', COUNT(*) FROM telegram_outbox
UNION ALL SELECT 'control_loop_jobs', COUNT(*) FROM control_loop_jobs;`, { json: true });
    const readiness = await workflowReadinessSnapshot(paths, input);
    const result = {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
      root: paths.root,
      dbFile: paths.dbFile,
      readiness,
      counts: Object.fromEntries(counts.map((row) => [row.name, row.count]))
    };
    if (input.symbol || input.instrumentId || input.instrument_id) {
      const instrument = await readInstrument(paths, input);
      const state = instrument ? (await sqlite(paths.dbFile, `SELECT * FROM tracking_states WHERE instrument_id=${sqlValue(instrument.instrument_id)};`, { json: true }))[0] || null : null;
      return { ...result, instrument, state };
    }
    return result;
  }

  async function workflowHealth(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowHealthSnapshot(paths, input);
  }

  async function workflowReadiness(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowReadinessSnapshot(paths, input);
  }

  return {
    workflowHealth,
    workflowHealthSnapshot,
    workflowInit,
    workflowReadiness,
    workflowReadinessSnapshot,
    workflowStatus
  };
}
