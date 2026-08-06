/**
 * 進來的列長什麼樣才算數——**兩條入口共用的唯一一份**（檔案匯入 + P2P）。
 *
 * 為什麼要有這一層：`core/merge.ts` 的檔頭明說它只依賴「HLC 定寬 ⇒ 字串可比」
 * 這一條契約、對編碼零認知，驗證是**邊界**的事。檔案匯入一直有這道邊界
 * （原本就寫在 exportFile.ts），P2P 卻完全沒有——`protocol.ts` 收到 batch 就直送
 * `mergeAll`。差別的後果：一列 `updatedAt: 'zzz'` 字典序勝過所有真實 HLC
 * （真 HLC 一律以數字開頭），此後**任何**編輯都覆蓋不掉它；若它是墓碑，
 * 就是一筆永遠復活不了的記錄。
 *
 * 這份原封搬自 exportFile.ts，行為一位元未改（parseImport 的既有測試守著）。
 * 兩邊對「壞列」的處置**刻意不同**，見各自呼叫端的註解：
 * - 匯入：任一列不合格 ⇒ 整檔拒收（檔案是使用者主動挑的，寧可拒絕也不要半套）
 * - P2P：丟掉該列、其餘照收（整批失敗會讓一列壞資料把每天的同步永久卡死）
 */
import { isValidISODate } from '@zhangben/core';
import type { SyncKind } from './protocol';

/** 只認 hlcEncode 的正準形（含小寫 hex）；也封死 'zzz' 字典序永勝的偽造值 */
const HLC_SHAPE = /^\d{15}-[0-9a-f]{4}-.+$/;

function envelopeOk(r: unknown): r is Record<string, unknown> {
  if (typeof r !== 'object' || r === null) return false;
  const e = r as Record<string, unknown>;
  return (
    typeof e['id'] === 'string' &&
    e['id'] !== '' &&
    typeof e['updatedAt'] === 'string' &&
    HLC_SHAPE.test(e['updatedAt']) &&
    typeof e['deviceId'] === 'string' &&
    typeof e['deleted'] === 'boolean'
  );
}

export function recordOk(r: unknown): boolean {
  if (!envelopeOk(r)) return false;
  const inv = r['invoice'];
  return (
    Number.isInteger(r['amount']) &&
    typeof r['date'] === 'string' &&
    isValidISODate(r['date']) &&
    typeof r['categoryId'] === 'string' &&
    typeof r['note'] === 'string' &&
    typeof r['paidBy'] === 'string' &&
    r['paidBy'] !== '' &&
    (r['source'] === 'manual' || r['source'] === 'einvoice') &&
    (inv === undefined ||
      (typeof inv === 'object' && inv !== null &&
        typeof (inv as Record<string, unknown>)['number'] === 'string' &&
        typeof (inv as Record<string, unknown>)['randomCode'] === 'string'))
  );
}

export function categoryOk(r: unknown): boolean {
  return (
    envelopeOk(r) &&
    typeof r['name'] === 'string' &&
    typeof r['glyph'] === 'string' &&
    typeof r['color'] === 'string' &&
    typeof r['order'] === 'number' &&
    typeof r['builtin'] === 'boolean'
  );
}

export function ruleOk(r: unknown): boolean {
  return envelopeOk(r) && typeof r['categoryId'] === 'string' && typeof r['displayName'] === 'string';
}

export function personOk(r: unknown): boolean {
  return envelopeOk(r) && typeof r['name'] === 'string' && r['name'] !== '';
}

export function budgetOk(r: unknown): boolean {
  return (
    envelopeOk(r) &&
    typeof r['monthlyTotal'] === 'number' &&
    typeof r['perCategory'] === 'object' &&
    r['perCategory'] !== null
  );
}

/** kind → 驗證器（P2P 用；Record 而非 switch，漏一個 kind 由型別檢查抓） */
export const ROW_OK: Readonly<Record<SyncKind, (r: unknown) => boolean>> = {
  persons: personOk,
  records: recordOk,
  categories: categoryOk,
  rules: ruleOk,
  budget: budgetOk,
};
