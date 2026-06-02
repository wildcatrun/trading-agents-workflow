# Development Log 2026-05-31 P1.5 Dead-Letter Observability

This log records the P1.5 observability slices completed on 2026-05-31.

## Goal

Collect scattered stuck/dead-letter signals into one operator-facing read model
without adding automatic repair, retry, cancellation, or delivery behavior.

## Scope Completed

- Added `deadLetters` and `deadLetterSummary` to the Operations read model.
- Added a `Dead-Letter / Stuck Attention` section to the existing Operations
  tab.
- Covered these attention families:
  - failed or max-attempt control-loop jobs;
  - expired running job leases;
  - dispatches at max attempts;
  - stuck Human Gate button feedback;
  - uncertain side-effect ledger rows;
  - stale `message_flow` rows that require visible delivery but still have no
    delivery receipt.
- Preserved existing scoped and global operations views.
- Redacted token-like text in details before console output.
- Kept `message_flow` dead-letter matching narrow: only
  `reply_to_source_chat` / `report_to_flashcat` return policies, excluding
  `silent`, `local_codex`, `codex`, recent rows, and rows with an existing
  delivery receipt.
- Added `workflow_dead_letter_evidence.v1` as a read-only single-item evidence
  bundle for Operations dead-letter rows. It returns the primary row plus
  limited related dispatch, runtime run, message_flow event, outbox, Human Gate,
  side-effect, and control-loop job evidence.
- Added read-only dead-letter filters for kind, severity, status, and result
  limit in the Operations read model; the console exposes kind, severity, and
  status selectors in the existing Operations tab.
- Added a read-only console affordance from a single dead-letter evidence
  bundle to the full workflow evidence pack.
- Added `workflow_incident_candidate.v1` inside the single-item evidence bundle
  as a read-only incident escalation preview. It records suggested severity,
  affected planes, evidence references, next actions, exit criteria, and the
  rollback boundary without writing `incident_states`.
- Added governed incident linkage actions:
  `workflow.incident.from_dead_letter.preview` is read-only, while
  `workflow.incident.from_dead_letter` requires Human Gate evidence,
  Cat Claw/secretary audit evidence, and an operator reason before it can
  persist a linked incident.
- Added a console affordance that exposes incident linkage as a two-step flow:
  `Incident Preview` first, then a guarded evidence form. The form can submit
  only the governed action; backend read-only/write allowlist/policy gates still
  decide whether execution is accepted.
- Added `GET /api/workflows/:workflowId/incident-evidence-options` as a
  read-only candidate selector for the form. It derives Human Gate options from
  Human Gate records/buttons and Cat Claw audit options from secretary-audit or
  Cat Claw verification results.
- Added structured recommendation reasons to each selector candidate, covering
  same-workflow scope, Cat Claw source, secretary-audit type, positive
  status/decision, and references to the selected dead-letter evidence when
  available. The console shows these reasons in both select labels and the
  Evidence Options tables.
- Added `GET /api/workflows/:workflowId/incident-closeout` and the console
  `Incidents` tab. This read-only view links incident state, workflow incident
  events, incident timeline notes, dead-letter evidence, selector evidence,
  Human Gate readiness, receipts, and checkpoints into a closeout checklist.
  It reports whether incident state, current dead-letter evidence, Human Gate
  evidence, Cat Claw audit, operator reason, rollback boundary,
  `incident_state_only` side-effect boundary, and final receipt/checkpoint
  evidence are present.

## Safety Boundary

This is read-only observability. It does not:

- retry control-loop jobs;
- cancel expired leases;
- reconcile dispatches;
- resend Telegram outbox;
- resume or submit Human Gate;
- mutate side-effect ledger rows;
- create incidents from dead-letter rows automatically;
- persist incident candidates from dead-letter rows without governed evidence;
- open Human Gate requests from dead-letter rows;
- retry, reconcile, deliver, or repair from dead-letter rows;
- change workflow, runtime, or trading state.

## Verification Commands

The following checks passed after implementation:

```bash
npm run check
npm run test:regression
git diff --check
```

Regression coverage inserts representative failed jobs, expired leases,
max-attempt dispatches, stuck Human Gate feedback, uncertain side effects, and
stale `message_flow` delivery gaps. It checks workflow scoping, token redaction,
invalid query-window fallback, and false-positive exclusions for `silent`,
`local_codex`, present delivery receipts, and recent rows.
Filter regression coverage checks `deadLetterKind`, `deadLetterSeverity`,
`deadLetterStatus`, `deadLetterLimit`, and that generic `limit` does not
truncate dead-letter results without changing the underlying predicates.

