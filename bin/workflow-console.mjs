#!/usr/bin/env node
import { startConsoleServer } from "../src/console/server.js";

function parseArgv(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true";
    options[key] = value;
  }
  return options;
}

const args = parseArgv(process.argv.slice(2));
if (args.help || args.h) {
  console.log(`Usage:
  workflow-console [--root DIR] [--host HOST] [--port PORT] [--token TOKEN] [--allow-writes true|false]`);
  process.exit(0);
}

const { options } = await startConsoleServer({
  rootDir: args.root,
  host: args.host,
  port: args.port,
  token: args.token,
  allowWrites: args["allow-writes"] === "true",
  readOnly: args["read-only"] === "false" ? false : undefined
});

console.log(`workflow-console listening on http://${options.host}:${options.port}`);
console.log(`rootDir=${options.rootDir}`);
console.log(`mode=${options.readOnly ? "read-only/preview-only" : "allowlisted-actions"}`);
