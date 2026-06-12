export const DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS = 300;

function finiteNumber(value, fallback, min = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, number);
}

export function controlLoopWorkerKillAfterMs(config = {}) {
  const tickBudgetMs = finiteNumber(config.tickBudgetMs ?? config.tick_budget_ms, 60_000, 5_000);
  const timeoutSeconds = finiteNumber(config.timeoutSeconds ?? config.timeout_seconds, 45, 5);
  const jobLeaseMs = finiteNumber(config.jobLeaseMs ?? config.job_lease_ms, 120_000, 10_000);
  const openclawMessageFlowDrainMs = (DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS + 45) * 1000;
  return Math.max(
    tickBudgetMs + 15_000,
    (timeoutSeconds + 15) * 1000,
    jobLeaseMs + 15_000,
    openclawMessageFlowDrainMs
  );
}
