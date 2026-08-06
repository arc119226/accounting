/**
 * 記一筆底部抽屜（不換屏=保留帳本捲動位置）。
 * 金額走自製數字鍵盤（整數元；行動裝置系統鍵盤會蓋半屏又常彈小數）。
 * 重複防呆：同日同額同人 → ConfirmDialog 警告不硬擋。
 */
import { useState } from 'react';
import { formatNTD, sortCategories } from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { getPersonId } from '../ids';
import { sortPersonsForTabs } from '../personView';
import { findDuplicate, todayISO, type EntryValues } from '../store/ledgerSlice';
import { ConfirmDialog } from './ConfirmDialog';
import { ENTRY, SCAN } from '../strings/ui';
import { show } from '../notice';

const KEYPAD = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫'] as const;
const MAX_AMOUNT = 99_999_999;

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function EntrySheet() {
  const draft = useAppStore((s) => s.entryDraft);
  const categories = useAppStore((s) => s.categories);
  const persons = useAppStore((s) => s.persons);
  const closeEntry = useAppStore((s) => s.closeEntry);
  const saveEntry = useAppStore((s) => s.saveEntry);
  const deleteRecord = useAppStore((s) => s.deleteRecord);

  const [amount, setAmount] = useState(draft?.amount ?? null);
  const [date, setDate] = useState(draft?.date ?? todayISO());
  const [categoryId, setCategoryId] = useState(draft?.categoryId ?? 'cat-misc');
  const [note, setNote] = useState(draft?.note ?? '');
  const [merchantName, setMerchantName] = useState(draft?.merchantName ?? '');
  const [paidBy, setPaidBy] = useState<string>(draft?.paidBy ?? getPersonId());
  const [showDatePick, setShowDatePick] = useState(false);
  const [confirm, setConfirm] = useState<'none' | 'dup' | 'delete'>('none');
  // 編輯掃描來的記錄時把原列撈出來看發票號碼與品項（EntryDraft 只帶 7 個可編輯欄位）。
  // 窄 selector：記錄物件參考在該列沒變動時是穩定的，訂閱成本可忽略
  const record = useAppStore((s) => (draft?.editingId ? s.records.get(draft.editingId) : undefined));

  if (!draft) return null;
  const editing = draft.editingId !== null;
  const cats = sortCategories(categories.values());

  const tapKey = (k: (typeof KEYPAD)[number]) => {
    if (k === 'C') return setAmount(null);
    if (k === '⌫') return setAmount((a) => (a === null || a < 10 ? null : Math.floor(a / 10)));
    setAmount((a) => {
      const next = (a ?? 0) * 10 + Number(k);
      return next > MAX_AMOUNT ? a : next;
    });
  };

  const values = (): EntryValues => ({
    amount: amount ?? 0,
    date,
    categoryId,
    note: note.trim(),
    merchantName: merchantName.trim(),
    paidBy,
  });

  const doSave = () => {
    saveEntry(values());
    show('saved', `${editing ? ENTRY.savedEdit : ENTRY.savedNew}${formatNTD(amount ?? 0)}`);
  };

  const trySave = () => {
    const dup = findDuplicate(useAppStore.getState().records, values(), draft.editingId);
    if (dup) return setConfirm('dup');
    doSave();
  };

  const dupHint = (() => {
    const dup = findDuplicate(useAppStore.getState().records, values(), draft.editingId);
    if (!dup) return '';
    const cat = categories.get(dup.categoryId);
    return `${ENTRY.dupBodyPrefix}${dup.merchant?.name || dup.note || cat?.name || ''} ${formatNTD(dup.amount)}`;
  })();

  const title = editing ? ENTRY.titleEdit : ENTRY.titleNew;

  return (
    <div className="sheet-overlay" onClick={closeEntry}>
      <div className="entry-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          <span className="seal-char">{title.slice(0, 1)}</span>
          {title.slice(1)}
        </div>

        <div className="amount-display tnum">{amount === null ? '$0' : formatNTD(amount)}</div>

        {/* 日期獨立成整幅一列：擠在 .entry-grid 的 4fr 欄裡時三顆按鈕各只有 42px、
            內容盒 28px，而「選日期」三個字就要 42px ⇒ 必斷行。要不斷行得視窗 ≥451px，
            比現役最大的手機還寬（iPhone 16 Pro Max 是 440px）——這不是窄機 bug，是全中。
            滿寬後每顆 105px、內容盒 91px，放大系統字級也還有 2 倍餘裕。 */}
        <label className="field-label">{ENTRY.dateLabel}</label>
        <div className="seg">
          <button
            className={`seg-btn${date === todayISO() ? ' active' : ''}`}
            onClick={() => { setDate(todayISO()); setShowDatePick(false); }}
          >
            {ENTRY.today}
          </button>
          <button
            className={`seg-btn${date === yesterdayISO() ? ' active' : ''}`}
            onClick={() => { setDate(yesterdayISO()); setShowDatePick(false); }}
          >
            {ENTRY.yesterday}
          </button>
          <button
            className={`seg-btn${date !== todayISO() && date !== yesterdayISO() ? ' active' : ''}`}
            onClick={() => setShowDatePick(true)}
          >
            {showDatePick || (date !== todayISO() && date !== yesterdayISO()) ? date.slice(5).replace('-', '/') : ENTRY.pickDate}
          </button>
        </div>
        {showDatePick && (
          <input
            type="date"
            className="text-input"
            value={date}
            max={todayISO()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        )}

        <div className="entry-grid">
          <div className="keypad">
            {KEYPAD.map((k) => (
              <button key={k} className={`key-btn${/\d/.test(k) ? '' : ' key-fn'}`} onClick={() => tapKey(k)}>
                {k}
              </button>
            ))}
          </div>

          <div className="entry-fields">
            <label className="field-label">{ENTRY.paidByLabel}</label>
            <div className="seg">
              {sortPersonsForTabs(persons).map((p) => (
                <button key={p.id} className={`seg-btn${paidBy === p.id ? ' active' : ''}`} onClick={() => setPaidBy(p.id)}>
                  {p.name}
                </button>
              ))}
            </div>

            <label className="field-label">{ENTRY.noteLabel}</label>
            <input
              className="text-input"
              value={note}
              placeholder={ENTRY.notePlaceholder}
              maxLength={40}
              onChange={(e) => setNote(e.target.value)}
            />
            <label className="field-label">{ENTRY.merchantLabel}</label>
            <input
              className="text-input"
              value={merchantName}
              placeholder={ENTRY.merchantPlaceholder}
              maxLength={20}
              onChange={(e) => setMerchantName(e.target.value)}
            />
          </div>
        </div>

        <label className="field-label">{ENTRY.categoryLabel}</label>
        <div className="cat-scroller">
          {cats.map((c) => (
            <button
              key={c.id}
              className={`paper-label${categoryId === c.id ? ' active' : ''}`}
              onClick={() => setCategoryId(c.id)}
            >
              {c.glyph}
              {c.name}
            </button>
          ))}
        </div>

        {/* 掃描來的記錄：發票號碼與品項唯讀回看（一個月後看到 $437 想不起買了什麼就靠這個）。
            預設收合——抽屜已經到 88dvh 了。沿用 scan.css 的樣式（它排在 entry.css 之後，
            選擇器互不相干，零新 CSS）。
            注意 itemsComplete 只存在於 ParsedInvoice、沒落到 ExpenseRecord，
            所以這裡不能顯示「發票僅載部分品項」。 */}
        {(record?.invoice || (record?.items?.length ?? 0) > 0) && (
          <details className="scan-items">
            <summary className="field-label">{ENTRY.invoiceSection}</summary>
            {record?.invoice && (
              <p className="dim-text inv-no tnum">
                {SCAN.invNoLabel} {record.invoice.number}
              </p>
            )}
            {record?.items?.map((it, i) => (
              <div key={i} className="scan-item-row">
                <span className="entry-title">{it.name}</span>
                <span className="dim-text tnum">
                  {it.qty} × {it.unitPrice}
                </span>
              </div>
            ))}
          </details>
        )}

        <div className="modal-actions sheet-actions">
          {editing && (
            <button className="danger-btn" onClick={() => setConfirm('delete')}>
              {ENTRY.delete}
            </button>
          )}
          <button className="primary-btn save-btn" disabled={!amount} onClick={trySave}>
            {ENTRY.save}
          </button>
        </div>

        {/* 確認框必須在 .entry-sheet（有 stopPropagation）內：
            放在 overlay 層當兄弟會讓「點對話框」冒泡到 sheet-overlay 直接關掉整個抽屜 */}
        {confirm === 'dup' && (
          <ConfirmDialog
            title={ENTRY.dupTitle}
            body={dupHint}
            confirmLabel={ENTRY.dupConfirm}
            onConfirm={() => { setConfirm('none'); doSave(); }}
            onCancel={() => setConfirm('none')}
          />
        )}
        {confirm === 'delete' && draft.editingId && (
          <ConfirmDialog
            title={ENTRY.deleteTitle}
            body={ENTRY.deleteBody}
            confirmLabel={ENTRY.deleteConfirm}
            danger
            onConfirm={() => deleteRecord(draft.editingId!)}
            onCancel={() => setConfirm('none')}
          />
        )}
      </div>
    </div>
  );
}
