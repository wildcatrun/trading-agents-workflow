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

## Target Console Specification

The target console is not a marketing dashboard. It should behave like an
operator workbench for governed agent workflows, with the same level of
practical control expected from modern agent consoles:

- a stable command center for global state;
- an agent board for identity, readiness, workload, and current semantic state;
- a Kanban work surface for queue, dispatch, runtime, receipt, Human Gate, and
  incident progression;
- an evidence desk that shows what is proven, missing, stale, or unsafe;
- governed preview actions for the next safe intervention;
- an audit trail that explains who did what, when, why, with which evidence;
- mobile-readable inspection surfaces for emergency review;
- no direct browser mutation of workflow business tables.

### Navigation Model

Primary navigation should settle on five top-level surfaces:

1. Command Center
2. Agent Board
3. Kanban
4. Evidence
5. Operations

Workflow detail remains available from cards, tables, and references, but the
default operator path should be:

```text
global health -> agent/work item -> evidence -> preview package
  -> audited preview or explicitly policy-enabled action
```

The console should not require the operator to start from a workflow id when
the actual symptom is "cat_ears has no receipt", "Telegram delivery is stale",
"Hermes ACP is unavailable", or "Human Gate feedback is waiting".

### Command Center Target

The Command Center should become a triage page, not just a summary page.

Target panels:

- Overall state: `ready`, `degraded`, `blocked`, `incident`, or `unknown`.
- Critical blockers: top five current issues requiring action.
- Runtime plane: OpenClaw, Hermes/Hermers, local Codex, and future adapters.
- Queue plane: queued, leased, retrying, stale, failed, and dead-letter jobs.
- Agent plane: ready, working, blocked, attention, and unavailable counts.
- Communication plane: message-flow attention, local Codex inbox, Telegram
  outbox, and delivery gaps.
- Human Gate plane: pending, stale, missing buttons, feedback waiting, and
  resume-boundary status.
- Evidence plane: missing receipt, missing artifact, side-effect uncertain,
  incident linkage, and rollback boundary gaps.

Each blocker should link to the exact Agent Board row, Kanban card, Evidence
Desk section, or Operations audit row that explains it.

### Agent Board Target

The Agent Board should answer four operator questions without raw SQL or log
inspection:

- Who exists in the governed registry?
- Can this agent receive work now?
- What is the agent currently doing, semantically?
- What blocks the next safe dispatch or closeout?

Target row/card fields:

- registry identity: `agent_id`, display name, role, platform, primary runtime;
- runtime endpoint: adapter, execution identity, endpoint reference, profile
  mode, and last readiness source;
- admission state: dispatchable, denied, unavailable, protected, or unknown;
- current state: current workflow/task/dispatch, semantic stage, last event,
  stale kind, current artifact/receipt pointer;
- workload: queued jobs, active dispatches, message-flow rows, pending receipt
  rows, and Human Gate dependencies;
- safety flags: protected agent, deprecated alias risk, runtime mismatch,
  missing profile evidence, ACK-only stale, failed terminal turn, or side-effect
  uncertainty.

Desktop should use a dense table plus detail drawer. Mobile should switch to
agent cards grouped by status, because the current table is readable but too
dense for sustained mobile operation.

### Kanban Target

The Kanban board should be a projection over workflow state. It should not
pretend that dragging a card is the source of truth.

Target card classes:

- workflow task;
- control-loop job;
- runtime dispatch;
- runtime current state;
- message-flow event;
- Telegram outbox item;
- Human Gate request;
- evidence gap;
- incident;
- side-effect uncertainty.

Every card should expose:

- source type and source id;
- workflow/task/dispatch/message-flow ids when known;
- owner/target agent;
- current column reason;
- first-seen and last-updated timestamps;
- latest event summary;
- required evidence;
- next safe preview actions;
- direct links to raw detail and audit trail.

Column movement remains derived from state:

```text
Inbox -> Queued -> Dispatched -> Working -> Waiting Receipt
       -> Waiting Human -> Done
       -> Blocked / Failed
```

Cards may appear in Blocked or Failed from any stage when policy, incident, or
runtime evidence requires it.

### Evidence Desk Target

The Evidence Desk should be the operator's pre-action checklist. It should
avoid hiding decisive facts in raw JSON.

Target sections:

- Readiness: latest registry/runtime readiness and age.
- Dispatch: dispatch ids, attempts, runtime runs, ACK state, semantic state.
- Receipts: terminal receipt, artifact receipt, delivery receipt, and missing
  receipt reason.
