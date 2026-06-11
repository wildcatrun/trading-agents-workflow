import { dbReadable, parseJson, redact, sqlite, sqlValue, toInt } from "./sqlite.js";

const DEFAULT_LIMIT = 100;

function clampLimit(value, fallback = DEFAULT_LIMIT, max = 500) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(number)));
}

function clampNumber(value, fallback, min, max) {
  const raw = value === undefined || value === null || value === "" ? fallback : value;
  const number = Number(raw);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
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
    payload: redactConsoleValue(parseJson(row.payload_json, {})),
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

function redactText(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/tawhg:[A-Za-z0-9._=-]+/g, "tawhg:<redacted>")
    .replace(/(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)\s+([^\s,;]+)/gi, "$1 [redacted]");
}

function redactConsoleValue(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactConsoleValue(item));
  if (!value || typeof value !== "object") return value;
  const keyed = redact(value);
  const result = {};
  for (const [key, item] of Object.entries(keyed)) result[key] = redactConsoleValue(item);
  return result;
}

function redactEvidenceRow(row = {}) {
  const result = {};
  for (const [key, value] of Object.entries(row || {})) {
    result[key] = key.endsWith("_json")
      ? redactConsoleValue(parseJson(value, value || ""))
      : redactConsoleValue(value);
  }
  return result;
}

function telegramDeliveryReceipt(row = {}, payloadInput = null) {
  const payload = payloadInput && typeof payloadInput === "object"
    ? payloadInput
    : parseJson(row.payload_json, {});
  const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const claim = payload.deliveryClaim && typeof payload.deliveryClaim === "object" ? payload.deliveryClaim : {};
  const status = String(row.status || "").toLowerCase();
  const receipts = Array.isArray(delivery.receipts) ? delivery.receipts : [];
  const channel = String(delivery.channel || "").trim();
  const account = String(delivery.account || payload.account || "").trim();
  const target = String(delivery.target || row.target_ref || "").trim();
  const deliveredAt = String(delivery.deliveredAt || "").trim();
  const failedAt = String(delivery.failedAt || "").trim();
  const error = String(delivery.error || "").trim();
  const terminal = ["sent", "failed"].includes(status);
  const receiptPresent = Boolean(channel || deliveredAt || failedAt || receipts.length || error);
  const receiptComplete = terminal && Boolean(channel && account && target)
    && (
      status === "sent"
        ? Boolean(deliveredAt && receipts.length > 0)
        : Boolean(failedAt && (error || receipts.length > 0))
    );
  let receiptState = status || "unknown";
  if (terminal) receiptState = receiptComplete ? "complete" : receiptPresent ? "partial" : "missing";
  return {
    status,
    terminal,
    receiptPresent,
    receiptComplete,
    receiptState,
    channel,
    account,
    target,
    mode: delivery.mode || "",
    deliveredAt,
    failedAt,
    error: redactText(error),
    receiptCount: receipts.length,
    claimId: claim.claimId || "",
    claimedAt: claim.claimedAt || "",
    claimOwner: claim.owner || "",
    previousStatus: claim.previousStatus || "",
    requiredFields: status === "sent"
      ? ["channel", "account", "target", "deliveredAt", "receipts"]
      : status === "failed"
        ? ["channel", "account", "target", "failedAt", "error or receipts"]
        : ["channel", "account", "target", "terminal status"]
  };
}

function deadLetterIncidentSeverity(kind, status = "") {
  const value = String(status || "").toLowerCase();
  if (kind === "human_gate_feedback") return "warning";
  if (kind === "message_flow_delivery_missing" && value === "runtime_completed") return "warning";
  if (kind === "failed_dispatch") return "warning";
  if (kind === "max_attempt_dispatch" && ["failed", "dead_letter"].includes(value)) return "warning";
  return "critical";
}

function deadLetterIncidentPlanes(kind) {
  const planes = {
    control_loop_job: ["workflow_queue", "control_loop"],
    expired_lease: ["workflow_queue", "control_loop"],
    failed_dispatch: ["workflow_dispatch", "runtime"],
    max_attempt_dispatch: ["workflow_dispatch", "runtime"],
    message_flow_delivery_missing: ["message_flow", "delivery"],
    human_gate_feedback: ["human_gate", "operator_feedback"],
    side_effect_uncertain: ["side_effect", "audit"]
  };
  return planes[kind] || ["workflow", "audit"];
}

function deadLetterPrimaryRows(primary = {}) {
  return Object.values(primary).flatMap((rows) => Array.isArray(rows) ? rows : []);
}

function pushEvidenceRef(refs, seen, source, id, field) {
  const value = String(id || "").trim();
  if (!value) return;
  const key = `${source}:${field}:${value}`;
  if (seen.has(key)) return;
  seen.add(key);
  refs.push({ source, field, id: value });
}

function collectIncidentEvidenceRefs(primary = {}, related = {}) {
  const refs = [];
  const seen = new Set();
  const groups = [
    ["primary.controlLoopJobs", primary.controlLoopJobs || []],
    ["primary.dispatches", primary.dispatches || []],
    ["primary.messageFlows", primary.messageFlows || []],
    ["primary.humanGateButtons", primary.humanGateButtons || []],
    ["primary.sideEffects", primary.sideEffects || []],
    ["related.dispatches", related.dispatches || []],
    ["related.runtimeRuns", related.runtimeRuns || []],
    ["related.messageFlows", related.messageFlows || []],
    ["related.messageFlowEvents", related.messageFlowEvents || []],
    ["related.outbox", related.outbox || []],
    ["related.humanGateButtons", related.humanGateButtons || []],
    ["related.humanGateRecords", related.humanGateRecords || []],
    ["related.sideEffects", related.sideEffects || []],
    ["related.controlLoopJobs", related.controlLoopJobs || []]
  ];
  for (const [source, rows] of groups) {
    for (const row of rows || []) {
      pushEvidenceRef(refs, seen, source, row.job_id, "job_id");
      pushEvidenceRef(refs, seen, source, row.dispatch_id, "dispatch_id");
      pushEvidenceRef(refs, seen, source, row.runtime_run_id, "runtime_run_id");
      pushEvidenceRef(refs, seen, source, row.flow_id, "flow_id");
      pushEvidenceRef(refs, seen, source, row.event_id, "event_id");
      pushEvidenceRef(refs, seen, source, row.outbox_id, "outbox_id");
      pushEvidenceRef(refs, seen, source, row.human_gate_id, "human_gate_id");
      pushEvidenceRef(refs, seen, source, row.button_id, "button_id");
      pushEvidenceRef(refs, seen, source, row.object_id, "object_id");
      pushEvidenceRef(refs, seen, source, row.side_effect_id, "side_effect_id");
    }
  }
  return refs;
}

function deadLetterIncidentActions(kind) {
  const actions = {
    control_loop_job: [
      "Inspect the failed control-loop job result and payload evidence.",
      "Confirm whether the job is safe to retry or should stay dead-lettered.",
      "Open a governed intervention only after the root cause and rollback boundary are clear."
    ],
    expired_lease: [
      "Confirm whether the worker lease is stale or the worker is still running.",
      "Check related runtime and control-loop logs before clearing or retrying the job.",
      "Record the lease decision in the workflow evidence trail."
    ],
    failed_dispatch: [
      "Inspect dispatch failure details and related runtime receipts.",
      "Decide whether the failed dispatch is superseded, should stay archived, or needs a governed rerun.",
      "Do not retry until ownership, idempotency, and rollback boundaries are clear."
    ],
    max_attempt_dispatch: [
      "Inspect dispatch attempts and runtime receipts for the target agent.",
      "Decide whether to rerun the dispatch, reroute it, or block the workflow.",
      "Require Human Gate approval before any non-idempotent rerun."
    ],
    message_flow_delivery_missing: [
      "Compare runtime completion, message_flow events, and Telegram outbox evidence.",
      "Determine whether delivery is still pending, failed, or already visible through another receipt.",
      "Only resend through a governed delivery path with the original workflow and outbox evidence attached."
    ],
    human_gate_feedback: [
      "Inspect the Human Gate button and record state before asking for operator input again.",
      "Keep the same Human Gate identity if a reminder or redelivery is needed.",
      "Do not infer operator approval from a pending feedback button."
    ],
    side_effect_uncertain: [
      "Treat the side effect as uncertain until external state is reconciled.",
      "Check idempotency keys and artifact references before retrying or rolling forward.",
      "Escalate for human confirmation if the side effect touches trading, delivery, or durable state."
    ]
  };
  return actions[kind] || [
    "Inspect the primary and related evidence rows.",
    "Confirm whether a governed incident should be opened.",
    "Avoid repair actions until ownership and rollback boundaries are clear."
  ];
}

function buildDeadLetterIncidentCandidate({ workflowId, kind, refId, generatedAt, primary, related }) {
  const primaryRows = deadLetterPrimaryRows(primary);
  const primaryRow = primaryRows[0] || {};
  const status = String(primaryRow.status || "");
  const severity = deadLetterIncidentSeverity(kind, status);
  const affectedPlanes = deadLetterIncidentPlanes(kind);
  return {
    schemaVersion: "workflow_incident_candidate.v1",
    writeMode: "read_only_preview",
    recommended: true,
    workflowId,
    kind,
    refId,
    severity,
    suggestedStatus: "active",
    suggestedMode: severity === "critical" ? "degraded" : "monitoring",
    summary: `${kind} dead-letter candidate ${refId}${workflowId ? ` in workflow ${workflowId}` : ""}`,
    affectedPlanes,
    evidenceRefs: collectIncidentEvidenceRefs(primary, related),
    recommendedNextActions: deadLetterIncidentActions(kind),
    exitCriteria: [
      "Primary dead-letter row no longer matches the current stuck/dead-letter predicate.",
      "Related dispatch, runtime, delivery, Human Gate, or side-effect evidence has a terminal receipt.",
      "Any repair, retry, delivery, or rollback action has its own governed receipt."
    ],
    rollbackBoundary: "This preview is read-only. Creating an incident or executing a repair must use a separate governed workflow action.",
    generatedAt
  };
}

async function tableExists(dbFile, tableName) {
  const rows = await sqlite(dbFile, `SELECT name FROM sqlite_master WHERE type='table' AND name=${sqlValue(tableName)} LIMIT 1;`);
  return rows.length > 0;
}

async function tableColumnSet(dbFile, tableName) {
  const rows = await sqlite(dbFile, `PRAGMA table_info(${tableName});`, { json: true });
  return new Set(rows.map((row) => row.name));
}

function columnExpr(columns, name, fallback, alias = name) {
  return `${columns.has(name) ? name : fallback} AS ${alias}`;
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

function latestIso(values = []) {
  return values.filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)))[0] || "";
}

function earliestIso(values = []) {
  return values.filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)))[0] || "";
}

function terminalTaskStatus(status = "") {
  return ["done", "failed", "cancelled"].includes(String(status || "").toLowerCase());
}

function phaseToneFromCounts(counts = {}) {
  if ((counts.failed || 0) > 0 || (counts.blocked || 0) > 0) return "blocked";
  if ((counts.inProgress || 0) > 0) return "in_progress";
  if ((counts.pending || 0) > 0 || (counts.humanGate || 0) > 0) return "pending";
  if ((counts.cancelled || 0) > 0) return "cancelled";
  if ((counts.done || 0) > 0 && (counts.total || 0) === (counts.done || 0)) return "done";
  return "empty";
}

function receiptPresent(row = {}) {
  return Boolean(
    row.receipt_ref
    || row.output_hash
    || row.artifact_ref
    || row.path
    || Number(row.final_output_present || 0)
    || Number(row.delivery_receipt_present || 0)
    || row.selected_at
    || row.feedback_received_at
  );
}

function workflowPayloadWhereSql(value, prefix = "", options = {}) {
  const column = prefix ? `${prefix}.payload_json` : "payload_json";
  const parent = prefix ? `${prefix}.parent_object_id` : "parent_object_id";
  const parentClause = options.parent === false ? "" : `${parent}=${value} OR`;
  return `(
    ${parentClause} (json_valid(${column}) AND (
      json_extract(${column}, '$.workflowId')=${value}
      OR json_extract(${column}, '$.workflow_id')=${value}
      OR json_extract(${column}, '$.workflow.workflowId')=${value}
      OR json_extract(${column}, '$.workflow.id')=${value}
      OR json_extract(${column}, '$.payload.workflowId')=${value}
      OR json_extract(${column}, '$.payload.workflow_id')=${value}
      OR json_extract(${column}, '$.payload.workflow.id')=${value}
      OR json_extract(${column}, '$.raw.workflowId')=${value}
      OR json_extract(${column}, '$.raw.workflow_id')=${value}
    ))
  )`;
}

function workflowPayloadWhere(workflowId, prefix = "") {
  return workflowPayloadWhereSql(sqlValue(workflowId), prefix);
}

function uniqueNonEmpty(values = []) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function sqlIn(values = []) {
  const list = uniqueNonEmpty(values);
  if (!list.length) return "(SELECT NULL WHERE 0)";
  return `(${list.map((value) => sqlValue(value)).join(",")})`;
}

function filterValues(value) {
  return uniqueNonEmpty(Array.isArray(value) ? value : String(value || "").split(","));
}

function dispatchJsonMatchSql(dispatchIds = [], column = "payload_json") {
  const list = uniqueNonEmpty(dispatchIds);
  if (!list.length) return "0=1";
  return list
    .map((dispatchId) => `(json_extract(${column}, '$.dispatchId')=${sqlValue(dispatchId)} OR json_extract(${column}, '$.dispatch_id')=${sqlValue(dispatchId)})`)
    .join(" OR ");
}

function hasCjkText(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function compactJsonText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function evidenceReason(code, label, detail = "", refs = []) {
  return {
    code,
    label,
    detail: redactText(compactText(detail, 220)),
    refs: uniqueNonEmpty(refs.map((ref) => redactText(ref))).slice(0, 8)
  };
}

function addEvidenceReason(reasons, code, label, detail = "", refs = []) {
  if (reasons.some((reason) => reason.code === code)) return;
  reasons.push(evidenceReason(code, label, detail, refs));
}

function evidenceReasonSummary(reasons = []) {
  return compactText(reasons.map((reason) => reason.label).join("; "), 220);
}

function positiveEvidenceStatus(value = "") {
  return ["approved", "pass", "passed", "accepted", "sent", "completed", "selected", "closed", "ready"].includes(String(value || "").toLowerCase());
}

function collectDeadLetterReferenceIds(evidence = {}, workflowId = "") {
  const refs = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (!text || text === String(workflowId || "").trim()) return;
    if (text.length < 4 || text.includes("[redacted]")) return;
    refs.add(text);
  };
  add(evidence?.refId);
  for (const ref of evidence?.incidentCandidate?.evidenceRefs || []) add(ref.id);
  const scan = (value, key = "") => {
    if (value === null || value === undefined) return;
    if (typeof value !== "object") {
      if (/^(id|refId|dispatchId|runtimeRunId|flowId|outboxId|jobId|buttonId|humanGateId|sideEffectId)$/i.test(key)
        || /(^|_)(id|ref)$/i.test(key)) add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) scan(item, key);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) scan(childValue, childKey);
  };
  scan(evidence?.primary || {});
  scan(evidence?.related || {});
  return refs;
}

function matchingDeadLetterRefs(value, refs = new Set()) {
  const haystack = compactJsonText(redactConsoleValue(value)).toLowerCase();
  const matches = [];
  for (const ref of refs) {
    const text = String(ref || "").trim();
    if (text && haystack.includes(text.toLowerCase())) matches.push(text);
    if (matches.length >= 8) break;
  }
  return matches;
}

function closeoutCheck(key, label, ok, detail, refs = [], severity = "required") {
  return {
    key,
    label,
    status: ok ? "pass" : severity === "warning" ? "warn" : "fail",
    severity,
    detail: redactText(compactText(detail, 260)),
    refs: uniqueNonEmpty(refs.map((ref) => redactText(ref))).slice(0, 10)
  };
}

function parseIncidentTimelineRows(row = {}) {
  const items = parseJson(row.timeline_json, []);
  const fallbackAt = row.updated_at || row.declared_at || "";
  return (Array.isArray(items) ? items : []).map((item, index) => {
    const text = redactText(String(item || ""));
    const match = text.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
    return {
      at: match?.[1] || fallbackAt,
      kind: "incident.timeline",
      status: row.status || "",
      severity: timelineSeverity(row.status),
      title: `Incident note ${index + 1}: ${row.incident_id || ""}`,
      subtitle: compactText(match?.[2] || text, 220),
      actor: row.commander || "",
      refId: row.incident_id || ""
    };
  }).filter((item) => item.at || item.subtitle);
}

function parseIncidentRow(row = {}) {
  const payload = redactConsoleValue(parseJson(row.payload_json, {}));
  return {
    incidentId: row.incident_id || "",
    status: row.status || "",
    mode: row.mode || "",
    affectedPlanes: redactConsoleValue(parseJson(row.affected_planes_json, [])),
    summary: redactText(row.summary || ""),
    commander: row.commander || "",
    impact: redactText(row.impact || ""),
    currentHypothesis: redactText(row.current_hypothesis || ""),
    mitigation: redactText(row.mitigation || ""),
    rollbackOptions: redactText(row.rollback_options || ""),
    exitCriteria: redactText(row.exit_criteria || ""),
    timeline: parseJson(row.timeline_json, []).map((item) => redactText(item)),
    payload,
    declaredAt: row.declared_at || "",
    nextUpdateAt: row.next_update_at || "",
    resolvedAt: row.resolved_at || "",
    updatedAt: row.updated_at || ""
  };
}

function incidentWorkflowWhereSql(workflowExpr, alias = "incident_states") {
  const column = `${alias}.payload_json`;
  return `(${workflowPayloadWhereSql(workflowExpr, alias, { parent: false })}
    OR (json_valid(${column}) AND (
      json_extract(${column}, '$.deadLetter.workflowId')=${workflowExpr}
      OR json_extract(${column}, '$.deadLetter.workflow_id')=${workflowExpr}
    )))`;
}

