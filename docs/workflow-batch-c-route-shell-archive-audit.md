# Workflow Batch C Route Shell Archive Audit

Date: 2026-07-18

Scope: `route_shell.ingest`, `route-shell.ingest`, `route_shell.route`, `openclaw_route_shell` runtime handling, route-shell dispatch redirects, and v2 worker backend exclusion.

Status: audit only. This document does not authorize deleting code or changing runtime behavior.

## Executive Conclusion

`route_shell.*` has no migration value as a v2 execution path. It should not be moved into v2, renamed as a v2 module, or kept as a fallback executor for migrated Hermers agents.

The correct Batch C posture is:

- active execution through `openclaw_route_shell` is already forbidden by policy and registry semantics;
- v2 worker backends explicitly disallow `openclaw` and `openclaw_route_shell`;
- `route_shell.*` remains only as archive/compatibility code for historical Gateway ingress, route registration evidence, fail-closed acknowledgement, and tests proving that route-shell acknowledgement is not an agent reply;
- old queued `openclaw_route_shell` dispatches are expected to fail closed under current registry validation because route-shell-only rows are not dispatch-capable; they must not be silently treated as active executable work;
- removal is allowed only after a dedicated archive-removal batch proves no active route-shell hook, no active `runtime_agents` route-shell ingress rows, no queued `openclaw_route_shell` dispatches, and no operator/CLI/MCP callers still depend on route-shell diagnostics.

Development-server runtime state checked during this audit showed all `openclaw_route_shell` rows for migrated Hermers agents as `dormant`, with `im_ingress_adapter=disabled`, `workflow_ingress_adapter=none`, and `can_receive_dispatch=0`. That supports freezing route-shell as an active execution path, but it does not by itself justify deleting the archive/redirect code in this batch.

## Responsibility Decomposition

| Responsibility | Current Implementation | Replacement / Final State | Migration Class | Wrong-Freeze Failure |
| --- | --- | --- | --- | --- |
| Action registry | `route-shell-actions.js` registers `route_shell.ingest`, `route-shell.ingest`, and `route_shell.route`, all handled by `routeShellIngest`. | No v2 replacement. Future final state is unknown action or archive-only diagnostic, not migrated execution. | `archive_no_migration`. | Historical route-shell diagnostics or fail-closed evidence disappear before archive removal is proven safe. |
| Target resolution | `resolveRouteShellTarget` requires an active Gateway route-shell ingress row, excludes route-shell-only rows, and selects a dispatch-capable registered target. | Runtime registry + normal message-flow/runtime adapter routing. | `archive_compat_only`. | A route-shell-only row could be mistaken for a real executor, or missing target errors could lose evidence. |
| Fail-closed acknowledgement | Missing route-shell ingress or target returns `ROUTE_FAILED` with timestamp and reason instead of falling back to the OpenClaw route-shell agent. | Message-flow/runtime adapter failures should remain explicit and auditable. | `must_preserve_until_removal`. | Gateway or CLI callers could treat a missing route as successful delivery. |
| Message-flow evidence | Successful route-shell ingest creates a `message_flows` row, records `route_runtime=openclaw_route_shell`, and binds the eventual target runtime/agent. | Governed `message_flow.send` and runtime adapter receipt. | `replace_with_message_flow`. | Route-shell acknowledgement could be confused with final semantic reply or Human Gate completion. |
| Historical ingress record | Route-shell ingest can write `mixed_meeting_messages` with `message_type=route_shell_ingress` and `phase=route_shell`. | Archive evidence only. | `archive_evidence`. | Old Telegram/Gateway ingress evidence becomes untraceable during incident reconstruction. |
| Dispatch redirect creation | Route-shell ingest calls `meetingDispatch` to create a dispatch to the registered target platform, normally Hermers ACP, not to `openclaw_route_shell`. | Direct dispatch to the real runtime adapter. | `replace_with_runtime_adapter`. | Migrated agents could be routed back into the old OpenClaw shell instead of Hermers ACP. |
| `meeting.dispatch` compatibility | `meetingDispatch` rewrites requests with `runtime=openclaw_route_shell` into `routeShellIngest`. | Callers should dispatch directly to the true runtime from `runtime_agents`. | `compat_redirect`. | Old caller input could create executable route-shell dispatch rows instead of redirect/fail-closed evidence. |
| Runtime bridge fail-closed repair | `runtime.bridge.drain` contains a route-shell redirect branch, but current registry validation rejects route-shell-only rows before execution because `workflow_ingress_adapter=route_shell` is not dispatch-capable. Old queued `openclaw_route_shell` rows therefore fail closed with registry evidence. | No new queued route-shell dispatches; old rows should be absent or fail closed. | `archive_repair`. | Existing queued legacy rows could be mistaken for executable work or lose clear failure evidence. |
| Dispatch-capable registry validation | Runtime bridge rejects `workflow_ingress_adapter=route_shell` as not dispatch-capable. | Registry rows should point to true execution adapters such as `acp`, `openclaw_native`, API, queue, or webhook. | `active_execution_forbidden`. | A route-shell adapter could re-enter active dispatch as a real worker. |
| V2 worker backend gate | `WORKFLOW_V2_DISALLOWED_WORKER_BACKENDS` includes `openclaw` and `openclaw_route_shell`. | V2 workers must use approved non-route-shell backends. | `v2_must_not_depend`. | V2 could launch workers through retired OpenClaw route-shell profiles. |
| Migration telemetry | Action policy classifies route-shell actions as `archive_no_migration` / `deprecated`; regression tests assert telemetry-only behavior for deprecated route-shell usage. | Keep telemetry until action removal batch; then assert unknown-action or archive-read-only behavior. | `deprecated_telemetry`. | Deprecated route-shell usage becomes invisible during the deprecation window. |

