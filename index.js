import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { runAction } from "./src/core.js";

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

function resolveRoot(api) {
  const configured = api.pluginConfig && typeof api.pluginConfig.rootDir === "string" ? api.pluginConfig.rootDir : undefined;
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
        "protocol.record",
        "runtime.agent.upsert",
        "runtime.bridge",
        "runtime.bridge.drain",
        "meeting.runtime_participant",
        "telegram.live",
        "meeting.dispatch",
        "meeting.ingest",
        "human_gate.request",
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
    target: { type: "string" },
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
      .option("--status <status>", "pending, approved, rejected", "pending")
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
      .option("--from <agent>", "Requester", "main")
      .option("--channel <channelId>", "Telegram channel id")
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "human_gate.request",
          workflowRootDir: options.workflowRoot,
          meetingId: options.meeting,
          text: options.text,
          gateType: options.gate,
          from: options.from,
          channelId: options.channel
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
      .option("--workflow-root <dir>", "Trading agents workflow root directory")
      .option("--root <dir>", "Meeting protocol root directory")
      .action(async (options) => {
        console.log(JSON.stringify(await runAction(options.root || resolveRoot(api), {
          action: "telegram.outbox",
          workflowRootDir: options.workflowRoot,
          operation: options.mark ? "mark" : "list",
          outboxId: options.mark,
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
      .option("--status <status>", "pending, approved, rejected, expired", "pending")
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

export default definePluginEntry({
  id: "trading-agents-workflow",
  name: "Trading Agents Workflow",
  description: "OpenClaw native trading agents workflow, meeting governance, and SQLite tracking layer.",
  register(api) {
    const execute = async (_id, params) => jsonText(await runAction(resolveRoot(api), params || {}));
    api.registerTool({
      name: "trading_agents_workflow",
      description: "Manage trading agents workflow records: instruments, radar scores, thesis files, evidence packs, research memos, gates, and cat_claw audits.",
      parameters: toolParameters,
      execute
    });
    registerCli(api);
  }
});
