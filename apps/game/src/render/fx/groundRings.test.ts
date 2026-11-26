import {
  Color,
  InstancedBufferGeometry,
  type InterleavedBufferAttribute,
  KeepStencilOp,
  type Mesh,
  NotEqualStencilFunc,
  Scene,
  type ShaderMaterial,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { RenderCore } from '../core';
import { TG_CIRCLE, TG_CONE, TG_LINE, TG_RING } from '../feed';
import {
  BEACON_ALLY_HEX,
  BEACON_ALPHA,
  BEACON_ARM,
  BEACON_COLORS,
  BEACON_DROP,
  BEACON_FADE,
  BEACON_HOLD,
  BEACON_JUMP,
  BEACON_MAX,
  BEACON_NEAR,
  BEACON_OFF,
  BEACON_ON,
  BEACON_WORLD_OFF,
  BEACON_WORLD_ON,
  GroundRings,
  RING_DEFAULT_COLOR,
  RING_KIND_INDEX,
  SMALL_RADIUS,
  beaconAlpha,
  beaconThin,
  creatureRows,
  crowdAround,
  fitGroundPlane,
  newBeaconState,
  stepBeacon,
  telegraphCover,
  writeBeaconInstances,
  type BeaconState,
  type CoverFeed,
  type CrowdFeed,
} from './groundRings';

describe('fitGroundPlane', () => {
  const out = new Float32Array(4);

  it('is exact and lifts only by the base amount on a tilted plane', () => {
    const plane = (x: number, z: number): number => 2 + 0.3 * x - 0.15 * z;
    fitGroundPlane(plane, 10, 20, 1.5, out, 0);
    expect(out[0]).toBeCloseTo(plane(10, 20), 5);
    expect(out[1]).toBeCloseTo(0.3, 5);
    expect(out[2]).toBeCloseTo(-0.15, 5);
    expect(out[3]).toBeCloseTo(0.045, 5);
  });

  it('keeps the ring above a convex hill (lift covers the curvature residual)', () => {
    const hill = (x: number, z: number): number => 3 * Math.cos(x * 0.25) * Math.cos(z * 0.25);
    const r = 2.4;
    for (const [cx, cz] of [
      [0, 0],
      [3, 1],
      [-6, 5],
    ] as const) {
      fitGroundPlane(hill, cx, cz, r, out, 0);
      for (const [dx, dz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ] as const) {
        const planeY = out[0]! + out[1]! * dx + out[2]! * dz + out[3]!;
        expect(planeY).toBeGreaterThanOrEqual(hill(cx + dx, cz + dz) - 1e-4);
      }
    }
  });

  it('writes at the requested offset and never reads out of range for tiny rings', () => {
    const buf = new Float32Array(12);
    fitGroundPlane(() => 1.25, 0, 0, 0.01, buf, 4);
    expect(buf[4]).toBe(1.25);
    expect(buf[5]).toBe(0);
    expect(buf[6]).toBe(0);
    expect(buf[0]).toBe(0);
  });
});

describe('ring kinds', () => {
  it('has a unique index per kind and a sane small-ring threshold', () => {
    const idx = Object.values(RING_KIND_INDEX);
    expect(new Set(idx).size).toBe(idx.length);
    expect(SMALL_RADIUS).toBeGreaterThan(1.5);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// FEEL-01: hero beacon

/** a crowd feed with `n` creatures on a ring of radius `r` round the origin (a `tier` / `flag` override per row index) */
function crowd(n: number, r: number, over: { tier?: Record<number, number>; flags?: Record<number, number> } = {}): CrowdFeed {
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  const flags = new Uint8Array(n);
  const eliteTier = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    x[i] = Math.sin(a) * r;
    z[i] = Math.cos(a) * r;
    flags[i] = over.flags?.[i] ?? 0;
    eliteTier[i] = over.tier?.[i] ?? 0;
  }
  return { count: n, x, z, flags, eliteTier };
}

describe('crowdAround (the beacon trigger)', () => {
  it('counts creatures inside the radius only: 5 are not a crowd, 6 are', () => {
    expect(crowdAround(crowd(5, 2.5), 0, 0)).toBe(5);
    expect(crowdAround(crowd(6, 2.5), 0, 0)).toBe(6);
    expect(crowdAround(crowd(6, 2.5), 0, 0)).toBeGreaterThanOrEqual(BEACON_ON);
    // just outside 3 m: nothing counts
    expect(crowdAround(crowd(40, 3.2), 0, 0)).toBe(0);
    // the radius is round the hero, not round the origin
    expect(crowdAround(crowd(6, 2.5), 50, 50)).toBe(0);
    expect(crowdAround(crowd(6, 2.5), 0.3, -0.2)).toBe(6);
  });

  it('skips metin rows (not creatures) and survives feeds without flags / tiers', () => {
    const f = crowd(8, 2, { flags: { 0: 8, 1: 8, 2: 8 } });
    expect(crowdAround(f, 0, 0)).toBe(5);
    expect(crowdAround({ count: 7, x: new Float32Array(7), z: new Float32Array(7) }, 0, 0)).toBe(7);
    expect(crowdAround({ count: 0, x: new Float32Array(0), z: new Float32Array(0) }, 0, 0)).toBe(0);
  });

  it('one boss on the hero is a whole crowd; an elite or a champion pack leader is one creature', () => {
    expect(crowdAround(crowd(1, 1, { tier: { 0: 3 } }), 0, 0)).toBeGreaterThanOrEqual(BEACON_ON);
    // round 1 counted tier 2 (the pack leaders of every Yeonmu / Suryeon pack, scale x1.12) as a crowd: a lone leader lit the beacon
    expect(crowdAround(crowd(1, 1, { tier: { 0: 2 } }), 0, 0)).toBe(1);
    expect(crowdAround(crowd(1, 1, { tier: { 0: 1 } }), 0, 0)).toBe(1);
    expect(crowdAround(crowd(3, 1, { tier: { 0: 2, 1: 2, 2: 1 } }), 0, 0)).toBeLessThan(BEACON_ON);
  });

  it('stops scanning once it has enough (stopAt)', () => {
    const f = crowd(200, 2);
    expect(crowdAround(f, 0, 0, BEACON_NEAR, BEACON_ON)).toBe(BEACON_ON);
    expect(crowdAround(f, 0, 0)).toBe(200);
  });

  it('bossOnly (the world is not full) counts the tier-3 rows alone: a crowd of small ones is nothing, a boss is a whole crowd', () => {
    const f = crowd(30, 2, { tier: { 7: 3 } });
    expect(crowdAround(f, 0, 0)).toBe(29 + BEACON_ON);
    expect(crowdAround(f, 0, 0, BEACON_NEAR, Infinity, true)).toBe(BEACON_ON);
    expect(crowdAround(crowd(30, 2, { tier: { 7: 2, 8: 1 } }), 0, 0, BEACON_NEAR, Infinity, true)).toBe(0);
    // a boss that stands outside the radius does not count either
    expect(crowdAround(crowd(1, 5, { tier: { 0: 3 } }), 0, 0, BEACON_NEAR, Infinity, true)).toBe(0);
  });
});

describe('creatureRows (the world gate)', () => {
  it('counts creature rows and leaves the metin rows out; stops at stopAt', () => {
    const f = crowd(10, 2, { flags: { 1: 8, 4: 8, 9: 8 } });
    expect(creatureRows(f)).toBe(7);
    expect(creatureRows(crowd(200, 2))).toBe(200);
    expect(creatureRows(crowd(200, 2), 60)).toBe(60);
    // a feed without flags counts every row (capped), and an empty one is 0
    expect(creatureRows({ count: 7, x: new Float32Array(7), z: new Float32Array(7) })).toBe(7);
    expect(creatureRows({ count: 7, x: new Float32Array(7), z: new Float32Array(7) }, 5)).toBe(5);
    expect(creatureRows({ count: 0, x: new Float32Array(0), z: new Float32Array(0) })).toBe(0);
  });
});

describe('stepBeacon (debounce + hold + fade)', () => {
  const live = (near: number, over: Partial<BeaconState> = {}): BeaconState => ({ ...newBeaconState(), alive: true, seen: true, near, ...over });
  const tick = (b: BeaconState, near: number, dt: number, alive = true): void => {
    b.near = near;
    b.alive = alive;
    b.seen = true;
    stepBeacon(b, dt);
  };
  const run = (b: BeaconState, near: number, secs: number, dt = 1 / 60): void => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) tick(b, near, dt);
  };
  /** an already switched-on beacon at full fade, held long enough that the minimum on-time is over */
  const lit = (): BeaconState => {
    const b = live(8);
    run(b, 8, BEACON_ARM + 0.1);
    run(b, 8, BEACON_HOLD + 1);
    expect(b.on).toBe(true);
    expect(b.fade).toBe(1);
    return b;
  };

  it('needs the crowd to hold 6 for 0.5 s before it switches on, then fades in over 0.25 s', () => {
    const b = newBeaconState();
    run(b, 5, 2);
    expect(b.on).toBe(false);
    expect(b.fade).toBe(0);
    run(b, 6, BEACON_ARM - 0.05);
    expect(b.on).toBe(false);
    expect(b.fade).toBe(0);
    run(b, 6, 0.1);
    expect(b.on).toBe(true);
    expect(b.fade).toBeGreaterThan(0);
    expect(b.fade).toBeLessThan(0.4);
    run(b, 6, BEACON_FADE);
    expect(b.fade).toBe(1);
    tick(b, 6, 1);
    expect(b.fade).toBe(1);
  });

  it('a crowd that surges across the band never arms it (no blinking in a knockback scrum)', () => {
    const b = newBeaconState();
    let toggles = 0;
    let prev = false;
    // 8 for 0.3 s, 3 for 0.3 s, ... for a minute: never 0.5 s in a row above 6
    for (let i = 0; i < 60 * 60; i++) {
      tick(b, Math.floor(i / 18) % 2 === 0 ? 8 : 3, 1 / 60);
      if (b.on !== prev) toggles++;
      prev = b.on;
    }
    expect(toggles).toBe(0);
    expect(b.fade).toBe(0);
  });

  it('stays on for at least 3 s even when the crowd vanishes at once, then goes off and fades out over 0.25 s', () => {
    const b = live(8);
    run(b, 8, BEACON_ARM + 0.05);
    expect(b.on).toBe(true);
    run(b, 0, BEACON_HOLD - 0.3);
    expect(b.on).toBe(true);
    for (let i = 0; i < 600 && b.on; i++) tick(b, 0, 1 / 60);
    expect(b.on).toBe(false);
    expect(b.held).toBeGreaterThanOrEqual(BEACON_HOLD);
    expect(b.fade).toBeGreaterThan(0.5); // the fade-out has only just begun
    run(b, 0, BEACON_FADE / 2);
    expect(b.fade).toBeGreaterThan(0);
    expect(b.fade).toBeLessThan(0.6);
    run(b, 0, BEACON_FADE);
    expect(b.fade).toBe(0);
  });

  it('once held, a crowd below 4 must stay thin for 2 s in a row; any return to 4 resets that', () => {
    const b = lit();
    run(b, 3, BEACON_DROP - 0.2);
    expect(b.on).toBe(true);
    run(b, BEACON_OFF, 0.1); // back at the band: the clock starts over
    run(b, 3, BEACON_DROP - 0.2);
    expect(b.on).toBe(true);
    run(b, 3, 0.4);
    expect(b.on).toBe(false);
    // and it needs the full 6 for 0.5 s again to come back
    run(b, 5, 2);
    expect(b.on).toBe(false);
    run(b, 6, BEACON_ARM + 0.05);
    expect(b.on).toBe(true);
  });

  it('a scrum that keeps 4..10 round the hero holds it on for a minute; ten quiet seconds turn it off: 2 toggles', () => {
    const b = newBeaconState();
    let toggles = 0;
    let prev = false;
    for (let i = 0; i < 60 * 70; i++) {
      const t = i / 60;
      const near = t < 60 ? Math.round(7 + 3 * Math.sin(t * 5.1)) : 1; // a knockback pulse every ~1.2 s
      tick(b, near, 1 / 60);
      if (b.on !== prev) toggles++;
      prev = b.on;
    }
    expect(toggles).toBe(2);
    expect(b.fade).toBe(0);
  });

  it('a dead hero, or one no longer fed, drops it at once whatever the debounce says; the timers start over', () => {
    const b = lit();
    tick(b, 10, 0.1, false);
    expect(b.on).toBe(false);
    expect(b.fade).toBeCloseTo(0.6, 5);
    expect(b.held).toBe(0);
    const c = lit();
    c.seen = false; // clearRun / a left co-op hero: beacon() was not called this frame
    stepBeacon(c, 0.5);
    expect(c.on).toBe(false);
    expect(c.fade).toBe(0);
    // a revived hero arms from zero again
    const d = lit();
    tick(d, 10, 0.1, false);
    tick(d, 10, 0.2);
    expect(d.on).toBe(false);
    run(d, 10, BEACON_ARM + 0.05);
    expect(d.on).toBe(true);
  });

  it('smooths the telegraph overlap over 0.2 s', () => {
    const b = live(6, { coverTarget: 1 });
    stepBeacon(b, 0.1);
    expect(b.cover).toBeCloseTo(0.5, 5);
    b.seen = true;
    stepBeacon(b, 1);
    expect(b.cover).toBe(1);
    b.coverTarget = 0;
    b.seen = true;
    stepBeacon(b, 0.05);
    expect(b.cover).toBeCloseTo(0.75, 5);
  });
});

describe('telegraphCover (telegraphs always win)', () => {
  const feed = (shape: number, x: number, z: number, rot: number, radius: number, length: number, width: number): CoverFeed => ({
    count: 1,
    shape: [shape],
    x: [x],
    z: [z],
    rot: [rot],
    radius: [radius],
    length: [length],
    width: [width],
  });

  it('no telegraph, no cover', () => {
    expect(telegraphCover(null, 0, 0, 1.05)).toBe(0);
    expect(telegraphCover(undefined, 0, 0, 1.05)).toBe(0);
    expect(telegraphCover({ ...feed(TG_CIRCLE, 0, 0, 0, 5, 0, 0), count: 0 }, 0, 0, 1.05)).toBe(0);
  });

  it('circle: covers while the hero ring touches the disc', () => {
    expect(telegraphCover(feed(TG_CIRCLE, 4, 0, 0, 3, 0, 0), 0, 0, 1.05)).toBe(1); // 4 <= 3 + 1.05
    expect(telegraphCover(feed(TG_CIRCLE, 4.2, 0, 0, 3, 0, 0), 0, 0, 1.05)).toBe(0);
  });

  it('ring: the annulus, with the hole free', () => {
    const f = feed(TG_RING, 0, 0, 0, 8, 6, 0); // outer 8, inner 6
    expect(telegraphCover(f, 7, 0, 1.05)).toBe(1);
    expect(telegraphCover(f, 3, 0, 1.05)).toBe(0);
    expect(telegraphCover(f, 5.2, 0, 1.05)).toBe(1); // the ring touches the inner edge
    expect(telegraphCover(f, 9.5, 0, 1.05)).toBe(0);
  });

  it('line: the rectangle from its origin along the yaw', () => {
    const f = feed(TG_LINE, 0, 0, 0, 0, 10, 2); // along +z, 2 m wide, 10 m long
    expect(telegraphCover(f, 0, 5, 1.05)).toBe(1);
    expect(telegraphCover(f, 1.9, 5, 1.05)).toBe(1); // 1.9 <= 1 + 1.05
    expect(telegraphCover(f, 2.2, 5, 1.05)).toBe(0);
    expect(telegraphCover(f, 0, 11.5, 1.05)).toBe(0);
    // yawed by 90 degrees it runs along +x
    const g = feed(TG_LINE, 0, 0, Math.PI / 2, 0, 10, 2);
    expect(telegraphCover(g, 5, 0, 1.05)).toBe(1);
    expect(telegraphCover(g, 0, 5, 1.05)).toBe(0);
  });

  it('cone: the sector in front, not behind', () => {
    const f = feed(TG_CONE, 0, 0, 0, 8, 0, Math.PI / 2); // facing +z, 90 degrees
    expect(telegraphCover(f, 0, 4, 1.05)).toBe(1);
    expect(telegraphCover(f, 3.5, 3.5, 1.05)).toBe(1); // 45 degrees off the axis: the edge
    expect(telegraphCover(f, 6, 1, 1.05)).toBe(0);
    expect(telegraphCover(f, 0, -4, 1.05)).toBe(0);
    expect(telegraphCover(f, 0, 12, 1.05)).toBe(0);
    expect(telegraphCover(f, 0, 0.5, 1.05)).toBe(1); // on the origin
  });
});

describe('beacon instances', () => {
  const heightAt = (): number => 2;
  const colors = new Float32Array(BEACON_MAX * 3).map((_, i) => 0.1 + i * 0.01);
  const fed = (fade: number, x: number, cover = 0): BeaconState => ({ ...newBeaconState(), fade, x, z: 5, cover, alive: true });

  it('a faded-out hero writes nothing; a visible one writes a ring (and a chevron when asked: every tier asks)', () => {
    const out = new Float32Array(BEACON_MAX * 2 * 16);
    expect(writeBeaconInstances([fed(0, 1), fed(0.001, 1)], true, heightAt, colors, out)).toBe(0);
    expect(writeBeaconInstances([fed(1, 1)], false, heightAt, colors, out)).toBe(1);
    expect(writeBeaconInstances([fed(1, 1)], true, heightAt, colors, out)).toBe(2);
    // ring: x, z, radius, kind 0, plane h0 = 2, alpha 0.35, slot 0 colour
    expect(Array.from(out.slice(0, 5))).toEqual([1, 5, 1.05, 0, 2].map((v) => Math.fround(v)));
    expect(out[8]).toBeCloseTo(BEACON_ALPHA, 5);
    expect(out[9]).toBeCloseTo(colors[0] as number, 6);
    // chevron: kind 1, anchored above the ground, not on it
    expect(out[16 + 3]).toBe(1);
    expect(out[16 + 4]).toBeGreaterThan(2 + 2);
    expect(out[16 + 8]).toBeGreaterThan(0.5);
  });

  it('co-op heroes keep their slot colour, and there is room for four heroes with chevrons', () => {
    const out = new Float32Array(BEACON_MAX * 2 * 16);
    const n = writeBeaconInstances([fed(1, 0), fed(1, 1), fed(0, 2), fed(1, 3)], true, heightAt, colors, out);
    expect(n).toBe(6);
    expect(out[0]).toBe(0);
    expect(out[2 * 16]).toBe(1); // slot 1 (instances 2 and 3)
    expect(out[2 * 16 + 9]).toBeCloseTo(colors[3] as number, 6);
    expect(out[4 * 16]).toBe(3); // slot 3 follows (slot 2 is faded out)
    expect(out[4 * 16 + 9]).toBeCloseTo(colors[9] as number, 6);
    const all = [fed(1, 0), fed(1, 1), fed(1, 2), fed(1, 3)];
    expect(writeBeaconInstances(all, true, heightAt, colors, out)).toBe(BEACON_MAX * 2);
  });

  it('two colours: the local hero is the hero ring gold, every other co-op hero is one azure (the same on every client)', () => {
    expect(BEACON_COLORS).toHaveLength(2);
    expect(new Set(BEACON_COLORS).size).toBe(2);
    expect(BEACON_COLORS[0]).toBe('#ffcc33');
  });

  it('under a telegraph the ring is thinner and fainter (the telegraph wins)', () => {
    expect(beaconAlpha(1, 1)).toBeLessThan(beaconAlpha(1, 0) * 0.8);
    // ... but not invisible: round 1 dropped it to 0.19 and the ring vanished on medium / low in the dense fights that carry a telegraph
    expect(beaconAlpha(1, 1)).toBeGreaterThan(0.25);
    expect(beaconAlpha(1, 0)).toBeCloseTo(0.35, 6);
    expect(beaconThin(1)).toBeLessThan(beaconThin(0));
    expect(beaconAlpha(0.5, 0)).toBeGreaterThan(0);
    expect(beaconAlpha(0.5, 0)).toBeLessThan(beaconAlpha(1, 0));
    const out = new Float32Array(BEACON_MAX * 2 * 16);
    writeBeaconInstances([fed(1, 0, 1)], false, heightAt, colors, out);
    expect(out[8]).toBeCloseTo(beaconAlpha(1, 1), 6);
    expect(out[12]).toBeCloseTo(beaconThin(1), 6);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// FEEL-01: the GroundRings system with the beacon (a fake core: no WebGL needed to build the meshes and materials)

function fakeCore(tier: 'low' | 'medium' | 'high' = 'high'): { core: RenderCore; scene: Scene } {
  const scene = new Scene();
  const core = {
    scene,
    quality: { tier, profile: { tier, decalCap: 16 }, onChange: () => () => undefined },
    rig: { focus: new Vector3(), isVisible: () => true },
    heightAt: () => 0,
    clock: { time: 0, dt: 0, frame: 0 },
  } as unknown as RenderCore;
  return { core, scene };
}

/**
 * `n` creatures 2 m round (hx, hz) of tier `tier`, plus `world - n` far away ones (a late-run world is full; the beacon only arms with
 * BEACON_WORLD_ON creatures alive), as a feed object the way RenderWorld hands it over
 */
function crowdFeed(n: number, hx = 0, hz = 0, tier = 0, world = 80, metins = 0): CrowdFeed {
  const creatures = Math.max(n, world);
  const total = creatures + metins;
  const x = new Float32Array(total);
  const z = new Float32Array(total);
  const flags = new Uint8Array(total);
  const eliteTier = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (i < n) {
      x[i] = hx + Math.sin(i) * 2;
      z[i] = hz + Math.cos(i) * 2;
      eliteTier[i] = tier;
    } else if (i < creatures) {
      x[i] = hx + 400 + i;
      z[i] = hz + 400;
    } else {
      // metin stones (flag 8) standing next to the hero: not creatures, they count for neither the crowd nor the world gate
      x[i] = hx + 1;
      z[i] = hz + 1;
      flags[i] = 8;
    }
  }
  return { count: total, x, z, flags, eliteTier };
}

const beaconMesh = (scene: Scene): Mesh => scene.getObjectByName('groundBeacon') as Mesh;
const beaconInstance = (m: Mesh, i: number, attr: 'aP' | 'aR'): number[] => {
  const a = m.geometry.getAttribute(attr) as InterleavedBufferAttribute;
  return [0, 1, 2, 3].map((k) => a.data.array[i * a.data.stride + a.offset + k] as number);
};

describe('GroundRings hero beacon', () => {
  /** `frames` frames of 1/60 s with `n` creatures round hero `slot` at (hx, hz) */
  const feedFrames = (
    rings: GroundRings,
    frames: number,
    n: number,
    over: { slot?: number; hx?: number; hz?: number; tg?: CoverFeed | null; alive?: boolean; tier?: number } = {},
  ): void => {
    const hx = over.hx ?? 0;
    const hz = over.hz ?? 0;
    for (let f = 0; f < frames; f++) {
      rings.beacon(over.slot ?? 0, hx, hz, 0, crowdFeed(n, hx, hz, over.tier ?? 0), over.tg ?? null, over.alive ?? true);
      rings.update(1 / 60);
    }
  };
  /** frames that cover the 0.5 s switch-on debounce plus the 0.25 s fade, with margin */
  const LIT = 60;

  it('has one dedicated material that never depth-tests, never links with a tier define, and ignores the hero pixels', () => {
    const { core, scene } = fakeCore('medium');
    new GroundRings(core);
    const m = beaconMesh(scene);
    expect(m).toBeDefined();
    const mat = m.material as ShaderMaterial;
    expect(mat.name).toBe('up:FEEL-01:beacon');
    expect(mat.depthTest).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(Object.keys(mat.defines ?? {})).toEqual([]);
    // the hero stencil mask (render/heroOutline.ts writes 1) excludes the hero's own pixels, and nothing is ever written
    expect(mat.stencilWrite).toBe(true);
    expect(mat.stencilFunc).toBe(NotEqualStencilFunc);
    expect(mat.stencilRef).toBe(1);
    expect(mat.stencilZPass).toBe(KeepStencilOp);
    expect(m.renderOrder).toBeGreaterThan(60);
    expect(m.renderOrder).toBeLessThan(980);
    // idle: hidden, with one zeroed instance so the warm-up frame that shows it draws nothing but still builds its state
    expect(m.visible).toBe(false);
    expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(1);
    expect(beaconInstance(m, 0, 'aP')).toEqual([0, 0, 0, 0]);
    expect(beaconInstance(m, 0, 'aR')).toEqual([0, 0, 0, 0]);
  });

  it('shows after 6 creatures held for 0.5 s within 3 m, fades in over 0.25 s, and not for 5', () => {
    const { core, scene } = fakeCore('high');
    const rings = new GroundRings(core);
    feedFrames(rings, 90, 5);
    expect(beaconMesh(scene).visible).toBe(false);
    expect(rings.stats.beacons).toBe(0);
    // 6 creatures, but not yet for 0.5 s: still nothing
    feedFrames(rings, Math.round(BEACON_ARM * 60) - 4, 6);
    expect(beaconMesh(scene).visible).toBe(false);
    feedFrames(rings, 6, 6);
    expect(beaconMesh(scene).visible).toBe(true);
    expect(rings.stats.beacons).toBe(1);
    const early = beaconInstance(beaconMesh(scene), 0, 'aR')[0] as number;
    feedFrames(rings, 20, 8);
    const full = beaconInstance(beaconMesh(scene), 0, 'aR')[0] as number;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(full);
    expect(full).toBeCloseTo(BEACON_ALPHA, 5);
  });

  it('an early-run world (fewer than 60 creatures alive) never arms it; a full one does; once on it holds down to 40', () => {
    const { core, scene } = fakeCore('high');
    const rings = new GroundRings(core);
    const frames = (n: number, world: number, count: number): void => {
      for (let f = 0; f < count; f++) {
        rings.beacon(0, 0, 0, 0, crowdFeed(n, 0, 0, 0, world), null, true);
        rings.update(1 / 60);
      }
    };
    frames(11, BEACON_WORLD_ON - 1, 120); // a warrior in an 11-strong pack at Yeonmu 1:00: not a crowd the hero is lost in
    expect(beaconMesh(scene).visible).toBe(false);
    frames(11, BEACON_WORLD_ON, 60);
    expect(beaconMesh(scene).visible).toBe(true);
    frames(11, BEACON_WORLD_OFF, 400); // the world thins a little: still on
    expect(rings.stats.beacons).toBe(1);
    frames(11, BEACON_WORLD_OFF - 1, 300); // ... and then it is off (after the hold + drop)
    expect(rings.stats.beacons).toBe(0);
  });

  it('metin rows do not fill the world gate: 59 creatures and 12 metin rows is not a full world', () => {
    const { core, scene } = fakeCore('high');
    const rings = new GroundRings(core);
    for (let f = 0; f < 120; f++) {
      rings.beacon(0, 0, 0, 0, crowdFeed(11, 0, 0, 0, BEACON_WORLD_ON - 1, 12), null, true);
      rings.update(1 / 60);
    }
    expect(beaconMesh(scene).visible).toBe(false);
    for (let f = 0; f < 60; f++) {
      rings.beacon(0, 0, 0, 0, crowdFeed(11, 0, 0, 0, BEACON_WORLD_ON, 12), null, true);
      rings.update(1 / 60);
    }
    expect(beaconMesh(scene).visible).toBe(true);
  });

  it('a boss on the hero bypasses the world gate (an empty arena with a giant on the hero); a boss 5 m away or a lone leader does not', () => {
    const { core, scene } = fakeCore('high');
    const rings = new GroundRings(core);
    const run = (feed: () => CrowdFeed, frames: number): void => {
      for (let f = 0; f < frames; f++) {
        rings.beacon(0, 0, 0, 0, feed(), null, true);
        rings.update(1 / 60);
      }
    };
    const one = (x: number, tier: number): CrowdFeed => ({ count: 1, x: [x], z: [0], flags: [0], eliteTier: [tier] });
    run(() => one(5, 3), 120);
    expect(beaconMesh(scene).visible).toBe(false);
    run(() => one(1, 2), 120);
    expect(beaconMesh(scene).visible).toBe(false);
    run(() => one(1, 3), LIT);
    expect(beaconMesh(scene).visible).toBe(true);
    expect(rings.stats.beacons).toBe(1);
    // the giant stays: still on after the hold, even though the world is far below the off limit
    run(() => one(1, 3), 400);
    expect(rings.stats.beacons).toBe(1);
  });

  it('a lone pack leader (tier 2) does not light it; a boss on the hero does', () => {
    const { core, scene } = fakeCore('high');
    const rings = new GroundRings(core);
    feedFrames(rings, LIT, 1, { tier: 2 });
    expect(beaconMesh(scene).visible).toBe(false);
    feedFrames(rings, LIT, 1, { tier: 3 });
    expect(beaconMesh(scene).visible).toBe(true);
  });

  it('draws a ring + a chevron on EVERY tier (same material, same one draw): the ring alone is lost under a telegraph on medium / low', () => {
    for (const tier of ['high', 'medium', 'low'] as const) {
      const { core, scene } = fakeCore(tier);
      const rings = new GroundRings(core);
      feedFrames(rings, LIT, 9, { hx: 4, hz: 5 });
      const m = beaconMesh(scene);
      expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(2);
      expect(beaconInstance(m, 0, 'aP')[3]).toBe(0); // ring
      expect(beaconInstance(m, 1, 'aP')[3]).toBe(1); // chevron
      expect(beaconInstance(m, 0, 'aP').slice(0, 2)).toEqual([4, 5]);
      expect(beaconInstance(m, 1, 'aP').slice(0, 2)).toEqual([4, 5]);
    }
  });

  it('under a telegraph the ring thins out but the chevron keeps its full alpha on every tier (it is what finds the hero there)', () => {
    const cover: CoverFeed = { count: 1, shape: [TG_CIRCLE], x: [1], z: [0], rot: [0], radius: [6], length: [0], width: [0] };
    for (const tier of ['high', 'medium', 'low'] as const) {
      const { core, scene } = fakeCore(tier);
      const rings = new GroundRings(core);
      feedFrames(rings, 90, 9);
      const free = beaconInstance(beaconMesh(scene), 1, 'aR')[0] as number;
      feedFrames(rings, 30, 9, { tg: cover });
      const m = beaconMesh(scene);
      expect(beaconInstance(m, 0, 'aR')[0]).toBeLessThan(BEACON_ALPHA);
      expect(beaconInstance(m, 1, 'aR')[0]).toBeCloseTo(free, 6);
      expect(free).toBeGreaterThan(0.85);
    }
  });

  it('a dead hero, a hero that is no longer reported and a cleared run fade out and hide the mesh', () => {
    const { core, scene } = fakeCore('high');
    const rings = new GroundRings(core);
    const on = (): void => {
      feedFrames(rings, LIT, 9);
      expect(beaconMesh(scene).visible).toBe(true);
    };
    on();
    // death: still visible half-way through the fade, gone after 0.25 s, the instance zeroed
    feedFrames(rings, 7, 9, { alive: false });
    expect(beaconMesh(scene).visible).toBe(true);
    feedFrames(rings, 10, 9, { alive: false });
    expect(beaconMesh(scene).visible).toBe(false);
    expect(beaconInstance(beaconMesh(scene), 0, 'aR')).toEqual([0, 0, 0, 0]);
    expect(rings.stats.beacons).toBe(0);
    // revive: the crowd is still there, it comes back (after the debounce)
    on();
    // the hero leaves the party (not reported any more)
    for (let f = 0; f < 20; f++) rings.update(1 / 60);
    expect(beaconMesh(scene).visible).toBe(false);
    // run end: clearBeacons drops it at once (no fade-out over the next run's first frames)
    on();
    rings.clearBeacons();
    rings.update(1 / 60);
    expect(beaconMesh(scene).visible).toBe(false);
  });

  it('co-op: every hero slot has its own beacon; the local hero is gold, every other hero azure; slots past 4 are ignored; the DEV switch turns it off', () => {
    const { core, scene } = fakeCore('medium');
    const rings = new GroundRings(core);
    for (let f = 0; f < LIT; f++) {
      rings.beacon(0, 0, 0, 0, crowdFeed(9, 0, 0), null, true);
      rings.beacon(1, 30, 0, 0, crowdFeed(9, 30, 0), null, true);
      rings.beacon(2, 60, 0, 0, crowdFeed(2, 60, 0), null, true); // alone: no beacon
      rings.beacon(3, 90, 0, 0, crowdFeed(9, 90, 0), null, true);
      rings.beacon(7, 120, 0, 0, crowdFeed(9, 120, 0), null, true); // past the party size
      rings.update(1 / 60);
    }
    const m = beaconMesh(scene);
    expect(rings.stats.beacons).toBe(3);
    // ring + chevron per hero: slot 0 = instances 0 / 1, slot 1 = 2 / 3, slot 3 = 4 / 5
    expect((m.geometry as InstancedBufferGeometry).instanceCount).toBe(6);
    const c0 = beaconInstance(m, 0, 'aR').slice(1);
    const c1 = beaconInstance(m, 2, 'aR').slice(1);
    const c3 = beaconInstance(m, 4, 'aR').slice(1);
    expect(c0).not.toEqual(c1);
    expect(c3).toEqual(c1); // every ally has the same colour: it does not depend on the slot index
    expect(beaconInstance(m, 2, 'aP')[0]).toBe(30);
    expect(beaconInstance(m, 3, 'aP')[3]).toBe(1); // the ally's chevron
    rings.beaconOff = true;
    for (let f = 0; f < 20; f++) {
      rings.beacon(0, 0, 0, 0, crowdFeed(9), null, true);
      rings.update(1 / 60);
    }
    expect(m.visible).toBe(false);
  });

  it('a hero that leaves re-indexes the party: the slot starts over instead of carrying the previous hero over', () => {
    const { core, scene } = fakeCore('medium');
    const rings = new GroundRings(core);
    for (let f = 0; f < LIT; f++) {
      rings.beacon(0, 0, 0, 0, crowdFeed(9, 0, 0), null, true);
      rings.beacon(1, 30, 0, 0, crowdFeed(9, 30, 0), null, true);
      rings.update(1 / 60);
    }
    expect(rings.stats.beacons).toBe(2);
    // slot 1 now belongs to the hero that stood in slot 2, far away and alone: no stale fade-out, no stale "on"
    rings.beacon(0, 0, 0, 0, crowdFeed(9, 0, 0), null, true);
    rings.beacon(1, 30 + BEACON_JUMP + 1, 0, 0, crowdFeed(1, 37, 0), null, true);
    rings.update(1 / 60);
    expect(rings.stats.beacons).toBe(1);
    expect((beaconMesh(scene).geometry as InstancedBufferGeometry).instanceCount).toBe(2); // slot 0's ring + chevron only
  });

  it('a re-index during the 0.5 s arm starts the debounce over (not only for a beacon that is already visible)', () => {
    const { core, scene } = fakeCore('medium');
    const rings = new GroundRings(core);
    feedFrames(rings, 24, 9); // 0.4 s of crowd: armed, not on
    expect(beaconMesh(scene).visible).toBe(false);
    const far = BEACON_JUMP + 20;
    feedFrames(rings, 24, 9, { hx: far }); // another hero now fills the slot: 0.4 s more would carry the arm over to 0.8 s = on
    expect(beaconMesh(scene).visible).toBe(false);
    feedFrames(rings, 12, 9, { hx: far }); // 0.6 s since the re-index
    expect(beaconMesh(scene).visible).toBe(true);
  });

  it('the ground ring of a co-op ally is azure (the beacon colour), the local hero keeps the kind default and the gold look', () => {
    const ally = new Color(BEACON_ALLY_HEX);
    const own = new Color(RING_DEFAULT_COLOR.hero);
    // the shader swaps red / blue of the gold hero branch only for a blue-dominant colour (b > 4 r)
    expect(ally.b).toBeGreaterThan(ally.r * 4);
    expect(own.b).toBeLessThan(own.r * 4);
    expect(BEACON_ALLY_HEX).toBe(BEACON_COLORS[1]);
    const { core, scene } = fakeCore('medium');
    const rings = new GroundRings(core);
    expect((rings as unknown as { smallMat: ShaderMaterial }).smallMat.fragmentShader).toContain('colMain.b > colMain.r * 4.0) col = col.bgr');
    rings.add(0, 0, 1.05, 'hero', 1, undefined, 0);
    rings.add(10, 0, 1.05, 'hero', 1, BEACON_ALLY_HEX, 0);
    rings.update(1 / 60);
    const small = scene.getObjectByName('groundRingsSmall') as Mesh;
    expect((small.geometry as InstancedBufferGeometry).instanceCount).toBe(2);
    const rows = [0, 1].map((i) => ({ x: beaconInstance(small, i, 'aP')[0] as number, rgb: beaconInstance(small, i, 'aR').slice(1) }));
    const mine = rows.find((r) => r.x === 0)!.rgb;
    const theirs = rows.find((r) => r.x === 10)!.rgb;
    expect(theirs[2]).toBeGreaterThan((theirs[0] as number) * 4);
    expect(mine[2]).toBeLessThan((mine[0] as number) * 4);
  });

  it('a telegraph on the hero makes the ring fainter and thinner within 0.2 s; none, and it is back', () => {
    const { core, scene } = fakeCore('medium');
    const rings = new GroundRings(core);
    const cover: CoverFeed = { count: 1, shape: [TG_CIRCLE], x: [1], z: [0], rot: [0], radius: [6], length: [0], width: [0] };
    feedFrames(rings, 90, 9);
    const clear = beaconInstance(beaconMesh(scene), 0, 'aR')[0] as number;
    feedFrames(rings, 20, 9, { tg: cover });
    const covered = beaconInstance(beaconMesh(scene), 0, 'aR')[0] as number;
    expect(covered).toBeCloseTo(beaconAlpha(1, 1), 5);
    expect(covered).toBeLessThan(clear);
    const thin = (m: Mesh): number => {
      const a = m.geometry.getAttribute('aS') as InterleavedBufferAttribute;
      return a.data.array[a.offset] as number;
    };
    expect(thin(beaconMesh(scene))).toBeCloseTo(beaconThin(1), 5);
    feedFrames(rings, 20, 9);
    expect(beaconInstance(beaconMesh(scene), 0, 'aR')[0]).toBeCloseTo(clear, 5);
  });
});
