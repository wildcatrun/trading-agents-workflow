# Human Gate Inbox / Console

`human_gate.inbox` and alias `human_gate.console` are the plugin-native batching and operation-console surface for Flashcat approvals in complex cat-system workflows. They give Cat Claw a structured secretary view instead of forcing Flashcat to process a long stream of one-off Telegram requests.

## Scope

The inbox gathers:

- pending `human_gate_record` protocol objects
- pending or Human-Gate-required `review_gates`
- open `workflow_tasks` with `human_gate_required=1`
- queued or failed Cat Claw report deliveries from `telegram_outbox`
- recorded `human_gate_buttons` for pending Human Gate records

It writes durable rows to `human_gate_batches` and `human_gate_batch_items`, then creates paired HTML and JSON artifacts under `human-gates/inbox/`.

When a pending Human Gate has mutually exclusive choices, the HTML console renders the exact buttons from `human_gate_buttons`: label, decision status, `tawhg:<token>`, artifact pointer, and callback command. Telegram inline buttons and the HTML console read the same button rows. Agents must not infer Flashcat's choice from natural-language replies when these buttons exist.

## Risk Handling

The inbox is a review surface, not an approval executor.

- `P0`: live trading, production cutover, database migration, secret/OAuth/permission expansion, or real-money risk. Individual approval only.
- `P1`: runtime migration, Gateway/config/model route, cron/heartbeat, trade/order/risk-budget or incident-sensitive work. Individual approval only.
- `P2`: governance, workflow automation, dry-run, observability, report or制度 changes. Batchable after quick review.
- `P3`: low-risk housekeeping. Batchable after quick review.

Batch generation never calls `human_gate.resume`, never executes trades, and never marks work approved. Flashcat decisions must still be recorded through an exact button callback or `human_gate.resume` so cat-brain `main` can continue from a durable Human Gate boundary.

## CLI

```bash
node bin/cat-meeting-governance.mjs human-gate-inbox \
  --workflow demo-initiative \
  --batch demo-inbox \
  --title "Demo Human Gate Inbox" \
  --target 8390724843 \
  --root "$ROOT"
```

Console alias:

```bash
node bin/cat-meeting-governance.mjs human-gate-console \
  --workflow demo-initiative \
  --batch demo-console \
  --title "Flashcat Human Gate Console" \
  --target 8390724843 \
  --root "$ROOT"
```

Button callback from the console:

```bash
node bin/cat-meeting-governance.mjs human-gate-callback \
  --token CALLBACK_TOKEN \
  --actor flashcat \
  --root "$ROOT"
```

The returned `telegramSummary` is suitable for Cat Claw to send as the short notification. The HTML artifact is the full table for scanning, button-token review, and controlled callback selection.
