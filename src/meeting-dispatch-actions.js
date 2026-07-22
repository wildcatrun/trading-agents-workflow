import path from "node:path";
import {
  parseJsonValue,
  safeId
} from "./workflow/json.js";
import {
  isSqliteConstraintError,
  sqlValue,
  sqlite,
  tableColumns
} from "./workflow/sqlite.js";
import {
  fileExistsSync,
  workflowPaths
} from "./workflow/paths.js";

export const MEETING_DISPATCH_ACTION_HANDLER_NAMES = {
  "dispatch.package.callsites.preview": "dispatchPackageCallsitesPreview",
  "dispatch.package.parity.preview": "dispatchPackageParityPreview",
  "dispatch.package.schema.preview": "dispatchPackageSchemaPreview",
  "dispatch.package.topology.preview": "dispatchPackageTopologyPreview",
  "dispatch.package.preview": "dispatchPackagePreview",
  "dispatch.package.create": "dispatchPackageCreate",
  "meeting.dispatch": "meetingDispatch"
};

const DISPATCH_PACKAGE_CANONICAL_INPUT_SCHEMA = Object.freeze([
  { field: "meetingId", aliases: ["meeting_id"], required: true, compatibilityColumn: "meeting_id", payloadPath: "meetingId" },
  { field: "workflowId", aliases: ["workflow_id"], required: false, defaultFrom: "meetingId", compatibilityColumn: "workflow_id", payloadPath: "workflowId" },
  { field: "traceId", aliases: ["trace_id"], required: false, defaultFrom: "safeId('trace')", compatibilityColumn: "trace_id", payloadPath: "traceId" },
  { field: "idempotencyKey", aliases: ["idempotency_key"], required: false, compatibilityColumn: "idempotency_key", payloadPath: "idempotencyKey" },
  { field: "dispatchId", aliases: ["dispatch_id"], required: false, defaultFrom: "safeId('dispatch')", compatibilityColumn: "dispatch_id", payloadPath: "dispatchId" },
  { field: "runtime", aliases: [], required: false, defaultFrom: "runtime_agents target resolution", compatibilityColumn: "runtime", payloadPath: "runtime" },
  { field: "agentId", aliases: ["agent_id", "target"], required: false, defaultFrom: "main", compatibilityColumn: "agent_id", payloadPath: "agentId" },
  { field: "dispatchType", aliases: ["dispatch_type"], required: false, defaultFrom: "discussion_turn", compatibilityColumn: "dispatch_type", payloadPath: "dispatchType" },
  { field: "priority", aliases: [], required: false, defaultFrom: "normal", compatibilityColumn: "priority", payloadPath: "" },
  { field: "status", aliases: [], required: false, defaultFrom: "queued", compatibilityColumn: "status", payloadPath: "" },
  { field: "maxAttempts", aliases: ["max_attempts"], required: false, defaultFrom: "1 bounded to 1..10", compatibilityColumn: "max_attempts", payloadPath: "maxAttempts" },
  { field: "prompt", aliases: ["text"], required: false, compatibilityColumn: "prompt", payloadPath: "prompt" },
  { field: "phase", aliases: [], required: false, compatibilityColumn: "", payloadPath: "phase" },
  { field: "chair", aliases: ["createdBy", "created_by"], required: false, defaultFrom: "main", compatibilityColumn: "created_by", payloadPath: "chair" },
  { field: "payload", aliases: [], required: false, defaultFrom: "{}", compatibilityColumn: "payload_json.payload", payloadPath: "payload" },
  { field: "sourceChannel", aliases: ["source_channel"], required: false, compatibilityColumn: "message_flows.source_channel", payloadPath: "message_flow.source.channel" },
  { field: "sourceMessageId", aliases: ["source_message_id"], required: false, compatibilityColumn: "message_flows.source_message_id", payloadPath: "message_flow.source.messageId" },
  { field: "returnPolicy", aliases: ["return_policy"], required: false, compatibilityColumn: "message_flows.return_policy", payloadPath: "message_flow.returnPolicy" }
]);

const DISPATCH_PACKAGE_CANONICAL_OUTPUT_SCHEMA = Object.freeze([
  { field: "operation", source: "dispatch.package.create wrapper", compatibility: "not stored in mixed_meeting_dispatches", availability: "create_and_deduped" },
  { field: "compatibilityOperation", source: "dispatch.package.create wrapper", compatibility: "meeting.dispatch", availability: "create_and_deduped" },
  { field: "meetingId", source: "input", compatibilityColumn: "meeting_id", availability: "create_and_deduped" },
  { field: "workflowId", source: "input/default", compatibilityColumn: "workflow_id", availability: "create_only_currently_omitted_on_deduped" },
  { field: "traceId", source: "input/default", compatibilityColumn: "trace_id", availability: "create_and_deduped" },
  { field: "idempotencyKey", source: "input", compatibilityColumn: "idempotency_key", availability: "create_and_deduped" },
  { field: "dispatchId", source: "input/default/existing idempotency row", compatibilityColumn: "dispatch_id", availability: "create_and_deduped" },
  { field: "runtime", source: "runtime_agents.platform", compatibilityColumn: "runtime", availability: "create_and_deduped" },
  { field: "platform", source: "runtime_agents.platform", compatibilityColumn: "runtime_agents.platform", availability: "create_only_currently_omitted_on_deduped" },
  { field: "workflowIngressAdapter", source: "runtime_agents.workflow_ingress_adapter", compatibilityColumn: "runtime_agents.workflow_ingress_adapter", availability: "create_only_currently_omitted_on_deduped" },
  { field: "agentId", source: "normalized target", compatibilityColumn: "agent_id", availability: "create_and_deduped" },
  { field: "status", source: "dispatch row", compatibilityColumn: "status", availability: "create_and_deduped" },
  { field: "messageFlowId", source: "createDispatchMessageFlow", compatibilityColumn: "message_flows.flow_id", availability: "create_only_currently_omitted_on_deduped" },
  { field: "returnPolicy", source: "createDispatchMessageFlow", compatibilityColumn: "message_flows.return_policy", availability: "create_only_currently_omitted_on_deduped" },
  { field: "relativePath", source: "writeJsonArtifact", compatibility: "dispatches/<status>/<dispatchId>.json", availability: "create_only_currently_omitted_on_deduped" },
  { field: "deduped", source: "idempotency lookup", compatibility: "existing mixed_meeting_dispatches row", availability: "deduped_only" }
]);

const DISPATCH_PACKAGE_PERSISTENCE_MAPPING = Object.freeze([
  { target: "mixed_meeting_dispatches", role: "compatibility dispatch ledger", writeAction: "meeting.dispatch", keyFields: ["dispatch_id", "idempotency_key"] },
  { target: "dispatches/<status>/<dispatchId>.json", role: "dispatch package artifact", writeAction: "meeting.dispatch", keyFields: ["dispatchId"] },
  { target: "message_flows", role: "governed delivery/evidence flow", writeAction: "createDispatchMessageFlow", keyFields: ["flow_id", "dispatch_id"] },
  { target: "workflow_events", role: "dispatch.created / dispatch.rejected evidence", writeAction: "appendWorkflowEvent", keyFields: ["event_id", "dispatch_id"] },
  { target: "runtime_agents", role: "target ownership and adapter registry", writeAction: "ensureRuntimeAgent preserveExisting=true", keyFields: ["agent_key", "runtime", "agent_id"] }
]);

