#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const CHECKS = [
  {
    name: "trade chain and receipt guardrails",
    coverage: [
      "approved Human Gate binding",
      "cat_tail pre-order risk decision",
      "paper executable_trade_intent",
      "idempotency replay/conflict",
      "live execution fail-closed",
      "trading_core receipt transition guardrails"
    ]
  },
  {
    name: "workflow v2 permission and console gate",
    coverage: [
      "risk.decision hard gate",
      "trade.intent Human Gate/Cat Claw/freshness gates",
      "trading_core.receipt Human Gate/freshness gates",
      "side_effect_uncertain blocks trading actions"
    ]
  }
];

function runRegression(check) {
  try {
    const stdout = execFileSync(process.execPath, [
      "scripts/workflow_regression_tests.mjs",
      "--grep",
      check.name
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      name: check.name,
      coverage: check.coverage,
      exitCode: 0,
      stdout: stdout.trim(),
      stderr: ""
    };
  } catch (error) {
    return {
      name: check.name,
      coverage: check.coverage,
      exitCode: error.status ?? 1,
      stdout: String(error.stdout || "").trim(),
      stderr: String(error.stderr || error.message || "").trim()
    };
  }
}

const results = CHECKS.map(runRegression);
const ok = results.every((item) => item.exitCode === 0);

console.log(JSON.stringify({
  schemaVersion: "workflow_v2_trading_pre_execution_smoke.v1",
  ok,
  generatedAt: new Date().toISOString(),
  scope: "P6 paper-only workflow to trading_core pre-execution contract rehearsal",
  sideEffects: {
    brokerCredentials: false,
    liveOrderPlacement: false,
    liveTrading: false,
    realBrokerAdapter: false,
    tradingCorePaperBridge: "covered by separate smoke:trading-core"
  },
  checks: results
}, null, 2));

if (!ok) process.exit(1);
