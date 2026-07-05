import fs from "node:fs/promises";
import path from "node:path";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

export const RESEARCH_ACTION_HANDLER_NAMES = {
  "instrument.upsert": "instrumentUpsert",
  "tracking.instrument": "instrumentUpsert",
  "radar.update": "radarUpdate",
  "thesis.update": "thesisUpdate",
  "thesis.create": "thesisUpdate",
  "research.evidence": "researchEvidence",
  "research.memo": "researchMemo",
  "gate.review": "gateReview",
  "human_gate.review": "gateReview"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`research action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`research action dependency missing: ${name}`);
  return context[name];
}

export function createResearchActionRegistry(handlers = {}) {
  const entries = Object.entries(RESEARCH_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing research action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runResearchAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createResearchActionHandlers(context = {}) {
  const clampScore = requireContextFunction(context, "clampScore");
  const cleanFileSegment = requireContextFunction(context, "cleanFileSegment");
  const dailyKey = requireContextFunction(context, "dailyKey");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const nowIso = requireContextFunction(context, "nowIso");
  const relativeTo = requireContextFunction(context, "relativeTo");
  const renderThesisMarkdown = requireContextFunction(context, "renderThesisMarkdown");
  const safeId = requireContextFunction(context, "safeId");
  const toList = requireContextFunction(context, "toList");
  const upsertInstrumentRecord = requireContextFunction(context, "upsertInstrumentRecord");
  const GATE_STATUSES = requireContextValue(context, "GATE_STATUSES");
  const RADAR_ZONES = requireContextValue(context, "RADAR_ZONES");
  const THESIS_STATUSES = requireContextValue(context, "THESIS_STATUSES");

  async function instrumentUpsert(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const instrument = await upsertInstrumentRecord(paths, input);
    return { ...instrument, dbFile: paths.dbFile };
  }

  async function radarUpdate(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const instrument = await upsertInstrumentRecord(paths, input);
    const zone = RADAR_ZONES.has(String(input.radarZone || input.radar_zone || "unknown")) ? String(input.radarZone || input.radar_zone || "unknown") : "unknown";
    const score = {
      scoreId: input.scoreId || input.score_id || safeId("radar"),
      asOf: String(input.asOf || input.as_of || dailyKey()),
      retailHeatScore: clampScore(input.retailHeatScore ?? input.retail_heat_score),
      newsCatalystScore: clampScore(input.newsCatalystScore ?? input.news_catalyst_score),
      fundamentalScore: clampScore(input.fundamentalScore ?? input.fundamental_score),
      summary: String(input.summary || input.text || "").trim(),
      createdBy: String(input.createdBy || input.from || "cat_claw")
    };
    await sqlite(paths.dbFile, `
INSERT INTO radar_scores(score_id, instrument_id, as_of, radar_zone, retail_heat_score, news_catalyst_score, fundamental_score, sentiment_stage, source_reliability, catalyst_window, fundamental_trend, valuation_state, confidence, summary, evidence_paths_json, created_by, created_at)
VALUES (${sqlValue(score.scoreId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(score.asOf)}, ${sqlValue(zone)}, ${sqlValue(score.retailHeatScore)}, ${sqlValue(score.newsCatalystScore)}, ${sqlValue(score.fundamentalScore)}, ${sqlValue(input.sentimentStage || input.sentiment_stage || "")}, ${sqlValue(input.sourceReliability || input.source_reliability || "")}, ${sqlValue(input.catalystWindow || input.catalyst_window || "")}, ${sqlValue(input.fundamentalTrend || input.fundamental_trend || "")}, ${sqlValue(input.valuationState || input.valuation_state || "")}, ${sqlValue(input.confidence || "")}, ${sqlValue(score.summary)}, ${sqlValue(JSON.stringify(toList(input.evidencePaths || input.evidence_paths)))}, ${sqlValue(score.createdBy)}, ${sqlValue(nowIso())});
INSERT INTO tracking_states(instrument_id, research_state, radar_zone, retail_heat_score, news_catalyst_score, fundamental_score, sentiment_stage, fundamental_trend, valuation_state, last_review_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(input.researchState || input.research_state || "")}, ${sqlValue(zone)}, ${sqlValue(score.retailHeatScore)}, ${sqlValue(score.newsCatalystScore)}, ${sqlValue(score.fundamentalScore)}, ${sqlValue(input.sentimentStage || input.sentiment_stage || "")}, ${sqlValue(input.fundamentalTrend || input.fundamental_trend || "")}, ${sqlValue(input.valuationState || input.valuation_state || "")}, ${sqlValue(score.asOf)}, ${sqlValue(nowIso())})
ON CONFLICT(instrument_id) DO UPDATE SET
  research_state=COALESCE(NULLIF(excluded.research_state,''), tracking_states.research_state),
  radar_zone=excluded.radar_zone,
  retail_heat_score=excluded.retail_heat_score,
  news_catalyst_score=excluded.news_catalyst_score,
  fundamental_score=excluded.fundamental_score,
  sentiment_stage=excluded.sentiment_stage,
  fundamental_trend=excluded.fundamental_trend,
  valuation_state=excluded.valuation_state,
  last_review_at=excluded.last_review_at,
  updated_at=excluded.updated_at;`);
    return { ...score, instrumentId: instrument.instrumentId, assetType: instrument.assetType, symbol: instrument.symbol, radarZone: zone, dbFile: paths.dbFile };
  }

  async function thesisUpdate(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const instrument = await upsertInstrumentRecord(paths, input);
    const status = THESIS_STATUSES.has(String(input.status || "active")) ? String(input.status || "active") : "active";
    const ownerAgent = String(input.ownerAgent || input.owner_agent || "cat_ears");
    const title = String(input.title || `${instrument.symbol} thesis`).trim();
    const assetDir = path.join(paths.thesisDir, instrument.assetType);
    await fs.mkdir(assetDir, { recursive: true });
    const filePath = path.join(assetDir, `${cleanFileSegment(instrument.symbol)}.md`);
    const record = {
      thesisId: input.thesisId || input.thesis_id || instrument.instrumentId,
      instrumentId: instrument.instrumentId,
      assetType: instrument.assetType,
      symbol: instrument.symbol,
      title,
      status,
      ownerAgent,
      summary: String(input.summary || input.text || "").trim(),
      falsificationTriggers: String(input.falsificationTriggers || input.falsification_triggers || "").trim(),
      reviewDueAt: String(input.reviewDueAt || input.review_due_at || ""),
      updatedAt: nowIso()
    };
    const content = String(input.content || "").trim() || renderThesisMarkdown(record, input);
    await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    const relPath = relativeTo(paths.root, filePath);
    await sqlite(paths.dbFile, `
INSERT INTO thesis_index(thesis_id, instrument_id, status, title, path, summary, falsification_triggers, owner_agent, review_due_at, created_at, updated_at)
VALUES (${sqlValue(record.thesisId)}, ${sqlValue(record.instrumentId)}, ${sqlValue(status)}, ${sqlValue(title)}, ${sqlValue(relPath)}, ${sqlValue(record.summary)}, ${sqlValue(record.falsificationTriggers)}, ${sqlValue(ownerAgent)}, ${sqlValue(record.reviewDueAt)}, ${sqlValue(record.updatedAt)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(thesis_id) DO UPDATE SET
  status=excluded.status,
  title=excluded.title,
  path=excluded.path,
  summary=excluded.summary,
  falsification_triggers=excluded.falsification_triggers,
  owner_agent=excluded.owner_agent,
  review_due_at=excluded.review_due_at,
  updated_at=excluded.updated_at;
INSERT INTO tracking_states(instrument_id, thesis_status, thesis_path, updated_at)
VALUES (${sqlValue(record.instrumentId)}, ${sqlValue(status)}, ${sqlValue(relPath)}, ${sqlValue(record.updatedAt)})
ON CONFLICT(instrument_id) DO UPDATE SET thesis_status=excluded.thesis_status, thesis_path=excluded.thesis_path, updated_at=excluded.updated_at;`);
    return { ...record, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
  }

  async function researchEvidence(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const instrument = await upsertInstrumentRecord(paths, input);
    const evidenceId = input.evidenceId || input.evidence_id || safeId("evidence");
    const capturedAt = String(input.capturedAt || input.captured_at || nowIso());
    const assetDir = path.join(paths.evidenceDir, instrument.assetType, cleanFileSegment(instrument.symbol));
    await fs.mkdir(assetDir, { recursive: true });
    const filePath = path.join(assetDir, `${dailyKey(new Date(capturedAt))}-${cleanFileSegment(String(input.kind || "evidence"))}-${evidenceId.split(".").pop()}.md`);
    const content = String(input.content || `# Evidence ${evidenceId}

- instrument_id: ${instrument.instrumentId}
- kind: ${input.kind || "evidence"}
- source: ${input.source || ""}
- reliability: ${input.reliability || ""}
- captured_at: ${capturedAt}

## Summary

${String(input.summary || input.text || "").trim() || "待补充。"}

## Supports

${String(input.supports || "").trim() || "待补充。"}

## Conflicts

${String(input.conflicts || "").trim() || "待补充。"}
`).trim();
    await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    const relPath = relativeTo(paths.root, filePath);
    await sqlite(paths.dbFile, `
INSERT INTO evidence_items(evidence_id, instrument_id, kind, source, reliability, path, summary, supports, conflicts, captured_at, created_by, created_at)
VALUES (${sqlValue(evidenceId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.kind || "evidence")}, ${sqlValue(input.source || "")}, ${sqlValue(input.reliability || "")}, ${sqlValue(relPath)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.supports || "")}, ${sqlValue(input.conflicts || "")}, ${sqlValue(capturedAt)}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(nowIso())});
INSERT INTO tracking_states(instrument_id, last_evidence_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(capturedAt)}, ${sqlValue(nowIso())})
ON CONFLICT(instrument_id) DO UPDATE SET last_evidence_at=excluded.last_evidence_at, updated_at=excluded.updated_at;`);
    return { evidenceId, instrumentId: instrument.instrumentId, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
  }

  async function researchMemo(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const instrument = await upsertInstrumentRecord(paths, input);
    const memoId = input.memoId || input.memo_id || safeId("memo");
    const createdAt = nowIso();
    const assetDir = path.join(paths.memosDir, instrument.assetType, cleanFileSegment(instrument.symbol));
    await fs.mkdir(assetDir, { recursive: true });
    const filePath = path.join(assetDir, `${dailyKey()}-${cleanFileSegment(input.memoType || input.memo_type || "research-memo")}.md`);
    const content = String(input.content || `# ${input.title || `${instrument.symbol} Research Memo`}

