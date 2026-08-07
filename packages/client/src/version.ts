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
 * 立即查版本；連 version.json 都拿不到時**也**通知（舊分頁大概率已經跟伺服器脫節）——
 * 但**離線例外**：真的沒網路時我們根本不知道伺服器有沒有新版，謊稱有新版的代價很大
 * （那個 toast 是常駐的，而且會壓在畫面底部）。checkForUpdate 的 catch 一向是靜默的，
 * 兩處對同一個失敗本來就不該給相反的判斷。
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
      if (navigator.onLine === false) return; // 離線＝不知道，不是「有新版」
      notified = true;
      show('updateReady');
    }
  })();
}

/* ── Service Worker：自己註冊與接線（vite.config 的 injectRegister: null） ──
 *
 * 為什麼不能只 location.reload()：SW 的 NavigationRoute 會用**舊 precache 裡的
 * index.html** 接住那次導覽，於是使用者拿到的還是舊 hash 的 bundle——要按第二次才會中。
 * 產出的 sw.js 有 skipWaiting + clientsClaim，所以新 SW 一裝好就接管並發 controllerchange；
 * 我們要做的是**先催它去裝、再等接管、然後才 reload**。
 *
 * 只用標準 SW API，不為了這 20 行把 workbox-window 拉進 bundle。
 */
let reloadOnTakeover = false;

export function initServiceWorker(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // 只有使用者按了「重新整理」才自動重載——否則背景換版會在記帳打到一半時抽掉畫面
    if (!reloadOnTakeover) return;
    reloadOnTakeover = false;
    location.reload();
  });
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).then((reg) => {
      // 轉可見時催一次：SW 預設只在導覽時檢查更新，而 PWA 開著不動的分頁
      // 可以好幾天不導覽（那正是 version.json 輪詢會先發現新版的情境）
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => {});
      });
    }).catch(() => {/* 註冊失敗=沒有離線能力，但 app 照常跑 */});
  });
}

/** 更新提示那顆鈕。催 SW 去裝新版，接管後由 controllerchange 重載；催不動就硬重載。 */
export async function updateApp(): Promise<void> {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) {
    location.reload();
    return;
  }
  reloadOnTakeover = true;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.update();
      // 已經有裝好在等的：叫它跳過等待（保險——sw.js 自己有 skipWaiting，
      // 但使用者停在舊分頁時 waiting 可能已經卡在那裡）
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
      // 沒有新版可裝時不會有 controllerchange，等一下就直接重載
      setTimeout(() => {
        if (reloadOnTakeover) {
          reloadOnTakeover = false;
          location.reload();
        }
      }, 1500);
      return;
    }
  } catch {
    /* 落到下面硬重載 */
  }
  reloadOnTakeover = false;
  location.reload();
}

/** 排程：轉可見時查 + 每 10 分鐘一查（DEV 早退）。main.tsx 呼一次 */
export function initUpdateCheck(): void {
  if (import.meta.env.DEV) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
  setInterval(() => void checkForUpdate(), 10 * 60 * 1000);
}
