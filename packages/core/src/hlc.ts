/**
 * 混合邏輯時鐘（Hybrid Logical Clock；Kulkarni et al. 2014）。
 *
 * Syncable.updatedAt 的產生器。LWW 合併的前提是「任兩筆編輯，所有裝置都得出同一勝負」：
 * 純牆鐘做不到（兩台手機的時鐘互不可信、使用者還會手動調時間），純邏輯鐘又丟失
 * 「大致發生在何時」的資訊。HLC 兩者兼得——ms 貼著牆鐘走、ctr 在 ms 停滯時補足因果序，
 * (ms, ctr, device) 三元組構成全序（device 是同 ms 同 ctr 時的決定性 tie-break）。
 *
 * 設計決定（改動前先讀）：
 * - **hlcRecv 對 remote.ms 不設上限**。若在這裡把遠端時間戳夾到本機牆鐘附近，
 *   合併結果就取決於「收訊那台」的時鐘——同一批資料在兩台手機會合出不同結果，
 *   LWW 收斂性直接報銷。所以照論文原樣讓邏輯鐘跳到未來：順序正確性不受影響，
 *   時鐘漂移是「使用者該被告知」而非「core 該偷偷修」的事——警示由 UI 層拿
 *   remote.ms 與本機牆鐘的物理差去判斷（core 零 I/O，本來也拿不到真牆鐘）。
 *   代價：一台時鐘壞掉的裝置會把全帳本的 HLC 推到未來；雙人互信場景可接受。
 * - **ctr 溢位 0xffff → ms+1、ctr=0**。單毫秒內塞不滿 65536 個事件，實務到不了，
 *   但行為必須有定義：不進位的話 ctr 會超出 4 位十六進位、破壞定寬編碼的全序。
 * - **編碼定寬**（ms 十進位 15 位 / ctr 十六進位小寫 4 位）→ 字典序即全序。
 *   merge.ts 熱路徑與 IndexedDB 索引都只做字串比較，永不解碼。15 位十進位
 *   可表到約西元 33658 年——超過後定寬破裂，是記錄在案的已知邊界，不另設防。
 * - wallMs 由呼叫端餵 Date.now()（整數毫秒）；core 決定論鐵律，見 eslint.config.js。
 */

export interface Hlc {
  readonly ms: number;
  readonly ctr: number;
  readonly device: string;
}

/** ctr 的編碼上限（4 位十六進位的極限）；超過就進位到 ms，見檔頭 */
const CTR_MAX = 0xffff;

/**
 * wallMs 的入口防線：**非整數會直接毀掉整個 LWW**。
 *
 * ms 是唯一會被 padStart(15,'0') 定寬編碼的欄位，而定寬正是「字典序＝全序」的
 * 根基（merge.ts 熱路徑只比字串、從不解碼）。wallMs=1234.5 會編出
 * '00000000001234.5'——16 個字元、還帶小數點，定寬破裂、全序報銷，而且沒有
 * 任何地方會報錯。呼叫端目前是 Date.now()（必為整數）所以踩不到，但這是全案
 * 唯一「一個輸入就能無聲毀掉全部同步」的類別，值得一道兩個字的防線。
 * NaN → 0：Math.max(prev.ms, NaN) 是 NaN，同樣會編出壞字串。
 */
function safeWall(wallMs: number): number {
  return Number.isFinite(wallMs) ? Math.trunc(wallMs) : 0;
}

/** 全新裝置的起點。ms=0 保證任何真實事件（tick 過至少一次）都嚴格大於它。 */
export function hlcInit(device: string): Hlc {
  return { ms: 0, ctr: 0, device };
}

/**
 * 本機事件打點。嚴格遞增的保證全在這裡：牆鐘倒退（使用者調時間、NTP 校正）時
 * ms 不動、只推 ctr——新編輯的 HLC 仍大於舊編輯，LWW 永遠不會出現「新輸舊」。
 */
