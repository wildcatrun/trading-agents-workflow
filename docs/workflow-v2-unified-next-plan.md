# Workflow v2 Unified Next Plan

Status update 2026-07-09: retained as v2 architecture and future evolution
context. The current cleanup/convergence pass is tracked in
`docs/workflow-kernel-convergence-plan.md`.

This file is not deprecated and does not block future v2 feature development.
The 2026-07-09 convergence pass only clarifies the current production entry
discipline while the project is still in R&D: prefer audited templates or
Human-Gate-authorized plans for scheduled execution, keep generic/v2
orchestration available for authoring, diagnostics, recovery, compatibility,
and approved-plan execution, and avoid treating ad-hoc direct writes as the
default production path.

Status: V2.1-V2.4 local slice landed; Anthropic plan-node executable gates and fixed-template live-plan gates landed; deeper V2.2 split continuing with autonomous-loop, worker-state, plan-state, session-state, review-state, info-stack-state, and shared agent-run-state helper extraction landed; adapter runner manifest contract gate landed locally
Created: 2026-07-05
Scope: verification, modularization, and runtime-adapter preparation after the
local v2 orchestration kernel slice

## Purpose

The v2 kernel now has enough local behavior that continuing to add features
inside `src/workflow.js` and one long integration test is no longer sustainable.
This plan turns the next work into a single ordered track:

1. make the current v2 behavior testable in small focused slices;
2. mechanically split the oversized `workflow.js` v2 section without behavior
   changes;
3. replace the growing v2 action switch with a registry;
4. only then continue real worker runtime adapter work.

The goal is not to pause product progress for refactoring. The goal is to make
future worker/runtime work measurable, reviewable, and reversible.

## Unified P0-P7 Development Flow

Status: active execution plan from 2026-07-15.

This section supersedes ad-hoc "slice-first" planning. Future workflow v2 work
should advance through one ordered multi-step development flow. A local helper,
preview, adapter, or test change may still be implemented as a small patch, but
it must be mapped to the current P0-P7 stage and must not create unplanned
workflow execution paths.

Global constraints:

- `trading-agents-workflow` is a multi-agent orchestration control plane for
  audited, professional trading-oriented workflows; it is not a generic
  task-runner for unplanned work.
- Workflow execution/write surfaces are responsible only for approved/audited
  v2 plans, approved templates, or explicit Human-Gate-authorized plans.
- Work without plan authorization stays in read-only audit, diagnostics,
  documentation, development, or the owning business/stability platform; it
  must not use workflow dispatch, control-loop, message_flow, runtime adapter,
  Human Gate, outbox, incident, checkpoint, side-effect, or trading handoff
  writes to advance real work.
- Each stage must keep code, tests, docs, evidence, rollback boundary, and
  independent review in sync before being marked complete.

### P0 Baseline Freeze

Goal: establish the current v2 state as the baseline for this unified plan.

Required outputs:

- current Git HEAD and working-tree state;
- implemented v2 action inventory and runtime boundaries;
- explicit list of remaining unsafe/gated items;
- evidence path for local checks;
- rollback boundary for the next stage.

Completion criteria:

- `docs/workflow-v2-implementation-status.md` and this plan agree on current
  status;
- `npm run check`, focused v2 regressions, release smoke, and `git diff --check`
  pass or have explicit documented limitations;
- independent review is complete for behavior-affecting changes.

Current baseline snapshot, 2026-07-15:

- source repo: `/Users/Flashcat/multi-agent-hedge-fund-framework/github-upload-staging-20260517T2258/trading-agents-workflow`;
- baseline HEAD: `4060a43bf2148735df3ab450c86055c4ff2a070f`;
- package: `@flashcat/trading-agents-workflow@0.7.0`;
- v2 action registry count after P4 service plan preview addition: `68`;
- current local working tree contains the active P1 Cat Claw package audit
  preview, Cat Brain semantic check preview, adapter runner drain readiness
  preview, and documentation updates; it has not been committed, pushed,
  deployed, or loaded into the development-server active checkout;
