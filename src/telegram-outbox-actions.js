import { execFile } from "node:child_process";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";
import {
  boolOption,
  firstText,
  parseJsonValue,
  redactSensitiveForPersistence,
  redactSensitiveTextForPersistence,
  safeId
} from "./workflow/json.js";
import {
  sqlValue,
  sqlite
} from "./workflow/sqlite.js";

const execFileAsync = promisify(execFile);

export const TELEGRAM_OUTBOX_ACTION_HANDLER_NAMES = {
  "telegram.outbox.delivery.preview": "telegramOutboxDeliveryPreview",
  "telegram.outbox.preview_delivery": "telegramOutboxDeliveryPreview",
  "telegram.outbox.delivery-preview": "telegramOutboxDeliveryPreview",
  "workflow.telegram.outbox.delivery.preview": "telegramOutboxDeliveryPreview",
  "telegram.outbox.requeue.preview": "telegramOutboxRequeuePreview",
  "telegram.outbox.preview_requeue": "telegramOutboxRequeuePreview",
  "telegram.outbox.requeue-preview": "telegramOutboxRequeuePreview",
  "telegram.outbox.resend.preview": "telegramOutboxRequeuePreview",
  "telegram.outbox.redelivery.preview": "telegramOutboxRequeuePreview",
  "workflow.telegram.outbox.requeue.preview": "telegramOutboxRequeuePreview",
  "telegram.outbox.requeue.execution_package.preview": "telegramOutboxRequeueExecutionPackagePreview",
  "telegram.outbox.requeue.package.preview": "telegramOutboxRequeueExecutionPackagePreview",
  "telegram.outbox.requeue.execution-package.preview": "telegramOutboxRequeueExecutionPackagePreview",
  "telegram.outbox.resend.package.preview": "telegramOutboxRequeueExecutionPackagePreview",
  "telegram.outbox.redelivery.package.preview": "telegramOutboxRequeueExecutionPackagePreview",
  "workflow.telegram.outbox.requeue.package.preview": "telegramOutboxRequeueExecutionPackagePreview",
  "telegram.outbox.delivery": "telegramOutboxDelivery",
  "telegram.outbox.deliver": "telegramOutboxDelivery",
  "telegram.outbox.delivery.execute": "telegramOutboxDelivery",
  "workflow.telegram.outbox.delivery": "telegramOutboxDelivery",
  "telegram.outbox": "telegramOutbox"
};

function requireContextFunction(context, name) {
  const value = context?.[name];
  if (typeof value !== "function") throw new Error(`telegram.outbox action dependency missing: ${name}`);
  return value;
}

function requireContextValue(context, name) {
  if (!(name in (context || {}))) throw new Error(`telegram.outbox action dependency missing: ${name}`);
  return context[name];
}

function telegramChunks(text, limit = 3500) {
  const value = String(text || "").trim();
  if (value.length <= limit) return [value];
  const chunks = [];
  let remaining = value;
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < Math.floor(limit * 0.5)) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.map((chunk, index) => chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n${chunk}` : chunk);
}

function normalizeTelegramBotApiChatId(value = "") {
  return String(value || "").trim().replace(/^telegram:/, "");
}

function noProxyList() {
  return String(process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function noProxyMatches(hostname = "", port = "") {
  const host = String(hostname || "").toLowerCase();
  const hostPort = `${host}:${String(port || "").trim()}`;
  for (const entryRaw of noProxyList()) {
    const entry = entryRaw.toLowerCase();
    if (entry === "*") return true;
    if (entry.includes(":") && entry === hostPort) return true;
    const domain = entry.replace(/^\./, "");
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function proxyUrlForHttpsTarget(targetUrl) {
  const url = targetUrl instanceof URL ? targetUrl : new URL(String(targetUrl || ""));
  if (noProxyMatches(url.hostname, url.port || "443")) return "";
  return firstText(
    process.env.HTTPS_PROXY,
    process.env.https_proxy,
    process.env.HTTP_PROXY,
    process.env.http_proxy,
    process.env.ALL_PROXY,
    process.env.all_proxy
  );
}

function proxyAuthorizationHeader(proxyUrl) {
  if (!proxyUrl.username) return "";
  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password || "");
  return `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n`;
}

function connectTlsViaHttpProxy(proxyRawUrl, target, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let proxyUrl;
    try {
      proxyUrl = new URL(proxyRawUrl);
    } catch (error) {
      reject(error);
      return;
    }
    if (!["http:", "https:"].includes(proxyUrl.protocol)) {
      reject(new Error(`unsupported proxy protocol for telegram bot api: ${proxyUrl.protocol}`));
      return;
    }

    const proxyPort = Number(proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80));
    const targetHost = String(target.hostname || target.host || "").trim();
    const targetPort = Number(target.port || 443);
    const connectOptions = { host: proxyUrl.hostname, port: proxyPort };
    const rawSocket = proxyUrl.protocol === "https:"
      ? tls.connect({ ...connectOptions, servername: proxyUrl.hostname })
      : net.connect(connectOptions);
    let settled = false;
    let buffered = Buffer.alloc(0);

    const cleanup = () => {
      rawSocket.removeListener("data", onData);
      rawSocket.removeListener("error", onError);
      rawSocket.removeListener("timeout", onTimeout);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      rawSocket.destroy();
      reject(error);
    };
    const onError = (error) => fail(error);
    const onTimeout = () => fail(new Error("telegram bot api proxy connect timeout"));
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const headerEnd = buffered.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffered.slice(0, headerEnd).toString("latin1");
      if (!/^HTTP\/1\.[01] 2\d\d\b/.test(header)) {
        fail(new Error(`telegram bot api proxy connect failed: ${header.split("\r\n")[0] || "unknown response"}`));
        return;
      }
      cleanup();
      const secureSocket = tls.connect({
        socket: rawSocket,
        servername: target.servername || targetHost,
        ALPNProtocols: ["http/1.1"]
      }, () => {
        if (settled) return;
        settled = true;
        secureSocket.setTimeout(0);
        resolve(secureSocket);
      });
      secureSocket.once("error", fail);
      secureSocket.setTimeout(timeoutMs, () => fail(new Error("telegram bot api tls handshake timeout")));
    };
    const sendConnect = () => {
      const auth = proxyAuthorizationHeader(proxyUrl);
      rawSocket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n${auth}\r\n`);
    };

    rawSocket.setTimeout(timeoutMs, onTimeout);
    rawSocket.once("error", onError);
    rawSocket.on("data", onData);
    rawSocket.once(proxyUrl.protocol === "https:" ? "secureConnect" : "connect", sendConnect);
  });
}

