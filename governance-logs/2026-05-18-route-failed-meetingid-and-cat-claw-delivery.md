# 2026-05-18 Route Failed MeetingId And Cat Claw Delivery

- timestamp: 2026-05-18T10:00:00+08:00
- meeting_id: hermes-cron-migration-20260518
- affected_agents: cat_ears, cat_nose, cat_claw, main
- affected_runtime: openclaw_route_shell, hermes_acp
- affected_channel: telegram

## Symptoms

- Cat Ears and Cat Nose reported `route_failed`, including missing `meetingId`, `meeting not found`, or unavailable workflow dispatch path.
- The Cat Nose heartbeat eventually created a Hermes ACP dispatch after route parameters were added, but queued dispatches still required runtime bridge draining.
- Cat Claw generated a `Hermes cron/heartbeat` migration status report, but the agent turn returned `deliverySucceeded=false`.

## Diagnosis

- Several migrated Hermes agents still had professional heartbeat/report cron jobs running as OpenClaw route-shell `agentTurn` jobs.
- Those OpenClaw cron prompts did not consistently carry a workflow route envelope with `meetingId`, `workflowId`, runtime, and agent id.
- `trading-agents-workflow` had Hermes ACP dispatch records, but OpenClaw route-shell delivery and Hermes bridge draining were not yet a complete durable execution loop.
- The Cat Claw report did not deliver because the meeting had no fixed `telegram_target` / live link. Flashcat clarified that this should not block Cat Claw reports.

## Immediate Mitigation

- Added route envelope to the affected OpenClaw cron prompts:
  - `cat_ears heartbeat`: `58003b66-32ca-4c06-bc74-a1db2a1ebdf7`
  - `cat_nose heartbeat`: `83c4259f-a869-47af-9c6c-73edb7b687cb`
  - `a-share-morning-brief`: `584816ff-6912-4698-b539-720b74a3095c`
- Ran Hermes ACP runtime bridge once for the stale queued Cat Ears dispatch. Workflow readiness returned to `ready` after stale queued count cleared.
- Created workflow/meeting `hermes-cron-migration-20260518` to track the broader migration of OpenClaw cron/heartbeat tasks into Hermes.
- Asked Cat Claw to issue a status report and update minutes.
- Manually delivered Cat Claw v0.1 status report through Telegram account `cat_claw` to Flashcat chat `8390724843`; Telegram returned `ok=true`, `messageId=10`.

## Durable Policy Decision

Flashcat clarified:

- Cat Claw formal reports, meeting conclusions, confirmation requests, and Human Gate packages should default to Flashcat Telegram private chat `8390724843`.
- A meeting room or Telegram live link is not required for Cat Claw delivery.
- Meeting rooms/live links are only needed for multi-agent live discussion, group broadcast, or fixed project channels.
- Problems and solutions related to `trading-agents-workflow` must be recorded inside the plugin root. `AGENTS.md` is auxiliary and must not be the primary issue record.

## Follow-Up

- Migrate professional cron/heartbeat tasks for the six Hermes-migrated agents out of OpenClaw route-shell execution and into Hermes execution where appropriate.
- Add or operate a governed runtime bridge drain loop for queued Hermes ACP dispatches.
- Keep future workflow issues and fixes in `governance-logs/`, meeting artifacts, receipts, and plugin docs first; mirror only behavioral rules to agent `AGENTS.md` files.
