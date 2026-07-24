# P63 Meeting Dispatch Observation Audit

Date: 2026-07-24
Scope: `meeting.dispatch`, `dispatch.package.create`, and the shared
`mixed_meeting_dispatches` ledger.

## Decision

`meeting.dispatch` is not freeze-ready, but it no longer belongs in the broad
`legacy_active` bucket.

The correct current class is `compatibility_writer_observation`:

- new callers should use `dispatch.package.create`;
- `dispatch.package.create` still delegates to the registered compatibility
  writer and shared dispatch ledger;
- the compatibility writer stays callable while the observation/removal window
  proves whether public callers remain;
- runtime bridge, receipt, stale reconcile, message_flow linkage, readiness, and
  console read models continue to depend on `mixed_meeting_dispatches`.

## Dev-Server Live Evidence

Command:

```bash
sqlite3 /home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db \
  "SELECT status, runtime, COUNT(*) FROM mixed_meeting_dispatches GROUP BY status, runtime ORDER BY status, runtime;"
```

Observed rows:

```text
acked|openclaw|514
failed|openclaw|148
failed|other|1
```

There were no queued, sent, runtime_dispatched, running, or delivering rows in
the live dispatch ledger during this audit.

Command:

```bash
sqlite3 /home/flashcat/multi-agent-hedge-fund-framework/trading-agents-workflow/workflow_control_plane.db \
  "SELECT action, status, COUNT(*) FROM workflow_operations WHERE action IN ('meeting.dispatch','dispatch.package.create','workflow.dispatch.package.create') GROUP BY action, status ORDER BY action, status;"
```

Observed rows: none.

## Code Evidence

- `src/meeting-dispatch-actions.js` registers both `dispatch.package.create` and
  `meeting.dispatch`.
- `dispatch.package.create` is the canonical surface, but it intentionally wraps
  and delegates to the compatibility writer during cutover.
- Dispatch package call-site, parity, schema, and topology previews already
  report the remaining blocker: the public `meeting.dispatch` compatibility
  shell is still registered and the canonical create path still delegates to it.

## Guardrail

This audit supports metadata closeout only. It does not approve freezing or
deleting `meeting.dispatch`.

Observation labels are policy metadata. Existing migration telemetry stores
`next_state` from `decisionClass`, so `meeting.dispatch` can still appear as
`must_migrate` in telemetry while its policy `migrationStatus` is
`compatibility_writer_observation`.

Freeze remains blocked until:

- the observation window shows no public compatibility caller;
- `dispatch.package.create` no longer delegates to `meeting.dispatch`;
- runtime bridge, receipt, stale reconcile, and message_flow parity remain
  stable after that delegate removal;
- release smoke and server postchecks pass after the replacement change.
