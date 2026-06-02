# Update Log

This log records changes to the Claude Code workflow reference program and the
associated `trading-agents-workflow` adaptation plan.

## 2026-05-31

### Trigger

Flashcat requested a long-term subproject document so Claude Code Dynamic
workflow documentation and releases can continuously guide improvements to
`trading-agents-workflow`, especially for future live trading workflows.

### Reference Review

Reviewed official Claude Code sources:

- Dynamic workflows: https://code.claude.com/docs/en/workflows
- Changelog: https://code.claude.com/docs/en/changelog
- Subagents: https://code.claude.com/docs/en/sub-agents
- Agent teams: https://code.claude.com/docs/en/agent-teams
- Goals: https://code.claude.com/docs/en/goal
- Hooks: https://code.claude.com/docs/en/hooks-guide
- Permissions: https://code.claude.com/docs/en/permissions
- Observability: https://code.claude.com/docs/en/agent-sdk/observability

### Local Inspection

Inspected current `trading-agents-workflow` docs and code surfaces:

- `docs/workflow-console.md`
- `docs/workflow-task-drafting-initial-plan.md`
- `docs/managed-agent-evolution-plan.md`
- `docs/openclaw-plugin-readme.md`
- `src/workflow.js`
- `src/console/read-model.js`
- `src/console/action-gateway.js`
- `static/console/app.js`
- `docs/tracking-schema.sql`

### Decisions

- Use the existing workflow console as the control surface. Do not create a new
  `/workflows` clone.
- Treat Claude Code's JavaScript workflow script model as an architectural
  signal, not as an implementation target.
- Adapt the idea into `Workflow Plan Spec v2`, durable phases, agent runs,
  receipts, operations, verification, Human Gate boundaries, and evidence
  export.
- Keep trading and operations safety stricter than Claude Code's coding
  workflow defaults.

### Artifacts Created

- `docs/claude-code-workflow-reference/README.md`
- `docs/claude-code-workflow-reference/reference-index.md`
- `docs/claude-code-workflow-reference/adaptation-plan.md`
- `docs/claude-code-workflow-reference/update-log.md`
- `docs/claude-code-workflow-reference/workflow-plan-spec-v2.md`
- `docs/claude-code-workflow-reference/development-summary-2026-05-31.md`

### Initial Runtime Adoption

- `workflow.task.draft` emits `spec.planSpecV2`.
- Task Launch Package v1 carries `planSpecV2` as an additive compatibility
  field.
- `plan_spec_v2_contract_shape` quality gate checks the documented node,
  evidence, resume, artifacts, and audit contract.
- `workflow_phases` is created as an additive first-class phase table.
- `workflow.task.launch.approve` synchronizes planned phase rows from
  `planSpecV2.phaseGraph`.
- Console phase view merges `workflow_phases` with task/dispatch/runtime
  evidence and falls back to `workflow_tasks.phase` for older workflows.
- `workflow_agent_runs` is created as an additive read/index table for runtime
  and session-run evidence.
- Console exposes `GET /api/workflows/:workflowId/agent-runs`.
- Console phase view now includes agent-run and receipt counts plus per-phase
  agent-run evidence chains.
- Console exposes `GET /api/workflows/:workflowId/receipts` as a derived
  unified receipt/evidence view across existing ledgers.
- Console exposes `GET /api/workflows/:workflowId/evidence-pack` and an
  `Export` tab for browser-side JSON evidence-pack download.
- Console exposes `GET /api/workflows/:workflowId/human-gate-readiness` and a
  `Gate Readiness` tab for read-only Human Gate checklist review.
- `workflow_operations` is created as the durable console operation audit base;
  preview and rejected console actions are mirrored from JSONL into the DB.
- Operations tab shows recent workflow operations and operation summary counts.
- Operations tab exposes read-only controlled intervention previews for pause,
  resume, stop, and rerun current phase. The API also supports rerun-agent
  preview. Real intervention writes remain disabled.
- `workflow_verification_results` records verifier/refuter/reducer/
  secretary-audit/evaluator outputs as append-only acceptance evidence.
- Console exposes `GET /api/workflows/:workflowId/verification` and a
  `Verification` tab. Verification results remain evidence only; they do not
  auto-advance workflows, complete tasks, submit Human Gate, or write side
  effects.
- `workflow.evaluate` records deterministic evaluator output as
  `result_type='evaluator'` in the same verification evidence channel. It reads
  workflow evidence and emits `met`, `not_met`, `needs_evidence`,
  `needs_human_gate`, `blocked`, or `side_effect_uncertain` without mutating
  workflow state.
- `workflow.permission.check` now returns policy-layer fields
  `policyOutcome`, `requirements`, `policyWarnings`, and `actionable` while
  preserving the existing capability-layer `allowed` / `reason` contract.
- Controlled hard enforcement is now enabled for `trade.intent` and
  `trading_core.receipt`: those two actions record
  `permission.policy_blocked` and fail closed when policy evidence is missing
  or side-effect uncertainty is unresolved. CLI/plugin inputs and the
  `trading_core` contract smoke were updated to pass the required evidence.
- `workflow.pause`, `workflow.resume`, and `workflow.stop` now support minimal
  governed execution behind Human Gate/Cat Claw evidence and console write
  enablement. The write path only changes workflow status/current decision and
  appends an event; rerun/runtime drain/Human Gate package execution remains
  deferred.
