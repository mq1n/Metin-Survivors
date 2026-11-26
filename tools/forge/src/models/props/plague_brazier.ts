// prop_plague_brazier — 1.7 m hexagonal ritual brazier of the cursed snowfield ruins: a stepped cast-iron foot, a hexagonal column
// banded twice and cast with skull reliefs and glyph columns, three clawed iron talons bracing a flaring hexagonal fire bowl whose rim
// corners rise into spikes. Three bone skulls are bolted to the bowl faces, their sockets lit by the sickly green fire; glowing plague
// sigils on the remaining faces and green slime dripping over the lip. A heap of green-hot coals with licking green flames (emissive).
import type { Vec3 } from '../../core/math.ts';
import { clamp01, smoothstep } from '../../core/math.ts';
import { Rng } from '../../core/rng.ts';
import type { PropDef } from '../../archetypes/prop/index.ts';
import type { Texel } from '../../archetypes/prop/mesh.ts';
import { fbm01 } from '../../archetypes/prop/mats.ts';
import { NO_MOTIF, type Motif } from '../../archetypes/prop/ext/PropsElem/motifs.ts';
import { loadMask, runeSdf, sampleMask } from '../../archetypes/prop/ext/PropsElem/paint.ts';
import { tube } from '../../archetypes/prop/ext/PropsOrc/geom.ts';
import { type SkullFrame, boneMat, skull, skullFrame } from '../../archetypes/prop/ext/PropsElem2/bones.ts';
import { PLAGUE, coalHeap, coalMat, flameMat, flameTongue } from '../../archetypes/prop/ext/PropsElem2/fire.ts';
import { TAU, faceAt, hash2, lathe2, thetaOf } from '../../archetypes/prop/ext/PropsElem2/geo.ts';
import { ironMat } from '../../archetypes/prop/ext/PropsElem2/metal.ts';
import { NO_RELIEF, type Relief, skullRelief } from '../../archetypes/prop/ext/PropsElem2/motifs.ts';

const IRON = 0, BONE = 1, COALS = 2, FLAME = 3;

const TH_F = -Math.PI / 2;
/** hexagon with a face (not a corner) toward the front */
const PH = TH_F + Math.PI / 6;
const faceTh = (k: number): number => TH_F + (k * Math.PI) / 3;

const Y_RIM = 1.26, Y_COAL = 1.1;
const FOOT: [number, number][] = [[0.54, 0], [0.54, 0.06], [0.47, 0.1], [0.38, 0.13], [0.31, 0.17], [0.2, 0.2], [0.16, 0.6], [0.21, 0.62], [0.21, 0.68], [0.16, 0.7], [0.15, 0.82], [0.23, 0.87]];
const BOWL: [number, number][] = [[0.23, 0.86], [0.4, 0.92], [0.53, 1.04], [0.58, 1.16], [0.63, 1.2], [0.63, Y_RIM], [0.56, Y_RIM + 0.01], [0.51, 1.2], [0.47, Y_COAL]];

const radial = (p: Vec3): number => Math.hypot(p[0], p[2]);
const inward = (t: Texel): number => -(t.n[0] * t.p[0] + t.n[2] * t.p[2]) / Math.max(1e-3, radial(t.p));

const sigils = loadMask('tex_rune_sigils');
const SKULLS: SkullFrame[] = [];

/** circular plague sigil from the sigil sheet: raised ring, glowing strokes */
function sigil(lu: number, lv: number, idx: number, R: number): Relief {
  const d = Math.hypot(lu, lv);
  if (d > R + 0.02 || !sigils) return NO_RELIEF;
  const cx = idx % 4, cy = Math.floor(idx / 4) % 4;
  const s = (0.5 / R) * 0.9;
  const mk = sampleMask(sigils, (cx + 0.5 + lu * s) / 4, (cy + 0.5 - lv * s) / 4);
  const g = smoothstep(0.35, 0.8, mk);
  return { lit: 1, ink: g * 0.6, glow: g, h: 0, area: smoothstep(R + 0.01, R - 0.01, d) * 0.6 };
}

