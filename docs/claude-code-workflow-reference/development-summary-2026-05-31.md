# Development Summary 2026-05-31

This document records the first implementation batch for adapting Claude Code
Dynamic workflow design signals into `trading-agents-workflow`.

The work stayed inside the existing plugin and existing workflow console. It
did not create a second control surface, a second scheduler, or a server-side
export writer.

## Implementation Scope

Completed scope:

- P0.1 Workflow Plan Spec v2 runtime bridge.
- P0.2 first-class workflow phases.
- P0.3 first-class workflow agent runs.
- P0.4 phase-to-agent-run and receipt observability in the console.
- P0.5 derived unified receipts view.
- P0.6 read-only evidence pack export.
- P0.7 read-only Human Gate readiness checklist.
- P0.8 durable workflow operation audit base.
- P0.9 controlled intervention previews.
- P1.1 verifier/refuter acceptance evidence records.
- P1.2 deterministic workflow evaluator evidence.
- P1.3 permission gate policy outcomes.
- P1.3a controlled hard gates for trading handoff actions.
- P1.4 minimal governed pause/resume/stop execution.
- P1.5 dead-letter and stuck attention observability.

Primary files changed:

- `src/workflow.js`
- `src/console/read-model.js`
- `src/console/server.js`
- `static/console/app.js`
- `static/console/index.html`
- `static/console/style.css`
- `scripts/workflow_regression_tests.mjs`
- `docs/tracking-schema.sql`
- `docs/workflow-console.md`
- `docs/workflow-task-drafting-initial-plan.md`
- `docs/claude-code-workflow-reference/*`

## P0.1 Plan Spec v2

`workflow.task.draft` now emits `spec.planSpecV2`.

Task Launch Package v1 carries `planSpecV2` as an additive compatibility field.
Plan Spec v2 is not yet the materialization source of truth; existing Task
Launch Package v1 materialization remains authoritative for task creation.

Implemented Plan Spec v2 features:

- `meta`, objective, participants, phase graph, nodes, evidence policy,
  artifacts, audit, Human Gate policy, resume policy, and failure routes.
- Node contract fields such as `nodeType`, `inputRefs`, `prompt`,
  `allowedCapabilities`, `maxAttempts`, `policyGate`, `verifier`,
  `failureRoute`, and `idempotencyKey`.
- Quality gate `plan_spec_v2_contract_shape`.
- Additional gates for node acceptance, Human Gate Chinese/original-words
  requirements, and failure routes.

Intent:

- Make workflow understanding and decomposition inspectable before execution.
- Keep launch preview and package preparation pure until explicit approval.

## P0.2 Workflow Phases

Added additive table:

- `workflow_phases`

`workflow.task.launch.approve` synchronizes planned phases from
`planSpecV2.phaseGraph` after workflow run materialization and before task
creation.

Console phase view now:

- prefers first-class `workflow_phases` rows when present;
- falls back to `workflow_tasks.phase` for older workflows;
- merges tasks, dispatches, runtime runs, agent runs, and receipt counts;
- exposes `source`, `inferred`, and `evidenceSources` fields so operators can
  see whether the view is first-class or inferred.

Important fix:

- Phase rows are now synchronized after workflow approval and task launch
  materialization starts, avoiding phase-only partial state from prepare-time
  previews.

## P0.3 Workflow Agent Runs

Added additive table:

- `workflow_agent_runs`

This table is an index/read model, not the authoritative execution ledger.
Authoritative sources remain:

- `mixed_meeting_dispatches`
- `runtime_runs`
- `workflow_session_runs`

Mirroring behavior:

- `runtime_runs` writes mirror into `runtime.<runtimeRunId>` agent-run rows.
- `workflow_session_runs` start/complete writes mirror into
  `session.<runId>` agent-run rows.
- `workflow.status` includes `workflow_agent_runs` count.

Console additions:

- `GET /api/workflows/:workflowId/agent-runs`
- `Agent Runs` tab
- `phaseSummary` on agent-run view

Important fixes:

- `workflow_session_runs` now persists `dispatch_id`.
- Session-run dedupe can backfill missing `workflow_agent_runs` linkage.
- `upsertWorkflowAgentRun` preserves existing non-empty immutable linkage
  fields when a later update lacks them.
- Runtime retry/failure paths are indexed into `workflow_agent_runs`.

