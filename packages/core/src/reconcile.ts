/**
 * 發票號碼重複調和——同一張實體發票被兩台手機各掃一次的收斂規則。
 *
 * 為什麼需要：合併以 id 為鍵，兩機各掃同一張發票=兩個不同 id、同 invoice.number
 * 的活記錄。不調和的話（a）帳面重複計費、（b）IDB 的 by-invoice unique index
 * 在落盤第二筆時直接 ConstraintError 把整場同步炸掉。
 *
 * 規則：同 invoice.number 的活記錄中，**id 最小者存活**（uuidv7 時間有序=先掃的
 * 那筆贏），其餘轉墓碑並**剝除 invoice 欄位**（身分由 id 保存；留著號碼會撞
 * unique index）。附帶自癒：任何「已刪卻仍帶 invoice」的墓碑一律剝號——
 * 舊版程式或對端可能落下這種墓碑，它們佔著索引會炸掉整批落盤。
 *
 * **信封必須換新**（審查修正）：敗者墓碑/剝號墓碑是**新事件**，由呼叫端供給
 * fresh envelope。沿用舊信封會產生「同信封、不同內容」的列——mergeRow 只比信封，
 * 會把它與對端持有的原內容誤判 identical，造成第三裝置永久分歧。
 * 兩側各自 mint 的競爭墓碑由 LWW tie-break 自然收斂；新 HLC 也不會被 checkpoint 濾掉。
 */
import type { ExpenseRecord, Syncable } from './types';

/** 呼叫端 mint 的新信封（core 決定論：不自取時間/裝置） */
export type FreshEnvelope = Pick<Syncable, 'updatedAt' | 'deviceId'>;

export interface ReconcileResult {
  readonly next: ReadonlyMap<string, ExpenseRecord>;
  /** 被轉墓碑的重複筆數（同步摘要的「去重」項；不含純剝號自癒） */
  readonly deduped: number;
}

export function reconcileInvoiceDuplicates(
  records: ReadonlyMap<string, ExpenseRecord>,
  envelope: FreshEnvelope,
): ReconcileResult {
  // 先收集：號碼 → 活記錄 id 清單（排序後決定存活者；Map 迭代序不可依賴）
  const byNumber = new Map<string, string[]>();
  let next: Map<string, ExpenseRecord> | null = null; // 無事可做=零配置直接回傳原 Map

  for (const r of records.values()) {
    if (r.deleted) {
      // 自癒：帶號墓碑剝除 invoice（釋放 unique index；重寫=新事件）
      if (r.invoice) {
        next ??= new Map(records);
        const { invoice: _dropped, ...rest } = r;
        void _dropped;
        next.set(r.id, { ...rest, ...envelope });
      }
      continue;
    }
    if (!r.invoice) continue;
    const list = byNumber.get(r.invoice.number) ?? [];
    list.push(r.id);
    byNumber.set(r.invoice.number, list);
  }

  let deduped = 0;
  for (const ids of byNumber.values()) {
    if (ids.length < 2) continue;
    ids.sort(); // id 最小者存活
    for (const loserId of ids.slice(1)) {
      next ??= new Map(records);
      const loser = records.get(loserId)!;
      const { invoice: _dropped, ...rest } = loser;
      void _dropped;
      next.set(loserId, { ...rest, deleted: true, ...envelope });
      deduped += 1;
    }
  }
  return { next: next ?? records, deduped };
}

/**
 * 墓碑復原（「刪掉了——復原」）：整列寫回、`deleted: false`、**換新信封**。
 *
 * 信封換新的理由與上面同一條：復原是新事件，LWW 於是天然贏過那個墓碑，
 * 跨裝置也成立（對方下次同步就把記錄接回去）。沿用舊信封則會被自己的墓碑蓋掉。
 *
 * 剝號的情況：刪除當下墓碑已被剝過 invoice，但**這期間可能同步收到對方那張同號的活記錄**。
 * 此時把號碼寫回去會撞 by-invoice unique index 讓整筆落盤失敗（等於復原鈕壞掉），
 * 所以偵測到號碼已被別的活記錄佔住就不還原 invoice——身分由 id 保存，items 照留。
 */
export function restoreRecord(
  records: ReadonlyMap<string, ExpenseRecord>,
  row: ExpenseRecord,
  envelope: FreshEnvelope,
): ExpenseRecord {
  const number = row.invoice?.number;
  if (number !== undefined) {
    for (const r of records.values()) {
      if (r.id !== row.id && !r.deleted && r.invoice?.number === number) {
        const { invoice: _taken, ...rest } = row;
        void _taken;
        return { ...rest, deleted: false, ...envelope };
      }
    }
  }
  return { ...row, deleted: false, ...envelope };
}
