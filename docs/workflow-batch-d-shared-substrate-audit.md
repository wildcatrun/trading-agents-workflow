# Workflow Batch D Shared Substrate Audit

Date: 2026-07-18

Scope: runtime registry/readiness/topology, message flow, Telegram outbox, Human Gate, protocol records, incident state, side-effect ledger, trade handoff, trading core receipt, workflow events, runtime events, session packs, and session runs.

Status: audit only. This document does not authorize freezing, deleting, forking, or changing runtime behavior.

## Executive Conclusion

Batch D surfaces are not v1 legacy code. They are shared substrate used by both legacy compatibility paths and v2 fixed-template plan execution.

The correct Batch D posture is:

- do not freeze these surfaces as v1 cleanup;
- do not migrate them into a `v2`-named duplicate module;
- do not create a parallel v2 registry, message bus, Human Gate rail, side-effect ledger, trading handoff, or session ledger;
- keep v2 implementation dependent on these shared rails through explicit, audited adapters and action handlers;
- treat any future removal here as a platform re-architecture requiring an approved replacement substrate, not as a legacy-retirement batch.

The reason is structural: v2 fixed-template orchestration is a higher-level plan/state machine. It still needs shared runtime identity, dispatch evidence, delivery evidence, Human Gate decisions, protocol objects, incidents, side-effect uncertainty records, trade intent gates, trading core receipts, events, and durable worker/session state.

## Substrate Ownership Map

| Substrate | Current Surface | V2 Dependency | Freeze Decision | Wrong-Freeze Failure |
| --- | --- | --- | --- | --- |
| Runtime source of truth | `runtime.agent.*`, `workflow.runtime_agents`, `workflow.topology`, `workflow.readiness` | V2 worker backend, runtime dispatch, readiness, and topology all need the global runtime registry. | Forbidden to freeze as v1. | V2 forks agent identity or dispatches against a local registry that disagrees with `runtime_agents`. |
| Governed message bus | `message_flow.send/list/reconcile`, `workflow.message_flow.*` | V2 Human Gate, agent handoff, and local Codex inbox evidence require governed message-flow state and receipt. | Forbidden to freeze as v1. | A direct IM or local inbox path bypasses workflow evidence and receipt. |
| Governed outbox | `telegram.outbox.delivery`, `telegram.outbox.delivery.preview`, `telegram.outbox.requeue*` | V2 Human Gate request creates outbox evidence and leaves delivery to the governed outbox rail. | Forbidden to freeze as v1. | Human Gate request starts sending directly or loses retry/receipt evidence. |
| Human Gate rail | `human_gate.request`, web app, button callback, feedback, resume, inbox, record | V2 Human Gate package/request delegates final request creation to shared Human Gate handlers. | Forbidden to freeze as v1. | V2 treats local receipt or workflow-internal state as human approval. |
| Protocol object ledger | `protocol.record` | Human Gate, trade proposal, risk decision, intent, and trading core receipt are tied together by protocol objects. | Forbidden to freeze as v1. | Approval and trading evidence can no longer prove object binding. |
| Incident rail | `incident.state`, `workflow.incident.*` | V2 closeout, evidence package, and Human Gate escalation need the same incident state model. | Forbidden to freeze as v1. | Incidents split between incompatible legacy/v2 ledgers. |
| Side-effect ledger | `side_effect.record` | V2 and trading workflows need a single uncertainty ledger before external effects. | Forbidden to freeze as v1. | Uncertain side effects can be hidden from readiness and trading gates. |
| Trading handoff | `trade.proposal`, `risk.decision`, `trade.intent`, `trading_core.receipt` | V2 can orchestrate research and approvals, but final executable intent and receipt remain shared trading boundaries. | Forbidden to freeze as v1. | Trading handoff bypasses risk/Human Gate/mtls/idempotency guards. |
| Event timeline | `workflow.event.*`, `workflow.runtime_event.*` | V2 plan, worker, Human Gate, side-effect, and incident evidence needs one timeline. | Forbidden to freeze as v1. | Debug/recovery loses cross-version trace continuity. |
| Session ledger | `workflow.session_pack.*`, `workflow.session_run.*` | V2 worker lifecycle, adapter runner, result submit/fail, and validators depend on session runs. | Forbidden to freeze as v1. | Worker execution loses durable session/run binding and receipt reconstruction. |

## Evidence Summary

### Runtime Registry, Topology, and Readiness

`runtime.agent.*` and `workflow.runtime_agents` are the canonical registry surfaces:

- `runtime-agent-actions.js` registers `runtime.agent` and `runtime.agent.upsert`;
- `ensureRuntimeAgent` normalizes runtime, platform, execution adapter, IM ingress, workflow ingress, return policy, dispatch capability, and start capability;
- `cat_claw` is explicitly constrained to OpenClaw-native registration;
- `topology-actions.js` builds topology and `workflow.runtime_agents` snapshots from the same registry, with `trading-agents-workflow.runtime_agents` as the authority.

