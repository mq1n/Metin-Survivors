
// crack decal, pillar, debris, sticker disc), generated sprites shipped, routes (tier ids, radius sizing, mass-kill throttle, spawn mapping).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../sim/events';
import type { Resolved } from '../../../presets';
import type { ElementSpec, FxSpec, ParticleSpec } from '../../../spec/types';
import type { SpawnOpts } from '../../../types';
import type { RouteCtx } from '../../route';
import { CROWD_DISSOLVE, CROWD_FX_DISSOLVE_EDGE } from '../../../../render/crowd/fx/dissolve';
import { DEATH_SPAWN_ART_IDS } from '../art';
import { DEATH_BOSS, DEATH_ELITE, SPAWN_CORRUPT, SPAWN_ELITE, SPAWN_SUMMON, presets } from '../presets';
import { SPAWN_RING, SPAWN_WHISPER_ID, creatureRadius, deathSpawnRoutes, playerCrowding, puffScale, setCreatureRadii, vortexScale } from '../route';
import { MONSTER_APPEAR, MONSTER_DIE, SPAWN_WHISPER, specs } from '../specs';

const ALL_SPECS: readonly FxSpec[] = [MONSTER_DIE, MONSTER_APPEAR, SPAWN_WHISPER, DEATH_ELITE, DEATH_BOSS, SPAWN_ELITE, SPAWN_CORRUPT, SPAWN_SUMMON];
const DEATH_SPECS: readonly FxSpec[] = [MONSTER_DIE, DEATH_ELITE, DEATH_BOSS];
const parts = (s: FxSpec): ParticleSpec[] => s.elements.filter((e: ElementSpec): e is ParticleSpec => e.kind === 'particle');

/** every id the registry has to keep (ids + order are the contract) */
const IDS = [
  'death.dust', 'death.animal', 'death.orc', 'death.undead', 'death.ice', 'death.fire', 'death.desert', 'death.devil', 'death.insect',
  'death.dragon', 'death.human', 'death.metin', 'death.elite', 'death.boss', 'spawn.elite', 'spawn.corrupt', 'spawn.summon',
];

interface Fired {
  id: string;
  o: SpawnOpts;
}
function harness(over: Partial<RouteCtx> = {}) {
  const fired: Fired[] = [];
  let time = 0;
  const ctx: RouteCtx = {
    get time() {
      return time;
    },
    density: 1,
    players: new Float32Array(12),
    heightAt: () => 0,
    resolve: (id) => ({ def: { id }, palette: null, element: -1, variant: -1 }) as unknown as Resolved,
    o: (x, z, scale, dirX, dirZ) => ({ x, z, scale, dirX, dirZ }),
    fire: (id, o) => {
      fired.push({ id, o: { ...o } });
      return fired.length;
    },
    spawnResolved: () => 0,
    stop: () => {},
    alive: () => false,
    once: () => true,
    since: () => Infinity,
    mark: () => {},
    deathPreset: () => undefined,
    metinRune: () => 0,
    bossPos: () => false,
    telegraphEvents: false,
    ...over,
  };
  const routes = deathSpawnRoutes();
  const send = (e: Partial<SimEvent> & { t: SimEvent['t'] }): Fired[] => {
    const n = fired.length;
    for (const r of routes) if (r.events.includes(e.t)) r.handle(e as SimEvent, ctx);
    return fired.slice(n);
  };
  const tick = (dt: number): void => {
    time += dt;
    for (const r of routes) r.update?.(dt, ctx);
  };
  return { fired, send, tick, routes };
}

describe('death-spawn ids', () => {
  it('keeps the 17 classic ids in their order', () => {
    expect(presets.map((p) => p.id)).toEqual(IDS);
    expect(specs.map((s) => s.id).sort()).toEqual(['sk.gen.monster_appear', 'sk.gen.monster_die', 'sk.gen.spawn_ring']);
  });
});