## P0.4 Phase Evidence Chains

The phase read model now merges `workflow_agent_runs` back into each phase.

Each phase can show:

- task rows;
- dispatch rows;
- runtime run rows;
- agent run rows;
- receipt references;
- chain fields: phase -> task -> dispatch -> runtime/session run -> receipt.

Console additions:

- per-phase `Agent Runs / Receipts` section;
- agent-run and receipt counters in phase cards;
- receipt-aware `Agent Runs` summary.

Compatibility fixes:

- `phases()` degrades safely when `runtime_runs` table is missing.
- `workflow_agent_runs` rows that only have `phase_id` can resolve
  `phase_key` through `workflow_phases`.

## P0.5 Unified Receipts

Added derived read endpoint:

- `GET /api/workflows/:workflowId/receipts`

Added console tab:

- `Receipts`

This is a read-only derived view. It does not create a durable
`workflow_receipts` authority table yet.

Sources normalized into the view:

- `workflow_agent_runs`
- `message_flows`
- `telegram_outbox`
- `protocol_objects`
- `human_gate_buttons`
- `workflow_checkpoints`
- `artifact_index`
- `side_effect_ledger`

Returned structure includes:

- `source`
- `summaryScope`
- `limit`
- `candidateCount`
- `summary`
- `evidenceSources`
- normalized `receipts`

Important fixes:

- Protocol object matching uses exact `parent_object_id` and `json_extract`
  workflow id fields instead of broad `payload_json LIKE`.
- Summary is explicitly `shown` / paginated, not global truth.
- Outbox receipt summaries redact `tawhg:` and token-like text.

## P0.6 Evidence Pack Export

Added read endpoint:

- `GET /api/workflows/:workflowId/evidence-pack`

Added console tab:

- `Export`

Added browser-only download:

- `Download JSON`

The endpoint returns `workflow_evidence_pack.v1`, a read-only derived JSON
bundle. The server does not write an export artifact.

Included sections:

- `workflow`
- `phases`
- `tasks`
- `dispatches`
- `runtimeRuns`
- `agentRuns`
- `messageFlows`
- `humanGates`
- `outbox`
- `checkpoints`
- `evidence`
- `receipts`
- `timeline`
- `manifest`

Important fixes:

- Evidence-pack export reuses redacted read models.
- `outbox()` now redacts outbox text previews.

## P0.7 Human Gate Readiness

Added read endpoint:

- `GET /api/workflows/:workflowId/human-gate-readiness`

Added console tab:

- `Gate Readiness`

The readiness view is a derived checklist for Cat Claw secretary review and
Human Gate submission preparation. It does not submit Human Gate requests,
create buttons, resend Telegram messages, or mutate workflow state.

Checks included:

- linked Human Gate record;
- at least three approve/option buttons;
- pause workflow control;
- terminate workflow control;
- Chinese report/body presence;
- approve option label/summary/prompt completeness;
- checkpoint, artifact, and receipt evidence;
- Cat Claw source/creator path;
- Telegram sent outbox observation;
- Flashcat original-words capture after a selected button.

Important fixes:

- Human Gate protocol-object matching now uses exact parent/json workflow id
  fields instead of broad `payload_json LIKE`.
- The route is exposed through `workflowChildPayload()` so route resolver
  regression tests do not need to bind a local HTTP port.
- `timeline()` now redacts outbox subtitles.
- Tests assert the export does not contain the original Human Gate token text.

## P0.8 Workflow Operations Audit

Added additive table:

- `workflow_operations`

The console action gateway now writes governed operation records into the DB in
addition to the existing `bridge/console-operations.jsonl` compatibility log.
This is an audit base for future pause/resume/stop/rerun previews and controls;
it does not expose real state-changing intervention buttons yet.

Recorded fields include:

- `operation_id`, `action`, `scope_type`, `scope_id`, `workflow_id`;
- `requested_by`, `reason`, `risk_tier`, `status`, `dry_run`;
- `idempotency_key`, `human_gate_id`, `input_hash`;
- `preview_result_json`, `result_json`, `error`, timestamps.

Console additions:

- Operations tab shows recent `workflow_operations`.
- Operations tab shows `workflowOperationSummary`.

Important fixes:

- Rejected console actions are recorded as `status='rejected'`.
- Preview actions store their result in `preview_result_json`; non-preview
  result storage remains reserved for future governed writes.
- Operation JSONL and DB fields redact token-like text, including inline
  `tawhg:` strings and short space-delimited forms such as `token abc`.
- Partial legacy `workflow_operations` tables are handled defensively:
  migration/action paths add missing columns, and read-model scoped queries
  avoid `no such column` failures.

## Console Behavior

The existing console now has these additional tabs:

- `Phases`
- `Agent Runs`
- `Receipts`
- `Export`
- `Gate Readiness`
- `Operations` controlled intervention previews
- `Verification`

The console remains:

- read-only by default;
- preview-only for supervisor and controlled intervention actions;
- not a deployment, Gateway restart, database migration, or live-trading
  execution console.

## Review Record

The implementation used independent subagent review gates. Later review passes
prioritized `gpt-5.3-codex-spark` for short, bounded checks.

Key review findings and resolutions:

- Plan Spec v2 did not initially satisfy the documented node contract.
  Resolved by adding required node/artifact/audit/evidence fields and a
  contract-shape quality gate.
- Phase sync was initially too early. Resolved by moving phase sync after
  task-launch approval begins.
- `workflow_agent_runs` could lose session `dispatch_id` linkage. Resolved by
  persisting `dispatch_id`, dedupe backfill, and non-empty linkage preservation.
- Phase read model had missing-table and `phase_id`-only attribution gaps.
  Resolved with table-existence guards and `phase_id -> phase_key` mapping.
- Receipts view used broad protocol-object substring matching and unclear
  summary semantics. Resolved with exact JSON field matching and shown-scope
  summary metadata.
- Evidence pack export could leak outbox token text through reused read models.
  Resolved by redacting outbox previews and timeline subtitles.
- Human Gate readiness initially had token-string and legacy-schema review
  gaps. Resolved by adding text-level redaction for Human Gate fields, exact
  `workflow.id` matching, missing-table fallbacks, and regression coverage for
  legacy schema responses.

Latest independent verifier status:

- P0.4 verifier: PASS.
- P0.5 verifier: PASS.
- P0.6 verifier: PASS.
- P0.7 Spark reviewers found token-redaction and legacy-schema gaps; fixes
  were applied and covered by regression tests. Final post-fix Spark PASS for
  earlier findings was not completed in the original implementation pass.
- P0.8 initial Spark review found legacy-schema guard, workflow-scoped
  operations, and token-redaction gaps. Fixes were applied and regression
  coverage now validates durable DB/JSONL write paths, rejected actions,
  workflow-scoped operation summaries, partial-schema fallback/migration, and
  token redaction.
- P0.8 post-fix Spark blocker review: PASS. The reviewer verified short
  space-delimited token redaction, partial-schema read-model fallback,
  migration/action-gateway column repair, and matching regression coverage.
- P0.9 Spark review: PASS. Residual schema-tolerance and documentation-contract
  findings were fixed after review.
- P1.1 Spark review found governance-mode spoofing, attribution-spoofing,
  partial-schema tolerance, and read-side ref redaction gaps. Fixes were
  applied and regression coverage was added.
- P1.2 Spark review: PASS with hardening notes. Evaluator Human Gate/incident
  matching was tightened to structured workflow-id matching, and no-mutation
  regression assertions were expanded.

## P0.9 Controlled Intervention Previews

Added read-only intervention preview actions:

- `workflow.pause.preview`
- `workflow.resume.preview`
- `workflow.stop.preview`
- `workflow.rerun.agent.preview`
- `workflow.rerun.phase.preview`

These actions are allowed through the console action gateway as dry-run
operations and are recorded in `workflow_operations`. The preview model returns
eligibility, risk tier, required Human Gate / Cat Claw audit flags, current
workflow state, target scope, counts, latest checkpoint, violations, warnings,
and explicit limitations.

Important boundary:

- real `workflow.pause`, `workflow.resume`, `workflow.stop`, and rerun writes
  are still not added to the console allowlist;
- previews do not update workflow state, dispatch runtime jobs, submit Human
  Gate, reset tasks, drain runtimes, or deliver Telegram messages;
- real intervention execution remains deferred until transition policy,
  Human Gate execution, rollback/resume behavior, and side-effect handling are
  implemented.

Console additions:

- Operations tab includes preview buttons for pause, resume, stop, and rerun
  current phase.
- Preview responses render eligibility, would-affect counts, violations,
  warnings, limitations, and raw JSON.

## P1.1 Verifier/Refuter Result Records

Added additive table:

- `workflow_verification_results`

This table records independent verification, refutation, reducer,
secretary-audit, and evaluator outputs as append-only acceptance evidence.
Records can be scoped to workflow, phase, task, dispatch, agent-run, or
runtime-run ids.

Added governed action:

- `workflow.verification.record`

Compatibility aliases include `workflow.verifier_refuter.record` and related
spellings used by older planning notes. The action requires the new
`workflow.verify` capability.

Important boundary:

- recording a verification result does not change workflow status;
- it does not complete tasks, retry dispatches, submit Human Gate, deliver
  outbox messages, or write side effects;
- verification output is evidence for later workflow evaluator, Cat Claw audit,
  and Human Gate preparation.

Console additions:

- `GET /api/workflows/:workflowId/verification`
- `Verification` tab with summary cards, decision/type breakdowns, scoped
  result rows, reviewer/source fields, evidence refs, and redacted raw payloads.

Safety and compatibility fixes:

- `verification_id` is unique and duplicate writes are rejected.
- Payloads are redacted before DB persistence and read-model output.
- Summary and evidence/artifact/receipt refs are redacted before persistence,
  and refs are also redacted again in the console read model.
- Request-body `toolMode=governance` cannot grant `workflow.verify`.
- Non-trusted registered agents cannot spoof verifier/refuter/source/creator
  attribution as another agent.
- Missing `workflow_verification_results` tables return an empty compatible
  read model instead of failing older workflow roots.
- Partial legacy `workflow_verification_results` tables are read with column
  fallbacks instead of failing the console.
- `workflow.status` includes a count for `workflow_verification_results`.

## P1.2 Workflow Evaluator Evidence

Added governed action:

- `workflow.evaluate`

Aliases:

- `workflow.evaluator.run`
- `workflow.evaluation.run`
- `workflow.goal.evaluate`

The evaluator reads current workflow evidence and appends an evaluator record
to `workflow_verification_results` with `result_type='evaluator'`.

Inputs considered:

- workflow status, objective, acceptance criteria, and Plan Spec presence;
- task, dispatch, runtime, artifact, and receipt counts;
- verifier/refuter/reducer/secretary-audit evidence;
- pending Human Gate count;
- side-effect uncertainty count;
- active incident signal.

Possible evaluator decisions:

- `met`
- `not_met`
- `needs_evidence`
- `needs_human_gate`
- `blocked`
- `side_effect_uncertain`

Important boundary:

- evaluator records do not update workflow status;
- they do not complete tasks, retry dispatches, submit Human Gate, deliver
  outbox messages, drain runtimes, or write side effects;
- Human Gate and incident linkage for evaluator decisions uses structured exact
  workflow-id matching instead of broad substring matching;
- evaluator output remains evidence for Cat Claw audit and future Human Gate
  preparation.

## P1.3 Permission Gate Policy Outcomes

`workflow.permission.check` now returns a second policy layer in addition to the
existing capability verdict.

Existing fields remain:

- `allowed`
- `reason`
- `requiredCapability`
- `risk`

New fields:

- `policyOutcome`
- `requirements`
- `policyWarnings`
- `actionable`

Supported `policyOutcome` values:

- `allow`
- `deny`
- `requires_human_gate`
- `requires_cat_claw_audit`
- `requires_freshness_check`
- `side_effect_uncertain`

Initial policy flags cover:

- Cat Claw audit requirements for task-launch review/approval, workflow
  advance, schedule upsert, runtime registry changes, Telegram live config,
  Human Gate request/record, trade proposal, risk decision, and side-effect
  record actions.
- Human Gate evidence requirements for trade intent and trading-core receipt
  handoff.
- Freshness requirements for trade proposal, risk decision, trade intent, and
  trading-core receipt.
- Side-effect uncertainty requirements for high/critical risk actions when the
  workflow has uncertain side-effect ledger entries.

Compatibility boundary:

- `allowed` still means the caller has the traditional capability/registration
  permission.
- `actionable=false` means controllers/operators should not execute the action
  until listed requirements are satisfied.
