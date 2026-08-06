/**
 * 人物頁籤（Ledger 與 Stats 共用）：【全家】【我】【其他人依名】。
 * 過濾狀態住 shell slice（兩屏共享、切屏不重置）。
 * 只有一個人（還沒同步過）時整排隱藏——單人沒有「個人 vs 全家」之分。
 */
import { sortPersonsForTabs } from '../personView';
import { useAppStore } from '../store/appStore';
import { PERSONS } from '../strings/ui';

export function PersonTabs() {
  const persons = useAppStore((s) => s.persons);
  const personFilter = useAppStore((s) => s.personFilter);
  const setPersonFilter = useAppStore((s) => s.setPersonFilter);

  const list = sortPersonsForTabs(persons);
  if (list.length < 2) return null;

  return (
    <div className="seg person-tabs">
      <button
        className={`seg-btn${personFilter === 'all' ? ' active' : ''}`}
        onClick={() => setPersonFilter('all')}
      >
        {PERSONS.all}
      </button>
      {list.map((p) => (
        <button
          key={p.id}
          className={`seg-btn${personFilter === p.id ? ' active' : ''}`}
          onClick={() => setPersonFilter(p.id)}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
