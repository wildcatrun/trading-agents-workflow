export const DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS = 300;

export function controlLoopWorkerKillAfterMs(config = {}) {
  const tickBudgetMs = Math.max(5_000, Number(config.tickBudgetMs || config.tick_budget_ms || 60_000));
  const timeoutSeconds = Math.max(5, Number(config.timeoutSeconds || config.timeout_seconds || 45));
  const jobLeaseMs = Math.max(10_000, Number(config.jobLeaseMs || config.job_lease_ms || 120_000));
  const openclawMessageFlowDrainMs = config.drainQueued === false
    ? 0
    : (DEFAULT_MESSAGE_FLOW_SEMANTIC_TIMEOUT_SECONDS + 45) * 1000;
  return Math.max(
    tickBudgetMs + 15_000,
    (timeoutSeconds + 15) * 1000,
    jobLeaseMs + 15_000,
    openclawMessageFlowDrainMs
  );
}
