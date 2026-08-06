/**
 * deep link 解析：這支函式同時是**相容性契約**（舊版 QR 發網址、新版發 zb1:，
 * 而 QR 是對方掃的，兩種都得永遠認得）與**輸入防線**（location.hash 與相機解出來的
 * 字串都是不可信來源，形狀不對一律回 null，別讓垃圾字串進 joinSync）。
 */
import { describe, expect, it } from 'vitest';
import { buildSyncLink, parseSyncLink } from '../src/sync/deepLink';

describe('parseSyncLink（兩種 payload 的相容契約）', () => {
  it('現行 zb1: 形', () => {
    expect(parseSyncLink('zb1:ABC234')).toBe('ABC234');
    expect(parseSyncLink('ZB1:ABC234')).toBe('ABC234');
    expect(parseSyncLink('  zb1:abc234  ')).toBe('ABC234'); // 前後空白與小寫都容忍
  });

  it('舊版網址 hash 形（舊 app 還在發，不可拿掉）', () => {
    expect(parseSyncLink('#sync=ABC234')).toBe('ABC234');
    expect(parseSyncLink('https://accounting.arc.idv.tw/#sync=ABC234')).toBe('ABC234');
    expect(parseSyncLink('https://accounting.arc.idv.tw/#SYNC=abc234')).toBe('ABC234');
  });

  it('buildSyncLink 產出的內容自己解得回來（成對契約）', () => {
    expect(parseSyncLink(buildSyncLink('XYZ789'))).toBe('XYZ789');
  });

  it('形狀不對一律 null', () => {
    expect(parseSyncLink('')).toBeNull();
    expect(parseSyncLink('ABC234')).toBeNull(); // 裸碼不算 link
    expect(parseSyncLink('zb1:ABC23')).toBeNull(); // 5 碼
    expect(parseSyncLink('zb1:ABC2345')).toBeNull(); // 7 碼
    expect(parseSyncLink('zb1:ABC-34')).toBeNull(); // 非碼字元
    expect(parseSyncLink('https://evil.example/?x=#sync=')).toBeNull();
    expect(parseSyncLink('隨便一張二維碼的內容')).toBeNull();
    // 發票左碼（掃碼加入時最常見的鄰居）不可被誤判成房間碼
    expect(parseSyncLink('AB1234567810903121234000001f4000001f4000000000000000')).toBeNull();
  });

  it('7 碼不切前 6：#sync= 後面必須剛好結束', () => {
    expect(parseSyncLink('#sync=ABC2345')).toBeNull();
  });
});
