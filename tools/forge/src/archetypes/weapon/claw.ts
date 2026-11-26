// Wolfman claw-gauntlet builder. Canonical frame: grip centre at the origin, talons rise along +Y and curve toward +Z (the cutting side), the
// talon fan spreads along X. X-symmetric so the rig can rotate the same model 180 degrees about hand Z for the off hand.
import { HardMesh, extrude } from '../../core/hard/hardmesh.ts';
import type { Vec3 } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type PaintFn, type PaintSample, type Painted, bakeWeapon } from './bake.ts';
import type { WeaponMeta } from './frame.ts';
import { type Vec2, sampleBez2, talon } from './loft.ts';
import { type Pal, furTuft, gem, genericZone, lerp3, scale3, steelEdge, steelFlat } from './paintkit.ts';
import { add, gemMesh, gripMesh, orient, spin } from './parts.ts';
import { Z } from './zones.ts';

export interface ClawSpec {
  id: string;
  tier: number;
  seed: number;
  pal: Pal;
  /** talon lengths from the centre outwards (mirrored), m */
  lengths: number[];
  /** talon spacing along X (m) and outward splay (m added at the tips) */
  gap: number;
  splay: number;
  /** half width / half thickness of the talon base */
  w: number;
  h: number;
  /** forward curl of the tip as a fraction of the length */
  curl: number;
  hex: boolean;
  /** knuckle plate zone and trim */
  plateZone: number;
  gripZone: number;
  cuffZone: number;
  /** extra rear spurs and side fangs */
  spurs: boolean;
  fangs: boolean;
  /** fur tufts around the cuff / plate */
  fur: number;
  gem: boolean;
  /** glowing vein along each talon */
  vein: boolean;
  tex: number;
  emissive?: number;
  paint?: { goldEngrave?: number; wear?: number };
}

const BASE_Y = 0.088;


interface TalonRec { path: Vec3[]; w: number; len: number }

export function assembleClaw(s: ClawSpec): { mesh: HardMesh; talons: TalonRec[]; tip: number } {
  const m = new HardMesh();
  const talons: TalonRec[] = [];
  gripMesh(m, { y0: -0.065, y1: 0.07, a: 0.0185, b: 0.0185, n: 8, bulge: 0.12, rings: 4, zone: s.gripZone });
  // knuckle plate: an arched shield across the front of the fist
  const pw = Math.max(0.07, s.gap * (s.lengths.length * 2 - 1) * 0.5 + 0.035);
  const plate: Vec2[] = [[-pw, -0.014], [-pw * 0.8, 0.018], [-pw * 0.4, 0.03], [0, 0.034], [pw * 0.4, 0.03], [pw * 0.8, 0.018], [pw, -0.014], [pw * 0.7, -0.03], [-pw * 0.7, -0.03]];
  add(m, extrude(plate, 0.02, { axis: 'y', z0: 0.07, bevel: { size: 0.003, segments: 1 } }), s.plateZone);
  // fist cap / pommel cuff
  add(m, spin([[0.016, -0.1], [0.027, -0.088], [0.034, -0.07], [0.03, -0.062], [0.018, -0.062]], { segments: 8 }), s.cuffZone);
  add(m, spin([[0.0185, 0.066], [0.03, 0.068], [0.03, 0.074], [0.0185, 0.075]], { segments: 8 }), Z.gold);
  // talons: centre first, mirrored pairs outward
  const place = (x: number, len: number, splaySign: number): void => {
    const sx = x + splaySign * s.splay * Math.min(1, Math.abs(x) / (s.gap * 2 + 1e-6));
    const ctrl = sampleBez2([x, BASE_Y - 0.01, -0.004], [x + (sx - x) * 0.3, BASE_Y + len * 0.55, 0.004], [sx, BASE_Y + len * 0.92, len * s.curl], 6);
    const w = s.w * (1 - 0.08 * Math.abs(x) / (s.gap * 3)), h = s.h;
    talon(m, { path: ctrl, w, h, up: [1, 0, 0], taper: 0.75, tipSize: 0.03, hex: s.hex, zones: { flat: Z.steel, edge: Z.edge } });
    talons.push({ path: ctrl, w, len });
  };
  s.lengths.forEach((len, i) => {
    if (i === 0) {
      place(0, len, 1);
    } else {
      place(s.gap * i, len, 1);
      place(-s.gap * i, len, -1);
    }
  });
  const tip = BASE_Y + Math.max(...s.lengths);
  // rear thumb spurs
  if (s.spurs) {
    for (const sgn of [-1, 1]) {
      const path = sampleBez2([sgn * pw * 0.78, 0.06, 0.0], [sgn * pw * 0.9, 0.12, -0.03], [sgn * pw * 0.78, 0.17, -0.07], 5);
      talon(m, { path, w: 0.012, h: 0.007, up: [1, 0, 0], taper: 0.8, tipSize: 0.03, hex: false, zones: { flat: Z.bone, edge: Z.bone } });
    }
  }
  // side fangs on the plate
  if (s.fangs) {
    for (const sgn of [-1, 1]) {
      const path = sampleBez2([sgn * pw * 0.95, 0.1, 0.0], [sgn * (pw + 0.045), 0.1, 0.012], [sgn * (pw + 0.05), 0.16, 0.05], 5);
      talon(m, { path, w: 0.013, h: 0.008, up: [1, 0, 0], taper: 0.7, tipSize: 0.03, hex: false, zones: { flat: Z.gold, edge: Z.gold } });
    }
  }
  // fur tufts around the cuff and the plate rim
  for (let k = 0; k < s.fur; k++) {
    const a = (k / s.fur) * Math.PI * 2 + 0.3;
    const cx = Math.cos(a), cz = Math.sin(a);
    const onCuff = k % 3 !== 2;
    const y0 = onCuff ? -0.07 : 0.05;
    const r0 = onCuff ? 0.03 : 0.024;
    const L = onCuff ? 0.075 : 0.045;
    const base: Vec3 = [cx * r0, y0, cz * r0];
    const path = sampleBez2(base, [cx * (r0 + 0.03), y0 + (onCuff ? -0.02 : 0.02), cz * (r0 + 0.03)], [cx * (r0 + 0.045), y0 + (onCuff ? -L : L * 0.8), cz * (r0 + 0.045)], 3);
    talon(m, { path, w: 0.01, h: 0.0065, up: [cz, 0, -cx], taper: 0.7, tipSize: 0.03, hex: false, zones: { flat: Z.fur, edge: Z.fur } });
  }
  if (s.gem) {
    add(m, gemMesh(0.013, 0.01, 6), Z.gem, orient([0, 0.082, 0.032], [0, 0.35, 1]));
  }
  return { mesh: m, talons, tip };
}

