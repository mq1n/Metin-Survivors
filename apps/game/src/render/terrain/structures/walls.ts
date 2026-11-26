// Wall segment renderer: palisade / fence / stone_wall / ruin_wall / ice_wall. Every kind is merged into ONE static mesh
// (≤ 5 draw calls for all walls) that follows the terrain height under each segment. Collision is handled by
// TerrainField (circles every 0.9 m); the visual thickness here is ≈ 1 m to match it. Owner: StructuresB.
import { BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, type Material, type Vector3 } from 'three';
import type { WallKind, WallPlacement } from '../../../world/layoutTypes';
import type { TerrainField } from '../../../world/terrainField';
import { PAL, TAU, stoneLook, toned, vary } from './b_common';
import { MAT, MeshBuilder, V, noise3, smooth } from './b_geom';
import { structureMaterial } from './b_mat';
import { banner, skull } from './b_orc';
import type { StructureBuildContext } from './types';

export interface WallsResult {
  group: Group;
  update?(time: number): void;
  dispose(): void;
}

/** texture ids the wall builder needs preloaded */
export const WALL_TEXTURES: string[] = ['tex_bark_oak', 'tex_wood_plank', 'tex_rock_mossy', 'tex_rock_frozen', 'tex_basalt'];

type Field = Pick<TerrainField, 'heightAt'>;

/** local frame of a wall segment: origin, unit direction, unit right-hand normal, length */
interface Seg {
  ax: number;
  az: number;
  dx: number;
  dz: number;
  nx: number;
  nz: number;
  len: number;
  yaw: number;
}

function frameOf(w: WallPlacement): Seg {
  const ex = w.x1 - w.x0;
  const ez = w.z1 - w.z0;
  const len = Math.hypot(ex, ez) || 1e-6;
  const dx = ex / len;
  const dz = ez / len;
  return { ax: w.x0, az: w.z0, dx, dz, nx: -dz, nz: dx, len, yaw: Math.atan2(-dz, dx) };
}

const at = (s: Seg, along: number, lateral: number): [number, number] => [s.ax + s.dx * along + s.nx * lateral, s.az + s.dz * along + s.nz * lateral];

/** lowest ground over a footprint (so a block never floats on a slope) */
function lowest(field: Field, s: Seg, a0: number, a1: number, lat: number): number {
  let y = Infinity;
  for (const a of [a0, (a0 + a1) / 2, a1]) {
    for (const l of [-lat, 0, lat]) {
      const [x, z] = at(s, a, l);
      y = Math.min(y, field.heightAt(x, z));
    }
  }
  return y;
}

// ---- palisade -----------------------------------------------------------------------------------------------------

