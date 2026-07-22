-- Workflow v2 orchestration schema draft.
-- Status: documentation-only design draft.
-- Created: 2026-07-03.
--
-- Do not apply this file to workflow_control_plane.db yet.
-- The table names intentionally use workflow_v2_* so the design can be reviewed
-- without claiming that the runtime has already migrated.
--
-- Manager/owner integrity target:
-- runtime_agents.agent_key remains the canonical durable cat-member key. The
-- *_agent_key columns below are the intended foreign-key anchors. The adjacent
-- *_agent text columns are denormalized readability fields and must not be used
-- as the integrity boundary.

BEGIN;

CREATE TABLE IF NOT EXISTS workflow_v2_session_templates (
  template_id TEXT PRIMARY KEY,
  template_kind TEXT NOT NULL CHECK (template_kind IN ('manager', 'worker')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated', 'retired')),
  version INTEGER NOT NULL DEFAULT 1,
  owner_agent_key TEXT,
  owner_agent TEXT,
  manager_agent_key TEXT,
  manager_agent TEXT,
  worker_type TEXT,
  runtime_hint TEXT,
  model_hint TEXT,
  system_brief TEXT NOT NULL,
  context_refs_json TEXT NOT NULL DEFAULT '[]',
  tool_policy_json TEXT NOT NULL DEFAULT '{}',
  input_schema_json TEXT NOT NULL DEFAULT '{}',
  output_schema_json TEXT NOT NULL DEFAULT '{}',
  artifact_contract_json TEXT NOT NULL DEFAULT '{}',
  review_policy_json TEXT NOT NULL DEFAULT '{}',
  budget_json TEXT NOT NULL DEFAULT '{}',
  risk_tier TEXT NOT NULL DEFAULT 'low' CHECK (risk_tier IN ('low', 'medium', 'high', 'trading')),
  pack_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (manager_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_session_templates_kind_status
  ON workflow_v2_session_templates(template_kind, status);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_session_templates_manager
  ON workflow_v2_session_templates(manager_agent, status);

CREATE TABLE IF NOT EXISTS workflow_v2_worker_blueprints (
  blueprint_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'deprecated', 'retired')),
  worker_type TEXT NOT NULL,
  default_template_id TEXT NOT NULL,
  default_runtime TEXT,
  allowed_runtimes_json TEXT NOT NULL DEFAULT '[]',
  required_capabilities_json TEXT NOT NULL DEFAULT '[]',
  spawn_policy_json TEXT NOT NULL DEFAULT '{}',
  artifact_contract_json TEXT NOT NULL DEFAULT '{}',
  review_policy_json TEXT NOT NULL DEFAULT '{}',
  max_attempts INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (default_template_id) REFERENCES workflow_v2_session_templates(template_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_blueprints_type_status
  ON workflow_v2_worker_blueprints(worker_type, status);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_worker_blueprints_template_kind_insert
BEFORE INSERT ON workflow_v2_worker_blueprints
BEGIN
  SELECT CASE
    WHEN COALESCE((
      SELECT template_kind
      FROM workflow_v2_session_templates
      WHERE template_id = NEW.default_template_id
    ), '') != 'worker'
    THEN RAISE(ABORT, 'worker blueprint default_template_id must reference a worker template')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_worker_blueprints_template_kind_update
BEFORE UPDATE OF default_template_id ON workflow_v2_worker_blueprints
BEGIN
  SELECT CASE
    WHEN COALESCE((
      SELECT template_kind
      FROM workflow_v2_session_templates
      WHERE template_id = NEW.default_template_id
    ), '') != 'worker'
    THEN RAISE(ABORT, 'worker blueprint default_template_id must reference a worker template')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_plans (
  plan_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft', 'planned', 'active', 'superseded', 'completed', 'blocked', 'cancelled')
  ),
  workflow_state TEXT NOT NULL DEFAULT 'draft' CHECK (
    workflow_state IN (
      'draft',
      'planned',
      'active',
      'waiting_worker',
      'waiting_review',
      'waiting_manager',
      'waiting_group_discussion',
      'waiting_governance_review',
      'waiting_protocol_audit',
      'waiting_cat_brain_check',
      'waiting_protocol_audit',
      'human_gate_request_due',
      'waiting_human',
      'blocked',
      'completed',
      'terminated',
      'cancelled'
    )
  ),
  task_owner_agent_key TEXT,
  task_owner_agent TEXT NOT NULL,
  planner_agent TEXT NOT NULL DEFAULT 'main',
  source_message_ref TEXT,
  objective TEXT NOT NULL DEFAULT '',
  objective_json TEXT NOT NULL DEFAULT '{}',
  participant_managers_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '[]',
  acceptance_json TEXT NOT NULL DEFAULT '{}',
  constraints_json TEXT NOT NULL DEFAULT '{}',
  human_gate_policy_json TEXT NOT NULL DEFAULT '{}',
  resume_policy_json TEXT NOT NULL DEFAULT '{}',
  plan_spec_artifact_ref TEXT NOT NULL DEFAULT '',
  plan_spec_artifact_hash TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (task_owner_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_plans_workflow
  ON workflow_v2_plans(workflow_id, plan_revision);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_plans_status
  ON workflow_v2_plans(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_plans_workflow_state
  ON workflow_v2_plans(workflow_state, updated_at);

CREATE TABLE IF NOT EXISTS workflow_v2_manager_assignments (
  assignment_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  manager_agent_key TEXT NOT NULL,
  manager_agent TEXT NOT NULL,
  role TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'removed')),
  session_instance_id TEXT,
  selected_by_agent_key TEXT NOT NULL,
  selected_by_agent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (manager_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (selected_by_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_manager_assignments_workflow
  ON workflow_v2_manager_assignments(workflow_id, manager_agent, status);

CREATE TABLE IF NOT EXISTS workflow_v2_session_instances (
  instance_id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  plan_id TEXT,
  node_id TEXT,
  manager_agent_key TEXT,
  manager_agent TEXT,
  task_owner_agent_key TEXT,
  task_owner_agent TEXT,
  runtime TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (
    status IN ('created', 'queued', 'active', 'completed', 'failed', 'cancelled', 'expired')
  ),
  source_context_refs_json TEXT NOT NULL DEFAULT '[]',
  injected_task_json TEXT NOT NULL DEFAULT '{}',
  worker_input_json TEXT NOT NULL DEFAULT '{}',
  forked_from_instance_id TEXT,
  pack_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (template_id) REFERENCES workflow_v2_session_templates(template_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (forked_from_instance_id) REFERENCES workflow_v2_session_instances(instance_id),
  FOREIGN KEY (manager_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (task_owner_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_session_instances_workflow
  ON workflow_v2_session_instances(workflow_id, status);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_session_instances_manager
  ON workflow_v2_session_instances(manager_agent, status);

CREATE TABLE IF NOT EXISTS workflow_v2_plan_nodes (
  node_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (
    node_type IN (
      'manager_turn',
      'worker_task',
      'tool_activity',
      'artifact_synthesis',
      'manager_review',
      'group_discussion',
      'cat_brain_check',
      'protocol_audit',
      'human_gate',
      'checkpoint',
      'closeout'
    )
  ),
  owner_agent_key TEXT,
  owner_agent TEXT,
  manager_agent_key TEXT,
  manager_agent TEXT,
  worker_blueprint_id TEXT,
  session_instance_id TEXT,
  runtime TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (
    status IN (
      'planned',
      'ready',
      'running',
      'waiting_receipt',
      'waiting_review',
      'accepted',
      'rejected',
      'revise_required',
      'blocked',
      'failed',
      'skipped',
      'cancelled'
    )
  ),
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  input_refs_json TEXT NOT NULL DEFAULT '[]',
  expected_artifacts_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria_json TEXT NOT NULL DEFAULT '{}',
  verifier_policy_json TEXT NOT NULL DEFAULT '{}',
  failure_route_json TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  timeout_seconds INTEGER,
  due_at TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (worker_blueprint_id) REFERENCES workflow_v2_worker_blueprints(blueprint_id),
  FOREIGN KEY (session_instance_id) REFERENCES workflow_v2_session_instances(instance_id),
  FOREIGN KEY (owner_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (manager_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_plan_nodes_plan_status
  ON workflow_v2_plan_nodes(plan_id, status, phase_key);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_plan_nodes_workflow_status
  ON workflow_v2_plan_nodes(workflow_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_plan_nodes_manager
  ON workflow_v2_plan_nodes(manager_agent, status);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_plan_nodes_worker_blueprint_insert
BEFORE INSERT ON workflow_v2_plan_nodes
BEGIN
  SELECT CASE
    WHEN NEW.node_type = 'worker_task' AND NEW.worker_blueprint_id IS NULL
    THEN RAISE(ABORT, 'worker_task nodes must reference a worker_blueprint_id')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_plan_nodes_worker_blueprint_update
BEFORE UPDATE OF node_type, worker_blueprint_id ON workflow_v2_plan_nodes
BEGIN
  SELECT CASE
    WHEN NEW.node_type = 'worker_task' AND NEW.worker_blueprint_id IS NULL
    THEN RAISE(ABORT, 'worker_task nodes must reference a worker_blueprint_id')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_worker_runs (
  worker_run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  manager_agent_key TEXT NOT NULL,
  manager_agent TEXT NOT NULL,
  worker_type TEXT NOT NULL,
  worker_blueprint_id TEXT NOT NULL,
  session_instance_id TEXT NOT NULL,
  runtime TEXT NOT NULL,
  adapter TEXT,
  dispatch_id TEXT,
  runtime_run_id TEXT,
  session_run_id TEXT,
  parent_worker_run_id TEXT,
  supersedes_worker_run_id TEXT,
  successor_worker_run_id TEXT,
  worker_generation INTEGER NOT NULL DEFAULT 1 CHECK (worker_generation > 0),
  lifecycle_reason TEXT NOT NULL DEFAULT '',
  context_budget_json TEXT NOT NULL DEFAULT '{}',
  compaction_count INTEGER NOT NULL DEFAULT 0 CHECK (compaction_count >= 0),
  handoff_info_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued',
      'retry_scheduled',
      'dispatched',
      'running',
      'succeeded',
      'submitted_for_review',
      'revise_required',
      'handoff_required',
      'retiring',
      'retired',
      'superseded',
      'successor_spawned',
      'blocked',
      'needs_human_gate',
      'failed',
      'timed_out',
      'cancelled',
      'receipt_missing',
      'output_rejected',
      'accepted'
    )
  ),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT NOT NULL DEFAULT '',
  input_hash TEXT,
  output_hash TEXT,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (node_id) REFERENCES workflow_v2_plan_nodes(node_id),
  FOREIGN KEY (worker_blueprint_id) REFERENCES workflow_v2_worker_blueprints(blueprint_id),
  FOREIGN KEY (session_instance_id) REFERENCES workflow_v2_session_instances(instance_id),
  FOREIGN KEY (parent_worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (supersedes_worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (successor_worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (handoff_info_id) REFERENCES workflow_v2_info_items(info_id),
  FOREIGN KEY (manager_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_workflow_status
  ON workflow_v2_worker_runs(workflow_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_node
  ON workflow_v2_worker_runs(node_id, attempt);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_manager
  ON workflow_v2_worker_runs(manager_agent, status);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_queue
  ON workflow_v2_worker_runs(status, next_retry_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_lease
  ON workflow_v2_worker_runs(status, lease_until);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_runs_lineage
  ON workflow_v2_worker_runs(parent_worker_run_id, worker_generation);

CREATE TABLE IF NOT EXISTS workflow_v2_worker_adapter_jobs (
  adapter_job_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  node_id TEXT NOT NULL DEFAULT '',
  worker_run_id TEXT NOT NULL,
  session_run_id TEXT NOT NULL DEFAULT '',
  runtime_backend TEXT NOT NULL,
  worker_attempt INTEGER NOT NULL DEFAULT 0,
  runner_attempt INTEGER NOT NULL DEFAULT 0,
  max_runner_attempts INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'retry_scheduled', 'running', 'completed', 'failed', 'cancelled')
  ),
  lease_owner TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  next_retry_at TEXT NOT NULL DEFAULT '',
  runner_id TEXT NOT NULL DEFAULT '',
  artifact_ref TEXT NOT NULL DEFAULT '',
  artifact_id TEXT NOT NULL DEFAULT '',
  info_id TEXT NOT NULL DEFAULT '',
  manifest_hash TEXT NOT NULL DEFAULT '',
  runner_receipt_ref TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (info_id) REFERENCES workflow_v2_info_items(info_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_worker_attempt
  ON workflow_v2_worker_adapter_jobs(worker_run_id, worker_attempt);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_queue
  ON workflow_v2_worker_adapter_jobs(status, runtime_backend, next_retry_at, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_lease
  ON workflow_v2_worker_adapter_jobs(status, lease_until);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_adapter_jobs_workflow
  ON workflow_v2_worker_adapter_jobs(workflow_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS workflow_v2_info_items (
  info_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT,
  node_id TEXT,
  worker_run_id TEXT,
  item_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('draft', 'active', 'superseded', 'revoked', 'expired', 'archived')
  ),
  classification TEXT NOT NULL DEFAULT 'internal' CHECK (
    classification IN ('public', 'internal', 'sensitive', 'secret', 'trading')
  ),
  content_storage TEXT NOT NULL DEFAULT 'inline' CHECK (
    content_storage IN ('inline', 'artifact', 'external_ref', 'mixed')
  ),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  created_by_agent_key TEXT,
  created_by TEXT NOT NULL,
  created_by_session_instance_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    classification NOT IN ('sensitive', 'secret', 'trading')
    OR (content_storage IN ('artifact', 'external_ref', 'mixed') AND TRIM(body_text) = '')
  ),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (node_id) REFERENCES workflow_v2_plan_nodes(node_id),
  FOREIGN KEY (worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (created_by_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (created_by_session_instance_id) REFERENCES workflow_v2_session_instances(instance_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_info_items_workflow
  ON workflow_v2_info_items(workflow_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_info_items_node
  ON workflow_v2_info_items(node_id, item_type, status);

CREATE TABLE IF NOT EXISTS workflow_v2_worker_handoffs (
  handoff_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  source_worker_run_id TEXT NOT NULL,
  successor_worker_run_id TEXT,
  manager_agent_key TEXT NOT NULL,
  manager_agent TEXT NOT NULL,
  handoff_status TEXT NOT NULL DEFAULT 'draft' CHECK (
    handoff_status IN ('draft', 'ready', 'consumed', 'superseded', 'rejected')
  ),
  handoff_reason TEXT NOT NULL CHECK (
    handoff_reason IN (
      'context_budget',
      'compaction_limit',
      'quality_decay',
      'stale_run',
      'runtime_error',
      'manager_decision',
      'scope_change',
      'manual'
    )
  ),
  summary TEXT NOT NULL DEFAULT '',
  completed_facts_json TEXT NOT NULL DEFAULT '[]',
  accepted_artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  unresolved_todos_json TEXT NOT NULL DEFAULT '[]',
  failed_paths_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  next_actions_json TEXT NOT NULL DEFAULT '[]',
  context_budget_json TEXT NOT NULL DEFAULT '{}',
  critique_refs_json TEXT NOT NULL DEFAULT '[]',
  info_id TEXT,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  consumed_at TEXT,
  updated_at TEXT NOT NULL,
  CHECK (successor_worker_run_id IS NULL OR successor_worker_run_id != source_worker_run_id),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (node_id) REFERENCES workflow_v2_plan_nodes(node_id),
  FOREIGN KEY (source_worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (successor_worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (manager_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (info_id) REFERENCES workflow_v2_info_items(info_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_handoffs_source
  ON workflow_v2_worker_handoffs(source_worker_run_id, handoff_status);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_worker_handoffs_workflow
  ON workflow_v2_worker_handoffs(workflow_id, handoff_status, updated_at);

CREATE TABLE IF NOT EXISTS workflow_v2_inbox_items (
  inbox_item_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  plan_id TEXT,
  node_id TEXT,
  worker_run_id TEXT,
  recipient_kind TEXT NOT NULL CHECK (
    recipient_kind IN ('agent', 'manager_session', 'worker_session', 'local_codex', 'external_runtime', 'human_gate')
  ),
  recipient_agent_key TEXT,
  recipient_agent TEXT,
  recipient_session_instance_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'notified', 'read', 'acked', 'superseded', 'revoked', 'expired', 'failed')
  ),
  notification_policy TEXT NOT NULL DEFAULT 'auto' CHECK (
    notification_policy IN ('none', 'auto', 'message_flow', 'internal', 'telegram')
  ),
  latest_notification_id TEXT,
  latest_message_flow_id TEXT,
  read_required INTEGER NOT NULL DEFAULT 1,
  ack_required INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  notified_at TEXT,
  read_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (info_id) REFERENCES workflow_v2_info_items(info_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (node_id) REFERENCES workflow_v2_plan_nodes(node_id),
  FOREIGN KEY (worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (recipient_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (recipient_session_instance_id) REFERENCES workflow_v2_session_instances(instance_id),
  FOREIGN KEY (latest_message_flow_id) REFERENCES message_flows(flow_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_inbox_items_recipient
  ON workflow_v2_inbox_items(recipient_agent_key, status, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_inbox_items_workflow
  ON workflow_v2_inbox_items(workflow_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_inbox_items_info
  ON workflow_v2_inbox_items(info_id, status);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_inbox_items_agent_recipient_insert
BEFORE INSERT ON workflow_v2_inbox_items
BEGIN
  SELECT CASE
    WHEN NEW.recipient_kind = 'agent' AND NEW.recipient_agent_key IS NULL
    THEN RAISE(ABORT, 'agent inbox items must include recipient_agent_key')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_inbox_items_agent_recipient_update
BEFORE UPDATE OF recipient_kind, recipient_agent_key ON workflow_v2_inbox_items
BEGIN
  SELECT CASE
    WHEN NEW.recipient_kind = 'agent' AND NEW.recipient_agent_key IS NULL
    THEN RAISE(ABORT, 'agent inbox items must include recipient_agent_key')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_access_grants (
  grant_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  inbox_item_id TEXT,
  workflow_id TEXT NOT NULL,
  grantee_kind TEXT NOT NULL CHECK (
    grantee_kind IN ('agent', 'session_instance', 'runtime_identity', 'local_codex', 'human_gate', 'external_runtime')
  ),
  grantee_agent_key TEXT,
  grantee_agent TEXT,
  grantee_session_instance_id TEXT,
  runtime_identity TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'used', 'expired', 'revoked')
  ),
  scope_json TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT,
  token_hint TEXT NOT NULL DEFAULT '',
  max_reads INTEGER NOT NULL DEFAULT 1 CHECK (max_reads > 0),
  read_count INTEGER NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  expires_at TEXT NOT NULL,
  created_by_agent_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (read_count <= max_reads),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (info_id) REFERENCES workflow_v2_info_items(info_id),
  FOREIGN KEY (inbox_item_id) REFERENCES workflow_v2_inbox_items(inbox_item_id),
  FOREIGN KEY (grantee_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (grantee_session_instance_id) REFERENCES workflow_v2_session_instances(instance_id),
  FOREIGN KEY (created_by_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_access_grants_info
  ON workflow_v2_access_grants(info_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_access_grants_grantee
  ON workflow_v2_access_grants(grantee_agent_key, status, expires_at);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_access_grants_agent_insert
BEFORE INSERT ON workflow_v2_access_grants
BEGIN
  SELECT CASE
    WHEN NEW.grantee_kind = 'agent' AND NEW.grantee_agent_key IS NULL
    THEN RAISE(ABORT, 'agent access grants must include grantee_agent_key')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_access_grants_agent_update
BEFORE UPDATE OF grantee_kind, grantee_agent_key ON workflow_v2_access_grants
BEGIN
  SELECT CASE
    WHEN NEW.grantee_kind = 'agent' AND NEW.grantee_agent_key IS NULL
    THEN RAISE(ABORT, 'agent access grants must include grantee_agent_key')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_access_grants_subject_insert
BEFORE INSERT ON workflow_v2_access_grants
BEGIN
  SELECT CASE
    WHEN NEW.grantee_kind = 'session_instance' AND NEW.grantee_session_instance_id IS NULL
    THEN RAISE(ABORT, 'session_instance access grants must include grantee_session_instance_id')
  END;
  SELECT CASE
    WHEN NEW.grantee_kind IN ('runtime_identity', 'external_runtime', 'local_codex')
      AND TRIM(NEW.runtime_identity) = ''
    THEN RAISE(ABORT, 'runtime-bound access grants must include runtime_identity')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_access_grants_subject_update
BEFORE UPDATE OF grantee_kind, grantee_session_instance_id, runtime_identity ON workflow_v2_access_grants
BEGIN
  SELECT CASE
    WHEN NEW.grantee_kind = 'session_instance' AND NEW.grantee_session_instance_id IS NULL
    THEN RAISE(ABORT, 'session_instance access grants must include grantee_session_instance_id')
  END;
  SELECT CASE
    WHEN NEW.grantee_kind IN ('runtime_identity', 'external_runtime', 'local_codex')
      AND TRIM(NEW.runtime_identity) = ''
    THEN RAISE(ABORT, 'runtime-bound access grants must include runtime_identity')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_read_receipts (
  receipt_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  inbox_item_id TEXT,
  grant_id TEXT,
  workflow_id TEXT NOT NULL,
  reader_kind TEXT NOT NULL CHECK (
    reader_kind IN ('agent', 'session_instance', 'runtime_identity', 'local_codex', 'human_gate', 'external_runtime')
  ),
  reader_agent_key TEXT,
  reader_agent TEXT,
  reader_session_instance_id TEXT,
  runtime TEXT NOT NULL DEFAULT '',
  adapter TEXT NOT NULL DEFAULT '',
  runtime_identity TEXT NOT NULL DEFAULT '',
  read_status TEXT NOT NULL CHECK (
    read_status IN ('read', 'denied', 'expired', 'revoked', 'not_found', 'error')
  ),
  request_ref TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (info_id) REFERENCES workflow_v2_info_items(info_id),
  FOREIGN KEY (inbox_item_id) REFERENCES workflow_v2_inbox_items(inbox_item_id),
  FOREIGN KEY (grant_id) REFERENCES workflow_v2_access_grants(grant_id),
  FOREIGN KEY (reader_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (reader_session_instance_id) REFERENCES workflow_v2_session_instances(instance_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_read_receipts_info
  ON workflow_v2_read_receipts(info_id, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_read_receipts_reader
  ON workflow_v2_read_receipts(reader_agent_key, created_at);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_read_receipts_reader_insert
BEFORE INSERT ON workflow_v2_read_receipts
BEGIN
  SELECT CASE
    WHEN NEW.reader_kind = 'agent' AND NEW.reader_agent_key IS NULL
    THEN RAISE(ABORT, 'agent read receipts must include reader_agent_key')
  END;
  SELECT CASE
    WHEN NEW.reader_kind = 'session_instance' AND NEW.reader_session_instance_id IS NULL
    THEN RAISE(ABORT, 'session_instance read receipts must include reader_session_instance_id')
  END;
  SELECT CASE
    WHEN NEW.reader_kind IN ('runtime_identity', 'external_runtime', 'local_codex')
      AND TRIM(NEW.runtime_identity) = ''
    THEN RAISE(ABORT, 'runtime-bound read receipts must include runtime_identity')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_read_receipts_reader_update
BEFORE UPDATE OF reader_kind, reader_agent_key, reader_session_instance_id, runtime_identity ON workflow_v2_read_receipts
BEGIN
  SELECT CASE
    WHEN NEW.reader_kind = 'agent' AND NEW.reader_agent_key IS NULL
    THEN RAISE(ABORT, 'agent read receipts must include reader_agent_key')
  END;
  SELECT CASE
    WHEN NEW.reader_kind = 'session_instance' AND NEW.reader_session_instance_id IS NULL
    THEN RAISE(ABORT, 'session_instance read receipts must include reader_session_instance_id')
  END;
  SELECT CASE
    WHEN NEW.reader_kind IN ('runtime_identity', 'external_runtime', 'local_codex')
      AND TRIM(NEW.runtime_identity) = ''
    THEN RAISE(ABORT, 'runtime-bound read receipts must include runtime_identity')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_notifications (
  notification_id TEXT PRIMARY KEY,
  info_id TEXT NOT NULL,
  inbox_item_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (
    channel IN ('internal', 'message_flow', 'telegram', 'local_codex', 'runtime_direct')
  ),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'sent', 'delivered', 'failed', 'cancelled', 'superseded')
  ),
  target_agent_key TEXT,
  target_agent TEXT,
  target_session_instance_id TEXT,
  message_flow_id TEXT,
  telegram_outbox_id TEXT,
  payload_mode TEXT NOT NULL DEFAULT 'pointer_only' CHECK (payload_mode IN ('pointer_only', 'legacy_inline')),
  legacy_inline_reason TEXT NOT NULL DEFAULT '',
  notice_payload_json TEXT NOT NULL DEFAULT '{}',
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sent_at TEXT,
  delivered_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (info_id) REFERENCES workflow_v2_info_items(info_id),
  FOREIGN KEY (inbox_item_id) REFERENCES workflow_v2_inbox_items(inbox_item_id),
  FOREIGN KEY (target_agent_key) REFERENCES runtime_agents(agent_key),
  FOREIGN KEY (target_session_instance_id) REFERENCES workflow_v2_session_instances(instance_id),
  FOREIGN KEY (message_flow_id) REFERENCES message_flows(flow_id),
  FOREIGN KEY (telegram_outbox_id) REFERENCES telegram_outbox(outbox_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_notifications_inbox
  ON workflow_v2_notifications(inbox_item_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_notifications_message_flow
  ON workflow_v2_notifications(message_flow_id);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_notifications_message_flow_insert
BEFORE INSERT ON workflow_v2_notifications
BEGIN
  SELECT CASE
    WHEN NEW.channel = 'message_flow'
      AND NEW.status IN ('sent', 'delivered', 'failed')
      AND (NEW.message_flow_id IS NULL OR TRIM(NEW.message_flow_id) = '')
    THEN RAISE(ABORT, 'sent message_flow notifications must include message_flow_id')
  END;
  SELECT CASE
    WHEN NEW.payload_mode = 'legacy_inline' AND TRIM(NEW.legacy_inline_reason) = ''
    THEN RAISE(ABORT, 'legacy inline notification payloads require legacy_inline_reason')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_notifications_message_flow_update
BEFORE UPDATE OF channel, status, message_flow_id, payload_mode, legacy_inline_reason ON workflow_v2_notifications
BEGIN
  SELECT CASE
    WHEN NEW.channel = 'message_flow'
      AND NEW.status IN ('sent', 'delivered', 'failed')
      AND (NEW.message_flow_id IS NULL OR TRIM(NEW.message_flow_id) = '')
    THEN RAISE(ABORT, 'sent message_flow notifications must include message_flow_id')
  END;
  SELECT CASE
    WHEN NEW.payload_mode = 'legacy_inline' AND TRIM(NEW.legacy_inline_reason) = ''
    THEN RAISE(ABORT, 'legacy inline notification payloads require legacy_inline_reason')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_artifacts (
  artifact_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT,
  node_id TEXT,
  worker_run_id TEXT,
  producer_kind TEXT NOT NULL CHECK (producer_kind IN ('manager', 'worker', 'tool', 'human', 'system')),
  producer_agent_key TEXT,
  producer_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'accepted', 'rejected', 'superseded')),
  title TEXT NOT NULL,
  path TEXT,
  content_hash TEXT,
  summary TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (node_id) REFERENCES workflow_v2_plan_nodes(node_id),
  FOREIGN KEY (worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (producer_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_artifacts_workflow
  ON workflow_v2_artifacts(workflow_id, artifact_type, status);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_artifacts_node
  ON workflow_v2_artifacts(node_id, status);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_artifacts_manager_agent_insert
BEFORE INSERT ON workflow_v2_artifacts
BEGIN
  SELECT CASE
    WHEN NEW.producer_kind = 'manager' AND NEW.producer_agent_key IS NULL
    THEN RAISE(ABORT, 'manager artifacts must include producer_agent_key')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_artifacts_manager_agent_update
BEFORE UPDATE OF producer_kind, producer_agent_key ON workflow_v2_artifacts
BEGIN
  SELECT CASE
    WHEN NEW.producer_kind = 'manager' AND NEW.producer_agent_key IS NULL
    THEN RAISE(ABORT, 'manager artifacts must include producer_agent_key')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_manager_reviews (
  review_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  worker_run_id TEXT NOT NULL,
  reviewer_agent_key TEXT NOT NULL,
  reviewer_agent TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (
    review_status IN ('pending', 'accepted', 'revise_required', 'rejected', 'needs_human_gate')
  ),
  rubric_json TEXT NOT NULL DEFAULT '{}',
  findings_json TEXT NOT NULL DEFAULT '[]',
  required_actions_json TEXT NOT NULL DEFAULT '[]',
  blocker_json TEXT NOT NULL DEFAULT '{}',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (node_id) REFERENCES workflow_v2_plan_nodes(node_id),
  FOREIGN KEY (worker_run_id) REFERENCES workflow_v2_worker_runs(worker_run_id),
  FOREIGN KEY (reviewer_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_manager_reviews_node
  ON workflow_v2_manager_reviews(node_id, review_status);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_manager_reviews_reviewer
  ON workflow_v2_manager_reviews(reviewer_agent, review_status);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_worker_runs_accepted_insert
BEFORE INSERT ON workflow_v2_worker_runs
BEGIN
  SELECT CASE
    WHEN NEW.status = 'accepted' AND NOT EXISTS (
      SELECT 1
      FROM workflow_v2_manager_reviews
      WHERE worker_run_id = NEW.worker_run_id AND review_status = 'accepted'
    )
    THEN RAISE(ABORT, 'accepted worker runs require an accepted manager review')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_worker_runs_accepted_update
BEFORE UPDATE OF status ON workflow_v2_worker_runs
BEGIN
  SELECT CASE
    WHEN NEW.status = 'accepted' AND NOT EXISTS (
      SELECT 1
      FROM workflow_v2_manager_reviews
      WHERE worker_run_id = NEW.worker_run_id AND review_status = 'accepted'
    )
    THEN RAISE(ABORT, 'accepted worker runs require an accepted manager review')
  END;
END;

CREATE TABLE IF NOT EXISTS workflow_v2_owner_reviews (
  review_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  owner_agent_key TEXT NOT NULL,
  owner_agent TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (
    review_status IN ('accepted', 'revise_required', 'rejected', 'needs_human_gate')
  ),
  manager_review_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  receipt_refs_json TEXT NOT NULL DEFAULT '[]',
  findings_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (owner_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_owner_reviews_workflow
  ON workflow_v2_owner_reviews(workflow_id, review_status);

CREATE TABLE IF NOT EXISTS workflow_v2_task_group_packages (
  package_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  owner_review_id TEXT NOT NULL,
  task_owner_agent_key TEXT NOT NULL,
  task_owner_agent TEXT NOT NULL,
  participant_agents_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'revision_required', 'cancelled')),
  summary TEXT,
  manager_review_refs_json TEXT NOT NULL DEFAULT '[]',
  owner_review_refs_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  decision_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (owner_review_id) REFERENCES workflow_v2_owner_reviews(review_id),
  FOREIGN KEY (task_owner_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_task_group_packages_workflow
  ON workflow_v2_task_group_packages(workflow_id, status);

CREATE TABLE IF NOT EXISTS workflow_v2_governance_audits (
  audit_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'task_group_package' CHECK (
    source_kind IN ('task_group_package', 'owner_review')
  ),
  task_group_package_id TEXT,
  source_owner_review_id TEXT,
  cat_brain_agent_key TEXT NOT NULL,
  cat_brain_agent TEXT NOT NULL DEFAULT 'main',
  audit_status TEXT NOT NULL CHECK (
    audit_status IN ('approved', 'revision_required', 'rejected', 'needs_human_gate')
  ),
  scope TEXT NOT NULL DEFAULT 'governance_semantic',
  summary TEXT,
  findings_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (source_kind = 'task_group_package' AND task_group_package_id IS NOT NULL AND source_owner_review_id IS NULL)
    OR (source_kind = 'owner_review' AND source_owner_review_id IS NOT NULL AND task_group_package_id IS NULL)
  ),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (task_group_package_id) REFERENCES workflow_v2_task_group_packages(package_id),
  FOREIGN KEY (source_owner_review_id) REFERENCES workflow_v2_owner_reviews(review_id),
  FOREIGN KEY (cat_brain_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_governance_audits_workflow
  ON workflow_v2_governance_audits(workflow_id, audit_status);

CREATE TABLE IF NOT EXISTS workflow_v2_protocol_audits (
  audit_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  governance_audit_id TEXT NOT NULL,
  cat_claw_agent_key TEXT NOT NULL,
  cat_claw_agent TEXT NOT NULL DEFAULT 'cat_claw',
  audit_status TEXT NOT NULL CHECK (
    audit_status IN ('protocol_ready', 'protocol_revision_required', 'rejected')
  ),
  summary TEXT,
  checks_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (governance_audit_id) REFERENCES workflow_v2_governance_audits(audit_id),
  FOREIGN KEY (cat_claw_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_protocol_audits_workflow
  ON workflow_v2_protocol_audits(workflow_id, audit_status);

CREATE TABLE IF NOT EXISTS workflow_v2_group_discussions (
  discussion_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  owner_agent_key TEXT NOT NULL,
  owner_agent TEXT NOT NULL,
  participant_agents_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'blocked', 'cancelled')),
  prompt TEXT NOT NULL,
  summary TEXT,
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  decision_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(workflow_id),
  FOREIGN KEY (plan_id) REFERENCES workflow_v2_plans(plan_id),
  FOREIGN KEY (owner_agent_key) REFERENCES runtime_agents(agent_key)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_group_discussions_workflow
  ON workflow_v2_group_discussions(workflow_id, status);

CREATE TABLE IF NOT EXISTS workflow_v2_human_gate_packages (
  package_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT '',
  source_review_id TEXT NOT NULL DEFAULT '',
  source_protocol_audit_id TEXT NOT NULL DEFAULT '',
  cat_brain_agent TEXT NOT NULL DEFAULT 'main',
  cat_claw_agent TEXT NOT NULL DEFAULT 'cat_claw',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'protocol_audited')),
  options_json TEXT NOT NULL DEFAULT '[]',
  required_controls_json TEXT NOT NULL DEFAULT '[]',
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_human_gate_packages_workflow
  ON workflow_v2_human_gate_packages(workflow_id, status);

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_human_gate_packages_audited_insert
BEFORE INSERT ON workflow_v2_human_gate_packages
BEGIN
  SELECT CASE
    WHEN NEW.status IN ('protocol_audited')
      AND COALESCE(json_array_length(NEW.options_json), 0) < 2
    THEN RAISE(ABORT, 'audited Human Gate packages require at least two options')
  END;
  SELECT CASE
    WHEN NEW.status IN ('protocol_audited')
      AND COALESCE(json_array_length(NEW.options_json), 0) > 5
    THEN RAISE(ABORT, 'audited Human Gate packages allow at most five options')
  END;
  SELECT CASE
    WHEN NEW.status IN ('protocol_audited')
      AND (instr(NEW.required_controls_json, 'pause') = 0 OR instr(NEW.required_controls_json, 'terminate') = 0)
    THEN RAISE(ABORT, 'audited Human Gate packages require pause and terminate controls')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_workflow_v2_human_gate_packages_audited_update
BEFORE UPDATE OF status, options_json, required_controls_json ON workflow_v2_human_gate_packages
BEGIN
  SELECT CASE
    WHEN NEW.status IN ('protocol_audited')
      AND COALESCE(json_array_length(NEW.options_json), 0) < 2
    THEN RAISE(ABORT, 'audited Human Gate packages require at least two options')
  END;
  SELECT CASE
    WHEN NEW.status IN ('protocol_audited')
      AND COALESCE(json_array_length(NEW.options_json), 0) > 5
    THEN RAISE(ABORT, 'audited Human Gate packages allow at most five options')
  END;
  SELECT CASE
    WHEN NEW.status IN ('protocol_audited')
      AND (instr(NEW.required_controls_json, 'pause') = 0 OR instr(NEW.required_controls_json, 'terminate') = 0)
    THEN RAISE(ABORT, 'audited Human Gate packages require pause and terminate controls')
  END;
END;

-- Relationship notes:
-- 1. workflow_v2_session_templates generalizes workflow_session_packs.
-- 2. workflow_v2_session_instances generalizes task-scoped session pack use.
-- 3. workflow_v2_worker_runs should link to current dispatch/receipt surfaces
--    through dispatch_id, runtime_run_id, and session_run_id during migration.
-- 4. workflow_v2_artifacts can bridge to existing artifact_index rows by path
--    or artifact id conventions.
-- 5. workflow_v2_owner_reviews, task_group_packages, governance_audits, and
--    protocol_audits are internal high-speed agent review records, not Human
--    Gate waits. The normal Human Gate source should be a protocol-ready Cat
--    Claw audit; source_review_id remains only for compatibility and migration.
-- 6. workflow_v2_human_gate_packages records the local Cat Brain/Cat Claw
--    audited evidence package only. Existing protocol_objects, human_gate
--    records, telegram_outbox rows, submitted/completed states, Flashcat text,
--    and callback/resume fields belong to the later Human Gate delivery bridge.
-- 7. workflow_v2_plans.status is plan lifecycle. workflow_v2_plans.workflow_state
--    is the orchestration control-loop state and must preserve waiting_* states
--    plus human_gate_request_due, which is the internal cursor after Cat Claw
--    protocol readiness and before the formal Human Gate request exists.
--    The canonical prepare-task output is workflow_plan_spec.v2 JSON. Plan rows
--    are runtime indexes/state mirrors and should store artifact ref/hash rather
--    than becoming the only plan authority.
--    payload_json.orchestration is runtime-significant: it must contain pattern,
--    rationale, workerBudget.maxWorkers, workerBudget.concurrencyLimit, and
--    workerBudget.maxWorkerContextTokens. Application validation caps worker
--    context at 64k and concurrent workers at the pool limit.
--    objective_json, acceptance_json, and resume_policy_json are design-level
--    extension slots. The current runtime mirror writes objective,
--    acceptance_criteria_json, constraints_json, payload_json, and the
--    plan_spec_artifact_ref/hash pair.
--    workflow_v2_worker_runs.payload_json.delegation is also
--    runtime-significant: it must contain objective, outputFormat, toolBoundary,
--    acceptanceCriteria, and stopCondition/stopConditions.
-- 8. Human Gate package rows in the current local runtime slice only use
--    'draft', 'protocol_audited', and legacy 'protocol_audited'. Application-level validation must still
--    require a protocol-ready Protocol audit from the same workflow and plan.
--    The schema draft also checks that audited packages carry two to five
--    options and pause/terminate controls; runtime code must still perform
--    structured JSON validation instead of relying only on substring checks.
--    Package rows are authored evidence and must not fabricate missing options.
--    waiting_human starts only after the formal Human Gate request is created
--    or reused by the Human Gate bridge.
-- 9. workflow_v2_info_items, inbox_items, access_grants, read_receipts, and
--    notifications form the v2 information stack. message_flow should reference
--    these rows as a notification bridge, not carry authoritative manager/worker
--    content.
-- 10. token_hash stores only a verifier hash. Plaintext read tokens must not be
--    stored in this schema, artifacts, message_flow payloads, or Telegram text.
-- 11. workflow_v2_worker_runs.status='accepted' is only a cached lifecycle
--     summary. The authority is an accepted workflow_v2_manager_reviews row.
--     Manager review status deliberately excludes 'blocked'. Blockers should
--     be recorded in blocker_json / required_actions_json, while blocked remains
--     a worker, node, plan, or workflow condition state.
-- 12. workflow_v2_notifications.payload_mode defaults to pointer_only. Legacy
--     inline payloads require an explicit legacy_inline_reason and must not be
--     used for new v2 worker communication.
-- 13. worker lifecycle renewal is part of the v2 design. Worker runs may be
--     retired, superseded, or replaced by same-class successor workers when
--     context pressure, repeated compaction, stale assumptions, or manager
--     review failures make the current session unreliable.
-- 14. workflow_v2_worker_adapter_jobs is the durable pull-runner queue for
--     non-local workers. It records the runner manifest artifact/info pointer,
--     runner lease, retry state, and terminal runner receipt. Runner claim,
--     heartbeat, release, and fail operations must re-check that the underlying
--     worker run is still running on the same attempt with an unexpired worker
--     lease. This table does not grant worker containers direct write access to
--     workflow_v2_worker_runs or the central database. Terminal adapter-job
--     submit/fail updates must also match the runner lease. Terminal
--     adapter-job failure should close the associated worker/session through
--     the governed worker failure path instead of leaving it to expire
--     naturally.
-- 15. workflow.v2.adapter_runner.drain is a local runner bridge over
--     workflow_v2_worker_adapter_jobs. The current runtime slice only supports
--     mock mode: claim, read manifest artifact, write mock output artifact, and
--     return through governed submit/fail actions. Manifest hash is mandatory
--     and must match before a runner accepts the artifact. Real Hermers/Claude
--     Code Docker runners should use the same table and return contract, not
--     direct database writes.
-- 16. workflow_v2_worker_handoffs stores the curated handoff package. It should
--     reference info items, artifacts, receipts, and manager critiques instead
--     of copying raw transcripts.

ROLLBACK;
