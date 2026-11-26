// Executioner paint. The stock humanoid stack adds an UNMASKED grain pass per leather piece (plus noisy strands / wear layers), which
// speckles every surface alike; here those layers are replaced by clean, separated material looks keyed by the piece tags
// (hair = p0, outfit spec k = p(k+1), hook pieces p100 blade / p101 grip / p102 fittings): low-frequency leather with dark creases
// and worn convex edges, a faint cloth weave, dark iron with bright edges and rust, brass, and a blade painted in blade-local
// (u, v) coordinates (dark spine, fuller groove, bright bevel, crisp blood runs). Skin stays smooth with cavity shading, the fists
// become dark leather gloves, the hood gets a tan stitched mask patch, the arms get ash war bands.
import { smoothstep } from '../../../core/math.ts';
import { custom, region } from '../../../core/paint/layers.ts';
import { type PaintLayer, type PaintVertex, type Rgb, mixRgb, mulRgb, rgb } from '../../../core/paint/painter.ts';
import type { Anatomy, HumanoidPaint } from '../../../archetypes/humanoid/index.ts';
import { CLEAVER } from '../../../archetypes/brute/executioner-cleaver.ts';
import { handRef, hp } from '../../../archetypes/humans/kit.ts';
import { EXEC_CLEAVER_MATS, EXEC_PALETTE, execOutfit } from './look.ts';

const WHITE: Rgb = [1, 1, 1];
const famOf = (mat: string): string => mat.replace(/[0-9]+$/, '');
const pal = (k: string): Rgb => rgb(EXEC_PALETTE[k] ?? '#808080');

// region masks are SDF distance queries: memoise them per texel (several layers ask for the same mask)
const regionCache = new WeakMap<PaintVertex, Map<string, number>>();
function R(v: PaintVertex, tag: string, soft: number): number {
  let m = regionCache.get(v);
  if (!m) regionCache.set(v, (m = new Map()));
  const key = `${tag}|${soft}`;
  let r = m.get(key);
  if (r === undefined) m.set(key, (r = v.region(tag, soft)));
  return r;
}
const fbm = (v: PaintVertex, f: number, ox = 0, oy = 0, oz = 0, octaves = 2): number => v.noise.fbm(v.p[0] * f + ox, v.p[1] * f + oy, v.p[2] * f + oz, { octaves });
const shade = (v: PaintVertex, k: number, m: number): void => {
  v.color = mixRgb(v.color, mulRgb(v.color, k), m);
};

const leather = (tag: string, base: Rgb): PaintLayer => {
  const edgeCol = mixRgb(base, WHITE, 0.22);
  return custom(`${tag}:leather`, (v) => {
    const m = R(v, tag, 0.006);
    if (m <= 0) return;
    const cav = v.cavity;
    shade(v, (1 + 0.1 * fbm(v, 7, 1, 2, 3)) * (1 + 0.6 * Math.min(0, cav)), m);
    const edge = Math.max(0, cav);
    if (edge > 0) v.color = mixRgb(v.color, edgeCol, Math.min(0.55, 0.9 * edge) * m);
  });
};

const cloth = (tag: string): PaintLayer =>
  custom(`${tag}:cloth`, (v) => {
    const m = R(v, tag, 0.006);
    if (m <= 0) return;
    const weave = Math.sin(v.p[1] * 700) * Math.sin((v.p[0] + v.p[2]) * 700);
    shade(v, (1 + 0.035 * weave) * (1 + 0.1 * fbm(v, 8, 4, 1, 7)) * (1 + 0.5 * Math.min(0, v.cavity)), m);
  });

const iron = (tag: string): PaintLayer => {
  const hiC = mixRgb(pal('metal'), pal('plateHi'), 0.7);
  const rustC = rgb('#6a3a22');
  return custom(`${tag}:iron`, (v) => {
    const m = R(v, tag, 0.004);
    if (m <= 0) return;
    const cav = v.cavity;
    shade(v, (0.92 + 0.2 * (v.n[1] * 0.5 + 0.5)) * (1 + 0.7 * Math.min(0, cav)), m);
    const edge = Math.max(0, cav);
    if (edge > 0) v.color = mixRgb(v.color, hiC, Math.min(0.7, 1.2 * edge) * m);
    const rust = smoothstep(0.26, 0.34, fbm(v, 10, 2, 5, 9)) * 0.5;
    if (rust > 0) v.color = mixRgb(v.color, rustC, rust * m * (0.5 + 0.5 * (1 - Math.max(0, cav))));
  });
};

