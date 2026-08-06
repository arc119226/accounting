/**
 * 民國曆轉換與 ISO 月份運算——純字串進、純字串出的曆法工具。
 *
 * **曆法運算選純算術（大小月表＋閏年規則），不用 Date 物件**：
 * `new Date(Date.UTC(2020, 1, 30))` 會靜默滾動成 3 月 1 日，要驗證「日期真實存在」
 * 反而得再反查一次比對，繞一圈；查表＋閏年判斷一步到位，也完全不引入
 * epoch/時區概念（本 app 契約是裝置當地=台灣、不做時區運算，見 types.ts）。
 * 閏年規則（四年一閏、逢百不閏、逢四百又閏）自格里曆起恆真，民國年範圍內無例外。
 */

/** 'YYYY-MM-DD' 閉區間（from/to 皆含端點；stats/budget 的月篩選共用） */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** 格里曆閏年：四年一閏、逢百不閏、逢四百又閏 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 平年各月天數表；2 月的閏年修正集中在 daysInMonthOf 一處 */
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/**
 * 內部共用：西元年＋月（1..12）→ 天數。
 * 月不合法回 0——讓呼叫端「day >= 1 且 day <= 天數」的檢查自然失敗，不必重複驗月。
 */
function daysInMonthOf(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_PER_MONTH[month - 1] ?? 0;
}

/** 月/日兩位數零填充 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 民國日期（電子發票 QR 的 7 碼格式：3 碼年＋2 碼月＋2 碼日）→ ISO。
 * '1090312' → '2020-03-12'（民國年 + 1911 = 西元年；民國 99 = 2010）。
 *
 * 掃描來源不可信：長度錯、非數字、月 13、日 32、平年 2/29 一律回 null 不 throw——
 * core 的錯誤契約是「壞值回 null，怎麼提示由輸入層決定」。
 */
export function rocToISO(roc: string): string | null {
  if (!/^\d{7}$/.test(roc)) return null;
  const rocYear = Number(roc.slice(0, 3));
  const month = Number(roc.slice(3, 5));
  const day = Number(roc.slice(5, 7));
  // 民國元年 = 1，沒有民國 0 年；掃到 '000' 開頭必是壞資料
  if (rocYear < 1) return null;
  const year = rocYear + 1911;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonthOf(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** 'YYYY-MM-DD' 格式正確且該日期真實存在（含大小月、閏年檢查） */
export function isValidISODate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonthOf(year, month);
}

/** ISO 日期 → 月份鍵：'2026-08-15' → '2026-08'（stats 以此分桶，純切字串零成本） */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/**
 * 月份平移：'2026-01' + (-1) → '2025-12'。
 * 換算成「總月數」做整數加減再除回年月：跨年進退位天生正確，不必分支處理
 * （Math.floor 對負數往下取整，恰是曆法要的方向）。delta 先 trunc，
 * 防呼叫端誤傳小數讓 NaN 傳染進字串。
 */
export function addMonths(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const total = year * 12 + (mon - 1) + Math.trunc(delta);
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${pad2(m)}`;
}

/**
 * 兩個 'YYYY-MM' 相差幾個月（to − from；同月 0、to 較早為負）。
 * 與 addMonths 同一套「換算成總月數」的算術，跨年天生正確。
 */
export function monthsBetween(from: string, to: string): number {
  const fy = Number(from.slice(0, 4));
  const fm = Number(from.slice(5, 7));
  const ty = Number(to.slice(0, 4));
  const tm = Number(to.slice(5, 7));
  return (ty * 12 + tm) - (fy * 12 + fm);
}

/** 月份 → 該月閉區間（查當月記錄用）：'2026-02' → {from:'2026-02-01', to:'2026-02-28'} */
export function monthRange(month: string): DateRange {
  return { from: `${month}-01`, to: `${month}-${pad2(daysInMonth(month))}` };
}

/** 月份顯示字串：'2026-08' → '2026年8月'（月不補零——「08月」不合中文語感） */
export function formatMonthZh(month: string): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  return `${year}年${mon}月`;
}

/** 'YYYY-MM' 的天數（含閏年 2 月修正） */
export function daysInMonth(month: string): number {
  return daysInMonthOf(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
}
