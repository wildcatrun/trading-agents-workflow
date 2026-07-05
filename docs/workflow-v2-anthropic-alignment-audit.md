# Workflow v2 Anthropic Alignment Audit

Status: advisory plan/node alignment, executable hard gates, autonomous-loop runtime enforcement, and evaluator contract gates implemented
Created: 2026-07-04
Last reviewed: 2026-07-05
Scope: `trading-agents-workflow` v2 orchestration kernel

## Sources

This audit maps the local v2 kernel to Anthropic's public agent orchestration
guidance:

- Anthropic Engineering, `Building effective agents`:
  https://www.anthropic.com/engineering/building-effective-agents
- Anthropic Engineering, `How we built our multi-agent research system`:
  https://www.anthropic.com/engineering/multi-agent-research-system
- Claude Code Docs, `Orchestrate subagents at scale with dynamic workflows`:
  https://code.claude.com/docs/en/workflows
- Claude Code Docs, `Create custom subagents`:
  https://code.claude.com/docs/en/sub-agents
- Claude Code Docs, `Orchestrate teams of Claude Code sessions`:
  https://code.claude.com/docs/en/agent-teams
- Claude Code Docs, `Run parallel sessions with worktrees`:
  https://code.claude.com/docs/en/worktrees
- Claude Code Docs, `Automate actions with hooks`:
  https://code.claude.com/docs/en/hooks-guide
- Claude Code Docs, `Keep Claude working toward a goal`:
  https://code.claude.com/docs/en/goal

## Alignment Matrix

| Anthropic guidance | v2 decision | Runtime enforcement |
| --- | --- | --- |
| Distinguish workflows from autonomous agents. Workflows use predefined code paths; agents dynamically choose steps. | `workflow.v2` can store an `orchestrationPattern`, but early prepare-task plans may start as lightweight drafts while the owner explores the task shape. | `workflow.v2.plan.preview/create` return advisory gaps for missing orchestration fields; `workflow.v2.validate` reports plan alignment gaps in `advisoryChecks`, not `failedChecks`. |
| Prefer the simplest effective pattern and add complexity only when needed. | Supported patterns are bounded: `direct_owner_execution`, `owner_worker`, `owner_cto_review`, `manager_worker`, `parallel_manager_sections`, `evaluator_optimizer`, `autonomous_agent_loop`. | Missing pattern/rationale/budget is advisory at plan time. Worker execution remains gated by concrete delegation, review path, context budget, and receipts. |
| Orchestrator-workers require the orchestrator to decompose tasks and give workers clear task boundaries. | Worker spawn requires a delegation contract, not just a session id and runtime backend. | `workflow.v2.worker_spawn.preview/create` require `workerObjective`, `outputFormat`, `toolBoundary`, `acceptanceCriteria`, and `stopCondition`/`stopConditions`. |
| Subagents preserve context by running in isolated context windows. | Workers are tool-agent instances with bounded context and task-scoped session input. They are not cat members. | Worker rows now require explicit `contextBudgetTokens`, capped at 64k. Delegation is persisted in worker payload and session input. |
| Scale effort to query/task complexity and avoid uncontrolled subagent fan-out. | Plans should estimate worker budget once worker fan-out is known; worker rows must still carry explicit bounded context. | Plan budget gaps are advisory. Worker spawn requires `contextBudgetTokens`; concurrency design target remains 200 and each worker context is capped at 64k. |
| Parallel work improves speed only when work can be sectioned or cross-checked. | `parallel_manager_sections` is a declared plan pattern when known, not an accidental result of many worker rows. | Validator now reports missing pattern/budget evidence as advisory; further work should enforce manager section ownership when that pattern is selected. |
| Evaluator-optimizer loops require clear criteria and a separate evaluation path. | Manager/owner review remains the local evaluator path. Human Gate is not used as the evaluator loop. | `evaluator_optimizer` plan nodes must declare producer output, evaluator input, rubric/schema, review artifact, and accepted/rejected/needs_revision states. Manager review records the structured evaluator receipt, and owner review can only consume accepted evaluator receipts for this pattern. |
| Agents should use environmental ground truth and human checkpoints when needed. | Worker artifacts, receipts, tests, and command/log refs are the ground-truth layer; Flashcat Human Gate is reserved for human decisions. | Worker output cannot become accepted evidence without manager/owner review. `waiting_human` is reached only by formal Human Gate request. |
| Dynamic workflows move orchestration into a script/runtime so many agents can run while the main session stays responsive. | `workflow.v2.control_loop` is the local kernel runner and durable state machine; adapter jobs are separate from conversation context. | Control loop, adapter job, session run, receipt, and validator checks enforce resumable state instead of relying on a single chat context. |
| Agent teams use shared task lists, named teammates, direct communication, and conflict-aware review when workers need to coordinate. | v2 keeps cat members as durable managers and workers as finite-context instances. Team-style behavior maps to manager-owned plan nodes, task group package, and owner synthesis rather than direct free-form worker chatter. | `workflow.v2.plan.preview` now advises when manager/parallel nodes lack domain ownership, expected artifacts, or review policy. |
| Autonomous agent loops need bounded stopping conditions, environmental feedback, and independent completion checks. | `autonomous_agent_loop` remains a supported pattern but should be rare and bounded. | `workflow.v2.plan.preview/create` and worker spawn require declared caps/checkpoints/stop conditions; runtime spawn gates count persisted worker iterations, require info-stack tool/environment feedback evidence after the previous iteration with previous-worker lineage and declared checkpoint binding, and terminalize loop nodes when explicit stop-condition evidence is submitted. `/goal`-style independent completion checks remain a future evaluator slice. |

