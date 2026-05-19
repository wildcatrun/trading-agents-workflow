# Workflow Console MVP Skeleton

The workflow console is a thin Human/Workflow Control Plane for `trading-agents-workflow`.

Current scope:

- standalone Node HTTP process
- native static frontend under `static/console/`
- read-only SQLite read model for workflow list/detail, tasks, dispatches, Human Gate records, outbox, checkpoints, runtime agents and operations summary
- action gateway limited to preview actions by default
- no second scheduler, no direct business-table writes from the UI

## Start Locally

```bash
node bin/workflow-console.mjs \
  --root /path/to/trading-agents-workflow-root \
  --host 127.0.0.1 \
  --port 8791
```

Open:

```text
http://127.0.0.1:8791
```

Environment variables:

- `TRADING_AGENTS_WORKFLOW_ROOT`
- `WORKFLOW_CONSOLE_HOST` default `127.0.0.1`
- `WORKFLOW_CONSOLE_PORT` default `8791`
- `WORKFLOW_CONSOLE_TOKEN`
- `WORKFLOW_CONSOLE_ALLOWED_HOSTS`
- `WORKFLOW_CONSOLE_READONLY` default `true`
- `WORKFLOW_CONSOLE_ALLOW_WRITES` default `false`

## Safety Defaults

- Binds to loopback by default.
- Rejects unknown Host headers.
- Rejects cross-origin browser mutations.
- Does not accept tokens in query strings.
- Redacts callback tokens, API keys, secrets, passwords and OAuth-ish fields in read API responses.
- `POST /api/actions` only allows `workflow.advance.preview` and `workflow.supervise.preview` unless writes are explicitly enabled.

## Preview Actions

The console must call:

- `workflow.advance.preview`
- `workflow.supervise.preview`

It must not use `workflow.advance` or `workflow.supervise` for planning buttons. Those actions intentionally mutate workflow state and are used by the supervisor/control loop path.

## First Endpoints

- `GET /health`
- `GET /api/config`
- `GET /api/workflows`
- `GET /api/workflows/:workflowId`
- `GET /api/workflows/:workflowId/tasks`
- `GET /api/workflows/:workflowId/dispatches`
- `GET /api/workflows/:workflowId/runtime-runs`
- `GET /api/workflows/:workflowId/human-gates`
- `GET /api/workflows/:workflowId/outbox`
- `GET /api/workflows/:workflowId/checkpoints`
- `GET /api/workflows/:workflowId/evidence`
- `GET /api/runtime-agents`
- `GET /api/operations/summary`
- `GET /api/readiness/latest`
- `POST /api/actions`

## Not In This Skeleton

- workflow merge
- drag-and-drop state mutation
- production deploy controls
- Gateway restart/reload controls
- live trading actions
- Human Gate final submit UI
- multi-user RBAC

Those require a stronger operation table, Human Gate review sessions, and deployment review before exposure.
