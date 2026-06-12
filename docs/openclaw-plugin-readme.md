# trading-agents-workflow

OpenClaw native workflow layer for the cat-system trading agents.

Target architecture:

- OpenClaw Gateway remains the information-flow and workflow hub.
- `trading-agents-workflow` is the cat-system trading workflow scheduler.
- Hermers is an agent platform/runtime container.
- ACP is an invocation adapter used by Hermers agent instances.

v0.6 upgrades the old meeting-only plugin into a unified trading workflow substrate:

- SQLite tracking state for stocks, futures, crypto, ETFs, indexes, commodities, and other instruments
- Markdown artifacts for thesis, evidence packs, research memos, gates, and meeting minutes
- Meeting workflow as one module inside the larger trading agents workflow
- Cat Claw secretary audit for stale thesis, missing three-face inputs, and pending gates
- Protocol objects for research signals, evidence packs, trade proposals, risk decisions, Human Gate records, executable intents, and trading_core receipts
- mTLS-gated executable trade intents for the local Codex path
- Mixed-platform meeting bridge for OpenClaw, Hermers, and external agents in one logical room
- Hermers platform bridge for invoking registered ACP agent instances through OpenClaw ACPX
- Telegram live outbox and Human Gate request loop for Flashcat confirmation
- Stability governance fields for durable dispatches, trace correlation, idempotency, retry taxonomy, readiness snapshots, side-effect ledger, runtime run records, and incident state documents
- Workflow task pool for long-running initiatives, task dependencies, expected artifacts, and supervisor-style advance decisions
- Workflow checkpoints for session overflow recovery and compact next-action handoff
- Human Gate Inbox batches that collect pending approvals, delivery failures, and review gates into HTML/JSON tables for Flashcat
- Meeting action items mirrored into `workflow_tasks` by default, so Cat Claw's secretary list is visible to the durable workflow supervisor and not trapped in JSONL-only minutes

This is not an independent agent runtime, not a Gateway replacement, not a Hermers runtime, and not a live trading executor. It does not call trading_core or Telegram directly; it records reviewed intents, dispatch queues, transcripts, Telegram outbox entries, and later records trading_core receipts.

## Meeting Role Contract

Cat-brain `main` chairs meetings. It defines the topic, controls the room, orders turns, and may broadcast live progress to Telegram or another governed IM channel.

Cat-claw `cat_claw` is the meeting-system companion agent and secretariat. It listens, records minutes, consolidates the meeting conclusion, reports to Flashcat, and is the Human Gate intake for meeting outcomes. Formal meeting conclusions, confirmation requests, and Human Gate submissions should close through `cat_claw`; `main` should not bypass `cat_claw` as the final secretary/human-gate path.

Other agents contribute within their professional boundaries. They do not replace `main` as chair and do not replace `cat_claw` as the minutes, conclusion, or Human Gate owner.

## Communication Boundary

Local Mac Codex is Flashcat's control panel and outbound operator surface. It can help Flashcat send instructions, queries, reviews, and maintenance requests into the cat system through OpenClaw Gateway and this workflow plugin.

Local Mac Codex can also be addressed as `local_codex` / `codex` through the governed `message_flow` path. This is an inbox delivery surface for structured handoffs, status, review evidence, and operator context. It records inbox receipt evidence; it is not an autonomous cat-system member runtime and it does not mean Codex approved, summarized, or delivered the content to Flashcat.

Formal reports, alerts, confirmation requests, Human Gate requests, task results, receipts, and trading-related messages still need the governed IM/Human Gate path when Flashcat must see or approve them. Use Telegram, WeCom, OpenClaw IM, Cat Claw, and Human Gate according to the workflow policy instead of treating a local Codex inbox receipt as user-visible delivery.

## Agent-to-Agent Message Flow

Use `workflow.message_flow.send` for governed internal notices that need a durable dispatch, `message_flows` row, trace id, idempotency key, and later receipt checks. This is the agent-facing send entry; agents should not write notification Markdown into another agent's workspace and treat that as delivery.

Minimal action payload:

```json
{
  "action": "workflow.message_flow.send",
  "fromAgent": "catnose",
  "fromRuntime": "hermers",
  "targets": ["hermers:cateyes", "hermers:catears"],
  "subject": "DB migration notice",
  "body": "Two db files moved. Please check cron, scripts, and prompt references before the next run.",
  "sourceRefs": ["/home/flashcat/.../migration-evidence.md"],
  "requiresAck": true,
  "idempotencyKey": "catnose-db-migration-20260520"
}
```

The action creates one queued dispatch and one `message_flows` record per target. Completion is still proven by the normal runtime bridge and receipt path; `workflow.message_flow.send` only registers the governed message flow and does not claim that the target has read or acted on the message.

The current closure contract, including `return_policy=silent`, local Codex inbox delivery, and control-loop exact runtime drains, is maintained in [message-flow-closure.md](message-flow-closure.md).

## Agent Registry Routing

Every cat-system agent instance must be registered in `runtime_agents`; the registry is the workflow scheduler's source of truth for platform, execution adapter, IM ingress, workflow ingress, readiness, audit, and rollback decisions. The formal routing contract is maintained in [agent-registry-routing.md](agent-registry-routing.md).

`agent_id` is a stable cat-system identity. It is not an execution location. The registry must declare:

- `platform`: actual execution platform, for example `openclaw`, `hermers`, or another registered platform.
- `execution_adapter`: execution mechanism, for example `native`, `acp`, `api`, `webhook`, `queue`, or `route_shell`.
- `im_ingress_owner`: IM owner, for example `openclaw_gateway`, `external_platform`, or `none`.
- `im_ingress_adapter`: IM entry mechanism, for example `openclaw_native`, `openclaw_route_shell`, `platform_im`, or `custom`.
- `workflow_ingress_adapter`: workflow dispatch mechanism, for example `openclaw_native`, `acp`, `api`, `webhook`, `queue`, or `route_shell`.
- `can_receive_dispatch`, `can_start_workflow`, and `gateway_proxy_allowed`: policy gates that must be checked before dispatch.

Hermers is the platform. ACP is the adapter/mechanism. A migrated professional cat agent should be registered as `platform=hermers` and `workflow_ingress_adapter=acp`, not as a separate platform.

