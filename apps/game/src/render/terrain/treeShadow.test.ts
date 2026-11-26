import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Euler, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import type { BiomePreset } from '../../data/schema';
import { cpuNow, withinBudget } from '../../dev/perfBudget';
import type { TreePlacement } from '../../world/layoutTypes';
import { createTerrainField } from '../../world/terrainField';
import { bakeLight } from './bakeLight';
import { eulerYXZ, proceduralLeafMask, rasterTreeShadows, smoothBytes, type FoliageMask } from './treeShadow';

// zones core B1: tree shadows from the crown silhouette. Fast unit tests on a flat 64 m patch, plus one whole-zone bake.
const HANG_GUARD_MS = 60_000;
const SUN = { x: -0.6, y: 0.75, z: -0.25 };

function tree(over: Partial<TreePlacement> = {}): TreePlacement {
  return { species: 'broadleaf', x: 0, z: 0, y: 0, scale: 1, yaw: 0.3, seed: 7, ...over };
}

function raster(trees: TreePlacement[], o: { res?: number; size?: number; strength?: number; masks?: Parameters<typeof rasterTreeShadows>[0]['masks'] } = {}): { out: Uint8Array; res: number; size: number } {
  const res = o.res ?? 512;
  const size = o.size ?? 64;
  const out = rasterTreeShadows({ trees, style: { snowy: false }, sun: SUN, size, res, heightAt: () => 0, strength: o.strength ?? 0.62, masks: o.masks });
  return { out, res, size };
}

function stats(buf: Uint8Array, res: number, size: number): { area: number; cx: number; cz: number; max: number } {
  let n = 0;
  let sx = 0;
  let sz = 0;
  let max = 0;
  const k = size / res;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const v = buf[j * res + i] as number;
      if (v === 0) continue;
      n += v;
      sx += v * ((i + 0.5) * k - size / 2);
      sz += v * ((j + 0.5) * k - size / 2);
      if (v > max) max = v;
    }
  }
  return { area: (n / 255) * k * k, cx: sx / Math.max(1, n), cz: sz / Math.max(1, n), max };
}

/** greyscale PNG of a byte buffer (white = lit, black = shadow) for eyeballing; written only when TREE_SHADOW_DUMP names a folder */
function dumpPng(file: string, buf: Uint8Array, res: number): void {
  const dir = process.env.TREE_SHADOW_DUMP;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const raw = Buffer.alloc((res + 1) * res);
  for (let j = 0; j < res; j++) {
    raw[j * (res + 1)] = 0;
    for (let i = 0; i < res; i++) raw[j * (res + 1) + 1 + i] = 255 - (buf[j * res + i] as number);
  }
  const crc = (b: Buffer): number => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(res, 0);
  ihdr.writeUInt32BE(res, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  writeFileSync(join(dir, file), png);
}

describe('eulerYXZ', () => {
  it("is three's rotation for Euler order 'YXZ' (the tree system's instance rotation)", () => {
    for (const [rx, ry, rz] of [
      [0, 0, 0],
      [0.03, 1.2, -0.02],
      [-0.035, 4.1, 0.035],
      [0.2, -2.5, 0.4],
    ] as const) {
      const m = new Matrix4().makeRotationFromEuler(new Euler(rx, ry, rz, 'YXZ'));
      const mine = eulerYXZ(rx, ry, rz);
      // Matrix4.elements is column-major; `mine` is row-major
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) expect(mine[r * 3 + c] as number).toBeCloseTo(m.elements[c * 4 + r] as number, 10);
    }
  });
});

