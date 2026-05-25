import { get, put } from "@vercel/blob";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const USERS = ["T", "A", "C"];
const SPLITS = ["all", "ta"];
const RECORD_TYPES = ["transaction", "settlement"];
const BLOB_STORE_NAME = "AccountRecords";
const BLOB_PATH = `${BLOB_STORE_NAME}/transactions.json`;
const LOCAL_STORE = join(tmpdir(), "account-record-transactions.json");

function blobToken() {
  return (
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.ACCOUNTRECORDS_READ_WRITE_TOKEN ||
    process.env.ACCOUNTRECORDS_BLOB_READ_WRITE_TOKEN ||
    process.env.ACCOUNT_RECORDS_READ_WRITE_TOKEN ||
    process.env.ACCOUNT_RECORDS_BLOB_READ_WRITE_TOKEN ||
    process.env.VERCEL_BLOB_READ_WRITE_TOKEN ||
    ""
  );
}

function tokenSource() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "BLOB_READ_WRITE_TOKEN";
  if (process.env.ACCOUNTRECORDS_READ_WRITE_TOKEN) return "ACCOUNTRECORDS_READ_WRITE_TOKEN";
  if (process.env.ACCOUNTRECORDS_BLOB_READ_WRITE_TOKEN) return "ACCOUNTRECORDS_BLOB_READ_WRITE_TOKEN";
  if (process.env.ACCOUNT_RECORDS_READ_WRITE_TOKEN) return "ACCOUNT_RECORDS_READ_WRITE_TOKEN";
  if (process.env.ACCOUNT_RECORDS_BLOB_READ_WRITE_TOKEN) return "ACCOUNT_RECORDS_BLOB_READ_WRITE_TOKEN";
  if (process.env.VERCEL_BLOB_READ_WRITE_TOKEN) return "VERCEL_BLOB_READ_WRITE_TOKEN";
  return "";
}

function blobAccessOptions() {
  const configured = process.env.BLOB_ACCESS;
  if (configured === "private") return ["private", "public"];
  if (configured === "public") return ["public", "private"];
  return ["private", "public"];
}

