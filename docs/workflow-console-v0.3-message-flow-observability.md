# Workflow Console v0.3 Message Flow Observability

Date: 2026-05-24

This record summarizes the v0.3 console work before commit, push, or
development-server rollout. The change is an observability update for the
current `message_flow` closure contract. It does not turn the console into a
scheduler, runtime platform, Human Gate submitter, deployment console, or
Gateway control surface.

## Purpose

The console needs to show whether a workflow message closed correctly without
forcing every successful flow to have a Telegram receipt.

The important distinction is:

- runtime dispatch completion proves that the runtime adapter accepted and
  completed the dispatch;
- local Codex inbox receipt proves that the local inbox accepted a governed
  handoff;
- Telegram or other human-visible delivery receipt proves that a report or
  reply reached the governed user-facing channel.

Those are separate facts. v0.3 exposes them separately in the console read
model and frontend.

## Scope

v0.3 adds these read-only surfaces:

- per-workflow `Message Flow` tab;
- `GET /api/workflows/:workflowId/message-flows`;
- `message_flow_events` entries in the workflow timeline;
- Operations `Message Flow` summary;
- Operations `Message Flow Attention` list for failed or delivery-missing
  flows;
- Operations `Runtime Drain Jobs` list, including exact dispatch drains.

The updated code paths are:

- `src/console/read-model.js`
  - `messageFlows(workflowId, query)`
  - message-flow events in `timeline(workflowId, query)`
  - `messageFlow`, `messageFlowAttention`, and `controlLoopJobDetails` in
    `operationsSummary(query)`
- `src/console/server.js`
  - `GET /api/workflows/:workflowId/message-flows`
- `static/console/index.html`
  - `Message Flow` tab
- `static/console/app.js`
  - status tones, message-flow rendering, closure text, and operations panels
- `docs/workflow-console.md`
  - endpoint and rollout-target notes

## Closure Semantics Shown By The Console

`return_policy=silent` closes on valid runtime closure. It should not be shown
as stuck merely because no Telegram outbox receipt exists.

`local_codex` and `codex` are valid governed inbox targets when resolved through
`runtime_agents`. The console shows `local_codex_inbox_received` as inbox
delivery evidence. This is not semantic output from Codex, not Flashcat
delivery, and not Human Gate approval.

`reply_to_source_chat` and `report_to_flashcat` are delivery-required policies.
They need human-visible delivery evidence after runtime completion. Missing
delivery evidence for those policies can appear in `Message Flow Attention`.

Terminal runtime failure is always attention-worthy. The attention query also
treats empty-string terminal timestamps as absent timestamps, because some
runtime records may store an empty string instead of SQL `NULL`.

## Runtime Drain Visibility

The 30s control loop can create two runtime-drain job shapes:

- generic drain: `runtime_drain:<runtime>`;
- exact drain: `runtime_drain:<runtime>:<dispatch_id>`.

v0.3 exposes these jobs in Operations with:

- `dedupeKey`;
- `drainKind`;
- `exactDispatchId`;
- redacted `payload` and `result`.

This is intended to make it visible when a dispatch for an unconfigured runtime,
such as `local_codex` or `openclaw`, was given an exact drain job instead of
being starved by the configured runtime list.

## Non-Goals

This round intentionally does not add:

- real write controls;
- Human Gate final submit UI;
- workflow pause, terminate, merge, or approval buttons;
- Gateway reload or restart controls;
- production deploy controls;
- live trading actions;
- any direct mutation of workflow business tables from the browser.

The console remains read-only / preview-only unless an operator explicitly
starts it with write support, and even then the allowed action list must remain
small and reviewed.

Read-only here describes the GET read-model surfaces. Preview actions are
dry-runs for workflow business state, but they still append console operation
audit records for traceability.

## Verification Evidence

Local verification performed for this round:

```bash
npm run check
npm run test:regression
git diff --check
```

Local console smoke was also run against a temporary workflow root:

```text
/private/tmp/taw-console-smoke-Fxmz6v
```

The smoke created workflow `console-smoke`, registered `local_codex:codex`,
sent a governed message flow, drained the runtime bridge, and checked the temp
console on `127.0.0.1:18792`.

Observed smoke evidence:

- `/api/workflows/console-smoke/message-flows` returned the flow and
  `local_codex_inbox_received` evidence;
- the flow used silent return behavior without requiring Telegram delivery;
- `/api/operations/summary` returned an exact runtime drain job with
  `dedupeKey=runtime_drain:local_codex:dispatch.mpjxs6il.4413e1dc`,
  `drainKind=exact`, and
  `exactDispatchId=dispatch.mpjxs6il.4413e1dc`;
- the static HTML exposed the `Message Flow` tab.

The temporary console process was stopped after smoke verification.

## Development-Server Rollout Notes

Commit and push this change first. The development server active plugin
checkout must then be updated through the GitHub-managed checkout path:

```text
/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout
```

The runtime state root remains:

```text
/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow
```

The console process, if started on the development server, should be a separate
read-only process:

```bash
node bin/workflow-console.mjs \
  --root /home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow \
  --host 127.0.0.1 \
  --port 8791
```

Local access should use the existing tunnel:

```text
http://127.0.0.1:18791
```

A Gateway reload or restart is not implied by this console documentation or
read-model update. If a future deployment requires Gateway action, treat that
as a separate high-impact operation with status check, rollback path, and
explicit approval.