- Human Gate: request, options, buttons, Telegram/Web App delivery, feedback,
  resume payload, and token redaction status.
- Artifacts: latest artifact refs, file existence where available, checksum or
  size when available.
- Side effects: outbox, external delivery, database write, production action,
  or trading-core handoff state.
- Review gates: Cat Brain/Cat Claw review state, unresolved reviewer findings,
  rollback and stop conditions.
- Audit: action previews, executed actions, actor, timestamp, input summary,
  output summary, and failure evidence.

### Governed Preview Action Target

The next GUI step should make preview actions visible on cards and evidence
sections while keeping actual mutation locked behind the existing action
gateway.

Preview action families:

- workflow supervise preview;
- evidence-pack preview;
- Human Gate package preview;
- dispatch rerun preview;
- semantic-continuation preview;
- Telegram outbox delivery preview;
- Telegram outbox requeue/redelivery preview;
- incident linkage preview;
- pause/resume/stop intervention preview;
- closeout/checkpoint preview.

Preview output must be explicit:

- what would be changed;
- what would not be changed;
- required evidence;
- missing evidence;
- idempotency key or dedupe key;
- rollback/stop boundary;
- Human Gate requirement if any;
- exact server-side allowlist action name.

Preview and export surfaces must be policy-gated. A redacted evidence export is
still an operator artifact, not a public debug dump; preview-package generation,
evidence export, and any later policy-enabled write action must record actor,
source, timestamp, allowlist action, and audit row.

### Mobile And Accessibility Target

Mobile support is for inspection and emergency approval preparation, not heavy
workflow editing.

Required behavior:

- Command Center cards fit a 390px-wide viewport without overlapping text.
- Agent Board switches to grouped cards below tablet width.
- Kanban remains horizontally scrollable, with visible column labels and no
  overlapping card content.
- Evidence Desk uses collapsible sections and keeps ids copyable.
- Buttons have clear labels and cannot be confused with executed actions.
- Long ids wrap safely or use copy controls.
- No page relies on hover-only affordances.

### Data Contract Target

Each new endpoint should keep stable schema versions and include:

- `schemaVersion`;
- `generatedAt`;
- `query`;
- `summary`;
- `items` or named collections;
- redacted payloads only;
- `sourceRefs` for raw table/event linkage;
- `attention` or `findings` for operator next steps.

No endpoint should expose callback tokens, OAuth values, API keys, private keys,
broker credentials, raw secret-bearing payloads, or unrestricted SQL results.

### Operational Acceptance Target

The GUI should be considered operator-grade only when these checks pass:

- read-only endpoints are deterministic under empty, partial, and populated
  workflow roots;
- Agent Board starts from `runtime_agents` and never infers deprecated aliases;
- Kanban card placement has tested source-to-column reasons;
- preview actions write `workflow_operations` audit rows;
- unsupported actions fail closed with visible reason;
- desktop and mobile smoke screenshots show no overlapping core text;
- development server serves the same committed code as GitHub main;
- no Gateway restart is required for static/read-model-only console changes.

## Version Roadmap

### v0.7: Governed Preview Actions In The GUI

Goal: make the console useful for intervention planning without enabling unsafe
state mutation.

Scope:

- render Kanban card preview buttons from `previewActions`;
- render Evidence Desk preview actions for missing receipt, missing artifact,
  Human Gate, outbox, incident, and checkpoint gaps;
- route every preview through `WorkflowActionGateway`;
- show preview result in a modal/drawer with audit id and redacted payload;
- add regression coverage for action allowlist and audit rows.

Non-goals:

- no drag-and-drop mutation;
- no direct retry button that bypasses preview;
- no Gateway/profile/process controls.

Acceptance:

- every visible preview button maps to an allowlisted action;
- unsupported preview actions are hidden or rendered disabled with a reason;
- preview failures are visible and auditable;
- mobile can open and read preview packages.

### v0.7 Slice A Implementation Status

Status: implemented as governed preview action surfacing.

Delivered:

- Kanban cards now render preview buttons from card-level `previewActions`.
- Dispatch-card rerun preview is mapped to the allowlisted
  `workflow.rerun.agent.preview` action with `dispatchId` payload; the old
  non-allowlisted `workflow.rerun.dispatch.preview` name is no longer emitted
  by the read model.
- Kanban card actions require the card's own `workflowId`; they do not fall
  back to the currently selected workflow, avoiding cross-card/global-board
  preview misbinding.
