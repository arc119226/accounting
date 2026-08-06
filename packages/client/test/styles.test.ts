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
/** 後者在 import 順序中必須晚於前者（同特異性時 source order 決勝） */
const AFTER: readonly (readonly [string, string, string])[] = [
  ['components.css', 'base.css', '元件依賴 base 的 tokens/@font-face 宣告'],
  ['ledger.css', 'components.css', '.cat-seal 覆蓋 .seal-char、.month-banner 覆蓋 .scroll-banner'],
  ['entry.css', 'components.css', '.cat-scroller .paper-label 尺寸覆蓋、.sheet-actions 覆蓋 .modal-actions'],
  ['dialogs.css', 'components.css', 'modal 內按鈕間距/覆蓋晚於元件定義'],
  ['toast.css', 'components.css', 'toast 內按鈕樣式晚於元件定義'],
  ['nav.css', 'components.css', 'nav 的 .screen 版面補充晚於元件定義'],
];

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
});
