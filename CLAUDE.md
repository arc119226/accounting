# 柴米帳（zhangben）— 雙人記帳 PWA

夫妻兩人用的 local-first 記帳 PWA：帳本存瀏覽器 IndexedDB、WebRTC 面對面同步（Trystero/Nostr signaling）、
掃台灣電子發票雙 QR 自動記帳、手寫 SVG 統計圖、宣紙水墨 UI（設計系統移植自 C:\gitcode\super-reversi2）。
完整規劃見 C:\Users\ptx48\.claude\plans\pwa-ethereal-key.md。

## 結構

- `packages/core`（@zhangben/core）— 純領域邏輯：types / hlc / merge / einvoice / stats / budget / categories / money / rocdate。
  **零依賴、零 I/O、決定論**（ESLint 機器強制：禁 window/fetch/localStorage/Math.random/Date.now/crypto；
  牆鐘一律以 `wallMs` 參數餵入、id 由 client/ids.ts 產好傳入）。源碼級 exports，無 build step。
- `packages/client`（@zhangben/client）— React 18 + Vite + Zustand PWA。
  - 無 router：store 內 `screen` 字串 + App.tsx 切換 + `key={screen}` 重播進場動畫
  - Zustand 單 store + slices，手動 localStorage/IDB 持久化（無 persist middleware）
  - `db/repo.ts` 是 IndexedDB 唯一寫入口；合併邏輯只住 core/merge.ts（全 app 僅此一份）
  - `strings/zh-Hant.ts` 是顯示文字正典（零 import 葉檔，ESLint 強制）

## 鐵律

- **金額 = 整數新台幣元**；所有金額欄位 `font-variant-numeric: tabular-nums`
- **每筆可同步資料都帶 Syncable 信封** `{id, updatedAt(HLC 字串), deviceId, deleted}`；刪除=墓碑，不物理刪
- styles.css 是純 @import barrel，**順序即契約**（test/styles.test.ts 鎖順序 + 檢查 CSS url() 資產存在）
- 每個畫面資產都要有回退（圖 → 漸層 → 純色，一行 background 疊層）
- 註解寫「為什麼」，繁體中文；禁：霓虹色、科技感漸層、glassmorphism、emoji 濫用、簡體字

## 指令

- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint`（root 一律可跑）
- 部署（M5 後）：`pnpm build && npx wrangler deploy`
