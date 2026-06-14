# Workflow Console MVP Skeleton

The workflow console is a thin Human/Workflow Control Plane for `trading-agents-workflow`.

Current scope:

- standalone Node HTTP process
- native static frontend under `static/console/`
- workbench UI for workflow queue, task cards/tables, dispatch/runtime tracking, Human Gate/outbox/evidence panels and raw JSON fallback
- read-only SQLite read model for workflow list/detail, tasks, dispatches, message flows, Human Gate records, outbox, checkpoints, runtime agents and operations summary
- aggregated workflow timeline assembled from tasks, dispatches, runtime runs, message_flow events, Human Gate records/buttons, outbox, checkpoints, artifacts, side effects and incidents
- verifier/refuter acceptance evidence visibility through the Verification tab
- action gateway limited to preview actions by default, with selected governed
  writes only when explicitly enabled
- no second scheduler, no direct business-table writes from the UI

## Start Locally

```bash
node bin/workflow-console.mjs \
  --root /path/to/trading-agents-workflow-root \
  --host 127.0.0.1 \
  --port 8791
```

Open:

```text
http://127.0.0.1:8791
```

Environment variables:

- `TRADING_AGENTS_WORKFLOW_ROOT`
- `WORKFLOW_CONSOLE_HOST` default `127.0.0.1`
- `WORKFLOW_CONSOLE_PORT` default `8791`
- `WORKFLOW_CONSOLE_TOKEN`
- `WORKFLOW_CONSOLE_ALLOWED_HOSTS`
- `WORKFLOW_CONSOLE_READONLY` default `true`
- `WORKFLOW_CONSOLE_ALLOW_WRITES` default `false`

## Safety Defaults

- Binds to loopback by default.
- Rejects unknown Host headers.
- Rejects cross-origin browser mutations.
- Does not accept tokens in query strings.
- Redacts callback tokens, API keys, secrets, passwords and OAuth-ish fields in read API responses.
- `POST /api/actions` only allows preview actions by default:
  `workflow.advance.preview`, `workflow.supervise.preview`, and controlled
  intervention previews for pause, resume, stop, rerun-agent, and rerun-phase.
  Non-preview writes require explicit write enablement and are still limited to
  the action gateway allowlist. The first enabled write slice is
  `workflow.pause` / `workflow.resume` / `workflow.stop`, which still requires
  Human Gate and Cat Claw evidence.
- Preview actions are dry-runs for workflow business state, but they still append
  console operation audit records.

## Development Deployment Snapshot

2026-05-24 v0.3 rollout target state:

- Commit: current GitHub-managed plugin checkout commit
- Development server checkout:
  `/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout`
- Console bind target when started: `127.0.0.1:8791`
- Data source:
  `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db`
- Local access tunnel:
  `127.0.0.1:18791 -> 106.54.53.146:127.0.0.1:8791`
- Runtime log target:
  `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/governance-logs/workflow-console-dev.log`
- Mode: read-only / preview-only

The console is not a required runtime dependency for workflow correctness. It is
an operator observation surface over the workflow DB and governed actions.
GET read-model surfaces are read-only. Preview actions are dry-runs for workflow
business state, but still write console operation audit logs.

v0.3 adds read-only `message_flow` visibility for the current workflow closure
contract:

- per-workflow Message Flow tab;
- flow status, target runtime/agent, return policy, dispatch/run/outbox refs;
- local Codex inbox closure evidence without requiring Telegram receipt;
- `return_policy=silent` closure without false stuck-delivery pressure;
- delivery-required flow attention list in Operations;
- dead-letter / stuck attention list in Operations;
- exact `runtime_drain:<runtime>:<dispatch_id>` job visibility in Operations;
- message_flow lifecycle events in the workflow timeline.

The round record and rollout notes are maintained in
`docs/workflow-console-v0.3-message-flow-observability.md`.

The next GUI evolution plan is maintained in
`docs/workflow-console-agentic-os-kanban-plan.md`. It adapts Agentic OS control
plane patterns and a Hermers-oriented Kanban projection into the existing
console.

