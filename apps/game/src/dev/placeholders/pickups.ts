// DEV-only: static pickup placeholders — faceted XP gem (neutral, tintable), Korean-style yeop coin, health potion and
// the three chests. Authoring: origin on the ground at the footprint centre, +Z faces the camera/player.
import type { PlaceholderModel } from '../../engine/assets';
import { assembleModel } from './model';
import { MeshBuilder, circle, type ColorFn, type Section } from './parts';
import { clamp, noise3, type RGB, type Vec3 } from './math';
import { rgb } from './sdf';

const TAU = Math.PI * 2;

function facetShade(i: number, j: number, base: number, amp: number): number {
  const h = ((Math.imul(i * 31 + 7, 0x9e3779b1) ^ Math.imul(j * 17 + 3, 0x85ebca6b)) >>> 0) / 4294967296;
  return base + (h - 0.5) * 2 * amp;
}

function gem(): { b: MeshBuilder; palette: string[] } {
  const b = new MeshBuilder();
  // brilliant-style cut: culet, pavilion, girdle, crown with star facets, table. Neutral greys (tintable per tier).
  const rings: { y: number; r: number; phase: number }[] = [
    { y: 0.0, r: 0.004, phase: 0 },
    { y: 0.045, r: 0.052, phase: Math.PI / 8 },
    { y: 0.088, r: 0.088, phase: 0 },
    { y: 0.1, r: 0.09, phase: 0 },
    { y: 0.14, r: 0.07, phase: Math.PI / 8 },
    { y: 0.165, r: 0.044, phase: 0 },
  ];
  const secs: Section[] = rings.map((rg, k) => ({
    c: [0, 0.02 + rg.y, 0],
    ax: [1, 0, 0],
    ay: [0, 0, -1],
    pts: circle(8, rg.r, rg.r, rg.phase),
    color: ((_p, _n, _i, j) => {
      const v = clamp(facetShade(k, j, k < 3 ? 0.62 : 0.8, k < 3 ? 0.16 : 0.15), 0.35, 1);
      return [v, v, v * 1.02] as RGB;
    }) as ColorFn,
  }));
  b.loft(secs, { flat: true, capEnd: true });
  // table highlight (a touch brighter)
  return { b, palette: ['#cfd3d8', '#8e949c'] };
}

