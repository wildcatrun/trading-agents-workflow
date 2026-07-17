# Workflow P11 Advance/Supervise Migration Audit

Status: audit, no code removal
Created: 2026-07-17
Scope: `workflow.advance` / `workflow.supervise`

## Purpose

P11 audits the legacy `workflow.advance` and `workflow.supervise` surfaces after
P10 removed the external task mutation entry points. The goal is not to delete
these actions immediately. The goal is to identify which behavior must be moved
into v2/shared readiness, validator, adapter-runner, checkpoint, incident, or
Human Gate surfaces before any external mutating shell can be frozen or removed.

This is a required audit because `workflow.advance` still owns valid mechanical
progression behavior and `workflow.supervise` still owns recovery/closeout
coordination behavior. Removing either one before v2 parity exists would risk
breaking durable workflow recovery.

## Current Topology

| Layer | Surface | File | Current behavior | P11 judgment |
| --- | --- | --- | --- | --- |
| Advance action registry | `workflow.advance`, `workflow.advance.preview`, `workflow.preview.advance` | `src/workflow-advance-actions.js` | Public registry still active. | Keep for now; classify `advance` as must-migrate and preview as diagnostic compatibility. |
| Supervisor action registry | `workflow.supervise`, `workflow.supervisor`, `workflow.supervise.preview`, `workflow.supervisor.preview`, `workflow.preview.supervise` | `src/workflow-supervisor-actions.js` | Public registry still active. | Keep for now; classify mutating supervise as must-migrate and preview aliases as diagnostic compatibility. |
| Permission policy | high-risk mutating rules | `src/workflow/action-policy.js` | `workflow.advance` requires Cat Claw audit; `workflow.supervise` is high-risk mutating. Both are in `WORKFLOW_LEGACY_MUTATING_ACTIONS`. | Do not remove until v2/shared replacement exists and default callers are migrated. |
| Control loop usage | `workflow_supervise` job type -> `workflowSupervisor` | `src/control-loop-tick-actions.js` | Control-loop jobs call supervisor with `drain=false` and `checkpoint=false`, then enqueue `runtime_drain` jobs for dispatches returned by the supervisor cycle. | Must split shared maintenance from legacy orchestration before retirement. |
| Task compatibility dependency | `workflow.advance` -> private `workflowTaskUpdate` | `src/workflow.js`, `src/workflow-advance-actions.js` | Marks auto-dispatched legacy tasks `in_progress`; syncs terminal dispatches into `workflow_tasks`. | Must migrate or replace before private task update helper can be removed. |
| Checkpoint/report dependency | `workflow.supervise` -> `workflowCheckpoint`, `meetingDispatch`, `runtimeBridgeDrain` | `src/workflow-supervisor-actions.js` | Writes compact checkpoint and creates Cat Claw closeout/Human Gate report dispatches. | Must map to v2 checkpoint/readiness and Human Gate outbox before removal. |
| Console/read-only usage | preview actions in console/kanban/evidence gaps | `src/console/read-model.js`, `docs/workflow-console.md` | Console/read-model evidence primarily exposes `workflow.supervise.preview`; `workflow.advance.preview` remains a documented read-only diagnostic/operator surface. | Keep preview until v2 read models expose equivalent next-action hints. |
| Operator docs | active action descriptions | `docs/openclaw-plugin-readme.md` | Documents `advance` and `supervise` as current durable initiative operations. | Update only after replacement action path is implemented and proven. |

## Advance Behavior Inventory

`workflow.advance.preview` is read-only and currently calculates:

- terminal dispatch sync plan from `mixed_meeting_dispatches` into legacy task
  status, including delivery-blocked message-flow handling;
- human-gate pending count from workflow-level Human Gate records and
  task-level `human_gate_required`;
- dependency-based ready task detection from `workflow_tasks.depends_on_json`;
- next decision:
  - `needs_planning`
  - `human_gate_pending`
  - `dispatch_ready`
  - `receipts_collecting`
  - `cat_claw_summary_required`
  - `completed`
  - `blocked`
  - `waiting_dependencies`
- optional `wouldDispatch` plan for ready tasks.

`workflow.advance` mutates:

- syncs terminal runtime dispatches into `workflow_tasks`;
- creates `meeting.dispatch` rows for ready tasks when `autoDispatch=true`;
- marks dispatched tasks `in_progress` through the private task-update helper;
- updates `workflow_runs.current_decision`, `workflow_runs.status`, and
  `updated_at`.

### Advance Migration Classification

| Behavior | Classification | Replacement target | Reason |
| --- | --- | --- | --- |
| Terminal dispatch -> task status sync | must_migrate/shared | stale dispatch reconcile, message_flow receipt, v2 adapter job/session result state | This is valid recovery behavior, but it should not stay tied to legacy `workflow_tasks`. |
| Message-flow delivery pending -> blocked task | must_migrate/shared | message_flow readiness / incident evidence / v2 validate | Valid communication-plane safety check. |
| Human Gate pending decision | must_migrate/shared | Human Gate inbox/readiness and v2 plan/node gate state | Valid stop condition; must remain visible. |
| Dependency-based ready task detection | legacy compatibility | v2 plan node dependency readiness | Useful only for legacy task rows; v2 should use plan node/worker dependency state. |
| Auto-dispatch ready task rows | legacy compatibility | v2 worker spawn / adapter job enqueue | Direct v1 task dispatch should not remain a v2 default path. |
| Update `workflow_runs.current_decision/status` | legacy compatibility | v2 plan workflow_state/status and shared readiness summary | Legacy row maintenance can remain only for historical compatibility. |
| `workflow.advance.preview` diagnostic output | compatibility shell | v2 validate/readiness next-action summary | Keep until console/ops has equivalent v2 hinting. |

