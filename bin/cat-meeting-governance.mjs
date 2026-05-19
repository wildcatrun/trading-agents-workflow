#!/usr/bin/env node
import { runAction } from "../src/core.js";

function usage() {
  console.log(`Usage:
  trading-agents-workflow status [--root DIR]
  trading-agents-workflow workflow-status [--asset TYPE --symbol SYMBOL] [--root DIR]
  trading-agents-workflow workflow-readiness [--active-checks] [--root DIR]
  trading-agents-workflow workflow-topology [--root DIR]
  trading-agents-workflow workflow-run --workflow ID [--objective TEXT] [--acceptance-criteria TEXT] [--stop-condition TEXT] [--phase PHASE] [--flash-lane true|false] [--root DIR]
  trading-agents-workflow workflow-swarm --workflow ID --objective TEXT [--target TEXT] [--worker runtime:agent] [--reducer runtime:agent] [--fanout-limit N] [--root DIR]
  trading-agents-workflow workflow-task --workflow ID [--task ID] [--owner AGENT] [--runtime RUNTIME] [--agent AGENT] [--after TASK_IDS] [--expected-artifact PATH] [--root DIR]
  trading-agents-workflow workflow-task-update --task ID [--status STATUS] [--artifact PATH] [--blocked-reason TEXT] [--root DIR]
  trading-agents-workflow workflow-tasks [--workflow ID] [--status STATUS] [--owner AGENT] [--limit N] [--root DIR]
  trading-agents-workflow workflow-advance --workflow ID [--meeting ID] [--auto-dispatch] [--goal-complete] [--root DIR]
  trading-agents-workflow workflow-advance-preview --workflow ID [--meeting ID] [--auto-dispatch true|false] [--goal-complete] [--root DIR]
  trading-agents-workflow workflow-supervise --workflow ID [--meeting ID] [--auto-dispatch] [--drain] [--max-cycles N] [--auto-report false] [--openclaw-bin PATH] [--root DIR]
  trading-agents-workflow workflow-supervise-preview --workflow ID [--meeting ID] [--auto-dispatch true|false] [--drain true|false] [--max-cycles N] [--auto-report true|false] [--root DIR]
  trading-agents-workflow workflow-control-loop-tick [--tick-ms 10000] [--max-workflows N] [--runtime hermers] [--limit N] [--job-limit N] [--tick-budget-ms N] [--auto-dispatch true|false] [--deliver-outbox true|false] [--root DIR]
  trading-agents-workflow workflow-checkpoint --workflow ID [--summary TEXT] [--next-action TEXT] [--token-budget N] [--compact-at N] [--root DIR]
  trading-agents-workflow runtime-agent --platform PLATFORM --agent AGENT [--runtime RUNTIME_KEY] [--execution-adapter ADAPTER] [--im-ingress-owner OWNER] [--im-ingress-adapter ADAPTER] [--workflow-ingress-adapter ADAPTER] [--name NAME] [--role ROLE] [--endpoint REF] [--root DIR]
  trading-agents-workflow route-shell-ingest --agent AGENT --text TEXT [--message-id ID] [--chat-id ID] [--sender-id ID] [--target-platform PLATFORM] [--target-adapter ADAPTER] [--drain-now true|false] [--root DIR]
  trading-agents-workflow meeting-participant --meeting ID --runtime RUNTIME --agent AGENT [--role ROLE] [--chair] [--decider] [--secretary] [--live-mode MODE] [--root DIR]
  trading-agents-workflow telegram-live --meeting ID [--chat CHAT_ID] [--channel CHANNEL_ID] [--human-gate-channel CHANNEL_ID] [--mode MODE] [--root DIR]
  trading-agents-workflow meeting-dispatch --meeting ID --runtime RUNTIME --agent AGENT --prompt TEXT [--type TYPE] [--priority P] [--from AGENT] [--trace-id ID] [--idempotency-key KEY] [--max-attempts N] [--root DIR]
  trading-agents-workflow meeting-ingest --meeting ID --runtime RUNTIME --agent AGENT --text TEXT [--type TYPE] [--phase PHASE] [--root DIR]
  trading-agents-workflow runtime-bridge [--runtime openclaw|hermers|openclaw_route_shell] [--dispatch ID] [--limit N] [--timeout-seconds N] [--session-mode persistent|oneshot] [--acp-backend acpx] [--openclaw-bin PATH] [--dry-run] [--report-delivery false] [--root DIR]
  trading-agents-workflow dispatch-reconcile [--limit N] [--stale-after-ms N] [--timeout-seconds N] [--root DIR]
  trading-agents-workflow human-gate-request --meeting ID --text TEXT [--gate TYPE] [--button JSON_OR_LABEL] [--from AGENT] [--target CHAT_ID] [--channel CHANNEL_ID] [--deliver true|false] [--root DIR]
  trading-agents-workflow human-gate-inbox [--workflow ID] [--batch ID] [--title TEXT] [--limit N] [--target CHAT_ID] [--root DIR]
  trading-agents-workflow human-gate-console [--workflow ID] [--batch ID] [--title TEXT] [--limit N] [--target CHAT_ID] [--root DIR]
  trading-agents-workflow human-gate-callback --token TOKEN [--actor flashcat] [--feedback TEXT] [--runtime openclaw] [--agent main] [--root DIR]
  trading-agents-workflow human-gate-feedback --text TEXT [--token TOKEN] [--actor flashcat] [--runtime openclaw] [--agent main] [--root DIR]
  trading-agents-workflow human-gate-resume --workflow ID [--meeting ID] [--status approved|rejected|paused|terminated] [--text TEXT] [--human-gate-id ID] [--root DIR]
  trading-agents-workflow meeting-resume --meeting ID [--text TEXT] [--from flashcat] [--root DIR]
  trading-agents-workflow meeting-disperse --meeting ID --text TEXT [--target runtime:agent] [--from AGENT] [--root DIR]
  trading-agents-workflow telegram-outbox [--status queued|sent|failed] [--limit N] [--mark OUTBOX_ID] [--deliver] [--account cat_claw] [--target CHAT_ID] [--root DIR]
  trading-agents-workflow trade-proposal --asset TYPE --symbol SYMBOL [--summary TEXT] [--side SIDE] [--quantity N] [--order-type TYPE] [--proposal-id ID] [--payload JSON] [--root DIR]
  trading-agents-workflow risk-decision --proposal ID [--status approved|rejected|pending] [--summary TEXT] [--reviewer AGENT] [--risk-decision-id ID] [--root DIR]
  trading-agents-workflow human-gate-workflow [--human-gate-id ID] [--parent ID] [--gate TYPE] [--status approved|rejected|paused|terminated|pending] [--text TEXT] [--assurance mtls] [--root DIR]
  trading-agents-workflow trade-intent --asset TYPE --symbol SYMBOL --side SIDE --proposal ID --risk ID --human-gate ID [--intent-id ID] [--quantity N] [--order-type TYPE] [--actor flashcat] [--assurance mtls] [--cert FINGERPRINT] [--source codex_mtls] [--idempotency-key KEY] [--root DIR]
  trading-agents-workflow trading-core-receipt --intent ID [--status accepted|submitted|filled|rejected] [--ref REF] [--receipt-id ID] [--summary TEXT] [--root DIR]
  trading-agents-workflow side-effect --type TYPE [--status planned|started|committed|failed|uncertain|rolled_back] [--trace-id ID] [--idempotency-key KEY] [--payload JSON] [--root DIR]
  trading-agents-workflow incident-state --incident ID [--status active|mitigating|monitoring|resolved] [--mode degraded|critical-only|paper-only|frozen|normal] [--plane NAME] [--summary TEXT] [--exit-criteria TEXT] [--root DIR]
  trading-agents-workflow instrument --asset TYPE --symbol SYMBOL [--name NAME] [--exchange EX] [--currency CCY] [--tag TAG] [--root DIR]
  trading-agents-workflow radar-update --asset TYPE --symbol SYMBOL [--zone ZONE] [--retail N] [--news N] [--fundamental N] [--summary TEXT] [--root DIR]
  trading-agents-workflow thesis-update --asset TYPE --symbol SYMBOL [--title TITLE] [--summary TEXT] [--status active|stale|invalidated] [--owner AGENT] [--falsification TEXT] [--review-due DATE] [--root DIR]
  trading-agents-workflow evidence --asset TYPE --symbol SYMBOL [--kind KIND] [--source SOURCE] [--reliability R] [--summary TEXT] [--supports TEXT] [--conflicts TEXT] [--root DIR]
  trading-agents-workflow research-memo --asset TYPE --symbol SYMBOL [--title TITLE] [--summary TEXT] [--conclusion TEXT] [--root DIR]
  trading-agents-workflow gate-review [--asset TYPE --symbol SYMBOL] [--gate TYPE] [--status pending|approved|rejected|waived] [--summary TEXT] [--reviewer AGENT] [--human-gate] [--root DIR]
  trading-agents-workflow cat_claw-audit [--stale-days N] [--root DIR]
  trading-agents-workflow create --id ID --title TITLE [--type TYPE] [--goal TEXT] [--chair AGENT] [--secretary AGENT] [--participant AGENT] [--observer AGENT] [--notify TARGET] [--telegram TARGET] [--mode MODE] [--root DIR]
  trading-agents-workflow append MEETING_ID --text TEXT [--section SECTION] [--actor AGENT] [--root DIR]
  trading-agents-workflow action-item MEETING_ID [--op create|update|list] [--id ID] [--title TITLE] [--owner AGENT] [--status STATUS] [--required-artifact PATH] [--root DIR]
  trading-agents-workflow decision MEETING_ID [--op create|update|list] [--id ID] [--title TITLE] [--status STATUS] [--approved-by AGENT] [--evidence PATH] [--human-gate] [--root DIR]
  trading-agents-workflow minutes MEETING_ID [--text TEXT] [--mode write|append] [--root DIR]
  trading-agents-workflow validate MEETING_ID [--root DIR]`);
}

