/**
 * 分類管理：排序（▲▼ 交換——比拖曳簡單且鍵盤可達）、自訂分類增/改/刪、內建鎖刪除、
 * 已學習的商家規則清單（改派分類/刪除）。
 */
import { useEffect, useRef, useState } from 'react';
import { sortCategories } from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from './ConfirmDialog';
import { CategorySeal } from './LedgerScreen';
import { CATEGORIES, RULES } from '../strings/ui';

/**
 * 分類色票——**值定案才寫**，拖曳期間只動本地 state。
 *
 * React 的 onChange 綁的是原生 `input` 事件，色輪拖曳期間每一幀都觸發；直通
 * updateCategory 的話，調一次顏色可以 mint 上百個新 HLC 信封 + 上百次 IDB 寫入，
 * 下次同步全部送給對方。設定頁的改名卡早就是這道紀律（每鍵 commit 會灌爆同步），
 * 這個控制項漏了。
 *
 * 用原生 `change` 而不是 React 的 onChange：對 <input type="color"> 而言，
 * `change` 才是「關掉色輪、值定案」那一下。onBlur 是備援（某些平台關閉選色器
 * 後才失焦），兩邊都用 !== 守著所以不會重複寫。
 */
function CatColorInput({ id, name, color }: { id: string; name: string; color: string }) {
  const updateCategory = useAppStore((s) => s.updateCategory);
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(color);
  // 外部改動（同步收到對方改色）要跟上
  useEffect(() => setDraft(color), [color]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const commit = (): void => {
      if (el.value !== color) updateCategory(id, { color: el.value });
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [id, color, updateCategory]);
  return (
    <input
      ref={ref}
      type="color"
      className="cat-color-input"
      value={draft}
      aria-label={`${name} 顏色`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== color) updateCategory(id, { color: draft });
      }}
    />
  );
}

function RulesCard() {
  const rules = useAppStore((s) => s.rules);
  const categories = useAppStore((s) => s.categories);
  const upsertRule = useAppStore((s) => s.upsertRule);
  const deleteRule = useAppStore((s) => s.deleteRule);
  const alive = [...rules.values()].filter((r) => !r.deleted);
  const cats = sortCategories(categories.values());
  return (
    <div className="paper-card">
      <div className="field-label">{RULES.title}</div>
      {alive.length === 0 ? (
        <p className="dim-text">{RULES.empty}</p>
      ) : (
        alive.map((r) => (
          <div key={r.id} className="cat-row stacked">
            <span className="cat-name">
              {r.displayName || <span className="tnum">統編 {r.id}</span>}
            </span>
            <select
              className="text-input rule-select"
              value={r.categoryId}
              onChange={(e) => upsertRule(r.id, e.target.value, r.displayName)}
            >
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.glyph} {c.name}
                </option>
              ))}
            </select>
            <button className="ghost-btn cat-tool danger-ghost" onClick={() => deleteRule(r.id)}>
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  );
}

export function CategoriesScreen() {
  const categories = useAppStore((s) => s.categories);
  const addCategory = useAppStore((s) => s.addCategory);
  const deleteCategory = useAppStore((s) => s.deleteCategory);
  const moveCategory = useAppStore((s) => s.moveCategory);

  const [name, setName] = useState('');
  const [glyph, setGlyph] = useState('');
  const [color, setColor] = useState('#b3502d');
  const [deleting, setDeleting] = useState<string | null>(null);

  const cats = sortCategories(categories.values());

  return (
    <div className="screen-body">
      <div className="paper-card">
        {cats.map((c, i) => (
          <div key={c.id} className="cat-row stacked">
            <CategorySeal glyph={c.glyph} color={c.color} />
            <span className="cat-name">{c.name}</span>
            {c.builtin && <span className="cat-lock">{CATEGORIES.builtinLock}</span>}
            <span className="cat-tools">
              <CatColorInput id={c.id} name={c.name} color={c.color} />
              <button
                className="ghost-btn cat-tool"
                aria-label={CATEGORIES.moveUp}
                disabled={i === 0}
                onClick={() => moveCategory(c.id, -1)}
              >
                ▲
              </button>
              <button
                className="ghost-btn cat-tool"
                aria-label={CATEGORIES.moveDown}
                disabled={i === cats.length - 1}
                onClick={() => moveCategory(c.id, 1)}
              >
                ▼
              </button>
              {!c.builtin && (
                <button className="ghost-btn cat-tool danger-ghost" onClick={() => setDeleting(c.id)}>
                  ✕
                </button>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="paper-card">
        <div className="sheet-title">
          <span className="seal-char">{CATEGORIES.addTitle.slice(0, 1)}</span>
          {CATEGORIES.addTitle.slice(1)}
        </div>
        <div className="cat-add-row">
          <input
            className="text-input cat-glyph-input"
            value={glyph}
            placeholder={CATEGORIES.glyphPlaceholder}
            maxLength={2}
            onChange={(e) => setGlyph(e.target.value)}
          />
          <input
            className="text-input"
            value={name}
            placeholder={CATEGORIES.namePlaceholder}
            maxLength={4}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="color"
            className="cat-color-input"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
          <button
            className="primary-btn"
            disabled={!name.trim() || ![...glyph.trim()].length}
            onClick={() => {
              addCategory(name, glyph, color);
              setName('');
              setGlyph('');
            }}
          >
            {CATEGORIES.add}
          </button>
        </div>
      </div>

      <RulesCard />

      {deleting && (
        <ConfirmDialog
          title={CATEGORIES.deleteTitle}
          body={CATEGORIES.deleteBody}
          confirmLabel={CATEGORIES.deleteConfirm}
          danger
          onConfirm={() => {
            deleteCategory(deleting);
            setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