/** green slime drips hanging from the lip down the outer faces */
function drip(t: Texel): number {
  if (inward(t) > 0 || t.p[1] < 0.9 || t.p[1] > Y_RIM + 0.01 || radial(t.p) < 0.4) return 0;
  const th = thetaOf(t.p);
  const u = th * 0.6;
  const cell = Math.floor(u / 0.07);
  if (hash2(cell, 77) < 0.62) return 0;
  const cu = (cell + 0.3 + 0.4 * hash2(cell, 78)) * 0.07;
  const len = 0.06 + 0.22 * hash2(cell, 79) ** 2;
  const y0 = Y_RIM - len;
  const below = t.p[1] - y0;
  if (below < -0.02) return 0;
  // a thin trail that thickens toward the lip, ending in a bead
  const w = 0.006 + 0.008 * smoothstep(0, len, below) + (below < 0.02 ? 0.008 * (1 - Math.abs(below - 0.006) / 0.02) : 0);
  return 1 - smoothstep(w * 0.6, w * 1.2, Math.abs(u - cu));
}

const iron = ironMat('iron', {
  pal: PLAGUE,
  k: 1.8,
  corrode: 0.55,
  polish: 0.55,
  soot: (t) => clamp01(smoothstep(0.1, 0.5, inward(t)) * 0.8 + smoothstep(1.15, 1.27, t.p[1]) * 0.3),
  heat: (t) => {
    const lip = radial(t.p) > 0.38 && t.p[1] > Y_COAL - 0.04 ? smoothstep(0.25, 0.6, inward(t)) * (1 - smoothstep(Y_COAL, Y_RIM, t.p[1])) * 0.5 * (0.5 + 0.7 * fbm01(t, 12, 2, 4.4)) : 0;
    const m = motif(t);
    return clamp01(Math.max(lip, drip(t) * 0.55, m.glow * 0.75));
  },
  motif: (t) => motif(t),
});

let lastP: Vec3 = [NaN, NaN, NaN];
let lastM: Motif | Relief = NO_MOTIF;
/** cast decoration of the iron parts at a texel (memoised for shade + emit) */
function motif(t: Texel): Motif | Relief {
  if (t.p[0] === lastP[0] && t.p[1] === lastP[1] && t.p[2] === lastP[2]) return lastM;
  lastP = [t.p[0], t.p[1], t.p[2]];
  lastM = motifAt(t);
  return lastM;
}

function motifAt(t: Texel): Motif | Relief {
  if (Math.abs(t.nf[1]) > 0.55 || inward(t) > 0.1) return NO_MOTIF;
  const th = thetaOf(t.p);
  const r = radial(t.p);
  // column: skull reliefs on the faces under the skulls (odd faces), carved glyph columns between
  if (t.p[1] > 0.22 && t.p[1] < 0.6 && r < 0.22) {
    const f = faceAt(th, 0.18, 6, PH);
    if (f.j % 2 === 1) return skullRelief(f.lu, t.p[1] - 0.44, 0.075);
    const cy = Math.floor((t.p[1] - 0.24) / 0.11);
    if (cy < 0 || cy > 2) return NO_MOTIF;
    const ly = (t.p[1] - 0.24 - (cy + 0.5) * 0.11) / 0.1;
    const d = runeSdf(f.lu / 0.1, ly, 50 + f.j * 3 + cy) * 0.1;
    const g = 1 - smoothstep(0.006, 0.012, d);
    return { lit: 1 - 0.25 * g, ink: g * 0.8, glow: g * 0.45 };
  }
  // bowl: plague sigils on the faces without skulls (even faces)
  if (t.p[1] > 0.95 && t.p[1] < 1.2 && r > 0.45) {
    const f = faceAt(th, r, 6, PH);
    if (f.j % 2 === 0) return sigil(f.lu, t.p[1] - 1.08, (f.j * 5 + 3) % 16, 0.105);
  }
  return NO_MOTIF;
}