function palisade(mb: MeshBuilder, w: WallPlacement, field: Field): void {
  const s = frameOf(w);
  const rng = mb.rng;
  mb.set({ mat: MAT.bark, color: '#8a6e52', color2: '#463829', blend: 0.4, uvs: 0.9, ao: 0.4, aoH: 0.9, mottle: 0.14, mottleFreq: 1.3 });
  const log = (along: number, lateral: number, hMul: number, r: number): void => {
    const [x, z] = at(s, along, lateral);
    const gy = field.heightAt(x, z);
    const h = w.height * hMul;
    mb.scope(() => {
      mb.set({ groundY: gy, color: vary('#8a6e52', rng, 0.2), blend: rng() < 0.12 ? 0.85 : 0.4 });
      mb.t(x, gy - 0.3, z).ry(rng() * TAU).rz((rng() - 0.5) * 0.09).rx((rng() - 0.5) * 0.09);
      mb.tube([V(0, 0, 0), V(0, (h + 0.3) * 0.86, 0), V(0, h + 0.3, 0)], (t) => (t < 0.86 ? r * (1 - 0.1 * t) : r * 0.92 * Math.max(0.04, 1 - (t - 0.86) / 0.14)), {
        radial: 5,
        cap0: 'open',
        cap1: 'open',
        shade: (t) => (t > 0.86 ? 1.3 : 1),
        wobble: (t, a) => 1 + 0.09 * Math.sin(t * 17 + a * 9 + along),
      });
    });
  };
  const n = Math.max(1, Math.ceil(s.len / 0.5));
  for (let i = 0; i < n; i++) {
    const along = ((i + 0.5) / n) * s.len;
    log(along, (rng() - 0.5) * 0.1, (i % 7 === 3 ? 1.16 : 0.9 + rng() * 0.16) * (i % 5 === 1 ? 0.92 : 1), 0.24 + rng() * 0.05);
  }
  // shorter second row behind gives the wall its ≈ 1 m depth
  const nb = Math.max(1, Math.ceil(s.len / 0.9));
  for (let i = 0; i < nb; i++) log(((i + 0.25 + rng() * 0.4) / nb) * s.len, 0.42, 0.72 + rng() * 0.12, 0.22 + rng() * 0.04);
  // lashed rails along the front face
  mb.set({ mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0, uvs: 0.4 });
  for (const hk of [0.34, 0.7]) {
    const pts: Vector3[] = [];
    const steps = Math.max(2, Math.ceil(s.len / 1.0));
    for (let i = 0; i <= steps; i++) {
      const [x, z] = at(s, (i / steps) * s.len, -0.33);
      pts.push(V(x, field.heightAt(x, z) + w.height * hk, z));
    }
    mb.tube(pts, 0.035, { radial: 3, cap0: 'flat', cap1: 'flat', shade: (t) => 0.8 + 0.3 * Math.sin(t * s.len * 18) });
  }
  // orc dressing: a skull on a log now and then, ragged streamers
  const ck = Math.floor(rng() * 3);
  if (ck === 0 || s.len > 9) {
    const along = s.len * (0.3 + rng() * 0.4);
    const [x, z] = at(s, along, -0.3);
    const gy = field.heightAt(x, z);
    mb.scope(() => {
      mb.t(x, gy + w.height * 0.62, z).ry(s.yaw - Math.PI / 2);
      skull(mb, { scale: 1.5, horns: rng() > 0.4 });
    });
  }
  if (rng() > 0.45) {
    const along = s.len * (0.15 + rng() * 0.7);
    const [x, z] = at(s, along, -0.3);
    const gy = field.heightAt(x, z);
    mb.scope(() => {
      mb.t(x, gy + w.height * 0.88, z).ry(s.yaw - Math.PI / 2);
      banner(mb, { w: 0.34, h: 1.3, tail: 0.3, cloth: rng() > 0.5 ? '#8e1f18' : '#2a211d', trim: PAL.rope, swayTop: 0.1, ragged: true });
    });
  }
}

// ---- fence --------------------------------------------------------------------------------------------------------

