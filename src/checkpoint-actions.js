export const CHECKPOINT_ACTION_HANDLER_NAMES = {
  "workflow.checkpoint": "workflowCheckpoint",
  "workflow.context_checkpoint": "workflowCheckpoint",
  "context.checkpoint": "workflowCheckpoint"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`checkpoint action dependency missing: ${name}`);
  return value;
}

export function createCheckpointActionRegistry(handlers = {}) {
  const entries = Object.entries(CHECKPOINT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing checkpoint action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runCheckpointAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createCheckpointActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const workflowCheckpointCore = requireContextFunction(context, "workflowCheckpointCore");

  async function workflowCheckpoint(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowCheckpointCore(paths, input);
  }

  return {
    workflowCheckpoint
  };
}
