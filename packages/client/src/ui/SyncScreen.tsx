/**
 * 同步頁：面對面同步（主持=QR+房間碼 / 加入=輸碼）與檔案備份兩張紙卡，
 * 加 peers 清單（上次同步老化指標）。摘要卡是合併結果唯一外顯。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { QrCode } from './QrCode';
import { ConfirmDialog } from './ConfirmDialog';
import { useQrScan, type QrPhase } from './useQrScan';
import { buildSyncLink, parseSyncLink } from '../sync/deepLink';
import { SYNC } from '../strings/ui';
import { show } from '../notice';
import type { SyncTotals } from '../sync/protocol';

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60 * 60 * 1000) return SYNC.justNow;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}${SYNC.hoursAgo}`;
  return `${Math.floor(diff / (24 * 60 * 60 * 1000))}${SYNC.daysAgo}`;
}

function SummaryCard({ totals, onClose }: { totals: SyncTotals; onClose: () => void }) {
  return (
    <div className="paper-card sync-summary">
      <div className="scroll-banner">{SYNC.doneTitle}</div>
      <div className="summary-grid tnum">
        <span>{SYNC.summaryAdded}</span><b>{totals.added}{SYNC.unit}</b>
        <span>{SYNC.summaryUpdated}</span><b>{totals.updated}{SYNC.unit}</b>
        <span>{SYNC.summaryDeletes}</span><b>{totals.deletes}{SYNC.unit}</b>
        <span>{SYNC.summarySkipped}</span><b>{totals.skipped}{SYNC.unit}</b>
        {totals.deduped > 0 && (
          <>
            <span className="over-red">{SYNC.summaryDeduped}</span>
            <b className="over-red">{totals.deduped}{SYNC.unit}</b>
          </>
        )}
        {/* 丟掉的列一定要說：靜默丟資料就是這一輪在修的病，自己不能犯 */}
        {totals.rejected > 0 && (
          <>
            <span className="over-red">{SYNC.summaryRejected}</span>
            <b className="over-red">{totals.rejected}{SYNC.unit}</b>
          </>
        )}
      </div>
      <button className="ghost-btn" onClick={onClose}>{SYNC.close}</button>
    </div>
  );
}