- Telegram outbox cards expose delivery and requeue previews when an `outboxId`
  is present.
- Evidence Desk now has a Governed Preview Actions section for supervise
  preview, evidence pack opening, incident closeout previews, and outbox
  delivery/requeue previews where applicable.
- Preview action mapping is isolated in `static/console/preview-actions.js` so
  browser behavior and Node regression tests share the same action model.
- Static frontend modules are included in `npm run check`.

Validation recorded for this slice:

- `npm run check`
- `node scripts/workflow_regression_tests.mjs`
- `git diff --check`
- Local Playwright smoke against `http://127.0.0.1:18796` with temporary
  workflow fixtures, covering Kanban preview buttons, rerun preview execution,
  and Evidence Desk governed preview actions on desktop/mobile viewports.
- Independent reviewer `Goodall` checked action routing and confirmed there is
  no bypass of `WorkflowActionGateway`; required fixes for workflow-id binding
  and UI mapping regression coverage were applied before commit.

### v0.8: Agentic Workbench UX

Goal: make the operator path fast enough for real incident handling.

Scope:

- add global search over workflow id, dispatch id, agent id, message-flow id,
  artifact ref, Human Gate id, and incident id;
- add detail drawers for Agent Board and Kanban cards;
- add saved filters for blocked, stale ACK-only, waiting receipt, waiting
  Human, and failed delivery;
- add severity and age sorting;
- add copy controls for ids and artifact refs;
- add mobile Agent Board card layout.

Acceptance:

- an operator can move from Command Center blocker to exact evidence in two
  clicks;
- dense desktop tables stay scannable;
- mobile inspection does not require horizontal table reading for Agent Board;
- filters are reflected in the URL query so links are shareable.

Implemented Slice A: Global Search

- Added read-only `/api/search` with schema `workflow_console_search.v1`;
  the console UI uses `POST /api/search` so operator search terms are not
  placed into browser URLs.
- Search covers workflow ids, dispatch ids, agent ids, message-flow ids,
  telegram outbox ids, artifact refs, Human Gate ids/buttons, runtime run/state
  ids, task ids, and incident ids.
- Search results return normalized `kind`, `id`, `workflowId`, `status`,
  `severity`, `lastEventAt`, `target`, `sourceRefs`, and `matchFields` so the
  UI can jump from a result to the relevant workflow detail tab.
- Search uses redaction helpers across displayed text, ids, target refs, and
  source refs; suspicious token/API-key/`tawhg:` search terms are rejected with
  `rejected_sensitive_query` and are not executed or echoed verbatim.
- The console topbar now has a global search form; results include Open, Copy
  Id, and Copy Workflow controls.
- Current result sorting prioritizes exact id/workflow matches, then id/ref
  matches, then newest event time. Full saved-filter URL state remains future
  v0.8 work.

Validation recorded for this slice:

- `npm run check`
- `node scripts/workflow_regression_tests.mjs`
- `git diff --check`
- Local Playwright smoke against `http://127.0.0.1:18797` with temporary
  workflow fixtures, covering search submission, dispatch/message-flow results,
  Open navigation to Dispatches, desktop rendering, and mobile rendering at
  `390x844`; mobile page-level `scrollWidth` matched viewport width, with only
  expected table-local horizontal scrolling.
- Independent reviewer `Hilbert` found required fixes for sensitive search-term
  transport/echo, result-field redaction, and partial-schema query isolation;
  fixes and regression coverage were applied before commit.

Implemented Slice B: Detail Drawers And Mobile Agent Cards

- Agent Board rows now expose an Inspect control that opens a detail drawer
  with identity, runtime endpoint, current semantic state, workload, latest
  activity, source refs, copy controls, and redacted raw JSON.
- Workflow Kanban cards now expose Inspect and Copy controls before governed
  preview actions. The drawer shows card state, evidence chain, missing
  evidence, source refs, copy controls, and workflow navigation.
- Drawer navigation closes the drawer before opening workflow detail, keeping
  the operator path clear on desktop and mobile.
- Mobile Agent Board switches from dense tables to agent cards below tablet
  width, preserving inspect/copy controls without horizontal table reading.
- Detail drawers are read-only surfaces. They do not add drag/drop mutation,
  runtime controls, Gateway controls, or direct workflow writes.

Validation recorded for this slice:

- `npm run check`
- `git diff --check`
- Local Playwright smoke against `http://127.0.0.1:18798` with temporary
  workflow fixtures, covering desktop Agent Inspect, desktop Kanban Inspect,
  mobile Agent Board card rendering, and mobile drawer rendering at `390x844`.
  The mobile page-level `scrollWidth` matched viewport width with no detected
  overflowing elements.

Implemented Slice C: Saved Filters, URL State, And Sorting Controls

- Added shared workbench controls to Agent Board, Workflow Kanban, and Global
  Search. Saved filters cover all, blocked, stale ACK, waiting receipt, waiting
  Human, and failed delivery.
- Added severity filtering and age/severity sorting controls. Sorting and
  filtering are derived client-side from already-redacted read-model payloads;
  they do not mutate workflow business state.
- Added URL-reflected state for `console`, `workflow`, `tab`, `q`, `filter`,
  `severity`, and `sort`. Filtered Agent Board, Kanban, and Search links can
  be refreshed or shared and restore the same operator view.
- Added visible shown/total counters and filtered summary cards so operators
  can tell whether they are looking at the full read model or a narrowed view.
- Mobile controls collapse into a one-column layout and keep page-level width
  within a 390px viewport.

Validation recorded for this slice:

- `npm run check`
- `git diff --check`
- Local Playwright smoke against `http://127.0.0.1:18799` with temporary
  workflow fixtures, covering Agent Board saved filter URL restore, Search
  query/filter/sort URL state, Kanban saved filter URL state, select visual
  state restoration from URL, and mobile `390x844` no-overflow checks.

### v0.9: Evidence And Incident Workspace

Goal: turn scattered governance facts into reviewable packages.

Scope:

- create a workflow evidence package view;
- create an incident package view;
- include review-gate status, rollback/stop boundary, missing evidence, and
  next Human Gate readiness;
- expose timeline compression for long workflows;
- support export of a redacted evidence bundle for Cat Claw / Flashcat review.

Acceptance:

- Cat Claw can review a Human Gate package from one page;
- missing evidence is listed before approval-oriented content;
- every package links back to raw source refs and audit rows;
- package export is redacted and timestamped.

Implemented Slice A: Top-Level Evidence Workspace

- Added a dedicated Evidence console view between Kanban and Workflows. The
  view keeps the selected workflow in URL state so an operator can refresh or
  share `console=evidence-workspace&workflow=<id>`.
- The workspace assembles the existing workflow evidence desk, evidence pack,
  and incident closeout read models into one review surface. It does not add
  new business-state writes.
- Missing evidence appears before approval-oriented sections. Review readiness
  summarizes Cat Claw audit readiness, Human Gate submission readiness, receipt
  presence, Human Gate records/buttons, checkpoints, artifacts, and sent outbox
  evidence.
- Evidence pack manifest counts, source refs, incident package previews, and a
  compressed latest-first timeline are visible on the same page.
- Export downloads the already redacted Evidence workspace aggregate
  (`workflow_console_evidence_workspace.v1`) as a timestamped JSON bundle for
  Cat Claw / Flashcat review; the underlying Evidence Pack tab keeps its own
  timestamped pack-only export.

Validation recorded for this slice:

- `npm run check`
- `git diff --check`
- `node scripts/workflow_regression_tests.mjs`
- Local Playwright smoke against `http://127.0.0.1:18800` with a temporary
  workflow fixture, covering Evidence workspace URL deep link restore,
  workflow header hydration for workflows outside the current left-queue view,
  missing-evidence-first ordering, rollback/pause/stop boundary rendering,
  full workspace JSON export control, underlying Evidence Pack tab navigation,
  visible timeline text cleanup, and mobile `390x844` no-overflow checks.
- Independent reviewer `Lagrange` found required fixes for workspace export
  scope, Human Gate pause/stop control derivation, and timestamped pack-only
  export filenames; fixes were applied before commit.

### v1.0: Operator-Grade Workflow Console

Goal: reach a stable console baseline comparable to mainstream agent control
planes while preserving trading-system safety boundaries.

Scope:

- Command Center is the default triage home;
- Agent Board, Kanban, Evidence, Operations, and workflow detail are integrated
  through consistent source refs;
- preview-first actions cover common repair and closeout preparation;
- write actions remain explicitly disabled unless startup policy enables them;
- audit, redaction, mobile inspection, and rollback visibility are mandatory.

Acceptance:

- a stale dispatch, missing receipt, failed Telegram delivery, blocked Human
  Gate, and runtime failure can each be diagnosed from GUI surfaces without
  raw database inspection;
