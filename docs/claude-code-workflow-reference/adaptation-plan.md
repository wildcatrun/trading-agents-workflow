# Adaptation Plan For trading-agents-workflow

Created: 2026-05-31
Status: initial plan

This plan converts Claude Code Dynamic workflow design signals into
`trading-agents-workflow` improvements. It is scoped to the existing plugin,
database, control loop, Human Gate flow, and workflow console. It does not
create a parallel scheduler or a second console.

## Design Thesis

Claude Code Dynamic workflows show that complex agent work improves when the
orchestration plan is externalized from the main chat context into a readable,
resumable runtime artifact. For `trading-agents-workflow`, the equivalent is
not arbitrary JavaScript. The equivalent is:

```text
Workflow Plan Spec v2
  -> durable phase/node state
  -> registry-resolved dispatch
  -> runtime receipts
  -> independent verification
  -> Human Gate at stage boundaries
  -> evidence pack and checkpoint
```

The plugin already has important foundations: `workflow_runs`,
`workflow_tasks`, `workflow_events`, `workflow_checkpoints`,
`workflow_session_packs`, `message_flows`, `runtime_agents`,
`human_gate_buttons`, `side_effect_ledger`, `control_loop_jobs`, and a web
console. The next step is to make phase, node, agent run, receipt, operation,
and verification state first-class.

## Non-Negotiable Cat-System Boundaries

- `runtime_agents` remains the source of truth for target identity, platform,
  workflow ingress, and dispatch eligibility.
- Cat Brain `main` owns semantic decomposition, plan synthesis, incident
  command, and next-round governance.
- Cat Claw `cat_claw` owns secretary audit, Flashcat-facing reporting, and
  Human Gate submission. It audits plan completeness; it does not invent
  missing A/B/C option content.
- Human Gate is button-first and token-bound. Flashcat original words are
  required before a gate is complete.
- Trading, deployment, database, Gateway, credential, OAuth, and live-execution
  actions need explicit policy gates and, when required, Human Gate.
- Console actions must be governed operations, not direct business-table edits.
- Side effects need idempotency keys, receipts, uncertainty state, and rollback
  or stop conditions.

## Target Workflow Lifecycle

1. Understand
   - Cat Claw or another governed entry point turns Flashcat intent into a
     Task Launch Package.
   - The package records objective, stop condition, risk tier, participants,
     registry resolution, missing context, and whether Human Gate is required.

2. Decompose
   - Cat Brain reviews and converts the package into `Workflow Plan Spec v2`.
   - The plan contains phases, nodes, dependencies, owners, tools/capabilities,
     expected artifacts, acceptance criteria, verifier policy, and failure
     routes.

3. Materialize
   - Approved nodes become `workflow_tasks`, `workflow_phases`, and, when
     needed, `workflow_session_runs`.
   - Targets are resolved through `runtime_agents`.
   - Dispatch records carry trace id, idempotency key, attempt, expected
     artifact, and receipt requirements.

4. Execute
   - Control loop jobs advance ready work.
   - Runtime adapters execute through their registered ingress.
   - Runtime output becomes `workflow_agent_runs`, `runtime_runs`, receipts,
     artifacts, message_flow closure records, or side-effect records.

5. Verify
   - A verifier/refuter node checks whether the node or phase acceptance
     criteria are satisfied.
   - Missing evidence keeps the workflow in evidence collection or repair; it
     does not produce a premature Human Gate.

6. Human Gate
   - Human approval is a stage boundary, not a mid-run free-text interruption.
   - Pending gates preserve the same gate id and button ids for re-delivery.
   - Pause and terminate remain explicit gate outcomes.

7. Checkpoint And Evidence Pack
   - The workflow writes a checkpoint before Human Gate, before side effects,
     after runtime receipt, and before closeout.
   - A final evidence pack exports the plan, phases, dispatches, receipts,
     Human Gate records, side effects, incidents, readiness, and artifacts.

