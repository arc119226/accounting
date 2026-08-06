/**
 * 中性顏色工具葉檔——零依賴、純函數、決定論（移植自 sr2 color.ts）。
 * 圖表與分類色衍生共用同一份 hex 運算。
 */

/** 主色降明度（f=保留比例、0=黑、1=原色）。逐通道 round。 */
export function dimHex(color: number, f: number): number {
  const r = Math.round(((color >> 16) & 0xff) * f);
  const g = Math.round(((color >> 8) & 0xff) * f);
  const b = Math.round((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

/** 依 t 混向白（0=原色、1=白）。逐通道 round。 */
export function lightenHex(hex: number, t: number): number {
  const r = Math.round(((hex >> 16) & 0xff) + (255 - ((hex >> 16) & 0xff)) * t);
  const g = Math.round(((hex >> 8) & 0xff) + (255 - ((hex >> 8) & 0xff)) * t);
  const b = Math.round((hex & 0xff) + (255 - (hex & 0xff)) * t);
  return (r << 16) | (g << 8) | b;
}

/** 兩色線性混合（t=0 → a、t=1 → b）。逐通道 round。 */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (sh: number) => {
    const av = (a >> sh) & 0xff;
    const bv = (b >> sh) & 0xff;
    return Math.round(av + (bv - av) * t) << sh;
  };
  return ch(16) | ch(8) | ch(0);
}

/** number → '#rrggbb'（CSS 值用） */
export function hexToCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

/** '#rrggbb' → number；壞格式回 fallback */
export function cssToHex(css: string, fallback = 0x6e6046): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  return m ? parseInt(m[1]!, 16) : fallback;
}
