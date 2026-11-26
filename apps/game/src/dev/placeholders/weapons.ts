// DEV-only: hard-surface weapon placeholders built from lofts/lathes. Authoring frame: grip centre at the origin, the
// weapon's long axis along +Y, flat faces toward ±Z. `attach` (extras) is the hand_r socket transform that holds the
// weapon upright in the hero guard pose.
import type { PlaceholderModel } from '../../engine/assets';
import { assembleModel } from './model';
import { MeshBuilder, circle, type ColorFn, type Section } from './parts';
import { Rng, clamp, type RGB, type Vec3 } from './math';
import { rgb } from './sdf';

const STEEL = { edge: '#f0f4f8', face: '#aab6c2', ridge: '#7e8a98' };
const GOLD = '#d9b24a';
const GOLD_D = '#a87a26';
const LACQ = '#9c2b24';
const WOOD = '#6b4528';
const WOOD_D = '#47301c';
const LEATHER = '#35261d';

const AX: Vec3 = [1, 0, 0];

function frameAlong(p0: Vec3, p1: Vec3): { ax: Vec3; ay: Vec3 } {
  const f: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const l = Math.hypot(f[0], f[1], f[2]) || 1;
  const fn: Vec3 = [f[0] / l, f[1] / l, f[2] / l];
  // ay = f × AX  (so AX × ay = f)
  const ay: Vec3 = [fn[1] * AX[2] - fn[2] * AX[1], fn[2] * AX[0] - fn[0] * AX[2], fn[0] * AX[1] - fn[1] * AX[0]];
  return { ax: AX, ay };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface BladeOpts {
  y0: number;
  len: number;
  w: number;
  t: number;
  /** z offset at the tip (curved blades) */
  curve?: number;
  /** relative width at the tip shoulder (0..1) */
  taper?: number;
  edge?: string;
  face?: string;
  ridge?: string;
  /** colour of the cutting-edge line (glow for demonic blades) */
  edgeGlow?: string;
  /** leaf profile: widest at this fraction */
  belly?: number;
}

/** Flat-shaded diamond-section blade with a tapered, sharp tip. */
function blade(b: MeshBuilder, o: BladeOpts): void {
  const stations = [0, 0.04, 0.3, 0.6, 0.82, 0.93, 1];
  const taper = o.taper ?? 0.72;
  const belly = o.belly ?? 0;
  const edge = rgb(o.edgeGlow ?? o.edge ?? STEEL.edge);
  const face = rgb(o.face ?? STEEL.face);
  const ridge = rgb(o.ridge ?? STEEL.ridge);
  const centre = (s: number): Vec3 => [0, o.y0 + s * o.len, (o.curve ?? 0) * s * s];
  const secs: Section[] = stations.map((s) => {
    let w = o.w * lerp(1, taper, s);
    if (belly > 0) w *= 1 + belly * Math.sin(Math.PI * Math.min(1, s * 1.2)) * 0.55;
    let t = o.t * lerp(1, 0.7, s);
    if (s > 0.9) {
      const k = (s - 0.9) / 0.1;
      w *= 1 - 0.96 * Math.pow(k, 0.8);
      t *= 1 - 0.8 * k;
    }
    const c = centre(s);
    const next = centre(Math.min(1, s + 0.02));
    const prev = centre(Math.max(0, s - 0.02));
    const { ax, ay } = frameAlong(prev, next);
    const pts: [number, number][] = [
      [w, 0],
      [w * 0.28, t],
      [-w * 0.28, t],
      [-w, 0],
      [-w * 0.28, -t],
      [w * 0.28, -t],
    ];
    const bright = 1 + 0.12 * s;
    const fn: ColorFn = (_p, _n, _i, j) => {
      const base = j === 0 || j === 3 ? edge : j === 1 || j === 2 || j === 4 || j === 5 ? (j === 1 || j === 4 ? face : ridge) : face;
      return [Math.min(1, base[0] * bright), Math.min(1, base[1] * bright), Math.min(1, base[2] * bright)];
    };
    return { c, ax, ay, pts, color: fn };
  });
  b.loft(secs, { flat: true, capEnd: true, capStart: true });
}

function wrappedGrip(b: MeshBuilder, y0: number, y1: number, r: number, c1: string, c2: string, n = 12): void {
  const prof: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const y = lerp(y0, y1, i / n);
    prof.push([r * (1 + 0.05 * Math.sin((i / n) * Math.PI) + (i % 2 ? 0.07 : 0)), y]);
  }
  const A = rgb(c1);
  const B = rgb(c2);
  b.lathe(prof, 9, { color: (_p, _n, i) => (i % 2 ? A : B), capStart: true, capEnd: true });
}

