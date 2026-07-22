# Workflow v1/v2 Migration Worthiness Audit

Status: active migration gate  
Created: 2026-07-15  
Related:
- `docs/workflow-v1-v2-refactor-migration-plan.md`
- `docs/workflow-v1-action-deprecation-ledger.md`
- `docs/workflow-module-status-matrix.md`
- `docs/workflow-v2-feature-flags.md`
- `docs/workflow-freeze-pool-p7.md`
- `docs/workflow-p9-run-upsert-retirement-audit.md`

## Purpose

This audit decides whether each legacy or shared workflow code block is worth
migrating before any implementation work starts. It exists to prevent
low-value migration work such as investing in a legacy block that already has a
v2 replacement.

This audit is not a mandate to migrate or delete every v1-named block. A block
only becomes a freeze/retirement candidate when v2/shared code already owns the
same useful behavior, or when the block is proven to have no v2/runtime/live
dependency and no remaining read/history/audit retention value.

## Decision Classes

| Class | Meaning | Allowed work |
| --- | --- | --- |
| `must_migrate` | Current production or governance capability is still valid, and v2 does not yet provide equivalent coverage. | Implement equivalent v2/shared capability with tests before disabling legacy path. |
| `compat_shell_only` | V2 or shared substrate already covers the useful capability; old entry points may remain only as short-term, explicitly gated compatibility escape hatches. | Freeze implementation, add warnings/telemetry, hide from default UI, set a removal target, and delete after the compatibility window. |
| `optional_or_template_later` | Capability is useful but outside the v2 kernel cutover, or depends on future domain templates. | Keep isolated; migrate only when a concrete audited template requires it. |
| `shared_substrate` | Infrastructure used by both v1 and v2. | Do not migrate as v1 code; protect APIs and evidence semantics. |
| `archive_no_migration` | Legacy mechanism is superseded or unsafe as an active path. | Retain tests/fixtures briefly, then archive/remove after compatibility evidence. |

## Hard Rule

No code block should enter an implementation migration plan unless this audit
classifies it as `must_migrate` or gives a concrete `compat_shell_only`
translation target. No code block should enter a freeze/removal batch unless it
has a proven v2/shared replacement or proven no-dependency/no-retention status.
A module being old, large, or marked legacy is not by itself a reason to
migrate, freeze, or delete it.

## Evidence Inventory

The current action-surface scan found:

- 37 non-v2 action modules under `src/*-actions.js`.
- 1 v2 action registry with 68 canonical v2/template actions in
  `src/workflow-v2/index.js`.
- Legacy mutating actions are already fail-closed by default through
  `WORKFLOW_LEGACY_MUTATING_ACTIONS`.
- Generic v2 orchestration writes are fail-closed unless attached to approved
  plan/template/Human Gate context or an explicit diagnostics override.
- P8 removed the legacy task-launch mutating MCP wrappers and their discovery
  escape hatch; only `workflow_task_launch_list` remains as historical
  read-only access.

## Migration Value Matrix

