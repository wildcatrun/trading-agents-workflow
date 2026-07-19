# Workflow P14 Advance/Supervise Freeze-Readiness Audit

Date: 2026-07-17
Scope: `workflow.advance`, `workflow.advance.preview`, `workflow.supervise`, `workflow.supervise.preview`, and their legacy aliases `workflow.preview.advance`, `workflow.supervisor`, `workflow.supervisor.preview`, `workflow.preview.supervise`

## Status

P14 is a read-only freeze-readiness audit. It does not freeze, delete, hide, or reroute any legacy action.

The conclusion is deliberately split by action type:

- `workflow.advance.preview`: not deletion-ready, but can move toward deprecated diagnostic compatibility once console/read-model usage migrates to semantic supervisor readiness actions.
- `workflow.supervise.preview`: not deletion-ready, but can move toward deprecated diagnostic compatibility once console/read-model usage migrates to semantic supervisor readiness actions.
- `workflow.advance`: not freeze-ready as a mutating executor; valid dispatch/task-sync behavior is still legacy-owned.
- `workflow.supervise`: not freeze-ready as a mutating executor; valid drain/checkpoint/closeout behavior is still legacy-owned.

## Inputs Reviewed

- P11 audit: `docs/workflow-p11-advance-supervise-migration-audit.md`
- Naming policy: `docs/workflow-public-action-naming-policy.md`
- P12/P13 status: `docs/workflow-v2-implementation-status.md`
- Legacy executor code: `src/workflow-advance-actions.js`, `src/workflow-supervisor-actions.js`
- Replacement readiness code: `src/workflow-v2/readiness-actions.js`, `src/workflow-v2/supervisor-next-actions.js`
- Policy/alias/read-model references: `src/workflow/action-policy.js`, `src/workflow/action-aliases.js`, `src/console/read-model.js`
- Runtime evidence: `/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260717T-p14-freeze-readiness-audit/live-usage.txt`

## Runtime Evidence Refreshed

Dev-server DB checked at `2026-07-17T15:34:53+08:00`:

- `workflow_operations` rows for legacy advance/supervise and P12/P13 readiness actions: `0`.
- `control_loop_jobs` rows matching supervise/control-loop/adapter patterns: `0`.
- `workflow_tasks` rows: `0`.
- `workflow_runs` rows: `0`.
- `workflow_v2_plans`: `1` planned plan.
- `workflow_v2_plan_nodes`: `2` planned nodes.

This evidence supports "no observed live usage in current DB", but it does not prove that public callers, console affordances, docs, scripts, tests, or future controlled supervisor cycles are migrated.

## Replacement Coverage Matrix

| Legacy behavior | Current owner | P12/P13 coverage | Freeze decision |
| --- | --- | --- | --- |
| Next decision for missing workflow/task setup | `workflow.advance.preview` | Covered for v2 plans by `workflow.supervisor.readiness.preview` / `workflow.v2.readiness.preview` returning `needs_planning` when no v2 plan exists. | Preview can be migrated as a diagnostic, not deleted yet. |
| Dependency-ready work detection | `workflow.advance.preview` on legacy `workflow_tasks`; P12 on v2 plan nodes | Covered for v2 plan nodes by `dispatch_ready` and `readyNodes`. Legacy task rows remain separate. | Legacy task compatibility remains. |
| Active dispatch/receipt wait detection | `workflow.advance.preview` plus `mixed_meeting_dispatches`; P12 worker/adapter status | Partially covered for v2 worker runs and adapter jobs. Legacy dispatch terminal sync is not replaced. | Mutating advance not freeze-ready. |
| Human Gate pending detection | `workflow.advance.preview` and Human Gate tables; P12 v2 package state | Partially covered for v2 package states. Completion truth still belongs to Human Gate records, not package status alone. | Keep legacy preview until read models migrate. |
| Terminal dispatch sync into `workflow_tasks` | `workflow.advance` | Not covered by P12/P13. This is a legacy table reconciliation side effect. | Mutating advance not freeze-ready. |
| Auto-dispatch of ready legacy tasks | `workflow.advance` | Not replaced. V2 has worker-spawn previews and create actions, but no one-shot legacy task auto-dispatch parity. | Mutating advance not freeze-ready. |
| `workflow_runs.current_decision/status` mutation | `workflow.advance` | Not replaced; v2 plans use separate state fields. | Keep until legacy run rows are formally retired or migrated. |
| Supervisor preview for drain/checkpoint/Cat Claw report | `workflow.supervise.preview` | Partially covered by `workflow.supervisor.next_actions.preview`; P13 exposes worker spawn, adapter drain readiness, Human Gate request, manager review, blocker review, and closeout gap. P19 adds completed-plan closeout executor, but checkpoint writer/runtime-drain parity remains incomplete. | Preview migration can start, deletion cannot. |
| Supervisor executor cycle | `workflow.supervise` | Not covered as a single authorized executor. V2 has separate mutating actions for control-loop ticks, adapter drain, worker result, Human Gate package/request, and worker lifecycle. | Mutating supervise not freeze-ready. |
| Checkpoint write | `workflow.supervise` -> `workflowCheckpoint` | Not replaced by P12/P13. | Mutating supervise not freeze-ready. |
| Cat Claw closeout dispatch and deferred drain evidence | `workflow.supervise` -> `meetingDispatch`; P21 removed direct `runtimeBridgeDrain` calls. | P19 adds completed-plan `workflow.supervisor.closeout`; blocked/Human Gate pending report paths remain outside this slice; actual generic drain is owned by control-loop `runtime_drain`. | Mutating supervise not freeze-ready. |