- memo_id: ${memoId}
- instrument_id: ${instrument.instrumentId}
- memo_type: ${input.memoType || input.memo_type || "research_memo"}
- created_at: ${createdAt}

## Summary

${String(input.summary || input.text || "").trim() || "待补充。"}

## Conclusion

${String(input.conclusion || "").trim() || "待补充。"}
`).trim();
    await fs.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    const relPath = relativeTo(paths.root, filePath);
    await sqlite(paths.dbFile, `
INSERT INTO research_memos(memo_id, instrument_id, memo_type, path, title, summary, conclusion, created_by, created_at)
VALUES (${sqlValue(memoId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.memoType || input.memo_type || "research_memo")}, ${sqlValue(relPath)}, ${sqlValue(input.title || "")}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.conclusion || "")}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)});
INSERT INTO artifact_index(artifact_id, instrument_id, workflow_id, kind, path, summary, created_by, created_at)
VALUES (${sqlValue(memoId)}, ${sqlValue(instrument.instrumentId)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, 'research_memo', ${sqlValue(relPath)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)});
INSERT INTO tracking_states(instrument_id, last_memo_at, updated_at)
VALUES (${sqlValue(instrument.instrumentId)}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)})
ON CONFLICT(instrument_id) DO UPDATE SET last_memo_at=excluded.last_memo_at, updated_at=excluded.updated_at;`);
    return { memoId, instrumentId: instrument.instrumentId, path: filePath, relativePath: relPath, dbFile: paths.dbFile };
  }

  async function gateReview(rootDir, input) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    let instrument = null;
    if (input.symbol || input.instrumentId || input.instrument_id) instrument = await upsertInstrumentRecord(paths, input);
    const gateId = input.gateId || input.gate_id || safeId("gate");
    const status = GATE_STATUSES.has(String(input.status || "pending")) ? String(input.status || "pending") : "pending";
    const createdAt = nowIso();
    await sqlite(paths.dbFile, `
