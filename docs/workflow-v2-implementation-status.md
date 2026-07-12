# Workflow v2 Implementation Status

Status: local orchestration kernel plus v2 worker lifecycle, audit-chain, adapter-runner protocol, template self-evolution, and fixed-template live-plan gates implemented
Updated: 2026-07-12
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
- adapter job lookup and terminal compare-and-swap state updates are factored
  into `src/workflow-v2/adapter-job-state.js` for shared runner/result use;
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
  before the legacy non-v2 switch, with the action-to-handler map now owned by
  `src/workflow-v2/index.js` and concrete handlers still injected from
  `src/workflow.js`;
- `src/workflow-v2/constants.js` and `src/workflow-v2/helpers.js` for v2
  constants, normalization helpers, row summary mappers, lease/capacity helpers,
  and shared validation objects;
- `src/workflow-v2/template.js` for `workflow_template_spec.v1`
  normalization, validation, instantiation helpers, reward scoring, high-risk
  detection, and redacted summaries;
- `src/workflow-v2/autonomous-loop.js` for autonomous-loop node runtime helper
  logic, including iteration caps, feedback-evidence checks, and explicit
  stop-condition terminalization;
- local template registry/evaluation/promotion actions under
  `workflow.template.*`, with template instantiation delegated back to
  `workflow.v2.plan.preview/create`;
- executable live, production, trading, or high-risk v2 plans now require an
  approved fixed template binding and matching template registry entry, while
  draft plans remain persistable for refinement;
- read-only console API routes and local Codex MCP tools for template
  search/detail/stats visibility;
- workflow v2 console read-model visibility through `/api/workflows/:id/v2`,
  the V2 console tab, command-palette routes, and source-ref drilldowns;
- regression coverage for the v2 kernel, permission gate, console gate, and
  workflow-id consistency validator.

This implementation is a local control-plane kernel. It does not start worker
runtimes, Docker, WSL services, Gateway services, or production workflow queues.

2026-07-05 local template self-evolution update: workflow v2 now has a local
template layer above the existing plan rails. Canonical reusable templates are
`workflow_template_spec.v1` JSON artifacts stored under
`artifacts/workflow-v2/templates/<templateId>/v<version>.json`; instantiated
plans remain `workflow_plan_spec.v2` and are persisted only through
`workflow.v2.plan.create`. Template candidate recording writes registry rows,
canonical artifacts, and artifact index entries. Evaluation writes immutable
fixture artifacts plus append-only eval rows; reward scores update a summary
cache but cannot promote a template. Promotion and rollback update family
pointers and append events without deleting artifacts. High-risk default
promotion requires Human Gate evidence in addition to Cat Brain/Cat Claw review
evidence. Extraction from successful workflows always starts as `candidate` and
refuses unresolved side-effect uncertainty. This local slice did not restart
Gateway, sync the development-server active checkout, or enable automatic
template selection for live workflows.

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
- `workflow.template.preview`
- `workflow.template.search`
- `workflow.template.get`
- `workflow.template.instantiate.preview`
- `workflow.template.eval.preview`
- `workflow.template.stats.refresh`
- `workflow.template.promote.preview`
- `workflow.template.extract.preview`

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
- `workflow.template.record_candidate`
- `workflow.template.instantiate.record`
- `workflow.template.eval.record`
- `workflow.template.promote.record`
- `workflow.template.rollback.record`
- `workflow.template.extract.record`

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
caller-selected host command execution. Preview exposes the same missing-env,
invalid-env, and input-command rejection diagnostics in a redacted
`runnerCommandConfig` object without executing the command. Commands are run
through `execFile`; string commands with spaces are rejected unless supplied as
a JSON array in the configured environment variable. Malformed or empty JSON
array command values are reported as invalid in the redacted preview/drain
diagnostics instead of being treated as missing configuration. The command
receives request/output file paths as arguments by default and through
environment variables. The command's output status is normalized to `success`,
`fail`, or `release`, and missing/invalid output fails closed.

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
- `workflow_v2_template_specs`
- `workflow_v2_template_versions`
- `workflow_v2_template_evals`
- `workflow_v2_template_stats`
- `workflow_v2_template_events`

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
The 2026-07-05 Anthropic reference refresh also added plan-node advisory checks:
manager-worker and parallel-section nodes should carry domain ownership,
expected artifacts, and review policy; parallel sections should be distinct;
evaluator-optimizer plans should expose a separate review path; autonomous-loop
nodes should carry iteration caps, tool/environment feedback checkpoints, and
stop conditions. Generated default manager-worker nodes now include the
ownership/artifact/review-policy payload fields by default. These checks are
now hard gates at executable boundaries: non-draft `workflow.v2.plan.create`
rejects unresolved plan-node structure gaps, while draft plan persistence
remains advisory; `workflow.v2.worker_spawn.preview/create` also rejects worker
dispatch from a persisted plan that still violates these executable-node gates.
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
- The default renewal policy is global for all workers:
  `contextPressureThreshold=0.81` and `maxCompactions=1`. Reaching either
  threshold recommends `handoff_required`; once the handoff is accepted, the
  lifecycle path can spawn a same-class successor worker. These values are not
  per-call override knobs in the local lifecycle preview path.
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
- The validator also reads recorded adapter manifest artifacts, enforces
  `artifact://workflow-v2/...` path containment, parses JSON, and recomputes
  the `sha256:` manifest hash so validate/readiness checks can catch missing or
  tampered runner manifests before a real adapter consumes them.
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
- production database migration;
- OpenClaw Gateway reload/restart or live Gateway code reload verification;
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

