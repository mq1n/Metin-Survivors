// Generic sword / dagger builder: one spec drives blade + guard + grip + pommel + tassel + paint. Used by warrior swords, two-handers,
// yacha swords and (curved) daggers; each model file is just a SwordSpec.
import { HardMesh } from '../../core/hard/hardmesh.ts';
import type { Vec3 } from '../../core/math.ts';
import { clamp, mix, smoothstep } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type PaintFn, type PaintSample, type Painted, bakeWeapon } from './bake.ts';
import type { Hand, WeaponMeta } from './frame.ts';
import { type BladeSpec, type Vec2, bladeMesh, catmull, chamferRect, hexSection, sweepSection } from './loft.ts';
import { type Pal, type SteelLocal, type SteelOpts, genericZone, steelEdge, steelFlat, steelFuller } from './paintkit.ts';
import { add, box, gemMesh, gripMesh, hoop, mirrorOutline, orient, plateX, plateY, polar, ribbon, rosette, spin } from './parts.ts';
import { Z } from './zones.ts';

export type GuardKind = 'disc' | 'crossUp' | 'wing' | 'horns' | 'none';

export interface GuardSpec {
  kind: GuardKind;
  /** y of the guard centre */
  y: number;
  /** half span along Z */
  span: number;
  /** thickness along Y (disc / boss) */
  thick: number;
  zone: number;
  /** wing outline preset */
  style?: 'bat' | 'crest' | 'horn' | 'flame';
  /** overlay plates in gold */
  trim?: boolean;
  /** raise of the quillon tips (crossUp) */
  rise?: number;
  gem?: boolean;
  /** half extent along X */
  depth?: number;
  knobs?: boolean;
}

export type PommelKind = 'ball' | 'disc' | 'lotus' | 'cap' | 'spike' | 'none';
export interface PommelSpec {
  kind: PommelKind;
  r: number;
  zone: number;
  gem?: boolean;
  /** hanging cord ring */
  loop?: boolean;
}

export interface BladeParams {
  length: number;
  halfW0: number;
  halfW1: number;
  halfT0: number;
  halfT1: number;
  single?: boolean;
  bevel?: number;
  bevelBack?: number;
  /** tip start (t) and shape exponent (1 linear, <1 round, >1 needle) */
  tipStart?: number;
  tipPow?: number;
  tipZ?: number;
  fuller?: BladeSpec['fuller'];
  /** curved blade: max centre-line offset along +Z at the tip, and the exponent of the curve */
  bend?: number;
  bendPow?: number;
  /** half width multiplier on the +Z (edge) side / spine side: wave and notch profile */
  edgeMod?: (t: number) => number;
  backMod?: (t: number) => number;
  /** extra stations (notches) */
  stations?: number[];
  belly?: { at: number; amount: number; sigma: number };
  spineChamfer?: number;
  /** straight ricasso length (m) at the base */
  ricasso?: number;
  steel?: SteelOpts;
}

export interface TasselSpec { count: number; length: number; zone: number; spread?: number; width?: number }

export interface SwordSpec {
  id: string;
  type: string;
  tier: number;
  seed: number;
  hand?: Hand;
  grip: WeaponMeta['grip'];
  pal: Pal;
  gripY0: number;
  gripY1: number;
  gripA: number;
  gripB: number;
  gripTwist?: number;
  gripZone: number;
  collars?: boolean;
  guard: GuardSpec;
  pommel: PommelSpec;
  blade: BladeParams;
  tassel?: TasselSpec;
  /** blade collar height (m), 0 = none */
  habaki?: number;
  tex: number;
  emissive?: number;
  handL?: number;
  material?: { roughness?: number; metallic?: number };
  paint?: { goldEngrave?: number; wrapDiamond?: boolean; woodLacquer?: boolean; goldWear?: number };
  /** shape of the guard boss: half extents [x, y, z] */
  boss?: [number, number, number];
}

// ---------------------------------------------------------------------------------------------------------------------------------

const tipFactor = (t: number, start: number, pow: number): number => (t <= start ? 1 : Math.max(0, (1 - t) / (1 - start)) ** pow);

