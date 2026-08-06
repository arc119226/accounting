/**
 * 通用字串令牌編解碼葉檔（移植自 sr2 stringToken.ts）。
 *
 * 令牌=`<prefix>A.<base64url(deflate-raw(text))>.<crc32hex>`；`<prefix>B.`=未壓縮回退
 * （給無 CompressionStream 的老瀏覽器）。CRC 蓋在 base64 段上=抓「抄歪/截斷」，
 * **是防呆不是防人**（改令牌只能騙自己）。
 *
 * 消費者：設定/小額資料的 QR 傳遞（prefix 'ZB'）。帳本本體走檔案匯出（sync/exportFile.ts）。
 * 錯誤回 code 不回文案——顯示字一律由呼叫端從 strings 取。
 * prefix 限 `[A-Z0-9]+`（會直接進 RegExp，不做跳脫）。
 */

export type StringTokenError = 'too-long' | 'format' | 'crc' | 'no-decompressor' | 'corrupt';

export interface StringTokenOptions {
  /** 令牌前綴（不含 A/B 尾碼），如 'ZB' → ZBA/ZBB */
  readonly prefix: string;
  /** 解析上限；超長=惡意/貼錯，先於格式檢查直接拒收 */
  readonly maxChars?: number;
}

// ── 編解碼小工具（瀏覽器/Node 皆可跑=測試走真實碼路）──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(s: string): string {
  let c = 0xffffffff;
  for (let i = 0; i < s.length; i++) c = CRC_TABLE[(c ^ s.charCodeAt(i)) & 0xff]! ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

export function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipeBytes(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

// ── 打包/解析 ──

/** 把任意字串打包成令牌（deflate 可用走 `<prefix>A`，否則 `<prefix>B` 未壓縮回退） */
export async function packString(text: string, opts: StringTokenOptions): Promise<string> {
  const raw = new TextEncoder().encode(text);
  const canDeflate = typeof CompressionStream !== 'undefined';
  const bytes = canDeflate ? await pipeBytes(raw, new CompressionStream('deflate-raw')) : raw;
  const b64 = toB64Url(bytes);
  return `${opts.prefix}${canDeflate ? 'A' : 'B'}.${b64}.${crc32(b64)}`;
}

/** 解析令牌回原字串；壞令牌回錯誤 code，永不 throw（內容語意驗證由呼叫端接手） */
export async function unpackString(
  raw: string,
  opts: StringTokenOptions,
): Promise<{ readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: StringTokenError }> {
  try {
    const token = raw.trim();
    if (opts.maxChars !== undefined && token.length > opts.maxChars) return { ok: false, code: 'too-long' };
    const m = token.match(new RegExp(`^${opts.prefix}(A|B)\\.([A-Za-z0-9_-]+)\\.([0-9a-f]{8})$`));
    if (!m) return { ok: false, code: 'format' };
    if (crc32(m[2]!) !== m[3]) return { ok: false, code: 'crc' };
    let bytes = fromB64Url(m[2]!);
    if (m[1] === 'A') {
      if (typeof DecompressionStream === 'undefined') return { ok: false, code: 'no-decompressor' };
      bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
    }
    return { ok: true, text: new TextDecoder().decode(bytes) };
  } catch {
    return { ok: false, code: 'corrupt' };
  }
}