export function hlcTick(prev: Hlc, wallMs: number): Hlc {
  const ms = Math.max(prev.ms, safeWall(wallMs));
  if (ms === prev.ms) {
    // ms 沒前進 → 靠 ctr 區分同毫秒（或牆鐘倒退期間）的事件；溢位則進位
    return prev.ctr >= CTR_MAX
      ? { ms: ms + 1, ctr: 0, device: prev.device }
      : { ms, ctr: prev.ctr + 1, device: prev.device };
  }
  // 牆鐘真的前進了 → ctr 歸零，讓 ms 重新貼回物理時間
  return { ms, ctr: 0, device: prev.device };
}

/**
 * 收到遠端時間戳時推進本機時鐘（HLC 論文的 recv 規則）。
 * 收訊本身也是事件（本機狀態因它而變），所以結果**嚴格大於**雙方輸入——
 * 這保證「收到後馬上編輯」產生的時間戳必然壓過剛收到的那筆，因果不倒置。
 */
export function hlcRecv(prev: Hlc, remote: Hlc, wallMs: number): Hlc {
  const ms = Math.max(prev.ms, remote.ms, safeWall(wallMs));
  // 論文的 ctr 分支：ms 停在誰身上，就從誰的 ctr 之後繼續數
  let ctr: number;
  if (ms === prev.ms && ms === remote.ms) {
    ctr = Math.max(prev.ctr, remote.ctr) + 1;
  } else if (ms === prev.ms) {
    ctr = prev.ctr + 1;
  } else if (ms === remote.ms) {
    ctr = remote.ctr + 1;
  } else {
    // 本機牆鐘領先雙方 → 物理時間已足以區分事件
    ctr = 0;
  }
  if (ctr > CTR_MAX) {
    return { ms: ms + 1, ctr: 0, device: prev.device };
  }
  return { ms, ctr, device: prev.device };
}

/**
 * 定寬編碼：`${ms 十進位 15 位零填}-${ctr 十六進位 4 位零填}-${device}`。
 * 前兩欄定寬 → 整串字典序 = (ms, ctr, device) 逐欄比較的全序（hlcCompare 的正確性根基）。
 * 十六進位一律小寫：大小寫混用會破壞「字典序=數值序」（'A' < 'a'）。
 */
export function hlcEncode(h: Hlc): string {
  return `${h.ms.toString(10).padStart(15, '0')}-${h.ctr.toString(16).padStart(4, '0')}-${h.device}`;
}

/**
 * 只認 hlcEncode 的正準形（含小寫 hex）；device 取第二個 '-' 之後的全部，
 * 所以 device 本身含 '-'（如 uuid）也能無歧義還原。壞格式回 null、永不 throw——
 * updatedAt 來自同步對端，是不可信輸入，parse 失敗由呼叫端當壞資料處理。
 */
const HLC_RE = /^(\d{15})-([0-9a-f]{4})-([\s\S]*)$/;

export function hlcParse(s: string): Hlc | null {
  const m = HLC_RE.exec(s);
  if (m === null) return null;
  const [, msStr, ctrStr, device] = m;
  // regex 三組必在，但 noUncheckedIndexedAccess 看不穿 regex——守門而非斷言
  if (msStr === undefined || ctrStr === undefined || device === undefined) return null;
  // 15 位十進位最大 10^15-1 < 2^53，Number 必然精確
  return { ms: Number(msStr), ctr: parseInt(ctrStr, 16), device };
}

/**
 * 純字典序比較（<0 / 0 / >0）。定寬編碼保證字典序=全序，所以不解碼、直接比字串。
 * 不用 localeCompare：它隨執行環境的 locale 變化，非決定論，違反 core 鐵律。
 */
export function hlcCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 內建分類等 seed 資料的 updatedAt。任何真實編輯至少 tick 過一次（ctr ≥ 1 或 ms ≥ 1），
 * 編碼必嚴格大於此值 → 使用者改過的內建分類永遠不會被出廠 seed 蓋回。
 */
export const HLC_ZERO: string = hlcEncode({ ms: 0, ctr: 0, device: '0' });
