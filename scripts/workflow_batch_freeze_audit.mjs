#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  WORKFLOW_ACTION_PERMISSION_RULES,
  workflowActionMigrationInfo
} from "../src/workflow/action-policy.js";
import { WORKFLOW_ACTION_ALIASES } from "../src/workflow/action-aliases.js";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const FREEZE_CANDIDATES = [
  {
    batch: "A",
    family: "workflow.run.*",
    actions: ["workflow.run.upsert", "workflow.initiative.upsert"],
    currentStatus: "removed_external_surface",
    freezeAction: "already_removed; keep unknown-action guard",
    v2Replacement: "workflow.v2.plan.create",
    v2DependencyPolicy: "must_not_depend"
  },
  {
    batch: "A",
    family: "workflow.task.create/update",
    actions: ["workflow.task.create", "workflow.task.update"],
    currentStatus: "removed_external_surface",
    freezeAction: "already_removed; keep private helper compatibility only",
    v2Replacement: "workflow.v2 plan nodes + worker result/review state",
    v2DependencyPolicy: "must_not_depend"
  },
  {
    batch: "A",
    family: "workflow.task.launch mutations",
    actions: [
      "workflow.task.launch.prepare",
      "workflow.task.launch.review",
      "workflow.task.launch.approve",
      "workflow.task.launch.draft",
      "workflow.task.launch.submit",
      "workflow.task.launch.brain_review"
    ],
    currentStatus: "removed",
    freezeAction: "already_removed; keep list as historical read only",
    v2Replacement: "workflow.v2 plan admission + Human Gate package/request",
    v2DependencyPolicy: "must_not_depend"
  },
  {
    batch: "A",
    family: "workflow.swarm.*",
    actions: ["workflow.swarm", "workflow.swarm.plan"],
    currentStatus: "removed",
    freezeAction: "already_removed; keep unknown-action guard",
    v2Replacement: "workflow.v2 manager/worker/task-group model",
    v2DependencyPolicy: "must_not_depend"
  },
  {
    batch: "B",
    family: "legacy read/history shells",
    actions: ["workflow.task.draft", "workflow.task.list", "workflow.tasks", "workflow.task.launch.list"],
    currentStatus: "compat_shell_only",
    freezeAction: "hide from default mutation path; preserve explicit diagnostics/history",
    v2Replacement: "workflow.v2.plan.preview/create and v2 read models",
    v2DependencyPolicy: "must_not_depend"
  },
  {
    batch: "B",
    family: "legacy supervisor previews",
    actions: ["workflow.advance.preview", "workflow.supervise.preview"],
    currentStatus: "compat_shell_only",
    freezeAction: "compatibility diagnostic only; no new v2 planning callers",
    v2Replacement: "workflow.supervisor.readiness.preview + workflow.supervisor.next_actions.preview",
    v2DependencyPolicy: "must_not_depend",
    allowedPlanningRefs: {
      "workflow.advance.preview": [
        "static/console/app.js",
        "static/console/preview-actions.js"
      ],
      "workflow.supervise.preview": [
        "src/console/read-model.js",
        "static/console/app.js",
        "static/console/preview-actions.js"
      ]
    }
  },
  {
    batch: "C",
    family: "legacy mutating progression",
    actions: ["workflow.advance", "workflow.supervise"],
    currentStatus: "legacy_active",
    freezeAction: "do_not_freeze_until_mutating_parity_or_explicit_retirement",
    v2Replacement: "semantic supervisor readiness/next-actions plus executor parity",
    v2DependencyPolicy: "allowed_until_replaced"
  },
  {
    batch: "C",
    family: "workflow lifecycle mutations",
    actions: ["workflow.checkpoint", "workflow.pause", "workflow.resume", "workflow.stop", "workflow.evaluate"],
    currentStatus: "legacy_active",
    freezeAction: "do_not_freeze_until v2 lifecycle/checkpoint parity",
    v2Replacement: "v2 plan/node/worker lifecycle and recovery model",
    v2DependencyPolicy: "allowed_until_replaced"
  },
  {
    batch: "C",
    family: "schedules and control-loop",
    actions: [
      "workflow.schedule.upsert",
      "workflow.schedule.list",
      "workflow.schedule.pause",
      "workflow.schedule.resume",
      "workflow.schedule.disable",
      "workflow.control_loop.tick",
      "workflow.control_loop.job.requeue",
      "runtime.bridge.drain"
    ],
    currentStatus: "legacy_active/shared maintenance",
    freezeAction: "do_not_freeze; separate v1 orchestration from shared maintenance first",
    v2Replacement: "approved v2/template scheduler + v2 adapter runner service",
    v2DependencyPolicy: "allowed_until_service_cutover"
  },
  {
    batch: "C",
    family: "meeting/runtime adapter surfaces",
    actions: ["meeting.dispatch", "meeting.ingest", "meeting.resume", "meeting.disperse", "meeting.runtime_participant"],
    currentStatus: "legacy_active/shared adapter",
    freezeAction: "do_not_freeze_without adapter parity audit",
    v2Replacement: "shared runtime adapter or v2 package bridge",
    v2DependencyPolicy: "allowed_until_replaced"
  },
  {
    batch: "F",
    family: "route_shell source-frozen",
    actions: ["route_shell.ingest", "route-shell.ingest", "route_shell.route"],
    currentStatus: "source_frozen",
    freezeAction: "external_entrypoints_closed; keep implementation file only until deletion batch",
    v2Replacement: "message_flow/runtime adapter evidence; no v2 migration",
    v2DependencyPolicy: "must_not_depend"
  },
  {
    batch: "D",
    family: "shared runtime registry/readiness substrate",
    actions: [
      "workflow.status",
      "workflow.health",
      "workflow.readiness",
      "workflow.topology",
      "workflow.runtime_agents",
      "runtime.agent.upsert"
    ],
    currentStatus: "shared_substrate",
    freezeAction: "forbidden_to_freeze_as_v1",
    v2Replacement: "shared cross-version runtime/readiness substrate",
    v2DependencyPolicy: "expected_shared_dependency"
  },
  {
    batch: "D",
    family: "shared message and delivery substrate",
    actions: [
      "message_flow.send",
      "message_flow.list",
      "message_flow.reconcile",
      "telegram.outbox.delivery",
      "telegram.outbox.requeue.preview",
      "telegram.outbox.requeue.execution_package.preview"
    ],
    currentStatus: "shared_substrate",
    freezeAction: "forbidden_to_freeze_as_v1",
    v2Replacement: "shared delivery/evidence substrate",
    v2DependencyPolicy: "expected_shared_dependency"
  },
  {
    batch: "D",
    family: "shared Human Gate and protocol substrate",
    actions: [
      "human_gate.request",
      "human_gate.web_app_review",
      "human_gate.web_app_submit",
      "human_gate.button_callback",
      "human_gate.feedback",
      "human_gate.resume",
      "human_gate.inbox",
      "human_gate.record",
      "protocol.record"
    ],
    currentStatus: "shared_substrate",
    freezeAction: "forbidden_to_freeze_as_v1",
    v2Replacement: "shared Human Gate/protocol substrate",
    v2DependencyPolicy: "expected_shared_dependency"
  },
  {
    batch: "D",
    family: "shared safety, incident and trading substrate",
    actions: [
      "incident.state",
      "workflow.incident.from_dead_letter",
      "workflow.incident.closeout.evidence",
      "workflow.incident.closeout.artifact",
      "workflow.incident.closeout.human_gate_request",
      "side_effect.record",
      "trade.proposal",
      "risk.decision",
      "trade.intent",
      "trading_core.receipt"
    ],
    currentStatus: "shared_substrate",
    freezeAction: "forbidden_to_freeze_as_v1",
    v2Replacement: "shared safety/trading substrate",
    v2DependencyPolicy: "expected_shared_dependency"
  },
  {
    batch: "D",
    family: "shared audit and session substrate",
    actions: [
      "workflow.event.append",
      "workflow.event.list",
      "workflow.runtime_event.record",
      "workflow.runtime_event.list",
      "workflow.session_pack.upsert",
      "workflow.session_pack.get",
      "workflow.session_pack.list",
      "workflow.session_run.start",
      "workflow.session_run.complete"
    ],
    currentStatus: "shared_substrate",
    freezeAction: "forbidden_to_freeze_as_v1",
    v2Replacement: "shared audit/session substrate",
    v2DependencyPolicy: "expected_shared_dependency"
  }
];

