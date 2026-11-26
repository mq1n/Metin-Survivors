// prop_obsidian_spire — 4 m cluster of volcanic-glass spires growing out of a cracked, glowing crust mound. Six irregular prismatic
// crystals (4-6 sided, elongated into blades, narrowing to chisel / pyramid points) lean outward from the tall centre blade; the tall
// ones are broken and re-grown with a dog-leg ledge. Every facet is painted as a different mirror slice (cold sky above, lava bounce at
// the foot) with razor-bright rims. Foot: black basalt plates split by glowing slots over molten rock.
import { Rng } from '../../core/rng.ts';
import type { Mat4, Vec3 } from '../../core/math.ts';
import { clamp01, m4mul, m4translation, smoothstep } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { fbm01 } from '../../archetypes/prop/mats.ts';
import { TAG_GAP, TAG_GROUND, addFaces, cells, crystalPlanes, groundPlane, hull, rockPlanes, rotX, rotYm, rotZ, xfPlanes, type Face, type Plane } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { crustMat, moltenMat, skinSeeds } from '../../archetypes/prop/ext/PropsElem/lava.ts';
import { obsidianPaint } from '../../archetypes/prop/ext/PropsElem/mats.ts';
import { glowMat, veins } from '../../archetypes/prop/ext/PropsElem/paint.ts';

const GLASS = 0, CRUST = 1, MOLTEN = 2;
const HEIGHT = 4;

interface Shard {
  /** root position on the ground */
  at: Vec3;
  h: number;
  r: number;
  /** lean away from the centre (rad) */
  lean: number;
  sides: number;
  tip: number;
  aspect: number;
  narrow: number;
  tipLen: number;
  /** break: fraction of the height where the upper part is tilted (rx, rz in rad) and shifted sideways (m) */
  kink?: { t: number; rx: number; rz: number; shift: [number, number] };
}

const SHARDS: Shard[] = [
  { at: [0.02, 0, -0.02], h: 4.0, r: 0.46, lean: 0.05, sides: 6, tip: 3, aspect: 0.32, narrow: 0.2, tipLen: 0.75, kink: { t: 0.5, rx: 0.1, rz: -0.14, shift: [0.07, -0.05] } },
  { at: [0.6, 0, 0.12], h: 3.1, r: 0.36, lean: 0.16, sides: 5, tip: 2, aspect: 0.3, narrow: 0.22, tipLen: 0.65, kink: { t: 0.46, rx: -0.12, rz: 0.12, shift: [-0.05, 0.06] } },
  { at: [-0.5, 0, 0.3], h: 2.6, r: 0.34, lean: 0.18, sides: 6, tip: 3, aspect: 0.25, narrow: 0.22, tipLen: 0.6, kink: { t: 0.55, rx: 0.14, rz: 0.1, shift: [0.04, 0.06] } },
  { at: [-0.12, 0, -0.58], h: 2.2, r: 0.3, lean: 0.2, sides: 5, tip: 2, aspect: 0.3, narrow: 0.3, tipLen: 0.6 },
  { at: [0.85, 0, -0.35], h: 1.55, r: 0.24, lean: 0.3, sides: 5, tip: 3, aspect: 0.2, narrow: 0.3, tipLen: 0.45 },
  { at: [-0.88, 0, -0.1], h: 1.25, r: 0.22, lean: 0.34, sides: 5, tip: 2, aspect: 0.25, narrow: 0.32, tipLen: 0.4 },
];

/** root placement: spin about the shard axis, tilt by `lean` away from the centre, move to `at` */
const shardXf = (s: Shard, spin: number): Mat4 => {
  const away = Math.atan2(s.at[2], s.at[0]);
  return m4mul(m4translation(s.at), m4mul(rotYm(-away), m4mul(rotZ(-s.lean), rotYm(spin))));
};

/** rigid tilt of everything above height y0 about the shaft axis, then a sideways shift */
const kinkXf = (y0: number, k: NonNullable<Shard['kink']>): Mat4 => m4mul(m4translation([k.shift[0], y0, k.shift[1]]), m4mul(m4mul(rotX(k.rx), rotZ(k.rz)), m4translation([0, -y0, 0])));

