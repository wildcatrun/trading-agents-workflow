# Workflow v2 Information Stack

Status: design draft, not runtime code
Created: 2026-07-03
Scope: `trading-agents-workflow` v2 communication substrate

## Purpose

The v2 orchestration kernel needs internal communication that feels closer to a
shared workflow workbench than to a chain of registered letters. The current
`message_flow` surface is valuable because it preserves cross-runtime delivery,
return policy, ACK, Telegram, local Codex inbox, and stuck-delivery evidence.
That makes it a good governed delivery layer.

It should not become the authoritative content store for manager/worker
communication. In v2, authoritative content belongs in a workflow-native
information stack. `message_flow` should notify a target that a governed inbox
item exists and provide the minimum safe pointer needed to read it.

Short version:

```text
workflow information stack = content, context refs, ACL, read receipts
workflow kernel bus        = commands, events, worker/review state
message_flow               = SMS-like notification and delivery receipt
```

## Decision

`message_flow` is a notification bridge, not the workflow-internal information
store and not the orchestration bus.

For manager/worker work, the body should live in `workflow_v2_info_items`.
Recipients should see the item through `workflow_v2_inbox_items`. Access should
be controlled by `workflow_v2_access_grants`. Reads should be recorded in
`workflow_v2_read_receipts`. Cross-runtime notification can reference the inbox
item through `workflow_v2_notifications` and, when needed, a `message_flows`
row.

`message_flow.payload_json` may include `info_id`, `inbox_item_id`, a short
summary, expiry metadata, and read instructions. It must not become the source
of truth for the full task body, hidden context, artifact contents, long prompt,
or durable decision.

## Why This Is Needed

The v2 manager/worker model needs several properties that a delivery flow alone
does not provide cleanly:

- same-platform agents need cheap shared inbox reads, not external-style message
  delivery for every internal step;
- cross-platform workers need a stable pointer to the same content that
  same-platform workers read;
- managers need to review artifacts and worker output from a durable source, not
  from a copied prompt body;
- permissions need to bind to workflow identity, runtime identity, session
  instance, and expiry;
- read receipts need to prove which manager/session read which item;
- Human Gate packages need artifact and evidence refs, not replayed message
  bodies;
- notification delivery must not be confused with semantic task completion.

The information stack gives v2 a stable content plane. `message_flow` remains
useful at the edges.

## Layering

### Information Stack

The information stack stores workflow-native content and read state.

Primary objects:

- `workflow_v2_info_items`: authoritative content item.
- `workflow_v2_inbox_items`: per-recipient inbox pointer.
- `workflow_v2_access_grants`: read permission, expiry, and token hash metadata.
- `workflow_v2_read_receipts`: evidence that a target read or attempted to read
  the item.
- `workflow_v2_notifications`: delivery attempts that point a target to the
  inbox item.

The information stack should answer:

- What is the item?
- Which workflow/plan/node/run produced or needs it?
- Who is allowed to read it?
- Which session or runtime identity read it?
- Which notification was used to alert the recipient?
- Which artifacts are authoritative?

### Kernel Bus

The kernel bus handles orchestration facts:

- plan created
- node ready
- worker spawn requested
- worker result received
- manager review required
- artifact accepted
- Cat Brain check ready
- Cat Claw audit ready
- Human Gate submitted

Kernel events may reference information items. They should not inline long
content.

### Message Flow

`message_flow` handles cross-boundary notification:

- route-shell to migrated runtime;
- Hermers/OpenClaw/local Codex delivery notification;
- Telegram-return or report-to-Flashcat delivery evidence;
- notification ACK and stuck-delivery incidents.

It should carry a pointer, not the source content.

## Object Model

### Info Item

An info item is the authoritative content record. It can represent:

- manager instruction
- worker task input
- worker result summary
- manager review request
- manager review result
- group discussion prompt
- Human Gate package preview
- incident handoff
- local Codex control-panel handoff

Minimum fields:

- `info_id`
- `workflow_id`
- optional `plan_id`, `node_id`, `run_id`
- `item_type`
- `status`
- `classification`
- `title`
- `summary`
- `body_text` or external content reference
- `payload_json`
- `artifact_refs_json`
- `content_hash`
- creator agent/session
- timestamps and expiry

Large or sensitive content should prefer artifact refs or structured payload refs
instead of duplicating bodies.

Sensitive, secret, or trading-classified info items must not store their
authoritative body inline. They should store redacted summaries plus artifact or
external refs, and any structured payload should contain refs or minimal metadata
rather than raw sensitive content.