Example Hermers ACP instance with OpenClaw Gateway route-shell IM ingress:

```text
platform=hermers agent=cat_body executionAdapter=acp imIngressOwner=openclaw_gateway imIngressAdapter=openclaw_route_shell workflowIngressAdapter=acp endpointRef=hermers-profile:catbody
platform=hermers agent=cat_heart executionAdapter=acp imIngressOwner=openclaw_gateway imIngressAdapter=openclaw_route_shell workflowIngressAdapter=acp endpointRef=hermers-profile:catheart
```

The bridge drains queued workflow dispatches for `platform=hermers` by calling the official ACP backend, default `acpx`, with persistent ACP sessions. In a standalone worker process, the bridge resolves the OpenClaw ACP SDK from controlled package roots and starts the official `@openclaw/acpx` runtime service when the backend is not already registered. Every dispatch, runtime run, ingest, and transcript entry carries an ISO timestamp. Dispatches can also carry `workflow_id`, `trace_id`, `idempotency_key`, `attempt`, `max_attempts`, `failure_type`, `sent_at`, `acked_at`, and `completed_at` so long-running agent work can be resumed and audited.

`workflow_ingress_adapter=acp` is strict. If the ACP backend is unavailable in the worker process, the dispatch fails closed with `failure_type=acp_unavailable`; it does not silently fall back to the Hermers CLI. The CLI path is a separate explicit adapter, `workflow_ingress_adapter=cli`, and should be used only for reviewed fallback or recovery.

Ingress classes:

- A: IM ingress is OpenClaw Gateway and execution is OpenClaw: `platform=openclaw`, `execution_adapter=native`, `im_ingress_adapter=openclaw_native`.
- B: IM ingress is OpenClaw Gateway and execution is outside OpenClaw: true platform plus `im_ingress_adapter=openclaw_route_shell`; the shell is an ingress/audit anchor, not an executor.
- C: IM ingress and execution are outside OpenClaw Gateway: register the external platform and its workflow adapter; cross-agent communication still goes through `trading-agents-workflow`.

## Route-Shell Physical Forwarding

Route-shell forwarding must be a Gateway pre-dispatch routing action, not an agent prompt convention. When `routeShell.enabled=true`, the plugin registers a `before_dispatch` hook. If any inbound Gateway message is already targeted at a configured `openclaw_route_shell` agent session, the hook:

- extracts the route-shell agent id from the OpenClaw session key, for example `agent:cat_ears:telegram:...`;
- resolves the target through `runtime_agents` by `agent_id`, `platform`, `im_ingress_owner`, `im_ingress_adapter`, and `workflow_ingress_adapter`;
- creates a `message_flows` record with source channel, account, chat, sender, source message id, IM identity, execution identity, and return policy;
- records a `route_shell_ingress` message with timestamp and source metadata;
- creates a durable `route_shell_forward` dispatch to the same agent's registered target platform and workflow ingress adapter;
- returns `handled=true` so OpenClaw does not run the route-shell agent model;
- by default stays silent on successful routing; if `ack=true`, replies only with minimal `ROUTE_REGISTERED`, `trace_id`, and `flow_id`.

This is fail-closed by default. If the registered Gateway ingress row, dispatch-capable target row, or required return path is missing, the hook handles the message and returns `ROUTE_FAILED`; it does not fall back to the OpenClaw route-shell agent. `drainNow` defaults to `false` because Gateway dispatch should not synchronously run external platform work. The 30s control loop should drain the queued dispatch.

For delivery-required non-OpenClaw replies, a route-shell acknowledgement is never a formal agent reply. The formal success condition is a completed message flow with `final_output_present=1` and `delivery_receipt_present=1`, normally with `message_flows.status=telegram_sent`. `dispatch.status=acked` means only that the runtime turn ended. For `requiresAck=true`, the first runtime turn closes only the receipt stage with `runtime_acknowledged`; workflow then queues a `message_flow_semantic` continuation on the same `flow_id`, and only that continuation can produce `runtime_completed` final output. `return_policy=silent` flows and local Codex inbox flows close on their runtime/inbox receipts and must not be treated as missing Telegram delivery.

The hook also applies in-process single-flight by route-shell agent, channel, and source message id. Concurrent provider retries for the same Telegram message wait on the same routing promise instead of creating a thundering herd against SQLite. SQLite unique idempotency still remains the durable backstop across process restarts.

The same rule applies to workflow and scripted dispatches. Calls to `meeting.dispatch` or workflow advancement that request `runtime=openclaw_route_shell` are rewritten at creation time into a dispatch for the agent's registered target platform and workflow ingress adapter. The route-shell dispatch is not inserted as executable work. If an older queued `openclaw_route_shell` dispatch already exists, `runtime.bridge.drain runtime=openclaw_route_shell` redirects it to the registered target and marks the original row as redirected/cancelled for audit. Route-shell is therefore an IM/Gateway identity and audit anchor, not an execution target.

Configuration example:

```json
{
  "routeShell": {
    "enabled": true,
    "agentIds": ["*"],
    "channels": ["*"],
    "priority": "normal",
    "drainNow": false,
    "ack": false,
    "blockOnFailure": true
  }
}
```

For strict idempotency, set `requireProviderMessageId=true` after OpenClaw exposes provider message ids to `before_dispatch`. Until then the hook uses the provider id when present, otherwise a synthetic fingerprint from channel, session, conversation, sender, timestamp, and content. The synthetic fallback prevents common provider retries from duplicating dispatches, but provider message ids are the preferred long-term route key for trading-grade determinism.

Manual recovery or smoke test:

```bash
node bin/cat-meeting-governance.mjs route-shell-ingest \
  --agent cat_ears \
  --text "check route shell" \
  --message-id smoke-telegram-message-1 \
  --source telegram \
  --root "$ROOT"
```

## Stability Governance

`trading-agents-workflow` is the cat-system workflow stability control surface. It does not replace OpenClaw Gateway; it records and governs the workflow state that Gateway routes.

Minimum operational contracts:

