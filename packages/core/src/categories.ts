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
 * 顯示排序：order 升冪 → name 逐碼位 → id 決勝；排除墓碑。
 * - 排序是顯示層取分類清單的唯一入口，「已刪不出現」在這裡一次做完，
 *   免得每個畫面各自記得過濾墓碑。
 * - **決勝一路到 id**（審查修正）：撞號是常態而非例外——兩台裝置各自新增分類時
 *   都算出同一個 maxOrder+1。決勝不到底的話，剩下的順序就落在 Array.sort 的
 *   穩定性上，也就是**輸入順序**；而輸入是 store 的 Map.values()，插入序由
 *   「同步收到的先後」決定 ⇒ 兩機的分類頁可以永久不一致。id 是全域唯一的，
 *   比到它就是全序。（原註解說穩定性讓結果「對輸入順序決定論」，因果講反了：
 *   穩定性正是讓結果**相依於**輸入順序。）
 * - **不用 localeCompare**：hlc.ts 的檔頭已經寫死這條 core 鐵律——它隨執行環境
 *   的 locale 與 ICU/CLDR 資料變化（small-icu 的 Node 會退回 root collation），
 *   非決定論。逐碼位比較換來的是「同 order 時的中文排序不照筆畫」，
 *   而 order 本來就是使用者自己排的，這個位置的字典序沒有語意。
 */
export function sortCategories(cats: Iterable<Category>): Category[] {
  return [...cats]
    .filter((c) => !c.deleted)
    .sort((a, b) => a.order - b.order || cmpStr(a.name, b.name) || cmpStr(a.id, b.id));
}

/** 逐碼位比較（與 hlcCompare 同源的理由：決定論優先於地區慣例） */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
