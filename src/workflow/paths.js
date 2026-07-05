import * as fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { boolOption } from "./json.js";

export const LEGACY_WORKFLOW_ROOT = "/home/flashcat/.openclaw/shared/trading-agents-workflow";
export const WORKFLOW_CONTROL_PLANE_DB = "workflow_control_plane.db";
export const LEGACY_TRACKING_DB = "tracking.db";

const ALLOW_LEGACY_ROOT_ENV = "TRADING_AGENTS_WORKFLOW_ALLOW_LEGACY_ROOT";

export function resolveHome(value) {
  if (value && value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value ? path.resolve(value) : value;
}

export function resolveWorkflowRoot(rootDir, input = {}) {
  const inputRoot = input.workflowRootDir || input.workflow_root || input.workflowRoot || input.rootDir || input.root;
  if (rootDir && inputRoot) {
    const resolvedRootDir = resolveHome(String(rootDir));
    const resolvedInputRoot = resolveHome(String(inputRoot));
    if (resolvedRootDir !== resolvedInputRoot) {
      throw new Error(`workflow root mismatch: rootDir=${resolvedRootDir} input.workflowRootDir=${resolvedInputRoot}; pass one active workflow root only`);
    }
  }
  const candidate = inputRoot || rootDir || process.env.TRADING_AGENTS_WORKFLOW_ROOT || process.env.CAT_MEETING_GOVERNANCE_ROOT;
  if (!candidate) {
    throw new Error(`trading-agents-workflow root is required; pass --root or set TRADING_AGENTS_WORKFLOW_ROOT. Legacy root ${LEGACY_WORKFLOW_ROOT} has retired and is fail-closed.`);
  }
  const root = resolveHome(String(candidate));
  const legacyRoot = path.resolve(LEGACY_WORKFLOW_ROOT);
  if (root === legacyRoot && !boolOption(process.env[ALLOW_LEGACY_ROOT_ENV], false)) {
    throw new Error(`legacy trading-agents-workflow root has retired and is fail-closed: ${LEGACY_WORKFLOW_ROOT}; pass --root or set TRADING_AGENTS_WORKFLOW_ROOT to an active state root. To temporarily allow it, set ${ALLOW_LEGACY_ROOT_ENV}=1.`);
  }
  return root;
}

export function workflowPaths(rootDir, input = {}) {
  const root = resolveWorkflowRoot(rootDir, input);
  const dbFile = resolveWorkflowDbFile(root);
  return {
    root,
    dbFile,
    primaryDbFile: path.join(root, WORKFLOW_CONTROL_PLANE_DB),
    legacyDbFile: path.join(root, LEGACY_TRACKING_DB),
    researchDir: path.join(root, "research"),
    thesisDir: path.join(root, "thesis"),
    radarDir: path.join(root, "radar"),
    evidenceDir: path.join(root, "evidence"),
    memosDir: path.join(root, "memos"),
    gatesDir: path.join(root, "gates"),
    artifactsDir: path.join(root, "artifacts"),
    checkpointsDir: path.join(root, "workflows", "checkpoints"),
    protocolDir: path.join(root, "protocol"),
    intentsDir: path.join(root, "intents"),
    receiptsDir: path.join(root, "receipts"),
    bridgeDir: path.join(root, "bridge"),
    dispatchesDir: path.join(root, "bridge", "dispatches"),
    messagesDir: path.join(root, "bridge", "messages"),
    telegramDir: path.join(root, "bridge", "telegram"),
    humanGateDir: path.join(root, "bridge", "human_gates"),
    humanGateInboxDir: path.join(root, "human-gates", "inbox"),
    workflowsDir: path.join(root, "workflows"),
    templatesDir: path.join(root, "templates"),
    exportsDir: path.join(root, "exports"),
    registryDir: path.join(root, "registry"),
    indexDir: path.join(root, "index")
  };
}

export function fileExistsSync(filePath) {
  try {
    return fsSync.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveWorkflowDbFile(root) {
  const primary = path.join(root, WORKFLOW_CONTROL_PLANE_DB);
  const legacy = path.join(root, LEGACY_TRACKING_DB);
  if (fileExistsSync(primary)) return primary;
  if (fileExistsSync(legacy)) return legacy;
  return primary;
}
