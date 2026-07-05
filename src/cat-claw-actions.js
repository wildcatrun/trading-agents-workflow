import fs from "node:fs/promises";
import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const CAT_CLAW_ACTION_HANDLER_NAMES = {
  "cat_claw.audit": "cat_clawAudit"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`cat_claw action dependency missing: ${name}`);
  return value;
}

export function createCatClawActionRegistry(handlers = {}) {
  const entries = Object.entries(CAT_CLAW_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing cat_claw action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runCatClawAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createCatClawActionHandlers(context = {}) {
  const dailyKey = requireContextFunction(context, "dailyKey");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");

  async function cat_clawAudit(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const staleDays = Number(input.staleDays || input.stale_days || 30);
    const cutoff = new Date(Date.now() - staleDays * 86400000).toISOString();
    const staleThesis = await sqlite(paths.dbFile, `
SELECT i.instrument_id, i.asset_type, i.symbol, t.thesis_status, t.thesis_path, t.updated_at
FROM instruments i
LEFT JOIN tracking_states t ON t.instrument_id=i.instrument_id
WHERE t.thesis_path IS NULL OR t.updated_at < ${sqlValue(cutoff)}
ORDER BY i.instrument_id;`, { json: true });
    const missingThreeFace = await sqlite(paths.dbFile, `
SELECT i.instrument_id, i.asset_type, i.symbol, t.radar_zone, t.retail_heat_score, t.news_catalyst_score, t.fundamental_score
FROM instruments i
LEFT JOIN tracking_states t ON t.instrument_id=i.instrument_id
WHERE t.radar_zone IN ('bright','dark','overheated')
  AND (t.retail_heat_score IS NULL OR t.news_catalyst_score IS NULL OR t.fundamental_score IS NULL)
ORDER BY i.instrument_id;`, { json: true });
    const pendingGates = await sqlite(paths.dbFile, `
SELECT gate_id, instrument_id, gate_type, status, summary, human_gate_required, created_at
FROM review_gates
WHERE status='pending' OR human_gate_required=1
ORDER BY created_at DESC;`, { json: true });
    const filePath = path.join(paths.indexDir, `cat_claw-audit-${dailyKey()}.md`);
    const content = `# Cat Claw Workflow Audit ${dailyKey()}

## Stale Thesis

${staleThesis.length ? staleThesis.map((row) => `- ${row.instrument_id} updated_at=${row.updated_at || "none"}`).join("\n") : "- none"}

## Missing Three-Face Inputs

${missingThreeFace.length ? missingThreeFace.map((row) => `- ${row.instrument_id} zone=${row.radar_zone} retail=${row.retail_heat_score} news=${row.news_catalyst_score} fundamental=${row.fundamental_score}`).join("\n") : "- none"}

## Pending Gates

${pendingGates.length ? pendingGates.map((row) => `- ${row.gate_id} ${row.instrument_id || ""} ${row.gate_type} status=${row.status} human_gate=${row.human_gate_required}`).join("\n") : "- none"}
`;
    await fs.writeFile(filePath, content, "utf8");
    return { auditFile: filePath, staleThesisCount: staleThesis.length, missingThreeFaceCount: missingThreeFace.length, pendingGateCount: pendingGates.length };
  }

  return {
    cat_clawAudit
  };
}