- latest local release-smoke evidence:
  `.tmp-smoke-release/local-v2-cat-claw-package-audit-preview-r2/index.json`;
- latest independent review: subagent `Cicero` reviewed the Cat Claw package
  audit preview diff; the selector ambiguity and coverage findings were fixed
  before this baseline was recorded.
- P1 local progress after baseline: Cat Brain semantic check preview and adapter
  runner drain readiness preview are implemented and covered by focused
  regressions.

P0 status: complete for local development baseline. P1 remains active.

### P1 Governance Preview Layer

Goal: complete read-only governance automation before any real runtime worker
execution.

Required outputs:

- Cat Brain semantic check preview over manager artifacts, receipts, readiness,
  rollback anchors, blockers, and unresolved evidence gaps: implemented locally;
- Cat Claw package audit preview over package structure, option evidence,
  delivery boundary, controls, and token redaction: implemented locally;
- read-only production/runtime drain readiness inspection for v2 adapter jobs:
  implemented locally;
- no Human Gate creation, Telegram delivery, runtime dispatch, queue drain, or
  workflow state mutation from these preview surfaces.

Completion criteria:

- preview actions are registered, read-only, and covered by focused regression
  tests;
- previews report zero writes and reject ambiguous selectors;
- docs record limitations and operator handoff.

### P2 Fixed Template Productionization

Goal: turn daily trading workflow intent into governed reusable templates
without enabling automatic live selection.

Required outputs:

- draft daily trading workflow template families;
- evaluation fixtures and scoring criteria;
- promotion/rollback policy evidence;
- high-risk default promotion Human Gate requirements.

Local progress after P1:

- `workflow.template.daily_trading_catalog.preview` provides candidate-only
  daily trading template drafts for morning readiness, intraday signal review,
  and end-of-day closeout.
- The catalog is read-only and does not record candidates, instantiate plans,
  promote defaults, enable automatic live selection, or create trading side
  effects.

Completion criteria:

- templates remain JSON artifacts, not executable scripts;
- template instantiation passes only through `workflow.v2.plan.preview/create`;
- no automatic default template selection for live workflows is enabled.

### P3 Real Worker Adapter Wiring

Goal: wire real worker execution behind existing execute guards.

Required outputs:

- Hermers Docker worker wrapper command integration;
- Claude Code worker wrapper command integration;
- dry-run and execute-guard tests before real execution;
- explicit secret/OAuth/environment injection plan.

Local progress after P2:

- `workflow.v2.adapter_runner.wrapper_contract.preview` provides a read-only
  P3 wrapper contract for both `hermers_docker_worker` and
  `claude_code_docker_worker`.
- The contract exposes backend-specific env keys for configured JSON-array
  runner commands, pins the production wrapper to
  `scripts/workflow_v2_external_runner_execute_guard.mjs`, and keeps
  caller-selected host commands disallowed.
- `workflow.v2.adapter_runner.drain` now fails closed unless the configured
  external command uses the execute guard. Internal dummy/dry-run runner
  scripts are allowed only for local smoke fixtures when the explicit
  `TRADING_AGENTS_WORKFLOW_V2_ALLOW_INTERNAL_FIXTURE_RUNNER=1` test gate is
  set.
- The contract records the secret/OAuth/environment injection plan by
  reference only: mac-codex remains the OAuth refresh owner, server-side
  refresh is disallowed, and no secret values are emitted.
- Real execution remains unavailable until a future executor implementation is
  added behind `--execute`, the env gate, and Human Gate authorization JSON.

Completion criteria:

- no caller-selected host command execution;
- real execute remains gated by explicit flag, env gate, and Human Gate
  authorization JSON;
- worker output returns through `workflow.v2.worker_result.*` with receipts.

### P4 Runtime Drain Service

Goal: introduce a governed runtime drain service for v2 adapter jobs.

Required outputs:

- service design with lease, limit, backoff, idempotency, log, and failure
  closure;
- dry-run/readiness mode;
- action ledger and rollback procedure;
- no trading side effects.

Completion criteria:

- service can be disabled without corrupting adapter job state;
- stuck jobs, expired leases, failed jobs, and retries are auditable;
- deployment requires separate server evidence and postcheck.

Local progress after P3:

- `workflow.v2.adapter_runner.service_plan.preview` provides a read-only P4
  service contract for one runtime backend, reusing
  `workflow.v2.adapter_runner.drain_readiness.preview`.
- `scripts/workflow_v2_adapter_runner_service.mjs` is a one-shot dry-run runner
  by default. It only attempts drain when `--execute`,
  `TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_SERVICE_EXECUTE=1`,
  `mode=external_command`, valid execute-guard runner config, and the existing
  generic orchestration/action-policy gate are all satisfied.
- The preview records disable/rollback procedures, lease/backoff/idempotency
  policy, action-ledger schema, and zero `wouldCreate` counts for service files,
  systemd units, job claims, runtime dispatches, Docker, model calls, and
  trading side effects.

### P5 End-to-End Non-Trading Rehearsal

Goal: prove the full v2 chain without real trading or production side effects.

Required flow:

approved template -> plan/node -> worker -> manager/owner review -> Cat Brain
audit -> Cat Claw package audit -> Human Gate request -> receipt/readiness
closeout.

Completion criteria:

- all receipts, artifacts, review rows, Human Gate request rows, outbox rows, and
  readiness checks are present;
- no real Telegram delivery or live side effects unless separately authorized;
- recovery and rollback evidence is complete.

Local progress after P4:

- `scripts/workflow_v2_non_trading_rehearsal_smoke.mjs` provides the explicit P5
  non-trading rehearsal entrypoint.
- The smoke runs the existing focused fixed-template plan gate, review-chain,
  and governance/Human Gate bridge regressions as one named rehearsal, covering
  approved template instantiation, worker result, manager/owner review, task
  group package, Cat Brain audit, Cat Claw audit, Human Gate package/request,
  idempotent replay, and queued outbox without real Telegram delivery, Docker,
  model calls, or trading side effects.

### P6 Trading Pre-Execution Integration

Goal: connect only to deterministic paper/dry-run `trading_core` handoff.

Required outputs:

- typed `executable_trade_intent` / paper handoff contract;
- risk decision and Human Gate binding;
- idempotency key and side-effect ledger coverage;
- paper smoke and fail-closed behavior.

Completion criteria:

- no broker/live trading credentials in workflow;
- no live order placement;
- uncertain side effects enter `side_effect_uncertain` and require human review.

Local progress after P5:

- `scripts/workflow_v2_trading_pre_execution_smoke.mjs` provides the explicit
  P6 paper-only pre-execution rehearsal entrypoint.
- The smoke runs the existing focused trade-chain guardrail and v2
  permission/console-gate regressions as one named P6 rehearsal, covering
  Human Gate binding, Cat Tail pre-order risk decision, paper
  `executable_trade_intent`, idempotency replay/conflict, live-execution
  fail-closed behavior, `trading_core.receipt` transition guardrails, and
  `side_effect_uncertain` blocking for trading actions.
- The smoke is included in release smoke capture and reports no broker
  credentials, no live broker adapter, no live order placement, and no live
  trading. The separate `npm run smoke:trading-core` remains the deterministic
  paper bridge check when a local `trading_core` checkout is available.

### P7 Production Release Governance

Goal: release a deployable v2 production candidate through Git and governed
server rollout.

Required outputs:

- GitHub commit/tag/release notes;
- dev-server fast-forward deploy;
- release smoke and OpenClaw postchecks;
- production readiness checklist;
- rollback plan and evidence artifact.

Completion criteria:

- active checkout is aligned by Git, not manual copy;
- server evidence path is recorded;
- no Gateway restart, production migration, live Telegram delivery, or trading
  action occurs without explicit authorization and Human Gate where required.

Local release-candidate governance:

- This local P0-P7 candidate is not automatically committed, pushed, tagged, or
  deployed. GitHub commit/tag/release and dev-server fast-forward rollout remain
  explicit operator actions.