const DISPATCH_PACKAGE_LIFECYCLE_MAPPING = Object.freeze([
  { state: "queued", producer: "dispatch.package.create / meeting.dispatch", consumer: "runtime.bridge.drain", terminal: false },
  { state: "sent", producer: "runtime.bridge.drain", consumer: "runtime receipt / stale dispatch reconcile", terminal: false },
  { state: "acked", producer: "runtime receipt / bridge drain", consumer: "readiness/read model", terminal: true },
  { state: "failed", producer: "runtime.bridge.drain / stale dispatch reconcile / retry exhaustion", consumer: "incident/requeue/operator recovery", terminal: true },
  { state: "cancelled", producer: "operator intervention or compatibility cleanup", consumer: "readiness/read model", terminal: true }
]);

const DISPATCH_PACKAGE_PARITY_MATRIX = Object.freeze([
  {
    parityKey: "idempotency",
    requirement: "dispatch.package.create must deduplicate through the same idempotency_key ledger as meeting.dispatch",
    canonicalSurface: "dispatch.package.create",
    compatibilitySurface: "meeting.dispatch",
    evidenceSources: ["mixed_meeting_dispatches.idempotency_key", "idx_mixed_dispatches_idempotency"],
    status: "delegated_parity"
  },
  {
    parityKey: "runtime_target_validation",
    requirement: "target resolution must use runtime_agents and fail closed when the target runtime/agent is unresolved",
    canonicalSurface: "dispatch.package.preview/create",
    compatibilitySurface: "resolveRegisteredDispatchTarget + meeting.dispatch",
    evidenceSources: ["runtime_agents", "dispatch.package.preview blockers"],
    status: "delegated_parity"
  },
  {
    parityKey: "message_flow_event_creation",
    requirement: "eligible dispatch package creation must create governed message_flow linkage before append dispatch.created",
    canonicalSurface: "dispatch.package.create",
    compatibilitySurface: "meeting.dispatch + createDispatchMessageFlow",
    evidenceSources: ["message_flows.dispatch_id", "workflow_events event_type='dispatch.created'"],
    status: "delegated_parity"
  },
  {
    parityKey: "receipt_recording",
    requirement: "runtime receipts and terminal states must remain visible through the existing runtime bridge and read models",
    canonicalSurface: "dispatch.package.create rows consumed by runtime.bridge.drain",
    compatibilitySurface: "mixed_meeting_dispatches + workflow.runtime_event.record",
    evidenceSources: ["mixed_meeting_dispatches sent/acked/failed/cancelled", "runtime_semantic_events.dispatch_id"],
    status: "shared_substrate"
  },
  {
    parityKey: "invalid_runtime_fail_closed",
    requirement: "retired openclaw_route_shell dispatch must be rejected and recorded as dispatch.rejected without creating a route-shell dispatch row",
    canonicalSurface: "dispatch.package.preview/create",
    compatibilitySurface: "meeting.dispatch route_shell_retired guard",
    evidenceSources: ["workflow_events event_type='dispatch.rejected'", "mixed_meeting_dispatches runtime!='openclaw_route_shell'"],
    status: "delegated_parity"
  },
  {
    parityKey: "retry_and_terminal_failure",
    requirement: "dispatch creation retry and terminal runtime failure handling must remain owned by control-loop and dispatch reconcile substrate",
    canonicalSurface: "dispatch.package.create callers",
    compatibilitySurface: "meeting_dispatch_retry + runtime_drain + workflow.dispatch.reconcile",
    evidenceSources: ["control_loop_jobs meeting_dispatch_retry/runtime_drain", "mixed_meeting_dispatches failed/cancelled/max-attempts"],
    status: "shared_substrate"
  }
]);

const DISPATCH_PACKAGE_CALL_SITE_INVENTORY = Object.freeze([
  {
    callSiteId: "canonical-dispatch-package-create",
    surface: "dispatch.package.create",
    module: "src/meeting-dispatch-actions.js",
    currentDependency: "meetingDispatch",
    migrationDisposition: "canonical_surface_keep",
    replacement: "none",
    reason: "canonical meeting-neutral surface already exists but delegates to the compatibility writer during cutover",
    freezeBlocker: false
  },
  {
    callSiteId: "public-meeting-dispatch-action",
    surface: "meeting.dispatch",
    module: "src/meeting-dispatch-actions.js + index.js",
    currentDependency: "meetingDispatch",
    migrationDisposition: "compatibility_shell_keep_until_observation_window",
    replacement: "dispatch.package.create",
    reason: "public compatibility action must remain until audited callers migrate",
    freezeBlocker: true
  },
  {
    callSiteId: "approved-schedule-dispatch",
    surface: "workflow.schedule.upsert / workflow.control_loop.tick scheduled_dispatch",
    module: "src/schedule-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "approved schedule dispatch jobs now call the canonical bridge while retaining existing control-loop job and dispatch ledger behavior",
    freezeBlocker: false
  },
  {
    callSiteId: "message-flow-send-dispatch",
    surface: "workflow.message_flow.send",
    module: "src/message-flow-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "governed message_flow sender now calls the canonical package bridge while preserving message_flow ingress, linkage, ack, and delivery semantics",
    freezeBlocker: false
  },
  {
    callSiteId: "message-flow-semantic-continuation",
    surface: "workflow.message_flow semantic continuation",
    module: "src/message-flow-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "semantic continuation dispatch creation now calls the canonical bridge while preserving ack recovery, idempotency, receipt, and message_flow event semantics",
    freezeBlocker: false
  },
  {
    callSiteId: "v2-supervisor-package-dispatch",
    surface: "workflow.v2.supervisor.next_actions package/report dispatch",
    module: "src/workflow-v2/supervisor-next-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "v2 supervisor report and closeout writers now call the canonical bridge while preserving the compatibility ledger",
    freezeBlocker: false
  },
  {
    callSiteId: "meeting-disperse-compat",
    surface: "meeting.disperse",
    module: "src/meeting-control-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create or explicit archived meeting fan-out decision",
    reason: "meeting-era fan-out remains a compatibility action, but its dispatch creation now uses the canonical bridge without rebranding it as v2 kernel work",
    freezeBlocker: false
  },
  {
    callSiteId: "workflow-advance-legacy",
    surface: "workflow.advance",
    module: "src/workflow-advance-actions.js",
    currentDependency: "meetingDispatch",
    migrationDisposition: "legacy_default_disabled_do_not_migrate",
    replacement: "approved templates + supervisor readiness + dispatch.package.create for new callers",
    reason: "default-disabled legacy executor should not be migrated into new infrastructure just to preserve old semantics",
    freezeBlocker: false
  },
  {
    callSiteId: "workflow-supervise-legacy",
    surface: "workflow.supervise",
    module: "src/workflow-supervisor-actions.js",
    currentDependency: "meetingDispatch",
    migrationDisposition: "legacy_default_disabled_do_not_migrate",
    replacement: "workflow.supervisor.* read/report surfaces + dispatch.package.create for new report dispatch",
    reason: "default-disabled legacy supervisor should not drive new dispatch architecture",
    freezeBlocker: false
  },
  {
    callSiteId: "human-gate-evidence-revision",
    surface: "Human Gate evidence revision dispatch",
    module: "src/workflow.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "Human Gate policy-audit revision dispatch now calls the canonical bridge while retaining the existing audit event and dispatch ledger",
    freezeBlocker: false
  },
  {
    callSiteId: "human-gate-feedback-pre-order-risk-audit",
    surface: "Human Gate feedback callback pre-order risk audit dispatch",
    module: "src/human-gate-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "Human Gate feedback retry wrapper now calls the canonical bridge while preserving exact decision evidence, idempotency, and retry semantics",
    freezeBlocker: false
  },
  {
    callSiteId: "human-gate-feedback-resume-dispatch",
    surface: "Human Gate feedback callback resume dispatch",
    module: "src/human-gate-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "Human Gate feedback retry wrapper now resumes main through the canonical bridge from the selected button boundary",
    freezeBlocker: false
  },
  {
    callSiteId: "human-gate-archive-main-closeout",
    surface: "Human Gate archive closeout dispatch to main",
    module: "src/human-gate-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "Human Gate archive closeout retry wrapper now asks main through the canonical bridge while preserving resumability evidence",
    freezeBlocker: false
  },
  {
    callSiteId: "human-gate-archive-cat-claw-report",
    surface: "Human Gate archive closeout report dispatch to cat_claw",
    module: "src/human-gate-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create",
    reason: "Human Gate archive closeout retry wrapper now asks cat_claw through the canonical bridge while retaining user-visible closeout evidence",
    freezeBlocker: false
  },
  {
    callSiteId: "meeting-dispatch-retry-job",
    surface: "meeting_dispatch_retry control-loop job",
    module: "src/control-loop-tick-actions.js",
    currentDependency: "dispatchPackageCreate",
    migrationDisposition: "retargeted_to_dispatch_package_create",
    replacement: "dispatch.package.create retry payload",
    reason: "retry job now follows the canonical bridge used by safe Human Gate dispatches while preserving the existing retry payload",
    freezeBlocker: false
  }
]);

