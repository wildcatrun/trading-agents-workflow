# Workflow P22 Supervisor Report Parity

Date: 2026-07-19

Status: implemented candidate.

## Decision

P22 adds `workflow.supervisor.report.preview` and `workflow.supervisor.report` for v2 plans whose readiness decision is `blocked` or `human_gate_pending`.

This does not change `workflow.supervisor.closeout`: closeout remains the completed-plan executor for `cat_claw_summary_required`.

## Boundary

`workflow.supervisor.report` is checkpoint-gated. It refuses to run unless `workflow.supervisor.checkpoint` has already written a matching v2 checkpoint boundary for the same `workflowId`, `planId`, and readiness decision.

The write action only:

- writes a report JSON artifact under `workflows/reports/`;
- records `artifact_index`;
- records a `protocol_objects` row with `object_type='workflow_supervisor_report_record'`;
- appends `workflow.supervisor.report.recorded`;
- queues one idempotent Cat Claw dispatch through `meeting.dispatch`.

It does not:

- mutate `workflow_runs` or `workflow_tasks`;
- update v2 plan/node state;
- write a checkpoint;
- request Human Gate directly;
- send Telegram directly;
- drain runtime.

## Dispatch Semantics

- `human_gate_pending` dispatch type: `human_gate_report`.
- `blocked` dispatch type: `workflow_secretary_report`.
- Target is fixed to `openclaw:cat_claw`.
- Caller-supplied `reportAgent`, `reportRuntime`, and `reportId` cannot redirect the report target or tamper with the server-derived report id.

## Migration Impact

P22 replaces the blocked / Human Gate pending Cat Claw report gap that remained after P19/P20/P21.

Remaining `workflow.advance` / `workflow.supervise` legacy blockers are now narrower:

- legacy terminal dispatch sync into `workflow_tasks`;
- legacy ready-task auto-dispatch and task/run mutation;
- legacy supervisor compatibility shell / direct operator path.

`runtime.bridge.drain`, `meeting.dispatch`, `message_flow`, Human Gate, and runtime registry remain shared substrate.

## P23 Follow-Up

P23 adds an explicit control-loop compatibility switch for the legacy
`workflow_supervise` lane. With the switch disabled, `workflow.control_loop.tick`
does not seed or claim `workflow_supervise` jobs, while shared maintenance lanes
continue to run. This is an isolation proof only; defaults remain compatible
until live legacy rows/jobs are audited and cutover is authorized.