/** App 內掃配對碼：沿用掃發票的相機與辨識引擎（detector 在點擊時才動態載入） */
function JoinScanner({ onCode, onCancel }: { onCode: (code: string) => void; onCancel: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<QrPhase>('engine');
  const doneRef = useRef(false);

  const onCodes = useCallback(
    (texts: readonly string[]) => {
      if (doneRef.current) return;
      for (const t of texts) {
        const code = parseSyncLink(t);
        if (code) {
          doneRef.current = true; // 只收第一張：後面的幀還會進來
          onCode(code);
          return;
        }
      }
    },
    [onCode],
  );
  useQrScan({ enabled: true, videoRef, onCodes, onPhase: setPhase });

  // 提示條與取消鈕都在取景器**外面**、走正常流（沿用既有的 .sync-live：
  // column flex + 置中 + gap）。原本兩者都是取景器內的絕對定位、都沒有 z-index，
  // 而取消鈕在 DOM 中排後面 ⇒ 直接畫在提示上，denied 那句的「房間碼」剛好被蓋掉。
  return (
    <div className="sync-live">
      <div className="scan-viewport join-viewport">
        <video ref={videoRef} className="scan-video" muted playsInline />
      </div>
      <p className={`scan-hint${phase === 'denied' ? ' denied' : ''}`}>
        {phase === 'denied' ? SYNC.scanDenied : phase === 'camera' ? SYNC.scanHint : SYNC.scanStarting}
      </p>
      <button className="ghost-btn" onClick={onCancel}>
        {SYNC.cancel}
      </button>
    </div>
  );
}

export function SyncScreen() {
  const session = useAppStore((s) => s.syncSession);
  const role = useAppStore((s) => s.syncRole);
  const roomCode = useAppStore((s) => s.roomCode);
  const clockDriftMs = useAppStore((s) => s.clockDriftMs);
  const peers = useAppStore((s) => s.peers);
  const persons = useAppStore((s) => s.persons);
  const importSummary = useAppStore((s) => s.importSummary);
  const importFailed = useAppStore((s) => s.importFailed);
  const hostSync = useAppStore((s) => s.hostSync);
  const joinSync = useAppStore((s) => s.joinSync);
  const cancelSync = useAppStore((s) => s.cancelSync);
  const exportLedger = useAppStore((s) => s.exportLedger);
  const importLedger = useAppStore((s) => s.importLedger);
  const hydrated = useAppStore((s) => s.hydrated);
  const hydrateFailed = useAppStore((s) => s.hydrateFailed);
  const pendingJoin = useAppStore((s) => s.pendingJoin);
  const clearPendingJoin = useAppStore((s) => s.clearPendingJoin);

  const records = useAppStore((s) => s.records);

  const [joinMode, setJoinMode] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  /** deep link 打進來、但這個瀏覽器沒有帳本——先問清楚再決定要不要入房 */
  const [emptyGate, setEmptyGate] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * deep link／掃碼帶進來的房間碼在這裡才真正入房，兩道關卡：
   *
   * 1. **一定要等 hydrated**：帳本還沒載完就握手會把增量水位推到頂，
   *    這台的帳從此不再傳給對方（見 syncSlice.begin 的閘）。
   * 2. **本機沒有任何活記錄就不自動入房**：iOS 用系統相機掃配對 QR 會在 Safari
   *    開一個全新分頁——不同儲存區、空帳本；在那裡同步只是把整本帳灌進一個
   *    用完即丟的殼，而且全程無聲。誠實說：全新安裝要還原備份的情境訊號完全一樣、
   *    無可靠判別，所以是「擋下並解釋」而不是「拒絕」，逃生口留著。
   */
  useEffect(() => {
    if (!hydrated || !pendingJoin) return;
    clearPendingJoin();
    // hydrate 失敗時 records 必為空，走下面的 emptyGate 會給出**錯誤的解釋**
    // （「這個瀏覽器沒有帳本」）。空是因為讀不到，不是因為沒有——卡片上的
    // hydrateFailed 說明已經在畫面上，這裡直接不入房就好。
    if (hydrateFailed) return;
    let hasLedger = false;
    for (const r of records.values()) {
      if (!r.deleted) { hasLedger = true; break; }
    }
    if (hasLedger) joinSync(pendingJoin);
    else setEmptyGate(pendingJoin);
  }, [hydrated, hydrateFailed, pendingJoin, clearPendingJoin, joinSync, records]);

  const active = session !== null && (session.phase === 'waiting' || session.phase === 'exchanging');
  const errText =
    session?.error === 'no-peer' ? SYNC.errNoPeer
    : session?.error === 'stalled' ? SYNC.errStalled
    : session?.error === 'peer-left' ? SYNC.errPeerLeft
    : session?.error === 'apply-failed' ? SYNC.errApplyFailed
    : null;

  return (
    <div className="screen-body">
      {/* 面對面同步 */}
      <div className="paper-card">
        <div className="sheet-title">
          <span className="seal-char">{SYNC.p2pTitle.slice(0, 1)}</span>
          {SYNC.p2pTitle.slice(1)}
        </div>

        {/* 讀不到本機帳本時**不給入口**：syncSlice.begin 那道閘會擋下來，但擋而不說
            就變成「按了沒反應」。兩顆鈕連同 joinMode 的後續畫面一起收起來。 */}
        {!session && hydrateFailed && <p className="sync-err over-red">{SYNC.hydrateFailed}</p>}

        {!session && !joinMode && !hydrateFailed && (
          <>
            <p className="dim-text">{SYNC.p2pDesc}</p>
            <div className="modal-actions">
              <button className="primary-btn" onClick={hostSync}>{SYNC.hostBtn}</button>
              <button className="ghost-btn" onClick={() => setJoinMode(true)}>{SYNC.joinBtn}</button>
            </div>
          </>
        )}

        {!session && joinMode && scanning && (
          <JoinScanner
            onCode={(code) => {
              setScanning(false);
              joinSync(code);
            }}
            onCancel={() => setScanning(false)}
          />
        )}

        {!session && joinMode && !scanning && (
          <>
            {/* 掃碼是主要路徑：App 內掃就不會掉進 iOS 系統相機開出來的 Safari 分身 */}
            <div className="modal-actions">
              <button className="primary-btn" onClick={() => setScanning(true)}>{SYNC.scanJoinBtn}</button>
            </div>
            <label className="field-label">{SYNC.codeLabel}</label>
            <input
              className="text-input room-code-input"
              value={codeInput}
              placeholder={SYNC.codePlaceholder}
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            />
            <div className="modal-actions">
              <button
                className="primary-btn"
                disabled={codeInput.trim().length !== 6}
                onClick={() => joinSync(codeInput)}
              >
                {SYNC.joinBtn}
              </button>
              <button className="ghost-btn" onClick={() => setJoinMode(false)}>{SYNC.cancel}</button>
            </div>
          </>
        )}

        {active && (
          <div className="sync-live">
            {role === 'host' && roomCode && session.phase === 'waiting' && (
              <>
                {/* payload 刻意**不是網址**：iOS 系統相機對網址會浮出「用 Safari 開啟」，
                    掃碼的人於是被丟進一個空帳本的分身分頁，在那裡同步等於把整本帳
                    灌進用完即丟的殼。非網址就沒有那顆按鈕——請對方用 App 內的掃碼加入。
                    六碼照樣印在下面，混版本期間永遠有手打這條路。 */}
                <QrCode text={buildSyncLink(roomCode)} />
                <div className="room-code">{roomCode}</div>
                <p className="dim-text sync-status">{SYNC.hostQrHint}</p>
              </>
            )}
            <p className="dim-text sync-status">
              {session.phase === 'waiting' ? SYNC.waiting : SYNC.exchanging}
              {session.phase === 'exchanging' && (
                <span className="tnum"> ↑{session.sent} ↓{session.appliedBatches}/{session.receivedBatches}</span>
              )}
            </p>
            {session.phase === 'waiting' && <span className="spinner" />}
            <button className="ghost-btn" onClick={cancelSync}>{SYNC.cancel}</button>
          </div>
        )}

        {session?.phase === 'error' && (
          <>
            <p className="dim-text sync-err">{errText}</p>
            <div className="modal-actions">
              <button className="primary-btn" onClick={role === 'host' ? hostSync : () => { cancelSync(); setJoinMode(true); }}>
                {SYNC.retry}
              </button>
              <button className="ghost-btn" onClick={cancelSync}>{SYNC.close}</button>
            </div>
          </>
        )}

        {clockDriftMs !== null && clockDriftMs > 10 * 60 * 1000 && (
          <p className="sync-err over-red">{SYNC.clockDriftWarn}</p>
        )}

        {session?.phase === 'done' && <SummaryCard totals={session.totals} onClose={cancelSync} />}

        {emptyGate !== null && (
          <ConfirmDialog
            title={SYNC.emptyGateTitle}
            body={SYNC.emptyGateBody}
            confirmLabel={SYNC.emptyGateForce}
            danger
            onConfirm={() => {
              const code = emptyGate;
              setEmptyGate(null);
              joinSync(code);
            }}
            onCancel={() => setEmptyGate(null)}
          />
        )}
      </div>

      {/* peers：名字優先取 persons row（即時反映對方改名），label 只是快照 fallback */}
      {peers.length > 0 && (
        <div className="paper-card">
          <div className="field-label">{SYNC.peersTitle}</div>
          {peers.map((p) => (
            <div key={p.peerDeviceId} className="cat-row">
              <span className="cat-name">{persons.get(p.peerPersonId)?.name ?? p.label}</span>
              <span className="dim-text">
                {SYNC.lastSync}
                {p.lastSyncWallMs > 0 ? relativeTime(p.lastSyncWallMs) : SYNC.never}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 檔案備份 */}
      <div className="paper-card">
        <div className="sheet-title">
          <span className="seal-char">{SYNC.fileTitle.slice(0, 1)}</span>
          {SYNC.fileTitle.slice(1)}
        </div>
        <p className="dim-text">{SYNC.fileDesc}</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importLedger(f);
            e.target.value = '';
          }}
        />
        <div className="modal-actions">
          {/* 不 await 再呼叫：navigator.share() 必須留在這個 click 的手勢任務內 */}
          <button
            className="primary-btn"
            onClick={() => {
              void exportLedger().then((outcome) => {
                if (outcome === 'cancelled') return; // 使用者自己取消的，不必回報
                show('saved', outcome === 'failed' ? SYNC.exportFailed : SYNC.exported);
              });
            }}
          >
            {SYNC.exportBtn}
          </button>
          <button className="ghost-btn" onClick={() => fileRef.current?.click()}>{SYNC.importBtn}</button>
        </div>
        {importFailed && <p className="sync-err over-red">{SYNC.importFailed}</p>}
        {importSummary && (
          <SummaryCard
            totals={importSummary}
            onClose={() => useAppStore.setState({ importSummary: null })}
          />
        )}
      </div>
    </div>
  );
}