Current version map:

- v0.4: implemented read-only Command Center, Agent Board, Workflow Kanban,
  and Evidence Desk.
- v0.5: implemented semantic runtime current-state projection through
  `runtime_semantic_events` and `runtime_current_state`.
- v0.6: implemented real runtime bridge semantic-event ingestion for dispatch
  binding, ACK-only turns, terminal turns, failures, and stale reconcile
  backfill.
- v0.7: implemented governed preview actions in Kanban and Evidence Desk,
  routed through `WorkflowActionGateway`.
- v0.8: implemented Agentic Workbench UX slices: global search, Agent/Kanban
  detail drawers, mobile Agent Board cards, saved filters, URL-reflected
  filters, and severity-age sorting controls.
- v0.9: in progress as Evidence and Incident Workspace. Slice A adds a
  top-level Evidence view that assembles workflow evidence desk, evidence pack,
  incident closeout, Human Gate readiness, missing evidence, compressed
  timeline, source refs, and timestamped workspace JSON export into one review
  surface.
- v1.0: in progress as operator-grade baseline. Slice A promotes Operations
  into a top-level audit workspace with global and workflow-scoped views,
  shareable dead-letter filters, operation summaries, queue pressure,
  delivery execution audit, and disabled-by-default workflow preview controls.
  Slice B upgrades Command Center into a clickable triage home with blocker
  source refs and drilldowns into Operations or workflow detail evidence.
  Slice C adds URL-backed agent/card focus routing across Command Center,
  Global Search, Agent Board, Kanban, and Evidence. Slice D adds a read-only
  command palette for fast jumps across views, workflows, agents, Kanban,
  Evidence, and Operations. Slice E adds a read-only Activity Feed that
  compresses blockers, dead letters, workflow operations, control-loop jobs,
  and message_flow attention into a clickable operator stream. Slice F adds a
  browser-side Live Refresh control with safe manual/live modes for keeping
  read-only operator views current without adding a workflow scheduler. Slice G
  adds a System Status view that exposes console health, action policy, safety
  boundaries, redaction policy, readiness findings, and allowed views/queues.
  Slice H adds visible Action Gate and Export Gate panels around intervention
  previews and evidence downloads, making role/policy/read-only/audit evidence
  explicit in the GUI. Slice I adds an operator context trail with current view,
  workflow, focus, filters, mode, and copyable deep link. Slice J adds a fixed
  Command Center diagnostic matrix for stale dispatch, missing receipt, failed
  Telegram, blocked Human Gate, and runtime failure inspection paths. Slice K
  adds a System Status release gate for the console's operator-grade safety and
  inspection prerequisites. Slice L adds visible release quality gates for
  Spark/subagent review, regression, browser smoke, and deployment evidence.
  Slice M adds an Operations Action Audit Ledger derived from
  `workflow_operations`. Slice N adds Command Center diagnostic evidence
  previews with source refs, related drilldowns, and copyable evidence bundles.
  Slice O adds a generic Source Inspector so redacted source refs on key
  operator surfaces can open suggested Workflow, Evidence, Operations, Agent,
  Kanban, Human Gate, Outbox, Incident, or Message Flow drilldowns without raw
  database inspection. Slice P adds Kanban card action/audit inspection so
  card-level preview actions, audit boundaries, and raw detail routes are
  visible before operators open governed previews. Slice Q adds in-root release
  quality evidence loading so System Status can show recorded Spark review,
  regression, browser smoke, and deployment trace evidence when a governed
  rollout artifact exists. Slice R adds Command Center diagnostic runbooks so
  each v1.0 failure class has a read-only inspection order, evidence refs,
  governed drilldowns, and copyable runbook text. Slice S adds Action Result
  Inspector coverage so governed preview/action responses show operation audit
  anchors, authoritative workflow context when available, dry-run/risk/input-
  hash evidence, failure text, Operations audit routing, and copyable result
  evidence without raw database inspection.

v0.4 Slice A-D are implemented as read-only console surfaces:

- Command Center: global readiness, workflow, runtime, queue, communication,
  Human Gate, evidence, and attention summary.
- Agent Board: registry-first runtime agent table with platform, endpoint,
  dispatchability, Hermers profile-mode evidence when available, current work,
  latest activity, and attention flags.
- Workflow Kanban: stable read-only columns derived from workflow tasks,
  dispatches, runtime runs, message flows, Telegram outbox, Human Gate records,
  and incidents. Cards are source-linked and do not support drag/drop mutation.
- Evidence Desk: workflow-scoped readiness, receipt chain, verification,
  artifact, outbox, message_flow, incident closeout, and missing-evidence view.

The Agent Board is intentionally registry-first. `cat_claw` remains an
OpenClaw secretary/Human Gate entry unless a real Hermers profile is explicitly
registered in `runtime_agents`; near-match Hermers profile-mode evidence must
not create a Hermers ACP target.

## Historical Phase Hold

After v0.2, console feature expansion was intentionally paused. That hold is
now superseded by `docs/workflow-console-agentic-os-kanban-plan.md` for
read-only / preview-first GUI evolution. The old safety constraint still
stands: do not add high-risk real write controls until the cat-system workflow
has stable evidence around dispatch, receipt, message_flow closure, Human Gate,
Telegram delivery, readiness, incidents, checkpoints, and evidence discipline.

Do not add real write controls until the existing cat-system workflow has run
longer and `trading-agents-workflow` has more stable evidence around:

- dispatch/receipt completeness
- runtime bridge behavior
- message_flow closure, including `local_codex` inbox and `return_policy=silent`
- Human Gate button/resume closure
- Telegram outbox delivery
- readiness and incident false positives
- checkpoint and evidence discipline

The previous next-slice note was Task Card Draft and Cat Brain Preheat preview.
The current next GUI slice is the read-only Command Center, Agent Board,
Workflow Kanban, and Evidence Desk plan. Do not prioritize merge, terminate,
approval, Gateway restart, production deploy, live trading, or profile
lifecycle controls.

## Preview Actions

The console must call:

- `workflow.advance.preview`
- `workflow.supervise.preview`

It must not use `workflow.advance` or `workflow.supervise` for planning buttons. Those actions intentionally mutate workflow state and are used by the supervisor/control loop path.

## First Endpoints

- `GET /health`
- `GET /api/config`
- `GET /api/command-center`
- `GET /api/agent-board`
- `GET /api/kanban`
- `GET /api/workflows`
- `GET /api/workflows/:workflowId`
- `GET /api/workflows/:workflowId/phases`
- `GET /api/workflows/:workflowId/tasks`
- `GET /api/workflows/:workflowId/dispatches`
- `GET /api/workflows/:workflowId/runtime-runs`
- `GET /api/workflows/:workflowId/agent-runs`
- `GET /api/workflows/:workflowId/verification`
- `GET /api/workflows/:workflowId/incident-evidence-options`
- `GET /api/workflows/:workflowId/incident-closeout`
- `GET /api/workflows/:workflowId/message-flows`
- `GET /api/workflows/:workflowId/human-gates`
- `GET /api/workflows/:workflowId/human-gate-readiness`
- `GET /api/workflows/:workflowId/outbox`
- `GET /api/workflows/:workflowId/checkpoints`
- `GET /api/workflows/:workflowId/evidence`
- `GET /api/workflows/:workflowId/evidence-desk`
- `GET /api/workflows/:workflowId/receipts`
- `GET /api/workflows/:workflowId/evidence-pack`
- `GET /api/workflows/:workflowId/timeline`
- `GET /api/runtime-agents`
- `GET /api/operations/summary`
- `GET /api/operations/dead-letter-evidence`
- `GET /api/readiness/latest`
- `POST /api/actions`

## Phase-First Read Model

