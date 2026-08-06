/**
 * 本機設定（**不同步**——「我是誰」在兩台手機上本來就不同）。
 * normalize-on-read（sr2 慣例）：缺欄補預設、壞型別夾回合法值，永不 throw。
 */
import type { PersonId } from '@zhangben/core';
import { loadJson, saveJson } from './storage';

export interface Settings {
  /** 這台裝置的使用者是誰（paidBy 預設值） */
  readonly myPerson: PersonId;
  /** 兩人顯示名（同步 hello 時交換校正；本機仍可自由改） */
  readonly personNames: Readonly<Record<PersonId, string>>;
  /** 上次匯出備份的時刻（備份提醒用；0=從未） */
  readonly lastExportMs: number;
}

const KEY = 'zb.settings';

function defaults(): Settings {
  return { myPerson: 'A', personNames: { A: '甲', B: '乙' }, lastExportMs: 0 };
}

function normalize(raw: unknown): Settings {
  const d = defaults();
  if (typeof raw !== 'object' || raw === null) return d;
  const o = raw as Record<string, unknown>;
  const names = (typeof o['personNames'] === 'object' && o['personNames'] !== null
    ? o['personNames']
    : {}) as Record<string, unknown>;
  const nameOf = (k: PersonId): string => {
    const v = names[k];
    return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, 8) : d.personNames[k];
  };
  return {
    myPerson: o['myPerson'] === 'B' ? 'B' : 'A',
    personNames: { A: nameOf('A'), B: nameOf('B') },
    lastExportMs: typeof o['lastExportMs'] === 'number' && o['lastExportMs'] >= 0 ? o['lastExportMs'] : 0,
  };
}

export function loadSettings(): Settings {
  return loadJson(KEY, normalize, defaults);
}

export function saveSettings(s: Settings): void {
  saveJson(KEY, s);
}
