# Workflow v2 Orchestration Kernel

Status: design plus initial local kernel implementation
Created: 2026-07-03
Scope: `trading-agents-workflow`

## Purpose

`trading-agents-workflow` needs a real orchestration heart, not another layer of loosely connected dispatch, receipt, meeting, and Human Gate helpers. The v2 kernel defines the durable objects and control loop that let a cat-system task move from Flashcat intake to manager planning, worker spawning, worker review, group synthesis, Cat Claw audit, Human Gate, and resumable closeout.

The design keeps the cross-platform nature of this repository. Worker runtime backends should prefer Hermers/Hermes and Claude Code. Docker may provide a sandboxed worker environment on `wsl-agents` after explicit authorization. OpenClaw is not a worker runtime backend; it remains Gateway, IM, Cat Claw/Cat Brain, Human Gate, and OpenClaw-native member infrastructure. The workflow kernel owns orchestration state and evidence. It does not become the runtime platform for cat members.

## Non-Goals

- Do not deploy this local implementation to the development server or production without a separate rollout gate.
- Do not connect v2 worker runs to real Hermers, Claude Code, Docker, WSL, or production workflow queues yet.
- Do not replace `runtime_agents`; it remains the durable cat-member registry.
- Do not register spawned workers as cat members.
- Do not let workflow mechanics make semantic trading decisions.
- Do not bypass Cat Claw audit or Human Gate for gated work.
- Do not use OpenClaw as a worker runtime backend.
- Do not make Hermers, Codex, Claude Code, Docker, or future adapters the single required worker runtime.
- Do not implement `wsl-agents` Docker workers in the initial local kernel slice.
- Do not add another parallel message system outside governed workflow receipts and artifacts.

## Core Principle

The kernel separates four planes:

1. Identity plane: durable cat members, represented by `runtime_agents`.
2. Session plane: reusable session templates and task-scoped session instances.
3. Runtime plane: platform adapters that execute manager turns, worker turns, tools, and deterministic activities.
4. Workflow plane: plan graph, node state, worker runs, reviews, artifacts, group discussion, and Human Gate packages.

The current plugin already has parts of these planes, but they are not yet shaped into one orchestration contract. v2 makes that contract explicit.

The kernel must also treat worker context as a finite resource. A worker is not
an immortal conversation. If context pressure, repeated compaction, stale
assumptions, or review failures make the session unreliable, the manager should
retire or supersede that worker, persist a handoff package, and spawn a
same-class successor with curated context refs. This follows Anthropic's
orchestrator-workers and multi-agent Research guidance: separate workers buy
isolated context windows and specialized execution, but durable artifacts and
lightweight references must carry continuity.

Initial capacity contract:

- the workflow plane should be able to schedule and audit about 200 concurrent
  worker runs across the worker pool;
- each worker context budget is capped at 64k tokens;
- task owners and managers must decompose work so each worker receives a bounded
  objective, curated context refs, output schema, and stop condition that fit
  that 64k window;
- heavy monolithic assignments are invalid worker tasks. Large work must be
  split into smaller plan nodes and reassembled through artifacts, receipts,
  manager review, owner review, and task-group/governance review when needed.

The first runtime enforcement pass requires plan rows to persist this contract:
explicit orchestration pattern, rationale, worker budget, 64k worker context
ceiling, and acceptance criteria. Worker spawn requires a bounded delegation
contract with objective, output format, tool boundary, acceptance criteria, stop
condition, and explicit context budget. `direct_owner_execution` plans remain
owner-only unless managers are explicitly provided.

## Role Model

### Flashcat

Flashcat is the external principal and final human decision maker. Flashcat can start a task, steer it, approve options, pause, terminate, or resume from a checkpoint. Flashcat text and Human Gate decisions must remain bound to the relevant workflow, option, and artifact package.

### Cat Heart

Cat Heart is the task CEO for many high-level work items. It can accept a Flashcat task, become the task owner, choose involved managers, request plans, spawn workers through managers, challenge weak outputs, and synthesize the final direction.

Cat Heart is not a worker. It can fork a task-scoped manager session from a session template, but the durable identity remains `cat_heart`.

### Task Owner

The task owner is the execution CEO for one concrete task. Cat Heart is the
default owner for many strategic tasks, but the owner should be selected by task
type, risk, and required domain. The task owner drafts the plan, decides the
minimal orchestration pattern, assigns managers when needed, may directly spawn
workers for simple tasks, reviews manager artifacts, and assembles the final task
output package.