- every operator action has preview, audit, and failure evidence;
- write actions remain disabled by default and require explicit startup policy,
  role/policy gating, and audit evidence before they can appear as executable
  controls;
- preview and evidence export surfaces are role/policy gated and redacted;
- safety boundaries remain enforced in code, not only documentation;
- subagent/code-review quality gates are recorded for the release.

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
- `/api/search` result coverage for dispatch, agent, artifact ref, Human Gate,
  Human Gate button, incident, empty query, and callback-token non-discovery;
- redaction in every new response;
- no mutation from GET routes;
- action-gateway audit when preview actions are later added.

Frontend smoke:

- start console against a temporary workflow root;
- open desktop and mobile viewports;
- verify Command Center, Agent Board, Kanban, and Evidence Desk render without
  overlapping text;
- verify global search renders result cards, copy controls, and workflow-detail
  navigation on desktop and mobile;
- verify Agent Board and Kanban Inspect drawers render source refs, copy
  controls, raw JSON, and workflow navigation without mutation;
- verify mobile Agent Board uses cards instead of requiring horizontal table
  reading, and drawers do not create page-level horizontal overflow;
- verify saved filters, severity filters, age/severity sorting, URL refresh
  restore, and browser back/forward behavior in Agent Board, Kanban, and Search;
- verify Evidence workspace loads from URL state, lists missing evidence before
  Human Gate readiness, exposes source refs, opens underlying Evidence Desk /
  Pack / Incident tabs, and downloads the redacted workspace bundle JSON;
- verify cards and tables remain scrollable;
- verify empty-state rendering.

Development-server smoke:

- deploy through GitHub-managed checkout only;
- start console as a separate read-only process on `127.0.0.1:8791`;
- access through the existing local tunnel `127.0.0.1:18791`;
- verify `/health`, `/api/config`, `/api/command-center`,
  `/api/agent-board`, `/api/kanban`, and a workflow-scoped
  `/api/workflows/<workflowId>/evidence-pack`.

Gateway restart is not required for console-only static/read-model changes
unless plugin runtime loading changes require it separately.

## Rollout Boundaries

- v0.4 is read-only and implemented.
- v0.5 semantic current-state projection is implemented.
- v0.6 runtime bridge semantic event ingestion is implemented.
- v0.7 governed preview actions in Kanban and Evidence Desk are implemented,
  still preview-first and audit-first.
- v0.8 Slice A implements global search and copy/open controls. Slice B
  implements Agent/Kanban detail drawers and mobile Agent Board cards.
  Slice C implements saved filters, URL-reflected filter state, and expanded
  severity/age sorting controls.
- v0.9 Slice A implements the top-level Evidence workspace that packages
  workflow evidence desk, evidence pack, incident closeout, readiness, missing
  evidence, compressed timeline, source refs, and redacted export for Cat Claw /
  Flashcat review. Remaining v0.9 work should harden package semantics against
  richer production incidents and expand raw audit-row links where the read
  model exposes stable row anchors.
- v1.0 is the operator-grade baseline: integrated triage, registry-first agent
  workbench, derived Kanban, evidence packages, governed previews, redaction,
  audit, and mobile inspection.
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
- Which v0.7 preview actions should be exposed first if the development server
  shows sparse real Kanban cards?
- Should Evidence package export be a console-only artifact, a workflow
  artifact, or both?
- Which write actions, if any, should be considered after v1.0, and what Human
  Gate policy must be attached before they can be enabled?

## Review Record

2026-06-12: local Codex subagent `Leibniz` reviewed this plan against workflow
runtime boundaries, existing console/read-model/action-gateway architecture,
Human Gate safety, table coverage, and testability. Verdict was `approve with
changes`. The requested changes were applied:

- added missing Human Gate, checkpoint, event, and review-gate source tables;
- clarified that `docs/workflow-console.md`'s old Phase Hold is historical and
  superseded by this read-only / preview-first GUI plan;
- added a Cat Claw OpenClaw-only Agent Board regression requirement.

2026-06-13: local Codex subagent `Heisenberg` reviewed the expanded target
console specification and v0.7-v1.0 roadmap. Verdict was `approve`; optional
hardening suggestions were applied:

- clarified the navigation path as audited preview or explicitly
  policy-enabled action;
- added role/policy gating for preview and evidence export surfaces;
- made disabled-by-default write controls part of v1.0 acceptance.