The single-item evidence regression covers a `message_flow` dead-letter row and
checks primary evidence, related dispatch/runtime/outbox/event rows, workflow
scoping, invalid request fallback, incident candidate generation, no
`incident_states` mutation, no workflow/dispatch/runtime/outbox/Human Gate/
side-effect count mutation, and nested `*_json` token redaction.
The governed incident linkage regression checks read-only preview behavior,
policy blocking when Human Gate/Cat Claw evidence is missing, successful
incident persistence when evidence is present, secret redaction in persisted
incident payloads, warning-to-monitoring status mapping, and that no workflow,
dispatch, runtime, outbox, Human Gate, or side-effect rows are mutated.
Action-gateway regression also checks console preview allowlisting, default
write rejection, explicit write-enabled execution, and workflow operation
redaction for the guarded form path.
Evidence-option regression checks the read-only selector, workflow route
mapping, recommended Human Gate/Cat Claw audit candidates, and selector
redaction.
Incident-closeout regression checks the read-only closeout endpoint, route
mapping, linked incident selection from `deadLetter.workflowId`, checklist
items, incident-created timeline evidence, no-mutation guarantees, and redaction
of operator/Human Gate/audit secrets.

Playwright console smoke was run on 2026-06-01 against a temporary workflow root
at `/private/tmp/taw-console-selector-smoke-sK8JQt` and local console
`http://127.0.0.1:18794`. The smoke opened the existing console, navigated to
Operations, opened a dead-letter evidence row, launched Incident Preview, and
confirmed that Human Gate and Cat Claw Audit controls render as select boxes
with redacted candidate labels. Selecting both candidates and submitting in
preview-only mode reached the execute path and was rejected by the console
allowlist; `incident_states` stayed at `0`.

P1.6 Playwright smoke reused the temporary root after creating a governed
dead-letter incident with `workflow.incident.from_dead_letter`. The smoke
confirmed that the `Incidents` tab renders `workflow_incident_closeout.v1`,
shows all eight checklist items, displays incident-created workflow timeline
evidence, redacts the operator reason token, and that the overview `Open
Incidents` count recognizes incidents linked through
`payload.deadLetter.workflowId`.

## P1.7 Closeout Package Preview

Added two closeout follow-up preview actions:

- `workflow.incident.closeout.cat_claw_report.preview`
- `workflow.incident.closeout.human_gate_package.preview`

Both actions derive from `workflow_incident_closeout.v1` and return
`workflow_incident_closeout_preview.v1`. They prepare Chinese draft material for
Cat Claw secretary review or a Human Gate closeout package, including checklist
status, evidence refs, gaps, warnings, and Human Gate A/B/C plus pause/terminate
option structure. The write boundary remains zero-write: no artifacts, incident
state updates, workflow events, Human Gate rows, buttons, Telegram outbox,
runtime dispatch, job retry, or workflow status mutation.

The console `Incidents` tab now exposes both previews as buttons beside the
selected incident. The action gateway allowlist includes these preview actions
only; no corresponding write action was added.

## P1.8 Closeout Artifact Persistence

Added `workflow.incident.closeout.artifact.preview` and the governed write
action `workflow.incident.closeout.artifact`.

The preview reports whether a closeout draft can be persisted and what the write
would touch. The write action requires Human Gate evidence, Cat Claw/secretary
audit evidence, and an operator reason through the hard policy gate. When
allowed, it persists the selected closeout package as JSON and Markdown under
the workflow bridge artifact area, writes two `artifact_index` rows, and appends
one `incident.closeout_artifact.persisted` workflow event.

The write boundary is still narrow: it does not close incidents, update
workflow status, create Human Gate records/buttons, enqueue Telegram, dispatch
Cat Claw, retry jobs, or mutate side-effect records. This creates a durable
evidence artifact for Cat Claw/Flashcat review without turning the artifact
write into a decision or delivery action.

## P1.9 Human Gate Request Preview From Closeout Artifact

Added `workflow.incident.closeout.human_gate_request.preview`.

This action reads a persisted `human_gate_package` closeout artifact and
derives the Human Gate request shape that a later governed write would create:
one pending Human Gate record, A/B/C approve options, pause/terminate controls,
one Telegram outbox row, and one audit workflow event. It remains preview-only:
no Human Gate records, buttons, Telegram outbox rows, workflow events, incident
state, runtime dispatch, or delivery are written.

The console `Incidents` tab now includes `Preview HGate Request`. The action
gateway allowlist includes the preview action only.

## P1.10 Governed Human Gate Request Creation

