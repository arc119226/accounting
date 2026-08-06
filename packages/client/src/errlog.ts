/**
 * 錯誤環形日誌（**零 import 葉檔**；移植自 sr2 errlog.ts）。
 *
 * 零第三方=隱私聲明才能寫「不收集任何資料」——錯誤只存在使用者自己的
 * localStorage，經設定頁「複製診斷資訊」由使用者自主提供。
 *
 * **刻意不經 storage.ts 的 saveJson**：saveJson 失敗會觸發存檔失敗 toast，
 * 若 errlog 走它，「記錄錯誤」本身失敗會再觸發通知=遞迴風險。
 * 這裡自帶 try/catch 直寫，失敗就丟（日誌是 best-effort）。
 */

const KEY = 'zb.errlog';
const CAP = 20;

interface ErrEntry {
  readonly t: string;
  readonly v: string;
  readonly msg: string;
}

let lastMsg = '';
let lastAt = 0;

function append(msg: string, version: string): void {
  const now = Date.now();
  if (msg === lastMsg && now - lastAt < 60_000) return; // 同訊息 60s 去重（迴圈爆錯不灌爆）
  lastMsg = msg;
  lastAt = now;
  try {
    const raw = localStorage.getItem(KEY);
    const list: ErrEntry[] = raw ? (JSON.parse(raw) as ErrEntry[]) : [];
    list.push({ t: new Date().toISOString(), v: version, msg: msg.slice(0, 500) });
    while (list.length > CAP) list.shift();
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // best-effort：配額滿/隱私模式=放棄這條
  }
}

/** 手動記點（接不到 window error 的路徑用） */
export function logError(msg: string, version = ''): void {
  append(msg, version);
}

/** 讀出全部（診斷資訊用） */
export function readErrLog(): readonly { t: string; v: string; msg: string }[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ErrEntry[]) : [];
  } catch {
    return [];
  }
}

/** 掛全域監聽（main.tsx render 前呼一次）。ErrorBoundary 接不到的全在這：
 *  async、動態 import、unhandled promise。 */
export function initErrorLog(version: string): void {
  window.addEventListener('error', (e) => {
    const stack = e.error instanceof Error && e.error.stack ? '\n' + e.error.stack : '';
    append(String(e.message) + stack, version);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason;
    const msg = r instanceof Error ? r.message + (r.stack ? '\n' + r.stack : '') : String(r);
    append('unhandledrejection: ' + msg, version);
  });
}
