/**
 * IndexedDB 的**唯一寫入口**。合併邏輯不住這裡（住 core/merge.ts）；
 * 這裡只做：開機載入（含首次 seed）、單筆寫穿、（M4）applyIncoming 批次合併落盤。
 *
 * 寫失敗策略：throw 給呼叫端（slice 捕捉後 errlog + saveFailed toast）——
 * 記憶體狀態已更新、IDB 沒跟上時使用者必須知道（帳本不能靜默掉筆）。
 */
import {
  seedCategories,
  type Budget,
  type Category,
  type ExpenseRecord,
  type MerchantRule,
  type Person,
  type Syncable,
} from '@zhangben/core';
import { getDb } from './db';

export interface LoadedState {
  readonly records: Map<string, ExpenseRecord>;
  readonly categories: Map<string, Category>;
  readonly rules: Map<string, MerchantRule>;
  readonly persons: Map<string, Person>;
  readonly budget: Budget | null;
}

/** 開機批次讀；首次啟動（categories 空）seed 內建八分類並落盤 */
export async function loadAll(): Promise<LoadedState> {
  const db = await getDb();
  const [recordRows, categoryRows, ruleRows, personRows, singletonRows] = await Promise.all([
    db.getAll('records'),
    db.getAll('categories'),
    db.getAll('rules'),
    db.getAll('persons'),
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
    persons: new Map(personRows.map((p) => [p.id, p])),
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

export async function putPerson(row: Person): Promise<void> {
  const db = await getDb();
  await db.put('persons', row);
}

export async function putBudget(row: Budget): Promise<void> {
  const db = await getDb();
  await db.put('singletons', row);
}

/* ── 同步落盤（決策層在 sync/applyCore.ts；這裡只負責寫） ── */

export type StoreName = 'records' | 'categories' | 'rules' | 'persons' | 'singletons';

/**
 * 批次落盤被採納的列（單一交易；失敗=整批 abort 並 throw——呼叫端走 apply-failed
 * 路徑，不存 checkpoint，下次同步重送）。records 的 changed 列已由 reconcile
 * 保證「墓碑無 invoice、活號碼唯一」，unique index 不會撞。
 * Map 迭代序使既存 id（含剝號墓碑）先於新附加的 incoming 列 put=先釋放索引再寫入。
 */
export async function persistRows<T extends Syncable>(store: StoreName, rows: readonly T[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  const tx = db.transaction(store, 'readwrite');
  for (const r of rows) void tx.store.put(r as never);
  await tx.done;
}

/* ── 同步對象（peers）——本機限定 meta ── */

export interface PeerInfo {
  readonly peerDeviceId: string;
  /** 對方的 Person.id：render 時優先用 persons.get(id)?.name（即時反映改名） */
  readonly peerPersonId: string;
  /** 名字快照（persons row 尚未同步到/被清時的 fallback） */
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

/**
 * checkpoint 回撥（審查修正 #3/#18）：合入「updatedAt 早於既存水位」的列時，
 * 若不回撥，這些列（第三來源：舊備份匯入、三裝置轉手）永遠不會轉送給其他 peer。
 * 降到嚴格小於 minTaken：去掉字尾一字元的真前綴在字典序必然較小。
 */
export async function lowerPeerCheckpoints(minTaken: string): Promise<readonly PeerInfo[]> {
  if (minTaken === '') return loadPeers();
  const db = await getDb();
  const raw = await db.get('meta', 'peers');
  const list = Array.isArray(raw) ? (raw as PeerInfo[]) : [];
  const lowered = minTaken.slice(0, -1);
  const next = list.map((p) => (p.lastSyncedAt >= minTaken ? { ...p, lastSyncedAt: lowered } : p));
  if (next.some((p, i) => p !== list[i])) await db.put('meta', next, 'peers');
  return next;
}
