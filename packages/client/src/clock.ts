/**
 * 裝置 HLC 時鐘殼——core/hlc.ts 是純函數，這裡是唯一持有「現在的時鐘狀態」的地方。
 *
 * 狀態持久化在 localStorage（`zb.hlc`）而非 IndexedDB：時鐘必須**同步可用**
 * （每次記帳 mutation 都要 mint），IDB 的 async 會讓 slice 動作全變 async；
 * 且時鐘狀態極小（~60 bytes）。持久化的意義：app 重啟後即使牆鐘倒退
 * （使用者改時間/時區），HLC 仍嚴格遞增，LWW 不會誤判新舊。
 */
import { hlcEncode, hlcInit, hlcParse, hlcRecv, hlcTick, type Hlc } from '@zhangben/core';
import { loadJson, saveJson } from './storage';
import { getDeviceId } from './ids';

const KEY = 'zb.hlc';

let state: Hlc | null = null;

function ensure(): Hlc {
  if (state) return state;
  state = loadJson(
    KEY,
    (raw) => {
      // 存的是 encode 字串（單一真相格式，parse 失敗回 init）
      const parsed = typeof raw === 'string' ? hlcParse(raw) : null;
      return parsed ?? hlcInit(getDeviceId());
    },
    () => hlcInit(getDeviceId()),
  );
  return state;
}

/** 本機事件：推進時鐘並回傳編碼字串（Syncable.updatedAt 直接用） */
export function tickClock(): string {
  state = hlcTick(ensure(), Date.now());
  saveJson(KEY, hlcEncode(state));
  return hlcEncode(state);
}

/** 收到對端時鐘（M4 同步 hello/訊息時呼叫）：吸收遠端進度 */
export function recvClock(remoteEncoded: string): void {
  const remote = hlcParse(remoteEncoded);
  if (!remote) return; // 壞時鐘字串=忽略（對端資料仍照常合併，只是不吸收其時鐘）
  state = hlcRecv(ensure(), remote, Date.now());
  saveJson(KEY, hlcEncode(state));
}

/** 目前時鐘（不推進；同步 hello 用） */
export function peekClock(): string {
  return hlcEncode(ensure());
}
