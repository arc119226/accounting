/**
 * budget.ts 的正確性驗證——暴力法對照（brute-force oracle）為主。
 *
 * 為什麼用獨立重寫的參考實作：budgetProgress 為了效能走單趟累加＋Map，
 * oracle 刻意用最直白的 filter/reduce 逐分類重算；兩份獨立實作同時
 * 犯同一個錯的機率極低，深比較相等即是語意正確的強證據。
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Budget, ExpenseRecord } from '../src/types';
import { budgetProgress } from '../src/budget';
import type { BudgetProgress } from '../src/budget';
import { daysInMonth } from '../src/rocdate';

// ---------- arbitraries ----------

/** 6 個分類池：池小才容易撞出「同分類多筆」與「budget 鍵有/無對應記錄」兩種路徑 */
const CATEGORY_POOL = ['food', 'transport', 'home', 'fun', 'health', 'misc'] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM'（2024-01 ~ 2026-12）；月份池與日期池同源，查詢月才會頻繁命中記錄 */
const monthArb = fc
  .record({ y: fc.integer({ min: 2024, max: 2026 }), m: fc.integer({ min: 1, max: 12 }) })
  .map(({ y, m }) => `${y}-${pad2(m)}`);

/** 'YYYY-MM-DD'（2024-01-01 ~ 2026-12-31）；日先抽 1..31 再夾到當月天數，涵蓋月底邊界 */
const dateArb = fc
  .record({ month: monthArb, d: fc.integer({ min: 1, max: 31 }) })
  .map(({ month, d }) => `${month}-${pad2(Math.min(d, daysInMonth(month)))}`);

/** deleted 偶爾 true（1/4）：太常刪整批變空、太少刪測不到墓碑排除 */
const deletedArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant(false) },
  { weight: 1, arbitrary: fc.constant(true) },
);

const recordArb: fc.Arbitrary<ExpenseRecord> = fc.record({
  id: fc.uuid(),
  updatedAt: fc.constant('00000000'),
  deviceId: fc.constantFrom('aaa', 'bbb'),
  deleted: deletedArb,
  amount: fc.integer({ min: 0, max: 99999 }),
  date: dateArb,
  categoryId: fc.constantFrom(...CATEGORY_POOL),
  note: fc.constant(''),
  paidBy: fc.constantFrom('p-alice', 'p-bob'),
  source: fc.constantFrom<'manual' | 'einvoice'>('manual', 'einvoice'),
});

const recsArb = fc.array(recordArb, { maxLength: 30 });

/**
 * perCategory 用「隨機 (分類, 上限) 對」疊成物件：天然含缺鍵（沒抽到）、
 * 0 值（上限抽到 0）、與池外分類（'ghost' 沒有任何記錄會命中）三種邊界。
 */
const perCategoryArb: fc.Arbitrary<Readonly<Record<string, number>>> = fc
  .array(
    fc.tuple(
      fc.constantFrom(...CATEGORY_POOL, 'ghost'),
      fc.integer({ min: 0, max: 99999 }),
    ),
    { maxLength: 8 },
  )
  .map((pairs) => Object.fromEntries(pairs));

const budgetArb: fc.Arbitrary<Budget> = fc.record({
  id: fc.constant('budget'),
  updatedAt: fc.constant('00000000'),
  deviceId: fc.constantFrom('aaa', 'bbb'),
  deleted: deletedArb,
  monthlyTotal: fc.integer({ min: 0, max: 999999 }),
  perCategory: perCategoryArb,
});

const budgetOrNullArb: fc.Arbitrary<Budget | null> = fc.option(budgetArb, { nil: null });

// ---------- 獨立參考實作（oracle） ----------

/** 刻意不 import monthOf——oracle 連日期切法都獨立，才算兩份實作 */
function refBudgetProgress(
  recs: readonly ExpenseRecord[],
  budget: Budget | null,
  month: string,
): BudgetProgress {
  const live = recs.filter((r) => !r.deleted && r.date.slice(0, 7) === month);
  const spentOf = (cat: string): number =>
    live.filter((r) => r.categoryId === cat).reduce((s, r) => s + r.amount, 0);
  const unset = budget === null || budget.deleted;
  const perCategory = unset
    ? []
    : Object.entries(budget.perCategory)
        .filter(([, limit]) => limit > 0)
        .map(([categoryId, limit]) => ({ categoryId, spent: spentOf(categoryId), limit }))
        .sort((a, b) =>
          b.limit - a.limit !== 0
            ? b.limit - a.limit
            : a.categoryId.localeCompare(b.categoryId, 'en'),
        );
  return {
    total: {
      spent: live.reduce((s, r) => s + r.amount, 0),
      limit: unset ? 0 : budget.monthlyTotal,
    },
    perCategory,
  };
}

// ---------- 例題用建構器 ----------

function rec(date: string, amount: number, categoryId: string, deleted = false): ExpenseRecord {
  return {
    id: `${date}|${categoryId}|${amount}`,
    updatedAt: '00000000',
    deviceId: 'aaa',
    deleted,
    amount,
    date,
    categoryId,
    note: '',
    paidBy: 'A',
    source: 'manual',
  };
}

