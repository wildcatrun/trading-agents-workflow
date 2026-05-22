# Workflow Session Store Development Notes

`workflow_session_packs` and `workflow_session_runs` are the first workflow-native
context externalization layer. The goal is to let the workflow prepare a small,
task-specific brain pack for repeatable worker execution without replaying full
long-term chat history.

This is not a replacement for `workflow_runs`, `workflow_tasks`,
`workflow_checkpoints`, receipts, Human Gate records, or artifacts. It is a
controlled context packaging layer that points workers at those durable records.

## Problem

Long-running agent systems tend to keep too much context inside live model
sessions. That increases token cost, memory pressure, session fragility, and
retry ambiguity. For cat-system workflows, this becomes especially risky when
cron pressure, Human Gate waits, runtime bridge work, and future full-state
trading workflows run at the same time.

The session store moves reusable context out of the live process:

- Store compact task context in SQLite.
- Keep long history as referenced artifacts/checkpoints, not inline text.
- Create worker input from the session pack only when a worker is needed.
- Resume or retry from durable records instead of keeping pending workers alive.

## Data Model

### `workflow_session_packs`

A session pack is a reusable task context template.

Key fields:

- `session_id`: stable pack id.
- `version`: monotonic pack version. Identical retry does not bump version.
- `status`: `draft`, `active`, `disabled`, or `archived`.
- `owner_agent`: owning agent or governance role.
- `task_type`: repeatable task category, for example `trading_core_contract_smoke`.
- `runtime_target`: intended worker/runtime hint, for example `worker:local_codex`.
- `purpose`: concise reason this pack exists.
- `system_brief`: worker-facing operating brief.
- `working_context_json`: small current context object.
- `tool_policy_json`: allowed and forbidden tool/action policy.
- `input_schema_json` / `output_schema_json`: structured IO contract hints.
- `evidence_refs_json`: artifact or evidence references to load on demand.
- `checkpoint_refs_json`: checkpoint references to restore from on demand.
- `resource_budget_json`: token/time/work budget hints.
- `metadata_json`: non-critical metadata.
- `pack_hash`: content hash used for idempotent upsert.

Sensitive object keys such as token, secret, password, credential, apiKey,
accessKey, refreshKey, privateKey, callbackData, and callbackToken are redacted
before persistence.

### `workflow_session_runs`

A session run is one worker invocation prepared from a pack.

Key fields:

- `run_id`: stable run id / idempotency key.
- `session_id`: source pack id.
- `pack_version`: pack version used to build `worker_input_json`.
- `workflow_id`, `task_id`, `worker_id`: optional workflow binding.
- `status`: `queued`, `running`, `completed`, `failed`, or `cancelled`.
- `input_json`: per-run input.
- `worker_input_json`: exact worker input generated from the pack and run input.
- `output_json`: structured worker result.
- `receipt_ref`: receipt or artifact pointer.
- `error`: failure message.
- `started_at`, `completed_at`, `created_at`, `updated_at`: audit timestamps.

## Worker Input Contract

`workflow.session_run.start` builds a worker input object with:

```json
{
  "schemaVersion": 1,
  "objectType": "workflow_session_worker_input",
  "sessionId": "session-pack-contract-smoke",
  "sessionVersion": 2,
  "packHash": "...",
  "purpose": "...",
  "ownerAgent": "cat_body",
  "taskType": "trading_core_contract_smoke",
  "runtimeTarget": "worker:local_codex",
  "systemBrief": "...",
  "workingContext": {},
  "toolPolicy": {},
  "inputSchema": {},
  "outputSchema": {},
  "evidenceRefs": [],
  "checkpointRefs": [],
  "resourceBudget": {},
  "input": {},
  "context": {
    "workflowId": "...",
    "taskId": "...",
    "traceId": "...",
    "dispatchId": "..."
  },
  "instructions": {
    "loadOnlyReferencedArtifacts": true,
    "doNotInferMissingHumanApproval": true,
    "writeStructuredOutputOnly": true
  }
}
```

Workers should treat this object as the full task handoff. They should load only
the referenced artifacts/checkpoints that are required for the task and should
write a structured result plus receipt/artifact reference.

## Actions

### `workflow.session_pack.upsert`

Creates or updates a session pack.

Required for a new pack:

- `sessionId`
- `ownerAgent`
- `taskType`
- `purpose`

Optional:

- `runtimeTarget`
- `status`
- `version`
- `systemBrief`
- `workingContext`
- `toolPolicy`
- `inputSchema`
- `outputSchema`
- `evidenceRefs`
- `checkpointRefs`
- `resourceBudget`
- `metadata`
- `createdBy`

Reliability behavior:

- Unknown pack status is rejected.
- Identical retry returns `deduped: true` and does not bump `version`.
- Content change without explicit `version` bumps `version` by one.

Aliases:

- `workflow.session.pack.upsert`
- `session_pack.upsert`

### `workflow.session_pack.get`

Returns a pack plus `workerInputTemplate`.