## P0: Auditable Closure

### P0.1 Workflow Plan Spec v2

Create a canonical plan artifact schema under docs and generated artifacts.
Required sections:

- `meta`: workflow id, trace id, created at, source, risk tier.
- `objective`: goal, acceptance criteria, stop condition.
- `participants`: agent ids and registry resolution.
- `phases`: ordered phase graph.
- `nodes`: executable, verifier, reducer, secretary-audit, and Human Gate
  nodes.
- `evidence`: required artifact and receipt references.
- `humanGatePolicy`: A/B/C options, pause, terminate, Chinese report, original
  words requirement.
- `resumePolicy`: checkpoint, idempotency, reuse/invalidation rules.
- `failureRoutes`: retry, verifier failure, incident, Human Gate, stop.

Initial implementation may generate this from the existing Task Launch Package
path. It should not auto-dispatch.

Draft contract: `workflow-plan-spec-v2.md`.

Initial runtime bridge: `workflow.task.draft` emits `spec.planSpecV2`, and
Task Launch Package v1 carries the same structure as an additive compatibility
field. Plan Spec v2 is not yet the materialization source of truth; current
`workflow_tasks` materialization still follows Task Launch Package v1.

### P0.2 First-Class Phase State

Add or draft schema for `workflow_phases`:

```text
phase_id
workflow_id
phase_key
ordinal
status
objective
success_condition
evidence_required_json
verifier_agent
reviewer_agent
human_gate_required
rollback_policy_json
started_at
completed_at
created_at
updated_at
```

Keep `workflow_tasks.phase` for compatibility, but prefer `phase_id` when
available.

Initial runtime bridge: `workflow_phases` is now created as an additive table.
`workflow.task.launch.approve` synchronizes planned phase rows from
`planSpecV2.phaseGraph` after the workflow run is materialized and before task
creation. The console phase endpoint merges `workflow_phases` with task,
dispatch, and runtime evidence, and still falls back to `workflow_tasks.phase`
for older workflows.

### P0.3 First-Class Agent Runs

Add or draft schema for `workflow_agent_runs`:

```text
agent_run_id
workflow_id
phase_id
task_id
dispatch_id
runtime_run_id
session_run_id
runtime
agent_id
status
attempt
input_hash
output_hash
receipt_ref
error
started_at
completed_at
created_at
updated_at
```

This gives the console a stable path from phase to agent work instead of
inferring from several tables.

Initial runtime bridge: `workflow_agent_runs` is now created as an additive
index table. `runtime_runs` writes are mirrored as `runtime.<runtimeRunId>`
agent-run rows, and `workflow_session_runs` start/complete updates are mirrored
as `session.<runId>` rows. The table is read-only/index-only; dispatch,
runtime, and session run tables remain the authoritative execution ledgers.
The console exposes `GET /api/workflows/:workflowId/agent-runs`.
The phase read model also merges `workflow_agent_runs` back into each phase so
operators can inspect phase -> task -> dispatch -> runtime/session run ->
receipt linkage in one console card.

### P0.4 Unified Receipts

Add or draft `workflow_receipts`:

```text
receipt_id
workflow_id
phase_id
task_id
agent_run_id
dispatch_id
runtime_run_id
message_flow_id
outbox_id
human_gate_id
side_effect_id
receipt_type
status
source_agent
artifact_ref
evidence_hash
summary
payload_json
created_at
```

This table should not replace specialized tables immediately. It should index
and normalize their receipt facts for review, readiness, and evidence export.

Initial console bridge: before adding a durable `workflow_receipts` table,
`GET /api/workflows/:workflowId/receipts` derives a unified receipt view from
existing ledgers. It keeps specialized tables authoritative while exposing one
operator surface for agent-run receipts, message-flow output/delivery flags,
Telegram outbox terminal evidence, Human Gate records/buttons, checkpoints,
artifacts, and side-effect records.

