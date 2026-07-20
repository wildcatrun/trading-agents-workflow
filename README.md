# Trading Agents Workflow

Version-controlled workflow governance assets for the cat-system `trading-agents` runtime.

This repository tracks durable workflow assets: governance logs, bridge/message templates, protocol documents, smoke-test records, artifact definitions, and the SQLite schema used by the workflow tracking database.

Runtime SQLite databases and backup databases are intentionally excluded from Git. Keep credentials, raw trading account data, OAuth tokens, private keys, and local environment files out of this repository.

## Workflow Progression

`trading-agents-workflow` is evolving from meeting capture into the governed v2
plan kernel for cat-system work. New orchestration starts should use
`workflow.v2.plan.create` or approved templates. Legacy `workflow_runs` and
`workflow_tasks` remain read/history and explicit compatibility surfaces while
the P7 freeze pool retires direct v1 mutating entry points.

Agent routing is registry-driven. `runtime_agents` records `platform`, `execution_adapter`, `im_ingress_owner`, `im_ingress_adapter`, and `workflow_ingress_adapter`; `agent_id` is identity only, not an execution location. Hermers is a platform and ACP is an adapter/mechanism, so a migrated instance is registered as `platform=hermers` plus `workflow_ingress_adapter=acp`.

The workflow plugin is the cat-system scheduler and evidence plane, not the runtime platform for cat-system members. Any operation involving an agent must start from `runtime_agents`, then enter the appropriate runtime adapter. OpenClaw, Hermers/Hermes, Codex, and future platforms own their own runtime residency, local cron, Telegram ingress, queue consumption, and process management.

Platform-local lists such as Hermers profiles, OpenClaw agent config, Codex sessions, systemd units, or local directories are adapter evidence only. They must not define cat-system membership, protection policy, dispatch priority, or lifecycle policy.

`workflow.advance` is the first supervisor loop. It inspects tasks, dependencies, receipts, artifacts, and Human Gate state, then decides whether to plan, dispatch ready work, keep collecting receipts, ask `cat_claw` for a summary package, mark the run blocked, or complete it.

`workflow.checkpoint` is now a frozen legacy compatibility diagnostic and no longer writes old `workflow_runs` / `workflow_tasks` checkpoint rows. Operator CLI recovery should use `workflow-checkpoint --workflow <id> --source-class v2_plan_checkpoint --plan <id>` for v2 supervisor checkpoint boundaries, `workflow-checkpoint --workflow <id> --source-class human_gate_archive_checkpoint --plan <id> --human-gate <id> --button <id>` for archive closeout boundaries, or the default `legacy_compat_checkpoint` only to inspect old legacy recovery state through `workflow.checkpoint.legacy_export`.

`workflow.session_pack.*` and `workflow.session_run.*` provide the first workflow-native session store. They let the workflow prepare compact, task-specific worker input from stored context, tool policy, evidence refs, checkpoint refs, and per-run input. This is for repeatable worker execution and retry safety; it does not replace workflows, checkpoints, receipts, artifacts, or Human Gate records. Development notes are in `docs/workflow-session-store.md`.

`workflow-v2-orchestration-kernel` is the design and initial implementation track for turning this plugin from a collection of workflow parts into a manager/worker orchestration kernel. It defines cat members as durable manager identities, workers as spawned tool-agent instances, a session repository as the context/template source, adaptive prepare-task planning, complexity-triggered managers/task groups, and Human Gate as the final governed human interaction boundary. The local kernel slice adds `workflow_v2_*` schema, preview/record actions, information-stack read/receipt actions, backend preflight evidence, worker lifecycle preview, governed worker handoff/retire/successor actions, worker handoff/lineage validation, a v2 Human Gate request bridge, and a consistency validator, but it does not start real worker runtimes or deploy to production.

`workflow-v2-information-stack` defines the v2 communication substrate. Core message content, task payloads, context refs, artifact refs, ACLs, and read receipts belong in workflow-native information tables. `message_flow` should become an SMS-like notification layer that tells a target which governed inbox item to read; it should not carry the authoritative body for manager/worker work.

