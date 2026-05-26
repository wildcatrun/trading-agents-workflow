import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_ROOT, runAction } from "./src/core.js";

const PLUGIN_ID = "trading-agents-workflow";
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
let cachedOpenClawConfigPath;
let cachedPluginConfigFromFile;

function jsonText(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

function objectConfig(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function openClawConfigPath() {
  if (process.env.OPENCLAW_CONFIG) return process.env.OPENCLAW_CONFIG;
  const marker = `${path.sep}.openclaw${path.sep}`;
  const markerIndex = PLUGIN_DIR.indexOf(marker);
  if (markerIndex >= 0) {
    return path.join(PLUGIN_DIR.slice(0, markerIndex + marker.length - 1), "openclaw.json");
  }
  const home = process.env.OPENCLAW_HOME || (process.env.HOME ? path.join(process.env.HOME, ".openclaw") : "");
  return home ? path.join(home, "openclaw.json") : undefined;
}

function readPluginConfigFromOpenClawFile() {
  const configPath = openClawConfigPath();
  if (!configPath) return {};
  if (cachedOpenClawConfigPath === configPath && cachedPluginConfigFromFile) return cachedPluginConfigFromFile;
  cachedOpenClawConfigPath = configPath;
  cachedPluginConfigFromFile = {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    cachedPluginConfigFromFile = objectConfig(parsed.plugins?.entries?.[PLUGIN_ID]?.config);
  } catch {
    cachedPluginConfigFromFile = {};
  }
  return cachedPluginConfigFromFile;
}

function pluginConfig(api) {
  const direct = objectConfig(api?.pluginConfig);
  if (Object.keys(direct).length > 0) return direct;
  const apiConfig = objectConfig(api?.config);
  if (apiConfig.rootDir || apiConfig.controlLoop) return apiConfig;
  return readPluginConfigFromOpenClawFile();
}

function resolveRoot(api) {
  const configured = typeof pluginConfig(api).rootDir === "string" ? pluginConfig(api).rootDir : undefined;
  return configured || process.env.TRADING_AGENTS_WORKFLOW_ROOT || process.env.CAT_MEETING_GOVERNANCE_ROOT;
}

function requireRoot(api) {
  const root = resolveRoot(api);
  if (!root) throw new Error("trading-agents-workflow root is required; configure plugin rootDir or set TRADING_AGENTS_WORKFLOW_ROOT.");
  return root;
}

function normalizeRootValue(value) {
  const text = String(value || "");
  if (text.startsWith("~/") && process.env.HOME) return path.resolve(process.env.HOME, text.slice(2));
  return path.resolve(text);
}

function commandRoot(options = {}, api) {
  if (options.workflowRoot && options.root && normalizeRootValue(options.workflowRoot) !== normalizeRootValue(options.root)) {
    throw new Error("--workflow-root and --root point to different directories; pass only one workflow root.");
  }
  return options.workflowRoot || options.root || resolveRoot(api);
}

function guardWorkflowRootOverride(input, root) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const override = input.workflowRootDir || input.workflow_root || input.workflowRoot || input.rootDir || input.root;
  if (override && root && normalizeRootValue(override) !== normalizeRootValue(root)) {
    throw new Error("workflowRootDir override is not allowed through the OpenClaw tool; configure plugin rootDir instead.");
  }
  return input;
}

function boolConfig(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(value);
}

function configList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return fallback;
}

function normalizeAgentId(value) {
  return String(value || "").trim().toLowerCase();
}

function configuredAgentSet(api, key, fallback = []) {
  const accessConfig = objectConfig(pluginConfig(api).toolAccess);
  return new Set(configList(accessConfig[key] ?? pluginConfig(api)[key], fallback).map(normalizeAgentId));
}

function workflowToolMode(api, toolContext = {}) {
  const agentId = normalizeAgentId(toolContext.agentId);
  const disabledAgents = configuredAgentSet(api, "disabledAgents", []);
  if (disabledAgents.has(agentId)) return "disabled";
  const fullAgents = configuredAgentSet(api, "fullAgents", ["main"]);
  if (fullAgents.has(agentId)) return "full";
  const governanceAgents = configuredAgentSet(api, "governanceAgents", ["cat_claw"]);
  if (governanceAgents.has(agentId)) return "governance";
  return "message_only";
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function parseCliJson(value, fallback = undefined) {
  if (value === undefined || value === null || value === "") return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`invalid JSON option: ${error?.message || error}`);
  }
}

function messageFlowSendInput(params = {}, toolContext = {}) {
  const contextAgent = normalizeAgentId(toolContext.agentId || "");
  const sourceAgent = normalizeAgentId(params.fromAgent ?? params.from_agent ?? contextAgent ?? "unknown");
  return compactObject({
    action: "message_flow.send",
    callerAgent: contextAgent || sourceAgent,
    callerRuntime: params.fromRuntime ?? params.from_runtime ?? "openclaw",
    toolMode: "message_only",
    fromAgent: sourceAgent,
    fromRuntime: params.fromRuntime ?? params.from_runtime ?? "openclaw",
    to: params.to,
    body: params.body,
    subject: params.subject,
    workflowId: params.workflowId ?? params.workflow_id,
    meetingId: params.meetingId ?? params.meeting_id,
    requiresAck: params.requiresAck ?? params.requires_ack,
    sourceSystem: "openclaw_plugin",
    createdBy: `openclaw:${sourceAgent || "unknown"}`,
    calledAt: new Date().toISOString()
  });
}

function withWorkflowToolCaller(params = {}, toolContext = {}, mode = "") {
  const contextAgent = normalizeAgentId(toolContext.agentId || "");
  const paramAgent = normalizeAgentId(params.callerAgent || params.caller_agent || "");
  return compactObject({
    ...params,
    callerAgent: contextAgent || paramAgent,
    callerRuntime: params.callerRuntime ?? params.caller_runtime ?? "openclaw",
    toolMode: mode || params.toolMode || params.tool_mode,
    sourceSystem: params.sourceSystem ?? params.source_system ?? "openclaw_plugin"
  });
}

function isPluginInspectionProcess() {
  const args = process.argv.map((arg) => String(arg || ""));
  const pluginsIndex = args.indexOf("plugins");
  if (pluginsIndex < 0) return false;
  return args.slice(pluginsIndex + 1).some((arg) => arg === "inspect" || arg === "doctor");
}

const toolParameters = {
  type: "object",
  additionalProperties: true,
  properties: {
    action: {
      type: "string",
      enum: [
        "init",
        "status",
        "meeting.create",
        "meeting.append",
        "meeting.command",
        "meeting.summary",
        "meeting.close",
        "meeting.handoff",
        "meeting.artifact",
        "meeting.state",
        "meeting.action_item",
        "meeting.decision",
        "meeting.minutes",
        "meeting.notify",
        "meeting.index",
        "meeting.validate",
        "cat_claw.observe",
        "cat_claw.minutes",
        "cat_claw.digest",
        "cat_claw.notify",
        "cat_claw.audit",
        "workflow.init",
        "workflow.status",
        "workflow.readiness",
        "workflow.topology",
        "workflow.runtime_agents",
        "workflow.runtime-agents",
        "workflow.runtime.registry",
        "workflow.permission.check",
        "workflow.permission.explain",
        "workflow.run.upsert",
        "workflow.initiative.upsert",
        "workflow.swarm.plan",
        "workflow.swarm",
        "workflow.task.create",
        "workflow.task.update",
        "workflow.task.list",
        "workflow.tasks",
        "workflow.advance",
        "workflow.advance.preview",
        "workflow.preview.advance",
        "workflow.supervise",
        "workflow.supervisor",
        "workflow.supervise.preview",
        "workflow.supervisor.preview",
        "workflow.preview.supervise",
        "workflow.control_loop.tick",
        "workflow.loop.tick",
        "workflow.reconciler.tick",
        "workflow.schedule.upsert",
        "workflow.scheduler.upsert",
        "workflow.schedule.list",
        "workflow.schedules",
        "workflow.scheduler.list",
        "workflow.schedule.pause",
        "workflow.scheduler.pause",
        "workflow.schedule.resume",
        "workflow.scheduler.resume",
        "workflow.schedule.disable",
        "workflow.scheduler.disable",
        "workflow.checkpoint",
        "workflow.context_checkpoint",
        "context.checkpoint",
        "workflow.event.append",
        "workflow.events.append",
        "workflow.event.list",
        "workflow.events",
        "workflow.events.list",
        "workflow.event.timeline",
        "workflow.timeline",
        "workflow.events.timeline",
        "workflow.session_pack.upsert",
        "workflow.session.pack.upsert",
        "session_pack.upsert",
        "workflow.session_pack.get",
        "workflow.session.pack.get",
        "session_pack.get",
        "workflow.session_pack.list",
        "workflow.session.pack.list",
        "session_pack.list",
        "workflow.session_run.start",
        "workflow.session.run.start",
        "session_run.start",
        "workflow.session_run.complete",
        "workflow.session.run.complete",
        "session_run.complete",
        "protocol.record",
        "protocol.object",
        "runtime.agent",
        "runtime.agent.upsert",
        "route_shell.ingest",
        "route-shell.ingest",
        "route_shell.route",
        "runtime.bridge",
        "runtime.bridge.drain",
        "meeting.runtime_participant",
        "runtime.participant",
        "telegram.live",
        "telegram.live.configure",
        "meeting.dispatch",
        "meeting.ingest",
        "workflow.dispatch.reconcile",
        "dispatch.reconcile",
        "stale_dispatch.reconcile",
        "human_gate.request",
        "human_gate.web_app_review",
        "human_gate.web_app_submit",
        "human_gate.button_callback",
        "human_gate.callback",
        "human_gate.feedback",
        "human_gate.submit_feedback",
        "human_gate.inbox",
        "human_gate.console",
        "human_gate.batch_inbox",
        "human_gate.review_form",
        "human_gate.submit_form",
        "human_gate.resume",
        "human_gate.confirm",
        "meeting.resume",
        "meeting.disperse",
        "telegram.outbox",
        "message_flow.send",
        "message_flow.list",
        "message_flow.status",
        "message_flow.reconcile",
        "workflow.message_flow.send",
        "workflow.message_flow.list",
        "workflow.message_flow.status",
        "workflow.message_flow.reconcile",
        "instrument.upsert",
        "tracking.instrument",
        "radar.update",
        "thesis.create",
        "thesis.update",
        "research.evidence",
        "research.memo",
        "trade.proposal",
        "risk.decision",
        "trade.intent",
        "execution.intent",
        "trading_core.receipt",
        "execution.receipt",
        "side_effect.record",
        "side_effect.ledger",
        "incident.state",
        "workflow.incident",
        "gate.review",
        "human_gate.record",
        "workflow.human_gate",
        "human_gate.review",
        "telegram.bridge",
        "meeting.show",
        "meeting.list"
      ]
    },
    meetingId: { type: "string" },
    meetingType: { type: "string" },
    title: { type: "string" },
    goal: { type: "string" },
    chair: { type: "string" },
    chairAgent: { type: "string" },
    secretaryAgent: { type: "string" },
    participants: { type: "array", items: { type: "string" } },
    observers: { type: "array", items: { type: "string" } },
    notifyTargets: { type: "array", items: { type: "string" } },
    telegramTarget: { type: "string" },
    mode: { type: "string" },
    phase: { type: "string" },
    section: { type: "string" },
    text: { type: "string" },
    summary: { type: "string" },
    type: { type: "string" },
    operation: { type: "string" },
    itemId: { type: "string" },
    decisionId: { type: "string" },
    ownerAgent: { type: "string" },
    requiredArtifact: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    humanGateRequired: { type: "boolean" },
    autoDeliver: { type: "boolean" },
    target: { type: "string" },
    account: { type: "string" },
    channel: { type: "string" },
    period: { type: "string" },
    date: { type: "string" },
    source: { type: "string" },
    from: { type: "string" },
    fromAgent: { type: "string" },
    fromRuntime: { type: "string" },
    toAgents: { type: "array", items: { type: "string" } },
    subject: { type: "string" },
    body: { type: "string" },
    sourceRefs: { type: "array", items: { type: "string" } },
    requiresAck: { type: "boolean" },
    priority: { type: "string" },
    gateType: { type: "string" },
    status: { type: "string" },
    kind: { type: "string" },
    name: { type: "string" },
    content: { type: "string" },
    purpose: { type: "string" },
    instrumentId: { type: "string" },
    assetType: { type: "string" },
    symbol: { type: "string" },
    exchange: { type: "string" },
    currency: { type: "string" },
    aliases: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    radarZone: { type: "string" },
    retailHeatScore: { type: "number" },
    newsCatalystScore: { type: "number" },
    fundamentalScore: { type: "number" },
    sentimentStage: { type: "string" },
    sourceReliability: { type: "string" },
    catalystWindow: { type: "string" },
    fundamentalTrend: { type: "string" },
    valuationState: { type: "string" },
    confidence: { type: "string" },
    thesisId: { type: "string" },
    falsificationTriggers: { type: "string" },
    reviewDueAt: { type: "string" },
    memoId: { type: "string" },
    memoType: { type: "string" },
    conclusion: { type: "string" },
    evidenceId: { type: "string" },
    reliability: { type: "string" },
    supports: { type: "string" },
    conflicts: { type: "string" },
    gateId: { type: "string" },
    reviewerAgent: { type: "string" },
    workflowId: { type: "string" },
    workflowType: { type: "string" },
    initiativeId: { type: "string" },
    objective: { type: "string" },
    acceptanceCriteria: { type: "string" },
    stopCondition: { type: "string" },
    taskId: { type: "string" },
    parentTaskId: { type: "string" },
    taskType: { type: "string" },
    dependsOn: { type: "array", items: { type: "string" } },
    expectedArtifact: { type: "string" },
    actualArtifactRef: { type: "string" },
    buttons: {},
    options: {},
    choices: {},
    receiptRequired: { type: "boolean" },
    autoDispatch: { type: "boolean" },
    goalComplete: { type: "boolean" },
    drain: { type: "boolean" },
    drainQueued: { type: "boolean" },
    deliverOutbox: { type: "boolean" },
    autoDeliverMessageFlowOutbox: { type: "boolean" },
    autoReport: { type: "boolean" },
    ensureHumanGateRequests: { type: "boolean" },
    dryRun: { type: "boolean" },
    createHumanGateInbox: { type: "boolean" },
    maxCycles: { type: "number" },
    maxWorkflows: { type: "number" },
    runtimeLimit: { type: "number" },
    outboxLimit: { type: "number" },
    jobLimit: { type: "number" },
    jobLeaseMs: { type: "number" },
    tickMs: { type: "number" },
    leaseMs: { type: "number" },
    owner: { type: "string" },
    reportRuntime: { type: "string" },
    reportAgent: { type: "string" },
    workflowStatuses: { type: "array", items: { type: "string" } },
    flashLane: { type: "boolean" },
    tradingExecution: { type: "boolean" },
    staleDispatchAfterMs: { type: "number" },
    dispatchReconcileLimit: { type: "number" },
    limit: { type: "number" },
    checkpointId: { type: "string" },
    nextActions: { type: "array", items: { type: "string" } },
    tokenBudget: { type: "number" },
    compactAtPercent: { type: "number" },
    restorePolicy: { type: "string" },
    sessionId: { type: "string" },
    session_id: { type: "string" },
    runId: { type: "string" },
    run_id: { type: "string" },
    version: { type: "number" },
    runtimeTarget: { type: "string" },
    runtime_target: { type: "string" },
    systemBrief: { type: "string" },
    system_brief: { type: "string" },
    workingContext: {},
    working_context: {},
    toolPolicy: {},
    tool_policy: {},
    inputSchema: {},
    input_schema: {},
    outputSchema: {},
    output_schema: {},
    evidenceRefs: { type: "array", items: { type: "string" } },
    evidence_refs: { type: "array", items: { type: "string" } },
    checkpointRefs: { type: "array", items: { type: "string" } },
    checkpoint_refs: { type: "array", items: { type: "string" } },
    resourceBudget: {},
    resource_budget: {},
    input: {},
    output: {},
    result: {},
    workerId: { type: "string" },
    worker_id: { type: "string" },
    receiptRef: { type: "string" },
    receipt_ref: { type: "string" },
    createdBy: { type: "string" },
    created_by: { type: "string" },
    traceId: { type: "string" },
    flowId: { type: "string" },
    messageFlowId: { type: "string" },
    messageFlowStuckAfterMs: { type: "number" },
    messageFlowReconcileLimit: { type: "number" },
    returnPolicy: { type: "string" },
    deliveryPolicy: { type: "string" },
    imIdentity: { type: "string" },
    executionIdentity: { type: "string" },
    maxAttempts: { type: "number" },
    staleDays: { type: "number" }
    ,
    scheduleId: { type: "string" },
    scheduleKind: { type: "string" },
    cronExpr: { type: "string" },
    intervalSeconds: { type: "number" },
    timezone: { type: "string" },
    concurrencyPolicy: { type: "string" },
    catchupWindowSeconds: { type: "number" },
    misfirePolicy: { type: "string" },
    nextRunAt: { type: "string" },
    resetNextRun: { type: "boolean" },
    enableSchedules: { type: "boolean" },
    scheduleLimit: { type: "number" },
    runLimit: { type: "number" },
    now: { type: "string" },
    objectId: { type: "string" },
    objectType: { type: "string" },
    parentObjectId: { type: "string" },
    payload: {},
    sourceSystem: { type: "string" },
    sourceAgent: { type: "string" },
    proposalId: { type: "string" },
    riskDecisionId: { type: "string" },
    preOrderRiskAuditId: { type: "string" },
    humanGateId: { type: "string" },
    batchId: { type: "string" },
    intentId: { type: "string" },
    receiptId: { type: "string" },
    sideEffectId: { type: "string" },
    sideEffectType: { type: "string" },
    inputHash: { type: "string" },
    outputHash: { type: "string" },
    artifactRef: { type: "string" },
    incidentId: { type: "string" },
    affectedPlanes: { type: "array", items: { type: "string" } },
    commander: { type: "string" },
    impact: { type: "string" },
    currentHypothesis: { type: "string" },
    mitigation: { type: "string" },
    rollbackOptions: { type: "string" },
    exitCriteria: { type: "string" },
    nextUpdateAt: { type: "string" },
    resumePointer: { type: "string" },
    side: { type: "string" },
    quantity: { type: "number" },
    orderType: { type: "string" },
    priceConstraints: {},
    riskLimits: {},
    actor: { type: "string" },
    assurance: { type: "string" },
    clientCertFingerprint: { type: "string" },
    idempotencyKey: { type: "string" },
    expiresAt: { type: "string" },
    executionMode: { type: "string" },
    marketType: { type: "string" },
    exchange: { type: "string" },
    baseAsset: { type: "string" },
    quoteAsset: { type: "string" },
    clientOrderId: { type: "string" },
    timeInForce: { type: "string" },
    tradingCoreRef: { type: "string" }
    ,
    runtime: { type: "string" },
    agentId: { type: "string" },
    displayName: { type: "string" },
    endpointRef: { type: "string" },
    capabilities: {},
    metadata: {},
    participantRole: { type: "string" },
    liveMode: { type: "string" },
    chatId: { type: "string" },
    channelId: { type: "string" },
    humanGateChannelId: { type: "string" },
    dispatchId: { type: "string" },
    dispatchType: { type: "string" },
    prompt: { type: "string" },
    messageId: { type: "string" },
    messageType: { type: "string" },
    outboxId: { type: "string" },
    targetKind: { type: "string" },
    targetRef: { type: "string" },
    eventId: { type: "string" },
    token: { type: "string" },
    callbackToken: { type: "string" },
    callbackChatId: { type: "string" },
    callbackMessageId: { type: "string" },
    initData: { type: "string" },
    webAppBaseUrl: { type: "string" },
    webAppRoutePath: { type: "string" },
    flashcatOriginalWords: { type: "string" },
    targets: { type: "array", items: { type: "string" } },
    limit: { type: "number" },
    timeoutSeconds: { type: "number" },
    activeChecks: { type: "boolean" },
    acpBackend: { type: "string" },
    acpAgent: { type: "string" },
    sessionMode: { type: "string" },
    sessionKey: { type: "string" },
    routeAgentId: { type: "string" },
    sourceMessageId: { type: "string" },
    sourceSystem: { type: "string" },
    sourceRuntime: { type: "string" },
    sourceChannel: { type: "string" },
    accountId: { type: "string" },
    sourceAccountId: { type: "string" },
    sourceChatId: { type: "string" },
    targetPlatform: { type: "string" },
    targetAdapter: { type: "string" },
    drainNow: { type: "boolean" },
    recordIngress: { type: "boolean" },
    requireRouteShell: { type: "boolean" },
    chair: { type: "boolean" },
    decider: { type: "boolean" },
    secretary: { type: "boolean" }
  }
};

const messageFlowSendParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    to: {
      type: "string",
      description: "Target as runtime:agent or a registered agent id."
    },
    body: { type: "string" },
    subject: { type: "string" },
    fromAgent: { type: "string" },
    from_agent: { type: "string" },
    fromRuntime: { type: "string" },
    from_runtime: { type: "string" },
    workflowId: { type: "string" },
    workflow_id: { type: "string" },
    meetingId: { type: "string" },
    meeting_id: { type: "string" },
    requiresAck: { type: "boolean" },
    requires_ack: { type: "boolean" }
  },
  required: ["to", "body"]
};

const governanceWorkflowActions = new Set([
  "status",
  "workflow.status",
  "workflow.readiness",
  "workflow.topology",
  "workflow.runtime_agents",
  "workflow.runtime-agents",
  "workflow.runtime.registry",
  "workflow.permission.check",
  "workflow.permission.explain",
  "workflow.task.list",
  "workflow.tasks",
  "workflow.event.list",
  "workflow.events",
  "workflow.events.list",
  "workflow.event.timeline",
  "workflow.timeline",
  "workflow.events.timeline",
  "workflow.schedule.list",
  "workflow.schedules",
  "workflow.scheduler.list",
  "human_gate.request",
  "human_gate.inbox",
  "human_gate.console",
  "human_gate.batch_inbox",
  "human_gate.review_form",
  "human_gate.submit_form",
  "message_flow.list",
  "message_flow.status",
  "workflow.message_flow.list",
  "workflow.message_flow.status",
  "telegram.outbox",
  "cat_claw.audit"
]);

const governanceToolParameters = {
  type: "object",
  additionalProperties: true,
  properties: {
    action: {
      type: "string",
      enum: [...governanceWorkflowActions]
    },
    workflowId: { type: "string" },
    workflow_id: { type: "string" },
    meetingId: { type: "string" },
    meeting_id: { type: "string" },
    dispatchId: { type: "string" },
    dispatch_id: { type: "string" },
    flowId: { type: "string" },
    flow_id: { type: "string" },
    humanGateId: { type: "string" },
    human_gate_id: { type: "string" },
    limit: { type: "number" },
    status: { type: "string" },
    text: { type: "string" },
    summary: { type: "string" },
    target: { type: "string" },
    account: { type: "string" },
    deliver: { type: "boolean" },
    staleDays: { type: "number" },
    stale_days: { type: "number" }
  },
  required: ["action"]
};

function guardGovernanceWorkflowAction(input = {}) {
  const action = String(input.action || "status").trim();
  if (!governanceWorkflowActions.has(action)) {
    throw new Error(`workflow action is not available to governance tool mode: ${action || "<empty>"}`);
  }
  return input;
}

