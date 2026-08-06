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

if (import.meta.env.DEV) {
  Object.assign(window as unknown as Record<string, unknown>, { __store: useAppStore });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
