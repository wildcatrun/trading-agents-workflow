# Workflow Plan Spec v2

Created: 2026-05-31
Status: draft

`Workflow Plan Spec v2` is the proposed canonical plan artifact for
`trading-agents-workflow`. It adapts the useful Claude Code Dynamic workflow
pattern of an external orchestration plan, but keeps the cat-system execution
model JSON-first, auditable, registry-driven, and Human-Gate safe.

This is a design contract before a runtime migration. Existing Task Launch
Package v1 artifacts and `workflow_tasks` remain valid while this spec is
introduced.

## Purpose

The spec must let an operator, Cat Brain, Cat Claw, and the control loop answer
these questions without replaying chat history:

- What is the workflow trying to achieve?
- Which phases and nodes exist, and in what order?
- Which agent/runtime owns each node?
- What tools or capabilities may the node use?
- What evidence, artifact, receipt, or Human Gate output proves completion?
- Who verifies the output?
- What happens on failure, missing evidence, side-effect uncertainty, pause, or
  termination?
- Where can the workflow resume?

## Top-Level Shape

```json
{
  "schemaVersion": "workflow_plan_spec.v2",
  "meta": {},
  "objective": {},
  "participants": [],
  "phaseGraph": [],
  "nodes": [],
  "acceptance": {},
  "verification": {},
  "humanGatePolicy": {},
  "permissionPolicy": {},
  "evidencePolicy": {},
  "resumePolicy": {},
  "failureRoutes": [],
  "artifacts": {},
  "audit": {}
}
```

## Required Sections

### `meta`

Required fields:

- `workflowId`
- `planId`
- `planRevision`
- `traceId`
- `idempotencyKey`
- `workflowType`
- `riskTier`
- `createdAt`
- `timezone`
- `createdBy`
- `sourceSystem`
- `sourceChannel`
- `sourceMessageId`
- `sourceRefs`

`riskTier` should use the existing governance language:

- `P0`: live trading, production cutover, database migration, secret/OAuth or
  permission expansion, real-money risk.
- `P1`: runtime migration, Gateway/config/model route, cron/heartbeat,
  trade/order/risk-budget, incident-sensitive work.
- `P2`: governance, dry-run, observability, report, workflow automation.
- `P3`: low-risk housekeeping.

### `objective`

Required fields:

- `summary`
- `problemStatement`
- `successCriteria`
- `stopCondition`
- `outOfScope`
- `tradingImpact`
- `freshnessRequirements`

`successCriteria` must be checkable by a verifier. Avoid vague criteria such as
"looks good" or "agent reports success".

### `participants`

Each participant must be resolved through `runtime_agents`:

```json
{
  "agentId": "main",
  "role": "chair",
  "platform": "openclaw",
  "workflowIngressAdapter": "openclaw_native",
  "executionIdentity": "openclaw_native",
  "canReceiveDispatch": true,
  "registrySnapshotRef": "registry/runtime-agents.snapshot.json",
  "capabilities": {},
  "toolPolicy": {},
  "protected": false,
  "responsibilities": [],
  "constraints": []
}
```

Required roles for cross-agent governance workflows:

- Cat Brain `main`: chair, semantic decomposer, plan synthesizer, incident
  commander, next-round owner.
- Cat Claw `cat_claw`: secretary, evidence auditor, Human Gate submitter,
  Flashcat-facing reporter.
- Domain agents: scoped execution and evidence owners.
- Verifier/refuter agents when completion cannot be deterministically checked.

### `phaseGraph`

Each phase is a stage boundary and may contain multiple nodes:

```json
{
  "phaseId": "phase.scope",
  "phaseKey": "scope",
  "ordinal": 10,
  "status": "planned",
  "objective": "Confirm scope, source, participants, and runtime registry.",
  "dependsOn": [],
  "successCondition": "All required participants resolve through runtime_agents and open questions are recorded.",
  "evidenceRequired": [],
  "verifierAgent": "main",
  "humanGateRequired": false,
  "rollbackPolicy": {}
}
```

Initial standard phases:

- `scope`
- `evidence_collection`
- `responsibility_self_check`
- `cross_discussion`
- `consumer_requirements`
- `plan_synthesis`
- `secretary_audit`
- `human_gate_package`
- `execution_or_rollout`
- `closeout`

Not every workflow needs every phase, but omitted governance phases must be
intentional.

### `nodes`

Nodes are the executable or reviewable units inside phases.

Required fields:

- `nodeId`
- `phaseId`
- `nodeType`
- `ownerAgent`
- `runtime`
- `agentId`
- `dependsOn`
- `inputRefs`
- `prompt`
- `allowedCapabilities`
- `expectedArtifacts`
- `receiptRequired`
- `humanGateRequired`
- `timeoutSeconds`
- `retryPolicy`
- `maxAttempts`
- `acceptanceCriteria`
- `policyGate`
- `sideEffectPolicy`
- `verifier`
- `failureRoute`
- `idempotencyKey`

Allowed initial `nodeType` values:

- `worker`
- `verifier`
- `refuter`
- `reducer`
- `secretary_audit`
- `human_gate`
- `checkpoint`
- `side_effect_review`

### `acceptance`

This section defines workflow-level completion, not just task completion:

```json
{
  "workflowSuccess": [],
  "phaseSuccessDefaults": [],
  "requiredReceipts": [],
  "requiredArtifacts": [],
  "requiredHumanGates": [],
  "blockedIf": [],
  "completeOnlyIf": []
}
```

Completion must require evidence. A worker's own natural-language confidence is
not sufficient for high-risk work.

### `verification`

Required fields:

- `mode`: `deterministic`, `reviewer_agent`, `refuter_agent`,
  `multi_agent_vote`, or `human_gate`.
- `verifierAgent`
- `refuterAgent`
- `rubric`
- `minimumEvidence`
- `failureHandling`

Trading-related verification should include freshness, risk-decision,
side-effect, and rollback checks.

### `humanGatePolicy`

Required for any workflow that may ask Flashcat to approve, pause, or terminate
work:

- `required`
- `submitterAgent`
- `reviewerAgent`
- `language`
- `optionsMinimum`
- `requiredControls`
- `requiresOriginalWords`
- `buttonStylePolicy`
- `deliveryPolicy`
- `resumeTarget`
- `rollbackBoundary`

Defaults:

- `language`: `zh-CN`
- `optionsMinimum`: `3`
- `requiredControls`: `pause_workflow`, `terminate_workflow`
- plan buttons use `success`
- pause uses `primary`
- reject/terminate use `danger`

### `permissionPolicy`

Define policy gates before high-risk work:

```json
{
  "defaultOutcome": "allow",
  "gates": [
    {
      "capability": "gateway.restart",
      "outcome": "requires_human_gate",
      "riskTier": "P1"
    }
  ]
}
```

Policy outcomes:

- `allow`
- `deny`
- `requires_human_gate`
- `requires_cat_claw_audit`
- `requires_freshness_check`

### `evidencePolicy`

Required fields:

- `artifactRefs`
- `receiptRefs`
- `messageFlowRefs`
- `outboxRefs`
- `sideEffectRefs`
- `incidentRefs`
- `readinessRefs`
- `checkpointRefs`

Evidence refs should point to durable paths, ids, or receipt rows. Do not embed
large raw logs directly in the plan.

### `resumePolicy`

Required fields:

- `checkpointBeforeHumanGate`
- `checkpointBeforeSideEffect`
- `checkpointAfterRuntimeReceipt`
- `reuseCompletedNodes`
- `invalidateOn`
- `resumeFrom`
- `sideEffectUncertainHandling`

Resume must continue from durable state, not from chat memory.

### `failureRoutes`

Each route defines what happens when a node or phase fails:

```json
{
  "routeId": "missing_receipt",
  "match": {
    "status": "needs_evidence"
  },
  "action": "return_to_evidence_collection",
  "ownerAgent": "main",
  "humanGateRequired": false,
  "incidentRequired": false
}
```

Common actions:

- `retry_node`
- `rerun_phase`
- `return_to_evidence_collection`
- `create_incident`
- `request_human_gate`
- `pause_workflow`
- `terminate_workflow`
- `mark_side_effect_uncertain`

## Mapping To Current Tables

| Spec Concept | Current Surface | Future First-Class Surface |
| --- | --- | --- |
| Workflow | `workflow_runs` | `workflow_runs` |
| Phase | `workflow_tasks.phase`, `workflow_runs.current_phase` | `workflow_phases` |
| Node | `workflow_tasks` | `workflow_tasks` plus node metadata |
| Agent run | `mixed_meeting_dispatches`, `runtime_runs`, `workflow_session_runs` | `workflow_agent_runs` |
| Receipt | runtime/message/outbox/Human Gate/side-effect tables | `workflow_receipts` index |
| Operation | `bridge/console-operations.jsonl` | `workflow_operations` |
| Tool span | runtime payloads | `workflow_tool_calls` |
| Evidence pack | multiple read APIs and artifacts | evidence export bundle |

## Initial Validation Gates

A Plan Spec v2 draft is invalid if:

- `workflowId`, `traceId`, or `idempotencyKey` is missing;
- a participant cannot be resolved through `runtime_agents`;
- a node targets an agent/runtime pair that is not dispatch-capable;
- a node has no acceptance criteria;
- a Human Gate package lacks A/B/C options, pause, terminate, Chinese
  Flashcat-facing text, or original-words requirement;
- a high-risk capability has no permission policy;
- a side-effect node lacks idempotency and rollback/uncertainty handling;
- no checkpoint exists before Human Gate or high-risk side effects.

## Non-Goals

- Do not run arbitrary workflow JavaScript.
- Do not replace `runtime_agents`.
- Do not replace Human Gate with local console clicks.
- Do not make Cat Claw invent missing plan options.
- Do not treat runtime ACK as user-visible delivery.
- Do not treat worker prose as independent verification.
