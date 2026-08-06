# 打磨待辦（2026-08-06 六視角研究產出，已排序）

依「使用頻率 × 摩擦 ÷ 工作量」排序。動工前先讀該條的摩擦佐證（多數引用具體檔案）。

> **2026-08-06 v3 已完成**：S 級 1–9 全數完成、#11 的兩個子項（分身防呆／掃碼加入）完成，
> 另加使用者指定的「手機排版總整理」與兩個規劃期查出的資料安全缺陷修補。
> 剩下 #10 夜墨主題、#11a 配對密鑰、#12 記錄搜尋、發票對獎彩蛋。

## ✅ S 級快贏包（v3 已完成）

1. ~~**鍵盤不再蓋住輸入框**~~ — viewport 補 `interactive-widget=resizes-content`（Android）；
   iOS 走新的 `src/keyboard.ts`：量 visualViewport 寫 `--kb`，overlay 底邊縮到鍵盤上緣，
   `align-items:flex-end` 自動把抽屜貼上去，元件零改動。
2. ~~**備註歷史籤條**~~ — core `suggestNotes`（頻率×近期加權、全決定性、`minCount=2`）；
   橫式 `.note-chip` 而非直書籤條（直書會吃掉 88dvh 抽屜的 170px）。
3. ~~**連續記帳＋照這筆再記**~~ — 兩顆按鈕 `[入帳再記][入帳]`（使用者選定）；
   編輯模式加「照這筆再記今天」。
4. ~~**刪除改復原 toast**~~ — core `restoreRecord`（換新信封、號碼被佔時剝號保 items）；
   `notice.showAction` + `AppToast` 時長表。
5. ~~**剛入帳的發票靜默略過**~~ — module 層 `savedThisSession` Set，`finish`／`ingest` 兩道守衛。
6. ~~**掃描入帳鈕 sticky**~~ — `.scan-preview .sheet-actions` position:sticky；預覽卡欄位重排
   （金額/分類上移、日期/發票號碼下沉）。
7. ~~**品項/發票號碼帳本內可回看**~~ — core `digestItems` + client `noteFromItems`（文案在 client）；
   EntrySheet 唯讀 `<details>` 沿用 scan.css 樣式。
8. ~~**iOS 匯出改走分享面板**~~ — `shareOrDownloadExport`，share 留在手勢任務內、
   AbortError 不推進 `lastExportMs`。
9. ~~**月結摘要卡**~~ — core `monthSummary`（movers 取兩月分類聯集、deltaPct 上月為 0 回 null）。

## 待辦

10. **夜墨主題**：深墨 token 一組。**先決條件**：約 30 處逃逸的硬編碼色要收編成 token，
    其中**陰影是最容易漏的一類**——黑色陰影在墨底上等於消失，每張卡會靜靜失去立體感。
    已知散落點：`.money-card` 漸層與 `--card-accent`、`.text-input` `#fdf8ec`、`.backup-nag`、
    `.app-toast`/`.app-toast-btn`、`.scroll-banner` 邊框與木軸、`.paper-label` 陰影、
    `.note-chip` 陰影、`.add-fab`/`.entry-sheet`/`.modal-card` 陰影、
    `LedgerScreen` 的 person-card 內聯 accent、`PersonSplit.COLORS`、
    `DonutChart`/`StatsScreen`/`LedgerScreen` 的 `'#6e6046'` fallback。
    **三處必須保持不隨主題變**（正確性而非品味）：`.qr-box` 底色（QR 的 quiet zone，
    深色會降低可掃性）、`.scan-*`/`.join-viewport` 取景器（疊在實時影像上）、
    `CategoriesScreen` 新分類的預設色（那是會同步的**使用者資料**，不是樣式）。
    另需：`:root[data-theme='ink']` + index.html 的首漆內聯 script（否則夜墨使用者先閃一下白紙）、
    `theme-color` meta 跟著換、設定頁三段切換（跟隨系統/宣紙/夜墨）。
    建議配一條 token 對稱性測試：亮色區塊有的 token，暗色區塊必須也有。

11. **配對密鑰一鍵同步**（#11 三子項只剩這個）：首次同步交換密鑰存 PeerInfo，
    之後「與{對方名}同步」一鍵，房間 id 由 HMAC(密鑰) 派生。
    - **不要做日期分桶**：兩機時鐘一偏就各自進不同房間、雙方都只看到「等不到對方」；
      要容錯就得同時 join 三個房間再賽跑，那要改 `trystero.ts`（全 repo 最危險的檔案）。
      改用靜態派生 + `expectPeerDeviceId`（reducer 加一個 branch）擋陌生人，更簡單也更對症。
    - `savePeer` 目前是**整列取代**不是合併，直接加欄位會在每次存 checkpoint 時把密鑰洗掉。
    - `PeerInfo` 存在 meta store 的單一 JSON 值裡，**不需要 DB_VERSION 升級**。
    - hello 多欄位要在殼層 normalize（`trystero.ts` 是 `data as unknown as SyncMsg`，完全信任 wire）；
      「雙方都必須提出密鑰才建立配對」這條規則本身就是 feature flag，混版本期間自動不啟用。
    - **施工前兩台都要先匯出備份**，且分階段驗證（先更新一台 → 與舊版同步應行為不變）。

12. **記錄搜尋**：帳本頁加搜尋，對 note / merchant.name / items[].name 即時過濾。
    決策：**搜尋是脫離月游標的模式**（「上次買那個吸塵器多少錢」本來就跨月）。
    matcher 放 core（純、可測、回命中區間讓 UI 直接上色）；狀態留在 LedgerScreen 本地。
    注意 `LedgerScreen` 那句「單月 <300 筆不需虛擬化」跨月就不成立了——要設結果上限。

## 彩蛋候選

- **統一發票對獎**：帳裡本就存 invoice.number+隨機碼。**建議只做手動輸入版**：
  對獎規則寫進 core（純函式、可測；關鍵細節是「末幾碼的降級只適用頭獎三組，
  特別獎/特獎只比對全 8 碼」），每期手動輸入三組號碼約 30 秒。
  自動抓號要把純靜態部署變成有 Worker（代抓財政部 XML 避開 CORS）、還要維護會變的政府格式，
  為了省 30 秒打字不划算。結果**不要寫進 ExpenseRecord**——那是衍生值，
  寫進去會讓每期開獎後所有記錄的 updatedAt 全部跳動、灌爆下一次同步。

## 順手記下的、還沒處理的

- `PersonSplit.tsx` 用了 `.split-row`/`.split-name`/`.split-amount` 三個**任何 CSS 檔都沒定義**的
  class（≥3 人才會走到，夫妻倆碰不到）。同類的還有 `.brush-text`、`.split-bar`，
  以及完全沒有消費者的 `FadeImg`（連帶 base.css 的 `.fade-img` 是死碼）。
  值得單獨一輪「className 字面量 vs 已定義選擇器」的清查，並補一條測試。
- 分類籤條的有效觸控寬是 37px（`.paper-label::after` 撐出來的），**未達 44px 下限**。
  要真的到 44 得把籤條加粗一倍、比例從 1:2.8 變 1:1.7，那就不是籤條了——這是刻意的取捨，
  記在這裡是為了下次有人量到時知道不是漏掉。
