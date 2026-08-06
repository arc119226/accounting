/**
 * 人物顯示的共用小工具（純函式葉檔）：頁籤排序與名字查詢 fallback。
 * 「我在最前、其他人依名」是兩屏頁籤與 paidBy seg 的共同順序契約。
 */
import type { ExpenseRecord, Person } from '@zhangben/core';
import { getPersonId } from './ids';

/** 我在最前，其他人依名（localeCompare）；排除墓碑（人物目前無刪除路徑，防禦性） */
export function sortPersonsForTabs(persons: ReadonlyMap<string, Person>): Person[] {
  const myId = getPersonId();
  return [...persons.values()]
    .filter((p) => !p.deleted)
    .sort((a, b) => {
      if (a.id === myId) return -1;
      if (b.id === myId) return 1;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });
}

/** 人物名字查詢：row 未同步到時回 fallback（呼叫端給字串，通常 PERSONS.unknown） */
export function personName(
  persons: ReadonlyMap<string, Person>,
  id: string,
  fallback: string,
): string {
  return persons.get(id)?.name ?? fallback;
}

/** personFilter 套用（'all' 直通） */
export function matchesPersonFilter(r: ExpenseRecord, filter: 'all' | string): boolean {
  return filter === 'all' || r.paidBy === filter;
}
