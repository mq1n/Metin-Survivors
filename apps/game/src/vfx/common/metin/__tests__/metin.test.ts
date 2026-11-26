// metin target (r1 look guards): ids are the contract, every sprite exists in the manifest, the numbers the blind critic judged
// (drop = brown smoke over fire, crash = dark red ball in a hot ring, loops = saturated wisps + an alpha body so snow keeps the hue,
// break = white-hot ball + red streaks + blue smoke + long green lines), the route fire lists, the splash throttle and the loop respawn.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../sim/events';
import { PRESETS } from '../../../presets';
import type { Resolved } from '../../../presets';
import type { SpawnOpts } from '../../../types';
import type { ElementSpec, FxSpec, ParticleSpec } from '../../../spec/types';
import { COMMON_TARGET_SPECS } from '../../index';
import type { RouteCtx } from '../../route';
import { METIN_ART_IDS } from '../art';
import { AURA_CHECK, metinRoutes } from '../route';
import { METIN_LOOP_SETS, metinLoopId, specs } from '../specs';

const byId = (id: string): FxSpec => {
  const s = specs.find((x) => x.id === id);
  if (!s) throw new Error(`no spec ${id}`);
  return s;
};
const particles = (s: FxSpec): ParticleSpec[] => s.elements.filter((e): e is ParticleSpec => e.kind === 'particle');
const artsOf = (e: ElementSpec): string[] => {
  const t = (e as { tex?: unknown }).tex as { art?: string | readonly string[] } | undefined;
  if (!t || typeof t !== 'object' || t.art === undefined) return [];
  return Array.isArray(t.art) ? [...t.art] : [String(t.art)];
};
/** peak alpha of a colour curve [t, hex, a, t, hex, a, ...] */
function peakA(c: unknown): number {
  const a = c as number[];
  let m = 0;
  for (let i = 2; i < a.length; i += 3) m = Math.max(m, a[i] as number);
  return m;
}
const rgbOf = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

const EVENT_IDS = ['sk.gen.metin_drop', 'sk.gen.metin_crash', 'sk.gen.metin_break', 'sk.gen.metin_blow', 'sk.gen.metin_laser', 'sk.gen.metin_splash'];
const CLASSIC_IDS = ['metin.fall', 'metin.impact', 'metin.aura', 'metin.aura.awakened', 'metin.awaken', 'metin.shatter', 'metin.pulse'];

describe('metin ids and art', () => {
  it('keeps every id (6 event specs, 9 sets x 4 stages of loops, 7 classics)', () => {
    const ids = new Set(specs.map((s) => s.id));
    for (const id of EVENT_IDS) expect(ids.has(id), id).toBe(true);
    for (const set of METIN_LOOP_SETS) {
      for (const stage of [1, 2, 3, 4]) expect(ids.has(set === 'green' ? `sk.gen.metin_loop${stage}` : `sk.gen.metin_loop${stage}.${set}`), `${set} ${stage}`).toBe(true);
    }
    const reg = new Set(PRESETS.map((p) => p.id));
    for (const id of CLASSIC_IDS) expect(reg.has(id), id).toBe(true);
    expect(COMMON_TARGET_SPECS.filter((s) => s.id.startsWith('sk.gen.metin_loop')).length).toBe(36);
  });

  it('every sprite a metin spec draws is listed in art.ts and shipped in the manifest as an additive / alpha vfx texture', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind: string }>;
    const listed = new Set(METIN_ART_IDS);
    for (const id of METIN_ART_IDS) expect(manifest[id]?.kind, id).toBe('vfx');
    for (const s of specs) for (const e of s.elements) for (const a of artsOf(e)) expect(listed.has(a), `${s.id}: ${a}`).toBe(true);
  });

  it('every metin sprite id follows the clean vfx_ naming convention', () => {
    for (const id of METIN_ART_IDS) expect(/^vfx_[a-z0-9_]+$/.test(id), id).toBe(true);
  });
});