const glass = glowMat(
  'obsidian',
  obsidianPaint(),
  (t) => {
    // heat creeps up from the molten root: a deep red glow in the foot of the glass, plus hairline fissures that die out by 0.6 m
    const low = 1 - smoothstep(0.03, 0.4, t.hy);
    const v = veins(t, 3.4, 0.0045, 11, 0.45);
    return { heat: clamp01(low * (0.12 + 0.45 * fbm01(t, 6, 2, 2.1)) * 0.55 + v * low * 0.8), char: 0 };
  },
  { spill: 0 },
);

interface Part {
  faces: Face[];
  mat: number | ((f: Face) => number);
  rough?: { edge?: number; centre?: number; minEdge?: number; seed?: number };
}

export const prop: PropDef = {
  id: 'prop_obsidian_spire',
  size: 1024,
  crease: 20,
  aoShort: 0.4,
  aoLong: 2.0,
  emissiveFactor: [1.5, 1.5, 1.5],
  material: { roughness: 0.3, metallic: 0.1 },
  mats: [glass, crustMat(), moltenMat()],
  build(m) {
    const parts: Part[] = [];

    // crust mound the glass grows out of
    const rng = new Rng('obsidian:mound');
    const local = rockPlanes(rng.fork('body'), { r: [1.2, 0.56, 1.02], n: 20, jitter: 0.34, cut: [0.8, 1], chips: 6, chipDepth: [0.08, 0.24], skew: [0.1, 0.1, -0.08] });
    const outer: Plane[] = [...xfPlanes(local, m4mul(m4translation([0, -0.06, 0]), rotYm(0.4))), groundPlane(0)];
    parts.push({ faces: hull(outer.map((p) => (p.tag === TAG_GROUND ? p : { ...p, d: p.d - 0.12 })), 10), mat: MOLTEN });
    cells({ outer, seeds: skinSeeds(outer, rng, 6, { depth: 0.2, minY: 0.1, spacing: 0.55 }), gap: 0.05, R: 10 }).forEach((cell, i) =>
      parts.push({ faces: cell, mat: (f) => (f.tag === TAG_GAP ? MOLTEN : CRUST), rough: { centre: 0.1, seed: 70 + i } }),
    );
    // loose cooled lumps around the foot
    const lumps: { at: Vec3; r: Vec3; yaw: number }[] = [
      { at: [1.05, 0, 0.42], r: [0.24, 0.17, 0.21], yaw: 0.5 },
      { at: [-1.0, 0, -0.5], r: [0.22, 0.15, 0.25], yaw: 2.2 },
      { at: [0.3, 0, -1.0], r: [0.24, 0.15, 0.19], yaw: 1.3 },
    ];
    lumps.forEach((c, i) => {
      const lp = rockPlanes(new Rng(`obsidian:lump${i}`), { r: c.r, n: 9, jitter: 0.4, cut: [0.76, 1], chips: 1 });
      parts.push({ faces: hull([...xfPlanes(lp, m4mul(m4translation([c.at[0], c.r[1] * 0.25, c.at[2]]), rotYm(c.yaw))), groundPlane(0)], 6), mat: CRUST, rough: { centre: 0.1, seed: 90 + i } });
    });

    SHARDS.forEach((s, i) => {
      const r = new Rng(`obsidian:${i}`);
      const lp = crystalPlanes(r, { h: s.h, r: s.r, sides: s.sides, narrow: s.narrow, tipLen: s.tipLen, tip: s.tip, irregular: 0.28, aspect: s.aspect, offset: 0.4, bottom: -0.4 });
      const place = shardXf(s, r.next() * 6.28);
      if (!s.kink) {
        parts.push({ faces: hull([...xfPlanes(lp, place), groundPlane(0)], 12), mat: GLASS });
        return;
      }
      const y0 = s.kink.t * s.h;
      const lower: Plane[] = [...lp, { n: [0, 1, 0], d: y0 }];
      const upper: Plane[] = xfPlanes([...lp, { n: [0, -1, 0], d: -y0 }], kinkXf(y0, s.kink));
      parts.push({ faces: hull([...xfPlanes(lower, place), groundPlane(0)], 12), mat: GLASS });
      parts.push({ faces: hull([...xfPlanes(upper, place), groundPlane(0)], 12), mat: GLASS });
    });

    // normalise to the nominal height
    let top = 0;
    for (const p of parts) for (const f of p.faces) for (const v of f.poly) top = Math.max(top, v[1]);
    const k = HEIGHT / top;
    const sc = (v: Vec3): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
    for (const p of parts) addFaces(m, p.faces, { mat: p.mat, skip: [TAG_GROUND], xf: sc, ...(p.rough ? { rough: p.rough } : {}) });
  },
};
