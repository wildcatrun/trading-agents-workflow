# Managed Agent Evolution Plan

This document records the next evolution path for `trading-agents-workflow`
after comparing cat-system operating needs with cloud managed agent platforms
and trading-agent reference projects.

The workflow plugin remains the cat-system durable execution, Human Gate,
receipt, registry, risk-evidence, and side-effect control plane. It must not
become an agent runtime, a profile process manager, or a production trading
engine. OpenClaw, Hermers/Hermes, Codex, external coding workers, and future
platforms own runtime residency and tool execution.

## Reference Models

External systems provide useful patterns, but not a replacement architecture:

- Claude Managed Agents: `Agent`, `Environment`, `Session`, `Events`, tool
  confirmation, MCP tools, vault credentials, managed or self-hosted execution.
- Letta and LangGraph: stateful thread/run/checkpoint, interrupt/resume,
  shared memory, background runs, active run discovery, persistence.
- HKUDS Vibe-Trading: research grounding, swarm presets, run cards,
  validation artifacts, backtest evidence, and strategy-review loops.
- HKUDS AI-Trader: agent-native onboarding, heartbeat, task pull, signal feed,
  and reputation-like surfaces.
- yikart AiToEarn: task marketplace, agent task acceptance, execution, result
  settlement, and OpenClaw/MCP dual integration.
- Anthropic financial-services: vertical financial workflows that stage all
  outputs for human sign-off and keep high-impact decisions outside the agent.

These references support incremental upgrades inside the existing workflow
contract. They do not justify moving cat-system execution or trading authority
to an external cloud managed runtime.

## Design Principles

- Registry first: every agent operation starts from `runtime_agents`.
- Durable state first: live model session memory is disposable; workflow state,
  checkpoints, events, artifacts, receipts, and Human Gate records are durable.
- Evidence before action: no high-impact dispatch, deployment, migration, or
  trade handoff may proceed without explicit evidence and approval state.
- Tool authority is scoped: tasks declare required capabilities, agents declare
  available capabilities, and high-risk tools can require a Human Gate pause.
- Side effects are ledgered: file writes, notifications, Git operations,
  runtime control, trading intents, and external API mutations require
  idempotency keys and receipt reconciliation.
- Runtime ownership is preserved: workflow schedules and records work; runtime
  platforms execute work and report receipts.

## Current Strengths

The plugin already has the right foundation:

- `workflow_runs`, `workflow_tasks`, dependencies, checkpoints, session packs,
  and session runs.
- `runtime_agents` as global cross-runtime registry.
- `control_loop_jobs` with durable queue, lease, dedupe, and tick-driven
  mechanical progress.
- `mixed_meeting_dispatches`, `runtime_runs`, `message_flows`,
  `message_flow_events`, and `telegram_outbox`.
- Button-first Human Gate records, Telegram/Web App callback tokens, inbox
  artifacts, and resume paths.
- `side_effect_ledger`, executable trade intents, and trading core receipts.
- Narrow MCP/tool exposure modes for message-only, governance, and full control
  surfaces.

## Current Gaps

- Event evidence is fragmented across dispatch rows, message-flow events,
  runtime runs, JSONL governance logs, and artifacts. There is no global
  workflow event stream.
- Session packs exist, but there is no first-class worker runner for external
  managed agents to consume a pack, execute, and write structured receipts.
- External runtime adapters such as `local_codex`, `claude_code`, `opencode`,
  `webhook_worker`, or queue workers are not first-class execution paths.
- Tool capability and permission policy is too coarse for production SSH,
  database DDL, Gateway restart, GitHub push, Telegram delivery, and
  trading-core handoff.
- Human Gate has the right token-bound foundation, but the state machine still
  needs stronger single-active-gate, supersede, re-delivery, timeout, pause,
  terminate, and audit semantics.
- Research-to-trade evidence needs stronger run-card, freshness, validation,
  risk-decision, and rubric-evaluation contracts.
