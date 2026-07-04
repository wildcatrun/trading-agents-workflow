# Workflow v2 Unified Next Plan

Status: proposed next development track
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

This plan does not authorize:

- production database migration;
- development-server checkout deployment;
- OpenClaw Gateway reload/restart;
- Docker creation/start on `wsl-agents`;
- Hermers, Claude Code, or model secret configuration changes;
- real worker runtime queue connection.

Those remain separate gates after the local validation and modularization track
is healthy.

## Track V2.1: Split Verification First

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

- each slice can be run with `--grep`;
- each slice emits a clear pass/fail result within a reasonable local timeout;
- the previous long regression is either removed, reduced to a shallow smoke, or
  marked as a deliberately long integration test;
- `docs/workflow-v2-implementation-status.md` records the new test names and the
  last focused verification commands.

## Track V2.2: Mechanical V2 Module Split

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
  - worker backend preflight and preflight persistence.
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

- `src/workflow.js` no longer owns v2 implementation details;
- v2 exports continue to work through existing action names;
- focused v2 tests pass after every module group;
- `node --check` passes for all touched modules.

## Track V2.3: V2 Action Registry

After the module split, replace the large v2 case block in `runWorkflowAction`
with a registry owned by `src/workflow-v2/index.js`.

Design target:

```js
const result = await runWorkflowV2Action(rootDir, input, permissionDecision);
if (result.handled) return result.value;
```

The registry should map canonical action names to handlers and keep aliases in
one place. This is a routing cleanup only; it should not change permission
semantics or write behavior.

Acceptance criteria:

- unknown action behavior remains unchanged;
- all v2 action names still resolve;
- console/action-gateway callers do not need to know module internals;
- validator and focused tests pass.

## Track V2.4: Runtime Adapter Work Resumes

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