function registerCli(api) {
  api.registerCli(({ program }) => {
    const command = program.command("trading-agents-workflow").description("Manage OpenClaw trading agents workflow files and SQLite tracking state");

    command.command("status")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Protocol root directory")
      .action(async (options) => {
        const root = commandRoot(options, api);
        console.log(JSON.stringify(await runAction(root, { action: "status", workflowRootDir: root }), null, 2));
      });

    command.command("create")
      .requiredOption("--id <meetingId>", "Meeting id")
      .requiredOption("--title <title>", "Meeting title")
      .option("--type <meetingType>", "Meeting type", "research_meeting")
      .option("--goal <goal>", "Meeting goal")
      .option("--chair <agent>", "Chair agent", "main")
      .option("--secretary <agent>", "Secretary agent", "cat_claw")
      .option("--participant <agent...>", "Participants")
      .option("--observer <agent...>", "Observers")
      .option("--notify <target...>", "Notify targets")
      .option("--telegram <target>", "Telegram frontend target")
      .option("--mode <mode>", "silent, digest, transparent, command_only", "transparent")
      .option("--root <dir>", "Protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.create",
          meetingId: options.id,
          title: options.title,
          meetingType: options.type,
          goal: options.goal,
          chair: options.chair,
          secretaryAgent: options.secretary,
          participants: options.participant || [],
          observers: options.observer || [],
          notifyTargets: options.notify || [],
          telegramTarget: options.telegram,
          mode: options.mode
        }), null, 2));
      });

    command.command("append")
      .argument("<meetingId>")
      .requiredOption("--text <text>", "Text to append")
      .option("--section <section>", "Section label", "讨论记录")
      .option("--actor <agent>", "Actor")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.append",
          meetingId,
          section: options.section,
          actor: options.actor,
          text: options.text
        }), null, 2));
      });

    command.command("command")
      .argument("<meetingId>")
      .requiredOption("--type <type>", "Command type")
      .requiredOption("--text <text>", "Command text")
      .option("--from <name>", "Command source actor")
      .option("--target <agent>", "Target agent", "main")
      .option("--source <source>", "Source", "tool")
      .option("--priority <priority>", "normal or steer", "normal")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.command",
          meetingId,
          type: options.type,
          text: options.text,
          from: options.from,
          target: options.target,
          source: options.source,
          priority: options.priority
        }), null, 2));
      });

    command.command("summary")
      .argument("<meetingId>")
      .requiredOption("--text <summary>", "Summary text")
      .option("--telegram <text>", "Telegram summary")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.summary",
          meetingId,
          summary: options.text,
          telegramText: options.telegram
        }), null, 2));
      });

    command.command("artifact")
      .argument("<meetingId>")
      .requiredOption("--name <name>", "Artifact file name")
      .requiredOption("--content <content>", "Artifact content")
      .option("--kind <kind>", "Artifact kind", "artifact")
      .option("--summary <summary>", "Artifact summary")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.artifact",
          meetingId,
          name: options.name,
          kind: options.kind,
          content: options.content,
          summary: options.summary
        }), null, 2));
      });

    command.command("human-gate")
      .argument("<meetingId>")
      .requiredOption("--gate <gateType>", "Human Gate type")
      .requiredOption("--text <text>", "Decision/request text")
      .option("--status <status>", "pending, approved, rejected, paused, terminated", "pending")
      .option("--from <name>", "Human actor", "闪电猫")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.record",
          meetingId,
          gateType: options.gate,
          text: options.text,
          status: options.status,
          from: options.from
        }), null, 2));
      });

    command.command("telegram-bridge")
      .argument("<meetingId>")
      .requiredOption("--text <text>", "Telegram command text")
      .option("--type <type>", "Command type", "direction_change")
      .option("--from <name>", "Telegram actor", "telegram")
      .option("--chat <chatId>", "Telegram chat id")
      .option("--message <messageId>", "Telegram message id")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "telegram.bridge",
          meetingId,
          type: options.type,
          text: options.text,
          from: options.from,
          chatId: options.chat,
          messageId: options.message
        }), null, 2));
      });

    command.command("handoff")
      .argument("<meetingId>")
      .requiredOption("--to <agent>", "Target agent")
      .requiredOption("--text <text>", "Handoff text")
      .option("--from <agent>", "Source agent", "main")
      .option("--priority <priority>", "normal or steer", "normal")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.handoff",
          meetingId,
          to: options.to,
          text: options.text,
          from: options.from,
          priority: options.priority
        }), null, 2));
      });

    command.command("state")
      .argument("<meetingId>")
      .option("--status <status>", "Meeting status")
      .option("--phase <phase>", "Meeting phase")
      .option("--human-gate", "Mark Human Gate required")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.state",
          meetingId,
          status: options.status,
          phase: options.phase,
          ...(options.humanGate ? { humanGateRequired: true } : {})
        }), null, 2));
      });

    command.command("action-item")
      .argument("<meetingId>")
      .option("--op <operation>", "create, update, list")
      .option("--id <itemId>", "Action item id")
      .option("--title <title>", "Action item title")
      .option("--owner <agent>", "Owner agent")
      .option("--status <status>", "Action item status")
      .option("--required-artifact <path>", "Required artifact")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.action_item",
          meetingId,
          operation: options.op,
          itemId: options.id,
          title: options.title,
          ownerAgent: options.owner,
          status: options.status,
          requiredArtifact: options.requiredArtifact
        }), null, 2));
      });

    command.command("decision")
      .argument("<meetingId>")
      .option("--op <operation>", "create, update, list")
      .option("--id <decisionId>", "Decision id")
      .option("--title <title>", "Decision title")
      .option("--status <status>", "Decision status")
      .option("--approved-by <agent>", "Approver")
      .option("--evidence <path...>", "Evidence artifact paths")
      .option("--human-gate", "Human Gate required")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.decision",
          meetingId,
          operation: options.op,
          decisionId: options.id,
          title: options.title,
          status: options.status,
          approvedBy: options.approvedBy,
          evidence: options.evidence || [],
          humanGateRequired: Boolean(options.humanGate)
        }), null, 2));
      });

    command.command("minutes")
      .argument("<meetingId>")
      .option("--text <text>", "Minutes content")
      .option("--mode <mode>", "write or append", "write")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.minutes",
          meetingId,
          text: options.text,
          mode: options.mode
        }), null, 2));
      });

    command.command("notify")
      .argument("<meetingId>")
      .requiredOption("--summary <text>", "Notification summary")
      .option("--target <target>", "Notify target", "flashcat")
      .option("--channel <channel>", "Notify channel", "telegram")
      .option("--human-gate", "Human Gate required")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.notify",
          meetingId,
          summary: options.summary,
          target: options.target,
          channel: options.channel,
          humanGateRequired: Boolean(options.humanGate)
        }), null, 2));
      });

    command.command("validate")
      .argument("<meetingId>")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.validate",
          meetingId
        }), null, 2));
      });

    command.command("cat_claw-observe")
      .argument("<meetingId>")
      .option("--text <text>", "Observation text")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "cat_claw.observe",
          meetingId,
          text: options.text
        }), null, 2));
      });

    command.command("cat_claw-digest")
      .option("--period <period>", "daily, weekly, monthly", "daily")
      .option("--date <date>", "Date")
      .option("--root <dir>", "Protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "cat_claw.digest",
          period: options.period,
          date: options.date
        }), null, 2));
      });

    command.command("workflow-status")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--asset <assetType>", "Asset type")
      .option("--symbol <symbol>", "Instrument symbol")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.status",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol
        }), null, 2));
      });

    command.command("workflow-topology")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.topology",
          workflowRootDir: options.workflowRoot
        }), null, 2));
      });

    command.command("workflow-run")
      .requiredOption("--workflow <workflowId>", "Workflow or initiative id")
      .option("--type <workflowType>", "Workflow type", "initiative")
      .option("--status <status>", "active, waiting_human, blocked, completed, stopped", "active")
      .option("--owner <agent>", "Owner agent", "main")
      .option("--summary <summary>", "Summary")
      .option("--objective <objective>", "Objective")
      .option("--acceptance <criteria>", "Acceptance criteria")
      .option("--acceptance-criteria <criteria>", "Acceptance criteria")
      .option("--stop-condition <condition>", "Stop condition")
      .option("--phase <phase>", "Current phase", "planning")
      .option("--flash-lane <trueOrFalse>", "Reserve flash-lane scheduling priority for future trading execution workflows", "false")
      .option("--trading-execution <trueOrFalse>", "Mark this workflow as trading-execution class", "false")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.run.upsert",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          workflowType: options.type,
          status: options.status,
          ownerAgent: options.owner,
          summary: options.summary,
          objective: options.objective,
          acceptanceCriteria: options.acceptanceCriteria || options.acceptance,
          stopCondition: options.stopCondition,
          phase: options.phase,
          flashLane: options.flashLane === "true",
          tradingExecution: options.tradingExecution === "true"
        }), null, 2));
      });

    command.command("workflow-task")
      .requiredOption("--workflow <workflowId>", "Workflow id")
      .option("--task <taskId>", "Task id")
      .option("--owner <agent>", "Owner agent", "main")
      .option("--runtime <runtime>", "Runtime")
      .option("--agent <agentId>", "Runtime agent id")
      .option("--type <taskType>", "Task type", "task")
      .option("--phase <phase>", "Workflow phase")
      .option("--priority <priority>", "steer, high, normal, low", "normal")
      .option("--after <taskIds>", "Comma-separated dependency task ids")
      .option("--summary <summary>", "Task summary")
      .option("--prompt <prompt>", "Task prompt")
      .option("--expected-artifact <artifact>", "Expected artifact")
      .option("--human-gate", "Requires Human Gate before dispatch")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.task.create",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          taskId: options.task,
          ownerAgent: options.owner,
          runtime: options.runtime,
          agentId: options.agent,
          taskType: options.type,
          phase: options.phase,
          priority: options.priority,
          dependsOn: options.after ? options.after.split(",").map((item) => item.trim()).filter(Boolean) : [],
          summary: options.summary,
          prompt: options.prompt,
          expectedArtifact: options.expectedArtifact,
          humanGateRequired: Boolean(options.humanGate)
        }), null, 2));
      });

    command.command("workflow-task-update")
      .requiredOption("--task <taskId>", "Task id")
      .option("--status <status>", "pending, in_progress, done, blocked, failed, cancelled")
      .option("--artifact <artifactRef>", "Actual artifact reference")
      .option("--blocked-reason <reason>", "Blocked reason")
      .option("--summary <summary>", "Task summary")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.task.update",
          workflowRootDir: options.workflowRoot,
          taskId: options.task,
          status: options.status,
          actualArtifactRef: options.artifact,
          blockedReason: options.blockedReason,
          summary: options.summary
        }), null, 2));
      });

    command.command("workflow-tasks")
      .option("--workflow <workflowId>", "Workflow id")
      .option("--status <status>", "Task status")
      .option("--owner <agent>", "Owner agent")
      .option("--limit <limit>", "Limit", "100")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.task.list",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          status: options.status,
          ownerAgent: options.owner,
          limit: Number(options.limit)
        }), null, 2));
      });

    command.command("workflow-advance")
      .requiredOption("--workflow <workflowId>", "Workflow id")
      .option("--meeting <meetingId>", "Meeting id for generated dispatches")
      .option("--auto-dispatch", "Create dispatches for ready tasks")
      .option("--goal-complete", "Mark workflow completed when all tasks are done")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.advance",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: Boolean(options.autoDispatch),
          goalComplete: Boolean(options.goalComplete)
        }), null, 2));
      });

    command.command("workflow-advance-preview")
      .requiredOption("--workflow <workflowId>", "Workflow id")
      .option("--meeting <meetingId>", "Meeting id for generated dispatches")
      .option("--auto-dispatch <trueOrFalse>", "Include would-dispatch rows for ready tasks", "false")
      .option("--goal-complete", "Preview workflow completed when all tasks are done")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.advance.preview",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: options.autoDispatch === "true",
          goalComplete: Boolean(options.goalComplete)
        }), null, 2));
      });

    command.command("workflow-supervise")
      .requiredOption("--workflow <workflowId>", "Workflow id")
      .option("--meeting <meetingId>", "Meeting id for generated dispatches")
      .option("--auto-dispatch <trueOrFalse>", "Create dispatches for ready tasks", "true")
      .option("--drain <trueOrFalse>", "Drain runtime bridge queues created by this cycle", "false")
      .option("--max-cycles <count>", "Supervisor cycles", "1")
      .option("--limit <limit>", "Runtime drain limit", "5")
      .option("--timeout-seconds <seconds>", "Runtime dispatch timeout", "120")
      .option("--auto-report <trueOrFalse>", "Create Cat Claw report dispatch when required", "true")
      .option("--report-runtime <runtime>", "Cat Claw report runtime", "openclaw")
      .option("--report-agent <agent>", "Cat Claw report agent", "cat_claw")
      .option("--summary <summary>", "Checkpoint summary")
      .option("--text <text>", "Flashcat context")
      .option("--next-action <action>", "Next action; repeatable", (value, previous) => [...previous, value], [])
      .option("--dry-run <trueOrFalse>", "Do not drain runtime or deliver outbox", "false")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.supervise",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: options.autoDispatch !== "false",
          drain: options.drain === "true",
          maxCycles: Number(options.maxCycles),
          runtimeLimit: Number(options.limit),
          timeoutSeconds: Number(options.timeoutSeconds),
          autoReport: options.autoReport !== "false",
          reportRuntime: options.reportRuntime,
          reportAgent: options.reportAgent,
          summary: options.summary,
          text: options.text,
          nextActions: options.nextAction || [],
          dryRun: options.dryRun === "true"
        }), null, 2));
      });

    command.command("workflow-supervise-preview")
      .requiredOption("--workflow <workflowId>", "Workflow id")
      .option("--meeting <meetingId>", "Meeting id for generated dispatches")
      .option("--auto-dispatch <trueOrFalse>", "Include would-dispatch rows for ready tasks", "true")
      .option("--drain <trueOrFalse>", "Preview runtime drain queues created by this cycle", "false")
      .option("--max-cycles <count>", "Supervisor cycles", "1")
      .option("--auto-report <trueOrFalse>", "Preview Cat Claw report dispatch when required", "true")
      .option("--report-runtime <runtime>", "Cat Claw report runtime", "openclaw")
      .option("--report-agent <agent>", "Cat Claw report agent", "cat_claw")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.supervise.preview",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: options.autoDispatch !== "false",
          drain: options.drain === "true",
          maxCycles: Number(options.maxCycles),
          autoReport: options.autoReport !== "false",
          reportRuntime: options.reportRuntime,
          reportAgent: options.reportAgent
        }), null, 2));
      });

    command.command("workflow-control-loop-tick")
      .option("--tick-ms <ms>", "Control-loop tick period metadata", "10000")
      .option("--max-workflows <count>", "Max workflows to supervise", "2")
      .option("--limit <limit>", "Runtime drain limit", "1")
      .option("--outbox-limit <limit>", "Telegram outbox delivery limit", "5")
      .option("--job-limit <limit>", "Control-loop jobs to claim per tick", "4")
      .option("--job-lease-ms <ms>", "Control-loop job lease", "120000")
      .option("--message-flow-stuck-after-ms <ms>", "Create an incident when a completed message flow has no Telegram receipt after this window", "300000")
      .option("--message-flow-reconcile-limit <limit>", "Max stuck message flows to inspect per reconcile job", "20")
      .option("--timeout-seconds <seconds>", "Runtime dispatch timeout", "45")
      .option("--tick-budget-ms <ms>", "Soft per-tick budget", "60000")
      .option("--runtime <runtimeList>", "Comma-separated platforms to drain", "hermers")
      .option("--report-runtime <runtime>", "Cat Claw report runtime", "openclaw")
      .option("--report-agent <agent>", "Cat Claw report agent", "cat_claw")
      .option("--drain <trueOrFalse>", "Drain runtime bridge queues", "true")
      .option("--auto-dispatch <trueOrFalse>", "Create dispatches for ready workflow tasks", "true")
      .option("--drain-queued <trueOrFalse>", "Drain queued runtime dispatches after workflow supervision", "true")
      .option("--deliver-outbox <trueOrFalse>", "Deliver valid queued Telegram outbox rows", "true")
      .option("--auto-report <trueOrFalse>", "Create Cat Claw report dispatch when required", "false")
      .option("--ensure-human-gate-requests <trueOrFalse>", "Ensure pending Human Gate records have buttons and outbox", "true")
      .option("--create-human-gate-inbox <trueOrFalse>", "Create Human Gate inbox when no recent batch exists", "true")
      .option("--enable-schedules <trueOrFalse>", "Seed due workflow schedules", "true")
      .option("--schedule-limit <count>", "Max due schedules to seed per tick", "20")
      .option("--retention <trueOrFalse>", "Prune workflow runtime logs and stale control-loop rows", "true")
      .option("--retention-hours <hours>", "Runtime retention horizon", "72")
      .option("--retention-interval-ms <ms>", "Minimum interval between retention sweeps", "3600000")
      .option("--dry-run <trueOrFalse>", "Do not drain runtime or deliver outbox", "false")
      .option("--owner <owner>", "Lease owner", "openclaw-plugin")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.control_loop.tick",
          workflowRootDir: options.workflowRoot,
          tickMs: Number(options.tickMs),
          maxWorkflows: Number(options.maxWorkflows),
          runtimeLimit: Number(options.limit),
          outboxLimit: Number(options.outboxLimit),
          jobLimit: Number(options.jobLimit),
          jobLeaseMs: Number(options.jobLeaseMs),
          messageFlowStuckAfterMs: Number(options.messageFlowStuckAfterMs),
          messageFlowReconcileLimit: Number(options.messageFlowReconcileLimit),
          timeoutSeconds: Number(options.timeoutSeconds),
          tickBudgetMs: Number(options.tickBudgetMs),
          runtimes: options.runtime,
          reportRuntime: options.reportRuntime,
          reportAgent: options.reportAgent,
          drain: options.drain !== "false",
          autoDispatch: options.autoDispatch !== "false",
          drainQueued: options.drainQueued !== "false",
          deliverOutbox: options.deliverOutbox !== "false",
          autoReport: options.autoReport === "true",
          ensureHumanGateRequests: options.ensureHumanGateRequests !== "false",
          createHumanGateInbox: options.createHumanGateInbox !== "false",
          enableSchedules: options.enableSchedules !== "false",
          scheduleLimit: Number(options.scheduleLimit),
          retention: options.retention !== "false",
          retentionHours: Number(options.retentionHours),
          retentionIntervalMs: Number(options.retentionIntervalMs),
          dryRun: options.dryRun === "true",
          owner: options.owner
        }), null, 2));
      });

    command.command("workflow-schedule-upsert")
      .requiredOption("--id <scheduleId>", "Schedule id")
      .requiredOption("--agent <agentId>", "Target agent id")
      .requiredOption("--prompt <prompt>", "Prompt to dispatch when due")
      .option("--name <name>", "Schedule display name")
      .option("--kind <scheduleKind>", "cron or interval")
      .option("--cron <cronExpr>", "Five-field cron expression")
      .option("--interval-seconds <seconds>", "Interval schedule seconds")
      .option("--timezone <timezone>", "IANA timezone", "Asia/Shanghai")
      .option("--runtime <runtime>", "Target runtime", "hermers")
      .option("--type <dispatchType>", "Dispatch type")
      .option("--priority <priority>", "flash, steer, high, normal, low", "normal")
      .option("--status <status>", "active, paused, disabled", "active")
      .option("--concurrency-policy <policy>", "skip or allow", "skip")
      .option("--catchup-window-seconds <seconds>", "Allowed catchup window", "900")
      .option("--misfire-policy <policy>", "skip or run_once", "skip")
      .option("--timeout-seconds <seconds>", "Runtime dispatch timeout", "45")
      .option("--max-attempts <count>", "Runtime dispatch attempts", "1")
      .option("--next-run-at <iso>", "Explicit next run timestamp")
      .option("--reset-next-run <trueOrFalse>", "Recompute next_run_at", "false")
      .option("--payload <json>", "Schedule payload JSON")
      .option("--from <createdBy>", "Creator", "workflow_scheduler")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.schedule.upsert",
          workflowRootDir: options.workflowRoot,
          scheduleId: options.id,
          name: options.name,
          scheduleKind: options.kind,
          cronExpr: options.cron,
          intervalSeconds: options.intervalSeconds ? Number(options.intervalSeconds) : undefined,
          timezone: options.timezone,
          runtime: options.runtime,
          agentId: options.agent,
          prompt: options.prompt,
          dispatchType: options.type,
          priority: options.priority,
          status: options.status,
          concurrencyPolicy: options.concurrencyPolicy,
          catchupWindowSeconds: Number(options.catchupWindowSeconds),
          misfirePolicy: options.misfirePolicy,
          timeoutSeconds: Number(options.timeoutSeconds),
          maxAttempts: Number(options.maxAttempts),
          nextRunAt: options.nextRunAt,
          resetNextRun: options.resetNextRun === "true",
          payload: options.payload,
          createdBy: options.from
        }), null, 2));
      });

    command.command("workflow-schedule-list")
      .option("--id <scheduleId>", "Schedule id")
      .option("--status <status>", "active, paused, disabled")
      .option("--runtime <runtime>", "Target runtime")
      .option("--agent <agentId>", "Target agent id")
      .option("--limit <count>", "Schedule limit", "50")
      .option("--run-limit <count>", "Recent runs per schedule", "0")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.schedule.list",
          workflowRootDir: options.workflowRoot,
          scheduleId: options.id,
          status: options.status,
          runtime: options.runtime,
          agentId: options.agent,
          limit: Number(options.limit),
          runLimit: Number(options.runLimit)
        }), null, 2));
      });

    command.command("workflow-schedule-pause")
      .requiredOption("--id <scheduleId>", "Schedule id")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.schedule.pause",
          workflowRootDir: options.workflowRoot,
          scheduleId: options.id
        }), null, 2));
      });

    command.command("workflow-schedule-resume")
      .requiredOption("--id <scheduleId>", "Schedule id")
      .option("--reset-next-run <trueOrFalse>", "Recompute next_run_at", "false")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.schedule.resume",
          workflowRootDir: options.workflowRoot,
          scheduleId: options.id,
          resetNextRun: options.resetNextRun === "true"
        }), null, 2));
      });

    command.command("workflow-schedule-disable")
      .requiredOption("--id <scheduleId>", "Schedule id")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.schedule.disable",
          workflowRootDir: options.workflowRoot,
          scheduleId: options.id
        }), null, 2));
      });

    command.command("workflow-checkpoint")
      .requiredOption("--workflow <workflowId>", "Workflow id")
      .option("--checkpoint <checkpointId>", "Checkpoint id")
      .option("--summary <summary>", "Checkpoint summary")
      .option("--next-action <action>", "Next action; repeatable", (value, previous) => [...previous, value], [])
      .option("--token-budget <tokens>", "Context token budget")
      .option("--compact-at <percent>", "Compaction trigger percent")
      .option("--restore-policy <policy>", "Restore policy")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.checkpoint",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          checkpointId: options.checkpoint,
          summary: options.summary,
          nextActions: options.nextAction,
          tokenBudget: Number(options.tokenBudget),
          compactAtPercent: Number(options.compactAt),
          restorePolicy: options.restorePolicy
        }), null, 2));
      });

    command.command("workflow-session-pack-upsert")
      .requiredOption("--session <sessionId>", "Session pack id")
      .requiredOption("--owner-agent <agentId>", "Owner agent for the reusable task context")
      .requiredOption("--task-type <taskType>", "Task type this pack prepares")
      .requiredOption("--purpose <purpose>", "Short purpose of the session pack")
      .option("--runtime-target <runtimeTarget>", "Runtime target hint", "hermers")
      .option("--status <status>", "draft, active, disabled, archived", "active")
      .option("--version <version>", "Explicit pack version")
      .option("--system-brief <text>", "System brief for the worker")
      .option("--working-context <json>", "Minimal working context JSON")
      .option("--tool-policy <json>", "Allowed/forbidden tool policy JSON")
      .option("--input-schema <json>", "Expected input schema JSON")
      .option("--output-schema <json>", "Expected output schema JSON")
      .option("--evidence-refs <json>", "Evidence refs JSON array")
      .option("--checkpoint-refs <json>", "Checkpoint refs JSON array")
      .option("--resource-budget <json>", "Resource budget JSON")
      .option("--metadata <json>", "Metadata JSON")
      .option("--from <createdBy>", "Creator", "local_codex")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.session_pack.upsert",
          workflowRootDir: options.workflowRoot,
          sessionId: options.session,
          ownerAgent: options.ownerAgent,
          taskType: options.taskType,
          runtimeTarget: options.runtimeTarget,
          status: options.status,
          version: options.version ? Number(options.version) : undefined,
          purpose: options.purpose,
          systemBrief: options.systemBrief,
          workingContext: parseCliJson(options.workingContext),
          toolPolicy: parseCliJson(options.toolPolicy),
          inputSchema: parseCliJson(options.inputSchema),
          outputSchema: parseCliJson(options.outputSchema),
          evidenceRefs: parseCliJson(options.evidenceRefs),
          checkpointRefs: parseCliJson(options.checkpointRefs),
          resourceBudget: parseCliJson(options.resourceBudget),
          metadata: parseCliJson(options.metadata),
          createdBy: options.from
        }), null, 2));
      });

    command.command("workflow-session-pack-get")
      .requiredOption("--session <sessionId>", "Session pack id")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.session_pack.get",
          workflowRootDir: options.workflowRoot,
          sessionId: options.session
        }), null, 2));
      });

    command.command("workflow-session-pack-list")
      .option("--status <status>", "Pack status")
      .option("--owner-agent <agentId>", "Owner agent")
      .option("--task-type <taskType>", "Task type")
      .option("--limit <limit>", "Limit", "100")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.session_pack.list",
          workflowRootDir: options.workflowRoot,
          status: options.status,
          ownerAgent: options.ownerAgent,
          taskType: options.taskType,
          limit: Number(options.limit)
        }), null, 2));
      });

    command.command("workflow-session-run-start")
      .requiredOption("--session <sessionId>", "Session pack id")
      .option("--run <runId>", "Run id")
      .option("--workflow <workflowId>", "Workflow id")
      .option("--task <taskId>", "Task id")
      .option("--trace <traceId>", "Trace id")
      .option("--dispatch <dispatchId>", "Dispatch id")
      .option("--worker <workerId>", "Worker id")
      .option("--status <status>", "queued or running", "running")
      .option("--input <json>", "Per-run input JSON")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.session_run.start",
          workflowRootDir: options.workflowRoot,
          sessionId: options.session,
          runId: options.run,
          workflowId: options.workflow,
          taskId: options.task,
          traceId: options.trace,
          dispatchId: options.dispatch,
          workerId: options.worker,
          status: options.status,
          input: parseCliJson(options.input)
        }), null, 2));
      });

    command.command("workflow-session-run-complete")
      .requiredOption("--run <runId>", "Run id")
      .option("--status <status>", "completed, failed, or cancelled", "completed")
      .option("--output <json>", "Structured output JSON")
      .option("--receipt <receiptRef>", "Receipt or artifact reference")
      .option("--error <message>", "Failure message")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.session_run.complete",
          workflowRootDir: options.workflowRoot,
          runId: options.run,
          status: options.status,
          output: parseCliJson(options.output),
          receiptRef: options.receipt,
          error: options.error
        }), null, 2));
      });

    command.command("runtime-agent")
      .requiredOption("--platform <platform>", "openclaw, hermers, or another registered platform")
      .requiredOption("--agent <agentId>", "Agent id")
      .option("--runtime <runtimeKey>", "Registry runtime key, for example openclaw_route_shell for a Gateway route-shell ingress")
      .option("--name <displayName>", "Display name")
      .option("--role <role>", "Agent role")
      .option("--execution-adapter <adapter>", "native, acp, api, webhook, queue, route_shell")
      .option("--im-ingress-owner <owner>", "openclaw_gateway, external_platform, none")
      .option("--im-ingress-adapter <adapter>", "openclaw_native, openclaw_route_shell, platform_im, custom")
      .option("--workflow-ingress-adapter <adapter>", "openclaw_native, acp, api, webhook, queue, route_shell")
      .option("--im-identity <identity>", "IM identity, for example openclaw_route_shell")
      .option("--execution-identity <identity>", "Execution identity, for example hermers_acp")
      .option("--return-policy <policy>", "reply_to_source_chat, report_to_flashcat, or silent")
      .option("--can-receive-dispatch <trueOrFalse>", "Whether workflow dispatches may target this instance", "true")
      .option("--can-start-workflow <trueOrFalse>", "Whether this instance may start workflow records", "true")
      .option("--gateway-proxy-allowed <trueOrFalse>", "Whether OpenClaw Gateway may proxy messages for this instance", "true")
      .option("--endpoint <endpointRef>", "Endpoint reference")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "runtime.agent.upsert",
          workflowRootDir: options.workflowRoot,
          runtime: options.runtime,
          platform: options.platform,
          agentId: options.agent,
          displayName: options.name,
          role: options.role,
          executionAdapter: options.executionAdapter,
          imIngressOwner: options.imIngressOwner,
          imIngressAdapter: options.imIngressAdapter,
          workflowIngressAdapter: options.workflowIngressAdapter,
          imIdentity: options.imIdentity,
          executionIdentity: options.executionIdentity,
          returnPolicy: options.returnPolicy,
          canReceiveDispatch: options.canReceiveDispatch !== "false",
          canStartWorkflow: options.canStartWorkflow !== "false",
          gatewayProxyAllowed: options.gatewayProxyAllowed !== "false",
          endpointRef: options.endpoint
        }), null, 2));
      });

    command.command("route-shell-ingest")
      .requiredOption("--agent <agentId>", "OpenClaw route-shell agent id")
      .requiredOption("--text <text>", "Raw message to route")
      .option("--message-id <messageId>", "Provider/source message id")
      .option("--source-channel <channel>", "Source channel, for example telegram")
      .option("--account-id <accountId>", "Source/delivery account id")
      .option("--chat-id <chatId>", "Source chat/conversation id")
      .option("--sender-id <senderId>", "Source sender id")
      .option("--source <sourceSystem>", "Source system", "cli")
      .option("--target-platform <platform>", "Override target platform")
      .option("--target-adapter <adapter>", "Override target workflow ingress adapter")
      .option("--return-policy <policy>", "reply_to_source_chat, report_to_flashcat, or silent")
      .option("--priority <priority>", "flash, steer, high, normal, low", "normal")
      .option("--drain-now <trueOrFalse>", "Drain the created dispatch immediately", "false")
      .option("--timeout-seconds <seconds>", "Runtime drain timeout", "45")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "route_shell.ingest",
          workflowRootDir: options.workflowRoot,
          routeAgentId: options.agent,
          text: options.text,
          sourceMessageId: options.messageId,
          sourceChannel: options.sourceChannel,
          accountId: options.accountId,
          chatId: options.chatId,
          senderId: options.senderId,
          sourceSystem: options.source,
          targetPlatform: options.targetPlatform,
          targetAdapter: options.targetAdapter,
          returnPolicy: options.returnPolicy,
          deliveryPolicy: options.returnPolicy,
          priority: options.priority,
          drainNow: options.drainNow === "true",
          timeoutSeconds: Number(options.timeoutSeconds)
        }), null, 2));
      });

    command.command("meeting-participant")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .requiredOption("--runtime <runtime>", "Runtime")
      .requiredOption("--agent <agentId>", "Agent id")
      .option("--role <participantRole>", "Participant role", "participant")
      .option("--chair", "Chair")
      .option("--decider", "Decider")
      .option("--secretary", "Secretary")
      .option("--live-mode <mode>", "transparent, digest, silent", "transparent")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.runtime_participant",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          runtime: options.runtime,
          agentId: options.agent,
          participantRole: options.role,
          chair: Boolean(options.chair),
          decider: Boolean(options.decider),
          secretary: Boolean(options.secretary),
          liveMode: options.liveMode
        }), null, 2));
      });

    command.command("telegram-live")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .option("--chat <chatId>", "Telegram group chat id")
      .option("--channel <channelId>", "Telegram channel id")
      .option("--target <target>", "Configured Telegram target alias")
      .option("--target-name <name>", "Configured Telegram target name")
      .option("--human-gate-channel <channelId>", "Human Gate Telegram channel id")
      .option("--mode <mode>", "transparent, digest, silent", "transparent")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "telegram.live",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          chatId: options.chat,
          channelId: options.channel,
          target: options.target,
          targetName: options.targetName,
          humanGateChannelId: options.humanGateChannel,
          mode: options.mode
        }), null, 2));
      });

    command.command("meeting-dispatch")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .requiredOption("--runtime <runtime>", "Runtime")
      .requiredOption("--agent <agentId>", "Agent id")
      .requiredOption("--prompt <prompt>", "Dispatch prompt")
      .option("--type <dispatchType>", "Dispatch type", "discussion_turn")
      .option("--priority <priority>", "Priority", "normal")
      .option("--from <createdBy>", "Creator", "main")
      .option("--return-policy <policy>", "Message flow return policy")
      .option("--source-channel <channel>", "Source channel for reply return path")
      .option("--account-id <accountId>", "Source/delivery account id")
      .option("--chat-id <chatId>", "Source Telegram chat id")
      .option("--sender-id <senderId>", "Source sender id")
      .option("--source-message-id <messageId>", "Source message id for idempotency")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.dispatch",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          runtime: options.runtime,
          agentId: options.agent,
          prompt: options.prompt,
          dispatchType: options.type,
          priority: options.priority,
          createdBy: options.from,
          returnPolicy: options.returnPolicy,
          deliveryPolicy: options.returnPolicy,
          sourceChannel: options.sourceChannel,
          accountId: options.accountId,
          chatId: options.chatId,
          senderId: options.senderId,
          sourceMessageId: options.sourceMessageId
        }), null, 2));
      });

    command.command("meeting-ingest")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .requiredOption("--runtime <runtime>", "Runtime")
      .requiredOption("--agent <agentId>", "Agent id")
      .requiredOption("--text <text>", "Message text")
      .option("--type <messageType>", "Message type", "agent_message")
      .option("--phase <phase>", "Meeting phase")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.ingest",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          runtime: options.runtime,
          agentId: options.agent,
          text: options.text,
          messageType: options.type,
          phase: options.phase
        }), null, 2));
      });

    command.command("human-gate-request")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .requiredOption("--text <text>", "Question for Flashcat")
      .option("--gate <gateType>", "Gate type", "fact_confirmation")
      .option("--button <jsonOrLabel...>", "Button option JSON or label")
      .option("--from <agent>", "Requester", "cat_claw")
      .option("--target <chatId>", "Telegram target", "8390724843")
      .option("--account <accountId>", "Telegram account", "cat_claw")
      .option("--channel <channelId>", "Telegram channel id")
      .option("--deliver <trueOrFalse>", "Deliver immediately", "false")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.request",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          text: options.text,
          gateType: options.gate,
          buttons: options.button || [],
          from: options.from,
          target: options.target,
          account: options.account,
          channelId: options.channel,
          autoDeliver: options.deliver === "true"
        }), null, 2));
      });

    command.command("human-gate-inbox")
      .option("--workflow <workflowId>", "Workflow id")
      .option("--batch <batchId>", "Batch id")
      .option("--title <title>", "Inbox title")
      .option("--limit <limit>", "Limit", "100")
      .option("--target <chatId>", "Telegram target", "8390724843")
      .option("--from <agent>", "Creator", "cat_claw")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.inbox",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          batchId: options.batch,
          title: options.title,
          limit: Number(options.limit),
          target: options.target,
          from: options.from
        }), null, 2));
      });

    command.command("human-gate-console")
      .option("--workflow <workflowId>", "Workflow id")
      .option("--batch <batchId>", "Batch id")
      .option("--title <title>", "Console title")
      .option("--limit <limit>", "Limit", "100")
      .option("--target <chatId>", "Telegram target", "8390724843")
      .option("--from <agent>", "Creator", "cat_claw")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.console",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          batchId: options.batch,
          title: options.title,
          limit: Number(options.limit),
          target: options.target,
          from: options.from
        }), null, 2));
      });

    command.command("human-gate-callback")
      .requiredOption("--token <token>", "Human Gate button callback token")
      .option("--actor <actor>", "Actor", "flashcat")
      .option("--from <actor>", "Actor fallback")
      .option("--feedback <text>", "Flashcat original words or review feedback")
      .option("--text <text>", "Flashcat original words or review feedback")
      .option("--runtime <runtime>", "Resume dispatch runtime", "openclaw")
      .option("--agent <agent>", "Resume dispatch agent", "main")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.button_callback",
          workflowRootDir: options.workflowRoot,
          token: options.token,
          actor: options.actor || options.from,
          feedbackText: options.feedback || options.text,
          runtime: options.runtime,
          agentId: options.agent,
          sourceSystem: "human_gate_console"
        }), null, 2));
      });

    command.command("human-gate-feedback")
      .requiredOption("--text <text>", "Flashcat original words or review feedback")
      .option("--token <token>", "Optional Human Gate button callback token")
      .option("--actor <actor>", "Actor", "flashcat")
      .option("--from <actor>", "Actor fallback")
      .option("--runtime <runtime>", "Resume dispatch runtime", "openclaw")
      .option("--agent <agent>", "Resume dispatch agent", "main")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.feedback",
          workflowRootDir: options.workflowRoot,
          token: options.token,
          actor: options.actor || options.from,
          text: options.text,
          runtime: options.runtime,
          agentId: options.agent,
          sourceSystem: "human_gate_console"
        }), null, 2));
      });

    command.command("human-gate-resume")
      .requiredOption("--token <token>", "Human Gate button callback token")
      .requiredOption("--human-gate-id <id>", "Human Gate id")
      .requiredOption("--button-id <id>", "Human Gate button id")
      .requiredOption("--text <text>", "Flashcat original words or review feedback")
      .option("--workflow <id>", "Workflow id")
      .option("--meeting <id>", "Meeting id")
      .option("--actor <actor>", "Actor", "flashcat")
      .option("--from <actor>", "Actor fallback")
      .option("--runtime <runtime>", "Resume dispatch runtime", "openclaw")
      .option("--agent <agent>", "Resume dispatch agent", "main")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.resume",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          meetingId: options.meeting,
          humanGateId: options.humanGateId,
          buttonId: options.buttonId,
          token: options.token,
          actor: options.actor || options.from,
          text: options.text,
          runtime: options.runtime,
          agentId: options.agent,
          sourceSystem: "human_gate_console"
        }), null, 2));
      });

    command.command("meeting-resume")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .option("--text <text>", "Resume summary")
      .option("--from <actor>", "Actor", "flashcat")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.resume",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          text: options.text,
          from: options.from
        }), null, 2));
      });

    command.command("meeting-disperse")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .requiredOption("--text <text>", "Conclusion or execution instruction")
      .option("--target <runtime:agent...>", "Dispatch target")
      .option("--from <actor>", "Actor", "main")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.disperse",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          text: options.text,
          targets: options.target || [],
          from: options.from
        }), null, 2));
      });

    command.command("telegram-outbox")
      .option("--status <status>", "queued, sent, failed", "queued")
      .option("--limit <limit>", "Limit", "20")
      .option("--mark <outboxId>", "Mark outbox item as sent")
      .option("--deliver", "Deliver queued outbox rows")
      .option("--account <accountId>", "Telegram account", "cat_claw")
      .option("--target <chatId>", "Explicit target override")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "telegram.outbox",
          workflowRootDir: options.workflowRoot,
          operation: options.mark ? "mark" : options.deliver ? "deliver" : "list",
          outboxId: options.mark,
          status: options.status,
          limit: Number(options.limit),
          account: options.account,
          target: options.target
        }), null, 2));
      });

    command.command("message-flow-send")
      .requiredOption("--from <agentId>", "Source agent id")
      .requiredOption("--to <runtime:agent...>", "Target agent, optionally runtime:agent")
      .option("--from-runtime <runtime>", "Source runtime", "other")
      .option("--subject <subject>", "Message subject")
      .option("--body <body>", "Message body")
      .option("--type <messageType>", "Message type", "internal_notice")
      .option("--workflow <workflowId>", "Workflow id")
      .option("--meeting <meetingId>", "Meeting id")
      .option("--trace-id <traceId>", "Trace id")
      .option("--idempotency-key <key>", "Base idempotency key")
      .option("--source-ref <path...>", "Source artifact reference")
      .option("--requires-ack <trueOrFalse>", "Whether target should acknowledge", "false")
      .option("--priority <priority>", "Dispatch priority", "normal")
      .option("--return-policy <policy>", "Message flow return policy", "silent")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "workflow.message_flow.send",
          workflowRootDir: options.workflowRoot,
          fromAgent: options.from,
          fromRuntime: options.fromRuntime,
          targets: options.to || [],
          subject: options.subject,
          body: options.body,
          messageType: options.type,
          workflowId: options.workflow,
          meetingId: options.meeting,
          traceId: options.traceId,
          idempotencyKey: options.idempotencyKey,
          sourceRefs: options.sourceRef || [],
          requiresAck: options.requiresAck === "true",
          priority: options.priority,
          returnPolicy: options.returnPolicy
        }), null, 2));
      });

    command.command("message-flow")
      .option("--flow <flowId>", "Message flow id")
      .option("--dispatch <dispatchId>", "Dispatch id")
      .option("--status <status>", "Flow status")
      .option("--limit <limit>", "Limit", "20")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "message_flow.list",
          workflowRootDir: options.workflowRoot,
          flowId: options.flow,
          dispatchId: options.dispatch,
          status: options.status,
          limit: Number(options.limit)
        }), null, 2));
      });

    command.command("trade-proposal")
      .requiredOption("--asset <assetType>", "Asset type")
      .requiredOption("--symbol <symbol>", "Instrument symbol")
      .option("--summary <summary>", "Proposal summary")
      .option("--side <side>", "buy, sell, short, cover, reduce, close")
      .option("--quantity <quantity>", "Quantity")
      .option("--order-type <orderType>", "market, limit, stop, stop_limit, twap, vwap")
      .option("--proposal-id <proposalId>", "Proposal id")
      .option("--from <agent>", "Source agent", "cat_heart")
      .option("--payload <json>", "Extra JSON payload")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "trade.proposal",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          summary: options.summary,
          side: options.side,
          quantity: options.quantity,
          orderType: options.orderType,
          proposalId: options.proposalId,
          from: options.from,
          payload: options.payload
        }), null, 2));
      });

    command.command("risk-decision")
      .requiredOption("--proposal <proposalId>", "Trade proposal id")
      .option("--human-gate <humanGateId>", "Approved Human Gate id")
      .option("--pre-order-risk-audit <preOrderRiskAuditId>", "Cat Tail pre-order risk audit id")
      .option("--status <status>", "pending, approved, rejected, revise_required", "pending")
      .option("--summary <summary>", "Decision summary")
      .option("--reviewer <agent>", "Reviewer agent", "cat_tail")
      .option("--dispatch-type <dispatchType>", "Risk decision dispatch type", "pre_order_risk_audit")
      .option("--decision <decision>", "Structured risk decision", "approved_for_paper_execution")
      .option("--risk-limits <json>", "Canonical riskLimits JSON")
      .option("--evidence-ref <ref...>", "Evidence artifact reference")
      .option("--paper-ref <ref>", "Cat Tail risk paper artifact reference")
      .option("--risk-decision-id <riskDecisionId>", "Risk decision id")
      .option("--asset <assetType>", "Asset type")
      .option("--symbol <symbol>", "Instrument symbol")
      .option("--payload <json>", "Extra JSON payload")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "risk.decision",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          proposalId: options.proposal,
          humanGateId: options.humanGate,
          preOrderRiskAuditId: options.preOrderRiskAudit,
          riskDecisionId: options.riskDecisionId,
          status: options.status,
          summary: options.summary,
          reviewerAgent: options.reviewer,
          dispatchType: options.dispatchType,
          decision: options.decision,
          riskLimits: options.riskLimits ? JSON.parse(options.riskLimits) : {},
          evidenceRefs: options.evidenceRef || [],
          paperRef: options.paperRef,
          payload: options.payload
        }), null, 2));
      });

    command.command("human-gate-workflow")
      .option("--human-gate-id <humanGateId>", "Human Gate id")
      .option("--parent <parentObjectId>", "Parent protocol object id")
      .option("--gate <gateType>", "Gate type", "high_risk_trade_execution")
      .option("--status <status>", "pending, approved, rejected, paused, terminated, expired", "pending")
      .option("--text <text>", "Human Gate summary")
      .option("--actor <actor>", "Human actor", "flashcat")
      .option("--assurance <assurance>", "Auth assurance")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "human_gate.record",
          workflowRootDir: options.workflowRoot,
          humanGateId: options.humanGateId,
          parentObjectId: options.parent,
          gateType: options.gate,
          status: options.status,
          text: options.text,
          actor: options.actor,
          assurance: options.assurance
        }), null, 2));
      });

    command.command("trade-intent")
      .requiredOption("--asset <assetType>", "Asset type")
      .requiredOption("--symbol <symbol>", "Instrument symbol")
      .requiredOption("--side <side>", "buy, sell, short, cover, reduce, close")
      .requiredOption("--proposal <proposalId>", "Trade proposal id")
      .requiredOption("--risk <riskDecisionId>", "Risk decision id")
      .requiredOption("--pre-order-risk-audit <preOrderRiskAuditId>", "Cat Tail pre-order risk audit id")
      .requiredOption("--human-gate <humanGateId>", "Human Gate id")
      .option("--intent-id <intentId>", "Intent id")
      .requiredOption("--workflow-id <workflowId>", "Workflow id bound to this executable intent")
      .requiredOption("--trace-id <traceId>", "Trace id bound to this executable intent")
      .option("--quantity <quantity>", "Quantity")
      .option("--order-type <orderType>", "market, limit", "limit")
      .option("--actor <actor>", "Actor", "flashcat")
      .option("--assurance <assurance>", "Auth assurance", "mtls")
      .option("--cert <fingerprint>", "mTLS client certificate fingerprint")
      .option("--source <sourceSystem>", "Source system", "codex_mtls")
      .option("--idempotency-key <key>", "Idempotency key")
      .requiredOption("--expires-at <expiresAt>", "Intent expiry ISO timestamp")
      .requiredOption("--price-constraints <json>", "Canonical priceConstraints JSON with referencePrice")
      .requiredOption("--risk-limits <json>", "Canonical riskLimits JSON with numeric guardrail")
      .option("--execution-mode <mode>", "paper, simulation")
      .option("--market-type <marketType>", "Market type, for example spot")
      .option("--exchange <exchange>", "Exchange id")
      .option("--base-asset <baseAsset>", "Base asset for crypto spot")
      .option("--quote-asset <quoteAsset>", "Quote asset for crypto spot")
      .option("--client-order-id <clientOrderId>", "Client order id")
      .option("--time-in-force <timeInForce>", "Time in force")
      .option("--payload <json>", "Extra JSON payload")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "trade.intent",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          side: options.side,
          quantity: options.quantity,
          orderType: options.orderType,
          proposalId: options.proposal,
          riskDecisionId: options.risk,
          preOrderRiskAuditId: options.preOrderRiskAudit,
          humanGateId: options.humanGate,
          intentId: options.intentId,
          workflowId: options.workflowId,
          traceId: options.traceId,
          actor: options.actor,
          assurance: options.assurance,
          clientCertFingerprint: options.cert,
          sourceSystem: options.source,
          idempotencyKey: options.idempotencyKey,
          expiresAt: options.expiresAt,
          priceConstraints: options.priceConstraints,
          riskLimits: options.riskLimits,
          executionMode: options.executionMode,
          marketType: options.marketType,
          exchange: options.exchange,
          baseAsset: options.baseAsset,
          quoteAsset: options.quoteAsset,
          clientOrderId: options.clientOrderId,
          timeInForce: options.timeInForce,
          payload: options.payload
        }), null, 2));
      });

    command.command("trading-core-receipt")
      .requiredOption("--intent <intentId>", "Executable trade intent id")
      .option("--status <status>", "accepted, rejected, submitted, filled, partial, cancelled, failed", "accepted")
      .option("--ref <tradingCoreRef>", "Trading core reference")
      .option("--receipt-id <receiptId>", "Receipt id")
      .option("--summary <summary>", "Receipt summary")
      .option("--payload <json>", "Extra JSON payload")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "trading_core.receipt",
          workflowRootDir: options.workflowRoot,
          intentId: options.intent,
          status: options.status,
          tradingCoreRef: options.ref,
          receiptId: options.receiptId,
          summary: options.summary,
          payload: options.payload
        }), null, 2));
      });

    command.command("instrument")
      .requiredOption("--asset <assetType>", "Asset type: stock, futures, crypto, ...")
      .requiredOption("--symbol <symbol>", "Instrument symbol")
      .option("--name <name>", "Instrument name")
      .option("--exchange <exchange>", "Exchange")
      .option("--currency <currency>", "Currency")
      .option("--tag <tag...>", "Tags")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "instrument.upsert",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          name: options.name,
          exchange: options.exchange,
          currency: options.currency,
          tags: options.tag || []
        }), null, 2));
      });

    command.command("radar-update")
      .requiredOption("--asset <assetType>", "Asset type")
      .requiredOption("--symbol <symbol>", "Instrument symbol")
      .option("--name <name>", "Instrument name")
      .option("--zone <radarZone>", "Radar zone")
      .option("--retail <score>", "Retail heat score")
      .option("--news <score>", "News catalyst score")
      .option("--fundamental <score>", "Fundamental score")
      .option("--summary <summary>", "Summary")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "radar.update",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          name: options.name,
          radarZone: options.zone,
          retailHeatScore: options.retail,
          newsCatalystScore: options.news,
          fundamentalScore: options.fundamental,
          summary: options.summary
        }), null, 2));
      });

    command.command("thesis-update")
      .requiredOption("--asset <assetType>", "Asset type")
      .requiredOption("--symbol <symbol>", "Instrument symbol")
      .option("--name <name>", "Instrument name")
      .option("--title <title>", "Thesis title")
      .option("--summary <summary>", "Thesis summary")
      .option("--status <status>", "Thesis status", "active")
      .option("--owner <agent>", "Owner agent", "cat_ears")
      .option("--falsification <text>", "Falsification triggers")
      .option("--review-due <date>", "Review due date")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "thesis.update",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          name: options.name,
          title: options.title,
          summary: options.summary,
          status: options.status,
          ownerAgent: options.owner,
          falsificationTriggers: options.falsification,
          reviewDueAt: options.reviewDue
        }), null, 2));
      });

    command.command("evidence")
      .requiredOption("--asset <assetType>", "Asset type")
      .requiredOption("--symbol <symbol>", "Instrument symbol")
      .option("--name <name>", "Instrument name")
      .option("--kind <kind>", "Evidence kind", "evidence")
      .option("--source <source>", "Source")
      .option("--reliability <reliability>", "Source reliability")
      .option("--summary <summary>", "Evidence summary")
      .option("--supports <text>", "Supports")
      .option("--conflicts <text>", "Conflicts")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "research.evidence",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          name: options.name,
          kind: options.kind,
          source: options.source,
          reliability: options.reliability,
          summary: options.summary,
          supports: options.supports,
          conflicts: options.conflicts
        }), null, 2));
      });

    command.command("research-memo")
      .requiredOption("--asset <assetType>", "Asset type")
      .requiredOption("--symbol <symbol>", "Instrument symbol")
      .option("--name <name>", "Instrument name")
      .option("--title <title>", "Memo title")
      .option("--summary <summary>", "Memo summary")
      .option("--conclusion <text>", "Conclusion")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "research.memo",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          name: options.name,
          title: options.title,
          summary: options.summary,
          conclusion: options.conclusion
        }), null, 2));
      });

    command.command("gate-review")
      .option("--asset <assetType>", "Asset type")
      .option("--symbol <symbol>", "Instrument symbol")
      .option("--gate <gateType>", "Gate type", "review_gate")
      .option("--status <status>", "pending, approved, rejected, waived", "pending")
      .option("--summary <summary>", "Gate summary")
      .option("--reviewer <agent>", "Reviewer agent")
      .option("--human-gate", "Human Gate required")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "gate.review",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          gateType: options.gate,
          status: options.status,
          summary: options.summary,
          reviewerAgent: options.reviewer,
          humanGateRequired: Boolean(options.humanGate)
        }), null, 2));
      });

    command.command("cat_claw-audit")
      .option("--stale-days <days>", "Stale thesis threshold days", "30")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "cat_claw.audit",
          workflowRootDir: options.workflowRoot,
          staleDays: options.staleDays
        }), null, 2));
      });

    command.command("close")
      .argument("<meetingId>")
      .option("--summary <text>", "Closing summary")
      .option("--by <agent>", "Closer", "main")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(commandRoot(options, api), {
          action: "meeting.close",
          meetingId,
          summary: options.summary,
          closedBy: options.by
        }), null, 2));
      });
  }, {
    descriptors: [{ name: "trading-agents-workflow", description: "Manage OpenClaw trading agents workflow files and SQLite tracking state", hasSubcommands: true }]
  });
}