describe('death looks: one translucent dark smoke, nothing else', () => {
  it('every death element is an ALPHA smoke puff (no flash / ring / pillar / debris, nothing additive)', () => {
    for (const s of DEATH_SPECS) {
      for (const e of parts(s)) {
        expect(e.blend, `${s.id} ${e.note}`).toBe('alpha');
        expect(e.billboard, `${s.id}`).toBe('screen');
      }
      expect(s.elements.some((e) => e.kind !== 'particle'), `${s.id} has a surface / trail (rings, pillars)`).toBe(false);
    }
  });

  it('puffs are translucent dark magenta / maroon (red > green, blue > green, never bright), alpha <= 0.66 (the lumps flung out past a boss outline <= 0.8)', () => {
    for (const s of DEATH_SPECS) {
      for (const e of parts(s)) {
        const c = e.color;
        for (let i = 0; i + 2 < c.length; i += 3) {
          const hex = c[i + 1] as number;
          const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
          expect(Math.max(r, g, b), `${s.id} colour ${hex.toString(16)} too bright`).toBeLessThanOrEqual(0x80);
          expect(g, `${s.id} colour ${hex.toString(16)} not magenta / maroon`).toBeLessThan(Math.max(r, b));
          expect(c[i + 2] as number, `${s.id} alpha`).toBeLessThanOrEqual(s === DEATH_BOSS ? 0.8 : 0.66);
        }
      }
    }
  });

  it('a normal death lasts about half a second; bosses at most ~1.4 s; the body layer is capped', () => {
    const life = (s: FxSpec): number => Math.max(...parts(s).map((e) => (e.t0 ?? 0) + Math.max(...(e.life as readonly number[]).filter((_, i) => i % 2 === 1))));
    expect(life(MONSTER_DIE)).toBeLessThanOrEqual(0.62);
    expect(life(DEATH_ELITE)).toBeLessThanOrEqual(0.9);
    expect(life(DEATH_BOSS)).toBeLessThanOrEqual(1.5);
    const n = (s: FxSpec): number => parts(s).reduce((a, e) => a + e.max, 0);
    expect(n(MONSTER_DIE)).toBeLessThanOrEqual(16);
    expect(n(DEATH_ELITE)).toBeLessThanOrEqual(26);
    expect(n(DEATH_BOSS)).toBeLessThanOrEqual(46);
  });
});

