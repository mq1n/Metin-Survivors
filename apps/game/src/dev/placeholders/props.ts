// DEV-only: static prop / tree placeholders — faceted mossy rocks, scalloped layered pines, lumpy oaks, a Korean stone
// lantern, a gravestone. Authoring: origin at the ground centre. Budget: instanced ones ≲ 800 tris.
import type { BufferGeometry } from 'three';
import type { PlaceholderModel } from '../../engine/assets';
import { buildMesh } from './mesher';
import { assembleModel } from './model';
import { MeshBuilder, type ColorFn, type Section } from './parts';
import { Rng, clamp, noise3, smoothstep, type RGB, type Vec3 } from './math';
import { Shape, rgb } from './sdf';

const TAU = Math.PI * 2;

function shade(c: string | RGB, k: number): RGB {
  const v = rgb(c);
  return [Math.min(1, v[0] * k), Math.min(1, v[1] * k), Math.min(1, v[2] * k)];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Outward-facing band between two rings (counter-clockwise by angle in XZ), lower ring first. */
function band(b: MeshBuilder, lo: Vec3[], hi: Vec3[], color: ColorFn, down = false): void {
  const n = lo.length;
  for (let j = 0; j < n; j++) {
    const j2 = (j + 1) % n;
    const a = lo[j] as Vec3;
    const a2 = lo[j2] as Vec3;
    const c = hi[j] as Vec3;
    const c2 = hi[j2] as Vec3;
    if (down) b.quad(a, a2, c2, c, color);
    else b.quad(a, c, c2, a2, color);
  }
}

function ringAt(n: number, y: number, radius: (j: number, th: number) => number, yOff?: (j: number, th: number) => number, phase = 0): Vec3[] {
  return Array.from({ length: n }, (_, j) => {
    const th = phase + (j / n) * TAU;
    const r = radius(j, th);
    return [Math.cos(th) * r, y + (yOff ? yOff(j, th) : 0), Math.sin(th) * r] as Vec3;
  });
}

function rock(seed: number, scale: number): { geometry: BufferGeometry; height: number } {
  const rng = new Rng(seed);
  const shape = new Shape();
  const cell = 0.115 * scale;
  shape.minRadius = cell * 0.6;
  const stone = ['#7b7a76', '#6f7076', '#857d72', '#6c7378'][rng.int(4)] as string;
  const n = 3 + rng.int(3);
  for (let i = 0; i < n; i++) {
    const c: Vec3 = [rng.range(-0.45, 0.45) * scale, rng.range(0.25, 0.55) * scale, rng.range(-0.35, 0.35) * scale];
    const h: Vec3 = [rng.range(0.4, 0.75) * scale, rng.range(0.28, 0.5) * scale, rng.range(0.35, 0.65) * scale];
    shape.box(0, c, h, 0.16 * scale, { k: 0.18 * scale, color: stone, rot: [rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(-0.4, 0.4)] });
  }
  shape.rough = { amp: 0.05 * scale, scale: 3.2 / scale, seed };
  const mesh = buildMesh(shape, {
    cell,
    boneCount: 0,
    tau: 0.06,
    seed,
    flat: true,
    shade: {
      back: 0.75,
      backColor: rgb('#5c7a3a'),
      noise: 0.3,
      noiseScale: 5 / scale,
      ao: 0.7,
      aoRadius: 0.3 * scale,
      aoTint: [0.45, 0.43, 0.48],
    },
  });
  return { geometry: mesh.geometry, height: mesh.max[1] };
}

function pine(seed: number): MeshBuilder {
  const rng = new Rng(seed);
  const b = new MeshBuilder();
  const bark = rgb('#5a3f2a');
  const bark2 = rgb('#3e2b1d');
  // trunk
  const trunk: [number, number][] = [[0.3, 0], [0.19, 0.25], [0.14, 0.9], [0.11, 2.2], [0.08, 3.9], [0.03, 4.6]];
  b.lathe(trunk, 8, {
    color: (p, _n, _i, j) => {
      const k = j % 2 ? 0.8 : 1;
      const c = mix(bark, bark2, noise3(p[0] * 6, p[1] * 1.2, p[2] * 6, seed));
      return [c[0] * k, c[1] * k, c[2] * k];
    },
    capStart: true,
  });
  const tiers = 6;
  for (let t = 0; t < tiers; t++) {
    const baseY = 1.05 + t * 0.62;
    const R = (1.7 - t * 0.2) * rng.range(0.93, 1.07);
    const h = 1.25 - t * 0.04;
    const N = 12;
    const th0 = rng.range(0, TAU);
    const jag = Array.from({ length: N }, (_, j) => (j % 2 ? 0.8 : 1.08) * rng.range(0.88, 1.1));
    const hem = ringAt(N, baseY, (j) => R * (jag[j] as number), (j) => -0.22 * (jag[j] as number) + (j % 2 ? 0.12 : 0), th0);
    const mid = ringAt(N, baseY + h * 0.42, (j) => R * 0.55 * (0.9 + 0.2 * ((j * 7) % 3) / 2), () => 0, th0 + 0.2);
    const top = ringAt(N, baseY + h, () => 0.1, () => 0, th0);
    const inner = ringAt(N, baseY + 0.2, () => 0.24, () => 0, th0);
    const deep = rgb('#15301f');
    const mid1 = rgb('#24502d');
    const tip = rgb('#4b8a3a');
    band(b, hem, mid, (p) => {
      const k = smoothstep(baseY - 0.2, baseY + h * 0.4, p[1]);
      const n = 0.85 + 0.3 * noise3(p[0] * 2, p[1] * 2, p[2] * 2, seed + t);
      const c = mix(tip, mid1, k);
      return [c[0] * n, c[1] * n, c[2] * n];
    });
    band(b, mid, top, (p) => {
      const n = 0.8 + 0.4 * noise3(p[0] * 3, p[1] * 3, p[2] * 3, seed + t);
      return [mid1[0] * n * 1.05, mid1[1] * n * 1.1, mid1[2] * n];
    });
    band(b, inner, hem, () => deep, true);
  }
  // leader tip
  b.lathe([[0.1, 4.55], [0.05, 4.85], [0.001, 5.15]], 6, { color: '#3f7a35' });
  return b;
}

function blob(b: MeshBuilder, c: Vec3, r: Vec3, seed: number, base: RGB, light: RGB, segs = 10, rings = 6): void {
  const pts: Vec3[][] = [];
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * Math.PI;
    const y = -Math.cos(a);
    const rr = Math.sin(a);
    const row: Vec3[] = [];
    for (let j = 0; j < segs; j++) {
      const th = (j / segs) * TAU;
      const n = 0.82 + 0.36 * noise3(Math.cos(th) * 1.6 + c[0], y * 1.6 + c[1], Math.sin(th) * 1.6 + c[2], seed);
      row.push([c[0] + Math.cos(th) * rr * r[0] * n, c[1] + y * r[1] * n * (i === 0 || i === rings ? 1 : 1), c[2] + Math.sin(th) * rr * r[2] * n]);
    }
    pts.push(row);
  }
  const col: ColorFn = (p, n) => {
    const up = smoothstep(-0.3, 0.9, n[1]);
    const k = 0.85 + 0.3 * noise3(p[0] * 3, p[1] * 3, p[2] * 3, seed + 5);
    const cc = mix(base, light, up);
    return [cc[0] * k, cc[1] * k, cc[2] * k];
  };
  for (let i = 0; i < rings; i++) {
    const lo = pts[i] as Vec3[];
    const hi = pts[i + 1] as Vec3[];
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      b.quad(lo[j] as Vec3, hi[j] as Vec3, hi[j2] as Vec3, lo[j2] as Vec3, col);
    }
  }
}

