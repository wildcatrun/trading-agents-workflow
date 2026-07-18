# Workflow P19 Supervisor Closeout Executor

Date: 2026-07-18
Scope: `workflow.supervisor.closeout`

## Purpose

P19 adds the governed v2 supervisor closeout executor required to move
completed v2 plans toward `workflow.supervise` retirement.

## Boundary

`workflow.supervisor.closeout` is a mutating action. Its write boundary is
limited to:

- a `workflow_v2_closeout` artifact under `workflows/closeouts/`;
- an `artifact_index` row for that closeout artifact;
- a `protocol_objects` row with `object_type='workflow_v2_closeout_record'`;
- a `workflow.supervisor.closeout.recorded` workflow event;
- one idempotent `meeting.dispatch` to `openclaw:cat_claw`.

It does not write checkpoints, request Human Gate, send Telegram, drain runtime
queues, execute worker wrappers, change trading state, or mutate v2 plan/node
state.

## Preconditions

- The selected v2 plan readiness decision must be `cat_claw_summary_required`.
- An existing `workflow_checkpoints` row for the workflow must be available.
- No existing `workflow_v2_closeout_record` may already exist for the same
  `workflowId` + `planId`.
- The caller must pass normal workflow permission checks for
  `workflow.supervisor.closeout` (`dispatch.write`, high risk, mutating).

## Idempotency

The closeout id is server-derived and stable:
`workflow_v2_closeout.<hash(workflowId:planId)>`.

Caller-provided `closeoutId` / `closeout_id` is ignored. The Cat Claw dispatch
idempotency key is derived from the server-derived closeout id. Repeated
execution after a closeout record exists refuses with `existing_closeout_available`
rather than dispatching again.

## Migration Value

This replaces one important part of legacy `workflow.supervise`: final Cat Claw
closeout dispatch for completed v2 plans. It intentionally does not replace the
legacy checkpoint writer or runtime drain/sync behavior.

## Remaining Gap

`workflow.supervise` is still not freeze-ready because these areas remain:

- `workflow.checkpoint` still owns the current checkpoint writer;
- `workflow.advance` still owns legacy task/dispatch sync;
- runtime-drain and blocked/human-gate reporting parity need separate audited
  extraction.