These rules are not legacy orchestration. They are the boundary that prevents OpenClaw-only, Hermers/Hermes, Codex, route-shell archive rows, and future runtime adapters from becoming inconsistent local facts.

Batch D decision:

- keep one global registry;
- forbid v2-local agent registry forks;
- allow only explicit runtime adapter fields and readiness views to evolve.

### Message Flow and Telegram Outbox

`message_flow` is the governed delivery/evidence rail. It is distinct from direct OpenClaw message send and distinct from local Codex inbox receipt. The outbox rail is the governed outbound delivery/retry/receipt surface for Telegram-facing Human Gate and formal report delivery.

V2 Human Gate request does not send directly. It prepares or creates a shared Human Gate request and Telegram outbox record, records plan state as waiting for human decision, and returns delivery flags proving the action did not bypass the governed outbox.

Batch D decision:

- keep `message_flow` and Telegram outbox as shared substrate;
- do not add a v2-only message bus;
- do not bypass message-flow/outbox with direct IM delivery for workflow-owned obligations.

### Human Gate and Protocol Records

Human Gate is the final decision rail, not a v1 meeting feature. Shared Human Gate handlers own request creation, web review, button callback, feedback, resume, inbox, and record handling. V2 Human Gate package/request code calls the shared `humanGateRequest` path instead of inventing a new approval store.

`protocol.record` remains the protocol object ledger. It binds records such as trade proposals, risk decisions, Human Gate records, executable trade intents, and trading core receipts. Direct `human_gate_record` writes are intentionally constrained to button-first/internal paths, so v2 cannot treat a local workflow event as Flashcat approval.

Batch D decision:

- keep Human Gate and protocol as shared substrate;
- v2 may prepare packages and state transitions, but final Human Gate evidence must land in the shared rail;
- local Codex inbox receipt must never be interpreted as Human Gate completion.

### Incident, Side Effect, and Trading Boundary

Incident and side-effect surfaces are safety boundaries:

- incident actions maintain state, evidence packages, closeout preview/package, and Human Gate escalation paths;
- side-effect records write to `side_effect_ledger`, redact payloads, hash inputs/outputs, and append workflow events;
- trade actions register `trade.proposal`, `risk.decision`, `trade.intent`, and `trading_core.receipt`;
- executable trade intent is guarded by proposal/risk/Human Gate binding, cat-tail risk decision, Flashcat approval, workflow/trace ids, paper/simulation execution mode, actor, mtls assurance, client certificate fingerprint, idempotency key, and instrument/order validation;
- trading core receipt enforces state transitions, writes receipt artifacts, updates executable intent status, and records a `trading_core_receipt` protocol object.

These surfaces are deliberately stricter than ordinary workflow state. They are the final boundary before external side effects and future trading execution.

Batch D decision:

- keep incident, side-effect, and trading handoff as shared substrate;
- do not create v2-specific trading intent or side-effect ledgers;
- any change that weakens these gates is a trading-safety change, not a cleanup.

### Events, Runtime Events, Session Packs, and Session Runs

Events and sessions are shared evidence rails:

- workflow events carry workflow, trace, task, dispatch, runtime run, message flow, Human Gate, side-effect, and incident identifiers;
- runtime events track runtime/agent state and redacted payloads;
- session packs and session runs provide durable session configuration and run lifecycle state;
- v2 session state imports shared session helpers and patches `workflow_session_runs`;
- v2 worker lifecycle, adapter runner, worker result, and validators read or update shared session runs and synchronize agent-run evidence.

This means session/event surfaces are not old task-launch leftovers. They are the audit and recovery substrate for v2 worker execution.

Batch D decision:

- keep one shared event/session ledger;
- do not rename these surfaces with `v2` unless the same action name has a genuine v1/v2 conflict;
- any future schema migration must preserve cross-version trace continuity.

## Freeze Decision

