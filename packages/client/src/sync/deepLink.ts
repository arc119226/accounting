/**
 * 同步 deep link／QR 內容解析——純函式（零 I/O），三個呼叫端共用：
 * 開機的 location.hash、App 內掃到的 QR 字串、測試。
 *
 * **兩種 payload 都必須永遠認得**：
 * - `zb1:XXXXXX` —— 現行 QR 內容。刻意**不是網址**：iOS 系統相機對網址會浮出
 *   「用 Safari 開啟」，掃碼的人於是被丟進一個獨立儲存區、空帳本的分身分頁，
 *   在那裡同步等於把整本帳灌進用完即丟的殼，而且全程無聲。非網址就沒有那顆按鈕。
 * - `https://<domain>/#sync=XXXXXX` —— 舊版 QR。QR 是**對方**掃的，對方手機上
 *   可能還是舊版 app 在發舊 payload，所以這條相容路徑不能拿掉。
 */

/** 現行：非網址 scheme */
const ZB1 = /^ZB1:([A-Z2-9]{6})$/;
/** 舊版：網址 hash。後接非碼字元或字串結尾，避免把 7 碼字串誤切出前 6 碼 */
const HASH = /#SYNC=([A-Z2-9]{6})(?![A-Z2-9])/;

/** 取出六碼房間碼；認不得回 null（大小寫不拘、前後空白容忍） */
export function parseSyncLink(input: string): string | null {
  const s = input.trim().toUpperCase();
  const m = ZB1.exec(s) ?? HASH.exec(s);
  return m?.[1] ?? null;
}

/** 產生 QR 要編的內容（主持端）——與 parseSyncLink 成對，改格式只改這裡 */
export function buildSyncLink(roomCode: string): string {
  return `zb1:${roomCode}`;
}