const DISPATCH_PACKAGE_TOPOLOGY_PRODUCERS = Object.freeze([
  {
    surface: "dispatch.package.create",
    module: "src/meeting-dispatch-actions.js",
    dependency: "meetingDispatch",
    role: "canonical meeting-neutral dispatch package writer",
    migrationClass: "canonical_bridge"
  },
  {
    surface: "meeting.dispatch",
    module: "src/meeting-dispatch-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "compatibility writer for generic runtime dispatch rows",
    migrationClass: "compatibility_writer"
  },
  {
    surface: "workflow.schedule.upsert / workflow.control_loop.tick",
    module: "src/schedule-actions.js + src/control-loop-tick-actions.js",
    dependency: "dispatchPackageCreate",
    role: "approved schedule due-run dispatch creation through canonical bridge",
    migrationClass: "retargeted_scheduler_producer"
  },
  {
    surface: "workflow.message_flow.send",
    module: "src/message-flow-actions.js",
    dependency: "dispatchPackageCreate",
    role: "governed message-flow task handoff dispatch creation",
    migrationClass: "retargeted_message_flow_producer"
  },
  {
    surface: "workflow.message_flow semantic continuation",
    module: "src/message-flow-actions.js",
    dependency: "dispatchPackageCreate",
    role: "semantic continuation dispatch after runtime ack evidence",
    migrationClass: "retargeted_message_flow_semantic_producer"
  },
  {
    surface: "meeting_dispatch_retry control-loop job",
    module: "src/control-loop-tick-actions.js",
    dependency: "dispatchPackageCreate",
    role: "retry execution for failed dispatch creation attempts",
    migrationClass: "retargeted_retry_producer"
  },
  {
    surface: "Human Gate evidence revision dispatch",
    module: "src/workflow.js",
    dependency: "dispatchPackageCreate",
    role: "cat_claw audit failure repair dispatch to main through canonical bridge",
    migrationClass: "retargeted_human_gate_policy_producer"
  },
  {
    surface: "Human Gate feedback/archive safe dispatch",
    module: "src/human-gate-actions.js + src/workflow.js",
    dependency: "dispatchPackageCreate",
    role: "Human Gate feedback, pre-order risk audit, and archive closeout dispatches through canonical bridge with retry wrapper",
    migrationClass: "retargeted_human_gate_callback_producer"
  },
  {
    surface: "meeting.disperse",
    module: "src/meeting-control-actions.js",
    dependency: "dispatchPackageCreate",
    role: "meeting conclusion fan-out compatibility dispatch creation",
    migrationClass: "retargeted_meeting_compatibility_producer"
  },
  {
    surface: "workflow.advance",
    module: "src/workflow-advance-actions.js",
    dependency: "meetingDispatch",
    role: "default-disabled legacy workflow task dispatch compatibility path",
    migrationClass: "legacy_compatibility_producer"
  },
  {
    surface: "workflow.supervise",
    module: "src/workflow-supervisor-actions.js",
    dependency: "meetingDispatch",
    role: "default-disabled legacy supervisor report compatibility path",
    migrationClass: "legacy_compatibility_producer"
  },
  {
    surface: "workflow.supervisor.next_actions",
    module: "src/workflow-v2/supervisor-next-actions.js",
    dependency: "dispatchPackageCreate",
    role: "v2 supervisor report / Human Gate package dispatch creation through canonical bridge",
    migrationClass: "retargeted_v2_supervisor_producer"
  },
  {
    surface: "intervention readiness / verification fixtures",
    module: "src/intervention-actions.js + src/verification-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "read-only dispatch evidence used for safety/readiness decisions",
    migrationClass: "evidence_reader"
  }
]);

const DISPATCH_PACKAGE_TOPOLOGY_CONSUMERS = Object.freeze([
  {
    surface: "runtime.bridge.drain",
    module: "src/runtime-bridge-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "runtime adapter drain for queued/sent/failed dispatch rows",
    migrationClass: "shared_runtime_consumer"
  },
  {
    surface: "workflow.control_loop.tick runtime_drain",
    module: "src/control-loop-tick-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "bounded seeding and execution of dispatch drains",
    migrationClass: "shared_maintenance_consumer"
  },
  {
    surface: "workflow.dispatch.reconcile",
    module: "src/dispatch-reconcile-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "mechanical stale dispatch reconcile and terminal failure evidence",
    migrationClass: "shared_maintenance_consumer"
  },
  {
    surface: "human_gate.resume",
    module: "src/human-gate-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "marks Human Gate related dispatch rows after approval/resume",
    migrationClass: "shared_human_gate_consumer"
  },
  {
    surface: "workflow.status / workflow.health",
    module: "src/status-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "operator status and readiness counts",
    migrationClass: "read_model_consumer"
  },
  {
    surface: "Console read model",
    module: "src/console/read-model.js",
    dependency: "mixed_meeting_dispatches",
    role: "operator search, Kanban, timeline, operations, and readiness views",
    migrationClass: "read_model_consumer"
  },
  {
    surface: "workflow.v2.intervention_readiness.preview",
    module: "src/workflow-v2/intervention-readiness-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "v2 safety readiness counts for dispatch pressure",
    migrationClass: "v2_readiness_consumer"
  },
  {
    surface: "workflow.v2.supervisor.next_actions.preview",
    module: "src/workflow-v2/supervisor-next-actions.js",
    dependency: "mixed_meeting_dispatches",
    role: "v2 dispatch evidence and recovery guidance",
    migrationClass: "v2_readiness_consumer"
  }
]);

