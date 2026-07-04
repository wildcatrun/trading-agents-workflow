# Workflow v2 Implementation Status

Status: local orchestration kernel plus v2 worker lifecycle, audit-chain, and adapter-runner protocol slices implemented
Updated: 2026-07-05
Scope: `trading-agents-workflow`

## Summary

Workflow v2 is no longer only a design draft. The repository now contains the
first executable kernel slice for manager/worker orchestration:

- v2 schema tables under the `workflow_v2_*` namespace;
- read-only previews for plans, information-stack items, notifications, worker
  spawns, worker backend preflight, Human Gate packages, and validation;
- governed information-stack reads plus explicit read-receipt records;
- local record/create actions for JSON-first plan artifact persistence plus
  plan runtime mirror creation, information-stack records,
  backend preflight evidence, queued worker-run records, manager reviews, and
  Human Gate package records;
- worker spawn now binds the requested session pack to a queued
  `workflow_session_runs` instance and stores the resulting `session_run_id`
  on the v2 worker run;
- a v2 worker control-loop preview/tick for local lease, retry, timeout, and
  deterministic worker receipt progression;
- a v2 worker lifecycle preview for context pressure, compaction signals,
  review failures, handoff recommendation, and responsible owner/manager
  authority;
- local worker lineage fields and a minimal `workflow_v2_worker_handoffs` table
  for curated handoff package references and validator coverage;
- lease-bound worker result APIs for future adapters to submit output or record
  failure without direct database writes;
- an internal review and delivery chain from manager review to owner review,
  task group package, Cat Brain governance audit, Cat Claw protocol audit, and
  Human Gate package preparation;
- console action-gateway allowlist entries for safe previews and opt-in writes;
- a `WORKFLOW_V2_ACTION_REGISTRY` that routes canonical `workflow.v2.*` actions
  before the legacy non-v2 switch;
- `src/workflow-v2/constants.js` and `src/workflow-v2/helpers.js` for v2
  constants, normalization helpers, row summary mappers, lease/capacity helpers,
  and shared validation objects;
- regression coverage for the v2 kernel, permission gate, console gate, and
  workflow-id consistency validator.

This implementation is a local control-plane kernel. It does not start worker
runtimes, Docker, WSL services, Gateway services, or production workflow queues.

2026-07-03 design correction: worker lifecycle renewal is now part of the v2
design target, based on Anthropic's orchestrator-workers, multi-agent Research,
and Claude Code subagent guidance. The correction is documented in
`docs/workflow-v2-worker-lifecycle-renewal.md` and in the schema design draft.
The local schema and pure lifecycle preview are implemented. Governed renewal
write actions and real successor spawning are still future slices.

2026-07-03 design correction: task planning is now explicitly adaptive rather
than a mandatory full-committee pipeline. The task owner drafts the plan and acts
as execution CEO after Cat Brain admission audit. Plan-level Human Gate is not
default; it is reserved for material Flashcat decisions. Managers, Cat Body/CTO
review, and task group peer review are triggered by complexity, risk, code
impact, cross-domain dependencies, or conflicting evidence. `waiting_human`
remains reserved for a submitted Human Gate only; owner/manager progress should
use internal action-due states.

2026-07-04 design correction: prepare-task planning is JSON-first. The canonical
output is a `workflow_plan_spec.v2` artifact. `workflow_v2_plans` and
`workflow_v2_plan_nodes` are runtime indexes/state mirrors that point back to
the artifact, not a replacement source of truth. The task owner also remains the
acceptance gate for manager artifacts: manager review accepts worker output
inside a domain, but owner review accepts, revises, rejects, or escalates manager
artifacts before task group packaging or Cat Brain audit.

2026-07-04 worker runtime smoke: an out-of-band `wsl-agents`
(`trading-agents-ubuntu`) Docker testbed now exists for the two current worker
image classes only:

- `flashcat/hermes-worker:20260704`, with Hermès `v0.17.0` and temporary
  Xunfei fallback route structure
  `custom:xfyun-qwen` / `astron-code-latest`;
