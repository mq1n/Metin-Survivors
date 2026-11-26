// Uniform-grid spatial hash over enemies: circle queries vs brute force, nearest, Dying/Invuln filtering, neighbours.

import { describe, expect, it } from 'vitest';
import { CAP, CELL } from '../constants';
import { Rng } from '../rng';
import { SpatialHash } from '../spatial';
import { EnemyFlag, EnemyState, EnemyStore } from '../stores';
import { clearEnemies, dropSkills, freezeSchedules, makeWorld, NO_INPUT, spawn } from './helpers';

const ARENA = 150;
const PAD = 24; // the hash pads the arena by 24 m on every side (spatial.ts)

interface Body {
  x: number;
  z: number;
  radius: number;
  state?: number;
  flags?: number;
}

function addBody(e: EnemyStore, b: Body): number {
  const row = e.alloc();
  if (row < 0) throw new Error('store full');
  e.x[row] = b.x;
  e.z[row] = b.z;
  e.px[row] = b.x;
  e.pz[row] = b.z;
  e.radius[row] = b.radius;
  e.state[row] = b.state ?? EnemyState.Move;
  e.flags[row] = b.flags ?? 0;
  e.hp[row] = 10;
  return row;
}

interface CloudOpts {
  n: number;
  /** body radius range [lo, hi) */
  radius: [number, number];
  /** fraction of rows put in these states / flags */
  dying?: number;
  invuln?: number;
  phased?: number;
  /** positions are drawn from [-extent, extent]² (half clustered) */
  extent?: number;
}

function makeCloud(rng: Rng, o: CloudOpts): EnemyStore {
  const e = new EnemyStore(CAP.enemies);
  const extent = o.extent ?? ARENA;
  const centres: [number, number][] = [];
  for (let i = 0; i < 12; i++) centres.push([rng.range(-extent, extent), rng.range(-extent, extent)]);
  for (let i = 0; i < o.n; i++) {
    let x: number;
    let z: number;
    if (rng.chance(0.5)) {
      const c = rng.pick(centres);
      x = c[0] + rng.gauss() * 4;
      z = c[1] + rng.gauss() * 4;
    } else {
      x = rng.range(-extent, extent);
      z = rng.range(-extent, extent);
    }
    const roll = rng.next();
    const dying = o.dying ?? 0;
    const invuln = o.invuln ?? 0;
    const phased = o.phased ?? 0;
    let state: number = EnemyState.Move;
    let flags = 0;
    if (roll < dying) state = EnemyState.Dying;
    else if (roll < dying + invuln) flags = EnemyFlag.Invuln;
    else if (roll < dying + invuln + phased) flags = EnemyFlag.Phased;
    addBody(e, { x, z, radius: rng.range(o.radius[0], o.radius[1]), state, flags });
  }
  return e;
}

function sortedRows(out: Int32Array, n: number): number[] {
  return Array.from(out.subarray(0, n)).sort((a, b) => a - b);
}

/** every live row whose body overlaps the circle (by the stored, float32-rounded positions) */
function bruteCircle(e: EnemyStore, x: number, z: number, r: number, includeInvuln: boolean): number[] {
  const rows: number[] = [];
  for (let i = 0; i < e.count; i++) {
    if (e.state[i] === EnemyState.Dying) continue;
    if (!includeInvuln && ((e.flags[i] as number) & (EnemyFlag.Invuln | EnemyFlag.Phased)) !== 0) continue;
    const dx = (e.x[i] as number) - x;
    const dz = (e.z[i] as number) - z;
    const rr = r + (e.radius[i] as number);
    if (dx * dx + dz * dz <= rr * rr) rows.push(i);
  }
  return rows;
}

