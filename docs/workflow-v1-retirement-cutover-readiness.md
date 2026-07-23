# Workflow v1 Retirement / v2 Cutover Readiness

Status: active cutover control document  
Created: 2026-07-23  
Release line: `v0.8.2-rc.1` -> `v1.0.0`

Related:
- `docs/workflow-v1-v2-migration-worthiness-audit.md`
- `docs/workflow-v1.0-hard-cutover-plan.md`
- `docs/workflow-batch-freeze-table.md`
- `docs/workflow-freeze-pool-p7.md`
- `docs/workflow-v1-action-deprecation-ledger.md`
- `scripts/workflow_batch_freeze_audit.mjs`

## Purpose

This document is the single rollout matrix for retiring v1-only workflow
surfaces and preparing v2 as the default orchestration kernel. It replaces
one-slice-at-a-time operator reasoning with one current-state table.

The rule remains strict: only code with a proven v2/shared replacement or a
proven no-dependency/no-retention status may be frozen or removed. Shared
substrate must not be frozen as v1 code.

## Current Conclusion

The v1 retirement program is not blocked by the already-retired legacy launch,
run, task mutation, swarm, route-shell, supervisor, or checkpoint writer
surfaces. Those surfaces now have explicit frozen/removed/diagnostic contracts
and are covered by `npm run check:freeze`.

The remaining v1.0.0 cutover blockers are narrower:

1. full v2 intervention parity for `workflow.pause`, `workflow.resume`,
   `workflow.stop`, and `workflow.terminate`; v2 now has readiness, settlement
   preview, and plan-state transition actions, but not mutating external
   cancellation/closeout actions;
2. evaluator parity for `workflow.evaluate` persistence and blocker checks;
3. a service ownership decision for shared scheduler/control-loop maintenance;
4. adapter parity and observation window for `meeting.dispatch` /
   `meeting.ingest` / runtime bridge evidence;
5. read-history retirement criteria for legacy task list/draft/list-only
   surfaces.

## Current Classification Matrix

| Surface | Current state | Replacement / owner | Cutover action |
| --- | --- | --- | --- |
| `workflow.task.launch.prepare/review/approve` | `removed` | v2 plan admission, task-group package, Human Gate package/request | Keep removed; retain list-only historical reads. |
| `workflow.run.upsert`, `workflow.initiative.upsert` | `removed_external_surface` | `workflow.v2.plan.create` | Keep unknown-action guard; retain private helper only for remaining v1 compatibility internals. |
| `workflow.task.create`, `workflow.task.update` | `removed_external_surface` | v2 plan nodes, worker result/review state | Keep public mutation closed; retain private helper only while `meeting.action_item`/legacy advance compatibility needs it. |
| `workflow.swarm.*` | `removed` | v2 manager/worker/task-group model | Keep removed; no migration work. |
| `route_shell.*` | `source_deleted` | `runtime_agents`, `message_flow`, runtime adapters | Keep public actions unknown and retired runtime fail-closed; do not recreate route-shell execution. |
| `workflow.advance`, `workflow.supervise` | `frozen_compatibility` | supervisor readiness/next-actions/report/closeout/checkpoint plus shared dispatch/maintenance lanes | Keep default blocked; remove after compatibility window and live evidence prove no emergency caller. |
| `workflow.advance.preview`, `workflow.supervise.preview` | `compat_shell_only` | supervisor readiness/next-actions previews | Keep as explicit legacy diagnostics; do not use for new v2 planning. |
| `workflow.checkpoint` | frozen writer diagnostic | `workflow.supervisor.checkpoint`, `workflow.archive.checkpoint`, `workflow.checkpoint.legacy_export` | Keep non-mutating diagnostic; no legacy writes. |
| `workflow.task.draft` | authoring preview compatibility shell | `workflow.v2.plan.preview/create` and template instantiate | Retire active-sounding v1 authoring name after v2 plan/template authoring callers are retargeted. |
| `workflow.task.list`, `workflow.tasks`, `workflow.task.launch.list` | read/history shells | v2 plan/package read models and explicit archive reads | Keep explicit diagnostics/history until v2-first read models and archive names prove coverage. |
| `workflow.pause`, `workflow.resume`, `workflow.stop`, `workflow.terminate` | `legacy_active` | `workflow.v2.intervention_readiness.preview`, `workflow.v2.intervention_settlement.preview`, and `workflow.v2.pause/resume/stop/terminate` plan-state transitions | Do not freeze legacy lifecycle until v2 intervention has audited external cancellation/closeout semantics or an explicit decision that read-only settlement plus gated state transitions are sufficient. |
| `workflow.evaluate` | `legacy_active` | `workflow.v2.evaluation_snapshot.preview`, `workflow.v2.validate` | Migrate remaining blocker checks and persistence before freezing legacy evaluator writes. |
| `workflow.schedule.*` | `shared_scheduler_keep` | approved template / Human-Gate-approved v2 plan schedule binding | Keep; do not build a parallel v2 scheduler. Audit aliases only after usage evidence. |
| `workflow.control_loop.*` | `shared_maintenance_keep` / `shared_repair_keep` | generic bounded maintenance plus v2 worker control-loop adjacency | Keep shared maintenance; only legacy lanes may be retired. |
| `runtime.bridge.drain` | `shared_runtime_keep` | v2 adapter runner for worker jobs plus shared dispatch drain evidence | Keep until generic dispatch drain has equivalent service ownership and observation evidence. |
| `meeting.dispatch`, `meeting.ingest`, `meeting.resume`, `meeting.disperse`, `meeting.runtime_participant` | shared adapter / legacy-active mix | dispatch package surfaces plus shared runtime adapter evidence | Do not freeze without adapter parity audit and call-site migration evidence. |
| `message_flow.*`, `human_gate.*`, `incident.*`, `side_effect.*`, `trade.*`, `runtime.agent.*`, `workflow.event.*`, `workflow.session_*` | shared substrate | shared control-plane infrastructure | Forbidden to freeze as v1 code. |
| `research.*`, `instrument.*`, `radar.*`, `thesis.*`, `gate.review` | domain template later | future research/data workflow templates | Keep outside core v2 cutover until a concrete template plan requires migration. |