The task owner is not a Human Gate. It should not sit in a passive
`waiting_human`-style state. Owner work should advance through internal action
states such as `plan_due`, `review_due`, `revision_due`,
`worker_spawn_due`, `task_group_review_due`, or `escalate_to_owner`.

### Cat Brain

Cat Brain is the workflow governor and incident commander. It verifies that workflow evidence, dependencies, readiness, receipt, rollback, and Human Gate conditions are structurally complete. Cat Brain can host planning and group discussion, but formal Human Gate closeout still flows through Cat Claw.

Cat Brain performs governance and process-semantic audit. It should check
whether the plan is coherent, the roles are appropriate, the evidence supports
the conclusions, reviews happened at the right layer, obvious contradictions are
handled, and Human Gate conditions are justified. It should not replace the task
owner as execution CEO, replace managers as worker reviewers, or become the
default author of task content.

### Cat Claw

Cat Claw is secretary, audit gate, report packager, and Human Gate entry. Cat Claw reviews whether the evidence package contains enough artifacts, options, receipts, rollback boundaries, and button-first Human Gate structure. Cat Claw should not invent missing plans or fabricate options.

### Cat Members

Cat members are durable manager identities. Each member can operate a task-scoped session and can spawn workers inside its domain. Examples:

- Cat Body: CTO / implementation and system design manager.
- Cat Nose: market/data sensing manager.
- Cat Eyes: visual/UI/evidence inspection manager.
- Cat Ears: external signal/listening manager.
- Cat Penclaw: writing and artifact drafting manager.
- Cat Tail: pre-order risk audit manager for the narrow trading gate.

Cat members remain registered in `runtime_agents`. They are not worker rows.

Managers are complexity-triggered, not mandatory for every task. For simple
tasks, the owner may spawn and review a worker directly. For code, scripts,
tests, CI, engineering review, and repository changes, Cat Body should normally
enter as CTO reviewer or coding manager. For multi-domain work, each manager
owns a bounded domain, spawns/reviews its workers, and submits a manager artifact
to the task owner.

Managers are usually task group members when they participate in execution, but
task group membership and manager ownership are not identical. A cat member can
join task group peer review without owning a manager workstream.

### Task Group

The task group is a peer-review and conflict-resolution surface organized by the
task owner. It is not a required stage for every workflow. It should be used when
the task is cross-domain, high-risk, has multiple managers, has conflicting
recommendations, or needs substantive peer review before Cat Brain final audit.

Default task group composition should stay small. For many engineering tasks,
`task owner + cat_body` is sufficient. Additional cat members join only when the
task requires their domain: data/market sensing, UI/evidence inspection,
external signals, writing, risk audit, or trading-specific review.

### Workers

Workers are spawned tool-agent instances. A worker is not a cat member, not a durable identity, and not a governance owner. A worker receives a bounded task prompt, a session template, a tool policy, an input schema, output expectations, budget, and review criteria.

Examples:

- `worker.code.implementation`
- `worker.code.review`
- `worker.data.freshness_probe`
- `worker.market.news_scan`
- `worker.research.compare_tools`
- `worker.report.synthesis`
- `worker.human_gate.package_preview`

Workers must produce artifacts and receipts. A responsible task owner or manager
must review worker output before it becomes accepted workflow evidence. In
owner-direct paths, the task owner is the reviewer; in manager-worker paths, the
domain manager is the reviewer.

## Adaptive Orchestration Policy

The v2 kernel should follow Anthropic's simplest-effective-pattern guidance. A
plan should declare which orchestration pattern it is using and why once the
task shape is clear:

- `direct_owner_execution`: the owner can complete the task without workers.
- `owner_worker`: the owner directly spawns one or more bounded workers and
  reviews them.
- `owner_cto_review`: the owner executes or spawns workers, while Cat Body acts
  as CTO reviewer/manager for code and engineering evidence.
- `manager_worker`: the owner assigns one or more domain managers; managers
  spawn/review workers and submit manager artifacts.
- `parallel_manager_sections`: multiple managers work independently and the
  owner synthesizes their artifacts.
- `evaluator_optimizer`: one worker or manager produces output and a separate
  reviewer/verifier iterates against clear criteria.
- `autonomous_agent_loop`: a bounded agent loop is allowed only when the number
  of steps cannot be predicted and tool/environment feedback is necessary.

