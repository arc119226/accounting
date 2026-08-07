/**
 * 對話框/抽屜的鍵盤與焦點行為——三處共用（EntrySheet / ConfirmDialog / NameGate）。
 *
 * 三者原本各缺一半：ConfirmDialog 有 Esc 但焦點不移入、EntrySheet 連 Esc 都沒有、
 * NameGate 有 autoFocus 但沒有邊界。共同的後果是**焦點還留在觸發它的按鈕上**，
 * 而那顆鈕現在被 scrim 蓋住了：用鍵盤的人要盲按 Tab 穿過整份帳本（單月可達 300 筆、
 * 每筆一顆 button）才進得去，Tab 到底又會跑回背景。抽屜是全 app 最常開關的東西。
 *
 * 不引入套件：需要的只有四件事，而且都很短。
 *   1. Esc 關閉（可關的才給）
 *   2. 開啟時把焦點移進去（優先第一個可聚焦元素）
 *   3. Tab 在容器內環繞
 *   4. 關閉時把焦點還給原本那顆鈕
 */
import { useEffect, type RefObject } from 'react';

/** 可聚焦元素；:not([disabled]) 之外還要排掉 tabindex="-1"（程式聚焦用的） */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialog(
  ref: RefObject<HTMLElement | null>,
  opts: { onClose?: (() => void) | undefined },
): void {
  const { onClose } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 記住觸發者，關閉時還回去（不還的話焦點掉回 <body>，下一次 Tab 從文件最上方重來）
    const opener = document.activeElement as HTMLElement | null;

    const list = (): HTMLElement[] =>
      [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );

    // 焦點移進來。已經有 autoFocus 的（NameGate）就不要搶走它。
    if (!el.contains(document.activeElement)) {
      const first = list()[0];
      if (first) first.focus();
      else {
        el.tabIndex = -1;
        el.focus();
      }
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = list();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      // 環繞：到頭往回、到尾往前。焦點若已經跑到容器外（例如上一次沒接住），一律拉回來。
      if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // 觸發者可能已經隨畫面消失（例如刪除那筆之後那一列不見了）——還不回去就算了
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref, onClose]);
}
