# Claude Code Workflow Reference Program

Created: 2026-05-31

This directory is the long-running reference and adaptation program for using
Claude Code Dynamic workflows to improve `trading-agents-workflow`.

The purpose is not to copy Claude Code's implementation. The purpose is to
track public Claude Code workflow behavior over time, extract durable design
patterns, and convert the useful parts into governed, auditable workflow
capabilities suitable for cat-system operations and future live trading.

## Scope

This program has two tracks:

1. Reference track
   - Official Claude Code Dynamic workflows documentation.
   - Claude Code changelog and release notes related to workflows,
     subagents, agent teams, goals, hooks, permissions, observability,
     checkpointing, and background tasks.
   - Public examples of bundled or saved workflows when official docs expose
     them.
   - Versioned observations, with source URL, retrieval date, and stability
     level.

2. Adaptation track
   - `trading-agents-workflow` feature proposals inspired by Claude Code.
   - Implementation steps, schema changes, console changes, and control-loop
     changes.
   - Fit/gap analysis against cat-system boundaries: `runtime_agents`,
     Cat Brain, Cat Claw, Human Gate, receipts, side effects, and
     `trading_core`.
   - Rollout status, review evidence, test requirements, and stop conditions.

## Reading Order

- `reference-index.md`: source catalog and what each Claude Code source is
  allowed to influence.
- `workflow-plan-spec-v2.md`: proposed JSON-first plan artifact contract for
  phase/node orchestration, verification, Human Gate, and resume policy.
- `adaptation-plan.md`: current plan for applying the reference material to
  `trading-agents-workflow`.
- `runtime-observability-improvement-plan-2026-06-03.md`: incident-driven
  plan for closing ACK-only blind spots with runtime semantic events,
  interruption classification, transcript references, current-state projection,
  and Agent View / Workflow Trace surfaces.
- `development-summary-2026-05-31.md`: implementation summary for the first
  P0.1-P0.9 development batch and the P1.1 verification continuation.
- `development-log-2026-05-31-p0.1-p0.9.md`: detailed development log,
  quality gates, plan-alignment review, and remaining gaps.
- `development-log-2026-05-31-p1.1-verification.md`: detailed development log
  for verifier/refuter acceptance evidence records.
- `development-log-2026-05-31-p1.2-evaluator.md`: detailed development log for
  deterministic workflow evaluator evidence.
- `development-log-2026-05-31-p1.3-permission-policy.md`: detailed
  development log for permission policy outcomes.
- `development-log-2026-05-31-p1.3a-hard-gates.md`: detailed development log
  for controlled hard enforcement on `trade.intent` and
  `trading_core.receipt`.
- `development-log-2026-05-31-p1.4-intervention-execution.md`: detailed
  development log for governed pause/resume/stop execution.
- `development-log-2026-05-31-p1.5-dead-letter-observability.md`: detailed
  development log for dead-letter and stuck attention observability.
- `development-log-2026-06-02-openclaw-stable-upgrade.md`: OpenClaw stable
  upgrade impact audit, stabilityd/workflow compatibility notes, and upgrade
  smoke checklist.
- `update-log.md`: dated changes to the reference set and adaptation plan.

## Operating Rules

- Prefer official Anthropic / Claude Code documentation and changelog entries.
- Record source date and retrieval date. Claude Code workflows are evolving, so
  stale observations must not become permanent policy without re-checking.
- Treat package-visible or reverse-engineered behavior as a discovery signal
  only unless official docs confirm it.
- Do not import Claude Code's safety model blindly. `trading-agents-workflow`
  operates in a trading and operations environment, so Human Gate, receipts,
  side-effect ledger, idempotency, and rollback boundaries remain stricter than
  general coding workflows.
- Do not add a second workflow console. Adapt UI and intervention behavior in
  the existing workflow console.
- Do not execute arbitrary workflow JavaScript in the cat-system control plane.
  The preferred adaptation form is JSON-first plan specs, durable DB state,
  explicit events, artifacts, and controlled runtime adapters.

## Current Position

As of 2026-05-31, Claude Code Dynamic workflows should guide these priorities:

- externalize orchestration into a readable, reusable plan artifact;
- make phase/node/agent-run/receipt/operation state first-class;
- make verification independent from execution;
- expose operator progress, drilldown, pause/stop/rerun previews, and evidence
  export in the existing console;
- keep human approval at stage boundaries rather than mid-run natural-language
  interruptions;
- keep every high-impact trading, deployment, database, Gateway, credential,
  or live-execution action behind policy gates and Human Gate.

As of 2026-06-03, the `trading_sim` production disk-full incident added one
more priority: runtime progress must be semantically observable after ACK. A
workflow must distinguish mechanical ACK from semantic ACK, expose active agent
stage, classify interruptions from later messages, and bind artifacts and
transcript refs to dispatch evidence.
