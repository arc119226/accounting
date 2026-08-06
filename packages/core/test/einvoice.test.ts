/**
 * einvoice.ts 的規格測試——**先寫測試再寫實作**，這份檔案就是規格書。
 *
 * fixture 建構器 makeLeftQr 依官方 77 字固定頭位移組合法字串；
 * 涵蓋：欄位往返 property、hex 金額邊界、民國年界與閏年、三種中文編碼旗標、
 * 尾段各型態（缺/自用區/筆數/殘尾/損毀）、右 QR 合併、快篩函式、永不 throw。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  looksLikeEInvoiceLeft,
  looksLikeEInvoiceRight,
  mergeRightQr,
  parseEInvoiceLeft,
  type ParsedInvoice,
} from '../src/einvoice';
import { rocToISO } from '../src/rocdate';

// ---------- fixture 建構器 ----------

/** 加密驗證段規格是 24 字 Base64、只驗形不解密——固定一個合法樣本即可 */
const CIPHER24 = 'Zm9vYmFyYmF6cXV4MTIzNDU2';

/** 營業人自用區常態就是十個星號 */
const TEN_STARS = '**********';

interface LeftQrParts {
  readonly number?: string;
  readonly rocDate?: string;
  readonly random?: string;
  /** 數字走 8 位 hex 零填；字串原樣塞入（供壞 hex／大小寫混合測試） */
  readonly sales?: number | string;
  readonly total?: number | string;
  readonly buyer?: string;
  readonly seller?: string;
  /** 含開頭 ':' 的完整尾段；預設無尾段（規格允許完全沒有） */
  readonly tail?: string;
}

function hex8(v: number | string): string {
  return typeof v === 'number' ? v.toString(16).padStart(8, '0') : v;
}

/** 依官方位移組出左 QR：預設值全合法（民國 115/08/06、消費者買方、無尾段） */
function makeLeftQr(parts: LeftQrParts = {}): string {
  const {
    number = 'AB12345678',
    rocDate = '1150806',
    random = '5926',
    sales = 100,
    total = 105,
    buyer = '00000000',
    seller = '12345675',
    tail = '',
  } = parts;
  return number + rocDate + random + hex8(sales) + hex8(total) + buyer + seller + CIPHER24 + tail;
}

/** 解析必成功時直接取 inv；失敗把錯誤碼帶進訊息，一眼看出是哪級炸了 */
function parseOk(text: string): ParsedInvoice {
  const r = parseEInvoiceLeft(text);
  if (!r.ok) throw new Error(`預期 ok，卻得到 error='${r.error}'`);
  return r.inv;
}

/** 解析必失敗時取錯誤碼；意外成功回 null 讓斷言自然失敗 */
function parseErr(text: string): string | null {
  const r = parseEInvoiceLeft(text);
  return r.ok ? null : r.error;
}

describe('makeLeftQr 建構器自身', () => {
  it('無尾段時恰為 77 字（頭部位移的前提，先鎖住）', () => {
    expect(makeLeftQr().length).toBe(77);
  });
});

// ---------- property：build→parse 往返 ----------

/** 大寫字母單字元 */
const arbUpper = fc.integer({ min: 65, max: 90 }).map((c) => String.fromCharCode(c));

/** n 位十進位數字字串（含前導零——統編/隨機碼本就允許） */
const digitsOf = (n: number) =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n }).map((a) => a.join(''));

/** 字軌：2 大寫字母 + 8 數字 */
const arbTrack = fc.tuple(arbUpper, arbUpper, digitsOf(8)).map(([a, b, d]) => a + b + d);

/** 合法民國日期：以 rocToISO 為裁判過濾（閏年大小月規則不重寫一遍） */
const arbRocDate = fc
  .tuple(fc.integer({ min: 1, max: 200 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }))
  .map(
    ([y, m, d]) =>
      String(y).padStart(3, '0') + String(m).padStart(2, '0') + String(d).padStart(2, '0'),
  )
  .filter((s) => rocToISO(s) !== null);

/** 金額夾在 0~99,999,999（與 money.ts 的輸入上限同一數量級） */
const arbAmount = fc.integer({ min: 0, max: 99_999_999 });

