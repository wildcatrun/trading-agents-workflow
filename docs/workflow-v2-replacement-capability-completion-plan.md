# Workflow v2 Replacement Capability Completion Plan

Status: reviewed development plan  
Created: 2026-07-20  
Scope: remaining replacement capability needed before additional Workflow v1
freezes, archives, or default-kernel cutover
Independent review: subagent `019f7b3c-e3af-7df1-957e-0b69f481d494` passed
after R2 rerun-preview handling and index wording were corrected.

## Purpose

This document converts the remaining v1/v2 cleanup discussion into one
engineering plan. Its purpose is to identify which old Workflow surfaces still
need replacement capability, what the replacement must own, and what evidence
is required before a freeze or retirement decision.

This is not a universal v1 deletion project. Old naming, large file size, or a
legacy label is not enough to justify migration, freeze, or retirement.

## Freeze / Retirement Eligibility Rule

The governing rule is strict:

```text
Only a legacy code block with an equivalent v2/shared replacement, or a proven
no-dependency/no-retention block, is eligible for migration, freeze, or
retirement. If no replacement exists and the block still owns useful behavior,
keep it as legacy_active / shared_substrate and build the replacement first.
```

Eligible candidates must fit one of these two classes:

1. **Overlapped capability:** v2 or a shared replacement already owns the same
   useful behavior, with parity evidence and call-site migration evidence.
2. **No-dependency retiree:** the block has no v2/runtime/live-state dependency,
   no active caller, and no remaining audit/read/history value beyond Git.

Excluded from v1 freeze/retirement:

- shared substrate used by v2, runtime adapters, Human Gate, `message_flow`,
  outbox, readiness, receipt, incident, side-effect, or trading boundaries;
- `legacy_active` blocks that still own valid behavior and lack a proven
  replacement;
- read-only/archive evidence surfaces that still preserve historical inspection
  or recovery value;
- old-named infrastructure that v2 deliberately continues to use as shared
  substrate.

Decision order for any future batch is:

1. classify the block as overlapped, no-dependency, shared substrate, or active
   legacy;
2. prove the replacement or prove no dependency/no retention;
3. inventory live callers, state tables, runtime paths, and evidence readers;
4. only then move the row into a freeze candidate state;
5. run the unified batch regression and independent review before delivery.

This plan does not authorize deleting shared infrastructure. It also does not
authorize renaming shared infrastructure to v2 merely to make the code look
newer. Shared substrate should keep shared names unless there is a real
coexisting legacy/new implementation that requires a temporary disambiguator.

## Current Count

As of P36, no further legacy execution block should be frozen by default before
replacement work is completed or no-dependency/no-retention evidence is proven.

Remaining replacement work is **4 capability families**:

| Family | Current surfaces | Current class | Replacement target | Freeze posture |
| --- | --- | --- | --- | --- |
| Checkpoint and archive recovery | `workflow.checkpoint`, `workflow.context_checkpoint`, `context.checkpoint`, operator `workflow-checkpoint` | `frozen_writer_diagnostic / read_only_legacy_export / v2_shared_writers` | `workflow.supervisor.checkpoint`, `workflow.archive.checkpoint`, and `workflow.checkpoint.legacy_export` | P34 complete: legacy writer frozen; v2/shared writers and read-only export remain. |
| Intervention and evaluation | `workflow.pause`, `workflow.resume`, `workflow.stop`, `workflow.terminate`, `workflow.evaluate`, `workflow.rerun.agent.preview`, `workflow.rerun.phase.preview` | `frozen_compatibility` for lifecycle/evaluator writers; rerun previews remain read-only compatibility | `workflow.v2.intervention_readiness.preview`, settlement evidence, gated `workflow.v2.pause/resume/stop/terminate`, `workflow.v2.evaluation_snapshot.preview`, `workflow.v2.evaluation.record`, and `workflow.v2.validate`; rerun previews remain read-only compatibility until mapped to v2 successor/handoff readiness | Keep legacy lifecycle/evaluator writers default blocked behind explicit escape hatches during the observation window. |
| Scheduler and maintenance service | `workflow.schedule.*`, `workflow.scheduler.*`, `workflow.control_loop.tick`, `workflow.loop.tick`, `workflow.reconciler.tick`, `workflow.control_loop.job.*` | `shared_scheduler / shared_maintenance` with one legacy lane default-closed | Approved-plan schedule runner and shared maintenance service with lane ownership, receipts, requeue, and evidence | Do not freeze whole surface; split and retire only legacy lanes/aliases after service cutover. |
| Generic runtime dispatch bridge | `runtime.bridge.drain`, `meeting.dispatch`, `meeting.ingest`, `meeting.resume`, `meeting.disperse`, `meeting.runtime_participant` | `shared_runtime_substrate / shared_adapter` | Generic dispatch package bridge that preserves `runtime_agents`, `message_flow`, idempotency, receipts, and adapter evidence | Do not freeze until replacement proves generic dispatch parity. |

Secondary compatibility/read-only surfaces remain tracked but are not current
kernel blockers:

- `workflow.task.draft`, `workflow.task.list`, `workflow.tasks`, and
  `workflow.task.launch.list` are explicit compatibility preview/archive
  shells. They do not execute new work and are not kernel blockers; final
  removal still needs archive/read-model observation evidence.
- `research.*`, `instrument.*`, `radar.*`, `thesis.*`, and `gate.review` belong
  to a future research/data workflow-template plan, not the current kernel
  cutover.

## Non-Negotiable Boundaries

- Do not modify `message_flow`, Human Gate, outbox, incident, side-effect,
  `runtime_agents`, or trading-core receipt behavior to fit one task's
  semantics.
- Do not freeze or delete shared substrate because it has legacy naming.
- Do not create a parallel runtime registry, scheduler, message bus, Human Gate,
  outbox, or trading side-effect ledger.
- Do not make `workflow.v2.control_loop.tick` silently inherit all generic
  maintenance responsibilities. Worker lifecycle execution and shared
  maintenance are separate ownership questions.
- Do not route production work through raw schedules, ad-hoc direct writes, or
  legacy mutating actions without approved template, approved plan, or explicit
  Human Gate evidence.

## Workstream R1: Checkpoint and Archive Recovery

### P28 Progress

`workflow.archive.checkpoint.preview` and `workflow.archive.checkpoint` now
cover v2 Human Gate archive closeout checkpointing for matching v2 plan state.
The Human Gate archive branch is retargeted to the new writer when the selected
button carries a matching v2 plan id; otherwise it keeps the legacy
fallback path. P33 later converts that fallback to read-only
`workflow.checkpoint.legacy_export.human_gate_archive_fallback`. This removes
the v2 archive closeout dependency on legacy `workflow_runs` / `workflow_tasks`
row shape, but it does not yet make the legacy checkpoint writer
freeze-eligible.

Reference: `docs/workflow-p28-archive-checkpoint-writer.md`.