function bud(
  monthlyTotal: number,
  perCategory: Readonly<Record<string, number>>,
  deleted = false,
): Budget {
  return { id: 'budget', updatedAt: '00000000', deviceId: 'aaa', deleted, monthlyTotal, perCategory };
}

// ---------- property：暴力法對照 ----------

describe('budgetProgress 對照暴力法', () => {
  it('任意記錄集 × 任意 budget（含 null）× 任意月份，與 oracle 深等', () => {
    fc.assert(
      fc.property(recsArb, budgetOrNullArb, monthArb, (recs, budget, month) => {
        expect(budgetProgress(recs, budget, month)).toEqual(refBudgetProgress(recs, budget, month));
      }),
    );
  });

  it('Iterable 一般性：餵 generator 與餵陣列結果相同（單趟走訪不依賴陣列方法）', () => {
    fc.assert(
      fc.property(recsArb, budgetOrNullArb, monthArb, (recs, budget, month) => {
        function* gen(): Generator<ExpenseRecord> {
          yield* recs;
        }
        expect(budgetProgress(gen(), budget, month)).toEqual(budgetProgress(recs, budget, month));
      }),
    );
  });

  it('墓碑零影響：先過濾掉 deleted 再算，結果不變', () => {
    fc.assert(
      fc.property(recsArb, budgetOrNullArb, monthArb, (recs, budget, month) => {
        const alive = recs.filter((r) => !r.deleted);
        expect(budgetProgress(recs, budget, month)).toEqual(budgetProgress(alive, budget, month));
      }),
    );
  });

  it('perCategory 排序不變量：limit 降冪、同 limit 依 categoryId 升冪、無重覆分類', () => {
    fc.assert(
      fc.property(recsArb, budgetArb, monthArb, (recs, budget, month) => {
        const { perCategory } = budgetProgress(recs, budget, month);
        for (let i = 1; i < perCategory.length; i += 1) {
          const prev = perCategory[i - 1];
          const cur = perCategory[i];
          if (prev === undefined || cur === undefined) throw new Error('unreachable');
          expect(
            prev.limit > cur.limit ||
              (prev.limit === cur.limit && prev.categoryId < cur.categoryId),
          ).toBe(true);
        }
        const ids = perCategory.map((l) => l.categoryId);
        expect(new Set(ids).size).toBe(ids.length);
      }),
    );
  });
});

// ---------- 例題：釘死契約字面 ----------

describe('budgetProgress 例題', () => {
  const recs = [
    rec('2026-08-01', 100, 'food'),
    rec('2026-08-15', 250, 'food'),
    rec('2026-08-20', 40, 'transport'),
    rec('2026-08-31', 999, 'home', true), // 墓碑：不計
    rec('2026-07-31', 500, 'food'), // 前一月：不計
    rec('2026-09-01', 700, 'food'), // 後一月：不計
  ];

  it('null budget：limit 0、perCategory 空，但 spent 照算', () => {
    expect(budgetProgress(recs, null, '2026-08')).toEqual({
      total: { spent: 390, limit: 0 },
      perCategory: [],
    });
  });

  it('deleted budget：與 null 同語意（墓碑預算不是預算）', () => {
    const b = bud(10000, { food: 3000 }, true);
    expect(budgetProgress(recs, b, '2026-08')).toEqual({
      total: { spent: 390, limit: 0 },
      perCategory: [],
    });
  });

  it('perCategory 含 0 與缺鍵：0=未設不列；缺鍵不列；有上限沒花費列 spent 0', () => {
    const b = bud(10000, { food: 3000, transport: 0, health: 500 });
    // transport 上限 0 → 不列（雖然當月有花 40）；home 缺鍵 → 不列；
    // health 有上限但當月沒半筆 → 仍列、spent 0
    expect(budgetProgress(recs, b, '2026-08')).toEqual({
      total: { spent: 390, limit: 10000 },
      perCategory: [
        { categoryId: 'food', spent: 350, limit: 3000 },
        { categoryId: 'health', spent: 0, limit: 500 },
      ],
    });
  });

  it('排序：limit 降冪、同 limit 依 categoryId 升冪', () => {
    const b = bud(0, { misc: 100, food: 100, home: 900 });
    const { perCategory } = budgetProgress([], b, '2026-08');
    expect(perCategory).toEqual([
      { categoryId: 'home', spent: 0, limit: 900 },
      { categoryId: 'food', spent: 0, limit: 100 },
      { categoryId: 'misc', spent: 0, limit: 100 },
    ]);
  });

  it('跨月記錄不計入：查 2026-07 只看到 7 月那筆', () => {
    const b = bud(1000, { food: 600 });
    expect(budgetProgress(recs, b, '2026-07')).toEqual({
      total: { spent: 500, limit: 1000 },
      perCategory: [{ categoryId: 'food', spent: 500, limit: 600 }],
    });
  });

  it('空記錄集：spent 全 0，perCategory 仍照 budget 列', () => {
    const b = bud(5000, { food: 1200 });
    expect(budgetProgress([], b, '2026-08')).toEqual({
      total: { spent: 0, limit: 5000 },
      perCategory: [{ categoryId: 'food', spent: 0, limit: 1200 }],
    });
  });
});
