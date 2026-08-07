/**
 * LWW（Last-Write-Wins）合併——全 app 唯一的合併實作。
 *
 * 為什麼只有這一份：兩台裝置要收斂到同一顆狀態，前提是「同樣的輸入必得同樣
 * 的裁決」。合併邏輯一旦散落多處（repo 一份、sync 一份），任何細微分歧都會
 * 讓兩機各執一詞、永不收斂。所以 client/db/repo.ts 只負責把這裡的結果寫回
 * IndexedDB，自己不做任何勝負判斷。
 *
 * 正確性不靠人眼：merge.test.ts 以 fast-check 性質測試證明冪等、交換、結合
 * ——這三條成立，任意同步順序（誰先連誰、重送幾次）都收斂到同一結果。
 *
 * HLC 比較：updatedAt 是 hlc.ts 的定寬編碼字串，定寬保證字典序即全序，
 * 所以這裡的 cmp() 與 hlcCompare 等價。刻意不 import hlc.ts——merge 只依賴
 * 「定寬 ⇒ 字串可比」這一條契約，對時鐘怎麼編碼零認知，兩個模組可以獨立演化。
 */

import type { Syncable } from './types';

/** 與 hlcCompare 等價（HLC 定寬編碼 ⇒ 字典序即全序），避免依賴並行開發中的 hlc.ts */
function cmp(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type MergeVerdict = 'take-incoming' | 'keep-local' | 'identical';

/**
 * 單筆裁決——整個同步系統的原子判斷。
 *
 * 墓碑無特例：deleted 只是資料欄位，勝負全看信封（updatedAt, deviceId）。
 * 這是「較晚的 edit 可以復活較早的 delete」的來源，也是交換律的前提——
 * 若 delete 有特權，兩邊以不同順序合併就會分歧。
 */
export function mergeRow<T extends Syncable>(local: T | undefined, incoming: T): MergeVerdict {
  // 本機沒有這筆 ⇒ 無條件收下（第一次見到的資料沒有可比的對象）
  if (local === undefined) return 'take-incoming';

  // 同 HLC 同裝置 ⇒ 同一顆事件（HLC 保證單裝置嚴格遞增，不可能撞號），
  // 不是衝突、不需要覆蓋——區分出來讓 summary 能誠實回報「沒事發生」
  if (incoming.updatedAt === local.updatedAt && incoming.deviceId === local.deviceId) {
    return 'identical';
  }

  const byTime = cmp(incoming.updatedAt, local.updatedAt);
  if (byTime !== 0) return byTime > 0 ? 'take-incoming' : 'keep-local';

  // HLC 平手但裝置不同：deviceId 字典序大者勝。誰勝不重要，
  // 重要的是兩台裝置對同一對資料裁決一致（決定性 tie-break ⇒ 全序 ⇒ 收斂）
  return cmp(incoming.deviceId, local.deviceId) > 0 ? 'take-incoming' : 'keep-local';
}

export interface MergeSummary {
  readonly added: number;
  readonly updated: number;
  readonly skipped: number;
  readonly deletes: number;
}

/**
 * 整批合併：把對方送來的列疊進本機狀態，回傳新 Map 與計數摘要。
 *
 * next 是新 Map、絕不改參數：呼叫端（Zustand store）靠參照相等偵測
 * 「狀態有沒有變」，原地改會讓 UI 錯過更新、也讓重試邏輯無法安全重放。
 */
export function mergeAll<T extends Syncable>(
  local: ReadonlyMap<string, T>,
  incoming: readonly T[],
): {
  readonly next: ReadonlyMap<string, T>;
  readonly summary: MergeSummary;
  /**
   * 實際被採納的 id。呼叫端要落盤的就是這些列——沒有這份清單就只能走訪整個
   * next 去比對參照，那是一趟 O(全帳) 的掃描，而同步是一批一批來的
   * ⇒ 掃描量變成 n × 批次數。
   */
  readonly taken: readonly string[];
} {
  const next = new Map(local);
  const taken: string[] = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let deletes = 0;

  for (const row of incoming) {
    // 對演進中的 next 裁決（而非原始 local）：incoming 內同 id 出現多次時，
    // 後到的要跟先前的勝者比，否則批次內較舊的列會倒車蓋掉較新的勝者
    const existing = next.get(row.id);
    const verdict = mergeRow(existing, row);

    if (verdict !== 'take-incoming') {
      // keep-local 與 identical 都算 skipped：對呼叫端而言都是「這筆沒動」
      skipped += 1;
      continue;
    }

    next.set(row.id, row);
    taken.push(row.id);
    if (existing === undefined) added += 1;
    if (existing !== undefined && !row.deleted) updated += 1;
    if (row.deleted) deletes += 1;
  }

  return { next, summary: { added, updated, skipped, deletes }, taken };
}

/**
 * 增量傳輸：只挑對方沒看過的列（updatedAt > sinceHlc，字典序）。
 *
 * sinceHlc='' 時退化為全量——不需要特例分支：HLC 定寬編碼必非空字串，
 * 任何列的 updatedAt 都 > ''，自然全數通過。
 */
export function changedSince<T extends Syncable>(rows: Iterable<T>, sinceHlc: string): T[] {
  const out: T[] = [];
  for (const row of rows) {
    if (cmp(row.updatedAt, sinceHlc) > 0) out.push(row);
  }
  return out;
}

/**
 * 墓碑回收：挑出可以物理清除的墓碑 id。
 *
 * 刪除必須先「傳染」到所有 peer 才能清墓碑，否則清太早的那台會在下次同步
 * 把已刪的列當新資料收回來（刪除失傳=復活 bug）。所以三個條件缺一不可：
 * (1) deleted——是墓碑；
 * (2) updatedAt < cutoffHlc——夠老，不會撞上還在路上的同步；
 * (3) 對每一個 peerCheckpoint 都 updatedAt <= checkpoint——所有 peer 都已看過。
 *
 * peerCheckpoints 為空 ⇒ 從沒同步過任何人 ⇒ 一律不可刪：
 * 沒人見過這顆墓碑就清掉，這筆刪除就永遠傳不出去了。
 */
export function purgeableTombstones<T extends Syncable>(
  rows: Iterable<T>,
  cutoffHlc: string,
  peerCheckpoints: readonly string[],
): string[] {
  if (peerCheckpoints.length === 0) return [];

  const out: string[] = [];
  for (const row of rows) {
    if (!row.deleted) continue;
    if (cmp(row.updatedAt, cutoffHlc) >= 0) continue;
    if (peerCheckpoints.every((cp) => cmp(row.updatedAt, cp) <= 0)) out.push(row.id);
  }
  return out;
}
