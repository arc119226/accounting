# 柴米帳（zhangben）— 雙人記帳 PWA

給兩個人共用的 local-first 記帳 PWA：帳本存瀏覽器 IndexedDB、WebRTC 面對面同步（Trystero/Nostr signaling）、
掃台灣電子發票雙 QR 自動記帳、手寫 SVG 統計圖、宣紙／夜墨水墨 UI（設計系統移植自作者前作 super-reversi2）。

**動工前先讀 `docs/BACKLOG.md`**：前半是設計原則（憲法級的「不做什麼」——不做分帳、不做
「這個圈 N 天沒更新」這類提醒、永遠不清墓碑），後半是排序過的待辦與已知取捨。
原則會否決掉一整類看起來很合理的功能，而否決的理由過幾個月就會忘掉。

## 結構

- `packages/core`（@zhangben/core）— 純領域邏輯：types / hlc / merge / reconcile / einvoice / stats /
  budget / categories / notes / money / rocdate。
  **零依賴、零 I/O、決定論**（ESLint 機器強制：禁 window/fetch/localStorage/Math.random/Date.now/
  `new Date()`/Intl/localeCompare；牆鐘一律以 `wallMs` 參數餵入、id 由 client/ids.ts 產好傳入）。
  源碼級 exports，無 build step。
- `packages/client`（@zhangben/client）— React 18 + Vite + Zustand PWA。
  - 無 router：store 內 `screen` 字串 + App.tsx 切換 + `key={screen}` 重播進場動畫
  - Zustand 單 store + slices，手動 localStorage/IDB 持久化（無 persist middleware）
  - `db/repo.ts` 是 IndexedDB 唯一寫入口；合併**決策**只住 `sync/applyCore.ts`（core mergeAll+reconcile
    的唯一呼叫點，P2P 與檔案匯入共用）——決策在 zustand 函式型 set 內**同步**完成、落盤後置
    （快照競態防線）。落盤清單的**順序是契約**：reconcile 釋放發票號碼的列必須排在 mergeAll
    採納的列之前，否則同一號碼撞 by-invoice unique index、整批落盤失敗
  - `sync/rowSchema.ts` 是「進來的列合不合格」唯一一份（兩條入口共用），但處置**刻意不同**：
    檔案匯入整檔拒收、P2P 丟該列續收（整批失敗會讓一列壞資料永久卡死每天的同步）
  - `strings/zh-Hant.ts` 是顯示文字正典（零 import 葉檔，ESLint 強制）；`notice.ts` 是 app 殼層通知
    （零 import 葉檔，兩槽：sticky 放「有新版本」、current 放事件，事件優先、自退後 sticky 回來）
  - `theme.ts` 只決定「把哪個字串貼到 `<html>`」；token 住 base.css，首漆規則在 index.html 的內聯
    script（`resolveTheme` 是正典、內聯 script 是手抄本，styles.test.ts 鎖兩邊底色一致）

## 鐵律

- **金額 = 整數新台幣元**；所有金額欄位 `font-variant-numeric: tabular-nums`
- **每筆可同步資料都帶 Syncable 信封** `{id, updatedAt(HLC 字串), deviceId, deleted}`；刪除=墓碑，不物理刪
- **不改寫既有資料**。任何「順手補個欄位／正規化舊列／改既有分類名」都會 mint 新 HLC 信封，
  在對方手機上呈現為一批**意義不明的編輯**，還會灌爆下一次同步。要加欄位就設計成可缺席、讀取時 `?? 預設`
- **人物是 UUID 實體（v2）**：`Person {id: uuidv7, name}` 走同步；paidBy=Person.id；
  名字**只有本人編輯**（renameMyPerson 是唯一寫入口），不存在改對方名字的路徑；
  「我是誰」= ids.getPersonId()（localStorage `zb.personId`）
- **顏色一律住 `styles/base.css` 的 `:root`**：CSS 葉檔禁裸色值（styles.test.ts 強制，另鎖兩主題的
  token 對稱與對比度）；**TSX 內聯樣式同規矩但沒有機器守著**，逃出去的色在夜墨下會原地不動。
  `--fixed-*` 那組**不得隨主題變**——QR quiet zone 與取景器的讀者是相機，不是人眼
- styles.css 是純 @import barrel，**順序即契約**（test/styles.test.ts 鎖順序 + 檢查 CSS url() 資產存在）
- 每個畫面資產都要有回退（圖 → 漸層 → 純色，一行 background 疊層）
- **本專案以低視力＋系統字級開到最大為主要情境**——大字不是邊緣情境；顏色不可單獨承載資訊
  （超支、選中態一律另加文字或字重），觸控目標寫成 `max(44px, …)`
- 註解寫「為什麼」，繁體中文；禁：霓虹色、科技感漸層、glassmorphism、emoji 濫用、簡體字

## 指令

- `pnpm dev` / `pnpm build` / `pnpm test` / `pnpm typecheck` / `pnpm lint`（root 一律可跑）
- `node tools/make-icons.mjs` — favicon.svg → PWA 圖示（any 滿版／maskable 80% 安全區，兩張都不透明）

## 部署

⚠️ **合併到 `main` = 直接上正式站**：Cloudflare Workers Builds 綁在 `main`，而正式站每天有人在用它記帳。
一律開 PR 給維護者自己合，不要代為 push/merge main。手動部署是 `pnpm build && npx wrangler deploy`。
