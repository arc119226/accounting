import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 樣式匯總的結構鎖（移植自 sr2 styles.test.ts）。
 *
 * CSS 沒有型別檢查——拆檔後真正會出事的兩件事是「有人重排 @import 順序」與
 * 「新葉檔沒登記/登記兩次」，兩者都會靜默跑版、`pnpm test` 全綠。
 * 這支測試把 barrel 的**順序即契約**寫成斷言，並鎖「CSS 引用的站內資產必須存在」
 * （URL 打錯=靜默退回漸層，畫面只是醜了不會報錯）。
 */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.join(DIR, '../src/styles.css');
const LEAF_DIR = path.join(DIR, '../src/styles');

const barrelText = fs.readFileSync(BARREL, 'utf8');
const barrelLines = barrelText.split('\n');
/** barrel 登記的葉檔，依 @import 出現順序 */
const imported = barrelLines
  .map((l) => /^@import '\.\/styles\/([^']+)';$/.exec(l.trim())?.[1])
  .filter((n): n is string => !!n);
const onDisk = fs.readdirSync(LEAF_DIR).filter((f) => f.endsWith('.css'));
const leaf = (name: string): string => fs.readFileSync(path.join(LEAF_DIR, name), 'utf8');
/** 後者在 import 順序中必須晚於前者（同特異性時 source order 決勝） */
const AFTER: readonly (readonly [string, string, string])[] = [
  ['components.css', 'base.css', '元件依賴 base 的 tokens/@font-face 宣告'],
  ['ledger.css', 'components.css', '.cat-seal 覆蓋 .seal-char、.month-banner 覆蓋 .scroll-banner'],
  ['entry.css', 'components.css', '.cat-scroller .paper-label 尺寸覆蓋、.sheet-actions 覆蓋 .modal-actions'],
  ['stats.css', 'ledger.css', '.picked-list 內 .entry-row 沿用 ledger 定義再補邊界'],
  ['scan.css', 'entry.css', '.scan-preview 沿用 .sheet-title/.cat-scroller/.text-input 再補尺寸'],
  ['sync.css', 'components.css', '.room-code-input 覆蓋 .text-input、摘要卡沿用 .scroll-banner'],
  ['sync.css', 'scan.css', '.join-viewport 沿用 .scan-viewport/.scan-hint 的取景器樣式再補尺寸'],
  ['dialogs.css', 'components.css', 'modal 內按鈕間距/覆蓋晚於元件定義'],
  ['toast.css', 'components.css', 'toast 內按鈕樣式晚於元件定義'],
  ['nav.css', 'components.css', 'nav 的 .screen 版面補充晚於元件定義'],
  ['motion.css', 'base.css', 'reduce 時關 .screen 的 screenIn 與 .fade-img 轉場，須晚於 base 的動畫宣告'],
  ['motion.css', 'components.css', '.paper-label/.nav-btn 的 transition 覆蓋晚於元件定義'],
  ['motion.css', 'entry.css', '關 .entry-sheet 的 sheetUp 上滑（30% 位移是前庭刺激源）'],
  ['motion.css', 'stats.css', '.trend-line/.donut-arc 的 stroke-dashoffset 終值必須壓過 stats 的 dashoffset:1，否則圖表全白'],
];

/**
 * 每支 @keyframes 都必須對 prefers-reduced-motion 表態——新增動畫沒表態就 fail。
 * 這張表的價值在於**逼人做決定**，不是機械驗證：'keep' 的那些都附了理由。
 */
const MOTION: Readonly<Record<string, readonly ['off' | 'keep', string]>> = {
  screenIn: ['off', '換頁淡入上滑'],
  fadein: ['off', 'overlay/toast 淡入'],
  sheetUp: ['off', '抽屜 30% 上滑＝前庭刺激源'],
  barGrow: ['off', '長條由底長出'],
  drawStroke: ['off', '描筆——關掉時必須另補 stroke-dashoffset:0，否則趨勢線與環圖永久空白'],
  spin: ['keep', '載入指示器凍住＝在說謊；14px 小圓不是前庭刺激源'],
};

