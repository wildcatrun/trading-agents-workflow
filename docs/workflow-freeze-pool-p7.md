# Workflow P7 Freeze Pool

Status: active freeze-batch ledger  
Created: 2026-07-15  
Release line: `v0.8.2-rc.1` -> `v1.0.0`
Last reconciled: 2026-07-23

## Purpose

P7 freezes legacy entry points as a batch. The goal is not to remove code one
block at a time. The goal is to close default legacy entry points, keep explicit
short-term compatibility hatches where needed, then run one broad regression and
independent review pass to detect accidental freezing of useful code.

Current freeze policy is defined in
`docs/workflow-v1-v2-migration-worthiness-audit.md#freeze-batch-evidence-gate`.

## Frozen Batch

| Entry / code block | Freeze reason | Replacement | V2 dependency check | Caller inventory | Write surface | Freeze mechanism | Escape hatch / removal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `workflow.task.launch.prepare` / `review` / `approve` | P6. V2 owns plan admission, package audit, task-group package, and Human Gate request/package. Legacy launch materialized v1 run/task/phase state and has no migration value after P8. | `workflow.v2.plan.create` + v2 Human Gate package/request surfaces. | V2 plan, audit, Human Gate, worker, receipt, and readiness actions do not call `workflow.task.launch.*`. | Former Local MCP wrappers, CLI action names, historical tests, direct `runAction` callers. | Former `protocol_objects`, `artifact_index`, task-launch artifacts, Cat Brain review gate, `workflow_runs`, `workflow_tasks`, `workflow_phases`, `workflow_events`. | Removed in P8; only `workflow.task.launch.list` / `workflow_task_launch_list` remains for historical reads. | No task-launch mutation escape hatch remains. |
| `workflow.run.upsert` / `workflow.initiative.upsert` | P7 froze direct mutating run creation; P9 removed the external surface. V2 plan creation is the canonical start path for new governed orchestration. | `workflow.v2.plan.create`. | `workflow.v2.plan.create` writes `workflow_v2_plans`, `workflow_v2_plan_nodes`, and artifacts directly; it does not call `workflowRunUpsert`. | Direct external action, alias, CLI, permission rule, migration metadata, and public registry dispatch were removed in P9. Remaining callers are private v1 helper paths used by task compatibility internals. | Historical `workflow_runs`, `workflow_events`. | External action now fails closed as `unknown_workflow_action`; helper implementation remains private for v1 compatibility internals. | No external run-upsert escape hatch remains. |
| `workflow.task.create` / `workflow.task.update` | P7 froze direct task mutation; P10 removed the external surface. V2 owns new work as plan nodes, worker runs, manager/owner reviews, and worker result state. | `workflow.v2.plan.create`, `workflow.v2.worker_result.submit`, v2 review/readiness surfaces. | V2 plan/node/worker state does not call the external `workflow.task.*` actions. | Direct `runAction` callers, plugin schema actions, plugin commands, mutating CLI shell, permission rules, migration metadata, public registry dispatch, and exported helper surfaces were removed in P10. | `workflow_runs`, `workflow_tasks`, `workflow_task_dependencies`, `workflow_events`. | External mutation now fails closed as `unknown_workflow_action`; list/history reads remain available; `meeting.action_item` uses an internal Symbol compatibility token scoped to `workflow.task.create/update`, so JSON/request-level fields cannot forge the source. | No env escape hatch remains for external task mutation. |
| `workflow.swarm.plan` / `workflow.swarm` | P7. Legacy swarm fanout is superseded by v2 manager/worker/task-group and adapter-job mechanics. It should not be migrated. | `workflow.v2.worker_spawn.create` and v2 manager/worker/task-group surfaces. | V2 worker spawn/lifecycle/adapter actions do not call `workflowSwarmPlan`. | Former direct `runAction` callers, `workflow.swarm` alias, historical tests. | Former `workflow_runs`, `workflow_tasks`, dependency rows, `workflow_events`. | Removed in P8. | No swarm escape hatch remains. |