2026-07-05 correction: the local slice has been pushed and the development
server active checkout has been fast-forwarded to the GitHub commit under a
no-restart gate. This is an on-disk checkout alignment only. OpenClaw Gateway
was not reloaded or restarted, and no production workflow state root, Docker
worker, Hermers/Claude Code wrapper, model call, or real v2 worker queue was
used for the smoke.

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

2026-07-05 independent review and server no-restart smoke:

- Independent subagent review completed with three material findings:
  external runner output initially failed open to success, payload-provided
  runner commands allowed caller-selected host execution, and missing runner
  configuration could claim work before failing. All three findings were fixed
  before commit.
- Committed and pushed GitHub `main` at
  `582fc8ede95c304a247ec98abcdd605fbb8185e3`.
- Development-server active checkout
  `/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout`
  was fast-forwarded to the same commit with no Gateway reload/restart.
- Server-side syntax checks passed:
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/constants.js`
  - `node --check src/workflow-v2/helpers.js`
  - `node --check scripts/workflow_regression_tests.mjs`
- Server-side temporary-root smoke passed for
  `workflow.v2.adapter_runner.preview` using
  `/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260705T000000-workflow-v2-server-smoke/smoke-root`.
  The result returned zero jobs as expected for an empty temporary database.
  This was not a Hermers/Claude Code worker smoke.

2026-07-05 V2.2 registry extraction follow-up:

- Added `src/workflow-v2/index.js` as the v2 action registry module.
- Moved the canonical action-to-handler-name map and v2 dispatch helper out of
  `src/workflow.js`.
- Kept concrete v2 action implementations in `src/workflow.js` for this slice;
  the registry is built by injecting handlers to avoid circular imports while
  deeper DB/action modules are still colocated.
- Passed:
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/index.js`
  - `node --check src/workflow-v2/constants.js`
  - `node --check src/workflow-v2/helpers.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 permission and console gate"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`
  - `git diff --check`

2026-07-05 V2.2 plan helper extraction follow-up:

- Added `src/workflow-v2/plan.js` for v2 plan/delegation pure helpers.
- Moved orchestration-pattern normalization, plan manager/node defaults,
  `workflow_plan_spec.v2` construction, and worker delegation-contract
  validation out of `src/workflow.js`.
- Kept `workflow.v2.plan.preview/create` and the DB/artifact write path in
  `src/workflow.js` for this slice, so the change remains mechanical and
  avoids moving SQLite/artifact dependencies before the action modules are
  ready.
