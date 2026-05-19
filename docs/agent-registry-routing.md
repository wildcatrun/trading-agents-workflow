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
- `can_receive_dispatch`: whether workflow dispatch may target this instance.
- `can_start_workflow`: whether this instance may create workflow records.
- `gateway_proxy_allowed`: whether OpenClaw Gateway may proxy messages for this instance.
- `endpoint_ref`: adapter-specific endpoint reference, such as a Hermers profile reference.

Hermers is the platform. ACP is an adapter/mechanism used by Hermers instances to receive workflow dispatches and Gateway-forwarded information. `hermers + acp` is valid; `hermers_acp` is not a platform.

## Ingress Classes

Class A: IM ingress is OpenClaw Gateway and execution is OpenClaw.

The registry uses `platform=openclaw`, `execution_adapter=native`, `im_ingress_owner=openclaw_gateway`, `im_ingress_adapter=openclaw_native`, and `workflow_ingress_adapter=openclaw_native`.

Class B: IM ingress is OpenClaw Gateway and execution is not OpenClaw.

The registry uses the true platform, for example `platform=hermers`, with `im_ingress_owner=openclaw_gateway`, `im_ingress_adapter=openclaw_route_shell`, and the real workflow adapter, for example `workflow_ingress_adapter=acp`. The OpenClaw route shell is an ingress and audit anchor only; it is not an executor.

Class C: IM ingress and execution are outside OpenClaw Gateway.

The registry uses the external platform and its registered IM/workflow adapters. OpenClaw Gateway is not the IM owner for this instance. Other agents still exchange information with it through `trading-agents-workflow`, which resolves the target registry row and sends through the registered workflow ingress adapter.

## Routing Rules

All message and workflow entry points must resolve the target agent through the registry before dispatch:

- Gateway IM hooks route by `agent_id`, then require a registered Gateway ingress row and a dispatch-capable target row.
- Workflow dispatch and scripted dispatch route by the registered `platform` and `workflow_ingress_adapter`.
- OpenClaw route-shell rows may acknowledge route status or route failure, but must not run professional work.
- Missing registry rows, missing workflow ingress adapters, disabled instances, or policy blocks fail closed.
- External IM ownership is not a failure condition. A class C agent is reachable through its registered workflow adapter even though its IM ingress is outside OpenClaw Gateway.
- Agent migration is a registry update, not a rewrite of Telegram hooks, cron jobs, or workflow dispatch logic.

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
