# Workflow v1/v2 Refactor and Migration Plan

Status: draft development plan  
Created: 2026-07-15  
Target end state: `v1.0.0`

## Purpose

This document turns the current Workflow v1/v2 coexistence into a controlled
refactor and migration program.

The goal is not to move Workflow v2 back into Workflow v1. The goal is to make
Workflow v2 the default orchestration kernel, migrate valid Workflow v1
capabilities into that kernel, and reduce Workflow v1 to compatibility shims
plus archived legacy evidence.

Migration implementation targets must first pass the value audit in
`docs/workflow-v1-v2-migration-worthiness-audit.md`. A code block being old,
large, or marked legacy is not sufficient reason to migrate it.
The active batch freeze ledger is `docs/workflow-freeze-pool-p7.md`.

## Current Release Position

Current package release candidate:

- Package version: `0.8.2-rc.1`
- Workflow v1: frozen compatibility path; mutating legacy entry points are not
  default surfaces and must not receive new orchestration behavior.
- Workflow v2: governed orchestration module enabled for preview, rehearsal,
  audit, Human Gate packaging, and paper-only pre-execution guardrails.
- Real v2 worker wrappers, live delivery, production migration, and live trading:
  gated/off.

`v0.8.x` and `v0.9.x` should be treated as migration releases. `v1.0.0` should
mean Workflow v2 is the default kernel and Workflow v1 is no longer an active
orchestration implementation.

## Topology Snapshot

### Entry and Dispatch Topology

```text
index.js / bin/cat-meeting-governance.mjs / MCP tools
  -> src/core.js runAction
  -> src/workflow.js runWorkflowAction
  -> canonicalWorkflowAction
  -> authorizeWorkflowAction + workflowConvergenceGate
  -> action registries in fixed order
```

`src/core.js` routes `workflow.*`, `workflow.v2.*`, `message_flow.*`,
most `human_gate.*`, `telegram.outbox.*`, `runtime.*`, `trade.*`, and related
actions into `runWorkflowAction`. One compatibility exception remains:
`human_gate.record` with a legacy `meetingId` stays on the older meeting record
path. Any Human Gate migration must preserve or explicitly retire that path.

`src/workflow.js` remains the central composition root. It imports and wires all
legacy modules, v2 modules, policy gates, shared schema initialization, and
action registry ordering.

Current registry dispatch order starts with Workflow v2, then shared delivery
and governance surfaces, then legacy workflow surfaces:

```text
workflow.v2.*
message_flow
telegram.live / telegram.outbox
human_gate
protocol / trade / side_effect
incident / intervention
research / cat_claw / topology / runtime_agents
meeting ingest/dispatch/control
route_shell / dispatch_reconcile
status / permission / schedule / events / runtime_events
session / checkpoint / control_loop_job / verification
workflow_run / workflow_task / workflow_task_launch / swarm
workflow_advance / workflow_supervisor
workflow.control_loop.tick
runtime.bridge
```

Implication: Workflow v2 is already first-class in the dispatcher, but it still
depends on the shared v1-era composition root and shared database initialization.

### Code Size and Concentration

The largest concentration of architectural risk remains:

| File | Current role | Approximate size | Migration implication |
| --- | --- | ---: | --- |
| `src/workflow.js` | Composition root, schema owner, shared helpers, registry wiring, legacy glue | ~9.2k lines | Split carefully; do not add more new domain logic here. |
| `src/console/read-model.js` | Console/read-model aggregation across v1/v2/shared state | ~6.5k lines | Keep as read-side projection until v2 default is stable. |
| `src/workflow-v2/adapter-runner-actions.js` | v2 adapter job runner/drain/service contract | ~2.0k lines | High-risk runtime boundary; keep gated until wrapper rollout. |
| `src/core.js` | Top-level command/action routing | ~1.3k lines | Keep thin; later route v1 shim/v2 kernel explicitly. |

## State Model Topology

### Shared v1-era Control Plane Tables

These tables are still shared runtime/control-plane infrastructure and should
not be removed during early migration:

- `runtime_agents`
- `mixed_meeting_dispatches`
- `runtime_runs`
- `runtime_semantic_events`
- `runtime_current_state`
- `message_flows`
- `message_flow_events`
- `telegram_outbox`
- `human_gate_buttons`
- `human_gate_batches`
- `protocol_objects`
- `side_effect_ledger`
- `incident_states`
- `readiness_snapshots`
- `workflow_events`
- `artifact_index`
- `workflow_session_packs`
- `workflow_session_runs`

These are not "v1-only" just because they were created before v2. They form the
shared evidence, delivery, Human Gate, runtime registry, side-effect, and
readiness substrate. Session packs/runs are also shared: v2 worker lifecycle,
adapter runner, and validation paths depend on them as session/input substrate.

### Legacy Workflow Tables

Legacy orchestration state is centered on:

- `workflow_runs`
- `workflow_phases`
- `workflow_tasks`
- `workflow_task_dependencies`
- `workflow_checkpoints`
- `workflow_agent_runs`
- `workflow_schedules`
- `scheduled_runs`
- `control_loop_jobs`

These should become either compatibility state, migration source state, or
archived state. They should not be the target model for new orchestration work.

### Workflow v2 Tables

Workflow v2 state is centered on:

- `workflow_v2_plans`
- `workflow_v2_plan_nodes`
- `workflow_v2_info_items`
- `workflow_v2_inbox_items`
- `workflow_v2_access_grants`
- `workflow_v2_read_receipts`
- `workflow_v2_worker_runs`
- `workflow_v2_worker_adapter_jobs`
- `workflow_v2_worker_handoffs`
- `workflow_v2_manager_reviews`
- `workflow_v2_owner_reviews`
- `workflow_v2_task_group_packages`
- `workflow_v2_cat_brain_audits`
- `workflow_v2_cat_claw_audits`
- `workflow_v2_notifications`
- `workflow_v2_human_gate_packages`
- `workflow_v2_backend_preflights`

These are the target orchestration kernel tables.

## Functional Topology

### Workflow v1 Domains

| Domain | Representative modules/actions | Current role | Migration target |
| --- | --- | --- | --- |
| Task/run orchestration | `workflow.run.*`, `workflow.task.*`, `workflow.task.launch.*`, `workflow.advance`, `workflow.supervise` | Legacy plan/task machinery | Freeze run/task/task-launch/swarm entry points listed in the P7 freeze pool; move valid progression/readiness checks into v2/shared validators before retiring `workflow.advance` or `workflow.supervise`. |
| Schedule/control loop | `workflow.schedule.*`, `workflow.control_loop.tick`, `workflow.control_loop.job.*`, `runtime.bridge.drain`, `workflow.dispatch.reconcile` | Mechanical queue, retry, runtime drain, reconciliation | Replace default orchestration usage with v2 adapter drain service and v2 worker result paths; keep shared delivery maintenance where still needed. |
| Meeting/runtime dispatch | `meeting.dispatch`, `meeting.ingest`, `runtime.bridge.drain` | Cross-runtime dispatch and receipt bridge | Preserve as shared runtime adapter substrate until v2 adapter runners fully cover real workers. |
| Message flow | `message_flow.send/list/reconcile` | Governed notification and delivery evidence | Keep as shared notification layer, not authoritative v2 worker content. |
| Human Gate | `human_gate.*`, `telegram.outbox.*` | Final user decision and delivery substrate | Keep shared; v2 packages evidence and calls shared Human Gate/outbox. |
| Trading hard gates | `trade.proposal`, `risk.decision`, `trade.intent`, `trading_core.receipt`, `side_effect.record` | Deterministic trading and side-effect boundary | Keep shared; v2 must not replace trading_core boundaries. |
| Incident/readiness | `workflow.readiness`, `incident.state`, closeout actions | Evidence/readiness/dead-letter views | Keep shared read model while adding v2-specific evidence inputs. |

### Workflow v2 Domains

