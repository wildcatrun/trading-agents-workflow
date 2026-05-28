# Gateway Memory and Control Loop Incident 2026-05-28

This note records the 2026-05-28 development-server investigation and fix for
OpenClaw Gateway memory pressure that was amplified by workflow control-loop
behavior.

## Summary

After the development server reboot, `openclaw-gateway.service` appeared to
grow from about 1 GiB to more than 4 GiB in cgroup memory. Process-level checks
showed this was not purely Node heap growth:

- cgroup `MemoryCurrent` reached about 4.6 GiB;
- Node `VmRSS` stayed around 0.9 GiB;
- `RssAnon` was about 0.86 GiB;
- cgroup `file` / `inactive_file` accounted for more than 3 GiB.

The immediate cgroup number was mostly reclaimable file cache, but the
investigation found a real workflow load problem: the plugin control loop was
configured at `tickMs=10000` and repeatedly created `workflow_supervise` jobs
for one `blocked` workflow:

`cat-brain-governance-4h-20260528T1200`

Each job completed quickly, so the active-job dedupe index no longer applied on
the next tick. The next 10 second tick re-seeded the same blocked workflow. This
caused avoidable SQLite reads/writes, worker process launches, logs, and file
cache churn inside the Gateway service cgroup.

## Root Cause

The control-loop dedupe rule only prevented duplicate active jobs:

- `queued`
- `running`
- `retry_scheduled`

It did not rate-limit recently completed jobs. For idle semantic states such as
`blocked` and `waiting_human`, that meant the same workflow could be supervised
every tick even when there was no new evidence or runnable work.

The server config also still had old values:

- `controlLoop.tickMs=10000`
- `controlLoop.timeoutSeconds=90`

Those values contradicted the intended 30 second ACK/control-loop operating
discipline.

## Fix

Commits:

- `7ffb932 Throttle idle workflow supervision`
- `dc4f04e Allow workflow supervise cooldown config`

Code changes:

- added completed-job cooldown support to `enqueueControlLoopJob`;
- added `controlLoopWorkflowSuperviseCooldownMs`;
- applied a default 5 minute cooldown to non-flash `blocked` and
  `waiting_human` workflow supervision;
- kept general `active` workflow supervision uncapped by default;
- kept `flashLane` workflows out of this idle cooldown;
- exposed config keys through `index.js`, CLI, and `openclaw.plugin.json`:
  - `workflowSuperviseCooldownMs`
  - `idleWorkflowSuperviseCooldownMs`
  - `blockedWorkflowSuperviseCooldownMs`

Development-server config after the fix:

```json
{
  "tickMs": 30000,
  "timeoutSeconds": 30,
  "idleWorkflowSuperviseCooldownMs": 300000,
  "workflowSuperviseCooldownMs": 0,
  "jobLeaseMs": 180000
}
```

Config backup before mutation:

`/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260528T2145-workflow-control-loop-throttle/backups/openclaw.json.before-control-loop-throttle`

## Verification

Local regression suite:

```bash
node scripts/workflow_regression_tests.mjs
```

New coverage:

- `control_loop blocked workflow supervise cooldown`

Deployment verification:

- development-server active checkout aligned to
  `dc4f04eeab555fc29401613855da2e000cc06265`;
- `openclaw config validate` passed;
- `openclaw-gateway.service` was restarted after config validation;
- Gateway log after restart showed:

```text
[trading-agents-workflow] control loop enabled tickMs=30000 workerMode=process jobLimit=4
```

Post-restart control-loop evidence:

- ticks ran every 30 seconds;
- the blocked workflow produced `seededJobs` with `reason="cooldown"`;
- `claimedJobs` stayed empty for that workflow during cooldown;
- no new `workflow_supervise` rows were inserted after restart for the blocked
  workflow during the observed window.

Post-restart memory sample:

- `MemoryCurrent` about 752 MiB;
- Node `VmRSS` about 726 MiB;
- cgroup `file` about 66 MiB.

## Future Maintenance Rules

When investigating Gateway memory pressure, do not rely on cgroup
`MemoryCurrent` alone. Always split the evidence:

```bash
systemctl show openclaw-gateway.service -p MainPID -p MemoryCurrent -p MemoryPeak
cat /proc/<pid>/status | grep -E '^(VmRSS|RssAnon|RssFile|VmData|Threads):'
cat /proc/<pid>/smaps_rollup | grep -E '^(Rss|Pss|Anonymous|Private_Dirty|Shared_Clean|Swap):'
grep -E '^(anon|file|inactive_file|active_file|slab|kernel|pagetables|swap) ' /sys/fs/cgroup/system.slice/openclaw-gateway.service/memory.stat
```

Interpretation:

- rising `RssAnon` / Node heap indicates process memory pressure;
- rising cgroup `file` / `inactive_file` indicates file-cache pressure;
- both can matter operationally, but they have different fixes.

For workflow load, check:

```bash
sqlite3 tracking.db "select job_type,status,count(*),min(created_at),max(updated_at) from control_loop_jobs group by job_type,status;"
sqlite3 tracking.db "select workflow_id,count(*),min(created_at),max(updated_at) from control_loop_jobs where job_type='workflow_supervise' group by workflow_id order by count(*) desc limit 20;"
tail -n 20 bridge/control-loop.jsonl
tail -n 40 bridge/control-loop-events.jsonl
```

Operational expectations:

- the plugin control loop should normally run at 30 seconds;
- ACK/runtime timeout should normally be 30 seconds unless a specific workflow
  justifies a reviewed exception;
- `blocked` and `waiting_human` workflows should not be supervised on every
  tick without new evidence;
- completed-job cooldown is a load-shedding guard, not semantic approval;
- `flashLane` can bypass idle cooldown but must still obey Human Gate,
  risk, receipt, idempotency, and expiry rules.

Do not restart Gateway just because cgroup memory is high. First determine
whether the pressure is Node anonymous memory, file cache, repeated workflow
jobs, Telegram/channel retry storms, or another runtime issue. Gateway restart
remains a high-impact action and should follow config validation and rollback
backup discipline.
