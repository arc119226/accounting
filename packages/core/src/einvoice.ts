/**
 * 台灣電子發票雙 QR 解析。
 *
 * 左 QR 前 77 字是固定位移欄位頭：字軌 10 + 民國日期 7 + 隨機碼 4 +
 * 未稅額 hex 8 + 含稅額 hex 8 + 買方統編 8 + 賣方統編 8 + 加密驗證 Base64 24；
 * 之後是可選的 ':' 分隔尾段（自用區 10 字 : QR 記載筆數 : 總筆數 : 編碼旗標 : 品名:數量:單價...）。
 * 右 QR 以 '**' 開頭接品項續列（常常整串就只有 '**'）。
 *
 * 設計要點（為什麼）：
 * - **頭部嚴格、尾段寬容**：頭部欄位是記帳要入帳的錢與日期，壞了寧可整張拒收
 *   （分級回 error、永不 throw，掃描 UI 據此提示）；品項只是輔助明細，
 *   壞多少丟多少，不拖垮整張發票（best-effort，見 itemsComplete）。
 * - 錯誤分級：'not-einvoice' 是「根本不是發票」（掃到商品條碼/網址是常態，
 *   掃描迴圈直接略過）；'bad-header'/'bad-date'/'bad-amount' 是「像發票但內容壞」。
 * - **mergeRightQr 契約：呼叫端保證同一 rightText 只 merge 一次**——
 *   本函式不去重，重複 merge 會把同批品項疊加兩次。
 * - 「總品目筆數」不放進 ParsedInvoice（介面是對外契約，不洩漏解析中間值），
 *   但 mergeRightQr 重算 itemsComplete 需要它，故以模組級 WeakMap 旁掛在
 *   解析結果物件上：純記憶體、決定論、隨結果物件被 GC，不污染介面形狀。
 */
import type { InvoiceItem } from './types';
import { rocToISO } from './rocdate';

/**
 * TextDecoder 在 Node 與所有目標瀏覽器皆為全域，且是純位元組→字串轉換
 * （無 I/O、無非決定性，core 純度鎖不禁）；但 tsconfig lib 只開 ES2022、
 * 未含 DOM/Node 型別，故就地補最小宣告——emit 時整段消失，執行期走全域。
 */
declare class TextDecoder {
  constructor(label?: string, options?: { readonly fatal?: boolean });
  decode(input?: Uint8Array): string;
}

export type EInvoiceError = 'not-einvoice' | 'bad-header' | 'bad-date' | 'bad-amount';

export interface ParsedInvoice {
  readonly number: string;
  readonly dateISO: string;
  readonly randomCode: string;
  readonly salesAmount: number;
  readonly totalAmount: number;
  readonly buyerTaxId: string;
  readonly sellerTaxId: string;
  readonly items: readonly InvoiceItem[];
  readonly itemsComplete: boolean;
  /** 尾段的中文編碼旗標（0=Big5, 1=UTF-8, 2=Base64）；尾段缺或旗標壞 ⇒ null */
  readonly encoding: 0 | 1 | 2 | null;
}

/**
 * 快篩：77 字固定頭的欄位「形狀」（2+19+16+16+24=77；不驗語意——
 * 日期是否真實存在、hex 值多大都不管，那是 parseEInvoiceLeft 的事）。
 * 字軌字母容小寫：掃描器不改大小寫，但容錯零成本，正式解析再統一轉大寫。
 */
const LEFT_HEAD_RE = /^[A-Za-z]{2}\d{19}[0-9A-Fa-f]{16}\d{16}[A-Za-z0-9+/=]{24}/;

/** 左 QR 快篩（供掃描迴圈把鏡頭下的各種條碼先分類，再走正式解析） */
export function looksLikeEInvoiceLeft(text: string): boolean {
  return LEFT_HEAD_RE.test(text);
}

/** 右 QR 規格固定以 '**' 開頭（品項全在左碼時，整串就只有 '**'） */
export function looksLikeEInvoiceRight(text: string): boolean {
  return text.startsWith('**');
}

// ---------- Base64 品名解碼（編碼旗標 2） ----------

// core 禁 import 外部套件，atob 也非我們鎖定的全域白名單，故自建 64 字解碼表——
// 反正只解品名短字串，效能無虞
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Map<string, number>();
for (let i = 0; i < B64_CHARS.length; i++) B64_INDEX.set(B64_CHARS.charAt(i), i);

/** 形狀先驗：至少一個資料字元、'=' 只可出現在結尾 1~2 個（配合長度 %4 檢查） */
const B64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;