INSERT INTO review_gates(gate_id, instrument_id, workflow_id, gate_type, status, summary, reviewer_agent, human_gate_required, resume_pointer, expires_at, decision_at, approver, evidence_paths_json, created_by, created_at, updated_at)
VALUES (${sqlValue(gateId)}, ${sqlValue(instrument?.instrumentId || null)}, ${sqlValue(input.workflowId || input.workflow_id || "")}, ${sqlValue(input.gateType || input.gate_type || "review_gate")}, ${sqlValue(status)}, ${sqlValue(input.summary || input.text || "")}, ${sqlValue(input.reviewerAgent || input.reviewer_agent || "")}, ${sqlValue(Boolean(input.humanGateRequired ?? input.human_gate_required))}, ${sqlValue(input.resumePointer || input.resume_pointer || "")}, ${sqlValue(input.expiresAt || input.expires_at || "")}, ${sqlValue(["approved", "rejected", "waived"].includes(status) ? createdAt : "")}, ${sqlValue(input.approver || input.actor || "")}, ${sqlValue(JSON.stringify(toList(input.evidencePaths || input.evidence_paths)))}, ${sqlValue(input.createdBy || input.from || "cat_claw")}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
    return { gateId, status, instrumentId: instrument?.instrumentId || null, dbFile: paths.dbFile };
  }

  return {
    gateReview,
    instrumentUpsert,
    radarUpdate,
    researchEvidence,
    researchMemo,
    thesisUpdate
  };
}
