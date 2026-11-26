// DEV ONLY (imported by gallery/modes/liquid.ts): until the real zone recipes carry `layout.liquid` + `layout.streams`,
// carves a synthetic river / lava channel / frozen lake into a copy of the field grids and dresses the debug ground so
// the liquid shaders can be judged against a believable bed and banks. Never imported by the game.
import { Color, DoubleSide, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, RepeatWrapping, type BufferAttribute, type BufferGeometry } from 'three';
import type { Liquid, RockPlacement, Stream } from '../../../world/layoutTypes';
import { fbm, smoothPath, smoothstep } from '../../../world/noise';
import { SURFACE } from '../../../world/layoutTypes';
import type { TerrainField, TerrainGrid } from '../../../world/terrainField';
import { tryTexture, worldUniforms, type ZoneContext, type ZoneSystem } from '../zoneContext';

export type TestKind = Liquid['kind'];

export interface TestSpot {
  name: string;
  x: number;
  z: number;
  note: string;
}

interface Lake {
  x: number;
  z: number;
  rx: number;
  rz: number;
  yaw: number;
}

interface Recipe {
  level: number;
  depth: number;
  streams: Stream[];
  lakes: Lake[];
  spots: TestSpot[];
  /** rocks: [stream index, arc fraction, side (-1..1 of half width), size] */
  rocks: Array<[number, number, number, number]>;
}

const RECIPES: Record<TestKind, Recipe> = {
  water: {
    level: -0.55,
    depth: 1.7,
    streams: [
      {
        pts: [[-230, -60], [-150, -48], [-95, -10], [-48, 14], [-8, 10], [32, 26], [75, 52], [130, 40], [185, 12], [235, 10]],
        halfWidth: 5.5,
        speed: 1.6,
      },
      { pts: [[40, -120], [32, -80], [30, -30], [32, 26]], halfWidth: 3.2, speed: 1.1 },
    ],
    lakes: [{ x: -70, z: 72, rx: 17, rz: 11, yaw: 0.4 }],
    rocks: [
      [0, 0.34, 0.45, 2.1],
      [0, 0.36, -0.55, 1.5],
      [0, 0.45, 0.2, 2.6],
      [0, 0.52, -0.5, 1.7],
      [0, 0.58, 0.55, 1.4],
      [0, 0.66, -0.1, 2.2],
      [1, 0.5, 0.1, 1.5],
      [0, 0.25, 0.05, 1.3],
    ],
    spots: [
      { name: 'river', x: -8, z: 10, note: 'mid river, flow towards +x' },
      { name: 'bend', x: -62, z: 2, note: 'bend with boulders' },
      { name: 'confluence', x: 32, z: 20, note: 'tributary joins from -z' },
      { name: 'pond', x: -70, z: 72, note: 'still pond, swirl only' },
    ],
  },
  lava: {
    level: -0.45,
    depth: 1.1,
    streams: [
      {
        pts: [[-230, 40], [-140, 30], [-85, 45], [-30, 25], [20, 38], [70, 18], [120, -20], [175, -40], [235, -30]],
        halfWidth: 7,
        speed: 0.55,
      },
      { pts: [[-60, -110], [-50, -70], [-34, -30], [-30, 25]], halfWidth: 3.6, speed: 0.4 },
    ],
    lakes: [{ x: 70, z: -60, rx: 26, rz: 18, yaw: -0.3 }],
    rocks: [
      [0, 0.3, 0.1, 2.4],
      [0, 0.47, -0.4, 1.8],
      [0, 0.62, 0.3, 2.8],
    ],
    spots: [
      { name: 'river', x: -30, z: 25, note: 'lava river towards +x' },
      { name: 'bend', x: 20, z: 38, note: 'bend' },
      { name: 'lake', x: 70, z: -60, note: 'standing lava lake' },
      { name: 'fork', x: -34, z: 5, note: 'tributary junction' },
    ],
  },
  ice: {
    level: -0.4,
    depth: 2.2,
    streams: [],
    lakes: [
      { x: -30, z: 10, rx: 48, rz: 32, yaw: 0.35 },
      { x: 70, z: -62, rx: 14, rz: 11, yaw: -0.2 },
    ],
    rocks: [],
    spots: [
      { name: 'shore', x: -66, z: 28, note: 'lake edge, west shore' },
      { name: 'lake', x: -30, z: 10, note: 'lake centre' },
      { name: 'pond', x: 70, z: -62, note: 'small pond' },
      { name: 'north', x: -20, z: -18, note: 'north shore' },
    ],
  },
};

