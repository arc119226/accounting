/**
 * stats.ts 的正確性測試——暴力法對照（oracle）為主。
 *
 * 為什麼每個函式都配一份獨立暴力實作：聚合的 bug 多半是「桶建錯／範圍差一」
 * 這種兩份實作極難同時犯的錯；oracle 刻意用最直白的 filter+reduce 逐月/逐類/
 * 逐日重算（不共用 src 的掃描邏輯），fast-check 再灌隨機記錄集，
 * 等式成立就等於兩份語意互相背書。
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { DateRange } from '../src/rocdate';
import { addMonths, daysInMonth } from '../src/rocdate';
import type { ExpenseRecord, PersonId } from '../src/types';
import { dailyTrend, sumByCategory, sumByMonth, sumByPerson } from '../src/stats';
import type { CategoryTotal, DayPoint, MonthTotal } from '../src/stats';

// ---------- arbitraries ----------

/** 6 個分類池：小池子逼出同分類多筆聚合與同 total 排序 tie 的路徑 */
const CATEGORY_POOL = ['food', 'transport', 'housing', 'fun', 'medical', 'misc'] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 'YYYY-MM'，2024-01 ~ 2026-12 */
const monthArb = fc
  .tuple(fc.integer({ min: 2024, max: 2026 }), fc.integer({ min: 1, max: 12 }))
  .map(([y, m]) => `${y}-${pad2(m)}`);

/** 真實存在的 'YYYY-MM-DD'（2024-01-01 ~ 2026-12-31）；日上限查當月天數，不會生出 2/30 */
const dateArb = monthArb.chain((month) =>
  fc.integer({ min: 1, max: daysInMonth(month) }).map((d) => `${month}-${pad2(d)}`),
);

/** 墓碑「偶爾」為 true：偏重 false 讓多數記錄參與聚合，同時保證排除路徑常被踩到 */
const deletedArb = fc.oneof(
  { weight: 4, arbitrary: fc.constant(false) },
  { weight: 1, arbitrary: fc.constant(true) },
);

const recordArb: fc.Arbitrary<ExpenseRecord> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  updatedAt: fc.string({ minLength: 1, maxLength: 6 }),
  deviceId: fc.constantFrom('aaa', 'bbb'),
  deleted: deletedArb,
  // amount 含 0：total=0 的分類「不出現」契約要靠零金額記錄才踩得到
  amount: fc.integer({ min: 0, max: 99999 }),
  date: dateArb,
  categoryId: fc.constantFrom(...CATEGORY_POOL),
  note: fc.constant(''),
  paidBy: fc.constantFrom<PersonId>('A', 'B'),
  source: fc.constantFrom('manual', 'einvoice') as fc.Arbitrary<'manual' | 'einvoice'>,
});

const recsArb = fc.array(recordArb, { maxLength: 40 });

/** 端點自動排序成 from <= to 的閉區間 */
const rangeArb = fc
  .tuple(dateArb, dateArb)
  .map(([a, b]): DateRange => (a <= b ? { from: a, to: b } : { from: b, to: a }));

/** 測試用記錄工廠：只填聚合關心的欄位，其餘給固定預設 */
function mk(over: {
  readonly date: string;
  readonly amount?: number;
  readonly categoryId?: string;
  readonly paidBy?: PersonId;
  readonly deleted?: boolean;
}): ExpenseRecord {
  return {
    id: 'r',
    updatedAt: '0',
    deviceId: 'dev',
    deleted: false,
    amount: 100,
    categoryId: 'food',
    note: '',
    paidBy: 'A',
    source: 'manual',
    ...over,
  };
}

// ---------- 獨立暴力實作（oracle） ----------

/** 逐月重算：每個月各跑一次 filter+reduce，不共用 src 的單趟掃描 */
function refSumByMonth(
  recs: readonly ExpenseRecord[],
  months: number,
  endMonth: string,
): MonthTotal[] {
  if (months <= 0) return [];
  const out: MonthTotal[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const month = addMonths(endMonth, -i);
    const total = recs
      .filter((r) => !r.deleted && r.date.slice(0, 7) === month)
      .reduce((s, r) => s + r.amount, 0);
    out.push({ month, total });
  }
  return out;
}

/** 逐類重算：先收集出現過的分類，再各自 filter+reduce；total=0 過濾照契約字面 */
function refSumByCategory(recs: readonly ExpenseRecord[], range: DateRange): CategoryTotal[] {
  const live = recs.filter((r) => !r.deleted && range.from <= r.date && r.date <= range.to);
  const ids = [...new Set(live.map((r) => r.categoryId))];
  const rows = ids
    .map((categoryId) => {
      const hit = live.filter((r) => r.categoryId === categoryId);
      return {
        categoryId,
        total: hit.reduce((s, r) => s + r.amount, 0),
        count: hit.length,
      };
    })
    .filter((row) => row.total !== 0);
  rows.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;
    return a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0;
  });
  return rows;
}