## Supervise Behavior Inventory

`workflow.supervise.preview` wraps `workflow.advance.preview` and reports:

- whether runtimes would be drained;
- whether a checkpoint would be written;
- whether a Cat Claw report dispatch would be created.

`workflow.supervise` mutates:

- runs one to five advance cycles;
- optionally drains runtime bridge queues for dispatched runtimes;
- runs a final non-dispatching advance pass;
- optionally writes a checkpoint;
- creates a Cat Claw closeout or Human Gate report dispatch when final decision
  is `cat_claw_summary_required`, `blocked`, or `human_gate_pending`;
- optionally drains the Cat Claw report dispatch.

### Supervise Migration Classification

| Behavior | Classification | Replacement target | Reason |
| --- | --- | --- | --- |
| Multi-cycle advance loop | must_migrate | v2 control loop / adapter runner service | Valid mechanical progression, but should operate on v2 plan/node/worker state. |
| Runtime drain after dispatch | shared/must_migrate | v2 adapter runner drain service | Valid runtime maintenance; do not delete until wrapper/service ownership is proven. |
| Final non-dispatching advance pass | must_migrate | v2 readiness recompute after runner drain | Valid closeout/readiness recompute behavior. |
| Checkpoint write | must_migrate | v2 checkpoint/recovery parity | Cannot remove until v2 checkpoint evidence covers recovery. |
| Cat Claw report dispatch | must_migrate/shared | v2 Human Gate package/request + Cat Claw outbox delivery | Valid secretary/Human Gate closeout; must not be bypassed or duplicated. |
| `workflow.supervise.preview` diagnostic output | compatibility shell | v2 readiness/console next-action summary | Keep until v2 read models expose equivalent preview. |

## V2 Coverage Gap

`workflow.v2.validate` already checks v2 schema and consistency, including plan
fields, node/plan links, worker runs, adapter jobs, session runs, manager/owner
reviews, info stack references, read receipts, task group packages, Cat Brain
and Cat Claw audits, Human Gate package shape, and adapter manifest contracts.

It does **not** yet replace `advance/supervise` because it does not currently:

- compute a v2 next decision equivalent to `dispatch_ready`,
  `receipts_collecting`, `human_gate_pending`, `blocked`, or
  `cat_claw_summary_required`;
- enqueue or preview worker spawns based on node dependency readiness;
- reconcile terminal adapter/session results into a user-facing workflow
  readiness state;
- create or preview checkpoint/closeout report actions as a cohesive supervisor
  cycle;
- produce a Cat Claw/Human Gate closeout dispatch candidate from v2 plan state.

Therefore `workflow.v2.validate` is a foundation for replacement, not the
complete replacement.

## Runtime Evidence

A read-only dev-server query on 2026-07-17 inspected:

- `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db`

Observed counts:

- `workflow_operations` rows for `workflow.advance`, `workflow.advance.preview`,
  `workflow.supervise`, `workflow.supervise.preview`: `0`
- `workflow_tasks` grouped by status: no rows
- `control_loop_jobs` rows with `job_type='workflow_supervise'`: no rows
- action migration telemetry exists generally, but no current telemetry rows for
  the four P11 actions.

This means current dev runtime does not show active live dependency on these
legacy actions, but code-level dependencies and documented operator behavior
remain. Lack of live rows is not sufficient evidence for deletion.

## P11 Decision

Do not freeze or remove `workflow.advance` / `workflow.supervise` in this slice.

The safe path is:

1. Add a v2/shared next-decision/readiness summary that can represent:
   `needs_planning`, `dispatch_ready`, `receipts_collecting`,
   `human_gate_pending`, `blocked`, `cat_claw_summary_required`, and
   `completed`.
2. Map v2 plan node dependency readiness and worker result/session/adapter job
   terminal states into that summary.
3. Add a v2 supervisor preview that shows:
   would-spawn/would-dispatch, would-drain, would-checkpoint, and
   would-Cat-Claw/Human-Gate closeout.
4. Add tests proving v2/shared readiness covers:
   dependency readiness, Human Gate blocking, failed runtime receipt, pending
   message-flow delivery, all-done closeout, and blocked state.
5. Only after those checks pass, freeze external mutating
   `workflow.advance` / `workflow.supervise` while keeping preview diagnostics
   available.
6. Remove or archive the private legacy task update dependency only after no
   internal action path needs to write `workflow_tasks` for progression.

## Not In This P11 Slice

- Do not remove `workflow.advance`.
- Do not remove `workflow.supervise`.
- Do not remove `workflow.advance.preview` or `workflow.supervise.preview`.
- Do not remove `workflowCheckpoint`, `runtimeBridgeDrain`, `control_loop.*`, or
  `workflow_tasks` read/history support.
- Do not redirect Cat Claw closeout into a non-governed outbox path.
- Do not alter Gateway, OpenClaw runtime, or live control-loop scheduling.

## Quality Gate For Future Implementation

Any implementation after this audit must include:

- targeted tests for new v2/shared readiness decisions;
- targeted tests proving legacy `advance/supervise` parity before freezing;
- full `node scripts/workflow_regression_tests.mjs`;
- `npm run smoke:release`;
- `git diff --check`;
- independent subagent review focused on recovery, Human Gate, Cat Claw
  closeout, and runtime-drain regressions.
