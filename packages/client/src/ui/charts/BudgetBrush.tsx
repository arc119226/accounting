/**
 * 預算墨刷條：花費比例以濃墨自左掃出，超支段轉硃砂；粗滲墨濾鏡=筆刷質感。
 * compact 版給主帳頁（只有總預算一條）。
 */
import { formatAmount, formatNTD, type BudgetProgress } from '@zhangben/core';
import { BUDGET } from '../../strings/ui';

/** 超支的符號佐證：顏色以外還要有一個看得見的形狀（低視力／色覺差異都吃這條） */
const OVER_MARK = BUDGET.overMark;

function BrushBar({ spent, limit }: { spent: number; limit: number }) {
  const over = limit > 0 && spent > limit;
  // 比例基準：超支時以 spent 當滿刻度（超支段才有地方畫），否則以 limit
  const base = Math.max(1, over ? spent : limit);
  const wSpent = Math.min(1, spent / base);
  const wLimit = Math.min(1, limit / base);
  return (
    <svg viewBox="0 0 360 18" className="chart-svg" role="img" aria-label="預算進度">
      <rect x="1" y="3" width="358" height="12" rx="3" fill="var(--card-elev)" />
      <g filter="url(#ink-bleed-heavy)">
        {/* 額度內：濃墨 */}
        <rect x="1" y="3" width={358 * Math.min(wSpent, wLimit)} height="12" rx="3" fill="var(--scroll-ink)" opacity="0.88" />
        {/* 超支段：硃砂（自 limit 起） */}
        {over && (
          <rect x={1 + 358 * wLimit} y="3" width={358 * (wSpent - wLimit)} height="12" rx="3" fill="var(--scroll-zhu)" opacity="0.9" />
        )}
      </g>
      {/* 額度刻線 */}
      {limit > 0 && over && (
        <line x1={1 + 358 * wLimit} y1="0" x2={1 + 358 * wLimit} y2="18" stroke="var(--gold)" strokeWidth="1.5" />
      )}
    </svg>
  );
}

export function BudgetTotalBrush({
  progress,
  compact = false,
}: {
  progress: BudgetProgress;
  compact?: boolean;
}) {
  const { spent, limit } = progress.total;
  if (limit <= 0) return null;
  const over = spent > limit;
  return (
    <div className={`budget-brush${compact ? ' compact' : ''}`}>
      <div className="budget-head">
        <span className="budget-label">本月預算</span>
        <span className={`tnum${over ? ' over-red' : ''}`}>
          {formatAmount(spent)} / {formatAmount(limit)}
        </span>
      </div>
      <BrushBar spent={spent} limit={limit} />
      {/* compact 也要有文字（審查修正）：主帳頁傳的正是 compact，原本超支唯一的訊號
          是那串數字變紅變粗——放大字級不會讓紅色更好認，而斜線兩邊的數字在大字級下
          常換行、大小關係更難一眼判讀。月結摘要卡的 movers 早就用 +/− 符號佐證了。 */}
      {over && <p className="over-red budget-over-note">{OVER_MARK} 已超支 {formatNTD(spent - limit)}</p>}
    </div>
  );
}

export function BudgetCategoryList({
  progress,
  catName,
}: {
  progress: BudgetProgress;
  catName: (id: string) => string;
}) {
  if (progress.perCategory.length === 0) return null;
  return (
    <div className="budget-cats">
      {progress.perCategory.map((line) => (
        <div key={line.categoryId} className="budget-cat-line">
          <div className="budget-head">
            <span>{catName(line.categoryId)}</span>
            <span className={`tnum${line.spent > line.limit ? ' over-red' : ''}`}>
              {line.spent > line.limit ? `${OVER_MARK} ` : ''}
              {formatAmount(line.spent)} / {formatAmount(line.limit)}
            </span>
          </div>
          <BrushBar spent={line.spent} limit={line.limit} />
        </div>
      ))}
    </div>
  );
}
