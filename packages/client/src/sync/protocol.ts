/**
 * 同步協定純 reducer——**不碰 WebRTC**。事件進、[新狀態, 效果清單] 出；
 * trystero.ts 殼負責把效果變成真實 I/O、把網路事件餵回來。
 * 這個切法讓整個協定能在 node 用腳本化事件序列測試（test/syncProtocol.test.ts）。
 *
 * 訊息流（兩側對稱）：
 *   peer-join → 互送 hello → 各自依對方 checkpoint 串流 batch → done → 對面套用完回 ack
 *   → 雙向 done+ack 齊 → save-checkpoint（= min(雙方 hello 時刻 HLC)，兩側算出同值）→ bye → leave
 * checkpoint 取 hello 時刻而非完成時刻：同步窗內的並發寫留給下次重送，合併冪等使重送零成本。
 */
import type { MergeSummary, PersonId, Syncable } from '@zhangben/core';

export type SyncKind = 'records' | 'categories' | 'rules' | 'budget';
export const SYNC_KINDS: readonly SyncKind[] = ['records', 'categories', 'rules', 'budget'];

export interface PeerHello {
  readonly deviceId: string;
  readonly person: PersonId;
  readonly personNames: Readonly<Record<PersonId, string>>;
  /** hello 時刻的 HLC（checkpoint 計算與時鐘吸收用） */
  readonly hlcNow: string;
  /** 物理牆鐘 ms：UI 比對兩機時鐘差 >10 分鐘出警示 */
  readonly wallMs: number;
  /**
   * 我方記錄的各 peer checkpoint 表（peerDeviceId → lastSyncedAt）。
   * **接收端決定 since**（審查修正 #17）：傳送端改用「對方表裡記的我」當增量基準——
   * 對方 IDB 被回收而重來時此表為空 ⇒ 自動退全量重送，舊帳補得回來。
   */
  readonly checkpoints: Readonly<Record<string, string>>;
}

export type SyncMsg =
  | { readonly t: 'hello'; readonly hello: PeerHello }
  | { readonly t: 'batch'; readonly kind: SyncKind; readonly rows: readonly Syncable[]; readonly seq: number }
  | { readonly t: 'done'; readonly totalSent: number }
  | { readonly t: 'ack' }
  | { readonly t: 'bye' };

export type SyncEvent =
  | { readonly e: 'peer-join' }
  | { readonly e: 'peer-leave' }
  | { readonly e: 'msg'; readonly msg: SyncMsg }
  | { readonly e: 'sent-all'; readonly totalSent: number }
  | { readonly e: 'applied'; readonly kind: SyncKind; readonly summary: MergeSummary; readonly deduped: number }
  /** 套用落盤失敗：**不可**偽裝成 applied——那會讓協定完成、checkpoint 照存、該批永久遺失 */
  | { readonly e: 'apply-failed' }
  | { readonly e: 'timeout' }
  | { readonly e: 'cancel' };

export type SyncEffect =
  | { readonly f: 'send'; readonly msg: SyncMsg }
  /** 收到對方 hello 後觸發：殼依 checkpoint 算 changedSince、串流 batch、結尾發 sent-all 事件 */
  | { readonly f: 'stream-batches'; readonly peer: PeerHello }
  | { readonly f: 'apply'; readonly kind: SyncKind; readonly rows: readonly Syncable[] }
  | { readonly f: 'save-checkpoint'; readonly peer: PeerHello; readonly checkpoint: string }
  | { readonly f: 'leave' };

export type SyncPhase = 'waiting' | 'exchanging' | 'done' | 'error' | 'cancelled';
export type SyncError = 'no-peer' | 'stalled' | 'peer-left' | 'apply-failed';

export interface SyncTotals {
  readonly added: number;
  readonly updated: number;
  readonly skipped: number;
  readonly deletes: number;
  readonly deduped: number;
}

export interface SyncSession {
  readonly phase: SyncPhase;
  readonly my: PeerHello;
  readonly peer: PeerHello | null;
  readonly error: SyncError | null;
  /** 進度顯示 */
  readonly sent: number;
  readonly receivedBatches: number;
  readonly appliedBatches: number;
  /**
   * 完整性驗證（審查修正 #7）：wire 層（trystero backpressure 10s 逾時）會**靜默截斷**
   * 訊息且送方 resolve 成功——只憑批次數對不出丟批。收列數必須追上對方 done 宣告的
   * totalSent 才准 ack；否則雙方 stall timeout=可重試錯誤、不存 checkpoint。
   */
  readonly receivedRows: number;
  readonly expectedRows: number | null;
  /** 對方資料套進本地的累計摘要（唯一外顯的合併結果） */
  readonly totals: SyncTotals;
  /** 完成握手旗標 */
  readonly sentDone: boolean;
  readonly gotDone: boolean;
  readonly sentAck: boolean;
  readonly gotAck: boolean;
}

export function makeSession(my: PeerHello): SyncSession {
  return {
    phase: 'waiting',
    my,
    peer: null,
    error: null,
    sent: 0,
    receivedBatches: 0,
    appliedBatches: 0,
    receivedRows: 0,
    expectedRows: null,
    totals: { added: 0, updated: 0, skipped: 0, deletes: 0, deduped: 0 },
    sentDone: false,
    gotDone: false,
    sentAck: false,
    gotAck: false,
  };
}

