# Workflow P24 Live Legacy Supervise Audit

Date: 2026-07-19

Status: live audit complete.

## Decision

The dev-server live state is clean for the legacy `workflow_supervise` lane as of `2026-07-19T17:37:28+08:00`.

This audit supports moving the lane to a default-close candidate, but it does not by itself flip the production default. The default remains compatible until an explicit cutover patch and deployment are approved.

## Evidence

Audit artifact:

`/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260719T-p24-live-legacy-supervise-audit`

Key files:

- `precheck.txt`
- `schema-key-tables.txt`
- `live-legacy-supervise-audit.json`
- `log-ref-audit.txt`

Embedded checksum-free summary from the artifact:

```json
{
  "workflowRunsByStatus": [],
  "workflowTasksByStatus": [],
  "workflowSuperviseJobCounts": [],
  "queuedDispatchesByRuntimeType": [],
  "activeSchedules": [],
  "scheduledRunsByStatus": [],
  "controlLoopJobsByTypeStatus": [
    { "jobType": "runtime_drain", "status": "done", "count": 2 }
  ],
  "dispatchesByStatus": [
    { "status": "acked", "count": 514 },
    { "status": "failed", "count": 148 }
  ],
  "v2PlansByStatusState": [
    { "status": "planned", "workflowState": "planned", "count": 1 }
  ],
  "v2WorkerRunsByStatus": []
}
```

Observed live DB:

`/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db`

Repository head on dev-server:

`2aafb2a6f5453606a5015f210afc2a3806705778`

## Findings

Live database findings:

- `workflow_runs`: no rows.
- `workflow_tasks`: no rows.
- `control_loop_jobs` with `job_type='workflow_supervise'`: no rows.
- active legacy candidates from `workflow_runs.status IN ('active','waiting_human','blocked','paused','running')`: no rows.
- open legacy task candidates from `workflow_tasks.status NOT IN ('done','failed','cancelled')`: no rows.
- queued dispatches: no rows.
- active schedules: no rows.

Remaining live maintenance state:

- `control_loop_jobs`: only two `runtime_drain` jobs in `done`.
- `mixed_meeting_dispatches`: historical terminal rows only, `acked=514`, `failed=148`.
- `workflow_v2_plans`: one planned v2 row, `status='planned'`, `workflow_state='planned'`.
- `workflow_v2_worker_runs`: no rows.
- `scheduled_runs`: no rows.

Log findings:

- `bridge/control-loop-events.jsonl` and `bridge/control-loop.jsonl` exist and are current.
- targeted search of workflow state logs found no `workflow_supervise`, `workflow.supervise`, `legacyWorkflowSuperviseLane`, or `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_SUPERVISE_LANE` references.

## Interpretation

No live evidence currently requires the legacy `workflow_supervise` lane to remain enabled on the dev-server workflow state root.

The shared control loop still must remain enabled. P24 does not change the classification of these shared lanes:

- `scheduled_dispatch`;
- `runtime_drain`;
- `stale_dispatch_reconcile`;
- `message_flow_reconcile`;
- `meeting_dispatch_retry`;
- `human_gate_request_ensure`;
- `telegram_outbox_deliver`;
- `human_gate_inbox`;
- job requeue repair.

## Cutover Preconditions

Before flipping the default from compatible-on to default-closed, complete all of:

1. keep P23 regression coverage passing;
2. run one more server release smoke on the cutover patch;
3. deploy by Git fast-forward only;
4. reload Gateway and confirm a single listener;
5. preserve an explicit compatibility override for emergency recovery;
6. record the cutover evidence path.

## Recommended Next Patch

P25 can flip `legacyWorkflowSuperviseLaneEnabled()` default from `true` to `false` while preserving opt-in compatibility through:

- request input: `legacyWorkflowSuperviseLane: true`;
- request input aliases documented in P23;
- env override: `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_SUPERVISE_LANE=1`.

P25 should also add regression proving:

- default tick does not seed or claim `workflow_supervise`;
- explicit opt-in still preserves old compatibility behavior;
- shared `runtime_drain` and `scheduled_dispatch` continue under the new default.
