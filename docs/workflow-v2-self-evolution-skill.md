# Workflow v2 Self-Evolution Skill

Status: design package for authorization
Created: 2026-07-05
Scope: `trading-agents-workflow`

## Purpose

This document defines a governed workflow self-evolution capability for
`trading-agents-workflow`. The goal is to make recurring workflow patterns
reusable, measurable, and improvable without turning the workflow plugin into an
uncontrolled agent runtime or an arbitrary script engine.

The capability should let the system answer:

- Which repeated workflow shape should be reused for this new task?
- Which template version produced the best outcomes under comparable cases?
- Which plan fields were filled by the template and which were task-specific?
- Did template reuse improve accuracy, cost, latency, and receipt completeness?
- Should a candidate template be promoted, demoted, frozen, retired, or rolled
  back?

## External References

This design follows these public Anthropic patterns:

- `Building effective agents`: workflows are predefined code paths, agents
  dynamically choose steps, and the simplest effective pattern should be used
  before adding complexity.
  https://www.anthropic.com/engineering/building-effective-agents
- `How we built our multi-agent research system`: long-running multi-agent
  systems need durable execution, checkpoints, tracing, and state handoff rather
  than relying on a single conversation context.
  https://www.anthropic.com/engineering/multi-agent-research-system
- Claude Code Skills documentation: skills are reusable instruction packages
  with controlled invocation, subagent isolation, permissions, and evaluation
  loops.
  https://code.claude.com/docs/en/slash-commands
- Claude Platform evaluation guidance: success criteria should be specific and
  measurable; evals should be task-specific and preferably automatable.
  https://platform.claude.com/docs/en/test-and-evaluate/develop-tests

The useful local analogue is not a direct copy of Claude Code Skills. For this
repository, the right shape is:

- skill for procedural knowledge;
- `workflow_template_spec.v1` JSON artifact for reusable template structure;
- `workflow_plan_spec.v2` JSON artifact only as the instantiated plan output;
- database index for status, selection, statistics, permissions, and evals;
- existing v2 actions for execution.

## Current Local Foundation

The repository already has the core execution foundation:

- `workflow_plan_spec.v2` is the canonical prepare-task plan artifact.
- `workflow_v2_plans` and `workflow_v2_plan_nodes` are runtime indexes and
  state mirrors, not a replacement source of truth.
- `workflow.v2.plan.preview` and `workflow.v2.plan.create` generate and persist
  plan artifacts.
- `workflow.v2.worker_spawn.*`, `workflow.v2.control_loop.tick`,
  `workflow.v2.worker_result.*`, manager review, owner review, Cat Brain audit,
  Cat Claw audit, and Human Gate package actions provide the current execution
  rails.
- Plan-node hard gates, autonomous-loop runtime gates, worker lifecycle policy,
  and evaluator-optimizer receipt gates have already landed.

The missing layer is a first-class template registry and evolution loop.

## Asset Model

### Skill

The skill is the procedural guide for using self-evolution safely. It describes
when to extract, instantiate, evaluate, and promote workflow templates. It does
not directly execute workflow state changes.

Initial skill location:

```text
skills/workflow-self-evolution/SKILL.md
```

### Template Artifact

The canonical reusable body should be a `workflow_template_spec.v1` JSON
artifact. `workflow_plan_spec.v2` is not a template body; it is produced after a
template is instantiated and validated through existing v2 plan gates.

```json
{
  "schemaVersion": "workflow_template_spec.v1",
  "templateId": "template.workflow.v2.engineering_review.v1",
  "version": 1,
  "status": "candidate",
  "title": "Engineering change with worker implementation and independent review",
  "description": "Reusable v2 pattern for medium-risk code changes.",
  "triggers": {
    "shouldUse": [],
    "shouldNotUse": [],
    "requiredSignals": [],
    "forbiddenSignals": []
  },
  "variables": [],
  "riskPolicy": {},
  "permissionPolicy": {},
  "planSpecSkeleton": {},
  "evalPolicy": {},
  "promotionPolicy": {},
  "rollbackPolicy": {},
  "audit": {}
}
```

Template artifacts should live under workflow artifacts, for example:

```text
artifacts/workflow-v2/templates/<template-id>/<version>.json
```

### Database Index

The database should index template artifacts and their evaluation history. The
database must not become a place for raw prompt sprawl or unreviewed executable
scripts.

Recommended first-class tables:

```text
workflow_v2_template_specs
workflow_v2_template_versions
workflow_v2_template_evals
workflow_v2_template_stats
workflow_v2_template_events
```

These tables should carry ids, status, version, artifact refs, hashes, owners,
permission policy, selection metadata, and evaluation summary.

## Lifecycle

### 1. Candidate Extraction

Candidate extraction starts from successful workflow evidence:

- canonical `workflow_plan_spec.v2`;
- plan rows and node rows;
- worker outputs and handoffs;
- manager and owner reviews;
- evaluator receipts;
- Human Gate outcome;
- verification results;
- side-effect ledger state;
- runtime events and timing.

The extraction process produces a `workflow_template_spec.v1` candidate, with
variables replacing task-specific values such as workflow id, artifact ids,
agent assignment, instruments, environment, or branch names.

Candidate extraction must record:

- source workflow id;
- source plan id and artifact hash;
- extracted variable set;
- removed task-specific values;
- known risks;
- evaluator recommendation;
- author and reviewer.

### 2. Template Preview

Template preview selects a candidate template and validates whether it fits the
new task. It should return:

- template id and version;
- matched trigger reasons;
- non-trigger warnings;
- variable fill requirements;
- risk and permission gates;
- estimated worker budget;
- expected plan-node hard gates;
- whether Human Gate is required before execution or promotion.

Preview is read-only.

### 3. Template Instantiation

