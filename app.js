const byId = (id) => document.getElementById(id);
const number = (value, digits = 1) => value == null || Number.isNaN(value) ? "—" : new Intl.NumberFormat("zh-TW", { maximumFractionDigits: digits }).format(value);
const signed = (value, unit = "") => value == null ? "—" : `${value >= 0 ? "+" : ""}${number(value)}${unit}`;
const tone = (value) => value == null ? "" : value < 0 ? "negative" : "positive";
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function sourceMeta(data, key) {
  return data.sources?.[key] ?? { dataDate: data.date, fetchedAt: data.fetchedAt };
}

function metaLine(data, key) {
  const meta = sourceMeta(data, key);
  const acquired = meta.fetchedAt
    ? new Date(meta.fetchedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    : "—";
  const sourceDate = String(meta.dataDate ?? "").replace(/\D/g, "");
  const marketDate = String(data.date ?? "").replace(/\D/g, "");
  const stale = sourceDate && marketDate && sourceDate < marketDate;
  return `<span class="data-meta${stale ? " stale" : ""}">資料日 ${escapeHtml(meta.dataDate ?? "—")} · 取得 ${escapeHtml(acquired)}${stale ? " · 沿用舊值" : ""}</span>`;
}

const cleanDate = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 8);
const hasNumbers = (object, keys) => keys.every((key) => Number.isFinite(Number(object?.[key])));
const signalLabel = (score) => score >= 4 ? "偏多" : score >= 1.5 ? "中性偏多" : score <= -4 ? "偏空" : score <= -1.5 ? "中性偏空" : "中性";

function makeAnalysis(data) {
  const m = data.market ?? {}, i = data.institutions ?? {}, mg = data.margin ?? {};
  const marketDate = sourceMeta(data, "market").dataDate ?? data.date;
  const institutionDate = sourceMeta(data, "institutions").dataDate ?? data.date;
  const marginDate = sourceMeta(data, "margin").dataDate ?? data.date;
  const usDate = sourceMeta(data, "us").dataDate ?? data.date;
  const twComplete = hasNumbers(m, ["close", "changePct", "advances", "declines"]) && hasNumbers(i, ["foreign", "trust", "total"]) && hasNumbers(mg, ["balance", "change"]);
  const usComplete = Array.isArray(data.indices) && ["SPX", "IXIC", "DJI", "SOX"].every((code) => hasNumbers(data.indices.find((item) => item.code === code), ["close", "change"]));
  const twDatesAligned = [institutionDate, marginDate].every((date) => !cleanDate(date) || cleanDate(date) === cleanDate(marketDate));
  const datesPaired = cleanDate(marketDate) && cleanDate(marketDate) === cleanDate(usDate);

  let twScore = m.changePct >= 1 ? 2 : m.changePct > 0 ? 1 : m.changePct <= -1 ? -2 : m.changePct < 0 ? -1 : 0;
  twScore += m.advances > m.declines * 1.2 ? 1 : m.declines > m.advances * 1.2 ? -1 : 0;
  twScore += i.foreign > 0 ? 1 : i.foreign < 0 ? -1 : 0;
  twScore += i.trust > 0 ? .5 : i.trust < 0 ? -.5 : 0;
  twScore += i.total > 0 ? .5 : i.total < 0 ? -.5 : 0;
  twScore += mg.change > 0 && m.changePct < 0 ? -.5 : mg.change < 0 && m.changePct > 0 ? .5 : 0;

  const index = (code) => data.indices?.find((item) => item.code === code)?.change ?? 0;
  const usScore = index("SPX") + index("DJI") * .5 + index("IXIC") * 1.2 + index("SOX") * 1.5;
  const twReady = twComplete && twDatesAligned;
  const usReady = usComplete;
  const combinedReady = twReady && usReady && datesPaired;
  const twLabel = twReady ? signalLabel(twScore) : "等待台股資料齊全";
  const usLabel = usReady ? signalLabel(usScore) : "等待美股收盤";
  const combinedScore = twScore * .8 + usScore * .6;
  const combinedLabel = combinedReady ? signalLabel(combinedScore) : "等待台美資料配對";

  return {
    verdict: combinedLabel,
    taiwan: { label: twLabel, ready: twReady, date: `台股交易日：${marketDate ?? "—"}`, status: twReady ? "資料完整" : "資料未齊或日期不一致", reasons: [`指數 ${signed(m.changePct, "%")}，市場廣度 ${m.advances ?? "—"} 漲／${m.declines ?? "—"} 跌`, `外資 ${signed(i.foreign, " 億")}、投信 ${signed(i.trust, " 億")}`, `融資變化 ${signed(mg.change, " 億")}`] },
    us: { label: usLabel, ready: usReady, date: `美國交易日：${usDate ?? "—"}\n台灣時間次日清晨收盤`, status: usReady ? "四大指數資料完整" : "美股資料尚未完整", reasons: [`S&P 500 ${signed(index("SPX"), "%")}、道瓊 ${signed(index("DJI"), "%")}`, `NASDAQ ${signed(index("IXIC"), "%")}、費半 ${signed(index("SOX"), "%")}`, "NASDAQ 與費半對台股電子族群權重較高"] },
    combined: { label: combinedLabel, ready: combinedReady, date: `分析組合：台股 ${marketDate ?? "—"} ＋ 美股 ${usDate ?? "—"}`, status: combinedReady ? "台美訊號已完成" : "尚未產生新綜合訊號", reasons: combinedReady ? [`台股訊號：${twLabel}`, `美股訊號：${usLabel}`, `綜合判讀：${signalLabel(combinedScore)}`] : [`台股：${twReady ? "已完成" : "等待完整盤後資料"}`, `美股：${usReady ? "已完成" : "等待四大指數收盤"}`, datesPaired ? "交易日期已配對" : "台美交易日期尚未配對"] }
  };
}