/** A/B 各自 filter+reduce */
function refSumByPerson(
  recs: readonly ExpenseRecord[],
  range: DateRange,
): Readonly<Record<PersonId, number>> {
  const sumOf = (p: PersonId): number =>
    recs
      .filter((r) => !r.deleted && r.paidBy === p && range.from <= r.date && r.date <= range.to)
      .reduce((s, r) => s + r.amount, 0);
  return { A: sumOf('A'), B: sumOf('B') };
}

/** 逐日重算：每天各跑一次 filter+reduce（日期全等比對），cumulative 逐日累加 */
function refDailyTrend(recs: readonly ExpenseRecord[], month: string): DayPoint[] {
  const out: DayPoint[] = [];
  let cumulative = 0;
  for (let d = 1; d <= daysInMonth(month); d += 1) {
    const date = `${month}-${pad2(d)}`;
    const total = recs
      .filter((r) => !r.deleted && r.date === date)
      .reduce((s, r) => s + r.amount, 0);
    cumulative += total;
    out.push({ date, total, cumulative });
  }
  return out;
}

// ---------- sumByMonth ----------

describe('sumByMonth', () => {
  it('任意記錄集與暴力法逐月對照（含順序）', () => {
    fc.assert(
      fc.property(recsArb, fc.integer({ min: 0, max: 40 }), monthArb, (recs, months, end) => {
        expect(sumByMonth(recs, months, end)).toEqual(refSumByMonth(recs, months, end));
      }),
    );
  });

  it('形狀性質：長度=months、遞增連號、末列=endMonth', () => {
    fc.assert(
      fc.property(recsArb, fc.integer({ min: 1, max: 40 }), monthArb, (recs, months, end) => {
        const got = sumByMonth(recs, months, end);
        expect(got).toHaveLength(months);
        expect(got[got.length - 1]?.month).toBe(end);
        for (let i = 1; i < got.length; i += 1) {
          expect(got[i]?.month).toBe(addMonths(got[i - 1]?.month ?? '', 1));
        }
      }),
    );
  });

  it('months <= 0 回空陣列', () => {
    expect(sumByMonth([mk({ date: '2026-08-01' })], 0, '2026-08')).toEqual([]);
    expect(sumByMonth([mk({ date: '2026-08-01' })], -3, '2026-08')).toEqual([]);
  });

  it('無記錄的月份也有一列且為 0（跨年視窗）', () => {
    const recs = [mk({ date: '2025-12-31', amount: 7 }), mk({ date: '2026-02-01', amount: 5 })];
    expect(sumByMonth(recs, 3, '2026-02')).toEqual([
      { month: '2025-12', total: 7 },
      { month: '2026-01', total: 0 },
      { month: '2026-02', total: 5 },
    ]);
  });

  it('墓碑排除；視窗外記錄不影響', () => {
    const recs = [
      mk({ date: '2026-08-05', amount: 100 }),
      mk({ date: '2026-08-06', amount: 999, deleted: true }),
      mk({ date: '2026-07-31', amount: 50 }), // 視窗前一月，months=1 時不應入桶
    ];
    expect(sumByMonth(recs, 1, '2026-08')).toEqual([{ month: '2026-08', total: 100 }]);
  });

  it('空輸入：每月一列全 0', () => {
    expect(sumByMonth([], 2, '2026-01')).toEqual([
      { month: '2025-12', total: 0 },
      { month: '2026-01', total: 0 },
    ]);
  });
});

// ---------- sumByCategory ----------