Instantiation fills template variables and produces a `workflow_plan_spec.v2`
candidate. It must then call the existing plan path:

```text
workflow.template.instantiate
  -> workflow.v2.plan.preview
  -> workflow.v2.plan.create
```

The template system must not write worker rows or dispatches directly. Existing
v2 plan, worker, review, evaluator, and Human Gate gates remain authoritative.

### 4. Evaluation

Template evaluation should compare:

- no-template baseline;
- previous template version;
- candidate template version.

Evaluation should run on realistic fixtures and historical replay cases where
possible. Every comparison must use immutable fixture snapshots, isolated run
roots, and comparable arms. Baseline, previous-version, and candidate-version
runs must not share mutable artifacts, caches, worker rows, or plan rows. For
high-risk work, replay must be dry-run/paper-only and must not invoke real side
effects.

Recommended metrics:

- `plan_gate_pass_rate`;
- `execution_success_rate`;
- `receipt_completeness_rate`;
- `evaluator_accept_rate`;
- `owner_revision_rate`;
- `human_gate_return_rate`;
- `duplicate_work_rate`;
- `tool_feedback_completeness`;
- `side_effect_uncertain_rate`;
- `cost_token_delta`;
- `elapsed_time_delta`;
- `freshness_violation_rate`;
- `rollback_readiness_rate`.

### 5. Promotion

Promotion changes which template version is recommended or default. It does not
rewrite historical runs.

Promotion states:

```text
candidate
shadow
active
default
frozen
retired
rolled_back
```

Default promotion requires:

- passing template evals;
- no unresolved P0/P1 safety finding;
- Cat Brain semantic governance review;
- Cat Claw protocol audit for Human Gate-facing templates;
- Human Gate for P0/P1, trading, production, secret, deployment, Gateway,
  OAuth, database, or live side-effect templates.

### 6. Rollback

Rollback should be a metadata change:

- demote current default;
- restore previous active/default version;
- record reason, evidence refs, and actor;
- leave all historical template artifacts intact.

## Reward Model

The reward should score template versions, not give unchecked authority to an
agent. A recommended scoring model:

```text
template_score =
  outcome_score
  + receipt_completeness_score
  + evaluator_acceptance_score
  + human_acceptance_score
  + efficiency_gain_score
  + reuse_success_score
  - safety_penalty
  - duplicate_work_penalty
  - revision_penalty
  - side_effect_uncertainty_penalty
  - freshness_violation_penalty
```

Suggested interpretation:

- high score: eligible for `shadow` or `active`;
- consistently high score: eligible for `default`;
- mixed score: remain `candidate` and request more fixtures;
- low score: freeze or retire;
- safety penalty: freeze immediately until reviewed.

The reward must be explainable. Every score should link to eval cases, receipts,
review artifacts, and Human Gate outcomes where applicable.

## Authorization Model

### Read-Only

Allowed for broader governance users:

- template search;
- template preview;
- template stats;
- template evaluation readout.

### Mutating Template Metadata

Requires `workflow.write` and authorized actor:

- create candidate;
- update candidate;
- record eval;
- freeze, retire, or rollback candidate.

### Promotion

Requires stronger gates:

- Cat Brain governance review for `active`;
- Cat Brain plus Cat Claw audit for Human Gate-facing templates;
- Human Gate for high-risk default promotion.

### Execution

Templates never grant execution authority by themselves. Runtime execution still
requires:

- `runtime_agents` target resolution;
- existing v2 plan create gates;
- worker spawn gates;
- runtime adapter gates;
- side-effect ledger;
- Human Gate when required.

## Integration Points

Initial integration should add a narrow action group:

```text
workflow.template.search
workflow.template.preview
workflow.template.instantiate
workflow.template.eval.record
workflow.template.promote.preview
workflow.template.promote.record
workflow.template.rollback.record
```

The first implementation should keep all execution on existing v2 actions.

The template registry should read:

- `workflow_v2_plans`;
- `workflow_v2_plan_nodes`;
- `workflow_v2_worker_runs`;
- `workflow_v2_manager_reviews`;
- `workflow_v2_owner_reviews`;
- `workflow_verification_results`;
- Human Gate and side-effect tables as evidence sources.

The template registry should write only template tables, artifact index rows,
and template events until an instantiated plan is explicitly created through
`workflow.v2.plan.create`.

## Accuracy And Reuse Measurement

Workflow reuse is valuable only if it improves repeated execution. The system
should report:

- how often a template was selected;
- how often selection was correct;
- whether the generated plan needed manual edits;
- whether repeated runs met acceptance criteria;
- whether evaluator and owner reviews agreed;
- whether Human Gate packages were accepted without return;
- whether execution duplicated worker effort;
- whether token/time cost improved;
- whether side-effect uncertainty decreased.

The key acceptance metric is not exact path compliance. Agents may find
different valid paths. The primary metric is end-state correctness with durable
evidence, bounded cost, and no policy bypass.

## Non-Goals

- Do not auto-edit production default templates without review.
- Do not add arbitrary workflow JavaScript.
- Do not replace `workflow_plan_spec.v2`.
- Do not bypass `workflow.v2.plan.preview/create`.
- Do not treat a single successful workflow as proof of template quality.
- Do not let template reward scores override Human Gate or risk policy.
- Do not store secrets or callback tokens in templates or eval fixtures.

## Open Questions For Implementation

- Should template artifacts live under runtime state root only, or also have a
  versioned schema fixture in Git?
- Should default template selection be deterministic rule-based first, with
  model-based suggestions only as advisory?
- What minimum historical fixture count is required before `default`
  promotion?
- Which actors can approve low-risk default promotion without Human Gate?
- Should template evals reuse `workflow_verification_results`, or use dedicated
  template eval tables plus linked verification rows?
