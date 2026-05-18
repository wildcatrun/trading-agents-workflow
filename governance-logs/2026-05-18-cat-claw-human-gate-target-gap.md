# Cat Claw Human Gate Target Gap

- observed_at: 2026-05-18T14:05:00+08:00
- affected_workflow: hermes-cron-migration-20260518
- affected_agent: cat_claw
- affected_plane: Human Gate / Telegram delivery / workflow receipt

## Symptom

Cat Claw told Flashcat that Plan C had been recorded as a Human Gate and that the Telegram outbox was queued.

The workflow database showed:

- `human_gate_id`: `human-gate-record.mpasatgy.8bae80b6`
- `telegram_outbox`: `tg.mpasatho.0f6dbe2e`
- `telegram_outbox.status`: `queued`
- `telegram_outbox.target_kind`: `channel`
- `telegram_outbox.target_ref`: empty

This means the Human Gate request was recorded but did not have a valid governed IM target. A queued targetless outbox row is not proof that Flashcat received a formal Human Gate handoff.

## Cause

Two issues overlapped:

- Cat Claw did not verify `target_ref` or delivery receipt before describing the request as effectively submitted.
- `human_gate.request` ignored `notifyTargets`, did not fall back to Flashcat private Telegram by default, and let an empty channel target become a queued outbox row.

The same call also omitted `gateType`; the lower-level Human Gate record defaulted to `high_risk_trade_execution`, which overstated the request class for a governance continuation decision.

## Fix

`human_gate.request` now:

- resolves explicit `target`, `targetRef`, `chatId`, or first `notifyTargets` value
- falls back to Flashcat private Telegram `8390724843`
- defaults delivery through the `cat_claw` account
- records `workflowId` and `parentObjectId` from the meeting id when no explicit workflow is supplied
- defaults missing gate type to `workflow_continuation`
- returns `targetKind`, `targetRef`, `deliveryAccount`, and `deliveryRequired`
- optionally delivers immediately when `autoDeliver` / `deliver` is true

## Verification

Use a temp root and run:

```bash
node bin/cat-meeting-governance.mjs human-gate-request \
  --meeting target-gap-smoke \
  --text "Confirm target fallback" \
  --from catclaw \
  --root /tmp/taw-human-gate-target-gap-smoke \
  --deliver false
```

Expected output includes:

- `targetRef = "8390724843"`
- `deliveryAccount = "cat_claw"`
- `workflowId = "target-gap-smoke"`
- `gateType = "workflow_continuation"` or explicit caller value

## Follow-up

The existing row `tg.mpasatho.0f6dbe2e` should be treated as evidence of the gap, not as a delivered Human Gate request. A new, valid Human Gate request should be created only if Flashcat asks Cat Claw to continue the Plan C approval loop.
