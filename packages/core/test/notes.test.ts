/**
 * digestItems——掃描來的品項壓成備註素材。
 *
 * 為什麼值得測：品名來自 Big5／Base64 解碼，是這個 app 裡最髒的字串來源
 * （含空白、重複、超長、surrogate pair）。而「等 N 項」的 N 若不等於發票行數，
 * 使用者看到的備註就在說謊。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { digestItems, suggestNotes } from '../src/notes';
import type { ExpenseRecord, InvoiceItem } from '../src/types';

const item = (name: string): InvoiceItem => ({ name, qty: 1, unitPrice: 10 });

let seq = 0;
function rec(over: Partial<ExpenseRecord> & { note: string; date: string }): ExpenseRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    updatedAt: '000000000000001-0000-t',
    deviceId: 't',
    deleted: false,
    amount: 100,
    categoryId: 'cat-food',
    paidBy: 'p1',
    source: 'manual',
    ...over,
  };
}

describe('digestItems', () => {
  it('取前 N 個品名，total 是發票的原始行數', () => {
    const d = digestItems([item('鮮乳'), item('雞蛋'), item('吐司'), item('咖啡'), item('鹽')], 3, 6);
    expect(d.names).toEqual(['鮮乳', '雞蛋', '吐司']);
    expect(d.total).toBe(5);
  });

  it('依原序去重（同一張發票常同品項多行）', () => {
    const d = digestItems([item('鮮乳'), item('雞蛋'), item('鮮乳')], 3, 6);
    expect(d.names).toEqual(['鮮乳', '雞蛋']);
    // total 不去重：發票上確實是 3 行
    expect(d.total).toBe(3);
  });

  it('去重比對的是截斷後的名字（「統一麵包A/B」截到 4 字是同一個）', () => {
    const d = digestItems([item('統一麵包A'), item('統一麵包B')], 3, 4);
    expect(d.names).toEqual(['統一麵包']);
  });

  it('空白／純空白品名剔除，但仍計入 total', () => {
    const d = digestItems([item(''), item('   '), item('鮮乳')], 3, 6);
    expect(d.names).toEqual(['鮮乳']);
    expect(d.total).toBe(3);
  });

  it('逐 code point 截斷：不把 surrogate pair 剖一半', () => {
    const d = digestItems([item('🍎🍊🍇🍓')], 1, 2);
    expect(d.names).toEqual(['🍎🍊']);
    expect([...d.names[0]!]).toHaveLength(2);
  });

  it('邊界：空品項、maxNames<=0、maxNameChars=0', () => {
    expect(digestItems([], 3, 6)).toEqual({ names: [], total: 0 });
    expect(digestItems([item('鮮乳')], 0, 6).names).toEqual([]);
    expect(digestItems([item('鮮乳')], 3, 0).names).toEqual([]);
  });

  it('names 全取得完時 total === 名字數（呼叫端據此決定要不要加「等N項」）', () => {
    const d = digestItems([item('鮮乳'), item('雞蛋')], 5, 6);
    expect(d.names).toHaveLength(2);
    expect(d.total).toBe(2);
  });

  it('性質：names 不超過 limit、全部去重、每個都是某品名的前綴、total 恆等於行數', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ maxLength: 12 }).map(item), { maxLength: 20 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 8 }),
        (items, maxNames, maxChars) => {
          const d = digestItems(items, maxNames, maxChars);
          expect(d.total).toBe(items.length);
          expect(d.names.length).toBeLessThanOrEqual(maxNames);
          expect(new Set(d.names).size).toBe(d.names.length);
          for (const n of d.names) {
            expect([...n].length).toBeLessThanOrEqual(maxChars);
            expect(items.some((it) => it.name.trim().startsWith(n))).toBe(true);
          }
        },
      ),
    );
  });
});

/**
 * suggestNotes——記一筆時的常用備註籤條。
 *
 * 對照組（oracle）刻意用最直白的 filter+reduce 逐備註重算，不共用 src 的單趟掃描：
 * 聚合的 bug 多半是「桶建錯／權重套錯月份」，兩份實作極難同時犯同一個錯。
 */
