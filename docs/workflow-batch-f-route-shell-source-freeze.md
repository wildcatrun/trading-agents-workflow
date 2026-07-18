# Workflow Batch F Route-Shell Source Freeze

Status: implemented candidate  
Date: 2026-07-18  
Related:
- `docs/workflow-batch-e-route-shell-removal-readiness-audit.md`
- `docs/workflow-batch-freeze-table.md`
- `scripts/workflow_batch_freeze_audit.mjs`
- `scripts/workflow_regression_tests.mjs`

## Decision

`route_shell` is source-frozen, not migrated to v2.

Reason:

- Batch E showed live dev-server state had no queued `openclaw_route_shell`
  dispatches, no route-shell message flows, no active route-shell plugin hook,
  and only dormant/disabled/non-dispatchable route-shell registry residue.
- v2 already has replacement rails through `runtime_agents`, `message_flow`,
  runtime adapters, worker backend preflight, adapter jobs, receipt evidence, and
  Human Gate/outbox where required.
- v2 must not call or accept `openclaw_route_shell` as a worker backend.

## Frozen Entry Points

Batch F closes these source/public entry points:

- plugin action contract entries for `route_shell.ingest`, `route-shell.ingest`,
  and `route_shell.route`;
- route-shell action aliases;
- route-shell permission and migration metadata;
- CLI `route-shell-ingest`;
- Gateway `before_dispatch` route-shell auto-forward hook and config schema;
- plugin manifest `routeShell` config schema;
- `meeting.dispatch runtime=openclaw_route_shell` compatibility redirect;
- `runtime.bridge.drain runtime=openclaw_route_shell` compatibility redirect.

## Runtime Behavior

- Direct `runAction` calls for `route_shell.ingest`, `route-shell.ingest`, and
  `route_shell.route` fail as `unknown_workflow_action`.
- `meeting.dispatch` with `runtime=openclaw_route_shell` records
  `dispatch.rejected` and returns `failureType=route_shell_retired`.
- `runtime.bridge.drain` for legacy queued `openclaw_route_shell` rows marks the
  dispatch `failed` with `failureType=route_shell_retired`; it does not create a
  replacement Hermers dispatch.
- The control-loop default runtime drain list no longer includes
  `openclaw_route_shell`.
- The control-loop runtime auto-discovery path ignores queued
  `openclaw_route_shell` rows instead of creating repeated retired drain jobs.

## Batch G Deletion Follow-Up

Batch G removes the archived `src/route-shell-actions.js` implementation and
the empty route-shell registry wiring from `src/workflow.js`. Route-shell public
actions remain unknown actions, and retired runtime input is still rejected by
`meeting.dispatch` and `runtime.bridge.drain`.

Batch G intentionally keeps shared historical/runtime vocabulary outside the
deleted implementation:

- `openclaw_route_shell` runtime values in historical read models, topology, and
  registry normalization;
- dormant/disabled live registry rows used as migration evidence;
- v2 worker backend rejection for `openclaw_route_shell`;
- route-shell live-state audits and documentation.

## Required Gate

Before deployment:

1. `node scripts/workflow_regression_tests.mjs --grep "route_shell"`
2. `npm run check:freeze`
3. `git diff --check`
4. `npm run check`
5. `npm run smoke:release`
6. independent subagent review of the diff

After deployment:

1. dev-server fast-forward pull from GitHub;
2. server release smoke;
3. OpenClaw plugin registry refresh;
4. workflow status against the live state root;
5. `main` workspace invariant check.
