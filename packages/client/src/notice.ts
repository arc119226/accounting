/**
 * App 層通知（module pub/sub，useSyncExternalStore 友善；移植自 sr2 notice.ts）。
 *
 * 四種通知：`updateReady`（常駐含「重新整理」與關閉鈕）、`saveFailed`（4s 自退）、
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

/**
 * **兩個槽**（審查修正）：`sticky` 放狀態、`current` 放事件。
 *
 * 舊版只有一個槽，而 updateReady 是常駐不自退的 ⇒ 它一掛上去就吞掉整個 session 的
 * 其他通知。舊註解說「可接受，因為刪除前本來就有 ConfirmDialog 擋著」——
 * 那個推理是錯的：ConfirmDialog 擋的是**誤觸**，而復原鈕是為了**刪錯筆**存在的
 * （你確定要刪，只是刪到了不該刪的那一筆）。兩者防的不是同一件事。
 *
 * 實際會怎麼走到：離線 ⇒ 掃描頁的 lazy chunk 抓不到 ⇒ noteChunkLoadFailure ⇒
 * updateReady 常駐 ⇒ 這個 session 剩下的時間裡刪除沒有復原、入帳沒有回饋、存檔失敗靜默。
 *
 * 現在：事件永遠優先顯示，自退後狀態自己回來。UI 仍只有一個 toast 元素
 * （v4 那套三態定位不動）。
 */
let current: Notice | null = null;
let sticky: Notice | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function show(kind: NoticeKind, text?: string): void {
  const n: Notice = text !== undefined ? { kind, text } : { kind };
  if (kind === 'updateReady') sticky = n;
  else current = n;
  emit();
}

/** 帶動作的通知（文字由呼叫端組——store 不組顯示文字）。永遠壓過 sticky。 */
export function showAction(text: string, action: NoticeAction): void {
  current = { kind: 'undo', text, action };
  emit();
}

/** 關掉眼前這則。事件退場後 sticky（若有）自己回來 */
export function dismiss(): void {
  if (current !== null) current = null;
  else sticky = null;
  emit();
}

/** 明確收掉常駐通知（更新提示的關閉鈕） */
export function dismissSticky(): void {
  sticky = null;
  emit();
}

export function getNotice(): Notice | null {
  return current ?? sticky;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
