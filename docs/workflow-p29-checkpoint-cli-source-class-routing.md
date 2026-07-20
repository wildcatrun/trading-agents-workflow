# Workflow P29 Checkpoint CLI Source-Class Routing

Date: 2026-07-20

Scope: operator and OpenClaw plugin CLI routing for checkpoint writers.

## Decision

P29 keeps the existing `workflow-checkpoint` command name but adds explicit
`--source-class` routing:

- `legacy_compat_checkpoint` originally routed to `workflow.checkpoint`; P33
  retargets it to read-only `workflow.checkpoint.legacy_export`.
- `v2_plan_checkpoint` routes to `workflow.supervisor.checkpoint` and requires
  `--plan`.
- `human_gate_archive_checkpoint` routes to `workflow.archive.checkpoint` and
  requires `--plan`, `--human-gate`, and `--button`.

The default remains `legacy_compat_checkpoint` for compatibility. This is not a
silent migration: an operator must choose the v2/shared source class before the
CLI uses a v2 checkpoint writer.

## Boundary

P29 only changes routing at command construction time. It does not:

- mutate workflow state during preview or argument parsing;
- change `workflow.checkpoint` behavior;
- retarget context aliases;
- remove the explicit legacy compatibility writer;
- change `message_flow`, control-loop, worker, Human Gate, or runtime dispatch
  mechanics.

## Freeze Posture

`workflow.checkpoint` remains `legacy_active / must_migrate_valid_parts`.

Reasons:

- explicit legacy recovery still needs the old `workflow_runs` /
  `workflow_tasks` row-shape writer during the evidence window;
- context aliases have been retired as write paths in P30 and now return a
  diagnostic instead of writing;
- legacy supervise compatibility checkpointing is not yet closed;
- P29 retargets only operator-chosen CLI calls, not all remaining callers.

## Regression Evidence

Regression coverage in `scripts/workflow_regression_tests.mjs` asserts that:

- default `workflow-checkpoint` now routes to
  `workflow.checkpoint.legacy_export` after P33;
- `--source-class v2_plan_checkpoint --plan <id>` routes to
  `workflow.supervisor.checkpoint`;
- `--source-class human_gate_archive_checkpoint --plan <id> --human-gate <id>
  --button <id>` routes to `workflow.archive.checkpoint`;
- v2 source classes fail before execution when required identifiers are missing.
