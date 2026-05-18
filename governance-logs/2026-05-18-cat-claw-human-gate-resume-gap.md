# Cat Claw Human Gate Resume Gap

Timestamp: 2026-05-18T12:00:00+08:00

## Incident

Flashcat confirmed Plan C in the Cat Claw private Telegram session at
2026-05-18T11:51:39+08:00:

> Follow Plan C: expose workflow problems, preserve failure evidence, and keep improving the cat-system workflow instead of hiding early instability.

Cat Claw acknowledged the message in chat, but did not write the decision back
to `trading-agents-workflow`.

## Evidence

- OpenClaw session: `agent:cat_claw:telegram:direct:8390724843`
- Session id: `c43a29c2-2a1d-4638-9bce-dbd133d6b646`
- User message id: Telegram `20`
- Cat Claw trajectory for that run:
  - `didSendViaMessagingTool=false`
  - `toolMetas=[]`
  - no `trading_agents_workflow` call
- Workflow database before repair:
  - no `human_gate_resume` dispatch for `hermes-cron-migration-20260518`
  - no review gate decision row for `hermes-cron-migration-20260518`

## Root Cause

Cat Claw treated Flashcat's Human Gate decision as a normal chat reply. The
agent summarized the exposed problems but did not invoke the governed workflow
resume path.

The earlier WeCom `errcode 850002` failure was a communication-channel defect,
but it was not the blocking cause for workflow continuation. The blocking cause
was missing Human Gate resume persistence and missing dispatch back to cat-brain
`main`.

## Repair Performed

The Human Gate decision was backfilled with:

```bash
node bin/cat-meeting-governance.mjs human-gate-resume \
  --workflow hermes-cron-migration-20260518 \
  --meeting hermes-cron-migration-20260518 \
  --status approved \
  --text "Flashcat approved Plan C at 2026-05-18T11:51:39+08:00: expose workflow problems, preserve failure evidence, and continue improving trading-agents-workflow observability; do not prematurely optimize for stability over learning at this early stage." \
  --root /home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow
```

Created records:

- Human Gate record: `human-gate-record.mpaoepxl.0620074c`
- Meeting resume event: `control.mpaoepyd.80f3799d`
- Resume dispatch: `dispatch.mpaoepze.7ccd2d07`
- Cat-brain run id after bridge drain: `b5c659e0-a6e2-44cb-a4e4-e66355c4b9dc`
- Runtime bridge result: `acked`

## Governance Rule

When Flashcat approves, rejects, or selects an option for a Human Gate in
Telegram private chat, Cat Claw must not stop at a natural-language reply.

Required sequence:

1. Record the decision through `human_gate.resume`.
2. Preserve the original timestamp, chat id, message id, and Flashcat text in
   the resume text or payload.
3. Confirm that the generated `human_gate_resume` dispatch targets cat-brain
   `main`.
4. Drain or schedule the OpenClaw bridge so `main` receives the continuation.
5. Report only after the workflow resume event and dispatch id are known.

