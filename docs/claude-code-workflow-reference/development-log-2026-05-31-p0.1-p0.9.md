# Development Log 2026-05-31 P0.1-P0.9

This log records the first implementation batch for adapting Claude Code
Dynamic workflow ideas into `trading-agents-workflow`.

The work stayed inside the existing plugin and existing workflow console. No
second console, second scheduler, arbitrary workflow JavaScript runtime, or
direct business-table intervention control was added.

## Objective

Build the auditable closure layer needed before autonomous workflow execution
can be trusted in cat-system and future live-trading scenarios:

- externalized plan structure;
- first-class phase and agent-run observability;
- unified receipt/evidence views;
- Human Gate readiness checks;
- durable operation audit records;
- controlled intervention previews.

## Completed Work

### P0.1 Plan Spec v2

Implemented `spec.planSpecV2` in the task draft / launch package path.

The plan artifact now describes objective, stop condition, participants, phase
graph, nodes, evidence, Human Gate policy, resume policy, and failure routes.
It is additive: Task Launch Package v1 remains the task materialization source
of truth.

### P0.2 Workflow Phases

Added `workflow_phases` as an additive table and synchronized planned phases
after task-launch approval begins.

The console phase view prefers `workflow_phases` but falls back to
`workflow_tasks.phase` for older workflows.

### P0.3 Workflow Agent Runs

Added `workflow_agent_runs` as an index/read-model table.

Runtime runs and workflow session runs mirror into agent-run rows. Dispatch,
runtime, and session-run tables remain authoritative.

### P0.4 Phase Evidence Chains

The phase view now links phase -> task -> dispatch -> runtime/session run ->
agent run -> receipt reference.

This gives operators a single phase card for progress and evidence inspection.

### P0.5 Unified Receipts

Added derived endpoint and console tab:

- `GET /api/workflows/:workflowId/receipts`
- `Receipts`

This is a derived read model over existing ledgers, not a durable
`workflow_receipts` authority table.

### P0.6 Evidence Pack Export

Added derived endpoint and console tab:

- `GET /api/workflows/:workflowId/evidence-pack`
- `Export`

The browser downloads JSON. The server does not write an export artifact yet.

### P0.7 Human Gate Readiness

Added derived endpoint and console tab:

- `GET /api/workflows/:workflowId/human-gate-readiness`
- `Gate Readiness`

The checklist checks Human Gate record linkage, A/B/C options, pause and
terminate controls, Chinese body, option details, checkpoint/artifact/receipt
evidence, Cat Claw path, Telegram delivery observation, and Flashcat original
words after selection.

It does not submit Human Gate or mutate workflow state.

### P0.8 Workflow Operations Audit

Added durable `workflow_operations`.

Console preview actions and rejected actions now write DB audit rows in
addition to the compatibility JSONL log. Preview results are stored in
`preview_result_json`.

Hardening added:

- text-level token redaction, including `tawhg:`, `Bearer`, `token=...`, and
  short space-delimited forms such as `token abc`;
- partial legacy `workflow_operations` schema repair and read fallback;
- workflow-scoped operations summary in the console.

### P0.9 Controlled Intervention Previews

Added preview-only actions:

- `workflow.pause.preview`
- `workflow.resume.preview`
- `workflow.stop.preview`
- `workflow.rerun.agent.preview`
- `workflow.rerun.phase.preview`

The Operations tab exposes preview buttons for pause, resume, stop, and rerun
current phase. The API also supports rerun-agent preview.

These previews return eligibility, risk tier, Human Gate requirement, Cat Claw
audit requirement, target scope, counts, latest checkpoint, violations,
warnings, and limitations.

They do not update workflow state, dispatch runtime jobs, submit Human Gate,
reset tasks, drain runtimes, deliver Telegram messages, or perform real reruns.
Real `workflow.pause`, `workflow.resume`, `workflow.stop`, and rerun writes
remain outside the console allowlist.

## Review And Quality Gates

Independent subagent reviews were used during the batch. Later reviews
prioritized `gpt-5.3-codex-spark` for short, bounded checks.

Important review findings fixed:

- Plan Spec v2 contract shape was incomplete.
- Phase sync initially happened too early.
- Agent-run mirroring could lose dispatch/session linkage.
- Phase and receipt read models had legacy-schema and broad-match gaps.
- Evidence pack / readiness paths could leak token-like text.
- `workflow_operations` needed partial-schema repair and stronger redaction.
- Intervention preview needed explicit confirmation that real write actions
  were not opened.

