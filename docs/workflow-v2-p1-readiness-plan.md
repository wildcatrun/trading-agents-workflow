# Workflow v2 P1 Readiness Plan

Status: historical first-slice readiness plan; initial local kernel slice is now implemented
Created: 2026-07-03
Scope: execution-prep checklist for workflow v2

## Purpose

This document converted the v2 design package into an executable-readiness
plan. It remains the historical first-slice checklist for authorization gates,
test matrices, dry-run API expectations, and worker-testbed checks.

The initial local kernel slice has since landed in code. It still does not
authorize Docker creation, server changes, production database migration,
Gateway reloads, production workflow queue connection, or secret injection.

## Inputs

Required design inputs:

- `docs/workflow-v2-orchestration-kernel.md`
- `docs/workflow-v2-information-stack.md`
- `docs/workflow-v2-orchestration-schema.sql`
- `docs/workflow-v2-worker-runtime-backends.md`
- `docs/message-flow-closure.md`
- `docs/agent-registry-routing.md`

## P1 Objectives

The first slice should produce enough executable structure that later runtime
adapter slices can start safely.

P1 deliverables:

- authorization gate template;
- schema/design test matrix;
- dry-run command/API contract;
- worker runtime testbed preflight checklist;
- secrets/model route validation checklist;
- artifact/log location plan;
- rollback/cleanup plan;
- independent review record.

The first slice must not:

- deploy to the development server or production;
- start Docker containers;
- modify Hermers/OpenClaw/Claude Code configuration;
- expose workstation network ports;
- inject model/OAuth/API secrets;
- connect test workers to real workflow queues;
- write to central workflow SQLite from a worker.

## Authorization Gate Template

Every implementation action after P1 should have an explicit gate record.

Required fields:

```yaml
gate_id: workflow-v2-<scope>-<yyyymmdd>
requested_by: local_codex
approved_by: Flashcat
approved_at: <ISO timestamp>
scope:
  summary: ""
  included_actions: []
  excluded_actions: []
systems:
  dev_server: false
  local_workstation_wsl_agents: false
  local_workstation_wsl_models: false
  production_server: false
  openclaw_gateway: false
  hermers_gateway: false
runtime_effects:
  docker_create: false
  docker_start: false
  config_write: false
  db_migration: false
  gateway_restart: false
  secret_injection: false
model:
  provider_model: "openai-codex/gpt-5.5"
  fallback_allowed: false
  fail_closed_on_fallback: true
  verification_required: true
  required_receipt_fields:
    - provider
    - model
    - fallbackAttempts
    - errorCode
secrets:
  source: ""
  injection_method: ""
  storage_path: ""
  revocation_plan: ""
  oauth_expiry_check_required: true
  oauth_refresh_check_required: true
  revocation_verification_required: true
artifacts:
  log_root: ""
  result_root: ""
rollback:
  cleanup_steps: []
  success_exit_criteria: []
review:
  subagent_review_required: true
  human_gate_required: false
```

Rules:

- If any high-impact field is `true`, the gate must describe rollback and
  cleanup.
- `secret_injection=true` requires a revocation plan.
- `fallback_allowed=false` means any observed model fallback must fail closed
  and block the smoke from being marked successful.
- the fail-closed assertion must be executable: any observed
  `fallbackAttempts > 0` when fallback is disallowed returns a failed preflight
  result with error code `model_fallback_disallowed`.
- model route smoke must record observed provider, model, fallback attempts, and
  error code without exposing secrets.
- missing provider, model, fallback attempts, or error code fields must fail
  preflight with `model_receipt_missing_required_fields`.
- OAuth-backed routes must verify token expiry, refresh behavior, and revocation
  verification before worker smoke can be considered ready.
- OAuth expiry, refresh, or revocation verification failure blocks the worker
  smoke from being marked ready.
- OAuth failure modes must use standardized failure codes:
  `oauth_token_expired`, `oauth_refresh_failed`, and
  `oauth_revocation_unverified`.
- `gateway_restart=true` requires a separate high-impact operations approval.
- `db_migration=true` is outside this P1 plan and requires a future migration
  proposal.

## Dry-Run API Contract

P1 should define read-only preview operations before execution exists.

Suggested dry-run operations:

### `workflow.v2.plan.preview`

Input:

- objective
- task owner
- candidate managers
- constraints
- expected artifacts

Output:

- plan draft
- phase/node graph
- manager assignments
- Human Gate policy preview
- missing inputs

No DB writes except optional local artifact under an explicitly requested dry-run
path.

### `workflow.v2.info_stack.preview`

Input:

- workflow id or synthetic workflow ref
- node id
- recipient
- item type
- classification
- proposed body/payload/artifact refs

Output:

- info item preview
- inbox item preview
- access grant preview
- notification preview
- read receipt expectations
- rejection reasons for unsafe inline content

