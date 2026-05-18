# Plan C Context Resolution Gap

- timestamp: 2026-05-18T16:00:00+08:00
- workflow_id: hermes-cron-migration-20260518
- affected_agent: cat_claw
- status: patched

## Observation

Flashcat told Cat Claw to continue `Plan C`. Cat Claw first inferred the phrase from the most recent governance-gap discussion, then corrected itself only after Flashcat pointed back to the earlier Hermes cron/heartbeat migration conclusion.

## Correct Context

In `hermes-cron-migration-20260518`, the canonical `Plan C` means:

- migrate the six heartbeats and professional cognitive cron boundary from the prior plan;
- include Realtime/Data bridge-systemd conversion planning in the same wave;
- remain in governance, dry-run manifest, evidence, risk-gate, and Human Gate preparation mode;
- do not disable OpenClaw cron, apply Hermes as primary, edit Gateway config, create or modify systemd units, restart Gateway, delete evidence, or perform trading-side effects without a new Human Gate.

Canonical artifact:

`artifacts/hermes-cron-migration-20260518/plan-c-next-round-tasks.md`

## Fix

`trading-agents-workflow` now has durable workflow context aliases:

- `workflow.alias.upsert` records shorthand such as `Plan C`, `方案C`, and `C方案`.
- `workflow.context.resolve` resolves a user reference before an agent acts on it.
- `human_gate.resume` injects the resolved context into the Cat Brain resume dispatch prompt and payload.

Agents must resolve shorthand through the plugin before continuing workflow execution.