function fence(mb: MeshBuilder, w: WallPlacement, field: Field): void {
  const s = frameOf(w);
  const rng = mb.rng;
  const n = Math.max(1, Math.round(s.len / 1.1));
  const posts: Array<[number, number, number]> = [];
  mb.set({ mat: MAT.wood, color: '#85694a', color2: '#4b3a2b', blend: 0.4, uvs: 0.7, ao: 0.35, aoH: 0.5, mottle: 0.12 });
  for (let i = 0; i <= n; i++) {
    const along = (i / n) * s.len;
    const [x, z] = at(s, along, (rng() - 0.5) * 0.05);
    const gy = field.heightAt(x, z);
    const h = w.height * (0.95 + rng() * 0.15);
    posts.push([x, gy, z]);
    mb.scope(() => {
      mb.set({ groundY: gy, color: vary('#7d6244', rng, 0.15) });
      mb.t(x, gy - 0.15, z).rz((rng() - 0.5) * 0.06).rx((rng() - 0.5) * 0.06);
      mb.tube([V(0, 0, 0), V(0, (h + 0.15) * 0.8, 0), V(0, h + 0.15, 0)], (t) => (t < 0.8 ? 0.066 : 0.066 * Math.max(0.05, 1 - (t - 0.8) / 0.2)), { radial: 4, cap0: 'open', cap1: 'open', shade: (t) => (t > 0.8 ? 1.25 : 1) });
    });
  }
  // two rails of planks between the posts
  for (const hk of [0.38, 0.78]) {
    for (let i = 0; i < n; i++) {
      const [x0, y0, z0] = posts[i] as [number, number, number];
      const [x1, y1, z1] = posts[i + 1] as [number, number, number];
      const ya = y0 + w.height * hk;
      const yb = y1 + w.height * hk;
      const len = Math.hypot(x1 - x0, z1 - z0);
      mb.scope(() => {
        mb.set({ groundY: Math.min(y0, y1), color: vary('#8d7050', rng, 0.15), ao: 0.2 });
        mb.t((x0 + x1) / 2 + s.nx * 0.07, (ya + yb) / 2, (z0 + z1) / 2 + s.nz * 0.07).ry(s.yaw).rz(Math.atan2(yb - ya, len) + (rng() - 0.5) * 0.02);
        mb.box(len - 0.02, 0.12, 0.04, { soft: 0.25, grain: 'x' });
      });
    }
  }
}

// ---- stone / ruin walls -------------------------------------------------------------------------------------------

