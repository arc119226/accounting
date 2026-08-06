/**
 * rowSchema：兩條入口（檔案匯入 + P2P）共用的「這列長得對不對」。
 *
 * 為什麼值得一支獨立測試：`core/merge.ts` 只依賴「HLC 定寬 ⇒ 字典序即全序」這條
 * 契約、刻意不驗證，而 merge.test.ts 的 hlcArb 一律生 8 字定寬 hex——**格式壞掉的
 * updatedAt 這整個面向在 core 那邊零覆蓋**。守它的是這一層，所以驗證要寫在這裡。
 *
 * 最關鍵的一條是 'zzz'：真 HLC 一律以數字開頭，所以任何字母開頭的字串字典序
 * 都勝過全部真實時間戳，而且此後**任何**編輯都覆蓋不掉它。若它是墓碑，
 * 就是一筆永遠復活不了的記錄。
 */
import { describe, expect, it } from 'vitest';
import { ROW_OK, budgetOk, categoryOk, personOk, recordOk, ruleOk } from '../src/sync/rowSchema';

const HLC = '000000000000010-0001-dev';

const envelope = { id: 'r1', updatedAt: HLC, deviceId: 'dev', deleted: false };

const record = {
  ...envelope,
  amount: 120,
  date: '2026-08-06',
  categoryId: 'cat-food',
  note: '',
  paidBy: 'p-alice',
  source: 'manual',
};

const category = { ...envelope, id: 'cat-x', name: '旅遊', glyph: '旅', color: '#123456', order: 9, builtin: false };
const rule = { ...envelope, id: '12345678', categoryId: 'cat-food', displayName: '全聯' };
const person = { ...envelope, id: 'p-alice', name: '甲' };
const budget = { ...envelope, id: 'budget', monthlyTotal: 30000, perCategory: {} };

describe('信封（所有類別共用的四個欄位）', () => {
  it('好列全通過', () => {
    expect(recordOk(record)).toBe(true);
    expect(categoryOk(category)).toBe(true);
    expect(ruleOk(rule)).toBe(true);
    expect(personOk(person)).toBe(true);
    expect(budgetOk(budget)).toBe(true);
  });

  it("updatedAt='zzz'：字典序永勝的偽造值必須被擋下（這是整層的存在理由）", () => {
    // 先確認威脅是真的——'zzz' 確實勝過一個很大的真 HLC
    expect('zzz' > '999999999999999-ffff-dev').toBe(true);
    for (const ok of [recordOk, categoryOk, ruleOk, personOk, budgetOk]) {
      expect(ok({ ...record, ...category, ...rule, ...person, ...budget, updatedAt: 'zzz' })).toBe(false);
    }
  });

  it('updatedAt 的非正準形一律拒收（寬度不對、大寫 hex、缺 device、非字串）', () => {
    const bad = [
      '00000000010-0001-dev', // ms 只有 11 位
      '0000000000000010-0001-dev', // ms 16 位
      '000000000000010-0001', // 沒有 device 段
      '000000000000010-000G-dev', // hex 非法字元
      '000000000000010-0001-', // device 空字串（正準形要求非空）
      '',
      42,
      null,
      undefined,
    ];
    for (const updatedAt of bad) {
      expect(recordOk({ ...record, updatedAt }), String(updatedAt)).toBe(false);
    }
  });

  it('id 空字串、deleted 非布林、非物件一律拒收', () => {
    expect(recordOk({ ...record, id: '' })).toBe(false);
    expect(recordOk({ ...record, deleted: 'true' })).toBe(false);
    expect(recordOk(null)).toBe(false);
    expect(recordOk('r1')).toBe(false);
    expect(recordOk([])).toBe(false);
  });
});

describe('各類別的必要欄位', () => {
  it('記錄：amount 必須是整數（金額鐵律是整數新台幣元）', () => {
    expect(recordOk({ ...record, amount: 12.5 })).toBe(false);
    expect(recordOk({ ...record, amount: '120' })).toBe(false);
    expect(recordOk({ ...record, amount: NaN })).toBe(false);
    expect(recordOk({ ...record, amount: 0 })).toBe(true);
  });

  it('記錄：date 要是真實存在的日期', () => {
    expect(recordOk({ ...record, date: '2026-02-30' })).toBe(false);
    expect(recordOk({ ...record, date: '2026-8-6' })).toBe(false);
    expect(recordOk({ ...record, date: '2024-02-29' })).toBe(true); // 閏年
  });

  it('記錄：paidBy 空字串拒收（v2 的 paidBy 是 Person.id，空的畫不出人）', () => {
    expect(recordOk({ ...record, paidBy: '' })).toBe(false);
  });

  it('記錄：source 只認 manual / einvoice', () => {
    expect(recordOk({ ...record, source: 'imported' })).toBe(false);
    expect(recordOk({ ...record, source: 'einvoice' })).toBe(true);
  });

  it('記錄：invoice 可省略，但給了就要有 number 與 randomCode', () => {
    expect(recordOk({ ...record, invoice: { number: 'AB11111111', randomCode: '1234' } })).toBe(true);
    expect(recordOk({ ...record, invoice: { number: 'AB11111111' } })).toBe(false);
    expect(recordOk({ ...record, invoice: null })).toBe(false);
  });

  it('分類：order 要是數字、builtin 要是布林', () => {
    expect(categoryOk({ ...category, order: '9' })).toBe(false);
    expect(categoryOk({ ...category, builtin: 1 })).toBe(false);
  });

  it('人物：name 空字串拒收（同步過來就是要拿來顯示的）', () => {
    expect(personOk({ ...person, name: '' })).toBe(false);
  });

  it('預算：perCategory 必須是物件、不可為 null', () => {
    expect(budgetOk({ ...budget, perCategory: null })).toBe(false);
    expect(budgetOk({ ...budget, monthlyTotal: '30000' })).toBe(false);
  });
});

describe('ROW_OK（P2P 依 kind 取驗證器）', () => {
  it('五個 kind 都對到正確的驗證器', () => {
    expect(ROW_OK.records).toBe(recordOk);
    expect(ROW_OK.categories).toBe(categoryOk);
    expect(ROW_OK.rules).toBe(ruleOk);
    expect(ROW_OK.persons).toBe(personOk);
    expect(ROW_OK.budget).toBe(budgetOk);
  });

  it('用錯 kind 驗會拒收：記錄不會被當成分類收下', () => {
    expect(ROW_OK.categories(record)).toBe(false);
    expect(ROW_OK.records(category)).toBe(false);
  });

  it('過濾一批混雜列：好的留下、壞的丟掉（syncSlice.applyBatch 的作法）', () => {
    const batch = [record, { ...record, id: 'r2', updatedAt: 'zzz' }, { ...record, id: 'r3' }];
    const kept = batch.filter((r) => ROW_OK.records(r));
    expect(kept.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(batch.length - kept.length).toBe(1); // = 摘要卡上的「拒收 1 筆」
  });
});
