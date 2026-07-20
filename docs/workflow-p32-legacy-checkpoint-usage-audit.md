# Workflow P32 Legacy Checkpoint Usage Audit

Date: 2026-07-20

## Scope

P32 is a read-only audit for the remaining `workflow.checkpoint` legacy writer
after P28-P31. It does not freeze or remove code.

The audit covers:

- source call-sites that can still write through `workflow.checkpoint`;
- operator CLI routing;
- tests and documentation dependencies;
- local staging temporary SQLite evidence;
- dev-server live workflow state evidence.

The runtime scan is limited to the observed live state-root DB and active
checkout location. It does not claim to cover archived backups, deleted temp
copies, or future backfilled state.

## Current Write Entrypoints

After P31, bare `workflow.checkpoint` calls are diagnostic-only. Remaining
legacy writes require an accepted `sourceClass`.

P32 active write-capable sources before P33:

| Source | Path | Status | Replacement / Retirement Note |
| --- | --- | --- | --- |
| Operator legacy recovery | `workflow-checkpoint --source-class legacy_compat_checkpoint` | Explicit compatibility only | P33 retargets this to read-only `workflow.checkpoint.legacy_export`. |
| Legacy supervise escape hatch | `workflow.supervise` with checkpoint enabled and legacy actions allowed | Internal fallback only | P33 retargets this to read-only export; final removal follows the legacy supervise window. |
| Human Gate archive legacy fallback | Archive closeout without matching v2 plan state | Internal fallback only | P33 retargets this to read-only export; final removal requires matching v2 plan state or explicit operator recovery. |

Already retargeted or frozen:

- `workflow.context_checkpoint` and `context.checkpoint` are blocked
  diagnostics;
- operator v2 plan checkpoints route to `workflow.supervisor.checkpoint`;
- operator Human Gate archive checkpoints route to `workflow.archive.checkpoint`;
- matching v2 Human Gate archive closeout uses `workflow.archive.checkpoint`.

## Code Evidence

- `src/checkpoint-actions.js` gates legacy writes by `sourceClass` and returns a
  non-mutating diagnostic for missing/unsupported classes.
- `src/workflow.js` short-circuits blocked `workflow.checkpoint` before
  permission, telemetry, convergence, or layout initialization.
- `src/workflow-supervisor-actions.js` passes
  `legacy_supervise_escape_hatch_checkpoint` for the remaining legacy supervise
  internal writer.
- `src/human-gate-actions.js` passes
  `human_gate_archive_legacy_fallback_checkpoint` for archive fallback.
- `src/workflow/checkpoint-routing.js` keeps operator-facing legacy source
  classes mapped to `workflow.checkpoint`.

## Runtime State Evidence

### Local Staging Temporary DBs

Local staging has temporary smoke DBs with old checkpoint rows:

- `.tmp-control-loop-smoke/tracking.db`: 4 checkpoint rows, all historical
  supervisor smoke rows dated 2026-05-18.
- `.tmp-supervisor-smoke/tracking.db`: 1 checkpoint row, historical supervisor
  smoke row dated 2026-05-18.
- `.tmp-supervisor-smoke-report/tracking.db`: 1 checkpoint row, historical
  supervisor smoke row dated 2026-05-18.

These are smoke artifacts, not live workflow state.

### Dev-Server Live State

Read-only check against:

`/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db`

Observed:

- `workflow_checkpoints=0`
- `workflow_runs=0`
- `workflow_events=13583`
- `message_flow_events=2663`
- `workflow_v2_plans=1`
- `workflow_action_migration_telemetry=missing`

No legacy checkpoint rows were found in this dev-server state-root snapshot.
Because `workflow_runs=0` and `workflow_action_migration_telemetry` is missing,
this snapshot does not prove absence of all future or historical production
dependency; it only proves no active legacy checkpoint recovery dependency is
observable in the current state DB.

Additional read-only checks:

- state-root DB scan found only
  `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db`;
- `workflow_events` and `message_flow_events` keyword searches for
  `workflow.checkpoint` / `workflow-checkpoint` returned no rows;
- `governance-logs` keyword search for `workflow.checkpoint`,
  `workflow-checkpoint`, `legacy_compat_checkpoint`,
  `legacy_supervise_escape_hatch_checkpoint`, and
  `human_gate_archive_legacy_fallback_checkpoint` returned no hits.

No active checkout DB was found under:

`/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout/`

## Retirement Judgment

This audit does not justify immediate deletion of `workflow.checkpoint`.

It supports a narrower conclusion: the current dev-server snapshot shows no
active legacy checkpoint rows, no legacy workflow rows, and no event/message/log
evidence of recent legacy checkpoint recovery use. Before P33, the remaining
write-capable dependencies were compatibility mechanisms rather than observed
active state dependencies in this snapshot. P33 converts those known
compatibility paths to read-only export.

Removing the writer is only safe after P33 converts or removes these active
compatibility paths:

1. legacy supervise escape-hatch checkpointing;
2. Human Gate archive closeout fallback when no matching v2 plan state exists.

## Recommended Next Slice

Proceed with P33 before final freeze:

1. Add a read-only `workflow.checkpoint.legacy_export` / diagnostic path for old
   `workflow_runs` recovery evidence.
2. Retarget operator `legacy_compat_checkpoint` to that export/diagnostic path.
3. Change legacy supervise checkpointing from write to diagnostic/export, or
   remove it when the legacy supervise escape hatch is removed.
4. Change Human Gate archive fallback to a diagnostic/export that instructs
   operators to bind or recover matching v2 plan state before archive closeout.
5. Then P34 can freeze or remove mutating `workflow.checkpoint`.

## Exit Criteria For P34

Do not freeze/delete the writer until all of these are true:

- no source call-site writes through `workflowCheckpoint(...)`;
- operator legacy recovery no longer writes `workflow_checkpoints`;
- Human Gate archive closeout never requires legacy row-shape writes;
- legacy supervise escape hatch is removed or cannot write checkpoints;
- release smoke confirms v2 supervisor/archive checkpoint paths still work;
- subagent review confirms no hidden writer path remains.
