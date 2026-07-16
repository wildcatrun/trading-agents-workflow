# Workflow P9 Run Upsert Retirement Audit

Status: audit, no code removal  
Created: 2026-07-16  
Scope: `workflow.run.upsert` / `workflow.initiative.upsert`

## Purpose

This document is the P9 pre-removal audit for the legacy workflow run creation
surface. It records current topology, active callers, replacement coverage, and
the safe removal sequence before any P9 implementation patch deletes code.

The goal is to avoid migrating or preserving a v1 entry point that has no
production value, while also avoiding accidental deletion of helper code still
used by remaining v1 compatibility paths.

## Current Topology

| Layer | Current surface | File | Status | P9 judgment |
| --- | --- | --- | --- | --- |
| OpenClaw plugin action schema | `workflow.run.upsert`, `workflow.initiative.upsert` | `index.js` | Still listed as external actions. | Remove in P9 when external registry is deleted. |
| Commander plugin command | `workflow-run` | `index.js` | Still maps to `workflow.run.upsert`; execution is blocked by convergence gate. | Remove or convert to explicit unknown/retired command in P9. |
| Local CLI shell | `workflow-run` | `bin/cat-meeting-governance.mjs` | Already retired by default; compatibility shell only runs if `TRADING_AGENTS_WORKFLOW_CLI_ALLOW_LEGACY_MUTATING_SHELLS=1`. | Delete command case in P9. |
| Action alias | `workflow.initiative.upsert` -> `workflow.run.upsert` | `src/workflow/action-aliases.js` | Alias exists only for legacy run creation. | Remove with public action deletion. |
| Action policy | legacy mutating action, permission rule, migration metadata | `src/workflow/action-policy.js` | Frozen compatibility metadata; now unnecessary once action is deleted. | Remove from runtime policy after deleted-action tests are in place. |
| Public action registry | `WORKFLOW_RUN_ACTION_REGISTRY` | `src/workflow-run-actions.js`, `src/workflow.js` | Still handles external run upsert. | Remove public registry dispatch in P9. |
| Private helper | `workflowRunUpsert` | `src/workflow-run-actions.js`, `src/workflow.js` | Still used by `workflow.task.create` and tests. | Keep private helper until `workflow.task.create` is removed or replaced. |
| Stale dependency injection | `workflowRunUpsert` passed to task-launch handlers | `src/workflow.js` | `workflow-task-launch-actions.js` is now read-only and does not consume it. | Clean up during P9 or task-action cleanup; do not cite it as a helper retention reason. |
| Local MCP dedicated tool | none found | `scripts/trading_agents_workflow_mcp.py` | No dedicated local MCP tool exposes run upsert. | No dedicated local MCP deletion needed for P9 run-upsert. |
| Hermers raw action MCP | `trading_agents_workflow` raw action | `scripts/trading_agents_workflow_hermes_mcp.py` | Disabled by default, but can call documented public actions when `TRADING_AGENTS_WORKFLOW_ALLOW_RAW_ACTION=1`. | P9 must verify raw-action calls fail closed once run-upsert is removed. |
| Historical read model | `workflow_runs` table and status/readiness views | shared DB/read model | Historical rows still useful. | Do not drop table or read support. |

## Dependency Findings

### V2 Replacement

`workflow.v2.plan.create` is the canonical start path for new governed
orchestration. It writes v2 plan rows, plan nodes, and artifacts directly. The
v2 plan path does not call `workflowRunUpsert`.

### Remaining Internal Dependency

`workflow.task.create` calls `workflowRunUpsert` before inserting legacy
`workflow_tasks`. This is an internal v1 compatibility dependency:

- it creates or refreshes the parent `workflow_runs` row;
- it emits `workflow.created` / `workflow.updated` events;
- it remains relevant only while external or internal legacy task creation still
  exists.

Therefore P9 must not delete `workflowRunUpsert` as a function. The safe P9
boundary is to delete the public action surface while keeping a private helper.

