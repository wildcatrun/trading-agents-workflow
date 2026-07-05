import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const TOPOLOGY_ACTION_HANDLER_NAMES = {
  "workflow.topology": "workflowTopology",
  "trading_workflow.topology": "workflowTopology",
  "workflow.runtime_agents": "workflowRuntimeAgents",
  "workflow.runtime-agents": "workflowRuntimeAgents",
  "workflow.runtime.registry": "workflowRuntimeAgents"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`topology action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`topology action dependency missing: ${name}`);
  return context[name];
}

export function createTopologyActionRegistry(handlers = {}) {
  const entries = Object.entries(TOPOLOGY_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing topology action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runTopologyAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createTopologyActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const jsonHash = requireContextFunction(context, "jsonHash");
  const loadHermersProfileModes = requireContextFunction(context, "loadHermersProfileModes");
  const nowIso = requireContextFunction(context, "nowIso");
  const profileModeEvidenceForRow = requireContextFunction(context, "profileModeEvidenceForRow");
  const registrySnapshot = requireContextFunction(context, "registrySnapshot");
  const workflowPaths = requireContextFunction(context, "workflowPaths");
  const writeJsonAtomic = requireContextFunction(context, "writeJsonAtomic");
  const RETIRED_RUNTIME_AGENT_STATUSES = requireContextValue(context, "RETIRED_RUNTIME_AGENT_STATUSES");
  const WORKFLOW_SCHEMA_VERSION = requireContextValue(context, "WORKFLOW_SCHEMA_VERSION");

  async function workflowTopology(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const registeredAgents = await sqlite(paths.dbFile, `
SELECT agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, endpoint_ref, updated_at
FROM runtime_agents
WHERE status NOT IN (${Array.from(RETIRED_RUNTIME_AGENT_STATUSES).map(sqlValue).join(", ")})
ORDER BY platform, agent_id;`, { json: true });
    const hermersModes = await loadHermersProfileModes(input);
    const activeAgentIds = [
      ...new Set(
        registeredAgents
          .filter((row) => row.status === "active")
          .map((row) => String(row.agent_id || "").trim())
          .filter(Boolean)
      )
    ];
    const runtimeRegistry = registeredAgents.reduce((acc, row) => {
      const snap = registrySnapshot(row);
      if (!acc[snap.platform]) acc[snap.platform] = [];
      const profileModeEvidence = snap.platform === "hermers" ? profileModeEvidenceForRow(row, hermersModes) : {};
      acc[snap.platform].push({
        agentKey: row.agent_key,
        runtime: row.runtime,
        agentId: row.agent_id,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        platform: snap.platform,
        executionAdapter: snap.executionAdapter,
        imIngressOwner: snap.imIngressOwner,
        imIngressAdapter: snap.imIngressAdapter,
        workflowIngressAdapter: snap.workflowIngressAdapter,
        imIdentity: snap.imIdentity,
        executionIdentity: snap.executionIdentity,
        returnPolicy: snap.returnPolicy,
        canReceiveDispatch: snap.canReceiveDispatch,
        canStartWorkflow: snap.canStartWorkflow,
        gatewayProxyAllowed: snap.gatewayProxyAllowed,
        endpointRef: row.endpoint_ref,
        updatedAt: row.updated_at,
        ...profileModeEvidence
      });
      return acc;
    }, {});
    return {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
      root: paths.root,
      runtimeRegistry,
      topology: {
        serverA: {
          role: "execution_and_simulation_plane",
          services: ["trading_sim", "trading_core"],
          stores: ["exchange_api_keys", "accounts", "positions", "orders", "execution_risk"],
          boundary: "Server A is the only side allowed to hold broker/exchange credentials and live position/order state."
        },
        serverB: {
          role: "openclaw_hermers_workflow_plane",
          services: ["openclaw", "hermers_agents", "trading-agents-workflow"],
          agents: activeAgentIds,
          stores: ["meetings", "research", "protocol_objects", "human_gate", "audit"],
          boundary: "Server B produces reviewed intents only; it must not store exchange API keys or live account state."
        },
        localCodex: {
          role: "flashcat_primary_conversation_panel",
          advancedOperationAuth: "mTLS client certificate required for executable trade intents."
        }
      },
      allowedPath: "research_signal/evidence_pack/research_memo -> trade_proposal -> cat_claw_evidence_audit -> human_gate_record -> cat_tail_pre_order_risk_audit -> risk_decision -> executable_trade_intent -> trading_core_receipt",
      blockedPath: "Telegram/IM/plaintext commands cannot create ready_for_trading_core intents."
    };
  }

  async function workflowRuntimeAgents(rootDir, input = {}) {
    const topology = await workflowTopology(rootDir, input);
    const runtimes = Object.entries(topology.runtimeRegistry || {}).map(([platform, agents]) => ({
      platform,
      active: agents.filter((agent) => agent.status === "active").length,
      total: agents.length
    }));
    const generatedAt = nowIso();
    const records = Object.values(topology.runtimeRegistry || {}).flat();
    const activeOpenClawAgents = records
      .filter((agent) => agent.status === "active" && agent.runtime === "openclaw" && agent.platform === "openclaw")
      .map((agent) => agent.agentId)
      .filter(Boolean)
      .sort();
    const snapshot = {
      schemaVersion: 1,
      workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
      generatedAt,
      generatedAtEpoch: Math.floor(new Date(generatedAt).getTime() / 1000),
      source: {
        root: topology.root,
        dbFile: workflowPaths(rootDir, input).dbFile,
        table: "runtime_agents",
        authority: "trading-agents-workflow.runtime_agents"
      },
      runtimeRegistry: topology.runtimeRegistry,
      records,
      derivedScopes: {
        activeOpenClawAgentIds: activeOpenClawAgents
      },
      runtimes,
      count: runtimes.reduce((sum, item) => sum + item.total, 0),
      checksum: ""
    };
    snapshot.checksum = jsonHash({ ...snapshot, checksum: "" });
    const paths = workflowPaths(rootDir, input);
    const snapshotFile = path.join(paths.registryDir, "runtime-agents.snapshot.json");
    await writeJsonAtomic(snapshotFile, snapshot);
    return {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      workflowSchemaVersion: WORKFLOW_SCHEMA_VERSION,
      root: topology.root,
      runtimeRegistry: topology.runtimeRegistry,
      snapshotFile,
      snapshotGeneratedAt: generatedAt,
      derivedScopes: snapshot.derivedScopes,
      runtimes,
      count: runtimes.reduce((sum, item) => sum + item.total, 0)
    };
  }

  return {
    workflowRuntimeAgents,
    workflowTopology
  };
}
