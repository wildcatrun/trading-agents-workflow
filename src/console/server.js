import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workflowPaths } from "../workflow.js";
import { WorkflowActionGateway } from "./action-gateway.js";
import { WorkflowReadModel } from "./read-model.js";

const CONSOLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "static", "console");
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
  return ["localhost", "127.0.0.1", "::1", "0:0:0:0:0:0:0:1"].includes(host);
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

function json(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
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
  if (child === "timeline") return await readModel.timeline(workflowId, query);
  return undefined;
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
  const readModel = new WorkflowReadModel(paths);
  const actionGateway = new WorkflowActionGateway(paths, { readOnly, allowWrites: options.allowWrites });
  const serverOptions = {
    host: options.host || process.env.WORKFLOW_CONSOLE_HOST || "127.0.0.1",
    port: Number(options.port || process.env.WORKFLOW_CONSOLE_PORT || 8791),
    token: options.token || process.env.WORKFLOW_CONSOLE_TOKEN || "",
    allowedHosts: new Set(String(options.allowedHosts || process.env.WORKFLOW_CONSOLE_ALLOWED_HOSTS || "").split(",").map((item) => splitHost(item)).filter(Boolean)),
    readOnly,
    rootDir: paths.root
  };

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
        return json(res, 200, {
          service: "workflow-console",
          rootDir: paths.root,
          readOnlyMode: readOnly,
          actionMode: readOnly ? "preview-only" : "allowlisted",
          serverTime: new Date().toISOString(),
          allowedViews: ["active", "waiting_human", "blocked", "paused", "updated_24h"],
          redactionPolicyVersion: "workflow_console_redaction_v1"
        });
      }
      if (req.method === "GET" && pathname === "/api/workflows") {
        return json(res, 200, await readModel.workflowList(Object.fromEntries(url.searchParams)));
      }
      if (req.method === "GET" && pathname === "/api/task-launches") {
        return json(res, 200, await readModel.taskLaunches(Object.fromEntries(url.searchParams)));
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
      if (req.method === "POST" && pathname === "/api/actions") return json(res, 200, await actionGateway.handle(await readBody(req)));

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
