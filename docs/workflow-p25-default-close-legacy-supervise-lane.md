# Workflow P25 Default-Close Legacy Supervise Lane

Date: 2026-07-19

Status: implemented candidate.

## Decision

P25 flips the control-loop `workflow_supervise` legacy lane from compatible-on by default to default-closed.

This does not delete:

- `workflow.control_loop.tick`;
- shared control-loop maintenance lanes;
- `workflow.advance`;
- `workflow.supervise`;
- explicit compatibility override for legacy recovery.

## Runtime Semantics

Default `workflow.control_loop.tick` behavior:

- does not seed `workflow_supervise` jobs from `workflow_runs`;
- does not claim queued or retryable `workflow_supervise` jobs;
- continues shared maintenance lanes such as `scheduled_dispatch`, `runtime_drain`, stale dispatch reconcile, message-flow reconcile, Human Gate, outbox, and job repair.

Opt-in compatibility remains available:

- request input: `legacyWorkflowSuperviseLane: true`;
- request input alias: `legacy_workflow_supervise_lane: true`;
- request input alias: `enableLegacyWorkflowSuperviseLane: true`;
- request input alias: `enable_legacy_workflow_supervise_lane: true`;
- env override: `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_SUPERVISE_LANE=1`.

Default-close can be force-disabled for diagnostics with `false` values on the same inputs/env, but `false` is now the default.

## Preconditions Satisfied

P24 live audit found the dev-server state root clean for this lane:

- no `workflow_runs`;
- no `workflow_tasks`;
- no `workflow_supervise` control-loop jobs;
- no workflow state log references;
- no active schedules;
- no queued dispatches.

P23 had already proved disabled-lane operation does not stop shared `runtime_drain` or `scheduled_dispatch`.

## Regression

Coverage:

- default tick does not seed or claim `workflow_supervise`;
- request-level opt-in preserves legacy `workflow_supervise` targeted drain behavior;
- env-level opt-in preserves legacy `workflow_supervise` job execution;
- env-level disabled mode still allows `scheduled_dispatch`;
- default closed mode still allows shared `runtime_drain`.

## Rollback

Rollback does not require code deletion.

Emergency compatibility options:

1. set request input `legacyWorkflowSuperviseLane: true` for a specific operator tick;
2. set `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_SUPERVISE_LANE=1` in the Gateway environment and reload Gateway;
3. revert the P25 commit if a real live dependency is discovered.

The shared control loop must not be stopped or deleted to roll back this lane.
