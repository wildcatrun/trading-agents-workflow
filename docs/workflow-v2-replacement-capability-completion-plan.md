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

The governing rule is strict:

```text
Only a legacy code block with an equivalent v2 or shared replacement is eligible
for migration, freeze, or retirement. If no replacement exists, keep the block
as legacy_active / shared_substrate and build the replacement first.
```

This plan does not authorize deleting shared infrastructure. It also does not
authorize renaming shared infrastructure to v2 merely to make the code look
newer. Shared substrate should keep shared names unless there is a real
coexisting legacy/new implementation that requires a temporary disambiguator.

## Current Count

As of P27, no further legacy execution block should be frozen by default before
replacement work is completed.

Remaining replacement work is **4 capability families**:

| Family | Current surfaces | Current class | Replacement target | Freeze posture |
| --- | --- | --- | --- | --- |
| Checkpoint and archive recovery | `workflow.checkpoint`, `workflow.context_checkpoint`, `context.checkpoint`, operator `workflow-checkpoint` | `frozen_writer_diagnostic / read_only_legacy_export / v2_shared_writers` | `workflow.supervisor.checkpoint`, `workflow.archive.checkpoint`, and `workflow.checkpoint.legacy_export` | P34 complete: legacy writer frozen; v2/shared writers and read-only export remain. |
| Intervention and evaluation | `workflow.pause`, `workflow.resume`, `workflow.stop`, `workflow.terminate`, `workflow.evaluate`, `workflow.rerun.agent.preview`, `workflow.rerun.phase.preview` | `legacy_active` | Audited intervention readiness/actions plus migrated evaluator checks in v2/shared validators; rerun previews remain read-only compatibility until mapped to v2 successor/handoff readiness | Not freeze-eligible until state-machine semantics exist. |
| Scheduler and maintenance service | `workflow.schedule.*`, `workflow.scheduler.*`, `workflow.control_loop.tick`, `workflow.loop.tick`, `workflow.reconciler.tick`, `workflow.control_loop.job.*` | `shared_scheduler / shared_maintenance` with one legacy lane default-closed | Approved-plan schedule runner and shared maintenance service with lane ownership, receipts, requeue, and evidence | Do not freeze whole surface; split and retire only legacy lanes/aliases after service cutover. |
| Generic runtime dispatch bridge | `runtime.bridge.drain`, `meeting.dispatch`, `meeting.ingest`, `meeting.resume`, `meeting.disperse`, `meeting.runtime_participant` | `shared_runtime_substrate / shared_adapter` | Generic dispatch package bridge that preserves `runtime_agents`, `message_flow`, idempotency, receipts, and adapter evidence | Do not freeze until replacement proves generic dispatch parity. |

Secondary compatibility/read-only surfaces remain tracked but are not current
kernel blockers:

- `workflow.task.list`, `workflow.tasks`, and `workflow.task.launch.list` need a
  v2-first read model before final archive, but they do not execute new work.
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
- `plan_pause`, `plan_resume`, `plan_stop`, `plan_terminate`: authorized
  transitions with idempotency keys, reason, owner, rollback/checkpoint pointer,
  Cat Claw audit, and Human Gate evidence where required.
- `evaluation_snapshot`: migrated evaluator checks feeding v2/shared readiness,
  validation, and verification evidence.
- `rerun_readiness`: read-only compatibility mapping for
  `workflow.rerun.agent.preview` and `workflow.rerun.phase.preview`; there is no
  mutating legacy rerun executor to preserve, and future rerun intent should map
  to v2 worker successor, handoff, retire, or review-retry paths.

### Migration Steps

1. Extract evaluator checks into reusable shared/v2 validation helpers.
2. Add v2 intervention readiness preview with deterministic blockers.
3. Add regression fixtures for active worker, leased adapter job, pending Human
   Gate, queued outbox, stale dispatch, active incident, and unresolved side
   effect.
4. Implement authorized pause/resume/stop transitions as separate state updates,
   not one legacy status edit.
5. Require checkpoint and rollback anchors before stop/terminate.
6. Compare legacy preview and v2 readiness decisions until deltas are explained.
7. Keep rerun previews read-only until successor/handoff readiness covers their
   diagnostic value, then either retarget or archive aliases with unknown-action
   regressions.
8. Freeze legacy intervention/evaluate entry points only after v2 parity and
   operator path migration.

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
- `docs/workflow-p27-checkpoint-parity-audit.md` is the latest proof that
  checkpoint replacement is incomplete.
- This document is the execution plan for completing the missing replacement
  capabilities identified by those documents.