- The implementation does not yet globally hard-block all write actions with
  `actionable=false`; hard enforcement should be enabled per action path once
  evidence contracts are stable.

## P1.3a Controlled Hard Gates

Controlled hard enforcement is now enabled for the two trading handoff paths
with stable evidence fields:

- `trade.intent`
- `trading_core.receipt`

When either action has `actionable=false`, `authorizeWorkflowAction()` records a
`permission.policy_blocked` event and fails closed before the business action
runs. `workflow.permission.check` remains read-only and still returns the policy
verdict without throwing.

Evidence contract:

- `trade.intent` requires Human Gate evidence, Cat Claw audit evidence,
  freshness evidence, and no unresolved side-effect uncertainty.
- `trading_core.receipt` requires Human Gate evidence, freshness evidence, and
  no unresolved side-effect uncertainty. It does not require Cat Claw audit.

CLI/plugin command inputs and the `trading_core` contract smoke were updated so
compliant calls can pass these evidence fields.

## P1.4 Minimal Intervention Execution

Added real governed actions:

- `workflow.pause`
- `workflow.resume`
- `workflow.stop`
- `workflow.terminate` aliasing stop

These actions reuse preview eligibility checks and are hard-gated on Human Gate
and Cat Claw evidence. They also require an operator reason and rollback/resume
boundary, or a latest checkpoint path.

The write boundary is deliberately narrow:

- update `workflow_runs.status`;
- update `workflow_runs.current_decision`;
- update `workflow_runs.updated_at`;
- append `workflow.intervention.executed` to `workflow_events`;
- when invoked through the console action gateway with writes enabled, record a
  completed `workflow_operations` row with `dry_run=0`.

They do not reset tasks, cancel or retry dispatches, drain runtime bridges,
send Telegram, create Human Gate requests, write side-effect ledger rows, or
touch trading / `trading_core` state.

## P1.5 Dead-Letter Observability

The Operations read model now returns:

- `deadLetters`
- `deadLetterSummary`
- `deadLetterAvailableSummary`

The existing Operations tab renders a `Dead-Letter / Stuck Attention` table.
Operators can filter the read model and table by dead-letter kind, severity,
and status; API callers can also set the dead-letter result limit.

The first attention families are:

- failed or max-attempt control-loop jobs;
- expired running job leases;
- dispatches at max attempts;
- stuck Human Gate feedback buttons;
- uncertain side-effect rows;
- stale `message_flow` rows that require visible delivery but still have no
  delivery receipt.

This is read-only observability. It does not retry jobs, cancel leases,
reconcile dispatches, resend Telegram outbox, resume Human Gate, mutate
side-effect rows, or change workflow/runtime/trading state.

The Operations tab can also open a single-item
`workflow_dead_letter_evidence.v1` bundle for a selected dead-letter row. The
bundle includes the primary row and limited related evidence such as dispatches,
runtime runs, message_flow events, outbox rows, Human Gate buttons/records,
side effects, and control-loop jobs. It remains an export/audit view only.
When the row is still a current dead-letter item, the bundle also includes a
`workflow_incident_candidate.v1` read-only preview with suggested severity,
affected planes, evidence references, recommended next actions, exit criteria,
and rollback boundary. This preview is not persisted to `incident_states`.

`workflow.incident.from_dead_letter.preview` now converts that candidate into a
read-only governed write preview. `workflow.incident.from_dead_letter` can
persist the linked incident only when Human Gate evidence, Cat Claw/secretary
audit evidence, and an operator reason are present. The execution boundary is
`incident_state_only`: it creates or updates incident state/artifacts and the
incident workflow event, but does not repair, retry, deliver, reconcile, resume
Human Gate, mutate side effects, or change workflow status.
The console path is two-step: `Incident Preview` opens the governed preview, and
the execution form requires `humanGateId`, `catClawAuditId`, and operator
reason. Backend read-only mode, write allowlist, and policy evidence checks
remain authoritative.
The form now uses `GET /api/workflows/:workflowId/incident-evidence-options` to
derive selectable Human Gate and Cat Claw/secretary-audit candidates from
existing read models, while still allowing manual id entry when no candidate is
available. Each candidate includes structured recommendation reasons for
same-workflow scope, Cat Claw source, secretary-audit type, positive
status/decision, and references to the selected dead-letter evidence when
available; the console surfaces those reasons in the selector labels and
Evidence Options tables.

