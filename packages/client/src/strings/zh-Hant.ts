/**
 * 顯示文字正典（繁體中文）——**零 import 純資料葉檔**（ESLint 機器強制）。
 * 所有 UI 顯示字一律住這裡；元件經 `strings/ui.ts` 取用，不得散落字面量。
 */

export const APP = {
  name: '柴米帳',
  tagline: '兩個人的宣紙記帳本',
} as const;

export const NAV = {
  ledger: '帳本',
  entry: '記一筆',
  scan: '掃發票',
  stats: '統計',
  sync: '同步',
  settings: '設定',
  categories: '分類',
} as const;

export const CONFIRM = {
  cancel: '取消',
  ok: '確定',
} as const;

export const NOTICE = {
  updateReady: '新版本已就緒',
  updateBtn: '重新整理',
  /** 更新提示是常駐的，沒有關閉鈕它會一直佔著畫面底部 */
  dismiss: '關閉提示',
  saveFailed: '設定保存失敗——變更僅在本次有效',
  /** 刪除後接金額，配「復原」動作鈕 */
  deletedPrefix: '已刪除 ',
  undo: '復原',
} as const;

export const CRASH = {
  title: '出了點狀況',
  body: '畫面遇到錯誤。可先回帳本頁，或重新整理再試。',
  menu: '回帳本',
  reload: '重新整理',
} as const;

export const PLACEHOLDER = {
  wip: '此頁尚在鋪紙研墨…',
} as const;

export const LEDGER = {
  emptyMonth: '本月尚無記錄，落筆自今日始。',
  /** hydrate 還沒完成時的字。與 emptyMonth 分開：「還沒載完」與「真的沒有」是兩件事 */
  loading: '正在翻開帳本…',
  addEntry: '記一筆',
  einvoiceChip: '電',
  weekdays: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  totalPrefix: '合計 ',
  /** ‹ › 的可及名稱：那兩個字元本身會被念成引號，而這是換月的唯一鍵盤路徑（左右滑是純 pointer） */
  prevMonth: '上一個月',
  nextMonth: '下一個月',
} as const;

export const ENTRY = {
  titleNew: '記一筆',
  titleEdit: '改一筆',
  paidByLabel: '誰花的',
  categoryLabel: '分類',
  dateLabel: '日期',
  today: '今天',
  yesterday: '昨天',
  pickDate: '選日期',
  noteLabel: '備註',
  notePlaceholder: '午餐、車票…',
  merchantLabel: '店家',
  merchantPlaceholder: '（可留白）',
  save: '入帳',
  saveEdit: '改一筆',
  saveAndNext: '入帳再記',
  /** 原「照這筆再記今天」7 字：與刪除鈕並排時吃掉 138px，大字級下必斷行 */
  repeatToday: '再記今天',
  delete: '刪除',
  /** 標題列的硃砂印章刪除鈕；aria-label 仍用 ENTRY.delete 的全名 */
  deleteGlyph: '刪',
  deleteTitle: '刪除這筆？',
  deleteBody: '刪除後會在同步時一併從對方帳上移除。',
  deleteConfirm: '刪除',
  dupTitle: '疑似重複',
  dupConfirm: '仍要入帳',
  /** {note} 由呼叫端替換 */
  dupBodyPrefix: '同日已有一筆同額記錄：',
  /** 入帳/改帳的 toast 前綴，後接金額 */
  savedNew: '已記一筆 ',
  savedEdit: '已改一筆 ',
  /** 掃描來的記錄在帳本內回看（唯讀） */
  invoiceSection: '發票內容',
} as const;

export const CATEGORIES = {
  title: '分類管理',
  addTitle: '新增分類',
  namePlaceholder: '名稱',
  glyphPlaceholder: '章',
  add: '新增',
  deleteTitle: '刪除分類？',
  deleteBody: '既有記錄不受影響，仍以原分類顯示統計。',
  deleteConfirm: '刪除',
  builtinLock: '內建',
  moveUp: '上移',
  moveDown: '下移',
} as const;

