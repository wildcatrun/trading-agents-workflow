export const EVENT_ACTION_HANDLER_NAMES = {
  "workflow.event.append": "workflowEventAppend",
  "workflow.events.append": "workflowEventAppend",
  "workflow.event.list": "workflowEventList",
  "workflow.events": "workflowEventList",
  "workflow.events.list": "workflowEventList",
  "workflow.event.timeline": "workflowEventTimeline",
  "workflow.timeline": "workflowEventTimeline",
  "workflow.events.timeline": "workflowEventTimeline"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`event action dependency missing: ${name}`);
  return value;
}

export function createEventActionRegistry(handlers = {}) {
  const entries = Object.entries(EVENT_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing event action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runEventAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createEventActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const workflowEventListSnapshot = requireContextFunction(context, "workflowEventListSnapshot");

  async function workflowEventAppend(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return appendWorkflowEvent(paths, input);
  }

  async function workflowEventList(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowEventListSnapshot(paths, input);
  }

  async function workflowEventTimeline(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    return workflowEventListSnapshot(paths, { ...input, order: "asc" });
  }

  return {
    workflowEventAppend,
    workflowEventList,
    workflowEventTimeline
  };
}
