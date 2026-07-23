# Workflow v1 Action Deprecation Ledger

Status: draft migration ledger  
Created: 2026-07-15  
Last reconciled: 2026-07-23
Related: `docs/workflow-v1-v2-refactor-migration-plan.md`

## Purpose

This ledger classifies legacy and shared workflow actions before the v2 default-kernel migration. It prevents accidental use of undocumented v1 paths and keeps shared substrate from being misclassified as legacy code.

## Status Values

| Status | Meaning |
| --- | --- |
| `shared_substrate` | Shared by v1 and v2; do not remove as v1-only. |
| `shim_to_v2` | Keep the action name, but route internally to v2 or shared substrate. |
| `legacy_active` | Still active because v2 does not fully replace it yet. |
| `shared_scheduler_keep` | Governed schedule surface used by approved v2/template plans and shared maintenance; do not freeze as v1. |
| `shared_maintenance_keep` | Generic bounded maintenance executor; only individual legacy lanes may be retired. |
| `shared_repair_keep` | Governed repair surface for failed/dead-letter/leased maintenance jobs. |
| `shared_runtime_keep` | Shared runtime bridge/evidence surface; not v1-only. |
| `source_deleted` | Public entrypoints and archived implementation are removed; keep only historical vocabulary and retired-input rejection behavior. |
| `compat_shell_only` | Useful capability is already covered elsewhere; freeze, hide by default, allow only explicit short-term escape hatch usage, then remove. |
| `deprecated` | Do not use for new work; retain for compatibility. |
| `archive_after_v1_0` | Archive/remove after v1.0 evidence and rollback window. |

## Ledger