### Inbox Item

An inbox item binds an info item to a recipient.

Recipients can be:

- durable cat member through `recipient_agent_key`;
- task-scoped manager session;
- worker session instance;
- local Codex inbox;
- a future registered external runtime identity.

The inbox item records read/ack status, notification policy, and the latest
notification reference.

### Access Grant

An access grant says who can read an info item, under what constraints.

Grant principles:

- Prefer runtime identity and workflow tool authorization over raw tokens.
- Token use, when unavoidable, must be short-lived, single-target, single-use or
  limited-read, and stored only as a hash.
- Grants should bind to `workflow_id`, `info_id`, target identity, expiry, and
  optional session instance.
- `grantee_kind=agent` must bind to `grantee_agent_key`.
- `grantee_kind=session_instance` must bind to `grantee_session_instance_id`.
- `grantee_kind=runtime_identity`, `external_runtime`, or `local_codex` must
  bind to a non-empty runtime identity string.
- `read_count` must never exceed `max_reads`.
- Grants should support revocation.
- Grant reads should increment read count and write receipts.

No long-lived bearer token should be placed in `message_flow`, artifacts, public
logs, Telegram text, or prompt bodies.

### Read Receipt

A read receipt is not a task completion receipt. It only proves that a target
read or attempted to read an info item.

Read receipt fields should include:

- reader agent key or session instance;
- runtime and adapter;
- runtime identity for runtime-bound readers;
- grant id;
- read status;
- timestamp;
- request/evidence metadata.

Manager review, worker run completion, and Human Gate completion remain separate
workflow facts.

### Notification

A notification says that a target was told to read an inbox item.

Notification channels:

- `internal`: same runtime or same workflow tool read path;
- `message_flow`: cross-runtime governed notice;
- `telegram`: only for human-facing notification paths;
- `local_codex`: local control-panel inbox notice.

For `message_flow` notifications, the flow body should contain only:

- `info_id`
- `inbox_item_id`
- short title/summary
- read method or tool/action name
- expiry
- trace/correlation id

It should not contain the authoritative body.

The notification schema defaults to `payload_mode=pointer_only`. Legacy inline
payloads are an explicit migration exception, must include
`legacy_inline_reason`, and must not be used for new v2 worker communication.

## Read Flow

Recommended read sequence:

1. Manager or kernel creates `workflow_v2_info_items`.
2. Kernel creates one or more `workflow_v2_inbox_items`.
3. Kernel creates `workflow_v2_access_grants`.
4. If recipient can poll or list workflow inbox directly, no `message_flow` is
   required.
5. If recipient needs cross-runtime notification, kernel creates
   `workflow_v2_notifications` and a `message_flow` row carrying only the inbox
   pointer.
6. Recipient calls a governed read action such as
   `workflow.inbox.read(inbox_item_id)`.
7. Read action validates runtime identity, grant, expiry, status, and optional
   token hash.
8. Read action returns the info body, payload, and artifact refs.
9. Read action writes `workflow_v2_read_receipts`.
10. Worker or manager response is recorded through worker run, manager review,
    artifact, or kernel event state, not through notification delivery.

## Manager To Worker Example

Manager spawn:

```json
{
  "node_id": "node-implement-schema-tests",
  "manager_agent": "cat_body",
  "worker_blueprint_id": "worker.code.test_verifier",
  "session_template_id": "worker.code.test_verifier",
  "task_input_info_id": "info-task-123",
  "recipient_session_instance_id": "session-worker-456"
}
```

Worker notification:

```json
{
  "message_type": "workflow_inbox_notice",
  "info_id": "info-task-123",
  "inbox_item_id": "inbox-789",
  "read_action": "workflow.inbox.read",
  "expires_at": "2026-07-03T18:00:00.000+08:00"
}
```

The full task prompt, context refs, artifact refs, input schema, output schema,
and review policy are read from the information stack. The notification is just
an alert.

## Same-Platform Versus Cross-Platform

Same-platform workflow should prefer direct inbox reads:

```text
kernel command -> inbox item -> runtime-local worker reads via workflow tool
```

Cross-platform workflow should add notification:

```text
kernel command -> inbox item -> access grant -> message_flow notice -> workflow
tool read -> read receipt
```

Human-facing workflow should keep the existing governed path:

```text
Human Gate package -> Cat Claw audit -> Telegram/Web App delivery -> Human Gate
record -> resume payload
```

## Security Rules

- Do not put full task bodies into `message_flow` by default.
- Do not put bearer tokens into Telegram, prompt bodies, artifacts, or public
  governance logs.