- `flashcat/claude-code-worker:20260704`, with Claude Code `2.1.195`;
- one running smoke container, `claude-code-worker-001`, using read-only WSL
  Claude config mounts.

The legacy `agent-sandbox-ubuntu` container/image family was removed. The worker
pool design target is 200 concurrent worker runs, each with a 64k-token context
limit. This is a scheduling and decomposition target: manager/owner task
allocation must avoid heavy monolithic worker prompts and should use
information-stack pointers plus bounded artifacts. The smoke test did not run a
real LLM task and is not connected to v2 worker queues, runtime adapters,
production workflow state, or the central workflow database.

2026-07-05 local adapter-runner update: `workflow.v2.adapter_runner.drain`
keeps the existing `mock` runner mode and now also supports an
`external_command` mode for future Hermers / Claude Code Docker wrapper
integration. The local workflow process claims adapter jobs, writes a bounded
request JSON file, invokes an explicitly configured command with `execFile`,
expects a JSON output file or stdout JSON, records a normalized external output
artifact, and returns success/fail/release through the governed
`workflow.v2.worker_result.*` / adapter job actions. This is a local wrapper
contract only: it does not start WSL, Docker, Hermers, Claude Code, Gateway, or
production queues by itself.

## Implemented Actions

Read-only / preview:

- `workflow.v2.plan.preview`
- `workflow.v2.info_stack.preview`
- `workflow.v2.info_stack.read`
- `workflow.v2.notification.preview`
- `workflow.v2.worker_backend.preflight`
- `workflow.v2.worker_spawn.preview`
- `workflow.v2.human_gate_package.preview`
- `workflow.v2.control_loop.preview`
- `workflow.v2.worker_lifecycle.preview`
- `workflow.v2.worker_handoff.preview`
- `workflow.v2.worker_retire.preview`
- `workflow.v2.worker_successor.preview`
- `workflow.v2.worker_adapter_job.preview`
- `workflow.v2.worker_adapter_job.list`
- `workflow.v2.adapter_runner.preview`
- `workflow.v2.worker_result.submit.preview`
- `workflow.v2.worker_result.fail.preview`
- `workflow.v2.owner_review.preview`
- `workflow.v2.task_group_package.preview`
- `workflow.v2.cat_brain_audit.preview`
- `workflow.v2.cat_claw_audit.preview`
- `workflow.v2.validate`

Local control-plane writes:

- `workflow.v2.plan.create`
- `workflow.v2.info_stack.record`
- `workflow.v2.read_receipt.record`
- `workflow.v2.worker_backend_preflight.record`
- `workflow.v2.worker_spawn.create`
- `workflow.v2.worker_handoff.record`
- `workflow.v2.worker_retire.record`
- `workflow.v2.worker_successor.create`
- `workflow.v2.control_loop.tick`
- `workflow.v2.worker_adapter_job.record`
- `workflow.v2.worker_adapter_job.claim`
- `workflow.v2.worker_adapter_job.heartbeat`
- `workflow.v2.worker_adapter_job.release`
- `workflow.v2.worker_adapter_job.fail`
- `workflow.v2.adapter_runner.drain`
- `workflow.v2.worker_result.submit`
- `workflow.v2.worker_result.fail`
- `workflow.v2.manager_review.record`
- `workflow.v2.owner_review.record`
- `workflow.v2.task_group_package.record`
- `workflow.v2.cat_brain_audit.record`
- `workflow.v2.cat_claw_audit.record`
- `workflow.v2.human_gate_package.record`

The write actions record orchestration state only. `workflow.v2.adapter_runner.drain`
can invoke an explicitly configured local external runner command in
`external_command` mode, but the workflow still owns the lease, artifact,
receipt, submit/fail, and database writes. It does not directly start WSL,
Docker, Hermers, Claude Code, OpenClaw, Gateway, or production queues unless a
future authorized wrapper command is separately provided.

`workflow.v2.control_loop.tick` is still local control-plane execution. It can
lease v2 worker runs, expire stale leases, schedule retries, mark exhausted
runs as `timed_out`, and run the deterministic local test backend. It does not
start Hermers, Claude Code, Docker, WSL, Gateway, or production queues.