describe('rasterTreeShadows', () => {
  it('throws the crown shadow away from the sun, at the right size, with a trunk shadow from the foot', () => {
    const { out, res, size } = raster([tree()]);
    const st = stats(out, res, size);
    // the sun is towards -x / -z: the shadow lies at +x / +z of the trunk, further out than the trunk
    expect(st.cx).toBeGreaterThan(2);
    expect(st.cz).toBeGreaterThan(0.5);
    expect(st.cz / st.cx).toBeGreaterThan(0.25);
    expect(st.cz / st.cx).toBeLessThan(0.75);
    // a 7.5 m broadleaf with a ~3.4 m crown radius: tens of square metres of shadow, not a few, not a field
    expect(st.area).toBeGreaterThan(12);
    expect(st.area).toBeLessThan(80);
    // the darkest texel is the strength asked for
    expect(st.max).toBeLessThanOrEqual(Math.round(0.62 * 255));
    expect(st.max).toBeGreaterThan(0.5 * 255);
    // the trunk's foot casts a shadow too (a texel right next to the base is dark)
    const k = res / size;
    const foot = out[Math.floor((0.35 + size / 2) * k) * res + Math.floor((0.2 + size / 2) * k)] as number;
    expect(foot).toBeGreaterThan(0);
    dumpPng('single_broadleaf.png', out, res);
  });

  it('has the crown outline of the leaves (ragged), not a smooth blob', () => {
    const { out, res, size } = raster([tree()]);
    // perimeter / sqrt(area): a disc has 2 sqrt(pi) = 3.54; the lobed leaf cloud is clearly longer
    let edge = 0;
    let area = 0;
    for (let j = 1; j < res - 1; j++) {
      for (let i = 1; i < res - 1; i++) {
        const v = (out[j * res + i] as number) > 60 ? 1 : 0;
        if (!v) continue;
        area++;
        if ((out[j * res + i - 1] as number) <= 60 || (out[j * res + i + 1] as number) <= 60 || (out[(j - 1) * res + i] as number) <= 60 || (out[(j + 1) * res + i] as number) <= 60) edge++;
      }
    }
    const k = size / res;
    expect((edge * k) / Math.sqrt(area * k * k)).toBeGreaterThan(5);
  });

  it('is deterministic and scales with the tree', () => {
    const a = raster([tree()]);
    const b = raster([tree()]);
    expect(Buffer.from(a.out).equals(Buffer.from(b.out))).toBe(true);
    const big = stats(raster([tree({ scale: 1.5 })]).out, 512, 64);
    const small = stats(a.out, 512, 64);
    expect(big.area).toBeGreaterThan(small.area * 1.5);
    // the same tree elsewhere throws the same shadow, shifted
    const shifted = stats(raster([tree({ x: 10, z: -6 })]).out, 512, 64);
    expect(shifted.area).toBeCloseTo(small.area, 0);
    expect(shifted.cx - small.cx).toBeCloseTo(10, 0);
    expect(shifted.cz - small.cz).toBeCloseTo(-6, 0);
  });

  it('uses the foliage card alpha: an empty mask leaves only the trunk and branches', () => {
    const empty: FoliageMask = { size: 8, data: new Uint8Array(64) };
    const full: FoliageMask = { size: 8, data: new Uint8Array(64).fill(255) };
    const none = stats(raster([tree()], { masks: { broadleaf: [empty, empty] } }).out, 512, 64);
    const solid = stats(raster([tree()], { masks: { broadleaf: [full, full] } }).out, 512, 64);
    const dflt = stats(raster([tree()]).out, 512, 64);
    expect(none.area).toBeLessThan(dflt.area * 0.4);
    expect(solid.area).toBeGreaterThan(dflt.area);
  });

  it('species strength multiplies the darkness; strength 0 draws nothing', () => {
    const half = stats(raster([tree({ species: 'bare' })], { strength: 0.5 }).out, 512, 64);
    const full = stats(raster([tree({ species: 'bare' })], { strength: 1 }).out, 512, 64);
    expect(full.max).toBeGreaterThan(half.max * 1.5);
    const nothing = raster([tree()], { strength: 0 });
    expect(stats(nothing.out, 512, 64).max).toBe(0);
  });

  it('a slope under the tree moves the shadow along it (up-slope the shadow is shorter)', () => {
    const flat = stats(raster([tree()]).out, 512, 64);
    // ground rises 0.3 m per metre towards +x: the shadow falls towards +x, so it lands on rising ground and is shorter
    const up = rasterTreeShadows({ trees: [tree()], style: { snowy: false }, sun: SUN, size: 64, res: 512, heightAt: (x) => 0.3 * x, strength: 0.62 });
    const sUp = stats(up, 512, 64);
    expect(sUp.cx).toBeLessThan(flat.cx);
  });

  it('procedural leaf masks are ragged blobs with holes', () => {
    const m = proceduralLeafMask(11);
    let solid = 0;
    let part = 0;
    for (const v of m.data) {
      if (v > 200) solid++;
      else if (v > 0) part++;
    }
    expect(solid).toBeGreaterThan(m.data.length * 0.2);
    expect(solid).toBeLessThan(m.data.length * 0.8);
    expect(part).toBeGreaterThan(20);
  });

  it('smoothBytes softens edges but keeps the total', () => {
    const b = new Uint8Array(16 * 16);
    for (let j = 4; j < 12; j++) for (let i = 4; i < 12; i++) b[j * 16 + i] = 200;
    const sum0 = b.reduce((s, v) => s + v, 0);
    smoothBytes(b, 16, 1);
    const sum1 = b.reduce((s, v) => s + v, 0);
    expect(Math.abs(sum1 - sum0) / sum0).toBeLessThan(0.02);
    expect(b[8 * 16 + 3]).toBeGreaterThan(0);
    expect(b[8 * 16 + 8]).toBe(200);
  });
});

function biome(id: string): BiomePreset {
  return {
    id,
    seed: 77,
    ground: [],
    trees: [],
    props: [],
    fog: { color: '#aabbcc', near: 40, far: 160 },
    sky: { top: '#223344', horizon: '#aabbcc', bottom: '#556677' },
    sun: { color: '#fff1d6', intensity: 2.4, dir: [-0.4, 0.8, 0.45] },
    ambient: { sky: '#bcd0ff', ground: '#4a3b2a', intensity: 0.8 },
    relief: { height: 20, roughness: 0.5, features: [] },
  };
}

