# Trading Agents Workflow

Version-controlled workflow governance assets for the cat-system `trading-agents` runtime.

This repository tracks durable workflow assets: governance logs, bridge/message templates, protocol documents, smoke-test records, artifact definitions, and the SQLite schema used by the workflow tracking database.

Runtime SQLite databases and backup databases are intentionally excluded from Git. Keep credentials, raw trading account data, OAuth tokens, private keys, and local environment files out of this repository.

## Workflow Progression

`trading-agents-workflow` is evolving from meeting capture into the durable task board for cat-system work. A long-running goal should be represented as a `workflow_run` with objective, acceptance criteria, stop condition, current phase, and current decision. Concrete work belongs in `workflow_tasks`, where each task has an owner agent, registered platform, status, priority, dependency list, expected artifact, receipt requirement, and optional Human Gate requirement.

Agent routing is registry-driven. `runtime_agents` records `platform`, `execution_adapter`, `im_ingress_owner`, `im_ingress_adapter`, and `workflow_ingress_adapter`; `agent_id` is identity only, not an execution location. Hermers is a platform and ACP is an adapter/mechanism, so a migrated instance is registered as `platform=hermers` plus `workflow_ingress_adapter=acp`.

The workflow plugin is the cat-system scheduler and evidence plane, not the runtime platform for cat-system members. Any operation involving an agent must start from `runtime_agents`, then enter the appropriate runtime adapter. OpenClaw, Hermers/Hermes, Codex, and future platforms own their own runtime residency, local cron, Telegram ingress, queue consumption, and process management.

Platform-local lists such as Hermers profiles, OpenClaw agent config, Codex sessions, systemd units, or local directories are adapter evidence only. They must not define cat-system membership, protection policy, dispatch priority, or lifecycle policy.

`workflow.advance` is the first supervisor loop. It inspects tasks, dependencies, receipts, artifacts, and Human Gate state, then decides whether to plan, dispatch ready work, keep collecting receipts, ask `cat_claw` for a summary package, mark the run blocked, or complete it.

`workflow.checkpoint` creates the session-overflow recovery package. It snapshots objective, acceptance criteria, phase, decision, active tasks, blocked tasks, artifact refs, Human Gate pressure, and next actions into `workflow_checkpoints` plus JSON/Markdown artifacts under `workflows/checkpoints/`. New agent sessions should restore from the latest checkpoint and referenced artifacts instead of replaying the full chat history.

`workflow.session_pack.*` and `workflow.session_run.*` provide the first workflow-native session store. They let the workflow prepare compact, task-specific worker input from stored context, tool policy, evidence refs, checkpoint refs, and per-run input. This is for repeatable worker execution and retry safety; it does not replace workflows, checkpoints, receipts, artifacts, or Human Gate records. Development notes are in `docs/workflow-session-store.md`.

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

For route-shell agents to dispatch migrated agents through this plugin, OpenClaw
must both load the plugin and expose its tool. Keep `trading-agents-workflow` in
`plugins.allow`, keep `openclaw.plugin.json` declaring
`contracts.tools=["trading_agents_workflow"]`, and add
`trading_agents_workflow` to `tools.alsoAllow` when using restrictive profiles
such as `tools.profile="coding"`.

After source, load-path, or tool-policy changes, run `openclaw config validate`
and reload or restart the actual Gateway. A route-shell smoke test should confirm
that `trading_agents_workflow` appears in the agent tool list before relying on
Hermers ACP dispatch.

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
- `docs/tracking-schema.sql` - schema export for `workflow_control_plane.db`.
- `scripts/trading_agents_workflow_mcp.py` - local Codex MCP server.
- `skills/trading-agents-workflow/` - Codex skill instructions for this integration.
- `openclaw.plugin.json`, `package.json`, `index.js`, `src/`, `bin/` - OpenClaw runtime plugin source.

## Operating Rules

- Preserve ISO timestamps on governance records and receipts.
- Record `trading-agents-workflow` problems, causes, fixes, delivery receipts, and follow-up decisions inside this plugin first. Agent `AGENTS.md` files are auxiliary behavior mirrors, not the primary issue record.
- Keep workflow dispatch, receipt, runtime and side-effect records auditable.
- Keep each active workflow tied to explicit next actions; meeting conclusions that require Flashcat confirmation should include the next action package for `cat_claw`, not just a passive summary.
- Treat session context as disposable execution space. Durable state must be in `workflow_runs`, `workflow_tasks`, `workflow_checkpoints`, receipts, and artifacts.
- Treat the public Wanman repository as a limited architecture reference. The target behavior is the more advanced continuous supervisor loop observed on the live Wanman product: decompose, dispatch, collect artifacts, review, and continue until accepted, blocked, or stopped.
- Do not commit runtime databases, local credentials, private keys, raw account data, generated dependency directories, or large archives.