Complexity must be earned. Adding managers, task group review, Cat Brain
intermediate checks, or Human Gate should require a clear trigger. The kernel
should prefer owner-only or owner-plus-CTO paths for simple engineering work and
escalate only when complexity, risk, uncertainty, or cross-domain dependencies
make extra roles useful.

Plan-time orchestration metadata is advisory, not a Human-Gate-style blocking
gate. `workflow.v2.plan.preview/create` can persist a lightweight
`workflow_plan_spec.v2` draft before the owner has selected a final pattern.
Missing pattern/rationale/worker budget appears in `advisoryChecks` so Cat
Brain and the task owner can refine the plan without freezing early task
preparation.

Hard gates begin when work is delegated to finite-context workers or submitted
to Human Gate:

- worker spawn must include a bounded objective, output format, tool boundary,
  acceptance criteria, stop condition, review path, and explicit context budget;
- worker context budget may not exceed the 64k worker window;
- Human Gate packages must pass Cat Brain governance and Cat Claw protocol
  review before submission to Flashcat.

### Complexity Tiers

T0 owner-only:

- Use when the task is simple, low-risk, and has clear acceptance criteria.
- The owner may execute directly or produce a small artifact.
- No manager, task group, or Human Gate is required by default.

T1 owner plus direct worker:

- Use when a bounded tool-agent can produce or verify a specific artifact.
- The task owner spawns the worker, reviews the output, and records acceptance.
- Use for small research, read-only checks, formatting, or narrow implementation
  tasks.

T2 owner plus Cat Body / CTO:

- Use for code, scripts, tests, repository edits, CI fixes, and engineering
  risk.
- Cat Body may be a reviewer or manager depending on complexity.
- Coding workers should produce diffs, test evidence, and rollback notes.

T3 owner plus domain managers:

- Use when the task needs multiple domains or independent workstreams.
- Each manager owns a bounded phase/node, spawns/reviews workers, and submits a
  manager artifact.

T4 task group and governance escalation:

- Use for high-risk, cross-domain, contradictory, trading-adjacent, deployment,
  or production-impacting work.
- The owner convenes task group review before final package submission.
- Cat Brain final governance audit and Cat Claw protocol audit are mandatory
  before any Human Gate.

T5 Human Gate:

- Use only for human decisions: approval, choice among options, production or
  trading risk, scope change, pause/terminate/resume, or explicit Flashcat
  confirmation.
- `waiting_human` is reserved for this state only.

## Session Repository

The session repository is the v2 version of the current `workflow_session_packs` idea. It stores reusable session templates and produces task-scoped session instances.

### Template Kinds

Manager templates:

- `cat_heart.manager.ceo`
- `main.manager.governor`
- `cat_claw.manager.secretary_auditor`
- `cat_body.manager.cto`
- `cat_nose.manager.data_sensing`
- `cat_eyes.manager.visual_evidence`
- `cat_ears.manager.external_signal`
- `cat_penclaw.manager.writer`
- `cat_tail.manager.risk_audit`

Worker templates:

- `worker.code.implementation`
- `worker.code.review`
- `worker.code.test_verifier`
- `worker.research.primary_source_scan`
- `worker.market.data_probe`
- `worker.artifact.synthesis`
- `worker.human_gate.package_check`
- `worker.ops.readonly_diagnostic`

### Template Contents

Each template should contain:

- stable template id and version
- template kind: `manager` or `worker`
- owner agent or manager agent
- runtime hints and allowed runtime adapters
- system brief
- context references
- tool policy
- input schema
- output schema
- artifact contract
- review policy
- budget policy
- risk tier
- pack hash

Templates should reference context by durable paths, artifact ids, checkpoint ids, or evidence refs. They should not preload entire knowledge bases or long logs.

### Session Instances

A session instance is created when a template is bound to a workflow node. It records:

- workflow id
- plan id and node id
- task owner agent
- manager agent
- selected runtime
- injected task input
- context refs
- generated worker input
- source template id and pack hash
- lifecycle status

Manager session instances and worker session instances share the same repository pattern. The difference is authority: manager sessions can accept/reject worker outputs; worker sessions cannot accept their own work.

## Runtime Selection

Runtime selection is a kernel decision based on node type, worker blueprint, tool needs, risk tier, and platform readiness.

Expected default mapping:

- Hermers/Hermes: long-lived migrated cat members, manager turns, research workers, analysis workers, and future `hermers_docker_worker` testbed.
- Claude Code: coding workers, repo review workers, patch planning workers, test-verifier workers, and future `claude_code_docker_worker` testbed.
- OpenClaw: OpenClaw-native members, Cat Claw Human Gate/reporting path, Cat Brain/OpenClaw governance path, legacy IM and gateway surfaces; not worker execution.
- MCP tools: governed workflow/control-plane actions, data APIs, structured tool calls.
- Scripts or deterministic activities: schema export, read-only smoke, artifact rendering, checksum, lint, test commands.
- `wsl-models`: model/GPU API provider when needed, not a workflow worker runtime in the current round.

The kernel should record both the chosen runtime and the reason it was selected. Failed runtime attempts should not be hidden inside free text. They must become dispatch/receipt evidence.

The worker backend requirements and authorization gate are maintained in
`docs/workflow-v2-worker-runtime-backends.md`.

## Golden Path

### Prepare Task

1. Flashcat submits a task.
2. Workflow intake creates or resumes a `workflow_run`.
3. A task owner is selected by task type, risk, and required domain.
4. The task owner forks or prepares a task-scoped owner session from the session
   repository.
5. The task owner drafts the plan: objective, boundaries, orchestration pattern,
   complexity tier, manager policy, worker strategy, expected artifacts, evidence
   requirements, stop conditions, and Human Gate triggers.
   The canonical prepare-task output is a `workflow_plan_spec.v2` JSON artifact.
   `workflow_v2_plans` and `workflow_v2_plan_nodes` are runtime indexes and state
   mirrors of that artifact, not the plan source of truth.
6. Optional plan review happens before Cat Brain admission:
   - no task group for simple owner-only work;
   - `owner + cat_body` for ordinary engineering/code work;
   - broader task group only for cross-domain or high-risk work.
7. Cat Brain performs admission audit: plan coherence, role selection, evidence
   requirements, worker strategy, risk, rollback, and whether Human Gate is
   needed before execution.
8. Plan-level Human Gate is required only when the plan needs Flashcat choice or
   approval: production, trading, credential, deletion/migration, scope change,
   high cost, high risk, or multiple strategic options.

### Execute Task

9. After admission, the task owner becomes execution CEO.
10. For simple tasks, the owner executes directly or directly spawns bounded
    workers and reviews their output.
11. For code and engineering tasks, Cat Body normally acts as CTO reviewer or
    coding manager. It may spawn implementation, review, and test-verifier
    workers.
12. For complex tasks, the owner assigns managers. Each manager converts its
    domain into phase/node work and spawns workers from approved blueprints.
13. Workers run on selected runtime adapters and return artifacts, structured
    outputs, receipts, and errors.
14. Owners or managers review worker outputs against node acceptance criteria.
    Rejected outputs return to revise/retry, alternate worker, successor worker,
    or a worker/node/workflow condition state.
15. Accepted outputs enter the workflow artifact set only through owner or
    manager acceptance.

### Synthesize And Deliver

16. Managers submit manager artifacts to the task owner.
17. The task owner must review manager artifacts, resolve conflicts, and decide
    whether task group peer review is needed.
18. Optional task group discussion handles substantive peer review, manager
    conflict, and cross-domain tradeoffs.
19. The task owner assembles the final task output package.
20. Cat Brain performs final governance/process-semantic audit over the package,
    evidence chain, reviews, contradictions, risks, rollback, and Human Gate
    readiness.
21. Cat Claw performs secretary/protocol audit and prepares the formal
    Chinese-format report when Human Gate is required.
22. Human Gate is submitted only when Flashcat must decide, approve, choose,
    pause, terminate, resume, or accept risk. Otherwise the workflow can close
    with a governed closeout report.
23. Flashcat response resumes, pauses, terminates, redirects, or approves the
    workflow.
24. Closeout records final artifacts, receipts, decisions, rollback boundaries,
    and checkpoints.

## State Model

### Workflow States

- `draft`: intake exists but owner/plan is not ready.
- `planned`: plan exists and awaits activation.
- `active`: plan has runnable nodes.
- `waiting_worker`: at least one required worker run is active or pending.
- `waiting_review`: worker output exists and awaits owner or manager review.
- `waiting_manager`: manager synthesis or owner decision is required.
- `waiting_group_discussion`: manager group discussion is required.
- `waiting_cat_brain_check`: structural governance review is required.
- `waiting_cat_claw_audit`: Human Gate package audit is required.
- `human_gate_request_due`: Cat Claw has protocol-ready evidence and the formal
  Human Gate request still needs to be created or reused through the Human Gate
  bridge.
