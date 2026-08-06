/**
 * 兩人拔河條：單條水平條依比例分色，兩端名字+金額，下方差額一句話。
 */
import { formatNTD, type PersonId } from '@zhangben/core';

export function PersonSplit({
  totals,
  names,
}: {
  totals: Readonly<Record<PersonId, number>>;
  names: Readonly<Record<PersonId, string>>;
}) {
  const sum = totals.A + totals.B;
  const fracA = sum > 0 ? totals.A / sum : 0.5;
  const diff = Math.abs(totals.A - totals.B);
  const lead = totals.A === totals.B ? null : totals.A > totals.B ? 'A' : 'B';
  return (
    <div className="person-split">
      <div className="split-ends">
        <span>
          {names.A} <span className="tnum">{formatNTD(totals.A)}</span>
        </span>
        <span>
          <span className="tnum">{formatNTD(totals.B)}</span> {names.B}
        </span>
      </div>
      <svg viewBox="0 0 360 22" className="chart-svg split-bar" role="img" aria-label="兩人支出比例">
        <g filter="url(#ink-bleed-heavy)">
          <rect x="2" y="4" width={356 * fracA} height="14" rx="3" fill="var(--gold)" opacity="0.85" />
          <rect x={2 + 356 * fracA} y="4" width={356 * (1 - fracA)} height="14" rx="3" fill="#3d6b8e" opacity="0.8" />
        </g>
        <line x1={2 + 356 * fracA} y1="1" x2={2 + 356 * fracA} y2="21" stroke="var(--scroll-ink)" strokeWidth="1.5" />
      </svg>
      {lead && sum > 0 && (
        <p className="dim-text split-caption">
          {names[lead]} 多出 <span className="tnum">{formatNTD(diff)}</span>
        </p>
      )}
    </div>
  );
}
