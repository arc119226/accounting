/**
 * IndexedDB 開啟與 schema（idb 薄封裝）。
 *
 * 設計：全帳本開機一次載入記憶體（雙人十年 ≈ 3 萬筆 ≈ 8MB，遠在預算內），
 * 聚合全在 core 純函式做——IDB 只負責三件事：耐久日誌、發票號碼唯一索引、
 * 開機批次讀。所以選 idb（1.2KB）而非 dexie 的查詢 DSL。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Budget, Category, ExpenseRecord, MerchantRule } from '@zhangben/core';

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
  /** 單例同步實體（budget；未來擴充也放這）——keyPath id，與 mergeAll 相容 */
  singletons: { key: string; value: Budget };
  /** 本機雜項（不同步）：peers 名單等。key 顯式字串。 */
  meta: { key: string; value: unknown };
}

const DB_NAME = 'zhangben';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ZbDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<ZbDB>> {
  dbPromise ??= openDB<ZbDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const records = db.createObjectStore('records', { keyPath: 'id' });
      records.createIndex('by-date', 'date');
      records.createIndex('by-invoice', 'invoice.number', { unique: true });
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('rules', { keyPath: 'id' });
      db.createObjectStore('singletons', { keyPath: 'id' });
      db.createObjectStore('meta');
    },
  });
  return dbPromise;
}
