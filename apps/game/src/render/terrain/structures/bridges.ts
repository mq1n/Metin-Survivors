// Bridge renderer: wood (plank deck, log beams, bents, rope rails), rope (sagging suspension deck, towers, hand ropes)
// and stone (arched, ashlar facade and parapets, keystone, piers, lantern posts). All bridges merge into ONE static
// mesh. The deck height is the same `archHeight` TerrainField bakes into the walkable surface; the ground under the
// deck is `bedHeightAt` (heightAt would return the deck itself). Owner: StructuresB.
import { BufferGeometry, Group, Mesh, type Color, type Material, type Vector3 } from 'three';
import type { Bridge } from '../../../world/layoutTypes';
import { archHeight } from '../../../world/shapes';
import type { TerrainField } from '../../../world/terrainField';
import { PAL, rope, stoneLook, toned, vary, type StoneLook } from './b_common';
import { MAT, MeshBuilder, V } from './b_geom';
import { structureMaterial } from './b_mat';
import { banner } from './b_orc';
import type { StructureBuildContext } from './types';

export interface BridgesResult {
  group: Group;
  update?(time: number): void;
  dispose(): void;
}

/** texture ids the bridge builder needs preloaded */
export const BRIDGE_TEXTURES: string[] = ['tex_wood_plank', 'tex_bark_oak', 'tex_rock_mossy', 'tex_rock_frozen', 'tex_basalt'];

type Field = Pick<TerrainField, 'heightAt' | 'bedHeightAt'>;

/** a bridge's centreline: `s` metres from the start, `lat` metres to the right of the walking direction */
class Span {
  readonly len: number;
  readonly yaw: number;
  private readonly dx: number;
  private readonly dz: number;

  constructor(
    readonly b: Bridge,
    private readonly field: Field,
  ) {
    const ex = b.x1 - b.x0;
    const ez = b.z1 - b.z0;
    this.len = Math.hypot(ex, ez) || 1e-6;
    this.dx = ex / this.len;
    this.dz = ez / this.len;
    this.yaw = Math.atan2(-this.dz, this.dx);
  }

  /** deck height (identical to the walkable surface on the centreline) */
  y(s: number): number {
    return archHeight(Math.min(1, Math.max(0, s / this.len)), this.b.yEnd, this.b.yMid);
  }

  /** pitch of the deck at s (radians, positive = rising) */
  slope(s: number): number {
    const a = Math.max(0, s - 0.25);
    const c = Math.min(this.len, s + 0.25);
    return Math.atan2(this.y(c) - this.y(a), c - a);
  }

  x(s: number, lat: number): number {
    return this.b.x0 + this.dx * s - this.dz * lat;
  }

  z(s: number, lat: number): number {
    return this.b.z0 + this.dz * s + this.dx * lat;
  }

  pt(s: number, lat: number, up = 0): Vector3 {
    return V(this.x(s, lat), this.y(s) + up, this.z(s, lat));
  }

  bed(s: number, lat: number): number {
    return this.field.bedHeightAt(this.x(s, lat), this.z(s, lat));
  }
}

/** moves the builder onto the deck at (s, lat), local X along the bridge, pitched with the slope */
function at(mb: MeshBuilder, sp: Span, s: number, lat: number, up: number): MeshBuilder {
  return mb.t(sp.x(s, lat), sp.y(s) + up, sp.z(s, lat)).ry(sp.yaw).rz(sp.slope(s));
}

/** points along the deck every ~`step` metres at lateral `lat`, lifted by `up(s)` */
function railLine(sp: Span, lat: number, up: (s: number) => number, step: number, sag = 0): Vector3[] {
  const n = Math.max(2, Math.round(sp.len / step));
  const out: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * sp.len;
    out.push(sp.pt(s, lat, up(s)));
    if (sag > 0 && i < n) out.push(sp.pt(((i + 0.5) / n) * sp.len, lat, up(((i + 0.5) / n) * sp.len) - sag));
  }
  return out;
}

const WOOD = { color: PAL.woodMid, color2: PAL.woodDark, blend: 0.3, uvs: 0.8, ao: 0, mottle: 0.12 } as const;
/** rope-bridge deck planks: PAL.woodLight about 5 % darker so the pale deck still separates from the sand */
const ROPE_DECK = '#9b8163';
const ROPE = { mat: MAT.cloth, color: PAL.rope, color2: PAL.ropeDark, blend: 0.3, ao: 0, uvs: 0.4 } as const;

