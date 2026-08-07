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
  monthSummary,
  sumByCategory,
  sumByMonth,
  sumByPerson,
  type DateRange,
  type ExpenseRecord,
} from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { draftFromRecord, todayISO } from '../store/ledgerSlice';
import { matchesPersonFilter, sortPersonsForTabs } from '../personView';
import { BarChart } from './charts/BarChart';
import { DonutChart } from './charts/DonutChart';
import { LineChart } from './charts/LineChart';
import { PersonSplit } from './charts/PersonSplit';
import { BudgetCategoryList, BudgetTotalBrush } from './charts/BudgetBrush';
import { CategorySeal } from './LedgerScreen';
import { PersonTabs } from './PersonTabs';
import { LEDGER, STATS } from '../strings/ui';

type Preset = 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom';

/**
 * 月結摘要卡（單月區間才出現）：本月 vs 上月、變動最大的三個分類、本月最大一筆。
 * 漲用硃砂（既有 .over-red）、跌用玉青 --accent——不發明新的綠。
 */
function MonthSummaryCard({ rows, month }: { rows: readonly ExpenseRecord[]; month: string }) {
  const categories = useAppStore((s) => s.categories);
  const records = useAppStore((s) => s.records);
  const openEntry = useAppStore((s) => s.openEntry);
  const s = useMemo(() => monthSummary(rows, month, 3), [rows, month]);
  const largest = s.largestId === null ? undefined : records.get(s.largestId);

  const deltaLine =
    s.deltaPct === null ? STATS.noPrevMonth
    : s.delta === 0 ? STATS.flat
    : `${s.delta > 0 ? STATS.vsLastMore : STATS.vsLastLess}${formatNTD(Math.abs(s.delta))}（${s.delta > 0 ? '+' : '−'}${Math.abs(s.deltaPct)}%）`;

  return (
    <div className="paper-card">
      <div className="chart-title">
        {STATS.summaryTitle} · {formatMonthZh(month)}
        <span className="chart-hint dim-text tnum">{formatNTD(s.total)}</span>
      </div>
      <p className={`dim-text${s.delta > 0 && s.deltaPct !== null ? ' over-red' : ''}`}>{deltaLine}</p>

      {s.movers.length > 0 && (
        <>
          <div className="field-label">{STATS.moversTitle}</div>
          {s.movers.map((m) => {
            const cat = categories.get(m.categoryId);
            return (
              <div key={m.categoryId} className="cat-row">
                <CategorySeal glyph={cat?.glyph ?? '雜'} color={cat?.color ?? 'var(--dim)'} />
                <span className="cat-name">{cat?.name ?? m.categoryId}</span>
                <span className={`tnum${m.delta > 0 ? ' over-red' : ' mover-down'}`}>
                  {m.delta > 0 ? '+' : '−'}
                  {formatNTD(Math.abs(m.delta))}
                </span>
              </div>
            );
          })}
        </>
      )}

      {largest && (
        <>
          <div className="field-label">{STATS.largestTitle}</div>
          <button className="entry-row" onClick={() => openEntry(draftFromRecord(largest))}>
            <span className="entry-text">
              <span className="entry-title">
                {largest.merchant?.name || largest.note || categories.get(largest.categoryId)?.name || ''}
              </span>
              <span className="entry-sub">{largest.date}</span>
            </span>
            <span className="entry-amount tnum">{formatNTD(largest.amount)}</span>
          </button>
        </>
      )}
    </div>
  );
}

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
  const persons = useAppStore((s) => s.persons);
  const personFilter = useAppStore((s) => s.personFilter);
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

  const familyView = personFilter === 'all';
  const allRows = useMemo(() => [...records.values()], [records]);
  /** 頁籤過濾後的資料集：四張圖都跟著（全家=不過濾） */
  const rows = useMemo(
    () => allRows.filter((r) => matchesPersonFilter(r, personFilter)),
    [allRows, personFilter],
  );
  const byMonth = useMemo(() => sumByMonth(rows, 12, focusMonth), [rows, focusMonth]);
  const byCat = useMemo(() => sumByCategory(rows, range), [rows, range]);
  const byPerson = useMemo(() => sumByPerson(rows, range), [rows, range]);
  const trend = useMemo(() => dailyTrend(rows, focusMonth), [rows, focusMonth]);
  const trendPrev = useMemo(() => dailyTrend(rows, addMonths(focusMonth, -1)), [rows, focusMonth]);
  // 預算是家庭層級：一律以未過濾資料計（個人頁籤本就不顯示預算卡）
  const budgetProg = useMemo(() => budgetProgress(allRows, budget, focusMonth), [allRows, budget, focusMonth]);
  const splitPersons = useMemo(
    () => sortPersonsForTabs(persons).map((p) => ({ id: p.id, name: p.name, total: byPerson.get(p.id) ?? 0 })),
    [persons, byPerson],
  );

  const rangeTotal = byCat.reduce((s, c) => s + c.total, 0);
  const colorMap = useMemo(
    () => new Map([...categories.values()].map((c) => [c.id, c.color])),
    [categories],
  );

  /**
   * 分類明細要有上限。區間可以是「今年」⇒ 點最大的分類，**第一年就**是 1,000+ 列、
   * 每列一個 button 內含 3–4 個 span ≈ 6,000 個 DOM 節點一次插入（點一下圖例卡半秒，
   * 之後整頁捲動都變頓）。LedgerScreen 檔頭那句「單月 <300 筆不需虛擬化」對主帳頁成立，
   * 但這條清單不受單月約束——同一個結論被套用到了不同量級的東西上。
   * 不做虛擬化：上限就夠了，而虛擬化會把捲動位置與大字級的互動全部變複雜。
   */
  const PICKED_LIMIT = 100;
  const picked = useMemo(() => {
    if (!pickedCat) return { rows: [] as ExpenseRecord[], total: 0 };
    const all = rows
      .filter((r) => !r.deleted && r.categoryId === pickedCat && r.date >= range.from && r.date <= range.to)
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
    return { rows: all.slice(0, PICKED_LIMIT), total: all.length };
  }, [rows, pickedCat, range]);
  const pickedRows = picked.rows;

  return (
    <div className="screen-body">
      <PersonTabs />
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
          {singleMonth && <MonthSummaryCard rows={rows} month={focusMonth} />}

          <div className="paper-card">
            <div className="chart-title">
              {STATS.barTitle}
              <span className="chart-hint dim-text tnum">
                {formatMonthZh(focusMonth)} {formatNTD(byMonth.find((m) => m.month === focusMonth)?.total ?? 0)}
              </span>
            </div>
            <BarChart
              data={byMonth}
              focusMonth={focusMonth}
              onPickMonth={(m) => {
                setMonth(m);
                setScreen('ledger');
              }}
            />
          </div>

          {familyView && singleMonth && budgetProg.total.limit > 0 && (
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
            <div className="chart-title">
              {STATS.donutTitle}
              {/* 總額從環心搬到這裡：SVG 內的 <text> 是固定 user unit，字級一放大就壓到環上、
                  再大被 SVG 邊界靜默切掉；HTML 文字則會跟著長大也會換行 */}
              <span className="chart-hint dim-text tnum">{formatNTD(rangeTotal)}</span>
            </div>
            <DonutChart data={byCat} colors={colorMap} />
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
                    <CategorySeal glyph={cat?.glyph ?? '雜'} color={cat?.color ?? 'var(--dim)'} />
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
                      openEntry(draftFromRecord(r))
                    }
                  >
                    <span className="entry-text">
                      <span className="entry-title">{r.merchant?.name || r.note || ''}</span>
                      <span className="entry-sub">{r.date}</span>
                    </span>
                    {r.source === 'einvoice' && <span className="einv-chip">{LEDGER.einvoiceChip}</span>}
                    <span className="entry-amount tnum">{formatNTD(r.amount)}</span>
                  </button>
                ))}
                {picked.total > pickedRows.length && (
                  <p className="dim-text picked-more">
                    {STATS.pickedMore(picked.total - pickedRows.length)}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="paper-card">
            <div className="chart-title">
              {STATS.trendTitle} · {formatMonthZh(focusMonth)}
              {/* 累計終值從 SVG 右上角搬到這裡（同環圖的理由） */}
              <span className="chart-hint dim-text tnum">
                {formatNTD(trend.at(-1)?.cumulative ?? 0)} · {STATS.trendHint}
              </span>
            </div>
            <LineChart current={trend} previous={trendPrev} />
          </div>

          {familyView && splitPersons.length >= 2 && (
            <div className="paper-card">
              <div className="chart-title">{STATS.personTitle}</div>
              <PersonSplit persons={splitPersons} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
