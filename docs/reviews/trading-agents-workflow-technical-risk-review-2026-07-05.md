# Trading Agents Workflow Technical Risk Review

Date: 2026-07-05
Scope: `wildcatrun/trading-agents-workflow` main branch after workflow v2 template self-evolution landed.
Focus: pre-live P0/P1 risk convergence, not feature expansion.

## Source Note

This review is based on the local workstation note `workflow改进意见.txt`.
The note requested a review of the current GitHub `main` branch and highlighted
deployment reproducibility, executable checks, trading intent hard gates,
console/MCP mutation policy, and environment information hygiene.

## Current Main Snapshot

- `src/workflow.js` is present and non-empty in current main.
- `src/core.js`, `src/console/action-gateway.js`, and `src/console/server.js`
  can import the expected workflow exports from `src/workflow.js`.
- Existing `package.json` `check` coverage was mostly syntax-level before this
  review round. This review adds a module-load/action-smoke check so CI/local
  checks prove more than parseability.
- Trading intent hard gates already exist for Human Gate, Cat Claw audit,
  freshness evidence, Cat Tail pre-order risk audit, risk decision binding,
  expiry, idempotency, and local Codex mTLS-like assurance. The remaining P1
  work is mostly schema-level ledger hardening and production operator policy.

## P0 Findings

### P0-1: Reproducible deployment source

Original risk: `src/workflow.js` was described as empty, while core and console
modules depended on it for `runWorkflowAction`, `workflowStatus`,
`canonicalWorkflowAction`, and `workflowPaths`.

Current status: mitigated in current main. `src/workflow.js` is populated and
exports the expected functions. The risk should remain tracked because a future
bad publish that empties or omits this file would make the GitHub source
unusable as a reproducible deployment source.

Required guard: the repository check must import the core workflow module and
exercise a minimal action path.

### P0-2: `check` must prove loadability and executable recovery

Original risk: syntax checks do not prove the core module can load, initialize
schema, execute a status action, or recover through an isolated local root.

Current status: addressed in this review round by `scripts/workflow_core_smoke.mjs`.

Required guard:

- import `src/workflow.js` exports directly;
- import `src/core.js` and verify `runAction`;
- create an isolated temporary workflow root;
- run `workflow.status` through both `workflowStatus` and `runWorkflowAction`;
- verify canonical action aliasing still works;
- verify the initialized SQLite path exists.

### P0-3: Documentation and code status must stay aligned

Original risk: documents claimed v2 kernel/action registry/worker lifecycle
implementation while handler injection depended on `src/workflow.js`.

Current status: mitigated by the same module smoke. Documentation status should
continue to reference executable checks, not only design documents or syntax
checks.

## P1 Findings

### P1-1: `trade.intent` hard gate completeness

Required live boundary: `trade.intent` must require proposal, evidence pack,
Cat Claw audit, Human Gate approval, Cat Tail pre-order risk audit,
`risk_decision`, freshness, `expiresAt`, `riskLimits`, idempotency, and mTLS
identity.

Current status: partially implemented. Current code and regression tests cover
the narrow governed path through `trade_proposal`, Human Gate, Cat Tail
`pre_order_risk_audit`, approved `risk_decision`, expiry, risk limit matching,
idempotency, and local Codex mTLS-like assurance. Remaining work is to make the
evidence-pack shape stricter and make live/paper mode separation explicit in the
ledger.

### P1-2: `executable_trade_intents` schema hardening

Required live boundary: schema-level `CHECK`, references, immutable ledger, and
hash-chain semantics. Application-only validation is not enough for live trade
handoff.

Current status: not complete. Existing schema has idempotency and status indexes,
but not a full immutable append-only ledger or hash chain.

Next action: create a dedicated migration plan before live use. Do not mix this
with unrelated workflow v2 feature work.

### P1-3: Console token and signed operator action

Required live boundary: console token must not default empty in production.
Non-loopback listening or enabled write actions must require a token. Enabled
write actions must require a signed operator action.

Current status: addressed for this review round. Console startup now fails
closed when non-loopback or write-enabled mode lacks a token, and write-enabled
mode also requires a signing secret. `/api/actions` mutations must carry a valid
HMAC signature over the raw request body.

### P1-4: MCP raw action and schedule mutation policy

Required live boundary: MCP raw actions and schedule mutation should be governed
per actor/runtime/action/risk tier/Human Gate state, not by a coarse environment
toggle.

Current status: not complete. Existing MCP surfaces are still mixed: some are
read-only, while mutating paths rely on capability mode and environment/config
boundaries.

Next action: design a shared per-action policy evaluator for MCP and console
actions before adding any new mutating MCP surfaces.

### P1-5: Runtime environment information hygiene

Required live boundary: README/MCP/CLI documentation should not expose real IPs,
local absolute paths, SSH key paths, Telegram chat ids, or other operational
environment identifiers.

Current status: partially addressed by existing redaction discipline, but public
docs still include environment examples and historical operational details.

Next action: run a dedicated docs scrub pass and replace real operational values
with placeholders unless the value is intentionally public and non-sensitive.

## P2 Findings

- Split protocol, database, and v2 schema version constants.
- Make JSONL readers tolerate malformed lines consistently.
- Put trading-critical state transitions into explicit SQLite transactions.
- Extend the control loop with market calendar, data freshness, account,
  position/order state, kill switch, incident freeze, and paper/live isolation.
- Treat every agent input as untrusted text; LLM output may propose but
  deterministic validators must generate trading parameters.

## Recommended Tracking

Open one P0/P1 GitHub issue for this review round:

Title: `P0/P1 workflow pre-live risk convergence`

Initial checklist:

- P0: keep `workflow_core_smoke` in `npm run check`.
- P1: finish `executable_trade_intents` immutable ledger/hash-chain migration.
- P1: move MCP mutation surfaces to per-action policy.
- P1: scrub public docs for real operational environment details.
- P2: schedule schema-version split and JSONL bad-line tolerance.

## Rollout Boundary

This review round does not authorize live trading, production database migration,
Gateway restart, development-server checkout sync, or automatic template
selection for live workflows.
