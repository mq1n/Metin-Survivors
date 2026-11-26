// Shaman bell-staff builder. Canonical frame: grip centre at the origin, +Y toward the bell head. A ritual staff whose crown holds an arch
// with a hanging bronze bell (mouth down) and a clapper; higher tiers add extra bells, jade orbs, dragon fins and glowing rune bands.
import { HardMesh, extrude } from '../../core/hard/hardmesh.ts';
import type { Vec3 } from '../../core/math.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type PaintFn, type PaintSample, type Painted, bakeWeapon } from './bake.ts';
import type { WeaponMeta } from './frame.ts';
import { type Vec2, sweepSection } from './loft.ts';
import { type Pal, fract, gem, genericZone, glyph, lerp3, scale3 } from './paintkit.ts';
import { add, gemMesh, gripMesh, orient, ribbon, spin } from './parts.ts';
import { Z } from './zones.ts';

export interface BellSpec {
  id: string;
  tier: number;
  seed: number;
  pal: Pal;
  /** main bell: mouth radius, height */
  R: number;
  H: number;
  shaftZone: number;
  archZone: number;
  bellZone: number;
  /** small bells hung on the arch sides */
  sideBells: number;
  /** jade / gem orb on top of the arch */
  orb: 'none' | 'jade' | 'gem';
  /** dragon-fin plates on the arch */
  fins: boolean;
  tassels: number;
  tasselZone: number;
  /** glowing rune band around the bell */
  glow: boolean;
  tex: number;
  emissive?: number;
  paint?: { goldEngrave?: number };
}

const SHAFT_TOP = 0.16;

/** a hollow bell lying on the XZ plane at y0 (mouth down) */
function bellMesh(R: number, H: number, ridges: boolean): HardMesh {
  const prof: Vec2[] = [[0, 0.8 * H], [R * 0.5, 0.64 * H], [R * 0.92, 0.06 * H], [R * 0.99, 0], [R * 1.07, 0.035 * H], [R * 0.9, 0.13 * H], [R * 0.78, 0.34 * H], [R * 0.62, 0.6 * H], [R * 0.4, 0.82 * H], [R * 0.17, 0.95 * H], [R * 0.1, 1.0 * H]];
  if (ridges) prof.splice(6, 0, [R * 0.84, 0.22 * H], [R * 0.8, 0.26 * H]);
  return spin(prof, { segments: 10 });
}

