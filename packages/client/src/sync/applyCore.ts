/**
 * 對端資料套用的**純決策層**——P2P 批次與檔案匯入共用的唯一合併實作。
 *
 * 為什麼從 repo 抽出來（審查修正 #10/#13）：決策必須**同步**執行在
 * 「讀 store 現值 → 算 → set」同一個 task 內。舊版 get→await(IDB)→set 的快照競態
 * 會把同步窗內使用者剛記的一筆整張蓋掉。現在 slice 在 zustand 函式型 set 回呼裡
 * 呼叫這裡（純同步），落盤（repo.persistRows）排在 set 之後 await。
 */
import {
  mergeAll,
  reconcileInvoiceDuplicates,
  type ExpenseRecord,
  type MergeSummary,
  type Syncable,
} from '@zhangben/core';
import type { FreshEnvelope } from '@zhangben/core';

export interface ApplyDecision<T extends Syncable> {
  readonly next: ReadonlyMap<string, T>;
  readonly summary: MergeSummary;
  readonly deduped: number;
  /** 需要落盤的列（與 local 參考不等=被採納/被調和） */
  readonly changed: readonly T[];
  /** 被採納列的最小 updatedAt（''=本批無採納）——peers checkpoint 回撥的水位 */
  readonly minTaken: string;
}

export function decideIncoming<T extends Syncable>(
  local: ReadonlyMap<string, T>,
  incoming: readonly T[],
  /** records 專用：發票重複調和的 fresh envelope；其他 kind 傳 null */
  reconcileEnvelope: FreshEnvelope | null,
): ApplyDecision<T> {
  const merged = mergeAll(local, incoming);
  let next = merged.next;
  let deduped = 0;
  if (reconcileEnvelope) {
    const r = reconcileInvoiceDuplicates(
      next as unknown as ReadonlyMap<string, ExpenseRecord>,
      reconcileEnvelope,
    );
    next = r.next as unknown as ReadonlyMap<string, T>;
    deduped = r.deduped;
  }
  const changed: T[] = [];
  let minTaken = '';
  for (const [id, row] of next) {
    if (local.get(id) === row) continue;
    changed.push(row);
    if (minTaken === '' || row.updatedAt < minTaken) minTaken = row.updatedAt;
  }
  return { next, summary: merged.summary, deduped, changed, minTaken };
}
