/**
 * 同步 slice：P2P 會話生命週期 + 檔案匯出/匯入。
 * 兩條路徑共用 sync/applyCore.decideIncoming（全 app 唯一合併決策）與同一張摘要卡。
 *
 * 套用的原子性（審查修正 #10/#13）：決策在 zustand 函式型 set 回呼內**同步**完成
 * （讀現值→裁決→換 Map 同一 task，使用者並發寫入無縫隙可插），落盤排在 set 之後
 * await——失敗 throw 給呼叫端走 apply-failed（協定不完成、checkpoint 不存、下次重送）。
 */
import type { StateCreator } from 'zustand';
import type { Budget, Syncable } from '@zhangben/core';
import type { AppStore } from './appStore';
import * as repo from '../db/repo';
import { recvClock, tickClock } from '../clock';
import { getDeviceId, getPersonId } from '../ids';
import { decideIncoming, type ApplyDecision } from '../sync/applyCore';
import type { SyncHandle } from '../sync/trystero';
import type { PeerHello, SyncKind, SyncSession, SyncTotals } from '../sync/protocol';
import { buildExport, downloadExport, parseImport } from '../sync/exportFile';
import { logError } from '../errlog';
import { show } from '../notice';

const EMPTY_TOTALS: SyncTotals = { added: 0, updated: 0, skipped: 0, deletes: 0, deduped: 0 };

export interface SyncSlice {
  peers: readonly repo.PeerInfo[];
  syncSession: SyncSession | null;
  syncRole: 'host' | 'join' | null;
  roomCode: string | null;
  /** 兩機物理鐘差（ms）；>10 分鐘 UI 出警示橫幅 */
  clockDriftMs: number | null;
  /** 檔案匯入的結果摘要（與 P2P 共用同一張卡） */
  importSummary: SyncTotals | null;
  importFailed: boolean;
  loadPeers(): Promise<void>;
  hostSync(): void;
  joinSync(code: string): void;
  cancelSync(): void;
  exportLedger(): void;
  importLedger(file: File): Promise<void>;
}

let handle: SyncHandle | null = null;
/** 世代 token（審查修正 #11）：動態 import 的 await 窗內雙擊/取消不會生出殭屍會話 */
let syncGen = 0;

