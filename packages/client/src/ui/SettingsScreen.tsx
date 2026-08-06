/**
 * 設定：我是誰 / 兩人稱呼 / 分類管理入口 / 儲存空間狀態 / 診斷 / 版本。
 */
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getStorageInfo, type StorageInfo } from '../db/persist';
import { readErrLog } from '../errlog';
import { APP_VERSION } from '../version';
import { NAV, SETTINGS } from '../strings/ui';

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
      </div>
    </div>
  );
}