| Code block / action family | Current role | V2/shared equivalent | Class | Action |
| --- | --- | --- | --- | --- |
| `workflow.init`, `workflow.status`, `workflow.health`, `workflow.readiness`, `workflow.topology`, `workflow.runtime_agents` | Schema initialization, readiness, topology, and global runtime registry visibility. | Shared read/init surface for v1/v2/runtime state. | `shared_substrate` | Protect; do not migrate into v2-only code. |
| `workflow.permission.*` | Policy explanation and permission checks. | Shared policy surface for v1, v2, console, MCP, and runtime adapters. | `shared_substrate` | Protect; evolve policy centrally, not inside v2-only code. |
| `runtime.agent.*` | Global member/runtime registry. | Shared `runtime_agents` registry remains required by v2 and all runtime adapters. | `shared_substrate` | Protect; no v2-local registry. |
| `message_flow.*` | Governed delivery, local Codex inbox, receipt/evidence trail. | V2 uses it as notification/evidence pointer layer. | `shared_substrate` | Protect; never add task-specific semantics. |
| `telegram.outbox.*` | Shared outbound delivery queue and requeue evidence. | V2 Human Gate request can enqueue shared outbox rows. | `shared_substrate` | Protect; no v2-owned IM system. |
| `human_gate.*` | Final Flashcat decision rail, buttons, resume, inbox. | V2 packages evidence, but final Human Gate remains shared. | `shared_substrate` | Protect; keep legacy `meetingId` compatibility only as exception. |
| `protocol.*` | Shared protocol object persistence. | V2 uses protocol/Human Gate/trade evidence indirectly. | `shared_substrate` | Protect. |
| `trade.proposal`, `risk.decision`, `trade.intent`, `trading_core.receipt` | Deterministic trading boundary and receipt rail. | V2 may prepare evidence, not replace `trading_core`/risk gates. | `shared_substrate` | Protect; never fold into v2 orchestration. |
| `side_effect.*` | Shared side-effect ledger and uncertainty handling. | Required by both v1/v2/trading paths. | `shared_substrate` | Protect. |
| `incident.*`, `workflow.incident.*` | Incident state, dead-letter closeout, evidence packaging. | V2 can feed evidence but should not fork incident state. | `shared_substrate` | Protect; only improve adapters/read-model links. |
| `workflow.event.*`, `workflow.runtime_event.*` | Audit events and runtime semantic events. | Shared evidence rail. | `shared_substrate` | Protect; later label events by source generation. |
| `workflow.session_pack.*`, `workflow.session_run.*` | Session input/run substrate for worker execution and retries. | V2 worker spawn already depends on this substrate. | `shared_substrate` | Protect; no duplicate v2 session store. |
| `workflow.checkpoint` | Legacy checkpoint artifact path and recovery evidence. | Partial v2 recovery exists through plan/node/session/receipt state, but parity is not fully proven. | `must_migrate` | Define v2 checkpoint/readiness parity before retiring legacy checkpoint. |
| `workflow.run.*` | Legacy workflow run row and historical read-model anchor. | `workflow.v2.plan.create` records canonical plan and nodes. V2 plan creation does not call `workflowRunUpsert`. | `removed_external_surface` | P9 removed external run upsert actions, alias, CLI, permission rules, and public registry dispatch. Keep read/history compatibility and the private `workflowRunUpsert` helper only while v1 task compatibility still needs parent run rows. |
| `workflow.task.draft` / preview aliases | Legacy authoring helper that can emit `planSpecV2`. | `workflow.v2.plan.preview/create` and template instantiate are the preferred authoring path. | `compat_shell_only` | Freeze; preserve only as draft/import helper until MCP/UI point at v2 plan preview. |
| `workflow.task.create`, `workflow.task.update`, `workflow.task.list` | Legacy task row creation/update/list. | V2 plan nodes, worker runs, owner/manager reviews. | `removed_external_surface` for create/update; `legacy_active` for list/history | P10 removed external create/update actions and CLI/plugin mutation surfaces. Keep list/history; do not migrate old task rows into the new plan format automatically. |
| `workflow.task.launch.prepare/review/approve` | Legacy launch package, Cat Brain review, Flashcat approval, and v1 run/task/phase materialization. | V2 plan admission, audits, task-group package, Human Gate package/request. | `removed` | Removed in P8; `workflow.task.launch.list` remains as historical read access only. |
| `workflow.advance`, `workflow.supervise` | Legacy mechanical progression and supervisor diagnostics. | V2 validate/review/audit/readiness plus shared incident/readiness evidence. | `must_migrate` for valid checks; `compat_shell_only` for old entry points | P11 audit: `docs/workflow-p11-advance-supervise-migration-audit.md`. Extract next-decision, dispatch/receipt sync, checkpoint, runtime-drain, and Cat Claw closeout behavior into v2/shared validators before freezing. |
| `workflow.swarm.*` | Older generic fanout planning. | V2 manager/worker/task-group/adapter model. | `removed` | Removed in P8; no compatibility entry point remains. |
| `workflow.schedule.*` | Schedule persistence and raw schedule dispatch control. | Future approved template / approved v2 plan scheduler. | `must_migrate` for production scheduling; `compat_shell_only` for raw diagnostics | Build template/plan-bound scheduler before any production v2 cutover. Keep raw schedule behind diagnostics gate. |
| `workflow.control_loop.tick`, `workflow.control_loop.job.*` | Legacy/shared mechanical maintenance, retry, dead-letter, runtime drain assistance. | V2 control-loop and adapter runner exist but service ownership is not fully cut over. | `must_migrate` for orchestration usage; `shared_substrate` for maintenance | Separate shared maintenance from v1 orchestration. Do not delete until v2 service/runner evidence exists. |
| `workflow.dispatch.reconcile`, `dispatch.reconcile`, `stale_dispatch.reconcile` | Shared stale dispatch reconciliation and receipt repair. | V2 adapter/job receipts should feed the same reconciliation evidence. | `shared_substrate` with v2 evidence adapters | Preserve reconciliation semantics; add v2 sources instead of creating a second reconciler. |
| `runtime.bridge.drain` | Shared runtime bridge drain for queued work and Hermers/OpenClaw adapter paths. | V2 adapter job/runner contract. | `must_migrate` for worker execution; `shared_substrate` for existing runtime bridge | Replace active worker execution with v2 adapter runner only after live wrapper evidence. Preserve bridge evidence semantics. |
| `meeting.create`, `meeting.append`, `meeting.command`, `meeting.summary`, `meeting.close`, `meeting.handoff`, `meeting.artifact`, `meeting.state`, `meeting.action_item`, `meeting.decision`, `meeting.minutes`, `meeting.notify`, `meeting.index`, `cat_claw.observe/minutes/digest/notify` | V1 meeting-room discussion, secretary minutes, action items, decisions, notifications, and meeting-file writes. | V2 already covers the same class through plan nodes, information stack, manager/owner review, task-group package, Cat Brain audit, Cat Claw audit, notification preview, and shared Human Gate/outbox. | `frozen_compatibility` | Retire by default; keep only archive compatibility behind `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1`. Do not add v2 features just to mimic v1 meetings. |
| `meeting.dispatch` | Shared dispatch substrate that resolves registry targets, writes `mixed_meeting_dispatches`, and creates message-flow evidence. | V2 and legacy orchestration should continue feeding the shared dispatch/receipt evidence rail. | `shared_substrate` with v2 evidence adapters | Preserve dispatch semantics; do not treat as optional meeting-only code. Add v2-specific sources rather than a second dispatcher. |
| `meeting.ingest` | Shared message/receipt ingestion, transcript evidence, and secretary report outbox fallback. | Message flow/runtime adapters and v2 receipt paths should feed the same evidence rails. | `shared_substrate` with v2 evidence adapters | Preserve ingestion/report evidence semantics; split any meeting-live UI behavior separately. |
| `meeting.resume`, `meeting.disperse`, `meeting.runtime_participant` | Meeting-specific controls and participant bookkeeping. | Future meeting template/runtime-adapter requirements may replace or narrow these. | `optional_or_template_later` | Do not migrate blindly. Keep until meeting template/runtime-adapter requirements are explicit. |
| `route_shell.*` | Historical route-shell ingress/routing. | Runtime registry + message_flow/runtime adapters. | `archive_no_migration` | Do not migrate. Keep only historical ingestion/evidence compatibility if still required. |
| `workflow.verification.record`, `workflow.verification.list` and aliases | Verifier/refuter/evaluator evidence records. | V2 owner/manager review and validate cover orchestration correctness; domain verification may remain separate. | `optional_or_template_later` / shared evidence | Keep as shared/domain evidence until concrete v2 review templates absorb it. |
| `workflow.evaluate` and aliases | Active orchestration-level evaluator over tasks, dispatches, runtime runs, Human Gates, side effects, incidents, artifacts, and verification results. | V2 validate/readiness should absorb the still-valid evaluator checks. | `must_migrate` for valid checks; `compat_shell_only` for old action names | Extract active readiness/evidence checks into v2/shared validators before retiring the old evaluator action. |
| `research.*`, `instrument.*`, `radar.*`, `thesis.*`, `gate.review` | Research/domain records outside core orchestration. | Future research templates, not core v2 kernel. | `optional_or_template_later` | Do not include in v2 kernel migration. Migrate only under research workflow template plan. |
| `cat_claw.audit` | Cat Claw audit evidence. | V2 Cat Claw audit package actions supplement it. | `shared_substrate` | Keep shared audit rail; add v2-specific audit rows where needed. |
| `intervention.*` pause/resume/stop/rerun previews and actions | Operational control surface. | Shared policy/Human Gate/incident rails plus v2 readiness. | `must_migrate` for v2 plan state transitions | Keep hard gates; map v2 pause/resume/stop semantics before v2 default kernel. |
| `telegram.live.*` | Telegram live configuration/control. | Not a v2 kernel function. | `optional_or_template_later` | Keep outside v2 migration; protect with policy gates. |

