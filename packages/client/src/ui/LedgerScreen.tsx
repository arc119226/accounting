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
import { draftFromRecord } from '../store/ledgerSlice';
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
              openEntry(draftFromRecord(r))
            }
          >
            <CategorySeal glyph={cat?.glyph ?? '雜'} color={cat?.color ?? 'var(--dim)'} />
            <span className="entry-text">
              <span className="entry-title">{r.merchant?.name || r.note || cat?.name || ''}</span>
              {r.merchant?.name && r.note && <span className="entry-sub">{r.note}</span>}
            </span>
            {/* chip 是 .entry-row 的獨立欄，不放進 .entry-title——那裡有 ellipsis 會把它一起吃掉 */}
            {r.source === 'einvoice' && <span className="einv-chip">{LEDGER.einvoiceChip}</span>}
            <span className="entry-amount tnum">{formatNTD(r.amount)}</span>
          </button>
        );
      })}
    </section>
  );
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * 備份提醒。門檻**看瀏覽器有沒有承諾不回收**（審查修正）。
 *
 * 舊版一律 30 天、且從未備份時要求帳上 >30 筆才提醒。問題是 WebKit 在分頁模式下
 * 不給持久性，而且是「7 天沒開站就把 IDB 連同 SW 一起清掉」——30 天的提醒必然在
 * 資料已經沒了之後才響，而記了 20 筆的人（20 > 30 為 false）連響都不會響。
 *
 * 現在：拿到 persist ⇒ 維持 30 天（Chromium 冪等、風險低）；
 * 沒拿到 ⇒ 3 天、且只要帳上有活記錄就提醒。3 天是刻意壓在 7 天窗內。
 */
function BackupNag() {
  const settings = useAppStore((s) => s.settings);
  const peers = useAppStore((s) => s.peers);
  const records = useAppStore((s) => s.records);
  const persisted = useAppStore((s) => s.persisted);
  const setScreen = useAppStore((s) => s.setScreen);
  if (records.size === 0) return null;
  const atRisk = persisted === false;
  const lastCare = Math.max(settings.lastExportMs, ...peers.map((p) => p.lastSyncWallMs), 0);
  const maxAge = (atRisk ? 3 : 30) * DAY;
  const stale = lastCare > 0
    ? Date.now() - lastCare > maxAge
    // 從未備份過：以第一筆記錄開始計時會立刻騷擾新用戶，所以看筆數。
    // 但沒受保護時「筆數多寡」不是重點——回收是無差別的，有帳就該提醒。
    : atRisk || records.size > 30;
  if (!stale) return null;
  return (
    <button className="backup-nag" onClick={() => setScreen('sync')}>
      {atRisk ? SYNC.backupNagAtRisk : SYNC.backupNag}
    </button>
  );
}

/**
 * iOS 未安裝時的安裝提示。**放在帳本頁**而不是只放設定頁（審查修正）：
 * 原本要使用者自己走進設定頁才看得到，而會被 7 天回收清掉的正是那些
 * 「在 Safari 分頁裡用一用就沒再開」的人——他們最不可能去逛設定頁。
 * 只在真的沒拿到持久性時出現，拿到了就不囉嗦。
 */
function IosInstallNag() {
  const persisted = useAppStore((s) => s.persisted);
  const records = useAppStore((s) => s.records);
  const setScreen = useAppStore((s) => s.setScreen);
  if (persisted !== false || records.size === 0) return null;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (!isIos || standalone) return null;
  return (
    <button className="backup-nag" onClick={() => setScreen('settings')}>
      {SYNC.installNag}
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
        {/* 三顆包成一列（.month-row 不准換行）：靠 flex-wrap 讓合計換行的話，
            斷行是用 hypothetical size 判定的（**先斷行、後收縮**），橫幅一寬就把「›」
            擠到第二列。合計改由外層的 column 排到第二列，兩顆箭頭永遠與橫幅同列。 */}
        <div className="month-row">
          <button className="ghost-btn month-arrow" onClick={() => setMonth(addMonths(monthCursor, -1))}>
            ‹
          </button>
          <div className="scroll-banner month-banner">{formatMonthZh(monthCursor)}</div>
          <button className="ghost-btn month-arrow" onClick={() => setMonth(addMonths(monthCursor, 1))}>
            ›
          </button>
        </div>
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
              /* 與統計頁的拔河條共用同一組人物色階（base.css --person-1..4） */
              style={{ ['--card-accent' as string]: i === 0 ? 'var(--person-1)' : 'var(--person-2)' }}
            >
              <div className="money-name">{p.name}</div>
              <div className="money-amount tnum">{formatNTD(totals.get(p.id) ?? 0)}</div>
            </div>
          ))}
        </div>
      )}

      {familyView && <BudgetTotalBrush progress={budgetProg} compact />}

      <IosInstallNag />

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
