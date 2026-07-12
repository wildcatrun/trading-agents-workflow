# Workflow Smoke Capture

`scripts/workflow_smoke_capture.mjs` runs the release smoke set and writes auditable stdout/stderr logs, exit codes, hashes, and an index file.

Default command set:

- `npm run check`
- `npm run smoke`
- `npm run smoke:v2-canary`
- `npm run smoke:mcp`
- `npm run smoke:hermes-mcp`

Run locally:

```sh
npm run smoke:release
```

By default, output is written under `.tmp-smoke-release/<run-id>/`, which is ignored by Git.

Run with an explicit artifact directory:

```sh
node scripts/workflow_smoke_capture.mjs \
  --out /home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/<run>/smoke \
  --run-id 20260713T010000
```

Useful options:

- `--commands check,smoke:v2-canary` to run a subset.
- `--skip smoke:mcp` to omit one default command.
- `--timeout-ms 600000` to control per-command timeout.
- `--fail-fast true` to stop after the first failing command.

Artifacts:

- `index.json`: compact release evidence and per-command log paths/hashes.
- `smoke-results.json`: full structured result payload.
- `logs/*.stdout.log` and `logs/*.stderr.log`: raw command output.

The capture runner does not deploy, restart Gateway, mutate production workflow state, or refresh OpenClaw plugin metadata. It only runs the selected package scripts from the chosen checkout.
