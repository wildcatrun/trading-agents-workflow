export const PERMISSION_ACTION_HANDLER_NAMES = {
  "workflow.permission.check": "workflowPermissionCheck",
  "workflow.permission.explain": "workflowPermissionCheck"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`permission action dependency missing: ${name}`);
  return value;
}

export function createPermissionActionRegistry(handlers = {}) {
  const entries = Object.entries(PERMISSION_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing permission action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runPermissionAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createPermissionActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const evaluateWorkflowPermission = requireContextFunction(context, "evaluateWorkflowPermission");

  async function workflowPermissionCheck(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const decision = await evaluateWorkflowPermission(paths, input);
    return { ...decision, dbFile: paths.dbFile };
  }

  return {
    workflowPermissionCheck
  };
}
