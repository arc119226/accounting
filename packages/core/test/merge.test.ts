/**
 * merge.ts 的正確性證明——以 fast-check 性質測試為主。
 *
 * 為什麼用 property test：LWW 合併的價值全在「任意同步順序都收斂」，
 * 這是對無窮輸入空間的宣稱，例題式測試蓋不住；冪等／交換／結合三條性質
 * 成立，收斂就是定理而不是巧合。
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Syncable } from '../src/types';
import { changedSince, mergeAll, mergeRow, purgeableTombstones } from '../src/merge';
import type { MergeVerdict } from '../src/merge';

/** 測試用實體：Syncable 信封外加一個 payload，證明 merge 對內容零認知 */
interface Row extends Syncable {
  readonly payload: number;
}

// ---------- arbitraries ----------

const HLC_WIDTH = 8;
const hexChar = fc.constantFrom(...'0123456789abcdef'.split(''));

/** 定寬隨機字串——模擬 hlcEncode 的定寬輸出（定寬正是「字典序=全序」的前提） */
const hlcRandom = fc
  .array(hexChar, { minLength: HLC_WIDTH, maxLength: HLC_WIDTH })
  .map((cs) => cs.join(''));

/** 摻入固定池提高 updatedAt 對撞率：逼出 tie-break 與邊界（=）路徑 */
const hlcArb = fc.oneof(
  { weight: 2, arbitrary: hlcRandom },
  { weight: 1, arbitrary: fc.constantFrom('44444444', '88888888', 'cccccccc') },
);

/** id 從小池子抽：故意製造同 id 衝突，衝突才是合併的主戰場 */
const idArb = fc.constantFrom('r1', 'r2', 'r3', 'r4');
const deviceArb = fc.constantFrom('aaa', 'bbb', 'ccc');

const rowArb: fc.Arbitrary<Row> = fc.record({
  id: idArb,
  updatedAt: hlcArb,
  deviceId: deviceArb,
  deleted: fc.boolean(),
  payload: fc.integer(),
});

/**
 * 真實世界的不變量：同 (id, updatedAt, deviceId) 必是同一顆事件
 * （HLC 單裝置嚴格遞增，不可能撞號）。純隨機生成會造出「同信封不同內容」
 * 的假事件——那在現實不可能發生，卻會讓收斂性質誤報失敗（identical 各留
 * 各的 local），所以事件宇宙先按信封去重（留第一顆）。
 */