### P29 Progress

Operator checkpoint routing is now explicit source-class routing:

- `legacy_compat_checkpoint` now routes to read-only
  `workflow.checkpoint.legacy_export` after P33;
- `v2_plan_checkpoint` routes to `workflow.supervisor.checkpoint` and requires
  `planId`;
- `human_gate_archive_checkpoint` routes to `workflow.archive.checkpoint` and
  requires `planId`, `humanGateId`, and `buttonId`.

The routing is shared by `bin/cat-meeting-governance.mjs` and the OpenClaw
plugin CLI command. This removes the operator CLI recovery blocker for v2/shared
checkpoint writers. It does not freeze `workflow.checkpoint`; P33 later removes
known mutating caller dependencies by retargeting legacy compatibility recovery
and internal fallback paths to read-only export.

Reference: `docs/workflow-p29-checkpoint-cli-source-class-routing.md`.

### P30 Progress

Ambiguous context checkpoint aliases are retired as write paths:

- `workflow.context_checkpoint` and `context.checkpoint` now canonicalize to the
  read-only diagnostic `workflow.checkpoint.legacy_alias`;
- the diagnostic returns replacement source-class routes and writes no
  checkpoint, artifact, or artifact index row;
- known explicit legacy compatibility callers now use read-only
  `workflow.checkpoint.legacy_export` after P33;
- `workflow.supervise` escape-hatch checkpointing remains available only behind
  the frozen legacy action gate and reports
  `checkpointPath=workflow.checkpoint.legacy_export.legacy_supervise_escape_hatch`
  after P33.

Reference: `docs/workflow-p30-context-checkpoint-alias-retirement.md`.

### P31 Progress

Bare `workflow.checkpoint` writes are no longer allowed:

- `workflow.checkpoint` requires an explicit compatibility `sourceClass`;
- missing or unsupported source classes return a non-mutating blocked
  diagnostic and do not initialize workflow layout;
- operator CLI legacy recovery keeps `legacy_compat_checkpoint` as a source
  class, retargeted to read-only export in P33;
- legacy supervise escape-hatch checkpointing reports
  `legacy_supervise_escape_hatch_checkpoint`, retargeted to read-only export in
  P33;
- Human Gate archive fallback uses
  `human_gate_archive_legacy_fallback_checkpoint`, retargeted to read-only
  export in P33.

Reference: `docs/workflow-p31-explicit-legacy-checkpoint-source-gate.md`.

### P32 Progress

Legacy checkpoint usage was audited read-only:

- dev-server state-root snapshot has `workflow_checkpoints=0` and
  `workflow_runs=0`, with no event/message/log keyword hits for legacy
  checkpoint recovery;
- local legacy checkpoint rows are old smoke artifacts, not live state;
- before P33, remaining write-capable paths were compatibility mechanisms:
  operator legacy recovery, legacy supervise escape hatch, and Human Gate
  archive fallback without matching v2 plan state.

Reference: `docs/workflow-p32-legacy-checkpoint-usage-audit.md`.

### P33 Progress

Remaining legacy checkpoint compatibility paths now use read-only export:

- operator `legacy_compat_checkpoint` routes to
  `workflow.checkpoint.legacy_export`;
- legacy supervise escape-hatch checkpointing reports
  `workflow.checkpoint.legacy_export.legacy_supervise_escape_hatch`;
- Human Gate archive fallback reports
  `workflow.checkpoint.legacy_export.human_gate_archive_fallback`;
- these paths return recovery-shaped payloads without writing
  `workflow_checkpoints`, artifacts, or `artifact_index`.

Reference: `docs/workflow-p33-legacy-checkpoint-export-diagnostic.md`.

### P34 Progress

The legacy mutating `workflow.checkpoint` writer is frozen:

- direct `workflow.checkpoint` now returns
  `workflow_checkpoint_frozen_result.v1`;
- it is read-only, blocked, and writes no checkpoint rows or artifacts;
- it is removed from console optional write actions and mutating permission
  rules;
- v2/shared checkpoint writes remain on `workflow.supervisor.checkpoint` and
  `workflow.archive.checkpoint`;
- read-only old row-shape recovery inspection remains on
  `workflow.checkpoint.legacy_export`.

Reference: `docs/workflow-p34-final-checkpoint-writer-freeze.md`.

### Current Gap

`workflow.supervisor.checkpoint` covers v2 supervisor checkpoint boundaries, and
`workflow.archive.checkpoint` covers matching v2 Human Gate archive closeout.
`workflow.checkpoint.legacy_export` covers old row-shape recovery inspection
without writes. The legacy `workflow.checkpoint` action remains only as a frozen
compatibility diagnostic so old callers fail closed with replacement guidance.

### Required Replacement

Build one checkpoint writer with explicit source classes:

- `v2_plan_checkpoint`: snapshots `workflow_v2_plans`,
  `workflow_v2_plan_nodes`, worker runs, adapter jobs, sessions, reviews,
  packages, Human Gate packages, receipts, artifacts, side effects, and
  incidents.
- `human_gate_archive_checkpoint`: captures archive/closeout state and the
  Human Gate decision boundary before dispatching or archiving results.
- `legacy_compat_checkpoint`: inspects old `workflow_runs` rows through
  read-only `workflow.checkpoint.legacy_export` during the evidence window.

### Migration Steps

1. Define the shared checkpoint artifact schema and source-class metadata.
2. Add read-only comparison/export against legacy `workflow.checkpoint` for
   active archive/CLI scenarios.
3. Implement the shared/v2 writer without changing current callers.
4. Retarget Human Gate archive closeout and operator CLI to the new writer.
5. Retire context aliases or map them to explicit compatibility diagnostics.
6. Run dual-write or dual-preview evidence until no unexplained deltas remain.
7. Freeze `workflow.checkpoint` only after call-site and live-state audit.

### Exit Criteria

- Human Gate archive closeout still emits a durable recovery boundary.
- Operator recovery can create a checkpoint without relying on legacy row shape.
- V2 checkpoint artifacts include worker/session/adapter/Human Gate state.
- Compatibility use is explicit and telemetry-visible.

## Workstream R2: Intervention and Evaluation

### Current Gap

Legacy pause/resume/stop execution only edits legacy run status and appends an
event. It does not pause workers, cancel adapter jobs, close Human Gates,
settle dispatches, stop outbox delivery, or resolve side-effect uncertainty.
`workflow.evaluate` contains useful evidence checks that are not fully absorbed
by v2 validators.

### Required Replacement

Build intervention and evaluation as explicit state-machine operations:

- `intervention_readiness`: read-only safety preview over v2 plan, node, worker,
  adapter job, session, dispatch, Human Gate, outbox, checkpoint, side-effect,
  incident, and receipt state.
- `intervention_settlement`: read-only settlement preview that turns active
  external work and unresolved side effects into explicit closeout evidence
  requirements before any pause/resume/stop/terminate state transition.
