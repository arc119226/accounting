/**
 * 逐台實測公共 signaling relay 還能不能用。用法：`node tools/probe-relays.mjs`
 *
 * **為什麼需要這支**：`sync/relays.ts` 的設計把「自己維護一份會腐敗的名單」這個代價
 * 攬了下來（換來釘住清單、關掉洗牌 hazard）。這支就是讓那個代價變便宜的東西 ——
 * 要換 `public/relays.json` 之前先跑它，不要用猜的。
 *
 * **判準不是「連得上」。** 2026-09-03 第一次跑就發現：當時清單裡的 5 台有 3 台是死的，
 * 而其中兩台 WebSocket **開得起來**，只是每一則事件都被拒。只驗連線會全部誤判成健康。
 * 真正要驗的是**送得進去而且收得回來**：
 *
 *   1. 開 WS
 *   2. 送 Trystero 自己的 REQ（`kinds` + `since` + `#x`）
 *   3. 送 Trystero 自己的 `createEvent` 產的事件
 *   4. 那則有沒有從自己的訂閱回來
 *
 * ⚠️ **事件一定要用 `createEvent` 產，不能自己組。** 公共 relay 會驗 schnorr 簽章
 * （我們自架的那台不驗 —— 見 arc119226/relay 的 spec §4，金鑰每次隨機，驗了擋不到人），
 * 自己捏的假簽章會被公共 relay 全數拒收，結果是每一台都誤判成壞的。
 *
 * ⚠️ **一次 FAIL 不代表死。** 2026-09-03 連跑四輪：那 3 台死的每一輪都失敗、
 * 理由一字不變；而活著的偶爾會掉一台（`relay.damus.io` 四輪紅一次、`offchain.pub` 紅兩次）。
 * 判死刑要看**連續幾輪都紅而且理由一樣**，偶發的逾時是公共設施的常態 ——
 * 那正是清單要放好幾台的原因。
 *
 * kind 由 topic 決定（`strToNum(topic, 1e4) + 2e4`，落在 ephemeral 區段 20000–29999），
 * 所以每台給一個隨機 topic 就順便分散了 kind，彼此不會污染。
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// `trystero` 是 packages/client 的相依，不是 root 的；pnpm 不做提升，所以放在 root tools/
// 的這支**直接 import 會找不到**（tools/make-icons.mjs 能直接 import sharp 是因為 sharp
// 在 root devDeps）。從 client 的 package.json 起算去解析，才拿得到同一份 —— 不要為了
// 這支工具在 root 再裝一份 trystero，那會變成兩個版本各自漂移。
const requireFromClient = createRequire(new URL('../packages/client/package.json', import.meta.url));
const { createEvent, subscribe } = await import(pathToFileURL(requireFromClient.resolve('trystero/nostr')).href);

/** 要驗的清單。想加就加 —— 這支只回報，不會改任何檔案。 */
const CANDIDATES = [
  // 目前 public/relays.json 裡的
  'wss://staging.yabu.me',
  'wss://relay2.angor.io',
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  // 2026-09-03 實測掛掉、留著當回歸（哪天活過來會看到 PASS）
  'wss://hornetstorage.net/relay',
  'wss://slick.mjex.me',
  'wss://communities.nos.social',
  // 其他候選
  'wss://nostr.mom',
  'wss://offchain.pub',
  'wss://relay.mostr.pub',
  'wss://purplerelay.com',
  'wss://nostr.data.haus',
  'wss://nostr.sathoarder.com',
  'wss://nostr.oxtr.dev',
  // 自架的錨點（對照組；它不在 relays.json 裡，是 relays.ts 的常數）
  'wss://relay.arc.idv.tw',
];

/** 自架的錨點。在這裡只是對照組 —— 它不屬於 relays.json，見 sync/relays.ts 的 ANCHOR。 */
const ANCHOR = 'wss://relay.arc.idv.tw';
const TIMEOUT_MS = 8000;
const rnd = () => Math.random().toString(36).slice(2);

async function probe(url) {
  const topic = `probe${rnd()}${rnd()}`;
  const subId = `probe${rnd()}`.slice(0, 20);
  const t0 = Date.now();
  const notes = [];

  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    return { url, ok: false, why: `建不起來: ${String(e).slice(0, 50)}` };
  }

  const opened = await new Promise((res) => {
    const t = setTimeout(() => res('逾時'), TIMEOUT_MS);
    ws.onopen = () => (clearTimeout(t), res(true));
    ws.onerror = () => (clearTimeout(t), res('連不上'));
    ws.onclose = (e) => (clearTimeout(t), res(`開了就關 (code ${e?.code})`));
  });
  if (opened !== true) return { url, ok: false, why: opened };
  const connectMs = Date.now() - t0;

  const frame = await createEvent(topic, JSON.stringify({ probe: 1 }));
  const eventId = JSON.parse(frame)[1].id;

  const echoed = await new Promise((res) => {
    const t = setTimeout(() => res(false), TIMEOUT_MS);
    ws.onclose = (e) => (notes.push(`中途被關 (code ${e?.code})`), clearTimeout(t), res(false));
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return; // 不是 JSON 就不是 NIP-01,忽略
      }
      if (m[0] === 'NOTICE') notes.push(`NOTICE: ${String(m[1]).slice(0, 70)}`);
      if (m[0] === 'CLOSED') notes.push(`CLOSED: ${String(m[2]).slice(0, 70)}`);
      if (m[0] === 'OK' && m[1] === eventId && m[2] === false) notes.push(`拒收: ${String(m[3]).slice(0, 70)}`);
      if (m[0] === 'EVENT' && m[1] === subId && m[2]?.id === eventId) {
        clearTimeout(t);
        res(true);
      }
    };
    ws.send(subscribe(subId, topic));
    // 等訂閱先在對面生效,否則自己的事件可能在建訂閱之前就被轉發掉
    setTimeout(() => {
      try {
        ws.send(frame);
      } catch {
        /* 已關 */
      }
    }, 400);
  });

  try {
    ws.close();
  } catch {
    /* 已關 */
  }
  return {
    url,
    ok: echoed,
    why: echoed ? `連上 ${connectMs}ms、送得進收得回` : (notes[0] ?? '送出去沒回來（拒收 ephemeral 或靜默丟棄）'),
  };
}

const results = [];
for (const url of CANDIDATES) {
  const r = await probe(url); // 一台一台來,不並行 —— 免得互相搶頻寬影響連線時間
  results.push(r);
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${url.replace('wss://', '').padEnd(26)} ${r.why}`);
}

const good = results.filter((r) => r.ok).map((r) => r.url);
// 錨點不進 relays.json —— 它是 sync/relays.ts 的常數，那份 JSON 動不到它。
//（`cleanTail` 的 `isUsable` 本來就會濾掉，但在這裡先拿掉才不會誤導人去貼。）
const tail = good.filter((u) => u !== ANCHOR);
console.log(`\n可用 ${good.length} / ${results.length}。扣掉錨點，可以貼進 public/relays.json 的 relays:`);
console.log(JSON.stringify(tail, null, 2));
process.exit(0);