describe('metin corruption loops (saturated wisps hugging the stone)', () => {
  it('every loop is a persistentAura that keeps a coloured alpha body and a curling wisp layer (hue survives on snow)', () => {
    for (const s of specs.filter((x) => x.id.startsWith('sk.gen.metin_loop'))) {
      expect(s.behavior, s.id).toBe('persistentAura');
      const ps = particles(s);
      expect(ps.some((e) => e.blend === 'alpha'), `${s.id} alpha body`).toBe(true);
      expect(ps.some((e) => e.blend === 'add' && artsOf(e).some((a) => /wisp|curl/.test(a))), `${s.id} wisps`).toBe(true);
    }
  });

  it('stage 1 is a thin tail, stage 4 a dense column (element count and wisp rate grow with the stage)', () => {
    const n = (st: number) => particles(byId(`sk.gen.metin_loop${st}`)).length;
    expect(n(1)).toBeLessThan(n(2));
    expect(n(2)).toBeLessThan(n(3));
    expect(n(3)).toBeLessThan(n(4));
    const wispRate = (st: number) => {
      const w = particles(byId(`sk.gen.metin_loop${st}`)).find((e) => e.blend === 'add' && artsOf(e).some((a) => /wisp|curl/.test(a)));
      return (w?.rate as number[])[1] as number;
    };
    expect(wispRate(4)).toBeGreaterThan(wispRate(1) * 2);
  });

  it('9 colour sets map by hue and the sets stay saturated (no grey wisp bodies)', () => {
    expect(metinLoopId(0x36f172, 1)).toBe('sk.gen.metin_loop1');
    expect(metinLoopId(0x853de9, 4)).toBe('sk.gen.metin_loop4.purple');
    expect(metinLoopId(0xfa993e, 2)).toBe('sk.gen.metin_loop2.orange');
    expect(metinLoopId(0x394deb, 3)).toBe('sk.gen.metin_loop3.blue');
    expect(metinLoopId(0xf244ca, 1)).toBe('sk.gen.metin_loop1.pink');
    for (const set of METIN_LOOP_SETS) {
      if (set === 'whitepurple') continue;
      const s = byId(set === 'green' ? 'sk.gen.metin_loop3' : `sk.gen.metin_loop3.${set}`);
      const wisp = particles(s).find((e) => e.blend === 'add' && artsOf(e).some((a) => /wisp|curl/.test(a)));
      const c = wisp?.color as number[];
      const [r, g, b] = rgbOf(c[4] as number);
      const hi = Math.max(r, g, b);
      const lo = Math.min(r, g, b);
      expect((hi - lo) / Math.max(1, hi), `${set} mid colour saturation`).toBeGreaterThan(0.45);
    }
  });
});

