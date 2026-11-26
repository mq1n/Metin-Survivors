// prop_yurt — snow-dusted round felt tent (4.0 m high, footprint r 3.4): a belled felt wall with sewn panels, a red key-fret trim band,
// two raised rope belts and a scalloped dark skirt, a domed conical roof with overlapping felt courses, a red zig-zag edge trim, wind-blown
// snow and six tie-down ropes, a red-lacquered crown ring with crossed spokes over a sooty smoke hole and an iron stove pipe, and a chunky
// painted door set (leaves, jambs, lintel, stone threshold) facing +Z.
import type { Vec3 } from '../../core/math.ts';
import type { Vec2 as H2 } from '../../core/hard/shape2d.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type PropMesh, mapBox, mapCylY } from '../../archetypes/prop/mesh.ts';
import { prism, revolve } from '../../archetypes/prop/kit.ts';
import { stone } from '../../archetypes/prop/mats.ts';
import { log, moveXf, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, darkLining, endGrain, rope, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { revolveArcs } from '../../archetypes/prop/ext/PropsVillage/geom.ts';
import { crownMat, yurtDoor, yurtFelt } from '../../archetypes/prop/ext/PropsVillage/yurtmats.ts';

const FELT = 0, DOOR = 1, ROPE = 2, CROWN = 3, LINING = 4, IRON = 5, STEP = 6, END = 7, WOOD = 8;

const SIDES = 24;
/** the shell rings are cut into three arcs (through faces 5, 13, 21) so the unwrapper gets short charts */
const PARTS = 3, CUT0 = 5;
/** wall lathe profile (r, y): flared hem, slight belly, then the eave soffit out to the lip */
const WALL: H2[] = [[3.36, 0], [3.27, 0.1], [3.16, 0.35], [3.14, 0.9], [3.1, 1.62], [3.34, 1.7]];
/** roof lathe profile: eave lip, then a convex dome up to the crown ring */
const ROOF: H2[] = [[3.34, 1.7], [3.37, 1.77], [3.2, 1.86], [2.55, 2.4], [1.85, 2.88], [1.2, 3.2], [0.74, 3.34]];
/** crown ring base height */
const CROWN_Y = 3.32;

/** wall radius at height y (rope belts follow the shell) */
function wallR(y: number): number {
  for (let i = 1; i < WALL.length; i++) {
    const [r1, y1] = WALL[i]!;
    if (y <= y1) {
      const [r0, y0] = WALL[i - 1]!;
      return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
    }
  }
  return WALL[WALL.length - 1]![0];
}

/** annular-sector block of the door set: radii r0..r1, angles a0..a1 (0 = +Z, positive toward +X), n outline points per arc */
function sector(m: PropMesh, mat: number, r0: number, r1: number, a0: number, a1: number, y0: number, y1: number, n = 2, bevel = 0.016): void {
  const arc = (r: number, k: number): H2 => {
    const a = a0 + ((a1 - a0) * k) / (n - 1);
    return [Math.sin(a) * r, Math.cos(a) * r];
  };
  const ks = Array.from({ length: n }, (_, k) => k);
  const outer = ks.map((k) => arc(r1, k));
  const inner = ks.map((k) => arc(r0, k)).reverse();
  prism(m, mat, mapBox(0.9), [...outer, ...inner], y0, y1, { bevel });
}

export const prop: PropDef = {
  id: 'prop_yurt',
  size: 2048,
  aoLong: 2.6,
  crease: 42,
  mats: [
    yurtFelt('yurt-felt', { wallR: 3.12, band: [1.14, 1.38], snow: 0.72 }),
    yurtDoor('yurt-door'),
    rope('yurt-rope', { across: 'v', color: '#9a7b46', dark: '#3b2c18' }),
    crownMat('yurt-crown', CROWN_Y),
    darkLining('yurt-smoke', { color: '#150f0b' }),
    blackIron('yurt-iron', { rust: 0.5, tone: '#2e2e34' }),
    stone('yurt-step', { tex: ['tex_stone_block_wall', 'tex_rock_mossy'], dark: '#5a574f', light: '#aaa291', moss: 0.1, dirt: 0.5, wear: 0.6, k: 1 }),
    endGrain('yurt-end'),
    timber('yurt-spoke', { dark: '#2e1d13', mid: '#5f3a22', light: '#8f6742', grey: '#8f8470', facets: 0.3, dirt: 0.5 }),
  ],
  build(m: PropMesh) {
    // ---- felt shell: belled wall, then the dome (rings cut into arcs)
    const shell = mapCylY(0, 0, 3.1, 1);
    for (const h of revolveArcs(WALL, SIDES, PARTS, CUT0)) m.add(h, FELT, shell);
    for (const h of revolveArcs(ROOF, SIDES, PARTS, CUT0)) m.add(h, FELT, shell);
    // ---- two raised rope belts round the wall
    for (const y0 of [0.46, 0.8]) {
      const r = wallR(y0 + 0.05);
      for (const h of revolveArcs([[r - 0.012, y0], [r + 0.05, y0 + 0.025], [r - 0.012, y0 + 0.12]], SIDES, PARTS, CUT0)) m.add(h, ROPE, mapCylY(0, 0, r, 0.5));
    }
    // ---- six tie-down ropes over the dome, along the polygon's vertex ridges (clear of the door)
    const ridge: Vec3[] = [[0.84, 3.31], ...ROOF.slice(2, 6).map(([r, y]) => [r, y] as [number, number]).reverse(), [3.36, 1.8]].map(([r, y]) => [r!, y! + 0.026, 0] as Vec3);
    for (const k of [0, 4, 8, 12, 16, 20]) {
      const th = (k / SIDES) * Math.PI * 2;
      const path = ridge.map(([r, y]) => [Math.cos(th) * r, y, -Math.sin(th) * r] as Vec3);
      tube(m, { path, radii: path.map(() => 0.025), sides: 3, mat: ROPE, s: 0.5, caps: 'end', seed: `tie${k}` });
    }
    // ---- door set: two leaves, jambs, lintel, stone threshold
    for (const s of [-1, 1]) {
      sector(m, DOOR, 3.0, 3.24, 0, s * 0.1612, 0.08, 1.42);
      sector(m, DOOR, 3.0, 3.27, s * 0.1612, s * 0.2, 0.05, 1.5, 2, 0);
    }
    sector(m, DOOR, 3.0, 3.27, -0.21, 0.21, 1.42, 1.6, 4);
    sector(m, STEP, 3.05, 3.52, -0.24, 0.24, 0, 0.1, 4);
    // ---- crown ring (toono): red-lacquer ring over a dark smoke hole with two crossed spokes
    m.add(revolve([[0.8, CROWN_Y], [0.85, CROWN_Y + 0.08], [0.85, CROWN_Y + 0.28], [0.74, CROWN_Y + 0.34]], 16), CROWN, mapCylY(0, 0, 0.8, 0.7));
    m.add(revolve([[0.74, CROWN_Y + 0.34], [0.74, 3.52], [0, 3.52]], 16), LINING, mapBox(1));
    log(m, WOOD, [-0.78, 3.585, 0], [0.78, 3.585, 0], 0.036, 0.036, { sides: 4, segs: 1, capMat: END, seed: 'spoke-x' });
    log(m, WOOD, [0, 3.585, -0.78], [0, 3.585, 0.78], 0.036, 0.036, { sides: 4, segs: 1, capMat: END, seed: 'spoke-z' });
    // ---- stove pipe through the smoke hole with a flared rain hat
    const px = 0.12, pz = -0.2;
    tube(m, { path: [[px, 3.52, pz], [px, 3.92, pz]], radii: [0.07, 0.07], sides: 8, mat: IRON, s: 0.5, caps: 'end', seed: 'pipe' });
    m.add(revolve([[0.1, 3.88], [0.17, 3.9], [0.12, 3.95], [0, 4.0]], 8), IRON, mapCylY(px, pz, 0.15, 0.5), moveXf(px, 0, pz));
  },
};
