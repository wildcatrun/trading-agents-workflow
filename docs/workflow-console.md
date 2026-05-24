# Workflow Console MVP Skeleton

The workflow console is a thin Human/Workflow Control Plane for `trading-agents-workflow`.

Current scope:

- standalone Node HTTP process
- native static frontend under `static/console/`
- workbench UI for workflow queue, task cards/tables, dispatch/runtime tracking, Human Gate/outbox/evidence panels and raw JSON fallback
- read-only SQLite read model for workflow list/detail, tasks, dispatches, message flows, Human Gate records, outbox, checkpoints, runtime agents and operations summary
- aggregated workflow timeline assembled from tasks, dispatches, runtime runs, message_flow events, Human Gate records/buttons, outbox, checkpoints, artifacts, side effects and incidents
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
- Preview actions are dry-runs for workflow business state, but they still append
  console operation audit records.

## Development Deployment Snapshot

2026-05-24 v0.3 rollout target state:

- Commit: current GitHub-managed plugin checkout commit
- Development server checkout:
  `/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout`
- Console bind target when started: `127.0.0.1:8791`
- Data source:
  `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/tracking.db`
- Local access tunnel:
  `127.0.0.1:18791 -> 106.54.53.146:127.0.0.1:8791`
- Runtime log target:
  `/home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/governance-logs/workflow-console-dev.log`
- Mode: read-only / preview-only

The console is not a required runtime dependency for workflow correctness. It is
an operator observation surface over the workflow DB and governed actions.
GET read-model surfaces are read-only. Preview actions are dry-runs for workflow
business state, but still write console operation audit logs.

v0.3 adds read-only `message_flow` visibility for the current workflow closure
contract:

- per-workflow Message Flow tab;
- flow status, target runtime/agent, return policy, dispatch/run/outbox refs;
- local Codex inbox closure evidence without requiring Telegram receipt;
- `return_policy=silent` closure without false stuck-delivery pressure;
- delivery-required flow attention list in Operations;
- exact `runtime_drain:<runtime>:<dispatch_id>` job visibility in Operations;
- message_flow lifecycle events in the workflow timeline.

The round record and rollout notes are maintained in
`docs/workflow-console-v0.3-message-flow-observability.md`.

## Phase Hold

After v0.2, console feature expansion is intentionally paused.

Do not add real write controls until the existing cat-system workflow has run
longer and `trading-agents-workflow` has more stable evidence around:

- dispatch/receipt completeness
- runtime bridge behavior
- message_flow closure, including `local_codex` inbox and `return_policy=silent`
- Human Gate button/resume closure
- Telegram outbox delivery
- readiness and incident false positives
- checkpoint and evidence discipline

When work resumes, the next product slice should be Task Card Draft and Cat
Brain Preheat preview. Do not prioritize merge, terminate, pause, approval,
Gateway restart, production deploy or live trading controls.

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
- `GET /api/workflows/:workflowId/message-flows`
- `GET /api/workflows/:workflowId/human-gates`
- `GET /api/workflows/:workflowId/outbox`
- `GET /api/workflows/:workflowId/checkpoints`
- `GET /api/workflows/:workflowId/evidence`
- `GET /api/workflows/:workflowId/timeline`
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
