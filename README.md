# Trading Agents Workflow

Version-controlled workflow governance assets for the cat-system `trading-agents` runtime.

This repository tracks durable workflow assets: governance logs, bridge/message templates, protocol documents, smoke-test records, artifact definitions, and the SQLite schema used by the workflow tracking database.

Runtime SQLite databases and backup databases are intentionally excluded from Git. Keep credentials, raw trading account data, OAuth tokens, private keys, and local environment files out of this repository.

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

The MCP server is intentionally read-oriented. It can inspect local Git state, read governance JSONL logs, query `runtime_agents`, and take read-only development-server snapshots. Publishing changes still requires normal Git review and push.

## Layout

- `artifacts/` - generated or curated workflow artifacts.
- `bridge/`, `commands/`, `events/`, `states/`, `index/`, `meetings/` - workflow smoke-test and runtime trace records suitable for audit.
- `governance-logs/` - timestamped readiness, incident, dispatch/receipt, Human Gate and side-effect governance traces.
- `radar/` - workflow protocol documentation.
- `templates/` - workflow report and review templates.
- `docs/tracking-schema.sql` - schema export for `tracking.db`.
- `scripts/trading_agents_workflow_mcp.py` - local Codex MCP server.
- `skills/trading-agents-workflow/` - Codex skill instructions for this integration.

## Operating Rules

- Preserve ISO timestamps on governance records and receipts.
- Keep workflow dispatch, receipt, runtime and side-effect records auditable.
- Do not commit runtime databases, local credentials, private keys, raw account data, generated dependency directories, or large archives.