Must reject pointer-only violations when notification payload would include full
worker task body.

### `workflow.v2.worker_spawn.preview`

Input:

- manager agent
- worker blueprint
- session template
- runtime backend
- task input info item

Output:

- worker run preview
- session instance preview
- information-stack dependencies
- runtime backend choice and reason
- required manager review
- missing authorization gates

Must not start workers.

### `workflow.v2.notification.preview`

Input:

- inbox item
- target runtime/backend
- notification policy

Output:

- direct inbox read path or message_flow pointer payload
- payload mode: `pointer_only` or rejected legacy exception
- delivery evidence expectations

Must not create `message_flows`.

### `workflow.v2.worker_backend.preflight`

Input:

- backend id
- host alias
- model target
- network mode
- secret injection mode

Output:

- readiness checklist
- missing prerequisites
- disallowed actions
- commands that would be run after approval
- expected provider/model receipt fields
- fallback fail-closed rule
- OAuth expiry/refresh/revocation validation requirements

Must not connect to `wsl-agents`, create Docker resources, or read secrets.

## Schema And Design Test Matrix

These tests can be implemented later as SQL regression tests or dry-run checks.

### Information Stack

- `classification=internal` still defaults to pointer storage; inline body is
  allowed only when explicitly requested with `allowInlineContent=true` and an
  inline reason.
- `classification=sensitive` rejects `content_storage=inline`.
- `classification=secret` rejects non-empty `body_text`.
- `classification=trading` rejects inline authoritative body.
- `payload_json` and `summary` must pass minimum disclosure checks for sensitive
  classes.
- `content_hash` is required for all info items.

### Access Grants

- `grantee_kind=agent` requires `grantee_agent_key`.
- `grantee_kind=session_instance` requires `grantee_session_instance_id`.
- `grantee_kind=runtime_identity`, `external_runtime`, or `local_codex`
  requires non-empty `runtime_identity`.
- `read_count` cannot exceed `max_reads`.
- expired grants fail closed.
- revoked grants fail closed.

### Read Receipts

- `reader_kind=agent` requires `reader_agent_key`.
- `reader_kind=session_instance` requires `reader_session_instance_id`.
- runtime-bound readers require non-empty `runtime_identity`.
- read receipt does not complete a worker run.
- failed read attempts are recorded.

### Notifications And Message Flow

- new v2 worker notification defaults to `pointer_only`.
- `legacy_inline` requires `legacy_inline_reason`.
- new v2 worker communication rejects `legacy_inline` at policy level.
- `channel=message_flow` with status `sent`, `delivered`, or `failed` requires
  `message_flow_id`.
- pointer notification may contain `info_id`, `inbox_item_id`, short summary,
  read action, expiry, and trace id only.
- notification delivery does not complete worker task or manager review.

### Worker Runs And Manager Review

- `worker_task` nodes require `worker_blueprint_id`.
- worker blueprint must reference a worker template.
- `worker_runs.status=accepted` requires accepted manager review.
- worker success without manager review remains unaccepted.
- rejected manager review cannot feed Human Gate package as accepted evidence.

### Workflow Identity Consistency

- v2 rows reference `workflow_runs.workflow_id`.
- info item, inbox item, access grant, read receipt, notification, worker run,
  and manager review should agree on `workflow_id`.
- mismatched workflow ids should fail validation before execution.
- validator should include a centralized consistency query or equivalent dry-run
  check that proves linked `info_id`, `inbox_item_id`, `grant_id`,
  `receipt_id`, `notification_id`, `run_id`, `review_id`, and `node_id` do not
  cross workflow boundaries.

Minimum consistency checklist:

- `workflow_v2_plan_nodes.workflow_id` matches its `workflow_v2_plans.workflow_id`.
- `workflow_v2_worker_runs.workflow_id` matches its plan, node, and session
  instance workflow refs when present.
- `workflow_v2_info_items.workflow_id` matches referenced plan, node, and run.
- `workflow_v2_inbox_items.workflow_id` matches referenced info item, node, run,
  and session instance.
- `workflow_v2_access_grants.workflow_id` matches referenced info item and inbox
  item.
- `workflow_v2_read_receipts.workflow_id` matches referenced info item, inbox
  item, and grant.
- `workflow_v2_notifications.workflow_id` matches referenced info item, inbox
  item, and linked `message_flows.workflow_id` when a `message_flow_id` exists.
- `workflow_v2_manager_reviews.workflow_id` matches referenced plan, node, and
  worker run.
- `workflow_v2_human_gate_packages.workflow_id` matches referenced plan and
  source review.
- legacy bridge rows used as evidence, including `message_flows`,
  `mixed_meeting_dispatches`, and `runtime_runs`, must not point across workflow
  boundaries when referenced by v2 rows.

### Model Route And OAuth

