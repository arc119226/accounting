/**
 * App 殼：無 router——store 內 `screen` 字串切換 + `key={screen}` 重掛
 * 讓 `.screen` 的進場動畫（styles/base.css screenIn）每次換頁重播。
 * 底部四鈕（帳本/掃發票/統計/同步）+ 右上角設定；EntrySheet 是 overlay 不佔屏。
 */
import { lazy, Suspense } from 'react';
import { useAppStore, type Screen } from './store/appStore';
import { noteChunkLoadFailure } from './version';
import { AppToast } from './ui/AppToast';
import { LedgerScreen } from './ui/LedgerScreen';
import { EntrySheet } from './ui/EntrySheet';
import { CategoriesScreen } from './ui/CategoriesScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { StatsScreen } from './ui/StatsScreen';
import { SyncScreen } from './ui/SyncScreen';
import { NameGate } from './ui/NameGate';
import { InkDefs } from './ui/charts/InkDefs';

// 掃描頁 lazy chunk：偵測引擎（含 1MB wasm 載點）只在首掃進入；
// 部署後舊分頁的 chunk 失蹤 → noteChunkLoadFailure 觸發更新 toast
const ScanScreen = lazy(() =>
  import('./ui/ScanScreen')
    .then((m) => ({ default: m.ScanScreen }))
    .catch((err: unknown) => {
      noteChunkLoadFailure();
      throw err;
    }),
);
import { APP, NAV } from './strings/ui';

const NAV_ITEMS: readonly { readonly key: Screen; readonly label: string; readonly glyph: string }[] = [
  { key: 'ledger', label: NAV.ledger, glyph: '帳' },
  { key: 'scan', label: NAV.scan, glyph: '掃' },
  { key: 'stats', label: NAV.stats, glyph: '統' },
  { key: 'sync', label: NAV.sync, glyph: '同' },
];

export function App() {
  const screen = useAppStore((s) => s.screen);
  const setScreen = useAppStore((s) => s.setScreen);
  const entryOpen = useAppStore((s) => s.entryDraft !== null);

  const title =
    screen === 'ledger' ? APP.name
    : screen === 'scan' ? NAV.scan
    : screen === 'stats' ? NAV.stats
    : screen === 'sync' ? NAV.sync
    : screen === 'categories' ? NAV.categories
    : NAV.settings;

  return (
    <div className="app-shell">
      {/* SVG 濾鏡定義：url(#ink-bleed) 全站可引（帳本預算刷與統計圖表共用） */}
      <InkDefs />
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
        {screen === 'ledger' ? <LedgerScreen />
          : screen === 'stats' ? <StatsScreen />
          : screen === 'scan' ? (
            <Suspense fallback={<div className="screen-body"><span className="spinner" /></div>}>
              <ScanScreen />
            </Suspense>
          )
          : screen === 'sync' ? <SyncScreen />
          : screen === 'categories' ? <CategoriesScreen />
          : <SettingsScreen />}
      </div>
      <nav className="bottom-nav">
        {NAV_ITEMS.map((it) => (
          <button
            key={it.key}
            className={`nav-btn${screen === it.key ? ' active' : ''}`}
            aria-current={screen === it.key ? 'page' : undefined}
            onClick={() => setScreen(it.key)}
          >
            <span className="nav-glyph">{it.glyph}</span>
            <span className="nav-label">{it.label}</span>
          </button>
        ))}
      </nav>
      {/* key 以 editingId 為準（EntrySheet 的本地 state 只在 mount 時以 draft 種值），
          所以新增模式的 draft 一律共用 'new'——這是刻意的：連續記帳靠「entryDraft 始終非 null」
          讓抽屜不重掛（重掛會播一次上滑動畫、也會捲回頂端）。代價是本地欄位得由
          EntrySheet 自己清。另注意這裡是 render 期間的**未訂閱** getState() 讀取，
          只有 entryOpen 翻轉時才會重算。 */}
      {entryOpen && <EntrySheet key={String(useAppStore.getState().entryDraft?.editingId ?? 'new')} />}
      {/* 首啟取名卡（hydrated 且未取名時蓋全屏） */}
      <NameGate />
      <AppToast />
    </div>
  );
}
