# Workflow v2 Anthropic Alignment Audit

Status: advisory plan alignment + hard worker delegation pass implemented
Created: 2026-07-04
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

## Alignment Matrix

| Anthropic guidance | v2 decision | Runtime enforcement |
| --- | --- | --- |
| Distinguish workflows from autonomous agents. Workflows use predefined code paths; agents dynamically choose steps. | `workflow.v2` can store an `orchestrationPattern`, but early prepare-task plans may start as lightweight drafts while the owner explores the task shape. | `workflow.v2.plan.preview/create` return advisory gaps for missing orchestration fields; `workflow.v2.validate` reports plan alignment gaps in `advisoryChecks`, not `failedChecks`. |
| Prefer the simplest effective pattern and add complexity only when needed. | Supported patterns are bounded: `direct_owner_execution`, `owner_worker`, `owner_cto_review`, `manager_worker`, `parallel_manager_sections`, `evaluator_optimizer`, `autonomous_agent_loop`. | Missing pattern/rationale/budget is advisory at plan time. Worker execution remains gated by concrete delegation, review path, context budget, and receipts. |
| Orchestrator-workers require the orchestrator to decompose tasks and give workers clear task boundaries. | Worker spawn requires a delegation contract, not just a session id and runtime backend. | `workflow.v2.worker_spawn.preview/create` require `workerObjective`, `outputFormat`, `toolBoundary`, `acceptanceCriteria`, and `stopCondition`/`stopConditions`. |
| Subagents preserve context by running in isolated context windows. | Workers are tool-agent instances with bounded context and task-scoped session input. They are not cat members. | Worker rows now require explicit `contextBudgetTokens`, capped at 64k. Delegation is persisted in worker payload and session input. |
| Scale effort to query/task complexity and avoid uncontrolled subagent fan-out. | Plans should estimate worker budget once worker fan-out is known; worker rows must still carry explicit bounded context. | Plan budget gaps are advisory. Worker spawn requires `contextBudgetTokens`; concurrency design target remains 200 and each worker context is capped at 64k. |
| Parallel work improves speed only when work can be sectioned or cross-checked. | `parallel_manager_sections` is a declared plan pattern when known, not an accidental result of many worker rows. | Validator now reports missing pattern/budget evidence as advisory; further work should enforce manager section ownership when that pattern is selected. |
| Evaluator-optimizer loops require clear criteria and a separate evaluation path. | Manager/owner review remains a fast internal evaluator path. Human Gate is not used as the evaluator loop. | Manager review must bind to a worker run and reviewer must be the worker's manager; owner review must bind to accepted manager evidence or explicit owner-direct evidence. |
| Agents should use environmental ground truth and human checkpoints when needed. | Worker artifacts, receipts, tests, and command/log refs are the ground-truth layer; Flashcat Human Gate is reserved for human decisions. | Worker output cannot become accepted evidence without manager/owner review. `waiting_human` is reached only by formal Human Gate request. |
| Dynamic workflows move orchestration into a script/runtime so many agents can run while the main session stays responsive. | `workflow.v2.control_loop` is the local kernel runner and durable state machine; adapter jobs are separate from conversation context. | Control loop, adapter job, session run, receipt, and validator checks enforce resumable state instead of relying on a single chat context. |

## Current Enforcement Points

- `workflow.v2.plan.preview/create`
  - returns `workflow_plan_spec.v2` JSON for prepare-task review;
  - reports missing/unsupported `orchestrationPattern`, missing rationale,
    missing acceptance criteria, and missing/inconsistent worker budget as
    `advisoryChecks`;
  - remains valid for lightweight drafts when the task owner is still exploring
    the simplest effective pattern;
  - does not create manager worker nodes for `direct_owner_execution` when
    managers were not explicitly provided.

- `workflow.v2.worker_spawn.preview/create`
  - requires session repository binding;
  - requires task input info pointer;
  - requires bounded delegation contract;
  - requires explicit context budget and rejects missing budgets or budgets above 64k;
  - persists the delegation contract into worker payload/session input.

- `workflow.v2.validate`
  - reports plan rows missing the Anthropic orchestration contract through
    `advisoryChecks`/`advisoryFindings`;
  - flags worker rows missing bounded delegation evidence;
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

- Plan-node section ownership is still mostly descriptive. The next pass should
  require `manager_worker` and `parallel_manager_sections` nodes to carry domain
  ownership, expected artifacts, and review policy.
- Evaluator-optimizer is represented as a pattern but does not yet enforce a
  distinct producer/evaluator node pair.
- Autonomous agent loops still need explicit iteration caps, tool feedback
  checkpoints, and stop conditions at the node level.
- The local control loop is not yet a saved JavaScript workflow script in the
  Claude Code dynamic-workflow sense. It is a durable kernel action set. That is
  acceptable for this cross-platform plugin, but the observable run view should
  eventually show phase/agent counts, token budgets, and elapsed time in the
  same spirit.
- Worker backend smoke for Hermers/Claude Code Docker remains separate from this
  alignment pass.
