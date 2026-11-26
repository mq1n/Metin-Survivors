// Skill-logic WP5: the app side of the new rows and events with NO spec yet (WP4 draws them later). Every marker / companion row and every
// `sk.gen.*` / `sk.<id>.<moment>` event the shipped shells and summons produce goes through the real SkillVfxFeed and EventAdapter against
// a registry-faithful stub of the VFX system: an id without a spec resolves to null, draws nothing, throws nothing and logs nothing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { botInput } from '../../sim/__tests__/bot';
import { drainModals } from '../../sim/__tests__/helpers';
import { PARTNER, only, realWorld } from '../../sim/__tests__/skillLab';
import { spawnMarker } from '../../sim/skills/companions';
import { ProjKind, type PlayerState } from '../../sim/stores';
import { EventAdapter } from '../../vfx/adapter';
import { VARIANTS } from '../../vfx/palette';
import { PRESETS, PRESET_ALIASES, type PresetDef, type Resolved } from '../../vfx/presets';
import { ensureAllSkillVfx } from '../../vfx/skills/loader';
import type { VfxSystem } from '../../vfx/system';
import type { SpawnOpts, Vfx } from '../../vfx/types';
import { styleFromName } from '../simFeed';
import { SkillVfxFeed } from '../skillVfxFeed';

await ensureAllSkillVfx();

const BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

function lookup(id: string): PresetDef | undefined {
  const hit = BY_ID.get(id) ?? BY_ID.get(PRESET_ALIASES[id] ?? '');
  if (hit) return hit;
  const dot = id.lastIndexOf('.');
  const base = dot > 0 ? BY_ID.get(id.slice(0, dot)) : undefined;
  return base?.variants === true && VARIANTS[id.slice(dot + 1)] !== undefined ? base : undefined;
}

/** the VfxSystem surface the adapter uses, backed by the real preset registry: unknown ids resolve to null and spawn handle 0 */
function system(unknown: Set<string>, known: Set<string>): VfxSystem {
  let next = 1;
  return {
    resolve: (id: string): Resolved | null => {
      const d = lookup(id);
      if (!d) {
        unknown.add(id);
        return null;
      }
      known.add(id);
      return { def: d } as unknown as Resolved;
    },
    spawn: (id: string): number => {
      if (!lookup(id)) {
        unknown.add(id);
        return 0;
      }
      known.add(id);
      return next++;
    },
    spawnResolved: () => 0,
    stop: () => undefined,
    alive: () => false,
    heightAt: () => 0,
    players: new Float32Array(12),
    fx: { density: 1 },
  } as unknown as VfxSystem;
}