- Minimum local candidate quality gates:
  - `node scripts/workflow_v2_non_trading_rehearsal_smoke.mjs`;
  - `node scripts/workflow_v2_trading_pre_execution_smoke.mjs`;
  - `npm run smoke:trading-core`;
  - `npm run check`;
  - `npm run smoke:release -- --run-id <local-v2-p0-p7-candidate>`;
  - `git diff --check`;
  - independent subagent review for behavior-affecting P5/P6 changes.
- Dev-server rollout, if explicitly authorized later, must use GitHub
  fast-forward only and then run server release smoke plus OpenClaw postchecks.
  Manual copy, `scp` replacement, Gateway restart, production migration, live
  Telegram delivery, and live trading remain out of scope for this local
  candidate.

## Current Problem

- `src/workflow.js` is over 28k lines. The v2 implementation alone spans roughly
  the `workflowV2*` block and the v2 cases in `runWorkflowAction`.
- `scripts/workflow_regression_tests.mjs` is over 12k lines.
- The `workflow v2 orchestration kernel` regression currently covers a long
  end-to-end chain and did not emit output within a local 90s observation window
  during the 2026-07-04 advisory-plan correction verification.
- Because the test is too broad, a future module split or runtime adapter change
  could fail without making the failing slice obvious.

## Non-Goals

This plan did not originally authorize:

- production database migration;
- development-server checkout deployment;
- OpenClaw Gateway reload/restart;
- Docker creation/start on `wsl-agents`;
- Hermers, Claude Code, or model secret configuration changes;
- real worker runtime queue connection.

The development-server active checkout was later aligned to GitHub on
2026-07-05 under an explicit no-restart gate. The remaining items still require
separate gates after the local validation and modularization track is healthy.

## Track V2.1: Split Verification First

Status: landed locally on 2026-07-05.

The first implementation step is to split the current long orchestration
regression into focused tests. This should be a test-only change unless a test
exposes an existing bug.

Target test slices:

- `workflow v2 plan advisory and canonical artifact`
  - plan preview advisory semantics;
  - `workflow_plan_spec.v2` canonical JSON artifact;
  - direct-owner path does not auto-inject managers;
  - validator plan-alignment gaps stay advisory.
- `workflow v2 info stack and session binding`
  - info item, inbox, grant, notification, read receipt;
  - session pack lookup and session-run creation;
  - pointer-only communication policy.
- `workflow v2 worker spawn and lifecycle gates`
  - backend preflight;
  - worker spawn delegation contract;
  - 64k context hard gate;
  - lifecycle preview, handoff recommendation, retry/lease facts.
- `workflow v2 control loop and adapter job manifest`
  - local deterministic worker;
  - adapter job manifest creation;
  - adapter job claim/heartbeat/release/fail;
  - runner capacity and retry behavior.
- `workflow v2 review chain`
  - manager review authority;
  - owner review authority;
  - optional task group package;
  - no `blocked` review decision for manager/owner.
- `workflow v2 governance and human gate bridge`
  - Cat Brain governance audit;
  - Cat Claw protocol audit;
  - Human Gate package option policy;
  - Human Gate request bridge creates/reuses the formal request and outbox.

Acceptance criteria:

- each slice can be run with `--grep`; landed.
- each slice emits a clear pass/fail result within a reasonable local timeout;
  landed for the initial focused set.
- the previous long regression is either removed, reduced to a shallow smoke, or
  marked as a deliberately long integration test; landed by removing it from the
  active test list and retaining the old function as a temporary legacy
  reference.
- `docs/workflow-v2-implementation-status.md` records the new test names and the
  last focused verification commands; landed.

## Track V2.2: Mechanical V2 Module Split