- `plan_pause`, `plan_resume`, `plan_stop`, `plan_terminate`: authorized
  transitions with idempotency keys, reason, owner, rollback/checkpoint pointer,
  Protocol audit, and Human Gate evidence where required.
- `evaluation_snapshot`: migrated evaluator checks feeding v2/shared readiness,
  validation, and verification evidence.
- `rerun_readiness`: read-only compatibility mapping for
  `workflow.rerun.agent.preview` and `workflow.rerun.phase.preview`; there is no
  mutating legacy rerun executor to preserve, and future rerun intent should map
  to v2 worker successor, handoff, retire, or review-retry paths.

### Migration Steps

1. Extract evaluator checks into reusable shared/v2 validation helpers.
2. Add v2 intervention readiness preview with deterministic blockers.
3. Add v2 intervention settlement preview that enumerates required closeout
   receipts for active workers, adapter jobs, sessions, dispatches, outbox,
   Human Gates, side effects, incidents, and checkpoint boundaries.
4. Add regression fixtures for active worker, leased adapter job, pending Human
   Gate, queued outbox, stale dispatch, active incident, and unresolved side
   effect.
5. Implement authorized pause/resume/stop transitions as separate state updates,
   not one legacy status edit.
6. Require checkpoint and rollback anchors before stop/terminate.
7. Compare legacy preview and v2 readiness decisions until deltas are explained.
8. Keep rerun previews read-only until successor/handoff readiness covers their
   diagnostic value, then either retarget or archive aliases with unknown-action
   regressions.
9. Freeze legacy intervention/evaluate entry points only after v2 parity and
   operator path migration.

### 2026-07-20 Implementation Note

P35 added the first v2 replacement surface:
`workflow.v2.intervention_readiness.preview` plus explicit pause/resume/stop/
terminate preview aliases. This is read-only and does not mutate workflow
state. It checks v2 plan scope, active worker runs, adapter jobs, session runs,
shared dispatches, Telegram outbox, Human Gate packages, pending Human Gates,
latest checkpoint, side-effect uncertainty, and scoped active incidents.

This does not freeze `workflow.pause`, `workflow.resume`, `workflow.stop`,
`workflow.terminate`, or `workflow.evaluate`. Those legacy entry points remain
gated until v2 state-transition execution and evaluator parity are implemented
and tested.

### P37 Progress

P37 adds canonical v2 intervention execution actions:
`workflow.v2.pause`, `workflow.v2.resume`, `workflow.v2.stop`, and
`workflow.v2.terminate`.

These actions are separate from legacy `workflow.pause`, `workflow.resume`,
`workflow.stop`, and `workflow.terminate`. They require Human Gate evidence, Cat
Claw audit evidence, an idempotency key, operator reason, and readiness blockers
to be clear before writing. The write boundary is intentionally narrow:
`workflow_v2_plans` plus a `workflow.v2.intervention.executed` event, with no
mutation of legacy `workflow_runs`.

State mapping after P37:

- pause sets `workflow_v2_plans.status='blocked'` and
  `workflow_state='blocked'`;
- resume restores the previous plan status/workflow state recorded by the last
  intervention when safe, otherwise falls back to `running` / `active`;
- stop sets `status='cancelled'` and `workflow_state='cancelled'`;
- terminate sets `status='cancelled'` and `workflow_state='terminated'`.

P37 also gates v2 worker spawn, worker control-loop claim, and adapter-runner
claim so blocked, cancelled, completed, or terminated plans do not continue
creating or claiming work. This still does not freeze legacy intervention entry
points; evaluator parity and an observation window remain required before any
freeze decision.

### 2026-07-23 Settlement Preview Progress

The v2 intervention surface now includes
`workflow.v2.intervention_settlement.preview` with aliases
`workflow.v2.intervention.settlement.preview` and
`workflow.v2.settlement.preview`.

This action is read-only and intentionally does not call layout/schema
initialization. It resolves the scoped v2 plan from the existing database and
emits deterministic `settlementItems` for active worker runs, adapter jobs,
session runs, runtime dispatches, Telegram outbox rows, pending Human Gates,
draft/protocol-audited Human Gate packages, unresolved side effects, and active
incidents. The latest checkpoint/rollback boundary is returned separately as
`latestCheckpoint`.

Each item names the source row, owner, status, required closeout action, and
evidence summary. It intentionally does not cancel workers, adapter jobs,
sessions, dispatches, outbox delivery, Human Gates, incidents, or side effects.
Therefore it closes the planning/diagnostic half of settlement parity, but does
not by itself authorize freezing legacy lifecycle entry points.

### P42 Progress

P42 adds the first v2 evaluator parity surface:
`workflow.v2.evaluation_snapshot.preview`.

This action is read-only from the workflow operator perspective: it produces a
v2 evaluation decision snapshot from `workflow_v2_plans`, plan nodes, worker
runs, adapter jobs, Human Gate packages, verification rows, runtime receipts,
artifacts, side effects, incidents, and `workflow.v2.validate` summary output.
It does not write `workflow_verification_results`, does not mutate
`workflow_runs`, does not dispatch, does not send Telegram, and does not alter
Human Gate or side-effect state.

The legacy `workflow.evaluate` action remains available as a compatibility
writer during the evidence window. New v2/operator read paths should use
`workflow.v2.evaluation_snapshot.preview` for evaluator-style decisions and
`workflow.v2.validate` for consistency checks.

### P43 Progress

P43 adds the read-only evaluator compatibility audit:
`workflow.v2.evaluation_compatibility.preview`.

This action compares the latest legacy `workflow.evaluate` evaluator row with
the v2 `workflow.v2.evaluation_snapshot.preview` decision for the same
workflow and v2 plan. It intentionally rejects `phaseKey` until v2 has true
phase/node-scoped evaluator parity. It does not call the legacy evaluator writer, does
not create `workflow_verification_results`, does not mutate legacy
`workflow_runs` / `workflow_tasks`, and does not dispatch, deliver outbox,
touch Human Gate state, or alter side-effect state.

The output is an observation-window signal only:

- `needs_observation`: no legacy evaluator row exists yet for comparison;
- `matched`: latest legacy evaluator decision equals the v2 snapshot decision;
- `mismatch`: legacy/v2 decisions differ and the delta must be explained before
  any freeze decision.

`freezeCandidate` remains `false` in this preview. `freezeReviewCandidate=true`
only means the current workflow-level evidence is worth reviewing later for a
`workflow.evaluate` freeze. It is not an automatic freeze, not a deployment
decision, not proof that all callers have migrated, and not a substitute for
release-smoke observation evidence.

### P44 Progress

P44 adds the read-only evaluator migration inventory:
`workflow.v2.evaluation_migration.preview`.

