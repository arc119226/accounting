/**
 * 版本識別與更新偵測（移植自 sr2 version.ts）。
 *
 * 為什麼需要：hashed chunk 部署新版後會清掉舊檔，**舊分頁的動態 import
 * （掃描頁 lazy chunk）會直接失敗**——沒有偵測的話使用者只看到功能斷裂。
 * 輪詢 version.json 是使用者可見的「新版本已就緒」提示；M5 的 SW precache
 * 負責離線可用，兩者並存不衝突。
 *
 * version.json 由 vite build 產出（vite.config 的 zb-version-json plugin），
 * `_headers` 對它 no-store=永遠拿到最新。SPA fallback 會把缺檔回成 index.html
 * → JSON.parse 失敗走 catch 靜默=dev/缺檔天然安全。
 */
import { show } from './notice';

export const APP_VERSION = __APP_VERSION__;

let notified = false;

/** 查一次伺服器版本；不同（或 chunk 已失敗）→ 通知一次 */
export async function checkForUpdate(): Promise<void> {
  if (import.meta.env.DEV || notified) return;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    const data: unknown = await res.json();
    const id = (data as { id?: unknown }).id;
    if (typeof id === 'string' && id !== APP_VERSION) {
      notified = true;
      show('updateReady');
    }
  } catch {
    // 拿不到 version.json=部署間隙或離線；靜默，下次再查
  }
}

/**
 * 動態 import 失敗（掃描頁 chunk）的鉤子：十之八九=新版部署清掉舊 chunk。
 * 立即查版本；**連 version.json 都拿不到時也通知**（舊分頁大概率已經跟伺服器脫節）。
 */
export function noteChunkLoadFailure(): void {
  if (import.meta.env.DEV || notified) return;
  void (async () => {
    try {
      const res = await fetch('/version.json', { cache: 'no-store' });
      const data: unknown = await res.json();
      const id = (data as { id?: unknown }).id;
      if (typeof id !== 'string' || id !== APP_VERSION) {
        notified = true;
        show('updateReady');
      }
    } catch {
      notified = true;
      show('updateReady');
    }
  })();
}

/** 排程：轉可見時查 + 每 10 分鐘一查（DEV 早退）。main.tsx 呼一次 */
export function initUpdateCheck(): void {
  if (import.meta.env.DEV) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => void checkForUpdate(), 10 * 60 * 1000);
}
