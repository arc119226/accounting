/**
 * App 層通知（module pub/sub，useSyncExternalStore 友善；移植自 sr2 notice.ts）。
 *
 * 三種通知：`updateReady`（常駐含「重新整理」鈕）、`saveFailed`（4s 自退）、
 * `saved`（記帳成功回饋，2s 自退）。
 * 不進 zustand store——store 是帳本狀態的家，這是 app 殼層的事；
 * 且 storage.ts（零 import 葉檔）要能在 store 初始化之前就發通知。
 */

export type NoticeKind = 'updateReady' | 'saveFailed' | 'saved';

export interface Notice {
  readonly kind: NoticeKind;
  /** saved 用的顯示文字（如「已記一筆 $250」）；其餘 kind 用 strings 固定文案 */
  readonly text?: string;
}

let current: Notice | null = null;
const listeners = new Set<() => void>();

export function show(kind: NoticeKind, text?: string): void {
  // updateReady 優先級高：不被其他通知蓋掉
  if (current?.kind === 'updateReady' && kind !== 'updateReady') return;
  current = text !== undefined ? { kind, text } : { kind };
  for (const l of listeners) l();
}

export function dismiss(): void {
  current = null;
  for (const l of listeners) l();
}

export function getNotice(): Notice | null {
  return current;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
