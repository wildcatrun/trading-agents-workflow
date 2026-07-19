# Workflow Batch C Advance/Supervise Migration Audit

Date: 2026-07-18

Scope: `workflow.advance`, `workflow.supervise`, legacy aliases `workflow.supervisor`, and their Batch B preview companions.

Status: audit only. This document does not authorize freezing, deleting, or changing runtime behavior.

## Executive Conclusion

`workflow.advance` and `workflow.supervise` are not ready for freeze. They are legacy mutating executors, but they still own live or compatibility-critical responsibilities that are not fully replaced by v2:

- terminal dispatch receipt reconciliation into legacy `workflow_tasks`;
- legacy task auto-dispatch and `workflow_runs.current_decision` updates;
- checkpoint creation during supervisor closeout;
- deferred runtime drain evidence for dispatches created by the supervisor, with actual generic drain owned by control-loop `runtime_drain`;
- Cat Claw closeout/report dispatch when legacy decisions require human-visible summary.

The correct Batch C posture is `legacy_active / allowed_until_replaced`: keep the actions gated by legacy mutating policy, extract valid responsibilities into shared or v2-native modules, then freeze only the empty shell after evidence proves no useful dependency remains.

## Runtime Topology

| Surface | Code Owner | Mutates | Current Gate | Current Role |
| --- | --- | ---: | --- | --- |
| `workflow.advance` | `src/workflow-advance-actions.js` | Yes | `WORKFLOW_LEGACY_MUTATING_ACTIONS` default blocks unless legacy env escape hatch is enabled | Legacy task/run progression executor. |
| `workflow.advance.preview` | `src/workflow-advance-actions.js` | No | Batch B compatibility diagnostic | Read-only legacy task/run decision preview. |
| `workflow.supervise` / `workflow.supervisor` | `src/workflow-supervisor-actions.js` | Yes | `WORKFLOW_LEGACY_MUTATING_ACTIONS` default blocks unless legacy env escape hatch is enabled | Legacy supervisor cycle over advance, checkpoint, drain, and Cat Claw report. |
| `workflow.supervise.preview` / `workflow.supervisor.preview` | `src/workflow-supervisor-actions.js` | No | Batch B compatibility diagnostic | Read-only legacy supervisor preview. |
| `workflow.supervisor.readiness.preview` | `src/workflow-v2/readiness-actions.js` | No | v2 read surface | v2 plan/node/worker/adapter/Human Gate readiness. |
| `workflow.supervisor.next_actions.preview` | `src/workflow-v2/supervisor-next-actions.js` | No | v2 read surface | v2 candidate action preview; does not mutate. |

## Responsibility Decomposition