- `waiting_human`: Human Gate has been submitted and is waiting for Flashcat.
- `blocked`: no safe automatic progress exists.
- `completed`: objective and acceptance criteria are satisfied.
- `terminated`: Flashcat or governance closed the workflow before further execution.
- `cancelled`: workflow was intentionally abandoned before useful state.

Schema note: `workflow_v2_plans.status` is the plan lifecycle, while
`workflow_v2_plans.workflow_state` persists this workflow state machine. The
kernel must not collapse `waiting_*` states into a generic `active` state, or the
control loop will lose the difference between worker wait, owner/manager review, Cat
Claw audit, and Human Gate wait.

Internal owner and manager work should not be modeled as Human Gate-style
waiting. Use action-oriented internal states or node statuses such as
`plan_due`, `review_due`, `revision_due`, `worker_spawn_due`,
`successor_spawn_due`, `task_group_review_due`, `cat_brain_audit_due`, and
`cat_claw_protocol_audit_due`. `human_gate_request_due` is the internal action
state after Cat Claw protocol readiness and before the formal request exists.
`waiting_human` is reserved for a submitted Human Gate that is awaiting Flashcat.

### Node States

- `planned`
- `ready`
- `running`
- `waiting_receipt`
- `waiting_review`
- `accepted`
- `rejected`
- `revise_required`
- `blocked`
- `failed`
- `skipped`
- `cancelled`

### Worker Run States

- `queued`
- `retry_scheduled`
- `dispatched`
- `running`
- `succeeded`
- `submitted_for_review`
- `revise_required`
- `handoff_required`
- `retiring`
- `retired`
- `superseded`
- `successor_spawned`
- `blocked`
- `needs_human_gate`
- `failed`
- `timed_out`
- `cancelled`
- `receipt_missing`
- `output_rejected`
- `accepted`

### Review States

- `pending`
- `accepted`
- `revise_required`
- `rejected`
- `needs_human_gate`

## Plan Graph Contract

A v2 plan is a durable graph. It must be understandable without replaying a chat transcript.

Required plan fields:

- workflow id
- plan id and revision
- plan lifecycle status
- current workflow state
- objective
- constraints and stop conditions
- task owner
- orchestration pattern
- complexity tier
- prepare-task review policy
- manager trigger policy
- task group trigger policy
- worker strategy
- worker renewal policy
- involved managers
- phases
- nodes
- dependencies
- expected artifacts
- acceptance criteria
- verification policy
- Human Gate policy
- resume policy

Required node fields:

- node id
- node type
- owner agent
- manager agent
- optional worker blueprint
- input refs
- expected artifact refs
- acceptance criteria
- dependencies
- timeout
- max attempts
- failure route
- idempotency key

Plan admission should be a Cat Brain governance decision, not a Human Gate by
default. Admission outcomes should be `approved_for_execution`,
`revise_plan_required`, or `human_gate_required`. A plan enters Human Gate before
execution only when Flashcat must choose or approve a material risk/scope/cost
decision.

Node types:

- `manager_turn`
- `worker_task`
- `tool_activity`
- `artifact_synthesis`
- `manager_review`
- `group_discussion`
- `cat_brain_check`
- `cat_claw_audit`
- `human_gate`
- `checkpoint`
- `closeout`

## Worker Spawn Contract

Managers spawn workers by creating a worker run request from a worker blueprint and session template. The request must include:

- workflow id
- plan id
- node id
- manager agent
- worker blueprint id
- selected session template
- selected runtime adapter
- bounded task input
- allowed tools
- required output schema
- artifact contract
- review policy
- timeout and budget
- correlation id and idempotency key

A worker output is not accepted evidence until an owner/manager review row
accepts it. In the current schema this may still be stored in
`workflow_v2_manager_reviews` for manager-worker paths, then promoted by
`workflow_v2_owner_reviews` when the task owner accepts the manager artifact.
Owner-direct paths should still record explicit owner review evidence instead of
silently treating worker output as accepted. The review chain must reference the
worker run, produced artifacts, findings, receipt refs, and acceptance criteria;
an unbound manager review is invalid workflow evidence.

## Artifact Contract

Every worker and manager must write durable evidence as artifacts or artifact refs. The minimum artifact contract is:

- artifact id
- workflow id
- plan id
- node id
- producer kind: `manager`, `worker`, `tool`, or `human`
- producer id
- artifact type
- path or content ref
- content hash when available
- short summary
- status
- created timestamp

