/**
 * 持久儲存請求與用量查詢。
 *
 * **每次啟動都要呼 requestPersist()**：WebKit（iOS/Safari）對 persist 授權
 * 是逐次會話評估的，只在安裝時要一次會靜默失效；Chromium 冪等無害。
 * 帳本是財務資料——「瀏覽器把 IDB 回收了」不可接受，persist + 安裝到主畫面
 * + 備份提醒三道防線缺一不可。
 */

export async function requestPersist(): Promise<boolean> {
  try {
    if (!('storage' in navigator) || !navigator.storage.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageInfo {
  readonly persisted: boolean;
  readonly usageBytes: number;
  readonly quotaBytes: number;
}

export async function getStorageInfo(): Promise<StorageInfo> {
  try {
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    const est = (await navigator.storage?.estimate?.()) ?? {};
    return {
      persisted,
      usageBytes: est.usage ?? 0,
      quotaBytes: est.quota ?? 0,
    };
  } catch {
    return { persisted: false, usageBytes: 0, quotaBytes: 0 };
  }
}
