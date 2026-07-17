# Workflow P8 Removal Candidates

Status: audit candidate document  
Created: 2026-07-16  
Target line: `v0.8.2-rc.1` -> `v1.0.0`  
Related:
- `docs/workflow-freeze-pool-p7.md`
- `docs/workflow-v1-v2-migration-worthiness-audit.md`
- `docs/workflow-v1-action-deprecation-ledger.md`
- `docs/workflow-v1-v2-refactor-migration-plan.md`
- `docs/workflow-p9-run-upsert-retirement-audit.md`

## Purpose

P8 is the removal-planning phase after P7 batch freeze. This document does not
delete code. It records candidate removal batches, required evidence, v2
replacement, and rollback boundary before any implementation starts.

Removal must happen by batch, followed by broad regression and independent
review. Do not run a full suite after every single legacy block; freeze and
remove a coherent batch, then use the full suite to detect whether a useful code
block was removed by mistake.

## Non-Goals

- Do not remove shared substrate such as `message_flow.*`, `human_gate.*`,
  `incident.*`, `side_effect.*`, `trade.*`, `runtime.agent.*`, `workflow.event.*`,
  or `workflow.runtime_event.*`.
- Do not remove `workflow.checkpoint`, `workflow.schedule.*`,
  `workflow.advance`, `workflow.supervise`, `workflow.control_loop.*`, or
  `runtime.bridge.drain` in P8 without a separate parity audit.
- Do not delete historical docs only because they mention legacy actions; first
  mark them as historical references or move them to an archive section.
- Do not remove `workflow.task.list` or read/history views until v2 read-model
  parity is proven.

## Candidate Batches

### Batch A: CLI Legacy Mutating Shells

| Candidate | Current file | Replacement | Removal reason | Preconditions |
| --- | --- | --- | --- | --- |
| `workflow-run` command | `bin/cat-meeting-governance.mjs` | `workflow.v2.plan.create` or approved template entry | Removed in P9; direct run creation is not a supported CLI surface. | None; unknown-command regression covers the retired entry. |
| `workflow-swarm` command | `bin/cat-meeting-governance.mjs` | `workflow.v2.worker_spawn.create` through v2 plan/manager-worker surfaces | Legacy generic fanout is superseded by v2 manager/worker/task-group mechanics. | Confirm no current smoke, OpenClaw plugin docs, or operator workflow needs this command. |
| `workflow-task` mutating create mode | `bin/cat-meeting-governance.mjs` | `workflow.v2.plan.create`, v2 plan nodes, `meeting.action_item` shared mirror, or approved templates | Removed in P10; non-mutating `workflow-task --dry-run true` remains as draft only. | Done. |
| `workflow-task-update` command | `bin/cat-meeting-governance.mjs` | `workflow.v2.worker_result.submit`, v2 manager/owner review state | Removed in P10; direct task update is not a supported CLI surface. | Done. |
| `workflow-task-launch-prepare/review/approve` commands | `bin/cat-meeting-governance.mjs` | `workflow.v2.plan.create` plus v2 Human Gate package/request surfaces | P6 froze task launch as short-term compatibility. | Keep `workflow-task-launch-list` only if historical read access is still needed. |

Expected implementation shape:

- Remove command cases that create frozen mutating actions.
- Keep help text and docs aligned so operators see v2 commands/examples only.
- Keep read-only/list commands only when they serve historical evidence.

### Batch B: MCP Legacy Mutating Discovery and Tool Handlers

Status: completed in P8. The hidden MCP task-launch prepare/review/approve
tools and `TRADING_AGENTS_WORKFLOW_MCP_SHOW_LEGACY_MUTATING_TOOLS` discovery
escape hatch were removed. `workflow_task_launch_list` remains as a historical
read-only surface.

| Candidate | Current file | Replacement | Removal reason | Preconditions |
| --- | --- | --- | --- | --- |
| `workflow_task_launch_prepare` MCP tool | `scripts/trading_agents_workflow_mcp.py` | v2 plan/tooling and approved templates | Hidden by default since P7 and only retained as a compatibility escape hatch. | Confirm local Codex and Hermes MCP configs expose v2 plan/Human Gate surfaces needed for the same workflow. |
| `workflow_task_launch_review` MCP tool | `scripts/trading_agents_workflow_mcp.py` | v2 audit/review/Human Gate package | Legacy Cat Brain review of Task Launch Package should not remain a v1.0 surface. | Ensure v2 review/Human Gate evidence is the documented replacement. |
| `workflow_task_launch_approve` MCP tool | `scripts/trading_agents_workflow_mcp.py` | v2 Human Gate request/package | Legacy materialization into `workflow_tasks` is frozen. | Ensure no active MCP client depends on the hidden tool names. |
| `TRADING_AGENTS_WORKFLOW_MCP_SHOW_LEGACY_MUTATING_TOOLS` escape hatch | `scripts/trading_agents_workflow_mcp.py` | none after removal | Escape hatch should not survive past the removal target. | Remove only after the tools themselves are deleted. |

Expected implementation shape:

- Delete hidden legacy tool definitions, helper functions, audit event branches,
  and call dispatch branches together.
