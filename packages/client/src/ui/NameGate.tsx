/**
 * 取名卡（v2 首啟一次）：宣紙小卡請使用者取自己的稱呼。
 * 名字寫進「我的」Person row（同步實體）；named 旗標存本機 settings。
 * 可直接按「開始記帳」用預設「我」——不擋人，之後設定頁隨時改。
 */
import { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getPersonId } from '../ids';
import { NAMECARD } from '../strings/ui';

export function NameGate() {
  const hydrated = useAppStore((s) => s.hydrated);
  const named = useAppStore((s) => s.settings.named);
  const persons = useAppStore((s) => s.persons);
  const renameMyPerson = useAppStore((s) => s.renameMyPerson);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [name, setName] = useState('');

  if (!hydrated || named) return null;
  const current = persons.get(getPersonId())?.name ?? NAMECARD.placeholder;

  return (
    <div className="modal-overlay name-gate">
      <div className="modal-card">
        <h3 className="modal-title">
          <span className="seal-char">{NAMECARD.title.slice(0, 1)}</span>
          {NAMECARD.title.slice(1)}
        </h3>
        <p className="modal-body">{NAMECARD.body}</p>
        <input
          className="text-input name-input"
          value={name}
          placeholder={current}
          maxLength={8}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              renameMyPerson(name || current);
              updateSettings({ named: true });
            }
          }}
        />
        <div className="modal-actions">
          <button
            className="primary-btn"
            onClick={() => {
              renameMyPerson(name || current);
              updateSettings({ named: true });
            }}
          >
            {NAMECARD.start}
          </button>
        </div>
      </div>
    </div>
  );
}
