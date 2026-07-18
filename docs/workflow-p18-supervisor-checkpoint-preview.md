# Workflow P18 Supervisor Checkpoint Preview

Date: 2026-07-18
Scope: `workflow.supervisor.checkpoint.preview`

## Purpose

P18 adds a read-only v2 supervisor checkpoint preview. It continues the
`workflow.supervise` freeze-readiness path by separating checkpoint recovery
boundary analysis from the legacy checkpoint writer.

## Boundary

This slice does not freeze, remove, or reroute `workflow.checkpoint`,
`workflow.supervise`, or `workflow.supervise.preview`. It does not write
`workflow_checkpoints`, checkpoint artifacts, `artifact_index`, dispatch rows,
Human Gate records, outbox rows, operations, events, or workflow state.

## Behavior

- `workflow.supervisor.next_actions.preview` now surfaces a checkpoint preview
  candidate for completed v2 plans before the closeout preview candidate.
- `workflow.supervisor.checkpoint.preview` reads v2 readiness state and existing
  `workflow_checkpoints` rows for each plan workflow.
- Returned candidates report whether an existing checkpoint is available and
  explicitly mark `executorStatus="v2_checkpoint_writer_gap"`.
- Console Kanban completed v2 plan cards expose
  `workflow.supervisor.checkpoint.preview` and
  `workflow.supervisor.closeout.preview`, not legacy
  `workflow.supervise.preview`.

## Migration Value

This is not a writer replacement. Its value is making the checkpoint gap
auditable before any later decision to build a v2/shared checkpoint writer or
retire the legacy checkpoint path.

## Remaining Gap

Before `workflow.checkpoint` or mutating `workflow.supervise` can be frozen, a
later slice must implement a governed v2/shared checkpoint writer or explicitly
retire checkpoint writing with evidence and rollback policy.
