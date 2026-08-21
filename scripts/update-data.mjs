import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(new URL("../data/market.json", import.meta.url));
const existing = JSON.parse(await readFile(outputPath, "utf8"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const numeric = (value) => Number(String(value ?? "0").replaceAll(",", ""));

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

function recentTaiwanDates() {
  return Array.from({ length: 10 }, (_, offset) => {
    const date = new Date(Date.now() + 8 * 60 * 60 * 1000);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10).replaceAll("-", "");
  });
}

async function fetchTaiwan() {
  for (const date of recentTaiwanDates()) {
    try {
      const base = "https://www.twse.com.tw/rwd/zh";
      const [bfi, index, stats, margin] = await Promise.all([
        fetchJson(`${base}/fund/BFI82U?date=${date}&response=json`),
        fetchJson(`${base}/afterTrading/MI_INDEX?date=${date}&type=IND&response=json`),
        fetchJson(`${base}/afterTrading/MI_INDEX?date=${date}&type=MS&response=json`),
        fetchJson(`${base}/marginTrading/MI_MARGN?date=${date}&selectType=MS&response=json`)
      ]);
      if (bfi.stat !== "OK" || index.stat !== "OK" || !bfi.data?.length) continue;
      const institutional = (label, startsWith = false) => bfi.data
        .filter((row) => startsWith ? row[0]?.startsWith(label) : row[0]?.includes(label))
        .reduce((sum, row) => sum + numeric(row[3]), 0) / 100_000_000;
      const indexRow = index.tables?.flatMap((table) => table.data ?? []).find((row) => row[0] === "發行量加權股價指數");
      const marketTable = stats.tables?.find((table) => table.title?.includes("大盤統計資訊"));
      const breadthTable = stats.tables?.find((table) => table.title?.includes("漲跌證券數合計"));
      const securities = marketTable?.data?.find((row) => row[0]?.startsWith("證券合計"));
      const up = breadthTable?.data?.find((row) => row[0]?.startsWith("上漲"));
      const down = breadthTable?.data?.find((row) => row[0]?.startsWith("下跌"));
      const marginRow = margin.tables?.flatMap((table) => table.data ?? []).find((row) => row[0]?.includes("融資金額"));
      if (!indexRow || !securities || !marginRow) continue;
      const marginPrevious = numeric(marginRow[4]) / 100_000;
      const marginCurrent = numeric(marginRow[5]) / 100_000;
      const sign = indexRow[2]?.includes("-") ? -1 : 1;
      return {
        date: `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6)}`,
        market: {
          close: numeric(indexRow[1]),
          change: sign * Math.abs(numeric(indexRow[3])),
          changePct: sign * Math.abs(numeric(indexRow[4])),
          turnover: numeric(securities[1]) / 100_000_000,
          advances: Number(up?.[2]?.split("(")[0] ?? 0),
          declines: Number(down?.[2]?.split("(")[0] ?? 0),
          limitDown: Number(down?.[2]?.match(/\((\d+)\)/)?.[1] ?? 0)
        },
        institutions: {
          foreign: institutional("外資及陸資"),
          trust: institutional("投信"),
          dealer: institutional("自營商", true),
          total: institutional("合計")
        },
        margin: {
          balance: marginCurrent,
          change: marginCurrent - marginPrevious,
          changePct: marginPrevious ? (marginCurrent - marginPrevious) / marginPrevious * 100 : 0
        }
      };
    } catch (error) {
      console.warn(`TWSE ${date} 無可用資料：${error.message}`);
    }
  }
  throw new Error("最近十日均無法取得台股日結資料");
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
  return Object.entries(labels).map(([symbol, [name, code, note]]) => {
    const response = rows.get(symbol);
    const closes = (response?.indicators?.quote?.[0]?.close ?? []).filter((value) => typeof value === "number");
    const close = closes.length ? closes[closes.length - 1] : null;
    const previous = closes.length >= 2 ? closes[closes.length - 2] : null;
    const pointChange = close != null && previous != null ? close - previous : null;
    return { name, code, close, pointChange, change: pointChange != null && previous ? pointChange / previous * 100 : null, note };
  });
}

const next = { ...existing };
let updated = false;
try {
  Object.assign(next, await fetchTaiwan());
  updated = true;
} catch (error) {
  console.error(`台股更新失敗，保留原資料：${error.message}`);
}
try {
  next.indices = await fetchUnitedStates();
  updated = true;
} catch (error) {
  console.error(`美股更新失敗，保留原資料：${error.message}`);
}
if (!updated) throw new Error("本次未取得任何新資料");
next.fetchedAt = new Date().toISOString();
await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`市場資料已更新：${next.date}`);
