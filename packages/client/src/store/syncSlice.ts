/**
 * 同步 slice：P2P 會話生命週期 + 檔案匯出/匯入。
 * 兩條路徑共用 sync/applyCore.decideIncoming（全 app 唯一合併決策）與同一張摘要卡。
 *
 * 套用的原子性（審查修正 #10/#13）：決策在 zustand 函式型 set 回呼內**同步**完成
 * （讀現值→裁決→換 Map 同一 task，使用者並發寫入無縫隙可插），落盤排在 set 之後
 * await——失敗 throw 給呼叫端走 apply-failed（協定不完成、checkpoint 不存、下次重送）。
 */
import type { StateCreator } from 'zustand';
import type { Budget, Category, ExpenseRecord, MerchantRule, Person, Syncable } from '@zhangben/core';
import type { AppStore } from './appStore';
import * as repo from '../db/repo';
import { recvClock, tickClock } from '../clock';
import { getDeviceId, getPersonId } from '../ids';
import { decideIncoming, type ApplyDecision } from '../sync/applyCore';
import type { SyncHandle } from '../sync/trystero';
import type { PeerHello, SyncKind, SyncSession, SyncTotals } from '../sync/protocol';
import { buildExport, parseImport, shareOrDownloadExport, type ExportOutcome } from '../sync/exportFile';
import { ROW_OK } from '../sync/rowSchema';
import { logError } from '../errlog';
import { show } from '../notice';

const EMPTY_TOTALS: SyncTotals = { added: 0, updated: 0, skipped: 0, deletes: 0, deduped: 0, rejected: 0 };
/** 匯入的切塊大小。與 trystero 的 BATCH_SIZE 同值，理由也同——單一交易的體積不該綁在帳本大小上 */
const IMPORT_CHUNK = 500;

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
  /** 匯入進度（null=沒在跑）。3 萬筆時那幾秒沒有回饋＝與「按了沒反應」不可區分 */
  importProgress: { readonly done: number; readonly total: number } | null;
  /**
   * deep link／掃碼帶進來、**尚未執行**的房間碼。
   * 開機當下不入房：hydrate 是 async（帳本還沒載完），而且空帳本也可能是
   * iOS 系統相機開出來的 Safari 分身——入不入房的決策交給 SyncScreen。
   */
  pendingJoin: string | null;
  loadPeers(): Promise<void>;
  hostSync(): void;
  joinSync(code: string): void;
  setPendingJoin(code: string): void;
  clearPendingJoin(): void;
  cancelSync(): void;
  /** 回傳去向讓畫面決定文案——store 不組顯示文字 */
  exportLedger(): Promise<ExportOutcome>;
  importLedger(file: File): Promise<void>;
}

let handle: SyncHandle | null = null;
/** 世代 token（審查修正 #11）：動態 import 的 await 窗內雙擊/取消不會生出殭屍會話 */
let syncGen = 0;