function incidentHasAnyWorkflowLinkSql(alias = "incident_states") {
  const column = `${alias}.payload_json`;
  return `(json_valid(${column}) AND (
    COALESCE(json_extract(${column}, '$.workflowId'), '') != ''
    OR COALESCE(json_extract(${column}, '$.workflow_id'), '') != ''
    OR COALESCE(json_extract(${column}, '$.workflow.workflowId'), '') != ''
    OR COALESCE(json_extract(${column}, '$.workflow.id'), '') != ''
    OR COALESCE(json_extract(${column}, '$.payload.workflowId'), '') != ''
    OR COALESCE(json_extract(${column}, '$.payload.workflow_id'), '') != ''
    OR COALESCE(json_extract(${column}, '$.payload.workflow.id'), '') != ''
    OR COALESCE(json_extract(${column}, '$.raw.workflowId'), '') != ''
    OR COALESCE(json_extract(${column}, '$.raw.workflow_id'), '') != ''
    OR COALESCE(json_extract(${column}, '$.deadLetter.workflowId'), '') != ''
    OR COALESCE(json_extract(${column}, '$.deadLetter.workflow_id'), '') != ''
  ))`;
}

function buttonRoleText(button = {}) {
  return [
    button.button_role,
    button.decision_status,
    button.label,
    button.summary,
    button.prompt,
    compactJsonText(button.payload)
  ].filter(Boolean).join(" ").toLowerCase();
}

function buttonClassifierText(button = {}) {
  return [
    button.button_role,
    button.decision_status,
    button.label
  ].filter(Boolean).join(" ").toLowerCase();
}

function isApproveOptionButton(button = {}) {
  const roleText = buttonClassifierText(button);
  if (/(pause|暂停|terminate|终止|stop|停止|reject|驳回|cancel|取消)/i.test(roleText)) return false;
  return String(button.decision_status || "").toLowerCase() === "approved"
    || /(^|\s)(option|approve|plan|alternative|批准|方案\s*[a-zabc一二三四])/i.test(roleText);
}