The console exposes `GET /api/workflows/:workflowId/phases` as a read-only
bridge toward `Workflow Plan Spec v2`. When `workflow_phases` rows exist, the
endpoint uses them for phase order, declared status, owners, dependencies,
acceptance criteria, verifier, and plan-node references, then enriches them
with task, dispatch, runtime, agent-run, and receipt counts. When no first-class
phase rows exist, it falls back to grouping existing `workflow_tasks.phase`
values.

This is intentionally observational:

- no phase state is written;
- no dispatch is created;
- no task status is changed;
- no Human Gate is submitted.

The UI contract stays stable across both sources. Responses set `source` to
`workflow_phases+workflow_tasks` when first-class rows are present, otherwise
`workflow_tasks.phase`.

`GET /api/workflows/:workflowId/agent-runs` returns the same additive
`workflow_agent_runs` index used by the phase view, plus `phaseSummary` so the
console can audit which phase has completed agent work, failed agent work, and
receipt references without treating the index as the authoritative execution
ledger.

## Unified Receipts

`GET /api/workflows/:workflowId/receipts` is a read-only derived view. It does
not create a new authoritative receipt table. Instead, it normalizes evidence
from existing ledgers into one console surface:

- `workflow_agent_runs` for runtime/session receipts;
- `message_flows` for runtime output and delivery receipt flags;
- `telegram_outbox` for terminal Telegram delivery evidence;
- Human Gate protocol records and buttons;
- checkpoints, artifacts, and side-effect records.

The response includes `summary`, `evidenceSources`, and normalized `receipts`
with stable chain fields such as `phaseKey`, `taskId`, `dispatchId`,
`runtimeRunId`, `outboxId`, `humanGateId`, and `artifactRef`.

## Verification Results

`GET /api/workflows/:workflowId/verification` returns append-only independent
acceptance evidence from `workflow_verification_results`.

The response includes:

- summary counts by decision and result type;
- verifier/refuter/source agent and runtime fields;
- workflow, phase, task, dispatch, agent-run, and runtime-run scope fields;
- evidence, artifact, and receipt references;
- redacted findings, recommendations, summary text, and raw payload.

The console `Verification` tab is observational. It does not approve work,
advance workflow state, submit Human Gate, retry dispatches, deliver outbox
messages, or write side effects. Verifier/refuter records are inputs for later
workflow evaluation, Cat Claw audit, and Human Gate preparation.

`workflow.evaluate` writes deterministic evaluator output into the same table
with `resultType: evaluator`. The console does not need a separate evaluator
tab; evaluator records appear in the Verification tab alongside verifier,
refuter, reducer, and secretary-audit records.

## Workflow Operations

`workflow_operations` is the durable DB audit base for console-initiated
operations. The existing `bridge/console-operations.jsonl` file remains a
compatibility log, but the DB table is the surface future controlled
intervention previews should build on.

Current behavior:

- every console action receives an `operation_id`;
- allowed preview actions transition from `started` to `completed`;
- rejected or disallowed actions write `rejected` rows;
- preview results are stored in `preview_result_json`;
- token-like text and `tawhg:` strings are redacted before DB/JSONL storage;
- the Operations tab shows recent operations, summary counts, and read-only
  dead-letter / stuck attention rows.

The Operations read model includes `deadLetters`, `deadLetterSummary`, and
`deadLetterAvailableSummary` for:

- failed or max-attempt control-loop jobs;
- expired running job leases;
- dispatches at max attempts;
- stuck Human Gate feedback buttons;
- uncertain side effects;
- stale `message_flow` rows that require visible delivery and have no delivery
  receipt.

These rows are observational only. The console does not retry jobs, cancel
leases, reconcile dispatches, resend Telegram, resume Human Gate, mutate
side-effect rows, or change trading/runtime state from this table. The
`message_flow` attention family excludes `silent`, `local_codex`, `codex`, rows
with existing delivery receipts, and recent rows still inside the stuck window.
`GET /api/operations/summary` supports read-only dead-letter filters:
`deadLetterKind`, `deadLetterSeverity`, `deadLetterStatus`, and
`deadLetterLimit`. The console exposes kind, severity, and status selectors in
the existing Operations tab.

