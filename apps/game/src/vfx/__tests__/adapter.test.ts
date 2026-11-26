import { describe, expect, it } from 'vitest';
import type { SimEvent, VfxEvent } from '../../sim/events';
import { EventAdapter } from '../adapter';
import { PRESET_ALIASES, type Resolved } from '../presets';
import type { VfxSystem } from '../system';
import type { SpawnOpts } from '../types';

function harness(): {
  adapter: EventAdapter;
  spawned: { id: string; o: SpawnOpts }[];
  ids: () => string[];
  step: (dt: number) => void;
} {
  const spawned: { id: string; o: SpawnOpts }[] = [];
  const live = new Set<number>();
  let next = 1;
  const sys = {
    resolve: (id: string) => ({ def: { id } }) as unknown as Resolved,
    // spawn() accepts alias spellings (vfx_revive → player.revive): record the id the registry would resolve to
    spawn: (id: string, o: SpawnOpts) => {
      spawned.push({ id: PRESET_ALIASES[id] ?? id, o: { ...o } });
      const h = next++;
      live.add(h);
      return h;
    },
    spawnResolved: (r: Resolved, o: SpawnOpts) => {
      spawned.push({ id: r.def.id, o: { ...o } });
      return 0;
    },
    stop: (h: number) => void live.delete(h),
    alive: (h: number) => live.has(h),
    heightAt: () => 0,
    players: new Float32Array(12),
    fx: { density: 1 },
  } as unknown as VfxSystem;
  const adapter = new EventAdapter(sys);
  const step = (dt: number) => adapter.update(dt);
  step(1 / 60);
  return { adapter, spawned, ids: () => spawned.map((s) => s.id), step };
}

function vfx(preset: string): VfxEvent {
  return { t: 'vfx', preset, x: 10, z: 0, dirX: 0, dirZ: 2, scale: 13, duration: 0.35, color: -1, tx: 0, tz: 0, hasTarget: false, element: 1, player: -1 };
}

describe('EventAdapter breath origin', () => {
  it('re-anchors a boss breath cone on the mouth and keeps its far end at the sim cone end', () => {
    const { adapter, spawned } = harness();
    const asked: [number, number][] = [];
    adapter.breathOrigin = (x, z, out) => {
      asked.push([x, z]);
      out.x = x + 0.2;
      out.y = 6;
      out.z = z + 4;
      return true;
    };
    adapter.handle1(vfx('cone.breath.fire'));
    expect(asked).toEqual([[10, 0]]);
    const o = spawned[0]?.o as SpawnOpts;
    // the preset's jet starts dir × 0.5 ahead of and 0.9 m above the spawn point (dir = +Z here): exactly the mouth
    expect(o.x).toBeCloseTo(10.2, 6);
    expect((o.z as number) + 0.5).toBeCloseTo(4, 6);
    expect((o.y as number) + 0.9).toBeCloseTo(6, 6);
    // and the cone still ends at event point + dir × 13 (the sim's damage cone)
    expect((o.z as number) + (o.scale as number)).toBeCloseTo(13, 6);
    expect(o.dirX).toBe(0);
    expect(o.dirZ).toBe(2);
  });

  it('leaves other presets, unmatched sources and adapters without a resolver alone', () => {
    const { adapter, spawned } = harness();
    let calls = 0;
    adapter.breathOrigin = () => {
      calls++;
      return false;
    };
    adapter.handle1(vfx('boss.slam'));
    expect(calls).toBe(0);
    adapter.handle1(vfx('vfx_boss_breath'));
    expect(calls).toBe(1);
    adapter.breathOrigin = null;
    adapter.handle1(vfx('cone.breath.fire'));
    for (const s of spawned) {
      expect(s.o.x).toBe(10);
      expect(s.o.z).toBe(0);
      expect(s.o.y).toBeUndefined();
      expect(s.o.scale).toBe(13);
    }
    expect(spawned.map((s) => s.id)).toEqual(['boss.slam', 'cone.breath', 'cone.breath.fire']);
  });
});

function send(adapter: EventAdapter, e: Record<string, unknown>): void {
  adapter.handle1(e as unknown as SimEvent);
}

function alias(preset: string, x: number, z: number, scale: number, element: number): VfxEvent {
  return { t: 'vfx', preset, x, z, dirX: 0, dirZ: 1, scale, duration: 0.8, color: -1, tx: 0, tz: 0, hasTarget: false, element, player: -1 };
}

