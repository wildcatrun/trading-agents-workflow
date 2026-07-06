import {
  firstText,
  parseJsonValue
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const RUNTIME_AGENT_ACTION_HANDLER_NAMES = {
  "runtime.agent": "runtimeAgentUpsert",
  "runtime.agent.upsert": "runtimeAgentUpsert"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`runtime agent action dependency missing: ${name}`);
  return value;
}

function boolInt(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback ? 1 : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(text)) return 0;
  if (["1", "true", "yes", "on"].includes(text)) return 1;
  return fallback ? 1 : 0;
}

export function createRuntimeAgentActionRegistry(handlers = {}) {
  const entries = Object.entries(RUNTIME_AGENT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing runtime agent action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runRuntimeAgentAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createRuntimeAgentActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeAgentPlatform = requireContextFunction(context, "normalizeAgentPlatform");
  const normalizeExecutionAdapter = requireContextFunction(context, "normalizeExecutionAdapter");
  const normalizeExecutionIdentity = requireContextFunction(context, "normalizeExecutionIdentity");
  const normalizeImIdentity = requireContextFunction(context, "normalizeImIdentity");
  const normalizeImIngressAdapter = requireContextFunction(context, "normalizeImIngressAdapter");
  const normalizeImIngressOwner = requireContextFunction(context, "normalizeImIngressOwner");
  const normalizeReturnPolicy = requireContextFunction(context, "normalizeReturnPolicy");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const normalizeWorkflowIngressAdapter = requireContextFunction(context, "normalizeWorkflowIngressAdapter");
  const nowIso = requireContextFunction(context, "nowIso");
  const registrySnapshot = requireContextFunction(context, "registrySnapshot");
  const workflowRuntimeAgents = requireContextFunction(context, "workflowRuntimeAgents");

  function runtimeAgentKey(runtime, agentId) {
    return `${normalizeRuntime(runtime)}:${normalizeAgentId(agentId)}`;
  }

  function assertRuntimeAgentRegistrationAllowed(runtime, agentId, registry = {}) {
    const normalizedRuntime = normalizeRuntime(runtime);
    const normalizedAgentId = normalizeAgentId(agentId);
    if (normalizedAgentId !== "cat_claw") return;
    const normalizedPlatform = normalizeAgentPlatform(registry.platform, normalizedRuntime);
    const executionAdapter = normalizeExecutionAdapter(registry.executionAdapter, normalizedPlatform, normalizedRuntime);
    const workflowIngressAdapter = normalizeWorkflowIngressAdapter(registry.workflowIngressAdapter, normalizedPlatform, normalizedRuntime);
    const imIngressOwner = normalizeImIngressOwner(registry.imIngressOwner, normalizedPlatform, normalizedRuntime);
    const imIngressAdapter = normalizeImIngressAdapter(registry.imIngressAdapter, imIngressOwner, normalizedRuntime);
    const imIdentity = normalizeImIdentity(registry.imIdentity, imIngressOwner, imIngressAdapter, normalizedRuntime);
    const executionIdentity = normalizeExecutionIdentity(registry.executionIdentity, normalizedPlatform, workflowIngressAdapter, normalizedRuntime);
    if (
      normalizedRuntime !== "openclaw" ||
      normalizedPlatform !== "openclaw" ||
      executionAdapter !== "native" ||
      workflowIngressAdapter !== "openclaw_native" ||
      imIngressOwner !== "openclaw_gateway" ||
      imIngressAdapter !== "openclaw_native" ||
      imIdentity !== "openclaw_native" ||
      executionIdentity !== "openclaw_native"
    ) {
      throw new Error("cat_claw is an OpenClaw-only secretary agent; register and dispatch it as openclaw:cat_claw with openclaw_native adapters");
    }
  }

  async function ensureRuntimeAgent(paths, input) {
    const runtime = normalizeRuntime(input.runtime || input.runtimeKey || input.runtime_key || input.platform);
    const agentId = normalizeAgentId(input.agentId || input.agent_id);
    const agentKey = runtimeAgentKey(runtime, agentId);
    const createdAt = nowIso();
    const displayName = String(input.displayName || input.display_name || "").trim();
    const role = String(input.role || "").trim();
    const endpointRef = String(input.endpointRef || input.endpoint_ref || "").trim();
    const platformInput = input.platform || input.runtimePlatform || input.runtime_platform;
    const executionAdapterInput = input.executionAdapter || input.execution_adapter;
    const imIngressOwnerInput = input.imIngressOwner || input.im_ingress_owner;
    const imIngressAdapterInput = input.imIngressAdapter || input.im_ingress_adapter;
    const workflowIngressAdapterInput = input.workflowIngressAdapter || input.workflow_ingress_adapter;
    const platform = normalizeAgentPlatform(platformInput, runtime);
    const executionAdapter = normalizeExecutionAdapter(executionAdapterInput, platform, runtime);
    const imIngressOwner = normalizeImIngressOwner(imIngressOwnerInput, platform, runtime);
    const imIngressAdapter = normalizeImIngressAdapter(imIngressAdapterInput, imIngressOwner, runtime);
    const workflowIngressAdapter = normalizeWorkflowIngressAdapter(workflowIngressAdapterInput, platform, runtime);
    const imIdentityInput = input.imIdentity || input.im_identity;
    const executionIdentityInput = input.executionIdentity || input.execution_identity;
    const returnPolicyInput = input.returnPolicy || input.return_policy;
    const imIdentity = normalizeImIdentity(imIdentityInput, imIngressOwner, imIngressAdapter, runtime);
    const executionIdentity = normalizeExecutionIdentity(executionIdentityInput, platform, workflowIngressAdapter, runtime);
    const returnPolicy = normalizeReturnPolicy(returnPolicyInput, executionIdentity === "hermers_acp" && imIdentity === "openclaw_route_shell" ? "reply_to_source_chat" : "silent");
    const imIdentityExplicit = firstText(imIdentityInput) ? 1 : 0;
    const executionIdentityExplicit = firstText(executionIdentityInput) ? 1 : 0;
    const returnPolicyExplicit = firstText(returnPolicyInput) ? 1 : 0;
    const platformExplicit = firstText(platformInput) ? 1 : 0;
    const executionAdapterExplicit = firstText(executionAdapterInput) ? 1 : 0;
    const imIngressOwnerExplicit = firstText(imIngressOwnerInput) ? 1 : 0;
    const imIngressAdapterExplicit = firstText(imIngressAdapterInput) ? 1 : 0;
    const workflowIngressAdapterExplicit = firstText(workflowIngressAdapterInput) ? 1 : 0;
    const canReceiveDispatch = boolInt(input.canReceiveDispatch ?? input.can_receive_dispatch, workflowIngressAdapter !== "none");
    const canStartWorkflow = boolInt(input.canStartWorkflow ?? input.can_start_workflow, true);
    const gatewayProxyAllowed = boolInt(input.gatewayProxyAllowed ?? input.gateway_proxy_allowed, imIngressOwner === "openclaw_gateway");
    const routingPolicy = parseJsonValue(input.routingPolicy || input.routing_policy, input.routingPolicy || input.routing_policy || {});
    const capabilitiesJson = JSON.stringify(parseJsonValue(input.capabilities, input.capabilities || {}));
    const metadataJson = JSON.stringify(parseJsonValue(input.metadata, input.metadata || {}));
    const preserveExisting = Boolean(input.preserveExisting || input.preserve_existing);
    assertRuntimeAgentRegistrationAllowed(runtime, agentId, {
      platform,
      executionAdapter,
      workflowIngressAdapter,
      imIngressOwner,
      imIngressAdapter,
      imIdentity,
      executionIdentity
    });
    const conflictUpdate = preserveExisting ? `
  display_name=CASE WHEN ${sqlValue(displayName)} != '' THEN excluded.display_name ELSE runtime_agents.display_name END,
  role=CASE WHEN ${sqlValue(role)} != '' THEN excluded.role ELSE runtime_agents.role END,
  status=excluded.status,
  platform=CASE WHEN ${sqlValue(platformExplicit)}=1 OR runtime_agents.platform='' THEN excluded.platform ELSE runtime_agents.platform END,
  execution_adapter=CASE WHEN ${sqlValue(executionAdapterExplicit)}=1 OR runtime_agents.execution_adapter='' THEN excluded.execution_adapter ELSE runtime_agents.execution_adapter END,
  im_ingress_owner=CASE WHEN ${sqlValue(imIngressOwnerExplicit)}=1 OR runtime_agents.im_ingress_owner='' THEN excluded.im_ingress_owner ELSE runtime_agents.im_ingress_owner END,
  im_ingress_adapter=CASE WHEN ${sqlValue(imIngressAdapterExplicit)}=1 OR runtime_agents.im_ingress_adapter='' THEN excluded.im_ingress_adapter ELSE runtime_agents.im_ingress_adapter END,
  workflow_ingress_adapter=CASE WHEN ${sqlValue(workflowIngressAdapterExplicit)}=1 OR runtime_agents.workflow_ingress_adapter='' THEN excluded.workflow_ingress_adapter ELSE runtime_agents.workflow_ingress_adapter END,
  im_identity=CASE WHEN ${sqlValue(imIdentityExplicit)}=1 OR runtime_agents.im_identity='' THEN excluded.im_identity ELSE runtime_agents.im_identity END,
  execution_identity=CASE WHEN ${sqlValue(executionIdentityExplicit)}=1 OR runtime_agents.execution_identity='' THEN excluded.execution_identity ELSE runtime_agents.execution_identity END,
  return_policy=CASE WHEN ${sqlValue(returnPolicyExplicit)}=1 OR runtime_agents.return_policy='' THEN excluded.return_policy ELSE runtime_agents.return_policy END,
  can_receive_dispatch=excluded.can_receive_dispatch,
  can_start_workflow=excluded.can_start_workflow,
  gateway_proxy_allowed=excluded.gateway_proxy_allowed,
  routing_policy_json=CASE WHEN ${sqlValue(JSON.stringify(routingPolicy))} != '{}' THEN excluded.routing_policy_json ELSE runtime_agents.routing_policy_json END,
  endpoint_ref=CASE WHEN ${sqlValue(endpointRef)} != '' THEN excluded.endpoint_ref ELSE runtime_agents.endpoint_ref END,
  capabilities_json=CASE WHEN ${sqlValue(capabilitiesJson)} != '{}' THEN excluded.capabilities_json ELSE runtime_agents.capabilities_json END,
  metadata_json=CASE WHEN ${sqlValue(metadataJson)} != '{}' THEN excluded.metadata_json ELSE runtime_agents.metadata_json END,
  updated_at=excluded.updated_at;` : `
  display_name=excluded.display_name,
  role=excluded.role,
  status=excluded.status,
  platform=excluded.platform,
  execution_adapter=excluded.execution_adapter,
  im_ingress_owner=excluded.im_ingress_owner,
  im_ingress_adapter=excluded.im_ingress_adapter,
  workflow_ingress_adapter=excluded.workflow_ingress_adapter,
  im_identity=excluded.im_identity,
  execution_identity=excluded.execution_identity,
  return_policy=excluded.return_policy,
  can_receive_dispatch=excluded.can_receive_dispatch,
  can_start_workflow=excluded.can_start_workflow,
  gateway_proxy_allowed=excluded.gateway_proxy_allowed,
  routing_policy_json=excluded.routing_policy_json,
  endpoint_ref=excluded.endpoint_ref,
  capabilities_json=excluded.capabilities_json,
  metadata_json=excluded.metadata_json,
  updated_at=excluded.updated_at;`;
    await sqlite(paths.dbFile, `
INSERT INTO runtime_agents(agent_key, runtime, agent_id, display_name, role, status, platform, execution_adapter, im_ingress_owner, im_ingress_adapter, workflow_ingress_adapter, im_identity, execution_identity, return_policy, can_receive_dispatch, can_start_workflow, gateway_proxy_allowed, routing_policy_json, endpoint_ref, capabilities_json, metadata_json, created_at, updated_at)
VALUES (${sqlValue(agentKey)}, ${sqlValue(runtime)}, ${sqlValue(agentId)}, ${sqlValue(displayName || agentId)}, ${sqlValue(role)}, ${sqlValue(input.status || "active")}, ${sqlValue(platform)}, ${sqlValue(executionAdapter)}, ${sqlValue(imIngressOwner)}, ${sqlValue(imIngressAdapter)}, ${sqlValue(workflowIngressAdapter)}, ${sqlValue(imIdentity)}, ${sqlValue(executionIdentity)}, ${sqlValue(returnPolicy)}, ${sqlValue(canReceiveDispatch)}, ${sqlValue(canStartWorkflow)}, ${sqlValue(gatewayProxyAllowed)}, ${sqlValue(JSON.stringify(routingPolicy))}, ${sqlValue(endpointRef)}, ${sqlValue(capabilitiesJson)}, ${sqlValue(metadataJson)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(agent_key) DO UPDATE SET
${conflictUpdate}`);
    const rows = await sqlite(paths.dbFile, `SELECT * FROM runtime_agents WHERE agent_key=${sqlValue(agentKey)} LIMIT 1;`, { json: true });
    const saved = registrySnapshot(rows[0] || { agent_key: agentKey, runtime, agent_id: agentId, platform, execution_adapter: executionAdapter, im_ingress_owner: imIngressOwner, im_ingress_adapter: imIngressAdapter, workflow_ingress_adapter: workflowIngressAdapter, im_identity: imIdentity, execution_identity: executionIdentity, return_policy: returnPolicy, can_receive_dispatch: canReceiveDispatch, can_start_workflow: canStartWorkflow, gateway_proxy_allowed: gatewayProxyAllowed });
    const exported = await workflowRuntimeAgents(paths.root, { workflowRootDir: paths.root });
    return { agentKey: saved.agentKey, runtime: rows[0]?.runtime || runtime, agentId: saved.agentId, platform: saved.platform, executionAdapter: saved.executionAdapter, imIngressOwner: saved.imIngressOwner, imIngressAdapter: saved.imIngressAdapter, workflowIngressAdapter: saved.workflowIngressAdapter, imIdentity: saved.imIdentity, executionIdentity: saved.executionIdentity, returnPolicy: saved.returnPolicy, canReceiveDispatch: saved.canReceiveDispatch, canStartWorkflow: saved.canStartWorkflow, gatewayProxyAllowed: saved.gatewayProxyAllowed, snapshotFile: exported.snapshotFile, snapshotGeneratedAt: exported.snapshotGeneratedAt };
  }

  async function runtimeAgentUpsert(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const agent = await ensureRuntimeAgent(paths, { ...input, preserveExisting: true });
    return { ...agent, dbFile: paths.dbFile };
  }

  return {
    ensureRuntimeAgent,
    runtimeAgentUpsert
  };
}
