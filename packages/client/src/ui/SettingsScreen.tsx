/**
 * 設定：我的稱呼 / 每月預算 / 分類管理入口 / 同步中繼站 / 儲存空間狀態 / 診斷 / 版本。
 */
import { useEffect, useState } from 'react';
import { parseAmountInput, sortCategories } from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { getPersonId } from '../ids';
import { getStorageInfo, type StorageInfo } from '../db/persist';
import { readErrLog } from '../errlog';
import { APP_VERSION } from '../version';
import { show } from '../notice';
import { applyTheme } from '../theme';
import type { ThemePref } from '../settings';
import { BUDGET, NAV, SETTINGS } from '../strings/ui';
import { ANCHOR, refreshRelays, relayStatus } from '../sync/relays';

function BudgetCard() {
  const budget = useAppStore((s) => s.budget);
  const categories = useAppStore((s) => s.categories);
  const setBudget = useAppStore((s) => s.setBudget);
  // 輸入框存原始字串（可清空重打），儲存時 parse 夾值
  const [total, setTotal] = useState(String(budget?.monthlyTotal ?? 0));
  const [perCat, setPerCat] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(budget?.perCategory ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const cats = sortCategories(categories.values());
  return (
    <div className="paper-card">
      <div className="field-label">{BUDGET.title}</div>
      <div className="budget-input-row">
        <span className="cat-name">{BUDGET.totalLabel}</span>
        <input
          className="text-input tnum"
          inputMode="numeric"
          value={total}
          onChange={(e) => setTotal(e.target.value)}
        />
      </div>
      <div className="field-label">
        {BUDGET.perCatLabel}（{BUDGET.zeroHint}）
      </div>
      {cats.map((c) => (
        <div key={c.id} className="budget-input-row">
          <span className="cat-name">{c.name}</span>
          <input
            className="text-input tnum"
            inputMode="numeric"
            value={perCat[c.id] ?? ''}
            placeholder="0"
            onChange={(e) => setPerCat((m) => ({ ...m, [c.id]: e.target.value }))}
          />
        </div>
      ))}
      <button
        className="primary-btn"
        onClick={() => {
          const cleaned: Record<string, number> = {};
          for (const [k, v] of Object.entries(perCat)) {
            const n = parseAmountInput(v);
            if (n && n > 0) cleaned[k] = n;
          }
          setBudget(parseAmountInput(total) ?? 0, cleaned);
          show('saved', BUDGET.savedToast);
        }}
      >
        {BUDGET.save}
      </button>
    </div>
  );
}

/** DEV 專用：三個月示範資料（統計圖表目視驗證用） */
function DevSeedButton() {
  const hydrate = useAppStore((s) => s.hydrate);
  if (!import.meta.env.DEV) return null;
  return (
    <button
      className="ghost-btn"
      onClick={() => {
        void (async () => {
          const repo = await import('../db/repo');
          const { tickClock } = await import('../clock');
          const { getDeviceId, getPersonId: myPid, uuidv7 } = await import('../ids');
          const cats = ['cat-food', 'cat-transport', 'cat-home', 'cat-fun', 'cat-med', 'cat-misc'];
          const notes = ['早餐', '午餐', '晚餐', '捷運', '加油', '日用品', '電影', '藥局', ''];
          const now = new Date();
          // 示範第二人：驗證【全家/每人】頁籤與拔河圖用
          const demoPersonId = 'demo-person-0001';
          await repo.putPerson({
            id: demoPersonId,
            updatedAt: tickClock(),
            deviceId: getDeviceId(),
            deleted: false,
            name: '示範',
          });
          const people = [myPid(), demoPersonId];
          for (let m = 0; m < 3; m++) {
            const y = now.getFullYear();
            const mo = now.getMonth() - m;
            const d0 = new Date(y, mo, 1);
            const days = new Date(y, mo + 1, 0).getDate();
            const n = 18 + Math.floor(Math.random() * 10);
            for (let i = 0; i < n; i++) {
              const day = 1 + Math.floor(Math.random() * (m === 0 ? Math.min(days, now.getDate()) : days));
              const date = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              await repo.putRecord({
                id: uuidv7(),
                updatedAt: tickClock(),
                deviceId: getDeviceId(),
                deleted: false,
                amount: 30 + Math.floor(Math.random() * 900),
                date,
                categoryId: cats[Math.floor(Math.random() * cats.length)]!,
                note: notes[Math.floor(Math.random() * notes.length)]!,
                paidBy: people[Math.random() < 0.55 ? 0 : 1]!,
                source: 'manual',
              });
            }
          }
          await hydrate();
        })();
      }}
    >
      [DEV] 產生示範資料
    </button>
  );
}

function fmtBytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(0)} KB`;
  return `${n} B`;
}

/** iOS 沒有 beforeinstallprompt：Safari 分頁模式下給中文安裝教學
 *  （安裝到主畫面=獨立儲存計數器，比分頁的 7 天回收安全得多） */
function IosInstallHint() {
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (!isIos || standalone) return null;
  return (
    <div className="paper-card">
      <div className="field-label">{SETTINGS.iosInstallTitle}</div>
      <p className="dim-text storage-line">{SETTINGS.iosInstallBody}</p>
    </div>
  );
}

/** 我的稱呼：本地打字、失焦/Enter 才 commit（每鍵 commit 會灌爆 HLC 與同步噪音） */
function MyNameCard() {
  const persons = useAppStore((s) => s.persons);
  const renameMyPerson = useAppStore((s) => s.renameMyPerson);
  const current = persons.get(getPersonId())?.name ?? '我';
  const [draft, setDraft] = useState(current);
  return (
    <div className="paper-card">
      <label className="field-label">{SETTINGS.myNameLabel}</label>
      <input
        className="text-input"
        value={draft}
        maxLength={8}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => renameMyPerson(draft || current)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

/** 主題三段切換。本機設定、不同步——一個人想用夜墨另一個想用宣紙是完全正常的。 */
function ThemeCard() {
  const theme = useAppStore((s) => s.settings.theme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const pick = (t: ThemePref): void => {
    updateSettings({ theme: t });
    applyTheme(t); // 立刻生效：主題是「按了就要看見」的設定，不該等下次開 app
  };
  return (
    <div className="paper-card">
      <div className="field-label">{SETTINGS.themeTitle}</div>
      <div className="seg">
        {(['system', 'paper', 'ink'] as const).map((t) => (
          <button
            key={t}
            className={`seg-btn${theme === t ? ' active' : ''}`}
            aria-pressed={theme === t}
            onClick={() => pick(t)}
          >
            {SETTINGS.themeOptions[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * 同步用的中繼站。
 *
 * 為什麼要讓使用者看得到:這台 app 的核心宣稱是「沒有伺服器、帳不離開你的裝置」,
 * 而 signaling 是這句話唯一的例外 —— 那幾秒鐘確實有第三方看得到你的 IP 與連線時間
 * (看不到帳)。既然開源的理由是「那句話可以被驗證」,清單就不該只活在原始碼裡。
 *
 * 更新是**手動一顆鈕 + 啟動時自動一次**,不跳通知:清單是管線,使用者沒有依據可以
 * 說不;而且錨點保證兩機必定相遇,清單不一樣也不會出事。
 */
function RelayCard() {
  const [status, setStatus] = useState(() => relayStatus());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const refresh = (): void => {
    setBusy(true);
    setResult(null);
    void refreshRelays(Date.now()).then((changed) => {
      setStatus(relayStatus());
      setBusy(false);
      setResult(changed ? SETTINGS.relayChanged : SETTINGS.relayUnchanged);
      setTimeout(() => setResult(null), 3000);
    });
  };

  return (
    <div className="paper-card">
      <div className="field-label">{SETTINGS.relayTitle}</div>
      <p className="dim-text">{SETTINGS.relayBody}</p>
      <ul className="relay-list">
        {status.urls.map((u) => (
          <li key={u}>
            <span className="relay-host">{u.replace(/^wss:\/\//, '')}</span>
            {u === ANCHOR && <span className="relay-tag">{SETTINGS.relayAnchorTag}</span>}
          </li>
        ))}
      </ul>
      <p className="dim-text">
        {status.updatedAt === 0
          ? SETTINGS.relayNever
          : SETTINGS.relayUpdatedPrefix + new Date(status.updatedAt).toLocaleDateString('zh-Hant')}
      </p>
      <button className="ghost-btn" onClick={refresh} disabled={busy}>
        {busy ? SETTINGS.relayRefreshing : (result ?? SETTINGS.relayRefresh)}
      </button>
    </div>
  );
}

export function SettingsScreen() {
  const setScreen = useAppStore((s) => s.setScreen);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getStorageInfo().then(setStorage);
  }, []);

  return (
    <div className="screen-body">
      <MyNameCard />

      <ThemeCard />

      <BudgetCard />

      <IosInstallHint />

      <div className="paper-card">
        <button className="ghost-btn" onClick={() => setScreen('categories')}>
          {NAV.categories} ›
        </button>
      </div>

      <RelayCard />

      <div className="paper-card">
        <div className="field-label">{SETTINGS.storageTitle}</div>
        {storage && (
          <p className="dim-text storage-line">
            {storage.persisted ? SETTINGS.persisted : SETTINGS.notPersisted}
            <br />
            <span className="tnum">
              {fmtBytes(storage.usageBytes)} / {fmtBytes(storage.quotaBytes)}
            </span>
          </p>
        )}
        <button
          className="ghost-btn"
          onClick={() => {
            const diag = JSON.stringify({ v: APP_VERSION, errors: readErrLog() }, null, 2);
            void navigator.clipboard?.writeText(diag).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? SETTINGS.diagCopied : SETTINGS.diagCopy}
        </button>
        <p className="dim-text version-line">
          {SETTINGS.versionPrefix}
          {APP_VERSION}
        </p>
        <DevSeedButton />
      </div>
    </div>
  );
}