/** continuous dark base under planks / pavers so the joints read as shadow, not as holes onto the water */
function subDeck(mb: MeshBuilder, sp: Span, hw: number, up: number, color: string | Color, mat: (typeof MAT)[keyof typeof MAT]): void {
  mb.set({ mat, color, color2: color, blend: 0, ao: 0, mottle: 0.05 });
  mb.surface(
    Math.max(2, Math.round(sp.len / 1.5)),
    1,
    (u, v, p) => {
      const s = u * sp.len;
      const lat = (v * 2 - 1) * hw;
      p.x = sp.x(s, lat);
      p.y = sp.y(s) + up;
      p.z = sp.z(s, lat);
      p.u = s;
      p.v = v;
    },
    { flip: true },
  );
}

// ---- wood -----------------------------------------------------------------------------------------------------------

function woodBridge(mb: MeshBuilder, sp: Span): void {
  const rng = mb.rng;
  const hw = sp.b.width / 2 - 0.45;
  // deck planks, each a little different
  subDeck(mb, sp, hw, -0.1, '#3a2b1e', MAT.wood);
  mb.set({ mat: MAT.wood, ...WOOD });
  const rows = Math.max(2, Math.round(sp.len / 0.34));
  for (let i = 0; i < rows; i++) {
    const s = ((i + 0.5) / rows) * sp.len;
    mb.scope(() => {
      mb.set({ color: vary(rng() < 0.12 ? '#8a7660' : PAL.woodMid, rng, 0.18), blend: rng() < 0.1 ? 0.7 : 0.25 });
      at(mb, sp, s, (rng() - 0.5) * 0.06, -0.02 + (rng() - 0.5) * 0.012).ry((rng() - 0.5) * 0.04);
      mb.box(sp.len / rows - 0.03, 0.1, hw * 2 + 0.06 + rng() * 0.12, { soft: 0.25, grain: 'z' });
    });
  }
  // log curbs on the deck edges and stringers underneath
  for (const side of [-1, 1]) {
    mb.set({ mat: MAT.bark, color: '#6d5b49', color2: '#3a2b1e', blend: 0.4, uvs: 0.9, ao: 0 });
    mb.tube(railLine(sp, side * (hw + 0.12), () => 0.06, 1.0), 0.13, { radial: 6, cap0: 'flat', cap1: 'flat', wobble: (t, a) => 1 + 0.07 * Math.sin(t * 40 + a * 8) });
    mb.tube(railLine(sp, side * hw * 0.55, () => -0.3, 1.2), 0.15, { radial: 5, cap0: 'flat', cap1: 'flat' });
  }
  // bents: paired posts standing in the channel with a cap beam and an X brace
  const bents = Math.floor(sp.len / 6.2);
  for (let k = 1; k <= bents; k++) {
    const s = (k / (bents + 1)) * sp.len;
    const top = sp.y(s) - 0.3;
    const posts: Vector3[] = [];
    for (const side of [-1, 1]) {
      const lat = side * (hw - 0.2);
      const bed = sp.bed(s, lat);
      if (top - bed < 0.6) continue;
      posts.push(V(sp.x(s, lat), bed + 0.5, sp.z(s, lat)));
      mb.set({ mat: MAT.bark, color: '#6d5b49', color2: '#3a2b1e', blend: 0.4, uvs: 0.9, ao: 0.5, aoH: 1.2, groundY: bed });
      mb.tube([V(sp.x(s, lat), bed - 0.3, sp.z(s, lat)), V(sp.x(s, lat), top, sp.z(s, lat))], (t) => 0.22 - 0.04 * t, { radial: 6, cap0: 'open', cap1: 'flat', wobble: (t, a) => 1 + 0.06 * Math.sin(t * 9 + a * 7 + k) });
    }
    if (posts.length === 2) {
      const [a, b] = posts as [Vector3, Vector3];
      mb.set({ mat: MAT.wood, ...WOOD, ao: 0 });
      mb.pole(a, V(b.x, top - 0.45, b.z), 0.07, 0.07, { radial: 4, cap0: 'flat', cap1: 'flat' });
      mb.pole(b, V(a.x, top - 0.45, a.z), 0.07, 0.07, { radial: 4, cap0: 'flat', cap1: 'flat' });
    }
  }
  // rail posts with a pole rail, rope rail and ties
  const nPost = Math.max(2, Math.round(sp.len / 1.6));
  for (const side of [-1, 1]) {
    const lat = side * (hw + 0.12);
    const tops: Vector3[] = [];
    const mids: Vector3[] = [];
    for (let i = 0; i <= nPost; i++) {
      const s = (i / nPost) * sp.len;
      const h = (i === 0 || i === nPost ? 1.35 : 1.0) + (rng() - 0.5) * 0.08;
      mb.set({ mat: MAT.bark, color: vary('#7a6551', rng, 0.15), color2: '#3a2b1e', blend: 0.4, uvs: 0.9, ao: 0.3, aoH: 0.4, groundY: sp.y(s) });
      mb.tube([sp.pt(s, lat, -0.12), sp.pt(s, lat, h)], i === 0 || i === nPost ? 0.1 : 0.072, { radial: 5, cap0: 'open', cap1: 0.1 });
      tops.push(sp.pt(s, lat, h * 0.9));
      mids.push(sp.pt(s, lat, h * 0.5));
    }
    mb.set({ mat: MAT.wood, ...WOOD, ao: 0 });
    mb.tube(tops, 0.05, { radial: 4, cap0: 'flat', cap1: 'flat' });
    mb.set(ROPE);
    const sagged: Vector3[] = [];
    mids.forEach((m, i) => {
      sagged.push(m);
      const nx = mids[i + 1];
      if (nx) sagged.push(V((m.x + nx.x) / 2, (m.y + nx.y) / 2 - 0.07, (m.z + nx.z) / 2));
    });
    rope(mb, sagged, 0.03);
  }
}

