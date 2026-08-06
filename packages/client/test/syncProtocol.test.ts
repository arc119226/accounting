/**
 * 同步協定純 reducer 測試：把 A、B 兩個 reducer 對接（A 的 send 效果變 B 的 msg 事件），
 * 用「事件泵」跑完整協定——不碰 WebRTC，驗證雙向完成、checkpoint 同值、中斷路徑。
 */
import { describe, expect, it } from 'vitest';
import type { MergeSummary, Syncable } from '@zhangben/core';
import {
  checkpointOf,
  makeSession,
  syncReduce,
  type PeerHello,
  type SyncEffect,
  type SyncEvent,
  type SyncKind,
  type SyncSession,
} from '../src/sync/protocol';

function hello(device: string, hlc: string): PeerHello {
  return {
    deviceId: device,
    personId: `person-${device}`,
    personName: device === 'aaa' ? '甲' : '乙',
    hlcNow: hlc,
    wallMs: 1000,
    checkpoints: {},
  };
}

const row = (id: string): Syncable => ({ id, updatedAt: '000000000000005-0000-x', deviceId: 'x', deleted: false });
const SUM: MergeSummary = { added: 1, updated: 0, skipped: 0, deletes: 0 };

/** 事件泵：模擬殼層。send→對面 msg 事件；stream-batches→依 outbox 造 batch+sent-all；apply→applied。 */
interface Sim {
  s: SyncSession;
  inbox: SyncEvent[];
  saved: { checkpoint: string } | null;
  left: boolean;
  outbox: readonly { kind: SyncKind; rows: readonly Syncable[] }[];
}

function pump(a: Sim, b: Sim): void {
  let guard = 0;
  while ((a.inbox.length > 0 || b.inbox.length > 0) && guard++ < 200) {
    for (const [self, other] of [[a, b], [b, a]] as const) {
      while (self.inbox.length > 0) {
        const ev = self.inbox.shift()!;
        const [next, effects] = syncReduce(self.s, ev);
        self.s = next;
        for (const fx of effects) runFx(self, other, fx);
      }
    }
  }
  expect(guard).toBeLessThan(200);
}

function runFx(self: Sim, other: Sim, fx: SyncEffect): void {
  switch (fx.f) {
    case 'send':
      if (!other.left) other.inbox.push({ e: 'msg', msg: fx.msg });
      break;
    case 'stream-batches': {
      let total = 0;
      let seq = 0;
      for (const batch of self.outbox) {
        total += batch.rows.length;
        seq += 1;
        if (!other.left) other.inbox.push({ e: 'msg', msg: { t: 'batch', kind: batch.kind, rows: batch.rows, seq } });
      }
      self.inbox.push({ e: 'sent-all', totalSent: total });
      break;
    }
    case 'apply':
      // 殼層套用後回報 applied（本測試以固定摘要代替真實合併）
      self.inbox.push({ e: 'applied', kind: fx.kind, summary: SUM, deduped: 0, rejected: 0 });
      break;
    case 'save-checkpoint':
      self.saved = { checkpoint: fx.checkpoint };
      break;
    case 'leave':
      self.left = true;
      break;
  }
}

function makeSim(device: string, hlc: string, outbox: Sim['outbox']): Sim {
  return { s: makeSession(hello(device, hlc)), inbox: [], saved: null, left: false, outbox };
}

