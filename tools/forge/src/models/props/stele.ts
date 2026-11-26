// prop_stele — 3.6 m memorial stele on a bixi (dragon-headed tortoise) of weathered grey granite. The tortoise has a domed shell carved
// with hexagonal scutes and a ring of marginal plates, a dragon head craning forward, four clawed feet and a stub tail; a bevelled
// socket on its back holds the tablet. The tablet front is incised with a framed title panel and columns of glyphs inside a scrolling
// border, the back with a worn second text, the sides with cloud scrolls; the rounded crown carries two coiled dragon bodies around
// an arched title cartouche. Lichen on the upward faces, rain streaks under the crown, chipped light edges, grime at the foot.
import type { Mat4, Vec3 } from '../../core/math.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { extrude } from '../../core/hard/hardmesh.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { Mapper, Mat, Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01, groundDirt, mixc, mulc, rgb } from '../../archetypes/prop/mats.ts';
import type { Rgb } from '../../archetypes/prop/texlib.ts';
import { type Motif, NO_MOTIF, reliefOf } from '../../archetypes/prop/ext/PropsElem/motifs.ts';
import { memo1, noiseBump, sdBox, veins } from '../../archetypes/prop/ext/PropsElem/paint.ts';
import { tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { GLYPHS, glyphCov } from '../../archetypes/prop/ext/PropsVillage/glyph.ts';
import { TAU, hash2, lathe2 } from '../../archetypes/prop/ext/PropsElem2/geo.ts';
import { stonePainter } from '../../archetypes/prop/ext/PropsElem2/stone.ts';

const STONE = 0, SHELL = 1, TABLET = 2;

// ---------------------------------------------------------------------------------------------------------------------------------
// layout (metres): tortoise faces +z, tablet front faces +z

const SX = 0.95, SZ = 1.15; // shell plan scale (x, z) of the unit lathe
const Y_SOCK0 = 0.62, Y_SOCK1 = 1.0;
const TAB_W = 0.56, TAB_T = 0.16, TAB_Y0 = 0.98, TAB_Y1 = 2.98;
const CROWN_Y = 2.94, CROWN_R = 0.62, H_TOTAL = 3.6;

const granite = stonePainter({ tex: ['tex_rock_mossy', 'tex_basalt'], k: 0.45, ramp: [[0, rgb('#3e3b36')], [0.5, rgb('#7a756c')], [1, rgb('#b8b0a3')]], contrast: 0.55, bump: 0.4, strata: 0.12, blotch: 0.4 });

/** shared weathering: lichen on up faces, rain streaks, chipped edges, grime at the ground */
function weather(c: Rgb, t: Texel, o: { lichen?: number; streak?: number } = {}): Rgb {
  c = mulc(c, 1 - 0.5 * veins(t, 2.6, 0.004, 9, 0.5));
  const up = clamp01(t.n[1]);
  const lich = smoothstep(0.62, 0.78, fbm01(t, 5.5, 3, 4.4) + up * 0.18) * (o.lichen ?? 0.6);
  if (lich > 0) c = mixc(c, mixc(rgb('#8f9a6a'), rgb('#c9c08a'), fbm01(t, 13, 2, 9.1)), lich * 0.75);
  const moss = smoothstep(0.55, 0.8, fbm01(t, 3.2, 3, 2.2) + (1 - t.ao) * 0.5) * up * 0.6;
  if (moss > 0) c = mixc(c, mulc(rgb('#4e5e2a'), 0.7 + 0.5 * fbm01(t, 22, 2, 5)), moss * 0.7);
  const s = t.noise.fbm(t.p[0] * 16 + t.p[2] * 16, t.p[1] * 1.4, t.p[2] * 6, { octaves: 3 }) * 0.5 + 0.5;
  c = mulc(c, 1 - (o.streak ?? 0.5) * 0.45 * smoothstep(0.52, 0.85, s) * (1 - t.n[1] * t.n[1]));
  c = mixc(c, rgb('#d2cbbd'), smoothstep(0.3, 0.7, t.edge) * 0.4 * (0.4 + 0.6 * fbm01(t, 24, 2, 3.1)));
  return groundDirt(c, t, 0.45, 0.5, rgb('#3e3428'));
}

// ---- tortoise shell: hexagonal scutes on the dome, a ring of marginal plates below the shoulder

const hexD = (x: number, z: number, s: number): { d: number; id: number } => {
  // distance to the nearest hex-cell border (pointy hex grid, cell radius s)
  const q = (Math.sqrt(3) / 3 * x - z / 3) / s, r = ((2 / 3) * z) / s;
  let cx = Math.round(q), cz = Math.round(r), cy = Math.round(-q - r);
  const dx = Math.abs(cx - q), dz = Math.abs(cz - r), dy = Math.abs(cy + q + r);
  if (dx > dy && dx > dz) cx = -cy - cz;
  else if (dy > dz) cy = -cx - cz;
  else cz = -cx - cy;
  const px = s * Math.sqrt(3) * (cx + cz / 2), pz = s * 1.5 * cz;
  const lx = Math.abs(x - px), lz = Math.abs(z - pz);
  const d = Math.max(lx, lx * 0.5 + lz * 0.866);
  return { d: s * 0.866 - d, id: hash2(cx, cz) };
};

function shellMotif(t: Texel): Motif {
  const ux = t.p[0] / SX, uz = t.p[2] / SZ;
  const rr = Math.hypot(ux, uz);
  if (t.p[1] < 0.42) {
    // marginal plates: radial grooves around the rim band
    const a = Math.atan2(uz, ux);
    const f = ((a / TAU) * 28) % 1;
    const g = 1 - smoothstep(0.02, 0.06, Math.min(Math.abs(f), 1 - Math.abs(f)) * 0.3);
    return { lit: 1, ink: g * 0.7, glow: 0 };
  }
  const h = (x: number, z: number): number => smoothstep(0.0, 0.06, hexD(x, z, 0.24).d);
  const hd = hexD(ux * SX, uz * SZ, 0.24);
  const groove = 1 - smoothstep(0.008, 0.024, hd.d);
  // concentric growth rings inside each scute
  const ring = 1 - smoothstep(0.004, 0.01, Math.abs(((hd.d / 0.05) % 1) - 0.5) * 0.05);
  const shoulder = 1 - smoothstep(0.012, 0.03, Math.abs(rr - 0.78));
  return { lit: reliefOf(h, ux * SX, uz * SZ, 0.01, 1.4) * (0.92 + 0.16 * hd.id), ink: clamp01(groove * 0.85 + ring * 0.18 * smoothstep(0.03, 0.06, hd.d) + shoulder * 0.6), glow: 0 };
}

// ---- tablet carving

const GLYPH_LIST = Object.values(GLYPHS);

/** engraved glyph field: columns read top-down, right to left */
function inscription(x: number, y: number, o: { x0: number; x1: number; y0: number; y1: number; size: number; seed: number; wear: number }, t: Texel): number {
  if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) return 0;
  const pitch = o.size * 1.25;
  const col = Math.floor((o.x1 - x) / pitch), row = Math.floor((o.y1 - y) / pitch);
  const cx = o.x1 - (col + 0.5) * pitch, cy = o.y1 - (row + 0.5) * pitch;
  if (cx - pitch / 2 < o.x0 - 1e-3 || cy - pitch / 2 < o.y0 - 1e-3) return 0;
  const g = GLYPH_LIST[Math.floor(hash2(col * 7 + o.seed, row * 13) * GLYPH_LIST.length)]!;
  const cov = glyphCov(g, x - cx, y - cy, o.size, 0.06, 0.004, 0.3);
  // erosion: patches where the text has weathered away
  const keep = smoothstep(o.wear - 0.1, o.wear + 0.15, fbm01(t, 3.5, 3, 7.7));
  return cov * keep;
}