// ---- rope -----------------------------------------------------------------------------------------------------------

function ropeBridge(mb: MeshBuilder, sp: Span): void {
  const rng = mb.rng;
  const hw = sp.b.width / 2 - 0.55;
  const t01 = (s: number): number => Math.abs((2 * s) / sp.len - 1);
  const rail = (s: number): number => 1.0 + 1.45 * t01(s) ** 3;
  mb.set({ mat: MAT.wood, color: ROPE_DECK, color2: PAL.woodDark, blend: 0.3, uvs: 0.7, ao: 0, mottle: 0.12 });
  const rows = Math.max(2, Math.round(sp.len / 0.42));
  for (let i = 0; i < rows; i++) {
    const s = ((i + 0.5) / rows) * sp.len;
    mb.scope(() => {
      mb.set({ color: vary(rng() < 0.15 ? '#9d8668' : ROPE_DECK, rng, 0.18), blend: rng() < 0.12 ? 0.6 : 0.2 });
      at(mb, sp, s, 0, -0.02).ry((rng() - 0.5) * 0.05).rx((rng() - 0.5) * 0.02);
      mb.box(0.33, 0.07, hw * 2 + 0.04 + rng() * 0.08, { soft: 0.3, grain: 'z' });
    });
  }
  mb.set(ROPE);
  for (const side of [-1, 1]) {
    rope(mb, railLine(sp, side * (hw + 0.06), () => -0.06, 1.0), 0.06);
    rope(mb, railLine(sp, side * (hw + 0.2), (s) => rail(s), 1.0, 0.05), 0.045);
    rope(mb, railLine(sp, side * (hw + 0.2), (s) => rail(s) * 0.5, 1.0, 0.05), 0.03);
    const n = Math.max(2, Math.round(sp.len / 1.25));
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * sp.len;
      rope(mb, [sp.pt(s, side * (hw + 0.06), -0.04), sp.pt(s, side * (hw + 0.2), rail(s))], 0.022, { twist: 6 });
    }
  }
  rope(mb, railLine(sp, 0, () => -0.14, 1.4), 0.075);
  // towers at both ends: leaning pairs of logs, a cross beam, and back-stay ropes to the ground
  for (const end of [0, 1]) {
    const s = end * sp.len;
    const dir = end === 0 ? -1 : 1;
    const topUp = rail(s) + 0.2;
    const posts: Vector3[] = [];
    for (const side of [-1, 1]) {
      const lat = side * (hw + 0.35);
      const bed = Math.min(sp.bed(s, lat), sp.y(s)) - 0.4;
      const base = V(sp.x(s, lat), bed, sp.z(s, lat));
      const top = sp.pt(s, lat + side * 0.1, topUp);
      posts.push(top);
      mb.set({ mat: MAT.bark, color: '#6d5b49', color2: '#3a2b1e', blend: 0.4, uvs: 0.9, ao: 0.5, aoH: 1.0, groundY: bed });
      mb.tube([base, top], (t) => 0.2 - 0.06 * t, { radial: 6, cap0: 'open', cap1: 0.14, wobble: (t, a) => 1 + 0.06 * Math.sin(t * 11 + a * 7 + side) });
      mb.set(ROPE);
      const anchorS = s + dir * 3.2;
      const aLat = lat + side * 0.8;
      const gy = sp.bed(anchorS, aLat);
      rope(mb, [top, V(sp.x(anchorS, aLat), gy + 0.1, sp.z(anchorS, aLat))], 0.04, { twist: 8 });
      mb.set({ mat: MAT.wood, ...WOOD });
      mb.pole(V(sp.x(anchorS, aLat), gy - 0.25, sp.z(anchorS, aLat)), V(sp.x(anchorS, aLat), gy + 0.4, sp.z(anchorS, aLat)), 0.07, 0.06, { radial: 4, cap0: 'open', cap1: 'flat' });
    }
    const [pa, pb] = posts as [Vector3, Vector3];
    mb.set({ mat: MAT.wood, ...WOOD });
    mb.pole(V(pa.x, pa.y - 0.35, pa.z), V(pb.x, pb.y - 0.35, pb.z), 0.11, 0.11, { radial: 5, cap0: 'flat', cap1: 'flat', lenSeg: 2 });
    mb.scope(() => {
      mb.t((pa.x + pb.x) / 2, pa.y - 0.4, (pa.z + pb.z) / 2).ry(sp.yaw + Math.PI / 2);
      banner(mb, { w: 0.62, h: 1.15, tail: 0.28, cloth: PAL.red, trim: PAL.gold, swayTop: 0.08 });
    });
  }
}