function guard(b: MeshBuilder, y: number, rx: number, rz: number, color: string, thick = 0.009): void {
  b.lathe(
    [
      [0.001, y - thick],
      [rx * 0.7, y - thick],
      [rx, y - thick * 0.3],
      [rx, y + thick * 0.3],
      [rx * 0.7, y + thick],
      [0.001, y + thick],
    ],
    16,
    { color, sx: 1, sz: rz / rx, capStart: false },
  );
}

function bulb(b: MeshBuilder, c: Vec3, r: number, color: string | ColorFn, sy = 1, segs = 12, rings = 7): void {
  const prof: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const a = (i / rings) * Math.PI;
    prof.push([Math.max(1e-3, Math.sin(a) * r), c[1] - Math.cos(a) * r * sy]);
  }
  b.lathe(prof, segs, { origin: [c[0], 0, c[2]], color });
}

function sword(b: MeshBuilder, rng: Rng, o: { len: number; w: number; guardW: number; trim: string; wrap: string; curve?: number }): void {
  wrappedGrip(b, -0.12, 0.1, 0.0175, o.wrap, LEATHER);
  guard(b, 0.108, o.guardW, 0.014, o.trim, 0.011);
  // gold fittings: collar under the guard, pommel
  b.lathe([[0.019, 0.095], [0.024, 0.1], [0.02, 0.1]], 12, { color: o.trim });
  bulb(b, [0, -0.14, 0], 0.03, o.trim, 0.9);
  b.lathe([[0.001, -0.172], [0.014, -0.168], [0.012, -0.15]], 10, { color: GOLD_D });
  blade(b, { y0: 0.118, len: o.len, w: o.w, t: 0.0075, curve: o.curve ?? 0, belly: rng.range(0, 0.1) });
}

function dagger(b: MeshBuilder): void {
  wrappedGrip(b, -0.08, 0.06, 0.0155, '#6b1d18', LEATHER, 9);
  guard(b, 0.068, 0.04, 0.012, GOLD, 0.008);
  bulb(b, [0, -0.09, 0], 0.022, GOLD, 0.9);
  blade(b, { y0: 0.076, len: 0.3, w: 0.026, t: 0.0062, belly: 0.5, taper: 0.55 });
}

function surBlade(b: MeshBuilder): void {
  wrappedGrip(b, -0.13, 0.1, 0.0185, '#16171b', '#6b1d18', 14);
  // winged guard
  guard(b, 0.11, 0.07, 0.016, '#2b2d33', 0.012);
  for (const s of [1, -1]) {
    const sec = (x: number, y: number, r: number): Section => ({ c: [s * x, y, 0], ax: [1, 0, 0], ay: [0, 0, -1], pts: circle(6, r, r * 0.8) });
    b.loft([sec(0.04, 0.11, 0.013), sec(0.075, 0.135, 0.011), sec(0.1, 0.17, 0.004)], { capEnd: true });
  }
  bulb(b, [0, -0.15, 0], 0.032, '#2b2d33', 0.9);
  b.lathe([[0.001, -0.19], [0.016, -0.185], [0.014, -0.165]], 8, { color: '#a02a24' });
  blade(b, { y0: 0.12, len: 0.95, w: 0.034, t: 0.008, curve: 0.18, taper: 0.62, edge: '#2a2d36', face: '#262932', ridge: '#3a3f4a', edgeGlow: '#ff5a32' });
}