const DISPATCH_PACKAGE_COMPATIBILITY_MAPPING = Object.freeze({
  canonicalCreateAction: "dispatch.package.create",
  canonicalPreviewAction: "dispatch.package.preview",
  canonicalSchemaAction: "dispatch.package.schema.preview",
  canonicalTopologyAction: "dispatch.package.topology.preview",
  compatibilityCreateAction: "meeting.dispatch",
  compatibilityTable: "mixed_meeting_dispatches",
  compatibilityArtifactRoot: "dispatches/",
  canonicalBridgeStatus: "delegates_to_meeting_dispatch_until_call_site_migration_completes",
  freezeEligibility: "not_freeze_eligible_until_call_site_migration_and_observation_window"
});

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`meeting dispatch action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`meeting dispatch action dependency missing: ${name}`);
  return context[name];
}

async function tableExists(dbFile, tableName) {
  const rows = await sqlite(dbFile, `SELECT name FROM sqlite_master WHERE type='table' AND name=${sqlValue(tableName)} LIMIT 1;`, { json: true });
  return Boolean(rows[0]);
}

export function createMeetingDispatchActionRegistry(handlers = {}) {
  const entries = Object.entries(MEETING_DISPATCH_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing meeting dispatch action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runMeetingDispatchAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createMeetingDispatchActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const createDispatchMessageFlow = requireContextFunction(context, "createDispatchMessageFlow");
  const ensureRuntimeAgent = requireContextFunction(context, "ensureRuntimeAgent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeMeetingRef = requireContextFunction(context, "normalizeMeetingRef");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const nowIso = requireContextFunction(context, "nowIso");
  const resolveRegisteredDispatchTarget = requireContextFunction(context, "resolveRegisteredDispatchTarget");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const DISPATCH_STATUSES = requireContextValue(context, "DISPATCH_STATUSES");

  async function dispatchPackageCallsitesPreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    const includeOperations = String(input.includeOperations ?? input.include_operations ?? "true") !== "false";
    const callSites = DISPATCH_PACKAGE_CALL_SITE_INVENTORY.map((callSite) => ({ ...callSite }));
    const dispositionCounts = Object.fromEntries([...new Set(callSites.map((site) => site.migrationDisposition))].map((disposition) => [
      disposition,
      callSites.filter((site) => site.migrationDisposition === disposition).length
    ]));
    let operationEvidence = {
      tablePresent: false,
      schemaDegraded: false,
      evidenceReadable: false,
      missingColumns: [],
      workflowId,
      actionCounts: {},
      legacyMeetingDispatchCalls: 0,
      canonicalDispatchPackageCreateCalls: 0,
      latestOperations: []
    };
    if (includeOperations && fileExistsSync(paths.dbFile) && await tableExists(paths.dbFile, "workflow_operations")) {
      const columns = await tableColumns(paths.dbFile, "workflow_operations");
      const expectedColumns = ["operation_id", "action", "workflow_id", "status", "dry_run", "requested_by", "created_at", "updated_at", "completed_at"];
      const missingColumns = expectedColumns.filter((column) => !columns.has(column));
      operationEvidence = {
        ...operationEvidence,
        tablePresent: true,
        schemaDegraded: missingColumns.length > 0,
        evidenceReadable: columns.has("action"),
        missingColumns
      };
      if (columns.has("action")) {
        const workflowClause = workflowId && columns.has("workflow_id") ? `AND workflow_id=${sqlValue(workflowId)}` : "";
        const statusExpr = columns.has("status") ? "status" : "'unknown'";
        const latestUpdatedAtExpr = columns.has("updated_at") ? "MAX(updated_at)" : "''";
        const latestOrder = columns.has("updated_at")
          ? "updated_at DESC"
          : (columns.has("created_at") ? "created_at DESC" : "action ASC");
        const selectColumn = (column, fallback, alias = column) => `${columns.has(column) ? column : fallback} AS ${alias}`;
        try {
          const actionRows = await sqlite(paths.dbFile, `
SELECT action, ${statusExpr} AS status, COUNT(*) AS count, ${latestUpdatedAtExpr} AS latest_updated_at
FROM workflow_operations
WHERE action IN ('meeting.dispatch','dispatch.package.create','workflow.dispatch.package.create')
  ${workflowClause}
GROUP BY action, status
ORDER BY action, status;`, { json: true });
          const latestRows = await sqlite(paths.dbFile, `
SELECT ${selectColumn("operation_id", "''")}, action, ${selectColumn("workflow_id", "''")}, ${selectColumn("status", "'unknown'")}, ${selectColumn("dry_run", "0")}, ${selectColumn("requested_by", "''")}, ${selectColumn("created_at", "''")}, ${selectColumn("updated_at", "''")}, ${selectColumn("completed_at", "''")}
FROM workflow_operations
WHERE action IN ('meeting.dispatch','dispatch.package.create','workflow.dispatch.package.create')
  ${workflowClause}
