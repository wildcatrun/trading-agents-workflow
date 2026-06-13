# Workflow Console Agentic OS And Hermers Kanban Plan

Date: 2026-06-12
Status: development plan
Scope: `trading-agents-workflow` GUI / workflow console evolution

This document defines the next GUI evolution path for `trading-agents-workflow`.
It adapts Agentic OS control-plane ideas and a Hermers-oriented Kanban work
surface into the existing workflow console. It does not authorize a second
console, a second scheduler, a runtime process manager, or browser-side direct
mutation of workflow business tables.

## Research Inputs

External references:

- Agent Operating Systems (AOS), arXiv 2606.01508:
  https://arxiv.org/abs/2606.01508
  - Useful pattern: an agentic control plane needs scheduling, context and
    memory management, tool and capability registries, policy and trust
    enforcement, observability, and audit.
- Windows Agent Workspace coverage:
  https://www.windowscentral.com/microsoft/windows-11/microsoft-just-revealed-how-windows-11-is-evolving-into-an-agentic-os-finally-the-explanation-weve-all-been-waiting-for
  - Useful pattern: agents run in contained workspaces with scoped
    authorization, separate identity, background execution, visible activity,
    and user control.
- AutoGen Studio, arXiv 2408.15247:
  https://arxiv.org/abs/2408.15247
  - Useful pattern: multi-agent systems need a web UI for specification,
    debugging, evaluation, and reusable components.
- TeamBench, arXiv 2605.07073:
  https://arxiv.org/abs/2605.07073
  - Useful pattern: role separation should be enforced by access and workflow
    boundaries, not only by prompts.

Local references:

- `docs/workflow-console.md`
- `docs/workflow-console-v0.3-message-flow-observability.md`
- `docs/managed-agent-evolution-plan.md`
- `docs/agent-registry-routing.md`
- `docs/runtime-profile-modes.md`
- `docs/claude-code-workflow-reference/runtime-observability-improvement-plan-2026-06-03.md`
- `cat-agents-stabilityd/hermers/README.md`

No separate authoritative local "Hermers Kanban" product document was found.
In this plan, "Hermers Kanban" means a task-board surface over Hermers/Hermes
profile readiness, ACP reachability, runtime dispatch state, semantic progress
evidence, message-flow closure, and receipt/Human Gate gaps.

## Current Console Baseline

The current console is a thin Human/Workflow Control Plane:

- static frontend in `static/console/`;
- Node HTTP server in `src/console/server.js`;
- SQLite read model in `src/console/read-model.js`;
- governed preview/write entry point in `src/console/action-gateway.js`;
- state stored in `workflow_control_plane.db`;
- read-only or preview-only by default.

Existing strengths:

- workflow list and detail surfaces;
- phase, task, dispatch, runtime-run, agent-run, verification, message-flow,
  timeline, Human Gate, outbox, evidence, receipt, export, and operations
  tabs;
- operations attention for dead-letter, delivery-missing, control-loop, and
  message-flow evidence;
- console action audit through `workflow_operations`;
- redaction for callback tokens, secrets, OAuth-ish fields, and payloads.

Existing gaps:

- no first-class agent board showing every registered agent and its current
  work state;
- no Kanban projection over queue, dispatch, runtime, receipt, and Human Gate
  state;
- ACK-only dispatches can look successful before semantic work is proven;
- profile readiness is visible through readiness snapshots, but not shaped as
  operator workflow;
- evidence completeness is spread across many tabs instead of being summarized
  as a next-action surface;
- console navigation is workflow-first, not agent/workspace-first.

## Product Direction

The GUI should become an operator-facing agent workbench with four primary
views:

1. Command Center
2. Agent Board
3. Workflow Kanban
4. Evidence Desk

These views should reuse the existing console server, read model, action
gateway, redaction policy, and workflow database. They must not create another
runtime, queue, scheduler, or registry.

## Design Principles

- Registry first: all agent identity, runtime, endpoint, dispatch eligibility,
  and ownership facts start from `runtime_agents`.
- Runtime ownership preserved: OpenClaw, Hermers/Hermes, Codex, and future
  runtimes own process residency, sessions, tools, local cron, and profile
  lifecycle. Workflow observes and records; it does not become the runtime.
- Read-only first: v0.4 must be observational. Real state writes remain behind
  `WorkflowActionGateway` and an explicit allowlist.