function hasControlButton(buttons = [], patterns = []) {
  return buttons.some((button) => patterns.some((pattern) => pattern.test(buttonClassifierText(button))));
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
    if (!(await tableExists(this.paths.dbFile, "workflow_runs"))) {
      return { count: 0, source: "missing_table", workflows: [] };
    }
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
    (SELECT COUNT(*) FROM protocol_objects po WHERE po.object_type='human_gate_record' AND po.status='pending' AND ${workflowPayloadWhereSql("wr.workflow_id", "po")}) +
    (SELECT COUNT(*) FROM review_gates rg WHERE rg.workflow_id=wr.workflow_id AND (rg.status='pending' OR (rg.human_gate_required=1 AND rg.status NOT IN ('approved','rejected','waived','expired','cancelled','done')))) +
    (SELECT COUNT(*) FROM workflow_tasks wt WHERE wt.workflow_id=wr.workflow_id AND wt.human_gate_required=1 AND wt.status NOT IN ('done','failed','cancelled'))
  ) AS pending_human_gates,
  (SELECT COUNT(*) FROM mixed_meeting_dispatches md WHERE md.workflow_id=wr.workflow_id AND md.status='queued') AS queued_dispatches,
  (SELECT COUNT(*) FROM mixed_meeting_dispatches md WHERE md.workflow_id=wr.workflow_id AND md.status='sent') AS sent_dispatches,
  (SELECT COUNT(*) FROM mixed_meeting_dispatches md WHERE md.workflow_id=wr.workflow_id AND md.status='failed') AS failed_dispatches,
  (SELECT COUNT(*) FROM telegram_outbox tg WHERE tg.meeting_id=wr.workflow_id AND tg.status='queued') AS queued_outbox,
  (SELECT COUNT(*) FROM telegram_outbox tg WHERE tg.meeting_id=wr.workflow_id AND tg.status='failed') AS failed_outbox,
  (SELECT COUNT(*) FROM incident_states inc WHERE inc.status IN ('active','mitigating','monitoring') AND ${incidentWorkflowWhereSql("wr.workflow_id", "inc")}) AS open_incidents,
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
    if (!(await tableExists(this.paths.dbFile, "workflow_runs"))) return null;
    const rows = await sqlite(this.paths.dbFile, `SELECT * FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`);
    if (!rows[0]) return null;
    const list = await this.workflowList({ q: workflowId, limit: 50, view: "" });
    const enriched = list.workflows.find((item) => item.workflowId === workflowId);
    return enriched || parseWorkflowRow(rows[0]);
  }

  async tasks(workflowId) {
    const [hasTaskTable, hasDependencyTable] = await Promise.all([
      tableExists(this.paths.dbFile, "workflow_tasks"),
      tableExists(this.paths.dbFile, "workflow_task_dependencies")
    ]);
    if (!hasTaskTable) return { workflowId, source: "missing_table", tasks: [], edges: [] };
    const rows = await sqlite(this.paths.dbFile, `SELECT * FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)} ORDER BY created_at;`);
    const edges = hasDependencyTable ? await sqlite(this.paths.dbFile, `
SELECT task_id, depends_on_task_id FROM workflow_task_dependencies
WHERE task_id IN (SELECT task_id FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)})
ORDER BY task_id, depends_on_task_id;`) : [];
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

  async phases(workflowId) {
    const hasTaskTable = await tableExists(this.paths.dbFile, "workflow_tasks");
    const hasDependencyTable = await tableExists(this.paths.dbFile, "workflow_task_dependencies");
    const hasDispatchTable = await tableExists(this.paths.dbFile, "mixed_meeting_dispatches");
    const hasPhaseTable = await tableExists(this.paths.dbFile, "workflow_phases");
    const hasAgentRunTable = await tableExists(this.paths.dbFile, "workflow_agent_runs");
    const hasRuntimeRunTable = await tableExists(this.paths.dbFile, "runtime_runs");
    const [phaseRows, taskRows, edgeRows, dispatchRows, runtimeRows, agentRunRows] = await Promise.all([
      hasPhaseTable ? sqlite(this.paths.dbFile, `
SELECT phase_id, workflow_id, phase_key, ordinal, status, owner_agent, owner_agents_json,
  depends_on_json, acceptance_criteria_json, verifier_agent, human_gate_required,
  plan_node_refs_json, payload_json, created_at, started_at, completed_at, updated_at
FROM workflow_phases
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY ordinal, phase_key;`) : Promise.resolve([]),
      hasTaskTable ? sqlite(this.paths.dbFile, `
SELECT task_id, parent_task_id, phase, owner_agent, runtime, agent_id, task_type, status, priority,
  depends_on_json, expected_artifact, actual_artifact_ref, receipt_required, human_gate_required,
  summary, blocked_reason, created_at, due_at, started_at, completed_at, updated_at
FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at;`) : Promise.resolve([]),
      hasTaskTable && hasDependencyTable ? sqlite(this.paths.dbFile, `
SELECT task_id, depends_on_task_id FROM workflow_task_dependencies
WHERE task_id IN (SELECT task_id FROM workflow_tasks WHERE workflow_id=${sqlValue(workflowId)})
ORDER BY task_id, depends_on_task_id;`) : Promise.resolve([]),
      hasDispatchTable ? sqlite(this.paths.dbFile, `
SELECT dispatch_id, runtime, agent_id, dispatch_type, status, priority, attempt, max_attempts, prompt, created_by,
  created_at, updated_at, sent_at, acked_at, completed_at, failure_type, last_error, payload_json
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at;`) : Promise.resolve([]),
      hasRuntimeRunTable ? sqlite(this.paths.dbFile, `
SELECT runtime_run_id, dispatch_id, runtime, agent_id, adapter, backend, status, failure_type,
  attempt, started_at, completed_at, latency_ms, error, payload_json
FROM runtime_runs
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY started_at;`) : Promise.resolve([]),
      hasAgentRunTable ? sqlite(this.paths.dbFile, `
SELECT agent_run_id, workflow_id, phase_id, phase_key, task_id, dispatch_id, runtime_run_id,
  session_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref,
  error, payload_json, started_at, completed_at, created_at, updated_at
FROM workflow_agent_runs
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY updated_at, started_at;`) : Promise.resolve([])
    ]);

    const taskPhase = new Map();
    const phaseKeyById = new Map();
    const phaseMap = new Map();
    const ensurePhase = (phaseKey, ordinalHint = phaseMap.size, phaseRow = null) => {
      const key = phaseKey || "unphased";
      if (!phaseMap.has(key)) {
        phaseMap.set(key, {
          phaseId: phaseRow?.phase_id || "",
          phaseKey: key,
          ordinal: ordinalHint,
          status: "empty",
          declaredStatus: phaseRow?.status || "",
          source: phaseRow ? "workflow_phases" : "workflow_tasks.phase",
          dependsOn: phaseRow ? parseJson(phaseRow.depends_on_json, []) : [],
          acceptanceCriteria: phaseRow ? parseJson(phaseRow.acceptance_criteria_json, []) : [],
          verifierAgent: phaseRow?.verifier_agent || "",
          humanGateRequired: Boolean(Number(phaseRow?.human_gate_required || 0)),
          planNodeRefs: phaseRow ? parseJson(phaseRow.plan_node_refs_json, []) : [],
          payload: phaseRow ? redactConsoleValue(parseJson(phaseRow.payload_json, {})) : {},
          counts: {
            total: 0,
            pending: 0,
            inProgress: 0,
            done: 0,
            blocked: 0,
            failed: 0,
            cancelled: 0,
            humanGate: 0,
            receiptRequired: 0,
            artifactPresent: 0,
            dispatches: 0,
            dispatchQueued: 0,
            dispatchSent: 0,
            dispatchAcked: 0,
            dispatchFailed: 0,
            runtimeRuns: 0,
            runtimeCompleted: 0,
            runtimeFailed: 0,
            agentRuns: 0,
            agentCompleted: 0,
            agentFailed: 0,
            agentWithReceipt: 0
          },
          ownerAgents: [],
          runtimeAgents: [],
          startedAt: "",
          completedAt: "",
          updatedAt: "",
          blockers: [],
          tasks: [],
          dispatches: [],
          runtimeRuns: [],
          agentRuns: []
        });
        if (phaseRow) {
          const phase = phaseMap.get(key);
          for (const owner of parseJson(phaseRow.owner_agents_json, [])) {
            if (owner && !phase.ownerAgents.includes(owner)) phase.ownerAgents.push(owner);
          }
          if (phaseRow.owner_agent && !phase.ownerAgents.includes(phaseRow.owner_agent)) phase.ownerAgents.push(phaseRow.owner_agent);
        }
      } else if (phaseRow) {
        const phase = phaseMap.get(key);
        phase.phaseId = phase.phaseId || phaseRow.phase_id || "";
        phase.declaredStatus = phase.declaredStatus || phaseRow.status || "";
        phase.source = "workflow_phases";
        phase.dependsOn = parseJson(phaseRow.depends_on_json, phase.dependsOn || []);
        phase.acceptanceCriteria = parseJson(phaseRow.acceptance_criteria_json, phase.acceptanceCriteria || []);
        phase.verifierAgent = phase.verifierAgent || phaseRow.verifier_agent || "";
        phase.humanGateRequired = phase.humanGateRequired || Boolean(Number(phaseRow.human_gate_required || 0));
        phase.planNodeRefs = parseJson(phaseRow.plan_node_refs_json, phase.planNodeRefs || []);
        phase.payload = redactConsoleValue(parseJson(phaseRow.payload_json, phase.payload || {}));
      }
      return phaseMap.get(key);
    };

    for (const [index, row] of phaseRows.entries()) {
      if (row.phase_id && row.phase_key) phaseKeyById.set(row.phase_id, row.phase_key);
      ensurePhase(row.phase_key || "unphased", Number(row.ordinal || index), row);
    }

    const dependencyCountByTask = new Map();
    for (const edge of edgeRows) {
      dependencyCountByTask.set(edge.task_id, (dependencyCountByTask.get(edge.task_id) || 0) + 1);
    }

    for (const [index, row] of taskRows.entries()) {
      const phaseKey = row.phase || "unphased";
      taskPhase.set(row.task_id, phaseKey);
      const phase = ensurePhase(phaseKey, index);
      const counts = phase.counts;
      counts.total += 1;
      if (row.status === "pending") counts.pending += 1;
      if (row.status === "in_progress") counts.inProgress += 1;
      if (row.status === "done") counts.done += 1;
      if (row.status === "blocked") counts.blocked += 1;
      if (row.status === "failed") counts.failed += 1;
      if (row.status === "cancelled") counts.cancelled += 1;
      if (Number(row.human_gate_required || 0) > 0 && !terminalTaskStatus(row.status)) counts.humanGate += 1;
      if (Number(row.receipt_required || 0) > 0) counts.receiptRequired += 1;
      if (row.actual_artifact_ref) counts.artifactPresent += 1;

      if (row.owner_agent && !phase.ownerAgents.includes(row.owner_agent)) phase.ownerAgents.push(row.owner_agent);
      const runtimeAgent = [row.runtime, row.agent_id].filter(Boolean).join(":");
      if (runtimeAgent && !phase.runtimeAgents.includes(runtimeAgent)) phase.runtimeAgents.push(runtimeAgent);
      if (row.blocked_reason || ["blocked", "failed"].includes(row.status)) {
        phase.blockers.push({
          taskId: row.task_id,
          status: row.status,
          reason: row.blocked_reason || row.summary || ""
        });
      }
      phase.tasks.push({
        taskId: row.task_id,
        parentTaskId: row.parent_task_id || "",
        status: row.status,
        priority: row.priority,
        ownerAgent: row.owner_agent,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        taskType: row.task_type,
        dependencyCount: dependencyCountByTask.get(row.task_id) || toInt(parseJson(row.depends_on_json, []).length),
        receiptRequired: Boolean(Number(row.receipt_required || 0)),
        humanGateRequired: Boolean(Number(row.human_gate_required || 0)),
        expectedArtifact: row.expected_artifact || "",
        actualArtifactRef: row.actual_artifact_ref || "",
        summary: row.summary || "",
        blockedReason: row.blocked_reason || "",
        createdAt: row.created_at,
        dueAt: row.due_at || "",
        startedAt: row.started_at || "",
        completedAt: row.completed_at || "",
        updatedAt: row.updated_at
      });
    }

    const dispatchPhase = new Map();
    for (const row of dispatchRows) {
      const payload = parseJson(row.payload_json, {});
      const taskId = payload.taskId || payload.task_id || payload.payload?.taskId || payload.payload?.task_id || "";
      const phaseKey = taskPhase.get(taskId) || payload.phase || "unphased";
      dispatchPhase.set(row.dispatch_id, phaseKey);
      const phase = ensurePhase(phaseKey);
      const counts = phase.counts;
      counts.dispatches += 1;
      if (row.status === "queued") counts.dispatchQueued += 1;
      if (row.status === "sent") counts.dispatchSent += 1;
      if (row.status === "acked") counts.dispatchAcked += 1;
      if (row.status === "failed") counts.dispatchFailed += 1;
      phase.dispatches.push({
        dispatchId: row.dispatch_id,
        taskId,
        status: row.status,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        dispatchType: row.dispatch_type || "",
        attempt: toInt(row.attempt || payload.attempt),
        maxAttempts: toInt(row.max_attempts || payload.maxAttempts || payload.max_attempts),
        promptPreview: compactText(redactText(row.prompt), 180),
        failureType: row.failure_type || "",
        lastError: compactText(redactText(row.last_error), 180),
        createdAt: row.created_at,
        sentAt: row.sent_at || "",
        ackedAt: row.acked_at || "",
        completedAt: row.completed_at || "",
        updatedAt: row.updated_at
      });
    }

    const runtimeRunPhase = new Map();
    for (const row of runtimeRows) {
      const phaseKey = dispatchPhase.get(row.dispatch_id) || "unphased";
      runtimeRunPhase.set(row.runtime_run_id, phaseKey);
      const phase = ensurePhase(phaseKey);
      const counts = phase.counts;
      counts.runtimeRuns += 1;
      if (["completed", "acked"].includes(row.status)) counts.runtimeCompleted += 1;
      if (row.status === "failed") counts.runtimeFailed += 1;
      phase.runtimeRuns.push({
        runtimeRunId: row.runtime_run_id,
        dispatchId: row.dispatch_id || "",
        status: row.status,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        adapter: row.adapter || "",
        backend: row.backend || "",
        attempt: toInt(row.attempt),
        latencyMs: toInt(row.latency_ms),
        failureType: row.failure_type || "",
        error: compactText(redactText(row.error), 180),
        startedAt: row.started_at || "",
        completedAt: row.completed_at || ""
      });
    }

    for (const row of agentRunRows) {
      const phaseKey = row.phase_key || phaseKeyById.get(row.phase_id) || taskPhase.get(row.task_id) || dispatchPhase.get(row.dispatch_id) || runtimeRunPhase.get(row.runtime_run_id) || "unphased";
      const phase = ensurePhase(phaseKey);
      const counts = phase.counts;
      const status = String(row.status || "").toLowerCase();
      counts.agentRuns += 1;
      if (["completed", "acked", "done", "success"].includes(status)) counts.agentCompleted += 1;
      if (status.includes("failed") || status === "retry_scheduled" || row.error) counts.agentFailed += 1;
      if (row.receipt_ref) counts.agentWithReceipt += 1;
      const runtimeAgent = [row.runtime, row.agent_id].filter(Boolean).join(":");
      if (runtimeAgent && !phase.runtimeAgents.includes(runtimeAgent)) phase.runtimeAgents.push(runtimeAgent);
      if ((status.includes("failed") || row.error) && phase.blockers.length < 12) {
        phase.blockers.push({
          agentRunId: row.agent_run_id,
          taskId: row.task_id || "",
          status: row.status,
          reason: redactText(row.error || row.receipt_ref || "agent run failed")
        });
      }
      phase.agentRuns.push({
        agentRunId: row.agent_run_id,
        taskId: row.task_id || "",
        dispatchId: row.dispatch_id || "",
        runtimeRunId: row.runtime_run_id || "",
        sessionRunId: row.session_run_id || "",
        status: row.status,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        attempt: toInt(row.attempt),
        inputHash: row.input_hash || "",
        outputHash: row.output_hash || "",
        receiptRef: row.receipt_ref || "",
        error: compactText(redactText(row.error), 180),
        payload: redactConsoleValue(parseJson(row.payload_json, {})),
        startedAt: row.started_at || "",
        completedAt: row.completed_at || "",
        createdAt: row.created_at || "",
        updatedAt: row.updated_at || ""
      });
    }

    const phases = [...phaseMap.values()].map((phase) => {
      const taskTimes = phase.tasks.flatMap((task) => [task.createdAt, task.startedAt, task.completedAt, task.updatedAt]);
      const dispatchTimes = phase.dispatches.flatMap((dispatch) => [dispatch.createdAt, dispatch.sentAt, dispatch.ackedAt, dispatch.completedAt, dispatch.updatedAt]);
      const runtimeTimes = phase.runtimeRuns.flatMap((run) => [run.startedAt, run.completedAt]);
      const agentRunTimes = phase.agentRuns.flatMap((run) => [run.createdAt, run.startedAt, run.completedAt, run.updatedAt]);
      phase.startedAt = earliestIso([
        ...phase.tasks.map((task) => task.startedAt || task.createdAt),
        ...phase.dispatches.map((dispatch) => dispatch.sentAt || dispatch.createdAt),
        ...phase.runtimeRuns.map((run) => run.startedAt),
        ...phase.agentRuns.map((run) => run.startedAt || run.createdAt)
      ]);
      phase.completedAt = phase.counts.total > 0 && phase.tasks.every((task) => terminalTaskStatus(task.status))
        ? latestIso(phase.tasks.map((task) => task.completedAt || task.updatedAt))
        : "";
      phase.updatedAt = latestIso([...taskTimes, ...dispatchTimes, ...runtimeTimes, ...agentRunTimes]);
      phase.status = phase.counts.total > 0 ? phaseToneFromCounts(phase.counts) : (phase.declaredStatus || "planned");
      phase.ownerAgents.sort();
      phase.runtimeAgents.sort();
      phase.blockers = phase.blockers.slice(0, 12);
      phase.tasks.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      phase.dispatches.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
      phase.runtimeRuns.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
      phase.agentRuns.sort((a, b) => String(b.updatedAt || b.startedAt || b.createdAt).localeCompare(String(a.updatedAt || a.startedAt || a.createdAt)));
      return phase;
    }).sort((a, b) => a.ordinal - b.ordinal || a.phaseKey.localeCompare(b.phaseKey));

    const totals = phases.reduce((acc, phase) => {
      acc.total += phase.counts.total;
      acc.pending += phase.counts.pending;
      acc.inProgress += phase.counts.inProgress;
      acc.done += phase.counts.done;
      acc.blocked += phase.counts.blocked + phase.counts.failed;
      acc.cancelled += phase.counts.cancelled;
      acc.dispatches += phase.counts.dispatches;
      acc.runtimeRuns += phase.counts.runtimeRuns;
      acc.agentRuns += phase.counts.agentRuns;
      acc.agentWithReceipt += phase.counts.agentWithReceipt;
      acc.humanGate += phase.counts.humanGate;
      return acc;
    }, { total: 0, pending: 0, inProgress: 0, done: 0, blocked: 0, cancelled: 0, dispatches: 0, runtimeRuns: 0, agentRuns: 0, agentWithReceipt: 0, humanGate: 0 });

    return {
      workflowId,
      inferred: phaseRows.length === 0,
      source: phaseRows.length ? "workflow_phases+workflow_tasks" : "workflow_tasks.phase",
      evidenceSources: {
        workflowPhases: hasPhaseTable ? "workflow_phases" : "missing_table",
        workflowTasks: hasTaskTable ? "workflow_tasks" : "missing_table",
        dispatches: hasDispatchTable ? "mixed_meeting_dispatches" : "missing_table",
        runtimeRuns: hasRuntimeRunTable ? "runtime_runs" : "missing_table",
        agentRuns: hasAgentRunTable ? "workflow_agent_runs" : "missing_table"
      },
      phaseCount: phases.length,
      totals,
      phases
    };
  }

  async dispatches(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    const [hasDispatchTable, hasRuntimeRunTable] = await Promise.all([
      tableExists(this.paths.dbFile, "mixed_meeting_dispatches"),
      tableExists(this.paths.dbFile, "runtime_runs")
    ]);
    if (!hasDispatchTable) return { workflowId, count: 0, source: "missing_table", dispatches: [] };
    const rows = await sqlite(this.paths.dbFile, hasRuntimeRunTable ? `
SELECT d.*,
  (SELECT rr.runtime_run_id FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY rr.started_at DESC LIMIT 1) AS latest_runtime_run_id,
  (SELECT rr.status FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY rr.started_at DESC LIMIT 1) AS latest_runtime_status,
  (SELECT rr.error FROM runtime_runs rr WHERE rr.dispatch_id=d.dispatch_id ORDER BY rr.started_at DESC LIMIT 1) AS latest_runtime_error
FROM mixed_meeting_dispatches d
WHERE d.workflow_id=${sqlValue(workflowId)}
ORDER BY d.created_at DESC
LIMIT ${limit};` : `
SELECT d.*,
  '' AS latest_runtime_run_id,
  '' AS latest_runtime_status,
  '' AS latest_runtime_error
FROM mixed_meeting_dispatches d
WHERE d.workflow_id=${sqlValue(workflowId)}
ORDER BY d.created_at DESC
LIMIT ${limit};`);
    return { workflowId, count: rows.length, dispatches: rows.map((row) => ({
      ...row,
      prompt: redactText(row.prompt || ""),
      last_error: redactText(row.last_error || ""),
      latest_runtime_error: redactText(row.latest_runtime_error || ""),
      payload: redactConsoleValue(parseJson(row.payload_json, {})),
      payload_json: undefined
    })) };
  }

  async runtimeRuns(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    if (!(await tableExists(this.paths.dbFile, "runtime_runs"))) {
      return { workflowId, count: 0, source: "missing_table", runtimeRuns: [] };
    }
    const rows = await sqlite(this.paths.dbFile, `
SELECT * FROM runtime_runs
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY started_at DESC
LIMIT ${limit};`);
    return { workflowId, count: rows.length, runtimeRuns: rows.map((row) => ({
      ...row,
      error: redactText(row.error || ""),
      payload: redactConsoleValue(parseJson(row.payload_json, {})),
      payload_json: undefined
    })) };
  }

  async agentRuns(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    if (!(await tableExists(this.paths.dbFile, "workflow_agent_runs"))) {
      return { workflowId, count: 0, source: "missing_table", agentRuns: [] };
    }
    const hasPhaseTable = await tableExists(this.paths.dbFile, "workflow_phases");
    const [rows, phaseRows] = await Promise.all([
      sqlite(this.paths.dbFile, `
SELECT agent_run_id, workflow_id, phase_id, phase_key, task_id, dispatch_id, runtime_run_id,
  session_run_id, runtime, agent_id, status, attempt, input_hash, output_hash, receipt_ref,
  error, payload_json, started_at, completed_at, created_at, updated_at
FROM workflow_agent_runs
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY updated_at DESC, started_at DESC
LIMIT ${limit};`),
      hasPhaseTable ? sqlite(this.paths.dbFile, `
SELECT phase_id, phase_key
FROM workflow_phases
WHERE workflow_id=${sqlValue(workflowId)};`) : Promise.resolve([])
    ]);
    const phaseKeyById = new Map(phaseRows.filter((row) => row.phase_id && row.phase_key).map((row) => [row.phase_id, row.phase_key]));
    const byPhase = new Map();
    for (const row of rows) {
      const phaseKey = row.phase_key || phaseKeyById.get(row.phase_id) || "unphased";
      row.phase_key = phaseKey;
      if (!byPhase.has(phaseKey)) {
        byPhase.set(phaseKey, {
          phaseKey,
          total: 0,
          completed: 0,
          failed: 0,
          withReceipt: 0,
          latestUpdatedAt: ""
        });
      }
      const bucket = byPhase.get(phaseKey);
      const status = String(row.status || "").toLowerCase();
      bucket.total += 1;
      if (["completed", "acked", "done", "success"].includes(status)) bucket.completed += 1;
      if (status.includes("failed") || status === "retry_scheduled" || row.error) bucket.failed += 1;
      if (row.receipt_ref) bucket.withReceipt += 1;
      bucket.latestUpdatedAt = latestIso([bucket.latestUpdatedAt, row.updated_at, row.completed_at, row.started_at, row.created_at]);
    }
    return {
      workflowId,
      count: rows.length,
      source: "workflow_agent_runs",
      phaseSummary: [...byPhase.values()].sort((a, b) => String(b.latestUpdatedAt).localeCompare(String(a.latestUpdatedAt))),
      agentRuns: rows.map((row) => ({ ...row, error: redactText(row.error || ""), payload: redactConsoleValue(parseJson(row.payload_json, {})), payload_json: undefined }))
    };
  }

  async verification(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    if (!(await tableExists(this.paths.dbFile, "workflow_verification_results"))) {
      return {
        workflowId,
        count: 0,
        source: "missing_table",
        summary: { total: 0, byDecision: {}, byType: {}, latestDecision: "" },
        results: []
      };
    }
    const columns = await tableColumnSet(this.paths.dbFile, "workflow_verification_results");
    if (!columns.has("workflow_id")) {
      return {
        workflowId,
        count: 0,
        source: "partial_schema",
        summary: { total: 0, byDecision: {}, byType: {}, latestDecision: "" },
        results: []
      };
    }
    const orderBy = columns.has("created_at") ? "created_at DESC" : (columns.has("verification_id") ? "verification_id DESC" : "rowid DESC");
    const rows = await sqlite(this.paths.dbFile, `
SELECT
  ${columnExpr(columns, "verification_id", "''")},
  ${columnExpr(columns, "workflow_id", "''")},
  ${columnExpr(columns, "phase_id", "''")},
  ${columnExpr(columns, "phase_key", "''")},
  ${columnExpr(columns, "task_id", "''")},
  ${columnExpr(columns, "agent_run_id", "''")},
  ${columnExpr(columns, "dispatch_id", "''")},
  ${columnExpr(columns, "runtime_run_id", "''")},
  ${columnExpr(columns, "result_type", "''")},
  ${columnExpr(columns, "decision", "''")},
  ${columnExpr(columns, "verifier_agent", "''")},
  ${columnExpr(columns, "refuter_agent", "''")},
  ${columnExpr(columns, "source_runtime", "''")},
  ${columnExpr(columns, "source_agent", "''")},
  ${columnExpr(columns, "confidence", "''")},
  ${columnExpr(columns, "risk_band", "''")},
  ${columnExpr(columns, "summary", "''")},
  ${columnExpr(columns, "findings_json", "'[]'")},
  ${columnExpr(columns, "recommendations_json", "'[]'")},
  ${columnExpr(columns, "evidence_refs_json", "'[]'")},
  ${columnExpr(columns, "artifact_refs_json", "'[]'")},
  ${columnExpr(columns, "receipt_refs_json", "'[]'")},
  ${columnExpr(columns, "payload_hash", "''")},
  ${columnExpr(columns, "payload_json", "'{}'")},
  ${columnExpr(columns, "created_by", "''")},
  ${columnExpr(columns, "created_at", "''")}
FROM workflow_verification_results
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY ${orderBy}
LIMIT ${limit};`);
    const byDecision = {};
    const byType = {};
    for (const row of rows) {
      byDecision[row.decision || "unknown"] = (byDecision[row.decision || "unknown"] || 0) + 1;
      byType[row.result_type || "unknown"] = (byType[row.result_type || "unknown"] || 0) + 1;
    }
    return {
      workflowId,
      count: rows.length,
      source: "workflow_verification_results",
      summary: {
        total: rows.length,
        byDecision,
        byType,
        latestDecision: rows[0]?.decision || "",
        latestCreatedAt: rows[0]?.created_at || ""
      },
      results: rows.map((row) => ({
        verificationId: row.verification_id,
        workflowId: row.workflow_id,
        phaseId: row.phase_id || "",
        phaseKey: row.phase_key || "",
        taskId: row.task_id || "",
        agentRunId: row.agent_run_id || "",
        dispatchId: row.dispatch_id || "",
        runtimeRunId: row.runtime_run_id || "",
        resultType: row.result_type || "",
        decision: row.decision || "",
        verifierAgent: row.verifier_agent || "",
        refuterAgent: row.refuter_agent || "",
        sourceRuntime: row.source_runtime || "",
        sourceAgent: row.source_agent || "",
        confidence: row.confidence || "",
        riskBand: row.risk_band || "",
        summary: redactText(row.summary || ""),
        findings: redactConsoleValue(parseJson(row.findings_json, [])),
        recommendations: redactConsoleValue(parseJson(row.recommendations_json, [])),
        evidenceRefs: redactConsoleValue(parseJson(row.evidence_refs_json, [])),
        artifactRefs: redactConsoleValue(parseJson(row.artifact_refs_json, [])),
        receiptRefs: redactConsoleValue(parseJson(row.receipt_refs_json, [])),
        payloadHash: row.payload_hash || "",
        payload: redactConsoleValue(parseJson(row.payload_json, {})),
        createdBy: row.created_by || "",
        createdAt: row.created_at || ""
      }))
    };
  }

  async humanGates(workflowId) {
    const [
      hasProtocolTable,
      hasButtonTable,
      hasBatchTable,
      hasBatchItemTable
    ] = await Promise.all([
      tableExists(this.paths.dbFile, "protocol_objects"),
      tableExists(this.paths.dbFile, "human_gate_buttons"),
      tableExists(this.paths.dbFile, "human_gate_batches"),
      tableExists(this.paths.dbFile, "human_gate_batch_items")
    ]);
    const records = hasProtocolTable ? await sqlite(this.paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at, updated_at
FROM protocol_objects
WHERE object_type='human_gate_record'
  AND ${workflowPayloadWhere(workflowId)}
ORDER BY created_at DESC;`) : [];
    const buttons = hasButtonTable ? await sqlite(this.paths.dbFile, `
SELECT button_id, human_gate_id, workflow_id, meeting_id, label, decision_status, button_role, artifact_ref, summary, prompt, payload_json, status, created_by, created_at, updated_at, selected_by, selected_at, feedback_status, feedback_received_at
FROM human_gate_buttons
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at ASC;`) : [];
    const batches = hasBatchTable && hasBatchItemTable ? await sqlite(this.paths.dbFile, `
SELECT b.batch_id, b.status, b.title, b.target_ref, b.risk_summary_json, b.default_action, b.html_path, b.json_path, b.telegram_summary, b.created_by, b.created_at, b.updated_at
FROM human_gate_batches b
WHERE b.batch_id IN (SELECT batch_id FROM human_gate_batch_items WHERE workflow_id=${sqlValue(workflowId)})
ORDER BY b.created_at DESC
LIMIT 50;`) : [];
    return {
      workflowId,
      records: records.map((row) => ({
        ...row,
        path: redactText(row.path || ""),
        payload: redactConsoleValue(parseJson(row.payload_json, {})),
        payload_json: undefined
      })),
      buttons: buttons.map((row) => ({
        ...row,
        label: redactText(row.label || ""),
        summary: redactText(row.summary || ""),
        prompt: redactText(row.prompt || ""),
        artifact_ref: redactText(row.artifact_ref || ""),
        payload: redactConsoleValue(parseJson(row.payload_json, {})),
        payload_json: undefined
      })),
      batches: batches.map((row) => ({
        ...row,
        title: redactText(row.title || ""),
        target_ref: redactText(row.target_ref || ""),
        html_path: redactText(row.html_path || ""),
        json_path: redactText(row.json_path || ""),
        telegram_summary: redactText(row.telegram_summary || ""),
        riskSummary: redactConsoleValue(parseJson(row.risk_summary_json, {})),
        risk_summary_json: undefined
      }))
    };
  }

  async humanGateReadiness(workflowId) {
    const [humanGates, outbox, checkpoints, evidence, receipts] = await Promise.all([
      this.humanGates(workflowId),
      this.outbox(workflowId, { limit: 100 }),
      this.checkpoints(workflowId),
      this.evidence(workflowId),
      this.receipts(workflowId, { limit: 200 })
    ]);
    const records = humanGates.records || [];
    const buttons = humanGates.buttons || [];
    const approveButtons = buttons.filter(isApproveOptionButton);
    const latestRecord = records[0] || null;
    const latestRecordText = compactJsonText(latestRecord?.payload || {});
    const buttonText = compactJsonText(buttons.map((button) => ({
      label: button.label,
      summary: button.summary,
      prompt: button.prompt,
      payload: button.payload
    })));
    const allHumanGateText = `${latestRecordText}\n${buttonText}`;
    const sentOutbox = (outbox.outbox || []).filter((row) => String(row.status || "").toLowerCase() === "sent");
    const sentOutboxWithCompleteReceipt = sentOutbox.filter((row) => row.deliveryReceipt?.receiptComplete);
    const queuedOutbox = (outbox.outbox || []).filter((row) => String(row.status || "").toLowerCase() === "queued");
    const deliveringOutbox = (outbox.outbox || []).filter((row) => String(row.status || "").toLowerCase() === "delivering");
    const failedOutbox = (outbox.outbox || []).filter((row) => String(row.status || "").toLowerCase() === "failed");
    const partialTerminalOutbox = (outbox.outbox || []).filter((row) => row.deliveryReceipt?.terminal && !row.deliveryReceipt?.receiptComplete);
    const selectedButtons = buttons.filter((button) => button.selected_at || String(button.status || "").toLowerCase() === "selected");
    const feedbackButtons = buttons.filter((button) => button.feedback_received_at || String(button.feedback_status || "").toLowerCase() === "received");
    const catClawSources = [
      ...records.map((row) => row.source_agent),
      ...buttons.map((row) => row.created_by)
    ].filter(Boolean);
    const checklist = [];
    const add = (key, label, ok, detail, refs = [], severity = "required") => {
      checklist.push({
        key,
        label,
        status: ok ? "pass" : severity === "warning" ? "warn" : "fail",
        severity,
        detail,
        refs
      });
    };
    add(
      "human_gate_record",
      "Human Gate record",
      records.length > 0,
      records.length ? `${records.length} record(s), latest ${latestRecord?.object_id || ""}` : "No human_gate_record is linked to this workflow.",
      records.slice(0, 3).map((row) => row.object_id)
    );
    add(
      "three_approve_options",
      "Three independent approve options",
      approveButtons.length >= 3,
      `${approveButtons.length} approve/option button(s) found; A/B/C or equivalent is required.`,
      approveButtons.map((row) => row.button_id)
    );
    add(
      "pause_control",
      "Pause workflow control",
      hasControlButton(buttons, [/pause/i, /暂停/]),
      "A pause button must be present alongside approve options.",
      buttons.filter((row) => /pause|暂停/i.test(buttonClassifierText(row))).map((row) => row.button_id)
    );
    add(
      "terminate_control",
      "Terminate workflow control",
      hasControlButton(buttons, [/terminate/i, /终止/, /stop/i, /停止/]),
      "A terminate/stop button must be present alongside approve options.",
      buttons.filter((row) => /terminate|终止|stop|停止/i.test(buttonClassifierText(row))).map((row) => row.button_id)
    );
    add(
      "chinese_primary_body",
      "Chinese report body",
      hasCjkText(allHumanGateText),
      hasCjkText(allHumanGateText) ? "Chinese text is present in the record/buttons." : "No Chinese report text found in the Human Gate record/buttons.",
      latestRecord ? [latestRecord.object_id] : []
    );
    const incompleteOptionButtons = approveButtons.filter((button) => !(button.label && button.summary && button.prompt));
    add(
      "option_detail_completeness",
      "Option details complete",
      approveButtons.length >= 3 && incompleteOptionButtons.length === 0,
      incompleteOptionButtons.length
        ? `${incompleteOptionButtons.length} approve option(s) lack label, summary, or prompt.`
        : "Approve options include label, summary, and prompt.",
      approveButtons.map((row) => row.button_id)
    );
    add(
      "checkpoint_available",
      "Checkpoint available",
      (checkpoints.count || 0) > 0,
      `${checkpoints.count || 0} checkpoint(s) linked to this workflow.`,
      (checkpoints.checkpoints || []).slice(0, 3).map((row) => row.checkpointId)
    );
    add(
      "evidence_artifacts",
      "Evidence artifacts indexed",
      (evidence.artifacts || []).length > 0,
      `${(evidence.artifacts || []).length} artifact(s) indexed.`,
      (evidence.artifacts || []).slice(0, 3).map((row) => row.artifact_id)
    );
    add(
      "receipt_coverage",
      "Receipts present",
      (receipts.summary?.present || 0) > 0,
      `${receipts.summary?.present || 0} present receipt(s), ${receipts.summary?.missing || 0} missing in shown scope.`,
      (receipts.receipts || []).filter((row) => row.present).slice(0, 3).map((row) => row.receiptId)
    );
    add(
      "cat_claw_secretary_path",
      "Cat Claw secretary path",
      catClawSources.some((source) => String(source || "").toLowerCase() === "cat_claw"),
      catClawSources.length ? `Sources: ${catClawSources.join(", ")}` : "No cat_claw source/creator is recorded.",
      catClawSources,
      "warning"
    );
    add(
      "telegram_delivery_observed",
      "Telegram delivery observed",
      sentOutboxWithCompleteReceipt.length > 0,
      sentOutboxWithCompleteReceipt.length
        ? `${sentOutboxWithCompleteReceipt.length} sent outbox message(s) with complete terminal delivery receipt.`
        : `${queuedOutbox.length} queued, ${deliveringOutbox.length} delivering, ${failedOutbox.length} failed, ${partialTerminalOutbox.length} partial terminal receipt(s); no complete sent delivery receipt observed.`,
      sentOutboxWithCompleteReceipt.map((row) => row.outboxId),
      "warning"
    );
    add(
      "flashcat_original_words",
      "Flashcat original words captured after selection",
      selectedButtons.length === 0 || feedbackButtons.length > 0,
      selectedButtons.length === 0
        ? "No selected button yet; original words are required when Flashcat completes the gate."
        : `${feedbackButtons.length} feedback/original-word receipt(s) for ${selectedButtons.length} selected button(s).`,
      feedbackButtons.map((row) => row.button_id),
      selectedButtons.length === 0 ? "warning" : "required"
    );
    const failed = checklist.filter((item) => item.status === "fail").length;
    const warnings = checklist.filter((item) => item.status === "warn").length;
    const passed = checklist.filter((item) => item.status === "pass").length;
    const status = failed > 0 ? "not_ready" : warnings > 0 ? "needs_attention" : "ready";
    return {
      workflowId,
      schemaVersion: "human_gate_readiness.v1",
      generatedAt: new Date().toISOString(),
      status,
      readyForCatClawAudit: failed === 0,
      readyForHumanGateSubmission: failed === 0,
      summary: {
        passed,
        failed,
        warnings,
        total: checklist.length,
        latestHumanGateId: latestRecord?.object_id || "",
        approveOptionCount: approveButtons.length,
        recordCount: records.length,
        buttonCount: buttons.length,
        checkpointCount: checkpoints.count || 0,
        artifactCount: (evidence.artifacts || []).length,
        receiptPresentCount: receipts.summary?.present || 0,
        sentOutboxCount: sentOutbox.length,
        sentOutboxCompleteReceiptCount: sentOutboxWithCompleteReceipt.length,
        failedOutboxCount: failedOutbox.length,
        deliveringOutboxCount: deliveringOutbox.length,
        partialTerminalOutboxCount: partialTerminalOutbox.length
      },
      checklist,
      refs: {
        approveButtonIds: approveButtons.map((row) => row.button_id),
        selectedButtonIds: selectedButtons.map((row) => row.button_id),
        sentOutboxIds: sentOutbox.map((row) => row.outboxId),
        sentOutboxCompleteReceiptIds: sentOutboxWithCompleteReceipt.map((row) => row.outboxId),
        checkpointIds: (checkpoints.checkpoints || []).slice(0, 10).map((row) => row.checkpointId),
        artifactIds: (evidence.artifacts || []).slice(0, 10).map((row) => row.artifact_id)
      },
      gates: humanGates,
      delivery: {
        sent: sentOutbox.length,
        sentCompleteReceipt: sentOutboxWithCompleteReceipt.length,
        queued: queuedOutbox.length,
        delivering: deliveringOutbox.length,
        failed: failedOutbox.length,
        partialTerminal: partialTerminalOutbox.length
      },
      evidence: {
        checkpointCount: checkpoints.count || 0,
        artifactCount: (evidence.artifacts || []).length,
        receiptSummary: receipts.summary || {}
      }
    };
  }

  async taskLaunches(query = {}) {
    const limit = clampLimit(query.limit, 50, 200);
    const filters = ["object_type='workflow_task_launch_package'"];
    if (query.workflowId) filters.push(`parent_object_id=${sqlValue(query.workflowId)}`);
    if (query.status) filters.push(`status=${sqlValue(query.status)}`);
    const rows = await sqlite(this.paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at, updated_at
FROM protocol_objects
WHERE ${filters.join(" AND ")}
ORDER BY updated_at DESC
LIMIT ${limit};`);
    return {
      count: rows.length,
      taskLaunches: rows.map((row) => {
        const payload = redactConsoleValue(parseJson(row.payload_json, {}));
        return {
          draftId: row.object_id,
          status: row.status,
          workflowId: row.parent_object_id || payload.workflowId || "",
          subject: payload.subject || "",
          objective: payload.objective || "",
          sourceAgent: row.source_agent || "",
          path: redactText(row.path || ""),
          artifacts: payload.artifactRefs || {},
          roles: payload.roles || {},
          taskCount: payload.launchMaterialization?.tasks?.length || 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          payload
        };
      })
    };
  }

  async messageFlows(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 100, 500);
    const [hasMessageFlowTable, hasMessageFlowEventTable] = await Promise.all([
      tableExists(this.paths.dbFile, "message_flows"),
      tableExists(this.paths.dbFile, "message_flow_events")
    ]);
    if (!hasMessageFlowTable) {
      return { workflowId, count: 0, source: "missing_table", flows: [], events: [], summary: [] };
    }
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
    const events = hasMessageFlowEventTable ? await sqlite(this.paths.dbFile, `
SELECT e.event_id, e.flow_id, e.status, e.event_type, e.payload_json, e.created_at,
  mf.return_policy, mf.target_runtime, mf.target_agent_id, mf.dispatch_id
FROM message_flow_events e
JOIN message_flows mf ON mf.flow_id=e.flow_id
WHERE ${flowWhere.replace(/workflow_id/g, "mf.workflow_id").replace(/meeting_id/g, "mf.meeting_id")}
ORDER BY e.created_at DESC
LIMIT ${limit};`) : [];
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
        lastError: redactText(row.last_error || ""),
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
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
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
        payload: redactConsoleValue(parseJson(row.payload_json, {})),
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
    if (!(await tableExists(this.paths.dbFile, "telegram_outbox"))) {
      return { workflowId, count: 0, source: "missing_table", outbox: [] };
    }
    const rows = await sqlite(this.paths.dbFile, `
SELECT * FROM telegram_outbox
WHERE meeting_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT ${limit};`);
    return {
      workflowId,
      count: rows.length,
      outbox: rows.map((row) => {
        const payload = parseJson(row.payload_json, {});
        return {
          outboxId: row.outbox_id,
          meetingId: row.meeting_id || "",
          targetKind: row.target_kind,
          targetRef: row.target_ref || "",
          messageType: row.message_type,
          status: row.status,
          textPreview: compactText(redactText(row.text || ""), 500),
          deliveryReceipt: telegramDeliveryReceipt(row, payload),
          payload: redactConsoleValue(payload),
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      })
    };
  }

  async checkpoints(workflowId) {
    if (!(await tableExists(this.paths.dbFile, "workflow_checkpoints"))) {
      return { workflowId, count: 0, source: "missing_table", checkpoints: [] };
    }
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
        resumePayload: redactConsoleValue(parseJson(row.resume_payload_json, {})),
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
    const [hasArtifactTable, hasSideEffectTable] = await Promise.all([
      tableExists(this.paths.dbFile, "artifact_index"),
      tableExists(this.paths.dbFile, "side_effect_ledger")
    ]);
    const artifacts = hasArtifactTable ? await sqlite(this.paths.dbFile, `
SELECT artifact_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 200;`) : [];
    const sideEffects = hasSideEffectTable ? await sqlite(this.paths.dbFile, `
SELECT side_effect_id, trace_id, workflow_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, artifact_ref, payload_json, created_at, updated_at
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 200;`) : [];
    return {
      workflowId,
      evidenceSources: {
        artifacts: hasArtifactTable ? "artifact_index" : "missing_table",
        sideEffects: hasSideEffectTable ? "side_effect_ledger" : "missing_table"
      },
      artifacts,
      sideEffects: sideEffects.map((row) => ({ ...row, artifact_ref: redactText(row.artifact_ref || ""), payload: redactConsoleValue(parseJson(row.payload_json, {})), payload_json: undefined }))
    };
  }

  async receipts(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 200, 500);
    const [
      hasAgentRunTable,
      hasMessageFlowTable,
      hasOutboxTable,
      hasProtocolTable,
      hasButtonTable,
      hasCheckpointTable,
      hasArtifactTable,
      hasSideEffectTable
    ] = await Promise.all([
      tableExists(this.paths.dbFile, "workflow_agent_runs"),
      tableExists(this.paths.dbFile, "message_flows"),
      tableExists(this.paths.dbFile, "telegram_outbox"),
      tableExists(this.paths.dbFile, "protocol_objects"),
      tableExists(this.paths.dbFile, "human_gate_buttons"),
      tableExists(this.paths.dbFile, "workflow_checkpoints"),
      tableExists(this.paths.dbFile, "artifact_index"),
      tableExists(this.paths.dbFile, "side_effect_ledger")
    ]);
    const [
      agentRuns,
      messageFlows,
      outbox,
      protocolObjects,
      humanGateButtons,
      checkpoints,
      artifacts,
      sideEffects
    ] = await Promise.all([
      hasAgentRunTable ? sqlite(this.paths.dbFile, `
SELECT agent_run_id, phase_key, task_id, dispatch_id, runtime_run_id, session_run_id, runtime, agent_id,
  status, receipt_ref, input_hash, output_hash, error, payload_json, started_at, completed_at, created_at, updated_at
FROM workflow_agent_runs
WHERE workflow_id=${sqlValue(workflowId)}
  AND (receipt_ref != '' OR output_hash != '' OR status IN ('acked','completed','failed','retry_scheduled'))
ORDER BY updated_at DESC
LIMIT ${limit};`) : Promise.resolve([]),
      hasMessageFlowTable ? sqlite(this.paths.dbFile, `
SELECT flow_id, status, return_policy, target_runtime, target_agent_id, dispatch_id, runtime_run_id, outbox_id,
  final_output_present, delivery_receipt_present, runtime_completed_at, telegram_sent_at, telegram_failed_at,
  completed_at, last_error, payload_json, created_at, updated_at
FROM message_flows
WHERE workflow_id=${sqlValue(workflowId)} OR meeting_id=${sqlValue(workflowId)}
ORDER BY updated_at DESC
LIMIT ${limit};`) : Promise.resolve([]),
      hasOutboxTable ? sqlite(this.paths.dbFile, `
SELECT outbox_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at
FROM telegram_outbox
WHERE meeting_id=${sqlValue(workflowId)}
ORDER BY updated_at DESC
LIMIT ${limit};`) : Promise.resolve([]),
      hasProtocolTable ? sqlite(this.paths.dbFile, `
SELECT object_id, object_type, status, source_agent, source_system, parent_object_id, path, payload_json, created_at, updated_at
FROM protocol_objects
WHERE object_type IN ('human_gate_record','trading_core_receipt','execution_audit_summary','evidence_pack','workflow_task_launch_package')
  AND ${workflowPayloadWhere(workflowId)}
ORDER BY updated_at DESC
LIMIT ${limit};`) : Promise.resolve([]),
      hasButtonTable ? sqlite(this.paths.dbFile, `
SELECT button_id, human_gate_id, label, decision_status, button_role, summary, status, created_by,
  selected_by, selected_at, feedback_status, feedback_received_at, payload_json, created_at, updated_at
FROM human_gate_buttons
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY updated_at DESC
LIMIT ${limit};`) : Promise.resolve([]),
      hasCheckpointTable ? sqlite(this.paths.dbFile, `
SELECT checkpoint_id, status, phase, decision, summary, path, created_by, created_at
FROM workflow_checkpoints
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT ${limit};`) : Promise.resolve([]),
      hasArtifactTable ? sqlite(this.paths.dbFile, `
SELECT artifact_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT ${limit};`) : Promise.resolve([]),
      hasSideEffectTable ? sqlite(this.paths.dbFile, `
SELECT side_effect_id, trace_id, dispatch_id, owner_agent, side_effect_type, status, artifact_ref, payload_json, created_at, updated_at
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY updated_at DESC
LIMIT ${limit};`) : Promise.resolve([])
    ]);
    const receipts = [];
    for (const row of agentRuns) {
      receipts.push({
        receiptId: row.receipt_ref || row.output_hash || row.agent_run_id,
        kind: "agent_run",
        status: row.status,
        present: receiptPresent(row),
        phaseKey: row.phase_key || "",
        taskId: row.task_id || "",
        dispatchId: row.dispatch_id || "",
        runtimeRunId: row.runtime_run_id || "",
        agentRunId: row.agent_run_id,
        source: `${row.runtime || ""}:${row.agent_id || ""}`,
        title: `Agent run ${row.status}: ${row.agent_run_id}`,
        summary: row.receipt_ref || row.output_hash || compactText(row.error, 160),
        artifactRef: row.receipt_ref || "",
        createdAt: row.created_at || row.started_at || "",
        updatedAt: row.updated_at || row.completed_at || row.started_at || "",
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
      });
    }
    for (const row of messageFlows) {
      receipts.push({
        receiptId: row.flow_id,
        kind: "message_flow",
        status: row.status,
        present: receiptPresent(row),
        dispatchId: row.dispatch_id || "",
        runtimeRunId: row.runtime_run_id || "",
        outboxId: row.outbox_id || "",
        source: `${row.target_runtime || ""}:${row.target_agent_id || ""}`,
        title: `Message flow ${row.status}: ${row.flow_id}`,
        summary: `runtime=${Number(row.final_output_present || 0) ? "yes" : "no"} delivery=${Number(row.delivery_receipt_present || 0) ? "yes" : "no"}`,
        createdAt: row.created_at || "",
        updatedAt: row.completed_at || row.telegram_sent_at || row.telegram_failed_at || row.runtime_completed_at || row.updated_at || "",
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
      });
    }
    for (const row of outbox) {
      const payload = parseJson(row.payload_json, {});
      const deliveryReceipt = telegramDeliveryReceipt(row, payload);
      receipts.push({
        receiptId: row.outbox_id,
        kind: "telegram_outbox",
        status: row.status,
        present: deliveryReceipt.receiptComplete,
        outboxId: row.outbox_id,
        source: `${row.target_kind || ""}:${row.target_ref || ""}`,
        title: `Telegram outbox ${row.status}: ${row.outbox_id}`,
        summary: deliveryReceipt.terminal
          ? `${deliveryReceipt.receiptState}; receipts=${deliveryReceipt.receiptCount}; ${compactText(redactText(deliveryReceipt.error || row.text || row.message_type), 140)}`
          : compactText(redactText(row.text || row.message_type), 180),
        createdAt: row.created_at || "",
        updatedAt: deliveryReceipt.deliveredAt || deliveryReceipt.failedAt || row.updated_at || row.created_at || "",
        deliveryReceipt,
        payload: redactConsoleValue(payload)
      });
    }
    for (const row of protocolObjects) {
      receipts.push({
        receiptId: row.object_id,
        kind: row.object_type,
        status: row.status,
        present: receiptPresent(row),
        humanGateId: row.object_type === "human_gate_record" ? row.object_id : "",
        source: row.source_agent || row.source_system || "",
        title: `${row.object_type}: ${row.object_id}`,
        summary: redactText(row.path || row.parent_object_id || ""),
        artifactRef: redactText(row.path || ""),
        createdAt: row.created_at || "",
        updatedAt: row.updated_at || row.created_at || "",
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
      });
    }
    for (const row of humanGateButtons) {
      receipts.push({
        receiptId: row.button_id,
        kind: "human_gate_button",
        status: row.selected_at ? "selected" : row.status,
        present: receiptPresent(row),
        humanGateId: row.human_gate_id,
        source: row.selected_by || row.created_by || "",
        title: `Human Gate button: ${redactText(row.label)}`,
        summary: compactText(redactText(row.summary || row.decision_status || row.feedback_status), 180),
        createdAt: row.created_at || "",
        updatedAt: row.feedback_received_at || row.selected_at || row.updated_at || row.created_at || "",
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
      });
    }
    for (const row of checkpoints) {
      receipts.push({
        receiptId: row.checkpoint_id,
        kind: "checkpoint",
        status: row.status,
        present: receiptPresent(row),
        phaseKey: row.phase || "",
        source: row.created_by || "",
        title: `Checkpoint: ${row.checkpoint_id}`,
        summary: compactText(redactText(row.summary || row.decision || row.path), 180),
        artifactRef: redactText(row.path || ""),
        createdAt: row.created_at || "",
        updatedAt: row.created_at || "",
        payload: redactConsoleValue({ phase: row.phase || "", decision: row.decision || "", path: row.path || "" })
      });
    }
    for (const row of artifacts) {
      receipts.push({
        receiptId: row.artifact_id,
        kind: `artifact.${row.kind || "generic"}`,
        status: "created",
        present: receiptPresent(row),
        source: row.created_by || "",
        title: `Artifact: ${row.artifact_id}`,
        summary: compactText(redactText(row.summary || row.path || row.kind), 180),
        artifactRef: redactText(row.path || ""),
        createdAt: row.created_at || "",
        updatedAt: row.created_at || "",
        payload: redactConsoleValue({ kind: row.kind || "", path: row.path || "" })
      });
    }
    for (const row of sideEffects) {
      receipts.push({
        receiptId: row.side_effect_id,
        kind: "side_effect",
        status: row.status,
        present: receiptPresent(row),
        dispatchId: row.dispatch_id || "",
        source: row.owner_agent || "",
        title: `Side effect ${row.status}: ${row.side_effect_id}`,
        summary: compactText(redactText(row.artifact_ref || row.side_effect_type), 180),
        artifactRef: redactText(row.artifact_ref || ""),
        createdAt: row.created_at || "",
        updatedAt: row.updated_at || row.created_at || "",
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
      });
    }
    receipts.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    const candidateCount = receipts.length;
    const limited = receipts.slice(0, limit);
    const summary = limited.reduce((acc, item) => {
      acc.total += 1;
      if (item.present) acc.present += 1;
      if (!item.present) acc.missing += 1;
      acc.byKind[item.kind] = (acc.byKind[item.kind] || 0) + 1;
      acc.byStatus[item.status || "unknown"] = (acc.byStatus[item.status || "unknown"] || 0) + 1;
      return acc;
    }, { scope: "shown", total: 0, present: 0, missing: 0, byKind: {}, byStatus: {} });
    return {
      workflowId,
      source: "derived_from_existing_ledgers",
      summaryScope: "shown",
      limit,
      candidateCount,
      count: limited.length,
      summary,
      evidenceSources: {
        agentRuns: hasAgentRunTable ? "workflow_agent_runs" : "missing_table",
        messageFlows: hasMessageFlowTable ? "message_flows" : "missing_table",
        outbox: hasOutboxTable ? "telegram_outbox" : "missing_table",
        humanGate: hasProtocolTable && hasButtonTable ? "protocol_objects+human_gate_buttons" : "partial_or_missing",
        checkpoints: hasCheckpointTable ? "workflow_checkpoints" : "missing_table",
        artifacts: hasArtifactTable ? "artifact_index" : "missing_table",
        sideEffects: hasSideEffectTable ? "side_effect_ledger" : "missing_table"
      },
      receipts: limited
    };
  }

  async evidencePack(workflowId, query = {}) {
    const generatedAt = new Date().toISOString();
    const limit = clampLimit(query.limit, 200, 500);
    const [
      workflow,
      phases,
      tasks,
      dispatches,
      runtimeRuns,
      agentRuns,
      messageFlows,
      humanGates,
      outbox,
      checkpoints,
      evidence,
      receipts,
      operations,
      timeline
    ] = await Promise.all([
      this.workflowDetail(workflowId),
      this.phases(workflowId),
      this.tasks(workflowId),
      this.dispatches(workflowId, { limit }),
      this.runtimeRuns(workflowId, { limit }),
      this.agentRuns(workflowId, { limit }),
      this.messageFlows(workflowId, { limit }),
      this.humanGates(workflowId),
      this.outbox(workflowId, { limit }),
      this.checkpoints(workflowId),
      this.evidence(workflowId),
      this.receipts(workflowId, { limit }),
      this.operationsSummary({ workflowId, deadLetterLimit: Math.min(200, limit) }),
      this.timeline(workflowId, { limit: Math.min(300, limit) })
    ]);
    const pack = {
      schemaVersion: "workflow_evidence_pack.v1",
      workflowId,
      generatedAt,
      source: "workflow_console_read_model",
      redactionPolicyVersion: "workflow_console_redaction_v1",
      writeMode: "read_only_derived_export",
      found: Boolean(workflow),
      manifest: {
        workflowPresent: Boolean(workflow),
        phaseCount: phases.phaseCount || 0,
        taskCount: tasks.tasks?.length || 0,
        dispatchCount: dispatches.dispatches?.length || 0,
        runtimeRunCount: runtimeRuns.runtimeRuns?.length || 0,
        agentRunCount: agentRuns.agentRuns?.length || 0,
        messageFlowCount: messageFlows.flows?.length || 0,
        humanGateRecordCount: humanGates.records?.length || 0,
        humanGateButtonCount: humanGates.buttons?.length || 0,
        outboxCount: outbox.outbox?.length || 0,
        checkpointCount: checkpoints.checkpoints?.length || 0,
        artifactCount: evidence.artifacts?.length || 0,
        sideEffectCount: evidence.sideEffects?.length || 0,
        receiptCount: receipts.count || 0,
        operationCount: operations.workflowOperations?.length || 0,
        deliveryExecutionCount: operations.deliveryExecutions?.length || 0,
        timelineEventCount: timeline.events?.length || 0,
        limit
      },
      workflow,
      phases,
      tasks,
      dispatches,
      runtimeRuns,
      agentRuns,
      messageFlows,
      humanGates,
      outbox,
      checkpoints,
      evidence,
      receipts,
      operations,
      timeline
    };
    return pack;
  }

  async deadLetterEvidence(query = {}) {
    const generatedAt = new Date().toISOString();
    const workflowId = String(query.workflowId || query.workflow_id || "").trim();
    const kind = String(query.kind || "").trim();
    const refId = String(query.refId || query.ref_id || "").trim();
    const empty = {
      schemaVersion: "workflow_dead_letter_evidence.v1",
      generatedAt,
      source: "workflow_console_read_model",
      redactionPolicyVersion: "workflow_console_redaction_v1",
      writeMode: "read_only_derived_export",
      workflowId,
      kind,
      refId,
      found: false,
      status: "invalid_request",
      manifest: {
        primaryCount: 0,
        relatedDispatchCount: 0,
        relatedRuntimeRunCount: 0,
        relatedMessageFlowCount: 0,
        relatedMessageFlowEventCount: 0,
        relatedOutboxCount: 0,
        relatedHumanGateButtonCount: 0,
        relatedHumanGateRecordCount: 0,
        relatedSideEffectCount: 0,
        relatedControlLoopJobCount: 0
      },
      evidenceSources: {},
      incidentCandidate: null,
      primary: {},
      related: {}
    };
    if (!kind || !refId) {
      return { ...empty, error: "kind_and_ref_id_required" };
    }
    const [
      hasControlLoopJobs,
      hasDispatchTable,
      hasRuntimeRunTable,
      hasMessageFlowTable,
      hasMessageFlowEventTable,
      hasOutboxTable,
      hasHumanGateButtons,
      hasProtocolTable,
      hasSideEffects
    ] = await Promise.all([
      tableExists(this.paths.dbFile, "control_loop_jobs"),
      tableExists(this.paths.dbFile, "mixed_meeting_dispatches"),
      tableExists(this.paths.dbFile, "runtime_runs"),
      tableExists(this.paths.dbFile, "message_flows"),
      tableExists(this.paths.dbFile, "message_flow_events"),
      tableExists(this.paths.dbFile, "telegram_outbox"),
      tableExists(this.paths.dbFile, "human_gate_buttons"),
      tableExists(this.paths.dbFile, "protocol_objects"),
      tableExists(this.paths.dbFile, "side_effect_ledger")
    ]);
    const evidenceSources = {
      controlLoopJobs: hasControlLoopJobs ? "control_loop_jobs" : "missing_table",
      dispatches: hasDispatchTable ? "mixed_meeting_dispatches" : "missing_table",
      runtimeRuns: hasRuntimeRunTable ? "runtime_runs" : "missing_table",
      messageFlows: hasMessageFlowTable ? "message_flows" : "missing_table",
      messageFlowEvents: hasMessageFlowEventTable ? "message_flow_events" : "missing_table",
      outbox: hasOutboxTable ? "telegram_outbox" : "missing_table",
      humanGateButtons: hasHumanGateButtons ? "human_gate_buttons" : "missing_table",
      humanGateRecords: hasProtocolTable ? "protocol_objects" : "missing_table",
      sideEffects: hasSideEffects ? "side_effect_ledger" : "missing_table"
    };
    const workflowClause = workflowId ? ` AND workflow_id=${sqlValue(workflowId)}` : "";
    const workflowOrMeetingClause = workflowId ? ` AND (workflow_id=${sqlValue(workflowId)} OR meeting_id=${sqlValue(workflowId)})` : "";
    const nowIso = new Date().toISOString();
    const messageFlowStuckMinutes = clampNumber(query.messageFlowStuckMinutes || query.message_flow_stuck_minutes, 5, 1, 24 * 60);
    const messageFlowStuckCutoff = new Date(Date.now() - messageFlowStuckMinutes * 60_000).toISOString();
    const rowsForKind = {
      controlLoopJobs: [],
      dispatches: [],
      messageFlows: [],
      humanGateButtons: [],
      sideEffects: []
    };
    if ((kind === "control_loop_job" || kind === "expired_lease") && hasControlLoopJobs) {
      rowsForKind.controlLoopJobs = await sqlite(this.paths.dbFile, `
	SELECT *
	FROM control_loop_jobs
	WHERE job_id=${sqlValue(refId)}${workflowClause}
	  AND (
	    ${kind === "expired_lease"
    ? `status='running' AND COALESCE(lease_until,'') != '' AND lease_until <= ${sqlValue(nowIso)}`
    : "status IN ('failed','dead_letter') OR (max_attempts > 0 AND attempt >= max_attempts AND status NOT IN ('completed','cancelled','succeeded'))"}
	  )
	LIMIT 1;`);
    } else if ((kind === "max_attempt_dispatch" || kind === "failed_dispatch") && hasDispatchTable) {
      rowsForKind.dispatches = await sqlite(this.paths.dbFile, `
SELECT *
FROM mixed_meeting_dispatches
WHERE dispatch_id=${sqlValue(refId)}${workflowClause}
  AND ${kind === "failed_dispatch"
    ? "status='failed' AND NOT (max_attempts > 0 AND attempt >= max_attempts)"
    : "max_attempts > 0 AND attempt >= max_attempts AND status NOT IN ('acked','completed','runtime_completed','cancelled','stopped')"}
LIMIT 1;`);
    } else if (kind === "message_flow_delivery_missing" && hasMessageFlowTable) {
      rowsForKind.messageFlows = await sqlite(this.paths.dbFile, `
SELECT *
FROM message_flows
WHERE flow_id=${sqlValue(refId)}${workflowOrMeetingClause}
  AND return_policy IN ('reply_to_source_chat','report_to_flashcat')
  AND delivery_receipt_present=0
  AND target_runtime NOT IN ('local_codex','codex')
  AND (
    (
      final_output_present=1
      AND status NOT IN ('telegram_sent','telegram_failed')
      AND COALESCE(runtime_completed_at,'') != ''
      AND runtime_completed_at <= ${sqlValue(messageFlowStuckCutoff)}
    )
    OR (
      final_output_present=0
      AND status='runtime_failed'
      AND COALESCE(outbox_id,'') != ''
      AND COALESCE(runtime_failed_at,'') != ''
      AND runtime_failed_at <= ${sqlValue(messageFlowStuckCutoff)}
    )
    OR (
      status='telegram_failed'
      AND updated_at <= ${sqlValue(messageFlowStuckCutoff)}
    )
  )
LIMIT 1;`);
    } else if (kind === "human_gate_feedback" && hasHumanGateButtons) {
      rowsForKind.humanGateButtons = await sqlite(this.paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE button_id=${sqlValue(refId)}${workflowOrMeetingClause}
  AND status='feedback_pending'
LIMIT 1;`);
    } else if (kind === "side_effect_uncertain" && hasSideEffects) {
      rowsForKind.sideEffects = await sqlite(this.paths.dbFile, `
SELECT *
FROM side_effect_ledger
WHERE side_effect_id=${sqlValue(refId)}${workflowClause}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed')
LIMIT 1;`);
    }

    const payloadDispatchIds = rowsForKind.controlLoopJobs.flatMap((row) => {
      const payload = parseJson(row.payload_json, {});
      const result = parseJson(row.result_json, {});
      const dedupeParts = String(row.dedupe_key || "").split(":");
      const dedupeDispatch = row.job_type === "runtime_drain" && dedupeParts.length >= 3 ? dedupeParts.slice(2).join(":") : "";
      return [payload.dispatchId, payload.dispatch_id, result.dispatchId, result.dispatch_id, dedupeDispatch];
    });
    const dispatchIds = uniqueNonEmpty([
      ...payloadDispatchIds,
      ...rowsForKind.dispatches.map((row) => row.dispatch_id),
      ...rowsForKind.messageFlows.map((row) => row.dispatch_id),
      ...rowsForKind.sideEffects.map((row) => row.dispatch_id)
    ]);
    const flowIds = uniqueNonEmpty(rowsForKind.messageFlows.map((row) => row.flow_id));
    const outboxIds = uniqueNonEmpty(rowsForKind.messageFlows.map((row) => row.outbox_id));
    const humanGateIds = uniqueNonEmpty(rowsForKind.humanGateButtons.map((row) => row.human_gate_id));

    const [
      relatedDispatches,
      relatedRuntimeRuns,
      relatedMessageFlows,
      relatedMessageFlowEvents,
      relatedOutbox,
      relatedHumanGateButtons,
      relatedHumanGateRecords,
      relatedSideEffects,
      relatedControlLoopJobs
    ] = await Promise.all([
      hasDispatchTable && dispatchIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM mixed_meeting_dispatches
WHERE dispatch_id IN ${sqlIn(dispatchIds)}${workflowClause}
ORDER BY updated_at DESC
LIMIT 20;`) : Promise.resolve([]),
      hasRuntimeRunTable && dispatchIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM runtime_runs
WHERE dispatch_id IN ${sqlIn(dispatchIds)}${workflowClause}
ORDER BY started_at DESC
LIMIT 20;`) : Promise.resolve([]),
      hasMessageFlowTable && dispatchIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM message_flows
WHERE dispatch_id IN ${sqlIn(dispatchIds)}${workflowOrMeetingClause}
ORDER BY updated_at DESC
LIMIT 20;`) : Promise.resolve([]),
      hasMessageFlowEventTable && flowIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM message_flow_events
WHERE flow_id IN ${sqlIn(flowIds)}
ORDER BY created_at DESC
LIMIT 40;`) : Promise.resolve([]),
      hasOutboxTable && outboxIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM telegram_outbox
WHERE outbox_id IN ${sqlIn(outboxIds)}${workflowId ? ` AND meeting_id=${sqlValue(workflowId)}` : ""}
ORDER BY updated_at DESC
LIMIT 20;`) : Promise.resolve([]),
      hasHumanGateButtons && humanGateIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM human_gate_buttons
