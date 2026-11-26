// Recurve bow builder (ninja). Canonical frame: grip centre at the origin, limbs along +-Y, the arrow flies +Z, the string runs on the -Z
// side. Ships in the hero's LEFT-hand frame (the bow is only ever held in hand_l).
import { HardMesh } from '../../core/hard/hardmesh.ts';
import type { Vec3 } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type PaintFn, type PaintSample, type Painted, bakeWeapon } from './bake.ts';
import type { WeaponMeta } from './frame.ts';
import { type Vec2, catmull, chamferRect, hexSection, sweepSection } from './loft.ts';
import { type Pal, fract, gem, genericZone, glyph, lerp3, scale3 } from './paintkit.ts';
import { add, box, gemMesh, gripMesh, orient, plateX, spin } from './parts.ts';
import { Z } from './zones.ts';

export type TipStyle = 'nock' | 'bone' | 'leaf' | 'wing';

export interface BowSpec {
  id: string;
  tier: number;
  seed: number;
  pal: Pal;
  /** half length of the bow (m): tip to grip centre */
  half: number;
  /** pull-back of the limb tips behind the grip (m) */
  brace: number;
  /** limb section: half depth along the arrow axis / half width across, at grip and at tip */
  limb: { d0: number; d1: number; w0: number; w1: number };
  limbZone: number;
  /** belly (archer side) strip zone, 0 = none */
  bellyZone: number;
  gripZone: number;
  tip: TipStyle;
  tipZone: number;
  /** gold fittings: riser plates and tip caps */
  fittings: boolean;
  gem: boolean;
  /** fins along the limbs (dragon scale ridges), count per limb */
  fins: number;
  runes: boolean;
  stringZone: number;
  tex: number;
  emissive?: number;
  paint?: { goldEngrave?: number; woodLacquer?: boolean };
}

/** limb centre line (z, y) for t in 0..1 along the upper limb */
function limbPath(s: BowSpec, sign: number, n = 14): Vec3[] {
  const y0 = 0.07, y1 = s.half;
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = y0 + (y1 - y0) * t;
    // pull-back grows smoothly, then flicks forward over the last 8 % (recurve)
    const back = -s.brace * (smoothstep(0, 1, t) ** 1.25) * (1 - 0.12 * smoothstep(0.86, 1, t));
    pts.push([0, sign * y, back]);
  }
  return pts;
}

export function assembleBow(s: BowSpec): { mesh: HardMesh; tipY: number; stringZ: number } {
  const m = new HardMesh();
  // grip
  gripMesh(m, { y0: -0.085, y1: 0.085, a: 0.0185, b: 0.021, n: 10, bulge: 0.1, rings: 4, zone: s.gripZone });
  if (s.fittings) {
    for (const y of [-0.088, 0.088]) add(m, spin([[0.019, y - 0.004], [0.026, y - 0.002], [0.026, y + 0.002], [0.019, y + 0.004]], { segments: 10 }), Z.gold);
  }
  // limbs
  for (const sign of [1, -1]) {
    const path = limbPath(s, sign);
    const sec = (t: number): Vec2[] => {
      const d = s.limb.d0 + (s.limb.d1 - s.limb.d0) * t, w = s.limb.w0 + (s.limb.w1 - s.limb.w0) * t;
      // hexagonal: pointed in-plane (belly / back ridge), flat across
      return hexSection(d, w, 0.6);
    };
    sweepSection(m, path, sec, { zones: s.limbZone, up: [1, 0, 0], capStart: true, tipPoint: false, capEnd: true });
    if (s.bellyZone) {
      // horn/bone strip along the belly (archer side)
      const belly = path.map((p, i, a) => [p[0], p[1], p[2] - (s.limb.d0 + (s.limb.d1 - s.limb.d0) * (i / (a.length - 1))) * 0.9] as Vec3);
      sweepSection(m, belly.slice(1, -1), (t) => chamferRect(0.0035, (s.limb.w0 + (s.limb.w1 - s.limb.w0) * (0.1 + 0.8 * t)) * 0.7, 0.0012), { zones: s.bellyZone, up: [1, 0, 0], capStart: true, capEnd: true });
    }
    // tip
    const tip = path[path.length - 1]!;
    const tp = path[path.length - 2]!;
    const dirY = Math.sign(tip[1]), dz = tip[2] - tp[2], dy = tip[1] - tp[1];
    const tipDir: Vec3 = [0, dy, dz];
    const tl = Math.hypot(dy, dz);
    if (s.tip === 'bone' || s.tip === 'nock' || s.fittings) {
      add(m, spin([[0, -0.012], [0.011, -0.008], [0.0125, 0.004], [0.008, 0.016], [0, 0.026]], { segments: 8 }), s.tipZone, orient([0, tip[1] + (dirY * 0.004), tip[2]], [0, dirY * (dy / tl), dz / tl]));
    }
    void tipDir;
    if (s.tip === 'leaf' || s.tip === 'wing') {
      const wing = s.tip === 'wing';
      const ty = Math.abs(tip[1]), tz = tip[2];
      // flat plate sweeping forward off the tip (feather / leaf)
      const outline: Vec2[] = wing
        ? [[tz - 0.012, ty - 0.1], [tz + 0.05, ty - 0.07], [tz + 0.11, ty - 0.01], [tz + 0.14, ty + 0.06], [tz + 0.07, ty + 0.045], [tz + 0.045, ty + 0.095], [tz + 0.0, ty + 0.05], [tz - 0.02, ty + 0.01]]
        : [[tz - 0.01, ty - 0.08], [tz + 0.03, ty - 0.05], [tz + 0.06, ty + 0.0], [tz + 0.055, ty + 0.05], [tz + 0.02, ty + 0.075], [tz - 0.012, ty + 0.03]];
      const o = outline.map(([z, y]) => [z, sign * y] as Vec2);
      add(m, plateX(o, { depth: wing ? 0.011 : 0.009, bevel: 0.0022 }), s.tipZone === Z.gold ? Z.gold : s.limbZone);
      if (wing) add(m, plateX(o.map(([z, y]) => [tz + (z - tz) * 0.62 + 0.012, sign * (ty + (Math.abs(y) - ty) * 0.62 - 0.004)] as Vec2), { depth: 0.014, bevel: 0.002 }), Z.gold);
    }
  }
  // fins (scale ridges) along the back of each limb
  for (const sign of [1, -1]) {
    for (let k = 0; k < s.fins; k++) {
      const t = (k + 0.7) / (s.fins + 0.4);
      const y = 0.1 + (s.half - 0.14) * t;
      const tt = (y - 0.07) / (s.half - 0.07);
      const back = -s.brace * (smoothstep(0, 1, tt) ** 1.25);
      const h = 0.02 * (1 - 0.5 * t);
      const o: Vec2[] = [[back + 0.004, sign * (y - 0.016)], [back + 0.004 + h, sign * (y + 0.004)], [back + 0.004, sign * (y + 0.018)]];
      add(m, plateX(o, { depth: 0.006, bevel: 0.001 }), Z.gold);
    }
  }
  // fittings: riser plates + arrow rest + gem
  if (s.fittings) {
    for (const sign of [1, -1]) {
      box(m, [0, sign * 0.11, -0.002], [0.017, 0.032, 0.03], 0.003, Z.gold);
    }
  }
  if (s.gem) {
    add(m, gemMesh(0.011, 0.007, 6), Z.gem, orient([0, 0.0, 0.03], [0, 0, 1]));
    add(m, gemMesh(0.011, 0.007, 6), Z.gem, orient([0, 0.0, -0.03], [0, 0, -1]));
  }
  // string: a thin flat cord from nock to nock on the archer side
  const tipA = limbPath(s, 1).at(-1)!, tipB = limbPath(s, -1).at(-1)!;
  const sz = tipA[2] - 0.004;
  sweepSection(m, [[0, tipA[1], sz], [0, 0, sz - 0.001], [0, tipB[1], sz]], [[0.0013, 0.0011], [-0.0013, 0.0011], [-0.0013, -0.0011], [0.0013, -0.0011]], { zones: s.stringZone, up: [1, 0, 0], capStart: true, capEnd: true });
  return { mesh: m, tipY: s.half + 0.03, stringZ: sz };
}

