---
name: workflow-self-evolution
description: Design, evaluate, and govern reusable trading-agents workflow templates, including template extraction from successful workflow_plan_spec.v2 runs, A/B evaluation, promotion, rollback, and Human Gate safe self-evolution.
---

# Workflow Self Evolution

Use this skill when the task is to create, review, evaluate, promote, demote,
or improve reusable `trading-agents-workflow` plan templates.

This skill is for governance and template design. It must not directly run
workers, change production workflow state, execute runtime adapters, or bypass
Cat Brain, Cat Claw, runtime registry checks, or Human Gate.

## Core Rule

Keep three asset types separate:

- Skill: procedural knowledge for how to choose, instantiate, evaluate, and
  evolve workflow templates.
- Template JSON: governed reusable `workflow_template_spec.v1` artifacts with
  variables, policy, evaluation, and promotion metadata.
- Instantiated plan JSON: `workflow_plan_spec.v2`, produced only after template
  variables are filled and the result is passed through existing v2 plan
  preview/create gates.
- Database rows: indexes, version status, permissions, statistics, and eval
  results. The canonical template body remains an artifact, not ad hoc text.

## Required Reading

For detailed design, read:

- `docs/workflow-v2-self-evolution-skill.md`
- `docs/workflow-v2-self-evolution-implementation-plan.md`
- `docs/workflow-v2-implementation-status.md` when checking current runtime
  support.
- `docs/workflow-v2-anthropic-alignment-audit.md` when checking Anthropic
  alignment.

## Workflow

1. Classify the requested evolution action:
   - extract candidate template from successful workflow;
   - create a new template;
   - instantiate an existing template;
   - evaluate template version;
   - promote, demote, freeze, retire, or rollback a template.
2. Start from existing durable evidence:
   - `workflow_plan_spec.v2` artifact;
   - `workflow_v2_plans` and `workflow_v2_plan_nodes`;
   - manager/owner review receipts;
   - evaluator receipts;
   - Human Gate records;
   - verification and side-effect evidence.
3. Preserve the current v2 execution rails:
   - instantiate templates through `workflow.v2.plan.preview`;
   - persist only through `workflow.v2.plan.create`;
   - let existing plan-node, worker lifecycle, autonomous-loop, evaluator, and
     Human Gate hard gates enforce execution.
4. Evaluate before promotion:
   - compare against no-template and previous-template baselines;
   - measure pass rate, revision rate, token/time cost, receipt completeness,
     Human Gate return rate, duplicate work rate, and side-effect uncertainty;
   - record evidence and residual risks.
5. Apply promotion policy:
   - low-risk templates may become default candidates after passing eval and
     Cat Brain/Cat Claw review;
   - P0/P1, trading, production, secret, deployment, Gateway, OAuth, database,
     or live side-effect templates require explicit Human Gate before default
     promotion.

## Guardrails

- Do not treat a successful single run as a template promotion.
- Do not let an agent auto-edit an active default template without review.
- Do not store secrets, tokens, raw trading account data, or callback tokens in
  template artifacts, eval fixtures, or logs.
- Do not use template reuse to skip freshness checks, side-effect ledgers,
  evaluator receipts, or Human Gate.
- Do not create arbitrary JavaScript workflow scripts. Templates are JSON specs
  plus governed runtime actions.

## Output Shape

When proposing a template change, return:

- template id and version;
- source workflow or rationale;
- trigger and non-trigger conditions;
- variable schema;
- risk tier and capability policy;
- evaluation fixtures and rubric;
- promotion criteria;
- rollback plan;
- authorization required before implementation.
