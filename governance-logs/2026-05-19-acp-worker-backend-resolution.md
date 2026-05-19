# ACP Worker Backend Resolution

- recorded_at: 2026-05-19T14:45:00Z
- scope: Hermers ACP workflow ingress
- decision_owner: Flashcat

## Problem

`runtime.bridge.drain` runs in a standalone worker process. That process is not the OpenClaw Gateway plugin loader, so `import("openclaw/plugin-sdk/acp-runtime-backend")` can fail even when OpenClaw is installed globally and the Gateway can load plugin SDK modules.

The development server has OpenClaw at `/usr/lib/node_modules/openclaw` and the ACPX runtime plugin at `/home/flashcat/.openclaw/npm/node_modules/@openclaw/acpx`. Node ESM bare specifier resolution does not automatically search the global OpenClaw package from the workflow worker.

## Implementation

- `workflow_ingress_adapter=acp` still fails closed on ACP backend unavailability.
- The worker now resolves `openclaw/plugin-sdk/acp-runtime-backend` through controlled package roots when normal Node resolution fails.
- If `backend=acpx` is not registered in the worker process, the worker starts the official `@openclaw/acpx` runtime service with workflow-owned state under `bridge/acpx-runtime`.
- Runtime run records include `backendSource` so smoke tests can distinguish true ACP backend usage from unavailable backend failures.
- The Hermers CLI remains a separate explicit `workflow_ingress_adapter=cli` path and is not used as ACP fallback.

## Verification

Local smoke root:

- `/private/tmp/taw-acp-resolver-local-smoke-20260519`

Result:

- Local machine without `@openclaw/acpx` produced `adapter=acp`, `backend=acpx`, `status=failed`, `failure_type=acp_unavailable`.

Development server temporary backend registration check:

- Importing the ACP backend module through `/home/flashcat/.openclaw/npm/node_modules/@openclaw/acpx/package.json` succeeded.
- Before starting the service, `getAcpRuntimeBackend("acpx")` was absent.
- After starting the official `@openclaw/acpx` runtime service with a temporary state dir, `getAcpRuntimeBackend("acpx").runtime.ensureSession` existed.
