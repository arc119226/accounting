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
  saveFailed: '設定保存失敗——變更僅在本次有效',
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
  addEntry: '記一筆',
  einvoiceChip: '電',
  weekdays: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  totalPrefix: '合計 ',
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
  delete: '刪除',
  deleteTitle: '刪除這筆？',
  deleteBody: '刪除後會在同步時一併從對方帳上移除。',
  deleteConfirm: '刪除',
  dupTitle: '疑似重複',
  dupConfirm: '仍要入帳',
  /** {note} 由呼叫端替換 */
  dupBodyPrefix: '同日已有一筆同額記錄：',
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
  viewExisting: '查看該筆',
  rescan: '重掃',
  invNoLabel: '發票號碼',
  amountLabel: '金額',
  itemsLabel: '品項',
  itemsPartial: '（發票僅載部分品項）',
  save: '入帳',
} as const;

export const RULES = {
  title: '商家規則（掃描學習）',
  empty: '掃發票並歸類後，這裡會記住店家。',
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
  countSuffix: ' 筆',
} as const;

export const BUDGET = {
  title: '每月預算',
  totalLabel: '每月總預算',
  perCatLabel: '各分類上限',
  zeroHint: '填 0 = 不設限',
  save: '儲存預算',
  savedToast: '預算已更新',
} as const;

export const SETTINGS = {
  title: '設定',
  whoAmI: '這支手機的主人',
  namesLabel: '兩人稱呼',
  nameA: '甲的稱呼',
  nameB: '乙的稱呼',
  categoriesLink: '分類管理',
  storageTitle: '儲存空間',
  persisted: '已向瀏覽器申請持久保存',
  notPersisted: '尚未取得持久保存承諾——請常備份',
  diagCopy: '複製診斷資訊',
  diagCopied: '已複製',
  versionPrefix: '版本 ',
} as const;
