/**
 * 檔案備份（同步的保底路徑）：匯出完整帳本 JSON、匯入走**同一個**
 * repo.applyIncoming 合併路徑——全 app 只有一份合併實作，匯入=很慢的同步。
 */
import type { Budget, Category, ExpenseRecord, MerchantRule, Person } from '@zhangben/core';
import { budgetOk, categoryOk, personOk, recordOk, ruleOk } from './rowSchema';

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

/** 匯出的去向。cancelled 與 failed **都不算完成備份**（呼叫端不可推進 lastExportMs）。 */
export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled' | 'failed';

/** 觸發下載（檔名帶日期，好找） */
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // revoke 延後：Safari 立刻 revoke 會取消下載
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 匯出：**分享面板優先、下載保底**。
 *
 * 為什麼不能只留 a[download]：iOS 加到主畫面後（standalone）的 blob 下載時常靜默失敗——
 * 使用者以為備份好了，其實什麼都沒存下來。備份是這個 app 對抗「手機掉了」的唯一手段，
 * 靜默失敗是不能接受的失敗模式；分享面板則能直接存進「檔案」或傳給自己。
 *
 * **share() 必須留在 click 的手勢任務內**：async 函式在第一個 await 前是同步跑的，
 * 所以順序必須是 建 JSON → Blob → File → canShare → **呼叫 share()** → 才 await。
 * 這之前只要有任何 await（含呼叫端），Safari 就丟 NotAllowedError，於是悄悄退回
 * 我們正要修掉的那條壞下載路徑。payload 也只放 files——多帶 title/text 是 iOS 經典破法。
 */
export async function shareOrDownloadExport(env: ExportEnvelope): Promise<ExportOutcome> {
  const name = `zhangben-backup-${env.exportedAt.slice(0, 10)}.json`;
  let blob: Blob;
  try {
    blob = new Blob([JSON.stringify(env)], { type: 'application/json' });
  } catch {
    return 'failed';
  }
  let sharing: Promise<void> | null = null;
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      sharing = navigator.share({ files: [file] });
    }
  } catch {
    // File 建構或 canShare 拋錯（舊瀏覽器/受限環境）：往下走下載
  }
  if (sharing) {
    try {
      await sharing;
      return 'shared';
    } catch (err) {
      // 使用者按取消：**不是**完成備份，也不要再彈一次下載嚇他
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // 其他錯（NotAllowedError 等）：退回下載
    }
  }
  try {
    downloadBlob(blob, name);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/**
 * 匯入驗證（審查修正 #15）：逐類別驗欄位——毒列一旦落盤，起始畫面每次啟動都會炸。
 * 驗證器本體搬去 sync/rowSchema.ts 與 P2P 共用（原本只有這條路有把關）。
 * buildExport 完全掌控合法格式，嚴格驗證不會誤拒真備份；
 * **任一列不合格=整檔拒收**——檔案是使用者主動挑的一份東西，寧可整份拒絕，
 * 也不要默默匯進半套讓他以為還原完成了。
 */
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
