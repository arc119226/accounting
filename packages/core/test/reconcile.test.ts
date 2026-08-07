import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { mergeAll } from '../src/merge';
import { reconcileInvoiceDuplicates, restoreRecord, type FreshEnvelope } from '../src/reconcile';
import type { ExpenseRecord } from '../src/types';

const ENV: FreshEnvelope = { updatedAt: '000000000000099-0000-fresh', deviceId: 'fresh' };

function rec(over: Partial<ExpenseRecord> & { id: string }): ExpenseRecord {
  return {
    updatedAt: '000000000000001-0000-x',
    deviceId: 'x',
    deleted: false,
    amount: 100,
    date: '2026-08-05',
    categoryId: 'cat-food',
    note: '',
    paidBy: 'A',
    source: 'einvoice',
    ...over,
  };
}

const toMap = (rows: ExpenseRecord[]) => new Map(rows.map((r) => [r.id, r]));

/** 模組層（兩個 describe 共用）：號碼取值域刻意只有三個，才會頻繁撞出重複 */
const arbRecords = fc
  .array(
    fc.record({
      id: fc.hexaString({ minLength: 4, maxLength: 4 }),
      num: fc.constantFrom('AB11111111', 'AB22222222', 'AB33333333', null),
      deleted: fc.boolean(),
    }),
    { maxLength: 30 },
  )
  .map((rows) => {
    const m = new Map<string, ExpenseRecord>();
    for (const r of rows) {
      m.set(
        r.id,
        rec({
          id: r.id,
          deleted: r.deleted,
          ...(r.num ? { invoice: { number: r.num, randomCode: '1' } } : {}),
        }),
      );
    }
    return m;
  });

describe('reconcileInvoiceDuplicates', () => {
  it('無重複且無帶號墓碑=原 Map 原樣回傳（零配置）', () => {
    const m = toMap([
      rec({ id: 'a', invoice: { number: 'AB11111111', randomCode: '1' } }),
      rec({ id: 'b', invoice: { number: 'AB22222222', randomCode: '2' } }),
      rec({ id: 'c' }),
    ]);
    const { next, deduped } = reconcileInvoiceDuplicates(m, ENV);
    expect(next).toBe(m);
    expect(deduped).toBe(0);
  });

  it('同號兩筆：id 小者存活，敗者轉墓碑、剝除 invoice、**換上新信封**（新事件才能同步收斂）', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const m = toMap([rec({ id: 'b', invoice: inv, amount: 200 }), rec({ id: 'a', invoice: inv, amount: 100 })]);
    const { next, deduped } = reconcileInvoiceDuplicates(m, ENV);
    expect(deduped).toBe(1);
    expect(next.get('a')!.deleted).toBe(false);
    const loser = next.get('b')!;
    expect(loser.deleted).toBe(true);
    expect(loser.invoice).toBeUndefined();
    expect(loser.amount).toBe(200); // 內容欄位不動
    // 信封必須是 fresh：沿用舊信封=同信封不同內容，mergeRow 會誤判 identical
    expect(loser.updatedAt).toBe(ENV.updatedAt);
    expect(loser.deviceId).toBe(ENV.deviceId);
  });

  it('自癒：帶 invoice 的墓碑被剝號並換新信封（釋放 unique index、可傳播）', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const m = toMap([rec({ id: 'a', invoice: inv, deleted: true }), rec({ id: 'b', invoice: inv })]);
    const { next, deduped } = reconcileInvoiceDuplicates(m, ENV);
    expect(deduped).toBe(0); // 純剝號不算去重
    const healed = next.get('a')!;
    expect(healed.deleted).toBe(true);
    expect(healed.invoice).toBeUndefined();
    expect(healed.updatedAt).toBe(ENV.updatedAt);
    expect(next.get('b')!.deleted).toBe(false); // 活記錄不受墓碑影響
  });

  it('property：調和後活號碼唯一、存活者=同號最小 id、無帶號墓碑、冪等、決定論（固定信封下）', () => {
    fc.assert(
      fc.property(arbRecords, (m) => {
        const { next } = reconcileInvoiceDuplicates(m, ENV);
        // 活號碼唯一 + 墓碑一律無 invoice
        const seen = new Map<string, string>();
        for (const r of next.values()) {
          if (r.deleted) {
            expect(r.invoice, `墓碑 ${r.id} 仍帶 invoice`).toBeUndefined();
            continue;
          }
          if (!r.invoice) continue;
          expect(seen.has(r.invoice.number), `號碼 ${r.invoice.number} 重複`).toBe(false);
          seen.set(r.invoice.number, r.id);
        }
        // 存活者=原輸入同號活記錄中的最小 id
        const groups = new Map<string, string[]>();
        for (const r of m.values()) {
          if (r.deleted || !r.invoice) continue;
          (groups.get(r.invoice.number) ?? groups.set(r.invoice.number, []).get(r.invoice.number)!).push(r.id);
        }
        for (const [num, ids] of groups) {
          expect(seen.get(num)).toBe([...ids].sort()[0]);
        }
        // 冪等（同信封重跑=無事可做）
        const twice = reconcileInvoiceDuplicates(next, ENV);
        expect(twice.deduped).toBe(0);
        expect(twice.next).toBe(next);
        // 決定論：打亂插入序結果相同
        const shuffled = new Map([...m.entries()].reverse());
        const again = reconcileInvoiceDuplicates(shuffled, ENV);
        expect(new Map(again.next)).toEqual(new Map(next));
      }),
    );
  });
});

