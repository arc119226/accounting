/**
 * 主帳頁：卷軸月份橫幅（‹›+左右滑切月）、兩人小計卡、按日分組清單、記一筆 FAB。
 * 清單資料全由記憶體 Map 過濾（單月 <300 筆，不需虛擬化）。
 */
import { useEffect, useMemo, useRef } from 'react';
import { addMonths, budgetProgress, formatMonthZh, formatNTD, monthOf, type ExpenseRecord } from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { attachDrag } from '../gesture';
import { matchesPersonFilter, sortPersonsForTabs } from '../personView';
import { BudgetTotalBrush } from './charts/BudgetBrush';
import { PersonTabs } from './PersonTabs';
import { LEDGER, SYNC } from '../strings/ui';

/** 分類印章：色彩經 color-mix 65% 壓向墨色（高彩在宣紙上才不刺眼） */
export function CategorySeal({ glyph, color }: { glyph: string; color: string }) {
  return (
    <span
      className="seal-char cat-seal"
      style={{ ['--cat-color' as string]: color }}
    >
      {glyph}
    </span>
  );
}

function DayGroup({ date, rows }: { date: string; rows: ExpenseRecord[] }) {
  const categories = useAppStore((s) => s.categories);
  const openEntry = useAppStore((s) => s.openEntry);
  const day = new Date(`${date}T00:00:00`);
  const weekday = LEDGER.weekdays[day.getDay()];
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  return (
    <section className="day-group">
      <header className="day-head">
        <span>
          {day.getMonth() + 1}月{day.getDate()}日 · {weekday}
        </span>
        <span className="tnum dim-text">{formatNTD(total)}</span>
      </header>
      {rows.map((r) => {
        const cat = categories.get(r.categoryId);
        return (
          <button
            key={r.id}
            className="entry-row"
            onClick={() =>
              openEntry({
                editingId: r.id,
                amount: r.amount,
                date: r.date,
                categoryId: r.categoryId,
                note: r.note,
                merchantName: r.merchant?.name ?? '',
                paidBy: r.paidBy,
              })
            }
          >
            <CategorySeal glyph={cat?.glyph ?? '雜'} color={cat?.color ?? '#6e6046'} />
            <span className="entry-text">
              <span className="entry-title">
                {r.merchant?.name || r.note || cat?.name || ''}
                {r.source === 'einvoice' && <span className="einv-chip">{LEDGER.einvoiceChip}</span>}
              </span>
              {r.merchant?.name && r.note && <span className="entry-sub">{r.note}</span>}
            </span>
            <span className="entry-amount tnum">{formatNTD(r.amount)}</span>
          </button>
        );
      })}
    </section>
  );
}

/** 備份提醒：距上次同步/匯出 >30 天且帳上有記錄才出現（新用戶不騷擾） */
function BackupNag() {
  const settings = useAppStore((s) => s.settings);
  const peers = useAppStore((s) => s.peers);
  const records = useAppStore((s) => s.records);
  const setScreen = useAppStore((s) => s.setScreen);
  if (records.size === 0) return null;
  const lastCare = Math.max(settings.lastExportMs, ...peers.map((p) => p.lastSyncWallMs), 0);
  // 從未備份：以第一筆記錄存在即開始計時的話會立刻騷擾新用戶——放寬為「從未+帳上>30筆」
  const stale = lastCare > 0
    ? Date.now() - lastCare > 30 * 24 * 60 * 60 * 1000
    : records.size > 30;
  if (!stale) return null;
  return (
    <button className="backup-nag" onClick={() => setScreen('sync')}>
      {SYNC.backupNag}
    </button>
  );
}

export function LedgerScreen() {
  const records = useAppStore((s) => s.records);
  const budget = useAppStore((s) => s.budget);
  const monthCursor = useAppStore((s) => s.monthCursor);
  const setMonth = useAppStore((s) => s.setMonth);
  const openEntry = useAppStore((s) => s.openEntry);
  const persons = useAppStore((s) => s.persons);
  const personFilter = useAppStore((s) => s.personFilter);
  const listRef = useRef<HTMLDivElement>(null);

  const { groups, totals, monthTotal } = useMemo(() => {
    const byDay = new Map<string, ExpenseRecord[]>();
    const totals = new Map<string, number>(); // personId → 該月合計（不受頁籤過濾，供全家小計卡）
    let monthTotal = 0;
    for (const r of records.values()) {
      if (r.deleted || monthOf(r.date) !== monthCursor) continue;
      totals.set(r.paidBy, (totals.get(r.paidBy) ?? 0) + r.amount);
      if (!matchesPersonFilter(r, personFilter)) continue;
      const list = byDay.get(r.date) ?? [];
      list.push(r);
      byDay.set(r.date, list);
      monthTotal += r.amount;
    }
    // 日期新在前；同日新記錄在前（uuidv7 時間有序=id 比較即可）
    const groups = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, rows]) => ({ date, rows: rows.sort((a, b) => (a.id < b.id ? 1 : -1)) }));
    return { groups, totals, monthTotal };
  }, [records, monthCursor, personFilter]);

  // 左右滑切月（水平位移 > 60px 且橫向主導）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    return attachDrag(el, {
      onEnd(dx, dy, dragged) {
        if (!dragged || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        setMonth(addMonths(useAppStore.getState().monthCursor, dx > 0 ? -1 : 1));
      },
    }, 24);
  }, [setMonth]);

  const budgetProg = useMemo(
    () => budgetProgress(records.values(), budget, monthCursor),
    [records, budget, monthCursor],
  );

  const tabPersons = sortPersonsForTabs(persons);
  const familyView = personFilter === 'all';

  return (
    <div className="screen-body ledger-body" ref={listRef}>
      <div className="month-nav">
        <button className="ghost-btn month-arrow" onClick={() => setMonth(addMonths(monthCursor, -1))}>
          ‹
        </button>
        <div className="scroll-banner month-banner">{formatMonthZh(monthCursor)}</div>
        <button className="ghost-btn month-arrow" onClick={() => setMonth(addMonths(monthCursor, 1))}>
          ›
        </button>
        {/* 合計獨立成第二列（見 ledger.css）：卷軸橫幅是標題不是資料列，
            擠在一起會把兩顆箭頭推到貼死螢幕邊 */}
        <span className="month-total tnum">{LEDGER.totalPrefix}{formatNTD(monthTotal)}</span>
      </div>

      <PersonTabs />

      {/* 兩人小計卡與家庭預算只屬於【全家】檢視——個人頁籤看的是自己的帳 */}
      {familyView && tabPersons.length >= 2 && (
        <div className="person-totals">
          {tabPersons.map((p, i) => (
            <div
              key={p.id}
              className="money-card person-card"
              style={{ ['--card-accent' as string]: i === 0 ? '#8a6a2f' : '#3d6b8e' }}
            >
              <div className="money-name">{p.name}</div>
              <div className="money-amount tnum">{formatNTD(totals.get(p.id) ?? 0)}</div>
            </div>
          ))}
        </div>
      )}

      {familyView && <BudgetTotalBrush progress={budgetProg} compact />}

      <BackupNag />

      {groups.length === 0 ? (
        <p className="dim-text empty-hint">{LEDGER.emptyMonth}</p>
      ) : (
        groups.map((g) => <DayGroup key={g.date} date={g.date} rows={g.rows} />)
      )}

      <button className="primary-btn add-fab" onClick={() => openEntry()}>
        {LEDGER.addEntry}
      </button>
    </div>
  );
}