function stoneWall(mb: MeshBuilder, w: WallPlacement, field: Field, zone: string, ruin: boolean): void {
  const s = frameOf(w);
  const rng = mb.rng;
  const ch = 0.34;
  const courses = Math.max(2, Math.round(w.height / ch));
  const look = stoneLook(zone);
  mb.set({ mat: MAT.stone, color: toned(look, PAL.stone), color2: look.accent, blend: 0.45, uvs: 0.8, mottle: 0.15, mottleFreq: 1.8, ao: 0.4, aoH: 0.7, jitter: 0.06 });
  // dark core so joints never show daylight
  const cols = Math.max(1, Math.ceil(s.len / 1.2));
  const crumble = (along: number): number => (ruin ? 0.35 + 0.65 * smooth(0.25, 0.75, noise3(along * 0.37 + w.seed, w.seed * 0.1, 3, 11)) : 1);
  for (let c = 0; c < cols; c++) {
    const a0 = -0.15 + (c / cols) * (s.len + 0.3);
    const a1 = -0.15 + ((c + 1) / cols) * (s.len + 0.3);
    const base = lowest(field, s, a0, a1, 0.4) - 0.2;
    const full = base + 0.2 + (courses * ch - 0.1) * crumble((a0 + a1) / 2) * (ruin ? 0.9 : 1);
    const top = ruin ? base + (full - base) * 0.5 : full;
    mb.scope(() => {
      const [x, z] = at(s, (a0 + a1) / 2, 0);
      mb.t(x, (base + top) / 2, z).ry(s.yaw);
      mb.set({ color: toned(look, '#4d4943'), color2: toned(look, '#33302b'), blend: 0.4, groundY: base });
      mb.box(a1 - a0 + 0.04, top - base, 0.46, { soft: 0.2 });
    });
  }
  // courses of soft-edged blocks, each course with its own joint pattern
  for (let c = 0; c < courses; c++) {
    let a = -0.15 - rng() * 0.6;
    while (a < s.len + 0.15) {
      const bw = 0.5 + rng() * 0.45;
      const a0 = Math.max(-0.15, a);
      const a1 = Math.min(s.len + 0.15, a + bw);
      a += bw;
      if (a1 - a0 < 0.18) continue;
      const mid = (a0 + a1) / 2;
      const base = lowest(field, s, a0, a1, 0.4) - 0.2;
      const maxTop = base + 0.2 + (courses * ch - 0.1) * crumble(mid) * (ruin ? 0.9 : 1);
      const y0 = base + c * ch;
      if (y0 > maxTop - 0.12) continue;
      if (ruin && c >= courses - 3 && rng() < 0.22) continue;
      const top = Math.min(y0 + ch * (0.92 + rng() * 0.1), maxTop);
      const bh = top - y0;
      const batter = c * 0.012;
      const d = 0.76 + rng() * 0.18 - batter * 1.4;
      const lat = (rng() - 0.5) * 0.08;
      const [x, z] = at(s, mid, lat);
      mb.scope(() => {
        mb.set({ color: vary(rng() < 0.18 ? '#a39e90' : PAL.stone, rng, 0.14).multiply(look.mul), blend: Math.max(0.15, 0.62 - c * 0.07), groundY: base });
        mb.t(x, y0 + bh / 2, z).ry(s.yaw + (ruin ? (rng() - 0.5) * 0.12 : (rng() - 0.5) * 0.03));
        if (ruin) mb.rz((rng() - 0.5) * 0.06);
        mb.box(a1 - a0 - 0.03, bh, d, { soft: 0.5 });
        if (look.embers && rng() < 0.16) {
          // a faint ember seam glowing in the joint on one face of the block
          mb.set({ mat: MAT.glow, color: '#8a2a08', color2: '#c4560f', blend: 0.4, ao: 0, mottle: 0.3 });
          mb.t(0, bh / 2 - 0.015, (rng() < 0.5 ? -1 : 1) * (d / 2 + 0.004));
          mb.box(Math.max(0.1, a1 - a0 - 0.2), 0.03, 0.012);
        }
      });
    }
  }
  // coping stones on an intact wall; snow / moss on the ruin
  if (!ruin) {
    let a = -0.15;
    while (a < s.len + 0.15) {
      const bw = 0.85 + rng() * 0.3;
      const a1 = Math.min(s.len + 0.15, a + bw);
      const mid = (a + a1) / 2;
      const base = lowest(field, s, a, a1, 0.4) - 0.2;
      const [x, z] = at(s, mid, 0);
      mb.scope(() => {
        mb.set({ color: vary('#b0ab9d', rng, 0.1).multiply(look.mul), color2: look.cap, blend: look.capBlend, groundY: base });
        mb.t(x, base + courses * ch + 0.08, z).ry(s.yaw + (rng() - 0.5) * 0.03);
        mb.box(a1 - a - 0.05, 0.17, 1.0, { soft: 0.45 });
      });
      a = a1;
    }
  } else {
    // fallen blocks on both sides
    const count = Math.round(s.len * 0.5);
    for (let i = 0; i < count; i++) {
      const [x, z] = at(s, rng() * s.len, (rng() > 0.5 ? 1 : -1) * (0.7 + rng() * 0.9));
      const gy = field.heightAt(x, z);
      mb.scope(() => {
        mb.set({ color: vary(PAL.stone, rng, 0.2).multiply(look.mul), blend: 0.5, groundY: gy });
        mb.t(x, gy + 0.1, z).ry(rng() * TAU).rz((rng() - 0.5) * 0.5).rx((rng() - 0.5) * 0.4);
        mb.box(0.35 + rng() * 0.3, 0.2 + rng() * 0.12, 0.3 + rng() * 0.25, { soft: 0.5 });
      });
    }
  }
}

// ---- ice wall (translucent, own material) -------------------------------------------------------------------------

