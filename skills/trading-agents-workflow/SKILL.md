---
name: trading-agents-workflow
description: Inspect and maintain the local Codex integration for the cat-system trading-agents workflow, including MCP readiness, runtime registry reads, governance logs, and Git synchronization boundaries.
---

# Trading Agents Workflow

Use this skill when working with the `trading-agents-workflow` Codex integration or when checking workflow registry, readiness logs, Git state, and server/local synchronization.

## Boundaries

- Development-server source of truth: `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow`.
- Local Git checkout used for GitHub versioning: the repository containing this skill.
- GitHub remote: `git@github.com:wildcatrun/trading-agents-workflow.git`.
- Runtime SQLite databases and backup databases are not committed to Git.

## MCP Tools

The plugin exposes a local Codex `trading-agents-workflow` MCP server with ops-oriented tools:

- `workflow_git_status`: local Git status, remote, HEAD, and tracked file count.
- `workflow_server_snapshot`: read-only development-server file and size snapshot.
- `workflow_latest_jsonl`: latest lines from local or remote workflow JSONL logs.
- `workflow_runtime_agents`: runtime agent registry from local or remote `tracking.db`.
- `workflow_receipts`, `workflow_message_flows`, `workflow_incidents`, and `workflow_reconcile_dry_run`: read receipt and incident surfaces.
- `workflow_message_flow_send`: the limited mutating MCP surface; it should route governed notices through the core/CLI workflow path.

Hermers profiles use `scripts/trading_agents_workflow_hermes_mcp.py`, which is intentionally smaller:

- `message_only`: `workflow_message_flow_send`.
- `governance`/`full`: `workflow_message_flow_send`, `workflow_status`, `workflow_schedule_list`.
- `TRADING_AGENTS_WORKFLOW_ALLOW_SCHEDULE_MUTATION=1`: additionally exposes `workflow_schedule_upsert`.
- `TRADING_AGENTS_WORKFLOW_ALLOW_RAW_ACTION=1`: additionally exposes raw `trading_agents_workflow`.

The core/library and CLI are the canonical implementation surface. MCP should stay a thin, capability-scoped wrapper.

OpenClaw agent tool exposure follows the same split:

- `toolAccess.fullAgents`: normally `main` only.
- `toolAccess.governanceAgents`: `cat_claw` for secretary/Human-Gate/status-limited workflow actions.
- other agents: `workflow_message_flow_send` only.

## Update Discipline

Before publishing updates:

1. Sync or compare against the development-server source of truth.
2. Keep `tracking.db`, `*.db-wal`, `*.db-shm`, and `backups/` out of Git.
3. Export schema changes to `docs/tracking-schema.sql` when database structure changes.
4. Scan for tokens, OAuth credentials, private keys, account data, and unexpectedly large files.
5. Commit and push through the configured GitHub SSH remote.
