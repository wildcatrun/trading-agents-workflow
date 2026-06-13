# Runtime Semantic Observability Improvement Plan

Created: 2026-06-03
Status: development plan
Trigger: `trading_sim` production disk-full incident handoff to `cat_body`

This plan converts the 2026-06-03 production incident learning into concrete
observability requirements for `trading-agents-workflow`, Hermers/Hermes
runtime adapters, and workflow console surfaces.

The immediate failure mode was not message delivery. The workflow evidence was
able to prove dispatch and ACK, but it could not prove whether the target agent
entered semantic execution, what stage it was in, whether a later message
interrupted it, or why a final artifact was missing.

## Goal

Upgrade the workflow control plane from:

```text
dispatch sent -> ACK received
```

to:

```text
dispatch sent
  -> mechanical ACK
  -> semantic ACK
  -> stage progress
  -> artifact / blocked / interrupted / failed / completed evidence
  -> receipt and Human Gate readiness
```

The plugin should make runtime progress auditable without becoming the runtime
platform itself. OpenClaw, Hermers/Hermes, Codex, and future runtimes still own
their own processes, sessions, tools, and execution details.

## Incident Findings

- `ACK` proved that the runtime received the task; it did not prove that
  `cat_body` understood the task or started the code fix.
- `runtime_completed` and `final_output_present` can be misleading if the
  completed output is only an ACK path rather than the semantic task result.
- The workflow lacked a stable binding across `workflow_id`, `dispatch_id`,
  runtime session, ACP turn, prompt, transcript, and artifact.
- Runtime receipts did not expose stage changes such as evidence reading,
  diagnosis, implementation, testing, blocked, or completion.
- The workflow could not distinguish a new message that was queued, processed
  in parallel, preempted the old run, superseded it, or was ignored.
- Artifact visibility was binary. It did not explain why an artifact was
  created, which evidence it cited, which stage produced it, or why no artifact
  existed.
- Heartbeat and liveness were not enough. A live runtime can still be unrelated
  to the dispatch currently under investigation.

## Claude Code References

These official Claude Code surfaces provide the design signal:

- Dynamic workflows save progress and can resume interrupted jobs.
- Agent View shows background sessions by state and lets operators inspect,
  attach, or read recent logs.
- Hooks expose lifecycle points such as session start, tool use, subagent stop,
  stop, failure, and compaction.
- Headless mode can emit structured JSON or newline-delimited streaming JSON.
- Session transcripts are append-only JSONL evidence and can be mirrored to
  external storage.
- OpenTelemetry exports metrics, events/logs, and traces for model requests,
  tool execution, failures, costs, and spans.

Adaptation rule: use the lifecycle-event, transcript-reference, and trace
principles. Do not copy Claude Code's arbitrary workflow JavaScript model or
use hooks as a second scheduler.

## P0: Close The ACK-Only Blind Spot

Scope: first implement for Hermers/Hermes `cat_body`, then generalize.

Required behavior:

- Distinguish `mechanical_ack` from `semantic_ack`.
  - `mechanical_ack`: runtime bridge received and accepted the dispatch.
  - `semantic_ack`: the agent has started interpreting the task as the active
    work item.
- Record a runtime observation event when a dispatch is bound to a concrete
  runtime session or ACP turn.
- Record stage changes for long tasks.
- Record terminal semantic outcomes separately from ACK completion.
- Mark ACK-only stale state when a dispatch has mechanical ACK but no
  `semantic_ack`, `stage_change`, `artifact_created`, or terminal semantic
  result after the configured window.
- Expose current active dispatch per agent in a read model.

Minimum event types:

```text
dispatch_bound
mechanical_ack
semantic_ack
stage_change
artifact_created
blocked
interrupted
turn_completed
turn_failed
session_compacted
```

Minimum stages:

```text
received
reading_evidence
diagnosing
planning_fix
editing
testing
awaiting_review
blocked
completed
failed
```

P0 non-goals:

- Do not retry or cancel runtime work automatically.
- Do not infer semantic progress from natural-language ACK text.
- Do not require full transcript ingestion before adding structured events.

## P1: Hermes Runtime Hooks-Like Eventing

Hermers/Hermes adapters should report lifecycle events that are equivalent in
purpose to Claude Code hooks, while staying inside workflow ownership
boundaries.

Runtime events should answer:

- Which dispatch is this session or turn serving?
- Which agent/profile emitted the event?
- What is the current stage?
- What tool or subagent activity occurred, if any?
- Did a new message queue, run in parallel, preempt, supersede, or get ignored?
- What artifact was created and what evidence does it cite?
- What caused block, failure, compaction, or stop?

