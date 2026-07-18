# Workflow P17 Supervisor Closeout Preview

Date: 2026-07-18
Scope: `workflow.supervisor.closeout.preview`

## Purpose

P17 adds a read-only v2 supervisor closeout preview. It advances the P14
freeze-readiness path for `workflow.supervise.preview` by making completed v2
plans produce an explicit Cat Claw closeout candidate without invoking the
legacy supervisor executor.

## Boundary

This slice does not freeze, remove, or reroute `workflow.advance`,
`workflow.supervise`, `workflow.advance.preview`, or `workflow.supervise.preview`.
It also does not write checkpoints, dispatch Cat Claw reports, request Human
Gate, drain runtimes, or mutate workflow state.

## Behavior

- `workflow.supervisor.next_actions.preview` now points completed v2 plans to
  `workflow.supervisor.closeout.preview` instead of reusing readiness preview as
  a placeholder.
- `workflow.supervisor.closeout.preview` reads v2 readiness state and returns
  closeout candidates only when a plan decision is
  `cat_claw_summary_required`.
- Returned candidates explicitly mark `executorStatus="replacement_gap"` because
  the final v2 closeout executor is still not implemented.
- The preview includes checkpoint and Cat Claw report boundaries with all
  `would*` mutation fields set to false.

## Migration Value

This is a useful migration step because it separates three concerns that were
previously bundled inside legacy `workflow.supervise.preview`:

1. v2 readiness says whether a closeout is due;
2. supervisor next-actions says the next safe preview surface;
3. closeout preview states what evidence and executor gap remain.

## Remaining Gap

Before mutating `workflow.supervise` can be frozen, a later slice must either
implement a governed v2 Cat Claw closeout executor or explicitly retire the
legacy closeout dispatch path with evidence.