function bowPaint(s: BowSpec): PaintFn {
  const pal = s.pal;
  return (sm: PaintSample): Painted => {
    const base = genericZone(sm, pal, { seed: s.seed, goldEngrave: s.paint?.goldEngrave ?? 0.5, woodLacquer: s.paint?.woodLacquer, wrapRadius: 0.02 });
    if (sm.zone === Z.gem) return gem(sm, pal);
    if (sm.zone === Z.bone && sm.p[2] < -s.brace - 0.0 - 0.0) return base;
    // glowing runes on the back of the limbs
    if (s.runes && (sm.zone === s.limbZone) && sm.n[2] > 0.5 && Math.abs(sm.p[1]) > 0.12 && Math.abs(sm.p[1]) < s.half - 0.07) {
      const pitch = 0.05;
      const cu = fract((Math.abs(sm.p[1]) - 0.12) / pitch);
      const cell = Math.floor((Math.abs(sm.p[1]) - 0.12) / pitch) + (sm.p[1] < 0 ? 40 : 0);
      const cv = 0.5 + sm.p[0] / (s.limb.w0 * 1.1);
      if (cv > 0.05 && cv < 0.95) {
        const m = glyph(cell + s.seed, cv, cu, 0.08);
        if (m > 0.02) return { albedo: lerp3(base.albedo, pal.rune, Math.min(1, m)), emissive: scale3(pal.rune, m * 1.4) };
      }
    }
    return base;
  };
}

export async function buildBow(s: BowSpec, log: (m: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const built = assembleBow(s);
  const mesh = built.mesh.finish({ crease: 40 });
  log(`  ${s.id}: ${mesh.indices.length / 3} tris (pre-unwrap)`);
  const tex = opts?.texture ?? s.tex;
  const meta: WeaponMeta = {
    type: 'bow',
    tier: s.tier,
    hand: 'l',
    grip: 'bow',
    length: s.half * 2,
    pommelZ: -s.half,
    tipZ: s.half,
    trail: [-s.half, s.half],
    muzzle: [0, 0, 0],
  };
  return bakeWeapon({
    id: s.id,
    mesh,
    paint: bowPaint(s),
    size: tex > 0 ? tex : 64,
    emissiveSize: tex > 0 ? s.emissive ?? 0 : 0,
    seed: s.seed,
    hand: 'l',
    noTexture: tex === 0,
    material: { roughness: 0.55, metallic: 0 },
    extras: { weapon: { ...meta, string: { z: built.stringZ, yTop: s.half, yBottom: -s.half } } },
    log,
  });
}
