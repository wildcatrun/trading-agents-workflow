import { readFileSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { workflowPaths } from "../workflow.js";
import { WorkflowActionGateway } from "./action-gateway.js";
import { WorkflowReadModel } from "./read-model.js";

const CONSOLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "static", "console");
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const OPERATOR_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const RELEASE_QUALITY_GATE_DEFAULTS = [
  {
    key: "spark_code_review",
    status: "required",
    detail: "Medium or higher GUI changes require independent Spark/subagent review, findings, fixes, and residual risks recorded in the rollout note."
  },
  {
    key: "regression_suite",
    status: "required",
    detail: "Rollout evidence must record npm run check, workflow regression, syntax checks, and git diff whitespace checks."
  },
  {
    key: "browser_smoke",
    status: "required",
    detail: "Rollout evidence must record desktop and mobile console smoke coverage for changed surfaces, redaction, routing, and overflow behavior."
  },
  {
    key: "deployment_trace",
    status: "required",
    detail: "Rollout evidence must record Git commit, development checkout HEAD, console process, health probes, and Gateway restart boundary."
  }
];
const RELEASE_QUALITY_GATE_STATUSES = new Set(["required", "recorded", "pass", "warn", "fail"]);
const RELEASE_QUALITY_EVIDENCE_SCHEMA_VERSION = "workflow_console_release_quality_evidence.v1";

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function splitHost(value = "") {
  const host = String(value || "").trim();
  if (host.startsWith("[") && host.includes("]")) return host.slice(1, host.indexOf("]")).toLowerCase();
  if (host.split(":").length > 2) return host.toLowerCase();
  return host.split(":")[0].replace(/\.$/, "").toLowerCase();
}

function isLoopbackHost(host) {
  const normalized = splitHost(host || "").toLowerCase();
  return LOOPBACK_HOSTS.has(normalized) || normalized === "0:0:0:0:0:0:0:1";
}

function allowedHost(host, options) {
  if (!host) return false;
  if (isLoopbackHost(host)) return true;
  if (options.host && host === splitHost(options.host)) return true;
  return options.allowedHosts.has(host);
}