| Surface | Batch D Decision | Reason |
| --- | --- | --- |
| `runtime.agent.*` | Keep as shared substrate. | It owns canonical runtime identity and dispatch-capability normalization. |
| `workflow.runtime_agents` | Keep as shared substrate. | It is the global roster read surface for operators, v2, readiness, and topology. |
| `workflow.topology` / `workflow.readiness` | Keep as shared substrate. | They derive from the global registry and expose cross-runtime health/readiness facts. |
| `message_flow.*` | Keep as shared substrate. | It is the governed cross-runtime message and receipt rail. |
| `telegram.outbox.*` | Keep as shared substrate. | It is the governed outbound delivery/retry/receipt rail. |
| `human_gate.*` | Keep as shared substrate. | It is the final approval and resume rail for both legacy compatibility and v2. |
| `protocol.record` | Keep as shared substrate. | It binds proposal, risk, Human Gate, intent, and receipt objects. |
| `incident.*` | Keep as shared substrate. | Incident state and closeout evidence cannot fork by workflow version. |
| `side_effect.record` | Keep as shared substrate. | Side-effect uncertainty must be globally visible before retry/recovery/trading decisions. |
| `trade.*` / `trading_core.receipt` | Keep as shared substrate. | Trading handoff and receipt are safety boundaries, not orchestration-version internals. |
| `workflow.event.*` / `workflow.runtime_event.*` | Keep as shared substrate. | Audit, recovery, and timeline continuity require one event rail. |
| `workflow.session_pack.*` / `workflow.session_run.*` | Keep as shared substrate. | V2 worker lifecycle and adapter runner already depend on shared session runs. |

## Guardrails for Future Work

1. Do not use `v2` in a new action/module name just because the new caller is v2. Use `v2` only when the code is genuinely scoped to v2 plan/node/worker semantics or when a same-purpose v1 surface must coexist during migration.
2. Do not duplicate shared substrates under v2 names. Extend the shared substrate with version-neutral fields, adapters, or schema migrations when needed.
3. Do not freeze a shared substrate because legacy code also calls it. A caller can be legacy while its dependency is shared infrastructure.
4. Do not add direct IM, Telegram, local Codex inbox, OpenClaw message-send, trading-core, or side-effect shortcuts that bypass shared action handlers.
5. Do not treat documentation-only Batch D classification as permission to delete code. Deletion requires a later batch with replacement ownership, caller audit, live-state audit, and regression evidence.

## Regression Plan Before Any Future Substrate Change

Before changing, freezing, or removing any Batch D surface, run at minimum:

- `npm run check:freeze`;
- runtime registry/topology/readiness regression proving no v2-local registry fork and no route-shell fallback;
- message-flow regression proving governed send/list/reconcile and receipt evidence remain intact;
- Telegram outbox preview/delivery/requeue regression proving no direct Human Gate delivery bypass;
- Human Gate package/request/button/inbox/resume regression proving shared Human Gate evidence and protocol bindings remain intact;
- protocol object regression proving direct Human Gate record writes remain blocked except approved internal/button paths;
- incident closeout package/request regression proving evidence and Human Gate escalation still use shared state;
- side-effect ledger regression proving uncertain side effects remain visible and block unsafe progression;
- trading pre-execution smoke proving proposal/risk/Human Gate/idempotency/mtls/paper gates remain enforced;
- workflow event/runtime event regression proving redaction, hash, and trace identifiers remain intact;
- v2 worker lifecycle, adapter runner, result, and validation smoke proving shared session runs remain durable;
- full `npm run check`;
- full `npm run smoke:release`;
- server runtime state postcheck against active checkout and live state root.

Any failed test means the surface is still necessary or replacement ownership is incomplete; revert the attempted freeze and update this audit.

## Regression Matrix

| Substrate | Minimum Command / Test | Pass Signal | Rollback Signal |
| --- | --- | --- | --- |
| Runtime registry/topology/readiness | `npm run check:freeze` plus runtime registry/topology/readiness regression in `scripts/workflow_regression_tests.mjs` | no v2-local registry, no active route-shell fallback, registry-derived topology/readiness still works | restore shared `runtime_agents` reads and remove forked registry path |
| Message flow/outbox | `npm run smoke:release` message-flow and Human Gate delivery-preview/gateway-delivery commands | governed message-flow/outbox evidence exists; Human Gate request does not directly send | revert direct IM/outbox bypass and restore `message_flow`/`telegram_outbox` handlers |
| Human Gate/protocol | `npm run smoke:release` Human Gate package/request/delivery guard commands | shared Human Gate request/protocol objects are created; local Codex receipt is not approval | revert v2-local approval store and restore shared `humanGateRequest` / `protocol.record` path |
| Incident/side-effect/trading | `npm run smoke:v2-trading-pre-execution` and `npm run smoke:trading-core` | side-effect uncertainty, proposal/risk/Human Gate/idempotency/mtls/paper gates remain enforced | block trading progression and restore shared safety/trading handlers |
| Event/runtime-event/session | `npm run smoke:v2-external-runner`, `npm run smoke:v2-non-trading-rehearsal`, and session/event regressions | v2 worker lifecycle has durable session runs, events, receipts, and validation evidence | revert session/event schema or handler change and preserve shared trace continuity |
| Full release posture | `npm run check`, `npm run smoke:release`, server release smoke, plugin registry refresh, `main` workspace invariant | local and server checks pass against active checkout and live state root | revert the batch commit or keep substrate unchanged until replacement ownership is proven |
