# Workflow Batch C Shared Substrate Audit

Date: 2026-07-18

Scope: `workflow.checkpoint`, `runtime.bridge.drain`, `meeting.dispatch`, and the related Batch C adapter surfaces.

Status: audit only. This document does not authorize freezing, deleting, or changing runtime behavior.

## Executive Conclusion

These code blocks are not disposable v1 leftovers:

- `workflow.checkpoint` is still the only implemented durable checkpoint writer for the legacy workflow-row shape and Human Gate archive closeout. P20 added `workflow.supervisor.checkpoint` for v2 supervisor boundaries, but P27 confirms that parity is partial and the old writer must migrate or be retargeted before freeze.
- `runtime.bridge.drain` is shared runtime dispatch infrastructure for queued `mixed_meeting_dispatches`; it is used by legacy supervisor/control-loop paths, route-shell compatibility, status recovery guidance, and runtime adapter execution. It must not be frozen as v1.
- `meeting.dispatch` is the shared dispatch/evidence creation path, not only a meeting feature. It resolves `runtime_agents`, enforces idempotency, creates `message_flow`, writes dispatch rows/artifacts, and appends workflow events.

The correct Batch C posture is:

- keep `workflow.checkpoint` as `legacy_active / must_migrate`;
- keep `runtime.bridge.drain` as `shared_runtime_substrate / allowed_until_service_cutover`;
- keep `meeting.dispatch` and related meeting dispatch surfaces as `shared_adapter / allowed_until_replaced`.

## Responsibility Decomposition

| Responsibility | Current Implementation | V2 / Shared Replacement | Migration Class | Wrong-Freeze Failure |
| --- | --- | --- | --- | --- |
| Durable checkpoint artifact | `workflow.checkpoint` writes JSON and Markdown checkpoint artifacts under `checkpoints/`, then records `workflow_checkpoints` and `artifact_index`. | No v2 checkpoint parity exists yet for plan/node/worker/adapter/Human Gate/session state. | `must_migrate`. | Recovery loses a durable resume boundary and incident closeout evidence. |
| Legacy checkpoint state collection | `workflow.checkpoint` reads `workflow_runs`, `workflow_tasks`, Human Gate count, task artifacts, and recent artifact refs. | Future v2 checkpoint must read `workflow_v2_plans`, nodes, worker runs, adapter jobs, sessions, Human Gate packages, receipt state, and side-effect uncertainty. | `legacy_shape_active`. | A v2 freeze would either miss v2 state or destroy existing legacy recovery. |
| Queued runtime dispatch drain | `runtime.bridge.drain` claims queued rows from `mixed_meeting_dispatches`, validates `runtime_agents`, checks task payload shape, and routes to Hermers ACP/CLI, OpenClaw, local Codex, or route-shell redirect paths. | `workflow.v2.adapter_runner.drain` drains v2 adapter jobs only; it does not replace generic `mixed_meeting_dispatches` dispatch draining. | `shared_runtime_substrate`. | Queued dispatches stop producing runtime receipt events and terminal dispatch status. |
| Runtime receipt eventing | `runtime.bridge.drain` appends `runtime.receipt` workflow events for non-skipped dispatch results and records failure state. | V2 worker/adapter result actions cover v2 worker jobs only. | `shared_runtime_substrate`. | Dispatch/readiness/status views lose receipt evidence and stale dispatch recovery signal. |
| Runtime recovery guidance | `workflow.status` recommends `runtime.bridge.drain` for stale queued/sent dispatches and stale started runtime runs. | No complete v2 replacement for generic runtime dispatch health guidance. | `shared_control_surface`. | Operators lose governed recovery action for stale dispatch/run states. |
| Dispatch creation and idempotency | `meeting.dispatch` resolves registered runtime target, creates/returns idempotent `mixed_meeting_dispatches` rows, and writes dispatch artifacts. | Future shared dispatch bridge may rename the surface, but the behavior remains required. | `shared_adapter`. | Duplicate dispatch protection, target resolution, and dispatch artifacts break. |
| Message-flow integration | `meeting.dispatch` validates and creates eligible `message_flow` records around dispatch creation according to target/return-policy rules. | `message_flow` remains shared delivery/evidence substrate. | `shared_adapter`. | Eligible dispatches can be created without delivery/receipt tracking. |
| Runtime agent registry coupling | `meeting.dispatch` resolves and preserves runtime agent records through `runtime_agents`; `runtime.bridge.drain` validates dispatch rows against that registry. | `runtime_agents` remains shared substrate for v1/v2/runtime ownership. | `expected_shared_dependency`. | A parallel registry or direct platform dispatch bypasses global agent ownership. |
| Route-shell compatibility | `meeting.dispatch` forwards `openclaw_route_shell` requests into `routeShellIngest`; `runtime.bridge.drain` can redirect queued route-shell dispatches through governed target resolution. | Route shell is deprecated/archive-only for active migrated agents, but compatibility telemetry remains until separate removal. | `archive_compat_dependency`. | Historical/compat route-shell dispatches fail without auditable redirect/fail-closed evidence. |