WHERE human_gate_id IN ${sqlIn(humanGateIds)}${workflowOrMeetingClause}
ORDER BY updated_at DESC
LIMIT 40;`) : Promise.resolve([]),
      hasProtocolTable && humanGateIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM protocol_objects
WHERE object_type='human_gate_record'
  AND (
    object_id IN ${sqlIn(humanGateIds)}
    OR (json_valid(payload_json) AND json_extract(payload_json, '$.humanGateId') IN ${sqlIn(humanGateIds)})
    OR (json_valid(payload_json) AND json_extract(payload_json, '$.human_gate_id') IN ${sqlIn(humanGateIds)})
  )
  ${workflowId ? `AND ${workflowPayloadWhere(workflowId)}` : ""}
ORDER BY updated_at DESC
LIMIT 20;`) : Promise.resolve([]),
      hasSideEffects && dispatchIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM side_effect_ledger
WHERE dispatch_id IN ${sqlIn(dispatchIds)}${workflowClause}
ORDER BY updated_at DESC
LIMIT 20;`) : Promise.resolve([]),
      hasControlLoopJobs && dispatchIds.length ? sqlite(this.paths.dbFile, `
SELECT *
FROM control_loop_jobs
WHERE json_valid(payload_json)
  AND (${dispatchJsonMatchSql(dispatchIds)})
  ${workflowClause}
