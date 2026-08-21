import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(new URL("../data/market.json", import.meta.url));
const existing = JSON.parse(await readFile(outputPath, "utf8"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numericOrNull(value) {
  if (value == null || String(value).trim() === "" || String(value).trim() === "--") return null;
  const parsed = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function requireNumber(value, label) {
  const parsed = numericOrNull(value);
  if (parsed == null) throw new Error(`${label} 缺少有效數值`);
  return parsed;
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "Mozilla/5.0 GitHub-Actions market-dashboard" }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 1500);
    }
  }
  throw lastError;
}

function taipeiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replaceAll("-", "");
}

function displayDate(date) {
  return `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6)}`;
}

function comparableDate(date) {
  return String(date ?? "").replaceAll("/", "").replaceAll("-", "");
}

function recentTaiwanDates() {
  return Array.from({ length: 10 }, (_, offset) => {
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10).replaceAll("-", "");
  });
}

async function firstAvailable(name, fetchForDate) {
  for (const date of recentTaiwanDates()) {
    try {
      const value = await fetchForDate(date);
      if (value) return { dataDate: displayDate(date), value };
    } catch (error) {
      console.warn(`${name} ${date} 無可用資料：${error.message}`);
    }
  }
  throw new Error(`${name} 最近十日均無可用資料`);
}

async function fetchMarket() {
  return firstAvailable("台股收盤", async (date) => {
    const base = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";
    const [index, stats] = await Promise.all([
      fetchJson(`${base}?date=${date}&type=IND&response=json`),
      fetchJson(`${base}?date=${date}&type=MS&response=json`)
    ]);
    if (index.stat !== "OK" || stats.stat !== "OK") return null;
    const indexRow = index.tables?.flatMap((table) => table.data ?? []).find((row) => row[0] === "發行量加權股價指數");
    const marketTable = stats.tables?.find((table) => table.title?.includes("大盤統計資訊"));
    const breadthTable = stats.tables?.find((table) => table.title?.includes("漲跌證券數合計"));
    const securities = marketTable?.data?.find((row) => row[0]?.startsWith("證券合計"));
    const up = breadthTable?.data?.find((row) => row[0]?.startsWith("上漲"));
    const down = breadthTable?.data?.find((row) => row[0]?.startsWith("下跌"));
    if (!indexRow || !securities || !up || !down) return null;
    const sign = indexRow[2]?.includes("-") ? -1 : 1;
    return {
      close: requireNumber(indexRow[1], "加權指數"),
      change: sign * Math.abs(requireNumber(indexRow[3], "指數漲跌點")),
      changePct: sign * Math.abs(requireNumber(indexRow[4], "指數漲跌幅")),
      turnover: requireNumber(securities[1], "成交金額") / 100_000_000,
      advances: requireNumber(up[2]?.split("(")[0], "上漲家數"),
      declines: requireNumber(down[2]?.split("(")[0], "下跌家數"),
      limitDown: requireNumber(down[2]?.match(/\((\d+)\)/)?.[1] ?? 0, "跌停家數")
    };
  });
}

async function fetchInstitutions() {
  return firstAvailable("三大法人", async (date) => {
    const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?date=${date}&response=json`);
    if (payload.stat !== "OK" || !payload.data?.length) return null;
    const institutional = (label, startsWith = false) => {
      const matches = payload.data.filter((row) => startsWith ? row[0]?.startsWith(label) : row[0]?.includes(label));
      if (!matches.length) throw new Error(`${label} 資料不存在`);
      return matches.map((row) => requireNumber(row[3], `${label} 買賣超`)).reduce((sum, value) => sum + value, 0) / 100_000_000;
    };
    return {
      foreign: institutional("外資及陸資"),
      trust: institutional("投信"),
      dealer: institutional("自營商", true),
      total: institutional("合計")
    };
  });
}

async function fetchMargin() {
  return firstAvailable("融資", async (date) => {
    const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${date}&selectType=MS&response=json`);
    if (payload.stat !== "OK") return null;
    const row = payload.tables?.flatMap((table) => table.data ?? []).find((item) => item[0]?.includes("融資金額"));
    if (!row) return null;
    const previous = requireNumber(row[4], "前日融資餘額") / 100_000;
    const current = requireNumber(row[5], "今日融資餘額") / 100_000;
    return { balance: current, change: current - previous, changePct: previous ? (current - previous) / previous * 100 : null };
  });
}

