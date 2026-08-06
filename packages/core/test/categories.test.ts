/**
 * categories.ts 測試。
 *
 * sortCategories 用 fast-check property test：排序正確性（升冪、tie-break、
 * 排除墓碑、穩定性）是對「任意輸入」的全稱命題，例題測試只能抽查；
 * 縮小 order/name 的取值域來強迫大量碰撞，才真的踩得到 tie-break 與
 * 穩定性的路徑。seed 與 suggestCategory 是有限狀態，例題測試即可窮盡。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Category, MerchantRule } from '../src/types';
import { BUILTIN_CATEGORIES, seedCategories, sortCategories, suggestCategory } from '../src/categories';

/** 與 src 同值的 HLC 最小值（測試端也寫死：驗證的就是這個字面值本身） */
const HLC_ZERO = '000000000000000-0000-0';

describe('BUILTIN_CATEGORIES', () => {
  it('恰好八筆，id/glyph/name/color/order 一字不差', () => {
    // 逐欄位攤平比對：seed 是跨版本契約，任何一位元漂移都要在此炸開
    expect(BUILTIN_CATEGORIES.map((c) => [c.id, c.glyph, c.name, c.color, c.order])).toEqual([
      ['cat-food', '食', '餐飲', '#b3502d', 1],
      ['cat-transport', '行', '交通', '#3d6b8e', 2],
      ['cat-home', '居', '居家', '#8a6a2f', 3],
      ['cat-clothes', '衣', '服飾', '#7d5a8e', 4],
      ['cat-med', '醫', '醫療', '#2e7d64', 5],
      ['cat-fun', '樂', '娛樂', '#c2762b', 6],
      ['cat-edu', '學', '教育', '#4a6b3a', 7],
      ['cat-misc', '雜', '其他', '#6e6046', 8],
    ]);
  });

  it('每筆信封欄位：updatedAt=HLC_ZERO、deviceId=seed、deleted=false、builtin=true', () => {
    for (const c of BUILTIN_CATEGORIES) {
      expect(c.updatedAt).toBe(HLC_ZERO);
      expect(c.deviceId).toBe('seed');
      expect(c.deleted).toBe(false);
      expect(c.builtin).toBe(true);
    }
  });
});

describe('seedCategories', () => {
  it('回傳 id→Category 的 Map，內容與 BUILTIN_CATEGORIES 一一對應', () => {
    const map = seedCategories();
    expect(map.size).toBe(BUILTIN_CATEGORIES.length);
    for (const c of BUILTIN_CATEGORIES) {
      expect(map.get(c.id)).toBe(c); // 淺複製：值共享同一個 frozen 單例
    }
  });

  it('每次呼叫回傳全新 Map，變異其一不影響其二', () => {
    const a = seedCategories();
    const b = seedCategories();
    expect(a).not.toBe(b);
    a.delete('cat-food');
    expect(b.has('cat-food')).toBe(true); // b 不受 a 的變異污染
    expect(seedCategories().has('cat-food')).toBe(true); // 之後的 seed 也不受影響
  });
});

describe('sortCategories', () => {
  /** 組測試用分類；order/name 由呼叫端指定以製造碰撞 */
  function cat(id: string, name: string, order: number, deleted = false): Category {
    return {
      id,
      updatedAt: HLC_ZERO,
      deviceId: 'test',
      deleted,
      name,
      glyph: '試',
      color: '#000000',
      order,
      builtin: false,
    };
  }

  // 取值域刻意縮小：order 只有 0..3、name 只有四個，才會頻繁撞出
  // 「同 order 比 name」與「order+name 全同靠穩定性」兩條路徑
  const arbCat = fc.record({
    name: fc.constantFrom('餐飲', '交通', '其他', '醫療'),
    order: fc.integer({ min: 0, max: 3 }),
    deleted: fc.boolean(),
  });

  /** 以陣列位置編 id：唯一 id 讓穩定性可以用「輸入索引」驗證 */
  const arbCats = fc
    .array(arbCat, { maxLength: 30 })
    .map((xs) => xs.map((x, i) => cat(`c${i}`, x.name, x.order, x.deleted)));

  it('property：排除墓碑，且輸出恰為輸入中所有未刪者（不多不少不改）', () => {
    fc.assert(
      fc.property(arbCats, (cats) => {
        const out = sortCategories(cats);
        const live = cats.filter((c) => !c.deleted);
        // 集合等價：輸出的 id 多重集合 = 未刪輸入的 id 多重集合
        expect([...out].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
          [...live].sort((a, b) => a.id.localeCompare(b.id)),
        );
      }),
    );
  });

  it('property：相鄰兩筆必為 order 升冪、同 order 則 name 依 zh-Hant 非降冪', () => {
    fc.assert(
      fc.property(arbCats, (cats) => {
        const out = sortCategories(cats);
        for (let i = 1; i < out.length; i++) {
          const prev = out[i - 1]!;
          const cur = out[i]!;
          expect(
            prev.order < cur.order ||
              (prev.order === cur.order && prev.name.localeCompare(cur.name, 'zh-Hant') <= 0),
          ).toBe(true);
        }
      }),
    );
  });

  it('property：穩定排序——order 與 name 全同者保持輸入相對順序', () => {
    fc.assert(
      fc.property(arbCats, (cats) => {
        const out = sortCategories(cats);
        const inputIndex = new Map(cats.map((c, i) => [c.id, i]));
        for (let i = 1; i < out.length; i++) {
          const prev = out[i - 1]!;
          const cur = out[i]!;
          if (prev.order === cur.order && prev.name === cur.name) {
            expect(inputIndex.get(prev.id)!).toBeLessThan(inputIndex.get(cur.id)!);
          }
        }
      }),
    );
  });

  it('property：不變異輸入（純函式）', () => {
    fc.assert(
      fc.property(arbCats, (cats) => {
        const snapshot = cats.map((c) => ({ ...c }));
        sortCategories(cats);
        expect(cats).toEqual(snapshot);
      }),
    );
  });

  it('seed 八分類排序後恰為 order 1..8 的原表順序', () => {
    expect(sortCategories(seedCategories().values()).map((c) => c.id)).toEqual([
      'cat-food',
      'cat-transport',
      'cat-home',
      'cat-clothes',
      'cat-med',
      'cat-fun',
      'cat-edu',
      'cat-misc',
    ]);
  });
});

describe('suggestCategory', () => {
  function rule(id: string, categoryId: string, deleted = false): MerchantRule {
    return {
      id,
      updatedAt: HLC_ZERO,
      deviceId: 'test',
      deleted,
      categoryId,
      displayName: `店-${id}`,
    };
  }

  // id=賣方統編（types.ts：MerchantRule 的 id 就是統編）
  const rules: ReadonlyMap<string, MerchantRule> = new Map([
    ['12345678', rule('12345678', 'cat-food')],
    ['87654321', rule('87654321', 'cat-transport', true)],
  ]);

  it('命中：回傳整條規則（呼叫端還需 displayName）', () => {
    const hit = suggestCategory(rules, '12345678');
    expect(hit).not.toBeNull();
    expect(hit!.categoryId).toBe('cat-food');
    expect(hit!.displayName).toBe('店-12345678');
  });

  it('未命中：查無此統編 → null', () => {
    expect(suggestCategory(rules, '00000000')).toBeNull();
  });

  it('已刪規則：墓碑視同不存在 → null', () => {
    expect(suggestCategory(rules, '87654321')).toBeNull();
  });

  it('統編 undefined（手動記帳／掃描缺欄）→ null', () => {
    expect(suggestCategory(rules, undefined)).toBeNull();
  });
});
