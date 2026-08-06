/**
 * 發票號碼重複調和——同一張實體發票被兩台手機各掃一次的收斂規則。
 *
 * 為什麼需要：合併以 id 為鍵，兩機各掃同一張發票=兩個不同 id、同 invoice.number
 * 的活記錄。不調和的話（a）帳面重複計費、（b）IDB 的 by-invoice unique index
 * 在落盤第二筆時直接 ConstraintError 把整場同步炸掉。
 *
 * 規則（**決定論**——兩側對同一合併結果各自執行必得相同輸出，這是免協調收斂的前提）：
 * 同 invoice.number 的活記錄中，**id 最小者存活**（uuidv7 時間有序=先掃的那筆贏），
 * 其餘轉墓碑並**剝除 invoice 欄位**（身分由 id 保存；留著號碼會撞 unique index）。
 * 信封 updatedAt/deviceId 刻意不動：兩側從相同輸入算出相同輸出，不需要新事件。
 */
import type { ExpenseRecord } from './types';

export interface ReconcileResult {
  readonly next: ReadonlyMap<string, ExpenseRecord>;
  /** 被轉墓碑的重複筆數（同步摘要的「去重」項） */
  readonly deduped: number;
}

export function reconcileInvoiceDuplicates(
  records: ReadonlyMap<string, ExpenseRecord>,
): ReconcileResult {
  // 先收集：號碼 → 活記錄 id 清單（排序後決定存活者；Map 迭代序不可依賴）
  const byNumber = new Map<string, string[]>();
  for (const r of records.values()) {
    if (r.deleted || !r.invoice) continue;
    const list = byNumber.get(r.invoice.number) ?? [];
    list.push(r.id);
    byNumber.set(r.invoice.number, list);
  }

  let deduped = 0;
  let next: Map<string, ExpenseRecord> | null = null; // 無重複=零配置直接回傳原 Map
  for (const ids of byNumber.values()) {
    if (ids.length < 2) continue;
    ids.sort(); // id 最小者存活
    for (const loserId of ids.slice(1)) {
      next ??= new Map(records);
      const loser = records.get(loserId)!;
      const { invoice: _dropped, ...rest } = loser;
      void _dropped;
      next.set(loserId, { ...rest, deleted: true });
      deduped += 1;
    }
  }
  return { next: next ?? records, deduped };
}