Latest review state:

- P0.8 post-fix Spark blocker review: PASS.
- P0.9 Spark review: PASS.
- P0.9 review residuals were addressed:
  - intervention preview now guards optional evidence tables/columns;
  - workflow console safety documentation now lists the expanded preview
    allowlist instead of only the first two preview actions.

## Verification

Commands passed after P0.9:

```bash
npm run test:regression
npm run check
git diff --check
```

Regression coverage includes:

- Human Gate readiness positive path and legacy missing-schema fallback;
- exact workflow id matching and token redaction in readiness/evidence paths;
- workflow operations DB audit writes and rejected action records;
- partial legacy `workflow_operations` schema compatibility;
- controlled intervention preview actions;
- true write rejection for `workflow.stop`;
- no workflow-state mutation after intervention previews.

## Plan Alignment Review

### Aligned

- Work stayed inside the existing console and plugin.
- No parallel scheduler or control plane was added.
- Plan state, phase state, agent-run observability, receipt/evidence views,
  Human Gate readiness, and operation auditability all match the P0 intent.
- Intervention work stayed preview-only, consistent with the plan's boundary
  that real writes must wait for transition checks and Human Gate policy.
- Console controls are operator previews, not direct execution controls.

### Intentional Sequencing Differences

- P0.4 in the original plan proposed a future durable `workflow_receipts`
  table. The implementation deliberately created a derived receipts view first.
  Reason: specialized ledgers are still authoritative, and a premature receipt
  authority table would risk duplicated truth.
- Evidence pack export appeared later in the original P2 list, but a read-only
  browser-side evidence pack was added in P0. Reason: it was low-risk and
  directly supports Human Gate readiness and audit.
- Human Gate readiness was not a separate numbered P0 item in the initial
  outline, but it was implemented before real intervention writes. Reason:
  Human Gate quality is a hard boundary for cat-system operations.
- Controlled intervention previews were listed under P1.4, but preview-only
  pause/resume/stop/rerun was implemented as P0.9 after `workflow_operations`.
  Reason: it is non-mutating and validates the operation audit base before any
  real control is exposed.

This reorders a subset of the original P1.4 scope; it does not mark all P1.4
complete. Exact runtime-drain retry preview and Human Gate package-generation
preview remain P1.4 work.

### P0.7 Console Mapping

The original P0.7 names did not map one-to-one to final tab names:

- `Phase Progress tab` -> `Phases`.
- `Acceptance / Evidence tab` -> partially covered by `Receipts`, `Evidence`,
  `Export`, `Gate Readiness`, and phase evidence-chain sections.
- `Human Gate Center compliance summary` -> `Gate Readiness` plus Human Gate
  and Operations summaries.
- `Evidence Pack export preview` -> `Export`.
- `Plan tab` -> not implemented as a dedicated tab yet.
- `Task Launch Package queue` -> not implemented as a dedicated tab yet.

### Remaining Gaps Against Initial Plan

- No durable `workflow_receipts` authority table yet.
- No verifier/refuter result model yet.
- `workflow.supervise.preview` has not fully become a phase/node explanation
  engine; it still mainly wraps advance preview plus would-checkpoint/report
  signals.
- No Plan tab or Task Launch Package queue tab yet; phase, receipts, export,
  Human Gate readiness, and operations are present.
- No persisted server-side evidence-pack artifact or retention policy yet.
- No exact runtime-drain retry preview or Human Gate package generation preview
  yet.
- No dead-letter / stuck-job dedicated observability surface beyond the current
  Operations summary sections.

## Current Risk Boundaries

- `planSpecV2` is additive and not yet the materialization authority.
- `workflow_phases` and `workflow_agent_runs` improve observability but do not
  replace task/dispatch/runtime ledgers.
- Receipts and evidence pack remain derived read models.
- Human Gate readiness is a checklist, not Cat Claw submission.
- Intervention previews are not approvals and not execution.
- Real pause/resume/stop/rerun should not be added without state-transition
  policy, Human Gate execution, rollback/resume semantics, and side-effect
  handling.

## Recommended Next Step

Do not proceed directly to real pause/resume/stop/rerun execution.

The next development step should be P1.1:

- add verifier/refuter result records or a derived verification view;
- connect phase/task acceptance criteria to independent verification;
- expose verification status in the console;
- make Human Gate readiness depend on independent verification evidence where
  applicable.

This better matches the original plan's next high-value gap: autonomous
progress with independent verification.
