# Workflow v2 Worker Runtime Backends

Status: requirements plus authorized WSL testbed smoke, not runtime code
Created: 2026-07-03
Updated: 2026-07-13
Scope: worker runtime assumptions for the v2 orchestration kernel

## Purpose

This document records Flashcat's current worker runtime direction and the first
authorized `wsl-agents` Docker smoke testbed. It does not connect any worker to
production workflow state, change OpenClaw, or make Docker a cat-member runtime.

No instruction in this document is standing execution authorization. Further
container, network, model, secret, server, production, or workflow-queue actions
require explicit Flashcat approval for that round.

The key decision is that worker execution should not be centered on the
development server or OpenClaw. The development server remains the control
plane. Heavy or sandboxed worker execution can later run on the local
workstation, especially inside `wsl-agents` Docker sandboxes, after explicit
authorization.

## Captured Requirements

- OpenClaw is not a worker runtime backend.
- OpenClaw remains Gateway, IM ingress, OpenClaw-native cat member runtime, Cat
  Claw/Cat Brain path, Human Gate delivery path, and legacy route/governance
  surface.
- Worker runtime should prefer Hermers and Claude Code.
- `wsl-agents` can provide Docker sandbox workspaces for worker testbeds.
- Docker is the sandbox and capability packaging layer, not the default agent
  brain.
- The current worker backend classes are only Hermers Docker worker and Claude
  Code Docker worker.
- The orchestration design target is 200 concurrent worker runs across the
  worker pool. This is a queue/capacity/lease target, not a requirement that one
  prompt, one session, one container, or one host perform 200 heavy tasks at
  once.
- Each worker context window is capped at 64k tokens. Task allocation must fit
  inside that window with margin for tool output and receipts.
- Do not assign heavy monolithic tasks to a worker. Split large jobs into
  bounded nodes, use information-stack pointers, and pass artifact refs instead
  of long inline context.
- `wsl-models` provides GPU/model API capability when needed.
- Do not plan specialized tool containers in the current round.
- Do not plan GPU worker containers in the current round.
- Tooling can be installed inside Hermers worker containers, Claude Code worker
  containers, or their base Docker images.
- Worker containers must not become durable cat members.
- Worker containers must not write the central workflow SQLite database
  directly.
- Worker output must return through governed receipts, artifacts, information
  stack refs, and manager review.

## Target Control/Data Plane Split

```text
dev-server
  OpenClaw Gateway
  trading-agents-workflow control plane
  workflow DB / registry / receipt / Human Gate
  Cat Brain and Cat Claw governance path

local-workstation wsl-agents
  Docker sandbox environment
  flashcat/hermes-worker:20260704
  flashcat/claude-code-worker:20260704
  claude-code-worker-001 smoke container

wsl-models
  GPU/model API provider
  not a workflow worker runtime in this round
```

The control plane remains on the development server. The worker pool may later
run on the workstation because the development server has limited compute, while
the workstation has significantly larger CPU, memory, and GPU capacity.

## Current Workflow Interface

The local v2 control plane now exposes the adapter-job bridge and a bounded
external-command runner protocol. It still does not start WSL, Docker, Hermers,
Claude Code, Gateway, production queues, or model calls by itself:

- `workflow.v2.control_loop.tick` can lease a non-local worker into `running`
  with status `leased_waiting_adapter`.
- `workflow.v2.worker_adapter_job.preview` validates the active lease, session
  run, backend preflight, and supported Docker worker backend, then builds a
  runner manifest.
- `workflow.v2.worker_adapter_job.record` writes the manifest as a JSON
  artifact, records an information-stack pointer for the future runner, and
  creates a durable `workflow_v2_worker_adapter_jobs` queue row.
- `workflow.v2.worker_adapter_job.list` lets operators inspect queued, running,
  retry, terminal, or backend-filtered adapter jobs without mutating state.
- `workflow.v2.worker_adapter_job.claim` is the pull-runner entry point. It
  only leases queued/retry adapter jobs whose underlying worker is still
  `running`, still on the same worker attempt, and still under an unexpired
  worker lease.
