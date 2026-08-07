/**
 * App 層宣紙通知（移植自 sr2）：更新提示（常駐含「重新整理」鈕）、
 * 存檔失敗、記帳成功、刪除復原（帶動作鈕）。常掛在 App.tsx 尾端。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { dismiss, dismissSticky, getNotice, subscribe, type NoticeKind } from '../notice';
import { updateApp } from '../version';
import { useAppStore } from '../store/appStore';
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
  const screen = useAppStore((s) => s.screen);
  const sheetOpen = useAppStore((s) => s.entryDraft !== null);

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
  // 位置三態：抽屜開著→貼頂；帳本頁（底部中軸線上有 FAB）→抬到 FAB 之上；其餘→原位。
  // 改**位置**而不是改層級：updateReady 的「重新整理」與復原鈕都是必須按得到的。
  const place = sheetOpen ? ' at-top' : screen === 'ledger' ? ' above-fab' : '';
  return (
    <div className={`app-toast${place}`} role="status">
      <span>{text}</span>
      {notice.kind === 'updateReady' && (
        <>
          {/* updateApp 走 SW 的 updateSW(true)（skipWaiting + 接管 + reload），
              拿不到才退回 location.reload()——單純 reload 會被舊 SW 用舊 index.html 接住 */}
          <button className="app-toast-btn" onClick={() => void updateApp()}>
            {NOTICE.updateBtn}
          </button>
          {/* 沒有關閉鈕的話它會一直佔著底部（v4 量過那個位置會壓到 FAB） */}
          <button className="app-toast-btn" aria-label={NOTICE.dismiss} onClick={dismissSticky}>
            ✕
          </button>
        </>
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
