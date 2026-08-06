/**
 * 掃發票（lazy chunk：偵測引擎 wasm 只在首掃載入）。
 *
 * 流程：相機取流 → 每 250ms 偵測一幀（一幀可回雙碼）→ looksLike 分類左右碼
 * → 左碼在手後 1.5s 內等右碼（右碼只是品項 bonus，左碼頭段已有記帳所需全部欄位）
 * → 發票號碼查重 → 預覽紙卡（規則預填店名/分類）→ 入帳 + 規則學習 → 回相機連掃。
 * iOS standalone 相機被拒是常態：拍照辨識是常駐一級按鈕，同一 decoder 解靜態照片。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatNTD,
  looksLikeEInvoiceLeft,
  looksLikeEInvoiceRight,
  mergeRightQr,
  parseEInvoiceLeft,
  sortCategories,
  suggestCategory,
  parseAmountInput,
  type ExpenseRecord,
  type ParsedInvoice,
  type PersonId,
} from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { todayISO } from '../store/ledgerSlice';
import { getDetector } from '../scan/detector';
import { acquireCamera } from '../scan/camera';
import { show } from '../notice';
import { logError } from '../errlog';
import { ENTRY, SCAN } from '../strings/ui';

type Phase = 'starting' | 'camera' | 'denied';
type Result =
  | { readonly kind: 'preview'; readonly inv: ParsedInvoice }
  | { readonly kind: 'exists'; readonly rec: ExpenseRecord };

/** 掃描預覽卡（可編輯後入帳） */
function PreviewCard({ inv, onDone, onRescan }: { inv: ParsedInvoice; onDone: () => void; onRescan: () => void }) {
  const categories = useAppStore((s) => s.categories);
  const rules = useAppStore((s) => s.rules);
  const settings = useAppStore((s) => s.settings);
  const saveScanned = useAppStore((s) => s.saveScanned);

  const rule = suggestCategory(rules, inv.sellerTaxId);
  const [amountStr, setAmountStr] = useState(String(inv.totalAmount));
  const [date, setDate] = useState(inv.dateISO);
  const [merchantName, setMerchantName] = useState(rule?.displayName ?? '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? 'cat-misc');
  const [note, setNote] = useState('');
  const [paidBy, setPaidBy] = useState<PersonId>(settings.myPerson);

  const cats = sortCategories(categories.values());
  const amount = parseAmountInput(amountStr);

  return (
    <div className="paper-card scan-preview">
      <div className="sheet-title">
        <span className="seal-char">{SCAN.previewTitle.slice(0, 1)}</span>
        {SCAN.previewTitle.slice(1)}
      </div>
      <p className="dim-text inv-no tnum">
        {SCAN.invNoLabel} {inv.number}
      </p>

      <label className="field-label">{SCAN.amountLabel}</label>
      <input
        className="text-input scan-amount tnum"
        inputMode="numeric"
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
      />

      <label className="field-label">{ENTRY.dateLabel}</label>
      <input type="date" className="text-input" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />

      <label className="field-label">{ENTRY.merchantLabel}</label>
      <input
        className="text-input"
        value={merchantName}
        placeholder={`統編 ${inv.sellerTaxId}`}
        maxLength={20}
        onChange={(e) => setMerchantName(e.target.value)}
      />

      <label className="field-label">{ENTRY.paidByLabel}</label>
      <div className="seg">
        {(['A', 'B'] as const).map((p) => (
          <button key={p} className={`seg-btn${paidBy === p ? ' active' : ''}`} onClick={() => setPaidBy(p)}>
            {settings.personNames[p]}
          </button>
        ))}
      </div>

      <label className="field-label">{ENTRY.categoryLabel}</label>
      <div className="cat-scroller">
        {cats.map((c) => (
          <button key={c.id} className={`paper-label${categoryId === c.id ? ' active' : ''}`} onClick={() => setCategoryId(c.id)}>
            {c.glyph}
            {c.name}
          </button>
        ))}
      </div>

      <label className="field-label">{ENTRY.noteLabel}</label>
      <input className="text-input" value={note} placeholder={ENTRY.notePlaceholder} maxLength={40} onChange={(e) => setNote(e.target.value)} />

      {inv.items.length > 0 && (
        <details className="scan-items">
          <summary className="field-label">
            {SCAN.itemsLabel}
            {!inv.itemsComplete && SCAN.itemsPartial}
          </summary>
          {inv.items.map((it, i) => (
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
        <button className="ghost-btn" onClick={onRescan}>
          {SCAN.rescan}
        </button>
        <button
          className="primary-btn save-btn"
          disabled={!amount}
          onClick={() => {
            saveScanned({ inv, amount: amount!, date, categoryId, note: note.trim(), merchantName: merchantName.trim(), paidBy });
            show('saved', `已記一筆 ${formatNTD(amount!)}`);
            onDone();
          }}
        >
          {SCAN.save}
        </button>
      </div>
    </div>
  );
}

export function ScanScreen() {
  const records = useAppStore((s) => s.records);
  const openEntry = useAppStore((s) => s.openEntry);
  const categories = useAppStore((s) => s.categories);

  const [phase, setPhase] = useState<Phase>('starting');
  const [result, setResult] = useState<Result | null>(null);
  const [hint, setHint] = useState<string>(SCAN.starting);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 配對窗：左碼字串與到手時刻（右碼 1.5s 沒來就先走） */
  const pairRef = useRef<{ left: ParsedInvoice | null; leftAt: number; scanning: boolean }>({
    left: null,
    leftAt: 0,
    scanning: true,
  });

  const invoiceIndex = useMemo(() => {
    const m = new Map<string, ExpenseRecord>();
    for (const r of records.values()) if (r.invoice && !r.deleted) m.set(r.invoice.number, r);
    return m;
  }, [records]);
  const indexRef = useRef(invoiceIndex);
  indexRef.current = invoiceIndex;

  /** 偵測結果分類與收斂（相機幀與照片共用） */
  const ingest = (texts: readonly string[]): void => {
    const pair = pairRef.current;
    if (!pair.scanning) return;
    for (const t of texts) {
      if (looksLikeEInvoiceLeft(t)) {
        const parsed = parseEInvoiceLeft(t);
        if (parsed.ok) {
          pair.left = parsed.inv;
          pair.leftAt = Date.now();
          setHint(SCAN.leftOnly);
        }
      } else if (looksLikeEInvoiceRight(t) && pair.left) {
        pair.left = mergeRightQr(pair.left, t);
        finish(pair.left);
        return;
      }
    }
    // 左碼獨存 1.5s：頭段已夠記帳，品項當 bonus 放棄
    if (pair.left && Date.now() - pair.leftAt > 1500) finish(pair.left);
  };

  const finish = (inv: ParsedInvoice): void => {
    const pair = pairRef.current;
    pair.scanning = false;
    pair.left = null;
    const existing = indexRef.current.get(inv.number);
    setResult(existing ? { kind: 'exists', rec: existing } : { kind: 'preview', inv });
  };

  const resumeScan = (): void => {
    pairRef.current = { left: null, leftAt: 0, scanning: true };
    setResult(null);
    setHint(SCAN.hintCamera);
  };

  // 相機 + 偵測迴圈生命週期
  useEffect(() => {
    let release: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let dead = false;
    void (async () => {
      try {
        setHint(SCAN.engineLoading);
        const detector = await getDetector();
        if (dead || !videoRef.current) return;
        setHint(SCAN.starting);
        release = await acquireCamera(videoRef.current);
        if (dead) {
          release();
          return;
        }
        setPhase('camera');
        setHint(SCAN.hintCamera);
        let busy = false;
        timer = setInterval(() => {
          const video = videoRef.current;
          if (busy || !video || video.readyState < 2 || !pairRef.current.scanning) return;
          busy = true;
          void detector
            .detect(video)
            .then((codes) => ingest(codes.map((c) => c.rawValue)))
            .catch(() => {/* 單幀偵測失敗=略過此幀 */})
            .finally(() => {
              busy = false;
            });
        }, 250);
      } catch (err) {
        // iOS standalone 被拒是常態路徑：導向拍照辨識
        logError(`camera: ${String(err)}`);
        if (!dead) {
          setPhase('denied');
          setHint(SCAN.denied);
        }
      }
    })();
    return () => {
      dead = true;
      if (timer) clearInterval(timer);
      release?.();
    };
  }, []);

  const onPhotoPick = (file: File | null): void => {
    if (!file) return;
    void (async () => {
      try {
        const detector = await getDetector();
        const bmp = await createImageBitmap(file);
        const codes = await detector.detect(bmp);
        bmp.close();
        if (codes.length === 0) {
          show('saved', SCAN.photoNone);
          return;
        }
        // 照片是單發：直接分類——左碼在就立即收斂（右碼同照片同批進來）
        const texts = codes.map((c) => c.rawValue);
        const leftText = texts.find((t) => looksLikeEInvoiceLeft(t));
        if (!leftText) {
          show('saved', SCAN.photoNone);
          return;
        }
        const parsed = parseEInvoiceLeft(leftText);
        if (!parsed.ok) {
          show('saved', SCAN.photoNone);
          return;
        }
        const rightText = texts.find((t) => looksLikeEInvoiceRight(t));
        finish(rightText ? mergeRightQr(parsed.inv, rightText) : parsed.inv);
      } catch (err) {
        logError(`photo-scan: ${String(err)}`);
        show('saved', SCAN.photoNone);
      }
    })();
  };

  return (
    <div className="scan-body">
      {!result && (
        <>
          <div className="scan-viewport">
            <video ref={videoRef} className="scan-video" muted />
            {phase === 'camera' && (
              <div className="scan-frame" aria-hidden="true">
                <div className="scan-target" />
                <div className="scan-target" />
              </div>
            )}
            <p className={`scan-hint${phase === 'denied' ? ' denied' : ''}`}>{hint}</p>
          </div>
          <div className="scan-controls">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                onPhotoPick(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <button className="primary-btn" onClick={() => fileRef.current?.click()}>
              {SCAN.photoBtn}
            </button>
          </div>
        </>
      )}

      {result?.kind === 'preview' && (
        <div className="scan-result">
          <PreviewCard inv={result.inv} onDone={resumeScan} onRescan={resumeScan} />
        </div>
      )}

      {result?.kind === 'exists' && (
        <div className="scan-result">
          <div className="paper-card">
            <div className="sheet-title">
              <span className="seal-char">{SCAN.existsTitle.slice(0, 1)}</span>
              {SCAN.existsTitle.slice(1)}
            </div>
            <p className="dim-text">
              {result.rec.date} · {formatNTD(result.rec.amount)} ·{' '}
              {categories.get(result.rec.categoryId)?.name ?? ''}
            </p>
            <div className="modal-actions">
              <button
                className="primary-btn"
                onClick={() =>
                  openEntry({
                    editingId: result.rec.id,
                    amount: result.rec.amount,
                    date: result.rec.date,
                    categoryId: result.rec.categoryId,
                    note: result.rec.note,
                    merchantName: result.rec.merchant?.name ?? '',
                    paidBy: result.rec.paidBy,
                  })
                }
              >
                {SCAN.viewExisting}
              </button>
              <button className="ghost-btn" onClick={resumeScan}>
                {SCAN.rescan}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