Initial export bridge: `GET /api/workflows/:workflowId/evidence-pack` returns a
read-only JSON bundle assembled from console read models. The console `Export`
tab downloads the bundle in the browser instead of writing a server-side export
artifact. This keeps P0.6 free of workflow state mutation while giving
operators a portable evidence package.

Initial Human Gate readiness bridge:
`GET /api/workflows/:workflowId/human-gate-readiness` returns a read-only
checklist for Cat Claw review and Human Gate submission preparation. It checks
Human Gate record linkage, A/B/C approve options, pause/terminate controls,
Chinese body, option detail completeness, checkpoint/artifact/receipt evidence,
Cat Claw source path, Telegram delivery observation, and Flashcat
original-words capture after selection. The console `Gate Readiness` tab shows
this checklist without submitting the gate or mutating workflow state.

### P0.5 Governed Operations

Add or draft `workflow_operations`:

```text
operation_id
action
scope_type
scope_id
requested_by
reason
risk_tier
status
idempotency_key
human_gate_id
preview_result_json
result_json
error
created_at
completed_at
```

Console action JSONL can remain as a compatibility audit, but DB operations
must become the source of truth before real pause/resume/stop/rerun controls.

Initial runtime bridge: `workflow_operations` is now an additive DB table.
Console preview actions write durable operation records in addition to the
existing JSONL log. Rejected console actions are also recorded. This is still an
audit base only; real pause/resume/stop/rerun writes remain deferred until
state-transition checks and Human Gate policy are implemented.

### P0.6 Supervise Preview Upgrade

Upgrade `workflow.supervise.preview` to produce a phase/node explanation:

- current phase and next candidate phase;
- ready nodes and why they are ready;
- blocked nodes and missing evidence;
- would-dispatch list;
- would-sync list;
- would-checkpoint flag;
- would-report / Human Gate condition;
- policy gate warnings;
- side-effect uncertainty warnings.

### P0.7 Console Read-Only Upgrade

Use the existing console. Add:

- Plan tab.
- Phase Progress tab.
- Acceptance / Evidence tab.
- Task Launch Package queue.
- Human Gate Center compliance summary.
- Evidence Pack export preview.

Do not add production deploy, Gateway restart, database migration, live trading,
or direct approval execution controls in this phase.

Current mapping after the first implementation batch:

- `Phase Progress tab` maps to the implemented `Phases` tab.
- `Acceptance / Evidence tab` is partially covered by `Receipts`, `Evidence`,
  `Export`, `Gate Readiness`, and phase evidence-chain sections.
- `Human Gate Center compliance summary` maps to `Gate Readiness` plus Human
  Gate and Operations summaries.
- `Evidence Pack export preview` maps to the implemented `Export` tab.
- `Plan tab` and `Task Launch Package queue` are not implemented as dedicated
  tabs yet. Plan Spec v2 exists in task draft/launch payloads, but the console
  still needs a direct plan/package queue surface.

## P1: Autonomous Progress With Verification

### P1.1 Verifier And Refuter Nodes

Add node types:

- `worker`: performs bounded work.
- `verifier`: checks acceptance and evidence.
- `refuter`: searches for counter-evidence or failure modes.
- `reducer`: synthesizes fan-out results.
- `secretary_audit`: Cat Claw compliance audit.
- `human_gate`: Flashcat decision boundary.

Verifier/refuter results should be stored as independent acceptance evidence.

Current implementation note: `workflow_verification_results` is now an
append-only durable table for verifier, refuter, reducer, secretary-audit, and
evaluator result records. The governed action `workflow.verification.record`
and compatibility aliases can record scoped results against workflow, phase,
task, dispatch, agent-run, or runtime-run ids. The console exposes
`GET /api/workflows/:workflowId/verification` and a `Verification` tab.

Boundary:

- verification records do not mutate workflow, task, dispatch, Human Gate, or
  side-effect state;