ORDER BY ${latestOrder}
LIMIT 20;`, { json: true });
          const actionCounts = {};
          for (const row of actionRows) {
            const action = String(row.action || "unknown");
            const status = String(row.status || "unknown");
            actionCounts[action] = actionCounts[action] || {};
            actionCounts[action][status] = Number(row.count || 0);
          }
          operationEvidence = {
            ...operationEvidence,
            actionCounts,
            legacyMeetingDispatchCalls: actionRows.filter((row) => row.action === "meeting.dispatch").reduce((sum, row) => sum + Number(row.count || 0), 0),
            canonicalDispatchPackageCreateCalls: actionRows.filter((row) => row.action === "dispatch.package.create" || row.action === "workflow.dispatch.package.create").reduce((sum, row) => sum + Number(row.count || 0), 0),
            latestOperations: latestRows.map((row) => ({
              operationId: row.operation_id || "",
              action: row.action || "",
              workflowId: row.workflow_id || "",
              status: row.status || "",
              dryRun: Boolean(Number(row.dry_run || 0)),
              requestedBy: row.requested_by ? "[redacted]" : "",
              createdAt: row.created_at || "",
              updatedAt: row.updated_at || "",
              completedAt: row.completed_at || ""
            }))
          };
        } catch (error) {
          operationEvidence = {
            ...operationEvidence,
            evidenceReadable: false,
            queryError: error instanceof Error ? error.message : String(error)
          };
        }
      }
    }
    const freezeBlockingCallSites = callSites.filter((site) => site.freezeBlocker);
    const frozenLegacyExceptions = callSites.filter((site) => site.migrationDisposition === "legacy_default_disabled_do_not_migrate");
    const retargetedCallSites = callSites.filter((site) => site.migrationDisposition === "retargeted_to_dispatch_package_create");
    const freezeBlockers = [];
    if (freezeBlockingCallSites.length) freezeBlockers.push("call_sites_not_migrated");
    if (operationEvidence.legacyMeetingDispatchCalls > 0) freezeBlockers.push("legacy_meeting_dispatch_operations_observed");
    freezeBlockers.push("observation_window_missing");
    freezeBlockers.push("dispatch.package.create_still_delegates_to_meeting.dispatch");
    return {
      operation: "dispatch.package.callsites.preview",
      generatedAt: nowIso(),
      dryRun: true,
      dbFile: paths.dbFile,
      callSites,
      summary: {
        totalCallSites: callSites.length,
        freezeBlockingCallSites: freezeBlockingCallSites.length,
        freezeBlockingCallSiteIds: freezeBlockingCallSites.map((site) => site.callSiteId),
        retargetedCallSites: retargetedCallSites.length,
        frozenLegacyExceptions: frozenLegacyExceptions.length,
        frozenLegacyExceptionIds: frozenLegacyExceptions.map((site) => site.callSiteId),
        dispositionCounts
      },
      operationEvidence,
      migrationReadiness: {
        freezeCandidate: false,
        status: "not_ready",
        blockers: [...new Set(freezeBlockers)],
        nextRequiredEvidence: [
          "complete observation window for public meeting.dispatch compatibility shell",
          "record workflow_operations evidence for canonical caller usage",
          "verify only default-disabled legacy exceptions remain outside dispatch.package.create",
          "run release-smoke observation after call-site migration",
          "freeze meeting-era names only as compatibility shells before removal"
        ]
      }
    };
  }

  async function dispatchPackageParityPreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    const workflowDispatchClause = workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : "";
    const workflowEventClause = workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : "";
    const workflowRuntimeEventClause = workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : "";
    const live = {
      workflowId,
      tablePresent: false,
      totalDispatches: 0,
      idempotentDispatches: 0,
      duplicateIdempotencyKeys: 0,
      messageFlowLinkedDispatches: 0,
      dispatchCreatedEvents: 0,
      dispatchRejectedEvents: 0,
      routeShellDispatchRows: 0,
      runtimeReceiptEvents: 0,
      runtimeAgentsForDispatches: 0,
      runtimeDrainJobs: 0,
      meetingDispatchRetryJobs: 0,
      terminalAttentionDispatches: 0
    };
    if (fileExistsSync(paths.dbFile) && await tableExists(paths.dbFile, "mixed_meeting_dispatches")) {
      const hasMessageFlows = await tableExists(paths.dbFile, "message_flows");
      const hasWorkflowEvents = await tableExists(paths.dbFile, "workflow_events");
      const hasRuntimeEvents = await tableExists(paths.dbFile, "runtime_semantic_events");
      const hasRuntimeAgents = await tableExists(paths.dbFile, "runtime_agents");
      const hasControlLoopJobs = await tableExists(paths.dbFile, "control_loop_jobs");
      const totalRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE 1=1 ${workflowDispatchClause};`, { json: true });
      const idempotentRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE idempotency_key IS NOT NULL AND idempotency_key != ''
  ${workflowDispatchClause};`, { json: true });
      const duplicateRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM (
  SELECT idempotency_key
  FROM mixed_meeting_dispatches
  WHERE idempotency_key IS NOT NULL AND idempotency_key != ''
    ${workflowDispatchClause}
  GROUP BY idempotency_key
  HAVING COUNT(*) > 1
);`, { json: true });
      const linkedRows = hasMessageFlows ? await sqlite(paths.dbFile, `
SELECT COUNT(DISTINCT d.dispatch_id) AS count
FROM mixed_meeting_dispatches d
JOIN message_flows mf ON mf.dispatch_id=d.dispatch_id
WHERE 1=1 ${workflowId ? `AND d.workflow_id=${sqlValue(workflowId)}` : ""};`, { json: true }) : [{ count: 0 }];
      const createdRows = hasWorkflowEvents ? await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_events e
JOIN mixed_meeting_dispatches d ON d.dispatch_id=e.dispatch_id
WHERE e.event_type='dispatch.created'
  ${workflowId ? `AND d.workflow_id=${sqlValue(workflowId)}` : ""};`, { json: true }) : [{ count: 0 }];
      const rejectedRows = hasWorkflowEvents ? await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM workflow_events
WHERE event_type='dispatch.rejected'
  AND next_state='route_shell_retired'
  ${workflowEventClause}
  AND (
    payload_json LIKE '%openclaw_route_shell%'
    OR payload_json LIKE '%route_shell_retired%'
  );`, { json: true }) : [{ count: 0 }];
      const routeShellRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE runtime='openclaw_route_shell'
  ${workflowDispatchClause};`, { json: true });
      const runtimeEventRows = hasRuntimeEvents ? await sqlite(paths.dbFile, `
SELECT COUNT(DISTINCT re.dispatch_id) AS count
FROM runtime_semantic_events re
JOIN mixed_meeting_dispatches d ON d.dispatch_id=re.dispatch_id
WHERE re.dispatch_id IS NOT NULL AND re.dispatch_id != ''
  AND re.status IN ('acked','completed','failed','blocked','interrupted')
  ${workflowId ? `AND d.workflow_id=${sqlValue(workflowId)}` : ""};`, { json: true }) : [{ count: 0 }];
      const runtimeAgentRows = hasRuntimeAgents ? await sqlite(paths.dbFile, `
SELECT COUNT(DISTINCT d.dispatch_id) AS count
FROM mixed_meeting_dispatches d
JOIN runtime_agents ra ON ra.runtime=d.runtime AND ra.agent_id=d.agent_id
WHERE 1=1
  ${workflowId ? `AND d.workflow_id=${sqlValue(workflowId)}` : ""};`, { json: true }) : [{ count: 0 }];
      const runtimeDrainRows = hasControlLoopJobs ? await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM control_loop_jobs
WHERE job_type='runtime_drain'
  ${workflowDispatchClause};`, { json: true }) : [{ count: 0 }];
      const retryRows = hasControlLoopJobs ? await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM control_loop_jobs