This action is the freeze-preparation checklist for legacy `workflow.evaluate`,
not a freeze executor. It inventories the known legacy evaluator entry points
(`workflow.evaluate`, `workflow.evaluator.run`, `workflow.evaluation.run`, and
`workflow.goal.evaluate`), records their v2 replacement surfaces, and summarizes
observed legacy evaluator rows from `workflow_verification_results` by decision,
source attribution, and latest row metadata. Source attribution is not treated
as complete caller migration proof; caller migration still requires separate
tool-schema/client usage evidence. It does not read or return raw evaluator
payloads, summaries, findings, recommendations, artifact refs, or receipt refs.

The output always keeps `freezeCandidate=false` and reports
`freezeReadiness.status=not_ready` while the legacy writer is still registered,
caller migration is not proven, the compatibility observation window is open,
or release-smoke observation evidence is missing. This gives operators a stable
checklist for later freezing `workflow.evaluate` without implying that current
evidence is sufficient to retire the legacy writer.

### P45 Progress

P45 extends `workflow.v2.evaluation_migration.preview` with caller-operation
evidence from the existing `workflow_operations` audit table.

This is the first real caller migration signal for the evaluator migration
window. The preview now distinguishes:

- internal registry retention of legacy `workflow.evaluate`;
- full tool / governance tool schema exposure of legacy and v2 evaluator
  actions;
- source attribution in `workflow_verification_results`;
- audited caller-operation evidence in `workflow_operations`.

`callerOperationEvidence.callerMigrationProof=true` only when the scoped
`workflow_operations` evidence contains completed v2 evaluator snapshot or
compatibility preview calls and no legacy evaluator action calls. The migration
inventory action itself is not proof-eligible, and failed/rejected v2 calls do
not count as migration proof. This is still bounded evidence: it proves calls
that passed through the console/action-gateway audit surface, not every possible
internal direct registry invocation. Operation summaries are limit-capped
samples, not uncapped global totals. If the table is missing or a legacy
evaluator action is observed, `caller_migration_not_proven` remains a freeze
blocker.

### Exit Criteria

- No intervention can pretend a workflow is paused/stopped while active
  workers, adapter jobs, outbox, or side effects continue unaccounted.
- Evaluation evidence remains durable and queryable.
- Rerun previews cannot imply a mutating rerun executor exists; their useful
  diagnostics are either preserved as compatibility reads or mapped to v2
  successor/handoff readiness.
- High-impact intervention requires Human Gate/Cat Claw evidence through the
  existing shared rails.

## Workstream R3: Scheduler and Maintenance Service

### Current Gap

`workflow.control_loop.tick` is not just old supervisor logic. It owns shared
mechanical lanes for schedule seeding, runtime drain, stale dispatch reconcile,
message-flow reconcile, Human Gate maintenance, outbox delivery, and repair.
Only the legacy `workflow_supervise` lane has been isolated and default-closed.

### Required Replacement

Split ownership without deleting the substrate:

- `approved_schedule_runner`: handles template/Human-Gate-approved schedule
  admission, due-run seeding, idempotency, dispatch evidence, and scheduled run
  state.
- `shared_maintenance_service`: owns bounded lane execution for runtime drain,
  stale dispatch reconcile, message-flow reconcile, Human Gate inbox/request,
  outbox delivery, retry, dead-letter, and job requeue.
- `legacy_lane_archive`: keeps `workflow_supervise` disabled by default and
  eventually removes the lane after evidence-window expiry.

### Migration Steps

1. Document lane ownership and current callers for each control-loop job type.
2. Add lane-level metrics/evidence output for progress, retry, dead-letter, and
   skipped legacy lane counts.
3. Prove approved-template and approved-Human-Gate schedules enqueue and
   dispatch while raw schedules fail closed.
4. Implement or extract the shared maintenance service as a first-class module.
5. Keep `workflow.v2.control_loop.tick` limited to worker lifecycle unless an
   explicit design moves additional lanes.
6. Run an observation window with legacy supervise disabled and shared lanes
   active.
7. Retire only unused aliases/legacy lane code after audited caller checks.

### P46 Progress

P46 adds the first shared scheduler/maintenance lane inventory surface:
`workflow.control_loop.lanes.preview`.

This is a read-only shared-control-plane preview, not a v2-only replacement and
not a tick executor. It inventories current `control_loop_jobs` lane ownership,
job-type mapping, status counts, active/retry/terminal-attention counts, latest
job samples, unclassified job types, and freeze blockers. It deliberately keeps
shared lanes such as `scheduled_dispatch`, `runtime_drain`,
`stale_dispatch_reconcile`, `message_flow_reconcile`,
`human_gate_request_ensure`, `human_gate_inbox`, and
`telegram_outbox_deliver` marked as shared substrate rather than v1 freeze
candidates. Only the `workflow_supervise` legacy lane is identified as a future
freeze candidate, and only after observation-window and caller-audit evidence.

Aliases `workflow.maintenance.lanes.preview` and
`workflow.scheduler.lanes.preview` canonicalize to the shared control-loop
preview. The action does not seed, claim, run, requeue, dispatch, deliver,
resume Human Gate, or mutate side effects.

### P47 Progress

P47 converts the scheduler dispatch integration proof from raw schedule
admission to approved schedule admission.

The regression now proves three scheduler boundaries in one control-loop path:

- raw `workflow.schedule.upsert` fails closed by default and creates no
  `workflow_schedules` row;
- an approved active/default workflow-template schedule can be admitted, seeded
  as `scheduled_dispatch`, dispatched through the existing dispatch substrate,
  and followed by a bounded `runtime_drain` job;
- a Human-Gate-approved workflow-v2 plan schedule can be admitted, seeded,
  dispatched, and followed by a bounded `runtime_drain` job.

This does not rename the scheduler into a v2-only lane and does not change
`workflow.control_loop.tick` semantics. It records that the shared scheduler
lane can carry approved-template and approved-Human-Gate work while keeping raw
production schedules fail-closed unless the explicit legacy diagnostics
environment override is set.

### Exit Criteria

- Approved recurring plans still dispatch and produce receipt evidence.
- Runtime drain, stale dispatch, message-flow, Human Gate, outbox, and requeue
  lanes continue making bounded progress.
- Raw schedule diagnostics remain disabled by default.
- No shared lane is renamed or hidden as a fake v2-only feature.

## Workstream R4: Generic Runtime Dispatch Bridge

### Current Gap

`workflow.v2.adapter_runner.drain` drains v2 worker adapter jobs. It does not
replace generic `mixed_meeting_dispatches` dispatch draining, runtime receipt
eventing, operator recovery, status guidance, or `meeting.dispatch` idempotent
dispatch creation.

### Required Replacement

Create a generic dispatch package bridge, with naming that reflects its actual
role rather than meeting-era history:

- target resolution through shared `runtime_agents`;
- idempotent dispatch package creation;
- `message_flow` integration for governed notification/evidence;
- runtime adapter drain for OpenClaw, Hermes/Hermers, local Codex inbox, and
  future adapters;