`workflow.v2.adapter_runner.preview` and `workflow.v2.adapter_runner.drain`
support two local modes:

- `mock`, the default protocol smoke runner;
- `external_command`, a bounded command-wrapper protocol intended for future
  Hermers / Claude Code Docker runners.

The external command is supplied only by backend-specific environment variables
such as
`TRADING_AGENTS_WORKFLOW_V2_HERMERS_DOCKER_WORKER_RUNNER_CMD` and
`TRADING_AGENTS_WORKFLOW_V2_CLAUDE_CODE_DOCKER_WORKER_RUNNER_CMD`, or by the
generic `TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD`. Action payload fields
such as `runnerCommand` / `externalRunnerCommand` are rejected to avoid
caller-selected host command execution. Commands are run through `execFile`;
string commands with spaces are rejected unless supplied as a JSON array in the
configured environment variable. The command receives request/output file paths
as arguments by default and through environment variables. The command's output
status is normalized to `success`, `fail`, or `release`, and missing/invalid
output fails closed.

`workflow.v2.worker_result.submit` and `workflow.v2.worker_result.fail` are
adapter-facing control-plane writes. They require the current
`lease_owner`/`lease_until` pair from the running worker row, and the lease must
still be unexpired at the action timestamp. Submit records an information-stack
output pointer and receipt ref before moving the worker to
`submitted_for_review`; fail clears the lease and either schedules retry or
marks the run `failed` when attempts are exhausted. Successful submit does not
erase prior `last_error` evidence; retry/failure context remains available in
the worker payload and row audit fields.

## Implemented Tables

The runtime schema now creates and migrates these v2 tables idempotently:

- `workflow_v2_plans`
- `workflow_v2_plan_nodes`
- `workflow_v2_info_items`
- `workflow_v2_inbox_items`
- `workflow_v2_access_grants`
- `workflow_v2_read_receipts`
- `workflow_v2_worker_runs`
- `workflow_v2_worker_handoffs`
- `workflow_v2_manager_reviews`
- `workflow_v2_owner_reviews`
- `workflow_v2_task_group_packages`
- `workflow_v2_cat_brain_audits`
- `workflow_v2_cat_claw_audits`
- `workflow_v2_notifications`
- `workflow_v2_human_gate_packages`
- `workflow_v2_backend_preflights`

The local runtime migration now includes the minimal lifecycle subset: worker
lineage fields, context budget/usage fields, compaction count, source context
refs, handoff info references, successor pointers, and
`workflow_v2_worker_handoffs`. The richer schema draft still describes future
manager assignment, blueprint, dispatch, and runtime adapter objects that are
not part of this local slice.

The existing `workflow_session_packs` and `workflow_session_runs` tables remain
the session repository foundation. v2 worker runs reference `session_id` and
`session_run_id` rather than redefining durable cat-member identity.
`workflow.v2.worker_spawn.create` now requires the named session pack to exist
and creates a queued session-run instance before the worker row is persisted.
The injected session input contains workflow id, plan id, node id,
`workerRunId`, manager, runtime backend, task input info id, receipt/review
requirements, and the worker payload.
The queued session run is a prepared session instance, not proof that an
external runtime has started. `workflow.v2.control_loop.tick` moves it to
`running` when a worker lease is claimed. Local deterministic completion and
adapter result submit move it to `completed`; retryable failures/timeouts move
it back to `queued`; exhausted failures/timeouts move it to `failed`.

`workflow_v2_plans.status` is the plan lifecycle. `workflow_v2_plans.workflow_state`
is the workflow wait-state and can distinguish `waiting_worker`,
`waiting_review`, `waiting_manager`, `waiting_cat_brain_check`,
`waiting_cat_claw_audit`, `human_gate_request_due`, and `waiting_human`.

