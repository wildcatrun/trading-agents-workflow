# Development Log 2026-05-31 P1.3a Controlled Hard Gates

This log records the controlled hard-enforcement continuation after P1.3
permission policy outcomes.

## Goal

Turn the policy layer from advisory-only into a real fail-closed gate for the
smallest trading-sensitive surface that already has stable evidence fields:

- `trade.intent`
- `trading_core.receipt`

`workflow.permission.check` remains read-only and returns a policy verdict; it
does not throw.

Later P1.4 work expanded the same selected hard-gate mechanism to governed
`workflow.pause` / `workflow.resume` / `workflow.stop` execution. This P1.3a log
keeps the original trading-handoff scope.

## Scope Completed

- Added a narrow hard-gate action set for `trade.intent` and
  `trading_core.receipt`.
- `authorizeWorkflowAction()` now records `permission.policy_blocked` and
  throws when one of those actions has `actionable=false`.
- Preserved the capability layer: `allowed=false` still produces
  `permission.denied`; policy blocks are separate events and messages.
- Updated regression coverage so existing trade-chain tests pass explicit
  Human Gate, Cat Claw audit, and freshness evidence before testing business
  guardrails.
- Added hard-block regressions for:
  - missing Human Gate evidence;
  - missing freshness evidence;
  - workflow-scoped uncertain side effects;
  - `trading_core.receipt` policy, which does not require Cat Claw audit.
- Updated CLI/plugin command inputs so `trade-intent` and
  `trading-core-receipt` can pass the evidence fields required by the hard
  gate.
- Updated the local `trading_core` contract smoke so the workflow receipt action
  carries Human Gate and freshness evidence.

## Enforcement Boundary

This is intentionally not global enforcement. Other high-risk actions still use
the P1.3 policy verdict as an operator/controller signal until their evidence
inputs, migration coverage, and rollback behavior are stable.

The current hard evidence contract is:

- `trade.intent`: Human Gate evidence, Cat Claw audit evidence, freshness
  evidence, and no unresolved side-effect uncertainty for the workflow.
- `trading_core.receipt`: Human Gate evidence, freshness evidence, and no
  unresolved side-effect uncertainty for the workflow.

## Verification Commands

The following checks passed after implementation:

```bash
npm run check
npm run test:regression
npm run smoke:trading-core
git diff --check
```

## Subagent Review

Spark reviewer `Euler` reviewed the intended hard-gate cut point and called out
the needed evidence updates for regression tests and the `trading_core` smoke.
Those findings were incorporated before final verification.

## Next Step

Keep the next enforcement expansion conservative. Candidate surfaces are
`risk.decision`, `trade.proposal`, and selected `side_effect.record` paths, but
only after their callers consistently pass Cat Claw audit and freshness
evidence.