Artifact summaries are not the source of truth. The source is the artifact path/content reference plus hash and receipt links.

## Information Stack And Notification Boundary

The v2 kernel needs an internal information stack separate from `message_flow`.
Authoritative manager/worker content should live in workflow-native info items,
not in delivery payloads. The information stack owns content, context refs,
artifact refs, ACL grants, inbox pointers, and read receipts.

`message_flow` should be treated as an SMS-like notification layer:

- It can tell a target that `info_id` / `inbox_item_id` is ready to read.
- It can prove cross-runtime notification, ACK, return delivery, or Telegram
  delivery.
- It must not become the source of truth for worker task bodies, manager review
  content, Human Gate evidence, or durable decisions.

Same-platform workers should read directly from their governed inbox when
possible. Cross-platform workers may receive a `message_flow` notice, then call
the governed read action with their runtime/session identity. A read receipt is
only read evidence; worker completion still belongs in worker runs, artifacts,
and manager reviews.

The detailed design is maintained in
`docs/workflow-v2-information-stack.md`.

## Owner / Manager Review Contract

Owner or manager review is mandatory for worker output. Review should answer:

- Does the output satisfy the node acceptance criteria?
- Are required artifacts present?
- Are citations, logs, commands, receipts, or tests sufficient?
- Is the result safe to synthesize into the workflow state?
- Is another worker, retry, or human decision needed?

Reviewer output states:

- `accepted`: output may feed synthesis.
- `revise_required`: output needs bounded correction.
- `rejected`: output is not usable evidence.
- `needs_human_gate`: manager cannot safely decide without a Flashcat Human
  Gate decision.

Owner/manager review outcomes should stay fast and agent-native. They are not Human
Gate states. If the reviewer cannot complete review because of missing evidence,
runtime failure, dependency gaps, or policy uncertainty, the review should attach
structured `blocker_json` / required actions and choose the closest actionable
outcome, usually `revise_required` or `needs_human_gate`. `blocked` belongs to
worker, node, plan, or workflow condition state, not the review outcome enum.
Manager review must be scoped to the worker's responsible manager and a concrete
worker run; owner-direct/simple paths use owner review evidence instead.

For code work, a separate reviewer/verifier worker may be required by policy, but
the responsible task owner or manager remains accountable for accepting or
rejecting the result.

`worker_runs.status=accepted` is not the authority by itself. It is a cached
lifecycle summary and must be backed by an accepted owner/manager review row. A read
receipt, notification receipt, runtime ACK, or worker success status is not a
review acceptance decision.

Manager review authority is scoped to the worker's responsible manager. A
manager-review record may accept/revise/reject only a worker that is already
`submitted_for_review` and whose `manager_agent` matches the reviewer. Owner-direct
paths should use owner review evidence rather than spoofing a manager review.

Cat Brain audit can source a ready task group package for complex paths or an
accepted owner review for simple owner-direct paths. Task group review is
therefore optional and complexity-driven, not a universal gate.

## Human Gate Boundary

The kernel may assemble Human Gate evidence, but it must not decide for Flashcat.
Human Gate is a governed human interaction boundary, not only a yes/no approval
switch and not a place where worker output becomes accepted by itself. The v2
model separates three layers:

1. Submission package: the artifact/evidence package assembled by task owner,
   task group, Cat Brain, and Cat Claw. It stores refs, options, risks,
   rollback boundaries, and protocol audit evidence.
2. Human Gate request: the interaction wrapper submitted by Cat Claw through the
   existing Human Gate engine. It binds `submissionKind`, `interactionType`,
   `responseSchema`, `resumeContract`, buttons, Web App/token feedback path, and
   delivery evidence to the package.
3. Human response: Flashcat's selected button plus original words/review
   feedback. Only this response can complete the Human Gate and resume, pause,
   terminate, or return the workflow.

Before Human Gate, Cat Brain and Cat Claw have separate responsibilities:

- Cat Brain verifies plan/evidence/readiness/receipt/rollback completeness.
- Cat Claw audits the package and submits the formal secretary-facing report.

A Human Gate package must include:

- Chinese-format report text; English terms, identifiers, artifact paths, symbols,
  and necessary original words may remain untranslated.
- two to five independently approvable options
- separate approve controls for each option
- pause control
- terminate control
- evidence and artifact refs
- receipt refs
- rollback or stop conditions
- Flashcat original text binding after response

