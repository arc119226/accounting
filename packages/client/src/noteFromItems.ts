/**
 * 品項 → 備註（「鮮乳、蛋…等5項」）。
 *
 * core 的 digestItems 只回 names/total，文案在這裡組——core 不放顯示字。
 * 為什麼要有這個：掃發票入帳時備註是空的，帳本清單於是只剩店名（沒學過規則的店家連
 * 店名都沒有），一個月後回頭看那筆 $437 完全想不起買了什麼。
 */
import { digestItems, type InvoiceItem } from '@zhangben/core';
import { ITEMNOTE } from './strings/ui';

/** 備註欄的 maxLength（EntrySheet 與掃描預覽都是 40） */
const NOTE_MAX = 40;
/** 只列前三個：帳本清單那行放得下的長度，多了反而看不出重點 */
const MAX_NAMES = 3;
/** 單一品名上限——發票品名常帶規格尾巴（「鮮乳 936ml」） */
const MAX_NAME_CHARS = 6;

export function noteFromItems(items: readonly InvoiceItem[] | undefined): string {
  if (!items || items.length === 0) return '';
  const d = digestItems(items, MAX_NAMES, MAX_NAME_CHARS);
  if (d.names.length === 0) return '';
  const head = d.names.join(ITEMNOTE.sep);
  const note =
    d.total > d.names.length ? `${head}${ITEMNOTE.etcPrefix}${d.total}${ITEMNOTE.etcSuffix}` : head;
  // 截在最後：品名可能含 surrogate pair，逐 code point 切
  return [...note].slice(0, NOTE_MAX).join('');
}
