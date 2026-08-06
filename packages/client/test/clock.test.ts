/**
 * HLC 時鐘殼測試（審查修正 #5/#6 的回歸）：
 * 跨分頁協調（讀回 localStorage 取 max）與開機種鐘。
 * node 環境沒有 localStorage：以最小 shim 注入（storage.ts 只用 getItem/setItem）。
 */
import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
(globalThis as Record<string, unknown>)['localStorage'] = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { tickClock, recvClock, peekClock } = await import('../src/clock');
const { hlcParse } = await import('@zhangben/core');

describe('clock（跨分頁與種鐘）', () => {
  beforeEach(() => {
    // 不清 zb.deviceId：deviceId 穩定無妨；清時鐘讓每測獨立
    store.delete('zb.hlc');
  });

  it('tick 嚴格遞增且落盤', () => {
    const a = tickClock();
    const b = tickClock();
    expect(b > a).toBe(true);
    expect(store.get('zb.hlc')).toBe(JSON.stringify(b));
  });

  it('跨分頁：他分頁把更大的 HLC 寫進 localStorage 後，本分頁 mint 必嚴格大於它（不撞號）', () => {
    tickClock(); // 本分頁快取就位
    // 模擬另一分頁：直接寫入未來 1 小時的 HLC（同 deviceId——正是撞號險境）
    const future = `${String(Date.now() + 3_600_000).padStart(15, '0')}-0007-tab2`;
    store.set('zb.hlc', JSON.stringify(future));
    const minted = tickClock();
    expect(minted > future).toBe(true);
  });

  it('recvClock 吸收外部時鐘；壞字串安全忽略', () => {
    tickClock();
    const foreign = `${String(Date.now() + 60_000).padStart(15, '0')}-0001-peer`;
    recvClock(foreign);
    expect(peekClock() > foreign).toBe(true);
    const before = peekClock();
    recvClock('zzz-not-hlc');
    expect(peekClock()).toBe(before);
    expect(hlcParse('zzz-not-hlc')).toBeNull();
  });
});
