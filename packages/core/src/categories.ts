/**
 * 內建分類 seed 與商家規則查詢。
 *
 * **刻意重複**：HLC_ZERO 的字面值在本檔寫死，不從 hlc.ts import。
 * seed 的 `updatedAt` 是「任何真實編輯都必勝」的 HLC 最小值——雙機各自
 * seed 出**位元完全相同**的八筆分類後靠 LWW 收斂，這個字串跨版本差一位
 * 就會讓兩台裝置的內建分類互相蓋寫。位元穩定比 DRY 重要：即使 hlc.ts
 * 未來改編碼，舊帳本裡既存的 seed 字串也絕不能跟著動。
 */
import type { Category, MerchantRule } from './types';

/** HLC 最小值（刻意與 hlc.ts 重複，理由見檔頭） */
const HLC_ZERO = '000000000000000-0000-0';

/**
 * 組一筆內建分類。deviceId='seed' 讓兩台裝置產出的信封連 tie-break
 * 欄位都相同——HLC 平手時 LWW 不會因裝置別而抖動。逐筆 freeze：
 * BUILTIN_CATEGORIES 是模組級共享單例，任何呼叫端的意外變異都會
 * 污染全 app（改分類請走 store 的複製寫入，不是改 seed）。
 */
function builtin(id: string, glyph: string, name: string, color: string, order: number): Category {
  return Object.freeze({
    id,
    updatedAt: HLC_ZERO,
    deviceId: 'seed',
    deleted: false,
    name,
    glyph,
    color,
    order,
    builtin: true,
  });
}

/** 內建八分類。id 跨裝置固定=LWW 自動收斂的前提（見 types.ts Category 註解）。 */
export const BUILTIN_CATEGORIES: readonly Category[] = Object.freeze([
  builtin('cat-food', '食', '餐飲', '#b3502d', 1),
  builtin('cat-transport', '行', '交通', '#3d6b8e', 2),
  builtin('cat-home', '居', '居家', '#8a6a2f', 3),
  builtin('cat-clothes', '衣', '服飾', '#7d5a8e', 4),
  builtin('cat-med', '醫', '醫療', '#2e7d64', 5),
  builtin('cat-fun', '樂', '娛樂', '#c2762b', 6),
  builtin('cat-edu', '學', '教育', '#4a6b3a', 7),
  builtin('cat-misc', '雜', '其他', '#6e6046', 8),
]);

/**
 * 產生 id→Category 的全新 Map（淺複製：Map 是新的，值共享 frozen 單例）。
 * 每次呼叫都回新 Map——呼叫端（store）會直接在上面增刪自訂分類，
 * 若共享同一個 Map，兩份帳本狀態就會互相污染。值不深複製，因為
 * Category 唯讀且已凍結，共享是安全的。
 */
export function seedCategories(): Map<string, Category> {
  return new Map(BUILTIN_CATEGORIES.map((c) => [c.id, c]));
}

/**
 * 顯示排序：order 升冪、同 order 以 name 決勝；排除墓碑。
 * - 排序是顯示層取分類清單的唯一入口，「已刪不出現」在這裡一次做完，
 *   免得每個畫面各自記得過濾墓碑。
 * - name 明訂 'zh-Hant' locale 而非裝置預設：同一份帳本在兩台手機上
 *   的排序必須位元一致，不能隨系統語言漂移。
 * - Array.prototype.sort 自 ES2019 保證穩定，故 (order, name) 全同時
 *   保持輸入相對順序——這讓排序結果對輸入順序決定論。
 */
export function sortCategories(cats: Iterable<Category>): Category[] {
  return [...cats]
    .filter((c) => !c.deleted)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-Hant'));
}

/**
 * 以賣方統編查商家規則（掃描學習迴圈的讀端）。
 * 回傳整條規則而非只有 categoryId：呼叫端還需要 displayName 填商家名。
 * 已刪規則視同不存在——墓碑只為同步存活，不該再影響分類建議；
 * 統編 undefined（手動記帳、掃描缺欄）自然無從建議。
 */
export function suggestCategory(
  rules: ReadonlyMap<string, MerchantRule>,
  sellerTaxId: string | undefined,
): MerchantRule | null {
  if (sellerTaxId === undefined) return null;
  const rule = rules.get(sellerTaxId);
  return rule === undefined || rule.deleted ? null : rule;
}
