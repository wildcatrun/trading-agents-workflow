# Trading Agents Workflow Governance Logs

Created: 2026-05-17T18:06:00+08:00

This directory stores queryable governance logs written by cat brain `main` cron tasks.

The logs are part of the unified `multi-agent-hedge-fund-framework` asset tree. They are not OpenClaw workspace-only scratch files.

## Files

- `main-heartbeat-readiness.jsonl`
  - Written by `main heartbeat`.
  - Frequency: every 30 minutes.
  - Purpose: lightweight workflow readiness trace.
- `main-4h-workflow-governance.jsonl`
  - Written by `main 4h-report`.
  - Frequency: every 4 hours.
  - Purpose: active readiness, incident, repair and escalation trace.
- `main-daily-governance.jsonl`
  - Written by `main daily governance report`.
  - Frequency: daily 07:00 Asia/Shanghai.
  - Purpose: 24-hour cat-system workflow governance summary.

## Minimum JSONL Fields

Each line should be a single JSON object with these fields when available:

```json
{
  "timestamp": "2026-05-17T18:06:00+08:00",
  "timestamp_utc": "2026-05-17T10:06:00.000Z",
  "job": "main heartbeat",
  "agent_id": "main",
  "scope": "workflow_governance",
  "readiness_status": "ready",
  "snapshot_id": "readiness.example",
  "gateway_status": "ok",
  "hermes_acp_status": "ok",
  "dispatch": {
    "queued": 0,
    "failed": 0,
    "stale": 0
  },
  "human_gate": {
    "pending": 0,
    "stale": 0
  },
  "incidents": {
    "open": 0,
    "updated": []
  },
  "side_effects": {
    "failed": 0,
    "uncertain": 0
  },
  "findings": [],
  "recommended_action": "none"
}
```

Unknown fields should be written as `null` or `"unknown"`, not omitted when the field is important for later diagnosis.

## Rules

- Every line must include a timestamp.
- Do not overwrite log files; append only.
- Do not write secrets, OAuth tokens, account credentials, private keys or raw trading account data.
- A successful process or cron exit is not enough; write workflow readiness and evidence summaries.
- If evidence is incomplete, write `"readiness_status": "unknown"` and include a finding explaining the missing evidence.
