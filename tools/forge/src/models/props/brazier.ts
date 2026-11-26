// prop_brazier — 1.6 m cast-bronze tripod fire basin (ding style) for the temple / volcanic plazas: a deep round basin with a flared,
// polished lip, a thunder-spiral band under the neck and a taotie beast mask over each leg, two upright loop ears on the rim, three
// S-curved beast legs with a mask on the knee ending in lion paws. Green-blue verdigris in the crevices, worn gold edges, soot inside
// and on the lip; a heap of glowing coals with low licking flames (emissive; a VFX flame may sit on top).
import type { Mat4, Vec3 } from '../../core/math.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { extrude } from '../../core/hard/hardmesh.ts';
import { Rng } from '../../core/rng.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { Mapper, Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01 } from '../../archetypes/prop/mats.ts';
import { tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { FIRE, coalHeap, coalMat, flameMat, flameTongue } from '../../archetypes/prop/ext/PropsElem2/fire.ts';
import { TAU, lathe2, thetaOf, wrapA } from '../../archetypes/prop/ext/PropsElem2/geo.ts';
import { bronzeMat } from '../../archetypes/prop/ext/PropsElem2/metal.ts';
import { NO_RELIEF, leiwenBand, taotie } from '../../archetypes/prop/ext/PropsElem2/motifs.ts';

const BRONZE = 0, LEG = 1, COALS = 2, FLAME = 3;

const TH_F = -Math.PI / 2;
/** legs: two at the front corners, one at the back */
const LEG_TH = [0, 1, 2].map((k) => TH_F + Math.PI / 3 + (k * TAU) / 3);
/** loop ears left and right */
const EAR_TH = [0, Math.PI];

const Y_BELLY = 0.8, Y_COAL = 1.0;
const BOWL: [number, number][] = [[0, 0.53], [0.32, 0.56], [0.53, 0.66], [0.63, 0.8], [0.62, 0.92], [0.585, 0.99], [0.64, 1.06], [0.73, 1.12], [0.69, 1.165], [0.6, 1.13], [0.55, 1.0]];

const radial = (p: Vec3): number => Math.hypot(p[0], p[2]);
const inward = (t: Texel): number => -(t.n[0] * t.p[0] + t.n[2] * t.p[2]) / Math.max(1e-3, radial(t.p));

/** nearest leg angle offset (rad) */
const legOff = (th: number): number => LEG_TH.reduce((b, a) => (Math.abs(wrapA(th - a)) < Math.abs(b) ? wrapA(th - a) : b), 9);

const bowlMat = bronzeMat('bronze', {
  k: 1.6,
  corrode: 0.6,
  polish: 0.7,
  soot: (t) => clamp01(smoothstep(0.15, 0.5, inward(t)) * 0.9 + smoothstep(1.08, 1.17, t.p[1]) * 0.35),
  heat: (t) => clamp01(smoothstep(0.25, 0.6, inward(t)) * (1 - smoothstep(1.0, 1.15, t.p[1])) * 0.5 * (0.5 + 0.7 * fbm01(t, 12, 2, 4.4))),
  motif: (t) => {
    if (inward(t) > 0.1) return NO_RELIEF;
    const th = thetaOf(t.p);
    if (t.p[1] > 0.95 && t.p[1] < 1.05) return leiwenBand(th * 0.62, t.p[1], { cy: 1.0, h: 0.075, line: 0.075 });
    const off = legOff(th);
    if (Math.abs(off) < 0.5) return taotie(off * radial(t.p), t.p[1] - Y_BELLY + 0.005, 0.19);
    return NO_RELIEF;
  },
});

const legMat = bronzeMat('bronze-leg', { k: 1.6, corrode: 0.45, polish: 0.75, soot: (t) => (1 - smoothstep(0.0, 0.25, t.p[1])) * 0.35 });

/** column-major frame from axes + origin */
const frame = (x: Vec3, y: Vec3, z: Vec3, o: Vec3): Mat4 => [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
const dirAt = (th: number): Vec3 => [Math.cos(th), 0, -Math.sin(th)];
const tanAt = (th: number): Vec3 => [-Math.sin(th), 0, -Math.cos(th)];
const at = (th: number, r: number, y: number, t = 0): Vec3 => {
  const d = dirAt(th), g = tanAt(th);
  return [d[0] * r + g[0] * t, y, d[2] * r + g[2] * t];
};

/** planar metre mapper (dominant axis) */
const mapBlock: Mapper = (a, b, c, n) => {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const f = (p: Vec3): [number, number] => (ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], -p[1]] : [p[0], -p[1]]);
  return [f(a), f(b), f(c)];
};

