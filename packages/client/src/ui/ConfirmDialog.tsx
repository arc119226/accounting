import { useId, useRef } from 'react';
import { CONFIRM } from '../strings/ui';
import { useDialog } from './useDialog';

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
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Esc/焦點移入/Tab 環繞/關閉歸還都在這裡（原本只有 Esc）
  useDialog(cardRef, { onClose: onCancel });

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-card"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title" id={titleId}>{title}</h3>
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
