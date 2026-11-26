// prop_crate — rope-bound cargo crate (0.9 m): proud corner posts, three hewn planks per face with gaps and nail heads, diagonal braces
// on two faces, lid boards, two hemp rope loops knotted at the front with trailing ends, a red-ochre trade mark. Front = +Z.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import { extrude } from '../../core/hard/hardmesh.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapAuto, mapPlanar } from '../../archetypes/prop/mesh.ts';
import { mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import { board, boardOutline, lash, mapGrainY, moveXf, mul, rotY, rotZ, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { rope, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { MOTIFS, cov } from '../../archetypes/prop/ext/PropsOrc/paint.ts';

const WOOD = 0, ROPE = 1;

const HALF = 0.4; // outer half width of the posts
const POST_W = 0.08;
const H = 0.9;

/** cargo planks: hewn tile timber, painted nail heads and a stencilled ochre mark on the front */
function crateWood(): Mat {
  const base = timber('crate-base', { dark: '#392b1e', mid: '#76593a', light: '#ad8c63', grey: '#9a937f', bark: 0, facets: 0.6, dirt: 0.5, tileM: 0.7 });
  const nail = rgb('#16141a'), shine = rgb('#8d8a86'), ochre = rgb('#a5321c');
  return {
    name: 'crate',
    shade(t) {
      let c = base.shade(t);
      const aa = Math.max(0.0015, t.mpt * 1.2);
      // nail heads near the plank ends of every face (position based: nails sit 0.05 m inside the posts)
      const ax = Math.abs(t.p[0]), az = Math.abs(t.p[2]);
      if (Math.abs(t.n[1]) < 0.6) {
        const along = Math.abs(t.n[2]) > Math.abs(t.n[0]) ? ax : az;
        const nearEnd = Math.abs(along - 0.3);
        for (const y of [0.17, 0.45, 0.73]) {
          const d = Math.hypot(nearEnd, t.p[1] - y);
          c = mixc(c, nail, cov(d - 0.014, aa));
          c = mixc(c, shine, cov(Math.hypot(nearEnd + 0.004, t.p[1] - y - 0.004) - 0.004, aa) * 0.7);
        }
        // stencilled trade mark on the +z face
        if (t.n[2] > 0.6) {
          const m = MOTIFS.chevron((t.p[0] + 0.05) / 0.17, (t.p[1] - 0.45) / 0.17) * 0.17;
          c = mixc(c, mulc(ochre, 0.9 + 0.3 * t.noise.noise(t.p[0] * 40, t.p[1] * 40, 3.1)), cov(m, aa) * 0.9);
        }
      }
      return c;
    },
  };
}

export const prop: PropDef = {
  id: 'prop_crate',
  size: 1024,
  aoLong: 1.2,
  crease: 46,
  mats: [crateWood(), rope('hemp', { across: 'v', color: '#8e7448', dark: '#44351b' })],
  build(m: PropMesh) {
    const rng = new Rng('crate');
    const mapPlank = mapAuto(0.7);
    const mapPost = mapGrainY(0.7);
    // ---- corner posts, proud of the planks, slightly irregular heights
    for (const [sx, sz, h] of [[-1, -1, 0.88], [1, -1, 0.9], [-1, 1, 0.9], [1, 1, 0.87]] as [number, number, number][]) {
      const w = POST_W + rng.next() * 0.008;
      const post = extrude([[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]], h, { axis: 'y', bevel: { size: 0.008, segments: 1 } });
      m.add(post, WOOD, mapPost, moveXf(sx * (HALF - POST_W / 2), 0, sz * (HALF - POST_W / 2)));
    }
    // ---- planks: three per face, hewn boards laid between the posts
    const ys = [0.045, 0.325, 0.605];
    const ph = 0.255;
    for (let face = 0; face < 4; face++) {
      const rot = rotY((face * Math.PI) / 2);
      for (let k = 0; k < 3; k++) {
        const len = 2 * (HALF - POST_W) - 0.006 - rng.next() * 0.012;
        const outline = boardOutline(len, ph - rng.next() * 0.02, 'flat', rng);
        const xf = mul(rot, moveXf(0, ys[k]! + rng.next() * 0.01, HALF - 0.052), rotZ((rng.next() - 0.5) * 0.012));
        m.add(board(outline, 0.04, 0.007), WOOD, mapPlank, xf);
      }
    }
    // ---- lid: three boards, the middle one a little raised and shifted
    for (let k = 0; k < 3; k++) {
      const w = 0.27;
      const len = 2 * HALF - 0.01 - rng.next() * 0.02;
      const lid = extrude([[-len / 2, -w / 2], [len / 2, -w / 2], [len / 2, w / 2], [-len / 2, w / 2]], 0.035, { axis: 'y', bevel: { size: 0.007, segments: 1 } });
      m.add(lid, WOOD, mapAuto(0.7), mul(moveXf((rng.next() - 0.5) * 0.02, 0.853 + (k === 1 ? 0.012 : 0), (k - 1) * (w + 0.012)), rotY((rng.next() - 0.5) * 0.03)));
    }
    // ---- diagonal braces on the front and the left face
    for (const [yaw, sgn] of [[0, 1], [Math.PI / 2, -1]] as [number, number][]) {
      const ang = Math.atan2(0.62, 0.62) * sgn;
      const len = 0.92;
      const o: Vec3 = [0, 0.45, 0];
      const brace = extrude([[-0.04, -len / 2], [0.04, -len / 2], [0.04, len / 2], [-0.04, len / 2]], 0.022, { axis: 'z', z0: -0.011 });
      m.add(brace, WOOD, mapPlanar(o, [0, 1, 0], [1, 0, 0], 0.7), mul(rotY(yaw), moveXf(0, 0.45, HALF - 0.026), rotZ(ang)));
    }
    // ---- rope loops (two turns) round the crate, knotted at the front, with trailing ends
    const R = HALF + 0.022;
    const loop = (y: number, seed: string): void => {
      const c = 0.13; // rounded corners
      const pts: Vec3[] = [];
      const add = (x: number, z: number): void => void pts.push([x, y + (rng.next() - 0.5) * 0.01, z]);
      add(-0.1, R);
      add(R - c, R); add(R, R - c);
      add(R, -R + c); add(R - c, -R);
      add(-R + c, -R); add(-R, -R + c);
      add(-R, R - c); add(-R + c, R);
      add(0.1, R);
      tube(m, { path: pts, radii: pts.map(() => 0.016), sides: 4, mat: ROPE, s: 0.3, caps: 'none', seed });
    };
    loop(0.3, 'loop1');
    loop(0.62, 'loop2');
    // knot and trailing ends at the front
    lash(m, ROPE, [0, 0.3, R], [1, 0, 0], 0.03, 0.09, { sides: 5, bulge: 0.02, seed: 'knot1' });
    lash(m, ROPE, [0, 0.62, R], [1, 0, 0], 0.03, 0.09, { sides: 5, bulge: 0.02, seed: 'knot2' });
    tube(m, { path: [[0.02, 0.3, R + 0.02], [0.06, 0.2, R + 0.05], [0.04, 0.12, R + 0.04]], radii: [0.014, 0.013, 0.01], sides: 4, mat: ROPE, s: 0.3, caps: 'end', seed: 'tail1' });
    tube(m, { path: [[-0.02, 0.62, R + 0.02], [-0.07, 0.53, R + 0.05], [-0.05, 0.46, R + 0.03]], radii: [0.014, 0.013, 0.01], sides: 4, mat: ROPE, s: 0.3, caps: 'end', seed: 'tail2' });
  },
};