- Focused verification passed:
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/plan.js`
  - `node --check src/workflow-v2/index.js`
  - `node --check src/workflow-v2/constants.js`
  - `node --check src/workflow-v2/helpers.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 plan advisory and canonical artifact"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
- Grouped verification passed:
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`
  - `git diff --check`

2026-07-05 V2.2 info-stack preview extraction follow-up:

- Added `src/workflow-v2/info-stack.js` for v2 notification preview,
  info-stack preview, and info item row materialization.
- Kept `workflow.v2.info_stack.record`, `workflow.v2.info_stack.read`, and
  `workflow.v2.read_receipt.record` in `src/workflow.js` for this slice, so
  SQLite read/write behavior remains colocated while the preview/summary body
  moves out.
- The module receives `workflowPaths`, `firstText`, `safeId`, `textHash`,
  `parseJsonValue`, and related local helpers by dependency injection to avoid
  circular imports and avoid duplicating root/path policy.
- Focused verification passed:
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/info-stack.js`
  - `node --check src/workflow-v2/plan.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 info stack and session binding"`
- Grouped verification passed:
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`
  - `git diff --check`

2026-07-05 V2.2 backend-preflight preview extraction follow-up:

- Added `src/workflow-v2/backend-preflight.js` for v2 worker backend preflight
  preview logic.
- Kept `workflow.v2.worker_backend_preflight.record` in `src/workflow.js`, so
  SQLite persistence and preflight evidence writes remain colocated while only
  the preview body moves out.
- The module receives `workflowPaths`, `firstText`, `boolOption`, and `safeId`
  by dependency injection to avoid circular imports and avoid duplicating
  workflow root/id policy.
- Focused verification passed:
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/backend-preflight.js`
  - `node --check src/workflow-v2/index.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 permission and console gate"`
- Grouped verification passed:
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`
  - `git diff --check`

2026-07-05 Anthropic plan-node alignment follow-up:

- Refreshed official Anthropic/Claude Code references for multi-agent Research,
  subagents, agent teams, dynamic workflows, worktrees, hooks, and goals.
- Added plan-node advisory coverage for manager-worker/parallel/evaluator/
  autonomous-loop structure in `workflow.v2.plan.preview`.
- Added default manager-worker node payload fields for domain ownership,
  expected artifacts, and manager review policy.
- Independent subagent review found one medium gap: explicit `manager_worker`
  plans with no `manager_worker_spawn` node did not receive a structure
  advisory. The gap is fixed by `manager_worker_spawn_node_recommended`, with
  regression coverage for the missing-spawn case, a clean explicit node set, and
  canonical plan-spec expected-artifact persistence.
- Upgraded the plan-node structure checks from advisory-only to executable hard
  gates:
  - non-draft plan admission rejects unresolved manager-worker, parallel
    section, evaluator-optimizer, and autonomous-loop node gaps;
  - draft plan persistence remains allowed while the owner is still shaping the
    plan;
  - worker spawn preview/create re-checks persisted plan hard gates before
    dispatch.
- Focused verification passed locally:
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/index.js`
  - `node --check src/workflow-v2/plan.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 plan advisory and canonical artifact"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`

2026-07-05 autonomous-loop runtime control-loop enforcement:

- Reused the existing v2 runtime tables instead of adding a second loop engine:
  `workflow_v2_plan_nodes` stores loop node state, `workflow_v2_worker_runs`
  supplies the persisted iteration count, and `workflow_v2_info_items` carries
  tool/environment feedback evidence.
- `workflow.v2.worker_spawn.preview/create` now gates
  `autonomous_agent_loop` nodes at runtime:
  - blocks the next spawn once existing non-cancelled worker runs reach the
    declared `maxIterations`/`iterationCap`;
  - blocks the next spawn while the previous iteration is still queued/running;
  - requires feedback info-stack evidence recorded after the previous iteration
    and bound to both the previous worker run and a declared feedback checkpoint
    before iteration 2+;
  - blocks new spawns once the loop node is terminal;
  - records `iterationCount`, `nextIteration`, `maxIterations`, and feedback
    evidence in the worker payload/session input.
