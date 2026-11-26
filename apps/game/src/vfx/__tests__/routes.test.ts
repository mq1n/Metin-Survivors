// C1: sim event → preset id tables for the vfx/common/<target>/route.ts routes (the EventAdapter dispatches to them).
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../sim/events';
import { PickupKind } from '../../sim/stores';
import { COMMON_TARGETS } from '../common';
import { PICKUP } from '../common/pickups/route';
import type { RouteCtx } from '../common/route';
import type { Resolved } from '../presets';
import type { SpawnOpts } from '../types';

interface Fired {
  id: string;
  o: SpawnOpts;
}

function harness(over: Partial<RouteCtx> = {}) {
  const fired: Fired[] = [];
  const marks = new Map<string, number>();
  const live = new Set<number>();
  let time = 0;
  let next = 1;
  const ctx: RouteCtx = {
    get time() {
      return time;
    },
    density: 1,
    players: new Float32Array([3, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    heightAt: () => 0,
    resolve: (id) => ({ def: { id }, palette: null, element: -1, variant: -1 }) as unknown as Resolved,
    o: (x, z, scale, dirX, dirZ) => ({ x, z, scale, dirX, dirZ }),
    fire: (id, o) => {
      fired.push({ id, o: { ...o } });
      const h = next++;
      live.add(h);
      return h;
    },
    spawnResolved: (r, o) => {
      fired.push({ id: r.def.id, o: { ...o } });
      return 0;
    },
    stop: (h) => void live.delete(h),
    alive: (h) => live.has(h),
    once: (k, w) => {
      const t = marks.get(k);
      if (t !== undefined && time - t < w) return false;
      marks.set(k, time);
      return true;
    },
    since: (k) => {
      const t = marks.get(k);
      return t === undefined ? Infinity : time - t;
    },
    mark: (k) => void marks.set(k, time),
    deathPreset: () => undefined,
    metinRune: () => 0x6aa8ff,
    bossPos: () => false,
    telegraphEvents: false,
    ...over,
  };
  const routes = COMMON_TARGETS.flatMap((t) => t.routes?.() ?? []);
  const send = (e: Partial<SimEvent> & { t: SimEvent['t'] }): string[] => {
    const n = fired.length;
    for (const r of routes) if (r.events.includes(e.t)) r.handle(e as SimEvent, ctx);
    return fired.slice(n).map((f) => f.id);
  };
  const tick = (dt: number): void => {
    time += dt;
    for (const r of routes) r.update?.(dt, ctx);
  };
  tick(1 / 60);
  return { fired, send, tick, live, ctx };
}

describe('pickup routes (C1 #1)', () => {
  it('mirrors the sim PickupKind values', () => {
    expect(PICKUP).toEqual({ xp: PickupKind.Xp, yeop: PickupKind.Yeop, heal: PickupKind.Heal, chest: PickupKind.Chest, magnet: PickupKind.Magnet });
  });

  it.each([
    [PickupKind.Xp, ['pickup.xp']],
    [PickupKind.Yeop, ['pickup.yeop']],
    [PickupKind.Heal, ['sk.gen.potion_red']],
    [PickupKind.Chest, []],
    [PickupKind.Magnet, ['pickup.magnet']],
  ])('pickup kind %i → %j', (kind, ids) => {
    const h = harness();
    expect(h.send({ t: 'pickup', kind, x: 1, z: 2, tier: 0 })).toEqual(ids);
  });

  it('chestOpen owns the chest burst', () => {
    const h = harness();
    expect(h.send({ t: 'chestOpen', x: 0, z: 0, boss: false })).toEqual(['chest.open']);
    expect(h.send({ t: 'chestOpen', x: 0, z: 0, boss: true })).toEqual(['chest.open.boss']);
  });
});

describe('revive / enrage de-dupe (C1 #2, #3)', () => {
  it('plays one revive per revive', () => {
    const h = harness();
    expect(h.send({ t: 'playerRevive', player: 0, x: 0, z: 0 })).toEqual(['player.revive']);
    expect(h.send({ t: 'playerRevive', player: 0, x: 0, z: 0 })).toEqual([]);
    h.tick(0.5);
    expect(h.send({ t: 'playerRevive', player: 0, x: 0, z: 0 })).toEqual(['player.revive']);
  });

  it('bursts once per enrage and follows the live boss position', () => {
    const h = harness({
      bossPos: (_x, _z, out) => {
        out.x = 30;
        out.z = -12;
        return true;
      },
    });
    h.send({ t: 'bossSpawn', x: 5, z: 5, final: false });
    expect(h.send({ t: 'bossPhase', phase: 1, enrage: false })).toEqual(['boss.phase']);
    expect(h.fired.at(-1)?.o).toMatchObject({ x: 30, z: -12 });
    expect(h.send({ t: 'bossPhase', phase: 2, enrage: true })).toEqual(['boss.enrage.burst']);
    expect(h.send({ t: 'bossPhase', phase: 2, enrage: true })).toEqual([]);
  });

  it('falls back to the cached spawn point without a live boss', () => {
    const h = harness();
    h.send({ t: 'bossSpawn', x: 5, z: 7, final: false });
    h.send({ t: 'bossPhase', phase: 1, enrage: false });
    expect(h.fired.at(-1)?.o).toMatchObject({ x: 5, z: 7 });
  });
});

describe('heal routes (C1 #4)', () => {
  it('lifesteal at full size, rate limited', () => {
    const h = harness();
    expect(h.send({ t: 'heal', player: 0, amount: 3, source: 1 })).toEqual(['heal.drain']);
    expect(h.fired.at(-1)?.o).toMatchObject({ x: 3, z: 4, scale: 1 });
    expect(h.send({ t: 'heal', player: 0, amount: 3, source: 1 })).toEqual([]);
    h.tick(0.5);
    expect(h.send({ t: 'heal', player: 0, amount: 3, source: 1 })).toEqual(['heal.drain']);
  });

  it('skips holy.heal when the skill just played its own cure', () => {
    const h = harness();
    expect(h.send({ t: 'heal', player: 0, amount: 9, source: 3 })).toEqual(['holy.heal']);
    h.ctx.mark('sk.mending_light');
    expect(h.send({ t: 'heal', player: 0, amount: 9, source: 3 })).toEqual([]);
  });

  it.each([
    [0, []],
    [2, []],
    [4, ['sk.gen.potion_auto_red']],
  ])('heal source %i → %j', (source, ids) => {
    expect(harness().send({ t: 'heal', player: 0, amount: 1, source })).toEqual(ids);
  });
});

describe('damage routes (hits + status, C1 #5)', () => {
  it('direct hits pick the element preset and add the crit twirl', () => {
    const h = harness();
    expect(h.send({ t: 'damage', x: 0, z: 0, amount: 10, crit: false, element: 1, dot: false, boss: false, killed: false })).toEqual(['hit.fire']);
    expect(h.send({ t: 'damage', x: 0, z: 0, amount: 10, crit: true, element: 0, dot: false, boss: false, killed: false })).toEqual(['sk.gen.hit', 'sk.gen.critical']);
  });

  it('every DoT tick may show, capped per element by a token bucket', () => {
    const h = harness();
    const n = () => h.send({ t: 'damage', x: 0, z: 0, amount: 1, crit: false, element: 1, dot: true, boss: false, killed: false }).length;
    let shown = 0;
    for (let i = 0; i < 10; i++) shown += n();
    expect(shown).toBe(4);
    expect(h.send({ t: 'damage', x: 0, z: 0, amount: 1, crit: false, element: 5, dot: true, boss: false, killed: false })).toEqual(['hit.dot.poison']);
    h.tick(1);
    shown = 0;
    for (let i = 0; i < 10; i++) shown += n();
    expect(shown).toBe(4);
  });
});

describe('spawn / attack / misc routes (C1 #7)', () => {
  it.each([
    [{ source: 0, tier: 0 }, ['spawn.ring']],
    [{ source: 2, tier: 0 }, ['spawn.corrupt']],
    [{ source: 4, tier: 0 }, ['sk.gen.monster_appear']],
    [{ source: 1, tier: 1 }, ['spawn.elite']],
    [{ source: 3, tier: 2 }, []],
  ])('enemySpawn %j → %j', (e, ids) => {
    expect(harness().send({ t: 'enemySpawn', x: 0, z: 0, ...e })).toEqual(ids);
  });

  it.each([
    [0, []],
    [1, ['enemy.muzzle']],
    [2, ['enemy.charge']],
    [3, ['enemy.leap']],
    [4, []],
  ])('enemyAttack kind %i → %j (explode stays in the adapter core)', (kind, ids) => {
    expect(harness().send({ t: 'enemyAttack', kind, x: 0, z: 0, dirX: 1, dirZ: 0 })).toEqual(ids);
  });

  it('playerHit results', () => {
    const h = harness();
    expect(h.send({ t: 'playerHit', result: 0, x: 0, z: 0, srcX: 1, srcZ: 0, element: 0 })).toEqual(['hit.player']);
    expect(h.send({ t: 'playerHit', result: 1, x: 0, z: 0, srcX: 1, srcZ: 0, element: 0 })).toEqual(['player.evade']);
    expect(h.send({ t: 'playerHit', result: 2, x: 0, z: 0, srcX: 1, srcZ: 0, element: 0 })).toEqual(['player.shield']);
  });

  it('dormant telegraph presets only when enabled', () => {
    expect(harness().send({ t: 'telegraph', shape: 0, x: 0, z: 0, rot: 0, a: 3, b: 0, c: 0, dur: 1, source: 0 })).toEqual([]);
    expect(harness({ telegraphEvents: true }).send({ t: 'telegraph', shape: 1, x: 0, z: 0, rot: 0, a: 3, b: 1, c: 0, dur: 1, source: 0 })).toEqual(['telegraph.cone']);
  });
});

describe('metin corruption loops stay alive (C2)', () => {
  
  // header, rebuilt r1), so this asserts the contract - the required events, the loop's liveness - not the exact event list.
  const LOOP = 'sk.gen.metin_loop1.blue';

  it('respawns a loop that ended while its stone stands, stops for good on break', () => {
    const h = harness();
    const impact = h.send({ t: 'metinImpact', metin: 7, def: 'metin_lament', x: 4, z: 4, radius: 3, great: false });
    expect(impact[0]).toBe('sk.gen.metin_crash'); // the crash plays first
    expect(impact).toContain(LOOP);
    expect(impact.filter((id) => id === LOOP)).toHaveLength(1);
    const idsOnly = (): string[] => h.fired.map((f) => f.id);
    const loop = idsOnly().lastIndexOf(LOOP) + 1; // the harness hands out handles in fire order, 1-based
    expect(h.live.has(loop)).toBe(true);
    h.live.delete(loop); // the loop died on its own (lifetime bug / eviction)
    h.tick(0.3);
    expect(h.fired.at(-1)?.id).toBe(LOOP);
    expect(idsOnly().filter((id) => id === LOOP)).toHaveLength(2);
    const respawned = h.fired.length;
    expect(h.live.has(respawned)).toBe(true);
    const brk = h.send({ t: 'metinBreak', metin: 7, def: 'metin_lament', x: 4, z: 4, great: false });
    expect(brk).toContain('sk.gen.metin_break');
    expect(brk).not.toContain(LOOP);
    expect(h.live.has(respawned)).toBe(false); // the break stops the loop
    const after = h.fired.length;
    h.tick(1);
    expect(h.fired.length).toBe(after); // and nothing respawns it
  });
});
