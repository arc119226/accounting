/**
 * digestItems——掃描來的品項壓成備註素材。
 *
 * 為什麼值得測：品名來自 Big5／Base64 解碼，是這個 app 裡最髒的字串來源
 * （含空白、重複、超長、surrogate pair）。而「等 N 項」的 N 若不等於發票行數，
 * 使用者看到的備註就在說謊。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { digestItems } from '../src/notes';
import type { InvoiceItem } from '../src/types';

const item = (name: string): InvoiceItem => ({ name, qty: 1, unitPrice: 10 });

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