Prepare-task plan authority is JSON-first. `workflow.v2.plan.preview` returns a
`workflow_plan_spec.v2` object. `workflow.v2.plan.create` persists that object as
the canonical JSON artifact under `artifacts/workflow-v2/<workflowId>/plans/`,
records it in `artifact_index`, and writes the artifact path/id/hash into
`workflow_v2_plans.payload_json`. Plans now also carry Anthropic-aligned
orchestration metadata when available: `orchestrationPattern`, orchestration
rationale, worker budget, 64k worker context ceiling, and acceptance criteria.
These plan-level fields are advisory during prepare-task drafting. Missing
pattern/rationale/budget does not invalidate a lightweight plan; it is reported
through `advisoryChecks` in preview/validation so the owner and Cat Brain can
refine the simplest effective pattern without turning internal planning into a
Human-Gate-style blocker.
The alignment audit is maintained in
`docs/workflow-v2-anthropic-alignment-audit.md`.

The internal audit-chain slice records high-speed agent review actions rather
than Human-Gate-style waiting gates. `workflow.v2.owner_review.record` can only
be recorded by the plan task owner and may not use `blocked` as a review
decision. `workflow.v2.manager_review.record` can only be recorded by the
worker's responsible `manager_agent`, requires the worker to be
`submitted_for_review`, must be bound to a concrete `workerRunId`, and may not
use `blocked` as a review decision.
`workflow.v2.worker_spawn.preview/create` requires a bounded delegation contract:
worker objective, output format, tool boundary, acceptance criteria, stop
condition, and explicit `contextBudgetTokens` not exceeding 64k tokens. A
`direct_owner_execution` plan without explicit `participantManagers` remains
owner-only and does not auto-inject manager worker nodes.
`workflow.v2.task_group_package.record` packages accepted owner evidence for the
next governance step when peer review is required. `workflow.v2.cat_brain_audit.record`
requires `main` and can source either a ready task group package or an accepted
owner review for owner-direct/simple paths; task group review is not mandatory
for every task. `workflow.v2.cat_claw_audit.record` requires `cat_claw` and
rejects the retired `catclaw` id through the normal agent-id validator. A
`protocol_ready` Cat Claw audit can source `workflow.v2.human_gate_package.record`
through `sourceCatClawAuditId`. Cat Claw `protocol_ready` and Human Gate package
recording advance the local plan state to `human_gate_request_due`; they are not
proof of a submitted Human Gate, Telegram delivery, or Flashcat approval. Only
`workflow.v2.human_gate_request` advances the v2 plan to `waiting_human` after it
creates or reuses the formal pending Human Gate request. In this local slice, v2
Human Gate package status is limited to `draft` and `cat_claw_audited`;
`submitted` and `completed` remain the domain of the existing Human Gate
delivery and resume path. `sourceCatClawAuditId` must match both workflow and
plan.

Human Gate package options are authored evidence. `workflow.v2.human_gate_package.*`
now requires two to five explicit options from the task owner/Cat Brain evidence
path; Cat Claw/package code no longer fabricates default options.

The first v2 bridge to the existing Human Gate engine is now local-only:
`workflow.v2.human_gate_request.preview` validates a Cat-Claw-audited package
and shows the exact pending request that would be created, while
`workflow.v2.human_gate_request` creates or reuses the formal Human Gate record,
active buttons, `human_gate.requested` event, and queued Telegram outbox. The
bridge links the resulting `humanGateId` and outbox id back into the v2 package
payload. It intentionally does not send Telegram, complete Human Gate, dispatch
runtime work, or mark the workflow finished.

## Implemented Contracts

Information stack:

- New worker communication defaults to `pointer_only` notification payloads.
- Authoritative content lives in `workflow_v2_info_items` or artifact refs.
- `message_flow` is treated as an SMS-like notification channel that points to
  `infoId` / `inboxItemId`, not as the authoritative manager/worker content
  body.
- Sensitive, secret, and trading-classified items reject inline body previews.
- Non-sensitive inline content is also rejected unless the caller explicitly
  sets an inline allowance and reason. The default path requires an artifact,
  external, or redacted pointer.
- `workflow.v2.info_stack.read` resolves an info item by `infoId`,
  `inboxItemId`, or `grantId` and does not return inline body content by
  default.
