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

The plugin exposes a `trading-agents-workflow` MCP server with read-oriented tools:

- `workflow_git_status`: local Git status, remote, HEAD, and tracked file count.
- `workflow_server_snapshot`: read-only development-server file and size snapshot.
- `workflow_latest_jsonl`: latest lines from local or remote workflow JSONL logs.
- `workflow_runtime_agents`: runtime agent registry from local or remote `tracking.db`.

## Update Discipline

Before publishing updates:

1. Sync or compare against the development-server source of truth.
2. Keep `tracking.db`, `*.db-wal`, `*.db-shm`, and `backups/` out of Git.
3. Export schema changes to `docs/tracking-schema.sql` when database structure changes.
4. Scan for tokens, OAuth credentials, private keys, account data, and unexpectedly large files.
5. Commit and push through the configured GitHub SSH remote.