ORDER BY updated_at DESC
LIMIT 20;`) : Promise.resolve([])
    ]);

    const primary = {
      controlLoopJobs: rowsForKind.controlLoopJobs.map((row) => redactEvidenceRow(row)),
      dispatches: rowsForKind.dispatches.map((row) => redactEvidenceRow(row)),
      messageFlows: rowsForKind.messageFlows.map((row) => redactEvidenceRow(row)),
      humanGateButtons: rowsForKind.humanGateButtons.map((row) => redactEvidenceRow(row)),
      sideEffects: rowsForKind.sideEffects.map((row) => redactEvidenceRow(row))
    };
    const related = {
      dispatches: relatedDispatches.map((row) => redactEvidenceRow(row)),
      runtimeRuns: relatedRuntimeRuns.map((row) => redactEvidenceRow(row)),
      messageFlows: relatedMessageFlows.map((row) => redactEvidenceRow(row)),
      messageFlowEvents: relatedMessageFlowEvents.map((row) => redactEvidenceRow(row)),
      outbox: relatedOutbox.map((row) => redactEvidenceRow(row)),
      humanGateButtons: relatedHumanGateButtons.map((row) => redactEvidenceRow(row)),
      humanGateRecords: relatedHumanGateRecords.map((row) => redactEvidenceRow(row)),
      sideEffects: relatedSideEffects.map((row) => redactEvidenceRow(row)),
      controlLoopJobs: relatedControlLoopJobs.map((row) => redactEvidenceRow(row))
    };
    const primaryCount = Object.values(primary).reduce((total, rows) => total + rows.length, 0);
    const incidentCandidate = primaryCount > 0
      ? buildDeadLetterIncidentCandidate({
        workflowId,
        kind,
        refId,
        generatedAt,
        primary,
        related
      })
      : null;
    return {
      ...empty,
      evidenceSources,
      found: primaryCount > 0,
      status: primaryCount > 0 ? "found" : "not_found",
      manifest: {
        primaryCount,
        relatedDispatchCount: related.dispatches.length,
        relatedRuntimeRunCount: related.runtimeRuns.length,
        relatedMessageFlowCount: related.messageFlows.length,
        relatedMessageFlowEventCount: related.messageFlowEvents.length,
        relatedOutboxCount: related.outbox.length,
        relatedHumanGateButtonCount: related.humanGateButtons.length,
        relatedHumanGateRecordCount: related.humanGateRecords.length,
        relatedSideEffectCount: related.sideEffects.length,
        relatedControlLoopJobCount: related.controlLoopJobs.length
      },
      incidentCandidate,
      primary,
      related
    };
  }

  async timeline(workflowId, query = {}) {
    const limit = clampLimit(query.limit, 160, 300);
    const events = [];
    const [
      hasTaskTable,
      hasDispatchTable,
      hasRuntimeRunTable,
      hasProtocolTable,
      hasButtonTable,
      hasOutboxTable,
      hasCheckpointTable,
      hasArtifactTable,
      hasSideEffectTable,
      hasIncidentTable,
      hasMessageFlowTable,
      hasMessageFlowEventTable
    ] = await Promise.all([
      tableExists(this.paths.dbFile, "workflow_tasks"),
      tableExists(this.paths.dbFile, "mixed_meeting_dispatches"),
      tableExists(this.paths.dbFile, "runtime_runs"),
      tableExists(this.paths.dbFile, "protocol_objects"),
      tableExists(this.paths.dbFile, "human_gate_buttons"),
      tableExists(this.paths.dbFile, "telegram_outbox"),
      tableExists(this.paths.dbFile, "workflow_checkpoints"),
      tableExists(this.paths.dbFile, "artifact_index"),
      tableExists(this.paths.dbFile, "side_effect_ledger"),
      tableExists(this.paths.dbFile, "incident_states"),
      tableExists(this.paths.dbFile, "message_flows"),
      tableExists(this.paths.dbFile, "message_flow_events")
    ]);
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
      hasTaskTable ? sqlite(this.paths.dbFile, `
