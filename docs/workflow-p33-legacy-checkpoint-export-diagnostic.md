# Workflow P33 Legacy Checkpoint Export Diagnostic

Date: 2026-07-20

## Scope

P33 converts the remaining compatibility paths that used the legacy
`workflow.checkpoint` writer into read-only export/diagnostic paths.

This slice does not delete `workflow.checkpoint`; it removes the known caller
dependencies that still wrote through it.

## New Action

`workflow.checkpoint.legacy_export` reads old `workflow_runs` /
`workflow_tasks` recovery state and returns the same recovery-shaped payload
without writing:

- no `workflow_checkpoints` row;
- no checkpoint JSON/Markdown artifact;
- no `artifact_index` row;
- no workflow layout initialization on missing DB/fresh root.

Result shape:

- `schemaVersion=workflow_checkpoint_legacy_export_result.v1`
- `status=exported | missing_db | missing_legacy_workflow`
- `mutating=false`
- `writeBlocked=true`
- `didWriteCheckpoint=false`
- `didWriteArtifact=false`
- `didUpdateArtifactIndex=false`
- `didInitializeLayout=false`

## Retargeted Paths

- Operator `workflow-checkpoint --source-class legacy_compat_checkpoint` now
  routes to `workflow.checkpoint.legacy_export`.
- Legacy `workflow.supervise` escape-hatch checkpointing now calls
  `workflow.checkpoint.legacy_export` and reports
  `checkpointPath=workflow.checkpoint.legacy_export.legacy_supervise_escape_hatch`.
- Human Gate archive closeout fallback now calls
  `workflow.checkpoint.legacy_export` and reports
  `archiveCheckpointPath=workflow.checkpoint.legacy_export.human_gate_archive_fallback`.

## Remaining Writer

At P33, `workflow.checkpoint` still existed as a guarded legacy writer for
direct API compatibility until P34. After P33, no known source call-site
required it for operator recovery, legacy supervise, or Human Gate archive
fallback.

P34 freezes that remaining writer into a non-mutating diagnostic; this section
is retained as the P33 transition record.

## P34 Readiness

P34 can freeze `workflow.checkpoint` only after regression and release smoke
confirm:

- `workflow.checkpoint.legacy_export` preserves recovery payloads read-only;
- v2 supervisor checkpoints still write through `workflow.supervisor.checkpoint`;
- v2 Human Gate archive checkpoints still write through
  `workflow.archive.checkpoint`;
- no source call-site writes through `workflowCheckpoint(...)`.
