/**
 * 帳本 slice：records/categories/rules/budget 四張記憶體 Map + 月游標 + 記帳抽屜。
 *
 * 每次 mutation 的固定節奏：mint HLC 信封 → 寫穿 repo（失敗=errlog+toast，
 * 記憶體照樣前進——使用者輸入不可丟，下次同步/匯出仍帶著這筆）→ 換新 Map 觸發 render。
 * 墓碑（deleted:true）**留在 Map 裡**（merge/同步需要），UI 一律自行過濾。
 */
import type { StateCreator } from 'zustand';
import type { Budget, Category, ExpenseRecord, MerchantRule, PersonId } from '@zhangben/core';
import { monthOf } from '@zhangben/core';
import type { AppStore } from './appStore';
import * as repo from '../db/repo';
import { tickClock } from '../clock';
import { getDeviceId, uuidv7 } from '../ids';
import { logError } from '../errlog';
import { show } from '../notice';

export interface EntryDraft {
  /** null=新增；有值=編輯該筆 */
  readonly editingId: string | null;
  readonly amount: number | null;
  readonly date: string;
  readonly categoryId: string;
  readonly note: string;
  readonly merchantName: string;
  readonly paidBy: PersonId;
}

export interface EntryValues {
  readonly amount: number;
  readonly date: string;
  readonly categoryId: string;
  readonly note: string;
  readonly merchantName: string;
  readonly paidBy: PersonId;
}

export interface LedgerSlice {
  hydrated: boolean;
  records: Map<string, ExpenseRecord>;
  categories: Map<string, Category>;
  rules: Map<string, MerchantRule>;
  budget: Budget | null;
  monthCursor: string;
  entryDraft: EntryDraft | null;
  hydrate(): Promise<void>;
  setMonth(month: string): void;
  openEntry(init?: Partial<EntryDraft>): void;
  closeEntry(): void;
  /** 新增或更新（依 draft.editingId）；回傳寫入的記錄 id */
  saveEntry(values: EntryValues): string;
  deleteRecord(id: string): void;
  addCategory(name: string, glyph: string, color: string): void;
  updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'glyph' | 'color'>>): void;
  deleteCategory(id: string): void;
  /** 與相鄰分類交換 order（-1=往前、+1=往後） */
  moveCategory(id: string, dir: -1 | 1): void;
  setBudget(monthlyTotal: number, perCategory: Readonly<Record<string, number>>): void;
}

/** 今天（裝置當地）的 'YYYY-MM-DD'——UI 層唯一的「現在」來源，core 不取時間 */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 手動輸入的重複警告（同日同額同人；排除自己）。發票去重另走 invoice.number。 */
export function findDuplicate(
  records: ReadonlyMap<string, ExpenseRecord>,
  values: Pick<EntryValues, 'amount' | 'date' | 'paidBy'>,
  excludeId: string | null,
): ExpenseRecord | null {
  for (const r of records.values()) {
    if (r.deleted || r.id === excludeId) continue;
    if (r.date === values.date && r.amount === values.amount && r.paidBy === values.paidBy) return r;
  }
  return null;
}

function persist(p: Promise<void>, what: string): void {
  p.catch((err: unknown) => {
    logError(`${what}: ${String(err)}`);
    show('saveFailed');
  });
}