describe('metin one-shots (drop, crash, break)', () => {
  it('drop: dark brown ALPHA smoke over orange ADD fire, rock chips, a ground ring that is a lumpy sprite, and no white disc', () => {
    const ps = particles(byId('sk.gen.metin_drop'));
    const smoke = ps.filter((e) => e.blend === 'alpha' && artsOf(e).some((a) => /smoke|dust/.test(a)));
    expect(smoke.length).toBeGreaterThanOrEqual(2);
    for (const e of smoke) {
      const [r, g, b] = rgbOf((e.color as number[])[1] as number);
      expect(r, 'smoke is brown (r > g > b)').toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
      expect(r, 'dark').toBeLessThan(0x90);
    }
    expect(ps.some((e) => e.blend === 'add' && artsOf(e).some((a) => /flame|fire/.test(a)))).toBe(true);
    expect(ps.some((e) => e.billboard === 'ground' && artsOf(e).some((a) => /ring_smoke_ragged/.test(a)))).toBe(true);
    expect(ps.some((e) => e.blend === 'alpha' && artsOf(e).some((a) => /rock/.test(a)))).toBe(true);
    // the finale never draws the white-hot disc sprite
    for (const e of ps.filter((x) => x.tEnd !== undefined)) expect(artsOf(e).some((a) => /hotcore/.test(a)), `tEnd element ${e.note}`).toBe(false);
  });

  it('crash: dark red alpha smoke ball, orange glow inside, two ground rings of lumpy sprites, sparks and chips', () => {
    const ps = particles(byId('sk.gen.metin_crash'));
    const ball = ps.filter((e) => e.blend === 'alpha' && (e.shape as { kind?: string } | undefined)?.kind === 'sphere' && artsOf(e).length > 0);
    expect(ball.length).toBeGreaterThanOrEqual(2);
    const [r, g, b] = rgbOf((ball[0]?.color as number[])[1] as number);
    expect(r).toBeGreaterThan(g * 2);
    expect(g).toBeGreaterThanOrEqual(b);
    const rings = ps.filter((e) => e.billboard === 'ground' && e.blend === 'add' && artsOf(e).some((a) => /ring/.test(a)));
    expect(rings.length).toBeGreaterThanOrEqual(3);
    expect(ps.some((e) => e.billboard === 'stretch' && e.blend === 'add')).toBe(true);
    expect(ps.some((e) => e.blend === 'alpha' && artsOf(e).some((a) => /rock/.test(a)))).toBe(true);
  });

  it('break: white-hot core in an orange alpha body, red-orange streak stars, chips, blue smoke (alpha + add), long green needle lines with a white core', () => {
    const ps = particles(byId('sk.gen.metin_break'));
    expect(ps.some((e) => artsOf(e).some((a) => /hotcore/.test(a)) && e.blend === 'add')).toBe(true);
    expect(ps.some((e) => artsOf(e).some((a) => /burst_fire_rays/.test(a)))).toBe(true);
    expect(ps.some((e) => e.billboard === 'stretch')).toBe(true);
    const blue = ps.filter((e) => {
      const c = (e.color as number[])[4] as number;
      const [r, , b] = rgbOf(c);
      return b > r * 1.3 && /cloud|smoke|vortex|puff/.test(artsOf(e).join(','));
    });
    expect(blue.some((e) => e.blend === 'add')).toBe(true);
    expect(blue.some((e) => e.blend === 'alpha')).toBe(true);
    const lines = ps.filter((e) => artsOf(e).some((a) => /needles/.test(a)));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const big = lines.find((e) => e.billboard === 'screen');
    expect(Number((big?.half as number[])[1]), 'the laser lines are the longest thing in the break').toBeGreaterThanOrEqual(4);
    const [r, g, b] = rgbOf((big?.color as number[])[4] as number);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    // the white core of the laser
    expect(ps.some((e) => artsOf(e).some((a) => /glow_orb_core/.test(a)) && (e.color as number[])[1] === 0xffffff)).toBe(true);
  });

  it('peak alpha of every one-shot element stays <= 1 and the hot cores are capped (no white wash)', () => {
    for (const id of EVENT_IDS) {
      for (const e of particles(byId(id))) {
        expect(peakA(e.color), `${id} ${e.note}`).toBeLessThanOrEqual(1.0001);
        if (typeof e.clamp === 'number') expect(e.clamp, `${id} ${e.note}`).toBeLessThanOrEqual(1.3);
      }
    }
  });
});

interface Fired {
  id: string;
  o: SpawnOpts;
}

function harness() {
  const fired: Fired[] = [];
  const live = new Set<number>();
  let time = 0;
  let next = 1;
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
      const h = next++;
      live.add(h);
      return h;
    },
    spawnResolved: () => 0,
    stop: (h) => void live.delete(h),
    alive: (h) => live.has(h),
    once: () => true,
    since: () => Infinity,
    mark: () => undefined,
    deathPreset: () => undefined,
    metinRune: () => 0x853de9,
    bossPos: () => false,
    telegraphEvents: false,
  };
  const routes = metinRoutes();
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
  return { fired, send, tick, live };
}