export function testSpots(kind: TestKind): TestSpot[] {
  return RECIPES[kind].spots;
}

/** Returns a field whose grids / layout carry a synthetic liquid of `kind` (the original field is untouched). */
export function withTestLiquid(field: TerrainField, kind: TestKind): TerrainField {
  const r = RECIPES[kind];
  const { n, heights } = field.grid;
  const half = field.size / 2;
  const seed = field.seed;
  const count = n * n;

  // signed distance (m) to the nearest water body: < 0 inside
  const sdf = new Float32Array(count).fill(1e9);
  for (const s of r.streams) {
    const pts = smoothPath(s.pts, 8);
    let arc = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k] as [number, number];
      const b = pts[k + 1] as [number, number];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-4) continue;
      const reach = s.halfWidth * 2.4 + 20;
      const i0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - reach + half));
      const i1 = Math.min(n - 1, Math.ceil(Math.max(a[0], b[0]) + reach + half));
      const j0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - reach + half));
      const j1 = Math.min(n - 1, Math.ceil(Math.max(a[1], b[1]) + reach + half));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = i - half;
          const z = j - half;
          let t = ((x - a[0]) * dx + (z - a[1]) * dz) / (len * len);
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
          const hw = s.halfWidth * (1 + 0.3 * fbm((arc + len * t) / 24, 3.7, seed + 7, 2));
          const v = d - hw;
          const idx = j * n + i;
          if (v < (sdf[idx] as number)) sdf[idx] = v;
        }
      }
      arc += len;
    }
  }
  const lakeRadius = (l: Lake): number => Math.min(l.rx, l.rz);
  for (const l of r.lakes) {
    const c = Math.cos(l.yaw);
    const s = Math.sin(l.yaw);
    const reach = Math.max(l.rx, l.rz) * 1.5 + 24;
    const i0 = Math.max(0, Math.floor(l.x - reach + half));
    const i1 = Math.min(n - 1, Math.ceil(l.x + reach + half));
    const j0 = Math.max(0, Math.floor(l.z - reach + half));
    const j1 = Math.min(n - 1, Math.ceil(l.z + reach + half));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = i - half;
        const z = j - half;
        const ux = (x - l.x) * c + (z - l.z) * s;
        const uz = -(x - l.x) * s + (z - l.z) * c;
        const q = Math.sqrt((ux / l.rx) * (ux / l.rx) + (uz / l.rz) * (uz / l.rz)) - 0.16 * fbm(x / 16, z / 16, seed + 9, 3);
        const v = (q - 1) * lakeRadius(l);
        const idx = j * n + i;
        if (v < (sdf[idx] as number)) sdf[idx] = v;
      }
    }
  }

  const level = r.level;
  const carved = new Float32Array(count);
  const surface = new Uint8Array(count);
  for (let idx = 0; idx < count; idx++) {
    const natural = heights[idx] as number;
    const s = sdf[idx] as number;
    let h = natural;
    if (s < 0) {
      const f = Math.min(1, -s / 4.2);
      h = level - r.depth * (f * f * (3 - 2 * f)) - 0.04;
    } else {
      // banks climb 0.28 m per metre away from the shore and merge into the natural terrain
      const w = 1 - smoothstep(3, 18, s);
      h = natural + (Math.max(level + 0.18 + s * 0.28, level + 0.05) - natural) * w;
    }
    carved[idx] = h;
    const depth = level - h;
    surface[idx] =
      kind === 'lava'
        ? depth > 0.05 ? SURFACE.LAVA : SURFACE.GROUND
        : kind === 'ice'
          ? depth > 0.02 ? SURFACE.ICE : SURFACE.GROUND
          : depth > 1.1 ? SURFACE.DEEP : depth > 0.12 ? SURFACE.SHALLOW : SURFACE.GROUND;
  }

  const grid: TerrainGrid = { ...field.grid, heights: carved, bed: carved, surface };
  const rocks: RockPlacement[] = [...field.layout.rocks];
  for (const [si, frac, side, size] of r.rocks) {
    const s = r.streams[si];
    if (!s) continue;
    const pts = smoothPath(s.pts, 8);
    const p = pts[Math.min(pts.length - 2, Math.floor(frac * (pts.length - 1)))] as [number, number];
    const q = pts[Math.min(pts.length - 1, Math.floor(frac * (pts.length - 1)) + 1)] as [number, number];
    const tx = q[0] - p[0];
    const tz = q[1] - p[1];
    const l = Math.hypot(tx, tz) || 1;
    const x = p[0] - (tz / l) * side * s.halfWidth;
    const z = p[1] + (tx / l) * side * s.halfWidth;
    const gx = Math.min(n - 1, Math.max(0, Math.round(x + half)));
    const gz = Math.min(n - 1, Math.max(0, Math.round(z + half)));
    rocks.push({ kind: 'boulder', x, z, y: carved[gz * n + gx] as number, sx: size * 1.2, sy: size * 0.8, sz: size, yaw: frac * 9, seed: Math.round(frac * 1000), mat: 0, sink: 0.25 });
  }
  const layout = { ...field.layout, liquid: { kind, level } satisfies Liquid, streams: r.streams, rocks };
  return Object.create(field, {
    grid: { value: grid, enumerable: true },
    layout: { value: layout, enumerable: true },
  }) as TerrainField;
}