// ---- stone ----------------------------------------------------------------------------------------------------------

interface Arch {
  a0: number;
  a1: number;
  crown: number;
  rise: number;
}

function archesOf(sp: Span): Arch[] {
  let sA = Infinity;
  let sB = -Infinity;
  for (let s = 0; s <= sp.len; s += 0.5) {
    if (sp.y(s) - sp.bed(s, 0) > 1.3) {
      sA = Math.min(sA, s);
      sB = Math.max(sB, s);
    }
  }
  if (sB - sA < 4) {
    sA = sp.len * 0.28;
    sB = sp.len * 0.72;
  }
  const n = Math.max(1, Math.round((sB - sA) / 12));
  const out: Arch[] = [];
  for (let k = 0; k < n; k++) {
    const a0 = sA + ((sB - sA) * k) / n + (k > 0 ? 0.8 : 0);
    const a1 = sA + ((sB - sA) * (k + 1)) / n - (k < n - 1 ? 0.8 : 0);
    out.push({ a0, a1, crown: sp.y((a0 + a1) / 2) - 0.6, rise: Math.min(3.4, Math.max(1.2, 0.28 * (a1 - a0))) });
  }
  return out;
}

const soffit = (a: Arch, s: number): number => {
  const h = (a.a1 - a.a0) / 2;
  const u = (s - (a.a0 + a.a1) / 2) / h;
  return a.crown - a.rise * u * u;
};

