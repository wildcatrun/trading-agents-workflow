# Agent Registry And Routing Contract

This document is the cat-system routing contract for `trading-agents-workflow`.

## Source Of Truth

`runtime_agents` is the registry source of truth for agent identity, platform, execution adapter, IM ingress, workflow ingress, and routing policy. Agent ids are stable cat-system identities; they are not execution locations.

Every registered agent instance must declare these fields:

- `agent_id`: stable cat-system identity, for example `cat_body` or `main`.
- `platform`: where the agent instance actually runs, for example `openclaw`, `hermers`, or a registered external platform.
- `execution_adapter`: how the platform executes or addresses the instance, for example `native`, `acp`, `api`, `webhook`, `queue`, or `route_shell`.
- `im_ingress_owner`: who owns the human/IM entry point, for example `openclaw_gateway`, `external_platform`, or `none`.
- `im_ingress_adapter`: which IM ingress receives messages, for example `openclaw_native`, `openclaw_route_shell`, `platform_im`, or `custom`.
- `workflow_ingress_adapter`: how workflow dispatches reach the instance, for example `openclaw_native`, `acp`, `api`, `webhook`, `queue`, or `route_shell`.
- `im_identity`: the normalized IM identity layer, for example `openclaw_route_shell` or `openclaw_native`.
- `execution_identity`: the normalized execution layer, for example `hermers_acp`, `openclaw_native`, or `openclaw_route_shell`.
- `return_policy`: how a runtime result returns to a human-visible channel: `reply_to_source_chat`, `report_to_flashcat`, or `silent`.
- `can_receive_dispatch`: whether workflow dispatch may target this instance.
- `can_start_workflow`: whether this instance may create workflow records.
- `gateway_proxy_allowed`: whether OpenClaw Gateway may proxy messages for this instance.
- `endpoint_ref`: adapter-specific endpoint reference, such as a Hermers profile reference.

Hermers is the platform. ACP is an adapter/mechanism used by Hermers instances to receive workflow dispatches and Gateway-forwarded information. `hermers + acp` is valid; `hermers_acp` is not a platform.

`workflow_ingress_adapter=acp` must use the ACP backend. If the ACP backend is unavailable, dispatch fails closed with `failure_type=acp_unavailable`; it must not silently run the Hermers CLI path. The Hermers CLI path is a separate explicit adapter, `workflow_ingress_adapter=cli`, for reviewed fallback or recovery use only.

Cat Claw `cat_claw` is an OpenClaw-only secretary and Human Gate agent. Its valid registry row is `openclaw:cat_claw` with `platform=openclaw` and `workflow_ingress_adapter=openclaw_native`. It must not be registered as a Hermers ACP profile, route-shell executor, or generic external adapter unless a future migration explicitly creates and documents a real non-OpenClaw Cat Claw runtime.

## Snapshot Export

`runtime_agents` remains the live source of truth. The workflow action `workflow.runtime_agents` also writes an atomic read-only snapshot to `registry/runtime-agents.snapshot.json` under the workflow state root. This snapshot is a derived runtime artifact, not a second authority and not plugin source code.

Companion services such as `cat-agents-stabilityd` may use the snapshot only as a read-only fallback when the SQLite registry is temporarily unavailable. Scope decisions should still be expressed as registry-derived sets such as `derivedScopes.activeOpenClawAgentIds`; platform-local directories must not become the membership source.

## Ingress Classes

Class A: IM ingress is OpenClaw Gateway and execution is OpenClaw.

The registry uses `platform=openclaw`, `execution_adapter=native`, `im_ingress_owner=openclaw_gateway`, `im_ingress_adapter=openclaw_native`, and `workflow_ingress_adapter=openclaw_native`.

Class B: IM ingress is OpenClaw Gateway and execution is not OpenClaw.

The registry uses the true platform, for example `platform=hermers`, with `im_ingress_owner=openclaw_gateway`, `im_ingress_adapter=openclaw_route_shell`, `im_identity=openclaw_route_shell`, `workflow_ingress_adapter=acp`, `execution_identity=hermers_acp`, and `return_policy=reply_to_source_chat`. The OpenClaw route shell is an ingress and audit anchor only; it is not an executor.

Class C: IM ingress and execution are outside OpenClaw Gateway.