function sameOrigin(req, value) {
  try {
    const parsed = new URL(value);
    return parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeRelativePath(root, filePath) {
  const resolvedRoot = path.resolve(root || ".");
  const resolvedFile = path.resolve(filePath || "");
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return relative;
}

function pathInsideRoot(root, filePath) {
  const resolvedRoot = path.resolve(root || ".");
  const resolvedFile = path.resolve(filePath || "");
  const relative = path.relative(resolvedRoot, resolvedFile);
  return Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeReleaseQualityGate(row = {}, fallback = {}) {
  const key = String(row.key || fallback.key || "").trim();
  if (!key) return undefined;
  const status = RELEASE_QUALITY_GATE_STATUSES.has(String(row.status || "")) ? String(row.status) : (fallback.status || "required");
  const detail = String(row.detail || row.summary || fallback.detail || "").trim();
  const normalized = { ...fallback, ...row, key, status, detail };
  if (Array.isArray(row.evidenceRefs)) normalized.evidenceRefs = row.evidenceRefs.map((item) => String(item)).filter(Boolean);
  if (row.checkedAt) normalized.checkedAt = String(row.checkedAt);
  if (row.command) normalized.command = String(row.command);
  return normalized;
}

function releaseQualityEvidencePath(paths, options = {}) {
  const configured = options.releaseQualityEvidencePath || process.env.WORKFLOW_CONSOLE_RELEASE_QUALITY_EVIDENCE || "";
  const candidate = configured || path.join(paths.root, "artifacts", "console-release-quality", "latest.json");
  return path.resolve(paths.root, candidate);
}

function releaseQualityEvidenceTarget(paths, options = {}) {
  const filePath = releaseQualityEvidencePath(paths, options);
  const relativePath = safeRelativePath(paths.root, filePath);
  if (!pathInsideRoot(paths.root, filePath)) {
    return { ok: false, status: "ignored", path: relativePath, reason: "outside_root" };
  }
  try {
    const rootReal = realpathSync(paths.root);
    const fileReal = realpathSync(filePath);
    if (!pathInsideRoot(rootReal, fileReal)) {
      return { ok: false, status: "ignored", path: relativePath, reason: "outside_root_realpath" };
    }
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, status: "missing", path: relativePath, filePath };
    return { ok: false, status: "ignored", path: relativePath, reason: "invalid_path", error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, status: "ready", path: relativePath, filePath };
}

function readReleaseQualityEvidence(paths, options = {}) {
  const target = releaseQualityEvidenceTarget(paths, options);
  if (!target.ok) {
    return {
      status: target.status,
      path: target.path || "",
      reason: target.reason || "invalid_path",
      error: target.error || target.reason || "release quality evidence path is not allowed"
    };
  }
  if (target.status === "missing") return { status: "missing", path: target.path, error: "" };
  try {
    const parsed = JSON.parse(readFileSync(target.filePath, "utf8"));
    if (parsed.schemaVersion !== RELEASE_QUALITY_EVIDENCE_SCHEMA_VERSION) {
      return { status: "missing", path: target.path, reason: "invalid_schema", error: "invalid_schema_version" };
    }
    const gatesInput = Array.isArray(parsed.gates)
      ? parsed.gates
      : Object.entries(parsed.gates || {}).map(([key, value]) => ({ key, ...(value && typeof value === "object" ? value : { detail: String(value || "") }) }));
    const gateByKey = new Map(gatesInput.map((row) => {
      const normalized = normalizeReleaseQualityGate(row);
      return normalized ? [normalized.key, normalized] : undefined;
    }).filter(Boolean));
    return {
      status: "loaded",
      path: target.path,
      schemaVersion: parsed.schemaVersion,
      releaseId: parsed.releaseId || "",
      commit: parsed.commit || "",
      generatedAt: parsed.generatedAt || "",
      gateByKey
    };
  } catch (error) {
    return {
      status: "missing",
      path: target.path,
      reason: error && error.code === "ENOENT" ? "" : "invalid_json",
      error: error && error.code === "ENOENT" ? "" : error instanceof Error ? error.message : String(error)
    };
  }
}

function releaseQualityGatesFromEvidence(paths, options = {}) {
  const evidence = readReleaseQualityEvidence(paths, options);
  const gates = RELEASE_QUALITY_GATE_DEFAULTS.map((gate) => {
    const recorded = evidence.gateByKey?.get(gate.key);
    return normalizeReleaseQualityGate(recorded, gate);
  });
  return {
    evidence: {
      status: evidence.status,
      path: evidence.path,
      schemaVersion: evidence.schemaVersion || "workflow_console_release_quality_evidence.v1",
      releaseId: evidence.releaseId || "",
      commit: evidence.commit || "",
      generatedAt: evidence.generatedAt || "",
      reason: evidence.reason || "",
      error: evidence.error || ""
    },
    gates
  };
}

function json(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readBody(req) {
  return parseBodyText(await readBodyText(req));
}

async function readBodyText(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseBodyText(text) {
  if (!text) return {};
  return JSON.parse(text);
}

function authOk(req, options) {
  if (!options.token) return true;
  const header = String(req.headers.authorization || "");
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const direct = String(req.headers["x-workflow-console-token"] || "").trim();
  return bearer === options.token || direct === options.token;
}

function mutationOriginOk(req) {
  const secFetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (secFetchSite === "cross-site") return false;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin) return sameOrigin(req, origin);
  if (referer) return sameOrigin(req, referer);
  return true;
}

function assertConsoleSecurityOptions(options = {}) {
  const host = String(options.host || "").trim() || "127.0.0.1";
  const token = String(options.token || "").trim();
  const allowWrites = Boolean(options.allowWrites);
  const signingSecret = String(options.operatorSigningSecret || "").trim();
  if (!token && !isLoopbackHost(host)) {
    throw new Error("WORKFLOW_CONSOLE_TOKEN is required when workflow console binds to a non-loopback host");
  }
  if (allowWrites && !token) {
    throw new Error("WORKFLOW_CONSOLE_TOKEN is required when WORKFLOW_CONSOLE_ALLOW_WRITES is enabled");
  }
  if (allowWrites && !signingSecret) {
    throw new Error("WORKFLOW_CONSOLE_OPERATOR_SIGNING_SECRET is required when WORKFLOW_CONSOLE_ALLOW_WRITES is enabled");
  }
}

function hmacHex(secret, text) {
  return createHmac("sha256", secret).update(text).digest("hex");
}

function constantTimeEqualHex(left = "", right = "") {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

export function operatorActionSignatureOk(req, options = {}, bodyText = "") {
  if (!options.allowWrites) return { ok: true };
  const signingSecret = String(options.operatorSigningSecret || "").trim();
  if (!signingSecret) return { ok: false, error: "operator_signing_secret_missing" };
  const signatureHeader = String(req.headers["x-workflow-operator-signature"] || "").trim();
  const timestamp = String(req.headers["x-workflow-operator-timestamp"] || "").trim();
  if (!signatureHeader) return { ok: false, error: "operator_signature_required" };
  if (!timestamp) return { ok: false, error: "operator_signature_timestamp_required" };
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > OPERATOR_SIGNATURE_TOLERANCE_MS) {
    return { ok: false, error: "operator_signature_timestamp_invalid" };
  }
  const supplied = signatureHeader.replace(/^sha256=/i, "").trim();
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return { ok: false, error: "operator_signature_invalid" };
  const expected = hmacHex(signingSecret, `${timestamp}.${bodyText}`);
  return constantTimeEqualHex(supplied, expected)
    ? { ok: true }
    : { ok: false, error: "operator_signature_mismatch" };
}

export async function workflowChildPayload(readModel, workflowId, child = "", query = {}) {
  if (!child) return await readModel.workflowDetail(workflowId);
  if (child === "phases") return await readModel.phases(workflowId);
  if (child === "tasks") return await readModel.tasks(workflowId);
  if (child === "dispatches") return await readModel.dispatches(workflowId, query);
  if (child === "runtime-runs") return await readModel.runtimeRuns(workflowId, query);
  if (child === "agent-runs") return await readModel.agentRuns(workflowId, query);
  if (child === "verification") return await readModel.verification(workflowId, query);
  if (child === "message-flows") return await readModel.messageFlows(workflowId, query);
  if (child === "human-gates") return await readModel.humanGates(workflowId);
  if (child === "human-gate-readiness") return await readModel.humanGateReadiness(workflowId);
  if (child === "incident-evidence-options") return await readModel.incidentEvidenceOptions(workflowId, query);
  if (child === "incident-closeout") return await readModel.incidentCloseout(workflowId, query);
  if (child === "outbox") return await readModel.outbox(workflowId, query);
  if (child === "checkpoints") return await readModel.checkpoints(workflowId);
  if (child === "evidence") return await readModel.evidence(workflowId);
  if (child === "receipts") return await readModel.receipts(workflowId, query);
  if (child === "evidence-pack") return await readModel.evidencePack(workflowId, query);
  if (child === "evidence-desk") return await readModel.evidenceDesk(workflowId, query);
  if (child === "timeline") return await readModel.timeline(workflowId, query);
  return undefined;
}

export function buildConsoleConfig(paths, options = {}) {
  const readOnly = Boolean(options.readOnly);
  const allowWrites = Boolean(options.allowWrites);
  const releaseQuality = releaseQualityGatesFromEvidence(paths, options);
  return {
    service: "workflow-console",
    rootDir: paths.root,
    readOnlyMode: readOnly,
    actionMode: readOnly || !allowWrites ? "preview-only" : "allowlisted",
    operatorPolicy: {
      role: "local_console_operator_unverified",
      roleEvidence: "static_local_console_role",
      previewActions: "allowed",
      writeActions: readOnly ? "hidden_read_only" : allowWrites ? "allowlisted_by_gateway_with_signed_operator_action" : "hidden_without_allow_writes",
      authToken: options.token ? "required_configured" : "loopback_read_only_optional",
      signedOperatorAction: allowWrites ? "required_for_api_actions" : "not_required_without_write_mode",
      evidenceExport: "redacted_browser_download",
      auditSurface: "workflow_operations"
    },
    releaseQualityEvidence: releaseQuality.evidence,
    releaseQualityGates: releaseQuality.gates,
    serverTime: options.serverTime || new Date().toISOString(),
    allowedViews: ["active", "waiting_human", "blocked", "paused", "updated_24h"],
    allowedWorkflowQueues: ["active", "waiting_human", "blocked", "paused", "updated_24h"],
    allowedConsoleViews: ["command-center", "activity", "agent-board", "kanban", "evidence-workspace", "operations", "system", "workflows"],
    redactionPolicyVersion: "workflow_console_redaction_v1",
    securityBoundaries: [
      { key: "loopback_default", status: "enforced", detail: "Console binds to loopback unless startup config overrides host." },
      { key: "host_allowlist", status: "enforced", detail: "Unknown Host headers are rejected before routing." },
      { key: "token_required_for_non_loopback_or_writes", status: "enforced", detail: "Non-loopback binding and write-enabled console mode require WORKFLOW_CONSOLE_TOKEN." },
      { key: "signed_operator_action", status: allowWrites ? "enforced" : "not_required", detail: allowWrites ? "Write-enabled /api/actions requests require an HMAC signature over timestamp and raw request body." : "Write mode is disabled; action requests are preview-only or rejected by the action gateway." },
      { key: "no_query_token", status: "enforced", detail: "Authentication accepts headers only; query-string tokens are not used." },
      { key: "cross_origin_mutation_block", status: "browser_enforced", detail: "Blocks cross-site Sec-Fetch-Site and mismatched Origin/Referer; non-browser requests without Origin/Referer rely on Host allowlist and token policy." },
      { key: "preview_first_actions", status: readOnly || !allowWrites ? "enforced" : "policy_enabled", detail: readOnly ? "Read-only mode exposes preview actions only." : allowWrites ? "Writes are limited to the action gateway allowlist." : "Non-preview writes are hidden because WORKFLOW_CONSOLE_ALLOW_WRITES is off." },
      { key: "redaction", status: "enforced", detail: "Read APIs redact callback tokens, secrets, OAuth-ish fields, and sensitive payloads." }
    ]
  };
}

async function serveStatic(req, res, pathname) {
  const clean = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(CONSOLE_DIR, clean);
  const relative = path.relative(CONSOLE_DIR, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const stat = await fs.stat(target);
    const file = stat.isDirectory() ? path.join(target, "index.html") : target;
    const body = await fs.readFile(file);
    res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
    res.end(body);
  } catch {
    const body = await fs.readFile(path.join(CONSOLE_DIR, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  }
}

export function createConsoleServer(options = {}) {
  const rootDir = options.rootDir || process.env.TRADING_AGENTS_WORKFLOW_ROOT || process.env.CAT_MEETING_GOVERNANCE_ROOT;
  if (!rootDir) {
    throw new Error("workflow console root is required; pass rootDir or set TRADING_AGENTS_WORKFLOW_ROOT. The legacy shared workflow root is retired.");
  }
  const paths = workflowPaths(rootDir, { workflowRootDir: rootDir });
  const readOnly = options.readOnly ?? boolEnv("WORKFLOW_CONSOLE_READONLY", true);
  const allowWrites = Boolean(options.allowWrites ?? boolEnv("WORKFLOW_CONSOLE_ALLOW_WRITES"));
  const readModel = new WorkflowReadModel(paths);
  const actionGateway = new WorkflowActionGateway(paths, { readOnly, allowWrites });
  const serverOptions = {
    host: options.host || process.env.WORKFLOW_CONSOLE_HOST || "127.0.0.1",
    port: Number(options.port || process.env.WORKFLOW_CONSOLE_PORT || 8791),
    token: options.token || process.env.WORKFLOW_CONSOLE_TOKEN || "",
    operatorSigningSecret: options.operatorSigningSecret || process.env.WORKFLOW_CONSOLE_OPERATOR_SIGNING_SECRET || "",
    allowedHosts: new Set(String(options.allowedHosts || process.env.WORKFLOW_CONSOLE_ALLOWED_HOSTS || "").split(",").map((item) => splitHost(item)).filter(Boolean)),
    readOnly,
    allowWrites,
    rootDir: paths.root
  };
  assertConsoleSecurityOptions(serverOptions);

  const server = http.createServer(async (req, res) => {
    try {
      const host = splitHost(req.headers.host || "");
      if (!allowedHost(host, serverOptions)) return json(res, 400, { ok: false, error: "host_not_allowed" });
      if (!authOk(req, serverOptions)) return json(res, 401, { ok: false, error: "unauthorized" });
      if (MUTATING_METHODS.has(req.method) && !mutationOriginOk(req)) {
        return json(res, 403, { ok: false, error: "cross_origin_mutation_blocked" });
      }

      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const pathname = url.pathname;
      if (req.method === "GET" && pathname === "/health") {
        const health = await readModel.health();
        return json(res, 200, { ok: true, service: "workflow-console", ...health, rootDir: paths.root, readOnly });
      }
      if (req.method === "GET" && pathname === "/api/config") {
        return json(res, 200, buildConsoleConfig(paths, serverOptions));
      }
      if (req.method === "GET" && pathname === "/api/workflows") {
        return json(res, 200, await readModel.workflowList(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/task-launches") {
        return json(res, 200, await readModel.taskLaunches(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/command-center") {
        return json(res, 200, await readModel.commandCenter(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/activity-feed") {
        return json(res, 200, await readModel.activityFeed(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/command-palette") {
        return json(res, 200, await readModel.commandPalette(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/agent-board") {
        return json(res, 200, await readModel.agentBoard(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/kanban") {
        return json(res, 200, await readModel.kanban(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/search") {
        return json(res, 200, await readModel.globalSearch(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "POST" && pathname === "/api/search") {
        return json(res, 200, await readModel.globalSearch(await readBody(req)));
      }
      if (req.method === "GET" && pathname === "/api/runtime-current-state") {
        return json(res, 200, await readModel.runtimeCurrentState(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/templates") {
        return json(res, 200, await readModel.templateList(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/templates/stats") {
        return json(res, 200, await readModel.templateStats(Object.fromEntries(url.searchParams)));
      }
      const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
      if (req.method === "GET" && templateMatch) {
        return json(res, 200, await readModel.templateDetail(decodeURIComponent(templateMatch[1]), Object.fromEntries(url.searchParams)));
      }
      const workflowMatch = pathname.match(/^\/api\/workflows\/([^/]+)(?:\/([^/]+))?$/);
      if (req.method === "GET" && workflowMatch) {
        const workflowId = decodeURIComponent(workflowMatch[1]);
        const child = workflowMatch[2] || "";
        const query = Object.fromEntries(url.searchParams);
        const payload = await workflowChildPayload(readModel, workflowId, child, query);
        if (payload === undefined) return json(res, 404, { ok: false, error: "not_found" });
        if (!child && !payload) return json(res, 404, { ok: false, error: "workflow_not_found" });
        return json(res, 200, payload);
      }
      if (req.method === "GET" && pathname === "/api/runtime-agents") return json(res, 200, await readModel.runtimeAgents());
      if (req.method === "GET" && pathname === "/api/operations/summary") return json(res, 200, await readModel.operationsSummary(Object.fromEntries(url.searchParams)));
      if (req.method === "GET" && pathname === "/api/operations/dead-letter-evidence") return json(res, 200, await readModel.deadLetterEvidence(Object.fromEntries(url.searchParams)));
      if (req.method === "GET" && pathname === "/api/readiness/latest") return json(res, 200, await readModel.readinessLatest());
      if (req.method === "POST" && pathname === "/api/actions") {
        const bodyText = await readBodyText(req);
        const signature = operatorActionSignatureOk(req, serverOptions, bodyText);
        if (!signature.ok) return json(res, 401, { ok: false, error: signature.error });
        return json(res, 200, await actionGateway.handle(parseBodyText(bodyText)));
      }

      if (req.method === "GET") return serveStatic(req, res, pathname);
      return json(res, 404, { ok: false, error: "not_found" });
    } catch (error) {
      return json(res, 500, { ok: false, error: "server_error", message: error instanceof Error ? error.message : String(error) });
    }
  });
  return { server, options: serverOptions };
}

export async function startConsoleServer(options = {}) {
  const created = createConsoleServer(options);
  await new Promise((resolve) => created.server.listen(created.options.port, created.options.host, resolve));
  return created;
}