- Remove the discovery escape hatch after no hidden legacy tools remain.
- Keep MCP read/status/message/Human Gate/runtime tools untouched.

### Batch C: External Action Aliases and Permission Rules

| Candidate | Current file | Replacement | Removal reason | Preconditions |
| --- | --- | --- | --- | --- |
| `workflow.initiative.upsert` alias | `src/workflow/action-aliases.js` | `workflow.v2.plan.create` | Removed in P9; alias existed only to reach frozen `workflow.run.upsert`. | None; unknown-action regression covers the retired alias. |
| `workflow.swarm` alias | `src/workflow/action-aliases.js` | `workflow.v2.worker_spawn.create` via v2 plan | Alias exists only to reach frozen `workflow.swarm.plan`. | Confirm no docs/tests still present it as active. |
| `workflow.task.launch.draft/submit/brain_review` aliases | `src/workflow/action-aliases.js` | v2 plan/Human Gate surfaces | Aliases only support legacy task launch compatibility. | Keep only if historical fixtures require them; otherwise remove with task-launch actions. |
| Permission rules for removed mutating actions | `src/workflow/action-policy.js` | v2 action permission rules | Rules for deleted actions should not remain as zombie policy. | Remove in the same batch as action registry deletion. |
| Migration metadata for removed actions | `src/workflow/action-policy.js` | archived release notes / ledger | Runtime policy no longer needs metadata for unavailable actions after removal. | Keep enough documentation outside runtime code to explain removal. |

Expected implementation shape:

- Remove aliases first only if direct canonical actions also remain blocked or removed.
- Do not remove aliases for shared active substrate.
- Adjust tests from “blocked by default” to “unknown/removed action” only when code is actually deleted.

### Batch D: Legacy Action Modules

Status: completed in P8. `workflow-swarm-actions.js`,
`workflow.swarm`, `workflow.swarm.plan`, and `workflow-swarm` were removed.
`workflow-task-launch-actions.js` was reduced to the read-only
`workflow.task.launch.list` historical archive surface; prepare/review/approve
actions and CLI/MCP entry points were removed.

| Candidate | Current file | Replacement | Removal reason | Preconditions |
| --- | --- | --- | --- | --- |
| `workflow-swarm-actions.js` | `src/workflow-swarm-actions.js` | `workflow.v2.worker_spawn.create`, v2 manager/worker/task-group surfaces | Classified as `archive_no_migration`; no production value remains after P7 freeze. | Remove CLI/action alias/registry/tests first or in the same batch. |
| `workflow-task-launch-actions.js` mutating prepare/review/approve | `src/workflow-task-launch-actions.js` | `workflow.v2.plan.create`, v2 Human Gate package/request | P6 frozen compatibility path; target removal `v1.0.0`. | Decide whether `workflow.task.launch.list` remains as read-only historical view or moves to an archive helper. |
| `workflow-run-actions.js` external upsert registry | `src/workflow-run-actions.js` | `workflow.v2.plan.create`; internal helper remains private temporarily | Public registry dispatch removed in P9. | Keep `workflowRunUpsert` private until remaining v1 task mutation compatibility is removed or replaced. |
| `workflow-task-actions.js` external create/update registry | `src/workflow-task-actions.js` | v2 plan nodes and `workflow.v2.worker_result.submit`; `meeting.action_item` mirror | Removed in P10; public registry now keeps only `workflow.task.list` / `workflow.tasks`. | Preserve or replace internal helper path used by `meeting.action_item` and `workflow.advance` until v2/shared replacements exist. |

Expected implementation shape:

- Prefer deleting public action registry exposure before deleting private helper
  functions that are still needed by shared compatibility paths.
- For `workflow.task.create/update`, do not break `meeting.action_item` mirroring
  or `workflow.advance` internal task update compatibility until dedicated
  replacements exist. P10 audit is
  `docs/workflow-p10-task-mutation-retirement-audit.md`.
- For `workflow.run.upsert`, P9 removed the external surface and kept the
  private `workflowRunUpsert` helper while private task compatibility internals
  still depend on parent run rows.
- Do not remove `workflow_task_launch_package` protocol object/read-model support
  until historical package listing and archive evidence have a replacement.

### Batch E: Test Refactor and Fixture Split

| Candidate | Current file | Replacement | Removal reason | Preconditions |
| --- | --- | --- | --- | --- |
| Direct legacy action contract tests | `scripts/workflow_regression_tests.mjs` | v2 contract tests or removed-action tests | Current tests still prove frozen legacy helpers work directly. | Convert to archive/compat tests only while compatibility exists; remove when code is deleted. |
| Fixture setup using `workflow.run.upsert` / `workflow.task.create` | `scripts/workflow_regression_tests.mjs` | direct fixture DB setup or v2 plan fixtures | P9/P10 removed public helper dependence from the relevant fixtures; remaining task fixture usage is explicit internal compatibility coverage. | Continue moving unrelated fixtures to direct DB/v2 setup when touched. |
| P7 convergence default gate tests | `scripts/workflow_regression_tests.mjs` | removed-action tests after deletion | While freeze exists, blocked-by-default is correct; after deletion, expected behavior changes. | Update only in the batch that actually deletes actions. |
| `meeting.action_item` mirror tests | `scripts/workflow_regression_tests.mjs` | shared action-item writer tests | Must remain until replacement writer exists. | Do not remove with generic task action tests. |

