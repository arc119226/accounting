import { useEffect } from 'react';
import { CONFIRM } from '../strings/ui';

/** 輕量確認框（移植自 sr2）：Esc / 點背景 = 取消 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body?: string | undefined;
  confirmLabel: string;
  danger?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        {body && <p className="modal-body">{body}</p>}
        <div className="modal-actions">
          <button className={danger ? 'danger-btn' : 'primary-btn'} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="ghost-btn" onClick={onCancel}>{CONFIRM.cancel}</button>
        </div>
      </div>
    </div>
  );
}
