import path from "node:path";
import {
  firstText,
  jsonHash,
  parseJsonValue,
  redactSensitiveForPersistence,
  safeId,
  textHash,
  toList
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const TRADE_ACTION_HANDLER_NAMES = {
  "trade.proposal": "tradeProposal",
  "risk.decision": "riskDecision",
  "trade.intent": "tradeIntent",
  "execution.intent": "tradeIntent",
  "trading_core.receipt": "tradingCoreReceipt",
  "execution.receipt": "tradingCoreReceipt"
};

const RISK_DECISION_STATUSES = new Set(["pending", "approved", "rejected", "revise_required"]);
const TRADING_CORE_SIDES = new Set(["buy", "sell"]);
const TRADING_CORE_ORDER_TYPES = new Set(["market", "limit"]);
const TRADING_CORE_ASSURANCE_VALUES = new Set(["mtls", "codex_mtls", "local_codex_mtls"]);
const TRADING_CORE_EXECUTION_MODES = new Set(["paper", "simulation"]);
const RECEIPT_STATUSES = new Set(["accepted", "rejected", "submitted", "filled", "partial", "cancelled", "failed"]);
const TRADING_CORE_RECEIPT_TRANSITIONS = {
  ready_for_trading_core: new Set(["accepted", "submitted", "partial", "filled", "cancelled", "rejected", "failed"]),
  trading_core_accepted: new Set(["submitted", "partial", "filled", "cancelled", "rejected", "failed"]),
  trading_core_submitted: new Set(["partial", "filled", "cancelled", "failed", "rejected"]),
  trading_core_partial: new Set(["partial", "filled", "cancelled", "failed"]),
  trading_core_rejected: new Set([]),
  trading_core_failed: new Set([]),
  trading_core_cancelled: new Set([]),
  trading_core_filled: new Set([])
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`trade action dependency missing: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function receiptIntentStatus(status) {
  if (status === "rejected" || status === "failed") return `trading_core_${status}`;
  return `trading_core_${status}`;
}

function numericField(source = {}, keys = []) {
  for (const key of keys) {
    const value = numberOrNull(source[key]);
    if (value !== null) return value;
  }
  return null;
}

function normalizeTradingCorePriceConstraints(value, orderType) {
  const raw = parseJsonValue(value, value || {});
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const referencePrice = numericField(input, ["referencePrice", "reference_price", "lastPrice", "last_price", "price"]);
  const limitPrice = numericField(input, ["limitPrice", "limit_price"]);
  const maxSlippageBps = numericField(input, ["maxSlippageBps", "max_slippage_bps"]);
  const referencePriceTimestamp = firstText(
    input.referencePriceTimestamp,
    input.reference_price_timestamp,
    input.referencePriceAt,
    input.reference_price_at,
    input.priceTimestamp,
    input.price_timestamp,
    input.asOf,
    input.as_of
  );
  const normalized = {};
  const rejectionReasons = [];
  if (referencePrice === null || referencePrice <= 0) {
    rejectionReasons.push("missing_positive_reference_price");
  } else {
    normalized.referencePrice = referencePrice;
  }
  if (orderType === "limit") {
    if (limitPrice === null || limitPrice <= 0) {
      rejectionReasons.push("missing_positive_limit_price");
    } else {
      normalized.limitPrice = limitPrice;
    }
  } else if (limitPrice !== null && limitPrice > 0) {
    normalized.limitPrice = limitPrice;
  }
  if (maxSlippageBps !== null && maxSlippageBps >= 0) normalized.maxSlippageBps = maxSlippageBps;
  if (referencePriceTimestamp) normalized.referencePriceTimestamp = referencePriceTimestamp;
  return { value: normalized, rejectionReasons };
}

function normalizeTradingCoreRiskLimits(value) {
  const raw = parseJsonValue(value, value || {});
  const input = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const normalized = {};
  const maxNotionalUsd = numericField(input, ["maxNotionalUsd", "max_notional_usd", "maxNotional", "max_notional"]);
  const maxOrderNotionalUsd = numericField(input, ["maxOrderNotionalUsd", "max_order_notional_usd", "maxOrderNotional", "max_order_notional"]);
  const maxLossUsd = numericField(input, ["maxLossUsd", "max_loss_usd", "maxLoss", "max_loss"]);
  const maxDailyLossUsd = numericField(input, ["maxDailyLossUsd", "max_daily_loss_usd", "maxDailyLoss", "max_daily_loss"]);
  const rejectionReasons = [];
  if (maxNotionalUsd !== null) normalized.maxNotionalUsd = maxNotionalUsd;
  if (maxOrderNotionalUsd !== null) normalized.maxOrderNotionalUsd = maxOrderNotionalUsd;
  if (maxLossUsd !== null) normalized.maxLossUsd = maxLossUsd;
  if (maxDailyLossUsd !== null) normalized.maxDailyLossUsd = maxDailyLossUsd;
  const hasPositiveNotionalGuardrail = (maxNotionalUsd !== null && maxNotionalUsd > 0) || (maxOrderNotionalUsd !== null && maxOrderNotionalUsd > 0);
  const hasLossGuardrail = (maxLossUsd !== null && maxLossUsd >= 0) || (maxDailyLossUsd !== null && maxDailyLossUsd >= 0);
  if (!hasPositiveNotionalGuardrail && !hasLossGuardrail) rejectionReasons.push("missing_numeric_risk_guardrail");
  if ((maxNotionalUsd !== null && maxNotionalUsd <= 0) || (maxOrderNotionalUsd !== null && maxOrderNotionalUsd <= 0)) {
    rejectionReasons.push("invalid_notional_risk_guardrail");
  }
  if ((maxLossUsd !== null && maxLossUsd < 0) || (maxDailyLossUsd !== null && maxDailyLossUsd < 0)) {
    rejectionReasons.push("invalid_loss_risk_guardrail");
  }
  return { value: normalized, rejectionReasons };
}

function executableTradeIntentHash(intent) {
  return jsonHash({ ...intent, intentHash: "" });
}

function protocolObjectExpiresAt(protocolObject = {}, protocolPayloadField) {
  return protocolPayloadField(protocolObject, ["expiresAt", "expires_at"]);
}

function buildExecutableTradeIntent(input, data) {
  const {
    intentId,
    status,
    instrument,
    side,
    quantity,
    orderType,
    proposalId,
    riskDecisionId,
    preOrderRiskAuditId,
    humanGateId,
    workflowId,
    traceId,
    executionMode,
    sourceSystem,
    actor,
    assurance,
    clientCertFingerprint,
    idempotencyKey,
    priceConstraints,
    riskLimits,
    expiresAt,
    marketType,
    exchange,
    baseAsset,
    quoteAsset,
    clientOrderId,
    timeInForce,
    rejectionReasons
  } = data;
  const executable = {
    schemaVersion: 1,
    objectType: "executable_trade_intent",
    intentId,
    workflowId,
    traceId,
    status,
    assetType: instrument.assetType,
    symbol: instrument.symbol,
    side,
    quantity,
    orderType,
    proposalId,
    riskDecisionId,
    preOrderRiskAuditId,
    humanGateId,
    actor,
    assurance,
    clientCertFingerprint,
    idempotencyKey,
    priceConstraints,
    riskLimits,
    expiresAt,
    executionMode,
    sourceSystem,
    rejectionReasons
  };
  const optional = {
    marketType,
    exchange,
    baseAsset,
    quoteAsset,
    clientOrderId,
    timeInForce,
    payload: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}))
  };
  for (const [key, value] of Object.entries(optional)) {
    if (key === "payload") {
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) executable[key] = value;
      continue;
    }
    const text = String(value || "").trim();
    if (text) executable[key] = text;
  }
  executable.intentHash = executableTradeIntentHash(executable);
  return executable;
}

export function createTradeActionRegistry(handlers = {}) {
  const entries = Object.entries(TRADE_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing trade action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runTradeAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createTradeActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const findCatTailPreOrderRiskAuditDispatch = requireContextFunction(context, "findCatTailPreOrderRiskAuditDispatch");
  const protocolObjectReferences = requireContextFunction(context, "protocolObjectReferences");
  const protocolPayloadField = requireContextFunction(context, "protocolPayloadField");
  const protocolPayloadValue = requireContextFunction(context, "protocolPayloadValue");
  const protocolRecord = requireContextFunction(context, "protocolRecord");
  const readProtocolObject = requireContextFunction(context, "readProtocolObject");
  const upsertInstrumentRecord = requireContextFunction(context, "upsertInstrumentRecord");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");

  async function tradeProposal(rootDir, input) {
    return protocolRecord(rootDir, {
      ...input,
      objectType: "trade_proposal",
      objectId: input.proposalId || input.proposal_id || input.objectId || input.object_id,
      status: input.status || "proposed",
      sourceSystem: input.sourceSystem || input.source_system || "openclaw_hermers",
      sourceAgent: input.sourceAgent || input.source_agent || input.createdBy || input.from || "cat_heart",
      payload: {
        thesisId: input.thesisId || input.thesis_id || "",
        memoId: input.memoId || input.memo_id || "",
        side: input.side || "",
        quantity: input.quantity || "",
        orderType: input.orderType || input.order_type || "",
        priceConstraints: parseJsonValue(input.priceConstraints || input.price_constraints, input.priceConstraints || input.price_constraints || {}),
        riskLimits: parseJsonValue(input.riskLimits || input.risk_limits, input.riskLimits || input.risk_limits || {}),
        rationale: input.rationale || input.summary || input.text || "",
        raw: parseJsonValue(input.payload, input.payload || {})
      }
    });
  }

  async function riskDecision(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const statusRaw = String(input.status || "pending").trim();
    const status = RISK_DECISION_STATUSES.has(statusRaw) ? statusRaw : "pending";
    const proposalId = String(input.proposalId || input.proposal_id || input.parentObjectId || input.parent_object_id || "").trim();
    const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
    const preOrderRiskAuditId = String(input.preOrderRiskAuditId || input.pre_order_risk_audit_id || input.auditId || input.audit_id || "").trim();
    const decision = String(input.decision || input.riskDecision || input.risk_decision || (status === "approved" ? "approved_for_paper_execution" : status)).trim();
    const reviewerAgent = String(input.reviewerAgent || input.reviewer_agent || "cat_tail").trim();
    const dispatchType = String(input.dispatchType || input.dispatch_type || "pre_order_risk_audit").trim();
    const riskLimits = parseJsonValue(input.riskLimits || input.risk_limits, input.riskLimits || input.risk_limits || {});
    const normalizedRisk = normalizeTradingCoreRiskLimits(riskLimits);
    const evidenceRefs = toList(input.evidenceRefs || input.evidence_refs);
    const isTerminalRiskDecision = status === "approved" || status === "rejected";
    if (isTerminalRiskDecision) {
      const terminalLabel = status;
      const proposal = await readProtocolObject(paths, proposalId);
      if (!proposalId || !proposal || proposal.object_type !== "trade_proposal") {
        throw new Error(`${terminalLabel} risk.decision requires an existing trade_proposal parent`);
      }
      const humanGate = await readProtocolObject(paths, humanGateId);
      if (!humanGateId || !humanGate || humanGate.object_type !== "human_gate_record" || humanGate.status !== "approved") {
        throw new Error(`${terminalLabel} risk.decision requires an approved Human Gate parent`);
      }
      if (!protocolObjectReferences(humanGate, proposalId)) {
        throw new Error(`${terminalLabel} risk.decision requires Human Gate bound to the trade_proposal`);
      }
      if (!preOrderRiskAuditId) throw new Error(`${terminalLabel} risk.decision requires preOrderRiskAuditId`);
      if (reviewerAgent !== "cat_tail") throw new Error(`${terminalLabel} risk.decision requires reviewerAgent=cat_tail`);
      if (dispatchType !== "pre_order_risk_audit") throw new Error(`${terminalLabel} risk.decision requires dispatchType=pre_order_risk_audit`);
      if (status === "approved" && decision !== "approved_for_paper_execution") throw new Error("approved risk.decision currently allows only approved_for_paper_execution");
      if (status === "rejected" && decision !== "rejected") throw new Error("rejected risk.decision requires decision=rejected");
      if (normalizedRisk.rejectionReasons.length) throw new Error(`${terminalLabel} risk.decision requires numeric riskLimits: ${normalizedRisk.rejectionReasons.join(",")}`);
      if (!evidenceRefs.length) throw new Error(`${terminalLabel} risk.decision requires evidenceRefs`);
      const workflowId = firstText(input.workflowId, input.workflow_id, protocolPayloadField(humanGate, ["workflowId", "workflow_id"]));
      const catTailDispatch = await findCatTailPreOrderRiskAuditDispatch(paths, { workflowId, humanGateId, proposalId, preOrderRiskAuditId });
      if (!catTailDispatch) throw new Error(`${terminalLabel} risk.decision requires matching cat_tail pre_order_risk_audit dispatch`);
    }
    return protocolRecord(rootDir, {
      ...input,
      objectType: "risk_decision",
      objectId: input.riskDecisionId || input.risk_decision_id || input.decisionId || input.decision_id || input.objectId || input.object_id,
      parentObjectId: proposalId,
      status,
      sourceSystem: input.sourceSystem || input.source_system || "openclaw",
      sourceAgent: input.sourceAgent || input.source_agent || input.reviewerAgent || input.reviewer_agent || "cat_tail",
      payload: {
        proposalId,
        humanGateId,
        preOrderRiskAuditId,
        reviewerAgent,
        dispatchType,
        riskBudgetImpact: input.riskBudgetImpact || input.risk_budget_impact || "",
        decision,
        riskLimits: normalizedRisk.value,
        evidenceRefs,
        paperRef: input.paperRef || input.paper_ref || input.artifactRef || input.artifact_ref || "",
        summary: input.summary || input.text || "",
        raw: parseJsonValue(input.payload, input.payload || {})
      }
    });
  }

  async function tradeIntent(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const idempotencyKey = String(input.idempotencyKey || input.idempotency_key || "").trim();
    let existingIntent = null;
    if (idempotencyKey) {
      const existing = await sqlite(paths.dbFile, `SELECT * FROM executable_trade_intents WHERE idempotency_key=${sqlValue(idempotencyKey)} LIMIT 1;`, { json: true });
      existingIntent = existing[0] || null;
    }

    const instrument = await upsertInstrumentRecord(paths, input);
    const intentId = input.intentId || input.intent_id || safeId("intent");
    const proposalId = String(input.proposalId || input.proposal_id || "").trim();
    const riskDecisionId = String(input.riskDecisionId || input.risk_decision_id || "").trim();
    const preOrderRiskAuditId = String(input.preOrderRiskAuditId || input.pre_order_risk_audit_id || "").trim();
    const humanGateId = String(input.humanGateId || input.human_gate_id || "").trim();
    const sideRaw = String(input.side || "").trim().toLowerCase();
    const side = TRADING_CORE_SIDES.has(sideRaw) ? sideRaw : "";
    const orderTypeRaw = String(input.orderType || input.order_type || "limit").trim().toLowerCase();
    const orderType = TRADING_CORE_ORDER_TYPES.has(orderTypeRaw) ? orderTypeRaw : "";
    const actor = String(input.actor || input.from || "").trim().toLowerCase();
    const assurance = String(input.assurance || input.authAssurance || input.auth_assurance || input.auth?.assurance || "").trim().toLowerCase();
    const sourceSystem = String(input.sourceSystem || input.source_system || input.source || "unknown").trim();
    const clientCertFingerprint = String(input.clientCertFingerprint || input.client_cert_fingerprint || input.cert || "").trim();
    const quantity = numberOrNull(input.quantity);
    const expiresAt = String(input.expiresAt || input.expires_at || "").trim();
    const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
    const normalizedPrice = normalizeTradingCorePriceConstraints(input.priceConstraints || input.price_constraints, orderType);
    const priceConstraints = normalizedPrice.value;
    let normalizedRisk = normalizeTradingCoreRiskLimits(input.riskLimits || input.risk_limits);
    let riskLimits = normalizedRisk.value;
    const proposal = await readProtocolObject(paths, proposalId);
    const risk = await readProtocolObject(paths, riskDecisionId);
    const humanGate = await readProtocolObject(paths, humanGateId);
    const callerProvidedRiskLimits = input.riskLimits !== undefined || input.risk_limits !== undefined;
    let riskDecisionRiskLimits = null;
    if (risk && risk.object_type === "risk_decision") {
      riskDecisionRiskLimits = normalizeTradingCoreRiskLimits(protocolPayloadValue(risk, ["riskLimits", "risk_limits"]));
      normalizedRisk = riskDecisionRiskLimits;
      riskLimits = normalizedRisk.value;
    }
    const workflowId = firstText(input.workflowId, input.workflow_id, protocolPayloadField(humanGate, ["workflowId", "workflow_id"]));
    const traceId = firstText(input.traceId, input.trace_id, protocolPayloadField(humanGate, ["traceId", "trace_id"]));
    const executionMode = String(input.executionMode || input.execution_mode || "paper").trim().toLowerCase();
    const marketType = String(input.marketType || input.market_type || "").trim().toLowerCase();
    const exchange = String(input.exchange || "").trim();
    const baseAsset = String(input.baseAsset || input.base_asset || "").trim().toUpperCase();
    const quoteAsset = String(input.quoteAsset || input.quote_asset || "").trim().toUpperCase();
    const clientOrderId = String(input.clientOrderId || input.client_order_id || idempotencyKey || "").trim();
    const timeInForce = String(input.timeInForce || input.time_in_force || "").trim().toLowerCase();
    const humanGateExpiresAt = protocolObjectExpiresAt(humanGate || {}, protocolPayloadField);
    const humanGateExpiresAtMs = humanGateExpiresAt ? Date.parse(humanGateExpiresAt) : NaN;
    const rejectionReasons = [];

    if (!proposalId || !proposal || proposal.object_type !== "trade_proposal") rejectionReasons.push("missing_valid_trade_proposal");
    if (!riskDecisionId || !risk || risk.object_type !== "risk_decision" || risk.status !== "approved") rejectionReasons.push("missing_approved_cat_tail_risk_decision");
    if (!humanGateId || !humanGate || humanGate.object_type !== "human_gate_record" || humanGate.status !== "approved") rejectionReasons.push("missing_approved_flashcat_human_gate");
    if (!preOrderRiskAuditId) rejectionReasons.push("missing_pre_order_risk_audit_id");
    if (proposal && proposal.object_type === "trade_proposal" && risk && risk.object_type === "risk_decision" && !protocolObjectReferences(risk, proposalId)) {
      rejectionReasons.push("risk_decision_not_bound_to_trade_proposal");
    }
    if (risk && risk.object_type === "risk_decision") {
      if (protocolPayloadField(risk, ["reviewerAgent", "reviewer_agent"]) !== "cat_tail") rejectionReasons.push("risk_decision_reviewer_must_be_cat_tail");
      if (protocolPayloadField(risk, ["dispatchType", "dispatch_type"]) !== "pre_order_risk_audit") rejectionReasons.push("risk_decision_must_come_from_pre_order_risk_audit");
      if (protocolPayloadField(risk, ["decision"]) !== "approved_for_paper_execution") rejectionReasons.push("risk_decision_must_approve_paper_execution");
      if (!protocolObjectReferences(risk, humanGateId)) rejectionReasons.push("risk_decision_not_bound_to_human_gate");
      if (!protocolObjectReferences(risk, preOrderRiskAuditId)) rejectionReasons.push("risk_decision_not_bound_to_pre_order_risk_audit");
      if (riskDecisionRiskLimits?.rejectionReasons.length) rejectionReasons.push("risk_decision_missing_numeric_risk_limits");
      const evidenceRefs = protocolPayloadValue(risk, ["evidenceRefs", "evidence_refs"]);
      if (!Array.isArray(evidenceRefs) || !evidenceRefs.length) rejectionReasons.push("risk_decision_missing_evidence_refs");
      const catTailDispatch = await findCatTailPreOrderRiskAuditDispatch(paths, { workflowId, humanGateId, proposalId, preOrderRiskAuditId });
      if (!catTailDispatch) rejectionReasons.push("risk_decision_missing_cat_tail_pre_order_risk_audit_dispatch");
      if (callerProvidedRiskLimits) {
        const callerRisk = normalizeTradingCoreRiskLimits(input.riskLimits || input.risk_limits);
        if (JSON.stringify(callerRisk.value) !== JSON.stringify(riskLimits)) rejectionReasons.push("risk_limits_must_match_cat_tail_risk_decision");
      }
    }
    if (humanGate && humanGate.object_type === "human_gate_record") {
      if (!protocolObjectReferences(humanGate, proposalId)) rejectionReasons.push("human_gate_not_bound_to_trade_proposal");
      if (humanGateExpiresAt && (!Number.isFinite(humanGateExpiresAtMs) || humanGateExpiresAtMs <= Date.now())) rejectionReasons.push("human_gate_expired");
    }
    if (proposal?.instrument_id && proposal.instrument_id !== instrument.instrumentId) rejectionReasons.push("proposal_instrument_mismatch");
    if (risk?.instrument_id && risk.instrument_id !== instrument.instrumentId) rejectionReasons.push("risk_decision_instrument_mismatch");
    if (humanGate?.instrument_id && humanGate.instrument_id !== instrument.instrumentId) rejectionReasons.push("human_gate_instrument_mismatch");
    if (!workflowId) rejectionReasons.push("missing_workflow_id");
    if (!traceId) rejectionReasons.push("missing_trace_id");
    if (!TRADING_CORE_EXECUTION_MODES.has(executionMode)) rejectionReasons.push("invalid_execution_mode");
    if (actor !== "flashcat") rejectionReasons.push("actor_must_be_flashcat");
    if (!TRADING_CORE_ASSURANCE_VALUES.has(assurance)) rejectionReasons.push("local_codex_mtls_required");
    if (!clientCertFingerprint) rejectionReasons.push("client_cert_fingerprint_required");
    if (!side) rejectionReasons.push("invalid_trading_core_side");
    if (!idempotencyKey) rejectionReasons.push("missing_idempotency_key");
    if (quantity === null || quantity <= 0) rejectionReasons.push("invalid_trade_quantity");
    if (!orderType) rejectionReasons.push("invalid_trading_core_order_type");
    if (instrument.assetType === "crypto") {
      if (marketType !== "spot") rejectionReasons.push("crypto_market_type_must_be_spot");
      if (!exchange) rejectionReasons.push("crypto_exchange_required");
      if (!baseAsset) rejectionReasons.push("crypto_base_asset_required");
      if (!quoteAsset) rejectionReasons.push("crypto_quote_asset_required");
      if (!clientOrderId) rejectionReasons.push("crypto_client_order_id_required");
      if (!timeInForce) rejectionReasons.push("crypto_time_in_force_required");
    }
    if (!expiresAt || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) rejectionReasons.push("missing_or_expired_intent_expiry");
    rejectionReasons.push(...normalizedPrice.rejectionReasons);
    rejectionReasons.push(...normalizedRisk.rejectionReasons);

    const status = rejectionReasons.length ? "rejected" : "ready_for_trading_core";
    const createdAt = nowIso();
    const executableIntent = buildExecutableTradeIntent(input, {
      intentId,
      status,
      instrument,
      side: side || sideRaw,
      quantity,
      orderType: orderType || orderTypeRaw,
      proposalId,
      riskDecisionId,
      preOrderRiskAuditId,
      humanGateId,
      humanGate,
      workflowId,
      traceId,
      executionMode,
      sourceSystem,
      actor,
      assurance,
      clientCertFingerprint,
      idempotencyKey,
      priceConstraints,
      riskLimits,
      expiresAt,
      marketType,
      exchange,
      baseAsset,
      quoteAsset,
      clientOrderId,
      timeInForce,
      rejectionReasons
    });
    const payload = {
      ...executableIntent,
      intentId,
      status,
      instrumentId: instrument.instrumentId,
      assetType: instrument.assetType,
      symbol: instrument.symbol,
      side: side || sideRaw,
      quantity,
      orderType: orderType || orderTypeRaw,
      proposalId,
      riskDecisionId,
      preOrderRiskAuditId,
      humanGateId,
      sourceSystem,
      actor,
      assurance,
      clientCertFingerprintHash: clientCertFingerprint ? textHash(clientCertFingerprint) : "",
      rawInput: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}))
    };
    const persistencePayload = {
      ...payload,
      clientCertFingerprint: clientCertFingerprint ? "[redacted]" : ""
    };
    const intentHash = executableIntent.intentHash;
    if (existingIntent) {
      if (String(existingIntent.intent_hash || "") === intentHash) {
        return { ...existingIntent, idempotentReplay: true, dbFile: paths.dbFile };
      }
      throw new Error("idempotency_key_conflict: existing executable_trade_intent payload differs from this request");
    }
    const relPath = await writeJsonArtifact(paths.root, paths.intentsDir, intentId, executableIntent);
    await sqlite(paths.dbFile, `
INSERT INTO executable_trade_intents(intent_id, status, instrument_id, asset_type, symbol, side, quantity, order_type, proposal_id, risk_decision_id, human_gate_id, source_system, actor, assurance, client_cert_fingerprint, idempotency_key, intent_hash, payload_json, rejection_reason, created_at, updated_at)
VALUES (${sqlValue(intentId)}, ${sqlValue(status)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(instrument.assetType)}, ${sqlValue(instrument.symbol)}, ${sqlValue(side || sideRaw)}, ${sqlValue(quantity)}, ${sqlValue(orderType || orderTypeRaw)}, ${sqlValue(proposalId)}, ${sqlValue(riskDecisionId)}, ${sqlValue(humanGateId)}, ${sqlValue(sourceSystem)}, ${sqlValue(actor)}, ${sqlValue(assurance)}, ${sqlValue(clientCertFingerprint ? textHash(clientCertFingerprint) : "")}, ${sqlValue(idempotencyKey)}, ${sqlValue(intentHash)}, ${sqlValue(JSON.stringify(persistencePayload))}, ${sqlValue(rejectionReasons.join(","))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
    await protocolRecord(rootDir, {
      ...input,
      objectType: "executable_trade_intent",
      objectId: intentId,
      instrumentId: instrument.instrumentId,
      assetType: instrument.assetType,
      symbol: instrument.symbol,
      parentObjectId: humanGateId,
      status,
      sourceSystem,
      sourceAgent: actor || "unknown",
      payload: { ...persistencePayload, relativePath: relPath }
    });
    return { intentId, status, rejectionReasons, instrumentId: instrument.instrumentId, path: path.join(paths.root, relPath), relativePath: relPath, intentHash, dbFile: paths.dbFile };
  }

  async function tradingCoreReceipt(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const intentId = String(input.intentId || input.intent_id || "").trim();
    if (!intentId) throw new Error("intentId is required");
    const intents = await sqlite(paths.dbFile, `SELECT * FROM executable_trade_intents WHERE intent_id=${sqlValue(intentId)} LIMIT 1;`, { json: true });
    const intent = intents[0];
    if (!intent) throw new Error(`unknown intentId: ${intentId}`);
    const statusRaw = String(input.status || "accepted").trim();
    if (!RECEIPT_STATUSES.has(statusRaw)) throw new Error(`unknown trading_core receipt status: ${statusRaw || "<empty>"}`);
    const status = statusRaw;
    const currentIntentStatus = String(intent.status || "").trim();
    const allowedTransitions = TRADING_CORE_RECEIPT_TRANSITIONS[currentIntentStatus];
    if (!allowedTransitions || !allowedTransitions.has(status)) {
      throw new Error(`invalid trading_core receipt transition: ${currentIntentStatus || "<unknown>"} -> ${status}`);
    }
    const receiptId = input.receiptId || input.receipt_id || safeId("receipt");
    const createdAt = nowIso();
    const payload = {
      receiptId,
      intentId,
      status,
      tradingCoreRef: input.tradingCoreRef || input.trading_core_ref || "",
      sourceSystem: input.sourceSystem || input.source_system || "trading_core",
      summary: input.summary || input.text || "",
      raw: redactSensitiveForPersistence(parseJsonValue(input.payload, input.payload || {}))
    };
    const relPath = await writeJsonArtifact(paths.root, paths.receiptsDir, receiptId, payload);
    await sqlite(paths.dbFile, `
INSERT INTO trading_core_receipts(receipt_id, intent_id, status, trading_core_ref, source_system, payload_json, created_at)
VALUES (${sqlValue(receiptId)}, ${sqlValue(intentId)}, ${sqlValue(status)}, ${sqlValue(payload.tradingCoreRef)}, ${sqlValue(payload.sourceSystem)}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)});
UPDATE executable_trade_intents
SET status=${sqlValue(receiptIntentStatus(status))}, updated_at=${sqlValue(createdAt)}
WHERE intent_id=${sqlValue(intentId)};`);
    await protocolRecord(rootDir, {
      objectType: "trading_core_receipt",
      objectId: receiptId,
      parentObjectId: intentId,
      status,
      sourceSystem: payload.sourceSystem,
      sourceAgent: "trading_core",
      payload: { ...payload, relativePath: relPath }
    });
    return { receiptId, intentId, status, tradingCoreRef: payload.tradingCoreRef, path: path.join(paths.root, relPath), relativePath: relPath, dbFile: paths.dbFile };
  }

  return {
    riskDecision,
    tradeIntent,
    tradeProposal,
    tradingCoreReceipt
  };
}
