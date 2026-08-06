/**
 * 金額格式化與輸入解析。
 *
 * 鐵律：金額 = 整數新台幣元（types.ts）。刻意**不用 toLocaleString**——
 * 它的輸出取決於執行環境的 locale/ICU 資料，core 必須決定論；
 * 千分位用純字串運算自己插，兩台裝置、任何環境輸出保證一致。
 */

/**
 * 輸入上限（99,999,999 元）：防手滑多打一位變天文數字污染帳本，
 * 也讓下游統計圖的軸刻度不會被單筆極端值撐爆。
 */
const MAX_AMOUNT = 99_999_999;

/** 千分位分組（輸入保證是非負整數的十進位字串）；regex 比迴圈短且無 off-by-one 空間 */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+$)/g, ',');
}

/**
 * 內部共用：截斷成整數再帶符號分組。
 * 契約上負數/小數不會出現，但顯示層不能被壞值弄炸：非有限數視為 0、小數 trunc。
 */
function formatInt(amount: number): string {
  const n = Number.isFinite(amount) ? Math.trunc(amount) : 0;
  const sign = n < 0 ? '-' : '';
  return sign + groupThousands(String(Math.abs(n)));
}

/** 金額顯示：1234 → '$1,234' */
export function formatNTD(amount: number): string {
  return '$' + formatInt(amount);
}

/** 無 '$' 版：1234 → '1,234'（圖表軸標空間有限，幣別由軸標題一次交代） */
export function formatAmount(amount: number): string {
  return formatInt(amount);
}

/** 全形數字 '０'..'９' → 半形（固定碼位偏移 0xFEE0）；台灣輸入法切到全形極常見 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 使用者輸入 → 整數元。
 * 容忍：千分位逗號（半形/全形）、全形數字、前後空白（trim 依規格含全形空白 U+3000）。
 * 拒絕（回 null）：空字串、負數、小數、任何非數字殘留、超過上限 99,999,999。
 * 逗號採「剝掉不驗位置」的寬容策略——'1,23' 也收：輸入框要的是讓人打得進去，
 * 不是懲罰漏打一位的分組強迫症。
 */
export function parseAmountInput(raw: string): number | null {
  const cleaned = toHalfWidthDigits(raw).trim().replace(/[,，]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (n > MAX_AMOUNT) return null;
  return n;
}
