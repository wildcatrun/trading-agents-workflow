# Engineering Changes 2026-05-27

This document records the workflow engineering changes made on 2026-05-27.
It is a compact handoff for future development, review, and operations.

## Scope

The work covered three connected areas:

- governed `message_flow` ACK and semantic continuation behavior;
- runtime timeout classification for ACK dispatches;
- Task Launch Package v1 for Cat Claw drafting, Cat Brain review, and
  Flashcat approval before workflow task materialization.

An operations cleanup was also performed after deployment to clear current
in-flight workflow state for observation.

## Commits

- `2630e2d Add message flow ack continuation and task drafting`
- `5f17b17 Fix ACK timeout classification`
- `6fe8f50 Add task launch package workflow`

## Message Flow ACK Contract

`message_flow` now supports a first-turn ACK contract before semantic work:

- the first runtime dispatch requires `ACK_RECEIVED`;
- the ACK timeout is 30 seconds;
- retry delay is 30 seconds;
- the ACK only confirms receipt and integrity, not task completion;
- semantic continuation is sent as a separate dispatch after ACK succeeds;
- local Codex inbox delivery remains receipt evidence only, not Flashcat
  visible delivery or Human Gate completion.

Regression coverage:

- `message_flow immediate ack contract`
- `message_flow immediate ack retry delay`
- `message_flow control-loop runtime drains`

## ACK Timeout Classification

The runtime drain path now classifies killed/timeout ACK dispatches as
`runtime_timeout` before checking stderr or prompt text for permission wording.
This prevents a timed-out ACK prompt that mentions permissions from being
misclassified as `permission_unavailable`.

Observed smoke evidence:

- initial smoke dispatch failed due timeout misclassification;
- manual OpenClaw model call succeeded;
- retry after the fix completed ACK and semantic dispatch;
- semantic output returned `SMOKE_OK`;
- no Telegram outbox was created when `return_policy=silent`.

## Task Launch Package v1

`workflow.task.draft` remains a pure preview. It does not write files, mutate
the database, create tasks, create dispatches, or submit Human Gate requests.

The durable task-launch lifecycle is:

1. `workflow.task.launch.prepare`
   - owned by Cat Claw `cat_claw`;
   - calls the draft normalizer;
   - rejects blocking quality-gate errors;
   - writes canonical JSON and Markdown artifacts under
     `artifacts/task-launch/<workflowId>/`;
   - writes `protocol_objects.object_type='workflow_task_launch_package'`;
   - writes `artifact_index` rows for JSON and Markdown artifacts;
   - creates a pending Cat Brain review gate;
   - does not create workflow tasks or dispatch runtime work.

2. `workflow.task.launch.review`
   - owned by Cat Brain `main`;
   - only valid from `pending_cat_brain_review`;
   - requires explicit review opinion;
   - rejects reviewer impersonation;
   - approved review moves the package to `pending_flashcat_launch`;
   - rejected or revise-required review keeps the package out of launch.

3. `workflow.task.launch.approve`
   - owned by Flashcat through Human Gate, governed GUI, or trusted local
     control plane;
   - requires Flashcat original words;
   - requires package status `pending_flashcat_launch`;
   - materializes the package into `workflow_tasks`;
   - does not auto-dispatch runtime work.

Supporting surfaces:

- CLI:
  - `workflow-task-launch-prepare`
  - `workflow-task-launch-list`
  - `workflow-task-launch-review`
  - `workflow-task-launch-approve`
- MCP:
  - `workflow_task_launch_prepare`
  - `workflow_task_launch_list`
  - `workflow_task_launch_review`
  - `workflow_task_launch_approve`
- Console read API:
  - `GET /api/task-launches`

## Authority Boundaries

- Cat Claw drafts and records the task launch package.
- Cat Brain reviews the package and can reject it back to Cat Claw.
- Flashcat decides whether to launch and must provide original words.
- Approval creates tasks but does not execute them.
- Runtime dispatch remains a separate workflow operation.
- `message_flow` is transport and receipt infrastructure, not the canonical
  task-launch contract.

## Guardrails

- `workflow.task.launch.preview` aliases to the pure preview draft path, not to
  mutating prepare.
- `prepare` cannot overwrite packages that have already passed Cat Brain review
  or launched.
- `prepare`, `review`, and `approve` have separate capabilities.
- Cat Claw governance defaults include prepare, not review or approve.
- Review requires the package reviewer and rejects impersonation.
- Approve rejects packages that have not passed Cat Brain review.
- Approve requires Flashcat original words.
- Approve does not write `mixed_meeting_dispatches`.

## Regression Tests

The full regression suite passed locally before deployment:

- `npm run check`
- `node scripts/workflow_regression_tests.mjs`

New task launch coverage:

- `workflow task launch prepare and approve`
- `workflow task launch review permissions`

Deployment verification on the development server also passed:

- `npm run check`
- isolated smoke:
  - prepare -> review -> approve;
  - package status became `launched`;
  - `workflow_tasks` were created;
  - `mixed_meeting_dispatches` stayed `0`.

## Deployment

GitHub and the development-server active checkout were aligned to:

`6fe8f508a3905c545b9d8c39247a5d32c3cabd6f`

Deployment path:

1. local staging commit;
2. push to GitHub `main`;
3. development server active checkout `git fetch` / `git pull --ff-only`;
4. syntax check and isolated smoke.

OpenClaw Gateway was not restarted.

## In-Flight State Cleanup

After deployment, Flashcat requested clearing all workflow tasks currently in
flight to observe later behavior from a clean state.

Backup:

`/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/codex-working/20260527T223052+0800-workflow-clear-inflight/backups/tracking-before-clear.db`

Audit event:

`workflow.inflight_cleared`

Final counts were zero for:

- active workflow runs;
- pending/in-progress/blocked workflow tasks;
- queued/sent dispatches;
- running runtime runs;
- in-flight message flows;
- pending Human Gates and active buttons;
- queued Telegram outbox;
- in-flight control loop jobs;
- pending review gates;
- pending task launch packages.

## Follow-Up

- Wire task launch packages into the visible GUI task launch queue.
- Bind `workflow.task.launch.approve` directly to token-bound Human Gate button
  records or an equivalent governed GUI approval record.
- Add a revision flow for packages rejected by Cat Brain instead of overwriting
  an existing package id.
- Revisit this design when Claude Code publishes complete Workflow user
  documentation.