function dedupeUniverse(rows: readonly Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    const key = `${r.id}|${r.updatedAt}|${r.deviceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

const universeArb = fc.array(rowArb, { maxLength: 16 }).map(dedupeUniverse);

/**
 * 從同一顆事件宇宙抽 n 個子集（bitmask 決定各裝置看到哪些事件），
 * 模擬「部分同步後各機各持一部分歷史」的真實狀態。
 */
function subsetsArb(n: number): fc.Arbitrary<Row[][]> {
  return universeArb
    .chain((rows) =>
      fc.tuple(
        fc.constant(rows),
        fc.array(fc.integer({ min: 0, max: (1 << n) - 1 }), {
          minLength: rows.length,
          maxLength: rows.length,
        }),
      ),
    )
    .map(([rows, masks]) => {
      const subsets: Row[][] = Array.from({ length: n }, () => []);
      rows.forEach((row, i) => {
        const mask = masks[i] ?? 0;
        for (let k = 0; k < n; k += 1) {
          if ((mask >> k) & 1) subsets[k]?.push(row);
        }
      });
      return subsets;
    });
}

/** 陣列疊成 Map 狀態：同 id 後者蓋前者（任何「鍵=值.id」的 Map 都是合法本機狀態） */
function toMap(rows: readonly Row[]): Map<string, Row> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** Map 深比較用：insertion order 不是狀態的一部分，先按 key 排序再比 */
function entries(m: ReadonlyMap<string, Row>): [string, Row][] {
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------- 獨立參考實作（oracle） ----------

/**
 * 直白重寫一次語意當對照組：兩份獨立實作同時犯同一個錯的機率極低。
 * 這裡刻意用 JS 原生字串比較運算子，不共用 src 的 cmp()。
 */
function refVerdict(local: Row | undefined, incoming: Row): MergeVerdict {
  if (local === undefined) return 'take-incoming';
  if (incoming.updatedAt === local.updatedAt) {
    if (incoming.deviceId === local.deviceId) return 'identical';
    return incoming.deviceId > local.deviceId ? 'take-incoming' : 'keep-local';
  }
  return incoming.updatedAt > local.updatedAt ? 'take-incoming' : 'keep-local';
}

/** mergeAll 的暴力對照：逐筆重放 refVerdict，照契約字面計數 */
function refMergeAll(local: ReadonlyMap<string, Row>, incoming: readonly Row[]) {
  const next = new Map(local);
  const summary = { added: 0, updated: 0, skipped: 0, deletes: 0 };
  for (const row of incoming) {
    const existing = next.get(row.id);
    if (refVerdict(existing, row) !== 'take-incoming') {
      summary.skipped += 1;
      continue;
    }
    if (existing === undefined) summary.added += 1;
    if (existing !== undefined && !row.deleted) summary.updated += 1;
    if (row.deleted) summary.deletes += 1;
    next.set(row.id, row);
  }
  return { next, summary };
}

// ---------- mergeRow ----------

describe('mergeRow', () => {
  it('local undefined 一律 take-incoming', () => {
    fc.assert(
      fc.property(rowArb, (r) => {
        expect(mergeRow(undefined, r)).toBe('take-incoming');
      }),
    );
  });

  it('同 updatedAt 同 deviceId 即 identical（同一事件），內容不參與判斷', () => {
    fc.assert(
      fc.property(rowArb, fc.integer(), (r, p) => {
        expect(mergeRow(r, { ...r, payload: p })).toBe('identical');
      }),
    );
  });

  it('任意配對的裁決與獨立參考實作一致', () => {
    fc.assert(
      fc.property(rowArb, rowArb, (a, b) => {
        // 只有同 id 的列才會被拿來比，統一 id 貼近真實呼叫情境
        const local = { ...a, id: 'x' };
        const incoming = { ...b, id: 'x' };
        expect(mergeRow(local, incoming)).toBe(refVerdict(local, incoming));
      }),
    );
  });

  it('tie-break 全序：updatedAt 相同、deviceId 不同時，兩邊合併結果一致', () => {
    fc.assert(
      fc.property(
        hlcArb,
        fc.tuple(deviceArb, deviceArb).filter(([a, b]) => a !== b),
        fc.integer(),
        fc.integer(),
        fc.boolean(),
        fc.boolean(),
        (h, [da, db], p1, p2, del1, del2) => {
          const x: Row = { id: 'x', updatedAt: h, deviceId: da, deleted: del1, payload: p1 };
          const y: Row = { id: 'x', updatedAt: h, deviceId: db, deleted: del2, payload: p2 };
          const winner = da > db ? x : y;
          // 兩個方向都選出同一顆勝者——這就是收斂
          expect(mergeAll(toMap([x]), [y]).next.get('x')).toEqual(winner);
          expect(mergeAll(toMap([y]), [x]).next.get('x')).toEqual(winner);
          // 裁決互補：一邊 take 另一邊必 keep（不會兩邊都收或都不收）
          const verdicts = [mergeRow(x, y), mergeRow(y, x)].sort();
          expect(verdicts).toEqual(['keep-local', 'take-incoming']);
        },
      ),
    );
  });

  it('墓碑：較晚的 delete 蓋過較早的 edit；較晚的 edit 蓋過較早的 delete（復活合法）', () => {
    fc.assert(
      fc.property(
        fc.tuple(hlcRandom, hlcRandom).filter(([a, b]) => a !== b),
        deviceArb,
        deviceArb,
        fc.integer(),
        ([h1, h2], d1, d2, payload) => {
          const [lo, hi] = h1 < h2 ? [h1, h2] : [h2, h1];
          const earlyEdit: Row = { id: 'x', updatedAt: lo, deviceId: d1, deleted: false, payload };
          const lateDelete: Row = { id: 'x', updatedAt: hi, deviceId: d2, deleted: true, payload };
          // 晚刪蓋早改
          expect(mergeRow(earlyEdit, lateDelete)).toBe('take-incoming');
          expect(mergeRow(lateDelete, earlyEdit)).toBe('keep-local');
          expect(mergeAll(toMap([earlyEdit]), [lateDelete]).next.get('x')).toEqual(lateDelete);
          // 晚改復活早刪（墓碑無特權）
          const earlyDelete: Row = { id: 'x', updatedAt: lo, deviceId: d1, deleted: true, payload };
          const lateEdit: Row = { id: 'x', updatedAt: hi, deviceId: d2, deleted: false, payload };
          expect(mergeRow(earlyDelete, lateEdit)).toBe('take-incoming');
          expect(mergeRow(lateEdit, earlyDelete)).toBe('keep-local');
          expect(mergeAll(toMap([earlyDelete]), [lateEdit]).next.get('x')).toEqual(lateEdit);
        },
      ),
    );
  });
});

// ---------- mergeAll：收斂三性質 ----------

describe('mergeAll 收斂性質', () => {
  it('冪等：同一批 incoming 合併第二次，結果不變', () => {
    fc.assert(
      fc.property(universeArb, universeArb, (la, lb) => {
        const local = toMap(la);
        const once = mergeAll(local, lb).next;
        const twice = mergeAll(once, lb).next;
        expect(entries(twice)).toEqual(entries(once));
      }),
    );
  });

  it('交換收斂：雙向合併後兩邊狀態深等', () => {
    fc.assert(
      fc.property(subsetsArb(2), (subs) => {
        const A = toMap(subs[0] ?? []);
        const B = toMap(subs[1] ?? []);
        const ab = mergeAll(A, [...B.values()]).next;
        const ba = mergeAll(B, [...A.values()]).next;
        expect(entries(ab)).toEqual(entries(ba));
      }),
    );
  });

  it('結合（三裝置）：((a∪b)∪c) 與 (a∪(b∪c)) 收斂相同', () => {
    fc.assert(
      fc.property(subsetsArb(3), (subs) => {
        const A = toMap(subs[0] ?? []);
        const B = toMap(subs[1] ?? []);
        const C = toMap(subs[2] ?? []);
        const left = mergeAll(mergeAll(A, [...B.values()]).next, [...C.values()]).next;
        const right = mergeAll(A, [...mergeAll(B, [...C.values()]).next.values()]).next;
        expect(entries(left)).toEqual(entries(right));
      }),
    );
  });
});

// ---------- mergeAll：summary 與不變性 ----------

describe('mergeAll summary', () => {
  it('計數與暴力對照；next 與暴力對照；輸入 Map 原封不動', () => {
    fc.assert(
      fc.property(universeArb, fc.array(rowArb, { maxLength: 12 }), (la, lb) => {
        // lb 不去重：故意讓 incoming 內同 id 重覆出現，逼出「對演進中 next 裁決」的路徑
        const local = toMap(la);
        const snapshot = entries(local);
        const actual = mergeAll(local, lb);
        const ref = refMergeAll(local, lb);
        expect(actual.summary).toEqual(ref.summary);
        expect(entries(actual.next)).toEqual(entries(ref.next));
        // 呼叫端靠參照相等偵測變化，輸入被改就全毀
        expect(entries(local)).toEqual(snapshot);
      }),
    );
  });

  it('例題釘死語意：added / updated / deletes / skipped', () => {
    const mk = (id: string, updatedAt: string, deleted: boolean): Row => ({
      id,
      updatedAt,
      deviceId: 'aaa',
      deleted,
      payload: 0,
    });
    const local = toMap([mk('a', '11111111', false), mk('b', '11111111', false), mk('c', '99999999', false)]);
    const incoming = [
      mk('n', '22222222', false), // 新列 → added
      mk('a', '22222222', false), // 蓋既有非墓碑 → updated
      mk('b', '22222222', true), // 蓋既有的墓碑 → deletes（不算 updated）
      mk('c', '11111111', false), // 較舊 → skipped
      mk('c', '99999999', false), // 同事件 → identical → skipped
    ];
    const { summary } = mergeAll(local, incoming);
    expect(summary).toEqual({ added: 1, updated: 1, deletes: 1, skipped: 2 });
  });

  it('例題釘死契約字面：本機沒有的新墓碑同時計入 added 與 deletes', () => {
    // 契約：added=「local 無此 id 且 take」、deletes=「take 且 incoming.deleted」
    // 兩條件對「新來的墓碑」同時成立——照字面實作，計數類別容許重疊
    const tomb: Row = { id: 'n', updatedAt: '99999999', deviceId: 'aaa', deleted: true, payload: 0 };
    const { summary } = mergeAll(new Map(), [tomb]);
    expect(summary).toEqual({ added: 1, updated: 0, skipped: 0, deletes: 1 });
  });
});

// ---------- changedSince ----------

describe('changedSince', () => {
  it('與暴力 filter 對照（updatedAt > sinceHlc，字典序）；不多也不漏', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { maxLength: 16 }),
        fc.oneof(fc.constant(''), hlcArb),
        (rows, since) => {
          const got = changedSince(rows, since);
          // 都 > sinceHlc
          for (const r of got) expect(r.updatedAt > since).toBe(true);
          // 沒漏（與暴力法逐一對照，含順序）
          expect(got).toEqual(rows.filter((r) => r.updatedAt > since));
        },
      ),
    );
  });

  it("sinceHlc='' 退化為全量", () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 16 }), (rows) => {
        expect(changedSince(rows, '')).toEqual(rows);
      }),
    );
  });
});

// ---------- purgeableTombstones ----------

describe('purgeableTombstones', () => {
  it('空 peerCheckpoints ⇒ 一律不可刪（沒同步過任何人就清墓碑會讓刪除失傳）', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 16 }), hlcArb, (rows, cutoff) => {
        expect(purgeableTombstones(rows, cutoff, [])).toEqual([]);
      }),
    );
  });

  it('與暴力法對照：deleted 且 updatedAt < cutoff 且對每個 checkpoint 都 <=', () => {
    fc.assert(
      fc.property(
        fc.array(rowArb, { maxLength: 16 }),
        hlcArb,
        fc.array(hlcArb, { minLength: 1, maxLength: 4 }),
        (rows, cutoff, cps) => {
          const expected = rows
            .filter((r) => r.deleted && r.updatedAt < cutoff && cps.every((cp) => r.updatedAt <= cp))
            .map((r) => r.id);
          expect(purgeableTombstones(rows, cutoff, cps)).toEqual(expected);
        },
      ),
    );
  });
});
