/**
 * notice.ts 的兩槽模型。
 *
 * 這支存在的理由是一條**跨檔案的鏈**，單看任一支都不像 bug：
 * 離線 → 掃描頁 chunk 抓不到 → noteChunkLoadFailure 誤判成新版 → updateReady 常駐
 * → 舊版的單槽模型從此吞掉所有通知 → **刪除沒有復原鈕、入帳沒有回饋、存檔失敗靜默**。
 * 舊註解說「可接受，因為刪除前有 ConfirmDialog 擋著」——那擋的是誤觸，
 * 而復原鈕是為了刪錯筆存在的。
 *
 * 所以這裡鎖的核心不變量只有一句：**updateReady 掛著時，事件通知照樣看得到。**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismiss, dismissSticky, getNotice, show, showAction, subscribe } from '../src/notice';

beforeEach(() => {
  // 模組級狀態：每條測試前清乾淨（先清事件、再清常駐）
  dismiss();
  dismissSticky();
});

describe('notice 兩槽（sticky=狀態 / current=事件）', () => {
  it('沒有通知時是 null', () => {
    expect(getNotice()).toBeNull();
  });

  it('updateReady 掛著時，入帳回饋照樣看得到（舊版會被吞掉）', () => {
    show('updateReady');
    expect(getNotice()?.kind).toBe('updateReady');
    show('saved', '已記一筆 $250');
    expect(getNotice()).toEqual({ kind: 'saved', text: '已記一筆 $250' });
  });

  it('updateReady 掛著時，復原鈕照樣出得來——這是刪錯筆的唯一救回路徑', () => {
    show('updateReady');
    const run = vi.fn();
    showAction('已刪除 $250', { label: '復原', run });
    const n = getNotice();
    expect(n?.kind).toBe('undo');
    expect(n?.action?.label).toBe('復原');
    n?.action?.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it('事件退場後，常駐的 updateReady 自己回來', () => {
    show('updateReady');
    show('saved', '已記一筆 $250');
    expect(getNotice()?.kind).toBe('saved');
    dismiss();
    expect(getNotice()?.kind).toBe('updateReady');
  });

  it('dismiss 先收事件、再按一次才收常駐（兩槽各自獨立）', () => {
    show('updateReady');
    show('saveFailed');
    dismiss();
    expect(getNotice()?.kind).toBe('updateReady');
    dismiss();
    expect(getNotice()).toBeNull();
  });

  it('dismissSticky 直接收掉常駐，不動眼前的事件', () => {
    show('updateReady');
    show('saved', 'x');
    dismissSticky();
    expect(getNotice()?.kind).toBe('saved');
    dismiss();
    expect(getNotice()).toBeNull();
  });

  it('沒有 updateReady 時，事件之間互相取代（維持原本行為）', () => {
    show('saved', 'a');
    show('saveFailed');
    expect(getNotice()?.kind).toBe('saveFailed');
    showAction('已刪除 $1', { label: '復原', run: () => {} });
    expect(getNotice()?.kind).toBe('undo');
  });

  it('每次變動都通知訂閱者；取消訂閱後不再收到', () => {
    const cb = vi.fn();
    const off = subscribe(cb);
    show('saved', 'a');
    show('updateReady');
    dismiss();
    expect(cb).toHaveBeenCalledTimes(3);
    off();
    show('saved', 'b');
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('text 省略時不帶 text 欄（exactOptionalPropertyTypes：鍵不存在 ≠ undefined）', () => {
    show('updateReady');
    expect('text' in (getNotice() as object)).toBe(false);
  });
});