- `workflow.v2.read_receipt.record` records explicit read evidence.

Worker backend preflight:

- OpenClaw and `openclaw_route_shell` are rejected as worker backends.
- Hermers and Claude Code oriented backends are accepted as worker-backend
  contracts.
- Model receipts must expose provider, model, fallback attempts, and error code.
- Fallback attempts fail closed when fallback is disallowed.
- OAuth expiry and refresh failures produce standardized blocking codes.
- WSL-internal `tailscaled` and unmanaged direct container ports are rejected in
  preflight.
- Receipt, OAuth, and network evidence are required by default; empty objects do
  not pass silently.
- `workflow.v2.worker_backend_preflight.record` persists the preflight evidence,
  and `workflow.v2.worker_spawn.create` binds each worker run to a recorded
  preflight id.

Worker queue/control loop:

- Worker runs now carry `attempt`, `max_attempts`, `lease_owner`,
  `lease_until`, `next_retry_at`, `last_error`, `started_at`, and
  `completed_at`.
- `workflow.v2.control_loop.preview` reports due worker runs, running leases,
  expired leases, submitted outputs, terminal rows, and invalid backend
  preflight rows without mutating state.
- `workflow.v2.control_loop.tick` first expires stale running leases, then
  claims due queued/retry worker runs with an optimistic lease update.
- `local_deterministic` is the only backend that produces output locally in this
  slice. It writes a JSON artifact under `artifacts/workflow-v2/...`, records an
  info-stack pointer, clears the lease, stores a receipt ref, and moves the
  worker run to `submitted_for_review`.
- Non-local backends such as `hermers_docker_worker` and
  `claude_code_docker_worker` can be leased into `running`, but remain waiting
  for a future adapter to submit output or fail the run.
- `workflow.v2.worker_adapter_job.preview` and
  `workflow.v2.worker_adapter_job.record` turn an already leased non-local
  worker run into a structured runner manifest and a durable
  `workflow_v2_worker_adapter_jobs` row. The manifest is written as an artifact
  pointer in the information stack, includes the prepared
  `workflow_session_runs.workerInput`, lease proof, backend profile, 64k context
  cap, and `workflow.v2.worker_result.*` return path. Recording the manifest
  does not start Docker, Hermers, Claude Code, WSL, Gateway, or any model call,
  and it leaves the worker in `running` until a later submit/fail action.
- `workflow.v2.worker_adapter_job.list`, `claim`, `heartbeat`, `release`, and
  `fail` provide the first pull-runner protocol for Hermers/Claude Code worker
  adapters. Claim only succeeds while the underlying worker row is still
  running, on the same attempt, and under an unexpired worker lease. Runner
  heartbeats/releases/failures must hold the adapter-job lease and are rechecked
  against the current worker lease before mutation. A retryable runner failure
  returns the adapter job to `retry_scheduled`; a terminal adapter-job failure
  reuses the worker fail path so the worker row and session run are marked
  failed instead of waiting for lease expiry.
- Future Hermers/Claude Code runners should claim adapter jobs, read the
  manifest/artifact pointer, and use `workflow.v2.worker_result.*` to return
  results. Result submit/fail calls that name an `adapterJobId` must also carry
  the current adapter-job runner lease (`adapterJobLeaseOwner` /
  `adapterJobLeaseUntil`) in addition to the worker lease proof, so stale runner
  output cannot terminalize the wrong adapter job. Runners should not update
  `workflow_v2_worker_runs` or the central workflow database directly.
- `workflow.v2.adapter_runner.preview` and `workflow.v2.adapter_runner.drain`
  provide the first local runner bridge. The default runner mode is `mock`: it
  claims due adapter jobs, reads the manifest artifact, writes a mock output
  artifact, then returns through `workflow.v2.worker_result.submit` or
  `workflow.v2.worker_adapter_job.fail`. The additional `external_command` mode
  uses the same claim/manifest/lease/submit/fail path, but delegates the actual
  worker execution to an explicitly configured command wrapper. That wrapper can
  later point to Hermers or Claude Code Docker runners on `wsl-agents`, but this
  repository slice itself does not start Docker, Hermers, Claude Code, WSL,
  Gateway, or any model call. Manifest hash is mandatory and must match before
  the runner accepts the artifact. Runner-internal structural errors default to
  terminal adapter/worker failure rather than retry loops; explicit
  `internalErrorRetryAllowed=true` is required to retry internal runner errors.
