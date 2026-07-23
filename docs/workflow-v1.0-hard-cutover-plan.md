# Workflow v1.0 Hard Cutover Plan

Status: proposed plan for review  
Created: 2026-07-23  
Target release: `v1.0.0`  
Source baseline: `v0.8.2-rc.1` line after commit `300fa2bad0b6cc86e6035c0847f33b362f6aef5d`

## Purpose

This document defines the most thorough path out of the current v1/v2
coexistence period. The goal is not to keep adding compatibility forever. The
goal is to make v2 the only new orchestration kernel, preserve shared
infrastructure under neutral ownership, and convert v1-only execution surfaces
into disabled compatibility shells or read-only archive exports.

The hard cutover rule is:

- no new workflow execution may enter through v1 mutating action names;
- no shared substrate may be frozen merely because it carries old naming;
- no legacy code block may remain indefinitely without a dated retention reason;
- no removal may happen without replacement evidence, caller audit, regression,
  observation, and rollback path.

## Target End State

| Area | v1.0.0 target | Hard boundary |
| --- | --- | --- |
| New orchestration | `workflow.v2.plan.*`, v2 plan nodes, workers, reviews, Human Gate packages, intervention, evaluation | v1 `workflow_runs` / `workflow_tasks` are not write targets for new work. |
| Shared dispatch and receipt | `dispatch.package.*`, `message_flow.*`, `runtime.agent.*`, runtime adapter drain, receipts | Keep as shared substrate; do not fork into v2-local bus/registry. |
| Human Gate and side effects | `human_gate.*`, `side_effect.*`, `incident.*`, `trade.*`, `workflow.event.*` | Keep as shared governed rails; v2 packages evidence but does not replace final rails. |
| Legacy v1 actions | disabled by default, unknown-action, or read-only archive/export | No public v1 mutating fallback after cutover. |
| Legacy data | labeled `v1 archived/compat` and searchable only as history | No automatic conversion of old tasks/runs into v2 plans. |
| Maintenance | neutral shared maintenance service or explicitly retained shared control-loop lanes | Do not hide generic scheduler/outbox/Human Gate repair inside v2 worker loop. |

## Current Remaining Blockers

The already retired surfaces are not blockers: task launch mutations,
run/initiative external upsert, task create/update external mutation, swarm,
route-shell public entry points, legacy supervisor execution, and legacy
checkpoint writer are already frozen, removed, or diagnostic-only.

The hard cutover still has five blockers:

1. **Lifecycle intervention parity.** v2 has readiness, settlement preview, and
   plan-state transitions, but external closeout receipt policy is not yet
   enforced before `pause/resume/stop/terminate`.
2. **Evaluator parity.** v2 has `evaluation_snapshot.preview` and validation,
   but evaluator persistence and blocker coverage are not yet the canonical
   writer.
3. **Dispatch bridge parity.** `dispatch.package.create` exists, but public
   `meeting.dispatch` remains the compatibility writer underneath.
4. **Maintenance ownership.** scheduler/control-loop/runtime-drain lanes are
   shared substrate, but names and service boundaries still mix old mental
   models with current responsibilities.
5. **Read-history closure.** v2-first read models exist in part, but legacy
   task/list/draft/list-only surfaces still need archive criteria and default
   closure.

## Cutover Strategy

The hard cutover should run as one program with gated workstreams, not as ad
hoc single-action freezes. Each workstream has a replacement build step, a
caller migration step, a freeze step, and an observation step. The workstream
numbers describe scope, not mandatory implementation order; the release gates
below control when any public action may freeze or be removed.

### Workstream 0: Freeze Policy Lock

Deliverables:

- Update `scripts/workflow_batch_freeze_audit.mjs` to track hard-cutover phases
  explicitly: `replacement_missing`, `replacement_built`, `callers_retargeted`,
  `frozen_default`, `removed_or_archived`.
- Add a hard-cutover manifest that lists every remaining legacy public action,
  expected v1.0.0 disposition, escape hatch if any, and removal target.
- Keep shared substrate in a separate protected list so it cannot be swept into
  v1 retirement by name.

Exit criteria:

