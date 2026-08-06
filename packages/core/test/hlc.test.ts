/**
 * hlc.ts 的測試——property 為主（fast-check）。
 *
 * HLC 的價值全在不變量（保序、嚴格遞增、round-trip），逐例測試只能覆蓋想得到的組合，
 * property test 才逼得出牆鐘倒退、ctr 頂到天花板、device 含 '-' 這類角落。
 * ms 產生器刻意壓在 10^15-2 以內：溢位進位（ms+1）後仍須落在 15 位定寬內——
 * 定寬破裂（西元 33658 年後）是 hlc.ts 檔頭記錄在案的已知邊界，不在測試範圍。
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Hlc } from '../src/hlc';
import { HLC_ZERO, hlcCompare, hlcEncode, hlcInit, hlcParse, hlcRecv, hlcTick } from '../src/hlc';

/** fc.nat 只保證 32 位範圍，大 ms 用兩段組出：最大 999999*10^9 + 999999998 = 10^15 - 2 */
const msArb = fc
  .tuple(fc.nat({ max: 999_999 }), fc.nat({ max: 999_999_998 }))
  .map(([hi, lo]) => hi * 1_000_000_000 + lo);

const ctrArb = fc.nat({ max: 0xffff });

/** device 含 '-'、空字串、非 ASCII 都是合法輸入（真實 device id 可能是 uuid） */
const deviceArb = fc.oneof(fc.string(), fc.fullUnicodeString());

const hlcArb: fc.Arbitrary<Hlc> = fc.record({ ms: msArb, ctr: ctrArb, device: deviceArb });

/** 牆鐘可以倒退甚至為負（使用者亂調時間）——tick/recv 的嚴格遞增不許依賴牆鐘單調 */
const wallArb = fc.tuple(fc.boolean(), msArb).map(([neg, n]) => (neg ? -n : n));

/** 參照比較器：(ms, ctr, device) 逐欄比較——encode 保序 property 的「正確答案」 */
function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function cmpFields(a: Hlc, b: Hlc): number {
  return (
    cmpNum(a.ms, b.ms) ||
    cmpNum(a.ctr, b.ctr) ||
    (a.device < b.device ? -1 : a.device > b.device ? 1 : 0)
  );
}

describe('hlcInit / HLC_ZERO', () => {
  it('hlcInit 回 {ms:0, ctr:0, device}', () => {
    expect(hlcInit('dev-A')).toEqual({ ms: 0, ctr: 0, device: 'dev-A' });
  });

  it('HLC_ZERO 是契約指定的字面值', () => {
    expect(HLC_ZERO).toBe('000000000000000-0000-0');
    expect(HLC_ZERO).toBe(hlcEncode({ ms: 0, ctr: 0, device: '0' }));
  });

  it('property：任何真實編輯（init 後 tick，含牆鐘為負）必勝 HLC_ZERO', () => {
    fc.assert(
      fc.property(deviceArb, wallArb, (device, wallMs) => {
        const first = hlcTick(hlcInit(device), wallMs);
        expect(hlcCompare(hlcEncode(first), HLC_ZERO)).toBeGreaterThan(0);
      }),
    );
  });
});

describe('hlcEncode / hlcCompare', () => {
  it('property：encode 保序——字典序符號 === (ms, ctr, device) 逐欄比較符號', () => {
    fc.assert(
      fc.property(hlcArb, hlcArb, (a, b) => {
        const got = Math.sign(hlcCompare(hlcEncode(a), hlcEncode(b)));
        expect(got).toBe(Math.sign(cmpFields(a, b)));
      }),
    );
  });

  it('hlcCompare 是純字典序（<0 / 0 / >0）', () => {
    expect(hlcCompare('a', 'b')).toBeLessThan(0);
    expect(hlcCompare('b', 'a')).toBeGreaterThan(0);
    expect(hlcCompare('a', 'a')).toBe(0);
  });

  it('encode 定寬：ms 十進位 15 位、ctr 十六進位小寫 4 位', () => {
    expect(hlcEncode({ ms: 1722900000000, ctr: 0xab, device: 'x' })).toBe(
      '001722900000000-00ab-x',
    );
  });
});

