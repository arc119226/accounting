/**
 * 本機設定（**不同步**）。v2：身分改 Person 實體（uuid+同步的 name）後，
 * 這裡只剩殼層旗標——「我是誰」在 ids.getPersonId()、名字在 persons store。
 * 舊 v1 shape（myPerson/personNames）經 normalize 自然落回預設（清空重來決策）。
 * normalize-on-read（sr2 慣例）：缺欄補預設、壞型別夾回合法值，永不 throw。
 */
import { loadJson, saveJson } from './storage';

export interface Settings {
  /** 取名卡是否已完成（首啟一次；false 時 App 蓋 NameGate） */
  readonly named: boolean;
  /** 上次匯出備份的時刻（備份提醒用；0=從未） */
  readonly lastExportMs: number;
}

const KEY = 'zb.settings';

function defaults(): Settings {
  return { named: false, lastExportMs: 0 };
}

function normalize(raw: unknown): Settings {
  const d = defaults();
  if (typeof raw !== 'object' || raw === null) return d;
  const o = raw as Record<string, unknown>;
  return {
    named: o['named'] === true,
    lastExportMs: typeof o['lastExportMs'] === 'number' && o['lastExportMs'] >= 0 ? o['lastExportMs'] : 0,
  };
}

export function loadSettings(): Settings {
  return loadJson(KEY, normalize, defaults);
}

export function saveSettings(s: Settings): void {
  saveJson(KEY, s);
}
