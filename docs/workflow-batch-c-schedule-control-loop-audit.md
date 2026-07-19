# Workflow Batch C Schedule / Control Loop Migration Audit

Date: 2026-07-18

Scope: `workflow.schedule.*`, `workflow.scheduler.*`, `workflow.schedules`, `workflow.control_loop.tick`, `workflow.loop.tick`, `workflow.reconciler.tick`, `workflow.control_loop.job.requeue*`, and v2 control-loop adjacency.

Status: audit plus P23 isolation follow-up. This document does not authorize freezing, deleting, or changing runtime defaults.

## Executive Conclusion

`workflow.schedule.*` and `workflow.control_loop.*` are not removable legacy surfaces. They are also not a clean v2 implementation. They currently mix three different responsibilities:

- production recurring schedule registry and due-run seeding;
- shared mechanical maintenance queue for dispatch, receipt, outbox, Human Gate, and dead-letter recovery;
- legacy `workflow_supervise` compatibility for old workflow rows.

The correct Batch C posture is split, not delete:

- keep `workflow.schedule.*` as the governed schedule surface because `workflow.schedule.upsert` already fails closed unless production schedules are bound to an approved active/default workflow template or a Human-Gate-approved workflow plan;
- keep `workflow.control_loop.tick` because it owns shared maintenance that v2 still depends on indirectly through dispatch, receipt, runtime drain, message-flow reconcile, Human Gate request/inbox, and outbox delivery;
- do not treat `workflow.v2.control_loop.tick` as a full replacement for the generic control loop. It only drives v2 worker-run lifecycle execution and does not replace schedule seeding, stale dispatch reconcile, message-flow reconcile, Human Gate maintenance, outbox delivery, or dead-letter repair;
- isolate the legacy `workflow_supervise` lane from the shared control loop before freezing any legacy orchestration code;
- do not use workflow schedules as ordinary single-agent heartbeat/cron. Scheduler eligibility should remain limited to workflow-level recurring plans that need receipt, Human Gate, dispatch evidence, or multi-agent orchestration.

## Responsibility Decomposition