## Execution Order

### Phase 1: State Reconciliation

- Keep `scripts/workflow_batch_freeze_audit.mjs` aligned with this matrix.
- Keep `docs/workflow-v1-action-deprecation-ledger.md` and
  `docs/workflow-v1-v2-migration-worthiness-audit.md` aligned with actual
  action-policy metadata.
- Treat any mismatch between code, freeze script, and docs as a blocking
  documentation defect before starting new runtime changes.

### Phase 2: Remaining Migration Work

1. Use `workflow.v2.intervention_settlement.preview` as the operator-facing
   evidence package before pause/resume/stop/terminate; separately audit whether
   v2 needs mutating external cancellation/closeout actions or should keep those
   actions under runtime-specific receipt flows.
2. Move evaluator blocker checks into `workflow.v2.validate` and/or supervisor
   readiness while preserving durable evaluator evidence.
3. Decide whether shared schedule/control-loop maintenance remains in the
   generic control loop or moves to a named maintenance service. Do not put
   unrelated schedule/outbox/Human Gate repair into `workflow.v2.control_loop`.
4. Finish adapter parity for dispatch package / meeting dispatch / runtime
   bridge evidence before freezing meeting adapter entry points.
5. Define read-history retirement evidence for legacy task list/draft/list-only
   surfaces.

### Phase 3: Freeze and Removal

- Freeze only after the replacement action exists, call sites are migrated or
  gated, v2 no-dependency evidence is recorded, and regression proves no useful
  code was frozen.
- Delete only after a release-window observation period and Git recovery path
  are recorded.
- Keep shared substrate out of freeze/removal batches unless a separate
  architecture migration replaces the shared capability itself.

## Quality Gate

Every batch that changes behavior must pass:

- `npm run check:freeze`
- targeted regression for the changed surface
- `npm run check`
- `npm run smoke:release`
- `git diff --check`
- independent subagent review

For deployment to dev-server, also run:

- GitHub push and dev-server fast-forward pull
- server `npm run smoke:release`
- `openclaw plugins registry --refresh`
- workflow status against `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow`
- `main.workspace == /home/flashcat/.openclaw/workspace-cat_brain`