export function assembleBell(s: BellSpec): { mesh: HardMesh; top: number } {
  const m = new HardMesh();
  const wood = s.shaftZone;
  // shaft
  gripMesh(m, { y0: -0.24, y1: SHAFT_TOP - 0.01, a: 0.0175, b: 0.0175, n: 8, bulge: 0.1, rings: 4, zone: wood });
  for (const y of [-0.235, 0.05]) add(m, spin([[0.0175, y - 0.004], [0.025, y - 0.002], [0.025, y + 0.002], [0.0175, y + 0.004]], { segments: 8 }), Z.gold);
  add(m, spin([[0, -0.31], [0.015, -0.292], [0.026, -0.268], [0.021, -0.245], [0, -0.238]], { segments: 8 }), Z.gold);
  // crown cup (lotus)
  const cup: Vec2[] = [[0.017, SHAFT_TOP - 0.03], [0.034, SHAFT_TOP - 0.012], [0.04, SHAFT_TOP + 0.004], [0.026, SHAFT_TOP + 0.016], [0.012, SHAFT_TOP + 0.02]];
  add(m, spin(cup, { segments: 8 }), s.archZone);
  // arch: two legs and a half circle over the bell
  const bellY0 = SHAFT_TOP + 0.075, bellR = s.R, H = s.H;
  const archR = bellR * 1.28, archC = bellY0 + H * 0.52;
  const arch: Vec3[] = [];
  arch.push([-archR * 0.55, SHAFT_TOP + 0.014, 0], [-archR * 0.9, SHAFT_TOP + 0.075, 0], [-archR, archC - 0.02, 0]);
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI - (i / 8) * Math.PI;
    arch.push([Math.cos(a) * archR, archC + Math.sin(a) * archR * 0.95, 0]);
  }
  arch.push([archR, archC - 0.02, 0], [archR * 0.9, SHAFT_TOP + 0.075, 0], [archR * 0.55, SHAFT_TOP + 0.014, 0]);
  sweepSection(m, arch, [[0.008, 0.0065], [-0.008, 0.0065], [-0.008, -0.0065], [0.008, -0.0065]], { zones: s.archZone, up: [0, 0, 1], capStart: true, capEnd: true });
  const archTop = archC + archR * 0.95;
  if (s.fins) {
    // dragon fins along the outside of the arch
    for (let k = 0; k < 5; k++) {
      const a = Math.PI * (0.1 + 0.2 * k);
      const nx = Math.cos(a), ny = Math.sin(a), tx = -ny, ty = nx; // outward normal / tangent (counter-clockwise)
      const cx = nx * archR, cy = archC + ny * archR * 0.95;
      const len = 0.05 * (1 - 0.18 * Math.abs(k - 2));
      const sweepDir = k < 2 ? 1 : k > 2 ? -1 : 0; // fins lean toward the crown
      const o: Vec2[] = [
        [cx - tx * 0.014, cy - ty * 0.014],
        [cx + nx * len * 0.55 - tx * 0.006, cy + ny * len * 0.55 - ty * 0.006],
        [cx + nx * len + tx * sweepDir * 0.012, cy + ny * len + ty * sweepDir * 0.012],
        [cx + tx * 0.014, cy + ty * 0.014],
      ];
      add(m, extrude(o, 0.006, { axis: 'z', z0: -0.003 }), Z.gold);
    }
  }
  // main bell hangs from the arch top
  add(m, bellMesh(bellR, H, s.tier >= 3), s.bellZone, orient([0, bellY0, 0], [0, 1, 0]));
  // hanging loop + clapper
  add(m, spin([[0, -0.01], [0.007, -0.004], [0.006, 0.0], [0, 0.006]], { segments: 6 }), s.archZone, orient([0, bellY0 + H, 0], [0, 1, 0]));
  sweepSection(m, [[0, bellY0 + H, 0], [0, archTop - 0.004, 0]], [[0.004, 0.004], [-0.004, 0.004], [-0.004, -0.004], [0.004, -0.004]], { zones: s.archZone, up: [0, 0, 1], capStart: true, capEnd: true });
  const cr = bellR * 0.2;
  add(m, spin([[0, -cr], [cr * 0.8, -cr * 0.5], [cr, 0], [cr * 0.8, cr * 0.5], [0, cr]], { segments: 8 }), s.archZone, orient([0, bellY0 + 0.01, 0], [0, 1, 0]));
  // bell mouth band
  add(m, spin([[bellR * 1.07, bellY0 + 0.0], [bellR * 1.11, bellY0 + 0.012], [bellR * 1.07, bellY0 + 0.024]], { segments: 10 }), Z.gold);
  // small bells on the arch sides
  for (let k = 0; k < s.sideBells; k++) {
    const sign = k % 2 ? 1 : -1, row = Math.floor(k / 2);
    const x = sign * (archR + 0.012), y = archC - 0.02 - row * 0.05;
    add(m, bellMesh(0.022, 0.034, false), s.bellZone, orient([x, y - 0.035, 0], [0, 1, 0]));
    add(m, spin([[0, -0.006], [0.006, 0], [0, 0.008]], { segments: 5 }), s.archZone, orient([x, y, 0], [0, 1, 0]));
  }
  // orb on top of the arch
  if (s.orb !== 'none') {
    add(m, s.orb === 'gem' ? gemMesh(0.024, 0.032, 6, 0.5) : spin([[0, 0], [0.014, 0.004], [0.026, 0.02], [0.02, 0.038], [0.006, 0.048], [0, 0.05]], { segments: 8 }), s.orb === 'gem' ? Z.gem : Z.jade, orient([0, archTop - 0.004, 0], [0, 1, 0]));
    add(m, spin([[0.01, -0.004], [0.02, 0.0], [0.016, 0.006]], { segments: 8 }), Z.gold, orient([0, archTop - 0.004, 0], [0, 1, 0]));
  }
  // lotus ring under the arch legs
  add(m, spin([[0.04, SHAFT_TOP - 0.006], [0.05, SHAFT_TOP], [0.04, SHAFT_TOP + 0.006]], { segments: 8 }), Z.gold);
  // tassels from the pommel
  for (let k = 0; k < s.tassels; k++) {
    const ang = (k / Math.max(1, s.tassels)) * Math.PI * 2 + 0.6;
    const dx = Math.cos(ang) * 0.012, dz = Math.sin(ang) * 0.012;
    ribbon(m, [[dx, -0.3, dz], [dx * 1.6, -0.36 - 0.01 * k, dz * 1.6], [dx * 1.9, -0.42 - 0.02 * k, dz * 1.9]], 0.0065, 0.003, 0.0016, s.tasselZone, [0, 0, 1]);
  }
  return { mesh: m, top: archTop + (s.orb !== 'none' ? 0.05 : 0) };
}

