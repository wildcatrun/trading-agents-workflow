import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function sqlite(dbFile, sql, { json = false } = {}) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  const args = json ? ["-cmd", ".timeout 5000", "-json", dbFile, sql] : ["-cmd", ".timeout 5000", dbFile, sql];
  try {
    const { stdout } = await execFileAsync("sqlite3", args, { maxBuffer: 10 * 1024 * 1024 });
    if (!json) return stdout;
    const text = stdout.trim();
    return text ? JSON.parse(text) : [];
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("sqlite3 CLI is required for trading-agents-workflow v0.6");
    }
    throw error;
  }
}

export async function sqliteTransaction(dbFile, sql) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  const transactionSql = `BEGIN IMMEDIATE;\n${String(sql || "").trim().replace(/;+\s*$/, "")};\nCOMMIT;`;
  const args = ["-cmd", ".timeout 5000", "-cmd", ".bail on", dbFile, transactionSql];
  try {
    const { stdout } = await execFileAsync("sqlite3", args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("sqlite3 CLI is required for trading-agents-workflow v0.6");
    }
    throw error;
  }
}

export async function sqliteChangeCount(dbFile, sql) {
  const rows = await sqlite(dbFile, `${String(sql || "").trim().replace(/;+\s*$/, "")};
SELECT changes() AS changes;`, { json: true });
  return Number(rows[0]?.changes || 0);
}

export function isSqliteConstraintError(error) {
  const text = `${error?.message || ""}\n${error?.stderr || ""}`.toLowerCase();
  return text.includes("constraint failed") || text.includes("unique constraint failed");
}

export async function tableColumns(dbFile, tableName) {
  const rows = await sqlite(dbFile, `PRAGMA table_info(${tableName});`, { json: true });
  return new Set(rows.map((row) => row.name));
}

export async function ensureColumns(dbFile, tableName, columns) {
  const existing = await tableColumns(dbFile, tableName);
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      await sqlite(dbFile, `ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition};`);
    }
  }
}
