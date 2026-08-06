/**
 * 累積趨勢線：本月累積實線（描筆動畫）+ 上月同期虛線參考（超速訊號）。
 * 兩線共用同一 y 比例（比較才有意義）。
 */
import { type DayPoint } from '@zhangben/core';

const W = 360;
const H = 150;
const PAD = { l: 8, r: 8, t: 14, b: 20 };

function pathOf(points: readonly DayPoint[], days: number, max: number): string {
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  return points
    .map((p, i) => {
      const x = PAD.l + (iw * i) / Math.max(1, days - 1);
      const y = PAD.t + ih - (ih * p.cumulative) / max;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

export function LineChart({
  current,
  previous,
}: {
  current: readonly DayPoint[];
  previous: readonly DayPoint[];
}) {
  const max = Math.max(
    1,
    current.at(-1)?.cumulative ?? 0,
    previous.at(-1)?.cumulative ?? 0,
  );
  const days = Math.max(current.length, previous.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="本月累積趨勢線">
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--line-gold)" strokeWidth="1" />
      {/* 上月同期：淡墨虛線 */}
      {previous.length > 0 && (
        <path
          d={pathOf(previous, days, max)}
          fill="none"
          stroke="var(--dim)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
          opacity="0.55"
        />
      )}
      {/* 本月：濃墨描筆（pathLength 歸一，dasharray 動畫在 stats.css） */}
      {current.length > 0 && (
        <path
          className="trend-line"
          d={pathOf(current, days, max)}
          fill="none"
          stroke="var(--scroll-ink)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          filter="url(#ink-bleed)"
        />
      )}
      <text x={PAD.l} y={H - 6} className="chart-tick">1日</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" className="chart-tick">{days}日</text>
    </svg>
  );
}