- terminal receipt/failure eventing;
- status/readiness repair guidance.

The replacement may keep old action names as compatibility shims during the
cutover, but new code should call the shared bridge by its canonical name after
the replacement lands.

### Migration Steps

1. Inventory all producers and consumers of `mixed_meeting_dispatches`.
2. Define the generic dispatch package schema and compatibility mapping.
3. Implement a shared bridge API while keeping current `meeting.dispatch`
   behavior intact.
4. Retarget scheduler, Human Gate package delivery, runtime recovery guidance,
   and v2 worker/manager package paths as appropriate.
5. Prove parity for idempotency, runtime target validation, message-flow event
   creation, receipt recording, fail-closed invalid runtime, and retry.
6. Keep compatibility action names until an observation window proves no
   unaudited caller remains.
7. Freeze meeting-era names only as shells after call-site migration.

### P36 Progress

P36 added the first canonical shared dispatch-package surface:
`dispatch.package.preview` and `dispatch.package.create`.

This is intentionally **not** a v2-local registry and does not rename
`message_flow`, `runtime_agents`, or `runtime.bridge.drain`. The preview action
performs read-only target resolution through `runtime_agents`, idempotency
inspection, route-shell fail-closed reporting, message-flow eligibility
validation, and artifact payload preview. The create action delegates to the
existing dispatch writer and returns `compatibilityOperation=meeting.dispatch`,
so current runtime dispatch rows, artifacts, `message_flow` records, and
workflow events stay on the proven substrate while new callers get a
meeting-neutral name.

P36 does not freeze `meeting.dispatch`, `meeting.ingest`, `meeting.resume`,
`meeting.disperse`, `meeting.runtime_participant`, or `runtime.bridge.drain`.
Those remain active/shared until call-site migration, live observation, and
runtime bridge parity evidence are complete.

### P48 Progress

P48 adds the first read-only dispatch bridge topology surface:
`dispatch.package.topology.preview`.

The preview inventories the current `mixed_meeting_dispatches` producer and
consumer topology without mutating workflow state. It records:

- canonical bridge surfaces: `dispatch.package.preview` and
  `dispatch.package.create`;
- compatibility writer surface: `meeting.dispatch`;
- active shared producers such as approved schedule dispatch,
  `message_flow.send`, v2 supervisor package/report paths, and meeting
  compatibility fan-out;
- default-disabled legacy compatibility producers such as `workflow.advance`
  and `workflow.supervise`;
- active consumers such as `runtime.bridge.drain`, control-loop
  `runtime_drain`, stale dispatch reconcile, Human Gate resume, status/read
  models, Console views, and v2 readiness previews;
- live counts by dispatch status, runtime, dispatch type, message-flow linkage,
  runtime-drain jobs, and terminal attention rows.

This is inventory evidence only. It does not rename or freeze
`mixed_meeting_dispatches`, does not alter `meeting.dispatch`, does not change
runtime adapter drain behavior, and does not claim the bridge is ready for
retirement. Freeze readiness remains blocked until call sites migrate to the
canonical bridge, runtime bridge/message-flow parity is proven, release smoke
observation passes, and audited absence of unaudited `meeting.dispatch` callers
is recorded.

### P49 Progress

P49 adds the read-only dispatch package schema and compatibility mapping
surface: `dispatch.package.schema.preview`.

The preview defines the canonical `dispatch.package` input/output contract and
maps it onto the current compatibility substrate:

- input aliases such as `meetingId` / `meeting_id`, `workflowId` /
  `workflow_id`, `traceId` / `trace_id`, `idempotencyKey` /
  `idempotency_key`, `dispatchType` / `dispatch_type`, and `agentId` /
  `agent_id` / `target`;
- output fields returned by `dispatch.package.create`, including
  `dispatchId`, resolved `runtime`, `platform`, `workflowIngressAdapter`,
  `messageFlowId`, `returnPolicy`, `relativePath`, and idempotency
  `deduped` state;
- compatibility persistence targets:
  `mixed_meeting_dispatches`, `dispatches/<status>/<dispatchId>.json`,
  `message_flows`, `workflow_events`, and `runtime_agents`;
- lifecycle mapping for `queued`, `sent`, `acked`, `failed`, and `cancelled`;
- validation rules for `runtime_agents` target resolution, route-shell
  fail-closed behavior, idempotency, message-flow validation, max-attempt
  bounding, and pure preview no-layout behavior.

This action is pure read-only and does not initialize workflow layout, write
dispatch rows, create artifacts, create `message_flows`, append events, drain
runtimes, retry jobs, or alter `meeting.dispatch`. It also keeps
`freezeCandidate=false`: the canonical create path still delegates to
`meeting.dispatch`, and `mixed_meeting_dispatches` remains the runtime bridge
ledger until call-site migration and parity observation are complete.

### P50 Progress

P50 adds the read-only dispatch package parity checklist:
`dispatch.package.parity.preview`.

The preview records the parity matrix required before any meeting-era dispatch
name can be frozen:

- idempotency through the existing `mixed_meeting_dispatches.idempotency_key`
  ledger;
- runtime target validation through `runtime_agents` and
  `resolveRegisteredDispatchTarget`;
- message-flow linkage plus `dispatch.created` workflow event evidence;
- receipt visibility through runtime events, runtime drain jobs, and terminal
  dispatch states;
- invalid runtime fail-closed evidence for retired `openclaw_route_shell`;
- retry and terminal-failure ownership by `meeting_dispatch_retry`,
  `runtime_drain`, and dispatch reconcile substrate.

The action is pure read-only. It does not create test dispatches, does not call
`dispatch.package.create`, does not call `meeting.dispatch`, does not enqueue
retry/drain jobs, does not append runtime events, and does not mark any parity
item as a freeze approval. Even when all scoped evidence rows are observed,
`freezeCandidate` remains `false` because canonical create still delegates to
`meeting.dispatch` and call-site migration is not complete.

### P51 Progress

P51 adds the read-only dispatch call-site migration inventory:
`dispatch.package.callsites.preview`.

The preview separates call sites into explicit migration dispositions instead
of treating every `meetingDispatch` use as something to migrate:

- canonical surface retained: `dispatch.package.create`;
- public compatibility shell retained until observation:
  `meeting.dispatch`;
- already retargeted: approved schedule dispatch, v2 supervisor
  package/report dispatch, Human Gate evidence revision dispatch, Human Gate
  feedback/resume callback dispatch, Human Gate pre-order risk audit dispatch,
  Human Gate archive closeout dispatch to `main` / `cat_claw`, and
  `meeting_dispatch_retry`, `message_flow.send`, and message-flow semantic
  continuation, and `meeting.disperse` compatibility fan-out dispatch creation;
- migration candidates after parity evidence: none in ordinary dispatch package
  creation;
