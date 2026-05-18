# Cat Claw Action Item Runtime Gap

Timestamp: 2026-05-18T14:40:00+08:00

## Incident

Flashcat asked Codex to inspect the Cat Claw private Telegram workflow because
the visible operating surface still had a gap.

The Cat Claw direct session `agent:cat_claw:telegram:direct:8390724843`
continued Plan C at 2026-05-18T14:21:50+08:00 and wrote four
`meeting.action_item` records plus minutes. The action items looked like
progress in the secretary surface, but they did not enter the durable
`workflow_tasks` table.

## Evidence

- Session id: `c43a29c2-2a1d-4638-9bce-dbd133d6b646`
- At 2026-05-18T06:22:02Z through 2026-05-18T06:22:32Z Cat Claw called:
  - `meeting.action_item` for `plan-c-gap-1-secretary-delivery-auth`
  - `meeting.action_item` for `plan-c-gap-2-route-mismatch`
  - `meeting.action_item` for `plan-c-gap-3-hermes-openclaw-boundary`
  - `meeting.action_item` for `plan-c-gap-4-readiness-queued-dispatch`
  - `meeting.minutes`
- Those records were appended to
  `action_items/hermes-cron-migration-20260518.items.jsonl`.
- Before the fix, `workflow_tasks` had only two tasks for
  `hermes-cron-migration-20260518`; the four Plan C gap items were absent.
- The four new items used the legacy owner id `catclaw` instead of canonical
  `cat_claw`.
- Readiness remained degraded with stale queued dispatches and recent runtime
  failures, so the lack of durable tasks reduced the supervisor's ability to
  reconcile work.

## Root Cause

`meeting.action_item` was still a meeting-protocol JSONL helper. It did not
mirror secretary tasks into the workflow task graph. As a result, Cat Claw
could truthfully say it created action items while `workflow.advance` and
`workflow.supervise` could not see, dispatch, receipt, or close those items.

The action item path also did not normalize the old `catclaw` id, so the UI
could split the same secretary role across `catclaw` and `cat_claw`.

## Durable Fix

`meeting.action_item` now mirrors creates and updates into `workflow_tasks` by
default.

Rules:

1. `catclaw` is normalized to `cat_claw`.
2. Comma-separated owners are split into one workflow task per owner.
3. Common migrated agents default to `hermes_acp`; `main` and `cat_claw`
   default to `openclaw`.
4. Action item status is mapped to workflow task status.
5. Repeated updates update the existing mirrored workflow task instead of
   creating duplicates.
6. Agents can opt out only by setting `promoteToWorkflowTask=false`.

## Verification

Local syntax check:

```bash
npm run check
```

Local smoke root:

```bash
node bin/cat-meeting-governance.mjs action-item catclaw-actionitem-smoke \
  --id plan-c-gap-1 \
  --title "Check secretary delivery" \
  --owner catclaw \
  --status open \
  --required-artifact "route evidence" \
  --root /private/tmp/taw-catclaw-actionitem-smoke-20260518
```

Smoke result:

- `owner_agent=cat_claw`
- `runtime=openclaw`
- mirrored task id:
  `action-catclaw-actionitem-smoke-plan-c-gap-1`

Multi-owner smoke:

- owner `cat_ears,cat_nose` created two `workflow_tasks`
- both defaulted to `runtime=hermes_acp`

## Follow-Up

Deploy the plugin update to the development server, run the same smoke there,
then restart Gateway only after config validation and rollback confirmation.
