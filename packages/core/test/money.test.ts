import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatAmount, formatNTD, parseAmountInput } from '../src/money';

describe('formatNTD', () => {
  it('整數千分位加 $', () => {
    expect(formatNTD(1234)).toBe('$1,234');
    expect(formatNTD(0)).toBe('$0');
    expect(formatNTD(999)).toBe('$999');
    expect(formatNTD(1000)).toBe('$1,000');
    expect(formatNTD(1234567)).toBe('$1,234,567');
    expect(formatNTD(99999999)).toBe('$99,999,999');
  });

  it('契約外的壞值也安全：小數 trunc、負數帶號、非有限數視為 0', () => {
    expect(formatNTD(1234.9)).toBe('$1,234');
    expect(formatNTD(-1234)).toBe('$-1,234');
    expect(formatNTD(Number.NaN)).toBe('$0');
    expect(formatNTD(Number.POSITIVE_INFINITY)).toBe('$0');
  });
});

describe('formatAmount', () => {
  it('同 formatNTD 但無 $', () => {
    expect(formatAmount(1234)).toBe('1,234');
    expect(formatAmount(999)).toBe('999');
    expect(formatAmount(1000)).toBe('1,000');
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(1234567)).toBe('1,234,567');
  });
});

describe('parseAmountInput', () => {
  it('容忍千分位逗號、全形數字、前後空白', () => {
    expect(parseAmountInput('1,234')).toBe(1234);
    expect(parseAmountInput('１２３４')).toBe(1234);
    expect(parseAmountInput(' 500 ')).toBe(500);
    expect(parseAmountInput('　５００　')).toBe(500); // 全形空白＋全形數字
    expect(parseAmountInput('１，２３４')).toBe(1234); // 全形逗號
    expect(parseAmountInput('99,999,999')).toBe(99999999); // 恰在上限
    expect(parseAmountInput('0')).toBe(0);
    expect(parseAmountInput('007')).toBe(7); // 前導零寬容
  });

  it('拒絕：小數、負數、空白、非數字、超上限', () => {
    expect(parseAmountInput('12.5')).toBeNull();
    expect(parseAmountInput('-3')).toBeNull();
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('   ')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('12元')).toBeNull();
    expect(parseAmountInput('+5')).toBeNull();
    expect(parseAmountInput(',')).toBeNull(); // 剝完逗號只剩空字串
    expect(parseAmountInput('100000000')).toBeNull(); // 上限 + 1 位
    expect(parseAmountInput('99,999,999,999')).toBeNull();
  });

  it('property：合法整數元經 formatAmount 再 parse 必回原值（round-trip）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), (n) => {
        expect(parseAmountInput(formatAmount(n))).toBe(n);
        expect(parseAmountInput(String(n))).toBe(n);
      }),
    );
  });
});