function oak(seed: number): MeshBuilder {
  const rng = new Rng(seed);
  const b = new MeshBuilder();
  const bark = rgb('#5b4330');
  b.lathe([[0.42, 0], [0.26, 0.35], [0.2, 1.1], [0.17, 2.0], [0.12, 2.6]], 8, { color: (p) => shade(bark, 0.8 + 0.4 * noise3(p[0] * 8, p[1] * 1.5, p[2] * 8, seed)), capStart: true });
  const green = rgb('#2f6a2c');
  const lime = rgb('#6fa83c');
  const dark = rgb('#1f4a22');
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng.range(-0.3, 0.3);
    const rr = i === n - 1 ? 0 : rng.range(0.9, 1.4);
    const c: Vec3 = [Math.cos(a) * rr, 2.9 + rng.range(-0.1, 0.7) + (i === n - 1 ? 0.7 : 0), Math.sin(a) * rr];
    const s = rng.range(1.0, 1.35);
    blob(b, c, [s, s * 0.82, s], seed + i * 13, i % 2 ? dark : green, lime);
  }
  return b;
}

function bush(seed: number): MeshBuilder {
  const rng = new Rng(seed);
  const b = new MeshBuilder();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + rng.range(0, 1);
    const c: Vec3 = [Math.cos(a) * 0.35, 0.38 + rng.range(0, 0.12), Math.sin(a) * 0.35];
    const s = rng.range(0.42, 0.58);
    blob(b, c, [s, s * 0.8, s], seed + i * 7, rgb('#2c5a2a'), rgb('#74a63e'), 9, 5);
  }
  blob(b, [0, 0.55, 0], [0.5, 0.45, 0.5], seed + 99, rgb('#2c5a2a'), rgb('#7fb046'), 9, 5);
  return b;
}