const SKIP_DIRS = new Set([".git", "node_modules", ".tmp-smoke", "backups"]);
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".py", ".json"]);
const CORE_SOURCE_ROOTS = new Set(["src", "bin", "scripts"]);
const PUBLIC_SURFACE_FILES = new Set([
  "index.js",
  "openclaw.plugin.json",
  "bin/cat-meeting-governance.mjs",
  "scripts/trading_agents_workflow_mcp.py",
  "scripts/trading_agents_workflow_hermes_mcp.py"
]);
const V2_PLANNING_ROOTS = [
  `src${path.sep}workflow-v2${path.sep}`,
  `src${path.sep}console${path.sep}`,
  `static${path.sep}console${path.sep}`
];

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === "index.js" || SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function rel(file) {
  return path.relative(repoRoot, file);
}

function isCoreSource(file) {
  const relative = rel(file);
  const parts = relative.split(path.sep);
  return PUBLIC_SURFACE_FILES.has(relative) || CORE_SOURCE_ROOTS.has(parts[0]) || relative.startsWith(`static${path.sep}console${path.sep}`);
}

function isV2PlanningSurface(file) {
  const relative = rel(file);
  return V2_PLANNING_ROOTS.some((prefix) => relative.startsWith(prefix));
}

function isPublicSurface(file) {
  return PUBLIC_SURFACE_FILES.has(rel(file));
}

