#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runRegression(name) {
  const startedAt = new Date().toISOString();
  try {
    const result = await execFileAsync(process.execPath, [
      "scripts/workflow_regression_tests.mjs",
      "--grep",
      name
    ], {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      name,
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: 0,
      stdout: String(result.stdout || "").trim(),
      stderr: String(result.stderr || "").trim()
    };
  } catch (error) {
    return {
      name,
      startedAt,
      endedAt: new Date().toISOString(),
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
      stdout: String(error?.stdout || "").trim(),
      stderr: String(error?.stderr || error?.message || error || "").trim()
    };
  }
}

const checks = [
  "workflow v2 fixed template plan gate",
  "workflow v2 review chain",
  "workflow v2 governance human gate bridge"
];
const results = [];
for (const check of checks) {
  const result = await runRegression(check);
  results.push(result);
  if (result.exitCode !== 0) break;
}

const ok = results.every((item) => item.exitCode === 0) && results.length === checks.length;
console.log(JSON.stringify({
  schemaVersion: "workflow_v2_non_trading_rehearsal_smoke.v1",
  ok,
  generatedAt: new Date().toISOString(),
  scope: "approved template/worker result/review/cat brain/cat claw/human gate request non-trading rehearsal",
  sideEffects: {
    realTelegramDelivery: false,
    dockerContainers: false,
    modelCalls: false,
    tradingSideEffects: false
  },
  checks: results.map((item) => ({
    name: item.name,
    exitCode: item.exitCode,
    stdout: item.stdout,
    stderr: item.stderr
  }))
}, null, 2));

if (!ok) process.exit(1);