async function fetchUnitedStates() {
  const labels = {
    "^GSPC": ["S&P 500", "SPX", "美國大盤風險偏好"],
    "^IXIC": ["NASDAQ", "IXIC", "科技與 AI 風險偏好"],
    "^DJI": ["Dow Jones", "DJI", "大型價值與景氣股"],
    "^SOX": ["SOX 費半", "SOX", "台灣半導體供應鏈前導"]
  };
  const symbols = Object.keys(labels).join(",");
  let payload;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      payload = await fetchJson(`https://${host}/v7/finance/spark?symbols=${encodeURIComponent(symbols)}&range=5d&interval=1d`);
      if (payload.spark?.result?.length) break;
    } catch (error) {
      console.warn(`${host} 無可用資料：${error.message}`);
    }
  }
  if (!payload?.spark?.result?.length) throw new Error("無法取得美股指數資料");
  const rows = new Map(payload.spark.result.map((item) => [item.symbol, item.response?.[0]]));
  let latestTimestamp = 0;
  const indices = Object.entries(labels).map(([symbol, [name, code, note]]) => {
    const response = rows.get(symbol);
    const points = (response?.timestamp ?? []).map((timestamp, index) => ({ timestamp, close: response?.indicators?.quote?.[0]?.close?.[index] })).filter((point) => typeof point.close === "number");
    const latest = points.at(-1);
    const previous = points.at(-2);
    if (!latest || !previous) throw new Error(`${code} 缺少足夠收盤資料`);
    latestTimestamp = Math.max(latestTimestamp, latest.timestamp ?? 0);
    const pointChange = latest.close - previous.close;
    return { name, code, close: latest.close, pointChange, change: previous.close ? pointChange / previous.close * 100 : null, note };
  });
  const dataDate = latestTimestamp
    ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(latestTimestamp * 1000)).replaceAll("-", "/")
    : null;
  return { dataDate, value: indices };
}

const next = { ...existing, sources: { ...(existing.sources ?? {}) } };
let updated = false;

function shouldAdopt(source, dataDate) {
  const existingDate = comparableDate(next.sources[source]?.dataDate ?? (source === "market" ? next.date : null));
  const candidateDate = comparableDate(dataDate);
  if (!existingDate) return true;
  if (candidateDate > existingDate) return true;
  return candidateDate === existingDate && candidateDate === taipeiDate();
}

function adopt(source, field, result) {
  if (!result?.value || !shouldAdopt(source, result.dataDate)) {
    console.log(`${source} 未出現較新的資料，保留既有有效值`);
    return;
  }
  next[field] = result.value;
  next.sources[source] = { dataDate: result.dataDate, fetchedAt: new Date().toISOString() };
  if (source === "market") next.date = result.dataDate;
  updated = true;
}

for (const [source, field, getter] of [
  ["market", "market", fetchMarket],
  ["institutions", "institutions", fetchInstitutions],
  ["margin", "margin", fetchMargin],
  ["us", "indices", fetchUnitedStates]
]) {
  try {
    adopt(source, field, await getter());
  } catch (error) {
    console.error(`${source} 更新失敗，保留原資料：${error.message}`);
  }
}

if (!updated) {
  console.log("本次來源尚未公布新資料，資料檔維持不變");
} else {
  next.fetchedAt = new Date().toISOString();
  await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(`市場資料已更新：${next.date}`);
}

