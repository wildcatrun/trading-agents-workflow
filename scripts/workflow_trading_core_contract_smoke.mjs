#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runAction } from "../src/core.js";

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
      label: "Plan A",
      summary: "Approve paper bridge smoke",
      prompt: "Generate canonical executable trade intent",
      rollback: "Discard temp root"
    },
    {
      label: "Plan B",
      summary: "Pause bridge smoke",
      prompt: "Keep workflow state only",
      rollback: "Resume with Plan A"
    },
    {
      label: "Plan C",
      summary: "Stop bridge smoke",
      prompt: "Archive smoke attempt",
      rollback: "Create fresh temp root"
    }
  ];

  await runAction(root, {
    action: "trade.proposal",
    proposalId: "proposal-smoke",
    assetType: "crypto",
    symbol: "BTC/USDT",
    side: "buy",
    quantity: "0.2",
    orderType: "limit"
  });
  await runAction(root, {
    action: "risk.decision",
    riskDecisionId: "risk-smoke",
    proposalId: "proposal-smoke",
    assetType: "crypto",
    symbol: "BTC/USDT",
    status: "approved"
  });
  const request = await runAction(root, {
    action: "human_gate.request",
    workflowId: "workflow-smoke",
    meetingId: "workflow-smoke",
    traceId: "trace-smoke-hgate",
    parentObjectId: "risk-smoke",
    expiresAt,
    text: "猫爪正式汇报：请选择 A/B/C。",
    buttons,
    payload: { riskDecisionId: "risk-smoke", proposalId: "proposal-smoke" }
  });
  const approved = request.buttons.find((button) => button.decisionStatus === "approved");
  assert.ok(approved?.callbackToken, "approved Human Gate callback token is required for smoke setup");
  await runAction(root, {
    action: "human_gate.resume",
    token: approved.callbackToken,
    text: "闪电猫原话：批准 A，用于 workflow 到 trading_core 的本地 paper smoke。"
  });

  const intent = await runAction(root, {
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
    humanGateId: request.humanGateId,
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
  return intent;
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
  const workflowReceipt = await runAction(root, {
    ...receipt.payload.workflowReceiptAction,
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