Status: constants/helpers, v2 registry, plan pure-helper, plan-state helper,
session-state helper, review-state helper, info-stack state/preview, Human Gate
state helper, backend-preflight preview, autonomous-loop runtime helper, and
worker-state helper splits have landed;
deeper DB/action module split
remains in progress. A
2026-07-05 Anthropic reference refresh also expanded `src/workflow-v2/plan.js` with
plan-node advisory helpers for manager-worker, parallel section,
evaluator-optimizer, and autonomous-loop structure. The same checks now act as
executable hard gates for non-draft plan admission and worker dispatch while
remaining advisory during draft preview. Runtime enforcement for
autonomous-loop iteration caps, tool/environment feedback checkpoints, and
explicit stop-condition terminalization now lives in
`src/workflow-v2/autonomous-loop.js` and is injected into the existing worker
spawn/control-loop/result paths. Evaluator-optimizer contract hardening also
landed on 2026-07-05 through the existing plan node, manager review, owner
review, and validator paths: producer output, evaluator input, rubric/schema,
review artifact, and accepted/rejected/needs_revision state are now structured
before owner acceptance can consume evaluator output. Fixed-template live-plan
admission also landed: non-draft live, production, trading, or high-risk plans
must bind an active/default/frozen workflow template registry version, while
draft ad-hoc plans remain available for refinement. Worker run, lease, result
lookup, lifecycle actor, and handoff state helpers now live in
`src/workflow-v2/worker-state.js` and are imported directly by the worker
lifecycle, worker result, adapter runner, control-loop, and review action
modules. Adapter job lookup and terminal CAS updates now live in
`src/workflow-v2/adapter-job-state.js` and are shared by adapter-runner and
worker-result action paths. Workflow v2 console read-model/UI visibility landed
on 2026-07-12 via the dedicated V2 child payload, V2 tab, command-palette
routes, and source-ref drilldowns. `workflow.v2.worker_spawn.create` now commits
the session run, workflow agent run, backend preflight record, and worker run in
one SQLite transaction instead of relying on post-failure compensation cleanup.
Adapter manifest artifacts now carry an explicit runner contract version and
`workflow.v2.validate` checks manifest content against adapter job, worker,
session, preflight, task input, output action, context, and no-direct-DB/no-secret
constraints. Persisted plan row loading, plan workflow-state patching, and
orchestration-pattern lookup now live in `src/workflow-v2/plan-state.js` while
shared workflow agent-run phase lookup, upsert SQL builder, and async upsert
helpers now live in
`src/workflow/agent-run-state.js` for the session action and v2 session-state
paths, with v2 worker spawn transactions reusing the same SQL builder instead
of carrying a duplicate upsert statement. The existing review/Human Gate
injection seam remains unchanged. Session-run
restore, patch/require patch, and retry-delay helpers now live in
`src/workflow-v2/session-state.js`, with workflow-agent-run sync dependencies
still injected from the existing workflow control-plane layer. Manager-review
rollback restore now lives in `src/workflow-v2/review-state.js` while the review
action injection seam remains unchanged. Remaining work in this track is real
runtime-wrapper integration and any further no-behavior-change helper splits
that reduce `src/workflow.js` coupling. Info-stack item lookup and cleanup
cascade helpers now live in `src/workflow-v2/info-stack-state.js`, while the
worker lifecycle, control loop, worker result, and adapter runner action modules
continue to receive them through the existing context injection seam.

After the focused tests pass, split the v2 implementation out of
`src/workflow.js` with no intended behavior change.

Proposed module layout:

- `src/workflow-v2/common.js`
  - JSON normalization helpers;
  - enum normalization;
  - validation/advisory helpers;
  - shared id/list helpers.
- `src/workflow-v2/plan.js`
  - plan preview/create;
  - plan spec artifact generation;
  - plan orchestration advisory contract.
- `src/workflow-v2/info-stack.js`
  - info item preview/record/read;
  - access grant and read receipt record;
  - notification preview/record coupling.
- `src/workflow-v2/backend-preflight.js`
  - worker backend preflight preview;
  - preflight persistence remains in `src/workflow.js` until the DB/action write
    split.
- `src/workflow-v2/worker.js`
  - worker spawn;
  - worker lifecycle preview;
  - handoff, retire, successor;
  - worker result submit/fail.
- `src/workflow-v2/control-loop.js`
  - local control loop preview/tick;
  - lease expiry, claim, retry, deterministic local execution.
