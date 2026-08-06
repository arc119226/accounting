/**
 * 統計聚合——把記錄集折成畫面直接可畫的形狀（月列、分類列、雙人合計、日趨勢）。
 *
 * **全部單趟掃描、先建滿桶再加總**：月/日序列的「每格必有一列（無記錄=0）」
 * 是圖表層的前提（手寫 SVG 折線不想再補洞），所以桶先照曆法生好、記錄只負責
 * 往桶裡加；分類則反過來「沒記錄就沒列」，因為本函式根本收不到分類清單，
 * 憑空生零列既不可能也沒意義。
 *
 * **墓碑一律排除**：deleted=true 是同步用的刪除標記（見 types.ts Syncable），
 * 不是支出；任何聚合把它算進去都等於把「已刪除」畫回圖上。
 *
 * 日期比較全用字串：'YYYY-MM-DD' 定寬零填充，字典序即時間序（types.ts 契約），
 * 不引入 Date 物件（見 rocdate.ts 的理由）。
 */

import { addMonths, daysInMonth, monthOf } from './rocdate';
import type { DateRange } from './rocdate';
import type { ExpenseRecord, PersonId } from './types';

/** 閉區間內（from <= date <= to，字串比較）；端點皆含（DateRange 契約） */
function inRange(date: string, range: DateRange): boolean {
  return range.from <= date && date <= range.to;
}

/** 兩位數零填充（rocdate 內部同名工具未匯出；日期格式契約要求定寬） */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export interface MonthTotal {
  readonly month: string;
  readonly total: number;
}

/**
 * 「endMonth 往前共 months 個月」的逐月合計，遞增序（含 endMonth 本月）。
 * 每月都有一列（無記錄=0）；months <= 0 回空陣列。
 *
 * 先把桶照曆法建滿再掃記錄：桶外的月份（更早或更晚）自然落不進 Map，
 * 不必另寫範圍判斷；Map 依插入序迭代，插入時由遠而近即是遞增序。
 */
export function sumByMonth(
  recs: Iterable<ExpenseRecord>,
  months: number,
  endMonth: string,
): readonly MonthTotal[] {
  if (months <= 0) return [];
  const buckets = new Map<string, number>();
  for (let i = months - 1; i >= 0; i -= 1) {
    buckets.set(addMonths(endMonth, -i), 0);
  }
  for (const r of recs) {
    if (r.deleted) continue;
    const key = monthOf(r.date);
    const cur = buckets.get(key);
    if (cur !== undefined) buckets.set(key, cur + r.amount);
  }
  return [...buckets.entries()].map(([month, total]) => ({ month, total }));
}

export interface CategoryTotal {
  readonly categoryId: string;
  readonly total: number;
  readonly count: number;
}

/**
 * range 閉區間內的分類合計。total 降冪、同 total 依 categoryId 升冪——
 * 排序完全由資料決定，兩台裝置合併收斂後畫出的排行榜必然一致（決定性契約）。
 * total 為 0 的分類不出現：金額契約是非負整數元，total=0 等於沒花錢，
 * 排行榜上不該佔位（沒記錄的分類更是連桶都不會生）。
 */
export function sumByCategory(
  recs: Iterable<ExpenseRecord>,
  range: DateRange,
): readonly CategoryTotal[] {
  const buckets = new Map<string, { total: number; count: number }>();
  for (const r of recs) {
    if (r.deleted || !inRange(r.date, range)) continue;
    const cur = buckets.get(r.categoryId);
    if (cur === undefined) {
      buckets.set(r.categoryId, { total: r.amount, count: 1 });
    } else {
      cur.total += r.amount;
      cur.count += 1;
    }
  }
  const rows: CategoryTotal[] = [];
  for (const [categoryId, { total, count }] of buckets) {
    if (total === 0) continue;
    rows.push({ categoryId, total, count });
  }
  rows.sort(
    (a, b) =>
      b.total - a.total ||
      (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0),
  );
  return rows;
}

/**
 * range 閉區間內 A/B 各自的付款合計。A/B 都必有鍵（無記錄=0）——
 * 分帳畫面直接取值不必判 undefined，也符合 PersonId 是封閉聯集的事實。
 */
export function sumByPerson(
  recs: Iterable<ExpenseRecord>,
  range: DateRange,
): Readonly<Record<PersonId, number>> {
  let a = 0;
  let b = 0;
  for (const r of recs) {
    if (r.deleted || !inRange(r.date, range)) continue;
    if (r.paidBy === 'A') a += r.amount;
    else b += r.amount;
  }
  return { A: a, B: b };
}

export interface DayPoint {
  readonly date: string;
  readonly total: number;
  readonly cumulative: number;
}

/**
 * 該月每一天的支出與累積（1 號到月底，天數由 rocdate.daysInMonth 決定，
 * 閏年 2 月自動 29 天），遞增序；cumulative 含當日。
 *
 * 每天必有一列（無記錄=0）：趨勢線是連續曲線，缺日會讓 SVG 折線在
 * 沒消費的日子斷開或斜率失真。日序桶用陣列（day-1 為索引）而非 Map：
 * 日子天生連續且已知上限，順序就是索引序。
 */
export function dailyTrend(recs: Iterable<ExpenseRecord>, month: string): readonly DayPoint[] {
  const days = daysInMonth(month);
  const totals: number[] = new Array<number>(days).fill(0);
  for (const r of recs) {
    if (r.deleted || monthOf(r.date) !== month) continue;
    const idx = Number(r.date.slice(8, 10)) - 1;
    const cur = totals[idx];
    // 日碼越界（壞資料）直接略過——core 的錯誤契約是不 throw
    if (cur !== undefined) totals[idx] = cur + r.amount;
  }
  const out: DayPoint[] = [];
  let cumulative = 0;
  for (let d = 1; d <= days; d += 1) {
    const total = totals[d - 1] ?? 0;
    cumulative += total;
    out.push({ date: `${month}-${pad2(d)}`, total, cumulative });
  }
  return out;
}
