// prop_haystack — conical haystack (2 m): a lumpy, slumped cone with one overhanging course lip, a straw crown, a rope band that follows
// the lumps, ~70 hanging straw blades breaking the silhouette, and a pitchfork stuck in the side. Front = +Z.
import { Rng } from '../../core/rng.ts';
import type { Vec3 } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type PropMesh, mapCylY } from '../../archetypes/prop/mesh.ts';
import { revolve } from '../../archetypes/prop/kit.ts';
import { log, polar, spike } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, endGrain, rope, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { straw } from '../../archetypes/prop/ext/PropsOrc/mats2.ts';

const STRAW = 0, ROPE = 1, WOOD = 2, IRON = 3, END = 4;

/** [radius, height]: broad shoulder, one overhanging course lip, then a straight cone to the crown */
const PROFILE: [number, number][] = [[1.25, 0.0], [1.31, 0.2], [1.22, 0.62], [1.29, 0.64], [1.2, 0.74], [1.0, 1.15], [0.84, 1.45], [0.5, 1.78], [0.22, 1.93], [0.1, 1.98], [0.0, 2.0]];
const slump = (theta: number): number => 1 + 0.045 * Math.sin(2 * theta + 0.6) + 0.025 * Math.sin(5 * theta + 1.3) + 0.02 * Math.cos(3 * theta);
const radiusAt = (y: number): number => {
  for (let i = 0; i + 1 < PROFILE.length; i++) {
    const [r0, y0] = PROFILE[i]!, [r1, y1] = PROFILE[i + 1]!;
    if (y >= y0 && y <= y1 && y1 > y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0.3;
};
const TILES = Math.max(1, Math.round((Math.PI * 2 * 1.25) / 1.4));

export const prop: PropDef = {
  id: 'prop_haystack',
  size: 1024,
  aoLong: 2.4,
  crease: 46,
  mats: [
    straw('hay', { courses: 1.1, dirt: 0.5 }),
    rope('hay-rope', { across: 'u', color: '#8c7048', dark: '#46341d' }),
    timber('fork-ash', { dark: '#3a2c1d', mid: '#7a5f3e', light: '#b09366', grey: '#a09a86', dirt: 0.2 }),
    blackIron('fork-iron', { rust: 0.5, tone: '#44474f' }),
    endGrain('fork-end'),
  ],
  build(m: PropMesh) {
    const rng = new Rng('haystack');
    // ---- the stack: one lathe with a lumpy slump
    m.add(revolve(PROFILE, 16, (theta) => slump(theta)), STRAW, mapCylY(0, 0, 1.25, 1.4));
    // ---- rope band that follows the lumps
    {
      const y = 0.95, r = radiusAt(y) + 0.012;
      m.add(revolve([[r - 0.03, y - 0.05], [r + 0.03, y - 0.03], [r + 0.045, y], [r + 0.03, y + 0.03], [r - 0.03, y + 0.05]], 12, (theta) => slump(theta)), ROPE, mapCylY(0, 0, r, 0.4));
    }
    // ---- hanging straw blades: single outward-facing triangles along the lip and scattered over the cone
    const blade = (a: number, y: number, w: number, len: number, flare: number): void => {
      const r = radiusAt(y) * slump(a) * 0.985;
      const da = w / r;
      const at = (ang: number, yy: number, rr: number): Vec3 => polar(rr, ang, yy);
      const L = at(a - da / 2, y, r), R = at(a + da / 2, y, r);
      const T = at(a, Math.max(0.02, y - len), radiusAt(Math.max(0, y - len)) * slump(a) + flare);
      const u0 = (a / (Math.PI * 2)) * TILES;
      m.tri(L, T, R, [u0 - 0.03, -y / 1.4], [u0, -(y - len) / 1.4], [u0 + 0.03, -y / 1.4], STRAW);
    };
    for (let k = 0; k < 26; k++) blade((k / 26) * Math.PI * 2 + (rng.next() - 0.5) * 0.12, 0.64, 0.12 + rng.next() * 0.08, 0.28 + rng.next() * 0.2, 0.1);
    for (let k = 0; k < 44; k++) {
      const y = 0.25 + rng.next() * 1.45;
      blade(rng.next() * Math.PI * 2, y, 0.1 + rng.next() * 0.08, 0.22 + rng.next() * 0.2, 0.07);
    }
    // ---- pitchfork stuck into the front-right of the stack
    const dir = polar(1, 0.75);
    const head: Vec3 = [dir[0] * 1.14, 0.95, dir[2] * 1.14];
    const grip: Vec3 = [dir[0] * 1.45, 1.75, dir[2] * 1.45];
    log(m, WOOD, head, grip, 0.026, 0.021, { sides: 5, segs: 2, capMat: END, seed: 'fork', jitter: 0.04, caps: 'end', bow: [0, 0.015, 0] });
    const side: Vec3 = [-dir[2], 0, dir[0]];
    const d3 = [grip[0] - head[0], grip[1] - head[1], grip[2] - head[2]];
    const dl = Math.hypot(d3[0]!, d3[1]!, d3[2]!);
    const dn: Vec3 = [d3[0]! / dl, d3[1]! / dl, d3[2]! / dl];
    for (const s of [-1, 0, 1]) {
      const b: Vec3 = [head[0] - dn[0] * 0.02 + side[0] * s * 0.07, head[1] - dn[1] * 0.02, head[2] - dn[2] * 0.02 + side[2] * s * 0.07];
      spike(m, IRON, b, [-dn[0], -dn[1], -dn[2]], 0.32, 0.014, { sides: 3 });
    }
    log(m, IRON, [head[0] + side[0] * 0.08, head[1], head[2] + side[2] * 0.08], [head[0] - side[0] * 0.08, head[1], head[2] - side[2] * 0.08], 0.012, 0.012, { sides: 4, segs: 1, seed: 'forkbar', caps: 'both' });
  },
};