`GET /api/workflows/:workflowId/incident-closeout` and the console `Incidents`
tab now provide a read-only closeout chain. The read model selects linked
incidents from `incident_states`, including incidents whose workflow id is stored
under `payload.deadLetter.workflowId`, then joins incident workflow events,
incident timeline notes, dead-letter evidence, selector evidence, Human Gate
readiness, derived receipts, and checkpoints. The checklist checks incident
state, current dead-letter evidence, Human Gate evidence, Cat Claw audit,
operator reason, rollback boundary, `incident_state_only` side-effect boundary,
and final receipt/checkpoint readiness.

## Verification

Commands run successfully after the P1.1 fixes:

```bash
npm run check
npm run test:regression
npm run smoke:trading-core
git diff --check
```

Additional smoke:

- Temporary local console endpoint `/api/workflows/nonexistent/receipts`
  returned an empty derived view.
- Static console HTML includes the `Receipts` and `Export` tabs.
- Regression tests cover Human Gate readiness positive path, legacy missing
  schema fallback, token-string redaction in readiness/evidence-pack payloads,
  `workflow.id` matching, and Plan/Alternative/方案一 button classification.
- Regression tests cover console operation DB audit writes, rejected actions,
  preview result storage, operation summary read-model output, and operation
  token redaction, including partial legacy `workflow_operations` tables and
  short space-delimited token strings.
- Regression tests cover controlled intervention preview actions, operation
  audit writes, true write rejection for `workflow.stop`, and no workflow-state
  mutation.
- Regression tests cover verifier/refuter result recording, alias handling,
  duplicate rejection, DB/read-model redaction, console route mapping, and the
  no-auto-advance workflow-state boundary.
- Regression tests cover `workflow.verifications` canonical alias dispatching
  to `workflow.verification.list`, preventing read aliases from authorizing and
  then failing as unknown actions.
- Regression tests cover denied governance-mode spoofing, non-trusted
  attribution normalization, partial verification-table read compatibility, and
  reference-field redaction.
- Regression tests cover `workflow.evaluate` producing evaluator evidence,
  `met` and `side_effect_uncertain` decisions, Verification tab/read-model
  aggregation, Plan Spec presence in evaluator payload, and no workflow/task/
  Human Gate state mutation.
- No-mutation assertions also cover dispatches, runtime runs, Telegram outbox,
  and side-effect ledger counts.
- Regression tests cover permission policy outcomes for Cat Claw audit,
  Human Gate evidence, freshness evidence, side-effect uncertainty, and
  preservation of existing capability denial semantics.
- Regression tests cover real hard blocks for `trade.intent` and
  `trading_core.receipt`, including missing evidence and workflow-scoped
  side-effect uncertainty.
- Regression tests cover real `workflow.pause` / `workflow.resume` /
  `workflow.stop` execution, invalid transition rejection, operation audit
  rows, redaction, read-only console rejection, and no dispatch mutation.
- Regression tests cover dead-letter/stuck attention rows for failed jobs,
  expired leases, max-attempt dispatches, stuck Human Gate feedback, uncertain
  side effects, stale visible-delivery `message_flow` gaps, workflow scoping,
  false-positive exclusions, invalid query-window fallback, single-item
  dead-letter evidence bundles, read-only incident candidates, no incident table
  mutation, no workflow/dispatch/runtime/outbox/Human Gate/side-effect count
  mutation, dead-letter filters, and nested `*_json` token redaction.
- Regression tests cover governed dead-letter incident linkage preview,
  evidence-gated execute blocking, successful incident persistence with
  warning-to-monitoring status mapping, persisted secret redaction, and the
  `incident_state_only` mutation boundary.
- Regression tests cover the console action gateway for the incident linkage
  path: preview is allowed, default writes are rejected, explicit write-enabled
  execution succeeds, and operation audit records are redacted.
- Regression tests cover incident evidence options, including route mapping,
  recommended Human Gate/Cat Claw audit candidates, and selector redaction.
- Regression tests cover incident closeout, including linked incident selection
  from `deadLetter.workflowId`, route mapping, checklist items, incident-created
  timeline evidence, secret redaction, and no workflow/dispatch/runtime/outbox/
  Human Gate/side-effect/incident/event mutation during read.