Each dead-letter row can open a read-only evidence bundle through
`GET /api/operations/dead-letter-evidence?workflowId=<id>&kind=<kind>&refId=<id>`.
The bundle returns `workflow_dead_letter_evidence.v1`, primary evidence from the
owning table, and limited related rows such as dispatches, runtime runs,
message_flow events, Telegram outbox rows, Human Gate buttons/records, side
effects, and control-loop jobs. It is an audit/export surface only; it does not
create incidents, retry jobs, reconcile message flows, or mutate workflow state.
When the selected row still matches a current dead-letter predicate, the bundle
also includes a `workflow_incident_candidate.v1` read-only preview with
suggested severity, affected planes, evidence references, next actions, and
exit criteria. This preview is not persisted and does not create an
`incident_states` row.
From that view, the console can also open the full workflow evidence pack via
the existing read-only `GET /api/workflows/:workflowId/evidence-pack` endpoint.
This requires the dead-letter row to carry a valid workflow id; missing or
invalid ids remain a read-only error/not-found state.

The console can also request a read-only governed incident write preview through
`workflow.incident.from_dead_letter.preview`. A real
`workflow.incident.from_dead_letter` write is not automatic: it is allowed only
when console writes are explicitly enabled and the action carries Human Gate
evidence, Cat Claw/secretary audit evidence, and an operator reason. The write
path creates or updates only `incident_states`, incident artifacts, and the
incident workflow event. It does not retry jobs, clear leases, reconcile
dispatches, resend Telegram, resume Human Gate, mutate side effects, or change
workflow status.
The Dead-Letter Evidence view exposes this as a two-step control: first
`Incident Preview`, then a guarded form for Human Gate evidence, Cat Claw audit
evidence, and operator reason. The form loads read-only candidates from
`GET /api/workflows/:workflowId/incident-evidence-options`, derived from Human
Gate records/buttons and secretary-audit/Cat Claw verification results. Each
candidate includes structured recommendation reasons such as same-workflow
scope, Cat Claw source, secretary-audit type, positive status/decision, and
references to the selected dead-letter evidence. If no candidate exists, the
fields remain manually fillable; if the console remains read-only or writes are
not enabled, the backend rejects execution even if the form is filled.

`GET /api/workflows/:workflowId/incident-closeout` is the read-only incident
timeline and closeout checklist view. The console exposes it through the
`Incidents` tab. It joins linked `incident_states`, incident workflow events,
incident timeline notes, Human Gate readiness, derived receipts, checkpoints,
dead-letter evidence, and selector evidence into one audit surface. The
checklist verifies that:

- an incident state exists;
- the selected dead-letter evidence is still current;
- Human Gate evidence is linked or available;
- Cat Claw/secretary audit evidence is linked or available;
- operator reason and rollback/stop boundary are recorded;
- the incident came from the governed `incident_state_only` linkage path;
- Telegram delivery has complete terminal receipt evidence when notification
  delivery is part of the closeout evidence chain;
- a final receipt, checkpoint, or resolved incident exists before closeout.

This endpoint does not resolve incidents, create checkpoints, write receipts,
retry jobs, mutate side effects, or change workflow status. It is an audit and
handoff surface for Cat Claw, Cat Brain, and Flashcat review.

The Operations tab exposes read-only controlled intervention previews:

- `workflow.pause.preview`
- `workflow.resume.preview`
- `workflow.stop.preview`
- `workflow.rerun.phase.preview`

The API also supports `workflow.rerun.agent.preview`. These previews return
eligibility, risk tier, Human Gate requirement, Cat Claw audit requirement,
target counts, violations, warnings, and would-update metadata. They do not
pause, resume, stop, rerun, submit Human Gate, drain runtime, reset tasks, or
mutate workflow state.