| Domain | Representative modules/actions | Current role | Maturity |
| --- | --- | --- | --- |
| Plan/kernel | `workflow.v2.plan.preview/create`, `workflow.v2.validate` | Canonical fixed-template plan and node state | Candidate-ready for governed preview/rehearsal. |
| Information stack | `workflow.v2.info_stack.*`, read receipts, notifications | Internal v2 evidence and handoff stack | Candidate-ready; not a replacement for external delivery. |
| Worker lifecycle | `worker_spawn`, lifecycle, handoff, retire, successor | Defines worker runs and lifecycle transitions | Candidate-ready for synthetic/local paths; real wrappers gated. |
| Adapter jobs | `worker_adapter_job.*`, `adapter_runner.*` | Lease/claim/drain contract for runtime wrappers | Contract-ready; real execution gated/off. |
| Reviews/audits | manager review, owner review, task group package, Cat Brain audit, Cat Claw audit | Structured governance before Human Gate | Candidate-ready for rehearsal/paper-only. |
| Human Gate bridge | v2 package/request actions | Produces governed Human Gate packages and calls shared Human Gate | Candidate-ready for preview/rehearsal; live delivery gated. |
| Template lifecycle | `workflow.template.*` | Candidate templates, instantiate/eval/promote/rollback | Candidate-ready; promotion remains high-risk/Human-Gate governed. |

## Key Architectural Findings

1. **Workflow v2 is not a separate runtime.** It is a new orchestration kernel
   inside the same plugin and same SQLite control-plane database.
2. **Workflow v1 and v2 already share critical substrate.** Runtime registry,
   Human Gate, message_flow, Telegram outbox, protocol objects, side-effect
   ledger, readiness, and incident evidence are shared.
3. **`src/workflow.js` is the main migration bottleneck.** It is both schema
   owner and registry composer, and it contains compatibility glue plus legacy
   schema initialization.
4. **V2 still has legacy names in limited places.** `workflow.v2.control_loop.*`
   and adapter job heartbeat names are mechanical worker queue terms, not
   permission to revive old semantic control-loop behavior.
5. **Message flow is infrastructure.** It must not be modified to fit
   task-specific semantics; v2 should treat it as a notification/evidence layer.
6. **Trading boundaries must remain shared and deterministic.** V2 should only
   prepare audited evidence and typed intents; `trading_core` remains the final
   deterministic execution boundary.

## Migration Direction

Do not migrate Workflow v2 back into Workflow v1.

Target direction:

```text
valid Workflow v1 capability
  -> extracted/shared module or v2 kernel equivalent
  -> v1 action shim
  -> legacy implementation retired or archived
```

The word "valid" is controlled by
`docs/workflow-v1-v2-migration-worthiness-audit.md`, not by intuition. If the
audit class is `compat_shell_only`, `optional_or_template_later`,
`shared_substrate`, or `archive_no_migration`, the implementation plan must not
treat the block as a must-migrate target.

Workflow v1 should end as:

- frozen, time-boxed compatibility action names;
- thin adapters into v2 or shared substrate;
- archived legacy implementation evidence;
- no default ownership of new orchestration semantics.

## Version Roadmap

| Version line | Goal | Default workflow kernel | Allowed scope |
| --- | --- | --- | --- |
| `v0.8.x` | Release candidate hygiene and boundary cleanup | v1 compatibility | v2 preview/rehearsal/paper-only only. |
| `v0.9.0` | V2 handles non-trading real workflows | v1 compatibility, v2 opt-in | Non-trading v2 worker paths with gated wrappers. |
| `v0.9.5` | V2 handles paper trading workflows | v1 compatibility, v2 opt-in for paper | Paper trading pre-execution and paper bridge. |
| `v1.0.0-rc.1` | V2 default cutover candidate | v2 default, v1 shim | Full non-live production orchestration; live still gated. |
| `v1.0.0` | End migration period | v2 default | v1 only compatibility shim/archive. |

## Refactor Workstreams

### Workstream A: Version and Boundary Hygiene

