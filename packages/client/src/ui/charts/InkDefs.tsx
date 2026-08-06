/**
 * 全站共用的 SVG 濾鏡定義（掛一次在 StatsScreen 頂端）。
 * ink-bleed：feTurbulence + feDisplacementMap 把幾何邊緣揉出宣紙滲墨的毛邊——
 * 這是「手寫 SVG 而非圖表庫」的核心紅利，圖表庫的 canvas 渲染吃不到它。
 */
export function InkDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
      <defs>
        <filter id="ink-bleed" x="-4%" y="-8%" width="108%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        {/* 較重的滲墨（粗筆刷條用） */}
        <filter id="ink-bleed-heavy" x="-6%" y="-14%" width="112%" height="128%">
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="3" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="4.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

/** 分類色壓彩（與 .cat-seal 的 CSS 同款公式；SVG fill 屬性吃不到 CSS class 時用） */
export function pressColor(hex: string): string {
  return `color-mix(in srgb, ${hex} 65%, var(--text))`;
}
