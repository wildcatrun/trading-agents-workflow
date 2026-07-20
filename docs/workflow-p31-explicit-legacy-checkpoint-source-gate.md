# Workflow P31 Explicit Legacy Checkpoint Source Gate

Date: 2026-07-20

## Scope

P31 tightens the remaining `workflow.checkpoint` compatibility surface without
removing the legacy writer. The action no longer writes when called without an
explicit compatibility source class.

## Behavior

`workflow.checkpoint` now returns a blocked diagnostic when:

- `sourceClass` / `source_class` is missing; or
- the source class points at a v2/shared writer such as `v2_plan_checkpoint`.

Accepted legacy compatibility sources are:

- Operator-facing: `legacy_compat_checkpoint`, `legacy_checkpoint`, `legacy`
- Internal fallback only: `legacy_supervise_escape_hatch_checkpoint`,
  `human_gate_archive_legacy_fallback_checkpoint`

The diagnostic is non-mutating and does not initialize workflow layout.

## Why This Is Not a Freeze of `workflow.checkpoint`

The old writer still exists for intentional compatibility recovery of old
`workflow_runs` / `workflow_tasks` state and for explicit fallback branches that
have not reached full replacement parity. P31 only removes accidental ambiguous
direct writes.

## Call-Site Retargeting

- Operator CLI already passes `legacy_compat_checkpoint` when legacy recovery is
  intentional; P33 retargets this to read-only
  `workflow.checkpoint.legacy_export`.
- Legacy `workflow.supervise` escape-hatch checkpointing already passes
  `legacy_supervise_escape_hatch_checkpoint`; P33 retargets this to read-only
  export.
- Human Gate archive closeout legacy fallback now passes
  `human_gate_archive_legacy_fallback_checkpoint`; P33 retargets this to
  read-only export.

## Exit Criteria Contribution

P31 makes remaining compatibility use explicit and test-visible. The final
freeze decision still requires either:

- a dedicated migration window for old `workflow_runs` recovery; or
- a replacement diagnostic/export path that no longer writes legacy checkpoint
  rows.