- `meeting.dispatch` should receive a stable `traceId` and, for dedupe-sensitive work, an `idempotencyKey`.
- Runtime bridge failures are classified into failure types such as `runtime_timeout`, `acp_unavailable`, `auth_unavailable`, `schema_validation`, `guardrail_block`, `stale_input`, and `transient_runtime`.
- Only transient runtime/provider classes are eligible for automatic retry, bounded by `maxAttempts` and `next_retry_at`.
- `runtime_runs` is the queryable ledger for Hermers/ACP turns; `runtime_runs.jsonl` remains a compatibility audit stream.
- `workflow.readiness` records a readiness snapshot across orchestration, runtime, communication, data, and Human Gate planes. Process liveness is not treated as trading readiness.
- `workflow.readiness` is passive by default. With `activeChecks=true`, it also probes OpenClaw Gateway health, Hermers profile `acp --check`, and the ACP backend without running a model turn.
- `side_effect.record` exists for file writes, memory writes, external notification, trading-core handoff, or any action that must not be blindly retried.
- `incident.state` records active incident state with affected planes, current mode, timeline, mitigation, rollback options, and exit criteria; it writes both JSON and Markdown artifacts under `bridge/incidents/`.

## Active State Root

The workflow state root must be configured explicitly. The current development-server state root is:

```text
/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/
  tracking.db
  meetings/
  commands/
  events/
  states/
  action_items/
  decisions/
  minutes/
  notifications/
  thesis/
    stock/
    futures/
    crypto/
  radar/
  evidence/
  memos/
  gates/
  protocol/
  intents/
  receipts/
  bridge/
    dispatches/
    messages/
    telegram/
    human_gates/
  workflows/
  human-gates/
    inbox/
  artifacts/
  templates/
  index/
```

The retired legacy root `/home/flashcat/.openclaw/shared/trading-agents-workflow/` is fail-closed by default and must not be recreated as an operational state directory.

## SQLite Role

SQLite stores control-plane state and queryable indexes:

- `instruments`
- `tracking_states`
- `radar_scores`
- `thesis_index`
- `evidence_items`
- `research_memos`
- `review_gates`
- `workflow_runs`
- `workflow_tasks`
- `workflow_task_dependencies`
- `workflow_checkpoints`
- `artifact_index`
- `protocol_objects`
- `executable_trade_intents`
- `trading_core_receipts`
- `side_effect_ledger`
- `runtime_agents`
- `mixed_meeting_participants`
- `mixed_meeting_messages`
- `mixed_meeting_dispatches`
- `runtime_runs`
- `telegram_live_links`
- `telegram_outbox`
- `human_gate_batches`
- `human_gate_batch_items`
- `meeting_control_events`
- `incident_states`
- `readiness_snapshots`

Markdown remains the source for human-readable reasoning:

- thesis cards
- evidence packs
- research memos
- meeting minutes
- audit reports

## Primary Tool

OpenClaw tool:

```text
trading_agents_workflow
```

OpenClaw CLI:

```text
openclaw trading-agents-workflow ...
```

Standalone smoke CLI:

```text
node bin/cat-meeting-governance.mjs ...
```

## OpenClaw Gateway Configuration

The OpenClaw plugin manifest is the source of truth for tool contracts. Keep
`openclaw.plugin.json` declaring:

```json
{
  "contracts": {
    "tools": ["trading_agents_workflow"]
  }
}
```

The Gateway tool policy must also expose the tool to agent turns. When the root
config uses a restrictive profile such as `tools.profile: "coding"`, add the
tool name to `tools.alsoAllow` while keeping the plugin id in `plugins.allow`:

```json
{
  "plugins": {
    "allow": ["trading-agents-workflow"],
    "entries": {
      "trading-agents-workflow": {
        "enabled": true,
        "config": {
          "rootDir": "/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow"
        }
      }
    },
    "load": {
      "paths": ["/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout"]
    }
  },
  "tools": {
    "profile": "coding",
    "alsoAllow": ["trading_agents_workflow"]
  }
}
```

After changing plugin source, plugin load paths, or tool policy, validate config
and reload or restart the actual Gateway process. A route-shell smoke test should
show `trading_agents_workflow` in the agent tool list before mixed-runtime
dispatches are considered ready.

## Actions

Workflow and tracking:

- `workflow.init`
- `workflow.status`
- `workflow.run.upsert`
- `workflow.initiative.upsert`
- `workflow.swarm.plan`
- `workflow.task.create`
- `workflow.task.update`
- `workflow.task.list`
- `workflow.tasks`
- `workflow.advance`
- `workflow.advance.preview`
- `workflow.supervise`
- `workflow.supervise.preview`
- `workflow.checkpoint`
- `workflow.context_checkpoint`
- `context.checkpoint`
- `workflow.readiness`
- `workflow.topology`
- `protocol.record`
- `runtime.agent.upsert`
- `meeting.runtime_participant`
- `telegram.live`
- `meeting.dispatch`
- `meeting.ingest`
- `human_gate.request`
- `human_gate.inbox`
- `human_gate.console`
- `human_gate.button_callback`
- `human_gate.batch_inbox`
- `meeting.resume`
- `meeting.disperse`
- `telegram.outbox`
- `instrument.upsert`
- `radar.update`
- `thesis.create`
- `thesis.update`
- `research.evidence`
- `research.memo`
- `trade.proposal`
- `risk.decision`
- `trade.intent`
- `trading_core.receipt`
- `side_effect.record`
- `incident.state`
- `gate.review`
- `cat_claw.audit`

## Workflow Task Pool

Use `workflow.run.upsert` for durable goals that outlive one meeting. A run should declare the objective, acceptance criteria, stop condition, and current phase so cat-brain `main` can keep pushing the workflow instead of only reporting that a discussion happened.

Use `workflow.swarm.plan` when a goal benefits from Kimi-style swarm execution: split one objective into bounded shards, assign each shard across a worker pool, and create a reducer task that depends on all shard tasks. This gives cat-brain `main` a governed fan-out/fan-in primitive while preserving cat-system role boundaries.

Important boundaries:

- Shards are durable `workflow_tasks`, not unmanaged sub-agent sessions.
- Worker assignment must still use registered platforms, workflow ingress adapters, and agent ids.
- The reducer task synthesizes evidence, gaps, disagreement, and next action; it does not bypass Cat Heart, Cat Claw, or Human Gate.
- Fan-out is capped by `fanoutLimit` and defaults to the explicit shard count, not unbounded spawning.

CLI example:

```bash
node bin/cat-meeting-governance.mjs workflow-swarm \
  --workflow stock-tracking-upgrade \
  --objective "完善股票长期追踪制度和散户活跃度分析" \
  --target "基本面制度" \
  --target "消息面制度" \
  --target "情绪与散户活跃度" \
  --worker hermers:cat_eyes \
  --worker hermers:cat_ears \
  --worker hermers:cat_nose \
  --reducer openclaw:main \
  --root "$ROOT"
```

Use `workflow.task.create` to turn the next phase into concrete tasks. Each task should name the owner agent, registered platform or target agent, priority, dependencies, expected artifact, receipt requirement, and whether a Human Gate is required before the task can be treated as complete.

`meeting.action_item` also mirrors new or updated action items into `workflow_tasks` by default. This keeps the meeting secretary surface and the durable workflow task board aligned. The only valid Cat Claw id is `cat_claw`; the retired id `catclaw` is rejected instead of silently normalized. Comma-separated owners are split into separate workflow tasks; their platform is resolved from the registry when dispatch is created. Set `promoteToWorkflowTask=false` only for purely clerical notes that should stay out of workflow execution.

Use `workflow.advance` after a discussion, dispatch batch, receipt collection cycle, or artifact review. It returns a structured decision:

- `needs_planning`: no actionable task exists yet.
- `dispatch_ready`: pending tasks are unblocked and can be dispatched.
- `receipts_collecting`: work is in progress or finished tasks still need receipts/artifacts.
- `cat_claw_summary_required`: all required work is done and `cat_claw` should package the conclusion or next Human Gate.
- `human_gate_pending`: a confirmation gate blocks continuation.
- `blocked`: no task can advance without intervention.
- `completed`: the run meets its stated acceptance or explicit completion condition.

With `autoDispatch=true`, `workflow.advance` records `meeting.dispatch` rows for ready tasks and moves them to `in_progress`. It does not bypass Gateway, runtime registry, receipt tracking, or Human Gate review.

Use `workflow.advance.preview` when a UI, console, or operator needs the same next-decision calculation without mutating state. Preview is read-only: it does not sync task rows from terminal dispatches, update `workflow_runs`, create dispatches, move tasks to `in_progress`, write checkpoints, or send outbox messages. When dispatch sync is enabled, it returns `wouldSyncTasks`; when `autoDispatch=true`, it returns `wouldDispatch`.

Use `workflow.supervise` as the normal wanman-style control loop for durable initiatives. One supervisor cycle does the operational work that `workflow.advance` alone cannot:

- sync completed or failed runtime dispatches back into `workflow_tasks`
- run `workflow.advance` and optionally create ready dispatches
- optionally drain runtime bridge queues for the runtimes touched in that cycle
- write a compact checkpoint for session overflow recovery
- when the run is blocked, waiting on Human Gate, or ready for close-out, create a `cat_claw` report dispatch so the secretary agent submits a next-action package to Flashcat

`workflow.supervise` keeps Flashcat in the observer/approval role. Cat-brain `main` still owns decomposition and orchestration; `cat_claw` still owns formal reporting and Human Gate intake. The supervisor does not make trading decisions, bypass Gateway, bypass Human Gate, or execute trades.

Use `workflow.supervise.preview` for console planning. It wraps `workflow.advance.preview` and reports whether a real supervise cycle would checkpoint, drain runtimes, or create a Cat Claw report dispatch, but it does not execute any of those writes. It is the safe action for web-console "preview advance/supervise" buttons.

CLI example:

```bash
node bin/cat-meeting-governance.mjs workflow-supervise --workflow demo-initiative --meeting demo-initiative --auto-dispatch --root "$ROOT"
node bin/cat-meeting-governance.mjs workflow-supervise-preview --workflow demo-initiative --meeting demo-initiative --root "$ROOT"
```

Use `workflow.control_loop.tick` as the plugin-internal 30s reconciler tick. The tick period is a scheduling cadence, not a promise that all workflow work finishes inside 30 seconds. Each tick records readiness, seeds durable `control_loop_jobs`, claims a bounded number of jobs, executes those jobs, and leaves unfinished work queued for later ticks. Queue jobs cover due workflow schedules, workflow supervision, stale dispatch reconciliation, stuck `message_flow` incident reconciliation, runtime drain, pending Human Gate request/button/outbox ensure, Telegram outbox delivery, and Human Gate inbox batch creation. Phase progress is written to `bridge/control-loop-events.jsonl`; tick summaries go to `bridge/control-loop.jsonl`. A file lease at `bridge/control-loop-lease.json` prevents overlapping ticks, while each queue job has its own DB lease, retry, and attempt state.

Workflow-native schedules are stored in `workflow_schedules`; each due tick writes a `scheduled_runs` row and queues one `scheduled_dispatch` job. The schedule layer does not execute agent work inline. It calls `meeting.dispatch` with a deterministic idempotency key, and normal `runtime_drain` later invokes the registered runtime, such as `platform=hermers` plus `workflow_ingress_adapter=acp`. This is the replacement path for OpenClaw cron driving migrated professional agents through prompt-based route-shell forwarding.

The OpenClaw plugin can run this loop when `controlLoop.enabled=true` in plugin config or `TRADING_AGENTS_WORKFLOW_CONTROL_LOOP=1` is set. The recommended tick period is `30000` ms. Startup does not run an immediate tick by default; set `controlLoop.startupTick=true` only after Gateway startup load is known to be safe. The default `controlLoop.workerMode` is `process`, so the plugin launches a bounded Node worker process for each tick instead of running jobs inside the Gateway event loop. Defaults are conservative: `jobLimit=4`, `runtimeLimit=1`, `timeoutSeconds=45`, `tickBudgetMs=60000`, and `autoReport=false`; the development server uses `timeoutSeconds=30` for the ACK/control-loop operating contract. Runtime drain defaults to `openclaw_route_shell,hermers`: route-shell rows are redirected by registry, while professional work registered on Hermers drains through ACP. Add `openclaw` only as an explicit, reviewed exception because it calls back into the Gateway process. The targeted OpenClaw `message_flow_send` / `message_flow_semantic` drain is that reviewed exception: it excludes those rows from the generic OpenClaw drain, claims one exact dispatch, and uses the semantic message-flow timeout.

