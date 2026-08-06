/**
 * ID 產生葉檔——crypto 只准住這裡（core 純度鎖禁 crypto，一律收現成 id 參數）。
 *
 * uuidv7：48 位毫秒時間戳 + 版本/變體位 + 74 位隨機。**時間有序**——
 * 同月記錄的 id 天然接近，IndexedDB B-tree 局部性好；且雙機並發產生零協調不撞。
 */

export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ms = BigInt(Date.now());
  // 前 48 bit = 毫秒時間戳（big-endian）
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DEVICE_KEY = 'zb.deviceId';

let cachedDeviceId: string | null = null;

/**
 * 裝置 id：首次啟動鑄造、永不變（HLC tie-break 與「這筆是誰記的裝置」都靠它）。
 * 8 字 base36；localStorage 失敗（無痕模式）退為 session 內暫時 id——
 * 同步在無痕模式本來就不持久，可接受。
 */
export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing && /^[a-z0-9]{8}$/.test(existing)) {
      cachedDeviceId = existing;
      return existing;
    }
  } catch {
    /* 讀不到就往下鑄造 */
  }
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const id = (buf[0]!.toString(36) + buf[1]!.toString(36) + '00000000').slice(0, 8);
  cachedDeviceId = id;
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* 無痕模式：session 內用暫時 id */
  }
  return id;
}