- `workflow.v2.worker_adapter_job.heartbeat` extends a runner lease;
  `workflow.v2.worker_adapter_job.release` returns the job to
  `retry_scheduled`; `workflow.v2.worker_adapter_job.fail` records runner
  failure and either schedules a runner retry or marks the adapter job failed.
  Terminal adapter-job failure also marks the worker/session failed through the
  governed worker fail path, so the worker does not wait for lease expiry.
- The manifest includes `workflow_session_runs.workerInput`, task input info
  id, backend image/profile, lease proof, 64k context cap, and the required
  `workflow.v2.worker_result.submit` / `workflow.v2.worker_result.fail` return
  path.
- Recording a manifest leaves the worker row in `running`. The worker is not
  complete until a later adapter-facing submit/fail action returns governed
  output or failure evidence.
- Runner actions never grant direct database-write authority to the worker
  container. A real runner should treat the manifest as input, write artifacts
  through governed return paths, and submit/fail through workflow actions.
  Submit/fail calls that bind an `adapterJobId` must include both worker lease
  proof and the current adapter-job runner lease proof.
- `workflow.v2.adapter_runner.preview` and `workflow.v2.adapter_runner.drain`
  are available as local runner bridges. The default `mock` mode claims due
  adapter jobs, reads the manifest artifact, writes a mock output artifact, and
  returns through the governed submit/fail actions. The `external_command` mode
  claims the same jobs but delegates execution to an explicitly configured local
  command wrapper. That wrapper receives a request JSON file and output JSON
  file path, then returns `success`, `fail`, or `release`. The workflow process
  records the normalized output artifact and still performs all central DB
  writes through governed submit/fail/release actions.
- `external_command` mode is intended as the integration boundary where future Hermers and
  Claude Code Docker wrappers can be attached. It is not itself a Docker,
  Hermers, Claude Code, WSL, Gateway, or model invocation.
- External runner commands are supplied only through environment configuration,
  such as `TRADING_AGENTS_WORKFLOW_V2_HERMERS_DOCKER_WORKER_RUNNER_CMD`,
  `TRADING_AGENTS_WORKFLOW_V2_CLAUDE_CODE_DOCKER_WORKER_RUNNER_CMD`, or the
  generic `TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_CMD`. Action payload fields
  such as `runnerCommand` / `externalRunnerCommand` are rejected to avoid
  caller-selected host command execution. Commands are executed with `execFile`,
  not shell interpolation; command strings with spaces are rejected unless
  supplied as a JSON array in the environment variable.
- The runner requires a stored manifest hash and fails closed on missing or
  mismatched manifest hashes. Structural runner errors default to terminal
  adapter/worker failure unless retry is explicitly enabled.
- `scripts/workflow_v2_external_runner_smoke.mjs` exercises the first
  process-level external runner loop with a governed dummy wrapper. The smoke
  creates a v2 worker, leases it, records an adapter job, invokes
  `external_command`, captures the external output artifact, and verifies that
  the worker reaches `submitted_for_review` through
  `workflow.v2.worker_result.submit`. The dummy wrapper is intentionally not a
  Hermers, Claude Code, Docker, WSL, Gateway, or model invocation; it exists to
  freeze the adapter command contract before a real wrapper is authorized. The
  smoke uses the existing generic-orchestration diagnostics override inside its
  own process because it builds an isolated temporary workflow instead of an
  approved production template plan.
- `scripts/workflow_v2_external_runner_dry_run.mjs` is the first
  real-wrapper-shaped dry run. It validates the request schema, adapter manifest
  schema, runtime backend, session-input binding, submit/fail return path, 64k
  context cap, and Docker side-effect-disable flags, then returns a structured
  dry-run receipt through the same external-command output contract. It does
  not start Hermers, Claude Code, Docker, WSL, Gateway, or any model call.
  `npm run smoke:v2-external-runner-dry-run` runs this path end to end and
  still expects the worker to reach `submitted_for_review` only through
  `workflow.v2.worker_result.submit`.
