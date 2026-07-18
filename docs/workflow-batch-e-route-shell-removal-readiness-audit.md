# Workflow Batch E Route Shell Source-Freeze Readiness Audit

Date: 2026-07-18

Scope: `route_shell.ingest`, `route-shell.ingest`, `route_shell.route`, `openclaw_route_shell` runtime rows, Gateway `before_dispatch` route-shell auto-forward hook, CLI route-shell command, runtime bridge route-shell repair branch, and v2 worker backend exclusion.

Status: audit only. This document does not authorize deleting code or changing runtime behavior.

## Executive Conclusion

Route shell is removal-oriented, but not deletion-ready and not safe to remove in this batch.

Batch C established that `route_shell.*` has no migration value as a v2 execution path. Batch E confirms only one narrow fact: live development-server state is clean enough to prepare a source-freeze batch. It does not certify source deletion readiness.

Live development-server facts:

- live `runtime_agents` only has six `openclaw_route_shell` rows for migrated Hermers agents, all `dormant`;
- those rows have `im_ingress_adapter=disabled`, `workflow_ingress_adapter=none`, and `can_receive_dispatch=0`;
- live `mixed_meeting_dispatches` has no `runtime=openclaw_route_shell` rows;
- live `message_flows` has no `route_runtime=openclaw_route_shell` rows;
- active OpenClaw plugin registry reports no loaded hook for `trading-agents-workflow`;
- OpenClaw Gateway service environment does not enable `TRADING_AGENTS_WORKFLOW_ROUTE_SHELL` or `TRADING_AGENTS_WORKFLOW_ROUTE_SHELL_AUTO`.

However, source-level compatibility entrypoints still exist and can still become active if config/env or old callers use them:

- CLI `route-shell-ingest` still calls `route_shell.ingest`;
- plugin config schema still exposes `routeShell`;
- optional Gateway `before_dispatch` route-shell auto-forward hook still exists in source and can call `route_shell.ingest` when enabled;
- action registry still exposes `route_shell.ingest`, `route-shell.ingest`, and `route_shell.route`;
- `meeting.dispatch runtime=openclaw_route_shell` compatibility still redirects through route-shell ingest;
- `runtime.bridge.drain runtime=openclaw_route_shell` still contains repair/fail-closed behavior;
- regression tests still assert archive compatibility and fail-closed route-shell behavior.

Therefore the next safe action is not deletion. The next safe action is a separate behavior-changing source-freeze batch that disables or removes external route-shell entrypoints first, while preserving evidence that v2 and live runtime do not depend on them.

## Live Development-Server Evidence

Checked active checkout:

```text
eaa54705aafd01d60f829434d1cea41bbc264539
```

Checked state root:

```text
/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db
```

Live route-shell registry rows:

```text
openclaw_route_shell | openclaw | cat_body    | dormant | route_shell | disabled | none | 0
openclaw_route_shell | openclaw | cat_ears    | dormant | route_shell | disabled | none | 0
openclaw_route_shell | openclaw | cat_eyes    | dormant | route_shell | disabled | none | 0
openclaw_route_shell | openclaw | cat_heart   | dormant | route_shell | disabled | none | 0
openclaw_route_shell | openclaw | cat_nose    | dormant | route_shell | disabled | none | 0
openclaw_route_shell | openclaw | cat_penclaw | dormant | route_shell | disabled | none | 0
```

Live queue and flow checks:

```text
mixed_meeting_dispatches runtime=openclaw_route_shell: none
message_flows route_runtime=openclaw_route_shell: none
```

Live plugin/hook checks:

```text
trading-agents-workflow plugin status: loaded
hookCount: 0
hookNames: []
config routeShell refs in OpenClaw runtime config: none observed
Gateway service env TRADING_AGENTS_WORKFLOW_ROUTE_SHELL*: none observed
```

Interpretation:

- route shell is not an active runtime path on the development server;
- no live queued work requires route-shell repair before source freeze;
- live state supports closing external entrypoints, but does not prove source deletion is safe without caller/test updates.

## Source Blocking Evidence

