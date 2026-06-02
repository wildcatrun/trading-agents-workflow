# Development Log: OpenClaw Stable Upgrade Impact

Date: 2026-06-02

This log records the OpenClaw stable-version upgrade audit and the resulting
small compatibility change for `trading-agents-workflow`.

## Trigger

Flashcat asked whether the local OpenClaw stable upgrade documentation affects
`cat-agents-stabilityd` and the `trading-agents-workflow` plugin, and whether
they should be adjusted in sync.

## Official Reference Checked

- OpenClaw Updating:
  `https://docs.openclaw.ai/install/updating`
- OpenClaw Update CLI:
  `https://docs.openclaw.ai/cli/update`
- OpenClaw Doctor CLI:
  `https://docs.openclaw.ai/cli/doctor`
- OpenClaw Release channels:
  `https://docs.openclaw.ai/install/development-channels`
- OpenClaw Plugin manifest:
  `https://docs.openclaw.ai/plugins/manifest`
- OpenClaw Plugin SDK migration:
  `https://docs.openclaw.ai/plugins/sdk-migration`

## Reference Summary

The official stable upgrade path prefers `openclaw update`. It detects the
install type, fetches the selected channel, runs doctor, syncs managed plugins,
and coordinates Gateway restart for supervised installs. `stable` maps to npm
`latest`; `beta` maps to npm `beta` when current; `dev` tracks the moving
GitHub `main` checkout and should not be used for production gateways.

For automation, `openclaw doctor --lint --json` is the read-only diagnostic
surface. It reports findings without rewriting config or state. `doctor --fix`
and `--repair` may mutate state and should be run only after reviewing the
specific findings and backing up the OpenClaw config/state that may be changed.

Native OpenClaw plugins must provide `openclaw.plugin.json`. The manifest must
be cheap to inspect and is used for validation before runtime behavior is
loaded. Plugin runtime behavior should use documented SDK entry points instead
of deprecated broad compatibility imports.

## Local And Development Server State

- Local Mac OpenClaw: `2026.5.28 (e932160)`.
- Development server OpenClaw: `2026.5.28 (e932160)`.
- Local Mac Gateway is not running; local ports `23467` and `18791` are SSH
  tunnels to the development server.
- Development server `openclaw doctor --lint --severity-min error --json`
  returned `ok:true` with no error-level findings.
- Development server `npm run check` passed in the active
  `trading-agents-workflow` checkout.
- `cat-agents-stabilityd status` reported warning/degraded, but findings were
  Hermers `runtime_agents.endpoint_ref` readiness issues, not OpenClaw upgrade
  or Gateway/plugin load failures.

## Operational Change

The development server had `update.channel` set to `beta`, while the intended
operating posture is stable. The config was backed up and `update.channel` was
set to `stable`.

Evidence directory:

`/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260602T200048+0800-openclaw-stable-channel-audit`

Recorded evidence:

- `backups/openclaw.json.before-stable-channel`
- `logs/update.before.json`
- `logs/update.after.json`
- `logs/config-validate.txt`

No Gateway restart was performed. OpenClaw printed that a restart is needed to
apply the channel config to a running Gateway, but the change only governs
future update selection and does not require an immediate runtime restart.

## Workflow Plugin Compatibility Change

OpenClaw 2026.5.28 loads the plugin during diagnostic commands such as
`doctor --lint`. Before this change, `trading-agents-workflow` could register
and announce its control loop during those diagnostics. That is undesirable:
doctor, update status, config validation, and plugin inspection should be
low-impact checks and must not start background workflow advancement loops.

Implemented change:

- Expanded diagnostic-process detection in `index.js`.
- `registerControlLoop` now skips control-loop startup during OpenClaw doctor,
  update, config validation, status/health, and plugin list/info/inspect/doctor
  processes.

This does not disable the control loop for the real Gateway process. Gateway
runtime startup still registers the control loop when `controlLoop.enabled` is
configured.

## Stabilityd Impact

No stabilityd code change is required from this OpenClaw stable upgrade. The
stability plane watches server-side Gateway/systemd/cron/session/workflow and
Hermers evidence; the local Mac OpenClaw package version does not affect it.

The upgrade runbook should include stabilityd checks after any server-side
OpenClaw upgrade:

- `cat-agents-stability status`
- `cat-agents-stability findings`
- Gateway liveness/readiness checks
- workflow receipt/readiness checks

If future OpenClaw releases change CLI JSON output used by stabilityd, that
should be treated as an adapter compatibility task, not as a reason to reduce
stabilityd authority.

## Follow-Up Checklist

For future stable upgrades:

1. Confirm target channel and version:
   `openclaw update status --json`, `npm view openclaw version dist-tags`.
2. Backup OpenClaw config before config or update-channel changes.
3. Prefer `openclaw update --dry-run --json` before applying.
4. After upgrade, run:
   `openclaw --version`, `openclaw config validate`,
   `openclaw doctor --lint --severity-min error --json`,
   `openclaw plugins list --json`.
5. In the workflow checkout, run `npm run check`.
6. Check `cat-agents-stability status` and `findings`.
7. Do not run `openclaw doctor --fix` until each reported mutation is reviewed
   with a backup and rollback path.

