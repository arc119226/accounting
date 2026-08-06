/**
 * 領域型別正典——所有可同步資料的契約。
 *
 * **Syncable 信封是同步系統的全部前提**：merge.ts 只認得這四個欄位；
 * 任何新同步實體只要帶上信封就自動獲得 LWW 合併、墓碑刪除、增量傳輸。
 * `updatedAt` 是 HLC 編碼字串（hlc.ts；定寬 → 字典序即全序），不是牆鐘。
 */

/** 每一筆可同步資料的共同信封（merge.ts 只認得這個介面） */
export interface Syncable {
  /** record=uuidv7（client/ids.ts 產）；category=固定字串；rule=賣方統編；budget='budget' */
  readonly id: string;
  /** HLC 編碼字串（hlcEncode 產出；定寬、字典序=全序）。LWW 以此決勝。 */
  readonly updatedAt: string;
  /** 最後修改裝置（HLC 平手時的決定性 tie-break） */
  readonly deviceId: string;
  /** 墓碑：刪除=標記不物理刪，否則另一台會把它復活 */
  readonly deleted: boolean;
}

/**
 * 人物（v2）：各記各的帳、自己取自己的名字。
 * id=uuidv7（每個安裝首啟 mint，存 localStorage `zb.personId`）——**不是槽位**，
 * 同步以 uuid 為鍵合併；name 是同步的唯一真相（不住 Settings）。
 * 只有本人會編輯自己的 row（UI 限制），LWW 天然無衝突；改名經同步傳播。
 */
export interface Person extends Syncable {
  readonly name: string;
}

/** 發票品項（掃描盡力保留；常缺/不全，見 einvoice.ts itemsComplete） */
export interface InvoiceItem {
  readonly name: string;
  readonly qty: number;
  /** 單價可能是小數（秤重計價）；只有 ExpenseRecord.amount 契約上是整數元 */
  readonly unitPrice: number;
}

/** 一筆支出。金額=整數新台幣元（發票金額本就是 hex 整數元；不用分）。 */
export interface ExpenseRecord extends Syncable {
  /** 整數元；輸入層負責驗證（core 不 throw，壞值由 normalize 夾） */
  readonly amount: number;
  /** 'YYYY-MM-DD'（裝置當地=台灣；不做時區運算） */
  readonly date: string;
  readonly categoryId: string;
  readonly note: string;
  /** 誰花的：Person.id（uuid）。人物 row 可能晚到（同步中途），顯示層要有 fallback。 */
  readonly paidBy: string;
  /** 來源不因傳輸而變（掃描的記錄同步到對方手機仍是 einvoice）——合併冪等的前提 */
  readonly source: 'manual' | 'einvoice';
  readonly merchant?: {
    readonly sellerTaxId?: string;
    readonly name?: string;
  };
  /** 發票號碼是天然去重主鍵（db 層 unique index + repo 先查再寫） */
  readonly invoice?: {
    readonly number: string;
    readonly randomCode: string;
  };
  readonly items?: readonly InvoiceItem[];
}

/** 支出分類。builtin 的 id 跨裝置固定=LWW 自動收斂的前提。 */
export interface Category extends Syncable {
  /** 顯示名（「餐飲」） */
  readonly name: string;
  /** 單漢字印章（「食」→ .seal-char 顯示） */
  readonly glyph: string;
  /** hex 色（'#rrggbb'）；顯示時 color-mix 65% 壓彩以合宣紙 */
  readonly color: string;
  /** 排序權重（小在前） */
  readonly order: number;
  /** 內建不可刪（UI 鎖），只可改色/排序/改名 */
  readonly builtin: boolean;
}

/** 商家規則：id=賣方統編（雙機同店同 id ⇒ LWW 自動收斂）。掃描學習迴圈維護。 */
export interface MerchantRule extends Syncable {
  readonly categoryId: string;
  /** 使用者取的店名（發票上只有統編） */
  readonly displayName: string;
}

/** 預算（id='budget' 單例，全帳本一份，同步） */
export interface Budget extends Syncable {
  /** 每月總預算（整數元；0=未設定） */
  readonly monthlyTotal: number;
  /** 各分類每月上限（整數元；缺鍵=該分類未設） */
  readonly perCategory: Readonly<Record<string, number>>;
}
