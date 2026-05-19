# Agent Registry Routing Contract

- recorded_at: 2026-05-19T13:31:00Z
- scope: `trading-agents-workflow` registry, route-shell forwarding, workflow dispatch
- decision_owner: Flashcat

## Decision

Agent identity, execution platform, IM ingress, and workflow ingress must be registered explicitly. `agent_id` is identity only and must not be treated as proof of execution location.

Hermers is the platform. ACP is an adapter/mechanism used by a Hermers agent instance to receive workflow dispatch and Gateway-forwarded information. The plugin must not model ACP as a separate platform.

OpenClaw Gateway may be:

- the IM ingress and execution platform for OpenClaw-local agents
- the IM ingress and route-shell audit anchor for agents executing elsewhere
- unrelated to IM ingress for external-platform agents that still participate through `trading-agents-workflow`

## Implementation Notes

The registry fields are:

- `platform`
- `execution_adapter`
- `im_ingress_owner`
- `im_ingress_adapter`
- `workflow_ingress_adapter`
- `can_receive_dispatch`
- `can_start_workflow`
- `gateway_proxy_allowed`

Route-shell forwarding now resolves targets through these fields before creating a dispatch. Generic `meeting.dispatch` also resolves `agent_id` through the registry when no explicit platform is provided.

## Verification

Local smoke root: `/private/tmp/taw-agent-registry-routing-smoke-20260519`

- registered `cat_body` as `platform=hermers`, `execution_adapter=acp`, `im_ingress_owner=openclaw_gateway`, `im_ingress_adapter=openclaw_route_shell`, `workflow_ingress_adapter=acp`
- `route-shell-ingest` queued dispatch to `target_platform=hermers` via `workflow_ingress_adapter=acp`
- `meeting-dispatch` without runtime resolved `cat_body` through the registry and queued to `runtime=hermers`
- unregistered `cat_nobody` failed closed with `active dispatch-capable registry row not found`