describe('hlcTick', () => {
  it('property：對任意 prev 與任意 wallMs（含倒退／負值），tick 嚴格遞增', () => {
    fc.assert(
      fc.property(hlcArb, wallArb, (prev, wallMs) => {
        const next = hlcTick(prev, wallMs);
        expect(hlcCompare(hlcEncode(next), hlcEncode(prev))).toBeGreaterThan(0);
      }),
    );
  });

  it('property：tick 結果永遠可定寬編碼（ctr ≤ 0xffff、device 不變）', () => {
    fc.assert(
      fc.property(hlcArb, wallArb, (prev, wallMs) => {
        const next = hlcTick(prev, wallMs);
        expect(next.ctr).toBeLessThanOrEqual(0xffff);
        expect(next.ctr).toBeGreaterThanOrEqual(0);
        expect(next.device).toBe(prev.device);
      }),
    );
  });

  it('牆鐘前進 → ms 跟上、ctr 歸零', () => {
    expect(hlcTick({ ms: 100, ctr: 7, device: 'a' }, 200)).toEqual({ ms: 200, ctr: 0, device: 'a' });
  });

  it('牆鐘停滯或倒退 → ms 不動、ctr+1', () => {
    expect(hlcTick({ ms: 100, ctr: 7, device: 'a' }, 100)).toEqual({ ms: 100, ctr: 8, device: 'a' });
    expect(hlcTick({ ms: 100, ctr: 7, device: 'a' }, 50)).toEqual({ ms: 100, ctr: 8, device: 'a' });
  });
});

/**
 * wallMs 非整數 —— 全案唯一「一個輸入就能無聲毀掉全部同步」的類別。
 *
 * ms 是唯一被 padStart(15,'0') 定寬編碼的欄位，而定寬正是「字典序＝全序」的根基
 * （merge.ts 熱路徑只比字串、從不解碼）。1234.5 會編出 '00000000001234.5'：
 * 16 個字元、還帶小數點，定寬破裂、全序報銷，而且沒有任何地方會報錯。
 * 呼叫端目前只餵 Date.now()（必為整數）所以踩不到——正因為踩不到，更要有測試守著，
 * 未來任何人改用 performance.timeOrigin+performance.now() 之類的來源就會在這裡炸。
 */
describe('wallMs 的定寬防線', () => {
  const widthOk = (h: { ms: number; ctr: number; device: string }): boolean =>
    /^\d{15}-[0-9a-f]{4}-/.test(hlcEncode(h));

  it('小數 wallMs 不得破壞定寬（tick 與 recv 皆然）', () => {
    const prev = { ms: 100, ctr: 0, device: 'a' };
    expect(widthOk(hlcTick(prev, 1234.5))).toBe(true);
    expect(hlcTick(prev, 1234.5).ms).toBe(1234);
    expect(widthOk(hlcRecv(prev, { ms: 50, ctr: 0, device: 'b' }, 9999.99))).toBe(true);
  });

  it('NaN / Infinity 的 wallMs 退化成「牆鐘沒前進」而不是產生壞編碼', () => {
    const prev = { ms: 100, ctr: 7, device: 'a' };
    expect(hlcTick(prev, NaN)).toEqual({ ms: 100, ctr: 8, device: 'a' });
    expect(hlcTick(prev, Infinity)).toEqual({ ms: 100, ctr: 8, device: 'a' });
    expect(widthOk(hlcTick(prev, NaN))).toBe(true);
  });

  it('property：任意有限 wallMs（含小數、負值）都編得出定寬字串且仍嚴格遞增', () => {
    fc.assert(
      fc.property(hlcArb, fc.double({ min: -1e12, max: 1e12, noNaN: true }), (prev, wallMs) => {
        const next = hlcTick(prev, wallMs);
        expect(widthOk(next)).toBe(true);
        expect(hlcCompare(hlcEncode(next), hlcEncode(prev))).toBeGreaterThan(0);
      }),
    );
  });
});