Idle workflow supervision must be rate-limited. `blocked` and `waiting_human` workflows are not allowed to create and complete a new `workflow_supervise` job on every tick when no new evidence exists. The plugin supports `controlLoop.idleWorkflowSuperviseCooldownMs` / `blockedWorkflowSuperviseCooldownMs` for those states and `workflowSuperviseCooldownMs` for a general completed-job cooldown. The default idle cooldown is 5 minutes; `flashLane` workflows bypass this idle cooldown but still obey receipt, expiry, risk, and Human Gate rules. See [gateway-memory-control-loop-incident-2026-05-28.md](gateway-memory-control-loop-incident-2026-05-28.md) for the maintenance incident that established this guardrail.

Timeouts are layered. `tickMs` is only cadence. `timeoutSeconds` bounds ordinary runtime dispatch work. OpenClaw message-flow semantic drains are allowed up to 300 seconds because the first ACK turn and the final semantic turn are separate workflow stages. `tickBudgetMs` is the ordinary per-worker budget, while the process worker kill timer also covers the semantic message-flow drain budget when queued drains are enabled. `jobLeaseMs` is the queue lease and is automatically raised to at least `max(tickBudgetMs + 30000, (timeoutSeconds + 30) * 1000)` for ordinary jobs and to the claimed job payload timeout for targeted runtime drains, so a long but valid job should not be re-claimed while its worker can still be alive. If a worker crashes or is killed, the job becomes claimable again only after its lease expires.

Use `workflow.control_loop.job.requeue.preview` before manually recovering a failed queue job or an expired `running` lease. The preview is read-only and reports whether the selected `jobId` is eligible, whether another active row already owns the same `dedupe_key`, and what the requeue write would change. If eligible, `workflow.control_loop.job.requeue` can move only that `control_loop_jobs` row back to `queued`, clear the stale lease/error fields, preserve the old error in redacted `payload_json.requeueHistory`, and write one workflow event. It does not run the job, dispatch agents, deliver Telegram, resume Human Gate, or touch trading state. Always pass `operatorReason` / `requeueOperatorReason`.

Stale dispatch reconciliation is mechanical: a `sent` dispatch older than the safe window is synced to a terminal runtime receipt when one exists; otherwise it is marked `failed/runtime_stale` or requeued only if `max_attempts` still allows retry. This prevents readiness from staying critical on dead `sent` rows without pretending the underlying runtime work succeeded.

Stuck `message_flow` reconciliation is also mechanical. If a delivery-required non-OpenClaw flow has `final_output_present=1`, `runtime_completed_at` is older than `controlLoop.messageFlowStuckAfterMs` (default 5 minutes), and `delivery_receipt_present=0`, the control loop queues `message_flow_reconcile`. The job records an `incident_states` row and a `message_flow_events` entry instead of silently accepting dispatch ack as success. `return_policy=silent` flows and local Codex inbox flows with `local_codex_inbox_received` do not require Telegram delivery receipts. Telegram outbox delivery remains a separate queued job.

Pending Human Gate requests are also re-ensured mechanically. If a pending Human Gate already has a `sent` Telegram outbox but no button callback arrives after the resend window, the same outbox is requeued for delivery and the previous delivery receipt is retained in payload history. The Human Gate record and button ids are not recreated, so Flashcat still acts on one durable decision object.

The queue reserves a `flash` priority above `steer` for future trading-execution workflows. This is only a scheduling inlet for later real-trading rules; it does not execute trades, bypass risk controls, or weaken Human Gate. Flash-lane work must still use structured workflow state, idempotency, expiry, receipts, and button-first Human Gate.

Cat Claw `cat_claw` is an OpenClaw secretary/Human Gate agent, not a Hermers profile. The control loop may drain migrated professional agents through `platform=hermers` plus `workflow_ingress_adapter=acp`, ensure that already-pending Human Gate records have buttons and outbox delivery, and deliver queued Human Gate requests. It must not create or execute Cat Claw long semantic closeout reports unless `autoReport=true` is explicitly set for a reviewed recovery run. Cat Claw closeout reports use `reportRuntime=openclaw` and `reportAgent=cat_claw`. Do not dispatch Cat Claw to Hermers unless a real Hermers profile has been created and registered.

- Cat-brain `main` 30min heartbeat checks institutional compliance and evidence completeness.
- Cat Claw `cat_claw` 30min heartbeat audits whether Human Gate delivery, buttons, callback, and resume closed correctly.
- The 30s loop is the timely queue driver for structured workflow state; 30min heartbeat is not the primary Human Gate trigger.

CLI example:

```bash
node bin/cat-meeting-governance.mjs workflow-control-loop-tick \
  --tick-ms 30000 \
  --max-workflows 2 \
  --runtime openclaw_route_shell,hermers \
  --limit 1 \
  --root "$ROOT"
```

Schedule example:

```bash
node bin/cat-meeting-governance.mjs workflow-schedule-upsert \
  --id cat-nose-heartbeat \
  --agent cat_nose \
  --runtime hermers \
  --kind cron \
  --cron "*/30 * * * *" \
  --prompt "Run the registered heartbeat check and report receipt through the workflow channel." \
  --root "$ROOT"
```

When a `workflow_secretary_report` or `human_gate_report` runtime message is acked but does not prove IM delivery, `meeting.ingest` automatically creates a private Telegram outbox item for Flashcat. `runtime-bridge` auto-delivers that report outbox by default and returns `reportDelivery` with the Telegram receipts. This keeps Cat Claw closeout inside the plugin body instead of relying on Codex to manually send queued reports.

Manual delivery remains available as a recovery command:

```bash
node bin/cat-meeting-governance.mjs telegram-outbox --deliver --account cat_claw --target 8390724843 --root "$ROOT"
```

