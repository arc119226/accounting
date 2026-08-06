/**
 * 分類籤條顯示名的截斷。
 *
 * 為什麼值得測：籤條是直書 + nowrap，「不換行的方向」是**高度**且沒有上限，
 * 所以這個截斷是版面的唯一防線；而分類名是使用者自由輸入、可能含 surrogate pair
 * （emoji 分類名），直接 slice 會把一個字剖成兩半。
 */
import { describe, expect, it } from 'vitest';
import { catTagName, CAT_TAG_CHARS } from '../src/catTag';

describe('catTagName', () => {
  it('不超過上限的原樣回傳（內建八分類都是 2 字）', () => {
    expect(catTagName('餐飲')).toBe('餐飲');
    expect(catTagName('水電瓦斯')).toBe('水電瓦斯');
  });

  it('超過上限截到前 4 字，**不加省略號**（U+2026 在直書下會被立起來，像印壞）', () => {
    expect(catTagName('水電瓦斯費用')).toBe('水電瓦斯');
    expect(catTagName('一二三四五六七八')).toBe('一二三四');
  });

  it('逐 code point 截斷：不把 surrogate pair 剖一半', () => {
    const out = catTagName('🍎🍊🍇🍓🍑🍍');
    expect([...out]).toHaveLength(CAT_TAG_CHARS);
    expect(out).toBe('🍎🍊🍇🍓');
  });

  it('空字串與短字串安全', () => {
    expect(catTagName('')).toBe('');
    expect(catTagName('食')).toBe('食');
  });
});
