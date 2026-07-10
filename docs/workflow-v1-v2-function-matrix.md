# Workflow V1/V2 Function Matrix

Status: active architecture inventory
Created: 2026-07-10
Related: `docs/workflow-kernel-convergence-plan.md`, `docs/workflow-v2-orchestration-kernel.md`, `docs/workflow-v2-implementation-status.md`

## Purpose

This document records the current code-level boundary between legacy workflow
surfaces, workflow v2, and shared control-plane modules. It is an inventory for
convergence decisions, not a claim that v2 is complete, not a removal plan, and
not a freeze on future v2 feature development.

The current architecture is not a clean two-product split:

- workflow v2 is the primary orchestration kernel for plan/node/template/worker
  lifecycle/review surfaces;
- legacy workflow remains a compatibility, migration, evidence, and diagnostics
  surface around the older run/phase/task model;
- both use the shared control plane for session, artifact, runtime registry,
  Human Gate, message flow, receipt, side effect, schedule, and trading-core
  handoff records.

No production template set has been finalized yet. Production-facing defaults
should therefore fail closed without deleting useful generic or legacy
capabilities that may be needed for authorized plans, recovery, migration, or
future template authoring.

## Functional Matrix

| Area | Legacy / v1 surface | Workflow v2 surface | Shared control-plane surface | Current decision |
| --- | --- | --- | --- | --- |
| Primary state model | `workflow_runs`, `workflow_phases`, `workflow_tasks`, `workflow_task_dependencies`, `workflow_checkpoints`, `workflow_events`, `workflow_agent_runs` in `src/workflow.js`. | `workflow_v2_plans`, `workflow_v2_plan_nodes`, `workflow_v2_info_items`, `workflow_v2_worker_runs`, `workflow_v2_worker_adapter_jobs`, review/audit/package/template tables in `src/workflow.js`. | One SQLite control-plane database initialized by the workflow package. | Do not force a table-level merge. Treat v2 as the primary kernel and legacy as compatibility/migration state. |
| Plan and node graph | Older task/phase/run abstractions; no canonical v2-style plan/node contract. | `workflow.v2.plan.create` records a plan, canonical plan artifact, and v2 plan nodes. | `artifact_index` stores canonical artifacts shared across surfaces. | New production orchestration should bind to v2 plan/node. Legacy tasks should not be expanded as the new plan format. |
| Template lifecycle | No full approved template registry in the legacy task model. | `workflow.template.*` manages candidate record, eval, stats, promote, rollback, extract, search, get, and instantiate. | Schedule and Human Gate can reference approved templates or approved plans. | Daily production workflow should be template-first once audited templates exist. |
| Generic orchestration | Legacy task launch and swarm surfaces provide older fanout/launch affordances. | Worker spawn, handoff, retire, successor, adapter job, adapter runner, worker result, and control-loop actions model generic orchestration inside v2. | Unified action policy gates generic writes unless attached to approved template/plan context or explicit diagnostics flags. | Keep generic orchestration. Do not allow ad-hoc generic writes to bypass approved plans/templates in production. |
| Runtime session binding | Legacy flows can use shared session pack/run records. | Worker spawn calls the shared session-run path, then links `workflow_v2_worker_runs` to `workflow_session_runs`; v2 validation checks this linkage. | `workflow_session_packs` and `workflow_session_runs`. | Session is shared infrastructure. v2 is not fully standalone and should not invent another session store. |
| Runtime dispatch and receipts | Legacy dispatch/reconcile/runtime bridge surfaces remain available. | Adapter job and adapter runner surfaces prepare bounded v2 worker execution manifests and receipts. | `runtime_agents`, `mixed_meeting_dispatches`, `runtime_runs`, `message_flows`, `message_flow_events`, receipt/reconcile actions. | Use shared runtime registry and receipt evidence. Do not create a parallel v2 runtime registry. |
| Review and Human Gate | Shared Human Gate, protocol, and incident surfaces remain the final governed decision path. | v2 owner/manager review, task group package, Cat Brain audit, Cat Claw audit, and v2 Human Gate package prepare structured evidence. | `human_gate_buttons`, `human_gate_batches`, `protocol_objects`, Telegram/outbox delivery, Human Gate resume paths. | v2 may package evidence, but final Human Gate remains shared and button/receipt governed. |
| Schedule | Legacy raw schedule dispatch exists for diagnostics or migration. | Approved template and Human-Gate-approved v2 plan schedules are the production-oriented path. | `workflow_schedules` and `scheduled_runs`. | Production schedules must bind to approved templates or approved Human Gate plans unless raw schedule dispatch is explicitly enabled for diagnostics. |
| Trading side effects | Legacy workflow can provide historical evidence and migration context. | v2 can produce audited plan/review/Human Gate evidence before trade handoff. | `executable_trade_intents`, `trading_core_receipts`, `side_effect_ledger`, hard gate policy. | Trading actions must stay on shared deterministic hard-gate/receipt rails. v2 orchestration does not replace trading-core boundaries. |
| Console, CLI, MCP | Legacy read/list/draft/diagnostic surfaces remain useful. Legacy mutating task launch is compatibility-oriented. | v2 preview/read/validate/template surfaces are the preferred authoring and inspection path. | `runWorkflowAction`, `src/workflow/action-policy.js`, console action gateway, MCP wrappers. | Enforce safety at the action gateway and schedule persistence layer, not only by hiding UI buttons. |
| Tests and check coverage | Legacy extracted-action and convergence tests preserve compatibility expectations. | v2 extracted-action, adapter, lifecycle, review, Human Gate, template, control-loop, and validator tests cover the new kernel. | Convergence tests cover default-deny legacy/generic/raw schedule paths and authorized template/plan paths. | Add coverage when a boundary changes. Do not remove legacy tests while legacy code still exists. |