const BED_TEX: Record<string, { tex: string; bank: string; bed: string }> = {
  yeonmu: { tex: 'tex_dirt_path', bank: '#8fb070', bed: '#b09c72' },
  suryeon: { tex: 'tex_ochre_dirt', bank: '#b09a62', bed: '#8d7a58' },
  seori: { tex: 'tex_snow_packed', bank: '#e8eef6', bed: '#7e8ca2' },
  daeryeol: { tex: 'tex_ash', bank: '#c2b0a4', bed: '#6a5a50' },
};

/** DEV: the real zoneScene advances the shared render clock; gallery modes without it need this stand-in. */
export function createDevClock(): ZoneSystem {
  return {
    name: 'clock',
    group: new Group(),
    update(dt) {
      worldUniforms.uTime.value += dt;
    },
    setQuality() {},
    dispose() {},
  };
}

/** Camera spots for a real recipe: stream midpoints plus the wet node nearest the origin / nearest the wet centroid / farthest from it. */
export function realSpots(field: TerrainField): TestSpot[] {
  const spots: TestSpot[] = [];
  field.layout.streams.forEach((s, i) => {
    for (const [label, f] of [['mid', 0.5], ['a', 0.2], ['b', 0.8]] as const) {
      const p = s.pts[Math.floor((s.pts.length - 1) * f)];
      if (p) spots.push({ name: `stream${i}${label}`, x: p[0], z: p[1], note: `real stream ${i} ${label}` });
    }
  });
  const lq = field.layout.liquid;
  if (!lq) return spots;
  const { n, bed } = field.grid;
  const half = field.size / 2;
  let cx = 0;
  let cz = 0;
  let count = 0;
  const limit = field.arenaRadius * field.arenaRadius;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i - half;
      const z = j - half;
      if (x * x + z * z > limit || (bed[j * n + i] as number) >= lq.level) continue;
      cx += x;
      cz += z;
      count++;
    }
  }
  if (count === 0) return spots;
  cx /= count;
  cz /= count;
  const pick = (name: string, note: string, score: (x: number, z: number) => number): void => {
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        if ((bed[k] as number) >= lq.level) continue;
        const x = i - half;
        const z = j - half;
        const v = score(x, z);
        if (v < best) {
          best = v;
          bx = x;
          bz = z;
        }
      }
    }
    if (best < Infinity) spots.push({ name, x: bx, z: bz, note });
  };
  pick('nearest', 'wet node nearest the origin', (x, z) => x * x + z * z);
  pick('centre', 'wet node nearest the wet centroid', (x, z) => (x - cx) * (x - cx) + (z - cz) * (z - cz));
  pick('far', 'wet node farthest from the origin inside the arena', (x, z) => (x * x + z * z > limit ? Infinity : -(x * x + z * z)));
  return spots;
}

