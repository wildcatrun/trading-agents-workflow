# Workflow v2 Self-Evolution Implementation Plan

Status: proposed, awaiting Flashcat authorization
Created: 2026-07-05
Scope: `trading-agents-workflow`

## Goal

Implement a governed workflow self-evolution layer that can extract, store,
evaluate, and promote reusable workflow templates while reusing existing
`workflow.v2` execution rails.

This plan is intentionally staged. It does not authorize runtime deployment,
database migration on the development server, Gateway restart, Docker worker
activation, or production execution by itself.

## Principle

The first implementation must maximize reuse of existing v2 surfaces:

- keep `workflow_plan_spec.v2` as the instantiated plan output;
- keep `workflow.v2.plan.preview/create` as the only plan admission path;
- keep worker spawn, lifecycle, autonomous-loop, evaluator, owner review, Cat
  Brain, Cat Claw, and Human Gate gates unchanged;
- add template registry and evaluation as a layer above plan creation, not as a
  second workflow engine.

## Phase 0: Design Package

Status: this document package.

Deliverables:

- `skills/workflow-self-evolution/SKILL.md`;
- `docs/workflow-v2-self-evolution-skill.md`;
- `docs/workflow-v2-self-evolution-implementation-plan.md`;
- independent subagent review;
- Flashcat authorization request.

Acceptance:

- no runtime code changes;
- no database migration;
- no Gateway reload/restart;
- clear decision boundary for implementation authorization.

## Phase 1: Template Schema And Local Pure Helpers

Scope:

- Add `src/workflow-v2/template.js` pure helpers.
- Define `workflow_template_spec.v1` normalization.
- Define template id/version/status enums.
- Add validation helpers for:
  - required metadata;
  - trigger/non-trigger conditions;
  - variable schema;
  - risk policy;
  - permission policy;
  - plan skeleton;
  - eval policy;
  - promotion policy;
  - rollback policy.

Actions:

- `workflow.template.preview` as a pure read-only preview with no DB writes.
- Unit/regression tests with fixture JSON only.

Acceptance:

- `node --check` passes.
- Template preview rejects malformed candidate specs.
- Template preview can render an instantiation input for
  `workflow.v2.plan.preview`.
- No SQLite schema change yet.

## Phase 2: Template Registry Schema

Scope:

Add local schema tables:

```text
workflow_v2_template_specs
workflow_v2_template_versions
workflow_v2_template_events
workflow_v2_template_evals
workflow_v2_template_stats
```

Minimal fields:

`workflow_v2_template_specs` is the family-level registry row:

- template id;
- family status;
- owner agent;
- default version;
- active version;
- risk tier;
- allowed capabilities;
- selection tags;
- created/updated timestamps.

`workflow_v2_template_versions` is append-only version history:

- template id;
- version;
- version status;
- artifact ref;
- artifact hash;
- source workflow id and plan id;
- promotion state for that version;
- created_by;
- created_at;
- payload hash and redacted payload.

`workflow_v2_template_specs` must not duplicate canonical artifact refs or
version payloads. `workflow_v2_template_versions` must not become the family
selection policy owner except through explicit default/active pointers on the
family row.

Actions:

- `workflow.template.record_candidate`
- `workflow.template.search`
- `workflow.template.get`

Acceptance:

- migrations are idempotent;
- canonical template JSON is stored as an artifact;
- DB row points to artifact and hash;
- no worker or plan execution side effects.

## Phase 3: Instantiate Through Existing v2 Plan Rails

Scope:

- Add `workflow.template.instantiate.preview`.
- Add `workflow.template.instantiate.record` only if it delegates to
  `workflow.v2.plan.create`.

Rules:

- The action fills template variables and returns a candidate
  `workflow_plan_spec.v2`.
- It must call or reuse `workflow.v2.plan.preview` before write.
- It must not write worker rows directly.
- It must not bypass plan-node hard gates.

Acceptance:

- bad template variables fail before plan create;
- executable hard gates still fail through existing v2 plan create;
- direct-owner, manager-worker, autonomous-loop, and evaluator-optimizer
  templates have focused regression tests.

## Phase 4: Evaluation And Reward Ledger

Scope:

- Add template eval record and summary actions.
- Store evaluation cases as artifacts.
- Record metrics and evidence refs.

