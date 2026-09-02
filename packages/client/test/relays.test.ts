/**
 * relay 清單:釘住、可更新、**錨點不可失**。
 *
 * 這支鎖的核心不變量只有一句:**`relayUrls()` 恆非空且第一個恆是自架的錨點。**
 * 那是「兩支手機必定相遇」的唯一保證 —— 一旦哪次改動讓遠端的 JSON 有能力清空或
 * 取代它,BACKLOG 那條「兩支手機永遠配不上對」的 hazard 就從結構性關閉退回成祈禱。
 *
 * 跑在 node:localStorage 與 fetch 都要自己墊(db.test 用 fake-indexeddb 是同一個道理)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANCHOR, refreshRelays, relayStatus, relayUrls } from '../src/sync/relays';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
});

/** 讓 fetch 回一份 relays.json */
const serve = (body: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => body }) as unknown as Response),
  );
};
/** 讓 fetch 壞掉(離線、部署間隙、SPA fallback 回 index.html 導致 JSON.parse 爆) */
const serveBroken = (): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('offline');
    }),
  );
};

const NOW = 1_788_400_000_000;

describe('錨點:不可失、恆在第一個', () => {
  it('全新裝置(沒有快取)也拿得到錨點 + 內建清單', () => {
    const urls = relayUrls();
    expect(urls[0]).toBe(ANCHOR);
    expect(urls.length).toBeGreaterThan(1);
  });

  it('遠端 JSON **不能**把錨點洗掉:給空陣列時整份不採用', async () => {
    serve({ relays: [] });
    expect(await refreshRelays(NOW)).toBe(false);
    expect(relayUrls()[0]).toBe(ANCHOR);
    expect(relayUrls().length).toBeGreaterThan(1); // 手上原本能用的那份留著
  });

  it('遠端 JSON 全是垃圾時也不採用(不要把能用的洗掉)', async () => {
    serve({ relays: ['http://x', 'ws://y', '', 42, null, 'not a url'] });
    expect(await refreshRelays(NOW)).toBe(false);
    expect(relayUrls()[0]).toBe(ANCHOR);
  });

  it('遠端把錨點也列進來時只留一份(不重複連同一台)', async () => {
    serve({ relays: [ANCHOR, 'wss://a.example', ANCHOR] });
    await refreshRelays(NOW);
    const urls = relayUrls();
    expect(urls.filter((u) => u === ANCHOR).length).toBe(1);
    expect(urls).toEqual([ANCHOR, 'wss://a.example']);
  });
});

describe('清洗遠端清單', () => {
  it('只收 wss://,其餘濾掉', async () => {
    serve({ relays: ['wss://good.example', 'ws://plain.example', 'https://web.example', 'wss://also.example'] });
    await refreshRelays(NOW);
    expect(relayUrls()).toEqual([ANCHOR, 'wss://good.example', 'wss://also.example']);
  });

  it('去重', async () => {
    serve({ relays: ['wss://a.example', 'wss://a.example', 'wss://b.example'] });
    await refreshRelays(NOW);
    expect(relayUrls()).toEqual([ANCHOR, 'wss://a.example', 'wss://b.example']);
  });

  it('夾長度:後段不會無上限成長(每一台都是一條 WebSocket)', async () => {
    serve({ relays: Array.from({ length: 40 }, (_, i) => `wss://r${i}.example`) });
    await refreshRelays(NOW);
    expect(relayUrls().length).toBeLessThanOrEqual(9); // 錨點 + MAX_TAIL(8)
  });

  it('形狀不對的整包(不是陣列、缺 relays 欄位)一律當作沒拿到', async () => {
    for (const body of [{}, { relays: 'wss://x' }, { relays: null }, null, 'nope', 42]) {
      store.clear();
      serve(body);
      expect(await refreshRelays(NOW), JSON.stringify(body)).toBe(false);
      expect(relayUrls()[0]).toBe(ANCHOR);
    }
  });
});

describe('refreshRelays 的回傳與失敗處置', () => {
  it('換了才回 true;內容一樣回 false', async () => {
    serve({ relays: ['wss://a.example'] });
    expect(await refreshRelays(NOW)).toBe(true);
    expect(await refreshRelays(NOW + 1000)).toBe(false);
    serve({ relays: ['wss://a.example', 'wss://b.example'] });
    expect(await refreshRelays(NOW + 2000)).toBe(true);
  });

  it('fetch 壞掉時靜默:回 false、清單不動、永不 throw', async () => {
    serve({ relays: ['wss://a.example'] });
    await refreshRelays(NOW);
    serveBroken();
    await expect(refreshRelays(NOW + 5000)).resolves.toBe(false);
    expect(relayUrls()).toEqual([ANCHOR, 'wss://a.example']);
  });

  it('localStorage 整個不能用(無痕/配額滿)也不會掛,退回內建清單', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
    serve({ relays: ['wss://a.example'] });
    await expect(refreshRelays(NOW)).resolves.toBeTypeOf('boolean');
    expect(relayUrls()[0]).toBe(ANCHOR);
  });
});

describe('relayStatus(設定頁用)', () => {
  it('沒更新過時 updatedAt = 0', () => {
    expect(relayStatus().updatedAt).toBe(0);
  });

  it('更新過之後帶上時間,而且 urls 跟 relayUrls() 一致', async () => {
    serve({ relays: ['wss://a.example'] });
    await refreshRelays(NOW);
    const st = relayStatus();
    expect(st.updatedAt).toBe(NOW);
    expect(st.urls).toEqual(relayUrls());
  });
});