const brass = (tag: string): PaintLayer => {
  const hiC = rgb('#f2dc92');
  return custom(`${tag}:brass`, (v) => {
    const m = R(v, tag, 0.004);
    if (m <= 0) return;
    const cav = v.cavity;
    shade(v, (0.9 + 0.25 * (v.n[1] * 0.5 + 0.5)) * (1 + 0.6 * Math.min(0, cav)), m);
    const edge = Math.max(0, cav);
    if (edge > 0) v.color = mixRgb(v.color, hiC, Math.min(0.6, 1.1 * edge) * m);
  });
};

/** cleaver steel painted in blade-local coordinates (u along the blade from its root, w toward the edge, ref metres) */
const bladeLook = (tag: string, o: readonly [number, number, number], s: number): PaintLayer => {
  const steel = pal('plate'), hi = pal('plateHi');
  const dark = mulRgb(steel, 0.5), groove = mulRgb(steel, 0.62);
  const blood = rgb('#4a1611'), crust = rgb('#2c0e0a'), rust = rgb('#6b3b21');
  return custom(`${tag}:blade`, (v) => {
    const m = R(v, tag, 0.004);
    if (m <= 0) return;
    const u = (v.p[2] - o[2]) / s;
    const w = -(v.p[1] - o[1]) / s;
    const spine = smoothstep(CLEAVER.spineV + 0.05, CLEAVER.spineV + 0.02, w);
    const bevel = smoothstep(0.085, 0.118, w);
    const fuller = (1 - smoothstep(0.008, 0.016, Math.abs(w - 0.03))) * smoothstep(0.05, 0.1, u) * (1 - smoothstep(0.6, 0.68, u));
    let c = mixRgb(steel, dark, 0.85 * spine);
    c = mixRgb(c, groove, 0.7 * fuller);
    c = mixRgb(c, hi, 0.85 * bevel);
    c = mulRgb(c, 1 + 0.04 * Math.sin(w * 520 + 5 * fbm(v, 9, 2, 3, 4)) * (1 - bevel));
    c = mixRgb(c, hi, Math.min(0.6, 1.3 * Math.max(0, v.cavity)));
    c = mixRgb(c, rust, smoothstep(0.34, 0.4, fbm(v, 6.5, 6, 1, 3)) * 0.3 * (1 - bevel));
    // blood: dark runs from the edge up the face, heavier toward the tip
    const eb = smoothstep(0.03, 0.15, w);
    const n1 = v.noise.fbm(u * 11 + 3, w * 1.5, 7.7, { octaves: 2 }) + 0.5;
    const thr = 0.74 - 0.34 * eb - 0.1 * smoothstep(0.3, 0.75, u);
    const b = smoothstep(thr, thr + 0.035, n1) * smoothstep(0.0, 0.05, w);
    c = mixRgb(c, mixRgb(blood, crust, smoothstep(thr + 0.18, thr + 0.22, n1)), 0.88 * b);
    v.color = mixRgb(v.color, c, m);
  });
};

