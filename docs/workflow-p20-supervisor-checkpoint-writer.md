# P20 Supervisor Checkpoint Writer

Date: 2026-07-19

Scope: `workflow.supervisor.checkpoint`

P20 adds the governed v2 supervisor checkpoint writer. It replaces the P18
preview-only gap for v2 plans that are ready to request Human Gate or close out
through Cat Claw.

## Contract

- `workflow.supervisor.checkpoint.preview` remains read-only. It reads v2
  readiness, existing workflow checkpoint rows, and returns a write candidate.
- `workflow.supervisor.checkpoint` is the mutating writer. It derives
  `checkpointId` server-side from `workflowId`, `planId`, and readiness
  decision; caller-supplied checkpoint ids are ignored.
- The writer records:
  - a JSON checkpoint artifact;
  - a Markdown checkpoint artifact;
  - one `workflow_checkpoints` row;
  - one `artifact_index` row with kind `workflow_checkpoint`;
  - one `workflow.supervisor.checkpoint.recorded` event.

## Boundary

This action does not:

- call legacy `workflow.checkpoint`;
- require or mutate `workflow_runs` / `workflow_tasks`;
- dispatch Cat Claw;
- request Human Gate;
- send Telegram;
- drain runtime adapter jobs;
- update v2 plan or node state.

The checkpoint resume payload captures v2 plan identity, readiness decision,
node ids, active/review worker run ids, active adapter job ids, Human Gate
package ids, artifact refs, and next actions.

## Closeout Integration

Completed v2 plans in `cat_claw_summary_required` can now create their
checkpoint through `workflow.supervisor.checkpoint`, then proceed to
`workflow.supervisor.closeout`. Closeout remains checkpoint-gated and still
dispatches only to `openclaw:cat_claw`.

## Remaining Legacy Boundary

`workflow.checkpoint` remains available for legacy `workflow_runs` /
`workflow_tasks` recovery. It should not be used as the v2 supervisor writer.
Deletion or freeze still requires proving no legacy supervisor/control-loop
path depends on it.