- Adapter runner preview/drain are now capacity-aware. `limit` is treated as a
  requested limit; the control plane computes `capacity.effectiveLimit` from
  `maxLogicalWorkers`, `backendMaxActiveJobs`, active adapter-job leases, and
  `modelMaxConcurrentCalls` / `providerMaxConcurrentCalls`. This separates
  logical fan-out from physical execution slots: a workflow can queue a 200
  worker backlog while a low-concurrency provider such as iflytek/xunfei is
  consumed through a much smaller active slot count. If capacity is zero, drain
  returns without claiming work. The current provider capacity is input/profile
  driven and scoped by backend running jobs; it is not yet a persistent backend
  registry.
  Focused regression now covers a bounded 6-worker mock pressure run with
  three runner drains at the same logical timestamp, release/retry recovery,
  terminal failures, capacity pause (`maxActiveJobs=0`), `limit=10` throttled
  to a 3-slot iflytek profile, duplicate-result protection, empty-queue
  preview, and final validator pass. This is a control-plane regression, not a
  real model/API or process-level concurrency test.
- Worker runs are linked to queued `workflow_session_runs` entries at spawn
  time, so future adapters can read a prepared session input instead of
  reconstructing task context from free text.
- Worker/session lifecycle is synchronized by the local control loop and
  adapter result APIs: queued/retry worker rows map to queued session runs,
  running workers map to running session runs, submitted/reviewed output maps
  to completed session runs, blocked rows map to failed session runs, and
  exhausted failures map to failed session runs.
- Manager review records preserve concrete review outcomes for `accepted`,
  `rejected`, `revise_required`, and `needs_human_gate`; reviewed rows clear
  worker leases instead of leaving stale ownership behind. `blocked` is not a
  manager review outcome. Blocker details belong in structured blocker/payload
  fields and then feed worker/node/workflow condition state.
- The current local table name is still `workflow_v2_manager_reviews`, but the
  design allows owner-direct paths to record the task owner as the reviewer when
  no separate manager is needed.

Worker lifecycle preview:

- `workflow.v2.worker_lifecycle.preview` is pure and side-effect free.
- It reads a worker row, latest owner/manager review, optional handoff package
  row, plan task owner, and context telemetry.
- It reports context pressure ratio, compaction count, lifecycle signals, and a
  recommendation such as `continue`, `review_due`, `handoff_required`,
  `spawn_successor`, `escalate_to_owner`, `human_gate_due`, or `no_action`.
- It returns the responsible authority set as owner/manager, not Human Gate.
- It can draft a handoff package preview, but it does not write the handoff row,
  retire a worker, or spawn a successor.

Worker lifecycle actions:

- `workflow.v2.worker_handoff.record` writes a governed handoff package row,
  records or references a handoff info-stack item, clears any worker lease, and
  moves the source worker and session run to the handoff-completed state.
- `workflow.v2.worker_retire.record` marks a source worker as `retired` after
  an accepted handoff, unless the caller explicitly allows retirement without a
  handoff for a failed/unusable worker.
- `workflow.v2.worker_successor.create` creates a queued same-class successor
  worker from an accepted handoff, links parent/supersedes/successor fields,
  consumes the handoff as `superseded`, and keeps the new session run queued for
  a future control-loop or runtime adapter.
- All three actions require `callerAgent` to be either the responsible
  `manager_agent` or the plan `task_owner_agent`. Cat Brain can audit the
  process, but this local action layer does not let it directly force worker
  retirement or successor creation.
- Handoff ids are bound to the source worker. Retire/successor actions reject
  a handoff id that belongs to a different worker run.
