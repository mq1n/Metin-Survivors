// prop_ruin_pillar — 5 m broken stone pillar (zones: seori frost ruins, daeryeol): a stepped square plinth with a roll moulding,
// a chamfered-octagon shaft with a carved collar band and entasis, snapped off along a slanted fracture with a jagged chipped rim,
// the fallen drum lying across the plinth edge, rubble. Weathered grey granite with moss in the damp base and hairline veins;
// the fresh break is paler than the weathered skin. Tilted a hair off plumb.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import { m4mul, m4translation, vnorm } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { prism, rectCorners, revolve } from '../../archetypes/prop/kit.ts';
import { mapAuto, mapCylY } from '../../archetypes/prop/mesh.ts';
import { TAG_GROUND, addFaces, groundPlane, hull, rockPlanes, rotX, rotYm, rotZ, xfPlanes, type Plane } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { tri3 } from '../../archetypes/prop/ext/PropsElem/arch.ts';
import { rockMat } from '../../archetypes/prop/ext/PropsElem/mats.ts';

const STONE = 0, BROKEN = 1, HULLSTONE = 2;

const SKIN = {
  dark: '#4e5050',
  light: '#b9b7b0',
  warm: '#928d82',
  cool: '#7c848c',
  facet: 0.5,
  strata: 0.5,
  grain: 0.9,
  cracks: 0.7,
  bump: 0.45,
  moss: 0.5,
  lichen: 0.45,
  damp: 0.75,
  dirt: 0.5,
  stain: 0.9,
  edge: '#dedbd0',
  edgeAmt: 0.45,
} as const;

