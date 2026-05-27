# Workflow Task Drafting Initial Plan

Created: 2026-05-27

This document records the first design reference for adding a higher-level task
drafting layer to `trading-agents-workflow`. It is based on the current
Claude Code workflow and multi-agent orchestration materials available on
2026-05-27, plus local inspection of the published
`@anthropic-ai/claude-code@2.1.152` package.

This is a preliminary reference, not a final implementation contract. Upgrade
this design after Claude Code publishes complete, stable user documentation for
its Workflow tool and any related `/workflow` or `/workflows` command surface.

## Problem

The current control-plane entry point available to local Codex is mostly a
delivery primitive: `workflow_message_flow_send` creates governed
`message_flow` dispatches, resolves targets through `runtime_agents`, and keeps
trace and receipt evidence.

That primitive is necessary but insufficient for cross-agent workflow tasks.
It does not draft the task package, choose default governance roles, structure
phases, define evidence requirements, create review gates, or enforce Human
Gate readiness. As a result, task quality depends on the caller manually
remembering the cat-system workflow discipline.

Recent example: a cross-agent task for Cat Eyes, Cat Ears, Cat Nose, Cat Heart,
Cat Brain, and Cat Claw initially omitted Cat Claw until corrected manually.
That omission shows the missing layer is not transport. The missing layer is
workflow task drafting and orchestration semantics.

## Reference Sources

Use these sources as design signals, ordered by reliability:

- Official Claude Code changelog, especially 2.1.152, which references the
  Workflow tool progress display and background workflows:
  <https://code.claude.com/docs/en/changelog>
- Official Claude Code parallel-agent documentation, including subagents, agent
  view, agent teams, worktrees, and `/batch`:
  <https://code.claude.com/docs/en/agents>
- Official Claude Code agent teams documentation:
  <https://code.claude.com/docs/en/agent-teams>
- Official Claude Code subagent documentation:
  <https://code.claude.com/docs/en/sub-agents>
- Official Claude Code skills and commands documentation:
  <https://code.claude.com/docs/en/slash-commands>
- Local package inspection of `@anthropic-ai/claude-code@2.1.152`,
  specifically `sdk-tools.d.ts`, which exposes `WorkflowInput` fields such as
  `script`, `name`, `args`, `scriptPath`, and `resumeFromRunId`, and describes
  workflow scripts using `agent()`, `parallel()`, `pipeline()`, and `phase()`.
  This package-visible schema is a strong design signal, but it is not a
  supported public API contract by itself.

Third-party posts, Reddit threads, and binary string inspection are discovery
signals only. They must not be treated as stable public API documentation.

## Caution

Do not state that Claude Code has a stable public `/workflow` slash command
unless official documentation confirms it. Current evidence supports the more
careful statement that Claude Code has a package-visible Workflow tool and
documented related orchestration surfaces such as `/batch`, subagents, agent
teams, and worktrees.

Do not copy Claude Code's private implementation details. The useful pattern is
the architecture: a structured workflow script/spec with metadata, phases,
agent calls, parallel fan-out, cached or resumable nodes, progress visibility,
and explicit review gates.

## Target Capability

Add a high-level workflow task drafting entry point above `message_flow`.
The following names are provisional and should be finalized during schema and
CLI design:

- `workflow_task_create` for general governed workflow tasks.
- `workflow_meeting_task_create` for cross-agent meeting or discussion tasks.

These entry points should create a structured task package, validate governance
defaults, and then use lower-level dispatch primitives to deliver the resulting
instructions.

`workflow_message_flow_send` should remain available for direct governed
message delivery, local Codex inbox handoff, and narrow agent-to-agent notices.
It should not be the normal API for creating cross-agent workflow tasks.

## Default Governance Roles

For cross-agent workflow tasks, the task drafting layer must inject default
roles unless the caller explicitly supplies an approved exception:

- Cat Brain `main`: workflow chair, meeting host, agenda controller, evidence
  organizer, and candidate-plan synthesizer.
- Cat Claw `cat_claw`: secretary, recorder, receipt tracker, evidence auditor,
  Flashcat-facing reporter, and Human Gate submission owner.
- Participating domain agents: responsible for execution, self-check,
  evidence submission, alternatives, and boundary clarification inside their
  registered runtime.
- Consumer or risk agents, when relevant: responsible for stating downstream
  data, quality, timing, and handoff requirements.

The drafting layer should warn or reject when a cross-agent task omits
`main` or `cat_claw` and no explicit exception is recorded.

## Task Spec Shape

A drafted workflow task should persist a structured spec before dispatch. The
initial schema can be JSON-first and later evolve into a script-like DSL if
needed:

```json
{
  "meta": {
    "workflowId": "wf.example",
    "traceId": "trace.example",
    "taskType": "meeting_task",
    "subject": "Short task title",
    "createdAt": "2026-05-27T00:00:00Z",
    "priority": "high",
    "idempotencyKey": "stable-key",
    "chair": "main",
    "secretary": "cat_claw",
    "participants": ["cat_eyes", "cat_ears"],
    "requiresAck": true,
    "returnPolicy": "receipt_required"
  },
  "objective": "Concrete objective and stop condition.",
  "phases": [],
  "qualityGates": [],
  "humanGatePolicy": {},
  "resumePolicy": {}
}
```

