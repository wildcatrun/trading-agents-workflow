# Workflow Batch Freeze Table

Status: active batch-freeze control table  
Created: 2026-07-17  
Related:
- `docs/workflow-v1-action-deprecation-ledger.md`
- `docs/workflow-freeze-pool-p7.md`
- `docs/workflow-p8-removal-candidates.md`
- `docs/workflow-v1-v2-migration-worthiness-audit.md`
- `docs/workflow-p14-advance-supervise-freeze-readiness-audit.md`
- `scripts/workflow_batch_freeze_audit.mjs`

## Purpose

This table replaces one-block-at-a-time freeze decisions with a batch control
surface. Freeze/remove candidates are selected by class, then validated by one
unified regression gate. The gate must identify:

1. code blocks that were frozen by mistake;
2. code blocks that v2 still depends on;
3. shared substrate that must not be treated as v1 legacy;
4. legacy read/history shells that may stay explicit but must not be promoted as
   new v2 planning paths.

Batch freeze is not permission to delete blindly. A candidate can move to actual
runtime freeze/removal only when its row has a v2 replacement, no v2 dependency
except declared shared substrate, known callers are understood, and rollback is
available through Git.

## Batch Classes

| Batch | Meaning | Default action |
| --- | --- | --- |
| A | Removed or deletion-ready legacy mutation surface. | Keep unknown-action or removed-surface guard; do not restore. |
| B | Legacy read/history/diagnostic shell. | Hide from normal mutation/planning path; keep explicit diagnostics until read parity is proven. |
| C | Active legacy or mixed maintenance executor. | Do not freeze yet; migrate/extract parity first. |
| D | Shared substrate used by v1, v2, safety, runtime, Human Gate, delivery, or evidence. | Forbidden to freeze as v1 code. |

## Freeze Candidate Table

