// prop_well — round stone village well (1.7 m, footprint r 1.25): irregular flagstone apron, a battered ring wall of coursed granite,
// a chamfered coping ring with painted joints, two lacquered posts on round stone bases carrying bracket beams and a plate beam, a small
// curved hip roof (upturned eaves, ridge and hip caps, ridge-end horns), a windlass with wound rope and crank, and a hooped wooden
// bucket hanging over the dark water. Front = +Z, the windlass runs along X.
import type { Vec3 } from '../../core/math.ts';
import { smoothstep } from '../../core/math.ts';
import { circleShape } from '../../core/hard/shape2d.ts';
import type { Vec2 as H2 } from '../../core/hard/shape2d.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapBox, mapCylY } from '../../archetypes/prop/mesh.ts';
import { cap, prism, rectCorners, revolve, roofLoft, sweepSolid } from '../../archetypes/prop/kit.ts';
import { edgeWear, fbm01, lacquer, mixc, mulc, pickTex, rgb, roofEdge, roofTile, stone } from '../../archetypes/prop/mats.ts';
import { lash, log, moveXf, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { blackIron, endGrain, rope, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { type Rgb, sampleTex } from '../../archetypes/prop/texlib.ts';
import { TAU, cov, fract, hash3 } from '../../archetypes/prop/ext/PropsVillage/sdf.ts';

const WALL = 0, COPING = 1, APRON = 2, WATER = 3, POST = 4, BEAM = 5, TILE = 6, EDGE = 7, SOFFIT = 8, ROPE = 9, BUCKET = 10, IRON = 11, END = 12, RIDGE = 13;

const RING_TOP = 0.6;
const ROLLER_Y = 0.88;
const POST_X = 0.95;
const POST_TOP = 1.05;
const ROOF_Y0 = 1.27;

/** irregular flagstones laid over the apron: voronoi cells with dark joints, per-stone tone, a little moss and soil in the joints */
function flagstones(): Mat {
  const T = pickTex('tex_stone_block_wall', 'tex_rock_mossy');
  const dark = rgb('#55524b'), light = rgb('#b9b09e'), gap = rgb('#25201a'), moss = rgb('#566f2a'), soil = rgb('#4b3a28');
  return {
    name: 'flagstones',
    shade(t) {
      const [x, y, z] = t.p;
      const top = t.n[1] > 0.6;
      const v = top ? t.noise.voronoi(x * 3.3, z * 3.3, 0.4) : t.noise.voronoi((x + z) * 3.3, y * 14, 1.1);
      const seam = 1 - smoothstep(0.025, 0.1, v.f2 - v.f1);
      let c = mixc(dark, light, 0.15 + 0.7 * ((v.id * 7.31) % 1));
      if (T) c = mixc(c, mulc(sampleTex(T, x / 1.1, z / 1.1, t.mpt / 1.1) as Rgb, 1.45), 0.45);
      c = mulc(c, 0.86 + 0.28 * fbm01(t, 3, 3, 4.4));
      c = mixc(c, mixc(gap, soil, 0.5 * fbm01(t, 12, 2, 1.1)), seam * 0.8);
      c = mixc(c, mulc(moss, 0.7 + 0.6 * fbm01(t, 16, 2, 9.1)), seam * smoothstep(0.5, 0.8, fbm01(t, 5, 3, 2.7)) * 0.5);
      // trodden pale near the ring, darker out at the rim
      c = mulc(c, 0.8 + 0.2 * smoothstep(0.85, 1.05, Math.hypot(x, z)));
      return edgeWear(c, t, mulc(light, 1.1), 0.4);
    },
  };
}

/** coping: granite with the eight stones' joints painted and every stone toned on its own */
function copingMat(): Mat {
  const base = stone('coping', { tex: ['tex_stone_block_wall', 'tex_rock_mossy'], dark: '#6a665d', light: '#cdc5b3', moss: 0.2, dirt: 0.1, wear: 0.9, k: 0.9 });
  const joint = rgb('#2a251f');
  return {
    name: 'coping',
    shade(t) {
      let c = base.shade(t);
      if (t.p[1] > 0.5 && t.p[1] < 0.7) {
        const th = Math.atan2(t.p[0], t.p[2]);
        const f = fract(th / (TAU / 8));
        const blk = Math.floor(th / (TAU / 8) + 8) % 8;
        c = mulc(c, 0.86 + 0.26 * hash3(blk, 3, 7));
        const dj = Math.min(f, 1 - f) * (TAU / 8) * Math.hypot(t.p[0], t.p[2]);
        c = mixc(c, joint, cov(dj - 0.004, Math.max(0.003, t.mpt * 1.2)) * 0.85);
      }
      return c;
    },
  };
}

function water(): Mat {
  const deep = rgb('#0e2128'), mid = rgb('#27505c'), sky = rgb('#5d8fa0');
  return {
    name: 'water',
    ao: 0.35,
    shade(t) {
      const [x, , z] = t.p;
      let c = mixc(deep, mid, 0.3 + 0.4 * fbm01(t, 6, 3, 2.2));
      c = mixc(c, sky, 0.38 * smoothstep(0.62, 0.8, fbm01(t, 11, 3, 5.7)));
      c = mixc(c, sky, 0.4 * cov(Math.abs(Math.hypot(x - 0.02, z) - 0.2) - 0.006, 0.006));
      return mulc(c, 0.85 + 0.25 * smoothstep(0.55, 0.15, Math.hypot(x, z)));
    },
  };
}

/** wooden bucket: vertical staves, two iron hoops with rivets, dark water inside the rim */
function bucketMat(): Mat {
  const T = pickTex('tex_wood_plank', 'tex_wood_beam_dark');
  const iron = rgb('#35353c'), rust = rgb('#7a3b1d'), dark = rgb('#4a3322'), light = rgb('#a8825a');
  return {
    name: 'bucket',
    shade(t) {
      const [x, y, z] = t.p;
      const aa = Math.max(0.002, t.mpt * 1.2);
      const th = Math.atan2(x - 0.02, z), yy = y - 0.42;
      const s: Rgb = T ? sampleTex(T, th * 0.9, yy * 2.2, t.mpt * 2.2) : [0.2, 0.12, 0.07];
      const l = Math.min(1, Math.max(0, (0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2] - 0.01) / 0.2));
      let c = mixc(dark, light, 0.2 + 0.7 * l);
      c = mulc(c, 0.55 + 0.45 * smoothstep(0.0, 0.06, Math.abs(fract((th / TAU) * 14 + 0.5) - 0.5)));
      for (const hy of [0.08, 0.215]) {
        const k = cov(Math.abs(yy - hy) - 0.017, aa);
        c = mixc(c, mixc(iron, rust, 0.4 * fbm01(t, 30, 2, 1.1)), k);
        c = mixc(c, rgb('#8d8a86'), cov(Math.hypot((fract((th / TAU) * 14) - 0.5) * 0.06, yy - hy) - 0.005, aa) * k * 0.8);
      }
      if (t.n[1] > 0.7) c = mixc(c, rgb('#0e1a1f'), 0.9);
      return mulc(c, 0.85 + 0.2 * fbm01(t, 22, 2, 3.3));
    },
  };
}

const rectAt = (cx: number, cz: number, hx: number, hz: number): H2[] => rectCorners(hx, hz).map(([x, z]) => [x + cx, z + cz] as H2);

export const prop: PropDef = {
  id: 'prop_well',
  size: 1536,
  aoLong: 2.4,
  crease: 40,
  mats: [
    stone('well-wall', { tex: ['tex_stone_block_wall', 'tex_rock_mossy'], dark: '#58554d', light: '#bdb4a3', moss: 0.5, dirt: 0.35, wear: 0.5, k: 1 }),
    copingMat(),
    flagstones(),
    water(),
    lacquer('well-post', { color: '#98201a', wear: 0.9, dirt: 0.5 }),
    timber('well-beam', { dark: '#3a2a1d', mid: '#6d4f36', light: '#a98660', grey: '#9a927d', facets: 0.5, dirt: 0.2 }),
    roofTile('well-tile', { moss: 0.22 }),
    roofEdge('well-edge', { tile: 1.2, period: 0.11 }),
    lacquer('well-soffit', { color: '#5a1a14', wear: 0.2, dirt: 0 }),
    rope('well-rope', { across: 'u', color: '#9d8156', dark: '#4a3a22' }),
    bucketMat(),
    blackIron('well-iron', { rust: 0.5, tone: '#34343b' }),
    endGrain('well-end'),
    roofTile('well-ridge', { tint: '#a07e72', dark: true, moss: 0.15 }),
  ],
  build(m: PropMesh) {
    const wob = (th: number): number => 1 + 0.03 * Math.sin(th * 3 + 0.4) + 0.02 * Math.sin(th * 7 + 1.7);
    // ---- apron of irregular flagstones
    m.add(revolve([[1.25, 0], [1.25, 0.045], [1.18, 0.07], [0.8, 0.075]], 14, wob), APRON, mapBox(1));
    // ---- ring wall: battered outside, inside down to the water
    m.add(revolve([[0.88, 0.07], [0.86, 0.22], [0.83, 0.42], [0.8, RING_TOP - 0.03]], 16), WALL, mapCylY(0, 0, 0.84, 1));
    m.add(revolve([[0.53, RING_TOP - 0.03], [0.54, 0.45], [0.52, 0.28]], 16), WALL, mapCylY(0, 0, 0.54, 1));
    m.add(revolve([[0.52, 0.27], [0, 0.27]], 16), WATER, mapBox(1));
    // ---- coping ring: chamfered, overhanging the wall, joints painted
    m.add(revolve([[0.9, RING_TOP - 0.06], [0.9, RING_TOP - 0.02], [0.87, RING_TOP + 0.02], [0.56, RING_TOP + 0.02], [0.53, RING_TOP - 0.02], [0.53, RING_TOP - 0.06]], 16), COPING, mapBox(0.9));
    // ---- posts on round bases, bracket beams and the plate beam
    for (const sx of [-1, 1]) {
      const x = sx * POST_X;
      m.add(revolve([[0.2, 0.05], [0.2, 0.11], [0.17, 0.17], [0.11, 0.2]], 8), COPING, mapBox(0.9), moveXf(x, 0, 0));
      m.add(revolve([[0.098, 0.2], [0.09, 0.65], [0.082, POST_TOP]], 8), POST, mapCylY(x, 0, 0.09, 0.9), moveXf(x, 0, 0));
      prism(m, BEAM, mapBox(0.9), rectAt(x, 0, 0.065, 0.62), POST_TOP, POST_TOP + 0.08, { bevel: 0.012 });
    }
    prism(m, BEAM, mapBox(0.9), rectAt(0, 0, 1.02, 0.075), POST_TOP + 0.08, POST_TOP + 0.15, { bevel: 0.012 });
    // ---- windlass: roller through both posts with a crank on the right, rope wound on the drum
    log(m, BEAM, [-1.06, ROLLER_Y, 0], [1.2, ROLLER_Y, 0], 0.066, 0.066, { sides: 7, segs: 2, chamfer0: 0.014, chamfer1: 0.014, capMat: END, seed: 'roller', jitter: 0.03 });
    lash(m, ROPE, [0.02, ROLLER_Y, 0], [1, 0, 0], 0.068, 0.2, { sides: 6, bulge: 0.02, ridges: 3, seed: 'wind' });
    log(m, BEAM, [1.12, ROLLER_Y, 0], [1.12, ROLLER_Y - 0.17, 0.1], 0.028, 0.026, { sides: 4, segs: 1, capMat: END, seed: 'crank' });
    log(m, BEAM, [1.1, ROLLER_Y - 0.17, 0.1], [1.3, ROLLER_Y - 0.17, 0.1], 0.03, 0.03, { sides: 5, segs: 1, chamfer0: 0.008, chamfer1: 0.008, capMat: END, seed: 'grip' });
    // ---- bucket hanging from the rope over the water
    const bx = 0.02, by = 0.42;
    m.add(revolve([[0.105, 0], [0.126, 0.09], [0.14, 0.26]], 7), BUCKET, mapCylY(bx, 0, 0.13, 0.5), moveXf(bx, by, 0));
    m.add(revolve([[0.138, 0.255], [0, 0.2]], 7), BUCKET, mapCylY(bx, 0, 0.13, 0.5), moveXf(bx, by, 0));
    const handle: Vec3[] = [[-0.14, 0.26, 0], [-0.11, 0.34, 0], [0, 0.375, 0], [0.11, 0.34, 0], [0.14, 0.26, 0]].map(([x, y, z]) => [bx + x!, by + y!, z!] as Vec3);
    tube(m, { path: handle, radii: handle.map(() => 0.011), sides: 4, mat: IRON, s: 0.3, caps: 'both', seed: 'handle' });
    tube(m, { path: [[bx, by + 0.375, 0], [bx, ROLLER_Y - 0.06, 0.02], [0.03, ROLLER_Y - 0.065, 0.045]], radii: [0.016, 0.016, 0.016], sides: 5, mat: ROPE, s: 0.3, caps: 'end', seed: 'drop' });
    // ---- curved hip roof with ridge cap, hip caps and upturned ridge ends
    const roof = roofLoft(m, {
      corners: rectCorners(1.1, 0.8),
      stages: [{ f: 1, corners: [[-0.55, 0], [0.55, 0], [0.55, 0], [-0.55, 0]] }],
      y0: ROOF_Y0, rise: 0.23, q: 1.35, rings: 5, segs: [6, 4, 6, 4], lift: 0.14, flare: 0.09, reach: 0.3, thick: 0.09, soffit: 0.5, tile: 1.2,
      mats: { top: TILE, fascia: EDGE, under: SOFFIT },
    });
    for (const path of roof.hips) cap(m, RIDGE, path, 0.03, mapBox(1), 3);
    const ry = roof.crest[0]![1];
    cap(m, RIDGE, [[-0.58, ry, 0], [0.58, ry, 0]], 0.045, mapBox(1), 5);
    for (const sx of [-1, 1]) {
      const x = sx * 0.58;
      const pts: Vec3[] = [[x - sx * 0.05, ry, 0], [x + sx * 0.02, ry + 0.06, 0], [x + sx * 0.07, ry + 0.13, 0], [x + sx * 0.04, ry + 0.19, 0]];
      m.add(sweepSolid(circleShape(0.055, 5), pts, { scale: (t) => 1.15 - 0.7 * t }), RIDGE, mapBox(1));
    }
  },
};