- `npm run check:freeze` fails if a legacy mutating action is still exposed
  after its phase says `frozen_default`.
- `npm run check:freeze` also fails if `message_flow`, Human Gate, outbox,
  side-effect, incident, runtime registry, trade, session, or event rails are
  marked as v1-only freeze candidates.

Rollback:

- Revert only the audit manifest/policy change; no runtime state migration is
  involved.

### Workstream 1: Lifecycle Intervention Hardening

Current state:

- `workflow.v2.intervention_readiness.preview` detects blockers.
- `workflow.v2.intervention_settlement.preview` enumerates closeout evidence
  requirements without mutation.
- `workflow.v2.pause/resume/stop/terminate` mutate only `workflow_v2_plans` and
  `workflow_events`.

Recommended hard-cutover design:

- Do **not** add broad automatic kill/cancel behavior as the default. For real
  trading-adjacent workflows, uncertain external side effects must be resolved
  by receipts, not hidden by local cancellation.
- Add `workflow.v2.intervention_settlement.record` as the canonical receipt
  binder. It should record that a worker, adapter job, session run, dispatch,
  outbox row, Human Gate, side effect, or incident has reached a terminal,
  superseded, cancelled-with-evidence, or explicitly-human-accepted state.
- Extend `workflow.v2.pause/resume/stop/terminate` so high-impact transitions
  require either zero blocking `settlementItems` or matching settlement records.
- Keep runtime-specific cancellation under runtime adapter/runbook ownership.
  The v2 kernel should require receipts; it should not directly kill arbitrary
  workers or sessions.

Implementation units:

1. Add `workflow_v2_intervention_settlements` table or a shared
   `workflow_events` settlement event contract with stable `settlement_id`,
   `workflow_id`, `plan_id`, `source_kind`, `source_id`, `resolution`,
   `receipt_ref`, `human_gate_id`, `side_effect_id`, `incident_id`,
   `idempotency_key`, `payload_hash`, and timestamps.
2. Add preview/record/replay tests for each source kind:
   worker, adapter job, session, dispatch, outbox, Human Gate package, legacy
   Human Gate record, side effect, incident.
3. Make stop/terminate require checkpoint/rollback boundary plus all critical
   side-effect settlement.
4. Make resume require pending Human Gate and incident settlement, not just plan
   status restoration.
5. Freeze `workflow.pause`, `workflow.resume`, `workflow.stop`, and
   `workflow.terminate` into compatibility blockers after v2 transition tests
   prove they no longer carry unique value. Even if `workflow.terminate`
   remains an alias to stop internally, it must appear explicitly in freeze
   audit manifests, caller audits, and unknown-action/default-block regressions.

Freeze criteria:

- Legacy lifecycle preview and v2 readiness/settlement deltas are explained.
- v2 transition actions reject active external blockers without settlement
  records.
- v2 transition actions pass idempotency, replay, Human Gate, Protocol audit,
  rollback boundary, and no-legacy-write tests.
- Live audit finds no required caller using
  `workflow.pause/resume/stop/terminate`.

Rollback:

- Re-enable the per-action legacy lifecycle compatibility escape hatch for one
  release window only. This escape hatch does not exist for lifecycle actions
  today; it must be implemented explicitly before using this rollback path.
- Do not delete legacy lifecycle source until the observation window passes.

### Workstream 2: Evaluator Canonicalization

Current state:

- `workflow.v2.evaluation_snapshot.preview` is read-only.
- `workflow.v2.evaluation.record` is the canonical durable evaluator writer on
  the shared `workflow_verification_results` rail.
- `workflow.v2.validate` covers v2 structural and consistency checks.
- `workflow.evaluate` remains registered only as a default-disabled
  compatibility writer behind `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_EVALUATOR=1`.

Recommended hard-cutover design:

- Add `workflow.v2.evaluation.record` as the canonical durable evaluator writer,
  or extend `workflow.v2.validate` with an explicit `record` action if the
  schema stays shared.
- Preserve evaluator evidence in `workflow_verification_results` if that table
  remains the shared verification rail; do not invent a second evidence table
  unless there is a concrete schema reason.
