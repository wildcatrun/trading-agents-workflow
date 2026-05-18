# Cat Claw Report Delivery Gap

- date: 2026-05-18
- workflow: `hermes-cron-migration-20260518`
- area: workflow supervisor, Cat Claw reporting, Telegram delivery

## Observation

The new supervisor loop successfully advanced the Hermes cron/heartbeat migration task:

- Cat Brain task `hermes-cron-migration-main-plan-v2` was dispatched to `openclaw:main`.
- Dispatch `dispatch.mpan5fhr.79016232` acked.
- The task was synced from `in_progress` to `done`.
- Checkpoint `checkpoint.mpan9k0u.6b4c17d9` was written.
- Supervisor created Cat Claw report dispatch `dispatch.mpan9k2k.90d38c7d`.
- Cat Claw dispatch acked with message `msg.mpanbfgd.31529a15`.

However, the ingested runtime payload carried `deliverySucceeded=false`. This means a successful Cat Claw runtime ack is not the same as a verified Telegram delivery to Flashcat.

## Temporary Mitigation

Codex sent a controlled fallback Telegram message through OpenClaw:

- channel: `telegram`
- account: `cat_claw`
- target: `8390724843`
- messageId: `18`

## Required Product Fix

`trading-agents-workflow` should treat secretary reporting as a two-step state machine:

1. `cat_claw_report_dispatch_acked`: Cat Claw produced a report artifact/message.
2. `cat_claw_report_delivered`: the report was delivered through Telegram/WeCom/OpenClaw IM and has a delivery receipt.

Until this exists, workflow readiness can overstate completion: the workflow may be internally acked while Flashcat has not received the Human Gate or next-action package.

## Candidate Implementation

- Add a `secretary_reports` or report-delivery ledger, or extend `telegram_outbox` with `workflow_id`, `dispatch_id`, and `report_kind`.
- When a `workflow_secretary_report` dispatch is acked, enqueue a private Telegram outbox item to Flashcat by default unless the runtime payload proves delivery.
- Add readiness findings for `cat_claw_report_acked_but_not_delivered`.
- Make `workflow.supervise` surface `catClawReport.deliveryRequired=true` when the dispatch is created.
- Keep direct `openclaw message send` as a break-glass fallback only, not the normal delivery path.
