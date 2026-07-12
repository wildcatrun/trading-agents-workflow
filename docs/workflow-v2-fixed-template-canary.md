# Workflow v2 Fixed-Template Canary

`scripts/workflow_v2_fixed_template_canary.mjs` verifies the production-shaped workflow v2 fixed-template path without dispatching runtime work or delivering external messages.

The canary exercises:

- `workflow.template.preview`
- `workflow.template.record_candidate`
- `workflow.template.eval`
- `workflow.template.promote` to `active`
- `workflow.template.instantiate.preview`
- `workflow.template.instantiate`
- `workflow.v2.validate`
- `workflow.template.get`
- `workflow.status`

It then checks that the plan row, two plan nodes, and canonical plan artifact exist. It also verifies zero matching side effects in runtime runs, message flows, Telegram outbox, side-effect ledger, and executable trade intents.

## Default Smoke

The package smoke runs in a temporary root and does not touch production state:

```sh
npm run smoke:v2-canary
```

## Persistent Root

Writing to a non-temp workflow root is blocked unless explicitly allowed:

```sh
node scripts/workflow_v2_fixed_template_canary.mjs \
  --root /home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow \
  --allow-persistent-root \
  --backup-dir /home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/<run>/backups \
  --out /home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/<run>/canary \
  --run-id 20260713T002200
```

For persistent roots, the canary retires the template after the plan has been materialized by default. Pass `--retire-after false` only when the active canary template should remain in the registry for follow-up inspection.

The script writes one JSON file per action plus `summary.json` into `--out`.