function exactStringPattern(token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("([\"'`])" + escaped + "\\1", "g");
}

async function exactStringOccurrences(files, token) {
  const hits = [];
  const pattern = exactStringPattern(token);
  for (const file of files) {
    const text = await fs.readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    const lineNumbers = [];
    for (let index = 0; index < lines.length; index += 1) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[index])) lineNumbers.push(index + 1);
    }
    if (lineNumbers.length > 0) hits.push({ file: rel(file), lines: lineNumbers, count: lineNumbers.length });
  }
  return hits;
}

async function collectRegistryActions(coreFiles) {
  const registryActions = new Set();
  const registrySources = {};
  for (const file of coreFiles) {
    const relative = rel(file);
    if (!(relative.startsWith("src/") && (relative.endsWith("-actions.js") || relative === "src/workflow-v2/index.js"))) continue;
    const mod = await import(pathToFileURL(file).href);
    for (const [exportName, value] of Object.entries(mod)) {
      if (!exportName.endsWith("ACTION_HANDLER_NAMES") || !value || typeof value !== "object") continue;
      for (const action of Object.keys(value)) {
        registryActions.add(action);
        registrySources[action] = registrySources[action] || [];
        registrySources[action].push(`${relative}:${exportName}`);
      }
    }
  }
  return { registryActions, registrySources };
}

function auditPolicy(candidate, registryActions, registrySources) {
  const failures = [];
  const actionPolicy = [];
  for (const action of candidate.actions) {
    const migration = workflowActionMigrationInfo(action);
    const permission = WORKFLOW_ACTION_PERMISSION_RULES[action] || null;
    const aliasTarget = WORKFLOW_ACTION_ALIASES[action] || null;
    const aliasSources = Object.entries(WORKFLOW_ACTION_ALIASES)
      .filter(([, target]) => target === action)
      .map(([source]) => source);
    const registered = registryActions.has(action);
    actionPolicy.push({
      action,
      registered,
      registrySources: registrySources[action] || [],
      migrationStatus: migration?.migrationStatus || "",
      decisionClass: migration?.decisionClass || "",
      permissionRisk: permission?.risk || "",
      mutating: permission?.mutating ?? null,
      aliasTarget,
      aliasSources
    });

    if (candidate.currentStatus === "removed" || candidate.currentStatus === "removed_external_surface" || candidate.currentStatus === "source_frozen") {
      if (registered) failures.push(`${action}: removed action still has an action handler registry entry`);
      if (migration) failures.push(`${action}: removed action still has migration metadata`);
      if (permission) failures.push(`${action}: removed action still has permission rule`);
      if (aliasTarget) failures.push(`${action}: removed action still has alias target ${aliasTarget}`);
      if (aliasSources.length > 0) failures.push(`${action}: removed action still has alias sources ${aliasSources.join(",")}`);
      continue;
    }

    if (candidate.currentStatus === "compat_shell_only" || candidate.currentStatus.startsWith("legacy_active") || candidate.currentStatus.includes("deprecated") || candidate.currentStatus === "shared_substrate") {
      if (!registered && !aliasTarget) failures.push(`${action}: active/shared/compat action is not registered and is not an alias`);
    }

    if (candidate.freezeAction === "forbidden_to_freeze_as_v1") {
      if (candidate.currentStatus !== "shared_substrate") failures.push(`${action}: forbidden batch entry must remain shared_substrate`);
      if (!registered && !aliasTarget) failures.push(`${action}: shared substrate registry entry missing`);
    }
  }
  return { actionPolicy, failures };
}