/** Re-dresses the debug ground: texture + bank / bed colours, and boulders at `devRocks` (the real zones draw theirs through the vegetation / rock systems). */
export async function dressGround(ctx: ZoneContext, ground: ZoneSystem, devRocks: readonly RockPlacement[]): Promise<void> {
  const mesh = ground.group.children[0] as Mesh | undefined;
  if (!mesh) return;
  const geo: BufferGeometry = mesh.geometry;
  const pos = geo.getAttribute('position') as BufferAttribute;
  const col = geo.getAttribute('color') as BufferAttribute;
  const liquid = ctx.field.layout.liquid;
  const level = liquid?.level ?? -1e9;
  const style = BED_TEX[ctx.biome.id] ?? BED_TEX.yeonmu!;
  const bank = new Color(style.bank);
  const bed = new Color(style.bed);
  const rock = new Color('#8a8478');
  const c = new Color();
  const uv = new Float32Array(pos.count * 2);
  const nrm = { x: 0, y: 1, z: 0 };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    uv[i * 2] = x / 5;
    uv[i * 2 + 1] = z / 5;
    ctx.field.normalAt(x, z, nrm);
    const under = smoothstep(0.0, 0.5, level - pos.getY(i) + 0.15);
    c.copy(bank).lerp(bed, under).lerp(rock, Math.min(1, Math.max(0, (1 - nrm.y - 0.14) * 3)));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  const tex = await tryTexture(ctx.assets, style.tex);
  if (typeof ground.group.userData.isDisposed === 'function' && ground.group.userData.isDisposed()) return;
  if (tex) {
    tex.wrapS = tex.wrapT = RepeatWrapping;
    const prevMat = mesh.material;
    mesh.material = new MeshStandardMaterial({ map: tex, vertexColors: true, roughness: 0.95, metalness: 0 });
    mesh.receiveShadow = true;
    if (Array.isArray(prevMat)) for (const m of prevMat) m.dispose();
    else prevMat.dispose();
  }

  // boulders where the synthetic test layout put rocks
  if (devRocks.length === 0) return;
  const rocks = new Group();
  rocks.name = 'devRocks';
  const mat = new MeshStandardMaterial({ color: '#85807a', roughness: 0.9, flatShading: true, side: DoubleSide });
  for (const r of devRocks) {
    const g = new IcosahedronGeometry(0.5, 1);
    const p = g.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + 0.22 * fbm(p.getX(i) * 2 + r.seed, p.getZ(i) * 2, 5, 2);
      p.setXYZ(i, p.getX(i) * k * r.sx, p.getY(i) * k * r.sy, p.getZ(i) * k * r.sz);
    }
    g.computeVertexNormals();
    const m = new Mesh(g, mat);
    m.position.set(r.x, r.y + r.sy * 0.3, r.z);
    m.rotation.y = r.yaw;
    m.castShadow = true;
    rocks.add(m);
  }
  ground.group.add(rocks);
}
