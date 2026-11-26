import { describe, expect, it } from 'vitest';
import { EnemyFlag, EnemyState, EnemyStore, StatusBit } from '../../../../sim/stores';
import type { World } from '../../../../sim/world';
import type { SpawnOpts, Vfx } from '../../../types';
import { COMBAT_SPECS } from '../combat';
import { MAX_LOOPS, StatusVfxFeed } from '../statusFeed';

/** spec `lift` per id (the host adds it to the y the feed passes) */
const LIFT_OF: Record<string, number> = Object.fromEntries(COMBAT_SPECS.map((sp) => [sp.id, sp.lift ?? 0]));

interface FakeVfx {
  vfx: Vfx;
  spawns: { id: string; x: number; y: number; scale: number; handle: number; rot: number }[];
  moves: number;
  stopped: number[];
  live: Set<number>;
  /** instances that ended on their own (pool eviction, a duration): not live, never stopped by the feed */
  ended: Set<number>;
}

function fakeVfx(): FakeVfx {
  const f: FakeVfx = { vfx: null as unknown as Vfx, spawns: [], moves: 0, stopped: [], live: new Set(), ended: new Set() };
  let next = 1;
  f.vfx = {
    spawn(id: string, o?: SpawnOpts): number {
      const handle = id.endsWith('_loop') ? next++ : 0;
      if (handle) f.live.add(handle);
      f.spawns.push({ id, x: o?.x ?? 0, y: o?.y ?? 0, scale: o?.scale ?? 1, handle, rot: o?.rot ?? 0 });
      return handle;
    },
    move(h: number): void {
      expect(f.live.has(h)).toBe(true);
      f.moves++;
    },
    alive(h: number): boolean {
      return f.live.has(h);
    },
    stop(h: number): void {
      expect(f.live.delete(h)).toBe(true);
      f.stopped.push(h);
    },
  } as unknown as Vfx;
  return f;
}

function world(): { w: World; E: EnemyStore } {
  const E = new EnemyStore(128);
  const w = { enemies: E, players: [{ x: 0, z: 0, alive: true }] } as unknown as World;
  return { w, E };
}

function addEnemy(E: EnemyStore, x: number, status: number, flags = 0): number {
  const row = E.alloc();
  E.x[row] = E.px[row] = x;
  E.z[row] = E.pz[row] = 0;
  E.radius[row] = 0.45;
  E.state[row] = EnemyState.Move;
  E.status[row] = status;
  E.flags[row] = flags;
  return E.id[row] as number;
}

const ground = (): number => 0;