| Responsibility | Current Implementation | V2 / Shared Replacement | Migration Class | Wrong-Freeze Failure |
| --- | --- | --- | --- | --- |
| Legacy workflow next decision preview | `workflow.advance.preview` computes `needs_planning`, `dispatch_ready`, `receipts_collecting`, `human_gate_pending`, `cat_claw_summary_required`, `blocked`, and `completed` from `workflow_tasks`, `workflow_runs`, and Human Gate rows. | New v2 cards should use `workflow.supervisor.readiness.preview` / `workflow.supervisor.next_actions.preview`. Historical legacy diagnostics still need preview compatibility. | `compat_shell_only`, already Batch B migrated from priority/default console surfaces. | Operator loses explicit diagnostics for archived legacy task/run rows. |
| Terminal dispatch sync into `workflow_tasks` | `workflow.advance` reads terminal rows from `mixed_meeting_dispatches`, checks `message_flow` delivery state, and writes legacy task `done` / `failed` / `cancelled` / `blocked`. | No complete v2 replacement for legacy rows. Candidate extraction: shared legacy dispatch reconciler or formal archive-retirement of legacy rows. | `must_migrate_or_retire_with_evidence`. | Terminal receipts stop reflecting in legacy task state; legacy workflows appear stuck or falsely active. |
| Legacy ready-task auto-dispatch | `workflow.advance` calls `meetingDispatch` for dependency-ready pending legacy tasks and marks them `in_progress`. | V2 worker spawn covers v2 plan nodes only; it does not execute legacy `workflow_tasks`. | `must_migrate_or_retire_with_evidence`. | Any remaining active legacy workflow stops creating runtime dispatches. |
| `workflow_runs.current_decision` and status update | `workflow.advance` writes the latest decision and maps selected decisions to `workflow_runs.status`. | V2 plan state is separate and does not update legacy run rows. | `must_migrate_or_archive`. | Legacy run status becomes stale; status/read-model evidence diverges from actual receipt state. |
| Supervisor multi-cycle progression | `workflow.supervise` loops over `workflowAdvance`, optionally drains newly dispatched runtimes, and then performs a final sync pass. | V2 next-actions preview suggests candidates but does not execute a full supervisor cycle. V2 control-loop/worker/adapter actions are separate executors. | `must_migrate_to_v2_service_or_retire`. | A single authorized supervisor call can no longer progress legacy workflows or enqueue drains. |
| Checkpoint write | `workflow.supervise` calls `workflowCheckpoint` unless dry-run/checkpoint is disabled. | No proven v2 checkpoint/recovery parity across plan/node/worker/session/Human Gate state. | `must_migrate`. | Recovery evidence and incident closeout lose a durable checkpoint boundary. |
| Runtime drain after supervisor dispatch | After P21, `workflow.supervise` no longer calls `runtimeBridgeDrain` directly; it records `deferredRuntimeDrains`. `workflow.control_loop.tick` enqueues `runtime_drain` jobs for supervisor-created dispatches. | `workflow.v2.adapter_runner.*` exists, but real wrapper/adapter runner cutover is not complete; `runtime.bridge.drain` remains shared substrate for generic dispatch drain. | `shared_runtime_substrate`; do not freeze as v1. | Runtime dispatches remain queued or stale without terminal receipt evidence. |
| Cat Claw closeout/report dispatch | `workflow.supervise` dispatches `workflow_secretary_report` / `human_gate_report` to `openclaw:cat_claw` for `cat_claw_summary_required`, `blocked`, or `human_gate_pending`. | P19 adds `workflow.supervisor.closeout` for completed v2 plans only: it requires an existing checkpoint, writes closeout evidence, and queues one idempotent Cat Claw dispatch. Blocked and Human Gate pending report parity are not replaced yet. | `partial_migration`. | Completed-plan closeout has a v2 path; blocked/human-gate legacy workflows still depend on legacy reporting until separate parity exists. |
| Permission/audit/telemetry | Action policy marks mutating advance/supervise as high risk; preview/read surfaces remain explicit diagnostics. | Shared action gateway and migration telemetry should remain. | `shared_control_surface`. | Mutating compatibility is accidentally exposed or hidden without evidence. |

## Caller and Dependency Map