function coin(): { b: MeshBuilder; palette: string[] } {
  const b = new MeshBuilder();
  const N = 28;
  const R = 0.104;
  const t = 0.012;
  const sqPt = (k: number, half: number): [number, number] => {
    // square boundary point at the angle of ring index k
    const a = (k / N) * TAU + Math.PI / 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = Math.max(Math.abs(c), Math.abs(s));
    return [(c / m) * half, (s / m) * half];
  };
  const cirPt = (k: number, r: number): [number, number] => {
    const a = (k / N) * TAU + Math.PI / 4;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  // stations from the hole outwards: blend 0 = square (half-size), 1 = circle (radius)
  const st = [
    { bl: 0, s: 0.031, z: 0.5 * t },
    { bl: 0, s: 0.036, z: 1.0 * t },
    { bl: 0, s: 0.045, z: 1.0 * t },
    { bl: 0, s: 0.05, z: 0.55 * t },
    { bl: 0.55, s: 0.07, z: 0.5 * t },
    { bl: 1, s: 0.086, z: 0.5 * t },
    { bl: 1, s: 0.09, z: 1.0 * t },
    { bl: 1, s: 0.099, z: 1.0 * t },
    { bl: 1, s: R, z: 0.45 * t },
  ];
  const gold1: RGB = rgb('#f0cf6a');
  const gold2: RGB = rgb('#b88a2c');
  const gold3: RGB = rgb('#7a5a1c');
  const colorOf = (si: number, p: Vec3): RGB => {
    const rim = si === 1 || si === 2 || si === 6 || si === 7;
    const k = 0.9 + (noise3(p[0] * 30, p[1] * 30, p[2] * 30, 4) - 0.5) * 0.3;
    const base = rim ? gold1 : si === 0 || si === 3 ? gold3 : gold2;
    return [base[0] * k, base[1] * k, base[2] * k];
  };
  const pos = (si: number, k: number, face: 1 | -1): Vec3 => {
    const s = st[si] as (typeof st)[number];
    const sq = sqPt(k, s.s);
    const ci = cirPt(k, s.s);
    const x = sq[0] + (ci[0] - sq[0]) * s.bl;
    const y = sq[1] + (ci[1] - sq[1]) * s.bl;
    return [x, y + R, s.z * face];
  };
  for (const face of [1, -1] as const) {
    for (let si = 0; si < st.length - 1; si++) {
      for (let k = 0; k < N; k++) {
        const k2 = (k + 1) % N;
        const a = pos(si, k, face);
        const bq = pos(si, k2, face);
        const c = pos(si + 1, k2, face);
        const d = pos(si + 1, k, face);
        const col: ColorFn = (p) => colorOf(si, p);
        // front face (z>0): outward normal +z. Winding: with angle increasing CCW seen from +z, (a,d,c,bq) goes outward→CCW
        if (face > 0) b.quad(a, d, c, bq, col);
        else b.quad(a, bq, c, d, col);
      }
    }
  }
  // outer rim band
  for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N;
    const lastS = st.length - 1;
    const a = pos(lastS, k, 1);
    const bq = pos(lastS, k2, 1);
    const c = pos(lastS, k2, -1);
    const d = pos(lastS, k, -1);
    b.quad(a, bq, c, d, (p) => colorOf(7, p));
  }
  // hole walls (normals toward the hole centre)
  for (let k = 0; k < N; k++) {
    const k2 = (k + 1) % N;
    const a = pos(0, k, 1);
    const bq = pos(0, k2, 1);
    const c = pos(0, k2, -1);
    const d = pos(0, k, -1);
    b.quad(a, d, c, bq, (p) => colorOf(0, p));
  }
  // four raised inscription marks on the field
  for (const [x, y, w, h] of [[0, 0.067, 0.02, 0.008], [0, -0.067, 0.02, 0.008], [0.067, 0, 0.008, 0.02], [-0.067, 0, 0.008, 0.02]] as const) {
    for (const face of [1, -1] as const) b.box([x, y + R, face * (0.5 * t + 0.003)], [w, h, 0.0035], 0.0018, '#e6c25a');
  }
  return { b, palette: ['#d9b24a', '#b88a2c', '#7a5a1c'] };
}

function potion(): { b: MeshBuilder; palette: string[] } {
  const b = new MeshBuilder();
  const prof: [number, number][] = [];
  // round-bottom flask: sphere of radius .095 centred at y=.105, neck r .026 up to y=.27 with a flared lip
  const cy = 0.105;
  const R = 0.095;
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 0.82;
    prof.push([Math.max(0.004, Math.sin(a) * R), cy - Math.cos(a) * R]);
  }
  prof.push([0.034, 0.188], [0.026, 0.215], [0.024, 0.25], [0.03, 0.262], [0.031, 0.272]);
  const liquidTop = 0.16;
  const deep = rgb('#8e1018');
  const bright = rgb('#e03a3a');
  const glass = rgb('#d7e4ea');
  b.lathe(prof, 20, {
    color: (p, n) => {
      const spec = Math.pow(Math.max(0, n[0] * 0.6 + n[1] * 0.4 + n[2] * 0.2), 10);
      if (p[1] < liquidTop) {
        const k = clamp(p[1] / liquidTop, 0, 1);
        const rim = 1 - Math.abs(n[1]) * 0.4;
        const c: RGB = [deep[0] + (bright[0] - deep[0]) * k * rim, deep[1] + (bright[1] - deep[1]) * k, deep[2] + (bright[2] - deep[2]) * k];
        return [Math.min(1, c[0] + spec * 0.6), Math.min(1, c[1] + spec * 0.6), Math.min(1, c[2] + spec * 0.6)];
      }
      return [Math.min(1, glass[0] * 0.8 + spec * 0.5), Math.min(1, glass[1] * 0.8 + spec * 0.5), Math.min(1, glass[2] * 0.8 + spec * 0.5)];
    },
    capStart: true,
  });
  // gold neck ring and cork
  b.lathe([[0.027, 0.224], [0.034, 0.23], [0.034, 0.238], [0.027, 0.244]], 16, { color: '#d9b24a' });
  b.lathe([[0.024, 0.268], [0.027, 0.275], [0.027, 0.3], [0.022, 0.31], [0.001, 0.31]], 12, { color: (p) => rgb(p[1] > 0.29 ? '#9b6a3a' : '#b4814a'), capStart: true });
  // tiny cross label
  b.box([0, 0.085, 0.093], [0.032, 0.026, 0.004], 0.0025, '#efe3c4');
  b.box([0, 0.085, 0.0975], [0.006, 0.016, 0.002], 0.001, '#a8272a');
  b.box([0, 0.085, 0.0975], [0.016, 0.006, 0.002], 0.001, '#a8272a');
  return { b, palette: ['#c8242c', '#d7e4ea', '#9b6a3a'] };
}