/** carved crown: an arched cartouche framed by two coiled dragon bodies */
function crownMotif(x: number, y: number): Motif {
  const ly = y - CROWN_Y;
  const h = (xx: number, yy: number): number => {
    // cartouche: arched panel
    const cart = sdBox(xx, yy - 0.2, 0.15, 0.13);
    let v = smoothstep(0.012, -0.004, cart) * 0.35 + (1 - smoothstep(0.008, 0.02, Math.abs(cart))) * 0.6;
    // two dragon bodies: sine coils sweeping up the shoulders and meeting over the cartouche
    for (const s of [-1, 1]) {
      const bx = s * xx;
      const path = 0.36 + 0.13 * Math.sin(bx * 11 - 0.6) - 0.6 * (bx - 0.18) * (bx - 0.18);
      const dd = Math.abs(yy - path);
      if (bx > 0.12 && bx < 0.58) v = Math.max(v, (1 - smoothstep(0.035, 0.055, dd)) * (0.8 + 0.2 * Math.sin(bx * 90)));
    }
    // pearl over the cartouche
    v = Math.max(v, smoothstep(0.06, 0.04, Math.hypot(xx, yy - 0.45)));
    return v;
  };
  const hv = h(x, ly);
  return { lit: reliefOf(h, x, ly, 0.008, 2.0), ink: clamp01((0.3 - hv) * 0.5), glow: 0 };
}