function bow(b: MeshBuilder): void {
  const R = 0.68;
  const arc = (s: number): Vec3 => [0, s * R, -0.17 * s * s];
  const S = 14;
  const secs: Section[] = [];
  for (let i = 0; i <= S; i++) {
    const s = -1 + (2 * i) / S;
    const p = arc(s);
    const a = arc(Math.max(-1, s - 0.03));
    const c = arc(Math.min(1, s + 0.03));
    const { ax, ay } = frameAlong(a, c);
    const wDepth = lerp(0.016, 0.0085, Math.abs(s));
    const wWidth = lerp(0.034, 0.01, Math.pow(Math.abs(s), 1.2));
    const tip = Math.abs(s) > 0.94 ? 0.6 : 1;
    const grade = Math.abs(s);
    secs.push({
      c: p,
      ax,
      ay,
      pts: circle(8, wWidth * tip, wDepth * tip),
      color: (_p, _n, _i, j) => (j > 3 ? rgb(grade < 0.2 ? LEATHER : '#8a5a2e') : rgb(grade < 0.2 ? LEATHER : '#b8863f')),
    });
  }
  b.loft(secs, { capStart: true, capEnd: true });
  // gold bindings and horn tips
  for (const s of [-0.74, -0.38, 0.38, 0.74]) {
    const p = arc(s);
    b.lathe([[0.0125, -0.007], [0.0165, -0.004], [0.0165, 0.004], [0.0125, 0.007]], 8, { origin: [p[0], p[1], p[2]], color: GOLD, sx: 1.7, sz: 1 });
  }
  for (const s of [-1, 1]) {
    const p = arc(s);
    bulb(b, [p[0], p[1] + s * 0.004, p[2]], 0.013, '#e8dfc6', 1.3, 8, 5);
  }
  // string
  const top = arc(1);
  const bot = arc(-1);
  const dir = frameAlong([bot[0], bot[1], bot[2] - 0.03], [top[0], top[1], top[2] - 0.03]);
  b.loft(
    [bot, [0, 0, -0.03], top].map((p, i) => ({ c: [p[0], p[1], i === 1 ? -0.03 : p[2]] as Vec3, ax: dir.ax, ay: dir.ay, pts: circle(4, 0.0022), color: '#efe6cf' })),
    {},
  );
}

function staff(b: MeshBuilder, rng: Rng, o: { orb: string; metal: string }): void {
  const prof: [number, number][] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const y = lerp(-0.72, 0.8, i / N);
    prof.push([0.016 + 0.003 * Math.sin(i * 1.7) + 0.0025 * Math.sin(i * 0.6 + rng.next()), y]);
  }
  b.lathe(prof, 8, { color: (_p, _n, i) => rgb(i % 5 === 0 ? WOOD_D : WOOD), capStart: true });
  // iron ferrule + rings
  b.lathe([[0.012, -0.72], [0.02, -0.7], [0.02, -0.64], [0.016, -0.62]], 8, { color: '#4a4f58' });
  for (const y of [0.0, 0.62]) b.lathe([[0.019, y - 0.012], [0.026, y - 0.006], [0.026, y + 0.006], [0.019, y + 0.012]], 10, { color: o.metal });
  // crescent ring head
  const ringC: Vec3 = [0, 0.93, 0];
  const segs = 22;
  const secs: Section[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const p: Vec3 = [Math.sin(a) * 0.1, ringC[1] + Math.cos(a) * 0.1, 0];
    // local frame: ax = radial direction, ay = z
    const radial: Vec3 = [Math.sin(a), Math.cos(a), 0];
    secs.push({ c: p, ax: radial, ay: [0, 0, 1], pts: circle(7, 0.013, 0.011), color: o.metal });
  }
  b.loft(secs, {});
  // glowing orb inside the ring
  bulb(b, [0, ringC[1], 0], 0.052, o.orb, 1, 14, 9);
  // prongs
  for (const a of [0, Math.PI]) {
    b.lathe([[0.001, 0.0], [0.012, 0.01], [0.001, 0.05]], 6, { origin: [Math.sin(a) * 0.11, 0.93 + Math.cos(a) * 0.11 + (a === 0 ? 0.01 : -0.06), 0], color: o.metal });
  }
  // hanging charms
  for (const x of [-0.016, 0.016]) b.lathe([[0.003, -0.16], [0.005, -0.15], [0.003, 0.0]], 5, { origin: [x, 0.58, 0.02], color: LACQ });
}