Expected implementation shape:

- First identify tests that use legacy helpers only as fixture factories.
- Replace fixture factories before removing runtime helpers.
- Keep at least one regression proving shared substrates still work after
  legacy deletion.

### Batch F: Historical Documentation Cleanup

| Candidate | Current file(s) | Replacement | Removal reason | Preconditions |
| --- | --- | --- | --- | --- |
| Active docs that still show legacy command examples | `docs/openclaw-plugin-readme.md`, README-adjacent docs | v2 examples and freeze/removal links | Operators should not discover frozen commands as normal workflow. | Remove or mark examples before deleting commands. |
| Historical task-launch design docs | `docs/workflow-task-drafting-initial-plan.md`, `docs/engineering-changes-2026-05-27.md`, `docs/claude-code-workflow-reference/*` | archive marker plus link to v2 plan/Human Gate docs | Historical evidence should not look like current operator guidance. | Keep as historical references until `v1.0.0` release notes are complete. |
| P7 freeze ledger | `docs/workflow-freeze-pool-p7.md` | P8 removal ledger and `v1.0.0` release notes | After deletion, freeze ledger becomes historical evidence. | Keep until removal evidence is merged and released. |

Expected implementation shape:

- Do not delete historical rationale prematurely.
- Change active operator docs before code deletion so callers have a migration path.

## Explicitly Not P8 Removal Candidates

| Surface | Reason |
| --- | --- |
| `message_flow.*` | Shared notification/evidence substrate used by v1, v2, runtime bridge, and control-loop drains. |
| `human_gate.*` | Shared final decision rail; v2 builds packages/requests on top of it. |
| `incident.*` / `side_effect.*` / `trade.*` | Shared safety and trading boundaries. |
| `runtime.agent.*` | Global runtime registry; not v1-specific. |
| `workflow.event.*` / `workflow.runtime_event.*` | Shared audit/event rails. |
| `workflow.task.list` / `workflow.tasks` | Historical read surface; keep until v2 read model parity is proven. |
| `workflow_task_launch_package` protocol/read-model support | Historical Task Launch Package evidence may still be needed even after mutating task-launch actions are removed. |
| `workflow.checkpoint` | Needs v2 checkpoint/recovery parity audit first. |
| `workflow.advance` / `workflow.supervise` | Frozen/high-risk but still contain readiness/progression checks that need migration before deletion. P11 audit: `docs/workflow-p11-advance-supervise-migration-audit.md`. |
| `workflow.schedule.*` | Needs approved v2 plan/template scheduler cutover. |
| `workflow.control_loop.*` / `runtime.bridge.drain` | Shared maintenance/runtime-drain role is not fully replaced by v2 service yet. |
| `meeting.action_item` mirroring | Shared meeting secretary surface; keep until a v2/shared task writer replaces legacy task helper dependency. |

## Suggested Execution Order

1. **P8A docs and CLI visibility cleanup.** Remove active operator examples and
   CLI routes for frozen mutating shells once v2 command examples exist.
2. **P8B fixture split.** Replace legacy helper fixture setup in non-legacy tests
   with v2 fixtures or direct isolated DB fixtures.
3. **P8C MCP hidden tool deletion.** Delete hidden legacy task-launch MCP tools
   and the discovery escape hatch.
4. **P8D swarm removal.** Remove `workflow.swarm` / `workflow.swarm.plan` aliases,
   registry, action module, and direct tests.
5. **P8E task-launch removal.** Remove mutating task-launch actions and keep or
   archive read-only list evidence.
6. **P8F run/task external shell removal.** Remove public run/task mutation
   action exposure after private helper dependencies are replaced.
7. **P8G runtime policy cleanup.** Remove legacy gate entries, permission rules,
   and migration metadata for actions that no longer exist.
8. **P8H release notes and archive.** Convert P7 freeze ledger to historical
   evidence and record final removal evidence for `v1.0.0`.

## Required Quality Gate Per Removal Batch

Each actual removal batch must include:

- focused regression for removed action behavior;
- regression proving v2 replacement still works;
- regression proving shared substrate was not removed by mistake;
- `npm run check`;
- `npm run smoke:release`;
- `git diff --check`;
- independent reviewer verdict with blocking findings resolved.

Server deployment of a removal batch additionally requires:

- GitHub fast-forward deployment to dev-server active checkout;
- server `npm run smoke:release`;
- OpenClaw plugin registry refresh;
- workflow status postcheck;
- `main` workspace invariant check.

## Current P8 Recommendation

Start with Batch A and Batch E together:

- remove or disable active CLI commands that still construct frozen mutating
  action payloads;
- split tests that use legacy run/task helpers as fixture setup;
- keep runtime action modules untouched until fixture dependencies are reduced.

This sequence lowers operator confusion first and reduces accidental hidden
dependencies before deleting runtime code.
