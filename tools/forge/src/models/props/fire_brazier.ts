// prop_fire_brazier — 1.2 m wrought-iron cage brazier of the volcanic outposts: three square-bar legs curl into scroll feet, gather in a
// forged collar and sweep on up as the ribs of an open basket; three more ribs, two banding hoops and a shallow grate pan complete
// the cage, every rib ending in an outward scroll. Blue-black hammered iron, rust in the joints, soot and heat-bluing toward the top;
// a heap of glowing coals in the pan with licking flames (emissive; the game adds a VFX flame on top).
import type { Vec3 } from '../../core/math.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01 } from '../../archetypes/prop/mats.ts';
import { tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { FIRE, coalHeap, coalMat, flameMat, flameTongue } from '../../archetypes/prop/ext/PropsElem2/fire.ts';
import { TAU, lathe2 } from '../../archetypes/prop/ext/PropsElem2/geo.ts';
import { ironMat } from '../../archetypes/prop/ext/PropsElem2/metal.ts';

const IRON = 0, COALS = 1, FLAME = 2;

const TH_F = -Math.PI / 2;
const Y_PAN = 0.64;

const radial = (p: Vec3): number => Math.hypot(p[0], p[2]);
const inward = (t: Texel): number => -(t.n[0] * t.p[0] + t.n[2] * t.p[2]) / Math.max(1e-3, radial(t.p));

/** rib profile (r, y) from the collar up to the outward scroll at the top */
const RIB: [number, number][] = [[0.1, 0.56], [0.25, 0.62], [0.38, 0.72], [0.43, 0.86], [0.4, 0.99], [0.37, 1.06], [0.4, 1.12], [0.47, 1.12], [0.48, 1.06]];
/** leg profile (r, y) from the collar down to the curled foot */
const LEG: [number, number][] = [[0.1, 0.56], [0.18, 0.4], [0.3, 0.2], [0.42, 0.05], [0.5, 0.025], [0.55, 0.06], [0.52, 0.11]];

const pt = (a: number, r: number, y: number): Vec3 => [Math.cos(a) * r, y, -Math.sin(a) * r];

const iron = ironMat('iron', {
  pal: FIRE,
  k: 2.4,
  corrode: 0.6,
  polish: 0.5,
  soot: (t) => clamp01(smoothstep(0.75, 1.1, t.p[1]) * 0.55 + smoothstep(0.2, 0.6, inward(t)) * smoothstep(0.6, 0.8, t.p[1]) * 0.6),
  heat: (t) => {
    // the inner faces of ribs and hoops next to the coals glow a dull red, plus the pan rim
    const near = smoothstep(0.2, 0.06, Math.abs(t.p[1] - 0.74)) * smoothstep(0.2, 0.7, inward(t));
    const pan = (1 - smoothstep(0.0, 0.04, Math.abs(t.p[1] - (Y_PAN + 0.06)))) * smoothstep(0.33, 0.36, radial(t.p)) * smoothstep(-0.2, 0.4, inward(t)) * 0.35;
    return clamp01((near * 0.3 + pan) * (0.5 + 0.7 * fbm01(t, 10, 2, 5.5)));
  },
});

export const prop: PropDef = {
  id: 'prop_fire_brazier',
  size: 1024,
  crease: 34,
  aoShort: 0.2,
  aoLong: 0.9,
  aoGain: 1.25,
  shadowTint: [0.42, 0.4, 0.42],
  emissiveFactor: [1, 1, 1],
  material: { roughness: 0.7, metallic: 0.35 },
  mats: [iron, coalMat('coals', FIRE, { scale: 15, base: 0.32, y0: Y_PAN + 0.04, y1: Y_PAN + 0.2 }), flameMat('flame', FIRE)],
  build(m) {
    const rng = new Rng('fire_brazier');
    // ---- three legs that run on up as basket ribs, three ribs between them
    for (let k = 0; k < 6; k++) {
      const a = TH_F + Math.PI / 6 + (k * TAU) / 6;
      const sway = (rng.next() - 0.5) * 0.04;
      const rib = RIB.map(([r, y], i) => pt(a + sway * (i / RIB.length), r, y));
      const path = k % 2 === 0 ? [...LEG.slice(1).reverse().map(([r, y]) => pt(a, r, y)), ...rib] : rib;
      const radii = path.map((_, i) => (i === path.length - 1 ? 0.012 : 0.022 - (k % 2 === 0 ? 0 : 0.003)));
      tube(m, { path, radii, sides: 4, mat: IRON, s: 0.25, caps: 'both', seed: `rib${k}`, phase: Math.PI / 4, uOff: k * 1.7 });
    }
    // ---- forged collar binding the legs
    lathe2(m, IRON, [[0.07, 0.48], [0.115, 0.5], [0.13, 0.56], [0.115, 0.62], [0.07, 0.64]], 8, { phase: TH_F });
    // ---- banding hoops (square bar)
    for (const [y, r] of [[0.79, 0.425], [1.0, 0.413]] as const) {
      const n = 12;
      const ring: Vec3[] = Array.from({ length: n + 1 }, (_, i) => pt((i / n) * TAU, r, y));
      tube(m, { path: ring, radii: ring.map(() => 0.018), sides: 4, mat: IRON, s: 0.25, caps: 'none', seed: `hoop${y}`, phase: Math.PI / 4, squash: 1.4 });
    }
    // ---- grate pan the coals sit in
    lathe2(m, IRON, [[0.0, Y_PAN - 0.02], [0.24, Y_PAN - 0.02], [0.34, Y_PAN + 0.04], [0.36, Y_PAN + 0.08], [0.32, Y_PAN + 0.07], [0.24, Y_PAN + 0.03]], 10, { phase: TH_F });

    // ---- coals + flames
    coalHeap(m, COALS, { cx: 0, cz: 0, y0: Y_PAN + 0.03, h: 0.17, r: 0.31, segs: 12, lumps: 4, lumpR: 0.07, seed: 'cage-coals' });
    flameTongue(m, FLAME, { base: [0, Y_PAN + 0.1, 0], h: 0.46, r: 0.2, lobes: 3, twist: 2.4, sway: 0.4, phase: 0.2, rings: 7 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.3 + (rng.next() - 0.5) * 0.5;
      const rr = 0.16 + rng.next() * 0.05;
      flameTongue(m, FLAME, {
        base: [Math.cos(a) * rr, Y_PAN + 0.1, -Math.sin(a) * rr],
        h: 0.24 + rng.next() * 0.1,
        r: 0.1 + rng.next() * 0.03,
        lean: [Math.cos(a) * 0.06, -Math.sin(a) * 0.06],
        lobes: 3,
        twist: 1.6 + rng.next(),
        phase: rng.next() * 6,
        rings: 6,
      });
    }
  },
};