Interruption classification is mandatory when a new dispatch arrives for a
profile with active work:

```text
queued
parallel
preempted
superseded
ignored
```

The runtime adapter must not silently reuse a persistent session in a way that
makes the old dispatch appear completed without a semantic terminal event.

Transcript handling:

- Persist transcript path, content hash, selected index metadata, and a short
  summary.
- Treat transcript as an audit attachment, not as the primary state machine.
- Do not dump sensitive production incident details into metrics by default.

## P2: Agent View And Workflow Trace

Add operator-facing read surfaces to the existing console and CLI. This should
extend current workflow console surfaces, not create a second console.

CLI targets:

```text
workflow trace <workflow_id>
workflow dispatch observe <dispatch_id>
workflow agent current <agent_id>
workflow artifacts --dispatch <dispatch_id>
workflow stale --kind ack_only
workflow transcript-ref <dispatch_id>
```

Console targets:

- Workflow Trace: entrance message, dispatch, ACK, semantic run, tool/artifact,
  receipt, Human Gate state.
- Agent Current State: active dispatch, queued work, current stage,
  last event time, blocked reason, latest artifact.
- Artifact Provenance: artifact URI, producing stage, evidence references,
  tests or verification references, hash, and readiness impact.

Recommended SLI:

- ACK-only stale count.
- Semantic ACK latency.
- Dispatch-to-stage-change latency.
- Semantic receipt completeness.
- Artifact provenance completeness.
- Undeclared interruption count.
- Stale active dispatch count.
- Human Gate evidence completeness.
- Runtime failure rate by adapter.

Metrics should use low-cardinality dimensions. High-cardinality values such as
`workflow_id`, `dispatch_id`, `prompt_id`, or `artifact_uri` belong in events,
logs, traces, or evidence packs, not time-series labels.

## Data Model Sketch

The minimum durable shape is an append-only runtime event table plus a
current-state projection. Specialized dispatch, receipt, message_flow, Human
Gate, side-effect, and artifact tables remain authoritative for their own
domains.

Suggested append-only fields:

```text
event_id
event_type
event_time
event_sequence
workflow_id
dispatch_id
trace_id
correlation_id
parent_event_id
agent_id
runtime
runtime_session_id
runtime_run_id
acp_turn_id
prompt_id
stage
status
blocked_reason
interruption_mode
interrupted_dispatch_id
supersedes_dispatch_id
artifact_uri
artifact_type
artifact_sha256
artifact_reason
evidence_refs_json
tool_name
tool_call_id
duration_ms
exit_code
cwd
git_head
model
provider
privacy_class
redaction_status
ttl
error_class
severity
idempotency_key
side_effect_ref
payload_json_redacted
created_at
```

Suggested current-state projection:

```text
agent_id
runtime
active_dispatch_id
active_workflow_id
runtime_session_id
runtime_run_id
acp_turn_id
stage
status
last_event_id
last_event_at
last_artifact_uri
blocked_reason
stale_kind
updated_at
```

## Quality Gates

Before a runtime observability change can be considered accepted:

- A dispatch with only mechanical ACK is visibly different from one with
  semantic progress.
- A `cat_body` task can be traced from workflow dispatch to runtime session or
  ACP turn.
- A new message arriving during active work records one explicit interruption
  classification.
- Artifact rows or references include producing dispatch, stage, reason, and
  evidence refs.
- The console or CLI can show current agent state without reading raw
  transcripts.
- Production incident workflows default to strong observability mode.
- Sensitive payloads are redacted by default, with transcript refs kept as
  governed audit attachments.

## Anti-Patterns

- Treating ACK as task completion.
- Treating heartbeat as task progress.
- Storing only transcripts and forcing operators to reconstruct state by hand.
- Creating a parallel message system outside `trading-agents-workflow`.
- Turning hooks or runtime events into another scheduler.
- Retrying side-effectful tasks automatically without idempotency and
  side-effect ledger checks.
- Recording high-cardinality workflow ids in metrics labels.
- Logging unredacted production payloads, credentials, trading data, or
  incident secrets into telemetry.

## Relationship To Existing Adaptation Plan

This plan extends the existing Claude Code workflow adaptation program:

- It complements first-class phase, agent-run, receipt, operation, and
  dead-letter work.
- It narrows the next observability gap to semantic runtime progress after
  dispatch ACK.
- It should be implemented as additive eventing and read-model surfaces before
  any automatic repair, retry, or scheduling behavior.