function allowedPlanningFiles(candidate, action) {
  return new Set(candidate.allowedPlanningRefs?.[action] || []);
}

function summarizeOccurrences(occurrences) {
  return occurrences.map((hit) => `${hit.file}:${hit.lines.join(",")}`);
}

async function auditStaticConsoleLegacyPriority() {
  const failures = [];
  const appFile = path.join(repoRoot, "static", "console", "app.js");
  const app = await fs.readFile(appFile, "utf8");
  const priorityBlock = app.match(/const PREVIEW_ACTION_PRIORITY = \[[\s\S]*?\];/)?.[0] || "";
  for (const action of ["workflow.advance.preview", "workflow.supervise.preview"]) {
    if (exactStringPattern(action).test(priorityBlock)) {
      failures.push(`${action}: legacy diagnostic preview must not be in PREVIEW_ACTION_PRIORITY`);
    }
  }
  if (!app.includes("const LEGACY_DIAGNOSTIC_PREVIEW_ACTIONS = new Set([")) {
    failures.push("static console is missing LEGACY_DIAGNOSTIC_PREVIEW_ACTIONS guard");
  }
  return failures;
}

async function main() {
  const allFiles = await collectFiles(repoRoot);
  const coreFiles = allFiles.filter(isCoreSource);
  const publicFiles = coreFiles.filter(isPublicSurface);
  const v2PlanningFiles = coreFiles.filter(isV2PlanningSurface);
  const { registryActions, registrySources } = await collectRegistryActions(coreFiles);
  const results = [];
  const failures = await auditStaticConsoleLegacyPriority();

  for (const candidate of FREEZE_CANDIDATES) {
    const policy = auditPolicy(candidate, registryActions, registrySources);
    const sourceRefs = {};
    const publicRefs = {};
    const v2PlanningRefs = {};
    for (const action of candidate.actions) {
      sourceRefs[action] = await exactStringOccurrences(coreFiles, action);
      publicRefs[action] = await exactStringOccurrences(publicFiles, action);
      v2PlanningRefs[action] = await exactStringOccurrences(v2PlanningFiles, action);

      if ((candidate.currentStatus === "removed" || candidate.currentStatus === "removed_external_surface" || candidate.currentStatus === "source_frozen") && publicRefs[action].length > 0) {
        policy.failures.push(`${action}: removed action reappeared in public surface ${summarizeOccurrences(publicRefs[action]).join("; ")}`);
      }

      if (candidate.v2DependencyPolicy === "must_not_depend") {
        const allowed = allowedPlanningFiles(candidate, action);
        const unapprovedPlanningRefs = v2PlanningRefs[action].filter((hit) => !allowed.has(hit.file));
        if (unapprovedPlanningRefs.length > 0) {
          policy.failures.push(`${action}: v2/planning surface dependency found in ${summarizeOccurrences(unapprovedPlanningRefs).join("; ")}`);
        }
      }
    }
    if (policy.failures.length > 0) failures.push(...policy.failures.map((failure) => `${candidate.family}: ${failure}`));
    results.push({
      batch: candidate.batch,
      family: candidate.family,
      currentStatus: candidate.currentStatus,
      freezeAction: candidate.freezeAction,
      v2Replacement: candidate.v2Replacement,
      v2DependencyPolicy: candidate.v2DependencyPolicy,
      actionPolicy: policy.actionPolicy,
      sourceRefs,
      publicRefs,
      v2PlanningRefs,
      failures: policy.failures
    });
  }

  const payload = {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    repoRoot,
    registryActionCount: registryActions.size,
    checkedCandidates: results.length,
    failures,
    results
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const row of results) {
      console.log(`[${row.batch}] ${row.family}: ${row.failures.length === 0 ? "ok" : "fail"}`);
      if (row.failures.length > 0) {
        for (const failure of row.failures) console.log(`  - ${failure}`);
      }
    }
    console.log(`freeze_audit=${payload.ok ? "ok" : "failed"} candidates=${payload.checkedCandidates} registry_actions=${payload.registryActionCount}`);
  }

  if (!payload.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
