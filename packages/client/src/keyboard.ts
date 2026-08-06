/**
 * 軟鍵盤讓位——把「鍵盤吃掉多少版面高」寫進 CSS 變數 `--kb`，版面自己讓開。
 *
 * 為什麼需要這個：Android Chrome 可以靠 viewport 的 `interactive-widget=resizes-content`
 * 直接縮版面視窗（見 index.html），整條 100dvh → .app-shell → .screen-body 免費跟著縮。
 * **iOS Safari 不縮版面視窗**，只有 visualViewport 變小——position:fixed 的底部抽屜、
 * 對話框、通知就這樣被鍵盤蓋住，只能由 JS 量出來手動讓位。
 *
 * 只有 `keyboardInset` 是純的、可測；DOM 接線刻意留在 init 裡不測（沒有元件測試基建，
 * 而算術才是會出錯的部分）。
 */

export interface ViewportSample {
  /** 版面視窗高（documentElement.clientHeight） */
  readonly layoutHeight: number;
  /** 視覺視窗高（visualViewport.height） */
  readonly visualHeight: number;
  /** 視覺視窗相對版面視窗的上緣位移（visualViewport.offsetTop） */
  readonly offsetTop: number;
  /** 縮放倍率（visualViewport.scale） */
  readonly scale: number;
}

/** 捏放縮放同樣讓 visualViewport 變小——那不是鍵盤，不可讓位 */
const PINCH_SCALE = 1.05;
/**
 * 死區：手機軟鍵盤最矮約 230px，而瀏覽器工具列顯隱造成的落差約 50–115px。
 * 閾值落在兩者中間，工具列動來動去不會被誤判成鍵盤。
 */
const DEAD_ZONE_PX = 120;

/** 軟鍵盤吃掉的版面高（px）；不是鍵盤造成的落差一律回 0 */
export function keyboardInset(v: ViewportSample): number {
  if (v.scale > PINCH_SCALE) return 0;
  const gap = v.layoutHeight - v.visualHeight - v.offsetTop;
  // Android 設了 interactive-widget=resizes-content 後 layoutHeight 也跟著縮，
  // gap 自然接近 0 ⇒ 這裡回 0、不會在版面已經縮過之後又讓一次位
  return gap > DEAD_ZONE_PX ? Math.round(gap) : 0;
}

/**
 * 掛上 visualViewport 監聽（寫 `--kb`）與對焦捲動。回傳解除函式。
 * 無 visualViewport 的環境（舊瀏覽器、測試）安靜地什麼都不做。
 */
export function initKeyboardInsets(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};

  const root = document.documentElement;
  let raf = 0;
  let pendingFocus: HTMLElement | null = null;
  let focusTimer: ReturnType<typeof setTimeout> | null = null;

  const flushFocus = (): void => {
    const el = pendingFocus;
    pendingFocus = null;
    if (focusTimer !== null) {
      clearTimeout(focusTimer);
      focusTimer = null;
    }
    if (!el || !el.isConnected) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // inline:'nearest' 是刻意寫出來的：.screen-body 因 overflow-y:auto 連帶成為
    // 可橫向捲動容器，而 .ledger-body 的 touch-action:pan-y 讓使用者捲不回來——
    // 絕不能讓程式把它橫向捲走
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  };

  const measure = (): void => {
    raf = 0;
    root.style.setProperty(
      '--kb',
      `${keyboardInset({
        layoutHeight: root.clientHeight,
        visualHeight: vv.height,
        offsetTop: vv.offsetTop,
        scale: vv.scale,
      })}px`,
    );
    // 版面已經定了才捲：對焦當下鍵盤還在動，那時捲會被鍵盤的動畫推翻
    if (pendingFocus) flushFocus();
  };

  const onViewport = (): void => {
    if (raf === 0) raf = requestAnimationFrame(measure);
  };

  const onFocusIn = (e: FocusEvent): void => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (!el.matches('input:not([type=hidden]), textarea, select')) return;
    pendingFocus = el;
    // 鍵盤本來就開著（欄位間跳）時不會再有 resize 事件——補一個保底
    if (focusTimer !== null) clearTimeout(focusTimer);
    focusTimer = setTimeout(flushFocus, 350);
  };

  const onFocusOut = (): void => {
    pendingFocus = null;
    // iOS 即使 html/body overflow:hidden 也會為了避開鍵盤捲動文件本身，收鍵盤後歸位
    document.scrollingElement?.scrollTo(0, 0);
  };

  vv.addEventListener('resize', onViewport);
  vv.addEventListener('scroll', onViewport);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  measure();

  return () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    if (focusTimer !== null) clearTimeout(focusTimer);
    vv.removeEventListener('resize', onViewport);
    vv.removeEventListener('scroll', onViewport);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    root.style.removeProperty('--kb');
  };
}
