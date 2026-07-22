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
- Governance semantic-check preview.
- Protocol package-audit preview.
- Adapter runner wrapper-contract preview.
- Adapter runner drain-readiness preview.
- Adapter runner service-plan preview and guarded one-shot service runner.
- Daily trading template catalog preview.
- Non-trading end-to-end rehearsal smoke.
- Paper-only trading pre-execution smoke.
- Release smoke integration for the new v2 rehearsal checks.

## 2026-07-22 Migration Closeout Addendum

The P51-P61 closeout narrows the v1/v2 overlap without deleting recovery
escape hatches:

- Retargeted approved scheduler dispatch, v2 supervisor report/closeout, Human
  Gate revision/feedback/retry/archive dispatches, `message_flow.send`,
  message-flow semantic continuation, and `meeting.disperse` fan-out dispatch
  creation to the canonical `dispatch.package.create` bridge.
- Added `dispatch.package.callsites.preview` and aligned parity/topology preview
  wording so remaining blockers are observation/removal requirements, not
  unfinished generic migration.
- Hid frozen mutating legacy actions `workflow.advance`, `workflow.supervise`,
  and the mutating `workflow.supervisor` alias from the default full-tool action
  enum while preserving read-only preview and explicitly gated escape-hatch
  behavior.
- Retired v1 meeting-room discussion write surfaces by default because existing
  v2 plan, info stack, manager/owner review, task-group package, Cat Brain
  audit, Protocol audit, notification preview, and shared Human Gate/outbox
  surfaces already cover the same multi-agent discussion/evidence class. No v2
  feature was added for this retirement.
- Added configurable governance role bindings so the structural Cat Brain and
  Cat Claw roles can be backed by configured cat members or independent runtime
  agents instead of being fixed to `main` and `cat_claw` in v2 package/supervisor
  code.
- Renamed new v2 structural state/node/status writes to role-neutral names
  (`governance_synthesis`, `protocol_audit`, `waiting_governance_review`,
  `waiting_protocol_audit`, `protocol_audited`,
  `secretary_closeout_required`, `secretary_dispatch_queued`).
- Renamed v2 governance/protocol audit action and schema surfaces to neutral
  canonical names (`workflow.v2.governance_audit.*`,
  `workflow.v2.protocol_audit.*`, `workflow_v2_governance_audits`,
  `workflow_v2_protocol_audits`, `source_protocol_audit_id`) without retaining
  old Cat Brain / Cat Claw action aliases; migration code only reads old
  table/column names to move existing rows.
- Preserved `meeting.dispatch` as the public compatibility shell during the
  observation window; `dispatch.package.create` still delegates through the
  compatibility writer until parity evidence supports removal.

Local closeout evidence:

- Release smoke run id: `final-v2-migration-closeout-local`
- Release smoke index:
  `.tmp-smoke-release/final-v2-migration-closeout-local/index.json`
- Commands covered: `check`, core smoke, v2 canary, external runner guard
  matrix, Human Gate package/request/delivery guard smoke, non-trading
  rehearsal, paper-only pre-execution, MCP smoke, and Hermes MCP smoke.
- Independent reviewer verdict: PASS; remaining low-risk follow-up is to add a
  dynamic dispatch call-site audit so the hand-maintained inventory cannot drift.

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