function iceWall(mb: MeshBuilder, w: WallPlacement, field: Field): void {
  const s = frameOf(w);
  const rng = mb.rng;
  mb.set({ mat: MAT.plain, color: '#c4e4f6', color2: '#f4fbff', blend: 0.5, mottle: 0.12, ao: 0.55, aoH: 1.8, jitter: 0.04 });
  const slab = (along: number, lateral: number, hMul: number, ww: number, tt: number): void => {
    const [x, z] = at(s, along, lateral);
    const gy = field.heightAt(x, z);
    const h = w.height * hMul + 0.2;
    mb.scope(() => {
      mb.set({ groundY: gy, color: vary('#c4e4f6', rng, 0.08) });
      mb.t(x, gy - 0.2, z).ry(s.yaw + (rng() - 0.5) * 1.5).rz((rng() - 0.5) * 0.3).rx((rng() - 0.5) * 0.2);
      const a = rng();
      mb.prism(
        [
          [-ww / 2, 0],
          [ww / 2, 0],
          [ww * (0.34 + rng() * 0.14), h * 0.5],
          [ww * (0.2 + a * 0.2), h * 0.78],
          [ww * (0.02 + a * 0.1), h],
          [-ww * (0.16 + rng() * 0.2), h * (0.82 + rng() * 0.1)],
          [-ww * (0.3 + rng() * 0.12), h * 0.5],
        ],
        tt,
        { grain: 'y' },
      );
    });
  };
  const n = Math.max(1, Math.ceil(s.len / 0.6));
  for (let i = 0; i < n; i++) slab(((i + rng() * 0.8) / n) * s.len, (i % 2 === 0 ? -1 : 1) * (0.1 + rng() * 0.25), 0.5 + rng() * 0.6 + (i % 5 === 2 ? 0.3 : 0), 0.5 + rng() * 0.55, 0.35 + rng() * 0.45);
  // small frozen shards and a snow drift at the foot
  for (let i = 0; i < Math.round(s.len * 0.7); i++) slab(rng() * s.len, (rng() > 0.5 ? 1 : -1) * (0.5 + rng() * 0.5), 0.1 + rng() * 0.16, 0.2 + rng() * 0.15, 0.14 + rng() * 0.1);
  mb.set({ color: '#eef6fb', color2: '#d6e6f0', blend: 0.4, ao: 0 });
  for (let i = 0; i < Math.round(s.len * 0.45); i++) {
    const [x, z] = at(s, rng() * s.len, (rng() - 0.5) * 1.3);
    const gy = field.heightAt(x, z);
    mb.scope(() => {
      mb.t(x, gy - 0.05, z).ry(rng() * TAU);
      mb.blob(0.35 + rng() * 0.3, 0.2 + rng() * 0.12, 0.3 + rng() * 0.25, { seg: 6, rings: 3, lump: 0.2, cutBottom: 0.3 });
    });
  }
}

// ---- assembly -----------------------------------------------------------------------------------------------------

export function buildWalls(walls: readonly WallPlacement[], field: Field, ctx: StructureBuildContext): WallsResult {
  const group = new Group();
  group.name = 'walls';
  const geos: BufferGeometry[] = [];
  const mats: Material[] = [];
  const kinds: WallKind[] = ['palisade', 'fence', 'stone_wall', 'ruin_wall', 'ice_wall'];
  kinds.forEach((kind, ki) => {
    const list = walls.filter((w) => w.kind === kind);
    if (list.length === 0) return;
    const mb = new MeshBuilder(1000 + ki * 77);
    for (const w of list) {
      if (kind === 'palisade') palisade(mb, w, field);
      else if (kind === 'fence') fence(mb, w, field);
      else if (kind === 'stone_wall') stoneWall(mb, w, field, ctx.zone, false);
      else if (kind === 'ruin_wall') stoneWall(mb, w, field, ctx.zone, true);
      else iceWall(mb, w, field);
    }
    let mat: Material;
    if (kind === 'ice_wall') {
      mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.05, transparent: true, opacity: 0.9, emissive: new Color('#5aa4cf'), emissiveIntensity: 0.34 });
    } else {
      mat = structureMaterial(ctx, { roughness: 0.9, doubleSided: kind === 'palisade', sway: kind === 'palisade', detail: [0.85, 0.8, 0.65, 0.6], stoneTexture: stoneLook(ctx.zone).tex });
    }
    const geo = mb.build();
    const mesh = new Mesh(geo, mat);
    mesh.name = `walls_${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.push(geo);
    mats.push(mat);
  });
  return {
    group,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