## Current Enforcement Points

- `workflow.v2.plan.preview/create`
  - returns `workflow_plan_spec.v2` JSON for prepare-task review;
  - reports missing/unsupported `orchestrationPattern`, missing rationale,
    missing acceptance criteria, and missing/inconsistent worker budget as
    `advisoryChecks`;
  - reports plan-node structure gaps for manager-worker, parallel section,
    evaluator-optimizer, and autonomous-loop patterns as `advisoryChecks`;
  - default manager-worker nodes now carry domain ownership, expected artifact,
    and review-policy payload fields so the generated plan is closer to the
    orchestrator-worker contract;
  - remains valid for lightweight drafts when the task owner is still exploring
    the simplest effective pattern;
  - does not create manager worker nodes for `direct_owner_execution` when
    managers were not explicitly provided.
  - `workflow.v2.plan.create` upgrades the plan-node structure checks to hard
    gates when the persisted plan is non-draft/non-draft-workflow-state.
    Draft plans can still be persisted with advisory gaps.
  - `workflow.v2.worker_spawn.preview/create` re-check persisted plan-node hard
    gates before dispatch, so a draft plan with unresolved executable-loop or
    evaluator structure cannot spawn a worker until corrected.

- `workflow.v2.manager_review.record` / `workflow.v2.owner_review.record`
  - for `evaluator_optimizer` plans, accepted/rejected/revision review decisions
    must include a structured `evaluatorReceipt` in the existing
    `workflow_v2_manager_reviews.payload_json`;
  - the receipt binds producer node/worker/output to the reviewed worker run,
    requires evaluator input to consume that worker output, and records rubric,
    review artifact, review receipt, decision state, and declared decision
    states;
  - owner review rejects manager review refs that are not accepted evaluator
    receipts, and `allowNoManagerReviews` cannot bypass this requirement, so
    owner acceptance cannot consume loose producer text.

- `workflow.v2.worker_spawn.preview/create`
  - requires session repository binding;
  - requires task input info pointer;
  - requires bounded delegation contract;
  - requires explicit context budget and rejects missing budgets or budgets above 64k;
  - persists the delegation contract into worker payload/session input;
  - for `autonomous_agent_loop` plan nodes, computes the next iteration from
    persisted `workflow_v2_worker_runs`, blocks spawn at `maxIterations`,
    requires info-stack feedback evidence after the previous iteration, bound
    to the previous worker run and a declared checkpoint, before iteration 2+,
    blocks spawn while the previous iteration is still open, and records loop
    runtime state in the worker payload.

- `workflow.v2.control_loop.tick` / `workflow.v2.worker_result.submit`
  - reuse the existing worker/session/result paths;
  - when an autonomous-loop worker result carries explicit
    `stopConditionSatisfied` evidence, update the existing plan node to
    `completed` with output info and receipt pointers;
  - later spawn attempts against a completed loop node fail with
    `autonomous_loop_terminal`.

- `workflow.v2.validate`
  - reports plan rows missing the Anthropic orchestration contract through
    `advisoryChecks`/`advisoryFindings`;
  - flags worker rows missing bounded delegation evidence;
  - flags persisted autonomous-loop nodes whose worker-run count exceeds their
    declared iteration cap;
  - flags evaluator-optimizer manager reviews that lack structured evaluator
    receipts;
  - keeps existing provenance checks for worker/session/preflight/review links.

## 2026-07-04 Constraint Correction

The first alignment pass over-corrected by making plan-level orchestration
metadata a hard pre-start gate. That conflicted with Anthropic's practical
guidance to start with the simplest effective pattern, add complexity only when
needed, and let orchestrators adapt as task shape becomes clear.

The corrected contract is:

- plan JSON is still the prepare-task source of truth;
- plan orchestration fields are recommended governance metadata, not a hard
  blocker for drafting or persisting a lightweight plan;
- worker spawn remains hard-gated because workers have finite context windows
  and must receive bounded objective/output/tool/review/stop instructions;
- Human Gate remains hard-gated because it is the human decision boundary.

## Remaining Gaps

- Plan-node section ownership, expected artifacts, review policy,
  evaluator-optimizer pair separation/contract, and autonomous-loop bounds are
  now preview advisories plus executable hard gates at non-draft plan admission
  and worker dispatch.
- Evaluator-optimizer now has a first-class local contract through plan node
  payloads and manager review receipts. Remaining work is UI/read-model
  visibility and deeper adapter integration, not a separate evaluator state
  table.
- Autonomous agent-loop iteration caps, feedback checkpoints, and explicit stop
  terminalization now run through the existing worker spawn/control-loop/result
  paths. Remaining loop work is independent evaluator acceptance rather than a
  second loop state machine.
- The local control loop is not yet a saved JavaScript workflow script in the
  Claude Code dynamic-workflow sense. It is a durable kernel action set. That is
  acceptable for this cross-platform plugin, but the observable run view should
  eventually show phase/agent counts, token budgets, and elapsed time in the
  same spirit.
- Worker backend smoke for Hermers/Claude Code Docker remains separate from this
  alignment pass.