Added the governed write action
`workflow.incident.closeout.human_gate_request`.

The action must read a persisted `human_gate_package` closeout artifact and
requires existing Human Gate evidence, Cat Claw/secretary audit evidence, and
an operator reason. It wraps the existing `human_gate.request` path but keeps
the prior evidence id separate from the new Human Gate id, preventing evidence
ids from being reused accidentally as newly created request ids.

The write boundary is deliberately narrow: it creates the pending Human Gate
record, button rows, one meeting control event, one queued Telegram outbox row,
and one `human_gate.requested` workflow event. It does not auto-deliver
Telegram, close incidents, update workflow status, dispatch runtime, retry
jobs, mutate side effects, or touch trading state.

The console `Incidents` tab shows a gated form from the Human Gate request
preview. In read-only mode or without write allowlist, the backend rejects the
write even if the form is filled.

## P1.11 Telegram Outbox Delivery Preview

Added `telegram.outbox.delivery.preview`.

This read-only action inspects a queued, failed, or stale-delivering Telegram
outbox row before any delivery attempt. It reports whether the row is
claimable, whether a target and text are present, how many message chunks would
be sent, whether Human Gate buttons are present, which delivery path would be
attempted, and which database fields would be updated by a later real delivery.

The action does not claim the outbox row, read bot tokens, call Telegram,
invoke OpenClaw, update message-flow delivery status, or write workflow events.
The console `Outbox` tab now exposes `Preview Delivery` for each row so an
operator can audit readiness before enabling any controlled send path.

## P1.12 Telegram Delivery Execution Policy Preview

Extended `telegram.outbox.delivery.preview` with execution and receipt policy
metadata.

The preview now separates technical eligibility from future governed execution
readiness. It reports required evidence, explicit delivery operator reason
presence, Cat
Claw/secretary audit presence for Human Gate request delivery, button
completeness, hard stops, governance warnings, and the receipt fields that a
later delivery action must persist.

This is still preview-only. It does not expose a send button, claim rows, read
bot tokens, call Telegram, invoke OpenClaw, or write delivery receipts.

## P1.13 Governed Telegram Delivery Execution Wrapper

Added `telegram.outbox.delivery` as a governed execution wrapper around the
existing low-level delivery worker.

The new action first runs `telegram.outbox.delivery.preview` and refuses to
execute unless the row is technically eligible and governance-ready. It requires
Cat Claw/secretary audit evidence through the workflow policy gate, an explicit
`deliveryOperatorReason`, and an idempotency key. When allowed, it calls the
existing delivery function, records terminal outbox delivery state, syncs
message-flow delivery where applicable, and appends one
`telegram.outbox.delivery.executed` workflow event.

This is not exposed as a console send button. The console action gateway can
execute it only when writes are explicitly enabled and the caller provides the
required delivery evidence. It does not mutate workflow status, Human Gate
records, incidents, side-effect rows, or trading state. Repeating the action
after the outbox is already `sent` returns an idempotent replay response without
resending or appending another delivery event.

## P1.14 Delivery Execution Observability And Closeout Linkage

Added a derived `deliveryReceipt` read model for Telegram outbox rows and
Telegram outbox receipts.

The console now shows delivery receipt state in the `Outbox` and `Receipts`
tabs, including whether terminal delivery evidence is complete, receipt count,
claim metadata, target/account/channel, delivered or failed timestamp, and a
redacted error. Human Gate readiness no longer treats `telegram_outbox.status =
sent` as enough by itself; `telegram_delivery_observed` now requires a complete
terminal delivery receipt.

`GET /api/operations/summary` now includes `deliveryExecutions` derived from
`workflow_operations` rows for `telegram.outbox.delivery`, so operators can see
sent executions, idempotent replays, receipt counts, update boundaries, and
errors without reading raw operation payload JSON. Evidence packs include the
operations section and manifest delivery-execution counts. Incident closeout
adds a `telegram_delivery_receipt` checklist item so Cat Claw and Flashcat can
see whether the Human Gate notification has complete delivery evidence before
closeout.

This is read-model and console observability work. It does not add a console
send button, retry delivery, resend Telegram, mutate workflow state, close
incidents, or touch trading state.

## P1.15 Telegram Outbox Requeue Preview

Added `telegram.outbox.requeue.preview`.

This read-only action evaluates failed or stale-delivering Telegram outbox rows
before any resend/requeue attempt. It reuses delivery preview evidence for
target/text readiness, buttons, receipt policy, and terminal delivery
requirements, then adds a resend/requeue governance layer: failed rows use the
`retry_failed_delivery` strategy, stale `delivering` rows use
`reclaim_stale_delivery_lease`, fresh `delivering` rows are blocked until the
lease is stale, and already `sent` rows are treated as idempotent replay only.