This makes Cat Claw reporting two-phase but self-contained: runtime report produced, then IM delivery receipt recorded. Workflow completion should not assume Flashcat received a Human Gate package until the outbox row is `sent`.

When `workflow.supervise --drain` creates a Cat Claw closeout dispatch, it drains that exact dispatch and lets `runtime-bridge` deliver the report outbox. If delivery fails, the report dispatch can still be `acked`, but the returned `reportDelivery.status` and `telegram_outbox.status` must be treated as the communication-plane truth.

Use `human_gate.inbox` or its secretary-facing alias `human_gate.console` when Flashcat would otherwise receive many one-off Cat Claw requests. It gathers pending `human_gate_record` objects, Human-Gate review gates, gated workflow tasks, and queued or failed Cat Claw Telegram report deliveries into one batch. The output is a queryable `human_gate_batches` row, `human_gate_batch_items`, and paired HTML/JSON artifacts under `human-gates/inbox/`.

The inbox is the Flashcat/Cat Claw operation console surface. P0/P1 items are marked for individual review; lower-risk P2/P3 items can be grouped after a quick scan. If a pending Human Gate has recorded button choices, the console renders those buttons with the exact `tawhg:<token>`, tool action, and CLI callback command. Generating the console does not auto-approve work, execute trades, bypass Cat Brain, or replace a deliberate button callback / `human_gate.resume`.

CLI example:

```bash
node bin/cat-meeting-governance.mjs human-gate-inbox \
  --workflow demo-initiative \
  --batch demo-inbox \
  --title "Demo Human Gate Inbox" \
  --root "$ROOT"
```

Console alias:

```bash
node bin/cat-meeting-governance.mjs human-gate-console \
  --workflow demo-initiative \
  --batch demo-console \
  --title "Flashcat Human Gate Console" \
  --root "$ROOT"
```

`human_gate.request` must create a deliverable request, not a targetless queue item. If no meeting live channel is configured, it falls back to Flashcat's private Telegram chat `8390724843` through the `cat_claw` account. It honors explicit `target`, `targetRef`, `chatId`, or the first `notifyTargets` entry before falling back. The returned `targetRef`, `deliveryAccount`, `telegramOutbox.status`, and optional `delivery.status` are part of the contract; Cat Claw must not treat a request as delivered until a receipt exists or the direct Telegram reply itself is the acknowledged delivery path.

Every Human Gate package submitted to Flashcat must contain at least three independently approvable alternatives: plan A, plan B, and plan C. The formal Telegram-facing report body must be Chinese, including each option title, option content, next action / execution boundary, evidence / receipt summary, artifact reference, and rollback / stop condition. Technical names, agent ids, and artifact paths may remain in their original spelling. Cat-brain `main` owns generating the plan content and must self-check that the alternatives are present, mutually exclusive enough to choose between, evidence-backed, executable, and Chinese before handing the package to Cat Claw. Cat Claw audits this structure; it does not invent missing plan content. If a pending Human Gate lacks A/B/C alternatives or Chinese plan details, the plugin blocks Telegram delivery and dispatches the evidence package back to `main` for revision.

For trading workflows, a Flashcat approval only authorizes the next step declared in the selected option. If the option prepares an order intent, the required next step is `openclaw:cat_tail` with `dispatch_type=pre_order_risk_audit`. Cat Tail is the only recipient of that Human Gate approved trading evidence package; ordinary Human Gate approvals do not route to Cat Tail. Cat Tail must produce a Chinese risk paper plus structured `risk_decision` before workflow may create an `executable_trade_intent` for `trading_core`.

Cat Claw should provide the approved alternatives as `buttons`, `options`, `alternatives`, or `plans`. The plugin stores each button in `human_gate_buttons`, renders the same choices in the Human Gate console, and creates one token-bound Telegram Web App review URL per button when `humanGate.webAppBaseUrl` is configured. Telegram button coloring on the OpenClaw presentation path must use `style` (`primary`, `success`, or `danger`) so the entire button is styled; color-square emoji in labels are not an acceptable substitute. Fixed Human Gate styles are: plan A/B/C/D option buttons use `success`; reject/return buttons use `danger`; pause workflow uses `primary`; terminate workflow uses `danger`. Telegram has no separate yellow style in this three-style surface, so pause uses `primary`. The plugin appends control buttons for "退回补证/修改", "暂停工作流", and "终止工作流". "终止工作流" means Flashcat considers the work complete and reviewed, so the workflow is archived with a checkpoint and closeout dispatches to `main` and `cat_claw`; it remains resumable later by workflow id/checkpoint.

The primary Human Gate Telegram path is now a Web App form. Each option button opens `/plugins/trading-agents-workflow/human-gate/review?token=<callbackToken>`, displays the exact workflow / Human Gate / button details, and requires Flashcat to fill "闪电猫原话或审核意见". Clicking "发送并完成 Human Gate" submits the same token and text to `human_gate.web_app_submit`; only then does the workflow record the final Human Gate status, save `flashcatOriginalWords` in the button row, Human Gate record, workflow payload, meeting resume payload, and next dispatch payload, and resume/close the workflow from the selected boundary. This makes multiple concurrent Human Gates unambiguous because the button token and the original words are submitted in one bound operation.

Set plugin config `humanGate.webAppBaseUrl` to the public HTTPS prefix that reaches the registered route, for example `https://example.com/plugins/trading-agents-workflow/human-gate`. The route path defaults to `/plugins/trading-agents-workflow/human-gate` and can be overridden with `humanGate.webAppRoutePath`. `humanGate.verifyTelegramInitData` supports `if_present` (default) or `required`; `allowedTelegramUserIds` defaults to Flashcat's private Telegram id `8390724843`. If Web App delivery cannot be used, the plugin retains the token-bound fallback: a normal callback button can move to `feedback_pending`, and only `/hgate tawhg:<token> 这里写闪电猫原话或审核意见` or `human_gate.feedback` with the same token is accepted. Bare `/hgate <text>` is rejected because it cannot be safely matched when multiple Human Gate requests are pending.

CLI example:

```bash
node bin/cat-meeting-governance.mjs human-gate-request \
  --meeting demo-initiative \
  --text "选择下一步推进方案" \
  --button '{"label":"A 只迁 heartbeat","status":"approved","summary":"Approve A"}' \
  --button '{"label":"B heartbeat + professional cron","status":"approved","summary":"Approve B"}' \
  --button '{"label":"C 同波纳入 Realtime/Data bridge-systemd","status":"approved","summary":"Approve C"}' \
  --target 8390724843 \
  --from cat_claw \
  --root "$ROOT"
```

If Flashcat selects from the operation console instead of Telegram, use the copied callback command:

```bash
node bin/cat-meeting-governance.mjs human-gate-callback \
  --token CALLBACK_TOKEN \
  --actor flashcat \
  --root "$ROOT"
```

After Flashcat confirms, rejects, or selects an option for a Human Gate, record the decision with `human_gate.resume`. This is mandatory for Cat Claw when the confirmation arrives in Flashcat's private Telegram chat. A chat acknowledgement is not enough. The resume action writes the Human Gate record, appends a meeting resume event, and creates a `human_gate_resume` dispatch back to cat-brain `main` so the next workflow round can continue from the confirmed boundary:

```bash
node bin/cat-meeting-governance.mjs human-gate-resume \
  --token CALLBACK_TOKEN \
  --human-gate-id HUMAN_GATE_ID \
  --button-id BUTTON_ID \
  --workflow demo-initiative \
  --meeting demo-initiative \
  --text "闪电猫原话：批准 B 方案，继续 dry-run manifest phase" \
  --root "$ROOT"
```

Cat Claw must preserve the original confirmation timestamp, source channel, button id, Human Gate id, and Flashcat text in the resume text or payload, then verify the generated dispatch id or retry job. If `human_gate.resume` is not available in the current session, Cat Claw must report `human_gate_resume_blocked` with the missing tool or runtime reason instead of treating the decision as complete.

## Workflow Checkpoints

Use `workflow.checkpoint` whenever a workflow phase ends, context approaches the compaction threshold, a Human Gate package is submitted, or a new session needs to continue prior work. The checkpoint is the durable recovery package for cat-brain `main`; it keeps the session small by storing only the minimum resumable state plus artifact references.

Checkpoint contents:

- objective, acceptance criteria, stop condition, status, phase, and decision
- active task ids, blocked task ids, task counts, and pending Human Gate count
- artifact references from `artifact_index` and completed task artifacts
- next action candidates
- context budget policy, defaulting to restore from checkpoint plus referenced artifacts only

The checkpoint writes JSON and Markdown under `workflows/checkpoints/`, stores a queryable row in `workflow_checkpoints`, and indexes the Markdown file as a `workflow_checkpoint` artifact.

### Telegram Live Targets

`telegram.live` requires a concrete `chatId` or `channelId` for active non-silent meetings. It refuses to create an active transparent live link with an empty target, because that leaves meeting messages in an undeliverable outbox while making agents think the meeting is live.

Targets can be supplied directly with `chatId` / `channelId`, through CLI flags such as `--chat`, `--channel`, `--target`, or `--target-name`, or by placing `telegram-targets.json` in the workflow root:

```json
{
  "aliases": {
    "stock-tracking": { "chatId": "-1000000000000" },
    "股票追踪": { "chatId": "-1000000000000" }
  },
  "meetingPatterns": [
    { "pattern": "stock-tracking", "chatId": "-1000000000000" }
  ]
}
```

If a legacy live link has no target, `meeting.ingest` marks the message as `failed_missing_target` instead of enqueueing a targetless Telegram outbox row.

## Stability CLI Examples

Passive readiness:

```bash
node bin/cat-meeting-governance.mjs workflow-readiness --root "$ROOT"
```

Active readiness without model turns:

```bash
node bin/cat-meeting-governance.mjs workflow-readiness --active-checks --root "$ROOT"
```

Incident state:

```bash
node bin/cat-meeting-governance.mjs incident-state --incident incident-demo --status active --mode degraded --plane runtime --summary "Hermers ACP checks degraded" --exit-criteria "all active checks ready for 30m" --root "$ROOT"
```

Meeting module:

- `meeting.create`
- `meeting.append`
- `meeting.command`
- `meeting.summary`
- `meeting.close`
- `meeting.handoff`
- `meeting.artifact`
- `meeting.state`
- `meeting.action_item`
- `meeting.decision`
- `meeting.minutes`
- `meeting.notify`
- `meeting.index`
- `meeting.validate`
- `telegram.bridge`

## Smoke Test

