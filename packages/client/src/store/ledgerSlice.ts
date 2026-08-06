/**
 * 帳本 slice：records/categories/rules/budget 四張記憶體 Map + 月游標 + 記帳抽屜。
 *
 * 每次 mutation 的固定節奏：mint HLC 信封 → 寫穿 repo（失敗=errlog+toast，
 * 記憶體照樣前進——使用者輸入不可丟，下次同步/匯出仍帶著這筆）→ 換新 Map 觸發 render。
 * 墓碑（deleted:true）**留在 Map 裡**（merge/同步需要），UI 一律自行過濾。
 */
import type { StateCreator } from 'zustand';
import type { Budget, Category, ExpenseRecord, MerchantRule, ParsedInvoice, Person } from '@zhangben/core';
import { monthOf, restoreRecord as coreRestoreRecord } from '@zhangben/core';
import type { AppStore } from './appStore';
import * as repo from '../db/repo';
import { seedClock, tickClock } from '../clock';
import { getDeviceId, getPersonId, uuidv7 } from '../ids';
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
  /** Person.id（v2） */
  readonly paidBy: string;
}

/**
 * 記錄 → 抽屜草稿。三處（帳本列、統計的分類明細、掃描的「查看該筆」）本來各抄一份，
 * 月結摘要卡會是第四份——抄第四次前先抽出來。
 */
export function draftFromRecord(r: ExpenseRecord): EntryDraft {
  return {
    editingId: r.id,
    amount: r.amount,
    date: r.date,
    categoryId: r.categoryId,
    note: r.note,
    merchantName: r.merchant?.name ?? '',
    paidBy: r.paidBy,
  };
}

export interface EntryValues {
  readonly amount: number;
  readonly date: string;
  readonly categoryId: string;
  readonly note: string;
  readonly merchantName: string;
  readonly paidBy: string;
}

