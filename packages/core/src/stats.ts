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
import type { ExpenseRecord } from './types';

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
 * range 閉區間內按人（Person.id）的付款合計。
 * v2：人物是開放集合（uuid），回 Map（personId → total）——只含出現過的人；
 * 「人物清單、含零額者」由呼叫端拿 persons store 自行補齊（core 收不到人物清單）。
 */
export function sumByPerson(
  recs: Iterable<ExpenseRecord>,
  range: DateRange,
): ReadonlyMap<string, number> {
  const buckets = new Map<string, number>();
  for (const r of recs) {
    if (r.deleted || !inRange(r.date, range)) continue;
    buckets.set(r.paidBy, (buckets.get(r.paidBy) ?? 0) + r.amount);
  }
  return buckets;
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

export interface CategoryDelta {
  readonly categoryId: string;
  readonly current: number;
  readonly previous: number;
  /** current − previous（正=這個月多花了） */
  readonly delta: number;
}

export interface MonthSummary {
  readonly month: string;
  readonly prevMonth: string;
  readonly total: number;
  readonly prevTotal: number;
  readonly delta: number;
  /**
   * 四捨五入到整數的百分比變化；prevTotal=0 時是 **null**（無從比較，UI 改講「上月無記錄」）。
   * 用 null 而非 optional：這個欄位畫面每次都要讀，省略它只會換來 exactOptionalPropertyTypes 的舞步。
   */
  readonly deltaPct: number | null;
  /** |delta| 降冪、同值 categoryId 升冪；delta=0 不列；至多 topMovers 筆 */
  readonly movers: readonly CategoryDelta[];
  /** 本月最大單筆的 id；同額取 id 較小者（決定性）；本月無記錄=null */
  readonly largestId: string | null;
  readonly largestAmount: number;
}

/**
 * 四捨五入（away from zero）——不是 `Math.round`。
 *
 * Math.round 是 round-half-up（往 +∞）：−1.5 進到 −1、+1.5 進到 +2，
 * 同幅度的增與減顯示出不同的絕對值；而且 Math.round(−0.5) 是 **−0**，
 * 畫面上會出現「-0%」。中文語境的「四捨五入」是 away from zero，
 * 這裡對齊使用者的預期。`|| 0` 把 −0 收成 0（Object.is(−0, 0) 為 false）。
 */
function roundHalfAway(x: number): number {
  return (Math.sign(x) * Math.round(Math.abs(x))) || 0;
}

/**
 * 月結摘要：本月 vs 上月、變動最大的幾個分類、本月最大單筆。
 *
 * 一趟掃完兩個月：月結卡是「回頭看一眼」的東西，不值得為它多掃幾遍全帳。
 * movers 取兩個月分類的**聯集**——某分類這個月完全沒花（上月花很多）正是最該被看見的變動。
 */
export function monthSummary(
  recs: Iterable<ExpenseRecord>,
  month: string,
  topMovers: number,
): MonthSummary {
  const prevMonth = addMonths(month, -1);
  const cur = new Map<string, number>();
  const prev = new Map<string, number>();
  let total = 0;
  let prevTotal = 0;
  let largestId: string | null = null;
  let largestAmount = 0;
  for (const r of recs) {
    if (r.deleted) continue;
    const m = monthOf(r.date);
    if (m === month) {
      total += r.amount;
      cur.set(r.categoryId, (cur.get(r.categoryId) ?? 0) + r.amount);
      // 同額取 id 較小者：uuidv7 時間有序＝先記的那筆，且結果與 Map 迭代序無關
      if (largestId === null || r.amount > largestAmount || (r.amount === largestAmount && r.id < largestId)) {
        largestAmount = r.amount;
        largestId = r.id;
      }
    } else if (m === prevMonth) {
      prevTotal += r.amount;
      prev.set(r.categoryId, (prev.get(r.categoryId) ?? 0) + r.amount);
    }
  }
  const movers: CategoryDelta[] = [];
  for (const categoryId of new Set([...cur.keys(), ...prev.keys()])) {
    const c = cur.get(categoryId) ?? 0;
    const p = prev.get(categoryId) ?? 0;
    if (c - p !== 0) movers.push({ categoryId, current: c, previous: p, delta: c - p });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.categoryId < b.categoryId ? -1 : 1));
  return {
    month,
    prevMonth,
    total,
    prevTotal,
    delta: total - prevTotal,
    deltaPct: prevTotal === 0 ? null : roundHalfAway(((total - prevTotal) / prevTotal) * 100),
    movers: movers.slice(0, Math.max(0, Math.trunc(topMovers))),
    largestId,
    largestAmount,
  };
}