| Responsibility | Current Implementation | V2 / Shared Replacement | Migration Class | Wrong-Freeze Failure |
| --- | --- | --- | --- | --- |
| Schedule action registry | `schedule-actions.js` registers `workflow.schedule.upsert/list/pause/resume/disable` and `workflow.scheduler.*` aliases. | Keep one governed schedule surface; aliases can be retired only after CLI/MCP compatibility is audited. | `shared_scheduler_keep`. | Operators lose the only governed schedule registry and list/control surface. |
| Production schedule admission | `workflowScheduleUpsert` rejects production schedules unless `approvedTemplateScheduleRef` or `approvedHumanGatePlanScheduleRef` succeeds, unless `TRADING_AGENTS_WORKFLOW_ALLOW_RAW_SCHEDULE_DISPATCH=1` is explicitly set. | Approved template or Human-Gate-approved plan remains the production contract. | `already_guarded`. | Raw recurring dispatch could re-enter production without template/Human Gate approval. |
| Template approval binding | `approvedTemplateScheduleRef` requires initialized template tables, active template family, active/default version, and approved version status. | Shared approved-template registry. | `shared_approval_gate`. | Disabled or non-default template versions become schedulable. |
| Human Gate plan binding | `approvedHumanGatePlanScheduleRef` requires v2 plan/protocol tables and an approved Human Gate record that references the workflow or plan. | Shared Human Gate/protocol evidence rail. | `shared_approval_gate`. | A schedule can run a plan without approved human evidence. |
| Due schedule seeding | `seedDueScheduleJobsCore` reads active due schedules, applies priority, misfire, concurrency, creates `scheduled_runs`, and enqueues `scheduled_dispatch` control-loop jobs. | Shared scheduler service or maintenance lane; not replaced by v2 worker control-loop. | `must_keep_until_split`. | Recurring approved plans stop becoming dispatchable runs. |
| Scheduled dispatch execution | `runScheduledDispatchJobCore` calls `meetingDispatch`, updates `scheduled_runs`, records `last_dispatch_id`, and enqueues `runtime_drain`. | Shared dispatch/runtime adapter substrate or a future v2 schedule runner with equivalent receipt behavior. | `must_migrate_before_freeze`. | Scheduled jobs may be marked due but never reach runtime or receipt drain. |
| Schedule state controls | `workflow.schedule.pause/resume/disable` only update schedule status and next-run state. | Keep as scheduler controls; do not confuse with workflow plan pause/resume/stop. | `shared_scheduler_keep`. | Operators cannot stop future recurring runs without deleting the schedule. |
| Generic control-loop lease/budget | `workflowControlLoopTick` leases the control loop, seeds maintenance jobs, claims jobs by budget, records events, and prunes retention. | Shared maintenance executor; v2 worker loop is adjacent, not a replacement. | `shared_maintenance_keep`. | Mechanical queues stop making bounded progress or lose lease protection. |
| Legacy workflow supervise lane | Control loop seeds and executes `workflow_supervise` jobs for legacy `workflow_runs`, with idle cooldowns and runtime drains after dispatch. P23 adds a disabled-lane mode that skips both seeding and claiming this job type while leaving shared maintenance active. | Extract or retire after v2 supervisor/readiness and closeout parity is proven, live legacy rows are audited, and cutover is explicitly authorized. | `legacy_lane_isolated_not_retired`. | Freezing the whole control loop to retire this lane also freezes shared maintenance; disabling the lane must not claim old `workflow_supervise` jobs. |
| Runtime drain lane | Control loop enqueues/runs `runtime_drain` jobs and exact dispatch drains. | Shared runtime bridge now; v2 adapter runner only covers v2 worker adapter jobs. | `shared_substrate_keep`. | Runtime dispatches stop producing terminal receipt evidence. |
| Stale dispatch reconcile | Control loop runs `stale_dispatch_reconcile` jobs with bounded limits and statuses. | Shared dispatch recovery substrate. | `shared_substrate_keep`. | Stale queued/in-flight dispatches remain unresolved. |
| Message-flow reconcile | Control loop runs `message_flow_reconcile` for pending message-flow states. | Shared message-flow evidence and delivery substrate. | `shared_substrate_keep`. | Message bus recovery and failed delivery reconciliation stop. |
| Human Gate maintenance | Control loop can ensure pending Human Gate requests and process Human Gate inbox jobs. | Shared Human Gate/protocol rail. | `shared_substrate_keep`. | Human Gate requests/inbox records stop converging. |
| Telegram outbox delivery | Control loop can enqueue and execute `telegram_outbox_deliver`. | Shared governed outbox delivery rail. | `shared_substrate_keep`. | Approved outbound delivery can stall without retry/receipt evidence. |
| Job requeue preview/execute | `workflow.control_loop.job.requeue.preview` and `workflow.control_loop.job.requeue` only requeue failed/dead-letter or expired leased jobs with operator reason and audit event. | Keep controlled repair surface. | `shared_repair_keep`. | Operators lose safe recovery for failed/dead-letter maintenance jobs. |
| V2 worker control-loop | `workflow.v2.control_loop.preview/tick` checks v2 schema, runnable workers, expires leases, claims worker runs, and executes deterministic workers. | Worker-run executor only. | `partial_replacement_only`. | Assuming replacement would leave schedule, outbox, Human Gate, message-flow, and stale dispatch maintenance unowned. |

## Caller and Dependency Map

| Caller / Dependency | Current Link | Freeze Implication |
| --- | --- | --- |
| Action aliases | `workflow.scheduler.*`, `workflow.loop.tick`, and `workflow.reconciler.tick` alias into canonical schedule/control-loop actions. | Alias cleanup is safe only after CLI/MCP/operator usage is audited. |
| Action policy | Schedule writes are high-risk; `workflow.schedule.upsert` requires Cat Claw audit; control-loop tick is high-risk; job requeue is medium-risk repair. | These are governed operations, not casual helper functions. |
| Freeze metadata | `workflow.schedule.` and `workflow.control_loop.` are currently marked `legacy_active` with migration recommendations. | Classification should be refined: schedule/shared maintenance remain active substrate; only raw schedule diagnostics and `workflow_supervise` are legacy lanes. |
| Status guidance | Readiness/status recommends `workflow.control_loop.tick`, `runtime.bridge.drain`, and job requeue previews for queue and dead-letter recovery. | Freezing control-loop breaks operator recovery guidance. |
| Console read model | Console reads control-loop jobs, terminal attention, runtime drain details, and requeue previews. | UI/operator diagnostics would lose repair and evidence surfaces. |
| Schedule dispatch path | Due schedules enqueue `scheduled_dispatch`; dispatch execution uses `meetingDispatch` and queues `runtime_drain`. | Scheduler cannot be evaluated separately from shared dispatch/receipt substrate. |
| V2 control-loop | V2 control-loop owns worker-run lifecycle only. | It does not prove generic control-loop retirement readiness. |
| V2 adapter runner service plan | Adapter runner service preview is disabled by default and gated before service execution. | Service plan is future ownership direction, not current replacement evidence for all maintenance lanes. |

## Freeze Decision