function signalCard(title, signal, combined = false) {
  return `<article class="signal-card${combined ? " combined" : ""}"><p>${title}</p><h3>${escapeHtml(signal.label)}</h3><span class="signal-date">${escapeHtml(signal.date)}</span><span class="signal-status${signal.ready ? "" : " waiting"}">${escapeHtml(signal.status)}</span><ul>${signal.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></article>`;
}

function dataCard(label, value, sub, valueTone, meta) {
  return `<article class="data-card"><p>${label}</p><div class="data-value-row"><strong class="${valueTone ?? ""}">${value}</strong>${meta}</div><small>${sub}</small></article>`;
}

function render(data) {
  const analysis = makeAnalysis(data);
  byId("verdict").textContent = analysis.verdict;
  byId("market-date").textContent = data.date;
  byId("data-status").textContent = "日結資料已更新";
  const updated = data.fetchedAt ? new Date(data.fetchedAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "—";
  byId("updated-at").textContent = `資料檔更新：${updated}`;
  byId("signal-grid").innerHTML = [signalCard("TAIWAN SIGNAL｜台股訊號", analysis.taiwan), signalCard("US SIGNAL｜美股訊號", analysis.us), signalCard("COMBINED SIGNAL｜台美綜合", analysis.combined, true)].join("");
  const m = data.market, i = data.institutions, mg = data.margin;
  const marketMeta = metaLine(data, "market");
  const institutionMeta = metaLine(data, "institutions");
  const marginMeta = metaLine(data, "margin");
  byId("tw-cards").innerHTML = [
    dataCard("加權指數", number(m.close, 2), `${signed(m.change, " 點")}｜${signed(m.changePct, "%")}`, tone(m.changePct), marketMeta),
    dataCard("成交金額", number(m.turnover), "上市股票成交金額", "", marketMeta),
    dataCard("外資", signed(i.foreign, " 億"), "買賣超金額", tone(i.foreign), institutionMeta),
    dataCard("投信", signed(i.trust, " 億"), "買賣超金額", tone(i.trust), institutionMeta),
    dataCard("自營商", signed(i.dealer, " 億"), "自行買賣＋避險", tone(i.dealer), institutionMeta),
    dataCard("融資餘額", `${number(mg.balance)} 億`, `今日變化 ${signed(mg.change, " 億")}`, tone(-mg.change), marginMeta)
  ].join("");
  byId("breadth").innerHTML = `上漲 <b>${m.advances}</b> 家　下跌 <b>${m.declines}</b> 家　跌停 <b>${m.limitDown}</b> 家 ${marketMeta}`;
  const usMeta = metaLine(data, "us");
  byId("us-cards").innerHTML = data.indices.map((item) => `<article class="index-card"><div><span class="market-dot ${item.change == null ? "flat" : item.change >= 0 ? "up" : "down"}"></span><b>${item.name}</b><em>${item.code}</em></div><strong>${number(item.close, 2)}</strong><p class="${tone(item.change)}">${item.change == null ? "—" : `${signed(item.pointChange, " 點")}｜${signed(item.change, "%")}`}</p><small>${item.note}</small>${usMeta}</article>`).join("");
}

function mountTradingView(containerId, scriptName, config) {
  const container = byId(containerId);
  container.replaceChildren();
  const widget = document.createElement("div");
  widget.className = "tradingview-widget-container";
  widget.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
  const script = document.createElement("script");
  script.src = `https://s3.tradingview.com/external-embedding/${scriptName}`;
  script.async = true;
  script.textContent = JSON.stringify(config);
  widget.appendChild(script);
  container.appendChild(widget);
}

function drawIntradayChart(points) {
  const canvas = byId("taiex-chart");
  const width = Math.max(canvas.clientWidth, 280);
  const height = Math.max(canvas.clientHeight, 210);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  if (!points?.length) return;
  const values = points.map((point) => point.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = Math.max(high - low, 1);
  const pad = { top: 18, right: 14, bottom: 24, left: 14 };
  const x = (index) => pad.left + index / Math.max(points.length - 1, 1) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (high - value) / spread * (height - pad.top - pad.bottom);
  context.strokeStyle = "#d8d7ce";
  context.lineWidth = 1;
  for (let row = 0; row < 4; row += 1) {
    const gridY = pad.top + row / 3 * (height - pad.top - pad.bottom);
    context.beginPath(); context.moveTo(pad.left, gridY); context.lineTo(width - pad.right, gridY); context.stroke();
  }
  const rising = values.at(-1) >= values[0];
  const lineColor = rising ? "#167461" : "#db5a42";
  const gradient = context.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, rising ? "rgba(22,116,97,.25)" : "rgba(219,90,66,.25)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
  context.lineTo(x(points.length - 1), height - pad.bottom); context.lineTo(x(0), height - pad.bottom); context.closePath();
  context.fillStyle = gradient; context.fill();
  context.beginPath();
  points.forEach((point, index) => index ? context.lineTo(x(index), y(point.value)) : context.moveTo(x(index), y(point.value)));
  context.strokeStyle = lineColor; context.lineWidth = 2; context.stroke();
  context.fillStyle = "#66716b"; context.font = '11px "DM Mono", monospace';
  context.fillText(number(low, 0), pad.left, height - 6);
  const highText = number(high, 0); context.fillText(highText, width - pad.right - context.measureText(highText).width, 12);
}

async function loadIntraday() {
  const error = byId("live-index-error");
  error.hidden = true;
  try {
    const response = await fetch(`data/intraday.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("盤中資料檔尚未建立");
    const data = await response.json();
    if (data.price == null || !data.points?.length) throw new Error("盤中資料尚未取得");
    byId("live-index-price").textContent = number(data.price, 2);
    byId("live-index-change").textContent = `${signed(data.change, " 點")}｜${signed(data.changePct, "%")}`;
    byId("live-index-change").className = tone(data.change);
    const quoteTime = data.quoteTime ? new Date(data.quoteTime).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "—";
    byId("live-index-time").textContent = `最後行情時間：${quoteTime}｜約每 10 分鐘更新`;
    drawIntradayChart(data.points);
  } catch (reason) {
    byId("live-index-price").textContent = "—";
    byId("live-index-change").textContent = "暫無可用盤中資料";
    error.textContent = `${reason instanceof Error ? reason.message : "讀取失敗"}；日結數值仍保留於上方 02 區。`;
    error.hidden = false;
    drawIntradayChart([]);
  }
}

function renderStockWidget() {
  const market = byId("stock-market").value;
  const code = byId("stock-code").value.trim().toUpperCase();
  const error = byId("stock-error");
  if (!/^[0-9A-Z]{2,10}$/.test(code)) {
    error.textContent = "請輸入 2～10 碼的股票代碼，例如 6147。";
    error.hidden = false;
    return;
  }
  error.hidden = true;
  mountTradingView("stock-chart", "embed-widget-advanced-chart.js", {
    autosize: true, symbol: `${market}:${code}`, interval: "5", range: "1D", timezone: "Asia/Taipei",
    theme: "light", style: "2", locale: "zh_TW", allow_symbol_change: true,
    withdateranges: false, hide_side_toolbar: true, details: false, calendar: false,
    support_host: "https://www.tradingview.com"
  });
}

function renderLiveWidgets() {
  loadIntraday();
  renderStockWidget();
}

async function load() {
  const button = byId("refresh");
  const error = byId("error");
  button.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch(`data/market.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("無法讀取資料檔");
    render(await response.json());
  } catch (reason) {
    byId("verdict").textContent = "資料暫時無法讀取";
    byId("data-status").textContent = "請稍後再試";
    error.textContent = reason instanceof Error ? reason.message : "資料讀取失敗";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

byId("refresh").addEventListener("click", () => {
  load();
  renderLiveWidgets();
});
byId("stock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  renderStockWidget();
});
renderLiveWidgets();
load();

