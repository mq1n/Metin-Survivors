import { Color, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import type { RenderCore } from '../core';
import { TG_CIRCLE, TG_CONE, TG_LINE, TG_RING, type TelegraphFeed } from '../feed';
import { QUALITY_PROFILES } from '../quality';
import {
  DECAL_MARGIN,
  DecalSlots,
  NOISE_SIZE,
  SLOT_FADING,
  SLOT_FREE,
  SLOT_LIVE,
  Telegraphs,
  crowdCalm,
  decalWorld,
  makeNoiseData,
  selectClosest,
  telegraphRect,
  telegraphSignedDist,
  upsampleLattice,
} from './telegraphs';

describe('telegraphRect', () => {
  const r = new Float32Array(4);
  it('circle / ring: square around the radius plus margin', () => {
    telegraphRect(TG_CIRCLE, 5, 0, 0, r);
    expect(r[0]).toBeCloseTo(-5 - DECAL_MARGIN, 5);
    expect(r[1]).toBeCloseTo(5 + DECAL_MARGIN, 5);
    expect(r[2]).toBeCloseTo(-5 - DECAL_MARGIN, 5);
    expect(r[3]).toBeCloseTo(5 + DECAL_MARGIN, 5);
    telegraphRect(TG_RING, 8, 3, 0, r);
    expect(r[1]).toBeCloseTo(8 + DECAL_MARGIN, 5);
  });
  it('line: width across, length forward from the origin', () => {
    telegraphRect(TG_LINE, 0, 20, 4, r);
    expect(r[0]).toBeCloseTo(-2 - DECAL_MARGIN, 5);
    expect(r[1]).toBeCloseTo(2 + DECAL_MARGIN, 5);
    expect(r[2]).toBeCloseTo(-DECAL_MARGIN, 5);
    expect(r[3]).toBeCloseTo(20 + DECAL_MARGIN, 5);
  });
  it('cone: narrow cones only need the forward strip, wide ones the full disc side', () => {
    telegraphRect(TG_CONE, 10, 0, Math.PI / 3, r);
    expect(r[1]).toBeCloseTo(10 * Math.sin(Math.PI / 6) + DECAL_MARGIN, 5);
    expect(r[2]).toBeCloseTo(-DECAL_MARGIN, 5);
    expect(r[3]).toBeCloseTo(10 + DECAL_MARGIN, 5);
    telegraphRect(TG_CONE, 10, 0, Math.PI * 1.5, r); // half angle 135° → reaches behind the origin
    expect(r[1]).toBeCloseTo(10 + DECAL_MARGIN, 5);
    expect(r[2]).toBeCloseTo(10 * Math.cos((Math.PI * 1.5) / 2) - DECAL_MARGIN, 5);
  });
});

describe('upsampleLattice', () => {
  it('reproduces a linear height field exactly and adds the lift', () => {
    const nx = 5;
    const nz = 9;
    const G = 24;
    const field = (u: number, v: number): number => 2 + 3 * u - 1.5 * v; // u,v in [0,1]
    const lat = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) lat[j * (nx + 1) + i] = field(i / nx, j / nz);
    const out = new Float32Array((G + 1) * (G + 1) + 7);
    upsampleLattice(lat, nx, nz, G, out, 7, 0.1);
    for (let j = 0; j <= G; j++) {
      for (let k = 0; k <= G; k++) expect(out[7 + j * (G + 1) + k]).toBeCloseTo(field(k / G, j / G) + 0.1, 4);
    }
  });
  it('keeps corner samples exact for a non-linear field', () => {
    const nx = 4;
    const nz = 4;
    const G = 24;
    const lat = Float32Array.from({ length: 25 }, (_, i) => Math.sin(i * 1.3) * 2);
    const out = new Float32Array((G + 1) * (G + 1));
    upsampleLattice(lat, nx, nz, G, out, 0, 0);
    expect(out[0]).toBeCloseTo(lat[0] as number, 5);
    expect(out[G]).toBeCloseTo(lat[nx] as number, 5);
    expect(out[G * (G + 1)]).toBeCloseTo(lat[nz * (nx + 1)] as number, 5);
    expect(out[(G + 1) * (G + 1) - 1]).toBeCloseTo(lat[24] as number, 5);
  });
});