export const prop: PropDef = {
  id: 'prop_ruin_pillar',
  size: 1024,
  crease: 30,
  aoShort: 0.5,
  aoLong: 2.2,
  mats: [
    rockMat('granite-skin', { ...SKIN, arch: true }),
    rockMat('granite-fresh', { ...SKIN, dark: '#6d6d68', light: '#d3d0c6', moss: 0, lichen: 0, damp: 0, dirt: 0, stain: 0.2, cracks: 0.5, facet: 0.7, edgeAmt: 0.3 }),
    rockMat('granite-hull', SKIN),
  ],
  build(m) {
    const wall = mapAuto(1.2);

    // ---- stepped square plinth
    prism(m, STONE, wall, rectCorners(0.98, 0.98), 0, 0.26, { bevel: 0.045 });
    prism(m, STONE, wall, rectCorners(0.76, 0.76), 0.26, 0.5, { bevel: 0.035 });
    // ---- roll moulding + cavetto
    m.add(
      revolve([[0.78, 0.5], [0.84, 0.54], [0.82, 0.6], [0.7, 0.64], [0.62, 0.7], [0.58, 0.8]], 24),
      STONE, mapCylY(0, 0, 0.7, 1.2),
    );

    // ---- shaft: 16 points per ring (chamfered octagon), entasis, carved collar, slanted fracture
    const N = 16;
    const radius = (y: number): number => 0.58 - 0.075 * ((y - 0.8) / 3.9) + 0.025 * Math.sin(Math.min(1, (y - 0.8) / 2.6) * Math.PI);
    const ring = (y: number, r: number, jagFn?: (k: number) => [number, number]): Vec3[] =>
      Array.from({ length: N }, (_, k) => {
        const th = (k / N) * Math.PI * 2 + 0.3;
        const j = jagFn?.(k);
        const rr = r * (k % 2 === 0 ? 1 : 0.935) * (j ? j[1] : 1);
        return [Math.cos(th) * rr, j ? j[0] : y, -Math.sin(th) * rr] as Vec3;
      });
    const ys = [0.8, 1.0, 1.02, 1.14, 1.16, 2.3, 3.5];
    const rings: Vec3[][] = ys.map((y) => ring(y, y >= 1.02 && y <= 1.14 ? radius(y) + 0.045 : radius(y)));
    const map = mapCylY(0, 0, 0.55, 1.2);
    for (let i = 0; i + 1 < rings.length; i++) {
      const A = rings[i]!, B = rings[i + 1]!;
      for (let k = 0; k < N; k++) {
        const a = A[k]!, b = A[(k + 1) % N]!, c = B[(k + 1) % N]!, d = B[k]!;
        tri3(m, STONE, map, a, b, c);
        tri3(m, STONE, map, a, c, d);
      }
    }
    // the snapped top: the last 1.5 m of the shaft as a convex block cut by slanted fracture planes and chipped corners
    {
      const sec = rings[rings.length - 1]!;
      const planes: Plane[] = sec.map((p, k) => {
        const q = sec[(k + 1) % N]!;
        const ex = q[0] - p[0], ez = q[2] - p[2];
        const l = Math.hypot(ex, ez);
        let n: Vec3 = [ez / l, 0, -ex / l];
        if (n[0] * (p[0] + q[0]) + n[2] * (p[2] + q[2]) < 0) n = [-n[0], 0, -n[2]];
        return { n, d: n[0] * p[0] + n[2] * p[2] };
      });
      planes.push({ n: [0, -1, 0], d: -3.5, tag: TAG_GROUND });
      const brk: Plane[] = [
        { n: vnorm([0.55, 1, 0.12]), d: 0 },
        { n: vnorm([-0.42, 1, -0.3]), d: 0 },
        { n: vnorm([0.12, 1, -0.85]), d: 0 },
        { n: vnorm([-0.8, 0.9, 0.5]), d: 0 },
        { n: vnorm([0.25, 1, 0.95]), d: 0 },
        { n: vnorm([0.9, 0.7, -0.45]), d: 0 },
      ];
      const heights = [4.78, 4.9, 4.7, 4.96, 4.62, 4.4];
      brk.forEach((p, i) => { p.d = p.n[1] * heights[i]!; });
      let faces = hull([...planes, ...brk], 6);
      let maxY = 0;
      for (const f of faces) for (const p of f.poly) maxY = Math.max(maxY, p[1]);
      const lift = 5.0 - maxY;
      brk.forEach((p) => { p.d += p.n[1] * lift; });
      faces = hull([...planes, ...brk], 6);
      addFaces(m, faces, { mat: (f) => (f.n[1] > 0.4 ? BROKEN : HULLSTONE), skip: [TAG_GROUND], rough: { edge: 0.07, centre: 0.03, minEdge: 0.2, seed: 5 } });
    }

    // ---- the fallen drum: a sixteen-sided section lying on the ground, one end broken on a slant
    {
      const R = 0.44, L = 1.15;
      const planes: Plane[] = [];
      for (let k = 0; k < 16; k++) {
        const phi = (k / 16) * Math.PI * 2 + 0.2;
        planes.push({ n: [0, Math.cos(phi), Math.sin(phi)], d: R * (k % 2 === 0 ? 1 : 0.95) });
      }
      planes.push({ n: [1, 0.18, 0.1], d: L / 2 }, { n: [-1, -0.1, 0.12], d: L / 2 - 0.08 });
      const rr = new Rng('ruin_pillar:drum');
      for (let i = 0; i < 3; i++) {
        const n: Vec3 = [(rr.next() - 0.5) * 1.4, rr.next() - 0.2, (rr.next() - 0.5) * 1.4];
        const l = Math.hypot(...n);
        planes.push({ n: [n[0] / l, n[1] / l, n[2] / l], d: R * 0.78 });
      }
      const xf = m4mul(m4translation([0.78, R * 0.72, 0.58]), m4mul(rotYm(0.9), rotX(0.04)));
      addFaces(m, hull([...xfPlanes(planes, xf), groundPlane(0)], 6), { mat: HULLSTONE, skip: [TAG_GROUND], rough: { edge: 0.06, centre: 0.06, seed: 21 } });
    }

    // ---- rubble
    const rubble: { at: Vec3; r: Vec3; yaw: number }[] = [
      { at: [-0.9, 0, 0.72], r: [0.32, 0.21, 0.28], yaw: 0.5 },
      { at: [0.3, 0, -1.02], r: [0.27, 0.18, 0.23], yaw: 1.7 },
      { at: [-0.42, 0, 1.15], r: [0.2, 0.14, 0.17], yaw: 2.4 },
      { at: [1.0, 0, -0.5], r: [0.22, 0.16, 0.19], yaw: 0.9 },
    ];
    rubble.forEach((rb, i) => {
      const local = rockPlanes(new Rng(`ruin_pillar:r${i}`), { r: rb.r, n: 9, jitter: 0.4, cut: [0.72, 1], chips: 1 });
      const xf = m4mul(m4translation([rb.at[0], rb.r[1] * 0.3, rb.at[2]]), m4mul(rotYm(rb.yaw), rotZ(0.1)));
      addFaces(m, hull([...xfPlanes(local, xf), groundPlane(0)], 6), { mat: HULLSTONE, skip: [TAG_GROUND], rough: { edge: 0.1, centre: 0.08, seed: 40 + i } });
    });
  },
};

