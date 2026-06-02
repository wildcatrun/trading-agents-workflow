# Development Log 2026-05-31 P1.4 Intervention Execution

This log records the first real controlled-intervention execution slice.

## Goal

Move from preview-only intervention controls to the smallest governed write path
for workflow-level pause, resume, and stop.

## Scope Completed

- Added real actions:
  - `workflow.pause`
  - `workflow.resume`
  - `workflow.stop`
  - `workflow.terminate` as an alias for stop
- Kept rerun-agent, rerun-phase, exact runtime drain retry, and Human Gate
  package generation as preview/deferred work.
- Execution reuses the existing preview eligibility checks before writing.
- Execution writes only:
  - `workflow_runs.status`
  - `workflow_runs.current_decision`
  - `workflow_runs.updated_at`
  - append-only `workflow_events` record
- Console action gateway can run these writes only when writes are explicitly
  enabled and the console is not in read-only mode.
- `workflow_operations` records real execution as `dry_run=0`, with result in
  `result_json`; preview JSON remains empty for real writes.

## Required Evidence

The execution path is now in the selected hard-gate set. It requires:

- Human Gate evidence (`humanGateId`, equivalent evidence, or Flashcat original
  words);
- Cat Claw audit evidence (`catClawAuditId` or equivalent);
- non-empty operator reason;
- rollback/resume boundary, or an available latest checkpoint path.

## Safety Boundary

This slice intentionally does not:

- reset or cancel tasks;
- retry or cancel dispatches;
- drain runtime bridges;
- send Telegram messages;
- create Human Gate requests or buttons;
- write side-effect ledger rows;
- touch trading or `trading_core` state.

The returned `affected` summary reports those side-effect counts as zero.

## Verification Commands

The following checks passed after implementation:

```bash
npm run check
npm run test:regression
git diff --check
```

Regression coverage includes missing-evidence hard blocks, invalid transition
rejection, pause/resume/stop state transitions, operation audit rows,
redaction, read-only console rejection, and proof that existing dispatch rows
are not mutated by the minimal intervention.

## Subagent Input

Spark explorer `Curie` recommended the same minimal boundary: update
`workflow_runs`, preserve operation audit evidence, require Human Gate/Cat Claw
and operator reason, and avoid runtime, Telegram, Human Gate creation,
side-effect, and trading tables. The optional broader cancellation of
control-loop jobs/tasks/dispatches was deliberately deferred from this first
execution slice.
