/**
 * 檔案備份（同步的保底路徑）：匯出完整帳本 JSON、匯入走**同一個**
 * repo.applyIncoming 合併路徑——全 app 只有一份合併實作，匯入=很慢的同步。
 */
import { isValidISODate, type Budget, type Category, type ExpenseRecord, type MerchantRule, type Person } from '@zhangben/core';

export interface ExportEnvelope {
  /** v2：人物 UUID 化（paidBy=Person.id、含 persons 陣列）。v1 備份不再接受（資料清空重來）。 */
  readonly v: 2;
  readonly app: 'zhangben';
  readonly exportedAt: string;
  readonly deviceId: string;
  readonly records: readonly ExpenseRecord[];
  readonly categories: readonly Category[];
  readonly rules: readonly MerchantRule[];
  readonly persons: readonly Person[];
  readonly budget: Budget | null;
}

export function buildExport(input: {
  deviceId: string;
  records: Iterable<ExpenseRecord>;
  categories: Iterable<Category>;
  rules: Iterable<MerchantRule>;
  persons: Iterable<Person>;
  budget: Budget | null;
}): ExportEnvelope {
  return {
    v: 2,
    app: 'zhangben',
    exportedAt: new Date().toISOString(),
    deviceId: input.deviceId,
    records: [...input.records],
    categories: [...input.categories],
    rules: [...input.rules],
    persons: [...input.persons],
    budget: input.budget,
  };
}

/** 觸發下載（檔名帶日期，好找） */
export function downloadExport(env: ExportEnvelope): void {
  const blob = new Blob([JSON.stringify(env)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zhangben-backup-${env.exportedAt.slice(0, 10)}.json`;
  a.click();
  // revoke 延後：Safari 立刻 revoke 會取消下載
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 匯入驗證（審查修正 #15）：逐類別驗欄位——毒列一旦落盤，起始畫面每次啟動都會炸。
 * updatedAt 驗 HLC 正準形（也封死 'zzz' 字典序永勝的偽造值）。
 * buildExport 完全掌控合法格式，嚴格驗證不會誤拒真備份；任一列不合格=整檔拒收。
 */
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

function recordOk(r: unknown): boolean {
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

function categoryOk(r: unknown): boolean {
  return (
    envelopeOk(r) &&
    typeof r['name'] === 'string' &&
    typeof r['glyph'] === 'string' &&
    typeof r['color'] === 'string' &&
    typeof r['order'] === 'number' &&
    typeof r['builtin'] === 'boolean'
  );
}

function ruleOk(r: unknown): boolean {
  return envelopeOk(r) && typeof r['categoryId'] === 'string' && typeof r['displayName'] === 'string';
}

function personOk(r: unknown): boolean {
  return envelopeOk(r) && typeof r['name'] === 'string' && r['name'] !== '';
}

function budgetOk(r: unknown): boolean {
  return (
    envelopeOk(r) &&
    typeof r['monthlyTotal'] === 'number' &&
    typeof r['perCategory'] === 'object' &&
    r['perCategory'] !== null
  );
}

export function parseImport(text: string): { ok: true; env: ExportEnvelope } | { ok: false } {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return { ok: false };
    const o = raw as Record<string, unknown>;
    if (o['v'] !== 2 || o['app'] !== 'zhangben') return { ok: false };
    if (
      !Array.isArray(o['records']) ||
      !Array.isArray(o['categories']) ||
      !Array.isArray(o['rules']) ||
      !Array.isArray(o['persons'])
    ) {
      return { ok: false };
    }
    if (!(o['records'] as unknown[]).every(recordOk)) return { ok: false };
    if (!(o['categories'] as unknown[]).every(categoryOk)) return { ok: false };
    if (!(o['rules'] as unknown[]).every(ruleOk)) return { ok: false };
    if (!(o['persons'] as unknown[]).every(personOk)) return { ok: false };
    const budget = o['budget'];
    if (budget !== null && !budgetOk(budget)) return { ok: false };
    return { ok: true, env: raw as ExportEnvelope };
  } catch {
    return { ok: false };
  }
}
