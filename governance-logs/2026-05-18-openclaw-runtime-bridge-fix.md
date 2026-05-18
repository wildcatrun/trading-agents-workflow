# 2026-05-18 OpenClaw Runtime Bridge Fix

- timestamp: 2026-05-18T10:50:00+08:00
- affected_workflow: hermes-cron-migration-20260518
- affected_dispatch: dispatch.mpaj3vmn.9b9127ab
- affected_runtime: openclaw
- affected_agent: main

## Problem

`meeting.dispatch` could create `runtime=openclaw` dispatches, but `runtime.bridge.drain` only implemented `hermes` and `hermes_acp` execution adapters.

As a result, the Cat Brain governance dispatch for `hermes-cron-migration-20260518` stayed `queued` and eventually became stale. Cat Claw could report the stall, but the workflow layer itself had no durable execution path for OpenClaw runtime tasks.

## External Reference

Wanman's public documentation describes a supervisor-owned architecture: CLI calls speak JSON-RPC to a Supervisor, and the Supervisor owns the message store, context store, task pool, artifact store, and child agent lifecycle. It also models agent lifecycle explicitly as `24/7`, `on-demand`, or `idle_cached`.

The relevant lesson for `trading-agents-workflow` is that queued work must have an owned consumer and lifecycle transition. A dispatch cannot remain merely recorded; it must become `sent`, `acked`, `failed`, or explicitly delayed with retry metadata.

## Fix

Added an OpenClaw runtime bridge adapter:

- `runtime-bridge --runtime openclaw` now consumes queued OpenClaw dispatches.
- The adapter invokes `openclaw agent --agent <agent> --message <prompt> --json --timeout <seconds>`.
- Successful output is ingested into the meeting transcript and dispatch status becomes `acked`.
- Timeout or CLI failure records a `runtime_runs` failure and dispatch status becomes `failed` unless retry policy allows another attempt.
- CLI help now documents `--runtime openclaw|hermes|hermes_acp` and `--openclaw-bin`.

Additional CLI fallback:

- `hermes_acp` bridge first tries the OpenClaw ACP runtime SDK.
- If the SDK package is unavailable in a standalone CLI process, the bridge records `runtime_dispatch_fallback` and falls back to the Hermes CLI adapter instead of failing immediately with `acp_unavailable`.

## Verification

- `npm run check` passed locally.
- `runtime-bridge --runtime openclaw --dry-run --root ./.tmp-smoke` returned `count=0` on an empty smoke root.
- Development-server `runtime-bridge --runtime openclaw --dry-run` found the stale Cat Brain dispatch.
- Development-server `runtime-bridge --runtime openclaw --limit 1 --timeout-seconds 120` consumed it and recorded `failed/runtime_timeout` instead of leaving it stale queued.

## Remaining Work

- Investigate why Cat Brain `main` did not finish the governance task within the bounded OpenClaw bridge timeout.
- Consider a governed bridge drain timer after Human Gate if continuous dispatch consumption is desired.
