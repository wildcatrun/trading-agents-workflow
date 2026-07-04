export const WORKFLOW_V2_ACTION_HANDLER_NAMES = {
  "workflow.v2.plan.preview": "workflowV2PlanPreview",
  "workflow.v2.plan.create": "workflowV2PlanCreate",
  "workflow.v2.info_stack.preview": "workflowV2InfoStackPreview",
  "workflow.v2.info_stack.record": "workflowV2InfoStackRecord",
  "workflow.v2.info_stack.read": "workflowV2InfoStackRead",
  "workflow.v2.read_receipt.record": "workflowV2ReadReceiptRecord",
  "workflow.v2.notification.preview": "workflowV2NotificationPreview",
  "workflow.v2.worker_backend.preflight": "workflowV2WorkerBackendPreflight",
  "workflow.v2.worker_backend_preflight.record": "workflowV2WorkerBackendPreflightRecord",
  "workflow.v2.worker_spawn.preview": "workflowV2WorkerSpawnPreview",
  "workflow.v2.worker_spawn.create": "workflowV2WorkerSpawnCreate",
  "workflow.v2.worker_lifecycle.preview": "workflowV2WorkerLifecyclePreview",
  "workflow.v2.worker_handoff.preview": "workflowV2WorkerHandoffPreview",
  "workflow.v2.worker_handoff.record": "workflowV2WorkerHandoffRecord",
  "workflow.v2.worker_retire.preview": "workflowV2WorkerRetirePreview",
  "workflow.v2.worker_retire.record": "workflowV2WorkerRetireRecord",
  "workflow.v2.worker_successor.preview": "workflowV2WorkerSuccessorPreview",
  "workflow.v2.worker_successor.create": "workflowV2WorkerSuccessorCreate",
  "workflow.v2.control_loop.preview": "workflowV2ControlLoopPreview",
  "workflow.v2.control_loop.tick": "workflowV2ControlLoopTick",
  "workflow.v2.worker_adapter_job.preview": "workflowV2WorkerAdapterJobPreview",
  "workflow.v2.worker_adapter_job.record": "workflowV2WorkerAdapterJobRecord",
  "workflow.v2.worker_adapter_job.list": "workflowV2WorkerAdapterJobList",
  "workflow.v2.worker_adapter_job.claim": "workflowV2WorkerAdapterJobClaim",
  "workflow.v2.worker_adapter_job.heartbeat": "workflowV2WorkerAdapterJobHeartbeat",
  "workflow.v2.worker_adapter_job.release": "workflowV2WorkerAdapterJobRelease",
  "workflow.v2.worker_adapter_job.fail": "workflowV2WorkerAdapterJobFail",
  "workflow.v2.adapter_runner.preview": "workflowV2AdapterRunnerPreview",
  "workflow.v2.adapter_runner.drain": "workflowV2AdapterRunnerDrain",
  "workflow.v2.worker_result.submit.preview": "workflowV2WorkerResultSubmitPreview",
  "workflow.v2.worker_result.submit": "workflowV2WorkerResultSubmit",
  "workflow.v2.worker_result.fail.preview": "workflowV2WorkerResultFailPreview",
  "workflow.v2.worker_result.fail": "workflowV2WorkerResultFail",
  "workflow.v2.manager_review.record": "workflowV2ManagerReviewRecord",
  "workflow.v2.owner_review.preview": "workflowV2OwnerReviewPreview",
  "workflow.v2.owner_review.record": "workflowV2OwnerReviewRecord",
  "workflow.v2.task_group_package.preview": "workflowV2TaskGroupPackagePreview",
  "workflow.v2.task_group_package.record": "workflowV2TaskGroupPackageRecord",
  "workflow.v2.cat_brain_audit.preview": "workflowV2CatBrainAuditPreview",
  "workflow.v2.cat_brain_audit.record": "workflowV2CatBrainAuditRecord",
  "workflow.v2.cat_claw_audit.preview": "workflowV2CatClawAuditPreview",
  "workflow.v2.cat_claw_audit.record": "workflowV2CatClawAuditRecord",
  "workflow.v2.human_gate_package.preview": "workflowV2HumanGatePackagePreview",
  "workflow.v2.human_gate_package.record": "workflowV2HumanGatePackageRecord",
  "workflow.v2.human_gate_request.preview": "workflowV2HumanGateRequestPreview",
  "workflow.v2.human_gate_request": "workflowV2HumanGateRequest",
  "workflow.v2.validate": "workflowV2Validate"
};

export function createWorkflowV2ActionRegistry(handlers = {}) {
  const entries = Object.entries(WORKFLOW_V2_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") {
      throw new Error(`Missing workflow v2 action handler: ${handlerName}`);
    }
    return [action, handler];
  });
  return new Map(entries);
}

export async function runWorkflowV2Action(registry, action, rootDir, input = {}, permissionDecision = null) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input, permissionDecision) };
}
