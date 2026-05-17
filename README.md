# Trading Agents Workflow

Version-controlled workflow governance assets for the cat-system `trading-agents` runtime.

This repository tracks durable workflow assets: governance logs, bridge/message templates, protocol documents, smoke-test records, artifact definitions, and the SQLite schema used by the workflow tracking database.

Runtime SQLite databases and backup databases are intentionally excluded from Git. Keep credentials, raw trading account data, OAuth tokens, private keys, and local environment files out of this repository.

## OpenClaw Plugin

This repository also contains the OpenClaw runtime plugin source that is currently deployed on the development server under:

```text
/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow
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

The MCP server is intentionally read-oriented. It can inspect local Git state, read governance JSONL logs, query `runtime_agents`, and take read-only development-server snapshots. Publishing changes still requires normal Git review and push.

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
Hermes ACP dispatch.

## Layout

- `artifacts/` - generated or curated workflow artifacts.
- `bridge/`, `commands/`, `events/`, `states/`, `index/`, `meetings/` - workflow smoke-test and runtime trace records suitable for audit.
- `governance-logs/` - timestamped readiness, incident, dispatch/receipt, Human Gate and side-effect governance traces.
- `radar/` - workflow protocol documentation.
- `templates/` - workflow report and review templates.
- `docs/tracking-schema.sql` - schema export for `tracking.db`.
- `scripts/trading_agents_workflow_mcp.py` - local Codex MCP server.
- `skills/trading-agents-workflow/` - Codex skill instructions for this integration.
- `openclaw.plugin.json`, `package.json`, `index.js`, `src/`, `bin/` - OpenClaw runtime plugin source.

## Human Gate Action Plans

Meeting conclusions that need Flashcat confirmation must not be submitted as plain summaries. `cat_claw` must attach an action plan with the recommended path, alternatives, risk boundary, post-approval dispatch chain, artifact targets, acceptance criteria, next Human Gate trigger, and stop condition. Use `templates/human-gate-action-plan.md` for this handoff.

After approval, `main` turns the decision into the next workflow dispatches and `cat_claw` keeps tracking receipts until Flashcat accepts the outcome, asks for another iteration, blocks the work, or stops the workflow.

## Operating Rules

- Preserve ISO timestamps on governance records and receipts.
- Keep workflow dispatch, receipt, runtime and side-effect records auditable.
- Do not commit runtime databases, local credentials, private keys, raw account data, generated dependency directories, or large archives.