- Move blocker checks into shared/v2 helpers:
  dispatch/runtime terminality, side-effect uncertainty, active incidents,
  Human Gate pending/stale, missing artifacts, missing receipts, owner review
  gaps, acceptance criteria, and verification failures.

Implementation units:

1. Keep evaluator blocker helpers shared across v2 snapshot and record paths,
   including dispatch/runtime failure, side-effect uncertainty, incidents,
   Human Gate, and missing evidence/receipt/artifact blockers.
2. Maintain `workflow.v2.evaluation.record` with idempotency, payload hash,
   evaluator decision, evidence refs, receipt refs, findings, recommendations,
   and created-by fields.
3. Retarget action policy/tool schema/console preview actions away from
   `workflow.evaluate`.
4. Keep only actual registered read-only evaluator compatibility surfaces, such
   as v2 compatibility/migration previews, if they are explicitly documented as
   archive diagnostics. Do not invent or document `workflow.evaluate.preview`
   unless that action is deliberately added.
5. Remove `workflow.evaluate` after the observation window shows v2 evaluation
   records are the only active evaluator writes.

Freeze criteria:

- For fixture families, legacy evaluate and v2 evaluation produce explainable
  decisions for met, not-met, blocked, needs-evidence, side-effect-uncertain,
  active-incident, failed-dispatch, and pending-Human-Gate states.
- Durable v2 evaluation evidence is queryable from the same operator read
  surfaces that previously displayed evaluator rows.
- `workflow.evaluate` no longer appears in tool schema, console primary
  actions, cron, or workflow next-actions output.

Rollback:

- Leave legacy evaluator source present for one release window behind a gated
  per-action evaluator compatibility escape hatch. This escape hatch does not
  exist today and must be implemented explicitly before relying on it.
- Keep shared verification rows backward-compatible.

### Workstream 3: Dispatch Bridge Cutover

Current state:

- `dispatch.package.preview/create` exists.
- `dispatch.package.create` still returns `compatibilityOperation=meeting.dispatch`
  because it delegates to the legacy-named writer.
- `meeting.dispatch`, `meeting.ingest`, `meeting.resume`,
  `meeting.disperse`, and `meeting.runtime_participant` remain active/shared
  adapter surfaces.

Recommended hard-cutover design:

- Make `dispatch.package.create` the canonical writer for
  `mixed_meeting_dispatches` or its neutral successor table while preserving
  row compatibility.
- Rename ownership in code and docs from meeting-era dispatch to shared dispatch
  package. The table may remain if migration risk is high; the public action
  should not.
- Turn `meeting.dispatch` into a default-blocked compatibility shell that
  returns a migration message and requires an explicit legacy compatibility env
  override.
- Keep `meeting.ingest` only if it is still the actual shared receipt ingest
  path; if so, rename or wrap it as `dispatch.receipt.ingest` /
  `runtime.receipt.ingest` before freezing the meeting-era name.

Implementation units:

1. Inventory every producer/consumer of `mixed_meeting_dispatches`,
   `runtime_runs`, `message_flows`, and dispatch package artifacts.
2. Split writer internals from public action names: neutral internal writer,
   canonical public `dispatch.package.create`, deprecated public
   `meeting.dispatch`.
3. Retarget scheduler, Human Gate delivery, supervisor next-actions, runtime
   recovery, and v2 package paths to `dispatch.package.create`.
4. Add no-route-shell, invalid runtime, idempotency replay, message-flow link,
   runtime receipt, retry, dead-letter, and local Codex inbox regressions.
5. Freeze meeting-era public names only after caller audit and server
   observation.

Freeze criteria:

- New dispatch rows can be created without invoking a public `meeting.dispatch`
  action name.
- No unaudited caller remains for `meeting.dispatch`.
- Runtime drain and stale dispatch reconcile still process the same evidence.
- Message-flow integrity metrics stay stable after the cutover.

Rollback:

- Keep neutral writer row shape compatible with existing `mixed_meeting_dispatches`.
- Retain compatibility shell for one release window with explicit operator
  override. The override must be a named meeting-dispatch compatibility gate,
  not the existing legacy advance/supervise gate.

### Workstream 4: Maintenance Ownership Split

Current state:

- `workflow.control_loop.tick` owns shared mechanical lanes:
  schedule seeding, runtime drain, stale dispatch reconcile, message-flow
  reconcile, Human Gate maintenance, outbox delivery, retry, dead-letter, and
  repair.
- `workflow.v2.control_loop.tick` should remain v2 worker lifecycle adjacent,
  not a generic maintenance sink.

Recommended hard-cutover design:

- Preserve shared maintenance behavior, but move ownership to neutral naming:
  `workflow.maintenance.tick` / `maintenance.tick` and
  `workflow.maintenance.job.requeue`, or an equivalent explicit module.
- Keep `workflow.control_loop.tick` as compatibility alias only after neutral
  maintenance entry points are present.
- Retire only legacy `workflow_supervise` lane code after observation; do not
  remove schedule/runtime/message-flow/Human Gate/outbox lanes.

Implementation units:

1. Add neutral maintenance preview/tick aliases or modules.
2. Keep lane ownership explicit in metadata: `scheduler`, `runtime_drain`,
   `dispatch_reconcile`, `message_flow`, `human_gate`, `outbox`, `repair`,
   `legacy_archive`.
3. Prove approved-template and approved-Human-Gate schedules still dispatch;
   raw schedules remain fail-closed.
4. Prove runtime drain, stale dispatch, message-flow reconcile, Human Gate
   inbox/request ensure, outbox delivery, retry, and dead-letter lanes still
   make bounded progress.
5. Freeze legacy control-loop aliases only after the neutral entry points are
   active and the old action names are absent from tool schema/cron callers.

Freeze criteria:

- No active cron/session/tool schema points at the old control-loop public name
  except explicitly allowed compatibility wrappers.
- `workflow_supervise` lane remains disabled and unused for one observation
  window.
- All shared lanes pass service-level smoke with receipts/evidence.

Rollback:

- Because lanes are shared infrastructure, do not delete source in the first
  cutover release. Only retarget public names and preserve row compatibility.

### Workstream 5: Read-History and Authoring-Preview Closure

Current state:

- v2-first console/search/list views exist in part.
- `workflow.task.list`, `workflow.tasks`, and `workflow.task.launch.list` still
  provide compatibility/history reads.
- `workflow.task.draft` is a compatibility authoring preview, not a history
  read. It belongs in this workstream because it is an active-sounding v1
  authoring name that should be replaced by v2 plan preview/template
  instantiate before v1.0.0.

Recommended hard-cutover design:

- Add explicit archive/read actions:
  `workflow.archive.task_history.list`,
  `workflow.archive.run_history.list`, and
  `workflow.archive.launch_package.list`, or equivalent neutral archive names.
- Move active operator lists to v2 plan/node/worker/package read models.
- Freeze `workflow.task.draft` as an authoring path once v2 plan preview,
  template instantiate, and UI/MCP schemas expose the replacement.
- Keep archive reads only under names that cannot be mistaken for active v1
  execution.

Implementation units:

1. Inventory all CLI/tool schema/console callers of task list/draft/list-only
   actions.
2. Add archive aliases with `sourceClass=v1 archived/compat` for list/history
   actions.
3. Retarget UI/MCP primary reads to v2 plan/package read surfaces.
4. Retarget authoring callers from `workflow.task.draft` to
   `workflow.v2.plan.preview`, template instantiate, or another audited v2
   authoring preview.
5. Add unknown-action/default-blocked regressions for old active names after
   archive aliases and v2 authoring replacements exist.
6. Keep historical rows searchable but visually and programmatically labeled as
   archived.

Freeze criteria:

- Operators can find v1 history without invoking active-sounding v1 task names.
- New authoring never uses `workflow.task.draft`.
- Console/MCP/tool schemas expose v2 plan preview/create and archive reads,
  not active v1 task names.

Rollback:

- Archive read actions are non-mutating, so rollback is limited to restoring
  compatibility names if an operator cannot find historical evidence.

### Workstream 6: Final Compatibility Removal Window

After Phases 1-5 pass, run a release-window observation before source deletion.

Observation evidence:

- no completed `workflow_operations` rows for legacy mutating action names;
- no tool schema/default action exposure for legacy mutating names;
- no cron/session/control-loop caller using legacy names;
- no server smoke or postcheck regression;
- no live workflow needing legacy archive source as an active recovery path.

Final removal actions:

- delete or default-block external action handlers for frozen v1 mutating names;
- keep private helpers only where documented as archive/read compatibility;
- remove old CLI commands and console primary actions;
- update `WORKFLOW_ACTION_MIGRATION_EXACT`, permission policy, freeze audit,
  release notes, and docs;
- add unknown-action regressions for removed public names.

## Surface Disposition Table

| Surface family | Hard-cutover disposition | Earliest phase |
| --- | --- | --- |
| `workflow.pause/resume/stop/terminate` | Freeze public v1 lifecycle names after v2 settlement records gate transitions. Include `workflow.terminate` explicitly in audits/tests even if it remains alias-only internally. | Workstream 1 |
| `workflow.evaluate` | Freeze writer after v2 durable evaluation record owns persistence and blocker checks. | Workstream 2 |
| `meeting.dispatch` | Freeze public meeting-era writer after `dispatch.package.create` is canonical writer. | Workstream 3 |
| `meeting.ingest/resume/disperse/runtime_participant` | Retarget or archive by exact role; do not bulk-delete until receipt/adapter role is neutralized. | Workstream 3 |
| `workflow.control_loop.*` | Retarget public names to neutral maintenance ownership; freeze only old aliases/legacy lane. | Workstream 4 |
| `workflow.schedule.*` | Keep governed scheduler substrate; only freeze raw/legacy unsafe aliases. | Workstream 4 |
| `runtime.bridge.drain` | Keep as shared substrate or rename through neutral runtime drain; do not delete in v1 cutover. | Workstream 4 |
| `workflow.task.list/tasks/task.launch.list` | Move to archive/read-history naming; freeze active-sounding list names. | Workstream 5 |
| `workflow.task.draft` | Retire as authoring preview after v2 plan/template authoring callers are retargeted. | Workstream 5 |
| `message_flow.*`, `human_gate.*`, `side_effect.*`, `incident.*`, `runtime.agent.*`, `trade.*`, `workflow.event.*`, `workflow.session_*` | Protect as shared substrate. | Always |
| `research.*`, `instrument.*`, `radar.*`, `thesis.*`, `gate.review` | Exclude from kernel cutover; handle in future domain-template audit. | Later |

## Global Regression Matrix

Each phase must add targeted tests before freezing:

- **Lifecycle:** active worker, leased adapter, running session, sent dispatch,
  queued outbox, pending Human Gate, draft package, side-effect uncertainty,
  active incident, missing checkpoint, idempotency replay.
- **Evaluator:** met, not-met, needs-evidence, blocked, failed dispatch,
  failed runtime, side-effect uncertainty, active incident, pending Human Gate,
  missing receipt, missing artifact, durable record replay.
- **Dispatch:** target resolution, invalid runtime fail-closed, route-shell
  fail-closed, idempotency, message-flow link, runtime receipt, local Codex
  receipt semantics, retry/dead-letter, scheduler/Human Gate producers.
- **Maintenance:** lane inventory, approved schedule seeding, raw schedule
  fail-closed, runtime drain progress, stale dispatch reconcile, message-flow
  reconcile, Human Gate inbox/request ensure, outbox delivery, job requeue.
- **Read history:** v2-first list/search/detail, archive labels, no active v1
  authoring, unknown-action or blocked behavior for retired names.

Mandatory commands for behavior changes:

- `npm run check:freeze`
- targeted regression for changed phase
- `npm run check`
- `npm run smoke:release`
- `git diff --check`
- high-confidence sensitive diff scan
- independent subagent review
- dev-server fast-forward deploy
- server `npm run smoke:release`
- `openclaw plugins registry --refresh`
- workflow status against runtime state root
- `main.workspace` invariant check

## Release Gates

### Gate A: Replacement Built

The replacement action/module exists, has regression coverage, and produces
auditable evidence. No legacy public name is frozen at this gate.

### Gate B: Caller Migration

Tool schema, console, scheduler, Human Gate, next-actions, cron/session, and
runtime helper callers use the replacement. Legacy action names may still exist
as blocked compatibility shells.