describe('makeNoiseData', () => {
  it('is deterministic, full-range, and tiles seamlessly', () => {
    const a = makeNoiseData();
    const b = makeNoiseData();
    expect(Array.from(a.slice(0, 64))).toEqual(Array.from(b.slice(0, 64)));
    expect(a.length).toBe(NOISE_SIZE * NOISE_SIZE);
    let min = 255;
    let max = 0;
    let sum = 0;
    for (const v of a) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    expect(max - min).toBeGreaterThan(120);
    expect(sum / a.length).toBeGreaterThan(110);
    expect(sum / a.length).toBeLessThan(146);
    // neighbouring texels across the wrap edge are as close as ordinary neighbours
    let wrapStep = 0;
    let innerStep = 0;
    for (let y = 0; y < NOISE_SIZE; y++) {
      wrapStep += Math.abs((a[y * NOISE_SIZE] as number) - (a[y * NOISE_SIZE + NOISE_SIZE - 1] as number));
      innerStep += Math.abs((a[y * NOISE_SIZE + 1] as number) - (a[y * NOISE_SIZE] as number));
    }
    expect(wrapStep).toBeLessThan(innerStep * 2 + 40);
  });
});

describe('decalWorld', () => {
  const o = { x: 0, z: 0 };
  it('rot 0 faces +Z and right is +X', () => {
    decalWorld(10, 20, 0, 0, 5, o);
    expect(o.x).toBeCloseTo(10, 6);
    expect(o.z).toBeCloseTo(25, 6);
    decalWorld(10, 20, 0, 3, 0, o);
    expect(o.x).toBeCloseTo(13, 6);
    expect(o.z).toBeCloseTo(20, 6);
  });
  it('yaw π/2 turns forward toward +X (rotation about +Y)', () => {
    decalWorld(0, 0, Math.PI / 2, 0, 4, o);
    expect(o.x).toBeCloseTo(4, 6);
    expect(o.z).toBeCloseTo(0, 6);
    decalWorld(0, 0, Math.PI / 2, 2, 0, o);
    expect(o.x).toBeCloseTo(0, 6);
    expect(o.z).toBeCloseTo(-2, 6);
  });
});

describe('selectClosest', () => {
  it('keeps the nearest cap entries, nearest first, ids stay paired with distances', () => {
    const d2 = Float32Array.from([9, 1, 4, 16, 0.5]);
    const idx = Int32Array.from([10, 11, 12, 13, 14]);
    const k = selectClosest(d2, idx, 5, 3);
    expect(k).toBe(3);
    expect(Array.from(idx.slice(0, 3))).toEqual([14, 11, 12]);
    expect(Array.from(d2.slice(0, 3))).toEqual([0.5, 1, 4]);
  });
  it('returns n when below the cap and handles empty input', () => {
    const d2 = Float32Array.from([2, 1]);
    const idx = Int32Array.from([0, 1]);
    expect(selectClosest(d2, idx, 2, 10)).toBe(2);
    expect(selectClosest(d2, idx, 0, 10)).toBe(0);
  });
});

