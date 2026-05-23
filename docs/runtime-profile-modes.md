# Runtime Profile Mode Evidence

`trading-agents-workflow` may consume runtime profile mode evidence from `cat-agents-stabilityd`, but that evidence is advisory readiness input for workflow. Stabilityd may separately use the same registry-derived profile-mode state as a policy-gated external repair input.

This is not a workflow-owned process manager and not a second lifecycle platform. Cat-system members run in OpenClaw, Hermers/Hermes, Codex, or another registered runtime. Runtime residency, local cron, Telegram ingress, queue consumption, and process management belong to the owning runtime platform.

## Registry First

Every agent-related workflow decision starts from `runtime_agents`.

`runtime_agents` is the workflow source of truth for cat-system identity, platform, execution adapter, IM ingress, workflow ingress, dispatch eligibility, endpoint reference, and audit context. Platform-specific probes can inspect Hermers profiles, OpenClaw agents, Codex sessions, systemd units, or local files only after the target member set has been selected from the registry.

For Hermers/Hermes observations, the expected source is an active registry row with:

- `platform=hermers`
- `workflow_ingress_adapter=acp` or another explicit adapter
- `endpoint_ref` pointing to the runtime-owned profile or endpoint
- dispatch eligibility fields that allow workflow work

Legacy fields such as `runtime=hermers`, `runtime=hermes`, or `runtime=hermes_acp` can be treated as migration compatibility signals, but they must not replace the global registry contract.

## Evidence Source

The workflow plugin can read the latest stabilityd mode file:

```text
/home/flashcat/.openclaw/stability/hermers-profile-modes.json
```

The path can be overridden with:

- action input: `hermersProfileModesPath`, `stabilityProfileModesPath`
- environment: `TRADING_AGENTS_WORKFLOW_PROFILE_MODES_PATH`, `CAT_AGENTS_STABILITY_PROFILE_MODES_PATH`, `OPENCLAW_STABILITY_PROFILE_MODES_PATH`

Missing or malformed files do not block workflow operation. They are readiness observations because stabilityd can be unavailable during deployment or recovery.

## Mode Semantics

Mode values describe workflow readiness. Service start/stop authority belongs to stabilityd's external repair policy, not to workflow.

- `hot`: active runtime work or active profile work is observed.
- `warm`: the runtime endpoint is expected active and no cold/hibernate observation is present.
- `cold`: low-confidence observation that the endpoint appears idle beyond a threshold.
- `hibernate`: low-confidence observation that the endpoint appears idle beyond a longer threshold, or that the owning runtime reports it as hibernated.

Workflow must not treat `cold` or `hibernate` as proof that an agent has no Telegram ingress, profile-local cron, runtime-owned queue work, or direct operator request. Workflow also must not start Hermers services, stop Hermers services, rewrite profile config, or convert profile mode evidence into a cat-system lifecycle policy. Stabilityd may stop/start only through its own gates: registry-derived target, managed profile, protected-member exclusion, no active work evidence, runtime-owned `safeToHibernate=true` before stop, action cooldown, action ledger, and rollback evidence.

## Runtime Bridge Admission

`runtime.bridge.drain` must resolve queued work through `runtime_agents` before applying any platform-specific evidence:

1. Resolve target agent identity, platform, workflow ingress adapter, endpoint reference, and dispatch eligibility from `runtime_agents`.
2. Load platform adapter evidence, such as Hermers profile observations, only for the resolved endpoint.
3. If evidence says the endpoint is not ready, keep the dispatch durable and record readiness evidence.
4. If registry evidence is incomplete or stale, fail closed with a receipt; do not invent success from platform-local evidence.
5. If allowed, claim the dispatch and execute the registered runtime adapter path.

This preserves durable execution semantics: no runtime run is recorded unless the bridge actually attempts runtime execution.

## Readiness And Registry Output

`workflow.readiness` may include `planes.runtime.hermersProfileModes` and related adapter evidence. These fields are read-only scheduling evidence and do not alter the registry schema.

`workflow.runtime_agents` and `workflow.topology` may decorate registry rows with adapter observations such as:

- `profile`
- `profileMode`
- `profileActiveWork`
- `profileAdmissionReason`
- `profileRegistrySource`

Do not expose or rely on Hermers-only `managedProfiles` or `protectedProfiles` as cat-system governance policy. Protection, dispatch eligibility, and ownership must be expressed in `runtime_agents` and runtime-specific policy, not in a platform-local profile list.

## Stability Boundary

The workflow control loop should keep making mechanical progress: readiness snapshot, dispatch/receipt sync, runtime drain, stale-dispatch reconcile, checkpointing, Telegram outbox delivery, and Human Gate inbox/outbox maintenance.

It must not become an agent runtime, a Hermers profile manager, an OpenClaw Gateway replacement, a Codex session manager, or a production execution engine. If a resource-pressure incident requires runtime residency changes, workflow records durable evidence and receipts; `cat-agents-stabilityd.service` is the external repair layer that may execute policy-gated profile lifecycle, cron/session/worker repair, or Gateway restart when runtime self-repair is unreliable. Cat Brain interprets the evidence, handles semantic incident command, and escalates Human Gate when the repair crosses authority boundaries.
