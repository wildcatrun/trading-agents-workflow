# Workflow Public Action Naming Policy

Updated: 2026-07-17

## Purpose

Public workflow action names are part of the control-plane contract. They should
describe durable workflow infrastructure semantics, not temporary migration
version labels.

## Policy

- Long-term public action names must use stable semantic namespaces such as
  `workflow.supervisor.*`, `workflow.template.*`, `workflow.worker.*`,
  `workflow.human_gate.*`, `message_flow.*`, or other domain names that describe
  the infrastructure responsibility.
- `workflow.v2.*` is a migration isolation namespace only. It is acceptable while
  v1 and v2 implementations coexist and similar actions need collision-free
  routing, but it must not be treated as the final public API shape.
- New replacement surfaces added after the v1 retirement audit should prefer the
  final semantic name first. A `workflow.v2.*` alias or compatibility action may
  exist only to bridge existing callers during migration.
- Internal source directories may remain `src/workflow-v2/` during the migration
  period. Directory names are implementation structure, not the public action
  contract.
- Public docs must identify transitional `workflow.v2.*` names as migration
  compatibility where a final semantic action also exists.
- Freezing or deleting legacy v1 actions still requires evidence that the final
  semantic replacement covers the audited behavior. Renaming alone is not a
  retirement criterion.

## Current Migration Interpretation

- `workflow.v2.readiness.preview` remains available for compatibility.
- The preferred long-term readiness surface is
  `workflow.supervisor.readiness.preview`.
- New supervisor replacement previews should use
  `workflow.supervisor.<capability>.preview` as the canonical public name, with
  `workflow.v2.*` only as an alias when needed.