## Boundary Rules

1. If a change concerns approved templates, instantiated plans, plan nodes,
   worker lifecycle, worker adapter jobs, reviews, audits, or v2 Human Gate
   packages, it belongs to workflow v2.
2. If a change concerns older workflow runs, phases, tasks, task dependencies,
   task launch, or swarm planning, treat it as legacy compatibility unless it is
   explicitly part of a migration bridge.
3. If a change concerns session packs/runs, artifact index, runtime agents,
   message flow, dispatch/receipt, Human Gate decision records, side-effect
   ledger, schedules, or trading-core receipt records, it belongs to the shared
   control plane.
4. Do not delete generic v2 worker/adapter orchestration merely because the
   default production path is template-first. Approved templates or approved
   Human Gate plans may legitimately contain generic orchestration.
5. Do not delete legacy code merely because it is not the primary production
   path. Freeze or gate mutating paths when they are unsafe by default; keep
   read, evidence, migration, and diagnostics value.
6. Do not build a broad internal compatibility layer that tries to make every
   legacy task look like a v2 node. Add narrow migration/adaptor code only when
   a real audited workflow requires it.

## Current Verification Anchors

The inventory is supported by these regression checks:

- `npm run check`
- `node scripts/workflow_regression_tests.mjs --grep "workflow v2 extracted action contracts"`
- `node scripts/workflow_regression_tests.mjs --grep "workflow convergence default gates"`
- `node scripts/workflow_regression_tests.mjs --grep "schedule approved template default path"`
- `node scripts/workflow_regression_tests.mjs --grep "schedule Human Gate approved plan default path"`
- `node scripts/workflow_regression_tests.mjs --grep "generic orchestration authorized template plan"`
- `node scripts/workflow_regression_tests.mjs --grep "generic orchestration Human Gate exact plan authorization"`
- `node scripts/workflow_regression_tests.mjs --grep "workflow v2 permission and console gate"`
- `node scripts/workflow_regression_tests.mjs --grep "workflow schema version lockstep"`

## Known Cautions

- Some v2 design documents describe conceptual schema that is not fully present
  in runtime code. Runtime decisions must use actual action registries, table
  creation statements, and tests as the source of truth.
- `src/workflow.js` still owns much of the shared schema initialization. This
  does not mean v2 is absent; it means v2 currently runs inside the same
  package-level control-plane database.
- Convergence means production default safety and shared evidence rails. It does
  not mean deleting generic orchestration, deleting legacy diagnostics, or
  claiming the project has finalized live production templates.
