#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAction } from "../src/core.js";

function firstText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function argValue(name, fallback = "") {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return fallback;
  return process.argv[idx + 1];
}

function safeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "workflow-v2-runner-execute-hgate";
}

function utcCompact() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

function buildAuthorizationPackage({ runId, workflowId, planId, packageId }) {
  const executeGuardCommand = [
    "node",
    "scripts/workflow_v2_external_runner_smoke.mjs",
    "--runner",
    "execute-guard"
  ];
  const futureExecuteCommand = [
    "node",
    "scripts/workflow_v2_external_runner_execute_guard.mjs",
    "--execute",
    "REQUEST_FILE",
    "OUTPUT_FILE"
  ];
  const hardGates = [
    { key: "human_gate", status: "required", text: "必须由闪电猫通过正式 Human Gate 选择方案；聊天自然语言不得替代按钮选择。" },
    { key: "cat_claw_audit", status: "required", text: "正式提交前必须由猫爪复核证据包、按钮、回滚、中文说明和 token 绑定。" },
    { key: "runtime_scope", status: "required", text: "首轮真实执行只能是单 worker、synthetic-only、非交易、非生产任务。" },
    { key: "docker_host", status: "required", text: "必须确认 Docker host 是 wsl-agents/local-workstation 受控测试面，不是 OpenClaw Gateway 或生产服务器。" },
    { key: "image_digest", status: "required", text: "必须记录 worker image tag/digest，并证明镜像不含 OAuth、API key、broker key 或私钥。" },
    { key: "secrets", status: "required", text: "首轮 synthetic smoke 默认禁止挂载 secrets；如未来需要，必须列出 secret 名称、scope、revocation 和 0600/secret-store 路径。" },
    { key: "network", status: "required", text: "默认 network=none，不暴露端口，不启动 WSL tailscaled，不开放 unmanaged container port。" },
    { key: "logs", status: "required", text: "stdout/stderr、runner request、runner output、receipt 和 result artifact 必须写入受治理 artifact/log 路径。" },
    { key: "concurrency", status: "required", text: "首轮 maxActiveJobs=1，禁止 fan-out，禁止 200 logical worker 目标进入真实执行。" },
    { key: "expiry", status: "required", text: "授权必须有过期时间、idempotency key 和一次性 runId；过期后必须重新提交 Human Gate。" },
    { key: "rollback", status: "required", text: "失败或副作用不确定时，停止 runner、保留日志、标记 adapter job failed/retry_scheduled，不得伪装成功。" },
    { key: "receipt", status: "required", text: "成功只能通过 workflow.v2.worker_result.submit；失败/拒绝只能通过 fail/release 路径回到 workflow。" }
  ];
  const options = [
    {
      optionId: "approve_single_synthetic_execute_smoke",
      title: "方案 A：批准一次单 worker synthetic execute smoke",
      summary: "仅允许对一个 synthetic worker adapter job 执行真实 wrapper；maxActiveJobs=1；不挂载 secrets；network=none；不触达交易流程。",
      body: [
        "批准后，执行范围仅限 workflow v2 external runner 的单 worker synthetic smoke。",
        "执行命令必须同时具备 --execute 和 TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE=1。",
        "Docker host 限定为受控 wsl-agents 测试面；不得在 OpenClaw Gateway、生产服务器或猫成员常驻 runtime 上执行。",
        "容器不得挂载真实 OAuth/API/broker/private key；不得开放端口；不得调用真实交易链路。"
      ].join("\n"),
      prompt: "如选择本方案，请确认：仅一次、单 worker、synthetic-only、无 secrets、network=none、maxActiveJobs=1，并要求执行后回传日志、artifact 和 receipt。",
      rollback: "如执行失败、超时或副作用不确定，立即停止 runner，保留 stdout/stderr/request/output/receipt artifact，将 adapter job 标记 failed 或 retry_scheduled，禁止重试真实副作用，重新提交 Human Gate。",
      approvalPayload: {
        decision: "approve_single_synthetic_execute_smoke",
        workflowId,
        planId,
        maxActiveJobs: 1,
        syntheticOnly: true,
        allowSecrets: false,
        networkMode: "none",
        allowTrading: false,
        requireExecuteFlag: true,
        requireEnvironmentGate: "TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE=1"
      }
    },
    {
      optionId: "keep_execute_disabled_collect_evidence",
      title: "方案 B：保持 execute 禁用，继续补证",
      summary: "不批准真实执行；继续使用 execute-guard、plan-only、dry-run 和 release/retry_scheduled 证据补齐运行边界。",
      body: [
        "保持 workflow_v2_external_runner_execute_guard 的默认拒绝执行状态。",
        "继续生成 plan-only artifact、命令计划、日志路径和回滚检查表。",
        "待猫爪复核 Docker host、镜像 digest、secret policy、网络和日志路径后，再重新提交 Human Gate。"
      ].join("\n"),
      prompt: "如选择本方案，请要求继续补齐 Docker/image/secret/network/log/rollback 证据，不进行任何真实 runtime 执行。",
      rollback: "无真实执行副作用；保留当前 execute-guard 默认拒绝状态，继续让 adapter job release/retry_scheduled，不进入 worker_result.submit。",
      approvalPayload: {
        decision: "keep_execute_disabled_collect_evidence",
        workflowId,
        planId,
        executeAllowed: false,
        continueDryRunOnly: true
      }
    }
  ];
  return {
    schemaVersion: "workflow_v2_runner_execute_human_gate_authorization_package.v1",
    runId,
    packageId,
    workflowId,
    planId,
    title: "Workflow v2 真实 worker wrapper execute Human Gate 授权包",
    status: "draft",
    language: "zh-CN",
    scope: {
      runtimeBackends: ["claude_code_docker_worker", "hermers_docker_worker"],
      firstExecutionMode: "single_worker_synthetic_smoke",
      productionTradingAllowed: false,
      directDatabaseWritesAllowed: false,
      openclawGatewayRestartAllowed: false
    },
    commandPlan: {
      currentGuardSmoke: executeGuardCommand,
      futureExecuteSkeleton: futureExecuteCommand,
      requiredEnvGate: "TRADING_AGENTS_WORKFLOW_V2_ALLOW_REAL_RUNNER_EXECUTE=1",
      executesInThisPackage: false
    },
    hardGates,
    options,
    controls: ["pause_workflow", "terminate_workflow"],
    evidenceRefs: [
      "script://scripts/workflow_v2_external_runner_execute_guard.mjs",
      "script://scripts/workflow_v2_external_runner_smoke.mjs",
      "script://scripts/workflow_v2_external_runner_dry_run.mjs",
      "doc://docs/workflow-v2-worker-runtime-backends.md"
    ]
  };
}