function fan(b: MeshBuilder): void {
  // folding fan: ribs + painted paper segments, pivot at the grip top
  const slats = 9;
  const spread = 1.5;
  const r0 = 0.07;
  const r1 = 0.42;
  wrappedGrip(b, -0.13, 0.03, 0.0155, '#6b1d18', WOOD_D, 8);
  b.lathe([[0.016, 0.0], [0.02, 0.02], [0.016, 0.04]], 10, { color: GOLD });
  const A = rgb('#f1e6cc');
  const B = rgb('#c9453a');
  const C = rgb('#e6b653');
  for (const face of [1, -1]) {
    const z = 0.004 * face;
    for (let i = 0; i < slats; i++) {
      const a0 = -spread / 2 + (i / slats) * spread;
      const a1 = -spread / 2 + ((i + 1) / slats) * spread;
      const pt = (r: number, a: number): Vec3 => [Math.sin(a) * r, 0.045 + Math.cos(a) * r, z];
      const col: ColorFn = (p) => {
        const rr = Math.hypot(p[0], p[1] - 0.045);
        const k = clamp((rr - r0) / (r1 - r0), 0, 1);
        const base: RGB = i % 2 ? [A[0] * 0.95, A[1] * 0.92, A[2] * 0.85] : A;
        if (k > 0.82) return C;
        if (k > 0.7 && k < 0.78) return B;
        return [base[0] * (1 - 0.18 * k), base[1] * (1 - 0.1 * k), base[2] * (1 - 0.08 * k)];
      };
      const sub = 3;
      for (let s = 0; s < sub; s++) {
        const ra = lerp(r0, r1, s / sub);
        const rb = lerp(r0, r1, (s + 1) / sub);
        if (face > 0) b.quad(pt(ra, a0), pt(rb, a0), pt(rb, a1), pt(ra, a1), col);
        else b.quad(pt(ra, a1), pt(rb, a1), pt(rb, a0), pt(ra, a0), col);
      }
    }
  }
  // ribs
  for (let i = 0; i <= slats; i++) {
    const a = -spread / 2 + (i / slats) * spread;
    const p0: Vec3 = [Math.sin(a) * r0, 0.045 + Math.cos(a) * r0, 0];
    const p1: Vec3 = [Math.sin(a) * (r1 + 0.012), 0.045 + Math.cos(a) * (r1 + 0.012), 0];
    const ax: Vec3 = [Math.cos(a), -Math.sin(a), 0];
    b.loft(
      [
        { c: p0, ax, ay: [0, 0, 1], pts: circle(4, 0.005, 0.0055), color: GOLD },
        { c: p1, ax, ay: [0, 0, 1], pts: circle(4, 0.0045, 0.0055), color: GOLD_D },
      ],
      { capEnd: true, flat: true },
    );
  }
  bulb(b, [0, 0.045, 0], 0.014, GOLD, 1, 8, 5);
}

function bell(b: MeshBuilder): void {
  wrappedGrip(b, -0.14, 0.0, 0.0165, '#6b1d18', WOOD_D, 8);
  b.lathe([[0.013, 0.0], [0.026, 0.012], [0.018, 0.03], [0.012, 0.05]], 10, { color: GOLD });
  // Korean-style temple bell body (flared)
  const prof: [number, number][] = [
    [0.012, 0.05],
    [0.03, 0.062],
    [0.052, 0.08],
    [0.064, 0.115],
    [0.07, 0.16],
    [0.078, 0.2],
    [0.092, 0.235],
    [0.099, 0.245],
    [0.093, 0.248],
  ];
  b.lathe(prof, 18, {
    color: (p) => {
      const band = Math.abs(p[1] - 0.225) < 0.012 || Math.abs(p[1] - 0.12) < 0.006;
      return rgb(band ? GOLD : '#b38a3a');
    },
  });
  // inner dark + clapper
  b.lathe([[0.08, 0.245], [0.07, 0.2], [0.04, 0.12], [0.01, 0.07]], 14, { color: '#2a1d10' });
  b.lathe([[0.004, 0.18], [0.004, 0.14]], 5, { color: '#6a5a3a' });
  bulb(b, [0, 0.14, 0], 0.018, GOLD, 1, 8, 5);
  // tassel
  b.lathe([[0.002, -0.14], [0.01, -0.17], [0.012, -0.21], [0.002, -0.24]], 6, { color: LACQ });
}