| Action / Surface | Batch C Decision | Reason |
| --- | --- | --- |
| `workflow.schedule.upsert` | Keep; do not freeze/delete. | Production admission already requires approved template or Human-Gate-approved plan; raw dispatch is explicitly diagnostic-only through env gate. |
| `workflow.schedule.list` / `workflow.schedules` | Keep as read-only schedule evidence. | Operators need to inspect recurring schedule state, next run, and recent runs. |
| `workflow.schedule.pause/resume/disable` | Keep as scheduler state controls. | These control future schedule firing and are not equivalent to workflow lifecycle intervention. |
| `workflow.scheduler.*` aliases | Keep for now; mark for later alias audit. | Removing aliases before usage audit risks breaking CLI/MCP/operator compatibility without retiring actual legacy behavior. |
| `workflow.control_loop.tick` | Keep; do not freeze/delete. | It is the current shared bounded maintenance executor for schedules, dispatch drain, stale dispatch reconcile, message-flow reconcile, Human Gate, outbox, and legacy supervise. |
| `workflow.loop.tick` / `workflow.reconciler.tick` aliases | Keep for now; mark for later alias audit. | Alias removal should happen only after operator/docs/CLI callers are confirmed migrated. |
| `workflow.control_loop.job.requeue.preview` | Keep as safe repair diagnostic. | Preview explains whether failed/dead-letter or expired leased jobs can be requeued without executing side effects. |
| `workflow.control_loop.job.requeue` | Keep as governed repair. | It only requeues job state with operator reason and evidence; it does not execute dispatch/outbox/trading side effects itself. |
| `workflow_supervise` lane inside control loop | Isolated in P23; not retired. | This is the legacy orchestration lane; it should not be used as a reason to delete the shared maintenance executor. |
| Raw schedule diagnostics gate | Keep disabled by default. | It is useful for migration diagnostics, but production schedules should remain approval-bound. |

## Required Migration Sequence

1. Define the approved schedule execution contract: template or Human-Gate-approved plan reference, idempotency key, dispatch evidence, runtime receipt, Human Gate/outbox behavior, and failure state.
2. Keep P23 disabled-lane coverage active: `legacyWorkflowSuperviseLane: false` / `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_SUPERVISE_LANE=0` must skip both seeding and claiming `workflow_supervise` while preserving shared maintenance.
3. Name and document shared maintenance lanes separately: `scheduled_dispatch`, `runtime_drain`, `stale_dispatch_reconcile`, `message_flow_reconcile`, `meeting_dispatch_retry`, `human_gate_request_ensure`, `telegram_outbox_deliver`, and `human_gate_inbox`.
4. Decide whether the future service owner is a generic maintenance service, the v2 adapter runner service, or two separate services. Do not make `workflow.v2.control_loop.tick` silently inherit unrelated maintenance responsibilities.
5. Add regression that proves approved-template and approved-Human-Gate schedules can enqueue and dispatch, while raw schedules fail closed without `TRADING_AGENTS_WORKFLOW_ALLOW_RAW_SCHEDULE_DISPATCH=1`.
6. Extend regression coverage from the P23 runtime-drain proof to scheduled dispatch, stale dispatch reconcile, message-flow reconcile, Human Gate, outbox, and job requeue repair before any default flip.
7. Run an observation window in which the generic control-loop reports lane-level progress and dead-letter rates before freezing any legacy lane.
8. Only after the above, retire raw schedule diagnostics and legacy control-loop aliases if no audited caller remains.

## Regression Plan Before Any Future Freeze

Before freezing or deleting any schedule/control-loop surface, run at minimum:

- `npm run check:freeze`;
- targeted schedule admission regression for approved template, approved Human Gate plan, and raw schedule fail-closed behavior;
- targeted due schedule seeding regression for priority, concurrency, misfire, `scheduled_runs`, and `scheduled_dispatch` job creation;
- targeted scheduled dispatch regression proving `meetingDispatch`, `scheduled_runs`, `last_dispatch_id`, and `runtime_drain` enqueue behavior;
- targeted schedule pause/resume/disable regression proving future firing state changes without workflow lifecycle side effects;
- targeted control-loop lane regression for `runtime_drain`, `stale_dispatch_reconcile`, `message_flow_reconcile`, `meeting_dispatch_retry`, `human_gate_request_ensure`, `telegram_outbox_deliver`, and `human_gate_inbox`;
- targeted `workflow_supervise` extraction regression proving shared maintenance still works when legacy supervise is disabled;
- targeted job requeue preview/execute regression for failed/dead-letter and expired running lease cases;
- targeted v2 worker control-loop regression proving worker execution remains isolated from generic maintenance;
- full `npm run check`;
- full `npm run smoke:release`;
- server postcheck against active checkout and runtime state root.

Any failed test in the above means either the surface is still useful or replacement ownership is incomplete; revert the freeze attempt and update the Batch C freeze table.