| Code block/action | Batch | Current status | Freeze reason | V2 replacement | V2 dependency check | Known callers | Freeze action | Wrong-freeze signal | Rollback path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow.run.upsert`, `workflow.initiative.upsert`, `workflow-run` | A | `removed_external_surface` | Direct run creation is replaced by governed v2 plan admission. | `workflow.v2.plan.create` | `must_not_depend`; audit script checks `src/workflow-v2`. | Historical docs/tests only; private `workflowRunUpsert` helper may remain while legacy compatibility internals need parent run rows. | Keep removed; keep unknown-action regression. | Any v2 source reference to public action; permission/alias/metadata restored. | Revert the removal commit, not manual copy. |
| `workflow.task.create`, `workflow.task.update`, `workflow-task` mutating mode, `workflow-task-update` | A | `removed_external_surface` | Direct task mutation conflicts with v2 plan nodes and worker result/review state. | `workflow.v2.plan.create`, worker result/review actions | `must_not_depend`; private helper compatibility is separate from public action. | `meeting.action_item` mirror and `workflow.advance` may use private helpers; public callers must fail closed. | Keep public actions removed; preserve private helper until replacements exist. | `meeting.action_item` mirror breaks, or public permission/alias/metadata returns. | Revert the freeze/removal patch; private helper remains the rollback anchor. |
| `workflow.task.launch.prepare/review/approve` and aliases `draft/submit/brain_review` | A | `removed` | Legacy launch package materialized v1 rows; v2 owns admission and Human Gate package/request. | v2 plan admission, audits, task-group package, Human Gate package/request | `must_not_depend`; v2 source must not call launch actions. | `workflow.task.launch.list` only for historical package reads. | Keep mutating launch actions removed. | Any CLI/MCP/schema/action alias resurrects mutating launch. | Revert removal commit or re-add from Git history for emergency archive-only diagnostics. |
| `workflow.swarm`, `workflow.swarm.plan`, `workflow-swarm` | A | `removed` | Generic fanout was replaced by manager/worker/task-group mechanics. | `workflow.v2.worker_spawn.create` through v2 plan/manager surfaces | `must_not_depend`; v2 must use worker spawn, not swarm. | Historical docs/tests only. | Keep removed; keep unknown-action regression. | Source action registry, alias, CLI, or v2 dependency returns. | Revert removal commit. |
| `workflow.task.draft`, `workflow.task.create.preview`, `workflow.task.launch.preview` | B | `compat_shell_only` | Drafting is pure preview compatibility, not v2 admission. | `workflow.v2.plan.preview`, template instantiate preview | `must_not_depend`; v2 must not rely on task draft. | CLI dry-run and operator diagnostics. | Keep explicit preview; do not expose as mutation/admission path. | It creates DB rows or appears as approved v2 plan creation. | Revert guard/docs; no state rollback expected for pure preview. |
| `workflow.task.list`, `workflow.tasks`, `workflow.task.launch.list` | B | `compat_shell_only` / historical read | Historical v1 rows/packages remain evidence, but should not define new work. | v2 read models for plans/nodes/workers/packages | `must_not_depend`; v2 read models may read shared DB tables but should not call legacy list actions. | CLI/MCP read-only diagnostics and archived evidence lookup. | Keep explicit list/read; hide from mutation-first docs. | New v2 cards or default planning buttons depend on legacy list actions. | Revert docs/registry change; no destructive migration. |
| `workflow.advance.preview`, `workflow.supervise.preview` | B | `read_surface_migrated` / `compat_shell_only` | P15/P16 moved semantic readiness/evidence-gap cards to v2 supervisor previews. | `workflow.supervisor.readiness.preview`, `workflow.supervisor.next_actions.preview` | `must_not_depend`; v2 planning surfaces must not call legacy previews. | Explicit legacy diagnostics and historical task/run views. | Keep as compatibility diagnostics only. | Console default v2 evidence-gap card reuses legacy preview, or v2 source references these actions. | Revert console/read-model migration or restore diagnostic references only. |
| `workflow.advance`, `workflow.supervise` | C | `legacy_active` | Mutating behavior still owns legacy dispatch sync, task transitions, checkpoint, runtime drain, and closeout gaps. | Not complete; needs parity extraction before freeze. | `allowed_until_replaced`; current gate blocks by default but action remains. | Supervisor/control-loop compatibility, direct operator override with explicit legacy env. | Do not freeze/delete in batch. | Legacy task/dispatch reconciliation fails, or closeout executor parity absent. | Keep action implementation; rollback by disabling new parity path. |
| `workflow.checkpoint` | C | `legacy_active` | Recovery parity is not proven across v2 plan/node/worker/session state. | v2 checkpoint/readiness design still required. | `allowed_until_replaced`. | CLI/action registry, supervise closeout/recovery paths. | Do not freeze/delete. | Recovery evidence or incident closeout loses checkpoint boundary. | Keep existing checkpoint action. |
| `workflow.pause`, `workflow.resume`, `workflow.stop`, `workflow.evaluate` | C | `legacy_active` | Lifecycle/evaluator semantics need mapping to v2 plan, node, worker, Human Gate wait, and side-effect uncertainty states. | v2 lifecycle/review/validator actions. | `allowed_until_replaced`. | Operator controls and verification paths. | Do not freeze/delete. | Paused/stopped side-effect boundary becomes ambiguous. | Keep existing lifecycle actions. |
| `workflow.schedule.*` | C | `legacy_active` | Production schedules must bind to approved templates or approved v2 plans before raw scheduling can retire. | Approved template / Human-Gate-approved v2 plan scheduler. | `allowed_until_service_cutover`. | CLI, Hermes MCP governance tools, control-loop dispatch integration. | Do not freeze/delete; keep raw dispatch diagnostics gated. | Scheduled v2/template execution loses approval binding or dispatch. | Revert scheduler changes; keep existing schedule table/actions. |
| `workflow.control_loop.tick`, `workflow.control_loop.job.*` | C | `legacy_active` / shared maintenance | Control-loop still performs stale dispatch, dead-letter, and maintenance recovery while v2 service ownership is incomplete. | v2 adapter runner service plus shared maintenance split. | `allowed_until_service_cutover`. | Status guidance, console recovery previews, control-loop tests. | Do not freeze/delete; separate shared maintenance first. | Queues stop reconciling stale dispatch/outbox/dead-letter states. | Revert tick/job changes; keep action registry. |
| `runtime.bridge.drain` | C | `legacy_active` / shared runtime bridge | Real v2 wrappers and adapter runner cutover are not fully deployed; bridge still drains queued runtime work. | `workflow.v2.adapter_runner.drain` after live wrapper evidence. | `allowed_until_service_cutover`. | CLI runtime bridge, status guidance, control-loop drains, Hermers/OpenClaw adapter paths. | Do not freeze/delete. | Worker/dispatch queues stop producing terminal receipt evidence. | Revert runner migration; keep bridge drain action. |
| `meeting.dispatch`, `meeting.ingest`, `meeting.resume`, `meeting.disperse`, `meeting.runtime_participant` | C | `legacy_active` / shared adapter | These are not only meetings; they still provide dispatch, receipt, and runtime adapter evidence. | Shared runtime adapter or v2 package bridge. | `allowed_until_replaced`. | CLI, OpenClaw plugin actions, dispatch/receipt evidence paths. | Do not freeze/delete without adapter parity audit. | Runtime dispatch or receipt evidence disappears. | Keep dispatch module and registry. |
| `route_shell.ingest`, `route_shell.route` | C | `deprecated` / `archive_no_migration` | Route shell is not an active executor for migrated Hermers agents, but telemetry/fail-closed compatibility still exists. | `message_flow.send` and runtime adapter evidence. | `must_not_depend`; v2 must not depend on route shell. | CLI diagnostics, plugin action registry, migration telemetry. | Do not use for active execution; keep deprecation telemetry until archive removal is separately approved. | v2 worker backend accepts `openclaw_route_shell`, or registry uses route shell as fallback executor. | Keep current fail-closed route shell behavior. |
| `runtime.agent.*`, `workflow.runtime_agents`, `workflow.topology`, `workflow.readiness` | D | `shared_substrate` | Global runtime registry/readiness is the source for v1/v2/runtime ownership. | Shared cross-version substrate. | `expected_shared_dependency`. | All runtime-aware workflow paths. | Forbidden to freeze as v1. | Any v2 path invents a parallel registry or stops consulting runtime agents. | Revert any v2-local registry fork. |
| `message_flow.send/list/reconcile`, `workflow.message_flow.*`, `telegram.outbox.delivery/requeue*` | D | `shared_substrate` | Delivery, outbox, and receipt rails are shared evidence infrastructure. | Shared delivery/evidence substrate. | `expected_shared_dependency`. | V2 Human Gate delivery, runtime bridge, control-loop, IM/outbox. | Forbidden to freeze as v1. | A new parallel IM/outbox bypass appears or handler registry disappears. | Revert parallel delivery path. |
| `human_gate.request/web_app/button/feedback/resume/inbox/record`, `protocol.record` | D | `shared_substrate` | Final decision rail and protocol objects are not v1-specific. | Shared Human Gate/protocol substrate. | `expected_shared_dependency`. | v2 Human Gate package/request and legacy compatibility. | Forbidden to freeze as v1. | v2 treats local receipt as human approval, forks Human Gate, or handler registry disappears. | Revert fork; preserve shared Human Gate tables. |
| `incident.state`, `workflow.incident.*`, `side_effect.record`, `trade.proposal`, `risk.decision`, `trade.intent`, `trading_core.receipt` | D | `shared_substrate` | Safety, side-effect uncertainty, incident closeout, and trading handoff are cross-version boundaries. | Shared safety/trading substrate. | `expected_shared_dependency`. | Incident closeout, trade intent, side-effect ledger, trading_core contract. | Forbidden to freeze as v1. | v2 bypasses side-effect ledger/trading_core receipt, or handler registry disappears. | Revert bypass; block unsafe side effects. |
| `workflow.event.*`, `workflow.runtime_event.*`, `workflow.session_pack.*`, `workflow.session_run.*` | D | `shared_substrate` | Audit/event/session rails are required by v2 worker lifecycle and evidence. | Shared audit/session substrate. | `expected_shared_dependency`. | v2 info stack, worker lifecycle, readiness and receipt checks. | Forbidden to freeze as v1. | v2 loses durable evidence/session binding, or handler registry disappears. | Revert changes and keep shared tables. |

## Unified Regression Gate

Run the gate after a batch freeze/removal patch, not after every individual code
block.

1. Static dependency gate:
   - `node scripts/workflow_batch_freeze_audit.mjs --json`
   - Fails if a Batch A removed action regains permission, alias, migration
     metadata, handler registry, public CLI/MCP/plugin surface, or a v2/planning
     dependency.
   - Fails if a `must_not_depend` action appears under v2/planning surfaces,
     currently `src/workflow-v2/`, `src/console/`, or `static/console/`, except
     explicitly declared legacy diagnostic references.
   - Fails if Batch B/C/D actions that must remain available disappear from the
     true handler registry or alias table.
   - Fails if protected Batch D shared substrate loses its handler registry or
     alias anchor.
2. Syntax and core smoke:
   - `node --check scripts/workflow_batch_freeze_audit.mjs`
   - `npm run check`
3. Targeted regression:
   - `node scripts/workflow_regression_tests.mjs --grep "workflow convergence default gates|workflow P8 CLI legacy mutating shells retired|workflow supervisor next actions preview|workflow v2 readiness preview|runtime bridge extracted action contracts|meeting dispatch extracted action contracts|schedule control loop dispatch integration"`
4. Release smoke:
   - `npm run smoke:release -- --run-id <run-id> --out <artifact-dir>/smoke`
5. Dev-server postcheck after Git fast-forward deploy:
   - release smoke in active checkout;
   - `openclaw plugins registry --refresh`;
   - governance status with explicit runtime state root;
   - `main` workspace invariant.

## Wrong-Freeze Triage

When the gate finds a wrong freeze:

1. Mark the row as `wrong_freeze` or `v2_dependency_found` in the implementation
   notes.
2. Revert only that batch patch or restore the specific action from Git history.
3. Add the discovered caller to `Known callers`.
4. Move the row from Batch A/B to Batch C or D depending on whether it is active
   legacy behavior or shared substrate.
5. Re-run the unified gate before any deployment.

## Current Decision

No new runtime freeze is authorized by this document alone. The current safe
state is:

- Batch A remains removed and guarded.
- Batch B remains explicit diagnostic/read compatibility.
- Batch C remains active or deprecated compatibility until parity exists.
- Batch D is protected shared infrastructure and must not be frozen as v1.