describe('bakeLight with tree silhouettes (B1)', () => {
  it('replaces the capsule: dark crown shadows, same default output without the option', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: -0.6, y: 0.75, z: -0.25 };
    const plain = bakeLight(field, sun, 512);
    const again = bakeLight(field, sun, 512, { trees: undefined });
    expect(Buffer.from(again.data).equals(Buffer.from(plain.data))).toBe(true);
    const res = 1024;
    const b = withinBudget(
      () => {
        const t1 = cpuNow();
        const v = bakeLight(field, sun, res, { soft: 0.5, trees: { style: { snowy: false }, strength: 0.62 } });
        return { value: v, ms: cpuNow() - t1 };
      },
      // 1 m terrain grid + crown rasterisation of ~190 trees: ~0.5 s of CPU; an accidental per-texel tree scan would be many seconds
      { baseMs: 6000 },
    );
    expect(b.ms, b.log).toBeLessThanOrEqual(b.budget);
    const baked = b.value;
    expect(baked.res).toBe(res);
    expect(baked.data.length).toBe(res * res * 4);
    // tree shadows: the sun visibility inside a crown shadow is the strength asked for, the lit ground stays at 255
    let dark = 0;
    let lit = 0;
    const R = new Uint8Array(res * res);
    for (let o = 0; o < res * res; o++) {
      const v = baked.data[o * 4] as number;
      R[o] = 255 - v;
      if (v < 130) dark++;
      if (v > 245) lit++;
    }
    expect(dark).toBeGreaterThan(300);
    expect(lit).toBeGreaterThan(res * res * 0.3);
    dumpPng('yeonmu_vis.png', R, res);
    // a second bake is identical
    const again2 = bakeLight(field, sun, res, { soft: 0.5, trees: { style: { snowy: false }, strength: 0.62 } });
    expect(Buffer.from(again2.data).equals(Buffer.from(baked.data))).toBe(true);
  }, HANG_GUARD_MS);

  it('`others` scales every non-tree baked shadow (terrain horizon, rocks, props) and leaves the crowns alone', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: -0.6, y: 0.75, z: -0.25 };
    // strength 0 draws no crown at all, so the map is only the other shadows
    const full = bakeLight(field, sun, 512, { trees: { style: { snowy: false }, strength: 0 } });
    const half = bakeLight(field, sun, 512, { trees: { style: { snowy: false }, strength: 0, others: 0.5 } });
    let n = 0;
    for (let o = 0; o < 512 * 512; o++) {
      const a = 255 - (full.data[o * 4] as number);
      const b = 255 - (half.data[o * 4] as number);
      if (a > 20) n++;
      expect(Math.abs(b - a * 0.5)).toBeLessThanOrEqual(1.01);
    }
    expect(n).toBeGreaterThan(500);
    // with crowns on, the crown darkness is the same whatever `others` says
    const t1 = bakeLight(field, sun, 512, { trees: { style: { snowy: false }, strength: 0.7 } });
    const t0 = bakeLight(field, sun, 512, { trees: { style: { snowy: false }, strength: 0.7, others: 0 } });
    let crown = 0;
    for (let o = 0; o < 512 * 512; o++) {
      const v = t0.data[o * 4] as number;
      if (v < 255) crown++;
      expect(v).toBeGreaterThanOrEqual(t1.data[o * 4] as number); // others 0 can only lighten
    }
    expect(crown).toBeGreaterThan(300);
  }, HANG_GUARD_MS);

  it('a finer light map keeps the terrain channels and only sharpens the crowns', () => {
    const field = createTerrainField(biome('yeonmu'));
    const sun = { x: -0.6, y: 0.75, z: -0.25 };
    const lo = bakeLight(field, sun, 1024, { soft: 0.5, trees: { style: { snowy: false } } });
    const hi = bakeLight(field, sun, 2048, { soft: 0.5, trees: { style: { snowy: false } } });
    expect(hi.res).toBe(2048);
    expect(hi.data.length).toBe(2048 * 2048 * 4);
    // the liquid proximity (B) and the AO (G) are the same maps at both resolutions: compare 2x2 block means
    let dG = 0;
    let dB = 0;
    for (let j = 0; j < 1024; j += 4) {
      for (let i = 0; i < 1024; i += 4) {
        const a = (j * 1024 + i) * 4;
        let g = 0;
        let b = 0;
        for (let dj = 0; dj < 2; dj++) {
          for (let di = 0; di < 2; di++) {
            const h = ((2 * j + dj) * 2048 + 2 * i + di) * 4;
            g += hi.data[h + 1] as number;
            b += hi.data[h + 2] as number;
          }
        }
        dG += Math.abs(g / 4 - (lo.data[a + 1] as number));
        dB += Math.abs(b / 4 - (lo.data[a + 2] as number));
      }
    }
    const cells = 256 * 256;
    expect(dG / cells).toBeLessThan(2.5);
    expect(dB / cells).toBeLessThan(2.5);
  }, HANG_GUARD_MS);
});