`workflow-v2-worker-lifecycle-renewal` adds the Anthropic-informed worker lifecycle contract: workers are finite-context execution instances, not immortal conversations. When context pressure, repeated compaction, stale assumptions, or review failures appear, a manager should retire or supersede the worker, persist a handoff package, and spawn a same-class successor from curated refs and artifacts.

`workflow-v2-worker-runtime-backends` records the worker runtime direction before implementation: OpenClaw is not a worker backend; Hermers and Claude Code are the preferred worker platforms; `wsl-agents` may provide Docker sandbox testbeds; `wsl-models` provides model/GPU APIs; specialized tool containers and GPU worker containers are out of scope for the current round.

`workflow-v2-implementation-status` records what has landed in code, what remains only a design or future runtime slice, and which regression tests cover the current v2 kernel.

`workflow-v1-v2-refactor-migration-plan` records the code topology, shared
substrate, v1 compatibility surfaces, v2 kernel target, and the migration plan
for ending the v1/v2 coexistence period at `v1.0.0`.

`workflow-v1-v2-migration-worthiness-audit` is the migration value gate. It
classifies each legacy/shared code block as must-migrate, compatibility shell,
optional/template-later, shared substrate, or archive/no-migration before any
implementation slice is selected.

`workflow-v2-replacement-capability-completion-plan` records the remaining
core replacement capability work that must be completed before additional v1
execution freezes:
checkpoint/archive recovery, intervention/evaluation, scheduler/maintenance
service split, and generic runtime dispatch bridge. It also tracks read-model
and domain cleanup needed before default-kernel cutover.

`workflow-p28-archive-checkpoint-writer` records the R1 archive checkpoint
slice: `workflow.archive.checkpoint.preview`, the authorized
`workflow.archive.checkpoint` writer, and the Human Gate archive retarget for
matching v2 plan state. Legacy archive closeout without matching v2 plan state
now uses read-only `workflow.checkpoint.legacy_export` after P33;
`workflow.checkpoint` is not frozen by this slice.

`workflow-p29-checkpoint-cli-source-class-routing` records the operator CLI
retarget slice: `workflow-checkpoint` now supports explicit `--source-class`
routing to legacy compatibility, v2 supervisor checkpoint, or Human Gate archive
checkpoint writers without silently changing the default legacy path.

`workflow-p30-context-checkpoint-alias-retirement` records the ambiguous alias
retirement slice: `workflow.context_checkpoint` and `context.checkpoint` now
return a blocked diagnostic instead of writing through `workflow.checkpoint`.
Known legacy compatibility recovery now uses read-only
`workflow.checkpoint.legacy_export`.

`workflow-p31-explicit-legacy-checkpoint-source-gate` records the source gate
slice: bare `workflow.checkpoint` calls now return a blocked diagnostic, while
explicit legacy compatibility sources and internal fallback sources were later
retargeted to read-only export in P33 and final-frozen in P34.

`workflow-p32-legacy-checkpoint-usage-audit` records the read-only usage audit:
the dev-server state-root snapshot has no legacy checkpoint rows or keyword
evidence of recent legacy recovery use, and the then-remaining write-capable
compatibility mechanisms are converted to read-only export in P33.

`workflow-p33-legacy-checkpoint-export-diagnostic` records the read-only
replacement slice: operator legacy recovery, legacy supervise escape-hatch
checkpointing, and Human Gate archive fallback now use
`workflow.checkpoint.legacy_export` instead of writing legacy checkpoint rows.

`workflow-p34-final-checkpoint-writer-freeze` records the final freeze slice:
`workflow.checkpoint` itself is now a non-mutating diagnostic; v2/shared
checkpoint writes must use `workflow.supervisor.checkpoint` or
`workflow.archive.checkpoint`.

`message_flow` is the governed delivery layer for agent-to-agent, route-shell, Telegram-return, and local Codex inbox traffic. `local_codex` / `codex` is now an allowed inbox target through the workflow plugin, but it records delivery evidence only; formal reports, Human Gate requests, and trading-related confirmations still require the governed IM/Human Gate path. Closure details are in `docs/message-flow-closure.md`.