function lantern(mb: MeshBuilder, sp: Span, s: number, lat: number, look: StoneLook): void {
  const rng = mb.rng;
  mb.scope(() => {
    mb.t(sp.x(s, lat), sp.y(s), sp.z(s, lat)).ry(sp.yaw);
    mb.set({ mat: MAT.stone, color: vary('#aaa597', rng, 0.08).multiply(look.mul), color2: look.accent, blend: 0.2, uvs: 0.8, ao: 0.4, aoH: 0.8, groundY: sp.y(s) });
    mb.t(0, 0.75, 0).box(0.58, 1.5, 0.58, { soft: 0.45 });
    mb.t(0, 0.8, 0).box(0.74, 0.14, 0.74, { soft: 0.4 });
    mb.set({ mat: MAT.glow, color: '#9a4c14', color2: '#c9701f', blend: 0.3, ao: 0 });
    mb.t(0, 0.3, 0).lathe(
      [
        [0.05, -0.18],
        [0.15, -0.14],
        [0.21, -0.05],
        [0.21, 0.06],
        [0.15, 0.14],
        [0.06, 0.18],
      ],
      { seg: 8 },
    );
    mb.set({ mat: MAT.stone, color: toned(look, '#8d897c'), color2: look.accent, blend: 0.15, ao: 0 });
    mb.t(0, 0.2, 0).spike(0.34, 0.3, 4);
  });
}

