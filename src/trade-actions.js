export const TRADE_ACTION_HANDLER_NAMES = {
  "trade.proposal": "tradeProposal"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`trade action dependency missing: ${name}`);
  return value;
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
  const parseJsonValue = requireContextFunction(context, "parseJsonValue");
  const protocolRecord = requireContextFunction(context, "protocolRecord");

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

  return {
    tradeProposal
  };
}