`human_gate.inbox` creates the secretary-facing approval table for complex workflows. It gathers pending Human Gate records, review gates, gated tasks, and Cat Claw delivery failures into `human_gate_batches`, `human_gate_batch_items`, and HTML/JSON artifacts under `human-gates/inbox/` so Flashcat can review multiple low-risk items together while P0/P1 items remain individual approvals.

Trading Human Gates have one extra narrow path. A Human Gate approved trading package may route to `openclaw:cat_tail` only as `dispatch_type=pre_order_risk_audit`; Cat Tail then creates the final risk paper and structured `risk_decision` before any `executable_trade_intent` can be handed to `trading_core`. Ordinary approved Human Gates do not go to Cat Tail. Details are in `docs/pre-order-risk-audit.md`.

## OpenClaw Plugin

This repository also contains the OpenClaw runtime plugin source. The
development server active checkout is maintained through the GitHub-managed
path:

```text
/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout
```

Tracked OpenClaw plugin files include:

- `openclaw.plugin.json`
- `package.json`
- `index.js`
- `src/core.js`
- `src/workflow.js`
- `bin/cat-meeting-governance.mjs`
- `docs/openclaw-plugin-readme.md`

The development server still owns the live runtime copy. Do not replace or pull into the live plugin directory without a backup, diff review, syntax check, smoke test, and explicit Human Gate for any Gateway reload or restart.

## Codex Installation

This repository includes a minimal Codex plugin manifest and MCP server:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `scripts/trading_agents_workflow_mcp.py`
- `skills/trading-agents-workflow/SKILL.md`

For direct local Codex MCP loading, add this server to `~/.codex/config.toml`:

```toml
[mcp_servers.trading-agents-workflow]
command = "python3"
args = ["/absolute/path/to/trading-agents-workflow/scripts/trading_agents_workflow_mcp.py"]
startup_timeout_sec = 10
tool_timeout_sec = 240
enabled = true
```

For local Codex operations against the development server, prefer the fixed
Tailscale node name and keep the public IP only as a transport fallback:

```toml
env = {
  TRADING_WORKFLOW_REMOTE_HOST = "dev-server",
  TRADING_WORKFLOW_REMOTE_FALLBACK_HOSTS = "106.54.53.146",
  TRADING_WORKFLOW_REMOTE_CODE_PATH = "/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout",
  TRADING_WORKFLOW_REMOTE_STATE_ROOT = "/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow"
}
```

Remote read-only checks may fall back from `dev-server` to the public IP on SSH
transport failure. Remote mutating tools do not use fallback retries, to avoid
duplicating workflow writes if a connection drops after the server has already
applied a side effect.

`trading-agents-workflow` keeps behavior in the Node core/CLI/OpenClaw plugin. MCP is only a thin control-plane wrapper for model-accessible, capability-scoped operations.

The local Codex MCP server is intentionally ops-oriented. It can inspect local Git state, read governance JSONL logs, query `runtime_agents`, read receipt surfaces, and take development-server snapshots. Its mutating surface is limited to governed `message_flow` creation and still routes through the CLI/core path.

The Hermers MCP server is narrower by default:

- normal profiles expose only `workflow_message_flow_send`;
- the governance profile (`catheart`, or `TRADING_AGENTS_WORKFLOW_CAPABILITY=governance|full`) exposes `workflow_message_flow_send`, `workflow_status`, and `workflow_schedule_list`;
- `workflow_schedule_upsert` is hidden unless `TRADING_AGENTS_WORKFLOW_ALLOW_SCHEDULE_MUTATION=1`;
- raw `trading_agents_workflow` action calls are hidden unless `TRADING_AGENTS_WORKFLOW_ALLOW_RAW_ACTION=1`.

This keeps long-lived Hermers sessions from carrying the full workflow surface while preserving an explicit emergency/debug path. Publishing changes still requires normal Git review and push.

The OpenClaw plugin uses the same least-surface rule for agent tools:

- `toolAccess.fullAgents` should normally contain only `main`;
- `toolAccess.governanceAgents` should contain `cat_claw` for secretary/Human-Gate/status actions;
- all other OpenClaw agents receive only `workflow_message_flow_send`.

## Companion Stability Plugin

`cat-agents-stability` is the companion governance package for this workflow plugin. It owns stability probes, lane policy, findings, runbooks, desired-state drift checks, and guarded low-risk diagnostics. It does not embed `trading-agents-workflow`, replace the 30s queue, or directly mutate workflow tables.

The boundary is recorded in `docs/companion-stability-plugin.md`. Local Codex should load both MCP servers so it can observe workflow state and stability drift from the same control panel without becoming a workflow runtime.

## OpenClaw Gateway Tool Policy

OpenClaw must load this plugin and expose its governed tool for current workflow
operations. Keep `trading-agents-workflow` in `plugins.allow`, keep
`openclaw.plugin.json` declaring `contracts.tools=["trading_agents_workflow"]`,
and add `trading_agents_workflow` to `tools.alsoAllow` when using restrictive
profiles such as `tools.profile="coding"`.

Route-shell physical forwarding is source-deleted. Do not configure
`routeShell`, do not use `route_shell.*` actions, and do not rely on
`runtime=openclaw_route_shell` as an execution or forwarding path. Use
`runtime_agents`, `message_flow`, and the target runtime adapter instead.

After source, load-path, or tool-policy changes, run `openclaw config validate`
and reload or restart the actual Gateway only through the approved runbook.

## Layout

