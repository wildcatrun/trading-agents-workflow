# Workflow P28 Archive Checkpoint Writer

Date: 2026-07-20

Scope: replacement slice for v2 Human Gate archive closeout checkpointing.

## Decision

P28 adds `workflow.archive.checkpoint.preview` and the authorized
`workflow.archive.checkpoint` writer. The Human Gate archive branch now uses the
new writer when the selected button is bound to matching v2 plan state.

P28 does not freeze `workflow.checkpoint`. Legacy Human Gate archive closeout
without matching v2 plan state still falls back to the legacy checkpoint writer.

The purpose is to make the archive recovery boundary explicit:

- archive closeout checkpointing must not require legacy `workflow_runs` or
  `workflow_tasks` rows, but a `ready` preview requires matching v2 plan state;
- checkpoint persistence, Human Gate closeout dispatch, Telegram delivery, and
  runtime drain remain separate side-effect boundaries;
- the writer action is named `workflow.archive.checkpoint`, without a
  gratuitous `v2` prefix, because this is a shared recovery boundary for the
  default workflow architecture.

## New Preview Contract

`workflow.archive.checkpoint.preview` accepts:

- `workflowId`
- `planId` as the required v2 plan disambiguator
- `humanGateId`
- `buttonId`
- `decisionStatus`
- optional `nextActions`

It returns `workflow_archive_checkpoint` candidates with:

- `schemaVersion=workflow_archive_checkpoint_record.v1`
- `resumePayloadSchemaVersion=workflow_archive_checkpoint_resume.v1`
- deterministic checkpoint id preview
- evidence refs derived from v2 plan state when available
- `ready` executor status when the write action can run
- `input_required` status when required identifiers or matching v2 plan state
  are missing
- `input_required` status when `workflowId` matches multiple v2 plans but
  `planId` is omitted

The preview advertises writes but performs none:

- no checkpoint row write
- no artifact write
- no artifact index update
- no dispatch
- no Human Gate request
- no Telegram send
- no runtime drain
- no `workflow_runs` / `workflow_tasks` mutation
- no v2 plan/node mutation

## Current Limits

This is deliberately not a parity claim yet.

Remaining R1 work:

1. Decide how explicit legacy `workflow.supervise` compatibility checkpointing
   exits after the escape-hatch window.
2. Add live observation evidence for v2 archive closeout after deployment.
3. Freeze legacy `workflow.checkpoint` only after caller audit and live-state
   evidence prove no active dependency remains.

P29 resolved the operator command-routing question by adding explicit
`workflow-checkpoint --source-class ...` routing. See
`docs/workflow-p29-checkpoint-cli-source-class-routing.md`.

## Regression Evidence

Local regression coverage was added to
`scripts/workflow_regression_tests.mjs` under
`workflow supervisor next actions preview`.

The regression asserts that archive preview and writer:

- is available through `runAction`;
- is read-only and preview-only;
- produces a `workflow_archive_checkpoint` candidate;
- declares the writer as ready only when matching v2 plan state exists;
- does not rely on legacy workflow row shape;
- refuses `ready` status when Human Gate identifiers or matching v2 plan state
  are missing;
- refuses `ready` status when `planId` is omitted, so the writer cannot select
  the first matching plan by accident;
- does not mutate checkpoint, artifact, dispatch, Human Gate, outbox,
  message-flow, operation, task, or run counts.
- writes only checkpoint, artifact, artifact index, and
  `workflow.archive.checkpoint.recorded` event when authorized;
- leaves dispatch, Human Gate, Telegram, runtime drain, legacy run/task, and v2
  plan/node state unchanged;
- retargets v2 Human Gate archive closeout to `workflow.archive.checkpoint`;
- keeps legacy archive closeout on `workflow.checkpoint.legacy_fallback` at P28;
  P33 later retargets this fallback to read-only
  `workflow.checkpoint.legacy_export.human_gate_archive_fallback`.
