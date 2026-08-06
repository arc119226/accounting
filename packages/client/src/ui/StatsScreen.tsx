/**
 * 統計頁：區間選擇（本月/上月/今年/自訂）+ 五個段落
 * （月度長條、預算進度、分類環圖+圖例、累積趨勢、兩人比較）。
 * 聚合全走 core 純函式，useMemo 以 records Map 身分快取；區間是本頁局部狀態
 * （沒有跨屏消費者，不進 store）。
 */
import { useMemo, useState } from 'react';
import {
  addMonths,
  budgetProgress,
  dailyTrend,
  formatMonthZh,
  formatNTD,
  monthOf,
  monthRange,
  sumByCategory,
  sumByMonth,
  sumByPerson,
  type DateRange,
  type ExpenseRecord,
} from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { todayISO } from '../store/ledgerSlice';
import { BarChart } from './charts/BarChart';
import { DonutChart } from './charts/DonutChart';
import { LineChart } from './charts/LineChart';
import { PersonSplit } from './charts/PersonSplit';
import { BudgetCategoryList, BudgetTotalBrush } from './charts/BudgetBrush';
import { CategorySeal } from './LedgerScreen';
import { LEDGER, STATS } from '../strings/ui';

type Preset = 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

function MonthStepper({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <span className="month-stepper">
      <button className="ghost-btn stepper-btn" onClick={() => onChange(addMonths(value, -1))}>‹</button>
      <span className="tnum">{value}</span>
      <button className="ghost-btn stepper-btn" onClick={() => onChange(addMonths(value, 1))}>›</button>
    </span>
  );
}