- Playwright console smoke on 2026-06-01 used temporary root
  `/private/tmp/taw-console-selector-smoke-sK8JQt` and local console
  `http://127.0.0.1:18794`. It verified Operations -> Dead-Letter Evidence ->
  Incident Preview renders Human Gate and Cat Claw Audit selectors, redacts
  seeded secret text in option labels and tables, accepts selector choices, and
  rejects the execute submit in preview-only mode without creating an incident.
- P1.6 Playwright smoke reused that temporary root after creating a governed
  dead-letter incident. It verified the `Incidents` tab renders
  `workflow_incident_closeout.v1`, shows all eight closeout checklist items,
  includes incident-created timeline evidence, redacts the operator reason
  token, and updates the overview `Open Incidents` count for incidents linked
  through `payload.deadLetter.workflowId`.

Note:

- A route-level test originally used a temporary HTTP listener and hit sandbox
  `listen EPERM`. The test was changed to call exported route resolver
  `workflowChildPayload()` directly, keeping route mapping coverage without
  requiring socket permissions.
- Spark review of the P1.5 dead-letter evidence bundle found and verified fixes
  for current-dead-letter predicate matching, exact control-loop job linkage,
  and empty `IN` list behavior.
- Spark review of the P1.5 dead-letter filter slice found and verified fixes
  for dedicated dead-letter limit semantics, status selector support,
  documentation alignment, status/limit regression coverage, and summary counts
  based on the filtered pre-limit set.
- Consolidated Spark review found and verified fixes for canonical action
  dispatch and the `workflow.verification.list` handler; a follow-up pass on
  remaining entrypoint and documentation files passed without additional
  findings.
- Spark review of the read-only incident candidate preview passed; a residual
  suggestion to broaden no-side-effect assertions was incorporated into the
  regression suite.

## Remaining Work

Recommended next work:

- Durable `workflow_receipts` table, if the derived receipts view proves useful.
- Real controlled intervention execution behind Human Gate policy.
- Evaluate whether `trade.proposal`, `risk.decision`, or selected
  `side_effect.record` paths have enough stable evidence input coverage for
  similarly narrow hard gates.
- Decide whether a later stop implementation should cancel queued
  control-loop jobs/tasks/dispatches, or keep this first slice as the only
  default intervention write path.
- Add preview-only closeout follow-up actions, such as preparing a Cat Claw
  closeout report or Human Gate closeout package, without automatically
  resolving incidents or writing receipts. This is now implemented as
  `workflow.incident.closeout.cat_claw_report.preview` and
  `workflow.incident.closeout.human_gate_package.preview`; both are zero-write
  previews surfaced in the console `Incidents` tab.
- Persist reviewed closeout material as an artifact only after Human Gate
  evidence, Cat Claw audit evidence, and operator reason are present. This is
  now implemented as `workflow.incident.closeout.artifact.preview` plus the
  governed write `workflow.incident.closeout.artifact`; execution writes only
  JSON/Markdown artifacts, `artifact_index`, and one audit workflow event.
- Preview the formal Human Gate request shape from a persisted closeout artifact
  before creating any Human Gate records or delivery side effects. This is now
  implemented as `workflow.incident.closeout.human_gate_request.preview`; it
  derives the pending request/buttons/outbox/event counts from the artifact but
  performs zero writes.
- Create the formal closeout Human Gate request under a governed write boundary.
  This is now implemented as
  `workflow.incident.closeout.human_gate_request`; it requires a persisted
  closeout artifact, existing Human Gate evidence, Cat Claw audit evidence, and
  an operator reason, then creates only the pending Human Gate request surface
  and queued Telegram outbox work.
- Preview Telegram outbox delivery before any send attempt. This is now
  implemented as `telegram.outbox.delivery.preview`; it reports claimability,
  target/text readiness, chunking, Human Gate button presence, delivery path,
  and would-update fields without claiming the row, reading bot tokens,
  invoking OpenClaw, calling Telegram, or writing delivery receipts.
- Add delivery execution and receipt policy metadata to the same preview. It
  distinguishes technical eligibility from future governed execution readiness,
  checks explicit delivery operator reason and Cat Claw/secretary audit
  presence for Human Gate request delivery, and states the terminal receipt
  fields a later send action must persist.