function claw(b: MeshBuilder): void {
  // knuckle duster base + three curved talons
  b.box([0, 0.02, 0], [0.075, 0.018, 0.026], 0.01, '#4a3a2e');
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.036;
    const secs: Section[] = [];
    for (let k = 0; k <= 7; k++) {
      const s = k / 7;
      const c: Vec3 = [x * (1 - 0.15 * s), 0.04 + s * 0.32, 0.07 * s * s * 1.6];
      const prev: Vec3 = [x, 0.04 + Math.max(0, s - 0.05) * 0.32, 0.07 * Math.max(0, s - 0.05) ** 2 * 1.6];
      const next: Vec3 = [x, 0.04 + Math.min(1, s + 0.05) * 0.32, 0.07 * Math.min(1, s + 0.05) ** 2 * 1.6];
      const { ay } = frameAlong(prev, next);
      const w = 0.016 * (1 - s) ** 0.8 + 0.0015;
      const t = 0.0065 * (1 - s) + 0.001;
      secs.push({ c, ax: AX, ay, pts: [[w, 0], [0, t], [-w, 0], [0, -t]], color: s > 0.5 ? '#efe7d2' : '#cfc6ae' });
    }
    b.loft(secs, { flat: true, capEnd: true });
  }
  // wrist guard strap
  b.lathe([[0.03, -0.1], [0.036, -0.09], [0.036, -0.02], [0.03, -0.01]], 12, { color: LEATHER, sx: 1.5 });
  for (const y of [-0.08, -0.045]) b.lathe([[0.037, y - 0.005], [0.04, y], [0.037, y + 0.005]], 12, { color: GOLD_D, sx: 1.5 });
}

function club(b: MeshBuilder): void {
  const prof: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    prof.push([0.017 + 0.06 * Math.pow(s, 2.2) * (1 + 0.1 * Math.sin(i * 1.3)), lerp(-0.1, 0.62, s)]);
  }
  b.lathe(prof, 10, { color: (p) => rgb(p[1] < 0.05 ? LEATHER : WOOD), capStart: true, capEnd: true });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + (i % 2) * 0.3;
    const y = 0.42 + (i % 3) * 0.09;
    const rr = 0.017 + 0.06 * Math.pow((y + 0.1) / 0.72, 2.2);
    b.lathe([[0.001, 0.0], [0.013, 0.0], [0.001, 0.035]], 5, { origin: [Math.cos(a) * rr, y, Math.sin(a) * rr], color: '#9fa5ad' });
  }
}

function spear(b: MeshBuilder): void {
  b.lathe([[0.015, -0.7], [0.015, 0.95]], 8, { color: WOOD, capStart: true });
  b.lathe([[0.014, -0.7], [0.02, -0.68], [0.001, -0.62]], 8, { color: '#4a4f58' });
  b.lathe([[0.02, 0.9], [0.028, 0.93], [0.02, 0.96]], 10, { color: GOLD });
  blade(b, { y0: 0.95, len: 0.3, w: 0.035, t: 0.008, belly: 1, taper: 0.4 });
  b.lathe([[0.002, 0.92], [0.02, 0.88], [0.015, 0.72], [0.002, 0.7]], 8, { color: LACQ, sx: 1.2 });
}

export const WEAPON_ATTACH = { pos: [-0.012, -0.05, 0.02] as Vec3, rot: [Math.PI / 2 - 0.15, 0, 0] as Vec3 };

export function makeWeapon(id: string, weapon: string, seed: number): PlaceholderModel {
  const rng = new Rng(seed);
  const b = new MeshBuilder();
  switch (weapon) {
    case 'dagger':
      dagger(b);
      break;
    case 'blade_yacha':
      surBlade(b);
      break;
    case 'bow':
      bow(b);
      break;
    case 'staff':
      staff(b, rng, { orb: '#7fe6ff', metal: GOLD });
      break;
    case 'fan':
      fan(b);
      break;
    case 'bell':
      bell(b);
      break;
    case 'claw':
      claw(b);
      break;
    case 'club':
      club(b);
      break;
    case 'spear':
      spear(b);
      break;
    default:
      sword(b, rng, { len: rng.range(0.78, 0.9), w: 0.034, guardW: 0.052, trim: GOLD, wrap: LACQ });
  }
  b.speckle(0.06, 40, seed);
  const bb = b.bounds();
  const geometry = b.toGeometry();
  const model = assembleModel({
    id,
    kind: 'weapon',
    parts: [{ name: 'weapon', geometry }],
    height: bb.max[1] - bb.min[1],
    radius: Math.max(Math.abs(bb.max[0]), Math.abs(bb.min[0]), Math.abs(bb.max[2]), Math.abs(bb.min[2])),
    palette: ['#aab6c2', GOLD, LACQ],
    extra: { weapon, attach: WEAPON_ATTACH },
  });
  return model;
}