/** knee shield: beast-mask plate (outline in the leg's side / up plane) */
const SHIELD: [number, number][] = [[-0.08, 0.065], [-0.095, -0.02], [0, -0.105], [0.095, -0.02], [0.08, 0.065], [0, 0.04]];
/** notched cast flange on the belly between the masks (outline in radius / height) */
const FLANGE: [number, number][] = [[0.5, 0.63], [0.57, 0.64], [0.645, 0.72], [0.625, 0.755], [0.685, 0.8], [0.685, 0.86], [0.645, 0.885], [0.675, 0.93], [0.625, 0.99], [0.52, 0.99]];

export const prop: PropDef = {
  id: 'prop_brazier',
  size: 1024,
  crease: 26,
  aoShort: 0.25,
  aoLong: 1.2,
  aoGain: 1.2,
  shadowTint: [0.45, 0.42, 0.4],
  emissiveFactor: [1, 1, 1],
  material: { roughness: 0.6, metallic: 0.35 },
  mats: [bowlMat, legMat, coalMat('coals', FIRE, { scale: 14, base: 0.3, y0: Y_COAL, y1: Y_COAL + 0.2 }), flameMat('flame', FIRE)],
  build(m) {
    const rng = new Rng('brazier');
    // ---- basin with three notched flanges between the masks
    lathe2(m, BRONZE, BOWL, 16, { phase: TH_F });
    for (const th of LEG_TH) {
      const d = dirAt(th + Math.PI / 3);
      m.add(extrude(FLANGE, 0.04, { axis: 'z', z0: -0.02 }), BRONZE, mapBlock, frame(d, [0, 1, 0], [-d[2], 0, d[0]], [0, 0, 0]));
    }

    // ---- loop ears standing on the lip
    for (const th of EAR_TH) {
      const r0 = 0.67;
      const path: Vec3[] = [at(th, r0, 1.1, -0.13), at(th, r0 + 0.005, 1.26, -0.13), at(th, r0 + 0.01, 1.33, -0.1), at(th, r0 + 0.01, 1.35, 0), at(th, r0 + 0.01, 1.33, 0.1), at(th, r0 + 0.005, 1.26, 0.13), at(th, r0, 1.1, 0.13)];
      tube(m, { path, radii: path.map(() => 0.03), sides: 4, mat: BRONZE, s: 0.3, squash: 1.4, caps: 'none', seed: `ear${th}`, phase: Math.PI / 4 });
    }

    // ---- three S-curved beast legs with knee masks and lion paws
    for (const th of LEG_TH) {
      const P: [number, number][] = [[0.36, 0.74], [0.5, 0.66], [0.6, 0.53], [0.63, 0.4], [0.6, 0.25], [0.59, 0.13], [0.62, 0.05]];
      const R = [0.075, 0.085, 0.095, 0.08, 0.058, 0.06, 0.07];
      tube(m, { path: P.map(([r, y]) => at(th, r, y)), radii: R, sides: 6, mat: LEG, s: 0.3, caps: 'none', seed: `leg${th}`, jitter: 0.04 });
      // paw: squat lobed pad with toes pushed outward
      const d = dirAt(th);
      const pc = at(th, 0.645, 0);
      lathe2(m, LEG, [[0, 0], [0.11, 0.0], [0.12, 0.04], [0.075, 0.09], [0.0, 0.105]], 9, {
        cx: pc[0],
        cz: pc[2],
        phase: th,
        mod: (a, i, _k, r, y) => {
          const toe = Math.max(0, Math.cos(wrapA(a - th) * 3)) * (Math.abs(wrapA(a - th)) < 1.2 ? 1 : 0.2);
          return [r * (1 + (i >= 1 && i <= 2 ? 0.3 * toe : 0)), y];
        },
      });
      // knee mask facing outward
      const kp = at(th, 0.6 + 0.085, 0.54);
      const g = tanAt(th);
      const M = frame([g[0], 0, g[2]], [0, 1, 0], d, kp);
      m.add(extrude(SHIELD, 0.05, { axis: 'z', z0: -0.035, bevel: { size: 0.012, segments: 1 } }), LEG, mapBlock, M);
    }

    // ---- coals + flames
    coalHeap(m, COALS, { cx: 0, cz: 0, y0: Y_COAL, h: 0.22, r: 0.57, segs: 12, lumps: 3, lumpR: 0.1, seed: 'brazier-coals' });
    flameTongue(m, FLAME, { base: [0, Y_COAL + 0.08, 0], h: 0.52, r: 0.26, lobes: 3, twist: 2.2, sway: 0.4, phase: 1.1, rings: 7 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5 + (rng.next() - 0.5) * 0.5;
      const rr = 0.3 + rng.next() * 0.08;
      flameTongue(m, FLAME, {
        base: [Math.cos(a) * rr, Y_COAL + 0.07, -Math.sin(a) * rr],
        h: 0.28 + rng.next() * 0.12,
        r: 0.13 + rng.next() * 0.04,
        lean: [Math.cos(a) * 0.08, -Math.sin(a) * 0.08],
        lobes: 3,
        twist: 1.5 + rng.next(),
        phase: rng.next() * 6,
        rings: 6,
      });
    }
  },
};