- Lifecycle writes re-check the source worker and accepted handoff state at
  commit time; if status, handoff, or successor pointers drift between preview
  and write, the action fails and rolls back local side effects.
- These actions still do not start Hermers, Claude Code, Docker, WSL, Gateway,
  or production queues.

Human Gate:

- Human Gate package previews require two to five approval options.
- Pause and terminate controls are generated separately from approve options.
- Cat Brain and Cat Claw identities remain explicit in the package.
- Human Gate is modeled as a governed interaction boundary, not only an approval
  switch. The bridge carries `submissionKind`, `interactionType`,
  `responseSchema`, and `resumeContract` so the same mechanism can represent
  final artifact acceptance, review feedback, option selection, arbitration,
  scope confirmation, release gates, or information requests.
- Formal v2 Human Gate requests require a `cat_claw_audited` package with a
  matching `sourceCatClawAuditId`, and the request selector must use exact
  `packageId`. `workflowId`, `planId`, and `sourceCatClawAuditId` may be supplied
  only as consistency checks, not as "latest package" selectors.
- Replaying the same v2 Human Gate request reuses the existing pending Human
  Gate and Telegram outbox and does not rewrite the v2 package payload when the
  package already links to that `humanGateId`.
- Plan-level Human Gate is not required for ordinary prepare-task admission.
  Cat Brain admission audit can approve the plan for execution, require plan
  revision, or escalate to Human Gate when Flashcat must decide material risk,
  scope, cost, production, trading, credential, deletion, or migration issues.

Validator:

- `workflow.v2.validate` verifies schema presence and cross-table workflow-id
  consistency for plans, nodes, worker runs, information items, inbox/grants,
  read receipts, notifications, manager reviews, backend preflight evidence, and
  Human Gate packages.
- The validator checks that worker `output_info_id` values point to real
  same-workflow information-stack rows produced by the same worker run.
- The validator checks that worker `session_run_id` values point to matching
  `workflow_session_runs` rows with the same session id, workflow id, node id,
  and worker id.
- The validator checks adapter job rows against the underlying worker run,
  information-stack pointer, runner lease fields, retry timing, terminal
  completion fields, manifest hash, status enum, JSON payload validity, and the
  lifecycle invariant that nonterminal adapter jobs only attach to the same
  running worker attempt.
- The validator also checks the worker/session lifecycle mapping for queued,
  retry, running, submitted/reviewed, handoff, successor, retired, blocked,
  failed/timed-out, and cancelled rows.
- The validator checks known worker lifecycle statuses, non-negative context
  telemetry, JSON validity for context refs, same-workflow parent/superseded/
  successor references, handoff info references, and
  `workflow_v2_worker_handoffs` consistency.
- `successor_spawned` worker rows must carry a successor pointer; superseded
  handoff rows must carry both the handoff info pointer and successor pointer.
- V2 session-run inputs with
  `schemaVersion=workflow_v2_worker_session_input.v1` must have a matching
  `workflow_v2_worker_runs.session_run_id`, so a partially created v2 session
  instance is visible as a validation failure.
- The validator rejects running workers without leases, retry rows without
  `next_retry_at`, submitted/accepted workers without output and receipt refs,
  terminal workers with retained leases, and accepted workers without an
  accepted owner/manager review.
- Missing v2 tables are reported through schema status instead of causing an
  uncontrolled crash.

## Not Implemented Yet

The following remain future slices and require separate authorization:

- Cat Brain semantic check automation over manager artifacts;
- Cat Claw package audit automation beyond current Human Gate package preview;
- actual `wsl-agents` Hermers Docker wrapper command wired to the
  `external_command` runner contract;
- actual `wsl-agents` Claude Code Docker wrapper command wired to the
  `external_command` runner contract;
- governed production/runtime service that polls v2 adapter jobs continuously;
- production runtime drain integration for v2 worker runs;
- single-transaction hardening for the session/preflight/worker insert chain
  in `workflow.v2.worker_spawn.create` beyond the current compensation cleanup
  and validator detection;
- production database migration or development-server checkout deployment;
- OpenClaw Gateway reload/restart;
- secret injection or OAuth device pairing;
- `wsl-models` model/GPU API smoke.

