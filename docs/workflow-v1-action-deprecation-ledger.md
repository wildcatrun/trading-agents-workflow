# Workflow v1 Action Deprecation Ledger

Status: draft migration ledger  
Created: 2026-07-15  
Related: `docs/workflow-v1-v2-refactor-migration-plan.md`

## Purpose

This ledger classifies legacy and shared workflow actions before the v2 default-kernel migration. It prevents accidental use of undocumented v1 paths and keeps shared substrate from being misclassified as legacy code.

## Status Values

| Status | Meaning |
| --- | --- |
| `shared_substrate` | Shared by v1 and v2; do not remove as v1-only. |
| `shim_to_v2` | Keep the action name, but route internally to v2 or shared substrate. |
| `legacy_active` | Still active because v2 does not fully replace it yet. |
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
| `workflow.checkpoint` | `legacy_active` | Decide per v2 checkpoint/readiness design | Keep until v2 plan/node/worker checkpoints have equivalent recovery coverage. |
| `workflow.run.*` | `compat_shell_only` | `workflow.v2.plan.create` | P7 freezes direct mutating run creation by default; v2 plan create owns new orchestration starts and does not depend on `workflowRunUpsert`; keep read/history and internal v1 helper compatibility only behind explicit legacy mode until `v1.0.0`. |
| `workflow.task.create`, `workflow.task.update` | `compat_shell_only` | v2 plan/node/template and worker result/review state | P7 keeps direct mutating task entry points frozen by default; retain only explicit legacy compatibility until `v1.0.0`. |
| `workflow.task.list`, `workflow.tasks` | `legacy_active` | read/history compatibility | Keep read/history surface until v2-first read models fully replace legacy task views. |
| `workflow.task.launch.prepare/review/approve` | `removed` | v2 plan admission + Human Gate package | Removed in P8; `workflow.task.launch.list` remains read/history only. |
| `workflow.advance`, `workflow.supervise` | `legacy_active` | v2 validate/review/audit/readiness | Do not add new semantics here; migrate effective checks into v2. |
| `workflow.swarm.*` | `removed` | v2 manager/worker/task-group patterns | Removed in P8; no compatibility entry point remains. |
| `workflow.schedule.*` | `legacy_active` | approved v2 plan/template scheduler or shared maintenance | Must not become a parallel v2 scheduler. |
| `workflow.control_loop.tick` | `legacy_active` | shared maintenance + v2 adapter drain service | Treat as legacy mechanical maintenance until v2 service replaces orchestration usage. |
| `workflow.control_loop.job.*` | `legacy_active` | shared maintenance/dead-letter tooling | Keep for compatibility and recovery until v2 service ledger exists. |
| `runtime.bridge.drain` | `legacy_active` | v2 worker wrapper/adapter drain for worker execution | Keep as shared runtime bridge until real v2 wrappers are deployed. |
| `meeting.dispatch`, `meeting.ingest`, `meeting.resume`, `meeting.disperse` | `legacy_active` | shared runtime adapter or v2 package bridge | Preserve current OpenClaw/Hermers delivery behavior until explicit replacement. |
| `route_shell.*` | `deprecated` | message_flow/runtime adapter evidence only | Do not use as active execution path for migrated Hermers agents. |
| `research.*`, `instrument.*`, `radar.*`, `thesis.*`, `gate.review` | `legacy_active` | decide with research/data workflow plan | Not part of v2 kernel cutover until research workflow templates are defined. |
| `cat_claw.audit` | `shared_substrate` | Keep shared Cat Claw audit rail | V2 adds package audit preview but does not replace all Cat Claw audit usage. |

## Immediate Follow-Up

- Add action-level tests for any `shim_to_v2` conversion.
- Do not remove `legacy_active` actions without a v2 equivalent and evidence window.
- Promote entries from `legacy_active` to `shim_to_v2` only in behavior-tested migration slices.