describe('sync 協定（雙 reducer 對打）', () => {
  it('happy path：雙向完成、兩側 checkpoint 同值=min(雙 hello)、摘要累計', () => {
    const a = makeSim('aaa', '000000000000010-0000-aaa', [{ kind: 'records', rows: [row('r1'), row('r2')] }]);
    const b = makeSim('bbb', '000000000000007-0000-bbb', [{ kind: 'records', rows: [row('r3')] }, { kind: 'rules', rows: [row('12345678')] }]);
    a.inbox.push({ e: 'peer-join' });
    b.inbox.push({ e: 'peer-join' });
    pump(a, b);
    expect(a.s.phase).toBe('done');
    expect(b.s.phase).toBe('done');
    expect(a.saved?.checkpoint).toBe('000000000000007-0000-bbb');
    expect(b.saved?.checkpoint).toBe(a.saved?.checkpoint);
    expect(checkpointOf(a.s.my, b.s.my)).toBe(a.saved?.checkpoint);
    // A 收到 B 的 2 批=套用 2 次摘要
    expect(a.s.totals.added).toBe(2);
    expect(b.s.totals.added).toBe(1);
    expect(a.left).toBe(true);
    expect(b.left).toBe(true);
  });

  it('零資料同步：0 批也能完成握手', () => {
    const a = makeSim('aaa', '000000000000010-0000-aaa', []);
    const b = makeSim('bbb', '000000000000011-0000-bbb', []);
    a.inbox.push({ e: 'peer-join' });
    b.inbox.push({ e: 'peer-join' });
    pump(a, b);
    expect(a.s.phase).toBe('done');
    expect(b.s.phase).toBe('done');
  });

  it('等待中 timeout → no-peer；交換中 timeout → stalled', () => {
    const a = makeSim('aaa', '000000000000010-0000-aaa', []);
    let [s1] = syncReduce(a.s, { e: 'timeout' });
    expect(s1.phase).toBe('error');
    expect(s1.error).toBe('no-peer');

    const b = makeSim('bbb', '000000000000011-0000-bbb', []);
    [s1] = syncReduce(b.s, { e: 'msg', msg: { t: 'hello', hello: hello('aaa', '000000000000010-0000-aaa') } });
    expect(s1.phase).toBe('exchanging');
    const [s2] = syncReduce(s1, { e: 'timeout' });
    expect(s2.error).toBe('stalled');
  });

  it('交換中對方離開 → peer-left 錯誤 + leave；等待中離開=繼續等', () => {
    const b = makeSim('bbb', '000000000000011-0000-bbb', []);
    const [waiting, fx0] = syncReduce(b.s, { e: 'peer-leave' });
    expect(waiting.phase).toBe('waiting');
    expect(fx0).toEqual([]);

    const [ex] = syncReduce(b.s, { e: 'msg', msg: { t: 'hello', hello: hello('aaa', '000000000000010-0000-aaa') } });
    const [after, fx] = syncReduce(ex, { e: 'peer-leave' });
    expect(after.phase).toBe('error');
    expect(after.error).toBe('peer-left');
    expect(fx.some((f) => f.f === 'leave')).toBe(true);
  });

  it('重複 hello 冪等；hello 前的 batch/done/ack 被忽略', () => {
    const b = makeSim('bbb', '000000000000011-0000-bbb', []);
    const h = hello('aaa', '000000000000010-0000-aaa');
    const [s1, fx1] = syncReduce(b.s, { e: 'msg', msg: { t: 'hello', hello: h } });
    expect(fx1.filter((f) => f.f === 'stream-batches')).toHaveLength(1);
    const [s2, fx2] = syncReduce(s1, { e: 'msg', msg: { t: 'hello', hello: h } });
    expect(s2).toBe(s1);
    expect(fx2).toEqual([]);

    const fresh = makeSim('ccc', '000000000000011-0000-ccc', []);
    const [s3, fx3] = syncReduce(fresh.s, { e: 'msg', msg: { t: 'batch', kind: 'records', rows: [row('r1')], seq: 1 } });
    expect(s3.receivedBatches).toBe(0);
    expect(fx3).toEqual([]);
  });

  it('cancel：送 bye + leave，之後事件全吞', () => {
    const a = makeSim('aaa', '000000000000010-0000-aaa', []);
    const [s1, fx] = syncReduce(a.s, { e: 'cancel' });
    expect(s1.phase).toBe('cancelled');
    expect(fx.map((f) => f.f)).toEqual(['send', 'leave']);
    const [s2, fx2] = syncReduce(s1, { e: 'peer-join' });
    expect(s2).toBe(s1);
    expect(fx2).toEqual([]);
  });

  it('done 先到、applied 後到：ack 要等全部套完才送', () => {
    const b = makeSim('bbb', '000000000000011-0000-bbb', []);
    const h = hello('aaa', '000000000000010-0000-aaa');
    let [s] = syncReduce(b.s, { e: 'msg', msg: { t: 'hello', hello: h } });
    let fx: SyncEffect[];
    [s, fx] = syncReduce(s, { e: 'msg', msg: { t: 'batch', kind: 'records', rows: [row('r1')], seq: 1 } });
    [s, fx] = syncReduce(s, { e: 'msg', msg: { t: 'done', totalSent: 1 } });
    // 批還沒套完：不可送 ack
    expect(fx.every((f) => !(f.f === 'send' && f.msg.t === 'ack'))).toBe(true);
    [s, fx] = syncReduce(s, { e: 'applied', kind: 'records', summary: SUM, deduped: 0, rejected: 0 });
    expect(fx.some((f) => f.f === 'send' && f.msg.t === 'ack')).toBe(true);
  });

  it('丟批偵測：wire 截斷一批（實收列數 < done.totalSent）⇒ 永不 ack，timeout 收 stalled、不存 checkpoint', () => {
    const b = makeSim('bbb', '000000000000011-0000-bbb', []);
    const h = hello('aaa', '000000000000010-0000-aaa');
    let [s] = syncReduce(b.s, { e: 'msg', msg: { t: 'hello', hello: h } });
    // 對方送了 2 批共 3 列，第一批（2 列）被 wire 靜默截斷——只收到第二批
    let fx: SyncEffect[];
    [s, fx] = syncReduce(s, { e: 'msg', msg: { t: 'batch', kind: 'records', rows: [row('r3')], seq: 2 } });
    [s] = syncReduce(s, { e: 'applied', kind: 'records', summary: SUM, deduped: 0, rejected: 0 });
    [s, fx] = syncReduce(s, { e: 'msg', msg: { t: 'done', totalSent: 3 } });
    // 列數對不上：批次都套完了也不准 ack
    expect(s.receivedRows).toBe(1);
    expect(s.expectedRows).toBe(3);
    expect(fx.every((f) => !(f.f === 'send' && f.msg.t === 'ack'))).toBe(true);
    // stall timeout → 可重試錯誤；效果裡沒有 save-checkpoint
    const [s2, fx2] = syncReduce(s, { e: 'timeout' });
    expect(s2.phase).toBe('error');
    expect(s2.error).toBe('stalled');
    expect(fx2.every((f) => f.f !== 'save-checkpoint')).toBe(true);
  });

  it('apply-failed：落盤壞掉 ⇒ error + bye + leave，不存 checkpoint；對面收 bye 也走 error', () => {
    const b = makeSim('bbb', '000000000000011-0000-bbb', []);
    const h = hello('aaa', '000000000000010-0000-aaa');
    let [s] = syncReduce(b.s, { e: 'msg', msg: { t: 'hello', hello: h } });
    [s] = syncReduce(s, { e: 'msg', msg: { t: 'batch', kind: 'records', rows: [row('r1')], seq: 1 } });
    const [s2, fx] = syncReduce(s, { e: 'apply-failed' });
    expect(s2.phase).toBe('error');
    expect(s2.error).toBe('apply-failed');
    expect(fx.some((f) => f.f === 'send' && f.msg.t === 'bye')).toBe(true);
    expect(fx.some((f) => f.f === 'leave')).toBe(true);
    expect(fx.every((f) => f.f !== 'save-checkpoint')).toBe(true);
    // 對面（交換中）收到 bye → peer-left 錯誤、同樣不存 checkpoint
    const a = makeSim('aaa', '000000000000010-0000-aaa', []);
    const [sa] = syncReduce(a.s, { e: 'msg', msg: { t: 'hello', hello: hello('bbb', '000000000000011-0000-bbb') } });
    const [sa2, fxa] = syncReduce(sa, { e: 'msg', msg: { t: 'bye' } });
    expect(sa2.phase).toBe('error');
    expect(fxa.every((f) => f.f !== 'save-checkpoint')).toBe(true);
  });
});
