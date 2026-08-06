/**
 * 本機設定（**不同步**）。v2：身分改 Person 實體（uuid+同步的 name）後，
 * 這裡只剩殼層旗標——「我是誰」在 ids.getPersonId()、名字在 persons store。
 * 舊 v1 shape（myPerson/personNames）經 normalize 自然落回預設（清空重來決策）。
 * normalize-on-read（sr2 慣例）：缺欄補預設、壞型別夾回合法值，永不 throw。
 */
import { loadJson, saveJson } from './storage';

/**
 * 主題偏好。**刻意不同步**：一個人想用夜墨、另一個想用宣紙是完全正常的，
 * 而且它是裝置的性質（這支手機的螢幕、這個人的眼睛），不是帳本的性質。
 */
export type ThemePref = 'system' | 'paper' | 'ink';

export interface Settings {
  /** 取名卡是否已完成（首啟一次；false 時 App 蓋 NameGate） */
  readonly named: boolean;
  /** 上次匯出備份的時刻（備份提醒用；0=從未） */
  readonly lastExportMs: number;
  /** 預設 'paper' 而非 'system'：這是既有使用者每天在用的 app，
      不該在他沒要求的時候改掉他熟悉的樣子。想要就自己去設定頁開。 */
  readonly theme: ThemePref;
}

const KEY = 'zb.settings';

function defaults(): Settings {
  return { named: false, lastExportMs: 0, theme: 'paper' };
}

function normalize(raw: unknown): Settings {
  const d = defaults();
  if (typeof raw !== 'object' || raw === null) return d;
  const o = raw as Record<string, unknown>;
  const t = o['theme'];
  return {
    named: o['named'] === true,
    lastExportMs: typeof o['lastExportMs'] === 'number' && o['lastExportMs'] >= 0 ? o['lastExportMs'] : 0,
    theme: t === 'system' || t === 'paper' || t === 'ink' ? t : d.theme,
  };
}

export function loadSettings(): Settings {
  return loadJson(KEY, normalize, defaults);
}

export function saveSettings(s: Settings): void {
  saveJson(KEY, s);
}
