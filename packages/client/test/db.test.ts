/**
 * IndexedDB 層測試（fake-indexeddb）：開機 seed、寫穿往返、發票號碼 unique index。
 * 跑在 node——idb 直接吃 fake-indexeddb 的全域注入。
 */
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExpenseRecord } from '@zhangben/core';
import * as repo from '../src/db/repo';
import { closeDbForTests, upgradeZbDb, type ZbDB } from '../src/db/db';

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

  /**
   * 升級護欄的回歸：v1→v2 那次「清空重來」的條件曾是 `oldVersion > 0`，
   * 意思是**將來每一次版本升級都會先把使用者的帳本刪光**。正式資料已經在跑了，
   * 這條測試就是那把槍的保險栓——它失敗＝有人重新讓升級變成資料抹除。
   */
  it('v2 有資料 → 升到 v3：記錄與 meta 全部留著（升級不抹資料）', async () => {
    await repo.loadAll();
    await repo.putRecord(rec({ id: 'r1', amount: 250 }));
    await repo.savePeer({
      peerDeviceId: 'ppp',
      peerPersonId: 'person-ppp',
      label: '乙',
      lastSyncedAt: '000000000000008-0000-ppp',
      lastSyncWallMs: 1,
    });
    await closeDbForTests();

    // 以「未來的 v3」重開同一個庫，跑的是實際那支 upgrade
    const v3 = await openDB<ZbDB>('zhangben', 3, { upgrade: upgradeZbDb });
    expect((await v3.get('records', 'r1'))?.amount).toBe(250);
    expect((await v3.getAll('categories')).length).toBe(8);
    expect(await v3.get('meta', 'peers')).toHaveLength(1);
    v3.close();
  });
});