| Caller / Dependency | Current Link | Freeze Implication |
| --- | --- | --- |
| Action registry | `workflow.advance`, `workflow.advance.preview`, `workflow.preview.advance`, `workflow.supervise`, `workflow.supervisor`, `workflow.supervise.preview`, `workflow.supervisor.preview`, `workflow.preview.supervise` are registered action names/aliases. | Alias cleanup can happen only after mutating parity or retirement evidence; preview aliases stay compatibility diagnostics for Batch B. |
| Main plugin CLI/API | `index.js` still exposes CLI commands for advance/supervise and preview variants. | Mutating commands are governed by legacy action policy; do not delete until no live dependency remains. |
| Governance CLI | `bin/cat-meeting-governance.mjs` still maps workflow-advance/supervise commands to these actions. | Same as plugin CLI: preserve while legacy executor remains possible through explicit operator path. |
| Control loop job runner | `src/control-loop-tick-actions.js` calls `workflowSupervisor` for `workflow_supervise` jobs, disables checkpoint in that path, then enqueues `runtime_drain` jobs for dispatches created by supervisor. | Directly proves `workflow.supervise` is not just old UI code. A freeze would affect queued control-loop recovery/progression jobs. |
| Runtime bridge | After P21, control-loop `runtime_drain`, direct operator runtime bridge calls, status guidance, and compatibility paths depend on `runtimeBridgeDrain`; `workflow.supervise` records deferred drain evidence only. | `runtime.bridge.drain` is shared infrastructure, not v1-only code. |
| Dispatch adapter | `workflow.advance` and `workflow.supervise` depend on `meetingDispatch`. | `meeting.dispatch` is shared adapter/evidence substrate until a replacement bridge is proven. |
| Task helper | `workflow.advance` depends on private `workflowTaskUpdate` and direct SQL writes. | Public task mutation was removed, but the private helper remains valid compatibility support. |
| Message flow | dispatch sync checks `messageFlowForDispatch` before marking legacy tasks done. | Do not bypass delivery/receipt truth when extracting reconciler behavior. |
| Console read surface | Batch B removed legacy preview from priority/default buttons, but explicit manual diagnostic rendering remains. | This is expected compatibility; it is not evidence that mutating executors are removable. |

## Required Migration Sequence

1. Collect live usage evidence for mutating `workflow.advance`, `workflow.supervise`, aliases, and `workflow_supervise` control-loop jobs across an agreed observation window.
2. Extract terminal dispatch sync into a named shared reconciler, or formally archive legacy `workflow_tasks` / `workflow_runs` rows with proof that no active workflow depends on them.
3. Move legacy ready-task auto-dispatch either into the shared reconciler with strict opt-in or retire it after proving no active legacy workflow remains.
4. Define v2 checkpoint/recovery parity covering plan, node, worker, adapter job, session, Human Gate, receipt, and side-effect uncertainty state.
5. Replace Cat Claw closeout/report dispatch with a v2 closeout package / Human Gate / Cat Claw report executor, not only a preview candidate.
6. Split runtime drain ownership: P21 removes direct supervisor drain; keep `runtime.bridge.drain` as shared substrate until generic dispatch drain has a proven replacement, because v2 adapter runner only covers v2 adapter jobs.
7. After the above, downgrade `workflow.advance` and `workflow.supervise` from `legacy_active` to `compat_shell_only` or `removed`, then run full regression to find accidental useful dependencies.

## Freeze Decision

Current decision for Batch C:

| Action | Batch C Decision | Reason |
| --- | --- | --- |
| `workflow.advance` | Keep gated; do not freeze/delete. | Still owns legacy dispatch sync, task transitions, and workflow run decision/status updates. |
| `workflow.supervise` / `workflow.supervisor` | Keep gated; do not freeze/delete. | Still owns supervisor cycle, checkpoint, runtime drain, and Cat Claw closeout/report execution. |
| `workflow.advance.preview` | Keep compatibility diagnostic only. | Batch B already migrated default read surfaces; historical legacy diagnostics remain useful. |
| `workflow.supervise.preview` / `workflow.supervisor.preview` | Keep compatibility diagnostic only. | V2 next-actions preview is not an executor and still declares closeout replacement gap. |

## Regression Plan Before Any Future Freeze

Before freezing these actions in a later batch, run at minimum:

- `npm run check:freeze`;
- targeted regression for action registry aliases and legacy mutating gate behavior;
- targeted regression for `workflow.advance` dispatch sync from `mixed_meeting_dispatches` into `workflow_tasks`;
- targeted regression for `workflow.supervise` checkpoint/report/drain contracts;
- targeted regression for `workflow.control_loop.tick` `workflow_supervise` job handling and follow-up `runtime_drain` enqueue;
- runtime bridge drain smoke and meeting dispatch smoke;
- full `npm run check`;
- full `npm run smoke:release`;
- server postcheck against active checkout and runtime state root.

Any failed test in the above means the action is still useful or the replacement is incomplete; revert the freeze attempt and update the Batch C table with the newly found dependency.
