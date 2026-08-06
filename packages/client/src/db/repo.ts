/**
 * IndexedDB 的**唯一寫入口**。合併邏輯不住這裡（住 core/merge.ts）；
 * 這裡只做：開機載入（含首次 seed）、單筆寫穿、（M4）applyIncoming 批次合併落盤。
 *
 * 寫失敗策略：throw 給呼叫端（slice 捕捉後 errlog + saveFailed toast）——
 * 記憶體狀態已更新、IDB 沒跟上時使用者必須知道（帳本不能靜默掉筆）。
 */
import { seedCategories, type Budget, type Category, type ExpenseRecord, type MerchantRule } from '@zhangben/core';
import { getDb } from './db';

export interface LoadedState {
  readonly records: Map<string, ExpenseRecord>;
  readonly categories: Map<string, Category>;
  readonly rules: Map<string, MerchantRule>;
  readonly budget: Budget | null;
}

/** 開機批次讀；首次啟動（categories 空）seed 內建八分類並落盤 */
export async function loadAll(): Promise<LoadedState> {
  const db = await getDb();
  const [recordRows, categoryRows, ruleRows, singletonRows] = await Promise.all([
    db.getAll('records'),
    db.getAll('categories'),
    db.getAll('rules'),
    db.getAll('singletons'),
  ]);

  let categories = new Map(categoryRows.map((c) => [c.id, c]));
  if (categories.size === 0) {
    categories = seedCategories();
    const tx = db.transaction('categories', 'readwrite');
    for (const c of categories.values()) void tx.store.put(c);
    await tx.done;
  }

  return {
    records: new Map(recordRows.map((r) => [r.id, r])),
    categories,
    rules: new Map(ruleRows.map((r) => [r.id, r])),
    budget: singletonRows.find((s) => s.id === 'budget') ?? null,
  };
}

export async function putRecord(row: ExpenseRecord): Promise<void> {
  const db = await getDb();
  await db.put('records', row);
}

export async function putCategory(row: Category): Promise<void> {
  const db = await getDb();
  await db.put('categories', row);
}

export async function putRule(row: MerchantRule): Promise<void> {
  const db = await getDb();
  await db.put('rules', row);
}

export async function putBudget(row: Budget): Promise<void> {
  const db = await getDb();
  await db.put('singletons', row);
}
