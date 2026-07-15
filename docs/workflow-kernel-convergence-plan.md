# Workflow Kernel Convergence Plan

Status: active cleanup/convergence pass
Created: 2026-07-09
Related design context: `docs/workflow-v2-unified-next-plan.md`, `docs/workflow-v1-v2-function-matrix.md`, `docs/workflow-v1-v2-refactor-migration-plan.md`, `docs/workflow-v1-v2-migration-worthiness-audit.md`
Scope: organize existing legacy/v2/shared orchestration surfaces into safer production defaults without deleting generic authoring capability, pretending legacy diagnostics have no value, or freezing future v2 feature development

## Operating Principle

`trading-agents-workflow` is a specialized workflow orchestration tool for live-trading operations. Its primary production job should eventually be to execute audited and optimized daily workflow templates. Because the project is still in R&D and no production template set has been finalized, this pass focuses on organizing existing capabilities and making unsafe defaults explicit, not on declaring v2 complete or prohibiting new features.

This convergence pass is a boundary and default-safety pass. It is not an
internal merge of v1 and v2 implementations, and it is not a deletion plan for
generic orchestration. The current code-level inventory is maintained in
`docs/workflow-v1-v2-function-matrix.md`. The migration program for reducing v1
to compatibility shims and making v2 the default kernel is maintained in
`docs/workflow-v1-v2-refactor-migration-plan.md`; the value gate for deciding
whether a legacy block should be migrated, wrapped, left for templates, kept as
shared substrate, or archived is
`docs/workflow-v1-v2-migration-worthiness-audit.md`.

The production-oriented convergence target is:

1. approved template version;
2. instantiated plan and node graph;
3. node readiness and dispatch;
4. runtime receipt and reconciliation;
5. audit, Human Gate, and side-effect ledger;
6. structured trade intent handoff when applicable.

Generic orchestration remains valuable, but it is retained as an authoring, evaluation, recovery, diagnostics, and compatibility layer. It must not be the default way to bypass approved templates or Human-Gate-authorized plans in production.

## Keep

- Workflow v2 plan/node, info stack, review, Human Gate, worker result, adapter job, template, eval, promote, rollback, and extract modules.
- Legacy task draft/history surfaces as compatibility affordances; legacy
  mutating launch surfaces are frozen and time-boxed for retirement.
- Generic patterns such as manager-worker, parallel manager sections, evaluator-optimizer, autonomous loop, worker adapter, and local deterministic runner.
- Console and MCP read/preview surfaces needed for diagnosis, review, readiness, and audit.
- Existing tests that prove historical behavior, under explicit compatibility flags.

## Converge

- Production schedules must reference an approved active/default template or a Human-Gate-authorized workflow plan unless raw schedule dispatch is explicitly enabled for diagnostics.
- Legacy mutating workflow task actions are blocked by default at the unified action gateway.
- Generic v2 orchestration entry actions are blocked only when they are ad-hoc
  direct calls with no approved template plan, approved Human Gate plan, or
  explicit diagnostics override.
- Template authoring and preview actions remain available; production execution must flow from promoted templates or Human-Gate-authorized plans.
- MCP, CLI, and console should prefer template/status/readiness/receipt/Human
  Gate surfaces; legacy mutating launch surfaces must stay hidden by default,
  explicitly gated when exposed, and deleted after the compatibility window.
- Schema version expectations must be single-sourced or kept in lockstep across MCP wrappers and core layout.

## Do Not Remove

- Do not delete generic orchestration code merely because it is not the current production path.
- Do not delete legacy code if it provides migration, evidence, or diagnostic value.
- Do not introduce a second runtime, second scheduler, or second workflow database to solve convergence.
- Do not make production safety depend on UI hiding alone; enforce it at `runWorkflowAction` and schedule persistence.

## Current Convergence Checklist

These items describe the current convergence contract and should remain covered
by code and regression tests:

1. Unified convergence gate in `runWorkflowAction`.
2. Production schedule gate in `workflowScheduleUpsert`.
3. MCP/core schema version expectations kept in lockstep.
4. Legacy MCP task-launch descriptions treated as frozen, time-boxed
   compatibility surfaces with a target removal release.
5. Regression tests for default-deny legacy/generic/raw-schedule paths and schema version lockstep.
6. Existing broad regression behavior kept behind explicit compatibility environment flags.

## Environment Flags

These flags are for tests, migration, diagnostics, or explicitly authorized recovery:

- `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1`
- `TRADING_AGENTS_WORKFLOW_ENABLE_GENERIC_ORCHESTRATION=1`
- `TRADING_AGENTS_WORKFLOW_ALLOW_RAW_SCHEDULE_DISPATCH=1`

Production defaults must work without these flags and should fail closed for raw schedule dispatch, legacy mutating actions, and ad-hoc generic orchestration entry actions that are not attached to an approved plan. Recurring production schedules must bind either an approved active/default template or a Human-Gate-authorized workflow plan. Approved templates and Human-Gate-authorized plans may use generic worker/adapter orchestration as part of normal workflow execution.

## Decision Rule

When choosing between two existing modules, prefer the one that is closer to the real trading workflow path:

approved template -> plan/node -> dispatch/receipt -> audit/Human Gate -> side-effect/trade receipt.

When the choice is ambiguous, keep both, but put the less production-ready path behind compatibility or diagnostics gates instead of deleting it.