export function StatsScreen() {
  const records = useAppStore((s) => s.records);
  const categories = useAppStore((s) => s.categories);
  const budget = useAppStore((s) => s.budget);
  const settings = useAppStore((s) => s.settings);
  const setMonth = useAppStore((s) => s.setMonth);
  const setScreen = useAppStore((s) => s.setScreen);
  const openEntry = useAppStore((s) => s.openEntry);

  const nowMonth = monthOf(todayISO());
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [customFrom, setCustomFrom] = useState(addMonths(nowMonth, -1));
  const [customTo, setCustomTo] = useState(nowMonth);
  const [pickedCat, setPickedCat] = useState<string | null>(null);

  const range: DateRange = useMemo(() => {
    if (preset === 'thisMonth') return monthRange(nowMonth);
    if (preset === 'lastMonth') return monthRange(addMonths(nowMonth, -1));
    if (preset === 'thisYear') return { from: `${nowMonth.slice(0, 4)}-01-01`, to: `${nowMonth.slice(0, 4)}-12-31` };
    const [f, t] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return { from: monthRange(f).from, to: monthRange(t).to };
  }, [preset, nowMonth, customFrom, customTo]);

  /** 趨勢/預算聚焦的單一月份：區間迄月 */
  const focusMonth = monthOf(range.to);
  const singleMonth = monthOf(range.from) === focusMonth;

  const rows = useMemo(() => [...records.values()], [records]);
  const byMonth = useMemo(() => sumByMonth(rows, 12, focusMonth), [rows, focusMonth]);
  const byCat = useMemo(() => sumByCategory(rows, range), [rows, range]);
  const byPerson = useMemo(() => sumByPerson(rows, range), [rows, range]);
  const trend = useMemo(() => dailyTrend(rows, focusMonth), [rows, focusMonth]);
  const trendPrev = useMemo(() => dailyTrend(rows, addMonths(focusMonth, -1)), [rows, focusMonth]);
  const budgetProg = useMemo(() => budgetProgress(rows, budget, focusMonth), [rows, budget, focusMonth]);

  const rangeTotal = byCat.reduce((s, c) => s + c.total, 0);
  const colorMap = useMemo(
    () => new Map([...categories.values()].map((c) => [c.id, c.color])),
    [categories],
  );

  const pickedRows = useMemo(() => {
    if (!pickedCat) return [] as ExpenseRecord[];
    return rows
      .filter((r) => !r.deleted && r.categoryId === pickedCat && r.date >= range.from && r.date <= range.to)
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  }, [rows, pickedCat, range]);

  return (
    <div className="screen-body">
      <div className="seg">
        {(['thisMonth', 'lastMonth', 'thisYear', 'custom'] as const).map((p) => (
          <button key={p} className={`seg-btn${preset === p ? ' active' : ''}`} onClick={() => setPreset(p)}>
            {STATS[p === 'thisMonth' ? 'thisMonth' : p === 'lastMonth' ? 'lastMonth' : p === 'thisYear' ? 'thisYear' : 'custom']}
          </button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="custom-range">
          <span className="field-label">{STATS.from}</span>
          <MonthStepper value={customFrom} onChange={setCustomFrom} />
          <span className="field-label">{STATS.to}</span>
          <MonthStepper value={customTo} onChange={setCustomTo} />
        </div>
      )}

      {rangeTotal === 0 ? (
        <p className="dim-text empty-hint">{STATS.emptyRange}</p>
      ) : (
        <>
          <div className="paper-card">
            <div className="chart-title">{STATS.barTitle}</div>
            <BarChart
              data={byMonth}
              focusMonth={focusMonth}
              onPickMonth={(m) => {
                setMonth(m);
                setScreen('ledger');
              }}
            />
          </div>

          {singleMonth && budgetProg.total.limit > 0 && (
            <div className="paper-card">
              <div className="chart-title">
                {STATS.budgetTitle} · {formatMonthZh(focusMonth)}
              </div>
              <BudgetTotalBrush progress={budgetProg} />
              <BudgetCategoryList
                progress={budgetProg}
                catName={(id) => categories.get(id)?.name ?? id}
              />
            </div>
          )}

          <div className="paper-card">
            <div className="chart-title">{STATS.donutTitle}</div>
            <DonutChart data={byCat} colors={colorMap} total={rangeTotal} />
            <div className="donut-legend">
              {byCat.map((c) => {
                const cat = categories.get(c.categoryId);
                const pct = Math.round((c.total / Math.max(1, rangeTotal)) * 100);
                return (
                  <button
                    key={c.categoryId}
                    className={`legend-row${pickedCat === c.categoryId ? ' active' : ''}`}
                    onClick={() => setPickedCat(pickedCat === c.categoryId ? null : c.categoryId)}
                  >
                    <CategorySeal glyph={cat?.glyph ?? '雜'} color={cat?.color ?? '#6e6046'} />
                    <span className="legend-name">{cat?.name ?? c.categoryId}</span>
                    <span className="legend-count dim-text tnum">
                      {c.count}
                      {STATS.countSuffix}
                    </span>
                    <span className="legend-amount tnum">{formatNTD(c.total)}</span>
                    <span className="legend-pct tnum dim-text">{pct}%</span>
                  </button>
                );
              })}
            </div>
            {pickedCat && pickedRows.length > 0 && (
              <div className="picked-list">
                {pickedRows.map((r) => (
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
                    <span className="entry-text">
                      <span className="entry-title">
                        {r.merchant?.name || r.note || ''}
                        {r.source === 'einvoice' && <span className="einv-chip">{LEDGER.einvoiceChip}</span>}
                      </span>
                      <span className="entry-sub">{r.date}</span>
                    </span>
                    <span className="entry-amount tnum">{formatNTD(r.amount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="paper-card">
            <div className="chart-title">
              {STATS.trendTitle} · {formatMonthZh(focusMonth)}
              <span className="chart-hint dim-text">{STATS.trendHint}</span>
            </div>
            <LineChart current={trend} previous={trendPrev} />
          </div>

          <div className="paper-card">
            <div className="chart-title">{STATS.personTitle}</div>
            <PersonSplit totals={byPerson} names={settings.personNames} />
          </div>
        </>
      )}
    </div>
  );
}
