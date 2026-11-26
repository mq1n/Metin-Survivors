// prop_signpost — wooden multi-board road signpost (2.4 m): a hewn timber post on a stone footing carries three bowed arrow boards pushed
// through the post (red lacquer with gilt brush glyphs, black lacquer with ivory glyphs, bare weathered wood with ink glyphs), hemp
// lashings with a trailing end, and a miniature tiled roof with a gilt bud finial. Both faces of every board are lettered. Front = +Z.
import { Rng } from '../../core/rng.ts';
import { smoothstep } from '../../core/math.ts';
import type { Vec3 } from '../../core/math.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import { type Mat, type PropMesh, mapAuto, mapBox, mapCylY } from '../../archetypes/prop/mesh.ts';
import { pyramidStages, prism, rectCorners, revolve, roofLoft } from '../../archetypes/prop/kit.ts';
import { edgeWear, fbm01, gold, mixc, mulc, pickTex, rainStreaks, rgb, roofEdge, roofTile, stone, wood } from '../../archetypes/prop/mats.ts';
import { lash, lerp, log, moveXf, mul, rotY, sheet, stoneChunk, tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { endGrain, rope, timber } from '../../archetypes/prop/ext/PropsOrc/mats.ts';
import { type Rgb, sampleTex } from '../../archetypes/prop/texlib.ts';
import { GLYPHS, type GlyphName, glyphCov } from '../../archetypes/prop/ext/PropsVillage/glyph.ts';
import { cov } from '../../archetypes/prop/ext/PropsVillage/sdf.ts';

const POST = 0, END = 1, BOARD = 2, ROPE = 3, TILE = 4, EDGE = 5, DARK = 6, GOLD = 7, STONE = 8, SOIL = 9, CHARM = 10;

interface Board {
  /** height of the board's centre line */
  y: number;
  yaw: number;
  /** length from the tail end to the arrow tip, height, tail stub behind the post */
  L: number;
  h: number;
  tail: number;
  style: 'red' | 'dark' | 'plain';
  front: GlyphName[];
  back: GlyphName[];
  /** swallow-tail notch depth and arrowhead length */
  notch: number;
  tip: number;
}

const BOARDS: Board[] = [
  { y: 1.8, yaw: 0.42, L: 1.08, h: 0.26, tail: 0.2, style: 'red', front: ['big', 'village'], back: ['three', 'mile'], notch: 0.05, tip: 0.17 },
  { y: 1.49, yaw: 2.9, L: 0.94, h: 0.23, tail: 0.18, style: 'dark', front: ['mountain', 'river'], back: ['water', 'field'], notch: 0, tip: 0.15 },
  { y: 1.19, yaw: -0.5, L: 1.0, h: 0.23, tail: 0.2, style: 'plain', front: ['ten', 'mile'], back: ['middle', 'village'], notch: 0.04, tip: 0.16 },
];

const POST_R = 0.1;
const THICK = 0.05;
/** arrow board plan: tail at x = -tail, shoulder where the taper starts, tip at x = L - tail */
const xTip = (b: Board): number => b.L - b.tail;
const xShoulder = (b: Board): number => b.L - b.tail - b.tip;
/** half height of the board at plan position x (1 -> 0.07 over the arrowhead) */
const envAt = (b: Board, x: number): number => (x <= xShoulder(b) ? 1 : Math.max(0.07, 1 - ((x - xShoulder(b)) / b.tip) * 0.93));

function signMat(): Mat {
  const Tb = pickTex('tex_wood_beam_dark'), Tr = pickTex('tex_wood_lacquer_red');
  const cream = rgb('#f0e4c2'), goldc = rgb('#e8b640'), ink = rgb('#1a120d'), under = rgb('#2c1b12'), raw = rgb('#b98d58'), rawD = rgb('#5d4228');
  return {
    name: 'sign-boards',
    shade(t) {
      let bi = 0, best = 9;
      for (let i = 0; i < BOARDS.length; i++) {
        const d = Math.abs(t.p[1] - BOARDS[i]!.y);
        if (d < best) { best = d; bi = i; }
      }
      const b = BOARDS[bi]!;
      const nlz = t.n[0] * Math.sin(b.yaw) + t.n[2] * Math.cos(b.yaw);
      const face = nlz > 0.5 ? 1 : nlz < -0.5 ? -1 : 0;
      const lx = t.uv[0], ly = t.uv[1];
      const aa = Math.max(0.0016, t.mpt * 1.1);
      const xs = xShoulder(b), hh = b.h / 2;
      // wood ground, grain along the board
      const gs = 0.7;
      const sb: Rgb = Tb ? sampleTex(Tb, ly / gs, lx / gs, t.mpt / gs) : [0.05, 0.03, 0.02];
      const l = Math.min(1, Math.max(0, (0.299 * sb[0] + 0.587 * sb[1] + 0.114 * sb[2] - 0.006) / 0.09));
      const wood0 = mixc(rawD, raw, smoothstep(0.05, 0.9, l) * 0.9);
      if (face === 0) {
        // sawn edges and the arrowhead bevel: raw wood
        return edgeWear(mulc(mixc(rawD, raw, 0.5 + 0.4 * fbm01(t, 30, 2, 2.3)), 0.9), t, mulc(raw, 1.3), 0.5);
      }
      // distance inside the plan outline (tail edge with swallow notch, top / bottom, slanted arrowhead edges)
      const slopeY = (hh * 0.93) / b.tip;
      const dTip = (hh - slopeY * (lx - xs) - Math.abs(ly)) / Math.hypot(1, slopeY);
      const dTail = lx + b.tail - b.notch * (1 - Math.abs(ly) / hh);
      const dIn = Math.min(dTail, hh - Math.abs(ly), lx > xs ? dTip : 9);
      let ground: Rgb, paint: Rgb, rim: Rgb;
      if (b.style === 'red') {
        ground = mulc(Tr ? sampleTex(Tr, ly / gs, lx / gs, t.mpt / gs) : rgb('#b0261c'), 0.95);
        paint = goldc; rim = cream;
      } else if (b.style === 'dark') {
        ground = mulc(mixc(rgb('#1b130f'), rgb('#3a271b'), l * 0.8), 0.95 + 0.1 * fbm01(t, 30, 2, 2));
        paint = cream; rim = goldc;
      } else {
        ground = mixc(mulc(wood0, 0.95), rgb('#d1a56a'), 0.12);
        paint = ink; rim = rgb('#3a2616');
      }
      let c = ground;
      // border: a bold line and a hairline inside it
      const bl = Math.max(cov(Math.abs(dIn - 0.02) - 0.0045, aa), cov(Math.abs(dIn - 0.034) - 0.0022, aa));
      c = mixc(c, mulc(rim, 0.92 + 0.12 * fbm01(t, 50, 2, 3)), bl);
      // lettering: glyph slots run along +x on the front face, the reading order flips on the back face
      const text = face > 0 ? b.front : b.back;
      const gsz = b.h * 0.62;
      const zx0 = POST_R + 0.05, zx1 = xs + 0.06;
      const pitch = Math.min(gsz * 1.08, (zx1 - zx0) / text.length);
      const start = (zx0 + zx1) / 2 - (pitch * text.length) / 2;
      const k = Math.floor((lx - start) / pitch);
      if (k >= 0 && k < text.length) {
        const g = GLYPHS[text[face > 0 ? k : text.length - 1 - k]!];
        const gx = (lx - (start + (k + 0.5) * pitch)) * face;
        const dry = 0.5 + 0.5 * t.noise.noise(lx * 30 + bi, ly * 30, 4.2);
        const cvg = glyphCov(g, gx, ly, gsz, 0.052, aa * 1.1, dry);
        if (cvg > 0) {
          const sh = glyphCov(g, gx - 0.004, ly + 0.004, gsz, 0.052, aa * 1.1, dry);
          c = mixc(c, mulc(ground, 0.45), sh * 0.55);
          const worn = 1 - 0.5 * smoothstep(0.55, 0.9, fbm01(t, 26, 2, 7.3 + bi));
          c = mixc(c, mulc(paint, 0.88 + 0.16 * fbm01(t, 70, 2, 1.7)), cvg * worn);
        }
      }
      // nail heads on the tail stub
      for (const ny of [-0.055, 0.055]) {
        const nx = -b.tail + 0.05;
        c = mixc(c, rgb('#3d2d27'), cov(Math.hypot(lx - nx, ly - ny) - 0.0085, aa));
        c = mixc(c, rgb('#93806a'), cov(Math.hypot(lx - nx + 0.002, ly - ny - 0.002) - 0.003, aa) * 0.8);
      }
      // paint chips: bare wood where the edges wear through
      const chip = smoothstep(0.35, 0.8, t.edge * 1.8 * (0.4 + fbm01(t, 40, 2, 5.1))) + (1 - smoothstep(0.0, 0.012, dIn)) * 0.5 * smoothstep(0.4, 0.8, fbm01(t, 25, 2, 8.8));
      c = mixc(c, b.style === 'plain' ? mulc(raw, 1.1) : mixc(wood0, under, 0.4), Math.min(1, chip) * 0.85);
      c = rainStreaks(c, t, 0.7);
      return mulc(c, 0.9 + 0.2 * fbm01(t, 2.4, 3, 4 + bi));
    },
  };
}

function soil(): Mat {
  const dark = rgb('#3b2c1d'), mid = rgb('#6b5236');
  return { name: 'soil', shade: (t) => mulc(mixc(dark, mid, fbm01(t, 9, 3, 2.1)), 0.9 + 0.2 * fbm01(t, 40, 2, 1.1)) };
}

/** pasted paper charm: aged paper, red border, a column of two brush glyphs. uv: u 0..1 across, v 0..1 down */
function charmMat(): Mat {
  const paper = rgb('#e8dcb6'), old = rgb('#b9a577'), red = rgb('#a8281c');
  return {
    name: 'charm-paper',
    ao: 0.5,
    shade(t) {
      const aa = Math.max(0.002, t.mpt * 1.2);
      let c = mixc(paper, old, 0.55 * fbm01(t, 14, 3, 2.3) + 0.25 * (1 - t.ao));
      const gx = (t.uv[0] - 0.5) * 0.06, gy = (0.5 - t.uv[1]) * 0.4;
      const edge = Math.min(t.uv[0], 1 - t.uv[0]) * 0.06;
      c = mixc(c, red, cov(Math.abs(edge - 0.006) - 0.0016, aa) * 0.9);
      for (const [g, y] of [['luck', 0.1], ['king', -0.03]] as [GlyphName, number][]) {
        const k = glyphCov(GLYPHS[g], gx, gy - y, 0.056, 0.075, aa * 1.2, 0.3);
        c = mixc(c, mulc(red, 0.85 + 0.2 * fbm01(t, 60, 2, 1.1)), k * 0.92);
      }
      return mulc(c, 0.9 + 0.12 * fbm01(t, 40, 2, 5.5));
    },
  };
}

/** paper charm wrapped round the post at angle `a0`: swallow-tailed strip from yTop down to yBot */
function charm(m: PropMesh, mat: number, a0: number, yTop: number, yBot: number, r: number): void {
  const cols = [-0.3, 0, 0.3].map((da) => ({ s: Math.sin(a0 + da) * r, c: Math.cos(a0 + da) * r }));
  const top = cols.map((p) => [p.s, yTop, p.c] as Vec3);
  const bot = cols.map((p, i) => [p.s, yBot + (i === 1 ? 0.06 : 0), p.c] as Vec3);
  for (let i = 0; i < 2; i++) m.quad(top[i]!, bot[i]!, bot[i + 1]!, top[i + 1]!, [i / 2, 0], [i / 2, 1], [(i + 1) / 2, 1], [(i + 1) / 2, 0], mat);
}

export const prop: PropDef = {
  id: 'prop_signpost',
  size: 1024,
  aoLong: 1.6,
  crease: 40,
  mats: [
    timber('post', { dark: '#3f2d1f', mid: '#7d5c3d', light: '#b69063', grey: '#a29a85', facets: 0.6, dirt: 0.45, bands: [[1.98, 2.05, '#a5321c'], [1.955, 1.972, '#d9a532']] }),
    endGrain('post-end'),
    signMat(),
    rope('lashing', { across: 'u', color: '#9a7d52', dark: '#4a3820' }),
    roofTile('cap-tile', { hip: 1, moss: 0.12 }),
    roofEdge('cap-edge', { tile: 0.72, period: 0.08 }),
    wood('cap-wood', { tex: ['tex_wood_beam_dark'], dark: '#241710', light: '#4b3220' }),
    gold('finial'),
    stone('footing', { tex: ['tex_stone_block_wall', 'tex_rock_mossy'], dark: '#5f5b53', light: '#b9b0a0', moss: 0.35, dirt: 0.5, wear: 0.5, k: 1.2 }),
    soil(),
    charmMat(),
  ],
  build(m: PropMesh) {
    const rng = new Rng('signpost');
    // ---- hewn octagonal post
    log(m, POST, [0, 0, 0], [0, 2.06, 0], 0.112, 0.094, { sides: 8, segs: 3, chamfer0: 0.03, chamfer1: 0.025, capMat: END, seed: 'post', jitter: 0.03, wobble: 0.008, phase: 0.2 });
    // ---- boards: bowed arrow planks with a swallow-tail stub behind the post
    for (const b of BOARDS) {
      const x0 = -b.tail, x1 = xTip(b), xs = xShoulder(b);
      const knots = [x0, lerp(x0, xs, 0.3), lerp(x0, xs, 0.62), xs, x1];
      const nu = knots.length - 1;
      const from = m.triCount;
      const bow = 0.02 * (b.y > 1.5 ? 1 : -1);
      sheet(m, {
        nu, nv: 2, thick: THICK, mat: BOARD, edgeMat: BOARD,
        at: (u, v) => {
          const x = knots[Math.round(u * nu)]!;
          const notch = Math.round(u * nu) === 0 ? b.notch * (1 - Math.abs(v * 2 - 1)) : 0;
          const z = THICK / 2 + bow * ((x - x0) / b.L) ** 2 - 0.004 * Math.sin((x - x0) * 9);
          return [x + notch, (v * 2 - 1) * (b.h / 2) * envAt(b, x) - 0.07 * ((x - xs) / b.L) ** 2, z];
        },
        uv: (u, v) => {
          const x = knots[Math.round(u * nu)]!;
          return [x, (v * 2 - 1) * (b.h / 2) * envAt(b, x)];
        },
      });
      m.transformFrom(from, mul(rotY(b.yaw), moveXf(0, b.y, 0)));
      // hemp lashing round the post under the board
      lash(m, ROPE, [0, b.y - b.h / 2 - 0.045, 0], [0, 1, 0], POST_R + 0.004, 0.085, { sides: 7, bulge: 0.014, ridges: 1, seed: `lash${b.y}` });
    }
    // trailing rope end from the top lashing
    {
      const y0 = BOARDS[0]!.y - BOARDS[0]!.h / 2 - 0.045;
      const pts: Vec3[] = [[0.09, y0, 0.06], [0.125, y0 - 0.1, 0.09], [0.12, y0 - 0.22, 0.1], [0.135, y0 - 0.3, 0.085]];
      tube(m, { path: pts, radii: [0.014, 0.013, 0.013, 0.011], sides: 4, mat: ROPE, s: 0.3, caps: 'end', seed: 'tail' });
    }
    // paper charms pasted on the post
    charm(m, CHARM, 0.45, 0.98, 0.58, POST_R + 0.006);
    charm(m, CHARM, -2.1, 1.08, 0.74, POST_R + 0.006);
    // ---- capital block + miniature tiled roof + gilt finial
    prism(m, DARK, mapAuto(0.5), rectCorners(0.17, 0.17), 2.0, 2.075, { bevel: 0.012 });
    roofLoft(m, {
      corners: rectCorners(0.36, 0.36),
      stages: pyramidStages(4),
      y0: 2.13, rise: 0.19, q: 1.45, rings: 3, segs: 2, lift: 0.05, flare: 0.05, reach: 0.45, thick: 0.05, soffit: 0.6, tile: 0.72,
      mats: { top: TILE, fascia: EDGE, under: DARK },
    });
    m.add(revolve([[0, 2.32], [0.04, 2.32], [0.026, 2.345], [0.048, 2.37], [0.026, 2.39], [0, 2.4]], 7), GOLD, mapCylY(0, 0, 0.05, 0.3));
    // ---- stone footing and soil
    m.add(revolve([[0.38, 0], [0.34, 0.03], [0.21, 0.065], [0.12, 0.07]], 9, (th) => 1 + 0.1 * Math.sin(th * 3 + 1) + 0.05 * Math.sin(th * 5)), SOIL, mapCylY(0, 0, 0.3, 0.8));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.5 + (rng.next() - 0.5) * 0.5;
      const w = 0.22 + rng.next() * 0.1, h = 0.11 + rng.next() * 0.11;
      m.add(stoneChunk(rng, w, h, w * 0.85, 5, 0.8), STONE, mapBox(0.9), mul(moveXf(Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2), rotY(rng.next() * 6)));
    }
  },
};
