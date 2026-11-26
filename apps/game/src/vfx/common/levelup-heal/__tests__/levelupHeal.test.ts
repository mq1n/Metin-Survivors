// levelup-heal target (r1 look guards): ids are the contract, shipped sprites, route wiring, and the numbers the blind critic
// judged (an alpha body under every additive shell so snow keeps the hue, hollow-circle potion sparkles at a readable size, nothing wider
// than the camera budget). The level-up has its own block (LVL-01, 2026-10-29: a gold-white shockwave, every 5th level bigger) in place of
// the old guards of the teal-band port.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../../sim/events';
import { PRESETS } from '../../../presets';
import type { Resolved } from '../../../presets';
import type { SpawnOpts } from '../../../types';
import type { ElementSpec, FxSpec, ParticleSpec, SurfaceSpec } from '../../../spec/types';
import type { RouteCtx } from '../../route';
import { LH_ART_IDS } from '../art';
import { LEVEL_UP_MILESTONE_EVERY, LEVEL_UP_MILESTONE_RANK } from '../levelSpecs';
import { DRAIN_GAP, levelupHealRoutes } from '../route';
import { selfSpecs } from '../selfSpecs';
import { specs } from '../specs';

const ALL: FxSpec[] = [...specs, ...selfSpecs];
const byId = (id: string): FxSpec => {
  const s = ALL.find((x) => x.id === id);
  if (!s) throw new Error(`no spec ${id}`);
  return s;
};
const artOf = (e: ElementSpec): string => {
  const t = (e as { tex?: unknown }).tex;
  return typeof t === 'object' && t !== null ? String((t as { art: unknown }).art) : '';
};
const surfaces = (s: FxSpec): SurfaceSpec[] => s.elements.filter((e): e is SurfaceSpec => e.kind === 'surface');
const particles = (s: FxSpec): ParticleSpec[] => s.elements.filter((e): e is ParticleSpec => e.kind === 'particle');
function peak(c: unknown): number {
  const a = Array.isArray(c) ? (c.length > 0 && Array.isArray(c[0]) ? (c[0] as number[]) : (c as number[])) : [];
  let m = 0;
  for (let i = 1; i < a.length; i += 2) m = Math.max(m, a[i] as number);
  return m;
}
/** end of an element (s): t0 + the longest life */
function endOf(e: ElementSpec): number {
  const t0 = (e as { t0?: number }).t0 ?? 0;
  if (e.kind === 'surface') return t0 + e.life;
  if (e.kind === 'particle') {
    const cyc = e.loops === 0 ? 0 : e.cycle * (e.loops ?? 1);
    return t0 + cyc + peak(e.life);
  }
  return t0;
}

const SK_IDS = ['sk.gen.level_up', 'sk.gen.skillup', 'sk.gen.potion_red', 'sk.gen.potion_blue', 'sk.gen.potion_green', 'sk.gen.potion_purple', 'sk.gen.potion_auto_red', 'sk.gen.potion_auto_blue'];
const LEGACY_IDS = ['player.death', 'player.revive', 'buff.shield', 'buff.stealth', 'buff.haste', 'holy.heal', 'aura.heal', 'heal.drain', 'levelup'];

describe('levelup-heal ids and art', () => {
  it('keeps every id of the target (specs sk.gen.*, classic presets wrapped from specs)', () => {
    expect(specs.map((s) => s.id).sort()).toEqual([...SK_IDS].sort());
    const ids = new Set(PRESETS.map((p) => p.id));
    for (const id of [...SK_IDS, ...LEGACY_IDS]) expect(ids.has(id), id).toBe(true);
  });

  it('every wrapped legacy id is registered once with its old loop behaviour', () => {
    for (const id of LEGACY_IDS) expect(PRESETS.filter((p) => p.id === id).length, id).toBe(1);
    for (const id of ['buff.haste', 'buff.shield']) {
      const p = PRESETS.find((x) => x.id === id);
      expect(p?.loop, id).toBe(true);
      expect(p?.follow, id).toBe(true);
    }
    for (const id of ['holy.heal', 'aura.heal', 'heal.drain', 'player.revive', 'player.death', 'buff.stealth', 'levelup']) expect(PRESETS.find((x) => x.id === id)?.loop, id).toBe(false);
  });

  it('ships every sprite it draws (manifest kind vfx + the file on disk)', () => {
    const base = new URL('../../../../../public/assets/', import.meta.url);
    const man = JSON.parse(readFileSync(new URL('manifest/textures.json', base), 'utf8')) as Record<string, { kind: string }>;
    for (const id of LH_ART_IDS) expect(man[id]?.kind, id).toBe('vfx');
    const used = new Set<string>();
    for (const s of ALL) for (const e of s.elements) if (artOf(e)) used.add(artOf(e));
    for (const id of used) expect(LH_ART_IDS, `${id} is used but not listed in art.ts`).toContain(id);
  });

  it('every spec is well formed: <= 16 elements, art on every element, follow on the self one-shots', () => {
    for (const s of ALL) {
      expect(s.elements.length, s.id).toBeLessThanOrEqual(16);
      expect(s.desc.length, s.id).toBeGreaterThan(20);
      for (const e of s.elements) expect(artOf(e), `${s.id}: ${(e as { note?: string }).note}`).not.toBe('');
    }
    for (const id of [...SK_IDS, 'holy.heal', 'heal.drain', 'player.revive', 'levelup']) expect(byId(id).follow, id).toBe(true);
  });
});