function isAccessRetryable(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("400") || message.includes("Bad Request") || message.includes("access");
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function fromCents(value) {
  return roundMoney(value / 100);
}

function weekStart(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) {
    throw new Error("交易日期格式不正确");
  }

  const monday = new Date(date);
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function emptyTotals() {
  return Object.fromEntries(
    USERS.map((user) => [user, { paid: 0, share: 0, payable: 0, receivable: 0, net: 0 }])
  );
}

function normalizeTransaction(tx) {
  const type = RECORD_TYPES.includes(tx?.type) ? tx.type : "transaction";
  const amount = type === "settlement" ? 0 : roundMoney(tx?.amount);
  const payer = tx?.payer;
  const split = tx?.split;
  const date = tx?.date;
  const id = String(tx?.id || "").trim();
  const note = String(tx?.note || "").trim();
  const createdAt = tx?.createdAt && !Number.isNaN(new Date(tx.createdAt).getTime()) ? tx.createdAt : date;

  if (!id) throw new Error("交易缺少 id");
  if (!date || Number.isNaN(new Date(date).getTime())) throw new Error("交易日期不能为空");

  if (type === "settlement") {
    return { id, type, amount, note: note || "结算", date, createdAt };
  }

  if (!USERS.includes(payer)) throw new Error("付款人只能是 T、A 或 C");
  if (!SPLITS.includes(split)) throw new Error("分摊方式只能是 all 或 ta");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("金额必须大于 0");

  return { id, type, amount, payer, split, note, date, createdAt };
}

function applyTransactionToTotals(totals, normalized) {
  const participants = normalized.split === "all" ? USERS : ["T", "A"];
  const cents = toCents(normalized.amount);
  const baseShare = Math.floor(cents / participants.length);
  const remainder = cents % participants.length;

  totals[normalized.payer].paid += cents;
  participants.forEach((user, index) => {
    totals[user].share += baseShare + (index < remainder ? 1 : 0);
  });
}

function finalizeTotals(totals) {
  return Object.fromEntries(
    USERS.map((user) => {
      const paid = totals[user].paid;
      const share = totals[user].share;
      const net = share - paid;
      return [
        user,
        {
          paid: fromCents(paid),
          share: fromCents(share),
          payable: fromCents(Math.max(net, 0)),
          receivable: fromCents(Math.max(-net, 0)),
          net: fromCents(net),
        },
      ];
    })
  );
}

function calculateWeekly(transactions) {
  const weeks = new Map();

  for (const tx of transactions) {
    let normalized;
    try {
      normalized = normalizeTransaction(tx);
    } catch {
      continue;
    }
    if (normalized.type === "settlement") continue;

    const week = weekStart(normalized.date);
    const totals = weeks.get(week) || emptyTotals();
    applyTransactionToTotals(totals, normalized);
    weeks.set(week, totals);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([week, totals]) => ({
      weekStart: week,
      totals: finalizeTotals(totals),
    }));
}

function calculateCurrentTotals(transactions) {
  const latestSettlement = transactions
    .filter((tx) => tx.type === "settlement")
    .map((tx) => tx.createdAt || tx.date)
    .sort((a, b) => String(b).localeCompare(String(a)))[0];
  const totals = emptyTotals();

  for (const tx of transactions) {
    let normalized;
    try {
      normalized = normalizeTransaction(tx);
    } catch {
      continue;
    }
    if (normalized.type === "settlement") continue;
    if (latestSettlement && String(normalized.createdAt || normalized.date) <= String(latestSettlement)) continue;
    applyTransactionToTotals(totals, normalized);
  }

  return finalizeTotals(totals);
}

async function streamToText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

async function readLocalTransactions() {
  try {
    return JSON.parse(await readFile(LOCAL_STORE, "utf8"));
  } catch {
    return [];
  }
}

async function writeLocalTransactions(transactions) {
  await writeFile(LOCAL_STORE, JSON.stringify(transactions, null, 2), "utf8");
}

async function readBlobTransactions() {
  const token = blobToken();
  if (!token) {
    if (process.env.VERCEL) {
      throw new Error("Vercel Blob token 未配置，请检查 BLOB_READ_WRITE_TOKEN 或 ACCOUNTRECORDS_READ_WRITE_TOKEN");
    }
    return readLocalTransactions();
  }

  let lastError;
  for (const access of blobAccessOptions()) {
    try {
      const result = await get(BLOB_PATH, { access, token, useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) {
        return [];
      }

      const text = await streamToText(result.stream);
      if (!text.trim()) {
        return [];
      }

      const data = JSON.parse(text);
      return Array.isArray(data.transactions) ? data.transactions : [];
    } catch (error) {
      lastError = error;
      if (!isAccessRetryable(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function writeBlobTransactions(transactions) {
  const token = blobToken();
  if (!token) {
    if (process.env.VERCEL) {
      throw new Error("Vercel Blob token 未配置，请检查 BLOB_READ_WRITE_TOKEN 或 ACCOUNTRECORDS_READ_WRITE_TOKEN");
    }
    await writeLocalTransactions(transactions);
    return;
  }

  let lastError;
  for (const access of blobAccessOptions()) {
    try {
      await put(BLOB_PATH, JSON.stringify({ transactions }, null, 2), {
        access,
        token,
        contentType: "application/json; charset=utf-8",
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 60,
      });
      return;
    } catch (error) {
      lastError = error;
      if (!isAccessRetryable(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function listTransactions() {
  const transactions = await readBlobTransactions();
  return transactions
    .map((tx) => {
      try {
        return normalizeTransaction(tx);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const createdCompare = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      return createdCompare || String(b.date || "").localeCompare(String(a.date || ""));
    });
}

async function addTransaction(tx) {
  const normalized = normalizeTransaction(tx);
  const transactions = (await listTransactions()).filter((item) => item.id !== normalized.id);
  transactions.unshift(normalized);
  await writeBlobTransactions(transactions);
}

async function deleteTransaction(id) {
  const txId = String(id || "").trim();
  if (!txId) throw new Error("缺少要删除的交易 id");

  const transactions = (await listTransactions()).filter((item) => item.id !== txId);
  await writeBlobTransactions(transactions);
}

async function ledgerPayload() {
  const transactions = await listTransactions();
  return {
    transactions,
    weeks: calculateWeekly(transactions),
    currentTotals: calculateCurrentTotals(transactions),
    database: blobToken() ? "vercel-blob" : "local-file",
    tokenSource: tokenSource(),
    accessOptions: blobAccessOptions(),
    store: BLOB_STORE_NAME,
    path: BLOB_PATH,
  };
}

function sendJson(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string" && req.body.trim()) {
    return JSON.parse(req.body);
  }

  return {};
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, await ledgerPayload());
      return;
    }

    if (req.method === "POST") {
      const payload = requestBody(req);
      await addTransaction(payload.transaction || payload);
      sendJson(res, 200, await ledgerPayload());
      return;
    }

    if (req.method === "DELETE") {
      await deleteTransaction(req.query?.id);
      sendJson(res, 200, await ledgerPayload());
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : "账本请求失败" });
  }
}