- Control-loop operations need dead-letter handling, worker health evidence,
  and clearer stuck-job/lease observability before scaling to more workers.

## Target Modules

### Workflow Event Store

Add a global append-only event stream for all workflow-relevant state changes.

Initial event types:

- `workflow.created`, `workflow.updated`, `workflow.paused`,
  `workflow.resumed`, `workflow.terminated`, `workflow.completed`
- `task.created`, `task.dispatched`, `task.blocked`, `task.completed`
- `dispatch.created`, `dispatch.claimed`, `dispatch.retried`,
  `dispatch.failed`, `dispatch.reconciled`
- `runtime.started`, `runtime.receipt`, `runtime.failed`
- `message_flow.created`, `message_flow.outbound_queued`,
  `message_flow.delivered`, `message_flow.failed`
- `human_gate.requested`, `human_gate.delivered`, `human_gate.submitted`,
  `human_gate.paused`, `human_gate.terminated`, `human_gate.superseded`
- `artifact.created`, `artifact.validated`, `artifact.expired`
- `risk.checked`, `risk.failed`, `execution.intent.created`,
  `execution.receipt`
- `side_effect.recorded`, `side_effect.confirmed`,
  `side_effect.uncertain`
- `incident.created`, `incident.updated`, `incident.resolved`

Each event should carry ISO timestamp, actor, workflow id, trace id, source
runtime, previous state, next state, payload hash, artifact pointer, and
idempotency key when available.

### Thread, Run, And Checkpoint

Promote the existing session pack/run model into a managed-agent compatible
execution contract:

- Add or standardize `thread_id`, `run_id`, `seq_id`, `checkpoint_id`, and
  `parent_checkpoint_id` across dispatch, session run, and event records.
- Record phase-boundary checkpoints before Human Gate, before side effects,
  after runtime receipt, and before closeout.
- Treat agent session compression as a workflow event with a resume packet, not
  as a private runtime detail.
- Permit future fork/retry from a checkpoint only when side-effect status is
  known or explicitly marked uncertain.

### Permission Gate

Add a policy layer for high-risk tool and side-effect operations.

Policy inputs:

- task type and workflow type
- target agent and runtime row
- requested capability
- tool name or side-effect type
- risk tier
- artifact and rollback references
- Human Gate requirement

Policy outcomes:

- `allow`
- `deny`
- `requires_human_gate`
- `requires_cat_claw_audit`
- `requires_freshness_check`

High-risk classes include production SSH, production deployment, database DDL,
Gateway restart, model route change, secret/OAuth change, GitHub push/release,
Telegram mass delivery, live trading, and trading-core live adapter use.

### Outcome And Rubric Evaluation

Add structured quality gates for long-running work.

Use cases:

- cat-body development tasks
- research reports and run cards
- Human Gate evidence packages
- deployment readiness reviews
- trading-core handoff tests

Each outcome should specify acceptance criteria, evaluator, rubric items,
required artifacts, result status, score or pass/fail, reviewer receipt, and
residual risk. Completion should be separate from approval: a task can be
technically complete but still wait for Human Gate or reviewer sign-off.

### Research Run Card

Add a durable research evidence package before risk decision and Human Gate.

Minimum fields:

- instrument, asset type, market, time range, and data sources
- data freshness timestamps and expiry time
- hypothesis and falsification triggers
- analysis method and tools used
- backtest or paper evidence when applicable
- validation summary, known weaknesses, and conflicting evidence
- risk limits, stale-data stop conditions, and next-review time
- artifact paths, payload hash, author, reviewer, and workflow id

### Managed Worker Runner

Add a narrow worker-runner path for external or local managed agents:

1. Resolve target through `runtime_agents`.
2. Read a `workflow_session_runs.worker_input_json`.
3. Execute the registered adapter, such as local Codex, webhook, queue worker,
   or future managed-agent bridge.
4. Write `runtime_runs`, structured output, receipt reference, and
   `workflow_events`.
