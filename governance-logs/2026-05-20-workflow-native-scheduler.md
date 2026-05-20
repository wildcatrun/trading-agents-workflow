# Workflow-Native Scheduler Pilot

- date: 2026-05-20
- scope: trading-agents-workflow scheduler v0.7.0
- commit: ca39ae4 Add workflow-native scheduler
- server checkout: /home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout
- live workflow root: /home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow

## Change

Added workflow-native schedules:

- `workflow_schedules`
- `scheduled_runs`
- `control_loop_jobs.job_type=scheduled_dispatch`

Due schedules create governed `meeting.dispatch` rows with deterministic idempotency keys. Runtime execution remains in the existing `runtime_drain -> Hermers ACP` path. OpenClaw cron is not required for this scheduler path, but remains available as a transition and rollback surface.

## Verification

Local checks:

- `npm run check`: passed
- local temporary scheduler smoke: passed

Server checks:

- `git pull --ff-only`: fast-forwarded to `ca39ae4`
- `npm run check`: passed
- `openclaw config validate`: passed
- temporary server scheduler smoke under `/tmp/taw-workflow-scheduler-smoke-20260520`: passed

Live additive schema state:

- `schema_meta.workflow_schema_version=10`
- `workflow_schedules` exists
- `scheduled_runs` exists
- before pilot: `workflow_schedules=0`, `scheduled_runs=0`, `scheduled_dispatch jobs=0`

## Cat Nose Pilot

One live one-shot pilot schedule was created and then paused:

- schedule_id: `pilot-cat-nose-heartbeat-workflow-20260520T0819`
- source OpenClaw cron: `cat_nose heartbeat`
- source cron id: `83c4259f-a869-47af-9c6c-73edb7b687cb`
- source cron expr: `22,52 * * * *`
- runtime: `hermers`
- agent: `cat_nose`
- dispatch_type: `cron_heartbeat`
- status after pilot: `paused`

Workflow-native pilot dispatch:

- dispatch_id: `dispatch.scheduled_run.pilot-cat-nose-heartbeat-workflow-20260520T0819.2026-05-20T002030306Z`
- created_at: `2026-05-20T00:20:36.754Z`
- sent_at: `2026-05-20T00:20:36.973Z`
- acked_at: `2026-05-20T00:21:26.937Z`
- runtime: `hermers`
- adapter: `acp`
- backend: `acpx`
- status: `acked`
- latency_ms: `49964`

OpenClaw cron comparison dispatch:

- dispatch_id: `dispatch.mpdbhr9w.0a827bbb`
- created_by: `openclaw_route_shell`
- created_at: `2026-05-20T00:22:13.076Z`
- sent_at: `2026-05-20T00:22:16.832Z`
- acked_at: `2026-05-20T00:23:03.809Z`
- runtime: `hermers`
- adapter: `acp`
- backend: `acpx`
- status: `acked`
- latency_ms: `46977`

## Conclusion

The new scheduler path can create durable scheduled runs and dispatch migrated agents to Hermers ACP without relying on route-shell prompt execution. The existing OpenClaw cron path still worked during the comparison window and remains the rollback surface.

Next migration step should be conservative: convert one low-risk heartbeat into a permanent workflow-native schedule, keep the OpenClaw cron disabled but not deleted, and compare receipts for at least one full schedule interval before migrating additional heartbeat or professional cron jobs.