describe('DecalSlots', () => {
  function frame(s: DecalSlots, items: Array<[number, number, number, number, number, number, number]>, dt = 1 / 60): number[] {
    s.begin();
    const out = items.map(([kind, owner, x, z, r, len, prog]) => s.claim(kind, owner, x, z, 0, r, len, 0, prog));
    s.end(dt);
    return out;
  }

  it('keeps the same slot for the same decal across frames and only flags real moves', () => {
    const s = new DecalSlots(8);
    const a = frame(s, [[TG_CIRCLE, 0, 5, 5, 3, 0, 0.1]]);
    expect(a).toEqual([0]);
    expect(s.dirty[0]).toBe(2); // fresh
    s.dirty[0] = 0;
    s.hx[0] = 5;
    s.hz[0] = 5;
    s.hr1[0] = 3;
    const b = frame(s, [[TG_CIRCLE, 0, 5.05, 5, 3, 0, 0.2]]);
    expect(b).toEqual([0]);
    expect(s.dirty[0]).toBe(0);
    const c = frame(s, [[TG_CIRCLE, 0, 5.9, 5, 3, 0, 0.3]]);
    expect(c).toEqual([0]);
    expect(s.dirty[0]).toBe(1);
  });

  it('separates identical decals by position and keeps their identity when feed order changes', () => {
    const s = new DecalSlots(8);
    const a = frame(s, [
      [TG_CIRCLE, 1, 0, 0, 4, 0, 0.1],
      [TG_CIRCLE, 1, 20, 0, 4, 0, 0.5],
    ]);
    expect(a).toEqual([0, 1]);
    const b = frame(s, [
      [TG_CIRCLE, 1, 20, 0, 4, 0, 0.55],
      [TG_CIRCLE, 1, 0, 0, 4, 0, 0.15],
    ]);
    expect(b).toEqual([1, 0]);
  });

  it('does not match a different shape / owner / size', () => {
    const s = new DecalSlots(8);
    frame(s, [[TG_CIRCLE, 0, 0, 0, 4, 0, 0.2]]);
    const b = frame(s, [
      [TG_CONE, 0, 0, 0, 4, 0, 0.3],
      [TG_CIRCLE, 1, 0, 0, 4, 0, 0.3],
      [TG_CIRCLE, 0, 0, 0, 7, 0, 0.3],
    ]);
    expect(new Set(b).size).toBe(3);
    expect(b).not.toContain(0);
  });

  it('a restarted decal (progress drops) is a new decal; the old one fades out', () => {
    const s = new DecalSlots(8);
    frame(s, [[TG_CIRCLE, 1, 0, 0, 4, 0, 0.97]]);
    const b = frame(s, [[TG_CIRCLE, 1, 0, 0, 4, 0, 0.02]]);
    expect(b).toEqual([1]);
    expect(s.state[0]).toBe(SLOT_FADING);
    expect(s.state[1]).toBe(SLOT_LIVE);
    expect(s.prog[0]).toBe(1);
  });

  it('fades vanished decals and frees them afterwards', () => {
    const s = new DecalSlots(4, { fadeOut: 0.2 });
    frame(s, [[TG_LINE, 0, 0, 0, 0, 12, 0.9]]);
    frame(s, []);
    expect(s.state[0]).toBe(SLOT_FADING);
    expect(s.alphaOf(0)).toBeCloseTo(1, 1);
    for (let i = 0; i < 8; i++) frame(s, [], 0.03);
    expect(s.state[0]).toBe(SLOT_FREE);
    expect(s.high).toBe(0);
    expect(s.liveCount).toBe(0);
  });

  it('fade-in ramps alpha from 0 to 1', () => {
    const s = new DecalSlots(4, { fadeIn: 0.1 });
    frame(s, [[TG_CIRCLE, 0, 0, 0, 2, 0, 0.01]], 0);
    expect(s.alphaOf(0)).toBe(0);
    frame(s, [[TG_CIRCLE, 0, 0, 0, 2, 0, 0.02]], 0.05);
    const mid = s.alphaOf(0);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    frame(s, [[TG_CIRCLE, 0, 0, 0, 2, 0, 0.03]], 0.1);
    expect(s.alphaOf(0)).toBe(1);
  });

  it('reuses free slots lowest-first, steals the oldest fading slot when full, refuses when all are live', () => {
    const s = new DecalSlots(3);
    const a = frame(s, [
      [TG_CIRCLE, 0, 0, 0, 1, 0, 0.1],
      [TG_CIRCLE, 0, 10, 0, 1, 0, 0.1],
      [TG_CIRCLE, 0, 20, 0, 1, 0, 0.1],
    ]);
    expect(a).toEqual([0, 1, 2]);
    // two vanish, one new appears far away: takes a fading slot
    const b = frame(s, [[TG_CIRCLE, 0, 20, 0, 1, 0, 0.2], [TG_CIRCLE, 0, 40, 0, 1, 0, 0.05]]);
    expect(b[0]).toBe(2);
    expect([0, 1]).toContain(b[1]);
    // all live and full → no slot
    const s2 = new DecalSlots(2);
    const c = frame(s2, [
      [TG_CIRCLE, 0, 0, 0, 1, 0, 0.1],
      [TG_CIRCLE, 0, 10, 0, 1, 0, 0.1],
      [TG_CIRCLE, 0, 20, 0, 1, 0, 0.1],
    ]);
    expect(c).toEqual([0, 1, -1]);
  });

  it('high-water mark tracks the highest used slot', () => {
    const s = new DecalSlots(6, { fadeOut: 0.05 });
    frame(s, [
      [TG_CIRCLE, 0, 0, 0, 1, 0, 0.1],
      [TG_CIRCLE, 0, 10, 0, 1, 0, 0.1],
      [TG_CIRCLE, 0, 20, 0, 1, 0, 0.1],
    ]);
    expect(s.high).toBe(3);
    frame(s, [[TG_CIRCLE, 0, 0, 0, 1, 0, 0.2]], 0.1);
    frame(s, [[TG_CIRCLE, 0, 0, 0, 1, 0, 0.3]], 0.1);
    expect(s.high).toBe(1);
  });
});