| Caller / Surface | Evidence | Current Role | Removal Readiness |
| --- | --- | --- | --- |
| CLI usage text | `bin/cat-meeting-governance.mjs` still documents `route-shell-ingest`. | Operator compatibility command. | Remove or hide in source-freeze batch. |
| CLI command | `index.js` still registers `route-shell-ingest` and calls `route_shell.ingest`. | External mutating entrypoint. | Must be closed before deleting action registry. |
| OpenClaw action contracts | `index.js` exports `route_shell.ingest`, `route-shell.ingest`, and `route_shell.route` action names. | External action exposure. | Convert to unknown-action or archive-read-only behavior in source-freeze batch. |
| Plugin config schema | `index.js` exposes `routeShell` schema. | Optional old Gateway route-shell hook configuration. | Remove or hard-disable before any source deletion. |
| Gateway hook source | `registerRouteShellBeforeDispatch` exists and can call `route_shell.ingest` if enabled by config/env. | Optional pre-agent forwarding hook. | Disable/remove after proving live config does not enable it. |
| Route-shell action module | `route-shell-actions.js` creates message-flow evidence and dispatch redirect. | Archive compatibility and fail-closed evidence. | Remove after external CLI/action/hook callers are closed and old queue is empty. |
| `meeting.dispatch` compatibility | `meetingDispatch` redirects `runtime=openclaw_route_shell` into route-shell ingest. | Deprecated compatibility input. | Replace with fail-closed unsupported runtime once no caller remains. |
| `runtime.bridge.drain` route-shell branch | `runtime-bridge-actions.js` still handles `runtime=openclaw_route_shell`. | Old queued-row fail-closed repair. | Remove after live queue remains empty and regression proves unsupported runtime fails closed. |
| Tests | `scripts/workflow_regression_tests.mjs` still asserts archive compatibility. | Guard against accidental active execution and evidence loss. | Split into retirement tests: unknown-action/fail-closed/no-v2-dependency. |
| v2 backend gate | `WORKFLOW_V2_DISALLOWED_WORKER_BACKENDS` includes `openclaw_route_shell`. | Active safety gate. | Keep permanently. |

## Removal Readiness Classification

| Condition | Status | Evidence |
| --- | --- | --- |
| No v2 dependency | Pass | v2 worker backend disallows `openclaw_route_shell`; no v2 source should call route-shell actions. |
| No active live route-shell runtime row | Pass | live rows are dormant, disabled, non-dispatchable. |
| No queued live route-shell dispatch | Pass | no `mixed_meeting_dispatches.runtime='openclaw_route_shell'` rows observed. |
| No live route-shell message flow | Pass | no `message_flows.route_runtime='openclaw_route_shell'` rows observed. |
| No live Gateway hook enabled | Pass | plugin registry `hookCount=0`, no route-shell env/config observed. |
| No source external caller | Fail | CLI, action contracts, config schema, optional hook, meeting-dispatch redirect, and runtime-bridge branch still exist. |
| Removal regression ready | Fail | current tests still assert archive compatibility, not final unknown-action behavior. |

## Required Source-Freeze Sequence

1. Remove or hide CLI `route-shell-ingest` usage and command, or convert it to an explicit unsupported/retired diagnostic that never mutates state.
2. Remove `route_shell.ingest`, `route-shell.ingest`, and `route_shell.route` from public plugin action contracts and action policy.
3. Remove `routeShell` plugin config schema and `registerRouteShellBeforeDispatch`, or force it to return pass-through/retired diagnostics without calling `route_shell.ingest`.
4. Change `meeting.dispatch runtime=openclaw_route_shell` from redirect to explicit fail-closed unsupported runtime.
5. Change `runtime.bridge.drain runtime=openclaw_route_shell` from repair branch to no-op/unsupported runtime once live queue remains empty.
6. Keep v2 worker backend rejection for `openclaw_route_shell`.
7. Replace current archive compatibility regression with retirement regressions:
   - route-shell actions are unknown or retired;
   - CLI no longer exposes a mutating route-shell ingest path;
   - meeting dispatch with `runtime=openclaw_route_shell` fails closed and creates no executable dispatch;
   - runtime bridge no longer creates replacement Hermers dispatch for route-shell rows;
   - v2 backend preflight still rejects `openclaw_route_shell`;
   - message-flow normal send/receipt paths still pass.
8. Run a live preflight before source freeze:
   - route-shell live registry rows still dormant/non-dispatchable;
   - no queued/running route-shell dispatch rows;
   - no route-shell message-flow rows needing reconciliation;
   - plugin registry still reports no active route-shell hook.

## Freeze Table Decision

Batch E moves `route_shell.*` from “deprecated archive, keep until removal batch” to “live clean, source-freeze required.”

This is a narrower and more accurate state:

- live runtime no longer blocks removal;
- v2 does not need route shell;
- source compatibility entrypoints are still active in code and block direct deletion;
- the next batch must be a behavior-changing source-freeze patch, with tests and independent review;
- only after source-freeze, updated retirement regressions, and another live preflight can actual route-shell deletion be considered.

## Quality Gate for Source-Freeze Batch

Before closing route-shell source entrypoints, run:

- targeted route-shell retirement regression;
- `npm run check:freeze`;
- `git diff --check`;
- `npm run check`;
- `npm run smoke:release`;
- sensitive scan over changed files and smoke artifacts;
- independent subagent review of the route-shell source-freeze diff;
- dev-server fast-forward deploy;
- server `npm run smoke:release`;
- server route-shell live preflight and OpenClaw plugin registry refresh;
- `main` workspace invariant check.

Any failure means route-shell remains archive-only compatibility and deletion is premature.