/**
 * 增量（只看本批碰過的號碼）必須與全掃**等價**。
 *
 * 為什麼要增量：同步是一批 500 列、一批一批來的，而舊版每批都重建整本帳的 byNumber
 * ⇒ 掃描量 n × ⌈n/500⌉。3,000 筆時量不到，30,000 筆時是幾百萬次操作，
 * 而觸發時機正是「換新手機第一次全量同步」。
 *
 * 增量安全的理由：重複只可能由本批動過的列造成——沒被動到的列彼此之間的重複關係，
 * 上一輪就已經調和過了。這條測試把「上一輪已調和」這個前提做出來再驗等價：
 * 先全掃一次（模擬前幾批），再對新一批只用 touched 跑增量，結果必須與全掃相同。
 */
describe('reconcileInvoiceDuplicates 增量 == 全掃', () => {
  const ENV2: FreshEnvelope = { updatedAt: '000000000000200-0000-inc', deviceId: 'inc' };
  const norm = (m: ReadonlyMap<string, ExpenseRecord>): ExpenseRecord[] =>
    [...m.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  it('property：已調和的帳本 + 一批新列，增量與全掃結果相同', () => {
    fc.assert(
      fc.property(arbRecords, arbRecords, (base, incoming) => {
        // 前提：base 已經被調和過（前幾批做的事）
        const settled = reconcileInvoiceDuplicates(base, ENV).next;
        // 新一批進來：mergeAll 的角色這裡用直接覆蓋模擬，並記下動過的 id
        const merged = new Map(settled);
        const touched: string[] = [];
        for (const [id, row] of incoming) {
          merged.set(id, row);
          touched.push(id);
        }
        const inc = reconcileInvoiceDuplicates(merged, ENV2, touched);
        const full = reconcileInvoiceDuplicates(merged, ENV2);
        expect(norm(inc.next)).toEqual(norm(full.next));
        expect(inc.deduped).toBe(full.deduped);
        expect([...inc.changedIds].sort()).toEqual([...full.changedIds].sort());
      }),
    );
  });

  it('changedIds 蓋得住所有被改寫的列（呼叫端靠它決定落盤哪些）', () => {
    fc.assert(
      fc.property(arbRecords, (m) => {
        const r = reconcileInvoiceDuplicates(m, ENV);
        const actually = [...r.next.entries()].filter(([id, row]) => m.get(id) !== row).map(([id]) => id);
        expect([...new Set(r.changedIds)].sort()).toEqual(actually.sort());
      }),
    );
  });

  it('帶號墓碑 + 同號活記錄：增量模式也要自癒（釋放 unique index）', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const m = toMap([rec({ id: 'tomb', invoice: inv, deleted: true }), rec({ id: 'live', invoice: inv })]);
    // 只宣告 live 動過——tomb 的號碼會因為 live 帶同號而進 hotNumbers
    const r = reconcileInvoiceDuplicates(m, ENV, ['live']);
    expect(r.next.get('tomb')!.invoice).toBeUndefined();
    expect(r.changedIds).toContain('tomb');
  });
});

/**
 * 跨裝置收斂——這個模組存在的理由，之前只被檔頭的一句話擔保著。
 *
 * 上面的 property 只用**單一固定信封**驗冪等與決定論，那等於假設「只有一台裝置
 * 在調和」。真實情況是兩台各自調和：同一張發票被兩機各掃一次，同步後雙方都看到
 * 兩筆同號活記錄，於是各自 mint 一個**不同的**信封把敗者轉墓碑。
 * 檔頭主張「兩側各自 mint 的競爭墓碑由 LWW tie-break 自然收斂」——這裡把它驗出來。
 */
