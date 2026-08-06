/**
 * 同步 slice：P2P 會話生命週期 + 檔案匯出/匯入。
 * 兩條路徑共用 repo.applyIncoming（全 app 唯一合併落盤實作）與同一張摘要卡。
 */
import type { StateCreator } from 'zustand';
import type { Budget, Syncable } from '@zhangben/core';
import type { AppStore } from './appStore';
import * as repo from '../db/repo';
import { recvClock, tickClock } from '../clock';
import { getDeviceId } from '../ids';
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

export const createSyncSlice: StateCreator<AppStore, [], [], SyncSlice> = (set, get) => {
  /** 套用一批對端資料到 store + IDB（P2P 批次與檔案匯入共用） */
  async function applyBatch(kind: SyncKind, rows: readonly Syncable[]) {
    const s = get();
    if (kind === 'records') {
      const r = await repo.applyIncoming('records', s.records, rows as never);
      set({ records: new Map(r.next) });
      return { summary: r.summary, deduped: r.deduped };
    }
    if (kind === 'categories') {
      const r = await repo.applyIncoming('categories', s.categories, rows as never);
      set({ categories: new Map(r.next) });
      return { summary: r.summary, deduped: r.deduped };
    }
    if (kind === 'rules') {
      const r = await repo.applyIncoming('rules', s.rules, rows as never);
      set({ rules: new Map(r.next) });
      return { summary: r.summary, deduped: r.deduped };
    }
    // budget 單例：包成單鍵 Map 走同一條 mergeAll 路徑
    const local = new Map<string, Budget>(s.budget ? [['budget', s.budget]] : []);
    const r = await repo.applyIncoming('singletons', local, rows as never);
    set({ budget: (r.next as ReadonlyMap<string, Budget>).get('budget') ?? null });
    return { summary: r.summary, deduped: r.deduped };
  }

  function myHello(): PeerHello {
    const s = get();
    return {
      deviceId: getDeviceId(),
      person: s.settings.myPerson,
      personNames: s.settings.personNames,
      // tick 而非 peek：hello 本身就是事件。從未寫過帳的全新裝置 peek 會是 HLC 零值，
      // checkpoint = min(雙方) 就被拖成 0 ⇒ 下次同步永遠全量重送
      hlcNow: tickClock(),
      wallMs: Date.now(),
    };
  }

  async function begin(role: 'host' | 'join', code: string): Promise<void> {
    handle?.cancel();
    set({ syncRole: role, roomCode: code, importSummary: null, importFailed: false, clockDriftMs: null });
    // trystero（+WebRTC 週邊）只在真的要同步時載入——省主 bundle 一大截
    const { startSync } = await import('../sync/trystero');
    handle = startSync(code, myHello(), {
      getLocalRows(kind) {
        const s = get();
        if (kind === 'records') return [...s.records.values()];
        if (kind === 'categories') return [...s.categories.values()];
        if (kind === 'rules') return [...s.rules.values()];
        return s.budget ? [s.budget] : [];
      },
      getSinceFor(peerDeviceId) {
        return get().peers.find((p) => p.peerDeviceId === peerDeviceId)?.lastSyncedAt ?? '';
      },
      applyBatch,
      onPeerHello(peer) {
        recvClock(peer.hlcNow);
        set({ clockDriftMs: Math.abs(Date.now() - peer.wallMs) });
        // 對方最清楚自己的稱呼：採納對方 person 槽位的名字（本機槽位不動）
        const s = get();
        const theirName = peer.personNames[peer.person];
        if (theirName && peer.person !== s.settings.myPerson && s.settings.personNames[peer.person] !== theirName) {
          s.updateSettings({ personNames: { ...s.settings.personNames, [peer.person]: theirName } });
        }
      },
      saveCheckpoint(peer, checkpoint) {
        void repo
          .savePeer({
            peerDeviceId: peer.deviceId,
            label: peer.personNames[peer.person] || peer.deviceId,
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
      // 房間碼字集去 0/O/1/I/L（與 trystero.ts 的 CODE_ALPHABET 同源常數在該檔；
      // 這裡 inline 產碼避免為了一個常數載入整個 trystero chunk）
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
      const totals = { ...EMPTY_TOTALS };
      const batches: readonly [SyncKind, readonly Syncable[]][] = [
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
