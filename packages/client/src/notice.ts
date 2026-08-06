/**
 * App 層通知（module pub/sub，useSyncExternalStore 友善；移植自 sr2 notice.ts）。
 *
 * 四種通知：`updateReady`（常駐含「重新整理」鈕）、`saveFailed`（4s 自退）、
 * `saved`（記帳成功回饋，2s 自退）、`undo`（帶動作，5s 自退）。
 * 不進 zustand store——store 是帳本狀態的家，這是 app 殼層的事；
 * 且 storage.ts（零 import 葉檔）要能在 store 初始化之前就發通知。
 * **這個檔案零 import 的性質要維持**：動作只是個帶 closure 的普通物件，不破壞它。
 */

export type NoticeKind = 'updateReady' | 'saveFailed' | 'saved' | 'undo';

/** 通知上的動作鈕（目前只有「復原」）：按下即執行並關閉通知 */
export interface NoticeAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Notice {
  readonly kind: NoticeKind;
  /** saved/undo 用的顯示文字（如「已記一筆 $250」）；其餘 kind 用 strings 固定文案 */
  readonly text?: string;
  readonly action?: NoticeAction;
}

let current: Notice | null = null;
const listeners = new Set<() => void>();

export function show(kind: NoticeKind, text?: string): void {
  // updateReady 優先級高：不被其他通知蓋掉
  if (current?.kind === 'updateReady' && kind !== 'updateReady') return;
  current = text !== undefined ? { kind, text } : { kind };
  for (const l of listeners) l();
}

/**
 * 帶動作的通知（文字由呼叫端組——store 不組顯示文字）。
 * 沿用同一條 updateReady 優先規則：更新提示掛著時刪除就沒有復原鈕可按。
 * 可接受，因為刪除前本來就有 ConfirmDialog 擋著，不會有東西**靜默**消失。
 */
export function showAction(text: string, action: NoticeAction): void {
  if (current?.kind === 'updateReady') return;
  current = { kind: 'undo', text, action };
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
