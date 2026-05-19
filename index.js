import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAction } from "./src/core.js";

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
        "workflow.run.upsert",
        "workflow.initiative.upsert",
        "workflow.swarm.plan",
        "workflow.task.create",
        "workflow.task.update",
        "workflow.task.list",
        "workflow.tasks",
        "workflow.advance",
        "workflow.supervise",
        "workflow.control_loop.tick",
        "workflow.loop.tick",
        "workflow.reconciler.tick",
        "workflow.checkpoint",
        "workflow.context_checkpoint",
        "context.checkpoint",
        "protocol.record",
        "runtime.agent.upsert",
        "runtime.bridge",
        "runtime.bridge.drain",
        "meeting.runtime_participant",
        "telegram.live",
        "meeting.dispatch",
        "meeting.ingest",
        "workflow.dispatch.reconcile",
        "dispatch.reconcile",
        "stale_dispatch.reconcile",
        "human_gate.request",
        "human_gate.button_callback",
        "human_gate.callback",
        "human_gate.feedback",
        "human_gate.submit_feedback",
        "human_gate.inbox",
        "human_gate.console",
        "human_gate.batch_inbox",
        "meeting.resume",
        "meeting.disperse",
        "telegram.outbox",
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
        "trading_core.receipt",
        "side_effect.record",
        "incident.state",
        "gate.review",
        "human_gate.record",
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
    priority: { type: "string" },
    gateType: { type: "string" },
    status: { type: "string" },
    kind: { type: "string" },
    name: { type: "string" },
    content: { type: "string" },
    workflowRootDir: { type: "string" },
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
    traceId: { type: "string" },
    maxAttempts: { type: "number" },
    staleDays: { type: "number" }
    ,
    objectId: { type: "string" },
    objectType: { type: "string" },
    parentObjectId: { type: "string" },
    payload: {},
    sourceSystem: { type: "string" },
    sourceAgent: { type: "string" },
    proposalId: { type: "string" },
    riskDecisionId: { type: "string" },
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
    targets: { type: "array", items: { type: "string" } },
    limit: { type: "number" },
    timeoutSeconds: { type: "number" },
    activeChecks: { type: "boolean" },
    acpBackend: { type: "string" },
    acpAgent: { type: "string" },
    sessionMode: { type: "string" },
    sessionKey: { type: "string" },
    chair: { type: "boolean" },
    decider: { type: "boolean" },
    secretary: { type: "boolean" }
  }
};

