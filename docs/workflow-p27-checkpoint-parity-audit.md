# Workflow P27 Checkpoint Parity Audit

Date: 2026-07-19

Scope: legacy standalone `workflow.checkpoint`, aliases `workflow.context_checkpoint` / `context.checkpoint`, and v2 replacement surface `workflow.supervisor.checkpoint` / `workflow.supervisor.checkpoint.preview`.

## Decision

P27 does **not** freeze or retire `workflow.checkpoint`.

Reason: v2 has a real checkpoint writer, but its parity is scoped to v2 supervisor checkpoint boundaries. It is not yet an equivalent replacement for every remaining caller and recovery shape of the legacy checkpoint writer.

The correct status remains:

- `workflow.checkpoint`: `legacy_active / must_migrate_valid_parts`
- `workflow.supervisor.checkpoint`: active v2 replacement for v2 supervisor checkpoint boundaries only
- `workflow.context_checkpoint` / `context.checkpoint`: legacy compatibility aliases, not v2 entry points

## Live Evidence

Dev-server live audit on 2026-07-19 sampled the current SQLite state and found no checkpoint rows at query time:

- artifact: `/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260719T-p27-checkpoint-parity-live-audit`
- `workflow_checkpoints = 0`
- `legacy_checkpoint_ids = 0`
- `v2_supervisor_checkpoint_ids = 0`
- no recent live `workflow.action_migration_telemetry` rows for `workflow.checkpoint`
- no recent live `workflow.supervisor.checkpoint.recorded` rows

This is point-in-time live-state evidence, not a retention-window proof. The audit used current-row counts plus recent event queries for `workflow.action_migration_telemetry`, `workflow.supervisor.checkpoint.recorded`, and archive-checkpoint payload references. It does **not** prove the old code block can freeze, because freeze eligibility also requires caller and parity evidence.

## Responsibility Comparison

| Responsibility | Legacy `workflow.checkpoint` | V2 `workflow.supervisor.checkpoint` | Parity |
| --- | --- | --- | --- |
| Durable JSON + Markdown artifact | Yes | Yes | Covered for v2 boundary. |
| `workflow_checkpoints` row | Yes | Yes | Covered with different resume payload schema. |
| `artifact_index` row | Yes | Yes | Covered. |
| Legacy `workflow_runs` / `workflow_tasks` state capture | Yes | No by design | Not covered; legacy-only. |
| V2 plan/node/worker/adapter/Human Gate summary | No | Yes | V2-only replacement exists. |
| Checkpoint id source | Caller may provide id or `safeId("checkpoint")` | Server-derived from workflow/plan/decision hash | Different contract. |
| Generic context aliases | `workflow.context_checkpoint`, `context.checkpoint` | No aliases | Not covered. |
| Human Gate archive closeout checkpoint | Directly calls legacy writer | No current replacement call path | Not covered. |
| Legacy supervisor compatibility checkpoint | `workflow.supervise` compatibility path can call legacy writer | V2 supervisor writer does not serve legacy rows | Not covered while escape hatch exists. |

## Active Caller Map

| Caller | Current dependency | Freeze implication |
| --- | --- | --- |
| `src/human-gate-actions.js` Human Gate archive branch | Calls `workflowCheckpoint(...)` when a closeout button archives a workflow, then references the checkpoint id in main/cat_claw closeout dispatches. This is a compatibility/archive closeout path, not a new v2 execution entry. | Cannot freeze legacy writer until this branch has a v2/shared archive checkpoint writer or a proven no-op replacement. |
| `src/workflow-supervisor-actions.js` compatibility path | Calls `workflowCheckpoint(...)` when explicit legacy `workflow.supervise` escape hatch writes a checkpoint. This path exists only because P26 preserves a strict compatibility escape hatch. | P26 kept this as short-term compatibility; checkpoint must remain while the escape hatch exists. |
| `index.js` plugin CLI | Exposes `workflow-checkpoint` mapped to `workflow.checkpoint`. | Can be hidden/gated later, but not removed without replacing operator recovery path. |
| `bin/cat-meeting-governance.mjs` governance CLI | Maps `workflow-checkpoint` to `workflow.checkpoint`. | Same operator recovery dependency. |
| `src/workflow/action-aliases.js` | Maps `workflow.context_checkpoint` and `context.checkpoint` to `workflow.checkpoint`. | Alias cleanup can happen only after a separate compatibility decision. |

## Freeze Eligibility

`workflow.checkpoint` is **not eligible** for P27 freeze.

Freeze would be justified only after all of the following are true:

1. Human Gate archive closeout uses a v2/shared checkpoint writer or explicitly records that no checkpoint is required for that archive path.
2. The P26 legacy `workflow.supervise` escape hatch no longer calls the old checkpoint writer, or the escape hatch is removed.
3. Operator CLI/Governance CLI either route to a v2/shared writer or are explicitly deprecated with a tested fail-closed path.
4. The generic context aliases have a replacement or are retired with explicit unknown-action regressions.
5. Regression proves `workflow.supervisor.checkpoint` still writes v2 artifacts/rows/events and does not mutate legacy rows.

## Next Engineering Work

P27 should open a follow-up implementation slice instead of freezing:

1. Design `workflow.archive.checkpoint` or extend `workflow.supervisor.checkpoint` to support Human Gate archive closeout without requiring `workflow_runs` / `workflow_tasks`.
2. Retarget `human_gate.feedback` archive branch to the new archive checkpoint writer.
3. Decide whether `workflow-checkpoint` CLI should route to v2/shared checkpoint based on `planId`, or become explicit legacy diagnostics only.
4. Add telemetry for direct `workflow.checkpoint` calls, so future freeze decisions use evidence rather than grep alone.
5. Re-run live audit after an observation window before changing the default behavior.

## Quality Gate For This Audit

This audit changes documentation and classification only. Required checks:

- `node --check` for relevant touched scripts if any script changes occur;
- `npm run check:freeze` to ensure freeze table remains machine-readable;
- targeted checkpoint regressions for legacy and v2 writers;
- independent review of the parity conclusion before any future freeze implementation.
