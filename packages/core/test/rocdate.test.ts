import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  addMonths,
  daysInMonth,
  formatMonthZh,
  isValidISODate,
  monthOf,
  monthRange,
  monthsBetween,
  rocToISO,
} from '../src/rocdate';

describe('rocToISO', () => {
  it('正常值：民國年 + 1911 = 西元年', () => {
    expect(rocToISO('1090312')).toBe('2020-03-12');
    expect(rocToISO('1150806')).toBe('2026-08-06');
  });

  it('年界：民國 99 = 2010（3 碼年含前導零）', () => {
    expect(rocToISO('0990101')).toBe('2010-01-01');
    // 民國元年 = 1912；民國 0 年不存在
    expect(rocToISO('0010101')).toBe('1912-01-01');
    expect(rocToISO('0000101')).toBeNull();
  });

  it('閏年 2 月：閏年收 2/29、平年拒', () => {
    expect(rocToISO('1090229')).toBe('2020-02-29'); // 2020 閏
    expect(rocToISO('1100229')).toBeNull(); // 2021 平
    expect(rocToISO('1890229')).toBeNull(); // 民國 189 = 2100，逢百不閏
    expect(rocToISO('0890229')).toBe('2000-02-29'); // 民國 89 = 2000，逢四百又閏
  });

  it('大小月：31 日只有大月收', () => {
    expect(rocToISO('1090131')).toBe('2020-01-31');
    expect(rocToISO('1090431')).toBeNull(); // 4 月無 31
    expect(rocToISO('1090631')).toBeNull(); // 6 月無 31
    expect(rocToISO('1090430')).toBe('2020-04-30');
  });

  it('垃圾輸入一律 null：長度錯/月日越界/非數字', () => {
    expect(rocToISO('109031')).toBeNull(); // 太短
    expect(rocToISO('10903120')).toBeNull(); // 太長
    expect(rocToISO('1091301')).toBeNull(); // 月 13
    expect(rocToISO('1090001')).toBeNull(); // 月 00
    expect(rocToISO('1090132')).toBeNull(); // 日 32
    expect(rocToISO('1090100')).toBeNull(); // 日 00
    expect(rocToISO('abcdefg')).toBeNull();
    expect(rocToISO('109031a')).toBeNull();
    expect(rocToISO('')).toBeNull();
  });
});

describe('isValidISODate', () => {
  it('真實存在的日期為 true', () => {
    expect(isValidISODate('2026-08-15')).toBe(true);
    expect(isValidISODate('2020-02-29')).toBe(true); // 閏年
    expect(isValidISODate('2000-02-29')).toBe(true); // 逢四百又閏
  });

  it('格式錯或日期不存在為 false', () => {
    expect(isValidISODate('2021-02-29')).toBe(false); // 平年
    expect(isValidISODate('2100-02-29')).toBe(false); // 逢百不閏
    expect(isValidISODate('2026-13-01')).toBe(false);
    expect(isValidISODate('2026-00-10')).toBe(false);
    expect(isValidISODate('2026-04-31')).toBe(false);
    expect(isValidISODate('2026-08-00')).toBe(false);
    expect(isValidISODate('2026-8-5')).toBe(false); // 未補零非本格式
    expect(isValidISODate('2026/08/15')).toBe(false);
    expect(isValidISODate('garbage')).toBe(false);
    expect(isValidISODate('')).toBe(false);
  });
});

describe('monthOf', () => {
  it('取 ISO 日期的前 7 碼', () => {
    expect(monthOf('2026-08-15')).toBe('2026-08');
    expect(monthOf('2026-01-01')).toBe('2026-01');
  });
});

describe('addMonths', () => {
  it('跨年退位：2026-01 - 1 → 2025-12', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('跨年進位與零位移', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-08', 0)).toBe('2026-08');
    expect(addMonths('2026-08', 12)).toBe('2027-08');
    expect(addMonths('2026-08', -20)).toBe('2024-12');
  });
});

describe('daysInMonth', () => {
  it('大小月與閏年 2 月', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2000-02')).toBe(29);
    expect(daysInMonth('2100-02')).toBe(28);
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-08')).toBe(31);
  });
});

describe('monthRange', () => {
  it('平年/閏年 2 月與大月的閉區間', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });
});

describe('formatMonthZh', () => {
  it('月不補零', () => {
    expect(formatMonthZh('2026-08')).toBe('2026年8月');
    expect(formatMonthZh('2026-12')).toBe('2026年12月');
    expect(formatMonthZh('2026-01')).toBe('2026年1月');
  });
});

/** 產生合法 'YYYY-MM'；年域收在 1000..8000，位移後仍不會撞到 0 年（字串補零會壞） */
const arbMonth = fc
  .tuple(fc.integer({ min: 1000, max: 8000 }), fc.integer({ min: 1, max: 12 }))
  .map(([y, m]) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);

describe('property：addMonths 結合律', () => {
  it('addMonths(m, a+b) === addMonths(addMonths(m, a), b)', () => {
    fc.assert(
      fc.property(
        arbMonth,
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (m, a, b) => {
          expect(addMonths(m, a + b)).toBe(addMonths(addMonths(m, a), b));
        },
      ),
    );
  });
});

describe('property：monthsBetween 是 addMonths 的反函式', () => {
  it('monthsBetween(m, addMonths(m, d)) === d（含跨年、負值）', () => {
    fc.assert(
      fc.property(arbMonth, fc.integer({ min: -1000, max: 1000 }), (m, d) => {
        expect(monthsBetween(m, addMonths(m, d))).toBe(d);
      }),
    );
  });

  it('同月 0、反向取負、跨年進位', () => {
    expect(monthsBetween('2026-08', '2026-08')).toBe(0);
    expect(monthsBetween('2026-08', '2026-07')).toBe(-1);
    expect(monthsBetween('2025-12', '2026-01')).toBe(1);
    expect(monthsBetween('2025-08', '2026-08')).toBe(12);
  });
});

describe('property：monthRange 端點合法且落在原月份', () => {
  it('from/to 皆為真實日期，且 monthOf 回原月', () => {
    fc.assert(
      fc.property(arbMonth, (m) => {
        const range = monthRange(m);
        expect(isValidISODate(range.from)).toBe(true);
        expect(isValidISODate(range.to)).toBe(true);
        expect(monthOf(range.from)).toBe(m);
        expect(monthOf(range.to)).toBe(m);
      }),
    );
  });
});
