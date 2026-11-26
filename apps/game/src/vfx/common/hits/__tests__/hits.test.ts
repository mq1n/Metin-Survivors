// hits target (r1 + r2 look guards): route tiers + pierce detection, preset/spec wiring, generated sprites shipped.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../sim/events';
import { PRESETS } from '../../../presets';
import type { Resolved } from '../../../presets';
import type { SpawnOpts } from '../../../types';
import type { RouteCtx } from '../../route';
import type { ParticleSpec } from '../../../spec/types';
import { HIT_ART_IDS } from '../art';
import { ELEMENT_HIT_SPECS, physicalElements } from '../elements';
import { CRIT_BURST_CORE_MAX, CRIT_BURST_RING_MAX } from '../presets';
import { HIT_BODY_Y, PIERCE_WINDOW, hitRoutes, hitScale } from '../route';
import { CRIT_BURST_RING, specs } from '../specs';

/** the colour keys of a spec colour curve: [t, 0xRRGGBB, alpha, ...] */
function keys(c: readonly number[] | undefined): { t: number; r: number; g: number; b: number; a: number }[] {
  const out: { t: number; r: number; g: number; b: number; a: number }[] = [];
  for (let i = 0; c && i + 2 < c.length; i += 3) {
    const hex = c[i + 1] as number;
    out.push({ t: c[i] as number, r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255, a: c[i + 2] as number });
  }
  return out;
}
function hue(k: { r: number; g: number; b: number }): number {
  const mx = Math.max(k.r, k.g, k.b);
  const mn = Math.min(k.r, k.g, k.b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h = mx === k.r ? ((k.g - k.b) / d) % 6 : mx === k.g ? (k.b - k.r) / d + 2 : (k.r - k.g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
function peak(c: unknown): number {
  const a = Array.isArray(c) ? (c.length > 0 && Array.isArray(c[0]) ? (c[0] as number[]) : (c as number[])) : [];
  let m = 0;
  for (let i = 1; i < a.length; i += 2) m = Math.max(m, a[i] as number);
  return m;
}
const particles = (els: readonly unknown[]): ParticleSpec[] => els.filter((e) => (e as ParticleSpec).kind === 'particle') as ParticleSpec[];

interface Fired {
  id: string;
  o: SpawnOpts;
}

function harness() {
  const fired: Fired[] = [];
  let time = 0;
  const ctx: RouteCtx = {
    get time() {
      return time;
    },
    density: 1,
    players: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    heightAt: () => 2,
    resolve: (id) => ({ def: { id }, palette: null, element: -1, variant: -1 }) as unknown as Resolved,
    o: (x, z, scale, dirX, dirZ) => ({ x, z, scale, dirX, dirZ }),
    fire: () => 0,
    spawnResolved: (r, o) => {
      fired.push({ id: r.def.id, o: { ...o } });
      return 0;
    },
    stop: () => {},
    alive: () => false,
    once: () => true,
    since: () => Infinity,
    mark: () => {},
    deathPreset: () => undefined,
    metinRune: () => 0,
    bossPos: () => false,
    telegraphEvents: false,
  };
  const routes = hitRoutes();
  const send = (e: Partial<SimEvent>): Fired[] => {
    const n = fired.length;
    const ev = { t: 'damage', x: 0, z: 0, amount: 40, crit: false, element: 0, targetId: 1, player: 0, skill: -1, killed: false, dot: false, boss: false, ...e } as SimEvent;
    for (const r of routes) r.handle(ev, ctx);
    return fired.slice(n);
  };
  const tick = (dt: number): void => {
    time += dt;
    for (const r of routes) r.update?.(dt, ctx);
  };
  tick(1 / 60);
  return { send, tick };
}

describe('hits route', () => {
  it('element hit at body height, physical blow on the ground (its spec carries the lift)', () => {
    const h = harness();
    const fire = h.send({ element: 1 });
    expect(fire.map((f) => f.id)).toEqual(['hit.fire']);
    expect(fire[0]?.o.y).toBeCloseTo(2 + HIT_BODY_Y);
    const phys = h.send({ element: 0 });
    expect(phys.map((f) => f.id)).toEqual(['sk.gen.hit']);
    expect(phys[0]?.o.y).toBe(2);
  });

  it('crit adds the critical twirl; DoT ticks are left to the status route', () => {
    const h = harness();
    expect(h.send({ crit: true, element: 3 }).map((f) => f.id)).toEqual(['hit.lightning', 'sk.gen.critical']);
    expect(h.send({ dot: true, element: 1 })).toEqual([]);
  });

  it('a physical crit shrinks the blow to its ochre heart under the gold critical (no full cream sunburst under the ring)', () => {
    const h = harness();
    const crit = h.send({ crit: true, element: 0 });
    expect(crit.map((f) => f.id)).toEqual(['sk.gen.hit', 'sk.gen.critical']);
    const plain = h.send({ crit: false, element: 0 });
    expect(plain.map((f) => f.id)).toEqual(['sk.gen.hit']);
    expect(crit[0]?.o.scale ?? 1).toBeLessThan((plain[0]?.o.scale ?? 1) * 0.6);
  });

  it('size tiers: light < heavy < boss; crits and killing blows never small', () => {
    expect(hitScale(5, false, false, false)).toBeLessThan(hitScale(900, false, false, false));
    expect(hitScale(900, false, false, false)).toBeLessThan(hitScale(5, false, true, false));
    expect(hitScale(1, true, false, false)).toBeGreaterThanOrEqual(1.12);
    expect(hitScale(1, false, false, true)).toBeGreaterThanOrEqual(1.05);
  });

  it('projectile pass-through: a later hit of the same skill further along the line plays the piercing hit along the travel', () => {
    const h = harness();
    expect(h.send({ skill: 3, targetId: 10, x: 0, z: 3 }).map((f) => f.id)).toEqual(['sk.gen.hit']);
    h.tick(0.05);
    const second = h.send({ skill: 3, targetId: 11, x: 0.05, z: 5 });
    expect(second.map((f) => f.id)).toEqual(['sk.gen.hit', 'sk.gen.penetrate']);
    const pen = second[1] as Fired;
    expect(pen.o.dirZ ?? 0).toBeGreaterThan(0.99);
  });

  it('no pierce for same-tick multi hits (melee sweeps), other directions, other skills or after the window', () => {
    const h = harness();
    h.send({ skill: 3, targetId: 10, x: 0, z: 3 });
    expect(h.send({ skill: 3, targetId: 11, x: 0, z: 5 }).map((f) => f.id)).not.toContain('sk.gen.penetrate'); // same tick
    h.tick(0.05);
    expect(h.send({ skill: 3, targetId: 12, x: 4, z: 5 }).map((f) => f.id)).not.toContain('sk.gen.penetrate'); // off line
    h.tick(0.05);
    expect(h.send({ skill: 4, targetId: 13, x: 4.2, z: 6 }).map((f) => f.id)).not.toContain('sk.gen.penetrate'); // other slot
    h.tick(PIERCE_WINDOW + 0.1);
    expect(h.send({ skill: 3, targetId: 14, x: 6, z: 7.5 }).map((f) => f.id)).not.toContain('sk.gen.penetrate'); // too late
  });

  it('honours a sim pierce flag when the event carries one', () => {
    const h = harness();
    const out = h.send({ skill: 2, pierce: true } as Partial<SimEvent>);
    expect(out.map((f) => f.id)).toContain('sk.gen.penetrate');
  });
});

describe('hits presets + specs', () => {
  const ids = new Map(PRESETS.map((p) => [p.id, p]));
  it.each(['hit.physical', 'hit.fire', 'hit.ice', 'hit.lightning', 'hit.dark', 'hit.poison', 'hit.holy', 'hit.wind', 'hit.crit', 'sk.gen.hit', 'sk.gen.critical', 'sk.gen.penetrate'])('%s is registered', (id) => {
    expect(ids.has(id)).toBe(true);
  });

  it('element hits stay classic `hit` presets (size mult, no palette variants)', () => {
    for (const s of ELEMENT_HIT_SPECS) {
      const def = ids.get(s.id);
      expect(def?.cat).toBe('hit');
      expect(def?.size).toBe('mult');
      expect(def?.variants === true).toBe(false);
    }
  });

  it('every element hit has a generated signature or blow sprite and stays small enough for a crowd', () => {
    for (const s of [...ELEMENT_HIT_SPECS, ...specs]) {
      const els = s.elements ?? [];
      expect(els.length).toBeLessThanOrEqual(10);
      const usesArt = els.some((e) => typeof e.tex === 'object' && e.tex !== null && 'art' in e.tex);
      expect(usesArt).toBe(true);
      let maxAlive = 0;
      for (const e of els) if (e.kind === 'particle') maxAlive += e.max;
      expect(maxAlive).toBeLessThanOrEqual(30);
    }
    expect(CRIT_BURST_CORE_MAX).toBeLessThanOrEqual(1.5);
  });

  it('ships every generated hit sprite in the texture manifest', () => {
    const man = JSON.parse(readFileSync(new URL('../../../../../public/assets/manifest/textures.json', import.meta.url), 'utf8')) as Record<string, { kind: string }>;
    for (const id of HIT_ART_IDS) expect(man[id]?.kind).toBe('vfx');
  });
});

describe('hits r2 look guards (critic round 1: no white bloom, no lilac tail, body-sized)', () => {
  const all = [...ELEMENT_HIT_SPECS, ...specs];

  it('no additive element opens near-white: every colour curve starts in the element colour', () => {
    for (const sp of all) {
      for (const e of particles(sp.elements ?? [])) {
        if (e.blend === 'alpha') continue;
        const k = keys(e.color as number[])[0];
        if (!k) continue;
        expect(Math.min(k.r, k.g, k.b), `${sp.id}: ${e.note}`).toBeLessThan(0xd8);
      }
    }
  });

  it('the physical blow has no lilac / blue-violet tail and is gone by 0.3 s', () => {
    for (const e of particles(physicalElements())) {
      const life = peak(e.life);
      expect(life, String(e.note)).toBeLessThanOrEqual(0.31);
      for (const k of keys(e.color as number[])) {
        if (k.a < 0.05) continue;
        const h = hue(k);
        const sat = (Math.max(k.r, k.g, k.b) - Math.min(k.r, k.g, k.b)) / Math.max(1, Math.max(k.r, k.g, k.b));
        expect(h > 235 && h < 330 && sat > 0.12, `${e.note} key ${k.t} hue ${Math.round(h)}`).toBe(false);
      }
    }
  });

  it('element hits are body-sized: no quad wider than 2.3 m at k = 1 and every tail ends by 0.56 s', () => {
    for (const sp of ELEMENT_HIT_SPECS) {
      for (const e of particles(sp.elements ?? [])) {
        const sc = Array.isArray(e.scale) && Array.isArray((e.scale as unknown[])[0]) ? peak((e.scale as unknown[][])[0]) : peak(e.scale);
        expect(peak(e.half) * Math.max(1, sc) * 2, `${sp.id}: ${e.note}`).toBeLessThanOrEqual(2.3);
        expect(peak(e.life), `${sp.id}: ${e.note}`).toBeLessThanOrEqual(0.56);
      }
    }
  });

  it('every element keeps an ALPHA body so its colour survives on snow (dark: a near-black one)', () => {
    for (const sp of ELEMENT_HIT_SPECS) {
      const hasAlpha = particles(sp.elements ?? []).some((e) => e.blend === 'alpha' && keys(e.color as number[]).some((k) => k.a >= 0.3));
      expect(hasAlpha, sp.id).toBe(true);
    }
    const dark = ELEMENT_HIT_SPECS.find((s) => s.id === 'hit.dark');
    const body = particles(dark?.elements ?? []).find((e) => e.blend === 'alpha');
    const k = keys(body?.color as number[])[0];
    expect(Math.max(k?.r ?? 255, k?.g ?? 255, k?.b ?? 255)).toBeLessThan(0x30);
  });

  it('the critical is gold, never a white-hot disc: no glow/cloud element above 0.5 alpha, ring keys start gold', () => {
    const crit = specs.find((s) => s.id === 'sk.gen.critical');
    for (const e of particles(crit?.elements ?? [])) {
      const ks = keys(e.color as number[]);
      const hotCore = e.tex === 'glowCore'; // the one gold-white inner glow: short, small, never the whole target
      if (hotCore) {
        expect(peak(e.life)).toBeLessThanOrEqual(0.2);
        expect(peak(e.half)).toBeLessThanOrEqual(0.32);
      }
      for (const k of ks) expect(k.b, `${e.note}`).toBeLessThan(hotCore ? 0xc8 : 0xa0); // gold / orange: blue channel stays low
      if (e.tex === 'glow') for (const k of ks) expect(k.a).toBeLessThanOrEqual(0.5);
    }
  });
});

describe('hits r3 look guards (critic round 2: round masked sprites, own silhouette per element, one soft crit ring)', () => {
  const art = (e: ParticleSpec): string => (typeof e.tex === 'object' && e.tex !== null && 'art' in e.tex ? String((e.tex as { art: unknown }).art) : '');

  it('the fine-ray sunburst opens ONLY the physical blow (and the gold ray burst of the crit / pierce): never fire, ice, lightning, dark, poison, holy, wind', () => {
    for (const sp of ELEMENT_HIT_SPECS) {
      const n = particles(sp.elements ?? []).filter((e) => art(e) === 'vfx_hit_spark').length;
      if (sp.id === 'hit.physical') expect(n).toBeGreaterThanOrEqual(1);
      else expect(n, sp.id).toBe(0);
    }
  });

  it('additive spark / puff elements carry no occlusion matte (it drew grey streaks on the floor)', () => {
    for (const sp of [...ELEMENT_HIT_SPECS, ...specs]) {
      for (const e of particles(sp.elements ?? [])) {
        const a = art(e);
        if ((a === 'vfx_hit_spark' || a === 'vfx_hit_puff') && e.blend !== 'alpha') expect(e.occlude ?? 0, `${sp.id}: ${e.note}`).toBe(0);
      }
    }
  });

  it('every element owns an alpha body AND its own aspect: tall flames, round smudge, wide blob (not the same round puff)', () => {
    const aspect = (id: string): number => {
      const sp = ELEMENT_HIT_SPECS.find((s) => s.id === id);
      const body = particles(sp?.elements ?? []).find((e) => e.blend === 'alpha' && Array.isArray(e.scale) && Array.isArray((e.scale as unknown[])[0]));
      if (!body) return 1;
      const [sx, sy] = body.scale as unknown as number[][];
      return peak(sy) / Math.max(0.01, peak(sx));
    };
    expect(aspect('hit.fire')).toBeGreaterThan(1.1); // flames rise
  });

  it('the critical ring is one soft ring that is gone by 0.36 s and the burst has ONE ring, capped', () => {
    for (const sp of [...specs.filter((s) => s.id === 'sk.gen.critical')]) {
      const rings = particles(sp.elements ?? []).filter((e) => art(e) === 'vfx_hit_twirl' && e.blend !== 'alpha');
      expect(rings.length).toBeGreaterThanOrEqual(1);
      for (const e of particles(sp.elements ?? []).filter((x) => art(x) === 'vfx_hit_twirl')) expect(peak(e.life), String(e.note)).toBeLessThanOrEqual(0.36);
    }
    const core = specs.find((s) => s.id === 'sk.gen.crit_burst_core');
    expect(particles(core?.elements ?? []).filter((e) => art(e) === 'vfx_hit_twirl').length).toBe(0);
    for (const e of particles(CRIT_BURST_RING.elements ?? [])) expect(peak(e.half) * CRIT_BURST_RING_MAX * 2).toBeLessThanOrEqual(3.4);
  });

  it('penetrate needles die before the core glow and come in two lengths', () => {
    const pen = specs.find((s) => s.id === 'sk.gen.penetrate');
    const els = particles(pen?.elements ?? []);
    const needles = els.filter((e) => e.tex === 'streakSoft' && e.billboard === 'stretch' && peak(e.life) > 0.2);
    expect(needles.length).toBeGreaterThanOrEqual(2);
    expect(new Set(needles.map((e) => peak(e.half))).size).toBeGreaterThanOrEqual(2);
    const glow = els.find((e) => art(e) === 'vfx_hit_puff' && e.blend === 'add');
    for (const n of needles) expect(peak(n.life)).toBeLessThanOrEqual(peak(glow?.life) + 0.05);
  });
});
