# 柴米帳

兩個人共用的記帳 PWA。帳本只存在你自己的瀏覽器裡（IndexedDB）——**沒有帳號、沒有伺服器、
沒有任何一筆帳離開過你的裝置**，兩支手機之間靠面對面掃 QR 直接同步。

正式站：<https://accounting.arc.idv.tw>

## 為什麼會有這個東西

市面上的記帳 app 幾乎都假設「一個人」或「一間公司」，而且幾乎都要帳號、都要雲端。
兩個人共用一本帳的情境沒人做好，而把兩個人的消費紀錄放上別人的伺服器，
是一件比它看起來嚴重得多的事。

所以這個 app 的核心是**你不必信任我們**——沒有伺服器可以外洩，沒有帳號可以被關掉。
這句話開源之後可以被驗證，這也是它開源的主要理由。

## 特色

- **面對面同步** — 兩支手機掃個 QR 就對上，WebRTC 直連。Nostr 只用來牽線（約 2 KB 的
  signaling），帳本內容不經過它。SDP 以房間碼派生金鑰加密。
- **掃發票自動記帳** — 台灣電子發票雙 QR，左碼在裝置上直接解，**離線也能掃**。
- **離線可用** — Service Worker 把殼、JS、字體、條碼引擎全部預先快取。飛航模式照記。
- **手寫感統計** — 圓餅、折線、預算刷，全部是手繪 SVG，沒有圖表函式庫。
- **宣紙／夜墨** — 跟隨系統，或自己選。
- **匯出就是完整帳本** — 一份 JSON，在沒有柴米帳、沒有網路、沒有作者的世界裡也打得開。

## 這是什麼樣的專案

**這是為兩個人做的，不是通用產品。** 它每天被真的拿來記帳，所以取捨一律偏向
「那兩個人用起來對」而不是「大多數人可能會想要」。

`docs/BACKLOG.md` 的前半是這個專案的**設計原則**——與其說是路線圖，不如說是憲法。
它明文否決掉一整類看起來很合理的功能（分帳、應收應付、「這個圈 N 天沒更新」這類提醒、
清理墓碑）。**開任何 issue 之前請先讀那一份**，它解釋的是「為什麼不做」，
而那些理由通常比功能本身有意思。

回報 bug 很歡迎，尤其是真機相容性（掃碼、iOS/Android 差異、無障礙）。
功能請求原則上不收，詳見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## `packages/core` 可以單獨拿去用

零依賴、零 I/O、決定論的純函式庫，193 條測試（含 fast-check 性質測試）。
裡面有兩塊在中文圈不容易找到乾淨實作的東西：

- **`einvoice.ts`** — 台灣電子發票雙 QR 解析。左碼前 77 字的定位移欄位頭、
  Base64 品項續列、右碼合併。頭部嚴格（錢與日期壞了整張拒收）、尾段寬容
  （品項壞多少丟多少），永不 throw。
- **`hlc.ts` + `merge.ts`** — 混合邏輯時鐘與 LWW 合併，定寬編碼讓字典序即全序。
  冪等／交換／結合三律有性質測試證明，所以任何同步順序都收斂。

## 開發

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # core 193 + client 94
pnpm typecheck
pnpm lint
pnpm build
```

- `packages/core` — 純領域邏輯。源碼級 exports，無 build step
- `packages/client` — React 18 + Vite + Zustand 的 PWA 本體

慣例與鐵律見 [CLAUDE.md](CLAUDE.md)（給 AI 助理讀的，但人讀也一樣有用）。

## 自己部署

`pnpm build` 產出的 `packages/client/dist/` 是**純靜態檔案**，丟到任何靜態主機都能跑
（沒有後端、沒有環境變數、沒有建置期密鑰）。

若要照樣用 Cloudflare Workers，`wrangler.jsonc` 裡有兩個欄位是本站專屬的，fork 後必須改：

- `name` — 必須與你在 Cloudflare 儀表板建立的 Worker **同名**，否則會部署到另一個新
  Worker，而綁了網域的那個永遠停在範本頁
- `routes` — 換成你自己的網域，或整個拿掉（拿掉就走 `*.workers.dev`）

`packages/client/public/_headers` 的快取規則建議照抄：`/` 與 `index.html` 必須 `no-cache`，
否則新部署之後舊 `index.html` 會指向已被刪除的 hashed 資產，得到白畫面。

## 隱私

- 沒有帳號、沒有伺服器、沒有分析工具、沒有任何第三方 SDK
- 帳本存在瀏覽器的 IndexedDB，只有你的裝置有
- 同步是裝置對裝置的 WebRTC；公共 Nostr relay 只轉手加密過的連線協商訊息
- 設定頁的「診斷資訊」只寫在你自己的 localStorage，除非你主動複製貼出來，否則不會離開裝置

## 授權

| 範圍 | 授權 |
|---|---|
| 程式碼 | [Apache-2.0](LICENSE) |
| `docs/`（設計原則） | [CC BY-SA 4.0](docs/LICENSE.md) |
| `public/fonts/` 的字體 | [SIL OFL 1.1](packages/client/public/fonts/OFL-LXGWWenKaiTC.txt)（霞鶩文楷 TC 子集） |
| 打包進 `.wasm` 的條碼引擎 | zxing-cpp（Apache-2.0）、zint（BSD-3） |

完整歸屬見 [NOTICE](NOTICE)。Apache-2.0 §6 不授予「柴米帳」這個名稱的商標權——
分支請用自己的名字。