WHERE job_type='meeting_dispatch_retry'
  ${workflowDispatchClause};`, { json: true }) : [{ count: 0 }];
      const terminalRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE (status IN ('failed','cancelled') OR (attempt >= max_attempts AND max_attempts > 0 AND status != 'acked'))
  ${workflowDispatchClause};`, { json: true });
      Object.assign(live, {
        tablePresent: true,
        totalDispatches: Number(totalRows[0]?.count || 0),
        idempotentDispatches: Number(idempotentRows[0]?.count || 0),
        duplicateIdempotencyKeys: Number(duplicateRows[0]?.count || 0),
        messageFlowLinkedDispatches: Number(linkedRows[0]?.count || 0),
        dispatchCreatedEvents: Number(createdRows[0]?.count || 0),
        dispatchRejectedEvents: Number(rejectedRows[0]?.count || 0),
        routeShellDispatchRows: Number(routeShellRows[0]?.count || 0),
        runtimeReceiptEvents: Number(runtimeEventRows[0]?.count || 0),
        runtimeAgentsForDispatches: Number(runtimeAgentRows[0]?.count || 0),
        runtimeDrainJobs: Number(runtimeDrainRows[0]?.count || 0),
        meetingDispatchRetryJobs: Number(retryRows[0]?.count || 0),
        terminalAttentionDispatches: Number(terminalRows[0]?.count || 0)
      });
    }
    const parityChecks = DISPATCH_PACKAGE_PARITY_MATRIX.map((check) => {
      let observed = false;
      let blocker = "";
      if (check.parityKey === "idempotency") {
        observed = live.idempotentDispatches > 0 && live.duplicateIdempotencyKeys === 0;
        blocker = live.duplicateIdempotencyKeys > 0 ? "duplicate_idempotency_keys_observed" : "idempotency_observation_missing";
      } else if (check.parityKey === "runtime_target_validation") {
        observed = live.runtimeAgentsForDispatches > 0;
        blocker = "runtime_target_validation_observation_missing";
      } else if (check.parityKey === "message_flow_event_creation") {
        observed = live.messageFlowLinkedDispatches > 0 && live.dispatchCreatedEvents > 0;
        blocker = "message_flow_dispatch_created_observation_missing";
      } else if (check.parityKey === "receipt_recording") {
        observed = live.runtimeReceiptEvents > 0 || live.runtimeDrainJobs > 0;
        blocker = "receipt_or_runtime_drain_observation_missing";
      } else if (check.parityKey === "invalid_runtime_fail_closed") {
        observed = live.routeShellDispatchRows === 0 && live.dispatchRejectedEvents > 0;
        blocker = live.routeShellDispatchRows > 0 ? "route_shell_dispatch_rows_observed" : "route_shell_rejection_observation_missing";
      } else if (check.parityKey === "retry_and_terminal_failure") {
        observed = live.meetingDispatchRetryJobs > 0 || live.runtimeDrainJobs > 0 || live.terminalAttentionDispatches > 0;
        blocker = "retry_or_terminal_failure_observation_missing";
      }
      return {
        ...check,
        observed,
        blocker: observed ? "" : blocker
      };
    });
    const blockers = parityChecks.filter((check) => !check.observed).map((check) => check.blocker).filter(Boolean);
    if (!live.tablePresent) blockers.unshift("workflow_layout_missing");
    blockers.push("dispatch.package.create_delegates_to_meeting.dispatch");
    blockers.push("public_meeting.dispatch_compatibility_shell_registered");
    return {
      operation: "dispatch.package.parity.preview",
      generatedAt: nowIso(),
      dryRun: true,
      dbFile: paths.dbFile,
      compatibility: { ...DISPATCH_PACKAGE_COMPATIBILITY_MAPPING },
      parityChecks,
      live,
      migrationReadiness: {
        freezeCandidate: false,
        status: "not_ready",
        blockers: [...new Set(blockers)],
        nextRequiredEvidence: [
          "run parity matrix with scoped release-smoke evidence",
          "complete observation window for public meeting.dispatch compatibility shell",
          "prove runtime bridge parity for active runtimes",
          "prove message_flow linkage parity remains stable after call-site migration",
          "verify only default-disabled legacy exceptions remain outside dispatch.package.create"
        ]
      }
    };
  }

  async function dispatchPackageSchemaPreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    return {
      operation: "dispatch.package.schema.preview",
      generatedAt: nowIso(),
      dryRun: true,
      dbFile: paths.dbFile,
      canonical: {
        packageName: "dispatch.package",
        previewAction: "dispatch.package.preview",
        createAction: "dispatch.package.create",
        topologyAction: "dispatch.package.topology.preview",
        inputFields: DISPATCH_PACKAGE_CANONICAL_INPUT_SCHEMA.map((field) => ({ ...field, aliases: [...(field.aliases || [])] })),
        outputFields: DISPATCH_PACKAGE_CANONICAL_OUTPUT_SCHEMA.map((field) => ({ ...field }))
      },
      compatibility: {
        ...DISPATCH_PACKAGE_COMPATIBILITY_MAPPING,
        lifecycleStates: [...DISPATCH_STATUSES]
      },
      persistenceMapping: DISPATCH_PACKAGE_PERSISTENCE_MAPPING.map((mapping) => ({ ...mapping, keyFields: [...mapping.keyFields] })),
      lifecycleMapping: DISPATCH_PACKAGE_LIFECYCLE_MAPPING.map((mapping) => ({ ...mapping })),
      validationRules: [
        "target must resolve through runtime_agents unless route-shell is explicitly rejected",
        "openclaw_route_shell dispatch is fail-closed",
        "idempotency_key deduplicates against mixed_meeting_dispatches before inserting",
        "message_flow validation runs before dispatch row insertion",
        "maxAttempts is bounded to 1..10 for new dispatch package creation",
        "preview and schema actions must not initialize workflow layout or write rows"
      ],
      migrationReadiness: {
        freezeCandidate: false,
        status: "not_ready",
        blockers: [
          "dispatch.package.create_delegates_to_meeting.dispatch",
          "mixed_meeting_dispatches_is_still_runtime_bridge_ledger",
          "producer_call_sites_not_migrated",
          "runtime_bridge_parity_observation_missing",
          "message_flow_parity_observation_missing"
        ],
        nextRequiredEvidence: [
          "call_site_migration_inventory",
          "idempotency_parity_test_matrix",
          "runtime_target_validation_parity_test_matrix",
          "message_flow_event_creation_parity_test_matrix",
          "receipt_recording_parity_test_matrix",
          "retry_and_terminal_failure_parity_test_matrix"
        ]
      }
    };
  }

  async function dispatchPackageTopologyPreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const generatedAt = nowIso();
    const workflowId = String(input.workflowId || input.workflow_id || "").trim();
    const workflowClause = workflowId ? `WHERE workflow_id=${sqlValue(workflowId)}` : "";
    const andWorkflowClause = workflowId ? `AND workflow_id=${sqlValue(workflowId)}` : "";
    let live = {
      tablePresent: false,
      totalDispatches: 0,
      statusCounts: {},
      runtimeCounts: {},
      dispatchTypeCounts: {},
      messageFlowLinkedDispatches: 0,
      controlLoopRuntimeDrainJobs: 0,
      terminalAttentionDispatches: 0,
      workflowId
    };
    if (fileExistsSync(paths.dbFile) && await tableExists(paths.dbFile, "mixed_meeting_dispatches")) {
      const hasMessageFlows = await tableExists(paths.dbFile, "message_flows");
      const hasControlLoopJobs = await tableExists(paths.dbFile, "control_loop_jobs");
      const totalRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
${workflowClause};`, { json: true });
      const statusRows = await sqlite(paths.dbFile, `
SELECT status, COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE 1=1
  ${andWorkflowClause}
GROUP BY status
ORDER BY status;`, { json: true });
      const runtimeRows = await sqlite(paths.dbFile, `
SELECT runtime, COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE 1=1
  ${andWorkflowClause}
GROUP BY runtime
ORDER BY runtime;`, { json: true });
      const dispatchTypeRows = await sqlite(paths.dbFile, `
SELECT dispatch_type, COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE 1=1
  ${andWorkflowClause}
GROUP BY dispatch_type
ORDER BY dispatch_type;`, { json: true });
      const linkedRows = hasMessageFlows ? await sqlite(paths.dbFile, `
SELECT COUNT(DISTINCT d.dispatch_id) AS count
FROM mixed_meeting_dispatches d
JOIN message_flows mf ON mf.dispatch_id=d.dispatch_id
WHERE 1=1
  ${workflowId ? `AND d.workflow_id=${sqlValue(workflowId)}` : ""};`, { json: true }) : [{ count: 0 }];
      const runtimeDrainRows = hasControlLoopJobs ? await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM control_loop_jobs
WHERE job_type='runtime_drain'
  ${andWorkflowClause};`, { json: true }) : [{ count: 0 }];
      const terminalRows = await sqlite(paths.dbFile, `
SELECT COUNT(*) AS count
FROM mixed_meeting_dispatches
WHERE (status IN ('failed','cancelled') OR (attempt >= max_attempts AND max_attempts > 0 AND status != 'acked'))
  ${andWorkflowClause};`, { json: true });
      live = {
        tablePresent: true,
        totalDispatches: Number(totalRows[0]?.count || 0),
        statusCounts: Object.fromEntries(statusRows.map((row) => [String(row.status || "unknown"), Number(row.count || 0)])),
        runtimeCounts: Object.fromEntries(runtimeRows.map((row) => [String(row.runtime || "unknown"), Number(row.count || 0)])),
        dispatchTypeCounts: Object.fromEntries(dispatchTypeRows.map((row) => [String(row.dispatch_type || "unknown"), Number(row.count || 0)])),
        messageFlowLinkedDispatches: Number(linkedRows[0]?.count || 0),
        controlLoopRuntimeDrainJobs: Number(runtimeDrainRows[0]?.count || 0),
        terminalAttentionDispatches: Number(terminalRows[0]?.count || 0),
        workflowId
      };
    }
    const producers = DISPATCH_PACKAGE_TOPOLOGY_PRODUCERS.map((producer) => ({ ...producer }));
    const consumers = DISPATCH_PACKAGE_TOPOLOGY_CONSUMERS.map((consumer) => ({ ...consumer }));
    const legacyProducers = producers.filter((producer) => producer.migrationClass === "legacy_compatibility_producer");
    const meetingCompatibilityProducers = producers.filter((producer) => producer.migrationClass === "meeting_compatibility_producer" || producer.migrationClass === "compatibility_writer");
    const blockers = [];
    if (!live.tablePresent) blockers.push("workflow_layout_missing");
    if (legacyProducers.length) blockers.push("legacy_compatibility_producers_registered");
    if (meetingCompatibilityProducers.length) blockers.push("meeting_era_producers_registered");
    if (live.terminalAttentionDispatches > 0) blockers.push("terminal_dispatch_attention_required");
    return {
      operation: "dispatch.package.topology.preview",
      generatedAt,
      dryRun: true,
      dbFile: paths.dbFile,
      producers,
      consumers,
      compatibility: { ...DISPATCH_PACKAGE_COMPATIBILITY_MAPPING },
      live,
      migrationReadiness: {
        freezeCandidate: false,
        status: blockers.length ? "not_ready" : "observation_required",
        blockers,
        nextRequiredEvidence: [
          "complete observation window for public meeting.dispatch compatibility shell",
          "runtime_bridge_parity_for_all_active_runtimes",
          "message_flow_linkage_parity",
          "release_smoke_observation_window",
          "verify_default_disabled_legacy_exceptions_only"
        ]
      }
    };
  }

  async function dispatchPackagePreview(rootDir, input = {}) {
    const paths = workflowPaths(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || "main");
    const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
    const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
    const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
    const requestedRuntime = String(input.runtime || "").trim();
    const runtime = requestedRuntime ? normalizeRuntime(requestedRuntime) : "";
    const dispatchId = input.dispatchId || input.dispatch_id || safeId("dispatch");
    const dispatchType = input.dispatchType || input.dispatch_type || "discussion_turn";
    const status = DISPATCH_STATUSES.has(String(input.status || "queued")) ? String(input.status || "queued") : "queued";
    const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || input.max_attempts || 1)));
    const createdAt = nowIso();
    const originalPayload = parseJsonValue(input.payload, input.payload || {});
    if (!fileExistsSync(paths.dbFile)) {
      return {
        operation: "dispatch.package.preview",
        canonicalCreateAction: "dispatch.package.create",
        compatibilityCreateAction: "meeting.dispatch",
        eligible: false,
        blockers: ["workflow_layout_missing"],
        meetingId,
        workflowId,
        traceId,
        runtime,
        agentId,
        status: "failed",
        failureType: "workflow_layout_missing",
        error: "workflow state database does not exist; preview is read-only and will not initialize layout",
        dryRun: true,
        dbFile: paths.dbFile
      };
    }
    if (runtime === "openclaw_route_shell") {
      return {
        operation: "dispatch.package.preview",
        canonicalCreateAction: "dispatch.package.create",
        compatibilityCreateAction: "meeting.dispatch",
        eligible: false,
        blockers: ["route_shell_retired"],
        meetingId,
        workflowId,
        traceId,
        runtime,
        agentId,
        status: "failed",
        failureType: "route_shell_retired",
        error: "openclaw_route_shell dispatch is retired; use runtime_agents plus message_flow or the target runtime adapter",
        dryRun: true,
        dbFile: paths.dbFile
      };
    }
    let resolvedTarget = null;
    try {
      resolvedTarget = runtime
        ? await resolveRegisteredDispatchTarget(paths, { ...input, runtime, agentId })
        : await resolveRegisteredDispatchTarget(paths, { ...input, agentId });
    } catch (error) {
      return {
        operation: "dispatch.package.preview",
        canonicalCreateAction: "dispatch.package.create",
        compatibilityCreateAction: "meeting.dispatch",
        eligible: false,
        blockers: ["runtime_target_unresolved"],
        meetingId,
        workflowId,
        traceId,
        runtime,
        agentId,
        status: "failed",
        failureType: "runtime_target_unresolved",
        error: error instanceof Error ? error.message : String(error),
        dryRun: true,
        dbFile: paths.dbFile
      };
    }
    const targetRegistry = resolvedTarget.registry;
    const dispatchRuntime = targetRegistry.platform || runtime;
    let existing = null;
    if (idempotencyKey) {
      const rows = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
      existing = rows[0] || null;
    }
    let messageFlow = null;
    try {
      messageFlow = await createDispatchMessageFlow(paths, input, {
        validateOnly: true,
        targetRegistry,
        meetingId,
        workflowId,
        traceId,
        idempotencyKey,
        dispatchId,
        dispatchRuntime,
        agentId,
        dispatchType,
        createdBy: input.chair || input.createdBy || input.created_by || "main",
        createdAt
      });
    } catch (error) {
      return {
        operation: "dispatch.package.preview",
        canonicalCreateAction: "dispatch.package.create",
        compatibilityCreateAction: "meeting.dispatch",
        eligible: false,
        blockers: ["message_flow_validation_failed"],
        meetingId,
        workflowId,
        traceId,
        idempotencyKey,
        dispatchId,
        runtime: dispatchRuntime,
        platform: targetRegistry.platform,
        workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
        agentId,
        dispatchType,
        status,
        failureType: "message_flow_validation_failed",
        error: error instanceof Error ? error.message : String(error),
        dryRun: true,
        dbFile: paths.dbFile
      };
    }
    return {
      operation: "dispatch.package.preview",
      canonicalCreateAction: "dispatch.package.create",
      compatibilityCreateAction: "meeting.dispatch",
      eligible: true,
      blockers: [],
      wouldCreate: !existing,
      wouldDeduplicate: Boolean(existing),
      existingDispatchId: existing?.dispatch_id || "",
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId: existing?.dispatch_id || dispatchId,
      runtime: existing?.runtime || dispatchRuntime,
      platform: targetRegistry.platform,
      workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
      imIdentity: targetRegistry.imIdentity,
      executionIdentity: targetRegistry.executionIdentity,
      agentId,
      dispatchType,
      status: existing?.status || status,
      priority: input.priority || "normal",
      maxAttempts,
      messageFlowPreview: messageFlow ? { flowId: messageFlow.flowId, returnPolicy: messageFlow.returnPolicy } : null,
      artifactPreview: {
        relativePath: path.relative(paths.root, path.join(paths.dispatchesDir, status, `${dispatchId}.json`)),
        payload: {
          meetingId,
          workflowId,
          traceId,
          idempotencyKey,
          dispatchId,
          runtime: dispatchRuntime,
          agentId,
          dispatchType,
          prompt: input.prompt || input.text || "",
          phase: input.phase || "",
          chair: input.chair || input.createdBy || input.created_by || "main",
          attempt: 0,
          maxAttempts,
          payload: originalPayload
        }
      },
      dryRun: true,
      dbFile: paths.dbFile
    };
  }

  async function meetingDispatch(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const meetingId = normalizeMeetingRef(input.meetingId || input.meeting_id);
    const agentId = normalizeAgentId(input.agentId || input.agent_id || input.target || "main");
    const workflowId = String(input.workflowId || input.workflow_id || meetingId).trim();
    const traceId = String(input.traceId || input.trace_id || safeId("trace")).trim();
    const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
    const requestedRuntime = String(input.runtime || "").trim();
    const runtime = requestedRuntime ? normalizeRuntime(requestedRuntime) : "";
    if (runtime === "openclaw_route_shell") {
      const createdAt = nowIso();
      const error = "openclaw_route_shell dispatch is retired; use runtime_agents plus message_flow or the target runtime adapter";
      await appendWorkflowEvent(paths, {
        eventType: "dispatch.rejected",
        status: "failed",
        workflowId,
        traceId,
        actor: input.createdBy || input.created_by || input.chair || "workflow",
        sourceRuntime: "workflow",
        sourceAgent: input.createdBy || input.created_by || input.chair || "",
        nextState: "route_shell_retired",
        payload: {
          runtime,
          agentId,
          dispatchType: input.dispatchType || input.dispatch_type || "",
          reason: error,
          originalPayload: parseJsonValue(input.payload, input.payload || {})
        },
        createdAt
      });
      return {
        meetingId,
        workflowId,
        traceId,
        runtime,
        agentId,
        status: "failed",
        failureType: "route_shell_retired",
        error,
        dbFile: paths.dbFile
      };
    }
    const resolvedTarget = runtime
      ? await resolveRegisteredDispatchTarget(paths, { ...input, runtime, agentId })
      : await resolveRegisteredDispatchTarget(paths, { ...input, agentId });
    const targetRegistry = resolvedTarget.registry;
    const dispatchRuntime = targetRegistry.platform || runtime;
    const agent = await ensureRuntimeAgent(paths, {
      runtime: dispatchRuntime,
      platform: targetRegistry.platform,
      agentId,
      displayName: input.displayName || input.display_name || "",
      executionAdapter: targetRegistry.executionAdapter,
      imIngressOwner: targetRegistry.imIngressOwner,
      imIngressAdapter: targetRegistry.imIngressAdapter,
      workflowIngressAdapter: targetRegistry.workflowIngressAdapter,
      endpointRef: targetRegistry.endpointRef,
      preserveExisting: true
    });
    if (idempotencyKey) {
      const existing = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
      if (existing[0]) {
        return {
          meetingId,
          dispatchId: existing[0].dispatch_id,
          runtime: existing[0].runtime,
          agentId: existing[0].agent_id,
          status: existing[0].status,
          traceId: existing[0].trace_id,
          idempotencyKey,
          deduped: true,
          dbFile: paths.dbFile
        };
      }
    }
    const dispatchId = input.dispatchId || input.dispatch_id || safeId("dispatch");
    const status = DISPATCH_STATUSES.has(String(input.status || "queued")) ? String(input.status || "queued") : "queued";
    const createdAt = nowIso();
    const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || input.max_attempts || 1)));
    const payload = {
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId,
      runtime: dispatchRuntime,
      agentId,
      dispatchType: input.dispatchType || input.dispatch_type || "discussion_turn",
      prompt: input.prompt || input.text || "",
      phase: input.phase || "",
      chair: input.chair || input.createdBy || input.created_by || "main",
      attempt: 0,
      maxAttempts,
      payload: parseJsonValue(input.payload, input.payload || {})
    };
    await createDispatchMessageFlow(paths, input, {
      validateOnly: true,
      targetRegistry,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId,
      dispatchRuntime,
      agentId,
      dispatchType: payload.dispatchType,
      createdBy: payload.chair,
      createdAt
    });
    try {
      await sqlite(paths.dbFile, `
INSERT INTO mixed_meeting_dispatches(dispatch_id, meeting_id, workflow_id, trace_id, idempotency_key, runtime, agent_id, agent_key, dispatch_type, status, priority, attempt, max_attempts, prompt, payload_json, created_by, created_at, updated_at)
VALUES (${sqlValue(dispatchId)}, ${sqlValue(meetingId)}, ${sqlValue(workflowId)}, ${sqlValue(traceId)}, ${sqlValue(idempotencyKey)}, ${sqlValue(dispatchRuntime)}, ${sqlValue(agentId)}, ${sqlValue(agent.agentKey)}, ${sqlValue(payload.dispatchType)}, ${sqlValue(status)}, ${sqlValue(input.priority || "normal")}, 0, ${sqlValue(maxAttempts)}, ${sqlValue(payload.prompt)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(payload.chair)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
    } catch (error) {
      if (idempotencyKey && isSqliteConstraintError(error)) {
        const existing = await sqlite(paths.dbFile, `SELECT * FROM mixed_meeting_dispatches WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
        if (existing[0]) {
          return {
            meetingId,
            dispatchId: existing[0].dispatch_id,
            runtime: existing[0].runtime,
            agentId: existing[0].agent_id,
            status: existing[0].status,
            traceId: existing[0].trace_id,
            idempotencyKey,
            deduped: true,
            dbFile: paths.dbFile
          };
        }
      }
      throw error;
    }
    const messageFlow = await createDispatchMessageFlow(paths, input, {
      targetRegistry,
      meetingId,
      workflowId,
      traceId,
      idempotencyKey,
      dispatchId,
      dispatchRuntime,
      agentId,
      dispatchType: payload.dispatchType,
      createdBy: payload.chair,
      createdAt
    });
    const relPath = await writeJsonArtifact(paths.root, path.join(paths.dispatchesDir, status), dispatchId, payload);
    await appendWorkflowEvent(paths, {
      eventType: "dispatch.created",
      status,
      workflowId,
      traceId,
      dispatchId,
      actor: payload.chair,
      sourceRuntime: "workflow",
      sourceAgent: payload.chair,
      nextState: status,
      idempotencyKey: idempotencyKey ? `workflow_event:dispatch.created:${idempotencyKey}` : "",
      artifactRef: relPath,
      payload: {
        meetingId,
        runtime: dispatchRuntime,
        agentId,
        dispatchType: payload.dispatchType,
        priority: input.priority || "normal",
        messageFlowId: messageFlow?.flowId || ""
      },
      createdAt
    });
    return { meetingId, workflowId, traceId, idempotencyKey, dispatchId, runtime: dispatchRuntime, platform: targetRegistry.platform, workflowIngressAdapter: targetRegistry.workflowIngressAdapter, imIdentity: targetRegistry.imIdentity, executionIdentity: targetRegistry.executionIdentity, agentId, status, messageFlowId: messageFlow?.flowId || "", returnPolicy: messageFlow?.returnPolicy || "", relativePath: relPath, dbFile: paths.dbFile };
  }

  async function dispatchPackageCreate(rootDir, input = {}) {
    const result = await meetingDispatch(rootDir, input);
    return {
      ...result,
      operation: "dispatch.package.create",
      compatibilityOperation: "meeting.dispatch"
    };
  }

  return {
    dispatchPackageCallsitesPreview,
    dispatchPackageParityPreview,
    dispatchPackageSchemaPreview,
    dispatchPackageTopologyPreview,
    dispatchPackagePreview,
    dispatchPackageCreate,
    meetingDispatch
  };
}
