/**
 * 同步頁：面對面同步（主持=QR+房間碼 / 加入=輸碼）與檔案備份兩張紙卡，
 * 加 peers 清單（上次同步老化指標）。摘要卡是合併結果唯一外顯。
 */
import { useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { QrCode } from './QrCode';
import { SYNC } from '../strings/ui';
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
      </div>
      <button className="ghost-btn" onClick={onClose}>{SYNC.close}</button>
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

  const [joinMode, setJoinMode] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

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

        {!session && !joinMode && (
          <>
            <p className="dim-text">{SYNC.p2pDesc}</p>
            <div className="modal-actions">
              <button className="primary-btn" onClick={hostSync}>{SYNC.hostBtn}</button>
              <button className="ghost-btn" onClick={() => setJoinMode(true)}>{SYNC.joinBtn}</button>
            </div>
          </>
        )}

        {!session && joinMode && (
          <>
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
                <QrCode text={`${location.origin}/#sync=${roomCode}`} />
                <div className="room-code brush-text">{roomCode}</div>
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
          <button className="primary-btn" onClick={exportLedger}>{SYNC.exportBtn}</button>
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