The Incidents tab exposes closeout package previews from the closeout checklist.
`workflow.incident.closeout.cat_claw_report.preview` prepares a Chinese Cat
Claw secretary-review draft. `workflow.incident.closeout.human_gate_package.preview`
prepares a Chinese Human Gate package draft with A/B/C options plus pause and
terminate controls. Both actions are read-only: they do not write artifacts,
close incidents, create Human Gate requests/buttons, dispatch Cat Claw, enqueue
Telegram outbox, retry jobs, or change workflow status.

`workflow.incident.closeout.artifact.preview` shows the governed write boundary
for persisting that closeout material as JSON/Markdown artifacts. The matching
write action, `workflow.incident.closeout.artifact`, is available only when
console writes are explicitly enabled and the action carries Human Gate
evidence, Cat Claw/secretary audit evidence, and an operator reason. It writes
only the closeout JSON/Markdown files, two `artifact_index` rows, and one
`incident.closeout_artifact.persisted` workflow event. It does not resolve
incidents, submit Human Gate, create buttons, dispatch Cat Claw, send Telegram,
retry jobs, mutate side effects, or change workflow status.

`workflow.incident.closeout.human_gate_request.preview` reads a persisted
`human_gate_package` closeout artifact and renders the exact Human Gate request
shape that a later governed write would create: one pending Human Gate record,
button-first A/B/C options, pause/terminate controls, one Telegram outbox item,
and one audit event. This action is also read-only. It does not create Human
Gate records, buttons, Telegram outbox rows, workflow events, incident state,
runtime dispatches, or deliveries.

The matching governed write,
`workflow.incident.closeout.human_gate_request`, is available only when console
writes are explicitly enabled and the action carries existing Human Gate
evidence, Cat Claw/secretary audit evidence, and an operator reason. It must
read from a persisted closeout artifact. It creates only the pending Human Gate
record, its button rows, one meeting control event, one queued Telegram outbox
row, and one `human_gate.requested` workflow event. It does not auto-deliver
Telegram, close incidents, update workflow status, dispatch runtime, retry jobs,
mutate side effects, or touch trading state.

The `Outbox` tab exposes `Preview Delivery` for each Telegram outbox row. It
calls `telegram.outbox.delivery.preview`, which is read-only and reports
claimability, target/text readiness, chunk count, Human Gate button presence,
delivery path, would-update fields, execution policy, and receipt policy. The
execution policy separates technical eligibility from future governed execution
readiness; Human Gate request delivery requires Cat Claw/secretary audit
evidence, an explicit delivery operator reason, bound target, and A/B/C approve
controls plus pause/terminate controls. The receipt policy lists the terminal
delivery fields that a later real send action must persist. This preview does
not claim rows,
read bot tokens, invoke OpenClaw, call Telegram, update message-flow delivery
status, or write receipts.

Outbox rows also include a derived `deliveryReceipt` summary. The console shows
whether terminal delivery evidence is complete, partial, missing, or still in
progress. For Human Gate readiness, `status=sent` is not sufficient by itself;
the row must carry complete terminal delivery receipt evidence.

The same tab exposes `Preview Requeue`, backed by
`telegram.outbox.requeue.preview`. It is read-only and evaluates whether a
failed or stale-delivering outbox row could enter a governed retry/reclaim path.
It distinguishes failed retry, stale delivery lease reclaim, fresh active
delivery lease, and already-sent idempotent replay cases. The preview lists the
evidence that must be preserved before any future resend path: original outbox
id, Human Gate id, button ids, target, existing delivery receipts, explicit
delivery/requeue operator reason, Cat Claw/secretary audit for Human Gate
requests, and idempotency boundary. It does not reset status, claim leases,
create Human Gate records, create Telegram outbox rows, send Telegram, write
side effects, or touch trading state.

The Requeue preview panel can open `Preview Execution Package`, backed by
`telegram.outbox.requeue.execution_package.preview`. This converts the requeue
evidence into a Chinese Cat Claw/Human Gate confirmation package with A/B/C
options plus pause and terminate controls. It separates readiness for Cat Claw
review from readiness for a future execution request, and the only future
execution action it names is `telegram.outbox.delivery`. This package preview
does not create Human Gate records/buttons, queue Telegram, reset outbox
status, claim leases, send Telegram, write side effects, or touch trading
state.