/** checkpoint = min(雙方 hello HLC)：兩側各自計算必得同值（決定論） */
export function checkpointOf(a: PeerHello, b: PeerHello): string {
  return a.hlcNow < b.hlcNow ? a.hlcNow : b.hlcNow;
}

function maybeFinish(s: SyncSession): [SyncSession, SyncEffect[]] {
  // ack 條件：對方 done 已到、到的批都套完、**且實收列數對得上對方宣告**（丟批偵測）
  const effects: SyncEffect[] = [];
  let next = s;
  if (
    next.gotDone &&
    !next.sentAck &&
    next.appliedBatches >= next.receivedBatches &&
    next.receivedRows >= (next.expectedRows ?? 0)
  ) {
    next = { ...next, sentAck: true };
    effects.push({ f: 'send', msg: { t: 'ack' } });
  }
  if (next.sentDone && next.gotDone && next.sentAck && next.gotAck && next.phase === 'exchanging') {
    next = { ...next, phase: 'done' };
    if (next.peer) {
      effects.push(
        { f: 'save-checkpoint', peer: next.peer, checkpoint: checkpointOf(next.my, next.peer) },
        { f: 'send', msg: { t: 'bye' } },
        { f: 'leave' },
      );
    }
  }
  return [next, effects];
}

export function syncReduce(s: SyncSession, ev: SyncEvent): [SyncSession, SyncEffect[]] {
  // 終局態只認 cancel（殼在 leave 後可能還會漏事件進來，一律吞掉）
  if (s.phase === 'done' || s.phase === 'error' || s.phase === 'cancelled') {
    return [s, []];
  }

  switch (ev.e) {
    case 'peer-join':
      // 兩側都在 join 時送 hello（重複 join 事件冪等：hello 重送無害，對面以 peer 存在與否去重）
      return [s, [{ f: 'send', msg: { t: 'hello', hello: s.my } }]];

    case 'peer-leave': {
      if (s.phase === 'waiting') return [s, []]; // 還沒開始，等下一個 join
      // done 之前對面走人=中斷（已套用的批次落盤無害——冪等，下次重送）
      return [{ ...s, phase: 'error', error: 'peer-left' }, [{ f: 'leave' }]];
    }

    case 'timeout':
      return [
        { ...s, phase: 'error', error: s.phase === 'waiting' ? 'no-peer' : 'stalled' },
        [{ f: 'leave' }],
      ];

    case 'apply-failed':
      // 本側落盤壞了：發 bye 讓對側走 error 路徑，雙方都不存 checkpoint → 下次重送
      return [
        { ...s, phase: 'error', error: 'apply-failed' },
        [{ f: 'send', msg: { t: 'bye' } }, { f: 'leave' }],
      ];

    case 'cancel':
      return [{ ...s, phase: 'cancelled' }, [{ f: 'send', msg: { t: 'bye' } }, { f: 'leave' }]];

    case 'sent-all': {
      const next = { ...s, sent: ev.totalSent, sentDone: true };
      const [n2, fx] = maybeFinish(next);
      return [n2, [{ f: 'send', msg: { t: 'done', totalSent: ev.totalSent } }, ...fx]];
    }

    case 'applied': {
      const t = s.totals;
      const next: SyncSession = {
        ...s,
        appliedBatches: s.appliedBatches + 1,
        totals: {
          added: t.added + ev.summary.added,
          updated: t.updated + ev.summary.updated,
          skipped: t.skipped + ev.summary.skipped,
          deletes: t.deletes + ev.summary.deletes,
          deduped: t.deduped + ev.deduped,
        },
      };
      return maybeFinish(next);
    }

    case 'msg':
      switch (ev.msg.t) {
        case 'hello': {
          if (s.peer) return [s, []]; // 重複 hello 冪等
          const peer = ev.msg.hello;
          return [
            { ...s, peer, phase: 'exchanging' },
            [
              // 對面可能沒收到我們 join 時的 hello（訊號競速）：收到 hello 必回一次
              { f: 'send', msg: { t: 'hello', hello: s.my } },
              { f: 'stream-batches', peer },
            ],
          ];
        }
        case 'batch': {
          if (!s.peer) return [s, []]; // hello 前的 batch=協定違規，忽略
          return [
            {
              ...s,
              receivedBatches: s.receivedBatches + 1,
              receivedRows: s.receivedRows + ev.msg.rows.length,
            },
            [{ f: 'apply', kind: ev.msg.kind, rows: ev.msg.rows }],
          ];
        }
        case 'done': {
          if (!s.peer) return [s, []];
          return maybeFinish({ ...s, gotDone: true, expectedRows: ev.msg.totalSent });
        }
        case 'ack': {
          if (!s.peer) return [s, []];
          return maybeFinish({ ...s, gotAck: true });
        }
        case 'bye': {
          // 對面正常收尾；我們若還沒完成=對面提早走（error），完成的話 reducer 已在終局態
          return [{ ...s, phase: 'error', error: 'peer-left' }, [{ f: 'leave' }]];
        }
      }
  }
}
