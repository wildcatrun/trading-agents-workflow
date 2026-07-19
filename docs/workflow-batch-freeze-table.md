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
| E | Live-state clean legacy archive with active source compatibility entrypoints. | Do not migrate or delete; first close source entrypoints in a dedicated behavior-changing freeze batch. |
| F | Source-frozen legacy archive. | Keep retired/unknown/fail-closed contracts; delete remaining implementation only in a later deletion batch after full regression. |

## Freeze Candidate Table

| Code block/action | Batch | Current status | Freeze reason | V2 replacement | V2 dependency check | Known callers | Freeze action | Wrong-freeze signal | Rollback path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow.run.upsert`, `workflow.initiative.upsert`, `workflow-run` | A | `removed_external_surface` | Direct run creation is replaced by governed v2 plan admission. | `workflow.v2.plan.create` | `must_not_depend`; audit script checks `src/workflow-v2`. | Historical docs/tests only; private `workflowRunUpsert` helper may remain while legacy compatibility internals need parent run rows. | Keep removed; keep unknown-action regression. | Any v2 source reference to public action; permission/alias/metadata restored. | Revert the removal commit, not manual copy. |
| `workflow.task.create`, `workflow.task.update`, `workflow-task` mutating mode, `workflow-task-update` | A | `removed_external_surface` | Direct task mutation conflicts with v2 plan nodes and worker result/review state. | `workflow.v2.plan.create`, worker result/review actions | `must_not_depend`; private helper compatibility is separate from public action. | `meeting.action_item` mirror and `workflow.advance` may use private helpers; public callers must fail closed. | Keep public actions removed; preserve private helper until replacements exist. | `meeting.action_item` mirror breaks, or public permission/alias/metadata returns. | Revert the freeze/removal patch; private helper remains the rollback anchor. |
| `workflow.task.launch.prepare/review/approve` and aliases `draft/submit/brain_review` | A | `removed` | Legacy launch package materialized v1 rows; v2 owns admission and Human Gate package/request. | v2 plan admission, audits, task-group package, Human Gate package/request | `must_not_depend`; v2 source must not call launch actions. | `workflow.task.launch.list` only for historical package reads. | Keep mutating launch actions removed. | Any CLI/MCP/schema/action alias resurrects mutating launch. | Revert removal commit or re-add from Git history for emergency archive-only diagnostics. |
| `workflow.swarm`, `workflow.swarm.plan`, `workflow-swarm` | A | `removed` | Generic fanout was replaced by manager/worker/task-group mechanics. | `workflow.v2.worker_spawn.create` through v2 plan/manager surfaces | `must_not_depend`; v2 must use worker spawn, not swarm. | Historical docs/tests only. | Keep removed; keep unknown-action regression. | Source action registry, alias, CLI, or v2 dependency returns. | Revert removal commit. |
| `workflow.task.draft`, `workflow.task.create.preview`, `workflow.task.launch.preview` | B | `compat_shell_only` | Drafting is pure preview compatibility, not v2 admission. | `workflow.v2.plan.preview`, template instantiate preview | `must_not_depend`; v2 must not rely on task draft. | CLI dry-run and operator diagnostics. | Keep explicit preview; do not expose as mutation/admission path. | It creates DB rows or appears as approved v2 plan creation. | Revert guard/docs; no state rollback expected for pure preview. |
| `workflow.task.list`, `workflow.tasks`, `workflow.task.launch.list` | B | `compat_shell_only` / historical read | Historical v1 rows/packages remain evidence, but should not define new work. | v2 read models for plans/nodes/workers/packages | `must_not_depend`; v2 read models may read shared DB tables but should not call legacy list actions. | CLI/MCP read-only diagnostics and archived evidence lookup. | Keep explicit list/read; hide from mutation-first docs. | New v2 cards or default planning buttons depend on legacy list actions. | Revert docs/registry change; no destructive migration. |
| `workflow.advance.preview`, `workflow.supervise.preview` | B | `read_surface_migrated` / `compat_shell_only` | P15/P16 moved semantic readiness/evidence-gap cards to v2 supervisor previews; P17/P18 add v2 closeout and checkpoint previews; P22 adds blocked/Human Gate pending report preview. | `workflow.supervisor.readiness.preview`, `workflow.supervisor.next_actions.preview`, `workflow.supervisor.checkpoint.preview`, `workflow.supervisor.closeout.preview`, `workflow.supervisor.report.preview` | `must_not_depend`; v2 planning surfaces must not call legacy previews. | Explicit legacy diagnostics and historical task/run views. | Keep as manual compatibility diagnostics only; do not show in priority catalog or direct card buttons. | Console default v2 evidence-gap card reuses legacy preview, legacy preview returns to priority catalog, or v2 source references these actions. | Revert console/read-model migration or restore diagnostic references only. |
| `workflow.advance`, `workflow.supervise` | C | `legacy_active` | Mutating behavior still owns legacy dispatch sync and task/run transitions; P20/P21/P22 replace v2 checkpoint, direct drain, and blocked/Human Gate pending report gaps for v2 rows. Batch C audit: `docs/workflow-batch-c-advance-supervise-migration-audit.md`. | Partial: `workflow.supervisor.checkpoint`, `workflow.supervisor.closeout`, `workflow.supervisor.report`; legacy row sync/dispatch remains. | `allowed_until_legacy_rows_retired_or_sync_extracted`; current gate blocks by default but action remains. | Supervisor/control-loop compatibility, direct operator override with explicit legacy env. | Do not freeze/delete in batch. | Legacy task/dispatch reconciliation fails or active legacy rows still need supervise. | Keep action implementation until legacy row audit/extraction completes. |
| `workflow.checkpoint` | C | `legacy_active` | P20 adds `workflow.supervisor.checkpoint` for v2 plan checkpoint rows/artifacts without `workflow_runs` / `workflow_tasks`, but legacy supervisor/control-loop compatibility may still call the old writer. Batch C substrate audit: `docs/workflow-batch-c-shared-substrate-audit.md`. | `workflow.supervisor.checkpoint.preview`, `workflow.supervisor.checkpoint`. | `allowed_until_legacy_callers_replaced`. | Legacy CLI/action registry and supervise recovery paths. | Do not freeze/delete until legacy callers are either frozen or retargeted. | Legacy recovery evidence fails, or supervisor/control-loop compatibility still calls old checkpoint path. | Keep legacy action; route v2 supervisor checkpointing through P20 writer. |
| `workflow.pause`, `workflow.resume`, `workflow.stop`, `workflow.evaluate` | C | `legacy_active` | Lifecycle/evaluator semantics need mapping to v2 plan, node, worker, Human Gate wait, and side-effect uncertainty states; Batch C lifecycle audit: `docs/workflow-batch-c-lifecycle-evaluate-audit.md`. | v2 lifecycle/review/validator actions. | `allowed_until_replaced`. | Operator controls and verification paths. | Do not freeze/delete. | Paused/stopped side-effect boundary becomes ambiguous. | Keep existing lifecycle actions. |
| `workflow.schedule.*` | C | `shared_scheduler` / `legacy_diagnostic_gate` | Production schedules already fail closed unless bound to approved active/default templates or approved Human Gate plans; raw scheduling is diagnostic-only. Batch C audit: `docs/workflow-batch-c-schedule-control-loop-audit.md`. | Approved template / Human-Gate-approved plan scheduler with receipt and dispatch evidence. | `expected_shared_dependency`; raw schedule diagnostics `allowed_until_service_cutover`. | CLI, Hermes MCP governance tools, control-loop dispatch integration. | Do not freeze/delete; keep raw dispatch diagnostics gated and disabled by default. | Scheduled approved template/plan execution loses admission binding, due-run seeding, dispatch, or runtime drain. | Revert scheduler changes; keep existing schedule table/actions. |
| `workflow.control_loop.tick`, `workflow.control_loop.job.*` | C | `shared_maintenance` / `legacy_supervise_lane` | Control-loop owns shared schedule, runtime drain, stale dispatch, message-flow, Human Gate, outbox, and repair lanes; only `workflow_supervise` is legacy lane. Batch C audit: `docs/workflow-batch-c-schedule-control-loop-audit.md`. | Shared maintenance service plus extracted/retired legacy supervise lane; v2 worker control-loop is only partial replacement. | `expected_shared_dependency`; legacy supervise `allowed_until_replaced`. | Status guidance, console recovery previews, control-loop tests. | Do not freeze/delete; split shared maintenance from legacy supervise first. | Queues stop reconciling scheduled dispatch/runtime drain/message-flow/Human Gate/outbox/dead-letter states. | Revert tick/job changes; keep action registry. |
| `runtime.bridge.drain` | C | `shared_runtime_substrate` | P21 removed direct supervisor calls, but bridge still drains generic queued `mixed_meeting_dispatches` through control-loop `runtime_drain`, operator recovery, status guidance, and runtime adapter paths; Batch C substrate audit: `docs/workflow-batch-c-shared-substrate-audit.md`. | `workflow.v2.adapter_runner.drain` only replaces v2 worker adapter job execution; generic `mixed_meeting_dispatches` drain replacement remains TBD. | `allowed_until_service_cutover`. | CLI runtime bridge, status guidance, control-loop drains, Hermers/OpenClaw adapter paths. | Do not freeze/delete. | Worker/dispatch queues stop producing terminal receipt evidence. | Revert runner migration; keep bridge drain action. |
| `meeting.dispatch`, `meeting.ingest`, `meeting.resume`, `meeting.disperse`, `meeting.runtime_participant` | C | `legacy_active` / shared adapter | These are not only meetings; they still provide dispatch, receipt, and runtime adapter evidence; Batch C substrate audit: `docs/workflow-batch-c-shared-substrate-audit.md`. | Shared runtime adapter or v2 package bridge. | `allowed_until_replaced`. | CLI, OpenClaw plugin actions, dispatch/receipt evidence paths. | Do not freeze/delete without adapter parity audit. | Runtime dispatch or receipt evidence disappears. | Keep dispatch module and registry. |
| `route_shell.ingest`, `route-shell.ingest`, `route_shell.route` | F/G | `source_deleted` | Batch E proved live state was clean; Batch F closed source entrypoints; Batch G deletes the archived implementation and empty registry wiring. Batch F/G notes: `docs/workflow-batch-f-route-shell-source-freeze.md`. | `message_flow.send` and direct runtime adapter dispatch from `runtime_agents`; no v2 migration. | `must_not_depend`; v2 must not depend on route shell and must keep backend rejection. | Historical docs/tests only; `meeting.dispatch runtime=openclaw_route_shell` and `runtime.bridge.drain runtime=openclaw_route_shell` fail closed. Shared historical `openclaw_route_shell` runtime vocabulary may remain for old rows and audits. | Keep source deleted; do not recreate route-shell public action, CLI, Gateway hook, aliases, permission, or migration metadata. | Any public CLI/MCP/plugin action, alias, permission, migration metadata, Gateway hook, successful route-shell redirect, or v2 dependency returns. | Revert Batch G deletion if a real caller is found; otherwise restore specific code from Git history only as an archive diagnostic. |
| `runtime.agent.*`, `workflow.runtime_agents`, `workflow.topology`, `workflow.readiness` | D | `shared_substrate` | Global runtime registry/readiness/topology is the source for runtime ownership, dispatch capability, and cross-platform boundaries; Batch D audit: `docs/workflow-batch-d-shared-substrate-audit.md`. | Shared cross-version runtime substrate, not a v2-local registry. | `expected_shared_dependency`. | All runtime-aware workflow paths, v2 worker backends, runtime bridge, readiness/status. | Forbidden to freeze as v1; do not fork under a v2 name. | Any v2 path invents a parallel registry, stops consulting runtime agents, or reintroduces route-shell fallback ownership. | Revert any v2-local registry fork and preserve shared registry fields. |
| `message_flow.send/list/reconcile`, `workflow.message_flow.*`, `telegram.outbox.delivery/requeue*` | D | `shared_substrate` | Delivery, outbox, and receipt rails are shared evidence infrastructure; v2 Human Gate request uses shared outbox rather than direct send. Batch D audit: `docs/workflow-batch-d-shared-substrate-audit.md`. | Shared delivery/evidence substrate. | `expected_shared_dependency`. | V2 Human Gate request/delivery preview, runtime bridge, control-loop, IM/outbox, local Codex inbox evidence. | Forbidden to freeze as v1; do not bypass with direct IM/OpenClaw message send. | A new parallel IM/outbox bypass appears, local Codex inbox receipt is treated as approval, or handler registry disappears. | Revert parallel delivery path and restore governed message_flow/outbox evidence. |
| `human_gate.request/web_app/button/feedback/resume/inbox/record`, `protocol.record` | D | `shared_substrate` | Final decision rail and protocol objects are not v1-specific; v2 Human Gate package/request delegates to shared Human Gate/protocol handlers. Batch D audit: `docs/workflow-batch-d-shared-substrate-audit.md`. | Shared Human Gate/protocol substrate. | `expected_shared_dependency`. | V2 Human Gate package/request, Telegram outbox, meeting resume compatibility, trade proposal/risk/intent binding. | Forbidden to freeze as v1; do not fork Human Gate under v2. | v2 treats local receipt as human approval, forks Human Gate, bypasses button-first protocol record rules, or handler registry disappears. | Revert fork; preserve shared Human Gate/protocol tables and approval semantics. |
| `incident.state`, `workflow.incident.*`, `side_effect.record`, `trade.proposal`, `risk.decision`, `trade.intent`, `trading_core.receipt` | D | `shared_substrate` | Safety, side-effect uncertainty, incident closeout, and trading handoff are cross-version boundaries; Batch D audit: `docs/workflow-batch-d-shared-substrate-audit.md`. | Shared safety/trading substrate. | `expected_shared_dependency`. | Incident closeout/evidence/Human Gate escalation, side-effect ledger, trade intent, trading_core receipt contract. | Forbidden to freeze as v1; do not create v2-specific safety/trading ledgers. | v2 bypasses side-effect ledger/trading_core receipt, weakens proposal/risk/Human Gate/idempotency/mtls gates, or handler registry disappears. | Revert bypass; block unsafe side effects and preserve trading handoff gates. |
| `workflow.event.*`, `workflow.runtime_event.*`, `workflow.session_pack.*`, `workflow.session_run.*` | D | `shared_substrate` | Audit/event/session rails are required by v2 worker lifecycle, adapter runner, result handling, validation, and evidence. Batch D audit: `docs/workflow-batch-d-shared-substrate-audit.md`. | Shared audit/session substrate. | `expected_shared_dependency`. | V2 info stack, worker lifecycle, adapter runner, worker result, validators, readiness and receipt checks. | Forbidden to freeze as v1; do not duplicate under v2 unless there is a real semantic conflict. | v2 loses durable evidence/session binding, cross-version trace continuity, or handler registry disappears. | Revert changes and keep shared event/session tables. |

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
   - Fails if legacy diagnostic previews return to the console priority catalog.
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
- Batch F/G has source-deleted route-shell after source freeze, live clean postchecks, and regression confirmation; do not recreate route-shell execution or public entry points.
