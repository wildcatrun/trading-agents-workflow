# Workflow v2 Worker Lifecycle And Renewal

Status: design draft, not runtime code
Created: 2026-07-03
Scope: worker lifecycle, context renewal, and review hierarchy for workflow v2

## Purpose

Worker spawning alone is not advanced orchestration. A useful workflow kernel
must treat worker context as a finite execution resource. Long-running workers
can become less reliable when their context grows, when summaries are repeatedly
compressed, when stale assumptions accumulate, or when the runtime drifts from
the original task boundary.

The v2 worker lifecycle therefore needs a renewal mechanism:

- detect context pressure and quality decay;
- retire or supersede a worker before it becomes unreliable;
- generate a bounded handoff package;
- spawn a same-class successor worker from the session repository;
- inject curated context, artifact refs, manager critique, and unresolved work;
- preserve worker lineage so managers and governors can audit the chain.

This document defines that contract. It does not create runtime workers,
Docker containers, Hermers sessions, Claude Code sessions, or database
migrations.

## Anthropic Reference Position

The design should use Anthropic's agent engineering guidance as a first-class
reference, not as background reading.

Key reference points:

- Anthropic's "Building effective agents" separates workflows from agents and
  names the main production patterns: prompt chaining, routing, parallelization,
  orchestrator-workers, evaluator-optimizer, and autonomous agents.
- The same post recommends simple, composable patterns, visible planning,
  clear tool interfaces, stopping conditions, sandbox testing, and human review
  for broader system requirements.
- Anthropic's multi-agent Research system uses a lead agent that plans,
  spawns parallel subagents, receives compressed results, synthesizes them, and
  decides whether more research is needed.
- That system treats separate subagent context windows as a way to scale
  reasoning and compression, but warns that multi-agent systems are expensive
  and are best for tasks with enough independent breadth to justify the cost.
- The Research architecture saves plans to memory because long contexts can be
  truncated, and it recommends persisting subagent outputs to filesystem or
  artifact systems while passing lightweight references back to the coordinator.
- Claude Code subagents provide isolated contexts, delegated task boundaries,
  nested subagent trees, and summaries that return to the parent context.

References:

- https://www.anthropic.com/engineering/building-effective-agents
- https://www.anthropic.com/engineering/multi-agent-research-system
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/common-workflows

## Design Principles

1. Use workers to buy isolated context and specialized tool execution, not to
   create uncontrolled conversation branches.
2. Keep each worker task bounded with a clear objective, output schema, allowed
   tools, artifact contract, and stop condition.
3. Treat the first context compaction as a renewal signal, not as free infinite
   memory.
4. Persist outputs, evidence, plans, and summaries outside the worker chat
   context before spawning successors.
5. Pass pointers and curated summaries to managers, not raw transcript dumps.
6. Spawn successor workers from the same worker class when continuity is needed,
   but do not pretend the successor is the same execution identity.
7. Let managers own acceptance decisions; workers can self-check, but they
   cannot accept their own output.
8. Use Cat Brain for semantic workflow governance, not only format checking.
9. Use Cat Claw for secretary audit and Human Gate packaging, with authority to
   block unsupported, contradictory, or unsafe packages.

## Lifecycle States

The worker run lifecycle should include the current execution states plus
renewal states:

- `queued`: worker run exists but has not been dispatched.
- `retry_scheduled`: retry is scheduled after a bounded failure or timeout.
- `dispatched`: runtime dispatch was requested.
- `running`: runtime has started work.
- `succeeded`: runtime produced output and receipts.
- `submitted_for_review`: output awaits responsible owner or manager review.
- `revise_required`: responsible owner or manager requested bounded correction.
- `handoff_required`: worker should stop and create a handoff package.
- `retiring`: worker is producing or finalizing its handoff package.
- `retired`: worker is intentionally closed after handoff or cancellation.
- `superseded`: another worker run replaces this worker's execution branch.
- `successor_spawned`: a successor worker run has been created from this run.
- `blocked`: worker cannot proceed without responsible owner/manager, Cat Brain,
  or human input.
- `needs_human_gate`: worker, owner, or manager identified a gated decision.
- `failed`: worker ended unsuccessfully.
- `timed_out`: worker exceeded its lease or runtime timeout.
- `cancelled`: responsible owner, manager, or workflow cancelled the run.
- `receipt_missing`: runtime work may have occurred but receipt is missing.
- `output_rejected`: responsible owner or manager rejected the output as
  unusable evidence.
