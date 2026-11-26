// Shaman fan builder. Canonical frame: grip centre at the origin, +Y toward the fan, face normal +-Z, the fan opens in the XY plane
// around the pivot at the top of the handle. Static (one rigid mesh).
import { extrude, HardMesh } from '../../core/hard/hardmesh.ts';
import type { ModelData } from '../../core/model.ts';
import type { BuildOpts } from '../../core/registry.ts';
import { type PaintFn, type PaintSample, type Painted, bakeWeapon } from './bake.ts';
import type { WeaponMeta } from './frame.ts';
import { type Vec2, sweepSection } from './loft.ts';
import { type Pal, fract, gem, genericZone, glyph, lerp3, scale3 } from './paintkit.ts';
import { add, gemMesh, gripMesh, orient, ribbon, spin } from './parts.ts';
import { Z } from './zones.ts';

export type FanPanel = 'scallop' | 'spike' | 'feather';

export interface FanSpec {
  id: string;
  tier: number;
  seed: number;
  pal: Pal;
  /** outer radius (m) and half opening angle (deg) */
  R: number;
  spread: number;
  ribs: number;
  panel: FanPanel;
  panelZone: number;
  ribZone: number;
  /** thicker outer guard sticks */
  guardZone: number;
  handleZone: number;
  gem: boolean;
  /** hanging pendant / tassel colour zone, 0 = none */
  tassel: number;
  /** glowing talisman marks on the panel */
  glow: boolean;
  /** concentric inlay ring on panel */
  ring: boolean;
  tex: number;
  emissive?: number;
  paint?: { goldEngrave?: number };
}

const PY = 0.115; // pivot height
const deg = Math.PI / 180;

export function assembleFan(s: FanSpec): { mesh: HardMesh; R: number } {
  const m = new HardMesh();
  // handle
  gripMesh(m, { y0: -0.13, y1: PY - 0.005, a: 0.0165, b: 0.0165, n: 8, bulge: 0.12, rings: 4, zone: s.handleZone });
  for (const y of [-0.128, 0.07]) add(m, spin([[0.016, y - 0.004], [0.023, y - 0.002], [0.023, y + 0.002], [0.016, y + 0.004]], { segments: 8 }), Z.gold);
  add(m, spin([[0, -0.19], [0.016, -0.172], [0.026, -0.152], [0.02, -0.132], [0, -0.126]], { segments: 8 }), Z.gold);
  if (s.tassel) {
    ribbon(m, [[0, -0.19, 0], [0.004, -0.24, 0.002], [0.002, -0.29, 0]], 0.006, 0.0025, 0.0016, s.tassel, [1, 0, 0]);
    ribbon(m, [[0, -0.19, 0], [-0.008, -0.235, -0.002], [-0.012, -0.27, 0]], 0.005, 0.0022, 0.0016, s.tassel, [1, 0, 0]);
  }
  const a0 = -s.spread * deg, a1 = s.spread * deg, N = s.ribs;
  const angOf = (k: number): number => a0 + ((a1 - a0) * k) / N;
  const pt = (a: number, r: number): Vec2 => [Math.sin(a) * r, PY + Math.cos(a) * r];
  const R = s.R;
  const th = 0.0042; // half thickness of the panel
  // panel
  if (s.panel === 'feather') {
    // one leaf-shaped feather per rib, alternating in depth so overlaps do not z-fight
    for (let k = 0; k <= N; k++) {
      const a = angOf(k), step = (a1 - a0) / N;
      const wid = step * 0.62;
      const rr = R * (1 - 0.1 * Math.abs(k - N / 2) / (N / 2));
      const outline: Vec2[] = [pt(a, 0.03), pt(a - wid * 0.55, rr * 0.38), pt(a - wid, rr * 0.7), pt(a - wid * 0.55, rr * 0.93), pt(a, rr * 1.0), pt(a + wid * 0.55, rr * 0.93), pt(a + wid, rr * 0.7), pt(a + wid * 0.55, rr * 0.38)];
      const z0 = (k % 2 ? -1 : -0.2) * th * 1.1;
      add(m, extrude(outline, th * 1.1, { axis: 'z', z0 }), s.panelZone);
    }
  } else {
    const outline: Vec2[] = [[0, PY - 0.02]];
    for (let k = 0; k < N; k++) {
      const aa = angOf(k), bb = angOf(k + 1);
      if (s.panel === 'scallop') {
        outline.push(pt(aa, R * 0.95), pt(aa + (bb - aa) * 0.5, R * 1.04));
      } else {
        outline.push(pt(aa, R * 0.84), pt(aa + (bb - aa) * 0.25, R * 0.95), pt(aa + (bb - aa) * 0.5, R * 1.14), pt(aa + (bb - aa) * 0.75, R * 0.95));
      }
    }
    outline.push(pt(a1, s.panel === 'scallop' ? R * 0.95 : R * 0.84));
    add(m, extrude(outline, th * 2, { axis: 'z', z0: -th }), s.panelZone);
  }
  // ribs on both faces + wide guard sticks on the outside
  for (let k = 0; k <= N; k++) {
    const a = angOf(k), edge = k === 0 || k === N;
    const hw = edge ? 0.0075 : 0.0042;
    const zz = edge ? 0.0042 : 0.0056;
    for (const side of [1, -1]) {
      const base = pt(a, 0.0), tip = pt(a, R * (edge ? 1.02 : s.panel === 'feather' ? 1.0 : 0.96));
      const path = [[base[0], base[1], side * zz], [tip[0], tip[1], side * zz]] as [number, number, number][];
      sweepSection(m, path, [[hw, 0.0016], [-hw, 0.0016], [-hw, -0.0016], [hw, -0.0016]], { zones: edge ? s.guardZone : s.ribZone, up: [0, 0, 1], capStart: true, capEnd: true });
    }
    if (edge) {
      // guard stick end cap
      const tip = pt(a, R * 1.03);
      add(m, spin([[0, -0.012], [0.0085, -0.006], [0.0085, 0.004], [0, 0.026]], { segments: 6 }), Z.gold, orient([tip[0], tip[1], 0], [Math.sin(a), Math.cos(a), 0]));
    }
  }
  // outer rim band between guards (a thin arc)
  if (s.panel === 'scallop') {
    for (const side of [1, -1]) {
      const arc: [number, number, number][] = [];
      for (let i = 0; i <= N * 2; i++) {
        const a = a0 + ((a1 - a0) * i) / (N * 2);
        const q = pt(a, R * (s.panel === 'scallop' ? (i % 2 ? 1.02 : 0.94) : i % 4 === 2 ? 1.11 : i % 2 ? 0.93 : 0.84));
        arc.push([q[0], q[1], side * 0.0052]);
      }
      sweepSection(m, arc, [[0.0022, 0.0014], [-0.0022, 0.0014], [-0.0022, -0.0014], [0.0022, -0.0014]], { zones: s.guardZone, up: [0, 0, 1], capStart: true, capEnd: true });
    }
  }
  // pivot medallion + gem
  for (const side of [1, -1]) {
    add(m, spin([[0, 0], [0.026, 0], [0.03, 0.003], [0.026, 0.0075], [0.012, 0.0095], [0, 0.0095]], { segments: 10 }), Z.gold, orient([0, PY, side * 0.0045], [0, 0, side], 0));
    if (s.gem) add(m, gemMesh(0.013, 0.01, 6), Z.gem, orient([0, PY, side * 0.012], [0, 0, side]));
  }
  return { mesh: m, R };
}