export const prop: PropDef = {
  id: 'prop_plague_brazier',
  size: 1024,
  crease: 30,
  aoShort: 0.25,
  aoLong: 1.2,
  aoGain: 1.3,
  shadowTint: [0.36, 0.42, 0.4],
  emissiveFactor: [1, 1, 1],
  material: { roughness: 0.72, metallic: 0.3 },
  mats: [iron, boneMat('bone', { skulls: SKULLS, pal: PLAGUE, glow: 0.9, grime: 0.7 }), coalMat('coals', PLAGUE, { scale: 14, base: 0.3, y0: Y_COAL, y1: Y_COAL + 0.18 }), flameMat('flame', PLAGUE)],
  build(m) {
    const rng = new Rng('plague_brazier');
    // ---- stepped foot + banded column, hexagonal bowl with spiked rim corners
    lathe2(m, IRON, FOOT, 6, { phase: PH });
    lathe2(m, IRON, BOWL, 6, { phase: PH });
    for (let k = 0; k < 6; k++) {
      const a = PH + (k * TAU) / 6;
      const d: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
      const p0: Vec3 = [d[0] * 0.6, Y_RIM - 0.01, d[2] * 0.6];
      const p1: Vec3 = [d[0] * 0.67, Y_RIM + 0.12, d[2] * 0.67];
      const p2: Vec3 = [d[0] * 0.75, Y_RIM + 0.24, d[2] * 0.75];
      tube(m, { path: [p0, p1, p2], radii: [0.045, 0.028, 0.003], sides: 4, mat: IRON, s: 0.3, caps: 'none', seed: `spike${k}`, phase: Math.PI / 4 });
    }
    // ---- three clawed talons bracing the bowl (under the sigil faces)
    for (const k of [1, 3, 5]) {
      const a = faceTh(k);
      const d: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
      const P: [number, number][] = [[0.12, 0.4], [0.24, 0.5], [0.36, 0.64], [0.42, 0.8], [0.44, 0.96], [0.5, 1.04]];
      tube(m, { path: P.map(([r, y]) => [d[0] * r, y, d[2] * r] as Vec3), radii: [0.04, 0.045, 0.042, 0.035, 0.028, 0.012], sides: 5, mat: IRON, s: 0.3, caps: 'none', seed: `talon${k}`, jitter: 0.06 });
    }
    // ---- bone skulls bolted to the front and back faces of the bowl, looking out and a little down
    SKULLS.length = 0;
    for (const k of [0, 2, 4]) {
      const a = faceTh(k);
      const d: Vec3 = [Math.cos(a), 0, -Math.sin(a)];
      const ap = 0.55 * Math.cos(Math.PI / 6);
      const o: Vec3 = [d[0] * (ap + 0.06), 1.08, d[2] * (ap + 0.06)];
      SKULLS.push(skull(m, BONE, skullFrame(o, d, 0.1, 0.25, (rng.next() - 0.5) * 0.25)));
    }
    // ---- coals + green flames
    coalHeap(m, COALS, { cx: 0, cz: 0, y0: Y_COAL, h: 0.16, r: 0.44, segs: 12, lumps: 3, lumpR: 0.08, seed: 'plague-coals' });
    flameTongue(m, FLAME, { base: [0, Y_COAL + 0.06, 0], h: 0.54, r: 0.22, lobes: 3, twist: 2.6, sway: 0.5, phase: 0.7, rings: 8 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.9 + (rng.next() - 0.5) * 0.5;
      const rr = 0.24 + rng.next() * 0.06;
      flameTongue(m, FLAME, {
        base: [Math.cos(a) * rr, Y_COAL + 0.06, -Math.sin(a) * rr],
        h: 0.26 + rng.next() * 0.12,
        r: 0.11 + rng.next() * 0.03,
        lean: [Math.cos(a) * 0.07, -Math.sin(a) * 0.07],
        lobes: 3,
        twist: 1.8 + rng.next(),
        phase: rng.next() * 6,
        rings: 6,
      });
    }
  },
};
