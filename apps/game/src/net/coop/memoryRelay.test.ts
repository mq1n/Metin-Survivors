import { describe, expect, it } from 'vitest';
import type { Loadout } from '@ms/shared';
import { MemoryNet, MemoryRoom } from './memoryRelay';

const LOADOUT: Loadout = { classId: 'warrior', doctrine: 'a', sex: 'm', empire: 'saehwa', tier: 0 };

async function lobby(n: number) {
  const net = new MemoryNet();
  const room = new MemoryRoom(net, { latencyMs: 10 });
  const ts = Array.from({ length: n }, (_, i) => room.client(`p${i}`, `P${i}`));
  for (const t of ts) {
    const p = t.connect();
    net.advance(50);
    await p;
    t.join(LOADOUT, t !== ts[0]);
    net.advance(50);
  }
  return { net, room, ts };
}

describe('memory relay (stand-in for the CoopRoom Durable Object)', () => {
  it('assigns slots, lets only the host start, and refuses late joiners', async () => {
    const { net, room, ts } = await lobby(3);
    expect(ts.map((t) => t.slot)).toEqual([0, 1, 2]);
    expect(room.host).toBe(0);
    const starts: number[] = [];
    for (const t of ts) t.on('start', (m) => starts.push(m.seed));
    ts[1]?.start('yeonmu', 'normal', 5);
    net.advance(100);
    expect(starts).toEqual([]);
    ts[0]?.start('yeonmu', 'normal', 5);
    net.advance(100);
    expect(starts).toEqual([5, 5, 5]);
    const late = room.client('late');
    let err = '';
    const p = late.connect().catch((e: Error) => (err = e.message));
    net.advance(100);
    await p;
    expect(err).toBe('room_in_progress');
  });

  it('routes inputs / picks to the host and snapshots to the guests, in order', async () => {
    const { net, room, ts } = await lobby(2);
    ts[0]?.start('yeonmu', 'normal', 1);
    net.advance(100);
    const got: string[] = [];
    ts[0]?.on('input', (m) => got.push(`input ${m.slot} ${m.seq}`));
    ts[0]?.on('pick', (m) => got.push(`pick ${m.slot} ${m.id}`));
    const frames: number[] = [];
    ts[1]?.on('snapshot', (s) => frames.push(s.header.seq));
    ts[1]?.input({ seq: 1, tick: 0, mx: 5, mz: -5 });
    ts[1]?.pick(9, 1);
    ts[1]?.input({ seq: 2, tick: 0, mx: 0, mz: 0 });
    for (let i = 1; i <= 5; i++) ts[0]?.sendSnapshot({ flags: 2, seq: i, tick: i * 4, baseDelta: 0 }, new Uint8Array(100));
    net.advance(200);
    expect(got).toEqual(['input 1 1', 'pick 1 9', 'input 1 2']);
    expect(frames).toEqual([1, 2, 3, 4, 5]);
    expect(room.traffic.snapshotFrames).toBe(5);
    expect(room.traffic.violations).toEqual([]);
  });

  it('enforces the size cap and the token buckets like the real relay', async () => {
    const { net, room, ts } = await lobby(2);
    ts[0]?.start('yeonmu', 'normal', 1);
    net.advance(100);
    expect(ts[0]?.sendSnapshot({ flags: 1, seq: 1, tick: 0, baseDelta: 0 }, new Uint8Array(50_000))).toBe(false);
    expect(ts[1]?.sendSnapshot({ flags: 1, seq: 1, tick: 0, baseDelta: 0 }, new Uint8Array(10))).toBe(false);
    // 200 inputs in one instant: only the burst (60) gets through
    let got = 0;
    ts[0]?.on('input', () => got++);
    for (let i = 0; i < 200; i++) ts[1]?.input({ seq: i + 1, tick: 0, mx: 1, mz: 1 });
    net.advance(500);
    expect(got).toBeLessThanOrEqual(75);
    expect(got).toBeGreaterThanOrEqual(60);
    expect(room.traffic.violations.length).toBeGreaterThan(100);
  });

  it('moves the host seat to the next connected player and bumps the epoch', async () => {
    const { net, room, ts } = await lobby(3);
    ts[0]?.start('yeonmu', 'normal', 1);
    net.advance(100);
    const causes: string[] = [];
    ts[1]?.on('roomState', (m) => causes.push(m.cause?.kind ?? ''));
    ts[0]?.drop();
    net.advance(100);
    expect(room.host).toBe(1);
    expect(room.epoch).toBe(2);
    expect(ts[1]?.isHost).toBe(true);
    expect(causes).toContain('hostChanged');
    // the old host rejoins its slot as a guest
    const re = ts[0]?.reconnect();
    net.advance(100);
    await re;
    expect(ts[0]?.slot).toBe(0);
    expect(ts[0]?.isHost).toBe(false);
  });
});