function controlLoopConfig(api) {
  const runtimeConfig = pluginConfig(api);
  const configured = objectConfig(runtimeConfig.controlLoop);
  const envEnabled = process.env.TRADING_AGENTS_WORKFLOW_CONTROL_LOOP;
  const enabled = configured.enabled === true || ["1", "true", "yes", "on"].includes(String(envEnabled || "").trim().toLowerCase());
  const numberValue = (value, fallback, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, number));
  };
  const tickBudgetMs = numberValue(configured.tickBudgetMs, 60_000, 5_000, 30 * 60_000);
  const timeoutSeconds = numberValue(configured.timeoutSeconds, 45, 5, 900);
  const messageFlowStuckAfterMs = numberValue(configured.messageFlowStuckAfterMs ?? configured.message_flow_stuck_after_ms, 5 * 60_000, 60_000, 24 * 3600_000);
  const messageFlowReconcileLimit = numberValue(configured.messageFlowReconcileLimit ?? configured.message_flow_reconcile_limit, 20, 1, 200);
  const retentionHours = numberValue(configured.retentionHours ?? configured.retention_hours ?? process.env.TRADING_AGENTS_WORKFLOW_RETENTION_HOURS, 72, 1, 30 * 24);
  const retentionIntervalMs = numberValue(configured.retentionIntervalMs ?? configured.retention_interval_ms ?? process.env.TRADING_AGENTS_WORKFLOW_RETENTION_INTERVAL_MS, 60 * 60_000, 60_000, 24 * 3600_000);
  const requestedJobLeaseMs = numberValue(configured.jobLeaseMs, 120_000, 10_000, 60 * 60_000);
  const minSafeJobLeaseMs = Math.max(tickBudgetMs + 30_000, (timeoutSeconds + 30) * 1000);
  const jobLeaseMs = Math.max(requestedJobLeaseMs, minSafeJobLeaseMs);
  return {
    enabled,
    tickMs: numberValue(configured.tickMs ?? process.env.TRADING_AGENTS_WORKFLOW_CONTROL_LOOP_TICK_MS, 10_000, 5_000, 300_000),
    startupTick: configured.startupTick === true,
    startupDelayMs: numberValue(configured.startupDelayMs, 10_000, 0, 300_000),
    tickBudgetMs,
    maxWorkflows: numberValue(configured.maxWorkflows, 2, 1, 20),
    runtimeLimit: numberValue(configured.runtimeLimit, 1, 1, 20),
    outboxLimit: numberValue(configured.outboxLimit, 2, 1, 20),
    jobLimit: numberValue(configured.jobLimit, 4, 1, 20),
    jobLeaseMs,
    messageFlowStuckAfterMs,
    messageFlowReconcileLimit,
    timeoutSeconds,
    owner: String(configured.owner || "openclaw-plugin").trim() || "openclaw-plugin",
    workerMode: String(configured.workerMode || "process").trim() || "process",
    runtimes: String(configured.runtimes || "openclaw_route_shell,hermers").trim() || "openclaw_route_shell,hermers",
    reportRuntime: String(configured.reportRuntime || "openclaw").trim() || "openclaw",
    reportAgent: String(configured.reportAgent || "cat_claw").trim() || "cat_claw",
    drain: configured.drain !== false,
    autoDispatch: configured.autoDispatch !== false,
    drainQueued: configured.drainQueued !== false,
    deliverOutbox: configured.deliverOutbox !== false,
    autoReport: configured.autoReport === true,
    ensureHumanGateRequests: configured.ensureHumanGateRequests !== false,
    createHumanGateInbox: configured.createHumanGateInbox !== false,
    enableSchedules: configured.enableSchedules !== false,
    scheduleLimit: numberValue(configured.scheduleLimit, 20, 1, 100),
    retention: configured.retention !== false,
    retentionHours,
    retentionIntervalMs
  };
}