/** documented semantics of `nearest`: smallest (centre distance − body radius) strictly below r */
function bruteNearest(e: EnemyStore, x: number, z: number, r: number, skipHandle = 0): number {
  let best = -1;
  let bestGap = r;
  for (let i = 0; i < e.count; i++) {
    if (e.state[i] === EnemyState.Dying) continue;
    if (((e.flags[i] as number) & (EnemyFlag.Invuln | EnemyFlag.Phased)) !== 0) continue;
    if (skipHandle !== 0 && e.id[i] === skipHandle) continue;
    const gap = Math.hypot((e.x[i] as number) - x, (e.z[i] as number) - z) - (e.radius[i] as number);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

function newHash(): SpatialHash {
  return new SpatialHash(ARENA, CAP.enemies);
}

describe('SpatialHash.queryCircle vs brute force', () => {
  it('matches brute force on random enemy clouds (normal-sized bodies)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = new Rng(seed);
      const e = makeCloud(rng, { n: 500, radius: [0.3, 1.1] });
      const hash = newHash();
      hash.rebuild(e);
      const out = new Int32Array(CAP.enemies);
      let total = 0;
      for (let q = 0; q < 400; q++) {
        const x = rng.range(-ARENA, ARENA);
        const z = rng.range(-ARENA, ARENA);
        const r = rng.chance(0.2) ? rng.range(8, 20) : rng.range(0.1, 6);
        const n = hash.queryCircle(e, x, z, r, out);
        const got = sortedRows(out, n);
        const want = bruteCircle(e, x, z, r, false);
        total += want.length;
        if (got.join() !== want.join()) throw new Error(`seed ${seed} query ${q} (${x.toFixed(2)},${z.toFixed(2)},r=${r.toFixed(2)}): got [${got}] want [${want}]`);
      }
      expect(total).toBeGreaterThan(100); // the clouds are dense enough for the comparison to mean something
    }
  });

  it('matches brute force with big bodies (bosses / elites up to 2.1 m radius)', () => {
    for (const seed of [11, 12, 13]) {
      const rng = new Rng(seed);
      const e = makeCloud(rng, { n: 450, radius: [0.4, 1.0] });
      // sprinkle large bodies: elder bears (~1.9 m), bosses (~1.7 m), up to 2.1 m
      for (let i = 0; i < 40; i++) {
        addBody(e, { x: rng.range(-ARENA, ARENA), z: rng.range(-ARENA, ARENA), radius: rng.range(1.5, 2.1) });
      }
      const hash = newHash();
      hash.rebuild(e);
      const out = new Int32Array(CAP.enemies);
      for (let q = 0; q < 500; q++) {
        // aim half of the queries right at the rim of a random big body
        let x: number;
        let z: number;
        let r: number;
        if (q % 2 === 0) {
          const big = 450 + rng.int(40);
          const a = rng.angle();
          r = rng.range(0.1, 1.5);
          const d = (e.radius[big] as number) + r - 0.05; // just overlapping
          x = (e.x[big] as number) + Math.sin(a) * d;
          z = (e.z[big] as number) + Math.cos(a) * d;
        } else {
          x = rng.range(-ARENA, ARENA);
          z = rng.range(-ARENA, ARENA);
          r = rng.range(0.1, 8);
        }
        const n = hash.queryCircle(e, x, z, r, out);
        const got = sortedRows(out, n);
        const want = bruteCircle(e, x, z, r, false);
        if (got.join() !== want.join()) throw new Error(`seed ${seed} query ${q}: got [${got}] want [${want}]`);
      }
    }
  });

  it('finds bodies up to the Great Metin radius (3.4 m) wherever the query touches their rim', () => {
    // GREAT metin rows are 3.4 m wide (metins.ts); the hash contract is "enemies whose body overlaps the circle"
    const e = new EnemyStore(CAP.enemies);
    const hash = newHash();
    const out = new Int32Array(CAP.enemies);
    const rng = new Rng(77);
    const misses: string[] = [];
    for (let trial = 0; trial < 400; trial++) {
      e.clear();
      const cx = rng.range(-120, 120);
      const cz = rng.range(-120, 120);
      const row = addBody(e, { x: cx, z: cz, radius: 3.4 });
      hash.rebuild(e);
      const a = rng.angle();
      const r = rng.range(0.15, 0.6);
      const d = 3.4 + r - 0.02; // the circle just overlaps the body rim
      const qx = cx + Math.sin(a) * d;
      const qz = cz + Math.cos(a) * d;
      const n = hash.queryCircle(e, qx, qz, r, out);
      if (!(n === 1 && out[0] === row)) misses.push(`trial ${trial}: centre (${cx.toFixed(2)},${cz.toFixed(2)}) query (${qx.toFixed(2)},${qz.toFixed(2)}) r=${r.toFixed(2)}`);
    }
    expect(misses).toEqual([]);
  });

  it('matches brute force on border cases: enemies and queries at the arena edge, corners and beyond', () => {
    const rng = new Rng(21);
    const e = new EnemyStore(CAP.enemies);
    const spots: [number, number][] = [];
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) spots.push([sx * 149.5, sz * 149.5]);
    spots.push([-ARENA - PAD + 0.1, 0], [ARENA + PAD - 0.1, 0], [0, -ARENA - PAD + 0.1], [0, ARENA + PAD - 0.1]);
    spots.push([-ARENA - PAD + 0.1, -ARENA - PAD + 0.1], [ARENA + PAD - 0.1, ARENA + PAD - 0.1]);
    for (const [sx, sz] of spots) {
      for (let k = 0; k < 6; k++) {
        addBody(e, { x: sx + rng.range(-2, 2), z: sz + rng.range(-2, 2), radius: rng.range(0.3, 1.2) });
      }
    }
    // a few hugging the cell boundaries exactly
    for (let k = -3; k <= 3; k++) {
      addBody(e, { x: -(ARENA + PAD) + k * CELL, z: 3 * CELL - (ARENA + PAD), radius: 0.5 });
      addBody(e, { x: 0, z: k * CELL, radius: 0.5 });
    }
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(CAP.enemies);
    let found = 0;
    for (const [sx, sz] of spots) {
      for (let k = 0; k < 40; k++) {
        const x = sx + rng.range(-6, 6);
        const z = sz + rng.range(-6, 6);
        const r = rng.range(0.1, 7);
        const n = hash.queryCircle(e, x, z, r, out);
        const got = sortedRows(out, n);
        const want = bruteCircle(e, x, z, r, false);
        found += want.length;
        if (got.join() !== want.join()) throw new Error(`query (${x.toFixed(2)},${z.toFixed(2)}) r=${r.toFixed(2)}: got [${got}] want [${want}]`);
      }
    }
    expect(found).toBeGreaterThan(50);
  });

  it('does not throw and returns only real rows when enemies or queries lie outside the grid', () => {
    const e = new EnemyStore(CAP.enemies);
    addBody(e, { x: 500, z: -700, radius: 0.5 });
    addBody(e, { x: -900, z: 20, radius: 0.5 });
    addBody(e, { x: 0, z: 0, radius: 0.5 });
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(16);
    for (const [x, z] of [[1e4, 1e4], [-1e4, -1e4], [0, 0], [500, -700], [-ARENA - 30, 0]] as const) {
      const n = hash.queryCircle(e, x, z, 3, out);
      for (let i = 0; i < n; i++) expect(out[i]).toBeLessThan(e.count);
    }
    expect(hash.queryCircle(e, 0, 0, 3, out)).toBe(1);
    expect(hash.nearest(e, 0, 0, 3)).toBe(2);
    expect(hash.neighbours(0, 0, out)).toBe(1);
  });

  it('still finds enemies that moved up to 0.5 m after the rebuild (per-tick movement slack)', () => {
    for (const seed of [31, 32, 33]) {
      const rng = new Rng(seed);
      const e = makeCloud(rng, { n: 450, radius: [0.3, 1.0] });
      for (let i = 0; i < 40; i++) addBody(e, { x: rng.range(-ARENA, ARENA), z: rng.range(-ARENA, ARENA), radius: rng.range(1.3, 1.6) });
      const hash = newHash();
      hash.rebuild(e);
      // move everything a little AFTER the rebuild (charges / knockback / separation)
      for (let i = 0; i < e.count; i++) {
        const a = rng.angle();
        const d = rng.range(0, 0.5);
        e.x[i] = (e.x[i] as number) + Math.sin(a) * d;
        e.z[i] = (e.z[i] as number) + Math.cos(a) * d;
      }
      const out = new Int32Array(CAP.enemies);
      for (let q = 0; q < 400; q++) {
        const x = rng.range(-ARENA, ARENA);
        const z = rng.range(-ARENA, ARENA);
        const r = rng.range(0.1, 6);
        const n = hash.queryCircle(e, x, z, r, out);
        const got = sortedRows(out, n);
        const want = bruteCircle(e, x, z, r, false);
        if (got.join() !== want.join()) throw new Error(`seed ${seed} query ${q}: got [${got}] want [${want}]`);
      }
    }
  });

  it('respects the out buffer length and the count it returns', () => {
    const e = new EnemyStore(64);
    for (let i = 0; i < 20; i++) addBody(e, { x: i * 0.2, z: 0, radius: 0.5 });
    const hash = newHash();
    hash.rebuild(e);
    const big = new Int32Array(64);
    expect(hash.queryCircle(e, 2, 0, 10, big)).toBe(20);
    const small = new Int32Array(5);
    expect(hash.queryCircle(e, 2, 0, 10, small)).toBe(5);
    const rows = new Set(Array.from(small));
    expect(rows.size).toBe(5);
    for (const r of rows) expect(r).toBeLessThan(20);
  });

  it('boundary: a circle that exactly touches a body (distance = r + radius) counts as overlapping', () => {
    const e = new EnemyStore(8);
    addBody(e, { x: 3, z: 0, radius: 1 });
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(8);
    expect(hash.queryCircle(e, 0, 0, 2, out)).toBe(1); // 3 === 2 + 1
    expect(hash.queryCircle(e, 0, 0, 1.99, out)).toBe(0);
  });

  it('a rebuild replaces the previous index (freed, moved and re-allocated rows)', () => {
    const e = new EnemyStore(32);
    const rows = [addBody(e, { x: 10, z: 10, radius: 0.5 }), addBody(e, { x: -10, z: 5, radius: 0.5 }), addBody(e, { x: 30, z: -8, radius: 0.5 })];
    const hash = newHash();
    const out = new Int32Array(32);
    hash.rebuild(e);
    expect(hash.queryCircle(e, 10, 10, 1, out)).toBe(1);
    e.free(rows[0] as number); // last row swaps in
    hash.rebuild(e);
    expect(hash.size).toBe(2);
    expect(hash.queryCircle(e, 10, 10, 1, out)).toBe(0);
    const moved = e.count - 1;
    e.x[moved] = 10;
    e.z[moved] = 10;
    hash.rebuild(e);
    const n = hash.queryCircle(e, 10, 10, 1, out);
    expect(n).toBe(1);
    expect(out[0]).toBe(moved);
    e.clear();
    hash.rebuild(e);
    expect(hash.size).toBe(0);
    expect(hash.queryCircle(e, 0, 0, 500, out)).toBe(0);
  });
});