export const SCAN = {
  starting: '喚起鏡頭…',
  engineLoading: '載入辨識引擎…',
  denied: '鏡頭無法開啟——請改用拍照辨識',
  hintCamera: '對準發票下方的兩個方塊碼',
  leftOnly: '已讀到左碼，正在補讀右碼帶品項…',
  photoBtn: '拍照辨識',
  photoNone: '照片裡沒有讀到發票碼',
  previewTitle: '掃到一張發票',
  existsTitle: '這張發票已在帳上',
  justSaved: '這張剛記過了——換下一張',
  viewExisting: '查看該筆',
  rescan: '重掃',
  invNoLabel: '發票號碼',
  amountLabel: '金額',
  itemsLabel: '品項',
  itemsPartial: '（發票僅載部分品項）',
  save: '入帳',
} as const;

/** 品項自動備註的組字零件（core 只吐 names/total，文案在這裡） */
export const ITEMNOTE = {
  sep: '、',
  etcPrefix: '…等',
  etcSuffix: '項',
} as const;

export const RULES = {
  title: '商家規則（掃描學習）',
  empty: '掃發票並歸類後，這裡會記住店家。',
  /** ✕ 鈕的可及名稱：這顆沒有 ConfirmDialog 把關，誤觸即生效 */
  deleteRule: '刪除規則',
} as const;

export const SYNC = {
  p2pTitle: '面對面同步',
  p2pDesc: '兩台手機都連上網路（同一 Wi-Fi 最快），一方建立、另一方輸入房間碼。',
  hostBtn: '建立同步室',
  joinBtn: '加入同步室',
  codeLabel: '房間碼',
  codePlaceholder: '輸入 6 位房間碼',
  scanJoinBtn: '掃對方的碼',
  scanHint: '對準對方畫面上的方塊碼',
  scanStarting: '喚起鏡頭…',
  scanDenied: '鏡頭無法開啟——改用下面的房間碼',
  hostQrHint: '請對方在柴米帳裡按「加入同步室 › 掃對方的碼」，或直接念這六碼。',
  emptyGateTitle: '這個瀏覽器沒有帳本',
  emptyGateBody:
    '你可能是用系統相機掃了配對碼，於是 Safari 另開了一個空白的柴米帳。'
    + '在這裡同步只會把帳複製到這個用完就丟的分頁——請回主畫面開柴米帳，'
    + '再用 App 內的「掃對方的碼」。若你是在新手機上要還原備份，才選下面那個。',
  emptyGateForce: '我確定要在這裡同步',
  hydrateFailed:
    '這台裝置讀不到本機帳本（儲存空間被回收，或另一個分頁正佔著），'
    + '現在畫面上是空的。此時同步會讓對方以為你的帳都沒了——請先完全關掉柴米帳再開一次；'
    + '若仍是空的，改用「匯入帳本」還原最近一次備份。',
  waiting: '等待另一半的手機加入…',
  exchanging: '同步中…',
  doneTitle: '合併完成',
  cancelled: '已取消',
  cancel: '取消',
  close: '關閉',
  retry: '重試',
  errNoPeer: '等不到對方——確認雙方都有網路，或改用檔案備份。',
  errStalled: '連線中斷了——已套用的資料不受影響，再試一次即可。',
  errPeerLeft: '對方離開了——已套用的資料不受影響，再試一次即可。',
  errApplyFailed: '這台裝置儲存失敗——這次同步不算數，請重試（若持續發生請檢查儲存空間）。',
  clockDriftWarn: '兩機時間相差超過 10 分鐘，合併結果會以時間較快的一方為準。',
  summaryAdded: '新增',
  summaryUpdated: '更新',
  summaryDeletes: '刪除傳播',
  summarySkipped: '略過',
  summaryDeduped: '發票去重',
  summaryRejected: '格式不符拒收',
  unit: ' 筆',
  peersTitle: '同步對象',
  lastSync: '上次同步：',
  never: '從未',
  justNow: '剛剛',
  daysAgo: ' 天前',
  hoursAgo: ' 小時前',
  fileTitle: '檔案備份',
  fileDesc: '匯出完整帳本 JSON 檔；匯入時走同一套合併，不會蓋掉較新的記錄。',
  exportBtn: '匯出帳本',
  importBtn: '匯入帳本',
  exported: '帳本已匯出',
  exportFailed: '匯出失敗——請再試一次',
  importFailed: '這不是柴米帳的備份檔，或檔案已損毀。',
  /** 匯入進度。大帳本要好幾秒，沒有進度＝與「按了沒反應」不可區分 */
  importing: (done: number, total: number) => `正在還原… ${done} / ${total} 筆`,
  backupNag: '已超過 30 天沒有同步或備份——花一分鐘匯出一份吧。',
  /** 沒拿到持久儲存承諾時的版本：講後果，因為這裡的時限是瀏覽器定的不是我們定的 */
  backupNagAtRisk: '這個瀏覽器沒有承諾保留帳本，久沒開啟就可能被清掉——現在匯出一份。',
  /** iOS 分頁模式：講「為什麼要裝」，步驟留在設定頁 */
  installNag: '在 Safari 分頁裡，帳本可能被系統回收。加到主畫面比較安全 ›',
} as const;

