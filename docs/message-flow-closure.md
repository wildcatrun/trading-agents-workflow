# Message Flow Closure Contract

This document records the governed closure rules for `message_flow` dispatch,
runtime receipts, local Codex inbox delivery, return policies, and the 30s
control-loop drain path.

## Purpose

`message_flow` is the durable cat-system delivery layer for agent-to-agent,
agent-to-Codex, route-shell, and governed notification traffic. It is not a
free-form relay and it is not a parallel scheduler. Every target is resolved
through `runtime_agents`, then dispatched through the registered runtime adapter
with trace ids, idempotency keys, timestamps, receipts, and optional delivery
evidence.

The closure contract separates three different facts:

- runtime dispatch completed;
- a target inbox or agent runtime accepted the message;
- after an immediate ACK, the semantic task was actually dispatched and
  completed;
- a human-visible delivery, such as Telegram, was sent and acknowledged.

Do not collapse those facts into one boolean. A dispatch ack is only runtime
evidence. A human-visible report is complete only when the selected return
policy requires delivery and the delivery receipt exists.

## Lifecycle

`workflow.message_flow.send` / `workflow_message_flow_send` creates one
`message_flows` row and one queued dispatch per target. The normal lifecycle is:

```text
route_registered
  -> runtime_dispatched
  -> runtime_completed | runtime_failed
  -> outbound_queued
  -> telegram_sent | telegram_failed
```

When `requiresAck=true`, ACK is an explicit first-turn receipt stage inside the
same flow, not a replacement for the flow:

```text
route_registered
  -> runtime_dispatched
  -> runtime_acknowledged
  -> semantic_dispatched
  -> runtime_completed | runtime_failed
  -> outbound_queued
  -> telegram_sent | telegram_failed
```

The ACK turn must return `ACK_RECEIVED` within 30s. It only proves complete
message receipt and must not set `final_output_present=1` or create the final
human-visible outbox. After ACK, workflow queues one idempotent
`message_flow_semantic` dispatch on the same `flow_id`; that continuation
removes the ACK prompt and carries the original semantic task to completion.

Not every flow needs every step. `return_policy=silent` stops at runtime
closure. `local_codex` stops at local inbox receipt. A human-facing report or
reply continues to outbox delivery.

Core evidence surfaces:

- `message_flows`: stable flow status, target, source, return path, and receipt
  summary.
- `mixed_meeting_dispatches`: runtime dispatch queue and attempt state.
- `runtime_runs`: runtime adapter execution evidence.
- `message_flow_events`: lifecycle events, incidents, and reconciliation notes.
- `telegram_outbox`: human-visible delivery attempts and receipts.
- `incident_states`: stuck or failed closure records.

## Return Policies

`return_policy` defines the closure expectation after runtime execution:

- `silent`: runtime receipt is enough. The flow must not create a stuck
  "missing Telegram receipt" incident merely because no human-visible outbox was
  created.
- `reply_to_source_chat`: runtime output must be delivered back to the original
  source channel. Missing source channel, account, chat, sender, source message
  id, or delivery receipt is a closure gap.
- `report_to_flashcat`: runtime output must be delivered to Flashcat through the
  governed reporting channel. Missing delivery receipt is a closure gap.

Dry-run and reconciliation tools must use the same policy rules as the control
loop. A flow that is correctly complete under `return_policy=silent` must not
appear as a reconcile candidate only because it has no Telegram delivery
receipt.

## Local Codex Inbox

`local_codex` / `codex` is a valid workflow dispatch target when resolved
through `runtime_agents` as the local Codex inbox target. This replaces the
previous control-panel-only limitation.

The local Codex path has these constraints:

- It is a governed inbox delivery endpoint, not an autonomous cat-system member
  runtime.
- It may receive structured handoff, status, review, or evidence messages from
  cat-system agents through `message_flow`.
- It records a `local_codex_inbox_received` receipt and a
  `message_flow_events` entry, then acknowledges the dispatch and marks the
  flow `runtime_completed`.
- It does not imply that local Codex has produced semantic output, approved a
  Human Gate, or delivered a report to Flashcat.
- It must not be used to bypass Telegram, WeCom, OpenClaw IM, Cat Claw, Human
  Gate, or receipt/artifact requirements for formal user-facing reports.

For a local Codex inbox flow, `final_output_present` can remain false while the
runtime/inbox receipt is still valid. This means the flow is closed as delivery
to the local inbox, not as a completed downstream task.

## Control Loop Drain

The 30s control loop is a mechanical reconciler. It should make bounded progress
on queue and receipt state without doing semantic judging, trading decisions, or
Human Gate decisions.

Each tick seeds durable `control_loop_jobs` for configured runtime drains, stale
dispatch reconciliation, stuck message-flow reconciliation, Human Gate
maintenance, Telegram outbox delivery, and other mechanical work.

Runtime drain has two paths:

- configured runtimes get generic `runtime_drain:<runtime>` jobs;
- queued `message_flow` dispatches for runtimes not listed in
  `controlLoop.runtimes` get exact `runtime_drain:<runtime>:<dispatch_id>` jobs
  with `payload.dispatchId`.

The exact-drain scan excludes configured runtimes before applying its row limit.
This prevents a busy configured runtime from starving unconfigured targets such
as `openclaw` or `local_codex` when the main loop is configured only for
`hermers`.

## Incident Rules

Stuck-message-flow incidents are for flows whose policy requires a human-visible
delivery but the delivery evidence is missing after runtime completion and the
configured stuck window.

Do not create a stuck delivery incident for:

- `return_policy=silent` flows with valid runtime closure;
- local Codex inbox delivery that has a `local_codex_inbox_received` receipt;
- route-shell dispatch acks that were redirected and closed with explicit audit
  evidence.

Do create an incident when:

- runtime output exists but `reply_to_source_chat` has no delivery receipt after
  the stuck window;
- `report_to_flashcat` has no valid outbox target or delivery receipt;
- a dispatch reaches terminal runtime failure and no retry remains;
- stale dispatch reconciliation cannot prove a terminal runtime receipt.

## Verification

Before changing this closure contract, run at least:

```bash
npm run check
npm run test:regression
git diff --check
```

Relevant regression coverage should include:

- message-flow runtime bridge closure;
- local Codex inbox dispatch closure;
- `return_policy=silent` dry-run/reconcile behavior;
- control-loop exact runtime drains for targets outside `controlLoop.runtimes`;
- delivery-required flows still producing incidents when Telegram evidence is
  missing.

When deploying to the development server, update the active checkout through the
GitHub-managed path and record the target commit. A Gateway reload or restart is
a separate high-impact operation and is not implied by a documentation or code
checkout update.
