/**
 * Trystero（Nostr signaling）同步殼——protocol.ts 純 reducer 的 I/O 執行器。
 *
 * 為什麼選 Nostr strategy：公共 relay 數百個有冗餘、零自架；SDP 以
 * appId+password 派生金鑰自動加密，房間碼即通行密語。同一 Wi-Fi 下兩機
 * 走 host candidate 直連，relay 只經手 ~2KB 的 signaling。
 * STUN 仍帶 Google 公共伺服器讓異網情境（行動網路×Wi-Fi）也能打洞；TURN 不設（無免費）。
 */
import { joinRoom, type Room } from 'trystero/nostr';
import { changedSince, type Syncable } from '@zhangben/core';
import {
  makeSession,
  syncReduce,
  SYNC_KINDS,
  type PeerHello,
  type SyncEffect,
  type SyncEvent,
  type SyncKind,
  type SyncMsg,
  type SyncSession,
} from './protocol';
import { logError } from '../errlog';

const APP_ID = 'zhangben-sync-v1';
const BATCH_SIZE = 500;
/** 等不到對方進房 */
const JOIN_TIMEOUT_MS = 45_000;
/** 交換中對面失聲 */
const STALL_TIMEOUT_MS = 20_000;

/** 房間碼字集：去 0/O/1/I/L 防唸錯抄錯 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(): string {
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

export interface SyncDeps {
  /** 殼要串流的本地資料（呼叫當下的快照） */
  getLocalRows(kind: SyncKind): readonly Syncable[];
  /** 套用一批（同步決策 set + 落盤），失敗必須 throw（走 apply-failed，不存 checkpoint） */
  applyBatch(
    kind: SyncKind,
    rows: readonly Syncable[],
  ): Promise<{
    summary: { added: number; updated: number; skipped: number; deletes: number };
    deduped: number;
    /** 沒通過 rowSchema、被丟掉的列數（不影響協定：receivedRows 數的是「到達的」） */
    rejected: number;
  }>;
  /** 吸收對端時鐘 + 檔案化 checkpoint */
  onPeerHello(peer: PeerHello): void;
  saveCheckpoint(peer: PeerHello, checkpoint: string): void;
  /** 每次狀態變化回報（UI 渲染） */
  onState(session: SyncSession): void;
}

export interface SyncHandle {
  cancel(): void;
}

