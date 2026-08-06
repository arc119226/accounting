/**
 * 人物分帳圖（v2：開放人物集合）：恰兩人=水平拔河條（金 vs 黛藍），
 * 其他數量=逐人水平條列（同色階循環）。順序由呼叫端決定（我在前）。
 */
import { formatNTD } from '@zhangben/core';

export interface SplitPerson {
  readonly id: string;
  readonly name: string;
  readonly total: number;
}

/** 人物色階住 base.css：帳本的兩人小計卡本來各寫一份，其實是同一組（見 --person-1..4） */
const COLORS = ['var(--person-1)', 'var(--person-2)', 'var(--person-3)', 'var(--person-4)'] as const;

function TugOfWar({ a, b }: { a: SplitPerson; b: SplitPerson }) {
  const sum = a.total + b.total;
  const fracA = sum > 0 ? a.total / sum : 0.5;
  const diff = Math.abs(a.total - b.total);
  const lead = a.total === b.total ? null : a.total > b.total ? a : b;
  return (
    <div className="person-split">
      <div className="split-ends">
        <span>
          {a.name} <span className="tnum">{formatNTD(a.total)}</span>
        </span>
        <span>
          <span className="tnum">{formatNTD(b.total)}</span> {b.name}
        </span>
      </div>
      <svg viewBox="0 0 360 22" className="chart-svg" role="img" aria-label="兩人支出比例">
        <g filter="url(#ink-bleed-heavy)">
          <rect x="2" y="4" width={356 * fracA} height="14" rx="3" fill={COLORS[0]} opacity="0.85" />
          <rect x={2 + 356 * fracA} y="4" width={356 * (1 - fracA)} height="14" rx="3" fill={COLORS[1]} opacity="0.8" />
        </g>
        <line x1={2 + 356 * fracA} y1="1" x2={2 + 356 * fracA} y2="21" stroke="var(--scroll-ink)" strokeWidth="1.5" />
      </svg>
      {lead && sum > 0 && (
        <p className="dim-text split-caption">
          {lead.name} 多出 <span className="tnum">{formatNTD(diff)}</span>
        </p>
      )}
    </div>
  );
}

export function PersonSplit({ persons }: { persons: readonly SplitPerson[] }) {
  if (persons.length === 2) return <TugOfWar a={persons[0]!} b={persons[1]!} />;
  const max = Math.max(1, ...persons.map((p) => p.total));
  return (
    <div className="person-split">
      {persons.map((p, i) => (
        /* 沿用預算分類列的版式（.budget-cat-line + .budget-head）：姓名與金額一列
           space-between、長條滿寬另一列。原本用的 .split-row/.split-name/.split-amount
           **全庫 CSS 都沒有定義**，於是 svg 的 display:block 把三者拆成三行堆疊；
           而三欄式（姓名｜長條｜金額）在大字級下本來就會擠爆。 */
        <div key={p.id} className="budget-cat-line">
          <div className="budget-head">
            <span>{p.name}</span>
            <span className="tnum">{formatNTD(p.total)}</span>
          </div>
          <svg viewBox="0 0 360 16" className="chart-svg" role="img" aria-label={`${p.name} 支出`}>
            <g filter="url(#ink-bleed-heavy)">
              <rect x="1" y="3" width={Math.max(2, (358 * p.total) / max)} height="10" rx="3" fill={COLORS[i % COLORS.length]} opacity="0.85" />
            </g>
          </svg>
        </div>
      ))}
    </div>
  );
}
