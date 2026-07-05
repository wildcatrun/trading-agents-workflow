export const RUNTIME_EVENT_ACTION_HANDLER_NAMES = {
  "workflow.runtime_event.record": "workflowRuntimeEventRecord",
  "workflow.runtime.event.record": "workflowRuntimeEventRecord",
  "workflow.runtime-event.record": "workflowRuntimeEventRecord",
  "runtime.semantic.event": "workflowRuntimeEventRecord",
  "runtime.semantic.record": "workflowRuntimeEventRecord",
  "workflow.runtime_event.list": "workflowRuntimeEventList",
  "workflow.runtime.event.list": "workflowRuntimeEventList",
  "workflow.runtime-events": "workflowRuntimeEventList",
  "workflow.runtime.events": "workflowRuntimeEventList",
  "workflow.runtime_current_state": "workflowRuntimeCurrentState",
  "workflow.runtime_event.current": "workflowRuntimeCurrentState",
  "workflow.runtime.current": "workflowRuntimeCurrentState",
  "workflow.runtime_current": "workflowRuntimeCurrentState",
  "runtime.current_state": "workflowRuntimeCurrentState"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`runtime event action dependency missing: ${name}`);
  return value;
}

export function createRuntimeEventActionRegistry(handlers = {}) {
  const entries = Object.entries(RUNTIME_EVENT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing runtime event action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runRuntimeEventAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createRuntimeEventActionHandlers(context = {}) {
  const appendRuntimeSemanticEvent = requireContextFunction(context, "appendRuntimeSemanticEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const workflowRuntimeCurrentStateSnapshot = requireContextFunction(context, "workflowRuntimeCurrentStateSnapshot");
  const workflowRuntimeEventListSnapshot = requireContextFunction(context, "workflowRuntimeEventListSnapshot");

  async function workflowRuntimeEventRecord(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return appendRuntimeSemanticEvent(paths, input);
  }

  async function workflowRuntimeEventList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowRuntimeEventListSnapshot(paths, input);
  }

  async function workflowRuntimeCurrentState(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowRuntimeCurrentStateSnapshot(paths, input);
  }

  return {
    workflowRuntimeCurrentState,
    workflowRuntimeEventList,
    workflowRuntimeEventRecord
  };
}