function fanPaint(s: FanSpec): PaintFn {
  const pal = s.pal;
  return (sm: PaintSample): Painted => {
    if (sm.zone === Z.gem) return gem(sm, pal);
    const base = genericZone(sm, pal, { seed: s.seed, goldEngrave: s.paint?.goldEngrave ?? 0.5, wrapRadius: 0.0165 });
    if (sm.zone !== s.panelZone || Math.abs(sm.n[2]) < 0.6) return base;
    const x = sm.p[0], y = sm.p[1] - PY, r = Math.hypot(x, y), a = Math.atan2(x, y);
    let c = base.albedo, e: [number, number, number] | undefined;
    // rim band and inner ring in gold ink
    if (s.ring) {
      const k = Math.max(0, 1 - Math.abs(r - s.R * 0.88) / 0.004, 1 - Math.abs(r - s.R * 0.34) / 0.003);
      if (k > 0) c = lerp3(c, pal.goldLight, Math.min(1, k) * 0.85);
    }
    if (s.glow && r > s.R * 0.38 && r < s.R * 0.8) {
      const cells = 9;
      const u = fract((a / (s.spread * deg) * 0.5 + 0.5) * cells), cell = Math.floor((a / (s.spread * deg) * 0.5 + 0.5) * cells);
      const v = (r - s.R * 0.38) / (s.R * 0.42);
      if (u > 0.3 && u < 0.7) {
        const g = glyph(cell * 7 + s.seed, (u - 0.3) / 0.4, v, 0.05);
        if (g > 0.03) {
          c = lerp3(c, pal.rune, Math.min(1, g) * 0.9);
          e = scale3(pal.rune, g * 1.2);
        }
      }
    }
    return e ? { albedo: c, emissive: e } : { ...base, albedo: c };
  };
}

export async function buildFan(s: FanSpec, log: (m: string) => void, opts?: BuildOpts): Promise<ModelData> {
  const built = assembleFan(s);
  const mesh = built.mesh.finish({ crease: 40 });
  log(`  ${s.id}: ${mesh.indices.length / 3} tris (pre-unwrap)`);
  const tex = opts?.texture ?? s.tex;
  const meta: WeaponMeta = {
    type: 'fan',
    tier: s.tier,
    hand: 'r',
    grip: 'fan',
    length: PY + s.R + 0.19,
    pommelZ: -0.19,
    tipZ: PY + s.R,
    trail: [PY, PY + s.R],
    muzzle: [0, 0, PY + s.R * 0.6],
  };
  return bakeWeapon({
    id: s.id,
    mesh,
    paint: fanPaint(s),
    size: tex > 0 ? tex : 64,
    emissiveSize: tex > 0 ? s.emissive ?? 0 : 0,
    seed: s.seed,
    hand: 'r',
    noTexture: tex === 0,
    material: { roughness: 0.6, metallic: 0 },
    extras: { weapon: { ...meta, fan: { radius: s.R, spreadDeg: s.spread } } },
    log,
  });
}