- `src/workflow-v2/adapter-jobs.js`
  - adapter job manifest;
  - job record/list/claim/heartbeat/release/fail;
  - adapter runner preview/drain.
- `src/workflow-v2/review-chain.js`
  - manager review;
  - owner review;
  - task group package;
  - Cat Brain audit;
  - Cat Claw audit.
- `src/workflow-v2/human-gate.js`
  - v2 Human Gate package preview/record;
  - Human Gate request preview/write bridge.
- `src/workflow-v2/validate.js`
  - v2 schema snapshot;
  - hard checks;
  - advisory checks.
- `src/workflow-v2/index.js`
  - public exports for all v2 actions.

Rules:

- preserve exported function names where existing tests import or call them;
- avoid schema changes;
- avoid behavior changes;
- move one module group at a time;
- run the corresponding focused tests after each move;
- use an independent subagent review before considering the split complete.

Acceptance criteria:

- `src/workflow.js` no longer owns v2 constants, shared helper/summary details,
  the v2 registry map, plan/delegation pure helpers, info-stack preview bodies,
  worker backend preflight preview body, or autonomous-loop runtime helper body;
  deeper DB/action modules remain future mechanical splits;
- v2 exports continue to work through existing action names;
- focused v2 tests pass after every module group;
- `node --check` passes for all touched modules.

## Track V2.3: V2 Action Registry

Status: landed locally on 2026-07-05.

After the module split, replace the large v2 case block in `runWorkflowAction`
with a registry owned by `src/workflow-v2/index.js`.

Design target:

```js
const result = await runWorkflowV2Action(rootDir, input, permissionDecision);
if (result.handled) return result.value;
```

The registry should map canonical action names to handlers. This is a routing
cleanup only; it should not change permission semantics or write behavior.

Local landed shape: `WORKFLOW_V2_ACTION_REGISTRY` now owns canonical
`workflow.v2.*` handler dispatch and the old v2 case block has been removed
from `runWorkflowAction`. The action-to-handler map and v2 dispatch helper now
live in `src/workflow-v2/index.js`; `src/workflow.js` still injects the concrete
handlers until the remaining DB/action modules are split far enough to avoid
circular dependencies.

Acceptance criteria:

- unknown action behavior remains unchanged;
- all v2 action names still resolve;
- console/action-gateway callers do not need to know module internals;
- validator and focused tests pass.

## Track V2.4: Runtime Adapter Work Resumes

Status: local external-command runner protocol landed on 2026-07-05; real
WSL/Docker execution remains a separate authorization gate.

Only after V2.1-V2.3 are green should the mainline return to real worker backend
implementation.

Candidate next runtime work:

- non-mock Hermers worker adapter drain from recorded manifests;
- Claude Code coding/test/quality worker image contract;
- worker backend smoke against `wsl-agents` under a separate authorization gate;
- provider concurrency policy tied to actual model/API limits, not only the
  v2 design target of 200 worker rows.

Acceptance criteria:

- every real adapter action writes durable artifact/receipt evidence;
- workers never write central workflow DB state directly;
- worker output returns through `workflow.v2.worker_result.*`;
- model fallback and OAuth failures fail closed according to preflight policy.

Local landed shape:

- `workflow.v2.adapter_runner.preview` reports `mode`, whether an external
  runner command is configured, and a redacted `runnerCommandConfig`
  diagnostic object with environment source, executable, argc, and config
  errors.
- `workflow.v2.adapter_runner.wrapper_contract.preview` reports the governed
  wrapper command contract for Hermers Docker and Claude Code worker backends,
  including env keys, execute-guard requirements, return path, and secret/OAuth
  injection policy without executing commands or emitting secret values.
- Production external runner drain validates the configured command before
  claiming work: non-guard scripts fail closed, `runnerCwd` from caller input is
  ignored, and subprocess cwd is fixed to the plugin repo root to avoid
  relative-path spoofing.
- `workflow.v2.adapter_runner.drain` supports the existing `mock` mode and a new
  `external_command` mode.