Required:

- `sessionId`

Aliases:

- `workflow.session.pack.get`
- `session_pack.get`

### `workflow.session_pack.list`

Lists packs, optionally filtered by:

- `status`
- `ownerAgent`
- `taskType`
- `limit`

`limit` is clamped to `1..500`; invalid values fall back to `100`.

Aliases:

- `workflow.session.pack.list`
- `session_pack.list`

### `workflow.session_run.start`

Starts a run and stores the generated `worker_input_json`.

Required:

- `sessionId`

Optional:

- `runId`
- `workflowId`
- `taskId`
- `traceId`
- `dispatchId`
- `workerId`
- `status` (`queued` or `running` are expected for start)
- `input`

Reliability behavior:

- Unknown run status is rejected.
- `disabled` and `archived` packs are not runnable.
- Duplicate `runId` is idempotent only when the existing run matches the same
  session/status/workflow/task/worker/input. Conflicts are rejected.

Aliases:

- `workflow.session.run.start`
- `session_run.start`

### `workflow.session_run.complete`

Completes, fails, or cancels a run.

Required:

- `runId`

Optional:

- `status`
- `output`
- `result`
- `payload`
- `receiptRef`
- `artifactRef`
- `error`

Reliability behavior:

- Unknown run status is rejected.
- Terminal runs are immutable. Repeating the same completion returns
  `deduped: true`.
- A terminal retry with different status/output/receipt/error is rejected.
- A retry without `output` or `receiptRef` does not clear existing values.

Aliases:

- `workflow.session.run.complete`
- `session_run.complete`

## CLI

The package bin entry is `bin/cat-meeting-governance.mjs`, exposed as
`trading-agents-workflow`.

Examples:

```bash
node bin/cat-meeting-governance.mjs workflow-session-pack-upsert \
  --root /tmp/taw-session \
  --session session-pack-contract-smoke \
  --owner-agent cat_body \
  --task-type trading_core_contract_smoke \
  --purpose "Run trading_core contract smoke from a compact context" \
  --runtime-target worker:local_codex \
  --working-context '{"workflowId":"workflow-session-store"}' \
  --tool-policy '{"forbiddenActions":["live_order","gateway_restart"]}'
```

```bash
node bin/cat-meeting-governance.mjs workflow-session-run-start \
  --root /tmp/taw-session \
  --session session-pack-contract-smoke \
  --run session-run-contract-smoke \
  --workflow workflow-session-store \
  --task task-contract-smoke \
  --input '{"intentPath":"/tmp/intent.json"}'
```

```bash
node bin/cat-meeting-governance.mjs workflow-session-run-complete \
  --root /tmp/taw-session \
  --run session-run-contract-smoke \
  --output '{"status":"contract_valid"}' \
  --receipt artifact://receipts/session-run-contract-smoke
```

## Reliability Invariants

- Do not persist raw credentials or production account data in packs/runs.
- Do not put long chat history into `working_context_json`.
- Put long evidence in artifacts, checkpoints, or governance logs and reference it.
- Treat `run_id` as an idempotency key.
- Treat terminal run output and receipt as immutable.
- Reject ambiguous status values instead of silently defaulting to success.
- Keep Human Gate and trading approval outside session packs; packs may reference
  approval records but must not infer missing approval.
- Keep live trading disabled unless a separate Human Gate, risk decision, and
  `trading_core` live-mode release process explicitly approve it.

## Current Limits

This first version stores context and builds worker input. It does not yet:

- Dispatch workers automatically from session runs.
- Enforce JSON Schema validation for input/output.
- Attach runs to `control_loop_jobs`.
- Provide retention/archival policy for old runs.
- Store binary artifacts.
- Replace `workflow_checkpoints`.
- Replace Human Gate feedback or trading approval records.

## Development Roadmap

Near-term candidates:

1. Add schema validation for `inputSchema` and `outputSchema`.
2. Add `workflow.session_run.dispatch` to enqueue a runtime bridge job.
3. Bind session runs to `workflow_tasks` and receipts in supervisor decisions.
4. Add retention policy and CLI archive command.
5. Add read model support in workflow console.
6. Add session pack templates for common repeatable tasks:
   - `trading_core_contract_smoke`
   - workflow readiness triage
   - runtime bridge drain review
   - Human Gate evidence audit
7. Add metrics:
   - pack count by status/task type
   - run count by status
   - duplicate/conflict count
   - average run age
   - terminal run missing receipt count

## Test Coverage

Regression coverage lives in `scripts/workflow_regression_tests.mjs`:

- `workflow session store`
- `workflow session store cli`

Expected checks:

```bash
npm run check
npm run test:regression
npm run smoke:trading-core
```

The regression suite verifies:

- pack creation and update versioning
- idempotent identical pack retry
- invalid status rejection
- worker input generation
- run start dedupe and conflict detection
- terminal complete immutability
- repeat complete does not clear output/receipt
- sensitive object-key redaction
- `workflow.status` session counts
- actual package bin CLI path

