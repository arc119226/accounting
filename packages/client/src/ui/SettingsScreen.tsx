/**
 * 設定：我是誰 / 兩人稱呼 / 每月預算 / 分類管理入口 / 儲存空間狀態 / 診斷 / 版本。
 */
import { useEffect, useState } from 'react';
import { parseAmountInput, sortCategories } from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { getStorageInfo, type StorageInfo } from '../db/persist';
import { readErrLog } from '../errlog';
import { APP_VERSION } from '../version';
import { show } from '../notice';
import { BUDGET, NAV, SETTINGS } from '../strings/ui';

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
          const { getDeviceId, uuidv7 } = await import('../ids');
          const cats = ['cat-food', 'cat-transport', 'cat-home', 'cat-fun', 'cat-med', 'cat-misc'];
          const notes = ['早餐', '午餐', '晚餐', '捷運', '加油', '日用品', '電影', '藥局', ''];
          const now = new Date();
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
                paidBy: Math.random() < 0.55 ? 'A' : 'B',
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

export function SettingsScreen() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setScreen = useAppStore((s) => s.setScreen);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getStorageInfo().then(setStorage);
  }, []);

  return (
    <div className="screen-body">
      <div className="paper-card">
        <label className="field-label">{SETTINGS.whoAmI}</label>
        <div className="seg">
          {(['A', 'B'] as const).map((p) => (
            <button
              key={p}
              className={`seg-btn${settings.myPerson === p ? ' active' : ''}`}
              onClick={() => updateSettings({ myPerson: p })}
            >
              {settings.personNames[p]}
            </button>
          ))}
        </div>

        <label className="field-label">{SETTINGS.namesLabel}</label>
        {(['A', 'B'] as const).map((p) => (
          <input
            key={p}
            className="text-input"
            value={settings.personNames[p]}
            aria-label={p === 'A' ? SETTINGS.nameA : SETTINGS.nameB}
            maxLength={8}
            onChange={(e) =>
              updateSettings({ personNames: { ...settings.personNames, [p]: e.target.value } })
            }
          />
        ))}
      </div>

      <BudgetCard />

      <div className="paper-card">
        <button className="ghost-btn" onClick={() => setScreen('categories')}>
          {NAV.categories} ›
        </button>
      </div>

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