describe('property：build→parse 往返', () => {
  it('隨機合法欄位組出的左 QR，解析後逐欄一致；無尾段 ⇒ items 空、encoding null', () => {
    fc.assert(
      fc.property(
        arbTrack,
        arbRocDate,
        digitsOf(4),
        arbAmount,
        arbAmount,
        digitsOf(8),
        digitsOf(8),
        (number, rocDate, random, sales, total, buyer, seller) => {
          const inv = parseOk(makeLeftQr({ number, rocDate, random, sales, total, buyer, seller }));
          expect(inv.number).toBe(number);
          expect(inv.dateISO).toBe(rocToISO(rocDate));
          expect(inv.randomCode).toBe(random);
          expect(inv.salesAmount).toBe(sales);
          expect(inv.totalAmount).toBe(total);
          expect(inv.buyerTaxId).toBe(buyer);
          expect(inv.sellerTaxId).toBe(seller);
          expect(inv.items).toEqual([]);
          expect(inv.encoding).toBeNull();
          expect(inv.itemsComplete).toBe(false);
        },
      ),
    );
  });
});

// ---------- 錯誤分級 ----------

describe('parseEInvoiceLeft 錯誤分級', () => {
  it('長度 <77 ⇒ not-einvoice（掃到別種條碼是常態，讓掃描迴圈直接略過）', () => {
    expect(parseErr('')).toBe('not-einvoice');
    expect(parseErr('AB12345678')).toBe('not-einvoice');
    expect(parseErr(makeLeftQr().slice(0, 76))).toBe('not-einvoice');
  });

  it('前 10 字不符字軌形 ⇒ not-einvoice', () => {
    expect(parseErr(makeLeftQr({ number: '1234567890' }))).toBe('not-einvoice'); // 全數字
    expect(parseErr(makeLeftQr({ number: 'A123456789' }))).toBe('not-einvoice'); // 第二字非字母
    expect(parseErr(makeLeftQr({ number: 'ABC2345678' }))).toBe('not-einvoice'); // 第三字非數字
  });

  it('字軌小寫字母容錯收下，輸出一律轉大寫', () => {
    expect(parseOk(makeLeftQr({ number: 'ab12345678' })).number).toBe('AB12345678');
  });

  it('欄位驗形失敗 ⇒ bad-header：隨機碼/統編/日期段非數字、Base64 段非法', () => {
    expect(parseErr(makeLeftQr({ random: '12a4' }))).toBe('bad-header');
    expect(parseErr(makeLeftQr({ buyer: 'ABCDEFGH' }))).toBe('bad-header');
    expect(parseErr(makeLeftQr({ seller: '1234x675' }))).toBe('bad-header');
    expect(parseErr(makeLeftQr({ rocDate: '11a0806' }))).toBe('bad-header');
    // 加密驗證段塞入 Base64 字元集外的符號（恰 24 字，位移不亂）
    expect(parseErr(makeLeftQr().slice(0, 53) + '!@#$%^&*()!@#$%^&*()!@#$')).toBe('bad-header');
  });

  it('日期形對但曆法上不存在 ⇒ bad-date', () => {
    expect(parseErr(makeLeftQr({ rocDate: '1150231' }))).toBe('bad-date'); // 2 月無 31
    expect(parseErr(makeLeftQr({ rocDate: '1151301' }))).toBe('bad-date'); // 月 13
    expect(parseErr(makeLeftQr({ rocDate: '0000101' }))).toBe('bad-date'); // 民國 0 年不存在
  });

  it('金額段含非 hex 字 ⇒ bad-amount', () => {
    expect(parseErr(makeLeftQr({ sales: '0000GG00' }))).toBe('bad-amount');
    expect(parseErr(makeLeftQr({ total: 'xyz00000' }))).toBe('bad-amount');
  });
});

// ---------- hex 金額邊界 ----------

describe('金額 hex 邊界', () => {
  it('00000000 ⇒ 0 元（免費贈品發票真的存在）', () => {
    const inv = parseOk(makeLeftQr({ sales: 0, total: 0 }));
    expect(inv.salesAmount).toBe(0);
    expect(inv.totalAmount).toBe(0);
  });

  it('大小寫混合 hex 皆容：規格未保證大小寫，機器各有各印法', () => {
    const inv = parseOk(makeLeftQr({ sales: '00Ff00aB', total: 'FFffFFff' }));
    expect(inv.salesAmount).toBe(0x00ff00ab); // 16711851
    expect(inv.totalAmount).toBe(0xffffffff); // 4294967295
  });
});

// ---------- 民國年界與閏年 ----------

