/**
 * 分類管理：排序（▲▼ 交換——比拖曳簡單且鍵盤可達）、自訂分類增/改/刪、內建鎖刪除。
 * M3 後追加：已學習的商家規則清單（改派/刪除）。
 */
import { useState } from 'react';
import { sortCategories } from '@zhangben/core';
import { useAppStore } from '../store/appStore';
import { ConfirmDialog } from './ConfirmDialog';
import { CategorySeal } from './LedgerScreen';
import { CATEGORIES } from '../strings/ui';

export function CategoriesScreen() {
  const categories = useAppStore((s) => s.categories);
  const addCategory = useAppStore((s) => s.addCategory);
  const updateCategory = useAppStore((s) => s.updateCategory);
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
          <div key={c.id} className="cat-row">
            <CategorySeal glyph={c.glyph} color={c.color} />
            <span className="cat-name">{c.name}</span>
            {c.builtin && <span className="cat-lock">{CATEGORIES.builtinLock}</span>}
            <span className="cat-tools">
              <input
                type="color"
                className="cat-color-input"
                value={c.color}
                aria-label={`${c.name} 顏色`}
                onChange={(e) => updateCategory(c.id, { color: e.target.value })}
              />
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
            maxLength={8}
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