export const createSyncSlice: StateCreator<AppStore, [], [], SyncSlice> = (set, get) => {
  /** 套用一批：同步裁決 + set，之後落盤（throw 由呼叫端接手）+ 水位回撥 */
  async function applyBatch(kind: SyncKind, rows: readonly Syncable[]) {
    let out: ApplyDecision<Syncable>;
    if (kind === 'records') {
      set((cur) => {
        const d = decideIncoming(cur.records, rows as never, {
          updatedAt: tickClock(),
          deviceId: getDeviceId(),
        });
        out = d as ApplyDecision<Syncable>;
        return { records: new Map(d.next) };
      });
    } else if (kind === 'categories') {
      set((cur) => {
        const d = decideIncoming(cur.categories, rows as never, null);
        out = d as ApplyDecision<Syncable>;
        return { categories: new Map(d.next) };
      });
    } else if (kind === 'rules') {
      set((cur) => {
        const d = decideIncoming(cur.rules, rows as never, null);
        out = d as ApplyDecision<Syncable>;
        return { rules: new Map(d.next) };
      });
    } else if (kind === 'persons') {
      set((cur) => {
        const d = decideIncoming(cur.persons, rows as never, null);
        out = d as ApplyDecision<Syncable>;
        return { persons: new Map(d.next) };
      });
    } else {
      set((cur) => {
        const local = new Map<string, Budget>(cur.budget ? [['budget', cur.budget]] : []);
        const d = decideIncoming(local, rows as never, null);
        out = d as ApplyDecision<Syncable>;
        return { budget: (d.next as ReadonlyMap<string, Budget>).get('budget') ?? null };
      });
    }
    const decision = out!;
    // 落盤（失敗 throw → 呼叫端 apply-failed；記憶體先行是刻意的：下次同步/hydrate 收斂）
    const storeName: repo.StoreName = kind === 'budget' ? 'singletons' : kind;
    await repo.persistRows(storeName, decision.changed);
    // 水位回撥：合入了早於既存 checkpoint 的列（舊備份/三裝置轉手）時，
    // 不回撥的話這些列永遠不會轉送給其他 peer
    if (decision.minTaken !== '') {
      void repo
        .lowerPeerCheckpoints(decision.minTaken)
        .then((peers) => set({ peers }))
        .catch((err: unknown) => logError(`lowerPeerCheckpoints: ${String(err)}`));
    }
    return { summary: decision.summary, deduped: decision.deduped };
  }

  function myHello(): PeerHello {
    const s = get();
    const myId = getPersonId();
    return {
      deviceId: getDeviceId(),
      personId: myId,
      personName: s.persons.get(myId)?.name ?? '我',
      // tick 而非 peek：hello 本身就是事件。從未寫過帳的全新裝置 peek 會是 HLC 零值，
      // checkpoint = min(雙方) 就被拖成 0 ⇒ 下次同步永遠全量重送
      hlcNow: tickClock(),
      wallMs: Date.now(),
      // 接收端決定 since：把「我記到各 peer」的 checkpoint 表給對方——
      // 我方 IDB 重灌時此表為空，對方自動退全量重送
      checkpoints: Object.fromEntries(s.peers.map((p) => [p.peerDeviceId, p.lastSyncedAt])),
    };
  }

  async function begin(role: 'host' | 'join', code: string): Promise<void> {
    const gen = ++syncGen;
    handle?.cancel();
    handle = null;
    set({ syncRole: role, roomCode: code, importSummary: null, importFailed: false, clockDriftMs: null });
    // trystero（+WebRTC 週邊）只在真的要同步時載入——省主 bundle 一大截
    let startSync: typeof import('../sync/trystero').startSync;
    try {
      ({ startSync } = await import('../sync/trystero'));
    } catch (err) {
      // 新版部署後的舊分頁：chunk 已被清掉=404。不接住的話同步無聲死掉。
      logError(`sync chunk: ${String(err)}`);
      const { noteChunkLoadFailure } = await import('../version');
      noteChunkLoadFailure();
      set({ syncRole: null, roomCode: null });
      return;
    }
    // await 窗內被新 begin/cancel 取代 ⇒ 不啟動（殭屍會話杜絕於未生）
    if (gen !== syncGen) return;
    handle = startSync(code, myHello(), {
      getLocalRows(kind) {
        const s = get();
        if (kind === 'persons') return [...s.persons.values()];
        if (kind === 'records') return [...s.records.values()];
        if (kind === 'categories') return [...s.categories.values()];
        if (kind === 'rules') return [...s.rules.values()];
        return s.budget ? [s.budget] : [];
      },
      applyBatch,
      onPeerHello(peer) {
        // v2：名字不在 hello 採納——人物 row 走 persons 同步實體、只有本人會編輯
        recvClock(peer.hlcNow);
        set({ clockDriftMs: Math.abs(Date.now() - peer.wallMs) });
      },
      saveCheckpoint(peer, checkpoint) {
        void repo
          .savePeer({
            peerDeviceId: peer.deviceId,
            peerPersonId: peer.personId,
            label: peer.personName || peer.deviceId,
            lastSyncedAt: checkpoint,
            lastSyncWallMs: Date.now(),
          })
          .then((peers) => set({ peers }))
          .catch((err: unknown) => logError(`savePeer: ${String(err)}`));
      },
      onState(session) {
        set({ syncSession: session });
      },
    });
  }

  return {
    peers: [],
    syncSession: null,
    syncRole: null,
    roomCode: null,
    clockDriftMs: null,
    importSummary: null,
    importFailed: false,

    async loadPeers() {
      try {
        set({ peers: await repo.loadPeers() });
      } catch (err) {
        logError(`loadPeers: ${String(err)}`);
      }
    },

    hostSync() {
      // 房間碼字集去 0/O/1/I/L（與 trystero.ts 的 CODE_ALPHABET 同源；
      // inline 產碼避免為了一個常數載入整個 trystero chunk）
      const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
      const buf = new Uint32Array(6);
      crypto.getRandomValues(buf);
      const code = [...buf].map((n) => alphabet[n % alphabet.length]!).join('');
      void begin('host', code);
    },

    joinSync(code) {
      const clean = code.trim().toUpperCase();
      if (clean.length !== 6) return;
      void begin('join', clean);
    },

    cancelSync() {
      syncGen += 1; // 在途 begin 作廢
      handle?.cancel();
      handle = null;
      set({ syncSession: null, syncRole: null, roomCode: null });
    },

    exportLedger() {
      const s = get();
      downloadExport(
        buildExport({
          deviceId: getDeviceId(),
          records: s.records.values(),
          categories: s.categories.values(),
          rules: s.rules.values(),
          persons: s.persons.values(),
          budget: s.budget,
        }),
      );
      s.updateSettings({ lastExportMs: Date.now() });
    },

    async importLedger(file) {
      set({ importSummary: null, importFailed: false });
      const parsed = parseImport(await file.text());
      if (!parsed.ok) {
        set({ importFailed: true });
        return;
      }
      const env = parsed.env;
      // 吸收匯入資料的最大 HLC（與 P2P 的 onPeerHello recvClock 對稱）：
      // 不吸收的話，匯入後的本機編輯 HLC 可能小於匯入列 ⇒ 下次同步被無聲還原
      let maxHlc = '';
      for (const r of [...env.persons, ...env.records, ...env.categories, ...env.rules, ...(env.budget ? [env.budget] : [])]) {
        if (r.updatedAt > maxHlc) maxHlc = r.updatedAt;
      }
      if (maxHlc) recvClock(maxHlc); // recvClock 對非正準字串安全忽略（parseImport 已驗 HLC 形）
      const totals = { ...EMPTY_TOTALS };
      const batches: readonly [SyncKind, readonly Syncable[]][] = [
        ['persons', env.persons],
        ['records', env.records],
        ['categories', env.categories],
        ['rules', env.rules],
        ['budget', env.budget ? [env.budget] : []],
      ];
      try {
        for (const [kind, rows] of batches) {
          if (rows.length === 0) continue;
          const r = await applyBatch(kind, rows);
          totals.added += r.summary.added;
          totals.updated += r.summary.updated;
          totals.skipped += r.summary.skipped;
          totals.deletes += r.summary.deletes;
          totals.deduped += r.deduped;
        }
        set({ importSummary: totals });
      } catch (err) {
        logError(`import: ${String(err)}`);
        set({ importFailed: true });
        show('saveFailed');
      }
    },
  };
};
