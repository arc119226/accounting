/**
 * App 殼：無 router——store 內 `screen` 字串切換 + `key={screen}` 重掛
 * 讓 `.screen` 的進場動畫（styles/base.css screenIn）每次換頁重播。
 * 底部四鈕（帳本/掃發票/統計/同步）+ 右上角設定；各屏 M1–M4 陸續實作。
 */
import { useState } from 'react';
import { useAppStore, type Screen } from './store/appStore';
import { AppToast } from './ui/AppToast';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { APP, NAV, PLACEHOLDER } from './strings/ui';

function PlaceholderScreen({ title }: { title: string }) {
  // M0 佔位屏：驗證卷軸橫幅/印章/紙卡/按鈕/對話框樣式全鏈路
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="screen-body">
      <div className="scroll-banner">{title}</div>
      <div className="paper-card">
        <p className="dim-text">{PLACEHOLDER.wip}</p>
        <div className="modal-actions">
          <button className="primary-btn" onClick={() => setConfirmOpen(true)}>
            測試對話框
          </button>
        </div>
      </div>
      {confirmOpen && (
        <ConfirmDialog
          title="樣式驗證"
          body="宣紙對話框：點背景或 Esc 取消。"
          confirmLabel="好"
          onConfirm={() => setConfirmOpen(false)}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

const NAV_ITEMS: readonly { readonly key: Screen; readonly label: string; readonly glyph: string }[] = [
  { key: 'ledger', label: NAV.ledger, glyph: '帳' },
  { key: 'scan', label: NAV.scan, glyph: '掃' },
  { key: 'stats', label: NAV.stats, glyph: '統' },
  { key: 'sync', label: NAV.sync, glyph: '同' },
];

export function App() {
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);

  const title =
    screen === 'ledger' ? APP.name
    : screen === 'scan' ? NAV.scan
    : screen === 'stats' ? NAV.stats
    : screen === 'sync' ? NAV.sync
    : screen === 'categories' ? NAV.categories
    : NAV.settings;

  return (
    <div className="app-shell">
      <div key={screen} className="screen">
        <header className="app-top">
          <span className="app-title">
            <span className="seal-char">{title.slice(0, 1)}</span>
            {title.slice(1)}
          </span>
          <button
            className="corner-btn"
            aria-label={NAV.settings}
            onClick={() => setScreen('settings')}
          >
            <span className="corner-seal">設</span>
          </button>
        </header>
        <PlaceholderScreen title={title} />
      </div>
      <nav className="bottom-nav">
        {NAV_ITEMS.map((it) => (
          <button
            key={it.key}
            className={`nav-btn${screen === it.key ? ' active' : ''}`}
            onClick={() => setScreen(it.key)}
          >
            <span className="nav-glyph">{it.glyph}</span>
            <span className="nav-label">{it.label}</span>
          </button>
        ))}
      </nav>
      <AppToast />
    </div>
  );
}