function stoneBridge(mb: MeshBuilder, sp: Span, look: StoneLook): void {
  const rng = mb.rng;
  const hw = sp.b.width / 2 - 0.55;
  const latF = hw + 0.22;
  const arches = archesOf(sp);
  const archAt = (s: number): Arch | undefined => arches.find((a) => s >= a.a0 && s <= a.a1);
  const stone = (c: string | Color = PAL.stone, k = 0.15): void => {
    mb.set({ mat: MAT.stone, color: toned(look, c), color2: look.accent, blend: k, uvs: 0.8, mottle: 0.15, mottleFreq: 1.8, ao: 0.35, aoH: 0.5, jitter: 0.06 });
  };

  // paving: two slabs per row so the joints break, over a continuous base so no joint shows the water
  subDeck(mb, sp, hw, -0.12, toned(look, '#4d4a43'), MAT.stone);
  const rows = Math.max(2, Math.round(sp.len / 0.55));
  for (let i = 0; i < rows; i++) {
    const s = ((i + 0.5) / rows) * sp.len;
    const split = (rng() - 0.5) * 1.2;
    for (const [c0, c1] of [
      [-hw, split],
      [split, hw],
    ] as const) {
      mb.scope(() => {
        stone(vary('#a29d90', rng, 0.12), 0.25);
        mb.set({ ao: 0 });
        at(mb, sp, s, (c0 + c1) / 2, -0.04);
        mb.box(sp.len / rows + 0.01, 0.12, c1 - c0 + 0.005, { soft: 0.4 });
      });
    }
  }

  // soffit (underside of the arches), facing down
  for (const a of arches) {
    stone('#5d5a52', 0.35);
    mb.set({ ao: 0 });
    mb.surface(
      12,
      1,
      (u, v, p) => {
        const s = a.a0 + u * (a.a1 - a.a0);
        const lat = (v * 2 - 1) * latF;
        p.x = sp.x(s, lat);
        p.y = soffit(a, s);
        p.z = sp.z(s, lat);
        p.u = s / 1.2;
        p.v = v * 3;
        p.k = 0.2 + 0.3 * u * (1 - u);
      },
    );
  }

  for (const side of [-1, 1]) {
    // facade: courses of ashlar between the arch edge (or the ground) and the deck
    const y0 = Math.min(sp.bed(0, side * latF), sp.bed(sp.len, side * latF), sp.bed(sp.len / 2, side * latF)) - 0.3;
    const ch = 0.42;
    const rowsF = Math.ceil((sp.b.yMid + 1 - y0) / ch);
    for (let r = 0; r < rowsF; r++) {
      let s = -0.2 - rng() * 0.7;
      while (s < sp.len + 0.2) {
        const bw = 0.6 + rng() * 0.45;
        const sa = Math.max(-0.2, s);
        const sb = Math.min(sp.len + 0.2, s + bw);
        s += bw;
        if (sb - sa < 0.2) continue;
        const sm = (sa + sb) / 2;
        const arch = archAt(sm);
        const bottom = Math.max(sp.bed(sm, side * latF) - 0.3, arch ? soffit(arch, sm) + 0.42 : -Infinity);
        const top = sp.y(sm) - 0.02;
        const lo = Math.max(y0 + r * ch, bottom);
        const hi = Math.min(y0 + (r + 1) * ch, top);
        if (hi - lo < 0.12) continue;
        mb.scope(() => {
          stone(vary(rng() < 0.15 ? '#aaa597' : PAL.stone, rng, 0.14), Math.max(0.12, 0.55 - (r * ch) / 6));
          mb.set({ groundY: y0 });
          mb.t(sp.x(sm, side * latF), (lo + hi) / 2, sp.z(sm, side * latF)).ry(sp.yaw);
          mb.box(sb - sa - 0.03, hi - lo - 0.015, 0.5, { soft: 0.5 });
        });
      }
    }
    // voussoir ring and keystone around every arch opening
    for (const a of arches) {
      const chord = a.a1 - a.a0;
      const n = Math.max(6, Math.round(chord / 0.72));
      for (let i = 0; i <= n; i++) {
        const s = a.a0 + (i / n) * chord;
        const ds = 0.1;
        const ang = Math.atan2(soffit(a, Math.min(a.a1, s + ds)) - soffit(a, Math.max(a.a0, s - ds)), Math.min(a.a1, s + ds) - Math.max(a.a0, s - ds));
        const keystone = i === Math.round(n / 2) && n % 2 === 0;
        mb.scope(() => {
          stone(keystone ? '#c0b9a6' : vary('#a9a495', rng, 0.1), 0.1);
          mb.set({ groundY: soffit(a, s) });
          mb.t(sp.x(s, side * (latF + (keystone ? 0.05 : 0))), soffit(a, s) + (keystone ? 0.36 : 0.26), sp.z(s, side * (latF + (keystone ? 0.05 : 0)))).ry(sp.yaw).rz(ang);
          mb.box(keystone ? 0.82 : (chord / n) * 0.96, keystone ? 0.78 : 0.52, keystone ? 0.62 : 0.54, { soft: 0.45 });
        });
      }
    }
    // parapet: three courses and coping that follow the deck
    const lat = side * latF;
    for (let c = 0; c < 3; c++) {
      let s = -0.1 - rng() * 0.6;
      while (s < sp.len + 0.1) {
        const bw = 0.55 + rng() * 0.4;
        const sa = Math.max(-0.1, s);
        const sb = Math.min(sp.len + 0.1, s + bw);
        s += bw;
        if (sb - sa < 0.2) continue;
        mb.scope(() => {
          stone(vary(PAL.stone, rng, 0.14), 0.3);
          at(mb, sp, (sa + sb) / 2, lat, 0.12 + c * 0.26 - 0.02);
          mb.box(sb - sa - 0.03, 0.26, 0.44, { soft: 0.5 });
        });
      }
    }
    let s = -0.1;
    while (s < sp.len + 0.1) {
      const bw = 0.8 + rng() * 0.25;
      const sb = Math.min(sp.len + 0.1, s + bw);
      mb.scope(() => {
        stone(vary('#b4af9f', rng, 0.1), 0.35);
        at(mb, sp, (s + sb) / 2, lat, 0.12 + 0.78 + 0.08);
        mb.box(sb - s - 0.04, 0.17, 0.62, { soft: 0.45 });
      });
      s = sb;
    }
    // lantern pillars at both ends
    lantern(mb, sp, 0.35, lat, look);
    lantern(mb, sp, sp.len - 0.35, lat, look);
  }
}

// ---- assembly -------------------------------------------------------------------------------------------------------

export function buildBridges(bridges: readonly Bridge[], field: Field, ctx: StructureBuildContext): BridgesResult {
  const group = new Group();
  group.name = 'bridges';
  if (bridges.length === 0) return { group, dispose() {} };
  const mb = new MeshBuilder(2024);
  const look = stoneLook(ctx.zone);
  for (const b of bridges) {
    const sp = new Span(b, field);
    mb.scope(() => {
      if (b.kind === 'wood') woodBridge(mb, sp);
      else if (b.kind === 'rope') ropeBridge(mb, sp);
      else stoneBridge(mb, sp, look);
    });
  }
  const geo: BufferGeometry = mb.build();
  const mat: Material = structureMaterial(ctx, { roughness: 0.92, doubleSided: true, sway: true, stoneTexture: look.tex });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'bridges';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return {
    group,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
