import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(new URL("../data/intraday.json", import.meta.url));
const previous = JSON.parse(await readFile(outputPath, "utf8"));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      if (attempt < attempts) await wait(attempt * 1200);
    }
  }
  throw lastError;
}

function validNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

async function fetchIntraday() {
  let payload;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      payload = await fetchJson(`https://${host}/v8/finance/chart/%5ETWII?interval=1m&range=1d`);
      if (payload.chart?.result?.[0]) break;
    } catch (error) {
      console.warn(`${host} 盤中資料失敗：${error.message}`);
    }
  }
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error(payload?.chart?.error?.description ?? "盤中來源沒有資料");
  const meta = result.meta ?? {};
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const points = (result.timestamp ?? [])
    .map((time, index) => ({ time, value: closes[index] }))
    .filter((point) => validNumber(point.time) && validNumber(point.value));
  if (!points.length) throw new Error("盤中來源沒有有效走勢點");
  const price = validNumber(meta.regularMarketPrice) ? meta.regularMarketPrice : points.at(-1).value;
  const previousClose = validNumber(meta.chartPreviousClose) ? meta.chartPreviousClose : meta.previousClose;
  if (!validNumber(price) || !validNumber(previousClose) || previousClose === 0) throw new Error("盤中來源缺少有效價格");
  return {
    symbol: "^TWII",
    name: "臺灣加權指數",
    price,
    previousClose,
    change: price - previousClose,
    changePct: (price - previousClose) / previousClose * 100,
    quoteTime: new Date((meta.regularMarketTime ?? points.at(-1).time) * 1000).toISOString(),
    fetchedAt: new Date().toISOString(),
    points
  };
}

try {
  const current = await fetchIntraday();
  await writeFile(outputPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  console.log(`盤中加權指數已更新：${current.price}`);
} catch (error) {
  console.error(`盤中更新失敗，保留上一筆有效資料：${error.message}`);
  if (!validNumber(previous.price)) process.exitCode = 1;
}