describe('EventAdapter alias de-dupe (C1)', () => {
  const reviveEv = { t: 'playerRevive', player: 0, x: 4, z: 5, left: 0 };

  it('plays one player.revive when the typed event and the vfx_revive alias arrive in the same tick (either order)', () => {
    for (const aliasFirst of [false, true]) {
      const { adapter, spawned } = harness();
      if (aliasFirst) {
        adapter.handle1(alias('vfx_revive', 4, 5, 7, 6));
        send(adapter, reviveEv);
      } else {
        send(adapter, reviveEv);
        adapter.handle1(alias('vfx_revive', 4, 5, 7, 6));
      }
      const revives = spawned.filter((s) => s.id === 'player.revive');
      expect(revives).toHaveLength(1);
      expect(revives[0]?.o.scale as number).toBeLessThanOrEqual(1.4);
    }
  });

  it('caps the 7x revive alias at 1.4 when it is the only event, and lets a later revive through after the window', () => {
    const { adapter, spawned, step } = harness();
    adapter.handle1(alias('vfx_revive', 4, 5, 7, 6));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.id).toBe('player.revive');
    expect(spawned[0]?.o.scale).toBe(1.4);
    step(0.3);
    send(adapter, reviveEv);
    expect(spawned.filter((s) => s.id === 'player.revive')).toHaveLength(2);
  });

  it('plays one boss.enrage.burst for the vfx_boss_enrage alias + bossPhase(enrage) in either order', () => {
    for (const aliasFirst of [false, true]) {
      const { adapter, spawned } = harness();
      send(adapter, { t: 'bossSpawn', x: 1, z: 2, final: false });
      if (aliasFirst) {
        adapter.handle1(alias('vfx_boss_enrage', 1, 2, 4, 1));
        send(adapter, { t: 'bossPhase', phase: 2, enrage: true });
      } else {
        send(adapter, { t: 'bossPhase', phase: 2, enrage: true });
        adapter.handle1(alias('vfx_boss_enrage', 1, 2, 4, 1));
      }
      const bursts = spawned.filter((s) => s.id === 'boss.enrage.burst');
      expect(bursts).toHaveLength(1);
      // the enrage alias has no scale ceiling: the sim's own size (4) survives when the alias wins the race
      if (aliasFirst) expect(bursts[0]?.o.scale).toBe(4);
    }
  });

  it('boss phase / enrage bursts play at the live boss position when the render world supplies one', () => {
    const { adapter, spawned, step } = harness();
    adapter.bossOrigin = (_x, _z, out) => {
      out.x = 30;
      out.y = 0;
      out.z = 40;
      return true;
    };
    send(adapter, { t: 'bossSpawn', x: 1, z: 2, final: false });
    send(adapter, { t: 'bossPhase', phase: 1, enrage: false });
    step(1);
    send(adapter, { t: 'bossPhase', phase: 2, enrage: true });
    const at = spawned.filter((s) => s.id === 'boss.phase' || s.id === 'boss.enrage.burst').map((s) => [s.o.x, s.o.z]);
    expect(at).toEqual([
      [30, 40],
      [30, 40],
    ]);
    // no live position (callback removed): falls back to the point cached at bossSpawn
    adapter.bossOrigin = null;
    step(1);
    send(adapter, { t: 'bossPhase', phase: 3, enrage: false });
    expect(spawned[spawned.length - 1]?.o.x).toBe(1);
    expect(spawned[spawned.length - 1]?.o.z).toBe(2);
  });
});

describe('EventAdapter typed event routes (C1)', () => {
  it("a skill's sk.mending_light vfx suppresses the holy.heal decoration of its skill heal (source 3); a plain skill heal still plays it", () => {
    const { adapter, ids, step } = harness();
    adapter.handle1(alias('sk.mending_light', 0, 0, 1, 6));
    send(adapter, { t: 'heal', player: 0, amount: 5, source: 3 });
    expect(ids()).toEqual(['sk.mending_light']);
    step(0.5);
    send(adapter, { t: 'heal', player: 0, amount: 5, source: 3 });
    expect(ids()).toEqual(['sk.mending_light', 'holy.heal']);
  });

  it('maps the sim PickupKind: magnet (4) plays pickup.magnet, chest (3) draws nothing (the chestOpen event does)', () => {
    const { adapter, ids } = harness();
    send(adapter, { t: 'pickup', kind: 4, tier: 0, x: 1, z: 1 });
    send(adapter, { t: 'pickup', kind: 3, tier: 0, x: 1, z: 1 });
    expect(ids()).toEqual(['pickup.magnet']);
    send(adapter, { t: 'chestOpen', x: 1, z: 1, boss: false });
    expect(ids()).toEqual(['pickup.magnet', 'chest.open']);
  });

  it('enemyAttack kind 4 (explode) plays enemy.explode; other kinds are left to their own targets', () => {
    const { adapter, ids } = harness();
    send(adapter, { t: 'enemyAttack', kind: 4, x: 2, z: 3, dirX: 0, dirZ: 1 });
    expect(ids()).toEqual(['enemy.explode']);
    send(adapter, { t: 'enemyAttack', kind: 0, x: 2, z: 3, dirX: 0, dirZ: 1 });
    expect(ids()).toEqual(['enemy.explode']);
  });

  it('ignores unknown and malformed events', () => {
    const { adapter, ids } = harness();
    adapter.handle1(null);
    adapter.handle1(undefined);
    adapter.handle1({ t: 'nope' });
    expect(ids()).toEqual([]);
  });
});

