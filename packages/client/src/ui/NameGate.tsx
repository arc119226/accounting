/**
 * 取名卡（v2 首啟一次）：宣紙小卡請使用者取自己的稱呼。
 * 名字寫進「我的」Person row（同步實體）；named 旗標存本機 settings。
 * 可直接按「開始記帳」用預設「我」——不擋人，之後設定頁隨時改。
 */
import { useId, useRef, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { getPersonId } from '../ids';
import { NAMECARD } from '../strings/ui';
import { useDialog } from './useDialog';

export function NameGate() {
  const hydrated = useAppStore((s) => s.hydrated);
  const named = useAppStore((s) => s.settings.named);
  const persons = useAppStore((s) => s.persons);
  const renameMyPerson = useAppStore((s) => s.renameMyPerson);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [name, setName] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // 這張卡刻意不可跳過（沒有 onClose），但正因為不可跳過，Tab 邊界更要有——
  // 否則從輸入框 Tab 兩下就跑進背後那整個被 scrim 蓋住、按了也看不到效果的 app
  useDialog(cardRef, { onClose: undefined });

  if (!hydrated || named) return null;
  const current = persons.get(getPersonId())?.name ?? NAMECARD.placeholder;

  return (
    <div className="modal-overlay name-gate">
      <div className="modal-card" ref={cardRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h3 className="modal-title" id={titleId}>
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