- `npm run smoke:v2-external-runner-plan-only` runs the same wrapper with
  `--plan-only`. In addition to dry-run contract checks, it renders the future
  worker wrapper command plan and planned workspace/log/artifact paths into the
  runner output. The rendered commands are `executesInThisSmoke=false` plan
  data and are not authorization to start containers, mount secrets, call
  models, expose ports, or write the central workflow database.
- `scripts/workflow_v2_external_runner_execute_guard.mjs` is the first
  real-wrapper skeleton. By default it validates the same request and manifest,
  renders an execute-guard plan, and returns `release` instead of `success`, so
  the adapter job is rescheduled and the worker is not marked complete. It
  refuses execution unless a future explicitly authorized path supplies all
  three gates: `--execute`,
  `TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE=1`, and a structured
  `TRADING_AGENTS_WORKFLOW_V2_REAL_RUNNER_EXECUTE_AUTH_JSON` Human Gate
  authorization object. The authorization object must bind the Human Gate id,
  Cat Claw audit id, package id, selected synthetic execute option, Flashcat
  original words, workflow/plan/job/worker ids, `syntheticOnly=true`,
  `allowSecrets=false`, `allowTrading=false`, `networkMode=none`,
  `maxActiveJobs=1`, and an unexpired expiry timestamp. Even when all gates are
  present, this wrapper still returns `release` with
  `executor_not_implemented_after_authorization_gate`; no container, model,
  WSL, Gateway, or trading side effect is executed. `npm run
  smoke:v2-external-runner-execute-guard` verifies default fail-closed behavior,
  `npm run smoke:v2-external-runner-execute-guard-authorized` verifies the
  Human Gate authorization contract while still refusing real execution, and
  the negative variants verify missing environment gate, missing authorization
  JSON, missing binding, missing workflow/plan/worker binding, worker-run
  mismatch, malformed JSON, and non-object JSON. Under-bound or malformed
  authorization standardizes to `human_gate_authorization_required`; a missing
  environment gate standardizes to
  `execute_requested_without_environment_gate`.
- `scripts/workflow_v2_runner_execute_human_gate_package.mjs` renders the
  Chinese Human Gate authorization package for any future real wrapper execute
  path. It lists the two decision options, Docker host boundary, image digest
  evidence, secret policy, network policy, log/artifact paths, max concurrency,
  expiry, rollback, and receipt expectations, then validates the package through
  `workflow.v2.human_gate_package.preview`. `npm run
  smoke:v2-runner-execute-hgate-package` only writes JSON/Markdown draft
  artifacts; it does not execute a worker wrapper.
- `scripts/workflow_v2_runner_execute_human_gate_request_smoke.mjs` exercises
  the formal Cat Claw-to-Human Gate bridge for the runner execute package. It
  records a Cat Claw `protocol_ready` audit, records a `cat_claw_audited`
  package, previews and creates the pending v2 Human Gate request, verifies that
  preview is read-only, and simulates selecting the "keep execute disabled"
  option through the token-bound button flow. Its persisted smoke artifact is
  sanitized and records only token-presence booleans; it does not write callback
  tokens, deliver Telegram, dispatch runtime jobs, or execute a worker wrapper.
- `scripts/workflow_v2_runner_execute_human_gate_delivery_preview_smoke.mjs`
  extends the same Cat Claw request path into Telegram outbox delivery
  governance. It verifies that the queued `human_gate_request` outbox targets
  Flashcat's private Telegram chat through the `cat_claw` account, has five
  buttons, and is eligible for `telegram.outbox.delivery` only with an operator
  reason and Cat Claw audit evidence. Human Gate request delivery is fixed to
  the OpenClaw message-send path even when the payload carries inline keyboard
  metadata; it must not read bot credentials or use the direct Bot API WebApp
  candidate. It also previews queued/no-requeue, failed/retry,
  stale-delivering/reclaim, and sent/idempotent-replay branches.
  The smoke restores the outbox to `queued`, persists only sanitized summaries,
  and does not send Telegram, create parallel Human Gate records, dispatch
  runtime jobs, touch trading state, or execute a worker wrapper.
