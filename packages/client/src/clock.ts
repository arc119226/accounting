/**
 * 裝置 HLC 時鐘殼——core/hlc.ts 是純函數，這裡是唯一持有「現在的時鐘狀態」的地方。
 *
 * 狀態持久化在 localStorage（`zb.hlc`）而非 IndexedDB：時鐘必須**同步可用**
 * （每次記帳 mutation 都要 mint），IDB 的 async 會讓 slice 動作全變 async。
 *
 * 兩道防線（審查修正）：
 * 1. **跨分頁**：每次 mint 都讀回 localStorage 現值、取「模組快取 vs 持久值」較大者
 *    當基準——桌機同開兩分頁時，模組級快取各自為政會鑄出重複 HLC
 *    （同信封不同內容=LWW 永不收斂）。localStorage 是同步 API，讀回零成本。
 * 2. **持久化失敗**：localStorage 不可寫（隱私模式/配額滿）+ 牆鐘回撥時，重啟後
 *    時鐘倒退會讓新編輯輸給對端舊版。開機由 ledgerSlice.hydrate 以「帳本內最大
 *    updatedAt」呼叫 seedClock 種回，單機單調性不再依賴 localStorage 可寫。
 */
import { hlcCompare, hlcEncode, hlcInit, hlcParse, hlcRecv, hlcTick, type Hlc } from '@zhangben/core';
import { loadJson, saveJson } from './storage';
import { getDeviceId } from './ids';

const KEY = 'zb.hlc';

let state: Hlc | null = null;

function readPersisted(): Hlc | null {
  return loadJson(
    KEY,
    (raw) => (typeof raw === 'string' ? hlcParse(raw) : null),
    () => null,
  );
}

/** 取 max(模組快取, localStorage 現值)；皆無=init */
function ensure(): Hlc {
  const persisted = readPersisted();
  if (!state) {
    state = persisted ?? hlcInit(getDeviceId());
    return state;
  }
  if (persisted && hlcCompare(hlcEncode(persisted), hlcEncode(state)) > 0) {
    state = persisted;
  }
  return state;
}

/** 本機事件：推進時鐘並回傳編碼字串（Syncable.updatedAt 直接用） */
export function tickClock(): string {
  state = hlcTick(ensure(), Date.now());
  saveJson(KEY, hlcEncode(state));
  return hlcEncode(state);
}

/** 收到外部時鐘（同步 hello / 檔案匯入 / 開機 seed）：吸收其進度 */
export function recvClock(remoteEncoded: string): void {
  const remote = hlcParse(remoteEncoded);
  if (!remote) return; // 壞時鐘字串=忽略（資料仍照常合併，只是不吸收其時鐘）
  state = hlcRecv(ensure(), remote, Date.now());
  saveJson(KEY, hlcEncode(state));
}

/** 開機種回：以帳本內最大 updatedAt 保證後續 mint 嚴格大於一切既存時間戳 */
export const seedClock = recvClock;

/** 目前時鐘（不推進） */
export function peekClock(): string {
  return hlcEncode(ensure());
}
