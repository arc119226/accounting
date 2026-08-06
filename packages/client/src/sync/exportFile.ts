/**
 * 檔案備份（同步的保底路徑）：匯出完整帳本 JSON、匯入走**同一個**
 * repo.applyIncoming 合併路徑——全 app 只有一份合併實作，匯入=很慢的同步。
 */
import type { Budget, Category, ExpenseRecord, MerchantRule } from '@zhangben/core';

export interface ExportEnvelope {
  readonly v: 1;
  readonly app: 'zhangben';
  readonly exportedAt: string;
  readonly deviceId: string;
  readonly records: readonly ExpenseRecord[];
  readonly categories: readonly Category[];
  readonly rules: readonly MerchantRule[];
  readonly budget: Budget | null;
}

export function buildExport(input: {
  deviceId: string;
  records: Iterable<ExpenseRecord>;
  categories: Iterable<Category>;
  rules: Iterable<MerchantRule>;
  budget: Budget | null;
}): ExportEnvelope {
  return {
    v: 1,
    app: 'zhangben',
    exportedAt: new Date().toISOString(),
    deviceId: input.deviceId,
    records: [...input.records],
    categories: [...input.categories],
    rules: [...input.rules],
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

/** 信封驗證：只驗形狀不驗內容（內容交給 mergeAll 的信封欄位 + normalize 防線） */
export function parseImport(text: string): { ok: true; env: ExportEnvelope } | { ok: false } {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null) return { ok: false };
    const o = raw as Record<string, unknown>;
    if (o['v'] !== 1 || o['app'] !== 'zhangben') return { ok: false };
    if (!Array.isArray(o['records']) || !Array.isArray(o['categories']) || !Array.isArray(o['rules'])) {
      return { ok: false };
    }
    const envelopeOk = (r: unknown): boolean => {
      if (typeof r !== 'object' || r === null) return false;
      const e = r as Record<string, unknown>;
      return (
        typeof e['id'] === 'string' &&
        typeof e['updatedAt'] === 'string' &&
        typeof e['deviceId'] === 'string' &&
        typeof e['deleted'] === 'boolean'
      );
    };
    for (const list of [o['records'], o['categories'], o['rules']] as unknown[][]) {
      if (!list.every(envelopeOk)) return { ok: false };
    }
    const budget = o['budget'];
    if (budget !== null && !envelopeOk(budget)) return { ok: false };
    return { ok: true, env: raw as ExportEnvelope };
  } catch {
    return { ok: false };
  }
}