describe('民國年界與閏年', () => {
  it('1000101 = 2011-01-01；0991231 = 2010-12-31（三碼年含前導零）', () => {
    expect(parseOk(makeLeftQr({ rocDate: '1000101' })).dateISO).toBe('2011-01-01');
    expect(parseOk(makeLeftQr({ rocDate: '0991231' })).dateISO).toBe('2010-12-31');
  });

  it('閏年 2/29 合法、平年 2/29 ⇒ bad-date', () => {
    expect(parseOk(makeLeftQr({ rocDate: '1090229' })).dateISO).toBe('2020-02-29'); // 2020 閏
    expect(parseErr(makeLeftQr({ rocDate: '1100229' }))).toBe('bad-date'); // 2021 平
  });
});

// ---------- 尾段品項（編碼 1 = UTF-8） ----------

describe('尾段品項（UTF-8）', () => {
  it('十星號自用區 + 2:2 全載 ⇒ 品項齊、itemsComplete true', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:1:牛奶:2:45:麵包:1:30` }));
    expect(inv.encoding).toBe(1);
    expect(inv.items).toEqual([
      { name: '牛奶', qty: 2, unitPrice: 45 },
      { name: '麵包', qty: 1, unitPrice: 30 },
    ]);
    expect(inv.itemsComplete).toBe(true);
  });

  it('自用區內容任意（恰 10 字即可，不必是星號）', () => {
    const inv = parseOk(makeLeftQr({ tail: ':ABcd,.!?12:1:1:1:茶:1:25' }));
    expect(inv.items).toEqual([{ name: '茶', qty: 1, unitPrice: 25 }]);
    expect(inv.itemsComplete).toBe(true);
  });

  it('筆數 0:2（左碼不載品項）⇒ items 空、itemsComplete false、encoding 仍在', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:0:2:1` }));
    expect(inv.items).toEqual([]);
    expect(inv.itemsComplete).toBe(false);
    expect(inv.encoding).toBe(1);
  });

  it('殘尾截斷（末組湊不滿三欄）⇒ 丟殘尾、保留完整的', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:1:牛奶:2:45:麵包:1` }));
    expect(inv.items).toEqual([{ name: '牛奶', qty: 2, unitPrice: 45 }]);
    expect(inv.itemsComplete).toBe(false); // 實際解出 1 筆 ≠ 總筆數 2
  });

  it('秤重計價：數量/單價可為小數', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:1:1:豬肉:0.5:123.5` }));
    expect(inv.items).toEqual([{ name: '豬肉', qty: 0.5, unitPrice: 123.5 }]);
    expect(inv.itemsComplete).toBe(true);
  });

  it('淨化：數量負值/單價非數字/品名空字串 ⇒ 丟該三元組，其餘保留', () => {
    const negQty = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:1:牛奶:-1:45:麵包:1:30` }));
    expect(negQty.items).toEqual([{ name: '麵包', qty: 1, unitPrice: 30 }]);
    expect(negQty.itemsComplete).toBe(false);

    const nanPrice = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:1:1:牛奶:2:abc` }));
    expect(nanPrice.items).toEqual([]);

    const emptyName = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:1::2:45:麵包:1:30` }));
    expect(emptyName.items).toEqual([{ name: '麵包', qty: 1, unitPrice: 30 }]);
  });

  it('筆數任一非十進位 ⇒ 尾段損毀：items 空、itemsComplete false、encoding 照旗標', () => {
    const badQr = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:x:2:1:牛奶:2:45` }));
    expect(badQr.items).toEqual([]);
    expect(badQr.itemsComplete).toBe(false);
    expect(badQr.encoding).toBe(1);

    const badTotal = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:y:1:牛奶:2:45` }));
    expect(badTotal.items).toEqual([]);
    expect(badTotal.encoding).toBe(1);
  });

  it('編碼旗標壞 ⇒ encoding null、items 空（品名無從解讀）', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:1:9:牛奶:2:45` }));
    expect(inv.encoding).toBeNull();
    expect(inv.items).toEqual([]);
    expect(inv.itemsComplete).toBe(false);
  });

  it('尾段湊不齊四個前提欄 ⇒ 視同無尾段', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2` }));
    expect(inv.items).toEqual([]);
    expect(inv.encoding).toBeNull();
    expect(inv.itemsComplete).toBe(false);
  });

  it('77 字後不以 ":" 起頭的雜訊 ⇒ 視同無尾段（頭部照常成功）', () => {
    const inv = parseOk(makeLeftQr({ tail: `X${TEN_STARS}:2:2:1:牛奶:2:45` }));
    expect(inv.items).toEqual([]);
    expect(inv.encoding).toBeNull();
  });
});

// ---------- 編碼 2：Base64 品名 ----------

// 事先手算的向量（獨立於實作的解碼表，能抓到解碼器自身的錯）：
// '豆漿' UTF-8 = E8 B1 86 E6 BC BF ⇒ '6LGG5ry/'；'A茶' = 41 E8 8C B6 ⇒ 'QeiMtg=='
describe('編碼 2（Base64 品名）', () => {
  it('base64 → UTF-8 中文品名，含 padding', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:2:6LGG5ry/:1:30:QeiMtg==:2:15` }));
    expect(inv.items).toEqual([
      { name: '豆漿', qty: 1, unitPrice: 30 },
      { name: 'A茶', qty: 2, unitPrice: 15 },
    ]);
    expect(inv.itemsComplete).toBe(true);
  });

  it('壞 base64（非法字元/長度）⇒ 丟該品項、其餘保留', () => {
    const badChar = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:2:@@@@:1:30:6LGG5ry/:1:30` }));
    expect(badChar.items).toEqual([{ name: '豆漿', qty: 1, unitPrice: 30 }]);
    expect(badChar.itemsComplete).toBe(false);

    const badLen = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:1:2:QQ=:1:30` }));
    expect(badLen.items).toEqual([]);
  });

  it('base64 合法但位元組不是合法 UTF-8（FF FF）⇒ 丟該品項', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:1:2://8=:1:30` }));
    expect(inv.items).toEqual([]);
    expect(inv.itemsComplete).toBe(false);
  });
});

