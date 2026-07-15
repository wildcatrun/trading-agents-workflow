# trading-agents-workflow v0.8.2-rc.1

Release date: 2026-07-15

## Positioning

`v0.8.2-rc.1` is the first release candidate for the Workflow v2 governed
orchestration module inside the `trading-agents-workflow` plugin.

This is one plugin release. Workflow v1 and Workflow v2 are module generations
inside the same package, not separate package releases.

## Module Status

- Workflow v1: frozen compatibility mode; legacy mutating entry points are
  hidden/blocked by default and kept only as explicitly gated short-term escape
  hatches with target removal at `v1.0.0`; the active batch ledger is
  `docs/workflow-freeze-pool-p7.md`.
- Workflow v2: enabled for governed preview, rehearsal, audit, Human Gate
  packaging, and paper-only pre-execution guardrails.
- Real worker wrappers: gated/off by default.
- Live Telegram delivery: gated/off by default for v2 rehearsal paths.
- Live trading and broker order placement: gated/off.

## Included Workflow v2 Scope

- Unified P0-P7 development flow documentation.
- Cat Brain semantic-check preview.
- Cat Claw package-audit preview.
- Adapter runner wrapper-contract preview.
- Adapter runner drain-readiness preview.
- Adapter runner service-plan preview and guarded one-shot service runner.
- Daily trading template catalog preview.
- Non-trading end-to-end rehearsal smoke.
- Paper-only trading pre-execution smoke.
- Release smoke integration for the new v2 rehearsal checks.

## Validation Evidence

- Commit: `84d50c42a4b3d8f5e38835cd4bbb35812bb3497c`
- Prior engineering tag: `workflow-v2-p0-p7-candidate-20260715`
- Server release smoke index:
  `/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260715-workflow-v2-p0-p7-candidate/smoke/index.json`
- Closeout:
  `/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260715-workflow-v2-p0-p7-candidate/closeout.md`

## Deployment State

- GitHub `main`: deployed to dev-server active checkout.
- Dev-server active checkout:
  `/home/flashcat/.openclaw/plugin-dev/trading-agents-workflow.git-checkout`
- OpenClaw Gateway: restarted after deployment and postchecked.
- Workflow readiness after postcheck: `ready`.
- `main.workspace` invariant:
  `/home/flashcat/.openclaw/workspace-cat_brain`.

## Explicit Non-Scope

- No production server deployment.
- No production database migration.
- No live Telegram delivery from v2 rehearsal paths.
- No Docker worker execution.
- No model calls from rehearsal smoke.
- No broker credentials, live trading, or live order placement.

## Rollout Guidance

Use `v0.8.2-rc.1` for dev-server governed trial runs only. Any activation of
real worker wrappers, live delivery, production migration, or live trading must
go through a separate authorized plan, quality gate, and rollback record.