## Corrected Assessment: `workflow.task.launch.*`

`workflow.task.launch.*` is not a good migration-development sample.

Historical evidence:

- It was classified as legacy mutating and disabled by default before P8
  removal. Request-level legacy override fields were not accepted as an external
  bypass.
- Before removal, it wrote old `workflow_runs`, `workflow_tasks`, and
  `workflow_phases` after Flashcat approval.
- V2 already has equivalent authoring/governance pieces:
  `workflow.v2.plan.preview/create`, owner/manager reviews,
  `workflow.v2.task_group_package.*`, Cat Brain/Cat Claw audits,
  `workflow.v2.human_gate_package.*`, and `workflow.v2.human_gate_request`.

Therefore the completed treatment is:

1. Remove `prepare/review/approve` from external action, CLI, and MCP paths.
2. Keep `list` and historical reads.
3. Preserve the historical rationale as archive evidence, not as current
   operator guidance.

## Actual Must-Migrate Work

These are the first migration targets with real migration value:

1. **V2 default admission gate.** New governed workflow starts must enter
   `workflow.v2.plan.preview/create` or approved template instantiate, not
   legacy run/task/launch.
2. **Legacy action visibility and telemetry.** Runtime must record when
   `legacy_active` or `deprecated` entries are used, so removal is evidence-led.