- verifier/refuter output is evidence for later evaluator and Cat Claw review,
  not an automatic approval path;
- payloads and console responses are redacted before persistence/output.

### P1.2 Workflow Evaluator

Adapt Claude `/goal` as a workflow-level evaluator:

- Runs after supervisor cycles or phase completion.
- Reads plan spec, acceptance criteria, receipts, artifacts, and verifier
  outputs.
- Emits `met`, `not_met`, `needs_evidence`, `needs_human_gate`, `blocked`, or
  `side_effect_uncertain`.
- Must be independent from the worker that produced the artifact.

Current implementation note: `workflow.evaluate` now runs a deterministic
evidence-only evaluator and writes its result as
`workflow_verification_results.result_type='evaluator'`. It reads workflow
status, Plan Spec presence, acceptance criteria, task/dispatch/runtime counts,
artifact and receipt evidence, verifier/refuter results, pending Human Gates,
side-effect uncertainty, and active incident signals.

Boundary:

- evaluator output is append-only evidence in the Verification tab;
- it does not update workflow, task, dispatch, Human Gate, outbox, runtime, or
  side-effect state;
- `workflow.evaluator.run`, `workflow.evaluation.run`, and
  `workflow.goal.evaluate` are aliases for the same evidence-only evaluator;
- `workflow.evaluator.record` remains a direct alias to
  `workflow.verification.record` for externally supplied evaluator evidence.

### P1.3 Permission Gate Policy

Use `workflow.permission.check` as a policy gate before high-risk actions.
Policy outcomes:

- `allow`
- `deny`
- `requires_human_gate`
- `requires_cat_claw_audit`
- `requires_freshness_check`

Apply to dispatch, runtime drain, Telegram delivery, GitHub push, DB DDL,
Gateway restart, production deploy, trading_core handoff, and live execution.

Current implementation note: `workflow.permission.check` now keeps the original
`allowed`/`reason` capability verdict and adds policy-layer fields:

- `policyOutcome`
- `requirements`
- `policyWarnings`
- `actionable`

Current outcomes include:

- `allow`
- `deny`
- `requires_human_gate`
- `requires_cat_claw_audit`
- `requires_freshness_check`
- `side_effect_uncertain`

Boundary: this is currently a compatibility-preserving policy surface for
controllers and operators. It does not globally convert all existing write
actions into hard failures when `actionable=false`; those hard gates should be
enabled per action path after the corresponding evidence inputs and migration
contract are stable.

Current enforcement note: controlled hard enforcement is now enabled only for
`trade.intent` and `trading_core.receipt`. Those actions record
`permission.policy_blocked` and fail closed when the policy layer returns
`actionable=false`. `workflow.permission.check` remains read-only/advisory, and
other high-risk actions still consume the policy layer as an operator signal.

### P1.4 Controlled Intervention Preview

Add previews for:

- workflow pause;
- workflow resume;
- workflow stop / terminate;
- rerun agent;
- rerun phase;
- exact runtime drain retry;
- Human Gate package generation.

Actual writes should wait for `workflow_operations`, state-transition checks,
and Human Gate policy to be in place.

Current implementation note: a preview-only subset was pulled forward as P0.9
after `workflow_operations` landed, covering workflow pause, resume, stop /
terminate, rerun agent, and rerun phase. Exact runtime drain retry and Human
Gate package generation previews remain in P1.4.

Current execution note: `workflow.pause`, `workflow.resume`, and
`workflow.stop` now have a minimal governed write path. They require Human Gate
and Cat Claw evidence, operator reason, and a rollback/resume boundary, then
write only workflow status/current decision plus an append-only event. They do
not reset tasks, retry/cancel dispatches, drain runtimes, send Telegram, create
Human Gate requests, write side effects, or touch trading state.

### P1.5 Dead-Letter And Stuck-Job Observability

Extend operations and console surfaces for:

- failed control-loop jobs;
- expired leases;
- max-attempt dispatches;
- stale message_flow;
- missing Telegram delivery;
- stuck Human Gate feedback;
- side-effect uncertainty.

Current implementation note: the Operations read model now exposes
`deadLetters` and `deadLetterSummary`, and the existing Operations tab renders
them as `Dead-Letter / Stuck Attention`. The first slice covers failed or
max-attempt control-loop jobs, expired leases, max-attempt dispatches, stuck
Human Gate feedback, uncertain side effects, and stale `message_flow` rows that
require visible delivery but have no delivery receipt. The `message_flow` slice
explicitly excludes `silent`, `local_codex`, `codex`, present delivery receipts,
and recent rows still inside the stuck window. This is read-only observability;
it does not retry, cancel, deliver, reconcile, or mutate state.

Follow-up implementation note: `GET /api/operations/dead-letter-evidence`
returns a single-item `workflow_dead_letter_evidence.v1` bundle for a selected
dead-letter row. The existing Operations tab can open and download this bundle.
It is still read-only and does not create incidents, Human Gate requests,
retries, delivery attempts, or state mutations.

Incident preview note: the single-item bundle now includes a
`workflow_incident_candidate.v1` read-only preview when the selected row still
matches a current dead-letter predicate. The candidate contains suggested
severity, affected planes, evidence references, next actions, exit criteria, and
rollback boundary, but it is not persisted to `incident_states`.

Governed linkage note: `workflow.incident.from_dead_letter.preview` turns the
candidate into a read-only write preview. `workflow.incident.from_dead_letter`
can persist the linked incident only with Human Gate evidence,
Cat Claw/secretary audit evidence, and an operator reason. The write boundary is
`incident_state_only`; it does not repair the dead-letter source, mutate
workflow state, dispatch runtime work, deliver Telegram, or touch side effects.
The console exposes this as a two-step control with a guarded evidence form; the
backend still rejects execution unless writes are enabled and policy evidence is
present.
The guarded form now uses
`GET /api/workflows/:workflowId/incident-evidence-options` to list read-only
Human Gate and Cat Claw/secretary-audit candidates before falling back to manual
id entry.
Closeout note: `GET /api/workflows/:workflowId/incident-closeout` and the
console `Incidents` tab now join linked incident state, workflow incident
events, incident notes, dead-letter evidence, selector evidence, Human Gate
readiness, receipts, and checkpoints into a read-only closeout checklist.
Follow-up preview note: `workflow.incident.closeout.cat_claw_report.preview`
and `workflow.incident.closeout.human_gate_package.preview` now prepare
zero-write closeout drafts from that checklist. They expose evidence gaps,
warnings, Chinese report/package text, and Human Gate A/B/C plus pause/terminate
option structure without persisting artifacts, closing incidents, creating
Human Gate rows, dispatching Cat Claw, sending Telegram, or mutating workflow
state.
Artifact persistence note: `workflow.incident.closeout.artifact.preview` and
`workflow.incident.closeout.artifact` add the first governed closeout artifact
write. The write requires Human Gate evidence, Cat Claw audit evidence, and an
operator reason, then persists JSON/Markdown artifacts plus `artifact_index` and
one audit workflow event only. It still does not close incidents, create Human
Gate rows/buttons, dispatch Cat Claw, send Telegram, retry jobs, or mutate
workflow state.
Human Gate request preview note:
`workflow.incident.closeout.human_gate_request.preview` now reads a persisted
Human Gate closeout package artifact and previews the request, button, Telegram
outbox, and audit event shape that a future governed submit path would create.
It performs zero writes and remains separate from formal Human Gate submission.
Governed submit note:
`workflow.incident.closeout.human_gate_request` now creates the formal pending
Human Gate request surface from the persisted closeout artifact when existing
Human Gate evidence, Cat Claw audit evidence, and an operator reason are
provided. It queues Telegram outbox work but does not deliver Telegram or close
the incident.
Telegram delivery preview note:
`telegram.outbox.delivery.preview` now inspects queued, failed, or
stale-delivering Telegram outbox rows before any send attempt. It reports
claimability, target/text readiness, chunking, button presence, delivery path,
and would-update fields without claiming the row, reading bot tokens, invoking
OpenClaw, calling Telegram, or writing delivery receipts.
Delivery execution policy note:
the same preview now includes execution and receipt policy metadata. It
distinguishes technical eligibility from future governed execution readiness,
requires explicit delivery operator reason and Cat Claw/secretary audit
evidence for Human Gate request delivery, and states the terminal delivery
receipt fields that a later send action must persist.
Governed delivery execution note:
`telegram.outbox.delivery` now wraps the existing delivery worker with the
preview policy. It requires Cat Claw/secretary audit evidence, explicit
delivery operator reason, and an idempotency key, then writes only terminal
Telegram delivery state/receipt evidence and one workflow audit event. It is
not exposed as a console send button. If the outbox is already `sent`, the
action returns an idempotent replay without resending.
Delivery observability note:
Telegram outbox and receipt read models now expose a derived `deliveryReceipt`
state. Human Gate readiness requires complete terminal delivery receipt
evidence rather than status-only `sent`; Operations lists governed delivery
executions/replays, and evidence packs plus incident closeout link delivery
execution records back to Cat Claw/Flashcat audit.
Requeue preview note:
`telegram.outbox.requeue.preview` now evaluates failed or stale-delivering
outbox rows before any resend/requeue attempt. It reports failed retry,
stale-lease reclaim, fresh active lease, and already-sent replay cases, and
requires preservation of original outbox id, Human Gate id, button ids, target,
existing receipts, Cat Claw audit, explicit delivery/requeue reason, and
idempotency boundary. It performs zero writes and does not resend Telegram.
Requeue execution package note:
`telegram.outbox.requeue.execution_package.preview` turns the requeue preview
into a Chinese Cat Claw/Human Gate confirmation package with A/B/C options plus
pause/terminate controls. It separates Cat Claw review readiness from execution
request readiness and keeps the future execution boundary fixed at
`telegram.outbox.delivery`. It performs zero writes, creates no Human Gate, and
does not send Telegram.