describe('hlcRecv', () => {
  it('property：recv 嚴格大於雙輸入（收訊本身也是事件）', () => {
    fc.assert(
      fc.property(hlcArb, hlcArb, wallArb, (prev, remote, wallMs) => {
        const merged = hlcEncode(hlcRecv(prev, remote, wallMs));
        expect(hlcCompare(merged, hlcEncode(prev))).toBeGreaterThan(0);
        expect(hlcCompare(merged, hlcEncode(remote))).toBeGreaterThan(0);
      }),
    );
  });

  it('property：recv 結果 ctr ≤ 0xffff、device 保持本機', () => {
    fc.assert(
      fc.property(hlcArb, hlcArb, wallArb, (prev, remote, wallMs) => {
        const next = hlcRecv(prev, remote, wallMs);
        expect(next.ctr).toBeLessThanOrEqual(0xffff);
        expect(next.device).toBe(prev.device);
      }),
    );
  });

  it('論文分支：三方同 ms → ctr = max(雙方 ctr)+1', () => {
    expect(hlcRecv({ ms: 9, ctr: 3, device: 'a' }, { ms: 9, ctr: 5, device: 'b' }, 9)).toEqual({
      ms: 9,
      ctr: 6,
      device: 'a',
    });
  });

  it('論文分支：ms 停在本機 → ctr = prev.ctr+1', () => {
    expect(hlcRecv({ ms: 9, ctr: 3, device: 'a' }, { ms: 4, ctr: 5, device: 'b' }, 2)).toEqual({
      ms: 9,
      ctr: 4,
      device: 'a',
    });
  });

  it('論文分支：ms 停在遠端（remote.ms 無上限，可遠超本機牆鐘）→ ctr = remote.ctr+1', () => {
    expect(
      hlcRecv({ ms: 9, ctr: 3, device: 'a' }, { ms: 999_999_999, ctr: 5, device: 'b' }, 2),
    ).toEqual({ ms: 999_999_999, ctr: 6, device: 'a' });
  });

  it('論文分支：本機牆鐘領先雙方 → ctr = 0', () => {
    expect(hlcRecv({ ms: 9, ctr: 3, device: 'a' }, { ms: 4, ctr: 5, device: 'b' }, 100)).toEqual({
      ms: 100,
      ctr: 0,
      device: 'a',
    });
  });
});

describe('ctr 溢位（0xffff → ms+1、ctr=0）', () => {
  it('tick：ms 停滯且 ctr 頂到 0xffff → 進位', () => {
    expect(hlcTick({ ms: 100, ctr: 0xffff, device: 'a' }, 50)).toEqual({
      ms: 101,
      ctr: 0,
      device: 'a',
    });
    expect(hlcTick({ ms: 100, ctr: 0xffff, device: 'a' }, 100)).toEqual({
      ms: 101,
      ctr: 0,
      device: 'a',
    });
  });

  it('tick：牆鐘前進就不進位（ctr 直接歸零）', () => {
    expect(hlcTick({ ms: 100, ctr: 0xffff, device: 'a' }, 101)).toEqual({
      ms: 101,
      ctr: 0,
      device: 'a',
    });
  });

  it('recv：三方同 ms 且 max ctr = 0xffff → 進位', () => {
    expect(
      hlcRecv({ ms: 9, ctr: 0xffff, device: 'a' }, { ms: 9, ctr: 0xfffe, device: 'b' }, 9),
    ).toEqual({ ms: 10, ctr: 0, device: 'a' });
  });

  it('recv：ms 停在遠端且 remote.ctr = 0xffff → 進位', () => {
    expect(
      hlcRecv({ ms: 3, ctr: 0, device: 'a' }, { ms: 9, ctr: 0xffff, device: 'b' }, 1),
    ).toEqual({ ms: 10, ctr: 0, device: 'a' });
  });
});

describe('hlcParse', () => {
  it('property：parse∘encode = identity（device 含 -、空字串、非 ASCII 皆還原）', () => {
    fc.assert(
      fc.property(hlcArb, (h) => {
        expect(hlcParse(hlcEncode(h))).toEqual(h);
      }),
    );
  });

  it('property：任意字串永不 throw；parse 得出來的必是正準形（encode 還原原字串）', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.fullUnicodeString()), (s) => {
        const p = hlcParse(s); // 不 throw 本身就是斷言的一部分
        if (p !== null) {
          expect(hlcEncode(p)).toBe(s);
        }
      }),
    );
  });

  it('垃圾字串回 null', () => {
    const garbage = [
      '',
      'hello',
      '123-0000-a', // ms 不足 15 位
      '0000000000000000-0000-a', // ms 16 位
      '000000000000000-000-a', // ctr 不足 4 位
      '000000000000000-00FF-a', // 大寫 hex 非正準形
      '000000000000000_0000_a', // 分隔符錯誤
      '00000000000000x-0000-a', // ms 混入非數字
      '000000000000000-0000', // 缺第二個 '-'（無 device 段）
      ' 000000000000000-0000-a', // 前導空白
      '000000000000000-00g0-a', // ctr 混入非 hex
    ];
    for (const s of garbage) {
      expect(hlcParse(s)).toBeNull();
    }
  });

  it('device 含 "-"（uuid 形）也能無歧義還原', () => {
    const h: Hlc = { ms: 1722900000000, ctr: 1, device: '0198-a2b3-c4d5' };
    expect(hlcParse(hlcEncode(h))).toEqual(h);
  });
});