- `workflow.v2.control_loop.tick` and `workflow.v2.worker_result.submit` now
  terminalize autonomous-loop nodes through the existing result path when
  explicit `stopConditionSatisfied` evidence is present. The node is marked
  `completed` with output info and receipt pointers, and later spawns fail with
  `autonomous_loop_terminal`.
- `workflow.v2.validate` now includes an `autonomous_loop_iteration_caps` check
  so persisted historical drift above the declared cap is visible.
- Focused verification passed locally:
  - `node --check src/workflow.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 autonomous loop runtime enforcement"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`
  - `git diff --check`
- Remaining orchestration hardening after this slice: expose evaluator receipts
  more clearly in read-model/UI surfaces and carry the contract through external
  runtime adapter manifests.

2026-07-05 evaluator-optimizer contract hardening:

- Added first-class evaluator contract gates without adding a parallel review
  table or state machine.
- `workflow.v2.plan.preview/create` now requires executable
  `evaluator_optimizer` plans to declare:
  - producer output schema/contract or expected artifacts;
  - evaluator input binding to the producer;
  - rubric/schema;
  - review artifact contract;
  - `accepted` / `rejected` / `needs_revision` decision states.
- `workflow.v2.manager_review.record` now treats the accepted/rejected/revision
  manager review as the evaluator receipt for evaluator-optimizer plans. It
  writes a normalized `evaluatorReceipt` into
  `workflow_v2_manager_reviews.payload_json`, bound to producer output,
  evaluator input, rubric, review artifact, review receipt, and decision state.
  The receipt must match the reviewed worker run, node, and output info id.
- `workflow.v2.owner_review.preview/record` now rejects evaluator-optimizer
  owner acceptance if the referenced accepted manager review is not a structured
  evaluator receipt. `allowNoManagerReviews` is not allowed to bypass evaluator
  receipt requirements for this pattern. This keeps acceptance on existing
  owner/manager review rails while preventing loose producer text from being
  consumed directly.
- `workflow.v2.validate` now includes
  `evaluator_optimizer_manager_reviews_have_receipts`.
- Focused verification passed locally:
  - `node --check src/workflow-v2/plan.js`
  - `node --check src/workflow.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 plan advisory and canonical artifact"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 evaluator optimizer contract"`

2026-07-11 V2.2 autonomous-loop helper extraction follow-up:

- Added `src/workflow-v2/autonomous-loop.js` for autonomous-loop runtime helper
  logic.
- Moved autonomous-loop node detection, iteration statistics, feedback evidence
  checks, spawn gating, stop-condition checks, and node terminalization out of
  `src/workflow.js`.
- Kept behavior on the same worker spawn, control-loop, worker-result, and
  validator paths by importing the helper functions and node-type set back into
  `src/workflow.js`.
- Added the new module to `npm run check`.
- Focused verification passed locally:
  - `node --check src/workflow-v2/autonomous-loop.js`
  - `node --check src/workflow.js`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 autonomous loop runtime enforcement"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 lifecycle renewal and validator"`

2026-07-12 V2.4 fixed-template live-plan admission gate:

- Added plan-level template binding helpers to `src/workflow-v2/plan.js`.
- `workflow.v2.plan.preview` now marks executable ad-hoc plans with a
  fixed-template advisory, and distinguishes live/production/trading/high-risk
  plans with `fixed_template_plan_required_for_live_execution`.
- `workflow.v2.plan.create` now blocks non-draft live, production, trading, or
  high-risk plans unless the plan is bound to an active/default/frozen
  `workflow_template_spec.v1` registry version. Forged payload-only template
  bindings fail closed because the registry row, status, artifact ref, and
  artifact hash are checked.
- `workflow.template.instantiate.*` now carries registry source, promoted
  template status, artifact ref/hash, and `fixedPlan=true` into the generated
  plan payload and `workflow_plan_spec.v2.templateBinding`.
- This keeps workflow v2's production direction centered on fixed-template
  multi-agent execution plans, with draft/advisory paths preserved for planning
  and migration.
- Focused verification passed locally:
  - `node --check src/workflow-v2/plan.js`
  - `node --check src/workflow-v2/plan-actions.js`
  - `node --check src/workflow-v2/template-actions.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 fixed template plan gate"`
 - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 plan advisory and canonical artifact"`
 - `node scripts/workflow_regression_tests.mjs --grep "workflow template self-evolution"`

