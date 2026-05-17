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

This is not an independent agent runtime, not a Gateway replacement, not a Hermes runtime, and not a live trading executor. It does not call trading_core or Telegram directly; it records reviewed intents, dispatch queues, transcripts, Telegram outbox entries, and later records trading_core receipts.

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

## Actions

Workflow and tracking:

- `workflow.init`
- `workflow.status`
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

PROPOSAL=$(node bin/cat-meeting-governance.mjs trade-proposal --asset stock --symbol 000001.SZ --summary "cat_heart proposal demo" --side buy --quantity 100 --root "$ROOT")
RISK_ID=demo-risk-001
GATE_ID=demo-gate-001
node bin/cat-meeting-governance.mjs risk-decision --proposal "$(echo "$PROPOSAL" | jq -r .objectId)" --risk-decision-id "$RISK_ID" --status approved --summary "cat_tail approved demo" --root "$ROOT"
node bin/cat-meeting-governance.mjs human-gate-workflow --human-gate-id "$GATE_ID" --parent "$RISK_ID" --status approved --text "Flashcat approved demo" --assurance mtls --root "$ROOT"
node bin/cat-meeting-governance.mjs trade-intent --asset stock --symbol 000001.SZ --side buy --quantity 100 --proposal "$(echo "$PROPOSAL" | jq -r .objectId)" --risk "$RISK_ID" --human-gate "$GATE_ID" --actor flashcat --assurance mtls --cert demo-cert-fingerprint --source codex_mtls --idempotency-key demo-intent-001 --root "$ROOT"
```