function boolArg(value) {
  return value ? "true" : "false";
}

function controlLoopWorkerArgs(config, root, reason) {
  const script = path.join(PLUGIN_DIR, "bin", "cat-meeting-governance.mjs");
  const args = [
    script,
    "workflow-control-loop-tick",
    "--tick-ms", String(config.tickMs),
    "--max-workflows", String(config.maxWorkflows),
    "--limit", String(config.runtimeLimit),
    "--job-limit", String(config.jobLimit),
    "--job-lease-ms", String(config.jobLeaseMs),
    "--message-flow-stuck-after-ms", String(config.messageFlowStuckAfterMs),
    "--message-flow-reconcile-limit", String(config.messageFlowReconcileLimit),
    "--outbox-limit", String(config.outboxLimit),
    "--timeout-seconds", String(config.timeoutSeconds),
    "--tick-budget-ms", String(config.tickBudgetMs),
    "--runtime", config.runtimes,
    "--report-runtime", config.reportRuntime,
    "--report-agent", config.reportAgent,
    "--owner", config.owner,
    "--drain", boolArg(config.drain),
    "--auto-dispatch", boolArg(config.autoDispatch),
    "--drain-queued", boolArg(config.drainQueued),
    "--deliver-outbox", boolArg(config.deliverOutbox),
    "--auto-report", boolArg(config.autoReport),
    "--ensure-human-gate-requests", boolArg(config.ensureHumanGateRequests),
    "--create-human-gate-inbox", boolArg(config.createHumanGateInbox),
    "--enable-schedules", boolArg(config.enableSchedules),
    "--schedule-limit", String(config.scheduleLimit),
    "--retention", boolArg(config.retention),
    "--retention-hours", String(config.retentionHours),
    "--retention-interval-ms", String(config.retentionIntervalMs)
  ];
  if (root) args.splice(2, 0, "--root", root);
  if (reason) args.push("--reason", reason);
  return args;
}

