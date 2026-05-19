import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function sqlite(dbFile, sql, { json = true } = {}) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  const args = json ? ["-cmd", ".timeout 5000", "-json", dbFile, sql] : ["-cmd", ".timeout 5000", dbFile, sql];
  try {
    const { stdout } = await execFileAsync("sqlite3", args, { maxBuffer: 20 * 1024 * 1024 });
    if (!json) return stdout;
    const text = stdout.trim();
    return text ? JSON.parse(text) : [];
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("sqlite3 CLI is required for workflow console read model");
    }
    throw error;
  }
}

export async function dbReadable(dbFile) {
  try {
    await fs.access(dbFile);
    await sqlite(dbFile, "SELECT 1 AS ok;", { json: true });
    return true;
  } catch {
    return false;
  }
}

export function parseJson(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export function redact(value) {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/callback|token|secret|password|api[_-]?key|access[_-]?key|refresh|bot[_-]?token/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redact(item);
    }
  }
  return result;
}

export function toInt(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}
