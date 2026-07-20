# Workflow P30 Context Checkpoint Alias Retirement

Date: 2026-07-20

Scope: ambiguous checkpoint context aliases and legacy supervise checkpoint
observability.

## Decision

P30 retires the ambiguous checkpoint aliases:

- `workflow.context_checkpoint`
- `context.checkpoint`

Both aliases now canonicalize to `workflow.checkpoint.legacy_alias`, a read-only
compatibility diagnostic that returns `blocked` and writes no checkpoint row,
artifact, or artifact index entry.

Operators must choose an explicit source class instead:

- `workflow-checkpoint --workflow <id> --source-class v2_plan_checkpoint --plan
  <id>`
- `workflow-checkpoint --workflow <id> --source-class
  human_gate_archive_checkpoint --plan <id> --human-gate <id> --button <id>`
- `workflow-checkpoint --workflow <id> --source-class legacy_compat_checkpoint`
  for read-only inspection of old `workflow_runs` / `workflow_tasks` recovery
  state after P33

P31 adds a stricter source gate on top of this slice: bare `workflow.checkpoint`
calls are also diagnostic-only unless an accepted legacy compatibility
`sourceClass` is declared.
P33 retargets known legacy compatibility callers to
`workflow.checkpoint.legacy_export`, so these callers no longer write legacy
checkpoint rows.

## Boundary

P30 does not freeze or remove `workflow.checkpoint`.

Reasons:

- explicit legacy compatibility recovery now uses read-only export after P33;
- `workflow.supervise` remains a default-blocked escape-hatch action until the
  legacy action removal window closes;
- `workflow.supervise` now uses read-only legacy export when the legacy action
  itself is explicitly enabled, and reports
  `checkpointPath=workflow.checkpoint.legacy_export.legacy_supervise_escape_hatch`.

## Regression Evidence

Regression coverage in `scripts/workflow_regression_tests.mjs` asserts:

- alias calls return `workflow.checkpoint.legacy_alias` with `blocked`;
- alias calls do not write `workflow_checkpoints` or `artifact_index`;
- explicit source-class legacy recovery through known callers now returns
  read-only `workflow.checkpoint.legacy_export`;
- `workflow.supervise` escape-hatch checkpointing remains observable through
  `checkpointPath=workflow.checkpoint.legacy_export.legacy_supervise_escape_hatch`.