- `provider_model` must be `openai-codex/gpt-5.5` for the first smoke unless
  Flashcat explicitly approves another target.
- `fallback_allowed=false` must fail closed if any fallback attempt is observed.
- route smoke receipt must expose provider, model, fallback attempts, and error
  code.
- dry-run/preflight must include a negative test where `fallbackAttempts > 0`
  and fallback is disallowed; expected result is failure with
  `model_fallback_disallowed`.
- dry-run/preflight must include a negative test where any required receipt
  field is missing; expected result is failure with
  `model_receipt_missing_required_fields`.
- OAuth expiry must be inspected without printing access or refresh tokens.
- OAuth refresh must be verified or explicitly marked unavailable before worker
  smoke.
- revocation plan must include how success is verified after cleanup.
- failed expiry, refresh, or revocation verification must block readiness.
- negative tests must cover expired token, refresh failure, and unverifiable
  revocation, with standardized failure codes.
- logs and artifacts must redact authorization headers, API keys, access tokens,
  refresh tokens, and device codes.

## Worker Runtime Preflight Matrix

### Hermers Docker Worker

Preflight checks:

- confirm `wsl-agents` availability without starting containers;
- confirm `wsl-agents` uses host-only Tailscale through the Windows host and
  does not require WSL `tailscaled`;
- confirm no P1 check starts `tailscaled` inside WSL or any container;
- confirm no direct development-server-to-container port path is assumed;
- identify non-secret development-server Hermers config structure to reference;
- verify test model target is `openai-codex/gpt-5.5`;
- verify fallback is disallowed for route smoke unless separately approved;
- define secret injection method without reading or printing secret values;
- define OAuth expiry, refresh, and revocation validation steps;
- define synthetic info item input;
- define result artifact directory;
- define cleanup plan for image/container/volume after authorization.

Disallowed in P1:

- building image;
- starting container;
- copying OAuth token;
- connecting to production workflow queue;
- writing central SQLite.

### Claude Code Docker Worker

Preflight checks:

- define disposable repo/worktree source;
- define tool list expected inside image;
- define output contract: diff, tests, logs, risk notes;
- define whether model route verification is required for the coding worker;
- define cleanup plan.

Disallowed in P1:

- installing Claude Code in Docker;
- running code workers;
- mutating repos;
- connecting to real workflow queues.

### `wsl-models`

Preflight checks:

- define expected model API endpoint contract;
- define whether worker containers call `wsl-models` directly or through a
  controlled proxy;
- define timeout, budget, and fallback policy.
- confirm no P1 preflight starts GPU jobs or creates GPU worker containers.

Disallowed in P1:

- starting GPU jobs;
- creating GPU worker containers;
- storing model credentials in worker images.

## Secrets And Model Route Checklist

Before any model-backed worker smoke:

- verify the intended model route is `openai-codex/gpt-5.5`;
- verify whether fallback is allowed. Default: no fallback for route smoke;
- fail closed if fallback is observed while fallback is disallowed;
- require error code `model_fallback_disallowed` when fallback blocks readiness;
- record how provider/model will be observed in receipt metadata;
- record how fallback attempts and error codes will be observed in receipt
  metadata;
- fail preflight with `model_receipt_missing_required_fields` when any required
  receipt field is absent;
- verify OAuth expiry without printing tokens;
- verify OAuth refresh behavior or record why refresh is unavailable;
- block readiness if OAuth expiry, refresh, or revocation verification fails;
- require `oauth_token_expired`, `oauth_refresh_failed`, or
  `oauth_revocation_unverified` for the corresponding OAuth failure scenario;
- define where OAuth/API secrets are mounted;
- define how secrets are revoked after smoke;
- define how revocation success is verified;
- confirm logs redact token, refresh token, authorization headers, and API keys;
- confirm Docker image does not contain secrets;
- confirm artifacts do not include secrets.

## Artifact And Log Plan

Recommended placeholders:

```text
wsl-agents:
  E:\CodexOps\<timestamp>-workflow-v2-worker-testbed\
    logs\
    artifacts\
    tmp\
    manifests\
    cleanup\

dev-server:
  /home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/<timestamp>-workflow-v2-worker-testbed/
```

The final location should be approved in the implementation gate. Do not create
these paths in P1 unless a later action explicitly authorizes it.

## Review Requirements

Before moving from P1 to implementation:

- local checks must pass;
- schema dry-read must pass;
- independent subagent review must report no blocking findings;
- residual risks must be documented;
- Flashcat must approve the implementation gate.

## Exit Criteria

P1 is ready when:

- this plan is reviewed;
- dry-run API contracts are accepted or revised;
- test matrix is sufficient for the first implementation slice;
- worker testbed preflight is clear;
- authorization gate template is ready for Flashcat approval;
- no document implies runtime execution without explicit future approval.