## Original P7 Not-Frozen Rationale

This section records the original P7 exclusion rationale. Later batches have
since moved some entries out of this state; see **Post-P7 Reconciliation** below.

| Entry / code block | Original P7 reason |
| --- | --- |
| `workflow.advance` / `workflow.supervise` | They are high-risk mutating operations and remain default-blocked, but not retirement-frozen in P7. P11 confirms valid readiness/progression, checkpoint, runtime-drain, and Cat Claw closeout behavior still need migration into v2/shared validators before deletion. |
| `workflow.checkpoint` | Original P7 reason: v2 checkpoint/recovery parity was not yet proven. Superseded by P27-P34; see Post-P7 reconciliation. |
| `workflow.schedule.*` | Production template/approved-plan scheduler is not fully cut over. |
| `workflow.control_loop.*`, `runtime.bridge.drain` | Shared maintenance and runtime-drain evidence still exist; v2 service ownership is not fully proven. |
| `meeting.*`, `message_flow.*`, `human_gate.*`, `incident.*`, `side_effect.*`, `trade.*`, `runtime.agent.*` | Shared substrate, not v1-only freeze targets. `meeting.action_item` mirroring remains active through an internal, non-JSON-forgeable compatibility token until a v2/shared task writer replaces it. |
| `route_shell.*` | Original P7 reason: historical ingestion/read evidence still needed audit before closing source entry points. Superseded by Batch F/G; see Post-P7 reconciliation. |

## Post-P7 Reconciliation

| Entry / code block | Current status | Evidence |
| --- | --- | --- |
| `workflow.advance` / `workflow.supervise` | `frozen_compatibility` | P19-P26 migrated supervisor readiness/next-actions/closeout/report parity, isolated `workflow_supervise`, found no live dev-server dependency, default-closed the legacy lane, and froze standalone mutating entry points behind `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1`. |
| `workflow.checkpoint` | `compat_shell_only` / frozen writer diagnostic | P27-P34 added v2/shared checkpoint writers, archive checkpoint, explicit source-class routing, read-only legacy export, and froze the mutating legacy writer. |
| `route_shell.*` | `source_deleted` / external entrypoints closed | Batch F/G closed public route-shell actions, aliases, CLI, plugin schema/hook, `meeting.dispatch` redirect, and `runtime.bridge.drain` redirect; route-shell runtime input now fails closed as retired evidence. |
| `workflow.schedule.*`, `workflow.control_loop.*`, `runtime.bridge.drain` | protected shared scheduler/maintenance substrate | Batch C audit keeps these surfaces because they own approved schedule admission, bounded maintenance, stale dispatch/message-flow/Human Gate/outbox repair, and runtime drain evidence. |
| `workflow.pause` / `workflow.resume` / `workflow.stop` | `frozen_compatibility` / default-disabled lifecycle writers | V2 intervention readiness, settlement previews/records, and gated `workflow.v2.pause/resume/stop/terminate` transitions are the v1.0 hard-cutover path. Legacy lifecycle writes require `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1` and are retained only for short-term compatibility recovery. |
| `workflow.evaluate` | `frozen_compatibility` / default-disabled evaluator writer | `workflow.v2.evaluation_snapshot.preview`, `workflow.v2.evaluation.record`, and `workflow.v2.validate` own the canonical evaluator path; legacy writes require `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_EVALUATOR=1` during the observation window. |

## Batch Review Standard

The batch is acceptable only if:

- default-deny regression proves each frozen mutating entry blocks without the
  explicit legacy flag;
- alias paths canonicalize and block the same way;
- telemetry records blocked legacy/deprecated use without enabling behavior;
- v2 plan creation, v2 worker/review/Human Gate, shared receipt/readiness, and
  release smoke still pass;
- independent review finds no still-useful code block frozen by mistake.