## Unified Next Plan

The next development track is maintained in
`docs/workflow-v2-unified-next-plan.md`.

Execution order:

1. split the oversized `workflow v2 orchestration kernel` regression into
   focused tests;
2. mechanically split the v2 implementation out of `src/workflow.js` with no
   behavior change;
3. replace the v2 action switch with a v2 action registry;
4. resume worker adapter work through a bounded external-command runner
   protocol before wiring real WSL/Docker services.

This order is intentional. Verification must become granular before the
implementation is modularized; otherwise later runtime work cannot reliably
distinguish a new adapter bug from an old hidden orchestration failure.

## Verification

Implemented with regression coverage in `scripts/workflow_regression_tests.mjs`:

- `workflow v2 adapter job manifest`
- `workflow v2 adapter runner drain`
- `workflow v2 adapter runner concurrency/recovery`
- `workflow v2 plan advisory and canonical artifact`
- `workflow v2 info stack and session binding`
- `workflow v2 worker spawn and lifecycle gates`
- `workflow v2 review chain`
- `workflow v2 governance human gate bridge`
- `workflow v2 lifecycle renewal and validator`
- `workflow v2 permission and console gate`

Latest focused verification passed:

- `node --check src/workflow.js`
- `node --check src/workflow-v2/constants.js`
- `node --check src/workflow-v2/helpers.js`
- `node --check scripts/workflow_regression_tests.mjs`
- `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter job manifest"`
- `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
- `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner concurrency/recovery"`
- `node scripts/workflow_regression_tests.mjs --grep "workflow v2 permission and console gate"`
- `git diff --check -- src/workflow.js src/console/action-gateway.js scripts/workflow_regression_tests.mjs docs/workflow-v2-implementation-status.md docs/workflow-v2-worker-runtime-backends.md`

2026-07-05 V2.1 focused regression split verification:

- The previous monolithic `workflow v2 orchestration kernel` regression is no
  longer registered in the active test list. Its function body is temporarily
  retained as `legacyWorkflowV2OrchestrationKernelIntegration` for reference
  while the focused tests replace it.
- Passed individually:
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 plan advisory and canonical artifact"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 info stack and session binding"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 review chain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 governance human gate bridge"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 lifecycle renewal and validator"`
- Passed grouped v2 run:
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`

2026-07-05 V2.2/V2.3/V2.4 local verification:

- Passed `node --check src/workflow.js`.
- Passed `node --check src/workflow-v2/constants.js`.
- Passed `node --check src/workflow-v2/helpers.js`.
- Passed `node --check scripts/workflow_regression_tests.mjs`.
- Passed `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"` with the new `external_command` fake runner coverage.
- Passed `node scripts/workflow_regression_tests.mjs --grep "workflow v2"` after the V2.2 module split, V2.3 action registry change, V2.4 external-command runner protocol, and documentation updates.

2026-07-04 advisory-plan correction verification:

- Passed `node --check src/workflow.js`.
- Passed `node --check scripts/workflow_regression_tests.mjs`.
- Passed an explicit smoke that creates a lightweight plan without
  `orchestrationPattern`, confirms `workflow.v2.plan.preview.valid === true`,
  confirms `orchestration_pattern_recommended` appears in preview
  `advisoryChecks`, persists the plan, and confirms `workflow.v2.validate.ok ===
  true` while `plans_anthropic_orchestration_contract` appears only in
  `advisoryChecks`.
- Passed `git diff --check -- src/workflow.js scripts/workflow_regression_tests.mjs docs/workflow-v2-anthropic-alignment-audit.md docs/workflow-v2-orchestration-kernel.md docs/workflow-v2-implementation-status.md`.
- `node scripts/workflow_regression_tests.mjs --grep "workflow v2 orchestration
  kernel"` was started twice but did not emit output within the local 90s
  observation window; both runs were cleaned up. Do not count that long
  integration regression as passed for this correction until it is split or run
  under a longer CI-style timeout.

The full regression suite was not rerun in this slice.
