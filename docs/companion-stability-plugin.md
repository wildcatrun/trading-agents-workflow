# Companion Stability Plugin Contract

`cat-agents-stability` is the companion governance package for `trading-agents-workflow`.

It improves observability, readiness checks, incident evidence, and governed repair coordination around the workflow engine. It does not embed this plugin, replace its scheduler, or become a second workflow state machine.

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
- OpenClaw, Hermers, Telegram, cron, session, and data freshness observations derived from global registry targets
- structured repair candidates and authority requirements for Cat Brain governance

## Evidence Handoff

`cat-agents-stability` writes the latest stability evidence package into this repository:

- `governance-logs/stability-evidence-latest.json`
- `governance-logs/stability-evidence-latest.md`

Cat-brain `main` should read those artifacts during 30min semantic governance checks before deciding whether the workflow has enough evidence to ask Cat Claw for Human Gate submission.

Cat-brain `main` consumes both sets of evidence and remains responsible for semantic incident command, runtime-level repair coordination, and Human Gate escalation judgment.

Direct stabilityd mutation is policy-gated, not removed. If stabilityd observes light cron/session/channel/Hermers pressure, it can expose repair candidates for Cat Brain governance. If mechanical pressure threatens runtime availability, `cat-agents-stabilityd.service` is the external repair layer and may execute controlled cron stale/lease repair, eligible session reset, orphan ACP worker reap, managed profile hibernate/start, and Gateway restarts. These actions must resolve scope through `runtime_agents`, protect `main`, `cat_heart/catheart`, and `cat_claw`, write action/rollback evidence, and obey cooldown/restart-storm gates where applicable. Cat Brain remains responsible for semantic incident command, Human Gate escalation, and post-repair interpretation.

Operator judgment warning: the stabilityd boundary must not be reduced merely because the system has been quiet for a long time. On 2026-05-23 Flashcat explicitly corrected a mistaken approval to remove core stabilityd governance after recognizing that stabilityd's long-running effectiveness had hidden the original failure mode. Workflow, Cat Brain, and runtime agents cannot be the only fallback when the runtime layer is already under mechanical pressure.

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

Hermers agents are governed through the same global registry contract as every other cat-system member:

- `trading-agents-workflow.runtime_agents` defines identity, platform, adapters, dispatch eligibility, endpoint reference, and ownership.
- `trading-agents-workflow` keeps the shared workflow/message-flow contract and durable dispatch/receipt ledger.
- `cat-agents-stability` checks Hermers profile readiness, ACP quality, runtime receipts, and future IM ownership drift only after resolving the member through `runtime_agents`.

Hermers profile lists, OpenClaw agent lists, Codex sessions, and systemd units are platform adapter evidence. They must not become independent cat-system registries, protection policies, or lifecycle sources of truth.

The future Hermers IM cutover for migrated agents is a separate migration task. Until explicitly authorized, route-shell records may remain as temporary observations; after cutover, OpenClaw identities for migrated agents should become dormant legacy workspaces rather than fallback route-shells.