export function execPaint(paint: HumanoidPaint, a: Anatomy): HumanoidPaint {
  const s = a.s;
  const specs = execOutfit();
  const mats = new Map<string, string>();
  specs.forEach((sp, k) => mats.set(`p${k + 1}`, sp.mat ?? ''));
  mats.set('p100', EXEC_CLEAVER_MATS.blade);
  mats.set('p101', EXEC_CLEAVER_MATS.handle);
  mats.set('p102', EXEC_CLEAVER_MATS.metal);
  const hoodTag = `p${specs.findIndex((sp) => sp.id === 'hood') + 1}`;
  const bladeOrigin = hp(handRef(a, 'r'), 0, 0, CLEAVER.rootZ * s);

  const look = (tag: string, mat: string): PaintLayer | null => {
    switch (famOf(mat)) {
      case 'leather': return leather(tag, pal(mat));
      case 'cloth': return cloth(tag);
      case 'metal': return iron(tag);
      case 'gold': return brass(tag);
      case 'plate': return bladeLook(tag, bladeOrigin, s);
      default: return null;
    }
  };

  // smooth skin with anatomy read from the cavity field, fists as dark leather gloves, ash war bands (all under the outfit pieces)
  const skin = custom('execSkin', (v) => {
    const m = R(v, 'skin', 0.006);
    if (m <= 0) return;
    const cav = v.cavity;
    shade(v, 1 + 0.5 * Math.min(0, cav) + 0.16 * Math.max(0, cav), m);
  });
  const glove = pal('glove');
  const gloveEdge = mixRgb(glove, WHITE, 0.18);
  const gloves = custom('execGloves', (v) => {
    const h = R(v, 'hand', 0.004);
    if (h <= 0) return;
    const cav = v.cavity;
    let c = mulRgb(glove, 1 + 0.7 * Math.min(0, cav));
    c = mixRgb(c, gloveEdge, Math.min(0.5, 0.9 * Math.max(0, cav)));
    v.color = mixRgb(v.color, c, 0.95 * h);
  });
  const war = region('warpaint', pal('ash'), 0.92, 0.003);

  // tan stitched mask patch over the near-black hood
  const maskCol = pal('mask');
  const maskEdge = mixRgb(maskCol, WHITE, 0.2);
  const mask = custom('execMask', (v) => {
    const m = R(v, 'mask', 0.004);
    if (m <= 0) return;
    const cav = v.cavity;
    let c = mulRgb(maskCol, 1 + 0.45 * Math.min(0, cav));
    c = mixRgb(c, maskEdge, Math.min(0.45, 0.9 * Math.max(0, cav)));
    v.color = mixRgb(v.color, c, m);
  });

  // dirt creeping up from the ground, old blood on the forearms / fists / apron
  const grime = rgb('#2a2018'), bloodC = rgb('#46170f'), crustC = rgb('#5b2c1d');
  const dirt = custom('execGrime', (v) => {
    const low = smoothstep(0.9, 0.0, v.p[1]);
    if (low <= 0) return;
    const m = Math.min(1, low * (0.45 + 0.9 * (fbm(v, 4.5, 3, 1, 5) + 0.5)));
    v.color = mixRgb(v.color, grime, 0.3 * m);
  });
  const gore = custom('execGore', (v) => {
    const g = Math.min(1, v.bone('forearm_r') + v.bone('forearm_l') + 0.6 * (v.bone('wrist_r') + v.bone('wrist_l')) + 0.9 * v.bone('skirt_f'));
    if (g <= 0) return;
    const n = fbm(v, 5.2, 1.7, 4.2, 9.1);
    const b = smoothstep(0.21, 0.245, n);
    if (b > 0) v.color = mixRgb(mixRgb(v.color, bloodC, 0.78 * b * g), crustC, 0.5 * smoothstep(0.36, 0.4, n) * g);
  });

  const albedo: PaintLayer[] = [];
  for (const l of paint.albedo) {
    if (l.name === 'grain' || l.name === 'strands') continue;
    const m = /^(p\d+):(wear|weave|skirt|steel|gold)$/.exec(l.name);
    if (!m) {
      albedo.push(l);
      if (l.name === 'eyes') albedo.push(skin, gloves, war);
      continue;
    }
    const tag = m[1]!;
    if (m[2] === 'skirt') continue;
    const lk = look(tag, mats.get(tag) ?? '');
    if (lk) albedo.push(lk);
    if (tag === hoodTag) albedo.push(mask);
  }
  albedo.push(
    dirt, gore,
    // hole of every chain link, pale thread of the hood stitching, amber glints in the black eye holes of the hood
    region('linkhole', rgb('#0e0c0b'), 0.95, 0.003),
    region('thread', rgb('#cfbd94'), 0.85, 0.003),
    region('eye', rgb('#6b430f'), 1, 0.0015),
    region('iris', rgb('#ffbf3a'), 1, 0.0018),
    region('pupil', rgb('#0a0605'), 1, 0.0012),
    region('hoodhole', rgb('#0d0a08'), 1, 0.0045),
  );
  return { ...paint, albedo };
}
