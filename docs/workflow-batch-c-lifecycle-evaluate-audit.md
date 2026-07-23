# Workflow Batch C Lifecycle / Evaluate Migration Audit

Date: 2026-07-18

Scope: `workflow.pause`, `workflow.resume`, `workflow.stop`, `workflow.terminate`, `workflow.evaluate`, and related preview/alias surfaces.

Status: audit only. This document does not authorize freezing, deleting, or changing runtime behavior.

Implementation update, 2026-07-20: P35 added
`workflow.v2.intervention_readiness.preview` as the first v2 replacement
readiness surface. It is a read-only preflight over v2 plan state and shared
runtime evidence.

Implementation update, 2026-07-23: v2 also has governed
`workflow.v2.pause`, `workflow.v2.resume`, `workflow.v2.stop`, and
`workflow.v2.terminate` plan-state transition actions. These actions require
Human Gate evidence, Protocol audit evidence, operator reason, idempotency, and
checkpoint/rollback evidence where appropriate. They intentionally mutate only
`workflow_v2_plans` and `workflow_events`; they do not cancel active workers,
adapter jobs, sessions, dispatches, outbox rows, Human Gates, or side effects.
Therefore they reduce the gap but do not by themselves authorize freezing the
legacy lifecycle shell.

## Executive Conclusion

These actions are not deletion-ready, but they are not equivalent in migration value:

- `workflow.pause`, `workflow.resume`, and `workflow.stop` are legacy run-level intervention shells. Their preview path contains useful safety checks, but the execute path only updates `workflow_runs.status/current_decision` and writes a `workflow.intervention.executed` event. It does not pause workers, cancel adapter jobs, stop dispatches, close Human Gates, drain runtime queues, or settle side effects.
- `workflow.evaluate` is more valuable than the run-level lifecycle shell: it snapshots tasks, dispatches, runtime runs, agent-run receipt counts, artifacts, side-effect uncertainty, incidents, Human Gates, and verification rows, then records an evaluator verification result. Its valid checks should migrate into v2/shared readiness and validation.
- V2 already has many lifecycle primitives for workers, adapter jobs, Human Gate packages, reviews, handoffs, retire/successor, and validation. It does not yet have one audited orchestration-level intervention action that safely pauses/resumes/stops a whole v2 plan across all dependent state tables.

The correct Batch C posture is:

- keep lifecycle mutating actions gated and do not expand them;
- migrate useful preview safety checks into v2/shared intervention readiness;
- extend existing v2 plan-state transition actions to cover active external
  work settlement before legacy lifecycle freeze;
- migrate evaluator checks into v2/shared validators/readiness;
- freeze or remove the legacy lifecycle shells only after v2 plan/node/worker/adapter/Human Gate/side-effect transition semantics exist and pass regression.

## Responsibility Decomposition

| Responsibility | Current Implementation | V2 / Shared Replacement | Migration Class | Wrong-Freeze Failure |
| --- | --- | --- | --- | --- |
| Lifecycle action registry and aliases | `intervention-actions.js` registers `workflow.pause`, `workflow.resume`, `workflow.stop`, `workflow.terminate`, preview aliases, and rerun previews. | V2 should expose audited intervention readiness/actions, not direct legacy aliases. | `must_migrate_then_retire_aliases`. | Operators lose governed intervention diagnostics or accidentally call hidden legacy aliases. |
| Pause/resume/stop preview | `workflowInterventionPreview` reads legacy `workflow_runs`, `workflow_tasks`, `mixed_meeting_dispatches`, `workflow_phases`, `workflow_checkpoints`, `side_effect_ledger`, and `workflow_agent_runs`; it returns eligibility, warnings, Human Gate/Cat Claw requirements, latest checkpoint, active dispatches, pending Human Gates, and side-effect uncertainty. | V2 intervention readiness should read `workflow_v2_plans`, nodes, workers, adapter jobs, sessions, Human Gate packages, side effects, dispatches, and checkpoints. | `must_migrate_valid_checks`. | A freeze would remove the only existing operator preview for intervention risk before v2 parity exists. |
| Pause/resume/stop execution | `workflowInterventionExecute` requires operator reason and rollback/checkpoint boundary, then updates only `workflow_runs.status/current_decision/updated_at` and appends a workflow event. | `workflow.v2.pause/resume/stop/terminate` now provide governed v2 plan-state transitions with idempotent events, but active external work settlement remains incomplete. | `legacy_shell_limited_value` until full v2 settlement parity. | Status may appear paused/stopped while active workers, adapter jobs, dispatches, outbox, or side effects continue. |
| Human Gate / Cat Claw enforcement | Preview marks Human Gate and Cat Claw audit required; permission policy marks pause/resume/stop high-risk with Human Gate evidence and Cat Claw audit requirements. Execute itself does not re-check these fields and relies on the action policy/permission gate. | V2 intervention must produce Human Gate package/request and Cat Claw audited evidence before mutation. | `must_migrate`. | High-impact intervention becomes a silent local status edit. |
| Side-effect uncertainty awareness | Preview warns on `side_effect_ledger` uncertain/failed statuses and raises stop risk tier to `P0-critical` when uncertain side effects exist. | V2 intervention should bind side-effect ledger and trading-core handoff uncertainty before stop/resume. | `must_migrate`. | Pausing/stopping could mask unresolved external side effects. |
| Rerun previews | `workflow.rerun.agent.preview` and `workflow.rerun.phase.preview` are read-only diagnostics that check target evidence; execute path does not support rerun. | V2 worker successor/handoff/retire and manager review paths are the real replacement direction. | `compat_diagnostic_only`. | Mistaken deletion could remove diagnostics, but there is no mutating rerun executor to preserve. |
| Evaluator decision | `workflow.evaluate` computes evaluator decisions from tasks, dispatches, runtime runs, verification rows, side-effect uncertainty, active incidents, Human Gates, artifacts, receipt counts, and acceptance criteria. | `workflow.v2.validate`, supervisor readiness, and v2 closeout/readiness should absorb these checks. | `must_migrate_valid_checks`. | Readiness could miss side-effect uncertainty, active incident, Human Gate, or evidence completeness blockers. |
| Evaluator persistence | `workflow.evaluate` writes a `workflow_verification_results` row with result type `evaluator`, decision, summary, findings, recommendations, artifact refs, receipt refs, and payload snapshot. | V2 may keep shared verification rows or introduce v2-specific evaluation artifacts; either way evidence persistence remains required. | `shared_evidence_candidate`. | Operators lose audit trail explaining why a workflow is met/not-met/blocked/needs-evidence. |