describe('styles barrel（順序即契約）', () => {
  it('barrel 只准有 @import / 註解 / 空行——不准直接寫規則', () => {
    const stripped = barrelText.replace(/\/\*[\s\S]*?\*\//g, ''); // 去註解（含多行檔頭）
    for (const line of stripped.split('\n')) {
      const t = line.trim();
      if (t === '') continue;
      expect(t, `barrel 出現非 @import 的內容：${t}`).toMatch(/^@import '\.\/styles\/[^']+';$/);
    }
  });

  it('磁碟上的葉檔與 barrel 登記一一對應（無孤兒、無重複登記）', () => {
    expect([...imported].sort()).toEqual([...onDisk].sort());
    expect(new Set(imported).size, '同一葉檔被 import 兩次').toBe(imported.length);
  });

  it('每支葉檔都非空', () => {
    for (const name of onDisk) {
      const body = fs.readFileSync(path.join(LEAF_DIR, name), 'utf8');
      expect(body.trim().length, `${name} 是空的`).toBeGreaterThan(0);
    }
  });

  it('跨葉 cascade 依賴：覆蓋層一律晚於被覆蓋層（重排 @import 即 fail）', () => {
    for (const [later, earlier, why] of AFTER) {
      const li = imported.indexOf(later);
      const ei = imported.indexOf(earlier);
      expect(li, `barrel 未登記 ${later}`).toBeGreaterThanOrEqual(0);
      expect(ei, `barrel 未登記 ${earlier}`).toBeGreaterThanOrEqual(0);
      expect(li, `${later} 必須晚於 ${earlier}（${why}）`).toBeGreaterThan(ei);
    }
  });

  it('base.css 排第一（reset / @font-face / :root tokens 必須先於一切）', () => {
    expect(imported[0]).toBe('base.css');
  });

  it('每支 @keyframes 都對 prefers-reduced-motion 表態（新增動畫未表態即 fail）', () => {
    const names = new Set<string>();
    for (const name of onDisk) {
      const body = fs.readFileSync(path.join(LEAF_DIR, name), 'utf8');
      for (const m of body.matchAll(/@keyframes\s+([\w-]+)/g)) names.add(m[1]!);
    }
    expect([...names].sort(), '有動畫沒進 MOTION 決策表，或表裡有已刪除的動畫').toEqual(
      Object.keys(MOTION).sort(),
    );
  });

  it('motion.css 補回 stroke-dashoffset 終值（只寫 animation:none 會讓統計圖永久空白）', () => {
    const body = fs.readFileSync(path.join(LEAF_DIR, 'motion.css'), 'utf8');
    expect(body).toMatch(/stroke-dashoffset:\s*0/);
    // .spinner 刻意保留動畫——被加進**選擇器**就是有人沒讀那段註解（註解本身有提到它，先去掉）
    const rules = body.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\.spinner/);
  });

  /**
   * 已定高度的 column flex 容器，其直接子項一律不可收縮。
   * 這是本專案踩過**兩次**的坑：元素只要自身 overflow 不是 visible/clip，min-height:auto
   * 就解析為 0，於是它獨自吸收全部溢出量——而且吸完剛好不再溢出＝連捲軸都沒有。
   * `.day-group`（overflow:hidden 求圓角）把整份帳本壓成一排日期標題、
   * `.cat-scroller`（overflow-x:auto）把記帳抽屜的分類列壓成一條縫，都是它。
   */
  it('捲動容器的直接子項一律 flex 不可收縮（否則溢出會變成靜默刪內容）', () => {
    expect(leaf('nav.css'), '.screen-body > * 缺收縮通則').toMatch(
      /\.screen-body\s*>\s*\*\s*\{[^}]*flex:\s*0\s+0\s+auto/,
    );
    expect(leaf('entry.css'), '.sheet-scroll > * 缺收縮通則').toMatch(
      /\.sheet-scroll\s*>\s*\*\s*\{[^}]*flex-shrink:\s*0/,
    );
  });

  /**
   * overflow:hidden 會讓元素變成捲動容器（min-height:auto → 0）；純粹想裁圓角的一律用 clip。
   * 允許清單只收「本來就該是捲動/裁切容器」的那幾個。
   */
  it('overflow: hidden 要在允許清單內（想裁圓角請用 clip）', () => {
    const ALLOW = new Set(['.scan-viewport', '.note-chip', '.cat-name', '.legend-name', '.entry-title', '.entry-sub']);
    const bad: string[] = [];
    for (const name of onDisk) {
      const body = fs.readFileSync(path.join(LEAF_DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        if (!/overflow(-[xy])?:\s*hidden/.test(m[2]!)) continue;
        const sels = m[1]!.split(',').map((x) => x.trim().split(/\s+/).pop() ?? '');
        if (!sels.some((sel) => ALLOW.has(sel))) bad.push(`${name}: ${m[1]!.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /** text-size-adjust 會關掉 Android 使用者的系統字級縮放——一行就能廢掉他的協助工具設定 */
  it('禁止 text-size-adjust', () => {
    for (const name of onDisk) {
      expect(fs.readFileSync(path.join(LEAF_DIR, name), 'utf8'), `${name} 出現 text-size-adjust`)
        .not.toMatch(/text-size-adjust/);
    }
  });

  /** 觸控下限是**下限**不是尺寸：寫死 44px 在大字級下會讓放大的字畫到鈕外面 */
  it('觸控下限一律寫成 max(44px, …) 而非裸 44px', () => {
    const bad: string[] = [];
    for (const name of onDisk) {
      const body = fs.readFileSync(path.join(LEAF_DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const line of body.split('\n')) {
        if (/min-(width|height):\s*44px/.test(line)) bad.push(`${name}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * TSX 用到的 class 必須真的有人定義。
   * 這條會抓到 PersonSplit 那組 .split-row/.split-name/.split-amount——它們在任何葉檔都不存在，
   * 於是 svg 的 display:block 把「姓名｜長條｜金額」拆成三行堆疊，而且沒人發現過。
   */
  it('TSX 的 className 字面量都要在某支葉檔裡定義得到', () => {
    const SRC = path.join(DIR, '../src');
    const defined = new Set<string>();
    for (const name of onDisk) {
      const body = fs.readFileSync(path.join(LEAF_DIR, name), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of body.matchAll(/\.([a-z][\w-]*)/g)) defined.add(m[1]!);
    }
    /** 刻意無樣式的語意 class（給測試/查詢用），或由 JS 動態組出來的 */
    const ALLOW = new Set(['tnum']);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [path.join(dir, e.name)] : [],
      );
    const bad: string[] = [];
    for (const file of walk(SRC)) {
      const body = fs.readFileSync(file, 'utf8');
      // 只看純字面量的 className（含樣板字串裡的靜態片段），${} 的動態部分略過
      for (const m of body.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const raw = (m[1] ?? m[2] ?? '').replace(/\$\{[^}]*\}/g, ' ');
        for (const cls of raw.split(/\s+/).filter(Boolean)) {
          if (!defined.has(cls) && !ALLOW.has(cls)) bad.push(`${path.basename(file)}: .${cls}`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it('CSS 引用的站內資產必須存在於 public/（改副檔名或搬檔漏改一處=靜默退回，不會報錯）', () => {
    const PUBLIC = path.join(DIR, '../public');
    const missing: string[] = [];
    let checked = 0;
    for (const name of onDisk) {
      const body = fs.readFileSync(path.join(LEAF_DIR, name), 'utf8');
      for (const m of body.matchAll(/url\(['"]?(\/[^'")]+)['"]?\)/g)) {
        checked += 1;
        const rel = decodeURIComponent(m[1]!);
        if (!fs.existsSync(path.join(PUBLIC, rel))) missing.push(`${name}: ${rel}`);
      }
    }
    expect(checked, 'CSS 裡一個站內 url() 都沒掃到 ⇒ 這條測試等於沒在測').toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  /* ─────────────── 顏色 token（夜墨主題 BACKLOG #10 的地基） ─────────────── */

  /** 裸色值：#rgb / #rrggbb(aa) / rgb(a)() / hsl(a)()。transparent 與 currentColor 不算 */
  const BARE_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
  /** :root 定義的 token（base.css 是唯一的定義點） */
  const rootTokens = new Set(
    [...strip(leaf('base.css')).matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]!),
  );
  /**
   * 不在 base.css 定義、但確實有人餵值的 token：
   * --kb 由 keyboard.ts 於執行期寫入；--card-accent 與 --cat-color 由元件內聯注入。
   */
  const RUNTIME_TOKENS = new Set(['--kb', '--card-accent', '--cat-color']);

  it('葉檔不准出現裸色值——顏色一律住 base.css 的 :root', () => {
    // 收編前這裡有 46 處（其中 17 處藏在 box-shadow 裡）。夜墨主題換的是 :root 那一份，
    // 任何逃逸到葉檔的裸色都會在換主題時原地不動 ⇒ 那一塊區域直接瞎掉。
    const bad: string[] = [];
    for (const name of onDisk) {
      if (name === 'base.css') continue;
      strip(leaf(name))
        .split('\n')
        .forEach((line, i) => {
          if (BARE_COLOR.test(line)) bad.push(`${name}:${i + 1}  ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
    // 防真空：同一條正則套在 base.css 上必須大量命中，否則就是正則寫壞了而不是真的乾淨
    const inBase = strip(leaf('base.css')).split('\n').filter((l) => BARE_COLOR.test(l)).length;
    expect(inBase, '連 base.css 都掃不到裸色 ⇒ BARE_COLOR 正則壞了，上面那條等於沒在測').toBeGreaterThan(20);
  });

  it('每個 var(--x) 都要有定義（打錯字的 var 會靜靜地什麼都不畫）', () => {
    const bad: string[] = [];
    const check = (label: string, body: string): void => {
      for (const m of body.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const t = m[1]!;
        if (!rootTokens.has(t) && !RUNTIME_TOKENS.has(t)) bad.push(`${label}: ${t}`);
      }
    };
    for (const name of onDisk) check(name, strip(leaf(name)));
    const walkTs = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walkTs(path.join(dir, e.name))
          : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
      );
    for (const f of walkTs(path.join(DIR, '../src'))) check(path.basename(f), fs.readFileSync(f, 'utf8'));
    expect([...new Set(bad)]).toEqual([]);
  });

  it('沒有死 token——定義了卻沒人用的顏色會在夜墨那輪誤導人', () => {
    let all = '';
    for (const name of onDisk) all += strip(leaf(name));
    const walkTs = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walkTs(path.join(dir, e.name))
          : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [],
      );
    for (const f of walkTs(path.join(DIR, '../src'))) all += fs.readFileSync(f, 'utf8');
    const used = new Set([...all.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!));
    const dead = [...rootTokens].filter((t) => !used.has(t) && !RUNTIME_TOKENS.has(t));
    expect(dead).toEqual([]);
  });

  it('固定組 --fixed-* 不得被任何 [data-theme] 區塊覆寫（讀者是相機，不是人眼）', () => {
    // QR 的 quiet zone 與取景器疊在實時影像上——它們變深就是「掃不到」與「瞄不準」，
    // 是正確性不是品味。夜墨主題那輪加 :root[data-theme='ink'] 時，這條會擋住順手一起改。
    const bad: string[] = [];
    for (const name of onDisk) {
      const body = strip(leaf(name));
      for (const m of body.matchAll(/\[data-theme[^{]*\{([^}]*)\}/g)) {
        for (const t of m[1]!.matchAll(/(--fixed-[\w-]+)\s*:/g)) bad.push(`${name}: ${t[1]}`);
      }
    }
    expect(bad).toEqual([]);
    // 同時確認固定組真的存在——沒有它就沒東西可守
    expect([...rootTokens].filter((t) => t.startsWith('--fixed-')).length).toBeGreaterThan(0);
  });

  it('開機底色：index.html 與 manifest 必須等於 base.css 的 --bg / --text', () => {
    // 這三處在 CSS 載入**之前**就要生效，天生用不了 var()。漏改一處的症狀是
    // 「夜墨使用者開 app 先閃一下白紙」——上線後才看得到、而且只有第一秒。
    const tokenVal = (name: string): string =>
      new RegExp(`^\\s*${name}\\s*:\\s*([^;]+);`, 'm').exec(strip(leaf('base.css')))?.[1]?.trim() ?? '';
    const bg = tokenVal('--bg');
    const text = tokenVal('--text');
    expect(bg, '--bg 沒讀到').toMatch(/^#[0-9a-f]{6}$/i);
    expect(text, '--text 沒讀到').toMatch(/^#[0-9a-f]{6}$/i);

    const html = fs.readFileSync(path.join(DIR, '../index.html'), 'utf8');
    const themeColor = /<meta\s+name="theme-color"\s+content="([^"]+)"/.exec(html)?.[1];
    expect(themeColor?.toLowerCase(), 'index.html 的 theme-color').toBe(bg.toLowerCase());
    const boot = /body\s*\{[^}]*\}/.exec(html)?.[0] ?? '';
    expect(boot, '首漆內聯樣式沒找到 body 規則').toContain('background');
    expect(new RegExp(`background:\\s*${bg}\\b`, 'i').test(boot), `首漆 background 應為 ${bg}`).toBe(true);
    expect(new RegExp(`color:\\s*${text}\\b`, 'i').test(boot), `首漆 color 應為 ${text}`).toBe(true);

    const mani = JSON.parse(fs.readFileSync(path.join(DIR, '../public/manifest.webmanifest'), 'utf8')) as {
      background_color?: string;
      theme_color?: string;
    };
    expect(mani.background_color?.toLowerCase(), 'manifest background_color').toBe(bg.toLowerCase());
    expect(mani.theme_color?.toLowerCase(), 'manifest theme_color').toBe(bg.toLowerCase());
  });
});
