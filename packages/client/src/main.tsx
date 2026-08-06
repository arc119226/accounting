import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { initErrorLog } from './errlog';
import { APP_VERSION, initUpdateCheck } from './version';
import { setSaveErrorHandler } from './storage';
import { show } from './notice';
import { useAppStore } from './store/appStore';
import './styles.css';

// 可觀測性：render 前掛全域錯誤日誌（ErrorBoundary 接不到的 async/動態 import 全在這）
initErrorLog(APP_VERSION);
// 更新偵測（DEV 早退）：visibilitychange + 10 分鐘輪詢 version.json
initUpdateCheck();
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

// 同步 deep link：主持方 QR 內容是 https://<domain>/#sync=<code>，
// 對方用系統相機掃 → 開 app 直接進同步頁入房
const syncLink = /#sync=([A-Z2-9]{6})/i.exec(location.hash);
if (syncLink) {
  history.replaceState(null, '', location.pathname);
  useAppStore.getState().setScreen('sync');
  useAppStore.getState().joinSync(syncLink[1]!);
}

if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, { __store: useAppStore });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
