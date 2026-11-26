// prop_boulder — 1.2 m rough faceted boulder (one model, recoloured per biome by the terrain recipes, so the stone is a neutral
// grey-brown): a lopsided main mass, a taller wedge leaning against it, a low flat stone and scattered chips. Crevices between the
// masses collect moss (painted from the baked occlusion); every facet carries its own painted value / tint, hairline veins, strata,
// micro relief and chipped edges; edges and faces are slightly chiselled so nothing reads as a CAD polyhedron.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import { m4mul, m4translation } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { TAG_GROUND, addFaces, groundPlane, hull, rockPlanes, rotX, rotYm, rotZ, xfPlanes } from '../../archetypes/prop/ext/PropsElem/hull.ts';
import { rockMat } from '../../archetypes/prop/ext/PropsElem/mats.ts';

const ROCK = 0;

interface Chunk {
  r: Vec3;
  at: Vec3;
  yaw: number;
  tiltX?: number;
  tiltZ?: number;
  n: number;
  chips: number;
  skew?: Vec3;
  seed: string;
}

/** footprint squash so the group fits the nominal 1.2 m half extent while keeping the 1.2 m height */
const SQUASH = 0.78;

export const prop: PropDef = {
  id: 'prop_boulder',
  size: 1024,
  crease: 24,
  aoShort: 0.35,
  aoLong: 1.4,
  mats: [
    rockMat('granite', {
      dark: '#4d4a44',
      light: '#bab3a6',
      warm: '#948371',
      cool: '#767b82',
      facet: 0.75,
      strata: 0.8,
      grain: 0.9,
      cracks: 0.8,
      bump: 0.55,
      moss: 0.4,
      lichen: 0.45,
      dirt: 0.4,
      stain: 0.8,
      edge: '#e0dccf',
      edgeAmt: 0.4,
    }),
  ],
  build(m) {
    // centres sit at / below the ground line so each stone is a dome sunk into the soil (no undercut); the group is scaled to 1.2 m after
    const chunks: Chunk[] = [
      { r: [0.82, 1.4, 0.72], at: [0, -0.22, 0], yaw: 0.45, tiltZ: 0.06, tiltX: -0.04, n: 13, chips: 6, skew: [0.3, 0.14, -0.14], seed: 'A' },
      { r: [0.4, 1.0, 0.46], at: [0.8, -0.3, -0.08], yaw: -0.5, tiltZ: -0.3, tiltX: 0.1, n: 10, chips: 4, skew: [-0.1, 0.2, 0.1], seed: 'B' },
      { r: [0.58, 0.55, 0.44], at: [-0.74, -0.34, 0.62], yaw: 1.1, tiltX: 0.08, n: 9, chips: 3, seed: 'C' },
      { r: [0.22, 0.3, 0.19], at: [0.42, -0.14, 0.9], yaw: 0.4, n: 8, chips: 1, seed: 'e1' },
      { r: [0.17, 0.24, 0.15], at: [-0.46, -0.12, -0.84], yaw: 2.4, n: 8, chips: 1, seed: 'e2' },
      { r: [0.12, 0.2, 0.1], at: [1.14, -0.1, 0.46], yaw: 1.1, n: 7, chips: 0, seed: 'e3' },
    ];
    const all = chunks.map((s) => {
      const rng = new Rng(`boulder:${s.seed}`);
      const local = rockPlanes(rng, { r: s.r, n: s.n, jitter: 0.42, cut: [0.7, 1], chips: s.chips, chipDepth: [0.08, 0.3], ...(s.skew ? { skew: s.skew } : {}) });
      const xf = m4mul(m4translation(s.at), m4mul(rotYm(s.yaw), m4mul(rotX(s.tiltX ?? 0), rotZ(s.tiltZ ?? 0))));
      return hull([...xfPlanes(local, xf), groundPlane(0)], 12);
    });
    let top = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const faces of all) for (const f of faces) for (const p of f.poly) { top = Math.max(top, p[1]); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    const s = 1.2 / top;
    // footprint centred on the origin
    const cx = ((x0 + x1) / 2) * s * SQUASH, cz = ((z0 + z1) / 2) * s * SQUASH;
    all.forEach((faces, i) => addFaces(m, faces, { mat: ROCK, skip: [TAG_GROUND], xf: (p) => [p[0] * s * SQUASH - cx, p[1] * s, p[2] * s * SQUASH - cz], rough: { edge: 0.12, centre: 0.1, minEdge: 0.2, seed: 10 + i } }));
  },
};
