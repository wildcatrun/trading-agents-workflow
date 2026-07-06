import { parseJsonValue } from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const WORKFLOW_SWARM_ACTION_HANDLER_NAMES = {
  "workflow.swarm.plan": "workflowSwarmPlan",
  "workflow.swarm": "workflowSwarmPlan"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`workflow swarm action dependency missing: ${name}`);
  return value;
}

export function createWorkflowSwarmActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_SWARM_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing workflow swarm action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowSwarmAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

function parseWorkerSpec(value, context, fallbackRuntime = "openclaw") {
  const text = String(value || "").trim();
  if (!text) return { runtime: fallbackRuntime, agentId: "main" };
  const [runtimePart, agentPart] = text.includes(":") ? text.split(":", 2) : [fallbackRuntime, text];
  return { runtime: context.normalizeRuntime(runtimePart), agentId: context.normalizeAgentId(agentPart) };
}

function parseSwarmShards(input = {}, context) {
  const raw = input.shards ?? input.targets ?? input.items ?? input.symbols ?? [];
  const parsed = parseJsonValue(raw, raw);
  const values = Array.isArray(parsed) ? parsed : context.toList(parsed);
  if (values.length) {
    return values.map((item, index) => {
      if (item && typeof item === "object") {
        return {
          id: String(item.id || item.shardId || item.shard_id || `shard-${String(index + 1).padStart(3, "0")}`),
          text: String(item.text || item.summary || item.target || item.symbol || JSON.stringify(item)),
          payload: item
        };
      }
      const text = String(item).trim();
      return { id: context.cleanFileSegment(text || `shard-${String(index + 1).padStart(3, "0")}`), text, payload: { value: text } };
    });
  }
  const shardCount = Math.max(1, Math.min(300, Number(input.shardCount || input.shard_count || 1)));
  return Array.from({ length: shardCount }, (_, index) => ({
    id: `shard-${String(index + 1).padStart(3, "0")}`,
    text: `shard ${index + 1} of ${shardCount}`,
    payload: { index: index + 1, total: shardCount }
  }));
}

function renderSwarmWorkerPrompt(input, shard) {
  const objective = String(input.objective || input.goal || input.summary || "").trim();
  const instructions = String(input.prompt || input.instructions || input.text || "").trim();
  return [
    "You are working as one bounded shard worker in a trading_agents swarm-style workflow.",
    "Stay inside your assigned shard. Do not expand scope unless evidence requires it.",
    "",
    `Objective: ${objective}`,
    `Shard: ${shard.id}`,
    `Shard input: ${shard.text}`,
    instructions ? `Instructions: ${instructions}` : "",
    "",
    "Return a concise artifact-ready result with evidence, assumptions, uncertainty, and recommended next action.",
    "Do not execute trades. Do not bypass Human Gate."
  ].filter(Boolean).join("\n");
}

function renderSwarmReducerPrompt(input, shards, fanoutTasks) {
  const objective = String(input.objective || input.goal || input.summary || "").trim();
  const acceptance = String(input.acceptanceCriteria || input.acceptance_criteria || "").trim();
  return [
    "You are the reducer for a trading_agents swarm-style workflow.",
    "Synthesize worker shard outputs into one next-action package. Preserve disagreement and uncertainty instead of flattening it.",
    "",
    `Objective: ${objective}`,
    acceptance ? `Acceptance criteria: ${acceptance}` : "",
    `Shard count: ${shards.length}`,
    "",
    "Worker task ids:",
    fanoutTasks.map((task) => `- ${task.taskId}: ${task.shardId}`).join("\n"),
    "",
    "Reducer output requirements:",
    "1. State the integrated conclusion.",
    "2. List evidence and gaps by shard.",
    "3. Identify unresolved conflicts or missing receipts.",
    "4. Propose the next workflow step for cat-brain main.",
    "5. If Flashcat confirmation is needed, produce a Cat Claw-ready Human Gate package."
  ].filter(Boolean).join("\n");
}

async function workflowTaskExists(paths, taskId) {
  const rows = await sqlite(paths.dbFile, `SELECT task_id, status FROM workflow_tasks WHERE task_id=${sqlValue(taskId)} LIMIT 1;`, { json: true });
  return rows[0] || null;
}