describe('SpatialHash Dying / Invuln / Phased filtering', () => {
  it('queryCircle skips Dying rows (flagged before or after the rebuild) and reports size without them', () => {
    const e = new EnemyStore(16);
    const a = addBody(e, { x: 0, z: 0, radius: 0.5 });
    const b = addBody(e, { x: 1, z: 0, radius: 0.5, state: EnemyState.Dying });
    const c = addBody(e, { x: 2, z: 0, radius: 0.5 });
    const hash = newHash();
    const out = new Int32Array(16);
    hash.rebuild(e);
    expect(hash.size).toBe(2);
    expect(sortedRows(out, hash.queryCircle(e, 1, 0, 3, out))).toEqual([a, c]);
    // killed after the rebuild within the same tick: still filtered at query time
    e.state[c] = EnemyState.Dying;
    expect(sortedRows(out, hash.queryCircle(e, 1, 0, 3, out))).toEqual([a]);
    expect(b).toBe(1);
  });

  it('Invuln and Phased rows are skipped by default; includeInvuln=true returns invulnerable rows', () => {
    const e = new EnemyStore(16);
    const normal = addBody(e, { x: 0, z: 0, radius: 0.5 });
    const invuln = addBody(e, { x: 1, z: 0, radius: 0.5, flags: EnemyFlag.Invuln });
    const phased = addBody(e, { x: 2, z: 0, radius: 0.5, flags: EnemyFlag.Phased });
    const metin = addBody(e, { x: 3, z: 0, radius: 0.5, flags: EnemyFlag.Metin | EnemyFlag.Invuln | EnemyFlag.Pinned });
    const hash = newHash();
    const out = new Int32Array(16);
    hash.rebuild(e);
    expect(sortedRows(out, hash.queryCircle(e, 1.5, 0, 5, out))).toEqual([normal]);
    expect(sortedRows(out, hash.queryCircle(e, 1.5, 0, 5, out, false))).toEqual([normal]);
    const inc = sortedRows(out, hash.queryCircle(e, 1.5, 0, 5, out, true));
    expect(inc).toContain(normal);
    expect(inc).toContain(invuln);
    expect(inc).toContain(metin);
    expect(phased).toBe(2);
  });

  it('includeInvuln never resurrects Dying rows', () => {
    const e = new EnemyStore(16);
    addBody(e, { x: 0, z: 0, radius: 0.5, flags: EnemyFlag.Invuln, state: EnemyState.Dying });
    const alive = addBody(e, { x: 0.5, z: 0, radius: 0.5, flags: EnemyFlag.Invuln });
    const hash = newHash();
    const out = new Int32Array(16);
    hash.rebuild(e);
    expect(sortedRows(out, hash.queryCircle(e, 0, 0, 3, out, true))).toEqual([alive]);
  });

  it('filters match brute force on clouds with Dying / Invuln / Phased rows mixed in', () => {
    const rng = new Rng(41);
    const e = makeCloud(rng, { n: 500, radius: [0.3, 1.2], dying: 0.12, invuln: 0.1, phased: 0.06 });
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(CAP.enemies);
    for (let q = 0; q < 300; q++) {
      const x = rng.range(-ARENA, ARENA);
      const z = rng.range(-ARENA, ARENA);
      const r = rng.range(0.5, 9);
      const got = sortedRows(out, hash.queryCircle(e, x, z, r, out));
      const want = bruteCircle(e, x, z, r, false);
      if (got.join() !== want.join()) throw new Error(`query ${q}: got [${got}] want [${want}]`);
    }
  });
});