export function startSync(code: string, my: PeerHello, deps: SyncDeps): SyncHandle {
  let session = makeSession(my);
  let room: Room | null = null;
  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  // 回傳 Promise 而非 void（審查修正）：action.send 是 Promise<void>，把它丟掉的話
  // stream-batches 的 await 就 await 到 undefined ⇒ 所有 batch 同時灌進同一條
  // DataChannel ⇒ 撞 trystero 的 10 秒 backpressure 逾時（它會**靜默截斷**訊息但照樣
  // resolve）⇒ 對面收不齊、永不 ack、雙方 stall。逐批序列化本來就是這裡的原意。
  let sendMsg: ((msg: SyncMsg) => Promise<void>) | null = null;
  /** 套用必須序列化：同 kind 的批次亂序套用會讓「批內較新列」被後到的舊批蓋掉 */
  let applyChain: Promise<void> = Promise.resolve();

  const armStall = (): void => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => dispatch({ e: 'timeout' }), STALL_TIMEOUT_MS);
  };

  const teardown = (): void => {
    if (closed) return;
    closed = true;
    if (joinTimer) clearTimeout(joinTimer);
    if (stallTimer) clearTimeout(stallTimer);
    try {
      room?.leave();
    } catch {
      /* 已離房=無妨 */
    }
  };

  const run = (effects: SyncEffect[]): void => {
    for (const fx of effects) {
      switch (fx.f) {
        case 'send':
          // 效果清單是同步跑的、沒人 await 這裡 ⇒ 失敗只能用 .catch 接
          // （同步 try/catch 接不到 Promise 的 rejection，那等於沒有 errlog）
          void sendMsg?.(fx.msg).catch((err: unknown) => logError(`sync send: ${String(err)}`));
          break;
        case 'stream-batches': {
          deps.onPeerHello(fx.peer);
          // **接收端決定 since**：用對方 hello 表裡「記到我」的 checkpoint 當增量基準。
          // 對方 IDB 重灌時表為空 ⇒ 自動全量重送（合併冪等=零成本），舊帳補得回來。
          const since = fx.peer.checkpoints[my.deviceId] ?? '';
          void (async () => {
            let total = 0;
            let seq = 0;
            for (const kind of SYNC_KINDS) {
              const rows = changedSince(deps.getLocalRows(kind), since);
              for (let i = 0; i < rows.length; i += BATCH_SIZE) {
                const slice = rows.slice(i, i + BATCH_SIZE);
                total += slice.length;
                seq += 1;
                try {
                  await sendMsg?.({ t: 'batch', kind, rows: slice, seq });
                } catch (err) {
                  logError(`sync batch: ${String(err)}`);
                }
              }
            }
            dispatch({ e: 'sent-all', totalSent: total });
          })();
          break;
        }
        case 'apply': {
          const { kind, rows } = fx;
          applyChain = applyChain.then(async () => {
            try {
              const r = await deps.applyBatch(kind, rows);
              dispatch({ e: 'applied', kind, summary: r.summary, deduped: r.deduped, rejected: r.rejected });
            } catch (err) {
              // 落盤失敗**不可**偽裝成 applied——協定會照樣完成並存 checkpoint，
              // 該批資料從此永不重送。走 apply-failed=error、不存 checkpoint、下次重送。
              logError(`sync apply: ${String(err)}`);
              dispatch({ e: 'apply-failed' });
            }
          });
          break;
        }
        case 'save-checkpoint':
          deps.saveCheckpoint(fx.peer, fx.checkpoint);
          break;
        case 'leave':
          teardown();
          break;
      }
    }
  };

  const dispatch = (ev: SyncEvent): void => {
    if (closed && ev.e !== 'cancel') return;
    const [next, effects] = syncReduce(session, ev);
    session = next;
    // join 發條只保護 waiting 相位：對方 join 了卻沒送到 hello（立即斷線）時，
    // 45 秒 no-peer 逾時必須仍然有效——不能在 onPeerJoin 就繳械
    if (session.phase !== 'waiting' && joinTimer) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
    // 有任何往來就重上發條（終局態不再計時）
    if (session.phase === 'exchanging') armStall();
    deps.onState(session);
    run(effects);
  };

  try {
    room = joinRoom(
      {
        appId: APP_ID,
        password: code,
        rtcConfig: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
      },
      `zb-${code}`,
    );
    // trystero 0.25 API：makeAction 回物件、onPeerJoin/onPeerLeave 是可指派屬性。
    // SyncMsg 是自家介面（結構上就是 JSON），對 DataPayload 的名義檢查以 cast 過橋。
    // 慢鏈路上的大批次傳輸以 onProgress/onReceiveProgress 逐 chunk 重上發條——
    // 「還在動的傳輸」不是 stall；20 秒只在真正雙向失聲時觸發。
    const action = room.makeAction('m');
    sendMsg = (msg) => action.send(msg as never, { onProgress: () => armStall() });
    action.onReceiveProgress = () => armStall();
    action.onMessage = (data) => {
      armStall();
      dispatch({ e: 'msg', msg: data as unknown as SyncMsg });
    };
    room.onPeerJoin = () => dispatch({ e: 'peer-join' });
    room.onPeerLeave = () => dispatch({ e: 'peer-leave' });
    joinTimer = setTimeout(() => dispatch({ e: 'timeout' }), JOIN_TIMEOUT_MS);
    deps.onState(session);
  } catch (err) {
    logError(`sync join: ${String(err)}`);
    dispatch({ e: 'timeout' });
  }

  return {
    cancel() {
      dispatch({ e: 'cancel' });
      teardown();
    },
  };
}