function markdownForPackage(pkg, preview) {
  const gateLines = pkg.hardGates.map((item) => `- ${item.key}: ${item.text}`).join("\n");
  const optionLines = pkg.options.map((option, index) => [
    `## ${index + 1}. ${option.title}`,
    "",
    option.summary,
    "",
    "### 执行说明",
    option.body,
    "",
    "### 闪电猫确认提示",
    option.prompt,
    "",
    "### 回滚",
    option.rollback
  ].join("\n")).join("\n\n");
  return [
    `# ${pkg.title}`,
    "",
    `Run ID: ${pkg.runId}`,
    `Package ID: ${pkg.packageId}`,
    `Workflow ID: ${pkg.workflowId}`,
    `Plan ID: ${pkg.planId}`,
    "",
    "## 边界",
    "",
    "- 本授权包不执行真实 worker、Docker、Hermers、Claude、模型调用或交易链路。",
    "- 本授权包只生成 Human Gate 草案材料和校验结果。",
    "- 真实执行必须另走正式 Human Gate，并同时具备 --execute 与环境 gate。",
    "",
    "## 硬性检查",
    "",
    gateLines,
    "",
    "## 可选方案",
    "",
    optionLines,
    "",
    "## 预览校验",
    "",
    `- workflow.v2.human_gate_package.preview valid: ${preview.valid}`,
    `- errors: ${(preview.errors || []).map((item) => item.code).join(",") || "none"}`,
    "",
    "## 命令计划",
    "",
    "```json",
    JSON.stringify(pkg.commandPlan, null, 2),
    "```",
    ""
  ].join("\n");
}

const runId = safeSegment(firstText(argValue("--run-id"), utcCompact()));
const root = firstText(argValue("--root"), await fs.mkdtemp(path.join(os.tmpdir(), "workflow-v2-runner-execute-hgate-")));
const workflowId = firstText(argValue("--workflow-id"), `wf-v2-runner-execute-hgate-${runId}`);
const planId = firstText(argValue("--plan-id"), `${workflowId}.plan`);
const packageId = firstText(argValue("--package-id"), `${workflowId}.hgate.execute`);
const outDir = path.resolve(firstText(argValue("--out"), path.join(root, "artifacts", "workflow-v2", "runner-execute-human-gate", runId)));

await runAction(root, { action: "workflow.init" });
const authorizationPackage = buildAuthorizationPackage({ runId, workflowId, planId, packageId });
const preview = await runAction(root, {
  action: "workflow.v2.human_gate_package.preview",
  workflowId,
  planId,
  packageId,
  status: "draft",
  options: authorizationPackage.options,
  evidenceRefs: authorizationPackage.evidenceRefs,
  payload: {
    authorizationPackage,
    submissionKind: "runtime_execution_authorization",
    interactionType: "approval"
  }
});

assert.equal(preview.valid, true);
assert.equal(preview.humanGatePackage.options.length, 2);
assert.equal(preview.humanGatePackage.status, "draft");
assert.equal(preview.humanGatePackage.requiredControls.includes("pause"), true);
assert.equal(preview.humanGatePackage.requiredControls.includes("terminate"), true);
assert.equal(authorizationPackage.commandPlan.executesInThisPackage, false);
assert.equal(authorizationPackage.scope.productionTradingAllowed, false);
assert.equal(authorizationPackage.scope.directDatabaseWritesAllowed, false);

const jsonFile = path.join(outDir, "runner-execute-human-gate-package.json");
const mdFile = path.join(outDir, "runner-execute-human-gate-package.md");
const indexFile = path.join(outDir, "index.json");
await writeJson(jsonFile, { authorizationPackage, preview });
await writeText(mdFile, markdownForPackage(authorizationPackage, preview));
await writeJson(indexFile, {
  ok: true,
  runId,
  root,
  workflowId,
  planId,
  packageId,
  outDir,
  jsonFile,
  mdFile,
  previewValid: preview.valid,
  optionCount: preview.humanGatePackage.options.length,
  executesInThisPackage: false,
  status: "draft"
});

console.log(JSON.stringify({
  ok: true,
  root,
  workflowId,
  planId,
  packageId,
  outDir,
  jsonFile,
  mdFile,
  indexFile
}, null, 2));