- Add a governed Telegram delivery execution wrapper. This is implemented as
  `telegram.outbox.delivery`; it reuses the preview policy, requires Cat
  Claw/secretary audit evidence, explicit delivery operator reason, and
  idempotency key, then writes only Telegram outbox delivery state/receipt
  evidence and one workflow audit event. It is not exposed as a console send
  button. Repeating it after the outbox is already `sent` returns an idempotent
  replay without resending.
- Add delivery execution observability and closeout linkage. Telegram outbox
  and receipt read models now expose a derived `deliveryReceipt` state. Human
  Gate readiness requires complete terminal delivery receipt evidence instead
  of treating `sent` status alone as sufficient. Operations lists
  `telegram.outbox.delivery` executions and idempotent replays, evidence packs
  include delivery execution counts, and incident closeout includes a Telegram
  delivery receipt checklist item.
- Preview failed/stale Telegram outbox redelivery before any status reset or
  resend. This is implemented as `telegram.outbox.requeue.preview`; it
  distinguishes failed retry, stale-delivering reclaim, fresh active lease, and
  already-sent idempotent replay cases while requiring preservation of the
  original outbox/Human Gate/button/receipt evidence chain.
- Generate a Chinese execution-confirmation package for requeue decisions
  before any execution request. This is implemented as
  `telegram.outbox.requeue.execution_package.preview`; it converts requeue
  evidence into Cat Claw/Human Gate-facing A/B/C options plus pause/terminate
  controls, while keeping the future execution boundary fixed at
  `telegram.outbox.delivery`.
- Promote `risk.decision` from advisory permission policy to hard policy
  enforcement. It now fails closed without Cat Claw/secretary audit evidence
  and freshness evidence before writing a `risk_decision` protocol object. The
  existing terminal risk-decision chain checks remain the inner guardrail:
  approved Human Gate, bound trade proposal, Cat Tail pre-order risk dispatch,
  numeric risk limits, and evidence refs.
- Evidence pack export as a persisted artifact only after write governance and
  retention policy are defined.

## Current Risk Boundaries

- `planSpecV2` is additive and not yet the single materialization authority.
- `workflow_agent_runs` is an index/read model, not execution truth.
- `receipts` and `evidence-pack` are derived read models, not durable authority
  tables.
- General evidence-pack export is browser-side JSON download only; closeout
  artifact persistence is the first narrow server-side artifact write and does
  not submit Human Gate or close incidents.
- Human Gate request preview is derived from persisted closeout artifacts only;
  it does not create Human Gate records/buttons, Telegram outbox, workflow
  events, or deliveries.
- Human Gate request creation does not auto-deliver Telegram, close incidents,
  update workflow status, dispatch runtime, retry jobs, mutate side effects, or
  touch trading state.
- Telegram outbox delivery preview is observational only. It does not replace
  the existing delivery worker, does not send messages, and does not mark
  outbox or message-flow rows as delivered.
- Delivery execution policy preview is not an authorization token and does not
  create a delivery lease. A future send action must still enforce the policy at
  execution time.
- `telegram.outbox.delivery` is a narrow delivery-side-effect action. It does
  not close Human Gates, resolve incidents, advance workflows, dispatch agents,
  mutate side-effect ledger rows, or touch trading state.
- Delivery receipt observability is derived from existing outbox payload and
  operation records. It does not resend Telegram, repair failed delivery, create
  delivery leases, or make Cat Claw/Flashcat approval decisions.
- Telegram outbox requeue preview is zero-write. It does not reset outbox
  status, claim stale leases, create new Human Gate requests, create new outbox
  rows, send Telegram, write side effects, or touch trading state.
- Telegram requeue execution package preview is also zero-write. It is a
  Chinese audit/confirmation package only; it does not create Human Gate
  records/buttons, queue Telegram work, or authorize execution by itself.
- Human Gate readiness is a console checklist only; Cat Claw and Flashcat still
  own secretary audit and Human Gate decisions.
- Verification results are durable evidence records, not automatic approval,
  Human Gate completion, or task/workflow state transitions.
- Policy hard enforcement is currently narrow by design. It covers
  `risk.decision`, `trade.intent`, `trading_core.receipt`, selected intervention
  writes, incident closeout writes, and governed Telegram delivery. Other
  high-risk actions still use `workflow.permission.check` as an advisory policy
  layer until their callers consistently pass required evidence.
