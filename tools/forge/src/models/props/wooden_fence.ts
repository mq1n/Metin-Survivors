// prop_wooden_fence — rough 2 m fence section (1.4 m posts at x = +-1 so neighbouring sections share their posts): two lashed rails,
// seven hewn pickets of uneven height (pointed, jagged, one snapped, one leaning), painted nail heads with rust streaks, a rag on a post,
// footing stones. Front = +Z.
import { Rng } from '../../core/rng.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapAuto, mapBox } from '../../archetypes/prop/mesh.ts';
import { mixc, mulc, rgb, stone } from '../../archetypes/prop/mats.ts';
import { board, boardOutline, lash, log, moveXf, mul, rotX, rotY, rotZ, sheet, stoneChunk } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { cloth, endGrain, rope, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { cov } from '../../archetypes/prop/ext/PropsOrc/paint.ts';

const POST = 0, END = 1, ROPE = 2, PICKET = 3, STONE = 4, RAG = 5;

const RAIL_Y = [0.42, 0.98];
const PICKETS: { x: number; h: number; w: number; top: 'point' | 'jag' | 'slant' | 'broken' | 'flat'; lean: number }[] = [
  { x: -0.8, h: 1.2, w: 0.19, top: 'point', lean: 0.02 },
  { x: -0.53, h: 1.3, w: 0.2, top: 'jag', lean: -0.015 },
  { x: -0.27, h: 1.12, w: 0.17, top: 'point', lean: 0.035 },
  { x: 0.0, h: 1.26, w: 0.21, top: 'slant', lean: 0 },
  { x: 0.27, h: 0.8, w: 0.19, top: 'broken', lean: -0.02 },
  { x: 0.54, h: 1.22, w: 0.18, top: 'point', lean: 0.12 },
  { x: 0.8, h: 1.16, w: 0.2, top: 'jag', lean: -0.03 },
];

/** hewn picket planks (grain runs down uv v) with hand-painted nail heads and rust streaks at the rail crossings */
function picketMat(): Mat {
  const base = timber('picket-base', { dark: '#34281d', mid: '#6c563b', light: '#a48862', grey: '#948d7a', bark: 0.1, facets: 0.7, dirt: 0.55, grain: 'v', tileM: 0.8 });
  const nail = rgb('#17151a'), shine = rgb('#8d8a86'), rust = rgb('#5a2c14');
  return {
    name: 'picket',
    shade(t) {
      let c = base.shade(t);
      if (t.n[2] > 0.5) {
        const aa = Math.max(0.0015, t.mpt * 1.2);
        for (const p of PICKETS) {
          if (Math.abs(t.p[0] - p.x) > 0.12) continue;
          for (const y of RAIL_Y) {
            const dx = t.p[0] - p.x, dy = t.p[1] - y;
            const d = Math.hypot(dx, dy);
            // rust streak running down from the nail
            const streak = cov(Math.abs(dx) - 0.009, aa) * (dy < 0 && dy > -0.16 ? 1 - Math.min(1, -dy / 0.16) : 0);
            c = mixc(c, mulc(rust, 0.8), 0.55 * streak);
            c = mixc(c, nail, cov(d - 0.016, aa));
            c = mixc(c, shine, cov(Math.hypot(dx + 0.005, dy - 0.005) - 0.005, aa) * 0.8);
          }
        }
      }
      return c;
    },
  };
}

export const prop: PropDef = {
  id: 'prop_wooden_fence',
  size: 1024,
  aoLong: 1.5,
  crease: 46,
  mats: [
    timber('fence-post', { dark: '#2f241a', mid: '#5f4a33', light: '#947755', grey: '#8e8775', bark: 0.3, facets: 0.9, dirt: 0.55, tileM: 0.8 }),
    endGrain('end-grain'),
    rope('rope', { across: 'u', color: '#8c7048', dark: '#46341d' }),
    picketMat(),
    stone('footing', { tex: ['tex_rock_mossy'], k: 1.8, dark: '#34312e', light: '#a39b8a', moss: 0.2, dirt: 0.55, wear: 0.6 }),
    cloth('rag', { color: '#8e2218', dark: '#4a1510', soot: 0.5 }),
  ],
  build(m: PropMesh) {
    const rng = new Rng('wooden_fence');
    // ---- end posts (shared with neighbouring sections), flat-cut at 1.4 m with a hacked diagonal
    for (const sx of [-1, 1]) {
      log(m, POST, [sx, 0, 0], [sx + sx * 0.012, 1.4, 0.004], 0.092, 0.074, { sides: 6, segs: 2, chamfer1: 0.028, capMat: END, seed: `post${sx}`, jitter: 0.07, bow: [0.012 * sx, 0, 0.015], caps: 'end' });
      for (const y of RAIL_Y) lash(m, ROPE, [sx, y + 0.01, 0.004], [0, 1, 0], 0.088, 0.1, { sides: 5, bulge: 0.02, seed: `l${sx}${y}` });
      m.add(stoneChunk(rng, 0.3 + rng.next() * 0.1, 0.12 + rng.next() * 0.08, 0.26, 5, 0.7), STONE, mapBox(0.8), mul(moveXf(sx * 0.98 + sx * 0.04, 0, 0.08), rotY(rng.next() * 6)));
    }
    // ---- rails
    for (let k = 0; k < 2; k++) {
      log(m, POST, [-1.0, RAIL_Y[k]!, 0.0], [1.0, RAIL_Y[k]! + (k === 0 ? 0.015 : -0.01), 0.0], 0.04, 0.038, { sides: 5, segs: 1, chamfer0: 0.0, chamfer1: 0.0, capMat: END, seed: `rail${k}`, jitter: 0.07, bow: [0, k === 0 ? -0.012 : 0.01, 0.01], caps: 'none' });
    }
    // ---- pickets nailed to the front of the rails
    const mapB = mapAuto(1);
    for (let i = 0; i < PICKETS.length; i++) {
      const p = PICKETS[i]!;
      const outline = boardOutline(p.w, p.h, p.top, rng, p.top === 'point' ? 0.16 : 0.1);
      const xf = mul(moveXf(p.x, 0, 0.075 + (i === 5 ? 0.03 : 0)), rotZ(p.lean), i === 5 ? rotX(-0.1) : rotX(0));
      m.add(board(outline, 0.045, 0.012), PICKET, mapB, xf);
    }
    // ---- a rag knotted on the right post
    sheet(m, {
      nu: 1, nv: 3, thick: 0.008, mat: RAG, outward: [0, 0, 1],
      at: (u, v) => [0.96 + (u - 0.5) * 0.08 * (1 - 0.5 * v) + 0.03 * v, 1.28 - 0.3 * v, 0.1 + 0.05 * v * Math.sin(v * 3 + 1)],
      uv: (u, v) => [u * 0.08, v * 0.3],
    });
  },
};
