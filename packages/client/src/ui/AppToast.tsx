/**
 * App 層宣紙通知（移植自 sr2）：更新提示（常駐含「重新整理」鈕）、
 * 存檔失敗（4s 自退）、記帳成功（2s 自退）。常掛在 App.tsx 尾端。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { dismiss, getNotice, subscribe } from '../notice';
import { NOTICE } from '../strings/ui';

export function AppToast() {
  const notice = useSyncExternalStore(subscribe, getNotice);

  // 更新提示=常駐（要使用者動作）；其餘自退
  useEffect(() => {
    if (!notice || notice.kind === 'updateReady') return;
    const t = setTimeout(() => dismiss(), notice.kind === 'saved' ? 2000 : 4000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  const text =
    notice.kind === 'updateReady' ? NOTICE.updateReady
    : notice.kind === 'saveFailed' ? NOTICE.saveFailed
    : (notice.text ?? '');
  return (
    <div className="app-toast" role="status">
      <span>{text}</span>
      {notice.kind === 'updateReady' && (
        <button className="app-toast-btn" onClick={() => location.reload()}>
          {NOTICE.updateBtn}
        </button>
      )}
    </div>
  );
}
