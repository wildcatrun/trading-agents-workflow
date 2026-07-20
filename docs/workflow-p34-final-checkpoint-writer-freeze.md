# Workflow P34 Final Checkpoint Writer Freeze

Date: 2026-07-20

## Scope

P34 freezes the legacy mutating `workflow.checkpoint` writer.

This is not a deletion of checkpoint capability. Active checkpoint writing now
belongs to the explicit v2/shared writers:

- `workflow.supervisor.checkpoint`
- `workflow.archive.checkpoint`

Legacy row-shape recovery inspection belongs to:

- `workflow.checkpoint.legacy_export`

## Behavior

`workflow.checkpoint` now always returns a non-mutating blocked diagnostic:

- `schemaVersion=workflow_checkpoint_frozen_result.v1`
- `status=blocked`
- `reason=legacy_checkpoint_writer_frozen`
- `mutating=false`
- `writeBlocked=true`
- `didWriteCheckpoint=false`
- `didWriteArtifact=false`
- `didUpdateArtifactIndex=false`
- `didInitializeLayout=false`

The diagnostic points operators to:

- `workflow-checkpoint --source-class v2_plan_checkpoint --plan <id>`
- `workflow-checkpoint --source-class human_gate_archive_checkpoint --plan <id>
  --human-gate <id> --button <id>`
- `workflow-checkpoint --source-class legacy_compat_checkpoint` for read-only
  legacy export.

## Policy Changes

- `workflow.checkpoint` is no longer a console optional write action.
- `workflow.checkpoint` no longer has a mutating permission rule.
- `workflow.checkpoint` is treated as a read-only compatibility diagnostic.
- `workflow.archive.checkpoint` and `workflow.supervisor.checkpoint` still use
  the `workflow.checkpoint` capability for real checkpoint writes.

## Regression Evidence

Regression coverage asserts:

- fresh-root `workflow.checkpoint` creates no DB or artifact directory;
- existing-root `workflow.checkpoint` writes no checkpoint rows or artifacts,
  even with legacy source classes;
- `workflow.checkpoint.legacy_export` still returns recovery payloads read-only;
- legacy supervise and Human Gate archive fallback still use
  `workflow.checkpoint.legacy_export`;
- v2/shared checkpoint permission and console gates still recognize
  `workflow.supervisor.checkpoint` and `workflow.archive.checkpoint`.

## Result

After P34, no known production or operator path should write through the legacy
`workflow.checkpoint` row-shape writer. The code keeps the action name as a
frozen compatibility diagnostic to avoid unknown-action failures during the
transition.