## Caller and Dependency Map

| Caller / Dependency | Current Link | Freeze Implication |
| --- | --- | --- |
| `workflow.supervise` | Calls `workflowCheckpoint` and `meetingDispatch`; after P21 it records deferred drain evidence instead of directly calling `runtimeBridgeDrain`. | Batch C advance/supervise cannot freeze checkpoint/dispatch dependencies first; generic drain remains owned by control-loop `runtime_drain`. |
| `workflow.control_loop.tick` | Runs `workflow_supervise`, enqueues `runtime_drain`, runs `scheduled_dispatch`, and calls `meetingDispatch` for retry-style jobs. | Control-loop recovery depends on these shared actions. |
| `route_shell.ingest` | Creates governed dispatch through `meetingDispatch` and can immediately call `runtimeBridgeDrain`. | Route-shell archive compatibility still depends on shared adapter surfaces. |
| `human_gate` archive path | Uses `workflowCheckpoint` for archive/checkpoint evidence. | Checkpoint cannot be deleted before Human Gate archive parity is proven. |
| CLI / governance tools | `bin/cat-meeting-governance.mjs` exposes `workflow.checkpoint`, `meeting.dispatch`, and `runtime.bridge.drain`; `index.js` exposes plugin commands for the same surfaces. | Operator diagnostics and manual recovery still depend on explicit governed actions. |
| Status/readiness guidance | `status-actions` recommends `runtime.bridge.drain` for stale dispatch/runtime states. | Removing the action would make current readiness remediation invalid. |
| V2 adapter runner | `workflow.v2.adapter_runner.service_plan.preview` is disabled-by-default, and `workflow.v2.adapter_runner.drain` operates on v2 adapter jobs, not generic dispatch rows. | It is a partial adjacent executor, not a replacement for `runtime.bridge.drain`. |

## Freeze Decision

| Action / Surface | Batch C Decision | Reason |
| --- | --- | --- |
| `workflow.checkpoint` | Keep; do not freeze/delete after P27. | V2 supervisor checkpoint parity exists only for v2 boundary rows; Human Gate archive closeout and legacy compatibility callers are not retargeted. |
| `runtime.bridge.drain` | Keep as shared runtime substrate. | It drains generic queued dispatches and produces runtime receipt/failure evidence outside v2 adapter jobs. |
| `meeting.dispatch` | Keep as shared adapter/evidence substrate. | It is the canonical dispatch creation, message-flow, idempotency, registry-resolution, and event path. |
| `meeting.ingest`, `meeting.resume`, `meeting.disperse`, `meeting.runtime_participant` | Keep pending separate adapter audit. | These may contain meeting-era naming, but they still participate in shared message/dispatch/receipt semantics. |

## Required Migration Sequence

1. Define a v2/shared checkpoint contract that captures v2 plans, nodes, worker runs, adapter jobs, sessions, Human Gate packages, receipts, side-effect uncertainty, and rollback/resume payloads.
2. Implement checkpoint parity without removing the legacy checkpoint writer; run dual-write or fixture comparison until old/new checkpoint evidence agrees for equivalent states.
3. Separate generic dispatch bridge responsibilities from meeting-era naming: keep `meeting.dispatch` behavior, but optionally introduce a clearer shared alias after audit.
4. Prove all queued `mixed_meeting_dispatches` production paths have either migrated to a real generic dispatch replacement or still intentionally use `runtime.bridge.drain`; `workflow.v2.adapter_runner.drain` only replaces v2 worker adapter job execution.
5. Deploy v2 adapter runner service only after live wrapper evidence and explicit service gate approval; do not use its existence as proof that generic runtime bridge can retire.
6. Only after an observation window with no useful `runtime.bridge.drain` / `meeting.dispatch` dependency, downgrade or rename shells; do not delete first.

## Regression Plan Before Any Future Freeze

Before freezing or renaming any surface in this audit, run at minimum:

- `npm run check:freeze`;
- targeted checkpoint create/rewrite/resume-payload regression;
- targeted runtime bridge drain regression for Hermers/OpenClaw/local Codex and invalid registry/payload failures;
- targeted meeting dispatch regression for idempotency, runtime target resolution, message_flow creation, dispatch artifact, and workflow event;
- targeted control-loop regression for `workflow_supervise`, `runtime_drain`, `scheduled_dispatch`, and meeting dispatch retry jobs;
- targeted route-shell compatibility regression for governed redirect/fail-closed paths;
- full `npm run check`;
- full `npm run smoke:release`;
- server postcheck against active checkout and runtime state root.

Any failed test in the above means the surface is still useful or the replacement is incomplete; revert the freeze attempt and update the Batch C freeze table.
