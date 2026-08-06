/**
 * IndexedDB 的**唯一寫入口**。合併邏輯不住這裡（住 core/merge.ts）；
 * 這裡只做：開機載入（含首次 seed）、單筆寫穿、（M4）applyIncoming 批次合併落盤。
 *
 * 寫失敗策略：throw 給呼叫端（slice 捕捉後 errlog + saveFailed toast）——
 * 記憶體狀態已更新、IDB 沒跟上時使用者必須知道（帳本不能靜默掉筆）。
 */
import {
  mergeAll,
  reconcileInvoiceDuplicates,
  seedCategories,
  type Budget,
  type Category,
  type ExpenseRecord,
  type MergeSummary,
  type MerchantRule,
  type Syncable,
} from '@zhangben/core';
import { getDb } from './db';

export interface LoadedState {
  readonly records: Map<string, ExpenseRecord>;
  readonly categories: Map<string, Category>;
  readonly rules: Map<string, MerchantRule>;
  readonly budget: Budget | null;
}

/** 開機批次讀；首次啟動（categories 空）seed 內建八分類並落盤 */
export async function loadAll(): Promise<LoadedState> {
  const db = await getDb();
  const [recordRows, categoryRows, ruleRows, singletonRows] = await Promise.all([
    db.getAll('records'),
    db.getAll('categories'),
    db.getAll('rules'),
    db.getAll('singletons'),
  ]);

  let categories = new Map(categoryRows.map((c) => [c.id, c]));
  if (categories.size === 0) {
    categories = seedCategories();
    const tx = db.transaction('categories', 'readwrite');
    for (const c of categories.values()) void tx.store.put(c);
    await tx.done;
  }

  return {
    records: new Map(recordRows.map((r) => [r.id, r])),
    categories,
    rules: new Map(ruleRows.map((r) => [r.id, r])),
    budget: singletonRows.find((s) => s.id === 'budget') ?? null,
  };
}

export async function putRecord(row: ExpenseRecord): Promise<void> {
  const db = await getDb();
  await db.put('records', row);
}

export async function putCategory(row: Category): Promise<void> {
  const db = await getDb();
  await db.put('categories', row);
}

export async function putRule(row: MerchantRule): Promise<void> {
  const db = await getDb();
  await db.put('rules', row);
}

export async function putBudget(row: Budget): Promise<void> {
  const db = await getDb();
  await db.put('singletons', row);
}

/* ── 同步套用（P2P 與檔案匯入共用的**唯一**合併落盤路徑） ── */

type StoreName = 'records' | 'categories' | 'rules' | 'singletons';

/**
 * 對單一 store 套用一批對端資料：core mergeAll 裁決 → 只落盤被採納的列。
 * records 額外過 reconcileInvoiceDuplicates（兩機各掃同一張發票的收斂；
 * 不做的話 by-invoice unique index 會在落盤時把整場同步炸掉）。
 * 「被採納」以參考不等判定：mergeAll 的 next 只在 take-incoming 時換物件。
 */
export async function applyIncoming<T extends Syncable>(
  store: StoreName,
  local: ReadonlyMap<string, T>,
  incoming: readonly T[],
): Promise<{ readonly next: ReadonlyMap<string, T>; readonly summary: MergeSummary; readonly deduped: number }> {
  const merged = mergeAll(local, incoming);
  let next = merged.next;
  let deduped = 0;
  if (store === 'records') {
    // 泛型 T 在 records 分支實際上就是 ExpenseRecord；TS 看不穿執行期分派，過 unknown 橋接
    const r = reconcileInvoiceDuplicates(next as unknown as ReadonlyMap<string, ExpenseRecord>);
    next = r.next as unknown as ReadonlyMap<string, T>;
    deduped = r.deduped;
  }
  const changed: T[] = [];
  for (const [id, row] of next) if (local.get(id) !== row) changed.push(row);
  if (changed.length > 0) {
    const db = await getDb();
    const tx = db.transaction(store, 'readwrite');
    for (const r of changed) void tx.store.put(r as never);
    await tx.done;
  }
  return { next, summary: merged.summary, deduped };
}

/* ── 同步對象（peers）——本機限定 meta ── */

export interface PeerInfo {
  readonly peerDeviceId: string;
  readonly label: string;
  /** HLC checkpoint：下次增量同步的 changedSince 基準 */
  readonly lastSyncedAt: string;
  /** 顯示「上次同步：3 天前」用的牆鐘 */
  readonly lastSyncWallMs: number;
}

export async function loadPeers(): Promise<readonly PeerInfo[]> {
  const db = await getDb();
  const raw = await db.get('meta', 'peers');
  return Array.isArray(raw) ? (raw as PeerInfo[]) : [];
}

export async function savePeer(peer: PeerInfo): Promise<readonly PeerInfo[]> {
  const db = await getDb();
  const raw = await db.get('meta', 'peers');
  const list = Array.isArray(raw) ? (raw as PeerInfo[]) : [];
  const next = [...list.filter((p) => p.peerDeviceId !== peer.peerDeviceId), peer];
  await db.put('meta', next, 'peers');
  return next;
}