## Action-Level Decision

### `workflow.advance.preview`

Decision: keep as diagnostic compatibility.

Reason:

- It is read-only and still exposed in policy/docs as an operator-safe diagnostic surface.
- P12/P13 provide the preferred semantic replacement for v2 state, but console/read-model references still expose legacy supervise preview, and legacy task/run history is not fully retired.

Freeze path:

1. Migrate console/read-model preview affordances from legacy previews to `workflow.supervisor.readiness.preview` and `workflow.supervisor.next_actions.preview`.
2. Update docs to present legacy advance preview as compatibility-only.
3. Keep alias compatibility until the v1 removal release, but stop recommending it for new operations.

### `workflow.supervise.preview`

Decision: keep as diagnostic compatibility.

Reason:

- It is the current read-only wrapper that tells operators whether a real legacy supervisor cycle would drain runtimes, checkpoint, or create a Cat Claw report dispatch.
- P13 covers "what should be considered next" for v2 plans. P19 covers completed-plan closeout dispatch, but not checkpoint writer/runtime-drain parity.

Freeze path:

1. Add or document explicit replacement candidates for checkpoint preview and closeout preview.
2. Migrate console/read-model cards from `workflow.supervise.preview` to semantic supervisor previews.
3. Mark `workflow.supervise.preview` compatibility-only after the above migration lands.

### `workflow.advance`

Decision: not freeze-ready.

Reason:

- It still owns mutating legacy behavior: terminal dispatch sync, ready task auto-dispatch, task `in_progress` transition, and `workflow_runs` decision/status update.
- P12/P13 intentionally add read-only v2 readiness surfaces and do not replace these side effects.

Freeze preconditions:

1. Prove no active scheduler, CLI, console, MCP, or scripted caller uses `workflow.advance`.
2. Either migrate terminal dispatch sync and legacy task transitions into a shared reconciler, or formally retire the legacy `workflow_tasks`/`workflow_runs` execution path.
3. Provide fixture coverage proving v2 plan/node/worker execution can progress without `workflow.advance`.

### `workflow.supervise`

Decision: not freeze-ready.

Reason:

- It still owns invoking the legacy supervisor executor cycle: repeated advance cycles, optional runtime bridge drain, checkpoint write, final non-dispatching advance, and optional Cat Claw report dispatch/drain.
- P13 explicitly leaves final v2 closeout as a replacement gap.

Freeze preconditions:

1. Implement or explicitly retire checkpoint parity.
2. Implement v2 Cat Claw closeout/report executor or formally move it to Human Gate/outbox actions with receipt evidence.
3. Prove `workflow.v2.control_loop.tick`, `workflow.v2.adapter_runner.drain`, worker result handling, Human Gate package/request, and closeout actions cover the required supervisor lifecycle.
4. Prove no live `control_loop_jobs` or operator paths still dispatch `workflow.supervise`.

## Freeze Pool Update Recommendation

P14 should not add the mutating actions to the freeze pool.

Recommended classification:

| Action | Classification | Rationale |
| --- | --- | --- |
| `workflow.advance.preview` | `compat_shell_only / migrate_read_surface` | V2 readiness covers new plan decisions, but console/docs still need migration. |
| `workflow.supervise.preview` | `compat_shell_only / migrate_read_surface` | P13 next-actions covers most preview planning needs, but checkpoint/closeout parity is incomplete. |
| `workflow.advance` | `keep_until_reconciler_or_retirement` | Side effects still valid for legacy task/run state. |
| `workflow.supervise` | `keep_until_v2_supervisor_executor_or_retirement` | Executor side effects still valid and not replaced by P12/P13. |

## Next Slice

P15 should be a read-surface migration, not a mutating retirement:

1. Replace console/read-model preview references from `workflow.supervise.preview` to `workflow.supervisor.readiness.preview` and `workflow.supervisor.next_actions.preview` where the card concerns v2 readiness or evidence gap planning.
2. Keep legacy preview references only for legacy `workflow_tasks` / `workflow_runs` cards.
3. Add regression coverage proving console allowed actions and card preview actions prefer semantic supervisor names.
4. After that, update docs to mark legacy previews as compatibility-only.

Do not freeze `workflow.advance` or `workflow.supervise` until mutating parity is either implemented or explicitly retired with evidence.

## P17 Follow-Up

P17 adds `workflow.supervisor.closeout.preview` as the read-only closeout preview
called out by this audit. This reduces the preview gap for completed v2 plans,
but by itself did not implement the final Cat Claw closeout executor. P19 later
adds the executor; mutating `workflow.supervise` remains not freeze-ready due to
the remaining checkpoint, dispatch-sync, runtime-drain and non-completed report
gaps.

## P18 Follow-Up

P18 adds `workflow.supervisor.checkpoint.preview` as the read-only checkpoint
preview called out by this audit. This makes the checkpoint recovery-boundary
gap visible from v2 supervisor surfaces, but it does not implement a v2/shared
checkpoint writer and therefore does not make `workflow.checkpoint` or mutating
`workflow.supervise` freeze-ready.

## P19 Follow-Up

P19 adds `workflow.supervisor.closeout` as the governed completed-plan Cat Claw
closeout executor. It writes closeout evidence and queues one idempotent
`openclaw:cat_claw` dispatch after an existing checkpoint boundary is present.
It does not replace checkpoint writing, dispatch sync, runtime drain, blocked
reporting, or Human Gate pending reporting.