function lantern(seed: number): MeshBuilder {
  const b = new MeshBuilder();
  const stone = rgb('#8d8b86');
  const stoneD = rgb('#5f5f62');
  const moss = rgb('#5d7c3a');
  const st: ColorFn = (p, n) => {
    const k = 0.85 + 0.3 * noise3(p[0] * 9, p[1] * 9, p[2] * 9, seed);
    const m = smoothstep(0.35, 0.05, p[1]) * smoothstep(0.1, 0.8, noise3(p[0] * 5, p[1] * 5, p[2] * 5, seed + 3));
    const c = mix(stone, moss, m * 0.7 + (n[1] > 0.7 ? 0.0 : 0));
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  b.box([0, 0.06, 0], [0.34, 0.06, 0.34], 0.025, st);
  b.lathe([[0.2, 0.12], [0.17, 0.16], [0.13, 0.24], [0.1, 0.27]], 8, { color: st });
  b.lathe([[0.075, 0.27], [0.065, 0.45], [0.065, 0.75], [0.08, 0.8]], 8, { color: st });
  for (const y of [0.4, 0.58]) b.lathe([[0.065, y - 0.02], [0.09, y], [0.065, y + 0.02]], 8, { color: st });
  b.lathe([[0.1, 0.8], [0.2, 0.84], [0.22, 0.9], [0.18, 0.92]], 8, { color: st });
  // fire box with glowing paper windows on four sides
  b.box([0, 1.03, 0], [0.14, 0.12, 0.14], 0.016, st);
  const glowC = rgb('#ffd27a');
  const glowD = rgb('#e8993a');
  for (const [dx, dz, w, d] of [[0, 0.142, 0.075, 0.008], [0, -0.142, 0.075, 0.008], [0.142, 0, 0.008, 0.075], [-0.142, 0, 0.008, 0.075]] as const) {
    b.box([dx, 1.03, dz], [w, 0.075, d], 0.004, (p) => mix(glowD, glowC, smoothstep(0.95, 1.08, p[1])));
  }
  // roof
  const corner = 0.4;
  const roofRing = (y: number, k: number, up: number): Vec3[] => {
    const pts: Vec3[] = [];
    for (let j = 0; j < 8; j++) {
      const th = (j / 8) * TAU + Math.PI / 8;
      const isCorner = j % 2 === 0;
      const r = (isCorner ? corner : 0.27) * k;
      pts.push([Math.cos(th) * r, y + (isCorner ? up : 0), Math.sin(th) * r]);
    }
    return pts;
  };
  const dk = shade('#4b4c52', 1);
  const dkL = shade('#6e6f76', 1);
  const r0 = roofRing(1.14, 1, 0.075);
  const r1 = roofRing(1.2, 0.7, 0.03);
  const r2 = roofRing(1.3, 0.3, 0);
  const r3 = roofRing(1.36, 0.08, 0);
  const rc: ColorFn = (p) => mix(dk, dkL, clamp((p[1] - 1.14) / 0.25, 0, 1));
  band(b, r0, r1, rc);
  band(b, r1, r2, rc);
  band(b, r2, r3, rc);
  band(b, roofRing(1.13, 0.22, 0), r0, () => stoneD, true);
  b.lathe([[0.001, 1.34], [0.05, 1.37], [0.065, 1.42], [0.05, 1.47], [0.02, 1.52], [0.001, 1.58]], 8, { color: '#a79f8c' });
  return b;
}

function gravestone(seed: number): MeshBuilder {
  const b = new MeshBuilder();
  const stone = rgb('#8b8a88');
  const moss = rgb('#5d7c3a');
  const W = 0.34;
  const H = 0.62;
  const prof: [number, number][] = [[W, 0], [W, H]];
  for (let i = 1; i < 10; i++) {
    const a = (i / 10) * Math.PI;
    prof.push([Math.cos(a) * W, H + Math.sin(a) * 0.26]);
  }
  prof.push([-W, H], [-W, 0]);
  const col: ColorFn = (p) => {
    const k = 0.82 + 0.35 * noise3(p[0] * 7, p[1] * 7, p[2] * 7, seed);
    const m = smoothstep(0.55, 0.05, p[1]) * smoothstep(0.25, 0.75, noise3(p[0] * 6, p[1] * 6, p[2] * 6, seed + 2));
    const c = mix(stone, moss, m * 0.8);
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  const sec = (z: number, g: number): Section => ({ c: [0, 0.1, z], ax: [1, 0, 0], ay: [0, 1, 0], pts: prof.map(([x, y]) => [x * (1 - g), (y - 0.45) * (1 - g * 0.5) + 0.45] as [number, number]), color: col });
  b.loft([sec(-0.1, 0.09), sec(-0.085, 0), sec(0.085, 0), sec(0.1, 0.09)], { flat: true, capStart: true, capEnd: true });
  b.box([0, 0.05, 0], [0.46, 0.05, 0.3], 0.02, col);
  // carved cross
  b.box([0, 0.62, 0.1], [0.022, 0.18, 0.006], 0.003, '#4a4a4c');
  b.box([0, 0.7, 0.1], [0.1, 0.022, 0.006], 0.003, '#4a4a4c');
  return b;
}

export function makeProp(id: string, prop: string, seed: number): PlaceholderModel {
  let b: MeshBuilder | null = null;
  let rockGeo: { geometry: BufferGeometry; height: number } | null = null;
  let kind: 'prop' | 'tree' = 'prop';
  let radius = 0.5;
  switch (prop) {
    case 'pine':
      b = pine(seed);
      kind = 'tree';
      radius = 1.4;
      break;
    case 'oak':
      b = oak(seed);
      kind = 'tree';
      radius = 1.5;
      break;
    case 'bush':
      b = bush(seed);
      radius = 0.8;
      break;
    case 'lantern':
      b = lantern(seed);
      radius = 0.4;
      break;
    case 'gravestone':
      b = gravestone(seed);
      radius = 0.4;
      break;
    default: {
      const big = /boulder|big/.test(id);
      rockGeo = rock(seed, big ? 1.9 : 1.0);
      radius = big ? 1.5 : 0.8;
    }
  }
  const geometry = rockGeo ? rockGeo.geometry : (b as MeshBuilder).toGeometry();
  const height = rockGeo ? rockGeo.height : (b as MeshBuilder).bounds().max[1];
  return assembleModel({
    id,
    kind,
    parts: [{ name: prop, geometry }],
    height,
    radius,
    palette: prop === 'pine' ? ['#24502d', '#4b8a3a', '#5a3f2a'] : prop === 'oak' ? ['#2f6a2c', '#6fa83c', '#5b4330'] : ['#8d8b86', '#5d7c3a', '#5f5f62'],
    extra: { prop },
  });
}