SELECT task_id, parent_task_id, phase, owner_agent, runtime, agent_id, task_type, status, priority, summary, blocked_reason, created_at, updated_at
FROM workflow_tasks
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY updated_at DESC
LIMIT 120;`) : Promise.resolve([]),
      hasDispatchTable ? sqlite(this.paths.dbFile, `
SELECT dispatch_id, runtime, agent_id, dispatch_type, status, priority, prompt, created_by, created_at, updated_at, sent_at, acked_at, completed_at, failure_type, last_error, payload_json
FROM mixed_meeting_dispatches
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 120;`) : Promise.resolve([]),
      hasRuntimeRunTable ? sqlite(this.paths.dbFile, `
SELECT runtime_run_id, dispatch_id, runtime, agent_id, adapter, backend, acp_agent, status, failure_type, attempt, started_at, completed_at, latency_ms, error, payload_json
FROM runtime_runs
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY started_at DESC
LIMIT 120;`) : Promise.resolve([]),
      hasProtocolTable ? sqlite(this.paths.dbFile, `
SELECT object_id, status, source_agent, parent_object_id, path, payload_json, created_at, updated_at
FROM protocol_objects
WHERE object_type='human_gate_record'
  AND ${workflowPayloadWhere(workflowId)}
ORDER BY created_at DESC
LIMIT 80;`) : Promise.resolve([]),
      hasButtonTable ? sqlite(this.paths.dbFile, `
SELECT button_id, human_gate_id, label, decision_status, button_role, summary, status, created_by, created_at, updated_at, selected_by, selected_at, feedback_status, feedback_received_at, payload_json
FROM human_gate_buttons
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 120;`) : Promise.resolve([]),
      hasOutboxTable ? sqlite(this.paths.dbFile, `
SELECT outbox_id, target_kind, target_ref, message_type, status, text, created_at, updated_at, payload_json
FROM telegram_outbox
WHERE meeting_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 100;`) : Promise.resolve([]),
      hasCheckpointTable ? sqlite(this.paths.dbFile, `
SELECT checkpoint_id, status, phase, decision, summary, path, created_by, created_at
FROM workflow_checkpoints
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 80;`) : Promise.resolve([]),
      hasArtifactTable ? sqlite(this.paths.dbFile, `
SELECT artifact_id, kind, path, summary, created_by, created_at
FROM artifact_index
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 100;`) : Promise.resolve([]),
      hasSideEffectTable ? sqlite(this.paths.dbFile, `
SELECT side_effect_id, trace_id, dispatch_id, idempotency_key, owner_agent, side_effect_type, status, artifact_ref, payload_json, created_at, updated_at
FROM side_effect_ledger
WHERE workflow_id=${sqlValue(workflowId)}
ORDER BY created_at DESC
LIMIT 100;`) : Promise.resolve([]),
      hasIncidentTable ? sqlite(this.paths.dbFile, `
SELECT incident_id, status, mode, summary, commander, impact, mitigation, declared_at, next_update_at, resolved_at, updated_at, payload_json
FROM incident_states
WHERE ${incidentWorkflowWhereSql(sqlValue(workflowId), "incident_states")}
ORDER BY declared_at DESC
LIMIT 80;`) : Promise.resolve([]),
      hasMessageFlowTable && hasMessageFlowEventTable ? sqlite(this.paths.dbFile, `
SELECT e.event_id, e.flow_id, e.status, e.event_type, e.payload_json, e.created_at,
  mf.return_policy, mf.target_runtime, mf.target_agent_id, mf.dispatch_id
FROM message_flow_events e
JOIN message_flows mf ON mf.flow_id=e.flow_id
WHERE mf.workflow_id=${sqlValue(workflowId)} OR mf.meeting_id=${sqlValue(workflowId)}
ORDER BY e.created_at DESC
LIMIT 120;`) : Promise.resolve([])
    ]);

    for (const row of tasks) {
      pushTimelineEvent(events, {
        at: row.updated_at || row.created_at,
        kind: "task",
        status: row.status,
        title: `Task ${row.status}: ${row.task_id}`,
        subtitle: compactText(redactText(row.summary || row.blocked_reason || row.task_type)),
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
        promptPreview: compactText(redactText(row.prompt), 240),
        failureType: row.failure_type,
        lastError: compactText(redactText(row.last_error), 240),
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
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
          payload: redactConsoleValue(parseJson(row.payload_json, {}))
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
            error: compactText(redactText(row.error), 240),
            payload: redactConsoleValue(parseJson(row.payload_json, {}))
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
        subtitle: redactText(row.path || row.parent_object_id || ""),
        actor: row.source_agent,
        refId: row.object_id,
        payload: redactConsoleValue(parseJson(row.payload_json, {}))
      });
    }

    for (const row of humanGateButtons) {
      pushTimelineEvent(events, {
        at: row.selected_at || row.feedback_received_at || row.updated_at || row.created_at,
        kind: "human_gate.button",
        status: row.selected_at ? "selected" : row.status,
        severity: row.selected_at ? "ok" : timelineSeverity(row.status),
        title: `Human Gate button: ${redactText(row.label)}`,
        subtitle: compactText(redactText(row.summary || row.prompt || row.decision_status)),
        actor: row.selected_by || row.created_by,
        refId: row.button_id,
        payload: {
          humanGateId: row.human_gate_id,
          decisionStatus: row.decision_status,
          buttonRole: row.button_role,
          feedbackStatus: row.feedback_status,
          payload: redactConsoleValue(parseJson(row.payload_json, {}))
        }
      });
    }

    for (const row of outbox) {
      pushTimelineEvent(events, {
        at: row.updated_at || row.created_at,
        kind: "outbox",
        status: row.status,
        title: `Telegram outbox ${row.status}: ${row.outbox_id}`,
        subtitle: compactText(redactText(row.text || row.message_type)),
        actor: row.target_ref,
        refId: row.outbox_id,
        payload: {
          targetKind: row.target_kind,
          targetRef: row.target_ref,
          messageType: row.message_type,
          payload: redactConsoleValue(parseJson(row.payload_json, {}))
        }
      });
    }

    for (const row of checkpoints) {
      pushTimelineEvent(events, {
        at: row.created_at,
        kind: "checkpoint",
        status: row.status,
        title: `Checkpoint: ${row.checkpoint_id}`,
        subtitle: compactText(redactText(row.summary || row.decision || row.phase)),
        actor: row.created_by,
        refId: row.checkpoint_id,
        payload: redactConsoleValue({ phase: row.phase, decision: row.decision, path: row.path })
      });
    }

    for (const row of artifacts) {
      pushTimelineEvent(events, {
        at: row.created_at,
        kind: "artifact",
        status: "created",
        severity: "ok",
        title: `Artifact: ${row.artifact_id}`,
        subtitle: compactText(redactText(row.summary || row.path || row.kind)),
        actor: row.created_by,
        refId: row.artifact_id,
        payload: redactConsoleValue({ kind: row.kind, path: row.path })
      });
    }

    for (const row of sideEffects) {
      pushTimelineEvent(events, {
        at: row.updated_at || row.created_at,
        kind: "side_effect",
        status: row.status,
        title: `Side effect ${row.status}: ${row.side_effect_id}`,
        subtitle: compactText(redactText(row.artifact_ref || row.side_effect_type)),
        actor: row.owner_agent,
        refId: row.side_effect_id,
        payload: {
          traceId: row.trace_id,
          dispatchId: row.dispatch_id,
          sideEffectType: row.side_effect_type,
          artifactRef: row.artifact_ref,
          payload: redactConsoleValue(parseJson(row.payload_json, {}))
        }
      });
    }

    for (const row of incidents) {
      pushTimelineEvent(events, {
        at: row.resolved_at || row.updated_at || row.declared_at,
        kind: "incident",
        status: row.status,
        title: `Incident ${row.status}: ${row.incident_id}`,
        subtitle: compactText(redactText(row.summary || row.impact || row.mitigation)),
        actor: row.commander,
        refId: row.incident_id,
        payload: {
          mode: row.mode,
          impact: row.impact,
          mitigation: row.mitigation,
          nextUpdateAt: row.next_update_at,
          payload: redactConsoleValue(parseJson(row.payload_json, {}))
        }
      });
    }

    for (const row of messageFlowEvents) {
      const payload = redactConsoleValue(parseJson(row.payload_json, {}));
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
        capabilities: redactConsoleValue(parseJson(row.capabilities_json, {})),
        metadata: redactConsoleValue(parseJson(row.metadata_json, {})),
        capabilities_json: undefined,
        metadata_json: undefined
      }))
    };
  }

  async incidentEvidenceOptions(workflowId, query = {}) {
    const generatedAt = new Date().toISOString();
    const empty = {
      schemaVersion: "workflow_incident_evidence_options.v1",
      generatedAt,
      source: "workflow_console_read_model",
      writeMode: "read_only_derived_options",
      workflowId,
      query: {
        kind: String(query.kind || ""),
        refId: String(query.refId || query.ref_id || "")
      },
      humanGateOptions: [],
      catClawAuditOptions: [],
      counts: {
        humanGateOptions: 0,
        catClawAuditOptions: 0
      }
    };
    if (!String(workflowId || "").trim()) return empty;
    const queryKind = String(query.kind || "");
    const queryRefId = String(query.refId || query.ref_id || "");
    const [humanGates, verification, deadLetterEvidence] = await Promise.all([
      this.humanGates(workflowId),
      this.verification(workflowId, { limit: query.limit || 200 }),
      queryKind && queryRefId ? this.deadLetterEvidence({ workflowId, kind: queryKind, refId: queryRefId }) : null
    ]);
    const deadLetterRefs = collectDeadLetterReferenceIds(deadLetterEvidence || {}, workflowId);
    const baseReasons = () => [evidenceReason("same_workflow", "same workflow", `workflowId=${workflowId}`, [workflowId])];
    const humanGateSeen = new Set();
    const humanGateOptions = [];
    const pushHumanGate = (option) => {
      const id = String(option.id || "").trim();
      if (!id || humanGateSeen.has(id)) return;
      humanGateSeen.add(id);
      humanGateOptions.push({ ...option, id });
    };
    for (const record of humanGates.records || []) {
      const sourceAgent = record.source_agent || "";
      const status = record.status || "";
      const reasons = baseReasons();
      if (String(sourceAgent).toLowerCase() === "cat_claw") {
        addEvidenceReason(reasons, "cat_claw_source", "Cat Claw source", "Human Gate record was created or sourced by cat_claw.", [record.object_id]);
      }
      if (positiveEvidenceStatus(status)) {
        addEvidenceReason(reasons, "positive_status", "positive evidence status", `Human Gate record status is ${status}.`, [record.object_id]);
      }
      const matchedRefs = matchingDeadLetterRefs(record, deadLetterRefs);
      if (matchedRefs.length) {
        addEvidenceReason(reasons, "references_dead_letter", "references current dead-letter evidence", "Record text or payload references the selected dead-letter row or a related dispatch/runtime/outbox id.", matchedRefs);
      }
      pushHumanGate({
        id: record.object_id,
        source: "protocol_objects",
        status,
        title: record.object_id,
        summary: compactText(record.payload?.summary || record.path || status || "", 180),
        sourceAgent,
        createdAt: record.created_at || "",
        updatedAt: record.updated_at || "",
        recommended: reasons.some((reason) => reason.code !== "same_workflow"),
        recommendationReasons: reasons,
        recommendationSummary: evidenceReasonSummary(reasons)
      });
    }
    const buttonGroups = new Map();
    for (const button of humanGates.buttons || []) {
      const humanGateId = String(button.human_gate_id || "").trim();
      if (!humanGateId) continue;
      const existing = buttonGroups.get(humanGateId) || {
        labels: [],
        statuses: new Set(),
        createdBy: button.created_by || "",
        createdAt: button.created_at || "",
        updatedAt: button.updated_at || "",
        buttons: []
      };
      if (button.label) existing.labels.push(button.label);
      if (button.status) existing.statuses.add(button.status);
      existing.updatedAt = latestIso([existing.updatedAt, button.updated_at]);
      existing.buttons.push(button);
      buttonGroups.set(humanGateId, existing);
    }
    for (const [humanGateId, group] of buttonGroups.entries()) {
      const statusText = [...group.statuses].join(", ") || "";
      const reasons = baseReasons();
      if (String(group.createdBy || "").toLowerCase() === "cat_claw") {
        addEvidenceReason(reasons, "cat_claw_source", "Cat Claw source", "Human Gate buttons were created by cat_claw.", [humanGateId]);
      }
      if ([...group.statuses].some((status) => positiveEvidenceStatus(status))) {
        addEvidenceReason(reasons, "positive_status", "positive evidence status", `Human Gate button status is ${statusText}.`, [humanGateId]);
      }
      const matchedRefs = matchingDeadLetterRefs({ humanGateId, ...group, statuses: [...group.statuses] }, deadLetterRefs);
      if (matchedRefs.length) {
        addEvidenceReason(reasons, "references_dead_letter", "references current dead-letter evidence", "Button text or payload references the selected dead-letter row or a related dispatch/runtime/outbox id.", matchedRefs);
      }
      pushHumanGate({
        id: humanGateId,
        source: "human_gate_buttons",
        status: statusText,
        title: humanGateId,
        summary: compactText(group.labels.join(" / "), 180),
        sourceAgent: group.createdBy || "",
        createdAt: group.createdAt || "",
        updatedAt: group.updatedAt || "",
        recommended: reasons.some((reason) => reason.code !== "same_workflow"),
        recommendationReasons: reasons,
        recommendationSummary: evidenceReasonSummary(reasons)
      });
    }

    const catClawOptions = [];
    for (const result of verification.results || []) {
      const actors = [result.sourceAgent, result.createdBy, result.verifierAgent, result.refuterAgent].map((value) => String(value || "").toLowerCase());
      const resultType = String(result.resultType || "").toLowerCase();
      const isSecretaryAudit = resultType === "secretary_audit";
      const isCatClaw = actors.includes("cat_claw");
      if (!isSecretaryAudit && !isCatClaw) continue;
      const reasons = baseReasons();
      if (isSecretaryAudit) {
        addEvidenceReason(reasons, "secretary_audit", "secretary audit result", "Verification resultType is secretary_audit.", [result.verificationId]);
      }
      if (isCatClaw) {
        addEvidenceReason(reasons, "cat_claw_source", "Cat Claw source", "Verification actor includes cat_claw.", [result.verificationId]);
      }
      if (positiveEvidenceStatus(result.decision)) {
        addEvidenceReason(reasons, "positive_decision", "positive audit decision", `Verification decision is ${result.decision}.`, [result.verificationId]);
      }
      const matchedRefs = matchingDeadLetterRefs(result, deadLetterRefs);
      if (matchedRefs.length) {
        addEvidenceReason(reasons, "references_dead_letter", "references current dead-letter evidence", "Verification refs or payload references the selected dead-letter row or a related dispatch/runtime/outbox id.", matchedRefs);
      }
      catClawOptions.push({
        id: result.verificationId,
        source: "workflow_verification_results",
        resultType: result.resultType || "",
        decision: result.decision || "",
        title: result.verificationId,
        summary: compactText(result.summary || result.decision || result.resultType, 180),
        sourceAgent: result.sourceAgent || result.createdBy || "",
        createdAt: result.createdAt || "",
        dispatchId: result.dispatchId || "",
        runtimeRunId: result.runtimeRunId || "",
        recommended: reasons.some((reason) => reason.code !== "same_workflow"),
        recommendationReasons: reasons,
        recommendationSummary: evidenceReasonSummary(reasons)
      });
    }
    humanGateOptions.sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    catClawOptions.sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      ...empty,
      humanGateOptions,
      catClawAuditOptions: catClawOptions,
      counts: {
        humanGateOptions: humanGateOptions.length,
        catClawAuditOptions: catClawOptions.length
      }
    };
  }

  async incidentCloseout(workflowId, query = {}) {
    const generatedAt = new Date().toISOString();
    const empty = {
      schemaVersion: "workflow_incident_closeout.v1",
      generatedAt,
      source: "workflow_console_read_model",
      writeMode: "read_only_derived_closeout",
      workflowId,
      incidentId: String(query.incidentId || query.incident_id || ""),
      status: "not_found",
      selectedIncident: null,
      incidents: [],
      checklist: [],
      timeline: [],
      refs: {},
      counts: {
        incidents: 0,
        events: 0,
        checklist: 0,
        passed: 0,
        failed: 0,
        warnings: 0
      }
    };
    if (!String(workflowId || "").trim()) return empty;
    if (!(await tableExists(this.paths.dbFile, "incident_states"))) return empty;
    const incidentId = String(query.incidentId || query.incident_id || "").trim();
    const workflowLinkedWhere = incidentWorkflowWhereSql(sqlValue(workflowId), "incident_states");
    const incidentWhere = [
      incidentId
        ? `(incident_id=${sqlValue(incidentId)} AND (${workflowLinkedWhere} OR NOT ${incidentHasAnyWorkflowLinkSql("incident_states")}))`
        : workflowLinkedWhere
    ];
    const incidentRows = await sqlite(this.paths.dbFile, `
