/**
 * 預算進度聚合——當月花費對上每月上限。
 *
 * 為什麼收 Iterable 而非陣列：呼叫端（client store）手上常是 Map.values()，
 * 不必為了算進度先具體化成陣列；單趟走訪同時累出總額與各分類額，O(n) 一次到位。
 * 墓碑（deleted:true）一律排除——刪除的記錄只是同步用的殘影，不是支出。
 */

import type { Budget, ExpenseRecord } from './types';
import { monthOf } from './rocdate';

/** 單一分類的進度線：花了多少、上限多少（超支與否由顯示層自己比） */
export interface BudgetLine {
  readonly categoryId: string;
  readonly spent: number;
  readonly limit: number;
}

export interface BudgetProgress {
  readonly total: { readonly spent: number; readonly limit: number };
  readonly perCategory: readonly BudgetLine[];
}

/**
 * 該月（'YYYY-MM'）的預算進度。
 *
 * - budget 為 null 或本身是墓碑 ⇒ 視同「未設預算」：total.limit=0、perCategory 空。
 *   但 spent 照算——花費是既成事實，跟有沒有設預算無關，畫面上仍要能顯示當月總支出。
 * - perCategory 只列有設上限（>0）的分類：0 或缺鍵都是「未設」，列出來只是一排噪音；
 *   有上限但當月沒花的分類仍要列（spent=0 是「還有全額可花」的有效資訊）。
 * - 排序 limit 降冪（大額預算優先入眼）、同 limit 依 categoryId 升冪——
 *   物件鍵的走訪順序不可依賴，排序釘死才有決定論輸出。
 */
export function budgetProgress(
  recs: Iterable<ExpenseRecord>,
  budget: Budget | null,
  month: string,
): BudgetProgress {
  let totalSpent = 0;
  const spentByCategory = new Map<string, number>();
  for (const r of recs) {
    // 墓碑不是支出；跨月記錄不屬於本期
    if (r.deleted || monthOf(r.date) !== month) continue;
    totalSpent += r.amount;
    spentByCategory.set(r.categoryId, (spentByCategory.get(r.categoryId) ?? 0) + r.amount);
  }

  // 墓碑預算與 null 同路徑處理：同一種「未設」語意寫兩份分支遲早不同步
  const active = budget !== null && !budget.deleted ? budget : null;

  const perCategory: BudgetLine[] = [];
  if (active !== null) {
    for (const [categoryId, limit] of Object.entries(active.perCategory)) {
      if (limit > 0) {
        perCategory.push({ categoryId, spent: spentByCategory.get(categoryId) ?? 0, limit });
      }
    }
    perCategory.sort((a, b) =>
      a.limit !== b.limit
        ? b.limit - a.limit
        : a.categoryId < b.categoryId
          ? -1
          : a.categoryId > b.categoryId
            ? 1
            : 0,
    );
  }

  return {
    total: { spent: totalSpent, limit: active?.monthlyTotal ?? 0 },
    perCategory,
  };
}