describe('SpatialHash.nearest', () => {
  it('returns the closest hittable row, or -1 when nothing is in range', () => {
    const e = new EnemyStore(16);
    const near = addBody(e, { x: 2, z: 0, radius: 0 });
    addBody(e, { x: 5, z: 0, radius: 0 });
    addBody(e, { x: -4, z: 4, radius: 0 });
    const hash = newHash();
    hash.rebuild(e);
    expect(hash.nearest(e, 0, 0, 10)).toBe(near);
    expect(hash.nearest(e, 0, 0, 1.5)).toBe(-1);
    expect(hash.nearest(e, 100, 100, 10)).toBe(-1);
  });

  it('skips Dying, Invuln and Phased rows', () => {
    const e = new EnemyStore(16);
    addBody(e, { x: 1, z: 0, radius: 0.5, state: EnemyState.Dying });
    addBody(e, { x: 1.5, z: 0, radius: 0.5, flags: EnemyFlag.Invuln });
    addBody(e, { x: 2, z: 0, radius: 0.5, flags: EnemyFlag.Phased });
    const ok = addBody(e, { x: 6, z: 0, radius: 0.5 });
    const hash = newHash();
    hash.rebuild(e);
    expect(hash.nearest(e, 0, 0, 10)).toBe(ok);
    e.state[ok] = EnemyState.Dying; // killed after the rebuild
    expect(hash.nearest(e, 0, 0, 10)).toBe(-1);
  });

  it('skipHandle excludes that enemy (chain jumps do not hit the source again)', () => {
    const e = new EnemyStore(16);
    const a = addBody(e, { x: 1, z: 0, radius: 0 });
    const b = addBody(e, { x: 3, z: 0, radius: 0 });
    const hash = newHash();
    hash.rebuild(e);
    expect(hash.nearest(e, 0, 0, 10)).toBe(a);
    expect(hash.nearest(e, 0, 0, 10, e.id[a] as number)).toBe(b);
    expect(hash.nearest(e, 0, 0, 10, 0)).toBe(a);
  });

  it('matches brute force on random clouds of point-like bodies', () => {
    const rng = new Rng(51);
    const e = makeCloud(rng, { n: 500, radius: [0, 0], dying: 0.1, invuln: 0.1, phased: 0.05 });
    const hash = newHash();
    hash.rebuild(e);
    for (let q = 0; q < 500; q++) {
      const x = rng.range(-ARENA, ARENA);
      const z = rng.range(-ARENA, ARENA);
      const r = rng.range(0.5, 14);
      expect(hash.nearest(e, x, z, r)).toBe(bruteNearest(e, x, z, r));
    }
  });

  it('measures distance to the BODY EDGE: a big body whose rim is within r is a candidate', () => {
    // centre 4.5 m away, radius 1.5 → edge 3.0 m away, which is within r = 3.2
    const e = new EnemyStore(8);
    const big = addBody(e, { x: 4.5, z: 0, radius: 1.5 });
    const hash = newHash();
    hash.rebuild(e);
    expect(hash.nearest(e, 0, 0, 3.2)).toBe(big);
    expect(hash.nearest(e, 0, 0, 2.9)).toBe(-1);
  });

  it('ranks candidates by distance to the body edge, not by centre distance', () => {
    // A: centre 3.0, radius 0.4 → edge gap 2.6;  B: centre 2.9, radius 0.1 → edge gap 2.8
    const e = new EnemyStore(8);
    const bulky = addBody(e, { x: 0, z: 3.0, radius: 0.4 });
    addBody(e, { x: 2.9, z: 0, radius: 0.1 });
    const hash = newHash();
    hash.rebuild(e);
    expect(hash.nearest(e, 0, 0, 10)).toBe(bulky);
  });

  it('matches brute force on random clouds with realistic body radii', () => {
    const rng = new Rng(52);
    const e = makeCloud(rng, { n: 500, radius: [0.3, 1.6], dying: 0.1, invuln: 0.1, phased: 0.05 });
    const hash = newHash();
    hash.rebuild(e);
    let mismatches = 0;
    for (let q = 0; q < 500; q++) {
      const x = rng.range(-ARENA, ARENA);
      const z = rng.range(-ARENA, ARENA);
      const r = rng.range(0.5, 14);
      if (hash.nearest(e, x, z, r) !== bruteNearest(e, x, z, r)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('SpatialHash.neighbours', () => {
  const origin = -(ARENA + PAD);
  const dim = Math.ceil((2 * (ARENA + PAD)) / CELL) + 1;
  const cell = (v: number): number => Math.min(dim - 1, Math.max(0, Math.floor((v - origin) / CELL)));

  it('returns exactly the non-dying rows in the 3×3 cells around the point', () => {
    const rng = new Rng(61);
    const e = makeCloud(rng, { n: 500, radius: [0.3, 1.0], dying: 0.1, invuln: 0.1 });
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(CAP.enemies);
    let total = 0;
    for (let q = 0; q < 300; q++) {
      const x = rng.range(-ARENA, ARENA);
      const z = rng.range(-ARENA, ARENA);
      const got = sortedRows(out, hash.neighbours(x, z, out));
      const qx = cell(x);
      const qz = cell(z);
      const want: number[] = [];
      for (let i = 0; i < e.count; i++) {
        if (e.state[i] === EnemyState.Dying) continue;
        if (Math.abs(cell(e.x[i] as number) - qx) <= 1 && Math.abs(cell(e.z[i] as number) - qz) <= 1) want.push(i);
      }
      total += want.length;
      if (got.join() !== want.join()) throw new Error(`query ${q}: got [${got}] want [${want}]`);
    }
    expect(total).toBeGreaterThan(100);
  });

  it('every enemy within one cell width of the point is returned (separation never misses a touching body)', () => {
    const rng = new Rng(62);
    const e = makeCloud(rng, { n: 500, radius: [0.3, 1.0] });
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(CAP.enemies);
    for (let q = 0; q < 300; q++) {
      const row = rng.int(e.count);
      const x = (e.x[row] as number) + rng.range(-1, 1);
      const z = (e.z[row] as number) + rng.range(-1, 1);
      const got = new Set(Array.from(out.subarray(0, hash.neighbours(x, z, out))));
      for (let i = 0; i < e.count; i++) {
        const d = Math.hypot((e.x[i] as number) - x, (e.z[i] as number) - z);
        if (d <= CELL && !got.has(i)) throw new Error(`row ${i} at ${d.toFixed(2)} m missing from neighbours of (${x.toFixed(2)},${z.toFixed(2)})`);
      }
    }
  });

  it('includes the row itself, ignores Dying rows and respects the out buffer', () => {
    const e = new EnemyStore(32);
    const self = addBody(e, { x: 5, z: 5, radius: 0.5 });
    addBody(e, { x: 5.5, z: 5, radius: 0.5, state: EnemyState.Dying });
    for (let i = 0; i < 10; i++) addBody(e, { x: 5 + i * 0.1, z: 5.2, radius: 0.5 });
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(32);
    const n = hash.neighbours(5, 5, out);
    expect(n).toBe(11);
    expect(Array.from(out.subarray(0, n))).toContain(self);
    expect(Array.from(out.subarray(0, n))).not.toContain(1);
    expect(hash.neighbours(5, 5, new Int32Array(4))).toBe(4);
  });

  it('does not throw at the grid corners', () => {
    const e = new EnemyStore(8);
    addBody(e, { x: -ARENA, z: -ARENA, radius: 0.5 });
    addBody(e, { x: ARENA, z: ARENA, radius: 0.5 });
    const hash = newHash();
    hash.rebuild(e);
    const out = new Int32Array(8);
    expect(hash.neighbours(-ARENA, -ARENA, out)).toBe(1);
    expect(hash.neighbours(ARENA, ARENA, out)).toBe(1);
    expect(hash.neighbours(-1e4, -1e4, out)).toBeGreaterThanOrEqual(0);
    expect(hash.neighbours(1e4, 1e4, out)).toBeGreaterThanOrEqual(0);
  });
});

describe('SpatialHash inside a live World', () => {
  it('is rebuilt every step: spawned enemies are queryable, Dying ones are not, swept rows vanish', () => {
    const w = makeWorld();
    freezeSchedules(w);
    clearEnemies(w);
    dropSkills(w);
    const a = spawn(w, 'wolf', 6, 0);
    spawn(w, 'jackal', -6, 3);
    const handleA = w.enemies.id[a] as number;
    w.step([NO_INPUT]);
    const out = new Int32Array(64);
    const ra = w.enemies.find(handleA);
    expect(w.hash.size).toBe(2);
    expect(w.hash.queryCircle(w.enemies, 6, 0, 2, out)).toBe(1);
    expect(out[0]).toBe(ra);
    expect(w.hash.nearest(w.enemies, 0, 0, 30)).toBeGreaterThanOrEqual(0);
    w.enemies.state[ra] = EnemyState.Dying;
    expect(w.hash.queryCircle(w.enemies, 6, 0, 2, out)).toBe(0);
    w.step([NO_INPUT]); // sweepDead removes the Dying row at the end of the tick
    expect(w.enemies.find(handleA)).toBe(-1);
    expect(w.enemies.count).toBe(1);
    expect(w.hash.size).toBe(1);
  });
});
