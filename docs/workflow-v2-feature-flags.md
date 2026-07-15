# Workflow v2 Feature Flags

Status: proposed flag contract  
Created: 2026-07-15  
Related: `docs/workflow-v1-v2-refactor-migration-plan.md`

## Purpose

Workflow v2 dangerous paths must fail closed in code. Documentation is not enough. This file defines the flag contract to implement before real worker execution, live delivery, v2 default routing, or live trading can be enabled.

## Existing Relevant Gates

| Gate | Implementation status | Current purpose |
| --- | --- | --- |
| `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS` | implemented | Allows legacy mutating workflow actions that are blocked by default. |
| `TRADING_AGENTS_WORKFLOW_ENABLE_GENERIC_ORCHESTRATION` | implemented | Allows generic v2 orchestration write actions. |
| `TRADING_AGENTS_WORKFLOW_V2_ALLOW_INTERNAL_FIXTURE_RUNNER` | implemented | Allows built-in local runner fixtures for tests only. |
| `TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE` | implemented | Required by execute guard for real runner execution attempts. |
| `TRADING_AGENTS_WORKFLOW_V2_REAL_RUNNER_EXECUTE_AUTH_JSON` | implemented | Human Gate authorization JSON input for execute guard. |
| `TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_SERVICE_EXECUTE` | implemented | Allows one-shot adapter runner service execution mode. |

## Proposed New Flags

| Flag | Implementation status | Default | Scope | Required before |
| --- | --- | --- | --- | --- |
| `TRADING_AGENTS_WORKFLOW_V2_ENABLED` | proposed | `1` | Allows v2 preview/rehearsal surfaces. | Keeping v2 visible as module. |
| `TRADING_AGENTS_WORKFLOW_V2_DEFAULT_KERNEL` | proposed | `0` | Routes new governed workflow starts to v2 by default. | `v1.0.0-rc.1` cutover. |
| `TRADING_AGENTS_WORKFLOW_V2_REAL_WORKERS_ENABLED` | proposed | `0` | Allows real worker wrappers to start runtime sessions. | Hermers/Claude Code wrapper rollout. |
| `TRADING_AGENTS_WORKFLOW_V2_LIVE_DELIVERY_ENABLED` | proposed | `0` | Allows v2 paths to execute live Telegram/OpenClaw delivery beyond smoke gates. | Human Gate/outbox production rollout. |
| `TRADING_AGENTS_WORKFLOW_V2_LIVE_TRADING_ENABLED` | proposed | `0` | Allows any v2-originated live trading handoff path. | Separate production trading release. |
| `TRADING_AGENTS_WORKFLOW_V2_SCHEMA_MIGRATION_ENABLED` | proposed | `0` | Allows production schema/data migrations. | Any migration touching persistent production DB. |

## Rules

- Flags must be checked at the narrowest dangerous action boundary.
- `*_ENABLED=1` is not sufficient for side effects that also require Human Gate or authorization JSON.
- Live trading requires both v2 flag gates and `trading_core` production gates.
- Preview/read-only actions must not depend on live flags.
- Smoke fixtures must use separate fixture-only gates, never production gates.