```bash
ROOT=/tmp/trading-agents-workflow-v05

node bin/cat-meeting-governance.mjs workflow-status --root "$ROOT"
node bin/cat-meeting-governance.mjs workflow-topology --root "$ROOT"
node bin/cat-meeting-governance.mjs instrument --asset stock --symbol 000001.SZ --name "Ping An Bank" --tag sample --root "$ROOT"
node bin/cat-meeting-governance.mjs radar-update --asset stock --symbol 000001.SZ --zone bright --retail 72 --news 65 --fundamental 61 --summary "three-face demo" --root "$ROOT"
node bin/cat-meeting-governance.mjs thesis-update --asset stock --symbol 000001.SZ --title "Demo thesis" --summary "Long-term tracking demo" --falsification "credit quality worsens" --root "$ROOT"
node bin/cat-meeting-governance.mjs evidence --asset stock --symbol 000001.SZ --kind filing --source "demo" --reliability A --summary "sample evidence" --root "$ROOT"
node bin/cat-meeting-governance.mjs research-memo --asset stock --symbol 000001.SZ --title "Demo memo" --summary "sample memo" --conclusion "continue tracking" --root "$ROOT"
node bin/cat-meeting-governance.mjs gate-review --asset stock --symbol 000001.SZ --gate risk_gate --status pending --summary "risk review required" --human-gate --root "$ROOT"
node bin/cat-meeting-governance.mjs cat_claw-audit --root "$ROOT"

node bin/cat-meeting-governance.mjs workflow-run --workflow demo-initiative --objective "Improve long-term stock tracking" --acceptance-criteria "next action package exists" --stop-condition "Flashcat accepts or blocks" --phase planning --root "$ROOT"
node bin/cat-meeting-governance.mjs workflow-task --workflow demo-initiative --task demo-task-001 --owner main --runtime openclaw --agent main --summary "Create next phase plan" --expected-artifact "workflow artifact or minutes path" --root "$ROOT"
node bin/cat-meeting-governance.mjs workflow-advance --workflow demo-initiative --root "$ROOT"
node bin/cat-meeting-governance.mjs workflow-checkpoint --workflow demo-initiative --summary "Context recovery checkpoint" --next-action "continue active tasks" --root "$ROOT"

node bin/cat-meeting-governance.mjs runtime-agent --runtime openclaw --platform openclaw --agent cat_tail --execution-adapter native --im-ingress-owner openclaw_gateway --im-ingress-adapter openclaw_native --workflow-ingress-adapter openclaw_native --role pre_order_risk_audit_and_final_trading_risk_control --endpoint openclaw-agent:cat_tail --root "$ROOT"
PROPOSAL=$(node bin/cat-meeting-governance.mjs trade-proposal --asset stock --symbol 000001.SZ --summary "cat_heart proposal demo" --side buy --quantity 100 --root "$ROOT")
AUDIT_ID=demo-pre-order-risk-audit-001
RISK_ID=demo-risk-001
GATE=$(node bin/cat-meeting-governance.mjs human-gate-request \
  --workflow demo-initiative \
  --meeting demo-initiative \
  --trace-id demo-trace-001 \
  --parent "$(echo "$PROPOSAL" | jq -r .objectId)" \
  --payload "{\"proposalId\":\"$(echo "$PROPOSAL" | jq -r .objectId)\",\"dispatchType\":\"pre_order_risk_audit\",\"nextAgent\":\"cat_tail\",\"preOrderRiskAuditId\":\"$AUDIT_ID\"}" \
  --text "交易 Human Gate：请在 A/B/C 中选择是否进入猫之尾下单前风控审计。方案 A：进入猫之尾最终审计；方案 B：缩小仓位后进入猫之尾审计；方案 C：只保留 paper 观察并进入猫之尾审计。" \
  --button "{\"key\":\"A\",\"role\":\"option\",\"label\":\"A 进入猫之尾审计\",\"status\":\"approved\",\"summary\":\"批准进入猫之尾最终风控审计。\",\"prompt\":\"把批准后的交易证据包投递给 cat_tail 执行 pre_order_risk_audit。\",\"rollback\":\"如猫之尾拒绝，停止生成 executable_trade_intent。\",\"dispatchType\":\"pre_order_risk_audit\",\"nextAgent\":\"cat_tail\",\"proposalId\":\"$(echo "$PROPOSAL" | jq -r .objectId)\",\"preOrderRiskAuditId\":\"$AUDIT_ID\",\"evidenceRefs\":[\"artifact://demo/evidence-pack\"]}" \
  --button "{\"key\":\"B\",\"role\":\"option\",\"label\":\"B 缩小仓位再审计\",\"status\":\"approved\",\"summary\":\"批准缩小仓位后进入猫之尾最终风控审计。\",\"prompt\":\"按更小名义本金重整证据包后投递给 cat_tail。\",\"rollback\":\"如证据不足，退回猫之脑补证。\",\"dispatchType\":\"pre_order_risk_audit\",\"nextAgent\":\"cat_tail\",\"proposalId\":\"$(echo "$PROPOSAL" | jq -r .objectId)\",\"preOrderRiskAuditId\":\"$AUDIT_ID\",\"evidenceRefs\":[\"artifact://demo/evidence-pack\"]}" \
  --button "{\"key\":\"C\",\"role\":\"option\",\"label\":\"C 仅 paper 观察审计\",\"status\":\"approved\",\"summary\":\"批准只按 paper 观察模式进入猫之尾审计。\",\"prompt\":\"猫之尾只能批准 paper execution 或拒绝。\",\"rollback\":\"不得生成 live intent。\",\"dispatchType\":\"pre_order_risk_audit\",\"nextAgent\":\"cat_tail\",\"proposalId\":\"$(echo "$PROPOSAL" | jq -r .objectId)\",\"preOrderRiskAuditId\":\"$AUDIT_ID\",\"evidenceRefs\":[\"artifact://demo/evidence-pack\"]}" \
  --from cat_claw \
  --root "$ROOT")
GATE_ID=$(echo "$GATE" | jq -r .humanGateId)
TOKEN=$(echo "$GATE" | jq -r '.buttons[] | select(.label | contains("猫之尾")) | .callbackToken')
node bin/cat-meeting-governance.mjs human-gate-resume --token "$TOKEN" --text "闪电猫原话：批准 A，进入猫之尾最终风控审计。" --root "$ROOT"
# human-gate-resume creates the required openclaw:cat_tail pre_order_risk_audit dispatch.
# Cat Tail emits risk_decision=$RISK_ID and preOrderRiskAuditId=$AUDIT_ID before any trading_core intent is created.
node bin/cat-meeting-governance.mjs risk-decision --proposal "$(echo "$PROPOSAL" | jq -r .objectId)" --human-gate "$GATE_ID" --pre-order-risk-audit "$AUDIT_ID" --risk-decision-id "$RISK_ID" --status approved --reviewer cat_tail --dispatch-type pre_order_risk_audit --decision approved_for_paper_execution --risk-limits '{"maxNotionalUsd":20000,"maxLossUsd":500}' --evidence-ref artifact://demo/evidence-pack --paper-ref artifact://demo/cat-tail-risk-paper --root "$ROOT"
node bin/cat-meeting-governance.mjs trade-intent --asset stock --symbol 000001.SZ --side buy --quantity 100 --proposal "$(echo "$PROPOSAL" | jq -r .objectId)" --risk "$RISK_ID" --pre-order-risk-audit "$AUDIT_ID" --human-gate "$GATE_ID" --workflow-id demo-initiative --trace-id demo-trace-001 --actor flashcat --assurance mtls --cert demo-cert-fingerprint --source codex_mtls --idempotency-key demo-intent-001 --expires-at 2099-01-01T00:00:00.000Z --price-constraints '{"referencePrice":10,"limitPrice":10.5}' --risk-limits '{"maxNotionalUsd":20000,"maxLossUsd":500}' --root "$ROOT"
```
