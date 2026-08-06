/**
 * keyboardInset 的算術——會出錯的就是這裡（DOM 接線不測：沒有元件測試基建，
 * 而且接線只是把量到的數字寫進 CSS 變數）。
 *
 * 三種「視窗變矮」必須分得開：真的是鍵盤、瀏覽器工具列顯隱、使用者捏放縮放。
 * 誤判成鍵盤＝版面平白縮掉一截；漏判＝抽屜被鍵盤蓋住。
 */
import { describe, expect, it } from 'vitest';
import { keyboardInset, type ViewportSample } from '../src/keyboard';

const base: ViewportSample = { layoutHeight: 800, visualHeight: 800, offsetTop: 0, scale: 1 };

describe('keyboardInset', () => {
  it('鍵盤收起：0', () => {
    expect(keyboardInset(base)).toBe(0);
  });

  it('iOS 鍵盤開啟（版面視窗不縮、只有視覺視窗縮）：回落差', () => {
    expect(keyboardInset({ ...base, visualHeight: 464 })).toBe(336);
  });

  it('Android interactive-widget=resizes-content：版面視窗一起縮 ⇒ 回 0（不重複讓位）', () => {
    expect(keyboardInset({ ...base, layoutHeight: 464, visualHeight: 464 })).toBe(0);
  });

  it('工具列顯隱（落差 <120px 死區）不算鍵盤', () => {
    expect(keyboardInset({ ...base, visualHeight: 800 - 115 })).toBe(0);
    expect(keyboardInset({ ...base, visualHeight: 800 - 121 })).toBe(121);
  });

  it('捏放縮放讓視覺視窗變小——不是鍵盤，不讓位', () => {
    expect(keyboardInset({ ...base, visualHeight: 300, scale: 2 })).toBe(0);
  });

  it('offsetTop 要一起扣（捲動中的視覺視窗會下移）', () => {
    expect(keyboardInset({ ...base, visualHeight: 464, offsetTop: 100 })).toBe(236);
  });

  it('落差為負（視覺視窗比版面高，iOS 橡皮筋回彈時發生）：0，不可回負值', () => {
    expect(keyboardInset({ ...base, visualHeight: 900 })).toBe(0);
  });
});