- Preview before mutation: operator buttons should generate governed preview
  packages before any business-state mutation.
- Evidence before action: no retry, reroute, Human Gate submission, production
  operation, or trading handoff should appear actionable unless required
  evidence and rollback boundaries are visible.
- Separate facts, do not collapse them: runtime ACK, semantic ACK, final
  artifact, local Codex inbox receipt, Telegram delivery, Human Gate feedback,
  and Flashcat approval are different states.
- Human Gate remains button-first and token-bound; the GUI may show evidence
  and preview packages, but it must not infer approval from chat text or card
  movement.
- Failure should be visible as a work item, not hidden in raw JSON.

## View 1: Command Center

Purpose: give Flashcat/Codex/Cat Claw a one-screen health and control-plane
summary.

Required panels:

- Global readiness status and latest snapshot timestamp.
- Runtime plane:
  - OpenClaw Gateway active/readiness state.
  - Hermers profile mode summary.
  - Hermes ACP check summary.
  - Codex/local Codex inbox availability when registered.
- Queue plane:
  - queued, leased, retrying, failed, dead-letter control-loop jobs;
  - stale dispatch count;
  - ACK-only stale count once semantic observability exists.
- Communication plane:
  - message-flow attention count;
  - Telegram outbox queued/failed/delivering count;
  - targetless outbox count.
- Human Gate plane:
  - pending gates;
  - stale gates;
  - missing buttons;
  - feedback waiting count.
- Evidence plane:
  - workflows missing receipt;
  - workflows missing artifact;
  - workflows with side-effect uncertainty.

Initial implementation should derive this from:

- `GET /api/readiness/latest`;
- `GET /api/runtime-agents`;
- `GET /api/operations/summary`;
- existing workflow list/detail endpoints.

## View 2: Agent Board

Purpose: show what each registered agent can receive, is doing, is waiting on,
and where it is blocked.

Rows are keyed by `runtime_agents`, not by platform-local profile lists.

Minimum columns:

- Agent: `agent_id`, display name, role, platform.
- Runtime endpoint: `workflow_ingress_adapter`, `execution_identity`,
  `endpoint_ref`, profile mode when available.
- Dispatchability:
  - can receive dispatch;
  - adapter ready/unavailable;
  - admission reason;
  - last readiness observation.
- Current work:
  - active workflow id;
  - active task id;
  - active dispatch id;
  - current stage;
  - last runtime event;
  - latest artifact or receipt.
- Queue:
  - queued dispatches;
  - runtime-drain jobs;
  - message-flow rows targeting this agent.
- Attention:
  - stale ACK-only;
  - failed runtime;
  - missing receipt;
  - profile unavailable;
  - blocked Human Gate dependency.

P0 data can be approximate and derived from existing tables. P1 should consume
the semantic runtime event/current-state projection described in
`runtime-observability-improvement-plan-2026-06-03.md`.

Suggested endpoint:

```text
GET /api/agent-board
```

Suggested response shape:

```json
{
  "schemaVersion": "agent_board.v1",
  "generatedAt": "2026-06-12T00:00:00.000Z",
  "summary": {
    "agents": 0,
    "ready": 0,
    "working": 0,
    "blocked": 0,
    "attention": 0
  },
  "agents": []
}
```

## View 3: Workflow Kanban

Purpose: make queue and workflow progression inspectable without pretending the
browser is the workflow state machine.

The board should be a derived projection. Drag-and-drop state mutation is a
non-goal for v0.4.

Recommended columns:

- Inbox:
  - task drafts;
  - newly created workflow tasks with no dispatch;
  - message flows registered but not queued.
- Queued:
  - `control_loop_jobs` queued;
  - dispatches/message flows awaiting drain;
  - Telegram outbox queued.
- Dispatched:
  - dispatch rows sent/acked mechanically;
  - runtime run claimed/started.
- Working:
  - semantic ACK or stage progress present;
  - future `runtime_semantic_events` current stage indicates active work.
- Waiting Receipt:
  - runtime terminal output exists but receipt/artifact/delivery evidence is
    incomplete;
  - delivery-required message flow has no human-visible delivery receipt.
- Waiting Human:
  - pending Human Gate;
  - pending Human Gate feedback;
  - paused waiting for Flashcat instruction.
