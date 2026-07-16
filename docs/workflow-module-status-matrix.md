# Workflow Module Status Matrix

Status: active release hygiene document  
Created: 2026-07-15  
Current release: `v0.8.2-rc.1`

## Matrix

| Module / capability | Status | Default | Notes |
| --- | --- | --- | --- |
| Package release version | `v0.8.2-rc.1` | active | This is the only external release version. |
| Workflow v1 compatibility | frozen compatibility | gated | Legacy mutating entry points are not extension targets; keep only short-term escape hatches and read/history surfaces while v2 replacements take over. |
| P7 legacy freeze pool | active retirement batch | gated | Batch ledger is `docs/workflow-freeze-pool-p7.md`; includes P6 task-launch plus run/task/swarm frozen candidates and excludes unproven shared/must-migrate surfaces. |
| Legacy/deprecated usage telemetry | active migration evidence | on | Audited mutating legacy/deprecated action usage records `workflow.action_migration_telemetry` events without enabling legacy behavior or mutating read/preview paths. |
| Legacy mutating MCP discovery | removed in P8 | off | Local MCP no longer exposes legacy task-launch mutating tools or their temporary discovery escape hatch; `workflow_task_launch_list` remains as a read/history surface. |
| Workflow v2 preview/read-only actions | release candidate | on | Preview, validate, catalog, audit preview, and readiness surfaces are available. |
| Workflow v2 plan/template record actions | governed candidate | gated | Writes require normal workflow policy and approved context. |
| Workflow v2 non-trading rehearsal | release candidate | on for smoke | Smoke only; no real Telegram/Docker/model/trading side effects. |
| Workflow v2 paper pre-execution | release candidate | on for smoke | Paper-only guardrail and `trading_core` contract checks. |
| Workflow v2 real worker wrappers | contract only | off | Wrapper contract/execute guard exists; real execution remains unavailable. |
| Workflow v2 adapter drain service | plan/one-shot only | off as service | Service plan and guarded one-shot runner exist; no long-running service installed by this release. |
| Live Telegram delivery from v2 rehearsal | gated | off | Requires separate authorization and delivery gate. |
| Live trading / broker order placement | disabled | off | Must remain behind `trading_core`, Human Gate, and production release governance. |
| Production migration | not included | off | No production server deploy or DB migration in this release. |

## Release Language Rule

Do not describe Workflow v1 or Workflow v2 as separate package releases. Use one package version and describe module status inside that release.

Correct:

```text
trading-agents-workflow v0.8.2-rc.1 includes Workflow v2 governed orchestration candidate surfaces.
```

Incorrect:

```text
Workflow v2 version was released separately from v1.
```