describe('suggestNotes', () => {
  const NOW = '2026-08';

  it('同分類、出現 ≥minCount 次的備註才上榜；次數多的排前面', () => {
    const out = suggestNotes(
      [
        rec({ note: '午餐', date: '2026-08-01' }),
        rec({ note: '午餐', date: '2026-08-03' }),
        rec({ note: '午餐', date: '2026-08-05' }),
        rec({ note: '早餐', date: '2026-08-02' }),
        rec({ note: '早餐', date: '2026-08-04' }),
        rec({ note: '只打過一次', date: '2026-08-06' }),
      ],
      'cat-food',
      NOW,
      6,
      2,
    );
    expect(out.map((s) => s.note)).toEqual(['午餐', '早餐']);
    expect(out[0]!.count).toBe(3);
    expect(out[0]!.lastUsed).toBe('2026-08-05');
  });

  it('minCount=2 讓「每張發票都獨一無二」的品項自動備註永遠上不了榜', () => {
    const out = suggestNotes(
      [
        rec({ note: '鮮乳、雞蛋…等4項', date: '2026-08-01' }),
        rec({ note: '吐司、咖啡…等3項', date: '2026-08-02' }),
        rec({ note: '青菜、豆腐…等5項', date: '2026-08-03' }),
      ],
      'cat-food',
      NOW,
      6,
      2,
    );
    expect(out).toEqual([]);
  });

  it('墓碑不列入——刪掉的備註不該還被推薦（note 會永遠留在 Map 裡）', () => {
    const out = suggestNotes(
      [
        rec({ note: '刪掉的', date: '2026-08-01', deleted: true }),
        rec({ note: '刪掉的', date: '2026-08-02', deleted: true }),
        rec({ note: '還在的', date: '2026-08-01' }),
        rec({ note: '還在的', date: '2026-08-02' }),
      ],
      'cat-food',
      NOW,
      6,
      2,
    );
    expect(out.map((s) => s.note)).toEqual(['還在的']);
  });

  it('別的分類不混入（籤條是跟著當下選的分類走的）', () => {
    const out = suggestNotes(
      [
        rec({ note: '油錢', date: '2026-08-01', categoryId: 'cat-transport' }),
        rec({ note: '油錢', date: '2026-08-02', categoryId: 'cat-transport' }),
        rec({ note: '午餐', date: '2026-08-01' }),
        rec({ note: '午餐', date: '2026-08-02' }),
      ],
      'cat-food',
      NOW,
      6,
      2,
    );
    expect(out.map((s) => s.note)).toEqual(['午餐']);
  });

  it('滿一年沒用過的備註歸零分＝下架，即使次數再多', () => {
    const old = Array.from({ length: 10 }, (_, i) => rec({ note: '去年的', date: `2025-07-0${(i % 9) + 1}` }));
    const out = suggestNotes([...old, rec({ note: '最近的', date: '2026-08-01' }), rec({ note: '最近的', date: '2026-08-02' })], 'cat-food', NOW, 6, 2);
    expect(out.map((s) => s.note)).toEqual(['最近的']);
  });

  it('近期加權勝過純次數：本月 2 次贏過半年前 3 次', () => {
    const out = suggestNotes(
      [
        rec({ note: '本月', date: '2026-08-01' }),
        rec({ note: '本月', date: '2026-08-02' }),
        rec({ note: '半年前', date: '2026-02-01' }),
        rec({ note: '半年前', date: '2026-02-02' }),
        rec({ note: '半年前', date: '2026-02-03' }),
      ],
      'cat-food',
      NOW,
      6,
      2,
    );
    expect(out.map((s) => s.note)).toEqual(['本月', '半年前']);
  });

  it('空白備註不算；未來日期不會產生負權重', () => {
    const out = suggestNotes(
      [
        rec({ note: '   ', date: '2026-08-01' }),
        rec({ note: '   ', date: '2026-08-02' }),
        rec({ note: '未來', date: '2026-12-01' }),
        rec({ note: '未來', date: '2026-12-02' }),
      ],
      'cat-food',
      NOW,
      6,
      2,
    );
    expect(out.map((s) => s.note)).toEqual(['未來']);
    expect(out[0]!.score).toBeGreaterThan(0);
  });

  it('limit 生效；limit<=0 回空', () => {
    const rows = ['a', 'b', 'c'].flatMap((n) => [rec({ note: n, date: '2026-08-01' }), rec({ note: n, date: '2026-08-02' })]);
    expect(suggestNotes(rows, 'cat-food', NOW, 2, 2)).toHaveLength(2);
    expect(suggestNotes(rows, 'cat-food', NOW, 0, 2)).toHaveLength(0);
  });

  it('性質：與暴力對照組等價，且排序全決定性（分數→最近→字典序）', () => {
    const noteArb = fc.constantFrom('午餐', '早餐', '咖啡', '停車', '');
    const dateArb = fc
      .tuple(fc.integer({ min: 2025, max: 2026 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
      .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ note: noteArb, date: dateArb, deleted: fc.boolean(), categoryId: fc.constantFrom('cat-food', 'cat-fun') }).map(rec),
          { maxLength: 40 },
        ),
        (rows) => {
          const got = suggestNotes(rows, 'cat-food', NOW, 6, 2);
          // oracle：逐備註 filter + reduce
          const live = rows.filter((r) => !r.deleted && r.categoryId === 'cat-food' && r.note.trim() !== '');
          const notes = [...new Set(live.map((r) => r.note.trim()))];
          const w = (d: string): number => {
            const a = Math.max(0, monthsBetweenLocal(d.slice(0, 7), NOW));
            return a === 0 ? 6 : a === 1 ? 4 : a === 2 ? 3 : a <= 5 ? 2 : a <= 11 ? 1 : 0;
          };
          const expected = notes
            .map((note) => {
              const mine = live.filter((r) => r.note.trim() === note);
              return {
                note,
                count: mine.length,
                lastUsed: mine.reduce((m, r) => (r.date > m ? r.date : m), ''),
                score: mine.reduce((s, r) => s + w(r.date), 0),
              };
            })
            .filter((s) => s.count >= 2 && s.score > 0)
            .sort((a, b) => b.score - a.score || (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0) || (a.note < b.note ? -1 : 1))
            .slice(0, 6);
          expect(got).toEqual(expected);
        },
      ),
    );
  });
});

/** oracle 專用（刻意不引 src 的實作） */
function monthsBetweenLocal(from: string, to: string): number {
  return (Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7))) - (Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)));
}
