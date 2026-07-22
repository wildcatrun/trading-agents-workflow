export const WORKFLOW_V2_PLAN_STATUSES = new Set(["draft", "planned", "running", "reviewing", "waiting_human", "blocked", "completed", "cancelled"]);
export const WORKFLOW_V2_WORKFLOW_STATES = new Set(["draft", "planned", "active", "waiting_worker", "waiting_review", "waiting_manager", "waiting_group_discussion", "waiting_governance_review", "waiting_protocol_audit", "waiting_cat_brain_check", "waiting_protocol_audit", "human_gate_request_due", "waiting_human", "blocked", "completed", "terminated", "cancelled"]);
export const WORKFLOW_V2_NODE_STATUSES = new Set(["planned", "ready", "running", "reviewing", "blocked", "completed", "failed", "cancelled"]);
export const WORKFLOW_V2_WORKER_RUN_STATUSES = new Set(["queued", "retry_scheduled", "running", "submitted_for_review", "accepted", "rejected", "revise_required", "handoff_required", "retired", "successor_spawned", "blocked", "needs_human_gate", "failed", "timed_out", "cancelled"]);
export const WORKFLOW_V2_INFO_CLASSIFICATIONS = new Set(["public", "internal", "sensitive", "secret", "trading"]);
export const WORKFLOW_V2_SENSITIVE_CLASSIFICATIONS = new Set(["sensitive", "secret", "trading"]);
export const WORKFLOW_V2_CONTENT_STORAGES = new Set(["artifact_ref", "inline", "external_ref", "redacted"]);
export const WORKFLOW_V2_WORKER_BACKENDS = new Set(["hermers", "hermers_docker_worker", "claude_code", "claude_code_docker_worker", "codex", "mcp", "script", "local_deterministic"]);
export const WORKFLOW_V2_DISALLOWED_WORKER_BACKENDS = new Set(["openclaw", "openclaw_route_shell"]);
export const WORKFLOW_V2_ADAPTER_JOB_BACKENDS = new Set(["hermers_docker_worker", "claude_code_docker_worker"]);
export const WORKFLOW_V2_ADAPTER_JOB_IMAGES = {
  hermers_docker_worker: "flashcat/hermes-worker:20260704",
  claude_code_docker_worker: "flashcat/claude-code-worker:20260704"
};
export const WORKFLOW_V2_ADAPTER_JOB_STATUSES = new Set(["queued", "retry_scheduled", "running", "completed", "failed", "cancelled"]);
export const WORKFLOW_V2_WORKER_CONTEXT_LIMIT_TOKENS = 64_000;
export const WORKFLOW_V2_DEFAULT_CONTEXT_PRESSURE_THRESHOLD = 0.81;
export const WORKFLOW_V2_DEFAULT_MAX_COMPACTIONS = 1;
export const WORKFLOW_V2_MAX_CONCURRENT_WORKERS = 200;
export const WORKFLOW_V2_ORCHESTRATION_PATTERNS = new Set([
  "direct_owner_execution",
  "owner_worker",
  "owner_cto_review",
  "manager_worker",
  "parallel_manager_sections",
  "evaluator_optimizer",
  "autonomous_agent_loop"
]);
export const WORKFLOW_V2_WORKER_PATTERNS = new Set([
  "owner_worker",
  "owner_cto_review",
  "manager_worker",
  "parallel_manager_sections",
  "evaluator_optimizer",
  "autonomous_agent_loop"
]);
export const WORKFLOW_V2_NOTIFICATION_PAYLOAD_MODES = new Set(["pointer_only", "legacy_inline"]);
export const WORKFLOW_V2_NOTIFICATION_CHANNELS = new Set(["message_flow", "telegram", "openclaw_im", "local_codex", "workflow_inbox", "none"]);
export const WORKFLOW_V2_REVIEW_DECISIONS = new Set(["accepted", "revise_required", "rejected", "needs_human_gate"]);
export const WORKFLOW_V2_TASK_GROUP_PACKAGE_STATUSES = new Set(["draft", "ready", "revision_required", "cancelled"]);
export const WORKFLOW_V2_GOVERNANCE_AUDIT_DECISIONS = new Set(["approved", "revision_required", "rejected", "needs_human_gate"]);
export const WORKFLOW_V2_PROTOCOL_AUDIT_DECISIONS = new Set(["protocol_ready", "protocol_revision_required", "rejected"]);
export const WORKFLOW_V2_HUMAN_GATE_PACKAGE_STATUSES = new Set(["draft", "protocol_audited"]);
export const WORKFLOW_V2_HUMAN_GATE_SUBMISSION_KINDS = new Set(["plan_review", "task_output", "final_artifact", "release_gate", "incident_closeout", "scope_confirmation", "information_request"]);
export const WORKFLOW_V2_HUMAN_GATE_INTERACTION_TYPES = new Set(["approval", "artifact_acceptance", "review_feedback", "option_selection", "arbitration", "scope_confirmation", "release_gate", "information_request"]);
export const WORKFLOW_V2_HUMAN_GATE_OPTION_KEYS = ["A", "B", "C", "D", "E"];
export const WORKFLOW_V2_WORKER_HANDOFF_STATUSES = new Set(["draft", "recommended", "required", "accepted", "superseded", "cancelled"]);
export const WORKFLOW_V2_HANDOFF_RECORD_STATUSES = new Set(["recommended", "required", "accepted"]);
export const WORKFLOW_V2_SUCCESSOR_SOURCE_STATUSES = new Set(["handoff_required", "retired", "failed", "timed_out", "rejected", "revise_required"]);