Actions:

- `workflow.template.eval.preview`
- `workflow.template.eval.record`
- `workflow.template.stats.refresh`

Metrics:

- plan gate pass rate;
- execution success rate;
- receipt completeness;
- evaluator acceptance;
- owner revision rate;
- Human Gate return rate;
- duplicate work rate;
- tool feedback completeness;
- side-effect uncertainty;
- token/time delta;
- freshness violation;
- rollback readiness.

Acceptance:

- eval records are append-only;
- evals use immutable fixture snapshots and isolated run roots;
- baseline, previous-version, and candidate-version arms do not share mutable
  artifacts, caches, worker rows, or plan rows;
- at least one comparable run is recorded for each evaluated arm before a score
  can influence promotion;
- reward score is explainable and evidence-linked;
- score cannot promote a template by itself;
- safety penalties freeze promotion eligibility.

## Phase 5: Promotion, Rollback, And Authorization Gates

Scope:

- Add status transitions for candidate, shadow, active, default, frozen,
  retired, and rolled_back.
- Add preview and record actions for promotion and rollback.

Actions:

- `workflow.template.promote.preview`
- `workflow.template.promote.record`
- `workflow.template.rollback.record`

Authorization:

- low-risk active promotion requires Cat Brain review;
- Human Gate-facing active promotion requires Cat Brain plus Cat Claw review;
- P0/P1 or trading/production/secret/deployment/Gateway/OAuth/database/live
  side-effect default promotion requires Human Gate.

Acceptance:

- one default version per template family;
- rollback restores previous default metadata without deleting artifacts;
- promotion creates a template event and links eval evidence;
- high-risk promotion cannot be recorded without required approvals.

## Phase 6: Candidate Extraction From Successful Workflows

Scope:

- Extract candidate templates from completed workflows.
- Replace task-specific values with variable placeholders.
- Link source evidence.

Actions:

- `workflow.template.extract.preview`
- `workflow.template.extract.record`

Acceptance:

- extraction requires successful owner review or closeout evidence;
- extraction refuses workflows with unresolved side-effect uncertainty unless
  explicitly marked as a negative or cautionary template;
- extracted template starts as `candidate`;
- no automatic promotion.

## Phase 7: Console And MCP Visibility

Scope:

- Add read-only console views for templates, evals, and promotion status.
- Add MCP read tools after core CLI/action behavior is stable.

Acceptance:

- operators can see template version, status, score, last eval, default flag,
  risk tier, and rollback target;
- no callback token, secret, raw trading account data, or sensitive payload leak;
- MCP remains capability-scoped.

## Testing Strategy

Focused tests:

- template schema validation;
- candidate artifact write and hash;
- instantiate preview to `workflow.v2.plan.preview`;
- hard gate preservation for existing v2 patterns;
- eval record append-only behavior;
- reward score calculation;
- promotion gate failures;
- rollback metadata behavior;
- redaction checks.

Required commands before each implementation merge:

```text
node --check src/workflow.js
node --check src/workflow-v2/index.js
node --check src/workflow-v2/template.js
node --check scripts/workflow_regression_tests.mjs
node scripts/workflow_regression_tests.mjs --grep "workflow template"
node scripts/workflow_regression_tests.mjs --grep "workflow v2"
git diff --check
```

## Rollout Plan

Local only:

1. Implement pure helpers and tests.
2. Implement local SQLite migration and tests.
3. Implement instantiate preview and record through existing v2 plan rails.
4. Implement eval and promotion metadata.

Development server:

1. Commit and push to GitHub.
2. Pull active checkout with `git pull --ff-only`.
3. Run read-only and focused smoke.
4. Do not restart Gateway unless separately authorized.

Runtime activation:

- Do not enable default template selection for live workflows until enough
  evaluation data exists.
- Start with read-only search/preview.
- Then allow candidate extraction.
- Then allow low-risk explicit instantiation.
- Then consider default recommendation.

## Implementation Authorization Request

Approval requested for Phase 1 only after this design package is accepted:

- add template pure helpers;
- add skill/docs references if needed;
- add focused local tests;
- no DB migration;
- no development-server deployment;
- no Gateway restart;
- no runtime adapter execution.

Later phases require separate authorization after Phase 1 review.