function registerCli(api) {
  api.registerCli(({ program }) => {
    const command = program.command("trading-agents-workflow").description("Manage OpenClaw trading agents workflow files and SQLite tracking state");

    command.command("status").option("--root <dir>", "Protocol root directory").action(async (options) => {
      console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), { action: "status" }), null, 2));
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "meeting.validate",
          meetingId
        }), null, 2));
      });

    command.command("cat_claw-observe")
      .argument("<meetingId>")
      .option("--text <text>", "Observation text")
      .option("--root <dir>", "Protocol root directory")
      .action(async (meetingId, options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "workflow.advance",
          workflowRootDir: options.workflowRoot,
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: Boolean(options.autoDispatch),
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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

    command.command("workflow-control-loop-tick")
      .option("--tick-ms <ms>", "Control-loop tick period metadata", "10000")
      .option("--max-workflows <count>", "Max workflows to supervise", "2")
      .option("--limit <limit>", "Runtime drain limit", "1")
      .option("--job-limit <limit>", "Control-loop jobs to claim per tick", "4")
      .option("--job-lease-ms <ms>", "Control-loop job lease", "120000")
      .option("--timeout-seconds <seconds>", "Runtime dispatch timeout", "45")
      .option("--tick-budget-ms <ms>", "Soft per-tick budget", "60000")
      .option("--runtime <runtimeList>", "Comma-separated runtimes to drain", "hermes_acp")
      .option("--report-runtime <runtime>", "Cat Claw report runtime", "openclaw")
      .option("--report-agent <agent>", "Cat Claw report agent", "cat_claw")
      .option("--drain <trueOrFalse>", "Drain runtime bridge queues", "true")
      .option("--auto-dispatch <trueOrFalse>", "Create dispatches for ready workflow tasks", "true")
      .option("--drain-queued <trueOrFalse>", "Drain queued runtime dispatches after workflow supervision", "true")
      .option("--deliver-outbox <trueOrFalse>", "Deliver valid queued Telegram outbox rows", "true")
      .option("--auto-report <trueOrFalse>", "Create Cat Claw report dispatch when required", "false")
      .option("--ensure-human-gate-requests <trueOrFalse>", "Ensure pending Human Gate records have buttons and outbox", "true")
      .option("--create-human-gate-inbox <trueOrFalse>", "Create Human Gate inbox when no recent batch exists", "true")
      .option("--dry-run <trueOrFalse>", "Do not drain runtime or deliver outbox", "false")
      .option("--owner <owner>", "Lease owner", "openclaw-plugin")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "workflow.control_loop.tick",
          workflowRootDir: options.workflowRoot,
          tickMs: Number(options.tickMs),
          maxWorkflows: Number(options.maxWorkflows),
          runtimeLimit: Number(options.limit),
          jobLimit: Number(options.jobLimit),
          jobLeaseMs: Number(options.jobLeaseMs),
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
          dryRun: options.dryRun === "true",
          owner: options.owner
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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

    command.command("runtime-agent")
      .requiredOption("--runtime <runtime>", "openclaw, hermes, telegram, local_codex")
      .requiredOption("--agent <agentId>", "Agent id")
      .option("--name <displayName>", "Display name")
      .option("--role <role>", "Agent role")
      .option("--endpoint <endpointRef>", "Endpoint reference")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "runtime.agent.upsert",
          workflowRootDir: options.workflowRoot,
          runtime: options.runtime,
          agentId: options.agent,
          displayName: options.name,
          role: options.role,
          endpointRef: options.endpoint
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "meeting.dispatch",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          runtime: options.runtime,
          agentId: options.agent,
          prompt: options.prompt,
          dispatchType: options.type,
          priority: options.priority,
          createdBy: options.from
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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

    command.command("meeting-resume")
      .requiredOption("--meeting <meetingId>", "Meeting id")
      .option("--text <text>", "Resume summary")
      .option("--from <actor>", "Actor", "flashcat")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
      .option("--status <status>", "pending, approved, rejected, revise_required", "pending")
      .option("--summary <summary>", "Decision summary")
      .option("--reviewer <agent>", "Reviewer agent", "cat_tail")
      .option("--risk-decision-id <riskDecisionId>", "Risk decision id")
      .option("--asset <assetType>", "Asset type")
      .option("--symbol <symbol>", "Instrument symbol")
      .option("--payload <json>", "Extra JSON payload")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "risk.decision",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          proposalId: options.proposal,
          riskDecisionId: options.riskDecisionId,
          status: options.status,
          summary: options.summary,
          reviewerAgent: options.reviewer,
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
      .requiredOption("--human-gate <humanGateId>", "Human Gate id")
      .option("--intent-id <intentId>", "Intent id")
      .option("--quantity <quantity>", "Quantity")
      .option("--order-type <orderType>", "market, limit, stop, stop_limit, twap, vwap", "limit")
      .option("--actor <actor>", "Actor", "flashcat")
      .option("--assurance <assurance>", "Auth assurance", "mtls")
      .option("--cert <fingerprint>", "mTLS client certificate fingerprint")
      .option("--source <sourceSystem>", "Source system", "codex_mtls")
      .option("--idempotency-key <key>", "Idempotency key")
      .option("--payload <json>", "Extra JSON payload")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "trade.intent",
          workflowRootDir: options.workflowRoot,
          assetType: options.asset,
          symbol: options.symbol,
          side: options.side,
          quantity: options.quantity,
          orderType: options.orderType,
          proposalId: options.proposal,
          riskDecisionId: options.risk,
          humanGateId: options.humanGate,
          intentId: options.intentId,
          actor: options.actor,
          assurance: options.assurance,
          clientCertFingerprint: options.cert,
          sourceSystem: options.source,
          idempotencyKey: options.idempotencyKey,
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
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
    timeoutSeconds,
    owner: String(configured.owner || "openclaw-plugin").trim() || "openclaw-plugin",
    workerMode: String(configured.workerMode || "process").trim() || "process",
    runtimes: String(configured.runtimes || "hermes_acp").trim() || "hermes_acp",
    reportRuntime: String(configured.reportRuntime || "openclaw").trim() || "openclaw",
    reportAgent: String(configured.reportAgent || "cat_claw").trim() || "cat_claw",
    drain: configured.drain !== false,
    autoDispatch: configured.autoDispatch !== false,
    drainQueued: configured.drainQueued !== false,
    deliverOutbox: configured.deliverOutbox !== false,
    autoReport: configured.autoReport === true,
    ensureHumanGateRequests: configured.ensureHumanGateRequests !== false,
    createHumanGateInbox: configured.createHumanGateInbox !== false
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
    "--create-human-gate-inbox", boolArg(config.createHumanGateInbox)
  ];
  if (root) args.splice(2, 0, "--root", root);
  if (reason) args.push("--reason", reason);
  return args;
}

function runControlLoopWorker(api, config, reason) {
  if (config.workerMode === "inline") {
    return runAction(resolveRoot(api), {
      action: "workflow.control_loop.tick",
      tickMs: config.tickMs,
      maxWorkflows: config.maxWorkflows,
      runtimeLimit: config.runtimeLimit,
      outboxLimit: config.outboxLimit,
      jobLimit: config.jobLimit,
      jobLeaseMs: config.jobLeaseMs,
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
      payload: { reason }
    });
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, controlLoopWorkerArgs(config, resolveRoot(api), reason), {
      cwd: PLUGIN_DIR,
      env: {
        ...process.env,
        TRADING_AGENTS_WORKFLOW_CONTROL_LOOP_WORKER: "1"
      },
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    const killAfterMs = Math.max(config.tickBudgetMs + 15_000, (config.timeoutSeconds + 15) * 1000);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, killAfterMs);
    if (typeof timer.unref === "function") timer.unref();
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      console.error(`[trading-agents-workflow] control loop worker failed to start: ${error.message}`);
      resolve();
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal) {
        const suffix = stderr.trim() ? `: ${stderr.trim().slice(-1000)}` : "";
        console.error(`[trading-agents-workflow] control loop worker exited code=${code ?? ""} signal=${signal || ""}${suffix}`);
      }
      resolve();
    });
  });
}

function registerControlLoop(api) {
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
  if (config.startupTick) {
    state.startupTimer = setTimeout(() => runTick("startup"), config.startupDelayMs);
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
        description: "Optional workflow root. Defaults to /home/flashcat/.openclaw/shared/trading-agents-workflow."
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
    const execute = async (_id, params) => jsonText(await runAction(resolveRoot(api), params || {}));
    api.registerTool({
      name: "trading_agents_workflow",
      description: "Manage trading agents workflow records: instruments, radar scores, thesis files, evidence packs, research memos, gates, and cat_claw audits.",
      parameters: toolParameters,
      execute
    });
    registerCli(api);
    registerControlLoop(api);
    registerHumanGateButtons(api);
    registerHumanGateFeedbackCommand(api);
  }
});