export function createWorkflowSwarmActionHandlers(context = {}) {
  const boolOption = requireContextFunction(context, "boolOption");
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const normalizeAgentId = requireContextFunction(context, "normalizeAgentId");
  const normalizeRuntime = requireContextFunction(context, "normalizeRuntime");
  const safeId = requireContextFunction(context, "safeId");
  const toList = requireContextFunction(context, "toList");
  const workflowRunUpsert = requireContextFunction(context, "workflowRunUpsert");
  const workflowTaskCreate = requireContextFunction(context, "workflowTaskCreate");
  const helperContext = { cleanFileSegment, normalizeAgentId, normalizeRuntime, toList };

  async function workflowSwarmPlan(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const workflowId = String(input.workflowId || input.workflow_id || input.initiativeId || input.initiative_id || safeId("swarm")).trim();
    const objective = String(input.objective || input.goal || input.summary || "").trim();
    if (!objective) throw new Error("objective is required");
    const phase = String(input.phase || "swarm").trim();
    const createdBy = String(input.createdBy || input.created_by || input.from || "main").trim();
    const runRows = await sqlite(paths.dbFile, `SELECT workflow_id FROM workflow_runs WHERE workflow_id=${sqlValue(workflowId)} LIMIT 1;`, { json: true });
    let workflowRun = null;
    if (!runRows[0]) {
      workflowRun = await workflowRunUpsert(rootDir, {
        workflowRootDir: paths.root,
        workflowId,
        workflowType: input.workflowType || input.workflow_type || "swarm",
        status: "active",
        ownerAgent: input.ownerAgent || input.owner_agent || "main",
        objective,
        acceptanceCriteria: input.acceptanceCriteria || input.acceptance_criteria || "",
        stopCondition: input.stopCondition || input.stop_condition || "Flashcat accepts the final next-action package or blocks continuation.",
        phase,
        payload: {
          swarmPlan: true,
          createdBy,
          source: input.source || "workflow.swarm.plan"
        }
      });
    }
    const shards = parseSwarmShards(input, helperContext);
    const fanoutLimit = Math.max(1, Math.min(300, Number(input.fanoutLimit || input.fanout_limit || shards.length)));
    const workers = toList(input.workers || input.worker || input.workerPool || input.worker_pool);
    const workerPool = (workers.length ? workers : ["openclaw:main"]).map((worker) => parseWorkerSpec(worker, helperContext));
    const reducer = parseWorkerSpec(input.reducer || input.reducerAgent || input.reducer_agent || "openclaw:main", helperContext);
    const created = [];
    const skipped = [];
    for (const [index, shard] of shards.slice(0, fanoutLimit).entries()) {
      const worker = workerPool[index % workerPool.length];
      const taskId = String(input.taskPrefix || input.task_prefix || `${workflowId}-swarm`).trim() + `-${cleanFileSegment(shard.id).slice(0, 48)}`;
      const existing = await workflowTaskExists(paths, taskId);
      if (existing) {
        skipped.push({ taskId, shardId: shard.id, status: existing.status });
        continue;
      }
      const task = await workflowTaskCreate(rootDir, {
        workflowRootDir: paths.root,
        workflowId,
        taskId,
        phase,
        ownerAgent: worker.agentId,
        runtime: worker.runtime,
        agentId: worker.agentId,
        taskType: input.taskType || input.task_type || "swarm_shard",
        priority: input.priority || "normal",
        summary: `${objective} / ${shard.id}`,
        prompt: renderSwarmWorkerPrompt(input, shard),
        expectedArtifact: input.expectedArtifact || input.expected_artifact || `swarm shard result: ${shard.id}`,
        receiptRequired: true,
        humanGateRequired: false,
        createdBy,
        payload: {
          swarm: true,
          shardId: shard.id,
          shardText: shard.text,
          shardPayload: shard.payload,
          shardIndex: index + 1,
          shardCount: Math.min(shards.length, fanoutLimit)
        }
      });
      created.push({ ...task, shardId: shard.id });
    }
    const reducerTaskId = String(input.reducerTaskId || input.reducer_task_id || `${workflowId}-swarm-reduce`).trim();
    let reducerTask = null;
    const reducerExisting = await workflowTaskExists(paths, reducerTaskId);
    if (reducerExisting) {
      skipped.push({ taskId: reducerTaskId, shardId: "reduce", status: reducerExisting.status });
    } else {
      const dependencyIds = [...created.map((task) => task.taskId), ...skipped.filter((task) => task.shardId !== "reduce").map((task) => task.taskId)];
      reducerTask = await workflowTaskCreate(rootDir, {
        workflowRootDir: paths.root,
        workflowId,
        taskId: reducerTaskId,
        phase,
        ownerAgent: reducer.agentId,
        runtime: reducer.runtime,
        agentId: reducer.agentId,
        taskType: "swarm_reduce",
        priority: boolOption(input.flashLane ?? input.flash_lane, false) ? "flash" : "high",
        dependsOn: dependencyIds,
        summary: `${objective} / reduce shard outputs`,
        prompt: renderSwarmReducerPrompt(input, shards.slice(0, fanoutLimit), [...created, ...skipped]),
        expectedArtifact: input.reducerArtifact || input.reducer_artifact || "integrated swarm next-action package",
        receiptRequired: true,
        humanGateRequired: boolOption(input.reducerHumanGate || input.reducer_human_gate, false),
        createdBy,
        payload: {
          swarm: true,
          reducer: true,
          shardTaskIds: dependencyIds,
          shardCount: dependencyIds.length
        }
      });
    }
    return {
      workflowId,
      workflowRun,
      objective,
      phase,
      shardCount: shards.length,
      plannedShardCount: Math.min(shards.length, fanoutLimit),
      workerPool,
      reducer,
      createdTasks: created,
      reducerTask,
      skippedTasks: skipped,
      dbFile: paths.dbFile
    };
  }

  return {
    workflowSwarmPlan
  };
}
