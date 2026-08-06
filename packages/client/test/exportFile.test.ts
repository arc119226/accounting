/**
 * 檔案匯出/匯入測試：匯入必須與 core mergeAll 等價（同一條 applyIncoming 路徑），
 * 匯出→匯入到空庫=完整重建，匯入到分歧庫=LWW 收斂。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { mergeAll, seedCategories, type ExpenseRecord } from '@zhangben/core';
import { buildExport, parseImport } from '../src/sync/exportFile';
import * as repo from '../src/db/repo';
import { closeDbForTests } from '../src/db/db';

async function resetDb(): Promise<void> {
  await closeDbForTests();
  await new Promise<void>((resolve, reject) => {
    const rq = indexedDB.deleteDatabase('zhangben');
    rq.onsuccess = () => resolve();
    rq.onblocked = () => resolve();
    rq.onerror = () => reject(rq.error as Error);
  });
}

function rec(id: string, updatedAt: string, amount: number, deleted = false): ExpenseRecord {
  return {
    id,
    updatedAt,
    deviceId: updatedAt.split('-')[2] ?? 'x',
    deleted,
    amount,
    date: '2026-08-05',
    categoryId: 'cat-food',
    note: '',
    paidBy: 'A',
    source: 'manual',
  };
}

describe('exportFile', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('buildExport → JSON 往返 → parseImport 得回等價信封', () => {
    const env = buildExport({
      deviceId: 'aaa',
      records: [rec('r1', '000000000000005-0000-aaa', 100)],
      categories: seedCategories().values(),
      rules: [],
      budget: null,
    });
    const parsed = parseImport(JSON.stringify(env));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.env.records).toHaveLength(1);
      expect(parsed.env.categories).toHaveLength(8);
    }
  });

  it('parseImport 拒絕垃圾/缺信封欄位/錯 app 標記', () => {
    expect(parseImport('not json').ok).toBe(false);
    expect(parseImport('{}').ok).toBe(false);
    expect(parseImport(JSON.stringify({ v: 1, app: 'other', records: [], categories: [], rules: [], budget: null })).ok).toBe(false);
    expect(
      parseImport(JSON.stringify({ v: 1, app: 'zhangben', records: [{ id: 'x' }], categories: [], rules: [], budget: null })).ok,
    ).toBe(false);
  });

  it('匯入到分歧庫 = mergeAll 等價（applyIncoming 走同一條路）', async () => {
    await repo.loadAll();
    // 本地：r1 舊版 + r2 本地獨有
    const local = new Map<string, ExpenseRecord>([
      ['r1', rec('r1', '000000000000003-0000-aaa', 100)],
      ['r2', rec('r2', '000000000000004-0000-aaa', 200)],
    ]);
    for (const r of local.values()) await repo.putRecord(r);
    // 匯入：r1 新版 + r3 對方獨有 + r2 的較舊墓碑（應輸給本地版）
    const incoming = [
      rec('r1', '000000000000009-0000-bbb', 150),
      rec('r3', '000000000000006-0000-bbb', 300),
      rec('r2', '000000000000002-0000-bbb', 0, true),
    ];
    const { next, summary } = await repo.applyIncoming('records', local, incoming);
    const oracle = mergeAll(local, incoming);
    expect(new Map(next)).toEqual(new Map(oracle.next));
    expect(summary).toEqual(oracle.summary);
    // 落盤驗證：重載得到相同結果
    const reloaded = await repo.loadAll();
    expect(reloaded.records.get('r1')!.amount).toBe(150);
    expect(reloaded.records.get('r3')!.amount).toBe(300);
    expect(reloaded.records.get('r2')!.deleted).toBe(false); // 舊墓碑輸給本地新版
  });

  it('兩機各掃同一張發票：applyIncoming 自動去重且 unique index 不炸', async () => {
    await repo.loadAll();
    const inv = { number: 'AB11111111', randomCode: '1234' };
    const mine: ExpenseRecord = { ...rec('a-early', '000000000000005-0000-aaa', 320), source: 'einvoice', invoice: inv };
    await repo.putRecord(mine);
    const local = new Map([[mine.id, mine]]);
    const theirs: ExpenseRecord = { ...rec('b-later', '000000000000006-0000-bbb', 320), source: 'einvoice', invoice: inv };
    const { next, deduped } = await repo.applyIncoming('records', local, [theirs]);
    expect(deduped).toBe(1);
    const alive = [...next.values()].filter((r) => !r.deleted);
    expect(alive).toHaveLength(1);
    expect(alive[0]!.id).toBe('a-early'); // id 小者存活
    // 落盤不炸（敗者 invoice 已剝除）且重載一致
    const reloaded = await repo.loadAll();
    expect(new Map(reloaded.records)).toEqual(new Map(next));
  });
});