- `accepted`: cached summary only; authority remains an accepted owner/manager
  review.

## Renewal Triggers

A manager or kernel lifecycle check may require handoff when any of these
signals appears:

- context budget reaches the default `0.81` pressure threshold;
- runtime reports conversation truncation, compaction, or context exhaustion;
- `compaction_count` reaches the default `1` compaction limit;
- the worker has made multiple correction loops without convergence;
- manager review finds repeated misunderstanding of the task boundary;
- runtime or tool failures make the current session state unreliable;
- the task scope changed enough that the original worker prompt is stale;
- the worker produced useful partial artifacts but should not continue;
- Cat Brain requires a cleaner evidence chain before further work;
- Flashcat steering changes the task objective or constraints.

The default policy is intentionally conservative for all worker classes:
`contextPressureThreshold=0.81` and `maxCompactions=1`. When either threshold is
met, the lifecycle check should recommend `handoff_required`; an accepted
handoff package then becomes the input for a same-class successor worker. These
limits are global worker lifecycle policy rather than per-call tuning knobs.

## Handoff Package

A retiring worker must produce a `worker_handoff_package` as an information item
and usually as an artifact. It must be concise enough for a successor to use but
complete enough for a manager to audit.

Required contents:

- `source_worker_run_id`
- `worker_type`
- `worker_blueprint_id`
- `worker_generation`
- `handoff_reason`
- original task objective and acceptance criteria refs
- current status and confidence
- completed facts
- accepted or candidate artifact refs
- command/test/log receipt refs
- unresolved todos
- failed approaches and excluded paths
- assumptions and uncertainty
- manager critique refs, if any
- suggested next actions
- context budget telemetry
- compaction count and summary chain refs
- security or data-handling notes

The handoff package must not inline large raw transcripts. It should reference
artifacts, info items, receipts, and checkpoint ids. This follows Anthropic's
Research pattern: subagents can persist specialized outputs externally and pass
lightweight references to the coordinator.

## Successor Spawn

A successor worker is a fresh session instance created from the same worker
class or an explicitly selected compatible class.

The successor input should include:

- the current workflow, plan, node, and manager identity;
- the same worker class or compatible successor class;
- original objective and constraints;
- the handoff package info id;
- accepted artifact refs;
- unresolved todos;
- failed paths to avoid;
- manager critique and correction policy;
- a bounded output schema;
- a new context budget and lease.

The successor must record:

- `parent_worker_run_id`;
- `supersedes_worker_run_id`, when replacing a specific failed or retired run;
- `worker_generation`;
- `handoff_info_id`;
- `source_context_refs_json`;
- `created_by_manager_agent_key`;
- new `session_instance_id`.

The successor is not a continuation chat. It is a new worker run with curated
context and lineage. This avoids carrying stale transcript baggage while keeping
the workflow auditable.

## Review Hierarchy

Worker self-checks are useful but never authoritative.

Owner/manager review:

- owns worker acceptance;
- checks domain correctness, acceptance criteria, artifacts, and receipts;
- decides revise, reject, accept, handoff, or spawn successor;
- records blocker details as structured context when review cannot complete, but
  does not make `blocked` a review outcome;
- may spawn reviewer/verifier workers, but remains accountable for the decision.

In owner-direct paths, the task owner performs this review. In manager-worker
paths, the domain manager performs it.

Cat Heart or task owner review:

- synthesizes manager outputs and tradeoffs;
- decides whether the plan is ready for group discussion, Cat Brain check, or
  additional manager work;
- challenges weak manager conclusions.

Cat Brain review:

- reviews manager-level artifacts for semantic workflow validity;
- checks task decomposition, dependencies, evidence sufficiency, readiness,
  receipt completeness, rollback boundaries, blocked state, and Human Gate
  suitability;
- can require more worker evidence, manager revision, or a new plan revision;
- should not be reduced to format validation.

Cat Claw audit:

- checks secretary/Human Gate package structure, Chinese-format report completeness,
  two to five options, pause/terminate controls, button-first path, evidence
  refs, receipts, rollback boundaries, and token/security hygiene;
- does not invent missing content or fabricate options;
- may block a package if content is obviously unsupported, contradictory,
  unsafe, or missing required evidence.

Flashcat Human Gate:

- makes the final human decision on submitted options;
- supplies original text bound to the workflow, option, and Human Gate record;
- may approve, pause, terminate, or steer the workflow.

## Relationship To Workflow State

State reconciliation is downstream from lifecycle facts.

Examples:

- Any `running` worker keeps the plan in `waiting_worker`.
- A `succeeded` worker with no accepted review moves to `waiting_review`.
- A `handoff_required` worker keeps the plan in `waiting_manager` until a
  manager approves handoff or spawns a successor.
- A `retired` worker with no successor and no accepted artifact may block the
  node.
- A `successor_spawned` worker usually returns the plan to `waiting_worker`.
- Accepted manager synthesis can advance to group discussion, Cat Brain check,
  Cat Claw audit, or Human Gate readiness depending on policy.

The workflow state machine is a dashboard and control-loop cursor. It is not the
orchestration intelligence by itself.

## Metrics

Track lifecycle quality with metrics beyond worker success rate:

- worker context budget utilization;
- compaction count per worker run;
- handoff rate by worker type;
- successor success rate;
- repeated successor chain length;
- accepted artifact rate after handoff;
- rejected output rate after compaction;
- manager review turnaround;
- Cat Brain return-to-manager rate;
- Cat Claw package block rate;
- Human Gate package defect rate.

## Implementation Slices

### Design Slice

- Land this document.
- Add schema draft fields for worker lineage, context budget, and handoff
  packages.
- Update the orchestration kernel references and README.

### Local Schema Slice

- Landed in the local runtime schema on 2026-07-03:
  `workflow_v2_worker_runs` now carries lineage, context telemetry, source
  context refs, handoff info refs, and successor pointers; the local runtime
  also creates `workflow_v2_worker_handoffs`.
- Landed read-only preview for whether a worker should be renewed.
- Landed validation for lifecycle statuses, worker lineage, successor
  references, handoff info refs, and `workflow_v2_worker_handoffs`.

### Lifecycle Preview Slice

- Landed `workflow.v2.worker_lifecycle.preview` to compute renewal recommendations
  from worker status, review status, context telemetry, and blueprint policy.
- It remains pure and side-effect free.

### Renewal Action Slice

- Landed governed local actions for `handoff_required`, `retire`, and
  `spawn_successor`:
  - `workflow.v2.worker_handoff.record`
  - `workflow.v2.worker_retire.record`
  - `workflow.v2.worker_successor.create`
- These actions require responsible owner or manager authority. The accepted
  authority set is the worker `manager_agent` plus the plan `task_owner_agent`.
- Successor creation requires an accepted handoff package, links
  `parent_worker_run_id`, `supersedes_worker_run_id`, and
  `successor_worker_run_id`, then leaves the successor queued rather than
  starting a real runtime.
- Handoff packages are source-worker scoped. Retire and successor actions must
  not consume another worker's handoff id.
- Lifecycle write actions use commit-time state checks so stale previews cannot
  overwrite a worker that already advanced to a different lifecycle state.
- Runtime dispatch remains disabled until a separate backend rollout gate.

### Runtime Adapter Slice

- Integrate Hermers or Claude Code worker telemetry for context pressure,
  compaction count, summaries, and artifacts.
- Continue to require responsible owner/manager review and Cat Brain/Cat Claw
  gates before Human Gate delivery.

## Settled Decisions

- Cat Brain does not directly force worker retirement in the local action
  layer. It audits process/semantic sufficiency and returns required action to
  the responsible task owner or manager.

## Open Questions

- Should the first lifecycle preview use explicit runtime telemetry only, or
  infer context pressure from token estimates and compaction markers?
- Should successor spawning always use the same worker blueprint, or allow the
  manager to promote from implementation worker to verifier/reviewer worker?
- What maximum worker lineage depth should trigger Cat Heart or Flashcat review?
- Which artifact store should hold handoff package bodies when they are too
  large for inline info items?

## Acceptance Criteria

- A worker can be retired without losing accepted artifacts or receipts.
- A successor worker can reconstruct its task from curated refs, not raw chat.
- Worker lineage is visible from Human Gate package back to all predecessor
  workers.
- Managers remain responsible for acceptance decisions.
- Cat Brain can reject semantically weak manager packages.
- Cat Claw can block incomplete or unsupported Human Gate packages.
- Context compaction is treated as a lifecycle signal, not invisible runtime
  housekeeping.
