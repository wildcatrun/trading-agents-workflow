# Reference Index

Created: 2026-05-31
Last reviewed: 2026-05-31

This file tracks Claude Code workflow-related public references. Update it when
Claude Code publishes new workflow documentation, release notes, bundled
workflow examples, API references, or observability/control-plane behavior.

## Source Stability Levels

- `official-contract`: official docs that describe supported user behavior.
- `official-preview`: official docs for research preview or experimental
  features. Useful, but must be re-checked before hard policy.
- `official-context`: official docs for adjacent primitives such as subagents,
  hooks, goals, permissions, observability, and agent teams.
- `discovery-only`: package-visible, local inspection, third-party posts, or
  non-official examples. Never treat as a stable contract by itself.

## Official References

### Dynamic Workflows

- URL: https://code.claude.com/docs/en/workflows
- Stability: `official-preview`
- Reviewed: 2026-05-31
- Key observations:
  - Dynamic workflows orchestrate many subagents from a JavaScript script that
    Claude writes and the runtime executes in the background.
  - The script holds loops, branches, and intermediate results instead of
    storing every intermediate result in the main conversation context.
  - Workflow progress can be observed through `/workflows`.
  - The progress view exposes phases, agent counts, token totals, elapsed time,
    agent drilldown, prompts, recent tool calls, and results.
  - Operators can pause/resume, stop a selected agent or whole workflow,
    restart a selected running agent, and save a run's script as a command.
  - Workflows have limits: no mid-run user input except permission prompts,
    bounded concurrency, and bounded total agents per run.
- Adaptation permission:
  - Use as the primary reference for phase-first progress, reusable plan
    artifacts, resumable orchestration, and operator intervention patterns.
  - Do not copy arbitrary JavaScript execution into `trading-agents-workflow`.

### Claude Code Changelog

- URL: https://code.claude.com/docs/en/changelog
- Stability: `official-contract` for release facts, `official-preview` for
  preview features.
- Reviewed: 2026-05-31
- Key observations:
  - Claude Code 2.1.154 introduced Dynamic workflows publicly as a research
    preview.
- Adaptation permission:
  - Use for version-gated tracking and update reviews.

### Subagents

- URL: https://code.claude.com/docs/en/sub-agents
- Stability: `official-context`
- Reviewed: 2026-05-31
- Key observations:
  - Subagents preserve context by isolating exploration or implementation from
    the main conversation.
  - Subagents can be specialized with descriptions, prompts, model choices,
    tool limits, permission modes, hooks, skills, MCP servers, and memory.
  - Claude decides when to delegate based on the subagent description.
- Adaptation permission:
  - Use for role definition, scoped tool access, verifier/refuter nodes, and
    cost-aware agent selection.

### Agent Teams

- URL: https://code.claude.com/docs/en/agent-teams
- Stability: `official-context` / experimental.
- Reviewed: 2026-05-31
- Key observations:
  - A lead coordinates teammates, shared tasks, direct teammate messaging, task
    assignment, and result synthesis.
  - Best use cases include parallel research, review, competing hypotheses, and
    cross-layer ownership.
- Adaptation permission:
  - Use for fan-out/fan-in, reducer tasks, conflict surfacing, and parallel
    review design.
  - Do not let parallel workers bypass `runtime_agents` or Human Gate.

### Goals

- URL: https://code.claude.com/docs/en/goal
- Stability: `official-context`
- Reviewed: 2026-05-31
- Key observations:
  - `/goal` keeps Claude working until a completion condition is met.
  - A separate lightweight evaluator checks completion after each turn.
- Adaptation permission:
  - Use for workflow-level acceptance evaluators that are independent from the
    executing agent.

### Hooks

- URL: https://code.claude.com/docs/en/hooks-guide
- Stability: `official-context`
- Reviewed: 2026-05-31
- Key observations:
  - Hooks provide deterministic lifecycle control for notifications,
    formatting, protected-file blocks, context reinjection, config audit, and
    permission automation.
  - Hook outcomes can be deterministic, prompt-based, agent-based, HTTP-based,
    or MCP-related depending on configuration.
- Adaptation permission:
  - Use for policy gates, high-risk action blocking, structured validation, and
    lifecycle event design.

### Permissions

- URL: https://code.claude.com/docs/en/permissions
- Stability: `official-context`
- Reviewed: 2026-05-31
- Key observations:
  - Claude Code separates allow, ask, and deny behavior.
  - Long-running workflow agents inherit allowlists, while some tool calls can
    still prompt depending on permission mode.
- Adaptation permission:
  - Use for `workflow.permission.check` and action risk tiers.
  - Do not adopt auto-approval for trading, deployment, database, Gateway,
    credential, or live-execution actions.

### Observability

- URL: https://code.claude.com/docs/en/agent-sdk/observability
- Stability: `official-context`
- Reviewed: 2026-05-31
- Key observations:
  - Claude Code can export traces, metrics, and events through OpenTelemetry.
  - Useful dimensions include model request latency, tool execution, token
    counters, cost counters, and failures.
- Adaptation permission:
  - Use for `workflow_tool_calls`, agent-run spans, cost/tokens, latency,
    failure location, and SLI dashboards.

## Discovery-Only References

### Local package or binary inspection

- Stability: `discovery-only`
- Rule:
  - May suggest design questions to verify later.
  - Must not be used as a stable API or product contract unless official docs
    publish the behavior.

## Watch List

Re-check the official docs when any of these appear:

- stable workflow API or DSL documentation;
- bundled workflow examples beyond `/deep-research`;
- persistent resume across sessions;
- exported run artifacts or script format;
- workflow permission and approval changes;
- workflow observability schema;
- workflow cost/token reporting changes;
- saved workflow command storage semantics;
- agent restart/stop behavior details.