The registry uses the external platform and its registered IM/workflow adapters. OpenClaw Gateway is not the IM owner for this instance. Other agents still exchange information with it through `trading-agents-workflow`, which resolves the target registry row and sends through the registered workflow ingress adapter.

## Routing Rules

All message and workflow entry points must resolve the target agent through the registry before dispatch:

- Gateway IM hooks route by `agent_id`, then require a registered Gateway ingress row and a dispatch-capable target row.
- Workflow dispatch and scripted dispatch route by the registered `platform` and `workflow_ingress_adapter`.
- OpenClaw route-shell rows may acknowledge route status or route failure only as ingress metadata, and successful route-shell acknowledgement is not an agent reply.
- Missing registry rows, missing workflow ingress adapters, disabled instances, or policy blocks fail closed.
- ACP backend unavailability fails the ACP dispatch; CLI execution is not an implicit ACP fallback.
- External IM ownership is not a failure condition. A class C agent is reachable through its registered workflow adapter even though its IM ingress is outside OpenClaw Gateway.
- Agent migration is a registry update, not a rewrite of Telegram hooks, cron jobs, or workflow dispatch logic.

## Message Flow Contract

Non-OpenClaw agents are first-class cross-platform message participants. A message addressed through an OpenClaw route-shell must create one `message_flows` record and carry the return path through the whole turn.

Agent-originated internal notices must use `workflow.message_flow.send` when the sender needs governed delivery state. The sender provides `fromAgent`, `fromRuntime`, `targets`, message body, optional `sourceRefs`, and an idempotency key. The action resolves each target through `runtime_agents`, queues a dispatch, and creates one `message_flows` row per target. It does not directly mark the message as read, acknowledged, or delivered.

State machine:

```text
inbound_received -> route_registered -> runtime_dispatched -> runtime_completed/runtime_failed -> outbound_queued -> telegram_sent/telegram_failed
```

Some targets stop before the human-visible delivery states. `return_policy=silent`
closes on runtime receipt. `local_codex` / `codex` closes on a
`local_codex_inbox_received` receipt because the local Codex path is a governed
inbox target, not a Telegram delivery target.

Required return-path fields for `return_policy=reply_to_source_chat`:

- `source_channel`
- `account_id` (stored as `source_account_id`)
- `chat_id` (stored as `source_chat_id`)
- `sender_id`
- `source_message_id`
- `delivery_policy`

For non-OpenClaw agents, completion is not `dispatch.status=acked`. A user-visible reply is complete only when the selected return policy requires delivery and the flow has `final_output_present=1` plus `delivery_receipt_present=1`, normally with status `telegram_sent`. Empty output, interrupted output, cancelled ACP turns, missing return path, and Telegram delivery failure are flow failures even if the dispatch row was already acknowledged at the runtime layer. A `silent` flow with runtime closure and a local Codex inbox flow with `local_codex_inbox_received` are not user-visible replies and must not be reconciled as missing Telegram delivery.

The 10s control loop must reconcile stuck message flows. A delivery-required flow with runtime final output but no Telegram delivery receipt after the configured stuck window is not successful; it must create an incident and leave evidence in `message_flow_events`. The detailed closure contract is maintained in [message-flow-closure.md](message-flow-closure.md).

## Examples

OpenClaw local agent:

```text
agent_id=main
platform=openclaw
execution_adapter=native
im_ingress_owner=openclaw_gateway
im_ingress_adapter=openclaw_native
workflow_ingress_adapter=openclaw_native
```

Hermers agent reached through OpenClaw route-shell IM:

```text
agent_id=cat_body
platform=hermers
execution_adapter=acp
im_ingress_owner=openclaw_gateway
im_ingress_adapter=openclaw_route_shell
workflow_ingress_adapter=acp
im_identity=openclaw_route_shell
execution_identity=hermers_acp
return_policy=reply_to_source_chat
endpoint_ref=hermers-profile:catbody
```

External agent with independent IM:

```text
agent_id=external_researcher
platform=external_platform
execution_adapter=api
im_ingress_owner=external_platform
im_ingress_adapter=platform_im
workflow_ingress_adapter=api
endpoint_ref=https://example.invalid/agent/external_researcher
```

Local Codex inbox:

```text
agent_id=local_codex
platform=local_codex
execution_adapter=inbox
im_ingress_owner=none
im_ingress_adapter=none
workflow_ingress_adapter=local_codex_inbox
execution_identity=local_codex_inbox
return_policy=silent
```
