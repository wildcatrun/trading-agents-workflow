# ACP Fail-Closed Adapter Policy

- recorded_at: 2026-05-19T13:55:00Z
- scope: Hermers workflow ingress adapter behavior
- decision_owner: Flashcat

## Decision

`platform=hermers` and `workflow_ingress_adapter=acp` is the primary Hermers workflow ingress path. ACP is not a fallback for OpenClaw and the Hermers CLI is not an implicit fallback for ACP.

If the ACP backend is unavailable in the worker process, the dispatch must fail closed with `failure_type=acp_unavailable`. It must not silently execute through the Hermers CLI and then report that as ACP success.

The Hermers CLI path is a separate explicit adapter:

```text
platform=hermers
workflow_ingress_adapter=cli
```

That adapter is allowed only as reviewed fallback or recovery.

## Implementation

- `runHermesAcpDispatch` records ACP backend unavailability as `adapter=acp`, `failure_type=acp_unavailable`.
- Automatic `acp_cli_fallback` is removed.
- `runtimeBridgeDrain` runs the Hermers CLI only when the registered workflow ingress adapter is `cli`.

## Verification

Local smoke roots:

- `/private/tmp/taw-acp-fail-closed-smoke-20260519`
- `/private/tmp/taw-cli-explicit-adapter-smoke-20260519`

Results:

- `workflow_ingress_adapter=acp` with unavailable ACP backend produced `status=failed`, `adapter=acp`, `failure_type=acp_unavailable`.
- `workflow_ingress_adapter=cli` selected the CLI branch and recorded `adapter=cli`; local failure was expected because the local machine does not have the server Hermers binary path.