interface ChestStyle {
  wood: string;
  wood2: string;
  metal: string;
  metal2: string;
  scale: number;
  jewel?: string;
  spikes?: boolean;
}

function archProfile(w: number, hBase: number, hArch: number, n = 10): [number, number][] {
  // closed cross-section (z,y): flat bottom, straight sides, elliptical arch; counter-clockwise
  const pts: [number, number][] = [];
  pts.push([w, 0]);
  pts.push([w, hBase]);
  for (let i = 1; i < n; i++) {
    const a = (i / n) * Math.PI;
    pts.push([Math.cos(a) * w, hBase + Math.sin(a) * hArch]);
  }
  pts.push([-w, hBase]);
  pts.push([-w, 0]);
  return pts;
}

function chest(st: ChestStyle): { b: MeshBuilder; palette: string[] } {
  const b = new MeshBuilder();
  const s = st.scale;
  const W = 0.42 * s;
  const D = 0.28 * s;
  const H = 0.22 * s;
  const wood = rgb(st.wood);
  const wood2 = rgb(st.wood2);
  const grain: ColorFn = (p, _n, i, j) => {
    const stripe = noise3(p[0] * 6, p[1] * 40, p[2] * 6, 5);
    const k = 0.82 + stripe * 0.32 + (j % 2) * 0.03 + (i % 2) * 0.02;
    const c = stripe > 0.62 ? wood2 : wood;
    return [c[0] * k, c[1] * k, c[2] * k];
  };
  // body: four stacked planks with visible bevel grooves
  const planks = 4;
  for (let i = 0; i < planks; i++) {
    const ph = H / planks;
    b.box([0, ph * (i + 0.5), 0], [W, ph * 0.5 - 0.002 * s, D], 0.008 * s, grain);
  }
  // lid: barrel vault
  const hBase = 0.05 * s;
  const hArch = 0.13 * s;
  const lidY = H;
  const profile = archProfile(D * 0.98, hBase, hArch);
  const vault = (x: number, grow: number, color: ColorFn | string): Section => ({
    c: [x, lidY, 0],
    ax: [0, 0, 1],
    ay: [0, 1, 0],
    // cross-section is in (z,y); along +x requires ax × ay = +x → ax=z, ay=y gives z × y = -x, so flip direction below
    pts: profile.map(([z, y]) => [z * (1 + grow), y + (y > hBase ? grow * 0.5 : 0) * s] as [number, number]),
    color,
  });
  // loft direction = ax × ay = (0,0,1)×(0,1,0) = (-1,0,0): sections run from +x to -x
  b.loft([vault(W * 1.0, -0.06, grain), vault(W * 0.96, 0, grain), vault(-W * 0.96, 0, grain), vault(-W * 1.0, -0.06, grain)], { capStart: true, capEnd: true });
  // bands (metal) around lid + body
  const metal = rgb(st.metal);
  const metal2 = rgb(st.metal2);
  const bandColor: ColorFn = (_p, _n, _i, j) => (j % 3 === 0 ? metal2 : metal);
  for (const x of [-0.68, -0.22, 0.22, 0.68].map((v) => v * W)) {
    const mk = (xx: number, g: number): Section => vault(xx, g, bandColor);
    b.loft([mk(x + 0.03 * s, 0.01), mk(x + 0.024 * s, 0.02), mk(x - 0.024 * s, 0.02), mk(x - 0.03 * s, 0.01)], { capStart: true, capEnd: true, flat: true });
    // body strap
    b.box([x, H / 2, 0], [0.024 * s, H / 2 + 0.004 * s, D + 0.008 * s], 0.004 * s, metal);
  }
  // corner studs
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      b.box([sx * (W - 0.014 * s), 0.02 * s, sz * (D - 0.014 * s)], [0.03 * s, 0.02 * s, 0.03 * s], 0.006 * s, metal2);
      b.box([sx * (W - 0.014 * s), H - 0.02 * s, sz * (D - 0.014 * s)], [0.03 * s, 0.02 * s, 0.03 * s], 0.006 * s, metal2);
    }
  }
  // lock plate
  b.box([0, H - 0.005 * s, D + 0.006 * s], [0.05 * s, 0.06 * s, 0.012 * s], 0.008 * s, metal);
  b.box([0, H - 0.02 * s, D + 0.017 * s], [0.016 * s, 0.022 * s, 0.006 * s], 0.004 * s, st.jewel ?? '#1a1410');
  if (st.jewel) {
    b.lathe([[0.001, 0], [0.02 * s, 0.015 * s], [0.014 * s, 0.03 * s], [0.001, 0.036 * s]], 8, { origin: [0, H + 0.02 * s, D + 0.022 * s], color: st.jewel, sz: 0.6 });
  }
  if (st.spikes) {
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        b.lathe([[0.016 * s, 0], [0.012 * s, 0.05 * s], [0.001, 0.13 * s]], 6, { origin: [sx * (W - 0.02 * s), H + 0.02 * s, sz * (D - 0.02 * s)], color: metal2 });
      }
    }
    // crest on the lid
    b.lathe([[0.001, 0], [0.03 * s, 0.01 * s], [0.02 * s, 0.05 * s], [0.001, 0.09 * s]], 8, { origin: [0, H + hBase + hArch - 0.01 * s, 0], color: metal2, sx: 1.4 });
  }
  b.speckle(0.05, 30, 9);
  return { b, palette: [st.wood, st.metal, st.metal2] };
}

export function makePickup(id: string, item: string): PlaceholderModel {
  let built: { b: MeshBuilder; palette: string[] };
  switch (item) {
    case 'yeop_coin':
      built = coin();
      break;
    case 'potion_hp':
      built = potion();
      break;
    case 'chest_gold':
      built = chest({ wood: '#7a1f1c', wood2: '#5e1512', metal: '#e0b94c', metal2: '#b88a2c', scale: 1.15 });
      break;
    case 'chest_boss':
      built = chest({ wood: '#1f1a22', wood2: '#2c2432', metal: '#d9b24a', metal2: '#8f6a22', scale: 1.6, jewel: '#3fe0e8', spikes: true });
      break;
    case 'chest_wood':
      built = chest({ wood: '#7a5230', wood2: '#5a3a20', metal: '#5b6068', metal2: '#3b3f46', scale: 1 });
      break;
    default:
      built = gem();
  }
  const bb = built.b.bounds();
  const geometry = built.b.toGeometry();
  return assembleModel({
    id,
    kind: 'pickup',
    parts: [{ name: item, geometry }],
    height: bb.max[1],
    radius: Math.max(0.1, Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) / 2),
    palette: built.palette,
    extra: { item },
  });
}