- Blocked:
  - workflow/task blocked;
  - active incident;
  - policy denied or requires Cat Claw audit.
- Done:
  - workflow/task completed with receipt and evidence.
- Failed:
  - terminal runtime failure;
  - failed dispatch after max attempts;
  - failed Telegram outbox;
  - side-effect uncertainty requiring incident.

Card contract:

- stable id and source table;
- workflow id;
- task id when available;
- owner agent and runtime;
- trace id / dispatch id / flow id when available;
- current status and status source;
- last event timestamp;
- missing evidence summary;
- latest artifact/receipt pointer;
- available preview actions.

Suggested endpoint:

```text
GET /api/kanban?scope=global|workflow|agent&workflowId=&agentId=
```

P0 cards should be read-only links into existing detail tabs. P1 cards can add
preview buttons such as "Preview Supervise", "Preview Evidence Pack", or
"Preview Human Gate Package" through `POST /api/actions`.

## View 4: Evidence Desk

Purpose: collapse receipt, artifact, verification, Human Gate readiness,
outbox, and message-flow closure into a decision-oriented evidence surface.

Evidence Desk should answer:

- Can Cat Claw audit this package?
- Can Human Gate be submitted?
- Which evidence is missing?
- Which runtime or agent must provide the missing receipt?
- Which side effects are still uncertain?
- Which artifacts are stale or not bound to the workflow?

Minimum sections:

- Human Gate readiness checklist.
- Receipt chain:
  - dispatch;
  - runtime run;
  - message-flow closure;
  - Telegram or local inbox delivery;
  - artifact;
  - verification.
- Missing evidence list.
- Latest checkpoint and resume boundary.
- Rollback/stop boundary.
- Preview export package.

Evidence Desk should reuse:

- `GET /api/workflows/:workflowId/human-gate-readiness`;
- `GET /api/workflows/:workflowId/receipts`;
- `GET /api/workflows/:workflowId/evidence-pack`;
- `GET /api/workflows/:workflowId/verification`;
- `GET /api/workflows/:workflowId/timeline`.

## UX Requirements

- Dense, operator-oriented layout. Avoid marketing-style pages.
- Use full-width work surfaces, not nested cards.
- Keep task cards compact with stable dimensions and no layout shift.
- Use tabs for major views and segmented controls for filters.
- Filters:
  - agent;
  - runtime;
  - workflow;
  - status;
  - attention class;
  - Human Gate required;
  - updated time window.
- Text must not overflow cards or buttons on mobile or desktop.
- Color is semantic, not decorative:
  - green for ready/complete;
  - amber for queued/waiting;
  - red for blocked/failed/uncertain;
  - blue for active/preview/control-plane.
- Do not use card movement as approval. Movement only navigates or filters
  until governed write support is explicitly implemented.

## Data Model And Read Model Plan

### P0: Derived Read Models Only

No schema change.

Add read-model methods:

```text
agentBoard(query)
kanban(query)
commandCenter(query)
```

Add routes:

```text
GET /api/command-center
GET /api/agent-board
GET /api/kanban
```

Derive from existing tables:

- `runtime_agents`
- `workflow_runs`
- `workflow_tasks`
- `mixed_meeting_dispatches`
- `runtime_runs`
- `workflow_agent_runs`
- `message_flows`
- `message_flow_events`
- `control_loop_jobs`
- `telegram_outbox`
- `protocol_objects`
- `review_gates`
- `human_gate_buttons`
- `human_gate_batches`
- `human_gate_batch_items`
- `incident_states`
- `side_effect_ledger`
- `workflow_verification_results`
- `workflow_checkpoints`
- `workflow_events`
- `artifact_index`
- `readiness_snapshots`
- `workflow_operations`

### P1: Semantic Runtime Current State

Add the runtime semantic observability projection described by the existing
runtime observability plan.

Target current-state fields:

```text
agent_id
runtime
endpoint_ref
workflow_id
task_id
dispatch_id
runtime_run_id
current_stage
stage_status
semantic_ack_at
last_event_at
latest_artifact_ref
latest_receipt_ref
blocked_reason
interruption_class
updated_at
```

The append-only event table remains the audit base. The current-state table is
a projection optimized for Agent Board and Kanban rendering.

### P2: Governed Preview Actions

Add preview-only affordances:

- preview supervise workflow;
- preview evidence pack;
- preview Human Gate package;
- preview dispatch rerun;
- preview outbox redelivery;
- preview incident linkage;
- preview pause/resume/stop intervention.

All previews must go through `WorkflowActionGateway` and write
`workflow_operations` audit rows.

### P3: Governed Write Actions

Only after v0.4/v0.5 run without false-positive incidents:

- enable limited write actions through explicit server startup flags;
- keep action allowlist narrow;
- require Human Gate or Cat Claw audit for high-risk classes;
- keep every operation idempotent and auditable.

Forbidden from the GUI:

- Gateway restart;
- Hermers profile start/stop/hibernate;
- model route changes;
- production deployment;
- database DDL;
- live trading;
- secret/OAuth edits;
- arbitrary SQL.

## Implementation Slices

### v0.4 Slice A: Command Center

Files:

- `src/console/read-model.js`
- `src/console/server.js`
- `static/console/index.html`
- `static/console/app.js`
- `static/console/style.css`
- `docs/workflow-console.md`

Acceptance:

- `/api/command-center` returns readiness, queue, communication, Human Gate,
  runtime, and evidence summaries.
- UI shows Command Center as the default landing surface.
- No write action is added.
- Existing tabs continue to work.

### v0.4 Slice B: Agent Board

Acceptance:

- `/api/agent-board` lists every active `runtime_agents` row.
- Agent rows include platform, endpoint, adapter, profile mode when available,
  queued work, active work approximation, and attention flags.
- Missing or malformed Hermers profile mode evidence does not break the page.
- Cat Claw remains shown as OpenClaw-only; no Hermers ACP target is inferred.

### v0.4 Slice C: Workflow Kanban

Acceptance:

- `/api/kanban` returns stable columns and source-linked cards.
- The UI renders global board and workflow-scoped board.
- Cards link into existing workflow detail tabs.
- No drag-and-drop mutation.
- Empty columns are stable and readable.

### v0.4 Slice D: Evidence Desk

Acceptance:

- A workflow-level Evidence Desk summarizes readiness, receipts, verification,
  artifacts, Human Gate state, and missing evidence.
- Existing Human Gate, readiness, checkpoint, and resume-boundary counts do not
  regress from the current console read model.
- It links back to existing raw/detail tabs.
- It redacts tokens and secret-like values.

### v0.4 Implementation Status

Status: implemented in the read-only console.

Delivered:

- `WorkflowReadModel.commandCenter(query)` and `GET /api/command-center`.
- `WorkflowReadModel.agentBoard(query)` and `GET /api/agent-board`.
- `WorkflowReadModel.kanban(query)` and `GET /api/kanban`.
- `WorkflowReadModel.evidenceDesk(workflowId, query)` and
  `GET /api/workflows/:workflowId/evidence-desk`.
- Top-level console tabs for Command, Agents, Kanban, and Workflows.
- Workflow detail tab for Evidence Desk.
- Regression coverage for schema versions, registry-first Agent Board behavior,
  Cat Claw OpenClaw-only guardrail, Kanban column mapping, and Evidence Desk
  routing.

Validation recorded for this implementation:

- `npm run check`
- `node scripts/workflow_regression_tests.mjs`
- Local Playwright smoke against `http://127.0.0.1:18792` with a temporary
  workflow root, covering Command Center, Agent Board, Kanban, and Evidence
  Desk rendering.

### v0.5 Implementation Status

Status: implemented as semantic runtime current-state projection.

Delivered:

- Additive schema version `14`.
- Append-only `runtime_semantic_events` table.
- Derived `runtime_current_state` table keyed by `runtime:agent_id`.
- `workflow.runtime_event.record`, `workflow.runtime_event.list`, and
  `workflow.runtime_current_state` actions.
- `GET /api/runtime-current-state`.
- Agent Board Current column backed by `runtime_current_state`.
- Kanban cards sourced from runtime current state.

Validation recorded for this implementation:

- `npm run check`
- `node scripts/workflow_regression_tests.mjs`
- `git diff --check`
- Local Playwright smoke against `http://127.0.0.1:18794`, verifying Agent
  Board Current rendering and Kanban `runtime_current_state` cards.

### v0.6 Implementation Status

Status: implemented as real runtime bridge semantic event ingestion.

Delivered:

- `runtime.bridge.drain` now records `dispatch_bound` when a real OpenClaw,
  Hermes CLI, Hermers ACP, or local Codex inbox dispatch is bound to a
  runtime run.
- ACK-required first turns record `mechanical_ack` only. They do not record
  `semantic_ack` or `turn_completed`.
- Non-ACK final turns and semantic continuations record `semantic_ack` and
  `turn_completed`.
- Terminal runtime failures, registry validation failures, invalid dispatch
  payloads, unsupported adapters, route-shell redirect failures, ACP
  fail-closed paths, and outer bridge exceptions record `turn_failed`.
- ACK success followed by semantic-continuation enqueue failure records a
  `blocked` runtime event with `staleKind=semantic_continuation_failed`.
- Runtime semantic-event write failures are no longer silent: they emit a
  degraded workflow event and `runtime_events_errors.jsonl` evidence.
- `stale_dispatch_reconcile` backfills current-state projection from terminal
  runtime receipts, including ACK-only, semantic completion, terminal failure,
  retry scheduling, and missing-output cases.

Validation recorded for this implementation:

- `npm run check`
- `node scripts/workflow_regression_tests.mjs`
- `git diff --check`
- Independent reviewer pass after the terminal-failure, stale-reconcile, and
  semantic-continuation failure gaps were fixed.

## Test Plan

Required checks:

```bash
npm run check
npm run test:regression
git diff --check
```

Add regression tests for:

- `/api/command-center` with empty DB and populated fixtures;
- `/api/agent-board` registry-first behavior;
- `/api/agent-board` malformed/missing Hermers profile mode evidence;
- `/api/agent-board` Cat Claw guardrail: a valid `openclaw:cat_claw` registry
  row must remain OpenClaw-only and must not gain a Hermers ACP endpoint or
  dispatchability from malformed, near-match, or unrelated Hermers profile
  evidence;
- `/api/kanban` column mapping for queued, working, waiting receipt, waiting
  Human, blocked, done, and failed examples;
- redaction in every new response;
- no mutation from GET routes;
- action-gateway audit when preview actions are later added.

Frontend smoke:

- start console against a temporary workflow root;
- open desktop and mobile viewports;
- verify Command Center, Agent Board, Kanban, and Evidence Desk render without
  overlapping text;
- verify cards and tables remain scrollable;
- verify empty-state rendering.

Development-server smoke:

- deploy through GitHub-managed checkout only;
- start console as a separate read-only process on `127.0.0.1:8791`;
- access through the existing local tunnel `127.0.0.1:18791`;
- verify `/health`, `/api/config`, `/api/command-center`,
  `/api/agent-board`, and `/api/kanban`.

Gateway restart is not required for console-only static/read-model changes
unless plugin runtime loading changes require it separately.

## Rollout Boundaries

- v0.4 is read-only and implemented.
- v0.5 semantic current-state projection is implemented.
- v0.6 runtime bridge semantic event ingestion is implemented.
- Governed preview actions are deferred to the next stage after runtime
  observability has enough development-server operating history.
- Real write controls remain disabled unless explicitly enabled by startup
  config and reviewed through Human Gate policy.

Rollback:

- stop the standalone console process;
- revert the GitHub commit and fast-forward the development checkout back to
  the prior commit;
- schema version `14` is additive; rollback can leave the runtime semantic
  event/current-state tables in place as inert read-model data.

## Open Questions

- Should Kanban default to global agent work or current workflow work?
- Should Cat Claw have a secretary-specific Evidence Desk shortcut?
- Should agent cards show profile-local memory/RAG status, or keep memory
  status in the Hermers platform surface and only show workflow-relevant
  readiness here?
- Which governed preview actions are safe enough for the next stage after
  v0.6 runtime observability is observed on the development server?

## Review Record

2026-06-12: local Codex subagent `Leibniz` reviewed this plan against workflow
runtime boundaries, existing console/read-model/action-gateway architecture,
Human Gate safety, table coverage, and testability. Verdict was `approve with
changes`. The requested changes were applied:

- added missing Human Gate, checkpoint, event, and review-gate source tables;
- clarified that `docs/workflow-console.md`'s old Phase Hold is historical and
  superseded by this read-only / preview-first GUI plan;
- added a Cat Claw OpenClaw-only Agent Board regression requirement.
