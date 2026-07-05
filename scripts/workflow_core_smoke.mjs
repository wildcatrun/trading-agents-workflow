#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canonicalWorkflowAction,
  runWorkflowAction,
  workflowPaths,
  workflowStatus
} from "../src/workflow.js";
import { runAction } from "../src/core.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "workflow-core-smoke-"));

const paths = workflowPaths(root, { workflowRootDir: root });
assert.equal(paths.root, root);
assert.equal(path.basename(paths.dbFile), "workflow_control_plane.db");

assert.equal(canonicalWorkflowAction("workflow.template.record-candidate"), "workflow.template.record_candidate");
assert.equal(typeof runWorkflowAction, "function");
assert.equal(typeof workflowStatus, "function");
assert.equal(typeof runAction, "function");

const directStatus = await workflowStatus(root, { workflowRootDir: root });
assert.equal(directStatus.schemaVersion >= 1, true);
assert.equal(directStatus.root, root);

const actionStatus = await runWorkflowAction(root, {
  action: "workflow.status",
  workflowRootDir: root
});
assert.equal(actionStatus.root, root);
assert.equal(actionStatus.dbFile, paths.dbFile);

const coreStatus = await runAction(root, {
  action: "workflow.status",
  workflowRootDir: root
});
assert.equal(coreStatus.root, root);

await fs.access(paths.dbFile);

console.log(JSON.stringify({
  ok: true,
  root,
  dbFile: paths.dbFile,
  checked: [
    "workflow exports load",
    "core runAction delegates workflow.status",
    "workflow.status initializes isolated SQLite root",
    "canonical action aliases resolve"
  ]
}, null, 2));