- `external_command` mode writes a bounded request JSON artifact for a wrapper
  command, expects a JSON output file or stdout JSON, writes a normalized
  external output artifact, and returns success/fail/release through the
  governed adapter/worker result actions.
- The command must be supplied through backend-specific environment variables
  such as `TRADING_AGENTS_WORKFLOW_V2_HERMERS_DOCKER_WORKER_RUNNER_CMD` or
  `TRADING_AGENTS_WORKFLOW_V2_CLAUDE_CODE_DOCKER_WORKER_RUNNER_CMD`, or through
  the generic `TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD`.
- Action payload fields such as `runnerCommand` / `externalRunnerCommand` are
  rejected to avoid caller-selected host command execution.
- Commands are executed with `execFile`, not shell interpolation; string
  commands with spaces are rejected unless provided as a JSON array in the
  configured environment variable, and malformed or empty JSON arrays fail
  closed as invalid configuration without echoing the raw env value.
- `workflow.v2.validate` now audits recorded adapter manifest artifacts by
  enforcing local `artifact://workflow-v2/...` path containment, parsing JSON,
  recomputing the stored `sha256:` manifest hash, and comparing manifest
  contract fields to adapter job, worker, session, preflight, task input,
  output, context, and safety constraints.
- `workflow.v2.adapter_runner.drain` reuses the same manifest contract rules
  before consuming a claimed job manifest, so a hash-valid but contract-invalid
  artifact fails through the governed adapter-job/worker failure path before
  mock or external runner execution. Runtime manifest reads also enforce
  realpath boundary and regular-file checks, and validation reports
  `manifest_hash_missing` instead of skipping artifact rows with empty hashes.
- No WSL/Docker container is started by this local slice.

## Track V2.5: Workflow Self-Evolution

Status: design package drafted and local implementation slice landed on
2026-07-05. No development-server active checkout sync, Gateway restart, or
automatic live template selection has been performed.

The self-evolution layer should turn successful `workflow_plan_spec.v2` runs
into governed reusable templates, evaluate template versions, and promote or
roll back defaults without creating a second workflow engine.

Design package:

- `skills/workflow-self-evolution/SKILL.md`
- `docs/workflow-v2-self-evolution-skill.md`
- `docs/workflow-v2-self-evolution-implementation-plan.md`

Local landed shape:

- templates are governed JSON artifacts, not arbitrary JavaScript scripts;
- template registry DB rows index artifact refs, versions, permissions, evals,
  scores, and promotion state;
- template instantiation must pass through `workflow.v2.plan.preview/create`;
- existing worker lifecycle, autonomous-loop, evaluator, owner review, Cat
  Brain, Cat Claw, Human Gate, and side-effect gates remain authoritative;
- reward scores guide promotion but cannot override policy or Human Gate.
- canonical template artifacts live under
  `artifacts/workflow-v2/templates/<templateId>/v<version>.json`;
- actions are exposed under `workflow.template.*` for preview, candidate
  recording, search/get, instantiation, eval, stats refresh, promotion,
  rollback, and extraction;
- console API and local Codex MCP expose read-only template search/detail/stats;
- extraction starts as `candidate` and refuses unresolved side-effect
  uncertainty;
- high-risk default promotion requires Human Gate evidence.

Remaining work:

- sync only through Git/GitHub and `git pull --ff-only` after local review;
- do not enable automatic default template selection for live workflows until
  separate rollout evidence and Human Gate approval exist.

## Documentation Rules

Every slice should update the docs in the same patch set as the code/test
change:

- update this plan when scope/order changes;
- update `docs/workflow-v2-implementation-status.md` with landed behavior and
  verification results;
- update `docs/workflow-v2-orchestration-kernel.md` only when the design
  contract changes, not for every mechanical move;
- keep `docs/workflow-v2-p1-readiness-plan.md` as historical P1 material.

## Review Rules

- Test split and module split are medium-risk engineering changes because they
  affect verification and action routing.
- Each medium-risk slice needs independent subagent review.
- Review output must state files inspected, commands run, findings, and residual
  risk.
- The long integration regression being slow is not itself a pass/fail signal;
  focused test evidence is the acceptance basis.