export const createSyncSlice: StateCreator<AppStore, [], [], SyncSlice> = (set, get) => {
  /** 套用一批：逐列驗證 → 同步裁決 + set → 落盤（throw 由呼叫端接手）+ 水位回撥 */
  async function applyBatch(kind: SyncKind, allRows: readonly Syncable[]) {
    // 逐列驗證（與檔案匯入同一份 rowSchema）。**丟掉壞列而不是整批失敗**：
    // 整批失敗＝不存 checkpoint＝下次重送同一批，若對方那列是持久性的壞資料
    // （舊版本、記憶體損壞），每天的同步就永久卡死——那比丟掉那列更糟。
    // 代價是被丟的列不會再重送，所以 rejected 一路帶到摘要卡上讓人看得見。
    const ok = ROW_OK[kind];
    const rows = allRows.filter((r) => ok(r));
    const rejected = allRows.length - rows.length;
    if (rejected > 0) logError(`sync rejected ${rejected} bad ${kind} row(s)`);
    let out: ApplyDecision<Syncable>;
    if (kind === 'records') {
      set((cur) => {
        const d = decideIncoming(cur.records, rows as never, {
          updatedAt: tickClock(),
          deviceId: getDeviceId(),
        });
        out = d as ApplyDecision<Syncable>;
        return { records: d.next as Map<string, ExpenseRecord> };
      });
    } else if (kind === 'categories') {
      set((cur) => {
        const d = decideIncoming(cur.categories, rows as never, null);
        out = d as ApplyDecision<Syncable>;
        return { categories: d.next as Map<string, Category> };
      });
    } else if (kind === 'rules') {
      set((cur) => {
        const d = decideIncoming(cur.rules, rows as never, null);
        out = d as ApplyDecision<Syncable>;
        return { rules: d.next as Map<string, MerchantRule> };
      });
    } else if (kind === 'persons') {
      set((cur) => {
        const d = decideIncoming(cur.persons, rows as never, null);
        out = d as ApplyDecision<Syncable>;
        return { persons: d.next as Map<string, Person> };
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
    return { summary: decision.summary, deduped: decision.deduped, rejected };
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
    // hydrate 沒完成就入房＝**以空帳本完成一次「成功」的握手**：這台送出 0 列，
    // 但雙方仍各自存下 checkpoint = min(雙方 hlcNow)，而 hlcNow 取自 tickClock()、
    // 值已 ≥ 自己每一列的 updatedAt ⇒ 下次對方帶著這個水位過來，changedSince 永遠算出空集合，
    // **這台的整本帳從此不再增量傳給對方**（靜默，且 lowerPeerCheckpoints 只在收進更舊的列時
    // 才回撥，救不到）。閘放在這裡＝涵蓋所有入口，不只 deep link 那一條。
    // hydrateFailed 一併擋：IDB 開不起來時記憶體同樣是空帳本，但 hydrated 為了讓
    // UI 渲染得出來仍是 true——只看 hydrated 的話這道閘等於形同虛設。
    if (!get().hydrated || get().hydrateFailed) return;
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
    importProgress: null,
    pendingJoin: null,

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

    setPendingJoin(code) {
      set({ pendingJoin: code });
    },

    clearPendingJoin() {
      set({ pendingJoin: null });
    },

    cancelSync() {
      syncGen += 1; // 在途 begin 作廢
      handle?.cancel();
      handle = null;
      set({ syncSession: null, syncRole: null, roomCode: null });
    },

    // 不加 async：async 會讓整個函式體排進 microtask，而 shareOrDownloadExport 內的
    // navigator.share() 必須留在 click 的手勢任務內，否則 Safari 丟 NotAllowedError
    exportLedger() {
      const s = get();
      return shareOrDownloadExport(
        buildExport({
          deviceId: getDeviceId(),
          records: s.records.values(),
          categories: s.categories.values(),
          rules: s.rules.values(),
          persons: s.persons.values(),
          budget: s.budget,
        }),
      ).then((outcome) => {
        // 取消/失敗都不推進備份時鐘——推了的話 BackupNag 會被靜默解除，
        // 使用者從此以為自己備份過了
        if (outcome === 'shared' || outcome === 'downloaded') {
          get().updateSettings({ lastExportMs: Date.now() });
        }
        return outcome;
      });
    },

    async importLedger(file) {
      set({ importSummary: null, importFailed: false });
      // file.text() **必須在 try 內**：iCloud Drive 上還沒下載完的備份會以
      // NotReadableError reject，而呼叫端是 void importLedger(f)——漏在外面的話
      // 是 unhandled rejection，加上第一行剛把兩個回饋旗標都清空，畫面上
      // 完全沒反應，使用者只會再按一次。
      let text: string;
      try {
        text = await file.text();
      } catch (err) {
        logError(`import read: ${String(err)}`);
        set({ importFailed: true });
        return;
      }
      const parsed = parseImport(text);
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
      const total = batches.reduce((n, [, rows]) => n + rows.length, 0);
      let done = 0;
      set({ importProgress: { done, total } });
      try {
        for (const [kind, rows] of batches) {
          if (rows.length === 0) continue;
          // **切塊**（審查修正）：P2P 有 BATCH_SIZE 切塊，匯入原本是整批一次餵——
          // repo.persistRows 於是在單一交易裡跑 3 萬次 put（行動端 1–4 秒完全鎖住），
          // 而畫面上什麼都沒有（importSummary/importFailed 開頭就被清空了），
          // 與「按了沒反應」不可區分。這是 app 最脆弱的時刻：使用者剛失去資料、正在救回來。
          for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
            const r = await applyBatch(kind, rows.slice(i, i + IMPORT_CHUNK));
            totals.added += r.summary.added;
            totals.updated += r.summary.updated;
            totals.skipped += r.summary.skipped;
            totals.deletes += r.summary.deletes;
            totals.deduped += r.deduped;
            totals.rejected += r.rejected; // parseImport 已整檔把關，這裡恆為 0——留著是為了兩條路共用同一張摘要卡
            done += Math.min(IMPORT_CHUNK, rows.length - i);
            set({ importProgress: { done, total } });
            // 讓一次事件迴圈：進度條才畫得出來，也讓使用者的觸控不被整段餓死
            await new Promise<void>((r2) => setTimeout(r2, 0));
          }
        }
        set({ importSummary: totals, importProgress: null });
      } catch (err) {
        logError(`import: ${String(err)}`);
        set({ importFailed: true, importProgress: null });
        show('saveFailed');
      }
    },
  };
};
