#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_COMMANDS = [
  "check",
  "smoke",
  "smoke:v2-canary",
  "smoke:v2-external-runner",
  "smoke:v2-external-runner-dry-run",
  "smoke:v2-external-runner-plan-only",
  "smoke:v2-external-runner-execute-guard",
  "smoke:v2-runner-execute-hgate-package",
  "smoke:v2-runner-execute-hgate-request",
  "smoke:v2-runner-execute-hgate-delivery-preview",
  "smoke:v2-runner-execute-hgate-delivery-guard",
  "smoke:mcp",
  "smoke:hermes-mcp"
];

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  const args = [...argv];
  while (args.length) {
    const item = args.shift();
    if (!item.startsWith("--")) {
      positionals.push(item);
      continue;
    }
    const key = item.slice(2);
    const value = args[0] && !args[0].startsWith("--") ? args.shift() : "true";
    if (options[key] === undefined) options[key] = value;
    else if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = [options[key], value];
  }
  return { options, positionals };
}

function boolOption(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function listOption(value) {
  if (value === undefined || value === null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function utcCompact() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function tryExec(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: 50 * 1024 * 1024
    });
    return {
      exitCode: 0,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      error: ""
    };
  } catch (error) {
    return {
      exitCode: Number.isInteger(error?.code) ? error.code : 1,
      stdout: error?.stdout || "",
      stderr: error?.stderr || "",
      error: String(error?.message || error)
    };
  }
}

async function gitSnapshot(cwd) {
  const head = await tryExec("git", ["rev-parse", "HEAD"], { cwd });
  const branch = await tryExec("git", ["branch", "--show-current"], { cwd });
  const status = await tryExec("git", ["status", "--short", "--branch"], { cwd });
  return {
    head: head.stdout.trim(),
    branch: branch.stdout.trim(),
    status: status.stdout.trim(),
    ok: head.exitCode === 0 && status.exitCode === 0
  };
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, value);
}

async function runNpmScript({ name, cwd, outDir, timeoutMs, env }) {
  const startedAt = new Date().toISOString();
  const result = await tryExec("npm", ["run", name], { cwd, timeoutMs, env });
  const endedAt = new Date().toISOString();
  const safeName = safeSegment(name);
  const stdoutPath = path.join(outDir, `${safeName}.stdout.log`);
  const stderrPath = path.join(outDir, `${safeName}.stderr.log`);
  const combined = `${result.stdout}${result.stderr}`;
  await writeText(stdoutPath, result.stdout);
  await writeText(stderrPath, result.stderr);
  return {
    name,
    command: ["npm", "run", name],
    startedAt,
    endedAt,
    exitCode: result.exitCode,
    stdout: stdoutPath,
    stderr: stderrPath,
    stdoutSha256: sha256(result.stdout),
    stderrSha256: sha256(result.stderr),
    combinedSha256: sha256(combined),
    error: result.error
  };
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));
  if (positionals.length) throw new Error(`unexpected arguments: ${positionals.join(" ")}`);

  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const runId = safeSegment(options["run-id"] || utcCompact());
  const outDir = path.resolve(String(options.out || path.join(cwd, ".tmp-smoke-release", runId)));
  const timeoutMs = Number(options["timeout-ms"] || 10 * 60 * 1000);
  const failFast = boolOption(options["fail-fast"], false);
  const requestedCommands = listOption(options.commands);
  const skipped = new Set(listOption(options.skip));
  const commands = (requestedCommands.length ? requestedCommands : DEFAULT_COMMANDS).filter((name) => !skipped.has(name));
  if (!commands.length) throw new Error("no smoke commands selected");

  await fs.mkdir(outDir, { recursive: true });
  const logsDir = path.join(outDir, "logs");
  await fs.mkdir(logsDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const git = await gitSnapshot(cwd);
  const results = [];
  for (const name of commands) {
    const commandResult = await runNpmScript({
      name,
      cwd,
      outDir: logsDir,
      timeoutMs,
      env: process.env
    });
    results.push(commandResult);
    const status = commandResult.exitCode === 0 ? "ok" : `failed exit=${commandResult.exitCode}`;
    console.log(`${name}: ${status}`);
    if (commandResult.exitCode !== 0 && failFast) break;
  }
  const endedAt = new Date().toISOString();
  const ok = results.every((item) => item.exitCode === 0);
  const payload = {
    schemaVersion: "workflow_smoke_capture.v1",
    ok,
    runId,
    cwd,
    outDir,
    startedAt,
    endedAt,
    git,
    commands,
    results
  };
  const resultsPath = path.join(outDir, "smoke-results.json");
  const indexPath = path.join(outDir, "index.json");
  await writeText(resultsPath, JSON.stringify(payload, null, 2) + "\n");
  await writeText(indexPath, JSON.stringify({
    task: "workflow-smoke-capture",
    ok,
    runId,
    cwd,
    git,
    resultsPath,
    commandCount: results.length,
    failed: results.filter((item) => item.exitCode !== 0).map((item) => ({
      name: item.name,
      exitCode: item.exitCode,
      stderr: item.stderr
    })),
    checks: results.map((item) => ({
      name: item.name,
      exitCode: item.exitCode,
      stdout: item.stdout,
      stderr: item.stderr,
      stdoutSha256: item.stdoutSha256,
      stderrSha256: item.stderrSha256,
      combinedSha256: item.combinedSha256
    }))
  }, null, 2) + "\n");

  console.log(JSON.stringify({
    ok,
    runId,
    outDir,
    indexPath,
    resultsPath,
    commands: results.map((item) => ({ name: item.name, exitCode: item.exitCode }))
  }, null, 2));
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
