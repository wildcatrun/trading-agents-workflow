# Workflow Supervisor Loop

- date: 2026-05-18
- area: trading-agents-workflow durable execution
- trigger: Flashcat clarified that the live wanman.ai product is more advanced than the public early GitHub version and should be the stronger reference point.

## Finding

The plugin had durable workflow runs, tasks, dispatches, checkpoints, and runtime bridges, but the control loop was still too manual:

- `workflow.advance` could create dispatches but did not by itself close the loop after runtime ack/failure.
- Runtime dispatch status was visible, but workflow tasks could remain `in_progress` until another actor manually interpreted receipts.
- Cat Claw reporting was a role rule, not a supervisor-enforced next step.
- Context overflow recovery existed through checkpoints, but checkpoint creation was not part of the normal advancement cycle.

This produced the failure mode Flashcat observed: agents could discuss or a dispatch could stall, but the system did not reliably produce the next action package and continue pushing.

## Live Wanman Lesson Applied

Treat the public wanman GitHub repository as an early architecture reference only. The useful operational pattern from the live product is the observer-mode supervisor loop:

1. Maintain a durable task pool.
2. Assign work to agents.
3. Consume runtime results.
4. Update task state from receipts.
5. Decide the next transition.
6. Create artifacts/checkpoints.
7. Escalate to the human only with a concrete next-action package.

## Change

Added `workflow.supervise`:

- syncs acked/failed dispatches back to `workflow_tasks`
- runs `workflow.advance`
- optionally drains runtime bridge queues
- creates a checkpoint every cycle
- creates a Cat Claw report dispatch when the workflow is blocked, waiting for Human Gate, or ready for secretary close-out

Cat Claw reports default to Flashcat Telegram private chat `8390724843` through the existing agent/reporting rule; the supervisor only creates the governed dispatch and does not introduce a parallel messaging system.

## Boundary

The supervisor does not make trading decisions, bypass Human Gate, restart Gateway, execute production deployments, or directly send unmanaged Telegram messages. It is a workflow advancement primitive inside the plugin.