### Runtime Evidence

A read-only dev-server query on 2026-07-16 found zero `workflow_runs` rows in
the active runtime database:

- `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db`

The same check found no `workflow.action_migration_telemetry` rows for:

- `workflow.run.upsert`
- `workflow.initiative.upsert`

This means current dev runtime has no active run-row dependency evidence and no
observed external run-upsert caller evidence. Historical read-model support
should still remain because other deployments, archived databases, or future
compatibility tests may contain `workflow_runs` rows even when the current dev
runtime does not.

## Removal Classification

| Candidate | Classification | Reason |
| --- | --- | --- |
| `workflow.initiative.upsert` alias | remove now | Alias has no independent semantics and only reaches the frozen run-upsert path. |
| `workflow.run.upsert` external action | remove now | V2 plan create covers new workflow starts; runtime telemetry shows no active caller. |
| `workflow-run` local CLI command | remove now | Already retired by default; v2 CLI path exists. |
| `workflow-run` commander plugin command | remove now | Still presents a legacy external command; should not survive P9. |
| `WORKFLOW_RUN_ACTION_REGISTRY` dispatch | remove now | Public registry only exists to expose deleted external actions. |
| `workflowRunUpsert` helper | keep temporarily | Required by `workflow.task.create` until the task mutation surface is removed or replaced. |
| `workflow_runs` table/read model | keep | Historical/readiness/status evidence still depends on persisted run rows. |
| `workflow.run.upsert` migration metadata | remove with action | Runtime policy should not carry metadata for deleted action; historical docs keep rationale. |

## Safe P9 Implementation Shape

1. Remove external action schema entries for `workflow.run.upsert` and
   `workflow.initiative.upsert`.
2. Remove `workflow.initiative.upsert` from `WORKFLOW_ACTION_ALIASES`.
3. Remove `workflow.run.upsert` from `WORKFLOW_LEGACY_MUTATING_ACTIONS`,
   `WORKFLOW_ACTION_PERMISSION_RULES`, and exact migration metadata.
4. Replace `WORKFLOW_RUN_ACTION_REGISTRY` with no public registry, or change
   `src/workflow-run-actions.js` to export only a helper factory that does not
   register external action names.
5. Keep `workflowRunUpsert` exported from `src/workflow.js` only as an internal
   helper for `workflow.task.create` until the task mutation retirement patch.
6. Remove the `workflow-run` CLI case from `bin/cat-meeting-governance.mjs` and
   the commander plugin command from `index.js`.
7. Update active operator docs, especially `docs/openclaw-plugin-readme.md`, so
   `workflow.run.upsert` and `workflow.initiative.upsert` are no longer listed
   as current actions after the action surface is removed.
8. Update regression tests:
   - removed action preflight should fail closed with `unknown_workflow_action`;
   - `runAction({ action: "workflow.run.upsert" })` should be rejected before
     mutation;
   - Hermers raw-action MCP should not be able to execute removed run-upsert
     when the raw action tool is temporarily enabled;
   - `workflow.task.create` legacy compatibility tests should still prove the
     internal helper creates the parent run row while task mutation remains.
9. Keep `workflow.task.list`, `workflow.status`, readiness, and historical run
   read behavior unchanged.

## Not In This P9 Slice

- Do not remove `workflow.task.create` / `workflow.task.update` yet.
- Do not remove `workflowRunUpsert` private helper yet.
- Do not drop or migrate `workflow_runs` table rows.
- Do not modify `meeting.action_item` mirroring.
- Do not change v2 plan create semantics to write legacy `workflow_runs` rows.

## Quality Gate For P9 Implementation

Minimum checks for the future implementation patch:

- `npm run check`
- targeted regression for run-upsert removal and task-create compatibility
- full `node scripts/workflow_regression_tests.mjs`
- `npm run smoke:release`
- `git diff --check`
- sensitive scan over diff and smoke artifacts
- independent subagent review focused on accidental helper deletion and action
  policy/schema drift