- `scripts/workflow_v2_runner_execute_human_gate_delivery_guard_smoke.mjs`
  fixes the execution-entry guard for that same delivery path. It creates an
  isolated `human_gate_request` outbox fixture and calls `telegram.outbox.delivery`
  only on fail-closed cases: missing idempotency key, missing delivery operator
  reason, missing Cat Claw audit evidence, missing Telegram target, and
  incomplete Human Gate button structure. Each blocked case must leave the outbox
  queued and unsent. The only non-blocking delivery action in this smoke is a
  `sent` idempotent replay, which must return without sending Telegram or
  updating the outbox. It does not execute queued delivery.
- `scripts/workflow_v2_runner_execute_human_gate_gateway_delivery_smoke.mjs`
  is the first Cat Claw Human Gate Gateway-delivery harness for a one-message
  smoke. Default release-smoke mode is preview-only: it creates an isolated
  queued outbox, proves the Cat Claw outward delivery candidate uses the
  OpenClaw message-send path rather than direct bot API delivery, and exits
  without sending. Real Gateway delivery requires both `--deliver` and
  `TRADING_AGENTS_WORKFLOW_ALLOW_OPENCLAW_GATEWAY_DELIVERY_SMOKE=1`; when those
  gates are absent, the outbox must remain `queued` and no delivery execution
  event is written. This harness validates only the Cat Claw / Human Gate
  outward-notification exit; it does not replace cross-platform `message_flow`,
  runtime dispatch, runtime receipt, or worker execution. The smoke also carries
  an inline-keyboard fixture and proves Human Gate request delivery remains
  Gateway-only rather than direct Bot API. It snapshots `message_flows` and
  `message_flow_events` row counts and seeds a negative control where a
  `human_gate_request` outbox incorrectly carries a `messageFlowId`; the
  delivery mark path must leave that flow row and its event count unchanged, so
  OpenClaw message-send cannot silently stand in for cross-platform
  `message_flow` closure. The delivery execution path follows the existing
  outbox action's runtime receipt persistence rules; smoke stdout and persisted
  smoke artifacts must include only sanitized delivery status/counts and
  redacted or hashed targets, never callback tokens or raw transport receipts.
- The mock runner bridge is capacity-aware. `maxLogicalWorkers` describes the
  logical queue/fan-out target, while `backendMaxActiveJobs` and
  `modelMaxConcurrentCalls` / `providerMaxConcurrentCalls` define physical
  execution slots. `workflow.v2.adapter_runner.preview` and `drain` return a
  `capacity` object with `requestedLimit`, `effectiveLimit`, active job counts,
  due backlog, and throttling state. A workflow may enqueue 200 logical workers
  while a low-concurrency model provider such as iflytek/xunfei is drained
  through a much smaller active slot count.

These actions still do not start Docker, Hermers, Claude Code, WSL, Gateway, or
any model call unless a separately authorized wrapper command is configured.

## Authorized WSL Testbed State

As of 2026-07-04, the first out-of-band worker image smoke exists on
`wsl-agents` (`trading-agents-ubuntu`). This is infrastructure validation only;
it is not wired to v2 worker queues.

Removed legacy sandbox:

- container/image family: `agent-sandbox-ubuntu`;
- removed image tag: `flashcat/agent-sandbox-ubuntu:24.04`;
- post-check image list no longer contains `agent-sandbox-ubuntu`.

Current worker images:

```text
flashcat/hermes-worker:20260704       image id d9c3aadc3647   size 2.01GB
flashcat/claude-code-worker:20260704  image id 970d9e63f5b2   size 1.58GB
```

Current long-running smoke container:

```text
container=claude-code-worker-001
image=flashcat/claude-code-worker:20260704
status=running
user=ubuntu
home=/home/ubuntu
workspace=/home/flashcat/multi-agent-hedge-fund-framework/ops-artifacts/wsl-agents-worker-smoke-20260704/workspace
```

The Claude Code container mounts WSL host Claude config read-only:

```text
/home/flashcat/.claude      -> /home/ubuntu/.claude:ro
/home/flashcat/.claude.json -> /home/ubuntu/.claude.json:ro
```

Do not loosen host credential permissions to make containers read them. The
container runs as UID 1000 (`ubuntu`) because the host config file is `0600` and
owned by UID 1000.

Smoke results:

- `claude --version`: `2.1.195 (Claude Code)`;
- `hermes --version`: `Hermes Agent v0.17.0 (2026.6.19)`;
- Hermers source commit in image: `2bd1977d8fad185c9b4be47884f7e87f1add0ce3`;
- `WORKER_CONTEXT_LIMIT_TOKENS=64000`;
- `WORKER_MAX_CONCURRENCY_HINT=200`;
- no real LLM task was submitted during smoke.

Build context and local artifact path:

```text
/Users/Flashcat/multi-agent-hedge-fund-framework/ops-artifacts/wsl-agents-worker-images-20260704/
E:\CodexOps\wsl-agents-worker-images-20260704\
```

## Backend Classes

### Hermers Docker Worker

Backend id: `hermers_docker_worker`

Purpose:

- research worker
- analysis worker
- manager-assistant worker
- report synthesis worker
- non-coding structured agentic work

Expected environment:

- runs inside `wsl-agents` Docker;
- references the current development-server Hermers profile shape as a config
  template;
- temporarily uses the development-server Hermers fallback route structure:
  `custom:xfyun-qwen` / `astron-code-latest` /
  `https://maas-coding-api.cn-huabei-1.xf-yun.com/v2`;
- receives the Xunfei API key only through a runtime secret/env injection such
  as `XFYUN_QWEN_API_KEY`, never through the image layer;
- reads task content through the v2 information stack;
- returns output as artifacts, receipts, and structured result refs.

Non-goals:

- does not become `runtime_agents` cat member identity;
- does not reuse production Hermers sessions;
- does not receive production secrets baked into the image;
- does not write central SQLite directly.

### Claude Code Docker Worker

Backend id: `claude_code_docker_worker`

Purpose:

- code exploration
- patch generation
- code review
- test verification
- repo-local implementation tasks

Expected environment:

- runs inside `wsl-agents` Docker;
- uses the WSL host Claude Code config as reference through read-only mounts
  when an authorized real LLM test is needed;
- uses isolated worktrees or copied test workspaces;
- reports diff, command output, test evidence, risk notes, and rollback refs;
- reads task content through the information stack;
- returns results through worker receipt and manager review.

Non-goals:

- does not own final merge/deploy decisions;
- does not directly mutate central workflow state;
- does not touch production credentials;
- does not replace manager review.

### Docker Tool Containers

Status: explicitly out of scope for the current round.

Specialized tool containers may be useful later for browser automation, OCR,
compilers, data processing, or other narrow capabilities. They should not be
planned or implemented in this round. If a tool is needed for the initial
testbed, install it inside the Hermers or Claude Code worker image instead of
creating a new backend class.

### GPU Worker Containers

Status: explicitly out of scope for the current round.

GPU/model capability should be consumed through `wsl-models` APIs. The worker
containers should call those APIs when authorized. Do not attach GPU execution
directly to `wsl-agents` worker containers in the current round.

## Runtime Registry Position

`runtime_agents` remains the durable cat-member registry. Worker containers are
ephemeral worker runs, not cat members.

The future worker backend registry, if added, should be separate from
`runtime_agents`. It can describe backend capacity and connection policy, such
as:

```text
backend_id=hermers_docker_worker
host=wsl-agents
sandbox=docker
capabilities=agentic_analysis,report_synthesis
status=available

backend_id=claude_code_docker_worker
host=wsl-agents
sandbox=docker
capabilities=code_edit,code_review,test_verify
status=available
```

Manager identity continues to come from cat members. Worker run identity comes
from `workflow_v2_worker_runs`, `workflow_v2_session_instances`, and backend run
receipts.

## Communication Pattern

Preferred pattern for workstation workers:

```text
manager decision
  -> workflow_v2_worker_run queued
  -> workflow information stack item + inbox/grant
  -> worker backend receives or polls command
  -> Docker sandbox starts worker
  -> worker reads info item through governed read action
  -> worker writes artifact/result in controlled workspace
  -> runner posts receipt/result refs
  -> manager review accepts/rejects
```

