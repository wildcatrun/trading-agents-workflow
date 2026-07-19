# Workflow P23 Control Loop Legacy Supervise Lane Isolation

Date: 2026-07-19

Status: implemented candidate.

## Decision

P23 isolates the legacy `workflow_supervise` control-loop lane behind an explicit compatibility switch.

This does not delete `workflow.control_loop.tick`, `workflow.advance`, or `workflow.supervise`. The generic control loop remains the shared maintenance executor for schedules, runtime drain, stale dispatch reconcile, message-flow reconcile, Human Gate, outbox, and job repair.

## Compatibility Switch

The legacy supervise lane remains enabled by default for compatibility.

It can be disabled for tests, migration observation, or an explicitly authorized runtime cutover with:

- request input: `legacyWorkflowSuperviseLane: false`;
- request input alias: `legacy_workflow_supervise_lane: false`;
- request input alias: `enableLegacyWorkflowSuperviseLane: false`;
- request input alias: `enable_legacy_workflow_supervise_lane: false`;
- environment: `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_SUPERVISE_LANE=0`.

When disabled:

- `workflow.control_loop.tick` does not seed new `workflow_supervise` jobs from `workflow_runs`;
- existing queued or retryable `workflow_supervise` jobs are not claimed by the tick loop;
- shared maintenance jobs remain seedable and claimable.

## Migration Impact

This is a freeze precondition, not the final freeze.

P23 proves the generic control loop can run shared maintenance without executing the legacy supervise lane. It narrows future retirement work to:

- auditing live `workflow_supervise` jobs and active legacy `workflow_runs`;
- deciding whether legacy task/run rows are archived or reconciled by a separate compatibility command;
- flipping production defaults only after an observation window and Human Gate approval.

## Regression

Coverage added:

- `control_loop legacy supervise lane can be disabled`.

The regression covers two disable paths:

- request-level `legacyWorkflowSuperviseLane: false`;
- env-level `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_SUPERVISE_LANE=0`.

It seeds active legacy workflows, pre-existing high-priority `workflow_supervise`
jobs, a shared runtime-drain candidate, and a due schedule. With the lane
disabled, the tick skips `workflow_supervise`, claims shared `runtime_drain` or
`scheduled_dispatch`, drains the local Codex inbox dispatch, dispatches the due
schedule, and leaves legacy workflow rows unchanged.