3. **V2 intervention semantics.** Pause/resume/stop/rerun must work on v2 plans,
   nodes, workers, adapter jobs, Human Gate waits, and side-effect uncertainty.
4. **Production scheduler migration.** Production schedules must bind to
   approved templates or Human-Gate-approved v2 plans; raw schedule dispatch
   remains diagnostics-only.
5. **Control-loop/runner split.** Separate shared maintenance from legacy
   orchestration and prove the v2 adapter runner service can own worker
   execution before deleting old bridge dependence.
6. **Checkpoint/readiness parity.** V2 must prove recovery/readiness evidence
   equivalent to legacy checkpoint/supervisor views before those views retire.
7. **MCP/console route cleanup.** Default user-facing entry points must present
   v2 plan/template/Human Gate flows and demote legacy launch/task surfaces to
   diagnostics/history.

## Legacy Usage Telemetry

P5 runtime telemetry records usage of audited mutating migration surfaces before
removal or deeper migration work:

- The classification source is `workflowActionMigrationInfo` in
  `src/workflow/action-policy.js`.
- `runWorkflowAction` records `workflow.action_migration_telemetry` events for
  mutating audited actions before convergence gates return, so blocked legacy
  attempts are observable.
- Telemetry is evidence-only. It must not enable legacy actions, bypass
  permission checks, make read/preview actions mutating, or make v2 generic
  orchestration writes actionable.