describe('sumByCategory', () => {
  it('任意記錄集與暴力法逐類對照（含排序）', () => {
    fc.assert(
      fc.property(recsArb, rangeArb, (recs, range) => {
        expect(sumByCategory(recs, range)).toEqual(refSumByCategory(recs, range));
      }),
    );
  });

  it('range 端點含入：落在 from 與 to 當天的記錄都算', () => {
    const range: DateRange = { from: '2026-08-01', to: '2026-08-31' };
    const recs = [
      mk({ date: '2026-08-01', amount: 10 }),
      mk({ date: '2026-08-31', amount: 20 }),
      mk({ date: '2026-07-31', amount: 999 }), // 區間外
      mk({ date: '2026-09-01', amount: 999 }), // 區間外
    ];
    expect(sumByCategory(recs, range)).toEqual([{ categoryId: 'food', total: 30, count: 2 }]);
  });

  it('total 降冪、同 total 依 categoryId 升冪（決定性）', () => {
    const range: DateRange = { from: '2026-08-01', to: '2026-08-31' };
    const recs = [
      mk({ date: '2026-08-02', categoryId: 'transport', amount: 50 }),
      mk({ date: '2026-08-03', categoryId: 'food', amount: 50 }),
      mk({ date: '2026-08-04', categoryId: 'housing', amount: 80 }),
    ];
    expect(sumByCategory(recs, range)).toEqual([
      { categoryId: 'housing', total: 80, count: 1 },
      { categoryId: 'food', total: 50, count: 1 },
      { categoryId: 'transport', total: 50, count: 1 },
    ]);
  });

  it('total 為 0 的分類不出現（只有零金額記錄的分類也不出現）', () => {
    const range: DateRange = { from: '2026-08-01', to: '2026-08-31' };
    const recs = [
      mk({ date: '2026-08-02', categoryId: 'fun', amount: 0 }),
      mk({ date: '2026-08-03', categoryId: 'food', amount: 10 }),
    ];
    expect(sumByCategory(recs, range)).toEqual([{ categoryId: 'food', total: 10, count: 1 }]);
  });

  it('墓碑排除：只剩墓碑的分類沒有列', () => {
    const range: DateRange = { from: '2026-08-01', to: '2026-08-31' };
    const recs = [
      mk({ date: '2026-08-02', categoryId: 'fun', amount: 500, deleted: true }),
      mk({ date: '2026-08-03', categoryId: 'food', amount: 10 }),
      mk({ date: '2026-08-04', categoryId: 'food', amount: 30, deleted: true }),
    ];
    expect(sumByCategory(recs, range)).toEqual([{ categoryId: 'food', total: 10, count: 1 }]);
  });

  it('空輸入與空區間（from > to）都回空陣列', () => {
    expect(sumByCategory([], { from: '2026-08-01', to: '2026-08-31' })).toEqual([]);
    expect(
      sumByCategory([mk({ date: '2026-08-05' })], { from: '2026-08-31', to: '2026-08-01' }),
    ).toEqual([]);
  });
});

// ---------- sumByPerson ----------

describe('sumByPerson', () => {
  it('任意記錄集與暴力法對照', () => {
    fc.assert(
      fc.property(recsArb, rangeArb, (recs, range) => {
        expect(sumByPerson(recs, range)).toEqual(refSumByPerson(recs, range));
      }),
    );
  });

  it('A/B 都必有鍵：空輸入回 {A:0, B:0}', () => {
    expect(sumByPerson([], { from: '2026-08-01', to: '2026-08-31' })).toEqual({ A: 0, B: 0 });
  });

  it('range 端點含入、墓碑排除', () => {
    const range: DateRange = { from: '2026-08-01', to: '2026-08-31' };
    const recs = [
      mk({ date: '2026-08-01', paidBy: 'A', amount: 10 }),
      mk({ date: '2026-08-31', paidBy: 'B', amount: 20 }),
      mk({ date: '2026-08-15', paidBy: 'B', amount: 999, deleted: true }),
      mk({ date: '2026-09-01', paidBy: 'A', amount: 999 }), // 區間外
    ];
    expect(sumByPerson(recs, range)).toEqual({ A: 10, B: 20 });
  });
});

// ---------- dailyTrend ----------

describe('dailyTrend', () => {
  it('任意記錄集與暴力法逐日對照（含 cumulative）', () => {
    fc.assert(
      fc.property(recsArb, monthArb, (recs, month) => {
        expect(dailyTrend(recs, month)).toEqual(refDailyTrend(recs, month));
      }),
    );
  });

  it('形狀性質：長度=當月天數、日期連號遞增、cumulative=前綴和', () => {
    fc.assert(
      fc.property(recsArb, monthArb, (recs, month) => {
        const got = dailyTrend(recs, month);
        expect(got).toHaveLength(daysInMonth(month));
        let acc = 0;
        got.forEach((p, i) => {
          expect(p.date).toBe(`${month}-${pad2(i + 1)}`);
          acc += p.total;
          expect(p.cumulative).toBe(acc);
        });
      }),
    );
  });

  it('閏年 2 月 29 列、平年 28 列（空輸入也建滿桶）', () => {
    const leap = dailyTrend([], '2024-02');
    expect(leap).toHaveLength(29);
    expect(leap[28]).toEqual({ date: '2024-02-29', total: 0, cumulative: 0 });
    expect(dailyTrend([], '2026-02')).toHaveLength(28);
    expect(dailyTrend([], '2026-08')).toHaveLength(31);
  });

  it('cumulative 含當日；無消費日 total=0 但 cumulative 延續', () => {
    const recs = [
      mk({ date: '2026-02-01', amount: 10 }),
      mk({ date: '2026-02-01', amount: 5 }),
      mk({ date: '2026-02-03', amount: 20 }),
      mk({ date: '2026-02-02', amount: 999, deleted: true }), // 墓碑不畫進趨勢
      mk({ date: '2026-03-01', amount: 999 }), // 別的月不入桶
    ];
    const got = dailyTrend(recs, '2026-02');
    expect(got[0]).toEqual({ date: '2026-02-01', total: 15, cumulative: 15 });
    expect(got[1]).toEqual({ date: '2026-02-02', total: 0, cumulative: 15 });
    expect(got[2]).toEqual({ date: '2026-02-03', total: 20, cumulative: 35 });
    expect(got[27]?.cumulative).toBe(35);
  });
});
