# Kimi Agent Swarm Reference

- date: 2026-05-18
- area: workflow fan-out/fan-in orchestration
- source reference: Kimi K2.6 Agent Swarm public help center and product material

## Useful Pattern

Kimi Agent Swarm emphasizes horizontal scaling:

- the main agent decomposes a large objective
- many sub-agents work in parallel
- progress is visible as a task list
- final deliverables are synthesized from shard outputs
- the user observes, previews, confirms, or continues

The useful lesson for `trading-agents-workflow` is not unlimited spawning. The useful lesson is governed fan-out/fan-in: split work into bounded shards, keep each shard durable, assign workers, collect receipts, reduce results, then continue through the supervisor loop.

## Cat-System Mapping

The cat system has fixed professional boundaries, so it should not copy Kimi's "no predefined roles" posture. Instead:

- Cat Brain `main` owns objective decomposition and reducer orchestration.
- Cat Eyes, Cat Ears, Cat Nose, Cat Body, and other agents receive bounded shard tasks within their roles.
- Cat Claw reports the synthesized next-action package and Human Gate requests.
- Cat Heart remains the decision authority.

## Change

Added `workflow.swarm.plan`:

- creates or reuses a durable workflow run
- converts explicit targets/shards into parallel `workflow_tasks`
- round-robins shard tasks across a declared worker pool
- creates a reducer task depending on all shard tasks
- leaves execution, receipt sync, checkpointing, and reporting to `workflow.supervise`

This pairs Kimi-style swarm decomposition with the wanman-style supervisor loop already added to the plugin.