- Event payloads include canonical action, requested action, decision class,
  migration status, replacement, recommendation, and `telemetryOnly=true`.
- Coverage is in `workflow convergence default gates`.

## Default Entry Freeze And Retirement

P8 removes the legacy mutating launch tools from external action, CLI, and MCP
surfaces; only historical list/read access remains:

- Local MCP `tools/list` does not expose `workflow_task_launch_prepare`,
  `workflow_task_launch_review`, or `workflow_task_launch_approve`.
- `workflow_task_launch_list` remains listed as a read/history surface.
- The removed mutating tools do not have a discovery or execution escape hatch.
- Target removal release is `v1.0.0`; the compatibility shell should be deleted
  instead of carried indefinitely into later release trains.

## P7 Freeze Pool

The current batch-level freeze ledger is
`docs/workflow-freeze-pool-p7.md`. It includes the P6 legacy task-launch frozen
surface plus P7 legacy run/task/swarm candidates, and it explicitly lists
surfaces that remain excluded because replacement or dependency evidence is not
strong enough.

## Work That Should Not Be Migrated Now

- `workflow.swarm.*`: superseded by v2 manager/worker/task-group mechanics.
- `route_shell.*`: historical/compatibility only for migrated Hermers agents.
- Research/domain record actions: wait for concrete research workflow templates.
- Meeting-specific actions: wait for explicit meeting template/runtime-adapter
  requirements.
- Trading deterministic boundaries: remain shared and outside v2 orchestration.

## Implementation Gate Checklist

Before any migration PR or patch, answer:

1. Is this code block `must_migrate` or only `compat_shell_only`?
2. What current caller still depends on it: MCP, CLI, console, tests, runtime,
   cron, or live state?
3. What table/artifact/event does it write?
4. What exact v2/shared action replaces that write?
5. Does replacement preserve receipt, Human Gate, side-effect, and rollback
   evidence?
6. Is a legacy warning/telemetry period needed before deletion?
7. Which regression test proves old callers do not break?

If those answers are missing, the task is analysis, not implementation.

## Freeze Batch Evidence Gate

A legacy code block may be frozen only when it is first classified as one of the
following:

1. **Overlapped capability:** a named v2 or shared replacement owns the same
   useful behavior and preserves the required evidence contract.
2. **No-dependency retiree:** no v2/runtime/live-state path, active caller, or
   read/history/audit requirement still depends on the block.

Shared substrate, active legacy behavior without replacement, and read-only
archive evidence are not freeze candidates merely because their names predate
v2. For an eligible candidate, the freeze batch must record all of the following
evidence:

1. **Replacement evidence.** Name the exact v2 or shared substrate action that
   owns the same useful production capability.
2. **Non-dependency evidence.** Show that v2 does not call the legacy entry
   point or require its implementation for normal plan, worker, Human Gate,
   receipt, or readiness flow.
3. **Caller inventory.** List direct external entry points, aliases, MCP/CLI/UI
   tools, internal helpers, tests, cron/session/runtime callers, and live-state
   readers that still touch the block.
4. **Write-surface inventory.** List tables, artifacts, events, outbox rows,
   dispatches, receipts, and side-effect records the legacy path writes.
5. **Freeze mechanism.** State whether the freeze closes discovery, direct
   mutation, scheduler use, runtime adapter use, or all of them.
6. **Escape hatch.** If compatibility is still needed, name the explicit
   env/flag, prove it is off by default, and record the target removal release.
7. **Full regression evidence.** Run the targeted default-deny regression plus
   the broad workflow test suite/smoke for the batch, not just a unit check.
8. **Independent review.** A reviewer must check whether the batch froze a still
   useful code block, missed a v2 dependency, or left an undocumented caller.

If full regression or independent review finds a still-useful frozen path, the
batch must be reverted or narrowed before continuing.