/** nearest talon sample: arc fraction t, lateral offset s (-1..1 across the blade) */
function talonLocal(talons: TalonRec[], p: Vec3): { t: number; s: number; w: number; side: number } {
  let best = 1e9, bt = 0, bs = 0, bw = 0.01;
  for (const tr of talons) {
    const pts = tr.path;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const l2 = dx * dx + dy * dy + dz * dz || 1e-9;
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / l2));
      const qx = a[0] + dx * u, qy = a[1] + dy * u, qz = a[2] + dz * u;
      const d = (p[0] - qx) ** 2 + (p[1] - qy) ** 2 + (p[2] - qz) ** 2;
      if (d < best) {
        best = d;
        bt = (i + u) / (pts.length - 1);
        const w = tr.w * Math.max(0.03, (1 - bt) ** 0.75);
        bw = w;
        bs = Math.max(-1, Math.min(1, (p[2] - qz) / w));
      }
    }
  }
  return { t: bt, s: bs, w: bw, side: 1 };
}

function clawPaint(s: ClawSpec, talons: TalonRec[]): PaintFn {
  const pal = s.pal;
  return (sm: PaintSample): Painted => {
    if (sm.zone === Z.gem) return gem(sm, pal);
    if (sm.zone === Z.fur) return furTuft(sm, pal);
    if (sm.zone === Z.steel || sm.zone === Z.edge) {
      const L = talonLocal(talons, sm.p);
      const loc = { t: L.t, s: sm.zone === Z.edge ? Math.sign(L.s || 1) * 0.95 : L.s * 0.6, w: L.w, side: sm.n[0] >= 0 ? 1 : -1 };
      const o = { wear: s.paint?.wear ?? 0.3, polish: 0.7, seed: s.seed };
      const base = sm.zone === Z.edge ? steelEdge(sm, pal, loc, o) : steelFlat(sm, pal, loc, o);
      if (s.vein && sm.zone === Z.steel) {
        const v = (1 - Math.min(1, Math.abs(L.s) / 0.34)) * Math.min(1, Math.max(0, (L.t - 0.1) / 0.3));
        if (v > 0.02) return { albedo: lerp3(base.albedo, pal.rune, v * 0.9), emissive: scale3(pal.rune, v * (0.5 + 0.9 * L.t)) };
      }
      return base;
    }
    return genericZone(sm, pal, { seed: s.seed, goldEngrave: s.paint?.goldEngrave ?? 0.5, wrapRadius: 0.0185 });
  };
}

export async function buildClaw(s: ClawSpec, log: (m: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const built = assembleClaw(s);
  const mesh = built.mesh.finish({ crease: 40 });
  log(`  ${s.id}: ${mesh.indices.length / 3} tris (pre-unwrap)`);
  const tex = opts?.texture ?? s.tex;
  const meta: WeaponMeta = {
    type: 'claw',
    tier: s.tier,
    hand: 'r',
    grip: 'claw',
    length: built.tip + 0.1,
    pommelZ: -0.1,
    tipZ: built.tip,
    trail: [BASE_Y, built.tip],
  };

  return bakeWeapon({
    id: s.id,
    mesh,
    paint: clawPaint(s, built.talons),
    size: tex > 0 ? tex : 64,
    emissiveSize: tex > 0 ? s.emissive ?? 0 : 0,
    seed: s.seed,
    hand: 'r',
    noTexture: tex === 0,
    material: { roughness: 0.55, metallic: 0 },
    extras: { weapon: { ...meta } },
    log,
  });
}
