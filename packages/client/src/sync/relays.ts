/**
 * Signaling relay 清單 —— 釘住、可更新、永遠有錨點。
 *
 * ## 為什麼要釘
 *
 * 不傳 `relayConfig.urls` 的話，Trystero 會從烤在 `@trystero-p2p/nostr` 裡的 47 個
 * **依 appId 決定性洗牌後取 5 個**。決定性是必要的（兩機得在同一批 relay 上碰頭），
 * 可是清單增刪任何一個，洗出來的 5 個就可能與舊版**毫無交集** —— 升級 trystero
 * ⇒ 一支更新、一支沒更新 ⇒ 兩邊各自在不同的 relay 上等，畫面只顯示「等不到對方」。
 * 這條 hazard 記在 BACKLOG，當時的處置只有註解。
 *
 * ## 為什麼釘了還能更新
 *
 * 「自己維護一份會腐敗的名單」本來是不釘的理由（現行 5 個裡就有一個叫
 * `staging.yabu.me`）。這裡的解法是**清單自己可以更新**：`/relays.json` 跟
 * `version.json` 一樣是同源、`.json` 不在 SW 的 precache patterns 裡 ⇒ 永遠走網路。
 * 改一份 JSON 部署上去，兩支手機下次開就換過來，**不必發新版 bundle**。
 *
 * 拉這支 json **不增加任何隱私成本**：app 本來就每 10 分鐘跟同一個網域要 `version.json`。
 * 也不增加信任面 —— 能改 `relays.json` 的人本來就能改 app 的 JS。
 *
 * ## 錨點:為什麼這件事現在是安全的
 *
 * `ANCHOR` 是自架的 relay，**refresh 永遠動不到它**，只換後面那串公共的。
 * 於是兩支手機**永遠至少共用一台**，公共清單各自不同也碰得到面。
 * 上面那條 hazard 因此是被**結構性關掉**，不是繞過去 —— 這也是自架的真正收益。
 */
import { loadJson, saveJson } from '../storage';

/** 自架的 relay。**不可被 relays.json 改掉、不可為空** —— 它是兩機必定相遇的地方。 */
export const ANCHOR = 'wss://relay.arc.idv.tw';

/**
 * 隨 bundle 出貨的公共 relay。拿不到 `relays.json`（離線、部署間隙）時用這串。
 *
 * 前兩台是**平滑升級的橋**：它們是舊版洗出來的那 5 個裡還活著的兩台，留著讓更新過的
 * 手機與還沒更新的手機仍然有交集、配得上對。沒有它們，升級當下就會複製出上面那條
 * hazard 的症狀（新舊兩機清單毫無交集）。兩支手機都更新完之後可以拿掉。
 *
 * 舊版那 5 個裡的另外 3 個（`hornetstorage.net/relay`、`slick.mjex.me`、
 * `communities.nos.social`）**2026-09-03 實測全掛** —— 前兩台 WebSocket 開得起來但每則
 * 事件都被拒（一台改成允許清單制、一台每則都 internal error），第三台連不上。
 * 它們橋不到任何東西，只是三條必然失敗的連線，所以移除。
 * 也就是說柴米帳先前實際上是靠 `staging.yabu.me` 與 `relay2.angor.io` 兩台在配對 ——
 * 這正是錨點要解決的事：那是唯一一台**壞了我會知道**的。
 *
 * ⚠️ 這串跟 `public/relays.json` 目前是同一份，刻意的：讓「離線的全新安裝」與
 * 「線上的全新安裝」行為一致，少一種只在離線出現的狀態。之後只改 JSON 就好，
 * 這串不必跟著動（它只在第一次 refresh 成功之前有效）。
 * 要換清單前先跑 `node tools/probe-relays.mjs` —— 判準是「送得進去且收得回來」，
 * 不是「連得上」。上面那 3 台就是只驗連線會誤判成健康的例子。
 */
const BUNDLED_TAIL: readonly string[] = [
  'wss://staging.yabu.me',
  'wss://relay2.angor.io',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const KEY = 'zb.relays';
/** 後段最多幾台。連線是同步當下才建的，可是每台都是一條 WebSocket，不該無上限。 */
const MAX_TAIL = 8;

interface RelayCache {
  /** 只存公共那一段；錨點是常數，不進快取（免得舊快取把它蓋掉或弄丟） */
  readonly tail: readonly string[];
  /** 上次成功更新的牆鐘（0=從未，用的是 bundled） */
  readonly at: number;
}

function defaults(): RelayCache {
  return { tail: [...BUNDLED_TAIL], at: 0 };
}

/** `wss://` 且解析得開;錨點不算(它由常數保證,不該在後段重複一次) */
function isUsable(u: unknown): u is string {
  if (typeof u !== 'string' || u.length === 0 || u.length > 200) return false;
  if (u === ANCHOR) return false;
  try {
    return new URL(u).protocol === 'wss:';
  } catch {
    return false;
  }
}

/** 清洗一串候選:濾掉不合格的、去重、夾長度。全部不合格就回 null(當作沒拿到)。 */
function cleanTail(raw: unknown): readonly string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = [...new Set(raw.filter(isUsable))].slice(0, MAX_TAIL);
  return out.length > 0 ? out : null;
}

function normalize(raw: unknown): RelayCache {
  const d = defaults();
  if (typeof raw !== 'object' || raw === null) return d;
  const o = raw as Record<string, unknown>;
  const tail = cleanTail(o['tail']);
  const at = o['at'];
  return {
    tail: tail ?? d.tail,
    at: typeof at === 'number' && at >= 0 ? at : 0,
  };
}

function read(): RelayCache {
  return loadJson(KEY, normalize, defaults);
}

/**
 * 這次同步要用的 relay。**錨點永遠在第一個、永遠在**。
 * Trystero 的 `getRelays` 第一個分支就是 `config.relayConfig?.urls`，會**原樣全用**，
 * 不套 redundancy 切片 —— 所以這裡回幾個就連幾個。
 */
export function relayUrls(): readonly string[] {
  return [ANCHOR, ...read().tail];
}

/** 設定頁要顯示的東西:目前用哪幾台、上次更新是什麼時候。 */
export function relayStatus(): { readonly urls: readonly string[]; readonly updatedAt: number } {
  const c = read();
  return { urls: [ANCHOR, ...c.tail], updatedAt: c.at };
}

/**
 * 去同源要一次最新的公共清單。
 *
 * 靜默:拿不到就是離線或部署間隙,下次再說 —— 手上那份(快取或 bundled)一定能用。
 * 回傳「有沒有真的換掉」給設定頁的手動更新用;啟動時的自動更新不看它。
 */
export async function refreshRelays(nowMs: number): Promise<boolean> {
  try {
    const res = await fetch('/relays.json', { cache: 'no-store' });
    const data: unknown = await res.json();
    const tail = cleanTail((data as { relays?: unknown }).relays);
    if (tail === null) return false; // 空的或全爛 ⇒ 當作沒拿到,不要把手上能用的洗掉
    const cur = read();
    const same = cur.tail.length === tail.length && cur.tail.every((u, i) => u === tail[i]);
    saveJson(KEY, { tail, at: nowMs } satisfies RelayCache);
    return !same;
  } catch {
    // SPA fallback 會把缺檔回成 index.html ⇒ JSON.parse 失敗走這裡,跟 version.ts 同一條慣例
    return false;
  }
}
