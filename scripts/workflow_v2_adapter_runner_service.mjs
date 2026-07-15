#!/usr/bin/env node
import { runAction } from "../src/core.js";

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const root = argValue("--root", process.cwd());
const runtimeBackend = argValue("--runtime-backend", argValue("--runtimeBackend", ""));
const mode = argValue("--mode", "external_command");
const serviceId = argValue("--service-id", runtimeBackend ? `workflow-v2-adapter-runner:${runtimeBackend}` : "workflow-v2-adapter-runner");
const limit = Number(argValue("--limit", "1"));
const execute = hasFlag("--execute");
const executeGate = process.env.TRADING_AGENTS_WORKFLOW_V2_ADAPTER_RUNNER_SERVICE_EXECUTE === "1";

const generatedAt = new Date().toISOString();
const baseInput = {
  runtimeBackend,
  mode,
  serviceId,
  limit: Number.isFinite(limit) ? limit : 1,
  generatedAt
};

const plan = await runAction(root, {
  action: "workflow.v2.adapter_runner.service_plan.preview",
  ...baseInput
});
const cycle = {
  schemaVersion: "workflow_v2_adapter_runner_service_cycle.v1",
  generatedAt,
  serviceId,
  root,
  runtimeBackend,
  mode,
  executeRequested: execute,
  executeGate,
  plan,
  drain: null,
  status: "preview_only"
};

if (execute) {
  if (!executeGate) {
    cycle.status = "blocked_execute_gate_required";
  } else if (mode !== "external_command") {
    cycle.status = "blocked_external_command_mode_required";
  } else if (!plan.valid) {
    cycle.status = "blocked_readiness_invalid";
  } else {
    cycle.drain = await runAction(root, {
      action: "workflow.v2.adapter_runner.drain",
      ...baseInput,
      runnerId: serviceId
    });
    cycle.status = cycle.drain?.allowed === false || cycle.drain?.status === "blocked"
      ? "blocked_drain_policy_gate"
      : "drain_completed";
  }
}

console.log(JSON.stringify(cycle, null, 2));
if (cycle.status.startsWith("blocked_")) process.exit(2);