function bellPaint(s: BellSpec): PaintFn {
  const pal = s.pal;
  const H = s.H;
  const bellY0 = SHAFT_TOP + 0.075;
  return (sm: PaintSample): Painted => {
    if (sm.zone === Z.gem) return gem(sm, pal);
    const base = genericZone(sm, pal, { seed: s.seed, goldEngrave: s.paint?.goldEngrave ?? 0.5, wrapRadius: 0.0175 });
    if (sm.zone !== s.bellZone || !s.glow || Math.abs(sm.p[0]) + Math.abs(sm.p[2]) < 0.02) return base;
    const yy = (sm.p[1] - bellY0) / H;
    if (yy < 0.22 || yy > 0.52 || sm.n[1] > 0.6) return base;
    const a = Math.atan2(sm.p[2], sm.p[0]);
    const cells = 10, t = (a / (Math.PI * 2) + 0.5) * cells;
    const u = fract(t), cell = Math.floor(t);
    if (u < 0.22 || u > 0.78) return base;
    const g = glyph(cell * 5 + s.seed, (u - 0.22) / 0.56, (yy - 0.22) / 0.3, 0.05);
    if (g < 0.03) return base;
    return { albedo: lerp3(base.albedo, pal.rune, Math.min(1, g) * 0.9), emissive: scale3(pal.rune, g * 1.2) };
  };
}

export async function buildBell(s: BellSpec, log: (m: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const built = assembleBell(s);
  const mesh = built.mesh.finish({ crease: 40 });
  log(`  ${s.id}: ${mesh.indices.length / 3} tris (pre-unwrap)`);
  const tex = opts?.texture ?? s.tex;
  const meta: WeaponMeta = {
    type: 'bell',
    tier: s.tier,
    hand: 'r',
    grip: 'bell',
    length: built.top + 0.31,
    pommelZ: -0.31,
    tipZ: built.top,
    trail: [SHAFT_TOP, built.top],
    muzzle: [0, 0, SHAFT_TOP + 0.075 + s.H * 0.4],
  };
  return bakeWeapon({
    id: s.id,
    mesh,
    paint: bellPaint(s),
    size: tex > 0 ? tex : 64,
    emissiveSize: tex > 0 ? s.emissive ?? 0 : 0,
    seed: s.seed,
    hand: 'r',
    noTexture: tex === 0,
    material: { roughness: 0.5, metallic: 0 },
    extras: { weapon: { ...meta } },
    log,
  });
}