2026-07-12 V2.2 worker-state helper extraction follow-up:

- Added `src/workflow-v2/worker-state.js` for worker run, lease, worker result
  lookup, lifecycle actor, and worker handoff state helpers.
- Updated worker lifecycle, worker result, adapter runner, control-loop, and
  review action modules to import worker-state helpers directly instead of
  receiving them from `src/workflow.js` context injection.
- Kept cross-domain session patching, info-stack writes, adapter job terminal
  updates, and worker-result submit/fail behavior on the existing action paths;
  this slice is a no-schema-change module split.
- Added the new module to `npm run check`.
- Focused verification passed locally:
  - `node --check src/workflow-v2/worker-state.js`
  - `node --check src/workflow-v2/worker-lifecycle-actions.js`
  - `node --check src/workflow-v2/worker-result-actions.js`
  - `node --check src/workflow-v2/adapter-runner-actions.js`
  - `node --check src/workflow-v2/control-loop-actions.js`
  - `node --check src/workflow-v2/review-actions.js`
  - `node --check src/workflow.js`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 control loop"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 autonomous loop runtime enforcement"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 lifecycle renewal and validator"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 fixed template plan gate"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2.2 console read-model visibility follow-up:

- Added a dedicated workflow v2 console read model in
  `src/console/read-model.js` for persisted v2 plan, node, worker, adapter job,
  manager/owner review, governance audit, Human Gate package, and summary
  state visibility.
- Added the `/api/workflows/:workflowId/v2` child payload route and V2 tab
  rendering so operators can inspect fixed-template v2 plans without reading
  the database directly.
- Wired command-palette entries and source-ref drilldowns for v2 plan rows,
  including v2-only plan records that do not have a legacy `workflow_runs`
  parent row.
- Kept the read model redacted by default: inline sensitive bodies, callback
  tokens, and secret-ish payload fields are not returned to the console.
- This slice is read-only console/control-plane visibility only. It does not
  start worker runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or
  production workflow queues.
- Focused verification passed locally:
  - `npm run check`
  - `git diff --check`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 console read model visibility"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow console agentic surfaces"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow console static diagnostic matrix contract"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 permission and console gate"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner"`

2026-07-12 V2.2 adapter-job state helper extraction follow-up:

- Added `src/workflow-v2/adapter-job-state.js` for adapter job row lookup and
  lease-bound terminal compare-and-swap updates.
- Updated `src/workflow-v2/adapter-runner-actions.js` to reuse the shared
  adapter job lookup helper.
- Updated `src/workflow-v2/worker-result-actions.js` to import terminal
  adapter job updates directly instead of receiving them from `src/workflow.js`
  context injection.
- Removed the adapter job terminal helper from `src/workflow.js` and added the
  new module to `npm run check`.
- This slice is a no-schema-change helper split. It does not start real
  worker runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production
  workflow queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/adapter-job-state.js`
  - `node --check src/workflow-v2/adapter-runner-actions.js`
  - `node --check src/workflow-v2/worker-result-actions.js`
  - `node --check src/workflow.js`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter job terminal helper"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter job manifest"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner concurrency/recovery"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `npm run check`

2026-07-12 V2.2 plan-state helper extraction follow-up:

- Added `src/workflow-v2/plan-state.js` for persisted v2 plan row loading,
  plan `workflow_state` patching, and persisted orchestration-pattern lookup.
- Updated `src/workflow.js` to import these plan-state helpers instead of
  owning their SQL bodies inline, while keeping the existing review-chain and
  Human Gate context injection unchanged for this slice.
- Added the new module to `npm run check`.
- This slice is a no-schema-change helper split. It does not start real worker
  runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production workflow
  queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/plan-state.js`
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/review-actions.js`
  - `node --check src/workflow-v2/human-gate-actions.js`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 plan state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 review chain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 governance human gate bridge"`
 - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 fixed template plan gate"`
 - `npm run check`
 - `git diff --check`

