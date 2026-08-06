/**
 * @zhangben/core barrel——純領域邏輯的唯一出口。
 * M2+ 陸續補：stats / budget / einvoice。
 */
export type {
  Budget,
  Category,
  ExpenseRecord,
  InvoiceItem,
  MerchantRule,
  Person,
  Syncable,
} from './types';
export {
  HLC_ZERO,
  hlcCompare,
  hlcEncode,
  hlcInit,
  hlcParse,
  hlcRecv,
  hlcTick,
  type Hlc,
} from './hlc';
export {
  addMonths,
  daysInMonth,
  formatMonthZh,
  isValidISODate,
  monthOf,
  monthRange,
  monthsBetween,
  rocToISO,
  type DateRange,
} from './rocdate';
export { formatAmount, formatNTD, parseAmountInput } from './money';
export {
  BUILTIN_CATEGORIES,
  seedCategories,
  sortCategories,
  suggestCategory,
} from './categories';
export {
  changedSince,
  mergeAll,
  mergeRow,
  purgeableTombstones,
  type MergeSummary,
  type MergeVerdict,
} from './merge';
export {
  dailyTrend,
  sumByCategory,
  sumByMonth,
  sumByPerson,
  type CategoryTotal,
  type DayPoint,
  type MonthTotal,
} from './stats';
export { budgetProgress, type BudgetLine, type BudgetProgress } from './budget';
export { digestItems, suggestNotes, type ItemDigest, type NoteSuggestion } from './notes';
export {
  reconcileInvoiceDuplicates,
  restoreRecord,
  type FreshEnvelope,
  type ReconcileResult,
} from './reconcile';
export {
  looksLikeEInvoiceLeft,
  looksLikeEInvoiceRight,
  mergeRightQr,
  parseEInvoiceLeft,
  type EInvoiceError,
  type ParsedInvoice,
} from './einvoice';