function base64ToBytes(s: string): Uint8Array | null {
  if (s.length === 0 || s.length % 4 !== 0 || !B64_SHAPE.test(s)) return null;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    // '=' 不在表內 ⇒ ?? 0 補零位元；形狀先驗保證 '=' 只在末端，
    // 其貢獻的位元組已被 pad 從 out 長度扣除，寫不進去
    const n =
      ((B64_INDEX.get(s.charAt(i)) ?? 0) << 18) |
      ((B64_INDEX.get(s.charAt(i + 1)) ?? 0) << 12) |
      ((B64_INDEX.get(s.charAt(i + 2)) ?? 0) << 6) |
      (B64_INDEX.get(s.charAt(i + 3)) ?? 0);
    if (o < out.length) out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

/** fatal:true——壞 UTF-8 直接 throw 讓我們丟棄該品項，不讓 U+FFFD 混進帳本 */
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function decodeBase64Utf8(raw: string): string | null {
  const bytes = base64ToBytes(raw);
  if (bytes === null) return null;
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

// ---------- 品項三元組淨化 ----------

/**
 * 品名:數量:單價 三元組的 best-effort 淨化解析：
 * - 殘尾（末組湊不滿三欄）⇒ 丟殘尾、保留完整的（截斷是掃描世界的日常）
 * - 單筆壞（品名空/解碼失敗、數量或單價 NaN 或負）⇒ 只丟該筆
 * - Big5（enc=0）任一品名含 U+FFFD ⇒ 整批丟：zxing 已把 Big5 位元組
 *   錯譯成 JS 字串、原始位元組拿不回來，出現替換字元代表整段名稱皆不可信
 */
function parseItemTriples(fields: readonly string[], encoding: 0 | 1 | 2): InvoiceItem[] {
  if (encoding === 0) {
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if ((fields[i] ?? '').includes('�')) return [];
    }
  }
  const items: InvoiceItem[] = [];
  for (let i = 0; i + 2 < fields.length; i += 3) {
    const raw = fields[i] ?? '';
    const name = encoding === 2 ? decodeBase64Utf8(raw) : raw;
    if (name === null || name === '') continue;
    // Number() 而非 parseInt：數量/單價可為小數（秤重計價，見 types.ts InvoiceItem）
    const qty = Number(fields[i + 1]);
    const unitPrice = Number(fields[i + 2]);
    if (Number.isNaN(qty) || qty < 0 || Number.isNaN(unitPrice) || unitPrice < 0) continue;
    items.push({ name, qty, unitPrice });
  }
  return items;
}

// ---------- 尾段解析 ----------

interface TailParse {
  readonly items: readonly InvoiceItem[];
  readonly itemsComplete: boolean;
  readonly encoding: 0 | 1 | 2 | null;
  /** 總品目筆數；尾段缺/損毀時 null（此時 merge 後也永無宣告完整的依據） */
  readonly totalCount: number | null;
}

const NO_TAIL: TailParse = { items: [], itemsComplete: false, encoding: null, totalCount: null };

function parseTail(rest: string): TailParse {
  // 尾段缺（規格允許）或不以 ':' 起頭的規格外雜訊——品項 best-effort，退化不報錯
  if (!rest.startsWith(':')) return NO_TAIL;
  const fields = rest.slice(1).split(':');
  // 自用區/兩筆數/編碼旗標四欄是解讀品項的前提，湊不齊視同無尾段
  if (fields.length < 4) return NO_TAIL;
  const [selfUse = '', qrCountRaw = '', totalCountRaw = '', encRaw = ''] = fields;
  const encoding = encRaw === '0' ? 0 : encRaw === '1' ? 1 : encRaw === '2' ? 2 : null;
  // 旗標壞 ⇒ 品名無從解讀；encoding=null 也讓 mergeRightQr 知道右碼同樣不可解
  if (encoding === null) return NO_TAIL;
  // 自用區規格恰 10 字（內容任意）、筆數必須十進位；違者視為尾段損毀：
  // 品項全丟、永不完整，但旗標本身沒壞就保留（契約如此，介面上仍可見編碼資訊）
  if (selfUse.length !== 10 || !/^\d+$/.test(qrCountRaw) || !/^\d+$/.test(totalCountRaw)) {
    return { items: [], itemsComplete: false, encoding, totalCount: null };
  }
  const qrCount = Number(qrCountRaw);
  const totalCount = Number(totalCountRaw);
  const items = parseItemTriples(fields.slice(4), encoding);
  return {
    items,
    // 左碼宣稱自載全部（qrCount===totalCount）且實際解出筆數對得上才算完整；
    // 淨化丟過品項就對不上 ⇒ 自然翻 false
    itemsComplete: qrCount === totalCount && items.length === totalCount,
    encoding,
    totalCount,
  };
}

/**
 * 解析結果 → 總品目筆數的旁掛表。介面上沒有這欄（對外契約不放中間值），
 * 但 mergeRightQr 重算 itemsComplete 需要它；WeakMap 以物件身分為鍵，
 * 不改介面形狀、決定論、隨結果物件被 GC。
 */
const TOTAL_COUNT_OF = new WeakMap<ParsedInvoice, number>();

// ---------- 對外 API ----------

export function parseEInvoiceLeft(
  text: string,
):
  | { readonly ok: true; readonly inv: ParsedInvoice }
  | { readonly ok: false; readonly error: EInvoiceError } {
  // 長度不足或字軌形不符：多半是掃到別種條碼，歸 not-einvoice 讓掃描迴圈略過
  if (text.length < 77 || !/^[A-Za-z]{2}\d{8}$/.test(text.slice(0, 10))) {
    return { ok: false, error: 'not-einvoice' };
  }
  const rocDate = text.slice(10, 17);
  const randomCode = text.slice(17, 21);
  const salesHex = text.slice(21, 29);
  const totalHex = text.slice(29, 37);
  const buyerTaxId = text.slice(37, 45);
  const sellerTaxId = text.slice(45, 53);
  const cipher = text.slice(53, 77);
  // 形狀驗證（bad-header）：欄位都在位置上但字元類別不對——像發票但頭壞了。
  // 加密驗證段只驗形不解密：core 無 crypto、內容也用不到，驗形只為抓錯位串接
  if (
    !/^\d{7}$/.test(rocDate) ||
    !/^\d{4}$/.test(randomCode) ||
    !/^\d{8}$/.test(buyerTaxId) ||
    !/^\d{8}$/.test(sellerTaxId) ||
    !/^[A-Za-z0-9+/=]{24}$/.test(cipher)
  ) {
    return { ok: false, error: 'bad-header' };
  }
  // 形對但曆法上不存在（平年 2/29、月 13、民國 0 年）⇒ bad-date，與驗形分級
  const dateISO = rocToISO(rocDate);
  if (dateISO === null) return { ok: false, error: 'bad-date' };
  // 金額是 hex；大小寫皆容（規格未保證、各家開票機各有印法）
  if (!/^[0-9A-Fa-f]{8}$/.test(salesHex) || !/^[0-9A-Fa-f]{8}$/.test(totalHex)) {
    return { ok: false, error: 'bad-amount' };
  }
  const tail = parseTail(text.slice(77));
  const inv: ParsedInvoice = {
    number: text.slice(0, 10).toUpperCase(),
    dateISO,
    randomCode,
    salesAmount: parseInt(salesHex, 16),
    totalAmount: parseInt(totalHex, 16),
    buyerTaxId,
    sellerTaxId,
    items: tail.items,
    itemsComplete: tail.itemsComplete,
    encoding: tail.encoding,
  };
  if (tail.totalCount !== null) TOTAL_COUNT_OF.set(inv, tail.totalCount);
  return { ok: true, inv };
}

/**
 * 把右 QR 的品項續列併入左碼解析結果。
 * 契約：**呼叫端保證同一 rightText 只 merge 一次**（本函式不去重）。
 */
export function mergeRightQr(inv: ParsedInvoice, rightText: string): ParsedInvoice {
  // 不是右碼、或左碼沒帶編碼旗標（無尾段/旗標損毀）⇒ 品名無從解讀，原樣退回
  if (!looksLikeEInvoiceRight(rightText) || inv.encoding === null) return inv;
  const appended = parseItemTriples(rightText.slice(2).split(':'), inv.encoding);
  // 最常見的空右碼（整串只有 '**'）與全壞續列都走這裡：no-op
  if (appended.length === 0) return inv;
  const items = [...inv.items, ...appended];
  const totalCount = TOTAL_COUNT_OF.get(inv);
  const merged: ParsedInvoice = {
    ...inv,
    items,
    // 合併後「左碼自載全部」的條件讓位給「兩碼合計對上總筆數」；
    // 總筆數不明（尾段損毀或 inv 非本模組產出）⇒ 保守地永不宣告完整
    itemsComplete: totalCount !== undefined && items.length === totalCount,
  };
  if (totalCount !== undefined) TOTAL_COUNT_OF.set(merged, totalCount);
  return merged;
}
