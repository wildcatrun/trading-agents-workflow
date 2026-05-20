# Companion Stability Plugin Contract

`cat-agents-stability` is the companion governance package for `trading-agents-workflow`.

It improves observability, readiness checks, incident evidence, and guarded low-risk repair around the workflow engine. It does not embed this plugin, replace its scheduler, or become a second workflow state machine.

## Ownership Boundary

`trading-agents-workflow` owns:

- workflow state machines and task progression
- `control_loop_jobs` and the 10s mechanical queue
- dispatch and runtime bridge records
- `message_flow` state
- `telegram_outbox` and delivery receipts
- Human Gate records, buttons, token-bound feedback, and resume payloads
- workflow-native public reconcile and incident actions

`cat-agents-stability` owns:

- stability probes and snapshots
- lane policy, findings, actions, and runbooks
- desired-state registry and drift findings
- OpenClaw, Hermers, Telegram, cron, session, and data freshness observations
- low-risk repair only when policy and risk gates permit

## Evidence Handoff

`cat-agents-stability` writes the latest stability evidence package into this repository:

- `governance-logs/stability-evidence-latest.json`
- `governance-logs/stability-evidence-latest.md`

Cat-brain `main` should read those artifacts during 30min semantic governance checks before deciding whether the workflow has enough evidence to ask Cat Claw for Human Gate submission.

Cat-brain `main` consumes both sets of evidence and remains responsible for semantic incident command and Human Gate escalation judgment.

## Write Contract

The stability plugin may read workflow tables for drift and readiness evidence. It must not directly mutate workflow internals.

Allowed write paths are public workflow actions such as:

- `workflow.dispatch.reconcile`
- `workflow.message_flow.reconcile`
- `incident.state`
- explicitly approved Human Gate or operator actions

Forbidden direct writes include:

- `mixed_meeting_dispatches`
- `message_flows`
- `runtime_runs`
- `control_loop_jobs`
- Human Gate decision records

## Codex Control Plane

Local Mac Codex should load both MCP servers:

- `trading-agents-workflow`
- `cat-agents-stability`

Codex may inspect workflow status, runtime agents, governance logs, stability findings, desired-state drift, and runbooks. Codex remains a control panel and must not become a workflow runtime, agent return inbox, or parallel scheduler.

## Hermers Boundary

Hermers agents can be governed by both packages:

- `trading-agents-workflow` keeps the shared workflow/message-flow contract.
- `cat-agents-stability` checks Hermers profile readiness, ACP quality, runtime receipts, and future IM ownership drift.

The future Hermers IM cutover for migrated agents is a separate migration task. Until explicitly authorized, route-shell records may remain as temporary observations; after cutover, OpenClaw identities for migrated agents should become dormant legacy workspaces rather than fallback route-shells.