export const STATS = {
  thisMonth: '本月',
  lastMonth: '上月',
  thisYear: '今年',
  custom: '自訂',
  from: '起',
  to: '迄',
  barTitle: '月度變化',
  donutTitle: '分類占比',
  trendTitle: '累積趨勢',
  trendHint: '虛線為上月同期',
  personTitle: '兩人比較',
  budgetTitle: '預算',
  emptyRange: '此區間沒有記錄，紙上留白。',
  summaryTitle: '月結摘要',
  /** 後接金額與百分比 */
  vsLastMore: '較上月多花 ',
  vsLastLess: '較上月少花 ',
  flat: '與上月持平',
  noPrevMonth: '上月沒有記錄，無從比較',
  moversTitle: '變動最大',
  largestTitle: '本月最大一筆',
  countSuffix: ' 筆',
  /** 分類明細有上限（見 StatsScreen 的 PICKED_LIMIT）；截掉的部分要說出來 */
  pickedMore: (n: number) => `還有 ${n} 筆——縮小區間看得更清楚`,
} as const;

export const BUDGET = {
  title: '每月預算',
  totalLabel: '每月總預算',
  perCatLabel: '各分類上限',
  zeroHint: '填 0 = 不設限',
  save: '儲存預算',
  savedToast: '預算已更新',
  /** 超支標記：顏色以外的第二個訊號（放大字級不會讓紅色更好認） */
  overMark: '⚠',
} as const;

export const NAMECARD = {
  title: '怎麼稱呼你？',
  body: '這本帳是兩個人的——取個名字，同步之後對方就知道哪些是你記的。之後隨時可以在設定改。',
  placeholder: '我',
  start: '開始記帳',
} as const;

export const PERSONS = {
  all: '全家',
  /** persons row 尚未同步到時的顯示 fallback */
  unknown: '（未同步）',
} as const;

export const SETTINGS = {
  title: '設定',
  iosInstallTitle: '安裝到主畫面',
  iosInstallBody: '用 Safari 開啟本頁 → 點「分享」→「加入主畫面」。安裝後帳本資料更不易被瀏覽器回收，開啟也更快。',
  myNameLabel: '我的稱呼（同步後對方看到的名字）',
  themeTitle: '紙色（只改這台，不同步）',
  themeOptions: { system: '跟隨系統', paper: '宣紙', ink: '夜墨' },
  categoriesLink: '分類管理',
  storageTitle: '儲存空間',
  persisted: '已向瀏覽器申請持久保存',
  notPersisted: '尚未取得持久保存承諾——請常備份',
  diagCopy: '複製診斷資訊',
  diagCopied: '已複製',
  versionPrefix: '版本 ',
} as const;