describe('crowdCalm', () => {
  it('leaves a handful of windups alone, calms a horde, never below 0.4', () => {
    expect(crowdCalm(0)).toBe(1);
    expect(crowdCalm(5)).toBe(1);
    expect(crowdCalm(10)).toBeCloseTo(0.7, 5);
    expect(crowdCalm(12)).toBeCloseTo(0.58, 5);
    expect(crowdCalm(40)).toBe(0.4);
    for (let n = 1; n < 40; n++) expect(crowdCalm(n)).toBeLessThanOrEqual(crowdCalm(n - 1));
  });
});

describe('Telegraphs hero-coverage & boss priority selection (RENDER-07)', () => {
  it('computes exact signed distance to circle, ring/annulus, line/rect, and cone/arc boundaries', () => {
    // Circle radius 4 at origin
    expect(telegraphSignedDist(TG_CIRCLE, 0, 0, 0, 4, 0, 0, 1, 0)).toBeCloseTo(-3, 5);
    expect(telegraphSignedDist(TG_CIRCLE, 0, 0, 0, 4, 0, 0, 6, 0)).toBeCloseTo(2, 5);

    // Boss ring: outer 10, inner 4, centered at (6, 0) -> hero at (0, 0) is at r=6, inside [4, 10] annulus (d = -2)
    expect(telegraphSignedDist(TG_RING, 6, 0, 0, 10, 4, 0, 0, 0)).toBeCloseTo(-2, 5);
    // Hero at ring center (6, 0) is inside the safe eye (d = +4)
    expect(telegraphSignedDist(TG_RING, 6, 0, 0, 10, 4, 0, 6, 0)).toBeCloseTo(4, 5);
    // Hero outside outer radius at (-6, 0): r=12 -> d = +2
    expect(telegraphSignedDist(TG_RING, 6, 0, 0, 10, 4, 0, -6, 0)).toBeCloseTo(2, 5);

    // Line: length 12, width 4, origin (0, 0), rot 0 (+Z)
    expect(telegraphSignedDist(TG_LINE, 0, 0, 0, 0, 12, 4, 0, 6)).toBeCloseTo(-2, 5);
    expect(telegraphSignedDist(TG_LINE, 0, 0, 0, 0, 12, 4, 4, 6)).toBeCloseTo(2, 5);

    // Cone: radius 8, full angle PI/2, origin (0, 0), rot 0 (+Z)
    expect(telegraphSignedDist(TG_CONE, 0, 0, 0, 8, 0, Math.PI / 2, 0, 4)).toBeLessThan(0);
    expect(telegraphSignedDist(TG_CONE, 0, 0, 0, 8, 0, Math.PI / 2, 0, -2)).toBeCloseTo(2, 5);
  });

  it('retains a shipped-size boss ring covering the hero over 24 ordinary circles centered on the hero at low quality (cap 24)', () => {
    const core = {
      scene: new Scene(),
      clock: { time: 1, dt: 1 / 60, frame: 1 },
      quality: { tier: 'low', profile: QUALITY_PROFILES.low, onChange: () => () => undefined },
      rig: { focus: { x: 0, z: 0 }, isVisible: () => true },
      env: { hemi: { groundColor: new Color(0.3, 0.3, 0.3) } },
      heightAt: () => 0,
    } as unknown as RenderCore;

    const tg = new Telegraphs(core);
    const n = 25;
    const shape = new Uint8Array(n);
    const owner = new Uint8Array(n);
    const x = new Float32Array(n);
    const z = new Float32Array(n);
    const rot = new Float32Array(n);
    const radius = new Float32Array(n);
    const length = new Float32Array(n);
    const width = new Float32Array(n);
    const progress = new Float32Array(n);

    // 24 ordinary circle warnings centered right on top of the hero (0, 0).
    for (let i = 0; i < 24; i++) {
      shape[i] = TG_CIRCLE;
      owner[i] = 0;
      x[i] = 0;
      z[i] = 0;
      radius[i] = 2.5;
      progress[i] = 0.4;
    }
    // 1 shipped-size boss ring (outer radius 10, inner safe radius 4) centered 6m away covering the hero!
    shape[24] = TG_RING;
    owner[24] = 1;
    x[24] = 6;
    z[24] = 0;
    radius[24] = 10;
    length[24] = 4;
    progress[24] = 0.2;

    tg.feed = { count: n, shape, owner, x, z, rot, radius, length, width, progress } as TelegraphFeed;
    tg.update(1 / 60, 0);

    expect(tg.stats.entries).toBe(25);
    expect(tg.stats.drawn).toBe(24);

    const slots = (tg as unknown as { grid: { slots: DecalSlots } }).grid.slots;
    let foundBossRing = false;
    for (let s = 0; s < slots.high; s++) {
      if (slots.state[s] === SLOT_LIVE && slots.sub[s] === 1 && slots.kind[s] === TG_RING && slots.r1[s] === 10 && slots.r2[s] === 4) {
        foundBossRing = true;
      }
    }
    expect(foundBossRing).toBe(true);
    tg.dispose();
  });

  it('prioritizes soonest resolve time and reserves capacity for visible boss telegraphs even when not covering the hero', () => {
    const core = {
      scene: new Scene(),
      clock: { time: 1, dt: 1 / 60, frame: 1 },
      quality: { tier: 'low', profile: QUALITY_PROFILES.low, onChange: () => () => undefined },
      rig: { focus: { x: 0, z: 0 }, isVisible: () => true },
      env: { hemi: { groundColor: new Color(0.3, 0.3, 0.3) } },
      heightAt: () => 0,
    } as unknown as RenderCore;

    const tg = new Telegraphs(core);
    const n = 26;
    const shape = new Uint8Array(n);
    const owner = new Uint8Array(n);
    const x = new Float32Array(n);
    const z = new Float32Array(n);
    const rot = new Float32Array(n);
    const radius = new Float32Array(n);
    const length = new Float32Array(n);
    const width = new Float32Array(n);
    const progress = new Float32Array(n);
    const dur = new Float32Array(n);

    // 25 ordinary circles covering the hero: index 24 resolves soonest (0.1s left), index 0 resolves latest (5s left).
    for (let i = 0; i < 25; i++) {
      shape[i] = TG_CIRCLE;
      owner[i] = 0;
      x[i] = 0;
      z[i] = 0;
      radius[i] = 2 + i * 0.05;
      progress[i] = 0.5;
      dur[i] = i === 0 ? 10 : i === 24 ? 0.2 : 2;
    }
    // 1 boss circle 12m away (not covering the hero, radius 3) must still get a reserved boss slot!
    shape[25] = TG_CIRCLE;
    owner[25] = 1;
    x[25] = 12;
    z[25] = 0;
    radius[25] = 3;
    progress[25] = 0.1;
    dur[25] = 2;

    tg.feed = { count: n, shape, owner, x, z, rot, radius, length, width, progress, dur } as unknown as TelegraphFeed;
    tg.update(1 / 60, 0);

    const slots = (tg as unknown as { grid: { slots: DecalSlots } }).grid.slots;
    let hasBoss = false;
    let hasSoonest = false;
    let hasLatest = false;
    for (let s = 0; s < slots.high; s++) {
      if (slots.state[s] !== SLOT_LIVE) continue;
      if (slots.sub[s] === 1) hasBoss = true;
      if (slots.sub[s] === 0 && Math.abs((slots.r1[s] as number) - (2 + 24 * 0.05)) < 1e-3) hasSoonest = true;
      if (slots.sub[s] === 0 && Math.abs((slots.r1[s] as number) - 2) < 1e-3) hasLatest = true;
    }
    expect(hasBoss).toBe(true);
    expect(hasSoonest).toBe(true);
    expect(hasLatest).toBe(false);
    tg.dispose();
  });
});