// ---------- 編碼 0：Big5（zxing 已把位元組錯譯成字串） ----------

describe('編碼 0（Big5 失真情境）', () => {
  it('品名乾淨（無 U+FFFD）⇒ 原樣保留', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:0:鍋貼:10:5:酸辣湯:1:30` }));
    expect(inv.items).toEqual([
      { name: '鍋貼', qty: 10, unitPrice: 5 },
      { name: '酸辣湯', qty: 1, unitPrice: 30 },
    ]);
    expect(inv.itemsComplete).toBe(true);
    expect(inv.encoding).toBe(0);
  });

  it('任一品名含 U+FFFD ⇒ 位元組已失真，全部品項丟棄', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:0:鍋�貼:10:5:酸辣湯:1:30` }));
    expect(inv.items).toEqual([]);
    expect(inv.itemsComplete).toBe(false);
    expect(inv.encoding).toBe(0);
  });
});

// ---------- mergeRightQr ----------

describe('mergeRightQr', () => {
  it('右碼只有 "**"（最常見）⇒ no-op，原物件退回', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:1:牛奶:2:45:麵包:1:30` }));
    expect(mergeRightQr(inv, '**')).toBe(inv);
  });

  it('rightText 不以 ** 開頭 ⇒ 原樣退回', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:2:1:牛奶:2:45:麵包:1:30` }));
    expect(mergeRightQr(inv, '牛奶:1:2')).toBe(inv);
  });

  it('inv.encoding 為 null（無尾段）⇒ 品名無從解讀，原樣退回', () => {
    const inv = parseOk(makeLeftQr());
    expect(mergeRightQr(inv, '**牛奶:1:2')).toBe(inv);
  });

  it('續 1 項湊滿總筆數 ⇒ itemsComplete 翻 true', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:3:1:牛奶:2:45:麵包:1:30` }));
    expect(inv.itemsComplete).toBe(false); // 左碼只載 2/3
    const merged = mergeRightQr(inv, '**布丁:1:25');
    expect(merged.items).toEqual([
      { name: '牛奶', qty: 2, unitPrice: 45 },
      { name: '麵包', qty: 1, unitPrice: 30 },
      { name: '布丁', qty: 1, unitPrice: 25 },
    ]);
    expect(merged.itemsComplete).toBe(true);
    // 頭部欄位不因合併而變
    expect(merged.number).toBe(inv.number);
    expect(merged.totalAmount).toBe(inv.totalAmount);
  });

  it('續了但仍未滿 ⇒ itemsComplete 維持 false', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:3:1:牛奶:2:45` }));
    const merged = mergeRightQr(inv, '**布丁:1:25');
    expect(merged.items).toHaveLength(2);
    expect(merged.itemsComplete).toBe(false);
  });

  it('左碼 0:2（品項全在右碼）⇒ 右碼補齊後 true', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:0:2:1` }));
    const merged = mergeRightQr(inv, '**牛奶:2:45:麵包:1:30');
    expect(merged.items).toHaveLength(2);
    expect(merged.itemsComplete).toBe(true);
  });

  it('右碼同淨化規則：殘尾丟棄、壞三元組丟棄', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:2:3:1:牛奶:2:45:麵包:1:30` }));
    const merged = mergeRightQr(inv, '**布丁:1:25:殘');
    expect(merged.items).toHaveLength(3); // 殘尾 '殘' 丟棄，布丁保留
    expect(merged.itemsComplete).toBe(true);
    // 全壞 ⇒ 一項都沒補上，no-op
    expect(mergeRightQr(inv, '**布丁:-1:25')).toBe(inv);
  });

  it('右碼品名同編碼旗標：Base64 左碼 ⇒ 右碼也走 Base64 解碼', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:2:2:6LGG5ry/:1:30` }));
    const merged = mergeRightQr(inv, '**QeiMtg==:2:15');
    expect(merged.items).toEqual([
      { name: '豆漿', qty: 1, unitPrice: 30 },
      { name: 'A茶', qty: 2, unitPrice: 15 },
    ]);
    expect(merged.itemsComplete).toBe(true);
  });
});

// ---------- 快篩函式 ----------

describe('looksLikeEInvoiceLeft', () => {
  it('正例：合法 77 字頭，無尾段/有尾段/小寫字軌皆過', () => {
    expect(looksLikeEInvoiceLeft(makeLeftQr())).toBe(true);
    expect(looksLikeEInvoiceLeft(makeLeftQr({ tail: `:${TEN_STARS}:2:2:1:牛奶:2:45` }))).toBe(true);
    expect(looksLikeEInvoiceLeft(makeLeftQr({ number: 'ab12345678' }))).toBe(true);
  });

  it('反例：右碼、太短、hex 區壞形、日期區有字母、空字串', () => {
    expect(looksLikeEInvoiceLeft('**')).toBe(false);
    expect(looksLikeEInvoiceLeft(makeLeftQr().slice(0, 76))).toBe(false);
    expect(looksLikeEInvoiceLeft(makeLeftQr({ sales: 'GGGGGGGG' }))).toBe(false);
    expect(looksLikeEInvoiceLeft(makeLeftQr({ rocDate: '11a0806' }))).toBe(false);
    expect(looksLikeEInvoiceLeft('')).toBe(false);
  });
});

describe('looksLikeEInvoiceRight', () => {
  it('正例：以 ** 開頭（含只有 ** 的空右碼）', () => {
    expect(looksLikeEInvoiceRight('**')).toBe(true);
    expect(looksLikeEInvoiceRight('**豆漿:1:30')).toBe(true);
  });

  it('反例：單星、空字串、左碼', () => {
    expect(looksLikeEInvoiceRight('*')).toBe(false);
    expect(looksLikeEInvoiceRight('')).toBe(false);
    expect(looksLikeEInvoiceRight(makeLeftQr())).toBe(false);
  });
});

// ---------- 永不 throw ----------

describe('property：永不 throw', () => {
  it('任意 ASCII / 全 Unicode 垃圾字串 ⇒ parseEInvoiceLeft 只回結果物件', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(() => parseEInvoiceLeft(s)).not.toThrow();
        expect(typeof parseEInvoiceLeft(s).ok).toBe('boolean');
      }),
    );
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        expect(() => parseEInvoiceLeft(s)).not.toThrow();
      }),
    );
  });

  it('合法 77 字頭 + 任意垃圾尾段 ⇒ 頭部照常成功（尾段只退化不報錯）', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (tail) => {
        const r = parseEInvoiceLeft(makeLeftQr() + tail);
        expect(() => parseEInvoiceLeft(makeLeftQr() + tail)).not.toThrow();
        // 尾段再髒都不影響頭部：垃圾尾段只可能讓 items 退化，不會翻成 error
        expect(r.ok).toBe(true);
      }),
    );
  });

  it('mergeRightQr 收任意右碼字串 ⇒ 永不 throw', () => {
    const inv = parseOk(makeLeftQr({ tail: `:${TEN_STARS}:1:2:1:牛奶:2:45` }));
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        expect(() => mergeRightQr(inv, s)).not.toThrow();
      }),
    );
  });
});
