# Pre-Order Risk Audit

`pre_order_risk_audit` is the only workflow dispatch type that routes a Human Gate approved trading package to Cat Tail (`cat_tail`).

This is a narrow last-mile trading gate. It is not a general Human Gate follow-up path. Most approved Human Gates resume to cat-brain `main` or the owning workflow. Only a workflow that is preparing an order intent may create this dispatch.

Required chain:

```text
trade_proposal
-> research evidence package
-> cat_claw evidence audit
-> Human Gate approval
-> openclaw:cat_tail pre_order_risk_audit
-> risk_decision
-> executable_trade_intent
-> trading_core
```

Human Gate approval authorizes entry into Cat Tail's final risk audit. It does not authorize direct `trading_core` execution.

## Dispatch Contract

A `pre_order_risk_audit` dispatch must target:

- `runtime=openclaw`
- `agent_id=cat_tail`
- `dispatch_type=pre_order_risk_audit`

The dispatch payload must include:

- `workflowId`
- `traceId`
- `proposalId`
- `humanGateId`
- `humanGateButtonId` or equivalent selected option id
- `flashcatOriginalWords`
- `evidenceRefs`
- proposed `symbol`, `side`, `quantity`, `orderType`, `priceConstraints`, and `riskLimits`
- `idempotencyKey`

The dispatch must not contain broker credentials, exchange secrets, or live order tokens.

## Cat Tail Output

Cat Tail must produce two linked artifacts:

- a human-readable Chinese risk paper
- a machine-readable `risk_decision`

Current paper-only decisions are:

- `approved_for_paper_execution`
- `rejected`

Future live decisions are reserved but not executable until a separate live-readiness and Human Gate process enables them:

- `approved_for_live_execution`
- `approved_for_live_execution_with_limits`

The `risk_decision` object must include `reviewerAgent=cat_tail`, `dispatchType=pre_order_risk_audit`, the approved Human Gate id, evidence refs, hard risk limits, and a `preOrderRiskAuditId`. `trading_core` requires the resulting `executable_trade_intent` to carry both `riskDecisionId` and `preOrderRiskAuditId`.

## Non-Goals

Cat Tail does not review every Human Gate. Cat Tail does not create executable trade intents for non-trading workflow approvals, does not bypass Cat Claw's evidence audit, and does not place orders directly. `trading_core` remains the deterministic execution boundary and may reject any intent even after Cat Tail approves the risk decision.
