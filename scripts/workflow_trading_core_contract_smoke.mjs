#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAction } from "../src/core.js";

const LOCAL_CODEX_CALLER = {
  callerAgent: "local_codex",
  callerRuntime: "local_codex",
  sourceSystem: "local_codex"
};

async function runWorkflowAction(root, input) {
  return runAction(root, { ...LOCAL_CODEX_CALLER, ...input });
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function resolveTradingCorePath() {
  const candidates = [
    process.env.TRADING_CORE_PATH,
    "/Users/Flashcat/multi-agent-hedge-fund-framework/trading_core",
    path.resolve(process.cwd(), "../trading_core")
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (await pathExists(path.join(resolved, "src/trading_core/cli.py"))) return resolved;
  }
  throw new Error("trading_core checkout not found; set TRADING_CORE_PATH to a checkout containing src/trading_core/cli.py");
}

function runTradingCore(tradingCorePath, args) {
  return execFileSync("python3", ["-m", "trading_core.cli", ...args], {
    cwd: tradingCorePath,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: "src" }
  }).trim();
}

async function createWorkflowIntent(root) {
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const buttons = [
    {
      label: "方案 A：批准 paper bridge smoke",
      summary: "批准本地 paper bridge smoke，进入猫之尾下单前风控审计。",
      prompt: "猫之尾输出中文风控 paper 和结构化 risk_decision 后，再生成 canonical executable trade intent。",
      rollback: "如果 smoke 失败，删除临时 root 并保留错误输出。"
    },
    {
      label: "方案 B：暂停 bridge smoke",
      summary: "暂停本地 smoke，只保留 workflow 状态和 Human Gate 证据。",
      prompt: "不生成交易 intent，等待后续重新批准方案 A。",
      rollback: "重新提交 Human Gate 后继续方案 A。"
    },
    {
      label: "方案 C：终止 bridge smoke",
      summary: "终止本次 smoke，归档当前尝试。",
      prompt: "不继续生成风险决策或交易 intent。",
      rollback: "需要时创建新的临时 root 重新执行 smoke。"
    }
  ];

  await runWorkflowAction(root, {
    action: "trade.proposal",
    proposalId: "proposal-smoke",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit"
  });
  await runWorkflowAction(root, {
    action: "runtime.agent.upsert",
    runtime: "openclaw",
    platform: "openclaw",
    agentId: "cat_tail",
    displayName: "猫之尾",
    role: "pre_order_risk_audit_and_final_trading_risk_control",
    executionAdapter: "native",
    imIngressOwner: "openclaw_gateway",
    imIngressAdapter: "openclaw_native",
    workflowIngressAdapter: "openclaw_native",
    endpointRef: "openclaw-agent:cat_tail"
  });
  const request = await runWorkflowAction(root, {
    action: "human_gate.request",
    workflowId: "workflow-smoke",
    meetingId: "workflow-smoke",
    traceId: "trace-smoke-hgate",
    parentObjectId: "proposal-smoke",
    expiresAt,
    text: "猫爪正式汇报：请选择 A/B/C。",
    buttons,
    payload: {
      proposalId: "proposal-smoke",
      dispatchType: "pre_order_risk_audit",
      nextAgent: "cat_tail",
      preOrderRiskAuditId: "pora-smoke"
    }
  });
  const approved = request.buttons.find((button) => button.decisionStatus === "approved");
  assert.ok(approved?.callbackToken, "approved Human Gate callback token is required for smoke setup");
  await runWorkflowAction(root, {
    action: "human_gate.resume",
    token: approved.callbackToken,
    text: "闪电猫原话：批准 A，用于 workflow 到 trading_core 的本地 paper smoke。"
  });
  await runWorkflowAction(root, {
    action: "risk.decision",
    riskDecisionId: "risk-smoke",
    proposalId: "proposal-smoke",
    humanGateId: request.humanGateId,
    preOrderRiskAuditId: "pora-smoke",
    assetType: "crypto",
    symbol: "BTC/USDT",
    status: "approved",
    reviewerAgent: "cat_tail",
    dispatchType: "pre_order_risk_audit",
    catClawAuditId: "audit-smoke",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z",
    riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 },
    evidenceRefs: ["artifact://workflow-smoke/evidence"],
    paperRef: "artifact://workflow-smoke/cat_tail-risk-paper"
  });

  const intent = await runWorkflowAction(root, {
    action: "trade.intent",
    intentId: "intent-smoke",
    workflowId: "workflow-smoke",
    traceId: "trace-smoke",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit",
    proposalId: "proposal-smoke",
    riskDecisionId: "risk-smoke",
    preOrderRiskAuditId: "pora-smoke",
    humanGateId: request.humanGateId,
    catClawAuditId: "audit-smoke",
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z",
    actor: "flashcat",
    assurance: "mtls",
    sourceSystem: "codex_mtls",
    clientCertFingerprint: "test-cert",
    idempotencyKey: "idem-smoke",
    expiresAt,
    executionMode: "paper",
    marketType: "spot",
    exchange: "paper_exchange",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    clientOrderId: "idem-smoke",
    timeInForce: "gtc",
    priceConstraints: { referencePrice: 68000, limitPrice: 69000, maxSlippageBps: 20 },
    riskLimits: { maxNotionalUsd: 20000, maxLossUsd: 500 }
  });
  assert.equal(intent.status, "ready_for_trading_core");
  return {
    ...intent,
    humanGateId: request.humanGateId,
    freshnessCheckedAt: "2026-05-31T00:00:00.000Z"
  };
}

async function main() {
  const tradingCorePath = await resolveTradingCorePath();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "taw-trading-core-smoke-"));
  const intent = await createWorkflowIntent(root);
  const validation = JSON.parse(runTradingCore(tradingCorePath, ["validate-intent", "--intent", intent.path]));
  assert.equal(validation.status, "contract_valid");

  const receiptOut = path.join(root, "receipt.json");
  const bridge = JSON.parse(runTradingCore(tradingCorePath, [
    "--config",
    "examples/config.paper.json",
    "--state-dir",
    path.join(root, "trading-core-state"),
    "bridge-submit",
    "--intent",
    intent.path,
    "--receipt-out",
    receiptOut
  ]));
  assert.equal(bridge.status, "filled");

  const receipt = JSON.parse(await fs.readFile(receiptOut, "utf8"));
  const workflowReceipt = await runWorkflowAction(root, {
    ...receipt.payload.workflowReceiptAction,
    humanGateId: intent.humanGateId,
    freshnessCheckedAt: intent.freshnessCheckedAt,
    payload: receipt.payload
  });
  assert.equal(workflowReceipt.status, "filled");

  console.log(JSON.stringify({
    status: "ok",
    workflowRoot: root,
    tradingCorePath,
    intentPath: intent.path,
    intentStatus: intent.status,
    contractStatus: validation.status,
    bridgeStatus: bridge.status,
    workflowReceiptStatus: workflowReceipt.status,
    tradingCoreRef: bridge.tradingCoreRef
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
