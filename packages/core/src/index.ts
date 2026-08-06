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
  PersonId,
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