The preview states which identifiers and evidence must be preserved: original
outbox id, Human Gate id, button ids, target, existing delivery receipts, and
idempotency boundary. Human Gate request redelivery requires Cat
Claw/secretary audit evidence and an explicit delivery/requeue operator reason.

This is preview-only. It does not reset outbox status, claim a delivery lease,
create a new Human Gate request, create a new Telegram outbox row, send
Telegram, write side-effect rows, or mutate trading state.

## P1.16 Telegram Requeue Execution Package Preview

Added `telegram.outbox.requeue.execution_package.preview`.

This read-only action turns `telegram.outbox.requeue.preview` into a Chinese
Cat Claw / Human Gate execution-confirmation package. It summarizes the current
outbox state, retry/reclaim strategy, missing evidence, preservation boundary,
and future execution boundary. The package includes A/B/C options plus
pause/terminate controls, but it does not create a Human Gate record or
Telegram outbox item.

The package states that any future execution must still use
`telegram.outbox.delivery`, with the same outbox id, Human Gate id, button ids,
target, existing receipts, Cat Claw/secretary audit, explicit operator reason,
and idempotency key. It exposes readiness for Cat Claw review and readiness for
an execution request separately.

This is still preview-only. It does not reset status, claim leases, send
Telegram, create Human Gate records/buttons, create outbox rows, write
side-effect rows, close incidents, advance workflows, or touch trading state.

## P1.17 Risk Decision Hard Gate

Added `risk.decision` to the hard policy gate set.

`risk.decision` already had stable chain checks for approved/rejected terminal
decisions: existing `trade_proposal`, approved Human Gate bound to that
proposal, `preOrderRiskAuditId`, `reviewerAgent=cat_tail`,
`dispatchType=pre_order_risk_audit`, numeric risk limits, evidence refs, and a
matching Cat Tail dispatch. P1.17 adds the missing outer policy enforcement:
the action now fails closed before writing a `risk_decision` object unless Cat
Claw/secretary audit evidence and freshness evidence are present.

This does not create trade intents, update trading state, deliver Telegram,
submit Human Gate, or call `trading_core`. It only prevents under-evidenced
`risk_decision` protocol objects from being written into the chain that later
feeds `trade.intent`.

## Review Notes

- Spark explorer reviewed the `message_flow` schema and existing attention
  semantics before implementation and recommended the visible-delivery filters
  used here.
- Spark review for `workflow_dead_letter_evidence.v1` found three issues:
  evidence rows were not constrained to the current dead-letter predicate,
  related control-loop jobs used fuzzy `dedupe_key LIKE` matching, and
  `sqlIn([])` used a non-empty string fallback. All three were fixed and
  re-reviewed as PASS.
- Consolidated Spark review for the P1.3a-P1.5 implementation found that
  `workflow.verifications` could canonicalize to `workflow.verification.list`
  without a handler, and that `runWorkflowAction` dispatched on the raw action.
  The dispatcher now canonicalizes before the switch, `workflowVerificationList`
  handles the read action, and regression coverage exercises the alias. Spark
  re-review passed.
- A follow-up Spark pass covered the remaining entrypoint and documentation
  files (`index.js`, `bin/cat-meeting-governance.mjs`, console docs, schema
  docs, README, task drafting docs, and contract smoke). It found no additional
  issues.
- Spark review for dead-letter filters found and verified fixes for generic
  `limit` accidentally affecting dead-letter limits, missing status selector
  support in the console, documentation mismatch, missing status/limit
  regression coverage, and `deadLetterSummary` counting only the truncated
  result set.
- Spark review for the incident candidate preview passed. It suggested
  strengthening the no-side-effect regression beyond `incident_states`; the
  regression now also checks workflow, dispatch, runtime, outbox, Human Gate,
  and side-effect row counts before and after the evidence read.
- Spark explorer compared the next hard-gate candidates and recommended
  `risk.decision` before `trade.proposal` or `side_effect.record`, because the
  risk-decision evidence chain is already stable and does not directly touch
  trading execution state. The implementation followed that recommendation.

## Next Step

Potential next slice:

- evaluate whether `trade.proposal` can receive a similarly narrow hard gate
  without blocking low-risk proposal drafts;
- evaluate selected `side_effect.record` resolution paths only; do not hard
  gate the full generic side-effect ledger until status/type semantics are
  stable.