Supported interaction categories include approval, artifact acceptance, review
feedback, option selection, arbitration, scope confirmation, release gate, and
information request. The common bridge still uses the button-first Human Gate
request engine, so each category must present concrete options and controls
rather than free-floating prose.

Worker output cannot directly create a final Human Gate decision. It can only contribute evidence to a package that Cat Claw audits.

Cat Claw/package code must not invent missing options. Options are authored
content from the task owner/Cat Brain evidence path. Cat Claw verifies structure,
evidence, controls, and protocol readiness; if options are missing or weak, it
returns the package instead of generating substitutes.

## Mapping to Existing Surfaces

The v2 kernel should reuse the useful existing assets:

- `runtime_agents`: durable cat-member registry and platform ownership.
- `workflow_runs` / `workflow_tasks`: current run/task surfaces, to be mapped or superseded by v2 plan objects.
- `workflow_session_packs` / `workflow_session_runs`: first-generation session store, to be generalized into session templates and instances.
- `mixed_meeting_dispatches`, `runtime_runs`, `workflow_agent_runs`: runtime dispatch and receipt evidence.
- `message_flows` / `message_flow_events`: governed notification and delivery evidence, not authoritative v2 manager/worker content.
- `protocol_objects`, `human_gate_*`, `telegram_outbox`: Human Gate and delivery evidence.
- `artifact_index` and filesystem artifacts: durable output references.
- `workflow_checkpoints`: resume and session-overflow recovery points.
- `cat-agents-stabilityd`: external stability evidence and guarded repair layer.

The v2 schema uses `workflow_v2_*` table names to avoid pretending that existing
v1 workflow tables have been migrated. The initial local implementation creates
an aligned minimal subset in the control-plane database, while production
rollout and runtime adapter connection remain separate future gates.

Manager and owner columns should use `runtime_agents.agent_key` as the integrity
anchor and keep the readable agent id as a denormalized convenience field.
Worker ids must never be valid values for `*_agent_key` manager/owner columns.

## First Implementation Slices

Current post-kernel execution order is maintained in
`docs/workflow-v2-unified-next-plan.md`. The slices below remain the design
history and capability map; the next active track starts with focused regression
splitting and v2 module extraction before more runtime adapter work.

### P0: Design Contract

- Land this document.
- Land `workflow-v2-orchestration-schema.sql` as a schema design reference.
- Land `workflow-v2-information-stack.md` as the content/inbox/access design.
- Land `workflow-v2-worker-runtime-backends.md` as requirements and authorization-prep only.
- Add README entries.

### Initial Kernel Slice: Preview and Local Records

- Keep `workflow-v2-p1-readiness-plan.md` as the historical first-slice authorization gate, dry-run API, and test-matrix contract.
- Add read-only previews for plan packages, information-stack records, notifications, worker backend preflight, worker spawn, Human Gate packages, and validation.
- Add local record/create actions for plans, information-stack records, queued worker-run records, manager reviews, and Human Gate packages.
- Add workflow-id consistency validator across plan, node, worker run, info item, inbox/grant, notification, review, and Human Gate package rows.
- Add regression tests proving no real runtime dispatch, Docker, WSL, server, or network side effects occur.

### Internal Audit-Chain Slice

- Add owner review records that can only be written by the plan task owner.
- Add task group package records for optional peer review and final task output
  packaging.
- Add Cat Brain governance/process-semantic audit records restricted to `main`.
- Add Cat Claw protocol audit records restricted to `cat_claw`.
- Allow Human Gate package preparation to cite a protocol-ready Cat Claw audit
  through `sourceCatClawAuditId`.
- Advance local `workflow_v2_plans.workflow_state` through
  `waiting_group_discussion`, `waiting_cat_brain_check`,
  `waiting_cat_claw_audit`, `human_gate_request_due`, and `waiting_human`
  based on recorded evidence. `waiting_human` starts only after a formal Human
  Gate request exists.
- Keep these as internal action records. They are not Human-Gate-style passive
  waits for manager, owner, Cat Brain, or Cat Claw.

### P2: Session Repository

- Normalize manager and worker templates.
- Add CLI/API to create a task-scoped session instance from a template.
- Generate worker input payloads with explicit context refs, not hidden long prompts.

### P3: Worker Lifecycle

- Add worker run creation, dispatch request, receipt capture, and artifact capture.
- Add worker lifecycle renewal: context-budget telemetry, compaction count,
  handoff packages, worker lineage, retirement, supersession, and same-class
  successor spawn.