function telegramBotApiHttpPost(url, body, timeoutMs = 30000) {
  const targetUrl = url instanceof URL ? url : new URL(String(url || ""));
  const payload = JSON.stringify(body);
  const proxyUrl = proxyUrlForHttpsTarget(targetUrl);
  return new Promise((resolve, reject) => {
    const requestOptions = {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: Number(targetUrl.port || 443),
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    };
    if (proxyUrl) {
      requestOptions.createConnection = (options, callback) => {
        connectTlsViaHttpProxy(proxyUrl, {
          hostname: targetUrl.hostname,
          port: Number(targetUrl.port || 443),
          servername: options.servername || targetUrl.hostname
        }, timeoutMs).then((socket) => callback(null, socket), callback);
      };
    }
    const req = https.request(requestOptions, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          req.destroy(new Error("telegram bot api response too large"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          statusMessage: res.statusMessage || "",
          text: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("telegram bot api request timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function telegramBotApiPost(token, method, body, timeoutMs = 30000) {
  const response = await telegramBotApiHttpPost(`https://api.telegram.org/bot${token}/${method}`, body, timeoutMs);
  const parsed = parseJsonValue(response.text, null);
  if (response.statusCode < 200 || response.statusCode >= 300 || !parsed || parsed.ok === false) {
    const description = parsed?.description || response.text || response.statusMessage;
    throw new Error(`telegram bot api ${method} failed: ${String(description).slice(0, 1000)}`);
  }
  return parsed.result || parsed;
}

function telegramRequeueStrategyChinese(strategy = "") {
  const map = {
    retry_failed_delivery: "失败投递重试",
    reclaim_stale_delivery_lease: "回收过期投递租约后重试",
    wait_for_active_delivery_lease: "等待当前投递租约结束",
    terminal_sent_idempotent_replay_only: "已投递完成，仅允许幂等回放",
    already_queued: "已在排队中，无需重排",
    not_requeueable: "当前状态不可重排",
    outbox_not_found: "未找到 outbox"
  };
  return map[strategy] || strategy || "未知策略";
}

function telegramRequeueStatusChinese(status = "") {
  const map = {
    failed: "失败",
    delivering: "投递中",
    queued: "排队中",
    sent: "已投递",
    cancelled: "已取消"
  };
  return map[status] || status || "未知";
}

export function createTelegramOutboxActionRegistry(handlers = {}) {
  const entries = Object.entries(TELEGRAM_OUTBOX_ACTION_HANDLER_NAMES).map(([action, handlerName]) => {
    const handler = handlers[handlerName];
    if (typeof handler !== "function") throw new Error(`Missing telegram.outbox action handler: ${handlerName}`);
    return [action, handler];
  });
  return new Map(entries);
}

export async function runTelegramOutboxAction(registry, action, rootDir, input = {}) {
  const handler = registry.get(action);
  if (!handler) return { handled: false, value: null };
  return { handled: true, value: await handler(rootDir, input) };
}

export function createTelegramOutboxActionHandlers(context = {}) {
  const appendWorkflowEvent = requireContextFunction(context, "appendWorkflowEvent");
  const ensureWorkflowLayout = requireContextFunction(context, "ensureWorkflowLayout");
  const humanGatePlanOptionButtons = requireContextFunction(context, "humanGatePlanOptionButtons");
  const nowIso = requireContextFunction(context, "nowIso");
  const resolveTelegramBotToken = requireContextFunction(context, "resolveTelegramBotToken");
  const updateMessageFlowFromTelegramDelivery = requireContextFunction(context, "updateMessageFlowFromTelegramDelivery");
  const writeJsonArtifact = requireContextFunction(context, "writeJsonArtifact");
  const HUMAN_GATE_APPROVE_OPTION_MAX = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MAX");
  const HUMAN_GATE_APPROVE_OPTION_MIN = requireContextValue(context, "HUMAN_GATE_APPROVE_OPTION_MIN");
  const TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES = requireContextValue(context, "TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES");
  const TELEGRAM_OUTBOX_DELIVERY_LEASE_MS = requireContextValue(context, "TELEGRAM_OUTBOX_DELIVERY_LEASE_MS");

  async function enqueueTelegramOutbox(paths, input) {
    const outboxId = input.outboxId || input.outbox_id || safeId("tg");
    const createdAt = nowIso();
    const payload = parseJsonValue(input.payload, input.payload || {});
    const messageType = input.messageType || input.message_type || "meeting_live";
    const status = input.status || "queued";
    const targetRef = input.targetRef || input.target_ref || "";
    if (TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES.has(String(messageType)) && ["queued", "delivering"].includes(String(status)) && !String(targetRef || "").trim()) {
      throw new Error(`telegram_outbox target_ref is required for ${messageType}`);
    }
    const existing = await sqlite(paths.dbFile, `SELECT outbox_id, status, message_type FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
    if (existing[0]) {
      const existingStatus = String(existing[0].status || "");
      const existingType = String(existing[0].message_type || "");
      if (messageType === "human_gate_request" && existingType === "human_gate_request" && ["cancelled", "failed"].includes(existingStatus)) {
        await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET meeting_id=${sqlValue(input.meetingId || input.meeting_id || "")},
    target_kind=${sqlValue(input.targetKind || input.target_kind || "group")},
    target_ref=${sqlValue(targetRef)},
    status=${sqlValue(status)},
    text=${sqlValue(input.text || "")},
    payload_json=${sqlValue(JSON.stringify(payload))},
    updated_at=${sqlValue(createdAt)}
WHERE outbox_id=${sqlValue(outboxId)};`);
        await writeJsonArtifact(paths.root, path.join(paths.telegramDir, "outbox"), outboxId, {
          outboxId,
          meetingId: input.meetingId || input.meeting_id || "",
          targetKind: input.targetKind || input.target_kind || "group",
          targetRef,
          messageType,
          status,
          text: input.text || "",
          payload,
          createdAt,
          updatedAt: createdAt,
          requeuedFromStatus: existingStatus
        });
        return { outboxId, status, deduped: true, requeued: true, previousStatus: existingStatus };
      }
      return { outboxId, status: existingStatus, deduped: true };
    }
    await sqlite(paths.dbFile, `
INSERT INTO telegram_outbox(outbox_id, meeting_id, target_kind, target_ref, message_type, status, text, payload_json, created_at, updated_at)
VALUES (${sqlValue(outboxId)}, ${sqlValue(input.meetingId || input.meeting_id || "")}, ${sqlValue(input.targetKind || input.target_kind || "group")}, ${sqlValue(targetRef)}, ${sqlValue(messageType)}, ${sqlValue(status)}, ${sqlValue(input.text || "")}, ${sqlValue(JSON.stringify(payload))}, ${sqlValue(createdAt)}, ${sqlValue(createdAt)});`);
    await writeJsonArtifact(paths.root, path.join(paths.telegramDir, "outbox"), outboxId, {
      outboxId,
      meetingId: input.meetingId || input.meeting_id || "",
      targetKind: input.targetKind || input.target_kind || "group",
      targetRef,
      messageType,
      status,
      text: input.text || "",
      payload,
      createdAt
    });
    return { outboxId, status };
  }

  async function deliverTelegramOutboxRowViaWebApp(paths, row, input, deliveryContext) {
    if (String(row.message_type || "").trim() === "human_gate_request") return null;
    const payload = deliveryContext.payload || {};
    const replyMarkup = payload.telegramReplyMarkup || payload.reply_markup || null;
    if (!replyMarkup?.inline_keyboard?.length) return null;
    const account = deliveryContext.account;
    const target = normalizeTelegramBotApiChatId(deliveryContext.target);
    if (!target) return null;
    const token = await resolveTelegramBotToken(account, input);
    if (!token) return null;
    const deliveredAt = nowIso();
    const receipts = Array.isArray(payload.delivery?.receipts) ? [...payload.delivery.receipts] : [];
    const startIndex = Math.min(receipts.length, deliveryContext.chunks.length);
    try {
      for (const [index, chunk] of deliveryContext.chunks.entries()) {
        if (index < startIndex) continue;
        const receipt = await telegramBotApiPost(token, "sendMessage", {
          chat_id: target,
          text: chunk,
          disable_web_page_preview: true,
          ...(index === deliveryContext.chunks.length - 1 ? { reply_markup: replyMarkup } : {})
        }, deliveryContext.timeoutSeconds * 1000);
        receipts.push(receipt);
      }
      const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, mode: "direct_bot_api_web_app", deliveredAt, receipts } };
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='sent', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(deliveredAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
      return { outboxId: row.outbox_id, status: "sent", account, target, mode: "direct_bot_api_web_app", parts: deliveryContext.chunks.length, receipts };
    } catch (error) {
      const failedAt = nowIso();
      if (receipts.length > 0) {
        const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, mode: "direct_bot_api_web_app", failedAt, error: String(error?.message || error).slice(0, 2000), receipts } };
        await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='failed', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(failedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
        return { outboxId: row.outbox_id, status: "failed", account, target, mode: "direct_bot_api_web_app", error: String(error?.message || error).slice(0, 2000), receipts };
      }
      return { outboxId: row.outbox_id, status: "web_app_direct_delivery_unavailable", account, target, error: String(error?.message || error).slice(0, 2000), receipts };
    }
  }

  async function claimTelegramOutboxDelivery(paths, row, input = {}) {
    const status = String(row.status || "").trim();
    if (!["queued", "failed", "delivering"].includes(status)) {
      return { claimed: false, row, reason: `status_${status || "unknown"}` };
    }
    const claimedAt = nowIso();
    const staleBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
    const payload = parseJsonValue(row.payload_json, {});
    const claim = {
      claimId: safeId("tg_claim"),
      claimedAt,
      owner: firstText(input.owner, input.from, "workflow"),
      previousStatus: status
    };
    const updatedPayload = { ...payload, deliveryClaim: claim };
    const statusPredicate = status === "delivering"
      ? `status='delivering' AND updated_at <= ${sqlValue(staleBefore)}`
      : `status=${sqlValue(status)}`;
    const changed = await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='delivering', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(claimedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)} AND (${statusPredicate});
SELECT changes() AS changed;`, { json: true });
    if (Number(changed?.[0]?.changed || 0) !== 1) {
      const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(row.outbox_id)} LIMIT 1;`, { json: true });
      return { claimed: false, row: rows[0] || row, reason: "not_claimed" };
    }
    return {
      claimed: true,
      row: {
        ...row,
        status: "delivering",
        payload_json: JSON.stringify(updatedPayload),
        updated_at: claimedAt
      },
      claim
    };
  }

  async function deliverTelegramOutboxRow(paths, row, input = {}) {
    const claim = await claimTelegramOutboxDelivery(paths, row, input);
    if (!claim.claimed) {
      return { outboxId: row.outbox_id, status: claim.row?.status || row.status || "not_claimed", skipped: true, reason: claim.reason };
    }
    row = claim.row;
    const payload = parseJsonValue(row.payload_json, {});
    const account = String(input.account || payload.account || "cat_claw").trim();
    const explicitTarget = String(input.target || "").trim();
    const rowTarget = String(row.target_ref || "").trim();
    if (!explicitTarget && !rowTarget) {
      const failedAt = nowIso();
      const error = "telegram_outbox target_ref is required unless an explicit target override is provided";
      const updatedPayload = { ...payload, delivery: { channel: "telegram", account, failedAt, error } };
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='failed', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(failedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
      const result = { outboxId: row.outbox_id, status: "failed", account, error };
      await updateMessageFlowFromTelegramDelivery(paths, row, result);
      return result;
    }
    const target = explicitTarget || rowTarget;
    const openclawBin = String(input.openclawBin || input.openclaw_bin || "openclaw").trim();
    const timeoutSeconds = Math.max(5, Math.min(120, Number(input.timeoutSeconds || input.timeout_seconds || 30)));
    const chunks = telegramChunks(row.text);
    const deliveredAt = nowIso();
    const receipts = Array.isArray(payload.delivery?.receipts) ? [...payload.delivery.receipts] : [];
    const startIndex = Math.min(receipts.length, chunks.length);
    try {
      const webAppDelivery = await deliverTelegramOutboxRowViaWebApp(paths, row, input, { payload, account, target, chunks, timeoutSeconds });
      if (webAppDelivery?.status === "sent" || webAppDelivery?.status === "failed") {
        await updateMessageFlowFromTelegramDelivery(paths, row, webAppDelivery);
        return webAppDelivery;
      }
      if (webAppDelivery?.status === "web_app_direct_delivery_unavailable") {
        payload.webAppDirectDeliveryFallback = {
          attemptedAt: nowIso(),
          error: webAppDelivery.error,
          reason: "falling_back_to_openclaw_callback_buttons"
        };
      }
      for (const [index, chunk] of chunks.entries()) {
        if (index < startIndex) continue;
        const args = [
          "message",
          "send",
          "--channel",
          "telegram",
          "--account",
          account,
          "--target",
          target,
          "--message",
          chunk,
          "--json"
        ];
        if (payload.presentation && index === chunks.length - 1) {
          args.push("--presentation", JSON.stringify(payload.presentation));
        }
        const { stdout, stderr } = await execFileAsync(openclawBin, args, {
          cwd: paths.root,
          timeout: timeoutSeconds * 1000,
          maxBuffer: 4 * 1024 * 1024
        });
        const parsed = parseJsonValue(String(stdout || "").trim(), null);
        if (!parsed || parsed.payload?.ok === false || parsed.ok === false) {
          throw new Error(`telegram send failed: ${String(stdout || stderr || "").slice(0, 1000)}`);
        }
        receipts.push(parsed.payload || parsed);
      }
      const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, deliveredAt, receipts } };
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='sent', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(deliveredAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
      const result = { outboxId: row.outbox_id, status: "sent", account, target, parts: chunks.length, receipts };
      await updateMessageFlowFromTelegramDelivery(paths, row, result);
      return result;
    } catch (error) {
      const failedAt = nowIso();
      const updatedPayload = { ...payload, delivery: { channel: "telegram", account, target, failedAt, error: String(error?.message || error).slice(0, 2000), receipts } };
      await sqlite(paths.dbFile, `
UPDATE telegram_outbox
SET status='failed', payload_json=${sqlValue(JSON.stringify(updatedPayload))}, updated_at=${sqlValue(failedAt)}
WHERE outbox_id=${sqlValue(row.outbox_id)};`);
      const result = { outboxId: row.outbox_id, status: "failed", account, target, error: String(error?.message || error).slice(0, 2000), receipts };
      await updateMessageFlowFromTelegramDelivery(paths, row, result);
      return result;
    }
  }

  async function autoDeliverReportOutbox(paths, ingest, input = {}) {
    if (!ingest?.reportOutbox?.outboxId) return null;
    const enabled = boolOption(input.autoDeliverReportOutbox ?? input.auto_deliver_report_outbox ?? input.reportDelivery ?? input.report_delivery, true);
    if (!enabled) return { outboxId: ingest.reportOutbox.outboxId, status: "queued", skipped: true };
    const rows = await sqlite(paths.dbFile, `
SELECT * FROM telegram_outbox
WHERE outbox_id=${sqlValue(ingest.reportOutbox.outboxId)}
LIMIT 1;`, { json: true });
    const row = rows[0];
    if (!row) return { outboxId: ingest.reportOutbox.outboxId, status: "missing" };
    if (row.status !== "queued") return { outboxId: row.outbox_id, status: row.status, skipped: true };
    return deliverTelegramOutboxRow(paths, row, input);
  }

  async function telegramOutboxDeliveryPreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const outboxId = String(input.outboxId || input.outbox_id || "").trim();
    if (!outboxId) throw new Error("outboxId is required");
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM telegram_outbox
WHERE outbox_id=${sqlValue(outboxId)}
LIMIT 1;`, { json: true });
    const row = rows[0];
    const base = {
      schemaVersion: "telegram_outbox_delivery_preview.v1",
      action: "telegram.outbox.delivery.preview",
      readOnly: true,
      writeBoundary: "preview_only",
      outboxId,
      dbFile: paths.dbFile
    };
    if (!row) {
      return {
        ...base,
        eligible: false,
        claimEligible: false,
        wouldSendTelegram: false,
        wouldInvokeOpenClawCli: false,
        violations: [{ code: "outbox_not_found", detail: `telegram_outbox row not found: ${outboxId}` }],
        warnings: [],
        wouldUpdate: {
          telegramOutboxStatus: "unchanged",
          messageFlowDelivery: "unchanged"
        }
      };
    }
    const payload = parseJsonValue(row.payload_json, {});
    const account = String(input.account || payload.account || "cat_claw").trim();
    const explicitTarget = String(input.target || "").trim();
    const rowTarget = String(row.target_ref || "").trim();
    const target = explicitTarget || rowTarget;
    const normalizedTarget = normalizeTelegramBotApiChatId(target);
    const status = String(row.status || "").trim();
    const messageType = String(row.message_type || "").trim();
    const updatedAt = String(row.updated_at || "").trim();
    const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
    const staleDelivering = status === "delivering" && Boolean(updatedAt) && updatedAt <= staleDeliveringBefore;
    const claimEligible = status === "queued" || status === "failed" || staleDelivering;
    const claimReason = claimEligible
      ? (staleDelivering ? "stale_delivering_reclaimable" : `status_${status}`)
      : `status_${status || "unknown"}`;
    const text = String(row.text || "");
    const chunks = telegramChunks(text);
    const receipts = Array.isArray(payload.delivery?.receipts) ? payload.delivery.receipts : [];
    const startIndex = Math.min(receipts.length, chunks.length);
    const replyMarkup = payload.telegramReplyMarkup || payload.reply_markup || null;
    const inlineKeyboard = Array.isArray(replyMarkup?.inline_keyboard) ? replyMarkup.inline_keyboard : [];
    const inlineButtonCount = inlineKeyboard.reduce((count, buttonRow) => count + (Array.isArray(buttonRow) ? buttonRow.length : 0), 0);
    const payloadButtons = Array.isArray(payload.buttons) ? payload.buttons : [];
    const buttonCount = inlineButtonCount || payloadButtons.length;
    const approveOptionButtonCount = payloadButtons.length
      ? humanGatePlanOptionButtons(payloadButtons).length
      : Math.max(0, buttonCount - 2);
    const targetRequired = TARGET_REQUIRED_TELEGRAM_MESSAGE_TYPES.has(messageType);
    const deliveryOperatorReason = String(
      input.deliveryOperatorReason ||
      input.delivery_operator_reason ||
      input.executionReason ||
      input.execution_reason ||
      ""
    ).trim();
    const catClawAuditId = firstText(
      input.catClawAuditId,
      input.cat_claw_audit_id,
      input.catClawAudit,
      input.cat_claw_audit,
      input.secretaryAuditId,
      input.secretary_audit_id
    );
    const deliveryApprovalId = firstText(
      input.deliveryApprovalId,
      input.delivery_approval_id,
      input.deliveryEvidenceId,
      input.delivery_evidence_id,
      input.humanGateEvidence,
      input.human_gate_evidence,
      input.evidenceHumanGateId,
      input.evidence_human_gate_id
    );
    const violations = [];
    const warnings = [];
    const governanceViolations = [];
    const governanceWarnings = [];
    if (!claimEligible) {
      violations.push({ code: "status_not_claimable", detail: `delivery claim would be skipped for status=${status || "unknown"}` });
    }
    if (!normalizedTarget) {
      violations.push({ code: "target_missing", detail: "telegram_outbox target_ref or explicit target is required before delivery" });
    }
    if (!text.trim()) {
      violations.push({ code: "text_missing", detail: "telegram_outbox text is empty" });
    }
    if (status === "failed") {
      warnings.push({ code: "retry_failed_outbox", detail: "delivery would retry a failed outbox row" });
    }
    if (staleDelivering) {
      warnings.push({ code: "stale_delivering_reclaim", detail: `delivery lease is older than ${TELEGRAM_OUTBOX_DELIVERY_LEASE_MS}ms` });
    }
    if (receipts.length > 0) {
      warnings.push({ code: "partial_receipts_present", detail: `delivery would resume after ${startIndex} recorded receipt(s)` });
    }
    if (!deliveryOperatorReason) {
      governanceViolations.push({ code: "delivery_operator_reason_required", detail: "A future delivery execution must carry an explicit delivery operator reason." });
    }
    if (messageType === "human_gate_request" && !catClawAuditId) {
      governanceViolations.push({ code: "cat_claw_audit_required", detail: "Human Gate request delivery must be backed by Cat Claw/secretary audit evidence." });
    }
    if (messageType === "human_gate_request" && (approveOptionButtonCount < HUMAN_GATE_APPROVE_OPTION_MIN || approveOptionButtonCount > HUMAN_GATE_APPROVE_OPTION_MAX)) {
      governanceViolations.push({ code: "human_gate_buttons_incomplete", detail: `Human Gate request delivery expects ${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} approve options plus pause and terminate controls.` });
    }
    if (messageType === "human_gate_request" && account !== "cat_claw") {
      governanceWarnings.push({ code: "non_cat_claw_delivery_account", detail: `Human Gate request delivery should normally use cat_claw, got ${account || "<empty>"}.` });
    }
    if (targetRequired && !normalizedTarget) {
      governanceViolations.push({ code: "governed_target_required", detail: "Governed delivery cannot proceed without a bound Telegram target." });
    }
    const directBotApiWebAppCandidate = messageType !== "human_gate_request" && Boolean(inlineKeyboard.length && normalizedTarget);
    const eligible = violations.length === 0;
    const governanceReady = eligible && governanceViolations.length === 0;
    return {
      ...base,
      meetingId: row.meeting_id || "",
      status,
      messageType,
      targetKind: row.target_kind || "",
      targetRef: rowTarget,
      targetOverride: Boolean(explicitTarget),
      targetRequired,
      account,
      eligible,
      claimEligible,
      claimReason,
      createdAt: row.created_at || "",
      updatedAt,
      textLength: text.length,
      textPreview: redactSensitiveTextForPersistence(text.slice(0, 500)),
      chunkCount: chunks.length,
      resumedReceiptCount: receipts.length,
      pendingChunkCount: Math.max(0, chunks.length - startIndex),
      buttonSummary: {
        hasInlineKeyboard: inlineKeyboard.length > 0,
        rowCount: inlineKeyboard.length,
        buttonCount,
        payloadButtonCount: payloadButtons.length
      },
      deliveryPath: {
        directBotApiWebAppCandidate,
        openclawCliCandidate: Boolean(normalizedTarget),
        modeOrder: directBotApiWebAppCandidate
          ? ["direct_bot_api_web_app", "openclaw_message_send"]
          : ["openclaw_message_send"],
        presentationOnLastChunk: Boolean(payload.presentation)
      },
      executionPolicy: {
        previewOnly: true,
        futureAction: "telegram.outbox.delivery",
        riskTier: "P2-controlled-delivery",
        governanceReady,
        requiredBeforeExecution: [
          "console writes explicitly enabled",
          "operator reason",
          "idempotency key",
          "claimable outbox status",
          "bound Telegram target",
          ...(messageType === "human_gate_request" ? ["Cat Claw/secretary audit evidence", `${HUMAN_GATE_APPROVE_OPTION_MIN}-${HUMAN_GATE_APPROVE_OPTION_MAX} approve buttons plus pause/terminate controls`] : [])
        ],
        evidencePresence: {
          deliveryOperatorReason: Boolean(deliveryOperatorReason),
          catClawAudit: Boolean(catClawAuditId),
          deliveryApproval: Boolean(deliveryApprovalId)
        },
        hardStops: [...violations, ...governanceViolations],
        warnings: [...warnings, ...governanceWarnings]
      },
      receiptPolicy: {
        deliveryReceiptRequired: true,
        terminalOutboxStatuses: ["sent", "failed"],
        sideEffectUncertainStatuses: ["delivering", "web_app_direct_delivery_unavailable"],
        requiredReceiptFields: ["channel", "account", "target", "deliveredAt or failedAt", "receipts or error"],
        messageFlowSync: messageType === "message_flow_reply" ? "required_after_terminal_delivery" : "not_required_for_message_type",
        humanGateDeliveryEvidence: messageType === "human_gate_request" ? "telegram_outbox_payload_delivery_required_before_closeout" : "not_applicable",
        idempotencyBoundary: "outbox_id + deliveryClaim.claimId + recorded receipt count"
      },
      wouldSendTelegram: eligible,
      wouldInvokeOpenClawCli: eligible,
      wouldReadBotToken: directBotApiWebAppCandidate ? "only_during_actual_delivery" : "no",
      wouldUpdate: {
        telegramOutboxStatus: eligible ? "delivering_then_sent_or_failed" : "unchanged",
        deliveryClaim: eligible,
        messageFlowDelivery: eligible && messageType === "message_flow_reply" ? "sent_or_failed" : "unchanged"
      },
      violations,
      warnings,
      governanceViolations,
      governanceWarnings
    };
  }

  async function telegramOutboxRequeuePreview(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const outboxId = String(input.outboxId || input.outbox_id || "").trim();
    if (!outboxId) throw new Error("outboxId is required");
    const explicitRequeueReason = firstText(
      input.requeueOperatorReason,
      input.requeue_operator_reason,
      input.redeliveryOperatorReason,
      input.redelivery_operator_reason
    );
    const deliveryPreviewInput = explicitRequeueReason && !firstText(input.deliveryOperatorReason, input.delivery_operator_reason, input.executionReason, input.execution_reason)
      ? { ...input, deliveryOperatorReason: explicitRequeueReason }
      : input;
    const deliveryPreview = await telegramOutboxDeliveryPreview(rootDir, deliveryPreviewInput);
    const base = {
      schemaVersion: "telegram_outbox_requeue_preview.v1",
      action: "telegram.outbox.requeue.preview",
      readOnly: true,
      writeBoundary: "preview_only",
      outboxId,
      dbFile: paths.dbFile,
      deliveryPreview
    };
    if (!deliveryPreview.meetingId && deliveryPreview.violations?.some((row) => row.code === "outbox_not_found")) {
      return {
        ...base,
        eligible: false,
        requeueEligible: false,
        wouldRequeue: false,
        wouldResendTelegram: false,
        recommendedNextAction: "none",
        requeuePolicy: {
          strategy: "outbox_not_found",
          preserveOutboxId: true,
          preserveHumanGateId: true,
          preserveButtonIds: true,
          createNewHumanGateRequest: false
        },
        violations: deliveryPreview.violations || [],
        warnings: deliveryPreview.warnings || [],
        governanceViolations: [],
        governanceWarnings: [],
        wouldUpdate: {
          telegramOutboxStatus: "unchanged",
          deliveryClaim: false,
          messageFlowDelivery: "unchanged"
        }
      };
    }
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM telegram_outbox
WHERE outbox_id=${sqlValue(outboxId)}
LIMIT 1;`, { json: true });
    const row = rows[0];
    const payload = parseJsonValue(row?.payload_json, {});
    const delivery = payload.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
    const deliveryClaim = payload.deliveryClaim && typeof payload.deliveryClaim === "object" ? payload.deliveryClaim : {};
    const status = String(row?.status || deliveryPreview.status || "").trim();
    const messageType = String(row?.message_type || deliveryPreview.messageType || "").trim();
    const updatedAt = String(row?.updated_at || "").trim();
    const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
    const staleDelivering = status === "delivering" && Boolean(updatedAt) && updatedAt <= staleDeliveringBefore;
    const freshDelivering = status === "delivering" && !staleDelivering;
    const failed = status === "failed";
    const queued = status === "queued";
    const sent = status === "sent";
    const receipts = Array.isArray(delivery.receipts) ? delivery.receipts : [];
    const requeueOperatorReason = firstText(
      input.requeueOperatorReason,
      input.requeue_operator_reason,
      input.redeliveryOperatorReason,
      input.redelivery_operator_reason,
      input.deliveryOperatorReason,
      input.delivery_operator_reason,
      input.executionReason,
      input.execution_reason
    );
    const catClawAuditId = firstText(
      input.catClawAuditId,
      input.cat_claw_audit_id,
      input.catClawAudit,
      input.cat_claw_audit,
      input.secretaryAuditId,
      input.secretary_audit_id
    );
    const deliveryApprovalId = firstText(
      input.deliveryApprovalId,
      input.delivery_approval_id,
      input.deliveryEvidenceId,
      input.delivery_evidence_id,
      input.humanGateEvidence,
      input.human_gate_evidence,
      input.evidenceHumanGateId,
      input.evidence_human_gate_id
    );
    const humanGateId = firstText(
      input.humanGateId,
      input.human_gate_id,
      payload.humanGateId,
      payload.human_gate_id,
      payload.humanGate?.id,
      payload.human_gate?.id
    );
    let strategy = "not_requeueable";
    if (failed) strategy = "retry_failed_delivery";
    else if (staleDelivering) strategy = "reclaim_stale_delivery_lease";
    else if (queued) strategy = "already_queued";
    else if (freshDelivering) strategy = "wait_for_active_delivery_lease";
    else if (sent) strategy = "terminal_sent_idempotent_replay_only";
    const requeueEligible = failed || staleDelivering;
    const violations = [];
    const warnings = [];
    const governanceViolations = [];
    const governanceWarnings = [];
    if (!requeueEligible) {
      violations.push({
        code: sent ? "already_sent" : freshDelivering ? "delivery_lease_active" : queued ? "already_queued" : "status_not_requeueable",
        detail: sent
          ? "Outbox is already sent; a future delivery execution should return idempotent replay, not resend."
          : freshDelivering
            ? "Outbox is delivering and the delivery lease is not stale yet."
            : queued
              ? "Outbox is already queued; no requeue step is needed before governed delivery."
              : `Outbox status ${status || "unknown"} is not eligible for requeue preview.`
      });
    }
    for (const item of deliveryPreview.violations || []) {
      if (item.code !== "status_not_claimable") violations.push(item);
    }
    if (!requeueOperatorReason && requeueEligible) {
      governanceViolations.push({ code: "requeue_operator_reason_required", detail: "A future resend/requeue action must carry an explicit requeue or delivery operator reason." });
    }
    if (messageType === "human_gate_request" && requeueEligible && !catClawAuditId) {
      governanceViolations.push({ code: "cat_claw_audit_required", detail: "Human Gate notification redelivery must be backed by Cat Claw/secretary audit evidence." });
    }
    if (messageType === "human_gate_request" && requeueEligible && !humanGateId) {
      governanceWarnings.push({ code: "human_gate_id_not_embedded", detail: "No Human Gate id was found in input or outbox payload; preserve the existing outbox id and button ids before any redelivery." });
    }
    if (failed) warnings.push({ code: "failed_outbox_redelivery", detail: "Preview would retry a failed outbox row through the governed delivery path." });
    if (staleDelivering) warnings.push({ code: "stale_delivery_lease", detail: `Preview would reclaim a delivery lease older than ${TELEGRAM_OUTBOX_DELIVERY_LEASE_MS}ms.` });
    if (receipts.length > 0) warnings.push({ code: "partial_receipts_present", detail: `Existing delivery receipts (${receipts.length}) must be preserved; later delivery resumes after recorded parts.` });
    const deliveryGovernanceReady = Boolean(deliveryPreview.executionPolicy?.governanceReady);
    const governanceReady = requeueEligible && governanceViolations.length === 0 && deliveryGovernanceReady;
    return {
      ...base,
      meetingId: deliveryPreview.meetingId || row?.meeting_id || "",
      status,
      messageType,
      targetKind: deliveryPreview.targetKind || row?.target_kind || "",
      targetRef: deliveryPreview.targetRef || row?.target_ref || "",
      account: deliveryPreview.account || "",
      eligible: requeueEligible && (deliveryPreview.eligible || false),
      requeueEligible,
      deliveryExecutionEligible: Boolean(deliveryPreview.eligible),
      governanceReady,
      strategy,
      recommendedNextAction: requeueEligible ? "telegram.outbox.delivery" : "none",
      wouldRequeue: requeueEligible,
      wouldResendTelegram: requeueEligible && deliveryPreview.eligible,
      wouldInvokeOpenClawCli: requeueEligible && deliveryPreview.wouldInvokeOpenClawCli,
      currentDelivery: {
        channel: delivery.channel || "",
        account: delivery.account || payload.account || "",
        target: delivery.target || row?.target_ref || "",
        deliveredAt: delivery.deliveredAt || "",
        failedAt: delivery.failedAt || "",
        error: redactSensitiveTextForPersistence(String(delivery.error || "").slice(0, 1000)),
        receiptCount: receipts.length,
        claimId: deliveryClaim.claimId || "",
        claimedAt: deliveryClaim.claimedAt || "",
        claimOwner: deliveryClaim.owner || "",
        previousStatus: deliveryClaim.previousStatus || ""
      },
      requeuePolicy: {
        previewOnly: true,
        futureAction: "telegram.outbox.delivery",
        strategy,
        preserveOutboxId: true,
        preserveHumanGateId: true,
        preserveButtonIds: true,
        preserveDeliveryReceipts: true,
        createNewHumanGateRequest: false,
        createNewTelegramOutbox: false,
        idempotencyRequired: true,
        operatorReasonRequired: true,
        catClawAuditRequired: messageType === "human_gate_request",
        humanGateId: humanGateId || "",
        buttonCount: deliveryPreview.buttonSummary?.buttonCount || 0,
        existingReceiptCount: receipts.length,
        staleLeaseCutoff: staleDeliveringBefore,
        sideEffectBoundary: "telegram_delivery_only"
      },
      executionPolicy: {
        previewOnly: true,
        futureAction: "telegram.outbox.delivery",
        governanceReady,
        requiredBeforeExecution: [
          "console writes explicitly enabled",
          "idempotency key",
          "explicit requeue or delivery operator reason",
          "failed or stale-delivering outbox status",
          "bound Telegram target",
          "preserve original outbox id, Human Gate id, button ids, and existing receipts",
          ...(messageType === "human_gate_request" ? ["Cat Claw/secretary audit evidence"] : [])
        ],
        evidencePresence: {
          requeueOperatorReason: Boolean(requeueOperatorReason),
          catClawAudit: Boolean(catClawAuditId),
          deliveryApproval: Boolean(deliveryApprovalId),
          humanGateId: Boolean(humanGateId)
        },
        hardStops: [...violations, ...governanceViolations, ...(deliveryPreview.governanceViolations || [])],
        warnings: [...warnings, ...governanceWarnings, ...(deliveryPreview.governanceWarnings || [])]
      },
      wouldUpdate: {
        telegramOutboxStatus: requeueEligible ? "delivering_then_sent_or_failed" : "unchanged",
        deliveryClaim: requeueEligible,
        messageFlowDelivery: requeueEligible ? deliveryPreview.wouldUpdate?.messageFlowDelivery || "sent_or_failed" : "unchanged",
        workflowStatus: "unchanged",
        humanGateRecord: "unchanged",
        tradingState: "unchanged"
      },
      violations,
      warnings,
      governanceViolations,
      governanceWarnings
    };
  }

  async function telegramOutboxRequeueExecutionPackagePreview(rootDir, input = {}) {
    const generatedAt = nowIso();
    const requeue = await telegramOutboxRequeuePreview(rootDir, input);
    const outboxId = requeue.outboxId || String(input.outboxId || input.outbox_id || "").trim();
    const humanGateId = requeue.requeuePolicy?.humanGateId || "";
    const statusCn = telegramRequeueStatusChinese(requeue.status);
    const strategyCn = telegramRequeueStrategyChinese(requeue.strategy);
    const missingEvidence = [];
    if (!requeue.executionPolicy?.evidencePresence?.requeueOperatorReason) missingEvidence.push("明确的重投递/投递操作理由");
    if (requeue.requeuePolicy?.catClawAuditRequired && !requeue.executionPolicy?.evidencePresence?.catClawAudit) missingEvidence.push("猫爪/秘书复核证据");
    if (!requeue.executionPolicy?.evidencePresence?.humanGateId && requeue.messageType === "human_gate_request") missingEvidence.push("原 Human Gate id");
    if (!requeue.deliveryExecutionEligible) missingEvidence.push("可用的 Telegram target/text/button 投递条件");
    const preservation = [
      `原 outbox id：${outboxId || "缺失"}`,
      `原 Human Gate id：${humanGateId || "未在 payload/input 中发现"}`,
      `按钮数量：${requeue.requeuePolicy?.buttonCount ?? 0}，不得新建并行 Human Gate 决策对象`,
      `已有投递 receipt 数量：${requeue.requeuePolicy?.existingReceiptCount ?? 0}，必须原样保留并从已记录分片后续投递`,
      `目标：${requeue.targetKind || "-"}:${requeue.targetRef || "-"}`,
      "未来实际执行只能进入 telegram.outbox.delivery，并由该动作二次校验 idempotency key、operator reason、Cat Claw audit 和 target"
    ];
    const summaryLines = [
      `事项：Telegram outbox 重投递执行前确认包。`,
      `当前 outbox：${outboxId || "缺失"}，状态：${statusCn}（${requeue.status || "unknown"}），策略：${strategyCn}（${requeue.strategy || "unknown"}）。`,
      `目标：${requeue.targetKind || "-"}:${requeue.targetRef || "-"}，账号：${requeue.account || "-"}，消息类型：${requeue.messageType || "-"}.`,
      requeue.requeueEligible
        ? "机器判断：该 outbox 处于 failed 或 stale-delivering，可进入受治理重投递路径的执行前审计。"
        : "机器判断：该 outbox 当前不应重投递；如果已经 sent，应走幂等回放审计，而不是重新发送。",
      requeue.governanceReady
        ? "治理状态：执行前关键证据已满足，仍需人类确认是否允许进入实际 delivery action。"
        : `治理状态：尚未满足执行条件，缺口：${missingEvidence.length ? missingEvidence.join("、") : "见 hardStops/warnings"}.`,
      "边界：本包只用于猫爪/闪电猫审计，不会重置 outbox、不 claim lease、不发送 Telegram、不创建 Human Gate、不写 side effect、不触碰交易状态。"
    ];
    const options = [
      {
        optionId: "A",
        title: "批准受治理重投递",
        buttonLabel: "方案 A：批准重投递",
        buttonStyle: "success",
        recommendation: requeue.governanceReady ? "recommended_when_operator_confirms" : "blocked_until_missing_evidence_resolved",
        content: "在补齐/确认 Cat Claw audit、操作理由和 idempotency key 后，只允许通过 telegram.outbox.delivery 执行实际投递；不得新建 Human Gate 或新 outbox。",
        nextStep: "由受控执行入口调用 telegram.outbox.delivery，并保留同一个 outbox/Human Gate/button/receipt 证据链。",
        executionBoundary: "telegram_delivery_only"
      },
      {
        optionId: "B",
        title: "暂缓重投递并补证",
        buttonLabel: "方案 B：暂缓补证",
        buttonStyle: "success",
        recommendation: requeue.governanceReady ? "optional_cautious_path" : "recommended_until_ready",
        content: "不执行重投递；先补齐猫爪复核、操作理由、目标/按钮/receipt 证据，或等待 fresh delivering lease 自然结束。",
        nextStep: "保持 outbox 当前状态不变，继续收集证据或等待下一轮队列/人工复核。",
        executionBoundary: "no_write"
      },
      {
        optionId: "C",
        title: "不重投递并收口为审计记录",
        buttonLabel: "方案 C：不重投递",
        buttonStyle: "success",
        recommendation: requeue.status === "sent" ? "recommended_for_sent_rows" : "use_when_redelivery_risk_exceeds_value",
        content: "不重新发送 Telegram；将当前状态作为审计事实处理。已 sent 的 outbox 只能记录幂等回放，不应再次发送。",
        nextStep: "由猫爪/猫之脑补充 closeout 或 incident 说明，说明为什么不重投递。",
        executionBoundary: "audit_only"
      }
    ];
    const controls = [
      {
        controlId: "pause_workflow",
        title: "暂停工作流",
        buttonLabel: "暂停工作流",
        buttonStyle: "primary",
        content: "暂停后不执行重投递，等待猫爪或闪电猫补充指令。"
      },
      {
        controlId: "terminate_workflow",
        title: "终止工作流",
        buttonLabel: "终止工作流",
        buttonStyle: "danger",
        content: "终止表示本段重投递事项不再推进，进入归档/可恢复记录流程；不是删除 workflow。"
      }
    ];
    const packageTextZh = [
      "# Telegram outbox 重投递执行前确认包",
      "",
      ...summaryLines.map((line) => `- ${line}`),
      "",
      "## 必须保留的证据链",
      ...preservation.map((line) => `- ${line}`),
      "",
      "## 可选方案",
      ...options.map((option) => `- ${option.optionId}. ${option.title}：${option.content}`),
      "",
      "## 控制项",
      ...controls.map((control) => `- ${control.title}：${control.content}`)
    ].join("\n");
    return {
      schemaVersion: "telegram_outbox_requeue_execution_package_preview.v1",
      action: "telegram.outbox.requeue.execution_package.preview",
      readOnly: true,
      writeBoundary: "preview_only",
      generatedAt,
      outboxId,
      meetingId: requeue.meetingId || "",
      humanGateId,
      status: requeue.status || "",
      strategy: requeue.strategy || "",
      strategyZh: strategyCn,
      requeueEligible: Boolean(requeue.requeueEligible),
      governanceReady: Boolean(requeue.governanceReady),
      readyForCatClawReview: Boolean(requeue.outboxId && requeue.messageType),
      readyForExecutionRequest: Boolean(requeue.governanceReady),
      futureExecutionAction: "telegram.outbox.delivery",
      didWrite: false,
      didSendTelegram: false,
      didCreateHumanGate: false,
      didCreateOutbox: false,
      didTouchTradingState: false,
      package: {
        titleZh: "Telegram outbox 重投递执行前确认包",
        summaryZh: summaryLines,
        preservationZh: preservation,
        missingEvidenceZh: missingEvidence,
        options,
        controls,
        packageTextZh
      },
      auditBoundary: {
        preserveOutboxId: true,
        preserveHumanGateId: true,
        preserveButtonIds: true,
        preserveDeliveryReceipts: true,
        noParallelHumanGate: true,
        noParallelOutbox: true,
        futureExecutionBoundary: "telegram_delivery_only"
      },
      requeuePreview: requeue,
      violations: requeue.violations || [],
      governanceViolations: requeue.governanceViolations || [],
      warnings: requeue.warnings || [],
      governanceWarnings: requeue.governanceWarnings || []
    };
  }

  async function telegramOutboxDelivery(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    const outboxId = String(input.outboxId || input.outbox_id || "").trim();
    if (!outboxId) throw new Error("outboxId is required");
    const idempotencyKey = firstText(input.idempotencyKey, input.idempotency_key);
    if (!idempotencyKey) throw new Error("idempotencyKey is required for telegram outbox delivery execution");
    const preview = await telegramOutboxDeliveryPreview(rootDir, input);
    const hardStops = [
      ...(Array.isArray(preview.violations) ? preview.violations : []),
      ...(Array.isArray(preview.governanceViolations) ? preview.governanceViolations : [])
    ];
    const rows = await sqlite(paths.dbFile, `
SELECT *
FROM telegram_outbox
WHERE outbox_id=${sqlValue(outboxId)}
LIMIT 1;`, { json: true });
    const row = rows[0];
    if (!row) throw new Error(`telegram_outbox row not found: ${outboxId}`);
    if (preview.status === "sent") {
      const payload = parseJsonValue(row.payload_json, {});
      const delivery = payload.delivery || {};
      return {
        schemaVersion: "telegram_outbox_delivery_result.v1",
        action: "telegram.outbox.delivery",
        writeBoundary: "telegram_delivery_only",
        outboxId,
        meetingId: preview.meetingId,
        messageType: preview.messageType,
        account: preview.account,
        targetKind: preview.targetKind,
        targetRef: preview.targetRef,
        deliveryStatus: "sent",
        idempotentReplay: true,
        didClaimOutbox: false,
        didSendTelegram: false,
        didUpdateOutbox: false,
        didUpdateMessageFlow: false,
        didTouchTradingState: false,
        receiptCount: Array.isArray(delivery.receipts) ? delivery.receipts.length : 0,
        receiptPolicy: preview.receiptPolicy,
        executionPolicy: {
          ...preview.executionPolicy,
          previewOnly: false
        },
        result: redactSensitiveForPersistence({ outboxId, status: "sent", delivery }),
        dbFile: paths.dbFile
      };
    }
    if (!preview.eligible || !preview.executionPolicy?.governanceReady) {
      throw new Error(`telegram outbox delivery blocked: ${hardStops.map((item) => item.code || item.detail).filter(Boolean).join(",") || "policy_not_ready"}`);
    }
    const result = await deliverTelegramOutboxRow(paths, row, {
      ...input,
      account: preview.account,
      target: preview.targetRef
    });
    const status = String(result?.status || "").trim() || "unknown";
    const workflowId = firstText(input.workflowId, input.workflow_id, preview.meetingId);
    const deliveryReceiptCount = Array.isArray(result?.receipts) ? result.receipts.length : 0;
    await appendWorkflowEvent(paths, {
      eventType: "telegram.outbox.delivery.executed",
      status,
      workflowId,
      traceId: input.traceId || input.trace_id || "",
      actor: firstText(input.actor, input.createdBy, input.created_by, "workflow"),
      sourceRuntime: "workflow",
      sourceAgent: firstText(input.sourceAgent, input.source_agent, input.actor, "workflow"),
      nextState: status,
      artifactRef: outboxId,
      payload: redactSensitiveForPersistence({
        outboxId,
        idempotencyKey,
        messageType: preview.messageType,
        targetKind: preview.targetKind,
        targetRef: preview.targetRef,
        account: preview.account,
        deliveryStatus: status,
        receiptCount: deliveryReceiptCount,
        receiptPolicy: preview.receiptPolicy,
        result
      })
    });
    return {
      schemaVersion: "telegram_outbox_delivery_result.v1",
      action: "telegram.outbox.delivery",
      writeBoundary: "telegram_delivery_only",
      outboxId,
      meetingId: preview.meetingId,
      messageType: preview.messageType,
      account: preview.account,
      targetKind: preview.targetKind,
      targetRef: preview.targetRef,
      deliveryStatus: status,
      didClaimOutbox: !result?.skipped,
      didSendTelegram: status === "sent",
      didUpdateOutbox: ["sent", "failed"].includes(status),
      didUpdateMessageFlow: preview.receiptPolicy?.messageFlowSync === "required_after_terminal_delivery" && ["sent", "failed"].includes(status),
      didTouchTradingState: false,
      receiptCount: deliveryReceiptCount,
      receiptPolicy: preview.receiptPolicy,
      executionPolicy: {
        ...preview.executionPolicy,
        previewOnly: false
      },
      result: redactSensitiveForPersistence(result),
      dbFile: paths.dbFile
    };
  }

  async function telegramOutbox(rootDir, input = {}) {
    const paths = await ensureWorkflowLayout(rootDir, input);
    if (input.operation === "deliver" || input.deliver) {
      const limit = Math.max(1, Math.min(20, Number(input.limit || 5)));
      const outboxId = String(input.outboxId || input.outbox_id || "").trim();
      const status = String(input.status || "queued").trim();
      const staleDeliveringBefore = new Date(Date.now() - TELEGRAM_OUTBOX_DELIVERY_LEASE_MS).toISOString();
      const statusWhere = status === "queued"
        ? `(status='queued' OR (status='delivering' AND updated_at <= ${sqlValue(staleDeliveringBefore)}))`
        : `status=${sqlValue(status)}`;
      const where = outboxId ? `outbox_id=${sqlValue(outboxId)}` : statusWhere;
      const rows = await sqlite(paths.dbFile, `
SELECT * FROM telegram_outbox
WHERE ${where}
ORDER BY created_at
LIMIT ${limit};`, { json: true });
      const results = [];
      for (const row of rows) {
        results.push(await deliverTelegramOutboxRow(paths, row, input));
      }
      return { operation: "deliver", count: rows.length, results, dbFile: paths.dbFile };
    }
    if (input.operation === "mark" || input.operation === "update") {
      const outboxId = String(input.outboxId || input.outbox_id || "").trim();
      if (!outboxId) throw new Error("outboxId is required");
      const status = String(input.status || "sent").trim();
      const updatedAt = nowIso();
      await sqlite(paths.dbFile, `UPDATE telegram_outbox SET status=${sqlValue(status)}, updated_at=${sqlValue(updatedAt)} WHERE outbox_id=${sqlValue(outboxId)};`);
      const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE outbox_id=${sqlValue(outboxId)} LIMIT 1;`, { json: true });
      let messageFlowSync = null;
      if (rows[0] && ["sent", "failed"].includes(status)) {
        messageFlowSync = await updateMessageFlowFromTelegramDelivery(paths, rows[0], {
          outboxId,
          status,
          target: rows[0].target_ref || "",
          manual: true,
          updatedAt
        });
      }
      return { outboxId, status, messageFlowSync, dbFile: paths.dbFile };
    }
    const limit = Math.max(1, Math.min(200, Number(input.limit || 20)));
    const status = String(input.status || "queued").trim();
    const rows = await sqlite(paths.dbFile, `SELECT * FROM telegram_outbox WHERE status=${sqlValue(status)} ORDER BY created_at LIMIT ${limit};`, { json: true });
    return { status, count: rows.length, rows, dbFile: paths.dbFile };
  }

  return {
    autoDeliverReportOutbox,
    deliverTelegramOutboxRow,
    enqueueTelegramOutbox,
    telegramOutboxDeliveryPreview,
    telegramOutboxRequeuePreview,
    telegramOutboxRequeueExecutionPackagePreview,
    telegramOutboxDelivery,
    telegramOutbox
  };
}
