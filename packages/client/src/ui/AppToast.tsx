/**
 * App 層宣紙通知（移植自 sr2）：更新提示（常駐含「重新整理」鈕）、
 * 存檔失敗、記帳成功、刪除復原（帶動作鈕）。常掛在 App.tsx 尾端。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { dismiss, getNotice, subscribe, type NoticeKind } from '../notice';
import { NOTICE } from '../strings/ui';

/** 自退時長；0=常駐（要使用者動作）。用 Record 而非索引簽章，noUncheckedIndexedAccess 不會咬。 */
const AUTO_DISMISS_MS: Readonly<Record<NoticeKind, number>> = {
  updateReady: 0,
  saveFailed: 4000,
  saved: 2000,
  // 復原要給得及反應的時間：刪錯了的人得先「咦？」一下才會找那顆鈕
  undo: 5000,
};

export function AppToast() {
  const notice = useSyncExternalStore(subscribe, getNotice);

  const ms = notice ? AUTO_DISMISS_MS[notice.kind] : 0;
  useEffect(() => {
    if (ms === 0) return;
    const t = setTimeout(() => dismiss(), ms);
    return () => clearTimeout(t);
  }, [notice, ms]);

  if (!notice) return null;
  const text =
    notice.kind === 'updateReady' ? NOTICE.updateReady
    : notice.kind === 'saveFailed' ? NOTICE.saveFailed
    : (notice.text ?? '');
  const action = notice.action;
  return (
    <div className="app-toast" role="status">
      <span>{text}</span>
      {notice.kind === 'updateReady' && (
        <button className="app-toast-btn" onClick={() => location.reload()}>
          {NOTICE.updateBtn}
        </button>
      )}
      {action && (
        <button
          className="app-toast-btn"
          onClick={() => {
            action.run();
            dismiss();
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