- Start with one low-risk non-trading worker type.
- Require owner/manager review before acceptance.
- Keep state reconciliation downstream from lifecycle facts; do not treat
  `waiting_review` or `waiting_human` bookkeeping as the orchestration kernel.

### P4: Manager Loop

- Add owner/manager planning turn.
- Add manager review state. The first local manager-review write path is
  implemented.
- Add owner review, task output package, Cat Brain audit, and Cat Claw audit
  records. The first local audit-chain write path is implemented.
- Add richer group discussion object and runtime-backed manager turns in a later
  slice.

### P5: Human Gate Package

- Add package preview.
- Add Cat Brain structural check. The first local Cat Brain audit record is
  implemented.
- Add Cat Claw audit. The first local protocol audit record is implemented.
- Connect a Cat-Claw-audited v2 package to the existing Human Gate request
  engine through `workflow.v2.human_gate_request.preview` and
  `workflow.v2.human_gate_request`.
- Keep the bridge narrow: it may create/reuse the formal pending Human Gate
  record, buttons, and queued Telegram outbox, then link that request back to
  the v2 package. It does not deliver Telegram, complete the Human Gate, dispatch
  runtime work, or update workflow completion status.

## Acceptance Criteria

The v2 kernel is useful only when it can show measurable improvement:

- Every active workflow has a visible owner, plan revision, current node, and next action.
- Workers are spawned from session templates, not ad hoc prompts.
- Worker output is not accepted without owner/manager review.
- Artifacts and receipts can be traced from Human Gate package back to worker runs.
- Runtime failures are visible as receipt/state, not buried in prose.
- A paused workflow can resume from plan/node/session/artifact state.
- The kernel can explain why it is blocked without inventing success.
- Cat Claw can audit Human Gate readiness without reverse engineering the whole run.

## Metrics

Recommended v2 operating metrics:

- intake to first plan latency
- plan to first worker dispatch latency
- worker receipt completeness rate
- artifact acceptance rate
- owner/manager review coverage
- rejected/retried worker ratio
- Human Gate package readiness failures
- resume success rate
- stale worker run count
- runtime adapter failure rate
- worker handoff rate
- successor worker success rate
- compaction-to-rejection correlation

## Open Questions

- Should existing `workflow_session_packs` be migrated in place, or should v2 tables be introduced and bridged first?
- Which runtime should be the default coding worker backend: Codex, Claude Code, Hermers ACP, or an adapter-selected choice?
- How should model budgets and worker concurrency be expressed so managers can spawn enough help without creating resource pressure?
- Which artifact store is canonical for v2: current filesystem artifacts plus `artifact_index`, or a stricter database-backed artifact registry?
- What maximum worker lineage depth should trigger Cat Heart, Cat Brain, or
  Flashcat review?

## Settled Design Decisions

- The task owner is selected per task type, risk, and required domain. Cat Heart
  is the default owner for many strategic tasks, while Cat Brain remains the
  governor rather than the execution CEO.
- Prepare-task Human Gate is not default. It is required only for material
  Flashcat decisions such as production, trading, credential, deletion,
  migration, scope, cost, or high-risk direction choices.
- Task group review is optional and complexity-triggered. For many engineering
  tasks, `task owner + cat_body` is sufficient; broader task group membership is
  added only when the task requires it.
- Managers are complexity-triggered. Simple tasks can be owner-only or
  owner-plus-worker; code and engineering tasks normally bring Cat Body in as
  CTO reviewer or manager.

## References

Existing local references:

- `docs/workflow-session-store.md`
- `docs/workflow-task-drafting-initial-plan.md`
- `docs/claude-code-workflow-reference/workflow-plan-spec-v2.md`
- `docs/managed-agent-evolution-plan.md`
- `docs/message-flow-closure.md`

External design references:

- Anthropic Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic multi-agent Research system: https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- LangGraph durable execution and persistence: https://docs.langchain.com/oss/python/langgraph/overview
- OpenAI Agents SDK multi-agent orchestration and sessions: https://openai.github.io/openai-agents-python/multi_agent/
- Google ADK sessions, artifacts, and workflows: https://google.github.io/adk-docs/sessions/
- CrewAI Flows: https://docs.crewai.com/concepts/flows
- AutoGen distributed agent runtime: https://microsoft.github.io/autogen/stable/user-guide/core-user-guide/core-concepts/architecture.html
- Temporal workflows and activities: https://docs.temporal.io/temporal