When `WORKFLOW_CONSOLE_ALLOW_WRITES=true` and the console is not in read-only
mode, `POST /api/actions` can execute the minimal governed write actions:

- `workflow.pause`
- `workflow.resume`
- `workflow.stop`
- `workflow.incident.closeout.artifact`
- `workflow.incident.closeout.human_gate_request`
- `telegram.outbox.delivery`

Pause/resume/stop require Human Gate evidence, Cat Claw audit evidence,
operator reason, and a rollback/resume boundary or latest checkpoint. They only
update `workflow_runs.status`, `workflow_runs.current_decision`,
`workflow_runs.updated_at`, append a `workflow.intervention.executed` event, and
record `workflow_operations` with `dry_run=0`.

Closeout artifact persistence requires Human Gate evidence, Cat Claw audit
evidence, and operator reason. It writes only the closeout artifact files,
`artifact_index`, one audit workflow event, and the console operation record.

Closeout Human Gate request creation requires a previously persisted closeout
artifact plus existing Human Gate evidence, Cat Claw audit evidence, and an
operator reason. It creates the Human Gate request surface and queued delivery
work only; delivery remains a later queue/runtime action.

Telegram delivery execution uses `telegram.outbox.delivery`. It is not exposed
as a console send button, but the action gateway can execute it when writes are
enabled and the caller supplies Cat Claw/secretary audit evidence, explicit
delivery operator reason, and an idempotency key. It reuses the delivery
preview policy and writes only terminal outbox delivery state/receipt evidence
plus one workflow event. Repeating the action after an outbox is already `sent`
returns an idempotent replay response without resending.

The `Operations` tab lists `telegram.outbox.delivery` operation records in a
dedicated delivery-executions section. It shows outbox id, delivery status,
whether Telegram was sent, whether the result was an idempotent replay, receipt
count, actor, timestamps, and any redacted error. This is an audit surface, not
a resend control.

These writes do not rerun agents or phases, drain runtime, submit Human Gate,
reset tasks, cancel dispatches, write side-effect rows, or touch trading state.
Only `telegram.outbox.delivery` may send Telegram, and only through the
governed delivery boundary above. Rerun execution, exact runtime drain retry,
and Human Gate package execution remain disabled.

## Evidence Pack Export

`GET /api/workflows/:workflowId/evidence-pack` returns a read-only JSON bundle
for operator audit and handoff. It does not write an export artifact on the
server. The console `Export` tab downloads the returned JSON in the browser.

The bundle includes:

- workflow overview;
- phases, tasks, dispatches, runtime runs, agent runs, message flows;
- Human Gate records/buttons, Telegram outbox, checkpoints;
- artifacts, side effects, unified receipts, operations, and timeline events;
- a manifest with section counts, delivery execution counts, generation time,
  redaction policy, and read mode.

## Human Gate Readiness

`GET /api/workflows/:workflowId/human-gate-readiness` returns a read-only
checklist for Cat Claw review and Human Gate submission preparation. The
console `Gate Readiness` tab does not submit a gate or mutate workflow state.

The checklist currently covers:

- linked Human Gate record;
- at least three independent approve/options;
- pause and terminate controls;
- Chinese report/body presence;
- option label/summary/prompt completeness;
- checkpoint, artifact, and receipt evidence;
- Cat Claw secretary path evidence;
- Telegram delivery observation, requiring complete terminal outbox receipt
  evidence rather than status-only `sent`;
- Flashcat original-words capture after a selection.

`readyForCatClawAudit` and `readyForHumanGateSubmission` are conservative
derived flags. They indicate whether required checks have passed; warnings
remain visible for human review.

## Not In This Skeleton

- workflow merge
- drag-and-drop state mutation
- production deploy controls
- Gateway restart/reload controls
- live trading actions
- Human Gate final submit UI
- multi-user RBAC

Those require a stronger operation table, Human Gate review sessions, and deployment review before exposure.