SELECT incident_id, status, mode, affected_planes_json, summary, commander, impact, current_hypothesis, mitigation, rollback_options, exit_criteria, timeline_json, payload_json, declared_at, next_update_at, resolved_at, updated_at
FROM incident_states
WHERE ${incidentWhere.join(" AND ")}
ORDER BY updated_at DESC, declared_at DESC
LIMIT 80;`);
    const incidents = incidentRows.map(parseIncidentRow);
    const selectedIncident = incidents.find((row) => row.incidentId === incidentId)
      || incidents.find((row) => ["active", "mitigating", "monitoring"].includes(String(row.status || "").toLowerCase()))
      || incidents[0]
      || null;
    if (!selectedIncident) return { ...empty, incidents, counts: { ...empty.counts, incidents: incidents.length } };

    const selectedPayload = selectedIncident.payload || {};
    const deadLetter = selectedPayload.deadLetter || {};
    const humanGateEvidenceRefs = uniqueNonEmpty([
      selectedPayload.humanGateId,
      selectedPayload.human_gate_id,
      selectedPayload.humanGateEvidence,
      selectedPayload.human_gate_evidence,
      selectedPayload.riskDecisionId,
      selectedPayload.risk_decision_id,
      selectedPayload.flashcatOriginalWords,
      selectedPayload.flashcat_original_words
    ]);
    const humanGateId = humanGateEvidenceRefs[0] || "";
    const catClawAuditId = String(selectedPayload.catClawAuditId || selectedPayload.cat_claw_audit_id || selectedPayload.secretaryAuditId || selectedPayload.secretary_audit_id || selectedPayload.catClawAudit || selectedPayload.cat_claw_audit || "").trim();
    const operatorReason = String(selectedPayload.operatorReason || selectedPayload.operator_reason || selectedPayload.closeoutEvidence?.operatorReason || selectedPayload.closeoutEvidence?.operator_reason || "").trim();
    const hasDeadLetterInput = Boolean(deadLetter.kind && deadLetter.refId);
    const legacyIncident = !hasDeadLetterInput;
    const createdByAction = String(selectedPayload.createdByAction || "").trim();
    const [
      workflowTimeline,
      humanGateReadiness,
      receipts,
      checkpoints,
      evidenceOptions,
      deadLetterEvidence
    ] = await Promise.all([
      this.timeline(workflowId, { limit: 300 }),
      this.humanGateReadiness(workflowId),
      this.receipts(workflowId, { limit: 200 }),
      this.checkpoints(workflowId),
      hasDeadLetterInput ? this.incidentEvidenceOptions(workflowId, { kind: deadLetter.kind, refId: deadLetter.refId, limit: 200 }) : null,
      hasDeadLetterInput ? this.deadLetterEvidence({ workflowId, kind: deadLetter.kind, refId: deadLetter.refId }) : null
    ]);

    const hasWorkflowEvents = await tableExists(this.paths.dbFile, "workflow_events");
    const workflowEvents = hasWorkflowEvents ? await sqlite(this.paths.dbFile, `
SELECT event_id, event_type, status, workflow_id, trace_id, task_id, dispatch_id, runtime_run_id, message_flow_id, human_gate_id, side_effect_id, incident_id, actor, source_runtime, source_agent, previous_state, next_state, idempotency_key, artifact_ref, payload_json, created_at
FROM workflow_events
WHERE workflow_id=${sqlValue(workflowId)}
  AND (incident_id=${sqlValue(selectedIncident.incidentId)} OR event_type LIKE 'incident.%' OR human_gate_id=${sqlValue(humanGateId)})
ORDER BY created_at DESC
LIMIT 120;`) : [];
    const eventTimeline = workflowEvents.map((row) => ({
      at: row.created_at || "",
      kind: row.event_type || "workflow_event",
      status: row.status || "",
      severity: timelineSeverity(row.status),
      title: `Workflow event: ${row.event_type || row.event_id}`,
      subtitle: compactText(redactText(row.previous_state || row.next_state || row.artifact_ref || ""), 220),
      actor: row.actor || row.source_agent || "",
      refId: row.event_id || "",
      payload: redactConsoleValue({
        traceId: row.trace_id,
        taskId: row.task_id,
        dispatchId: row.dispatch_id,
        runtimeRunId: row.runtime_run_id,
        messageFlowId: row.message_flow_id,
        humanGateId: row.human_gate_id,
        sideEffectId: row.side_effect_id,
        incidentId: row.incident_id,
        artifactRef: row.artifact_ref,
        payload: parseJson(row.payload_json, {})
      })
    }));
    const incidentNotes = parseIncidentTimelineRows(incidentRows.find((row) => row.incident_id === selectedIncident.incidentId) || {});
    const relatedTimeline = [
      ...incidentNotes,
      ...eventTimeline,
      ...(workflowTimeline.events || []).filter((event) => {
        const ref = String(event.refId || "");
        return ref === selectedIncident.incidentId
          || ref === humanGateId
          || ref === catClawAuditId
          || ref === deadLetter.refId
          || String(event.payload?.humanGateId || "") === humanGateId
          || String(event.payload?.incidentId || "") === selectedIncident.incidentId;
      })
    ].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

    const evidenceCatClawIds = new Set((evidenceOptions?.catClawAuditOptions || []).map((row) => row.id));
    const evidenceHumanGateIds = new Set((evidenceOptions?.humanGateOptions || []).map((row) => row.id));
    const checkpointRows = checkpoints.checkpoints || [];
    const receiptSummary = receipts.summary || {};
    const receiptPresentCount = Number(receiptSummary.present || 0);
    const telegramOutboxReceipts = (receipts.receipts || []).filter((row) => row.kind === "telegram_outbox");
    const completeTelegramReceipts = telegramOutboxReceipts.filter((row) => row.deliveryReceipt?.receiptComplete);
    const partialTelegramReceipts = telegramOutboxReceipts.filter((row) => row.deliveryReceipt?.terminal && !row.deliveryReceipt?.receiptComplete);
    const checklist = [
      closeoutCheck(
        "incident_state",
        "Incident state exists",
        Boolean(selectedIncident.incidentId),
        selectedIncident.incidentId ? `${selectedIncident.status}/${selectedIncident.mode}` : "No incident state is linked to this workflow.",
        [selectedIncident.incidentId]
      ),
      closeoutCheck(
        "dead_letter_evidence_current",
        legacyIncident ? "Legacy incident has no dead-letter link" : "Dead-letter evidence is current",
        legacyIncident || Boolean(deadLetterEvidence?.found && deadLetterEvidence?.incidentCandidate),
        legacyIncident
          ? "Legacy incident payload has no deadLetter reference; use incident fields, timeline, receipts, and Cat Claw audit for closeout evidence."
          : deadLetterEvidence?.found ? `${deadLetter.kind}/${deadLetter.refId} is still a current candidate.` : "Dead-letter row no longer matches a current predicate or is missing.",
        [deadLetter.refId],
        legacyIncident ? "warning" : "required"
      ),
      closeoutCheck(
        "human_gate_evidence",
        "Human Gate evidence linked",
        Boolean(humanGateId || evidenceHumanGateIds.size || humanGateReadiness.summary?.recordCount),
        humanGateId ? `Linked Human Gate evidence: ${humanGateId}.` : `${humanGateReadiness.summary?.recordCount || 0} workflow Human Gate record(s) available.`,
        [...humanGateEvidenceRefs, ...evidenceHumanGateIds]
      ),
      closeoutCheck(
        "cat_claw_audit",
        "Cat Claw audit linked",
        Boolean(catClawAuditId || evidenceCatClawIds.size),
        catClawAuditId ? `Linked Cat Claw/secretary audit: ${catClawAuditId}.` : `${evidenceCatClawIds.size} Cat Claw/secretary audit candidate(s) available.`,
        [catClawAuditId, ...evidenceCatClawIds]
      ),
      closeoutCheck(
        "operator_reason",
        "Operator reason recorded",
        Boolean(operatorReason),
        operatorReason ? operatorReason : "No operator reason is recorded in the incident payload.",
        []
      ),
      closeoutCheck(
        "rollback_boundary",
        "Rollback/stop boundary recorded",
        Boolean(selectedIncident.rollbackOptions || selectedPayload.incidentCandidate?.rollbackBoundary || selectedPayload.rollbackBoundary || selectedPayload.rollback_boundary || selectedPayload.closeoutEvidence?.rollbackBoundary || selectedPayload.closeoutEvidence?.rollback_boundary),
        selectedIncident.rollbackOptions || selectedPayload.incidentCandidate?.rollbackBoundary || selectedPayload.rollbackBoundary || selectedPayload.rollback_boundary || selectedPayload.closeoutEvidence?.rollbackBoundary || selectedPayload.closeoutEvidence?.rollback_boundary || "No rollback or stop boundary is recorded.",
        []
      ),
      closeoutCheck(
        "side_effect_boundary",
        "No automatic repair or side-effect mutation",
        createdByAction === "workflow.incident.from_dead_letter" || legacyIncident,
        createdByAction === "workflow.incident.from_dead_letter"
          ? "Incident was created by the dead-letter linkage path with incident_state_only boundary."
          : legacyIncident
            ? "Legacy incident was not created by the governed dead-letter linkage path; no closeout action should mutate runtime, workflow status, delivery, or side effects."
            : "Incident was not created by the governed dead-letter linkage path.",
        [createdByAction],
        createdByAction === "workflow.incident.from_dead_letter" ? "required" : "warning"
      ),
      closeoutCheck(
        "telegram_delivery_receipt",
        "Telegram delivery receipt complete",
        completeTelegramReceipts.length > 0,
        completeTelegramReceipts.length
          ? `${completeTelegramReceipts.length} complete terminal Telegram delivery receipt(s).`
          : `${partialTelegramReceipts.length} partial terminal Telegram delivery receipt(s), ${telegramOutboxReceipts.length} Telegram outbox receipt candidate(s).`,
        completeTelegramReceipts.map((row) => row.outboxId || row.receiptId),
        "warning"
      ),
      closeoutCheck(
        "final_receipt_or_checkpoint",
        "Final receipt or checkpoint available",
        selectedIncident.status === "resolved" || receiptPresentCount > 0 || checkpointRows.length > 0,
        selectedIncident.status === "resolved"
          ? "Incident is resolved."
          : `${receiptPresentCount} present receipt(s), ${checkpointRows.length} checkpoint(s).`,
        [...checkpointRows.slice(0, 5).map((row) => row.checkpointId || row.checkpoint_id), selectedIncident.status === "resolved" ? selectedIncident.incidentId : ""],
        "warning"
      )
    ];
    const failed = checklist.filter((row) => row.status === "fail").length;
    const warnings = checklist.filter((row) => row.status === "warn").length;
    return {
      ...empty,
      incidentId: selectedIncident.incidentId,
      status: failed ? "needs_evidence" : warnings ? "needs_closeout" : "ready_for_closeout",
      selectedIncident,
      incidents,
      checklist,
      timeline: relatedTimeline.slice(0, clampLimit(query.limit, 160, 300)),
      refs: {
        incidentId: selectedIncident.incidentId,
        deadLetter,
        humanGateId,
        humanGateEvidenceRefs,
        catClawAuditId,
        workflowEventIds: workflowEvents.map((row) => row.event_id),
        checkpointIds: checkpointRows.map((row) => row.checkpointId || row.checkpoint_id).filter(Boolean),
        receiptSummary
      },
      counts: {
        incidents: incidents.length,
        events: workflowEvents.length,
        checklist: checklist.length,
        passed: checklist.filter((row) => row.status === "pass").length,
        failed,
        warnings
      }
    };
  }

  async operationsSummary(query = {}) {
    const workflowId = String(query.workflowId || query.workflow_id || "").trim();
    const workflowFilter = workflowId ? `workflow_id=${sqlValue(workflowId)}` : "1=1";
    const meetingFilter = workflowId ? `meeting_id=${sqlValue(workflowId)}` : "1=1";
    const protocolFilter = workflowId ? workflowPayloadWhere(workflowId) : "1=1";
    const [hasWorkflowOperations, hasControlLoopJobs, hasDispatchTable, hasOutboxTable, hasProtocolTable, hasMessageFlowTable, hasHumanGateButtons, hasSideEffects] = await Promise.all([
      tableExists(this.paths.dbFile, "workflow_operations"),
      tableExists(this.paths.dbFile, "control_loop_jobs"),
      tableExists(this.paths.dbFile, "mixed_meeting_dispatches"),
      tableExists(this.paths.dbFile, "telegram_outbox"),
      tableExists(this.paths.dbFile, "protocol_objects"),
      tableExists(this.paths.dbFile, "message_flows"),
      tableExists(this.paths.dbFile, "human_gate_buttons"),
      tableExists(this.paths.dbFile, "side_effect_ledger")
    ]);
    const nowIso = new Date().toISOString();
    const staleDispatchMinutes = clampNumber(query.staleDispatchMinutes || query.stale_dispatch_minutes, 30, 1, 24 * 60);
    const humanGateFeedbackHours = clampNumber(query.humanGateFeedbackHours || query.human_gate_feedback_hours, 24, 1, 24 * 30);
    const messageFlowStuckMinutes = clampNumber(query.messageFlowStuckMinutes || query.message_flow_stuck_minutes, 5, 1, 24 * 60);
    const staleDispatchCutoff = new Date(Date.now() - staleDispatchMinutes * 60_000).toISOString();
    const humanGateFeedbackCutoff = new Date(Date.now() - humanGateFeedbackHours * 3600_000).toISOString();
    const messageFlowStuckCutoff = new Date(Date.now() - messageFlowStuckMinutes * 60_000).toISOString();
    const deadLetterKinds = filterValues(query.deadLetterKind || query.dead_letter_kind || query.kind);
    const deadLetterSeverities = filterValues(query.deadLetterSeverity || query.dead_letter_severity || query.severity);
    const deadLetterStatuses = filterValues(query.deadLetterStatus || query.dead_letter_status || query.status);
    const deadLetterLimit = clampLimit(query.deadLetterLimit || query.dead_letter_limit, 200, 500);
    const operationColumns = hasWorkflowOperations ? await tableColumnSet(this.paths.dbFile, "workflow_operations") : new Set();
    const operationsCanScope = operationColumns.has("workflow_id");
    const operationsWhere = workflowId
      ? (operationsCanScope ? `WHERE workflow_id=${sqlValue(workflowId)}` : "WHERE 0=1")
      : "";
    const operationsOrder = operationColumns.has("updated_at")
      ? "updated_at DESC"
      : (operationColumns.has("created_at") ? "created_at DESC" : (operationColumns.has("operation_id") ? "operation_id DESC" : "rowid DESC"));
    const jobs = hasControlLoopJobs ? await sqlite(this.paths.dbFile, `