function tabletMotif(t: Texel): Motif & { text: number } {
  const p = t.p;
  const front = t.nf[2] > 0.7, back = t.nf[2] < -0.7, side = Math.abs(t.nf[0]) > 0.7;
  if (p[1] > CROWN_Y + 0.02) {
    if (front || back) return { ...crownMotif(front ? p[0] : -p[0], p[1]), text: 0 };
    return { ...NO_MOTIF, text: 0 };
  }
  if (front || back) {
    const x = front ? p[0] : -p[0], y = p[1];
    // incised frame line and a scrolling border band
    const inner = sdBox(x, y - (TAB_Y0 + TAB_Y1) / 2 - 0.02, TAB_W - 0.07, (TAB_Y1 - TAB_Y0) / 2 - 0.09);
    const frame = 1 - smoothstep(0.004, 0.011, Math.abs(inner));
    const band = inner > 0.006 && inner < 0.05 ? 1 : 0;
    const wave = band * (1 - smoothstep(0.004, 0.01, Math.abs(Math.sin((y + Math.abs(x)) * 34) * 0.012 - (inner - 0.028))));
    // title panel at the top, the text field below
    const title = sdBox(x, y - 2.66, 0.2, 0.17);
    const tFrame = 1 - smoothstep(0.004, 0.01, Math.abs(title));
    let text = 0;
    if (title < 0) text = inscription(x, y, { x0: -0.17, x1: 0.17, y0: 2.5, y1: 2.82, size: 0.13, seed: front ? 3 : 9, wear: front ? 0.15 : 0.45 }, t);
    else if (y < 2.44) text = inscription(x, y, { x0: -0.44, x1: 0.44, y0: 1.18, y1: 2.42, size: 0.1, seed: front ? 1 : 5, wear: front ? 0.2 : 0.5 }, t);
    const ink = clamp01(frame * 0.8 + tFrame * 0.8 + wave * 0.55 + text * 0.9);
    return { lit: 1 + 0.18 * (frame + tFrame) * (y > 0 ? -1 : 1) - 0.2 * text, ink, glow: 0, text };
  }
  if (side) {
    // cloud scrolls stacked up the narrow sides
    const z = t.nf[0] > 0 ? -p[2] : p[2];
    const cell = 0.24;
    const cy = (Math.floor((p[1] - TAB_Y0) / cell) + 0.5) * cell + TAB_Y0;
    const d = Math.abs(Math.hypot(z - 0.02 * Math.sin(cy * 9), p[1] - cy) - 0.06);
    const curl = 1 - smoothstep(0.006, 0.014, d);
    return { lit: 1, ink: curl * 0.7, glow: 0, text: 0 };
  }
  return { ...NO_MOTIF, text: 0 };
}

const tabletM = memo1(tabletMotif);
const shellM = memo1(shellMotif);

function carved(name: string, motif: ((t: Texel) => Motif) | null, o: { lichen?: number; streak?: number } = {}): Mat {
  return {
    name,
    shade(t) {
      let c = granite(t);
      c = mulc(c, noiseBump(t, 6, 0.2, 2, 8));
      const m = motif ? motif(t) : NO_MOTIF;
      c = mulc(c, m.lit * (1 - 0.78 * m.ink));
      return weather(c, t, o);
    },
  };
}

// eyes of the tortoise head (painted), filled during build
const EYES: Vec3[] = [];
const stoneMat: Mat = (() => {
  const base = carved('granite', null, { lichen: 0.5 });
  return {
    name: 'granite',
    shade(t) {
      let c = base.shade(t);
      for (const e of EYES) c = mixc(c, rgb('#15120f'), 1 - smoothstep(0.035, 0.05, Math.hypot(t.p[0] - e[0], t.p[1] - e[1], t.p[2] - e[2])));
      return c;
    },
  };
})();

/** planar metre mapper (dominant axis) */
const mapBlock: Mapper = (a, b, c, n) => {
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const f = (p: Vec3): [number, number] => (ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], -p[1]] : [p[0], -p[1]]);
  return [f(a), f(b), f(c)];
};

