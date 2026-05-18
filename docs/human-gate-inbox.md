# Human Gate Inbox

`human_gate.inbox` is the plugin-native batching surface for Flashcat approvals in complex cat-system workflows. It gives Cat Claw a structured secretary view instead of forcing Flashcat to process a long stream of one-off Telegram requests.

## Scope

The inbox gathers:

- pending `human_gate_record` protocol objects
- pending or Human-Gate-required `review_gates`
- open `workflow_tasks` with `human_gate_required=1`
- queued or failed Cat Claw report deliveries from `telegram_outbox`

It writes durable rows to `human_gate_batches` and `human_gate_batch_items`, then creates paired HTML and JSON artifacts under `human-gates/inbox/`.

## Risk Handling

The inbox is a review surface, not an approval executor.

- `P0`: live trading, production cutover, database migration, secret/OAuth/permission expansion, or real-money risk. Individual approval only.
- `P1`: runtime migration, Gateway/config/model route, cron/heartbeat, trade/order/risk-budget or incident-sensitive work. Individual approval only.
- `P2`: governance, workflow automation, dry-run, observability, report or制度 changes. Batchable after quick review.
- `P3`: low-risk housekeeping. Batchable after quick review.

Batch generation never calls `human_gate.resume`, never executes trades, and never marks work approved. Flashcat decisions must still be recorded with `human_gate.resume` so cat-brain `main` can continue from a durable Human Gate boundary.

## CLI

```bash
node bin/cat-meeting-governance.mjs human-gate-inbox \
  --workflow demo-initiative \
  --batch demo-inbox \
  --title "Demo Human Gate Inbox" \
  --target 8390724843 \
  --root "$ROOT"
```

The returned `telegramSummary` is suitable for Cat Claw to send as the short notification. The HTML artifact is the full table for scanning and manual review.
