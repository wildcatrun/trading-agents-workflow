# Workflow P10 Task Mutation Retirement Audit

Status: audit, no code removal
Created: 2026-07-17
Scope: `workflow.task.create` / `workflow.task.update`

## Purpose

This document is the P10 pre-removal audit for the legacy workflow task
mutation surface. It records the current topology, active callers, replacement
coverage, internal compatibility dependencies, and the safe removal sequence
before any implementation patch deletes task mutation code.

The goal is to retire direct external task creation/update without breaking
shared substrate paths that still use legacy task rows as historical evidence,
especially `meeting.action_item` mirroring and existing read models.

## Current Topology

| Layer | Current surface | File | Status | P10 judgment |
| --- | --- | --- | --- | --- |
| OpenClaw plugin action schema | `workflow.task.create`, `workflow.task.update` | `index.js` | Still listed as external actions. | Remove in implementation only after internal helper split. |
| Commander plugin commands | `workflow-task`, `workflow-task-update` | `index.js` | Still maps to external task mutations. | Remove mutating command surfaces; keep `workflow-tasks` read surface. |
| Local CLI shell | `workflow-task`, `workflow-task-update` | `bin/cat-meeting-governance.mjs` | Mutating mode is retired by default but still exists behind `TRADING_AGENTS_WORKFLOW_CLI_ALLOW_LEGACY_MUTATING_SHELLS=1`. | Delete mutating cases in implementation; keep `workflow-task --dry-run true` if it maps only to draft. |
| Public documentation | action list and task-pool guidance | `docs/openclaw-plugin-readme.md` | Still advertises `workflow.task.create` / `workflow.task.update` as actions. | Update in the same implementation patch so removed actions are not documented as active. |
| Read/list aliases | `workflow.tasks` -> `workflow.task.list` | `src/workflow/action-aliases.js` | Read/history compatibility. | Keep until v2-first read models fully replace legacy task views. |
| Action policy | legacy mutating actions, permission rules, migration metadata | `src/workflow/action-policy.js` | Frozen compatibility metadata and default block. | Remove mutating action policy only when external action registry dispatch is removed. Keep read-list policy. |
| Public action registry | `WORKFLOW_TASK_ACTION_REGISTRY` | `src/workflow-task-actions.js`, `src/workflow.js` | Handles create/update/list. | Split mutation helpers from public read registry; registry should retain list only. |
| Exported helpers | `workflowTaskCreate`, `workflowTaskUpdate`, `workflowTaskList` | `src/workflow.js` | Create/update are exported and used internally. | Make create/update non-exported when possible; keep list export if needed for read tests/tools. |
| Regression fixtures/contracts | direct helper imports and registry assertions | `scripts/workflow_regression_tests.mjs` | Tests still assert public registry create/update behavior and import helpers directly. | Refactor tests in lockstep with helper privatization; prove behavior through internal callers instead of public exports. |
| Internal meeting mirror | `meeting.action_item` -> task create/update | `src/core.js` | Active shared-substrate path using an internal Symbol token. | Keep until a dedicated shared action-item/v2 writer replaces it. |
| Advance helper dependency | `workflow.advance` -> `workflowTaskUpdate` | `src/workflow-advance-actions.js`, `src/workflow.js` | Internal v1 compatibility dependency. | Keep internal helper until `workflow.advance` is removed/replaced. |
| Stale task-launch injection | `workflowTaskCreate` passed to task-launch handlers | `src/workflow.js` | `workflow-task-launch-actions.js` is now read-only and does not consume it. | Clean up during implementation or prior to helper privatization; do not cite it as a retention reason. |
| Historical read model | `workflow_tasks`, dependencies, task read views | shared DB/read model | Historical rows remain useful. | Do not drop tables or list/read support in P10. |

## Dependency Findings

### V2 Replacements

New governed work should enter through `workflow.v2.plan.create` and v2 plan
nodes. New progress/result state should enter through v2 worker result, manager
review, owner review, session run, adapter job, and readiness surfaces rather
than direct `workflow.task.update`.

The v2 plan/node/worker code paths do not need the external
`workflow.task.create` or `workflow.task.update` actions for normal admission or
progress updates.

### Remaining Internal Dependencies

`workflow.task.create` and `workflow.task.update` are not safe to delete as
functions in the first P10 implementation slice because two internal
compatibility paths still need equivalent behavior:

- `meeting.action_item` mirrors meeting secretary items into `workflow_tasks`.
  This keeps Cat Claw action items visible to legacy supervise/readiness/Human
  Gate inbox views. The mirror calls `runWorkflowAction` with a non-JSON
  `WORKFLOW_INTERNAL_LEGACY_COMPATIBILITY_TOKEN` Symbol scoped to
  `meeting.action_item` and the allowed actions.
- `workflow.advance` still calls `workflowTaskUpdate` internally when it marks
  selected legacy tasks as in progress.

Therefore the safe P10 boundary is to delete the public mutating action surface
only after splitting public registry dispatch from internal helpers. The first
implementation should keep internal helper functions private and non-forgeable.

### Forge-Resistance Check

The internal compatibility bypass is guarded by a local Symbol:

- `WORKFLOW_INTERNAL_LEGACY_COMPATIBILITY_TOKEN`
- source must be exactly `meeting.action_item`;
- allowed action list must include the target action;
- JSON/request-level fields such as `legacyCompatibilitySource` alone are not
  sufficient.

