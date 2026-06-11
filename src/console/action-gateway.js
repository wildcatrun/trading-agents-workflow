import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { canonicalWorkflowAction, runWorkflowAction } from "../workflow.js";
import { sqlite, sqlValue } from "./sqlite.js";

const DEFAULT_ALLOWED_ACTIONS = new Set([
  "workflow.advance.preview",
  "workflow.supervise.preview",
  "workflow.pause.preview",
  "workflow.resume.preview",
  "workflow.stop.preview",
  "workflow.incident.from_dead_letter.preview",
  "workflow.control_loop.job.requeue.preview",
  "workflow.incident.closeout.cat_claw_report.preview",
  "workflow.incident.closeout.human_gate_package.preview",
  "workflow.incident.closeout.worklist.preview",
  "workflow.incident.closeout.evidence.preview",
  "workflow.incident.closeout.artifact.preview",
  "workflow.incident.closeout.human_gate_request.preview",
  "telegram.outbox.delivery.preview",
  "telegram.outbox.requeue.preview",
  "telegram.outbox.requeue.execution_package.preview",
  "workflow.rerun.agent.preview",
  "workflow.rerun.phase.preview"
]);

const OPTIONAL_WRITE_ACTIONS = new Set([
  "workflow.checkpoint",
  "workflow.pause",
  "workflow.resume",
  "workflow.stop",
  "workflow.incident.from_dead_letter",
  "workflow.control_loop.job.requeue",
  "workflow.incident.closeout.evidence",
  "workflow.incident.closeout.artifact",
  "workflow.incident.closeout.human_gate_request",
  "telegram.outbox.delivery",
  "human_gate.inbox",
  "human_gate.console"
]);

function nowIso() {
  return new Date().toISOString();
}

function hashJson(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function operationId() {
  return `console_op.${Date.now().toString(36)}.${randomUUID().slice(0, 8)}`;
}

function boolEnv(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").toLowerCase());
}

function redactedResult(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactedResult(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/callback|token|secret|password|api[_-]?key|access[_-]?key|refresh|bot[_-]?token/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactedResult(item);
    }
  }
  return result;
}

function redactText(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/tawhg:[A-Za-z0-9._=-]+/g, "tawhg:<redacted>")
    .replace(/(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)\s+([^\s,;]+)/gi, "$1 [redacted]");
}

function workflowIdFromPayload(payload = {}) {
  return String(payload.workflowId || payload.workflow_id || payload.workflow?.id || "").trim();
}

function operationScope(payload = {}) {
  const workflowId = workflowIdFromPayload(payload);
  if (payload.phaseId || payload.phase_id || payload.phaseKey || payload.phase_key) {
    return { scopeType: "phase", scopeId: String(payload.phaseId || payload.phase_id || payload.phaseKey || payload.phase_key), workflowId };
  }
  if (payload.agentRunId || payload.agent_run_id || payload.dispatchId || payload.dispatch_id) {
    return { scopeType: "agent_run", scopeId: String(payload.agentRunId || payload.agent_run_id || payload.dispatchId || payload.dispatch_id), workflowId };
  }
  if (workflowId) return { scopeType: "workflow", scopeId: workflowId, workflowId };
  return { scopeType: "console", scopeId: "", workflowId: "" };
}

