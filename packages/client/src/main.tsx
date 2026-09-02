import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initErrorLog } from './errlog';
import { APP_VERSION, initServiceWorker, initUpdateCheck } from './version';
import { setSaveErrorHandler } from './storage';
import { initKeyboardInsets } from './keyboard';
import { show } from './notice';
import { useAppStore } from './store/appStore';
import { parseSyncLink } from './sync/deepLink';
import { refreshRelays } from './sync/relays';
import { applyTheme, watchSystemTheme } from './theme';
import './styles.css';

// 可觀測性：render 前掛全域錯誤日誌（ErrorBoundary 接不到的 async/動態 import 全在這）
initErrorLog(APP_VERSION);
// 更新偵測兩道並存：SW 自己的更新（準，且能保證一次就換版）＋ version.json 輪詢
// （SW 被 iOS 回收或使用者停用 SW 時還在）。兩道都住 version.ts。
initServiceWorker();
initUpdateCheck();
// 軟鍵盤讓位：量 visualViewport 寫 --kb（iOS 專用；Android 靠 viewport meta 自己縮）
initKeyboardInsets();

// relay 清單:啟動時去同源要一次最新的（跟 version.json 同一個網域，零新增隱私成本）。
// 背景、靜默、失敗不影響任何事——手上那份（快取或 bundled）一定能用。
// 換掉了也不通知：清單是管線，使用者沒有依據可以說不；而且錨點保證兩機必定相遇，
// 兩支手機清單不一樣也不會出事 ⇒ 沒有緊急性。要看就去設定頁。
void refreshRelays(Date.now());
// 主題：index.html 的首漆 script 已經把 data-theme 定好（避免閃白），這裡是**接手**——
// styles.css 已載入，所以現在才讀得到算出來的 --bg 去更新 theme-color。
applyTheme(useAppStore.getState().settings.theme);
watchSystemTheme(() => useAppStore.getState().settings.theme);
// 設定寫失敗=session 內提示一次（saveJson 原契約靜默不變，只多掛通知）
let saveErrNotified = false;
setSaveErrorHandler(() => {
  if (saveErrNotified) return;
  saveErrNotified = true;
  show('saveFailed');
});

// 開機：載入帳本（首次啟動 seed 內建分類）+ peers + 申請持久儲存（WebKit 每次會話重問，冪等）
void useAppStore.getState().hydrate();
void useAppStore.getState().loadPeers();
// persist 的結果**要記下來**：舊版用 void 丟掉，於是程式完全不知道自己沒受保護，
// 而備份提醒的門檻又比 WebKit 的 7 天回收窗大四倍 ⇒ 三道防線同時失效且全程零警告。
void import('./db/persist').then(async (m) => {
  useAppStore.getState().setPersisted(await m.requestPersist());
});

// 同步 deep link：**只記意圖、不入房**。原本這裡直接 joinSync()，但 hydrate() 是 async——
// 此刻 records 還是空的，而以空帳本完成的握手會把 checkpoint 推到頂、讓這台的帳從此
// 不再增量傳給對方（詳見 syncSlice.begin 的閘）。真正入房的決策在 SyncScreen（等 hydrated）。
const syncCode = parseSyncLink(location.hash);
if (syncCode) {
  history.replaceState(null, '', location.pathname);
  useAppStore.getState().setScreen('sync');
  useAppStore.getState().setPendingJoin(syncCode);
}

if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, { __store: useAppStore });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