export const createLedgerSlice: StateCreator<AppStore, [], [], LedgerSlice> = (set, get) => ({
  hydrated: false,
  records: new Map(),
  categories: new Map(),
  rules: new Map(),
  budget: null,
  monthCursor: monthOf(todayISO()),
  entryDraft: null,

  async hydrate() {
    try {
      const loaded = await repo.loadAll();
      set({
        hydrated: true,
        records: loaded.records,
        categories: loaded.categories,
        rules: loaded.rules,
        budget: loaded.budget,
      });
    } catch (err) {
      // IDB 開不起來（隱私模式/損毀）：以空帳本+內建分類啟動，至少可看可記（不落盤）
      logError(`hydrate: ${String(err)}`);
      const { seedCategories } = await import('@zhangben/core');
      set({ hydrated: true, categories: seedCategories() });
      show('saveFailed');
    }
  },

  setMonth(month) {
    set({ monthCursor: month });
  },

  openEntry(init) {
    const s = get();
    const firstCat = [...s.categories.values()]
      .filter((c) => !c.deleted)
      .sort((a, b) => a.order - b.order)[0];
    set({
      entryDraft: {
        editingId: null,
        amount: null,
        date: todayISO(),
        categoryId: firstCat?.id ?? 'cat-misc',
        note: '',
        merchantName: '',
        paidBy: s.settings.myPerson,
        ...init,
      },
    });
  },

  closeEntry() {
    set({ entryDraft: null });
  },

  saveEntry(values) {
    const s = get();
    const draft = s.entryDraft;
    const existing = draft?.editingId ? s.records.get(draft.editingId) : undefined;
    // 店名編輯語意：清空店名時保留 sellerTaxId（發票記錄的商家識別不因改名消失）；
    // 兩者皆無 ⇒ 整個 merchant 欄位省略（exactOptionalPropertyTypes：不寫 undefined）
    const merchant = ((): ExpenseRecord['merchant'] => {
      const prev = existing?.merchant;
      if (values.merchantName) {
        return prev?.sellerTaxId
          ? { sellerTaxId: prev.sellerTaxId, name: values.merchantName }
          : { name: values.merchantName };
      }
      return prev?.sellerTaxId ? { sellerTaxId: prev.sellerTaxId } : undefined;
    })();
    const common = {
      amount: values.amount,
      date: values.date,
      categoryId: values.categoryId,
      note: values.note,
      paidBy: values.paidBy,
      updatedAt: tickClock(),
      deviceId: getDeviceId(),
      ...(merchant ? { merchant } : {}),
    };
    const row: ExpenseRecord = existing
      ? (() => {
          // 顯式剝掉舊 merchant：merchant=undefined 與「沒有 merchant 鍵」在
          // exactOptionalPropertyTypes 下是兩件事，spread 舊列會把舊店家帶回來
          const { merchant: _dropped, ...rest } = existing;
          void _dropped;
          return { ...rest, ...common };
        })()
      : {
          id: uuidv7(),
          deleted: false,
          source: 'manual',
          ...common,
        };
    const records = new Map(s.records);
    records.set(row.id, row);
    set({ records, entryDraft: null });
    persist(repo.putRecord(row), 'putRecord');
    return row.id;
  },

  deleteRecord(id) {
    const s = get();
    const existing = s.records.get(id);
    if (!existing || existing.deleted) return;
    const row: ExpenseRecord = { ...existing, deleted: true, updatedAt: tickClock(), deviceId: getDeviceId() };
    const records = new Map(s.records);
    records.set(id, row);
    set({ records, entryDraft: null });
    persist(repo.putRecord(row), 'putRecord(tombstone)');
  },

  addCategory(name, glyph, color) {
    const s = get();
    const maxOrder = Math.max(0, ...[...s.categories.values()].map((c) => c.order));
    const row: Category = {
      id: `cat-${uuidv7().slice(0, 8)}`,
      updatedAt: tickClock(),
      deviceId: getDeviceId(),
      deleted: false,
      name: name.trim().slice(0, 8),
      glyph: [...glyph.trim()][0] ?? '雜',
      color,
      order: maxOrder + 1,
      builtin: false,
    };
    const categories = new Map(s.categories);
    categories.set(row.id, row);
    set({ categories });
    persist(repo.putCategory(row), 'putCategory');
  },

  updateCategory(id, patch) {
    const s = get();
    const existing = s.categories.get(id);
    if (!existing) return;
    const row: Category = { ...existing, ...patch, updatedAt: tickClock(), deviceId: getDeviceId() };
    const categories = new Map(s.categories);
    categories.set(id, row);
    set({ categories });
    persist(repo.putCategory(row), 'putCategory');
  },

  deleteCategory(id) {
    const s = get();
    const existing = s.categories.get(id);
    if (!existing || existing.builtin) return; // 內建不可刪（UI 也鎖，這裡是第二道）
    const row: Category = { ...existing, deleted: true, updatedAt: tickClock(), deviceId: getDeviceId() };
    const categories = new Map(s.categories);
    categories.set(id, row);
    set({ categories });
    persist(repo.putCategory(row), 'putCategory(tombstone)');
  },

  setBudget(monthlyTotal, perCategory) {
    // 只留 >0 的分類上限（0=不設限=不佔鍵）
    const cleaned: Record<string, number> = {};
    for (const [k, v] of Object.entries(perCategory)) if (v > 0) cleaned[k] = v;
    const row = {
      id: 'budget',
      updatedAt: tickClock(),
      deviceId: getDeviceId(),
      deleted: false,
      monthlyTotal: Math.max(0, monthlyTotal),
      perCategory: cleaned,
    };
    set({ budget: row });
    persist(repo.putBudget(row), 'putBudget');
  },

  moveCategory(id, dir) {
    const s = get();
    const alive = [...s.categories.values()].filter((c) => !c.deleted).sort((a, b) => a.order - b.order);
    const idx = alive.findIndex((c) => c.id === id);
    const other = alive[idx + dir];
    const self = alive[idx];
    if (!self || !other) return;
    // 交換 order；兩筆都要 bump 信封（同步後對方才收斂到同一順序）
    const a: Category = { ...self, order: other.order, updatedAt: tickClock(), deviceId: getDeviceId() };
    const b: Category = { ...other, order: self.order, updatedAt: tickClock(), deviceId: getDeviceId() };
    const categories = new Map(s.categories);
    categories.set(a.id, a);
    categories.set(b.id, b);
    set({ categories });
    persist(repo.putCategory(a), 'putCategory(order)');
    persist(repo.putCategory(b), 'putCategory(order)');
  },
});
