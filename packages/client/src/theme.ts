/**
 * 主題套用（宣紙／夜墨）。
 *
 * 分工：`:root[data-theme='ink']` 那一組 token 住 base.css，這裡只負責
 * 「把哪一個字串貼到 <html> 上」以及「theme-color meta 跟著換」。
 *
 * **首漆不在這裡**：index.html 有一段內聯 script 在 CSS 載入前就把 data-theme
 * 定好（否則夜墨使用者每次開 app 都會先閃一下白紙）。這支是 app 起來之後的
 * 切換與跟隨系統，兩邊的解析規則必須一致——`resolveTheme` 是那條規則的正典，
 * 內聯 script 是它的手抄本（styles.test.ts 鎖住兩邊的底色一致）。
 */
import type { ThemePref } from './settings';

export type Theme = 'paper' | 'ink';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 偏好 + 系統狀態 → 實際主題。純函式，測試與內聯 script 共用同一條規則。 */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'ink') return 'ink';
  if (pref === 'paper') return 'paper';
  return systemDark ? 'ink' : 'paper';
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches;
}

/**
 * 貼到 <html> 並同步 theme-color。
 *
 * theme-color 不寫死一張對照表，而是**讀回 CSS 算出來的 --bg**——這樣夜墨的底色
 * 只要在 base.css 改一處，網址列顏色自動跟上，不會有第二份會漂移的真相。
 * （首漆 script 那份沒得讀，只能手抄；那一份由測試鎖住。）
 */
export function applyTheme(pref: ThemePref): Theme {
  const theme = resolveTheme(pref, systemPrefersDark());
  const root = document.documentElement;
  if (theme === 'ink') root.setAttribute('data-theme', 'ink');
  else root.removeAttribute('data-theme');
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute('content', bg);
  return theme;
}

/**
 * 跟隨系統：註冊一次，之後系統切換深淺色時自動重貼。
 * 回傳解除註冊的函式（目前 app 生命週期內不會用到，但不留 leak 的殼）。
 */
export function watchSystemTheme(getPref: () => ThemePref): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(DARK_QUERY);
  const onChange = (): void => {
    // 只有「跟隨系統」才理會；使用者明確選了宣紙或夜墨就不該被系統翻掉
    if (getPref() === 'system') applyTheme('system');
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