async function ensureWorkflowOperationsTable(dbFile) {
  await sqlite(dbFile, `
CREATE TABLE IF NOT EXISTS workflow_operations (
  operation_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'workflow',
  scope_id TEXT NOT NULL DEFAULT '',
  workflow_id TEXT,
  requested_by TEXT NOT NULL DEFAULT '',
  reason TEXT,
  risk_tier TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  human_gate_id TEXT,
  input_hash TEXT,
  preview_result_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
`, { json: false });
  const existing = new Set((await sqlite(dbFile, "PRAGMA table_info(workflow_operations);", { json: true })).map((row) => row.name));
  const columns = [
    ["operation_id", "TEXT"],
    ["action", "TEXT NOT NULL DEFAULT ''"],
    ["scope_type", "TEXT NOT NULL DEFAULT 'workflow'"],
    ["scope_id", "TEXT NOT NULL DEFAULT ''"],
    ["workflow_id", "TEXT"],
    ["requested_by", "TEXT NOT NULL DEFAULT ''"],
    ["reason", "TEXT"],
    ["risk_tier", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT ''"],
    ["dry_run", "INTEGER NOT NULL DEFAULT 0"],
    ["idempotency_key", "TEXT"],
    ["human_gate_id", "TEXT"],
    ["input_hash", "TEXT"],
    ["preview_result_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["result_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["error", "TEXT"],
    ["created_at", "TEXT NOT NULL DEFAULT ''"],
    ["updated_at", "TEXT NOT NULL DEFAULT ''"],
    ["completed_at", "TEXT"]
  ];
  for (const [name, definition] of columns) {
    if (!existing.has(name)) await sqlite(dbFile, `ALTER TABLE workflow_operations ADD COLUMN ${name} ${definition};`, { json: false });
  }
  await sqlite(dbFile, `
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_operations_operation_id ON workflow_operations(operation_id);
CREATE INDEX IF NOT EXISTS idx_workflow_operations_status ON workflow_operations(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_operations_scope ON workflow_operations(scope_type, scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_operations_workflow ON workflow_operations(workflow_id, updated_at DESC);`, { json: false });
}

export class WorkflowActionGateway {
  constructor(paths, options = {}) {
    this.paths = paths;
    this.readOnly = Boolean(options.readOnly);
    this.allowedActions = new Set(DEFAULT_ALLOWED_ACTIONS);
    if (options.allowWrites || boolEnv("WORKFLOW_CONSOLE_ALLOW_WRITES")) {
      for (const action of OPTIONAL_WRITE_ACTIONS) this.allowedActions.add(action);
    }
  }

  async handle(request = {}) {
    const requestedAction = String(request.action || "").trim();
    const action = canonicalWorkflowAction(requestedAction);
    const actor = String(request.actor || "unknown").trim();
    const reason = String(request.reason || "").trim();
    const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
    const opId = operationId();
    const startedAt = nowIso();
    const input = { ...payload, action, requestedAction, operatorReason: reason, idempotencyKey: payload.idempotencyKey || payload.idempotency_key || opId };
    const inputHash = hashJson({ action, requestedAction, payload });
    const riskTier = action.endsWith(".preview") ? "P2-preview" : "P2";
    const record = {
      ts: startedAt,
      startedAt,
      operationId: opId,
      actor,
      action,
      requestedAction,
      riskTier,
      reason,
      inputHash,
      workflowId: workflowIdFromPayload(payload),
      payload,
      status: "started"
    };

    if (!this.allowedActions.has(action)) {
      const message = `action is not allowed by workflow console MVP: ${action}`;
      await this.appendOperation({ ...record, status: "rejected", error: message, completedAt: startedAt });
      return {
        ok: false,
        operationId: opId,
        actor,
        action,
        riskTier,
        inputHash,
        errorCode: "action_not_allowed",
        message
      };
    }
    if (this.readOnly && !action.endsWith(".preview")) {
      const message = "workflow console is running in read-only mode";
      await this.appendOperation({ ...record, status: "rejected", error: message, completedAt: startedAt });
      return {
        ok: false,
        operationId: opId,
        actor,
        action,
        riskTier,
        inputHash,
        errorCode: "console_readonly",
        message
      };
    }

    await this.appendOperation(record);
    try {
      const result = await runWorkflowAction(this.paths.root, { ...input, workflowRootDir: this.paths.root });
      const completedAt = nowIso();
      const response = {
        ok: true,
        operationId: opId,
        actor,
        action,
        riskTier,
        dryRun: action.endsWith(".preview"),
        inputHash,
        resultSummary: result?.decision || result?.status || "ok",
        result: redactedResult(result)
      };
      await this.appendOperation({ ...record, ts: completedAt, status: "completed", resultSummary: response.resultSummary, result: response.result, completedAt });
      return response;
    } catch (error) {
      const completedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      await this.appendOperation({ ...record, ts: completedAt, status: "failed", error: message, completedAt });
      return {
        ok: false,
        operationId: opId,
        actor,
        action,
        riskTier,
        inputHash,
        errorCode: "action_failed",
        message
      };
    }
  }

  async appendOperation(record) {
    const file = path.join(this.paths.bridgeDir, "console-operations.jsonl");
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(redactedResult(record))}\n`, "utf8");
    await this.upsertWorkflowOperation(record);
  }

  async upsertWorkflowOperation(record) {
    await ensureWorkflowOperationsTable(this.paths.dbFile);
    const status = String(record.status || "").trim() || "started";
    const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
    const scope = operationScope({ ...payload, workflowId: record.workflowId });
    const dryRun = record.action?.endsWith(".preview") ? 1 : 0;
    const resultJson = record.result ? JSON.stringify(redactedResult(record.result)) : "{}";
    const previewResultJson = dryRun && record.result ? resultJson : "{}";
    await sqlite(this.paths.dbFile, `
INSERT INTO workflow_operations(operation_id, action, scope_type, scope_id, workflow_id, requested_by, reason, risk_tier, status, dry_run, idempotency_key, human_gate_id, input_hash, preview_result_json, result_json, error, created_at, updated_at, completed_at)
VALUES (
  ${sqlValue(record.operationId)},
  ${sqlValue(record.action || "")},
  ${sqlValue(scope.scopeType)},
  ${sqlValue(scope.scopeId)},
  ${sqlValue(scope.workflowId || null)},
  ${sqlValue(record.actor || "")},
  ${sqlValue(redactText(record.reason || ""))},
  ${sqlValue(record.riskTier || "")},
  ${sqlValue(status)},
  ${sqlValue(dryRun)},
  ${sqlValue(payload.idempotencyKey || payload.idempotency_key || "")},
  ${sqlValue(payload.humanGateId || payload.human_gate_id || "")},
  ${sqlValue(record.inputHash || "")},
  ${sqlValue(previewResultJson)},
  ${sqlValue(dryRun ? "{}" : resultJson)},
  ${sqlValue(redactText(record.error || ""))},
  ${sqlValue(record.startedAt || record.ts || nowIso())},
  ${sqlValue(record.ts || nowIso())},
  ${sqlValue(record.completedAt || "")}
)
ON CONFLICT(operation_id) DO UPDATE SET
  status=excluded.status,
  preview_result_json=CASE WHEN excluded.preview_result_json != '{}' THEN excluded.preview_result_json ELSE workflow_operations.preview_result_json END,
  result_json=CASE WHEN excluded.result_json != '{}' THEN excluded.result_json ELSE workflow_operations.result_json END,
  error=excluded.error,
  updated_at=excluded.updated_at,
  completed_at=CASE WHEN excluded.completed_at != '' THEN excluded.completed_at ELSE workflow_operations.completed_at END;`, { json: false });
  }
}