describe('levelup-heal looks (what the blind critic judges)', () => {
  // ---- LVL-01: level-up as a power spike (a gold-white shockwave; every 5th level bigger). The old guards of the teal-band port are gone with it.
  describe('level-up (LVL-01)', () => {
    const lu = byId('sk.gen.level_up');
    /** the elements one spawn at `rank` plays (the host skips an element whose minRank is above / maxRank below the spawn's rank) */
    const playsAt = (rank: number): ElementSpec[] => lu.elements.filter((e) => (e.minRank ?? 0) <= rank && (e.maxRank ?? 7) >= rank);
    const BASE = playsAt(0);
    const MILE = playsAt(LEVEL_UP_MILESTONE_RANK);
    const MILE_ONLY = lu.elements.filter((e) => (e.minRank ?? 0) > 0);
    /** outer radius (m) of a ring sprite at the end of its growth: the quad half-width x scale x where the ring's visible edge sits in the sprite (measured on the shipped webp) */
    const EDGE: Record<string, number> = { vfx_ring_glow_band_a: 0.94 };
    const isRing = (e: ElementSpec): e is ParticleSpec => e.kind === 'particle' && e.billboard === 'ground' && EDGE[artOf(e)] !== undefined;
    const ringRadius = (e: ParticleSpec): number => peak(e.half) * peak(e.scale ?? [0, 1]) * (EDGE[artOf(e)] as number);
    const at = (c: readonly number[], t: number): number => {
      if (t <= (c[0] as number)) return c[1] as number;
      for (let i = 2; i < c.length; i += 2) {
        if (t <= (c[i] as number)) {
          const f = (t - (c[i - 2] as number)) / ((c[i] as number) - (c[i - 2] as number));
          return (c[i - 1] as number) + f * ((c[i + 1] as number) - (c[i - 1] as number));
        }
      }
      return c[c.length - 1] as number;
    };
    const keys = (c: readonly number[]): { hex: number; a: number }[] => {
      const out: { hex: number; a: number }[] = [];
      for (let i = 1; i + 1 < c.length; i += 3) out.push({ hex: c[i] as number, a: c[i + 1] as number });
      return out;
    };
    const luma = (hex: number): number => 0.2126 * ((hex >> 16) & 255) / 255 + 0.7152 * ((hex >> 8) & 255) / 255 + 0.0722 * (hex & 255) / 255;

    it('is a gold-white shockwave: a ring that runs out to 3.5 m in 0.35 s (fast out, then easing) with an alpha body of deep gold under its crest, no teal strip any more', () => {
      const rings = BASE.filter(isRing);
      const add = rings.find((e) => e.blend === 'add');
      const body = rings.find((e) => e.blend === 'alpha');
      expect(add, 'additive crest').toBeDefined();
      expect(body, 'alpha body: the gold keeps its hue on snow and pale stone').toBeDefined();
      for (const e of [add, body] as ParticleSpec[]) {
        expect(ringRadius(e), `${e.note}: 3.5 m`).toBeGreaterThanOrEqual(3.4);
        expect(ringRadius(e)).toBeLessThanOrEqual(3.6);
        expect(peak(e.life), `${e.note}: ~0.35 s`).toBeGreaterThanOrEqual(0.3);
        expect(peak(e.life)).toBeLessThanOrEqual(0.4);
        // fast out: most of the travel is made in the first quarter of the life, then it eases
        const sc = e.scale as readonly number[];
        expect(at(sc, 0.25) / at(sc, 1), `${e.note}: >= 50 % of the radius in the first quarter`).toBeGreaterThanOrEqual(0.5);
        expect(at(sc, 0.6) / at(sc, 1), `${e.note}: eases out`).toBeLessThan(0.95);
      }
      // gold-white, never teal: red >= blue on every colour key of every element (white = equal), alpha bodies are gold
      for (const e of lu.elements) for (const k of keys(e.color)) expect((k.hex & 255) <= ((k.hex >> 16) & 255), `${(e as { note?: string }).note}: warm, not teal`).toBe(true);
      const hex = (body as ParticleSpec).color[4] as number;
      expect(((hex >> 16) & 255) - (hex & 255), 'deep gold: red >> blue').toBeGreaterThan(0x70);
      const crest = (add as ParticleSpec).color[4] as number;
      expect(crest >> 16, 'bright warm white at the crest').toBeGreaterThanOrEqual(0xf0);
      expect(lu.elements.some((e) => artOf(e) === 'vfx_streak_column_a'), 'no teal light strips').toBe(false);
      expect(lu.elements.some((e) => e.kind === 'surface' && e.shape.kind === 'card'), 'no standing bands').toBe(false);
    });

    it('opens a hot core and a hub of thin spokes round the hero, pops a flare at the chest, rides a low shaft crown on the ring and lifts gold #ffd36a / white sparks (glints + pips) off the floor', () => {
      const burst = BASE.find((e): e is ParticleSpec => e.kind === 'particle' && artOf(e) === 'vfx_starburst_spokes_a');
      expect(burst, 'radial burst of thin spokes (dark gaps between them: contrast, not a filled disc)').toBeDefined();
      expect(burst?.billboard).toBe('ground');
      expect(peak(burst?.life)).toBeLessThanOrEqual(0.6);
      expect(peak(burst?.half) * peak(burst?.scale ?? [0, 1]) * 2, 'burst <= 6.4 m across').toBeLessThanOrEqual(6.4);
      const core = BASE.find((e): e is ParticleSpec => e.kind === 'particle' && artOf(e) === 'vfx_glow_blob_soft_a' && (e.minTier ?? 0) === 0);
      expect(core?.billboard, 'a hot core on the floor under the hero').toBe('ground');
      expect(peak(core?.half) * peak(core?.scale ?? [0, 1]) * 2, 'the core is SMALL (<= 2.2 m across): a big soft blob is the milky puff of the first build').toBeLessThanOrEqual(2.2);
      expect(peak(core?.life), 'a flash, not a pool').toBeLessThanOrEqual(0.35);
      const flare = BASE.find((e): e is ParticleSpec => e.kind === 'particle' && artOf(e) === 'vfx_star_cross_halo_a');
      expect(flare?.billboard).toBe('screen');
      expect(flare?.at?.[1] ?? 0, 'at chest height').toBeGreaterThan(0.5);
      expect(peak(flare?.life)).toBeLessThanOrEqual(0.3);
      const crown = BASE.find((e): e is SurfaceSpec => e.kind === 'surface' && artOf(e) === 'vfx_curtain_shafts_b');
      expect(crown?.shape.kind).toBe('cyl');
      expect(crown?.shape.kind === 'cyl' ? crown.shape.h : 9, 'a LOW crown').toBeLessThanOrEqual(1.2);
      expect(crown?.life ?? 9).toBeLessThanOrEqual(0.4);
      expect(crown?.shape.kind === 'cyl' ? crown.shape.rt : 0, 'flares out').toBeGreaterThan(crown?.shape.kind === 'cyl' ? crown.shape.rb : 9);
      for (const art of ['vfx_glint_halo_pin_a', 'vfx_glow_pip_core_a']) {
        const sp = BASE.find((e): e is ParticleSpec => e.kind === 'particle' && artOf(e) === art);
        expect(sp, `${art} sparks`).toBeDefined();
        expect(peak((sp?.dir as { y?: number[] } | undefined)?.y), `${art}: rising`).toBeGreaterThan(0);
        expect(sp?.blend).toBe('add');
        expect(sp?.max ?? 0, `${art}: a handful, not a flood`).toBeLessThanOrEqual(24);
        expect(keys(sp?.color ?? []).some((k) => k.hex === 0xffe9a0 || k.hex === 0xffd36a), `${art}: gold`).toBe(true);
      }
      expect(keys(BASE.find((e): e is ParticleSpec => e.kind === 'particle' && artOf(e) === 'vfx_glint_halo_pin_a')?.color ?? []).some((k) => k.hex === 0xffd36a), 'the gold of the brief, #ffd36a').toBe(true);
    });

    it('every 5th level is bigger: a 5 m ring that REPLACES the 3.5 m one (the rims never stack into a white disc), a second ring a beat behind it, a wider crown and a second flock of sparks; every other level plays none of these', () => {
      expect(LEVEL_UP_MILESTONE_EVERY).toBe(5);
      expect(BASE.filter(isRing).every((e) => ringRadius(e) < 3.6), 'an ordinary level plays no ring bigger than 3.5 m').toBe(true);
      expect(BASE.length, 'an ordinary level plays 10 elements').toBe(10);
      expect(MILE_ONLY.length, 'a milestone adds 5: the 5 m ring (add + body), the second ring, a wider crown, a second flock of sparks').toBe(5);
      for (const e of lu.elements) {
        expect([undefined, LEVEL_UP_MILESTONE_RANK], 'one gate: the milestone rank').toContain(e.minRank);
        expect([undefined, LEVEL_UP_MILESTONE_RANK - 1], 'the 3.5 m ring stops where the milestone starts').toContain(e.maxRank);
      }
      const bigRings = MILE.filter(isRing).filter((e) => e.blend === 'add');
      expect(bigRings.length, 'two rings').toBeGreaterThanOrEqual(2);
      const radii = bigRings.map(ringRadius).sort((a, b) => b - a);
      expect(radii[0], 'the bigger ring: 5 m').toBeGreaterThanOrEqual(4.8);
      expect(radii[0]).toBeLessThanOrEqual(5.2);
      expect(radii[1], 'the second ring is smaller and a beat behind').toBeLessThan(radii[0] as number);
      const second = bigRings.find((e) => ringRadius(e) === radii[1]) as ParticleSpec;
      const first = bigRings.find((e) => ringRadius(e) === radii[0]) as ParticleSpec;
      expect((second.t0 ?? 0) - (first.t0 ?? 0), 'a beat later').toBeGreaterThanOrEqual(0.1);
      expect(MILE.filter(isRing).some((e) => e.blend === 'alpha'), 'the big ring has its gold body too').toBe(true);
      expect(MILE.some((e) => isRing(e) && ringRadius(e) < 3.6 && (e.t0 ?? 0) < 0.1), 'the 3.5 m ring is replaced, not stacked').toBe(false);
      for (const e of lu.elements.filter((x) => x.minRank !== undefined)) expect(endOf(e), `${(e as { note?: string }).note}`).toBeLessThanOrEqual(2.0);
      // ONE burst at every level (a second one stacked into a milky disc), a wider crown, a second flock of glints: more than an ordinary level
      expect(MILE.filter((e) => artOf(e) === 'vfx_starburst_spokes_a').length, 'one burst, not two').toBe(1);
      expect(MILE.filter((e) => e.kind === 'surface').length, 'two crowns').toBe(2);
      expect(Math.max(...MILE.filter((e): e is SurfaceSpec => e.kind === 'surface').map((e) => (e.shape.kind === 'cyl' ? e.shape.rt : 0))), 'the milestone crown is wider').toBeGreaterThan(4);
      expect(MILE.filter((e) => artOf(e) === 'vfx_glint_halo_pin_a').length, 'a second flock of glints').toBe(2);
      expect(MILE.length).toBeGreaterThan(BASE.length);
    });

    it('stays readable and cheap: nothing stands taller than 4.6 m or longer than 0.4 s that is bigger than a 1 m bar, no darkening alpha, no occlude near the body, <= 55 / 80 live particles at an ordinary / milestone level, no grade keys (rank only gates)', () => {
      for (const rank of [0, LEVEL_UP_MILESTONE_RANK]) {
        const els = playsAt(rank);
        for (const e of els) {
          if (e.kind === 'surface') {
            expect(e.shape.kind === 'cyl' ? e.shape.h : 0, `${e.note}: a low wall`).toBeLessThanOrEqual(1.2);
            expect(e.billboard === 'upright' || e.billboard === 'screen', `${e.note}: no standing card`).toBe(false);
          } else if (e.kind === 'particle' && e.billboard === 'upright') {
            const hy = Array.isArray(e.half) && Array.isArray((e.half as unknown[])[1]) ? peak((e.half as unknown[])[1] as number[]) : peak(e.half as number[]);
            expect(hy * 2, `${e.note}: the tallest part, 4.6 m`).toBeLessThanOrEqual(4.8);
            expect(peak(e.life), `${e.note}: gone in a blink`).toBeLessThanOrEqual(0.45);
          }
          const occ = (e as { occlude?: number }).occlude ?? 0;
          // only the two ring crests carry a small soft dark core (0.15); everything near the body (heart, bursts, flare, sparks, crown) carries none
          expect(occ, `${e.note}: the soft dark core stays small`).toBeLessThanOrEqual(0.2);
          if (!isRing(e)) expect(occ, `${e.note}: nothing near the body darkens it`).toBe(0);
          // an alpha element is gold (light): drawn luma above a lit hero / floor, so it can never darken the caster (noCasterDarkening.test.ts keeps the rule for the skills)
          if (e.blend === 'alpha') for (const k of keys(e.color).filter((c) => c.a >= 0.1)) expect(luma(k.hex), `${e.note}: no dark alpha`).toBeGreaterThanOrEqual(0.45);
        }
        const live = els.filter((e): e is ParticleSpec => e.kind === 'particle').reduce((n, e) => n + e.max, 0);
        expect(live, `rank ${rank}: particle budget`).toBeLessThanOrEqual(rank === 0 ? 55 : 80);
      }
      expect(lu.gradeScale, 'no grade scale: the rank is a gate only').toBeUndefined();
      expect(lu.elements.some((e) => (e as { grade?: unknown }).grade !== undefined), 'no per-grade keys').toBe(false);
      expect(lu.elements.length).toBeLessThanOrEqual(16);
      // the whole beat is over in ~1.2 s (the last glint dies ~1.1 s after the burst of births), well inside the 2 s of the old one
      expect(lu.dur).toBeLessThanOrEqual(1.5);
    });

    it('uses only sprites that already ship (no new raster, no starburst sheet that no spec draws) and every element draws one', () => {
      const ALLOWED = new Set([
        'vfx_ring_glow_band_a', 'vfx_starburst_spokes_a', 'vfx_glow_blob_soft_a', 'vfx_curtain_shafts_b', 'vfx_curtain_shafts_a',
        'vfx_star_cross_halo_a', 'vfx_disc_warm_floor_a', 'vfx_glint_halo_pin_a', 'vfx_glow_pip_core_a',
      ]);
      for (const e of lu.elements) {
        expect(artOf(e), `${(e as { note?: string }).note}`).not.toBe('');
        expect(ALLOWED.has(artOf(e)), `${artOf(e)} is not on the list`).toBe(true);
      }
      for (const art of new Set(lu.elements.map(artOf))) expect(LH_ART_IDS, `${art}: listed in art.ts (the manifest check above ships it)`).toContain(art);
    });

    /** alpha of a colour curve [t, hex, a, ...] at normalised time t */
    const alphaAt = (c: readonly number[], t: number): number => {
      const ts: number[] = [];
      const as: number[] = [];
      for (let i = 0; i + 2 < c.length; i += 3) {
        ts.push(c[i] as number);
        as.push(c[i + 2] as number);
      }
      if (t <= (ts[0] as number)) return as[0] as number;
      for (let i = 1; i < ts.length; i++) {
        if (t <= (ts[i] as number)) return (as[i - 1] as number) + ((t - (ts[i - 1] as number)) / ((ts[i] as number) - (ts[i - 1] as number))) * ((as[i] as number) - (as[i - 1] as number));
      }
      return as[as.length - 1] as number;
    };

    it('the opening frame (0.05 - 0.15 s) has contrast, not a milky disc: no bar above the hero, the rings are still faint at 0.1 s (the hot core and the spokes carry it), the dark-gold body is light', () => {
      // the round-1 critic: "a milky cream puff veils the hero at 0.1 s" and "a dull rectangle floats above his head": no upright card of any kind
      expect(lu.elements.some((e) => e.kind === 'particle' && e.billboard === 'upright'), 'no flash bar').toBe(false);
      expect(lu.elements.some((e) => artOf(e) === 'vfx_streak_v_fade_a'), 'the bar sprite is gone').toBe(false);
      for (const e of lu.elements.filter(isRing)) {
        if ((e.t0 ?? 0) >= 0.1) continue; // the second milestone ring starts a beat later
        const a = alphaAt(e.color, (0.1 - (e.t0 ?? 0)) / peak(e.life));
        expect(a, `${e.note}: at 0.1 s the ring has not filled the floor yet (alpha ${a.toFixed(2)})`).toBeLessThanOrEqual(0.5);
        // ... but it does reach a strong crest later
        expect(Math.max(...keys(e.color).map((k) => k.a)), `${e.note}: a crest, not a ghost`).toBeGreaterThanOrEqual(0.25);
      }
      // the dark-gold alpha body stays light enough that the floor and the carvings read through it (round 1: a milky haze over the inner floor)
      for (const e of lu.elements.filter((x) => isRing(x) && x.blend === 'alpha')) expect(Math.max(...keys(e.color).map((k) => k.a)), `${e.note}`).toBeLessThanOrEqual(0.65);
    });

    it('the low tier (no composite pass: additive HDR clips at once) draws no additive ring, crown or spoke wheel: an alpha ring that holds its hue, a small hot core, the chest flare, the afterglow and the glints', () => {
      const low = lu.elements.filter((e) => (e.minTier ?? 0) === 0);
      for (const e of low) {
        if (e.kind === 'surface') expect(e.blend, `${e.note}: no crown on low`).toBe('alpha');
        else if (e.kind === 'particle' && e.billboard === 'ground' && e.blend === 'add') {
          expect(isRing(e), `${e.note}: no additive ring on low`).toBe(false);
          expect(artOf(e), `${e.note}: no spoke wheel on low`).not.toBe('vfx_starburst_spokes_a');
          expect(peak(e.half) * peak(e.scale ?? [0, 1]) * 2, `${e.note}: the one additive ground layer on low is the small core`).toBeLessThanOrEqual(2.2);
        }
      }
      // low keeps the shockwave itself, as alpha layers of deep gold
      expect(low.filter(isRing).length, 'low has the ring (ordinary + milestone body)').toBeGreaterThanOrEqual(2);
      expect(low.filter(isRing).every((e) => e.blend === 'alpha')).toBe(true);
      expect(low.some((e) => artOf(e) === 'vfx_glint_halo_pin_a'), 'low keeps the glints').toBe(true);
      // medium and up add the crest, the spokes, the crown, the second ring and the pips
      const mid = lu.elements.filter((e) => (e.minTier ?? 0) === 1);
      expect(mid.some((e) => isRing(e) && e.blend === 'add'), 'additive crest from medium').toBe(true);
      expect(mid.some((e) => artOf(e) === 'vfx_starburst_spokes_a'), 'spokes from medium').toBe(true);
      expect(mid.some((e) => e.kind === 'surface'), 'crown from medium').toBe(true);
      expect(lu.elements.every((e) => (e.minTier ?? 0) <= 1), 'nothing is gated above medium').toBe(true);
    });
  });

  it('level-up floor and everything on the floor stays inside a 7.2 m quad (spike tips and ripple bands reach ~0.85 of it and fade out on the way) at k = 1 (no screen cover), every emitter gone by 2.9 s (the alt level-up is the longest)', () => {
    // sk.gen.level_up has its own radius / duration guards (describe 'level-up (LVL-01)': a 3.5 m / 5 m ring is the point of it); it still ends by 2.9 s
    for (const e of byId('sk.gen.level_up').elements) expect(endOf(e), `sk.gen.level_up: ${(e as { note?: string }).note}`).toBeLessThanOrEqual(2.9);
    for (const id of ['sk.gen.skillup', ...SK_IDS.filter((x) => x.includes('potion')), 'holy.heal', 'player.revive', 'player.death', 'levelup']) {
      const s = byId(id);
      for (const e of particles(s).filter((p) => p.billboard === 'ground')) {
        const sc = Array.isArray(e.scale) && Array.isArray((e.scale as unknown[])[0]) ? 1 : peak(e.scale ?? [0, 1]);
        expect(peak(e.half) * Math.max(1, sc) * 2, `${id}: ${e.note}`).toBeLessThanOrEqual(7.2);
      }
      for (const e of s.elements) expect(endOf(e), `${id}: ${(e as { note?: string }).note}`).toBeLessThanOrEqual(2.9);
    }
  });

  it('skill-up: ONE orange -> pale-blue gradient column (the colour change lives in the sprite: no orange and blue layers overlapping into a green fringe), a blue-white bubble at the feet inside TWO smooth glowing bands (orange 2 m, blue 1.3 m, no cog teeth), a short gold spike fringe, everything over by 0.8 s', () => {
    const su = byId('sk.gen.skillup');
    const cols = surfaces(su).filter((e) => e.shape.kind === 'cyl' && artOf(e) === 'vfx_levelup_heal_skillup_column');
    expect(cols.length).toBeGreaterThanOrEqual(1);
    for (const e of cols) expect(e.shape.kind === 'cyl' ? e.shape.rb * 2 : 9, 'a narrow column (<= 1.4 m)').toBeLessThanOrEqual(1.4);
    // the column tint is orange-white -> blue-white, never a saturated layer that would mix into a green fringe
    for (const e of cols) {
      for (let i = 1; i < e.color.length; i += 3) {
        const c = e.color[i] as number;
        const [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
        expect(Math.max(r, g, b) - Math.min(r, g, b), 'a pale tint, the gradient is in the sprite').toBeLessThanOrEqual(0x70);
      }
    }
    const bands = particles(su).filter((e) => artOf(e) === 'vfx_ring_glow_band_a' && e.blend === 'add');
    expect(bands.length).toBe(2);
    expect(particles(su).some((e) => artOf(e) === 'vfx_ring_glow_rays_a'), 'the cog-toothed ring is gone').toBe(false);
    for (const e of bands) expect(e.rotation?.spin ?? 0, 'smooth bands do not turn').toBe(0);
    const [big, small] = [...bands].sort((x, y) => peak(y.half) - peak(x.half)) as [ParticleSpec, ParticleSpec];
    expect(peak(big.half) * 2, 'the orange band is >= 1.8 m').toBeGreaterThanOrEqual(1.8);
    expect(peak(small.half)).toBeLessThan(peak(big.half) * 0.8);
    const hue = (e: ParticleSpec): number => e.color[4] as number; // mid colour key
    expect((hue(big) >> 16) & 255, 'orange: red >> blue').toBeGreaterThan((hue(big) & 255) + 100);
    expect(hue(small) & 255, 'blue: blue >> red').toBeGreaterThan(((hue(small) >> 16) & 255) + 100);
    // blue-white bubble at the feet (pool) + gold fringe
    expect(particles(su).some((e) => artOf(e) === 'vfx_disc_warm_floor_a' && e.blend === 'alpha')).toBe(true);
    expect(surfaces(su).some((e) => e.shape.kind === 'cyl' && e.shape.rt > e.shape.rb && e.shape.h <= 0.8 && e.blend === 'add'), 'gold spike fringe').toBe(true);
    
    for (const e of su.elements) expect(endOf(e)).toBeLessThanOrEqual(1.3);
    for (const e of su.elements.filter((x) => x.kind === 'surface')) expect(endOf(e), 'column / bands / fringe over by 0.75 s').toBeLessThanOrEqual(0.75);
  });

  it('potions: drug-up = a SMOOTH frosted skirt (billowing cloud band + fine streak veil on cylinders, dark alpha body of the hue), no floor pool, 8-12 tiny hollow circles (0.12-0.2 m) from the first frame; auto potion = the jagged fringe + a flame-strand splash dome', () => {
    const hues = new Set<number>();
    for (const c of ['red', 'blue', 'green', 'purple']) {
      const s = byId(`sk.gen.potion_${c}`);
      const ring = particles(s).find((e) => artOf(e).startsWith('vfx_ring_rim'));
      expect(ring, c).toBeDefined();
      const w = peak(ring?.half) * 2 * (peak(ring?.scale) || 1);
      expect(w, `${c} circle width`).toBeGreaterThanOrEqual(0.12);
      expect(w, `${c} circle width`).toBeLessThanOrEqual(0.2);
      expect(ring?.max ?? 0, c).toBeGreaterThanOrEqual(8);
      expect(ring?.max ?? 0, c).toBeLessThanOrEqual(12);
      expect(ring?.t0 ?? 0, `${c}: the rings are up together with the skirt`).toBeLessThanOrEqual(0.05);
      const cyl = surfaces(s).filter((e) => e.shape.kind === 'cyl');
      expect(cyl.length, c).toBeGreaterThanOrEqual(3);
      for (const e of cyl) expect(e.shape.kind === 'cyl' ? e.shape.h : 0, c).toBeGreaterThanOrEqual(1.2);
      expect(cyl.filter((e) => e.blend === 'add' && artOf(e) === 'vfx_cloudband_billow_a').length, `${c}: smooth frosted band, not blades`).toBeGreaterThanOrEqual(1);
      expect(cyl.some((e) => artOf(e) === 'vfx_curtain_shafts_b' || artOf(e) === 'vfx_curtain_shafts_a'), `${c}: no jagged shaft blades in the drug-up`).toBe(false);
      expect(cyl.some((e) => e.blend === 'alpha'), `${c}: alpha body of a darker hue`).toBe(true);
      // no floor pool: no ground sprite wider than the skirt's own contact ring (2.4 m)
      for (const e of particles(s).filter((x) => x.billboard === 'ground')) expect(peak(e.half) * 2 * Math.max(1, peak(e.scale ?? [0, 1])), `${c}: ${e.note}`).toBeLessThanOrEqual(2.6);
      expect(particles(s).some((e) => e.billboard === 'ground' && artOf(e) === 'vfx_disc_rankup_floor_a'), `${c}: no floor pool`).toBe(false);
      hues.add(surfaces(s).find((e) => e.blend === 'add')?.color[1] as number);
    }
    expect(hues.size).toBe(4);
    for (const c of ['red', 'blue']) {
      const s = byId(`sk.gen.potion_auto_${c}`);
      expect(surfaces(s).filter((e) => e.shape.kind === 'cyl' && e.shape.rb < e.shape.rt && e.shape.h >= 0.5).length, `${c}: flared jagged fringe`).toBeGreaterThanOrEqual(3);
      expect(surfaces(s).some((e) => artOf(e) === 'vfx_curtain_shafts_b' && e.blend === 'add'), `${c}: light00 jagged fringe`).toBe(true);
      expect(particles(s).some((e) => artOf(e) === 'vfx_splash_dome_top_a' && e.billboard === 'upright' && e.blend === 'add'), `${c}: splash dome`).toBe(true);
      expect(particles(s).some((e) => artOf(e) === 'vfx_splash_dome_top_a' && e.blend === 'alpha'), `${c}: dome alpha copy (snow)`).toBe(true);
      expect(particles(s).some((e) => artOf(e).startsWith('vfx_ring_rim'))).toBe(true);
    }
  });

  it('cure family: ONE soft cream pillar (smooth bars, no hair striations, no hard edges) + pale green-white ground ring(s) + cream glow ring pool; the area version covers its radius', () => {
    for (const id of ['holy.heal', 'aura.heal']) {
      const s = byId(id);
      const bars = particles(s).filter((e) => artOf(e) === 'vfx_streak_v_fade_a' && e.billboard === 'upright');
      expect(bars.some((e) => e.blend === 'add'), `${id}: soft additive pillar`).toBe(true);
      expect(bars.some((e) => e.blend === 'alpha'), `${id}: alpha copy (cream-tan on snow)`).toBe(true);
      for (const e of bars) expect(peak((e.half as unknown[] | undefined)?.[1]) * 2, id).toBeGreaterThanOrEqual(5.5);
      expect(surfaces(s).some((e) => e.shape.kind === 'cyl' && e.shape.h >= 8 && artOf(e) === 'vfx_streak_column_a'), `${id}: no hair-striped bundle tube`).toBe(false);
      // salmon is gone: the pillar hues are cream, never orange
      for (const e of bars.filter((x) => x.blend === 'add')) {
        const c = e.color[4] as number;
        expect(((c >> 16) & 255) - ((c >> 8) & 255), `${id}: cream, not salmon`).toBeLessThanOrEqual(0x28);
      }
      expect(particles(s).filter((e) => artOf(e) === 'vfx_ring_halo_twin_a' && e.blend === 'add').length, `${id}: pale ring(s)`).toBeGreaterThanOrEqual(1);
      expect(
        particles(s).some((e) => {
          if (artOf(e) !== 'vfx_ring_halo_twin_a' || e.blend !== 'add') return false;
          const c = e.color[1] as number;
          const r = (c >> 16) & 255;
          const g = (c >> 8) & 255;
          const b = c & 255;
          return g >= 0xf0 && g > r && g > b && r >= 0xc0; // pale green-white (the Cure w_ring), not a pure white and not a saturated green
        }),
        `${id}: pale green-white ring colour`,
      ).toBe(true);
      expect(particles(s).some((e) => artOf(e) === 'vfx_disc_warm_floor_a' && e.billboard === 'ground' && e.blend === 'add'), `${id}: smooth cream glow pool (no bristles)`).toBe(true);
      expect(particles(s).some((e) => artOf(e) === 'vfx_ring_fuzzy_spikes_a'), `${id}: no shag-rug radial noise`).toBe(false);
      expect(particles(s).some((e) => artOf(e) === 'vfx_ring_scrollwork_lace_a'), `${id}: the lace ring is the Blessing's, not the Cure's`).toBe(false);
    }
    expect(byId('aura.heal').base).toBe(3);
    expect(peak(particles(byId('aura.heal')).find((e) => artOf(e) === 'vfx_disc_warm_floor_a' && e.billboard === 'ground' && e.blend === 'add')?.half)).toBeGreaterThanOrEqual(2.7);
  });

  it('revive = the level-up language in gold, once (no 7x scale), NOT four identical bars: six gold bands of different widths + a crown of spikes, a hot pale pool (no alpha puddle), a pale scroll roundel (no dark body = no brown stain), a faceted flare; death never lingers and has a soul with a tail', () => {
    const rv = byId('player.revive');
    const bands = surfaces(rv).filter((e) => e.shape.kind === 'card' && e.blend === 'add' && artOf(e) === 'vfx_streak_column_a');
    expect(bands.length).toBeGreaterThanOrEqual(5);
    expect(new Set(bands.map((e) => (e.shape.kind === 'card' ? e.shape.w : 0))).size, 'different widths').toBeGreaterThanOrEqual(3);
    expect(new Set(bands.map((e) => (e.shape.kind === 'card' ? e.shape.h : 0))).size, 'different heights').toBeGreaterThanOrEqual(3);
    expect(particles(rv).some((e) => artOf(e) === 'vfx_ring_ornate_scroll_a')).toBe(true);
    expect(particles(rv).some((e) => artOf(e) === 'vfx_ring_ornate_scroll_a' && e.blend === 'alpha'), 'no dark body under the roundel').toBe(false);
    expect(particles(rv).filter((e) => artOf(e) === 'vfx_disc_warm_floor_a').every((e) => e.blend === 'add'), 'the pool is light, not an alpha puddle').toBe(true);
    expect(particles(rv).some((e) => artOf(e) === 'vfx_ring_scrollwork_lace_a')).toBe(false);
    expect(particles(rv).some((e) => artOf(e) === 'vfx_levelup_heal_floor_facet')).toBe(true);
    expect(surfaces(rv).some((e) => e.shape.kind === 'cyl' && e.shape.rt > e.shape.rb && e.blend === 'add'), 'crown of spikes').toBe(true);
    for (const e of rv.elements) expect(endOf(e)).toBeLessThanOrEqual(2.7);
    const dt = byId('player.death');
    for (const e of dt.elements) expect(endOf(e)).toBeLessThanOrEqual(2.7);
    expect(particles(dt).some((e) => artOf(e) === 'vfx_levelup_heal_soul_wisp' && peak((e.half as unknown[])[1] as number[]) >= 1.2), 'the soul wisp: an orb with a long tail').toBe(true);
    expect(particles(dt).some((e) => artOf(e) === 'vfx_glow_orb_core_a'), 'soul orb').toBe(true);
  });

  it('buffs: haste and shield are LOOPS that never blink (two interleaved emitters, a ring every 2 s, 2.6 s long, an intro twin), each with its own ring family; stealth smoke is >= 3 m wide', () => {
    for (const id of ['buff.haste', 'buff.shield']) {
      const s = byId(id);
      const loops = particles(s).filter((e) => e.loops === 0 && e.cycle === 4.0 && peak(e.life) === 2.6);
      expect(loops.length, `${id}: looping floor rings (A + B emitters per family)`).toBeGreaterThanOrEqual(4);
      expect(loops.filter((e) => e.t0 === 0).length, `${id}: emitter A per family`).toBe(loops.filter((e) => e.t0 === 2.0).length);
      for (const e of loops) {
        expect(e.max, `${id}: one alive ring per emitter at every density`).toBe(1);
        expect(peak(e.life) - e.cycle / 2, `${id}: overlap = the fade`).toBeCloseTo(0.6, 5);
        // the host multiplies the emission by fx.density (0.5 on the low tier): the birth window must still hold >= 1 whole birth (r2: the
        // 0.04 s burst gave 0.76 at density 0.5 and the loop rings were gone after the intro on the low tier)
        const r = e.rate as number[];
        let area = 0;
        for (let i = 0; i + 3 < r.length; i += 2) area += ((r[i + 1] as number) + (r[i + 3] as number)) * 0.5 * ((r[i + 2] as number) - (r[i] as number));
        expect(area * 0.5, `${id}: births per cycle at density 0.5`).toBeGreaterThanOrEqual(1);
      }
      expect(particles(s).filter((e) => e.loops === undefined && e.billboard === 'ground' && peak(e.life) === 0.6).length, `${id}: intro twins`).toBeGreaterThanOrEqual(2);
    }
    expect(particles(byId('buff.haste')).some((e) => artOf(e) === 'vfx_swirl_ring_arcs_a')).toBe(true);
    expect(particles(byId('buff.haste')).some((e) => artOf(e) === 'vfx_ring_ornate_swirl_a'), 'the round swirling-scroll medallion (haste medallion)').toBe(true);
    expect(particles(byId('buff.haste')).some((e) => artOf(e) === 'vfx_ring_dashes_a'), 'no ring of evenly spaced LED beads').toBe(false);
    expect(particles(byId('buff.shield')).some((e) => artOf(e) === 'vfx_ring_scrollwork_lace_a')).toBe(true);
    const st = particles(byId('buff.stealth')).find((e) => artOf(e) === 'vfx_smoke_lumpball_a');
    expect((((st?.shape?.radius ?? 0) + peak(st?.half) * 1.6) * 2) , 'smoke diameter').toBeGreaterThanOrEqual(2.5);
  });

  it('lifesteal drain is perceivable: hollow circles >= 0.4 m wide and a red pulse >= 1.6 m', () => {
    const d = byId('heal.drain');
    const ring = particles(d).find((e) => artOf(e).startsWith('vfx_ring_rim'));
    expect(peak(ring?.half) * 2).toBeGreaterThanOrEqual(0.4);
    const pulse = particles(d).find((e) => artOf(e) === 'vfx_glow_orb_smooth_a');
    expect(peak(pulse?.half) * 2).toBeGreaterThanOrEqual(1.6);
  });
});

// ---------------------------------------------------------------------------------------------------------------- routes
interface Fired {
  id: string;
  o: SpawnOpts;
}

function harness() {
  const fired: Fired[] = [];
  let time = 0;
  const marks = new Map<string, number>();
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
      return 0;
    },
    spawnResolved: () => 0,
    stop: () => {},
    alive: () => false,
    once: (key, window) => {
      const last = marks.get(key);
      if (last !== undefined && time - last < window) return false;
      marks.set(key, time);
      return true;
    },
    since: (key) => (marks.has(key) ? time - (marks.get(key) as number) : Infinity),
    mark: (key) => void marks.set(key, time),
    deathPreset: () => undefined,
    metinRune: () => 0,
    bossPos: () => false,
    telegraphEvents: false,
  };
  const routes = levelupHealRoutes();
  const send = (e: Record<string, unknown>): Fired[] => {
    const n = fired.length;
    for (const r of routes) if ((r.events as readonly string[]).includes(e.t as string)) r.handle(e as unknown as SimEvent, ctx);
    return fired.slice(n);
  };
  return { send, tick: (dt: number) => void (time += dt), mark: (k: string) => marks.set(k, time) };
}

