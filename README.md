# Trading Agents Workflow

Version-controlled workflow governance assets for the cat-system `trading-agents` runtime.

This repository tracks durable workflow assets: governance logs, bridge/message templates, protocol documents, smoke-test records, artifact definitions, and the SQLite schema used by the workflow tracking database.

Runtime SQLite databases and backup databases are intentionally excluded from Git. Keep credentials, raw trading account data, OAuth tokens, private keys, and local environment files out of this repository.

## Layout

- `artifacts/` - generated or curated workflow artifacts.
- `bridge/`, `commands/`, `events/`, `states/`, `index/`, `meetings/` - workflow smoke-test and runtime trace records suitable for audit.
- `governance-logs/` - timestamped readiness, incident, dispatch/receipt, Human Gate and side-effect governance traces.
- `radar/` - workflow protocol documentation.
- `templates/` - workflow report and review templates.
- `docs/tracking-schema.sql` - schema export for `tracking.db`.

## Operating Rules

- Preserve ISO timestamps on governance records and receipts.
- Keep workflow dispatch, receipt, runtime and side-effect records auditable.
- Do not commit runtime databases, local credentials, private keys, raw account data, generated dependency directories, or large archives.