Filter implementation note: `GET /api/operations/summary` now accepts
`deadLetterKind`, `deadLetterSeverity`, `deadLetterStatus`, and
`deadLetterLimit`. The existing Operations tab exposes kind, severity, and
status selectors. Filtering changes only the read model/view; it does not alter
dead-letter classification or perform any repair.

## P2: Scale And Operator Experience

### P2.0 Runtime Semantic Observability

The 2026-06-03 `trading_sim` production disk-full incident exposed an ACK-only
blind spot: workflow evidence proved that `cat_body` received the incident
handoff, but not whether semantic repair work had started, which stage was
active, whether later messages interrupted the run, or why a final artifact was
missing.

The detailed plan is maintained in
`runtime-observability-improvement-plan-2026-06-03.md`. Required design
direction:

- distinguish mechanical ACK from semantic ACK;
- bind dispatches to runtime session, ACP turn, prompt, transcript ref, and
  artifact refs;
- record append-only runtime events for stage changes, artifact creation,
  blocking, interruption, completion, and failure;
- project current active agent state for operator lookup;
- classify later-message interaction as queued, parallel, preempted,
  superseded, or ignored;
- extend the existing console and CLI with Workflow Trace, Agent Current State,
  Artifact Provenance, and ACK-only stale queries.

### P2.1 Workflow Templates

Save successful plan specs as templates. Templates are governed JSON specs, not
arbitrary JavaScript scripts.

### P2.2 Phase Graph Revision

Support plan revisions that invalidate only affected phases or nodes when
participants, instructions, tools, or acceptance criteria change.

### P2.3 Tool Call Spans

Add `workflow_tool_calls` or equivalent span records:

```text
tool_call_id
workflow_id
phase_id
agent_run_id
runtime_run_id
tool_name
status
started_at
completed_at
latency_ms
input_hash
output_hash
redacted_input_json
redacted_output_json
error
```

This supports Claude-like observability without leaking credentials or trading
payloads.

### P2.4 SLI Dashboard

Add console metrics for:

- entrance-to-dispatch latency;
- dispatch-to-ack latency;
- receipt completeness;
- Human Gate age;
- message_flow delivery gap;
- runtime error rate;
- side-effect uncertainty;
- readiness false positives;
- stale dispatch trend.

### P2.5 Evidence Pack Export

Create a one-click or CLI evidence export:

- plan spec;
- phase graph;
- runtime_agents snapshot;
- tasks;
- dispatches and runtime runs;
- workflow_receipts;
- message_flow closure;
- Human Gate buttons and Flashcat original words;
- Telegram outbox receipts;
- side-effect ledger;
- incidents and readiness snapshots;
- checkpoints and artifact refs.

## Not To Copy From Claude Code

- Do not auto-approve high-risk actions.
- Do not run arbitrary workflow JavaScript inside the plugin.
- Do not make local Codex, Cat Brain, or the web console a replacement runtime
  for registered agents.
- Do not let a dispatch ACK substitute for user-visible delivery receipt.
- Do not let a worker's own prose substitute for independent verification.
- Do not create a parallel message system or control surface.

## Implementation Status

- 2026-05-31: initial plan created from official Claude Code workflow docs and
  local `trading-agents-workflow` inspection.
- 2026-05-31: implemented initial P0 read-model/UI bridges for Plan Spec v2,
  phases, agent runs, phase evidence chains, unified receipts, evidence-pack
  export, Human Gate readiness, and workflow operation audit records.
- 2026-05-31: pulled a preview-only subset of P1.4 forward as P0.9, adding
  controlled intervention previews for pause, resume, stop, rerun agent, and
  rerun phase. Real writes remain deferred.
- 2026-05-31: implemented P1.1 verifier/refuter result recording as
  append-only acceptance evidence with console observability. It does not
  auto-advance workflows or replace Human Gate.
- 2026-05-31: implemented P1.2 workflow evaluator as deterministic
  evidence-only `workflow.evaluate` output stored in verification results.
- 2026-05-31: implemented P1.3 permission gate policy outcomes on
  `workflow.permission.check` while preserving existing `allowed` semantics.
- 2026-05-31: implemented P1.3a controlled hard enforcement for
  `trade.intent` and `trading_core.receipt`, including CLI evidence inputs,
  regression coverage, and `trading_core` contract smoke compatibility.
- 2026-06-02: promoted `risk.decision` into controlled hard enforcement. The
  write now requires Cat Claw/secretary audit evidence and freshness evidence
  before the existing proposal/Human Gate/Cat Tail dispatch/numeric risk chain
  checks can persist a terminal risk decision.
- 2026-05-31: implemented P1.4 minimal governed execution for
  `workflow.pause`, `workflow.resume`, and `workflow.stop`, while leaving
  rerun/runtime drain/Human Gate package execution deferred.
- 2026-05-31: implemented P1.5 dead-letter/stuck attention observability in
  the existing Operations read model and console tab; the unified list now also
  includes stale visible-delivery `message_flow` gaps and single-item
  dead-letter evidence bundles with read-only incident candidates and governed
  incident linkage.
- 2026-06-03: added the runtime semantic observability improvement plan after
  the `trading_sim` production disk-full incident. The plan closes the
  ACK-only blind spot with semantic ACK, stage events, interruption
  classification, transcript references, artifact provenance, and Agent
  Current State / Workflow Trace surfaces.
- Next checkpoint: evaluate whether `trade.proposal` or selected
  `side_effect.record` resolution paths have enough stable evidence input
  coverage for similarly narrow hard gates.
