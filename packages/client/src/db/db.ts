/**
 * IndexedDB 開啟與 schema（idb 薄封裝）。
 *
 * 設計：全帳本開機一次載入記憶體（雙人十年 ≈ 3 萬筆 ≈ 8MB，遠在預算內），
 * 聚合全在 core 純函式做——IDB 只負責三件事：耐久日誌、發票號碼唯一索引、
 * 開機批次讀。所以選 idb（1.2KB）而非 dexie 的查詢 DSL。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Budget, Category, ExpenseRecord, MerchantRule, Person } from '@zhangben/core';

export interface ZbDB extends DBSchema {
  records: {
    key: string;
    value: ExpenseRecord;
    indexes: {
      /** 月清單讀取用（目前全載入未用到，留給未來大帳本分頁載入） */
      'by-date': string;
      /** 發票去重主鍵。沒有 invoice 的記錄不進索引（keyPath 缺值=跳過），unique 只約束有發票的。 */
      'by-invoice': string;
    };
  };
  categories: { key: string; value: Category };
  rules: { key: string; value: MerchantRule };
  /** 人物（v2）：uuid 為鍵的同步實體 */
  persons: { key: string; value: Person };
  /** 單例同步實體（budget；未來擴充也放這）——keyPath id，與 mergeAll 相容 */
  singletons: { key: string; value: Budget };
  /** 本機雜項（不同步）：peers 名單等。key 顯式字串。 */
  meta: { key: string; value: unknown };
}

const DB_NAME = 'zhangben';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<ZbDB>> | null = null;

/** 測試專用：關閉連線並重置單例——開啟中的連線會 block deleteDatabase，
 *  不關掉的話測試間的「全新 DB」是假的（上一測資料還在）。 */
export async function closeDbForTests(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
}

/**
 * schema 升級。**匯出是為了讓 test/db.test.ts 能拿這支真的函式驗護欄**——
 * 測試自己抄一份升級邏輯的話，驗到的就不是實際跑的那份。
 */
export function upgradeZbDb(db: IDBPDatabase<ZbDB>, oldVersion: number): void {
  // v1→v2 是**一次性**的清空重來（使用者決策：paidBy 從 A/B 槽位改 person uuid，
  // 當時正式資料尚未開始記、不做遷移）。
  //
  // 條件必須綁死 `=== 1`：原本寫的是 `> 0`，那等於「任何一次 DB_VERSION 升級都先把
  // 帳本刪光」——正式資料已經存在，那是一把上了膛的槍，且刪除不可逆。
  if (oldVersion === 1) {
    for (const name of [...db.objectStoreNames]) db.deleteObjectStore(name);
  }
  // 逐一保護：升級可能從任何舊版本進來（剛清空的、或未來只加一個 store 的版本），
  // 已存在就跳過＝這支函式對任何 oldVersion 都可重入。
  if (!db.objectStoreNames.contains('records')) {
    const records = db.createObjectStore('records', { keyPath: 'id' });
    records.createIndex('by-date', 'date');
    records.createIndex('by-invoice', 'invoice.number', { unique: true });
  }
  if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('rules')) db.createObjectStore('rules', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('persons')) db.createObjectStore('persons', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('singletons')) db.createObjectStore('singletons', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
}

export function getDb(): Promise<IDBPDatabase<ZbDB>> {
  dbPromise ??= openDB<ZbDB>(DB_NAME, DB_VERSION, { upgrade: upgradeZbDb });
  return dbPromise;
}
