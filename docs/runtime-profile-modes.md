# Runtime Profile Modes

`trading-agents-workflow` consumes Hermers profile mode evidence from `cat-agents-stabilityd` so the workflow queue can avoid waking low-priority runtime work when the server is under pressure.

This is a workflow admission feature, not a second process manager. `cat-agents-stabilityd` owns profile mode detection and service start/stop. `trading-agents-workflow` owns dispatch state, control-loop jobs, readiness evidence, and runtime bridge execution.

## Evidence Source

The workflow plugin reads the latest stabilityd mode file:

```text
/home/flashcat/.openclaw/stability/hermers-profile-modes.json
```

The path can be overridden with:

- action input: `hermersProfileModesPath`, `stabilityProfileModesPath`
- environment: `TRADING_AGENTS_WORKFLOW_PROFILE_MODES_PATH`, `CAT_AGENTS_STABILITY_PROFILE_MODES_PATH`, `OPENCLAW_STABILITY_PROFILE_MODES_PATH`

Missing or malformed files do not block workflow operation. They are reported as readiness observations because stabilityd can be temporarily unavailable during deployment or recovery.

## Mode Semantics

`hot` and `warm` profiles are eligible for normal runtime bridge dispatch.

`cold` profiles stay registered but should not receive optional low/normal-priority runtime work. The bridge still allows `flash`, `steer`, and `high` priority dispatches so urgent or operator-steered work is not hidden behind resource policy.

`hibernate` profiles are not executed by the runtime bridge by default. The queued dispatch remains durable and receives a future `next_retry_at`; it is not marked `sent`, so stale-dispatch reconciliation will not misclassify it as a runtime failure. A reviewed operator override may allow explicit wake behavior later, but workflow does not directly start Hermers services.

Protected profiles such as `main`, `cat_claw`, `cat_heart`, and active development profiles remain hot or governed by stabilityd policy. Workflow only reads the resulting mode evidence.

## Runtime Bridge Admission

`runtime.bridge.drain` applies profile admission before claiming a queued Hermers dispatch:

1. Resolve the Hermers profile from `endpoint_ref` or `agent_id`.
2. Read the stabilityd profile mode snapshot.
3. Decide whether the dispatch can run now.
4. If blocked, keep status `queued`, set `next_retry_at`, and append bridge evidence.
5. If allowed, claim the dispatch and execute the existing ACP/CLI adapter path.

This preserves durable execution semantics: no runtime run is recorded unless the bridge actually attempts runtime execution.

## Readiness And Registry Output

`workflow.readiness` includes `planes.runtime.hermersProfileModes` and emits warnings when queued dispatches target profiles that are currently cold-blocked or hibernated.

`workflow.runtime_agents` and `workflow.topology` decorate Hermers registry rows with profile mode fields when the stability evidence is available:

- `profile`
- `profileMode`
- `profileExpectedActive`
- `profileManaged`
- `profileProtected`
- `profileActiveWork`
- `profileAdmissionReason`

These fields are read-only scheduling evidence. They do not alter the runtime registry schema.

## Control Loop Pressure Goal

The short-cycle control loop should keep making mechanical progress without repeatedly waking low-value work. Profile-mode admission is intended to release roughly 10%-15% memory pressure by letting idle professional profiles remain cold or hibernated while core governance roles stay available.

The current target is conservative:

- no soft memory boundary inside workflow
- no Node heap cap inside workflow
- no direct systemd operation inside workflow
- runtime jobs remain bounded by existing `runtimeLimit`
- admission keeps blocked dispatches queued instead of converting them to runtime failures

Future session-store work can make this stronger by resuming hibernated profiles from compact session packs instead of keeping full long-context workers resident.