class FeedVfx implements Pick<Vfx, 'spawn' | 'move' | 'stop' | 'track'> {
  tracked = new Set<string>();
  unknown = new Set<string>();
  spawn(id: string, _o: SpawnOpts): number {
    if (!lookup(id)) this.unknown.add(id);
    return 0;
  }
  move(): void {}
  stop(): void {}
  track(id: string): void {
    this.tracked.add(id);
    if (!lookup(id)) this.unknown.add(id);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('rows and events without a spec', () => {
  it('60 s of a co-op run with every shell, veil and summon of the design: nothing throws, nothing is logged, only sk.* ids are missing', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const w = realWorld({ classId: 'shaman', doctrine: 'b', coop: [PARTNER], live: true, seed: 14, stats: { armor: 80, regen: 6, maxHpPct: 3 } });
    only(w, ['stormglass_shell', 'thunder_guardians', 'mirror_shell', 'radiant_favor', 'tailwind', 'wyrm_retinue'], 2, 0);
    only(w, ['graniteform', 'cursed_legion', 'war_oath', 'warfever', 'swallows_gait', 'umbral_plate'], 2, 1);
    // hero 0 also carries the yacha / ninja shells through the same sim paths: a second kit on the partner would exceed the 32 slots
    w.qaForceTriggers = true;
    const unknown = new Set<string>();
    const known = new Set<string>();
    const sys = system(unknown, known);
    const adapter = new EventAdapter(sys);
    const feed = new SkillVfxFeed();
    const fake = new FeedVfx();
    const emitted = new Set<string>();
    let markerRows = 0;
    for (let tick = 0; tick < 60 * 60 && !w.over; tick++) {
      drainModals(w);
      w.step([botInput(w, tick), { moveX: Math.cos(tick * 0.02), moveZ: Math.sin(tick * 0.02) }]);
      for (const e of w.events) if (e.t === 'vfx') emitted.add(e.preset);
      adapter.handle(w.events, w.events.length);
      adapter.update(1 / 60);
      feed.update(w, fake as unknown as Vfx, 0.5, () => 0);
      const P = w.projectiles;
      for (let i = 0; i < P.count; i++) if (P.kind[i] === ProjKind.Marker) markerRows++;
    }
    expect(markerRows, 'the kit produced marker rows').toBeGreaterThan(0);
    // every style the run interned for an sk.* row is hidden from the generic projectile body (the VFX layer draws it, or nothing does)
    const names = w.strings.names.filter((n) => n.startsWith('sk.'));
    expect(names.length).toBeGreaterThan(3);
    for (const n of names) expect(styleFromName(n, false).hidden, n).toBe(true);
    expect(emitted.size).toBeGreaterThan(5);
    expect(errors, 'console.error').not.toHaveBeenCalled();
    expect(warns, 'console.warn').not.toHaveBeenCalled();
    const all = new Set([...unknown, ...fake.unknown]);
    // ids the plain game already lacked a spec for (spawn.ring ...) are not this work's: a control run without the kit names them
    const base = new Set<string>();
    {
      const c = realWorld({ classId: 'shaman', doctrine: 'b', coop: [PARTNER], live: true, seed: 14, stats: { armor: 80, regen: 6, maxHpPct: 3 } });
      const cad = new EventAdapter(system(base, new Set()));
      for (let tick = 0; tick < 60 * 60 && !c.over; tick++) {
        drainModals(c);
        c.step([botInput(c, tick), { moveX: Math.cos(tick * 0.02), moveZ: Math.sin(tick * 0.02) }]);
        cad.handle(c.events, c.events.length);
      }
    }
    for (const id of all) if (!base.has(id)) expect(id.startsWith('sk.'), `a new non-skill id has no spec: ${id}`).toBe(true);
    if (process.env.DUMP_MISSING) writeFileSync(process.env.DUMP_MISSING, [...all].sort().join('\n') + '\n');
  }, 60_000);

  it('the other kits (veil + decoy, oath, soul bubble, wolves, clone, spirit) are just as quiet', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kits: [string, 'a' | 'b', string[]][] = [
      ['ninja', 'a', ['nightshroud', 'shadow_clone', 'swallows_gait', 'smoke_bomb']],
      ['yacha', 'b', ['obsidian_bulwark', 'blaze_familiars', 'dark_covenant', 'umbral_plate']],
      ['wolfman', 'b', ['spirit_wolves', 'moonmane_spirit', 'redmane_spirit']],
      ['warrior', 'a', ['war_oath', 'second_wind', 'warfever', 'graniteform']],
    ];
    const all = new Set<string>();
    for (const [classId, doctrine, ids] of kits) {
      const w = realWorld({ classId: classId as 'ninja', doctrine, live: true, seed: 6, stats: { armor: 60, regen: 5 } });
      only(w, ids, 2);
      w.qaForceTriggers = true;
      const unknown = new Set<string>();
      const adapter = new EventAdapter(system(unknown, new Set()));
      const feed = new SkillVfxFeed();
      const fake = new FeedVfx();
      for (let tick = 0; tick < 40 * 60 && !w.over; tick++) {
        drainModals(w);
        w.step([botInput(w, tick)]);
        adapter.handle(w.events, w.events.length);
        adapter.update(1 / 60);
        feed.update(w, fake as unknown as Vfx, 0.5, () => 0);
      }
      for (const id of [...unknown, ...fake.unknown]) all.add(id);
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
    if (process.env.DUMP_MISSING) writeFileSync(process.env.DUMP_MISSING + '.kits', [...all].sort().join('\n') + '\n');
  }, 60_000);

  it('a stray Marker row and a stray unknown vfx event are inert for the feed and the adapter', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = realWorld({ classId: 'warrior', doctrine: 'b' });
    const feed = new SkillVfxFeed();
    const fake = new FeedVfx();
    const unknown = new Set<string>();
    const adapter = new EventAdapter(system(unknown, new Set()));
    spawnMarker(w, w.players[0] as PlayerState, 0, 'sk.nothing.here', 2, 5, true);
    expect(w.projectiles.count).toBe(1);
    adapter.handle1({ t: 'vfx', preset: 'sk.nothing.here', x: 0, z: 0, dirX: 0, dirZ: 1, scale: 2, duration: 0.5, color: -1, tx: 0, tz: 0, hasTarget: false, element: 0 });
    adapter.update(1 / 60);
    feed.update(w, fake as unknown as Vfx, 0, () => 0);
    expect(errors).not.toHaveBeenCalled();
    expect(unknown.has('sk.nothing.here')).toBe(true);
  });
});