The first testbed should prefer a pull model: a worker runner on `wsl-agents`
polls or receives a bounded test task from the control plane. This avoids
requiring the development server to reach directly into WSL/Docker before the
network exposure model is reviewed.

## Network Assumptions

Current workstation networking uses host-only Tailscale on Windows. WSL distros
should not start their own `tailscaled` TUN. If a future worker runner needs a
network service, expose it through a reviewed host-level path such as Windows
tailnet IP plus port forwarding, reverse proxy, or a controlled pull model.

Do not assume that a container can be addressed directly from the development
server.

## Secrets And Model Configuration

Current Hermers Docker worker temporary model route:

```text
provider=custom:xfyun-qwen
model=astron-code-latest
base_url=https://maas-coding-api.cn-huabei-1.xf-yun.com/v2
api_mode=chat_completions
api_key_env=XFYUN_QWEN_API_KEY
```

Claude Code Docker worker uses the existing `wsl-agents` Claude Code
configuration through read-only mounts for authorized tests. The image itself
contains the Claude Code CLI only, not OAuth state or API secrets.

Older notes may mention `openai-codex/gpt-5.5` as a candidate test route. That
is not the current Hermers Docker worker test route unless Flashcat explicitly
switches it back.

Secret handling rules:

- Do not bake OAuth tokens, API keys, refresh tokens, private keys, or broker
  credentials into Docker images.
- Do not write secrets into Git, documentation, artifacts, workflow payloads,
  logs, or Telegram text.
- Use host-side `0600` env files, Docker secrets, or a reviewed secret mount for
  test credentials.
- Testbed secrets must be scoped to the testbed and revocable.
- If the test worker uses existing development-server Hermers config as a
  reference, copy only non-secret structure unless Flashcat explicitly
  authorizes secret injection.

## Testbed Scope After Authorization

The first authorized testbed should be deliberately narrow:

1. Keep `flashcat/hermes-worker:20260704` and
   `flashcat/claude-code-worker:20260704` as the only current worker image
   classes.
2. Keep `claude-code-worker-001` as a single smoke container until a governed
   worker runner exists.
3. Run only synthetic, bounded test tasks that fit the 64k context limit.
4. Produce structured result artifacts and receipts.
5. Keep workflow DB writes disabled or routed through a test-only governed
   adapter.
6. Do not connect the worker to production workflow queues.

Claude Code testbed status:

1. `flashcat/claude-code-worker:20260704` has been built.
2. `claude-code-worker-001` runs against a disposable smoke workspace.
3. Future real code-worker tasks must use isolated worktrees or copied
   workspaces.
4. Code-worker outputs must produce diff/test evidence and require responsible
   owner or manager review before acceptance.

## Explicit Non-Current Scope

Do not do these without a separate authorization gate:

- start production worker queues;
- expose new workstation network ports to the development server;
- move cat members into Docker;
- register Docker workers as cat members;
- create specialized tool container families;
- create GPU worker containers;
- connect workers to real trading workflows;
- let workers write central SQLite directly;
- copy production secrets into worker images;
- restart OpenClaw Gateway or Hermers Gateway.

## Authorization Gate

Before starting the next worker-runtime implementation round, Flashcat should
approve at least:

- whether to keep Hermers on the Xunfei fallback route or switch to a Codex
  provider route;
- whether to keep the current Claude Code container as smoke-only or allow a
  real synthetic LLM task;
- which non-secret Hermers config source can be used as a reference for the
  runner adapter;
- how secrets will be injected and later revoked;
- whether the first task is fully synthetic or reads a real workflow info item;
- whether network communication is pull-only for the first smoke;
- where test artifacts and logs should be stored on `wsl-agents`;
- rollback/cleanup expectations for Docker images, containers, volumes, and
  credentials.

The gate template and implementation preflight checklist are maintained in
`docs/workflow-v2-p1-readiness-plan.md`.

## Relationship To V2 Kernel

The worker runtime backend plan supports the v2 kernel but is not required to
land P0 design docs. The v2 kernel can define managers, worker runs,
information-stack reads, artifacts, and manager review before any Docker worker
exists.

Implementation should start only after the v2 design docs are reviewed and
Flashcat explicitly authorizes the worker testbed round.
