// prop_lava_rock — 1.5 m black volcanic rock whose crust has cracked into plates over molten rock: a lopsided basalt mass split by
// Voronoi bisector planes into hand-chiselled crust plates with real gaps; the gap walls and the shrunken core seen at the bottom of
// every slot are molten (emissive), and each crust edge that borders a gap is scorched and glows. Two small cooled chunks beside it.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import { m4mul, m4translation } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { TAG_GAP, TAG_GROUND, addFaces, cells, groundPlane, hull, rockPlanes, rotX, rotYm, rotZ, xfPlanes, type Plane } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { crustMat, moltenMat, skinSeeds } from '../../archetypes/prop/ext/PropsElem/lava.ts';

const CRUST = 0, MOLTEN = 1;

export const prop: PropDef = {
  id: 'prop_lava_rock',
  size: 1024,
  crease: 22,
  aoShort: 0.3,
  aoLong: 1.4,
  emissiveFactor: [1.7, 1.7, 1.7],
  material: { roughness: 0.9, metallic: 0 },
  mats: [crustMat(), moltenMat()],
  build(m) {
    const rng = new Rng('lava_rock');
    // body: tall lopsided mass, base sunk below the ground line
    const half: Vec3 = [0.72, 1.45, 0.66];
    const local = rockPlanes(rng.fork('body'), { r: half, n: 22, jitter: 0.28, cut: [0.8, 1], chips: 5, chipDepth: [0.08, 0.22], skew: [0.14, 0.12, -0.1] });
    const xf = m4mul(m4translation([0, -0.2, 0]), m4mul(rotYm(0.5), m4mul(rotX(-0.04), rotZ(0.06))));
    const outer: Plane[] = [...xfPlanes(local, xf), groundPlane(0)];
    const parts = cells({ outer, seeds: skinSeeds(outer, rng, 12), gap: 0.06, R: 10 });
    // molten core: the body shrunk inward, visible at the bottom of the gaps
    const core = hull(outer.map((p) => (p.tag === TAG_GROUND ? p : { ...p, d: p.d - 0.16 })), 10);
    let top = 0;
    for (const f of core) for (const p of f.poly) top = Math.max(top, p[1]);
    for (const cell of parts) for (const f of cell) for (const p of f.poly) top = Math.max(top, p[1]);
    const s = 1.5 / top;
    const sc = (p: Vec3): Vec3 => [p[0] * s, p[1] * s, p[2] * s];
    addFaces(m, core, { mat: MOLTEN, skip: [TAG_GROUND], xf: sc });
    parts.forEach((cell, i) => addFaces(m, cell, { mat: (f) => (f.tag === TAG_GAP ? MOLTEN : CRUST), skip: [TAG_GROUND], xf: sc, rough: { edge: 0.1, centre: 0.07, minEdge: 0.22, seed: 30 + i } }));

    // two small cooled chunks
    const chunks: { at: Vec3; r: Vec3; yaw: number }[] = [
      { at: [0.85, 0, 0.45], r: [0.26, 0.22, 0.24], yaw: 0.8 },
      { at: [-0.7, 0, -0.6], r: [0.2, 0.17, 0.2], yaw: 2.1 },
    ];
    chunks.forEach((c, i) => {
      const lp = rockPlanes(new Rng(`lava_rock:c${i}`), { r: c.r, n: 9, jitter: 0.4, cut: [0.74, 1], chips: 1 });
      const cx = m4mul(m4translation([c.at[0], c.r[1] * 0.2, c.at[2]]), rotYm(c.yaw));
      addFaces(m, hull([...xfPlanes(lp, cx), groundPlane(0)], 6), { mat: CRUST, skip: [TAG_GROUND], rough: { edge: 0.1, centre: 0.07, seed: 50 + i } });
    });
  },
};