2026-07-12 V2.2 session-state helper extraction follow-up:

- Added `src/workflow-v2/session-state.js` for v2 session-run restore,
  patch/require patch, and retry-delay helper logic.
- Updated `src/workflow.js` to import the session-state helpers while keeping
  `workflowTaskPhaseInfo` and `upsertWorkflowAgentRun` as explicit dependencies
  supplied by the existing workflow control-plane layer.
- Added a direct helper regression for session-run patching, redacted output
  persistence, restore behavior, missing-run failure, and retry-delay bounds.
- Added the new module to `npm run check`.
- This slice is a no-schema-change helper split. It does not start real worker
  runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production workflow
  queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/session-state.js`
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/worker-lifecycle-actions.js`
  - `node --check src/workflow-v2/worker-result-actions.js`
  - `node --check src/workflow-v2/control-loop-actions.js`
  - `node --check src/workflow-v2/review-actions.js`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 session state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 control loop scoped claim"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 review chain"`
 - `npm run check`
 - `git diff --check`

2026-07-12 V2.2 review-state helper extraction follow-up:

- Added `src/workflow-v2/review-state.js` for v2 manager-review rollback
  restore/delete helper logic.
- Updated `src/workflow.js` to import the review-state helper while keeping the
  existing review action context injection unchanged for this slice.
- Added a direct helper regression for restoring a mutated manager review row
  to its captured previous state and deleting a newly inserted review row when
  rollback has no previous row.
- Added the new module to `npm run check`.
- This slice is a no-schema-change helper split. It does not start real worker
  runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production workflow
  queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/review-state.js`
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/review-actions.js`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 review state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 review chain"`
 - `npm run check`
 - `git diff --check`

2026-07-12 V2.2 info-stack-state helper extraction follow-up:

- Added `src/workflow-v2/info-stack-state.js` for v2 info item lookup and
  cleanup cascade helper logic.
- Updated `src/workflow.js` to import the info-stack-state helpers while
  keeping the existing worker lifecycle, control-loop, worker-result, and
  adapter-runner context injection seams unchanged for this slice.
- Added a direct helper regression for empty/missing info lookup, existing info
  row lookup, no-op empty cleanup, and cascade deletion across info item,
  inbox, access grant, notification, and read receipt rows.
- Added the new module to `npm run check`.
- This slice is a no-schema-change helper split. It does not start real worker
  runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production workflow
  queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/info-stack-state.js`
  - `node --check src/workflow.js`
  - `node --check src/workflow-v2/worker-lifecycle-actions.js`
  - `node --check src/workflow-v2/control-loop-actions.js`
  - `node --check src/workflow-v2/worker-result-actions.js`
  - `node --check src/workflow-v2/adapter-runner-actions.js`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 info stack state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 control loop scoped claim"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2.2 shared agent-run-state helper extraction follow-up:

- Added `src/workflow/agent-run-state.js` for shared workflow agent-run phase
  id generation, task phase lookup, and workflow agent-run upsert logic.
- Updated `src/workflow.js` to import those helpers while preserving the
  existing session action and workflow-v2 session-state dependency injection
  seams.
- Added a direct helper regression for phase id sanitization, fallback phase
  lookup, task-backed phase lookup, empty run no-op, initial agent-run insert,
  and conflict update field preservation/replacement behavior.
- Added the new module to `npm run check`.
- This slice is a no-schema-change helper split. It does not start real worker
  runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production workflow
  queues.
- Focused verification passed locally:
  - `node --check src/workflow/agent-run-state.js`
  - `node --check src/workflow.js`
  - `node --check src/session-actions.js`
  - `node --check src/workflow-v2/session-state.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow agent-run state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "session extracted action contracts"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 session state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2.2 agent-run upsert SQL builder convergence follow-up:

- Exported `workflowAgentRunUpsertSql` from `src/workflow/agent-run-state.js`
  so transaction-scoped callers can reuse the same workflow agent-run upsert
  statement as the async helper path.
- Updated `workflow.v2.worker_spawn.create` planning in
  `src/workflow-v2/worker-lifecycle-actions.js` to reuse the shared SQL
  builder for both existing-session dedupe backfill and new session-run insert
  transactions.
- Extended the direct helper regression to execute SQL generated by the shared
  builder before exercising the async upsert path.
- This slice is a no-schema-change helper convergence. It does not start real
  worker runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production
  workflow queues.
- Focused verification passed locally:
  - `node --check src/workflow/agent-run-state.js`
  - `node --check src/workflow-v2/worker-lifecycle-actions.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow agent-run state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2.2 Human Gate state helper extraction follow-up:

- Added `src/workflow-v2/human-gate-state.js` for Cat Claw audit row lookup
  and v2 Human Gate package row selection by exact package id or scoped
  workflow/plan/source-audit filters.
- Updated `src/workflow-v2/human-gate-actions.js` to import those helpers while
  preserving existing package preview, package record, Human Gate request
  preview, and request write behavior.
- Added a direct helper regression for missing DB behavior, empty selectors,
  audit lookup, package-id aliases, filter aliases, latest package ordering, and
  no-match results.
- Added the new module to `npm run check`.
- This slice is a no-schema-change helper split. It does not start real worker
  runtimes, WSL, Docker, Hermers, Claude Code, Gateway, Telegram delivery, or
  production workflow queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/human-gate-state.js`
  - `node --check src/workflow-v2/human-gate-actions.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 Human Gate state helpers"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 governance human gate bridge"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2.4 adapter manifest validator hardening:

- Added filesystem-aware adapter manifest validation to
  `workflow.v2.validate`.
- `adapter_job_manifest_artifacts_match_hash` reads recorded adapter manifest
  artifacts, requires `artifact://workflow-v2/...` containment, parses JSON, and
  recomputes the `sha256:` hash against `workflow_v2_worker_adapter_jobs`.
- Extended the adapter runner regression to tamper with a recorded manifest
  artifact and assert the new validator check fails closed before runner drain.
- Added a focused validator hardening regression for more than 500 adapter
  jobs, non-v2 artifact refs, empty suffixes, traversal refs, symlink refs, and
  `failedChecks` summary inclusion.
- This is still a local control-plane validation slice. It does not start
  worker runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production
  workflow queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/validate-actions.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter manifest validator hardening"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter job manifest"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner concurrency/recovery"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 lifecycle renewal and validator"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2.4 adapter manifest contract hardening:

- Added explicit adapter manifest contract metadata:
  `manifestSchemaVersion`, `runnerRequestSchemaVersion`, task input read
  action, submit/fail actions, and review/receipt requirements.
- Added `adapter_job_manifest_contract_consistency` to
  `workflow.v2.validate`. The check reads each recorded adapter manifest
  artifact and compares it to the adapter job row, worker row, session run,
  backend preflight, task input pointer, output action contract, context
  budget, and no-direct-DB/no-secret constraints. Field mismatch issues report
  the field, expected value, actual type, and presence only; they do not echo
  raw manifest values.
- Extended the adapter job manifest regression so a manifest with a recomputed
  valid hash but wrong `taskInput.infoId` passes the hash check and fails the
  new contract check.
- Added terminal adapter job coverage proving completed/failed manifests still
  pass the contract check when their audit rows are intact, and that terminal
  hash-only vs contract-only failures stay separated.
