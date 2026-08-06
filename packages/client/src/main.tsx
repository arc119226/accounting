import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initErrorLog } from './errlog';
import { APP_VERSION, initUpdateCheck } from './version';
import { setSaveErrorHandler } from './storage';
import { initKeyboardInsets } from './keyboard';
import { show } from './notice';
import { useAppStore } from './store/appStore';
import { parseSyncLink } from './sync/deepLink';
import { applyTheme, watchSystemTheme } from './theme';
import './styles.css';

// 可觀測性：render 前掛全域錯誤日誌（ErrorBoundary 接不到的 async/動態 import 全在這）
initErrorLog(APP_VERSION);
// 更新偵測（DEV 早退）：visibilitychange + 10 分鐘輪詢 version.json
initUpdateCheck();
// 軟鍵盤讓位：量 visualViewport 寫 --kb（iOS 專用；Android 靠 viewport meta 自己縮）
initKeyboardInsets();
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
void import('./db/persist').then((m) => m.requestPersist());

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