describe('metin routes', () => {
  it('warn = the burning column held for the warn window + the sky trail', () => {
    const h = harness();
    expect(h.send({ t: 'metinWarn', metin: 1, def: 'metin_ebon', x: 2, z: 3, dur: 2.6, great: false })).toEqual(['sk.gen.metin_drop', 'metin.fall']);
    expect(h.fired[0]?.o.duration).toBe(2.6);
    expect(h.fired[1]?.o.duration).toBe(2.6);
    const g = harness();
    g.send({ t: 'metinWarn', metin: 1, def: 'metin_ebon', x: 2, z: 3, dur: 2.6, great: true });
    expect(g.fired[0]?.o.scale).toBeGreaterThan(h.fired[0]?.o.scale ?? 0);
  });

  it('impact = crash + scar + the stage 1 loop in the rune colour; awaken = burst + the stage 4 loop; break = break + essence reveal, loop stopped', () => {
    const h = harness();
    expect(h.send({ t: 'metinImpact', metin: 7, def: 'metin_lament', x: 4, z: 4, radius: 3, great: false })).toEqual(['sk.gen.metin_crash', 'metin.impact', 'sk.gen.metin_loop1.purple']);
    expect(h.send({ t: 'metinAwaken', metin: 7, def: 'metin_lament', x: 4, z: 4 })).toEqual(['metin.awaken', 'sk.gen.metin_loop4.purple']);
    const loop = h.fired.length;
    expect(h.live.has(loop)).toBe(true);
    expect(h.live.has(3)).toBe(false); // the stage 1 loop was replaced
    expect(h.send({ t: 'metinBreak', metin: 7, def: 'metin_lament', x: 4, z: 4, great: false, awakened: true })).toEqual(['sk.gen.metin_break', 'metin.shatter']);
    expect(h.live.has(loop)).toBe(false);
    expect(h.fired.at(-1)?.o.a).toBe(1);
  });

  it('the great metin breaks bigger than a normal one but stays under the coverage-budget cap (measured: 3.6 changed 30 % of the frame, 3.0 changes 24 %)', () => {
    const n = harness();
    n.send({ t: 'metinBreak', metin: 1, def: 'metin_ebon', x: 0, z: 0, great: false, awakened: false });
    const g = harness();
    g.send({ t: 'metinBreak', metin: 2, def: 'metin_ebon', x: 0, z: 0, great: true, awakened: true });
    const sn = n.fired[0]?.o.scale ?? 0;
    const sg = g.fired[0]?.o.scale ?? 0;
    expect(sg).toBeGreaterThan(sn);
    expect(sg).toBeLessThanOrEqual(3.0);
  });

  it('a loop that ended while its stone stands is respawned; a broken stone stays quiet', () => {
    const h = harness();
    h.send({ t: 'metinImpact', metin: 7, def: 'metin_lament', x: 4, z: 4, radius: 3, great: false });
    const loop = h.fired.length;
    h.live.delete(loop);
    h.tick(AURA_CHECK + 0.05);
    expect(h.fired.at(-1)?.id).toBe('sk.gen.metin_loop1.purple');
    h.send({ t: 'metinBreak', metin: 7, def: 'metin_lament', x: 4, z: 4, great: false, awakened: false });
    const after = h.fired.length;
    h.tick(1);
    expect(h.fired.length).toBe(after);
  });

  it('a hit ON a standing stone plays the splash (throttled per stone); a far hit or a DoT tick does not', () => {
    const h = harness();
    h.send({ t: 'metinImpact', metin: 7, def: 'metin_lament', x: 4, z: 4, radius: 3, great: false });
    const dmg = (x: number, z: number, dot = false) => h.send({ t: 'damage', x, z, amount: 5, crit: false, element: 0, dot, boss: false, killed: false });
    expect(dmg(4.3, 4.2)).toEqual(['sk.gen.metin_splash']);
    expect(dmg(4.3, 4.2)).toEqual([]);
    h.tick(0.6);
    expect(dmg(4.3, 4.2)).toEqual(['sk.gen.metin_splash']);
    expect(dmg(12, 12)).toEqual([]);
    h.tick(0.6);
    expect(dmg(4.1, 4.1, true)).toEqual([]);
  });
});