const frame = (x: Vec3, y: Vec3, z: Vec3, o: Vec3): Mat4 => [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
const xfPt = (m: Mat4, p: Vec3): Vec3 => [m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!, m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!, m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!];

/** side profile of the bixi head (z forward, y up) */
const HEAD: [number, number][] = [[-0.12, -0.12], [0.1, -0.16], [0.3, -0.12], [0.36, -0.07], [0.3, -0.04], [0.4, -0.01], [0.42, 0.06], [0.34, 0.12], [0.2, 0.15], [0.08, 0.22], [-0.05, 0.2], [-0.14, 0.1]];

export const prop: PropDef = {
  id: 'prop_stele',
  size: 1536,
  crease: 34,
  aoShort: 0.35,
  aoLong: 1.6,
  aoGain: 1.25,
  shadowTint: [0.46, 0.46, 0.5],
  material: { roughness: 0.92, metallic: 0 },
  mats: [stoneMat, carved('shell', shellM, { lichen: 0.45 }), carved('tablet', tabletM, { lichen: 0.3, streak: 0.8 })],
  build(m) {
    // ---- tortoise: plastron body, domed shell, four clawed feet, tail, craning dragon head
    const body = m.triCount;
    lathe2(m, STONE, [[0.62, 0], [0.7, 0.07], [0.72, 0.2], [0.66, 0.32]], 16);
    lathe2(m, SHELL, [[0.64, 0.3], [0.8, 0.34], [0.87, 0.4], [0.83, 0.46], [0.78, 0.56], [0.67, 0.69], [0.49, 0.8], [0.25, 0.87], [0, 0.89]], 20, {
      mod: (th, i, _k, r, y) => [r * (1 + (i >= 1 && i <= 3 ? 0.03 * Math.cos(th * 14) : 0)), y],
    });
    m.deform(body, (p) => [p[0] * SX, p[1], p[2] * SZ]);
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const cx = sx * 0.7, cz = sz * 0.7;
      const out = Math.atan2(-sz, sx);
      lathe2(m, STONE, [[0.22, 0], [0.25, 0.05], [0.21, 0.18], [0.15, 0.34]], 9, {
        cx,
        cz,
        phase: out,
        mod: (th, i, _k, r, y) => {
          const d = Math.cos(th - out);
          const toe = Math.max(0, Math.cos((th - out) * 4)) * Math.max(0, d);
          return [r * (1 + (i <= 1 ? 0.25 * toe + 0.12 * Math.max(0, d) : 0)), y];
        },
      });
    }
    tube(m, { path: [[0, 0.24, -0.98], [0, 0.2, -1.12], [0.04, 0.14, -1.22]], radii: [0.1, 0.06, 0.01], sides: 5, mat: STONE, s: 0.3, caps: 'none', seed: 'tail' });
    tube(m, { path: [[0, 0.36, 0.86], [0, 0.5, 1.0], [0, 0.62, 1.08]], radii: [0.25, 0.21, 0.17], sides: 8, mat: STONE, s: 0.3, caps: 'none', seed: 'neck' });
    {
      // profile x (forward) -> world +z, profile y -> up, extrusion -> world -x (right-handed), 1.2x
      const k = 1.2;
      const M2 = frame([0, 0, k], [0, k, 0], [-k, 0, 0], [0, 0.68, 1.06]);
      m.add(extrude(HEAD, 0.34, { axis: 'z', z0: -0.17, bevel: { size: 0.05, segments: 2 } }), STONE, mapBlock, M2);
      EYES.length = 0;
      for (const s of [-1, 1]) EYES.push(xfPt(M2, [0.24, 0.1, s * 0.15]));
    }

    // ---- socket block on the shell
    m.add(extrude([[-0.66, -0.3], [0.66, -0.3], [0.66, 0.3], [-0.66, 0.3]], Y_SOCK1 - Y_SOCK0, { axis: 'y', z0: Y_SOCK0, bevel: { size: 0.05, segments: 1 }, taper: 0.92 }), STONE, mapBlock);

    // ---- tablet + crown
    m.add(extrude([[-TAB_W, TAB_Y0], [TAB_W, TAB_Y0], [TAB_W * 0.97, TAB_Y1], [-TAB_W * 0.97, TAB_Y1]], TAB_T * 2, { axis: 'z', z0: -TAB_T, bevel: { size: 0.035, segments: 1 } }), TABLET, mapBlock);
    const crown: [number, number][] = [[-CROWN_R, CROWN_Y], [CROWN_R, CROWN_Y], [CROWN_R, CROWN_Y + 0.14]];
    const n = 14;
    for (let i = 1; i < n; i++) {
      const a = (i / n) * Math.PI;
      const lobe = 1 + 0.07 * Math.abs(Math.sin(a * 3.5));
      const ry = (H_TOTAL - CROWN_Y - 0.14) / CROWN_R;
      crown.push([Math.cos(a) * CROWN_R * lobe, CROWN_Y + 0.14 + Math.sin(a) * CROWN_R * ry * lobe]);
    }
    crown.push([-CROWN_R, CROWN_Y + 0.14]);
    m.add(extrude(crown, TAB_T * 2 + 0.06, { axis: 'z', z0: -TAB_T - 0.03, bevel: { size: 0.04, segments: 2 } }), TABLET, mapBlock);
  },
};