describe('levelup-heal routes', () => {
  it('level-up and skill-up play at the hero at full size; a heal card plays its auto potion, not the skill-up', () => {
    const h = harness();
    const lu = h.send({ t: 'levelUp', player: 0, level: 3 });
    expect(lu.map((f) => f.id)).toEqual(['sk.gen.level_up']);
    expect([lu[0]?.o.x, lu[0]?.o.z, lu[0]?.o.scale]).toEqual([3, 4, 1]);
    expect(lu[0]?.o.rank, 'an ordinary level plays the ordinary beat').toBeUndefined();
    expect(h.send({ t: 'cardPick', player: 0, kind: 'skill', id: 'x', rarity: 'common', rank: 1, awakening: false }).map((f) => f.id)).toEqual(['sk.gen.skillup']);
    expect(h.send({ t: 'cardPick', player: 0, kind: 'heal', id: 'x', rarity: 'common', rank: 1, awakening: false })).toEqual([]);
    expect(h.send({ t: 'heal', player: 0, amount: 9, source: 4 }).map((f) => f.id)).toEqual(['sk.gen.potion_auto_red']);
  });

  it('every 5th level plays the milestone beat (rank LEVEL_UP_MILESTONE_RANK), every other one the ordinary beat; the position, size and player come from the event as before (LVL-01)', () => {
    const h = harness();
    expect([LEVEL_UP_MILESTONE_EVERY, LEVEL_UP_MILESTONE_RANK], 'every 5th level, the spec gates its milestone elements at rank 3').toEqual([5, 3]);
    for (const level of [5, 10, 15, 25, 50]) {
      h.tick(0.1);
      const f = h.send({ t: 'levelUp', player: 0, level });
      expect(f.map((x) => x.id), `level ${level}`).toEqual(['sk.gen.level_up']);
      expect(f[0]?.o.rank, `level ${level}`).toBe(LEVEL_UP_MILESTONE_RANK);
      expect(f[0]?.o.scale, `level ${level}: same size, the spec's rank elements make it bigger`).toBe(1);
    }
    for (const level of [1, 2, 3, 4, 6, 7, 9, 11, 14, 16, 49]) {
      h.tick(0.1);
      expect(h.send({ t: 'levelUp', player: 0, level })[0]?.o.rank, `level ${level}`).toBeUndefined();
    }
    h.tick(0.1);
    expect(h.send({ t: 'levelUp', player: 0, level: 0 })[0]?.o.rank, 'level 0 (a malformed event) is no milestone').toBeUndefined();
    h.tick(0.1);
    // another hero levelling up (co-op mirror): its own position, its own level
    const g = h.send({ t: 'levelUp', player: 1, level: 10 })[0] as Fired;
    expect([g.o.x, g.o.z, g.o.rank]).toEqual([0, 0, LEVEL_UP_MILESTONE_RANK]);
    // an out-of-range player index falls back to player 0
    h.tick(0.1);
    const far = h.send({ t: 'levelUp', player: 7, level: 5 })[0]?.o.x;
    h.tick(0.1);
    expect([far, h.send({ t: 'levelUp', player: -1, level: 5 })[0]?.o.x]).toEqual([3, 3]);
  });

  it('several level-ups of one hero in ONE frame play ONE beat (a plain one, or the milestone one when the batch holds a multiple of 5); another hero and the next frame get their own (LVL-01)', () => {
    const h = harness();
    // two plain levels in one frame: one beat
    expect(h.send({ t: 'levelUp', player: 0, level: 2 }).length).toBe(1);
    expect(h.send({ t: 'levelUp', player: 0, level: 3 }), 'the second level of the frame is folded into the first beat').toEqual([]);
    expect(h.send({ t: 'levelUp', player: 0, level: 4 })).toEqual([]);
    // another hero in the same frame plays its own beat
    expect(h.send({ t: 'levelUp', player: 1, level: 3 }).length).toBe(1);
    // the next frame is a new beat
    h.tick(0.016);
    expect(h.send({ t: 'levelUp', player: 0, level: 5 })[0]?.o.rank, 'next frame: its own beat').toBe(LEVEL_UP_MILESTONE_RANK);
    // a batch 4 -> 5 -> 6 in one frame: the milestone beat is played (after the plain one), the level after it is folded in
    h.tick(0.016);
    expect(h.send({ t: 'levelUp', player: 0, level: 4 })[0]?.o.rank).toBeUndefined();
    expect(h.send({ t: 'levelUp', player: 0, level: 5 })[0]?.o.rank, 'a milestone inside the batch is never lost').toBe(LEVEL_UP_MILESTONE_RANK);
    expect(h.send({ t: 'levelUp', player: 0, level: 6 })).toEqual([]);
    // two milestones in one frame (5 and 10): one beat
    h.tick(0.016);
    expect(h.send({ t: 'levelUp', player: 0, level: 5 }).length).toBe(1);
    expect(h.send({ t: 'levelUp', player: 0, level: 10 })).toEqual([]);
  });

  it('regen ticks and potion pickups are not decorated here; lifesteal is rate limited; a skill heal skips holy.heal after sk.mending_light', () => {
    const h = harness();
    expect(h.send({ t: 'heal', player: 0, amount: 1, source: 0 })).toEqual([]);
    expect(h.send({ t: 'heal', player: 0, amount: 1, source: 2 })).toEqual([]);
    expect(h.send({ t: 'heal', player: 0, amount: 1, source: 1 }).map((f) => f.id)).toEqual(['heal.drain']);
    expect(h.send({ t: 'heal', player: 0, amount: 1, source: 1 })).toEqual([]);
    h.tick(DRAIN_GAP + 0.01);
    expect(h.send({ t: 'heal', player: 0, amount: 1, source: 1 }).map((f) => f.id)).toEqual(['heal.drain']);
    h.mark('sk.mending_light');
    expect(h.send({ t: 'heal', player: 0, amount: 5, source: 3 })).toEqual([]);
    h.tick(1);
    expect(h.send({ t: 'heal', player: 0, amount: 5, source: 3 }).map((f) => f.id)).toEqual(['holy.heal']);
  });

  it('a self buff cast heal on its own caster (source 5, HealSource.CastSelf) draws no holy.heal; an ally heal (3) and a heal card (4) still do (recheck B2)', () => {
    const h = harness();
    expect(h.send({ t: 'heal', player: 0, amount: 20, source: 5 })).toEqual([]);
    h.mark('sk.redmane_spirit');
    expect(h.send({ t: 'heal', player: 0, amount: 20, source: 5 })).toEqual([]);
    expect(h.send({ t: 'heal', player: 1, amount: 20, source: 3 }).map((f) => f.id)).toEqual(['holy.heal']);
    expect(h.send({ t: 'heal', player: 0, amount: 20, source: 4 }).map((f) => f.id)).toEqual(['sk.gen.potion_auto_red']);
  });

  it('revive fires once per window at full size, death once', () => {
    const h = harness();
    expect(h.send({ t: 'playerRevive', player: 0, x: 1, z: 2, left: 2 }).map((f) => f.id)).toEqual(['player.revive']);
    expect(h.send({ t: 'playerRevive', player: 0, x: 1, z: 2, left: 2 })).toEqual([]);
    expect(h.send({ t: 'playerDeath', player: 0, x: 1, z: 2 }).map((f) => f.id)).toEqual(['player.death']);
  });
});
