import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runWorkflowAction } from "../workflow.js";

const DEFAULT_ALLOWED_ACTIONS = new Set([
  "workflow.advance.preview",
  "workflow.supervise.preview"
]);

const OPTIONAL_WRITE_ACTIONS = new Set([
  "workflow.checkpoint",
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
    const action = String(request.action || "").trim();
    const actor = String(request.actor || "unknown").trim();
    const reason = String(request.reason || "").trim();
    const payload = request.payload && typeof request.payload === "object" ? request.payload : {};
    const opId = operationId();
    const startedAt = nowIso();
    const input = { action, ...payload };
    const inputHash = hashJson({ action, payload });
    const riskTier = action.endsWith(".preview") ? "P2-preview" : "P2";

    if (!this.allowedActions.has(action)) {
      return {
        ok: false,
        operationId: opId,
        actor,
        action,
        riskTier,
        inputHash,
        errorCode: "action_not_allowed",
        message: `action is not allowed by workflow console MVP: ${action}`
      };
    }
    if (this.readOnly && !action.endsWith(".preview")) {
      return {
        ok: false,
        operationId: opId,
        actor,
        action,
        riskTier,
        inputHash,
        errorCode: "console_readonly",
        message: "workflow console is running in read-only mode"
      };
    }

    const record = {
      ts: startedAt,
      operationId: opId,
      actor,
      action,
      riskTier,
      reason,
      inputHash,
      workflowId: payload.workflowId || payload.workflow_id || "",
      status: "started"
    };
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
      await this.appendOperation({ ...record, ts: completedAt, status: "completed", resultSummary: response.resultSummary });
      return response;
    } catch (error) {
      const completedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      await this.appendOperation({ ...record, ts: completedAt, status: "failed", error: message });
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
    await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  }
}