function signalControlLoopWorker(child, signal) {
  if (!child?.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code !== "ESRCH") {
        console.error(`[trading-agents-workflow] failed to signal control loop worker group ${child.pid}: ${error.message}`);
      }
    }
  }
  try {
    child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.error(`[trading-agents-workflow] failed to signal control loop worker ${child.pid}: ${error.message}`);
    }
  }
}

function controlLoopWorkerEnv(root) {
  const env = {
    ...process.env,
    TRADING_AGENTS_WORKFLOW_CONTROL_LOOP_WORKER: "1",
    TRADING_AGENTS_WORKFLOW_ROOT: root,
    CAT_MEETING_GOVERNANCE_ROOT: root
  };
  delete env.TRADING_AGENTS_WORKFLOW_ALLOW_LEGACY_ROOT;
  return env;
}

function runControlLoopWorker(api, config, reason) {
  const root = requireRoot(api);
  if (normalizeRootValue(root) === normalizeRootValue(LEGACY_ROOT)) {
    throw new Error(`control loop refused retired workflow root: ${LEGACY_ROOT}`);
  }
  if (config.workerMode === "inline") {
    return runAction(root, {
      action: "workflow.control_loop.tick",
      tickMs: config.tickMs,
      maxWorkflows: config.maxWorkflows,
      runtimeLimit: config.runtimeLimit,
      outboxLimit: config.outboxLimit,
      jobLimit: config.jobLimit,
      jobLeaseMs: config.jobLeaseMs,
      messageFlowStuckAfterMs: config.messageFlowStuckAfterMs,
      messageFlowReconcileLimit: config.messageFlowReconcileLimit,
      timeoutSeconds: config.timeoutSeconds,
      tickBudgetMs: config.tickBudgetMs,
      owner: config.owner,
      runtimes: config.runtimes,
      reportRuntime: config.reportRuntime,
      reportAgent: config.reportAgent,
      drain: config.drain,
      autoDispatch: config.autoDispatch,
      drainQueued: config.drainQueued,
      deliverOutbox: config.deliverOutbox,
      autoReport: config.autoReport,
      ensureHumanGateRequests: config.ensureHumanGateRequests,
      createHumanGateInbox: config.createHumanGateInbox,
      enableSchedules: config.enableSchedules,
      scheduleLimit: config.scheduleLimit,
      retention: config.retention,
      retentionHours: config.retentionHours,
      retentionIntervalMs: config.retentionIntervalMs,
      payload: { reason }
    });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, controlLoopWorkerArgs(config, root, reason), {
      cwd: PLUGIN_DIR,
      detached: process.platform !== "win32",
      env: controlLoopWorkerEnv(root),
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    let sigkillTimer = null;
    const killAfterMs = Math.max(config.tickBudgetMs + 15_000, (config.timeoutSeconds + 15) * 1000);
    const timer = setTimeout(() => {
      console.error(`[trading-agents-workflow] control loop worker timed out after ${killAfterMs}ms; terminating process group`);
      signalControlLoopWorker(child, "SIGTERM");
      sigkillTimer = setTimeout(() => {
        signalControlLoopWorker(child, "SIGKILL");
      }, 5_000);
      if (typeof sigkillTimer.unref === "function") sigkillTimer.unref();
    }, killAfterMs);
    if (typeof timer.unref === "function") timer.unref();
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      console.error(`[trading-agents-workflow] control loop worker failed to start: ${error.message}`);
      resolve();
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (sigkillTimer) clearTimeout(sigkillTimer);
      if (code !== 0 || signal) {
        const suffix = stderr.trim() ? `: ${stderr.trim().slice(-1000)}` : "";
        console.error(`[trading-agents-workflow] control loop worker exited code=${code ?? ""} signal=${signal || ""}${suffix}`);
      }
      resolve();
    });
  });
}