describe('spawn looks: the dark violet smoky vortex', () => {
  it('no hairline hoop, no light column: every vortex is translucent smoke layers (arcs, mass, spiral) + a lit ring; only the first ring is additive and capped', () => {
    for (const s of [MONSTER_APPEAR, SPAWN_ELITE, SPAWN_SUMMON, SPAWN_WHISPER]) {
      const big = parts(s).filter((e) => (e.half as readonly number[]).some((v, i) => i % 2 === 1 && v > 0.6));
      expect(big.length, `${s.id} big disc layers`).toBeGreaterThanOrEqual(s === SPAWN_WHISPER ? 3 : 5);
      for (const e of parts(s).filter((p) => p.blend === 'add')) {
        const c = e.color;
        for (let i = 0; i + 2 < c.length; i += 3) expect(c[i + 2] as number, `${s.id} additive alpha`).toBeLessThanOrEqual(0.9);
        expect(e.clamp ?? 99, `${s.id} additive clamp`).toBeLessThanOrEqual(1.5);
      }
      expect(s.elements.some((e) => e.kind !== 'particle'), `${s.id} has surfaces (cylinders)`).toBe(false);
    }
    for (const s of [SPAWN_CORRUPT]) expect(parts(s).filter((e) => e.billboard === 'ground').length, `${s.id} ground layers`).toBeGreaterThanOrEqual(2);
  });

  it('the whisper is cheap (<= 5 particles alive) and the vortex <= 24', () => {
    const n = (s: FxSpec): number => parts(s).reduce((a, e) => a + e.max, 0);
    expect(n(SPAWN_WHISPER)).toBeLessThanOrEqual(5);
    for (const s of [MONSTER_APPEAR, SPAWN_CORRUPT, SPAWN_SUMMON]) expect(n(s), s.id).toBeLessThanOrEqual(24);
    expect(n(SPAWN_ELITE)).toBeLessThanOrEqual(28);
  });

  const art = (e: ParticleSpec): string => JSON.stringify(typeof e.tex === 'string' ? e.tex : e.tex.art);
  const hue = (hex: number): number => {
    const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    const d = mx - mn;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const end = (e: ParticleSpec): number => (e.t0 ?? 0) + (e.life as readonly number[])[1]!;
  const peakAt = (e: ParticleSpec): number => {
    const c = e.color;
    let best = 0, at = 0;
    for (let i = 0; i + 2 < c.length; i += 3) if ((c[i + 2] as number) > best) { best = c[i + 2] as number; at = c[i] as number; }
    return (e.t0 ?? 0) + at * (e.life as readonly number[])[1]!;
  };

  it('r3: the opening beat is a TRANSLUCENT arc spiral, the dense near-black mass thickens after it, and the mass is dark near-black violet / wine', () => {
    for (const s of [MONSTER_APPEAR, SPAWN_ELITE, SPAWN_SUMMON]) {
      const arcs = parts(s).find((e) => art(e).includes('vfx_death_spawn_vortex_arcs'));
      const mass = parts(s).find((e) => art(e).includes('vfx_death_spawn_vortex_mass'));
      expect(arcs, `${s.id} arcs`).toBeDefined();
      expect(mass, `${s.id} mass`).toBeDefined();
      expect(arcs!.blend).toBe('alpha');
      expect(mass!.blend).toBe('alpha');
      // the arcs exist from t0, the mass starts later and is densest after the arcs peak (thickening, not a pool from frame 1)
      expect(arcs!.t0 ?? 0, `${s.id} arcs start`).toBeLessThanOrEqual(0.02);
      expect(mass!.t0 ?? 0, `${s.id} mass start`).toBeGreaterThanOrEqual(0.04);
      expect(peakAt(mass!), `${s.id} mass peaks after the arcs`).toBeGreaterThan(peakAt(arcs!) + 0.08);
      const mc = mass!.color;
      expect(Math.max(...mc.filter((_, i) => i % 3 === 2)), `${s.id} mass alpha`).toBeGreaterThanOrEqual(0.75);
      // the first key of the mass is transparent and its alpha at 0.14 of its life is still translucent
      expect(mc[2] as number).toBe(0);
      expect(mc[5] as number, `${s.id} mass thickens`).toBeLessThanOrEqual(0.45);
      const hex = mc[1] as number;
      expect(Math.max((hex >> 16) & 255, (hex >> 8) & 255, hex & 255), `${s.id} mass colour not near-black`).toBeLessThanOrEqual(0x2c);
      const h = hue(arcs!.color[1] as number);
      if (s === SPAWN_ELITE) {
        expect(h, `${s.id} arcs hue ${h} (crimson-violet)`).toBeGreaterThanOrEqual(300);
        expect(h, `${s.id} arcs hue ${h}`).toBeLessThanOrEqual(345);
      } else {
        expect(h, `${s.id} arcs hue ${h}`).toBeGreaterThanOrEqual(265);
        expect(h, `${s.id} arcs hue ${h}`).toBeLessThanOrEqual(300);
      }
    }
  });

  it('r3: the lit ring appears INSIDE the mass (starts <= 0.65 x) after the mass has started and GROWS outward past its edge (>= 1.2 x); a faint alpha ring outlives the mass; 8-14 red specks', () => {
    for (const s of [MONSTER_APPEAR, SPAWN_ELITE, SPAWN_SUMMON]) {
      const rings = parts(s).filter((e) => art(e).includes('vfx_death_spawn_lit_ring'));
      expect(rings.length, `${s.id} rings`).toBeGreaterThanOrEqual(2);
      const first = rings.find((r) => r.blend === 'add')!;
      const sc = first.scale as readonly number[];
      expect(sc[1] as number, `${s.id} ring starts inside the mass`).toBeLessThanOrEqual(0.65);
      expect(sc[sc.length - 1] as number, `${s.id} ring ends past the mass edge`).toBeGreaterThanOrEqual(1.2);
      for (let i = 3; i < sc.length; i += 2) expect(sc[i] as number, `${s.id} ring never shrinks`).toBeGreaterThanOrEqual(sc[i - 2] as number);
      const mass = parts(s).find((e) => art(e).includes('vfx_death_spawn_vortex_mass'))!;
      expect(first.t0 ?? 0, `${s.id} the ring comes after the mass has started`).toBeGreaterThan(mass.t0 ?? 0);
      const faint = rings.find((r) => r.blend === 'alpha')!;
      expect(end(faint), `${s.id}: the faint ring outlives the mass`).toBeGreaterThan(end(mass));
      
      expect(faint.minTier ?? 0, `${s.id} the tail pass is not tier-gated`).toBe(0);
      const sf = faint.scale as readonly number[];
      expect(sf[sf.length - 1] as number, `${s.id} faint ring is wider than the mass`).toBeGreaterThanOrEqual(1.3);
      const specks = parts(s).find((e) => art(e).includes('vfx_glow_fuzzball_a'));
      expect(specks!.max).toBeGreaterThanOrEqual(8);
      expect(specks!.max).toBeLessThanOrEqual(14);
      expect(specks!.billboard).toBe('screen');
      expect(first.blend, `${s.id} ring blend`).toBe('add');
      for (let i = 0; i + 2 < faint.color.length; i += 3) expect(faint.color[i + 2] as number, `${s.id} faint ring alpha`).toBeLessThanOrEqual(0.7);
    }
  });

  it('r3: the standing disc keeps its lowest edge above the floor (no ground-clipped billboard): centre height >= 0.45 x the half size', () => {
    for (const s of [MONSTER_APPEAR, SPAWN_ELITE, SPAWN_SUMMON, SPAWN_WHISPER]) {
      for (const e of parts(s).filter((p) => p.billboard === 'screen' && p.at && (p.half as readonly number[]).some((v, i) => i % 2 === 1 && v > 1))) {
        const h = Math.max(...(e.half as readonly number[]).filter((_, i) => i % 2 === 1));
        expect((e.at as readonly number[])[1] as number, `${s.id} ${e.note?.slice(0, 40)}`).toBeGreaterThanOrEqual(0.45 * h);
      }
    }
  });

  it('r2: spawn.corrupt is NOT the vortex: no spiral / strand / mass art, no red specks, dirty grey smoke thrown up AND out instead', () => {
    const arts = parts(SPAWN_CORRUPT).map(art).join('|');
    for (const id of ['vortex_disc', 'vortex_arcs', 'vortex_smoke_ring', 'vortex_mass', 'ring_arcs_facing', 'lit_ring']) expect(arts, id).not.toContain(id);
    // r3 resume: the corrupted creatures' lilac embers are allowed (cold: blue >= red), the summon's RED specks are not
    for (const e of parts(SPAWN_CORRUPT).filter((p) => art(p).includes('glow_fuzzball'))) {
      const c = e.color;
      for (let i = 0; i + 2 < c.length; i += 3) expect((c[i + 1] as number) & 255, 'corrupt ember is cold').toBeGreaterThanOrEqual(((c[i + 1] as number) >> 16) & 255);
    }
    expect(parts(SPAWN_CORRUPT).some((e) => e.adv === 'outer' && e.billboard === 'screen')).toBe(true);
    // r3: a sooty column (thrown UP) and a ring of puffs thrown OUT along the floor
    expect(parts(SPAWN_CORRUPT).some((e) => ((e.dir as { y?: readonly number[] } | undefined)?.y ?? [0, 0]).some((v, i) => i % 2 === 1 && v >= 100))).toBe(true);
    expect(parts(SPAWN_CORRUPT).some((e) => e.adv === 'outer' && (e.vel as readonly number[]).some((v, i) => i % 2 === 1 && v >= 0.014))).toBe(true);
  });

  it('r3: elite and boss deaths read differently from a normal death: flung lumps, a floor skirt and a tail', () => {
    const light = parts(MONSTER_DIE).length;
    expect(parts(DEATH_ELITE).length).toBeGreaterThanOrEqual(light + 3);
    expect(parts(DEATH_BOSS).length).toBeGreaterThanOrEqual(light + 5);
    for (const s of [DEATH_ELITE, DEATH_BOSS]) {
      const fling = parts(s).find((e) => e.note?.startsWith('elite / boss: dark dust lumps thrown OUT'));
      expect(fling, `${s.id} flung lumps`).toBeDefined();
      expect(fling!.front, `${s.id} lumps drawn in front`).toBe(true);
      expect(parts(s).some((e) => e.note?.includes('skirt of puffs')), `${s.id} skirt`).toBe(true);
    }
    // boss lumps start on a wide shell round the big body
    const sh = (s: FxSpec): number => ((parts(s).find((e) => e.note?.startsWith('elite / boss: dark dust lumps'))!.shape as { radius: number }).radius);
    expect(sh(DEATH_BOSS)).toBeGreaterThan(sh(DEATH_ELITE) * 2);
  });
});

describe('generated sprites', () => {
  it('every sprite id the target draws is in the shipped manifest', () => {
    const man = JSON.parse(readFileSync(new URL('../../../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as { textures?: Record<string, { kind?: string }> };
    const t = man.textures ?? (man as unknown as Record<string, { kind?: string }>);
    for (const id of DEATH_SPAWN_ART_IDS) expect(t[id]?.kind, id).toBe('vfx');
  });

  it('every art id referenced by a spec is listed in DEATH_SPAWN_ART_IDS', () => {
    const listed = new Set(DEATH_SPAWN_ART_IDS);
    for (const s of ALL_SPECS) {
      for (const e of parts(s)) {
        const tex = e.tex;
        if (typeof tex === 'string') continue;
        for (const id of Array.isArray(tex.art) ? tex.art : [tex.art]) expect(listed.has(id as string), `${s.id}: ${id}`).toBe(true);
      }
    }
  });
});

describe('routes', () => {
  setCreatureRadii([0.4, 0.45, 0.9]);

  it('death: tier picks the preset, size follows the creature radius', () => {
    const h = harness();
    const d = (type: number, tier: number, scale = 1): Fired => h.send({ t: 'enemyDeath', type, x: 1, z: 2, rot: 0, scale, tier, killer: 0, skill: -1, crit: false } as Partial<SimEvent> & { t: 'enemyDeath' })[0] as Fired;
    const small = d(0, 0);
    const big = d(2, 0);
    expect(small.id).toBe('sk.gen.monster_die');
    expect(big.id).toBe('sk.gen.monster_die');
    expect(big.o.scale as number).toBeGreaterThan(small.o.scale as number);
    expect(d(1, 1).id).toBe('death.elite');
    expect(d(2, 2).id).toBe('death.boss');
    expect(creatureRadius(2, 1.5)).toBeCloseTo(1.35, 5);
    for (let r = 0.2; r < 3; r += 0.2) {
      expect(puffScale(r)).toBeGreaterThanOrEqual(0.85);
      expect(puffScale(r)).toBeLessThanOrEqual(2.6);
      expect(vortexScale(r)).toBeGreaterThanOrEqual(0.8);
      expect(vortexScale(r)).toBeLessThanOrEqual(2.2);
    }
  });

  it('a mass kill shrinks the puffs, then drops them (the corpses stay): 60 deaths in one tick draw fewer than 30', () => {
    const h = harness();
    let n = 0;
    let shrunk = 0;
    for (let i = 0; i < 60; i++) {
      const f = h.send({ t: 'enemyDeath', type: 1, x: i, z: 0, rot: 0, scale: 1, tier: 0, killer: 0, skill: -1, crit: false } as Partial<SimEvent> & { t: 'enemyDeath' });
      n += f.length;
      if (f[0] && (f[0].o.scale as number) < puffScale(0.45) - 1e-6) shrunk++;
    }
    expect(n).toBeLessThan(30);
    expect(n).toBeGreaterThan(12);
    expect(shrunk).toBeGreaterThan(0);
    h.tick(1);
    expect(h.send({ t: 'enemyDeath', type: 1, x: 0, z: 0, rot: 0, scale: 1, tier: 0, killer: 0, skill: -1, crit: false } as Partial<SimEvent> & { t: 'enemyDeath' }).length).toBe(1);
  });

  it('elite and boss deaths are never throttled', () => {
    const h = harness();
    let n = 0;
    for (let i = 0; i < 30; i++) n += h.send({ t: 'enemyDeath', type: 1, x: 0, z: 0, rot: 0, scale: 1, tier: 1 + (i % 2), killer: 0, skill: -1, crit: false } as Partial<SimEvent> & { t: 'enemyDeath' }).length;
    expect(n).toBe(30);
  });

  it('spawn: source -> preset; the band hook plays the whisper while no preset owns spawn.ring', () => {
    const ev = (e: object): Fired[] => harness().send({ t: 'enemySpawn', type: 1, x: 0, z: 0, ...e } as Partial<SimEvent> & { t: 'enemySpawn' });
    expect(ev({ source: 4, tier: 0 }).map((f) => f.id)).toEqual(['sk.gen.monster_appear']);
    expect(ev({ source: 2, tier: 0 }).map((f) => f.id)).toEqual(['spawn.corrupt']);
    expect(ev({ source: 5, tier: 1 }).map((f) => f.id)).toEqual(['spawn.elite']);
    expect(ev({ source: 3, tier: 2 })).toEqual([]);
    expect(ev({ source: 0, tier: 0 }).map((f) => f.id)).toEqual([SPAWN_RING]);
    const none = harness({ resolve: () => null });
    expect(none.send({ t: 'enemySpawn', type: 1, x: 0, z: 0, source: 1, tier: 0 } as Partial<SimEvent> & { t: 'enemySpawn' }).map((f) => f.id)).toEqual([SPAWN_WHISPER_ID]);
  });

  it('band / pack whispers and metin swarm vortices are rationed per second', () => {
    const h = harness();
    let w = 0;
    let c = 0;
    for (let i = 0; i < 50; i++) {
      w += h.send({ t: 'enemySpawn', type: 1, x: 0, z: 0, source: 0, tier: 0 } as Partial<SimEvent> & { t: 'enemySpawn' }).length;
      c += h.send({ t: 'enemySpawn', type: 1, x: 0, z: 0, source: 2, tier: 0 } as Partial<SimEvent> & { t: 'enemySpawn' }).length;
    }
    expect(w).toBeLessThanOrEqual(7);
    expect(c).toBeLessThanOrEqual(5);
    h.tick(1);
    expect(h.send({ t: 'enemySpawn', type: 1, x: 0, z: 0, source: 0, tier: 0 } as Partial<SimEvent> & { t: 'enemySpawn' }).length).toBe(1);
  });
});

describe('corpse fade (crowd shader block)', () => {
  it('no hot peach rim, no value-noise holes: a fine dither fade that serves fade-out (y > 0) and fade-in (y < 0)', () => {
    expect(CROWD_FX_DISSOLVE_EDGE).not.toContain('1.6, 0.55, 0.12');
    expect(CROWD_DISSOLVE).toContain('abs(vFx.y)');
    expect(CROWD_DISSOLVE).toContain('gl_FragCoord');
    expect(CROWD_DISSOLVE).toContain('float crowdEdge');
  });

  it('r2: white noise re-seeded per frame (the r1 interleaved-gradient lattice drew a fishnet), whole body for most of the fade, darkening in the FX block', () => {
    expect(CROWD_DISSOLVE).not.toContain('0.06711056');
    expect(CROWD_DISSOLVE).toContain('uCrowdTime');
    expect(CROWD_DISSOLVE).toMatch(/smoothstep\(0\.[6-9]\d?, 1\.0, crowdProg\)/);
    expect(CROWD_FX_DISSOLVE_EDGE).toContain('crowdAsh');
    expect(CROWD_FX_DISSOLVE_EDGE).toMatch(/\*= 1\.0 - /);
  });
});

describe('r2: stress rationing', () => {
  it('a swarm of summons plays the full vortex for the first one or two, the whisper for the rest; elites always the full spawn', () => {
    const h = harness();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push(...h.send({ t: 'enemySpawn', type: 1, x: 10 + i, z: 0, source: 4, tier: 0 } as Partial<SimEvent> & { t: 'enemySpawn' }).map((f) => f.id));
    expect(ids.filter((i) => i === 'sk.gen.monster_appear').length).toBeLessThanOrEqual(2);
    expect(ids.filter((i) => i === SPAWN_WHISPER_ID).length).toBeGreaterThanOrEqual(5);
    expect(h.send({ t: 'enemySpawn', type: 1, x: 12, z: 3, source: 5, tier: 1 } as Partial<SimEvent> & { t: 'enemySpawn' })[0]?.id).toBe('spawn.elite');
    h.tick(2);
    expect(h.send({ t: 'enemySpawn', type: 1, x: 12, z: 3, source: 4, tier: 0 } as Partial<SimEvent> & { t: 'enemySpawn' })[0]?.id).toBe('sk.gen.monster_appear');
  });

  it('a summon on top of a player is smaller (the vortex must not bury the selection ring); far ones are untouched; no player fed = untouched', () => {
    const p = new Float32Array(12);
    p[0] = 5;
    p[2] = 5;
    expect(playerCrowding(p, 5, 5)).toBeCloseTo(0.55, 5);
    expect(playerCrowding(p, 5, 6.4)).toBeGreaterThan(0.55);
    expect(playerCrowding(p, 5, 6.4)).toBeLessThan(1);
    expect(playerCrowding(p, 12, 5)).toBe(1);
    expect(playerCrowding(new Float32Array(12), 0, 0)).toBe(1);
  });
});
