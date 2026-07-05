import { createHash, randomUUID } from "node:crypto";

export function boolOption(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(value);
}

export function safeId(prefix) {
  return `${prefix}.${Date.now().toString(36)}.${randomUUID().slice(0, 8)}`;
}

export function toList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

export function firstText(...values) {
  for (const value of values) {
    const list = Array.isArray(value) ? value : [value];
    for (const item of list) {
      const text = String(item ?? "").trim();
      if (text) return text;
    }
  }
  return "";
}

export function parseJsonValue(value, fallback = {}) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

export function jsonHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function textHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

const SENSITIVE_PERSISTENCE_KEY = /(^|[_-])(token|secret|password|credential|api[_-]?key|access[_-]?key|refresh[_-]?key|private[_-]?key|callback[_-]?data|callback[_-]?token)($|[_-])/i;

function isSensitivePersistenceKey(key) {
  const normalized = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return SENSITIVE_PERSISTENCE_KEY.test(normalized);
}

export function redactSensitiveTextForPersistence(value) {
  return String(value || "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/tawhg:[A-Za-z0-9._=-]+/g, "tawhg:<redacted>")
    .replace(/(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[redacted]")
    .replace(/\b(callback|token|secret|password|api[_-]?key|access[_-]?key|refresh)\s+([^\s,;]+)/gi, "$1 [redacted]");
}

export function redactSensitiveForPersistence(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    return redactSensitiveTextForPersistence(value);
  }
  if (typeof value !== "object") return value;
  if (depth > 8) return "[nested redacted]";
  if (Array.isArray(value)) return value.map((item) => redactSensitiveForPersistence(item, depth + 1));
  const redacted = {};
  for (const [key, item] of Object.entries(value)) {
    redacted[key] = isSensitivePersistenceKey(key) ? "[redacted]" : redactSensitiveForPersistence(item, depth + 1);
  }
  return redacted;
}