### Gate C: Default Freeze

Legacy public mutating names are default-blocked or unknown-action. Any escape
hatch requires an explicit per-family environment variable or policy gate and
must be documented with expiry. The current legacy advance/supervise gate is
not sufficient for lifecycle, evaluator, dispatch, or read-history rollback.

### Gate D: Observation Window

One release window runs with default freeze. Governance logs and
`workflow_operations` show no necessary legacy caller.

### Gate E: Source Removal or Archive

Only after Gate D may source be deleted or moved to archive/export modules.
Shared substrate source is excluded unless replaced by a separate architecture
plan.

## Risk Register

| Risk | Failure mode | Mitigation |
| --- | --- | --- |
| Freezing shared substrate as v1 | v2 loses dispatch, Human Gate, receipt, or maintenance capability. | Protected shared-substrate audit list and failing `check:freeze`. |
| Lifecycle stop hides side effects | Plan shows stopped while external delivery/trade side effect remains uncertain. | Settlement records and side-effect critical blockers before stop/terminate. |
| Evaluator evidence loss | Operators cannot explain why a workflow is blocked/met/not-met. | Preserve shared verification rows or equivalent durable v2 evaluation records. |
| Dispatch bridge split-brain | New dispatch writer bypasses message_flow/runtime_agents/idempotency. | Canonical writer must reuse shared dispatch evidence and pass parity tests. |
| Maintenance rename breaks cron | Scheduler/outbox/Human Gate repair stops after public name change. | Retarget callers first, preserve compatibility alias during observation. |
| Archive names hide history | Operators cannot find old v1 evidence. | Add explicit archive read models before disabling old list names. |
| Compatibility never ends | Legacy shells remain forever. | Every shell gets release-line expiry, usage audit, and removal target. |

## Recommended Immediate Next Work

The most decisive next implementation work is **Workstream 2 Evaluator
Canonicalization**, not more intervention UI. This does not mean Workstream 1
may be skipped for release gating; it only reflects execution priority. Evaluator
canonicalization is bounded, high-value, and directly removes one current
`legacy_active` blocker with lower runtime side-effect risk.

Recommended next implementation batch:

1. Add `workflow.v2.evaluation.record` as durable v2/shared evaluator evidence.
2. Extract remaining legacy evaluator blockers into shared helpers.
3. Retarget policy/tool schema/console primary actions to v2 evaluation.
4. Add targeted evaluator parity regressions.
5. Freeze `workflow.evaluate` writer behind a default-blocked compatibility
   shell after observation evidence is available.

The second batch should be **Workstream 1 settlement record gating**. It is
higher risk than evaluator because it touches high-impact pause/stop semantics,
so it should follow the evaluator batch in implementation scheduling unless an
urgent lifecycle incident forces it forward. Release cutover still requires
both Workstream 1 and Workstream 2 gates before lifecycle/evaluator v1 names
freeze.

## Decisions Required Before Coding

1. Should v2 intervention settlement remain receipt-only, or should any runtime
   adapter be allowed to perform automatic cancellation? Recommendation:
   receipt-only by default; runtime cancellation only through explicit runbook
   and Human Gate.
2. What is the observation window for default-frozen legacy public actions?
   Recommendation: at least one release window plus server smoke/postcheck and
   governance-log audit.
3. Should neutral maintenance public names be `workflow.maintenance.*` or
   `maintenance.*`? Recommendation: `workflow.maintenance.*` first, because it
   stays inside the plugin namespace while removing control-loop ambiguity.
4. Should archive read names live under `workflow.archive.*` or
   `workflow.history.*`? Recommendation: `workflow.archive.*`, because it makes
   non-execution semantics explicit.

## Success Definition

The cutover is complete when:

- all new multi-agent orchestration enters through v2 or shared canonical
  substrates;
- v1 public mutating action names are unavailable by default;
- shared infrastructure has neutral ownership and is not described as v1;
- v1 historical data remains readable as archive evidence;
- `npm run check:freeze` enforces the state automatically;
- release smoke and dev-server postcheck pass after the freeze;
- rollback is a compatibility shell/flag, not source archaeology.