- This is still a local control-plane validation slice. It does not start
  worker runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production
  workflow queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/adapter-runner-actions.js`
  - `node --check src/workflow-v2/validate-actions.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter job manifest"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter manifest validator hardening"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner concurrency/recovery"`

2026-07-12 V2.4 adapter runner contract gate:

- Extracted adapter manifest contract comparison into
  `src/workflow-v2/adapter-manifest-contract.js` so `workflow.v2.validate` and
  `workflow.v2.adapter_runner.drain` use the same field-level rules.
- `workflow.v2.adapter_runner.drain` now rechecks a claimed job's manifest
  against the current adapter job, worker, session run, backend preflight, task
  input, output contract, context, and no-direct-DB/no-secret facts before
  invoking either the mock runner or external command runner.
- Runtime manifest reads now use the same local path hardening as validation:
  `artifact://workflow-v2/...` containment, realpath boundary checks, and
  regular-file checks before JSON parsing.
- The manifest artifact/hash validator no longer skips rows with a recorded
  artifact but empty `manifest_hash`; those rows report `manifest_hash_missing`
  while drain still fails closed before execution.
- A manifest whose hash is valid but whose contract points at the wrong task
  input fails closed as an internal runner error and is recorded through the
  governed adapter-job/worker failure path. The execution error reports only
  reason, field, and count; it does not echo raw manifest values.
- This is still a local control-plane execution gate. It does not start worker
  runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production workflow
  queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/adapter-manifest-contract.js`
  - `node --check src/workflow-v2/adapter-runner-actions.js`
  - `node --check src/workflow-v2/validate-actions.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter job manifest"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter manifest validator hardening"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner concurrency/recovery"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2.4 external runner preview diagnostics:

- Added a redacted `runnerCommandConfig` diagnostic object to
  `workflow.v2.adapter_runner.preview`.
- Preview now reports whether the external command is configured, which
  environment variable supplied it, executable path, argc, payload-command
  rejection, missing-env errors, and invalid-env errors without executing any
  runner command.
- `workflow.v2.adapter_runner.drain` reuses the same config parser, keeping
  preview diagnostics aligned with execution-time fail-closed behavior.
- Extended the adapter runner regression to cover missing backend/generic env,
  rejected action-supplied runner commands, configured backend env, generic env
  fallback, invalid env diagnostics without secret-value leakage, and
  preservation of the legacy `runnerCommandRequired` /
  `runnerCommandConfigured` fields.
- This is still a local control-plane diagnostics slice. It does not start
  worker runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production
  workflow queues.
- Focused verification passed locally:
  - `node --check src/workflow-v2/adapter-runner-actions.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner concurrency/recovery"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter job manifest"`
  - `npm run check`
  - `git diff --check`

2026-07-12 V2 worker spawn transaction hardening:

- Replaced the `workflow.v2.worker_spawn.create` session/preflight/worker
  persistence chain with one `BEGIN IMMEDIATE` SQLite transaction.
- The create path now prepares the same session run, workflow agent run,
  backend preflight record, and worker run row, then commits them together
  instead of relying on best-effort compensation cleanup after partial writes.
- Added a regression trigger that forces the worker-row insert to abort and
  asserts no session run, workflow agent run, backend preflight, or worker row
  remains afterward.
- Added idempotent replay coverage for an existing queued worker run with the
  same session/preflight ids, asserting the session run, agent run, preflight,
  and worker rows remain singletons.
- This is still a local control-plane persistence slice. It does not start
  worker runtimes, WSL, Docker, Hermers, Claude Code, Gateway, or production
  workflow queues.
- Focused verification passed locally:
  - `node --check src/session-actions.js`
  - `node --check src/workflow-v2/worker-lifecycle-actions.js`
  - `node --check src/workflow.js`
  - `node --check scripts/workflow_regression_tests.mjs`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 worker spawn and lifecycle gates"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 autonomous loop runtime enforcement"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2 adapter runner drain"`
  - `node scripts/workflow_regression_tests.mjs --grep "workflow v2"`
  - `npm run check`
  - `git diff --check`

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