| Action family | Current status | Migration target | Notes |
| --- | --- | --- | --- |
| `workflow.status`, `workflow.health`, `workflow.readiness`, `workflow.topology`, `workflow.runtime_agents` | `shared_substrate` | Keep shared read surface | Readiness/topology summarize both v1, v2, and shared runtime state. |
| `runtime.agent.*` | `shared_substrate` | Keep shared registry | `runtime_agents` is the global member/runtime registry and must not become v2-local. |
| `message_flow.*` / `workflow.message_flow.*` | `shared_substrate` | Keep shared notification/evidence layer | Do not move task semantics into message flow. |
| `telegram.outbox.*` | `shared_substrate` | Keep shared delivery substrate | V2 Human Gate packages may create outbox rows through shared gates. |
| `human_gate.*` | `shared_substrate` | Keep shared final decision rail | `human_gate.record` with legacy `meetingId` remains a compatibility exception. |
| `protocol.*` | `shared_substrate` | Keep shared protocol object rail | Used by Human Gate, trade, incident, and evidence records. |
| `trade.proposal`, `risk.decision`, `trade.intent`, `trading_core.receipt` | `shared_substrate` | Keep deterministic trading boundary | V2 prepares evidence/intent; it must not replace `trading_core` boundaries. |
| `side_effect.*` | `shared_substrate` | Keep shared side-effect ledger | Side-effect uncertainty must block unsafe actions. |
| `incident.*`, `workflow.incident.*` | `shared_substrate` | Keep shared incident/readiness evidence | V2 may feed evidence into incident closeout but should not fork incident state. |
| `workflow.session_pack.*`, `workflow.session_run.*` | `shared_substrate` | Keep shared session/input substrate | V2 worker lifecycle and adapter validation already depend on these records. |
| `workflow.event.*`, `workflow.runtime_event.*` | `shared_substrate` | Keep shared audit/event rails | Later label events as v1/v2/shared at read-model level. |
| `workflow.checkpoint` | `compat_shell_only` / frozen writer diagnostic | `workflow.supervisor.checkpoint`, `workflow.archive.checkpoint`, `workflow.checkpoint.legacy_export` | P27-P34 completed the writer freeze. Bare `workflow.checkpoint` writes nothing and only returns replacement diagnostics; `legacy_export` is read-only. |
| `workflow.run.*` | `removed_external_surface` | `workflow.v2.plan.create` | P9 removed `workflow.run.upsert`, `workflow.initiative.upsert`, `workflow-run`, permission rules, alias, and public registry dispatch. Keep `workflowRunUpsert` only as a private helper for remaining v1 task compatibility and keep `workflow_runs` read/history support. |
| `workflow.task.create`, `workflow.task.update` | `removed_external_surface` | v2 plan/node/template and worker result/review state | P10 removed external actions, CLI/plugin command surfaces, permission rules, migration metadata, and public registry dispatch. Private helpers remain only for `meeting.action_item` mirroring and `workflow.advance` compatibility. |
| `workflow.task.list`, `workflow.tasks` | `legacy_active` | read/history compatibility | Keep read/history surface until v2-first read models fully replace legacy task views. |
| `workflow.task.launch.prepare/review/approve` | `removed` | v2 plan admission + Human Gate package | Removed in P8; `workflow.task.launch.list` remains read/history only. |
| `workflow.advance.preview`, `workflow.supervise.preview` | `compat_shell_only` | `workflow.supervisor.readiness.preview` / `workflow.supervisor.next_actions.preview` | P15 migrated evidence-gap and semantic console read surfaces. P16 marks these previews as legacy compatibility diagnostics only for legacy task/run history; do not use them for new v2 readiness or evidence-gap planning. |
| `workflow.advance`, `workflow.supervise`, `workflow.supervisor` | `frozen_compatibility` | semantic supervisor readiness / next-actions plus v2 executor parity | P19 covers completed-plan Cat Claw closeout, P20 adds v2 checkpoint writer, P21 removes direct supervisor runtime drain, P22 adds blocked/Human Gate pending report parity, P23 isolates the control-loop `workflow_supervise` lane, P24 live audit found no dev-server legacy rows/jobs/log refs requiring that lane, P25 makes the lane default-closed, and P26 freezes standalone mutating action entry points behind `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1`. See `docs/workflow-p14-advance-supervise-freeze-readiness-audit.md`, `docs/workflow-p23-control-loop-legacy-supervise-lane-isolation.md`, `docs/workflow-p24-live-legacy-supervise-audit.md`, `docs/workflow-p25-default-close-legacy-supervise-lane.md`, and `docs/workflow-p26-advance-supervise-standalone-freeze-audit.md`. |
| `workflow.swarm.*` | `removed` | v2 manager/worker/task-group patterns | Removed in P8; no compatibility entry point remains. |
| `workflow.schedule.*` | `shared_scheduler_keep` | approved v2 plan/template scheduler and shared maintenance | Keep the governed scheduler surface; production admission is approval-bound and raw schedules remain diagnostics-only. |
| `workflow.control_loop.tick` | `shared_maintenance_keep` | shared maintenance + v2 worker control-loop adjacency | Generic control loop is protected shared maintenance; only the `workflow_supervise` lane is legacy and default-closed. |
| `workflow.control_loop.job.*` | `shared_repair_keep` | shared maintenance/dead-letter tooling | Keep governed requeue/repair until an equivalent maintenance service ledger replaces it. |
| `runtime.bridge.drain` | `shared_runtime_keep` | v2 worker wrapper/adapter drain plus shared dispatch drain evidence | Keep as shared runtime bridge; `openclaw_route_shell` inputs fail closed as retired. |
| `meeting.dispatch`, `meeting.ingest`, `meeting.resume`, `meeting.disperse` | `legacy_active` | shared runtime adapter or v2 package bridge | Preserve current OpenClaw/Hermers delivery behavior until explicit replacement. |
| `route_shell.*` | `source_deleted` | message_flow/runtime adapter evidence only | Batch F/G closed public entry points and deleted archived implementation; keep only historical vocabulary and retired-runtime rejection behavior. |
| `research.*`, `instrument.*`, `radar.*`, `thesis.*`, `gate.review` | `legacy_active` | decide with research/data workflow plan | Not part of v2 kernel cutover until research workflow templates are defined. |
| `cat_claw.audit` | `shared_substrate` | Keep shared Cat Claw audit rail | V2 adds package audit preview but does not replace all Cat Claw audit usage. |

## Immediate Follow-Up

- Add action-level tests for any `shim_to_v2` conversion.
- Do not remove `legacy_active` actions without a v2 equivalent and evidence window.
- Promote entries from `legacy_active` to `shim_to_v2` only in behavior-tested migration slices.
