export const SESSION_ACTION_HANDLER_NAMES = {
  "workflow.session_pack.upsert": "workflowSessionPackUpsert",
  "workflow.session.pack.upsert": "workflowSessionPackUpsert",
  "session_pack.upsert": "workflowSessionPackUpsert",
  "workflow.session_pack.get": "workflowSessionPackGet",
  "workflow.session.pack.get": "workflowSessionPackGet",
  "session_pack.get": "workflowSessionPackGet",
  "workflow.session_pack.list": "workflowSessionPackList",
  "workflow.session.pack.list": "workflowSessionPackList",
  "session_pack.list": "workflowSessionPackList",
  "workflow.session_run.start": "workflowSessionRunStart",
  "workflow.session.run.start": "workflowSessionRunStart",
  "session_run.start": "workflowSessionRunStart",
  "workflow.session_run.complete": "workflowSessionRunComplete",
  "workflow.session.run.complete": "workflowSessionRunComplete",
  "session_run.complete": "workflowSessionRunComplete"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`session action dependency missing: ${name}`);
  return value;
}

export function createSessionActionRegistry(handlers = {}) {
  const entries = Object.entries(SESSION_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing session action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runSessionAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createSessionActionHandlers(context = {}) {
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const workflowSessionPackGetSnapshot = requireContextFunction(context, "workflowSessionPackGetSnapshot");
  const workflowSessionPackListSnapshot = requireContextFunction(context, "workflowSessionPackListSnapshot");
  const workflowSessionPackUpsertCore = requireContextFunction(context, "workflowSessionPackUpsertCore");
  const workflowSessionRunCompleteCore = requireContextFunction(context, "workflowSessionRunCompleteCore");
  const workflowSessionRunStartCore = requireContextFunction(context, "workflowSessionRunStartCore");

  async function workflowSessionPackUpsert(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionPackUpsertCore(paths, input);
  }

  async function workflowSessionPackGet(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionPackGetSnapshot(paths, input);
  }

  async function workflowSessionPackList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionPackListSnapshot(paths, input);
  }

  async function workflowSessionRunStart(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionRunStartCore(paths, input);
  }

  async function workflowSessionRunComplete(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowSessionRunCompleteCore(paths, input);
  }

  return {
    workflowSessionPackGet,
    workflowSessionPackList,
    workflowSessionPackUpsert,
    workflowSessionRunComplete,
    workflowSessionRunStart
  };
}