- deferred shared recovery paths: none in ordinary dispatch package creation;
- meeting compatibility paths retained as compatibility actions even when their
  internal dispatch writer is canonicalized;
- default-disabled legacy executors not migrated into the new bridge:
  `workflow.advance` and `workflow.supervise`.

The preview may read `workflow_operations` to show scoped legacy
`meeting.dispatch` and canonical `dispatch.package.create` operation evidence,
with requester fields redacted. If `workflow_operations` exists with a legacy or
partial schema, the preview degrades evidence instead of failing the action:
missing optional columns are reported, and a missing `action` column marks the
operation evidence unreadable. It does not scan source dynamically, does not call
either dispatch writer, does not enqueue jobs, and does not mutate state. Freeze
remains blocked while the public `meeting.dispatch` compatibility shell is
still registered, legacy operations are observed, the observation window is
missing, and canonical create still delegates to `meeting.dispatch`. Remaining
direct `meetingDispatch` references outside the canonical bridge are limited to
default-disabled legacy exceptions (`workflow.advance` / `workflow.supervise`)
that are not migration candidates.

### P52 Progress

P52 retargets the v2 supervisor report/closeout dispatch writers from direct
`meetingDispatch` calls to the canonical `dispatch.package.create` bridge while
keeping the existing compatibility writer and ledger intact.

Scope is intentionally narrow:

- `workflow.supervisor.report` dispatches the cat_claw report package through
  `dispatch.package.create`;
- `workflow.supervisor.closeout` dispatches the cat_claw closeout package
  through `dispatch.package.create`;
- the canonical bridge still writes the same `mixed_meeting_dispatches`,
  `message_flows`, dispatch artifact, and `dispatch.created` event evidence;
- no scheduler, message_flow, Human Gate callback, retry job, or runtime drain
  behavior is changed in this batch.

The result object now carries `operation: "dispatch.package.create"` and
`compatibilityOperation: "meeting.dispatch"` on successful and deduplicated
canonical dispatch creation, making retargeted callers auditable without
changing the persisted dispatch substrate.

### P53 Progress

P53 retargets approved scheduled dispatch execution from direct
`meetingDispatch` to `dispatch.package.create`.

Scope remains limited to the schedule dispatch writer:

- `scheduled_dispatch` control-loop jobs still come from the existing scheduler
  and preserve the same `scheduled_runs`, `workflow_schedules`, `control_loop_jobs`,
  `runtime_drain`, and dispatch ledger behavior;
- the dispatched run evidence now records a canonical
  `dispatch.package.create` result in `scheduled_runs.result_json`;
- raw/unapproved schedule gating, runtime drain, retry, and other control-loop
  maintenance lanes are unchanged.

### P54 Progress

P54 retargets Human Gate policy-audit revision dispatch from direct
`meetingDispatch` to `dispatch.package.create`.

Scope remains limited to the cat_claw audit-failure repair path:

- `meeting_control_events` still records the Human Gate audit failure before
  dispatch;
- the revision dispatch to `openclaw:main` now goes through the canonical bridge;
- existing Human Gate option validation, outbox cancellation, button
  supersession, retry, callback, archive closeout, and Telegram delivery
  behavior are unchanged.

### P55 Progress

P55 retargets the Human Gate safe dispatch wrapper and retry job to the
canonical bridge.

Scope is limited to dispatch creation ownership:

- `safeMeetingDispatchWithRetry` now calls `dispatch.package.create`, so
  Human Gate feedback/resume, pre-order risk audit, and archive closeout
  dispatches carry canonical operation evidence while preserving their existing
  prompt/payload/idempotency contracts;
- `meeting_dispatch_retry` now replays the same persisted dispatch input through
  `dispatch.package.create`, so retry follows the writer used by the original
  safe dispatch attempt;
- retry job naming, retry ledger rows, redaction, outbox behavior, archive
  checkpointing, callback state, and runtime drain behavior are unchanged;
- `message_flow.send`, message-flow semantic continuation, `meeting.disperse`,
  and default-disabled legacy executors are still not migrated in this batch.

### P56 Progress

P56 retargets ordinary `workflow.message_flow.send` dispatch creation to the
canonical bridge without changing message_flow semantics.

Scope is limited to the message_flow sender dispatch writer:

- `workflow.message_flow.send` still performs the same ingress recording,
  target normalization, `message_flows` linkage, ack contract construction,
  source metadata validation, and delivery-policy defaults;
- each target dispatch now calls `dispatch.package.create` and returns
  per-dispatch `dispatchOperation` / `compatibilityOperation` markers for
  auditability;
- message-flow semantic continuation remains on the old direct writer until a
  separate ack recovery / receipt parity batch proves it safe;
- `meeting.disperse`, public `meeting.dispatch`, and default-disabled
  `workflow.advance` / `workflow.supervise` compatibility paths remain outside
  this batch.

### P57 Progress

P57 retargets message-flow semantic continuation dispatch creation to the
canonical bridge after ack/recovery parity coverage.

Scope is limited to the ack continuation writer:

- semantic continuation still requires first-turn ACK evidence and still skips
  if the source dispatch is already a semantic continuation;
- generated semantic dispatches keep the same deterministic idempotency key,
  `message_flow_semantic` dispatch type, silent return/delivery policy, ack
  contract suppression, timeout clamping, source metadata, and message_flow id;
- both immediate ACK continuation and stale `message_flow.reconcile` recovery
  now return canonical operation markers;
- forced enqueue failure, runtime drain, delivery reconcile, Telegram, Gateway,
  `meeting.disperse`, and default-disabled legacy executors remain unchanged.

### P58 Progress

P58 retargets `meeting.disperse` fan-out dispatch creation to the canonical
bridge while keeping `meeting.disperse` itself as a meeting-era compatibility
action.

Scope is limited to the fan-out writer:

- `meeting_control_events` still records the same `disperse` event before any
  target dispatch is created;
- target parsing, unqualified target registry resolution, prompt, priority,
  `execute_meeting_conclusion` dispatch type, creator, and payload semantics are
  unchanged;
- each target dispatch now carries `dispatch.package.create` operation evidence;
- this does not make `meeting.disperse` a v2 kernel action and does not change
  `meeting.dispatch`, `workflow.advance`, `workflow.supervise`, runtime drain,
  Telegram, Gateway, or trading behavior.

### P59 Progress

P59 closes the dispatch call-site migration inventory.

The callsite preview now reports explicit `freezeBlockingCallSiteIds`,
`retargetedCallSites`, and `frozenLegacyExceptionIds` so operators can
distinguish three different states:

- migrated producers that now call `dispatch.package.create`;
- the public `meeting.dispatch` compatibility shell, which remains the only
  freeze-blocking callsite until the observation/removal window is complete;
- default-disabled legacy exceptions (`workflow.advance` and
  `workflow.supervise`) that must not be migrated into v2 merely to preserve old
  semantics.

