# Workflow P21 Supervisor Drain Dependency Removal

Date: 2026-07-19

Status: implemented candidate.

## Decision

P21 removes the direct `runtimeBridgeDrain` dependency from `workflow.supervise`.

This does **not** retire `runtime.bridge.drain`.

## Boundary

- `workflow.supervise` may still create legacy task dispatches through `workflow.advance` / `meeting.dispatch`.
- `workflow.supervise` no longer executes runtime drains inline, even when called with `drain=true`.
- When dispatches are created and `drain=true`, `workflow.supervise` now returns `deferredRuntimeDrains` evidence.
- `cycles[*].runtimeDrains` remains present for compatibility, but is empty after P21.
- Cat Claw `workflow_secretary_report` dispatch also returns `catClawReportDrainDeferred` instead of executing a direct drain.

## Runtime Ownership

Generic dispatch draining remains owned by the shared control-loop lane:

- `workflow.control_loop.tick` runs `workflow_supervise` with direct drain disabled.
- The control loop enqueues targeted `runtime_drain` jobs for dispatches created by supervisor execution.
- `runtime_drain` jobs continue to call `runtime.bridge.drain` against `mixed_meeting_dispatches`.

V2 adapter job draining remains separate:

- `workflow.v2.adapter_runner.drain` drains v2 adapter jobs.
- It does not replace generic `mixed_meeting_dispatches` drain.
- Therefore `runtime.bridge.drain` remains shared substrate, not v1-only code.

## Regression Requirements

P21 must prove:

- `src/workflow-supervisor-actions.js` contains no `runtimeBridgeDrain` reference.
- `workflow.supervise.preview` documents that direct runtime drain is deferred.
- `workflow.supervise drain=true` creates dispatch evidence but no `runtime.receipt` event by direct drain.
- Cat Claw report dispatch records deferred drain evidence and does not drain inline.
- `workflow.control_loop.tick` still enqueues targeted `runtime_drain` jobs.
- `runtime.bridge.drain` remains registered and covered by runtime bridge tests.

## Remaining Migration Work

- `workflow.advance` still owns legacy task dispatch sync and task/run mutation.
- `workflow.supervise` still owns legacy checkpoint/report compatibility paths.
- Blocked and Human Gate pending Cat Claw report parity is not fully replaced by v2 closeout.
- Generic dispatch bridge naming remains meeting-era; replacement or aliasing requires a separate shared-adapter audit.