- `artifacts/` - generated or curated workflow artifacts.
- `bridge/`, `commands/`, `events/`, `states/`, `index/`, `meetings/` - workflow smoke-test and runtime trace records suitable for audit.
- `governance-logs/` - timestamped readiness, incident, dispatch/receipt, Human Gate and side-effect governance traces.
- `human-gates/inbox/` - generated Human Gate Inbox HTML/JSON batches for Flashcat review.
- `radar/` - workflow protocol documentation.
- `templates/` - workflow report and review templates.
- `docs/governance-records.md` - policy for recording workflow incidents, fixes, delivery failures, and Human Gate packages inside this plugin.
- `docs/claude-code-workflow-reference/` - long-running reference and adaptation program for using Claude Code Dynamic workflows to guide `trading-agents-workflow` plan specs, phase/node execution, verification, console observability, Human Gate boundaries, and future live-trading readiness.
- `docs/engineering-changes-2026-05-27.md` - engineering changelog for the 2026-05-27 message_flow ACK, timeout classification, Task Launch Package, deployment, and in-flight cleanup work.
- `docs/gateway-memory-control-loop-incident-2026-05-28.md` - maintenance record for Gateway cgroup memory diagnosis, workflow control-loop load amplification, the blocked workflow supervision cooldown fix, and future verification commands.
- `docs/agent-registry-routing.md` - routing contract for platform, adapter, IM ingress, workflow ingress, and route-shell behavior.
- `docs/companion-stability-plugin.md` - boundary contract with `cat-agents-stability`.
- `docs/managed-agent-evolution-plan.md` - phased plan for workflow events, permission gates, managed worker runners, and financial evidence contracts.
- `docs/message-flow-closure.md` - closure contract for message_flow, return policies, local Codex inbox delivery, runtime drain, and stuck-flow incidents.
- `docs/runtime-profile-modes.md` - registry-first notes for runtime profile-mode evidence, workflow admission, readiness, and stability boundaries.
- `docs/workflow-console-v0.3-message-flow-observability.md` - v0.3 console round record for message_flow visibility, attention rules, runtime drain job display, smoke evidence, and rollout notes.
- `docs/workflow-session-store.md` - development notes for session packs, session runs, worker input, CLI, invariants, and roadmap.
- `docs/workflow-task-drafting-initial-plan.md` - initial design reference for a higher-level workflow task drafting layer, default Cat Brain/Cat Claw governance roles, structured phases, quality gates, resume/idempotency, and Task Launch Package v1.
- `docs/workflow-v2-information-stack.md` - design draft for the v2 information stack, governed inboxes, read grants, receipts, and the SMS-like role of `message_flow`.
- `docs/workflow-v2-orchestration-kernel.md` - design and implementation guide for the v2 manager/worker orchestration kernel, session repository, worker spawn/review loop, Human Gate boundary, and implementation slices.
- `docs/workflow-v2-worker-lifecycle-renewal.md` - Anthropic-informed design draft for worker context budgets, compaction signals, retirement, handoff packages, same-class successor spawning, lineage, and review hierarchy.
- `docs/workflow-v2-implementation-status.md` - current implementation status for v2 actions, tables, safety boundaries, and regression coverage.
- `docs/workflow-v2-unified-next-plan.md` - current v2.1+ development plan: split the long v2 regression first, then mechanically modularize `workflow.js`, add a v2 action registry, and only then resume real Hermers/Claude Code worker adapter work.
- `docs/workflow-v1-v2-refactor-migration-plan.md` - topology-driven refactor and migration plan for making v2 the default kernel by `v1.0.0`, reducing v1 to compatibility shims, and protecting shared substrate.
- `docs/workflow-v1-v2-migration-worthiness-audit.md` - migration value audit that separates must-migrate blocks from compatibility shells, optional/template-later work, shared substrate, and archive/no-migration surfaces.
- `docs/workflow-v2-replacement-capability-completion-plan.md` - execution plan for completing the remaining replacement capability families before further v1 execution freezes or the v2 default-kernel cutover.
- `docs/workflow-p17-supervisor-closeout-preview.md` - P17 read-only closeout preview slice for completed v2 plans.
- `docs/workflow-p18-supervisor-checkpoint-preview.md` - P18 read-only checkpoint preview slice for v2 recovery-boundary parity and the remaining checkpoint writer gap.
- `docs/workflow-p19-supervisor-closeout-executor.md` - P19 governed closeout executor for completed v2 plans; writes closeout evidence and queues one Cat Claw dispatch without Human Gate/Telegram/runtime drain side effects.
- `docs/workflow-v2-p1-readiness-plan.md` - historical first-slice authorization gate, dry-run API contract, test matrix, worker testbed preflight, and execution-readiness checklist.
- `docs/workflow-v2-orchestration-schema.sql` - schema design reference for v2 orchestration objects; the initial runtime implementation now creates an aligned minimal `workflow_v2_*` subset.
- `docs/workflow-v2-worker-runtime-backends.md` - requirements draft for Hermers/Claude Code worker backends, `wsl-agents` Docker sandbox testbeds, `wsl-models` API usage, and authorization gates.
- `docs/tracking-schema.sql` - schema export for `workflow_control_plane.db`.
- `scripts/trading_agents_workflow_mcp.py` - local Codex MCP server.
- `skills/trading-agents-workflow/` - Codex skill instructions for this integration.
- `openclaw.plugin.json`, `package.json`, `index.js`, `src/`, `bin/` - OpenClaw runtime plugin source.

## Operating Rules

- Preserve ISO timestamps on governance records and receipts.
- Record `trading-agents-workflow` problems, causes, fixes, delivery receipts, and follow-up decisions inside this plugin first. Agent `AGENTS.md` files are auxiliary behavior mirrors, not the primary issue record.
- Keep workflow dispatch, receipt, runtime and side-effect records auditable.
- Keep each active workflow tied to explicit next actions; meeting conclusions that require Flashcat confirmation should include the next action package for `cat_claw`, not just a passive summary.
- Treat session context as disposable execution space. Durable state must be in governed workflow state tables, v2/shared checkpoint records, receipts, and artifacts; legacy `workflow.checkpoint` is frozen diagnostic-only.
- Treat the public Wanman repository as a limited architecture reference. The target behavior is the more advanced continuous supervisor loop observed on the live Wanman product: decompose, dispatch, collect artifacts, review, and continue until accepted, blocked, or stopped.
- Do not commit runtime databases, local credentials, private keys, raw account data, generated dependency directories, or large archives.
