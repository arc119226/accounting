/**
 * 月度長條（近 12 個月）：墨色長條、焦點月鎏金；點長條跳主帳頁該月。
 * 進場動畫：scaleY 由 0 展開、逐條 stagger（CSS 在 stats.css .bar-anim）。
 */
import { type MonthTotal } from '@zhangben/core';

const W = 360;
const H = 150;
const PAD_B = 22;
const PAD_T = 18;

export function BarChart({
  data,
  focusMonth,
  onPickMonth,
}: {
  data: readonly MonthTotal[];
  focusMonth: string;
  onPickMonth: (month: string) => void;
}) {
  const max = Math.max(1, ...data.map((d) => d.total));
  const bw = (W - 10) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img" aria-label="月度支出長條圖">
      <line x1="4" y1={H - PAD_B} x2={W - 4} y2={H - PAD_B} stroke="var(--line-gold)" strokeWidth="1" />
      {data.map((d, i) => {
        const h = Math.round(((H - PAD_B - PAD_T) * d.total) / max);
        const x = 5 + i * bw;
        const focus = d.month === focusMonth;
        const m = Number(d.month.slice(5));
        return (
          <g key={d.month} onClick={() => onPickMonth(d.month)} style={{ cursor: 'pointer' }}>
            {/* 觸控命中區蓋滿整欄（細長條難點） */}
            <rect x={x} y={PAD_T} width={bw} height={H - PAD_B - PAD_T} fill="transparent" />
            {d.total > 0 && (
              <rect
                className="bar-anim"
                style={{ animationDelay: `${i * 45}ms` }}
                x={x + bw * 0.18}
                y={H - PAD_B - h}
                width={bw * 0.64}
                height={h}
                rx="2"
                fill={focus ? 'var(--gold)' : 'var(--scroll-ink-dim)'}
                filter="url(#ink-bleed)"
              />
            )}
            <text
              x={x + bw / 2}
              y={H - 8}
              textAnchor="middle"
              className={`chart-tick${focus ? ' focus' : ''}`}
            >
              {/* 只印數字不印「月」：每格只有 29 user unit，而 SVG 文字若被系統字級乘大，
                  「12月」在 146% 就會與鄰月刻度重疊。單位由卡片標題一次交代。 */}
              {m}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