describe('StatusVfxFeed', () => {
  it('spawns one loop per status when the bit appears, a stun burst on the rising edge, then only moves', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    addEnemy(E, 2, StatusBit.Poison | StatusBit.Stun);
    feed.update(w, f.vfx, 1, ground);
    expect(f.spawns.map((s) => s.id).sort()).toEqual(['sk.gen.poison_loop', 'sk.gen.stun', 'sk.gen.stun_loop']);
    feed.update(w, f.vfx, 1, ground);
    feed.update(w, f.vfx, 1, ground);
    expect(f.spawns).toHaveLength(3);
    expect(f.moves).toBe(4);
    expect(feed.liveLoops).toBe(2);
  });

  it('stops a loop when its bit clears and every loop when the enemy is removed or dies', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    const a = addEnemy(E, 2, StatusBit.Burn | StatusBit.Slow);
    addEnemy(E, 3, StatusBit.Poison);
    feed.update(w, f.vfx, 1, ground);
    expect(f.live.size).toBe(3);

    E.status[E.find(a)] = StatusBit.Slow;
    feed.update(w, f.vfx, 1, ground);
    expect(f.stopped).toHaveLength(1);
    expect(f.spawns.find((s) => s.handle === f.stopped[0])?.id).toBe('sk.gen.fire_loop');

    E.free(E.find(a));
    feed.update(w, f.vfx, 1, ground);
    expect(f.live.size).toBe(1);

    E.state[0] = EnemyState.Dying;
    feed.update(w, f.vfx, 1, ground);
    expect(f.live.size).toBe(0);
    expect(feed.liveLoops).toBe(0);
  });

  it('skips metin rows', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    addEnemy(E, 2, StatusBit.Poison, EnemyFlag.Metin);
    feed.update(w, f.vfx, 1, ground);
    expect(f.spawns).toHaveLength(0);
  });

  it('caps live loops, keeps the enemies nearest the players and hands freed budget to the next ones', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    for (let i = 0; i < 60; i++) addEnemy(E, 60 - i, StatusBit.Slow);
    feed.update(w, f.vfx, 1, ground);
    expect(f.live.size).toBe(MAX_LOOPS);
    expect(Math.max(...f.spawns.map((s) => s.x))).toBe(MAX_LOOPS);
    for (let k = 0; k < 3; k++) feed.update(w, f.vfx, 1, ground);
    expect(f.spawns).toHaveLength(MAX_LOOPS);

    // the nearest enemy loses its status: the next one in line gets its loop
    for (let r = 0; r < E.count; r++) if (E.x[r] === 1) E.status[r] = 0;
    feed.update(w, f.vfx, 1, ground);
    expect(f.live.size).toBe(MAX_LOOPS);
    expect(f.spawns.at(-1)?.x).toBe(MAX_LOOPS + 1);
  });

  it('scales bigger bodies (mean of the radius and the height ratio of a humanoid) and anchors the stun ring over the head', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    addEnemy(E, 2, StatusBit.Stun);
    E.radius[0] = 0.9;
    feed.update(w, f.vfx, 1, () => 5);
    const loop = f.spawns.find((s) => s.id === 'sk.gen.stun_loop');
    expect(loop?.scale).toBeCloseTo(1.5);
    // the unknown model falls back to a 1.76 m humanoid: the host adds the spec lift (1.88 m), so the feed hands over ground + head - lift = ground
    expect(loop?.y).toBeCloseTo(5, 5);
  });

  it('anchors every loop on the model of the enemy: a boar is poisoned at its torso, burns at its torso, slows at its feet', () => {
    const { w, E } = world();
    (w as unknown as { typeDefs: { model: string }[] }).typeDefs = [{ model: 'boar' }];
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    addEnemy(E, 2, StatusBit.Stun | StatusBit.Poison | StatusBit.Burn | StatusBit.Slow);
    E.type[0] = 0;
    E.scale[0] = 1;
    E.radius[0] = 0.6;
    feed.update(w, f.vfx, 1, () => 0);
    const world_y = (id: string): number => {
      const sp = f.spawns.find((s) => s.id === id);
      return (sp?.y ?? NaN) + (LIFT_OF[id] ?? 0);
    };
    // boar: 0.88 m high, quadruped
    expect(world_y('sk.gen.poison_loop')).toBeCloseTo(0.88 * 0.56, 3);
    expect(world_y('sk.gen.fire_loop')).toBeCloseTo(0.88 * 0.56, 3);
    expect(world_y('sk.gen.stun_loop')).toBeCloseTo(0.88 * 0.98 + 0.12, 3);
    expect(world_y('sk.gen.slow_loop')).toBeCloseTo(0.04, 3);
  });

  it('respawns a loop whose instance ended while the status bit is still set (no stale handle, no stop of the dead one)', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    addEnemy(E, 2, StatusBit.Poison);
    feed.update(w, f.vfx, 1, ground);
    expect(f.spawns).toHaveLength(1);
    const dead = f.spawns[0]?.handle as number;
    f.live.delete(dead);
    f.ended.add(dead);
    feed.update(w, f.vfx, 1, ground);
    expect(f.spawns).toHaveLength(2);
    expect(f.spawns[1]?.handle).not.toBe(dead);
    expect(f.stopped).toHaveLength(0);
    expect(f.live.size).toBe(1);
    feed.update(w, f.vfx, 1, ground);
    expect(f.spawns).toHaveLength(2);
  });
  it('gives every stunned enemy its own yaw so the orbiting stars of a crowd stunned on one frame do not line up (only the stun loop + burst are turned)', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    for (let i = 0; i < 6; i++) addEnemy(E, 2 + i, StatusBit.Stun | StatusBit.Burn);
    feed.update(w, f.vfx, 1, ground);
    const stun = f.spawns.filter((sp) => sp.id === 'sk.gen.stun_loop').map((sp) => sp.rot);
    expect(stun).toHaveLength(6);
    expect(new Set(stun.map((r) => r.toFixed(3))).size).toBe(6);
    for (const r of stun) expect(r >= 0 && r < Math.PI * 2).toBe(true);
    // the burst of an enemy turns with its loop; the other loops stay at yaw 0
    const bursts = f.spawns.filter((sp) => sp.id === 'sk.gen.stun');
    expect(bursts.length).toBeGreaterThan(0);
    for (const sp of f.spawns.filter((x) => x.id === 'sk.gen.fire_loop')) expect(sp.rot).toBe(0);
  });

  it('SIM-09: 1,000 same-slot generation replacements without an empty frame never duplicate active entries or drift liveLoops', () => {
    const { w, E } = world();
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    let id = addEnemy(E, 2, StatusBit.Poison);
    feed.update(w, f.vfx, 1, ground);
    expect(feed.liveLoops).toBe(1);
    expect(f.live.size).toBe(1);
    expect((feed as unknown as { activeN: number }).activeN).toBe(1);

    for (let i = 0; i < 1000; i++) {
      E.free(E.find(id));
      id = addEnemy(E, 2, StatusBit.Poison);
      feed.update(w, f.vfx, 1, ground);
    }

    expect(feed.liveLoops).toBe(1);
    expect(f.live.size).toBe(1);
    expect((feed as unknown as { activeN: number }).activeN).toBe(1);
    expect(f.stopped).toHaveLength(1000);
    expect(f.spawns).toHaveLength(1001);

    // freeing the final enemy cleanly drops back to zero
    E.free(E.find(id));
    feed.update(w, f.vfx, 1, ground);
    expect(feed.liveLoops).toBe(0);
    expect(f.live.size).toBe(0);
    expect((feed as unknown as { activeN: number }).activeN).toBe(0);
  });

  it('SIM-10: selects the 24 nearest slowed enemies on frame 1 even when candidate count triggers grow() (300 and 600)', () => {
    for (const total of [257, 300, 513, 600]) {
      const E = new EnemyStore(768);
      const w = { enemies: E, players: [{ x: 0, z: 0, alive: true }] } as unknown as World;
      const f = fakeVfx();
      const feed = new StatusVfxFeed();
      // insert far-to-near so unsorted / wiped keys would pick distant rows
      for (let i = 0; i < total; i++) addEnemy(E, total - i, StatusBit.Slow);

      feed.update(w, f.vfx, 1, ground);

      expect(f.live.size, `total=${total}`).toBe(MAX_LOOPS);
      expect(feed.liveLoops, `total=${total}`).toBe(MAX_LOOPS);
      const pickedXs = f.spawns.map((s) => s.x).sort((a, b) => a - b);
      expect(pickedXs, `total=${total}`).toEqual(Array.from({ length: MAX_LOOPS }, (_, i) => i + 1));
    }

    // also verify growing across multiple frames from a smaller nonzero previous frame (50 -> 300 -> 600)
    const E = new EnemyStore(768);
    const w = { enemies: E, players: [{ x: 0, z: 0, alive: true }] } as unknown as World;
    const f = fakeVfx();
    const feed = new StatusVfxFeed();
    for (let i = 0; i < 50; i++) addEnemy(E, 1000 - i, StatusBit.Slow);
    feed.update(w, f.vfx, 1, ground);
    expect(f.live.size).toBe(MAX_LOOPS);
    // add 550 closer enemies so grow() triggers twice (256 -> 512 -> 1024) on one frame
    for (let i = 0; i < 550; i++) addEnemy(E, 550 - i, StatusBit.Slow);
    feed.update(w, f.vfx, 1, ground);
    expect(feed.liveLoops).toBe(MAX_LOOPS);
    expect(f.live.size).toBe(MAX_LOOPS);
    // clear old far ones so only nearest 24 remain once budget frees
    for (let r = 0; r < E.count; r++) if ((E.x[r] as number) > 550) E.status[r] = 0;
    feed.update(w, f.vfx, 1, ground);
    const liveXs = f.spawns
      .filter((s) => f.live.has(s.handle))
      .map((s) => s.x)
      .sort((a, b) => a - b);
    expect(liveXs).toEqual(Array.from({ length: MAX_LOOPS }, (_, i) => i + 1));
  });
});