export interface LedgerSlice {
  hydrated: boolean;
  /**
   * hydrate 走了 catch（IDB 開不起來）⇒ 記憶體是**空帳本**而不是「真的沒帳」。
   * 與 hydrated 分開一個旗標的理由：hydrated 同時是 UI 的渲染閘（NameGate/SyncScreen），
   * 失敗時不能不設；但同步**絕不可以**在這個狀態下入房——空帳本握手會把 checkpoint
   * 推到頂，這台的整本帳從此不再增量傳給對方（見 syncSlice.begin）。
   */
  hydrateFailed: boolean;
  records: Map<string, ExpenseRecord>;
  categories: Map<string, Category>;
  rules: Map<string, MerchantRule>;
  persons: Map<string, Person>;
  budget: Budget | null;
  monthCursor: string;
  entryDraft: EntryDraft | null;
  hydrate(): Promise<void>;
  /** 改「自己的」名字（唯一的人物編輯入口；別人的 row 沒有任何寫路徑） */
  renameMyPerson(name: string): void;
  setMonth(month: string): void;
  openEntry(init?: Partial<EntryDraft>): void;
  closeEntry(): void;
  /**
   * 新增或更新（依 draft.editingId）；回傳寫入的記錄 id。
   * keepOpen：存完後續留抽屜（連續記帳），只在新增模式生效。
   */
  saveEntry(values: EntryValues, keepOpen?: boolean): string;
  /** 刪除（寫墓碑）；回傳**剝號前**的完整原列供復原，不存在/已刪則 null */
  deleteRecord(id: string): ExpenseRecord | null;
  /** 復原墓碑：整列寫回、換新信封（LWW 天然贏過墓碑，跨裝置也成立） */
  restoreRecord(row: ExpenseRecord): void;
  addCategory(name: string, glyph: string, color: string): void;
  updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'glyph' | 'color'>>): void;
  deleteCategory(id: string): void;
  /** 與相鄰分類交換 order（-1=往前、+1=往後） */
  moveCategory(id: string, dir: -1 | 1): void;
  setBudget(monthlyTotal: number, perCategory: Readonly<Record<string, number>>): void;
  /**
   * 掃描入帳：寫記錄 + 商家規則學習（一人歸類、兩機受益——規則會同步）。
   * 回傳**擋下這次入帳的既存記錄**；null = 真的寫進去了。
   * 有回傳值的呼叫端絕不可宣告「已記一筆」——預覽卡開著時背景同步可能剛收進
   * 對方掃的同一張，那使用者剛調的金額/分類/付款人全部丟失，卻以為存好了。
   */
  saveScanned(input: {
    readonly inv: ParsedInvoice;
    readonly amount: number;
    readonly date: string;
    readonly categoryId: string;
    readonly note: string;
    readonly merchantName: string;
    readonly paidBy: string;
  }): ExpenseRecord | null;
  upsertRule(sellerTaxId: string, categoryId: string, displayName: string): void;
  deleteRule(id: string): void;
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
  hydrateFailed: false,
  records: new Map(),
  categories: new Map(),
  rules: new Map(),
  persons: new Map(),
  budget: null,
  monthCursor: monthOf(todayISO()),
  entryDraft: null,

  async hydrate() {
    try {
      const loaded = await repo.loadAll();
      // 種回時鐘（審查修正）：localStorage 的 HLC 可能寫失敗（隱私模式/配額滿），
      // 牆鐘又可能被回撥——以帳本內最大 updatedAt 種回，保證後續 mint 嚴格大於
      // 一切既存時間戳，單機單調性不再依賴 localStorage 可寫。
      // **persons 一定要在裡面**：漏掉的話，帳本裡最新的一筆若是人物 row（對方剛改過名），
      // 種回值就低於它 ⇒ 之後 renameMyPerson mint 的 HLC 更小 ⇒ 下次同步 LWW 判 keep-local，
      // 自己的新名字被對方那份舊的無聲蓋回去。（syncSlice 的匯入路徑一直是完整的，這裡漏了。）
      let maxHlc = '';
      const all: Iterable<{ updatedAt: string }>[] = [
        loaded.records.values(),
        loaded.categories.values(),
        loaded.rules.values(),
        loaded.persons.values(),
        loaded.budget ? [loaded.budget] : [],
      ];
      for (const it of all) for (const r of it) if (r.updatedAt > maxHlc) maxHlc = r.updatedAt;
      if (maxHlc) seedClock(maxHlc);
      // 確保「我」的 Person row 存在（首啟/清空後）：預設名「我」，取名卡/設定頁改。
      // **排在 seedClock 之後**：這裡 mint 的信封必須大於帳本裡的一切，否則新種的
      // 人物 row 一同步就輸給對方那邊既有的同 id 舊列。
      let persons = loaded.persons;
      const myId = getPersonId();
      if (!persons.has(myId)) {
        const me: Person = {
          id: myId,
          updatedAt: tickClock(),
          deviceId: getDeviceId(),
          deleted: false,
          name: '我',
        };
        persons = new Map(persons);
        persons.set(myId, me);
        persist(repo.putPerson(me), 'putPerson(seed)');
      }
      set({
        hydrated: true,
        records: loaded.records,
        categories: loaded.categories,
        rules: loaded.rules,
        persons,
        budget: loaded.budget,
      });
    } catch (err) {
      // IDB 開不起來（隱私模式/損毀）：以空帳本+內建分類啟動，至少可看可記（不落盤）。
      // hydrateFailed 讓同步認得出「這是空的，不是真的沒帳」——見該欄位的註解。
      logError(`hydrate: ${String(err)}`);
      const { seedCategories } = await import('@zhangben/core');
      set({ hydrated: true, hydrateFailed: true, categories: seedCategories() });
      show('saveFailed');
    }
  },

  renameMyPerson(name) {
    const s = get();
    const myId = getPersonId();
    const existing = s.persons.get(myId);
    const clean = name.trim().slice(0, 8);
    if (!clean || clean === existing?.name) return;
    const row: Person = {
      id: myId,
      updatedAt: tickClock(),
      deviceId: getDeviceId(),
      deleted: false,
      name: clean,
    };
    const persons = new Map(s.persons);
    persons.set(myId, row);
    set({ persons });
    persist(repo.putPerson(row), 'putPerson');
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
        paidBy: getPersonId(),
        ...init,
      },
    });
  },

  closeEntry() {
    set({ entryDraft: null });
  },

  saveEntry(values, keepOpen) {
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
    // keepOpen（連續記帳）：留一份新 draft 而不是 null——entryDraft 始終非 null ⇒
    // App 的 entryOpen 不翻轉 ⇒ 不重繪 ⇒ key 不重算 ⇒ 抽屜不重掛（元件的本地 state
    // 自己清，見 EntrySheet）。只在新增模式生效：編輯完就該關。
    const nextDraft: EntryDraft | null =
      keepOpen && !existing
        ? {
            editingId: null,
            amount: null,
            date: values.date,
            categoryId: values.categoryId,
            note: '',
            merchantName: '',
            paidBy: values.paidBy,
          }
        : null;
    set({ records, entryDraft: nextDraft });
    persist(repo.putRecord(row), 'putRecord');
    return row.id;
  },

  deleteRecord(id) {
    const s = get();
    const existing = s.records.get(id);
    if (!existing || existing.deleted) return null;
    // 墓碑必須剝除 invoice（審查修正）：留著號碼會佔住 by-invoice unique index——
    // 重掃同張發票會被落盤拒絕、同步收到對方同號活記錄時整批 tx 炸掉
    const { invoice: _dropped, ...rest } = existing;
    void _dropped;
    const row: ExpenseRecord = { ...rest, deleted: true, updatedAt: tickClock(), deviceId: getDeviceId() };
    const records = new Map(s.records);
    records.set(id, row);
    set({ records, entryDraft: null });
    persist(repo.putRecord(row), 'putRecord(tombstone)');
    // 回傳**剝號前**的完整原列，供復原 toast——這是唯一還拿得到 invoice/items 的時機
    return existing;
  },

  restoreRecord(row) {
    const s = get();
    const restored = coreRestoreRecord(s.records, row, {
      updatedAt: tickClock(),
      deviceId: getDeviceId(),
    });
    const records = new Map(s.records);
    records.set(restored.id, restored);
    set({ records });
    persist(repo.putRecord(restored), 'putRecord(restore)');
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

  saveScanned(input) {
    const s = get();
    // 最後一道去重閘（UI 已擋；並發掃同一張的窗口期防線）。
    // 回傳擋路的那筆而不是靜默 return：呼叫端才有辦法把「已經記過」講出來
    for (const r of s.records.values()) {
      if (r.invoice?.number === input.inv.number && !r.deleted) return r;
    }
    const row: ExpenseRecord = {
      id: uuidv7(),
      updatedAt: tickClock(),
      deviceId: getDeviceId(),
      deleted: false,
      source: 'einvoice',
      amount: input.amount,
      date: input.date,
      categoryId: input.categoryId,
      note: input.note,
      paidBy: input.paidBy,
      invoice: { number: input.inv.number, randomCode: input.inv.randomCode },
      merchant: {
        sellerTaxId: input.inv.sellerTaxId,
        ...(input.merchantName ? { name: input.merchantName } : {}),
      },
      ...(input.inv.items.length > 0 ? { items: input.inv.items } : {}),
    };
    const records = new Map(s.records);
    records.set(row.id, row);
    set({ records });
    persist(repo.putRecord(row), 'putRecord(scan)');
    // 學習迴圈：分類異動∨規則缺∨新命名 才寫（避免無意義的信封 bump 造成同步噪音）
    const rule = s.rules.get(input.inv.sellerTaxId);
    const nameChanged = input.merchantName !== '' && rule?.displayName !== input.merchantName;
    if (!rule || rule.deleted || rule.categoryId !== input.categoryId || nameChanged) {
      get().upsertRule(
        input.inv.sellerTaxId,
        input.categoryId,
        input.merchantName || rule?.displayName || '',
      );
    }
    return null;
  },

  upsertRule(sellerTaxId, categoryId, displayName) {
    const s = get();
    const row: MerchantRule = {
      id: sellerTaxId,
      updatedAt: tickClock(),
      deviceId: getDeviceId(),
      deleted: false,
      categoryId,
      displayName: displayName.trim().slice(0, 20),
    };
    const rules = new Map(s.rules);
    rules.set(row.id, row);
    set({ rules });
    persist(repo.putRule(row), 'putRule');
  },

  deleteRule(id) {
    const s = get();
    const existing = s.rules.get(id);
    if (!existing || existing.deleted) return;
    const row: MerchantRule = { ...existing, deleted: true, updatedAt: tickClock(), deviceId: getDeviceId() };
    const rules = new Map(s.rules);
    rules.set(id, row);
    set({ rules });
    persist(repo.putRule(row), 'putRule(tombstone)');
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