describe('EventAdapter skill explosion', () => {
  const at = (preset: string, x: number, z = 0): VfxEvent => ({ ...vfx(preset), x, z, scale: 4 });

  it('plays sk.<id>.explode instead of the generic explosion that follows the skill event at the same point', () => {
    const { adapter, spawned, ids } = harness();
    adapter.setExplodePresets({ 'sk.nightfall': 'sk.nightfall.explode' });
    adapter.handle1(at('sk.nightfall', 3));
    adapter.handle1(at('vfx_explode', 3));
    expect(ids()).toEqual(['sk.nightfall', 'sk.nightfall.explode']);
    expect(spawned[1]?.o.scale).toBe(4);
  });

  it('keeps the generic explosion for other points, other skills and frames, and without a registered preset', () => {
    const { adapter, ids, step } = harness();
    adapter.setExplodePresets({ 'sk.nightfall': 'sk.nightfall.explode' });
    adapter.handle1(at('sk.nightfall', 3));
    adapter.handle1(at('vfx_explode', 7));
    adapter.handle1(at('sk.blazing_column', 3));
    adapter.handle1(at('vfx_explode', 3));
    step(1 / 60);
    adapter.handle1(at('sk.nightfall', 5));
    step(1 / 60);
    adapter.handle1(at('vfx_explode', 5));
    expect(ids()).toEqual(['sk.nightfall', 'enemy.explode', 'sk.blazing_column', 'enemy.explode', 'sk.nightfall', 'enemy.explode']);
  });
});

describe('EventAdapter projectile skill explosion', () => {
  const boom = (x: number, z = 0): VfxEvent => ({ ...vfx('vfx_explode'), x, z, scale: 1.3 });

  it('plays sk.<id>.explode for the generic explosion where a tracked sk.* projectile just stopped', () => {
    const { adapter, spawned, ids, step } = harness();
    adapter.setExplodePresets({ 'sk.drifting_charms': 'sk.drifting_charms.explode' });
    adapter.noteTrack(5, 'sk.drifting_charms', 3.2, 0);
    step(1 / 60);
    adapter.handle1(boom(3.4));
    expect(ids()).toEqual(['sk.drifting_charms.explode']);
    expect(spawned[0]?.o.scale).toBe(1.3);
  });

  it('keeps the generic explosion far from the body, for skills without an .explode and once the body is stale', () => {
    const { adapter, ids, step } = harness();
    adapter.setExplodePresets({ 'sk.drifting_charms': 'sk.drifting_charms.explode' });
    adapter.noteTrack(5, 'sk.drifting_charms', 3.2, 0);
    adapter.noteTrack(6, 'sk.other', 9, 0);
    adapter.handle1(boom(9.1));
    adapter.handle1(boom(30));
    step(0.5);
    adapter.handle1(boom(3.3));
    expect(ids()).toEqual(['enemy.explode', 'enemy.explode', 'enemy.explode']);
  });

  it('expires retired projectile correlation records without any explosions and bounds map growth (RENDER-08)', () => {
    const { adapter, step } = harness();
    adapter.setExplodePresets({ 'sk.flying_talisman': 'sk.flying_talisman.explode' });
    const tracked = (adapter as unknown as { tracked: Map<number, unknown> }).tracked;

    for (let i = 1; i <= 10_000; i++) {
      adapter.noteTrack(i, 'sk.flying_talisman', i * 0.1, 0);
      if (i % 50 === 0) step(0.05);
      expect(tracked.size).toBeLessThanOrEqual(512);
    }

    // Advance past the 1-second matching horizon with zero explosion events: all retired records vanish.
    step(1.1);
    expect(tracked.size).toBe(0);
  });

  it('forwards explicit VfxEvent.player as caster to spawned options (SIM-11 compatibility)', () => {
    const { adapter, spawned } = harness();
    adapter.skillMeta = (_key, _x, _z, out) => {
      out.rank = 3;
      out.awakened = false;
      out.caster = 0; // nearest-player guess
      return true;
    };
    adapter.handle1({ ...vfx('sk.eagle_eye'), player: 2 });
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.o.caster).toBe(2);
    expect(spawned[0]?.o.rank).toBe(3);
  });
});