Deliverables:

- Keep package/release version as the only external release version.
- Maintain a module status matrix:
  - Workflow v1 compatibility: on
  - Workflow v2 preview/rehearsal/paper-only: on
  - V2 real workers: gated/off
  - V2 live delivery: gated/off
  - V2 live trading: disabled/off
- Add explicit environment gates for dangerous paths where missing.
- Keep release notes focused on package versions, not separate "v2 releases".

Exit criteria:

- Any operator can identify active/default/gated/off paths from one document.
- `v0.8.2-rc.1` release notes and later notes do not use ambiguous internal
  engineering tag language as external release language.

### Workstream B: Split `src/workflow.js`

Initial split order:

1. `schema`: move schema initialization blocks into stable schema modules.
2. `registry-composition`: move action registry creation into one composer.
3. `aliases`: move canonical alias table into a separate module.
4. `shared helpers`: move generic helper functions out of `workflow.js`.
5. `legacy orchestrator`: isolate v1 run/task/supervise/advance wiring.

Rules:

- Do not change behavior in the split commits.
- Each split must preserve regression coverage and export compatibility.
- Do not move task-specific semantics into infrastructure modules.

Exit criteria:

- `src/workflow.js` becomes a thin composition shell, not a 9k-line logic owner.
- Schema initialization is auditable by domain.

### Workstream C: V1 Action Deprecation Ledger

Create a ledger for each v1/shared action:

| Status | Meaning |
| --- | --- |
| `shared_substrate` | Not v1-only; keep as shared v2/v1 infrastructure. |
| `shim_to_v2` | Keep action name, internally route to v2 equivalent. |
| `legacy_active` | Still active because v2 has no replacement yet. |
| `deprecated` | Stop using for new work; retain for compatibility. |
| `archive_after_v1_0` | Can be archived after v1.0 evidence window. |

First ledger candidates, subject to the migration-worthiness audit:

- `workflow.task.*`: keep history/list compatibility; route new production
  starts to v2 plan/node/template paths.
- `workflow.task.launch.*`: freeze as a short-term compatibility shell because
  v2 already has plan admission, audit, and Human Gate package/request
  equivalents; do not invest in new legacy launch implementation and delete the
  shell by the target removal release.
- `workflow.advance` / `workflow.supervise`: migrate effective progression
  checks into v2 validate/review/audit/readiness flows.
- `workflow.schedule.*`: keep only if it schedules approved v2 plans or shared
  maintenance; do not let it become a second v2 scheduler.
- `workflow.control_loop.tick`: keep as legacy maintenance/reconcile only until
  v2 adapter drain service replaces orchestration usage.
- `runtime.bridge.drain`: keep as shared runtime adapter until real v2 wrappers
  own worker execution.

Exit criteria:

- New work cannot accidentally choose an undocumented v1 path.
- Each retained legacy action has an owner, migration status, and removal rule.

### Workstream D: V2 Default Kernel Cutover

Required before v2 default:

- Real worker wrapper implementation behind execute guard.
- Worker wrapper session binding contract:
  - `workflowId`
  - `planId`
  - `nodeId`
  - `taskId`
  - `workerRunId`
  - `runtimeBackend`
  - workspace/worktree
  - result artifact path
  - submit/fail/release action path
- Adapter drain service deployment with lease, limit, backoff, and action ledger.
- Non-trading real worker rehearsal.
- Paper trading rehearsal with `trading_core` paper bridge.
- Rollback plan to v1 compatibility path.

Exit criteria:

- V2 can complete a real non-trading worker workflow without live side effects.
- Failures return through `worker_result.fail` or adapter job `release/fail`;
  no fake success path exists.

### Workstream E: Read Model and Console Cleanup

Current read model intentionally spans v1, v2, shared delivery, and incident
state. Do not split it before v2 default is stable.

Migration order:

1. Add explicit fields that label each card/readiness item as `v1`, `v2`, or
   `shared_substrate`.