## Caller and Dependency Map

| Caller / Dependency | Current Link | Freeze Implication |
| --- | --- | --- |
| Action aliases | `workflow.terminate` aliases to `workflow.stop`; evaluator aliases map to `workflow.evaluate`. | Alias cleanup must happen only with replacement or removal tests. |
| Action policy | `workflow.pause`, `workflow.resume`, and `workflow.stop` are high-risk mutating actions requiring Human Gate evidence and Cat Claw audit; `workflow.evaluate` is medium-risk mutating verification. | Policy already treats lifecycle as high impact; do not bypass it with v2 shortcuts. |
| Console preview actions | Legacy preview actions remain explicit diagnostics; Batch B already removed legacy supervisor previews from priority surfaces. | Keep diagnostics until v2 intervention readiness exists. |
| Regression tests | Tests assert registry and alias availability for evaluator and lifecycle surfaces. | Update tests only in the batch that migrates or removes the actual actions. |
| V2 worker lifecycle | Worker lifecycle supports preview, handoff, retire, successor, and worker/session state validation. | This replaces worker-level renewal/retirement semantics, not whole-workflow pause/resume/stop. |
| V2 validation | `workflow.v2.validate` already checks worker/session and adapter job state consistency. | Evaluator checks should be merged here or into adjacent readiness, not kept forever under legacy action names. |

## Freeze Decision

| Action / Surface | Batch C Decision | Reason |
| --- | --- | --- |
| `workflow.pause` | Keep gated; do not freeze/delete yet. | Preview safety checks are useful, but execute semantics are incomplete and need v2 intervention replacement. |
| `workflow.resume` | Keep gated; do not freeze/delete yet. | Resume must account for pending Human Gates, workers, adapter jobs, sessions, and side effects before v2 parity. |
| `workflow.stop` / `workflow.terminate` | Keep gated; do not freeze/delete yet. | Stop is high risk and currently only edits legacy run status; v2 must define side-effect-safe termination first. |
| `workflow.rerun.*.preview` | Keep as compatibility diagnostics only. | No mutating rerun executor exists; v2 successor/handoff/retire paths are the replacement direction. |
| `workflow.evaluate` | Keep until evaluator checks migrate. | It contains still-valid evidence/readiness checks that are not fully absorbed by v2 validation/readiness. |

## Required Migration Sequence

1. Define v2 intervention readiness covering plan, node, worker run, adapter job, session run, dispatch, Human Gate package/request, outbox, checkpoint, side-effect ledger, and incident state.
2. Extend v2 pause/resume/stop transitions beyond plan-state updates to cover
   active worker runs, adapter jobs, session runs, dispatches, Human Gate waits,
   outbox rows, side-effect uncertainty, and incident state with durable
   receipts.
3. Require Cat Claw audit and Human Gate package/request before high-impact intervention execution.
4. Map stop/terminate to v2 states consistently: v2 uses `terminated` / `cancelled`, while legacy `workflow.stop` writes `stopped`.
5. Extract evaluator checks into `workflow.v2.validate` and/or supervisor readiness; preserve evaluator evidence rows or define a v2 equivalent artifact.
6. Run dual-read comparison between legacy intervention/evaluator previews and v2 readiness until the decision deltas are explained.
7. Only after replacement coverage and an observation window, downgrade legacy lifecycle/evaluate names to compatibility shells or remove aliases with unknown-action regressions.

## Regression Plan Before Any Future Freeze

Before freezing or deleting any lifecycle/evaluate surface, run at minimum:

- `npm run check:freeze`;
- targeted lifecycle preview regression for active dispatches, pending Human Gates, latest checkpoint, and side-effect uncertainty;
- targeted lifecycle execution regression proving legacy shells remain gated and write only expected legacy state/event fields;
- targeted evaluator regression for side-effect uncertainty, active incident, failed dispatch/runtime, pending Human Gate, evidence missing, and met/not-met decisions;
- targeted v2 intervention readiness regression against plan/node/worker/adapter/session/Human Gate/side-effect states;
- targeted v2 validate regression for worker/session and adapter job consistency;
- full `npm run check`;
- full `npm run smoke:release`;
- server postcheck against active checkout and runtime state root.

Any failed test in the above means the surface is still useful or the replacement is incomplete; revert the freeze attempt and update the Batch C freeze table.
