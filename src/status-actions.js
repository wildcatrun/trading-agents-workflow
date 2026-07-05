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
  const readInstrument = requireContextFunction(context, "readInstrument");
  const workflowHealthSnapshot = requireContextFunction(context, "workflowHealthSnapshot");
  const workflowReadinessSnapshot = requireContextFunction(context, "workflowReadinessSnapshot");
  const WORKFLOW_SCHEMA_VERSION = requireContextValue(context, "WORKFLOW_SCHEMA_VERSION");

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
    workflowInit,
    workflowReadiness,
    workflowStatus
  };
}
