# 打磨待辦（2026-08-06 六視角研究產出，已排序）

依「使用頻率 × 摩擦 ÷ 工作量」排序。動工前先讀該條的摩擦佐證（多數引用具體檔案）。

## S 級快贏包（各半天內）

1. **鍵盤不再蓋住輸入框**：index.html viewport 加 `interactive-widget=resizes-content`（Android）；
   iOS 補文字框 onFocus `scrollIntoView({block:'center'})`。受惠：EntrySheet 備註/店名、掃描預覽、同步輸碼、NameGate。
2. **備註歷史籤條**：以「目前分類」彙整歷史備註（頻率+近期加權，前 4~6 個）成 paper-label 列，
   點一下填入。純顯示層 useMemo，零 schema 影響。
3. **連續記帳＋照這筆再記**：新增模式入帳後不關抽屜（清金額備註、保留日期分類人）；
   編輯模式加 ghost 鈕「照這筆再記今天」＝openEntry({...fields, editingId: null, date: today})。
4. **刪除改復原 toast**：deleteRecord 前把完整原列（含 invoice/items）交給帶動作的 undo 通知，
   「已刪除 $250 — 復原」5 秒；復原=新信封整列寫回，LWW 天然贏過墓碑（跨裝置也成立）。
5. **剛入帳的發票靜默略過**：ScanScreen 記「本次已入帳號碼」集合，ingest 命中即略過＋短 hint；
   真正的歷史重複仍走 exists 卡。
6. **掃描入帳鈕 sticky**：.scan-result 的 .sheet-actions 改 sticky bottom + 紙底金線；
   金額/分類排卡片最上方、品項摺疊沉底。（後續可加：規則命中出緊湊確認條、連掃直接入帳+撤銷）
7. **品項/發票號碼帳本內可回看**：EntrySheet 對 einvoice 記錄加唯讀區（號碼+品項列，沿用 scan-item-row）；
   saveScanned 時 note 為空則由品項自動生成「鮮乳、蛋…等5項」。
8. **iOS 匯出改走分享面板**：`navigator.canShare({files})` 優先 `navigator.share`，失敗回退 a.click()；
   匯出成功補 toast。iOS standalone 的 blob 下載不可靠——這是備份保底的資料安全修補，**優先做**。
9. **月結摘要卡**：統計頁 singleMonth 時頂部加卡：本月 vs 上月（±額與%）、變化最大 2~3 分類、
   本月最大單筆（點擊直達）。全靠既有聚合函式。

## M 級（各一兩天）

10. **夜墨主題**：深墨 token 一組（:root 已集中，但要收編散落硬編碼色：money-card 漸層、
    text-input #fdf8ec、backup-nag、person-card 內聯 accent）；prefers-color-scheme 預設+設定頁三段切換；
    theme-color meta 跟著換。
11. **配對儀式整修**（含資料安全防呆）：
    - 首次同步交換配對密鑰存 PeerInfo → 之後「與{對方名}同步」一鍵，房間碼=HMAC(密鑰,日期) 派生
    - 加入模式支援 app 內掃碼（復用 scan/camera+detector）
    - **防呆**：deep link 且本地 records 為空時不自動入房，先確認「這個瀏覽器沒有帳本——請開主畫面的柴米帳」
      （iOS 系統相機掃 QR 會開 Safari 分身、把帳吸進空殼，全程無聲）
12. **記錄搜尋**：帳本頁加搜尋，對 note / merchant.name / items[].name 即時過濾，跨月、命中品項顯示於 entry-sub。

## 彩蛋候選

- **統一發票對獎**：帳裡本就存 invoice.number+隨機碼；每兩月開獎後比對（號碼來源：財政部
  invoice.etax.nat.gov.tw/invoice.xml 或 opendata，CORS 未驗證——退路是手動輸入三組頭獎號碼 30 秒），
  中獎跳硃砂印章。台灣限定的小確幸。
