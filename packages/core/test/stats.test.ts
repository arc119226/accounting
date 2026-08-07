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
import { addMonths, daysInMonth, monthRange } from '../src/rocdate';
import type { ExpenseRecord } from '../src/types';
import { dailyTrend, monthSummary, sumByCategory, sumByMonth, sumByPerson } from '../src/stats';
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
  // v2：paidBy 是 Person.id（uuid）——小池子逼出同人多筆聚合
  paidBy: fc.constantFrom('p-alice', 'p-bob', 'p-caro'),
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
  readonly paidBy?: string;
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

/** 逐人重算：先收集出現過的人，再各自 filter+reduce（不共用 src 的單趟掃描） */
function refSumByPerson(recs: readonly ExpenseRecord[], range: DateRange): Map<string, number> {
  const live = recs.filter((r) => !r.deleted && range.from <= r.date && r.date <= range.to);
  const out = new Map<string, number>();
  for (const p of new Set(live.map((r) => r.paidBy))) {
    out.set(
      p,
      live.filter((r) => r.paidBy === p).reduce((s, r) => s + r.amount, 0),
    );
  }
  return out;
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
  it('任意記錄集與暴力法對照（Map 深等）', () => {
    fc.assert(
      fc.property(recsArb, rangeArb, (recs, range) => {
        expect(new Map(sumByPerson(recs, range))).toEqual(refSumByPerson(recs, range));
      }),
    );
  });

  it('空輸入回空 Map（人物清單由呼叫端補齊，core 不生零列）', () => {
    expect(sumByPerson([], { from: '2026-08-01', to: '2026-08-31' }).size).toBe(0);
  });

  it('range 端點含入、墓碑排除', () => {
    const range: DateRange = { from: '2026-08-01', to: '2026-08-31' };
    const recs = [
      mk({ date: '2026-08-01', paidBy: 'p-alice', amount: 10 }),
      mk({ date: '2026-08-31', paidBy: 'p-bob', amount: 20 }),
      mk({ date: '2026-08-15', paidBy: 'p-bob', amount: 999, deleted: true }),
      mk({ date: '2026-09-01', paidBy: 'p-alice', amount: 999 }), // 區間外
    ];
    expect(new Map(sumByPerson(recs, range))).toEqual(new Map([['p-alice', 10], ['p-bob', 20]]));
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

// ---------- monthSummary ----------

/**
 * 月結摘要——本月 vs 上月、變動最大的分類、最大單筆。
 * 一樣配暴力對照組：這裡最容易錯的是「桶算到隔壁月」與「movers 只看單邊分類」。
 */
describe('monthSummary', () => {
  const r = (over: Partial<ExpenseRecord> & { id: string; date: string; amount: number }): ExpenseRecord => ({
    updatedAt: '1',
    deviceId: 'x',
    deleted: false,
    categoryId: 'food',
    note: '',
    paidBy: 'p1',
    source: 'manual',
    ...over,
  });

  it('本月/上月合計、差額與百分比', () => {
    const s = monthSummary(
      [
        r({ id: 'a', date: '2026-08-01', amount: 300 }),
        r({ id: 'b', date: '2026-08-20', amount: 200 }),
        r({ id: 'c', date: '2026-07-15', amount: 400 }),
        r({ id: 'd', date: '2026-06-01', amount: 999 }), // 兩個月前：不列入
      ],
      '2026-08',
      3,
    );
    expect(s.total).toBe(500);
    expect(s.prevTotal).toBe(400);
    expect(s.delta).toBe(100);
    expect(s.deltaPct).toBe(25);
    expect(s.prevMonth).toBe('2026-07');
  });

  it('上月無記錄 ⇒ deltaPct 是 null（不是 Infinity 也不是 0）', () => {
    const s = monthSummary([r({ id: 'a', date: '2026-08-01', amount: 300 })], '2026-08', 3);
    expect(s.deltaPct).toBeNull();
    expect(s.delta).toBe(300);
  });

  /**
   * deltaPct 用四捨五入（away from zero）而非 Math.round（round-half-up，往 +∞）。
   * Math.round 會讓 −1.5% 收成 −1 而 +1.5% 收成 +2——同幅度的增與減顯示出不同的
   * 絕對值；−0.5% 更會得到 **−0**，畫面上長出「-0%」這種東西。
   */
  it('deltaPct：±.5 對稱捨入，且不產生 -0', () => {
    const pct = (prev: number, cur: number): number | null =>
      monthSummary(
        [
          r({ id: 'p', date: '2026-07-10', amount: prev }),
          r({ id: 'c', date: '2026-08-10', amount: cur }),
        ],
        '2026-08',
        3,
      ).deltaPct;
    expect(pct(200, 203)).toBe(2); // +1.5% → +2
    expect(pct(200, 197)).toBe(-2); // −1.5% → −2（Math.round 會給 −1）
    expect(pct(200, 199)).toBe(-1); // −0.5% → −1（Math.round 會給 −0）
    expect(pct(200, 201)).toBe(1); // +0.5% → +1
    expect(Object.is(pct(1000, 999), -0)).toBe(false); // −0.1% → 0，不是 −0
    expect(pct(1000, 999)).toBe(0);
  });

  it('movers 取兩月分類的聯集——這個月完全沒花的分類正是最該被看見的變動', () => {
    const s = monthSummary(
      [
        r({ id: 'a', date: '2026-07-01', amount: 5000, categoryId: 'travel' }),
        r({ id: 'b', date: '2026-08-01', amount: 100, categoryId: 'food' }),
      ],
      '2026-08',
      3,
    );
    expect(s.movers[0]).toEqual({ categoryId: 'travel', current: 0, previous: 5000, delta: -5000 });
    expect(s.movers[1]).toEqual({ categoryId: 'food', current: 100, previous: 0, delta: 100 });
  });

  it('delta=0 的分類不列；|delta| 同值時 categoryId 升冪（決定性）', () => {
    const s = monthSummary(
      [
        r({ id: 'a', date: '2026-07-01', amount: 100, categoryId: 'same' }),
        r({ id: 'b', date: '2026-08-01', amount: 100, categoryId: 'same' }),
        r({ id: 'c', date: '2026-08-02', amount: 50, categoryId: 'zzz' }),
        r({ id: 'd', date: '2026-08-03', amount: 50, categoryId: 'aaa' }),
      ],
      '2026-08',
      5,
    );
    expect(s.movers.map((m) => m.categoryId)).toEqual(['aaa', 'zzz']);
  });

  it('topMovers 截斷；<=0 回空', () => {
    const rows = ['a', 'b', 'c', 'd'].map((c, i) => r({ id: c, date: '2026-08-01', amount: (i + 1) * 100, categoryId: c }));
    expect(monthSummary(rows, '2026-08', 2).movers).toHaveLength(2);
    expect(monthSummary(rows, '2026-08', 0).movers).toHaveLength(0);
  });

  it('最大單筆：同額取 id 較小者；本月無記錄 ⇒ null', () => {
    const s = monthSummary(
      [r({ id: 'zz', date: '2026-08-01', amount: 900 }), r({ id: 'aa', date: '2026-08-02', amount: 900 })],
      '2026-08',
      3,
    );
    expect(s.largestId).toBe('aa');
    expect(s.largestAmount).toBe(900);
    expect(monthSummary([], '2026-08', 3).largestId).toBeNull();
  });

  it('墓碑全數排除——刪掉的大額記錄不可變成「本月最大一筆」', () => {
    const s = monthSummary(
      [
        r({ id: 'big', date: '2026-08-01', amount: 99999, deleted: true }),
        r({ id: 'real', date: '2026-08-02', amount: 100 }),
        r({ id: 'oldbig', date: '2026-07-01', amount: 88888, deleted: true }),
      ],
      '2026-08',
      3,
    );
    expect(s.largestId).toBe('real');
    expect(s.total).toBe(100);
    expect(s.prevTotal).toBe(0);
  });

  it('跨年：2026-01 的上月是 2025-12', () => {
    const s = monthSummary([r({ id: 'a', date: '2025-12-31', amount: 500 })], '2026-01', 3);
    expect(s.prevMonth).toBe('2025-12');
    expect(s.prevTotal).toBe(500);
  });

  it('性質：與暴力對照組等價', () => {
    fc.assert(
      fc.property(recsArb, monthArb, (recs, month) => {
        const got = monthSummary(recs, month, 3);
        const prevMonth = addMonths(month, -1);
        const live = recs.filter((x) => !x.deleted);
        const cur = live.filter((x) => x.date.slice(0, 7) === month);
        const prv = live.filter((x) => x.date.slice(0, 7) === prevMonth);
        const sum = (rows: ExpenseRecord[]) => rows.reduce((s, x) => s + x.amount, 0);
        expect(got.total).toBe(sum(cur));
        expect(got.prevTotal).toBe(sum(prv));
        expect(got.delta).toBe(sum(cur) - sum(prv));
        // deltaPct 不用 oracle 對照，改**斷言規格本身**（審查修正）：
        // 這裡原本寫 Math.round(...)，而 v5 已把實作改成 away-from-zero 且消掉 -0——
        // 於是這條在 fast-check 抽到 ±.5 邊界或「小負數捨入成 0」時會**間歇性**變紅
        // （-0 與 0 在 toBe 的 Object.is 下不相等）。抄一份實作當 oracle 只會讓它變成
        // 恆真的同義反覆，所以改成驗三條性質。
        if (sum(prv) === 0) {
          expect(got.deltaPct).toBeNull();
        } else {
          const exact = ((sum(cur) - sum(prv)) / sum(prv)) * 100;
          const pct = got.deltaPct!;
          expect(Number.isInteger(pct)).toBe(true);
          expect(Math.abs(pct - exact)).toBeLessThanOrEqual(0.5); // 捨入到最近的整數
          expect(Math.sign(pct) === 0 || Math.sign(pct) === Math.sign(exact)).toBe(true); // 不換號
          expect(Object.is(pct, -0)).toBe(false); // 畫面上不准出現「-0%」
        }
        // 最大單筆：同額取 id 最小
        const best = cur.reduce<ExpenseRecord | null>(
          (m, x) => (m === null || x.amount > m.amount || (x.amount === m.amount && x.id < m.id) ? x : m),
          null,
        );
        expect(got.largestId).toBe(best?.id ?? null);
        // movers：聯集、去零、|delta| 降冪 + id 升冪
        const cats = new Set([...cur, ...prv].map((x) => x.categoryId));
        const expected = [...cats]
          .map((categoryId) => {
            const c = sum(cur.filter((x) => x.categoryId === categoryId));
            const p = sum(prv.filter((x) => x.categoryId === categoryId));
            return { categoryId, current: c, previous: p, delta: c - p };
          })
          .filter((m) => m.delta !== 0)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.categoryId < b.categoryId ? -1 : 1))
          .slice(0, 3);
        expect(got.movers).toEqual(expected);
      }),
    );
  });
});

/**
 * 「算術不談判」——BACKLOG 原則一的機器版本。
 *
 * 上面每個函式各自對照一份暴力 oracle，鎖的是「這支函式忠於它自己的規格」。
 * 缺的是**跨切面**的那一條：同一個月的總和，不管從哪個角度切，都必須是同一個數。
 * 這正是原則一所依賴的機制——逐筆的自欺會在加總時露餡，前提是各處的加總對得起來。
 *
 * 這條測試同時是一道護欄：任何「把某類支出排除在統計外」「隱藏這筆」「估算金額」
 * 的功能，只要讓某一個切面的總和偏離其他切面，就會在這裡炸開，而不是等到某天
 * 有人發現月結卡跟排行榜對不起來。
 */
describe('算術不談判：同一個月的總和，從哪個角度切都一樣', () => {
  const sumVals = (xs: Iterable<number>): number => {
    let t = 0;
    for (const x of xs) t += x;
    return t;
  };

  it('property：分類切 = 人物切 = 逐日切 = 逐月切 = 月結卡', () => {
    fc.assert(
      fc.property(fc.array(recordArb, { maxLength: 60 }), monthArb, (recs, month) => {
        const range = monthRange(month);
        const byCategory = sumVals(sumByCategory(recs, range).map((c) => c.total));
        const byPerson = sumVals(sumByPerson(recs, range).values());
        const daily = dailyTrend(recs, month);
        const byDay = sumVals(daily.map((d) => d.total));
        const byMonth = sumByMonth(recs, 1, month)[0]!.total;
        const summary = monthSummary(recs, month, 3).total;

        expect(byPerson).toBe(byCategory);
        expect(byDay).toBe(byCategory);
        expect(byMonth).toBe(byCategory);
        expect(summary).toBe(byCategory);
        // 累積曲線的終點就是月合計（趨勢圖與排行榜不可以各說各話）
        expect(daily[daily.length - 1]!.cumulative).toBe(byCategory);
      }),
    );
  });

  it('property：monthSummary 的 delta 與 prevTotal 對得上 sumByMonth 的相鄰兩格', () => {
    fc.assert(
      fc.property(fc.array(recordArb, { maxLength: 60 }), monthArb, (recs, month) => {
        const two = sumByMonth(recs, 2, month);
        const s = monthSummary(recs, month, 3);
        expect(s.prevTotal).toBe(two[0]!.total);
        expect(s.total).toBe(two[1]!.total);
        expect(s.delta).toBe(s.total - s.prevTotal);
      }),
    );
  });
});