2. Add views for v2 plan/node/worker lifecycle and v2 Human Gate package state.
3. Move legacy-only dead-letter and control-loop views behind compatibility
   labels.
4. After v1.0, archive unused legacy views.

Exit criteria:

- Console users can distinguish legacy compatibility state from v2 kernel state.
- Dead-letter and readiness views do not imply v1 is still the default kernel
  after v2 cutover.

## Migration Sequence

### Phase 0: Documentation and Ledger

- Add this document.
- Add a v1 action deprecation ledger.
- Add a module status matrix.
- Update release notes to point to package version only.

### Phase 1: Non-Behavioral Extraction

- Split `src/workflow.js` without behavior changes.
- Keep all action names and exports compatible.
- Add regression tests for registry count/order where useful.

### Phase 2: Shared Substrate Hardening

- Mark shared substrate actions explicitly.
- Keep Human Gate, message_flow, Telegram outbox, side-effect ledger, runtime
  registry, and trading_core receipt rails as shared infrastructure.
- Add fail-closed feature flags for real delivery/real wrappers/live trading.

### Phase 3: V2 Worker Execution Enablement

- Implement real worker wrappers behind execute guard.
- Deploy adapter drain service as an operator-controlled service.
- Validate non-trading real worker run with full receipt chain.

### Phase 4: Paper Trading Cutover

- Connect v2 reviewed/audited plans to paper-only trading pre-execution.
- Run `trading_core` paper bridge smoke from v2-generated typed intent.
- Keep live trading disabled.

### Phase 5: V2 Default Candidate

- Route new governed workflow starts to v2 by default.
- Keep v1 action names as shims or legacy compatibility.
- Freeze new v1 feature work.

### Phase 6: V1 Archive

- Archive or remove dead v1 code after evidence window.
- Keep compatibility shims for externally referenced actions.
- Retain historical docs and regression fixtures for rollback analysis.

## Removal Rules

Code can be removed only when all are true:

1. The action or table is not shared substrate.
2. No current CLI/MCP/OpenClaw/Gateway path depends on it.
3. A v2 equivalent or documented deprecation path exists.
4. Regression tests cover the replacement behavior.
5. A rollback or archive artifact exists.

Code should be archived rather than deleted when:

- it documents a past incident path;
- it is referenced by ops artifacts or governance logs;
- it handles old persisted state that may still exist on dev-server.

## Immediate Next Engineering Tasks

1. Create `docs/workflow-v1-action-deprecation-ledger.md`.
2. Extract `WORKFLOW_ACTION_ALIASES` from `src/workflow.js`.
3. Extract schema initialization blocks from `src/workflow.js` into domain
   modules.
4. Add read-only module status action or static document consumed by release
   notes.
5. Add feature flags for:
   - v2 real worker wrappers;
   - v2 live Telegram delivery;
   - v2 live trading;
   - v2 default kernel routing.
6. Add a release checklist that refuses `v1.0.0` until the v1 ledger has no
   undocumented `legacy_active` actions.

## Quality Gates for This Migration Program

Every migration slice must state:

- changed action names;
- changed tables;
- changed default routes;
- compatibility impact;
- rollback path;
- local smoke/regression evidence;
- independent review result.

Required checks for behavior-affecting slices:

- focused regression for the moved domain;
- `npm run check`;
- `npm run smoke:release`;
- `git diff --check`;
- independent subagent review.

## Non-Goals

- Do not reimplement OpenClaw Gateway.
- Do not create a second runtime registry.
- Do not replace `trading_core`.
- Do not make `message_flow` task-semantic.
- Do not make v2 live trading default before separate Human Gate and production
  release governance.
- Do not delete v1 code simply because it is old.

## Final Target State

```text
trading-agents-workflow v1.0.0
  package release version is the only external version
  Workflow v2 is the default orchestration kernel
  Workflow v1 action names are compatibility shims or archived legacy
  shared substrate remains explicitly shared
  real workers are controlled by wrapper gates and receipts
  trading side effects remain behind trading_core and Human Gate rails
```
