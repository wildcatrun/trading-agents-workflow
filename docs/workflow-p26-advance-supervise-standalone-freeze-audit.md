# Workflow P26 Advance/Supervise Standalone Freeze Audit

Date: 2026-07-19

Scope: standalone mutating legacy actions `workflow.advance`, `workflow.supervise`, and alias `workflow.supervisor`.

## Decision

P26 freezes the standalone mutating legacy executor entry points as `frozen_compatibility`.

This does not delete the implementation modules. The handlers remain as a short-term compatibility escape hatch behind the existing strict boolean environment gate. Recommended operator spelling is:

- `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1`

The parser also accepts other explicit true boolean values such as `true`, `yes`, `y`, and `on`; arbitrary strings such as `enabled` do not bypass the gate.

The default operator/API/Gateway path remains blocked with `legacy_action_disabled`.

## Evidence

P24/P25 already removed the automatic control-loop dependency from the default path:

- no live `workflow_runs` rows on dev-server;
- no live `workflow_tasks` rows on dev-server;
- no live `workflow_supervise` control-loop jobs;
- `workflow.control_loop.tick` no longer seeds or claims `workflow_supervise` by default.

P26 live audit repeated the standalone-action readiness check on dev-server:

- artifact: `/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260719T-p26-advance-supervise-live-audit`;
- `workflow_runs = 0`;
- `workflow_tasks = 0`;
- `workflow_supervise_jobs = 0`;
- no recent live-state `workflow.action_migration_telemetry` rows for `workflow.advance` or `workflow.supervise` in the dev-server database before this freeze. P26 regression tests intentionally create telemetry in isolated temporary roots to prove blocked frozen actions remain observable.

## Frozen Code Blocks

| Code block | Freeze reason | V2/shared replacement | P26 status |
| --- | --- | --- | --- |
| `workflow.advance` | No live legacy rows/tasks/jobs require default execution; direct legacy task/run progression conflicts with v2 plan/node/worker state. | v2 readiness/next-actions previews for planning; shared dispatch reconcile and control-loop maintenance for mechanical recovery. | `frozen_compatibility`, default blocked. |
| `workflow.supervise` | Default control-loop usage was isolated and closed; v2 has closeout/report/checkpoint-adjacent replacements for v2 rows, and no live legacy rows remain. | `workflow.supervisor.readiness.preview`, `workflow.supervisor.next_actions.preview`, `workflow.supervisor.closeout`, `workflow.supervisor.report`, shared control-loop maintenance lanes. | `frozen_compatibility`, default blocked. |
| `workflow.supervisor` | Alias of `workflow.supervise`; no independent capability. | Same as `workflow.supervise`. | `frozen_compatibility`, default blocked. |

## What Remains Intentionally Unfrozen

- `workflow.advance.preview` and `workflow.supervise.preview` remain read-only compatibility diagnostics for archived legacy rows.
- `workflow.control_loop.tick` remains shared infrastructure for schedule dispatch, runtime drain, stale dispatch, message-flow reconcile, Human Gate, outbox, and repair jobs.
- `runtime.bridge.drain`, `meeting.dispatch`, and `message_flow` remain shared substrates, not v1-only code.
- `workflow.checkpoint` is not frozen by P26 because legacy compatibility handlers can still call it under the explicit escape hatch; v2 checkpoint parity is tracked separately.

## Rollback

If a real legacy row dependency is discovered before final removal:

1. set `TRADING_AGENTS_WORKFLOW_ENABLE_LEGACY_ACTIONS=1` only for the operator/runtime that must execute the legacy action;
2. run the exact `workflow.advance` / `workflow.supervise` action against the identified legacy workflow id;
3. capture dispatch, receipt, task/run state, and event evidence;
4. remove the env override after the compatibility operation;
5. update the freeze table with the dependency found.

Do not re-open these actions by default and do not re-enable `workflow_supervise` control-loop seeding unless the live dependency specifically requires that lane.

## Quality Gate Requirements

P26 changes are valid only if the following pass:

- default calls to `workflow.advance`, `workflow.supervise`, and `workflow.supervisor` return `legacy_action_disabled`;
- non-strict env values such as `enabled` do not bypass the gate;
- strict env value `1` reaches the compatibility handler;
- `workflow.control_loop.tick` shared lanes still pass P25 regressions;
- `npm run check:freeze`, targeted regression, full regression, release smoke, and independent review pass before deployment.