## Live Runtime Observation

Development-server state root checked during this audit:

```text
openclaw_route_shell|openclaw|cat_body|dormant|route_shell|disabled|disabled|none|0
openclaw_route_shell|openclaw|cat_ears|dormant|route_shell|disabled|disabled|none|0
openclaw_route_shell|openclaw|cat_eyes|dormant|route_shell|disabled|disabled|none|0
openclaw_route_shell|openclaw|cat_heart|dormant|route_shell|disabled|disabled|none|0
openclaw_route_shell|openclaw|cat_nose|dormant|route_shell|disabled|disabled|none|0
openclaw_route_shell|openclaw|cat_penclaw|dormant|route_shell|disabled|disabled|none|0
```

Interpretation:

- these rows are not active dispatch targets;
- they cannot receive workflow dispatch;
- they do not prove the route-shell code can be deleted, because archive redirect/fail-closed behavior may still be needed for historical queued dispatches or old operator inputs;
- before removal, the archive batch must also check live queued `mixed_meeting_dispatches`, plugin hook configuration, CLI/MCP callers, and docs/tests.

## Freeze Decision

| Surface | Batch C Decision | Reason |
| --- | --- | --- |
| `route_shell.ingest` | Do not migrate; keep as deprecated archive/compatibility surface until archive-removal batch. | It is still the fail-closed and redirect evidence path for route-shell ingress and old route-shell dispatches. |
| `route-shell.ingest` alias | Keep until alias/caller audit. | It is only a compatibility spelling and can be removed with unknown-action regression once no caller remains. |
| `route_shell.route` alias | Keep until alias/caller audit. | It maps to the same deprecated ingest path and should not become a new route API. |
| `runtime=openclaw_route_shell` in `meeting.dispatch` | Keep redirect behavior, but treat as deprecated caller input. | It prevents old calls from creating executable route-shell dispatch rows. |
| `runtime.bridge.drain runtime=openclaw_route_shell` | Keep fail-closed repair until no queued legacy rows remain. | Current registry validation rejects route-shell-only queued rows as non-dispatch-capable instead of executing them. |
| `openclaw_route_shell` as v2 worker backend | Keep forbidden. | V2 must never depend on route-shell execution. |
| Active route-shell runtime rows | Consider active execution frozen. | Live migrated-agent route-shell rows are dormant/disabled/non-dispatchable. |

## Required Archive-Removal Sequence

1. Query live `runtime_agents` and prove no active row has `runtime=openclaw_route_shell`, `im_ingress_adapter=openclaw_route_shell`, or `workflow_ingress_adapter=route_shell` with dispatch capability.
2. Query live `mixed_meeting_dispatches` and prove there are no queued/running `runtime=openclaw_route_shell` rows, or run a controlled fail-closed drain first.
3. Confirm OpenClaw plugin route-shell hook is disabled or absent in live Gateway configuration.
4. Audit CLI/MCP/operator callers for `route-shell-ingest`, `route_shell.ingest`, `route-shell.ingest`, `route_shell.route`, and `runtime=openclaw_route_shell`.
5. Replace any remaining operator docs with `message_flow.send` or direct dispatch to the true runtime from `runtime_agents`.
6. Convert route-shell mutating actions to unknown-action or archive-read-only behavior.
7. Keep regression proving v2 rejects `openclaw_route_shell` worker backends.
8. Run full freeze, check, release smoke, and server postcheck after removal.

## Regression Plan Before Any Future Removal

Before deleting or freezing route-shell action code, run at minimum:

- `npm run check:freeze`;
- route-shell action unknown-action or archive-read-only regression;
- regression proving `meeting.dispatch runtime=openclaw_route_shell` no longer creates executable route-shell dispatches;
- regression proving `runtime.bridge.drain runtime=openclaw_route_shell` has no queued legacy rows or fails closed with registry/audit evidence;
- regression proving `message_flow.send` covers the supported governed message path;
- regression proving v2 worker backend preflight still rejects `openclaw` and `openclaw_route_shell`;
- full `npm run check`;
- full `npm run smoke:release`;
- server runtime query for route-shell rows and queued route-shell dispatches;
- server OpenClaw plugin registry refresh and status postcheck.

Any failed test means archive removal is premature; keep the deprecated route-shell compatibility path and update the Batch C freeze table.
