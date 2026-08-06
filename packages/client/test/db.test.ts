/**
 * IndexedDB 層測試（fake-indexeddb）：開機 seed、寫穿往返、發票號碼 unique index。
 * 跑在 node——idb 直接吃 fake-indexeddb 的全域注入。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExpenseRecord } from '@zhangben/core';
import * as repo from '../src/db/repo';
import { closeDbForTests } from '../src/db/db';

// 每個測試都要全新 DB：先關連線（開啟中的連線會 block deleteDatabase）再刪庫
async function resetDb(): Promise<void> {
  await closeDbForTests();
  await new Promise<void>((resolve, reject) => {
    const rq = indexedDB.deleteDatabase('zhangben');
    rq.onsuccess = () => resolve();
    rq.onblocked = () => resolve();
    rq.onerror = () => reject(rq.error as Error);
  });
}

function rec(over: Partial<ExpenseRecord> & { id: string }): ExpenseRecord {
  return {
    updatedAt: '000000000000001-0000-test',
    deviceId: 'test',
    deleted: false,
    amount: 100,
    date: '2026-08-05',
    categoryId: 'cat-food',
    note: '',
    paidBy: 'A',
    source: 'manual',
    ...over,
  };
}

describe('db/repo', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('首次啟動 seed 內建八分類並落盤', async () => {
    const first = await repo.loadAll();
    expect(first.categories.size).toBe(8);
    expect(first.categories.get('cat-food')?.glyph).toBe('食');
    // 再載一次：讀回的是落盤資料，不是重新 seed（size 一樣但這次走 getAll 路徑）
    const again = await repo.loadAll();
    expect(again.categories.size).toBe(8);
  });

  it('記錄寫穿後重載讀得回來（含墓碑）', async () => {
    await repo.loadAll();
    await repo.putRecord(rec({ id: 'r1', amount: 250 }));
    await repo.putRecord(rec({ id: 'r2', deleted: true }));
    const loaded = await repo.loadAll();
    expect(loaded.records.get('r1')?.amount).toBe(250);
    expect(loaded.records.get('r2')?.deleted).toBe(true);
  });

  it('發票號碼 unique index：同號不同 id 的第二筆寫入被拒', async () => {
    await repo.loadAll();
    const inv = { number: 'AB12345678', randomCode: '1234' };
    await repo.putRecord(rec({ id: 'r1', invoice: inv, source: 'einvoice' }));
    // 同 id 覆寫合法（put 語意）
    await expect(repo.putRecord(rec({ id: 'r1', invoice: inv, amount: 300, source: 'einvoice' }))).resolves.toBeUndefined();
    // 不同 id 撞號=ConstraintError（掃描層在記憶體先查，這是最後一道防線）
    await expect(repo.putRecord(rec({ id: 'r2', invoice: inv, source: 'einvoice' }))).rejects.toThrow();
  });

  it('無發票的記錄不進 by-invoice 索引（多筆無發票共存）', async () => {
    await repo.loadAll();
    await repo.putRecord(rec({ id: 'r1' }));
    await repo.putRecord(rec({ id: 'r2' }));
    const loaded = await repo.loadAll();
    expect(loaded.records.size).toBe(2);
  });
});
