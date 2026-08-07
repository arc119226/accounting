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
  // 動過的 id：mergeAll 採納的 + reconcile 改寫的。
  // **不再走訪整個 next 去比對參照**（審查修正）——同步是一批 500 列、一批一批來的，
  // 每批都掃一次全帳 ⇒ 掃描量 n × ⌈n/500⌉。30,000 筆時那是幾百萬次操作，
  // 而觸發時機正是「換新手機第一次全量同步」。
  const taken = new Set<string>(merged.taken);
  let releasedIds: readonly string[] = [];
  if (reconcileEnvelope) {
    const r = reconcileInvoiceDuplicates(
      next as unknown as ReadonlyMap<string, ExpenseRecord>,
      reconcileEnvelope,
      taken,
    );
    next = r.next as unknown as ReadonlyMap<string, T>;
    deduped = r.deduped;
    releasedIds = r.changedIds;
  }
  /**
   * **順序是契約**：reconcile 動過的列一律排在 mergeAll 採納的列前面。
   *
   * reconcile 只會**釋放**發票號碼（自癒剝號、敗者轉墓碑並剝號），而 incoming 可能
   * **佔用**同一個號碼。同一個 IDB 交易裡若先 put 佔用者，by-invoice 的 unique index
   * 立刻 ConstraintError 把整批炸掉。
   *
   * 舊版是走訪整個 next 來湊 changed，而 `new Map(local)` 保留插入序、reconcile 的
   * next.set 不改既有位置 ⇒ 墓碑天然排在新列前面。那是**巧合成立**的，換成只走訪
   * 動過的列就會失去它（exportFile.test.ts 的回歸測試立刻抓到）。現在改成明寫。
   */
  const changed: T[] = [];
  const seen = new Set<string>();
  let minTaken = '';
  for (const id of [...releasedIds, ...taken]) {
    if (seen.has(id)) continue; // reconcile 可能改同一列兩次，或該列本來就在 incoming 裡
    seen.add(id);
    const row = next.get(id);
    // 與 local 同參照＝這一輪淨結果沒變，不必落盤
    if (row === undefined || local.get(id) === row) continue;
    changed.push(row);
    if (minTaken === '' || row.updatedAt < minTaken) minTaken = row.updatedAt;
  }
  return { next, summary: merged.summary, deduped, changed, minTaken };
}
