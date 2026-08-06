/**
 * 備註相關的純聚合。
 *
 * **文案不在這裡**（「、」「等」「項」都不是）：core 不放顯示字是鐵律，而 strings/ 又是
 * 零 import 的葉檔不能反向引 core——所以 core 只吐資料結構，組字留給 client。
 */
import { monthOf, monthsBetween } from './rocdate';
import type { ExpenseRecord, InvoiceItem } from './types';

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

export interface NoteSuggestion {
  readonly note: string;
  /** 這個備註在該分類下出現過幾次（未刪除的） */
  readonly count: number;
  /** 最近一次使用的日期 'YYYY-MM-DD' */
  readonly lastUsed: string;
  /** 排序分數：各次使用依「距今幾個月」加權後相加 */
  readonly score: number;
}

/**
 * 距今月數 → 權重。整數表而非指數衰減：手機上一排籤條只需要「大致最近又常用」，
 * 浮點在這裡只會讓排序難以推理、也讓測試變成在測浮點誤差。滿一年就歸零（不再是常用詞）。
 */
function recencyWeight(monthsAgo: number): number {
  if (monthsAgo <= 0) return 6;
  if (monthsAgo === 1) return 4;
  if (monthsAgo === 2) return 3;
  if (monthsAgo <= 5) return 2;
  if (monthsAgo <= 11) return 1;
  return 0;
}

/**
 * 某分類下的常用備註（頻率 × 近期加權）——記一筆時給籤條用。
 *
 * `nowMonth` 由呼叫端餵入（core 不取時鐘）。跳過墓碑是**唯一**擋住
 * 「刪掉的備註還被推薦」的機制：墓碑會永遠留在 records Map 裡，note 也還在。
 *
 * `minCount` 是這支函式最要緊的參數：籤條的意思是「我常打這個」，所以要求出現 ≥2 次。
 * 它同時順手解決了品項自動備註的污染——那種備註幾乎每張發票都獨一無二，永遠上不了榜。
 */
export function suggestNotes(
  recs: Iterable<ExpenseRecord>,
  categoryId: string,
  nowMonth: string,
  limit: number,
  minCount: number,
): readonly NoteSuggestion[] {
  const acc = new Map<string, { count: number; lastUsed: string; score: number }>();
  for (const r of recs) {
    if (r.deleted || r.categoryId !== categoryId) continue;
    const note = r.note.trim();
    if (note === '') continue;
    // 未來日期夾成本月：不夾的話 monthsAgo 為負、權重表會誤判
    const monthsAgo = Math.max(0, monthsBetween(monthOf(r.date), nowMonth));
    const w = recencyWeight(monthsAgo);
    const cur = acc.get(note);
    if (cur) {
      cur.count += 1;
      cur.score += w;
      if (r.date > cur.lastUsed) cur.lastUsed = r.date;
    } else {
      acc.set(note, { count: 1, lastUsed: r.date, score: w });
    }
  }
  const out: NoteSuggestion[] = [];
  for (const [note, v] of acc) {
    if (v.count < minCount || v.score <= 0) continue;
    out.push({ note, count: v.count, lastUsed: v.lastUsed, score: v.score });
  }
  // 全決定性排序（同 sumByCategory 的紀律）：分數 → 最近用過 → 字典序
  out.sort((a, b) => b.score - a.score || (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0) || (a.note < b.note ? -1 : a.note > b.note ? 1 : 0));
  return out.slice(0, Math.max(0, Math.trunc(limit)));
}