Existing convergence tests already exercise this by proving a forged
`legacyCompatibilitySource: "meeting.action_item"` request remains blocked.
P10 implementation should keep or strengthen that regression.

### Test And Documentation Debt

The implementation patch must not simply delete exports and then repair failing
tests opportunistically. Current tests intentionally exercise the public
`WORKFLOW_TASK_ACTION_REGISTRY` and import `workflowTaskCreate` /
`workflowTaskUpdate` directly. Those tests must be split into:

- read-surface tests for `workflow.task.list` / `workflow.tasks`;
- internal compatibility tests that prove `meeting.action_item` and
  `workflow.advance` still drive the private helpers;
- deleted-action tests that prove external create/update fail closed.

Public operator documentation must be updated in the same patch. In particular,
`docs/openclaw-plugin-readme.md` must stop listing `workflow.task.create` and
`workflow.task.update` as active actions once they are removed.

## Runtime Evidence

A read-only dev-server query on 2026-07-17 inspected:

- `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db`

Observed counts:

- `workflow_tasks`: `0`
- task-create migration telemetry rows: `0`
- task-update migration telemetry rows: `0`
- `meeting.action_item` compatibility telemetry rows: `0`

This means current dev runtime has no active task-row dependency evidence and no
observed external task mutation caller evidence. Historical read-model support
should still remain because archived databases, tests, and future compatibility
views may contain `workflow_tasks` rows even when the current dev runtime does
not.

## Removal Classification

| Candidate | Classification | Reason |
| --- | --- | --- |
| `workflow.task.create` external action | remove after helper split | V2 plan create owns new task admission; current runtime has no external caller evidence. |
| `workflow.task.update` external action | remove after helper split | V2 worker result/review/session state owns new progress; current runtime has no external caller evidence. |
| `workflow-task-update` CLI | remove now in implementation | Already retired by default; no supported new workflow path should use it. |
| `workflow-task` mutating CLI mode | remove now in implementation | Keep only dry-run draft mode if implemented as `workflow.task.draft`. |
| `workflow.task.create/update` permission rules | remove with public actions | Rules for deleted external actions should not survive as zombie policy. |
| `workflow.task.create/update` migration metadata | remove with public actions | Runtime policy should not carry metadata for unavailable external actions. |
| `workflowTaskCreate` helper | keep temporarily, private | Required by `meeting.action_item` mirror until a shared/v2 writer replaces it. |
| `workflowTaskUpdate` helper | keep temporarily, private | Required by `meeting.action_item` update path and `workflow.advance` until legacy advance is removed/replaced. |
| `workflow.task.list` / `workflow.tasks` | keep | Historical task read/list surface still has value. |
| `workflow_tasks` tables/read model | keep | Historical evidence and legacy views depend on persisted task rows. |

## Safe P10 Implementation Shape

1. Split `src/workflow-task-actions.js` into:
   - public read registry containing only `workflow.task.list` / `workflow.tasks`;
   - internal helper factory for create/update, not registered as public actions.
2. Remove `workflow.task.create` and `workflow.task.update` from the OpenClaw
   plugin action schema.
3. Remove mutating `workflow-task` and `workflow-task-update` CLI paths. Preserve
   `workflow-task --dry-run true` only if it never maps to mutation; otherwise
   replace it with explicit `workflow-task-draft`.
4. Remove `workflow.task.create` / `workflow.task.update` from
   `WORKFLOW_LEGACY_MUTATING_ACTIONS`, permission rules, and exact migration
   metadata after deleted-action tests are in place.
5. Keep `meeting.action_item` mirroring working through non-exported internal
   helper calls or an internal-only action path protected by the Symbol token.
6. Keep `workflow.advance` internal update behavior unchanged until the
   `workflow.advance` retirement slice.
7. Keep `workflow.task.list`, `workflow.tasks`, read models, and historical
   table support unchanged.
8. Remove stale `workflowTaskCreate` injection into task-launch handlers if the
   read-only task-launch module still does not consume it.
9. Update `docs/openclaw-plugin-readme.md` and migration ledgers so external
   task mutations are documented as removed rather than active/frozen.
10. Add or update regressions:
   - external `runAction({ action: "workflow.task.create" })` fails closed as
     `unknown_workflow_action`;
   - external `runAction({ action: "workflow.task.update" })` fails closed as
     `unknown_workflow_action`;
   - forged JSON compatibility source remains blocked;
   - `meeting.action_item` still creates/updates task rows;
   - `workflow.advance` still updates internal task state while it exists;
   - Hermers raw-action MCP cannot execute removed task mutations even when raw
     action tool is temporarily enabled.

## Not In This P10 Slice

- Do not remove `workflow.task.list` / `workflow.tasks`.
- Do not drop or migrate `workflow_tasks` or dependency tables.
- Do not remove `meeting.action_item` mirroring until a replacement shared/v2
  writer exists.
- Do not remove `workflow.advance` in this slice.
- Do not migrate historical task rows into v2 plan nodes automatically.

## Quality Gate For P10 Implementation

Minimum checks for the future implementation patch:

- `npm run check`
- targeted regression for task mutation removal and meeting mirror compatibility
- targeted regression for `workflow.advance` internal update compatibility
- `python3 scripts/test_hermes_mcp_surface.py`
- full `node scripts/workflow_regression_tests.mjs`
- `npm run smoke:release`
- `git diff --check`
- sensitive scan over diff and smoke artifacts
- independent subagent review focused on accidental read/list removal, broken
  `meeting.action_item` mirror, `workflow.advance` helper breakage, and policy
  schema drift