This batch does not remove `meeting.dispatch`, does not enable legacy actions,
and does not change runtime drain, Telegram, Gateway, or trading behavior.

### P60 Progress

P60 aligns the dispatch package parity and topology previews with the P59
call-site closeout.

The parity/topology readiness text no longer reports generic call-site
migration as unfinished after the audited P51-P58 retargeting work. Remaining
blockers are now expressed as observation/removal requirements:

- public `meeting.dispatch` compatibility shell still registered;
- `dispatch.package.create` still delegates to the compatibility writer;
- default-disabled legacy exceptions remain outside the canonical bridge by
  design;
- release-smoke and runtime/message_flow parity must remain stable through the
  observation window.

This is a read-only metadata/contract correction only; no writer, runtime drain,
Telegram, Gateway, or trading behavior changes in this batch.

### P61 Progress

P61 aligns the default full-tool action schema with the legacy mutating action
freeze.

The OpenClaw plugin tool parameter enum no longer advertises
`workflow.advance`, `workflow.supervise`, or the mutating
`workflow.supervisor` alias as default callable actions. Their read-only
preview actions remain visible for legacy diagnostics. Core `runAction` and CLI
escape-hatch behavior are unchanged and still blocked by default unless
`TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1` is explicitly set.

This closes a visibility gap: frozen legacy mutating actions are still retained
for controlled compatibility, but they are no longer presented as normal
default tool choices.

### P62 Progress

P62 retires the v1 meeting-room discussion write surfaces by default because v2
already has the same class of multi-agent discussion/evidence capability.

Frozen by default:

- `meeting.create`, `meeting.append`, `meeting.command`, `meeting.summary`,
  `meeting.close`, `meeting.handoff`, `meeting.artifact`, `meeting.state`,
  `meeting.action_item`, `meeting.decision`, `meeting.minutes`,
  `meeting.notify`, and `meeting.index`;
- Cat Claw meeting-era secretary aliases `cat_claw.observe`,
  `cat_claw.minutes`, `cat_claw.digest`, and `cat_claw.notify`;
- legacy command aliases such as `create_meeting`, `append_meeting`,
  `append_note`, `record_command`, `summarize_meeting`, `close_meeting`,
  `handoff_meeting`, and `write_artifact`.

Replacement evidence is the existing v2 stack, not new v2 functionality:

- `workflow.v2.plan.create` and v2 plan nodes for work decomposition;
- `workflow.v2.info_stack.record` for durable content/artifact references;
- `workflow.v2.manager_review.record` and `workflow.v2.owner_review.record`
  for manager/owner review;
- `workflow.v2.task_group_package.record` for group discussion package
  synthesis;
- `workflow.v2.governance_audit.record`, `workflow.v2.protocol_audit.record`,
  `workflow.v2.notification.preview`, and shared Human Gate/outbox surfaces for
  governance and formal delivery.

This batch deliberately does not freeze `meeting.dispatch`, `meeting.ingest`,
`meeting.resume`, `meeting.disperse`, or `meeting.runtime_participant`, because
those are still shared dispatch/receipt/runtime-adapter substrate or require a
separate parity audit. `meeting.show`, `meeting.list`, and `meeting.validate`
remain archive/read diagnostics.

The short-term archive compatibility path is the same strict escape hatch used
for other frozen legacy actions:
`TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1`.

### P63 Progress

P63 removes a hardcoded governance-agent assumption from the v2 package and
supervisor surfaces.

The code now treats Cat Brain and Cat Claw as structural workflow roles rather
than fixed agent ids:

- `catBrain` means the governance auditor / incident commander role;
- `catClaw` means the secretary auditor / Human Gate package reporter role;
- default bindings remain `main` and `cat_claw` for the current OpenClaw
  deployment;
- action input or plugin config may bind those roles to another cat member or
  an independent runtime agent such as a Codex or Claude Code worker, provided
  that runtime/agent is registered and has the required permissions.

Supported binding shape:

```json
{
  "governanceRoles": {
    "catBrain": { "agentId": "cat_heart", "runtime": "hermers" },
    "catClaw": { "agentId": "local_codex", "runtime": "codex", "deliveryAccount": "local_codex" }
  }
}
```

This does not change database field names, action names, or Human Gate evidence
requirements. It only decouples role ownership from the default `main` /
`cat_claw` implementation.

### P64 Progress

P64 removes Cat Brain / Cat Claw names from new v2 structural state and node
writes where those names were only role labels, not actual implementation
targets.

New writes now prefer neutral names:

- `governance_synthesis` replaces legacy node type `cat_brain_synthesis`;
- `protocol_audit` replaces legacy node type `cat_claw_audit`;
- `waiting_governance_review` replaces legacy state
  `waiting_cat_brain_check`;
- `waiting_protocol_audit` replaces legacy state `waiting_cat_claw_audit`;
- `protocol_audited` replaces legacy Human Gate package status
  `cat_claw_audited` for newly created package rows;
- `secretary_closeout_required` replaces legacy readiness decision
  `cat_claw_summary_required`;
- `secretary_dispatch_queued` replaces legacy protocol object status
  `cat_claw_dispatch_queued`.

P64 still preserved old physical schema/action compatibility. P65 removes that
compatibility shell.

### P65 Progress

P65 makes the role-neutral names canonical at the API and schema layer instead
of keeping Cat Brain / Cat Claw audit names as aliases:

- `workflow.v2.governance_audit.preview|record` replaces
  `workflow.v2.cat_brain_audit.preview|record`;
- `workflow.v2.governance_semantic_check.preview` replaces
  `workflow.v2.cat_brain_semantic_check.preview`;
- `workflow.v2.protocol_audit.preview|record` replaces
  `workflow.v2.cat_claw_audit.preview|record`;
- `workflow.v2.protocol_package_audit.preview` replaces
  `workflow.v2.cat_claw_package_audit.preview`;
- `workflow_v2_governance_audits` replaces `workflow_v2_cat_brain_audits`;
- `workflow_v2_protocol_audits` replaces `workflow_v2_cat_claw_audits`;
- `governance_audit_id`, `protocol_audit_id`, and
  `source_protocol_audit_id` replace the old fixed-role audit id columns.

This is intentionally breaking for old action names. Migration code only reads
old table/column names to move existing rows into the new schema and map old
`cat_claw_audited` rows to `protocol_audited`; it does not keep old action
aliases as supported API.

### Exit Criteria

- Generic dispatches still create auditable rows/artifacts and receipt events.
- `runtime_agents` remains the sole runtime ownership registry.
- `message_flow` remains infrastructure, not task-specific semantic logic.
- Operator recovery guidance points to the new canonical bridge.

## Workstream R5: Read Model and Domain Workflow Cleanup

### Current Gap

Some remaining legacy surfaces are not active execution blockers but still
affect operator comprehension or future domain templates.

### Required Replacement