describe('reconcileInvoiceDuplicates 跨裝置收斂', () => {
  const ENV_A: FreshEnvelope = { updatedAt: '000000000000100-0000-aaa', deviceId: 'aaa' };
  /** 刻意與 A **同 HLC**：逼 mergeRow 走 deviceId tie-break 那條分支 */
  const ENV_B: FreshEnvelope = { updatedAt: '000000000000100-0000-bbb', deviceId: 'bbb' };

  const norm = (m: ReadonlyMap<string, ExpenseRecord>): ExpenseRecord[] =>
    [...m.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  /** 兩機各自調和 → 互相 mergeAll → 回傳兩側的最終狀態 */
  function crossSync(shared: ReadonlyMap<string, ExpenseRecord>) {
    const a = reconcileInvoiceDuplicates(shared, ENV_A).next;
    const b = reconcileInvoiceDuplicates(shared, ENV_B).next;
    return {
      finalA: mergeAll(a, [...b.values()]).next,
      finalB: mergeAll(b, [...a.values()]).next,
    };
  }

  it('兩機各自把敗者轉墓碑（信封不同）→ 交換後兩側位元相同', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const shared = toMap([
      rec({ id: 'a', invoice: inv, amount: 100 }),
      rec({ id: 'b', invoice: inv, amount: 100 }),
    ]);
    const { finalA, finalB } = crossSync(shared);
    expect(norm(finalA)).toEqual(norm(finalB));
    // 收斂到的狀態本身也要合法：'a' 活著帶號、'b' 是無號墓碑
    expect(finalA.get('a')!.deleted).toBe(false);
    expect(finalA.get('a')!.invoice).toEqual(inv);
    expect(finalA.get('b')!.deleted).toBe(true);
    expect(finalA.get('b')!.invoice).toBeUndefined();
    // 收斂後再各自調和一次＝無事可做（不會又生出一輪競爭墓碑）
    expect(reconcileInvoiceDuplicates(finalA, ENV_A).next).toBe(finalA);
    expect(reconcileInvoiceDuplicates(finalB, ENV_B).next).toBe(finalB);
  });

  it('property：任意帳本，兩機各自調和後交換必定收斂到同一狀態', () => {
    fc.assert(
      fc.property(arbRecords, (shared) => {
        const { finalA, finalB } = crossSync(shared);
        expect(norm(finalA)).toEqual(norm(finalB));
        // 再交換一輪也不再變動（達到不動點，不是在兩個狀態之間震盪）
        const againA = mergeAll(finalA, [...finalB.values()]).next;
        expect(norm(againA)).toEqual(norm(finalA));
      }),
    );
  });
});

/**
 * restoreRecord——「刪掉了 — 復原」的語義。
 *
 * 兩件事必須成立，否則復原鈕會靜默壞掉：
 * (1) 換新信封，否則 LWW 會被自己那個墓碑蓋回去（對方裝置尤其明顯）；
 * (2) 號碼已被別的活記錄佔住時不還原 invoice，否則 by-invoice unique index
 *     會讓 putRecord 整筆失敗——使用者按了復原，什麼都沒發生。
 */
describe('restoreRecord', () => {
  const tomb = (over: Partial<ExpenseRecord> = {}) =>
    rec({ id: 'gone', deleted: true, updatedAt: '000000000000010-0000-x', ...over });

  it('整列寫回、deleted=false、換上呼叫端的新信封', () => {
    const row = tomb({ amount: 250, items: [{ name: '鮮乳', qty: 1, unitPrice: 89 }] });
    const out = restoreRecord(toMap([row]), row, ENV);
    expect(out.deleted).toBe(false);
    expect(out.amount).toBe(250);
    expect(out.items).toEqual([{ name: '鮮乳', qty: 1, unitPrice: 89 }]);
    expect(out.updatedAt).toBe(ENV.updatedAt);
    expect(out.deviceId).toBe(ENV.deviceId);
    // 新信封必須嚴格大於原墓碑，LWW 才贏得了它
    expect(out.updatedAt > row.updatedAt).toBe(true);
  });

  it('帶發票號碼且沒人佔用：號碼一併還原', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const row = tomb({ invoice: inv });
    expect(restoreRecord(toMap([row]), row, ENV).invoice).toEqual(inv);
  });

  it('號碼已被別的活記錄佔住（刪除後同步收到對方那張）：剝號但保留 items', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const row = tomb({ invoice: inv, items: [{ name: '雞蛋', qty: 1, unitPrice: 75 }] });
    const theirs = rec({ id: 'theirs', invoice: inv });
    const out = restoreRecord(toMap([row, theirs]), row, ENV);
    expect('invoice' in out, 'exactOptionalPropertyTypes：鍵必須不存在，不是 undefined').toBe(false);
    expect(out.items).toEqual([{ name: '雞蛋', qty: 1, unitPrice: 75 }]);
    expect(out.deleted).toBe(false);
  });

  it('佔用者是墓碑或就是自己：不必剝號', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const row = tomb({ invoice: inv });
    const theirTomb = rec({ id: 'theirs', invoice: inv, deleted: true });
    expect(restoreRecord(toMap([row, theirTomb]), row, ENV).invoice).toEqual(inv);
    // 自己還在 Map 裡（deleted:true）不算佔用
    expect(restoreRecord(toMap([row]), row, ENV).invoice).toEqual(inv);
  });

  it('不變異輸入；重複復原冪等（同信封同結果）', () => {
    const row = tomb({ amount: 250 });
    const snapshot = { ...row };
    const once = restoreRecord(toMap([row]), row, ENV);
    const twice = restoreRecord(toMap([once]), once, ENV);
    expect(row).toEqual(snapshot);
    expect(twice).toEqual(once);
  });
});
