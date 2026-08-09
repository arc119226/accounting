# 柴米帳

夫妻兩人用的記帳 PWA。帳本只存在你自己的瀏覽器裡（IndexedDB），沒有帳號、沒有伺服器、
沒有任何一筆帳離開過這兩支手機。

- **面對面同步** — 兩支手機掃個 QR 就對上，WebRTC 直連（Nostr 只用來牽線，不經手內容）
- **掃發票自動記帳** — 台灣電子發票雙 QR，左碼在裝置上直接解，離線也能掃
- **手寫感統計** — 圓餅、折線、預算刷，SVG 手繪
- **宣紙／夜墨** — 跟隨系統，或自己選
- **匯出就是完整帳本** — 一份 JSON，在沒有柴米帳、沒有網路的世界裡也打得開

## 開發

```
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # core + client
pnpm typecheck
pnpm lint
pnpm build
```

- `packages/core` — 純領域邏輯（LWW/HLC 合併、發票解析、統計、預算）。零依賴、零 I/O、決定論
- `packages/client` — React + Vite + Zustand 的 PWA 本體

慣例與鐵律見 [CLAUDE.md](CLAUDE.md)；設計原則（更重要的是**不做什麼**）與待辦見
[docs/BACKLOG.md](docs/BACKLOG.md)。

## 授權

私人專案，未授權散布。
