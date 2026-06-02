# Development Log 2026-05-31 P1.3 Permission Policy

This log records the P1.3 permission policy continuation of the Claude Code
workflow reference program for `trading-agents-workflow`.

## Goal

Extend `workflow.permission.check` from a capability-only verdict into a
two-layer policy gate that can tell operators and controllers when a high-risk
action still needs Human Gate evidence, Cat Claw audit, freshness evidence, or
side-effect uncertainty resolution.

## Scope Completed

- Added policy fields to permission decisions:
  - `policyOutcome`
  - `requirements`
  - `policyWarnings`
  - `actionable`
- Preserved existing `allowed`, `reason`, `risk`, and `requiredCapability`
  semantics.
- Added policy requirement flags to high-risk and trading-sensitive action
  rules.
- Added side-effect uncertainty detection for high/critical risk actions scoped
  by `workflowId`.
- Added regression coverage for each policy outcome family.

## Policy Outcomes

Supported outcomes:

- `allow`
- `deny`
- `requires_human_gate`
- `requires_cat_claw_audit`
- `requires_freshness_check`
- `side_effect_uncertain`

`allowed=false` remains a hard capability/registration denial. `allowed=true`
with `actionable=false` means the caller has the capability, but the action
still lacks required governance evidence.

## Initial Requirements

The initial policy maps:

- Cat Claw audit: task-launch review/approval, workflow advance, schedule
  upsert, runtime registry changes, Telegram live config, Human Gate
  request/record, trade proposal, risk decision, and side-effect record.
- Human Gate evidence: trade intent and trading-core receipt handoff.
- Freshness evidence: trade proposal, risk decision, trade intent, and
  trading-core receipt.
- Side-effect uncertainty: any high/critical risk action scoped to a workflow
  with uncertain side-effect ledger entries.

## Compatibility Boundary

This release does not globally hard-block every existing write action when
`actionable=false`. That is intentional: many legacy/internal paths do not yet
pass Cat Claw audit ids, freshness evidence ids, or Human Gate ids. Hard
enforcement should be enabled action by action after each path has stable
evidence inputs, migration coverage, and rollback behavior.

## Verification Commands

The following checks passed after implementation:

```bash
npm run check
npm run test:regression
git diff --check
```

## Next Step

Controlled hard enforcement for `trade.intent` and `trading_core.receipt` was
implemented in `development-log-2026-05-31-p1.3a-hard-gates.md`.
