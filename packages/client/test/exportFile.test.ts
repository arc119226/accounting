/**
 * 檔案匯出/匯入測試：匯入必須與 core mergeAll 等價（decideIncoming 單一決策路徑），
 * 毒列擋在 parseImport；發票去重與 unique index 的落盤安全。
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { mergeAll, seedCategories, type ExpenseRecord } from '@zhangben/core';
import { buildExport, parseImport } from '../src/sync/exportFile';
import { decideIncoming } from '../src/sync/applyCore';
import * as repo from '../src/db/repo';
import { closeDbForTests } from '../src/db/db';

const ENV = { updatedAt: '000000000000099-0000-fresh', deviceId: 'fresh' };

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

  it('buildExport → JSON 往返 → parseImport 得回等價信封（v2 含 persons）', () => {
    const env = buildExport({
      deviceId: 'aaa',
      records: [rec('r1', '000000000000005-0000-aaa', 100)],
      categories: seedCategories().values(),
      rules: [],
      persons: [
        { id: 'p-me', updatedAt: '000000000000005-0000-aaa', deviceId: 'aaa', deleted: false, name: '我' },
      ],
      budget: null,
    });
    const parsed = parseImport(JSON.stringify(env));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.env.records).toHaveLength(1);
      expect(parsed.env.categories).toHaveLength(8);
      expect(parsed.env.persons).toHaveLength(1);
    }
  });

  it('v1 舊信封（無 persons、v:1）被拒收', () => {
    expect(
      parseImport(JSON.stringify({ v: 1, app: 'zhangben', records: [], categories: [], rules: [], budget: null })).ok,
    ).toBe(false);
  });

  it('parseImport 拒絕垃圾/缺信封欄位/錯 app 標記/毒列', () => {
    expect(parseImport('not json').ok).toBe(false);
    expect(parseImport('{}').ok).toBe(false);
    expect(parseImport(JSON.stringify({ v: 2, app: 'other', records: [], categories: [], rules: [], persons: [], budget: null })).ok).toBe(false);
    const base = { v: 2, app: 'zhangben', categories: [], rules: [], persons: [], budget: null };
    // 信封不完整
    expect(parseImport(JSON.stringify({ ...base, records: [{ id: 'x' }] })).ok).toBe(false);
    // 信封合格但缺 date（毒列：起始畫面按日分組會炸）
    const noDate = { ...rec('r1', '000000000000005-0000-aaa', 100) } as Record<string, unknown>;
    delete noDate['date'];
    expect(parseImport(JSON.stringify({ ...base, records: [noDate] })).ok).toBe(false);
    // 金額非整數
    expect(parseImport(JSON.stringify({ ...base, records: [{ ...rec('r1', '000000000000005-0000-aaa', 100), amount: 1.5 }] })).ok).toBe(false);
    // updatedAt 非 HLC 正準形（'zzz' 字典序永勝的偽造值）
    expect(parseImport(JSON.stringify({ ...base, records: [{ ...rec('r1', '000000000000005-0000-aaa', 100), updatedAt: 'zzz' }] })).ok).toBe(false);
  });

  it('匯入到分歧庫 = mergeAll 等價（decideIncoming 單一決策路徑）＋落盤重載一致', async () => {
    await repo.loadAll();
    const local = new Map<string, ExpenseRecord>([
      ['r1', rec('r1', '000000000000003-0000-aaa', 100)],
      ['r2', rec('r2', '000000000000004-0000-aaa', 200)],
    ]);
    for (const r of local.values()) await repo.putRecord(r);
    const incoming = [
      rec('r1', '000000000000009-0000-bbb', 150),
      rec('r3', '000000000000006-0000-bbb', 300),
      rec('r2', '000000000000002-0000-bbb', 0, true),
    ];
    const d = decideIncoming(local, incoming, ENV);
    const oracle = mergeAll(local, incoming);
    expect(new Map(d.next)).toEqual(new Map(oracle.next));
    expect(d.summary).toEqual(oracle.summary);
    // changed = 被採納的列；minTaken = 其中最小 updatedAt（水位回撥用）
    expect(d.changed.map((r) => r.id).sort()).toEqual(['r1', 'r3']);
    expect(d.minTaken).toBe('000000000000006-0000-bbb');
    await repo.persistRows('records', d.changed);
    const reloaded = await repo.loadAll();
    expect(reloaded.records.get('r1')!.amount).toBe(150);
    expect(reloaded.records.get('r3')!.amount).toBe(300);
    expect(reloaded.records.get('r2')!.deleted).toBe(false); // 舊墓碑輸給本地新版
  });

  it('兩機各掃同一張發票：decideIncoming 去重、墓碑剝號、unique index 落盤不炸', async () => {
    await repo.loadAll();
    const inv = { number: 'AB11111111', randomCode: '1234' };
    const mine: ExpenseRecord = { ...rec('a-early', '000000000000005-0000-aaa', 320), source: 'einvoice', invoice: inv };
    await repo.putRecord(mine);
    const local = new Map([[mine.id, mine]]);
    const theirs: ExpenseRecord = { ...rec('b-later', '000000000000006-0000-bbb', 320), source: 'einvoice', invoice: inv };
    const d = decideIncoming(local, [theirs], ENV);
    expect(d.deduped).toBe(1);
    const alive = [...d.next.values()].filter((r) => !r.deleted);
    expect(alive).toHaveLength(1);
    expect(alive[0]!.id).toBe('a-early'); // id 小者存活
    const loser = [...d.next.values()].find((r) => r.deleted)!;
    expect(loser.invoice).toBeUndefined(); // 剝號=不佔索引
    expect(loser.updatedAt).toBe(ENV.updatedAt); // fresh envelope=新事件可傳播
    await repo.persistRows('records', d.changed);
    const reloaded = await repo.loadAll();
    expect(new Map(reloaded.records)).toEqual(new Map(d.next));
  });

  it('本地帶號墓碑 + 對端同號活記錄：自癒剝號使整批落盤成功（回歸 #12）', async () => {
    await repo.loadAll();
    const inv = { number: 'AB22222222', randomCode: '9999' };
    // 舊版程式落下的帶號墓碑（deleteRecord 未剝號時代的遺產）
    const oldTomb: ExpenseRecord = { ...rec('t-old', '000000000000004-0000-aaa', 250, true), source: 'einvoice', invoice: inv };
    await repo.putRecord(oldTomb);
    const local = new Map([[oldTomb.id, oldTomb]]);
    const theirs: ExpenseRecord = { ...rec('b-live', '000000000000006-0000-bbb', 250), source: 'einvoice', invoice: inv };
    const d = decideIncoming(local, [theirs], ENV);
    // 墓碑被自癒剝號 + 對端活記錄被採納，同一批落盤不撞 unique index
    await expect(repo.persistRows('records', d.changed)).resolves.toBeUndefined();
    const reloaded = await repo.loadAll();
    expect(reloaded.records.get('t-old')!.invoice).toBeUndefined();
    expect(reloaded.records.get('b-live')!.deleted).toBe(false);
  });

  it('lowerPeerCheckpoints：合入舊列時把水位回撥到嚴格小於 minTaken', async () => {
    await repo.loadAll();
    await repo.savePeer({ peerDeviceId: 'ppp', peerPersonId: 'person-ppp', label: '乙', lastSyncedAt: '000000000000008-0000-ppp', lastSyncWallMs: 1 });
    const peers = await repo.lowerPeerCheckpoints('000000000000005-0000-old');
    expect(peers[0]!.lastSyncedAt < '000000000000005-0000-old').toBe(true);
    // 水位已低於 minTaken 的 peer 不動
    const again = await repo.lowerPeerCheckpoints('000000000000009-0000-x');
    expect(again[0]!.lastSyncedAt).toBe(peers[0]!.lastSyncedAt);
  });
});
