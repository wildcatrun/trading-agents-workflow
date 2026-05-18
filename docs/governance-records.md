# Governance Records Policy

## Purpose

`trading-agents-workflow` is the system of record for workflow incidents, fixes, delivery failures, dispatch/receipt gaps, migration decisions, and Human Gate packages.

Agent `AGENTS.md` files are auxiliary operating instructions. They can tell agents how to behave, but they are not the primary record for plugin problems or remediation history.

## Record Placement

Problems and solutions related to this plugin must be recorded inside the plugin root:

- `governance-logs/`: incident notes, diagnosis, fixes, and follow-up decisions.
- `meetings/`, `minutes/`, `events/`, `action_items/`, `decisions/`: meeting governance artifacts.
- `bridge/dispatches/`, `receipts/`, runtime run records, and `tracking.db`: dispatch, receipt, retry, and bridge state.
- `docs/`: durable operating policy and architecture notes.

Use `AGENTS.md` only to mirror the behavioral rule that agents should follow. If a workflow issue is only recorded in an agent rule file, the record is incomplete.

## Minimum Incident Fields

Each workflow incident or operational fix should include:

- ISO timestamp and timezone.
- Affected workflow, meeting, dispatch, runtime, agent, channel, or cron id.
- Symptom and user-visible impact.
- Root cause or current best hypothesis.
- Immediate mitigation.
- Durable fix or proposed fix.
- Receipt, delivery result, or verification command.
- Follow-up owner and next update condition.

## Delivery Policy

Cat Claw (`cat_claw`) is the formal close-out reporter for meeting conclusions, Human Gate requests, and next-action packages.

By default, Cat Claw sends formal reports directly to Flashcat's Telegram private chat `8390724843`. A meeting room or live link is not required for delivery.

Telegram rooms/live links are optional coordination surfaces for multi-agent live discussion, group broadcasts, or fixed project channels. They must not block Cat Claw from reporting to Flashcat.