5. Never write final success without artifact or receipt evidence.

The first implementation should be dry-run/paper-only and must not execute
production SSH, database migration, live trading, or Gateway restart.

## Execution Batches

### Batch 0: Design And Contracts

Deliverables:

- This design document.
- Link from `README.md` or a docs index.
- Initial issue/task list for implementation batches.

No runtime config changes, Gateway restart, database migration, or production
deployment are required.

### Batch 1: Global Event Store

Deliverables:

- `workflow_events` schema.
- Append/list/timeline actions.
- Event writes for workflow creation, dispatch creation, runtime receipt,
  Human Gate request/submit, artifact creation, side-effect recording, and
  incident state changes.
- Regression tests for idempotency, ordering, and payload redaction.

Acceptance:

- A single `workflow_id` or `trace_id` can reconstruct a readable timeline
  without reading JSONL governance logs.
- Existing message-flow behavior remains compatible.

### Batch 2: Human Gate State Hardening

Deliverables:

- Single active Human Gate per workflow stage.
- Supersede/cancel semantics.
- Re-delivery of the same Human Gate without generating duplicate decisions.
- Timeout, pause, terminate, and resume events.
- Audit checks for A/B/C plans, Chinese body, button styles, token-bound form,
  Flashcat original words, and Cat Claw review.

Acceptance:

- Duplicate Human Gate creation is prevented or explicitly superseded.
- Re-delivery preserves the same `humanGateId` and button ids.

### Batch 3: Permission Gate

Deliverables:

- Capability policy schema or config.
- Policy check action used before high-risk dispatch and side-effect actions.
- Human Gate escalation package for `requires_human_gate`.
- Tests for deny, allow, and approval-required outcomes.

Acceptance:

- High-risk operations cannot proceed through generic dispatch without an
  explicit policy decision.

### Batch 4: Managed Worker Runner

Deliverables:

- `workflow_session_run` consumer command.
- `local_codex` or `webhook_worker` adapter in dry-run mode.
- Structured output and receipt writeback.
- Event stream integration.

Acceptance:

- A session pack can be consumed by an external worker and return a receipt
  without bypassing `runtime_agents`.

### Batch 5: Research Run Card And Outcome Evaluation

Deliverables:

- Research run-card schema and artifact helpers.
- Outcome/rubric schema and evaluator records.
- Human Gate evidence package integration.
- Freshness check hooks for trading research and risk decisions.

Acceptance:

- A research-to-trade workflow cannot reach Human Gate without run-card,
  freshness, risk-decision, and evaluation evidence.

### Batch 6: Operations And Console Surfaces

Deliverables:

- Event timeline query and console view.
- Dead-letter/stuck-job evidence.
- Worker health snapshot.
- SLI summaries for dispatch latency, receipt completeness, Human Gate age,
  runtime error rate, and side-effect uncertainty.

Acceptance:

- Cat Brain and Cat Claw can inspect workflow progress and failures without
  searching raw logs.

## Non-Goals

- Do not migrate cat-system execution to an external cloud managed-agent
  platform by default.
- Do not replace OpenClaw, Hermers, Codex, or stabilityd with this plugin.
- Do not allow shared memory to carry task dispatch, Human Gate decisions, or
  trading instructions.
- Do not let route shells produce professional task receipts.
- Do not treat Human Gate as trading risk control; it is an approval boundary,
  not an execution risk engine.
- Do not add production live trading, production SSH automation, Gateway
  restart, or database migration execution in the worker runner batches.

## Review Checklist

- Does the change start from `runtime_agents` before touching a runtime?
- Does the change preserve workflow as control/evidence plane, not runtime?
- Does every high-impact action have artifact, rollback, and Human Gate state?
- Does every side effect have idempotency and receipt or uncertain state?
- Does every new event include timestamp, actor, workflow id or trace id, and
  redacted payload references?
- Does the implementation keep Cat Brain semantic governance and Cat Claw
  secretary/Human Gate audit roles distinct?
