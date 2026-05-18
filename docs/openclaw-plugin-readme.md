# trading-agents-workflow

OpenClaw native workflow layer for the cat-system trading agents.

Target architecture:

- OpenClaw Gateway remains the information-flow and workflow hub.
- `trading-agents-workflow` is the cat-system trading workflow scheduler.
- Hermes is the agent runtime container.
- ACP is the standard invocation channel for Hermes agents.

v0.6 upgrades the old meeting-only plugin into a unified trading workflow substrate:

- SQLite tracking state for stocks, futures, crypto, ETFs, indexes, commodities, and other instruments
- Markdown artifacts for thesis, evidence packs, research memos, gates, and meeting minutes
- Meeting workflow as one module inside the larger trading agents workflow
- Catclaw secretary audit for stale thesis, missing three-face inputs, and pending gates
- Protocol objects for research signals, evidence packs, trade proposals, risk decisions, Human Gate records, executable intents, and trading_core receipts
- mTLS-gated executable trade intents for the local Codex path
- Mixed-runtime meeting bridge for OpenClaw and Hermes agents in one logical room
- `hermes_acp` runtime bridge for invoking Hermes profile agents through OpenClaw ACPX
- Telegram live outbox and Human Gate request loop for Flashcat confirmation
- Stability governance fields for durable dispatches, trace correlation, idempotency, retry taxonomy, readiness snapshots, side-effect ledger, runtime run records, and incident state documents
- Workflow task pool for long-running initiatives, task dependencies, expected artifacts, and supervisor-style advance decisions
- Workflow checkpoints for session overflow recovery and compact next-action handoff

This is not an independent agent runtime, not a Gateway replacement, not a Hermes runtime, and not a live trading executor. It does not call trading_core or Telegram directly; it records reviewed intents, dispatch queues, transcripts, Telegram outbox entries, and later records trading_core receipts.

## Meeting Role Contract

Cat-brain `main` chairs meetings. It defines the topic, controls the room, orders turns, and may broadcast live progress to Telegram or another governed IM channel.

Cat-claw `cat_claw` is the meeting-system companion agent and secretariat. It listens, records minutes, consolidates the meeting conclusion, reports to Flashcat, and is the Human Gate intake for meeting outcomes. Formal meeting conclusions, confirmation requests, and Human Gate submissions should close through `cat_claw`; `main` should not bypass `cat_claw` as the final secretary/human-gate path.

Other agents contribute within their professional boundaries. They do not replace `main` as chair and do not replace `cat_claw` as the minutes, conclusion, or Human Gate owner.

## Communication Boundary

Local Mac Codex is Flashcat's control panel and outbound operator surface. It can help Flashcat send instructions, queries, reviews, and maintenance requests into the cat system through OpenClaw Gateway and this workflow plugin.

Agent-to-Flashcat return traffic must not target local Mac Codex. Reports, alerts, confirmation requests, Human Gate requests, task results, receipts, and trading-related messages must leave through governed IM exits such as Telegram, WeCom, or OpenClaw IM. The local Codex-to-node path is one-way for control-plane operations; it is not an inbox for cat-system callbacks.

## Hermes ACP Runtime

Use `runtime: "hermes_acp"` for migrated cat agents. Runtime agent endpoints can point at Hermes profiles; the bridge converts them into ACP command targets for the Gateway-loaded ACPX backend:

```text
runtime=hermes_acp agent=cat_body endpointRef=hermes-profile:catbody
runtime=hermes_acp agent=cat_heart endpointRef=hermes-profile:catheart
```

The bridge drains queued workflow dispatches by calling the Gateway-loaded ACP backend, default `acpx`, with persistent ACP sessions. Every dispatch, runtime run, ingest, and transcript entry carries an ISO timestamp. Dispatches can also carry `workflow_id`, `trace_id`, `idempotency_key`, `attempt`, `max_attempts`, `failure_type`, `sent_at`, `acked_at`, and `completed_at` so long-running agent work can be resumed and audited. The old `runtime: "hermes"` CLI adapter remains for rollback only; it is not the target production path.

## Runtime Registry

Every cat-system agent must be registered in `runtime_agents`; the table is the workflow scheduler's source of truth for routing, readiness, audit, and rollback decisions.

Runtime meanings:

- `hermes_acp`: primary execution runtime for migrated Hermes agents.
- `openclaw_route_shell`: OpenClaw Gateway/IM route shell for a migrated agent. This is not a second execution body; it may register/dispatch work, answer route status, or report route failure, but professional work must be routed to the primary runtime.
- `openclaw`: current primary runtime for cat-system agents that have not migrated to Hermes yet, such as `main`, `cat_claw`, `cat_voice`, `cat_tail`, `cat_swordclaw`, `cat_shieldclaw`, and `cat_gunclaw`.
- `hermes`: legacy Hermes CLI rollback anchor only.

The current active registry has six `hermes_acp` primary agents, six `openclaw_route_shell` aliases, and seven `openclaw` primary agents. All IM-facing messages and workflow records must carry ISO timestamps.

## Stability Governance

`trading-agents-workflow` is the cat-system workflow stability control surface. It does not replace OpenClaw Gateway; it records and governs the workflow state that Gateway routes.

Minimum operational contracts:

- `meeting.dispatch` should receive a stable `traceId` and, for dedupe-sensitive work, an `idempotencyKey`.
- Runtime bridge failures are classified into failure types such as `runtime_timeout`, `acp_unavailable`, `auth_unavailable`, `schema_validation`, `guardrail_block`, `stale_input`, and `transient_runtime`.
- Only transient runtime/provider classes are eligible for automatic retry, bounded by `maxAttempts` and `next_retry_at`.
- `runtime_runs` is the queryable ledger for Hermes/ACP turns; `runtime_runs.jsonl` remains a compatibility audit stream.
- `workflow.readiness` records a readiness snapshot across orchestration, runtime, communication, data, and Human Gate planes. Process liveness is not treated as trading readiness.
- `workflow.readiness` is passive by default. With `activeChecks=true`, it also probes OpenClaw Gateway health, Hermes profile `acp --check`, and the ACP backend without running a model turn.
- `side_effect.record` exists for file writes, memory writes, external notification, trading-core handoff, or any action that must not be blindly retried.
- `incident.state` records active incident state with affected planes, current mode, timeline, mitigation, rollback options, and exit criteria; it writes both JSON and Markdown artifacts under `bridge/incidents/`.

## Default Root

```text
/home/flashcat/.openclaw/shared/trading-agents-workflow/
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
  artifacts/
  templates/
  index/
```

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
- `workflow.supervise`
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
- `human_gate.record` without `meetingId` for workflow-level Human Gate
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
- Worker assignment must still use registered runtimes and agent ids.
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
  --worker hermes_acp:cat_eyes \
  --worker hermes_acp:cat_ears \
  --worker hermes_acp:cat_nose \
  --reducer openclaw:main \
  --root "$ROOT"
```

Use `workflow.task.create` to turn the next phase into concrete tasks. Each task should name the owner agent, execution runtime, priority, dependencies, expected artifact, receipt requirement, and whether a Human Gate is required before the task can be treated as complete.

Use `workflow.advance` after a discussion, dispatch batch, receipt collection cycle, or artifact review. It returns a structured decision:

- `needs_planning`: no actionable task exists yet.
- `dispatch_ready`: pending tasks are unblocked and can be dispatched.
- `receipts_collecting`: work is in progress or finished tasks still need receipts/artifacts.
- `cat_claw_summary_required`: all required work is done and `cat_claw` should package the conclusion or next Human Gate.
- `human_gate_pending`: a confirmation gate blocks continuation.
- `blocked`: no task can advance without intervention.
- `completed`: the run meets its stated acceptance or explicit completion condition.

With `autoDispatch=true`, `workflow.advance` records `meeting.dispatch` rows for ready tasks and moves them to `in_progress`. It does not bypass Gateway, runtime registry, receipt tracking, or Human Gate review.

Use `workflow.supervise` as the normal wanman-style control loop for durable initiatives. One supervisor cycle does the operational work that `workflow.advance` alone cannot:

- sync completed or failed runtime dispatches back into `workflow_tasks`
- run `workflow.advance` and optionally create ready dispatches
- optionally drain runtime bridge queues for the runtimes touched in that cycle
- write a compact checkpoint for session overflow recovery
- when the run is blocked, waiting on Human Gate, or ready for close-out, create a `cat_claw` report dispatch so the secretary agent submits a next-action package to Flashcat

`workflow.supervise` keeps Flashcat in the observer/approval role. Cat-brain `main` still owns decomposition and orchestration; `cat_claw` still owns formal reporting and Human Gate intake. The supervisor does not make trading decisions, bypass Gateway, bypass Human Gate, or execute trades.

CLI example:

```bash
node bin/cat-meeting-governance.mjs workflow-supervise --workflow demo-initiative --meeting demo-initiative --auto-dispatch --root "$ROOT"
```

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
node bin/cat-meeting-governance.mjs incident-state --incident incident-demo --status active --mode degraded --plane runtime --summary "Hermes ACP checks degraded" --exit-criteria "all active checks ready for 30m" --root "$ROOT"
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
- `human_gate.record`
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

PROPOSAL=$(node bin/cat-meeting-governance.mjs trade-proposal --asset stock --symbol 000001.SZ --summary "cat_heart proposal demo" --side buy --quantity 100 --root "$ROOT")
RISK_ID=demo-risk-001
GATE_ID=demo-gate-001
node bin/cat-meeting-governance.mjs risk-decision --proposal "$(echo "$PROPOSAL" | jq -r .objectId)" --risk-decision-id "$RISK_ID" --status approved --summary "cat_tail approved demo" --root "$ROOT"
node bin/cat-meeting-governance.mjs human-gate-workflow --human-gate-id "$GATE_ID" --parent "$RISK_ID" --status approved --text "Flashcat approved demo" --assurance mtls --root "$ROOT"
node bin/cat-meeting-governance.mjs trade-intent --asset stock --symbol 000001.SZ --side buy --quantity 100 --proposal "$(echo "$PROPOSAL" | jq -r .objectId)" --risk "$RISK_ID" --human-gate "$GATE_ID" --actor flashcat --assurance mtls --cert demo-cert-fingerprint --source codex_mtls --idempotency-key demo-intent-001 --root "$ROOT"
```
