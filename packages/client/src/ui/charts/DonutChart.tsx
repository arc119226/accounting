/**
 * 分類環圖：分類色壓彩後的圓弧 + 中心毛筆字總額。
 * 弧以 stroke 繪（fill none）——stroke-dasharray 天生支援「筆畫自己畫出來」動畫。
 */
import { formatNTD, type CategoryTotal } from '@zhangben/core';
import { pressColor } from './InkDefs';

const SIZE = 220;
const R = 78;
const STROKE = 30;
const C = SIZE / 2;

function arcPath(startFrac: number, endFrac: number): string {
  // 12 點鐘起順時針；起終角以 -90° 平移
  const a0 = (startFrac * 360 - 90) * (Math.PI / 180);
  const a1 = (endFrac * 360 - 90) * (Math.PI / 180);
  const x0 = C + R * Math.cos(a0);
  const y0 = C + R * Math.sin(a0);
  const x1 = C + R * Math.cos(a1);
  const y1 = C + R * Math.sin(a1);
  const large = endFrac - startFrac > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function DonutChart({
  data,
  colors,
  total,
}: {
  data: readonly CategoryTotal[];
  colors: ReadonlyMap<string, string>;
  total: number;
}) {
  let acc = 0;
  const sum = Math.max(1, data.reduce((s, d) => s + d.total, 0));
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="chart-svg donut-svg" role="img" aria-label="分類占比環圖">
      {/* 底環：淡墨（分類只有一筆時也看得出是環） */}
      <circle cx={C} cy={C} r={R} fill="none" stroke="var(--card-elev)" strokeWidth={STROKE} />
      <g filter="url(#ink-bleed)">
        {data.map((d) => {
          const start = acc / sum;
          acc += d.total;
          const end = acc / sum;
          // 滿環時 arc 起終點重合會畫不出來：夾到 99.99%
          const endClamped = end - start >= 1 ? start + 0.9999 : end;
          return (
            <path
              key={d.categoryId}
              className="donut-arc"
              d={arcPath(start, endClamped)}
              fill="none"
              stroke={pressColor(colors.get(d.categoryId) ?? '#6e6046')}
              strokeWidth={STROKE}
              pathLength={1}
              style={{ animationDelay: `${start * 500}ms` }}
            />
          );
        })}
      </g>
      <text x={C} y={C - 4} textAnchor="middle" className="donut-total-label">
        合計
      </text>
      <text x={C} y={C + 22} textAnchor="middle" className="donut-total tnum">
        {formatNTD(total)}
      </text>
    </svg>
  );
}
