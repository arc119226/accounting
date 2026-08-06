import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { reconcileInvoiceDuplicates } from '../src/reconcile';
import type { ExpenseRecord } from '../src/types';

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

describe('reconcileInvoiceDuplicates', () => {
  it('無重複=原 Map 原樣回傳（零配置）', () => {
    const m = toMap([
      rec({ id: 'a', invoice: { number: 'AB11111111', randomCode: '1' } }),
      rec({ id: 'b', invoice: { number: 'AB22222222', randomCode: '2' } }),
      rec({ id: 'c' }),
    ]);
    const { next, deduped } = reconcileInvoiceDuplicates(m);
    expect(next).toBe(m);
    expect(deduped).toBe(0);
  });

  it('同號兩筆：id 小者存活，敗者轉墓碑且剝除 invoice', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const m = toMap([rec({ id: 'b', invoice: inv, amount: 200 }), rec({ id: 'a', invoice: inv, amount: 100 })]);
    const { next, deduped } = reconcileInvoiceDuplicates(m);
    expect(deduped).toBe(1);
    expect(next.get('a')!.deleted).toBe(false);
    const loser = next.get('b')!;
    expect(loser.deleted).toBe(true);
    expect(loser.invoice).toBeUndefined();
    expect(loser.amount).toBe(200); // 其餘欄位不動（信封也不動）
    expect(loser.updatedAt).toBe('000000000000001-0000-x');
  });

  it('墓碑不參與分組（已刪的同號記錄不影響活記錄）', () => {
    const inv = { number: 'AB11111111', randomCode: '1' };
    const m = toMap([rec({ id: 'a', invoice: inv, deleted: true }), rec({ id: 'b', invoice: inv })]);
    const { next, deduped } = reconcileInvoiceDuplicates(m);
    expect(deduped).toBe(0);
    expect(next.get('b')!.deleted).toBe(false);
  });

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

  it('property：調和後活記錄的發票號碼唯一、存活者是同號中最小 id、冪等、決定論', () => {
    fc.assert(
      fc.property(arbRecords, (m) => {
        const { next } = reconcileInvoiceDuplicates(m);
        // 活號碼唯一
        const seen = new Map<string, string>();
        for (const r of next.values()) {
          if (r.deleted || !r.invoice) continue;
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
        // 冪等
        const twice = reconcileInvoiceDuplicates(next);
        expect(twice.deduped).toBe(0);
        expect(twice.next).toBe(next);
        // 決定論：打亂插入序結果相同
        const shuffled = new Map([...m.entries()].reverse());
        const again = reconcileInvoiceDuplicates(shuffled);
        expect(new Map(again.next)).toEqual(new Map(next));
      }),
    );
  });
});
