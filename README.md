# 籌碼日報 GitHub Pages 版

這是一個不需要伺服器、可直接放在 GitHub Pages 的純 HTML 網站。畫面由 `index.html`、`styles.css`、`app.js` 組成；GitHub Actions 每個交易日自動更新 `data/market.json`。

## 上架步驟

1. 在 GitHub 建立一個新的 Public repository，例如 `taiwan-market-daily`。
2. 把本資料夾**裡面的所有檔案**上傳到 repository 根目錄；必須連同 `.github` 與 `.nojekyll` 一起上傳。
3. 進入 repository 的 **Settings → Pages**。
4. 在 **Build and deployment → Source** 選擇 **GitHub Actions**。
5. 進入 **Settings → Actions → General → Workflow permissions**，選擇 **Read and write permissions** 並儲存。
6. 進入 **Actions → 每日更新市場資料 → Run workflow**，先手動執行一次；它會取得最新資料並發佈網站。

幾分鐘後，GitHub Pages 會提供類似下列網址：

`https://您的帳號.github.io/taiwan-market-daily/`

## 自動更新時間

- 台灣時間週一至週五 16:30：更新台股收盤資料。
- 台灣時間週二至週六 06:30：更新美股最近交易日資料。
- 也可以隨時在 GitHub 的 Actions 頁面按 **Run workflow** 手動更新。

若第一次自動執行發生 Pages 尚未設定的錯誤，完成上述第 4 步後，再到 Actions 按一次 **Run workflow** 即可。

## 檔案用途

- `index.html`：網頁結構。
- `styles.css`：桌面與手機版樣式。
- `app.js`：畫面、計算及市場解讀。
- `scripts/update-data.mjs`：抓取臺灣證券交易所及美股指數資料。
- `.github/workflows/update-market.yml`：自動更新排程。
- `data/market.json`：網站實際讀取的最新資料。

資料內容僅供市場觀察，不構成投資建議。