- Add v2-first read models for historical task/run/package views while keeping
  explicit archived v1 evidence labels.
- Keep research/data actions outside the kernel cutover until a dedicated
  research workflow-template plan defines their replacement value.
- Avoid treating domain-specific research/data actions as required v2 kernel
  migration unless they are needed by approved trading workflow templates.

### Migration Steps

1. Label console/readiness cards as `v1`, `v2`, or `shared_substrate`.
2. Add v2 plan/node/worker/package read views where operators currently reach
   for legacy list actions.
3. Move legacy history surfaces behind compatibility labels.
4. Create a separate research/data workflow-template audit before touching
   `research.*`, `instrument.*`, `radar.*`, `thesis.*`, or `gate.review`.

### P38 Progress

- Console Kanban read-model cards expose `sourceClass` and `sourceClassLabel`
  without changing workflow execution, dispatch, preview, scheduler, or
  domain-template behavior.
- `workflow_v2_plans` cards are labeled `v2 active`; `workflow_tasks` cards are
  labeled `v1 archived/compat`; runtime, dispatch, message flow, outbox,
  Human Gate, incidents, side effects, and control-loop cards remain
  `shared_substrate`.
- Synthetic evidence-gap cards inherit the origin card source class, so missing
  evidence remains tied to its v2/v1/shared substrate source instead of forming
  a separate semantic workflow layer.
- P38 does not migrate research/data actions and does not add domain-specific
  workflow semantics to the shared read model.

### P39 Progress

- The historical `workflow.task.launch.list` read action and Console
  `/api/task-launches` endpoint keep legacy `workflow_task_launch_package`
  records as `v1 archived/compat` read-only evidence.
- The same read surfaces now expose v2 package evidence from
  `workflow_v2_task_group_packages` and `workflow_v2_human_gate_packages` as
  `v2 active`, with v2 packages ordered before legacy launch-package archives.
- This is a read-model replacement surface only; it does not restore
  `workflow.task.launch.prepare/review/approve`, does not materialize v1 tasks,
  and does not change Human Gate, dispatch, scheduler, or domain-template
  behavior.

### P40 Progress

- Console global search results expose `sourceClass` and `sourceClassLabel`
  using the same `v2 active`, `v1 archived/compat`, and `shared substrate`
  vocabulary as Kanban cards.
- Global search now indexes `workflow_v2_plans` directly, so operators can open
  active v2 plans without relying on legacy `workflow_runs` or
  `workflow_tasks` search hits.
- Legacy task/run/package hits remain searchable as compatibility evidence, but
  are explicitly labeled as archived/compat where the source is v1 history.
- This is a search/read-model presentation change only; it does not change
  workflow routing, dispatch, preview actions, scheduler behavior, or
  domain-template semantics.

### P41 Progress

- Workflow list/detail rows expose v2 lineage when a `workflow_runs` row has
  matching `workflow_v2_plans`, including `sourceClass`, `sourceClassLabel`,
  `counts.v2Plans`, and the latest v2 plan id/state.
- The Console workflow queue and detail header show whether the selected
  workflow is v2-backed or only legacy compatibility history, without changing
  selection, routing, tab loading, or workflow status semantics.
- This keeps `workflow_runs` readable as the historical list anchor while
  preventing operators from mistaking a v2-backed workflow for pure v1 task/run
  state.

### Exit Criteria

- Operators can distinguish active v2 state, shared infrastructure, and archived
  v1 history without reading source.
- No domain action is migrated just because it is old.

## Recommended Execution Order

| Stage | Workstream | Reason |
| --- | --- | --- |
| P28 | R1 checkpoint/archive recovery | It is a bounded replacement and blocks `workflow.checkpoint` freeze. |
| P29 | R1 checkpoint CLI source-class routing | It stops operator recovery from silently choosing the wrong writer. |
| P30 | R1 ambiguous context checkpoint alias retirement | It removes accidental legacy checkpoint writes from generic context aliases. |
| P31 | R1 explicit legacy checkpoint source gate | It blocks bare legacy checkpoint writes while preserving intentional compatibility sources. |
| P32 | R1 legacy checkpoint usage audit | It proves live-state dependency before choosing final writer retirement. |
| P33 | R1 legacy checkpoint export/diagnostic replacement | It should remove the last mutating legacy recovery dependency before freeze. |
| P34 | R1 final checkpoint writer freeze | It can freeze `workflow.checkpoint` only after P33 and release smoke. |
| P35 | R2 intervention/evaluation readiness | It protects high-impact pause/stop/evaluate semantics before lifecycle freeze. |
| P36 | R4 generic runtime dispatch bridge | It removes meeting-era naming pressure while preserving dispatch/receipt behavior. |
| P37 | R3 scheduler/maintenance service split | It is highest blast radius and must follow dispatch-bridge clarity. |
| P38 | R5 read model/domain cleanup | It is mostly operator clarity and future template planning after core replacement work. |

This order is intentionally not “delete old code first.” Each stage must first
build or prove the replacement, then retarget callers, then freeze only what is
no longer needed.

## Global Quality Gate

Every stage must record:

- changed action names and aliases;
- changed tables and artifact schemas;
- changed default routes or gates;
- compatibility behavior and escape hatch;
- rollback path;
- local focused regression;
- full `npm run check`;
- full `npm run smoke:release`;
- `npm run check:freeze`;
- `git diff --check`;
- independent subagent review;
- server fast-forward deploy and postcheck when behavior changes are shipped.

Any stage that affects state machines, dispatch, receipt, Human Gate, outbox,
side effects, scheduling, runtime adapters, or production-adjacent behavior must
not be marked complete without the independent review result and evidence path.

## Freeze Decision Rule

Before freezing any remaining surface, answer all questions with evidence:

1. Is the surface v1-only, or is it shared substrate?
2. What exact v2/shared replacement owns the same responsibility?
3. Which callers have been retargeted?
4. Which persisted rows/artifacts still need compatibility?
5. Which regression proves the replacement behavior?
6. Which live-state audit proves no active useful dependency remains?
7. What is the rollback path if the freeze is wrong?

If any answer is missing, the correct status is `legacy_active`,
`shared_substrate`, or `allowed_until_replaced`, not frozen.

## Relationship to Existing Documents

- `docs/workflow-v1-v2-refactor-migration-plan.md` remains the master topology
  and version roadmap.
- `docs/workflow-v1-v2-migration-worthiness-audit.md` remains the value gate.
- `docs/workflow-batch-freeze-table.md` remains the current action-level freeze
  ledger.
- `docs/workflow-p27-checkpoint-parity-audit.md` records the historical
  checkpoint parity gap that blocked P27 freeze.
- `docs/workflow-p34-final-checkpoint-writer-freeze.md` records the current
  checkpoint writer freeze and read-only legacy export posture.
- This document is the execution plan for completing the missing replacement
  capabilities identified by those documents.