The exact table layout can follow current workflow tables, but the persisted
artifact should be human-readable and referenced from dispatch receipts.

## Standard Phases

The initial phase template for cross-agent governance tasks:

1. Scope
   - Confirm task source, timestamp, target outcome, participants, and runtime
     registry rows.
   - Record assumptions and missing context.

2. Evidence Collection
   - Each domain agent lists current facts, files, tables, cron jobs, receipts,
     artifacts, and known failure modes.
   - Claims without evidence are marked as pending verification.

3. Self-Check
   - Each responsible agent states its current responsibility, actual work it
     performs, boundary conflicts, backup owner, and known gaps.

4. Cross-Discussion
   - Cat Brain compares overlaps, contradictions, missing owners, and stale
     assumptions.
   - Agents may challenge or refine each other's claims.

5. Consumer Requirements
   - The primary consumer agent states downstream data, freshness, schema,
     quality, receipt, and incident requirements.

6. Plan Synthesis
   - Cat Brain drafts at least three independently approvable options.
   - Each option includes responsibilities, implementation steps, risks,
     rollback or stop conditions, and required approvals.

7. Cat Claw Audit
   - Cat Claw verifies receipt coverage, evidence paths, action items, decision
     structure, Human Gate readiness, and Chinese report completeness.

8. Human Gate Package
   - If approval is required, Cat Claw submits the Flashcat-facing package with
     independent approve buttons for A/B/C options plus pause and terminate
     buttons.

## Quality Gates

Before a workflow task can advance to Human Gate, the drafting and supervision
layer should require:

- resolved `runtime_agents` rows for all target agents;
- stable `workflowId`, `traceId`, dispatch ids, and idempotency key;
- receipt or explicit missing-receipt incident for each required participant;
- evidence refs for material claims;
- action items with owner, expected artifact, and due condition;
- at least three independently approvable options when Flashcat approval is
  requested;
- Chinese Flashcat-facing text for formal reports and Human Gate submissions;
- pause and terminate paths;
- rollback, stop, or resume boundary;
- Cat Claw audit result before Human Gate delivery.

Quality gate failure should keep the workflow in evidence collection or audit
repair, not produce a partial Human Gate.

## Resume And Idempotency

The task drafting layer should support rerun and resume semantics similar to
the observed Claude Code Workflow tool pattern:

- A task draft has a stable idempotency key derived from source, timestamp,
  subject, and participant set.
- Re-running the same draft should dedupe dispatches or create a clear
  revision, not create competing Human Gate objects.
- Each phase records status, owner, evidence refs, and output artifact refs.
- Completed phases can be reused when inputs are unchanged.
- Editing a phase or participant set should invalidate only affected phases.
- Resume should continue from the latest checkpoint, not replay chat history.

## Specialized Template: Stock Long-Term Tracking Governance

For cron, `market_intelligence.db`, and data supplementation tasks, include a
RACI-oriented appendix in the generated task package:

- asset inventory: database path, tables, fields, generated artifacts, cron
  jobs, source feeds, and data freshness checks;
- owner matrix: responsible, accountable, consulted, informed, and backup
  owner for each asset and action;
- read/write boundary: which agent reads, writes, validates, backfills, and
  reports each table or artifact;
- supplementation triggers: missing data, stale data, schema drift, failed
  cron, market event, consumer request, or incident escalation;
- conflict handling: two agents attempting the same write, inconsistent
  source data, stale receipt, or ambiguous ownership;
- Cat Heart consumer contract: required fields, freshness, quality thresholds,
  missing-data signal, handoff shape, and receipt expectations.

## Implementation Roadmap

Phase 1: Documentation and schema draft

- Record this initial plan.
- Draft JSON schemas for `workflow_task_create` and
  `workflow_meeting_task_create`.
- Define default role injection and rejection/warning behavior.

Phase 2: CLI/MCP surface

- Add read-only dry-run first: generate task spec without dispatch.
- Add mutating create path after tests exist.
- Return the generated spec path, workflow id, dispatch ids, and quality-gate
  status.

Phase 3: Runtime integration

- Route participants through `runtime_agents`.
- Persist task package artifact and dispatch refs.
- Extend supervisor loop to evaluate phase status and Cat Claw audit status.

Phase 4: Human Gate hardening

- Enforce option count, Chinese report text, pause/terminate controls, receipt
  refs, and rollback boundary before submission.
- Preserve the same Human Gate object and button ids for resend behavior.

Phase 5: Claude Code Workflow follow-up

- Revisit this design after Claude Code publishes complete Workflow user
  documentation.
- Compare official script semantics, resume behavior, progress UI, and
  built-in workflow examples.
- Upgrade this plan only through normal Git review, tests, and governance
  record.

## Non-Goals

- Do not run cat-system agent semantics inside local Codex.
- Do not replace `runtime_agents` routing.
- Do not make Cat Claw responsible for inventing option content.
- Do not let task drafting bypass Cat Brain governance, Cat Claw audit, or
  Flashcat Human Gate.
- Do not add a parallel relay or message system outside
  `trading-agents-workflow`.