export function bladeSpecOf(s: SwordSpec, y0: number): BladeSpec {
  const b = s.blade;
  const start = b.tipStart ?? 0.84, pw = b.tipPow ?? 0.9;
  const ricT = (b.ricasso ?? 0.02) / b.length;
  const baseW = (t: number): number => {
    let w = mix(b.halfW0, b.halfW1, Math.min(1, t / Math.max(start, 0.01)));
    if (b.belly) w *= 1 + b.belly.amount * Math.exp(-(((t - b.belly.at) / b.belly.sigma) ** 2));
    return w * tipFactor(t, start, pw);
  };
  const stations = [...new Set([0, ricT * 0.5, ricT, ricT + 0.04, 0.2, 0.36, 0.52, 0.66, start * 0.92, start, mix(start, 1, 0.35), mix(start, 1, 0.65), mix(start, 1, 0.88), 1, ...(b.stations ?? [])])]
    .filter((t) => t >= 0 && t <= 1)
    .sort((a, c) => a - c);
  const ht = (t: number): number => mix(b.halfT0, b.halfT1, t) * (1 + 0.18 * (1 - smoothstep(0, ricT + 0.05, t)));
  const bendPow = b.bendPow ?? 1.6;
  return {
    y0,
    length: b.length,
    stations,
    halfW: (t) => baseW(t) * (b.edgeMod ? b.edgeMod(t) : 1),
    halfWBack: (t) => baseW(t) * (b.backMod ? b.backMod(t) : 1),
    halfT: ht,
    bendZ: b.bend ? (t) => b.bend! * t ** bendPow : undefined,
    single: b.single,
    bevel: b.bevel ?? 0.3,
    bevelBack: b.bevelBack,
    fuller: b.fuller,
    tipZ: b.tipZ,
    spineChamfer: b.spineChamfer,
    zones: { flat: Z.steel, edge: Z.edge, fuller: Z.fuller, spine: Z.spine },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// guards

const WING_STYLES: Record<string, [number, number][]> = {
  // half outlines (z, y) from the top axis point to the bottom axis point; z >= 0; the blade passes through the centre
  bat: [[0, 0.02], [0.03, 0.022], [0.06, 0.03], [0.09, 0.046], [0.115, 0.075], [0.13, 0.11], [0.112, 0.082], [0.1, 0.052], [0.082, 0.024], [0.062, 0.0], [0.045, -0.02], [0.026, -0.03], [0, -0.028]],
  crest: [[0, 0.026], [0.05, 0.03], [0.09, 0.04], [0.12, 0.06], [0.138, 0.052], [0.128, 0.026], [0.108, 0.006], [0.082, -0.012], [0.06, -0.02], [0.034, -0.032], [0, -0.034]],
  horn: [[0, 0.024], [0.035, 0.03], [0.07, 0.042], [0.1, 0.075], [0.118, 0.12], [0.128, 0.165], [0.115, 0.125], [0.102, 0.085], [0.088, 0.05], [0.07, 0.02], [0.06, -0.008], [0.04, -0.018], [0.024, -0.036], [0, -0.04]],
  flame: [[0, 0.024], [0.03, 0.03], [0.06, 0.026], [0.085, 0.056], [0.108, 0.07], [0.122, 0.1], [0.108, 0.052], [0.126, 0.034], [0.1, 0.016], [0.108, -0.01], [0.078, -0.008], [0.062, -0.03], [0.034, -0.026], [0.014, -0.04], [0, -0.042]],
};

function buildGuard(m: HardMesh, g: GuardSpec, s: SwordSpec): void {
  if (g.kind === 'none') return;
  const d = g.depth ?? 0.014;
  const [bx, by, bz] = s.boss ?? [0.016, 0.014, 0.024];
  if (g.kind === 'disc') {
    const outline = polar(16, () => 1, 0).map(([x, z]) => [x * g.span * 0.55, z * g.span] as Vec2);
    add(m, plateY(outline, { y0: g.y - g.thick / 2, depth: g.thick, bevel: Math.min(g.thick * 0.35, 0.004) }), g.zone);
    if (g.trim) {
      const inner = outline.map(([x, z]) => [x * 0.72, z * 0.78] as Vec2);
      add(m, plateY(inner, { y0: g.y + g.thick / 2 - 0.0004, depth: 0.0035, bevel: 0.0015 }), Z.gold);
      add(m, plateY(inner, { y0: g.y - g.thick / 2 - 0.0031, depth: 0.0035, bevel: 0.0015 }), Z.gold);
    }
    return;
  }
  if (g.kind === 'crossUp') {
    const rise = g.rise ?? 0.03;
    for (const sg of [1, -1]) {
      const path = catmull([[0, g.y, sg * 0.01], [0, g.y - 0.003, sg * g.span * 0.45], [0, g.y + rise * 0.2, sg * g.span * 0.8], [0, g.y + rise, sg * g.span]], 3);
      sweepSection(m, path, (t) => chamferRect(g.thick * (1 - 0.3 * t), d * 0.5 * (1 - 0.35 * t), 0.0025), {
        zones: g.zone,
        up: [1, 0, 0],
        capStart: true,
        capEnd: true,
      });
      if (g.knobs) add(m, spin([[0, -0.009], [0.008, -0.005], [0.0095, 0.0], [0.006, 0.007], [0, 0.011]], { segments: 8 }), Z.gold, orient([0, g.y + rise + 0.003, sg * (g.span + 0.003)], [0, 1, 0]));
    }
    box(m, [0, g.y, 0], [bx * 1.3, by * 1.5, bz * 1.4], 0.004, g.zone);
    if (g.gem) add(m, gemMesh(0.0085, 0.006, 6), Z.gem, orient([bx * 0.65 + 0.001, g.y, 0], [1, 0, 0]));
    return;
  }
  if (g.kind === 'horns') {
    const rise = g.rise ?? 0.07, sp = g.span, th = g.thick, dp = g.depth ?? 0.022;
    for (const sg of [1, -1]) {
      const hornSec = (k: number) => (t: number): Vec2[] => hexSection(th * k * (1 - 0.88 * t) + 0.0012, dp * 0.5 * k * (1 - 0.82 * t) + 0.0008, 0.55);
      const upper = catmull([[0, g.y + 0.004, sg * 0.02], [0, g.y + 0.008, sg * sp * 0.38], [0, g.y + rise * 0.4, sg * sp * 0.78], [0, g.y + rise, sg * sp * 0.98]], 2);
      sweepSection(m, upper, hornSec(1), { zones: g.zone, up: [1, 0, 0], capStart: true, tipPoint: true });
      const lower = catmull([[0, g.y - 0.006, sg * 0.02], [0, g.y - 0.016, sg * sp * 0.36], [0, g.y - 0.034, sg * sp * 0.62]], 2);
      sweepSection(m, lower, hornSec(0.7), { zones: g.zone, up: [1, 0, 0], capStart: true, tipPoint: true });
    }
    box(m, [0, g.y, 0], [bx * 1.5, by * 2.2, bz * 1.6], 0.004, g.trim ? Z.gold : g.zone);
    if (g.gem) {
      add(m, gemMesh(0.012, 0.009, 6), Z.gem, orient([bx * 0.75 + 0.001, g.y, 0], [1, 0, 0]));
      add(m, gemMesh(0.012, 0.009, 6), Z.gem, orient([-bx * 0.75 - 0.001, g.y, 0], [-1, 0, 0]));
    }
    return;
  }
  // winged plate guard
  const half = WING_STYLES[g.style ?? 'bat']!;
  const sc = g.span / Math.max(...half.map((q) => q[0]));
  const outline = mirrorOutline(half.map(([z, y]) => [z * sc, y] as Vec2)).map(([z, y]) => [z, y + g.y] as Vec2);
  add(m, plateX(outline, { depth: d * 0.9, bevel: Math.min(d * 0.28, 0.0035) }), g.zone);
  if (g.trim) {
    const inner = mirrorOutline(half.map(([z, y]) => [z * sc * 0.8, y * 0.7] as Vec2)).map(([z, y]) => [z, y + g.y] as Vec2);
    add(m, plateX(inner, { depth: d * 1.3, bevel: 0.0025 }), Z.gold);
  }
  box(m, [0, g.y, 0], [bx * 1.2, by * 1.8, bz * 1.3], 0.003, g.zone);
  if (g.gem) {
    add(m, gemMesh(0.011, 0.009, 6), Z.gem, orient([d * 0.65 + 0.001, g.y + 0.003, 0], [1, 0, 0]));
    add(m, gemMesh(0.011, 0.009, 6), Z.gem, orient([-d * 0.65 - 0.001, g.y + 0.003, 0], [-1, 0, 0]));
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// pommels, collars, tassels

function buildPommel(m: HardMesh, p: PommelSpec, y0: number, s: SwordSpec): void {
  const r = p.r;
  switch (p.kind) {
    case 'none':
      return;
    case 'ball': {
      const cy = y0 - r * 0.85;
      const prof: Vec2[] = Array.from({ length: 9 }, (_, i) => {
        const a = -Math.PI / 2 + (i / 8) * Math.PI * 0.95;
        return [Math.max(0, Math.cos(a) * r), cy + Math.sin(a) * r * 1.05] as Vec2;
      });
      add(m, spin(prof, { segments: 12 }), p.zone);
      break;
    }
    case 'disc':
      add(m, spin([[0, y0 + 0.002], [r * 0.82, y0], [r, y0 - 0.005], [r, y0 - 0.012], [r * 0.7, y0 - 0.02], [0, y0 - 0.026]], { segments: 10 }), p.zone);
      break;
    case 'cap':
      add(m, spin([[0, y0 + 0.002], [r * 0.9, y0], [r, y0 - 0.006], [r * 0.85, y0 - 0.02], [0, y0 - 0.026]], { segments: 10 }), p.zone);
      break;
    case 'lotus': {
      add(m, spin([[0.3 * r, y0], [r * 0.86, y0 - 0.004], [r, y0 - 0.011], [r * 0.9, y0 - 0.02], [r * 0.55, y0 - 0.027], [r * 0.4, y0 - 0.034], [0, y0 - 0.052]], { segments: 10 }), p.zone);
      add(m, spin([[r * 0.34, y0 + 0.001], [r * 0.52, y0 - 0.003], [r * 0.44, y0 - 0.009], [r * 0.3, y0 - 0.01]], { segments: 10 }), Z.gold);
      break;
    }
    case 'spike':
      add(m, spin([[0, y0 + 0.002], [r, y0], [r * 0.95, y0 - 0.01], [r * 0.4, y0 - 0.035], [0, y0 - 0.06]], { segments: 8 }), p.zone);
      break;
  }
  if (p.gem) add(m, gemMesh(0.0075, 0.005, 6), Z.gem, orient([r * 0.98, y0 - r * 0.7, 0], [1, 0, 0]));
  if (p.loop) {
    add(m, hoop(0.012, 0.0022, 'x', 12, 4, [0, y0 - r * 1.6 - 0.006, 0]), Z.gold);
  }
  void s;
}

function buildTassel(m: HardMesh, t: TasselSpec, y0: number): void {
  for (let i = 0; i < t.count; i++) {
    const k = t.count === 1 ? 0 : i / (t.count - 1) - 0.5;
    const len = t.length * (1 - 0.18 * Math.abs(k) * 2 + (i % 2) * 0.06);
    const sx = (t.spread ?? 0.012) * k * 2;
    const path = catmull([[sx * 0.2, y0, k * 0.01], [sx + 0.012 * (k + 0.2), y0 - len * 0.55, k * 0.018], [sx * 1.3 + 0.006, y0 - len, k * 0.02]], 2);
    ribbon(m, path, (t.width ?? 0.0075) * (1 - 0.15 * Math.abs(k)), (t.width ?? 0.0075) * 0.75, 0.001, t.zone, [1, 0, 0]);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------

export interface Built { mesh: HardMesh; bladeY0: number; tipY: number; pommelY: number; spec: BladeSpec }

export function assembleSword(s: SwordSpec): Built {
  const m = new HardMesh();
  const g = s.guard;
  // hilt
  const mark = (label: string): void => {
    if (process.env.WEAPON_PARTS) console.log(`    ${label}: ${m.triCount}`);
  };
  gripMesh(m, { y0: s.gripY0, y1: s.gripY1, a: s.gripA, b: s.gripB, n: 10, twist: s.gripTwist ?? 0, bulge: 0.12, rings: 5, zone: s.gripZone });
  mark('grip');
  if (s.collars) {
    for (const y of [s.gripY0 + 0.004, s.gripY1 - 0.004]) {
      add(m, spin([[s.gripA * 1.12, y - 0.005], [s.gripA * 1.28, y - 0.0035], [s.gripA * 1.28, y + 0.0035], [s.gripA * 1.12, y + 0.005]], { segments: 8 }), Z.gold);
    }
  }
  buildPommel(m, s.pommel, s.gripY0, s);
  mark('pommel');
  buildGuard(m, g, s);
  mark('guard');
  const guardTop = g.y + (g.kind === 'wing' ? 0.012 : (s.boss?.[1] ?? 0.014)) + (g.kind === 'disc' ? g.thick / 2 : 0);
  const hab = s.habaki ?? 0;
  const bladeY0 = guardTop - 0.004 + hab;
  if (hab > 0) {
    const wr = s.blade.halfW0 * 1.08 + 0.002, th = s.blade.halfT0 * 1.2 + 0.0035;
    box(m, [0, guardTop - 0.002 + hab / 2, 0], [th * 2, hab + 0.006, wr * 2], 0.003, Z.gold);
  }
  const bs = bladeSpecOf(s, bladeY0);
  bladeMesh(m, bs);
  mark('blade');
  if (s.tassel) buildTassel(m, s.tassel, s.gripY0 - Math.max(0.012, s.pommel.r * (s.pommel.kind === 'ball' ? 1.7 : 1) * 0.5));
  mark('tassel');
  const tipY = bladeY0 + s.blade.length;
  return { mesh: m, bladeY0, tipY, pommelY: s.gripY0 - (s.pommel.kind === 'ball' ? s.pommel.r * 1.9 : s.pommel.kind === 'spike' ? 0.06 : 0.03), spec: bs };
}

/** blade-local coordinates for paint: t along, s across (-1 spine .. +1 edge), half width, face side */
export function bladeLocalFn(bs: BladeSpec): (p: Vec3) => SteelLocal {
  return (p) => {
    const t = clamp((p[1] - bs.y0) / bs.length, 0, 1);
    const bend = bs.bendZ ? bs.bendZ(t) : 0;
    const dz = p[2] - bend;
    const wr = Math.max(1e-4, bs.halfW(t)), wl = Math.max(1e-4, (bs.halfWBack ?? bs.halfW)(t));
    const sAcross = dz >= 0 ? dz / wr : dz / wl;
    return { t, s: clamp(sAcross, -1.05, 1.05), w: dz >= 0 ? wr : wl, side: p[0] >= 0 ? 1 : -1 };
  };
}

export function swordPaint(s: SwordSpec, bs: BladeSpec): PaintFn {
  const L = bladeLocalFn(bs);
  const so: SteelOpts = { seed: s.seed, ...(s.blade.steel ?? {}) };
  const pal = s.pal;
  return (sm: PaintSample): Painted => {
    switch (sm.zone) {
      case Z.steel:
        return steelFlat(sm, pal, L(sm.p), so);
      case Z.edge:
        return steelEdge(sm, pal, L(sm.p), so);
      case Z.fuller:
        return steelFuller(sm, pal, L(sm.p), so);
      case Z.spine:
        return steelEdge(sm, pal, L(sm.p), { ...so, tint: [0.72, 0.76, 0.85] });
      default:
        return genericZone(sm, pal, { seed: s.seed, goldEngrave: s.paint?.goldEngrave, wrapDiamond: s.paint?.wrapDiamond ?? true, woodLacquer: s.paint?.woodLacquer, goldWear: s.paint?.goldWear, wrapRadius: s.gripA });
    }
  };
}

export async function buildSword(s: SwordSpec, log: (m: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const built = assembleSword(s);
  const mesh = built.mesh.finish({ crease: 42 });
  const tex = opts?.texture ?? s.tex;
  const hand = s.hand ?? 'r';
  log(`  ${s.id}: ${mesh.indices.length / 3} tris (pre-unwrap)`);
  const meta: WeaponMeta = {
    type: s.type,
    tier: s.tier,
    hand,
    grip: s.grip,
    length: built.tipY - built.pommelY,
    pommelZ: built.pommelY,
    tipZ: built.tipY,
    trail: [built.bladeY0, built.tipY],
    ...(s.handL !== undefined ? { handL: [0, 0, s.handL] as Vec3 } : {}),
  };
  return bakeWeapon({
    id: s.id,
    mesh,
    paint: swordPaint(s, built.spec),
    size: tex > 0 ? tex : 64,
    emissiveSize: tex > 0 ? s.emissive ?? 0 : 0,
    seed: s.seed,
    hand,
    noTexture: tex === 0,
    material: s.material ?? { roughness: 0.5, metallic: 0 },
    extras: { weapon: meta },
    log,
  });
}