function parseArgv(argv) {
  const args = [...argv];
  const command = args.shift() || "status";
  const positional = [];
  const options = {};
  while (args.length > 0) {
    const item = args.shift();
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const key = item.slice(2);
    const value = args[0] && !args[0].startsWith("--") ? args.shift() : "true";
    if (options[key] === undefined) options[key] = value;
    else if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = [options[key], value];
  }
  return { command, positional, options };
}

function listOption(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function toAction({ command, positional, options }) {
  const root = options.root;
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      usage();
      return null;
    case "status":
      return { root, input: { action: "status" } };
    case "init":
      return { root, input: { action: "init" } };
    case "workflow-status":
      return { root, input: { action: "workflow.status", assetType: options.asset, symbol: options.symbol } };
    case "workflow-readiness":
      return { root, input: { action: "workflow.readiness", activeChecks: options["active-checks"] === "true" } };
    case "workflow-topology":
      return { root, input: { action: "workflow.topology" } };
    case "workflow-run":
      return {
        root,
        input: {
          action: "workflow.run.upsert",
          workflowId: options.workflow,
          workflowType: options.type,
          status: options.status,
          ownerAgent: options.owner,
          summary: options.summary,
          objective: options.objective,
          acceptanceCriteria: options["acceptance-criteria"] || options.acceptance,
          stopCondition: options["stop-condition"],
          phase: options.phase,
          flashLane: options["flash-lane"] === "true",
          tradingExecution: options["trading-execution"] === "true"
        }
      };
    case "workflow-swarm":
      return {
        root,
        input: {
          action: "workflow.swarm.plan",
          workflowId: options.workflow,
          objective: options.objective || options.goal || options.summary,
          acceptanceCriteria: options["acceptance-criteria"] || options.acceptance,
          stopCondition: options["stop-condition"],
          phase: options.phase,
          shards: listOption(options.target || options.shard || options.item || options.symbol),
          shardCount: options["shard-count"],
          fanoutLimit: options["fanout-limit"],
          workers: listOption(options.worker),
          reducer: options.reducer,
          taskPrefix: options["task-prefix"],
          instructions: options.instructions,
          prompt: options.prompt,
          expectedArtifact: options["expected-artifact"],
          reducerArtifact: options["reducer-artifact"],
          reducerHumanGate: options["reducer-human-gate"] === "true",
          createdBy: options.from
        }
      };
    case "workflow-task":
      return {
        root,
        input: {
          action: "workflow.task.create",
          workflowId: options.workflow,
          taskId: options.task,
          parentTaskId: options.parent,
          ownerAgent: options.owner,
          runtime: options.runtime,
          agentId: options.agent,
          taskType: options.type,
          phase: options.phase,
          priority: options.priority,
          dependsOn: options.after ? String(options.after).split(",").map((item) => item.trim()).filter(Boolean) : [],
          summary: options.summary,
          prompt: options.prompt,
          expectedArtifact: options["expected-artifact"],
          receiptRequired: options["receipt-required"] !== "false",
          humanGateRequired: options["human-gate"] === "true"
        }
      };
    case "workflow-task-update":
      return {
        root,
        input: {
          action: "workflow.task.update",
          taskId: options.task,
          status: options.status,
          actualArtifactRef: options.artifact,
          blockedReason: options["blocked-reason"],
          summary: options.summary
        }
      };
    case "workflow-tasks":
      return { root, input: { action: "workflow.task.list", workflowId: options.workflow, status: options.status, ownerAgent: options.owner, limit: options.limit } };
    case "workflow-advance":
      return {
        root,
        input: {
          action: "workflow.advance",
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: options["auto-dispatch"] === "true",
          goalComplete: options["goal-complete"] === "true"
        }
      };
    case "workflow-advance-preview":
      return {
        root,
        input: {
          action: "workflow.advance.preview",
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: options["auto-dispatch"] === "true",
          goalComplete: options["goal-complete"] === "true"
        }
      };
    case "workflow-supervise":
      return {
        root,
        input: {
          action: "workflow.supervise",
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: options["auto-dispatch"] !== "false",
          drain: options.drain === "true",
          maxCycles: options["max-cycles"],
          runtimeLimit: options.limit,
          timeoutSeconds: options["timeout-seconds"],
          autoReport: options["auto-report"] !== "false",
          reportRuntime: options["report-runtime"],
          reportAgent: options["report-agent"],
          openclawBin: options["openclaw-bin"],
          summary: options.summary,
          text: options.text,
          nextActions: listOption(options["next-action"]),
          dryRun: options["dry-run"] === "true"
        }
      };
    case "workflow-supervise-preview":
      return {
        root,
        input: {
          action: "workflow.supervise.preview",
          workflowId: options.workflow,
          meetingId: options.meeting,
          autoDispatch: options["auto-dispatch"] !== "false",
          drain: options.drain === "true",
          maxCycles: options["max-cycles"],
          autoReport: options["auto-report"] !== "false",
          reportRuntime: options["report-runtime"],
          reportAgent: options["report-agent"]
        }
      };
    case "workflow-control-loop-tick":
      return {
        root,
        input: {
          action: "workflow.control_loop.tick",
          tickMs: options["tick-ms"],
          maxWorkflows: options["max-workflows"],
          runtimeLimit: options.limit,
          jobLimit: options["job-limit"],
          jobLeaseMs: options["job-lease-ms"],
          outboxLimit: options["outbox-limit"],
          timeoutSeconds: options["timeout-seconds"],
          tickBudgetMs: options["tick-budget-ms"],
          runtimes: options.runtime,
          reportRuntime: options["report-runtime"],
          reportAgent: options["report-agent"],
          drain: options.drain !== "false",
          autoDispatch: options["auto-dispatch"] !== "false",
          drainQueued: options["drain-queued"] !== "false",
          deliverOutbox: options["deliver-outbox"] !== "false",
          autoReport: options["auto-report"] === "true",
          ensureHumanGateRequests: options["ensure-human-gate-requests"] !== "false",
          createHumanGateInbox: options["create-human-gate-inbox"] !== "false",
          dryRun: options["dry-run"] === "true",
          owner: options.owner,
          payload: options.reason ? { reason: options.reason } : undefined
        }
      };
    case "workflow-checkpoint":
      return {
        root,
        input: {
          action: "workflow.checkpoint",
          workflowId: options.workflow,
          checkpointId: options.checkpoint,
          summary: options.summary,
          nextActions: listOption(options["next-action"]),
          tokenBudget: options["token-budget"],
          compactAtPercent: options["compact-at"],
          restorePolicy: options["restore-policy"]
        }
      };
    case "runtime-agent":
      return {
        root,
        input: {
          action: "runtime.agent.upsert",
          runtime: options.runtime,
          platform: options.platform,
          agentId: options.agent,
          displayName: options.name,
          role: options.role,
          executionAdapter: options["execution-adapter"],
          imIngressOwner: options["im-ingress-owner"],
          imIngressAdapter: options["im-ingress-adapter"],
          workflowIngressAdapter: options["workflow-ingress-adapter"],
          canReceiveDispatch: options["can-receive-dispatch"] !== "false",
          canStartWorkflow: options["can-start-workflow"] !== "false",
          gatewayProxyAllowed: options["gateway-proxy-allowed"] !== "false",
          endpointRef: options.endpoint
        }
      };
    case "route-shell-ingest":
      return {
        root,
        input: {
          action: "route_shell.ingest",
          routeAgentId: options.agent,
          text: options.text,
          sourceMessageId: options["message-id"],
          chatId: options["chat-id"],
          senderId: options["sender-id"],
          sourceSystem: options.source || "cli",
          targetPlatform: options["target-platform"],
          targetAdapter: options["target-adapter"],
          priority: options.priority,
          drainNow: options["drain-now"] === "true",
          timeoutSeconds: options["timeout-seconds"]
        }
      };
    case "meeting-participant":
      return { root, input: { action: "meeting.runtime_participant", meetingId: options.meeting, runtime: options.runtime, agentId: options.agent, participantRole: options.role, chair: options.chair === "true", decider: options.decider === "true", secretary: options.secretary === "true", liveMode: options["live-mode"] } };
    case "telegram-live":
      return { root, input: { action: "telegram.live", meetingId: options.meeting, chatId: options.chat, channelId: options.channel, humanGateChannelId: options["human-gate-channel"], mode: options.mode } };
    case "meeting-dispatch":
      return { root, input: { action: "meeting.dispatch", meetingId: options.meeting, runtime: options.runtime, agentId: options.agent, prompt: options.prompt, dispatchType: options.type, priority: options.priority, createdBy: options.from, traceId: options["trace-id"], idempotencyKey: options["idempotency-key"], maxAttempts: options["max-attempts"] } };
    case "meeting-ingest":
      return { root, input: { action: "meeting.ingest", meetingId: options.meeting, runtime: options.runtime, agentId: options.agent, text: options.text, messageType: options.type, phase: options.phase } };
    case "runtime-bridge":
      return { root, input: { action: "runtime.bridge.drain", runtime: options.runtime, dispatchId: options.dispatch || options["dispatch-id"], limit: options.limit, timeoutSeconds: options["timeout-seconds"], sessionMode: options["session-mode"], acpBackend: options["acp-backend"], acpAgent: options["acp-agent"], sessionKey: options["session-key"], dryRun: options["dry-run"] === "true", hermesBin: options["hermes-bin"], openclawBin: options["openclaw-bin"], reportDelivery: options["report-delivery"] } };
    case "dispatch-reconcile":
      return { root, input: { action: "workflow.dispatch.reconcile", limit: options.limit, staleDispatchAfterMs: options["stale-after-ms"], timeoutSeconds: options["timeout-seconds"] } };
    case "human-gate-request":
      return { root, input: { action: "human_gate.request", meetingId: options.meeting, text: options.text, gateType: options.gate, buttons: listOption(options.button), from: options.from, target: options.target, channelId: options.channel, autoDeliver: options.deliver === "true", account: options.account } };
    case "human-gate-inbox":
    case "human-gate-console":
      return {
        root,
        input: {
          action: command === "human-gate-console" ? "human_gate.console" : "human_gate.inbox",
          workflowId: options.workflow,
          batchId: options.batch,
          title: options.title,
          limit: options.limit,
          target: options.target,
          from: options.from
        }
      };
    case "human-gate-callback":
      return {
        root,
        input: {
          action: "human_gate.button_callback",
          token: options.token,
          actor: options.actor || options.from,
          feedbackText: options.feedback || options.text,
          runtime: options.runtime,
          agentId: options.agent,
          sourceSystem: "human_gate_console"
        }
      };
    case "human-gate-feedback":
      return {
        root,
        input: {
          action: "human_gate.feedback",
          token: options.token,
          actor: options.actor || options.from,
          text: options.text,
          runtime: options.runtime,
          agentId: options.agent,
          sourceSystem: "human_gate_console"
        }
      };
    case "human-gate-resume":
      return {
        root,
        input: {
          action: "human_gate.resume",
          workflowId: options.workflow,
          meetingId: options.meeting,
          humanGateId: options["human-gate-id"],
          status: options.status,
          text: options.text,
          gateType: options.gate,
          actor: options.actor || options.from,
          runtime: options.runtime,
          agentId: options.agent
        }
      };
    case "meeting-resume":
      return { root, input: { action: "meeting.resume", meetingId: options.meeting, text: options.text, from: options.from } };
    case "meeting-disperse":
      return { root, input: { action: "meeting.disperse", meetingId: options.meeting, text: options.text, targets: listOption(options.target), from: options.from } };
    case "telegram-outbox":
      return {
        root,
        input: {
          action: "telegram.outbox",
          operation: options.deliver === "true" ? "deliver" : options.mark ? "mark" : "list",
          outboxId: options.mark || options.outbox,
          status: options.status,
          limit: options.limit,
          account: options.account,
          target: options.target,
          openclawBin: options["openclaw-bin"],
          timeoutSeconds: options["timeout-seconds"]
        }
      };
    case "trade-proposal":
      return { root, input: { action: "trade.proposal", assetType: options.asset, symbol: options.symbol, summary: options.summary, side: options.side, quantity: options.quantity, orderType: options["order-type"], proposalId: options["proposal-id"], from: options.from, payload: options.payload } };
    case "risk-decision":
      return { root, input: { action: "risk.decision", assetType: options.asset, symbol: options.symbol, proposalId: options.proposal, riskDecisionId: options["risk-decision-id"], status: options.status, summary: options.summary, reviewerAgent: options.reviewer, payload: options.payload } };
    case "human-gate-workflow":
      return { root, input: { action: "human_gate.record", humanGateId: options["human-gate-id"], parentObjectId: options.parent, gateType: options.gate, status: options.status, text: options.text, actor: options.actor, assurance: options.assurance, payload: options.payload } };
    case "trade-intent":
      return { root, input: { action: "trade.intent", assetType: options.asset, symbol: options.symbol, side: options.side, quantity: options.quantity, orderType: options["order-type"], proposalId: options.proposal, riskDecisionId: options.risk, humanGateId: options["human-gate"], intentId: options["intent-id"], actor: options.actor, assurance: options.assurance, clientCertFingerprint: options.cert, sourceSystem: options.source, idempotencyKey: options["idempotency-key"], payload: options.payload } };
    case "trading-core-receipt":
      return { root, input: { action: "trading_core.receipt", intentId: options.intent, status: options.status, tradingCoreRef: options.ref, receiptId: options["receipt-id"], summary: options.summary, payload: options.payload } };
    case "side-effect":
      return { root, input: { action: "side_effect.record", sideEffectType: options.type, status: options.status, traceId: options["trace-id"], workflowId: options["workflow-id"], dispatchId: options["dispatch-id"], idempotencyKey: options["idempotency-key"], payload: options.payload } };
    case "incident-state":
      return { root, input: { action: "incident.state", incidentId: options.incident, status: options.status, mode: options.mode, affectedPlanes: listOption(options.plane), summary: options.summary, commander: options.commander, impact: options.impact, currentHypothesis: options.hypothesis, mitigation: options.mitigation, rollbackOptions: options.rollback, exitCriteria: options["exit-criteria"], nextUpdateAt: options["next-update-at"], payload: options.payload } };
    case "instrument":
      return { root, input: { action: "instrument.upsert", assetType: options.asset, symbol: options.symbol, name: options.name, exchange: options.exchange, currency: options.currency, tags: listOption(options.tag) } };
    case "radar-update":
      return { root, input: { action: "radar.update", assetType: options.asset, symbol: options.symbol, name: options.name, radarZone: options.zone, retailHeatScore: options.retail, newsCatalystScore: options.news, fundamentalScore: options.fundamental, summary: options.summary } };
    case "thesis-update":
      return { root, input: { action: "thesis.update", assetType: options.asset, symbol: options.symbol, name: options.name, title: options.title, summary: options.summary, status: options.status, ownerAgent: options.owner, falsificationTriggers: options.falsification, reviewDueAt: options["review-due"] } };
    case "evidence":
      return { root, input: { action: "research.evidence", assetType: options.asset, symbol: options.symbol, name: options.name, kind: options.kind, source: options.source, reliability: options.reliability, summary: options.summary, supports: options.supports, conflicts: options.conflicts } };
    case "research-memo":
      return { root, input: { action: "research.memo", assetType: options.asset, symbol: options.symbol, name: options.name, title: options.title, summary: options.summary, conclusion: options.conclusion } };
    case "gate-review":
      return { root, input: { action: "gate.review", assetType: options.asset, symbol: options.symbol, gateType: options.gate, status: options.status, summary: options.summary, reviewerAgent: options.reviewer, humanGateRequired: options["human-gate"] === "true" } };
    case "cat_claw-audit":
      return { root, input: { action: "cat_claw.audit", staleDays: options["stale-days"] } };
    case "create":
      return {
        root,
        input: {
          action: "meeting.create",
          meetingId: options.id,
          title: options.title,
          meetingType: options.type,
          goal: options.goal,
          chair: options.chair,
          secretaryAgent: options.secretary,
          participants: listOption(options.participant),
          observers: listOption(options.observer),
          notifyTargets: listOption(options.notify),
          telegramTarget: options.telegram,
          mode: options.mode
        }
      };
    case "append":
      return { root, input: { action: "meeting.append", meetingId: positional[0], text: options.text, section: options.section, actor: options.actor } };
    case "command":
      return { root, input: { action: "meeting.command", meetingId: positional[0], type: options.type, text: options.text, from: options.from, target: options.target, source: options.source, priority: options.priority } };
    case "summary":
      return { root, input: { action: "meeting.summary", meetingId: positional[0], summary: options.text, telegramText: options.telegram } };
    case "artifact":
      return { root, input: { action: "meeting.artifact", meetingId: positional[0], name: options.name, kind: options.kind, content: options.content, summary: options.summary } };
    case "state":
      return { root, input: { action: "meeting.state", meetingId: positional[0], status: options.status, phase: options.phase, ...(options["human-gate"] === "true" ? { humanGateRequired: true } : {}) } };
    case "action-item":
      return {
        root,
        input: {
          action: "meeting.action_item",
          meetingId: positional[0],
          operation: options.op,
          itemId: options.id,
          title: options.title,
          ownerAgent: options.owner,
          status: options.status,
          requiredArtifact: options["required-artifact"]
        }
      };
    case "decision":
      return {
        root,
        input: {
          action: "meeting.decision",
          meetingId: positional[0],
          operation: options.op,
          decisionId: options.id,
          title: options.title,
          status: options.status,
          approvedBy: options["approved-by"],
          evidence: listOption(options.evidence),
          humanGateRequired: options["human-gate"] === "true"
        }
      };
    case "minutes":
      return { root, input: { action: "meeting.minutes", meetingId: positional[0], text: options.text, mode: options.mode } };
    case "notify":
      return { root, input: { action: "meeting.notify", meetingId: positional[0], summary: options.summary, target: options.target, channel: options.channel, humanGateRequired: options["human-gate"] === "true" } };
    case "validate":
      return { root, input: { action: "meeting.validate", meetingId: positional[0] } };
    case "cat_claw-observe":
      return { root, input: { action: "cat_claw.observe", meetingId: positional[0], text: options.text } };
    case "cat_claw-digest":
      return { root, input: { action: "cat_claw.digest", period: options.period, date: options.date } };
    case "human-gate":
      return { root, input: { action: "human_gate.record", meetingId: positional[0], gateType: options.gate, text: options.text, status: options.status, from: options.from } };
    case "telegram-bridge":
      return { root, input: { action: "telegram.bridge", meetingId: positional[0], type: options.type, text: options.text, from: options.from, chatId: options.chat, messageId: options.message } };
    case "handoff":
      return { root, input: { action: "meeting.handoff", meetingId: positional[0], to: options.to, text: options.text, from: options.from, priority: options.priority } };
    case "close":
      return { root, input: { action: "meeting.close", meetingId: positional[0], summary: options.summary, closedBy: options.by } };
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

try {
  const request = toAction(parseArgv(process.argv.slice(2)));
  if (request) console.log(JSON.stringify(await runAction(request.root, request.input), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