function registerControlLoop(api) {
  if (isPluginInspectionProcess()) return;
  const config = controlLoopConfig(api);
  if (!config.enabled) return;
  const singletonKey = "__tradingAgentsWorkflowControlLoop";
  if (globalThis[singletonKey]?.stop) globalThis[singletonKey].stop("replaced");
  const state = { running: false, stopped: false, timer: null, startupTimer: null };
  globalThis[singletonKey] = state;
  const runTick = async (reason) => {
    if (state.running || state.stopped) return;
    state.running = true;
    try {
      await runControlLoopWorker(api, config, reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[trading-agents-workflow] control loop tick failed: ${message}`);
    } finally {
      state.running = false;
    }
  };
  state.timer = setInterval(() => runTick("interval"), config.tickMs);
  if (typeof state.timer.unref === "function") state.timer.unref();
  if (config.startupTick) {
    state.startupTimer = setTimeout(() => runTick("startup"), config.startupDelayMs);
    if (typeof state.startupTimer.unref === "function") state.startupTimer.unref();
  }
  const stop = () => {
    state.stopped = true;
    if (state.timer) clearInterval(state.timer);
    if (state.startupTimer) clearTimeout(state.startupTimer);
  };
  state.stop = stop;
  if (typeof api.onDispose === "function") api.onDispose(stop);
  else if (typeof api.onShutdown === "function") api.onShutdown(stop);
  console.error(`[trading-agents-workflow] control loop enabled tickMs=${config.tickMs} workerMode=${config.workerMode} jobLimit=${config.jobLimit}`);
}

function routeShellConfig(api) {
  const runtimeConfig = pluginConfig(api);
  const configured = objectConfig(runtimeConfig.routeShell || runtimeConfig.route_shell);
  const envEnabled = process.env.TRADING_AGENTS_WORKFLOW_ROUTE_SHELL_AUTO || process.env.TRADING_AGENTS_WORKFLOW_ROUTE_SHELL;
  return {
    enabled: configured.enabled === true || boolConfig(envEnabled, false),
    agentIds: new Set(configList(configured.agentIds || configured.agent_ids, ["*"]).map((item) => item === "*" ? "*" : normalizeAgentId(item))),
    channels: new Set(configList(configured.channels, ["*"]).map((item) => item.toLowerCase())),
    targetPlatform: String(configured.targetPlatform || configured.target_platform || "").trim(),
    targetAdapter: String(configured.targetAdapter || configured.target_adapter || configured.workflowIngressAdapter || configured.workflow_ingress_adapter || "").trim(),
    priority: String(configured.priority || "normal").trim() || "normal",
    drainNow: boolConfig(configured.drainNow ?? configured.drain_now, false),
    timeoutSeconds: Number.isFinite(Number(configured.timeoutSeconds ?? configured.timeout_seconds))
      ? Number(configured.timeoutSeconds ?? configured.timeout_seconds)
      : 45,
    ack: configured.ack === true || configured.ack === "true",
    requireRouteShell: configured.requireRouteShell !== false && configured.require_route_shell !== false,
    requireProviderMessageId: configured.requireProviderMessageId === true || configured.require_provider_message_id === true,
    blockOnFailure: configured.blockOnFailure !== false && configured.block_on_failure !== false
  };
}

function routeShellChannel(event = {}, ctx = {}) {
  return String(event.channel || ctx.channelId || "").trim().toLowerCase();
}

function routeShellAgentFromSessionKey(sessionKey) {
  const raw = String(sessionKey || "").trim().toLowerCase();
  const match = raw.match(/^agent:([^:]+):/);
  return match ? normalizeAgentId(match[1]) : "";
}

function routeShellProviderMessageId(event = {}, ctx = {}) {
  for (const source of [event, ctx]) {
    for (const key of ["messageId", "message_id", "providerMessageId", "provider_message_id"]) {
      const value = source?.[key];
      const text = String(value || "").trim();
      if (text) return text;
    }
  }
  return "";
}

function routeShellSyntheticMessageId(event = {}, ctx = {}) {
  const timestamp = String(event.timestamp || ctx.timestamp || "").trim();
  const sessionKey = String(event.sessionKey || ctx.sessionKey || "").trim();
  const content = String(event.body || event.content || "").trim();
  if (!timestamp || !sessionKey || !content) return "";
  const hash = createHash("sha256")
    .update([
      routeShellChannel(event, ctx),
      sessionKey,
      String(ctx.conversationId || "").trim(),
      String(event.senderId || ctx.senderId || "").trim(),
      timestamp,
      content
    ].join("\n"))
    .digest("hex")
    .slice(0, 24);
  return `synthetic:${hash}`;
}

function routeShellFailureText(routeAgentId, reason) {
  return [
    "ROUTE_FAILED",
    `timestamp: ${new Date().toISOString()}`,
    `route_shell: openclaw_route_shell:${routeAgentId || ""}`,
    `reason: ${compactRouteShellReason(reason)}`
  ].join("\n");
}

function compactRouteShellReason(reason) {
  const text = String(reason || "unknown").replace(/\s+/g, " ").trim() || "unknown";
  const lowered = text.toLowerCase();
  if (lowered.includes("database is locked")) return "sqlite database is locked after 5000ms busy timeout";
  if (lowered.includes("unique constraint failed")) return "sqlite unique constraint raced with an existing idempotency row";
  return text.length > 360 ? `${text.slice(0, 360)}...` : text;
}

function routeShellInflightMap() {
  const key = "__tradingAgentsWorkflowRouteShellInflight";
  if (!globalThis[key]) globalThis[key] = new Map();
  return globalThis[key];
}

function routeShellEventTarget(config, event = {}, ctx = {}) {
  const channel = routeShellChannel(event, ctx);
  if (config.channels.size > 0 && !config.channels.has("*") && !config.channels.has(channel)) return null;
  const sessionKey = String(event.sessionKey || ctx.sessionKey || "").trim();
  const routeAgentId = routeShellAgentFromSessionKey(sessionKey);
  if (!routeAgentId) return null;
  if (config.agentIds.size > 0 && !config.agentIds.has("*") && !config.agentIds.has(routeAgentId)) return null;
  return { channel, sessionKey, routeAgentId };
}

function registerRouteShellBeforeDispatch(api) {
  const config = routeShellConfig(api);
  if (!config.enabled) return;
  if (typeof api.on !== "function") {
    console.error("[trading-agents-workflow] route-shell auto-forward disabled: typed plugin hooks are unavailable");
    return;
  }
  api.on("before_dispatch", async (event = {}, ctx = {}) => {
    const target = routeShellEventTarget(config, event, ctx);
    if (!target) return undefined;

    const text = String(event.body || event.content || "").trim();
    if (!text) {
      return { handled: true, text: config.ack ? routeShellFailureText(target.routeAgentId, "empty route-shell inbound text") : undefined };
    }

    const providerMessageId = routeShellProviderMessageId(event, ctx);
    if (config.requireProviderMessageId && !providerMessageId) {
      return {
        handled: true,
        text: config.ack
          ? routeShellFailureText(target.routeAgentId, "provider message id is required for strict route-shell idempotency but before_dispatch did not expose one")
          : undefined
      };
    }
    const syntheticMessageId = providerMessageId ? "" : routeShellSyntheticMessageId(event, ctx);
    const sourceMessageId = providerMessageId || syntheticMessageId;

    const runRoute = async () => {
      const result = await runAction(resolveRoot(api), {
        action: "route_shell.ingest",
        routeAgentId: target.routeAgentId,
        text,
        sourceMessageId,
        sourceChannel: target.channel,
        accountId: ctx.accountId,
        sourceSystem: `gateway:${target.channel || "unknown"}:before_dispatch`,
        sourceRuntime: "openclaw_route_shell",
        targetPlatform: config.targetPlatform || undefined,
        targetAdapter: config.targetAdapter || undefined,
        priority: config.priority,
        drainNow: config.drainNow,
        timeoutSeconds: config.timeoutSeconds,
        requireRouteShell: config.requireRouteShell,
        passThroughOnNotRouteShell: config.agentIds.has("*"),
        chatId: ctx.conversationId,
        senderId: event.senderId || ctx.senderId,
        channelId: target.channel,
        sessionKey: target.sessionKey,
        payload: {
          providerMessageId,
          syntheticMessageId,
          idempotencySource: providerMessageId ? "provider_message_id" : (syntheticMessageId ? "synthetic_before_dispatch_fingerprint" : "none"),
          beforeDispatch: {
            channel: target.channel,
            accountId: ctx.accountId,
            conversationId: ctx.conversationId,
            sessionKey: target.sessionKey,
            senderId: event.senderId || ctx.senderId,
            timestamp: event.timestamp
          }
        }
      });
      if (result?.passThrough || result?.status === "not_route_shell") return undefined;
      if (!result?.ok && !config.blockOnFailure) return undefined;
      return { handled: true, text: config.ack ? result.ackText || JSON.stringify(result) : undefined };
    };

    const inFlightKey = sourceMessageId ? `${target.routeAgentId}:${target.channel}:${sourceMessageId}` : "";
    const inFlight = routeShellInflightMap();
    if (inFlightKey && inFlight.has(inFlightKey)) return inFlight.get(inFlightKey);
    const promise = runRoute().catch((error) => {
      const message = compactRouteShellReason(error instanceof Error ? error.message : String(error));
      console.error(`[trading-agents-workflow] route-shell before_dispatch failed for ${target.routeAgentId}: ${message}`);
      return config.blockOnFailure
        ? { handled: true, text: config.ack ? routeShellFailureText(target.routeAgentId, message) : undefined }
        : undefined;
    });
    if (!inFlightKey) return promise;
    inFlight.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      if (inFlight.get(inFlightKey) === promise) inFlight.delete(inFlightKey);
    }
  }, { priority: 1000 });
  console.error(`[trading-agents-workflow] route-shell auto-forward enabled agents=${[...config.agentIds].join(",")} channels=${[...config.channels].join(",")}`);
}

function normalizeHumanGateWebAppRoutePath(value) {
  const raw = String(value || "/plugins/trading-agents-workflow/human-gate").trim();
  if (!raw) return "/plugins/trading-agents-workflow/human-gate";
  return raw.startsWith("/") ? raw.replace(/\/+$/g, "") || "/" : `/${raw.replace(/\/+$/g, "")}`;
}

function humanGateWebAppRoutePath(api) {
  const cfg = pluginConfig(api);
  const humanGate = objectConfig(cfg.humanGate || cfg.human_gate);
  return normalizeHumanGateWebAppRoutePath(
    process.env.TRADING_AGENTS_WORKFLOW_HG_WEBAPP_ROUTE ||
    process.env.TRADING_AGENTS_WORKFLOW_WEB_APP_ROUTE ||
    humanGate.webAppRoutePath ||
    humanGate.web_app_route_path ||
    cfg.humanGateWebAppRoutePath ||
    cfg.human_gate_web_app_route_path
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sendHttp(res, statusCode, contentType, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(body);
}

function sendJson(res, statusCode, payload) {
  sendHttp(res, statusCode, "application/json; charset=utf-8", JSON.stringify(payload));
}

function readRequestBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseWebAppSubmitBody(rawBody, contentType = "") {
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(rawBody || ""));
}

function renderHumanGateWebAppReview(routePath, review) {
  const button = review.button || {};
  const humanGate = review.humanGate || {};
  const ready = review.canSubmit;
  const statusText = ready ? "等待闪电猫发送原话" : `当前状态：${review.status || "unknown"}`;
  const style = button.style || "primary";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Human Gate 审核</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #16202a; }
    body { margin: 0; }
    main { max-width: 760px; margin: 0 auto; padding: 18px 16px 28px; }
    h1 { font-size: 21px; margin: 0 0 6px; }
    .meta { color: #52606d; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
    .panel { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; margin-top: 12px; }
    .label { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
    .row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; padding: 6px 0; border-top: 1px solid #eef2f7; }
    .row:first-of-type { border-top: 0; }
    .key { color: #52606d; }
    .value { overflow-wrap: anywhere; white-space: pre-wrap; }
    textarea { width: 100%; min-height: 150px; box-sizing: border-box; resize: vertical; border: 1px solid #bcccdc; border-radius: 8px; padding: 11px; font: inherit; line-height: 1.45; }
    button { width: 100%; min-height: 46px; border: 0; border-radius: 8px; color: #fff; font-size: 16px; font-weight: 700; margin-top: 10px; }
    button.success { background: #15803d; }
    button.danger { background: #b91c1c; }
    button.primary { background: #2563eb; }
    button:disabled { background: #94a3b8; }
    .status { margin-top: 10px; font-size: 14px; color: #334e68; min-height: 20px; }
    .error { color: #b91c1c; }
    .ok { color: #15803d; }
  </style>
</head>
<body>
<main>
  <h1>Human Gate 审核</h1>
  <div class="meta">${escapeHtml(statusText)}</div>
  <section class="panel">
    <div class="label">${escapeHtml(button.displayLabel || button.label || "Human Gate 选项")}</div>
    <div class="row"><div class="key">决定</div><div class="value">${escapeHtml(button.decisionStatus || "-")}</div></div>
    <div class="row"><div class="key">工作流</div><div class="value">${escapeHtml(review.workflowId || "-")}</div></div>
    <div class="row"><div class="key">事项</div><div class="value">${escapeHtml(review.humanGateId || "-")}</div></div>
    ${button.summary ? `<div class="row"><div class="key">内容</div><div class="value">${escapeHtml(button.summary)}</div></div>` : ""}
    ${button.prompt ? `<div class="row"><div class="key">边界</div><div class="value">${escapeHtml(button.prompt)}</div></div>` : ""}
    ${humanGate.summary ? `<div class="row"><div class="key">摘要</div><div class="value">${escapeHtml(humanGate.summary)}</div></div>` : ""}
    ${button.artifactRef || humanGate.artifactRef ? `<div class="row"><div class="key">记录</div><div class="value">${escapeHtml(button.artifactRef || humanGate.artifactRef)}</div></div>` : ""}
  </section>
  <form id="hgate-form" class="panel" action="${escapeHtml(routePath)}/submit" method="post">
    <input type="hidden" name="token" value="${escapeHtml(review.token || "")}">
    <input type="hidden" name="initData" value="">
    <textarea name="text" placeholder="闪电猫原话或审核意见" ${ready ? "required" : "disabled"}></textarea>
    <button class="${escapeHtml(style)}" type="submit" ${ready ? "" : "disabled"}>发送并完成 Human Gate</button>
    <div id="status" class="status"></div>
  </form>
</main>
<script>
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    document.querySelector('input[name="initData"]').value = tg.initData || "";
  }
  const form = document.getElementById("hgate-form");
  const statusEl = document.getElementById("status");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    statusEl.className = "status";
    statusEl.textContent = "正在发送...";
    try {
      const body = new URLSearchParams(new FormData(form));
      const response = await fetch(form.action, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
      const result = await response.json();
      if (!response.ok || !["approved","rejected","paused","terminated"].includes(result.status)) throw new Error(result.replyText || result.error || "提交失败");
      statusEl.className = "status ok";
      statusEl.textContent = result.replyText || "Human Gate 已完成。";
      if (tg) setTimeout(() => tg.close(), 900);
    } catch (error) {
      button.disabled = false;
      statusEl.className = "status error";
      statusEl.textContent = error && error.message ? error.message : String(error);
    }
  });
</script>
</body>
</html>`;
}

function registerHumanGateWebAppRoutes(api) {
  if (typeof api.registerHttpRoute !== "function") return;
  const routePath = humanGateWebAppRoutePath(api);
  api.registerHttpRoute({
    path: routePath,
    match: "prefix",
    auth: "plugin",
    replaceExisting: true,
    handler: async (req, res) => {
      const url = new URL(req.url || "/", "http://localhost");
      const pathname = url.pathname.replace(/\/+$/g, "") || "/";
      const root = resolveRoot(api);
      if (req.method === "GET" && pathname === `${routePath}/review`) {
        const review = await runAction(root, { action: "human_gate.web_app_review", token: url.searchParams.get("token") || "" });
        if (review.status === "not_found") return sendHttp(res, 404, "text/plain; charset=utf-8", review.replyText || "Human Gate not found");
        return sendHttp(res, 200, "text/html; charset=utf-8", renderHumanGateWebAppReview(routePath, review));
      }
      if (req.method === "POST" && pathname === `${routePath}/submit`) {
        const rawBody = await readRequestBody(req);
        const body = parseWebAppSubmitBody(rawBody, String(req.headers["content-type"] || ""));
        const result = await runAction(root, {
          action: "human_gate.web_app_submit",
          token: body.token,
          text: body.text,
          initData: body.initData,
          sourceSystem: "telegram_web_app"
        });
        const ok = ["approved", "rejected", "paused", "terminated"].includes(result.status);
        return sendJson(res, ok ? 200 : 400, result);
      }
      res.setHeader("Allow", "GET, POST");
      return sendHttp(res, 404, "text/plain; charset=utf-8", "Not Found");
    }
  });
  console.error(`[trading-agents-workflow] Human Gate Web App route registered at ${routePath}`);
}

function registerHumanGateButtons(api) {
  if (typeof api.registerInteractiveHandler !== "function") return;
  api.registerInteractiveHandler({
    channel: "telegram",
    namespace: "tawhg",
    handler: async (ctx) => {
      const root = resolveRoot(api);
      const result = await runAction(root, {
        action: "human_gate.button_callback",
        token: ctx.callback?.payload,
        actor: ctx.senderId || "flashcat",
        sourceSystem: "telegram_button",
        callbackChatId: ctx.callback?.chatId,
        callbackMessageId: ctx.callback?.messageId,
        payload: {
          accountId: ctx.accountId,
          senderId: ctx.senderId,
          senderUsername: ctx.senderUsername,
          callbackData: ctx.callback?.data
        }
      });
      if (["feedback_pending", "approved", "rejected", "paused", "terminated"].includes(result.status)) {
        await ctx.respond?.clearButtons?.();
      }
      if (result.replyText) {
        await ctx.respond?.reply?.({ text: result.replyText });
      }
      return { handled: true };
    }
  });
}

function commandContextField(ctx, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((cursor, part) => cursor?.[part], ctx);
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

async function replyToCommandContext(ctx, text) {
  if (!text) return;
  if (typeof ctx?.respond?.reply === "function") {
    await ctx.respond.reply({ text });
    return;
  }
  if (typeof ctx?.reply === "function") {
    try {
      await ctx.reply({ text });
    } catch {
      await ctx.reply(text);
    }
    return;
  }
  if (typeof ctx?.ui?.notify === "function") ctx.ui.notify(text, "info");
}

function registerHumanGateFeedbackCommand(api) {
  if (typeof api.registerCommand !== "function") return;
  api.registerCommand({
    name: "hgate",
    description: "提交当前等待中的 Human Gate 闪电猫原话或审核意见。",
    channels: ["telegram"],
    handler: async (args = "", ctx = {}) => {
      const rawArgs = String(args || ctx.args || ctx.text || "").trim();
      const parts = rawArgs.split(/\s+/).filter(Boolean);
      const tokenCandidate = parts[0] || "";
      const token = tokenCandidate.startsWith("tawhg:")
        ? tokenCandidate.slice("tawhg:".length)
        : (/^[A-Za-z0-9._:-]{12,}$/.test(tokenCandidate) ? tokenCandidate : "");
      const text = token ? rawArgs.slice(tokenCandidate.length).trim() : rawArgs;
      const actor = commandContextField(ctx, ["senderId", "sender.id", "from.id"]) || "flashcat";
      const callbackChatId = commandContextField(ctx, ["chatId", "message.chat.id", "from.chatId", "to"]);
      const result = await runAction(resolveRoot(api), {
        action: "human_gate.feedback",
        token,
        text,
        actor,
        senderId: actor,
        accountId: commandContextField(ctx, ["accountId", "account.id"]),
        callbackChatId,
        callbackMessageId: commandContextField(ctx, ["messageId", "message.message_id"]),
        sourceSystem: "telegram_hgate_command",
        payload: {
          channel: commandContextField(ctx, ["channel", "channelId"]),
          accountId: commandContextField(ctx, ["accountId", "account.id"]),
          senderId: actor,
          senderUsername: commandContextField(ctx, ["senderUsername", "sender.username", "from.username"]),
          chatId: callbackChatId,
          messageId: commandContextField(ctx, ["messageId", "message.message_id"])
        }
      });
      await replyToCommandContext(ctx, result.replyText || JSON.stringify(result));
      return result;
    }
  });
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Trading Agents Workflow",
  description: "OpenClaw native trading agents workflow, meeting governance, and SQLite tracking layer.",
  contracts: {
    tools: ["trading_agents_workflow"]
  },
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      rootDir: {
        type: "string",
        description: "Workflow state root. Required through plugin config or TRADING_AGENTS_WORKFLOW_ROOT; the legacy shared root is retired."
      },
      humanGate: {
        type: "object",
        additionalProperties: false,
        description: "Human Gate Telegram Web App review form settings.",
        properties: {
          webAppBaseUrl: { type: "string" },
          webAppRoutePath: { type: "string" },
          verifyTelegramInitData: { type: "string" },
          webAppInitDataMaxAgeSeconds: { type: "number" },
          allowedTelegramUserIds: { type: "array", items: { type: "string" } }
        }
      },
      routeShell: {
        type: "object",
        additionalProperties: false,
        description: "Optional pre-agent physical route-shell forwarding for Gateway message sources. When enabled, before_dispatch handles configured OpenClaw route-shell agents and queues work by registered platform plus workflow ingress adapter instead of running the route-shell agent model.",
        properties: {
          enabled: { type: "boolean" },
          agentIds: { type: "array", items: { type: "string" } },
          channels: { type: "array", items: { type: "string" } },
          targetPlatform: { type: "string" },
          targetAdapter: { type: "string" },
          priority: { type: "string" },
          drainNow: { type: "boolean" },
          timeoutSeconds: { type: "number" },
          ack: { type: "boolean" },
          requireRouteShell: { type: "boolean" },
          requireProviderMessageId: { type: "boolean" },
          blockOnFailure: { type: "boolean" }
        }
      },
      controlLoop: {
        type: "object",
        additionalProperties: false,
        description: "Optional internal workflow reconciler loop. It seeds and claims durable queue jobs for mechanical workflow advancement, runtime drain, Human Gate request delivery, and outbox delivery; it does not make trading decisions.",
        properties: {
          enabled: { type: "boolean" },
          tickMs: { type: "number" },
          startupTick: { type: "boolean" },
          startupDelayMs: { type: "number" },
          tickBudgetMs: { type: "number" },
          maxWorkflows: { type: "number" },
          runtimeLimit: { type: "number" },
          outboxLimit: { type: "number" },
          jobLimit: { type: "number" },
          jobLeaseMs: { type: "number" },
          timeoutSeconds: { type: "number" },
          owner: { type: "string" },
          workerMode: { type: "string" },
          runtimes: { type: "string" },
          reportRuntime: { type: "string" },
          reportAgent: { type: "string" },
          drain: { type: "boolean" },
          autoDispatch: { type: "boolean" },
          drainQueued: { type: "boolean" },
          deliverOutbox: { type: "boolean" },
          autoReport: { type: "boolean" },
          ensureHumanGateRequests: { type: "boolean" },
          createHumanGateInbox: { type: "boolean" }
        }
      }
    }
  },
  register(api) {
    api.registerTool((toolContext) => {
      const mode = workflowToolMode(api, toolContext);
      if (mode === "disabled") return null;
      const messageFlowTool = {
        name: "workflow_message_flow_send",
        description: "Send a governed internal message through trading-agents-workflow message_flow. This is the limited OpenClaw agent surface and does not expose workflow scheduling or state mutation actions.",
        parameters: messageFlowSendParameters,
        execute: async (_id, params) => jsonText(await runAction(requireRoot(api), messageFlowSendInput(params || {}, toolContext)))
      };
      if (mode === "message_only") return messageFlowTool;
      const governanceWorkflowTool = {
        name: "trading_agents_workflow",
        description: "Read and submit secretary-governance workflow surfaces: readiness/status, Human Gate inbox/request, message_flow status, Telegram outbox, and cat_claw audit. Scheduling, dispatch, runtime bridge, registry mutation, trade, and side-effect actions are not available in this mode.",
        parameters: governanceToolParameters,
        execute: async (_id, params) => {
          const root = requireRoot(api);
          const guarded = guardGovernanceWorkflowAction(withWorkflowToolCaller(params || {}, toolContext, mode));
          return jsonText(await runAction(root, guardWorkflowRootOverride(guarded, root)));
        }
      };
      if (mode === "governance") return [governanceWorkflowTool, messageFlowTool];
      return [
        {
          name: "trading_agents_workflow",
          description: "Manage trading agents workflow records, schedules, dispatches, receipts, message flows, Human Gate, incidents, and cat_claw audits. Full surface is limited to configured governance agents.",
          parameters: toolParameters,
          execute: async (_id, params) => {
            const root = requireRoot(api);
            return jsonText(await runAction(root, guardWorkflowRootOverride(withWorkflowToolCaller(params || {}, toolContext, mode), root)));
          }
        },
        messageFlowTool
      ];
    });
    registerCli(api);
    registerControlLoop(api);
    registerRouteShellBeforeDispatch(api);
    registerHumanGateWebAppRoutes(api);
    registerHumanGateButtons(api);
    registerHumanGateFeedbackCommand(api);
  }
});