- Operations now exposes a unified `deadLetters` attention list for failed or
  max-attempt jobs, expired leases, max-attempt dispatches, stuck Human Gate
  feedback, uncertain side effects, and stale visible-delivery `message_flow`
  rows that still have no delivery receipt. The console renders it read-only in
  the existing Operations tab. Operators can open a read-only
  `workflow_dead_letter_evidence.v1` bundle for a selected row, and filter the
  list by kind, severity, and status. The single-row evidence bundle now
  includes a non-persisted `workflow_incident_candidate.v1` preview with
  suggested severity, affected planes, evidence references, next actions, and
  exit criteria. `workflow.incident.from_dead_letter.preview` and
  `workflow.incident.from_dead_letter` add governed incident linkage on top of
  that candidate; execution requires Human Gate evidence, Cat Claw/secretary
  audit evidence, and an operator reason, and is limited to the
  `incident_state_only` boundary. The console exposes a two-step preview plus
  guarded evidence form; the backend remains authoritative for read-only mode,
  write allowlisting, and policy evidence checks. The form now uses
  `GET /api/workflows/:workflowId/incident-evidence-options` to offer read-only
  Human Gate and Cat Claw/secretary-audit candidate selectors. The follow-up
  read-only closeout surface is
  `GET /api/workflows/:workflowId/incident-closeout` plus the console
  `Incidents` tab, which joins incident state, workflow incident events,
  incident notes, dead-letter evidence, selector evidence, Human Gate readiness,
  receipts, and checkpoints into one closeout checklist. The first closeout
  follow-up actions are preview-only:
  `workflow.incident.closeout.cat_claw_report.preview` and
  `workflow.incident.closeout.human_gate_package.preview`. They prepare Chinese
  Cat Claw/Human Gate drafts and option structures with zero writes. The first
  artifact persistence action is also in place:
  `workflow.incident.closeout.artifact.preview` and
  `workflow.incident.closeout.artifact`; the write is hard-gated and limited to
  JSON/Markdown artifacts, `artifact_index`, and one audit event.
- 2026-06-01: Added `workflow.incident.closeout.human_gate_request.preview`,
  derived from persisted closeout artifacts. It previews the Human Gate
  request/buttons/outbox/event shape with zero writes and is surfaced in the
  console `Incidents` tab.
- 2026-06-01: Added governed write
  `workflow.incident.closeout.human_gate_request`. It creates only the pending
  Human Gate request surface and queued Telegram outbox from a persisted
  closeout artifact; it does not deliver Telegram, close incidents, update
  workflow status, dispatch runtime, or mutate side effects.
- 2026-06-01: Added read-only `telegram.outbox.delivery.preview`, surfaced in
  the console `Outbox` tab as `Preview Delivery`. It audits target/text/status,
  claimability, chunking, button presence, and would-update fields before any
  real Telegram send path.
- 2026-06-01: Extended `telegram.outbox.delivery.preview` with execution policy
  and receipt policy metadata, including governance readiness, Cat
  Claw/secretary audit requirements plus explicit delivery operator reason for
  Human Gate request delivery, and the terminal receipt fields a future send
  action must persist.
- 2026-06-01: Added governed execution wrapper `telegram.outbox.delivery`.
  It reuses the delivery preview policy, requires Cat Claw/secretary audit
  evidence, explicit delivery operator reason, and idempotency key, then writes
  only Telegram delivery state/receipt evidence plus one workflow audit event.
  No console send button is exposed; already-sent rows return an idempotent
  replay without resending.
- 2026-06-02: Added delivery execution observability. Telegram outbox rows and
  receipts now expose a derived `deliveryReceipt` state, Human Gate readiness
  requires complete terminal delivery receipt evidence instead of status-only
  `sent`, Operations lists `telegram.outbox.delivery` executions/replays, and
  evidence packs plus incident closeout include delivery execution/receipt
  linkage.
- 2026-06-02: Added read-only `telegram.outbox.requeue.preview` for failed or
  stale-delivering outbox rows. It previews retry/reclaim strategy,
  preservation of original Human Gate/outbox/button/receipt evidence, and
  required Cat Claw audit plus explicit delivery/requeue reason without
  resetting status or resending Telegram.
- 2026-06-02: Added read-only
  `telegram.outbox.requeue.execution_package.preview`. It converts requeue
  preview evidence into a Chinese Cat Claw/Human Gate confirmation package with
  A/B/C options plus pause/terminate controls while still performing zero
  writes and no Telegram delivery.
- 2026-06-02: Added `risk.decision` hard policy enforcement. The action now
  requires Cat Claw/secretary audit evidence and freshness evidence before a
  `risk_decision` protocol object can be written, while preserving the existing
  proposal/Human Gate/Cat Tail dispatch/numeric risk/evidenceRefs chain checks.
- Console phase view and supervise preview remain read-only/preview-only.

### Development Summary

The completed P0.1-P0.9 implementation batch and the P1.1 verification
continuation are summarized in `development-summary-2026-05-31.md`, including
schema/read-model/UI changes, review findings, test evidence, and remaining
risk boundaries.

### Next Review Conditions

Update this subproject when any of the following occurs:

- Claude Code publishes stable workflow API or DSL docs.
- Claude Code changes `/workflows` controls, persistence, or permission
  behavior.
- A new bundled workflow is documented.
- `trading-agents-workflow` implements Plan Spec v2 schema.
- `trading-agents-workflow` adds first-class phase, agent-run, receipt,
  operation, or tool-call tables.
- The console exposes phase-first progress or controlled intervention previews.