- Store token hashes only.
- Bind grants to target identity and workflow context.
- Expire grants by default.
- Revoke grants when a workflow is terminated, paused for security, or the node
  is superseded.
- Record all successful and failed reads.
- Treat read receipt as read evidence only, not semantic completion.
- For trading-related information, require timestamps and expiry checks before
  any downstream execution.

## Compatibility With Current `message_flow`

Current `message_flow` remains valid for:

- governed delivery evidence;
- route-shell handoff;
- local Codex inbox notification;
- Telegram return/report delivery;
- ACK and semantic continuation for cross-runtime message flows;
- stuck-delivery incident generation.

The v2 change is semantic narrowing: future manager/worker work should not put
authoritative content in `message_flow.payload_json`. Instead, payloads should
point to `info_id` and `inbox_item_id`.

Existing flows do not need migration immediately. During transition, the kernel
can support both:

- legacy inline message_flow bodies;
- v2 pointer-only notification payloads.

Legacy inline support is only for reading or reconciling existing flows. Any new
legacy inline notification must carry an explicit `legacy_inline_reason`, and it
should be treated as technical debt. New v2 worker communication must use
pointer-only notices.

## Relationship To Artifacts

Info items can contain short bodies and structured payloads, but durable output
still belongs in artifacts when the content is material:

- worker result files;
- review reports;
- evidence bundles;
- Human Gate package drafts;
- logs and command output;
- rendered files or screenshots.

Info items should reference those artifacts and include hashes. They should not
become an unbounded document store.

## Failure Modes

### Notification Delivered, Item Not Read

This is not task completion. The notification may be successful while the inbox
item remains unread. The workflow should remain `waiting_worker` or equivalent
until the worker run produces a receipt/output.

### Item Read, Worker Output Missing

Read receipt proves only access. The worker run may still time out, fail, or be
rejected.

### Worker Run Marked Accepted Without Review

This should fail closed. `worker_runs.status=accepted` is only a cached lifecycle
summary. The authority is an accepted manager review row tied to that run.

### Message Flow Failed, Direct Inbox Poll Succeeds

Same-runtime or polling recipients may still read the inbox item. The failed
notification remains delivery evidence, not an automatic task failure.

### Grant Expired Before Read

The read should fail closed, record a failed read receipt, and require a manager
or kernel decision to reissue the grant.

### Info Item Superseded

Old inbox items should move to `superseded` or `revoked`, and grants should be
revoked. New worker runs should receive a new info item id.

## Implementation Slices

### P0: Design Only

- Land this document.
- Add schema draft tables to `workflow-v2-orchestration-schema.sql`.
- Add README and kernel references.
- Do not change runtime code.

### P1: Read-Only Preview

- Add a dry-run renderer that shows how a worker task would become an info item,
  inbox item, grant, notification, and message_flow pointer.
- Add validation that pointer-only notification payloads do not include full
  task bodies.

### P2: Local Inbox Prototype

- Add local database operations for info item creation, inbox listing, grant
  validation, and read receipt writing.
- Keep runtime dispatch disabled or dry-run only.

### P3: One Low-Risk Worker Flow

- Use the information stack for one non-trading worker task.
- Use direct inbox read when possible and `message_flow` only for notification.
- Require manager review before accepting output.

### P4: Human Gate Package Readiness

- Use info items to assemble Cat Brain and Cat Claw review packages.
- Keep Telegram/Web App Human Gate delivery separate from internal information
  reads.

## Open Questions

- Should workers receive one inbox item per node or one inbox item per worker
  attempt?
- Should `workflow_v2_info_items.body_text` allow inline bodies, or should all
  non-trivial content be artifact-only?
- Should grants be tied to runtime identity, session instance, or both for
  Hermers/Codex/Claude Code workers?
- Should same-runtime managers poll inboxes, or should every inbox item still
  produce an internal notification row?
- What is the minimum redaction rule for info item summaries that may appear in
  `message_flow` notices?

## Acceptance Criteria

- New v2 worker communication can be represented without putting full content in
  `message_flow.payload_json`.
- Every authoritative info item has workflow, creator, hash, and timestamp
  evidence.
- Every read has a receipt or failed-read receipt.
- Notification delivery is distinguishable from content read and task
  completion.
- Cross-runtime recipients and same-runtime recipients read the same info item.
- Expired or revoked grants fail closed.
- Cat Claw can audit Human Gate package evidence through info/artifact refs
  without replaying message flow bodies.