SELECT status, job_type, COUNT(*) AS count
FROM control_loop_jobs
WHERE ${workflowFilter}
GROUP BY status, job_type
ORDER BY status, job_type;`) : [];
    const workflowOperationSummary = hasWorkflowOperations ? await sqlite(this.paths.dbFile, `
SELECT
  ${columnExpr(operationColumns, "status", "''")},
  ${columnExpr(operationColumns, "action", "''")},
  ${columnExpr(operationColumns, "risk_tier", "''")},
  ${columnExpr(operationColumns, "dry_run", "0")},
  COUNT(*) AS count
FROM workflow_operations
${operationsWhere}
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3;`) : [];
    const workflowOperations = hasWorkflowOperations ? await sqlite(this.paths.dbFile, `
SELECT
  ${columnExpr(operationColumns, "operation_id", "''")},
  ${columnExpr(operationColumns, "action", "''")},
  ${columnExpr(operationColumns, "scope_type", "'workflow'")},
  ${columnExpr(operationColumns, "scope_id", "''")},
  ${columnExpr(operationColumns, "workflow_id", "''")},
  ${columnExpr(operationColumns, "requested_by", "''")},
  ${columnExpr(operationColumns, "reason", "''")},
  ${columnExpr(operationColumns, "risk_tier", "''")},
  ${columnExpr(operationColumns, "status", "''")},
  ${columnExpr(operationColumns, "dry_run", "0")},
  ${columnExpr(operationColumns, "idempotency_key", "''")},
  ${columnExpr(operationColumns, "human_gate_id", "''")},
  ${columnExpr(operationColumns, "input_hash", "''")},
  ${columnExpr(operationColumns, "preview_result_json", "'{}'")},
  ${columnExpr(operationColumns, "result_json", "'{}'")},
  ${columnExpr(operationColumns, "error", "''")},
  ${columnExpr(operationColumns, "created_at", "''")},
  ${columnExpr(operationColumns, "updated_at", "''")},
  ${columnExpr(operationColumns, "completed_at", "''")}
FROM workflow_operations
${operationsWhere}
ORDER BY ${operationsOrder}
LIMIT 120;`) : [];
    const staleDispatches = hasDispatchTable ? await sqlite(this.paths.dbFile, `
SELECT dispatch_id, workflow_id, runtime, agent_id, status, attempt, max_attempts, updated_at, failure_type, last_error
FROM mixed_meeting_dispatches
WHERE ${workflowFilter}
  AND ((status='sent' AND updated_at < ${sqlValue(staleDispatchCutoff)})
   OR status='failed')
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const outbox = hasOutboxTable ? await sqlite(this.paths.dbFile, `
SELECT status, message_type, COUNT(*) AS count
FROM telegram_outbox
WHERE ${meetingFilter}
GROUP BY status, message_type
ORDER BY status, message_type;`) : [];
    const humanGate = hasProtocolTable ? await sqlite(this.paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM protocol_objects
WHERE object_type='human_gate_record'
  AND ${protocolFilter}
GROUP BY status
ORDER BY status;`) : [];
    const messageFlow = hasMessageFlowTable ? await sqlite(this.paths.dbFile, `
SELECT status, return_policy, target_runtime, COUNT(*) AS count,
  SUM(CASE WHEN final_output_present=1 THEN 1 ELSE 0 END) AS final_output_present,
  SUM(CASE WHEN delivery_receipt_present=1 THEN 1 ELSE 0 END) AS delivery_receipt_present
FROM message_flows
WHERE ${workflowId ? `(workflow_id=${sqlValue(workflowId)} OR meeting_id=${sqlValue(workflowId)})` : "1=1"}
GROUP BY status, return_policy, target_runtime
ORDER BY status, return_policy, target_runtime;`) : [];
    const messageFlowAttention = hasMessageFlowTable ? await sqlite(this.paths.dbFile, `
SELECT flow_id, workflow_id, meeting_id, target_runtime, target_agent_id, return_policy, status,
  final_output_present, delivery_receipt_present, runtime_completed_at, runtime_failed_at,
  outbox_id, updated_at, last_error
FROM message_flows
WHERE
  ${workflowId ? `(workflow_id=${sqlValue(workflowId)} OR meeting_id=${sqlValue(workflowId)}) AND` : ""}
  ((
    return_policy IN ('reply_to_source_chat','report_to_flashcat')
    AND delivery_receipt_present=0
    AND target_runtime NOT IN ('local_codex','codex')
    AND (COALESCE(runtime_completed_at,'') != '' OR COALESCE(runtime_failed_at,'') != '')
  )
  OR status IN ('runtime_failed','telegram_failed'))
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const messageFlowDeadLetters = hasMessageFlowTable ? await sqlite(this.paths.dbFile, `
SELECT flow_id, workflow_id, meeting_id, target_runtime, target_agent_id, return_policy, status,
  final_output_present, delivery_receipt_present, runtime_completed_at, runtime_failed_at,
  outbox_id, updated_at, last_error
FROM message_flows
WHERE
  ${workflowId ? `(workflow_id=${sqlValue(workflowId)} OR meeting_id=${sqlValue(workflowId)}) AND` : ""}
  return_policy IN ('reply_to_source_chat','report_to_flashcat')
  AND delivery_receipt_present=0
  AND target_runtime NOT IN ('local_codex','codex')
  AND (
    (
      final_output_present=1
      AND status NOT IN ('telegram_sent','telegram_failed')
      AND COALESCE(runtime_completed_at,'') != ''
      AND runtime_completed_at <= ${sqlValue(messageFlowStuckCutoff)}
    )
    OR (
      final_output_present=0
      AND status='runtime_failed'
      AND COALESCE(outbox_id,'') != ''
      AND COALESCE(runtime_failed_at,'') != ''
      AND runtime_failed_at <= ${sqlValue(messageFlowStuckCutoff)}
    )
    OR (
      status='telegram_failed'
      AND updated_at <= ${sqlValue(messageFlowStuckCutoff)}
    )
  )
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const controlLoopJobDetails = hasControlLoopJobs ? await sqlite(this.paths.dbFile, `
SELECT job_id, job_type, dedupe_key, priority, status, workflow_id, runtime, payload_json, result_json,
  attempt, max_attempts, next_run_at, lease_owner, lease_until, last_error, created_at, updated_at, completed_at
FROM control_loop_jobs
WHERE job_type IN ('runtime_drain','message_flow_reconcile','telegram_outbox_deliver','human_gate_request_ensure','human_gate_inbox')
  AND ${workflowFilter}
ORDER BY updated_at DESC
LIMIT 120;`) : [];
    const failedControlLoopJobs = hasControlLoopJobs ? await sqlite(this.paths.dbFile, `
SELECT job_id, job_type, status, workflow_id, runtime, attempt, max_attempts, lease_owner, lease_until, last_error, updated_at
FROM control_loop_jobs
WHERE ${workflowFilter}
  AND (status IN ('failed','dead_letter')
    OR (max_attempts > 0 AND attempt >= max_attempts AND status NOT IN ('completed','cancelled','succeeded')))
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const expiredControlLoopLeases = hasControlLoopJobs ? await sqlite(this.paths.dbFile, `
SELECT job_id, job_type, status, workflow_id, runtime, attempt, max_attempts, lease_owner, lease_until, last_error, updated_at
FROM control_loop_jobs
WHERE ${workflowFilter}
  AND status='running'
  AND lease_until IS NOT NULL
  AND lease_until != ''
  AND lease_until <= ${sqlValue(nowIso)}
ORDER BY lease_until ASC
LIMIT 100;`) : [];
    const failedDispatches = hasDispatchTable ? await sqlite(this.paths.dbFile, `
SELECT dispatch_id, workflow_id, runtime, agent_id, status, attempt, max_attempts, updated_at, failure_type, last_error
FROM mixed_meeting_dispatches
WHERE ${workflowFilter}
  AND status='failed'
  AND NOT (max_attempts > 0 AND attempt >= max_attempts)
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const maxAttemptDispatches = hasDispatchTable ? await sqlite(this.paths.dbFile, `
SELECT dispatch_id, workflow_id, runtime, agent_id, status, attempt, max_attempts, updated_at, failure_type, last_error
FROM mixed_meeting_dispatches
WHERE ${workflowFilter}
  AND max_attempts > 0
  AND attempt >= max_attempts
  AND status NOT IN ('acked','completed','runtime_completed','cancelled','stopped')
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const stuckHumanGateFeedback = hasHumanGateButtons ? await sqlite(this.paths.dbFile, `
SELECT button_id, human_gate_id, workflow_id, meeting_id, label, decision_status, status, created_by, updated_at
FROM human_gate_buttons
WHERE ${workflowId ? `workflow_id=${sqlValue(workflowId)}` : "1=1"}
  AND status='feedback_pending'
  AND updated_at <= ${sqlValue(humanGateFeedbackCutoff)}
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const sideEffectUncertainRows = hasSideEffects ? await sqlite(this.paths.dbFile, `
SELECT side_effect_id, workflow_id, dispatch_id, owner_agent, side_effect_type, status, artifact_ref, updated_at
FROM side_effect_ledger
WHERE ${workflowFilter}
  AND status IN ('uncertain','side_effect_uncertain','unknown','failed')
ORDER BY updated_at ASC
LIMIT 100;`) : [];
    const allDeadLetters = [
      ...failedControlLoopJobs.map((row) => ({
        kind: "control_loop_job",
        severity: "critical",
        status: row.status,
        workflowId: row.workflow_id || "",
        refId: row.job_id,
        title: `${row.job_type} ${row.status}`,
        runtime: row.runtime || "",
        attempt: toInt(row.attempt),
        maxAttempts: toInt(row.max_attempts),
        updatedAt: row.updated_at,
        detail: redactText(row.last_error || "")
      })),
      ...expiredControlLoopLeases.map((row) => ({
        kind: "expired_lease",
        severity: "critical",
        status: row.status,
        workflowId: row.workflow_id || "",
        refId: row.job_id,
        title: `${row.job_type} lease expired`,
        runtime: row.runtime || "",
        leaseOwner: row.lease_owner || "",
        leaseUntil: row.lease_until || "",
        attempt: toInt(row.attempt),
        maxAttempts: toInt(row.max_attempts),
        updatedAt: row.updated_at,
        detail: redactText(row.last_error || "")
      })),
      ...failedDispatches.map((row) => ({
        kind: "failed_dispatch",
        severity: deadLetterIncidentSeverity("failed_dispatch", row.status),
        status: row.status,
        workflowId: row.workflow_id || "",
        refId: row.dispatch_id,
        title: `${row.runtime || ""}:${row.agent_id || ""} dispatch failed`,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        attempt: toInt(row.attempt),
        maxAttempts: toInt(row.max_attempts),
        updatedAt: row.updated_at,
        detail: redactText(row.last_error || row.failure_type || "")
      })),
      ...maxAttemptDispatches.map((row) => ({
        kind: "max_attempt_dispatch",
        severity: deadLetterIncidentSeverity("max_attempt_dispatch", row.status),
        status: row.status,
        workflowId: row.workflow_id || "",
        refId: row.dispatch_id,
        title: `${row.runtime || ""}:${row.agent_id || ""} dispatch at max attempts`,
        runtime: row.runtime || "",
        agentId: row.agent_id || "",
        attempt: toInt(row.attempt),
        maxAttempts: toInt(row.max_attempts),
        updatedAt: row.updated_at,
        detail: redactText(row.last_error || row.failure_type || "")
      })),
      ...stuckHumanGateFeedback.map((row) => ({
        kind: "human_gate_feedback",
        severity: "warning",
        status: row.status,
        workflowId: row.workflow_id || row.meeting_id || "",
        refId: row.button_id,
        humanGateId: row.human_gate_id || "",
        title: `Human Gate feedback pending: ${row.label || row.decision_status || row.button_id}`,
        actor: row.created_by || "",
        updatedAt: row.updated_at,
        detail: redactText(row.decision_status || "")
      })),
      ...sideEffectUncertainRows.map((row) => ({
        kind: "side_effect_uncertain",
        severity: "critical",
        status: row.status,
        workflowId: row.workflow_id || "",
        refId: row.side_effect_id,
        dispatchId: row.dispatch_id || "",
        title: `${row.side_effect_type || "side_effect"} ${row.status}`,
        actor: row.owner_agent || "",
        updatedAt: row.updated_at,
        detail: redactText(row.artifact_ref || "")
      })),
      ...messageFlowDeadLetters.map((row) => ({
        kind: "message_flow_delivery_missing",
        severity: row.status === "telegram_failed" || row.status === "runtime_failed" ? "critical" : "warning",
        status: row.status,
        workflowId: row.workflow_id || row.meeting_id || "",
        refId: row.flow_id,
        title: `${row.target_runtime || ""}:${row.target_agent_id || ""} message_flow delivery missing`,
        runtime: row.target_runtime || "",
        agentId: row.target_agent_id || "",
        returnPolicy: row.return_policy || "",
        outboxId: row.outbox_id || "",
        updatedAt: row.updated_at,
        detail: redactText(row.last_error || "")
      }))
    ].sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")));
    const deadLettersFiltered = allDeadLetters.filter((item) => {
      if (deadLetterKinds.length && !deadLetterKinds.includes(item.kind)) return false;
      if (deadLetterSeverities.length && !deadLetterSeverities.includes(item.severity)) return false;
      if (deadLetterStatuses.length && !deadLetterStatuses.includes(item.status)) return false;
      return true;
    });
    const deadLetters = deadLettersFiltered.slice(0, deadLetterLimit);
    const readiness = await this.readinessLatest();
    return {
      workflowId,
      source: workflowId ? "workflow_scoped" : "global",
      deadLetters,
      deadLetterFilter: {
        applied: {
          kinds: deadLetterKinds,
          severities: deadLetterSeverities,
          statuses: deadLetterStatuses
        },
        limit: deadLetterLimit,
        totalBeforeFilter: allDeadLetters.length,
        totalAfterFilter: deadLettersFiltered.length,
        returned: deadLetters.length
      },
      deadLetterSummary: Object.values(deadLettersFiltered.reduce((acc, item) => {
        const key = `${item.kind}:${item.severity}`;
        acc[key] ||= { kind: item.kind, severity: item.severity, count: 0 };
        acc[key].count += 1;
        return acc;
      }, {})),
      deadLetterAvailableSummary: Object.values(allDeadLetters.reduce((acc, item) => {
        const key = `${item.kind}:${item.severity}`;
        acc[key] ||= { kind: item.kind, severity: item.severity, count: 0 };
        acc[key].count += 1;
        return acc;
      }, {})),
      deadLetterAvailableStatuses: Object.values(allDeadLetters.reduce((acc, item) => {
        const key = String(item.status || "unknown");
        acc[key] ||= { status: key, count: 0 };
        acc[key].count += 1;
        return acc;
      }, {})),
      controlLoopJobs: jobs,
      workflowOperationSummary: workflowOperationSummary.map((row) => ({
        status: row.status,
        action: row.action,
        riskTier: row.risk_tier || "",
        dryRun: Boolean(Number(row.dry_run || 0)),
        count: toInt(row.count)
      })),
      workflowOperations: workflowOperations.map((row) => ({
        operationId: row.operation_id,
        action: row.action,
        scopeType: row.scope_type,
        scopeId: row.scope_id || "",
        workflowId: row.workflow_id || "",
        requestedBy: row.requested_by || "",
        reason: redactText(row.reason || ""),
        riskTier: row.risk_tier || "",
        status: row.status,
        dryRun: Boolean(Number(row.dry_run || 0)),
        idempotencyKey: row.idempotency_key || "",
        humanGateId: row.human_gate_id || "",
        inputHash: row.input_hash || "",
        previewResult: redactConsoleValue(parseJson(row.preview_result_json, {})),
        result: redactConsoleValue(parseJson(row.result_json, {})),
        error: redactText(row.error || ""),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at || ""
      })),
      deliveryExecutions: workflowOperations
        .filter((row) => row.action === "telegram.outbox.delivery")
        .map((row) => {
          const result = redactConsoleValue(parseJson(row.result_json, {}));
          return {
            operationId: row.operation_id,
            workflowId: row.workflow_id || "",
            status: row.status,
            requestedBy: row.requested_by || "",
            reason: redactText(row.reason || ""),
            dryRun: Boolean(Number(row.dry_run || 0)),
            idempotencyKey: row.idempotency_key || "",
            outboxId: result?.outboxId || result?.result?.outboxId || "",
            deliveryStatus: result?.deliveryStatus || result?.result?.status || "",
            idempotentReplay: Boolean(result?.idempotentReplay),
            didSendTelegram: Boolean(result?.didSendTelegram),
            didUpdateOutbox: Boolean(result?.didUpdateOutbox),
            didUpdateMessageFlow: Boolean(result?.didUpdateMessageFlow),
            receiptCount: toInt(result?.receiptCount),
            receiptPolicy: result?.receiptPolicy || {},
            error: redactText(row.error || ""),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            completedAt: row.completed_at || ""
          };
        }),
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
          payload: redactConsoleValue(payload),
          result: redactConsoleValue(result),
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
    if (!(await tableExists(this.paths.dbFile, "readiness_snapshots"))) return null;
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
      planes: redactConsoleValue(parseJson(row.planes_json, {})),
      findings: redactConsoleValue(parseJson(row.findings_json, [])),
      payload: redactConsoleValue(parseJson(row.payload_json, {}))
    };
  }
}
