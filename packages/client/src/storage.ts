/**
 * localStorage 存取葉節點（零 import；移植自 super-reversi2 storage.ts）。
 *
 * **契約**：壞資料一律回 fallback、寫入失敗一律靜默——`localStorage` 在無痕模式、
 * 停用 cookie、配額滿時會 throw，而「存不了設定」絕不該讓 app 掛掉。
 *
 * 資料容錯不在此處：各站點自帶 `normalize`（補欄/夾值/版本升級），此葉只負責
 * 「拿得到就交給你、拿不到就給預設」。帳本本體住 IndexedDB（db/），不經此檔。
 */

/**
 * 讀 JSON 存檔：缺鍵/壞 JSON/localStorage 不可用 → `fallback()`；
 * 讀得到就交給 `normalize`（其自身若 throw 也回 fallback）。
 */
export function loadJson<T>(key: string, normalize: (raw: unknown) => T, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback();
    return normalize(JSON.parse(raw));
  } catch {
    return fallback();
  }
}

/** 寫失敗掛鉤（main.tsx 註冊=session 內提示一次）。維持零 import——
 *  callback 注入而非 import notice，葉節點純度不破。 */
let onSaveError: (() => void) | null = null;
export function setSaveErrorHandler(cb: () => void): void {
  onSaveError = cb;
}

/** 寫 JSON 存檔：localStorage 不可用（無痕/停用/配額滿）時靜默略過（另通知一次） */
export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 靜默：存不了設定不該中斷 app；但使用者該知道變更只在本次有效
    onSaveError?.();
  }
}
