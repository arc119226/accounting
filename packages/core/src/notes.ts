/**
 * 備註相關的純聚合。
 *
 * **文案不在這裡**（「、」「等」「項」都不是）：core 不放顯示字是鐵律，而 strings/ 又是
 * 零 import 的葉檔不能反向引 core——所以 core 只吐資料結構，組字留給 client。
 */
import type { InvoiceItem } from './types';

export interface ItemDigest {
  /** 依原序去重、逐名截斷後的前 maxNames 個非空品名 */
  readonly names: readonly string[];
  /** 發票上的品項**行數**（原始 items.length，不去重也不扣空名）——「等N項」要照發票說話 */
  readonly total: number;
}

/**
 * 品項摘要：掃到的發票品項 → 可組成備註的前幾個品名。
 *
 * 截斷逐 code point 而非 slice：品名經 Big5／Base64 解出來可能含 surrogate pair，
 * 直接切字串會把一個字剖成兩半（比照 categories 的 glyph 處理）。
 * 去重比對的是**截斷後**的名字：「統一麵包A」「統一麵包B」截到 4 字都是「統一麵包」，
 * 備註裡不該出現兩次。
 */
export function digestItems(
  items: readonly InvoiceItem[],
  maxNames: number,
  maxNameChars: number,
): ItemDigest {
  const names: string[] = [];
  const seen = new Set<string>();
  const chars = Math.max(0, Math.trunc(maxNameChars));
  const limit = Math.max(0, Math.trunc(maxNames));
  for (const it of items) {
    if (names.length >= limit) break;
    const raw = it.name.trim();
    if (raw === '') continue;
    // trimEnd：截點落在空白上時會留下尾隨空白，它既難看也會讓去重鍵對不上
    const short = [...raw].slice(0, chars).join('').trimEnd();
    if (short === '' || seen.has(short)) continue;
    seen.add(short);
    names.push(short);
  }
  return { names, total: items.length };
}
